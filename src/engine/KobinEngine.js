/**
 * KobinEngine — the public facade. Wires LevelMap + Document + Camera +
 * TileStore + Renderer into the same external API the old KobinEngineV0
 * exposed, so CanvasV2 and the test suite keep working. It holds NO geometry or
 * z-order logic of its own — it routes input to the right collaborator and
 * merges the render list (tile pieces + the active level's live natives) in
 * global id order.
 *
 * Compat surface (locked by KobinEngine.contract.test.js): pointer/zoom/pinch/
 * pan, tool + style setters, undo/redo/clear, snapshot/loadSnapshot, resize,
 * destroy, onStatus, perfLog — plus the quasi-privates CanvasV2 and the tests
 * read: nativesByLevel, crossings, levelObjects, tiles, _drawing, _drawStartT,
 * cancelStroke, _hasFat, _effectiveZoom, opacityGroups, outlineMode, camera
 * fields, _fatOnScreen/_outlinePad (the ported BUG-02/05 invariants).
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT, R as CROSS_RATIO, W as FRAME_W,
    childTilePhase, objTileRange, objTileRect } from "./frameLattice";
import Document from "./Document";
import Camera from "./Camera";
import TileStore from "./TileStore";
import Renderer from "./Renderer";
import {
    strokeOutline, clipRingsToRect, clipPolylineToRect, flattenCurve,
} from "./geometry/clipperOutline";
import { distToPolyline, windingOfPoint } from "./geometry/hittest";
import { bboxOf, shapeRingsInRect } from "./geometry/derive";
import { strokeLoops, flattenLoops } from "./geometry/curveOutline";
import { BiarcPen } from "./geometry/biarc";
import { ArcBakeJob, bakeArcPerimeter } from "./geometry/arcPerimeter";
import {
    insideShape, subtractShape, clipShapeToRect, shapeComponents,
    loopsBBox, loopsArea, meanWidth, transformLoops, flattenShape, dropDust, repairLoops,
} from "./geometry/arcShape";
import { rectInsidePolygon } from "./geometry/lasso";
import { asRect, contactArcs, arcsTouch, arcOverlaps, tOfPoint, Groups } from "./geometry/connect";
import { encodeDrawing, decodeDrawing } from "./persist";
import { validateScaleDef } from "./scaleBar";
import {    computeSceneProposals, matchScenes, splitMembers, resolveCapture, levelHash,
    JOIN_WINDOWS, WINDOW_WIDTHS,
} from "./scenes";

// How far an object homed in a frame can be from that frame's origin: its own
// cell, plus one neighbour. Invariant 2, which D9 and `_normalizeHome` enforce.
const REACH = (3 * FRAME_W) / 2;

// Eraser strokes paint in the canvas background color — visually "erased"
// the instant they're drawn, before any geometry work happens.
const ERASE_COLOR = "#ffffff";
// ---- long animation frames --------------------------------------------------
// WHERE THE TIME ACTUALLY GOES, straight from the browser.
//
// The frame meter says a frame took 1.5 s; every timer in this engine says the
// work took 11 ms. That gap has cost four wrong diagnoses (paint via path
// extent, the bake guard, autosave, the move path), because a number that only
// says "something was slow" invites a guess about what.
//
// `long-animation-frame` closes it. Chrome hands back, per slow frame: how long
// was spent before rendering began (script and tasks), when style-and-layout
// started, and a per-script breakdown with function names — including how much
// of each script was FORCED style-and-layout, which is the classic invisible
// cost. Whatever is left over after script and style-and-layout is paint and
// compositing, and that subtraction is the whole point: it is the one thing no
// JavaScript timer can ever see directly.
//
// Kobin's symptom is the one this suits best: "random moments where I zoom and
// it won't render."
const LOAF_KEPT = 25;

class LongFrames {
    constructor() {
        this.worst = [];
        this.count = 0;
        this.totalMs = 0;
        this.supported = false;
        this._obs = null;
    }
    start() {
        if (typeof PerformanceObserver !== "function") return;
        const types = PerformanceObserver.supportedEntryTypes || [];
        if (types.indexOf("long-animation-frame") < 0) return;
        try {
            this._obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) this._take(e);
            });
            this._obs.observe({ type: "long-animation-frame", buffered: true });
            this.supported = true;
        } catch (err) { this._obs = null; }
    }
    _take(e) {
        this.count++;
        this.totalMs += e.duration || 0;
        const end = e.startTime + e.duration;
        // The LoAF timeline: startTime -> renderStart -> styleAndLayoutStart -> end.
        const preRender = e.renderStart ? e.renderStart - e.startTime : e.duration;
        const render = e.renderStart ? end - e.renderStart : 0;
        const styleLayout = e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0;
        const scripts = (e.scripts || []).map((sc) => ({
            ms: +(sc.duration || 0).toFixed(1),
            forcedMs: +(sc.forcedStyleAndLayoutDuration || 0).toFixed(1),
            fn: String(sc.sourceFunctionName || "").slice(0, 60),
            src: String(sc.sourceURL || "").split("/").pop().slice(0, 48),
            invoker: String(sc.invoker || "").slice(0, 60),
        })).sort((a, b) => b.ms - a.ms).slice(0, 4);
        const scriptMs = scripts.reduce((n, x) => n + x.ms, 0);
        const rec = {
            // wall clock, so a long frame lines up against `perf` and `journal`
            t: Math.round((performance.timeOrigin || 0) + e.startTime),
            ms: +(e.duration || 0).toFixed(1),
            blockingMs: +(e.blockingDuration || 0).toFixed(1),
            preRenderMs: +preRender.toFixed(1),
            renderMs: +render.toFixed(1),
            styleLayoutMs: +styleLayout.toFixed(1),
            // rendering that is NOT style-and-layout: paint, raster, compositing
            paintMs: +Math.max(0, render - styleLayout).toFixed(1),
            scriptMs: +scriptMs.toFixed(1),
            scripts,
        };
        this.worst.push(rec);
        this.worst.sort((a, b) => b.ms - a.ms);
        if (this.worst.length > LOAF_KEPT) this.worst.length = LOAF_KEPT;
    }
    report() {
        return { supported: this.supported, count: this.count,
            totalMs: +this.totalMs.toFixed(0), worst: this.worst.slice(0, LOAF_KEPT) };
    }
    stop() { try { if (this._obs) this._obs.disconnect(); } catch (err) { /* ignore */ } this._obs = null; }
}

// ---- input to pixels --------------------------------------------------------
// THE LAST BLIND SPOT. Four reports running, every stall looks the same: a frame
// of 0.6-1.5 s in which script is 0 ms, render is 0.3 ms, paint is 0.3 ms and
// the engine's own trace log holds no operation at all. The main thread is IDLE
// while the page is frozen. So the delay is not in PRODUCING a frame, it is in
// getting one PRESENTED — and presentation happens on the compositor, where no
// JavaScript timer can follow it.
//
// Event Timing is the one API that spans the whole journey. Per input it gives
// three phases, and the third is the one nothing else can see:
//   waitMs    startTime -> processingStart   (queued, main thread busy)
//   handleMs  processingStart -> processingEnd  (our JavaScript)
//   presentMs processingEnd -> startTime+duration  (rendered and put on screen)
// A wheel event with handleMs 5 and presentMs 1100 says the engine is innocent
// and the compositor is the answer. Kobin's words for it: "I zoom and it won't
// render."
const EVENT_MIN_MS = 100;   // only events worth explaining
const EVENT_KEPT = 25;

class EventLatency {
    constructor() { this.worst = []; this.count = 0; this.supported = false; this._obs = null; }
    start() {
        if (typeof PerformanceObserver !== "function") return;
        if ((PerformanceObserver.supportedEntryTypes || []).indexOf("event") < 0) return;
        try {
            this._obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) this._take(e);
            });
            this._obs.observe({ type: "event", buffered: true, durationThreshold: EVENT_MIN_MS });
            this.supported = true;
        } catch (err) { this._obs = null; }
    }
    _take(e) {
        this.count++;
        const wait = Math.max(0, (e.processingStart || e.startTime) - e.startTime);
        const handle = Math.max(0, (e.processingEnd || 0) - (e.processingStart || 0));
        const present = Math.max(0, (e.startTime + e.duration) - (e.processingEnd || e.startTime));
        this.worst.push({
            t: Math.round((performance.timeOrigin || 0) + e.startTime),
            name: String(e.name || "").slice(0, 24),
            ms: +(e.duration || 0).toFixed(1),
            waitMs: +wait.toFixed(1),
            handleMs: +handle.toFixed(1),
            presentMs: +present.toFixed(1),
        });
        this.worst.sort((a, b) => b.ms - a.ms);
        if (this.worst.length > EVENT_KEPT) this.worst.length = EVENT_KEPT;
    }
    report() { return { supported: this.supported, count: this.count, worst: this.worst.slice() }; }
    stop() { try { if (this._obs) this._obs.disconnect(); } catch (err) { /* ignore */ } this._obs = null; }
}

// ---- what accumulates over a session ----------------------------------------
// Reported 2026-08-22, and the decisive clue in the whole investigation: the
// slowness is reproducible from a given sequence of steps, but A PAGE REFRESH
// CURES IT. Same drawing, same objects, same steps afterwards — fine. So it is
// not the document, and it is not the machine; it is something the session
// accumulates.
//
// That also explains the shape of the stall. A long animation frame with NO
// script, NO render and NO paint attributed to it is what a major garbage
// collection looks like from the inside — GC belongs to no script, so nothing
// can name it. Heap pressure grows, collections get longer, and the page halts
// for a second at a time with every timer in the engine reporting that it did
// nothing.
//
// A snapshot cannot show accumulation, so this is a SERIES: heap and the size
// of every cache that could grow, sampled while the user is active. If one of
// these climbs and never comes down, that is the leak.
const GROWTH_EVERY_MS = 2000;
const GROWTH_KEPT = 150;

class GrowthLog {
    constructor(engine) { this.e = engine; this.samples = []; this._last = 0; }
    /** Cheap enough to call from the frame meter's poke path. */
    maybeSample() {
        const now = perfNow();
        if (now - this._last < GROWTH_EVERY_MS) return;
        this._last = now;
        const E = this.e;
        let heapMB = null;
        try {
            if (typeof performance !== "undefined" && performance.memory) {
                heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
            }
        } catch (err) { /* not everywhere */ }
        let svgNodes = null;
        try { if (typeof document !== "undefined") svgNodes = document.querySelectorAll("svg *").length; }
        catch (err) { /* ignore */ }
        const s = {
            t: Date.now(),
            heapMB,
            svgNodes,
            frames: E.lm && E.lm.frames ? E.lm.frames.size : null,
            buckets: E.doc ? E.doc.levels().length : null,
            objects: E.doc ? E.doc.levels().reduce((n, k) => n + E.doc.at(k).length, 0) : null,
            undo: E.doc && E.doc._undo ? E.doc._undo.length : null,
            redo: E.doc && E.doc._redo ? E.doc._redo.length : null,
            tiles: E.store && E.store.cache && E.store.cache.size != null ? E.store.cache.size : null,
            groups: E.renderer && E.renderer._groups ? E.renderer._groups.size : null,
            bakeJobs: E._bakeJobs ? E._bakeJobs.length : null,
        };
        this.samples.push(s);
        if (this.samples.length > GROWTH_KEPT) this.samples.shift();
    }
    report() {
        if (!this.samples.length) return { samples: [] };
        const first = this.samples[0], last = this.samples[this.samples.length - 1];
        const delta = {};
        for (const k of Object.keys(first)) {
            if (k === "t" || first[k] == null || last[k] == null) continue;
            delta[k] = last[k] - first[k];
        }
        return { spanS: Math.round((last.t - first.t) / 1000), first, last, delta,
            samples: this.samples.slice() };
    }
}

