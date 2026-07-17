/**
 * clipperOutline.js — stroke-to-outline via Clipper (clipper-lib).
 *
 * Turns a stroke centerline + width into the filled outline polygon(s) the SVG
 * spec would render: offset by +/- width/2 with round joins and round caps.
 * Self-overlapping strokes come back as a clean union. Pure geometry, no Two.js.
 */

import ClipperLib from "clipper-lib";

// ---- faithful curve flattening (mirrors Two.js) ----
// Two.js draws a "curved" open path as piecewise cubic Beziers whose handles are
// derived from each anchor's neighbours (a Catmull-Rom-like cardinal spline,
// tension 0.33). To make the outline match what the browser actually paints we
// must offset THAT curve, not the raw chords between the input points. This
// mirrors node_modules/two.js/src/utils/curves.js (getControlPoints) and
// renderers/svg.js (which emits each segment as `C a.right b.left b`).
const HALF_PI = Math.PI / 2;

// Absolute positions of anchor b's left/right cubic handles, given neighbours a, c.
// Endpoints (a===b or c===b) get degenerate handles at the anchor, exactly as
// Two.js does (anchors are `relative` with controls initialised to 0,0).
// Exported: curveOutline.js builds the SAME spline's cubics to offset them.
export function controlsFor(a, b, c) {
    const d1 = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const d2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (d1 < 0.0001 || d2 < 0.0001) return { left: [b[0], b[1]], right: [b[0], b[1]] };
    const a1 = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    const e1 = d1 * 0.33, e2 = d2 * 0.33;
    let mid = (a1 + a2) / 2;
    mid += (a2 < a1) ? HALF_PI : -HALF_PI;
    const left = [Math.cos(mid) * e1 + b[0], Math.sin(mid) * e1 + b[1]];
    mid -= Math.PI;
    const right = [Math.cos(mid) * e2 + b[0], Math.sin(mid) * e2 + b[1]];
    return { left, right };
}

const _mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Recursive de Casteljau flattening of one cubic until GEOMETRICALLY flat within
// tol: both control points within (4/3)*tol of the chord line (the curve then
// deviates from the chord by at most tol). The previous AGG-style metric compared
// control points against their uniform-parameter (1/3, 2/3) positions -- but
// Two.js handles use tension 0.33, deliberately NOT the exact thirds, so every
// segment carried a parameterization skew that failed the test 4-5 levels deep
// even when dead straight: ~16x the points the tolerance actually needs, paid
// again by every Clipper offset/union downstream.
function flattenCubic(p0, p1, p2, p3, tol2, out, depth) {
    if (depth > 18) { out.push([p3[0], p3[1]]); return; }
    const dx = p3[0] - p0[0], dy = p3[1] - p0[1];
    const chord2 = dx * dx + dy * dy;
    let flat;
    if (chord2 > tol2) {
        const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx); // dist*|chord|
        const d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx);
        // Perpendicular closeness alone is NOT flatness: a handle pointing ALONG the
        // chord line but outside the segment (a sharp reversal between sparse anchors)
        // makes the curve overshoot the chord ends collinearly with zero perpendicular
        // distance. Require the handles' projections onto the chord to stay within the
        // segment too -- then the convex hull confines the curve to the chord box.
        const s1 = (p1[0] - p0[0]) * dx + (p1[1] - p0[1]) * dy; // dot * |chord|
        const s2 = (p2[0] - p0[0]) * dx + (p2[1] - p0[1]) * dy;
        flat = (d1 + d2) * (d1 + d2) <= (16 / 9) * tol2 * chord2
            && s1 >= 0 && s2 >= 0 && s1 <= chord2 && s2 <= chord2;
    } else {
        // Degenerate chord (curve loops back or is a dot): the cross-product test
        // is blind here, so require the handles themselves to be within tol.
        const h1x = p1[0] - p0[0], h1y = p1[1] - p0[1];
        const h2x = p2[0] - p3[0], h2y = p2[1] - p3[1];
        flat = Math.max(h1x * h1x + h1y * h1y, h2x * h2x + h2y * h2y) <= tol2;
    }
    if (flat) { out.push([p3[0], p3[1]]); return; }
    const p01 = _mid(p0, p1), p12 = _mid(p1, p2), p23 = _mid(p2, p3);
    const p012 = _mid(p01, p12), p123 = _mid(p12, p23), m = _mid(p012, p123);
    flattenCubic(p0, p01, p012, m, tol2, out, depth + 1);
    flattenCubic(m, p123, p23, p3, tol2, out, depth + 1);
}

