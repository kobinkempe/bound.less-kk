/**
 * Renderer — the ONLY class that touches Two.js. Owns the SVG scene, one
 * persistent Two.Group per object id (kept sorted by id = global z-order), the
 * per-frame diff (camera-only frames sync transforms + fade opacity without
 * rebuilding any path), and the fat-stroke display bake.
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
 *  - Fat display (BUG-02): the bake window pad is max(half screen, 1.2 × widest
 *    visible fat half-width), so the window can never be outrun by a stroke —
 *    and projection giants no longer arrive as strokes (they're tile fills), so
 *    the only fat cases are the active level's own bounded natives.
 *  - Continuous fade (BUG-04): a down-piece carries fadeTag (its size at the
 *    level's deepest zoom); its group opacity ramps to 0 across the sub-pixel
 *    cull instead of popping.
 */
import Two from "two.js";
import { strokeStripNear, flattenCurve, flattenCurveNear, decimatePolyline } from "./geometry/polyline";
import { strokeOutline } from "./geometry/clipperBoolean";
import { strokeLoops } from "./geometry/curveOutline";
import { shapeToCubics, loopsBBox, pieceToCubics } from "./geometry/arcShape";

/**
 * Append a chain of cubics to `verts` as Two.js anchors, continuing whatever is
 * already there.
 *
 * A cubic's two handles belong to DIFFERENT anchors — the first to the anchor it
 * leaves, the second to the anchor it arrives at — so appending has to reach
 * back and set the previous anchor's outgoing handle. That is what makes the
 * chain streamable: each new piece touches exactly one existing anchor, so the
 * live pen can extend its path in O(1) instead of rebuilding it.
 */
function pushCubicChain(verts, cubics, og) {
    for (const c of cubics) {
        if (!verts.length) {
            verts.push(new Two.Anchor(c[0][0] - og.x, c[0][1] - og.y,
                0, 0, c[1][0] - c[0][0], c[1][1] - c[0][1], Two.Commands.move));
        } else {
            const prev = verts[verts.length - 1];
            prev.controls.right.x = c[1][0] - (prev.x + og.x);
            prev.controls.right.y = c[1][1] - (prev.y + og.y);
        }
        verts.push(new Two.Anchor(c[3][0] - og.x, c[3][1] - og.y,
            c[2][0] - c[3][0], c[2][1] - c[3][1], 0, 0, Two.Commands.curve));
    }
}

/** One biarc gap's arcs, as anchors. */
function pushGapAnchors(verts, gap, og) {
    for (const a of gap) pushCubicChain(verts, pieceToCubics(a), og);
}

/**
 * A resolved arc perimeter as Two.js anchors, appended to `verts`.
 *
 * Arcs go out as cubics because Two.js speaks nothing else, and the conversion
 * is exact to 2e-4 of the radius on quarter-circle pieces — orders under
 * display tolerance, and view-INDEPENDENT, so the path is right at every
 * in-level zoom and never has to be rebuilt for a camera move.
 *
 * Each loop ends exactly where it began and the path stays OPEN: a fill
 * auto-closes its subpaths, while Two's `closed` flag would rule a stray
 * segment from the end of one loop back to the start of the whole path.
 * Controls are stored relative, which is Two's own convention, so only the
 * anchor positions take the scene origin.
 */
