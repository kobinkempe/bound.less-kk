/**
 * PictureLayer.js — the `<canvas class="bl-ink">` the picture is composed into, and the one
 * place the composite mapping is computed (RASTERISER-PLAN §6.1–§6.6, §2.7 FC1–FC5).
 *
 * It owns four things and publishes one:
 *
 *   1. the ink canvas — `round(css × dpr)` backing store, `{ alpha: false }`, `z-index: 0`;
 *   2. the mapping — `frameFor(cam, chords)` quantises the zoom, takes the plate range, snaps the
 *      screen translation `d` once and publishes it. It is the only method that MAPS a camera the
 *      CALLER gives it; the settle's and the switch's own publishes map the INJECTED one, off the
 *      rAF cycle, and `compose()` reads none (FC3). The one other camera read in the module is
 *      `_switchQuantum`'s guard, which takes the zoom alone to bound the stretch it is about to
 *      publish — no mapping, no snap (D188);
 *   3. the layer canvas — the visible plates composed 1:1 and scaled once when `s ≠ 1`,
 *      allocated lazily and recomposed only when the plate set, `o` or the size moved;
 *   4. the settle — 150 ms still off-quantum, the screenful re-rastered at the exact zoom;
 *   5. the quantum change — the published view is HELD at the last quantum that had plates and
 *      composes them stretched, while the NEWEST quantum's misses go out as their own request.
 *
 * **The hold (§6.3's retention, §15.3's checkpoint ruling).** On a quantum change `want()` at the
 * new `q` is all misses, so a layer that published it would paint paper over the whole screen for
 * as long as the re-raster takes — 0.3–0.5 s on §8.6 row 14's dense screen. So the view keeps the
 * old `q` and `Zq`, `s = Z/Zq` runs past the hysteresis band, and the published range is the held
 * range CLIPPED to what is still on screen: the renderer's own `want(view)` therefore asks for no
 * plate at the dying quantum, and the clipped range can never exceed the layer canvas (D158).
 * Three rules on top: only the newest quantum is ever requested, so a second crossing abandons
 * the first (`abandonQuantum`, which refuses its stragglers while its cached plates
 * stay as fallbacks, counted in `quantumAbandons`); the incoming set is asked for with
 * `{ pin: "add" }`, which pins into the
 * store's SECOND pin set so neither set can evict the other — a pin merged into the visible set
 * would be discarded by the renderer's own `want(view)` later in the same frame, and
 * `unpinAdded()` at the end of the hold is what releases it (D178; the phone cap is 48 plates
 * for exactly these two sets, D170, and a settle makes no third one, D179); and the stretch is
 * bounded upward at `S_MAX_HOLD` = 2, past which the hold ends and the live quantum is
 * published — no longer paper, because the abandoned quantum's plates stay cached and the
 * fallback pass draws them (`holdBreaks`, D174 as PAPER-PLAN R1 amends it). `heldComposes`,
 * `holdMaxS` and `holdBreaks` are what stage 7 reads before deciding whether a stretch beats
 * a coarser stand-in. **The
 * switch publishes the quantum it switched TO** (`_frame`'s stage 4, D183): an arrival runs off
 * the rAF cycle, so a publish that re-derived the quantum from the camera could cross one and
 * compose the incoming plates against the dying `Zq` — a full-screen paper compose in the one
 * case the hold exists to remove.
 *
 * What it publishes is FC2's `view`: ONE stable object, mutated in place, carrying a monotonic
 * `rev`. A point at frame coordinate `p` lands at device pixel `(p·Zq − o)·s + d` in all three
 * modes, and the same affine is published as `k, tx, ty` (`X = p·k + tx`) because
 * `antPaint.paintPhase` takes exactly that — two derivations of one affine is the second writer
 * FC2 exists to forbid, and between quanta they differ by `o·(s − 1)`, 46 device px at a layer
 * origin 512 px away (§2.7 FC2).
 *
 * **Paper is what nothing has EVER shown** (PAPER-PLAN R1, §10.13). Coverage is planned before
 * drawing: this view's plates, then the stand-ins at other quanta and frames (`fallbackCover`,
 * coarsest first, each stretched by `Zq_view / Zq_plate`), and where those leave a cell bare, the
 * canvas's own last picture re-mapped to this view (`_drawCarry`) — paper only where none of the
 * three reaches. The layer canvas is TRANSPARENT where it has no plate, and only the published
 * range's sub-rectangle of it is blitted, so neither its holes nor its margin can bury what is
 * beneath. `covered` is the published range; `screenCovered` is the screen, the carry counted.
 *
 * **The paper colour, the host's CSS background and `ERASE_COLOR` must agree.** The ink canvas is
 * opaque and the paper fill is the first thing in every compose; the host's own background is
 * `#fff` (`boundless-ui.css:180`) and an eraser mark is painted `ERASE_COLOR` as INK
 * (`KobinEngine.js:56`, §4.7). If the three ever differ the difference shows at the canvas's
 * own edge, and only in a browser.
 *
 * **This module never posts a job and never calls `beginJob`/`endJob`** (§15.3 Q3): the settle's
 * misses go out through `opts.onPlates` and the renderer posts them, so there is one poster and
 * one owner of the in-flight map. **What goes out with them is the REQUEST those plates belong
 * to** — `settleRequest()` for a settled plate, the published view otherwise — because during a
 * settle the view is still the quantum's (D154) while the misses are wanted at `Z` and keyed
 * `"e"`; both objects carry `frameId, q, Zq, i0..j1` and a poster needs nothing else (D160).
 * It composes BITMAPS only — a raw-pixel result is counted in `noBitmap` and skipped, because
 * the conversion is asynchronous and the compose is not (Q13) — and it **refuses a plate keyed
 * `"s"`**: the sync path is composed and never cached (§6.5, D159).
 *
 * Nothing here is measured in jsdom: `getContext` returns null in this tree (`setupTests.js:27`),
 * so the suite drives an injected recording context and asserts a call sequence and a computed
 * number. What the picture looks like is stage 7's, in Kobin's Chrome (§9.4).
 */

import { PLATE_PX, QUANTA_PER_OCTAVE, QUANTUM_HYSTERESIS, PREVIEW_QUANTA, quantumFor, zqOf, plateRange, plateKey, plateOriginPx } from "./plate";
import { perfNow } from "../now";

/**
 * The smallest `s = Z/Zq` a held quantum can reach: `2^(−QUANTUM_HYSTERESIS/4)` = 0.8781 (§3.2).
 * The screen covers `W/(PLATE_PX·s)` plates, so this is what the layer canvas is sized from —
 * at `s = 1` the layer is a plate column short of the range on most screen sizes.
 */
const S_MIN = Math.pow(2, -QUANTUM_HYSTERESIS / QUANTA_PER_OCTAVE);

/**
 * The largest stretch a HELD view may compose at (§6.3, D174). Past it the hold ends and the
 * live quantum is published — paper until its plates arrive, which is the trade. 2 is one
 * octave, where a held plate shows one of its pixels per 2 × 2 device pixels, and it is above
 * every stretch measured: 1.6133 over the suite's three crossings, 1.3660 in §8.6 row 14b.
 * **Only the magnification is bounded**: below 1 a held picture is sharp and merely smaller,
 * so ending the hold there would buy paper for nothing. Kobin moves this number at stage 7.
 */
export const S_MAX_HOLD = 2;
/**
 * The smallest stretch a HELD view may compose at (PAPER-PLAN R5c). A fast zoom-out held the old
 * quantum down to s 0.001 — a dot in a field of paper — and the coverage check walked the held
 * grid, a thousand times the screen's. Below one octave the live quantum is published and the held
 * plates are R5a stand-ins four quanta finer.
 */
export const S_MIN_HOLD = 0.5;
/** A live preview this many quanta or more ahead of the camera is kept on a zoom-out tick (R5). */
const PREVIEW_STICKY = 2;
/**
 * A zoom-out whose quantum changes come faster than FAST_ZOOM_MS apart aims its preview this many
 * quanta ahead instead of PREVIEW_QUANTA (R5): a quarter of the plates, so it lands while the wheel
 * is still turning — measured at four octaves a second on the Magnum Opus, a two-octave preview
 * could not be filled and the screen was paper.
 */
const PREVIEW_FAST = 12;
const FAST_ZOOM_MS = 150;
/** Cells `_screenCoverOf` walks before it answers "not covered" unasked (R5c). */
const SCREEN_CELLS_MAX = 4096;
/**
 * Images one compose may draw. Chrome's 2D canvas takes up to 33 distinct images in a frame with
 * any of them scaled for ~2 ms, and 34 for ~100 ms (Kobin's Chrome, 2026-09-23: a 90-tick zoom-out
 * at 48 stand-ins a compose took 42 s). The stand-ins get what the plates, layer and carry leave.
 */
export const COMPOSE_IMAGES = 30;
/** Stand-ins a compose may keep however many other images it draws: a coarse cover is 1–4 plates. */
const FB_DRAW_MIN = 4;
/** The most the last picture is magnified or shrunk to be carried: 16 octaves, the stand-ins' own window. */
const CARRY_MAX_SC = 65536;

/** Milliseconds the camera must be still, off-quantum, before the screenful is re-rastered exactly (§6.3, D24). */
export const SETTLE_MS = 150;

/**
 * Chords the visible screen may need before it is rastered synchronously on the main thread at
 * the exact zoom (§6.5). §6.5 wrote 20,000 and attributed it to a measurement that measures ms
 * a plate; by §8.6 measurement 1's fitted 729 ns an edge, 20,000 chords is about 15 ms of edge
 * setup alone, on the main thread, on every zoom step, against a 4 ms pan budget. 5,000 is
 * about 4 ms by the same fit. A budget too low costs a soft zoom on a medium drawing, which is
 * the accepted default; too high costs a stall on every zoom step. **Never derived from a
 * measurement of its own — stage 7 tunes it from a reading in Chrome** (§15.3 Q10).
 */
export const SYNC_CHORD_BUDGET = 5000;
/**
 * A sync frame whose CORE phases (clip, edges, union, accum) measure over this many ms leaves the
 * sync path (D272). The chord estimate cannot see accumulation: a plate a giant stroke covers
 * costs ~9 ms of `ras.accum` whatever its chord count, and 17 of them were 130–187 ms a camera
 * frame in Chrome; an empty screen of 18 plates is 1.8–4.2 ms. The core alone, because the pack
 * is memoised and a cold first frame's pack must not throw light ink off the path.
 */
export const SYNC_MAX_MS = 8;

/** The paper, when the host does not say (§4.7). */
const DEFAULT_PAPER = "#ffffff";
/** Stale arrivals kept for the report; §8.4 rule 4 wants the why, not every one of them (F58). */
const STALE_LOG = 8;

/**
 * The module's counters, beside `packStats` / `antStats` / `coreStats` and read by stage 6.
 * Scalars only, so the report's `raster` section stays bounded (F58).
 */
export const pictureStats = {
    composes: 0, layerRecomposes: 0, blits: 0, paperFills: 0, plateBlits: 0,
    // `arrivalComposes` is the composes an ARRIVAL caused: one for a batch's own compose, and
    // one for a settle publish or a quantum switch an arrival completed (D180). A settle the
    // timer publishes with everything already cached composes through `composes` alone.
    arrivals: 0, arrivalComposes: 0, arrivalsOutside: 0,
    staleDrops: 0, staleUnwanted: 0, staleNewer: 0, reposts: 0,
    settles: 0, settlePublishes: 0, settleDrops: 0,
    quantumChanges: 0, syncFlips: 0,
    syncCostExits: 0,
    previews: 0, previewHits: 0, previewKept: 0,   // R2: previews aimed, and plates a preview ask found already cached               // the sync path left because a frame measured over SYNC_MAX_MS (D272)
    // §6.3's retention. `holdMaxS`/`holdMinS` are the largest and smallest stretch a HELD view
    // composed at; 0 means no held compose yet, which is why the minimum is not seeded at 1.
    holds: 0, holdsPartial: 0, holdSkips: 0, holdSwitches: 0, quantumAbandons: 0,
    heldComposes: 0, holdMaxS: 0, holdMinS: 0, holdBreaks: 0,
    holdShrinks: 0,                 // a hold ended below S_MIN_HOLD (R5c)
    // Paper on screen, from the compose's own coverage: composes that left a screen cell with no
    // plate and no stand-in, and the most such cells one compose left (R5's measure).
    paperComposes: 0, paperCellsMax: 0, coverRefused: 0,
    crossFrameBlits: 0,             // stand-ins drawn from another frame (R5a)
    carryComposes: 0, carryShifted: 0, carryDropped: 0,   // the last picture carried as the bottom stand-in (§10.13)
    // A switch refused because the stretch it would publish is outside [S_MIN, S_MAX_HOLD]:
    // below, the published range outgrows the layer canvas; above, the hold's own bound (D188).
    switchRefusedLow: 0, switchRefusedHigh: 0,
    // PAPER-PLAN R1. `staleComposes` is composes that drew at least one stale plate and
    // `stalePlateBlits` the plates; the `fallback*` five are the cover pass — scans it ran,
    // composes it drew in, plates drawn, plates the window or the cap refused, and the worst
    // stretch actually drawn (`r` = Zq_view / Zq_plate), which is what says how blurred a
    // stand-in the screen is showing.
    staleComposes: 0, stalePlateBlits: 0,
    fallbackComposes: 0, fallbackBlits: 0, fallbackScans: 0, fallbackRefused: 0, fallbackMaxR: 0,
    fallbackCulled: 0, fallbackOverBudget: 0,   // off screen or under the view's plates; past COMPOSE_IMAGES
    canvasBytes: 0, layerBytes: 0, canvasAllocs: 0,
    noContext: 0, noBitmap: 0, zqMismatch: 0, sizeMismatch: 0, badZoom: 0, layerOverflow: 0,
    deadRefused: 0,                 // an entry the store removed between composes (§7.1's `dead`)
    syncRefused: 0,
    allocs: 0,
    // The compose's own cost, for the harness (A3 §9.2): its ms, summed, and the most `drawImage` calls one
    // compose made, against COMPOSE_IMAGES and the ~33-image cliff (A3 E6).
    composeMs: 0, maxImagesPerCompose: 0,
};

