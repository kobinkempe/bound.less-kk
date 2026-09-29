/**
 * sceneClient.js — the main-thread side of the scene index (SCENES-PLAN §7.4). It keeps a dirty set
 * from the Document's events, turns changed objects into item records at idle (chunks along the
 * ink, the width the ink counts with, the table's residual), and sends one batch at a time to the
 * index — in its worker, or inline where there is none. The scene list lands in `docMeta.scenes`;
 * the saved state rides `serializeDrawing` as `meta.sceneIndex`.
 *
 * Never flushes while a stroke, a drag or a lasso is live, nor while the raster or erase workers
 * have work (the lowest priority, §6 rule 7), for at most MAX_WAIT_MS.
 */
import { SceneIndex, CHUNK, MAX_CHUNKS, REACH } from "./sceneIndex";
import { segmentTerm, loopsBBox } from "./geometry/arcShape";
import { ownTranslation } from "./geometry/offsets";
import { Loop } from "./geometry/loop";
import { openSceneWorker } from "./sceneWorkerClient";
import { rasterWorkerReport } from "./raster/rasterWorkerClient";

// An item carries its OWN table's translation: the index adds its frame's shift itself (`sceneIndex`, `+ f.sx`).
const ownT = ownTranslation;

const SLICE_MS = 8;
const MAX_WAIT_MS = 3000;
const SCENE_IDLE_TIMEOUT_MS = 5000;   // the lowest priority: a tick forced this late at most (SC-1)
const SCENE_WORKER_RESPAWNS = 3;      // failed workers replaced before the index goes inline (SC-3)
/** Inline (no worker), a load of more natives than this is indexed on demand (`refreshScenes`), not at idle. */
const INLINE_AUTO_MAX = 5000;
const REC = { 0: 3, 1: 8, 2: 9, 3: 16 };
/** Erase footprints kept: at most this many, and this many chunk records in all (the oldest go first). */
export const FOOT_MAX = 512;
export const FOOT_CHUNKS = 8192;
const ONE_LOOP = Object.freeze([0]);   // the loops of a one-loop outline, shared
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Chunk boxes along a path, at most `max` on a side, each with the length it covers: consecutive
 * points go into one box until it would outgrow `max`; the box that follows starts at the last
 * point, so the chunks cover the ink with no gap. `starts`: the first chunk of each run.
 */
function chunker(max) {
    const out = [], starts = [];
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0, len = 0, open = false, px = 0, py = 0, have = false;
    return {
        out, starts,
        /** A point; `jump` starts a new run (a new loop) with no length from the last point. */
        put(x, y, jump) {
            const dl = have && !jump ? Math.hypot(x - px, y - py) : 0;
            if (open && (jump || Math.max(x1, x) - Math.min(x0, x) > max || Math.max(y1, y) - Math.min(y0, y) > max)) {
                out.push(x0, y0, x1, y1, len);
                open = false;
                if (!jump && have) { x0 = x1 = px; y0 = y1 = py; len = 0; open = true; }
            }
            if (!open) { if (jump) starts.push(out.length / 5); x0 = x1 = x; y0 = y1 = y; len = 0; open = true; }
            if (x < x0) x0 = x; else if (x > x1) x1 = x;
            if (y < y0) y0 = y; else if (y > y1) y1 = y;
            len += dl;
            px = x; py = y; have = true;
        },
        end() { if (open) out.push(x0, y0, x1, y1, len); open = false; },
    };
}

/** A shape's loops walked once: chunks along the outline, each loop's first chunk, and the area and perimeter (meanWidth). */
function walkLoops(loops, max) {
    const c = chunker(max), step = max / 2;
    let area = 0, per = 0;
    for (const lp of loops) {
        const b = lp && lp.buf ? lp.buf : Loop.from(lp).buf;
        if (!b || b.length < 5) continue;
        let ax = b[0], ay = b[1];
        const sx = ax, sy = ay;
        let a = 0;
        c.put(ax, ay, true);
        for (let o = 2; o < b.length; o += REC[b[o]] || 8) {
            const code = b[o];
            let bx, by;
            if (code === 0 || code === 2) {
                bx = code === 0 ? b[o + 1] : b[o + 7]; by = code === 0 ? b[o + 2] : b[o + 8];
                const L = Math.hypot(bx - ax, by - ay);
                per += L;
                const n = Math.ceil(L / step);
                for (let s = 1; s < n; s++) c.put(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n, false);
            } else {
                const cx = b[o + 1], cy = b[o + 2], r = b[o + 3], a0 = b[o + 4], sw = b[o + 5];
                bx = code === 3 ? b[o + 14] : b[o + 6]; by = code === 3 ? b[o + 15] : b[o + 7];
                const L = Math.abs(r * sw);
                per += L;
                a += (r * r * segmentTerm(sw)) / 2;
                const n = Math.ceil(L / step);
                for (let s = 1; s < n; s++) { const th = a0 + (sw * s) / n; c.put(cx + r * Math.cos(th), cy + r * Math.sin(th), false); }
            }
            a += ((ax - sx) * (by - sy) - (bx - sx) * (ay - sy)) / 2;
            c.put(bx, by, false);
            ax = bx; ay = by;
        }
        area += a;
    }
    c.end();
    return { out: c.out, loops: c.starts, area: Math.abs(area), per };
}
/** Chunks along polylines; `closed`, each ring's first chunk too (the index runs around it). */
function walkPoly(rings, max, closed) {
    const c = chunker(max), step = max / 2;
    for (const pts of rings) {
        if (!pts || !pts.length) continue;
        let [ax, ay] = pts[0];
        c.put(ax, ay, true);
        const n = pts.length + (closed ? 1 : 0);
        for (let i = 1; i < n; i++) {
            const [bx, by] = pts[i % pts.length];
            const L = Math.hypot(bx - ax, by - ay), k = Math.ceil(L / step);
            for (let s = 1; s < k; s++) c.put(ax + ((bx - ax) * s) / k, ay + ((by - ay) * s) / k, false);
            c.put(bx, by, false);
            ax = bx; ay = by;
        }
    }
    c.end();
    return { out: c.out, loops: closed ? c.starts : null };
}
const boxSize = (out) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < out.length; i += 5) { x0 = Math.min(x0, out[i]); y0 = Math.min(y0, out[i + 1]); x1 = Math.max(x1, out[i + 2]); y1 = Math.max(y1, out[i + 3]); }
    return Number.isFinite(x0) ? Math.max(x1 - x0, y1 - y0) : 0;
};

