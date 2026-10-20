/**
 * jobQueue.js — the one queue in front of the worker pool (A3 §4.1, §4.4; PLAN §1.6). Typed jobs with a required
 * priority — rest and patches 0 > view 1 > plane 2 > cuts 3 > prefetch 4 > thumbnails 5 — are cut into strips
 * whose cells are dealt round-robin after a centre-out sort, so each worker's first plate is near the attention
 * point. At dispatch a strip is dropped when its purpose has moved on (its generation) or its cells are already
 * exact or in flight exact; a view strip is aimed at where the camera will be when it lands (the velocity rule).
 *
 *   - One worker is kept for cuts while any are pending: other jobs hold at most `workers − 1` slots, and prefetch
 *     and thumbnails the same (at least one slot, so a one-worker pool is never starved). A cut (`kind: "cut"`, a
 *     descent too; `eraseWorkerClient.js`) is one strip with no cells, queued as pushed; a barrier's first. A job that
 *     carries its own pool entry (a cut, a snapshot's plate) is queued as the object pushed: `done`, `remove` and
 *     `requeue` find it by that identity (a copy leaked a thumbnail's slot for the session).
 *   - A frame packs at most PACK_MS_PER_FRAME while the camera moves, and a task at most that while it is still (the
 *     pack runs in `pool.submit`, on this thread: 14–45 ms a job on a dense drawing mid-zoom, PP §10.14, and 171–480
 *     ms a prefetch strip at rest, P6); the strip that crosses it is the last, and the rest wait for the next task,
 *     which the queue asks for (`defer`), so input runs between two strips. While the camera moves, a step starts the
 *     budget (`frame`) and the task waits until MOTION_STALE_MS after the last step: a camera that stopped steps no
 *     more, and nothing else would start it (F140).
 *   - Pure: a pool `{ size(), free(), submit(strip) }` (`rasterWorkerClient.rasterPool` behind the renderer's face), a
 *     clock, the store's `wants(key)`. The caller calls `done(id, ms)` for every strip `submit` took.
 */
import { PLATE_PX } from "./plate";
import { levelFor, ownFloor, zOf } from "./level";
import { levelCell } from "./PyramidStore";

/** The priority of each kind of job (A3 §4.1). A job carries its own; this is the table the callers read. */
export const PRIO = Object.freeze({ rest: 0, patch: 0, view: 1, plane: 2, cut: 3, prefetch: 4, thumb: 5 });
/**
 * Strips a worker: a strip is half a worker's share, so a free worker has one to take (RASTERISER-PLAN §3.6). Raising it
 * is not the lever for imbalance: one plate a strip read 1.35–1.62 against 1.44–1.54 (§8.6 measurement 11), since one
 * plate of that screen was 15–20× the median and no strip rule splits a plate.
 */
export const STRIPS_PER_WORKER = 2;
/** Pack milliseconds one animation frame may spend while the camera moves, and one task while it is still (A3 §4.4). */
export const PACK_MS_PER_FRAME = 4;
/** A moving camera steps every frame; a motion this old with no step since has stopped, and a task starts the budget (F140). */
export const MOTION_STALE_MS = 50;
/** The mean job ms before any job has come back. */
const JOB_MS0 = 30;
/**
 * The velocity rule aims at most this many levels past the view's, and never past the frame's own floor (F134: with
 * no bound, zoom steps 1–3 ms apart in jsdom re-aimed strips 15–20 octaves out, and one plate took 5–102 s inline).
 */
export const AIM_LEVELS = 2;