export function resetPictureStats() {
    for (const k of Object.keys(pictureStats)) pictureStats[k] = 0;
}

/**
 * The one rounding in this module: §6.4's screen translation `d`, and §6.1's backing store.
 * FC2 says `d` is snapped once, in one place — a second snap anywhere is the 46 device px
 * separation between the ink and the ants that FC2 exists to make unreachable.
 */
function snapPx(x) { return Math.round(x); }                 // FC2 snap

/**
 * The ONE derivation of the stretch (FC2). It is a function and not a line because the hold
 * takes it twice — once at the held quantum and once at the live one it falls back to (D174).
 */
function stretchOf(Z, Zq) { return Zq > 0 ? Z / Zq : 1; }

/** A canvas from the document, when the caller injects no factory. */
function mkCanvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
}

export default class PictureLayer {
    /**
     * `cfg` is NOT a parameter: nothing in §6 reads it and an unread parameter is a vestige
     * (§15.3 Q12). The store is injected as an instance so this module imports `plate.js` alone
     * (§2.3).
     *
     * @param {Element|null} host the editor host; the canvas is appended to it and nothing else
     *        in it is touched (FC1)
     * @param {object|null} camera the engine's `Camera`, and the one the settle's publish and the
     *        quantum switch's read — both run off the rAF cycle, where `frameFor(cam)`'s own
     *        argument does not reach them. Those three are every reader that MAPS a camera:
     *        `_frame` is the one place a camera field becomes a mapping, and `compose()` takes
     *        none (FC3). There is a fourth reader and it maps nothing: `_switchQuantum`'s guard
     *        reads the zoom only to bound the stretch it is about to publish, through `stretchOf`
     *        and the same `cam` and `dpr` that `_frame` stage 4 then takes, so the two agree by
     *        construction and the snap stays one `Math.round` in one function (D188, C2)
     * @param {object} [opts]
     * @param {object} [opts.store] a `PlateStore` instance
     * @param {number} [opts.width] CSS px; the engine's own `width`
     * @param {number} [opts.height] CSS px
     * @param {number} [opts.dpr] devicePixelRatio
     * @param {string} [opts.paper] the paper colour, `#ffffff` by default
     * @param {(w:number,h:number)=>object} [opts.makeCanvas] a canvas factory, for the suite
     * @param {(req:object, misses:object[])=>void} [opts.onPlates] the settle's misses, and the
     *        incoming quantum's while the view is held; the RENDERER posts them and owns their
     *        `beginJob`/`endJob` (§15.3 Q3). `req` is the REQUEST those plates belong to —
     *        `settleRequest()` or `quantumRequest()`, not the published view
     * @param {(req:object, misses:object[])=>void} [opts.onRepost] a stale arrival still wanted,
     *        with the request it belongs to: the view in the plate modes, `settleRequest()` for
     *        a settled plate
     * @param {()=>number} [opts.now] the clock, for the suite
     * @param {(fn:Function,ms:number)=>*} [opts.setTimer]
     * @param {(t:*)=>void} [opts.clearTimer]
     */
    constructor(host, camera, opts = {}) {
        this.host = host || null;
        this.cam = camera || null;
        this.store = opts.store || null;
        this.paper = opts.paper || DEFAULT_PAPER;
        this.settleMs = opts.settleMs != null ? opts.settleMs : SETTLE_MS;
        this.syncBudget = opts.syncBudget != null ? opts.syncBudget : SYNC_CHORD_BUDGET;
        this.syncMaxMs = opts.syncMaxMs != null ? opts.syncMaxMs : SYNC_MAX_MS;
        this._syncMs = 0;                   // the renderer's measure of the last sync frame
        this._syncSlowAt = -1;              // the chord estimate the sync path was left at, or -1
        this._mk = opts.makeCanvas || mkCanvas;
        this._onPlates = opts.onPlates || null;
        this._onRepost = opts.onRepost || null;
        this._now = opts.now || (() => Date.now());
        this._setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
        this._clearTimer = opts.clearTimer || ((t) => clearTimeout(t));

        this.dpr = opts.dpr > 0 ? opts.dpr
            : (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
        this.cssW = opts.width > 0 ? opts.width : (camera && camera.lm ? camera.lm.width : 0);
        this.cssH = opts.height > 0 ? opts.height : (camera && camera.lm ? camera.lm.height : 0);

        /** FC2's published view: one object, mutated in place, never re-created. */
        this._v = {
            rev: 0, mode: "plates", frameId: null, q: 0, Zq: 1, Z: 1, s: 1,
            ox: 0, oy: 0, dx: 0, dy: 0, dpr: this.dpr, cssW: this.cssW, cssH: this.cssH,
            // derived, published so no reader re-derives the composite (FC2, §15.3 Q4):
            // device px X = p·k + tx, CSS px = device ÷ dpr; k = Zq·s, tx = dx − ox·s
            k: 1, tx: 0, ty: 0, i0: 0, i1: -1, j0: 0, j1: -1,
        };
        /**
         * The settle's store request: `want`'s own shape, allocated once (FC5), and the object
         * `onPlates`/`onRepost` are handed for a settled plate — those pixels are wanted at `Z`
         * and keyed `"e"`, which the published view (still the QUANTUM's, D154) does not say.
         */
        this._req = { mode: "settle", frameId: null, q: "e", Zq: 1, i0: 0, i1: -1, j0: 0, j1: -1, prio: 2 };
        /**
         * The INCOMING quantum's request while the view is held (§6.3), `want`'s own shape,
         * allocated once, and the object `onPlates`/`onRepost` are handed for one of its plates.
         * Valid only while `_pendLive`; the held quantum is `_hold`, and the two never share a `q`.
         */
        this._pend = { mode: "quantum", frameId: null, q: 0, Zq: 1, i0: 0, i1: -1, j0: 0, j1: -1, prio: 1 };
        /**
         * The preview's request (PAPER-PLAN R2): the screen at `q − PREVIEW_QUANTA`, asked with
         * `{pin: "none"}` and posted at `prio` 0 — the only thing between the user and paper. Its
         * plates are R1's fallbacks and never enter `_hits`. Aimed by a zoom-OUT quantum change or a
         * frame crossing; never by a zoom in, a hold break or the first frame (a cold load's own
         * plates arrive centre-out at prio 1).
         */
        this._prev = { mode: "preview", frameId: null, q: 0, Zq: 1, i0: 0, i1: -1, j0: 0, j1: -1, prio: 0 };
        this._prevLive = false;
        this._qChangeAt = null;             // the last zoom-OUT quantum change, for PREVIEW_FAST
        this._hold = null;                  // { frameId, q, Zq, i0..j1 }: the held quantum and its plates
        this._pendLive = false;             // the incoming quantum is being asked for
        this._holdWhy = "";                 // why the last hold ended, for the report
        this._rHold = { i0: 0, i1: -1, j0: 0, j1: -1 };   // the held range clipped to the screen, reused
        /**
         * The screen's OWN plate range at the published `Zq`, before the hold's clip. `v.i0..j1`
         * is the published range and during a hold it is smaller: the ring between the two is
         * where the 550 ms of white was measured, and it is what the fallback pass covers.
         */
        this._rFull = { i0: 0, i1: -1, j0: 0, j1: -1 };
        this._covered = false;              // the last compose drew every plate OF THE PUBLISHED RANGE
        this._screenCovered = false;        // …and every cell of the SCREEN, fallbacks counted
        this._layerDrawn = 0;               // plates of that range the last layer recompose drew
        /** The hits being composed: the store's own entries, copied in, never allocated per frame. */
        this._hits = [];
        this._nHits = 0;
        /** The cover set, rebuilt inside every compose that draws one — never carried across. */
        this._fb = [];
        this._nFb = 0;
        this._fbB = [];                     // each drawn stand-in's box in view-plate units: x0, y0, x1, y1
        this._uncovered = 0;                // screen cells the last compose left as paper
        /** R5a: another frame's affine into the view's frame, memoised per view frame and lattice epoch. */
        this._mf = new Map();
        this._mfF = null;
        this._mfE = -1;
        this._mapFrameFn = (G) => this._mapFrame(G);
        this._plane = null;                 // the drag plane while it shows (PAPER-PLAN §10 S4)
        /**
         * The last compose's picture, as the stand-in of last resort (PAPER-PLAN §10.13): the view it
         * was composed at (`frameId`, `k`, `tx`, `ty`) and the device-px boxes of it that held ink.
         * The ink canvas keeps those pixels; the next compose re-maps them to its own view.
         */
        this._carry = null;
        this._cyB = [];                     // the carried boxes in this view's plate units: x0, y0, x1, y1
        this._nCy = 0;
        this._layerDirty = true;
        this._qPrev = null;                 // the numeric quantum in force, for the hysteresis
        this._sync = false;                 // the sync/plates switch, with its own hysteresis
        this._timer = null;
        this._settlePending = false;        // asked for the exact plates, not all of them in yet
        this._settleDone = false;           // the settle view is published; it stands until a move
        this._eLive = false;                // something is cached or in flight at q = "e"
        this._cam0 = { frameId: null, inScale: NaN, panX: NaN, panY: NaN, sized: true };
        this._stale = [];
        this._staleAt = 0;
        /** One arrival or one job's worth: what `_take` accumulates so `_flush` makes one of each. */
        this._arr = { compose: false, req: null, miss: null };
        this._fire = () => this._settleNow();

        this._canvas = null; this._ctx = null;
        this._layer = null; this._lctx = null;
        this._mount();
    }

    // ---- the canvas (§6.1, FC1) ----

    _mount() {
        const w = snapPx(this.cssW * this.dpr), h = snapPx(this.cssH * this.dpr);   // backing store, §6.1
        const c = this._mk(w, h);
        if (!c) return;
        this._canvas = c;
        c.width = w; c.height = h;
        if (c.style) {
            c.style.position = "absolute";
            c.style.left = "0"; c.style.top = "0";
            c.style.transformOrigin = "0 0";
            c.style.zIndex = "0";                    // FC1: the stack is z-index, never append order
            c.style.width = this.cssW + "px";
            c.style.height = this.cssH + "px";
        }
        if (c.setAttribute) c.setAttribute("class", "bl-ink");
        if (c.setAttribute) c.setAttribute("aria-hidden", "true");
        this._ctx = c.getContext ? c.getContext("2d", { alpha: false }) : null;
        if (!this._ctx) pictureStats.noContext++;
        pictureStats.canvasAllocs++;
        pictureStats.canvasBytes = w * h * 4;
        if (this.host && this.host.appendChild) this.host.appendChild(c);
    }

    /**
     * A resize or a dpr change. **Every plate stays valid** — dpr is not in the key, so a change
     * resizes the canvas and keeps the cache (D27, §3.2, §5.4 rule 5; §6.1's "drops the whole
     * plate cache" is struck, §15.3 Q1).
     */
    setSize(cssW, cssH, dpr) {
        const d = dpr > 0 ? dpr : this.dpr;
        if (cssW === this.cssW && cssH === this.cssH && d === this.dpr) return false;
        this.cssW = cssW; this.cssH = cssH; this.dpr = d;
        const c = this._canvas;
        if (c) {
            c.width = snapPx(cssW * d); c.height = snapPx(cssH * d);       // backing store, §6.1
            if (c.style) { c.style.width = cssW + "px"; c.style.height = cssH + "px"; }
            pictureStats.canvasBytes = c.width * c.height * 4;
        }
        this._dropLayer();                       // the worst-case grid moved with the size
        this._carry = null;                      // a resized canvas is cleared: nothing to carry
        this._layerDirty = true;
        this._cam0.sized = true;                 // the mapping must be recomputed on the next frame
        if (this.store) this.store.noteDpr(d);
        return true;
    }

    /** The `visibilitychange` release: the layer canvas goes with the cache (§6.6). The ink canvas stays — it is the screen. */
    onStoreRelease(reason) {
        this._dropLayer();
        this._nHits = 0;
        this._layerDirty = true;
        this._endHold("release");                // the held plates went with the cache
        return reason;
    }

    destroy() {
        this._clear();
        this._endHold("destroy");
        this._dropLayer();
        const c = this._canvas;
        if (c && c.parentNode && c.parentNode.removeChild) c.parentNode.removeChild(c);
        this._canvas = null; this._ctx = null;
        this._nHits = 0;
        pictureStats.canvasBytes = 0;
    }

    // ---- the mapping (§6.2, §6.4, FC2, FC3) ----

    /** FC2's view: the same object every call, with a monotonic `rev`. */
    view() { return this._v; }

    /**
     * The settle's request — `frameId, q "e", Zq, i0..j1`, the same object every call, valid
     * only while `settlePending` is true. It is a REQUEST and not a mapping: it carries no `s`,
     * no `d` and no affine, because the settle's mapping is published (as `view()`) only when
     * the whole settled screenful is in hand (D154, FC2). A caller packs the plates named here
     * at `Zq` and keys them `"e"`; it never reads the zoom back off the camera.
     */
    settleRequest() { return this._req; }
    /** The preview's request (R2); valid while `status().prevQ` is not `""`. */
    previewRequest() { return this._prev; }

    /**
     * The incoming quantum's request while the view is HELD at the old one (§6.3) — `frameId`,
     * the new numeric `q`, its `Zq` and the range, the same object every call, valid only while
     * `report().pendQ` is not `""`. Like `settleRequest()` it is a REQUEST and not a mapping: the
     * view still publishes the held quantum's affine until this quantum's visible set is complete.
     */
    quantumRequest() { return this._pend; }

    /**
     * What is LIVE, as one stable object mutated in place (FC5): the published quantum, the
     * incoming one, the held one and whether a settle is waiting. The renderer reads it once a
     * camera step to see which `q` has DIED, because that is the one thing the callbacks cannot
     * say — `onPlates` fires only when there ARE misses, so silence is ambiguous — and a dead
     * quantum's queued strips are dropped with `dropQueued(why, deadQ)` (§10 stage 5b items 16
     * and 17). `pendQ` and `heldQ` are `""` for none, never null, as `report()`'s are.
     *
     * Added at stage 5b (§15.3 Q2) so that nothing outside this module reads a private or
     * allocates a ~50-field `report()` on the render path.
     */
    status() {
        const s = this._st || (this._st = { q: 0, pendQ: "", heldQ: "", prevQ: "", settlePending: false });
        s.q = this._v.q;
        s.pendQ = this._pendLive ? this._pend.q : "";
        s.prevQ = this._prevLive ? this._prev.q : "";
        s.heldQ = this._hold ? this._hold.q : "";
        s.settlePending = this._settlePending;
        return s;
    }

    /**
     * The layer canvas, for §6.5's synchronous path alone: in sync mode `s` is 1, so `compose`
     * takes the 1:1 branch and this canvas is idle, and the renderer rasters the screen's plates
     * into it at their grid positions and hands it to `compose` as ONE entry at `(i0, j0)`
     * (§15.3 Q1). Zero extra memory, because the alternative is a second 25 MB surface.
     *
     * **Sync mode and a hold are mutually exclusive by construction** (`_frame`: the sync branch
     * ends any hold and `_onQuantumChange` is reachable only from the plate branch), so this can
     * never overwrite a held picture. The layer is marked dirty because what is in it is no
     * longer the plate grid a scaled compose would blit.
     *
     * @returns {object|null} the layer canvas, or null where none could be allocated
     */
    syncSurface() {
        const L = this._ensureLayer();
        this._layerDirty = true;
        return L;
    }

    /**
     * The composite mapping for this camera step — **the only entry that maps the camera** (FC3;
     * `_switchQuantum`'s guard reads the zoom but maps nothing, D188). `chords` is the visible
     * chord estimate, computed during the cull by the renderer (§6.5, §15.3 Q9); it decides the
     * synchronous path and nothing else.
     *
     * @param {object} [cam] defaults to the injected camera
     * @param {number} [chords] the visible chord estimate
     * @returns {object} the published view
     */
    frameFor(cam, chords) {
        const c = cam || this.cam;
        const v = this._frame(c, chords, 0);
        if (this._prevLive) this._askPreview(c);                  // R2: first, at prio 0
        if (this._hold && this._pendLive) this._askQuantum(c);      // §6.3's retention, once a step
        return v;
    }

    /**
     * `stage` is 0 for a camera step, 1 for the settle's ask (fills `this._req`, publishes
     * nothing), 2 for the settle's publish, 3 for the incoming quantum's ask (fills `this._pend`,
     * publishes nothing) and 4 for the quantum switch's publish. All five MAP the camera HERE and
     * nowhere else, which is what keeps one snap in one place. One camera field is read outside
     * this method and becomes no mapping: the zoom `_switchQuantum`'s guard bounds its stretch
     * against, taken through `stretchOf` from the same `cam` and `dpr` stage 4 uses (D188).
     *
     * **Only stage 0 derives a quantum.** Stages 2 and 4 publish a quantum they are given —
     * `"e"` and `_pend.q` — because a publish that re-derived it would apply the hysteresis to
     * `_qPrev` again and could CROSS (D183).
     */
    _frame(cam, chords, stage) {
        const v = this._v;
        if (!cam) return v;
        const dpr = this.dpr;
        const frameId = cam.frame;
        let Z = cam.inScale * dpr;
        if (!(Z > 0) || !isFinite(Z)) { if (stage === 0) pictureStats.badZoom++; Z = 1; }   // once a camera step: the asks re-read the same camera

        let moved = false;
        if (stage === 0) {
            moved = this._moved(cam, frameId);
            if (!moved) { if (this._settleDone) return v; } else this._onMove();
        }

        let q, Zq, s = 1, mode, qLive = 0, ZqLive = 1, quantised = false;
        if (stage === 3 || stage === 5) {
            const p = stage === 3 ? this._pend : this._prev;      // the incoming quantum's ask, or the preview's
            q = p.q; Zq = p.Zq; s = 1; mode = "plates";
        } else if (stage === 4) {
            // The switch publishes the quantum it switched TO, from `_pend` and not from the
            // camera: `quantumFor` here would measure the hysteresis against `_qPrev` again, and
            // a camera that has drifted 0.75 of a quantum since the last `frameFor` — an arrival
            // runs off the rAF cycle — would cross, hold the DYING quantum a second time and
            // compose the incoming plates against its `Zq`, which is a paper screen (D183).
            q = this._pend.q; Zq = this._pend.Zq; mode = "plates";
            quantised = true;                                  // `s` is taken once, below the clip
        } else if (stage) {
            q = "e"; Zq = Z; s = 1; mode = "settle";               // the settle: the exact zoom (D24)
        } else if (this._syncSwitch(chords)) {
            if (this._hold) this._endHold("sync");                 // exact and composed: nothing to hold
            q = "s"; Zq = Z; s = 1; mode = "sync";                 // §6.5: exact, composed, never cached
        } else {
            const qf = quantumFor(cam.inScale, dpr, this._qPrev);
            if (this._qPrev != null && qf.q !== this._qPrev) {
                pictureStats.quantumChanges++;
                this._onQuantumChange(qf, frameId);                // §6.3: hold the old, request the new
            }
            this._qPrev = qf.q;
            if (this._hold && this._hold.frameId !== frameId) this._endHold("frame");
            if (this._v.frameId != null && this._v.frameId !== frameId) this._aimPreview(qf.q, frameId);   // a crossing: the new frame from paper
            qLive = qf.q; ZqLive = qf.Zq;
            // The HELD quantum is published while the incoming one is rastered: `s` then runs
            // past the hysteresis band and the picture is stretched, which §6.3 prefers to paper.
            q = this._hold ? this._hold.q : qf.q;
            Zq = this._hold ? this._hold.Zq : qf.Zq;
            mode = "plates";
            quantised = true;                                      // `s` is taken once, below the clip
        }

        // One definition of the viewport, the engine's; a disagreement with the canvas's own
        // size is counted rather than silently dropping a column of plates (§15.3 Q11).
        const win = cam.frameWindow(0);
        if (stage === 0 && cam.lm
            && (Math.abs(cam.lm.width - this.cssW) > 0.5 || Math.abs(cam.lm.height - this.cssH) > 0.5)) {
            pictureStats.sizeMismatch++;                           // once a camera step, not once an ask
        }
        let r = plateRange(win, Zq);

        if (stage === 1 || stage === 3 || stage === 5) {          // the ask: the store's request only
            const q1 = stage === 1 ? this._req : stage === 3 ? this._pend : this._prev;
            q1.frameId = frameId; q1.Zq = Zq;
            if (stage === 1) q1.q = "e";
            q1.i0 = r.i0; q1.i1 = r.i1; q1.j0 = r.j0; q1.j1 = r.j1;
            return null;
        }

        // The held view publishes only the plates it HAS: the held range clipped to the screen.
        // Two things follow — the renderer's `want(view)` asks for nothing at the dying quantum
        // (§15.3's "only the newest quantum is ever requested"), and the range cannot outgrow the
        // layer canvas at a stretch below `S_MIN` (D158's own failure, which a zoom OUT would
        // otherwise reach). A pan that leaves the held set behind ends the hold instead.
        if (quantised) s = stretchOf(Z, Zq);
        let full = r;                                              // the screen's own range, before any clip
        if (this._hold) {
            const h = this._hold, g = this._rHold;
            // The stretch is bounded upward (`S_MAX_HOLD`, D174): past one octave the held
            // picture is a smear and the live quantum — paper, until its plates arrive — is
            // published instead. The pending request is KEPT: its plates are the live quantum's
            // and the published view wants them, so they compose as ordinary arrivals.
            if (s > S_MAX_HOLD || s < S_MIN_HOLD) {
                if (s > S_MAX_HOLD) { this._endHold("stretch"); pictureStats.holdBreaks++; }
                else { this._endHold("shrink"); pictureStats.holdShrinks++; }
                q = qLive; Zq = ZqLive;
                r = full = plateRange(win, Zq);
                s = stretchOf(Z, Zq);
            } else {
                g.i0 = Math.max(r.i0, h.i0); g.i1 = Math.min(r.i1, h.i1);
                g.j0 = Math.max(r.j0, h.j0); g.j1 = Math.min(r.j1, h.j1);
                if (g.i0 > g.i1 || g.j0 > g.j1) {
                    this._endHold("offscreen");
                    q = qLive; Zq = ZqLive;
                    r = full = plateRange(win, Zq);
                    s = stretchOf(Z, Zq);
                } else r = g;
            }
        }
        const rf = this._rFull;
        rf.i0 = full.i0; rf.i1 = full.i1; rf.j0 = full.j0; rf.j1 = full.j1;

        // `o` is the plate grid's own origin in plate pixels, in EVERY mode, so no reader
        // branches on the mode; `d = round(P + o·s)` is what makes X = (p·Zq − o)·s + d equal
        // the true p·Z + P (§2.7 FC2, §15.3 Q6a).
        const ox = plateOriginPx(r.i0), oy = plateOriginPx(r.j0);
        const dx = snapPx(cam.inPanX * dpr + ox * s);
        const dy = snapPx(cam.inPanY * dpr + oy * s);

        const setMoved = v.frameId !== frameId || v.q !== q || v.i0 !== r.i0 || v.i1 !== r.i1
            || v.j0 !== r.j0 || v.j1 !== r.j1 || v.ox !== ox || v.oy !== oy;
        const changed = setMoved || v.mode !== mode || v.Zq !== Zq || v.Z !== Z || v.s !== s
            || v.dx !== dx || v.dy !== dy || v.dpr !== dpr || v.cssW !== this.cssW || v.cssH !== this.cssH;
        if (!changed) { if (moved) this._maybeArm(mode, s); return v; }

        // The layer's content is the plates drawn at `i·512 − o`: it depends on the plate set and
        // on `o`, never on `d`. Recomposing on a `d` change is the thrash `layerRecomposes`
        // counts (§15.3 Q6b).
        if (setMoved || v.dpr !== dpr || v.cssW !== this.cssW || v.cssH !== this.cssH) this._layerDirty = true;
        if ((v.mode === "sync") !== (mode === "sync")) pictureStats.syncFlips++;

        v.mode = mode; v.frameId = frameId; v.q = q; v.Zq = Zq; v.Z = Z; v.s = s;
        v.ox = ox; v.oy = oy; v.dx = dx; v.dy = dy;
        v.dpr = dpr; v.cssW = this.cssW; v.cssH = this.cssH;
        v.i0 = r.i0; v.i1 = r.i1; v.j0 = r.j0; v.j1 = r.j1;
        v.k = Zq * s; v.tx = dx - ox * s; v.ty = dy - oy * s;
        v.rev++;
        if (moved) this._maybeArm(mode, s);
        return v;
    }

    /**
     * The settle's timer: armed on a camera step that leaves the picture stretched, cleared by
     * the next one. `frameFor` arms it — the renderer calls nothing extra, so a renderer that
     * forgets a call cannot leave the picture permanently soft.
     *
     * **Not while a hold is in flight** (D179): a held view is stretched by definition, so the
     * settle would ask for a THIRD screenful at `q = "e"` beside the held and incoming sets —
     * 72 plates wanted against the phone's 48-plate cap, which D170 raised for two. The hold
     * ends into a switch, a break or an end of its own, and each of those re-arms here.
     */
    _maybeArm(mode, s) {
        this._clear();
        if (this._hold) return false;
        if (mode !== "plates" || s === 1 || !this.store) return false;
        this._timer = this._setTimer(this._fire, this.settleMs);
        return true;
    }

    /** Did the camera, the frame or the canvas size move since the last `frameFor`? */
    _moved(cam, frameId) {
        const c = this._cam0;
        const moved = c.sized || c.frameId !== frameId || c.inScale !== cam.inScale
            || c.panX !== cam.inPanX || c.panY !== cam.inPanY;
        c.sized = false; c.frameId = frameId; c.inScale = cam.inScale;
        c.panX = cam.inPanX; c.panY = cam.inPanY;
        return moved;
    }

    /**
     * The camera moved: the settled plates are dropped **before anything else**, because the
     * `"e"` key carries no zoom of its own and an undropped settled plate is a hit at a zoom it
     * was never rastered for (D83, §6.3).
     */
    _onMove() {
        // `unpinAdded` is safe here and only here: a settle cannot be live while a hold is
        // (D179), and a hold's own pins are re-added by `_askQuantum` later in this same
        // `frameFor`, before anything can evict. What it clears is the half `dropQuantum` cannot:
        // the keys of settled plates that were never cached — a miss still in flight, or one
        // nothing ever posted — because `dropQuantum` unpins only the plates it drops (D178).
        if (this._eLive && this.store) { this.store.dropQuantum("e"); this.store.unpinAdded(); pictureStats.settleDrops++; }
        // The composed set WAS the settled one and its bitmaps are closed by that drop; the
        // renderer's next compose hands over the quantum's hits.
        if (this._settleDone) this._nHits = 0;
        this._eLive = false;
        this._settlePending = false;
        this._settleDone = false;
        this._clear();
    }

    /** §6.5's switch, with 2× up / 1× down so it cannot flap frame to frame. */
    _syncSwitch(chords) {
        const n = chords;
        if (n == null || !isFinite(n) || n < 0) return false;      // no estimate: the plate path
        // Measured, not estimated (D272): a slow sync frame leaves the path, and it is re-entered
        // only on a screen the estimate puts at half the chords it was slow at.
        if (this._sync && this._syncMs > this.syncMaxMs) {
            this._sync = false; this._syncSlowAt = n; this._syncMs = 0;
            pictureStats.syncCostExits++;
            return false;
        }
        if (!this._sync && this._syncSlowAt >= 0 && n >= this._syncSlowAt / 2) return false;
        this._sync = this._sync ? n <= 2 * this.syncBudget : n < this.syncBudget;
        if (this._sync) this._syncSlowAt = -1;
        return this._sync;
    }

    /** The renderer's measure of the last sync frame's core phases, in ms (`_renderSync`, D272). */
    noteSyncCost(ms) { this._syncMs = ms > 0 ? ms : 0; }

    // ---- the composite (§6.2) ----

    /**
     * The picture we can show now: paper, or the last picture carried where nothing else covers
     * (§10.13); the stand-ins; this view's plates; the drag plane. Takes **no camera** (FC3): it
     * reads the cached view and the hits it was last handed.
     *
     * @param {object[]} [plates] `PlateStore.want`'s `hits`; omitted, the last set is recomposed
     * @returns {number} `drawImage` calls made
     */
    compose(plates) {
        const t0 = perfNow();
        const n = this._compose(plates);
        pictureStats.composeMs += perfNow() - t0;
        if (n > pictureStats.maxImagesPerCompose) pictureStats.maxImagesPerCompose = n;
        return n;
    }
    _compose(plates) {
        if (plates) this._setHits(plates);
        const v = this._v, ctx = this._ctx, c = this._canvas;
        pictureStats.composes++;
        this._covered = false;
        this._screenCovered = false;
        this._nFb = 0;
        this._fbDrawn = 0;
        this._fbRan = false;
        if (this._hold) {                                          // §6.3's two numbers, for stage 7
            pictureStats.heldComposes++;
            if (v.s > pictureStats.holdMaxS) pictureStats.holdMaxS = v.s;
            if (pictureStats.holdMinS === 0 || v.s < pictureStats.holdMinS) pictureStats.holdMinS = v.s;
        }
        if (!ctx || !c) { pictureStats.noContext++; return 0; }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // The screen in this view's plate units: a cell is judged on its on-screen part.
        const S = this._scr || (this._scr = [0, 0, 0, 0]);
        S[0] = ((0 - v.dx) / v.s + v.ox) / PLATE_PX; S[1] = ((0 - v.dy) / v.s + v.oy) / PLATE_PX;
        S[2] = ((c.width - v.dx) / v.s + v.ox) / PLATE_PX; S[3] = ((c.height - v.dy) / v.s + v.oy) / PLATE_PX;
        // What covers the screen is known before anything is drawn: this view's plates, then the
        // stand-ins at other zooms. Where neither does, the LAST picture, re-mapped to this view,
        // stays under everything instead of paper (§10.13); paper is what nothing has ever shown.
        this._nCy = 0;
        this._nPR = 0;                                             // the drag plane's drawn rects, this compose
        const sync = v.mode === "sync";                            // one surface, the exact screen: nothing to plan
        if (!sync) this._planFallbacks(v);
        let carried = false;
        if (!sync && this._carry && (this._fbRan || !this._rangeCovered(v)) && !this._screenCoverOf(v, false)) carried = this._drawCarry(ctx, c, v);
        if (!carried) {
            ctx.fillStyle = this.paper;
            ctx.fillRect(0, 0, c.width, c.height);                 // first, when nothing is carried (§6.2)
            pictureStats.paperFills++;
        }
        // The fallbacks go UNDER the view's plates, on the ink canvas, in both branches: the layer
        // canvas is sized for the screen at the view's own quantum, so the ring a held view
        // leaves outside its clipped range has no pixels there to be drawn into (D158).
        let n = this._drawFallbacks(ctx, v);
        const under = carried || this._fbDrawn > 0;                // something older under an empty plate's cell
        if (v.s === 1) {
            ctx.imageSmoothingEnabled = false;                     // an exact copy
            let inR = 0, stale = 0;                                // drawn AND inside the range: `_covered`
            const pb = this._planeBelow(v);
            for (let i = 0; i < this._nHits; i++) {
                const p = this._hits[i];
                const u = this._usable(p, v);
                if (!u || u === 3) continue;                       // 3 is a fallback's, never a hit's
                if (pb && pb.cells.has(Math.floor(p.i / pb.d) + "," + Math.floor(p.j / pb.d))) {
                    if (this._inRange(p, v)) inR++;                // the plane's BELOW draws this cell whole
                    continue;
                }
                if (u === 1) {
                    ctx.drawImage(p.bitmap, plateOriginPx(p.i) - v.ox + v.dx, plateOriginPx(p.j) - v.oy + v.dy);
                    n++;
                    if (this._isStale(p)) stale++;
                } else if (under) {                                // an empty plate IS the paper: over the carry and the stand-ins
                    ctx.fillStyle = this.paper;
                    ctx.fillRect(plateOriginPx(p.i) - v.ox + v.dx, plateOriginPx(p.j) - v.oy + v.dy, PLATE_PX, PLATE_PX);
                }
                if (this._inRange(p, v)) inR++;
            }
            pictureStats.plateBlits += n - this._fbDrawn;
            pictureStats.stalePlateBlits += stale;
            if (stale) pictureStats.staleComposes++;
            this._covered = this._rangeCount(v) > 0 && inR >= this._rangeCount(v);
        } else {
            const L = this._ensureLayer();
            if (!L || !this._lctx) { pictureStats.blits += n; return n; }
            if (this._layerDirty) { this._layerDrawn = this._recomposeLayer(L, v); }
            this._covered = this._rangeCount(v) > 0 && this._layerDrawn >= this._rangeCount(v);
            ctx.imageSmoothingEnabled = true;
            // Only the PUBLISHED range's own sub-rectangle of the layer is blitted: `o` is that
            // range's origin, so it starts at layer (0, 0), and the layer's unused margin is
            // transparent — blitting it whole would put the layer's own empty area over the ring
            // the fallback pass has just drawn there.
            const rw = Math.min(L.width, (v.i1 - v.i0 + 1) * PLATE_PX);
            const rh = Math.min(L.height, (v.j1 - v.j0 + 1) * PLATE_PX);
            if (rw > 0 && rh > 0) {
                ctx.drawImage(L, 0, 0, rw, rh, v.dx, v.dy, rw * v.s, rh * v.s);
                n++;
            }
        }
        n += this._composePlane(ctx, v);
        // Where the cover pass did not even scan, the screen IS the published range and the two
        // numbers are the same; where it did — or the range is short, a settled view's included —
        // the honest answer costs ≤ 28 cells × ≤ 52 tests.
        this._uncovered = 0;
        this._screenCovered = sync || (this._fbRan || carried || !this._covered ? this._screenCoverOf(v, carried) : this._covered);
        if (this._uncovered > 0) {
            pictureStats.paperComposes++;
            if (this._uncovered > pictureStats.paperCellsMax) pictureStats.paperCellsMax = this._uncovered;
        }
        this._keepCarry(v, c);
        pictureStats.blits += n;
        return n;
    }

    /** Does this view's own range have a drawable plate in every cell? */
    _rangeCovered(v) {
        const cells = this._rangeCount(v);
        let inR = 0;
        for (let i = 0; i < this._nHits; i++) {
            const p = this._hits[i];
            const u = this._drawable(p, v);
            if ((u === 1 || u === 2) && this._inRange(p, v)) inR++;
        }
        return cells > 0 && inR >= cells;
    }

    /** The carried picture's affine from its own device px to this view's: `X' = X·sc + o`, or null. */
    _carryXf(v) {
        const C = this._carry;
        if (!C || !(C.k > 0) || !(v.k > 0)) return null;
        let a = 1, bx = 0, by = 0;
        if (C.frameId !== v.frameId) {
            const m = this._mapFrame(C.frameId);
            if (!m) return null;
            a = m.a; bx = m.bx; by = m.by;
        }
        const sc = (a * v.k) / C.k;
        if (!(sc > 0) || sc > CARRY_MAX_SC || sc < 1 / CARRY_MAX_SC) return null;   // a stand-in's window, no wider
        const ox = (-(C.tx / C.k) * a + bx) * v.k + v.tx, oy = (-(C.ty / C.k) * a + by) * v.k + v.ty;
        return isFinite(ox) && isFinite(oy) ? { sc, ox, oy } : null;
    }

    /**
     * Draw the last picture re-mapped to this view, with paper only outside it. The canvas is its own
     * source (a copy is taken first; `copy` so nothing of it is left untransformed). Its ink boxes, in
     * this view's plate units, go to `_cyB` for the coverage count. False when nothing carries over.
     */
    _drawCarry(ctx, c, v) {
        const t = this._carryXf(v);
        if (!t) return false;
        const B = this._carry.boxes, Y = this._cyB, u = (X, dx, o) => ((X - dx) / v.s + o) / PLATE_PX;
        let n = 0;
        for (let k = 0; k < B.length; k += 4) {
            Y[4 * n] = u(B[k] * t.sc + t.ox, v.dx, v.ox); Y[4 * n + 1] = u(B[k + 1] * t.sc + t.oy, v.dy, v.oy);
            Y[4 * n + 2] = u(B[k + 2] * t.sc + t.ox, v.dx, v.ox); Y[4 * n + 3] = u(B[k + 3] * t.sc + t.oy, v.dy, v.oy);
            n++;
        }
        this._nCy = n;
        if (!n) return false;
        const W = c.width, H = c.height, Dt = this._carry.dirty;
        if (Math.abs(t.sc - 1) > 1e-9 || Math.abs(t.ox) > 1e-6 || Math.abs(t.oy) > 1e-6) {
            ctx.save();
            ctx.globalCompositeOperation = "copy";
            ctx.imageSmoothingEnabled = true;
            ctx.setTransform(t.sc, 0, 0, t.sc, t.ox, t.oy);
            ctx.drawImage(c, 0, 0);
            ctx.restore();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = this.paper;
            const x0 = Math.max(0, Math.floor(t.ox)), y0 = Math.max(0, Math.floor(t.oy));
            const x1 = Math.min(W, Math.ceil(t.ox + W * t.sc)), y1 = Math.min(H, Math.ceil(t.oy + H * t.sc));
            if (x0 >= x1 || y0 >= y1) ctx.fillRect(0, 0, W, H);
            else {
                if (y0 > 0) ctx.fillRect(0, 0, W, y0);
                if (y1 < H) ctx.fillRect(0, y1, W, H - y1);
                if (x0 > 0) ctx.fillRect(0, y0, x0, y1 - y0);
                if (x1 < W) ctx.fillRect(x1, y0, W - x1, y1 - y0);
            }
            pictureStats.carryShifted++;
        }
        if (Dt) {                                                  // what the drag plane drew there is no picture of the document
            ctx.fillStyle = this.paper;
            for (let k = 0; k < Dt.length; k += 4) {
                const x0 = Dt[k] * t.sc + t.ox, y0 = Dt[k + 1] * t.sc + t.oy;
                ctx.fillRect(x0, y0, (Dt[k + 2] - Dt[k]) * t.sc, (Dt[k + 3] - Dt[k + 1]) * t.sc);
            }
        }
        pictureStats.carryComposes++;
        return true;
    }

    /** What this compose leaves on the canvas for the next one to carry: its view, and the boxes that hold ink. */
    _keepCarry(v, c) {
        const rf = this._rFull, P = this._pR, np = this._nPR;
        if (!(v.k > 0) || rf.i0 > rf.i1 || rf.j0 > rf.j1) { this._carry = null; return; }
        const boxes = [];
        const onPlane = (x0, y0, x1, y1) => {                     // a cell the drag plane drew into is not carried
            for (let k = 0; k < 4 * np; k += 4) if (P[k] < x1 && P[k + 2] > x0 && P[k + 1] < y1 && P[k + 3] > y0) return true;
            return false;
        };
        if (this._uncovered === 0 && !np) boxes.push(0, 0, c.width, c.height);
        else if ((rf.i1 - rf.i0 + 1) * (rf.j1 - rf.j0 + 1) <= SCREEN_CELLS_MAX) {
            const w = PLATE_PX * v.s;
            for (let j = rf.j0; j <= rf.j1; j++) {
                for (let i = rf.i0; i <= rf.i1; i++) {
                    if (!this._cellCovered(i, j, v, this._nCy > 0)) continue;
                    const x = (plateOriginPx(i) - v.ox) * v.s + v.dx, y = (plateOriginPx(j) - v.oy) * v.s + v.dy;
                    if (np && onPlane(x, y, x + w, y + w)) continue;
                    boxes.push(x, y, x + w, y + w);
                }
            }
        }
        this._carry = boxes.length ? { frameId: v.frameId, k: v.k, tx: v.tx, ty: v.ty, boxes, dirty: np ? P.slice(0, 4 * np) : null } : null;
    }

    /** A different picture is coming (a load, a reset): the canvas holds nothing to carry. */
    dropCarry() { if (this._carry) pictureStats.carryDropped++; this._carry = null; this._nCy = 0; }

    /**
     * The stand-ins at other zooms and frames this compose will draw, coarsest first (PAPER-PLAN
     * R1), cut to `_fbBudget`'s image budget. Only when this view's plates leave the screen short,
     * in plates or settle mode; a settled view's `"e"` plates never stand in (D83).
     *
     * @returns {number} stand-ins planned
     */
    _planFallbacks(v) {
        this._fbRan = false;
        this._nFb = 0;
        // A settled view is the exact screen, but after a release or an eviction it can be short
        // of its own plates: numeric-quantum stand-ins may cover it (`"e"` never stands in, D83).
        if ((v.mode !== "plates" && v.mode !== "settle") || !this.store) return 0;
        const rf = this._rFull;
        const clipped = rf.i0 !== v.i0 || rf.i1 !== v.i1 || rf.j0 !== v.j0 || rf.j1 !== v.j1;
        if (!clipped && this._rangeCovered(v)) return 0;          // the screen is covered: pay nothing
        this._fbRan = true;
        rf.frameId = v.frameId; rf.q = v.q; rf.Zq = v.Zq;
        const nf = this.store.fallbackCover(rf, this._fb, this._mapFrameFn);
        pictureStats.fallbackScans++;
        let n = 0;
        const B = this._fbB, D = this._fbD || (this._fbD = []);
        for (let k = 0; k < nf; k++) {
            const p = this._fb[k];
            // An empty plate (no ink there at its quantum) covers its box and draws nothing.
            const empty = !p.bitmap;
            if (empty ? !this._emptyCover(p, v) : this._drawable(p, v) !== 3) { pictureStats.fallbackRefused++; continue; }
            // The plate's corner in the VIEW frame's units, through R5a's affine (a = 1, b = 0 at home).
            const m = p.frameId === v.frameId ? null : this._mapFrame(p.frameId);
            const a = m ? m.a : 1;
            const t = (PLATE_PX / p.Zq) * a;
            const fx = p.i * t + (m ? m.bx : 0), fy = p.j * t + (m ? m.by : 0);
            const r = (t * v.Zq) / PLATE_PX;                       // Zq_view / the plate's effective Zq
            const X0 = (fx * v.Zq) / PLATE_PX, Y0 = (fy * v.Zq) / PLATE_PX;
            B[4 * n] = X0; B[4 * n + 1] = Y0; B[4 * n + 2] = X0 + r; B[4 * n + 3] = Y0 + r;
            D[3 * n] = fx; D[3 * n + 1] = fy; D[3 * n + 2] = r;
            this._fb[n++] = p;                                     // compacted: what `screenCovered` reads
        }
        if (n > FB_DRAW_MIN) n = this._fbBudget(v, n);
        this._fb.length = n;
        this._nFb = n;
        return n;
    }

    /**
     * The planned stand-ins cut to what shows: those off the screen or wholly under this view's own
     * plates are dropped, and past the compose's image budget (COMPOSE_IMAGES) a greedy cover — the
     * plate covering the most needy cells whole, until none does — is kept first, then the zooms
     * nearest the view's. `_fb`, `_fbB` and `_fbD` are compacted in their coarse-to-fine order.
     *
     * @returns {number} stand-ins kept
     */
    _fbBudget(v, n) {
        const S = this._scr, rf = this._rFull, B = this._fbB, D = this._fbD;
        const W = rf.i1 - rf.i0 + 1, H = rf.j1 - rf.j0 + 1;
        if (!S || W <= 0 || H <= 0 || W * H > SCREEN_CELLS_MAX) return n;
        let other = 1;                                             // the carry
        if (v.s === 1) { for (let k = 0; k < this._nHits; k++) if (this._hits[k] && this._hits[k].bitmap) other++; }
        else other++;                                              // the layer
        const pl = this._plane, lv = pl && pl.showing ? (pl.cur || pl.stop) : null;
        if (lv) for (const L of lv.layers) other += L.cells.length;
        const cap = Math.max(FB_DRAW_MIN, COMPOSE_IMAGES - other);
        // need: a cell on screen that no plate of this view's own covers
        const need = this._fbNeed || (this._fbNeed = []);
        need.length = W * H;
        for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {
                const on = Math.max(rf.i0 + i, S[0]) < Math.min(rf.i0 + i + 1, S[2]) && Math.max(rf.j0 + j, S[1]) < Math.min(rf.j0 + j + 1, S[3]);
                need[j * W + i] = on ? 1 : 0;
            }
        }
        for (let k = 0; k < this._nHits; k++) {
            const p = this._hits[k];
            if (!p || p.i < rf.i0 || p.i > rf.i1 || p.j < rf.j0 || p.j > rf.j1) continue;
            const u = this._drawable(p, v);
            if (u === 1 || u === 2) need[(p.j - rf.j0) * W + (p.i - rf.i0)] = 0;
        }
        // keep: 0 dropped, 1 a candidate, 2 chosen by the cover
        const keep = this._fbKeep || (this._fbKeep = []), A = this._fbA || (this._fbA = []);
        keep.length = n; A.length = n;
        let m = 0, imgs = 0;
        for (let k = 0; k < n; k++) {
            keep[k] = 0;
            const x0 = Math.max(B[4 * k], S[0]), x1 = Math.min(B[4 * k + 2], S[2]);
            const y0 = Math.max(B[4 * k + 1], S[1]), y1 = Math.min(B[4 * k + 3], S[3]);
            if (x0 >= x1 || y0 >= y1) continue;
            A[k] = (x1 - x0) * (y1 - y0);
            const i0 = Math.max(rf.i0, Math.floor(x0)), i1 = Math.min(rf.i1, Math.ceil(x1) - 1);
            const j0 = Math.max(rf.j0, Math.floor(y0)), j1 = Math.min(rf.j1, Math.ceil(y1) - 1);
            for (let j = j0; j <= j1 && !keep[k]; j++) {
                for (let i = i0; i <= i1; i++) if (need[(j - rf.j0) * W + (i - rf.i0)]) { keep[k] = 1; break; }
            }
            if (keep[k]) { m++; if (this._fb[k].bitmap) imgs++; }
        }
        pictureStats.fallbackCulled += n - m;
        if (imgs > cap) {
            let c = 0;
            while (c < cap) {
                let best = -1, bestN = 0;
                for (let k = 0; k < n; k++) {
                    if (keep[k] !== 1) continue;
                    const cn = this._fbCovers(k, need, W, false);
                    if (cn > bestN || (cn > 0 && cn === bestN && Math.abs(Math.log2(D[3 * k + 2])) < Math.abs(Math.log2(D[3 * best + 2])))) { best = k; bestN = cn; }
                }
                if (best < 0) break;
                keep[best] = 2;
                if (this._fb[best].bitmap) c++;
                this._fbCovers(best, need, W, true);
            }
            // The rest by the nearest zoom (to a quantum), then the larger on-screen part.
            const ord = this._fbOrd2 || (this._fbOrd2 = []);
            ord.length = 0;
            for (let k = 0; k < n; k++) if (keep[k] === 1) ord.push(k);
            const dq = (k) => Math.floor(Math.abs(Math.log2(D[3 * k + 2])) * QUANTA_PER_OCTAVE + 1e-6);   // quanta from the view's
            ord.sort((a, b) => (dq(a) - dq(b)) || (A[b] - A[a]) || (a - b));
            for (const k of ord) {
                if (!this._fb[k].bitmap) continue;                 // an empty plate costs no image
                if (c < cap) c++; else { keep[k] = 0; pictureStats.fallbackOverBudget++; }
            }
        }
        let w = 0;
        for (let k = 0; k < n; k++) {
            if (!keep[k]) continue;
            if (w !== k) {
                this._fb[w] = this._fb[k];
                for (let t = 0; t < 4; t++) B[4 * w + t] = B[4 * k + t];
                for (let t = 0; t < 3; t++) D[3 * w + t] = D[3 * k + t];
            }
            w++;
        }
        return w;
    }

