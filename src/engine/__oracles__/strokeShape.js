// ========================= ORACLE ONLY, NOT PRODUCTION =====================
// Minkowski sum of a FLATTENED centerline with a disc — the pre-curve bake. F1
// retired it: chording the centerline creases the inside of every bend by
// ~sqrt(8*tol/R), an ANGLE, so it never shrinks with zoom. Reachable only through
// `curvePerimeter` / `bakeStrategies`, i.e. the dev labs and the oracle tests.
// ===========================================================================

/**
 * strokeShape.js — a stroke's painted footprint as a RESOLVED PERIMETER, exact.
 *
 * The thing this replaces: `curveOutline.js` emits one capsule loop per
 * centerline run and lets NONZERO fill composite them. That is right for
 * rendering (Vello's stroke expansion does the same, deliberately) and wrong for
 * everything else, because the shape is never actually computed. Measured on one
 * real drawing — a 3,769-point stroke 90 units wide:
 *
 *     as overlapping capsules   1,405 loops, 156,525 cubics   157,930 anchors
 *     flattened for Clipper     1,853,649 vertices, 4,469 ms to produce
 *     as a resolved perimeter   ~200 exact pieces
 *
 * The 157,930 crashed Two.js outright (its Collection ctor spreads the array
 * into `push.apply`, which gives out at 131,072), and the 1.85M is the erase
 * freeze. Both are the same defect: never computing the shape.
 *
 * WHAT COMES OUT is exact, with no tolerance anywhere. The Minkowski sum of a
 * polyline with a disc is bounded by line segments and circular arcs anyway —
 * those are the only curves closed under offsetting — so every piece here is an
 * exact sub-interval of an offset line or of a circle of radius r. Nothing is
 * fitted and nothing is flattened.
 *
 * HOW IT STAYS CHEAP is the interesting part. A dense scribble paints its own
 * bounding box many times over, so nearly every capsule is buried and
 * contributes nothing. The measured shape above: 3,768 segments, ~216 of them
 * on the boundary. The naive exact arrangement is quadratic in segments and
 * takes ~36 seconds on it; culling first and being exact only on the survivors
 * takes ~0.3.
 *
 * A capsule plays TWO roles, and the cull applies to only one of them:
 *
 *   as a PRODUCER of boundary — a buried capsule emits none, so skip it;
 *   as a TRIMMER of everyone else's — it must still be consulted.
 *
 * Dropping it from the second role as well is wrong, and wrong in a way that
 * looks plausible until measured. A candidate is a candidate because part of it
 * is exposed, but its OTHER side is buried, sometimes deep in the interior —
 * and the only capsules covering it there are the buried ones. Cull them from
 * trimming too and that inward offset line survives as boundary, so the shape
 * acquires an interior hole. Measured on a nine-row scribble: with the trimming
 * set culled, a spurious hole of area 4,795 and 373 sample points inside the
 * ink reported as outside; with it whole, exact.
 *
 * The saving is still most of what was hoped for. Production is what scales
 * with the path — 3,768 segments' worth of boundary to build and trim, against
 * 216 that can contribute — while trimming only ever costs the local density.
 *
 * See `Crumb` for how burial gets decided for almost nothing.
 */

// ---------------------------------------------------------------------------
// The crumb: an occupancy grid, cheap enough to maintain while drawing.
//
// Per cell: how many capsules cover it ENTIRELY, and the id of the first one to
// do so. That is all the cull needs, and it costs a handful of integer writes
// per point — measured at 14 microseconds a point against 1.96 ms for
// maintaining the true boundary incrementally, a factor of 140.
//
// It works because ink is MONOTONE. Drawing only ever adds, so a capsule that
// is covered can never become exposed again; burial is a one-way door and can
// be recorded as it happens and never revisited. (An erase breaks monotonicity,
// which is why a crumb belongs to one stroke and is consumed at pen-up.)
//
// The grid is deliberately conservative. A cell counts only when a capsule
// covers it whole, so a cell that is covered by several capsules between them
// still reads as uncovered, and its capsules stay candidates. Over-inclusion
// costs a little time in the exact pass; under-inclusion would lose boundary.
// ---------------------------------------------------------------------------
export class Crumb {
    constructor(cellSize) {
        this.cell = cellSize;
        this.count = new Map();   // cellKey -> capsules fully covering it
        this.witness = new Map(); // cellKey -> id of the first such capsule
    }
    _key(i, j) { return i * 8388608 + j; }
    _cx(x) { return Math.floor(x / this.cell); }
    _cy(y) { return Math.floor(y / this.cell); }