/**
 * An object as the index sees it (§6 rule 2): `w`, the width it counts with, in its home's units —
 * a shape's thickness now (meanWidth) capped at its pen, a stroke's pen, a pen-less fill its size
 * as one chunk — `raw`, its chunk records (Float64Array: x0, y0, x1, y1, len, in stored
 * coordinates), and `loops`, the first chunk of each closed loop (an outline, a fill's ring; null
 * for a raw stroke's open centreline). Computed when asked (nothing is kept on the object): the
 * client asks only for an object the index has not got or whose geometry changed.
 */
export function sceneGeom(o) {
    let w, walk = null;
    for (let grow = 1; grow < 1e9; grow *= 2) {
        if (o.type === "shape" && o.loops) {
            if (w == null) {
                // one walk at the pen's chunk size; a second only where the piece is much thinner than its pen
                const first = walkLoops(o.loops, o.w > 0 ? CHUNK * o.w : Infinity);
                const mw = first.per > 0 ? (2 * first.area) / first.per : 0;
                w = o.w > 0 ? Math.max(Math.min(o.w, mw), o.w * 1e-6) : Math.max(boxSize(first.out), 1e-12) / CHUNK;
                if (o.w > 0 && (w >= o.w / 2 || first.out.length <= 5)) { walk = first; w = w || o.w; if (walk.out.length / 5 <= MAX_CHUNKS) break; }
            }
            walk = walkLoops(o.loops, CHUNK * w * grow);
        } else if (o.type === "stroke" && o.pts) {
            if (w == null) w = o.lwFrame > 0 ? o.lwFrame : 1e-9;
            walk = walkPoly([o.pts], CHUNK * w * grow, false);
        } else if (o.type === "fill" && o.polys) {
            if (w == null) w = Math.max(boxSize(walkPoly(o.polys, Infinity, true).out), 1e-12) / CHUNK;
            walk = walkPoly(o.polys, CHUNK * w * grow, true);
        } else return null;
        if (walk.out.length / 5 <= MAX_CHUNKS) break;
    }
    const out = walk && walk.out;
    if (!out || !out.length) return null;
    for (let i = 4; i < out.length; i += 5) if (!(out[i] > 0)) out[i] = w;   // a dot still has ink
    const lp = walk.loops;
    return { w, raw: Float64Array.from(out), loops: !lp || !lp.length ? null : lp.length === 1 && lp[0] === 0 ? ONE_LOOP : lp.slice() };
}

/**
 * Ink the index holds: not an eraser mark, not a stroke still being drawn, and not a ceded patch
 * (storage, §6 row 14) while its family keeps ink outside patches — with none left, the patch is
 * the drawing (review 2026-09-22).
 */
const isInk = (doc, o) => !!o && !o.erase && !doc._pending.has(o) && (o.attachRect == null || orphanPatch(doc, o));
const orphanPatch = (doc, o) => {
    for (const r of doc.editGroup(o)) if (r.obj !== o && !r.obj.erase && r.obj.attachRect == null) return false;
    return true;
};

