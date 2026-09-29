/**
 * Renderer — the SVG renderer (`?svg`, the export and the thumbnails; DESIGN.md §9). Draws the Stage's items
 * as one persistent Two.Group per object id in `SvgLayer`'s `world` (kept sorted by id = global z-order), with
 * the per-frame diff (camera-only frames sync transforms + fade opacity without rebuilding any path); the live
 * stroke is `LiveStrokeLayer`'s, the lasso, debug overlays and indicator `raster/svgOverlay.js`'s.
 *
 * Fixes vs the old engine:
 *  - Global z-order (BUG-03): groups live in a flat array sorted by id and are
 *    spliced into `world` at their sorted position, so a newer object always
 *    draws over an older one regardless of which representation bucket it came
 *    from. Two.js 0.7.1 fires one reorder pass per update no matter how many
 *    splices, and the pen hot path only ever appends (the live stroke has the
 *    max id).
 *  - Incremental render (ISSUE-11 / BUG-01): a group is rebuilt only when its
 *    piece signature changes; a pure camera move touches nothing but the world
 *    transform and faded groups' opacity.
 *  - Fat display (BUG-02): a fat stroke is a curve-capsule outline built once in
 *    frame coordinates (_buildOutlineInto), so no camera window enters its
 *    geometry and none can be outrun. The windowed display bake it replaced was
 *    deleted on 2026-09-14 (ROADMAP S7); projection giants no longer arrive as
 *    strokes (they're tile fills) either, so the only fat cases are the active
 *    level's own bounded natives.
 *  - Continuous fade (BUG-04): a down-piece carries fadeTag (its size at the
 *    level's deepest zoom); its group opacity ramps to 0 across the sub-pixel
 *    cull instead of popping.
 */
import Two from "two.js";
import { clipRingsToRect } from "./geometry/polyline";
import { shapeLoopsInRect } from "./geometry/derive";
import { strokeLoops } from "./geometry/curveOutline";
import { loopsBBox } from "./geometry/arcShape";
import { pushGapAnchors, pushShapeAnchors, pushRingAnchors, mkPath } from "./raster/svgAnchors";
import { rectTol } from "./rectMath";
import SvgLayer from "./raster/SvgLayer";
import LiveStrokeLayer from "./raster/LiveStrokeLayer";
import { SvgOverlays, buildSelOverlay, dropSelOverlay, renderSelAnts, renderSelChevrons, mkSelLayer, ensureSelStyle } from "./raster/svgOverlay";

/**
 * HOW A PIECE REACHES THE BROWSER (F40, 2026-09-04). Two things decide what is
 * written into the path for an arc, and one more for anything long.
 *
 * WHICH CURVE. Two.js's `Commands.arc` is SVG's `A`, serialised from
 * `rx`/`ry`/`xAxisRotation`/`largeArcFlag`/`sweepFlag` set on the anchor (its
 * own source calls the fields a hack, in 0.7.1 and in 0.8.24 alike, but the
 * SVG renderer has written them out since 0.7). Until 2026-09-04 every arc
 * went out as cubics — one per quarter turn — on the belief that Two.js
 * "speaks nothing else" and that the cubic's 2.7e-4·r error was "orders under
 * display tolerance". Measured on Kobin's drawing: a re-homed circle one frame
 * up, radius 22,746 units, drawn at inScale 127 has a radius of 2.9 million
 * px, and its single cubic ran 463 px OUTSIDE the true circle across the whole
 * screen — a blue band that "disappeared" at the level jump, because the
 * child frame's chop cut the arc into thousandth-radian pieces whose cubics
 * are exact. The arc command is exact in form but the browser rebuilds its
 * centre in float32 (2^-24 of the radius on screen: 159 px at the child
 * frame's deepest zoom, snapping back at the next crossing). So
 * `arcShape.planArc` chooses, at the engine's quarter-pixel tolerance and the
 * frame's deepest zoom: the arc command while it is within tolerance, else as
 * many kappa cubics as the sixth-root law demands. One plan per piece, never
 * redone while zooming; each part is one instruction.
 *
 * HOW LONG. Every coordinate reaches the browser in float32, relative to the
 * scene origin at the view centre. On-screen vertices are within the
 * re-origin budget (REORIGIN_PX) of the origin and fine; but a piece whose
 * ENDS are far away carries their rounding onto its on-screen stretch — a
 * line from one side of a tile to the other, at the deepest zoom, has ends
 * 5e7 px out, where float32 resolves to 4 px, and the whole line sits up to
 * 2 px off. Arcs and lines alike. So any non-seam piece longer than `segMax`
 * units is split into equal parts of at most that length: the part on screen
 * then has its ends within `segMax` of the screen, and the error is
 * (REORIGIN_PX + segMax·enter)·2^-24 px — a quarter pixel with
 * segMax = 2^⌊log₂((tol·2^24 − REORIGIN_PX)/enter)⌋ = 8192 units for the
 * default config. Only two kinds of piece are ever that long — an ancestor's
 * ink magnified into this frame, and long straight lines — so it costs a
 * handful of anchors per drawing; a SEAM (a straight piece lying on the
 * rectangle that cut it) is never split, its neighbour overlaps it by the
 * seam pad, which at depth is thousands of px. Kobin, 2026-09-04: "Can we
 * cheaply do a render-only tile chop for that until we do the GPU fix, with
 * as minimal instructions/chops as needed to cheaply get to the quarter pixel
 * accuracy?" — this is that.
 *
 * THE SPLIT IS OFF (`Renderer.lengthChop`), measured the same night: with it
 * on, Kobin's blue piece at the child frame's deepest zoom — 32 cubics whose
 * ends sit 1.4e7 device px out — was DROPPED by Chrome's rasteriser,
 * intermittently in the app and reproducibly in the bare harness at full
 * raster scale (it painted at half scale, at 2.5× smaller coordinates, and
 * when the same 32 points were written as LINES; the unsplit three-cubic
 * version painted every time). And a piece that was never split drops too:
 * his red piece, one arc of radius 2.3e8 units clipped to its tile, three
 * cubics, painted at inScale 64 (8.4e6 px across) and vanished at 78.8
 * (1.03e7 px) with its `d` unchanged. So a path whose cubics run beyond
 * roughly 1e7 device px is a thing Chrome's GPU raster gives up on, whatever
 * the curve is cut into, and splitting only makes more of them. The split
 * stays as a dev toggle the tests exercise; what ships is the WINDOW CHOP.
 *
 * HOW FAR (the window chop, F40's last piece). Each scene keeps a WINDOW
 * around the view: a square of ±`_chopPx` device px at the zoom it was
 * chosen at (2^18 = 262,144 px, ±174 screens, for the default config). Any
 * area piece that reaches past the window is clipped to it — the exact arc
 * boolean the tile machinery uses (`shapeLoopsInRect`, Sutherland–Hodgman for
 * polygon pieces) — before it becomes anchors, so no number handed to the
 * browser is ever far from the view. A piece inside the window goes whole; a
 * piece wholly outside it is hundreds of screens off screen and goes whole
 * too, since what the browser makes of it cannot show. The window is chosen
 * again (`_maybeRechop`) when the view leaves its INNER HALF or the zoom
 * grows CHOP_ZOOM times, and `needsWindowChop` promotes the camera-only frame
 * that did it to a full render, so the chopped groups are rebuilt on the new
 * window before its edge could reach the screen — pan toward the edge of a
 * chopped piece and the next stretch of it is already there. Only the groups
 * whose pieces straddle the window carry its key in their signature, so a
 * re-chop rebuilds those and nothing else; everything within 87 screens of
 * the view at the zoom of the last chop never rebuilds at all. The bound: the
 * view is within half the window of the window's centre and within
 * REORIGIN_PX of the origin, and the zoom has grown at most CHOP_ZOOM×, so no
 * anchor is farther from the origin than REORIGIN_PX + 1.5·CHOP_ZOOM·_chopPx
 * = 3.07e6 px — 0.18 px of float32 rounding, under the quarter pixel, and a
 * third of where the raster gives up. Kobin, 2026-09-04, on the split's
 * failure: "you are suggesting just chopping instead of segmenting? If so go
 * ahead and implement that stopgap; just ensure that if you pan towards the
 * end of the segment, the next segment is loaded." Not chopped: raw strokes
 * (short segments between samples, and lines survive the raster) and fat
 * curve-capsule outlines (cubics, no exact rect clip for them yet); a
 * resolved stroke is a shape and is chopped like any other.
 *
 * `_mid` is the part's midpoint, origin-relative, for the thin rescale's
 * thickness estimate: it walks anchors as a polygon, and a circle's two
 * half-arc anchors alone would enclose no area at all.
 *
 * The helpers that write these anchors are `raster/svgAnchors.js`'s.
 */