// Flatten the exact Two.js curve through `pts` into a dense polyline (tol in frame units).
export function flattenCurve(pts, tol) {
    const n = pts.length;
    if (n < 3) return pts.map((p) => [p[0], p[1]]);
    const last = n - 1, ctrl = new Array(n);
    for (let i = 0; i < n; i++) {
        ctrl[i] = controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, last)]);
    }
    const tol2 = tol * tol, out = [[pts[0][0], pts[0][1]]];
    for (let i = 1; i < n; i++) flattenCubic(pts[i - 1], ctrl[i - 1].right, ctrl[i].left, pts[i], tol2, out, 0);
    return out;
}

// ---- windowed flatten (for strokes far larger than the view) ----
// A stroke projected up from a much coarser level arrives magnified 3000^N: at
// display-fidelity tolerance a full flatten explodes into millions of points.
// Only the centerline whose distance to the window lies in [rInner, rOuter] can
// shape the band edge visible there, so subtrees outside that annulus collapse
// to a single chord. Chords from the inside (d < rInner = half - windowDiag)
// have on-curve endpoints whose discs cover the whole window, so the caller's
// covered short-circuit stays exact; chords from beyond rOuter can't ink the
// window at all.
function rectDistMin(bx0, by0, bx1, by1, rect) {
    const dx = Math.max(rect.left - bx1, bx0 - rect.right, 0);
    const dy = Math.max(rect.top - by1, by0 - rect.bottom, 0);
    return Math.hypot(dx, dy);
}
function rectDistMax(bx0, by0, bx1, by1, rect) {
    const dx = Math.max(Math.abs(bx0 - rect.right), Math.abs(bx1 - rect.left));
    const dy = Math.max(Math.abs(by0 - rect.bottom), Math.abs(by1 - rect.top));
    return Math.hypot(dx, dy);
}
function flattenCubicNear(p0, p1, p2, p3, tol2, rect, rIn, rOut, out, depth) {
    // The curve lies inside its control hull, hence inside the hull's bbox.
    const bx0 = Math.min(p0[0], p1[0], p2[0], p3[0]), bx1 = Math.max(p0[0], p1[0], p2[0], p3[0]);
    const by0 = Math.min(p0[1], p1[1], p2[1], p3[1]), by1 = Math.max(p0[1], p1[1], p2[1], p3[1]);
    if (rectDistMax(bx0, by0, bx1, by1, rect) < rIn || rectDistMin(bx0, by0, bx1, by1, rect) > rOut) {
        out.push([p3[0], p3[1]]); // whole subtree can't shape the window's band edge
        return;
    }
    // depth cap 40 (vs 18): descending from a 3000^N-magnified span to the
    // window-sized sliver takes ~log2(span/window) splits; pruning keeps the
    // visited node count small even at full depth.
    if (depth > 40) { out.push([p3[0], p3[1]]); return; }
    const dx = p3[0] - p0[0], dy = p3[1] - p0[1];
    const chord2 = dx * dx + dy * dy;
    let flat;
    if (chord2 > tol2) {
        const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx);
        const d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx);
        const s1 = (p1[0] - p0[0]) * dx + (p1[1] - p0[1]) * dy;
        const s2 = (p2[0] - p0[0]) * dx + (p2[1] - p0[1]) * dy;
        flat = (d1 + d2) * (d1 + d2) <= (16 / 9) * tol2 * chord2
            && s1 >= 0 && s2 >= 0 && s1 <= chord2 && s2 <= chord2;
    } else {
        const h1x = p1[0] - p0[0], h1y = p1[1] - p0[1];
        const h2x = p2[0] - p3[0], h2y = p2[1] - p3[1];
        flat = Math.max(h1x * h1x + h1y * h1y, h2x * h2x + h2y * h2y) <= tol2;
    }
    if (flat) { out.push([p3[0], p3[1]]); return; }
    const p01 = _mid(p0, p1), p12 = _mid(p1, p2), p23 = _mid(p2, p3);
    const p012 = _mid(p01, p12), p123 = _mid(p12, p23), m = _mid(p012, p123);
    flattenCubicNear(p0, p01, p012, m, tol2, rect, rIn, rOut, out, depth + 1);
    flattenCubicNear(m, p123, p23, p3, tol2, rect, rIn, rOut, out, depth + 1);
}
export function flattenCurveNear(pts, tol, rect, rIn, rOut) {
    const n = pts.length;
    if (n < 3) return pts.map((p) => [p[0], p[1]]);
    const last = n - 1, ctrl = new Array(n);
    for (let i = 0; i < n; i++) {
        ctrl[i] = controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, last)]);
    }
    const tol2 = tol * tol, out = [[pts[0][0], pts[0][1]]];
    for (let i = 1; i < n; i++) flattenCubicNear(pts[i - 1], ctrl[i - 1].right, ctrl[i].left, pts[i], tol2, rect, rIn, rOut, out, 0);
    return out;
}

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