export class SceneClient {
    /** @param {object} E the engine @param {{worker?: boolean}} [opts] worker: false forces the inline index */
    constructor(E, { worker = true } = {}) {
        this.E = E; this.doc = E.doc; this.lm = E.lm;
        this.useWorker = worker;
        this.dirty = new Set();
        this.attr = new Set();           // ids whose z changed: their scene's picture key moves on
        this.goneFrames = new Set();     // frames removed since the last batch: their ids are dirty at the flush
        this.patchFam = new Set();       // family keys with a ceded patch: an add or remove in one re-checks its patches
        this.famDirty = new Set();
        this.hints = new Map();          // new id -> the id it replaced (an erase's pieces)
        this.foot = new Map();           // footprint id (its first host piece) -> footprint (§6 row 14b)
        this.footDirty = false;
        this.footMax = FOOT_MAX; this.footChunks = FOOT_CHUNKS;
        this.renames = [];
        // what the index holds of each object: id -> a record slot in columns of its width, table
        // residual and home (an index into `homes`); no chunks (they are re-made from the object
        // when its geometry changes, `geom`)
        this.sent = new Map();
        this.recW = new Float64Array(1024); this.recTX = new Float64Array(1024); this.recTY = new Float64Array(1024);
        this.recHO = new Int32Array(1024); this.recTop = 0; this.recFree = [];
        this.homes = new Map(); this.homeOf = [];     // frame id <-> small integer
        this.geom = new Set();           // ids whose geometry changed since the index got it
        this.fsent = new Map();          // footprint item id -> { raw, home, tx, ty } as the index holds it
        this.markGeo = new Map();        // eraser mark id -> its chunks (a gesture cuts many objects)
        this.frameKeys = new Map();      // frame id -> a copy of its record as sent
        this.export = null;              // the index's saved state, as of the last batch
        this.inflight = null;            // { ids, gen, restore } while a batch is out
        this.gen = 0;                    // bumped by every restore: a result from an earlier document is dropped
        this.frameEv = 0;                // bumped by every frame event and settle: a prep that spans one is folded
        this.resync = null;              // { kind, ids, i, items } while a full restore is being prepared
        this.pending = null;             // { ids, i, items } while a batch is being prepared
        this.core = null; this.remote = null;
        this.timer = null; this.idleId = null; this.waitSince = 0;
        this.destroyed = false;
        this.listeners = new Set();
        this.stats = { batches: 0, items: 0, prepMs: 0, applyMs: 0, lastApplyMs: 0, lastPrepMs: 0, lastItems: 0, restores: 0 };
        this._unsub = this.doc.subscribe((ev) => this._onEvent(ev));
        this._unsubOps = this.doc.subscribeOps((ev) => this._onOp(ev));
    }
    destroy() {
        this.destroyed = true;
        this._cancel();
        if (this._unsub) this._unsub();
        if (this._unsubOps) this._unsubOps();
        if (this.remote) this.remote.terminate();
        this.remote = null; this.core = null;
    }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    // ---- events ----
    _onEvent(ev) {
        switch (ev.kind) {
            case "reset":
                this._startResync(ev.load ? "load" : "reset");
                return;
            case "add":
                if (ev.live) return;   // a stroke being drawn waits for its finalize
                this.dirty.add(ev.id); this._family(ev.obj); break;
            case "finalize": case "remove":
                if (ev.kind === "remove") this.markGeo.delete(ev.id);
                this.dirty.add(ev.id); this._family(ev.obj); break;
            case "change":
                if (ev.attrOnly) { this.attr.add(ev.id); break; }
                if (!ev.offsetsOnly) { this.geom.add(ev.id); this.markGeo.delete(ev.id); }   // the geometry changed
                this.dirty.add(ev.id); break;
            case "mergeFrame": case "splitFrame":
                this.frameEv++;
                for (const id of ev.ids || []) this.dirty.add(id);
                break;
            case "removeFrame":
                this.frameEv++;
                this.goneFrames.add(ev.frame);
                break;
            case "addFrame":
                this.frameEv++;
                for (const o of this.doc.list(ev.frame)) this.dirty.add(o.id);
                break;
            case "refile": this.frameEv++; break;   // the frame diff at the flush
            default: break;
        }
        this._schedule();
    }
    /** A native added to or gone from a family with patches: the patches are re-checked (isInk). */
    _family(o) {
        if (!o || !this.patchFam.size) return;
        const k = this.doc.editKey(o);
        if (this.patchFam.has(k)) this.famDirty.add(k);
    }
    _onOp(ev) {
        if (ev.kind === "settle") { this.frameEv++; return; }   // its natives' change events follow
        // A fresh action ends the redo branch: an undone gesture's footprints can never come back.
        if (ev.kind === "op") {
            for (const fp of this.foot.values()) if (fp.off && !fp.drop) { fp.drop = true; this.footDirty = true; }
            if (this.footDirty) this._schedule();
            return;
        }
        // An eraser gesture undone takes its footprints out; redone, puts them back.
        if ((ev.kind === "undo" || ev.kind === "redo") && ev.op && ev.op.strokeId != null) {
            for (const fp of this.foot.values()) {
                if (fp.e !== ev.op.strokeId) continue;
                fp.off = ev.op.op === "eraseRevert"; this.footDirty = true;
            }
            if (this.footDirty) this._schedule();
            return;
        }
        // An erase's pieces keep the scene of what they replaced (storage, not new ink, §6 row 14).
        if (ev.kind !== "bake" || !ev.step || !ev.step.removed || !ev.step.pieces) return;
        const src = ev.step.removed.obj && ev.step.removed.obj.id;
        if (src == null) return;
        for (const pc of ev.step.pieces) if (pc && pc.obj) this.hints.set(pc.obj.id, src);
        if (ev.op && ev.op.strokeId != null) this._footprint(ev.op.strokeId, ev.step);
    }
    /**
     * §6 row 14b: an eraser FINER than the ink it cut is detail at its own width. Per cut, the mark's
     * chunks within its reach of the cut object become an index item (id −its first host piece), in
     * the stored coordinates of a surviving piece that hosts it: it moves with its host, goes with
     * the gesture's undo, and is dropped when no piece of the host's family is left in the frame.
     * One per cut, so a swipe across two drawings leaves two footprints and bridges nothing. A
     * coarser eraser is removal.
     */
    _footprint(markId, step) {
        const mark = this.doc.getById(markId);
        const src = step.removed.obj;
        if (!mark || !src || src.erase || src.attachRect != null) return;
        // the cut object's width as the index holds it (else computed); the mark's chunks kept for its gesture
        const rs = this.geom.has(src.id) ? undefined : this.sent.get(src.id);
        const g = rs != null ? { w: this.recW[rs] } : sceneGeom(src);
        let eg = this.markGeo.get(markId);
        if (!eg) { eg = sceneGeom(mark.obj); if (eg) this.markGeo.set(markId, eg); }
        if (!g || !eg) return;
        const HO = String(step.removed.level);
        const f = this.lm.frameFactor(mark.level, HO);
        const pen = mark.obj.w > 0 ? mark.obj.w : mark.obj.lwFrame;
        if (f == null || !(pen > 0) || !(pen * f < g.w)) return;
        const host = step.pieces.find((pc) => pc && pc.obj && String(pc.level) === HO && !pc.obj.erase);
        if (!host) return;
        const box = src.loops ? loopsBBox(src.loops) : null;
        if (!box) return;
        const w = pen * f, reach = REACH * w;
        const boxes = [];
        const raw = eg.raw;
        for (let i = 0; i < raw.length; i += 5) {
            const r = this.lm.mapRectObj({ left: raw[i], top: raw[i + 1], right: raw[i + 2], bottom: raw[i + 3] }, mark.level, HO, this.doc.tableOf(host.obj, HO), HO, true);
            if (!r || r.left - box.x1 > reach || box.x0 - r.right > reach || r.top - box.y1 > reach || box.y0 - r.bottom > reach) continue;
            boxes.push(r.left, r.top, r.right, r.bottom, raw[i + 4] * f);
        }
        if (!boxes.length) return;
        const fr = this.lm.frame(HO);
        this.foot.set(host.obj.id, { id: host.obj.id, e: markId, host: host.obj.id, key: this.doc.editKey(host.obj), home: HO, depth: fr ? fr.depth : null, w, boxes, off: false, raw: null, t: null });
        this.footDirty = true;
        this._capFoot();
    }
    /** At most FOOT_MAX footprints and FOOT_CHUNKS chunk records: the oldest are dropped (their scenes go with them). */
    _capFoot() {
        let n = 0, c = 0;
        for (const fp of this.foot.values()) if (!fp.drop) { n++; c += fp.boxes.length / 5; }
        for (const fp of this.foot.values()) {
            if (n <= this.footMax && c <= this.footChunks) break;
            if (fp.drop) continue;
            fp.drop = true; n--; c -= fp.boxes.length / 5; this.footDirty = true;
        }
    }
    /** The footprints' records for a batch: followed to their hosts, re-hosted in the family, dropped when none is left. */
    _footItems(items) {
        for (const fp of [...this.foot.values()]) {
            const id = -fp.id, s = this.fsent.get(id);
            if (fp.drop) {
                if (s) { items.push({ id, gone: true }); this.fsent.delete(id); }
                this.foot.delete(fp.id);
                continue;
            }
            let h = !fp.off && this.doc.getById(fp.host);
            if (h && String(h.level) !== fp.home) {
                // the host re-homed (a carry, a merged shadow): the same stored coordinates in a frame of the same depth
                const to = this.lm.frame(String(h.level));
                if (fp.depth == null) { const was = this.lm.frame(fp.home); fp.depth = was ? was.depth : null; }
                if (to && to.depth === fp.depth) fp.home = String(h.level);
            }
            if (!fp.off && (!h || String(h.level) !== fp.home)) {
                const t0 = h ? ownT(h.obj) : null;
                const heir = this.doc.editGroup(fp.key).find((r) => String(r.level) === fp.home && !r.obj.erase
                    && String(ownT(r.obj)) === String(t0 || fp.t || null));
                if (heir) { fp.host = heir.obj.id; h = heir; } else h = null;
            }
            if (!h || !fp.boxes.length) {
                if (s) { items.push({ id, gone: true }); this.fsent.delete(id); }
                if (!fp.off && !h) this.foot.delete(fp.id);
                continue;
            }
            const t = ownT(h.obj);
            fp.t = t ? [t[0], t[1]] : null;
            const tx = t ? t[0] : 0, ty = t ? t[1] : 0;
            if (!fp.raw) fp.raw = Float64Array.from(fp.boxes);
            if (s && s.raw === fp.raw && s.home === fp.home && s.tx === tx && s.ty === ty) continue;
            const rec = { id, home: fp.home, w: fp.w, t: t ? [tx, ty] : null };
            if (!s || s.raw !== fp.raw) rec.raw = fp.raw;
            items.push(rec);
            this.fsent.set(id, { raw: fp.raw, home: fp.home, tx, ty });
        }
        this.footDirty = false;
    }