    /** Record one capsule. `id` identifies it for the self-coverage test. */
    add(seg, r, id) {
        const cell = this.cell;
        const i0 = this._cx(Math.min(seg.a[0], seg.b[0]) - r), i1 = this._cx(Math.max(seg.a[0], seg.b[0]) + r);
        const j0 = this._cy(Math.min(seg.a[1], seg.b[1]) - r), j1 = this._cy(Math.max(seg.a[1], seg.b[1]) + r);
        const r2 = r * r;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const x = i * cell, y = j * cell;
                // whole-cell coverage: all four corners inside
                if (distSqToSeg(x, y, seg) <= r2 && distSqToSeg(x + cell, y, seg) <= r2
                    && distSqToSeg(x, y + cell, seg) <= r2 && distSqToSeg(x + cell, y + cell, seg) <= r2) {
                    const k = this._key(i, j);
                    this.count.set(k, (this.count.get(k) || 0) + 1);
                    if (!this.witness.has(k)) this.witness.set(k, id);
                }
            }
        }
    }
    /** True if (x,y)'s cell is already filled by somebody other than `id`. */
    coveredByOther(x, y, id) {
        const k = this._key(this._cx(x), this._cy(y));
        const c = this.count.get(k) || 0;
        if (c === 0) return false;
        if (c === 1 && this.witness.get(k) === id) return false;
        return true;
    }
}

// Everything below runs O(pieces x local density) times on a dense stroke —
// upwards of a hundred thousand calls — so none of it allocates. An earlier
// version built a Set per grid query, an array per probe point and a throwaway
// segment object per distance test, and spent 99% of the total in exactly that
// churn rather than in any of the geometry.

/** Squared distance from a point to a raw segment given as origin + unit + length. */
function distSqToRaw(px, py, ax, ay, ux, uy, L) {
    let t = (px - ax) * ux + (py - ay) * uy;
    t = t < 0 ? 0 : (t > L ? L : t);
    const qx = ax + ux * t, qy = ay + uy * t;
    return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}

export function distSqToSeg(px, py, s) {
    return distSqToRaw(px, py, s.a[0], s.a[1], s.ux, s.uy, s.L);
}

/**
 * Squared distance between the piece's segment and capsule segment `s`, 0 if
 * they cross. The piece's own direction and length are passed in rather than
 * derived: this is called once per (piece, grid hit) pair — over half a million
 * times on a real-sized stroke — and recomputing the same hypot and division
 * every time was pure waste.
 */
function segSegDistSq(p0x, p0y, p1x, p1y, d1x, d1y, u1x, u1y, L1, s) {
    const d2x = s.b[0] - s.a[0], d2y = s.b[1] - s.a[1];
    const den = d1x * d2y - d1y * d2x;
    if (den > 1e-14 || den < -1e-14) {
        const ex = s.a[0] - p0x, ey = s.a[1] - p0y;
        const t = (ex * d2y - ey * d2x) / den, u = (ex * d1y - ey * d1x) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    }
    let m = distSqToSeg(p0x, p0y, s);
    let v = distSqToSeg(p1x, p1y, s); if (v < m) m = v;
    v = distSqToRaw(s.a[0], s.a[1], p0x, p0y, u1x, u1y, L1); if (v < m) m = v;
    v = distSqToRaw(s.b[0], s.b[1], p0x, p0y, u1x, u1y, L1); if (v < m) m = v;
    return m;
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------
export function segmentsOf(pts) {
    const out = [];
    // Two segments with the same endpoints — a stroke retraced exactly, which
    // a doubled-back gesture produces — have coincident capsules. Each then
    // covers the other's boundary EXACTLY, at distance r rather than inside it,
    // so neither trims the other and the whole boundary is emitted twice. Keep
    // one of each.
    const seen = new Set();
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (!(L > 0)) continue;
        const k = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
            ? a[0] + "," + a[1] + "|" + b[0] + "," + b[1]
            : b[0] + "," + b[1] + "|" + a[0] + "," + a[1];
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ a, b, ux: dx / L, uy: dy / L, L, id: out.length,
            x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]),
            y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
    }
    return out;
}