// Signed (shoelace) area of one ring; sign encodes orientation.
function ringSignedArea(ring) {
    let s = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
}

/**
 * Net inked area of a compound ring set (outers positive, holes cancel).
 * The engine compares this before/after an erase to skip grazing no-ops.
 */
export function netRingsArea(rings) {
    return Math.abs(rings.reduce((s, r) => s + ringSignedArea(r), 0));
}

/**
 * The eraser's swept footprint: a round-capped capsule from `a` to `b` with
 * radius r (a === b degenerates to a circle). One convex ring.
 */
export function capsulePoly(a, b, r, segs = 24) {
    const half = Math.max(4, segs >> 1);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const out = [];
    if (len < 1e-12) {
        const n = half * 2;
        for (let i = 0; i < n; i++) {
            const t = (i / n) * 2 * Math.PI;
            out.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
        }
        return out;
    }
    const base = Math.atan2(dy, dx) + Math.PI / 2; // a's left-side normal
    for (let i = 0; i <= half; i++) {              // cap sweeping behind a
        const t = base + (i / half) * Math.PI;
        out.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
    }
    for (let i = 0; i <= half; i++) {              // cap sweeping past b
        const t = base + Math.PI + (i / half) * Math.PI;
        out.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
    }
    return out;
}

/**
 * Boolean difference: subject rings minus clip rings (nonzero rule on both
 * sides). Returns DISJOINT REGIONS — each entry is one region's rings (outer
 * first, then its holes) — so every leftover can become its own fill native
 * with a tight bbox. Empty array = nothing survives.
 */
export function subtractPolys(subjectPolys, clipPolys, opts = {}) {
    if (!subjectPolys || subjectPolys.length === 0) return [];
    let mag = 1;
    for (const poly of subjectPolys) { const m = maxMagnitude(poly); if (m > mag) mag = m; }
    for (const poly of clipPolys || []) { const m = maxMagnitude(poly); if (m > mag) mag = m; }
    const scale = Math.max(1, Math.min(opts.scale || 1000, Math.floor(SAFE_RANGE / mag)));
    const toPath = (poly) => poly.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }));
    const c = new ClipperLib.Clipper();
    c.AddPaths(subjectPolys.map(toPath), ClipperLib.PolyType.ptSubject, true);
    if (clipPolys && clipPolys.length) c.AddPaths(clipPolys.map(toPath), ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctDifference, sol,
        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    // Clipper marks outers/holes by orientation. Each outer founds a region;
    // each hole joins the smallest outer that contains it (checking smallest
    // first assigns holes to their immediate outer under nesting).
    const outers = [], holes = [];
    for (const path of sol) {
        const ring = path.map((pt) => [pt.X / scale, pt.Y / scale]);
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
    // Cap the integer scale so the largest coordinate (poly points or rect corners) stays
    // inside clipper-lib's fast range -- deep-level frame coords would otherwise hit Int128.
    let mag = Math.max(Math.abs(rect.left), Math.abs(rect.right), Math.abs(rect.top), Math.abs(rect.bottom));
    for (const poly of polys) { const m = maxMagnitude(poly); if (m > mag) mag = m; }
    const scale = Math.max(1, Math.min(opts.scale || 1000, Math.floor(SAFE_RANGE / mag)));
    const subj = polys.map((poly) => poly.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) })));
    const clip = [
        { X: Math.round(rect.left * scale), Y: Math.round(rect.top * scale) },
        { X: Math.round(rect.right * scale), Y: Math.round(rect.top * scale) },
        { X: Math.round(rect.right * scale), Y: Math.round(rect.bottom * scale) },
        { X: Math.round(rect.left * scale), Y: Math.round(rect.bottom * scale) },
    ];
    const c = new ClipperLib.Clipper();
    c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
    c.AddPath(clip, ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctIntersection, sol,
        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return sol.map((poly) => poly.map((pt) => [pt.X / scale, pt.Y / scale]));
}