export default class JobQueue {
    /**
     * @param {object} o
     * @param {{size:()=>number, free:()=>number, submit:(strip:object)=>boolean}} o.pool the workers; `submit` packs and posts
     * @param {()=>number} [o.clock] ms @param {{wants:(key:string)=>boolean}} [o.store] the plate store
     * @param {object} [o.gens] live purpose generations (`PicturePyramid.gens`): a strip older than its purpose's is dropped
     * @param {(strip:object, why:string)=>void} [o.onDrop] a strip dropped before dispatch
     * @param {(fn:()=>void, ms:number)=>void} [o.defer] runs `fn` in a task at least `ms` later (the budget's next task)
     * @param {(cells:object[])=>object[]} [o.restore] restores the cells the store's RAM tier holds, returns the rest (F161)
     */
    constructor({ pool, clock = () => Date.now(), store = null, gens = null, onDrop = null, defer = (fn, ms) => setTimeout(fn, ms), restore = null } = {}) {
        this.pool = pool;
        this.clock = clock;
        this.store = store;
        this.gens = gens || {};
        this.onDrop = onDrop;
        this.restore = restore;
        this.queue = [];               // strips, in arrival order; dispatch picks the lowest prio, oldest first
        this.inFlight = new Map();     // id -> strip
        this._restoring = 0;           // RAM-tier restores the renderer has in flight (F161): the view's, in `report`
        this._seq = 0;
        this._id = 0;
        this._packMs = 0;              // this frame's pack time, or this task's at rest
        this._defer = defer;
        this._task = false;            // a later task is asked for, which starts the budget again (`_nextTask`)
        this.motion = null;            // { moving, view, vel: { px: [x, y] /ms, zoom: log2 Z /ms }, attention }
        this.jobMs = JOB_MS0;
        this.s = { pushed: 0, strips: 0, dispatched: 0, deferred: 0, reaimed: 0, skippedCells: 0, offscreenCells: 0, done: 0, ramCells: 0,
            drops: { gen: 0, exact: 0, offscreen: 0, empty: 0 }, byPrio: [0, 0, 0, 0, 0, 0] };   // byPrio: strips dispatched
    }

    // ---- in ----

    /** Typed jobs in: each cut into strips, its cells sorted from the attention point and dealt round-robin. */
    push(jobs) {
        for (const job of jobs) {
            if (!Number.isInteger(job.prio) || job.prio < 0 || job.prio > 5) throw new Error("jobQueue: a job needs a priority 0–5, got " + job.prio);
            this.s.pushed++;
            const at = this.clock();
            for (const st of this.strips(job)) { st.seq = ++this._seq; st.pushedAt = at; this.queue.push(st); this.s.strips++; }
        }
        return this;
    }

    /**
     * A job's strips: cells by distance from `job.attention` (the job's grid px), dealt round-robin into
     * `workers × STRIPS_PER_WORKER` strips; clips travel with their cells. A strip is the job with fewer cells.
     */
    strips(job) {
        if (job.kind === "cut" || job.entry) return [job];   // it carries its own pool entry, whose closures name this object
        const n0 = job.cells.length;
        if (!n0) return [];
        const order = job.cells.map((c, k) => k);
        const a = job.attention;
        if (a) {
            const d = job.cells.map((c) => {
                const x = (c.i + 0.5) * PLATE_PX - a[0], y = (c.j + 0.5) * PLATE_PX - a[1];
                return x * x + y * y;
            });
            order.sort((p, q) => d[p] - d[q] || p - q);
        }
        const n = Math.max(1, Math.min(n0, Math.max(1, this.pool.size()) * STRIPS_PER_WORKER));
        const out = [];
        for (let s = 0; s < n; s++) {
            const ks = [];
            for (let k = s; k < n0; k += n) ks.push(order[k]);
            out.push({ ...job, cells: ks.map((k) => job.cells[k]), clips: job.clips ? ks.map((k) => job.clips[k]) : null });
        }
        return out;
    }

    // ---- the frame ----

    /** An animation frame begins: its pack budget is fresh. */
    frame() { this._packMs = 0; }

    /**
     * The camera's motion for the velocity rule and the admission: `{ moving, at, view: { frameId, level, S, Z, k, tx,
     * ty, wDev, hDev, sigmaMin }, vel: { px: [vx, vy] device px/ms, zoom: log2 Z per ms }, attention: [x, y] device px }`,
     * `at` the clock's time of `view`.
     */
    setMotion(m) { this.motion = m || null; }

    /** Dispatch while there are free slots and strips that may run now. Returns how many went. */
    pump() {
        let n = 0;
        for (;;) {
            if (this.pool.free() <= 0) return n;
            const moving = this.motion && this.motion.moving;
            if (this._packMs >= PACK_MS_PER_FRAME) {
                if (this.queue.length) { this.s.deferred++; this._nextTask(); }
                return n;
            }
            const k = this._best();
            if (k < 0) return n;
            const st = this.queue.splice(k, 1)[0];
            if (!this._admit(st)) continue;
            const t0 = this.clock();
            st.id = ++this._id;
            st.sentAt = t0;
            this.inFlight.set(st.id, st);
            const ok = this.pool.submit(st);
            this._packMs += this.clock() - t0;
            if (!moving) this._nextTask();
            if (ok === false) { this.inFlight.delete(st.id); this._drop(st, "empty"); continue; }
            this.s.dispatched++; this.s.byPrio[st.prio]++;
            n++;
        }
    }

