/**
 * RasterRenderer.js — the `Renderer` subclass that draws the ink into plates instead of into
 * SVG (RASTERISER-PLAN §5.1, §5.4's caller half, §5.6, §6.5, §2.7 FC1–FC6).
 *
 * It owns the render path and nothing else: the layer computes the mapping and composes
 * (`PictureLayer`), the store caches (`PlateStore`), the client queues and posts
 * (`rasterWorkerClient`), and `KobinEngine` owns the store's lifetime, the Stage and the flag.
 * **This module is the only poster**: it calls `beginJob`/`endJob` for every job the client mints,
 * and the layer never posts one (§15.3 Q3).
 *
 * Five things a reader needs in order not to break it:
 *
 *   - **A job carries the G it is packed at** (A2 §3.1): `_packNow` reads it when the client pulls
 *     the strip — the Stage's generation, or the G the list it packs was read at — `beginJob`
 *     tracks its cells from then, and the result brings it back to `put`.
 *   - **Every job is packed and keyed from the OBJECT the callback handed it** — `layer.view()`
 *     for its own wants, `settleRequest()` or `quantumRequest()` for the layer's — and the three
 *     fields it needs are COPIED at that moment, because those request objects are mutated in
 *     place and a strip packed a turn later would read a quantum that has since moved (D158–D160).
 *   - **One arriving job is ONE compose**: the result callback builds every record and hands
 *     them to `layer.onPlateBatch(recs)`. A loop over `onPlate` is a full-canvas paper fill and a
 *     blit per plate, per plate (D173).
 *   - **A dead quantum's queued strips are dropped with the DEAD `q`** — `dropQueued(why, deadQ)`
 *     — never the bare form, which empties the newest quantum's strips and the settle's with it
 *     (D185). What says a quantum died is `layer.status()`, read once a camera step.
 *   - **In sync mode nothing is cached.** The screen is rastered on this thread at the exact
 *     zoom into the layer canvas, which is idle there (`s` = 1), and handed to `compose` as one
 *     entry; `onPlate` is never called with it, because a record keyed `"s"` is refused (§6.5).
 *
 * Nothing here is measured in jsdom: `getContext` returns null in this tree, so the suite drives
 * an injected recording context and asserts call sequences and computed numbers. What the
 * picture looks like is stage 7's, in Kobin's Chrome (§9.4).
 */

import Two from "two.js";
import Renderer from "../Renderer";
import { perfNow } from "../now";
import PictureLayer from "./PictureLayer";
import { PLATE_PX, PREVIEW_QUANTA, plateKey, plateOriginPx, plateRange, quantumFor, zqOf } from "./plate";
import { packJob, parseColour, visibleChords, packStats, COORD_BOUND, entryFor, itemBox, outsideWin, setPackBudget, PACK_BUDGET_PHONE } from "./rasterPack";
import { renderPlate, coreStats, TW, TH } from "./rasterCore";
import { COUNTS_PER_PLATE, TIMINGS_PER_PLATE } from "./rasterJob";
import { antStats, selAntScale } from "./antPaint";
import OverlayLayer from "./OverlayLayer";
import MovePlane, { MOVE_PLANE_PLATES, MOVE_PLANE_PLATES_PHONE, MOVE_HOLD_MS, planeStats } from "./MovePlane";
import * as rasterPerf from "./rasterPerf";
import {
    submitPlates, dropQueued, abandonInFlight, ensureRasterPool, destroyRasterPool,
    plateBitmap, stripSizeFor, rasterWorkerReport, rasterPool,
} from "./rasterWorkerClient";
import PyramidStore, { planeCell } from "./PyramidStore";
import PicturePyramid, { sampleOf, EST_DEFAULTS } from "./PicturePyramid";
import JobQueue, { PRIO } from "./jobQueue";
import { prefetchPlan, farKeysOf } from "./prefetch";
import { LEVEL_STEP, levelFor, zOf } from "./level";

/** The preview's quantum offset, re-exported for the renderer's callers (P3's tests import it here). */
export { PREVIEW_QUANTA };
/** PAPER-PLAN R5b, §10 S6: a ladder rung is rastered this many quanta under its own zoom (4–6 plates a rung on a desktop at the engine's 2.5-screen window). */
export const LADDER_DQ = 12;
/** The camera must hold its view this long before the drag plane is aimed at it: a zoom would re-raster it every quantum. */
const PLANE_QUIET_MS = 150;
/** A rung asking for more plates than this is refused: its window was not the screen's. */
const LADDER_MAX_PLATES = 24;
/**
 * PAPER-PLAN §10 S5 (P5): a finished stroke's live path stays up until the plates under it are
 * fresh — they hold it then — or the view leaves its frame; this is only the safety limit, counted
 * in `liveTimeouts`. At 500 ms a busy main thread (1.3 s post-to-arrival, §9) made the stroke vanish
 * until its plates landed (review minor 6).
 */
export const LIVE_HOLD_MS = 3000;
/** The longest a held path waits, from its shape's landing, while the plates under it are in flight (none while it is pending). */
const LIVE_HOLD_MAX_MS = 15000;
let liveClipSeq = 0;
/** The stopgap's bounds: a selection this small, over this few plates, is rastered on the main thread. */
const STOPGAP_OBJECTS = 500;
const STOPGAP_PLATES = 8;
/** A far plane level's list (F122) is read 40 ms at a time at idle, 40 reads at most, then the camera's list. */
const FAR_LIST_BUDGET_MS = 40;
const FAR_LIST_TRIES = 40;
const planeIdle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 30));

/**
 * The cap `visibleChords` exits at. It must be strictly above the layer's own
 * `2 × SYNC_CHORD_BUDGET`, or the hysteresis reads the exit value as "still light"
 * (`PictureLayer._syncSwitch` keeps the sync path while `n <= 2 × budget`).
 */
const CHORD_CAP = (budget) => 2 * budget + 1;
/** The pyramid's estimate counts chords only this far: 20,000 × 0.73 µs is past any inline budget (A3 §2.2). */
const MEASURE_CHORD_CAP = 20000;

/**
 * Quarter-octave steps below the live quantum that a PREVIEW is rastered at (PAPER-PLAN §7.4,
 * C §1.5). Eight is the knee and the argument is arithmetic: `plateRange`'s `floor(P/512) + 1 or
 * + 2` floors the count at 4 below it, so `q − 12` buys no plates and costs 8× the blur, while
 * `q − 4` doubles the plate count for 2× less. The crossing prebake asks at the target frame's
 * `q − PREVIEW_QUANTA`; P2's `PictureLayer._prev` must ask at the same offset, from here.
 */

/**
 * §8.1's slot names, the vocabulary this module and `rasterPerf` share; `_add` turns a name into
 * that module's numeric slot, so a recording test double can take the names instead.
 *
 * **Twelve are written here.** Seven on every frame — `cull`, `pack`, `view`, `lookup`, `tail`,
 * `xferOut` and `blit` — four on the SYNC path alone, where §8.1's "worker (or main, in sync
 * mode)" applies (`clip`, `edges`, `union` and `accum`, summed out of the per-plate `timings`
 * `renderPlate` fills), and `list`, which the ENGINE times around `_buildList` and hands to
 * `noteList` — the row is open before that call (§8.1, §15.3 Stage 5b Q2).
 *
 * The other two are named so a reader of a report knows where their cost already is, not that it
 * is free: the settle's timer task has a row of its own (`_post`, D266) whose work is `pack` and
 * `xferOut`, and `band` is built inside `packJob`, so it is counted in `pack`. `bitmap` is
 * written through `perf.noteBitmap`, not through `_add`.
 */
export const SLOT = {
    list: "eng.list", settle: "eng.settle", cull: "eng.cull", band: "eng.band", pack: "eng.pack",
    view: "eng.view", lookup: "eng.lookup", tail: "ovl.tail",
    clip: "eng.clip", edges: "ras.edges", union: "ras.union", accum: "ras.accum",
    xferOut: "xfer.out", bitmap: "br.bitmap", blit: "br.blit",
};

/** This module's own counters, beside `pictureStats` and `packStats`; scalars only (F58). */
export const rasterStats = {
    frames: 0, cameraFrames: 0, posts: 0, postedPlates: 0, strips: 0,
    // A second `submitPlates` at one `q` inside one TASK — a frame step, or an arrival and its
    // re-post: §10 item 15's rule, counted rather than refused, because nothing on the render
    // path throws (D187's principle).
    dupPostQ: 0,
    jobsEnded: 0, dropsHandled: 0, staleArrivals: 0, refusedAtDispatch: 0,
    // Strips refused at dispatch, by reason (PLAN §5.4 Q3): a snapshot older than the cell's dirt, the
    // table not covering a camera plate (and that strip's uncovered plates, left to stand-ins), a dead quantum.
    refusedDirt: 0, refusedCover: 0, refusedCoverPlates: 0, refusedDead: 0,
    quantumDrops: 0, settleDrops: 0,
    syncFrames: 0, syncPlates: 0, syncNoImageData: 0, syncBytes: 0,
    batches: 0, batchPlates: 0, bitmapWaits: 0,
    // R4 and S1, both off camera. Whether a prebaked plate is ever USED is the reader that says
    // if R4 earns its keep, and it belongs to the request that asks for it (P2's preview).
    prebakePosts: 0, prebakePlates: 0,
    liveHolds: 0, liveHandoffs: 0, liveTimeouts: 0, liveHoldMsMax: 0, liveExtends: 0,   // S5: the pen-up handoff
    liveClips: 0,                                                                        // D-2: translucent paths clipped to stale cells
    ladderPosts: 0, ladderPlates: 0, ladderRefused: 0,   // PAPER-PLAN R5b
    snapshots: 0, snapshotPlates: 0, snapshotAborts: 0, snapshotFails: 0, snapshotOverBound: 0,
};

export function resetRasterStats() {
    for (const k of Object.keys(rasterStats)) rasterStats[k] = 0;
}

/** `want`'s misses by squared plate distance from the request's range centre, in place. */
function sortCentreOut(misses, r) {
    const ci = (r.i0 + r.i1) / 2, cj = (r.j0 + r.j1) / 2;
    misses.sort((a, b) => ((a.i - ci) ** 2 + (a.j - cj) ** 2) - ((b.i - ci) ** 2 + (b.j - cj) ** 2));
}