    /** Needy cells whose on-screen part stand-in `k`'s box holds whole; with `mark`, they need no more. */
    _fbCovers(k, need, W, mark) {
        const B = this._fbB, S = this._scr, rf = this._rFull, eps = 1e-9;
        const bx0 = B[4 * k], by0 = B[4 * k + 1], bx1 = B[4 * k + 2], by1 = B[4 * k + 3];
        const i0 = Math.max(rf.i0, Math.floor(bx0)), i1 = Math.min(rf.i1, Math.ceil(bx1) - 1);
        const j0 = Math.max(rf.j0, Math.floor(by0)), j1 = Math.min(rf.j1, Math.ceil(by1) - 1);
        let n = 0;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const c = (j - rf.j0) * W + (i - rf.i0);
                if (!need[c]) continue;
                const x0 = Math.max(i, S[0]), x1 = Math.min(i + 1, S[2]), y0 = Math.max(j, S[1]), y1 = Math.min(j + 1, S[3]);
                if (bx0 <= x0 + eps && bx1 >= x1 - eps && by0 <= y0 + eps && by1 >= y1 - eps) { n++; if (mark) need[c] = 0; }
            }
        }
        return n;
    }

    /**
     * The planned stand-ins, coarsest first, under the view's own plates (PAPER-PLAN R1).
     * @returns {number} `drawImage` calls made
     */
    _drawFallbacks(ctx, v) {
        const n = this._nFb, D = this._fbD;
        if (!n) { this._fbDrawn = 0; return 0; }
        ctx.imageSmoothingEnabled = true;                          // a fallback is a resample by definition
        let drawn = 0;
        for (let k = 0; k < n; k++) {
            const p = this._fb[k];
            if (!p.bitmap) continue;
            const fx = D[3 * k], fy = D[3 * k + 1], r = D[3 * k + 2], w = PLATE_PX * r * v.s;
            ctx.drawImage(p.bitmap, (fx * v.Zq - v.ox) * v.s + v.dx, (fy * v.Zq - v.oy) * v.s + v.dy, w, w);
            if (r > pictureStats.fallbackMaxR) pictureStats.fallbackMaxR = r;
            if (p.frameId !== v.frameId) pictureStats.crossFrameBlits++;
            drawn++;
        }
        this._fbDrawn = drawn;
        pictureStats.fallbackBlits += drawn;
        if (drawn) pictureStats.fallbackComposes++;
        return drawn;
    }

    /** Will a settle publish a new view soon — its timer armed, or its plates asked for? */
    settleComing() { return this._timer != null || this._settlePending; }

    /** Is a zoom holding a quantum's plates (§6.3)? */
    holding() { return !!this._hold; }

    /**
     * The BELOW cells of a whole plane mid-drag, as `{cells, d}` with view cell (i, j) inside plane cell
     * (⌊i/d⌋, ⌊j/d⌋), or null: its plates draw those cells whole, so the view's own are not drawn under
     * them (a plane and the screen's plates together are past COMPOSE_IMAGES).
     */
    _planeBelow(v) {
        const pl = this._plane, lv = pl && pl.cur;
        if (!lv || pl.state !== "drag" || pl.partial || !lv.below || pl.frameId !== v.frameId || !this.store) return null;
        if (v.mode !== "plates" && v.mode !== "settle") return null;
        if (lv.pZq === v.Zq) return { cells: lv.below, d: 1 };
        const dq = typeof v.q === "number" && typeof lv.pq === "number" ? v.q - lv.pq : -1;
        return dq > 0 && dq % QUANTA_PER_OCTAVE === 0 ? { cells: lv.below, d: Math.pow(2, dq / QUANTA_PER_OCTAVE) } : null;
    }

    /** The drag plane to draw over the picture, or null (`RasterRenderer._planeStep`). */
    setPlane(p) { this._plane = p || null; }

    /** Does view cell (i, j) hold a fresh plate of the view's own quantum — the ink the document has now? */
    cellFresh(v, i, j) {
        if (!this.store) return false;
        const k = plateKey(v.frameId, v.q, i, j);
        const e = this.store.get(k);
        return !!e && !e.dead && this.store.isExact(e);
    }

    /**
     * The drag plane, last (PAPER-PLAN §10 S4z, §10.14): the drawn level's z layers in paint order
     * through §7.1's affine (a level may be coarser than the view), its selected layers alone while
     * it is partial, or the stopgap. Landing, all are clipped to the view cells whose own plate is
     * not fresh yet, so a cell that has its new plate shows it alone.
     *
     * @returns {number} `drawImage` calls made
     */
    _composePlane(ctx, v) {
        const pl = this._plane;
        if (!pl || !pl.showing || pl.frameId !== v.frameId || (v.mode !== "plates" && v.mode !== "settle") || !this.store) return 0;
        const lvl = pl.cur || pl.stop;
        if (!lvl || !lvl.layers.length) return 0;
        const f = v.Zq / lvl.pZq, w = PLATE_PX * f * v.s;
        let clipped = false;
        if (pl.state === "land") {
            const c = pl.landCells(v);
            if (!c) return 0;
            ctx.save();
            ctx.beginPath();
            let open = 0;
            for (let j = c.j0; j <= c.j1; j++) {
                for (let i = c.i0; i <= c.i1; i++) {
                    if (this.cellFresh(v, i, j)) continue;
                    ctx.rect((plateOriginPx(i) - v.ox) * v.s + v.dx, (plateOriginPx(j) - v.oy) * v.s + v.dy, PLATE_PX * v.s, PLATE_PX * v.s);
                    open++;
                }
            }
            if (!open) { ctx.restore(); return 0; }
            ctx.clip();
            clipped = true;
            pl.stats.clipComposes++;
        }
        pl.stats.composes++;
        ctx.imageSmoothingEnabled = f !== 1 || v.s !== 1;
        let n = 0;
        // In paint order: BELOW (opaque) over its cells, then each run — the selection's translated
        // by the drag, an overlying one in place — so the moved ink passes under what is above it.
        for (const L of lvl.layers) {
            if (pl.partial && L.kind !== "sel") continue;
            const moved = L.kind === "sel", dx = moved ? pl.off[0] : 0, dy = moved ? pl.off[1] : 0;
            for (const [i, j] of L.cells) {
                const e = L.bms ? L.bms.get(i + "," + j) : this.store.get(plateKey(pl.frameId, L.tag, i, j));
                if (!e || e.dead) continue;
                const x = (i * PLATE_PX * f - v.ox) * v.s + v.dx + dx, y = (j * PLATE_PX * f - v.oy) * v.s + v.dy + dy;
                if (e.bitmap) {
                    ctx.drawImage(e.bitmap, x, y, w, w); n++;
                    if (moved) pl.stats.inkBlits++; else if (L.kind === "over") pl.stats.overBlits++; else pl.stats.underBlits++;
                } else if (L.kind === "below" && !e.pixels && e.bytes === 0) {
                    ctx.fillStyle = this.paper;                // an empty BELOW plate IS paper
                    ctx.fillRect(x, y, w, w);
                } else continue;
                const R = this._pR || (this._pR = []);
                R[4 * this._nPR] = x; R[4 * this._nPR + 1] = y; R[4 * this._nPR + 2] = x + w; R[4 * this._nPR + 3] = y + w;
                this._nPR++;
            }
        }
        if (clipped) ctx.restore();
        return n;
    }

    /** An empty plate at another quantum or frame stands in as cover only: known ink-free there. */
    _emptyCover(p, v) {
        if (!p || p.dead || p.bitmap || p.pixels || p.bytes !== 0 || !Number.isFinite(p.q)) return false;
        if (!(p.Zq > 0) || !isFinite(p.Zq)) return false;
        return p.frameId === undefined || p.frameId === v.frameId || !!this._mapFrame(p.frameId);
    }

    /**
     * Is every screen cell covered — by this view's own plate, a stand-in holding the cell's on-screen
     * part whole, or (with `withCarry`) the carried picture? Sets `_uncovered`, the paper count;
     * `covered` is the narrower "the published range has its plates" the hold is decided on.
     */
    _screenCoverOf(v, withCarry = false) {
        const rf = this._rFull;
        if (rf.i0 > rf.i1 || rf.j0 > rf.j1) return false;
        const cells = (rf.i1 - rf.i0 + 1) * (rf.j1 - rf.j0 + 1);
        if (cells > SCREEN_CELLS_MAX) { pictureStats.coverRefused++; this._uncovered = cells; return false; }
        let paper = 0;                                             // counted, not short-cut: it is R5's measure
        for (let j = rf.j0; j <= rf.j1; j++) {
            for (let i = rf.i0; i <= rf.i1; i++) if (!this._cellCovered(i, j, v, withCarry)) paper++;
        }
        this._uncovered = paper;
        return paper === 0;
    }

    _cellCovered(i, j, v, withCarry = false) {
        for (let k = 0; k < this._nHits; k++) {
            const p = this._hits[k];
            if (p && p.i === i && p.j === j) { const u = this._drawable(p, v); if (u === 1 || u === 2) return true; }
        }
        // The cell's on-screen part: a cell the screen's edge cuts needs cover only where it shows.
        const S = this._scr;
        const x0 = S ? Math.max(i, S[0]) : i, y0 = S ? Math.max(j, S[1]) : j;
        const x1 = S ? Math.min(i + 1, S[2]) : i + 1, y1 = S ? Math.min(j + 1, S[3]) : j + 1;
        if (x0 >= x1 || y0 >= y1) return true;                     // wholly off screen
        const B = this._fbB, eps = 1e-9;                           // a mapped box is exact to rounding, not to the bit
        for (let k = 0; k < this._nFb; k++) {
            if (B[4 * k] <= x0 + eps && B[4 * k + 2] >= x1 - eps && B[4 * k + 1] <= y0 + eps && B[4 * k + 3] >= y1 - eps) return true;
        }
        if (withCarry) {
            const Y = this._cyB, e2 = 1e-6;                        // a carried box went through two affines
            for (let k = 0; k < this._nCy; k++) {
                if (Y[4 * k] <= x0 + e2 && Y[4 * k + 2] >= x1 - e2 && Y[4 * k + 1] <= y0 + e2 && Y[4 * k + 3] >= y1 - e2) return true;
            }
        }
        return false;
    }

    /**
     * R5a: frame `G`'s affine into the view's frame — `{a, bx, by}` with `p_F = p_G·a + b`, the
     * pair `TileStore._bakeDown` reads — or null where the lattice has no path. Memoised until the
     * view's frame or the lattice's addresses move (a subtree move re-addresses frames).
     */
    _mapFrame(G) {
        const F = this._v.frameId, lm = this.cam && this.cam.lm;
        if (!lm || F == null || typeof lm.frameFactor !== "function" || typeof lm.mapPointF !== "function") return null;
        const epoch = lm.addrEpoch || 0;
        if (this._mfF !== F || this._mfE !== epoch) { this._mf.clear(); this._mfF = F; this._mfE = epoch; }
        if (this._mf.has(G)) return this._mf.get(G);
        let m = null;
        const a = typeof lm.frame !== "function" || lm.frame(G) ? lm.frameFactor(G, F) : null;
        const b = a > 0 && isFinite(a) ? lm.mapPointF([0, 0], G, F) : null;
        if (b && isFinite(b[0]) && isFinite(b[1])) m = { a, bx: b[0], by: b[1] };
        this._mf.set(G, m);
        return m;
    }

    /** Screen cells the last compose left as paper (R5's measure; 0 when the plates covered it). */
    uncoveredCells() { return this._uncovered; }

    /** Is this record's ink behind the document? The store owns the fact; this is one reader. */
    _isStale(p) { return !!this.store && !this.store.isExact(p); }

    /** Plates in the published range: what a full screen costs, and what a held view is judged against. */
    _rangeCount(v) {
        const w = v.i1 - v.i0 + 1, h = v.j1 - v.j0 + 1;
        return w > 0 && h > 0 ? w * h : 0;
    }

    /**
     * The plates 1:1 into the layer canvas, at `i·512 − o`: no filtering across a plate boundary.
     * Returns the count drawn **from inside the published range**, which is what `_covered` —
     * and so the decision to hold a quantum — is read from: a plate outside the range is still
     * drawn (it is correct ink) but cannot stand in for one the range has and the hit list lost.
     */
    _recomposeLayer(L, v) {
        const lc = this._lctx;
        lc.setTransform(1, 0, 0, 1, 0, 0);
        // Cleared, so a cell with no plate shows the stand-in or the carry the ink canvas holds
        // under it (§7.1); an empty plate is filled with paper below, over them.
        lc.clearRect(0, 0, L.width, L.height);
        lc.imageSmoothingEnabled = false;
        let n = 0, stale = 0;
        for (let i = 0; i < this._nHits; i++) {
            const p = this._hits[i];
            const u = this._usable(p, v);
            if (!u || u === 3) continue;
            const x = plateOriginPx(p.i) - v.ox, y = plateOriginPx(p.j) - v.oy;
            if (x < 0 || y < 0 || x + PLATE_PX > L.width || y + PLATE_PX > L.height) { pictureStats.layerOverflow++; continue; }
            if (u === 1) {
                lc.drawImage(p.bitmap, x, y);
                if (this._isStale(p)) stale++;
            } else {                                                   // an empty plate IS the paper, over what the ink canvas holds under it
                lc.fillStyle = this.paper;
                lc.fillRect(x, y, PLATE_PX, PLATE_PX);
            }
            if (this._inRange(p, v)) n++;
        }
        this._layerDirty = false;
        pictureStats.layerRecomposes++;
        pictureStats.stalePlateBlits += stale;
        if (stale) pictureStats.staleComposes++;
        return n;
    }

    /**
     * Is this plate inside the published range? Only these count toward `_covered`: `_hits` is
     * refreshed by `compose(plates)` alone, so an arrival-driven compose reads the previous
     * frame's set, and a held view's range SHRINKS as the clip tightens — the set can hold more
     * entries than the range has cells (`covered` is a counter, never a pixel).
     */
    _inRange(p, v) { return p.i >= v.i0 && p.i <= v.i1 && p.j >= v.j0 && p.j <= v.j1; }

    /**
     * What this view can do with a plate — **four cases**, and no counter, so the gate in
     * `_planFallbacks` can read it twice a compose without doubling a report field:
     *
     *   0  unusable: a record the store has removed (`dead`, §7.1), raw pixels rather than a
     *      bitmap (Q13), or a plate at another zoom that cannot stand in either;
     *   1  blit it 1:1;
     *   2  **usable and paints nothing**: the worker serialises no pixels for a plate with no
     *      ink (`rasterWorker.runJob`, `drawn === 0`) and the renderer prices it at 0 bytes, so
     *      the plate IS the paper. It covers its cell;
     *   3  **drawable, but not at this view's `Zq`** — the fallback pass stretches it, and only
     *      that pass draws it. `"e"` and `"s"` can never reach 3: their `q` is not finite, which
     *      is exactly D83's reason (that key carries no zoom of its own).
     *
     * @returns {0|1|2|3}
     */
    _drawable(p, v) {
        if (!p || p.dead) return 0;
        if (p.frameId !== undefined && p.frameId !== v.frameId) {   // R5a: another frame stands in through its affine, or not at all
            return p.bitmap && Number.isFinite(p.q) && p.Zq > 0 && isFinite(p.Zq) && this._mapFrame(p.frameId) ? 3 : 0;
        }
        if (!p.bitmap) {
            if (p.pixels || p.bytes !== 0) return 0;
            return p.Zq === v.Zq ? 2 : 0;          // an empty plate elsewhere covers nothing here
        }
        if (p.Zq !== v.Zq) return Number.isFinite(p.q) && p.Zq > 0 && isFinite(p.Zq) ? 3 : 0;
        return 1;
    }

    /**
     * `_drawable` plus the counting the report reads. A 3 is counted by the HIT loops and not
     * here, because a cross-quantum entry in the hit list is D83's own failure while the same
     * entry in the cover set is R1 working.
     *
     * @returns {0|1|2|3}
     */
    _usable(p, v) {
        const u = this._drawable(p, v);
        if (u === 3) pictureStats.zqMismatch++;
        if (u) return u;
        if (!p) return 0;
        if (p.dead) { pictureStats.deadRefused++; return 0; }
        if (!p.bitmap && (p.pixels || p.bytes !== 0)) { pictureStats.noBitmap++; return 0; }
        pictureStats.zqMismatch++;                  // another zoom, or a Zq nothing can be drawn at (D83)
        return 0;
    }

    /**
     * Plate `(i, j)`'s destination as FC4's `screenRect` — `{x0, y0, x1, y1}`, integers,
     * half-open, device px, **origin the ink canvas's top-left**, the same shape
     * `OverlayBuffer.dirty` carries (`antPaint.js:148`). Writes into the caller's `out` and
     * returns the rect count, so a per-frame caller allocates nothing (FC5). Between quanta the
     * destination is fractional and the rect is the smallest integer box containing it.
     */
    plateDestRect(view, i, j, out) {
        const v = view || this._v;
        const x = (plateOriginPx(i) - v.ox) * v.s + v.dx;
        const y = (plateOriginPx(j) - v.oy) * v.s + v.dy;
        const w = PLATE_PX * v.s;
        out.x0 = Math.floor(x); out.y0 = Math.floor(y);
        out.x1 = Math.ceil(x + w); out.y1 = Math.ceil(y + w);
        return 1;
    }

    // ---- arrivals (§5.1, edge case 4.14) ----

    /**
     * ONE rastered plate arrives, composed on its own. A job of several plates goes through
     * `onPlateBatch` instead, which is what §5.1's "one extra compose per arriving job, not one
     * per plate" means. A **stale** arrival is discarded by the store, which closes its bitmap
     * itself, logged with why (§8.4 rule 4) and handed back for a re-post when it is still
     * wanted.
     *
     * A record keyed `q = "s"` is **refused before the store sees it** (§6.5, D159): the sync
     * path rasters at the exact zoom and is composed and not cached, and `"s"` carries no zoom
     * of its own — cached, it would come back as a hit at another zoom and be refused at compose
     * time, leaving paper where its ink belongs. The layer closes that bitmap itself, because
     * the store, which closes every plate it drops, never receives it.
     *
     * @param {object} rec `PlateStore.put`'s record: `{ frameId, q, Zq, i, j, G, bitmap }`
     * @returns {"cached"|"stale"|"newer"}
     */
    onPlate(rec) {
        const b = this._arr;
        b.compose = false; b.req = null; b.miss = null;
        const st = this._take(rec, b);
        this._flush(b);
        return st;
    }

    /**
     * One job's plates, composed **once** (§5.1, D173). A compose is a full-canvas paper fill
     * plus a blit per plate, so the per-plate loop 5b would otherwise write costs a screenful of
     * blitting per plate of the job — 15 composes a screenful instead of 5 on §8.6 row 4's phone
     * screen, during the fill behind a zoom. The re-posts of one job go out in one call too.
     *
     * Order does not matter and the records need not be one job's; a record belonging to another
     * request only means one more re-post call.
     *
     * @param {object[]} recs the arrived records, each `onPlate`'s own
     * @returns {string[]} each record's status, in the caller's order (one array per job)
     */
    onPlateBatch(recs) {
        const b = this._arr, out = [];
        b.compose = false; b.req = null; b.miss = null;
        if (recs) for (let i = 0; i < recs.length; i++) out.push(this._take(recs[i], b));
        this._flush(b);
        return out;
    }

    /**
     * One record: the store's `put`, the stale bookkeeping and the settle's and the incoming
     * quantum's own arrivals. The compose and the re-post are **accumulated into `b`** and made
     * once, by `_flush`, so a job costs one of each. A settle or a quantum switch completing
     * mid-batch composes where it always did — that compose publishes a new view and cannot wait.
     */
    _take(rec, b) {
        pictureStats.arrivals++;
        if (!rec || !this.store) return "stale";
        const key = rec.key || plateKey(rec.frameId, rec.q, rec.i, rec.j);
        if (String(rec.q) === "s") {                               // §6.5: composed, never cached
            pictureStats.syncRefused++;
            this._noteStale(key, rec, "sync");
            if (rec.bitmap && rec.bitmap.close) rec.bitmap.close();
            return "stale";
        }
        const st = this.store.put(rec);
        const wanted = this._wanted(rec);
        if (st === "stale") {
            pictureStats.staleDrops++;
            this._noteStale(key, rec, wanted ? "behind" : "unwanted");
            if (!wanted) { pictureStats.staleUnwanted++; return st; }
            // the request these pixels belong to, which for a settled plate or an incoming
            // quantum's is NOT the published view
            if (this._onRepost) this._addMiss(b, this._reqFor(rec), { key, i: rec.i, j: rec.j });
            return st;
        }
        if (st === "newer") {
            // Newer than the stale pixels it replaced and still behind (F106): shown, and re-posted.
            pictureStats.staleNewer++;
            if (!wanted) return st;
            const req = this._reqFor(rec);
            if (this._onRepost) this._addMiss(b, req, { key, i: rec.i, j: rec.j });
            if (req === this._v) { this._addHit(this.store.get(key)); this._layerDirty = true; b.compose = true; }
            return st;
        }
        // A settle publish and a quantum switch compose where they always did — that compose
        // publishes a new view and cannot wait for the batch — and the arrival that completed
        // the set is what caused it, so it is counted as the batch's own would be (D180).
        if (this._settlePending && String(rec.q) === "e") {
            if (this._settleArrived()) pictureStats.arrivalComposes++;
            return st;
        }
        if (this._pendLive && String(rec.q) === String(this._pend.q)) {
            if (this._quantumArrived()) pictureStats.arrivalComposes++;
            return st;
        }
        // A preview plate — or any cached plate at another numeric quantum — is R1's fallback:
        // it composes on arrival and never enters `_hits`, which is the view's own quantum.
        if (this._prevLive && String(rec.q) === String(this._prev.q)) { b.compose = true; return st; }
        if (wanted) {
            this._addHit(this.store.get(key));
            this._layerDirty = true;
            b.compose = true;
        } else {
            pictureStats.arrivalsOutside++;
            // At ANOTHER numeric quantum it is a fallback (R1) and shows at once; at the view's own it
            // composes nowhere, as ever.
            if (Number.isFinite(Number(rec.q)) && String(rec.q) !== String(this._v.q)) b.compose = true;
        }
        return st;
    }

    /** The batch's own re-post, then its one compose — at the engine's next frame when it set `deferCompose` ("raf" frames, A3 §5). */
    _flush(b) {
        this._flushMisses(b);
        if (b.compose) {
            b.compose = false;
            if (this.deferCompose) { this.deferCompose(); return; }
            this.compose();
            pictureStats.arrivalComposes++;
        }
    }

    /** A plate to re-post. Records of two different requests never share a call (D160). */
    _addMiss(b, req, m) {
        if (b.req && b.req !== req) this._flushMisses(b);
        b.req = req;
        if (!b.miss) b.miss = [];
        b.miss.push(m);
    }

    /** `reposts` counts PLATES, so one batched call reads what the same plates read one by one. */
    _flushMisses(b) {
        if (b.miss && b.miss.length && this._onRepost) {
            this._onRepost(b.req, b.miss);
            pictureStats.reposts += b.miss.length;
        }
        b.req = null; b.miss = null;
    }

    /**
     * The request a record belongs to: the settle's, the incoming quantum's, or the published
     * view. One reader for both callers, because a repost that named the view for a plate wanted
     * at another zoom is exactly D160's failure.
     */
    _reqFor(rec) {
        if (this._settlePending && String(rec.q) === "e") return this._req;
        if (this._pendLive && String(rec.q) === String(this._pend.q)) return this._pend;
        if (this._prevLive && String(rec.q) === String(this._prev.q)) return this._prev;
        return this._v;
    }

    /** Is this record still wanted — the right frame, the right quantum and inside that request's range? */
    _wanted(rec) {
        const r = this._reqFor(rec);
        if (rec.frameId !== r.frameId || String(rec.q) !== String(r.q)) return false;
        return rec.i >= r.i0 && rec.i <= r.i1 && rec.j >= r.j0 && rec.j <= r.j1;
    }

    /** The last few stale arrivals, with why — §8.4 rule 4's record, bounded at 8 (F58). */
    staleLog() { return this._stale; }

    _noteStale(key, rec, why) {
        const e = { key, why, G: rec.G, q: rec.q, frameId: rec.frameId, when: "arrival", t: this._now() };
        if (this._stale.length < STALE_LOG) this._stale.push(e);
        else this._stale[this._staleAt % STALE_LOG] = e;
        this._staleAt++;
    }

    // ---- the settle (§6.3, D24) ----

    _clear() { if (this._timer != null) { this._clearTimer(this._timer); this._timer = null; } }

    /**
     * The camera has been still for `SETTLE_MS` off-quantum: ask the store for the visible
     * plates at the EXACT zoom, pinned with `{ pin: "add" }` — the store's second pin set, so
     * the settle and the quantum's own visible set cannot evict each other (D75, D178) — and
     * hand the misses out. It does not run while a hold does (D179). **The published view does not
     * move yet**: the screen keeps the stretched picture until the whole settled screenful is in
     * hand, because one compose has one `s` and one `o` and a half-settled screen would be
     * paper where the exact plates have not arrived.
     */
    _settleNow() {
        this._timer = null;
        const v = this._v;
        if (!this.cam || !this.store || v.mode !== "plates" || v.s === 1) return false;
        if (this._hold) return false;                       // never a third pinned set (D179)
        pictureStats.settles++;
        this._settlePending = true;
        this._eLive = true;
        return this._askSettle();
    }

    _askSettle() {
        this._frame(this.cam, 0, 1);                        // fills this._req; publishes nothing
        const got = this.store.want(this._req, { pin: "add" });
        if (!got.misses.length && !got.inFlight) { this._publishSettle(got.hits); return true; }
        // The settle's OWN request goes out, never the published view: the view is still the
        // quantum's (D154) and a renderer that packed from it would raster these plates at the
        // quantum's zoom and key them `"e"` (FC2 — one mapping, no second derivation).
        if (got.misses.length && this._onPlates) this._onPlates(this._req, got.misses);
        return false;
    }

    /** One settled plate arrived; publish when every one of them is in hand. */
    _settleArrived() {
        if (!this._settlePending) return false;
        this._frame(this.cam, 0, 1);
        const got = this.store.want(this._req, { pin: "add" });
        if (got.misses.length || got.inFlight) return false;
        this._publishSettle(got.hits);
        return true;
    }

    _publishSettle(hits) {
        this._settlePending = false;
        this._settleDone = true;
        // No hold can be live here, so there is nothing to end: `_settleNow` refuses to start one
        // while a hold is in flight (D179), and a camera step clears a pending settle (`_onMove`)
        // before `_onQuantumChange` can begin a hold in the same `_frame`. The call that used to
        // stand here could never run (the third review of stage 5a).
        this._frame(this.cam, 0, 2);                        // mode "settle", q "e", Zq = Z, s = 1
        this._layerDirty = true;
        this.compose(hits);
        pictureStats.settlePublishes++;
    }

    // ---- the quantum change (§6.3's retention, §15.3's checkpoint ruling) ----

    /**
     * The quantum moved. The view is held at the quantum that has plates and the NEW one becomes
     * the pending request; a second crossing before any plate arrives ABANDONS the first, which
     * is `abandonQuantum` — its stragglers are refused at `put` while its cached
     * plates stay as the screen's best fallbacks (R1) — so only
     * the newest quantum is ever asked for. With nothing composed there is nothing to hold and
     * the new quantum is published at once, which is the behaviour before this rule (`holdSkips`).
     */
    _onQuantumChange(qf, frameId) {
        if (!this.store) return false;
        if (this._pendLive) {
            this.store.abandonQuantum(this._pend.q);
            pictureStats.quantumAbandons++;
            this._pendLive = false;
        }
        // R2: only a zoom OUT uncovers a ring no quantum has rendered; a zoom in magnifies the
        // held plates over the whole screen and a hold break has R1's fallback (C §1.7). A live
        // preview still two quanta or more ahead of the camera STANDS (R5): re-aimed on every
        // wheel tick, 45 of 93 were dropped before a plate landed.
        if (this._qPrev != null && qf.q < this._qPrev) {
            const p = this._prev, now = this._now();
            const fast = this._qChangeAt != null && now - this._qChangeAt < FAST_ZOOM_MS;
            this._qChangeAt = now;
            const ahead = this._prevLive && p.frameId === frameId && p.q <= qf.q - PREVIEW_STICKY;
            if (!ahead) this._aimPreview(qf.q, frameId, fast ? PREVIEW_FAST : PREVIEW_QUANTA);
            else pictureStats.previewKept++;
        } else this._qChangeAt = null;
        const v = this._v;
        if (!this._hold) {
            if (v.mode !== "plates" || this._nHits === 0) { pictureStats.holdSkips++; return false; }
            this._hold = { frameId: v.frameId, q: v.q, Zq: v.Zq, i0: v.i0, i1: v.i1, j0: v.j0, j1: v.j1 };
            this._holdWhy = "";
            pictureStats.holds++;
            if (!this._covered) pictureStats.holdsPartial++;   // a part-filled screen is still better than paper
        }
        if (String(qf.q) === String(this._hold.q)) { this._endHold("return"); return false; }
        const p = this._pend;
        p.frameId = frameId; p.q = qf.q; p.Zq = qf.Zq;
        p.i0 = 0; p.i1 = -1; p.j0 = 0; p.j1 = -1;             // the range is stage 3's, from the camera
        this._pendLive = true;
        return true;
    }

    /**
     * The incoming quantum's plates, asked for once a camera step and pinned with
     * `{ pin: "add" }` — the store's SECOND pin set, which the renderer's own `want(view)`
     * rebuild does not touch, so neither set can evict the other (D178). The misses go out
     * through `onPlates` and the RENDERER posts them (§15.3 Q3); the
     * view switches the moment the whole visible set is in hand, as the settle flips (D154).
     */
    /** Aim the preview at `qLive − PREVIEW_QUANTA` in `frameId`; a second aim re-aims the one request. */
    _aimPreview(qLive, frameId, dq = PREVIEW_QUANTA) {
        if (!this.store) return false;
        const p = this._prev, q = qLive - dq;
        p.q = q; p.Zq = zqOf(q); p.frameId = frameId;
        p.i0 = 0; p.i1 = -1; p.j0 = 0; p.j1 = -1;             // the range is stage 5's, from the camera
        this._prevLive = true;
        pictureStats.previews++;
        return true;
    }

    /**
     * The preview's plates, asked for once a camera step BEFORE the incoming quantum's and with no
     * pin (their eviction is the cap's, stale-first); the misses go out at `prio` 0. Done when the
     * whole set is cached: the plates stay as fallbacks.
     */
    _askPreview(cam) {
        if (!this._prevLive || !this.store || !cam) return false;
        this._frame(cam, 0, 5);                                 // fills this._prev; publishes nothing
        const got = this.store.want(this._prev, { pin: "none" });
        pictureStats.previewHits += got.hits.length;
        if (!got.misses.length && !got.inFlight) { this._prevLive = false; return true; }
        if (got.misses.length && this._onPlates) this._onPlates(this._prev, got.misses);
        return false;
    }

    _askQuantum(cam) {
        if (!this._hold || !this._pendLive || !this.store || !cam) return false;
        this._frame(cam, 0, 3);                             // fills this._pend; publishes nothing
        const got = this.store.want(this._pend, { pin: "add" });
        if (!got.misses.length && !got.inFlight) return this._switchQuantum(cam);
        if (got.misses.length && this._onPlates) this._onPlates(this._pend, got.misses);
        return false;
    }

    /** One plate of the incoming quantum arrived; switch when every one of them is in hand. */
    _quantumArrived() {
        if (!this._hold || !this._pendLive || !this.cam) return false;
        this._frame(this.cam, 0, 3);
        const got = this.store.want(this._pend, { pin: "add" });
        if (got.misses.length || got.inFlight) return false;
        return this._switchQuantum(this.cam);
    }

    /**
     * The incoming quantum is complete: publish it, unpin the held set and compose, in one step.
     * `_endHold` clears the ADDED pin set and the `{ pin: "replace" }` want rebuilds the visible
     * one from the incoming range, so the two sets become one in that order, with nothing
     * unpinned in between that an eviction could take (D178). The want returns the hits the
     * compose takes, so the switch reads the store once.
     *
     * **The publish is stage 4 and not a camera step**: it publishes `_pend`'s own `q` and `Zq`,
     * so a camera that crossed a quantum while the job was in flight cannot make this compose
     * read the dying quantum's `Zq` (D183). The quantum in force (`_qPrev`) is already `_pend.q`,
     * so the next `frameFor` measures its hysteresis from what was published here — and where
     * the camera has drifted past it, that frame holds THESE plates and asks for the next
     * quantum, which is the ordinary path.
     *
     * **The switch is REFUSED outside `[S_MIN, S_MAX_HOLD]`** (D188): stage 4 publishes
     * `_pend.Zq` against the camera as it is NOW, so the drift D183 removed from the QUANTUM is
     * still in the stretch. Below `S_MIN` the published range has more plate columns than the
     * layer canvas was sized for and `_recomposeLayer` skips the surplus (D158's own failure,
     * counted in `layerOverflow`); above `S_MAX_HOLD` the picture would be stretched past the
     * bound the hold itself keeps (D174). Refusing leaves the hold and the pending request
     * exactly as they were, and the next camera step re-quantises — it cannot do otherwise,
     * because `quantumFor` keeps `_qPrev` (which IS `_pend.q`) only inside the hysteresis band
     * [0.8781, 1.1387], which is inside this one.
     */
    _switchQuantum(cam) {
        const sw = stretchOf(cam.inScale * this.dpr, this._pend.Zq);
        if (!(sw >= S_MIN)) { pictureStats.switchRefusedLow++; return false; }
        if (sw > S_MAX_HOLD) { pictureStats.switchRefusedHigh++; return false; }
        this._pendLive = false;
        this._prevLive = false;                             // its plates stay cached, as fallbacks (R2)
        this._endHold("switch");                            // the pending quantum is kept: it is now the view's
        const got = this.store.want(this._pend, { pin: "replace" });
        this._frame(cam, null, 4);                          // publishes the pending quantum, never re-derives it
        this._layerDirty = true;
        this.compose(got.hits);
        this._maybeArm(this._v.mode, this._v.s);            // the stretch is the new quantum's now
        pictureStats.holdSwitches++;
        return true;
    }

    /**
     * The hold is over. A pending quantum the camera has moved PAST is ABANDONED so its
     * stragglers are refused (`return`, and the release, where the cache is already gone); one the
     * view is about to publish, or that a settle or a sync compose supersedes, is left alone. In
     * neither case are its cached plates dropped: they are valid at their own quantum, a frame
     * crossing drops nothing (§5.4 rule 5), and they are the fallbacks the next compose draws.
     */
    _endHold(why) {
        if (!this._hold) return false;
        this._hold = null;
        this._holdWhy = why;
        if (this._pendLive && (why === "return" || why === "release")) {
            if (this.store) this.store.abandonQuantum(this._pend.q);
            pictureStats.quantumAbandons++;
        }
        // The layer's second pin set ends with the hold, whatever ended it — at the SWITCH
        // because `want({pin:"replace"})` rebuilds the visible set alone and would leave the
        // old one pinned for ever, and at a break because those plates are the renderer's to
        // pin now (D178). The switch clears before its own want, so the incoming set is
        // unpinned and re-pinned in one step.
        if (this.store) this.store.unpinAdded();
        this._pendLive = false;
        return true;
    }

    // ---- the hit list, and the layer canvas ----

    /** Copy the caller's hit list in. A change of the SET is what makes the layer dirty (Q6b). */
    _setHits(list) {
        const a = this._hits;
        let same = list.length === this._nHits;
        for (let i = 0; i < list.length; i++) {
            if (i >= a.length) { a.push(list[i]); pictureStats.allocs++; same = false; continue; }
            if (a[i] !== list[i]) same = false;
            a[i] = list[i];
        }
        for (let i = list.length; i < a.length; i++) a[i] = null;    // never hold a dropped plate's bitmap
        this._nHits = list.length;
        if (!same) this._layerDirty = true;
    }

    /** One arrival into the composed set, replacing the entry that held its key. */
    _addHit(e) {
        if (!e) return false;
        const a = this._hits;
        for (let i = 0; i < this._nHits; i++) if (a[i] && a[i].key === e.key) { a[i] = e; return true; }
        if (this._nHits >= a.length) { a.push(e); pictureStats.allocs++; } else a[this._nHits] = e;
        this._nHits++;
        return true;
    }

    /**
     * The layer canvas, at the WORST-CASE plate grid for this size —
     * `(floor(W / (512·S_MIN)) + 2) × 512` each way — allocated on the first `s ≠ 1` and freed
     * only on a release (§6.6). The screen covers `W/(512·s)` plate pixels, so **`S_MIN` and not
     * 1 is the divisor**: §3.2's `floor(W/512) + 2` is the plate count at the quantum, and
     * between quanta the range can be a column or a row larger than it — simulated on the
     * shipped arithmetic, the phone's 4 × 5 layer had to hold 4 × 6 and `_recomposeLayer` then
     * skipped a plate over 8.3 % of the screen (D158). Sizing it to the CURRENT grid instead
     * would reallocate 25 MB whenever a pan adds a row, on the one gesture this whole option was
     * chosen to make free.
     */
    _ensureLayer() {
        if (this._layer) return this._layer;
        const c = this._canvas;
        const W = c ? c.width : snapPx(this.cssW * this.dpr);       // backing store, §6.1
        const H = c ? c.height : snapPx(this.cssH * this.dpr);      // backing store, §6.1
        const lw = (Math.floor(W / (PLATE_PX * S_MIN)) + 2) * PLATE_PX;
        const lh = (Math.floor(H / (PLATE_PX * S_MIN)) + 2) * PLATE_PX;
        const L = this._mk(lw, lh);
        if (!L) return null;
        L.width = lw; L.height = lh;
        this._layer = L;
        // ALPHA, unlike the ink canvas: the layer is cleared rather than filled with paper, so a
        // cell it has no plate for shows the ink canvas's fallback through it (§7.1's ruling).
        this._lctx = L.getContext ? L.getContext("2d", { alpha: true }) : null;
        if (!this._lctx) pictureStats.noContext++;
        this._layerDirty = true;
        pictureStats.canvasAllocs++;
        pictureStats.layerBytes = lw * lh * 4;
        return L;
    }

    _dropLayer() {
        this._layer = null; this._lctx = null;
        this._layerDirty = true;
        pictureStats.layerBytes = 0;
    }

    // ---- the report (§8.5) ----

    /** Flat scalars for the report's `raster` section, as `PlateStore.report()` is (F58). */
    report() {
        const v = this._v;
        return {
            mode: v.mode, q: v.q, Zq: v.Zq, s: v.s, dpr: v.dpr, rev: v.rev,
            cssW: v.cssW, cssH: v.cssH,
            plates: this._nHits, hasLayer: !!this._layer,
            // `covered` is the PUBLISHED range's own cells; `screenCovered` is the whole screen,
            // fallbacks counted. A held view can be covered and 65 % white, which is what the
            // second number exists to say (PAPER-PLAN §7.1, A's Q4).
            covered: this._covered, screenCovered: this._screenCovered, fallbacks: this._nFb, uncovered: this._uncovered,
            settlePending: this._settlePending, settleDone: this._settleDone,
            // §6.3's retention: "" for no held quantum and no pending one, never null (F58's scalars)
            held: !!this._hold, heldQ: this._hold ? this._hold.q : "",
            pendQ: this._pendLive ? this._pend.q : "", holdWhy: this._holdWhy,
            ...pictureStats,
        };
    }
}