// A uniform grid over segments, for "what is near this point / box".
export class SegGrid {
    constructor(segs, r, cell) {
        this.cell = cell; this.map = new Map();
        // De-duplication by STAMP rather than by Set. A cell-overlap query hits
        // the same segment from several cells, and a dense stroke runs this
        // query once per boundary piece — building a Set of a few hundred, then
        // spreading it to an array, thousands of times over, dominated the
        // whole computation.
        this.stamp = new Int32Array(segs.length);
        this.tick = 0;
        for (const s of segs) {
            const i0 = Math.floor((Math.min(s.a[0], s.b[0]) - r) / cell), i1 = Math.floor((Math.max(s.a[0], s.b[0]) + r) / cell);
            const j0 = Math.floor((Math.min(s.a[1], s.b[1]) - r) / cell), j1 = Math.floor((Math.max(s.a[1], s.b[1]) + r) / cell);
            for (let j = j0; j <= j1; j++) {
                for (let i = i0; i <= i1; i++) {
                    const k = i * 8388608 + j;
                    let arr = this.map.get(k);
                    if (!arr) this.map.set(k, arr = []);
                    arr.push(s);
                }
            }
        }
    }
    /** Fill `out` (reused by the caller) with the distinct segments near the box. */
    nearInto(x0, y0, x1, y1, out) {
        const c = this.cell, t = ++this.tick, st = this.stamp;
        out.length = 0;
        for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
            for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
                const arr = this.map.get(i * 8388608 + j);
                if (!arr) continue;
                for (let k = 0; k < arr.length; k++) {
                    const s = arr[k];
                    if (st[s.id] === t) continue;
                    st[s.id] = t;
                    out.push(s);
                }
            }
        }
        return out;
    }
}

// ---------------------------------------------------------------------------
// The exact pass.
//
// For each candidate capsule, its boundary primitives are two offset lines and
// two cap circles. Split each at every crossing with a nearby capsule's
// boundary, then keep the sub-pieces whose midpoint is not strictly inside the
// union. Splitting then classifying is used rather than interval algebra
// because the classification is one robust predicate — distance to the path —
// where interval algebra needs a correct answer for every degenerate overlap.
// ---------------------------------------------------------------------------
export const TAU = Math.PI * 2;
const normAngle = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

/**
 * The parameter interval(s) of one piece covered by ONE capsule.
 *
 * This is what replaced splitting a piece at every crossing from every
 * neighbour and then classifying each sub-interval against every neighbour —
 * which is quadratic in the local density, and the local density IS the
 * coverage ratio, so it went quadratic exactly on the strokes that matter
 * (measured: 6.2 s on a real-sized scribble).
 *
 * A capsule is CONVEX, so a line or a circle meets it in one contiguous run,
 * and its boundary can only cross the piece a couple of times. Cutting at those
 * few crossings and testing each midpoint against THIS capsule alone is O(1)
 * per neighbour instead of O(neighbours), and the tangency problem disappears
 * on its own: a touch that used to need three probes to notice now yields a
 * degenerate interval from one neighbour and a real one from the next, and the
 * two merge.
 */