/**
 * The bounds of an area piece, for the window chop's verdict. Arc pieces by
 * their true extremes (`loopsBBox`); a polygon piece by its points, which is
 * the one pass over a fill's geometry the verdict costs.
 */
function areaBounds(o) {
    if (o.type === "shape") {
        const b = loopsBBox(o.loops);
        return b ? [b.x0, b.y0, b.x1, b.y1] : null;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of o.polys) {
        for (const p of poly) {
            if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        }
    }
    return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/** The clip rectangle a tile piece carries, as the seam test wants it. */
function asClip(clip) {
    const rect = "x0" in clip ? clip : { x0: clip.left, y0: clip.top, x1: clip.right, y1: clip.bottom };
    return { rect, eps: rectTol(rect) };
}

const perfRendererNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());


// Re-anchor budget: browsers rasterize SVG paths in FLOAT32 (Skia stores path
// points as float32, and Two.js matrices are Float32Array), so a vertex at
// frame coordinate c carries an absolute error of ~c/2^23 frame units, i.e.
// (c·inScale)/2^23 on-screen px. Zoom-out → pan → zoom-in manufactures huge
// coordinates (a pan of N screens at a coarse level is N×3000 frame units one
// crossing deeper), and strokes drawn out there keep them forever — they
// rendered visibly "pixelly" (~8 px vertex snapping at |c|≈8e6, inScale 15).
// The engine's own math is float64 and exact; only what's HANDED TO THE
// BROWSER must stay small. So every anchor is built relative to a per-scene
// origin (chosen at the view center) and the origin is folded back into the
// world transform in float64 JS. When the view drifts so far from the origin
// that c·inScale approaches this budget (~0.18 px of float32 error), the scene
// re-anchors: rebuild paths against a fresh origin. That's a ~1.9e6-screen-px
// drift — a rare, full-rebuild-priced event, like a level flip.
const REORIGIN_PX = 1.5e6;

// The window chop's zoom budget: how many times the in-frame zoom may grow
// before the scene's window is chosen again (see the header, HOW FAR). Four
// is two octaves — a whole frame's range of 8,192× is six re-chops, each one
// rebuilding only the groups that straddle the window.
const CHOP_ZOOM = 4;

// Absolute device-px fat gate (replaces polygonizeWidthFrac = 1/3 screen): a
// screen-fraction gate flips representation per device (a phone would fatten
// strokes a desktop draws normally). Skia's extreme-width mis-stroke was
// measured from ~25k device px, so 500 px keeps a ~50× safety margin.
//
// THIS IS A FALLBACK ONLY. `cfg.fatWidthPx` is 4000 in the engine's DEFAULTS and
// always wins (`_gatePx`), so the live gate keeps ~6× of margin rather than 50× —
// the trade was made deliberately in ISSUE-22, because at 500 the default 13 px
// pen needed an outline at its own level and the fitting cost dominated. 500 is
// what a Renderer constructed without a cfg would use.
const FAT_WIDTH_PX = 500;

// ---- thin-object coordinate rescale (F-Z) ----------------------------------
//
// Chrome drops a filled path whose features are too small IN THE COORDINATES IT
// IS HANDED, however much the transform then enlarges them. Measured on the real
// geometry in Chrome 151 / dpr 1.5, holding the on-screen result pixel-identical
// and varying only the numbers in `d`: a feature 0.0657 path units across
// renders, 0.0641 does not. The app was handing over 0.00329. See F-Z in
// docs/OPEN-FLAGS.md for the full sweep.
//
// The fix is a change of UNITS, for the affected object only: multiply its
// anchors by a power of two and divide its own group's transform by the same
// number. Pixel-identical by construction (`screen = M·(S·p)/S`), per-object so
// nothing else pays for it, and applied at the END of the build so nothing
// upstream in the engine knows it happened.
//
// It does NOT cost the path cache. The numbers in `d` come from the LEVEL
// PROJECTION, not the zoom — an object one level down is written at 1/4096 —
// and they do not change as the camera moves (verified: `d` is byte-identical
// across a whole zoom sweep). So the scale a given object needs is stable, the
// signature does not move, and a pan or zoom still rewrites one matrix and
// touches no path.
//
// POWERS OF TWO, AND NEVER MORE THAN 64. Two.js serialises a group's matrix
// through its own `toFixed` — six decimals, and it FLOORS (two.js:12902 ->
// Matrix.toString). 1/64 = 0.015625 is the last power of two that is exact at
// six decimals; 1/128 = 0.0078125 is not, and rounding it would misplace the
// object by more than the defect this repairs.
const THIN_SCALE_MAX = 64;
// Lift a thin feature to at least this many path units. Chrome starts dropping
// them at ~0.065, so this keeps ~4x of margin.
const THIN_TARGET_UNITS = 0.25;
// Never let a scaled coordinate approach 2^23 = 8,388,607 — where float32 stops
// representing consecutive integers, and where Firefox drops an SVG path
// outright (bugzilla 1314265). 2^22 keeps a full octave in hand.
const THIN_COORD_MAX = 4194304;


export default class Renderer {
    constructor(container, camera, cfg, opts = {}) {
        this.cam = camera; this.cfg = cfg;
        this.width = opts.width; this.height = opts.height;
        // What a piece becomes in the SVG (see pushArcPiece): the frame's
        // deepest zoom, the tolerance, and the longest non-seam part allowed —
        // the largest power of two under (tol·2^24 − REORIGIN_PX)/enter, 8192
        // units for the default config (enter 256, tol 0.25 px).
        const tol = cfg && cfg.arcTolerancePx > 0 ? cfg.arcTolerancePx : 0.25;
        const enter = cfg && cfg.enter > 0 ? cfg.enter : 256;
        const room = (tol * Math.pow(2, 24) - REORIGIN_PX) / enter;
        const segMax = Renderer.lengthChop === true ? (room > 1024 ? Math.pow(2, Math.floor(Math.log2(room))) : 1024) : 0;
        this._arcPlan = { enter, tol, segMax };
        this._arcPlanNoChop = { ...this._arcPlan, segMax: 0 };
        this.opacityGroups = true; this.debug = false;
        /** The one Two.js instance: `world`, the debug groups, the lasso's group (A3 §7.2). */
        this.svg = new SvgLayer(container, { width: this.width, height: this.height });
        this.two = this.svg.two; this.world = this.svg.world;
        /** The stroke under the pen, in `world` after the scenes, at the active scene's origin. */
        this.live = new LiveStrokeLayer(this.world, this._arcPlan);
        /** The lasso and the debug overlays, one implementation for both renderers (`raster/svgOverlay.js`). */
        this.overlays = new SvgOverlays(this.svg, camera);
        this.eraseDebug = false;
        this._selAntsFn = null;               // () -> { key, transform, runs, marks, edges, inkPx } | null
        this._selOv = null;                   // the indicator's own <svg> layers
        this._selEls = null;
        this._groups = new Map();   // id -> { group, sig, z, pieces, fadeTag }
        this._order = [];           // ids sorted by (z, id) — z defaults to id;
                                    // cut pieces inherit their source's z so they
                                    // keep drawing at the original stroke's depth
        // --- per-level scene retention (perf) --------------------------------
        // A level flip used to tear down every group and rebuild it, so
        // `two.update()` recreated ~50 SVG <path> nodes (and reconstructed the
        // giant `d` strings of the fat curve-capsule outlines) EVERY crossing —
        // 1–3 s that never got cheaper on repeat because there was one `world`
        // group holding one level's paths at a time. Now each level keeps its
        // own subtree (a Two.Group under `world` + its own id→group map): a
        // crossing detaches one subtree and attaches another, so bouncing across
        // a boundary reuses the cached paths (their `d` is preserved — Two.js
        // only rebuilds `d` when a path's vertices change) and only moves DOM.
        // Correctness is still the render diff's job (sigs are value-based, so a
        // genuinely changed object rebuilds); the cache is a pure DOM reuse.
        // Off => one shared scene => the original rebuild-on-crossing behavior.
        this.retainScenes = true;   // dev-toggleable (setRetainScenes)
        this.sceneAnchorBudget = 250000;   // inactive retained scenes, by Two.js anchors (see _evictScenes)
        Renderer.thinScale = Renderer.thinScale !== false;  // dev-toggleable (F-Z rescale)
        Renderer.lengthChop = Renderer.lengthChop === true;  // dev-toggleable (F40 length split; see pushArcPiece)
        Renderer.windowChop = Renderer.windowChop !== false;  // dev-toggleable (F40 window chop; see the header)
        // The window's half-extent in device px at the zoom it is chosen at:
        // the largest power of two that keeps REORIGIN_PX + 1.5·CHOP_ZOOM·chopPx
        // under tol·2^24, the coordinate at which float32 has spent the
        // tolerance — 2^18 for the default config. Floored at 2^16 so a view
        // is always far smaller than the window's inner half (the re-chop
        // test would otherwise fire every frame). Live kill-switch:
        // `renderer._chopPx = 0`, then pan far enough to force a full render.
        const chopRoom = (tol * Math.pow(2, 24) - REORIGIN_PX) / (1.5 * CHOP_ZOOM);
        this._chopPx = Renderer.windowChop ? Math.max(65536, Math.pow(2, Math.floor(Math.log2(Math.max(chopRoom, 1))))) : 0;
        this._chopSeq = 0;          // window keys, unique per renderer
        this._chopMemo = null;      // per-render memo of _chopFor's verdicts
        this._sigMemo = new WeakMap(); // piece -> its measured signature part, keyed by _ver (see _sig)
        this._scenes = new Map();   // levelKey -> { root, groups, order, seq }
        this._level = null;         // active scene key
        this._activeRoot = null;    // active scene's Two.Group (child of world)
        this._activateSeq = 0;      // recency counter for the scene LRU
        this._lastRebuilds = 0;     // groups (re)built in the last render()
        this._hasFat = false;
        this._ovOrigin = null;      // §2.5 seam 2: the raster path's overlay origin (FC6); null here
        this.lazyOutlines = true;   // fat strokes render RAW until they approach the
                                    // gate on screen (fit cost moves off pen-up and
                                    // onto idle/approach) — dev-toggleable
        this._pendingFatLw = 0;     // widest fat-gated stroke still rendering raw
    }
    destroy() {
        this._dropSelOverlay();
        this.live.destroy();
        this.svg.destroy();
        this._scenes.clear(); this._groups.clear();
    }
    setSize(w, h) { this.width = w; this.height = h; this.svg.setSize(w, h); }
    update() { this.svg.update(); }