export default class RasterRenderer extends Renderer {
    /**
     * @param {Element} container the editor host, shared with the Two.js `<svg>` (FC1)
     * @param {object} camera the engine's `Camera` — **the same object the engine later hands
     *        `frameFor`**, because the settle's publish and the quantum switch map the INJECTED
     *        one off the rAF cycle (FC3, D192)
     * @param {object} cfg the engine cfg
     * @param {object} [opts]
     * @param {number} [opts.width] CSS px @param {number} [opts.height] CSS px
     * @param {object} [opts.store] the `PlateStore`; the ENGINE constructs it, with the Stage as its
     *        freshness source, and owns its lifetime and `destroy`
     * @param {object} [opts.stage] the engine's `Stage`: plates are packed from its items at its
     *        generation. Without one (the suites' renderer) `render`'s list is packed at the store's G
     * @param {object} [opts.layer] a `PictureLayer` to use instead of building one (the suite's)
     * @param {number} [opts.dpr] devicePixelRatio override, for the suite
     * @param {string} [opts.paper] the paper colour, which must agree with the host's CSS
     * @param {() => number} [opts.frameSeq] the engine's own counter, bumped per camera step
     * @param {object} [opts.perf] a recorder with `rasterPerf`'s own names, for the suite; the
     *        shipped default is `rasterPerf` itself
     * @param {Function} [opts.notePerf] the engine's perf-log hook, handed to `perf.attach`
     * @param {object} [opts.layerOpts] the layer's own knobs — `syncBudget`, the settle's timer
     *        and clock — spread into the `PictureLayer` this builds
     * @param {(w:number,h:number)=>object} [opts.makeCanvas] a canvas factory, for the suite
     */
    constructor(container, camera, cfg, opts = {}) {
        super(container, camera, cfg, opts);
        this.host = container || null;
        this.store = opts.store || null;
        /** The scene (the engine's Stage, A2 §3): packs read its items at its generation; it is the store's freshness source. */
        this.stage = opts.stage || null;
        this._sceneArr = null; this._sceneSrc = null; this._sceneArrG = -1;
        this.perf = opts.perf || rasterPerf;
        this._nextSeq = opts.frameSeq || null;
        /** §8.4 rule 1's join, bumped on EVERY camera step and not only on a full render (Q12). */
        this.frameSeq = 0;
        /** True between `beginRender` and `_endFrame`: the ENGINE opened this frame's row. */
        this._rowOpen = false;
        /** True while any row this module opened is open, whatever its kind (`_openRow`). */
        this._rowLive = false;
        this.paper = opts.paper || "#ffffff";
        this._paperRgb = parseColour(this.paper);

        // FC1: the stack is an explicit z-index — 0 ink, 1 the Two.js `<svg>`, 2 the overlay
        // canvas (5d), 3 `bl-sel-edges` — never the append order, because the constructor above
        // appended the `<svg>` before this line could run and `_buildSelOverlay` appends its two
        // layers lazily on the first decision. A static element ignores z-index, so the `<svg>`
        // is positioned here as well.
        const svg = this.two.renderer && this.two.renderer.domElement;
        if (svg && svg.style) {
            svg.style.position = "absolute";
            svg.style.left = "0"; svg.style.top = "0";
            svg.style.zIndex = "1";
        }

        const dpr = opts.dpr > 0 ? opts.dpr
            : (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
        /** The picture pyramid's path (`cfg.pyramid`, A3 §7.4, §10.1): its store, the pyramid as the layer, the queue. */
        this.pyramid = null; this.queue = null;
        if (cfg && cfg.pyramid && this.stage) this._pyrBuild(container, dpr, opts);
        else this.layer = opts.layer || new PictureLayer(container, camera, {
            store: this.store, width: this.width, height: this.height, dpr, paper: this.paper,
            makeCanvas: opts.makeCanvas,
            // `layerOpts` is the layer's own knobs — `syncBudget` (stage 7 tunes it), the
            // settle's timer and clock. The two callbacks come after it: this module is the
            // only poster, and a caller that replaced them would be a second one (§15.3 Q3).
            ...(opts.layerOpts || null),
            onPlates: (req, misses) => this._post(req, misses, "plates"),
            onRepost: (req, misses) => this._post(req, misses, "repost"),
        });
        /**
         * FC1's ONE list of screen-space layers: `setSize`, `destroy` and the store's release
         * walk it, so 5d appends `this._overlay` rather than shipping a second copy of each.
         */
        this._layers = [this.layer];
        /** FC1, FC8: 5d's `OverlayLayer` goes here, at z-index 2. Null until then. */
        this._overlay = null;
        // FC1 as corrected (D190): the release is the STORE's event and not a renderer walk.
        if (this.store) this.store.onRelease = (reason) => this._onStoreRelease(reason);
        if (this.store) this.store.onShow = () => { if (this.onShown) this.onShown(); };
        if (this.store && this.store.phone) setPackBudget(PACK_BUDGET_PHONE);   // the pack memo: half on a phone
        // The scene's last commit: the plane's pre-aim and the prefetch wait for its quiet (a bake commits every few frames).
        this._commitAt = -Infinity;
        this._commitOff = this.stage && this.stage.onCommit ? this.stage.onCommit(() => { this._commitAt = perfNow(); }) : null;

        /**
         * FC6: the overlay origin, ONE object with ONE writer (`addLive`). `_selDecide` caches
         * its decision on `c.origin === O` by identity, so a fresh literal per call turns a
         * 26–47 ms decision into a per-frame cost with every suite green.
         */
        this._ovOrigin = { x: 0, y: 0 };
        /** §2.5 seam 3: one persistent scene, so the live stroke has a parent and retention never runs. */
        this._ovScene = null;

        // The render path's own state. Nothing here is allocated per frame (FC5).
        this._lastList = [];
        this._view = null;
        this._qWas = null; this._pendWas = ""; this._prevWas = ""; this._settleWas = false;
        this._postQ = [];              // the `q`s posted inside THIS task — a frame step or an arrival (item 15)
        this._snapSeq = 0;             // `snapshotJob`'s per-call `q` (S1): "t3" is one snapshot's alone
        this._packMs = 0;              // the pack's own ms inside one `submitPlates`, for `xfer.out`
        this._postMs = 0;              // the posts nested inside `frameFor`, subtracted from `eng.view`
        this._sync = { rgba: null, counts: null, timings: null, hit: null, coreMs: 0 };
        /** PAPER-PLAN §10 S4: the selection's drag plane; the engine's state is pulled (`setPlaneState`). A3 §6's keys on the pyramid. */
        this._plane = new MovePlane({ pyramid: !!this.pyramid });
        /** A test hook: no drag plane — every drag renders each step (the path a lost plane falls back to). */
        this.forcePerStepDrag = false;
        this._planeFn = null;
        this._landTimer = null;
        this._planeTimer = null;
        this._planeViewKey = ""; this._planeViewAt = 0;
        /** S5: finished strokes' live paths waiting for their plates — `{ path, id, frameId, box, at, until, translucent }`. */
        this._liveHeld = [];
        this._liveTimer = null;

        // SEVEN sources, not three (stage 6's H1, D210): with the four scalar ones missing,
        // `report().pack`, `.core`, `.ants` and `.worker` all ship null and §10 stage 6's items
        // 3 and 4 are unmet. They are passed here because `rasterPerf` imports nothing itself.
        this.perf.attach({
            layer: this.layer, store: this.store, workerReport: rasterWorkerReport,
            pack: packStats, core: coreStats, ants: antStats,
            notePerf: opts.notePerf || null,
        });
        this._armDpr(dpr);             // §6.1's resolution listener; a no-op where there is no matchMedia
        ensureRasterPool();            // §8.5: never on the first render (D167)
    }

    // ---- FC1: the layer stack, the resize and the teardown ----

    /**
     * G13: the raster path never creates `bl-sel-layer` — the retained ants are `OverlayLayer`'s
     * canvas — so this builds `bl-sel-edges` ALONE through §2.5's sixth seam, for the chevrons,
     * at z-index 3 above the ink (0), the Two.js `<svg>` (1) and the ant plane (2). `_selOv` and
     * `_selEls` keep the base's shape, so `Renderer._dropSelOverlay` and `_renderSelChevrons`
     * work unchanged.
     */
    _buildSelOverlay(svg) {
        const host = svg.parentNode || document.body;
        const edgeLayer = this._mkSelLayer(svg, host, "bl-sel-edges");
        edgeLayer.style.zIndex = "3";
        const screen = document.createElementNS(edgeLayer.namespaceURI, "g");
        edgeLayer.appendChild(screen);
        host.appendChild(edgeLayer);
        this._selOv = [edgeLayer];
        this._selEls = { layer: null, edgeLayer, world: null, markAnchor: null, screen,
            key: null, kt: null, w: 0, h: 0, antPool: [], markPool: [], edgePool: [], arrowPool: [] };
        return this._selEls;
    }

    /**
     * §10 stage 5d's fork in `overlays._selDecide`: this renderer's ants are painted into a
     * canvas, so a decision keeps each run's PIECES instead of building a path string — 8.3 ms
     * and 345 KB off a decision at F39's own density.
     */
    get antPainter() { return true; }

    /**
     * The indicator, on the raster path: the ants go into `OverlayLayer`'s own canvas and the
     * only SVG left is the chevrons, drawn by §2.5's fifth seam (`Renderer._renderSelChevrons`)
     * rather than by a second copy of it. The decision itself is the engine's, unchanged (G11).
     *
     * The layer is handed the PUBLISHED view — never the camera (FC2) — and, for the screen-edge
     * spans alone, the CSS-px shift between the two (`_edgeShift`, §15.3 Q5 of the checkpoint).
     * The decide's own ms goes to FC7's `decideMs` and not to a slot of its own: this method runs
     * inside `syncWorld`'s `ovl.tail` bracket, and a second timer would count it twice.
     */
    _renderSelOverlay(view) {
        // Destroyed: the next engine shares the host, and `_makeOverlay` would append to it (F101).
        if (this._destroyed) return null;
        const svg = this.two.renderer && this.two.renderer.domElement;
        if (!svg || typeof document === "undefined") return null;
        const t0 = perfNow();
        const data = this._selAntsFn && this._selAntsFn();
        const decideMs = perfNow() - t0;
        const runs = (data && data.runs) || [], marks = (data && data.marks) || [], edges = (data && data.edges) || [];
        if (!data || !(runs.length || marks.length || edges.length)) { this._dropSelOverlay(); return null; }
        const v = view || this._view;
        if (!v) return null;                           // no published mapping yet: leave what is there
        Renderer._ensureSelStyle();
        const els = this._selEls || this._buildSelOverlay(svg);
        if (els.w !== this.width || els.h !== this.height) {
            els.edgeLayer.setAttribute("width", String(this.width));
            els.edgeLayer.setAttribute("height", String(this.height));
            els.w = this.width; els.h = this.height;
        }
        const ov = this._overlay || this._makeOverlay();
        ov.noteDecide(decideMs);
        ov.show(data, v, this._edgeShift(v));
        this._renderSelChevrons(edges, selAntScale(data.inkPx), this.width, this.height);
        // Last in the host, so the chevrons paint over the ink and over the ant plane.
        const host = els.edgeLayer.parentNode;
        if (host && host.lastChild !== els.edgeLayer) host.appendChild(els.edgeLayer);
        return els;
    }

    /** The selection went away: the plane detaches and the clock stops, and the buffer is KEPT (FC1). */
    _dropSelOverlay() {
        if (this._overlay) this._overlay.hide();
        return super._dropSelOverlay();
    }

    /**
     * FC8's slot, built on the first decision and never at construction — a tool change must not
     * cost the plane's 10.48 MiB (FC1). It joins `this._layers`, so `setSize`, the store's
     * release walk and `destroy` reach it with no second copy of each.
     */
    _makeOverlay() {
        const ov = new OverlayLayer(this.host, {
            width: this.width, height: this.height, dpr: this.layer.dpr, perf: this.perf,
        });
        this._overlay = ov;
        this._layers.push(ov);
        this._armReducedMotion();
        return ov;
    }

    /**
     * The screen-edge spans are the CAMERA's own screen CSS px (`overlays._selEdges`) while the
     * ink is composed at the published view's snapped translation; this is the difference, which
     * the layer adds to the spans and not to the inset (§15.3 Q5 of the checkpoint). One array,
     * mutated in place (FC5).
     */
    _edgeShift(view) {
        const s = this._edgeShiftArr || (this._edgeShiftArr = [0, 0]);
        s[0] = 0; s[1] = 0;
        if (view && view.dpr > 0) {
            s[0] = view.tx / view.dpr - this.cam.inPanX;
            s[1] = view.ty / view.dpr - this.cam.inPanY;
        }
        return s;
    }

    /**
     * §15.3 Q9 (a): the renderer owns both media listeners — the resolution one above, and this,
     * because the ant clock is the layer's and a CSS rule cannot stop it. The chevrons keep the
     * stylesheet's own `prefers-reduced-motion` rule. jsdom has no `matchMedia`, so the guard is
     * what lets a raster engine construct there (G11 and G13 build one).
     */
    _armReducedMotion() {
        if (this._rmMq || typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
        let mq = null;
        try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (err) { return null; }
        if (!mq) return null;
        this._rmMq = mq;
        this._onReduced = () => { if (this._overlay) this._overlay.setReducedMotion(!!mq.matches); };
        if (mq.addEventListener) mq.addEventListener("change", this._onReduced);
        else if (mq.addListener) mq.addListener(this._onReduced);
        if (this._overlay) this._overlay.setReducedMotion(!!mq.matches);
        return mq;
    }

    _dropReducedMotion() {
        const mq = this._rmMq;
        if (mq && this._onReduced) {
            if (mq.removeEventListener) mq.removeEventListener("change", this._onReduced);
            else if (mq.removeListener) mq.removeListener(this._onReduced);
        }
        this._rmMq = null; this._onReduced = null;
    }

    /**
     * `Renderer.setSize(w, h)` carries no dpr and both layers take `(cssW, cssH, dpr)`, so this
     * is the one place that reads `devicePixelRatio` and §6.1's `matchMedia` change (D190).
     */
    setSize(w, h) {
        super.setSize(w, h);
        const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : this.layer.dpr;
        for (const l of this._layers) if (l) l.setSize(w, h, dpr);
        if (this.pyramid) this.store.setBudget(this.pyramid.budgetBytes());   // the budget follows the screen (A3 §4.5)
        this._armDpr(dpr);
    }

    /**
     * §6.1: a dpr change fires no `resize`, so the backing store would stay at the old ratio
     * until something else resized the canvas — the case is a window dragged to a second
     * monitor. `matchMedia("(resolution: Ndppx)")` matches ONE ratio, so the query is re-armed
     * at the new one each time it fires. jsdom has no `matchMedia`; the guard is what lets a
     * raster engine construct there at all.
     */
    _armDpr(dpr) {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
        if (this._dprMq && this._dprDpr === dpr) return this._dprMq;
        this._dropDpr();
        let mq = null;
        try { mq = window.matchMedia("(resolution: " + dpr + "dppx)"); } catch (err) { return null; }
        if (!mq) return null;
        this._dprDpr = dpr;
        this._dprMq = mq;
        this._onDpr = () => { if (this._dprMq === mq) this.setSize(this.width, this.height); };
        if (mq.addEventListener) mq.addEventListener("change", this._onDpr);
        else if (mq.addListener) mq.addListener(this._onDpr);
        return mq;
    }

    _dropDpr() {
        const mq = this._dprMq;
        if (mq && this._onDpr) {
            if (mq.removeEventListener) mq.removeEventListener("change", this._onDpr);
            else if (mq.removeListener) mq.removeListener(this._onDpr);
        }
        this._dprMq = null; this._onDpr = null; this._dprDpr = 0;
    }

    /** The `visibilitychange` release: the store's event drives the ONE list (§15.3 Q2 of 13:20). */
    _onStoreRelease(reason) {
        this._endPlane();
        for (const l of this._layers) if (l && l.onStoreRelease) l.onStoreRelease(reason);
        return reason;
    }

    // ---- the drag plane (PAPER-PLAN §10 S4) ----

    /** The engine reads this once, at construction: the drag's plate events are held only where the renderer draws the dragged ink itself. */
    get supportsDragPlane() { return true; }

    /** The engine's selection, as `{ key, ids }` of the current list or null; pulled each camera step. */
    setPlaneState(fn) { this._planeFn = fn; }

    /**
     * At a drag's start: aim the plane at the selection and post what it lacks. False when the
     * view is not in plates, or the selection's footprint is past the cap — that drag then
     * re-rasters each step as before (the engine takes no hold).
     */
    planeAccepts() {
        const v = this._view;
        // A drag begun while the last drop still lands: that plane draws the old list's move and is
        // done — end it and aim from the list the drop rendered (review major 1).
        if (this._plane.showing) this._endPlane();
        const ok = !!this.store && this._planeViewOk(v) && this._aimPlane(v);
        this._noPlaneDrag = !ok;           // a refused drag renders a step: no plane is aimed under it
        return ok;
    }

    /** The views a plane works in: plates, and a settled view (q "e" at the exact zoom). */
    _planeViewOk(v) { return !!v && (v.mode === "plates" || v.mode === "settle" || v.mode === "level" || v.mode === "rest"); }

    /** May a drag step skip the list build? Only while the plane draws the move. */
    dragLight() { return this._planeViewOk(this._view) && this._plane.layers.length > 0 && this._plane.state !== "land"; }

    /** Plates a plane may pin here (a test lowers it). */
    get planeCap() { return this._planeCap != null ? this._planeCap : (this.store && this.store.phone ? MOVE_PLANE_PLATES_PHONE : MOVE_PLANE_PLATES); }

    /** Keep the plane aimed at the current selection and view; returns whether it is accepted. */
    _aimPlane(v) {
        const pl = this._plane;
        if (this.forcePerStepDrag) { if (pl.tags.length) this._endPlane(); return false; }
        const gen = pl.gen, was = pl.tags.slice();
        const st = this._planeFn && this._planeViewOk(v) ? this._planeFn() : null;
        const ok = pl.aim(st, this._lastList, v, this.cfg, this.planeCap, this.layer.dpr, this._liveModel);
        const gone = was.filter((t) => pl.gen !== gen || !ok || !pl.tags.includes(t));   // a re-cut's renamed layers too
        if (gone.length) this._dropPlaneTags(gone);
        this.store.setPlanePins(ok ? pl.keys : null);
        if (!ok) return false;
        for (const lvl of pl.farLevels()) this._farList(pl, lvl, 0);
        if (this._postPlane(pl) && this.onPlaneAimed) this.onPlaneAimed();   // its pins may push the ladder out
        return true;
    }

    /**
     * A far plane level's own items (F122): the Stage's snapshot of its rectangle, read at idle a budget
     * at a time (built in the aim it was a 0.2–0.6 s frame after every select and every drop, TESTER-3).
     * The level is posted when its snapshot is in, packed at the snapshot's G; a re-cut level is forgotten.
     */
    _farList(pl, lvl, tries) {
        lvl.listPending = true;
        planeIdle(() => {
            if (this._destroyed || (pl.quick !== lvl && pl.main !== lvl)) return;
            const r = pl.coverOf(lvl);
            const snap = r && this.stage ? this.stage.snapshot(pl.frameId, r, FAR_LIST_BUDGET_MS) : null;
            if (snap === null && r && this.stage && tries < FAR_LIST_TRIES) { this._farList(pl, lvl, tries + 1); return; }
            lvl.list = snap ? snap.items() : null;
            lvl.G = snap ? snap.generation : null;
            lvl.listPending = false;
            if (!lvl.list) planeStats.farListFallbacks++;
            this._postPlane(pl);
        });
    }

    /** What the plane's layers lack, one post a layer (their cells are a list, not a range). */
    _postPlane(pl) {
        if (this.pyramid) return this._pyrPostPlane(pl);
        // A level without its own snapshot packs the live table at the pack's G (A2 §3.3), not the list it was aimed from.
        const reqs = pl.requests(this.stage ? null : pl.list);
        if (!reqs) return 0;
        let n = 0;
        const one = this._planeCell || (this._planeCell = { frameId: null, q: null, Zq: 1, i0: 0, i1: 0, j0: 0, j1: 0 });
        for (const r of reqs) {
            const misses = [];
            one.frameId = r.frameId; one.q = r.q; one.Zq = r.Zq;
            for (const [i, j] of r.cells) {
                // Fresh or in flight: nothing to ask, and no `want` (it evicts) — this runs every drag step.
                const k = plateKey(r.frameId, r.q, i, j), e = this.store.get(k);
                if ((e && !e.dead && this.store.isExact(e)) || this.store.inflight.has(k)) continue;
                one.i0 = one.i1 = i; one.j0 = one.j1 = j;
                for (const m of this.store.want(one, { pin: "none" }).misses) misses.push(m);
            }
            if (misses.length) { planeStats.requests++; n += this._post(r, misses, "plane"); }
        }
        return n;
    }

    /** A plane's plates, out of the store and the queue: they carry no zoom any other request reads. */
    _dropPlaneTags(tags) {
        if (this.pyramid) { this._pyrDropPlane(tags); return; }
        for (const q of tags) { if (!q) continue; dropQueued("plane", q); this.store.dropQuantum(q); }
    }

    /** Every camera step: follow the drag, close a landing, or keep the plane ready for the next drag. */
    _planeStep(v) {
        const pl = this._plane;
        const d = this._dragStateFn ? this._dragStateFn() : null;
        if (d && d.drag && pl.state !== "land") {
            // A plane that can no longer draw this drag — the camera left its frame, a release or the
            // sync path ended it — hands the drag back to a render a step (review major 2).
            if (!pl.layers.length || pl.frameId !== v.frameId || !this._planeViewOk(v)) this._losePlane();
            else {
                const s = d.drag.start, l = d.drag.last || s;
                pl.dragTo(l[0] - s[0], l[1] - s[1], this.layer.dpr);
                this._postPlane(pl);           // a plane plate a non-held event staled mid-drag, from the start list
            }
        } else if (pl.state === "land") {
            if (this._planeLanded(v)) this._endPlane();
        } else if (!d) this._planeIdle();
        // A level is drawn whole (the main one, else the quick one), else its selected layers alone
        // over the plates that still hold the ink where it was, else a stopgap rastered here.
        let lvl = pl.showing ? pl.pick(this.store) : null;
        if (this.pyramid && pl.state === "drag" && (!lvl || pl.partial) && this._pyrStopgap(pl)) lvl = pl.pick(this.store);
        else if (!this.pyramid && pl.state === "drag" && !lvl && !pl.stop) this._planeStopgap(pl);
        const whole = !!lvl && !pl.partial;
        if (pl.state === "drag") {
            if (!lvl && !pl.stop) planeStats.notReady++;
            else if (!whole) planeStats.partialSteps++;
            else if (lvl === pl.quick) planeStats.quickSteps++;
        }
        // While the plane draws the move, every other pack leaves the selection out: a plate re-rastered
        // mid-drag (a cut landing, a crossing's render) would bake it at its moved place (review minor 4).
        this._dragOmit = whole && pl.state === "drag" ? pl.selIds : null;
        if (this.pyramid) this.pyramid.setPlane(lvl ? this._pyrPlaneOf(pl, lvl) : null);
        else this.layer.setPlane(lvl || (pl.showing && pl.stop) ? pl : null);
    }

    /** The plane is lost under a live drag: the engine releases the hold once and the drag renders each step. */
    _losePlane() {
        this._endPlane();
        this._noPlaneDrag = true;
        this._dragOmit = null;
        planeStats.lost++;
        if (this.onPlaneLost) this.onPlaneLost();
    }

    /**
     * Nothing dragged: keep the plane ready for the next drag, aimed at the view once the camera has
     * held it PLANE_QUIET_MS — a settle's publish is such a view and arrives with no camera step, so
     * arrivals call this too. A plane aimed at a view the camera has left is freed at once.
     */
    _planeIdle() {
        const pl = this._plane, v = this._view;
        if (!this.store || !v || pl.showing || this._noPlaneDrag || this.forcePerStepDrag || (this._dragStateFn && this._dragStateFn())) return;
        // Quiet is the published view unchanged — a pan too: re-cutting the layers each pan step
        // posted 938 plates over a 60-step pan in Kobin's Chrome (a selection under a full-screen fill).
        const key = v.frameId + "|" + v.q + "|" + v.Zq + "|" + v.rev;
        if (key !== this._planeViewKey) { this._planeViewKey = key; this._planeViewAt = perfNow(); }
        const here = pl.tags.length > 0 && pl.frameId === v.frameId && pl.q === v.q && pl.Zq === v.Zq;
        // A settle about to publish its exact view would re-aim the plane a second time: wait for it. A bake's commits
        // re-aimed it at every cut step (1.0 s of a 8.3 s profile, PLAN §5.9 item 2): the scene's quiet too.
        const settling = () => (!this.pyramid && (this.layer.settleComing() || this.layer.holding())) || perfNow() - this._commitAt < PLANE_QUIET_MS;
        const holding = !this.pyramid && this.layer.holding();
        const quiet = perfNow() - this._planeViewAt >= PLANE_QUIET_MS && !settling();
        // At this zoom its plates stay (a pan only adds cells); a zoom's hold pins its own set, so the plane's go.
        if (!quiet && pl.tags.length && (!here || holding)) this._endPlane();
        // Aimed in a task of its own even when quiet, after the next frame is painted: inside a select it
        // was 0.29–0.41 s of a 1.2 s release-to-first-frame on a 29k-object lasso, and a 0 ms timer still
        // ran before the paint (TESTER-3, Chrome). On time, the view still the one this was armed for.
        if (this._planeTimer == null) {
            const fire = () => {
                this._planeTimer = null;
                const w = this._view;
                if (this._destroyed || !w || this._plane.showing || this._noPlaneDrag || (this._dragStateFn && this._dragStateFn())) return;
                if (w.frameId + "|" + w.q + "|" + w.Zq + "|" + w.rev === key && !settling()) this._aimPlane(w);
                else this._planeIdle();
            };
            if (!quiet) this._planeTimer = setTimeout(fire, PLANE_QUIET_MS);
            else if (typeof requestAnimationFrame === "function") this._planeTimer = requestAnimationFrame(() => { this._planeTimer = setTimeout(fire, 0); });
            else this._planeTimer = setTimeout(fire, 0);
        }
    }

    /** A landing is over when every cell it covers holds a fresh plate again, the camera left its quantum, or MOVE_HOLD_MS passed. */
    _planeLanded(v) {
        const pl = this._plane;
        if (!this._planeViewOk(v) || v.frameId !== pl.frameId || v.q !== pl.q || v.Zq !== pl.Zq) return true;
        if (perfNow() > pl.landUntil) { planeStats.landTimeouts++; return true; }
        const c = pl.landCells(v);
        if (!c) return true;
        for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) if (!this.layer.cellFresh(v, i, j)) return false;
        return true;
    }

    /** The plane is down: its plates leave the store, its pins go, and the next camera step aims a new one. */
    _endPlane() {
        const pl = this._plane;
        if (pl.state === "land") {
            const ms = perfNow() - pl.landAt;
            if (ms > planeStats.landMsMax) planeStats.landMsMax = ms;
        }
        if (this._landTimer != null) { clearTimeout(this._landTimer); this._landTimer = null; }
        if (this.store) { this._dropPlaneTags(pl.tags); this.store.setPlanePins(null); }
        pl._reset();
        if (this.layer) this.layer.setPlane(null);
    }

    /**
     * A drag ended (the engine's one exit). A drop LANDS the plane: it stays, clipped to the cells
     * whose own plate is not fresh yet, until they are. Any other end drops it: the document is
     * back where the plates already show it (a cancel), or the ink is gone (a delete).
     */
    endMove(why) {
        const pl = this._plane;
        this._noPlaneDrag = false;
        this._dragOmit = null;             // before the drop's render: its plates must hold the moved ink
        if (why === "drop" && pl.state === "drag" && pl.cur && !pl.partial) {
            pl.land(perfNow());
            this._landTimer = setTimeout(() => {
                this._landTimer = null;
                if (pl.state === "land") { this._endPlane(); this.layer.compose(); }
            }, MOVE_HOLD_MS + 20);
        } else if (pl.showing) this._endPlane();
    }

    /**
     * §10 item 19's lever: every job in flight is REPORTED, so `endJob` frees the store's keys
     * and `want` reads them as misses again. It frees no capacity — each abandoned job holds its
     * worker's slot until its own answer arrives, and `rasterWorkerReport().heldSlots` is how
     * many (D175).
     *
     * It is **not** on the render path, and that is a decision rather than an omission: at a
     * quantum change `PictureLayer._endHold` already calls `dropQuantum(pend.q)`, which refuses
     * every straggler on arrival — and freeing the keys there would have the next `want` re-post
     * plates the camera has just left. Teardown is the one
     * place where nothing will ever arrive to end them.
     *
     * @returns {number} jobs abandoned
     */
    _abandon(why) { return abandonInFlight(why); }

    destroy() {
        // Every job still in flight is reported so `endJob` runs for it; the store's keys would
        // otherwise stay in flight for ever and `want` would return them as in-flight rather
        // than as misses — a permanent hole with every suite green (rasterWorkerClient's header).
        if (this.queue) this.queue.clear();
        if (this._pyrOff) { this._pyrOff(); this._pyrOff = null; }
        if (this._commitOff) { this._commitOff(); this._commitOff = null; }
        if (this._pyrPrefetchTimer != null) { clearTimeout(this._pyrPrefetchTimer); this._pyrPrefetchTimer = null; }
        this._abandon("destroy");
        dropQueued("destroy");
        this._destroyed = true;
        if (this._liveTimer != null) { clearTimeout(this._liveTimer); this._liveTimer = null; }
        if (this._landTimer != null) { clearTimeout(this._landTimer); this._landTimer = null; }
        if (this._planeTimer != null) { clearTimeout(this._planeTimer); this._planeTimer = null; }
        for (const h of this._liveHeld) if (h.clip) h.clip.remove();
        this._liveHeld.length = 0;
        destroyRasterPool();
        this._dropDpr();
        this._dropReducedMotion();
        this.perf.detach();
        for (const l of this._layers) if (l && l.destroy) l.destroy();
        this._layers.length = 0;
        this._overlay = null;
        this._sync.rgba = null; this._sync.counts = null; this._sync.timings = null;
        super.destroy();
    }

    // ---- §5.1's promotion table ----

    /** §7.1, FC6: the origin is chosen at pen-down and nowhere else, so this is always false. */
    needsReorigin() { return false; }
    /** §7.2: the window chop is gone from the raster path. */
    needsWindowChop() { return false; }
    /**
     * §5.1's table says "kept, overridden to compare quantised fades". It is **false** instead,
     * and the argument is D201: the packer re-derives family membership on every pack
     * (`rasterPack.packJob`), and a QUANTISED fade cannot change inside a quantum — so a
     * promotion could only ever fire on a quantum change, where every plate is re-posted and
     * re-packed anyway. Inherited it reads `this._groups`, which is empty on this path, so it
     * would be false for the wrong reason.
     */
    needsFadeFlip() { return false; }

    /**
     * The pen-up handoff (PAPER-PLAN §10 S5): the live MODEL goes now, so every pack from here on
     * paints the stroke, and the live PATH stays until the plates under it are fresh (`LIVE_HOLD_MS`
     * at most). Held whatever the view's mode: the pen-up's render may leave the sync path, and a
     * path dropped then showed the stroke nowhere until its plates landed (F120); a frame that stays
     * sync releases it at once (`_releaseHeldLive`).
     */
    endLive() {
        const path = this._liveRoot, o = this._liveModel, v = this._view;   // the tail and its frozen chunks
        if (path && path.parent && o && o.pts && o.pts.length && this.store && v) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const p of o.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
            const h = (o.lwFrame || 0) / 2, now = perfNow(), og = this._origin();
            this._liveHeld.push({
                path, id: o.id, frameId: this.cam.frame, at: now, until: now + LIVE_HOLD_MS,
                box: { left: x0 - h, top: y0 - h, right: x1 + h, bottom: y1 + h },
                translucent: o.opacity != null && o.opacity < 1,
                og: { x: og.x, y: og.y }, clip: null, clipKey: null,
            });
            rasterStats.liveHolds++;
            this._live = null; this._liveRoot = null; this._liveModel = null;
            this._armLiveTimer();
            return;
        }
        super.endLive();
    }