// How long one erase-bake slice may run before yielding to the browser. Same
// budget as a perimeter bake slice — see `_bakeTick`.
// ---- the frame meter --------------------------------------------------------
// THE ONLY INSTRUMENT HERE THAT SEES PAINT. Every other timer in this file wraps
// JavaScript and stops the moment the engine hands the DOM back to the browser;
// layout, rasterization and compositing all happen after that, and on a deep
// zoom they are the expensive part.
//
// Why it exists: two stalls reported 2026-08-21, one from a phone and one from a
// desktop, both felt like seconds of lag. The desktop report covered 62.3 s of
// session and accounted for 157 ms of work - 0.25%. Crossings were 2.4-4.1 ms,
// renders never passed 19.6 ms, and not one zoom step reached the 8 ms floor
// that `_perf` logs above. Every measured thing was fast, so the diagnosis had
// to be made by reasoning about what was ABSENT. This closes that hole.
//
// The gap between animation frames is the number a user actually feels, and it
// includes everything JS cannot time. Sampling runs only around interaction: a
// rAF loop that never stops would keep a phone's display pipeline awake for
// nothing, which is its own performance bug.
const FRAME_BUCKETS = [17, 33, 50, 100, 250, 500, 1000];
const FRAME_METER_IDLE_MS = 2000;
const FRAME_WORST_KEPT = 20;

class FrameMeter {
    constructor() {
        this.buckets = new Array(FRAME_BUCKETS.length + 1).fill(0);
        this.worst = [];
        this.frames = 0;
        this.totalMs = 0;
        this.hidden = 0;      // samples dropped because the tab was not visible
        this._last = 0;
        this._raf = null;
        this._until = 0;
    }
    /** An interaction happened: sample for the next couple of seconds. */
    poke() {
        if (this.onPoke) this.onPoke();
        this._until = perfNow() + FRAME_METER_IDLE_MS;
        if (this._raf == null) this._start();
    }
    _start() {
        if (typeof requestAnimationFrame !== "function") return;
        this._last = 0;
        const tick = (ts) => {
            const now = typeof ts === "number" ? ts : perfNow();
            if (this._last) this.record(now - this._last);
            this._last = now;
            if (now >= this._until) { this._raf = null; this._last = 0; return; }
            this._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
    }
    record(ms) {
        if (!(ms >= 0) || !isFinite(ms)) return;
        // rAF PAUSES WHEN THE TAB IS NOT VISIBLE, and the next callback then
        // reports the whole absence as one enormous frame. Nothing was slow; the
        // browser simply was not animating. Left uncounted, that manufactures
        // exactly the headline number a reader will chase — isolated 1-2 second
        // frames, landing near the moment someone switches away to click
        // something. Counting them cost most of a day on 2026-08-21.
        if (typeof document !== "undefined" && document.hidden) { this.hidden++; return; }
        this.frames++; this.totalMs += ms;
        let i = 0;
        while (i < FRAME_BUCKETS.length && ms > FRAME_BUCKETS[i]) i++;
        this.buckets[i]++;
        // Keep the worst few WITH a wall-clock stamp, so a bad frame can be lined
        // up against the perf log and the journal.
        if (ms > FRAME_BUCKETS[1]) {
            this.worst.push({ ms: +ms.toFixed(1), t: Date.now() });
            this.worst.sort((a, b) => b.ms - a.ms);
            if (this.worst.length > FRAME_WORST_KEPT) this.worst.length = FRAME_WORST_KEPT;
        }
    }
    report() {
        const hist = {};
        for (let i = 0; i < this.buckets.length; i++) {
            if (!this.buckets[i]) continue;
            const label = i === FRAME_BUCKETS.length
                ? ">" + FRAME_BUCKETS[FRAME_BUCKETS.length - 1]
                : "<=" + FRAME_BUCKETS[i];
            hist[label] = this.buckets[i];
        }
        return {
            frames: this.frames,
            hiddenSkipped: this.hidden,
            sampledMs: +this.totalMs.toFixed(0),
            meanMs: this.frames ? +(this.totalMs / this.frames).toFixed(1) : 0,
            hist,
            worst: this.worst.slice(0, FRAME_WORST_KEPT),
        };
    }
    stop() {
        if (this._raf != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._raf);
        this._raf = null;
    }
}

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

// Clipper rounds every coordinate onto an integer lattice whose step is chosen
// from the largest magnitude in play (subtractPolys's capScale), so "this vertex
// sits ON the window's edge" has to be judged at that step and not at float
// epsilon: at the parent's own scale one lattice step is ~1e-3 units, which is
// three whole units — hundreds of screen pixels — down among its children.
function latticeStep(rect) {
    const R = asRect(rect);
    const m = Math.max(Math.abs(R.x0), Math.abs(R.y0), Math.abs(R.x1), Math.abs(R.y1), 1);
    return Math.max(1 / 1000, m / 4.0e7);
}
const rectTol = (r) => 2 * latticeStep(r);

// ---- selection indicator ----------------------------------------------------
// EVERY object is traced, however small — there is no marker mode. Two limits
// keep that honest once marks get down to the size of a pixel:
//
// At or below this span a mark occupies a single pixel, and its outline has no
// shape left to follow. It is still traced, but at the floor size below, and
// only ONE trace is emitted per pixel: a hundred specks sitting on top of each
// other are one thing to look at, not a hundred stacked outlines.
const SEL_ONE_PIXEL_PX = 1.5;
// What such a trace is floored to, so that something too small to see still
// shows where it is.
//
// THE ANTS OUTLIVE THE INK (Kobin, 2026-08-25). Below `cullPx` the renderer
// stops painting an object, but the selection indicator stays: zoomed far
// enough out you see no drawing and a speck of ants marking where the selected
// thing is. That is deliberate — it is the whole of "extends down to objects
// that are truly too small to see". Do not tie this to the render list.
//
// The speck is TINY, and it is a SOLID DOT rather than a dashed ring. That is
// not a simplification, it is what the design file actually renders, and it
// took reading its construction to see why.
//
// The file draws ants by stroking the mark's own path FAT and masking the ink
// out of it: `stroke-width = m.w + 2.5k` against a mask eroded to
// `m.w - 2.5k`, leaving a 5k px band centred on the silhouette. For a
// sub-pixel dot `m.w` is ZERO, so the erode clamps to nothing and no ink is
// cut away — and the dot's circumference (~1.6 px) is shorter than a single
// dash, so the dash pattern never gets to open a gap. What lands on screen is
// a solid dot about 2.25 px across.
//
// Three earlier attempts got this wrong by reasoning instead of reading: 3 px
// with the full band (merged into a blob), 10 px so the dashes could read (a
// fat square standing in for a half-pixel mark), then a dashed octagon (mush
// at 2 px).
const SEL_MIN_TRACE_PX = 0.5;
// A ceiling on the total screen length of ants, in pixels. The rings are already
// clipped to the view and culled to its margin, so this is a backstop rather
// than a working limit — but it is the invariant that keeps the 2026-08-22
// stall (350,958 dashes on one 877,395 px rectangle) from ever returning in a
// new shape. At a 9 px dash cycle this caps the rasterizer at ~2,700 dashes.
const SEL_ANT_BUDGET_PX = 24000;
// A border segment gets a chevron only once it covers this much of its side.
// Short segments — a few fingers of ink touching the top of the frame — read
// perfectly well as ants continuing the outline, and an arrow on each would be
// clutter saying nothing.
const SEL_CHEVRON_FRACTION = 1 / 5;
/** Merge overlapping or nearly touching [a,b] spans into the fewest runs. */
function mergeSpans(list, gap) {
    if (!list.length) return [];
    const sorted = list.slice().sort((x, y) => x[0] - y[0]);
    const out = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i++) {
        const cur = out[out.length - 1], nxt = sorted[i];
        if (nxt[0] <= cur[1] + gap) cur[1] = Math.max(cur[1], nxt[1]);
        else out.push(nxt.slice());
    }
    return out;
}

