/**
 * clipperBoolean.js - the three functions that still use `clipper-lib`.
 *
 * Clipper works on a 64-bit INTEGER lattice, so every coordinate must be scaled
 * into a safe range and back out again, and the scale factor is what bounds the
 * precision. `capScale`/`localFrame`/`pickScale` below are that bookkeeping, and
 * `geometry/lattice.test.js` is the suite that measures where it starts to drift.
 * Nothing else in the geometry layer works this way - see `polyline.js`, which is
 * pure float64 and has no coordinate ceiling.
 *
 * WHO STILL CALLS THIS, and why it cannot simply be deleted (2026-08-31):
 *
 *   strokeOutline    - `Renderer._fatPolys`, under `outlineMode`. That is the
 *                      debug fill view; normal rendering has used zoom-invariant
 *                      curve capsules since F22.
 *                    - `derive.bandRings` under `opts.legacyOffset`, which is
 *                      gated on `cfg.fatWidthPx == null` and so fires only for
 *                      the V0 oracle. `geometry/derive.test.js` is the
 *                      golden-compare that walks that branch.
 *                    - `__oracles__/KobinEngineV0.js`, throughout.
 *   subtractPolys    - `geometry/areaErase.test.js` (area-erase semantics) and
 *                      `geometry/lattice.test.js` (the drift probe).
 *   clipPolysToRect  - `geometry/lattice.test.js` only.
 *
 * So `clipper-lib` STAYS in package.json. The cleanup pass that split this file
 * set out to remove it and could not: doing so means deleting outline mode, the
 * legacyOffset branch, and with it the V0 golden-compare - which is the oracle
 * the arc pipeline is checked against. See OPEN-FLAGS X2-X4.
 *
 * THE DIRECTION OF THE DEPENDENCY IS ONE-WAY. This file imports from
 * `polyline.js`; `polyline.js` must never import from here, or the pure half
 * stops being pure.
 */
import ClipperLib from "clipper-lib";
import { flattenCurve, ringSignedArea, windingAt } from "./polyline";

// clipper-lib uses fast doubles only while |coord| stays under loRange (~4.7e7); above
// that it falls back to emulated Int128 (~100x slower). Keep scaled integer coordinates
// comfortably below that ceiling.
const SAFE_RANGE = 4.0e7;
function maxMagnitude(points, margin = 0) {
    let m = 1;
    for (const p of points) { const a = Math.abs(p[0]), b = Math.abs(p[1]); if (a > m) m = a; if (b > m) m = b; }
    return m + Math.abs(margin || 0);
}
// Largest integer scale that keeps maxMag*scale under SAFE_RANGE, but no larger than `desired`.
function capScale(desired, points, margin = 0) {
    const m = maxMagnitude(points, margin);
    return Math.max(1, Math.min(desired, Math.floor(SAFE_RANGE / m)));
}

/**
 * A LOCAL origin for the integer lattice — the fix for "polygonize with
 * reference to your tile, not to somewhere far away".
 *
 * Clipper works on integers, so every boolean has to pick a scale, and the scale
 * is capped by the largest coordinate in play. Measuring that from the FRAME
 * ORIGIN makes precision fall off linearly with how far the drawing has been
 * panned: measured on a plain stroke, the lattice is 1.0e-3 units at the origin,
 * 1.5e-2 at 6e5 units out, and 1.1e-1 at 4e6 — which is 0.3 px, 4.5 px and
 * 33 px respectively at the level's deepest zoom. That is the pixellation, and
 * it has nothing to do with the shape being worked on; only with where it sits.
 *
 * The subtlety is that simply re-centring on the geometry would ALSO be wrong:
 * the lattice would then be anchored somewhere different for every call, so two
 * booleans over abutting geometry would round a shared edge two different ways
 * and open a hairline crack between them.
 *
 * So: pick the scale from the geometry's own EXTENT (position-independent), and
 * then snap the local origin to that same lattice. `Math.round((x - ox) * scale)`
 * with `ox * scale` an exact integer is identical to `Math.round(x * scale)`
 * evaluated on the global grid — the same grid every caller has always used —
 * but computed on small numbers, so nothing is lost to the cap.
 */