    /** One timer for every held path: at the earliest limit, and re-armed while a path is still held. */
    _armLiveTimer() {
        if (this._liveTimer != null || !this._liveHeld.length) return;
        let until = Infinity;
        for (const h of this._liveHeld) if (h.until < until) until = h.until;
        this._liveTimer = setTimeout(() => {
            this._liveTimer = null;
            if (this._destroyed) return;
            if (this._releaseHeldLive(this._view)) this.update();
            this._armLiveTimer();
        }, Math.max(0, until - perfNow()) + 20);
    }

    /**
     * FC6: the one writer of the overlay origin, and a re-choice is a NEW object. The world group's
     * translation folds the origin in (`_syncWorldTransform`), so a re-choice re-syncs it here: left
     * to the next render, every live trail begun after a pan or a zoom was drawn off by the origin's
     * move — off-screen — until pen-up (Kobin 2026-09-22, "erasers are not showing up until pen-up").
     */
    addLive(o) {
        const c = this._viewCenter();
        if (c.x !== this._ovOrigin.x || c.y !== this._ovOrigin.y) {
            this._ovOrigin = c;
            this._syncWorldTransform(this._view);
            // A held path's anchors are relative to the origin it was drawn at: re-anchored, it stays
            // put; left, the next pen-down after a zoom moved the last stroke (F131, 28 px measured).
            for (const h of this._liveHeld) h.path.translation.set(h.og.x - c.x, h.og.y - c.y);
        }
        return super.addLive(o);
    }