function pushShapeAnchors(verts, loops, og) {
    for (const loop of shapeToCubics(loops)) {
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
}

const perfRendererNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Two.js's Collection takes its initial contents with
// `Array.prototype.push.apply(this, verts)`, and `apply` gives out once the
// array is longer than the engine's argument limit — measured in V8: fine at
// 100,000 anchors, "Maximum call stack size exceeded" at 131,072.
//
// That is reachable by DRAWING, not only by pathological input. A fat stroke's
// capsule outline runs ~13 cubics per centerline anchor, so a few thousand
// points of one scribbled drag crosses it; an erased fill is worse. And it
// surfaces as a crash with no ink at all, not as a slow render, because the
// throw happens before the path reaches the scene.
//
// So never hand Two.js an unbounded array. Build the path empty and push in
// bounded chunks — through Collection.push, so each anchor still raises the
// `insert` event that Path binds its renderer flags to. Pushing onto the
// collection with Array.prototype.push would skip that and leave the new
// anchors untracked.
const ANCHOR_CHUNK = 4096;
function mkPath(verts, closed, curved, manual) {
    const path = new Two.Path([], closed, curved, manual);
    for (let i = 0; i < verts.length; i += ANCHOR_CHUNK) {
        path.vertices.push(...verts.slice(i, i + ANCHOR_CHUNK));
    }
    return path;
}

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


// A selection outline is drawn only while it could actually be SEEN: the box
// has to overlap the viewport, and be no more than this many viewports across.
// That second clause is a PERFORMANCE INVARIANT, not a cosmetic one — see
// `_renderSelection`.
const SEL_MAX_VIEWPORTS = 3;

// ---- the selection indicator's look, from the Claude Design spec ------------
// Ants: a band centred ON the silhouette ("Ants sit: on the edge"), in the
// product's own terracotta.
//
// 2.5 px, not 5. The design file strokes a mark at `w + 2.5` against a mask
// eroded to `w - 2.5`, which leaves TWO ribbons — one down each edge of the
// stroke — each 2.5 px wide and centred on its edge. The 5 is the total across
// both. Tracing the outline as a loop covers both edges in one pass, so the
// stroke width here is one ribbon: 2.5.
const SVG_NS = "http://www.w3.org/2000/svg";
const SEL_INK = "oklch(0.6 0.17 35)";
// The speck: a mark down at the size of a pixel. It BLINKS rather than crawls —
// its outline is shorter than one dash cycle, so as the pattern slides the whole
// mark passes in and out of a gap. That is the file's behaviour and it is what
// makes a sub-pixel mark read as an indicator instead of a stray pixel.
const SEL_FINE_W = 1.75, SEL_FINE_ON = 3.5, SEL_FINE_OFF = 2.8;
// The DASH LENGTH is 7, not the file's 5, and that is deliberate. The file
// measures its dash along the middle of a stroke and then shows you the edge —
// so on a bend the outer edge, which is a longer arc, stretches the dash and the
// inner edge squashes it. Measured on the file's own scenes: the half-covering
// stroke reads 3.2 px on its inner edge and 6.8 px on its outer one, a 2:1
// spread across a single mark. Tracing the outline gives one honest length
// everywhere, so it has to be chosen — and Kobin picked the outer-edge size,
// which rounds to 7 with the gap kept at the file's 5:4 ratio.
const SEL_ANT_W = 2.5, SEL_ANT_ON = 7, SEL_ANT_OFF = 5.6;
// THIN MARKS SHRINK, which the file does not do — its 2.5 px ribbon on a 3 px
// stroke buries the mark under its own indicator. Below this ink width the whole
// pattern scales down together, so the ants stay in proportion to what they are
// pointing at rather than replacing it.
// The floor is the SPECK's own band, so the pattern never gets thinner than the
// thing it collapses into. At 0.4 the ants went down to a 1 px hairline and
// marks between about 1 and 5 px — the splotchy ones especially — stopped
// reading as selected at all. Tying it to SEL_FINE_W also removes a
// discontinuity: as a mark shrinks past the point of being traceable, the band
// it had is the band its speck gets.
const SEL_THIN_REF = 10;
const SEL_THIN_MIN = SEL_FINE_W / SEL_ANT_W;   // 1.75 / 2.5 = 0.7
const selAntScale = (inkPx) => (inkPx == null || !isFinite(inkPx) ? 1
    : Math.max(SEL_THIN_MIN, Math.min(1, inkPx / SEL_THIN_REF)));
// The arrow that marks where a selection carries on past the side of the
// screen: an open terracotta chevron, breathing gently.
//
// Parameterised by SPAN (tip to tip) and DEPTH (how far the vertex stands
// proud), because that is what decides how open it looks. The angle AT THE
// VERTEX is `2 * atan(span / 2 / depth)` — about 110 degrees here, a wide V.
//
// Getting this wrong twice is what makes it worth spelling out: written as a
// length and a "rise" it was 13 long by 2.6, which reads as a spike, and
// measuring the arm against the horizontal made it look like 157 degrees when
// the vertex angle was 22.6.
const SEL_ARROW_SPAN = 17, SEL_ARROW_DEPTH = 6, SEL_ARROW_GAP = 24;
// How many runs shorter than a dash cycle share one path (see _renderSelOverlay).
const SEL_BATCH_RUNS = 100;
// How long after the last camera step the crawl stays frozen.
const SEL_CRAWL_RESUME_MS = 150;



export default class Renderer {
    constructor(container, camera, cfg, opts = {}) {
        this.cam = camera; this.cfg = cfg;
        this.width = opts.width; this.height = opts.height;
        this.opacityGroups = true; this.outlineMode = false; this.debug = false;
        this.two = new Two({ width: this.width, height: this.height, autostart: true });
        this.two.appendTo(container);
        this.world = this.two.makeGroup();
        this.tileDebugGroup = this.two.makeGroup();
        this.eraseDebugGroup = this.two.makeGroup();
        this.eraseDebug = false;
        this.selGroup = this.two.makeGroup(); // selection highlight (screen space, above everything)
        this._selRectFn = null;               // () -> { level, rect } | null
        this._selAntsFn = null;               // () -> { key, transform, runs, marks, edges, inkPx } | null
        this._selOv = null;                   // the indicator's own <svg> layer
        this._selEls = null;
        this._lassoFn = null;                 // () -> [[sx,sy], ...] | null (screen space)
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
        Renderer.thinScale = Renderer.thinScale !== false;  // dev-toggleable (F-Z rescale)
        this._scenes = new Map();   // levelKey -> { root, groups, order, seq }
        this._level = null;         // active scene key
        this._activeRoot = null;    // active scene's Two.Group (child of world)
        this._activateSeq = 0;      // recency counter for the scene LRU
        this._lastRebuilds = 0;     // groups (re)built in the last render()
        this._hasFat = false;
        this._bakedWindow = null;
        this._lastBakeScale = 0;
        this._liveModel = null;     // the growing stroke: never outline-cached
        this.lazyOutlines = true;   // fat strokes render RAW until they approach the
                                    // gate on screen (fit cost moves off pen-up and
                                    // onto idle/approach) — dev-toggleable
        this._pendingFatLw = 0;     // widest fat-gated stroke still rendering raw
        this.tileDebug = false;
        this._tileRectsFn = null;   // () -> [{level,i,j,rect}] for debug overlay
    }
    destroy() {
        try { this.two.pause(); } catch (e) { /* ignore */ }
        this._dropSelOverlay();
        const el = this.two.renderer && this.two.renderer.domElement;
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    setSize(w, h) { this.width = w; this.height = h; this.two.renderer.setSize(w, h); }
    update() { this.two.update(); }

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
        if (o.type !== "stroke" || this.outlineMode || o === this._liveModel || !this._fatEver(o)) return "raw";
        if (!this.lazyOutlines || o._outline) return "outline";
        return "pending";
    }
    // Force a flip render once a pending stroke's RAW width actually crosses
    // the gate (the render then fits it within the budget — Skia safety).
    needsFatFlip() {
        return !this.outlineMode && this.lazyOutlines && this._pendingFatLw > 0 &&
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
    // Pad the bake window by half a screen OR 1.2× the widest visible fat stroke's
    // half-width, whichever is larger — so the window can never be outrun.
    // (outlineMode debug only — normal rendering no longer bakes to a window.)
    outlinePad(list) {
        let pad = (0.5 * this.width) / this.cam.inScale;
        if (list) for (const o of list) if (this._fatOnScreen(o)) pad = Math.max(pad, 1.2 * o.lwFrame / 2);
        return pad;
    }
    _windowCovered() {
        const b = this._bakedWindow; if (!b) return false;
        const w = this.cam.frameWindow(0);
        return w.left >= b.left && w.right <= b.right && w.top >= b.top && w.bottom <= b.bottom;
    }
    // Does a zoom/pan need a re-bake? Only the outlineMode DEBUG view is baked
    // per-window/scale now — fat strokes render as curve-capsule outlines that
    // are exact at every in-level zoom (see geometry/curveOutline.js), so
    // ordinary zooming never re-tessellates anything (the old 25%-band fat
    // re-bake — ISSUE-12's display half — is gone).
    needsRebake() {
        if (!this.outlineMode) return false;
        const last = this._lastBakeScale || 0;
        return this.cam.inScale > last * 1.25 || this.cam.inScale < last * 0.8 || !this._windowCovered();
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
        const pad = this.outlinePad(list);
        const vw = this.cam.frameWindow(pad);
        this._pendingFatLw = 0; // recounted below
        this._fitSpentMs = 0;   // per-render outline-fitting budget
        const byId = new Map();
        for (const o of list) {
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
            const sig = pieces.map((o) => this._sig(o, vw)).join("|");
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
            this._buildPieces(entry.group, pieces, vw);
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
        this.syncWorld();
        this._lastBakeScale = this.cam.inScale;
        this._lastRebuilds = rebuilt;
        this._hasFat = list.some((o) => o.type === "stroke" && o.lwFrame * this.cam.inScale > this._gatePx() * 0.5);
        this._bakedWindow = this.outlineMode ? this.cam.frameWindow(pad) : null;
        return reorder;
    }

    // Camera-only frame: no geometry rebuild. Sync the world transform, and
    // refresh opacity for faded groups (fade depends on inScale).
    syncCameraOnly() {
        this.syncWorld();
        for (const entry of this._groups.values()) if (entry.fadeTag != null) this._applyOpacity(entry, entry.pieces[0]);
    }
    syncWorld() {
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
        this._renderTileDebug();
        this._renderEraseDebug();
        this._renderSelection();
        this._renderSelOverlay();
    }

    // ---- per-scene local origin (float32-safe path coordinates) ----
    _origin() {
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
        if (this._live) return false;
        return this._driftPx(this._scenes.get(this._level)) > REORIGIN_PX;
    }
    // Re-anchor the scene on a fresh origin: wipe its groups (keeping the Map /
    // array IDENTITY — _groups and _order alias them) so the diff pass in
    // render() rebuilds every path origin-relative. Costs one level-flip-sized
    // rebuild, at a once-per-1.9e6-screen-px cadence.
    _maybeReorigin(sc) {
        if (!sc || this._live) return;
        if (this._driftPx(sc) <= REORIGIN_PX) return;
        sc.origin = this._viewCenter();
        for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
        sc.groups.clear();
        sc.order.length = 0;
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
        this.world.add(sc.root);
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
        const CAP = 8;
        if (this._scenes.size <= CAP) return;
        const victims = [...this._scenes.entries()]
            .filter(([k]) => k !== this._level)
            .sort((a, b) => a[1].seq - b[1].seq);
        while (this._scenes.size > CAP && victims.length) {
            const [k, sc] = victims.shift();
            for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
            if (sc.root.parent) sc.root.parent.remove(sc.root);
            this._scenes.delete(k);
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
    _sig(o, vw) {
        // opacity is in the signature because in non-group mode it's painted on
        // the PATH — a restyle would otherwise leave stale paths behind.
        if (o.type === "shape") {
            // A resolved perimeter is view-independent, so its signature carries
            // no window and no scale: the group survives every camera move. The
            // bbox anchors it cheaply — two shapes with the same loop and piece
            // counts but different geometry cannot share a bounding box to two
            // decimals as well.
            const b = loopsBBox(o.loops) || { x0: 0, y0: 0, x1: 0, y1: 0 };
            let n = 0;
            for (const l of o.loops) n += l.length;
            // `_ver` is in the signature, and it has to be. Coordinates are
            // rounded here, and at the deepest in-level zoom a whole pixel of
            // drag is 1/300 of a frame unit — under the rounding. Without an
            // edit counter the path would keep its old `d` and the object would
            // sit still while the pointer moved. Document bumps `_ver` on every
            // geometry edit, so this is exact rather than a finer rounding that
            // merely moves the threshold.
            return "S" + o.id + ":" + (o._ver || 0) + ":" + o.loops.length + ":" + n + ":"
                + b.x0.toFixed(2) + "," + b.y0.toFixed(2) + ":" + b.x1.toFixed(2) + "," + b.y1.toFixed(2)
                + ":" + this._colorOf(o) + ":" + this._opacityOf(o);
        }
        if (o.type === "fill") {
            const f0 = o.polys[0][0], ln = o.polys[o.polys.length - 1], l0 = ln[ln.length - 1];
            return "f" + o.id + ":" + o.polys.length + ":" + o.polys.reduce((s, p) => s + p.length, 0)
                + ":" + f0[0].toFixed(2) + "," + f0[1].toFixed(2) + ":" + l0[0].toFixed(2) + "," + l0[1].toFixed(2) + ":" + o.color + ":" + o.opacity;
        }
        const a = o.pts[0], z = o.pts[o.pts.length - 1];
        const ends = a[0].toFixed(2) + "," + a[1].toFixed(2) + ":" + z[0].toFixed(2) + "," + z[1].toFixed(2);
        // Outline-represented (fat) strokes are geometry-only like thin ones:
        // the curve-capsule outline is view-independent, so their groups survive
        // every camera move. The mode marker makes a lazy raw→outline flip
        // rebuild the group. Only the outlineMode DEBUG bake is window-keyed.
        const fat = this.outlineMode;
        if (!fat) {
            // "O" outline · "F" pending past the gate (forces a rebuild so the
            // budgeted fit in _buildInto actually runs — a sig match would skip
            // it) · "s" plain raw
            const sm = this._strokeMode(o);
            const m = sm === "outline" ? "O"
                : (sm === "pending" && o.lwFrame * this.cam.inScale > this._gatePx() ? "F" : "s");
            return m + o.id + ":" + (o._ver || 0) + ":" + o.pts.length + ":" + o.lwFrame.toFixed(3) + ":" + ends + ":" + this._colorOf(o) + ":" + this._opacityOf(o);
        }
        // window-dependent bake: quantize the window so small pans inside the pad reuse
        const q = (v) => Math.round(v / (Math.max(1, (vw.right - vw.left)) * 0.1));
        return "F" + o.id + ":" + o.lwFrame.toFixed(3) + ":" + ends + ":" + q(vw.left) + "," + q(vw.top) + "," + q(vw.right) + "," + q(vw.bottom) + ":" + this._colorOf(o) + ":" + this._opacityOf(o);
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
    _buildPieces(group, pieces, vw) {
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
            if (!area) { flush(); this._buildInto(group, o, vw); continue; }
            // Bucketed by the EFFECTIVE colour, so in erase-debug each real
            // shape lands in its own path and keeps its own opacity — which is
            // what makes an overlap between two of them visible as a darker
            // patch instead of being merged away.
            const col = this._colorOf(o), op = this._opacityOf(o);
            const k = col + "|" + (op == null ? 1 : op);
            if (k !== key) { flush(); key = k; bucket = { color: col, opacity: op, verts: [] }; }
            if (o.type === "shape") pushShapeAnchors(bucket.verts, o.loops, og);
            else {
                for (const poly of o.polys) {
                    if (poly.length < 2) continue;
                    for (let i = 0; i < poly.length; i++) {
                        const a = new Two.Anchor(poly[i][0] - og.x, poly[i][1] - og.y);
                        a.command = i === 0 ? Two.Commands.move : Two.Commands.line;
                        bucket.verts.push(a);
                    }
                }
            }
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
        // `closed` is false whenever a curve anchor can be present: a fill
        // auto-closes each subpath, while Two's closed flag would rule one extra
        // segment from the last point back to the first across the whole path.
        const path = mkPath(verts, !verts.some((a) => a.command === Two.Commands.curve), false, true);
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

    _buildInto(group, o, vw) {
        if (o.type === "shape") {
            const verts = [];
            pushShapeAnchors(verts, o.loops, this._origin());
            if (verts.length) this._addShapePath(group, verts, this._colorOf(o), this._opacityOf(o));
            return;
        }
        // A stroke that has been drawn but not yet resolved still carries the
        // chain its pen built. Drawing THAT — rather than letting Two.js run its
        // own cardinal spline through the samples — is what makes pen-up
        // invisible: the ink under the pen, the ink between pen-up and the bake,
        // and the resolved shape are all the same curve. Without it the stroke
        // would twitch twice, once at pen-up and again when the bake landed.
        if (o.type === "stroke" && o._pen && o._pen.gaps && o._pen.gaps.length && o !== this._liveModel) {
            const og = this._origin();
            const verts = [];
            for (const gap of o._pen.gaps) pushGapAnchors(verts, gap, og);
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
        // ("pending"); the LIVE stroke always stays raw. outlineMode keeps the
        // legacy windowed polygon bake as a DEBUG view.
        if (o.type === "stroke" && !this.outlineMode) {
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
        let polys = null;
        if (o.type === "fill") polys = o.polys;
        else if (this.outlineMode) polys = this._fatPolys(o, vw, curved);
        if (polys) {
            const og = this._origin();
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
            const og = this._origin();
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
        return strokeLoops(o, this.cfg, { curved, live: this._liveModel });
    }
    _buildOutlineInto(group, o, curved) {
        const loops = this.ensureOutline(o, curved);
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

    // The fat display bake — a verbatim port of KobinEngineV0._buildPaths' fat
    // branch (window-clipped outline fill with the covered/mega short-circuits),
    // reading pad from outlinePad() so BUG-02 cannot recur.
    // KEPT ONLY for the outlineMode DEBUG view (normal rendering uses
    // _buildOutlineInto's zoom-invariant curve capsules).
    _fatPolys(o, vw, curved) {
        const cx = (vw.left + vw.right) / 2, cy = (vw.top + vw.bottom) / 2;
        const hw = (vw.right - vw.left) / 2, hh = (vw.bottom - vw.top) / 2;
        const half = o.lwFrame / 2;
        const polys = [];
        // bbox
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of o.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
        if (x1 + half < vw.left || x0 - half > vw.right || y1 + half < vw.top || y0 - half > vw.bottom) return polys;
        let covered = false;
        for (const p of o.pts) if (Math.hypot(Math.abs(p[0] - cx) + hw, Math.abs(p[1] - cy) + hh) < half) { covered = true; break; }
        const diagW = Math.hypot(vw.right - vw.left, vw.bottom - vw.top);
        // span OR radius keyed (ISSUE-14): a wide-but-short giant must also take
        // the analytic strip, not Clipper's offset at astronomic radius.
        const mega = Math.hypot(x1 - x0, y1 - y0) > 20 * diagW || half > 4 * diagW;
        let cpts = [];
        if (!covered) {
            if (curved && o.pts.length > 2 && mega) {
                cpts = flattenCurveNear(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter, vw, Math.max(0, half - diagW), half + diagW);
            } else {
                cpts = (curved && o.pts.length > 2) ? flattenCurve(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter) : o.pts;
            }
        }
        const pieces = []; let cur = null;
        for (let i = 0; i < cpts.length; i++) {
            const px = Math.abs(cpts[i][0] - cx), py = Math.abs(cpts[i][1] - cy);
            if (Math.hypot(px + hw, py + hh) < half) { covered = true; break; }
            const near = Math.hypot(Math.max(px - hw, 0), Math.max(py - hh, 0));
            const gap = i + 1 < cpts.length ? Math.hypot(cpts[i + 1][0] - cpts[i][0], cpts[i + 1][1] - cpts[i][1]) : 0;
            const prevGap = i > 0 ? Math.hypot(cpts[i][0] - cpts[i - 1][0], cpts[i][1] - cpts[i - 1][1]) : 0;
            if (near <= half + Math.max(gap, prevGap)) {
                if (!cur) { cur = []; pieces.push(cur); if (i > 0) cur.push(cpts[i - 1]); }
                cur.push(cpts[i]);
            } else { if (cur) cur.push(cpts[i]); cur = null; }
        }
        if (covered) {
            const m = 2 / this.cam.inScale;
            polys.push([[vw.left - m, vw.top - m], [vw.right + m, vw.top - m], [vw.right + m, vw.bottom + m], [vw.left - m, vw.bottom + m]]);
            return polys;
        }
        const eq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
        const lvw = { left: vw.left - cx, top: vw.top - cy, right: vw.right - cx, bottom: vw.bottom - cy };
        for (const run of pieces) {
            if (!run.length) continue;
            const drun = decimatePolyline(run, (this.cfg.arcTolerancePx * 0.5) / this.cam.inScale);
            let op;
            if (mega) {
                op = strokeStripNear(drun.map(([x, y]) => [x - cx, y - cy]), o.lwFrame, lvw,
                    { startCap: eq(drun[0], cpts[0]), endCap: eq(drun[drun.length - 1], cpts[cpts.length - 1]) });
            } else {
                op = strokeOutline(drun.map(([x, y]) => [x - cx, y - cy]), o.lwFrame, { arcTolerancePx: this.cfg.arcTolerancePx, curved: false, displayScale: this.cam.inScale });
            }
            for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
        }
        return polys;
    }

    // ---- live in-progress stroke (immediate feedback, outside the diff) ----
    // Origin-relative like every other path, and parented under the ACTIVE
    // SCENE ROOT (not `world`): the scene origin folds into the world transform
    // in float64, so live ink lands pixel-identical to its finalized rendering.
    // _maybeReorigin/needsReorigin never fire while _live exists, so the origin
    // is stable for the whole gesture.
    // `arcs` true => the ink under the pen IS the biarc chain, drawn as cubics.
    // This is the whole point of the representation: what you watch appear is
    // the curve that gets resolved, so pen-up changes nothing you can see. The
    // straight-line tool keeps a plain two-anchor path — it REPLACES its second
    // point on every move, which an incremental chain cannot express, and a
    // biarc through two points is that straight line anyway.
    addLive(o, straight) {
        const og = this._origin();
        const arcs = !straight;
        const live = arcs
            ? new Two.Path([], false, false, true)
            : new Two.Path([new Two.Anchor(o.pts[0][0] - og.x, o.pts[0][1] - og.y)], false, false);
        live.noFill(); live.stroke = o.color; live.linewidth = o.lwFrame; live.cap = "round"; live.join = "round"; live.opacity = o.opacity == null ? 1 : o.opacity;
        (this._activeRoot || this.world).add(live);
        this._live = live; this._liveModel = o; this._liveArcs = arcs;
        this._liveStable = 0; this._liveGap = 0;
        return live;
    }
    /**
     * Re-lay the live chain from the pen's gaps.
     *
     * A new sample only disturbs the last two gaps — the cardinal spline's
     * handles reach one neighbour either side — so everything before them is
     * final and stays put. The tail is spliced off and re-appended, which is a
     * handful of anchors per sample however long the stroke gets. Rebuilding the
     * whole path instead would allocate an anchor per arc per sample and turn a
     * long stroke quadratic.
     */
    setLiveArcs(gaps) {
        const path = this._live;
        if (!path || !this._liveArcs) return;
        const og = this._origin();
        const v = path.vertices;
        if (v.length > this._liveStable) v.splice(this._liveStable, v.length - this._liveStable);
        const n = gaps.length;
        if (!n) {
            // A dot: a zero-length subpath, which a round cap paints as the disc
            // the pen would leave. Without the second anchor SVG draws nothing
            // at all and the first tap of a stroke is invisible.
            const m = this._liveModel;
            if (m && m.pts.length) {
                const p = m.pts[0];
                v.push(new Two.Anchor(p[0] - og.x, p[1] - og.y, 0, 0, 0, 0, Two.Commands.move));
                v.push(new Two.Anchor(p[0] - og.x, p[1] - og.y, 0, 0, 0, 0, Two.Commands.line));
            }
            return;
        }
        const finalTo = Math.max(0, n - 2);   // gaps below this can never change again
        let stable = this._liveStable;
        for (let g = this._liveGap; g < n; g++) {
            pushGapAnchors(v, gaps[g], og);
            if (g + 1 <= finalTo) stable = v.length;
        }
        this._liveStable = stable;
        this._liveGap = finalTo;
    }
    extendLive(p) { if (this._live && !this._liveArcs) { const og = this._origin(); this._live.vertices.push(new Two.Anchor(p[0] - og.x, p[1] - og.y)); } }
    setLiveEnd(p) { if (this._live) { const v = this._live.vertices[1]; if (v) { const og = this._origin(); v.x = p[0] - og.x; v.y = p[1] - og.y; } } }
    endLive() { if (this._live && this._live.parent) this._live.parent.remove(this._live); this._live = null; this._liveModel = null; this._liveArcs = false; }

    // Selection highlight: fn returns { level, rect } (the selected object's
    // lw-padded bbox in ITS OWN level's frame) or null. Drawn in screen space —
    // corners walk the record chain like the tile-debug overlay — and refreshed
    // on every world sync, so it tracks pans/zooms and drag-moves for free.
    setSelection(fn) { this._selRectFn = fn; this._renderSelection(); }
    // The in-progress selection lasso, in SCREEN coordinates (it is a gesture,
    // not geometry — it never becomes part of the drawing).
    setLasso(fn) { this._lassoFn = fn; }
    /**
     * Redraw the selection layer alone.
     *
     * The lasso lives in `_renderSelection`, which only ever ran from
     * `syncWorld`. A lasso drag calls `renderer.update()` — Two.js repaints,
     * but the lasso path is never rebuilt, so the loop you were drawing was
     * invisible from the first version of this code.
     */
    refreshSelection() { this._renderSelection(); this.update(); }
    /**
     * Is this projected selection box worth drawing?
     *
     * WHY THIS EXISTS. The selection rectangle is the object's bbox in the
     * ACTIVE FRAME's coordinates, so a coarse object seen from a deep frame
     * projects to something astronomical. Measured live 2026-08-22: 877,395 x
     * 877,395 px, a 3.5 M px perimeter, which at `dashes = [6, 4]` is 350,958
     * dashes for the rasterizer to place EVERY FRAME — every one of them off
     * screen. That was the whole "random 300-1000 ms stalls after erase, move,
     * then zoom" investigation. It hid for so long because dashing is raster
     * work: the function itself costs 0.15 ms of JavaScript, so no timer in
     * this engine, no long-animation-frame attribution and no trace could ever
     * name it. Isolated A/B, same frame: huge + dashed 315.3 ms, huge without
     * dashes 17.0 ms, clamped + dashed 16.6 ms.
     *
     * THE RULE (placeholder, Kobin 2026-08-22). Two clauses, each of which
     * means "there is nothing to look at":
     *   - the box must overlap the viewport (otherwise it is simply elsewhere);
     *   - it must be at most SEL_MAX_VIEWPORTS across (otherwise it engulfs the
     *     view and all four of its edges are outside it).
     * Together they bound the drawn perimeter at 6*(w+h) — about 1.4 k dashes
     * on a 1504x812 view, against the 351 k that stalled the page.
     *
     * This is deliberately a placeholder: an off-screen selection just has no
     * outline, and nothing tries to pop one back in. The intended replacement
     * makes the OBJECT itself indicate selection, which does not depend on the
     * bbox being on screen at all.
     */
    selectionDrawable(c) {
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const p of c) {
            if (p[0] < l) l = p[0];
            if (p[0] > r) r = p[0];
            if (p[1] < t) t = p[1];
            if (p[1] > b) b = p[1];
        }
        const onScreen = r >= 0 && b >= 0 && l <= this.width && t <= this.height;
        const bounded = (r - l) <= SEL_MAX_VIEWPORTS * this.width
            && (b - t) <= SEL_MAX_VIEWPORTS * this.height;
        return onScreen && bounded;
    }
    _renderSelection() {
        this.selGroup.remove(this.selGroup.children);
        const loop = this._lassoFn && this._lassoFn();
        if (loop && loop.length > 1) {
            const lp = new Two.Path(loop.map(([x, y]) => new Two.Anchor(x, y)), true, false);
            // Terracotta, not the old off-palette indigo — the lasso is the
            // same gesture as the ants and reads as one indicator with them.
            lp.noFill(); lp.stroke = SEL_INK; lp.linewidth = 1.5; lp.opacity = 0.9;
            if (lp.dashes) { lp.dashes.length = 0; lp.dashes.push(4, 4); }
            this.selGroup.add(lp);
        }
        // THE BOUNDING BOX IS GONE. It was the selection indicator until
        // 2026-08-22, when it turned out to be the cause of the deep-zoom
        // stalls: computed in the active frame's coordinates, it projected to
        // 877,395 px and its dashed perimeter cost 315 ms a frame. It is
        // replaced by `_renderSelOverlay` — ants on the object's own edge —
        // which is bounded by the viewport by construction and says more
        // besides. `_selRectFn` is SET and never read: `setSelection` survives so
        // selection.indicator.test.js can prove that handing over an 877,395 px
        // rect draws nothing at all, which is the regression worth pinning.
    }

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
     * crawls without touching the main thread's JavaScript.
     *
     * WHY IT IS ITS OWN <svg>, NOT A GROUP IN THE DRAWING'S. Measured in
     * Kobin's Chrome on 2026-09-03 with 5,343 objects drawn and 13,600 px of
     * ants: with the ants in the drawing's <svg>, every frame of the crawl was
     * 50 ms; with the drawing hidden and the same ants crawling, 16.7 ms. The
     * ants cost nothing measurable — what cost was that a paint invalidation
     * in a layer re-rasterises everything in that layer's tiles, drawing
     * included. A separate <svg> with `will-change: transform` is its own
     * compositing layer, so the crawl re-rasterises the ants and only the ants.
     *
     * WHAT IT RECEIVES (see `_selectionAnts`): runs and marks as path data in
     * a RETAINED space under one transform, changed rarely (`key`); the
     * transform, changed every step; and the screen-edge runs, per step. The
     * paths carry `vector-effect: non-scaling-stroke`, so the band and the
     * dashes stay in screen pixels whatever the transform — measured on the
     * same day: a 20 px dash period under `scale(2)` is still 20 px.
     *
     * WHAT IS DRAWN:
     *   ANTS along the ink's true boundary, tile cuts skipped.
     *   SCREEN-EDGE ANTS where the ink continues past the side of the view,
     *     set in from the edge so the whole band shows.
     *   AN ARROW on each of those sides, breathing faintly, pointing the way
     *     the object carries on.
     */
    _renderSelOverlay() {
        const svg = this.two.renderer && this.two.renderer.domElement;
        if (!svg || typeof document === "undefined") return;
        const data = this._selAntsFn && this._selAntsFn();
        const runs = (data && data.runs) || [], marks = (data && data.marks) || [], edges = (data && data.edges) || [];
        if (!data || !(runs.length || marks.length || edges.length)) { this._dropSelOverlay(); return; }

        Renderer._ensureSelStyle();
        const els = this._selEls || this._buildSelOverlay(svg);
        if (els.w !== this.width || els.h !== this.height) {
            for (const l of [els.layer, els.edgeLayer]) {
                l.setAttribute("width", String(this.width));
                l.setAttribute("height", String(this.height));
            }
            els.w = this.width; els.h = this.height;
        }
        const W = this.width, H = this.height;
        const kt = selAntScale(data.inkPx);
        // THE STEP IS A CSS TRANSFORM ON THE LAYER, applied by the compositor
        // with no repaint. As an SVG transform on a group inside the layer it
        // repainted every ant on every step of a pinch — measured at 35 to 50
        // ms a frame on top of the drawing's own 50 to 66 — because a
        // non-scaling stroke has to be re-stroked whenever its transform
        // changes. On the layer, a pinch costs the overlay nothing until the
        // next decision.
        const t = data.transform || { k: 1, tx: 0, ty: 0 };
        els.layer.style.transform = "matrix(" + t.k + ", 0, 0, " + t.k + ", " + t.tx + ", " + t.ty + ")";
        // THE CRAWL FREEZES WHILE THE CAMERA MOVES. This runs on every camera
        // step; a crawl repaint landing on a pinch frame added 17 ms to it
        // (measured: pinch with the crawl 83 ms a frame, paused 67, the
        // drawing alone 50), for motion nobody can see under a pinch. The
        // ants hold their phase and pick up SEL_CRAWL_RESUME_MS after the
        // last step.
        if (typeof setTimeout === "function") {
            if (!els.frozen) { els.layer.classList.add("bl-sel-still"); els.edgeLayer.classList.add("bl-sel-still"); els.frozen = true; }
            if (els.resume) clearTimeout(els.resume);
            els.resume = setTimeout(() => {
                els.resume = null;
                if (this._selEls !== els) return;
                els.layer.classList.remove("bl-sel-still"); els.edgeLayer.classList.remove("bl-sel-still");
                els.frozen = false;
            }, SEL_CRAWL_RESUME_MS);
        }

        // ---- the retained ants: rebuilt only when the decision changed ----
        if (data.key !== els.key || kt !== els.kt) {
            els.key = data.key; els.kt = kt;
            // ONE PATH PER RUN, because each run needs its own dash length. A
            // single shared pattern leaves a RUNT DASH wherever a loop closes:
            // the perimeter is never an exact multiple of the cycle, so the last
            // dash before the join is whatever is left over, and you see one
            // short ant. Fitting a whole number of cycles to each run removes
            // it. The runs SHORTER than a cycle are never fitted (see `_fitDash`)
            // and all carry the same pattern, so they share one path — on a
            // dense selection they are most of the runs.
            const cycle = (SEL_ANT_ON + SEL_ANT_OFF) * kt;
            const fitted = [], short = [];
            for (const run of runs) (run.len < cycle ? short : fitted).push(run);
            // ...in batches of at most SEL_BATCH_RUNS. Batching does not make
            // the paint cheaper (measured: 566 short runs in one path and one
            // path each came to the same frame), but ONE path holding every run
            // was 183 ms a frame against 33 for the same ink in 234 paths —
            // the dasher has a cliff somewhere above a few hundred contours,
            // and the batch stays well under it.
            const batches = [];
            for (let i = 0; i < short.length; i += SEL_BATCH_RUNS) batches.push(short.slice(i, i + SEL_BATCH_RUNS));
            Renderer._poolTo(els.world, els.antPool, fitted.length + batches.length, els.markAnchor, () => Renderer._antPath(SEL_ANT_W));
            for (let i = 0; i < fitted.length; i++) {
                const q = els.antPool[i];
                q.setAttribute("d", fitted[i].d);
                q.setAttribute("stroke-width", (SEL_ANT_W * kt).toFixed(2));
                Renderer._fitDash(q, fitted[i].len, SEL_ANT_ON * kt, SEL_ANT_OFF * kt);
            }
            for (let b = 0; b < batches.length; b++) {
                const q = els.antPool[fitted.length + b];
                let d = "";
                for (const run of batches[b]) d += run.d + " ";
                q.setAttribute("d", d.trim());
                q.setAttribute("stroke-width", (SEL_ANT_W * kt).toFixed(2));
                Renderer._fitDash(q, 1, SEL_ANT_ON * kt, SEL_ANT_OFF * kt);   // under a cycle: the sliding pattern
            }
            // ---- the dots ----
            // One path for all of them: they share every attribute and the dash
            // pattern restarts at each subpath. NOT fitted: the whole point of a
            // speck is that its outline is shorter than a cycle, so the pattern
            // slides across it and the mark blinks.
            Renderer._poolTo(els.world, els.markPool, marks.length ? 1 : 0, null, () => Renderer._antPath(SEL_FINE_W));
            if (marks.length) {
                const q = els.markPool[0];
                let d = "";
                for (const m of marks) d += m.d + " ";
                q.setAttribute("d", d.trim());
                q.setAttribute("stroke-dasharray", SEL_FINE_ON + " " + SEL_FINE_OFF);
                q.style.setProperty("--ao", (-(SEL_FINE_ON + SEL_FINE_OFF) * 2).toFixed(2) + "px");
            }
        }

        // ---- the frame edge, where the selection carries on past it ----
        // Screen space, every step. The ants sit so their OUTER side touches
        // the window edge — inset by half the band — rather than centred on
        // it, which would hang half the band off the screen.
        const inset = (SEL_ANT_W * kt) / 2;
        const edgeRuns = edges.map((e) => {
            if (e.side === "left") return [[inset, e.from], [inset, e.to]];
            if (e.side === "right") return [[W - inset, e.from], [W - inset, e.to]];
            if (e.side === "top") return [[e.from, inset], [e.to, inset]];
            return [[e.from, H - inset], [e.to, H - inset]];
        });
        Renderer._poolTo(els.screen, els.edgePool, edgeRuns.length, null, () => Renderer._antPath(SEL_ANT_W, false));
        for (let i = 0; i < edgeRuns.length; i++) {
            const run = edgeRuns[i], q = els.edgePool[i];
            q.setAttribute("d", Renderer._d(run, false));
            q.setAttribute("stroke-width", (SEL_ANT_W * kt).toFixed(2));
            Renderer._fitDash(q, Renderer._len(run), SEL_ANT_ON * kt, SEL_ANT_OFF * kt);
        }
        const DIR = { left: 180, right: 0, top: -90, bottom: 90 };
        const withChevron = edges.filter((e) => e.chevron);
        Renderer._poolTo(els.screen, els.arrowPool, withChevron.length, null, () => {
            const q = document.createElementNS(SVG_NS, "path");
            const half = SEL_ARROW_SPAN / 2, d = SEL_ARROW_DEPTH / 2;
            // Drawn pointing along +x and rotated into place.
            q.setAttribute("d", "M" + (-d) + "," + (-half)
                + " L" + d + ",0 L" + (-d) + "," + half);
            q.setAttribute("fill", "none");
            q.setAttribute("stroke", SEL_INK);
            q.setAttribute("stroke-width", "2.2");
            q.setAttribute("stroke-linecap", "round");
            q.setAttribute("stroke-linejoin", "round");
            q.setAttribute("class", "bl-sel-arrow");
            return q;
        });
        for (let i = 0; i < withChevron.length; i++) {
            const e = withChevron[i];
            const mid = (e.from + e.to) / 2;
            const x = e.side === "left" ? inset + SEL_ARROW_GAP
                : e.side === "right" ? W - inset - SEL_ARROW_GAP
                    : mid;
            const y = e.side === "top" ? inset + SEL_ARROW_GAP
                : e.side === "bottom" ? H - inset - SEL_ARROW_GAP
                    : mid;
            els.arrowPool[i].setAttribute("transform",
                "translate(" + x.toFixed(2) + "," + y.toFixed(2) + ") rotate(" + DIR[e.side] + ")");
        }

        // Last in the host, so they paint over the drawing.
        const host = els.layer.parentNode;
        if (host && host.lastChild !== els.edgeLayer) { host.appendChild(els.layer); host.appendChild(els.edgeLayer); }
    }

    /** One ant path: no fill, the terracotta, butt caps, and screen-pixel strokes under any transform. */
    static _antPath(width, nonScaling = true) {
        const q = document.createElementNS(SVG_NS, "path");
        q.setAttribute("fill", "none");
        q.setAttribute("stroke", SEL_INK);
        q.setAttribute("stroke-width", String(width));
        q.setAttribute("stroke-linecap", "butt");
        q.setAttribute("class", "bl-sel-ants");
        if (nonScaling) q.setAttribute("vector-effect", "non-scaling-stroke");
        return q;
    }

    /**
     * The overlay's elements, built ONCE and thereafter only updated.
     *
     * This is not an optimisation, it is the difference between the indicator
     * animating and not: a CSS animation restarts whenever its element is
     * replaced, so rebuilding these nodes on each `syncWorld` — which runs every
     * frame of a pan or zoom — left the ants frozen for exactly as long as the
     * camera was moving.
     *
     * The layer is a second <svg> beside the drawing's, positioned over it and
     * promoted to its own compositing layer (see `_renderSelOverlay` for the
     * measurement that decided this).
     */
    _buildSelOverlay(svg) {
        const host = svg.parentNode || document.body;
        const mk = (cls) => {
            const l = document.createElementNS(SVG_NS, "svg");
            l.setAttribute("class", cls);
            l.setAttribute("aria-hidden", "true");
            l.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;overflow:visible;will-change:transform;transform-origin:0 0;";
            // Sit exactly over the drawing's own <svg>, wherever the host put it.
            try {
                const a = svg.getBoundingClientRect(), b = host.getBoundingClientRect();
                if (a.left - b.left || a.top - b.top) { l.style.left = (a.left - b.left) + "px"; l.style.top = (a.top - b.top) + "px"; }
            } catch (e) { /* no layout here */ }
            return l;
        };
        // Two layers: the retained ants, moved by a CSS transform and repainted
        // only when the decision changes or the crawl steps; and the screen-edge
        // runs, which change every step and are a handful of paths. In one
        // layer the edge runs would have repainted every ant on every step.
        const layer = mk("bl-sel-layer");
        const world = document.createElementNS(SVG_NS, "g");
        world.setAttribute("class", "bl-sel-world");
        // An anchor the ant paths are inserted before, so the dots always paint
        // over the ants and the pools never fight over order.
        const markAnchor = document.createElementNS(SVG_NS, "g");
        world.appendChild(markAnchor);
        layer.appendChild(world);
        const edgeLayer = mk("bl-sel-edges");
        const screen = document.createElementNS(SVG_NS, "g");
        edgeLayer.appendChild(screen);
        host.appendChild(layer);
        host.appendChild(edgeLayer);
        this._selOv = [layer, edgeLayer];
        this._selEls = { layer, edgeLayer, world, markAnchor, screen, key: null, kt: null, w: 0, h: 0,
            antPool: [], markPool: [], edgePool: [], arrowPool: [] };
        return this._selEls;
    }

    _dropSelOverlay() {
        if (this._selEls && this._selEls.resume) clearTimeout(this._selEls.resume);
        for (const g of this._selOv || []) if (g && g.parentNode) g.parentNode.removeChild(g);
        this._selOv = null;
        this._selEls = null;
    }

    /** `M x y L x y ...` for one polyline, optionally closed. */
    static _d(pts, close) {
        let d = "";
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const x = (p[0] != null ? p[0] : p.x), y = (p[1] != null ? p[1] : p.y);
            d += (i ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2) + " ";
        }
        return close ? d + "Z" : d.trim();
    }

    /** Several polylines in one `d`, each its own subpath. */
    static _dAll(runs) {
        let d = "";
        for (const run of runs) d += Renderer._d(run, false) + " ";
        return d.trim();
    }

    /** Total length of a polyline, in screen pixels. */
    static _len(pts) {
        let d = 0;
        for (let i = 1; i < pts.length; i++) {
            d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        }
        return d;
    }

    /**
     * Fit a whole number of dash cycles onto a run of length `len`.
     *
     * Two problems solved at once. A run that is not a multiple of the cycle
     * ends in a RUNT — one short ant where the loop closes. And a run SHORTER
     * than a cycle would have a whole cycle crushed onto it, which is where the
     * stub dots on tight inside curves come from; those are drawn solid
     * instead, because a mark too small to carry a pattern should look like a
     * mark rather than like dirt.
     */
    static _fitDash(el, len, on, off) {
        const cyc = on + off;
        if (!(len > 0)) {
            el.removeAttribute("stroke-dasharray");
            el.style.removeProperty("--ao");
            return;
        }
        if (len < cyc) {
            // SHORTER THAN ONE CYCLE — carry the pattern at full size and let it
            // slide across, exactly as a speck does. Fitting here would crush a
            // whole cycle onto a few pixels and give the stub dots that show up
            // on tight inside curves; drawing it solid, which is what this did
            // before, is worse still — it stops the ants moving at all, and a
            // zoomed-out selection went completely static.
            el.setAttribute("stroke-dasharray", on.toFixed(3) + " " + off.toFixed(3));
            el.style.setProperty("--ao", (-cyc * 2).toFixed(3) + "px");
            return;
        }
        const n = Math.max(1, Math.round(len / cyc));
        const k = len / (n * cyc);
        // Three decimals, not two: the whole point is that the cycles divide the
        // run exactly, and rounding the dash to 1/100 px puts a visible fraction
        // of a cycle back over a long perimeter.
        el.setAttribute("stroke-dasharray", (on * k).toFixed(3) + " " + (off * k).toFixed(3));
        el.style.setProperty("--ao", (-(cyc * k) * 2).toFixed(3) + "px");
    }

    /** Grow or shrink a pool of elements to `n`, keeping the survivors alive. */
    static _poolTo(parent, pool, n, before, make) {
        while (pool.length < n) {
            const el = make();
            if (before) parent.insertBefore(el, before); else parent.appendChild(el);
            pool.push(el);
        }
        while (pool.length > n) {
            const el = pool.pop();
            if (el.parentNode) el.parentNode.removeChild(el);
        }
    }

    /**
     * The keyframes, injected once per document.
     *
     * Timings come straight from the design file: the pale pass peaks at 30%
     * and the dark one at 80% of a 3 s breath, so the two never coincide and
     * whichever contrasts with the paint gets its turn. `prefers-reduced-motion`
     * holds both at a steady value rather than stopping the indicator outright,
     * because it is the only thing marking the selection.
     */
    static _ensureSelStyle() {
        if (typeof document === "undefined") return;
        const css = Renderer._selCss();
        let st = document.getElementById("bl-sel-style");
        if (st) {
            // REPLACE IT IF IT HAS CHANGED. Bailing out on "the element exists"
            // meant the stylesheet was whatever the first render of the session
            // installed: across a hot reload the geometry updated (it is written
            // as attributes) while every animation stayed on the old rules, so
            // changes to timing or opacity silently did nothing and the overlay
            // looked untouched.
            if (st.textContent !== css) st.textContent = css;
            return;
        }
        st = document.createElement("style");
        st.id = "bl-sel-style";
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    static _selCss() {
        return [
            // The shift is per element: the dash cycle scales with the ink, and
            // an offset that is not a whole number of cycles makes the ants jump
            // every time the animation loops.
            "@keyframes bl-sel-ants{to{stroke-dashoffset:var(--ao,-18px)}}",
            // Very faint, and slow: the arrow should read as live without
            // pulling attention off the ants.
            "@keyframes bl-sel-faint{0%,100%{opacity:.5}50%{opacity:.8}}",
            // THE CRAWL IS STEPPED, 20 times a second, not continuous. Every
            // step of the offset repaints every ant on screen, and that paint
            // is the crawl's whole cost: measured in Kobin's Chrome on
            // 2026-09-03 with the 24,000 px budget full, a continuous crawl
            // held every frame at 33 ms (two vsyncs), and neither one shared
            // animation nor 799 separate paths nor one path per eight runs
            // changed it — the raster of the dashed length is the cost. At
            // sixteen steps a cycle the repaint lands on one frame in three and
            // the median frame is back at 16.7 ms, with the pinch's own work
            // fitting in the frames between. Each step moves the pattern
            // 1.6 px, which is how marching ants have always marched. One
            // number to put back if the stepping reads wrong: `linear`.
            ".bl-sel-ants{animation:bl-sel-ants .8s steps(16,end) infinite}",
            // Held while the camera moves (see _renderSelOverlay).
            ".bl-sel-still .bl-sel-ants{animation-play-state:paused}",
            ".bl-sel-arrow{animation:bl-sel-faint 2.4s ease-in-out infinite}",
            "@media (prefers-reduced-motion:reduce){",
            ".bl-sel-ants{animation:none}",
            ".bl-sel-arrow{animation:none;opacity:.65}}",
        ].join("");
    }

    setOpacityGroups(v) { this.opacityGroups = v; }
    setOutlineMode(v) { this.outlineMode = v; }
    setLazyOutlines(v) { this.lazyOutlines = !!v; }
    // Toggle per-level scene retention. Switching modes changes what a scene key
    // means, so wipe the cache and let the next render rebuild once.
    setRetainScenes(v) { v = !!v; if (v === this.retainScenes) return; this.retainScenes = v; this.clear(); }
    setDebug(v) { this.debug = v; }
    setTileDebug(v, fn) { this.tileDebug = v; this._tileRectsFn = fn || this._tileRectsFn; if (!v) this.tileDebugGroup.remove(this.tileDebugGroup.children); }
    setEraseDebug(v, fn, roleFn) {
        this.eraseDebug = !!v;
        this._eraseOverlayFn = fn || this._eraseOverlayFn;
        this._pieceRoleFn = roleFn || this._pieceRoleFn;
        if (!v) this.eraseDebugGroup.remove(this.eraseDebugGroup.children);
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

    /**
     * The erase-debug overlay: outlines in screen space, over the ink.
     *
     * ORANGE is a real shape's own boundary; GREEN is the stretch where it is
     * in CONTACT with a parent or child across their shared tile edge — which is
     * precisely the relation severance is decided on, so green is "these two are
     * one object". YELLOW is an eraser mark, including one already consumed.
     * Drawn last and on top, because the whole point is to see it against ink
     * that has been dimmed to make room for it.
     */
    _renderEraseDebug() {
        if (!this.eraseDebug || !this._eraseOverlayFn) return;
        this.eraseDebugGroup.remove(this.eraseDebugGroup.children);
        const model = this._eraseOverlayFn();
        if (!model) return;
        const add = (pts, { stroke, fill, width, opacity, closed }) => {
            if (!pts || pts.length < 2) return;
            // Anchors go in a chunk at a time. Two.js's Collection takes an
            // array by `push.apply`, and apply spreads it onto the CALL STACK —
            // a boundary that arrives with a hundred thousand points then
            // throws "Maximum call stack size exceeded" from inside the path
            // constructor rather than drawing anything at all.
            const path = new Two.Path([], !!closed, false);
            for (let i = 0; i < pts.length; i += 2048) {
                const chunk = [];
                for (let k = i; k < Math.min(i + 2048, pts.length); k++) chunk.push(new Two.Anchor(pts[k][0], pts[k][1]));
                path.vertices.push.apply(path.vertices, chunk);
            }
            if (fill) { path.fill = fill; } else { path.noFill(); }
            if (stroke) { path.stroke = stroke; path.linewidth = width; } else { path.noStroke(); }
            path.opacity = opacity;
            this.eraseDebugGroup.add(path);
        };
        for (const m of model.marks || []) add(m.pts, { fill: "#ffd400", opacity: 0.2, closed: true });
        // One pixel each, always: these are meant to show you where a boundary
        // is, not to cover what is beside it. Neither list overlaps the other —
        // the engine splits each boundary into runs and hands every stretch to
        // exactly one of them — so nothing here is drawn twice.
        for (const o of model.outlines || []) add(o.pts, { stroke: "#ff8c00", width: 1, opacity: 0.95 });
        for (const c of model.contacts || []) add(c.pts, { stroke: "#00c000", width: 1, opacity: 1 });
    }

    _renderTileDebug() {
        if (!this.tileDebug || !this._tileRectsFn) return;
        this.tileDebugGroup.remove(this.tileDebugGroup.children);
        for (const { level, rect } of this._tileRectsFn()) {
            const c = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
                .map(([x, y]) => this.cam.levelPointToScreen(level, x, y));
            if (c.some((p) => !p)) continue;
            const path = new Two.Path(c.map(([x, y]) => new Two.Anchor(x, y)), true, false);
            path.noFill(); path.stroke = "red"; path.linewidth = 1.5; path.opacity = 0.9;
            this.tileDebugGroup.add(path);
        }
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