    /**
     * A strip `submit` took has landed or failed: its slot is free. A landing's time feeds the arrival estimate — by
     * default from its dispatch (its pack, the post, the worker, the landing); `ms === false` is a failure, no sample.
     * @param {number} id @param {number|false} [ms]
     */
    done(id, ms) {
        const st = this.inFlight.get(id);
        if (!st) return false;
        this.inFlight.delete(id);
        const t = ms === false || st.kind === "cut" ? NaN : ms != null ? ms : this.clock() - st.sentAt;   // plates are the estimate's
        if (t >= 0 && isFinite(t)) this.jobMs += 0.2 * (t - this.jobMs);
        this.s.done++;
        return true;
    }

    /**
     * A later task starts the budget again and pumps what waits: the next one at rest; while the camera moves, the one
     * MOTION_STALE_MS after the last step, which a newer moving step re-arms — that step started the budget (F140).
     */
    _nextTask() {
        if (this._task) return;
        this._task = true;
        const m = this.motion, moving = !!(m && m.moving);
        const ms = !moving ? 0 : m.at != null ? Math.max(0, m.at + MOTION_STALE_MS - this.clock()) : MOTION_STALE_MS;
        this._defer(() => {
            this._task = false;
            const n = this.motion;
            if (n !== m && n && n.moving) { if (this.queue.length) this._nextTask(); return; }
            this._packMs = 0;
            if (this.queue.length) this.pump();
        }, ms);
    }

    /** A queued strip taken out before dispatch (an aborted snapshot); false when it is not queued. */
    remove(st) {
        const k = this.queue.indexOf(st);
        if (k < 0) return false;
        this.queue.splice(k, 1);
        return true;
    }

    /** A teardown: every queued strip forgotten, none dispatched; what is in flight still answers `done`. */
    clear() { const n = this.queue.length; this.queue.length = 0; return n; }

    /** A failed strip back at the head of its priority, its priority kept (H7). */
    requeue(id) {
        const st = this.inFlight.get(id);
        if (!st) return false;
        this.inFlight.delete(id);
        st.seq = -(++this._seq);
        this.queue.push(st);
        return true;
    }

    // ---- the rules ----

    /** Strips of this kind queued or in flight. */
    pending(kind) {
        let n = 0;
        for (const st of this.queue) if (st.kind === kind) n++;
        for (const st of this.inFlight.values()) if (st.kind === kind) n++;
        return n;
    }

    /** The strip to run next: the lowest prio, a barrier's then the oldest within it; a cut's reserved worker and the low-prio cap respected. */
    _best() {
        const W = Math.max(1, this.pool.size()), cap = Math.max(1, W - 1);
        let cuts = 0, other = 0, low = 0;
        for (const st of this.inFlight.values()) { if (st.kind === "cut") cuts++; else other++; if (st.prio >= PRIO.prefetch) low++; }
        const cutsPending = cuts > 0 || this.queue.some((st) => st.kind === "cut");
        let best = -1;
        for (let k = 0; k < this.queue.length; k++) {
            const st = this.queue[k];
            if (st.kind !== "cut" && cutsPending && other >= cap) continue;
            if (st.prio >= PRIO.prefetch && low >= cap) continue;
            const b = best >= 0 ? this.queue[best] : null;
            if (!b || st.prio < b.prio || (st.prio === b.prio && (!!st.barrier !== !!b.barrier ? !!st.barrier : st.seq < b.seq))) best = k;
        }
        return best;
    }

    /** At dispatch: drop a strip whose purpose moved on; drop its exact or in-flight cells; aim a view strip at the camera's arrival. */
    _admit(st) {
        if (st.kind === "cut") return true;
        const pk = st.purpose ? String(st.purpose).split(":")[0] : null;
        const g = pk != null ? this.gens[pk] : undefined;
        if (st.gen != null && g != null && st.gen < g) { this._drop(st, "gen"); return false; }
        if (st.kind === "view" && this.motion && this.motion.moving && this.motion.view) {
            this._aim(st);
            if (!st.cells.length) { this._drop(st, "offscreen"); return false; }
        }
        if (this.store) {
            const keep = [];
            for (let k = 0; k < st.cells.length; k++) if (this.store.wants(st.cells[k].key)) keep.push(k);
            if (keep.length < st.cells.length) {
                this.s.skippedCells += st.cells.length - keep.length;
                st.cells = keep.map((k) => st.cells[k]);
                if (st.clips) st.clips = keep.map((k) => st.clips[k]);
            }
        }
        // What the RAM tier holds is restored now, not packed (F161): a re-aimed strip's cells were never offered to it.
        if (this.restore && !st.clips && st.cells.length) {
            const n = st.cells.length;
            st.cells = this.restore(st.cells);
            this.s.ramCells += n - st.cells.length;
        }
        if (!st.cells.length) { this._drop(st, "exact"); return false; }
        return true;
    }