    /**
     * §2.5 seam 3: one persistent overlay scene for the live stroke, whatever the level. Scene
     * retention exists to reuse SVG ink subtrees and there is no SVG ink here.
     *
     * `Renderer.clear()` — every `loadDrawing` and scene jump — detaches every root from the
     * world, empties `_scenes` and detaches each group, but leaves `_ovScene` set; keyed on that
     * field alone, the live stroke was built into an orphaned group Two never drew, on every
     * loaded drawing (the testing round's first finding, D271). The key is `_scenes` and the
     * root is re-attached, with its detached groups forgotten.
     */
    _activateLevel() {
        let sc = this._scenes.get("_ov");
        if (!sc) {
            sc = this._ovScene || { root: new Two.Group(), groups: new Map(), order: [], seq: 0, origin: this._ovOrigin };
            sc.groups.clear(); sc.order.length = 0;
            this._ovScene = sc;
            this._scenes.set("_ov", sc);
            this.world.add(sc.root);
        }
        this._level = "_ov"; this._activeRoot = sc.root;
        this._groups = sc.groups; this._order = sc.order;
        return sc;
    }

    /** §2.5 seam 1's other half: the world group takes `d` from the view and never from the camera (FC2). */
    _syncWorldTransform(view) {
        const v = view || this._view;
        if (!v || !(v.dpr > 0)) { super._syncWorldTransform(); return; }
        const o = this._origin();
        // The composite maps a frame point to `p·k + tx` in DEVICE px; the SVG overlay is in CSS
        // px, and its anchors are origin-relative, so the origin is folded back in here exactly
        // as `Renderer._syncWorldTransform` folds it into the camera's own pan.
        this.world.scale = v.k / v.dpr;
        this.world.translation.x = (v.tx + o.x * v.k) / v.dpr;
        this.world.translation.y = (v.ty + o.y * v.k) / v.dpr;
    }