    // ---- scheduling ----
    _cancel() {
        if (this.timer != null) { clearTimeout(this.timer); this.timer = null; }
        if (this.idleId != null && typeof cancelIdleCallback === "function") cancelIdleCallback(this.idleId);
        this.idleId = null;
    }
    _schedule(delay = 30) {
        if (this.destroyed || this.timer != null || this.idleId != null) return;
        if (typeof requestIdleCallback === "function") {
            this.idleId = requestIdleCallback((dl) => {
                this.idleId = null;
                const t0 = now();
                this._tick(dl);
                if (this.E && this.E._perf) this.E._perf("sceneTick", t0, false);
            }, { timeout: SCENE_IDLE_TIMEOUT_MS });
        } else {
            this.timer = setTimeout(() => { this.timer = null; this._tick(null); }, delay);
        }
    }
    /** Is the engine doing something the index must wait behind? */
    _busy() {
        const E = this.E;
        if (E._drawing || E._dragSel || E._lasso || E._destroyed) return true;
        if (E._panLast || (E._camBusy && E._camBusy())) return true;   // a pan or a zoom (SC-1)
        if (this.waitSince && now() - this.waitSince > MAX_WAIT_MS) return false;
        if (E._eraseBusy && E._eraseBusy()) return true;
        if (E.raster) {
            try { const r = rasterWorkerReport(); if (r.queued || r.inFlight) return true; } catch (err) { /* diagnostics only */ }
        }
        return false;
    }
    _tick(deadline) {
        if (this.destroyed || this.inflight) return;
        if (this._busy()) {
            if (!this.waitSince) this.waitSince = now();
            this.timer = setTimeout(() => { this.timer = null; this._schedule(); }, 150);   // back through idle time
            return;
        }
        this.waitSince = 0;
        const budget = deadline && deadline.timeRemaining ? Math.max(4, Math.min(SLICE_MS, deadline.timeRemaining())) : SLICE_MS;
        if (this.resync) {
            if (!this._resyncWanted()) return;
            if (!this._resyncStep(budget)) this._schedule();
            return;
        }
        if (!this.pending) {
            if (!this._hasWork()) return;
            this._takeGone();
            this.pending = { ids: [...this.dirty], i: 0, items: [], fev: this.frameEv };
            this.dirty.clear();
        }
        if (!this._prepStep(this.pending, budget)) { this._schedule(); return; }
        const p = this.pending;
        this.pending = null;
        this._sendPrepared(p);
    }
    /**
     * Send a prepared batch. Frame records are read now and item tables were read per slice: after
     * a frame event during the prep (a settle moves a frame's shift into its natives' tables) the
     * ids it dirtied are prepared into the batch first, or its halves disagree (review minor 9).
     */
    _sendPrepared(p) {
        if (p.fev !== this.frameEv) { this._takeGone(); if (this.dirty.size) this._fold(p); }
        if (this.attr.size) {
            const has = new Set(p.items.map((r) => r.id));
            for (const id of this.attr) if (!has.has(id) && this.sent.has(id)) p.items.push({ id, attr: true });
            this.attr.clear();
        }
        if (this.foot.size) this._footItems(p.items);
        this._send({ frames: this._frameDiff(), items: p.items, renames: this.renames.splice(0) }, p.ids);
    }
    /** Anything for the next batch: ids, a z change, names, footprints, a frame? */
    _hasWork() {
        return !!(this.dirty.size || this.attr.size || this.goneFrames.size || this.famDirty.size || this.renames.length || this.footDirty || this._framesChanged());
    }
    /**
     * The ids homed in frames removed since the last batch (one pass over `sent` for them all), and
     * the patches of families that gained or lost a native, dirty.
     */
    _takeGone() {
        if (this.goneFrames.size) {
            const gone = new Set();
            for (const f of this.goneFrames) { const h = this.homes.get(f); if (h != null) gone.add(h); }
            if (gone.size) for (const [id, rs] of this.sent) if (gone.has(this.recHO[rs])) this.dirty.add(id);
            this.goneFrames.clear();
        }
        for (const k of this.famDirty) for (const r of this.doc.editGroup(k)) if (r.obj.attachRect != null) this.dirty.add(r.obj.id);
        this.famDirty.clear();
    }
    /** The dirty ids prepared into `st` now, one record per id (a later record keeps an earlier one's raw and hint). */
    _fold(st) {
        const f = { ids: [...this.dirty], i: 0, items: [] };
        this.dirty.clear();
        this._prepStep(f, Infinity);
        const at = new Map();
        st.items.forEach((r, i) => at.set(r.id, i));
        for (const r of f.items) {
            const i = at.get(r.id);
            if (i == null) { at.set(r.id, st.items.length); st.items.push(r); continue; }
            const was = st.items[i], m = { ...r };
            if (!r.gone && !was.gone) {
                if (!m.raw && was.raw) { m.raw = was.raw; if (was.loops) m.loops = was.loops; }
                if (m.hint == null && was.hint != null) m.hint = was.hint;
            }
            st.items[i] = m;
        }
        for (const id of f.ids) st.ids.push(id);
    }
    /** Inline and large, a load waits until someone asks for the scenes. */
    _resyncWanted() {
        if (this._forced) return true;
        if (this._mode() === "worker") return true;
        let n = 0;
        for (const L of this.doc.levels()) n += this.doc.count(L);
        return n <= INLINE_AUTO_MAX;
    }
    _mode() {
        if (this.remote) return "worker";
        if (this.core) return "inline";
        if (this.useWorker) { this.remote = openSceneWorker(); if (this.remote) return "worker"; }
        this.core = new SceneIndex();
        return "inline";
    }