const _pt = [0, 0];        // scratch: `at` writes here, read immediately
export function coverRuns(cuts, lo, hi, at, o, lim, out) {
    // Insertion sort, not Array.prototype.sort. This runs once per (piece,
    // reaching capsule) pair — 170,000 times on a real-sized stroke — over at
    // most a handful of values, and at that size the comparator call overhead
    // is most of the cost of a general sort.
    const v = _cutBuf;
    let n = 0;
    v[n++] = lo; v[n++] = hi;
    for (let i = 0; i < cuts.length; i++) { const c = cuts[i]; if (c > lo && c < hi) v[n++] = c; }
    for (let i = 1; i < n; i++) {
        const x = v[i];
        let j = i - 1;
        while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
        v[j + 1] = x;
    }
    v.length = n;
    // `out` accumulates across every capsule, so only ever merge with a run
    // this call produced — the previous capsule's last run covers a different
    // part of the piece entirely, and merging into it invents coverage.
    const base = out.length;
    for (let i = 0; i < v.length - 1; i++) {
        const a = v[i], b = v[i + 1];
        if (!(b > a)) continue;
        at((a + b) / 2);
        if (distSqToSeg(_pt[0], _pt[1], o) >= lim) continue;
        const last = out.length > base ? out[out.length - 1] : null;
        if (last && last[1] >= a) last[1] = b; else out.push([a, b]);
    }
    return out;
}
const _cutBuf = [];
/**
 * Sort and merge `covers` in place; true once it spans [lo,hi] entirely.
 *
 * Most offset lines are FULLY buried — a candidate is a candidate because one
 * of its two sides is exposed, so the other side usually contributes nothing —
 * and testing it against a hundred more capsules after the first few have
 * already swallowed it is the bulk of the work on a dense stroke.
 */
export function mergeCovers(covers, lo, hi, tol) {
    if (!covers.length) return false;
    covers.sort(_asc0);
    let w = 0;
    for (let i = 1; i < covers.length; i++) {
        if (covers[i][0] <= covers[w][1] + tol) {
            if (covers[i][1] > covers[w][1]) covers[w][1] = covers[i][1];
        } else covers[++w] = covers[i];
    }
    covers.length = w + 1;
    return covers.length === 1 && covers[0][0] <= lo + tol && covers[0][1] >= hi - tol;
}
const _asc0 = (a, b) => a[0] - b[0];

/**
 * Where capsule `o`'s boundary crosses a LINE piece P(t) = (ax,ay) + (dx,dy)t.
 *
 * A capsule is convex, so the line meets it in ONE interval, and that interval's
 * ends lie on the capsule's boundary — which is two cap circles and two band
 * edges, nothing else. So these are all the cuts there are. (Unlike the circle
 * case below, the end planes are interior to the capsule and cannot bound the
 * interval, so they are not needed here.)
 *
 * Extracted so the incremental baker can trim an existing piece against a newly
 * arrived capsule using the identical math — see `bakeStrategies.js`.
 */
export function lineCutsInto(cuts, ax, ay, dx, dy, r, o) {
    for (const c of [o.a, o.b]) {                        // line vs cap circle
        const fx = ax - c[0], fy = ay - c[1];
        const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
        const D = B * B - 4 * A * C;
        if (D > 0) { const q = Math.sqrt(D); cuts.push((-B - q) / (2 * A), (-B + q) / (2 * A)); }
    }
    // line vs band edge. The band edge runs along o.u through o.a ± r·n, so the
    // crossing is where the piece meets that line: solve (P(t) − Q)·n = 0, i.e.
    // DOT products with the normal, not cross products. (Cross products here
    // silently return det = 0 for a piece PARALLEL to the other capsule's
    // normal — which is exactly a right-angle corner, so every corner went
    // untrimmed while straight runs looked fine.)
    const onx = -o.uy, ony = o.ux;
    const den = dx * onx + dy * ony;
    if (Math.abs(den) > 1e-14) {
        for (const g of [1, -1]) {
            const px = o.a[0] + onx * r * g, py = o.a[1] + ony * r * g;
            cuts.push(((px - ax) * onx + (py - ay) * ony) / den);
        }
    }
    return cuts;
}