    /**
     * §8.1's `ovl.tail` (D237's third phase, §15.3's 2026-09-22 Q1): the SVG world transform
     * and the overlay tail, which run on every raster frame and had no slot. Both paths reach
     * the tail here — `render` calls this and `Renderer.syncCameraOnly` calls it too — so one
     * bracket times both and neither double-counts.
     */
    syncWorld(view) {
        const t = perfNow();
        try { return super.syncWorld(view); } finally { this._add(SLOT.tail, perfNow() - t); }
    }

    // ---- §5.1's render path ----

    /**
     * §8.1's row for a full frame, opened by the ENGINE before `_buildList` so the list build is
     * inside `mainMs` (§15.3 Stage 5b Q2). `render` finds it open and does not open a second one;
     * a caller that renders without this — every suite here — gets the row opened in `render`.
     */
    beginRender() { this._beginFrame("render"); this._rowOpen = true; }

    /** The engine's own `_buildList`, timed by the engine, charged to §8.1's `eng.list`. */
    noteList(ms) { this._add(SLOT.list, ms); }

    /**
     * Steps 1–7 of §5.1: the Stage's items (A2 §3; `list` only for a renderer without one). A change is
     * already the Stage's dirt, applied when it committed (A2 §2.5).
     */
    render(list, frame) {
        if (!this._rowOpen) this._beginFrame("render");
        this._activateLevel(frame);
        this._lastList = this.stage ? this._sceneList() : (list || []);
        this._noteFatPending(this._lastList);
        const view = this._frameStep(this._lastList);
        this.syncWorld(view);                          // step 7, plus the SVG world transform
        this._hasFat = this._lastList.some((o) => o.type === "stroke" && o.lwFrame * this.cam.inScale > this._gatePx() * 0.5);
        this._endFrame();
        return false;                                  // nothing to reorder: there are no ink groups
    }

    /**
     * §5.1's other half, and the common one: steps 1, 3, 4, 5 and 6 and nothing else — no list
     * build, no overlay rebuild. `super.syncCameraOnly(view)` is the SVG overlay's own transform.
     */
    syncCameraOnly() {
        this._beginFrame("camera");
        if (this.stage) {
            const list = this._sceneList();
            if (list !== this._lastList) { this._lastList = list; this._noteFatPending(list); }
        }
        const view = this._frameStep(this._lastList);
        super.syncCameraOnly(view);
        this._endFrame();
    }

    /**
     * One camera step: the mapping, the dead quantum's drop, the plates, the compose and the
     * posts. Returns the published view, which is the object `_renderOverlays` is handed (FC2).
     */
    _frameStep(list) {
        if (this.pyramid) return this._pyrStep();
        const layer = this.layer;
        this._postQ.length = 0;
        const t0 = perfNow();
        const chords = this.store ? visibleChords(list, this.cam.frameWindow(0), this.cam.inScale * layer.dpr,
            this.cfg, CHORD_CAP(layer.syncBudget), this._liveModel) : 0;
        this._add(SLOT.cull, perfNow() - t0);
        // `frameFor` may post the incoming quantum's misses through `onPlates`, and it add-pins
        // them; the renderer's own "replace" want must come after or it discards those pins
        // every frame (§10 item 29, D178).
        // `frameFor` can POST inside itself (the settle's and the incoming quantum's misses go
        // out through `onPlates`), and a post is already timed in `eng.pack` and `xfer.out`, so
        // its cost is subtracted here or §8.4 rule 2's sum exceeds the task it is measured in.
        this._postMs = 0;
        const tv = perfNow();
        const view = layer.frameFor(this.cam, chords);
        this._add(SLOT.view, perfNow() - tv - this._postMs);   // camera → view (D237's first phase)
        this._view = view;
        this.perf.noteView(view);
        this._dropDead(view);
        if (view.mode === "sync") {
            if (this._dragStateFn && this._dragStateFn()) this._losePlane();
            else if (this._plane.state !== "idle" || this._plane.tags.length) this._endPlane();
            this._renderSync(list, view);
            this._releaseHeldLive(view);                   // the sync raster holds the stroke: nothing to wait for
            layer.noteSyncCost(this._sync.coreMs);         // D272: the switch reads the core's measure, not the estimate
            return view;
        }
        if (!this.store) return view;
        const tw = perfNow();
        const got = this.store.want(view);             // steps 3 and 4: the published range
        this._add(SLOT.lookup, perfNow() - tw);        // the hit set (D237's second phase)
        this._planeStep(view);
        const t1 = perfNow();
        layer.compose(got.hits);                       // step 5
        this.perf.noteCompose(perfNow() - t1, got.hits.length, 1);
        this._releaseHeldLive(view);
        if (got.misses.length) this._post(view, got.misses, "view");   // step 6
        return view;
    }