    // ---- item records ----
    /** Prepare records for `st.ids` until the budget runs out; true when done. */
    _prepStep(st, budget) {
        const t0 = now();
        const doc = this.doc;
        while (st.i < st.ids.length) {
            const id = st.ids[st.i++];
            const rec = doc.getById(id);
            const o = rec && rec.obj;
            const s = this.sent.get(id);
            if (o && o.attachRect != null && !o.erase) this.patchFam.add(doc.editKey(o));
            const ink = isInk(doc, o), fresh = s === undefined || this.geom.has(id);
            const g = ink && fresh ? sceneGeom(o) : null;
            this.geom.delete(id);
            if (!ink || (fresh && !g)) {
                if (s !== undefined) { st.items.push({ id, gone: true }); this.sent.delete(id); this.recFree.push(s); }
                this.hints.delete(id);
            } else {
                const t = ownT(o);
                const tx = t ? t[0] : 0, ty = t ? t[1] : 0, home = o._home, ho = this._homeIx(home);
                const w = g ? g.w : this.recW[s];
                if (fresh || this.recW[s] !== w || this.recHO[s] !== ho || this.recTX[s] !== tx || this.recTY[s] !== ty) {
                    const r = { id, home, w, t: t ? [tx, ty] : null };
                    if (fresh) { r.raw = g.raw; if (g.loops) r.loops = g.loops; }
                    const h = this.hints.get(id);
                    if (s === undefined && h != null) r.hint = h;
                    st.items.push(r);
                    const k = s !== undefined ? s : this._recSlot();
                    this.recW[k] = w; this.recTX[k] = tx; this.recTY[k] = ty; this.recHO[k] = ho;
                    if (s === undefined) this.sent.set(id, k);
                }
                this.hints.delete(id);
            }
            if ((st.i & 63) === 0 && now() - t0 > budget) break;
        }
        this.stats.prepMs += now() - t0;
        this.stats.lastPrepMs = (st.prepMs = (st.prepMs || 0) + (now() - t0));
        return st.i >= st.ids.length;
    }
    /** A record slot in the columns (grown by doubling). */
    _recSlot() {
        if (this.recFree.length) return this.recFree.pop();
        const k = this.recTop++;
        if (k >= this.recW.length) {
            const n = this.recW.length * 2, grow = (A) => { const B = new A.constructor(n); B.set(A); return B; };
            this.recW = grow(this.recW); this.recTX = grow(this.recTX); this.recTY = grow(this.recTY); this.recHO = grow(this.recHO);
        }
        return k;
    }
    _homeIx(home) {
        let h = this.homes.get(home);
        if (h == null) { h = this.homeOf.length; this.homes.set(home, h); this.homeOf.push(home); }
        return h;
    }
    _frameRec(f) {
        return { id: f.id, parent: f.parent == null ? null : f.parent, depth: f.depth,
            cx: f.centre ? f.centre.x : 0, cy: f.centre ? f.centre.y : 0,
            sx: f.shift ? f.shift[0] : 0, sy: f.shift ? f.shift[1] : 0 };
    }
    /** Is `r`, the record last sent, still frame `f`? Field by field: a string key a frame a tick was the cost (SC-2). */
    _sameFrame(r, f) {
        return !!r && r.parent === (f.parent == null ? null : f.parent) && r.depth === f.depth
            && r.cx === (f.centre ? f.centre.x : 0) && r.cy === (f.centre ? f.centre.y : 0)
            && r.sx === (f.shift ? f.shift[0] : 0) && r.sy === (f.shift ? f.shift[1] : 0);
    }
    _framesChanged() {
        if (this.frameKeys.size !== this.lm.frames.size) return true;
        for (const f of this.lm.frames.values()) if (!this._sameFrame(this.frameKeys.get(f.id), f)) return true;
        return false;
    }
    _frameDiff() {
        const out = [];
        for (const f of this.lm.frames.values()) {
            if (this._sameFrame(this.frameKeys.get(f.id), f)) continue;
            const r = this._frameRec(f);
            out.push(r); this.frameKeys.set(f.id, { ...r });
        }
        for (const id of [...this.frameKeys.keys()]) if (!this.lm.frames.has(id)) { out.push({ id, gone: true }); this.frameKeys.delete(id); }
        return out;
    }

