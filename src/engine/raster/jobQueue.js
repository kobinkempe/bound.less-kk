/**
 * jobQueue.js — the one queue in front of the worker pool (A3 §4.1, §4.4; PLAN §1.6). Typed jobs with a required
 * priority — rest and patches 0 > view 1 > plane 2 > cuts 3 > prefetch 4 > thumbnails 5 — are cut into strips
 * whose cells are dealt round-robin after a centre-out sort, so each worker's first plate is near the attention
 * point. At dispatch a strip is dropped when its purpose has moved on (its generation) or its cells are already
 * exact or in flight exact; a view strip is aimed at where the camera will be when it lands (the velocity rule).
 *
 *   - One worker is kept for cuts while any are pending: other jobs hold at most `workers − 1` slots, and prefetch
 *     and thumbnails the same (at least one slot, so a one-worker pool is never starved).
 *   - While the camera moves, a frame packs at most PACK_MS_PER_FRAME (the pack runs in `pool.submit`, on this
 *     thread, 14–45 ms a job on a dense drawing, PP §10.14); the rest waits for the next frame.
 *   - Pure: a pool `{ size(), free(), submit(strip) }`, a clock, the store's `wants(key)`; `rasterWorkerClient.js`
 *     adopts it (B-PYRAMID-2). The caller calls `done(id, ms)` for every strip `submit` took.
 */
import { PLATE_PX } from "./plate";
import { levelFor, zOf } from "./level";
import { levelCell } from "./PyramidStore";

/** The priority of each kind of job (A3 §4.1). A job carries its own; this is the table the callers read. */
export const PRIO = Object.freeze({ rest: 0, patch: 0, view: 1, plane: 2, cut: 3, prefetch: 4, thumb: 5 });
/** Strips a worker: a strip is half a worker's share, so a free worker has one to take (RASTERISER-PLAN §3.6). */
export const STRIPS_PER_WORKER = 2;
/** Pack milliseconds one animation frame may spend while the camera moves (A3 §4.4). */
export const PACK_MS_PER_FRAME = 4;
/** The mean job ms before any job has come back. */
const JOB_MS0 = 30;

export default class JobQueue {
    /**
     * @param {object} o
     * @param {{size:()=>number, free:()=>number, submit:(strip:object)=>boolean}} o.pool the workers; `submit` packs and posts
     * @param {()=>number} [o.clock] ms @param {{wants:(key:string)=>boolean}} [o.store] the plate store
     * @param {object} [o.gens] live purpose generations (`PicturePyramid.gens`): a strip older than its purpose's is dropped
     * @param {(strip:object, why:string)=>void} [o.onDrop] a strip dropped before dispatch
     */
    constructor({ pool, clock = () => Date.now(), store = null, gens = null, onDrop = null } = {}) {
        this.pool = pool;
        this.clock = clock;
        this.store = store;
        this.gens = gens || {};
        this.onDrop = onDrop;
        this.queue = [];               // strips, in arrival order; dispatch picks the lowest prio, oldest first
        this.inFlight = new Map();     // id -> strip
        this._seq = 0;
        this._id = 0;
        this._packMs = 0;              // this frame's pack time
        this.motion = null;            // { moving, view, vel: { px: [x, y] /ms, zoom: log2 Z /ms }, attention }
        this.jobMs = JOB_MS0;
        this.s = { pushed: 0, strips: 0, dispatched: 0, deferred: 0, reaimed: 0, skippedCells: 0, offscreenCells: 0, done: 0,
            drops: { gen: 0, exact: 0, offscreen: 0, empty: 0 } };
    }

    // ---- in ----

    /** Typed jobs in: each cut into strips, its cells sorted from the attention point and dealt round-robin. */
    push(jobs) {
        for (const job of jobs) {
            if (!Number.isInteger(job.prio) || job.prio < 0 || job.prio > 5) throw new Error("jobQueue: a job needs a priority 0–5, got " + job.prio);
            this.s.pushed++;
            for (const st of this.strips(job)) { st.seq = ++this._seq; this.queue.push(st); this.s.strips++; }
        }
        return this;
    }

    /**
     * A job's strips: cells by distance from `job.attention` (the job's grid px), dealt round-robin into
     * `workers × STRIPS_PER_WORKER` strips; clips travel with their cells. A strip is the job with fewer cells.
     */
    strips(job) {
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
            if (moving && this._packMs >= PACK_MS_PER_FRAME) { if (this.queue.length) this.s.deferred++; return n; }
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
            if (ok === false) { this.inFlight.delete(st.id); this._drop(st, "empty"); continue; }
            this.s.dispatched++;
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
        const t = ms === false ? NaN : ms != null ? ms : this.clock() - st.sentAt;
        if (t >= 0 && isFinite(t)) this.jobMs += 0.2 * (t - this.jobMs);
        this.s.done++;
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

    /** The strip to run next: the lowest prio, the oldest within it; a cut's reserved worker and the low-prio cap respected. */
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
            if (!b || st.prio < b.prio || (st.prio === b.prio && st.seq < b.seq)) best = k;
        }
        return best;
    }

    /** At dispatch: drop a strip whose purpose moved on; drop its exact or in-flight cells; aim a view strip at the camera's arrival. */
    _admit(st) {
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
        if (!st.cells.length) { this._drop(st, "exact"); return false; }
        return true;
    }

    /**
     * The velocity rule (A3 §4.4): the camera predicted at the strip's arrival — the time since the motion's view
     * plus the mean dispatch-to-landing time (`pump` dispatches only to a free slot, so nothing waits ahead of it) —
     * from the last frames' pan and zoom velocity about the attention point. Cells off the predicted screen are
     * skipped; a level the camera will have left is re-aimed at the one it is heading to — its cells under the
     * strip's and on the predicted screen, so a jump of many levels (a descend doubles a step) stays one screenful.
     */
    _aim(st) {
        const m = this.motion, v = m.view;
        if (st.frame == null || String(st.frame) !== String(v.frameId) || st.level == null) return;
        const eta = (m.at != null ? Math.max(0, this.clock() - m.at) : 0) + this.jobMs;
        const vel = m.vel || { px: [0, 0], zoom: 0 };
        const f = 2 ** ((vel.zoom || 0) * eta);
        const a = m.attention || [v.wDev / 2, v.hDev / 2];
        const k1 = v.k * f;
        const tx = a[0] - (a[0] - v.tx) * f + (vel.px ? vel.px[0] * eta : 0), ty = a[1] - (a[1] - v.ty) * f + (vel.px ? vel.px[1] * eta : 0);
        const win = { left: -tx / k1, top: -ty / k1, right: (v.wDev - tx) / k1, bottom: (v.hDev - ty) / k1 };
        const l1 = levelFor(k1, v.S, v.level, v.sigmaMin);
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

    // ---- the report ----

    report() {
        const queued = [0, 0, 0, 0, 0, 0], flying = [0, 0, 0, 0, 0, 0];
        for (const st of this.queue) queued[st.prio]++;
        for (const st of this.inFlight.values()) flying[st.prio]++;
        return { queued, inFlight: flying, jobMs: this.jobMs, packMsFrame: this._packMs, ...this.s, drops: { ...this.s.drops } };
    }
}
