/**
 * derive.js — pure one-step bake math for the universal-tile engine.
 *
 * A "step" maps geometry between NEIGHBOURING levels through a crossing record
 * {s, t}: child = (parent*s + t)/base (magnify, ×~3000), parent = (child*base - t)/s
 * (minify). Everything here is a pure function of its inputs — no Two.js, no
 * camera, no cache ownership (callers pass `live` to exempt the in-progress
 * stroke from the object-attached caches).
 *
 * deriveStep() began as an exact port of KobinEngineV0._deriveInto and derive.test.js
 * still golden-compares the STROKE and FILL branches against it (through
 * LEGACY_SEAMS). It has since grown the two things V0 never had and which now carry
 * most real documents: a `shape` branch that keeps exact arcs across the crossing
 * (F-A), and the object's own tile grid with the chop and the freeze on it
 * (freeze.js, frame-lattice bible D2/D4). Do not read "exact port" as "unchanged".
 *
 * classifyUp() is the NEW symmetric size policy for magnification (the mirror
 * of the minify cull): each object is EMPTY (band can't reach the tile), SOLID
 * (one anchor disc covers the whole tile → a tile quad stands in for the whole
 * band, so geometry can never outgrow a tile and chains are bounded by
 * construction), or EDGE (the band edge crosses the tile → deriveStep does the
 * real work). Solid is an optimization tier; edge is the exactness backstop.
 *
 * projectNative() is the exact port of KobinEngineV0._projectNative: chain a
 * native's points/width through crossing records to another level's frame.
 * Minify (H > L) is precision-safe at any distance (coordinates shrink);
 * magnify (H < L) is only used step-by-step through tiles (coordinates grow —
 * composed long jumps cancel catastrophically, which is WHY the chain exists).
 */
import {
    strokeStripNear, clipRingsToRect, clipPolylineToRect, flattenCurve, flattenCurveNear,
    decimatePolyline,
} from "./polyline";
import { strokeOutline } from "./clipperBoolean";
import {
    loopsBBox, clipShapeToRect, flattenShape, transformLoops, transformLoopsAbout, insideShape,
    pieceBBox, loopsArea,
} from "./arcShape";
import { chopFreezeLoops, freezeRadius } from "./freeze";
import { childTilePhase, tilePhase, TileGrid } from "../frameLattice";

// Object bbox in its own frame. Cached on the object: geometry is immutable once
// the stroke is finished (only the live in-progress stroke still grows).
//
// Three bbox paths answer three questions, and this is the CACHED one — read
// it for anything that runs per render or per gesture. `arcShape.loopsBBox`
// is the exact bbox of arc loops, bulges included, and is what this one
// calls for a shape; `Document._bboxNow` is the same arithmetic UNCACHED, for
// the edit path that needs the box the object had before the edit invalidated
// this cache. None of them is wrong; only this one may be stale on the live
// stroke, which is why `live` is excluded from the cache.
export function bboxOf(o, live) {
    if (o._bbox) return o._bbox;
    let b;
    if (o.type === "shape") {
        // Exact, arc bulges included — a chord bbox would understate a half-turn
        // cap by the whole pen radius.
        b = loopsBBox(o.loops) || { x0: 0, y0: 0, x1: 0, y1: 0 };
    } else {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const scan = (pts) => { for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } };
        if (o.type === "fill") { for (const poly of o.polys) scan(poly); } else scan(o.pts);
        b = { x0, y0, x1, y1 };
    }
    if (o !== live) o._bbox = b;
    return b;
}

// ---- resolved shapes, into a tile ------------------------------------------
/**
 * How finely a resolved perimeter is flattened for a tile.
 *
 * Measured at the level's DEEPEST in-level zoom (`enter`), which is the worst
 * case the level ever shows — the same convention `displayChords` uses for an
 * object's own rendering. It is deliberately finer than the legacy `flatChords`
 * value, which is taken at `cfg.base`; that was tolerable for chords of a
 * centerline and is not for the painted edge itself.
 *
 * It depends on nothing but `cfg`, so every tile of every frame flattens a given
 * arc to the SAME vertices. That is what keeps two tiles' pieces agreeing along
 * the seam between them.
 */
export const shapeTol = (cfg) => (cfg.arcTolerancePx * 0.5) / cfg.enter;

/**
 * How far a frozen chord may sit from the curve it replaces (D2: "within a
 * quarter pixel over a tile").
 *
 * The same number as `shapeTol`, and deliberately: a freeze is a swap of source
 * of truth, and it must never be coarser than the flattening the renderer is
 * already doing at that level, or the swap would be visible at the moment it
 * happened. It depends on nothing but `cfg` — not the canvas, not the tile, not
 * the camera — which is D3's requirement: "the important thing about freezing
 * is that it happens at the same time every time you bake it."
 */
export const freezeTol = (cfg) => (cfg.arcTolerancePx * 0.5) / cfg.enter;
/** The freeze radius at the engine's tolerance (freeze.js rule 2) — the one gate the chop, the clip and every boolean use. */
export const freezeR = (cfg) => freezeRadius(freezeTol(cfg));