    // ---- restore ----
    /** A full restore: `kind` "load" (a file: its own index), "reset" (the same document: `state`, else the last export). */
    _startResync(kind, state) {
        this._cancel();
        this.gen++;
        this.inflight = null;            // a batch still out belongs to the document before
        this.pending = null;
        this.dirty.clear(); this.attr.clear(); this.goneFrames.clear(); this.famDirty.clear(); this.patchFam.clear();
        this.hints.clear(); this.frameKeys.clear();
        this.sent.clear(); this.recTop = 0; this.recFree = []; this.geom.clear(); this.fsent.clear(); this.markGeo.clear();
        this.resync = { kind, ids: null, i: 0, items: [], fev: this.frameEv, state: kind === "reset" ? (state !== undefined ? state : this.export) : undefined };
        if (kind === "load") { this.export = null; this.foot = new Map(); }
        this._schedule();
    }
    /** The saved footprints (a load; the list follows the file's `sceneIndex.erase`). */
    _loadFoot(list) {
        this.foot = new Map();
        for (const e of Array.isArray(list) ? list : []) {
            if (!e || !Number.isInteger(e.id) || !Array.isArray(e.raw) || e.raw.length % 5 || !(e.w > 0)) continue;
            const fr = this.lm.frame(String(e.home));
            this.foot.set(e.id, { id: e.id, e: e.e, host: e.host, key: e.key, home: String(e.home), depth: fr ? fr.depth : null, w: e.w, boxes: e.raw.slice(), off: !!e.off, raw: null, t: null });
        }
        this._capFoot();
        this.footDirty = this.foot.size > 0;
    }
    _resyncStep(budget) {
        const r = this.resync;
        if (r.kind === "load" && !r.footRead) {
            // the file's footprints (a load reset fires before loadDrawing sets docMeta)
            r.footRead = true;
            const saved = this.E.docMeta && this.E.docMeta.sceneIndex;
            this._loadFoot(saved && saved.erase);
        }
        if (!r.ids) {
            r.ids = [];
            for (const L of this.doc.levels()) for (const o of this.doc.list(L)) r.ids.push(o.id);
            this.dirty.clear();
        }
        if (!this._prepStep(r, budget)) return false;
        if (r.fev !== this.frameEv && this.dirty.size) this._fold(r);
        this.resync = null;
        const restore = {};
        const meta = this.E.docMeta || {};
        const saved = r.kind === "load" ? meta.sceneIndex : r.state || meta.sceneIndex;
        if (saved && saved.v === 3 && Array.isArray(saved.scenes)) restore.state = saved;
        else {
            // an old file: a fresh build that lends the old scenes' ids and names by overlap (v2 rows only:
            // a v3 part's or region's id would collide with the index's own)
            const old = (meta.scenes || []).filter((s) => !s.kind && /^s\d+$/.test(String(s.id))).map((s) => {
                const f = this.lm.frameFor(s.level);
                const seq = parseInt(String(s.id).replace(/^s/, ""), 10);
                return f && s.rect ? { id: s.id, seq: Number.isFinite(seq) ? seq : 0, name: s.name, named: !!s.pinned, anchor: f.id, rect: { ...s.rect } } : null;
            }).filter(Boolean);
            restore.legacy = old;
            restore.seq = Math.max(meta.sceneSeq || 1, ...old.map((s) => s.seq + 1), 1);
        }
        this.frameKeys.clear();
        const frames = this._frameDiff();
        if (this.foot.size) this._footItems(r.items);
        this.stats.restores++;
        this._send({ restore, frames, items: r.items, renames: this.renames.splice(0) }, r.ids);
        return true;
    }

