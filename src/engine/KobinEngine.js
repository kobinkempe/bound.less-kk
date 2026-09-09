/**
 * KobinEngine - the public facade. Wires LevelMap + Document + Camera +
 * TileStore + Renderer into one external API. It holds NO geometry or z-order
 * logic of its own: it routes input to the right collaborator and merges the
 * render list (tile pieces + the active level's live natives) in global id order.
 *
 * WHAT IS IN THIS FILE, after the 2026-08-31 split: construction and teardown,
 * the compat accessors, the tool and style setters, the perf log, the render
 * pipeline, pan/zoom, pointer input, and undo/redo/clear. Roughly the shape of
 * a gesture, start to finish.
 *
 * WHAT MOVED OUT, and is mixed back onto this prototype at the bottom of the
 * file (see `mixin.js` for why it is done that way):
 *
 *   erasePipeline.js  the eraser and the resumable bake behind it   (~930 lines)
 *   overlays.js       the selection indicator + the erase debug view (~670)
 *   selection.js      selecting, hit-testing, dragging               (~390)
 *   sceneOps.js       auto-scenes                                    (~215)
 *   files.js          snapshot/dev-0 and the kobin-1 save format      (~70)
 *   instruments.js    the four measurement instruments               (~295)
 *
 * They are still this class's methods and still run with `this` bound to the
 * engine; they were moved verbatim, not rewritten.
 *
 * COMPAT SURFACE, locked by `KobinEngine.contract.test.js`: pointer/zoom/pinch/
 * pan, the tool and style setters, undo/redo/clear, snapshot/loadSnapshot,
 * serializeDrawing/loadDrawing, resize, destroy, onStatus, perfLog - plus the
 * quasi-privates the hook and the report payload read: nativesByLevel,
 * crossings, levelObjects, tiles, _drawing, _drawStartT, cancelStroke, _hasFat,
 * _effectiveZoom, opacityGroups, outlineMode, the camera fields, and
 * _fatOnScreen/_outlinePad (the ported BUG-02/05 invariants).
 */
import { perfNow } from "./now";
import { BASE, ENTER, EXIT } from "./frameLattice";
import { BiarcPen } from "./geometry/biarc";
import Camera from "./Camera";
import Document from "./Document";
import LevelMap from "./LevelMap";
import Renderer from "./Renderer";
import TileStore from "./TileStore";
import { clipPolylineToRect, clipRingsToRect, flattenCurve } from "./geometry/polyline";
import { loopsArea, loopsBBox } from "./geometry/arcShape";
import { residual, encodeBelow } from "./geometry/offsets";
import { strokeOutline } from "./geometry/clipperBoolean";
import { validateScaleDef } from "./scaleBar";
import { EventLatency, FrameMeter, GrowthLog, LongFrames } from "./instruments";
import { mixin } from "./mixin";
import { overlays } from "./overlays";
import { erasePipeline } from "./erasePipeline";
import { selection, SELECT_DRAG_PX } from "./selection";
import { files } from "./files";
import { sceneOps } from "./sceneOps";

// Eraser strokes paint in the canvas background color — visually "erased"
// the instant they're drawn, before any geometry work happens.
const ERASE_COLOR = "#ffffff";

const DEFAULTS = {
    // The lattice constants (bible section 0). Every one is a power of two, so
    // the crossing ratio enter/base is exactly 4096 and scaling across a level
    // moves only a float exponent — no ulp is spent per crossing, which is what
    // makes a chained transform at depth trustworthy. 3000 and 0.1 were neither
    // exact nor commensurate with the grid: 38,400/3000 = 12.8 is not
    // representable at all, so every cell origin in the old build was already
    // slightly wrong.
    enter: ENTER, base: BASE, exit: EXIT, scale: 1000, arcTolerancePx: 0.25,
    polygonizeWidthFrac: 1 / 3, // tile-bake stroke↔fill gate (screen-relative, as before)
    // Sub-pixel policy for minified (finer-level) content, measured at the
    // level's deepest in-level zoom (`enter`): below cullPx it can never be
    // seen; content in [fadeLoPx, cullPx) is baked and fades continuously with
    // zoom (BUG-04). fadeLoPx is ALSO the bake-inclusion/invalidation bound.
    cullPx: 0.3, fadeLoPx: 0.15,
    // Fat display gate + curve-outline constants: a stroke that could EVER paint
    // wider than fatWidthPx within its level (lwFrame × enter) renders as a
    // curve-capsule outline (geometry/curveOutline.js) — built once, exact at
    // every in-level zoom. The gate is FIDELITY-NEUTRAL: raw browser stroking
    // is exact and the outline tracks it to ≤ arcTolerancePx, so the value only
    // trades Skia mis-stroke safety (measured failure ~25k device px → 4000
    // keeps a ~6× margin) against outline-fitting work. At 4000 the default
    // 13 px pen (13 × enter = 3900) never needs an outline at its own level.
    // lineTolPx: a centerline curve whose deviation from its chord would paint
    // under this many device px at the level's DEEPEST zoom is "basically a
    // line" and is polygonized (exact line capsule).
    fatWidthPx: 4000, lineTolPx: 0.25,
    // lineModeLevel is GONE: curvature is per-origin now (natives spline; derived
    // pieces are pre-flattened polylines). Kept absent on purpose.
};

