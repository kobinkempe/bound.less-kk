/**
 * RasterRenderer.js — the renderer that draws the ink through the picture pyramid (A3; PLAN §1.2): the pyramid
 * (`PicturePyramid`, the layer) plans and composes, its store (`PyramidStore`) caches, the queue (`JobQueue`) orders
 * typed jobs over the worker pool (`rasterWorkerClient`), and this module packs, measures, posts and lands for them
 * (FC3). It composes FC1's stack — the pyramid (z 0), `SvgLayer` (z 1: the live stroke, the lasso, the debug
 * overlays), `OverlayLayer` (z 2: the ants), `bl-sel-edges` (z 3: the chevrons) — and extends nothing (A3 §7.2).
 *
 * Three things a reader needs in order not to break it:
 *
 *   - **A job carries the G it is packed at** (A2 §3.1): the Stage's generation at dispatch, or its own table's (an
 *     off-camera snapshot's); `beginJob` tracks its cells from then and the result brings G back to the store.
 *   - **Every job id the pool mints is ended** (`_endJob`, landed or dropped), or its keys stay in flight for ever.
 *   - **Pen-up** (PLAN §1.5, A3 §3.6): a finished stroke's live path stays up while its stroke is pending and comes
 *     down in the task whose compose publishes the plates under it (`_pyrLive`, the pyramid's group commit).
 *
 * jsdom has no 2D context: the suites inject one and a canvas factory. What the picture looks like is the harness's
 * (headless) and Kobin's Chrome's.
 */

import SvgLayer from "./SvgLayer";
import LiveStrokeLayer, { viewCenter } from "./LiveStrokeLayer";
import { SvgOverlays, mkSelLayer, dropSelOverlay, renderSelChevrons, ensureSelStyle } from "./svgOverlay";
import { arcPlanOf } from "./svgAnchors";
import { perfNow } from "../now";
import { PLATE_PX } from "./plate";
import { packJob, parseColour, visibleChords, itemChordsAt, packStats, COORD_BOUND, entryFor, itemBox, outsideWin, setPackBudget, PACK_BUDGET_PHONE } from "./rasterPack";
import { coreStats } from "./rasterCore";
import { antStats, selAntScale } from "./antPaint";
import OverlayLayer from "./OverlayLayer";
import MovePlane, { MOVE_HOLD_MS, planeStats } from "./MovePlane";
import * as rasterPerf from "./rasterPerf";
import { abandonInFlight, ensureRasterPool, destroyRasterPool, plateBitmap, rasterWorkerReport, rasterPool, setOnSlotFreed } from "./rasterWorkerClient";
import PyramidStore, { planeCell } from "./PyramidStore";
import PicturePyramid, { sampleOf, EST_DEFAULTS, LIVE_HOLD_MS } from "./PicturePyramid";
import JobQueue, { PRIO } from "./jobQueue";
import { prefetchPlan, farKeysOf } from "./prefetch";
import { LEVEL_STEP, MOVE_PLANE_PLATES, MOVE_PLANE_PLATES_PHONE, levelFor, zOf } from "./level";
import { R } from "../frameLattice";

/** The camera must hold its view this long before the drag plane is aimed at it: a zoom would re-render it every step. */
const PLANE_QUIET_MS = 150;
/** The stopgap's bounds: a selection this small, over this few plates, is rendered on the main thread. */
const STOPGAP_OBJECTS = 500;
const STOPGAP_PLATES = 8;
/** An off-camera table (a far plane level, a snapshot) is read 40 ms at a time at idle, 40 reads at most (F122). */
const IDLE_READ_MS = 40;
const IDLE_READ_TRIES = 40;
const idle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 30));
/** The pyramid's estimate counts chords only this far: 20,000 × 0.73 µs is past any inline budget (A3 §2.2). */
const MEASURE_CHORD_CAP = 20000;

/**
 * §8.1's slot names this module writes, the vocabulary it shares with `rasterPerf`; `_add` turns a name into that
 * module's numeric slot, so a recording test double can take the names instead. `list` is timed by the ENGINE around
 * its table sync and handed to `noteList`.
 */
export const SLOT = { list: "eng.list", pack: "eng.pack", view: "eng.view", tail: "ovl.tail", xferOut: "xfer.out" };

/** This module's own counters, beside the pyramid's and the store's reports and `packStats`; scalars only (F58). */
export const rasterStats = {
    frames: 0, cameraFrames: 0, jobsEnded: 0, dropsHandled: 0,
    // Cells refused at the pack (A3 §4.2): the table no longer covers them; they are asked for again once it does.
    refusedCover: 0, refusedCoverPlates: 0,
    batches: 0, batchPlates: 0, bitmapWaits: 0,
    liveHolds: 0, liveHandoffs: 0, liveHoldMsMax: 0,   // the pen-up handoff (A3 §3.6)
    snapshots: 0, snapshotPlates: 0, snapshotAborts: 0, snapshotFails: 0, snapshotOverBound: 0,
};

export function resetRasterStats() {
    for (const k of Object.keys(rasterStats)) rasterStats[k] = 0;
}