/** An object's tile-grid phase, or the frame-aligned default (bible 6.6). */
export const ZERO_PHASE = [0, 0];
export const tilePhaseOf = (o) => (o && o.tile ? o.tile : ZERO_PHASE);

/**
 * One shape's contribution to one tile, as polygon rings.
 *
 * The arcs are clipped to the tile FIRST and flattened afterwards, which is the
 * whole economy of the representation. Flatten-then-clip would tessellate the
 * entire perimeter at the child level's fidelity before throwing nearly all of
 * it away, and magnification makes that ruinous: a x3000 radius needs ~55x the
 * steps for the same sagitta, so a 2,000-piece perimeter becomes ~120,000
 * vertices per tile. Clipping is exact and closed-form, so nothing is lost by
 * doing it in the other order.
 *
 * Everything is computed LOCAL to the tile and translated back. Precision is
 * then set by the tile's own size rather than by how far the tile sits from the
 * frame origin, which at depth is the difference between a sharp edge and a
 * quantized one.
 */
export function shapeRingsInRect(loops, rect, tol, opts) {
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    const local = transformLoops(loops, 1, -cx, -cy);
    const lrect = { left: rect.left - cx, top: rect.top - cy, right: rect.right - cx, bottom: rect.bottom - cy };
    const quad = () => [[[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]];

    // Does any piece of the perimeter actually reach this tile? If none does,
    // the tile is wholly inside the ink or wholly outside it, and ONE winding
    // query settles which — no boolean at all. That is the `solid` tier, and it
    // is what keeps a magnified shape from doing real work in every tile it
    // floods. Deciding it exactly also means there is no anchor-disc heuristic
    // left to be conservative about.
    let touches = false;
    for (const loop of local) {
        for (const p of loop) {
            const b = pieceBBox(p);
            if (b[2] >= lrect.left && b[0] <= lrect.right && b[3] >= lrect.top && b[1] <= lrect.bottom) { touches = true; break; }
        }
        if (touches) break;
    }
    if (!touches) {
        if (!insideShape(local, [0, 0])) return { rings: [], covered: false };
        return { rings: quad(), covered: true };
    }
    // ...and the opposite fast path: a shape that lies WHOLLY inside the tile
    // has nothing to clip, so the boolean is pure cost. This is the common case
    // for anything shown from a finer level — a re-homed piece is thousands of
    // times smaller than the tile that holds it — and it is the difference
    // between a clip over every arc and a plain flatten. Measured on a
    // nine-member family during a drag: 5.5 ms per tile per member before,
    // 0.2 ms after, which is what turned a 7 fps drag back into a smooth one.
    const sb = loopsBBox(local);
    if (sb && sb.x0 >= lrect.left && sb.x1 <= lrect.right && sb.y0 >= lrect.top && sb.y1 <= lrect.bottom) {
        const whole = flattenShape(local, tol).map((ring) => ring.map(([x, y]) => [x + cx, y + cy]));
        return { rings: whole, covered: false };
    }
    const clipped = clipShapeToRect(local, lrect, opts).loops;
    if (!clipped.length) return { rings: [], covered: false };
    // The clip came back as the tile itself: the ink covers this tile and only
    // grazes its edge. Still a covering quad, and saying so keeps the magnify
    // chain bounded one level further down.
    const area = (lrect.right - lrect.left) * (lrect.bottom - lrect.top);
    if (clipped.length === 1 && Math.abs(loopsArea(clipped) - area) <= 1e-9 * area) {
        return { rings: quad(), covered: true };
    }
    const rings = flattenShape(clipped, tol).map((ring) => ring.map(([x, y]) => [x + cx, y + cy]));
    return { rings, covered: false };
}

/**
 * The same clip as `shapeRingsInRect`, but it hands back ARCS.
 *
 * THIS IS THE F-A FIX. A tile is built from its PARENT TILE, so whatever a tile
 * holds is what the next level down inherits. Flattening here looked harmless —
 * the polygon is within a quarter pixel of the curve when it is made — but a
 * chord is only a valid stand-in for the span it was fitted to, and the next
 * level magnifies ONE of those chords to fill the screen. Measured on the
 * pre-change build: a 42-arc stroke became a 793-point polygon at depth 1 and a
 * FIVE-point one at depth 2, and the rendered edge sat 263 px from where the
 * shape said it was. The flatten was not one approximation. It was about eight
 * hundred of them, every one made for a span the camera was about to zoom past.
 *
 * Clipping an exact arc against a rect gives an exact sub-arc — same circle,
 * endpoints on it, angles untouched — so carrying the arcs costs nothing and
 * the chain stays exact however deep it goes. Nothing is frozen to a line
 * anywhere along it; that happens once, at paint, against nothing that is
 * stored, so it can never be inherited.
 */
export function shapeLoopsInRect(loops, rect, opts) {
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    const local = transformLoops(loops, 1, -cx, -cy);
    const lrect = { left: rect.left - cx, top: rect.top - cy, right: rect.right - cx, bottom: rect.bottom - cy };
    const back = (ls) => transformLoops(ls, 1, cx, cy);
    const quad = () => [[[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]];

    let touches = false;
    for (const loop of local) {
        for (const p of loop) {
            const b = pieceBBox(p);
            if (b[2] >= lrect.left && b[0] <= lrect.right && b[3] >= lrect.top && b[1] <= lrect.bottom) { touches = true; break; }
        }
        if (touches) break;
    }
    if (!touches) {
        if (!insideShape(local, [0, 0])) return { loops: [], rings: [], covered: false };
        return { loops: [], rings: quad(), covered: true };
    }
    // Wholly inside the tile: nothing to clip, so hand the arcs straight back.
    const sb = loopsBBox(local);
    if (sb && sb.x0 >= lrect.left && sb.x1 <= lrect.right && sb.y0 >= lrect.top && sb.y1 <= lrect.bottom) {
        return { loops: back(local), rings: [], covered: false };
    }
    const clipped = clipShapeToRect(local, lrect, opts).loops;
    if (!clipped.length) return { loops: [], rings: [], covered: false };
    const area = (lrect.right - lrect.left) * (lrect.bottom - lrect.top);
    if (clipped.length === 1 && Math.abs(loopsArea(clipped) - area) <= 1e-9 * area) {
        return { loops: [], rings: quad(), covered: true };
    }
    // The overhang's own ends are not the object's — they are a duplicate of
    // what the neighbouring tile holds properly, cut short. Until 2026-09-07
    // they were marked here (`markSeamEnds`) so the level below would not
    // measure one for straightness; the radius gate's endpoint guard refuses
    // such a stub on its own (freeze.js, the note at the top), so nothing is
    // marked any more.
    return { loops: back(clipped), rings: [], covered: false };
}

// Chords of an object's displayed spline at in-level display fidelity
// (arcTolerancePx on screen at the deepest in-level zoom, `enter`). Cached on
// the object — reused by every fat-stroke/outline re-bake at any zoom in the level.
export function displayChords(o, cfg, live) {
    if (o._dispFlat) return o._dispFlat;
    const pts = flattenCurve(o.pts, (cfg.arcTolerancePx * 0.5) / cfg.enter);
    if (o !== live) o._dispFlat = pts;
    return pts;
}

// Flattened chords of a curved stroke, in the CHILD level's frame, cached per child
// level. The tolerance is view-independent (entry fidelity: arcTolerancePx on screen
// at inScale = base), so every tile of that level — whenever it happens to bake —
// cuts the SAME chord vertices at the shared grid lines and fill seams stay exact.
export function flatChords(o, level, tpts, cfg, live) {
    if (o._flat && o._flat.level === level) return o._flat.pts;
    const pts = flattenCurve(tpts, (cfg.arcTolerancePx * 0.5) / cfg.base);
    if (o !== live) o._flat = { level, pts };
    return pts;
}

// ---- seams ----
// Adjacent tiles' pieces of the SAME object are clipped slightly PAST the tile
// so they OVERLAP instead of abutting — abutting edges each half-cover the seam
// pixel and antialiasing leaves a hairline (composite two 50 %-covered opaque
// fills and a quarter of the background still shows through). Overlap is safe
// whenever the pieces composite as a union rather than stacking: always for
// OPAQUE ink, and for translucent ink once per-object opacity groups union it
// before opacity applies.
//
// HOW WIDE. The overlap has to be at least one device pixel where a tile is
// SMALLEST on screen. Within a level the camera lives in [exit, enter] — below
// `exit` it crosses down — so `exit` is that worst case and SEAM_PX/exit frame
// units is exactly SEAM_PX pixels there. Deeper in, the pad only grows, which
// costs nothing: adjacent pieces are clips of the SAME cut geometry, so a wider
// overlap can never refill a hole its neighbour cut.
//
// This used to be a FRACTION of the tile (5e-4), which made the overlap depend
// on the canvas the frame's grid happened to be captured at: on a 640 px canvas
// the tile is half as wide, the pad halved with it, and the overlap fell to
// 0.48 px — a visible hairline on exactly the small screens least able to hide
// it. Even at 1280 px it came to 0.96 px, under the one pixel it exists to
// cover. An absolute, cfg-derived pad is the same everywhere.
export const SEAM_PX = 1.5;
export function seamPadFor(cfg) { return SEAM_PX / (cfg && cfg.exit != null ? cfg.exit : 0.05); }
export function seamPad(o, cfg, opacityGroups) {
    const opaque = o.opacity == null || o.opacity >= 1;
    if (!opaque && !opacityGroups) return 0;
    return seamPadFor(cfg);
}
export function padRect(rect, p) {
    return p ? { left: rect.left - p, top: rect.top - p, right: rect.right + p, bottom: rect.bottom + p } : rect;
}

// The seam POLICY a bake runs under. Two knobs, because the defect this
// replaces was precisely that the engine had several:
//   pad(o, rect)  how far past its own tile a piece of `o` may reach;
//   centerlines   whether that pad also applies to the CENTERLINE clip rect
//                 and the bbox cull, or only to the ring clip.
// Production pads everything, so a stroke piece and a fill piece of the same
// object reach exactly as far as each other across the same seam.
export const SEAMS = {
    pad: (o, rect, cfg, opacityGroups) => seamPad(o, cfg, opacityGroups),
    centerlines: true,
};
// KobinEngineV0._deriveInto's rule, kept ONLY so derive.test.js can keep
// golden-comparing the extraction byte-for-byte. V0 padded the ring clip but
// clipped centerlines and culled against the bare tile, so its stroke pieces
// abut wherever lw < pad — the S-6 defect. Never use this in production.
const SEAM_FRAC = 5e-4;
export const LEGACY_SEAMS = {
    pad: (o, rect, cfg, opacityGroups) => (opacityGroups ? (rect.right - rect.left) * SEAM_FRAC : 0),
    centerlines: false,
};

// ---- ceding a tile to a re-homed child ----
// An erase made at a level DEEPER than an object's home cannot be baked into
// that object: Clipper's integer grid is fixed in the object's OWN units, so a
// hole thousands of times finer than the object's own scale rounds away (that
// was the blocky-erase failure). Instead the erase RE-HOMES — the surviving ink
// becomes natives of the level the erase was made at.
//
// What the parent does about it moved, 2026-08-06. It used to keep its geometry
// whole and record a "window" rect, which rendering then subtracted wherever the
// parent was magnified enough to resolve it. That is gone: the parent's rings
// are now physically CUT — `Document.cedeTileById`, one `subtractShape` on the
// resolved arc perimeter. (`geometry/cede.js` was the float-guillotine version of
// that cut and is TEST-ONLY now.) So there is nothing to subtract at
// render time and nothing to carry between crossings. The hole survives Clipper
// for the reason the erase itself does not — a TILE is ~12.8 parent units, one
// three-thousandth of the parent's own frame and perfectly representable, while
// the erase inside it is thousands of times finer still.
//
// Three things died with the windows, and each was a real defect: a per-view
// re-derive whose cache went stale on the fast zoom path; 232–386 ms renders
// rebuilding it; and `windowPad = 2/cfg.enter`, a pad sized in FRAME units,
// which came to 2 px at the level's entry zoom but 0.186 px at inScale 27.9 —
// too thin to cover the seam, so a hairline outline traced every erase.
//
// rect minus axis-aligned holes -> disjoint rects (guillotine, ≤4 per hole).
// Pure float, deliberately: a Clipper difference would quantize the hole back
// onto the integer grid, which is the whole thing re-homing exists to avoid.
export function rectSubtract(rect, holes) {
    let regions = [{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
    for (const h of holes) {
        const next = [];
        for (const r of regions) {
            if (h.x1 <= r.left || h.x0 >= r.right || h.y1 <= r.top || h.y0 >= r.bottom) { next.push(r); continue; }
            const cx0 = Math.max(r.left, h.x0), cx1 = Math.min(r.right, h.x1);
            const cy0 = Math.max(r.top, h.y0), cy1 = Math.min(r.bottom, h.y1);
            if (r.top < cy0) next.push({ left: r.left, top: r.top, right: r.right, bottom: cy0 });
            if (cy1 < r.bottom) next.push({ left: r.left, top: cy1, right: r.right, bottom: r.bottom });
            if (r.left < cx0) next.push({ left: r.left, top: cy0, right: cx0, bottom: cy1 });
            if (cx1 < r.right) next.push({ left: cx1, top: cy0, right: r.right, bottom: cy1 });
        }
        regions = next;
        if (!regions.length) break;
    }
    return regions;
}
// ---- the band polygonizer (shared by the bake and the eraser) ----
/**
 * A stroke's painted footprint as filled rings, exact inside `clipRect`.
 *
 * This is the one place that decides HOW a band gets polygonized, and it has to
 * be one place: the erase needs a target's footprint in exactly the geometry the
 * bake would paint there, or the hole and the ink disagree along their shared
 * edge. It used to exist twice — inline in deriveStep and again, re-derived from
 * scratch, inside the engine's re-homing erase — and the copies drifted.
 *
 * Two regimes, keyed the same way the bake has always keyed them:
 *
 *  - ORDINARY: Clipper's offset over the whole centerline, rings then clipped to
 *    the window. Round joins and caps, exactly what SVG paints.
 *  - MEGA: the centerline is astronomically long (a coarse stroke magnified
 *    3000^N) or the offset radius dwarfs the window. Clipper's offset explodes
 *    there — it tessellates the FULL arc of every cap at uniform tolerance and
 *    unions the band with itself, which goes quadratic in self-intersections
 *    (one 1,321-point stroke measured 583 s). Window the centerline and use the
 *    analytic strip, which is O(n) and exact inside the window.
 *
 * `opts`:
 *   curved      the source is a Two.js spline, so offset the SPLINE not the chords
 *   chords()    the caller's cached non-mega flattening (deriveStep caches per level)
 *   span        the centerline's extent in these coordinates, for the mega test
 *   window      where the centerline may be clipped (mega branch only)
 *   decimate      simplify the centerline to this tolerance first. The analytic
 *                 strip emits ONE RING PER SEGMENT, so a display-fidelity
 *                 centerline costs thousands of rings; a caller that only needs
 *                 the result at a known on-screen resolution should say so.
 *   legacyOffset  force the Clipper branch when not mega (V0 parity)
 *   origin      {x,y} to work relative to; defaults to clipRect's centre. Clipper is
 *               integer-based with a magnitude-capped scale, so everything is done
 *               local to the window and translated back — precision is then set by
 *               the window's size, not by how far it sits from the frame origin.
 */
export function bandRings(tpts, lw, rect, clipRect, cfg, opts = {}) {
    const base = cfg.base;
    const half = lw / 2;
    const tdiag = Math.hypot(rect.right - rect.left, rect.bottom - rect.top);
    const mega = (opts.span || 0) > 20 * tdiag || half > 4 * tdiag;
    const curved = !!opts.curved && tpts.length > 2;
    let cpts;
    if (curved && mega) {
        // Flatten only the annulus that can shape this window's band edge. The
        // flatten window MUST be clipRect, never the linewidth-grown one: for a
        // giant, half is ~1e26 and an ew-sized window collapses the annulus
        // prune, so the recursion runs away (measured: one level -6 stroke →
        // 6M+ nodes → OOM crash, commit 6863fe6).
        cpts = flattenCurveNear(tpts, (cfg.arcTolerancePx * 0.5) / base,
            clipRect, Math.max(0, half - tdiag), half + tdiag);
    } else if (curved) {
        cpts = opts.chords ? opts.chords() : flattenCurve(tpts, (cfg.arcTolerancePx * 0.5) / base);
    } else {
        cpts = tpts;
    }
    const og = opts.origin || { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    const cx = og.x, cy = og.y;
    const lrect = { left: clipRect.left - cx, top: clipRect.top - cy,
        right: clipRect.right - cx, bottom: clipRect.bottom - cy };
    const polys = [];
    const eq = (a, b2) => a && b2 && a[0] === b2[0] && a[1] === b2[1];
    if (!mega && opts.legacyOffset) {
        // Offset the WHOLE centerline and clip the resulting RINGS. Clipping the
        // CENTERLINE first truncates the band, dropping coverage of interior
        // points whose nearest centerline lies just outside the window — the
        // deep-zoom "inside a coarse stroke's edge" flood was lost that way.
        // displayScale = base: arc steps follow the on-screen cap radius at
        // ENTRY, view-independently, so the tessellation is seam-deterministic.
        const op = clipRingsToRect(
            strokeOutline(cpts.map(([x, y]) => [x - cx, y - cy]), lw,
                { arcTolerancePx: cfg.arcTolerancePx, curved: false,
                    displayScale: base, scale: cfg.scale }),
            lrect);
        for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
        return polys;
    }
    const win = opts.window || padRect(clipRect, half);
    // One ring per segment means the centerline's point count IS the ring count.
    // A caller rendering at a known resolution can drop the points that
    // resolution cannot show; a tile bake, which must stay view-independent,
    // passes nothing and keeps every one.
    if (opts.decimate) cpts = decimatePolyline(cpts, opts.decimate);
    for (const run of clipPolylineToRect(cpts, win)) {
        if (!run.length) continue;
        let op = strokeStripNear(run.map(([x, y]) => [x - cx, y - cy]), lw, lrect,
            { startCap: eq(run[0], cpts[0]), endCap: eq(run[run.length - 1], cpts[cpts.length - 1]) });
        op = clipRingsToRect(op, lrect);
        for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
    }
    return polys;
}

// ---- symmetric size policy: the magnify mirror of the minify cull ----
// Classify one parent object against one child tile. `s, t` map parent→child.
//
// Every question here is asked over the PADDED tile, because that is the rect
// the tier is about to paint: a solid quad is emitted padded, so ink sitting
// just outside the tile but inside the pad would otherwise be invisible to the
// classifier. Padding is used at its maximum (ignoring opacity) — classifying
// something as "edge" that could have been "solid" only costs a little work,
// while the reverse paints over detail, so the conservative direction is safe.
export function classifyUp(o, s, t, rect, cfg, live, off) {
    const base = cfg.base;
    const f = s / base;
    const b = bboxOf(o, live);
    const half = o.type === "fill" ? 0 : (o.lwFrame * f) / 2;
    const pad = seamPadFor(cfg);
    const prect = padRect(rect, pad);
    // `off`: the object's offset at this hop (F41), in the child's units.
    const ox = off ? off[0] : 0, oy = off ? off[1] : 0;
    const bx0 = (b.x0 * s + t.x) / base + ox, bx1 = (b.x1 * s + t.x) / base + ox;
    const by0 = (b.y0 * s + t.y) / base + oy, by1 = (b.y1 * s + t.y) / base + oy;
    // EMPTY: the band cannot reach the tile — nor its overlap into the neighbour.
    if (bx1 + half < prect.left || bx0 - half > prect.right || by1 + half < prect.top || by0 - half > prect.bottom) return "empty";
    // A resolved shape is always EDGE: `shapeRingsInRect` decides covered vs cut
    // exactly, with a winding query, so there is nothing for a heuristic tier to
    // add. (The anchor-disc SOLID test below exists to bound the magnify chain
    // for raw strokes; a shape's contribution is already bounded by the tile.)
    if (o.type === "shape") return "edge";
    if (o.type === "fill") {
        // A covering fill that still covers the whole child tile stays SOLID.
        if (o.covers && bx0 <= prect.left && bx1 >= prect.right && by0 <= prect.top && by1 >= prect.bottom) return "solid";
        return "edge";
    }
    // SOLID: one anchor disc covers the whole tile (a raw anchor lies ON the
    // displayed spline, so this needs no flatten — same test as the engine's
    // fat-fill covered check, but against the tile instead of the view window).
    const cx = (prect.left + prect.right) / 2, cy = (prect.top + prect.bottom) / 2;
    const hw = (prect.right - prect.left) / 2, hh = (prect.bottom - prect.top) / 2;
    for (const p of o.pts) {
        const px = (p[0] * s + t.x) / base + ox, py = (p[1] * s + t.y) / base + oy;
        if (Math.hypot(Math.abs(px - cx) + hw, Math.abs(py - cy) + hh) < half) return "solid";
    }
    return "edge";
}

// The tile-covering quad a SOLID object stands in for. 4 vertices forever —
// this is what bounds the magnify chain. `opts.pad` overlaps the quad into its
// neighbours (seam hairline).
export function solidQuad(o, rect, opts = {}) {
    const r = padRect(rect, opts.pad || 0);
    // `clip`: the rectangle this piece stands for, like every other piece. The
    // erase's descent reads it as the window a tile cedes (F42), and the
    // selection indicator as the cut every side of the quad is.
    const q = { type: "fill", origin: "inherited", covers: true, id: o.id, z: o.z, color: o.color,
        opacity: o.opacity, polys: [[[r.left, r.top], [r.right, r.top],
            [r.right, r.bottom], [r.left, r.bottom]]], paths: [], clip: r };
    if (o.editId != null) q.editId = o.editId;
    return q;
}

// ---- exact port of KobinEngineV0._deriveInto (the "edge" tier) ----
// Transform parent objects into this level's frame ((p*s+t)/base) and clip to `rect`,
// applying the size gate (large strokes -> filled outline, small -> clipped stroke).
// opts: { cfg, width, opacityGroups, live, parentCurved, childCurved } — the
// curved flags accept a boolean or a per-object predicate (new engine:
// per-origin). Until F55 (2026-09-05) an `offsetOf(o)` here added a moved
// object's offset in the hop, once, at the child's precision; that one
// rounding was magnified 4096x per level below the move, so a move's
// displacement no longer enters the chain at all — the tiles are unmoved
// space, and where a moved object's picture is read from is decided at render
// time from its table (TileStore._reroute, LevelMap.objShift).
//
// BACKWARDS COMPATIBILITY, and the decision that has to be made before the
// true 1.0 (Kobin, 2026-09-05). Every deep picture in every saved drawing is
// DERIVED, by this function and the ones it calls (`chopFreezeLoops`, the
// clip in `clipShapeToRect`, the arc cut points in `arcPerimeter`), from the
// stored home geometry — nothing below an object's home level is stored unless
// an erase ceded it. So the last bit of arithmetic here IS the picture eight
// levels down: change the freeze test, the chop, a cut formula or the order
// of one addition, and every existing drawing's detail drawn against a
// coarse object moves by that change times 4096 per level (F43 measured a
// last-bit change as a screen at level 7 and an empty tile at 8). Two ways
// out, not yet chosen: (a) store what has been looked at — cede a coarse
// object's chain down to any tile that holds references, the way an erase
// does (F42), so those bits are no longer derived and this function can
// change freely; the cost is natives per level per reference site, and a
// cost analysis is owed before deciding; (b) keep pictures derived and
// version the derivation — a saved drawing records which arithmetic it was
// drawn under, and old files keep running the old one. Until one is chosen,
// ANY CHANGE TO THIS PATH (F44's three layers most of all) is a compatibility
// event for shipped drawings, and shipping it needs Kobin's explicit call.
// Three such changes are already in the working tree and not deployed: F55
// (no move offset enters this hop any more) and F43 (a cut line's or arc's
// deep cuts come from its canonical line or arc — `mapLine`,
// `reanchorCutLines`, `reanchorCutArcs` in arcShape.js, `settleCut` in
// freeze.js), both 2026-09-05 and neither changing the bits of an unmoved,
// uncut piece; and F44's one-radius freeze (2026-09-06, freeze.js rule 2),
// which changes WHICH pieces freeze — every arc over ~8.8e12 units now
// freezes where the old test refused it — and so shifts the deep picture of
// every existing drawing with a curved stroke zoomed past its third
// crossing, by up to the tolerance times 4096 per level. Kobin asked for the
// gate knowing that; the next deploy is the compatibility event.
export function deriveStep(parentObjs, s, t, rect, level, opts, out) {
    const { cfg, width: W, opacityGroups, live } = opts;
    const base = cfg.base;
    const ftol = freezeTol(cfg);
    const curvedP = typeof opts.parentCurved === "function" ? opts.parentCurved : () => opts.parentCurved;
    const curvedC = typeof opts.childCurved === "function" ? opts.childCurved : () => opts.childCurved;
    const seams = opts.seams || SEAMS;
    // No offset enters the hop (F55): a move never touches what a tile is made
    // of. `ox`/`oy` stay as names so the arithmetic below reads as it did.
    const ox = 0, oy = 0;
    for (const o of parentObjs) {
        // Seam pad (see seamPad): per-object, because whether overlap is safe
        // depends on the object's own opacity.
        const pad = seams.pad(o, rect, cfg, opacityGroups);
        const crect = padRect(rect, pad);
        // The rect the CENTERLINE clips and the cull measure against. Under the
        // production policy that is the padded tile, so a stroke piece reaches
        // exactly as far past the seam as a fill piece of the same object; V0
        // used the bare tile here, which starved thin strokes of their overlap.
        const srect = seams.centerlines ? crect : rect;
        // Cull on the transformed bbox before any geometry work (the clip operates
        // on raw points, so the point bbox plus the stroke-width margin is safe).
        const b = bboxOf(o, live);
        const m = o.type === "fill" ? pad : o.lwFrame * (s / base) + (seams.centerlines ? pad : 0);
        if ((b.x1 * s + t.x) / base + ox < rect.left - m || (b.x0 * s + t.x) / base + ox > rect.right + m ||
            (b.y1 * s + t.y) / base + oy < rect.top - m || (b.y0 * s + t.y) / base + oy > rect.bottom + m) continue;
        const tag = (piece) => {
            if (o.editId != null) piece.editId = o.editId;
            out.push(piece);
        };
        if (o.type === "shape") {
            // Arcs magnify EXACTLY — a similarity maps a circle to a circle and
            // leaves its angles alone — so the perimeter crosses the level with
            // no re-resolving and no fitting. All that happens here is a clip,
            // and the clip gives arcs back (F-A: what a tile holds is what the
            // NEXT level inherits, so a polygon here becomes the object).
            //
            // Cancel against the cell centre BEFORE scaling. `p*f + t` and
            // `(p - c)*f` are the same number and not the same computation: the
            // first forms a large product and then adds a large offset of the
            // opposite sign, losing the low bits before the addition can
            // recover them. c = -t/s is an exact integer here.
            const cx = -t.x / s, cy = -t.y / s, f = s / base;
            const moved = transformLoopsAbout(o.loops, cx, cy, f, ox, oy);
            // THE CHOP, AND THE FREEZE — on the OBJECT's tile grid, before the
            // cache clip, because a tile is where an arc is cut and a cut is
            // where a curve may become a line (D2/D4). The grid rides with the
            // object, so the cuts land in the same place on it however far it
            // has been moved; anchor them to the frame instead and a move
            // slides every one of them, which moves a frozen crossing a quarter
            // pixel here and 4096 times that one level down (bible 6.6). An
            // offset at this hop moves the grid by exactly what it moves the
            // ink (F41) — with none, `tilePhase(v + 0)` is `v`.
            const ph = tilePhaseOf(o);
            const phase = [tilePhase(childTilePhase(ph[0], cx, f) + ox), tilePhase(childTilePhase(ph[1], cy, f) + oy)];
            // AND THE CLIP IS ON THAT GRID TOO — the object's own tiles, never
            // the cache square. A frame decides which objects are looked at; it
            // does not cut one. Two cache squares that both hold a stretch of
            // this curve therefore hold the SAME pieces of it, bit for bit,
            // because both clipped on the object's own lines. Clipping on the
            // square is what used to make one square's chord disagree with its
            // neighbour's by a quarter pixel, and by 1,000 px one level below.
            //
            // The window comes from the BARE square, not the padded one. A tile
            // is the same size as a square (D4), so an object that has not been
            // moved needs exactly one — and rounding the padded square's edges
            // outward instead asks for three per axis, which is nine times the
            // area stored per square. Measured: 49 ms to 258 ms on a level-1
            // render.
            const grid = TileGrid.at(phase);   // the OBJECT's grid, phase and all (S1)
            const cells = grid.range(rect);
            // The seam overhang. Pieces still have to reach past their tile by
            // the seam pad or a hairline shows down every boundary (S-1: every
            // other kind of piece overlaps by 2*pad, and a shape clipped to the
            // bare tile overlapped by 0). It is added to the OBJECT's rect, so
            // it is the same overhang in every square that holds this tile —
            // still nothing the frame decided.
            const objRect = padRect(grid.span(cells), pad);
            const chopped = chopFreezeLoops(moved, phase, ftol, cells);
            const { loops: kept, rings, covered } = shapeLoopsInRect(chopped, objRect, { freezeR: freezeRadius(ftol) });
            // `clip` is the rectangle the piece was cut on. The selection
            // indicator reads it to tell a cut from an edge (F39): a straight
            // piece lying along it is a seam, and the ants skip it.
            if (kept.length) {
                tag({ type: "shape", origin: "inherited", id: o.id, z: o.z, color: o.color,
                    opacity: o.opacity, loops: kept, paths: [], tile: phase, clip: objRect });
            } else if (rings.length) {
                const piece = { type: "fill", origin: "inherited", id: o.id, z: o.z, color: o.color,
                    opacity: o.opacity, polys: rings, paths: [], clip: objRect };
                if (covered) piece.covers = true;
                tag(piece);
            }
        } else if (o.type === "fill") {
            // Float clip (Sutherland-Hodgman), NOT Clipper: runs once per crossing
            // forever, and Clipper's magnitude-capped integer scale quantized
            // giant/deep geometry by whole frame-units.
            const tp = clipRingsToRect(
                o.polys.map((poly) => poly.map(([x, y]) => [(x * s + t.x) / base + ox, (y * s + t.y) / base + oy])), crect);
            if (tp.length) tag({ type: "fill", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, polys: tp, paths: [], clip: crect });
        } else {
            const lw = o.lwFrame * (s / base);
            const tpts = o.pts.map(([x, y]) => [(x * s + t.x) / base + ox, (y * s + t.y) / base + oy]);
            // Fill gate: only genuinely gate-wide strokes polygonize at the bake.
            // (A short-lived 2026-07-07 variant also filled anything that could
            // EVER exceed fatWidthPx in the child level — that routed nearly
            // every stroke through flatten+Clipper per tile and made a first
            // crossing over a 425-stroke drawing take 167 SECONDS. Moderately
            // wide inherited pieces render as strokes and, if they approach the
            // display gate in-level, get cached curve-capsule outlines instead.)
            const forceOutline = typeof opts.forceOutline === "function"
                ? opts.forceOutline(o) : !!opts.forceOutline;
            if (forceOutline || o.lwFrame * s > W * cfg.polygonizeWidthFrac) {
                const half = lw / 2;
                // The centerline window must contain the whole PADDED tile, not
                // just the tile: the rings below are clipped to crect, so a
                // window of rect ± half truncates the band `pad − half` short of
                // crect whenever the stroke is narrower than the pad — which
                // left adjacent pieces abutting with 0.05 units of overlap where
                // every other path gave 38.4, a hairline right down every tile
                // boundary.
                const ew = padRect(srect, half);
                // Flatten the displayed spline BEFORE clipping (shared chords,
                // see flatChords) — the outline must trace the spline the parent
                // painted. Everything else about how a band becomes rings lives
                // in bandRings, which the erase uses too so a hole and the ink
                // around it are cut out of the very same geometry.
                // With per-id opacity groups + nonzero fill, self-overlap needs
                // no union, so the engine (cfg.fatWidthPx present) routes ALL
                // fat bakes through the O(n) analytic strip; the legacy Clipper
                // offset survives only for the V0 golden comparisons.
                const polys = bandRings(tpts, lw, rect, crect, cfg, {
                    curved: curvedP(o),
                    chords: () => flatChords(o, level, tpts, cfg, live),
                    span: Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * (s / base),
                    window: ew,
                    legacyOffset: cfg.fatWidthPx == null,
                    decimate: opts.decimate,
                });
                if (polys.length) tag({ type: "fill", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, polys, paths: [], clip: crect });
            } else {
                // Small stroke: stays a stroke. If the child renders straight but the
                // parent displayed a spline, hand the child the flattened spline.
                const spts = (curvedP(o) && !curvedC(o) && o.pts.length > 2) ? flatChords(o, level, tpts, cfg, live) : tpts;
                // Extend the centerline clip by lw so clip-end caps fall beyond
                // the PADDED tile — a stroke piece has to overlap its neighbour
                // by the same pad a fill piece does, or the two representations
                // of one object disagree across the seam (and a hole cut by one
                // gets refilled by the other's overhang).
                const ew = padRect(srect, lw);
                for (const run of clipPolylineToRect(spts, ew)) {
                    if (run.length) tag({ type: "stroke", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, pts: run, lwFrame: lw, paths: [] });
                }
            }
        }
    }
    return out;
}

// ---- exact port of KobinEngineV0._projectNative (uncached; callers cache) ----
// Chain a native's geometry from its home level H into level L's frame through
// crossing `records` (records[K] maps level K-1 → K).
export function projectNative(o, H, L, records, base) {
    let pts = o.pts, lw = o.lwFrame;
    if (H > L) {
        for (let K = H; K > L; K--) {
            const r = records[K]; if (!r) return null;
            pts = pts.map(([x, y]) => [(x * base - r.t.x) / r.s, (y * base - r.t.y) / r.s]);
            lw = lw * (base / r.s);
        }
    } else {
        for (let K = H + 1; K <= L; K++) {
            const r = records[K]; if (!r) return null;
            pts = pts.map(([x, y]) => [(x * r.s + r.t.x) / base, (y * r.s + r.t.y) / base]);
            lw = lw * (r.s / base);
        }
    }
    return { type: "stroke", origin: "derived", id: o.id, z: o.z, pts, lwFrame: lw, color: o.color, opacity: o.opacity, paths: [] };
}

// Cumulative scale factor from level H to level L through `records` (null if a
// record is missing). f < 1 shrinks (minify), f > 1 magnifies.
export function levelFactor(H, L, records, base) {
    let f = 1;
    if (H > L) { for (let K = H; K > L; K--) { const r = records[K]; if (!r) return null; f *= base / r.s; } }
    else { for (let K = H + 1; K <= L; K++) { const r = records[K]; if (!r) return null; f *= r.s / base; } }
    return f;
}

// On-screen size (px) an object would have at level L's DEEPEST in-level zoom
// (`enter`) — the view-independent minify cull/fade measure (BUG-04's fade tag).
export function projectedSizePx(o, f, cfg, live) {
    const b = bboxOf(o, live);
    return (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) + (o.lwFrame || 0)) * f * cfg.enter;
}