/** Where capsule `o`'s boundary crosses the CAP CIRCLE of radius r about (cx,cy). */
export function arcCutsInto(cuts, cx, cy, r, o) {
    const onx = -o.uy, ony = o.ux;
    const push = (ang) => cuts.push(normAngle(ang));
    for (const q of [o.a, o.b]) {                        // circle vs cap circle
        const ddx = q[0] - cx, ddy = q[1] - cy, d = Math.hypot(ddx, ddy);
        if (d > 1e-12 && d < 2 * r) {
            const base = Math.atan2(ddy, ddx), half = Math.acos(d / (2 * r));
            push(base - half); push(base + half);
        }
    }
    const phiN = Math.atan2(ony, onx);
    for (const g of [1, -1]) {                           // circle vs band edge
        const perp = (o.a[0] + onx * r * g - cx) * onx + (o.a[1] + ony * r * g - cy) * ony;
        const v = perp / r;
        if (v > -1 && v < 1) { const d0 = Math.acos(v); push(phiN - d0); push(phiN + d0); }
    }
    // circle vs the capsule's END planes (q = 0 and q = L). These are where the
    // distance function hands over from the band to a cap, and for a cap circle
    // sitting ON its own segment's end they are the ONLY transition there — the
    // band edges are tangent to it, so without this a lone stroke's end caps come
    // out as whole circles and the stadium never closes.
    const phiU = Math.atan2(o.uy, o.ux);
    for (const e of [o.a, o.b]) {
        const k = (cx - e[0]) * o.ux + (cy - e[1]) * o.uy;
        const v2 = -k / r;
        if (v2 >= -1 && v2 <= 1) { const d1 = Math.acos(v2); push(phiU - d1); push(phiU + d1); }
    }
    return cuts;
}

/** [lo,hi] minus the covered runs. Runs that merely TOUCH leave no gap. */
export function freeRuns(lo, hi, covers, tol) {
    if (!covers.length) return [[lo, hi]];
    covers.sort((a, b) => a[0] - b[0]);
    const out = [];
    let cur = lo;
    for (const [a, b] of covers) {
        if (a > cur + tol) out.push([cur, a]);
        if (b > cur) cur = b;
        if (cur >= hi) break;
    }
    if (cur < hi - tol) out.push([cur, hi]);
    return out;
}