export default class RasterRenderer {
    /**
     * @param {Element} container the editor host, shared with the Two.js `<svg>` (FC1)
     * @param {object} camera the engine's `Camera`, the object the engine hands `frameFor` (FC3)
     * @param {object} cfg the engine cfg
     * @param {object} opts
     * @param {object} opts.stage the engine's `Stage`: packs read its items at its generation; the store's freshness source
     * @param {number} [opts.width] CSS px @param {number} [opts.height] CSS px
     * @param {number} [opts.dpr] devicePixelRatio override, for the suites
     * @param {string} [opts.paper] the paper colour, which must agree with the host's CSS
     * @param {() => number} [opts.frameSeq] the engine's own counter, bumped per camera step
     * @param {object} [opts.perf] a recorder with `rasterPerf`'s own names, for the suites
     * @param {Function} [opts.notePerf] the engine's perf-log hook, handed to `perf.attach`
     * @param {object} [opts.pool] a pool face `{size, free, submit}` in place of the worker client's, for the suites
     * @param {(w:number,h:number)=>object} [opts.makeCanvas] a canvas factory, and `opts.context`, for the suites
     */
    constructor(container, camera, cfg, opts = {}) {
        this.cam = camera; this.cfg = cfg;
        this.width = opts.width; this.height = opts.height;
        this.host = container || null;
        /** FC1's z-index 1: the one Two.js instance, over the plates. */
        this.svg = new SvgLayer(container, { width: this.width, height: this.height });
        /**
         * The stroke under the pen, and past pen-up until the group commit publishes its plates (A3 §3.6, §7.2).
         * Its origin is `world`'s: ONE object with ONE writer, `begin` (FC6: `_selDecide` caches on its identity).
         */
        this.live = new LiveStrokeLayer(this.svg.world, arcPlanOf(cfg));
        /** The lasso and the two debug overlays, the SVG renderer's own implementation. */
        this.overlays = new SvgOverlays(this.svg, camera);
        this._selAntsFn = null;        // () -> the indicator's decision | null (`setSelectionAnts`)
        this._selOv = null; this._selEls = null;
        this._dragStateFn = null;      // the engine's live drag (`setDragState`)
        this._hasFat = false;          // the fat gate is the SVG renderer's (A3 §7.2)
        /** The scene (the engine's Stage, A2 §3): packs read its items at its generation; it is the store's freshness source. */
        this.stage = opts.stage;
        this._sceneArr = null; this._sceneSrc = null; this._sceneArrG = -1;
        this.perf = opts.perf || rasterPerf;
        this._nextSeq = opts.frameSeq || null;
        /** §8.4 rule 1's join, bumped on EVERY camera step and not only on a full render (Q12). */
        this.frameSeq = 0;
        /** True between `beginRender` and `_endFrame`: the ENGINE opened this frame's row. */
        this._rowOpen = false;
        /** True while any row this module opened is open, whatever its kind (`_openRow`). */
        this._rowLive = false;
        this._pumpQueued = false;                       // a microtask pump is pending (`_pumpSoon`)
        this._coreMs = 0;                               // the inline executor's core phases, summed (`_noteCore`)
        this._attn = null;                              // the attention point, device px (`noteAttention`); null: the screen centre
        this._busyFn = null;                            // the engine's report-sending state (`setBusy`)
        this.paper = opts.paper || "#ffffff";
        this._paperRgb = parseColour(this.paper);

        // FC1: the stack is an explicit z-index — 0 ink, 1 the Two.js `<svg>`, 2 the overlay canvas, 3 `bl-sel-edges` —
        // never the append order: the `<svg>` was appended first.
        const svg = this.svg.element;
        if (svg && svg.style) {
            svg.style.position = "absolute";
            svg.style.left = "0"; svg.style.top = "0";
            svg.style.zIndex = "1";
        }

        const dpr = opts.dpr > 0 ? opts.dpr
            : (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
        /** The store, the pyramid (the layer) and the queue (A3 §1, §4). */
        this.store = null; this.pyramid = null; this.queue = null;
        this._pyrBuild(container, dpr, opts);
        /**
         * FC1's ONE list of screen-space layers, in z order: the pyramid (0), the SVG layer (1), the ants' `OverlayLayer`
         * (2, from the first selection: `_makeOverlay`) and `bl-sel-edges` (3, the chevrons' `<svg>` while a selection
         * shows). `setSize`, `destroy` and the store's release walk it (A3 §7.2).
         */
        this._edgeSlot = { setSize: (w, h) => this._sizeEdges(w, h), destroy: () => this._dropSelOverlay() };
        this._layers = [this.layer, this.svg, this._edgeSlot];
        /** FC1, FC8: the ants' `OverlayLayer`, at z-index 2; null until the first selection. */
        this._overlay = null;
        this.store.onRelease = (reason) => this._onStoreRelease(reason);
        this.store.onShow = () => { if (this.onShown) this.onShown(); };
        if (this.store.phone) setPackBudget(PACK_BUDGET_PHONE);   // the pack memo: half on a phone
        // The scene's last commit: the plane's pre-aim and the prefetch wait for its quiet (a bake commits every few frames).
        this._commitAt = -Infinity;
        this._commitOff = this.stage.onCommit(() => { this._commitAt = perfNow(); });


        this._lastList = [];
        this._view = null;
        this._snapSeq = 0;             // `snapshotJob`'s per-call key (S1): one snapshot's cell alone
        this._packMs = 0;              // the packs' running total: `_pyrSubmit` takes it out of `xfer.out`
        /** The selection's drag plane (A3 §6); the engine's state is pulled (`setPlaneState`). */
        this._plane = new MovePlane();
        /** A test hook: no drag plane — every drag renders each step (the path a lost plane falls back to). */
        this.forcePerStepDrag = false;
        this._planeFn = null;
        this._landTimer = null;
        this._planeTimer = null;
        this._planeViewKey = ""; this._planeViewAt = 0;
        this._liveTimer = null;        // the held paths' one timer (`_armLiveTimer`)

        // SEVEN sources (stage 6's H1, D210): `rasterPerf` imports nothing itself.
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
     * canvas — so this builds `bl-sel-edges` ALONE (`svgOverlay.mkSelLayer`), for the chevrons,
     * at z-index 3 above the ink (0), the Two.js `<svg>` (1) and the ant plane (2). `_selOv` and
     * `_selEls` have the shape `svgOverlay`'s functions read (`renderSelChevrons`, `dropSelOverlay`).
     */
    _buildSelOverlay(svg) {
        const host = svg.parentNode || document.body;
        const edgeLayer = mkSelLayer(svg, host, "bl-sel-edges");
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
     * only SVG left is the chevrons, drawn by the SVG renderer's own `svgOverlay.renderSelChevrons`
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
        const svg = this.svg.element;
        if (!svg || typeof document === "undefined") return null;
        const t0 = perfNow();
        const data = this._selAntsFn && this._selAntsFn();
        const decideMs = perfNow() - t0;
        const runs = (data && data.runs) || [], marks = (data && data.marks) || [], edges = (data && data.edges) || [];
        if (!data || !(runs.length || marks.length || edges.length)) { this._dropSelOverlay(); return null; }
        const v = view || this._view;
        if (!v) return null;                           // no published mapping yet: leave what is there
        ensureSelStyle();
        const els = this._selEls || this._buildSelOverlay(svg);
        this._sizeEdges(this.width, this.height);
        const ov = this._overlay || this._makeOverlay();
        ov.noteDecide(decideMs);
        ov.show(data, v, this._edgeShift(v));
        renderSelChevrons(this._selEls, edges, selAntScale(data.inkPx), this.width, this.height);
        // Last in the host, so the chevrons paint over the ink and over the ant plane.
        const host = els.edgeLayer.parentNode;
        if (host && host.lastChild !== els.edgeLayer) host.appendChild(els.edgeLayer);
        return els;
    }

    /** FC1's z 3 at the screen's size; nothing while no selection shows. */
    _sizeEdges(w, h) {
        const els = this._selEls;
        if (!els || (els.w === w && els.h === h)) return;
        els.edgeLayer.setAttribute("width", String(w));
        els.edgeLayer.setAttribute("height", String(h));
        els.w = w; els.h = h;
    }

    /** The selection went away: the plane detaches and the clock stops, and the buffer is KEPT (FC1). */
    _dropSelOverlay() {
        if (this._overlay) this._overlay.hide();
        dropSelOverlay(this._selEls, this._selOv);
        this._selOv = null; this._selEls = null;
    }

    /**
     * FC8's slot, built on the first decision and never at construction — a tool change must not
     * cost the plane's 10.48 MiB (FC1). It joins `this._layers` at z 2, so `setSize`, the store's
     * release walk and `destroy` reach it with no second copy of each.
     */
    _makeOverlay() {
        const ov = new OverlayLayer(this.host, {
            width: this.width, height: this.height, dpr: this.layer.dpr, perf: this.perf,
        });
        this._overlay = ov;
        this._layers.splice(this._layers.indexOf(this._edgeSlot), 0, ov);
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
     * The engine's `setSize(w, h)` carries no dpr and the layers take `(cssW, cssH, dpr)`, so this
     * is the one place that reads `devicePixelRatio` and §6.1's `matchMedia` change (D190).
     */
    setSize(w, h) {
        this.width = w; this.height = h;
        const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : this.layer.dpr;
        for (const l of this._layers) if (l) l.setSize(w, h, dpr);
        this.store.setBudget(this.pyramid.budgetBytes());   // the budget follows the screen (A3 §4.5)
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

    // ---- the engine's calls: the overlays and the state it hands over ----

    setLasso(fn) { this.overlays.setLasso(fn); }
    /** The lasso redrawn alone: a lasso drag calls this, not `syncWorld`. */
    refreshSelection() { this.overlays.lasso(); this.update(); }
    setTileDebug(v, fn) { this.overlays.setTileDebug(v, fn); }
    setEraseDebug(v, fn) { this.overlays.setEraseDebug(v, fn); }
    /** The indicator's decision (`overlays._selectionAnts`), pulled each camera step. */
    setSelectionAnts(fn) { this._selAntsFn = fn; }
    /** PAPER-PLAN R3: the engine's live drag, pulled here because this renderer draws the dragged ink itself. */
    setDragState(fn) { this._dragStateFn = fn; }
    update() { this.svg.update(); }

    // ---- the drag plane (PAPER-PLAN §10 S4, A3 §6) ----

    /** The engine reads this once, at construction: the drag's plate events are held only where the renderer draws the dragged ink itself. */
    get supportsDragPlane() { return true; }

    /** The engine's selection, as `{ key, ids }` of the current list or null; pulled each camera step. */
    setPlaneState(fn) { this._planeFn = fn; }

    /**
     * At a drag's start: aim the plane at the selection and post what it lacks. False when there is no view yet,
     * or the selection's footprint is past the cap — that drag then renders each step (the engine takes no hold).
     */
    planeAccepts() {
        const v = this._view;
        // A drag begun while the last drop still lands: that plane draws the old list's move and is
        // done — end it and aim from the list the drop rendered (review major 1).
        if (this._plane.showing) this._endPlane();
        const ok = this._planeViewOk(v) && this._aimPlane(v);
        this._noPlaneDrag = !ok;           // a refused drag renders a step: no plane is aimed under it
        return ok;
    }

    /** The views a plane works in: the level plan's and the rest render's (every published view). */
    _planeViewOk(v) { return !!v && (v.mode === "level" || v.mode === "rest"); }

    /** May a drag step skip the list build? Only while the plane draws the move. */
    dragLight() { return this._planeViewOk(this._view) && this._plane.layers.length > 0 && this._plane.state !== "land"; }

    /** Plates a plane may pin here (a test lowers it). */
    get planeCap() { return this._planeCap != null ? this._planeCap : (this.store.phone ? MOVE_PLANE_PLATES_PHONE : MOVE_PLANE_PLATES); }

    /** Keep the plane aimed at the current selection and view; returns whether it is accepted. */
    _aimPlane(v) {
        const pl = this._plane;
        if (this.forcePerStepDrag) { if (pl.tags.length) this._endPlane(); return false; }
        const gen = pl.gen, was = pl.tags.slice();
        const st = this._planeFn && this._planeViewOk(v) ? this._planeFn() : null;
        const ok = pl.aim(st, this._lastList, v, this.cfg, this.planeCap, this.layer.dpr, this.live.model);
        const gone = was.filter((t) => pl.gen !== gen || !ok || !pl.tags.includes(t));   // a re-cut's renamed layers too
        if (gone.length) this._dropPlaneTags(gone);
        this.store.setPlanePins(ok ? pl.keys : null);
        if (!ok) return false;
        for (const lvl of pl.farLevels()) this._farList(pl, lvl);
        this._postPlane(pl);
        return true;
    }

    /**
     * A far plane level's own items (F122): the Stage's snapshot of its rectangle, read at idle a budget at a time
     * (`_readIdle`; in the aim it was a 0.2–0.6 s frame after every select and every drop, TESTER-3). The level is
     * posted when its snapshot is in, packed at the snapshot's G; a re-cut level is forgotten.
     */
    _farList(pl, lvl) {
        lvl.listPending = true;
        this._readIdle(pl.frameId, () => pl.coverOf(lvl), () => this._destroyed || (pl.quick !== lvl && pl.main !== lvl), (snap) => {
            lvl.list = snap ? snap.items() : null;
            lvl.G = snap ? snap.generation : null;
            lvl.listPending = false;
            if (!lvl.list) planeStats.farListFallbacks++;
            this._postPlane(pl);
        });
    }

    /**
     * An off-camera table read at idle, IDLE_READ_MS at a time (a read past its budget keeps the tiles it baked), up to
     * IDLE_READ_TRIES: `done(table)`, or `done(null)` when the rectangle is gone or the reads ran out; nothing once
     * `stale()` is true.
     */
    _readIdle(frameId, rectOf, stale, done, tries = 0) {
        idle(() => {
            if (stale()) return;
            const r = rectOf();
            const snap = r ? this.stage.snapshot(frameId, r, IDLE_READ_MS) : null;
            if (snap === null && r && tries < IDLE_READ_TRIES) { this._readIdle(frameId, rectOf, stale, done, tries + 1); return; }
            done(snap);
        });
    }

    /** Every camera step: follow the drag, close a landing, or keep the plane ready for the next drag. */
    _planeStep(v) {
        const pl = this._plane;
        const d = this._dragStateFn ? this._dragStateFn() : null;
        if (d && d.drag && pl.state !== "land") {
            // A plane that can no longer draw this drag — the camera left its frame, or a release ended it —
            // hands the drag back to a render a step (review major 2).
            if (!pl.layers.length || pl.frameId !== v.frameId || !this._planeViewOk(v)) this._losePlane();
            else {
                const s = d.drag.start, l = d.drag.last || s;
                pl.dragTo(l[0] - s[0], l[1] - s[1], this.layer.dpr);
                this._postPlane(pl);           // a plane plate a change staled mid-drag
            }
        } else if (pl.state === "land") {
            if (this._planeLanded(v)) this._endPlane();
        } else if (!d) this._planeIdle();
        // A level is drawn whole (the main one, else the quick one), else its selected layers alone
        // over the plates that still hold the ink where it was (H4), else a stopgap rendered here.
        let lvl = pl.showing ? pl.pick(this.store) : null;
        if (pl.state === "drag" && (!lvl || pl.partial) && this._pyrStopgap(pl)) lvl = pl.pick(this.store);
        const whole = !!lvl && !pl.partial;
        if (pl.state === "drag") {
            if (!lvl) planeStats.notReady++;
            else if (!whole) planeStats.partialSteps++;
            else if (lvl === pl.quick) planeStats.quickSteps++;
        }
        // While the plane draws the move, every other pack leaves the selection out: a plate re-rastered
        // mid-drag (a cut landing, a crossing's render) would bake it at its moved place (review minor 4).
        this._dragOmit = whole && pl.state === "drag" ? pl.selIds : null;
        this.pyramid.setPlane(lvl ? this._pyrPlaneOf(pl, lvl) : null);
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
     * Nothing dragged: keep the plane ready for the next drag, aimed at the view once the camera has held it
     * PLANE_QUIET_MS — arrivals call this too. A plane aimed at a view the camera has left is freed at once.
     */
    _planeIdle() {
        const pl = this._plane, v = this._view;
        if (!v || pl.showing || this._noPlaneDrag || this.forcePerStepDrag || (this._dragStateFn && this._dragStateFn())) return;
        // Quiet is the published view unchanged — a pan too: re-cutting the layers each pan step
        // posted 938 plates over a 60-step pan in Kobin's Chrome (a selection under a full-screen fill).
        const key = v.frameId + "|" + v.Zq + "|" + v.rev;
        if (key !== this._planeViewKey) { this._planeViewKey = key; this._planeViewAt = perfNow(); }
        const here = pl.tags.length > 0 && pl.frameId === v.frameId && pl.Zq === v.Zq;
        // A bake's commits re-aimed a waiting plane at every cut step (1.0 s of a 8.3 s profile, PLAN §5.9 item 2): the
        // scene's quiet too.
        const settling = () => perfNow() - this._commitAt < PLANE_QUIET_MS;
        const quiet = perfNow() - this._planeViewAt >= PLANE_QUIET_MS && !settling();
        // At this zoom its plates stay (a pan only adds cells); another zoom's plane goes.
        if (!quiet && pl.tags.length && !here) this._endPlane();
        // Aimed in a task of its own even when quiet, after the next frame is painted: inside a select it
        // was 0.29–0.41 s of a 1.2 s release-to-first-frame on a 29k-object lasso, and a 0 ms timer still
        // ran before the paint (TESTER-3, Chrome). On time, the view still the one this was armed for.
        if (this._planeTimer == null) {
            const fire = () => {
                this._planeTimer = null;
                const w = this._view;
                if (this._destroyed || !w || this._plane.showing || this._noPlaneDrag || (this._dragStateFn && this._dragStateFn())) return;
                if (w.frameId + "|" + w.Zq + "|" + w.rev === key && !settling()) this._aimPlane(w);
                else this._planeIdle();
            };
            if (!quiet) this._planeTimer = setTimeout(fire, PLANE_QUIET_MS);
            else if (typeof requestAnimationFrame === "function") this._planeTimer = requestAnimationFrame(() => { this._planeTimer = setTimeout(fire, 0); });
            else this._planeTimer = setTimeout(fire, 0);
        }
    }

    /** A landing is over when every cell it covers holds an exact source again (`cellFresh`), the view's grid changed, or MOVE_HOLD_MS passed. */
    _planeLanded(v) {
        const pl = this._plane;
        if (!this._planeViewOk(v) || v.frameId !== pl.frameId || v.Zq !== pl.Zq) return true;
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
        this._dropPlaneTags(pl.tags);
        this.store.setPlanePins(null);
        pl._reset();
        this.pyramid.setPlane(null);
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
     * Teardown's lever: every job in flight REPORTED, so `endJob` frees the store's keys. It frees no capacity — an
     * abandoned job holds its worker's slot until its own answer arrives (`rasterWorkerReport().heldSlots`, D175).
     * @returns {number} jobs abandoned
     */
    _abandon(why) { return abandonInFlight(why); }

    destroy() {
        // Every job still in flight is reported so `endJob` runs for it: the store's keys would
        // otherwise stay in flight for ever — a permanent hole with every suite green.
        this.queue.clear();
        if (this._pyrOff) { this._pyrOff(); this._pyrOff = null; }
        if (this._commitOff) { this._commitOff(); this._commitOff = null; }
        if (this._pyrPrefetchTimer != null) { clearTimeout(this._pyrPrefetchTimer); this._pyrPrefetchTimer = null; }
        this._abandon("destroy");
        this._destroyed = true;
        if (this._liveTimer != null) { clearTimeout(this._liveTimer); this._liveTimer = null; }
        if (this._landTimer != null) { clearTimeout(this._landTimer); this._landTimer = null; }
        if (this._planeTimer != null) { clearTimeout(this._planeTimer); this._planeTimer = null; }
        destroyRasterPool();
        this._dropDpr();
        this._dropReducedMotion();
        this.perf.detach();
        this.live.destroy();
        for (const l of this._layers) if (l && l.destroy) l.destroy();   // z 3's slot drops the indicator
        this._layers.length = 0;
        this._overlay = null;
    }

    /**
     * Pen-up (PLAN §1.5, A3 §3.6): the live MODEL goes now, and the live PATH stays until the group commit under its
     * box publishes the plates that paint it (`_pyrLive`) — whatever the view (F120).
     */
    endLive() {
        const L = this.live, o = L.model, v = this._view;
        if (!L.root || !o || !o.pts || !o.pts.length || !v) { L.cancel(); return; }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of o.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
        const h = L.hold(), hw = (o.lwFrame || 0) / 2, now = perfNow();
        h.frameId = this.cam.frame; h.at = now; h.until = now + LIVE_HOLD_MS;
        h.box = { left: x0 - hw, top: y0 - hw, right: x1 + hw, bottom: y1 + hw };
        rasterStats.liveHolds++;
        this._armLiveTimer();
    }

    /** One timer for every held path: at the earliest limit, and re-armed while a path is still held. */
    _armLiveTimer() {
        if (this._liveTimer != null || !this.live.held.length) return;
        let until = Infinity;
        for (const h of this.live.held) if (h.until < until) until = h.until;
        this._liveTimer = setTimeout(() => {
            this._liveTimer = null;
            if (this._destroyed) return;
            if (this._pyrLive(this._view)) this.update();
            this._armLiveTimer();
        }, Math.max(0, until - perfNow()) + 20);
    }

    /**
     * Pen-down: the origin re-chosen at the view centre (`LiveStrokeLayer.begin`, the one writer), and the world
     * transform re-synced at once when it moved — left to the next render, every live trail begun after a pan or a
     * zoom was drawn off by the origin's move, off-screen, until pen-up (Kobin 2026-09-22). A held path is re-anchored
     * by the move (F131).
     */
    addLive(o) {
        const O = this.live.origin;
        const tail = this.live.begin(o, viewCenter(this.cam));
        if (this.live.origin !== O) this._syncWorldTransform(this._view);
        return tail;
    }
    setLiveArcs(gaps) { this.live.arcs(gaps); }
    /** The world transform's origin: the live layer's (FC6; `overlays._selDecide` caches on its identity). */
    _origin() { return this.live.origin; }

    /** The world group takes `d` from the view and never from the camera (FC2). */
    _syncWorldTransform(view) {
        const v = view || this._view, o = this.live.origin, w = this.svg.world;
        // The composite maps a frame point to `p·k + tx` in DEVICE px; the SVG layer is in CSS px and its anchors
        // are origin-relative, so the origin is folded back in here, in float64 (DESIGN.md §9). No view yet: the
        // camera's own mapping.
        if (!v || !(v.dpr > 0)) {
            w.scale = this.cam.inScale;
            w.translation.x = this.cam.inPanX + this.cam.inScale * o.x;
            w.translation.y = this.cam.inPanY + this.cam.inScale * o.y;
            return;
        }
        w.scale = v.k / v.dpr;
        w.translation.x = (v.tx + o.x * v.k) / v.dpr;
        w.translation.y = (v.ty + o.y * v.k) / v.dpr;
    }

    /**
     * §8.1's `ovl.tail` (D237's third phase, §15.3's 2026-09-22 Q1): the SVG world transform
     * and the overlay tail — the lasso and the debug overlays, then the indicator — which run on every raster frame
     * and had no slot. `render` and `syncCameraOnly` both reach the tail here, so one bracket times both.
     */
    syncWorld(view) {
        const t = perfNow();
        try {
            this._syncWorldTransform(view);
            this.overlays.render();
            this._renderSelOverlay(view);
        } finally { this._add(SLOT.tail, perfNow() - t); }
    }

    // ---- §5.1's render path ----

    /**
     * §8.1's row for a full frame, opened by the ENGINE before the table's sync, so the sync is
     * inside `mainMs` (§15.3 Stage 5b Q2). `render` finds it open and does not open a second one;
     * a caller that renders without this — every suite here — gets the row opened in `render`.
     */
    beginRender() { this._beginFrame("render"); this._rowOpen = true; }

    /** The table's sync, timed by the engine, charged to §8.1's `eng.list`. */
    noteList(ms) { this._add(SLOT.list, ms); }

    /**
     * A full frame: the Stage's items (A2 §3; the engine's `list` is the SVG path's), the step, the SVG world. A change
     * is already the Stage's dirt, applied when it committed (A2 §2.5).
     */
    render(list, frame) {
        if (this._destroyed) return false;             // inert once destroyed: the next engine shares the host (F101)
        if (!this._rowOpen) this._beginFrame("render");
        this._lastList = this._sceneList();
        const view = this._frameStep();
        this.syncWorld(view);                          // step 7, plus the SVG world transform
        this._endFrame();
        return false;                                  // nothing to reorder: there are no ink groups
    }

    /** A camera step: no overlay rebuild; the SVG layer's transform and the overlay tail. */
    syncCameraOnly() {
        if (this._destroyed) return;
        this._beginFrame("camera");
        this._lastList = this._sceneList();
        const view = this._frameStep();
        this.syncWorld(view);
        this._endFrame();
    }


    _beginFrame(kind) {
        this.frameSeq = this._nextSeq ? this._nextSeq() : this.frameSeq + 1;
        if (kind === "render") rasterStats.frames++; else rasterStats.cameraFrames++;
        this._openRow(this.frameSeq, kind);
    }

    _endFrame() { this._rowOpen = false; this._closeRow(); }

    /** Every row this module opens goes through these two, so a pack outside a frame can tell whether one is live. */
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

    /**
     * A request made outside a camera step — the rest's quiet, a commit's group — is dispatched in a microtask: nothing
     * else pumps while the camera is still and nothing is in flight. A step pumps its own (`_frameStep`).
     */
    _pumpSoon() {
        if (this._pumpQueued) return;
        this._pumpQueued = true;
        Promise.resolve().then(() => { this._pumpQueued = false; if (!this._destroyed) this.queue.pump(); });
    }

    /** An inline render's core phases: the row's (`rasterPerf.noteCore`, rasOnMain), and out of `eng.view` around it. */
    _noteCore(s) {
        this._coreMs += (s.clipMs || 0) + (s.edgesMs || 0) + (s.unionMs || 0) + (s.accumMs || 0);
        if (this.perf.noteCore) this.perf.noteCore(s);
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
            onRequest: (jobs) => { this.queue.push(jobs); this._pumpSoon(); },
            pack: (job) => this._pyrPack(job, null, null),
            measure: (job) => this._pyrMeasure(job),
            onSample: (s) => { pyr.calibrate(s); this._noteCore(s); },
        });
        const base = opts.pool || rasterPool;
        const pool = { size: () => base.size(), free: () => base.free(), submit: (st) => this._pyrSubmit(st, base) };
        pyr.gens.plane = 1;                              // the drag plane's purpose: bumped when its layers go
        this._pyrPlaneAsked = new Map();                 // plane key -> the G it was asked at
        this.queue = new JobQueue({ pool, clock: perfNow, store, gens: pyr.gens, onDrop: (st, why) => this._pyrUnask(st, why) });
        this.layer = pyr;
        if (base === rasterPool) setOnSlotFreed(() => { if (!this._destroyed) this._pumpSoon(); });   // an orphan's answer frees a slot
        this._pyrMot = { t: 0, k: 0, tx: 0, ty: 0, frame: null, moving: false };
        this._pyrPrefetchKey = null;
        // A commit: a shape that landed in it opens its group first, before any patch step could publish its plates
        // while the path is still up (A3 §3.6); then the commit's patch step, in its task (`noteCommit`).
        this._pyrOff = this.stage.onCommit(() => {
            if (this._destroyed || !this._view) return;
            if (this.live.held.length) this._pyrLive(this._view);
            if (pyr.noteCommit()) Promise.resolve().then(() => this._pyrCommitStep());
        });
    }

    /** A commit's patch step that no compose or step ran in its task: in a `settle` row of its own when none is open. */
    _pyrCommitStep() {
        if (this._destroyed || !this.pyramid.patchDue) return;
        const own = !this._rowLive;
        if (own) this._openRow(this.frameSeq, "settle");
        try { this.pyramid.patchIfDue(); } finally { if (own) this._closeRow(); }
    }

    /** A lever changed (A3 §8): the budget is one eviction pass; a step change is the next `frameFor`'s. */
    onLevers() { this.store.setBudget(this.pyramid.budgetBytes()); }

    /** The user's own action just committed (an undo, a redo): its patch has one frame's budget (A3 §3.3). */
    noteUserEdit() { this.pyramid.noteUserEdit(); }

    /**
     * One camera step on the pyramid: the view (and in it the rest render, the patches and the view's requests),
     * the queue's frame, the compose, the pen-up groups, and the prefetch once the camera is still.
     */
    _frameStep() {
        const pyr = this.pyramid, q = this.queue;
        const tv = perfNow(), p0 = this._packMs, c0 = this._coreMs;
        this._liveCross(this.cam.frame);               // before the retarget, which reads a group's rectangle
        const view = pyr.frameFor(this.cam);
        // An inline render's packs are `eng.pack`'s and its core phases the row's own (`_noteCore`).
        this._add(SLOT.view, perfNow() - tv - (this._packMs - p0) - (this._coreMs - c0));
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

    /** Whether the engine is busy with a report (`sendDevReport`): the prefetch plans nothing meanwhile (A3 §4.3). */
    setBusy(fn) { this._busyFn = fn; }

    /** The attention point (A3 §1.5, §4.4): the last pointer, wheel focus or pinch centre, in CSS px; the plan's and the queue's nearest-first. */
    noteAttention(sx, sy) {
        const d = this.pyramid.dpr;
        this._attn = [sx * d, sy * d];
        this.pyramid.setAttention(sx * d, sy * d);
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
            moving, vel, attention: this._attn, at: t,
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
        // each step, and the queue grew by a plan a step without this). A report sending plans nothing and keeps the key.
        gens.prefetch++;
        const reportBusy = !!(this._busyFn && this._busyFn());
        if (!reportBusy) this._pyrPrefetchKey = v.rev + ":" + gens.prefetch + ":" + this.stage.generation;
        // Its off-camera reads are tile reads (`eng.list`), in the step's row or a row of their own (§8.4 rule 2).
        const own = !this._rowLive, t0 = perfNow();
        if (own) this._openRow(this.frameSeq, "settle");
        // Its tile reads are warm: `framesLeft` keeps them across the crossings (F83, PLAN §5.14 item 5: the zoom back
        // in baked 19–22 tiles without it, 9–10 with it); the LRU cap still bounds them.
        const tiles = this.stage.store;
        let jobs;
        tiles.warmReads = true;
        try { jobs = prefetchPlan(v, this.stage, this.store, { ...this.cfg, atRest: v.mode === "rest", gens, reportBusy, focus: this._attn }); }
        finally { tiles.warmReads = false; this._add(SLOT.list, perfNow() - t0); if (own) this._closeRow(); }
        if (!jobs.length) return;
        this.pyramid.setFar(farKeysOf(jobs));
        q.push(jobs);
        q.pump();
    }

    /**
     * The table window's margin: four view cells, so the near prefetch's ℓv − 1 packs from the camera's table (A3 §4.2);
     * while a selection is on the plane's path, at least one view: its SEL cells reach a view past the screen (A3 §6 D1),
     * covered and asked (PLAN §5.11 Q2; four cells are under a view on a 2560-px or a phone screen).
     */
    listMargin(inScale) {
        const pyr = this.pyramid, S = this._view ? this._view.S : LEVEL_STEP;
        const m = 4 * PLATE_PX / zOf(levelFor(inScale * pyr.dpr, S, null, pyr.sigmaMin), S);
        const aimed = this._plane.layers.length > 0 || (this._planeFn && this._planeFn());
        return aimed ? Math.max(m, Math.max(this.width, this.height) / inScale) : m;
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
            pool: bufPool, live: this.live.model, only: job.only || null, omit: job.omit || (job.only ? null : this._dragOmit),
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
     * (capped past any inline budget) — for a patch, each item's chords times its rows' share inside the clips, the
     * rows a clipped render deposits (A3 §3.1) —, A the item box pixels inside them, U the union items' rows inside
     * them, P the cells an item meets.
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
        const clipped = !!job.clips;
        let E = clipped ? 0 : visibleChords(list, win, Z, this.cfg, MEASURE_CHORD_CAP, this.live.model);
        const hit = new Uint8Array(n);
        let A = 0, U = 0;
        for (const o of list) {
            if (o === this.live.model || outsideWin(o, win, this.live.model)) continue;
            const b = itemBox(o, this.cfg);
            if (!b) continue;
            const r0 = o.res, x0 = b[0] + (r0 ? r0[0] : 0), y0 = b[1] + (r0 ? r0[1] : 0), x1 = b[2] + (r0 ? r0[0] : 0), y1 = b[3] + (r0 ? r0[1] : 0);
            if (x1 < win.left || x0 > win.right || y1 < win.top || y0 > win.bottom) continue;
            const union = entryFor(o, this.cfg).union;
            const ch = clipped ? itemChordsAt(o, Z, this.cfg) : 0, ht = y1 - y0;
            for (let k = 0; k < n; k++) {
                const r = rects[k], w = Math.min(x1, r.right) - Math.max(x0, r.left), h = Math.min(y1, r.bottom) - Math.max(y0, r.top);
                if (w <= 0 || h <= 0) continue;
                hit[k] = 1;
                A += w * h * Z * Z;
                if (union) U += h * Z;
                if (clipped) E += ht > 0 ? ch * Math.min(1, h / ht) : ch;
            }
        }
        let P = 0;
        for (let k = 0; k < n; k++) P += hit[k];
        return { E, A, U, P };
    }

    /**
     * The queue's pool face over the client's (A3 §4.4): a strip packed and posted now, or refused; a cut posts its own
     * entry. The strip's queued-at goes to `rasterPerf` (an arrival's wall starts there); the post less the pack is
     * `xfer.out` (§8.4 rule 2: every phase of the frame in a bucket). A dispatch outside a step or an arrival — the
     * rest's quiet, a microtask pump — opens a row of kind `settle`, the rest's (A3 §4.6; D266).
     */
    _pyrSubmit(st, pool) {
        if (st.entry) return pool.submit(st.entry);
        const own = !this._rowLive;
        if (own) this._openRow(this.frameSeq, "settle");
        try { return this._pyrPost(st, pool); } finally { if (own) this._closeRow(); }
    }

    _pyrPost(st, pool) {
        const plates = new Int32Array(st.cells.length * 2);
        for (let k = 0; k < st.cells.length; k++) { plates[k * 2] = st.cells[k].i; plates[k * 2 + 1] = st.cells[k].j; }
        this.perf.noteSubmit({ frameSeq: this.frameSeq }, st.cells.length, 1, st.pushedAt);
        const t0 = perfNow(), p0 = this._packMs;
        const ok = pool.submit({
            req: {
                prio: st.prio, frameSeq: this.frameSeq, pack: (_, jobId, bufPool) => this._pyrPack(st, jobId, bufPool),
                onResult: (res, info) => this._pyrResult(st, res, info),
                onDrop: (d) => this._pyrDrop(st, d), onRequeue: (jobId) => this._pyrRequeue(st, jobId),
            },
            plates,
        });
        this._add(SLOT.xferOut, perfNow() - t0 - (this._packMs - p0));
        return ok;
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
    _postPlane(pl) {
        const reqs = pl.requests();
        if (!reqs) return 0;
        const jobs = [];
        for (const r of reqs) {
            const cells = [];
            for (const [i, j] of r.cells) {
                const c = planeCell(r.frameId, r.Zq, r.tag, i, j), g0 = this._pyrPlaneAsked.get(c.key);
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
    _dropPlaneTags(tags) {
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
        this._pyrUnask(st, "failed");
        if (!this._destroyed) this.queue.pump();
    }

    /**
     * A strip that will not land: its own cells are asked for again (a pen-up group's inside its group); a strip whose
     * cells were exact or in flight exact asks for nothing. Every other ask stands — forgetting them all re-asked every
     * stale cell whose patch was queued, each duplicate dropped at dispatch forgot them all again, and a queued patch's
     * stale plate read as other older meanwhile (the review, scenario 7).
     */
    _pyrUnask(st, why) {
        if (why === "exact" || !st.cells) return;
        const cells = st.packedCells || st.cells;
        this.pyramid.unask(cells);
        for (const c of cells) this._pyrPlaneAsked.delete(c.key);
    }

    /**
     * The pen-up rule (PLAN §1.5, A3 §3.6): a held path stays while its stroke is pending — no limit (PLAN §5.4 Q2);
     * once its shape has landed, one group commit publishes the drawn cells under its box and takes the path down
     * in the same task. An undo or a cancel (the stroke left the document) takes it down now; a crossing carries it
     * (`_liveCross`), and while the new frame's table lacks the stroke (its tiles are read at idle) the document says
     * whether it is pending; a group past LIVE_HOLD_MS commits what it has (the compose checks). Run at every Stage
     * commit and every step.
     */
    _pyrLive(v) {
        const held = this.live.held;
        if (!held.length || !v) return 0;
        const now = perfNow();
        let n = 0, late = false;
        for (let k = held.length - 1; k >= 0; k--) {
            const h = held[k];
            if (h.group) { if (now > h.until) late = true; continue; }
            const rec = this.stage.doc.getById(h.id);
            if (!rec) { this._pyrTakeDown(h, false); n++; continue; }
            const items = this.stage.itemsOf(h.id);
            if (items.length ? items.some((it) => it.pending) : rec.obj.type === "stroke") { h.until = now + 250; continue; }
            h.group = "live:" + h.id;
            h.until = now + LIVE_HOLD_MS + 20;
            this.pyramid.groupCommit(h.group, h.box, () => { if (this._pyrTakeDown(h, true)) this.update(); });
        }
        if (late) this.pyramid.compose();
        return n;
    }

    /**
     * A crossing (the camera's frame changed) with held paths: each is carried into the new frame — its root scaled by
     * R^Δdepth and moved (`LiveStrokeLayer.cross`), its box and frame mapped, a waiting group's rectangle with it — so
     * it stays where its stroke is drawn until its group commits (PLAN §1.5: never neither). One with no map comes down.
     */
    _liveCross(F) {
        const L = this.live;
        if (!L.held.some((h) => String(h.frameId) !== String(F))) return;
        const lm = this.stage.lm;
        const lost = L.cross((h) => {
            if (String(h.frameId) === String(F)) return { s: 1, og: h.og };
            const box = lm.mapRectF(h.box, h.frameId, F), og = lm.mapPointF([h.og.x, h.og.y], h.frameId, F);
            const d0 = lm.depthOf(h.frameId), d1 = lm.depthOf(F);
            if (!box || !og || d0 == null || d1 == null) return null;
            h.box = box; h.frameId = F;
            if (h.group) this.pyramid.moveGroup(h.group, box);
            return { s: Math.pow(R, d1 - d0), og: { x: og[0], y: og[1] } };
        }, viewCenter(this.cam));
        for (const h of lost) this._pyrTakeDown(h, false);
    }

    /** One held path taken down (`handoff`: its plates published in this task); false when it was already gone. */
    _pyrTakeDown(h, handoff) {
        if (!this.live.release(h.id)) return false;
        const ms = perfNow() - h.at;
        if (ms > rasterStats.liveHoldMsMax) rasterStats.liveHoldMsMax = ms;
        if (handoff) rasterStats.liveHandoffs++;
        if (!this.live.held.length && this._liveTimer != null) { clearTimeout(this._liveTimer); this._liveTimer = null; }
        return true;
    }

    // ---- off camera: the snapshot (S1) ----

    /**
     * SCENES-PLAN S1. ONE plate of an arbitrary `(frame, rect)`, answered straight to the caller — the Scenes panel's
     * thumbnails — through the queue at `PRIO.thumb` (A3 §4.1) and never stored (its zoom is `fitView`'s, no level's).
     * The table is read at idle, a budget at a time (`_readIdle`; D5: never unbudgeted). The rect lands on the plate's
     * own origin because the WORLD is moved: `packJob`'s `offset` is folded into each item at pack time.
     *
     * @param {object} o
     * @param {string|number} o.frameId the frame
     * @param {{left:number, top:number, right:number, bottom:number}} o.win the rect the plate covers, in its units
     * @param {number} o.Zq device px per frame unit — `fitView`'s exact scale
     * @param {[number, number]} o.offset the pack-time translation, in FRAME units
     * @param {AbortSignal} [o.signal] the panel closing
     * @returns {Promise<ImageBitmap|{pixels:Uint8ClampedArray,width:number,height:number}|null>} null for an empty plate
     *          or a table the reads could not finish; the raw record where the scope has no `createImageBitmap` (jsdom)
     */
    snapshotJob(o) {
        rasterStats.snapshots++;
        // §4.6's bound, on the translation itself: the offset is added to every coordinate at pack time.
        if (!(Math.abs(o.offset[0]) < COORD_BOUND && Math.abs(o.offset[1]) < COORD_BOUND)) {
            rasterStats.snapshotOverBound++;
            return Promise.reject(new Error("over the coordinate bound"));
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const done = (v) => { if (!settled) { settled = true; resolve(v); } };
            const fail = (why) => {
                if (settled) return;
                settled = true;
                if (why === "aborted") rasterStats.snapshotAborts++; else rasterStats.snapshotFails++;
                reject(new Error(why));
            };
            let st = null;
            if (o.signal && o.signal.aborted) { fail("aborted"); return; }
            // Aborted while queued: out of the queue now, not at its dispatch.
            if (o.signal && o.signal.addEventListener) o.signal.addEventListener("abort", () => { fail("aborted"); if (st) this.queue.remove(st); }, { once: true });
            this._readIdle(o.frameId, () => o.win, () => this._destroyed || settled, (snap) => {
                if (!snap) { done(null); return; }
                const q = this.queue, list = this._tableList(snap);
                st = { kind: "thumb", prio: PRIO.thumb, cells: [{ key: "t" + (++this._snapSeq), i: 0, j: 0 }] };
                const ended = (d) => { if (d && !d.before) q.done(st.id, false); };
                st.entry = {
                    req: {
                        prio: PRIO.thumb,
                        // A dispatch outside a camera frame opens its own row: an `_add` without one is nobody's (D268).
                        pack: (plates, jobId, pool) => {
                            if (settled) return null;                   // aborted while queued: dropped at dispatch
                            const own = !this._rowLive;
                            if (own) this._openRow(this.frameSeq, "arrival");
                            const t0 = perfNow();
                            try {
                                return packJob(list, {
                                    plates, Zq: o.Zq, dpr: 1, cfg: this.cfg, paper: this._paperRgb, G: snap.generation,
                                    jobId, frameSeq: this.frameSeq, pool, offset: o.offset,
                                });
                            } finally { this._add(SLOT.pack, perfNow() - t0); if (own) this._closeRow(); }
                        },
                        onResult: (res) => {
                            q.done(st.id);
                            q.pump();
                            const px = res.pixels ? res.pixels[0] : null, bm = res.bitmaps ? res.bitmaps[0] : null;
                            if (settled) { if (bm && bm.close) bm.close(); return; }
                            rasterStats.snapshotPlates++;
                            if (bm) { done(bm); return; }
                            if (!px) { done(null); return; }            // an empty plate: nothing drawn
                            plateBitmap(px).then(
                                (b) => done(b || { pixels: px, width: PLATE_PX, height: PLATE_PX }),
                                () => done({ pixels: px, width: PLATE_PX, height: PLATE_PX }),
                            );
                        },
                        onDrop: (d) => { ended(d); fail("dropped"); },
                        onRequeue: () => { if (q.requeue(st.id)) Promise.resolve().then(() => q.pump()); },
                    },
                    plates: Int32Array.of(0, 0),
                };
                q.push([st]);
                q.pump();
            });
        });
    }

    // ---- the report (§8.5) ----

    /** Flat scalars beside the pyramid's and the store's reports (F58). */
    report() {
        return {
            frameSeq: this.frameSeq,
            mode: this._view ? this._view.mode : "",
            plane: this._plane.state, planeCells: this._plane.cellCount(),
            ...rasterStats,
            packed: packStats.packed, culled: packStats.culled,
            queue: this.queue.report(),
        };
    }
}