    /** The idle fitter's input: the widest lazily-unfitted fat stroke on screen (`needsFatFlip`). */
    _noteFatPending(list) {
        let w = 0;
        for (const o of list) if (this._strokeMode(o) === "pending" && o.lwFrame > w) w = o.lwFrame;
        this._pendingFatLw = w;
        return w;
    }

    _beginFrame(kind) {
        this.frameSeq = this._nextSeq ? this._nextSeq() : this.frameSeq + 1;
        if (kind === "render") rasterStats.frames++; else rasterStats.cameraFrames++;
        this._openRow(this.frameSeq, kind);
    }

    _endFrame() { this._rowOpen = false; this._closeRow(); }

    /** Every row this module opens goes through these two, so `_post` can tell whether one is live. */
    _openRow(seq, kind, backMs = 0) { this._rowLive = true; this.perf.beginFrame(seq, kind, backMs); }
    _closeRow() { this._rowLive = false; this.perf.endFrame(); }

    /**
     * One ENGINE/BROWSER timer. `rasterPerf.add` takes a slot INDEX out of its own `T` map; a
     * recorder without a `T` takes §8.1's name, which is what the suites' double does.
     */
    _add(name, ms) { const T = this.perf.T; this.perf.add(T ? T[name] : name, ms); }

    // ---- the picture pyramid (A3 §1–§4): the scene's items, packed, measured, posted and landed for it ----

    /** The Stage's items packs paint — a stroke pending its shape is skipped (PLAN §1.5) — one array a table version and G. */
    _sceneList() {
        const src = this.stage.items(), G = this.stage.generation;
        if (src !== this._sceneSrc || G !== this._sceneArrG) {
            const out = [];
            for (const it of src) if (!it.pending) out.push(it);
            this._sceneArr = out; this._sceneSrc = src; this._sceneArrG = G;
        }
        return this._sceneArr;
    }

    /** A job id ended in the store: for every id a strip was begun with, landed or not. */
    _endJob(jobId) {
        if (jobId == null) return 0;
        rasterStats.jobsEnded++;
        return this.store.endJob(jobId);
    }

    /** The store, the pyramid (the layer) and the queue (A3 §1, §4): this renderer packs, measures, posts and lands for them (FC3). */
    _pyrBuild(container, dpr, opts) {
        const store = this.store = new PyramidStore({
            fresh: this.stage, cfg: this.cfg, wDev: Math.round(this.width * dpr), hDev: Math.round(this.height * dpr),
        });
        const pyr = this.pyramid = new PicturePyramid(container, {
            store, stage: this.stage, lm: this.stage.lm, cfg: this.cfg, width: this.width, height: this.height, dpr,
            paper: this.paper, makeCanvas: opts.makeCanvas, context: opts.context,
            onRequest: (jobs) => this.queue.push(jobs),
            pack: (job) => this._pyrPack(job, null, null),
            measure: (job) => this._pyrMeasure(job),
            onSample: (s) => pyr.calibrate(s),
        });
        const base = opts.pool || rasterPool;
        const pool = { size: () => base.size(), free: () => base.free(), submit: (st) => this._pyrSubmit(st, base) };
        pyr.gens.plane = 1;                              // the drag plane's purpose: bumped when its layers go
        this._pyrPlaneAsked = new Map();                 // plane key -> the G it was asked at
        this.queue = new JobQueue({ pool, clock: perfNow, store, gens: pyr.gens, onDrop: () => { pyr.refresh(); this._pyrPlaneAsked.clear(); } });
        this.layer = pyr;
        this._pyrMot = { t: 0, k: 0, tx: 0, ty: 0, frame: null, moving: false };
        this._pyrPrefetchKey = null;
        // A shape lands in a commit: its group opens there, before any frame's patch step could publish its plates
        // while the path is still up (A3 §3.6).
        this._pyrOff = this.stage.onCommit(() => { if (!this._destroyed && this._liveHeld.length && this._view) this._pyrLive(this._view); });
    }

    /** A lever changed (A3 §8): the budget is one eviction pass; a step change is the next `frameFor`'s. */
    onLevers() { if (this.pyramid) this.store.setBudget(this.pyramid.budgetBytes()); }

    /**
     * One camera step on the pyramid: the view (and in it the rest render, the patches and the view's requests),
     * the queue's frame, the compose, the pen-up groups, and the prefetch once the camera is still.
     */
    _pyrStep() {
        const pyr = this.pyramid, q = this.queue;
        const tv = perfNow();
        const view = pyr.frameFor(this.cam);
        this._add(SLOT.view, perfNow() - tv);
        this._view = view;
        this.perf.noteView(view);
        q.setMotion(this._pyrMotion(view));
        q.frame();
        q.pump();
        this._planeStep(view);
        const t1 = perfNow();
        const P = pyr.compose();
        this.perf.noteCompose(perfNow() - t1, P.images, 1);
        this._pyrLive(view);
        if (!this._pyrMot.moving) this._pyrPrefetch(view);
        return view;
    }

    /** The queue's motion (A3 §4.4): moving iff the published affine changed since the last step, and its velocity. */
    _pyrMotion(v) {
        const m = this._pyrMot, t = perfNow(), pyr = this.pyramid;
        const same = m.frame === v.frameId && m.k > 0;
        const moving = same && (v.k !== m.k || v.tx !== m.tx || v.ty !== m.ty);
        const dt = Math.max(1, t - m.t);
        const vel = moving ? { px: [(v.tx - m.tx) / dt, (v.ty - m.ty) / dt], zoom: Math.log2(v.k / m.k) / dt } : { px: [0, 0], zoom: 0 };
        m.t = t; m.k = v.k; m.tx = v.tx; m.ty = v.ty; m.frame = v.frameId; m.moving = moving;
        return {
            moving, vel, attention: null, at: t,
            view: { frameId: v.frameId, level: v.level, S: v.S, Z: v.Z, k: v.k, tx: v.tx, ty: v.ty, wDev: pyr.wDev, hDev: pyr.hDev, sigmaMin: pyr.sigmaMin },
        };
    }

    /**
     * At idle — the camera still and nothing of the view's or a patch's queued or in flight — the prefetch, once a view
     * revision and a generation: a change stales the cached coarser levels, and a zoom's stand-in must be fresh
     * (decision 2: blurrier, never older).
     */
    _pyrPrefetch(v) {
        if (!v || v.frameId == null) return;
        const q = this.queue, r = q.report(), gens = this.pyramid.gens;
        for (let p = 0; p < PRIO.prefetch; p++) if (r.queued[p] || r.inFlight[p]) return;
        const key = v.rev + ":" + gens.prefetch + ":" + this.stage.generation;
        if (this._pyrPrefetchKey === key) return;
        // At idle means the scene too: a bake commits every few frames, and a plan a commit re-rendered the coarser
        // levels each step (P5). The plan waits for the rest's quiet after the last commit.
        const quiet = this.cfg.prefetchQuietMs != null ? this.cfg.prefetchQuietMs : EST_DEFAULTS.restQuietMs;
        const since = perfNow() - this._commitAt;
        if (since < quiet) {
            if (this._pyrPrefetchTimer == null) {
                this._pyrPrefetchTimer = setTimeout(() => {
                    this._pyrPrefetchTimer = null;
                    if (!this._destroyed && !this._pyrMot.moving) this._pyrPrefetch(this._view);
                }, quiet - since + 1);
            }
            return;
        }
        // A new plan supersedes the queued one: its strips drop at dispatch by generation (a bake's commits re-plan
        // each step, and the queue grew by a plan a step without this).
        gens.prefetch++;
        this._pyrPrefetchKey = v.rev + ":" + gens.prefetch + ":" + this.stage.generation;
        const jobs = prefetchPlan(v, this.stage, this.store, { ...this.cfg, atRest: v.mode === "rest", gens });
        if (!jobs.length) return;
        this.pyramid.setFar(farKeysOf(jobs));
        q.push(jobs);
        q.pump();
    }

    /** The table window's margin: four view cells, so the near prefetch's ℓv − 1 packs from the camera's table (A3 §4.2). */
    listMargin(inScale) {
        const pyr = this.pyramid, S = this._view ? this._view.S : LEVEL_STEP;
        return 4 * PLATE_PX / zOf(levelFor(inScale * pyr.dpr, S, null, pyr.sigmaMin), S);
    }

    /** A table's items packs paint (a stroke pending its shape is skipped, PLAN §1.5). */
    _tableList(tab) {
        // One list a table: the pack's prepass (its families, every item's entry) is memoised on the list's identity.
        if (!this._tabLists) this._tabLists = new WeakMap();
        let out = this._tabLists.get(tab);
        if (!out) {
            out = [];
            for (const it of tab.items()) if (!it.pending) out.push(it);
            this._tabLists.set(tab, out);
        }
        return out;
    }