    /**
     * The velocity rule (A3 §4.4): the camera predicted at the strip's arrival — the time since the motion's view
     * plus the mean dispatch-to-landing time (`pump` dispatches only to a free slot, so nothing waits ahead of it) —
     * from the last frames' pan and zoom velocity about the attention point. Cells off the predicted screen are
     * skipped; a level the camera will have left is re-aimed at the one it is heading to — its cells under the
     * strip's and on the predicted screen — at most AIM_LEVELS from the view's and never under the frame's `ownFloor`.
     */
    _aim(st) {
        const m = this.motion, v = m.view;
        if (st.frame == null || String(st.frame) !== String(v.frameId) || st.level == null) return;
        const eta = (m.at != null ? Math.max(0, this.clock() - m.at) : 0) + this.jobMs;
        const vel = m.vel || { px: [0, 0], zoom: 0 };
        const oct = AIM_LEVELS * v.S;
        const f = 2 ** Math.max(-oct, Math.min(oct, (vel.zoom || 0) * eta));
        const a = m.attention || [v.wDev / 2, v.hDev / 2];
        const k1 = v.k * f;
        const tx = a[0] - (a[0] - v.tx) * f + (vel.px ? vel.px[0] * eta : 0), ty = a[1] - (a[1] - v.ty) * f + (vel.px ? vel.px[1] * eta : 0);
        const win = { left: -tx / k1, top: -ty / k1, right: (v.wDev - tx) / k1, bottom: (v.hDev - ty) / k1 };
        const l1 = Math.max(ownFloor(v.S), v.level - AIM_LEVELS, Math.min(v.level + AIM_LEVELS, levelFor(k1, v.S, v.level, v.sigmaMin)));
        let cells = st.cells;
        if (l1 !== st.level) {
            const Z1 = zOf(l1, v.S), s0 = PLATE_PX / st.Z, u = Z1 / PLATE_PX, seen = new Set(), next = [];
            for (const c of cells) {
                const x0 = Math.max(c.i * s0, win.left), y0 = Math.max(c.j * s0, win.top);
                const x1 = Math.min((c.i + 1) * s0, win.right), y1 = Math.min((c.j + 1) * s0, win.bottom);
                if (!(x1 > x0 && y1 > y0)) continue;
                for (let j = Math.floor(y0 * u); j < Math.ceil(y1 * u); j++) {
                    for (let i = Math.floor(x0 * u); i < Math.ceil(x1 * u); i++) {
                        const key = i + "," + j;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        next.push(levelCell(st.frame, l1, v.S, i, j));
                    }
                }
            }
            cells = next;
            st.level = l1; st.Z = zOf(l1, v.S); st.clips = null;
            this.s.reaimed++;
        }
        const s = PLATE_PX / st.Z, keep = cells.filter((c) => c.i * s < win.right && (c.i + 1) * s > win.left && c.j * s < win.bottom && (c.j + 1) * s > win.top);
        this.s.offscreenCells += cells.length - keep.length;
        st.cells = keep;
    }

    _drop(st, why) {
        this.s.drops[why] = (this.s.drops[why] || 0) + 1;
        if (this.onDrop) this.onDrop(st, why);
    }

    /** A RAM-tier restore begun (+1) or landed or failed (−1): it takes no slot, but it is the view's work in flight (F161). */
    restoring(n) { this._restoring = Math.max(0, this._restoring + n); }

    // ---- the report ----

    report() {
        const queued = [0, 0, 0, 0, 0, 0], flying = [0, 0, 0, 0, 0, 0];
        for (const st of this.queue) queued[st.prio]++;
        for (const st of this.inFlight.values()) flying[st.prio]++;
        flying[PRIO.view] += this._restoring;
        return { queued, inFlight: flying, jobMs: this.jobMs, packMsFrame: this._packMs, ...this.s, drops: { ...this.s.drops }, byPrio: this.s.byPrio.slice() };
    }
}