function boundaryPieces(candidates, r, grid, eps, crumb, cellSize) {
    const pieces = [];
    const lim = (r - eps) * (r - eps);
    const GAP = 1e-9;                 // runs closer than this are one run
    const near = [];                  // reused by every grid query
    const cuts = [];                  // reused by every capsule

    for (const s of candidates) {
        const nx = -s.uy, ny = s.ux;
        // --- the two offset lines ---
        for (const sgn of [1, -1]) {
            const ax = s.a[0] + nx * r * sgn, ay = s.a[1] + ny * r * sgn;
            const dx = s.ux * s.L, dy = s.uy * s.L;
            const at = (t) => { _pt[0] = ax + dx * t; _pt[1] = ay + dy * t; };
            // The grid answers with a BOX; keep only capsules that can really
            // reach this piece. No point of the piece is within r of `o` unless
            // the piece itself is within r of o's segment, so this is exact.
            const rr = r * r * (1 + 1e-9);
            const bx0 = Math.min(ax, ax + dx) - r, bx1 = Math.max(ax, ax + dx) + r;
            const by0 = Math.min(ay, ay + dy) - r, by1 = Math.max(ay, ay + dy) + r;
            grid.nearInto(bx0, by0, bx1, by1, near);
            const covers = [];
            let full = false, nextMerge = 8;
            for (let ni = 0; ni < near.length && !full; ni++) {
                const o = near[ni];
                if (o === s) continue;
                // Precise bbox reject before the real distance. The grid only
                // answers at CELL granularity, and two thirds of what it returns
                // cannot reach the piece at all.
                if (o.x1 < bx0 || o.x0 > bx1 || o.y1 < by0 || o.y0 > by1) continue;
                if (segSegDistSq(ax, ay, ax + dx, ay + dy, dx, dy, s.ux, s.uy, s.L, o) > rr) continue;
                cuts.length = 0;
                lineCutsInto(cuts, ax, ay, dx, dy, r, o);
                coverRuns(cuts, 0, 1, at, o, lim, covers);
                // Merge on a DOUBLING schedule, not every N capsules. The merge
                // sorts everything gathered so far, so running it at a fixed
                // interval makes the whole piece quadratic in its neighbour
                // count — measured at 330 of the 595 ms.
                if (covers.length >= nextMerge) {
                    full = mergeCovers(covers, 0, 1, GAP);
                    nextMerge = covers.length * 2 + 8;
                }
            }
            for (const [t0, t1] of freeRuns(0, 1, covers, GAP)) {
                // The +normal offset is walked BACKWARDS so the interior stays
                // on the left (see the stadium worked through above `stitch`).
                const [u0, u1] = sgn > 0 ? [t1, t0] : [t0, t1];
                pieces.push({ kind: "line", sx: ax + dx * u0, sy: ay + dy * u0,
                    ex: ax + dx * u1, ey: ay + dy * u1, owner: s.id, side: sgn, t0: u0, t1: u1 });
            }
        }
    }
    // --- the cap circles, ONE PER VERTEX ---
    // Adjacent segments share a vertex, so walking `[s.a, s.b]` per segment
    // emits every interior vertex's circle twice. Two identical pieces starting
    // at the same point make the stitcher pick one arbitrarily and orphan the
    // other, and the loops it builds are then neither closed nor consistently
    // wound — which reads as a shape whose interior leaks far outside the ink.
    const seenVert = new Set();
    for (const s of candidates) {
        for (const c of [s.a, s.b]) {
            const vk = c[0] + "," + c[1];
            if (seenVert.has(vk)) continue;
            seenVert.add(vk);
            // Cull the VERTEX, not just the segment that owns it. A segment is
            // a candidate because one of its sides is exposed, which says
            // nothing about its end caps — and a cap circle deep inside the ink
            // is the most expensive thing here, since its neighbourhood is a
            // disc of radius 2r rather than a thin band, and it never reaches
            // full coverage early enough to bail. Measured: cap circles were
            // 72,331 of the 79,685 trim tests and 437 of the 479 ms.
            let capExposed = false;
            const nA = Math.max(8, Math.ceil((TAU * r) / cellSize));
            for (let k = 0; k < nA; k++) {
                const A = (k / nA) * TAU;
                if (!crumb.coveredByOther(c[0] + r * Math.cos(A), c[1] + r * Math.sin(A), -1)) { capExposed = true; break; }
            }
            if (!capExposed) continue;
            const at = (a) => { _pt[0] = c[0] + r * Math.cos(a); _pt[1] = c[1] + r * Math.sin(a); };
            // Same exact filter: a point on this circle is r from c, so a
            // capsule further than 2r from c cannot reach any of it.
            const rr2 = 4 * r * r * (1 + 1e-9);
            grid.nearInto(c[0] - 2 * r, c[1] - 2 * r, c[0] + 2 * r, c[1] + 2 * r, near);
            const covers = [];
            let full = false, nextMerge = 8;
            for (let ni = 0; ni < near.length && !full; ni++) {
                const o = near[ni];
                if (distSqToSeg(c[0], c[1], o) > rr2) continue;
                cuts.length = 0;
                arcCutsInto(cuts, c[0], c[1], r, o);
                coverRuns(cuts, 0, TAU, at, o, lim, covers);
                if (covers.length >= nextMerge) {
                    full = mergeCovers(covers, 0, TAU, GAP);
                    nextMerge = covers.length * 2 + 8;
                }
            }
            for (const [a0, a1] of freeRuns(0, TAU, covers, GAP)) {
                pieces.push({ kind: "arc", cx: c[0], cy: c[1], r, a0, a1,
                    sx: c[0] + r * Math.cos(a0), sy: c[1] + r * Math.sin(a0),
                    ex: c[0] + r * Math.cos(a1), ey: c[1] + r * Math.sin(a1), owner: s.id });
            }
        }
    }
    return pieces;
}

