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
 *   sceneOps.js       scenes: the index client, jumps, pictures      (~130)
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
 * _effectiveZoom, opacityGroups, the camera fields, and _fatOnScreen (the
 * ported BUG-02/05 invariants).
 */
import { perfNow } from "./now";
import { BASE, ENTER, EXIT } from "./frameLattice";
import { BiarcPen } from "./geometry/biarc";
import Camera from "./Camera";
import Document from "./Document";
import LevelMap from "./LevelMap";
import Renderer from "./Renderer";
import TileStore from "./TileStore";
import Stage from "./Stage";
import { createPlacementModel } from "./placementModel";
import RasterRenderer, { LADDER_DQ, PREVIEW_QUANTA } from "./raster/RasterRenderer";
import PlateStore, { isPhoneBudget } from "./raster/PlateStore";
import { pictureStats } from "./raster/PictureLayer";
import { EST_DEFAULTS } from "./raster/PicturePyramid";
import { clipPolylineToRect, clipRingsToRect, flattenCurve } from "./geometry/polyline";
import { loopsArea, loopsBBox } from "./geometry/arcShape";
import { encodeBelow, cloneBelow, sameShift } from "./geometry/offsets";
import { strokeOutline } from "./geometry/clipperBoolean";
import { validateScaleDef } from "./scaleBar";
import { EventLatency, FrameMeter, GrowthLog, LongFrames } from "./instruments";
import { mixin } from "./mixin";
import { overlays } from "./overlays";
import { erasePipeline } from "./erasePipeline";
import { selection, SELECT_DRAG_PX } from "./selection";
import { files } from "./files";
import { sceneOps } from "./sceneOps";
import { leverDefaults, cleanLevers } from "./devLevers";
import { initFrameGc, noteFrameEvent, noteCameraFrame, collectFrames, sweepFrames } from "./frameGc";

// Eraser strokes paint in the canvas background color — visually "erased"
// the instant they're drawn, before any geometry work happens.
const ERASE_COLOR = "#ffffff";
// PAPER-PLAN R5b / §10 S6 / §10.18, the zoom-out ladder: the screens zoomed out 4× … 4,194,304×
// (LADDER_NEAR rungs, 22 octaves) about the centre, rastered coarse once the camera has been still,
// one rung an idle callback, drawn only as stand-ins; 2–6 plates a rung (LADDER_MARGIN at
// RasterRenderer.LADDER_DQ). The far rungs (every 6 octaves to 2^52) run only with `ladderFar`:
// in Kobin's tab at the nucleus each was one unsliced 10–17 s list build, rebuilt whenever the full
// plate cap evicted it (report 2026-09-24T04-06-17). A phone builds LADDER_PHONE_RUNGS.
const LADDER_FACTORS = [4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 2 ** 28, 2 ** 34, 2 ** 40, 2 ** 46, 2 ** 52];
const LADDER_NEAR = 11;
const LADDER_PHONE_RUNGS = 3;
const LADDER_QUIET_MS = 300;
const LADDER_MARGIN = 2.5;
const LADDER_REPORT_WAIT_MS = 500;
const LADDER_RUNG_BUDGET_MS = 250;
const LADDER_RUNG_BUDGET_PHONE_MS = 120;
// A rung's read is sliced this finely at idle: a 250 ms slice was a 0.3 s stall six times over
// after a zoom-out on the Magnum Opus (TESTER-3). A slice ends at the next tile past it.
const LADDER_SLICE_MS = 50;
const LADDER_SLICE_PHONE_MS = 30;
const LADDER_RUNG_TRIES = 120;
// perfLog entries at least this long also go to perfLong (the last PERF_LONG_CAP), which a report carries.
const PERF_LONG_MS = 200;
const PERF_LONG_CAP = 100;
/** The ladder's idle hop, with no forced timeout: a rung is one unsliced list build (up to 17 s at depth 9). */
const ladderIdle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn) : setTimeout(fn, 30));

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
    // Input frames (A3 §5): "raf" moves the camera per event and steps the picture once an animation
    // frame (the page's engine); "sync" steps per call, as the suites and the one-off engines expect.
    frames: "sync",
    // The Dev levers (A3 §8, `devLevers.js`), a desktop's values; a phone's replace them at construction.
    // Stored only until B-PYRAMID's pyramid and store read them (PLAN §1.2).
    ...leverDefaults(false),
};

