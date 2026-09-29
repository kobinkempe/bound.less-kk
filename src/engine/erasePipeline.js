/**
 * The eraser: the whole-object eraser, the pen-up perimeter bake, and the erase bake — a mark (an
 * erase native) cut out of the ink under it, in slices and in workers.
 *
 * A mark records its targets when its shape lands (`_registerMark`, A2-scene.md §4.2). Until it is
 * spent it masks exactly what the rule names (`eraseRule.underMask`: its targets and their pieces,
 * less what it has handled), so anything moved under it later, drawn after it, or already baked
 * shows (PLAN §0 decision 3). The bake cuts each pending pair (mark, target) — marks oldest first,
 * targets top-down — dispatched ahead through the shared pool's queue (`eraseWorkerClient.submit`) and
 * applied strictly in that serial order through a reorder buffer, so a parallel bake leaves the
 * inline bake's document, ids and log (A2 §4.7). The barriers bake a gesture's pending pairs
 * before it selects, moves or judges anything (A2 §4.11).
 *
 * THE INVARIANT: an erase never removes more than the eraser swept.
 * `docs/erase-tile-window-design-bible.md` is the reasoning; the erase suites are the enforcement.
 *
 * Mixed into `KobinEngine.prototype` - see `mixin.js`.
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
import { encodeBelow } from "./geometry/offsets";
import { reachBox } from "./placementModel";
import {
    flattenShape,
    insideShape,
    intersectShape,
    loopsArea,
    loopsBBox,
    repairLoops,
} from "./geometry/arcShape";
import { polygonMissesRect } from "./geometry/lasso";
import { flattenLoops, strokeLoops } from "./geometry/curveOutline";
import { cutJob, dustBarFor } from "./eraseJob";
import { submit, cutSlots, cutQueue } from "./eraseWorkerClient";
import { descentJob } from "./eraseDescent";
import { rectSpan, rectTol } from "./rectMath";
import { zOf, has, withId, withoutId, underMask, inheritErase } from "./eraseRule";

// The flatten tolerance of a mark judging whether it covers a frame whole, in the mark's frame's
// units: a chord sits within it of its arc, so a frame box grown by it that misses every chord
// misses every arc.
const ERASE_FRAME_TOL = 1;

const ERASE_SLICE_MS = 8;
const ERASE_RENDER_MS = 100;   // a bake's steps render at most this often (`_renderSoon`)
/** Pairs the lookahead looks at past the head in one dispatch (A2 §4.7). */
const LOOKAHEAD_SCAN = 64;
/** The reorder buffer's key for pair (mark, target). */
const cutKey = (m, t) => m + "|" + t;
/**
 * A mark's step budget (PLAN §5.8 item 3): each id pending under it costs one step, a step left
 * pending is tried once more, so a bake past 2 × its supply + 8 is a wrong rule; the mark is aborted.
 */