export default class KobinEngine {
    constructor(container, { width, height, onStatus } = {}) {
        this.cfg = { ...DEFAULTS };
        this.onStatus = onStatus || (() => {});
        this.width = width || window.innerWidth;
        this.height = height || window.innerHeight;

        this.lm = new LevelMap(this.cfg, this.width, this.height);
        this.doc = new Document();
        // A cut is anchored to the frame the gesture was made in, so moving the
        // object it belongs to has to carry the cut's origin into that frame.
        // One injected pure function is all the Document needs — it still owns
        // no camera and no frame tree.
        this.doc.frameFactor = (from, to) => this.lm.frameFactor(from, to);
        this.cam = new Camera(this.lm, this.cfg, {
            finalizeLiveStroke: () => { if (this._drawing) this.pointerUp(); },
            // A lateral shift moves which cell the camera is in. Under the pen
            // that would re-base the coordinates a live stroke is being written
            // in, so it waits — see Camera._maybeShift and D9.
            holdFrame: () => !!this._drawing || !!this._erasing,
            onCross: () => { /* re-render happens after the settle in the caller */ },
        });
        this.store = new TileStore(this.lm, this.doc, this.cfg);
        this.renderer = new Renderer(container, this.cam, this.cfg, { width: this.width, height: this.height });
        this.renderer.setTileDebug(false, () => this._debugTileRects());

        this.tool = "pen"; this.penType = "freehand"; this.color = "rgb(0,0,0)"; this.penWidth = 13; this.opacity = 1;
        this.opacityGroups = true; this.outlineMode = false; this.debug = false; this.kdebug = false; this.tileDebug = false;
        // TRACE MODE (dev panel, default OFF). Heavy diagnostics that are not
        // worth their cost in ordinary use: every operation logged rather than
        // only those past the 8 ms floor, and a much deeper log. The floor is
        // exactly what hid the 2026-08-21 stalls — a whole session came back
        // with 62.3 s elapsed and 157 ms recorded — but removing it permanently
        // would flood 300 entries in one pinch. So it is a switch, not a
        // default, and the passive instruments (frame meter, long frames) stay
        // on always because they cost nothing until something is slow.
        this.trace = false;
        this.preBake = true;       // define + bake the next level's tiles EARLY (near a crossing, in idle)
        this.lazyOutlines = true;  // fat strokes stay raw until they approach the gate (fit in idle/on approach)
        this.retainScenes = true;  // keep each level's SVG subtree so a flip swaps it in instead of rebuilding
        this._idleFitScheduled = false;
        this._drawing = null; this._panLast = null; this._erasing = false; this._drawStartT = 0;
        this._lasso = null;           // { pts:[[sx,sy]], ctrl, moved } while a loop is being drawn
        this._eraserPx = 16;
        // Deferred area erase: committed eraser strokes bake into the ink
        // beneath them one object per idle slice (see "deferred erase baking").
        this._eraseCommits = new Map(); // eraser stroke id -> its eraseCommit undo op
        this._bakeDone = new Map();     // eraser stroke id -> Set of object ids handled
        this._bakeTimer = null;
        this._bakeDelay = Infinity;
        this._bakeJobs = [];            // pen-up perimeter resolves, stepped in slices
        this._bakeQueued = new Set();   // ids already in _bakeJobs
        this._lastList = []; this._lastRange = null;
        this.perfLog = [];
        this.frameMeter = new FrameMeter();
        this.frameMeter.onPoke = () => { try { this.growth.maybeSample(); } catch (err) { /* diagnostics never break drawing */ } };
        this.growth = new GrowthLog(this);
        this.longFrames = new LongFrames();
        this.eventLatency = new EventLatency();
        this.eventLatency.start();
        this.longFrames.start();
        // High-frequency ops are AGGREGATED, not logged one by one: `_perf` keeps
        // 300 entries and a single pinch would evict everything else. Without
        // this, a zoom under the 8 ms floor left no trace at all - which is how
        // two reports came back with the slow part simply missing.
        this._zoomStat = null;
        // A rolling record of what the USER did, not just what the document
        // ended up as. A snapshot shows the wreck; the journal shows the
        // gesture that made it — which erase, where, at what zoom, what it cut,
        // and whether the object came apart. See `_note`.
        this.journal = [];
        this._journalCur = null;
        this.geom = { strokeOutline, clipRingsToRect, clipPolylineToRect, flattenCurve };

        // selection / edit state (US-10)
        this.selection = null;        // { id, level, obj } — obj is the LIVE native
        this._dragSel = null;         // { start:[sx,sy], moves:Map, moved } during a select-drag
        this.docMeta = { name: null, createdAt: new Date().toISOString(), scaleDef: null, scenes: [], hiddenScenes: [], sceneSeq: 1 };
        this.renderer.setSelection(() => this._selectionRect());
        this.renderer.setSelectionAnts(() => this._selectionAnts());
        this.renderer.setLasso(() => (this._lasso ? this._lasso.pts : null));
        // The selected object can vanish under us (eraser, cut, undo, wipe, load).
        this.doc.subscribe((ev) => {
            if (!this.selection) return;
            if (ev.kind === "reset") { this.selection = null; this._dragSel = null; return; }
            if (ev.kind !== "remove") return;
            if (ev.rehome) return;   // it changed frames, it did not go away
            // Drop the member that went, and repair the primary if it was the
            // one removed. A member whose logical family still has geometry
            // (a re-homed patch) hands over to its sibling instead of vanishing.
            const ids = this.selection.ids.filter((id) => this.doc.getById(id));
            if (ev.id === this.selection.id && !ids.length) {
                const family = this.doc.editGroup(this.selection.editId);
                if (family.length) { this._setSelection([family[0].obj.id]); return; }
            }
            if (!ids.length) { this.selection = null; this._dragSel = null; return; }
            if (ids.length !== this.selection.ids.length || ev.id === this.selection.id) this._setSelection(ids);
        });

        this._render();
    }

    // ---- camera compat (fields live on Camera) ----
    get activeLevel() { return this.cam.activeLevel; } set activeLevel(v) { this.cam.activeLevel = v; }
    get inScale() { return this.cam.inScale; } set inScale(v) { this.cam.inScale = v; }
    get inPanX() { return this.cam.inPanX; } set inPanX(v) { this.cam.inPanX = v; }
    get inPanY() { return this.cam.inPanY; } set inPanY(v) { this.cam.inPanY = v; }
    // Document + level-map compat (same shapes as the old engine).
    get nativesByLevel() { return this.doc.nativesByLevel; }
    get crossings() { return this.lm.records; }
    get levelObjects() { return { [this.cam.activeLevel]: this._lastList }; }
    get tiles() {
        const out = {};
        for (const key of this.store._tileKeys()) { const L = key.split("|")[0]; (out[L] = out[L] || { size: 0 }).size++; }
        return out;
    }
    get _hasFat() { return this.renderer._hasFat; }