    /**
     * A typed job packed (A2 §3.1): from its own table (the prefetch's off-camera snapshot) at that table's G, else
     * from the Stage at its G, keeping only the cells the camera's table covers (A3 §4.2: the plan asks for no others;
     * one whose tiles left since is refused here and asked for again once covered). `beginJob` tracks them from here.
     * `jobId` null: the inline executor's.
     */
    _pyrPack(job, jobId, bufPool) {
        const tab = job.table || null;
        const list = tab ? this._tableList(tab) : this._sceneList();
        const G = tab ? tab.generation : this.stage.generation;
        let cells = job.cells, clips = job.clips || null;
        if (!tab) {
            const keep = [], refused = [];
            for (let k = 0; k < cells.length; k++) {
                const c = cells[k], u = PLATE_PX / c.Z;
                if (this.stage.covers(c.frame, { left: c.i * u, top: c.j * u, right: (c.i + 1) * u, bottom: (c.j + 1) * u })) keep.push(k);
                else refused.push(c);
            }
            if (refused.length) {
                rasterStats.refusedCoverPlates += refused.length;
                this.pyramid.unask(refused);
                for (const c of refused) this._pyrPlaneAsked.delete(c.key);
                cells = keep.map((k) => cells[k]); if (clips) clips = keep.map((k) => clips[k]);
            }
            if (!cells.length) { rasterStats.refusedCover++; return null; }
        }
        const plates = new Int32Array(cells.length * 2);
        for (let k = 0; k < cells.length; k++) { plates[k * 2] = cells[k].i; plates[k * 2 + 1] = cells[k].j; }
        if (jobId != null) this.store.beginJob(jobId, cells, G);
        const t0 = perfNow();
        // A plane layer packs its own members (`only`, transparent) or everything but them (`omit`); any other pack leaves
        // the selection out while the plane draws the move.
        const packed = packJob(list, {
            plates, Zq: job.Z, dpr: this.pyramid.dpr, cfg: this.cfg, paper: job.paper || this._paperRgb, G, jobId, frameSeq: this.frameSeq,
            pool: bufPool, live: this._liveModel, only: job.only || null, omit: job.omit || (job.only ? null : this._dragOmit),
        });
        if (clips) {
            const cl = new Int32Array(clips.length * 4);
            for (let k = 0; k < clips.length; k++) cl.set(clips[k], k * 4);
            packed.clips = cl;
        }
        job.packedCells = cells; job.packedClips = clips;
        const ms = perfNow() - t0;
        this._packMs += ms;
        this._add(SLOT.pack, ms);
        return packed;
    }

    /**
     * The estimate's inputs (A3 §2.2, §3.3) over a job's cells at `job.Z`, or their clips: E the visible chords
     * (capped past any inline budget), A the item box pixels inside them, U the union items' rows inside them,
     * P the cells an item meets.
     */
    _pyrMeasure(job) {
        const list = job.table ? this._tableList(job.table) : this._sceneList();
        const Z = job.Z, u = PLATE_PX / Z, n = job.cells.length;
        const rects = new Array(n);
        let win = null;
        for (let k = 0; k < n; k++) {
            const c = job.cells[k], cl = job.clips && job.clips[k];
            const r = cl ? { left: (c.i * PLATE_PX + cl[0]) / Z, top: (c.j * PLATE_PX + cl[1]) / Z, right: (c.i * PLATE_PX + cl[2]) / Z, bottom: (c.j * PLATE_PX + cl[3]) / Z }
                : { left: c.i * u, top: c.j * u, right: (c.i + 1) * u, bottom: (c.j + 1) * u };
            rects[k] = r;
            win = win ? { left: Math.min(win.left, r.left), top: Math.min(win.top, r.top), right: Math.max(win.right, r.right), bottom: Math.max(win.bottom, r.bottom) } : { ...r };
        }
        if (!win) return { E: 0, A: 0, U: 0, P: 0 };
        const E = visibleChords(list, win, Z, this.cfg, MEASURE_CHORD_CAP, this._liveModel);
        const hit = new Uint8Array(n);
        let A = 0, U = 0;
        for (const o of list) {
            if (o === this._liveModel || outsideWin(o, win, this._liveModel)) continue;
            const b = itemBox(o, this.cfg);
            if (!b) continue;
            const r0 = o.res, x0 = b[0] + (r0 ? r0[0] : 0), y0 = b[1] + (r0 ? r0[1] : 0), x1 = b[2] + (r0 ? r0[0] : 0), y1 = b[3] + (r0 ? r0[1] : 0);
            if (x1 < win.left || x0 > win.right || y1 < win.top || y0 > win.bottom) continue;
            const union = entryFor(o, this.cfg).union;
            for (let k = 0; k < n; k++) {
                const r = rects[k], w = Math.min(x1, r.right) - Math.max(x0, r.left), h = Math.min(y1, r.bottom) - Math.max(y0, r.top);
                if (w <= 0 || h <= 0) continue;
                hit[k] = 1;
                A += w * h * Z * Z;
                if (union) U += h * Z;
            }
        }
        let P = 0;
        for (let k = 0; k < n; k++) P += hit[k];
        return { E, A, U, P };
    }

    /** The queue's pool face over the client's (A3 §4.4): a strip packed and posted now, or refused; a cut posts its own entry. */
    _pyrSubmit(st, pool) {
        if (st.entry) return pool.submit(st.entry);
        const plates = new Int32Array(st.cells.length * 2);
        for (let k = 0; k < st.cells.length; k++) { plates[k * 2] = st.cells[k].i; plates[k * 2 + 1] = st.cells[k].j; }
        return pool.submit({
            req: {
                prio: st.prio, pack: (_, jobId, bufPool) => this._pyrPack(st, jobId, bufPool), onResult: (res, info) => this._pyrResult(st, res, info),
                onDrop: (d) => this._pyrDrop(st, d), onRequeue: (jobId) => this._pyrRequeue(st, jobId),
            },
            plates,
        });
    }

    /** The pool failed under a strip (a worker's error or silence, RW-1): its id ended, the strip back at the head of its priority (H7). */
    _pyrRequeue(st, jobId) {
        this._endJob(jobId);
        if (this.queue.requeue(st.id)) Promise.resolve().then(() => { if (!this._destroyed) this.queue.pump(); });
    }

    /**
     * A strip's result: every plate a record for `onResult` — a whole plate's pixels made a bitmap first where the
     * scope can, a clip's kept as the patch — then `endJob`, the slot, the calibration sample and one compose.
     */
    _pyrResult(st, res, info) {
        const seq = info && info.frameSeq != null ? info.frameSeq : this.frameSeq;
        this._openRow(seq, "arrival", info ? info.recvMs : 0);
        try {
            this.perf.noteJob(info, res);
            const cells = st.packedCells || st.cells, clips = st.packedClips || null, n = res.plates.length / 2;
            const recs = [];
            let wait = false;
            for (let p = 0; p < n; p++) {
                const c = cells[p], px = res.pixels ? res.pixels[p] : null, bm = res.bitmaps ? res.bitmaps[p] : null;
                const clip = clips ? clips[p] : null;
                const whole = !clip || (clip[0] === 0 && clip[1] === 0 && clip[2] === PLATE_PX && clip[3] === PLATE_PX);
                if (px && whole) wait = true;
                recs.push({ ...c, G: res.G, bitmap: bm, pixels: px, jobId: res.jobId, clip: whole ? null : clip, bytes: whole && (bm || px) ? PLATE_PX * PLATE_PX * 4 : 0 });
            }
            if (!wait) { this._pyrLand(st, recs, res, info); return null; }
            rasterStats.bitmapWaits++;
            return Promise.all(recs.map((r) => (r.pixels && !r.clip ? plateBitmap(r.pixels) : null)))
                .then((bms) => { for (let p = 0; p < recs.length; p++) if (bms[p]) { recs[p].bitmap = bms[p]; recs[p].pixels = null; } }, () => null)
                .then(() => {
                    this._openRow(seq, "arrival");
                    try { this._pyrLand(st, recs, res, info); } finally { this._closeRow(); }
                });
        } finally { this._closeRow(); }
    }

    _pyrLand(st, recs, res, info) {
        if (this._destroyed) { this.store.endJob(res.jobId); return; }
        const pl = this._plane;
        for (const r of recs) this.pyramid.onResult(r);   // a dropped layer's late plate: the store refuses it (`dropWhere` marked its job)
        rasterStats.batches++; rasterStats.batchPlates += recs.length;
        this._endJob(res.jobId);
        this.queue.done(st.id);                         // dispatch to landing: the velocity rule's arrival estimate
        this.pyramid.calibrate(sampleOf(res, st.est && st.est.U));
        this.queue.pump();
        // The plane composes on its own plates' arrival, and a landing ends on the last fresh plate under it.
        if (pl.showing) {
            if (pl.state === "land" && this._planeLanded(this._view)) this._endPlane();
            else if (pl.state === "drag" && st.kind === "plane") {
                const lvl = pl.pick(this.store);
                this._dragOmit = lvl && !pl.partial ? pl.selIds : null;
                this.pyramid.setPlane(lvl ? this._pyrPlaneOf(pl, lvl) : null);
            }
        } else this._planeIdle();
        if (this.layer.deferCompose) this.layer.deferCompose(); else this.pyramid.compose();
        if (!this._pyrMot.moving) this._pyrPrefetch(this._view);
    }

    /** The plane as the pyramid draws it (A3 §6): its drawn level's Zp and layers; the state, the partial flag and the offset live. */
    _pyrPlaneOf(pl, lvl) {
        if (!this._pyrPlane) {
            this._pyrPlane = {
                get showing() { return pl.showing; }, get state() { return pl.state; }, get partial() { return pl.partial; },
                get frameId() { return pl.frameId; }, get off() { return pl.off; }, Zp: 1, layers: null,
            };
        }
        this._pyrPlane.Zp = lvl.pZq; this._pyrPlane.layers = lvl.layers;
        return this._pyrPlane;
    }

    /** What the plane's layers lack, as typed jobs at priority 2 (A3 §4.1) under the plane's purpose generation. */
    _pyrPostPlane(pl) {
        const reqs = pl.requests(null);
        if (!reqs) return 0;
        const jobs = [];
        for (const r of reqs) {
            const cells = [];
            for (const [i, j] of r.cells) {
                const c = planeCell(r.frameId, r.Zq, r.q, i, j), g0 = this._pyrPlaneAsked.get(c.key);
                if ((g0 == null || g0 < this.store.fresh.dirtySince(c.key)) && this.store.wants(c.key) && (r.list || this.pyramid.covered(c))) {
                    cells.push(c); this._pyrPlaneAsked.set(c.key, this.stage.generation);
                }
            }
            if (!cells.length) continue;
            jobs.push({
                kind: "plane", prio: PRIO.plane, frame: r.frameId, level: null, S: null, Z: r.Zq, cells, clips: null, purpose: "plane",
                gen: this.pyramid.gens.plane, attention: null, group: null, table: r.list ? { items: () => r.list, generation: r.G } : null,
                only: r.only || null, omit: r.omit || null, paper: r.paper || null,
            });
        }
        if (!jobs.length) return 0;
        planeStats.requests++;
        this.queue.push(jobs);
        this.queue.pump();
        return jobs.length;
    }