export default class KobinEngine {
    /**
     * @param {Element} container the editor host
     * @param {object} [opts]
     * @param {number} [opts.width] @param {number} [opts.height] CSS px
     * @param {Function} [opts.onStatus]
     * @param {boolean} [opts.scenes] keep the scene index (SCENES-PLAN §7); false for an engine
     *        that never lists scenes (the thumbnails' copy)
     * @param {boolean} [opts.raster] draw the ink into plates on a canvas instead of into SVG
     *        (RASTERISER-PLAN §5.1). The engine's own default is OFF (the suites' and the
     *        thumbnails' SVG engines); the APP's default is ON since 2026-09-22 — `useKobinEngine`
     *        passes it and `?svg` is the gate to the SVG renderer. Construction-time: the renderer
     *        owns a canvas, a plate cache and a worker pool, so a live swap would be a second
     *        teardown path nothing tests.
     * @param {"raf"|"sync"} [opts.frames] "raf": camera and drag input step the picture once an
     *        animation frame (the page's engine, A3 §5); "sync", the default: once a call
     * @param {object} [opts.levers] Dev lever overrides (`devLevers.readLevers`: the URL's over
     *        this device's stored ones), over this device's defaults
     * @param {boolean} [opts.pyramid] the raster path draws through the picture pyramid (`?pyramid=1`, A3 §7.4);
     *        off, the old plates path, until the comparison is done and that path is deleted
     */
    constructor(container, { width, height, onStatus, raster = false, scenes = true, frames = null, levers = null, pyramid = false } = {}) {
        this.cfg = { ...DEFAULTS, ...leverDefaults(isPhoneBudget()), ...cleanLevers(levers) };
        if (frames === "raf" || frames === "sync") this.cfg.frames = frames;
        this.cfg.pyramid = !!pyramid;
        this.onStatus = onStatus || (() => {});
        this.width = width || window.innerWidth;
        this.height = height || window.innerHeight;

        this.lm = new LevelMap(this.cfg, this.width, this.height);
        this.doc = new Document();
        this.doc.lm = this.lm;   // a frame's pending shift is settled into its natives on first read
        initFrameGc(this);       // a frame holds something (F94): candidates from here on, collected at triggers
        this.doc.subscribe((ev) => noteFrameEvent(this, ev));
        // The camera's frame merged into the resident of its cell (an undo put a moved frame back where
        // the camera's twin was): the camera follows, the two being one cell settled, and the view is
        // drawn again once the read that merged it is done. Left on the gone frame, the canvas drew
        // nothing and new ink went to a frame the lattice lacked (REVIEWER-3 MOVE-2, F126).
        this.doc.subscribe((ev) => {
            if (ev.kind !== "mergeFrame" || !this.cam || String(this.cam.frame) !== String(ev.frame)) return;
            this.cam.frame = ev.into;
            Promise.resolve().then(() => { if (!this._destroyed) this._render(); });
        });
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
        // The scene (A2 §2): after the tile store, so its events see tiles already patched.
        this.stage = new Stage({
            doc: this.doc, lm: this.lm, store: this.store, cfg: this.cfg,
            model: createPlacementModel({ doc: this.doc, lm: this.lm, store: this.store }),
        });
        this.raster = !!raster;
        /** The plate cache, on the raster path only; the Stage is its freshness source (A2 §3.1). */
        this.plates = null;
        /** §8.4 rule 1's join. One writer — the renderer bumps it through the injected function, once a CAMERA step. */
        this._frameSeq = 0;
        /** A live drag the plane draws: its members and frame roots, whose events the Stage holds (A2 §2.7). */
        this._holdMove = null;
        if (this.raster) {
            this.plates = this.cfg.pyramid ? null : new PlateStore({ fresh: this.stage });
            this.renderer = new RasterRenderer(container, this.cam, this.cfg, {
                width: this.width, height: this.height, store: this.plates, stage: this.stage,
                frameSeq: () => ++this._frameSeq,
                notePerf: (op, t0, extra) => this.notePerf(op, t0, extra),
            });
            // On the pyramid's path the renderer builds its store (it is sized by the screen); the engine owns its lifetime.
            if (this.cfg.pyramid) this.plates = this.renderer.store;
            // A commit's hard drops (A2 §3.4): a frame whose id now means another place, another document.
            this.stage.onCommit((G, info) => {
                if (info.reset) { this.plates.dropAll(false); this.renderer.dropCarry(); return; }
                for (const pred of info.drop) this.plates.dropFrames(pred);
            });
        } else {
            this.renderer = new Renderer(container, this.cam, this.cfg, { width: this.width, height: this.height });
        }
        this.renderer.setTileDebug(false, () => this._debugTileRects());

        this.tool = "pen"; this.penType = "freehand"; this.color = "rgb(0,0,0)"; this.penWidth = 13; this.opacity = 1;
        this.opacityGroups = true; this.debug = false; this.tileDebug = false;
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
        this._bakeTimer = null;
        this._bakeDelay = Infinity;
        this._bakeJobs = [];            // pen-up perimeter resolves, stepped in slices
        this._bakeQueued = new Set();   // ids already in _bakeJobs
        this._initErase();              // the pending marks, their lineage, the reorder buffer (erasePipeline.js)
        this._lastList = []; this._lastRange = null;
        this.perfLog = [];
        this.perfLong = [];
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
        this.docMeta = { name: null, createdAt: new Date().toISOString(), scaleDef: null, scenes: [], sceneIndex: null };
        this._initScenes(scenes);
        this.renderer.setSelectionAnts(() => this._selectionAnts());
        this.renderer.setLasso(() => { const L = this._lasso || this._lassoParked; return L ? L.pts : null; });   // a parked lasso stays drawn
        this.renderer.setDragState(() => this._dragState());
        this.renderer.setPlaneState(() => this._planeState());
        this.renderer.onPlaneLost = () => this._planeLost();
        this.renderer.onPlaneAimed = () => this._maybeLadder();
        // A settle's carry takes natives across a cell edge (DESIGN.md §8); out of a selected frame they stay selected.
        this.doc.subscribeOps((ev) => { if (ev.kind === "settle" && ev.rec && ev.rec.carries && ev.rec.carries.length) this._followCarries(ev.frame, ev.rec.carries); });
        // Back from a hidden tab (the store released its plates): one render re-asks the view's
        // plates over the carried picture, and the ladder is rebuilt at the next quiet (§10.13).
        this.renderer.onShown = () => { if (this._destroyed) return; this._ladderAt = null; this._render(); };
        // The hold is on only where the renderer draws the dragged ink itself (the drag plane,
        // PAPER-PLAN R3, §10 S4); without it every step re-rasters its plates as before.
        this._moveHoldOn = !!this.renderer.supportsDragPlane;
        // The selected object can vanish under us (eraser, cut, undo, wipe, load).
        this.doc.subscribe((ev) => {
            if (!this.selection) return;
            if (ev.kind === "reset") { this.selection = null; this._dropHold("reset"); return; }
            // A selected frame merged into the resident of its cell: its natives stay selected as
            // ids, its kids that hold ink as frames (SUBTREE-O1-PLAN §2.5).
            if (ev.kind === "mergeFrame") {
                const s = this.selection;
                if (!s.frames.includes(ev.frame)) return;
                const inked = this._inkedFrames();
                const frames = s.frames.filter((f) => f !== ev.frame).concat(ev.kids.filter((k) => inked.has(k) && !s.frames.includes(k)));
                this._setSelection(s.ids.concat(ev.ids), frames);
                return;
            }
            // An undo or a redo moving ink out of (or back into) the selection's frames (`_keepingSelection`).
            if (this._moving) {
                const s = this.selection;
                if (ev.kind === "remove" && ev.rehome != null && (s.ids.includes(ev.id) || this._underFrames(ev.level, s.frames))) this._moving.ids.add(ev.id);
                if (ev.kind === "refile" && ev.from && this._underFrames(ev.from.parent, s.frames)) this._moving.frames.add(ev.frame);
            }
            if (ev.kind !== "remove") return;
            if (ev.rehome) return;   // it changed frames, it did not go away
            // Drop the member that went, and repair the primary if it was the
            // one removed. A member whose logical family still has geometry
            // (a re-homed patch) hands over to its sibling instead of vanishing.
            const ids = this.selection.ids.filter((id) => this.doc.getById(id));
            const frames = this.selection.frames || [];
            if (ev.id === this.selection.id && !ids.length) {
                const family = this.doc.editGroup(this.selection.editId);
                if (family.length) { this._setSelection([family[0].obj.id], frames); return; }
                if (frames.length) { this._setSelection([], frames); return; }
            }
            if (!ids.length && !frames.length) { this.selection = null; this._dropHold("removed"); return; }
            if (ids.length !== this.selection.ids.length || ev.id === this.selection.id) this._setSelection(ids, frames);
        });

        // "raf" frames: an arrival's compose waits for the frame (`PictureLayer._flush`, A3 §5).
        if (this.cfg.frames === "raf" && this.renderer.layer) this.renderer.layer.deferCompose = () => { if (!this._destroyed) this._pend().arrived = true; };
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
        if (t !== this.tool) this._cancelBarrier();   // a parked gesture goes with its tool (A2 §4.11)
        if (t !== this.tool && t !== "select") this.deselect();
        this.tool = t;
    }
    setPenType(t) { this.penType = t; }
    setColor(c) { this.color = c; }
    setWidth(w) { this.penWidth = w; }
    setOpacity(o) { this.opacity = o; }
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
    /**
     * The Dev levers (A3 §8, `devLevers.js`): the valid fields of `patch` into `cfg`, anything else ignored. On the
     * pyramid's path they take effect now: the budget in one eviction pass, a step change at this render's view.
     */
    setLevers(patch) {
        Object.assign(this.cfg, cleanLevers(patch));
        if (this.cfg.pyramid && this.renderer.onLevers && !this._destroyed) { this.renderer.onLevers(); this._render(); }
    }
    /** The level step S, one of `LEVEL_STEPS` (the Dev panel's 1·2·3 toggle). Returns the step in force. */
    setLevelStep(s) { this.setLevers({ levelStep: s }); return this.cfg.levelStep; }
    /** The plate cache's budget: `views` screens (1–8) under `ceilingMiB` (64–512). Returns the pair in force. */
    setPlateBudget({ views, ceilingMiB } = {}) {
        this.setLevers({ plateViews: views, plateCeilingMiB: ceilingMiB });
        return { views: this.cfg.plateViews, ceilingMiB: this.cfg.plateCeilingMiB };
    }
    setScaleDef(def) {
        this.docMeta.scaleDef = def ? validateScaleDef(def) : null;
    }