    // Selection belongs to the select tool. Leaving it drops the selection, so
    // the indicator cannot linger over a drawing you have gone back to editing
    // — and, since the overlay is what the ants live on, nothing is left
    // animating behind a pen stroke.
    setTool(t) {
        if (t !== this.tool && t !== "select") this.deselect();
        this.tool = t;
    }
    setPenType(t) { this.penType = t; }
    setColor(c) { this.color = c; }
    setWidth(w) { this.penWidth = w; }
    setOpacity(o) { this.opacity = o; }
    setOutlineMode(b) { this.outlineMode = !!b; this.renderer.setOutlineMode(this.outlineMode); this._render(); }
    setOpacityGroups(b) {
        this.opacityGroups = !!b;
        this.renderer.setOpacityGroups(this.opacityGroups);
        this.store.setOpacityGroups(this.opacityGroups); // bumps bake epoch -> tiles rebake
        this.renderer.clear();                            // fill seam pad differs -> rebuild groups
        this._render();
    }
    // DEV: outline every built path in red. Dev panel only.
    setDebug(b) { this.debug = !!b; this.renderer.setDebug(this.debug); this._render(); }
    setPreBake(b) { this.preBake = !!b; }
    /** Dev panel: log every operation, not just the ones past the floor. */
    setTrace(b) {
        this.trace = !!b;
        if (this.trace) this.perfLog.length = 0;   // start the trace clean
    }
    setRetainScenes(b) { this.retainScenes = !!b; this.renderer.setRetainScenes(this.retainScenes); this._render(); }
    setScaleDef(def) {
        this.docMeta.scaleDef = def ? validateScaleDef(def) : null;
    }

    setLazyOutlines(b) {
        this.lazyOutlines = !!b;
        this.renderer.setLazyOutlines(this.lazyOutlines);
        this._render(); // representation choice may change for pending strokes
        if (this.lazyOutlines) this._queueIdleFits();
    }
    // DEV: retained for the dev panel's K-debug switch. Nothing reads `kdebug`
    // any more — the overlay it drove was replaced by the tile and erase views.
    setKDebug(b) { this.kdebug = !!b; }
    // DEV: draw the cache-tile rectangles. Dev panel only.
    setTileDebug(b) { this.tileDebug = !!b; this.renderer.setTileDebug(this.tileDebug, () => this._debugTileRects()); this.renderer.update(); }
    /**
     * DEV — ERASE DEBUG. See what an erase actually did to an object's structure.
     *
     * Everything about erasing that has gone wrong this month has been invisible
     * on screen: a family that would not come apart, a piece joined to the wrong
     * relative, a native made of nothing, a mark that never baked. All of it is
     * decided by connectivity across a tile boundary, and none of it is
     * something you can see in ink. This draws the decision.
     */
    setEraseDebug(b) {
        this.eraseDebug = !!b;
        if (!this.eraseDebug) this._debugMarks = [];
        this.renderer.setEraseDebug(
            this.eraseDebug,
            () => this._eraseDebugOverlay(),
            // What IS this piece, really? A tile can be two very different
            // things and they have to look different:
            //   "up"      ink from a COARSER level, magnified into this view —
            //             a temporary tile of somebody else's object, which is
            //             what black is for;
            //   "down"    a piece stored FINER than this view, shown small — an
            //             erase ceded it, it is a real object, and it keeps its
            //             colour so zooming out does not blacken what you were
            //             just working on;
            //   "same"    stored right here;
            //   "unbaked" no resolved shape behind it at all.
            (id) => {
                const rec = this.doc.getById(id);
                if (!rec) return "unbaked";
                if (rec.obj.type !== "shape" && rec.obj.type !== "fill") return "unbaked";
                if (rec.level === this.cam.frame) return "same";
                const d = this.lm.depthOf(rec.level), c = this.lm.depthOf(this.cam.frame);
                if (d == null || c == null) return "unbaked";
                return d < c ? "up" : "down";
            },
        );
        this._render();
    }

    resize(w, h) {
        if (w === this.width && h === this.height) return;
        const t0 = perfNow();
        this.width = w; this.height = h;
        this.lm.resize(w, h); this.renderer.setSize(w, h);
        this._render();
        this._perf("resize", t0, true, { w, h });
    }
    destroy() {
        this._destroyed = true;
        if (this._bakeTimer != null) { clearTimeout(this._bakeTimer); this._bakeTimer = null; }
        this.frameMeter.stop();
        this.longFrames.stop();
        this.eventLatency.stop();
        this.store.destroy(); this.renderer.destroy();
    }