const rectSpan = (r) => { const R = asRect(r); return Math.max(R.x1 - R.x0, R.y1 - R.y0, 1e-12); };

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
    setKDebug(b) { this.kdebug = !!b; }
    setTileDebug(b) { this.tileDebug = !!b; this.renderer.setTileDebug(this.tileDebug, () => this._debugTileRects()); this.renderer.update(); }
    /**
     * ERASE DEBUG — see what an erase actually did to an object's structure.
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

    /**
     * Keep a consumed eraser mark so the debug view can still show it. A mark
     * is deleted the moment it has nothing left to cut, which is exactly when
     * you want to look at where it was.
     */
    _keepDebugMark(E) {
        if (!this.eraseDebug || !E || E.type !== "shape" || !E.loops) return;
        this._debugMarks = this._debugMarks || [];
        this._debugMarks.push({ level: E._home || this.cam.frame, loops: E.loops, id: E.id });
        if (this._debugMarks.length > 24) this._debugMarks.shift();
    }
    /**
     * The erase-debug overlay, in SCREEN coordinates, rebuilt per render.
     *
     * ONE walk of each real boundary, and every stretch of it comes out in
     * exactly one colour:
     *   ORANGE  the piece's own free boundary — where its ink actually ends.
     *   GREEN   the stretch it shares with a parent or child across their tile
     *           edge. This is the whole of severance: green means "these two
     *           are one object", and a cut that reached the tile edge shows as
     *           green shrinking away to nothing.
     *   YELLOW  eraser marks, including ones already consumed, so a gesture
     *           that appeared to do nothing can be seen where it landed.
     *
     * Green is not drawn OVER orange, which it used to be — a green line laid
     * on top of an orange one is two paths where the picture has one edge, and
     * where they disagreed by a fraction of a pixel you got a two-colour fringe
     * that read as a gap. The classification happens on the outline itself:
     * every little stretch asks `tOfPoint` where it sits on the shared rect and
     * looks that up in the contact intervals, which is the very question
     * `_familyComponents` severs on, so the picture cannot drift from the
     * decision.
     */
    _eraseDebugOverlay() {
        const out = { outlines: [], contacts: [], marks: [] };
        const F = this.cam.frame;
        const W = this.width, H = this.height;
        // A boundary is only worth drawing where it can be seen. CLIP_PX is the
        // margin the geometry is clipped to and CULL_PX the margin a segment
        // must reach to be kept: clipping closes a ring along the window edge,
        // and keeping the two apart is what puts those fabricated edges outside
        // the kept region instead of drawing a box around the screen.
        const CLIP_PX = 160, CULL_PX = 64;
        const onScreen = (p) => p[0] > -CULL_PX && p[0] < W + CULL_PX && p[1] > -CULL_PX && p[1] < H + CULL_PX;
        const win = this.cam.frameWindow(CLIP_PX / Math.max(this.cam.inScale, 1e-30));

        // WHERE PIECES ARE JOINED, as intervals on the tile edge they share.
        //
        // Recorded against BOTH pieces, each in its own level's coordinates,
        // because both of them have to draw their share of that stretch green:
        // the parent stops at the rect and the child fills it, so the join is
        // one edge that two different objects, at two different levels, each
        // own a copy of.
        // Cached per family across renders, because a join is a fact about the
        // DOCUMENT and not about where the camera is: finding one means
        // flattening whole pieces at the rect's own lattice step, which is fine
        // fidelity on a big object, and paying that on every pan turned the
        // debug view into a slideshow. Keyed by the members and their edit
        // counters, so any change to the family recomputes it.
        if (!this._dbgCache) this._dbgCache = { joins: new Map(), rings: new Map() };
        const C = this._dbgCache;
        if (C.joins.size > 400) C.joins.clear();
        if (C.rings.size > 800) C.rings.clear();
        // The families in view are collected from EVERY piece on screen, a
        // temporary tile included — a tile carries the id of the native it was
        // derived from, so zoomed out (which is when tile edges, and hence
        // contacts, are visible at all) the family is still found.
        const keys = new Set();
        for (const o of this._objs()) {
            if (o.erase) continue;
            const rec = this.doc.getById(o.id);
            const src = rec ? rec.obj : o;
            if (src.editId != null) keys.add(this.doc.editKey(src));
        }
        // Every family's members in ONE pass, not one document scan per family:
        // a drawing with 254 families was walked 254 times, per render.
        const byKey = new Map();
        for (const L of this.doc.levels()) {
            for (const o of this.doc.at(L)) {
                if (o.erase || o.editId == null) continue;
                const k = this.doc.editKey(o);
                if (!keys.has(k)) continue;
                let a = byKey.get(k);
                if (!a) { a = []; byKey.set(k, a); }
                a.push({ obj: o, level: L });
            }
        }
        // WHERE THE SEAMS ARE, shared with the selection indicator so that both
        // views answer "is this stretch a real edge or a tile join?" from one
        // implementation. Ants must never run along a join.
        const joins = this._familyJoinNotes(keys, byKey, C);

        // OUTLINES come from the stored document, not from the render list.
        //
        // A shape shown at another level arrives as tile pieces, each clipped to
        // its tile, so outlining what is DRAWN traces the tile grid and stops
        // dead at every seam. The real boundary is the one the object actually
        // has: take it from the native, in the native's own frame, and map the
        // points to screen. It then runs continuously across every tile edge,
        // which is the whole point of drawing it.
        for (const L of this.doc.levels()) {
            const f = this.lm.frameFactor(L, F);
            if (f == null) continue;
            const pxPerUnit = this.cam.inScale * f;
            if (!(pxPerUnit > 0)) continue;
            const tol = (this.cfg.arcTolerancePx * 0.5) / pxPerUnit;
            // The view in THIS level's units. A coarse object seen from three
            // levels down is 2.7e10 times the window, and flattening the whole
            // of it at a tolerance set by the magnified view means tens of
            // millions of points for the few hundred that are on screen — which
            // is what blew the call stack inside Two.js's path constructor. It
            // is clipped first, so the cost tracks what is visible.
            const vr = this.lm.mapRectF(win, F, L);
            if (!vr) continue;
            for (const o of this.doc.at(L)) {
                // Only ink that HAS a boundary: a stroke has not resolved yet,
                // and an eraser mark is drawn as a mark, not as a shape.
                if (o.erase || (o.type !== "shape" && o.type !== "fill")) continue;
                const b = bboxOf(o, this.store.live);
                if (b.x1 < vr.left || b.x0 > vr.right || b.y1 < vr.top || b.y0 > vr.bottom) continue;
                const entries = joins.get(o.id) || [];
                // An object WHOLLY inside the clip window is not clipped at all,
                // so its rings depend on nothing but the object and the
                // tolerance — cache those. Anything crossing the window edge is
                // rebuilt, because a pan changes what comes back.
                const whole = b.x0 >= vr.left && b.x1 <= vr.right && b.y0 >= vr.top && b.y1 <= vr.bottom;
                const rk = whole ? o.id + "|" + (o._ver || 0) + "|" + tol : null;
                let rings = rk ? C.rings.get(rk) : null;
                if (!rings) {
                    rings = this._outlineInView(o, vr, tol);
                    if (rk) C.rings.set(rk, rings);
                }
                for (const ring of rings) this._emitOutlineRing(out, o.id, L, ring, entries, onScreen);
            }
        }
        // Marks: still pending, plus the ones already consumed.
        const pending = [];
        for (const L of this.doc.levels()) for (const o of this.doc.at(L)) if (o.erase && o.type === "shape") pending.push({ level: L, loops: o.loops, id: o.id });
        for (const m of pending.concat(this._debugMarks || [])) {
            const f = this.lm.frameFactor(m.level, F);
            if (f == null) continue;
            const pxPerUnit = this.cam.inScale * f;
            if (!(pxPerUnit > 0)) continue;
            const vr = this.lm.mapRectF(win, F, m.level);
            if (!vr) continue;
            const { rings } = shapeRingsInRect(m.loops, vr, (this.cfg.arcTolerancePx * 0.5) / pxPerUnit);
            for (const ring of rings) {
                const pts = [];
                for (const p of ring) {
                    const q = this.cam.levelPointToScreen(m.level, p[0], p[1]);
                    if (q) pts.push(q);
                }
                if (pts.length > 2) out.marks.push({ id: m.id, pts });
            }
        }
        return out;
    }
    /** An object's boundary as polygon rings, clipped to the view rect `vr`. */
    _outlineInView(o, vr, tol) {
        const rect = { left: vr.left, top: vr.top, right: vr.right, bottom: vr.bottom };
        if (o.type === "shape") {
            // `covered` means the ink floods the window: there is no boundary in
            // view, and drawing the window's own edge would invent one.
            const { rings, covered } = shapeRingsInRect(o.loops, rect, tol);
            return covered ? [] : rings;
        }
        if (o.type === "fill") return clipRingsToRect(o.polys, rect);
        return [];
    }
    /**
     * One segment of a boundary, cut where a join starts and ends.
     *
     * Returns the pieces it falls into, in order, each flagged joined or not —
     * or null if the segment is nowhere near a shared edge, which is almost all
     * of them and costs one `tOfPoint` to find out.
     *
     * Cutting matters because a straight stretch flattens to ONE chord: a whole
     * side of a tile arrives as a single segment from corner to corner, and a
     * contact covering a third of it would otherwise have to colour the whole
     * side green or the whole side orange. Both are lies, and the second one
     * hides exactly the case worth seeing — a join that has nearly been cut
     * through.
     */
    _splitOnJoins(entries, a, b) {
        const hits = [];
        for (const e of entries) {
            const ta = tOfPoint(e.rect, a[0], a[1], e.tol);
            if (!ta.length) continue;
            const tb = tOfPoint(e.rect, b[0], b[1], e.tol);
            if (!tb.length) continue;
            // The pair on the SAME side: a corner reports two parameters, and
            // pairing across sides would run the segment the long way round.
            let best = null;
            for (const x of ta) for (const y of tb) {
                const d = Math.abs(x - y);
                if (d <= 1 + 1e-9 && (!best || d < best.d)) best = { x, y, d };
            }
            if (best) hits.push({ e, x: best.x, y: best.y });
        }
        if (!hits.length) return null;
        const inAny = (s) => {
            for (const h of hits) {
                const t = h.x + (h.y - h.x) * s;
                for (const r of h.e.ranges) if (t >= r[0] - h.e.slack && t <= r[1] + h.e.slack) return true;
            }
            return false;
        };
        const cuts = [];
        for (const h of hits) {
            if (Math.abs(h.y - h.x) < 1e-15) continue;
            for (const r of h.e.ranges) for (const t of r) {
                const s = (t - h.x) / (h.y - h.x);
                if (s > 1e-9 && s < 1 - 1e-9) cuts.push(s);
            }
        }
        cuts.sort((p, q) => p - q);
        const at = (s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
        const parts = [];
        let prev = 0;
        for (const s of cuts.concat([1])) {
            if (s - prev < 1e-12) continue;
            parts.push({ p0: prev === 0 ? a : at(prev), p1: s === 1 ? b : at(s), joined: inAny((prev + s) / 2) });
            prev = s;
        }
        return parts.length ? parts : null;
    }
    /**
     * One ring, split into runs of the SAME colour and pushed as screen-space
     * polylines — orange where the piece's boundary is its own, green where it
     * is shared with the piece across the tile edge. Each stretch lands in
     * exactly one list, so nothing is drawn twice and neither colour hides the
     * other.
     */
    /**
     * Where a family's members are JOINED, as intervals on the tile edge they
     * share, keyed by object id.
     *
     * Recorded against BOTH pieces, each in its own level's coordinates,
     * because both of them own a copy of that stretch: the parent stops at the
     * rect and the child fills it.
     *
     * Cached per family across renders, because a join is a fact about the
     * DOCUMENT and not about where the camera is: finding one means flattening
     * whole pieces at the rect's own lattice step, and paying that on every pan
     * turned the debug view into a slideshow. Keyed by the members and their
     * edit counters, so any change to the family recomputes it.
     *
     * Shared by the erase-debug overlay (which paints joins GREEN) and the
     * selection indicator (which refuses to run ants along them). One
     * implementation, so the two can never disagree about where an object
     * really ends.
     */
    _familyJoinNotes(keys, byKey, C) {
        const joins = new Map();
        let notes = null;
        const note = (id, rect, tol, slack, ranges) => {
            if (!ranges.length) return;
            notes.push({ id, rect: asRect(rect), tol, slack, ranges });
        };
        const publish = (list) => {
            for (const n of list) {
                let e = joins.get(n.id);
                if (!e) { e = []; joins.set(n.id, e); }
                e.push(n);
            }
        };
        // Normalized to [0, 4): `arcOverlaps` reports a stretch that straddles
        // t = 0 shifted by ±4, and a lookup would never match it there.
        const norm = (rs) => {
            const o = [];
            for (const [a, b] of rs) {
                const lo = ((a % 4) + 4) % 4, hi = lo + (b - a);
                if (hi <= 4) o.push([lo, hi]); else { o.push([lo, 4]); o.push([0, hi - 4]); }
            }
            return o;
        };
        // One flatten per (object, tolerance): every kid asks its parent for the
        // same outline, and a parent with several ceded tiles was re-flattened
        // once per pair — 510 flattens for eleven pieces, 100 ms of a 160 ms
        // overlay.
        const flat = new Map();
        const ink = (o, tol) => {
            const k = o.id + "|" + tol;
            let v = flat.get(k);
            if (!v) { v = this._inkOutline(o, tol) || []; flat.set(k, v); }
            return v;
        };
        for (const key of keys) {
            const members = byKey.get(key) || [];
            const sig = members.map((m) => m.obj.id + ":" + (m.obj._ver || 0)).join(",");
            const hit = C.joins.get(key);
            if (hit && hit.sig === sig) { publish(hit.notes); continue; }
            notes = [];
            for (const kid of members) {
                const R = kid.obj.attachRect;
                if (!R) continue;
                const P = this.lm.parentOf(kid.level);
                if (P == null) continue;
                const Rp = this.lm.mapRectF({ left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 }, kid.level, P);
                if (!Rp) continue;
                const kidArcs = contactArcs(ink(kid.obj, rectTol(R)), R, rectTol(R));
                if (!kidArcs.length) continue;
                const at = Math.max(rectTol(R) / rectSpan(R), rectTol(Rp) / rectSpan(Rp));
                for (const up of members) {
                    if (up === kid || up.level !== P) continue;
                    if (up.obj.type !== "shape" && up.obj.type !== "fill") continue;
                    const upArcs = contactArcs(ink(up.obj, rectTol(Rp)), Rp, rectTol(Rp));
                    const ov = norm(arcOverlaps(kidArcs, upArcs, at));
                    note(kid.obj.id, R, rectTol(R), at, ov);
                    note(up.obj.id, Rp, rectTol(Rp), at, ov);
                }
            }
            C.joins.set(key, { sig, notes });
            publish(notes);
        }
        return joins;
    }

    /**
     * THE SELECTION INDICATOR, in screen coordinates.
     *
     * Returns `{ rings, dots, covered }` where `rings` are polylines of the
     * selection's TRUE ink boundary for the ants to run along, `dots` are marks
     * too small to trace, and `covered` says the ink floods the view.
     *
     * WHY IT IS NOT A BOUNDING BOX. The box this replaces was computed in the
     * active frame's coordinates, so an object a few levels away projected to
     * 877,395 px and its dashed perimeter cost 315 ms per frame while reporting
     * 0.15 ms of JavaScript (dashing is rasterizer work, so no profiler could
     * name it). Everything here is bounded before it is drawn: clipped to the
     * view, culled to its margin, decimated below half a pixel, and finally
     * capped by SEL_ANT_BUDGET_PX.
     *
     * WHY IT COMES FROM THE DOCUMENT, NOT THE RENDER LIST. A shape shown at
     * another level arrives as tile pieces, each clipped to its tile, so
     * outlining what is DRAWN traces the tile grid and stops dead at every
     * seam. The real boundary is the one the object actually has: taken from
     * the native in its own frame and mapped to screen, it runs continuously
     * across every tile edge. Stretches that are a JOIN rather than a free edge
     * are dropped outright — that is "no ants on the tile edge".
     *
     * WHY `covered` MATTERS. When the paint floods the view there is no
     * boundary left to dash, and drawing the window's own edge would invent
     * one. The design answers that case with the value shimmer instead, which
     * lives in the ink rather than on its edge.
     */
    _selectionAnts() {
        const s = this.selection;
        // Selection is a property of the select tool. Switching tools drops it
        // (see setTool), and this second check keeps the overlay honest even if
        // some path sets `tool` without going through there.
        if (!s || this.tool !== "select") return null;
        const F = this.cam.frame, W = this.width, H = this.height;
        // Clip wide, cull narrow: clipping closes a ring along the window edge,
        // and keeping the two margins apart puts those fabricated edges outside
        // the kept region instead of drawing a box around the screen.
        const CLIP_PX = 160, CULL_PX = 64;
        const onScreen = (p) => p[0] > -CULL_PX && p[0] < W + CULL_PX && p[1] > -CULL_PX && p[1] < H + CULL_PX;
        const win = this.cam.frameWindow(CLIP_PX / Math.max(this.cam.inScale, 1e-30));
        // The EXACT viewport, for finding where the ink meets the frame edge.
        const win0 = this.cam.frameWindow(0);
        const sides = { left: [], right: [], top: [], bottom: [] };

        const seen = new Set();
        const members = [];
        const byKey = new Map();
        const keys = new Set();
        for (const id of s.ids) {
            for (const m of this.doc.editGroup(id)) {
                const tag = m.level + "#" + m.obj.id;
                if (seen.has(tag) || m.obj.erase) continue;
                seen.add(tag);
                members.push(m);
                const k = this.doc.editKey(m.obj);
                keys.add(k);
                let a = byKey.get(k);
                if (!a) { a = []; byKey.set(k, a); }
                a.push(m);
            }
        }
        if (!members.length) return null;

        if (!this._dbgCache) this._dbgCache = { joins: new Map(), rings: new Map() };
        const C = this._dbgCache;
        if (C.joins.size > 400) C.joins.clear();
        const joins = this._familyJoinNotes(keys, byKey, C);

        // `rings` are the edges the ants run along. `fine` are the specks —
        // marks at the size of a pixel, stroked differently. `edges` are the
        // sides of the SCREEN the selection runs past, each carrying a run for
        // the ants and a direction for an arrow.
        const out = { rings: [], fine: [], edges: [], covered: false, inkPx: Infinity };
        // The selection's extent in screen coordinates, accumulated as we go.
        // Only ever compared against the viewport — never drawn, which is the
        // whole lesson of the 877,395 px rectangle.
        let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
        let budget = SEL_ANT_BUDGET_PX;
        // Which pixels already carry a trace, so marks piled onto one pixel are
        // drawn once rather than once each.
        const tinyAt = new Set();
        for (const m of members) {
            const L = m.level, o = m.obj;
            const f = this.lm.frameFactor(L, F);
            if (f == null) continue;
            const pxPerUnit = this.cam.inScale * f;
            if (!(pxPerUnit > 0)) continue;
            const vr = this.lm.mapRectF(win, F, L);
            if (!vr) continue;
            const b = bboxOf(o, this.store.live);
            if (b.x1 < vr.left || b.x0 > vr.right || b.y1 < vr.top || b.y0 > vr.bottom) continue;

            // DOWN AT ONE PIXEL. The outline is still what gets drawn, but at
            // this size there is no shape left in it to follow and flattening it
            // at the view's tolerance can collapse it to nothing at all. So the
            // trace is floored to something visible, and — the part that matters
            // on a drawing full of specks — only the FIRST mark on any given
            // pixel is traced. Tracing each of them separately would stack a
            // hundred identical outlines on one pixel and cost a hundred times
            // as much to say the same thing.
            const wpx = (b.x1 - b.x0) * pxPerUnit, hpx = (b.y1 - b.y0) * pxPerUnit;
            if (Math.max(wpx, hpx) <= SEL_ONE_PIXEL_PX) {
                const c = this.cam.levelPointToScreen(L, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
                if (!c || !onScreen(c)) continue;
                const key = Math.round(c[0]) + "," + Math.round(c[1]);
                if (tinyAt.has(key)) continue;
                tinyAt.add(key);
                // Round, not square, and stroked SOLID by the renderer: at
                // this size a square reads as a box drawn around the mark, and
                // a dash pattern has no circumference to open a gap in. The
                // radius still tracks the mark, so a 1.4 px speck stays
                // visibly larger than a 0.5 px one.
                const r = Math.max(SEL_MIN_TRACE_PX / 2, Math.max(wpx, hpx) / 2);
                const loop = [];
                for (let k = 0; k <= 8; k++) {
                    const th = (k / 8) * Math.PI * 2;
                    loop.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]);
                }
                out.fine.push(loop);
                // Ants only. There is no shimmer anywhere any more.
                budget -= 2 * Math.PI * r;
                continue;
            }

            // HOW HEAVY IS THIS INK ON SCREEN? The design scales the ants to the
            // paint, and getting this number wrong is what made the indicator
            // look like a red splat: `lwFrame` is absent on a RESOLVED shape —
            // a pen stroke loses it once it becomes a perimeter — so the test
            // silently failed for every settled stroke and the band stayed at
            // its full 5 px. On an 18 px object that is a quarter of the mark,
            // and around a boundary that doubles back on itself the two sides
            // of the band merge into a solid blob.
            //
            // `meanWidth` (twice the area over the perimeter) recovers the
            // thickness the stroke width no longer records. The object's own
            // on-screen size caps it as well, because a convoluted outline
            // packed into a few pixels will overlap itself whatever its ink
            // weight says.
            let thick = o.lwFrame || 0;
            if (!thick && o.type === "shape" && o.loops) {
                try { thick = meanWidth(o.loops); } catch (err) { thick = 0; }
            }
            const thickPx = thick > 0 ? thick * pxPerUnit : Infinity;
            out.inkPx = Math.min(out.inkPx, thickPx, Math.min(wpx, hpx));

            const tol = (this.cfg.arcTolerancePx * 0.5) / pxPerUnit;
            // Resolve the ink ONCE and clip it twice: to the padded window for
            // the ants, and to the exact viewport to find where it meets the
            // sides of the screen.
            const loops = o.type === "shape" ? null : this._inkOutline(o, tol);
            const got = this._selInkRings(o, vr, tol, loops);
            const vp = this.lm.mapRectF(win0, F, L);
            if (vp) this._selEdgeSpans(o, vp, tol, loops, L, sides);
            const entries = joins.get(o.id) || [];
            // Where does this member sit on screen? Corners only — four points,
            // however astronomical the object.
            for (const [cx, cy] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) {
                const q = this.cam.levelPointToScreen(L, cx, cy);
                if (!q || !isFinite(q[0]) || !isFinite(q[1])) continue;
                if (q[0] < sx0) sx0 = q[0];
                if (q[0] > sx1) sx1 = q[0];
                if (q[1] < sy0) sy0 = q[1];
                if (q[1] > sy1) sy1 = q[1];
            }

            const before = out.rings.length;
            for (const ring of got.rings) budget = this._emitAntRing(out, L, ring, entries, onScreen, budget);
            // The ink floods the view: either the clipper said so outright, or
            // nothing survived culling while the object still spans the whole
            // window. Both mean there is no edge on screen to dash.
            const floods = b.x0 <= vr.left && b.x1 >= vr.right && b.y0 <= vr.top && b.y1 >= vr.bottom;
            if (got.covered || (out.rings.length === before && floods)) out.covered = true;
        }

        // ---- where the selection meets the sides of the screen ---------------
        //
        // Only where the INK actually reaches the frame, not where its bounding
        // box does. A shape with several fingers touching the top edge marks
        // those fingers and nothing between them, so the border ants read as the
        // outline continuing rather than as a box drawn round the view.
        //
        // A selection entirely outside the view produces no spans at all, which
        // is why one gets no border and no chevron.
        const SIDE_LEN = { left: H, right: H, top: W, bottom: W };
        for (const side of ["left", "right", "top", "bottom"]) {
            const merged = mergeSpans(sides[side], 1.5);
            const full = SIDE_LEN[side];
            for (const [a, b] of merged) {
                if (b - a < 2) continue;
                out.edges.push({ side, from: a, to: b,
                    chevron: (b - a) >= full * SEL_CHEVRON_FRACTION });
            }
        }
        return out;
    }

    /**
     * Where this object's ink MEETS THE FRAME, as spans along each side.
     *
     * Clipping the ink to the exact viewport leaves segments lying along the
     * viewport's own edges wherever the ink ran past it — those segments are
     * the answer, and they are the only honest one: a bounding box would claim
     * the whole side when a single finger of ink touches it.
     *
     * `covered` means the ink floods the view, so every side is spanned end to
     * end. That is the case with no outline left at all, and the border becomes
     * the entire indicator.
     */
    _selEdgeSpans(o, vp, tol, loops, L, sides) {
        const got = this._selInkRings(o, vp, tol, loops);
        const W = this.width, H = this.height;
        if (got.covered) {
            sides.left.push([0, H]); sides.right.push([0, H]);
            sides.top.push([0, W]); sides.bottom.push([0, W]);
            return;
        }
        const ex = Math.max(Math.abs(vp.right - vp.left), Math.abs(vp.bottom - vp.top));
        const eps = ex * 1e-7 + tol;
        const on = (v, edge) => Math.abs(v - edge) <= eps;
        for (const ring of got.rings) {
            const n = ring.length;
            if (n < 2) continue;
            for (let i = 0; i < n; i++) {
                const a = ring[i], b = ring[(i + 1) % n];
                let side = null;
                if (on(a[0], vp.left) && on(b[0], vp.left)) side = "left";
                else if (on(a[0], vp.right) && on(b[0], vp.right)) side = "right";
                else if (on(a[1], vp.top) && on(b[1], vp.top)) side = "top";
                else if (on(a[1], vp.bottom) && on(b[1], vp.bottom)) side = "bottom";
                if (!side) continue;
                const sa = this.cam.levelPointToScreen(L, a[0], a[1]);
                const sb = this.cam.levelPointToScreen(L, b[0], b[1]);
                if (!sa || !sb) continue;
                const axis = (side === "left" || side === "right") ? 1 : 0;
                const lim = axis ? H : W;
                let p = Math.max(0, Math.min(lim, sa[axis]));
                let q = Math.max(0, Math.min(lim, sb[axis]));
                if (p > q) { const t = p; p = q; q = t; }
                sides[side].push([p, q]);
            }
        }
    }

    /** An object's ink boundary as rings, clipped to `vr`, whatever its type. */
    _selInkRings(o, vr, tol, loops) {
        const rect = { left: vr.left, top: vr.top, right: vr.right, bottom: vr.bottom };
        if (o.type === "shape") {
            const r = shapeRingsInRect(o.loops, rect, tol);
            return { rings: r.covered ? [] : r.rings, covered: !!r.covered };
        }
        if (loops) return { rings: clipRingsToRect(loops, rect), covered: false };
        if (o.type === "fill") return { rings: clipRingsToRect(o.polys, rect), covered: false };
        // A STROKE has no stored boundary — it has not resolved yet. Resolving
        // the pen to its outline is what lets a plain pen mark be selected at
        // all; the erase-debug overlay skips strokes, and copying that here
        // would have left every freehand line with no indicator. The caller
        // usually passes `loops` in, so the resolve happens once and both clips
        // share it.
        const own = this._inkOutline(o, tol);
        if (!own || !own.length) return { rings: [], covered: false };
        return { rings: clipRingsToRect(own, rect), covered: false };
    }

    /**
     * One boundary ring to screen-space ant runs, dropping every stretch that
     * is a tile JOIN rather than a free edge, and stopping when the budget runs
     * out. Returns the budget left.
     */
    _emitAntRing(out, L, ring, entries, onScreen, budget0) {
        let budget = budget0;
        const n = ring.length;
        if (n < 2 || n > 200000 || budget <= 0) return budget;
        let run = null, joined = false;
        const flush = () => {
            // A run has to cover some ground: decimation can leave two points a
            // hundredth of a pixel apart, which draws as a stray dot.
            if (run && run.length > 1 && !joined) {
                let d = 0;
                for (let i = 1; i < run.length; i++) {
                    d += Math.abs(run[i][0] - run[i - 1][0]) + Math.abs(run[i][1] - run[i - 1][1]);
                }
                if (d > 0.5) out.rings.push(run);
            }
            run = null;
        };
        const add = (p0, p1, k, last) => {
            if (budget <= 0) return;
            const s0 = this.cam.levelPointToScreen(L, p0[0], p0[1]);
            const s1 = this.cam.levelPointToScreen(L, p1[0], p1[1]);
            if (!s0 || !s1 || (!onScreen(s0) && !onScreen(s1))) { flush(); return; }
            if (run && k !== joined) flush();
            if (!run) { run = [s0]; joined = k; }
            const p = run[run.length - 1];
            const step = Math.abs(s1[0] - p[0]) + Math.abs(s1[1] - p[1]);
            // Sub-pixel chords are what a fine tolerance leaves behind once the
            // camera has had its say; dropping them keeps a magnified boundary
            // from arriving as 40,000 anchors.
            if (step <= 0.4 && !last) return;
            run.push(s1);
            // SPEND THE BUDGET AS THE RUN GROWS, not when it ends. Charging it
            // at the end meant a boundary with no joins — which never flushes
            // until its very last segment, and that is the ordinary case —
            // emitted 659,368 px against a 24,000 px allowance and the cap did
            // nothing at all. Caught by its own test rather than in the field.
            if (!joined) budget -= step;
            if (budget <= 0) flush();
        };
        for (let i = 0; i < n && budget > 0; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            const last = i === n - 1;
            const parts = entries.length ? this._splitOnJoins(entries, a, b) : null;
            if (!parts) { add(a, b, false, last); continue; }
            for (let k = 0; k < parts.length; k++) add(parts[k].p0, parts[k].p1, parts[k].joined, last && k === parts.length - 1);
        }
        flush();
        return budget;
    }

    _emitOutlineRing(out, id, L, ring, entries, onScreen) {
        const n = ring.length;
        if (n < 2 || n > 200000) return;
        let run = null, kind = false;
        const flush = () => {
            // A run has to cover some ground: decimation can leave two points a
            // hundredth of a pixel apart, which draws as a stray dot in a view
            // whose whole purpose is that every mark on it means something.
            if (run && run.length > 1) {
                let d = 0;
                for (let i = 1; i < run.length; i++) d += Math.abs(run[i][0] - run[i - 1][0]) + Math.abs(run[i][1] - run[i - 1][1]);
                if (d > 0.5) (kind ? out.contacts : out.outlines).push({ id, level: L, pts: run });
            }
            run = null;
        };
        const add = (p0, p1, k, last) => {
            const s0 = this.cam.levelPointToScreen(L, p0[0], p0[1]);
            const s1 = this.cam.levelPointToScreen(L, p1[0], p1[1]);
            if (!s0 || !s1 || (!onScreen(s0) && !onScreen(s1))) { flush(); return; }
            if (run && k !== kind) flush();
            if (!run) { run = [s0]; kind = k; }
            // Sub-pixel chords are what a fine tolerance leaves behind once the
            // camera has had its say; dropping them costs nothing visible and
            // keeps a magnified boundary from arriving as 40,000 anchors.
            const p = run[run.length - 1];
            if (Math.abs(s1[0] - p[0]) + Math.abs(s1[1] - p[1]) > 0.4 || last) run.push(s1);
        };
        for (let i = 0; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            const last = i === n - 1;
            const parts = entries.length ? this._splitOnJoins(entries, a, b) : null;
            if (!parts) { add(a, b, false, last); continue; }
            for (let k = 0; k < parts.length; k++) add(parts[k].p0, parts[k].p1, parts[k].joined, last && k === parts.length - 1);
        }
        flush();
    }

    // ---- render pipeline ----
    // The full render list at the active level: tile pieces (up + down) + the
    // level's own live natives, merged in id order (global z-order).
    _buildList() {
        const win = this.cam.frameWindow(0);
        const F = this.cam.frame;
        const derived = this.store.content(F, win);
        const own = this.store.ownContent(F);
        const list = derived.concat(own);
        // Renderer grouping follows logical edit ownership for re-homed
        // boundary patches. That lets parent/patch overlap close AA seams while
        // applying transparent opacity only once to the family.
        for (const o of list) {
            const rec = this.doc.getById(o.id);
            if (rec && rec.obj.editId != null) o.editId = rec.obj.editId;
        }
        // z defaults to id (creation order); cut pieces carry their source's z
        // so a stroke stays at its depth after a boolean erase splits it.
        list.sort((a, b) => ((a.z != null ? a.z : a.id) - (b.z != null ? b.z : b.id)) || (a.id - b.id));
        this._lastRange = this.lm.tileRange(F, win);
        return list;
    }
    _render() {
        const t0 = perfNow();
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
        if (this._visibleChanged() || this.renderer.needsRebake() || this.renderer.needsReorigin()) this._render();
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
        if (crossed || this._visibleChanged() || this.renderer.needsRebake() || this.renderer.needsFatFlip()
            || this.renderer.needsFadeFlip() || this.renderer.needsReorigin()) this._render();
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
            // Pressing on ink starts a MOVE of whatever is selected; pressing on
            // empty paper starts a lasso. ("Click-and-drag creates a selection
            // lasso" — but a drag that begins on an object has to keep meaning
            // "move it", or nothing could be moved at all.)
            const hit = this._hitTest(sx, sy);
            if (hit == null) {
                this._lasso = { pts: [[sx, sy]], ctrl: !!ctrl, moved: false };
                if (!ctrl) this.deselect();
                this.renderer.refreshSelection();
                return;
            }
            if (ctrl) { this._toggleSelected(hit); this._dragSel = null; return; }
            // Pressing an object that is ALREADY selected keeps the whole
            // selection and drags it; pressing a different one selects it alone.
            if (!this._isSelected(hit)) this.select(sx, sy);
            else this._flushErasesFor(hit);
            // The erase barrier has to cover EVERYTHING that is about to move,
            // not just the piece under the finger. A mark is a native sitting at
            // fixed coordinates; ink dragged out from under one that has not
            // been applied yet takes its un-erased shape with it, and the mark
            // stays behind and cuts whatever has arrived there instead. With
            // several objects selected, or one object whose family has a
            // re-homed piece at another level, the single-object flush left
            // exactly that. It also left the white mark itself on screen,
            // hanging over the object being dragged.
            this._settleSelectionErases();
            this._dragSel = this.selection ? { start: [sx, sy], moves: new Map(), moved: false } : null;
            // A drag rewrites the same objects on every pointer event; tiles the
            // camera cannot see are not worth patching that often.
            if (this._dragSel) this.store.setBatch(true);
            return;
        }
        const p = this.cam.screenToFrame(sx, sy);
        const highlight = this.penType === "highlight";
        const straight = this.penType === "straight";
        const lw = (highlight ? this.penWidth * 2.5 : this.penWidth) / this.cam.inScale;
        const op = highlight ? Math.min(this.opacity, 0.45) : this.opacity;
        const o = { type: "stroke", origin: "native", id: this.doc.allocId(), pts: [p], lwFrame: lw, color: this.color, opacity: op, paths: [] };
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
            if (this._dragSel && this.selection) this._dragSelection(sx, sy);
            return;
        }
        if (this._drawing) {
            const p = this.cam.screenToFrame(sx, sy);
            const o = this._drawing;
            if (this.penType === "straight" && o.pts.length >= 2) { o.pts[1] = p; this.renderer.setLiveEnd(p); }
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
                for (const [id] of d.moves) {
                    const n = this._normalizeHome(id);
                    if (!n) continue;
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
                            reach: b ? +Math.max(Math.abs(b.x0), Math.abs(b.y0), Math.abs(b.x1), Math.abs(b.y1)).toPrecision(6) : null };
                    }),
                });
                this.doc.pushUndo(moves.length === 1 ? { op: "move", ...moves[0] } : { op: "moveMany", moves });
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
    _eraserRadiusPx() { return this._eraserPx; }
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
    /** Every pending perimeter resolve, run to completion. Tests, and the
     *  selection barrier, need the document settled before they look at it. */
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
    /** Bake every pending eraser stroke to completion (tests, power tools). */
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

    // ---- multi-selection (bible §5.3) ----
    // `selection` keeps the single-object shape it has always had — id, editId,
    // level, obj — describing the PRIMARY member, and gains `ids`, every member
    // of the selection. Everything that acts on a selection (drag, delete, the
    // overlay) walks `ids`; everything that reads one object keeps working.
    _selectedIds() { return this.selection ? this.selection.ids : []; }
    _isSelected(id) {
        if (!this.selection) return false;
        const key = this.doc.editKey(this.doc.getById(id) ? this.doc.getById(id).obj : null);
        return this.selection.ids.includes(id) || (key != null && this.selection.ids.some((x) => {
            const r = this.doc.getById(x);
            return r && this.doc.editKey(r.obj) === key;
        }));
    }
    // Every native, with its bbox in the ACTIVE frame's units. Nothing in the
    // engine uses this any more — `_lassoFind` walks the frame tree instead —
    // but it is the ground truth the tree walk is checked against, so it stays
    // as the probe the suites read.
    _selectableRects() {
        const out = [];
        for (const k of this.doc.levels()) {
            for (const o of this.doc.at(k)) {
                if (o.erase) continue;
                const rect = this._rectInActive(o, k);
                if (rect) out.push({ o, level: k, rect });
            }
        }
        return out;
    }
    // One native's bbox, in the ACTIVE frame's units. Hop by hop through
    // `mapRectF` rather than through a composed factor: going DOWN to the active
    // frame a composed jump cancels catastrophically, which is the whole reason
    // the chain exists (bible section 4.1).
    _rectInActive(o, level) {
        const b = bboxOf(o, this.store.live);
        const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        return this.lm.mapRectF(
            { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m }, level, this.cam.frame);
    }

    /**
     * EVERYTHING THE LASSO ENCLOSES, FOUND BY WALKING THE FRAME TREE (bible 6.4).
     *
     * Kobin: *"the frame tree should tell you which objects you need to look at
     * when selecting and zooming... since we're only worrying about objects
     * fully enclosed in the lasso, it can't be fully enclosed if it extends to a
     * neighbouring frame that is not included in the lasso."*
     *
     * That is the whole rule and it is exact rather than heuristic. Three
     * answers per frame:
     *
     *   OUT OF REACH   the frame's neighbourhood does not meet the lasso's box.
     *                  Skip the frame AND its subtree — a descendant lives
     *                  inside its parent's cell, so it cannot reach further.
     *   ENCLOSED       the lasso contains the whole neighbourhood. Every object
     *                  in the frame and below is inside, with no per-object test
     *                  at all.
     *   STRADDLING     only these ask about individual objects, and only the
     *                  ones the frame's own spatial index hands back.
     *
     * WHAT MAKES THE PRUNE SOUND is invariant 2: an object never extends past
     * its frame's immediate neighbours, so everything a frame's subtree holds is
     * inside its own cell grown by one — REACH below. D9's promotion and
     * `_normalizeHome` are what keep that true; break either and this starts
     * missing things rather than merely being slow.
     *
     * The walk goes OUTWARD from the active frame, one hop at a time, because
     * that is the only direction in which the scale factor stays a number: from
     * the root it would be R^depth before the first useful comparison.
     */
    _lassoFind(poly) {
        const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        for (const p of poly) {
            if (p[0] < box.left) box.left = p[0];
            if (p[0] > box.right) box.right = p[0];
            if (p[1] < box.top) box.top = p[1];
            if (p[1] > box.bottom) box.bottom = p[1];
        }
        const found = [];
        const takeAll = (id) => {
            for (const o of this.doc.at(id)) if (!o.erase) found.push(o.id);
            for (const c of this.lm.childrenOf(id)) takeAll(c.id);
        };
        // `s`/`tx`/`ty` carry the frame's coordinates into the active frame's.
        // Used only for the two FRAME-level decisions, which are coarse; every
        // per-object rect still goes through `mapRectF` hop by hop.
        const visit = (id, s, tx, ty, skip) => {
            const own = { left: -REACH * s + tx, top: -REACH * s + ty,
                right: REACH * s + tx, bottom: REACH * s + ty };
            if (own.right < box.left || own.left > box.right
                || own.bottom < box.top || own.top > box.bottom) return;      // out of reach
            if (rectInsidePolygon(poly, own)) { takeAll(id); return; }        // enclosed
            for (const o of this.doc.queryRect(id, { left: (box.left - tx) / s, top: (box.top - ty) / s,
                right: (box.right - tx) / s, bottom: (box.bottom - ty) / s })) {
                if (o.erase) continue;
                const r = this._rectInActive(o, id);
                if (r && rectInsidePolygon(poly, r)) found.push(o.id);
            }
            for (const c of this.lm.childrenOf(id)) {
                if (c.id === skip || !c.centre) continue;
                visit(c.id, s / CROSS_RATIO, c.centre.x * s + tx, c.centre.y * s + ty, null);
            }
        };
        // The active frame and everything under it...
        visit(this.cam.frame, 1, 0, 0, null);
        // ...then out through each ancestor, skipping the branch already done.
        let child = this.lm.frame(this.cam.frame), s = 1, tx = 0, ty = 0;
        while (child && child.parent != null) {
            const c = child.centre;
            if (!c) break;
            s *= CROSS_RATIO; tx -= c.x * s; ty -= c.y * s;
            visit(child.parent, s, tx, ty, child.id);
            child = this.lm.frame(child.parent);
        }
        return found;
    }
    _setSelection(ids) {
        const live = ids.filter((id) => this.doc.getById(id));
        if (!live.length) { this.deselect(); return null; }
        const rec = this.doc.getById(live[0]);
        this.selection = {
            ids: live, id: rec.obj.id, editId: this.doc.editKey(rec.obj),
            level: rec.level, obj: rec.obj,
        };
        this.renderer.syncCameraOnly(); this.renderer.update();
        this._emit();
        return this.selection;
    }
    _toggleSelected(id) {
        const cur = this.selection ? [...this.selection.ids] : [];
        const i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1); else cur.push(id);
        return this._setSelection(cur);
    }
    // Close the loop and apply it.
    //   plain     replace the selection with everything the loop bounds
    //   ctrl      ADD everything it bounds — unless the loop was drawn purely
    //             inside the current selection, which REMOVES instead
    _applyLasso(L) {
        const poly = L.pts.map(([x, y]) => this.cam.screenToFrame(x, y));
        const found = this._lassoFind(poly);
        if (!L.ctrl) { if (found.length) this._setSelection(found); else this.deselect(); return; }
        const cur = this.selection ? [...this.selection.ids] : [];
        if (!found.length) return;
        // A ctrl loop that catches nothing new is a loop drawn PURELY INSIDE the
        // current selection, and that gesture subtracts. Catch anything new and
        // it is an overlapping loop, which adds. One rule, and it reads the same
        // way round as a group-level toggle.
        if (found.every((id) => cur.includes(id))) {
            this._setSelection(cur.filter((id) => !found.includes(id)));
            return;
        }
        for (const id of found) if (!cur.includes(id)) cur.push(id);
        this._setSelection(cur);
    }

    // ---- selection / edit (US-10) ----
    // Tap-select the topmost object under the point (same hit policy as the
    // object eraser). Selecting through a derived piece selects the NATIVE —
    // edits apply at its home level and re-derive everywhere.
    select(sx, sy) {
        for (let guard = 0; guard < 8; guard++) {
            const id = this._hitTest(sx, sy);
            if (id == null) { this.deselect(); return null; }
            // Erase barrier: anything still pending over this object bakes
            // NOW — the flush may split it or delete it, so re-hit after.
            if (this._flushErasesFor(id)) { this._render(); continue; }
            const rec = this.doc.getById(id);
            if (!rec) { this.deselect(); return null; }
            this._setSelection([id]);
            return id;
        }
        this.deselect();
        return null;
    }
    deselect() {
        if (!this.selection) return;
        this.selection = null; this._dragSel = null;
        this.renderer.syncCameraOnly(); this.renderer.update();
        this._emit();
    }
    // The overlay is the VISIBLE union of a logical edit family in the active
    // frame. This stays tight around a re-homed patch instead of exposing the
    // astronomical bbox of its coarse source, while a drag still moves every
    // boundary-attached member as one object.
    _selectionRect() {
        const s = this.selection; if (!s) return null;
        const keys = new Set();
        for (const id of s.ids) {
            const rec = this.doc.getById(id);
            if (rec) keys.add(this.doc.editKey(rec.obj));
        }
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const o of this._lastList) {
            const rec = this.doc.getById(o.id);
            if (!rec || !keys.has(this.doc.editKey(rec.obj))) continue;
            const b = bboxOf(o, this.store.live);
            const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
            left = Math.min(left, b.x0 - m); top = Math.min(top, b.y0 - m);
            right = Math.max(right, b.x1 + m); bottom = Math.max(bottom, b.y1 + m);
        }
        if (left !== Infinity) return { level: this.cam.frame, rect: { left, top, right, bottom } };
        const b = bboxOf(s.obj, this.store.live);
        const m = s.obj.type === "fill" ? 0 : (s.obj.lwFrame || 0) / 2;
        return { level: s.level, rect: { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m } };
    }
    // One drag step. The delta is measured from where the drag STARTED, not
    // from the previous event, and what has actually been applied so far is
    // measured off the object itself — so any part of a step the object's own
    // coordinates could not represent stays owed and is re-requested next time.
    //
    // Applying each event's delta separately instead made a SLOW drag move less
    // than a fast one: four crossings from an object, one 1-px step is below one
    // ulp of its coordinates and is silently discarded, so forty consecutive
    // 1-px steps moved it ZERO pixels while a single 100-px flick moved it
    // correctly (bible §5.4). Accumulating the residue removes the whole class.
    _anchorOf(o) {
        if (o.type === "shape") return o.loops[0][0].A;
        return o.type === "fill" ? o.polys[0][0] : o.pts[0];
    }
    /**
     * One drag step — and the reason a drag at depth is now safe.
     *
     * WHAT IT USED TO DO. Translate every member's geometry by
     * `displacement x frameFactor`, which for a member k levels below the camera
     * is `displacement x R^k`. At k = 5 a 30 px drag rewrote that member's
     * coordinates to 7.3e18 and destroyed 82.9% of its area, while the pieces
     * stayed perfectly registered with each other — so the object did not move
     * wrong, it came apart (F-C, and F25/F28 in OPEN-FLAGS).
     *
     * WHAT IT DOES NOW. The displacement is expanded into lattice DIGITS, and
     * everything a whole cell or larger is applied to the member's ADDRESS: it
     * is re-homed into the cell that many steps along, its geometry untouched,
     * because neighbouring cells' origins differ by exactly one frame and the
     * same local coordinates therefore describe the moved object exactly. Only
     * the sub-cell remainder — smaller than one frame, whatever the depth —
     * reaches geometry. A member COARSER than the camera still translates
     * directly, which is safe in the other direction: the displacement in its
     * units is `displacement / R^k`, and shrinking cannot explode.
     *
     * Every member expands the SAME displacement, so members that share an
     * ancestor take bit-identical digits there and their relative positions
     * cannot move. That is registration by construction rather than by luck.
     *
     * The whole step is also recomputed from where the drag STARTED, not from
     * the previous event, so a slow drag and a fast one apply the same
     * arithmetic to the same numbers and land in the same place (M-4). The old
     * residue bookkeeping that bought this — `erase-tile-window-design-bible.md`
     * section 5.4 — is deleted; exactness makes it unnecessary.
     */
    _dragSelection(sx, sy) {
        const d = this._dragSel;
        const tx = (sx - d.start[0]) / this.cam.inScale;
        const ty = (sy - d.start[1]) / this.cam.inScale;
        const camDepth = this.cam.activeLevel;
        let moved = false;
        for (const rec of this._selectionMembers()) {
            const id = rec.obj.id;
            let st = d.moves.get(id);
            if (!st) {
                st = { from: rec.level, to: rec.level, dx: 0, dy: 0, base: Document.snapGeometry(rec.obj) };
                d.moves.set(id, st);
            }
            const depth = this.lm.depthOf(st.from);
            if (depth == null) continue;

            let frame = st.from, wantX, wantY;
            if (depth <= camDepth) {
                // Coarser than (or level with) the camera: the displacement in
                // this object's units is bounded by the drag itself — it shrinks
                // by R per level of separation — so plain translation is exact
                // and re-homing waits for pen-up (_normalizeHome).
                const f = this.lm.frameFactor(this.cam.frame, st.from);
                if (f == null) continue;
                wantX = tx * f; wantY = ty * f;
            } else {
                // Deeper than the camera: address arithmetic. Everything a whole
                // cell or more becomes a change of frame; only the remainder,
                // which is under one frame at any depth, reaches geometry.
                const put = this.lm.displaceFrame(st.from, camDepth, tx, ty);
                if (!put) continue;
                frame = put.frame.id;
                wantX = put.rest[0]; wantY = put.rest[1];
            }

            if (frame !== st.to) { this.doc.rehomeById(id, frame); st.to = frame; moved = true; }
            if (wantX !== st.dx || wantY !== st.dy) {
                // From the drag's START, never from the last event: that is what
                // makes a slow drag land exactly where a fast one does.
                this.doc.setGeometryById(id, Document.translateGeometry(st.base, wantX, wantY));
                st.dx = wantX; st.dy = wantY;
                moved = true;
            }
        }
        d.moved = d.moved || moved;
        this._render();
    }
    /**
     * Put an object back inside its own cell, if a move pushed it out.
     *
     * Invariant 2 wants an object within a cell of its frame. A drag at or above
     * an object's own level puts the whole displacement into its coordinates, so
     * enough of them walk it out of its cell; and a deep move leaves a remainder
     * that can be almost a whole frame. Re-homing to the containing cell costs
     * nothing in accuracy — neighbouring origins differ by exactly W, a power of
     * two, so subtracting whole frames is exact.
     */
    _normalizeHome(id) {
        const rec = this.doc.getById(id);
        if (!rec) return null;
        const b = bboxOf(rec.obj, this.store.live);
        if (!b) return null;
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        const di = Math.round(cx / FRAME_W), dj = Math.round(cy / FRAME_W);
        if (!di && !dj) return null;
        const to = this.lm.neighbour(rec.level, di, dj);
        if (!to || to.id === rec.level) return null;
        this.doc.rehomeById(id, to.id);
        this.doc.moveById(id, -di * FRAME_W, -dj * FRAME_W);
        return { level: to.id, dx: -di * FRAME_W, dy: -dj * FRAME_W };
    }
    // Every native the selection covers: each selected id, plus the rest of its
    // logical edit family (a re-homed patch still moves with its source).
    _selectionMembers() {
        const s = this.selection; if (!s) return [];
        const seen = new Set(), out = [];
        for (const id of s.ids) {
            const rec = this.doc.getById(id);
            if (!rec) continue;
            for (const m of this.doc.editGroup(this.doc.editKey(rec.obj))) {
                if (seen.has(m.obj.id)) continue;
                seen.add(m.obj.id); out.push(m);
            }
        }
        return out;
    }
    deleteSelection() {
        const s = this.selection; if (!s) return false;
        const ids = [...s.ids];
        let any = false;
        for (const id of ids) { if (this.doc.getById(id) && this._eraseWhole(id)) any = true; }
        if (!any) return false;
        this.deselect();
        this._render();
        return true;
    }
    // Style is deliberately NOT reported: colour, width and opacity editing of a
    // selection were removed along with the selection style box, so nothing
    // downstream should be able to reach for them.
    _selectionStatus() {
        const s = this.selection; if (!s) return null;
        return { id: s.id, ids: [...s.ids], count: s.ids.length, type: s.obj.type, level: s.level };
    }
    // Is the point in the shape, or within `slack` of it? A resolved perimeter
    // answers "inside" exactly, but picking wants a little reach, so a miss is
    // retried on a ring of probes at the slack radius. Eight is enough: the ink
    // is a pen stroke, never a needle.
    _shapeHit(loops, p, slack) {
        if (insideShape(loops, p)) return true;
        if (!(slack > 0)) return false;
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            if (insideShape(loops, [p[0] + slack * Math.cos(a), p[1] + slack * Math.sin(a)])) return true;
        }
        return false;
    }
    /**
     * What is under this screen point, or null. Public because the cursor has
     * to answer the same question the click will: ctrl over a selected object
     * REMOVES it, ctrl anywhere else ADDS, and the sign shown has to match.
     */
    hitTestAt(sx, sy) { return this._hitTest(sx, sy); }
    _hitTest(sx, sy) {
        const p = this.cam.screenToFrame(sx, sy);
        const list = this._lastList;
        const slack = 6 / this.cam.inScale;
        for (let i = list.length - 1; i >= 0; i--) { // topmost first
            const o = list[i];
            let hit = false;
            if (o.type === "shape") {
                // Bounding box first. A resolved perimeter answers "inside"
                // exactly, but it does so by walking every piece, and the ring of
                // slack probes multiplies that by nine — on a scribble with
                // thousands of pieces that is real work per object per click, and
                // almost every object is nowhere near the point.
                const b = bboxOf(o, this.store.live);
                if (p[0] < b.x0 - slack || p[0] > b.x1 + slack
                    || p[1] < b.y0 - slack || p[1] > b.y1 + slack) continue;
                hit = this._shapeHit(o.loops, p, slack);
            }
            else if (o.type === "fill") hit = windingOfPoint(o.polys, p) !== 0;
            else {
                const pts = (o.origin === "native" && o.pts.length > 2) ? flattenCurve(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter) : o.pts;
                hit = distToPolyline(pts, p) <= o.lwFrame / 2 + slack;
            }
            if (!hit) continue;
            // Pending eraser ink is invisible to picking — the click falls
            // through to whatever it covers (select() then flushes its bake).
            const nat = this.doc.getById(o.id);
            if (nat && nat.obj.erase) continue;
            return o.id;
        }
        return null;
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

    // ---- snapshot (dev-0, kept verbatim for tests/tools) ----
    snapshot() {
        return { v: "dev-0", camera: this.cam.state(), natives: this.doc.serializeNatives(), crossings: this.lm.serialize() };
    }
    loadSnapshot(snap) {
        if (!snap || !snap.natives) return false;
        this.lm.load(snap.crossings || {});
        this._bakeJobs = []; this._bakeQueued.clear();
        this.doc.loadNatives(snap.natives); // reset event clears the tile cache
        this.cam.set(snap.camera || { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 });
        this.cam.settle();                  // a file may record an illegal zoom
        this.renderer.clear();
        this._render();
        this._scheduleBake(0);   // resolve any stroke the file carried unbaked
        this._queueIdleFits();
        return true;
    }

    // ---- drawing files (the real save format — persist.js, kobin-1) ----
    // serializeDrawing() -> a validated, versioned JSON document; meta.name /
    // createdAt persist on the engine across saves. loadDrawing() accepts a
    // kobin-1 file OR a legacy dev-0 snapshot and THROWS a readable Error on
    // anything malformed (callers surface it; nothing is half-loaded because
    // decode fully validates before any state is touched).
    serializeDrawing(meta = {}) {
        const doc = encodeDrawing({
            camera: this.cam.state(), crossings: this.lm.serialize(),
            natives: this.doc.serializeNatives(),
            meta: { ...this.docMeta, ...meta },
        });
        this.docMeta = {
            name: doc.meta.name,
            createdAt: doc.meta.createdAt,
            scaleDef: doc.meta.scaleDef ?? null,
            scenes: doc.meta.scenes ?? [],
            hiddenScenes: doc.meta.hiddenScenes ?? [],
            sceneSeq: doc.meta.sceneSeq ?? 1,
        };
        return doc;
    }
    loadDrawing(raw) {
        const d = decodeDrawing(raw); // throws before any engine state changes
        this.lm.load(d.crossings);
        this._bakeJobs = []; this._bakeQueued.clear();
        this.doc.loadNatives(d.natives); // reset event clears tiles + selection
        this.cam.set(d.camera);
        this.cam.settle();                  // a file may record an illegal zoom
        this._eraseCommits.clear();
        this._bakeDone.clear();
        this._scheduleBake(); // resume baking any eraser strokes the file carried
        this.docMeta = {
            name: d.meta.name,
            createdAt: d.meta.createdAt,
            scaleDef: d.meta.scaleDef ?? null,
            scenes: d.meta.scenes ?? [],
            hiddenScenes: d.meta.hiddenScenes ?? [],
            sceneSeq: d.meta.sceneSeq ?? 1,
        };
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }

    // ---- scenes (auto-scenes v2: docs/auto-scenes-design-bible.md) ----
    // Scenes speak FRAME KEYS (see scenes.js). Provide the transforms plus the
    // tree adjacency (depthOf / childrenOf) so clustering stitches across frame
    // edges — parent ← each child — instead of depth±1, and sibling frames (far
    // apart by construction) never merge.
    // Canonical scene key for the active frame: the depth int on the spine, the
    // frame id for a local sibling — matching scenes.js `normKey` so provisional
    // and captured scenes reconcile with computed proposals.
    _sceneKey() {
        const f = this.cam.frame;
        const d = this.lm.depthOf(f);
        return String(d) === f ? d : f;
    }
    _sceneProj() {
        return {
            mapRect: (rect, from, to) => this.lm.mapRectF(rect, from, to),
            widthFactor: (from, to) => this.lm.frameFactor(from, to),
            depthOf: (k) => { const d = this.lm.depthOf(k); return d == null ? Number(k) : d; },
            childrenOf: (k, keys) => { const f = this.lm.frameFor(k); const id = f && f.id; return id == null ? [] : keys.filter((x) => this.lm.parentOf(x) === id); },
        };
    }
    // Frame a rect (in `frameKey`'s coords) in the viewport. `frameKey` is a
    // frame id or a legacy depth int; it must exist in the frame tree. The
    // computed inScale may land outside [exit, enter]; _maybeCross normalizes it
    // through the ordinary crossing machinery.
    jumpTo(frameKey, rect) {
        if (!rect || !(rect.w > 0) || !(rect.h > 0)) return false;
        const f = this.lm.frameFor(frameKey);
        if (!f) return false; // unreachable frame / depth
        if (this._drawing) this.pointerUp();
        const s = Math.min(this.width / rect.w, this.height / rect.h);
        if (!(s > 0) || !Number.isFinite(s)) return false;
        this.cam.set({
            frame: f.id, activeLevel: f.depth, inScale: s,
            inPanX: (this.width - rect.w * s) / 2 - rect.x * s,
            inPanY: (this.height - rect.h * s) / 2 - rect.y * s,
        });
        this.cam._maybeCross();
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }
    // The real recompute — gated on per-level ink hashes, so it's free when
    // nothing changed since the last resolve (bible: evaluation schedule).
    refreshScenes() {
        const hashes = {};
        let changed = false;
        for (const Ls of Object.keys(this.doc.nativesByLevel)) {
            if (!(this.doc.nativesByLevel[Ls] || []).length) continue;
            hashes[Ls] = levelHash(this.doc.nativesByLevel, Ls);
            if (!this._levelHashes || this._levelHashes[Ls] !== hashes[Ls]) changed = true;
        }
        if (this._levelHashes) {
            for (const L of Object.keys(this._levelHashes)) if (!(L in hashes)) changed = true;
        }
        if (!changed && this._sceneMembers && !this._scenesProvisional) {
            return this.docMeta.scenes || [];
        }
        const proj = this._sceneProj();
        // Re-homed patches are NOT new ink. A deep erase moves part of an object
        // into frames that previously held nothing, and to the clustering that
        // looks exactly like someone drawing a fine detail there: it opens a
        // nested pocket, and the user's scene list grows every time they erase.
        // That is the storage becoming visible, which §3.4's rule of thumb
        // forbids. A patch fills a ceded TILE, which is 1/3000 of its parent's
        // own frame and sub-pixel there, so leaving it out cannot lose a
        // composition of any size the parent level can resolve.
        //
        // `attachRect` is what marks one. This used to test `srcId`, which the
        // cede refactor deleted — leaving the filter a silent no-op that let
        // every deep erase invent a scene again.
        const forScenes = {};
        for (const Ls of Object.keys(this.doc.nativesByLevel)) {
            forScenes[Ls] = (this.doc.nativesByLevel[Ls] || []).filter((o) => o.attachRect == null);
        }
        const proposals = computeSceneProposals(forScenes, proj);
        // Provisional scenes participate in matching so their ids/numbers
        // survive the resolve; unmatched (unpinned) ones drop naturally.
        const state = {
            scenes: this.docMeta.scenes || [],
            hidden: this.docMeta.hiddenScenes || [],
            seq: this.docMeta.sceneSeq || 1,
        };
        const merged = matchScenes(state, proposals, proj);
        for (const s of merged.scenes) delete s.provisional;
        this.docMeta = { ...this.docMeta, scenes: merged.scenes, hiddenScenes: merged.hidden, sceneSeq: merged.seq };
        this._sceneMembers = merged.members;
        this._levelHashes = hashes;
        this._scenesProvisional = false;
        return merged.scenes;
    }
    // Pen-up freshness: assign the new stroke to an existing scene at its
    // level or open a provisional one. No clustering runs here; the next
    // refreshScenes() (Scenes panel / Save) resolves everything properly.
    _noteInkAdded(o) {
        this._scenesProvisional = true;
        const F = this._sceneKey();
        const b = bboxOf(o);
        const w = o.lwFrame || 1e-9;
        const rect = { x: b.x0, y: b.y0, w: Math.max(b.x1 - b.x0, w), h: Math.max(b.y1 - b.y0, w) };
        const T = JOIN_WINDOWS * WINDOW_WIDTHS * w;
        for (const s of this.docMeta.scenes || []) {
            if (s.level !== F || s.captured) continue;
            const gx = Math.max(0, Math.max(s.rect.x - (rect.x + rect.w), rect.x - (s.rect.x + s.rect.w)));
            const gy = Math.max(0, Math.max(s.rect.y - (rect.y + rect.h), rect.y - (s.rect.y + s.rect.h)));
            if (gx <= T && gy <= T) {
                s.rect = {
                    x: Math.min(s.rect.x, rect.x), y: Math.min(s.rect.y, rect.y),
                    w: Math.max(s.rect.x + s.rect.w, rect.x + rect.w) - Math.min(s.rect.x, rect.x),
                    h: Math.max(s.rect.y + s.rect.h, rect.y + rect.h) - Math.min(s.rect.y, rect.y),
                };
                s.hash = ""; // thumbnail refresh at next resolve
                return;
            }
        }
        let seq = this.docMeta.sceneSeq || 1;
        const pad = 0.1 * Math.max(rect.w, rect.h);
        const s = {
            id: `s${seq}`, name: `Scene ${seq}`, level: F,
            rect: { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad },
            pinned: false, auto: true, provisional: true, depth: 0,
        };
        seq += 1;
        this.docMeta = { ...this.docMeta, scenes: [...(this.docMeta.scenes || []), s], sceneSeq: seq };
    }
    renameScene(id, name) {
        const s = (this.docMeta.scenes || []).find((x) => x.id === id);
        if (!s || !name || !name.trim()) return false;
        s.name = name.trim().slice(0, 120);
        s.pinned = true; // a named scene never auto-drops
        delete s.provisional;
        return true;
    }
    // Deleting also suppresses the frame so the same cluster can't resurrect.
    deleteScene(id) {
        const scenes = this.docMeta.scenes || [];
        const s = scenes.find((x) => x.id === id);
        if (!s) return false;
        this.docMeta.scenes = scenes.filter((x) => x.id !== id);
        this.docMeta.hiddenScenes = [...(this.docMeta.hiddenScenes || []), { level: s.level, rect: s.rect }];
        return true;
    }
    // Split: half-gap re-cluster of the scene's members. Children are pinned
    // (they survive the next full-gap recompute) and the parent frame is
    // suppressed (it can't come back as a fresh scene).
    splitScene(id) {
        const scenes = this.docMeta.scenes || [];
        const s = scenes.find((x) => x.id === id);
        if (!s) return null;
        const ids = this._sceneMembers && this._sceneMembers[id];
        const memberObjs = ids && ids.length
            ? ids.map((i) => this.doc.getById(i)).filter(Boolean).map((r) => ({ o: r.obj, level: r.level }))
            : this.doc.queryRect(s.level, { left: s.rect.x, top: s.rect.y, right: s.rect.x + s.rect.w, bottom: s.rect.y + s.rect.h })
                .map((o) => ({ o, level: s.level }));
        const parts = splitMembers(memberObjs, s.level, this._sceneProj());
        if (!parts || parts.length < 2) return null;
        let seq = this.docMeta.sceneSeq || 1;
        const children = parts.map((p) => ({
            id: `s${seq}`, name: `Scene ${seq++}`,
            level: p.level, rect: p.rect, hash: p.hash,
            pinned: true, auto: true, depth: s.depth || 0,
        }));
        const idx = scenes.findIndex((x) => x.id === id);
        const next = scenes.slice();
        next.splice(idx, 1, ...children);
        this.docMeta = {
            ...this.docMeta,
            scenes: next,
            hiddenScenes: [...(this.docMeta.hiddenScenes || []), { level: s.level, rect: s.rect }],
            sceneSeq: seq,
        };
        if (this._sceneMembers) {
            delete this._sceneMembers[id];
            parts.forEach((p, i) => { this._sceneMembers[children[i].id] = p.memberIds; });
        }
        return children;
    }
    // The effective zoom a scene's frame is viewed at (for "at 240×" labels).
    sceneZoom(s) {
        const inScale = Math.min(this.width / s.rect.w, this.height / s.rect.h);
        return this.lm.effectiveZoom(s.level, inScale);
    }
    // Capture this view (bible §4): retarget the matching scene or create a
    // new pinned one. Captured frames are never auto-reframed by recomputes.
    captureView(name) {
        const win = this.cam.frameWindow(0);
        const view = {
            level: this._sceneKey(),
            rect: { x: win.left, y: win.top, w: win.right - win.left, h: win.bottom - win.top },
        };
        const target = resolveCapture(view, this.docMeta.scenes || [], this._sceneProj());
        if (target) {
            target.level = view.level;
            target.rect = view.rect;
            target.pinned = true;
            target.captured = true;
            target.hash = `cap${Date.now().toString(36)}`;
            delete target.provisional;
            if (name && name.trim()) target.name = name.trim().slice(0, 120);
            this.docMeta = { ...this.docMeta };
            return { scene: target, retargeted: true };
        }
        let seq = this.docMeta.sceneSeq || 1;
        const s = {
            id: `s${seq}`, name: (name && name.trim()) || `Scene ${seq}`,
            level: view.level, rect: view.rect,
            pinned: true, auto: false, captured: true, depth: 0,
            hash: `cap${Date.now().toString(36)}`,
        };
        seq += 1;
        this.docMeta = { ...this.docMeta, scenes: [...(this.docMeta.scenes || []), s], sceneSeq: seq };
        return { scene: s, retargeted: false };
    }

    // ---- status + ported BUG invariants ----
    _emit() {
        this.onStatus({
            level: this.cam.activeLevel, inScale: this.cam.inScale, effectiveZoom: this.cam.effectiveZoom(),
            nearCross: this.cam.inScale > this.cfg.enter * 0.8, objects: this._lastList.length,
            outline: this.outlineMode,
            lines: false, // per-origin curvature now; no global "line mode" level
            selection: this._selectionStatus(),
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

function perfNow() { return (typeof performance !== "undefined" ? performance.now() : Date.now()); }
