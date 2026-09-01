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
    childTilePhase,
    objTileRange,
    objTileRect,
} from "./frameLattice";
import Document from "./Document";
import { Groups, arcsTouch, contactArcs } from "./geometry/connect";
import { bboxOf } from "./geometry/derive";
import {
    clipShapeToRect,
    dropDust,
    flattenShape,
    loopsArea,
    loopsBBox,
    repairLoops,
    shapeComponents,
    subtractShape,
    transformLoops,
} from "./geometry/arcShape";
import { flattenLoops, strokeLoops } from "./geometry/curveOutline";
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
        let changed = false;
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
            this._promoteOversize(entry.id);   // D9 / invariant 2
            changed = true;
        }
        if (changed) this._render();
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
        let changed = false, more = false, baked = 0;
        for (const Erec of this._eraseStrokes()) {
            let guard = 0;
            while (guard++ < 10000) {
                const target = this._nextEraseTarget(Erec);
                if (!target) break;
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
                if (this._bakeOne(Erec, target)) changed = true;
                this._eraseItemMs = perfNow() - it0;
                baked++;
                if (perfNow() - t0 >= ERASE_SLICE_MS) { more = true; break; }
            }
            if (more) break;
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
        if (more || this._eraseStrokes().length) this._scheduleBake(0);
    }
    // First not-yet-handled object beneath eraser stroke E (cheap filters:
    // z-below, frame chain within the precision guard, ink proximity).
    _nextEraseTarget(Erec) {
        const E = Erec.obj, HE = Erec.level;
        const done = this._doneSet(E.id);
        for (const k of this.doc.levels()) {
            // Reachability is the only bar. There used to be a ±4 crossings
            // guard here, from when the erase had to be representable in the
            // TARGET's own units and simply could not be more than four
            // crossings away. Under the recipe the cut lives in the frame it
            // was made in and is never rewritten into anyone else's units, so
            // there is no depth limit — and the guard was silently doing
            // NOTHING at five crossings and beyond: the gesture painted, the
            // white stroke was consumed, and no ink was ever removed.
            if (this.lm.frameFactor(k, HE) == null) continue;
            for (const o of this.doc.at(k)) {
                if (o.erase || done.has(o.id)) continue;
                if (this._zOf(o) >= this._zOf(E)) continue;
                if (!this._eraseMayTouch(E, HE, o, k)) { done.add(o.id); continue; }
                return { obj: o, level: k };
            }
        }
        return null;
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
        const r = this.lm.mapRectF({ left: eb.x0, top: eb.y0, right: eb.x1, bottom: eb.y1 }, HE, HO);
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
    _bakeOne(Erec, target) {
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
        if (o.type !== "shape") return false;
        const done = this._doneSet(E.id);
        done.add(o.id);
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
            return this._bakeRehome(op, Erec, target, done);
        }
        const Ep = this.lm.projectF(E, HE, HO);
        if (!Ep || !Ep.loops || !Ep.loops.length) return false;
        // Local to the SUBJECT, not to the frame origin and not to the eraser.
        // Both operands shift by the same amount so the boolean is exact either
        // way, but the bookkeeping inside it is scaled off the coordinates it is
        // handed, and it is the object being CUT whose coordinates have to stay
        // small: an eraser three crossings above its target arrives 2.7e10 times
        // its own size, and centring on THAT leaves the target sitting out at
        // 1e13 where its own features are below the rounding.
        const eb = loopsBBox(Ep.loops);
        const sb = loopsBBox(o.loops);
        const ox = (sb.x0 + sb.x1) / 2, oy = (sb.y0 + sb.y1) / 2;
        const subject = transformLoops(o.loops, 1, -ox, -oy);
        const clip = transformLoops(Ep.loops, 1, -ox, -oy);
        const before = loopsArea(subject);
        const res = subtractShape(subject, clip);
        this._noteSeal(res, o);
        const kept = loopsArea(res.loops);
        // Grazing pass: (practically) no ink removed — leave it alone, so a
        // tangent touch does not churn every stroke it brushes past.
        //
        // Measured against the SUBJECT as well as the eraser. Against the eraser
        // alone it is nonsense the moment the eraser is magnified: three
        // crossings below its own level the gesture is 2.7e10 times its own
        // size, so "a negligible fraction of the eraser" came to 2.6e20 square
        // units — larger than any object it could possibly be cutting. Every
        // deep target read as grazed and survived an erase that covered it
        // completely.
        const rE = Math.max(eb.x1 - eb.x0, eb.y1 - eb.y0) / 2;
        const graze = Math.min(1e-4 * rE * rE, 1e-6 * Math.max(before, 0));
        if (before - kept <= graze) return false;
        let bakedStep;
        // Dust — a fragment far thinner than the pen that drew it, left where
        // the cut ran tangent to an edge — is not made into an object. Kobin
        // saw these as "small pixel dots"; his document carries nine, the
        // smallest 0.05 units across against a pen of 39. Culled HERE rather
        // than inside the boolean: the arithmetic is right, it is the decision
        // to store the result as ink that is wrong.
        const surviving = this._cull(shapeComponents(res.loops), o.w);
        if (surviving.length) {
            const regions = surviving.map((g) => transformLoops(g, 1, ox, oy));
            const wasKey = this.doc.editKey(o);
            const inFamily = o.editId != null;
            const cut = this.doc.eraseReplaceById(o.id, regions);
            if (!cut) return false;
            if (note) {
                note.cuts.push({ target: o.id, level: HO, mode: "cut",
                    areaBefore: +areaBefore.toFixed(2),
                    into: cut.pieces.map((x) => ({ id: x.id, area: +loopsArea(x.loops).toFixed(2) })),
                    sealed: (res.stats && res.stats.sealed) || 0 });
            }
            bakedStep = { removed: cut.removed, pieces: cut.pieces.map((obj) => ({ obj, level: cut.removed.level })) };
            for (const pc of bakedStep.pieces) done.add(pc.obj.id); // results are already net of E
            // A cut inside a multi-level family may or may not have parted the
            // OBJECT — that is a question about the whole family, not about this
            // level, and it is asked once, after the geometry has settled.
            if (regions.length > 1 && inFamily) { op.baked.push(bakedStep); this._resplitFamily(op, wasKey); return true; }
        } else {
            const rec = this.doc.removeById(o.id); // nothing survives
            if (!rec) return false;
            if (note) note.cuts.push({ target: o.id, level: HO, mode: "removed", areaBefore: +areaBefore.toFixed(2) });
            bakedStep = { removed: rec, pieces: [] };
        }
        op.baked.push(bakedStep); // op resolved above — every bake is recorded
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
        this._lastBoolFailure = { id: subject && subject.id, open, area: res.stats.sealedArea };
    }
    // An object's painted area as polygon rings, flattened to `tol`. Only the
    // consumers that still speak polygons come through here — the connectivity
    // check, and nothing else.
    _inkOutline(o, tol) {
        if (o.type === "shape") return flattenShape(o.loops, tol);
        if (o.type === "fill") return o.polys;
        return flattenLoops(strokeLoops(o, this.cfg, { curved: o.origin === "native", live: this.store.live }), tol);
    }

    // The ink of shape `o` (homed at `HF`) inside rect `R` of frame `F`, as
    // LOOPS in F's coordinates. One bounded frame hop, never a composed long
    // jump, and the clip is exact — so the piece that moves into the tile and
    // the hole left behind in the parent are cut from the very same edge.
    //
    // Computed local to the rect and translated back: at depth the rect's own
    // coordinates run to 1e13 while the rect is a few units wide, and every
    // tolerance inside the boolean is scaled off the numbers it is handed.
    _inkShapeInRect(o, HF, F, R) {
        const d = HF === F ? o : this.lm.projectF(o, HF, F);
        if (!d || d.type !== "shape") return null;
        const cx = (R.left + R.right) / 2, cy = (R.top + R.bottom) / 2;
        const local = transformLoops(d.loops, 1, -cx, -cy);
        const lrect = { left: R.left - cx, top: R.top - cy, right: R.right - cx, bottom: R.bottom - cy };
        const clipped = clipShapeToRect(local, lrect).loops;
        if (!clipped.length) return [];
        return transformLoops(clipped, 1, cx, cy);
    }

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
                if (this.lm.depthOf(up.level) !== kidDepth - 1) continue;
                if (up.obj.type !== "shape" && up.obj.type !== "fill") continue;
                const Rp = this.lm.mapRectF({ left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 }, kid.level, up.level);
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
        if (rekeys.length) op.baked.push({ rekey: rekeys });
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
    _bakeRehome(op, Erec, target, done) {
        const tRH = perfNow();
        try { return this._bakeRehomeInner(op, Erec, target, done); }
        finally { this._perf("rehome", tRH, false, { id: target && target.obj && target.obj.id }); }
    }
    _bakeRehomeInner(op, Erec, target, done) {
        const E = Erec.obj, HE = Erec.level;
        const { obj: o, level: HO } = target;
        const path = this.lm.framePath(HO, HE);
        if (!path || path.up.length || !path.down.length) return this._rehomeBail(E, o, HO, "not a pure descent");
        if (!E.loops || !E.loops.length) return this._rehomeBail(E, o, HO, "eraser has no perimeter");

        // The eraser's own footprint, in its own frame — its resolved perimeter,
        // which is simply what it is now. There is no polygonization step left
        // here to get wrong, and no tolerance to pick.
        const clipAtHE = E.loops;
        const eb = loopsBBox(clipAtHE);
        if (!eb) return this._rehomeBail(E, o, HO, "eraser has no bbox");
        const rE = Math.max(eb.x1 - eb.x0, eb.y1 - eb.y0) / 2;
        const eraseAtHE = { left: eb.x0 - rE, top: eb.y0 - rE, right: eb.x1 + rE, bottom: eb.y1 + rE };

        const steps = [];
        let cur = o, curFrame = HO;
        if (cur.type === "stroke") { this._forceBake(cur); done.add(cur.id); }
        if (cur.type === "fill") this.doc.fillToShapeById(cur.id);
        if (cur.type !== "shape") return this._rehomeBail(E, o, HO, "target is a " + cur.type);
        for (let k = 0; k < path.down.length; k++) {
            const F = path.down[k];
            const last = k === path.down.length - 1;
            // The Kobinization tiles of F the erase falls in — cede the block of
            // them, not just the first. A gesture landing ON a tile boundary
            // spans two, and ceding only the tile its top-left corner happens to
            // fall in bit exactly half the mark: measured, an erase straddling a
            // seam under-erased by 19.5 px against a 20 px eraser, and it looked
            // like a perfectly ordinary hole of the wrong size. The block stays
            // small by construction — a tile is three screens wide at the
            // widest in-level zoom, so a screen-sized gesture can never touch
            // more than two of them per axis — and the clamp is belt and braces.
            let eraseAtF = this.lm.mapRectF(eraseAtHE, HE, F);
            if (!eraseAtF) { this._rehomeWhy = "the eraser maps to nothing in " + F; break; }
            // THE BLOCK HAS TO CONTAIN THE GROUND THE DESCENT IS ABOUT TO STAND
            // ON. The next frame down is a cell of THIS one, and the step after
            // this one cuts inside it — so if the block does not cover that
            // cell, the chain arrives holding only part of the cell's ink and
            // the rest of the erase has nothing to cut.
            //
            // Two things make that reachable rather than theoretical now that a
            // tile is the size of a frame (D4). A cell at the extreme digit is
            // centred on the frame's own edge, which is exactly where a tile
            // boundary now falls, so it straddles two tiles; and past about four
            // crossings the eraser's footprint up here is narrower than one
            // float step of `x / TILE`, so asking which tiles the eraser touches
            // collapses to one and picks a side. Measured: at five crossings the
            // hole came out 18 px short against an 18 px eraser (MX-1), and the
            // chain looked perfectly healthy — every link present, each holding
            // half a cell.
            const next = k + 1 < path.down.length ? this.lm.frame(path.down[k + 1]) : null;
            if (next && next.centre) {
                const h = FRAME_W / CROSS_RATIO / 2;   // half a cell, in F's units
                eraseAtF = {
                    left: Math.min(eraseAtF.left, next.centre.x - h),
                    right: Math.max(eraseAtF.right, next.centre.x + h),
                    top: Math.min(eraseAtF.top, next.centre.y - h),
                    bottom: Math.max(eraseAtF.bottom, next.centre.y + h),
                };
            }
            // ON THE OBJECT'S OWN TILE GRID, not the frame's (D4, bible 6.6).
            // A ceded zone is a piece of the object cut on a tile boundary, so
            // it has to be cut on the SAME boundary every time or two cedes
            // made either side of a move land on different alignments and
            // partially overlap. The grid rides with the object, so they cannot.
            const cf = this.lm.frame(F);
            const pcur = cur.tile || [0, 0];
            const ph = cf && cf.centre
                ? [childTilePhase(pcur[0], cf.centre.x, CROSS_RATIO), childTilePhase(pcur[1], cf.centre.y, CROSS_RATIO)]
                : [0, 0];
            const rg = objTileRange(ph[0], ph[1], eraseAtF);
            const t0 = objTileRect(ph[0], ph[1], rg.i0, rg.j0);
            const t1 = objTileRect(ph[0], ph[1], Math.min(rg.i1, rg.i0 + 3), Math.min(rg.j1, rg.j0 + 3));
            const R = { left: t0.left, top: t0.top, right: t1.right, bottom: t1.bottom };
            const inTile = this._inkShapeInRect(cur, curFrame, F, R);
            if (!inTile || !inTile.length) { this._rehomeWhy = "tile holds none of its ink"; break; }
            // ...and "holds none of its ink" includes holding only a DEGENERATE
            // trace of it. Where the parent's boundary merely grazes the tile
            // edge, the clip comes back as a strip with no area — two lines out
            // and back along the rect — and ceding a tile for that mints a
            // native that paints nothing, connects to nothing, and counts as
            // its own component of the object for ever. Kobin's third scenario
            // had FOURTEEN of them, one per gesture, all identical, and they
            // are why a family of 18 pieces reported 16 components.
            const solid = this._cull(shapeComponents(inTile), cur.w);
            if (!solid.length) { this._rehomeWhy = "the tile's ink is degenerate"; break; }
            let specs;
            if (last) {
                // Local to the tile: the erase and the ink are comparable numbers
                // here, however deep the frame sits.
                const cx = (R.left + R.right) / 2, cy = (R.top + R.bottom) / 2;
                const local = transformLoops([].concat(...solid), 1, -cx, -cy);
                const clipLocal = transformLoops(clipAtHE, 1, -cx, -cy);
                const before = loopsArea(local);
                const res = subtractShape(local, clipLocal);
                this._noteSeal(res, cur);
                if (before - loopsArea(res.loops) < 1e-4 * rE * rE) { this._rehomeWhy = "grazing: nothing removed"; break; }
                // A region that still reaches the ceded rect's boundary is part
                // of the same logical object and moves with it; one the erase
                // fully enclosed has been cut loose and becomes its own. That
                // question is asked over the whole family afterwards, from the
                // contacts on the tile edge — which the exact clip puts EXACTLY
                // on the rect, so there is no quantized corner to misread.
                specs = this._cull(shapeComponents(res.loops), cur.w)
                    .map((g) => ({ loops: transformLoops(g, 1, cx, cy) }));
            } else {
                // An intermediate link: the parent's ink in this tile, whole. It
                // exists only so the level below has something to cut into —
                // one native per connected piece of it, so a link is never a
                // bag of unrelated lumps.
                specs = solid.map((g) => ({ loops: g }));
            }
            const wParent = this.lm.mapRectF(R, F, curFrame);
            if (!wParent || !(wParent.right > wParent.left) || !(wParent.bottom > wParent.top)) { this._rehomeWhy = "the tile maps to nothing in the parent"; break; }
            // CUT the tile out of the parent and hand its ink to the level below.
            // A second erase in the same tile now finds no parent ink there and
            // stops of its own accord — the old model needed an explicit guard
            // against re-ceding ground it had already given away.
            const step = this.doc.cedeTileById(cur.id, F, specs,
                { x0: wParent.left, y0: wParent.top, x1: wParent.right, y1: wParent.bottom },
                { x0: R.left, y0: R.top, x1: R.right, y1: R.bottom }, ph);
            if (!step) { this._rehomeWhy = "cedeTileById refused"; break; }
            for (const pc of step.pieces) done.add(pc.obj.id);
            steps.push({ removed: step.removed, pieces: step.pieces });
            if (!step.kids.length) break;
            cur = step.kids[0].obj; curFrame = F;
        }
        if (!steps.length) return this._rehomeBail(E, o, HO, "no tile ceded: " + (this._rehomeWhy || "?"));
        // Record newest-last, so undo unwinds the chain from the bottom up.
        for (const st of steps) op.baked.push(st);
        // Ceding may have parted the object — the tile that was cut out could
        // have been the only thing joining two halves of the parent. Ask once,
        // over the whole family.
        //
        // Take the key from `cur`, whatever the descent ended on — `o` itself
        // was removed and replaced on the way down.
        const note = this.journal.find((j) => j.kind === "erase" && j.id === E.id);
        if (note) {
            note.cuts.push({ target: o.id, level: HO, mode: "cede",
                through: steps.map((st) => st.pieces.map((pc) => `${pc.level}#${pc.obj.id}`)) });
        }
        this._resplitFamily(op, this.doc.editKey(cur));
        return true;
    }

    /**
     * Why a re-home refused, recorded against the GESTURE.
     *
     * A refusal is invisible: the object is already in the eraser's done set by
     * the time we get here, so the erase never comes back to it, and if nothing
     * else was under the gesture the mark is consumed having done nothing. That
     * is exactly what "I erase and then it just disappears" looks like, and a
     * report of it used to carry no trace of the decision at all.
     */
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
            if (this._doneSet(E.id).has(id)) continue;
            if (!this._eraseMayTouch(E, Erec.level, rec.obj, rec.level)) { this._doneSet(E.id).add(id); continue; }
            if (this._bakeOne(Erec, { obj: rec.obj, level: rec.level })) return true;
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
            if (target) { this._bakeOne(Erec, target); continue; }
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