    setLazyOutlines(b) {
        this.lazyOutlines = !!b;
        this.renderer.setLazyOutlines(this.lazyOutlines);
        this._render(); // representation choice may change for pending strokes
        if (this.lazyOutlines) this._queueIdleFits();
    }
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
        if (this._destroyed || (w === this.width && h === this.height)) return;
        const t0 = perfNow();
        this.width = w; this.height = h;
        this.lm.resize(w, h); this.renderer.setSize(w, h);
        this._render();
        this._perf("resize", t0, true, { w, h });
    }
    destroy() {
        this._destroyed = true;
        if (this._bakeTimer != null) { clearTimeout(this._bakeTimer); this._bakeTimer = null; }
        if (this._ladderTimer != null) { clearTimeout(this._ladderTimer); this._ladderTimer = null; }
        if (this._readTimer != null) { clearTimeout(this._readTimer); this._readTimer = null; }
        if (this._frCancel) { this._frCancel(); this._frCancel = null; }
        this._fr = null;
        this.frameMeter.stop();
        this.longFrames.stop();
        this.eventLatency.stop();
        if (this._sceneClient) this._sceneClient.destroy();
        this.stage.destroy(); this.store.destroy(); this.renderer.destroy();
        // After the renderer: its own `destroy` reports every job still in flight so `endJob`
        // runs for each, and those calls reach this store (§10 stage 5b item 14).
        if (this.plates) this.plates.destroy();
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
        // The log rolls over in a minute or two of work; a long operation is kept for the report.
        if (ms >= PERF_LONG_MS) {
            this.perfLong.push(e);
            if (this.perfLong.length > PERF_LONG_CAP) this.perfLong.shift();
        }
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
            for (const o of this.doc.list(L)) {
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
        const win = this._listWin();
        const F = this.cam.frame;
        const list = this.listFor(F, win, true);
        // A change of frame: the tiles of frames the camera has left go (memory step 3a), after
        // the read, which pins what the new view uses (F83). Never in `listFor`: an off-camera
        // build that ran it would throw away the camera's own tiles (C §2.3).
        if (F !== this._tileFrame) { this.store.framesLeft(F); this._tileFrame = F; }
        this._lastRange = this.lm.tileRange(F, win);
        return list;
    }
    /**
     * The render list for `rect` in frame `frameKey` — tile pieces (up + down) plus that frame's
     * own natives, merged in id order (global z-order). `_buildList` is this call for the
     * camera's own frame and window; the crossing prebake (PAPER-PLAN R4) and `snapshotView`
     * (SCENES-PLAN S1) call it for a frame the camera is not at.
     *
     * Three facts a reader needs.
     *
     * The residual's depth is `frameKey`'s, never `cam.activeLevel` — a wrong depth draws every
     * moved object at the wrong offset, silently, and only in a picture nobody is looking at yet
     * (F41, §5.4 rule 3). For the camera's own frame the two are the same number by construction
     * (`Camera.activeLevel` is `depthOf(frame)`).
     *
     * `forCamera` says this build is the camera's own, and it buys two things that are the
     * camera's and nothing else's: the tiles it reads are PINNED (an off-camera read goes
     * through `contentOffCamera`, which restores the visible pin set by value), and §5.4's
     * old-address memo is seeded. A prebake or a snapshot running between a document event and
     * the next drain would seed that memo with the POST-event table, and the drain would then
     * compute the old address as the new one and leave a plate holding the object's old picture
     * undropped.
     *
     * A frame the camera has never visited pays its tile bake here, synchronously, and on a busy
     * frame that is seconds (F59). The cost is on `perfLog` as `listFor`.
     *
     * @param {string|number} frameKey a frame id or a legacy depth int (`LevelMap.frameFor` normalises)
     * @param {{left:number, top:number, right:number, bottom:number}} rect the window, in `frameKey`'s units
     * @param {boolean} [forCamera=false] the camera's own build (pin the tiles, seed the memo)
     * @returns {object[]} the render list, sorted by `(z ?? id, id)`; `[]` for an unreachable frame
     */
    listFor(frameKey, rect, forCamera = false, budgetMs = 0) {
        const t0 = perfNow();
        const cf = this.lm.frameFor(frameKey);
        if (!cf) return [];
        const F = cf.id;
        const derived = forCamera ? this.store.content(F, rect) : this.store.contentOffCamera(F, rect, budgetMs);
        if (!derived) return null;                   // off camera, past `budgetMs`: not built
        const model = this.stage.model;
        const list = derived.concat(model.nativesIn(F));
        // Renderer grouping follows logical edit ownership for re-homed
        // boundary patches. That lets parent/patch overlap close AA seams while
        // applying transparent opacity only once to the family.
        //
        // THE RESIDUAL (F41, A1 C1): every piece is painted translated by its native's remainder seen
        // from F (`placementModel.placement`), never stored, so nothing derives from it; stamped as
        // `res` so every reader of the list sees the same picture.
        const hasOff = this.doc.hasOffsets();
        const resById = hasOff ? new Map() : null;
        for (const o of list) {
            const rec = this.doc.getById(o.id);
            if (rec && rec.obj.editId != null) o.editId = rec.obj.editId;
            // A pending mark's piece seen from another frame is its mask, at the mark's z now: a tile
            // copy lost `erase` and kept the z it was derived at (REVIEWER E-5: white ink over what
            // is drawn after it).
            if (rec && rec.obj.erase && o !== rec.obj) { o.erase = true; if (rec.obj.z != null) o.z = rec.obj.z; }
            let res = null;
            if (hasOff && rec) {
                res = resById.get(o.id);
                if (res === undefined) { const pl = model.placement(rec.obj, F); res = pl && (pl.rem[0] || pl.rem[1]) ? pl.rem : null; resById.set(o.id, res); }
            }
            if (res) o.res = res; else if (o.res) delete o.res;
        }
        // z defaults to id (creation order); cut pieces carry their source's z
        // so a stroke stays at its depth after a boolean erase splits it.
        list.sort((a, b) => ((a.z != null ? a.z : a.id) - (b.z != null ? b.z : b.id)) || (a.id - b.id));
        // C's risk 5: a cold frame's bake is seconds (F59), so an off-camera build that paid one
        // shows up in the report rather than only in a stall. `_perf`'s 8 ms floor is the filter.
        // The camera's own build is timed by `_render` and charged to `eng.list`.
        if (!forCamera) this._perf("listFor", t0, false, { frame: F, n: list.length, tiles: this.store.size() });
        return list;
    }
    // ---- the drag's hold (A2 §2.7: the Stage holds the drag's events until its end) ----
    /** The hold, taken once at `_beginSelectDrag` when the plane draws the drag: the Stage holds its events. */
    _beginHold() {
        this._holdMove = null;
        if (!this._moveHoldOn || !this.raster || !this.selection) return;
        // The plane is aimed (and what it lacks posted) now; a selection it refuses drags the old way.
        if (this.renderer.planeAccepts && !this.renderer.planeAccepts()) return;
        const ids = new Set();
        for (const rec of this._selectionMembers()) ids.add(rec.obj.id);
        const frames = (this.selection.frames || []).slice();
        this._holdMove = { ids, frames, at: null };
        this.stage.hold({ ids, frames });
    }
    /**
     * The renderer's plane can no longer draw the live drag (the camera left its frame, the sync path,
     * a release): the hold is released once and the drag renders a step as before. The ants' decision
     * made from here anchors at the pointer, not the start: the list now holds the move (review major 2).
     */
    _planeLost() {
        if (!this._holdMove) return 0;
        const n = this._releaseMove();
        if (this._dragSel) this._dragSel.listAt = null;
        return n;
    }
    /**
     * The drag plane's input (PAPER-PLAN §10 S4), pulled by the renderer each camera step: the
     * selection's ids in the current list — a selected frame's natives found by their home, so a
     * subtree costs the list and not its object count — or null. Memoised on the list and the selection.
     */
    _planeState() {
        const s = this.selection;
        if (!s || !this.raster) return null;
        const list = this._lastList, m = this._planeMemo;
        if (m && m.sel === s && m.list === list) return m.state;
        // The families the indicator's table already expanded for this selection (0.24 s again here on a
        // 29k-id lasso, REVIEWER-4); members under a selected frame are in it too, and harmless.
        const members = this._selTable(s).ids;
        const frames = s.frames || [];
        const ids = new Set();
        for (const o of list) {
            if (members.has(o.id)) { ids.add(o.id); continue; }
            if (!frames.length) continue;
            const rec = this.doc.getById(o.id);
            if (rec && this._underFrames(rec.level, frames)) ids.add(o.id);
        }
        const state = ids.size ? { key: s, ids } : null;
        this._planeMemo = { sel: s, list, state };
        return state;
    }
    /** What the renderer pulls each frame: null, or the live drag with its member set and the pointer it was first read at. */
    _dragState() {
        const d = this._dragSel, h = this._holdMove;
        if (!d || !h) return null;
        if (!h.at) h.at = d.last ? [d.last[0], d.last[1]] : [d.start[0], d.start[1]];
        return { drag: d, ids: h.ids, frames: h.frames, at: h.at };
    }
    /**
     * The ONE exit of a drag — the drop, a cancel, a delete, a deselect, an undo: the gesture,
     * the tile batch and the merge hold cleared, the Stage's hold released as one commit, the
     * renderer told, one render.
     */
    _endMove(why) {
        const d = this._dragSel, carried = this._carried || new Set();
        this._dropHold(why);
        // The drop's render settles the moved frames too: their carries join the drag's.
        this._dropping = d ? { d, ids: carried } : null;
        try { this._render(); } finally { this._dropping = null; }
        // What the drag moved out of every selected frame stays selected (DESIGN.md §10).
        if (d && this.selection && (why === "drop" || carried.size)) this._reselect([...carried], why === "drop" && d.frames ? this._outsideSelection(d.frames.keys()) : []);
        collectFrames(this);      // the containers the gesture minted or emptied (F94)
    }
    /** `_endMove` without the render: for a document event (a reset, the last member removed under a bake) where a render would re-enter. */
    _dropHold(why) {
        const live = this._dragSel || this._holdMove;
        this._dragSel = null;
        this._carried = null;
        this.store.setBatch(false);
        this.doc.holdMerges = false;
        const n = this._releaseMove();
        if (live && this.renderer.endMove) this.renderer.endMove(why, n);
    }
    /** The hold's end: the Stage applies what it held as one commit, dirtying the start and the end (A2 §2.7). */
    _releaseMove() {
        const h = this._holdMove; this._holdMove = null;
        return h ? this.stage.release() : 0;
    }
    /** @param {number} [readMs] the table's read budget: a camera step's is `_camReadMs()` */
    _render(readMs = Infinity) {
        // A destroyed engine is inert: a late step would rebuild lists and plates in the host the
        // next engine shares (OPEN-FLAGS F101).
        if (this._destroyed) return;
        const t0 = perfNow();
        this._renderPending = false;   // a deferred bake render is satisfied by any render (`_stepShapeBakes`)
        // The camera changed frame: what it left may go (F94) — before the table, whose memos count frames.
        if (noteCameraFrame(this)) collectFrames(this, true);
        // RASTER (§8.1): the table's sync is ENGINE work, so the frame's perf row opens HERE and
        // `RasterRenderer.render` finds it open — `eng.list` is inside `mainMs` (D233, D241).
        const ras = this.raster ? this.renderer : null;
        if (ras) ras.beginRender();
        const tList = perfNow();
        // The raster path packs the Stage's items and builds no list (A2 §6.2 S3); the SVG path draws `listFor`'s.
        if (!ras) this._lastList = this._buildList();
        this.stage.sync(this.cam.frame, this._listWin(), readMs);
        if (readMs !== Infinity) this._readIdle();
        if (ras) {
            // A change of frame: the tiles of frames the camera left go, after the read pinned the new view's (F83).
            const F = this.cam.frame;
            if (F !== this._tileFrame) { this.store.framesLeft(F); this._tileFrame = F; }
            this._lastList = this.stage.items();
            ras.noteList(perfNow() - tList);
        }
        this.renderer.render(this._lastList, this.cam.frame);
        this.renderer.update();
        this._emit();
        this._perf("render", t0, false, { n: this._lastList.length, fat: this.renderer._hasFat });
        if (this._carriedLater) this._flushCarried();     // what this render's settles carried (F93)
        // Sample frames around a render too, not only around a gesture. The
        // worst stall seen so far is a COLD one — opening a drawing at a deep
        // camera — and a meter that only woke for zoom and pan would sleep
        // straight through it.
        this.frameMeter.poke();
        this._maybeLadder();
    }
    // True if the visible tile set changed since the last full render.
    /**
     * The window the camera's table (and the SVG path's list) reads. On the plates path it is grown
     * by one plate of the coarsest quantum packed from it (the preview's, and the plane's quick
     * level): a plate reaching past the squares the table read would be rastered without that ink
     * (REVIEWER-4 P-1); `covers` refuses it now, and this margin keeps it from being refused.
     */
    _listWin() {
        const win = this.cam.frameWindow(0);
        if (!this.raster || !this.renderer.listMargin) return win;
        const m = this.renderer.listMargin(this.cam.inScale);
        return { left: win.left - m, top: win.top - m, right: win.right + m, bottom: win.bottom + m };
    }
    /**
     * The raster path's camera step (A2 §2.11): the table synced to the window — a window change
     * reads and drops tiles, and nothing is rebuilt — then the renderer's step. A crossing renders.
     */
    _tableStep(crossed) {
        if (crossed) { this._render(this._camReadMs()); return; }
        this._syncStep(); this.renderer.update(); this._emit();
    }
    /** A step without a render: on the raster path the table is synced first (a tile an event dropped is read again). */
    _syncStep() {
        if (this.raster) {
            const readMs = this._camReadMs();
            this.stage.sync(this.cam.frame, this._listWin(), readMs);
            if (readMs !== Infinity) this._readIdle();
            this._lastList = this.stage.items();
        }
        this.renderer.syncCameraOnly();
    }
    /**
     * A camera step's table read (A3 §4.2): on the pyramid's path the cache alone — a tile not read is absent this
     * frame, its cells drawn from stand-ins and never packed (`covers`); `_readIdle` reads it. Elsewhere everything.
     */
    _camReadMs() { return this.cfg.pyramid ? 0 : Infinity; }
    /**
     * The tiles a camera step left unread, read once the camera has been still for the rest's quiet (a bake is not
     * recalled, as a posted job is not: A3 §2.1), a slice at a time at idle (LADDER_SLICE_MS, 30 on a phone; a slice
     * ends at the next tile past it). Each slice steps the renderer, whose plan asks for the cells now covered (an
     * empty tile covers without a commit).
     */
    _readIdle() {
        if (this._readTimer != null || this._destroyed || !this.raster) return;
        if (this.stage.covers(this.cam.frame, this._listWin())) return;
        const quiet = this.cfg.restQuietMs != null ? this.cfg.restQuietMs : EST_DEFAULTS.restQuietMs;
        const wait = Math.max(0, (this._lastCamMove || 0) + quiet - perfNow());
        this._readTimer = setTimeout(() => ladderIdle(() => {
            this._readTimer = null;
            if (this._destroyed) return;
            if (perfNow() - (this._lastCamMove || 0) < quiet) { this._readIdle(); return; }   // it moved: the quiet again
            const G0 = this.stage.generation, t0 = perfNow();
            this.stage.sync(this.cam.frame, this._listWin(), this.plates.phone ? LADDER_SLICE_PHONE_MS : LADDER_SLICE_MS);
            this._perf("tileRead", t0, false, { G: this.stage.generation - G0 });
            this._lastList = this.stage.items();
            this.renderer.syncCameraOnly();
            this._readIdle();
        }), wait);
    }
    _visibleChanged() {
        const r = this.lm.tileRange(this.cam.frame, this._listWin());
        const p = this._lastRange;
        return !p || r.i0 !== p.i0 || r.i1 !== p.i1 || r.j0 !== p.j0 || r.j1 !== p.j1;
    }

    // ---- the input frame (A3 §5) ----
    /**
     * The step the next animation frame takes ("raf" frames): asked for at the first event and filled by
     * every event until it runs. The camera moves at each event, so hit tests and the float arithmetic
     * are what they were; only the consequences wait for the frame.
     */
    _pend() {
        if (!this._fr) {
            this._fr = { pan: false, zoom: false, crossed: false, drag: null, svg: false, arrived: false };
            const run = () => { this._frCancel = null; this._frame(); };
            if (typeof requestAnimationFrame === "function") {
                const id = requestAnimationFrame(run);
                this._frCancel = () => cancelAnimationFrame(id);
            } else {
                const id = setTimeout(run, 16);
                this._frCancel = () => clearTimeout(id);
            }
        }
        return this._fr;
    }
    /** Take the pending step now, if there is one: a press or a release, the suites, the harness. */
    flush() {
        if (this._frCancel) { this._frCancel(); this._frCancel = null; }
        this._frame();
    }
    /**
     * One animation frame's step, once: the drag's at the last pointer (it recomputes the move from the
     * drag's start, M-4, and renders or takes the camera-only step itself), then the camera's — a zoom's
     * consequences when the frame zoomed, a pan's when it only panned; else the live stroke's SVG update;
     * else one compose for the plates that arrived.
     */
    _frame() {
        const fr = this._fr;
        this._fr = null;
        if (!fr || this._destroyed) return;
        const t0 = perfNow();
        let stepped = false;
        if (fr.drag && this._dragSel && this.selection) { this._dragSelection(fr.drag[0], fr.drag[1]); stepped = true; }
        if (fr.zoom) { this._zoomStep(fr.crossed, t0); stepped = true; }
        else if (fr.pan) { this._panStep(fr.crossed, t0); stepped = true; }
        if (stepped) {
            // Stillness is seen only on a frame (A3 §2.1): the pyramid gets one more after a camera step.
            if (this.cfg.pyramid && (fr.zoom || fr.pan)) this._pend().still = true;
            return;
        }
        if (fr.svg) this.renderer.update();
        if (fr.still && this.raster) this.renderer.syncCameraOnly();
        else if (fr.arrived && this.renderer.layer) { this.renderer.layer.compose(); pictureStats.arrivalComposes++; }
    }

    // ---- pan / zoom ----
    panBy(dx, dy) {
        if (this._destroyed) return;
        const t0 = perfNow();
        this._lastCamMove = t0;
        this.frameMeter.poke();
        const crossed = this.cam.panBy(dx, dy);
        if (this.cfg.frames === "raf") { const fr = this._pend(); fr.pan = true; fr.crossed = fr.crossed || crossed; return; }
        this._panStep(crossed, t0);
    }
    /** A pan's consequences: once a call, or once a frame in "raf". */
    _panStep(crossed, t0) {
        // SVG: needsWindowChop — the view has left the inner half of the scene's window, so the
        // pieces chopped to it must be rebuilt on a fresh one before its edge could come on screen
        // (F40). A pan into another cell renders: the list is in the old frame's units (REVIEWER-3 CAM-1).
        if (this.raster) this._tableStep(crossed);
        else if (crossed || this._visibleChanged() || this.renderer.needsReorigin() || this.renderer.needsWindowChop()) this._render();
        else { this.renderer.syncCameraOnly(); this.renderer.update(); this._emit(); }
        this._perf("pan", t0);
        this._noteFast("panStep", perfNow() - t0);
        this._maybeLadder();
    }
    zoomAt(sx, sy, deltaY) { this.zoomFactorAt(sx, sy, Math.pow(2, -deltaY / 1000)); }
    /** A pinch: its pan's cell change is the step's as much as the zoom's crossing is. */
    pinchUpdate(mx, my, factor, dx, dy) {
        if (this._destroyed) return;
        this._zoomBy(mx, my, factor, this.cam.panBy(dx, dy));
    }
    zoomFactorAt(sx, sy, factor) { this._zoomBy(sx, sy, factor, false); }
    _zoomBy(sx, sy, factor, crossedBefore) {
        if (this._destroyed) return;
        const t0 = perfNow();
        this._lastCamMove = t0;          // `_camBusy` — keep bake slices off this frame
        this.frameMeter.poke();
        const crossed = this.cam.zoomFactorAt(sx, sy, factor) || !!crossedBefore;
        if (this.cfg.frames === "raf") { const fr = this._pend(); fr.zoom = true; fr.crossed = fr.crossed || crossed; return; }
        this._zoomStep(crossed, t0);
    }
    /** A zoom's consequences: once a call, or once a frame in "raf". */
    _zoomStep(crossed, t0) {
        // needsFatFlip: lazy-pending fat strokes approaching the gate must flip
        // to their outline representation BEFORE raw stroking becomes unsafe.
        // needsFadeFlip: a zoom can move a piece across the fully-present line,
        // which changes which GROUP it belongs in. Only a full render regroups.
        // needsWindowChop: a zoom in past the window's budget, or a zoom out
        // that has outgrown its inner half (F40).
        //
        // These are the SVG path's promotions; the raster path's step is the table's (`_tableStep`).
        if (this.raster) this._tableStep(crossed);
        else if (crossed || this._visibleChanged() || this.renderer.needsFatFlip()
            || this.renderer.needsFadeFlip() || this.renderer.needsReorigin() || this.renderer.needsWindowChop()) this._render();
        else { this.renderer.syncCameraOnly(); this.renderer.update(); this._emit(); }
        this._perf(crossed ? "cross" : "zoom", t0, crossed);
        this._noteFast(crossed ? "crossStep" : "zoomStep", perfNow() - t0);
        this._maybePrebake();
        this._maybeLadder();
        // prefit outlines when strokes approach the gate or a new level activates
        if (crossed || this.renderer.hasPendingNearFat()) this._queueIdleFits();
    }
    /**
     * The frame the camera would land in if the crossing it is approaching came now, and the
     * in-frame scale it would land at (PAPER-PLAN §7.4, C §2.1). Null when no crossing is
     * within about one quantum, when the lattice holds no such frame, and — going down — at
     * the root, because `Camera._crossDown` reaches `ensureParentEdge`, which GROWS a root,
     * and a speculative prebake must never mint a frame. It mints nothing itself except under
     * the `preBake` dev toggle, where the upward branch defines the child early on purpose.
     *
     * The predicates are `enter * 0.8` and its exact mirror `exit * 1.25`; one quantum is
     * 2^(1/4) = 1.189, so both are 1.16 quanta out. The post-crossing scale is `_crossUp`'s
     * `inScale * base / s` and `_crossDown`'s `(s / base) * inScale`, read off the same `edge`
     * record they use — a second copy of the crossing is what F45 cost.
     *
     * @returns {{id: string, dir: "up"|"down", inScale: number}|null}
     */
    _crossTarget() {
        const cam = this.cam, base = this.cfg.base;
        if (cam.inScale > this.cfg.enter * 0.8) {
            // Find (or, if the dev toggle allows, define early) the child FRAME this upward
            // approach will cross into. A FIRST entry is prebakeable under `preBake` because
            // the child's crossing record is "first defined, forever": any frame captured on
            // the way up is as valid as the one at the crossing moment.
            let child = this.lm.findChild(cam.frame, cam.inScale, cam.inPanX, cam.inPanY);
            if (!child && this.preBake) child = this.lm.ensureChild(cam.frame, cam.inScale, cam.inPanX, cam.inPanY);
            if (!child || !child.edge) return null;
            return { id: child.id, dir: "up", inScale: cam.inScale * base / child.edge.s };
        }
        if (cam.inScale < this.cfg.exit * 1.25) {
            const f = this.lm.frame(cam.frame);
            if (!f || f.parent == null || !f.edge) return null;
            return { id: f.parent, dir: "down", inScale: (f.edge.s / base) * cam.inScale };
        }
        return null;
    }

    // Idle pre-bake: nearing a crossing, warm the target frame's tiles during idle time so the
    // crossing lands on a hot cache, and — on the raster path — raster its PREVIEW plates
    // (PAPER-PLAN R4). Fire-and-forget; the bake is idempotent.
    //
    // The read goes through `listFor`, so it takes `contentOffCamera`'s pin discipline: the
    // visible tiles stay pinned and the prebaked ones stay evictable. The hand-restore this
    // replaced saved the pin SET BY REFERENCE, which `content` mutates in place before
    // replacing the field, so it put back a set holding the prebaked frame's keys (C §2.3).
    /**
     * PAPER-PLAN R5b: (re)start the quiet timer; when it runs out the ladder is built at idle.
     * Every camera step and render restarts it, so nothing is built during a gesture.
     */
    _maybeLadder() {
        if (!this.raster || !this.plates || !this.renderer.ladderPlates || this._destroyed || this.cfg.pyramid) return;   // the prefetch's far levels instead
        if (this._ladderTimer != null) clearTimeout(this._ladderTimer);
        this._ladderTimer = setTimeout(() => {
            this._ladderTimer = null;
            ladderIdle(() => { if (!this._destroyed) this._buildLadder(); });
        }, LADDER_QUIET_MS);
    }
    /**
     * The ladder's rungs, each `listFor` off camera (which bakes the parent level's tiles before
     * any crossing reaches them) and posted at low priority, unpinned. Skipped mid-gesture and
     * when the camera is where the last ladder was built. Returns the strips queued.
     */
    _buildLadder() {
        if (this._drawing || this._dragSel || this._lasso) return 0;
        if (perfNow() - (this._lastCamMove || 0) < LADDER_QUIET_MS) { this._maybeLadder(); return 0; }
        const key = this._ladderKey();
        // Built here already, unless a pinned drag plane has since evicted rungs: rebuilt once a view.
        const ev = this.plates.s.ladderEvictions;
        if (key === this._ladderAt && (ev === this._ladderEv || key === this._ladderRebuilt)) return 0;
        if (key === this._ladderAt) this._ladderRebuilt = key;
        this._ladderAt = key;
        this._ladderEv = ev;
        this.store.clearWarm();
        // The rungs, then the view just past each crossing the rungs span, LAST: that one tile is
        // what a zoom-out crossing bakes on the main thread (1,199 ms cold against 101 warm on
        // the Magnum Opus), and last is what keeps it inside TileStore's per-level cap.
        const n = this.plates.phone ? LADDER_PHONE_RUNGS : (this.ladderFar ? LADDER_FACTORS.length : LADDER_NEAR);
        const steps = LADDER_FACTORS.slice(0, n).map((factor) => ({ factor, cross: false }));
        for (const factor of this._ladderCrossings(LADDER_FACTORS[Math.min(n, LADDER_NEAR) - 1])) steps.push({ factor, cross: true });
        this._ladderSteps = steps;
        return this._ladderRung(0, key);
    }
    /**
     * The zoom-out factors, from the camera, just past each level crossing inside `maxFactor`:
     * `_crossDown`'s arithmetic, as `_zoomedOut` walks it. Stops at a root.
     */
    _ladderCrossings(maxFactor) {
        const out = [], base = this.cfg.base, exit = this.cfg.exit;
        let f = this.lm.frame(this.cam.frame), s = this.cam.inScale, total = 1;
        while (f && f.parent != null && f.edge) {
            total *= s / exit;                         // zoom-out, from the last step, to this frame's exit
            if (total * 1.02 > maxFactor) break;
            out.push(total * 1.02);                    // just past it: the camera is in the parent
            s = (f.edge.s / base) * exit;              // the parent's inScale at the crossing
            f = this.lm.frame(f.parent);
        }
        return out;
    }
    _ladderKey() { const c = this.cam; return c.frame + "|" + c.inScale + "|" + c.inPanX + "|" + c.inPanY + "|" + this.width + "x" + this.height; }
    /** One rung, then the next at the next idle callback — a list build is 100–200 ms on a dense drawing. Stops when the camera moves. */
    _ladderRung(k, key) {
        const steps = this._ladderSteps || [];
        const rungs = steps.length;
        this._ladderBusy = false;
        if (this._destroyed || k >= rungs || key !== this._ladderKey() || this._drawing || this._dragSel || this._lasso) return 0;
        if (this._ladderCap && this._ladderCap.key === key && k > this._ladderCap.k) return 0;   // past this view's over-budget rung
        if (this._reportBusy) {                       // a report yields ~230 times; a rung in each gap froze it
            this._ladderBusy = true;
            setTimeout(() => this._ladderRung(k, key), LADDER_REPORT_WAIT_MS);
            return 0;
        }
        const step = steps[k];
        const aim = this._zoomedOut(step.factor);
        if (!aim) return 0;
        const t = { id: aim.frame, inScale: aim.inScale, first: k === 0 };
        let posted = 0;
        // A rung's list is built only when a plate is missing — after a small pan they are mostly
        // cached, and a list build is 100–300 ms of main thread on the Magnum Opus. A crossing
        // step always builds its list: warming the tiles is its whole point.
        if (this.renderer.ladderMisses(t, aim.win) > 0 || step.cross) {
            const tL = perfNow();
            const budget = this.ladderRungBudgetMs != null ? this.ladderRungBudgetMs : (this.plates.phone ? LADDER_RUNG_BUDGET_PHONE_MS : LADDER_RUNG_BUDGET_MS);
            this.store.warmReads = true;              // kept by `framesLeft` through the zoom (F83)
            let snap;
            const slice = this.ladderSliceMs != null ? this.ladderSliceMs : (this.plates.phone ? LADDER_SLICE_PHONE_MS : LADDER_SLICE_MS);
            try { snap = this.stage.snapshot(aim.frame, this.renderer.plateCover(t, aim.win, LADDER_DQ), slice); } finally { this.store.warmReads = false; }
            const n = snap ? snap.items().length : -1;
            this._perf("ladder", tL, false, { frame: aim.frame, k, n, cross: step.cross });
            // A cold rung is baked a slice at a time, one idle hop each (a whole one was 2.4–4.1 s at
            // depth 9); a rung that has not finished in LADDER_RUNG_TRIES hops ends this view's ladder.
            if (!snap) {
                const tries = (this._ladderTries && this._ladderTries.key === key && this._ladderTries.k === k) ? this._ladderTries.n + 1 : 1;
                this._ladderTries = { key, k, n: tries };
                if (tries >= LADDER_RUNG_TRIES) { this._ladderCap = { key, k: k - 1 }; return 0; }
                this._ladderBusy = true;
                ladderIdle(() => this._ladderRung(k, key));
                return 0;
            }
            if (perfNow() - tL > budget) this._ladderCap = { key, k };
            const tP = perfNow();
            posted = this.renderer.ladderPlates(t, aim.win, snap);
            this._perf("ladderPost", tP, false, { k, n, posted });
        }
        if (k + 1 < rungs && !(this._ladderCap && this._ladderCap.key === key)) {
            this._ladderBusy = true;
            ladderIdle(() => this._ladderRung(k + 1, key));
        }
        return posted;
    }
    /**
     * The view zoomed out `factor`× about the screen centre, computed rather than simulated: the
     * centre is the zoom's fixed point, mapped through each crossing `_crossDown` would make, at
     * `_crossDown`'s scale. No `Camera` runs, so nothing can mint a frame — a throwaway one did,
     * shifting sideways into an unvisited cell when the centre sat on a cell edge. Null where the
     * zoom would cross below a root.
     */
    _zoomedOut(factor) {
        const base = this.cfg.base, exit = this.cfg.exit;
        let f = this.lm.frame(this.cam.frame);
        if (!f) return null;
        const W2 = this.width / 2, H2 = this.height / 2;
        let s = this.cam.inScale;
        let p = [(W2 - this.cam.inPanX) / s, (H2 - this.cam.inPanY) / s];
        s /= factor;
        while (s < exit) {
            if (f.parent == null || !f.edge) return null;
            const q = this.lm.mapPointF(p, f.id, f.parent);
            if (!q) return null;
            s = (f.edge.s / base) * s;
            p = q;
            f = this.lm.frame(f.parent);
            if (!f) return null;
        }
        const hw = (W2 / s) * LADDER_MARGIN, hh = (H2 / s) * LADDER_MARGIN;
        return { frame: f.id, inScale: s, win: { left: p[0] - hw, top: p[1] - hh, right: p[0] + hw, bottom: p[1] + hh } };
    }
    _maybePrebake() {
        if (this._prebakeQueued || this.cfg.pyramid) return;   // the prefetch's crossing target instead
        const aim = this._crossTarget();
        if (!aim) return;
        this._prebakeQueued = true;
        const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 30);
        idle(() => {
            this._prebakeQueued = false;
            if (this._destroyed) return;
            // Re-read at idle time: the approach may have ended, or turned into another cell's.
            const t = this._crossTarget();
            if (!t || t.id !== aim.id || !this.lm.frame(t.id)) return;
            const win = this.lm.mapRectF(this.cam.frameWindow(0), this.cam.frame, t.id);
            if (!win) return;
            const tP = perfNow();
            this.store.warmReads = true;
            // The raster path reads the target through the Stage (A2 §2.13); the SVG path warms its tiles through `listFor`.
            let snap = null, n = 0;
            try {
                if (this.raster) { snap = this.stage.snapshot(t.id, this.renderer.plateCover(t, win, PREVIEW_QUANTA), Infinity); n = snap ? snap.items().length : 0; }
                else n = this.listFor(t.id, win).length;
            } finally { this.store.warmReads = false; }
            this._perf("prebake", tP, false, { frame: t.id, dir: t.dir, n });
            // The plates are the renderer's half: the quantum, the range and the post are plate
            // facts, and `{ pin: "none" }` is what keeps them off the visible screen's pins.
            if (snap && this.plates) {
                const tQ = perfNow();
                this.renderer.prebakePlates(t, win, snap);
                this._perf("prebakePost", tQ, false, { n });
            }
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
                // The fit emits no document event: its footprint is the Stage's dirt (§15.3 Q5).
                if (this.plates) this.stage.touch(o.id);
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
        if (this._fr) this.flush();   // a press hit-tests the picture the last move left, in its frame
        // A new press cancels a parked gesture; a mark still unlanded registers before the pick reads it (A2 §4.11, §4.12).
        this._cancelBarrier(); this._pressWait = null;
        if ((this.tool === "select" || this.tool === "erase") && !this.readOnly && this._marksUnlanded()) this.flushBakes();
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
        // `readOnly` (SYNC-PLAN R2): another tab or device has the pen, so every press pans.
        if (this.tool === "pan" || this.readOnly) { this._panLast = [sx, sy]; return; }
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
                color: ERASE_COLOR, opacity: 1,
            };
            this._startPen(o);
            this.store.live = o;
            this.doc.add(o, this.cam.frame, { live: true });
            this.renderer.addLive(o);
            this.renderer.setLiveArcs(o._pen.gaps);
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
        const o = { type: "stroke", origin: "native", id: this.doc.allocId(), pts: [p], lwFrame: lw, color: this.color, opacity: op };
        // Remembered ON THE STROKE, not read off `penType` later: the eraser
        // trail goes through this same move path, and reading the pen there
        // made the eraser draw straight lines after the line tool had been
        // used (Kobin, 2026-09-03).
        if (straight) o._straight = true;
        this._startPen(o);
        this.store.live = o; // exempt from bbox/flatten caches until it stops growing
        this.doc.add(o, this.cam.frame, { live: true });
        this.renderer.addLive(o);
        this.renderer.setLiveArcs(o._pen.gaps);   // a lone tap is still a dot
        this.renderer.update();
        this._drawing = o; this._drawStartT = Date.now();
        this._emit();
    }
    _pointerMove(sx, sy) {
        if ((this.tool === "pan" || this.readOnly) && this._panLast) {
            const dx = sx - this._panLast[0], dy = sy - this._panLast[1];
            this._panLast = [sx, sy]; this.panBy(dx, dy); return;
        }
        if (this.tool === "erase") { if (this._erasing) this.eraseAt(sx, sy); return; }
        // "erasePartial" falls through: the eraser trail is this._drawing.
        if (this.tool === "select") {
            if (this._pressWait) { this._pressWait.last = [sx, sy]; return; }   // a drag parked on its erase barrier: the finger, for its start
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
            if (this._dragSel && this.selection) {
                if (this.cfg.frames === "raf") this._pend().drag = [sx, sy];   // the frame's step reads the last pointer
                else this._dragSelection(sx, sy);
            }
            return;
        }
        if (this._drawing) {
            const p = this.cam.screenToFrame(sx, sy);
            const o = this._drawing;
            // The arc centerline is maintained WHILE DRAWING, and it is what
            // gets painted. A freehand sample only disturbs the spline's handles
            // at its two nearest neighbours, so exactly the last two gaps are
            // rebuilt: O(1) a point, microseconds, and by pen-up the most
            // expensive phase of the bake is already paid for. The line tool
            // REPLACES its second point, which an incremental chain cannot take
            // back, so its pen is re-seeded from both samples — two samples, so
            // also O(1), and a biarc through two points is that straight line.
            if (o._straight && o.pts.length >= 2) {
                o.pts[1] = p;
                o._pen = new BiarcPen({ tol: o._tol });
                o._pen.addSample(o.pts[0]);
                o._pen.addSample(p);
            } else {
                o.pts.push(p);
                o._pen.addSample(p);
            }
            this.renderer.setLiveArcs(o._pen.gaps);
            if (this.cfg.frames === "raf") this._pend().svg = true;   // every sample is in the pen; the SVG waits for the frame
            else this.renderer.update();
        }
    }
    // Attach a live arc chain to a stroke about to be drawn. EVERY stroke gets
    // one, the straight-line tool included — it re-seeds a two-sample pen on
    // each move (`_pointerMove`), so there is a single live path. The tolerance
    // is half an arc-tolerance pixel AT THE ZOOM IT IS DRAWN: the swap from raw
    // ink to the resolved shape is the only moment the difference between the
    // two could be seen, and it is sub-pixel there by construction.
    _startPen(o) {
        o._tol = (this.cfg.arcTolerancePx * 0.5) / this.cam.inScale;
        o._pen = new BiarcPen({ tol: o._tol });
        o._pen.addSample(o.pts[0]);
    }
    _pointerUp() {
        if (this._fr) this.flush();   // a drop, a tap or a pen-up after the last move's step
        if (this._selPress) {
            const P = this._selPress; this._selPress = null;
            if (!P.moved) { this._selectTap(P); return; }
        }
        if (this._pressWait) { this._pressWait.released = true; return; }   // a parked drag applies whole when its barrier ends
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
            const d = this._dragSel;
            // one undo op for the whole drag, in the object's home-frame units
            if (d.moved && this.selection) {
                // A move that walked an object out of its own cell is finished
                // by re-homing it into the cell it now sits in, so invariant 2
                // holds again before anything else looks at the document.
                for (const [id, st] of d.moves) {
                    if (!this._homeShift(id)) continue;
                    // The one case a move touches coordinates: the member is walked back into its cell
                    // by whole frames, so its entry keeps geometry snapshots either side.
                    const rec = this.doc.getById(id);
                    st.base = Document.snapGeometry(rec.obj);
                    const n = this._normalizeHome(id);
                    st.after = Document.snapGeometry(rec.obj);
                    st.to = n.level; st.dx += n.dx; st.dy += n.dy; st.own = n.own;
                }
                // One entry per member: the frames and the tables either side (DESIGN.md §8).
                const moves = [...d.moves].map(([id, v]) => {
                    const m = { id, dx: v.dx, dy: v.dy, from: v.from, to: v.to };
                    if (v.base) { m.base = v.base; m.after = v.after; }
                    m.belowBefore = v.baseBelow; m.belowAfter = cloneBelow(v.own);
                    return m;
                });
                // The frames the drag moved as frames: the same entry objects the drag settled into
                // (a settle since is already recorded on them), one op with the per-object moves.
                const frames = d.frames ? [...d.frames.values()].filter((e) => e.to && (e.to.parent !== e.from.parent
                    || e.to.i !== e.from.i || e.to.j !== e.from.j || !sameShift(e.shiftBefore, e.shiftAfter))) : [];
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
                    frames: frames.length || undefined,
                    frameShadowed: d.frameShadowed && d.frameShadowed.length ? d.frameShadowed.slice(0, 12) : undefined,
                });
                if (frames.length) this.doc.pushUndo({ op: "moveFrames", frames, moves });
                else this.doc.pushUndo(moves.length === 1 ? { op: "move", ...moves[0] } : { op: "moveMany", moves });
            }
            // The one exit, after the op is on the stack so the merge its render triggers is
            // recorded on it (B §5); its render also refreshes `_lastList` after a re-home.
            this._endMove("drop");
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
    // A drag in progress is cancelled first: its start snapshots describe the document the undo
    // is about to change (B §1.2, defect 1).
    // An undo or a redo is one Stage commit (A2 §2.5): per event, a 5,000-object one cost 0.5–0.9 s in node.
    undo() { if (this.readOnly) return false; this._cancelBarrier(); if (this._dragSel) this.cancelSelectGesture(false); if (!this._keepingSelection(() => this.stage.batch(() => this.doc.undo()))) return false; this._scheduleBake(); this._render(); collectFrames(this); return true; }   // the GC: a plate drop's mapping can mint a frame
    redo() { if (this.readOnly) return false; this._cancelBarrier(); if (this._dragSel) this.cancelSelectGesture(false); if (!this._keepingSelection(() => this.stage.batch(() => this.doc.redo()))) return false; this._scheduleBake(); this._render(); collectFrames(this); return true; }   // the GC: a plate drop's mapping can mint a frame
    /** Frame GC over every frame: the saver calls it once a restored store is in (F94). */
    sweepFrames() { return this.readOnly ? 0 : sweepFrames(this); }
    clear() {
        if (this.readOnly) return;
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
        const zoom = this.cam.effectiveZoom();
        this.onStatus({
            level: this.cam.activeLevel, inScale: this.cam.inScale, effectiveZoom: zoom,
            nearCross: this.cam.inScale > this.cfg.enter * 0.8, objects: this._lastList.length,
            lines: false, // per-origin curvature now; no global "line mode" level
            selection: this._selectionStatus(),
            canUndo: this.doc.canUndo(), canRedo: this.doc.canRedo(),
            erase: this._eraseStatus(),     // pending marks, and a gesture finishing its erase (the editor's chip)
        });
        if (this._zoomSubs && zoom !== this._zoomSeen) { this._zoomSeen = zoom; for (const cb of this._zoomSubs) cb(zoom); }
    }
    /**
     * `cb(effectiveZoom)` at every status emit that finds the zoom changed — once a frame in "raf" — so the
     * scale HUD follows every zoom without re-rendering the page (A3 §5, R25 W1). Returns the unsubscribe.
     */
    onZoom(cb) {
        (this._zoomSubs || (this._zoomSubs = new Set())).add(cb);
        return () => { this._zoomSubs.delete(cb); };
    }
    _effectiveZoom() { return this.cam.effectiveZoom(); }
    _levelPointToScreen(level, x, y) { return this.cam.levelPointToScreen(level, x, y); }
    _objs() { return this._lastList; }
    // The fat-display invariant the ported BUG-02/05 tests assert.
    _fatOnScreen(o) { return this.renderer._fatOnScreen(o); }
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