// ---------------------------------------------------------------------------
// Stitching.
//
// Orientation, worked through on one stadium so the convention is checkable:
// segment A=(0,0) -> B=(1,0), r=1, u=(1,0), n=perp(u)=(0,1). Walking the
// boundary counter-clockwise with the interior on the LEFT gives
// (0,-1)->(1,-1) [the -n line, along +u], the cap arc round B, (1,1)->(0,1)
// [the +n line, along -u], then the cap arc round A. So the -n offset runs
// forwards and the +n offset runs backwards, which is what `reverse` does.
// Outer loops then come out counter-clockwise and holes clockwise, so the
// signed area tells them apart with no point-in-polygon test.
// ---------------------------------------------------------------------------
export function stitch(pieces, tol) {
    // A junction's coordinates are computed twice, once from each of the two
    // primitives that meet there — an acos on one side, a quadratic on the
    // other — so they agree only to a few ULP. Hashing on a rounded key alone
    // therefore separates them whenever the pair happens to straddle a bucket
    // boundary, which is how a loop ends up one piece short of closing. Bucket
    // coarsely and search the 3x3 neighbourhood.
    const cell = Math.max(tol * 8, 1e-12);
    const buckets = new Map();
    const bk = (i, j) => i * 8388608 + j;
    for (const p of pieces) {
        const k = bk(Math.floor(p.sx / cell), Math.floor(p.sy / cell));
        let a = buckets.get(k); if (!a) buckets.set(k, a = []);
        a.push(p);
    }
    const tol2 = tol * tol;
    const findNext = (x, y, used) => {
        const i0 = Math.floor(x / cell), j0 = Math.floor(y / cell);
        let best = Infinity, out = null;
        for (let j = j0 - 1; j <= j0 + 1; j++) {
            for (let i = i0 - 1; i <= i0 + 1; i++) {
                const arr = buckets.get(bk(i, j));
                if (!arr) continue;
                for (const c of arr) {
                    if (used.has(c)) continue;
                    const d = (c.sx - x) * (c.sx - x) + (c.sy - y) * (c.sy - y);
                    if (d <= tol2 && d < best) { best = d; out = c; }
                }
            }
        }
        return out;
    };
    const loops = [];
    const used = new Set();
    for (const seed of pieces) {
        if (used.has(seed)) continue;
        const loop = [];
        let cur = seed, guard = 0;
        while (cur && !used.has(cur) && guard++ < pieces.length + 4) {
            used.add(cur); loop.push(cur);
            cur = findNext(cur.ex, cur.ey, used);
        }
        // A chain that does not return to where it started is not a loop. It
        // means a piece is missing, and treating it as one would leave an open
        // contour that fills as a garbage half-plane. Better to drop it and let
        // the area/membership tests report the loss than to paint nonsense.
        const first = loop[0], last = loop[loop.length - 1];
        const closes = (last.ex - first.sx) ** 2 + (last.ey - first.sy) ** 2 <= tol2;
        if (closes) loops.push(loop);
        else { loops.push(loop); loop.open = true; }
    }
    return loops;
}

export function loopArea(loop) {
    // Shoelace over the piece endpoints, plus each arc's circular segment. The
    // chord polygon alone under-reads a loop that is mostly cap arcs, which for
    // a short thick stroke is nearly all of it.
    let a = 0;
    for (const p of loop) a += p.sx * p.ey - p.ex * p.sy;
    a /= 2;
    for (const p of loop) {
        if (p.kind !== "arc") continue;
        let d = p.a1 - p.a0;
        while (d <= -1e-12) d += TAU;
        a += (p.r * p.r / 2) * (d - Math.sin(d));
    }
    return a;
}

// ---------------------------------------------------------------------------
/**
 * Replace points that are within `tol` of each other with a single shared
 * instance. Two DISTINCT vertices at essentially the same place each emit a cap
 * circle, and those circles cover each other everywhere except exactly on the
 * boundary — so neither trims the other and both leave slivers. A closed ring
 * hits this every time: `cos(2pi)` lands on 1 but `sin(2pi)` lands on -2.4e-16,
 * so the path's last point misses its first by 2e-14 and the seam never heals.
 * Buckets are searched 3x3, since a rounded key alone splits pairs that
 * straddle a boundary — the same trap as the stitcher.
 */
