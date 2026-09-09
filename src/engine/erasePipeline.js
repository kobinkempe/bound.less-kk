/**
 * The eraser, and the resumable baking behind it.
 *
 * An eraser stroke commits INSTANTLY as background-coloured ink: z-order alone
 * makes the picture correct everywhere, because it covers exactly what was
 * below it when drawn. Baking then folds that mark into each object beneath -
 * boolean-subtracting its resolved arc perimeter from theirs, in that object's
 * own home frame - ONE slice at a time, so the interface never stalls. Every
 * phase is resumable (F9), which is what makes an unbounded erase safe.
 *
 * When a cut lands DEEPER than an object's home frame it cannot be baked in at
 * all; the surviving ink re-homes instead (`_bakeRehome`), and the family that
 * results is tracked by contact across the shared tile edge - the moment that
 * contact becomes a single point, the family parts (F26).
 *
 * THE INVARIANT: an erase never removes more than the eraser swept.
 * `docs/erase-tile-window-design-bible.md` is the reasoning; the erase suites
 * are the enforcement.
 *
 * Mixed into `KobinEngine.prototype` - see `mixin.js`. Split out of
 * `KobinEngine.js` on 2026-08-31.
 */
import { perfNow } from "./now";
import { ArcBakeJob, bakeArcPerimeter } from "./geometry/arcPerimeter";
import {
    R as CROSS_RATIO,
    W as FRAME_W,
} from "./frameLattice";
import Document from "./Document";
import { Groups, arcsTouch, contactArcs } from "./geometry/connect";
import { bboxOf, freezeR } from "./geometry/derive";
import {
    dropDust,
    flattenShape,
    intersectShape,
    loopsArea,
    loopsBBox,
    repairLoops,
} from "./geometry/arcShape";
import { flattenLoops, strokeLoops } from "./geometry/curveOutline";
import { cutJob, dustBarFor } from "./eraseJob";
import { runCutAsync, runDescentAsync } from "./eraseWorkerClient";
import { descentJob } from "./eraseDescent";
import { rectSpan, rectTol } from "./rectMath";

const ERASE_SLICE_MS = 8;

// The camera counts as BUSY for this long after the last zoom. Reported
// 2026-08-20 as "erase-then-zoom feels clunky": `_bakeTick` stood aside for
// drawing, erasing, drag-select and panning, but not for ZOOMING — so a bake
// backlog and a pinch competed for the same frames. Measured on the reported
// drawing: zoom idle 4 ms, zoom during a bake 484 ms median and 2,521 ms at
// worst. Zoom arrives as a stream of discrete events with no "gesture over"
// signal, so quiet time is the only end marker available.
const CAM_IDLE_MS = 120;
// ...but never stand aside FOREVER. Someone who keeps zooming would otherwise
// never see their erase finish, which is worse than a dropped frame.
const BAKE_STARVE_MS = 1500;

class ErasePipeline {