    // ---- the index ----
    _send(batch, ids) {
        const mode = this._mode();
        this.stats.batches++;
        this.stats.lastItems = batch.items.length;
        this.stats.items += batch.items.length;
        if (mode === "inline") {
            let out;
            try { out = this.core.apply(batch); } catch (err) { this._failed(err, batch, ids); return; }
            this._landed(out);
            return;
        }
        const gen = this.gen;
        this.inflight = { ids, gen, restore: !!batch.restore, state: batch.restore ? batch.restore.state || null : null, t0: now() };
        this.remote.post(batch).then((out) => {
            if (this.destroyed || gen !== this.gen) return;   // another document since: dropped
            this.inflight = null;
            this._landed(out);
        }, (err) => {
            if (this.destroyed || gen !== this.gen) return;
            this.inflight = null;
            // The worker failed: it goes (with its index) and the index restarts from the last saved
            // state in a new one, SCENE_WORKER_RESPAWNS times, then inline (a 1.2–2.5 s restore at the
            // next panel open on the Magnum Opus; REVIEWER-2 SC-3).
            try { if (this.remote) this.remote.terminate(); } catch (e) { /* already gone */ }
            this.remote = null;
            this.workerFails = (this.workerFails || 0) + 1;
            if (this.workerFails > SCENE_WORKER_RESPAWNS) this.useWorker = false;
            this._failed(err, batch, ids);
        });
    }
    /**
     * The index failed on `batch`: rebuilt from the last saved state (the file's while there is no
     * export), with the failed batch's ids and everything dirty since listed `dirty`, so they are
     * indexed again by the ordinary rule; a failed restore is retried from the state it carried.
     */
    _failed(err, batch, ids) {
        try { console.warn("scene index failed; rebuilding", err); } catch (e) { /* ignore */ }
        this.core = null;
        if (batch && batch.restore) { this._startResync("reset", batch.restore.state || null); return; }
        const base = this.export || (this.E.docMeta && this.E.docMeta.sceneIndex) || null;
        const again = new Set(base && base.dirty ? base.dirty : []);
        for (const id of ids || []) again.add(id);
        for (const id of this.dirty) again.add(id);
        if (this.pending) for (const id of this.pending.ids) again.add(id);
        const state = base ? { ...base, dirty: [...again].filter((id) => Number.isInteger(id) && id >= 0) } : null;
        this._startResync("reset", state);
    }
    _landed(out) {
        if (!out) return;
        this.export = out.export;
        this.stats.lastApplyMs = out.ms || 0;
        this.stats.applyMs += out.ms || 0;
        this.stats.lastStats = out.stats;
        this.E.docMeta = { ...this.E.docMeta, scenes: out.scenes };
        for (const fn of this.listeners) { try { fn(out); } catch (err) { /* a listener never breaks the index */ } }
        if (this._owed()) this._schedule();
    }
    /** Is anything waiting for the next batch (a restore, ids, names, footprints, a frame)? */
    _owed() {
        return !!(this.resync || this.pending || this._hasWork());
    }