function snapPoints(pts, tol) {
    const cell = Math.max(tol * 4, Number.MIN_VALUE);
    const buckets = new Map();
    const bk = (i, j) => i * 8388608 + j;
    const tol2 = tol * tol;
    return pts.map((p) => {
        const i0 = Math.floor(p[0] / cell), j0 = Math.floor(p[1] / cell);
        for (let j = j0 - 1; j <= j0 + 1; j++) {
            for (let i = i0 - 1; i <= i0 + 1; i++) {
                const arr = buckets.get(bk(i, j));
                if (!arr) continue;
                for (const q of arr) {
                    if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= tol2) return q;
                }
            }
        }
        const k = bk(i0, j0);
        let arr = buckets.get(k); if (!arr) buckets.set(k, arr = []);
        arr.push(p);
        return p;
    });
}

export function strokeShape(pts, width, opts = {}) {
    const r = width / 2;
    if (!(r > 0) || !pts || pts.length < 1) return { loops: [], stats: {} };
    const segs = segmentsOf(snapPoints(pts, r * (opts.snapTol || 1e-9)));
    if (!segs.length) {
        // A single point paints one disc.
        const c = pts[0];
        return { loops: [[{ kind: "arc", cx: c[0], cy: c[1], r, a0: 0, a1: TAU,
            sx: c[0] + r, sy: c[1], ex: c[0] + r, ey: c[1], owner: -1 }]], stats: { segs: 0, candidates: 0 } };
    }
    const eps = (opts.eps != null ? opts.eps : 1e-9) * r;
    const cellSize = opts.cellSize || r / 2;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const ms = {};
    let t0 = now();

    const crumb = opts.crumb || (() => {
        const cr = new Crumb(cellSize);
        for (const s of segs) cr.add(s, r, s.id);
        return cr;
    })();
    ms.crumb = +(now() - t0).toFixed(1); t0 = now();

    // --- cull: probe each capsule's own boundary against the crumb ---
    const candidates = [];
    for (const s of segs) {
        const nx = -s.uy, ny = s.ux;
        let exposed = false;
        const steps = Math.max(2, Math.ceil(s.L / cellSize));
        outer:
        for (const sgn of [1, -1]) {
            for (let k = 0; k <= steps; k++) {
                const t = (k / steps) * s.L;
                if (!crumb.coveredByOther(s.a[0] + s.ux * t + nx * r * sgn,
                    s.a[1] + s.uy * t + ny * r * sgn, s.id)) { exposed = true; break outer; }
            }
        }
        if (!exposed) {
            const na = Math.max(8, Math.ceil((TAU * r) / cellSize));
            capLoop:
            for (const c of [s.a, s.b]) {
                for (let k = 0; k < na; k++) {
                    const A = (k / na) * TAU;
                    if (!crumb.coveredByOther(c[0] + r * Math.cos(A), c[1] + r * Math.sin(A), s.id)) {
                        exposed = true; break capLoop;
                    }
                }
            }
        }
        if (exposed) candidates.push(s);
    }
    ms.cull = +(now() - t0).toFixed(1); t0 = now();

    // Produce from candidates; trim against EVERYTHING (see the header).
    const grid = new SegGrid(segs, r, Math.max(r, cellSize));
    ms.grid = +(now() - t0).toFixed(1); t0 = now();
    const pieces = boundaryPieces(candidates, r, grid, eps, crumb, cellSize);
    ms.boundary = +(now() - t0).toFixed(1); t0 = now();
    let loops = stitch(pieces, r * (opts.stitchTol || 1e-7));
    ms.stitch = +(now() - t0).toFixed(1);

    const minArea = opts.minLoopArea != null ? opts.minLoopArea : 0;
    if (minArea > 0) loops = loops.filter((l) => Math.abs(loopArea(l)) >= minArea);

    return { loops, stats: { segs: segs.length, candidates: candidates.length, pieces: pieces.length, ms } };
}