    // ---- perf log ----
    /**
     * Record a timing measured OUTSIDE the engine.
     *
     * The save path lives in the React layer — serialize, stringify, lz-string
     * compress, write localStorage, regenerate thumbnails — and every bit of it
     * is synchronous main-thread work on a 4 s timer. None of it was timed, and
     * on 2026-08-21 it produced the only stalls in the whole session that a user
     * could actually feel: two frames of 1133 ms and 950 ms, 1.8 s after the last
     * gesture, with no engine event within two and a half seconds either side.
     */
    notePerf(op, t0, extra) { this._perf(op, t0, true, extra); }
    // DEV DIAGNOSTICS, all of them: `_noteFast`, `fastStats`, `_perf`, `_note`,
    // `journal`, `reportFamilies`, `frameMeter`, `longFrames`, `eventLatency`,
    // `growth`. They cost nothing until something is slow and they are what the
    // Report button ships; none of them is read by the drawing pipeline.
    /** One high-frequency sample (zoom/pan), kept as a distribution. */
    _noteFast(kind, ms) {
        const all = this._zoomStat || (this._zoomStat = {});
        const z = all[kind] || (all[kind] = { n: 0, total: 0, max: 0, over8: 0, over16: 0, over50: 0, recent: [] });
        z.n++; z.total += ms;
        if (ms > z.max) z.max = +ms.toFixed(1);
        if (ms > 8) z.over8++;
        if (ms > 16) z.over16++;
        if (ms > 50) z.over50++;
        // the LAST 200, not the first: a report is sent right after the problem.
        z.recent.push(+ms.toFixed(2));
        if (z.recent.length > 200) z.recent.shift();
    }
    /** The aggregate, shaped for the report payload. */
    fastStats() {
        const out = {};
        for (const kind of Object.keys(this._zoomStat || {})) {
            const z = this._zoomStat[kind];
            const q = z.recent.slice().sort((a, b) => a - b);
            out[kind] = {
                n: z.n, meanMs: z.n ? +(z.total / z.n).toFixed(2) : 0, maxMs: z.max,
                over8: z.over8, over16: z.over16, over50: z.over50,
                medianMs: q.length ? q[q.length >> 1] : 0,
                p90Ms: q.length ? q[Math.floor(q.length * 0.9)] : 0,
            };
        }
        return out;
    }
    _perf(op, t0, always, extra) {
        const ms = perfNow() - t0;
        if (ms < 8 && !always && !this.trace) return;
        const e = { op, ms: +ms.toFixed(1), level: this.cam.activeLevel, inScale: +this.cam.inScale.toFixed(3), t: Date.now() };
        if (extra) Object.assign(e, extra);
        this.perfLog.push(e);
        const cap = this.trace ? 4000 : 300;
        while (this.perfLog.length > cap) this.perfLog.shift();
    }