    // ---- fat-gate helpers ----
    _gatePx() { return this.cfg.fatWidthPx != null ? this.cfg.fatWidthPx : FAT_WIDTH_PX; }
    _fatOnScreen(o) { return o.type === "stroke" && o.lwFrame * this.cam.inScale > this._gatePx(); }
    // The representation gate: could this stroke EVER paint wider than the fat
    // gate anywhere in its level's zoom range (deepest zoom = enter)? Evaluated
    // per OBJECT, not per view — so the switch to the outline representation
    // happens when the object enters the render list (finalize/load/edit/tile
    // bake), never mid-gesture, and a raw SVG stroke can never reach the Skia
    // mis-stroke widths by in-level zooming (closes ISSUE-21 by construction).
    _fatEver(o) { return o.type === "stroke" && o.lwFrame * this.cfg.enter > this._gatePx(); }
    // Which representation does this stroke render with RIGHT NOW?
    //   raw     — a plain stroked path (thin strokes; live stroke; lazy-pending)
    //   outline — the curve-capsule fill (cached, or eager mode fits on demand)
    //   pending — fat-gated, lazily unfitted. Renders raw (pixel-exact browser
    //             stroking) until its outline is fitted in idle, or — past the
    //             gate — within the per-render fit budget. Fitting NEVER runs
    //             unbudgeted inside a render: loading a deep-zoom snapshot with
    //             dozens of fat strokes must not stall for minutes.
    // The mode is part of the group signature, so a flip rebuilds the group.
    _strokeMode(o) {
        if (o.type !== "stroke" || this._isLive(o) || !this._fatEver(o)) return "raw";
        if (!this.lazyOutlines || o._outline) return "outline";
        return "pending";
    }
    // Force a flip render once a pending stroke's RAW width actually crosses
    // the gate (the render then fits it within the budget — Skia safety).
    needsFatFlip() {
        return this.lazyOutlines && this._pendingFatLw > 0 &&
            this._pendingFatLw * this.cam.inScale > this._gatePx();
    }
    // Has any piece crossed the fully-present line since its group was built?
    //
    // Grouping is a RENDER-TIME decision (`renderId` in render()) but fade is a
    // function of the live camera, so a zoom can invalidate it without anything
    // else changing — and a camera-only frame reapplies opacity without
    // regrouping. Without this the stale grouping simply persists: the member
    // that should have left the family stays in it, and the family wears its
    // fade. Same shape as `needsFatFlip` — a cheap per-frame predicate that
    // forces the full render which then does the regrouping.
    needsFadeFlip() {
        for (const entry of this._groups.values()) {
            for (const o of entry.pieces) {
                if (o.editId == null) continue;
                if ((this._fade(o) >= 1) !== !!entry.family) return true;
            }
        }
        return false;
    }
    // Are pending strokes APPROACHING the gate? The engine starts idle fits.
    hasPendingNearFat() {
        return this.lazyOutlines && this._pendingFatLw > 0 &&
            this._pendingFatLw * this.cam.inScale > this._gatePx() * 0.5;
    }

    // ---- full render of an object-piece list ----
    // The list may hold SEVERAL pieces with the same id (tile fragments of one
    // object), or several boundary-attached re-home natives with one editId.
    // They all belong in one group, at full opacity, with the logical object's
    // opacity applied once on the group. Groups are diffed by a
    // combined signature (unchanged id => paths reused), inserted at their
    // id-sorted position (global z-order), and dropped when their id vanishes.
    render(list, level) {
        const sc = this._activateLevel(level); // swaps to this level's retained subtree (or the shared one)
        this._maybeReorigin(sc);
        this._maybeRechop(sc);
        this._chopMemo = new Map();  // one verdict per piece: the sig asks, then the build
        this._pendingFatLw = 0; // recounted below
        this._fitSpentMs = 0;   // per-render outline-fitting budget
        const byId = new Map();
        for (const o of list) {
            // THE STROKE UNDER THE PEN IS ALREADY ON SCREEN as `_live`, and it
            // is in the list too (it is a native of the frame). Building a
            // group for it as well painted it twice whenever a render landed
            // mid-stroke — Ctrl+Z, an idle outline fit queued by the previous
            // pen-up, a resize — and for a highlighter that showed: the part
            // drawn so far at 0.70 instead of 0.45 until pen-up (measured
            // 2026-09-05, two paths for one stroke). The live path is the
            // stroke's only picture until `endLive`.
            if (this._isLive(o)) continue;
            // A sub-pixel down-piece that is ACTUALLY faded goes in its own
            // group: applying its fade to the shared family group would fade the
            // coarse parent with it. Once fully present it rejoins the family,
            // and that matters for more than opacity now — the family's pieces
            // are merged into one path there, which is what keeps the join
            // between a cut parent and its re-homed child from seaming.
            //
            // The test is the fade VALUE, not the presence of a tag. Every
            // down-piece carries fadeTag (it is a size, not an alpha), so
            // testing the tag kept the child out of the family at every zoom
            // where it was plainly visible — an 11 px piece, fade factor 1,
            // rendered as its own path with a hairline down the tile edge.
            const renderId = o.editId != null && this._fade(o) >= 1 ? o.editId : o.id;
            // The verdict above is remembered per group (`entry.family`) and
            // re-checked on every zoom by `needsFadeFlip` — a camera-only frame
            // does not regroup, and a member that silently outstays its welcome
            // here drags the whole family's opacity down with it.
            let a = byId.get(renderId);
            if (!a) { a = []; byId.set(renderId, a); }
            a.push(o);
        }
        let reorder = false;
        let rebuilt = 0;        // groups (re)built this pass — 0 => a fully cached crossing
        for (const [id, pieces] of byId) {
            // count lazy-pending fat strokes across the WHOLE list (also the
            // unchanged groups below), so needsFatFlip() sees them
            for (const o of pieces) if (this._strokeMode(o) === "pending") this._pendingFatLw = Math.max(this._pendingFatLw, o.lwFrame);
            const sig = pieces.map((o) => this._sig(o)).join("|");
            const rep = pieces[0];
            const family = rep.editId != null && id === rep.editId;
            const existing = this._groups.get(id);
            if (existing && existing.sig === sig) { existing.pieces = pieces; this._applyOpacity(existing, rep); continue; }
            rebuilt++;
            let entry = existing;
            if (!entry) {
                entry = { group: new Two.Group(), sig: null, z: rep.z != null ? rep.z : id, pieces, fadeTag: rep.fadeTag, family };
                this._groups.set(id, entry);
                this._insertSorted(id);
                reorder = true;
            } else {
                entry.group.remove(entry.group.children);
            }
            entry.pieces = pieces; entry.sig = sig; entry.fadeTag = rep.fadeTag; entry.family = family;
            this._buildPieces(entry.group, pieces);
            Renderer._applyThinScale(entry);
            this._applyOpacity(entry, rep);
        }
        for (const [id, entry] of this._groups) {
            if (byId.has(id)) continue;
            if (entry.group.parent) entry.group.parent.remove(entry.group);
            this._groups.delete(id);
            const k = this._order.indexOf(id);
            if (k >= 0) this._order.splice(k, 1);
        }
        this._chopMemo = null;
        this.syncWorld();
        this._lastRebuilds = rebuilt;
        this._hasFat = list.some((o) => o.type === "stroke" && o.lwFrame * this.cam.inScale > this._gatePx() * 0.5);
        return reorder;
    }