function localFrame(polySets, desired = 1000, margin = 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const polys of polySets) {
        for (const poly of polys || []) {
            for (const p of poly) {
                if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
                if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
            }
        }
    }
    if (!(x0 <= x1)) return { scale: Math.max(1, desired), ox: 0, oy: 0 };
    const half = Math.max((x1 - x0) / 2, (y1 - y0) / 2, 1) + Math.abs(margin || 0);
    const scale = Math.max(1, Math.min(desired, Math.floor(SAFE_RANGE / half)));
    // Snap the origin ONTO the lattice, so the grid is the global one.
    const ox = Math.round(((x0 + x1) / 2) * scale) / scale;
    const oy = Math.round(((y0 + y1) / 2) * scale) / scale;
    return { scale, ox, oy };
}
function pickScale(center, width, optScale, displayScale) {
    const desired = Math.min(1e7, Math.max(optScale || 1000, Math.round(100 * displayScale)));
    return capScale(desired, center, width); // offset radius ~width/2 pushes coords out; width is a safe margin
}

/**
 * Stroke -> filled outline, matching what SVG/Canvas actually paints: offset the
 * (flattened) centerline by +/- width/2 with round joins and round caps.
 *
 * @param {Array<[number,number]>} points  centerline in frame units
 * @param {number} width                   stroke width in frame units
 * @param {object} [opts]
 *   @param {boolean} [opts.curved]        offset the Two.js spline (true) or raw chords (false)
 *   @param {number}  [opts.displayScale]  frame units -> on-screen px (so tolerances are in real px)
 *   @param {number}  [opts.arcTolerancePx] max chord error in on-screen px (default 0.25)
 * @returns {Array<Array<[number,number]>>} outline polygons (each a point ring)
 */
export function strokeOutline(points, width, opts = {}) {
    if (!points || points.length === 0 || width <= 0) return [];
    const displayScale = opts.displayScale || 1;
    const arcPx = (opts.arcTolerancePx != null ? opts.arcTolerancePx : 0.25);
    // Tolerances in FRAME units, derived from a fixed on-screen pixel budget, so the
    // outline is equally smooth no matter how deep the level is. Flatten the
    // centerline a little tighter than the offset arc tolerance.
    const flatTol = (arcPx * 0.5) / displayScale;
    const arcTol = arcPx / displayScale;

    const center = (opts.curved && points.length > 2) ? flattenCurve(points, flatTol) : points.map((p) => [p[0], p[1]]);

    // Clipper is integer-based; choose a multiplier giving sub-pixel precision. BUT cap it
    // so integer coordinates stay inside clipper-lib's fast range (loRange ~4.7e7): beyond
    // that it silently switches to emulated Int128 arithmetic, which is ~100x slower. At a
    // deep level the geometry magnitude can be huge (tile/centerline coords in the 1e5-1e6
    // range, plus the offset radius), so without this cap a single offset can take ~0.5s.
    const scale = pickScale(center, width, opts.scale, displayScale);
    const path = center.map((p) => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
    const co = new ClipperLib.ClipperOffset(2.0, Math.max(1, arcTol * scale));
    // A single point becomes a dot (circle); a polyline becomes a stroke.
    co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound);
    const solution = new ClipperLib.Paths();
    co.Execute(solution, (width / 2) * scale);

    return solution.map((poly) => poly.map((pt) => [pt.X / scale, pt.Y / scale]));
}

/**
 * Boolean difference: subject rings minus clip rings (nonzero rule on both
 * sides). Returns DISJOINT REGIONS — each entry is one region's rings (outer
 * first, then its holes) — so every leftover can become its own fill native
 * with a tight bbox. Empty array = nothing survives.
 */