/**
 * Float Sutherland-Hodgman clip of filled rings against an axis-aligned rect.
 * Unlike the Clipper version above there is NO integer quantization: the capped
 * integer scale loses whole frame-units of precision once coordinates get big
 * (giant transformed fills, tiles far from the level origin) and silently falls
 * into emulated Int128 arithmetic past its fast range. Here every intersection
 * is plain float64 interpolation, so two tiles cutting the same source edge at
 * the same grid line compute bit-identical seam points. Winding is preserved
 * ring-by-ring, so holes still cut under the nonzero fill rule; the zero-area
 * boundary bridges a concave ring can produce do not render.
 */
// Winding number of point p w.r.t. a set of rings (nonzero rule).
function windingAt(rings, p) {
    let w = 0;
    for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
            const a = r[i], b = r[(i + 1) % n];
            if (a[1] <= p[1]) {
                if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++;
            } else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
        }
    }
    return w;
}

export function clipRingsToRect(polys, rect) {
    const out = [];
    if (!polys) return out;
    // Interior probe at odd fractions so it (practically) never sits on a source edge.
    const probe = [rect.left + (rect.right - rect.left) * 0.500123,
        rect.top + (rect.bottom - rect.top) * 0.500567];
    for (const poly of polys) {
        let ring = poly;
        for (let e = 0; e < 4 && ring.length; e++) {
            const axis = e >> 1, max = (e & 1) === 1;
            const val = axis === 0 ? (max ? rect.right : rect.left) : (max ? rect.bottom : rect.top);
            const next = [];
            for (let i = 0, n = ring.length; i < n; i++) {
                const a = ring[i], b = ring[(i + 1) % n];
                const ain = max ? a[axis] <= val : a[axis] >= val;
                const bin = max ? b[axis] <= val : b[axis] >= val;
                if (ain) next.push(a);
                if (ain !== bin) {
                    const t = (val - a[axis]) / (b[axis] - a[axis]);
                    next.push(axis === 0 ? [val, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), val]);
                }
            }
            ring = next;
        }
        const kept = ring.length >= 3 ? ring : null;
        if (kept) out.push(kept);
        // Sutherland-Hodgman only ever ADDS edges lying ON the rect boundary, so
        // inside the rect its winding differs from the source ring's by a CONSTANT
        // (both functions jump across exactly the same interior edges). For a
        // concave ring that WRAPS the rect without covering it -- a tile sitting in
        // the pocket between two lobes of a fat stroke's outline -- that constant is
        // wrong (SH reports full-rect coverage: the whole screen flips to ink at a
        // crossing). Measure the constant at one interior probe and cancel it with
        // rect-sized rings; the nonzero fill rule absorbs them.
        const dw = windingAt([poly], probe) - (kept ? windingAt([kept], probe) : 0);
        if (dw !== 0) {
            let rr = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]];
            if (windingAt([rr], probe) * dw < 0) rr = rr.slice().reverse();
            for (let k = Math.abs(dw); k > 0; k--) out.push(rr);
        }
    }
    return out;
}