    // Camera-only frame: no geometry rebuild. Sync the world transform, and
    // refresh opacity for faded groups (fade depends on inScale).
    //
    // `view` is the raster path's published composite (RASTERISER-PLAN §2.7
    // FC2) and is undefined on the SVG path, which reads the camera as it
    // always has.
    syncCameraOnly(view) {
        this.syncWorld(view);
        for (const entry of this._groups.values()) if (entry.fadeTag != null) this._applyOpacity(entry, entry.pieces[0]);
    }
    syncWorld(view) {
        this._syncWorldTransform(view);
        this._renderOverlays(view);
    }
    // RASTERISER-PLAN §2.5 seam 1, corrected: the overlay tail lives HERE and
    // not in `render()`, and it takes the view rather than the list (D200).
    // `RasterRenderer.render` and `.syncCameraOnly` call it with the view the
    // pyramid published (`PicturePyramid.frameFor`), so the ink, the SVG world group and
    // `bl-sel-edges` take one mapping (FC2).
    _renderOverlays(view) {
        this.overlays.render();
        this._renderSelOverlay(view);
    }
    // §2.5 seam 1's other half: the world group's own transform, which
    // `RasterRenderer` overrides to take the snapped `d` from the view.
    _syncWorldTransform() {
        // Fold the active scene's origin into the world transform IN FLOAT64
        // (screen = inScale·(p − O) + [inPan + inScale·O]): anchors are stored
        // origin-relative (small), and the bracketed translation is ~screen-
        // sized whenever the view is near the content, so nothing large ever
        // reaches Two.js' Float32Array matrices or the browser's float32
        // rasterizer. The cancellation between inPan (~ −inScale·viewCenter)
        // and inScale·O happens here, in JS doubles, where it's exact.
        const o = this._origin();
        this.world.scale = this.cam.inScale;
        this.world.translation.x = this.cam.inPanX + this.cam.inScale * o.x;
        this.world.translation.y = this.cam.inPanY + this.cam.inScale * o.y;
    }

    // ---- per-scene local origin (float32-safe path coordinates) ----
    // §2.5 seam 2: `_ovOrigin` is the raster path's overlay origin (null in SVG
    // mode) and it has ONE writer, in `RasterRenderer.addLive` (FC6). The object
    // identity is load-bearing: `_selDecide` caches its decision on
    // `c.origin === O` (`overlays.js:657`), so a fresh literal per call costs a
    // 26–47 ms decision every frame with every suite green.
    _origin() {
        if (this._ovOrigin) return this._ovOrigin;
        const sc = this._scenes.get(this._level);
        return (sc && sc.origin) || Renderer._ZERO;
    }
    _viewCenter() {
        const w = this.cam.frameWindow(0);
        return { x: Math.round((w.left + w.right) / 2), y: Math.round((w.top + w.bottom) / 2) };
    }
    // Screen-px distance between the view center and the scene's origin — the
    // quantity that bounds the browser-side float32 error of on-screen vertices.
    _driftPx(sc) {
        if (!sc || !sc.origin) return 0;
        const c = this._viewCenter();
        return Math.max(Math.abs(c.x - sc.origin.x), Math.abs(c.y - sc.origin.y)) * this.cam.inScale;
    }
    // True when a camera-only move has drifted past the budget: the engine must
    // promote it to a full render so _maybeReorigin can rebuild. Never mid-
    // stroke — the live path's anchors are origin-relative and a swap under the
    // pen would desync them (a real pan can't cover 1.5e6 px in one gesture;
    // this only fires on programmatic jumps).
    needsReorigin() {
        if (this.live.root) return false;
        return this._driftPx(this._scenes.get(this._level)) > REORIGIN_PX;
    }
    // Re-anchor the scene on a fresh origin: wipe its groups (keeping the Map /
    // array IDENTITY — _groups and _order alias them) so the diff pass in
    // render() rebuilds every path origin-relative. Costs one level-flip-sized
    // rebuild, at a once-per-1.9e6-screen-px cadence.
    _maybeReorigin(sc) {
        if (!sc || this.live.root) return;
        if (this._driftPx(sc) <= REORIGIN_PX) return;
        sc.origin = this._viewCenter();
        for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
        sc.groups.clear();
        sc.order.length = 0;
    }

    // ---- the window chop (F40; see the header, HOW FAR) ----
    // Does the scene's window still hold for this view: the view inside the
    // window's inner half, the zoom under CHOP_ZOOM times the zoom it was
    // chosen at. Both halves of the budget in the header depend on this.
    _chopHolds(chop) {
        if (this.cam.inScale > chop.inScale * CHOP_ZOOM) return false;
        const w = this.cam.frameWindow(0), h = chop.half / 2;
        return w.left >= chop.cx - h && w.right <= chop.cx + h && w.top >= chop.cy - h && w.bottom <= chop.cy + h;
    }
    // True when a camera-only move has left the window's inner half or zoomed
    // past its budget: the engine must promote it to a full render so the
    // chopped groups are rebuilt on a fresh window before its edge can reach
    // the screen. Never mid-stroke, for the same reason as needsReorigin.
    needsWindowChop() {
        if (this.live.root || !(this._chopPx > 0)) return false;
        const sc = this._scenes.get(this._level);
        return !!(sc && sc.chop && !this._chopHolds(sc.chop));
    }
    // Choose the scene's window afresh, centred on the view, when there is
    // none or the last no longer holds. Nothing is rebuilt here: the window's
    // key enters the signature of every piece that straddles it, and the diff
    // in render() rebuilds exactly those.
    _maybeRechop(sc) {
        if (!sc || !(this._chopPx > 0)) return;
        if (sc.chop && this._chopHolds(sc.chop)) return;
        const c = this._viewCenter();
        const half = this._chopPx / this.cam.inScale;
        sc.chop = { cx: c.x, cy: c.y, half, inScale: this.cam.inScale, key: ++this._chopSeq,
            rect: { left: c.x - half, top: c.y - half, right: c.x + half, bottom: c.y + half } };
    }
    /**
     * The window a piece has to be clipped to, or null when it can go to the
     * browser whole: it lies inside the window (every piece smaller than 175
     * screens at the zoom the window was chosen at — nearly everything), or
     * wholly outside it (hundreds of screens off screen, so what the browser
     * makes of its far coordinates cannot show). A tile piece is settled by
     * the rectangle it was cut on first, without touching its geometry; a
     * fill's bounds cost a pass over its points, which is why the verdict is
     * memoised for the render (the signature asks, then the build).
     */
    _chopFor(o) {
        if (!(this._chopPx > 0)) return null;
        const sc = this._scenes.get(this._level);
        const chop = sc && sc.chop;
        if (!chop) return null;
        if (!((o.type === "shape" && o.loops) || (o.type === "fill" && o.polys))) return null;
        const memo = this._chopMemo;
        if (memo && memo.has(o)) return memo.get(o);
        // A piece drawn shifted by its residual (F41) is judged against the
        // window shifted the other way.
        const r = o.res ? { left: chop.rect.left - o.res[0], right: chop.rect.right - o.res[0],
            top: chop.rect.top - o.res[1], bottom: chop.rect.bottom - o.res[1] } : chop.rect;
        const within = (l, t, rt, b) => l >= r.left && rt <= r.right && t >= r.top && b <= r.bottom;
        let verdict = null;
        const c = o.clip;
        if (c && ("x0" in c ? within(c.x0, c.y0, c.x1, c.y1) : within(c.left, c.top, c.right, c.bottom))) verdict = null;
        else {
            const bb = areaBounds(o);
            if (!bb || within(bb[0], bb[1], bb[2], bb[3])) verdict = null;
            else if (bb[2] < r.left || bb[0] > r.right || bb[3] < r.top || bb[1] > r.bottom) verdict = null;
            else verdict = chop;
        }
        if (memo) memo.set(o, verdict);
        return verdict;
    }
    /**
     * One area piece as anchors, through the window chop when it reaches past
     * the scene's window. The clip is the tile machinery's own
     * (`shapeLoopsInRect`: exact on arcs, and it answers "the window is wholly
     * inside the ink" with the window quad), so a chopped piece is the same
     * kind of thing as a tile piece, cut on a different rectangle. The
     * chopped geometry is local to this build; the piece itself is never
     * touched, and the selection indicator and the erase overlay still read
     * the whole object.
     */
    _pushArea(verts, o, og) {
        const ctx = this._planFor(o);
        const ch = this._chopFor(o);
        // THE RESIDUAL (F41): a piece whose object has offsets deeper than this
        // level is drawn translated by `o.res`. Folded into the origin the
        // anchors are taken relative to, so the geometry itself is never
        // touched; the chop window moves the other way to match.
        const ogp = o.res ? { x: og.x - o.res[0], y: og.y - o.res[1] } : og;
        const rect = ch && o.res ? { left: ch.rect.left - o.res[0], right: ch.rect.right - o.res[0],
            top: ch.rect.top - o.res[1], bottom: ch.rect.bottom - o.res[1] } : (ch ? ch.rect : null);
        if (o.type === "shape") {
            if (!ch) { pushShapeAnchors(verts, o.loops, ogp, ctx); return; }
            const cut = shapeLoopsInRect(o.loops, rect);
            if (cut.loops.length) pushShapeAnchors(verts, cut.loops, ogp, ctx);
            else for (const ring of cut.rings) pushRingAnchors(verts, ring, ogp, ctx);
            return;
        }
        for (const poly of (ch ? clipRingsToRect(o.polys, rect) : o.polys)) pushRingAnchors(verts, poly, ogp, ctx);
    }