    /**
     * Append to the gesture journal — the thing a snapshot cannot tell you.
     *
     * Every report before this one showed a document AFTER an erase and left
     * the erase itself to be guessed at: which stroke, at what zoom, against
     * which objects, and what the cut did to the family. Bounded on both axes
     * (40 gestures, 120 samples each) so a report stays a few hundred KB.
     */
    _note(entry) {
        const e = { t: Date.now(), frame: this.cam.frame, level: this.cam.activeLevel,
            inScale: +this.cam.inScale.toFixed(4), ...entry };
        this.journal.push(e);
        if (this.journal.length > 40) this.journal.shift();
        return e;
    }
    // Every point of a gesture is not worth sending; every fourth is, and the
    // ends always are.
    static _thin(pts, cap = 120) {
        if (!pts || pts.length <= cap) return (pts || []).map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]);
        const step = Math.ceil(pts.length / cap), out = [];
        for (let i = 0; i < pts.length; i += step) out.push([+pts[i][0].toFixed(3), +pts[i][1].toFixed(3)]);
        const last = pts[pts.length - 1];
        out.push([+last[0].toFixed(3), +last[1].toFixed(3)]);
        return out;
    }
    /**
     * The multi-level objects and whether each still hangs together — the exact
     * question every "it did not split properly" report turns on, answered in
     * the report instead of reconstructed from it afterwards.
     */
    reportFamilies(limit = 12) {
        const seen = new Map();
        for (const L of this.doc.levels()) {
            for (const o of this.doc.at(L)) {
                if (o.erase) continue;
                const k = this.doc.editKey(o);
                seen.set(k, (seen.get(k) || 0) + 1);
            }
        }
        const out = [];
        for (const [key, n] of seen) {
            if (n < 2 || out.length >= limit) continue;
            const { members, classes } = this._familyComponents(key);
            out.push({
                key,
                members: members.map((m) => {
                    const b = m.obj.loops ? loopsBBox(m.obj.loops) : null;
                    return {
                        id: m.obj.id, level: m.level, type: m.obj.type,
                        loops: m.obj.loops ? m.obj.loops.length : 0,
                        area: m.obj.loops ? +loopsArea(m.obj.loops).toFixed(2) : 0,
                        box: b ? [+b.x0.toFixed(2), +b.y0.toFixed(2), +b.x1.toFixed(2), +b.y1.toFixed(2)] : null,
                        attach: m.obj.attachRect
                            ? [+m.obj.attachRect.x0.toFixed(2), +m.obj.attachRect.y0.toFixed(2),
                                +m.obj.attachRect.x1.toFixed(2), +m.obj.attachRect.y1.toFixed(2)] : null,
                    };
                }),
                components: classes.map((c) => c.map((i) => members[i].obj.id)),
            });
        }
        return out;
    }

    // ---- render pipeline ----
    // The full render list at the active level: tile pieces (up + down) + the
    // level's own live natives, merged in id order (global z-order).
    _buildList() {
        const win = this.cam.frameWindow(0);
        const F = this.cam.frame;
        // A change of frame: the tiles of frames the camera has left go (memory step 3a).
        if (F !== this._tileFrame) { this.store.framesLeft(F); this._tileFrame = F; }
        const derived = this.store.content(F, win);
        const own = this.store.ownContent(F);
        const list = derived.concat(own);
        // Renderer grouping follows logical edit ownership for re-homed
        // boundary patches. That lets parent/patch overlap close AA seams while
        // applying transparent opacity only once to the family.
        //
        // THE RESIDUAL (F41, geometry/offsets.js). A piece of an object that
        // carries offsets at levels DEEPER than this one is drawn translated by
        // their sum, scaled up to here — a translation this level's own
        // coordinates cannot hold, applied at paint and never stored, so
        // nothing deeper derives from it. Stamped on the piece as `res` so
        // every reader of the render list — the renderer, the hit test, the
        // selection indicator, the test oracles — sees the same picture.
        const hasOff = this.doc.hasOffsets();
        const D = this.cam.activeLevel;
        const resById = hasOff ? new Map() : null;
        for (const o of list) {
            const rec = this.doc.getById(o.id);
            if (rec && rec.obj.editId != null) o.editId = rec.obj.editId;
            let res = null;
            if (hasOff && rec && rec.obj.below) {
                res = resById.get(o.id);
                if (res === undefined) { res = residual(rec.obj.below, D - this.lm.depthOf(rec.level)); resById.set(o.id, res); }
            }
            if (res) o.res = res; else if (o.res) delete o.res;
        }
        // z defaults to id (creation order); cut pieces carry their source's z
        // so a stroke stays at its depth after a boolean erase splits it.
        list.sort((a, b) => ((a.z != null ? a.z : a.id) - (b.z != null ? b.z : b.id)) || (a.id - b.id));
        this._lastRange = this.lm.tileRange(F, win);
        return list;
    }
    _render() {
        const t0 = perfNow();
        this._renderPending = false;   // a deferred bake render is satisfied by any render (`_stepShapeBakes`)
        this._lastList = this._buildList();
        this.renderer.render(this._lastList, this.cam.frame);
        this.renderer.update();
        this._emit();
        this._perf("render", t0, false, { n: this._lastList.length, fat: this.renderer._hasFat });
        // Sample frames around a render too, not only around a gesture. The
        // worst stall seen so far is a COLD one — opening a drawing at a deep
        // camera — and a meter that only woke for zoom and pan would sleep
        // straight through it.
        this.frameMeter.poke();
    }
    // True if the visible tile set changed since the last full render.
    _visibleChanged() {
        const r = this.lm.tileRange(this.cam.frame, this.cam.frameWindow(0));
        const p = this._lastRange;
        return !p || r.i0 !== p.i0 || r.i1 !== p.i1 || r.j0 !== p.j0 || r.j1 !== p.j1;
    }

    // ---- pan / zoom ----
    panBy(dx, dy) {
        const t0 = perfNow();
        this._lastCamMove = t0;
        this.frameMeter.poke();
        this.cam.panBy(dx, dy);
        // needsWindowChop: the view has left the inner half of the scene's
        // window, so the pieces chopped to it must be rebuilt on a fresh one
        // before its edge could come on screen (F40).
        if (this._visibleChanged() || this.renderer.needsRebake() || this.renderer.needsReorigin()
            || this.renderer.needsWindowChop()) this._render();
        else { this.renderer.syncCameraOnly(); this.renderer.update(); this._emit(); }
        this._perf("pan", t0);
        this._noteFast("panStep", perfNow() - t0);
    }
    zoomAt(sx, sy, deltaY) { this.zoomFactorAt(sx, sy, Math.pow(2, -deltaY / 1000)); }
    pinchUpdate(mx, my, factor, dx, dy) { this.cam.panBy(dx, dy); this.zoomFactorAt(mx, my, factor); }
    zoomFactorAt(sx, sy, factor) {
        const t0 = perfNow();
        this._lastCamMove = t0;          // `_camBusy` — keep bake slices off this frame
        this.frameMeter.poke();
        const crossed = this.cam.zoomFactorAt(sx, sy, factor);
        // needsFatFlip: lazy-pending fat strokes approaching the gate must flip
        // to their outline representation BEFORE raw stroking becomes unsafe.
        // needsFadeFlip: a zoom can move a piece across the fully-present line,
        // which changes which GROUP it belongs in. Only a full render regroups.
        // needsWindowChop: a zoom in past the window's budget, or a zoom out
        // that has outgrown its inner half (F40).
        if (crossed || this._visibleChanged() || this.renderer.needsRebake() || this.renderer.needsFatFlip()
            || this.renderer.needsFadeFlip() || this.renderer.needsReorigin() || this.renderer.needsWindowChop()) this._render();
        else { this.renderer.syncCameraOnly(); this.renderer.update(); this._emit(); }
        this._perf(crossed ? "cross" : "zoom", t0, crossed);
        this._noteFast(crossed ? "crossStep" : "zoomStep", perfNow() - t0);
        this._maybePrebake();
        // prefit outlines when strokes approach the gate or a new level activates
        if (crossed || this.renderer.hasPendingNearFat()) this._queueIdleFits();
    }
    // Idle pre-bake: nearing an UPWARD crossing, warm the child tiles under the
    // view during idle time so the crossing lands on a hot cache. With preBake
    // enabled (dev toggle), a FIRST entry is prebakeable too: the child's
    // crossing record is defined EARLY — {s,t} pinning is "first defined,
    // forever", and any frame captured on the way up is as valid as the one at
    // the crossing moment; capturing it at 0.8×enter just moves the definition
    // a few frames earlier. Fire-and-forget; the bake is idempotent.
    _maybePrebake() {
        if (this._prebakeQueued) return;
        if (this.cam.inScale <= this.cfg.enter * 0.8) return;
        const parent = this.cam.frame;
        // Find (or, if allowed, define early) the child FRAME this upward
        // approach will cross into — reusing a nearby sibling or spawning one.
        let child = this.lm.findChild(parent, this.cam.inScale, this.cam.inPanX, this.cam.inPanY);
        if (!child) {
            if (!this.preBake) return;
            child = this.lm.ensureChild(parent, this.cam.inScale, this.cam.inPanX, this.cam.inPanY);
        }
        const childId = child.id;
        this._prebakeQueued = true;
        const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 30);
        idle(() => {
            this._prebakeQueued = false;
            if (this._destroyed) return;
            if (this.cam.inScale <= this.cfg.enter * 0.8 || !this.lm.frame(childId)) return;
            const childWin = this.lm.mapRectF(this.cam.frameWindow(0), parent, childId);
            if (!childWin) return;
            const pins = this.store._pins;          // keep the VISIBLE tiles pinned —
            const tP = perfNow();
            this.store.content(childId, childWin);
            this._perf("prebake", tP, false, { frame: childId });  // bakes + caches; render untouched
            this.store._pins = pins;                // prebaked tiles stay evictable
        });
    }

    // Idle outline pre-fitting (lazy mode): fat-gated strokes render raw until
    // needed; fit their curve outlines in idle slices (~8 ms) so the eventual
    // representation flip — and the next crossing's bake — never stalls a
    // gesture. Re-queues itself while work remains.
    _queueIdleFits() {
        if (!this.lazyOutlines || this._idleFitScheduled || this._destroyed) return;
        const gate = this.cfg.fatWidthPx != null ? this.cfg.fatWidthPx : 500;
        this._idleFitScheduled = true;
        const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 50);
        idle(() => {
            this._idleFitScheduled = false;
            if (this._destroyed) return;
            const t0 = perfNow();
            let more = false, fitted = 0;
            // TIMED. This fires on every crossing and ran unmeasured until
            // 2026-08-22, when a report attributed 380 ms to an anonymous
            // requestIdleCallback that nothing in the engine could account for.
            // Note the budget below is tested BEFORE ensureOutline, not after —
            // the same shape of defect as the erase bake had, so a single fit
            // can overrun the 8 ms slice by as much as it likes (50-135 ms per
            // stroke, measured 2026-07-07).
            for (const o of this.doc.at(this.cam.frame)) {
                if (o.type !== "stroke" || o === this._drawing) continue;
                if (o._outline) continue;
                if (o.lwFrame * this.cfg.enter <= gate) continue;
                if (perfNow() - t0 > 8) { more = true; break; }
                this.renderer.ensureOutline(o, o.origin === "native");
                fitted++;
            }
            this._perf("idleFit", t0, false, { fitted, more });
            if (more) this._queueIdleFits();
            else if (fitted) this._render(); // flip the now-cached outlines in one pass
        });
    }

    // ---- pointer / drawing ----
    screenToFrame(sx, sy) { return this.cam.screenToFrame(sx, sy); }
    // ---- pointer entry points, timed at the boundary --------------------------
    // Every scrap of user-driven main-thread work happens inside one of these
    // three, so timing them cannot miss. Reported 2026-08-21: two frames of
    // 1167 ms and 1133 ms, both immediately after a `move` at level 7, while
    // every timed operation in the session stayed small — zoom steps maxed at
    // 7.3 ms, autosave at 116.6 ms, renders at 8 ms. The move path was the one
    // user-driven path with no timer on it at all.
    //
    // `_perf`'s 8 ms floor does the filtering: a drag fires hundreds of
    // pointermoves and only the expensive ones are worth a log entry. The
    // distribution goes to `_noteFast`, which cannot flood.
    pointerDown(sx, sy, ctrl = false) {
        const t0 = perfNow();
        this.frameMeter.poke();
        try { return this._pointerDown(sx, sy, ctrl); }
        finally { const ms = perfNow() - t0; this._perf("ptrDown", t0, false, { tool: this.tool }); this._noteFast("ptrDown", ms); }
    }
    pointerMove(sx, sy) {
        const t0 = perfNow();
        this.frameMeter.poke();
        try { return this._pointerMove(sx, sy); }
        finally { const ms = perfNow() - t0; this._perf("ptrMove", t0, false, { tool: this.tool }); this._noteFast("ptrMove", ms); }
    }
    pointerUp() {
        const t0 = perfNow();
        this.frameMeter.poke();
        try { return this._pointerUp(); }
        finally { const ms = perfNow() - t0; this._perf("ptrUp", t0, false, { tool: this.tool }); this._noteFast("ptrUp", ms); }
    }
    _pointerDown(sx, sy, ctrl = false) {
        // A PRESS WHILE A STROKE IS STILL OPEN means the last pointerup never
        // arrived — the button was released over another window after an
        // alt-tab, the OS swallowed the end of a touch. Until 2026-09-05 the
        // new stroke simply took over `_drawing` and the old one was
        // abandoned mid-air: still in the document, never finalized (pending
        // and unindexed for ever), and with NO undo op, because the op is
        // pushed at pen-up — so Ctrl+Z removed the NEW stroke and the orphan
        // stayed. Measured in Chrome by dispatching two pointerdowns. Finish
        // it the way a pen-up would, then start the new one.
        if (this._drawing) this._pointerUp();
        // The same for a select gesture left behind by a tool change mid-press
        // (a second finger tapping the toolbar): a stale press would turn the
        // next pen-up into a tap-select, and a stale lasso would swallow it.
        if (this.tool !== "select") {
            this._selPress = null;
            if (this._lasso) { this._lasso = null; this.renderer.refreshSelection(); }
        }
        if (this.tool === "pan") { this._panLast = [sx, sy]; return; }
        if (this.tool === "erase") { this._erasing = true; this.eraseAt(sx, sy); return; }
        if (this.tool === "erasePartial") {
            // The eraser IS a stroke: background-colored ink through the pen
            // pipeline, so the gesture costs nothing no matter how complex
            // the drawing is. Baking into the ink beneath happens later.
            this._erasing = true;
            const p = this.cam.screenToFrame(sx, sy);
            const o = {
                type: "stroke", origin: "native", erase: true, bakePx: this.cam.inScale,
                id: this.doc.allocId(), pts: [p],
                lwFrame: (2 * this._eraserPx) / this.cam.inScale,
                color: ERASE_COLOR, opacity: 1, paths: [],
            };
            this._startPen(o, false);
            this.store.live = o;
            this.doc.add(o, this.cam.frame, { live: true });
            this.renderer.addLive(o, false);
            if (o._pen) this.renderer.setLiveArcs(o._pen.gaps);
            this.renderer.update();
            this._drawing = o; this._drawStartT = Date.now();
            return;
        }
        if (this.tool === "select") {
            // NOTHING CHANGES ON THE WAY DOWN. A press is a promise the pointer
            // may not keep: on a phone the second finger of a pinch lands some
            // tens of milliseconds after the first, and until 2026-09-03 the
            // first had already selected whatever it touched — or dropped the
            // selection, if it touched paper — before the pinch was known to
            // be one. So the press is only RECORDED here. `_pointerMove` turns
            // it into a lasso or a drag once it has travelled SELECT_DRAG_PX
            // (`_beginSelectDrag`), `_pointerUp` treats a press that never
            // moved as a tap (`_selectTap`), and a pinch in between calls
            // `cancelSelectGesture`, which forgets it. The hit test still runs
            // now, because the answer is about where the finger LANDED.
            //
            // What a drag becomes: with nothing selected it is ALWAYS a lasso,
            // ink under the finger or not (Kobin, 2026-09-03: "if I click and
            // drag on my phone when nothing is selected, I think it should do a
            // lasso"); with a selection, a drag from a selected member moves
            // the selection, from an unselected object selects and moves that
            // one, and from paper draws a lasso. A ctrl drag always lassoes.
            this._selPress = { sx, sy, hit: this._hitTest(sx, sy), ctrl: !!ctrl, moved: false, t: Date.now() };
            return;
        }
        const p = this.cam.screenToFrame(sx, sy);
        const highlight = this.penType === "highlight";
        const straight = this.penType === "straight";
        const lw = (highlight ? this.penWidth * 2.5 : this.penWidth) / this.cam.inScale;
        const op = highlight ? Math.min(this.opacity, 0.45) : this.opacity;
        const o = { type: "stroke", origin: "native", id: this.doc.allocId(), pts: [p], lwFrame: lw, color: this.color, opacity: op, paths: [] };
        // Remembered ON THE STROKE, not read off `penType` later: the eraser
        // trail goes through this same move path, and reading the pen there
        // made the eraser draw straight lines after the line tool had been
        // used (Kobin, 2026-09-03).
        if (straight) o._straight = true;
        this._startPen(o, straight);
        this.store.live = o; // exempt from bbox/flatten caches until it stops growing
        this.doc.add(o, this.cam.frame, { live: true });
        this.renderer.addLive(o, straight);
        if (o._pen) this.renderer.setLiveArcs(o._pen.gaps);   // a lone tap is still a dot
        this.renderer.update();
        this._drawing = o; this._drawStartT = Date.now();
        this._emit();
    }
    _pointerMove(sx, sy) {
        if (this.tool === "pan" && this._panLast) {
            const dx = sx - this._panLast[0], dy = sy - this._panLast[1];
            this._panLast = [sx, sy]; this.panBy(dx, dy); return;
        }
        if (this.tool === "erase") { if (this._erasing) this.eraseAt(sx, sy); return; }
        // "erasePartial" falls through: the eraser trail is this._drawing.
        if (this.tool === "select") {
            if (this._lasso) {
                const last = this._lasso.pts[this._lasso.pts.length - 1];
                if (Math.abs(sx - last[0]) > 1 || Math.abs(sy - last[1]) > 1) {
                    this._lasso.pts.push([sx, sy]);
                    this._lasso.moved = true;
                    this.renderer.refreshSelection();
                }
                return;
            }
            const P = this._selPress;
            if (P && !P.moved) {
                // Still a press until it has travelled far enough to mean it.
                if (Math.hypot(sx - P.sx, sy - P.sy) < SELECT_DRAG_PX) return;
                P.moved = true;
                this._beginSelectDrag(P, sx, sy);
                return;
            }
            if (this._dragSel && this.selection) this._dragSelection(sx, sy);
            return;
        }
        if (this._drawing) {
            const p = this.cam.screenToFrame(sx, sy);
            const o = this._drawing;
            if (o._straight && o.pts.length >= 2) { o.pts[1] = p; this.renderer.setLiveEnd(p); }
            else {
                o.pts.push(p);
                // The arc centerline is maintained WHILE DRAWING, and it is what
                // gets painted. A new sample only disturbs the spline's handles
                // at its two nearest neighbours, so exactly the last two gaps are
                // rebuilt: O(1) a point, microseconds, and by pen-up the most
                // expensive phase of the bake is already paid for.
                if (o._pen) { o._pen.addSample(p); this.renderer.setLiveArcs(o._pen.gaps); }
                else this.renderer.extendLive(p);
            }
            this.renderer.update();
        }
    }
    // Attach a live arc chain to a stroke about to be drawn. The tolerance is
    // half an arc-tolerance pixel AT THE ZOOM IT IS DRAWN — the moment the raw
    // stroke is swapped for its resolved shape is the only moment the difference
    // between the two could ever be seen, and it is sub-pixel there by
    // construction. (Kobin signed off on 0.25 units in the pen sandbox; this is
    // tighter, and measured at 2.18 arcs per gap against 2.09, so it is free.)
    //
    // The straight-line tool gets no live pen: it REPLACES its second point on
    // every move, and an incremental chain cannot take back a sample. Two points
    // cost nothing to chain at pen-up.
    _startPen(o, straight) {
        o._tol = (this.cfg.arcTolerancePx * 0.5) / this.cam.inScale;
        if (straight) { o._pen = null; return; }
        o._pen = new BiarcPen({ tol: o._tol });
        o._pen.addSample(o.pts[0]);
    }
    _pointerUp() {
        if (this._selPress) {
            const P = this._selPress; this._selPress = null;
            if (!P.moved) { this._selectTap(P); return; }
        }
        if (this._lasso) {
            const L = this._lasso; this._lasso = null;
            if (L.moved && L.pts.length >= 3) this._applyLasso(L);
            // ALWAYS redraw the selection layer, whatever the loop caught. A
            // lasso closed over empty paper with nothing already selected ends
            // in `deselect`, which returns early when there is no selection —
            // so nothing re-rendered and the loop you had just drawn stayed on
            // screen until something else happened to trigger a sync.
            this.renderer.refreshSelection();
            this._emit();
            return;
        }
        if (this._dragSel) {
            const d = this._dragSel; this._dragSel = null;
            this.store.setBatch(false);
            // one undo op for the whole drag, in the object's home-frame units
            if (d.moved && this.selection) {
                // A move that walked an object out of its own cell is finished
                // by re-homing it into the cell it now sits in, so invariant 2
                // holds again before anything else looks at the document.
                let rehomed = false;
                for (const [id] of d.moves) {
                    const n = this._normalizeHome(id);
                    if (!n) continue;
                    rehomed = true;
                    const st = d.moves.get(id);
                    st.to = n.level; st.dx += n.dx; st.dy += n.dy;
                }
                const moves = [...d.moves].map(([id, v]) => {
                    const rec = this.doc.getById(id);
                    return { id, dx: v.dx, dy: v.dy, from: v.from, to: v.to,
                        base: v.base, after: rec ? Document.snapGeometry(rec.obj) : null };
                });
                this._note({
                    kind: "move",
                    moves: moves.map((m) => {
                        const rec = this.doc.getById(m.id);
                        const b = rec && rec.obj.loops ? loopsBBox(rec.obj.loops) : null;
                        return { id: m.id, level: rec ? rec.level : null,
                            from: m.from, to: m.to,
                            dx: +m.dx.toPrecision(8), dy: +m.dy.toPrecision(8),
                            // How far from its frame's origin the piece now sits.
                            // Under the lattice this is bounded by construction —
                            // it is the number F25 watched climb to 7.3e18.
                            reach: b ? +Math.max(Math.abs(b.x0), Math.abs(b.y0), Math.abs(b.x1), Math.abs(b.y1)).toPrecision(6) : null,
                            // The offsets below its home after the drag (F41).
                            below: rec ? encodeBelow(rec.obj.below) : undefined };
                    }),
                    // Members the drag could not move, and why (F35).
                    skipped: d.skipped && d.skipped.length ? d.skipped.slice(0, 12) : undefined,
                });
                this.doc.pushUndo(moves.length === 1 ? { op: "move", ...moves[0] } : { op: "moveMany", moves });
                // THE RE-HOME HAPPENED AFTER THE LAST RENDER. `_dragSelection`
                // rendered on every pointer event, and then `_normalizeHome`
                // moved the member to the next cell and its coordinates by a
                // whole frame — so `_lastList` still held it as a native of the
                // old frame, with loops now a frame away from where the list
                // said. The picture on screen was right (a re-home is a pure
                // change of address), but everything that reads the list was
                // not: the hit test missed the object where it visibly sat, so
                // the next tap on it DESELECTED, and the ants vanished until
                // the next pan or zoom. Measured 2026-09-05 with a stroke a
                // thousand units from the cell edge dragged 1,920 units.
                if (rehomed) this._render();
            }
        }
        if (this._drawing) {
            const o = this._drawing; this._drawing = null;
            // Journal it now: `pts` is deleted the moment the perimeter resolves.
            this._note({
                kind: o.erase ? "erase" : "draw", id: o.id,
                px: o.erase ? this._eraserPx : this.penWidth,
                lwFrame: +(o.lwFrame || 0).toFixed(4),
                pts: KobinEngine._thin(o.pts),
                cuts: [],
            });
            this.renderer.endLive();
            this.store.live = null;               // stroke is final: bbox/flatten may cache now
            this.doc.finalize(o);                 // index + update finer tiles (off-screen)
            this._queueBake(o);                   // resolve its perimeter, in slices
            this._scheduleBake(0);
            if (o.erase) {
                // ONE undo op for the whole eraser gesture; background baking
                // appends its per-object replacements to op.baked later.
                const op = { op: "eraseCommit", strokeId: o.id, strokeRec: null, baked: [] };
                this.doc.pushUndo(op);
                this._eraseCommits.set(o.id, op);
                this._scheduleBake();
            } else {
                this.doc.pushUndo({ op: "add", id: o.id });
                this._noteInkAdded(o);            // provisional scene assignment
            }
            // THIS IS THE ONE RENDER A PEN-UP MAKES (2026-09-07). The bake's
            // render, a few milliseconds later, used to be the second, and
            // each walked every group on screen; the resolved perimeter paints
            // the same picture as the raw stroke by design, so that one now
            // waits for whatever renders next (`_stepShapeBakes`).
            this._render();
            this._queueIdleFits();                // prefit the outline off the pen-up frame
        }
        this._panLast = null; this._erasing = false;
    }
    cancelStroke() {
        const o = this._drawing; if (!o) return;
        this._drawing = null; this.renderer.endLive(); this.store.live = null;
        this.doc.removeById(o.id);
        this._render();
    }

    // ---- undo / redo / clear ----
    undo() { if (!this.doc.undo()) return false; this._scheduleBake(); this._render(); return true; }
    redo() { if (!this.doc.redo()) return false; this._scheduleBake(); this._render(); return true; }
    clear() {
        const capture = () => ({ crossings: this.lm.serialize(), camera: this.cam.state() });
        const restore = (ext) => { this.lm.load(ext.crossings); this.cam.set(ext.camera); };
        this._bakeJobs = []; this._bakeQueued.clear();
        this.doc.clear(capture(), capture, restore); // reset event clears the tile cache
        this.lm.reset();
        this.cam.set({ frame: "0", activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 });
        this.renderer.clear();
        this._render();
    }

    // ---- status + ported BUG invariants ----
    _emit() {
        this.onStatus({
            level: this.cam.activeLevel, inScale: this.cam.inScale, effectiveZoom: this.cam.effectiveZoom(),
            nearCross: this.cam.inScale > this.cfg.enter * 0.8, objects: this._lastList.length,
            outline: this.outlineMode,
            lines: false, // per-origin curvature now; no global "line mode" level
            selection: this._selectionStatus(),
            canUndo: this.doc.canUndo(), canRedo: this.doc.canRedo(),
        });
    }
    _effectiveZoom() { return this.cam.effectiveZoom(); }
    _levelPointToScreen(level, x, y) { return this.cam.levelPointToScreen(level, x, y); }
    _objs() { return this._lastList; }
    // The fat-display invariants the ported BUG-02/05 tests assert.
    _fatOnScreen(o) { return this.renderer._fatOnScreen(o); }
    _outlinePad() { return this.renderer.outlinePad(this._lastList); }
    _frameWindow(margin) { return this.cam.frameWindow(margin); }

    _debugTileRects() {
        const out = [];
        for (const key of this.store._tileKeys()) {
            const [Ls, , ij] = key.split("|");
            const [i, j] = ij.split(",").map(Number);
            out.push({ level: Ls, i, j, rect: this.lm.tileRect(Ls, i, j) });
        }
        return out;
    }
}

// Everything the split moved out, put back where it was. `mixin` throws on a
// name that is already defined, so two files cannot silently claim one method.
mixin(KobinEngine.prototype, overlays, erasePipeline, selection, files, sceneOps);