/**
 * Analytic band outline for OVERSIZED strokes (band radius vastly larger than
 * the window). Clipper's offset is unusable there: coordinates of that
 * magnitude fall out of its fast integer range (~100x slower emulated Int128)
 * and round caps/joins tessellate the FULL arc at uniform tolerance -- tens of
 * thousands of points for a cap whose visible part is one near-straight sliver.
 *
 * Instead, offset the (already windowed-flattened, decimated) centerline run
 * analytically: vertices displaced +-half along miter normals. Exactness
 * argument, window-local:
 *  - annulus chords near the window are flattened to tolerance => near-straight
 *    => miter == round join to sub-tolerance;
 *  - sharp/coarse joins only exist on pruned chords, whose join geometry lies
 *    within `half` of a vertex that is > half + windowDiag away => off-window;
 *  - run ends at annulus cuts carry one extra vertex beyond the influence zone
 *    (see the caller's classification), so a butt end differs from the true
 *    round cap only outside the window;
 *  - a TRUE stroke end whose cap disc can reach the window gets a separate
 *    disc-sector piece, sampled finely over just the angles facing the window.
 * Pieces may overlap; ink is additive (nonzero fill / per-object groups).
 *
 * @param {Array<[number,number]>} pts   centerline run (window coords)
 * @param {number} width                 stroke width
 * @param {{left,top,right,bottom}} rect the window the output must be exact in
 * @param {{startCap?:boolean, endCap?:boolean}} [opts] true-stroke-end flags
 * @returns {Array<Array<[number,number]>>}
 */