    // Make `level` the active scene: point `_groups`/`_order`/`_activeRoot` at
    // its retained subtree, swapping the attached root under `world` (the whole
    // point — one detach + one attach instead of rebuilding paths). With
    // retention off, every level shares one scene ("_"), so a crossing lands on
    // the same groups map and the diff rebuilds exactly as before.
    _activateLevel(level) {
        const key = !this.retainScenes ? "_" : (level == null ? (this._level == null ? 0 : this._level) : level);
        let sc = this._scenes.get(key);
        if (this._level === key && sc) { sc.seq = ++this._activateSeq; return sc; }
        if (this._activeRoot && this._activeRoot.parent) this.world.remove(this._activeRoot);
        if (!sc) { sc = { root: new Two.Group(), groups: new Map(), order: [], seq: 0, origin: this._viewCenter() }; this._scenes.set(key, sc); }
        this.world.children.splice(0, 0, sc.root);   // under the live stroke's group
        this._level = key; this._activeRoot = sc.root;
        this._groups = sc.groups; this._order = sc.order;
        sc.seq = ++this._activateSeq;
        this._evictScenes();
        return sc;
    }
    // Bound retained DOM: keep the few most-recently-active levels; a very deep
    // zoom session would otherwise stockpile orphaned subtrees. The active scene
    // is never evicted. Evicted roots are detached already (only the active root
    // is attached), so dropping the reference frees the orphaned <g>.
    _evictScenes() {
        // By count AND by anchors: measured 2026-09-08 on the 12,849-object canvas, a
        // scene is ~200k anchors (~100 MB with its paths and SVG), and five retained
        // ones held 625k anchors while the tab sat at 1.7-2.5 GB. The active scene is
        // never evicted; the oldest inactive ones go until the rest fit the budget.
        const CAP = 8, ANCHOR_BUDGET = this.sceneAnchorBudget;
        const anchorsOf = (t) => { let n = 0; const walk = (x) => { if (!x) return; if (x.vertices) n += x.vertices.length; if (x.children) for (const c of x.children) walk(c); }; walk(t); return n; };
        let inactive = 0;
        for (const [k, sc] of this._scenes) if (k !== this._level) inactive += (sc.anchors = anchorsOf(sc.root));
        if (this._scenes.size <= CAP && inactive <= ANCHOR_BUDGET) return;
        const victims = [...this._scenes.entries()]
            .filter(([k]) => k !== this._level)
            .sort((a, b) => a[1].seq - b[1].seq);
        while ((this._scenes.size > CAP || inactive > ANCHOR_BUDGET) && victims.length) {
            const [k, sc] = victims.shift();
            for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
            if (sc.root.parent) sc.root.parent.remove(sc.root);
            this._scenes.delete(k);
            inactive -= sc.anchors || 0;
        }
    }