export function subtractPolys(subjectPolys, clipPolys, opts = {}) {
    if (!subjectPolys || subjectPolys.length === 0) return [];
    const { scale, ox, oy } = localFrame([subjectPolys, clipPolys], opts.scale || 1000);
    const toPath = (poly) => poly.map(([x, y]) => ({ X: Math.round((x - ox) * scale), Y: Math.round((y - oy) * scale) }));
    let subject = subjectPolys.map(toPath);
    // MERGE THE SUBJECT FIRST when it is more than one ring.
    //
    // "Disjoint regions" is this function's contract, and a difference alone
    // does not honour it: Clipper keeps ABUTTING subject paths as separate
    // output paths even under the nonzero rule, edge-sharing or not. Measured on
    // three rectangles stacked edge to edge — one gesture through them returned
    // FOUR regions where the identical single rectangle returned two.
    //
    // Abutting rings are not a corner case here. A parent that has ceded a tile
    // is stored as the guillotine cells around the hole (geometry/cede.js keeps
    // the cut exact by never running a boolean), so every object that has been
    // deep-erased arrives in this shape. Without the merge, the next ordinary
    // erase shatters it into one native per cell, each its own object — the
    // band comes apart into horizontal strips at the old tile's edges.
    if (subject.length > 1) {
        const u = new ClipperLib.Clipper();
        u.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
        const merged = new ClipperLib.Paths();
        u.Execute(ClipperLib.ClipType.ctUnion, merged,
            ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
        if (merged.length) subject = merged;
    }
    const c = new ClipperLib.Clipper();
    c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
    if (clipPolys && clipPolys.length) c.AddPaths(clipPolys.map(toPath), ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctDifference, sol,
        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    // Clipper marks outers/holes by orientation. Each outer founds a region;
    // each hole joins the smallest outer that contains it (checking smallest
    // first assigns holes to their immediate outer under nesting).
    const outers = [], holes = [];
    for (const path of sol) {
        const ring = path.map((pt) => [pt.X / scale + ox, pt.Y / scale + oy]);
        if (ring.length < 3) continue;
        (ClipperLib.Clipper.Orientation(path) ? outers : holes).push(ring);
    }
    const regions = outers.map((ring) => ({ area: Math.abs(ringSignedArea(ring)), rings: [ring] }));
    regions.sort((a, b) => a.area - b.area);
    for (const hole of holes) {
        const home = regions.find((rg) => windingAt([rg.rings[0]], hole[0]) !== 0);
        if (home) home.rings.push(hole);
    }
    return regions.map((rg) => rg.rings);
}

/**
 * Clip filled polygons to an axis-aligned rectangle (the bake window).
 * @param {Array<Array<[number,number]>>} polys
 * @param {{left,top,right,bottom}} rect
 * @returns {Array<Array<[number,number]>>}
 */
export function clipPolysToRect(polys, rect, opts = {}) {
    if (!polys || polys.length === 0) return [];
    // Local lattice origin — see localFrame. Measuring the scale from the frame
    // origin instead makes precision fall off with how far the drawing has been
    // panned, which shows up as pixellation once you zoom in on it.
    const corners = [[[rect.left, rect.top], [rect.right, rect.bottom]]];
    const { scale, ox, oy } = localFrame([polys, corners], opts.scale || 1000);
    const subj = polys.map((poly) => poly.map(([x, y]) => ({ X: Math.round((x - ox) * scale), Y: Math.round((y - oy) * scale) })));
    const L = Math.round((rect.left - ox) * scale), R = Math.round((rect.right - ox) * scale);
    const T = Math.round((rect.top - oy) * scale), B = Math.round((rect.bottom - oy) * scale);
    const clip = [{ X: L, Y: T }, { X: R, Y: T }, { X: R, Y: B }, { X: L, Y: B }];
    const c = new ClipperLib.Clipper();
    c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
    c.AddPath(clip, ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctIntersection, sol,
        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return sol.map((poly) => poly.map((pt) => [pt.X / scale + ox, pt.Y / scale + oy]));
}