export function strokeStripNear(pts, width, rect, opts = {}) {
    const half = width / 2;
    const out = [];
    const diagR = Math.hypot(rect.right - rect.left, rect.bottom - rect.top);
    const rcx = (rect.left + rect.right) / 2, rcy = (rect.top + rect.bottom) / 2;
    const capPiece = (p) => {
        const dx = rcx - p[0], dy = rcy - p[1];
        const dist = Math.hypot(dx, dy);
        if (dist - diagR > half) return; // this cap disc can't reach the window
        const phi = Math.atan2(dy, dx);
        // angular half-span that subtends the window from the disc centre, padded 4x
        const delta = Math.min(Math.PI, 4 * Math.asin(Math.min(1, diagR / Math.max(dist, diagR))));
        const K = 96, ring = [[p[0], p[1]]];
        for (let k = 0; k <= K; k++) {
            const a = phi - delta + (2 * delta * k) / K;
            ring.push([p[0] + Math.cos(a) * half, p[1] + Math.sin(a) * half]);
        }
        out.push(ring);
    };
    if (pts.length === 1) { capPiece(pts[0]); }
    else {
        const n = pts.length, nx = [], ny = [];
        for (let i = 0; i < n - 1; i++) {
            const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
            const len = Math.hypot(dx, dy) || 1;
            nx.push(-dy / len); ny.push(dx / len);
        }
        // The miter ribbon: the OUTER boundary, which matches the level-0 curve
        // outline's join at gentle turns so the representation is pixel-stable
        // across a crossing. (Its inner offsets cross on the concave side of a
        // sharp corner into a reversed sub-loop that nonzero fill cancels to a
        // HOLE — a fat stroke with an inside corner became an hourglass after a
        // crossing. The per-segment rectangles below patch exactly that.)
        const L = [], R = [];
        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 1), b = Math.min(n - 2, i);
            let mx = (nx[a] + nx[b]) / 2, my = (ny[a] + ny[b]) / 2;
            const ml = Math.hypot(mx, my);
            if (ml < 1e-12) { mx = nx[b]; my = ny[b]; } else { mx /= ml; my /= ml; }
            const dot = mx * nx[b] + my * ny[b];
            const sc = half / Math.max(0.5, dot);
            L.push([pts[i][0] + mx * sc, pts[i][1] + my * sc]);
            R.push([pts[i][0] - mx * sc, pts[i][1] - my * sc]);
        }
        out.push(L.concat(R.reverse()));
        // Per-segment rectangles UNDER the ribbon fill the concave hole: each is
        // its own segment's ±half band — convex, same-oriented, additive under
        // nonzero fill, so it can only ADD coverage (the reversed sub-loop's
        // cancellation is overwritten to a nonzero winding). Convexity matters:
        // clipRingsToRect's winding compensation blanks a tile for any ring whose
        // clipped winding disagrees at its probe, which a non-convex join fan
        // would trip — a rectangle never does.
        for (let i = 0; i < n - 1; i++) {
            const ox = nx[i] * half, oy = ny[i] * half;
            out.push([
                [pts[i][0] + ox, pts[i][1] + oy], [pts[i + 1][0] + ox, pts[i + 1][1] + oy],
                [pts[i + 1][0] - ox, pts[i + 1][1] - oy], [pts[i][0] - ox, pts[i][1] - oy],
            ]);
        }
        if (opts.startCap) capPiece(pts[0]);
        if (opts.endCap) capPiece(pts[n - 1]);
    }
    // Nonzero fill unions overlapping pieces only when they share orientation;
    // normalize every ring (ribbon, rectangles, caps) to the same winding so they
    // always ADD and never cancel a covered region back into a hole.
    for (const ring of out) {
        let area = 0;
        for (let i = 0, m = ring.length; i < m; i++) { const a = ring[i], b = ring[(i + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
        if (area > 0) ring.reverse();
    }
    return out;
}

/**
 * Douglas-Peucker decimation of a polyline to `tol` (frame units), measuring
 * distance to the SEGMENT (not the infinite line, which is blind to spurs that
 * run out and back along the chord). Endpoints are always kept. Used to shrink
 * offset inputs to what the current view can resolve: a display-fidelity chord
 * cache is flattened for the deepest in-level zoom and can be ~1000x finer than
 * a shallow view needs, while Clipper's offset pays ~0.13ms per input point.
 */
export function decimatePolyline(pts, tol) {
    const n = pts.length;
    if (n <= 2) return pts;
    const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
    const t2 = tol * tol;
    const stack = [[0, n - 1]];
    while (stack.length) {
        const [i0, i1] = stack.pop();
        if (i1 - i0 < 2) continue;
        const a = pts[i0], b = pts[i1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy;
        let worst = -1, wd = 0;
        for (let i = i0 + 1; i < i1; i++) {
            const cx = pts[i][0] - a[0], cy = pts[i][1] - a[1];
            let d2;
            const t = L2 > 0 ? (cx * dx + cy * dy) / L2 : 0;
            if (t <= 0) d2 = cx * cx + cy * cy;
            else if (t >= 1) { const ex = pts[i][0] - b[0], ey = pts[i][1] - b[1]; d2 = ex * ex + ey * ey; }
            else { const cr = cx * dy - cy * dx; d2 = (cr * cr) / L2; }
            if (d2 > wd) { wd = d2; worst = i; }
        }
        if (wd > t2) { keep[worst] = 1; stack.push([i0, worst], [worst, i1]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out;
}

// Liang-Barsky clip of one segment to an axis-aligned rect. Returns [p0,p1] or null.
function clipSeg(p0, p1, r) {
    let t0 = 0, t1 = 1;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const p = [-dx, dx, -dy, dy];
    const q = [p0[0] - r.left, r.right - p0[0], p0[1] - r.top, r.bottom - p0[1]];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
            const u = q[i] / p[i];
            if (p[i] < 0) { if (u > t1) return null; if (u > t0) t0 = u; }
            else { if (u < t0) return null; if (u < t1) t1 = u; }
        }
    }
    return [[p0[0] + t0 * dx, p0[1] + t0 * dy], [p0[0] + t1 * dx, p0[1] + t1 * dy]];
}

/**
 * Clip a polyline (open centerline) to a rect, returning the inside runs as
 * sub-polylines. Keeps strokes as strokes (so the browser renders caps/joins
 * perfectly) while keeping coordinates bounded to the window.
 */
export function clipPolylineToRect(pts, rect) {
    if (!pts || pts.length === 0) return [];
    if (pts.length === 1) {
        const [x, y] = pts[0];
        return (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) ? [[pts[0]]] : [];
    }
    const runs = []; let cur = null; const eps = 1e-6;
    const close = (a, b) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
    for (let i = 0; i < pts.length - 1; i++) {
        const seg = clipSeg(pts[i], pts[i + 1], rect);
        if (!seg) { cur = null; continue; }
        if (cur && close(cur[cur.length - 1], seg[0])) cur.push(seg[1]);
        else { cur = [seg[0], seg[1]]; runs.push(cur); }
    }
    return runs;
}