    // ---- the engine's calls ----
    /**
     * Bring the index up to date now: inline, synchronously (a restore included); with a worker,
     * as soon as it is free. Returns whether the scenes are current.
     */
    flushNow() {
        if (this.destroyed) return false;
        const E = this.E;
        if (E._drawing || E._dragSel || E._lasso) { this._schedule(); return false; }   // never inside a gesture
        this._forced = true;
        try {
            if (this._mode() !== "inline") { this._cancel(); this._schedule(0); return false; }
            for (let guard = 0; guard < 1000; guard++) {
                if (this.resync) { this._resyncStep(Infinity); continue; }
                if (this.pending) {
                    this._prepStep(this.pending, Infinity);
                    const p = this.pending; this.pending = null;
                    this._sendPrepared(p);
                    continue;
                }
                if (this._hasWork()) {
                    this._takeGone();
                    const st = { ids: [...this.dirty], i: 0, items: [], fev: this.frameEv };
                    this.dirty.clear();
                    this._prepStep(st, Infinity);
                    this._sendPrepared(st);
                    continue;
                }
                break;
            }
            return true;
        } finally { this._forced = false; }
    }
    /** A user's name for a scene: shown at once, the index takes it with the next batch. */
    rename(id, name) {
        const list = this.E.docMeta.scenes || [];
        const s = list.find((x) => x.id === id);
        if (!s || typeof name !== "string" || !name.trim()) return false;
        const nm = name.trim().slice(0, 120);
        this.E.docMeta = { ...this.E.docMeta, scenes: list.map((x) => (x.id === id ? { ...x, name: nm, pinned: true, auto: false } : x)) };
        this.renames.push([id, nm]);
        this._schedule(0);
        return true;
    }
    /**
     * The saved state for a file: the index's last export (or, before the first restore, the
     * file's own) with the names given since, and every id not yet indexed in `dirty` — a load
     * inserts those by the ordinary rule.
     */
    exportForSave() {
        const base = this.export || (this.E.docMeta && this.E.docMeta.sceneIndex) || null;
        if (!base) return null;
        const dirty = new Set(base.dirty || []);
        for (const id of this.dirty) dirty.add(id);
        if (this.pending) for (const id of this.pending.ids) dirty.add(id);
        if (this.inflight && !this.inflight.restore) for (const id of this.inflight.ids || []) dirty.add(id);
        // a restore's ids are the base's; what it carries as dirty (a rebuild after a failure) stays dirty
        const rs = this.resync ? this.resync.state : this.inflight && this.inflight.restore ? this.inflight.state : null;
        if (rs && rs.dirty) for (const id of rs.dirty) dirty.add(id);
        let scenes = base.scenes;
        if (this.renames.length) {
            const names = new Map(this.renames);
            scenes = scenes.map((s) => (names.has(s.id) ? { ...s, name: names.get(s.id), named: true } : s));
        }
        // an undone gesture's footprints too: the op log brings the redo back after a load
        const erase = [...this.foot.values()].filter((fp) => !fp.drop && fp.boxes.length).map((fp) => {
            const e = { id: fp.id, e: fp.e, host: fp.host, key: fp.key, home: fp.home, w: fp.w, raw: fp.boxes.slice() };
            if (fp.off) e.off = true;
            return e;
        });
        return { ...base, scenes, dirty: [...dirty].filter((id) => Number.isInteger(id) && id >= 0), erase };
    }
}