    /** A plane's layers gone: their records out of the store, their queued strips out by generation. */
    _pyrDropPlane(tags) {
        const t = new Set(tags.filter(Boolean));
        this._pyrPlaneAsked.clear();
        if (!t.size) return;
        this.store.dropWhere((r) => r.kind === "plane" && t.has(r.tag));
        this.pyramid.gens.plane++;
    }

    /**
     * No whole level at a drag step (A3 §6, H4): a small selection's SEL layers of the quick level (the main one's), with
     * BELOW and OVER over its start footprint, rendered on this thread now and landed as plane plates. True when it ran.
     */
    _pyrStopgap(pl) {
        const lvl = pl.quick || pl.main;
        if (!lvl || !pl.selIds || !pl.selIds.size || pl.selIds.size > STOPGAP_OBJECTS) return false;
        const foot = new Set();
        for (const L of lvl.layers) if (L.kind === "sel") for (const [i, j] of L.cells) foot.add(i + "," + j);
        const jobs = [];
        let n = 0;
        for (const L of lvl.layers) {
            const cells = [];
            for (const [i, j] of L.cells) {
                if (L.kind !== "sel" && !foot.has(i + "," + j)) continue;
                const c = planeCell(pl.frameId, lvl.pZq, L.tag, i, j), e = this.store.get(c.key);
                if (!e || !this.store.exact(e)) cells.push(c);
            }
            if (!cells.length) continue;
            n += cells.length;
            jobs.push({ kind: "plane", frame: pl.frameId, Z: lvl.pZq, cells, clips: null, table: lvl.list ? { items: () => lvl.list, generation: lvl.G } : null,
                only: L.kind === "below" ? null : L.ids, omit: L.kind === "below" ? L.omit : null, paper: L.kind === "below" ? null : [0, 0, 0, 0] });
        }
        if (!n || n > STOPGAP_PLATES) return false;
        const t0 = perfNow();
        for (const job of jobs) this.pyramid.renderNow(job);
        const ms = perfNow() - t0;
        planeStats.stopgaps++;
        if (ms > planeStats.stopgapMsMax) planeStats.stopgapMsMax = ms;
        return true;
    }

    /** A strip that will not land: its id ended, its slot freed, the view's cells asked for again at the next step. */
    _pyrDrop(st, d) {
        rasterStats.dropsHandled++;
        this.perf.noteDrop(st, d);
        if (d && d.jobId != null) this._endJob(d.jobId);
        if (!d || d.before) return;                 // inside the queue's own pump: it counts the refusal itself
        this.queue.done(st.id, false);              // a failure: no arrival sample
        this.pyramid.refresh();
        if (!this._destroyed) this.queue.pump();
    }

    /**
     * The pen-up rule (PLAN §1.5, A3 §3.6): a held path stays while its stroke is pending — no limit (PLAN §5.4 Q2);
     * once its shape has landed, one group commit publishes the drawn cells under its box and takes the path down
     * in the same task. An undo or a cancel (the stroke left the table) or the camera leaving its frame takes it down
     * now; a group past LIVE_HOLD_MS commits what it has (the compose checks). Run at every Stage commit and every step.
     */
    _pyrLive(v) {
        const held = this._liveHeld;
        if (!held.length || !v) return 0;
        const now = perfNow();
        let n = 0, late = false;
        for (let k = held.length - 1; k >= 0; k--) {
            const h = held[k];
            if (h.group) { if (now > h.until) late = true; continue; }
            const items = this.stage.itemsOf(h.id);
            if (!items.length || String(h.frameId) !== String(v.frameId)) { this._pyrTakeDown(h, false); n++; continue; }
            if (items.some((it) => it.pending)) { h.until = now + 250; continue; }
            h.group = "live:" + h.id;
            h.until = now + LIVE_HOLD_MS + 20;
            this.pyramid.groupCommit(h.group, h.box, () => { if (this._pyrTakeDown(h, true)) this.update(); });
        }
        if (late) this.pyramid.compose();
        return n;
    }

    /** One held path taken down (`handoff`: its plates published in this task); false when it was already gone. */
    _pyrTakeDown(h, handoff) {
        const at = this._liveHeld.indexOf(h);
        if (at < 0) return false;
        if (h.path.parent) h.path.parent.remove(h.path);
        const ms = perfNow() - h.at;
        if (ms > rasterStats.liveHoldMsMax) rasterStats.liveHoldMsMax = ms;
        if (handoff) rasterStats.liveHandoffs++;
        this._liveHeld.splice(at, 1);
        if (!this._liveHeld.length && this._liveTimer != null) { clearTimeout(this._liveTimer); this._liveTimer = null; }
        return true;
    }

    // ---- off camera: the snapshot (S1) ----

    /**
     * SCENES-PLAN S1. ONE plate of an arbitrary `(frame, rect)`, posted as an ordinary worker
     * job and answered straight to the caller — the Scenes panel's thumbnails and, through the
     * same call, anything else that wants a picture the camera is not at.
     *
     * It touches `PlateStore` NOWHERE: no `beginJob`, no `put`, no cache entry.
     * Its `q` is a per-call string that carries no zoom of its own, so a cached plate under it
     * would come back as a hit at a zoom it was never rastered at — §6.5's rule for `"s"`. The
     * per-call number matters for a second reason: `submitPlates` drops every queued strip at
     * the SAME `q` from an older frame, so thirty snapshots sharing one key would drop each
     * other's work.
     *
     * The rect lands on the plate's own origin because the WORLD is moved, not the grid:
     * `packJob`'s `offset` is folded into each item's `res` at pack time, which the core already
     * applies per item. One plate, and the crop is a 1:1 `drawImage`.
     *
     * @param {object} o
     * @param {object[]} o.list the items to draw (`stage.snapshot(frame, rect)`'s)
     * @param {string|number} o.frameId the frame, for the job's own key
     * @param {number} o.Zq device px per frame unit — `fitView`'s exact scale, not a quantum
     * @param {[number, number]} o.offset the pack-time translation, in FRAME units
     * @param {AbortSignal} [o.signal] the panel closing
     * @returns {Promise<ImageBitmap|{pixels:Uint8ClampedArray,width:number,height:number}|null>}
     *          null for an empty plate (nothing to draw); the raw record where the scope has no
     *          `createImageBitmap` (jsdom)
     */
    snapshotJob(o) {
        const q = "t" + (++this._snapSeq);
        rasterStats.snapshots++;
        // §4.6's bound, checked on the translation itself: the offset is added to every
        // coordinate at pack time, so one at or past the bound guarantees the breach
        // `packStats.overBound` would only log per item, after the work was done.
        if (!(Math.abs(o.offset[0]) < COORD_BOUND && Math.abs(o.offset[1]) < COORD_BOUND)) {
            rasterStats.snapshotOverBound++;
            return Promise.reject(new Error("over the coordinate bound"));
        }
        return new Promise((resolve, reject) => {
            const aborted = () => !!(o.signal && o.signal.aborted);
            let settled = false;
            const done = (v) => { if (!settled) { settled = true; resolve(v); } };
            const fail = (why) => { if (!settled) { settled = true; reject(new Error(why)); } };
            const req = {
                frameSeq: this.frameSeq, q, Zq: o.Zq, frameId: o.frameId, mode: "snap", prio: 4,
                why: "snapshot", plates: Int32Array.of(0, 0),
                pack: (strip, jobId, pool) => {
                    if (aborted()) return null;                 // → onDrop("empty"), and the reject
                    // A dispatch outside a camera frame has no row, and an `_add` without one is
                    // an orphan note in nobody's report — `_pack`'s own rule (D268).
                    const own = !this._rowLive;
                    if (own) this._openRow(this.frameSeq, "arrival");
                    const t0 = perfNow();
                    try {
                        return packJob(o.list, {
                            plates: strip, q, Zq: o.Zq, dpr: 1, cfg: this.cfg, paper: this._paperRgb,
                            jobId, frameSeq: this.frameSeq, pool, offset: o.offset,
                        });
                    } finally { this._add(SLOT.pack, perfNow() - t0); if (own) this._closeRow(); }
                },
                onResult: (res) => {
                    const px = res.pixels ? res.pixels[0] : null;
                    const bm = res.bitmaps ? res.bitmaps[0] : null;
                    if (aborted()) {
                        rasterStats.snapshotAborts++;
                        if (bm && bm.close) bm.close();
                        return fail("aborted");
                    }
                    rasterStats.snapshotPlates++;
                    if (bm) return done(bm);
                    if (!px) return done(null);                 // an empty plate: nothing drawn
                    return plateBitmap(px).then(
                        (b) => done(b || { pixels: px, width: PLATE_PX, height: PLATE_PX }),
                        () => done({ pixels: px, width: PLATE_PX, height: PLATE_PX }),
                    );
                },
                onDrop: () => {
                    if (aborted()) { rasterStats.snapshotAborts++; return fail("aborted"); }
                    rasterStats.snapshotFails++;
                    fail("dropped");
                },
            };
            if (o.signal && o.signal.addEventListener) {
                o.signal.addEventListener("abort", () => { dropQueued("abort", q); }, { once: true });
            }
            submitPlates(req);
        });
    }

    // ---- the report (§8.5) ----

    /** Flat scalars beside `PictureLayer.report()` and `PlateStore.report()` (F58). */
    report() {
        return {
            frameSeq: this.frameSeq,
            mode: this._view ? this._view.mode : "",
            plane: this._plane.state, planeCells: this._plane.cellCount(),
            ...rasterStats,
            packed: packStats.packed, culled: packStats.culled,
            queue: this.queue ? this.queue.report() : null,
        };
    }
}