    // ---- erasers ----
    // Whole-object eraser (tool "erase"): removes the topmost object the point hits.
    eraseAt(sx, sy) {
        const id = this._hitTest(sx, sy);
        if (id == null) return false;
        if (!this._eraseWhole(id)) return false;
        this._render();
        return true;
    }
    _eraseWhole(id) {
        const family = this.doc.editGroup(id);
        if (!family.length) return false;
        if (family.length === 1 && family[0].obj.editId == null) {
            const rec = this.doc.removeById(id);
            if (!rec) return false;
            this.doc.pushUndo({ op: "erase", obj: rec.obj, level: rec.level, index: rec.index });
            return true;
        }
        const records = [];
        for (const member of family) {
            const rec = this.doc.removeById(member.obj.id);
            if (rec) records.push(rec);
        }
        if (!records.length) return false;
        this.doc.pushUndo({ op: "eraseMany", records });
        return true;
    }
    // ---- deferred erase baking ----
    // An eraser stroke commits instantly as background-colored ink; z-order
    // alone makes the picture correct everywhere (it covers only what was
    // below it when drawn). Baking then folds it into each object beneath —
    // boolean-subtracting its painted footprint from theirs, in that object's
    // home frame — ONE object per idle slice, so the UI never stalls. Baking
    // only has to beat the next SELECTION of an affected object: select()
    // flushes that one object's pending erasures synchronously first.
    setEraserSize(px) { this._eraserPx = Math.min(200, Math.max(2, +px || 16)); }
    _zOf(o) { return o.z != null ? o.z : o.id; }
    // Eraser gestures whose own perimeter has been resolved. An eraser that is
    // still raw is not skipped, it is simply not READY: `_bakeTick` resolves
    // perimeters before it touches erases, so it arrives here a tick later.
    _eraseStrokes() {
        const out = [];
        for (const k of this.doc.levels()) {
            for (const o of this.doc.at(k)) if (o.erase && o.type === "shape") out.push({ obj: o, level: k });
        }
        out.sort((a, b) => this._zOf(a.obj) - this._zOf(b.obj)); // oldest first
        return out;
    }
    /**
     * TEST/BARRIER: every pending perimeter resolve, run to completion.
     * The interactive path is `_bakeTick`, which slices; this is for tests and
     * for the selection barrier, both of which need the document settled before
     * they look at it.
     */
    flushBakes() {
        let guard = 0;
        for (;;) {
            this._ensureShapeBakes();
            if (!this._bakeJobs.length) break;
            while (this._stepShapeBakes(Infinity)) { if (guard++ > 100000) return; }
            if (guard++ > 100000) return;
        }
        if (this._renderPending) this._render();   // settled means painted, too
    }
    // Resolve one stroke's perimeter right now, cancelling any queued job for
    // it. Used where an erase has reached an object that has not baked yet.
    _forceBake(o) {
        if (o.type !== "stroke") return;
        const tol = o._tol > 0 ? o._tol : (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter;
        const res = bakeArcPerimeter(o.pts, o.lwFrame, { tol, centre: o._pen ? o._pen.arcs() : undefined });
        this._bakeQueued.delete(o.id);
        this._bakeJobs = this._bakeJobs.filter((j) => j.id !== o.id);
        this.doc.bakeShapeById(o.id, this._sealed(res, o.lwFrame), o.lwFrame);
    }
    /**
     * A perimeter is only a shape if it CLOSES.
     *
     * The bake has always counted the chains it could not close and has never
     * been asked. A stroke whose rails fail to stitch then gets stored as its
     * two rails plus the lenses between them: no boundary, no meaningful
     * winding, nothing painted, and a drawing that cannot be saved at all
     * because the file format validates closure. Kobin's document carries
     * exactly that — #418, a 39-unit pen, 338 pieces on one rail and 467 on the
     * other with 66 slivers in between — and it is the object he watched fade
     * out of existence.
     *
     * Refusing is not an option here the way it is for an erase: the stroke has
     * to become SOMETHING. So it is sealed — each chain closed with a straight
     * line, the dust dropped — which keeps the ink, keeps it saveable, and keeps
     * the damage to the one stroke that hit it.
     */
    _sealed(res, w) {
        const open = res && res.stats ? res.stats.openChains : 0;
        if (!open) return res.loops;
        this._bakeRepairs = (this._bakeRepairs || 0) + 1;
        // HOW MUCH edge was fabricated, not just that some was. A seal of a
        // fifth of the pen is invisible; one of 45% of the loop's perimeter is
        // the straight line across the middle of a stroke that Kobin reported.
        // The two read identically without this number, which is why the first
        // report of it took a day to place.
        const st = { open, loops: res.loops.length };
        const out = repairLoops(res.loops, w, st);
        this._lastBakeRepair = st;
        return out;
    }
    _doneSet(eid) {
        let s = this._bakeDone.get(eid);
        if (!s) { s = new Set(); this._bakeDone.set(eid, s); }
        return s;
    }
    _scheduleBake(delay = 400) {
        // One timer, and the SOONEST request wins. Shape bakes want to run
        // immediately and erase bakes want to wait; with a first-come-wins guard
        // a pending 400 ms erase timer would have delayed every stroke's shape
        // by that much.
        if (this._bakeTimer != null) {
            if (delay >= this._bakeDelay) return;
            clearTimeout(this._bakeTimer);
        }
        this._bakeDelay = delay;
        this._bakeTimer = setTimeout(() => {
            this._bakeTimer = null; this._bakeDelay = Infinity; this._bakeTick();
        }, delay);
    }

    // ---- shape baking (pen-up) ----
    // A drawn stroke is raw ink until its perimeter is resolved. The resolve is
    // a JOB with a cursor in it (geometry/arcPerimeter.js), stepped a few
    // milliseconds at a time, so a 6,800-point stroke never holds a frame — F9's
    // "one indivisible object per slice" is exactly the shape of freeze this
    // replaces.
    _queueBake(o) {
        if (this._bakeQueued.has(o.id)) return;
        const tol = o._tol > 0 ? o._tol : (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter;
        const job = new ArcBakeJob(o.pts, o.lwFrame, {
            tol,
            // The live pen already built this chain, one sample at a time, while
            // the user drew. Handing it over skips the single most expensive
            // phase of the bake.
            centre: o._pen ? o._pen.arcs() : undefined,
        });
        // `_pen` STAYS until the bake lands: it is what the renderer draws in
        // the meantime, so the ink does not change shape at pen-up and then
        // change again when the shape arrives.
        this._bakeQueued.add(o.id);
        this._bakeJobs.push({ id: o.id, job, w: o.lwFrame });
    }
    /**
     * INVARIANT 2, enforced (D9): an object never extends past its frame's
     * immediate neighbours.
     *
     * Everything the lattice promises about locality rests on this. A cell is
     * about three screens across at the shallowest in-level zoom, so a stroke
     * drawn in one gesture cannot normally break it — but a pointer dragged
     * while the canvas pans can, and one over-wide native would then reach
     * across cells the neighbour pickup does not look at and simply disappear
     * from views that should show it.
     *
     * Kobin's own answer: "it should just go into the parent frame immediately
     * after it is drawn." Promotion divides every coordinate by the crossing
     * ratio, a power of two, so it is a change of UNITS and not a loss of
     * relative precision — the object becomes a small, finely-detailed native
     * one level up, where the invariant holds with room to spare. Repeats until
     * it fits, which for any real gesture is never or once.
     */
    _promoteOversize(id) {
        for (let guard = 0; guard < 8; guard++) {
            const rec = this.doc.getById(id);
            if (!rec) return false;
            const b = bboxOf(rec.obj, this.store.live);
            if (!b) return false;
            if (Math.max(b.x1 - b.x0, b.y1 - b.y0) <= FRAME_W) return guard > 0;
            const pid = this.lm.ensureParent(rec.level);
            const f = this.lm.frame(rec.level);
            if (pid == null || !f || !f.centre) return guard > 0;
            const g = Document.scaleGeometry(Document.snapGeometry(rec.obj), 1 / CROSS_RATIO, 0, 0);
            // The cell's own origin sits at `centre` in the parent, so the
            // promoted coordinates are p/R + centre.
            const moved = Document.translateGeometry(g, f.centre.x, f.centre.y);
            const lw = rec.obj.lwFrame, w = rec.obj.w;
            this.doc.rehomeById(id, pid);
            this.doc.setGeometryById(id, moved);
            const cur = this.doc.getById(id);
            if (cur) {
                if (lw != null) cur.obj.lwFrame = lw / CROSS_RATIO;
                if (w != null) cur.obj.w = w / CROSS_RATIO;
            }
        }
        return true;
    }

    // Any stroke still raw — after a load, an undo/redo, or a job dropped
    // because its object had gone — gets a job. Cheap, and it is the only thing
    // guaranteeing no stroke is left unresolved forever.
    _ensureShapeBakes() {
        for (const k of this.doc.levels()) {
            for (const o of this.doc.at(k)) {
                if (o.type !== "stroke" || o === this._drawing) continue;
                this._queueBake(o);
            }
        }
    }
    /** One slice of shape baking. True if work remains. */
    _stepShapeBakes(budgetMs = 8) {
        const t0 = perfNow();
        let changed = false, promoted = false;
        while (this._bakeJobs.length) {
            const left = budgetMs - (perfNow() - t0);
            if (left <= 0) break;
            const entry = this._bakeJobs[0];
            const rec = this.doc.getById(entry.id);
            // Undone, erased, or already baked while the job sat in the queue.
            if (!rec || rec.obj.type !== "stroke") {
                this._bakeJobs.shift(); this._bakeQueued.delete(entry.id); continue;
            }
            if (!entry.job.step(left)) break;          // more slices needed
            this._bakeJobs.shift();
            this._bakeQueued.delete(entry.id);
            this.doc.bakeShapeById(entry.id, this._sealed(entry.job.result, entry.w), entry.w);
            if (this._promoteOversize(entry.id)) promoted = true;   // D9 / invariant 2
            changed = true;
        }
        // THE RESOLVED SHAPE DOES NOT RENDER ON ITS OWN (2026-09-07, roadmap
        // item 3). A pen-up rendered the raw stroke and this rendered the
        // perimeter a few milliseconds later, and every render walks every
        // group on screen — measured in jsdom at 1,000 strokes, 185 s of a
        // 203 s drawing session was those two renders per stroke. The
        // perimeter is the curve that was on screen already (the live pen
        // builds the same chain the bake resolves), so its picture waits for
        // whatever renders next: the next pen-up, a crossing, an undo, an
        // erase bake. `_render` clears the flag; `flushBakes` — the tests'
        // and the selection barrier's settle point — honours it. A promotion
        // (D9) renders at once: the object changed frames.
        if (changed) { if (promoted) this._render(); else this._renderPending = true; }
        return this._bakeJobs.length > 0;
    }
    /** Has the camera moved so recently that a bake slice would land on a frame? */
    _camBusy() {
        if (this._lastCamMove == null) return false;
        return perfNow() - this._lastCamMove < CAM_IDLE_MS;
    }
    _bakeTick() {
        // TIMED, because it was not. `_bakeTick` is the single largest piece of
        // untimed main-thread work in the engine: a slice is budgeted at 8 ms but
        // one object can cost far more (88 ms measured on a desktop, and a phone
        // is slower still), and until 2026-08-21 none of it reached a report.
        const tB = perfNow();
        try { this._bakeTickInner(); } finally { this._perf("bake", tB, false, { jobs: this._bakeJobs.length }); }
    }
    _bakeTickInner() {
        // Stay out of the user's way — retry when the pointer is idle.
        if (this._drawing || this._erasing || this._dragSel || this._panLast) { this._bakeHeldSince = this._bakeHeldSince || perfNow(); this._scheduleBake(120); return; }
        // Same courtesy for a live zoom, bounded so the backlog cannot starve.
        if (this._camBusy()) {
            const held = this._bakeHeldSince || (this._bakeHeldSince = perfNow());
            if (perfNow() - held < BAKE_STARVE_MS) { this._scheduleBake(CAM_IDLE_MS); return; }
        }
        this._bakeHeldSince = null;
        // Resolve perimeters first: an eraser cannot be subtracted until it has
        // one, and neither can the ink under it.
        if (!this._bakeJobs.length) this._ensureShapeBakes();
        if (this._stepShapeBakes()) { this._scheduleBake(0); return; }
        if (this._cutInflight) return;   // a cut is in the worker; its result reschedules the tick
        // Erase bakes take a TIME budget, like every other sliced job here, and
        // come back on the next tick rather than after a fixed nap.
        //
        // This used to bake ONE object per tick and then sleep 80 ms. A gesture
        // that crosses a crowded region touches a great many objects — 94 of
        // them in one of Kobin's, from a single stroke — so the ink took nearly
        // eight SECONDS to catch up with the gesture, with the white mark
        // sitting over the drawing the whole time and the erase visibly "not
        // baking". Same slice size as the perimeter bake, so a heavy erase costs
        // what a heavy stroke costs: smooth, and roughly ten times sooner.
        const t0 = perfNow();
        let changed = false, more = false, baked = 0, pending = false;
        for (const Erec of this._eraseStrokes()) {
            let guard = 0;
            let target = this._nextEraseTarget(Erec);
            while (target && guard++ < 10000) {
                // Look before leaping. The budget used to be tested only AFTER
                // an object was baked, so a slice sitting at 7.9 ms of its 8 ms
                // would happily start another — and one object can cost far more
                // than the whole budget (621 ms, measured on the report). Charge
                // the next object at what the last one actually cost.
                //
                // `baked` is load-bearing: a single object that costs MORE than
                // the whole budget must still run, or it is refused on every
                // tick forever and the erase never finishes. Caught by BS-3 —
                // the first draft of this guard deadlocked exactly that way.
                if (baked > 0 && (perfNow() - t0) + (this._eraseItemMs || 0) > ERASE_SLICE_MS) { more = true; break; }
                const it0 = perfNow();
                const outcome = this._bakeOne(Erec, target);
                if (outcome === "pending") { pending = true; break; }
                if (outcome) changed = true;
                this._eraseItemMs = perfNow() - it0;
                baked++;
                target = this._lowerMark(Erec, target);
                changed = true;   // the mark's z may have moved
                if (perfNow() - t0 >= ERASE_SLICE_MS) { more = true; break; }
            }
            if (more || pending) break;
            // Every object beneath is handled — the white stroke has served
            // its purpose; consume it silently (undo goes via its commit op).
            this._noteSpent(Erec.obj);
            this._keepDebugMark(Erec.obj);
            this.doc.removeById(Erec.obj.id);
            this._eraseCommits.delete(Erec.obj.id);
            this._bakeDone.delete(Erec.obj.id);
            changed = true;
            if (perfNow() - t0 >= ERASE_SLICE_MS) { more = true; break; }
        }
        if (changed) this._render();
        if (!pending && (more || this._eraseStrokes().length)) this._scheduleBake(0);
    }
    /**
     * The objects still to be handled under mark E, TOP-DOWN BY Z (Kobin, 2026-09-08:
     * the mark's z follows the bake down, so the picture and the move gate agree).
     * From the spatial index, not a walk of the document: on the 12,849-object canvas
     * the walk cost 0.6 ms an object, five minutes a mark and a second a pointer-up
     * (erase.stuck.probe.js). Reachability is the only depth bar — the cut lives in
     * the frame it was made in. A moved object (F41/F55) is indexed at its stored bits
     * and drawn elsewhere, so every one reachable is a candidate and the per-object
     * mapping in `_eraseMayTouch` decides. Rebuilt when the document changes (a bake
     * mints pieces; another mark's cut replaces a candidate); each candidate is
     * re-checked when its turn comes.
     */
    _candidatesUnder(Erec) {
        const E = Erec.obj, HE = Erec.level;
        const zE = this._zOf(E);
        let scan = E._zScan;
        if (scan && scan.rev === this.doc.rev && scan.z === zE) return scan;
        const done = this._doneSet(E.id);
        const list = [];
        const box = E.type === "shape" && E.loops ? loopsBBox(E.loops) : null;
        if (box) {
            const rectE = { left: box.x0, top: box.y0, right: box.x1, bottom: box.y1 };
            const seen = new Set();
            const consider = (o, k) => {
                if (o.erase || seen.has(o.id) || done.has(o.id)) return;
                if (this._zOf(o) >= zE) return;
                seen.add(o.id);
                list.push({ id: o.id, z: this._zOf(o), level: k });
            };
            for (const k of this.doc.levels()) {
                if (this.lm.frameFactor(k, HE) == null) continue;
                const r = this.lm.mapRectF(rectE, HE, k);
                if (r) for (const o of this.doc.queryRect(k, r)) consider(o, k);
            }
            for (const id of this.doc._offsetIds) {
                const rec = this.doc.getById(id);
                if (rec && this.lm.frameFactor(rec.level, HE) != null) consider(rec.obj, rec.level);
            }
            list.sort((a, b) => (b.z - a.z) || (b.id - a.id));
        }
        scan = { rev: this.doc.rev, z: zE, list, pos: 0 };
        E._zScan = scan;
        return scan;
    }
    // The next object to bake under mark E: the highest still under it that the
    // eraser's box reaches (`_eraseMayTouch`); the ones it misses are done.
    _nextEraseTarget(Erec) {
        const E = Erec.obj, HE = Erec.level;
        const done = this._doneSet(E.id);
        const scan = this._candidatesUnder(Erec);
        for (; scan.pos < scan.list.length; scan.pos++) {
            const c = scan.list[scan.pos];
            if (done.has(c.id)) continue;
            const rec = this.doc.getById(c.id);
            if (!rec || rec.obj.erase) continue;
            const o = rec.obj;
            if (this._zOf(o) >= this._zOf(E)) continue;
            if (this.lm.frameFactor(rec.level, HE) == null) { done.add(o.id); continue; }
            if (!this._eraseMayTouch(E, HE, o, rec.level)) { done.add(o.id); continue; }
            return { obj: o, level: rec.level };
        }
        return null;
    }
    /**
     * The mark's z steps down past what it has handled: baked objects and their
     * pieces (which inherit their parent's z) sit above it, so the white mark paints
     * only over ink still to be cut and the move gate is the z order. Held while an
     * unhandled object shares the z. Called by the tick only — the barrier bakes
     * out of order and must not lower it. Returns the next target.
     */
    _lowerMark(Erec, target) {
        const E = Erec.obj, zo = this._zOf(target.obj);
        const next = this._nextEraseTarget(Erec);
        if (next && this._zOf(next.obj) >= zo) return next;
        if (zo - 0.5 < this._zOf(E)) this.doc.setZById(E.id, zo - 0.5);
        return next;
    }
    // Proximity prefilter in the target's home frame. The subtract itself is the
    // arbiter and its no-op guard eats false hits, so this only has to be cheap
    // and never wrongly NEGATIVE: bounding boxes, per loop of the target so a
    // long diagonal stroke is not one big box.
    _eraseMayTouch(E, HE, o, HO) {
        if (E.type !== "shape" || !E.loops) return false;
        // Project the eraser's BOX, not its geometry. Every frame hop is a
        // uniform scale plus a translation, so a box maps to a box exactly —
        // and the box costs O(1) where `projectF` rebuilds one arc per piece.
        // This prefilter runs once per candidate object per scan, and the scan
        // runs once per object baked, so the old form was quadratic in the
        // drawing with the eraser's whole perimeter inside the inner loop: 128
        // ms per slice on a 241-object screen.
        if (E._eraseBox == null || E._eraseBoxVer !== (E._ver || 0)) {
            E._eraseBox = loopsBBox(E.loops);
            E._eraseBoxVer = E._ver || 0;
        }
        if (!E._eraseBox) return false;
        const eb = E._eraseBox;
        const r = this._eraserRectInto({ left: eb.x0, top: eb.y0, right: eb.x1, bottom: eb.y1 }, HE, o, HO);
        if (!r) return false;
        const b = { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
        const m = o.type === "stroke" ? (o.lwFrame || 0) / 2 : 0;
        const hits = (a) => b.x1 >= a.x0 - m && b.x0 <= a.x1 + m && b.y1 >= a.y0 - m && b.y0 <= a.y1 + m;
        if (o.type !== "shape") return hits(bboxOf(o, this.store.live));
        for (const loop of o.loops) {
            const lb = loopsBBox([loop]);
            if (lb && hits(lb)) return true;
        }
        return false;
    }
    /**
     * An eraser's rect, drawn in frame `HE`, in the coordinates object `o` is
     * STORED in at its home `HO`. With no table that is `mapRectF`, bit for
     * bit. A moved object (F41/F55) is drawn where its table says; the eraser
     * comes back the same way — the remainder off, then the exact chain from
     * the frame the picture was read from (`LevelMap.mapRectObj`).
     */
    _eraserRectInto(rect, HE, o, HO) {
        if (!o.below) return this.lm.mapRectF(rect, HE, HO);
        return this.lm.mapRectObj(rect, HE, HO, o.below, HO, true);
    }
    /** The same, for the eraser's LOOPS. */
    _eraserLoopsInto(loops, HE, o, HO) {
        return this.lm.projectLoopsObj(loops, HE, HO, o.below, HO, true);
    }
    // Resolve (or re-register) the gesture's undo op. Always call this BEFORE
    // touching the document: a bake that cannot record itself must not mutate
    // anything — unrecorded bakes were how duplicated, stacked geometry formed.
    // After a reload the commit map is empty, so resumed baking registers a
    // fresh op, which also makes a resumed erase undoable again.
    _eraseOp(E) {
        let op = this._eraseCommits.get(E.id);
        if (!op || op.op !== "eraseCommit") {
            op = { op: "eraseCommit", strokeId: E.id, strokeRec: null, baked: [] };
            this.doc.pushUndo(op);
            this._eraseCommits.set(E.id, op);
        }
        return op;
    }

    /**
     * Subtract eraser gesture E's shape from one object, silently (the document
     * changes ride E's eraseCommit undo op, not ops of their own).
     *
     * BOTH operands are resolved arc perimeters now, so this is one exact
     * boolean and nothing else. There is no polygonization, no flattening
     * tolerance to pick, and no lattice — which is what every previous version
     * of this function was really about. The old one had to choose a flatten
     * fidelity for the eraser and then SCALE it by the magnification, because
     * flattening a magnified cap at frame fidelity wanted 2e8 points and took
     * 155 seconds for a single gesture. An arc has no such cost: it magnifies by
     * changing one number.
     */
    _bakeOne(Erec, target, { sync = false } = {}) {
        const E = Erec.obj, HE = Erec.level;
        const { obj: o, level: HO } = target;
        if (!this.doc.getById(o.id)) return false;
        // Both operands have to be resolved. In the normal flow they always are
        // — `_eraseStrokes` only hands over erasers that have a shape — but this
        // is also called directly, and an unresolved operand would silently do
        // nothing rather than fail.
        if (E.type === "stroke") this._forceBake(E);
        if (E.type !== "shape") return false;
        if (o.type === "stroke") this._forceBake(o);   // an erase reached it first
        if (o.type === "fill") this.doc.fillToShapeById(o.id);  // a pre-arc drawing
        const done = this._doneSet(E.id);
        done.add(o.id);   // whatever happens below, this object is not looked at again for E
        if (o.type !== "shape") return this._rehomeBail(E, o, HO, "target is a " + o.type + " with no perimeter");
        // Resolve the gesture's undo op BEFORE touching the document — a bake
        // that cannot record itself must not mutate anything (unrecorded
        // bakes were how duplicated, stacked geometry formed). After a reload
        // the commit map is empty, so resumed baking re-registers a fresh op,
        // which also makes a resumed erase undoable again.
        const op = this._eraseOp(E);
        // Attribute every cut to the gesture that made it.
        const note = this.journal.find((j) => j.kind === "erase" && j.id === E.id);
        const areaBefore = o.loops ? loopsArea(o.loops) : 0;
        // A target homed SHALLOWER than the erase re-homes instead of cutting in
        // place: the hole belongs at the level it was drawn at, where it is
        // screen-sized, and the ceded tile is what carries it there.
        //
        // ...but only when the erase really is BELOW it. The frame tree branches
        // — a second visit to a region far from the first mints a sibling — so
        // "finer than" and "underneath" are different questions. Ceding needs an
        // ancestor chain to cede along; between branches there is none, and
        // `_bakeRehome` refuses those. It refused SILENTLY, after this method had
        // already marked the object handled for this eraser, so the erase never
        // came back to it: the gesture painted, the mark was consumed, and the
        // ink was never cut. In Kobin's document 8 of its 12 frames had a blind
        // spot like that — an erase made in `4~5` skipped every object homed at
        // `2` and `3`. When there is no chain to cede along, cut in place.
        const desc = this.lm.framePath(HO, HE);
        const pureDescent = !!desc && !desc.up.length && desc.down.length > 0;
        if (this.lm.depthOf(HO) < this.lm.depthOf(HE) && pureDescent) {
            return this._bakeRehome(op, Erec, target, done, sync);
        }
        // The eraser in the coordinates the object is STORED in — through
        // the object's own offsets when it has any (F41).
        const EpLoops = this._eraserLoopsInto(E.loops, HE, o, HO);
        const Ep = EpLoops ? { loops: EpLoops } : null;
        if (!Ep || !Ep.loops || !Ep.loops.length) return false;
        // In the SUBJECT's own coordinates, as stored. This used to translate
        // both operands onto the subject's centre, cut, and translate back —
        // from the days when an object's coordinates could sit out at 1e13.
        // Under the lattice a native lives within a frame or two of its own
        // origin (invariant 2), so the boolean's bookkeeping, which is scaled
        // off the coordinates it is handed, already sees small numbers. And the
        // round trip cost something real: `(v - c) + c` is not `v`, so every
        // vertex of the object — the ones nowhere near the eraser included —
        // came back one rounding step from where it was, and four crossings
        // down, where the render chain has magnified that step 2.8e14 times, the
        // picture of an object had moved because it was nicked somewhere else
        // (F42). The boolean keeps every piece it does not cut by reference, so
        // cutting in place leaves the rest of the object bit for bit as it was.
        // The geometry in one job (eraseJob.js), in the SUBJECT's own coordinates as
        // stored: the boolean keeps every piece it does not cut by reference, so the
        // rest of the object stays bit for bit where it was (F42). The document side is
        // `_applyCut`, so a worker's result is applied the same way.
        // Dust is what was invisible at the zoom the mark was drawn at (F66), in the
        // subject's units: a quarter pixel there, through the frame factor.
        const job = { subject: o.loops, clip: Ep.loops, w: o.w, dustBar: dustBarFor(E.bakePx, this.lm.frameFactor(HE, HO)), freezeR: this._boolOpts().freezeR, graze: "cut" };
        if (!sync && !this._cutInflight) {
            // Off the main thread where there is a worker (Kobin, 2026-09-08: per job;
            // the document stays here). One cut in flight at a time; `_onCutResult`
            // decides by identity and `_ver` whether the result still applies.
            const p = runCutAsync(job);
            if (p) {
                const inflight = { id: o.id, ver: o._ver || 0, Erec, target, job, ctx: { op, note, areaBefore, done }, t0: perfNow() };
                this._cutInflight = inflight;
                p.then((r) => this._onCutResult(inflight, r, null), (err) => this._onCutResult(inflight, null, err));
                return "pending";
            }
        }
        const r = cutJob(job);
        return this._applyCut(Erec, target, r, { op, note, areaBefore, done });
    }
    /**
     * A worker's cut has landed. Dropped when stale: the mark gone, the target gone (a
     * barrier or another mark took it — its results stand) or changed meanwhile
     * (`_ver`: moved or edited; put back for the next tick). A worker failure runs the
     * job inline. Then the mark steps down as the tick would have, and the tick goes on.
     */
    _onCutResult(inflight, r, err) {
        if (this._cutInflight !== inflight) return;   // a load or a reset superseded it
        this._cutInflight = null;
        const { Erec, target, ctx, job } = inflight;
        const cur = this.doc.getById(inflight.id);
        const markAlive = !!this.doc.getById(Erec.obj.id);
        const same = !!cur && cur.obj === target.obj;
        const changedMeanwhile = same && (cur.obj._ver || 0) !== inflight.ver;
        if (!markAlive || !same || changedMeanwhile) {
            if (changedMeanwhile && markAlive) ctx.done.delete(inflight.id);
            this._cutStale = (this._cutStale || 0) + 1;
            this._scheduleBake(0);
            return;
        }
        const descent = inflight.kind === "descent";
        if (err || !r) { this._cutFailures = (this._cutFailures || 0) + 1; r = descent ? descentJob(inflight.world, inflight.input) : cutJob(job); }
        const tA = perfNow();
        try { if (descent) this._applyDescent(Erec, target, r, ctx); else this._applyCut(Erec, target, r, ctx); }
        finally { this._perf(descent ? "descentApply" : "cutApply", tA, true, { kind: descent ? (r.refused ? "refused" : "steps:" + r.steps.length) : r.kind, workerMs: Math.round(tA - inflight.t0) }); }
        this._lowerMark(Erec, target);
        this._render();
        this._scheduleBake(0);
    }
    /**
     * The document side of a cut: what `cutJob` decided, applied — the sealed-boolean
     * and dust tallies, then the replacement or the removal, recorded on the gesture's
     * op. Nothing here if the mark or the target went meanwhile (a stale result).
     * Returns true when the document changed.
     */
    _applyCut(Erec, target, r, { op, note, areaBefore, done }) {
        const E = Erec.obj;
        const { obj: o, level: HO } = target;
        if (!this.doc.getById(E.id) || !this.doc.getById(o.id)) return false;
        this._noteSeal({ stats: r.stats }, o);
        this._dustCulled = (this._dustCulled || 0) + (r.dust || 0);
        if (r.kind === "grazed") return false;
        let bakedStep;
        if (r.kind === "cut") {
            const regions = r.regions;
            const wasKey = this.doc.editKey(o);
            const inFamily = o.editId != null;
            const cut = this.doc.eraseReplaceById(o.id, regions);
            if (!cut) return false;
            if (note) {
                note.cuts.push({ target: o.id, level: HO, mode: "cut",
                    areaBefore: +areaBefore.toFixed(2),
                    into: cut.pieces.map((x) => ({ id: x.id, area: +loopsArea(x.loops).toFixed(2) })),
                    sealed: (r.stats && r.stats.sealed) || 0 });
            }
            bakedStep = { removed: cut.removed, pieces: cut.pieces.map((obj) => ({ obj, level: cut.removed.level })) };
            for (const pc of bakedStep.pieces) done.add(pc.obj.id); // results are already net of E
            // A cut inside a multi-level family may or may not have parted the
            // OBJECT — that is a question about the whole family, asked once,
            // after the geometry has settled.
            if (regions.length > 1 && inFamily) { this.doc.recordBake(op, bakedStep); this._resplitFamily(op, wasKey); return true; }
        } else {
            const rec = this.doc.removeById(o.id); // nothing survives
            if (!rec) return false;
            if (note) note.cuts.push({ target: o.id, level: HO, mode: "removed", areaBefore: +areaBefore.toFixed(2) });
            bakedStep = { removed: rec, pieces: [] };
        }
        this.doc.recordBake(op, bakedStep); // op resolved above — every bake is recorded
        return true;
    }
    // `dropDust`, plus a tally — how much dust a session generates is worth
    // knowing, and it is what a test asserts on to show the cull is doing work
    // rather than that the case never arose.
    _cull(groups, w) {
        const keep = dropDust(groups, w);
        this._dustCulled = (this._dustCulled || 0) + (groups.length - keep.length);
        return keep;
    }
    /**
     * Count the booleans that had to be sealed.
     *
     * `shapeBoolean` guarantees closed loops now, closing a chain the walk
     * could not finish with a chord rather than dropping the boundary it
     * carries. That is a real, if small, geometric compromise, so it is
     * counted: a rise here is the stitch getting worse, and it is what a test
     * asserts on.
     */
    _noteSeal(res, subject) {
        const open = res && res.stats ? res.stats.openChains : 0;
        if (!open) return;
        this._boolFailures = (this._boolFailures || 0) + 1;
        // The weld radius the boolean settled on, and whether it got there by
        // retrying at a wider one (`shapeBoolean`: `retriedAt` is the factor,
        // absent when the first pass was accepted). F34's investigation
        // needed exactly these two and this note used to drop them.
        this._lastBoolFailure = { id: subject && subject.id, open, area: res.stats.sealedArea,
            weld: res.stats.weld, retriedAt: res.stats.retriedAt || 0 };
    }
    // An object's painted area as polygon rings, flattened to `tol`. Only the
    // consumers that still speak polygons come through here — the connectivity
    // check, and nothing else.
    _inkOutline(o, tol) {
        if (o.type === "shape") return flattenShape(o.loops, tol);
        if (o.type === "fill") return o.polys;
        return flattenLoops(strokeLoops(o, this.cfg, { curved: o.origin === "native", live: this.store.live }), tol);
    }

    /**
     * THE INK A CEDE HANDS DOWN: what the tile store holds for native `id` in
     * cache square (i, j) of frame `F` — the very pieces the renderer draws
     * there — as { loops, clip, tile }, or null if the square holds none of it.
     *
     * This replaced `_inkShapeInRect` on 2026-09-04 (F42). That projected the
     * parent one hop with `projectF` and clipped it to the block in local
     * coordinates, which is the same arithmetic the render chain does, done a
     * second way. The render chain derives each level from the parent TILE's
     * stored pieces, clipped to the padded window; the descent derived from
     * the previous kid, clipped to the bare block. Every clip vertex is an
     * interpolation between two far-off, already-rounded ends, so it carries
     * their error, and the next hop multiplies that by 4,096 before it
     * interpolates again. Two chains that clip on different rectangles
     * therefore part company at 4,096x per crossing — measured on Kobin's
     * report: a last-bit disagreement at level 2, 1,788 units at level 6, a
     * whole tile at 7, with nothing but straight lines involved — and the
     * eraser then cut ink the screen did not show, or found none to cut. At
     * depth the only "same" is the same bits, so the descent now reads the
     * chain it has to agree with, and the kid it mints IS that piece: the
     * deeper tiles were already derived from those loops, and after the cede
     * they derive from the kid and get the same bits.
     *
     * A covering piece (the solid tier's quad, or a window the ink floods)
     * comes back as the rectangle it stands for. `clip` is the padded window
     * the piece was cut to, which is what the parent gives up and what the kid
     * is attached on; `tile` is the object's grid phase at F.
     */
    // ---- IS THE FAMILY STILL ONE OBJECT? (bible §3) ----
    //
    // Once a ceded tile is CUT out of its parent, this stops being a walk and
    // becomes a graph. Every native in the family is a node. The only place two
    // of them can meet is the boundary of a ceded tile: the parent stops exactly
    // at the rect, the child fills exactly the rect, and they share its
    // perimeter. So there is ONE relation, evaluated once, in both directions at
    // the same time — a parent piece and a child piece are joined when their ink
    // meets on the same stretch of that perimeter. The object is severed when
    // the graph is disconnected.
    //
    // This replaces an upward relay that had to decide, level by level, whether
    // to cut the parent as it went. Nothing is cut here: the geometry was
    // already separated when the tile was ceded, so severing is re-labelling.
    //
    // Contacts are compared in a NORMALIZED perimeter parameter (geometry/
    // connect.js), so the parent's measurement in its own units and the child's
    // in units 3000x finer are the same numbers — no transform is ever composed
    // across the crossing.
    _familyMembers(key) {
        const out = [];
        for (const L of this.doc.levels()) {
            for (const o of this.doc.at(L)) {
                if (!o.erase && this.doc.editKey(o) === key) out.push({ obj: o, level: L });
            }
        }
        return out;
    }
    /** Connected components of one edit family, as arrays of member indices. */
    _familyComponents(key) {
        const members = this._familyMembers(key);
        const G = new Groups(members.length);
        for (let i = 0; i < members.length; i++) {
            const kid = members[i], R = kid.obj.attachRect;
            if (!R) continue;                       // not a re-homed piece: no doorway
            const kidDepth = this.lm.depthOf(kid.level);
            if (kidDepth == null) continue;
            // Flattened only for the CONTACT test. The stretches that matter lie
            // ON the rect's boundary and are straight lines there, so flattening
            // reproduces them exactly however coarse it is elsewhere — and the
            // exact clip that made them put them exactly on the rect, with no
            // lattice to round a corner off and turn an attached patch into an
            // offshoot of its own.
            const kidArcs = contactArcs(this._inkOutline(kid.obj, rectTol(R)), R, rectTol(R));
            if (!kidArcs.length) continue;
            // ONE LEVEL COARSER, and touching — a GEOMETRIC test, not a check
            // that the two frames are literally parent and child.
            //
            // They used to have to be, and that quietly made connectivity depend
            // on bookkeeping: re-homing normalizes each member on its own local
            // coordinates, so two members of one family can settle on different
            // branches while sitting in exactly the same place in the world. The
            // object had not changed at all and was reported as three. Asking
            // where the doorway actually IS answers the real question and cannot
            // be knocked over by an address change.
            for (let j = 0; j < members.length; j++) {
                const up = members[j];
                if (j === i) continue;
                if (up.obj.type !== "shape" && up.obj.type !== "fill") continue;
                const upDepth = this.lm.depthOf(up.level);
                // THE SAME LEVEL, ACROSS A SQUARE'S EDGE. Since a cede hands over
                // one cache square at a time (F42), a gesture that straddles two
                // squares mints two kids side by side, the second cut from the
                // parent's remnant so that it starts exactly where the first
                // one's window ends. Neither is the other's parent, and a test
                // that only pairs a kid with the level above would call two
                // halves of one blob two objects. So a neighbour's outline is
                // asked where it lies on THIS kid's window — the abutting edge
                // — and a shared stretch there joins them, by the same rule and
                // the same tolerance as the doorway to the parent.
                if (upDepth === kidDepth) {
                    if (!up.obj.attachRect) continue;
                    const Rj = up.obj.attachRect;
                    if (Rj.x1 < R.x0 - rectTol(R) || Rj.x0 > R.x1 + rectTol(R) || Rj.y1 < R.y0 - rectTol(R) || Rj.y0 > R.y1 + rectTol(R)) continue;
                    if (arcsTouch(kidArcs, contactArcs(this._inkOutline(up.obj, rectTol(R)), R, rectTol(R)), rectTol(R) / rectSpan(R))) G.union(i, j);
                    continue;
                }
                if (upDepth !== kidDepth - 1) continue;
                const Rk = { left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 };
                // The kid's window is in unmoved numbers (it is the store's
                // piece for the square), so it maps to the parent's stored
                // coordinates through the parent's UNMOVED frame at the kid's
                // level (F55) — the exact chain, no remainder involved.
                const upF0 = up.obj.below ? this.lm.objShift(up.obj.below, up.level, kid.level) : null;
                const Rp = upF0 ? this.lm.mapRectF(Rk, upF0.F0, up.level) : this.lm.mapRectF(Rk, kid.level, up.level);
                if (!Rp) continue;
                const at = Math.max(rectTol(R) / rectSpan(R), rectTol(Rp) / rectSpan(Rp));
                if (arcsTouch(kidArcs, contactArcs(this._inkOutline(up.obj, rectTol(Rp)), Rp, rectTol(Rp)), at)) G.union(i, j);
            }
        }
        const ids = members.map((_, i) => i);
        return { members, classes: G.classes(ids) };
    }
    /**
     * Re-label a family into its connected components. Returns true if it came
     * apart. Pure identity: no geometry is touched, because by now there is none
     * left to cut.
     */
    _resplitFamily(op, key) {
        const { members, classes } = this._familyComponents(key);
        const note = this.journal[this.journal.length - 1];
        if (note && note.kind === "erase") {
            note.split = { key, components: classes.map((c) => c.map((i) => `${members[i].level}#${members[i].obj.id}`)) };
        }
        if (classes.length < 2) return false;
        const rekeys = [];
        classes.forEach((cls, n) => {
            // Leave the first component on the original key — less churn, and a
            // selection that was already pointing at it stays valid.
            const k = n === 0 ? key : this.doc.allocId();
            for (const i of cls) {
                const o = members[i].obj;
                if (this.doc.editKey(o) === k) continue;
                rekeys.push({ id: o.id, before: { editId: o.editId }, after: { editId: k } });
                o.editId = k;
            }
        });
        if (rekeys.length) { this.doc.keysChanged(); this.doc.recordBake(op, { rekey: rekeys }); }
        return true;
    }

    // Re-homing bake: cut the hole at the level the user drew it at, and get
    // there ONE CROSSING AT A TIME.
    //
    // The whole point is §2.1's rule: a cutout is always exactly one crossing
    // below the shape it is cut into. Ceding straight from the target's home to
    // the erase level looks simpler and dies at five crossings — measured, the
    // ceded rect is 1.9e-8 units wide in the target's frame at three crossings,
    // 9.1e-12 at four and EXACTLY ZERO at five, because one float64 step there
    // is 8.9e-14. It fails silently: a zero-width window is recorded and no hole
    // ever appears.
    //
    // Descending instead, each step cedes one CHILD TILE — 38,400 child units,
    // which is 12.8 units in the parent whatever the depth, a ratio of 1/3000
    // forever. Each step also projects only its immediate parent, so no
    // transform is ever composed across more than one crossing.
    _bakeRehome(op, Erec, target, done, sync) {
        const tRH = perfNow();
        try { return this._bakeRehomeInner(op, Erec, target, done, sync); }
        finally { this._perf("rehome", tRH, false, { id: target && target.obj && target.obj.id }); }
    }
    /** The descent's world: the engine's own frame math and derive parameters (eraseDescent.js). */
    _descentWorld() { return { lm: this.lm, cfg: this.cfg, width: this.lm.width, opacityGroups: this.store.opacityGroups }; }
    /**
     * A target homed shallower than the erase is re-homed by the DESCENT — one job per
     * family (Kobin, 2026-09-08; eraseDescent.js): the target is read, every cede is
     * virtual, and nothing touches the document until the whole descent has succeeded,
     * when `_applyDescent` swaps the family in. In the worker where there is one; inline
     * for the barrier and where there is none. A refusal is recorded on the gesture's note.
     */
    _bakeRehomeInner(op, Erec, target, done, sync) {
        const E = Erec.obj, HE = Erec.level;
        const { obj: o, level: HO } = target;
        if (o.type === "stroke") { this._forceBake(o); done.add(o.id); }
        if (o.type === "fill") this.doc.fillToShapeById(o.id);
        if (o.type !== "shape") return this._rehomeBail(E, o, HO, "target is a " + o.type);
        const input = { freezeR: this._boolOpts().freezeR, HE, target: { obj: o, level: HO }, E: { id: E.id, w: E.w, bakePx: E.bakePx, loops: E.loops } };
        const world = this._descentWorld();
        if (!sync && !this._cutInflight) {
            const p = runDescentAsync(world, input);
            if (p) {
                const inflight = { kind: "descent", id: o.id, ver: o._ver || 0, Erec, target, world, input, ctx: { op, done }, t0: perfNow() };
                this._cutInflight = inflight;
                p.then((r) => this._onCutResult(inflight, r, null), (err) => this._onCutResult(inflight, null, err));
                return "pending";
            }
        }
        return this._applyDescent(Erec, target, descentJob(world, input), { op, done });
    }
    /**
     * The document side of a descent: the family swapped for the new one. Every step's
     * removal is a real object (the target) or one this apply minted a step earlier; the
     * new objects take real ids in the order `Document.cedeTileById` gave them, so the
     * result is the one the in-place descent produced. Recorded newest-last on the op, so
     * undo unwinds the chain from the bottom up; then the family is asked whether it is
     * still one object.
     */
    _applyDescent(Erec, target, r, { op, done }) {
        const E = Erec.obj;
        const { obj: o, level: HO } = target;
        for (const sl of r.stats.seals) { this._boolFailures = (this._boolFailures || 0) + 1; this._lastBoolFailure = { ...sl }; }
        this._dustCulled = (this._dustCulled || 0) + (r.stats.dust || 0);
        if (r.refused) return this._rehomeBail(E, o, HO, r.refused);
        const cur = this.doc.getById(o.id);
        if (!cur || cur.obj !== o || !this.doc.getById(E.id)) return false;
        // The frames the job minted on its own lattice copy, here first (F67): a kid's
        // home must exist before the store or the index can place it.
        if (r.minted && r.minted.length) this.lm.merge({ frames: r.minted });
        const idMap = new Map();   // the job's virtual ids -> the ids minted here
        const real = (vid) => (vid < 0 ? idMap.get(vid) : vid);
        const steps = [];
        for (const st of r.steps) {
            const removed = this.doc.removeById(real(st.removedId));
            if (!removed) return false;   // cannot happen: ours, or the target checked above
            const mint = (sp) => { const obj = { ...sp.obj, id: this.doc.allocId(), paths: [] }; this.doc.add(obj, sp.level); idMap.set(sp.vid, obj.id); return { obj, level: String(sp.level) }; };
            const pieces = st.parents.map(mint).concat(st.kids.map(mint));
            for (const pc of pieces) done.add(pc.obj.id);
            steps.push({ removed, pieces });
        }
        for (const st of steps) this.doc.recordBake(op, st);
        const note = this.journal.find((j) => j.kind === "erase" && j.id === E.id);
        if (note) {
            note.cuts.push({ target: o.id, level: HO, mode: "cede",
                through: steps.map((st) => st.pieces.map((pc) => `${pc.level}#${pc.obj.id}`)) });
        }
        this._resplitFamily(op, this.doc.editKey(o));
        return true;
    }
    /**
     * THE AREA AN ERASE TAKES, measured where it happens (F46, 2026-09-05).
     *
     * The intersection of the two shapes: its pieces are no longer than the
     * eraser, so its area is exact to the eraser's own ulps however large the
     * subject's arcs are. The quantity it replaces — the subject's area before
     * the cut minus its area after — is the difference of two whole-object
     * areas, and those are not exact at depth. A level-3 picture of an ordinary
     * curve is an arc of radius ~6e12 spanning a tile; `loopArea` on such a
     * piece carries two errors of tens of units^2 each: its segment term (fixed
     * in `segmentTerm`, but the second remains) and the endpoints, which are
     * inherited exactly while the centre is rounded, so A and B sit ~ulp(r) off
     * the circle and the chord half of the area disagrees with the arc half by
     * ~chord x ulp(r) / 2. A 12-px nick removes 0.23 units^2 there. Measured:
     * the direct replay of the refused level-3 cut read removed = -24.0 with a
     * perfectly good result loop. Local measurement is Kobin's rule 6 — prefer
     * the estimator that degrades locally — applied to the one test that
     * decides whether an erase happens at all.
     */
    _removedArea(subject, clip) {
        const cut = intersectShape(subject, clip, this._boolOpts());
        return Math.abs(loopsArea(cut.loops));
    }
    /**
     * The boolean's one option: the freeze radius at this engine's tolerance
     * (freeze.js rule 2), so an erase stands in for an arc by its chord exactly
     * where the tile chain would have frozen it, and nowhere else.
     */
    _boolOpts() { return { freezeR: freezeR(this.cfg) }; }
    _rehomeBail(E, o, HO, why) {
        const note = this.journal.find((j) => j.kind === "erase" && j.id === E.id);
        if (note) {
            note.refused = note.refused || [];
            if (note.refused.length < 12) note.refused.push({ target: o.id, level: HO, why });
        }
        this._rehomeWhy = null;
        return false;
    }
    /**
     * A mark is being consumed. If it never cut anything, say what it looked at.
     *
     * The done set IS the list of everything the gesture considered and
     * dismissed, so recording it turns "the eraser did nothing" from a mystery
     * into a list of objects with a reason beside each one.
     */
    _noteSpent(E) {
        const note = this.journal.find((j) => j.kind === "erase" && j.id === E.id);
        if (!note || (note.cuts && note.cuts.length)) return;
        const done = this._bakeDone.get(E.id);
        note.spent = {
            considered: done ? [...done].slice(0, 24) : [],
            nConsidered: done ? done.size : 0,
            refused: (note.refused || []).length,
            pending: this._eraseStrokes().length,
        };
    }
    // Selection barrier: bake everything still pending over ONE object, now.
    // Returns true if the object changed (caller re-renders and re-hits).
    _flushErasesFor(id) {
        this.flushBakes();   // an eraser cannot be subtracted before it has a shape
        const rec = this.doc.getById(id);
        if (!rec || rec.obj.erase) return false;
        for (const Erec of this._eraseStrokes()) {
            const E = Erec.obj;
            if (this._zOf(E) <= this._zOf(rec.obj)) continue;
            // Done means handled OR in the worker; a cut in flight for this object is
            // baked here anyway (Kobin: settle first) and its late result is dropped.
            const inflight = this._cutInflight && this._cutInflight.id === id && this._cutInflight.Erec.obj === E;
            if (!inflight && this._doneSet(E.id).has(id)) continue;
            if (!this._eraseMayTouch(E, Erec.level, rec.obj, rec.level)) { this._doneSet(E.id).add(id); continue; }
            if (this._bakeOne(Erec, { obj: rec.obj, level: rec.level }, { sync: true })) return true;
        }
        return false;
    }
    /**
     * Erase barrier for a MOVE: settle every mark still pending over anything
     * in the selection, then consume the marks that have nothing left to cut.
     *
     * A mark is a native at fixed coordinates. Ink dragged out from under one
     * that has not been applied yet takes its un-erased shape with it, the mark
     * stays behind and cuts whatever has arrived there since, and the white
     * mark itself goes on painting over the drawing. The single-object flush
     * that used to be here left all of that whenever the selection held more
     * than the piece under the finger — several objects, or one object with a
     * re-homed piece at another level.
     *
     * The selection is carried across the bakes by REPLACEMENT, not by id and
     * not by `z`: a cut mints new natives, and `z` is inherited by every
     * descendant forever, so a piece split off ten minutes ago shares it and
     * would silently join the drag. Diffing the document around each bake names
     * exactly the pieces that bake produced.
     */
    _settleSelectionErases() {
        const idsNow = () => {
            const set = new Set();
            for (const L of this.doc.levels()) for (const o of this.doc.at(L)) if (!o.erase) set.add(o.id);
            return set;
        };
        const live = new Set(this._selectionMembers().map((m) => m.obj.id));
        let replaced = false, changed = false;
        for (let guard = 0; guard < 200; guard++) {
            const before = idsNow();
            let baked = false;
            for (const id of [...live]) {
                if (this.doc.getById(id) && this._flushErasesFor(id)) { baked = true; break; }
            }
            if (!baked) break;
            const after = idsNow();
            for (const id of after) if (!before.has(id)) live.add(id);
            for (const id of [...live]) if (!after.has(id)) live.delete(id);
            replaced = true; changed = true;
        }
        // A mark with no target left is spent. Left alone it would keep being
        // PAINTED — white ink over whatever it covers — until the idle baker
        // next ran, which during a drag is deferred behind the drag itself.
        for (const Erec of this._eraseStrokes()) {
            if (this._nextEraseTarget(Erec)) continue;
            this._noteSpent(Erec.obj);
            this._keepDebugMark(Erec.obj);
            this.doc.removeById(Erec.obj.id);
            this._eraseCommits.delete(Erec.obj.id);
            this._bakeDone.delete(Erec.obj.id);
            changed = true;
        }
        if (replaced) {
            const ids = [...live].filter((id) => this.doc.getById(id));
            if (ids.length) this._setSelection(ids); else this.deselect();
        }
        if (changed) this._render();
        return changed;
    }
    /** TEST-ONLY: bake every pending eraser stroke to completion. */
    flushErases() {
        this.flushBakes();
        let guard = 0;
        while (guard++ < 10000) {
            const strokes = this._eraseStrokes();
            if (!strokes.length) break;
            const Erec = strokes[0];
            const target = this._nextEraseTarget(Erec);
            if (target) { this._bakeOne(Erec, target, { sync: true }); continue; }
            this._noteSpent(Erec.obj);
            this._keepDebugMark(Erec.obj);
            this.doc.removeById(Erec.obj.id);
            this._eraseCommits.delete(Erec.obj.id);
            this._bakeDone.delete(Erec.obj.id);
        }
        this._render();
    }
}

export const erasePipeline = ErasePipeline.prototype;