const STEP_BUDGET_PER_ID = 2;
const STEP_BUDGET_MIN = 8;
/** Aborted marks kept for `report()`. */
const ABORTS_KEPT = 12;

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
    // An eraser stroke commits instantly as a mark: until it is spent it masks the targets it
    // recorded when its shape landed, and the bake cuts it out of each of them, in its home frame,
    // in slices and in workers, so the UI never stalls. A gesture that selects, moves or judges ink
    // waits for the cuts under it first (the barriers).
    setEraserSize(px) { this._eraserPx = Math.min(200, Math.max(2, +px || 16)); }
    _zOf(o) { return o.z != null ? o.z : o.id; }
    // ---- the pending marks and the lineage index (A2 §4.6) ----
    /** The erase state, once, from the engine's constructor (after the scene subscribes). */
    _initErase() {
        this._marks = new Map();      // id -> every erase native added and not removed; live ones by `getById`
        this._lineage = new Map();    // mark id -> Set of the natives with it in `targetOf`
        this._order = new Map();      // mark id -> { list, pos, extra }: its lineage top-down (`_headOf`)
        this._silent = new Map();     // mark id -> Set of targets its eraser's box misses: handled in memory only
        this._proj = new Map();       // mark id -> its eraser's loops per (home, table) (`_projected`)
        this._cuts = new Map();       // "mark|target" -> a job in flight or landed and waiting its turn (the reorder buffer)
        this._descentOut = null;      // the one descent in flight: descents run one at a time
        this._barrier = null;         // the parked gesture (`_eraseBarrier`)
        this._follow = null;          // the ids a running barrier follows to their pieces
        this._pressWait = null;       // a parked drag's pointer: its last point and whether it was released
        this._lassoParked = null;     // a parked lasso's loop, still drawn
        this._eraseGen = 0;           // bumped by a reset: a job from before it is dropped when it lands
        this._budget = new Map();     // mark id -> { n: steps taken, supply: ids pending under it } (`_overBudget`)
        this._eraseAborted = [];      // marks whose bake passed its budget, newest last (`report()`)
        this.doc.subscribe((ev) => this._onEraseEvent(ev));
        this.doc.subscribeOps((ev) => this._onEraseStep(ev));
        this._rebuildEraseIndex();
    }
    /** The marks set and the lineage index kept from the document's events; a frame set aside is read through `getById`. */
    _onEraseEvent(ev) {
        const k = ev.kind;
        if (k === "reset") {
            this._eraseGen++;
            this._cuts.clear(); this._descentOut = null; this._budget.clear();
            this._cancelBarrier();
            this._rebuildEraseIndex();
            return;
        }
        if (k === "addFrame") {                    // natives back by reference, no events of their own
            this._order.clear();
            if (!this._eraseReplaying) for (const o of this.doc.list(ev.frame)) if (o.targetOf || o.handledBy) { this._pruneDead(o); this._supplyAdd(o, null); }
            return;
        }
        if ((k !== "add" && k !== "remove") || !ev.obj || (k === "remove" && ev.rehome)) return;
        const o = ev.obj;
        if (o.erase) {
            if (k === "add") { this._marks.set(o.id, o); this._order.delete(o.id); }
            else { this._marks.delete(o.id); this._dropCuts(o.id); }
            return;
        }
        if (k === "add" && !this._eraseReplaying && (o.targetOf || o.handledBy)) this._pruneDead(o);
        if (o.targetOf) for (const m of o.targetOf) { if (k === "add") this._lineageAdd(m, o.id); else this._lineageDelete(m, o.id); }
        if (k === "add" && o.targetOf && !ev.rehome) this._supplyAdd(o, ev.by);
    }
    /** `o` arrived pending under marks other than `by` (another mark's piece, a source an undo returned): their budgets grow. */
    _supplyAdd(o, by) {
        if (!o.targetOf || !this._budget.size) return;
        for (const m of o.targetOf) {
            const b = this._budget.get(m);
            if (b && m !== by && !has(o.handledBy, m)) b.supply++;
        }
    }
    /** Mark M's budget, taken at its first step from what is pending under it then. */
    _stepBudget(M) {
        let b = this._budget.get(M.id);
        if (!b) {
            let supply = 0;
            const s = this._lineage.get(M.id);
            if (s) for (const id of s) { const rec = this.doc.getById(id); if (rec && underMask(rec.obj, M)) supply++; }
            this._budget.set(M.id, (b = { n: 0, supply }));
        }
        return b;
    }
    /**
     * One step of mark E's bake counted. Past its budget the bake is not converging (a wrong rule: a
     * mark cutting its own pieces never empties): the mark is aborted — reported, noted on its
     * journal entry, spent with the cuts it made — and true returned, so no loop can hang the page.
     */
    _overBudget(Erec) {
        const E = Erec.obj, b = this._stepBudget(E), limit = STEP_BUDGET_PER_ID * b.supply + STEP_BUDGET_MIN;
        if (++b.n <= limit) return false;
        let left = 0;
        const s = this._lineage.get(E.id);
        if (s) for (const id of s) { const rec = this.doc.getById(id); if (rec && underMask(rec.obj, E)) left++; }
        const entry = { mark: E.id, steps: b.n - 1, supply: b.supply, limit, left };
        this._eraseAborted.push(entry);
        if (this._eraseAborted.length > ABORTS_KEPT) this._eraseAborted.shift();
        const note = this._noteOf(E.id);
        if (note) note.aborted = entry;
        // eslint-disable-next-line no-console
        console.error("erase: mark " + E.id + " passed its step budget (" + limit + " steps for " + b.supply + " pending ids, " + left + " still pending); aborted and spent");
        this._spendMark(Erec);
        this._emit();
        return true;
    }
    /**
     * Whether mark `id` can mask anything again: in the document (set aside with a frame too), or
     * held by an undone gesture on the redo stack. A spent mark never returns (its gesture undoes by
     * its steps), nor does one whose redo branch a new op cleared; an applied gesture's `strokeRec`
     * outlives its redo and names nothing that can return.
     */
    _markAlive(id) {
        const o = this.doc._byId.get(id);
        if (o && o.erase && !o._gone) return true;
        const r = this.doc._redo, h = this._held;
        if (!h || h.r !== r || h.rl !== r.length || h.rt !== r[r.length - 1]) {
            const set = new Set();
            for (const op of r) if (op.strokeRec && op.strokeRec.obj) set.add(op.strokeRec.obj.id);
            this._held = { r, rl: r.length, rt: r[r.length - 1], set };
        }
        return this._held.set.has(id);
    }
    /** A live native names no mark that cannot return (A2 §4.6): dropped as it re-enters, and at a load. */
    _pruneDead(o) {
        let t = o.targetOf, h = o.handledBy;
        if (t) for (const m of t) if (!this._markAlive(m)) t = withoutId(t, m);
        if (h) for (const m of h) if (!this._markAlive(m)) h = withoutId(h, m);
        if (t !== o.targetOf) { if (t.length) o.targetOf = t; else delete o.targetOf; }
        if (h !== o.handledBy) { if (h.length) o.handledBy = h; else delete o.handledBy; }
    }
    /** A new op forks history: the marks its dropped redo branch held leave the live natives' fields. A bake step replaces what a running barrier follows by its pieces (A2 §4.11 step 3). */
    _onEraseStep(ev) {
        if (ev.kind === "op") { for (const m of [...this._lineage.keys()]) if (!this._markAlive(m)) this._pruneMark(m); return; }
        const f = this._follow;
        if (!f || ev.kind !== "bake" || !ev.step.removed || !f.has(ev.step.removed.obj.id)) return;
        f.delete(ev.step.removed.obj.id);
        for (const pc of ev.step.pieces) f.add(pc.obj.id);
    }
    _rebuildEraseIndex() {
        this._marks.clear(); this._lineage.clear(); this._order.clear(); this._silent.clear(); this._proj.clear();
        for (const k of this.doc.levels()) {
            for (const o of this.doc.list(k)) {
                if (o.erase) this._marks.set(o.id, o);
                else if (o.targetOf) for (const m of o.targetOf) this._lineageAdd(m, o.id);
            }
        }
    }
    _lineageAdd(m, id) {
        let s = this._lineage.get(m);
        if (!s) this._lineage.set(m, (s = new Set()));
        s.add(id);
        const ord = this._order.get(m);
        if (ord) ord.extra.add(id);
    }
    _lineageDelete(m, id) { const s = this._lineage.get(m); if (s) s.delete(id); }
    /** The landed marks, oldest first, as `{obj, level}`: a read of the maintained set (A2 §4.6). */
    _eraseStrokes() {
        const out = [];
        for (const o of this._marks.values()) {
            if (o.type !== "shape") continue;
            const rec = this.doc.getById(o.id);
            if (rec && rec.obj === o) out.push(rec);
        }
        return out.sort((a, b) => (zOf(a.obj) - zOf(b.obj)) || (a.obj.id - b.obj.id));
    }
    /** A mark whose shape has not landed, other than the one being drawn: a reader of the mask resolves it first. */
    _marksUnlanded() {
        for (const o of this._marks.values()) if (o.type === "stroke" && o !== this._drawing && this.doc.getById(o.id)) return true;
        return false;
    }
    /**
     * TEST/BARRIER: every pending perimeter resolved, run to completion, and every landed mark
     * registered. The interactive path is `_bakeTick`, which slices; this is for tests and the
     * barriers, which need the document settled before they look at it.
     */
    flushBakes() {
        let guard = 0;
        for (;;) {
            this._ensureShapeBakes();
            if (!this._bakeJobs.length) break;
            while (this._stepShapeBakes(Infinity)) { if (guard++ > 100000) return; }
            if (guard++ > 100000) return;
        }
        this._registerLanded();
        if (this._renderPending) this._render();   // settled means painted, too
    }
    // Resolve one stroke's perimeter right now, cancelling any queued job for it: an erase has
    // reached an object that has not baked yet. A mark registers in the same commit (A2 §4.2).
    _forceBake(o) {
        if (o.type !== "stroke") return;
        const tol = o._tol > 0 ? o._tol : (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter;
        const res = bakeArcPerimeter(o.pts, o.lwFrame, { tol, centre: o._pen ? o._pen.arcs() : undefined });
        this._bakeQueued.delete(o.id);
        this._bakeJobs = this._bakeJobs.filter((j) => j.id !== o.id);
        const land = () => {
            this.doc.bakeShapeById(o.id, this._sealed(res, o.lwFrame), o.lwFrame);
            const rec = o.erase ? this.doc.getById(o.id) : null;
            if (rec) this._registerMark(rec);
        };
        if (o.erase) this.stage.batch(land); else land();
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
            centre: o._pen ? (o._pen.closeLoop(), o._pen.arcs()) : undefined,   // closeLoop: a stroke ending where it began has one seam tangent
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
            const table = this.doc.promotedTable(rec.obj, rec.level, pid);   // its old frame's shift one level down (A1 C1)
            const lw = rec.obj.lwFrame, w = rec.obj.w;
            this.doc.rehomeById(id, pid);
            this.doc.setGeometryById(id, { ...moved, below: table });
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
            for (const o of this.doc.list(k)) {
                if (o.type !== "stroke" || o === this._drawing) continue;
                this._queueBake(o);
            }
        }
    }
    /** One slice of shape baking. True if work remains. */
    _stepShapeBakes(budgetMs = 8) {
        const t0 = perfNow();
        let changed = false, promoted = false, away = false;
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
            const loops = this._sealed(entry.job.result, entry.w);
            let up = false;
            const land = () => {
                this.doc.bakeShapeById(entry.id, loops, entry.w);
                up = this._promoteOversize(entry.id);                  // D9 / invariant 2
                const m = rec.obj.erase ? this.doc.getById(entry.id) : null;
                if (m) this._registerMark(m);                          // in the landing's commit (A2 §4.2)
            };
            if (rec.obj.erase) this.stage.batch(land); else land();
            if (up) promoted = true;
            else if (this.raster && rec.level !== this.cam.frame) away = true;
            changed = true;
        }
        // The resolved perimeter is the curve already on screen, so it waits for the next render
        // (two renders a pen-up were 185 s of a 203 s jsdom session at 1,000 strokes); `_render`
        // clears the flag and `flushBakes` honours it. The plates hold the raw band until they are
        // re-rastered: a stroke homed in the camera's frame is its own list item, so a camera step
        // re-posts them; one homed elsewhere is a projected copy the old list still holds raw, and
        // plates re-rastered from it stay fresh through later renders — a render re-derives it
        // (OPEN-FLAGS F92). A promotion (D9) renders at once: the object changed frames.
        if (changed) {
            if (promoted || away) this._render();
            else {
                this._renderPending = true;
                if (this.raster) { this._syncStep(); this.renderer.update(); }
            }
        }
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
        // Resolve perimeters first: a mark registers as its shape lands (A2 §4.2).
        if (!this._bakeJobs.length) this._ensureShapeBakes();
        if (this._stepShapeBakes()) { this._scheduleBake(0); return; }
        // A read-only tab shows the store the pen's holder bakes into (SYNC-PLAN R2): it waits for the pen.
        if (this.readOnly) { if (this._eraseStrokes().length) this._scheduleBake(500); return; }
        this._registerLanded();
        if (this._barrier) return;   // a parked gesture drives the cuts it waits on; its end resumes the tick
        // A time budget, like every sliced job here: one pair a tick left a crowded erase eight seconds
        // behind its gesture (94 objects under one of Kobin's strokes).
        const { changed, spent, more } = this._bakeRun(perfNow() + ERASE_SLICE_MS);
        if (spent) this._render(); else if (changed) this._renderSoon();
        if (more) this._scheduleBake(0);
    }
    // ---- registration (A2 §4.2) ----
    /**
     * A landed mark's targets, once: the frames its ink covers whole set aside as one step, then
     * every reachable native under it below its z, in `targets` and in each target's `targetOf`.
     * Nothing can have moved under the mark before this runs: every gesture that moves ink resolves
     * pending perimeters first (the barriers' `flushBakes`), and the mark's op is on top of the undo
     * stack until its shape lands (raster.eraseRule.test.js (c)). A mark from before `targets` (A2
     * §4.9) registers by the same scan under its stepped z, less what its op's steps name — their
     * pieces are its handled lineage. In the caller's commit: its mask reaches the plates with its shape.
     */
    _registerMark(Erec) {
        const E = Erec.obj;
        if (E.targets !== undefined || E.type !== "shape" || !E.loops) return false;
        this.stage.batch(() => {
            this._eraseFramesPass(Erec);
            const op = this._opOf(E.id), named = new Set();
            if (op) {
                for (const st of op.baked || []) {
                    if (st.removed) named.add(st.removed.obj.id);
                    for (const pc of st.pieces || []) {
                        const o = pc.obj;
                        named.add(o.id);
                        o.targetOf = withId(o.targetOf, E.id); o.handledBy = withId(o.handledBy, E.id);
                        if (this.doc.getById(o.id)) this._lineageAdd(E.id, o.id);
                    }
                }
            }
            const ids = this._candidatesUnder(Erec, named);
            for (const id of ids) {
                const o = this.doc.getById(id).obj;
                o.targetOf = withId(o.targetOf, E.id);
                this._lineageAdd(E.id, id);
            }
            this.doc.setTargetsById(E.id, ids);
        });
        return true;
    }
    /** Every landed mark without `targets` registered now: one from before the field, a direct add, one back by a redo (A2 §4.9). */
    _registerLanded() {
        for (const o of [...this._marks.values()]) {
            if (o.targets !== undefined || o.type !== "shape") continue;
            const rec = this.doc.getById(o.id);
            if (rec && rec.obj === o) this._registerMark(rec);
        }
    }
    /**
     * After a load or a replay (A2 §4.9): every known mark's `targets` — live, or held by an op in
     * the undo or redo stacks — back in its targets' `targetOf` (a union: idempotent), and the
     * index rebuilt. A kobin-2 snapshot written before a registration lacks them; no entry carries them.
     */
    _deriveTargetOf() {
        const marks = new Set(this._marks.values());
        for (const op of this.doc._undo.concat(this.doc._redo)) if (op.strokeRec && op.strokeRec.obj) marks.add(op.strokeRec.obj);
        for (const M of marks) {
            if (!M.targets) continue;
            for (const id of M.targets) { const o = this.doc._byId.get(id); if (o && !o.erase) o.targetOf = withId(o.targetOf, M.id); }
        }
        this._held = null;
        for (const o of this.doc._byId.values()) if (!o.erase && (o.targetOf || o.handledBy)) this._pruneDead(o);
        this._rebuildEraseIndex();
    }
    /** A document loaded and its log replayed: the lineage derived, and a mark from before `targets` registered — its `targets` logged once. */
    _eraseLoaded() {
        this._deriveTargetOf();
        if (!this.readOnly) this._registerLanded();
    }
    /** Mark `id`'s gesture op, without minting one. */
    _opOf(id) {
        const op = this._eraseCommits.get(id);
        if (op && op.op === "eraseCommit") return op;
        const u = this.doc._undo;
        for (let i = u.length - 1; i >= 0; i--) if (u[i].op === "eraseCommit" && u[i].strokeId === id) return u[i];
        return null;
    }
    /**
     * The registration's scan: every reachable native under mark E's box, below its z, whose box the
     * eraser's box reaches (`_rectMayTouch`), less `exclude`; ascending ids. From the frames' indexes
     * for a native drawn at its stored bits; a displaced one (F41/F55, a shifted frame's, A1 C1)
     * through its picture table, the box mapped once per (home, table) — mapped per object, 19,547
     * moved natives took 300 ms on the Magnum Opus (TESTER-2). Once per mark (EC-1).
     */
    _candidatesUnder(Erec, exclude = null) {
        const E = Erec.obj, HE = Erec.level, zE = zOf(E);
        this._scanBuilds = (this._scanBuilds || 0) + 1;
        const box = loopsBBox(E.loops);
        if (!box) return [];
        const rectE = { left: box.x0, top: box.y0, right: box.x1, bottom: box.y1 };
        const out = new Set();
        const keep = (o) => !o.erase && !out.has(o.id) && !(exclude && exclude.has(o.id)) && zOf(o) < zE;
        for (const k of this.doc.levels()) {
            if (this.lm.frameFactor(k, HE) == null) continue;
            const r = this.lm.mapRectF(rectE, HE, k);
            if (!r) continue;
            for (const o of this.doc.queryRect(k, r)) if (!this.doc.tableOf(o, k) && keep(o) && this._rectMayTouch(r, o)) out.add(o.id);
        }
        const rectIn = new Map();
        for (const [o, home, T] of this.doc.displacedNatives()) {
            if (!keep(o) || this.lm.frameFactor(home, HE) == null) continue;
            const key = home + "|" + (encodeBelow(T) || []).join(";");
            let r = rectIn.get(key);
            if (r === undefined) { r = this._eraserRectInto(rectE, HE, o); rectIn.set(key, r); }
            if (r && this._rectMayTouch(r, o)) out.add(o.id);
        }
        return [...out].sort((a, b) => a - b);
    }
    /**
     * A frame the mark covers WHOLE goes as containers (SUBTREE-O1-PLAN §5; Kobin: an erase
     * completely covering a frame removes everything under it as one entry). Whole means the
     * frame's cell plus the reach its content may have (invariant 2), grown by the flatten's
     * tolerance, inside the mark's ink; and nothing under it drawn above the mark
     * (`Document.maxZUnder`: a native drawn since, or a piece a cut minted, keeps the frame on
     * the per-object path). One bake step holds the subtree's lists by reference, O(frames),
     * no cut, one undo with the gesture. Runs once, at the mark's registration (A2 §4.2): its
     * events carry `by`, inside the landing's dirt. Returns how many went.
     */
    _eraseFramesPass(Erec) {
        const E = Erec.obj, HE = Erec.level;
        if (E.type !== "shape" || !E.loops) return 0;
        const zE = this._zOf(E);
        const box = loopsBBox(E.loops);
        if (!box) return 0;
        const tol = ERASE_FRAME_TOL;
        const polys = flattenShape(E.loops, tol);
        if (!polys.length) return 0;
        const inside = (rect) => insideShape(E.loops, [rect.left, rect.top]) && polys.every((p) => polygonMissesRect(p, rect));
        const covered = [];
        // The lasso's walk (`_lassoFind`): out from the mark's frame, one hop at a time, a
        // frame's box +-REACH in its units brought into HE's; a covered frame is taken and
        // not descended into, one blocked by z is, its kids judged on their own.
        const visit = (id, s, tx, ty, skip) => {
            const own = reachBox(this.lm.frame(id), s, tx, ty, tol);
            if (own.right < box.x0 || own.left > box.x1 || own.bottom < box.y0 || own.top > box.y1) return;
            if (id !== HE && inside(own) && this.doc.maxZUnder(id) < zE) { covered.push(id); return; }
            for (const c of this.lm.childrenOf(id)) {
                if (!c || c.id === skip || !c.centre) continue;
                visit(c.id, s / CROSS_RATIO, c.centre.x * s + tx, c.centre.y * s + ty, null);
            }
        };
        visit(HE, 1, 0, 0, null);
        let child = this.lm.frame(HE), s = 1, tx = 0, ty = 0;
        while (child && child.parent != null) {
            const c = child.centre;
            if (!c) break;
            s *= CROSS_RATIO; tx -= c.x * s; ty -= c.y * s;
            visit(child.parent, s, tx, ty, child.id);
            child = this.lm.frame(child.parent);
        }
        let n = 0;
        if (!covered.length) return 0;
        const op = this._eraseOp(E);
        const note = this.journal.find((j) => j.kind === "erase" && j.id === E.id);
        for (const F of covered) {
            const recs = this.doc.removeFrameSubtree(F, { by: E.id });
            if (!recs) continue;                         // empty containers: nothing to take
            this.doc.recordBake(op, { frames: recs });
            if (note) note.cuts.push({ frame: F, mode: "frame", natives: recs.reduce((a, r) => a + r.natives.length, 0) });
            n++;
        }
        return n;
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
        const r = this._eraserRectInto({ left: eb.x0, top: eb.y0, right: eb.x1, bottom: eb.y1 }, HE, o);
        return !!r && this._rectMayTouch(r, o);
    }
    /** Whether the eraser's rect `r`, in `o`'s stored coordinates, meets its box — a shape's, loop by loop. */
    _rectMayTouch(r, o) {
        const m = o.type === "stroke" ? (o.lwFrame || 0) / 2 : 0;
        const hits = (a) => r.right >= a.x0 - m && r.left <= a.x1 + m && r.bottom >= a.y0 - m && r.top <= a.y1 + m;
        if (!hits(bboxOf(o, this.store.live))) return false;
        if (o.type !== "shape") return true;
        for (const loop of o.loops) {
            const lb = loopsBBox([loop]);
            if (lb && hits(lb)) return true;
        }
        return false;
    }
    /**
     * An eraser's rect, drawn in frame `HE`, in the coordinates object `o` is STORED in (its home):
     * the scene's `placeNative` (A2 §2.6) — for a moved object (F41/F55) the remainder off, then the
     * exact chain from the frame its picture is read from; with no table the chain alone, bit for bit.
     */
    _eraserRectInto(rect, HE, o) { return this.stage.placeNative(o, HE).toStored(rect); }
    /** The same, for the eraser's LOOPS. */
    _eraserLoopsInto(loops, HE, o) { return this.stage.placeNative(o, HE).toStored(loops); }
    /** Mark E's loops in `o`'s stored coordinates, memoised per (home, picture table): targets moved together share it (A2 §4.7). */
    _projected(E, HE, o) {
        const tag = this.lm.addrEpoch + "|" + HE + "|" + (E._ver || 0);
        let m = this._proj.get(E.id);
        if (!m || m.tag !== tag) this._proj.set(E.id, (m = { tag, map: new Map() }));
        const key = o._home + "|" + (encodeBelow(this.doc.tableOf(o)) || []).join(";");
        let loops = m.map.get(key);
        if (loops === undefined) { loops = this._eraserLoopsInto(E.loops, HE, o); m.map.set(key, loops); }
        return loops;
    }
    // Resolve (or re-register) the gesture's undo op. Always call this BEFORE
    // touching the document: a bake that cannot record itself must not mutate
    // anything — unrecorded bakes were how duplicated, stacked geometry formed.
    // After a reload the commit map is empty, so resumed baking registers a
    // fresh op, which also makes a resumed erase undoable again.
    _eraseOp(E) {
        let op = this._eraseCommits.get(E.id);
        if (!op || op.op !== "eraseCommit") {
            // A commit redone after a reload is on the undo stack but not in the map: minting another
            // wiped the redo branch and split the gesture in two (REVIEWER-2 U-4).
            const u = this.doc._undo;
            op = null;
            for (let i = u.length - 1; i >= 0 && !op; i--) if (u[i].op === "eraseCommit" && u[i].strokeId === E.id) op = u[i];
            if (!op) {
                op = { op: "eraseCommit", strokeId: E.id, strokeRec: null, baked: [] };
                this.doc.pushUndo(op);
            }
            this._eraseCommits.set(E.id, op);
        }
        return op;
    }
    // ---- the bake: pairs in the serial order, a reorder buffer (A2 §4.7) ----
    /** Is (M, o) a pair the bake still owes — under M's mask, and not ruled out by the eraser's box? */
    _pendingPair(M, o) {
        if (!underMask(o, M)) return false;
        const s = this._silent.get(M.id);
        return !s || !s.has(o.id);
    }
    /** A pair the tighter box test rules out: handled in memory only — no pixel of it is under the mask; a reload re-derives it. */
    _silentAdd(m, id) {
        let s = this._silent.get(m);
        if (!s) this._silent.set(m, (s = new Set()));
        s.add(id);
    }
    /** Mark M's lineage in the serial order, top-down by (z, id), with a cursor past what is no longer pending. */
    _orderOf(M) {
        let ord = this._order.get(M.id);
        // Keyed by the z each id had when it joined (a native's z never changes; a piece inherits it): a
        // removed id keeps its place, so the order is a function of the ids alone, whenever they arrive.
        const zk = (id) => { let z = ord.z.get(id); if (z === undefined) { const o = this.doc._byId.get(id); ord.z.set(id, (z = o ? zOf(o) : -Infinity)); } return z; };
        const cmp = (a, b) => (zk(b) - zk(a)) || (b - a);
        if (!ord) {
            const s = this._lineage.get(M.id);
            ord = { list: s ? [...s] : [], pos: 0, extra: new Set(), z: new Map() };
            ord.list.sort(cmp);
            this._order.set(M.id, ord);
        } else if (ord.extra.size) {
            for (const id of ord.extra) {
                if (ord.list.indexOf(id, ord.pos) >= 0) continue;
                let lo = ord.pos, hi = ord.list.length;
                while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(ord.list[mid], id) < 0) lo = mid + 1; else hi = mid; }
                ord.list.splice(lo, 0, id);
            }
            ord.extra.clear();
        }
        return ord;
    }
    /** Mark E's first pending target in the serial order, `{obj, level}`, or null. */
    _headOf(Erec) {
        const M = Erec.obj, ord = this._orderOf(M);
        for (; ord.pos < ord.list.length; ord.pos++) {
            const rec = this.doc.getById(ord.list[ord.pos]);
            if (rec && this._pendingPair(M, rec.obj)) return rec;
        }
        return null;
    }
    /** Mark E's pending targets in the serial order, from its head on. */
    *_pendingOf(Erec) {
        const M = Erec.obj, ord = this._orderOf(M);
        for (let k = ord.pos; k < ord.list.length; k++) {
            const rec = this.doc.getById(ord.list[k]);
            if (rec && this._pendingPair(M, rec.obj)) yield rec;
        }
    }
    /** The serial head: the oldest mark and its first pending target, `{Erec, rec}` — `rec` null when that mark has nothing left — or null. */
    _serialHead() {
        const Erec = this._eraseStrokes()[0];
        return Erec ? { Erec, rec: this._headOf(Erec) } : null;
    }
    /**
     * The bake's work until `deadline`: the serial head applied when its job has landed (run inline
     * where there is no worker), a mark with nothing pending spent in its turn, then the lookahead
     * dispatched. It stops at a head still in flight: results apply strictly in serial order, so ids,
     * steps and the log are the inline bake's. `more`: work is left that waits on no worker.
     */
    _bakeRun(deadline) {
        let changed = false, spent = false, stepped = 0, more = false, last = null;
        for (let guard = 0; guard < 100000; guard++) {
            const head = this._serialHead();
            if (!head) break;
            const { Erec, rec } = head;
            if (!rec) { this._spendMark(Erec); changed = spent = true; continue; }
            const key = cutKey(Erec.obj.id, rec.obj.id);
            // A pair its own inline step left pending is set aside, not looped on.
            if (key === last) { this._silentAdd(Erec.obj.id, rec.obj.id); last = null; continue; }
            const c = this._cuts.get(key);
            if (c && c.state === "flight") break;
            if (c) { this._dropCut(c); if (this._applyLanded(Erec, rec, c)) changed = true; continue; }
            // Look before leaping, at what the last pair cost; one pair a tick always runs, or a pair
            // costing more than the budget is refused for ever (BS-3).
            if (stepped > 0 && perfNow() + (this._eraseItemMs || 0) > deadline) { more = true; break; }
            const t0 = perfNow();
            const out = this._dispatchPair(Erec, rec);
            if (out === "flight" || out === "wait") break;
            last = key;
            this._eraseItemMs = perfNow() - t0;
            stepped++;
            if (out === "applied") changed = true;
            if (perfNow() >= deadline) { more = true; break; }
        }
        if (!more) this._lookahead();
        return { changed, spent, more };
    }
    /** Dispatch ahead of the head in the serial order, up to the pool's free slots: a target pending under an earlier mark waits for that mark's pieces (the per-target lock). */
    _lookahead() {
        let free = cutSlots(this._cutQ());
        if (free <= 0) return;
        const marks = this._eraseStrokes();
        let scanned = 0;
        for (let mi = 0; mi < marks.length; mi++) {
            for (const rec of this._pendingOf(marks[mi])) {
                if (++scanned > LOOKAHEAD_SCAN) return;
                const id = rec.obj.id;
                let busy = false;
                for (const c of this._cuts.values()) if (c.id === id) { busy = true; break; }
                if (busy) continue;
                let locked = false;
                for (let e = 0; e < mi && !locked; e++) locked = this._pendingPair(marks[e].obj, rec.obj);
                if (locked) continue;
                if (this._dispatchPair(marks[mi], rec, { ahead: true }) === "flight" && --free <= 0) return;
            }
        }
    }
    /** TEST: the serial head baked inline, or the oldest mark spent; false when nothing is pending. */
    _bakeNext() {
        this._registerLanded();
        const head = this._serialHead();
        if (!head) return false;
        if (!head.rec) { this._spendMark(head.Erec); return true; }
        const c = this._cuts.get(cutKey(head.Erec.obj.id, head.rec.obj.id));
        if (c) this._dropCut(c);
        this._dispatchPair(head.Erec, head.rec, { inline: true });
        return true;
    }
    /**
     * Bake pair (E, target): its job built, then sent to the pool — a promise landing in the reorder
     * buffer — or, where there is no worker or `inline`, run and applied now. `ahead`: dispatch
     * only. Returns "flight", "wait" (a descent is out: they run one at a time), "applied",
     * "handled" (settled without a cut) or "none".
     */
    _dispatchPair(Erec, target, { ahead = false, barrier = false, inline = false } = {}) {
        const E = Erec.obj, HE = Erec.level;
        const o0 = target.obj;
        // A lookahead changes nothing in the document: a target still to resolve waits for its turn.
        if (ahead && (E.type !== "shape" || o0.type !== "shape")) return "none";
        if (E.type === "stroke") this._forceBake(E);              // called on a mark not yet landed: it lands and registers
        if (o0.type === "stroke") this._forceBake(o0);            // an erase reached it first
        if (o0.type === "fill") this.doc.fillToShapeById(o0.id);  // a pre-arc drawing
        const rec = this.doc.getById(o0.id);
        if (!rec) return "none";
        const o = rec.obj, HO = rec.level;
        if (!this._eraseMayTouch(E, HE, o, HO)) { this._silentAdd(E.id, o.id); return "handled"; }
        if (o.type !== "shape") return this._overBudget(Erec) ? "none" : this._refuse(E, o, HO, "target is a " + o.type + " with no perimeter", false) || "handled";
        const spec = this._jobFor(E, HE, o, HO);
        if (!spec) { this._silentAdd(E.id, o.id); return "handled"; }
        if (!inline) {
            if (spec.kind === "descent" && this._descentOut) return ahead ? "none" : "wait";
            const key = cutKey(E.id, o.id), ver = o._ver || 0;
            const p = submit(this._cutQ(), { kind: spec.kind, barrier, job: spec.kind === "cut" ? spec.job : { world: spec.world, input: spec.input } });
            if (p) {
                const c = { key, markId: E.id, id: o.id, obj: o, ver, addr: this.lm.addrEpoch, gen: this._eraseGen, kind: spec.kind, spec, state: "flight", r: null, err: null, t0: perfNow() };
                this._cuts.set(key, c);
                if (spec.kind === "descent") this._descentOut = c;
                p.then((r) => this._onLanded(c, r, null), (err) => this._onLanded(c, null, err));
                return "flight";
            }
            if (ahead) return "none";
        }
        let r;
        if (spec.kind === "descent") { const t0 = perfNow(); try { r = descentJob(spec.world, spec.input); } finally { this._perf("rehome", t0, false, { id: o.id }); } }
        else r = cutJob(spec.job);
        return this._applyPair(Erec, rec, spec.kind, r) ? "applied" : "handled";
    }
    /**
     * Pair (E, o)'s job: a descent when the target is homed shallower along the mark's own chain —
     * the hole belongs at the level the mark was drawn at, one crossing at a time (bible §2.1; ink
     * homed in a ring neighbour's cell cedes down the mark's chain below it, REVIEWER-3 ERASE-4) —
     * else a cut in the target's stored coordinates, the eraser brought there through its table
     * (F41), which keeps every piece it does not cut bit for bit (F42). Null: the eraser maps to nothing.
     */
    _jobFor(E, HE, o, HO) {
        const desc = this.lm.framePath(HO, HE);
        const pureDescent = !!desc && !desc.up.length && desc.down.length > 0;
        const dHO = this.lm.depthOf(HO);
        const ringA = desc && desc.up.length ? desc.down.find((f) => this.lm.depthOf(f) === dHO) : null;
        const ring = !!ringA && !!this._cellOffset(HO, ringA) && desc.down.some((f) => this.lm.depthOf(f) > dHO);
        if (dHO < this.lm.depthOf(HE) && (pureDescent || ring)) {
            return { kind: "descent", world: this._descentWorld(), input: { freezeR: this._boolOpts().freezeR, HE, target: { obj: o, level: HO }, E: { id: E.id, w: E.w, bakePx: E.bakePx, loops: E.loops } } };
        }
        const clip = this._projected(E, HE, o);
        if (!clip || !clip.length) return null;
        // Dust is what was invisible at the mark's zoom (F66): a quarter pixel there, through the frame factor.
        return { kind: "cut", job: { subject: o.loops, clip, w: o.w, dustBar: dustBarFor(E.bakePx, this.lm.frameFactor(HE, HO)), freezeR: this._boolOpts().freezeR, graze: "cut" } };
    }
    /** A worker's job has landed: into the reorder buffer, then the tick or the parked barrier applies it in its turn. */
    _onLanded(c, r, err) {
        if (this._destroyed) return;
        if (this._descentOut === c) this._descentOut = null;
        if (this._cuts.get(c.key) !== c) { this._cutStale = (this._cutStale || 0) + 1; if (this._barrier) this._barrierStep(); else this._scheduleBake(0); return; }
        c.state = "landed"; c.r = r; c.err = err;
        if (this._barrier) this._barrierStep(); else this._scheduleBake(0);
    }
    /** The queue cuts go through: the renderer's, where plates and cuts share the pool (A3 §4.1), else the engine's own. */
    _cutQ() { return this.renderer.queue || this._cutQueue || (this._cutQueue = cutQueue()); }
    /**
     * A landed job applied in its turn, if still valid: the target live and unchanged (`_ver`: a
     * move or a settle projected the eraser through another table), the pair still pending, the
     * lattice not re-addressed, the document not reloaded. A job the pool lost is refused here.
     */
    _applyLanded(Erec, rec, c) {
        const valid = c.gen === this._eraseGen && rec.obj === c.obj && (rec.obj._ver || 0) === c.ver
            && this.lm.addrEpoch === c.addr && this._pendingPair(Erec.obj, rec.obj);
        if (!valid) { this._cutStale = (this._cutStale || 0) + 1; return false; }
        let r = c.r;
        if (c.err || !r) return this._refuseLost(Erec, rec, c);
        const tA = perfNow();
        try { return this._applyPair(Erec, rec, c.kind, r); }
        finally { this._perf(c.kind === "descent" ? "descentApply" : "cutApply", tA, true, { kind: c.kind === "descent" ? (r.refused ? "refused" : "steps:" + r.steps.length) : r.kind, workerMs: Math.round(tA - c.t0) }); }
    }
    /** A job the pool lost (the watchdog, a second worker error, a throw in the worker): the pair refused over ink (PLAN §5.9 item 1). */
    _refuseLost(Erec, rec, c) {
        if (this._overBudget(Erec)) return false;
        this._cutRefused = (this._cutRefused || 0) + 1;
        this._refuse(Erec.obj, rec.obj, rec.level, "worker: " + ((c.err && c.err.why) || "lost"), false);
        return true;
    }
    _applyPair(Erec, rec, kind, r) {
        if (this._overBudget(Erec)) return false;
        return kind === "descent" ? this._applyDescent(Erec, rec, r) : this._applyCut(Erec, rec, r);
    }
    _dropCut(c) {
        if (this._cuts.get(c.key) === c) this._cuts.delete(c.key);
        if (this._descentOut === c) this._descentOut = null;
    }
    /** Every job of mark `id` dropped (it left the document): their late answers are ignored. */
    _dropCuts(id) { for (const c of [...this._cuts.values()]) if (c.markId === id) this._dropCut(c); }
    /** A cut or a descent is in a worker. */
    _eraseBusy() { for (const c of this._cuts.values()) if (c.state === "flight") return true; return false; }
    /** Mark E's pairs all handled: it is removed (logged `spent`; its box re-rastered exactly) and its id pruned from its lineage (A2 §4.6). */
    _spendMark(Erec) {
        const E = Erec.obj;
        this._noteSpent(E);
        this._keepDebugMark(E);
        this.doc.removeById(E.id);
        this._eraseCommits.delete(E.id);
        this._pruneMark(E.id);
    }
    /** A spent mark's id off the live natives of its lineage: it never comes back (its gesture undoes by its steps). */
    _pruneMark(id) {
        const s = this._lineage.get(id);
        if (s) {
            for (const x of s) {
                const rec = this.doc.getById(x);
                if (!rec) continue;
                const o = rec.obj, t = withoutId(o.targetOf, id), h = withoutId(o.handledBy, id);
                if (t && t.length) o.targetOf = t; else delete o.targetOf;
                if (h && h.length) o.handledBy = h; else delete o.handledBy;
            }
        }
        this._lineage.delete(id); this._order.delete(id); this._silent.delete(id); this._proj.delete(id); this._budget.delete(id);
    }
    /** Mark E's bake leaves `o` whole — a refusal: handled, its ink under the mark showing again unless `inkless` (A2 §5.7). */
    _refuse(E, o, HO, why, inkless) {
        this.doc.setHandledById(o.id, E.id, { inkless });
        return this._rehomeBail(E, o, HO, why);
    }
    _noteOf(id) { return this.journal.find((j) => j.kind === "erase" && j.id === id); }
    /**
     * One render within ERASE_RENDER_MS for a bake's steps: a render per landed cut or per slice was
     * most of a bake's main thread on a big drawing (REVIEWER E-2). A spent mark renders now. On the
     * raster path a cut under its mark has already staled only its band (PLAN §5.3 A2-Q2).
     */
    _renderSoon() {
        if (this._renderSoonTimer != null) return;
        this._renderSoonTimer = setTimeout(() => {
            this._renderSoonTimer = null;
            if (!this._destroyed) this._render();
        }, ERASE_RENDER_MS);
    }
    /**
     * The document side of a cut: `cutJob`'s answer applied — the sealed-boolean and dust tallies,
     * then the replacement or the removal, `by` the mark (its pieces inherit the lineage with the
     * mark handled, A2 §4.3), recorded on the gesture's op before anything changes. A graze handles
     * the target: nothing of it lay under the mark (F109). Returns true when the document changed.
     */
    _applyCut(Erec, target, r) {
        const E = Erec.obj;
        const { obj: o, level: HO } = target;
        if (!this.doc.getById(E.id) || !this.doc.getById(o.id)) return false;
        this._noteSeal({ stats: r.stats }, o);
        this._dustCulled = (this._dustCulled || 0) + (r.dust || 0);
        if (r.kind === "grazed") { this.doc.setHandledById(o.id, E.id, { inkless: true }); return false; }
        const op = this._eraseOp(E);
        const note = this._noteOf(E.id);
        const areaBefore = o.loops ? loopsArea(o.loops) : 0;
        let step;
        if (r.kind === "cut") {
            const wasKey = this.doc.editKey(o), inFamily = o.editId != null;
            const cut = this.doc.eraseReplaceById(o.id, r.regions, E.id, r.dustBoxes || null);
            if (!cut) return false;
            if (note) {
                note.cuts.push({ target: o.id, level: HO, mode: "cut",
                    areaBefore: +areaBefore.toFixed(2),
                    into: cut.pieces.map((x) => ({ id: x.id, area: +loopsArea(x.loops).toFixed(2) })),
                    sealed: (r.stats && r.stats.sealed) || 0 });
            }
            step = { removed: cut.removed, pieces: cut.pieces.map((obj) => ({ obj, level: cut.removed.level })) };
            // Whether a cut inside a multi-level family parted the OBJECT is a question about the whole family, once the geometry settles.
            if (r.regions.length > 1 && inFamily) { this.doc.recordBake(op, step); this._resplitFamily(op, wasKey); return true; }
        } else {
            const removed = this.doc.removeById(o.id, { by: E.id });   // nothing survives
            if (!removed) return false;
            if (note) note.cuts.push({ target: o.id, level: HO, mode: "removed", areaBefore: +areaBefore.toFixed(2) });
            step = { removed, pieces: [] };
        }
        this.doc.recordBake(op, step);
        return true;
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
            for (const o of this.doc.list(L)) {
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
                    // A kid in the next cell is brought into this one's coordinates: they differ by whole
                    // frames, exactly. Compared raw, a two-cell cede's kids never met (F124).
                    const d = this._cellOffset(kid.level, up.level);
                    if (!d) continue;
                    const r = up.obj.attachRect, Rj = { x0: r.x0 + d[0], y0: r.y0 + d[1], x1: r.x1 + d[0], y1: r.y1 + d[1] };
                    if (Rj.x1 < R.x0 - rectTol(R) || Rj.x0 > R.x1 + rectTol(R) || Rj.y1 < R.y0 - rectTol(R) || Rj.y0 > R.y1 + rectTol(R)) continue;
                    let rings = this._inkOutline(up.obj, rectTol(R));
                    if (d[0] || d[1]) rings = rings.map((ring) => ring.map((p) => [p[0] + d[0], p[1] + d[1]]));
                    if (arcsTouch(kidArcs, contactArcs(rings, R, rectTol(R)), rectTol(R) / rectSpan(R))) G.union(i, j);
                    continue;
                }
                if (upDepth !== kidDepth - 1) continue;
                const Rk = { left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 };
                // The kid's window is in unmoved numbers (it is the store's
                // piece for the square), so it maps to the parent's stored
                // coordinates through the parent's UNMOVED frame at the kid's
                // level (F55) — the exact chain, no remainder involved.
                const upT = this.doc.tableOf(up.obj, up.level);
                const upF0 = upT ? this.lm.objShift(upT, up.level, kid.level) : null;
                const Rp = upF0 ? this.lm.mapRectF(Rk, upF0.F0, up.level) : this.lm.mapRectF(Rk, kid.level, up.level);
                if (!Rp) continue;
                const at = Math.max(rectTol(R) / rectSpan(R), rectTol(Rp) / rectSpan(Rp));
                if (arcsTouch(kidArcs, contactArcs(this._inkOutline(up.obj, rectTol(Rp)), Rp, rectTol(Rp)), at)) G.union(i, j);
            }
        }
        const ids = members.map((_, i) => i);
        // A member whose frame the lattice lacks cannot be asked about its doorway (F104).
        const unresolved = ids.filter((i) => this.lm.depthOf(members[i].level) == null);
        return { members, classes: G.classes(ids), unresolved };
    }
    /** What to add to frame `B`'s coordinates to read them in frame `A`, a cell of the same depth at most one away; null past that. */
    _cellOffset(A, B) {
        if (String(A) === String(B)) return [0, 0];
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const n = (di || dj) ? this.lm.peekNeighbour(A, di, dj) : null;
                if (n && String(n.id) === String(B)) return [di * FRAME_W, dj * FRAME_W];
            }
        }
        return null;
    }
    /**
     * Re-label a family into its connected components. Returns true if it came
     * apart. Pure identity: no geometry is touched, because by now there is none
     * left to cut.
     */
    _resplitFamily(op, key) {
        const comp = this._familyComponents(key);
        const { members, unresolved } = comp;
        let classes = comp.classes;
        // "Cannot evaluate" is not "disconnected" (F104): a member whose frame is missing, and a
        // component of kids alone (their doorway may be that member), keep the family's key.
        if (unresolved.length && classes.length > 1) {
            const lost = new Set(unresolved);
            const keep = (c) => c.some((i) => lost.has(i)) || c.every((i) => members[i].obj.attachRect);
            classes = [classes[0].concat(...classes.slice(1).filter(keep))].concat(classes.slice(1).filter((c) => !keep(c)));
        }
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
        if (rekeys.length) { this.doc.keysChanged(rekeys.map((r) => r.id)); this.doc.recordBake(op, { rekey: rekeys }); }
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
    /** The descent's world: the engine's own frame math and derive parameters (eraseDescent.js). */
    _descentWorld() { return { lm: this.lm, cfg: this.cfg, width: this.lm.width, opacityGroups: this.store.opacityGroups }; }
    /**
     * The document side of a descent: the family swapped for the new one. Each step's removal is the
     * target or a piece this apply minted a step earlier; the new objects take real ids in the order
     * the cedes minted them, so the result is the in-place descent's; every piece takes `targetOf` and
     * `handledBy` from the LIVE target, with the mark handled (a registration may have landed while the
     * job was out, A2 §4.3). Recorded newest-last on the op, so undo unwinds the chain from the bottom
     * up; then the family is asked whether it is still one object. A refusal handles the target.
     */
    _applyDescent(Erec, target, r) {
        const E = Erec.obj;
        const { obj: o, level: HO } = target;
        for (const sl of r.stats.seals) { this._boolFailures = (this._boolFailures || 0) + 1; this._lastBoolFailure = { ...sl }; }
        this._dustCulled = (this._dustCulled || 0) + (r.stats.dust || 0);
        if (r.refused) return this._refuse(E, o, HO, r.refused, !!r.inkless);
        const cur = this.doc.getById(o.id);
        if (!cur || cur.obj !== o || !this.doc.getById(E.id)) return false;
        // The frames the job minted on its own lattice copy, here first (F67): a kid's home must exist before the store or the index can place it.
        if (r.minted && r.minted.length) this.lm.merge({ frames: r.minted });
        for (const st of r.steps) for (const sp of st.parents.concat(st.kids)) if (!this.lm.frame(sp.level)) return this._refuse(E, o, HO, "a piece's frame is missing", false);
        const op = this._eraseOp(E);
        const lineage = { targetOf: o.targetOf, handledBy: o.handledBy };
        const idMap = new Map(), real = (vid) => (vid < 0 ? idMap.get(vid) : vid), steps = [];
        for (const st of r.steps) {
            const removed = this.doc.removeById(real(st.removedId), { by: E.id, dust: st.dust || null });
            if (!removed) break;   // cannot happen: ours, or the target checked above
            const mint = (sp) => {
                const obj = inheritErase({ ...sp.obj, id: this.doc.allocId() }, lineage, E.id);
                this.doc.add(obj, sp.level, { by: E.id });
                idMap.set(sp.vid, obj.id);
                return { obj, level: String(sp.level) };
            };
            steps.push({ removed, pieces: st.parents.map(mint).concat(st.kids.map(mint)) });
        }
        for (const st of steps) this.doc.recordBake(op, st);
        const note = this._noteOf(E.id);
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
    /** A mark is spent: if it never cut anything, what it looked at — its targets — goes on its journal note. */
    _noteSpent(E) {
        const note = this._noteOf(E.id);
        if (!note || (note.cuts && note.cuts.length)) return;
        const t = E.targets || [];
        note.spent = { considered: t.slice(0, 24), nConsidered: t.length, refused: (note.refused || []).length, pending: this._eraseStrokes().length };
    }
    // ---- the barriers (A2 §4.11) ----
    /**
     * Bake the pending pairs `pairsOf(b)` names, then run `then(followed, b)` — nothing is selected,
     * moved or judged before its cuts land (PLAN §0 decision 3). Rounds: every named pair whose
     * target is not pending under an earlier mark (the per-target lock), applied in serial order; the
     * pieces still pending under another mark form the next round, so a target under k marks takes k
     * rounds and no cap is needed. `follow`: ids replaced by their pieces as steps land. Where there
     * is no worker the rounds run inline and `then` runs before this returns true; otherwise the
     * gesture is parked (false) until its last round has applied — a new press, a tool change, an
     * undo or a pinch cancels it (`_cancelBarrier`), and its cuts go on as the bake's.
     */
    _eraseBarrier(kind, pairsOf, then, follow = null) {
        this._cancelBarrier();
        const b = { kind, pairsOf, then, follow: new Set(follow || []), keys: new Set(), t0: perfNow(), rounds: 0, press: this._pressWait, lasso: false, prev: null };
        // Pending perimeters resolve first: a mark registers before anything moves under it (A2 §4.2),
        // and a selection moves shapes, not raw strokes. A lasso with no mark pending costs nothing more.
        if (kind !== "lasso" || this._marks.size) this.flushBakes();
        if (!this._marks.size) { then([...b.follow].filter((id) => this.doc.getById(id)), b); return true; }
        this._barrier = b; this._follow = b.follow;
        if (this._barrierAdvance(b)) return true;
        this._emit();
        return false;
    }
    /** A job landed while a gesture is parked: its round goes on. */
    _barrierStep() { const b = this._barrier; if (b) this._barrierAdvance(b); }
    /** Rounds until one waits on a worker (false) or none is left and `then` has run (true). */
    _barrierAdvance(b) {
        for (let guard = 0; guard < 100000 && this._barrier === b; guard++) {
            if (b.keys.size) {
                const cs = [...b.keys].map((k) => this._cuts.get(k)).filter(Boolean);
                if (cs.some((c) => c.state === "flight")) return false;
                b.keys.clear();
                const rank = new Map(this._eraseStrokes().map((m, i) => [m.obj.id, i]));
                const zAt = (c) => zOf(c.obj);
                cs.sort((p, q) => ((rank.get(p.markId) ?? 1e9) - (rank.get(q.markId) ?? 1e9)) || (zAt(q) - zAt(p)) || (q.id - p.id));
                for (const c of cs) {
                    this._dropCut(c);
                    const M = this.doc.getById(c.markId), rec = this.doc.getById(c.id);
                    if (M && rec && M.obj.erase) this._applyLanded(M, rec, c);
                }
                if (this._barrier !== b) return true;
            }
            const round = this._barrierRound(b);
            if (!round.length) { this._finishBarrier(b); return true; }
            b.rounds++;
            // The round's fills become shapes before any pair is dispatched: inline, a pair applies before
            // the next is promoted, so the log's `put`s and `bake`s would read in another order in workers.
            for (const { rec } of round) if (rec.obj.type === "fill") this.doc.fillToShapeById(rec.obj.id);
            let parked = false;
            const ran = new Set();
            for (const { Erec, rec } of round) {
                const key = cutKey(Erec.obj.id, rec.obj.id), c = this._cuts.get(key);
                if (c) { b.keys.add(key); if (c.state === "flight") parked = true; continue; }
                // A pair its own inline step left pending is set aside, not looped on.
                if (b.prev && b.prev.has(key)) { this._silentAdd(Erec.obj.id, rec.obj.id); continue; }
                const out = this._dispatchPair(Erec, rec, { barrier: true });
                if (out === "flight") { b.keys.add(key); parked = true; } else if (out === "wait") parked = true; else ran.add(key);
            }
            b.prev = ran;
            if (parked) return false;
        }
        return false;
    }
    /**
     * The barrier's next round: each target its pairs name, with the earliest mark it is pending under
     * anywhere (the per-target lock: a target is cut in the serial order of its marks, so an older
     * mark never cuts a newer one's piece), in serial order.
     */
    _barrierRound(b) {
        const marks = this._eraseStrokes(), rank = new Map(marks.map((m, i) => [m.obj.id, i]));
        const seen = new Set(), out = [];
        for (const p of b.pairsOf(b)) {
            if (seen.has(p.rec.obj.id)) continue;
            seen.add(p.rec.obj.id);
            const Erec = marks.find((m) => this._pendingPair(m.obj, p.rec.obj)) || p.Erec;
            out.push({ Erec, rec: p.rec });
        }
        return out.sort((p, q) => (rank.get(p.Erec.obj.id) - rank.get(q.Erec.obj.id)) || (zOf(q.rec.obj) - zOf(p.rec.obj)) || (q.rec.obj.id - p.rec.obj.id));
    }
    _finishBarrier(b) {
        if (this._barrier !== b) return;
        this._barrier = null; this._follow = null;
        if (b.rounds) this._perf("eraseBarrier", b.t0, false, { kind: b.kind, rounds: b.rounds });
        for (const Erec of this._eraseStrokes()) if (!this._headOf(Erec)) this._spendMark(Erec);   // what the gesture emptied goes now
        b.then([...b.follow].filter((id) => this.doc.getById(id)), b);
        this._emit();
        this._scheduleBake(0);
    }
    /** A parked gesture dropped (a new press, a tool change, an undo, a pinch, a load): its continuation never runs; its cuts go on as the bake's. */
    _cancelBarrier() {
        const b = this._barrier;
        if (!b) return;
        this._barrier = null; this._follow = null;
        if (b.press && this._pressWait === b.press) this._pressWait = null;
        if (b.lasso) { this._lassoParked = null; this.renderer.refreshSelection(); }
        this._emit();
        this._scheduleBake(0);
    }
    /** Every pending pair whose live target `pred({obj, level})` accepts, of the marks `markPred` accepts: `[{Erec, rec}]`. */
    _pendingPairs(pred, markPred = null) {
        const out = [];
        for (const Erec of this._eraseStrokes()) {
            if (markPred && !markPred(Erec)) continue;
            const s = this._lineage.get(Erec.obj.id);
            if (!s) continue;
            for (const id of s) {
                const rec = this.doc.getById(id);
                if (rec && this._pendingPair(Erec.obj, rec.obj) && pred(rec)) out.push({ Erec, rec });
            }
        }
        return out;
    }
    /** The natives of the families of the ids a barrier follows. */
    _familiesOf(ids) {
        const out = new Set();
        for (const x of ids) { const r = this.doc.getById(x); if (r) for (const m of this.doc.editGroup(this.doc.editKey(r.obj))) out.add(m.obj.id); }
        return out;
    }
    /** A tap's barrier: the pending pairs of object `id` and its family; `then(ids)` gets its pieces (A2 §5.5). */
    _tapBarrier(id, then) {
        return this._eraseBarrier("tap", (b) => { const fam = this._familiesOf(b.follow); return this._pendingPairs((rec) => fam.has(rec.obj.id)); }, then, [id]);
    }
    /**
     * A drag's barrier (B4): the pending pairs among the selection's members and under its frames,
     * and every pending pair of a mark homed under a selected frame — a mark moved with its frame
     * would carry its mask off its targets. The selection follows the cuts to the pieces; then `then(b)`.
     */
    _dragBarrier(then) {
        const sel = this.selection;
        const frames = sel ? (sel.frames || []).slice() : [];
        const under = (level) => frames.length > 0 && this._underFrames(level, frames);
        const pairsOf = (b) => {
            const fam = this._familiesOf(b.follow);
            const out = this._pendingPairs((rec) => fam.has(rec.obj.id) || under(rec.level));
            return frames.length ? out.concat(this._pendingPairs(() => true, (Erec) => under(Erec.level))) : out;
        };
        return this._eraseBarrier("drag", pairsOf, (ids, b) => {
            if (b.rounds && this.selection) {
                if (ids.length || frames.length) this._setSelection(ids, frames); else this.deselect();
            }
            then(b);
        }, sel ? sel.ids : []);
    }
    /** A lasso's barrier (H5): every pending pair whose target's drawn box meets the loop's box, wherever its mark is. */
    _lassoBarrier(poly, then) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const F = this.cam.frame;
        const meets = (rec) => { const r = this.stage.placeNative(rec.obj, F).box(); return !!r && r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1; };
        return this._eraseBarrier("lasso", () => this._pendingPairs(meets), then);
    }
    /** The engine status's erase part: the pending marks, and whether a gesture waits on their cuts (the editor's chip). */
    _eraseStatus() {
        let marks = 0;
        if (!this._marks) return { marks, finishing: false, aborted: 0 };   // an emit from the constructor, before `_initErase`
        for (const o of this._marks.values()) if (this.doc.getById(o.id)) marks++;
        return { marks, finishing: !!this._barrier, aborted: this._eraseAborted.length };
    }
    /**
     * Bake pending marks to completion now, inline — every one, or those whose ids are in `only`: the
     * tests' settle point. A job in flight for a pair baked here is dropped when it lands.
     */
    flushErases(only = null) {
        this.flushBakes();
        for (let guard = 0; guard < 100000; guard++) {
            const Erec = this._eraseStrokes().find((m) => !only || only.has(m.obj.id));
            if (!Erec) break;
            const rec = this._headOf(Erec);
            if (!rec) { this._spendMark(Erec); continue; }
            const c = this._cuts.get(cutKey(Erec.obj.id, rec.obj.id));
            if (c) this._dropCut(c);
            this._dispatchPair(Erec, rec, { inline: true });
        }
        this._render();
    }
}

export const erasePipeline = ErasePipeline.prototype;