    _insertSorted(id) {
        // binary search for the insertion index — (z, id) ascending. The pen hot
        // path still appends (a fresh stroke has max id AND z = id); only cut
        // pieces (z < id) land mid-array, and that's a one-off reorder pass.
        const z = this._groups.get(id).z;
        const before = (oid) => { const oz = this._groups.get(oid).z; return oz < z || (oz === z && oid < id); };
        let lo = 0, hi = this._order.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (before(this._order[mid])) lo = mid + 1; else hi = mid; }
        this._order.splice(lo, 0, id);
        const group = this._groups.get(id).group;
        const root = this._activeRoot || this.world; // groups live under the active level's subtree
        if (lo === root.children.length) root.add(group);
        else root.children.splice(lo, 0, group); // one reorder pass per update
    }

    /**
     * ERASE DEBUG palette. One colour per REAL shape, so a logical object made
     * of several natives shows every one of them separately — which is the only
     * way to see a tile that did not join, a piece that is secretly two, or an
     * overlap where the pieces should abut.
     *
     * BLACK is reserved for a temporary tile piece (anything derived rather than
     * stored), and YELLOW for an eraser mark, so neither can be confused with a
     * real shape. Everything else cycles through a fixed palette by id: stable
     * across renders, so a piece does not change colour while you look at it.
     */
    /** A piece the tile machinery built for this view, not a stored object. */
    _isTemporary(o) { return o.origin !== "native"; }
    _debugColor(o) {
        if (o.erase) return "#ffd400";                        // an eraser mark
        // BLACK is ink that is not a shape HERE yet: either nothing resolved
        // stands behind it, or it belongs to a COARSER object and this is just
        // a magnified view of it. A piece stored FINER than the view — one an
        // erase ceded — keeps its own colour, so zooming out does not blacken
        // the piece you were working on.
        const role = this._pieceRoleFn ? this._pieceRoleFn(o.id) : (this._isTemporary(o) ? "up" : "same");
        if (role === "up" || role === "unbaked") return "#000000";
        const P = Renderer._DEBUG_PALETTE;
        // Indexed WITHIN the logical object, in the order its pieces are first
        // seen, so the shapes that make up one object are always different
        // colours from each other — which is the whole point. Remembered per id
        // so nothing changes colour while you are looking at it.
        const fam = o.editId != null ? o.editId : o.id;
        if (!this._dbgIndex) this._dbgIndex = new Map();
        let m = this._dbgIndex.get(fam);
        if (!m) { m = new Map(); this._dbgIndex.set(fam, m); }
        let k = m.get(o.id);
        if (k == null) { k = m.size % P.length; m.set(o.id, k); }
        return P[k];
    }
    _colorOf(o) { return this.eraseDebug ? this._debugColor(o) : o.color; }
    _opacityOf(o) {
        if (!this.eraseDebug) return o.opacity;
        if (o.erase) return 0.2;                    // an eraser mark
        return this._isTemporary(o) ? 0.5 : 0.7;    // a temporary tile / a real shape
    }
    // Opacity: object opacity × fade alpha (down-pieces) × tint. In group mode the
    // opacity lives once on the group; pieces stay fully opaque inside.
    _applyOpacity(entry, o) {
        // In erase-debug the opacity lives on each PATH (see `_opacityOf`), so
        // the group stays clear: two pieces of one object that overlap have to
        // read as darker, and a group-level alpha would hide exactly that.
        if (this.eraseDebug) { entry.group.opacity = this._fade(o); return; }
        // A FAMILY group holds only pieces that are FULLY PRESENT — that is the
        // grouping rule up in render() — so it is painted at full presence, and
        // never at the fade of whichever member happens to sort first.
        //
        // Reading `pieces[0]`'s fade here is the fade-out bug (reported
        // 2026-08-20). An erase family spans frames at very different depths: id
        // 158's members ran from the root frame down six levels. `pieces[0]` was
        // the deepest, genuinely microscopic member; the same group also held
        // the parent, measured on the reported drawing at 4,486,964 px across.
        // Zooming out ramped the microscopic member's fade 1 -> 0 and took the
        // window-filling parent with it: "the object that's fading covered the
        // entire window".
        const fade = entry.family ? 1 : this._fade(o);
        entry.group.opacity = (o.opacity == null ? 1 : o.opacity) * fade;
    }
    // How present a down-piece is: 1 well above the cull, 0 below the fade
    // floor, ramping between. Not a tag but a NUMBER, because a piece carries
    // its fadeTag whether or not it is actually faded, and "is this faded" and
    // "does this have a size tag" are different questions — see render().
    _fade(o) {
        if (o.fadeTag == null) return 1;
        const px = o.fadeTag * this.cam.inScale / this.cfg.enter; // actual on-screen size now
        const lo = this.cfg.fadeLoPx != null ? this.cfg.fadeLoPx : 0.15;
        const hi = this.cfg.cullPx != null ? this.cfg.cullPx : 0.3;
        return Math.max(0, Math.min(1, (px - lo) / (hi - lo)));
    }

    // A piece signature: same signature => identical geometry => reuse the paths.
    // MUST include coordinates, not just counts: a straight stroke crossing N
    // tiles yields N pieces of identical shape (1 run, 2 pts), and a solid flood
    // yields a 4-vertex quad per tile — scrolling the tile set by one swaps
    // pieces without changing any count, and a count-only signature would leave
    // stale paths on screen. First+last vertex anchor the signature cheaply.
    _sig(o) {
        // opacity is in the signature because in non-group mode it's painted on
        // the PATH — a restyle would otherwise leave stale paths behind.
        if (o.type === "shape") {
            // A resolved perimeter is view-independent, so its signature carries
            // no window and no scale: the group survives every camera move. The
            // bbox anchors it cheaply — two shapes with the same loop and piece
            // counts but different geometry cannot share a bounding box to two
            // decimals as well.
            // THE MEASURED PART IS MEMOISED PER PIECE (2026-09-07). `loopsBBox`
            // walks every arc of every piece on screen, and it ran for every
            // group on every render — so a render with nothing changed cost
            // O(N) in the drawing's size, and a pen-up, which renders twice,
            // cost 0.25 ms per stroke already on screen (95 ms a stroke at
            // 250 strokes in jsdom, 334 at 1,000; 0.5 s at 2,000 in Chrome).
            // A piece's loops never change under it: a tile piece is rebuilt
            // as a new object, and a native's edits bump `_ver` (Document
            // `_afterEdit`), which is what the memo is keyed by. The rest of
            // the signature stays live — colour, opacity, the window key and
            // the residual can change without the geometry moving.
            let m = this._sigMemo.get(o);
            if (!m || m.ver !== (o._ver || 0)) {
                const b = loopsBBox(o.loops) || { x0: 0, y0: 0, x1: 0, y1: 0 };
                let n = 0;
                for (const l of o.loops) n += l.length;
                m = { ver: o._ver || 0, s: o.loops.length + ":" + n + ":"
                    + b.x0.toFixed(2) + "," + b.y0.toFixed(2) + ":" + b.x1.toFixed(2) + "," + b.y1.toFixed(2) };
                this._sigMemo.set(o, m);
            }
            // `_ver` is in the signature, and it has to be. Coordinates are
            // rounded here, and at the deepest in-level zoom a whole pixel of
            // drag is 1/300 of a frame unit — under the rounding. Without an
            // edit counter the path would keep its old `d` and the object would
            // sit still while the pointer moved. Document bumps `_ver` on every
            // geometry edit, so this is exact rather than a finer rounding that
            // merely moves the threshold.
            // A piece that straddles the scene's window is built through the
            // chop, and the window's key here is what rebuilds it — and only
            // it — when the window is chosen again (F40).
            const ch = this._chopFor(o);
            // `res`, exactly: a drag from below moves it every event (F41).
            return "S" + o.id + ":" + m.ver + ":" + m.s
                + ":" + this._colorOf(o) + ":" + this._opacityOf(o) + (ch ? ":w" + ch.key : "") + (o.res ? ":r" + o.res[0] + "," + o.res[1] : "");
        }
        if (o.type === "fill") {
            const f0 = o.polys[0][0], ln = o.polys[o.polys.length - 1], l0 = ln[ln.length - 1];
            const ch = this._chopFor(o);
            return "f" + o.id + ":" + o.polys.length + ":" + o.polys.reduce((s, p) => s + p.length, 0)
                + ":" + f0[0].toFixed(2) + "," + f0[1].toFixed(2) + ":" + l0[0].toFixed(2) + "," + l0[1].toFixed(2) + ":" + o.color + ":" + o.opacity
                + (ch ? ":w" + ch.key : "") + (o.res ? ":r" + o.res[0] + "," + o.res[1] : "");
        }
        const a = o.pts[0], z = o.pts[o.pts.length - 1];
        const ends = a[0].toFixed(2) + "," + a[1].toFixed(2) + ":" + z[0].toFixed(2) + "," + z[1].toFixed(2);
        // Outline-represented (fat) strokes are geometry-only like thin ones:
        // the curve-capsule outline is view-independent, so their groups survive
        // every camera move — no stroke signature carries a window.
        // "O" outline · "F" pending past the gate (forces a rebuild so the
        // budgeted fit in _buildInto actually runs — a sig match would skip it)
        // · "s" plain raw
        const sm = this._strokeMode(o);
        const m = sm === "outline" ? "O"
            : (sm === "pending" && o.lwFrame * this.cam.inScale > this._gatePx() ? "F" : "s");
        return m + o.id + ":" + (o._ver || 0) + ":" + o.pts.length + ":" + o.lwFrame.toFixed(3) + ":" + ends + ":" + this._colorOf(o) + ":" + this._opacityOf(o);
    }

    /**
     * Build a group's pieces, with all FILL pieces of one colour merged into a
     * SINGLE path rather than one path each.
     *
     * Abutting fills seam. Two opaque paths sharing an edge each cover part of
     * the boundary pixel and composite source-over, so only 1 − α₁α₂ of the ink
     * lands and up to a quarter of the background still shows through: a pale
     * hairline down every join. Measured on a ceded tile — an interior pixel
     * lifted 18-25 % toward white at every in-level zoom, which is exactly the
     * "hairline outline around the erase" this feature kept being reported for.
     *
     * Subpaths of ONE path do not seam: the rasterizer accumulates coverage
     * across all of them before compositing anything. That is what lets the cede
     * model keep its cut EXACT — parent and child abutting on the tile boundary
     * with no overlap whatsoever — instead of paying for an overlap that would
     * have to be sized against the view, which is where the previous attempt's
     * `2/enter` pad came from and why it was 2 px at one zoom and 0.19 px at
     * another. The pieces are one object; drawing them as one shape is not a
     * trick, it is the truth.
     *
     * Merging is by colour and opacity (a group is one logical object, so in
     * practice one bucket) and preserves order: anything that is not a plain
     * fill flushes the bucket and goes through _buildInto as before.
     */
    /**
     * The arc plan for one piece: the frame's constants plus the piece's own
     * clip, so its seams are known. A COVERING quad (a band that swallowed its
     * whole tile, classifyUp's "solid" tier) is never split: its four edges
     * are the tile's own boundary, overlapped by its neighbours like any seam,
     * and the black quad under Kobin's drawing had grown 68 anchors for
     * nothing before this exception.
     */
    _planFor(o) {
        if (o && o.covers) return this._arcPlanNoChop;
        return o && o.clip ? { ...this._arcPlan, clip: asClip(o.clip) } : this._arcPlan;
    }
    _buildPieces(group, pieces) {
        let bucket = null, key = null;
        const flush = () => {
            if (bucket && bucket.verts.length) this._addFillPath(group, bucket.verts, bucket.color, bucket.opacity);
            bucket = null; key = null;
        };
        const og = this._origin();
        for (const o of pieces) {
            // Both AREA representations merge into one bucket: a tile's polygon
            // pieces and a native's resolved arc perimeter are the same object's
            // ink, and one path is the only way abutting pieces do not seam.
            // Two.js is happy to mix line and curve commands in one path, so the
            // merge does not force either side to give up its shape.
            const area = (o.type === "fill" && o.polys) || (o.type === "shape" && o.loops);
            if (!area) { flush(); this._buildInto(group, o); continue; }
            // Bucketed by the EFFECTIVE colour, so in erase-debug each real
            // shape lands in its own path and keeps its own opacity — which is
            // what makes an overlap between two of them visible as a darker
            // patch instead of being merged away.
            const col = this._colorOf(o), op = this._opacityOf(o);
            const k = col + "|" + (op == null ? 1 : op);
            if (k !== key) { flush(); key = k; bucket = { color: col, opacity: op, verts: [] }; }
            this._pushArea(bucket.verts, o, og);
        }
        flush();
    }
    /**
     * Give one object's coordinates a bigger unit, so its thin features survive
     * the browser's compositing (F-Z).
     *
     * Runs on the FINISHED group, after every path is built, and changes nothing
     * an earlier stage can observe: the anchors are multiplied by S and the
     * group's own transform is divided by S, which is exact for a power of two
     * and leaves the rendered result pixel-identical.
     *
     * Thinness is measured as `2·area / perimeter` over the group's own anchors
     * — for a long thin sliver that IS its width, and for a blob it is large, so
     * one number gates every piece type without asking what type it is. Curves
     * are measured by their endpoints, which is fine for a gate.
     */
    static _applyThinScale(entry) {
        const g = entry.group;
        // Dev kill-switch: `__kobinEngine.renderer.thinScale = false` (then pan
        // to force rebuilds) turns the rescale off live, so it can be A/B'd
        // against real browser paint — which no test in jsdom can measure.
        if (Renderer.thinScale === false) { g.scale = 1; entry.thinScale = 1; return; }
        let cross = 0, perim = 0, maxAbs = 0, pts = 0;
        for (const path of g.children) {
            const v = path.vertices;
            if (!v || v.length < 2) continue;
            // Subpaths are separated by `move`, and a fill closes each one, so
            // the closing edge has to be counted or the area is wrong for every
            // piece that has a hole.
            let sx = 0, sy = 0, px = 0, py = 0, open = false;
            // eslint-disable-next-line no-loop-func -- called synchronously within this iteration
            const close = () => {
                if (!open) return;
                cross += px * sy - sx * py;
                perim += Math.hypot(sx - px, sy - py);
                open = false;
            };
            for (let i = 0; i < v.length; i++) {
                const a = v[i], x = a.x, y = a.y;
                if (Math.abs(x) > maxAbs) maxAbs = Math.abs(x);
                if (Math.abs(y) > maxAbs) maxAbs = Math.abs(y);
                pts++;
                if (a.command === Two.Commands.move || i === 0) {
                    close();
                    sx = x; sy = y; px = x; py = y; open = true;
                    continue;
                }
                // An arc anchor stands for a curve: count its midpoint as a
                // vertex, or a circle of two half-arcs has no area here.
                if (a._mid) {
                    const mx = a._mid[0], my = a._mid[1];
                    cross += px * my - mx * py;
                    perim += Math.hypot(mx - px, my - py);
                    px = mx; py = my;
                }
                cross += px * y - x * py;
                perim += Math.hypot(x - px, y - py);
                px = x; py = y;
            }
            close();
        }
        if (!(perim > 0) || pts < 3 || !isFinite(maxAbs)) { g.scale = 1; entry.thinScale = 1; return; }
        const thick = Math.abs(cross) / perim;   // = 2·(|cross|/2)/perim

        let S = 1;
        while (S < THIN_SCALE_MAX
            && thick * S < THIN_TARGET_UNITS
            && maxAbs * (S * 2) <= THIN_COORD_MAX) S *= 2;

        entry.thinScale = S;
        g.scale = 1 / S;
        if (S === 1) return;
        for (const path of g.children) {
            for (const a of path.vertices) {
                a.x *= S; a.y *= S;
                // An arc's radius is a length in the same units as its anchor.
                if (a.command === Two.Commands.arc) { a.rx *= S; a.ry *= S; }
                if (a._mid) { a._mid[0] *= S; a._mid[1] *= S; }
                // Controls are stored RELATIVE (Two.js default), so they scale
                // with the anchor rather than about the origin.
                if (a.controls) {
                    a.controls.left.x *= S; a.controls.left.y *= S;
                    a.controls.right.x *= S; a.controls.right.y *= S;
                }
            }
            // The debug outline is a real stroke and is NOT in these units.
            if (path.linewidth) path.linewidth *= S;
        }
    }

    _addFillPath(group, verts, color, opacity) {
        const pOp = (this.opacityGroups && !this.eraseDebug) ? 1 : (opacity == null ? 1 : opacity);
        // `closed` is false whenever a curve or arc anchor can be present: a
        // fill auto-closes each subpath, while Two's closed flag would rule one
        // extra segment from the last point back to the first across the whole
        // path.
        const path = mkPath(verts, !verts.some((a) => a.command === Two.Commands.curve || a.command === Two.Commands.arc), false, true);
        path.fill = color; path.noStroke(); path.opacity = pOp;
        if (this.debug) { path.stroke = "red"; path.linewidth = 1 / this.cam.inScale; }
        group.add(path);
    }
    _addShapePath(group, verts, color, opacity) {
        const pOp = (this.opacityGroups && !this.eraseDebug) ? 1 : (opacity == null ? 1 : opacity);
        const path = mkPath(verts, false, false, true);
        path.fill = color; path.noStroke(); path.opacity = pOp;
        if (this.debug) { path.stroke = "red"; path.linewidth = 1 / this.cam.inScale; }
        group.add(path);
    }

    _buildInto(group, o) {
        if (o.type === "shape") {
            const verts = [];
            this._pushArea(verts, o, this._origin());
            if (verts.length) this._addShapePath(group, verts, this._colorOf(o), this._opacityOf(o));
            return;
        }
        // A stroke that has been drawn but not yet resolved still carries the
        // chain its pen built. Drawing THAT — rather than letting Two.js run its
        // own cardinal spline through the samples — is what makes pen-up
        // invisible: the ink under the pen, the ink between pen-up and the bake,
        // and the resolved shape are all the same curve. Without it the stroke
        // would twitch twice, once at pen-up and again when the bake landed.
        if (o.type === "stroke" && o._pen && o._pen.gaps && o._pen.gaps.length && !this._isLive(o)) {
            const og = this._origin();
            const verts = [];
            for (const gap of o._pen.gaps) pushGapAnchors(verts, gap, og, this._arcPlan);
            if (verts.length) {
                const pOp = (this.opacityGroups && !this.eraseDebug) ? 1 : (this._opacityOf(o) == null ? 1 : this._opacityOf(o));
                const path = mkPath(verts, false, false, true);
                path.noFill(); path.stroke = this._colorOf(o); path.linewidth = o.lwFrame;
                path.cap = "round"; path.join = "round"; path.opacity = pOp;
                group.add(path);
                return;
            }
        }
        const curved = o.origin === "native"; // per-origin curvature (derived pieces are pre-flattened)
        // Fat strokes (could ever exceed the gate in this level) render as
        // filled curve-capsule outlines — built once, exact at every zoom. In
        // lazy mode they stay RAW until they approach the gate on screen
        // ("pending"); the LIVE stroke always stays raw.
        if (o.type === "stroke") {
            const mode = this._strokeMode(o);
            if (mode === "outline") { this._buildOutlineInto(group, o, curved); return; }
            if (mode === "pending" && o.lwFrame * this.cam.inScale > this._gatePx() && this._fitSpentMs < 12) {
                // past the gate: convert NOW, but within a 12 ms/render budget —
                // strokes over budget stay raw one more frame (pixel-exact; the
                // Skia hazard only starts far above the gate) and the idle
                // fitter + follow-up render pick them up
                const t0 = perfRendererNow();
                this._buildOutlineInto(group, o, curved);
                this._fitSpentMs += perfRendererNow() - t0;
                return;
            }
        }
        const polys = o.type === "fill" ? o.polys : null;
        if (polys) {
            const og0 = this._origin();
            const og = o.res ? { x: og0.x - o.res[0], y: og0.y - o.res[1] } : og0;   // drawn shifted by its residual (F41)
            const verts = [];
            for (const poly of polys) {
                if (poly.length < 2) continue;
                for (let i = 0; i < poly.length; i++) {
                    const a = new Two.Anchor(poly[i][0] - og.x, poly[i][1] - og.y);
                    a.command = i === 0 ? Two.Commands.move : Two.Commands.line;
                    verts.push(a);
                }
            }
            if (verts.length) this._addFillPath(group, verts, this._colorOf(o), this._opacityOf(o));
        } else if (o.type !== "fill") {
            const og0 = this._origin();
            const og = o.res ? { x: og0.x - o.res[0], y: og0.y - o.res[1] } : og0;
            const pOp = (this.opacityGroups && !this.eraseDebug) ? 1 : (this._opacityOf(o) == null ? 1 : this._opacityOf(o));
            const path = mkPath(o.pts.map(([x, y]) => new Two.Anchor(x - og.x, y - og.y)), false, curved);
            path.noFill(); path.stroke = this._colorOf(o); path.linewidth = o.lwFrame; path.cap = "round"; path.join = "round"; path.opacity = pOp;
            group.add(path);
        }
    }

    // Fat strokes as filled curve-capsule outlines (geometry/curveOutline.js):
    // built ONCE per object in frame coordinates (cached on the object — the
    // Document busts `_outline` on move/restyle, tiles rebuild their pieces),
    // then rendered as manual Two.js bezier anchors. SVG rasterizes the curves,
    // so the same path is exact at every in-level zoom — no re-bake, ever.
    // Build (or fetch) the cached outline for a stroke. Public: the engine's
    // idle prefitter calls this so a later lazy flip costs nothing.
    ensureOutline(o, curved) {
        // One definition of "how a stroke becomes an outline", shared with the
        // eraser (geometry/curveOutline.js). Above the fat gate that outline is
        // CURVES, so it is exact at every in-level zoom — and the eraser, being
        // a stroke, is polygonized by the very same rule.
        return strokeLoops(o, this.cfg, { curved, live: this.live.model });
    }
    _buildOutlineInto(group, o, curved) {
        const loops = this.ensureOutline(o.piece || o, curved);   // a Stage item's getters take no `_outline`
        // loops -> anchors: segment k ends at anchor k+1; a curve-command anchor
        // consumes prev.controls.right (its segment's C1) and its own
        // controls.left (C2). Controls are stored RELATIVE (Two.js default).
        // Each loop ends exactly at its start point and the path stays open —
        // fill auto-closes subpaths, and Two's `closed` flag would draw a stray
        // closing segment across loops. Anchor positions are ORIGIN-RELATIVE
        // (controls are already relative offsets, so only x/y shift).
        const og = this._origin();
        const verts = [];
        for (const loop of loops) {
            const n = loop.length;
            if (!n) continue;
            for (let k = 0; k <= n; k++) {
                let x, y, lx = 0, ly = 0, rx = 0, ry = 0, cmd;
                if (k === 0) {
                    const s = loop[0];
                    x = s[0][0]; y = s[0][1];
                    rx = s[1][0] - x; ry = s[1][1] - y;
                    cmd = Two.Commands.move;
                } else {
                    const s = loop[k - 1];
                    x = s[3][0]; y = s[3][1];
                    lx = s[2][0] - x; ly = s[2][1] - y;
                    if (k < n) { const t = loop[k]; rx = t[1][0] - x; ry = t[1][1] - y; }
                    cmd = Two.Commands.curve;
                }
                verts.push(new Two.Anchor(x - og.x, y - og.y, lx, ly, rx, ry, cmd));
            }
        }
        if (!verts.length) return;
        const pOp = this.opacityGroups ? 1 : (o.opacity == null ? 1 : o.opacity);
        const path = mkPath(verts, false, false, true);
        path.fill = o.color; path.noStroke(); path.opacity = pOp;
        if (this.debug) { path.stroke = "red"; path.linewidth = 1 / this.cam.inScale; }
        group.add(path);
    }

    // ---- the live stroke: `LiveStrokeLayer` in `world`, begun at the active scene's origin, which the world
    // transform folds in float64, so live ink lands pixel-identical to its finished group. The origin never moves
    // mid-stroke (`needsReorigin`, `needsWindowChop`).
    addLive(o) { return this.live.begin(o, this._origin()); }
    setLiveArcs(gaps) { this.live.arcs(gaps); }
    /** Pen-up and a cancel: the path goes now; the stroke's own group draws it from the next render. */
    endLive() { this.live.cancel(); }
    /** List item `o` is the stroke under the pen: its only picture is the live path. */
    _isLive(o) { const m = this.live.model; return m !== null && (o === m || o.piece === m); }
    // RasterRenderer's inherited live-stroke fields, until it composes the layer (B-PYRAMID-3 item 4).
    get _live() { return this.live.tail; }
    set _live(v) { this.live.tail = v; }
    get _liveRoot() { return this.live.root; }
    set _liveRoot(v) { this.live.root = v; }
    get _liveModel() { return this.live.model; }
    set _liveModel(v) { this.live.model = v; }

    setLasso(fn) { this.overlays.setLasso(fn); }
    /** PAPER-PLAN R3: the engine's live drag, pulled by a renderer that draws the dragged ink itself (`supportsDragPlane`). */
    setDragState(fn) { this._dragStateFn = fn; }
    /** PAPER-PLAN §10 S4: the selection a drag plane is kept ready for; the SVG renderer has none. */
    setPlaneState(fn) { this._planeFn = fn; }
    /** A drag ended (`why`: drop, cancel, delete, deselect); `n` plates were dropped for it. The SVG renderer has nothing to do. */
    endMove() {}
    /** The lasso redrawn alone: a lasso drag calls this, not `syncWorld`. */
    refreshSelection() { this.overlays.lasso(); this.update(); }

    /**
     * The selection indicator: marching ants on the object's own edge, and —
     * where it carries on past the side of the screen — ants along that side
     * with an arrow pointing the way it goes.
     *
     * There is no shimmer. A breathing wash over the ink was tried against the
     * design file's four candidates and dropped (Kobin, 2026-08-25): on a real
     * drawing it reads as the picture flickering rather than as a selection.
     *
     * WHY THIS IS RAW SVG AND NOT TWO.JS. The animation is CSS: the dash offset
     * crawls on the compositor without touching the main thread, so the ants
     * cost the same whether the selection is a thumbnail or runs off every side
     * of the screen. Driving it from JavaScript would put a repaint of the
     * selection on every frame, which at depth is the whole viewport.
     *
     * WHAT IS DRAWN:
     *   ANTS along the object's true boundary, clipped to the view, with every
     *     tile join dropped.
     *   SCREEN-EDGE ANTS where the object continues past the side of the view,
     *     set in from the edge so the whole band shows.
     *   AN ARROW on each of those sides, breathing faintly, pointing the way
     *     the object carries on.
     */
    setSelectionAnts(fn) { this._selAntsFn = fn; }

    /** The selection indicator, drawn by `svgOverlay.renderSelAnts`; the raster path overrides this (its ants are a canvas). */
    _renderSelOverlay() {
        const svg = this.svg.element;
        if (!svg || typeof document === "undefined") return;
        const data = this._selAntsFn && this._selAntsFn();
        if (!data || !((data.runs && data.runs.length) || (data.marks && data.marks.length) || (data.edges && data.edges.length))) {
            this._dropSelOverlay();
            return;
        }
        ensureSelStyle();
        if (!this._selEls) { this._selEls = buildSelOverlay(svg); this._selOv = this._selEls.layers; }
        renderSelAnts(this._selEls, data, this.width, this.height);
    }
    _dropSelOverlay() {
        dropSelOverlay(this._selEls, this._selOv);
        this._selOv = null;
        this._selEls = null;
    }
    // RasterRenderer's inherited indicator seams, until it composes (B-PYRAMID-3 item 4).
    _renderSelChevrons(edges, kt, W, H) { return renderSelChevrons(this._selEls, edges, kt, W, H); }
    _mkSelLayer(svg, host, cls) { return mkSelLayer(svg, host, cls); }
    static _ensureSelStyle() { ensureSelStyle(); }

    setOpacityGroups(v) { this.opacityGroups = v; }
    setLazyOutlines(v) { this.lazyOutlines = !!v; }
    // Toggle per-level scene retention. Switching modes changes what a scene key
    // means, so wipe the cache and let the next render rebuild once.
    setRetainScenes(v) { v = !!v; if (v === this.retainScenes) return; this.retainScenes = v; this.clear(); }
    setDebug(v) { this.debug = v; }
    setTileDebug(v, fn) { this.overlays.setTileDebug(v, fn); }
    setEraseDebug(v, fn, roleFn) {
        this.eraseDebug = !!v;
        this._pieceRoleFn = roleFn || this._pieceRoleFn;
        this.overlays.setEraseDebug(v, fn);
        this.bumpAll();   // every signature changes: colours and opacity differ
    }
    /** Force every group to rebuild (a global style change, not a geometry one). */
    bumpAll() {
        for (const e of this._groups.values()) e.sig = null;
        for (const sc of this._scenes.values()) for (const e of sc.groups.values()) e.sig = null;
        this._dbgIndex = new Map();
    }
    clear() {
        for (const sc of this._scenes.values()) {
            for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
            if (sc.root.parent) sc.root.parent.remove(sc.root);
        }
        this._scenes.clear();
        this._level = null; this._activeRoot = null;
        this._groups = new Map(); this._order = [];
    }
}

// Shared fallback origin for the pre-first-render window (no scene yet).
Renderer._ZERO = { x: 0, y: 0 };
// Erase-debug fills. Black and yellow are NOT in here: they mean "temporary
// tile" and "eraser mark", and a real shape must never be mistaken for either.
Renderer._DEBUG_PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#46f0f0", "#f032e6", "#bcf60c", "#008080", "#9a6324",
];
