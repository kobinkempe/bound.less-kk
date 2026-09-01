// ========================= ORACLE ONLY, NOT PRODUCTION =====================
// The cubic-pipeline perimeter resolve. Superseded by `geometry/arcPerimeter.js`
// (F21: exact offsets, closed-form crossings, 3.3-3.8x faster, 0 open chains).
// Reachable only through `bakeStrategies` — i.e. from the dev labs and from the
// tests that cross-check the arc bake against a second implementation.
// ===========================================================================

/**
 * curvePerimeter.js — a stroke's painted footprint as ONE resolved perimeter,
 * built from CURVES, so it never creases.
 *
 * WHY THIS EXISTS AND `strokeShape.js` DOES NOT SUFFICE
 *
 * `strokeShape` chords the centerline and takes the Minkowski sum with a disc.
 * That is exact *for the polyline*, and the polyline is not the stroke. On the
 * inside of every bend two offset lines meet at an angle of roughly
 * sqrt(8·tol / R) — and an angle does not shrink when you zoom in. Measured on a
 * tight bend (R = 250) flattened at a quarter unit: 5.1 degrees, identically at
 * 1x, 30x and 900x, and it survives every level crossing because the crease is
 * baked into the stored shape. See docs/OPEN-FLAGS.md F1.
 *
 * Kobin's rule: the perimeter must have no creases. A straight line is allowed
 * only where the piece being baked genuinely IS straight at the tolerance in
 * play. `curveOutline.js` already obeys that rule — `chordDeviation(c) <=
 * lineTol` is its only line-emitting path, and it groups tangent-continuous
 * pieces into runs so joins inside a run are smooth by construction. What it
 * does not do is resolve its overlapping capsule loops into a single outline,
 * because rendering never needed one: nonzero fill composites them. That last
 * step is this file.
 *
 * SO THE OFFSET IS NOT RECOMPUTED HERE. `strokeOutlineCurves` produces the
 * offset cubics; everything below only cuts them up and throws away the buried
 * parts. Every piece that comes out is a sub-interval of a curve that went in,
 * so whatever smoothness the offset had is preserved exactly.
 *
 * THE TWO JOBS, AND WHY THEY USE DIFFERENT MACHINERY
 *
 *   CUTTING — where does one offset curve cross another? Done by genuine
 *     cubic-cubic intersection (recursive subdivision on control hulls). It has
 *     to be genuine: the two pieces meeting at a junction must be cut at the
 *     SAME point, or the stitched loop has a gap there. Precision here is
 *     structural, not cosmetic.
 *
 *   CLASSIFYING — is this sub-piece buried? Done by distance to the centerline,
 *     because the union of all the capsules is exactly {p : dist(p, C) <= r} and
 *     that is far cheaper than point-in-loop against a thousand loops. Precision
 *     here barely matters: the test runs at a sub-piece's MIDPOINT, which sits
 *     well away from any boundary by construction, so a coarse distance oracle
 *     gives the same answer as an exact one.
 *
 * That split is what keeps it affordable. It is also the mistake `strokeShape`
 * made in the other direction — it used one mechanism for both and paid exact
 * prices for approximate needs.
 *
 * TANGENCY. Consecutive offset pieces touch their neighbours' capsules at
 * distance exactly r, all along their shared end. Testing "is dist < r" there is
 * a coin flip on floating point, and it deletes real boundary. So burial is
 * STRICT: a sub-piece dies only if its midpoint is inside by a margin. Adjacent
 * pieces then survive by construction, which is the "trim or join ADJACENT
 * offsets" phase of the classic three-phase offset algorithm that `strokeShape`
 * skipped entirely (INRIA; see docs/perimeter-bake-options.md §1).
 */
import { cubicAt, cubicTangent, splitCubic, chordDeviation, lineCubic,
    fitOffset, capArcs, circleLoop } from "../geometry/curveOutline";
import { controlsFor } from "../geometry/polyline";
import { Crumb, coverRuns, mergeCovers, freeRuns } from "./strokeShape";

// ---------------------------------------------------------------------------
// centerline
// ---------------------------------------------------------------------------

/** The exact Two.js spline through `pts`, as absolute cubics. */
export function centerlineCubics(pts, curved = true) {
    const out = [];
    if (!pts || pts.length < 2) return out;
    if (!curved || pts.length === 2) {
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            out.push([[a[0], a[1]], [a[0], a[1]], [b[0], b[1]], [b[0], b[1]]]);
        }
        return out;
    }
    const n = pts.length, last = n - 1, ctrl = new Array(n);
    for (let i = 0; i < n; i++) ctrl[i] = controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, last)]);
    for (let i = 1; i < n; i++) out.push([pts[i - 1], ctrl[i - 1].right, ctrl[i].left, pts[i]]);
    return out;
}

export const bboxOf = (c) => {
    let x0 = c[0][0], x1 = x0, y0 = c[0][1], y1 = y0;
    for (let i = 1; i < 4; i++) {
        const x = c[i][0], y = c[i][1];
        if (x < x0) x0 = x; else if (x > x1) x1 = x;
        if (y < y0) y0 = y; else if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];   // control hull bbox — contains the curve
};

/**
 * The centerline as a distance oracle: each cubic flattened just far enough that
 * a point-to-polyline distance is within `tol` of the truth.
 *
 * This polyline is NEVER emitted. It only answers "is this midpoint buried",
 * where the answer is the same for any tol well under r. Flattening for the
 * oracle costs nothing structural — the creases in F1 came from flattening the
 * thing that gets DRAWN.
 */
class DistOracle {
    constructor(cubics, r, tol) {
        this.r = r;
        this.tol = tol;
        this.segs = [];        // {ax,ay,ux,uy,L,piece,s0}
        this.cell = Math.max(r, 1e-9);
        this.map = new Map();
        for (let pi = 0; pi < (cubics ? cubics.length : 0); pi++) {
            this._flatten(cubics[pi], tol, pi);
        }
        for (let i = 0; i < this.segs.length; i++) this._index(i);
    }
    /**
     * Extend with one more centerline cubic — for the bakers that build the
     * oracle while the pen is down. Sound because ink is monotone: nothing
     * already recorded can stop being true when more of the stroke arrives.
     */
    addCubic(c, piece) {
        const from = this.segs.length;
        this._flatten(c, this.tol, piece);
        for (let i = from; i < this.segs.length; i++) this._index(i);
    }
    _flatten(c, tol, piece, depth = 0) {
        // Deviation of the control points from the chord bounds the curve's own.
        const dx = c[3][0] - c[0][0], dy = c[3][1] - c[0][1];
        const L2 = dx * dx + dy * dy;
        let flat;
        if (L2 > tol * tol) {
            const d1 = Math.abs((c[1][0] - c[0][0]) * dy - (c[1][1] - c[0][1]) * dx);
            const d2 = Math.abs((c[2][0] - c[0][0]) * dy - (c[2][1] - c[0][1]) * dx);
            flat = (d1 + d2) * (d1 + d2) <= (16 / 9) * tol * tol * L2;
        } else {
            flat = Math.max(Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]),
                            Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1])) <= tol;
        }
        if (flat || depth > 18) {
            const L = Math.sqrt(L2);
            if (L > 0) {
                this.segs.push({ ax: c[0][0], ay: c[0][1], ux: dx / L, uy: dy / L, L, piece });
            }
            return;
        }
        const [a, b] = splitCubic(c, 0.5);
        this._flatten(a, tol, piece, depth + 1);
        this._flatten(b, tol, piece, depth + 1);
    }
    _index(i) {
        const s = this.segs[i], c = this.cell, r = this.r;
        const x0 = Math.min(s.ax, s.ax + s.ux * s.L) - r, x1 = Math.max(s.ax, s.ax + s.ux * s.L) + r;
        const y0 = Math.min(s.ay, s.ay + s.uy * s.L) - r, y1 = Math.max(s.ay, s.ay + s.uy * s.L) + r;
        for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
            for (let k = Math.floor(x0 / c); k <= Math.floor(x1 / c); k++) {
                const key = k * 8388608 + j;
                let arr = this.map.get(key);
                if (!arr) this.map.set(key, arr = []);
                arr.push(i);
            }
        }
    }
    /**
     * True if (x,y) is inside the ink by more than `margin`.
     *
     * A pure function of POSITION — no part of the centerline is excluded. See
     * the note on `arcPadFor`: excluding a window around the tested piece's own
     * generator made the predicate differ between neighbouring pieces of one
     * chain, and that is what F15 was.
     */
    buried(x, y, margin) {
        // The oracle's chords lie INSIDE the true curve by up to `tol`, so a
        // distance measured against them under-reads by that much. Subtract it,
        // making burial conservative: nothing is ever declared buried that is not
        // genuinely inside. Getting this wrong is not a rounding matter — with
        // tol = r/64 and margin = fitTol the under-read is ~35x the margin, so
        // every rail reads as buried by its own neighbourhood and the perimeter
        // dissolves. Over-inclusion just leaves a little extra for the cut step.
        const eff = Math.max(0, this.r - margin - this.tol);
        const lim = eff * eff;
        const arr = this.map.get(Math.floor(x / this.cell) * 8388608 + Math.floor(y / this.cell));
        if (!arr) return false;
        for (let n = 0; n < arr.length; n++) {
            const s = this.segs[arr[n]];
            let t = (x - s.ax) * s.ux + (y - s.ay) * s.uy;
            t = t < 0 ? 0 : (t > s.L ? s.L : t);
            const qx = x - (s.ax + s.ux * t), qy = y - (s.ay + s.uy * t);
            if (qx * qx + qy * qy < lim) return true;
        }
        return false;
    }
}

// ---------------------------------------------------------------------------
// cubic-cubic intersection, by recursive subdivision on control hulls
//
// A cubic lies inside the convex hull of its control points, so two cubics whose
// hull BBOXES miss cannot cross. Halve both, recurse on the four pairs, and the
// surviving boxes converge on the crossings. No polynomial solving, no root
// isolation, and it degrades gracefully on tangential and overlapping input —
// which matters here because offset curves of the same stroke are frequently
// near-tangent to each other.
// ---------------------------------------------------------------------------
const ISECT_DEPTH = 26;

function hullsMiss(a, b, pad) {
    const A = bboxOf(a), B = bboxOf(b);
    return A[0] > B[2] + pad || B[0] > A[2] + pad || A[1] > B[3] + pad || B[1] > A[3] + pad;
}

function isectInto(a, b, ta0, ta1, tb0, tb1, tol, out, depth) {
    if (hullsMiss(a, b, 0)) return;
    const A = bboxOf(a), B = bboxOf(b);
    const smallA = (A[2] - A[0]) <= tol && (A[3] - A[1]) <= tol;
    const smallB = (B[2] - B[0]) <= tol && (B[3] - B[1]) <= tol;
    if ((smallA && smallB) || depth >= ISECT_DEPTH) {
        out.push([(ta0 + ta1) / 2, (tb0 + tb1) / 2]);
        return;
    }
    const am = (ta0 + ta1) / 2, bm = (tb0 + tb1) / 2;
    if (smallA) {
        const [b0, b1] = splitCubic(b, 0.5);
        isectInto(a, b0, ta0, ta1, tb0, bm, tol, out, depth + 1);
        isectInto(a, b1, ta0, ta1, bm, tb1, tol, out, depth + 1);
        return;
    }
    if (smallB) {
        const [a0, a1] = splitCubic(a, 0.5);
        isectInto(a0, b, ta0, am, tb0, tb1, tol, out, depth + 1);
        isectInto(a1, b, am, ta1, tb0, tb1, tol, out, depth + 1);
        return;
    }
    const [a0, a1] = splitCubic(a, 0.5), [b0, b1] = splitCubic(b, 0.5);
    isectInto(a0, b0, ta0, am, tb0, bm, tol, out, depth + 1);
    isectInto(a0, b1, ta0, am, bm, tb1, tol, out, depth + 1);
    isectInto(a1, b0, am, ta1, tb0, bm, tol, out, depth + 1);
    isectInto(a1, b1, am, ta1, bm, tb1, tol, out, depth + 1);
}

/** The unnormalised derivative of a cubic — Newton needs the magnitude. */
function cubicDeriv(c, t) {
    const s = 1 - t;
    return [3 * s * s * (c[1][0] - c[0][0]) + 6 * s * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]),
            3 * s * s * (c[1][1] - c[0][1]) + 6 * s * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1])];
}

/**
 * Drive a bracketed crossing onto the true one, so BOTH parameters name the
 * SAME POINT.
 *
 * Subdivision returns the centre of the last surviving box, and its two halves
 * are centres of DIFFERENT boxes — one on each curve. For a transversal
 * crossing they are close; for a shallow one the surviving box is long and thin
 * and the two centres land far apart. Measured: one crossing reported at two
 * positions 0.05 apart on a tight wiggle and 1.10 apart on a drawn ring, both
 * well over the stitcher's welding tolerance, so the two pieces cut there never
 * joined and the loop was left open. That is F15.
 *
 * Newton on a(ta) - b(tb) = 0 converges quadratically wherever the crossing is
 * transversal, which is where the Jacobian [a'(ta) | -b'(tb)] is non-singular —
 * exactly the same condition. Two or three steps take the disagreement to
 * rounding. Where it IS singular the curves are tangent, Newton is abandoned,
 * and the shared-vertex registry downstream still gives them one endpoint.
 */
function polishIsect(a, b, ta, tb) {
    let bta = ta, btb = tb, bestErr = Infinity;
    for (let it = 0; it < 24; it++) {
        const pa = cubicAt(a, ta), pb = cubicAt(b, tb);
        const fx = pa[0] - pb[0], fy = pa[1] - pb[1];
        const err = Math.abs(fx) + Math.abs(fy);
        if (err < bestErr) { bestErr = err; bta = ta; btb = tb; }
        if (err <= 1e-12 * (1 + Math.abs(pa[0]) + Math.abs(pa[1]))) break;
        const da = cubicDeriv(a, ta), db = cubicDeriv(b, tb);
        const det = db[0] * da[1] - da[0] * db[1];
        if (!(Math.abs(det) > 1e-300)) break;
        const nta = ta + (fx * db[1] - db[0] * fy) / det;
        const ntb = tb + (fx * da[1] - da[0] * fy) / det;
        // A step that leaves the piece is not a crossing of THIS piece; a step
        // that runs away is a singular Jacobian dressed up as a big number.
        if (!(nta >= -1e-6 && nta <= 1 + 1e-6 && ntb >= -1e-6 && ntb <= 1 + 1e-6)) break;
        ta = nta < 0 ? 0 : (nta > 1 ? 1 : nta);
        tb = ntb < 0 ? 0 : (ntb > 1 ? 1 : ntb);
    }
    return [bta, btb];
}

/**
 * Parameter pairs where cubics `a` and `b` cross, to within `tol` in space.
 *
 * Near-tangent pairs produce a cluster of boxes rather than one; they are merged
 * by parameter proximity. A cluster left unmerged would cut a piece into slivers
 * whose midpoints all classify the same way — harmless but wasteful — so this is
 * a performance guard, not a correctness one.
 */
export function cubicIntersections(a, b, tol) {
    const found = [];
    isectInto(a, b, 0, 1, 0, 1, tol, found, 0);
    if (!found.length) return found;
    found.sort((p, q) => p[0] - q[0]);
    // THIN OUT BEFORE POLISHING. A tangential approach answers subdivision with a
    // cloud of boxes — measured at 1,710 for 206 pair tests — and they all
    // converge on the same crossing, so polishing each is the same answer paid
    // for over and over. Coarse-merging first cut the resolve of a drawn ring
    // from 225 ms to a fraction of it. The threshold here only has to be tight
    // enough not to merge two genuinely distinct crossings; the exact merge
    // happens below, on polished points.
    const coarse = Math.max(tol, 1e-12);
    const cand = [];
    let lx = 0, ly = 0;
    for (const hit of found) {
        const p = cubicAt(a, hit[0]);
        if (cand.length) {
            const dx = p[0] - lx, dy = p[1] - ly;
            if (dx * dx + dy * dy <= coarse * coarse) continue;
        }
        cand.push(hit); lx = p[0]; ly = p[1];
    }
    const raw = cand.map((h) => polishIsect(a, b, h[0], h[1]));
    if (raw.length < 2) return raw;
    raw.sort((p, q) => p[0] - q[0]);
    // Merge by POSITION, not by parameter.
    //
    // Two offset curves of the same stroke are frequently near-tangent, and
    // subdivision answers a tangential approach with a cloud of boxes spread
    // over a real span of parameter — not a tight cluster. A parameter-space
    // epsilon therefore keeps them all, and each phantom crossing cuts both
    // curves again: measured 1,710 cuts from 206 pair tests, which shattered the
    // perimeter into slivers and left seven open junk loops.
    //
    // Merging on distance along the curve collapses each approach to the single
    // crossing it really is. The threshold is generous on purpose — the cost of
    // over-merging is a slightly misplaced cut, the cost of under-merging is a
    // broken loop.
    // Polished hits from one crossing land on the SAME point to rounding, so the
    // threshold no longer has to be generous enough to swallow a whole tangential
    // approach — and it must not be, or two genuine crossings that pass close
    // get collapsed into one and the piece between them is never cut.
    const merge = Math.max(tol, 1e-12);
    const out = [], last = [];
    for (const hit of raw) {
        const p = cubicAt(a, hit[0]);
        if (out.length) {
            const dx = p[0] - last[0], dy = p[1] - last[1];
            if (dx * dx + dy * dy <= merge * merge) continue;
        }
        out.push(hit);
        last[0] = p[0]; last[1] = p[1];
    }
    return out;
}

/**
 * The crossings, as points both pieces AGREE on.
 *
 * A cut is not a parameter, it is a place where two boundary curves meet, and
 * the two pieces that leave that place must start from the identical coordinate
 * — not a nearby one. Registering the crossing here and handing the SAME array
 * to both sides makes the junction watertight by construction instead of by
 * tolerance, so the stitcher never has to decide whether two ends are "close
 * enough". Three curves through one point collapse to one vertex for free.
 */
export class VertexSet {
    constructor(tol) {
        this.tol = tol; this.cell = Math.max(tol * 2, Number.MIN_VALUE);
        this.map = new Map(); this.list = [];
    }
    at(x, y) {
        const i0 = Math.floor(x / this.cell), j0 = Math.floor(y / this.cell), t2 = this.tol * this.tol;
        for (let j = j0 - 1; j <= j0 + 1; j++) {
            for (let i = i0 - 1; i <= i0 + 1; i++) {
                const arr = this.map.get(i * 8388608 + j);
                if (!arr) continue;
                for (const v of arr) {
                    const dx = v[0] - x, dy = v[1] - y;
                    if (dx * dx + dy * dy <= t2) return v;
                }
            }
        }
        const v = [x, y];
        const k = i0 * 8388608 + j0;
        let arr = this.map.get(k); if (!arr) this.map.set(k, arr = []);
        arr.push(v); this.list.push(v);
        return v;
    }
}

// ---------------------------------------------------------------------------
// stitching
// ---------------------------------------------------------------------------

/**
 * Chain surviving pieces end-to-end into closed loops.
 *
 * Junction coordinates are computed twice — once from each of the two pieces
 * that meet there — and agree only to a few ULP, so hashing on a rounded key
 * alone splits pairs that straddle a bucket boundary. Search a 3x3
 * neighbourhood. (`strokeShape` learned this the hard way; bug 4 in
 * docs/HANDOFF-strokeShape.md §4.)
 */
export function stitchCubics(pieces, tol, repairTol = 0) {
    // Build a planar graph FIRST, then walk it.
    //
    // The endpoints of two pieces that meet at a crossing are evaluated on two
    // different curves, so they agree only to the intersection tolerance. Walking
    // by "find something whose start is near my end" therefore misses partners,
    // the chain dies, and the loop gets force-closed — which invents a straight
    // edge right across the shape. That is what a drawn stroke looked like:
    // solid wedges bounded by long straight lines converging on a self-crossing,
    // and 23 loops where there should be two.
    //
    // Snapping every endpoint to a shared vertex removes the question. After
    // this, every piece end IS a vertex, and every vertex knows exactly which
    // pieces leave it.
    const cell = Math.max(tol * 2, Number.MIN_VALUE);
    const vmap = new Map();          // cell key -> vertex ids
    const verts = [];                // id -> [x, y]
    const key = (i, j) => i * 8388608 + j;
    const tol2 = tol * tol;
    const vertexAt = (p) => {
        const i0 = Math.floor(p[0] / cell), j0 = Math.floor(p[1] / cell);
        for (let j = j0 - 1; j <= j0 + 1; j++) {
            for (let i = i0 - 1; i <= i0 + 1; i++) {
                const arr = vmap.get(key(i, j));
                if (!arr) continue;
                for (const id of arr) {
                    const q = verts[id];
                    if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= tol2) return id;
                }
            }
        }
        const id = verts.length;
        verts.push([p[0], p[1]]);
        const k = key(i0, j0);
        let arr = vmap.get(k); if (!arr) vmap.set(k, arr = []);
        arr.push(id);
        return id;
    };

    const n = pieces.length;
    const vFrom = new Int32Array(n), vTo = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        vFrom[i] = vertexAt(pieces[i].c[0]);
        vTo[i] = vertexAt(pieces[i].c[3]);
    }
    // BALANCE THE DEGREES, AND EVERY LOOP CLOSES BY CONSTRUCTION.
    //
    // A greedy walk on a directed graph where every vertex has in-degree equal to
    // out-degree can only ever get stuck back at its own start — each time it
    // arrives somewhere it has used one more edge in than out, so an unused
    // departure must exist. So closure is not a property of how cleverly the walk
    // chooses; it is a property of the degrees. Every open chain this ever
    // produced was an unbalanced vertex upstream.
    //
    // Unbalance means classification kept a piece whose partner across a junction
    // it dropped, and it is decided by a burial test whose uncertainty is the
    // fitted offset's error plus the oracle's — hundredths of a unit. The damage
    // is not proportional: an unclosed chain gets painted shut with a straight
    // line clean across the shape, so a 0.05-unit misjudgement became a 430-unit
    // fabricated edge. That was the wedge in Kobin's drawing.
    //
    // Unbalanced vertices come in +1/-1 pairs sitting essentially on top of each
    // other. Welding each pair restores balance and moves an endpoint by the gap,
    // which is bounded by `repairTol` and only ever happens AT a junction, where
    // the union genuinely has a corner. Nothing smooth is bent.
    let repairs = 0, worstRepair = 0;
    if (repairTol > 0) {
        const nv = verts.length;
        const din = new Int32Array(nv), dout = new Int32Array(nv);
        for (let i = 0; i < n; i++) { dout[vFrom[i]]++; din[vTo[i]]++; }
        const src = [], snk = [];
        for (let v = 0; v < nv; v++) {
            for (let e = din[v]; e < dout[v]; e++) src.push(v);
            for (let e = dout[v]; e < din[v]; e++) snk.push(v);
        }
        if (src.length && snk.length) {
            const cand = [];
            for (const a of src) {
                for (const b of snk) {
                    if (a === b) continue;
                    const d = Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1]);
                    if (d <= repairTol) cand.push([d, a, b]);
                }
            }
            cand.sort((x, y) => x[0] - y[0]);
            const parent = new Int32Array(nv);
            for (let i = 0; i < nv; i++) parent[i] = i;
            const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
            const usedA = new Map(), usedB = new Map();
            const room = (m, v, cap) => (m.get(v) || 0) < cap;
            for (const [d, a, b] of cand) {
                if (!room(usedA, a, dout[a] - din[a]) || !room(usedB, b, din[b] - dout[b])) continue;
                usedA.set(a, (usedA.get(a) || 0) + 1);
                usedB.set(b, (usedB.get(b) || 0) + 1);
                const ra = find(a), rb = find(b);
                if (ra === rb) continue;
                parent[rb] = ra;
                const mx = (verts[a][0] + verts[b][0]) / 2, my = (verts[a][1] + verts[b][1]) / 2;
                verts[a][0] = mx; verts[a][1] = my;
                verts[b][0] = mx; verts[b][1] = my;
                repairs++; worstRepair = Math.max(worstRepair, d);
            }
            if (repairs) for (let i = 0; i < n; i++) { vFrom[i] = find(vFrom[i]); vTo[i] = find(vTo[i]); }
        }
    }

    // Move the endpoints onto their vertices so the result is watertight.
    for (let i = 0; i < n; i++) {
        const c = pieces[i].c, a0 = verts[vFrom[i]], b0 = verts[vTo[i]];
        c[0] = [a0[0], a0[1]];
        c[3] = [b0[0], b0[1]];
    }
    const out = new Map();           // vertex id -> piece indices leaving it
    for (let i = 0; i < n; i++) {
        let arr = out.get(vFrom[i]);
        if (!arr) out.set(vFrom[i], arr = []);
        arr.push(i);
    }
    stitchCubics.lastRepairs = repairs;
    stitchCubics.lastWorstRepair = worstRepair;

    // PAIR THE EDGE-ENDS AT EACH VERTEX, THEN JUST FOLLOW THE PAIRING.
    //
    // The old walk chose, at each vertex, the most clockwise departure that was
    // still UNUSED. That turn rule is the right one, but "still unused" makes the
    // answer depend on which piece the walk happened to start from: at a junction
    // where several strands meet, an earlier loop can take the piece a later one
    // needed. It is why the same geometry could come out as different loops
    // depending only on the order the pieces were handed over, which is exactly
    // how the incremental schedule and the batch one disagreed while both had the
    // same boundary.
    //
    // Doing the pairing FIRST removes the choice. Every piece has exactly one end
    // arriving at a vertex and one leaving one, and a balanced vertex has as many
    // of each, so the pairing is a bijection on pieces — its cycles ARE the loops,
    // every piece is used exactly once, and every cycle is closed. No traversal
    // order exists for the result to depend on.
    //
    // The rule itself is unchanged: from the reversed incoming direction, take the
    // first departure going clockwise. Sweeping the ends clockwise and matching
    // each departure to the most recently seen arrival gives every arrival its
    // first clockwise departure, with each departure claimed once.
    const dirOut = (i) => cubicTangent(pieces[i].c, 0)
        || [pieces[i].c[3][0] - pieces[i].c[0][0], pieces[i].c[3][1] - pieces[i].c[0][1]];
    const dirIn = (i) => {
        const t = cubicTangent(pieces[i].c, 1)
            || [pieces[i].c[3][0] - pieces[i].c[0][0], pieces[i].c[3][1] - pieces[i].c[0][1]];
        return [-t[0], -t[1]];                 // point AWAY from the vertex
    };
    const arrive = new Map();                  // vertex -> piece indices ending there
    for (let i = 0; i < n; i++) {
        let arr = arrive.get(vTo[i]);
        if (!arr) arrive.set(vTo[i], arr = []);
        arr.push(i);
    }
    const next = new Int32Array(n).fill(-1);
    for (const [v, ins] of arrive) {
        const outs = out.get(v) || [];
        // Almost every vertex is a plain join: one piece in, one piece out, no
        // choice to make. Taking it without building the angular sweep keeps the
        // stitcher linear in practice rather than linear-with-a-sort-and-a-Set.
        if (ins.length === 1 && outs.length === 1) { next[ins[0]] = outs[0]; continue; }
        const ends = [];
        for (const i of ins) { const d = dirIn(i); ends.push({ a: Math.atan2(d[1], d[0]), i, kind: 1 }); }
        for (const j of outs) { const d = dirOut(j); ends.push({ a: Math.atan2(d[1], d[0]), i: j, kind: 0 }); }
        // Sorted counter-clockwise; walked in reverse, which is clockwise. An
        // arrival and a departure at the SAME angle is a piece doubling straight
        // back — put the arrival first so the departure clockwise of it is found.
        ends.sort((p, q) => (p.a - q.a) || (q.kind - p.kind));
        // Two passes because the match may wrap past angle pi. A departure may be
        // claimed ONCE — without that, the second pass hands an already-matched
        // departure to another arrival, `next` stops being a bijection, and two
        // chains collide over one piece so that the loser is cut short and left
        // open.
        const pending = [], usedOut = new Set();
        for (let pass = 0; pass < 2; pass++) {
            for (let k = ends.length - 1; k >= 0; k--) {
                const e = ends[k];
                if (e.kind === 1) { if (pass === 0) pending.push(e.i); }
                else if (pending.length && !usedOut.has(e.i)) {
                    usedOut.add(e.i);
                    next[pending.pop()] = e.i;
                }
            }
        }
        // Anything still pending is an unbalanced vertex the repair could not
        // close — there were more arrivals than departures. Give each what is
        // left, once, and let the rest end the chain rather than steal a piece
        // some other chain needs.
        if (pending.length) {
            const taken = new Set();
            for (let i = 0; i < n; i++) if (next[i] >= 0) taken.add(next[i]);
            for (const i of pending) {
                if (next[i] >= 0) continue;
                for (const j of outs) if (!taken.has(j)) { next[i] = j; taken.add(j); break; }
            }
        }
    }

    const used = new Uint8Array(n);
    const loops = [];
    for (let s0 = 0; s0 < n; s0++) {
        if (used[s0]) continue;
        const loop = [];
        let i = s0;
        while (i >= 0 && !used[i]) {
            used[i] = 1;
            loop.push(pieces[i].c);
            i = next[i];
        }
        loops.push(loop);
    }
    return loops;
}

/**
 * Signed area of a closed cubic loop (positive = counter-clockwise).
 *
 * Green's theorem, A = integral of x·y' dt. The integrand is degree 5 (a cubic
 * times a quadratic), and 3-point Gauss–Legendre is exact through degree 5, so
 * this is not a quadrature approximation — it is the exact area.
 */
const GAUSS_T = [0.5 - 0.5 * Math.sqrt(3 / 5), 0.5, 0.5 + 0.5 * Math.sqrt(3 / 5)];
const GAUSS_W = [5 / 18, 8 / 18, 5 / 18];
export function cubicLoopArea(loop) {
    let a = 0;
    for (const c of loop) {
        for (let k = 0; k < 3; k++) {
            const t = GAUSS_T[k], s = 1 - t;
            const x = s * s * s * c[0][0] + 3 * s * s * t * c[1][0] + 3 * s * t * t * c[2][0] + t * t * t * c[3][0];
            const dy = 3 * s * s * (c[1][1] - c[0][1]) + 6 * s * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1]);
            a += GAUSS_W[k] * x * dy;
        }
    }
    return a;
}

/**
 * ONE closed offset loop for the whole stroke, with provenance.
 *
 * This is the part that cannot come from `strokeOutlineCurves`. That function
 * emits one capsule per RUN and lets the runs overlap, which is right for
 * nonzero fill and wrong here: each run's end cap genuinely crosses the next
 * run's offset, so resolving the union of capsules manufactures a corner at
 * every run boundary. Measured before this was fixed: a 146° kink on a stroke
 * with no corners in it at all.
 *
 * So the offsets are chained straight through instead — left side start to end,
 * end cap, right side back, start cap — and the only junctions in the result are
 * (a) tangent-continuous joins inside a side, (b) cap arcs, which meet their
 * offsets tangentially, and (c) round joins where the centerline itself has a
 * tangent break. None of those is a crease.
 *
 * Each emitted piece carries `ci`, the centerline cubic it came from, so the
 * burial test can ignore its own generator (which it touches at distance exactly
 * r all along) without ignoring anything real.
 */
/**
 * One side of the offset, as a tangent-continuous chain with provenance.
 *
 * Exported because the incremental baker needs the BODY without caps — the
 * trailing cap moves with every sample, so maintaining it while drawing is pure
 * churn, and it is cheaper to add both caps once at pen-up.
 */
export function offsetSide(centre, r, sign, opts) {
    const { fitTol, lineTol, enterScale, live } = opts;
    {
        const chain = [];
        for (let i = 0; i < centre.length; i++) {
            // `live` marks centerline cubics whose offsets can still reach the
            // boundary. Fitting an offset that is buried along its whole length
            // is the single most expensive thing here and it is thrown away
            // immediately afterwards — measured at 206 ms of 369 on the real
            // stroke, for geometry that contributes nothing.
            if (live && !live[i]) continue;
            const c = centre[i];
            const before = chain.length;
            if (chordDeviation(c) <= lineTol) {
                // Still a straight piece, but its ENDPOINTS are placed along the
                // endpoint tangents, not along the chord. The two differ for a
                // nearly-straight cubic, and `fitOffset` uses the tangent — so
                // offsetting a line piece along its chord leaves a step at every
                // join between a line piece and a fitted one, of order r times
                // the tangent-chord angle. The batch path welds that away and
                // never notices; the incremental path cannot, and it came out as
                // a perimeter broken into nine loops instead of four.
                const t0 = cubicTangent(c, 0), t1 = cubicTangent(c, 1);
                if (t0 && t1) {
                    const a = [c[0][0] - t0[1] * r * sign, c[0][1] + t0[0] * r * sign];
                    const b = [c[3][0] - t1[1] * r * sign, c[3][1] + t1[0] * r * sign];
                    chain.push({ c: lineCubic(a, b), ci: i });
                }
            } else {
                const out = [];
                fitOffset(c, r * sign, fitTol, 0, out);
                for (const oc of out) chain.push({ c: oc, ci: i });
            }
            // A tangent break in the centerline needs a round join on the outer
            // side; on the inner side the two offsets cross and the resolve
            // trims them. Emitting the arc on both sides is correct either way —
            // an inner-side arc is buried and gets culled.
            if (before > 0 && chain.length > before) {
                const arcs = roundJoin(c[0], r, chain[before - 1].c[3], chain[before].c[0], enterScale, fitTol);
                if (arcs.length) chain.splice(before, 0, ...arcs.map((ac) => ({ c: ac, ci: i })));
            }
        }
        return chain;
    }
}

/**
 * The two round end caps, as `{start, end}` chains of cubics.
 *
 * Each meets its side chain tangentially — a semicircle leaves the offset
 * perpendicular to the centerline, which is exactly the direction the offset
 * arrives in — so cap junctions are smooth, not corners.
 */
export function endCaps(centre, r, opts) {
    const { fitTol, enterScale } = opts;
    const first = centre[0], last = centre[centre.length - 1];
    const u0 = cubicTangent(first, 0), u1 = cubicTangent(last, 1);
    if (!u0 || !u1) return null;
    return {
        end: capArcs(last[3], [-u1[1], u1[0]], u1, r, enterScale, fitTol)
            .map((c) => ({ c, ci: centre.length - 1 })),
        start: capArcs(first[0], [u0[1], -u0[0]], [-u0[0], -u0[1]], r, enterScale, fitTol)
            .map((c) => ({ c, ci: 0 })),
    };
}

export function offsetLoop(centre, r, opts) {
    const left = offsetSide(centre, r, 1, opts), right = offsetSide(centre, r, -1, opts);
    if (!left.length || !right.length) return [];
    const caps = endCaps(centre, r, opts);
    if (!caps) return [];
    const { start: capStart, end: capEnd } = caps;

    const rrev = [];
    for (let i = right.length - 1; i >= 0; i--) {
        const c = right[i].c;
        rrev.push({ c: [[c[3][0], c[3][1]], [c[2][0], c[2][1]], [c[1][0], c[1][1]], [c[0][0], c[0][1]]], ci: right[i].ci });
    }

    const loop = [...left, ...capEnd, ...rrev, ...capStart];
    // Weld ONLY where the two pieces already meet. Normally every join is
    // ULP-scale (the fitter's endpoints are exact offsets of a shared anchor)
    // and this just removes float noise that would defeat the stitcher.
    //
    // But `live` lets whole centerline cubics be skipped, so the chain can have
    // genuine gaps in it, and welding across one drags a piece's endpoint to a
    // far-away location and destroys its geometry. Measured in the browser on
    // the scribble: 89 % of the ink missing from the baked fill, while the unit
    // tests — which ran at a finer tolerance where nothing was culled — stayed
    // green. Leave real gaps alone; the stitcher closes them at genuine
    // crossings, which is what they are.
    // Contiguity is decided by PROVENANCE, not by distance. Two pieces belong
    // joined exactly when they come from the same centerline cubic or from
    // neighbouring ones — that covers every join inside a side, both caps, and
    // the wrap. A distance threshold cannot do this job: the mismatch at a real
    // join (the fitter derives its endpoint normal from the control legs, and
    // the spline's end anchors have degenerate handles) is the same size as the
    // gap left by a culled cubic, so any threshold either welds across real gaps
    // or refuses to weld real joins. Both were measured; both wreck the shape.
    const contiguous = (p, q) => Math.abs(p.ci - q.ci) <= 1;
    for (let i = 1; i < loop.length; i++) {
        if (contiguous(loop[i - 1], loop[i])) loop[i].c[0] = loop[i - 1].c[3];
    }
    if (contiguous(loop[loop.length - 1], loop[0])) loop[loop.length - 1].c[3] = loop[0].c[0];
    return loop;
}

/**
 * The round join between two consecutive offsets that do not meet.
 *
 * Where the centerline turns, the outer offsets of the two pieces leave a gap at
 * the shared anchor and the boundary genuinely runs round the anchor at radius r
 * — an arc, meeting both offsets perpendicular to the centerline, which is the
 * direction they leave in. Smooth by construction. (On the inner side the two
 * offsets cross instead; the arc emitted there is buried and the resolve
 * discards it, so emitting on both sides is right either way.)
 *
 * Closing the gap by dragging an endpoint across it instead is NOT the same
 * thing: it moves real geometry, by the width of the gap, and the pieces on
 * either side stop meeting anything. Measured on a six-sample stroke — two joins
 * of 12.6 and 5.7 units, two boundary pieces missing, and four dangling ends the
 * welder could not reach. Shared so the incremental schedule cannot drift from
 * the batch one again.
 */
export function roundJoin(pivot, r, fromPt, toPt, enterScale, fitTol) {
    const g = Math.hypot(toPt[0] - fromPt[0], toPt[1] - fromPt[1]);
    if (!(g > fitTol)) return [];
    const a0 = Math.atan2(fromPt[1] - pivot[1], fromPt[0] - pivot[0]);
    const a1 = Math.atan2(toPt[1] - pivot[1], toPt[0] - pivot[0]);
    let sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    return arcChain(pivot, r, a0, sweep, enterScale, fitTol);
}

/** Circular arc as kappa cubics, split so each stays under 90 degrees. */
function arcChain(center, r, a0, sweep) {
    if (Math.abs(sweep) < 1e-12) return [];
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const dth = sweep / n, k = (4 / 3) * Math.tan(dth / 4);
    const segs = [];
    for (let i = 0; i < n; i++) {
        const t0 = a0 + i * dth, t1 = t0 + dth;
        const P0 = [center[0] + r * Math.cos(t0), center[1] + r * Math.sin(t0)];
        const P1 = [center[0] + r * Math.cos(t1), center[1] + r * Math.sin(t1)];
        segs.push([P0, [P0[0] - k * r * Math.sin(t0), P0[1] + k * r * Math.cos(t0)],
            [P1[0] + k * r * Math.sin(t1), P1[1] - k * r * Math.cos(t1)], P1]);
    }
    return segs;
}

// ---------------------------------------------------------------------------
// the resolve
// ---------------------------------------------------------------------------

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Burial must be STRICT by more than the error in locating the boundary.
 *
 * That error has two parts: the fitted offset can sit `fitTol` inside the true
 * offset, and the oracle's flattened chords read short by up to their own
 * tolerance (which `buried` subtracts separately). Setting the margin to exactly
 * `fitTol` leaves ZERO slack — a boundary point at the full fitted error lands
 * precisely on the threshold, and which side of it floating point puts that
 * point on is a coin flip.
 *
 * It survived only because the oracle used to be coarse enough (r/64) that the
 * tolerance it subtracts supplied the slack by accident. Sharpening the oracle
 * removed the accident and the boundary started reading as buried: the dense
 * scribble kept 66 boundary pieces of 11,152 and painted two thin slabs where
 * the ink is a solid blob.
 *
 * Doubling it makes the slack explicit and equal to the accuracy already being
 * spent elsewhere. The cost is only that ink buried by less than a margin
 * survives as boundary, which is a sliver well inside the shape, not a hole in
 * it.
 */
const marginOf = (fitTol, r) => Math.max(2 * fitTol, r * 1e-9);

/**
 * The oracle's flattening tolerance, in ONE place.
 *
 * Every baker that builds its own oracle has to agree with the one the resolve
 * would have built, or it is measuring a different shape. C hands its oracle
 * straight to `curvePerimeter`, so a private default there does not produce a
 * slightly different answer — it produces a different algorithm, and the test
 * that says "C is exactly A" is the only thing that notices.
 */
export const oracleTolFor = (r, opts = {}) => (opts.oracleTol > 0 ? opts.oracleTol : r / 512);

/**
 * The tolerance the perimeter is BUILT at, given the tolerance it must MEET.
 *
 * Shared so every schedule builds the same geometry — B computing its own was
 * enough to make it disagree with A on a scrawl by 187 points out of 2,056 while
 * A was exact. See the note in `curvePerimeter` for why the two differ.
 */
export const buildTolFor = (r, opts = {}) => {
    const want = opts.fitTol > 0 ? opts.fitTol : r * 1e-3;
    const refine = opts.fitRefine > 0 ? opts.fitRefine : 8;
    // The floor is relative to the PEN, not to the required tolerance, because
    // the amplification that makes this necessary is geometric: a fitting error
    // of d displaces a crossing of angle θ by d/sin θ along the curve, and θ is a
    // property of the shape. r/10,000 keeps that displacement inside the weld
    // tolerance down to crossings of about a twentieth of a degree.
    //
    // Without the floor the requirement alone decides, and at a shallow zoom the
    // requirement is loose — a quarter pixel is 0.25 units against a 90-wide pen.
    // That is what still left one wedge in the lab after refining by 8.
    const floor = r * 1e-4;
    const k = (t) => Math.min(t / refine, floor);
    return {
        fitTol: k(want),
        lineTol: k(opts.lineTol > 0 ? opts.lineTol : want),
    };
};

/**
 * How far a junction may be welded shut to keep the perimeter closed.
 * See the balance note in `stitchCubics` — this is the bound on how far any
 * endpoint can move, and it only ever applies at a junction.
 *
 * EMPIRICAL, and it has to be: the displacement to be closed is the fitting
 * error divided by the sine of the crossing angle, and that angle is a property
 * of the drawing, so no bound is safe in principle. r/8 left one junction of
 * Kobin's 4,962-sample stroke unclosed by 13.5 units on a 200-wide pen (a
 * crossing of about a twentieth of a degree). r/6 closes it; r/4 was tried and
 * welds nothing further, so the extra reach buys nothing and only raises the
 * chance of joining two junctions that are genuinely distinct.
 *
 * Largest weld actually taken across every case here: 13.5 units at r = 100.
 */
export const repairTolFor = (r, opts = {}) => (opts.repairTol != null ? opts.repairTol : r / 6);

export { marginOf };

/**
 * NO ARC WINDOW. Burial is a function of POSITION ONLY, and that is the point.
 *
 * The union of the capsules is exactly {p : dist(p, C) <= r}, so a point on the
 * boundary sits at distance exactly r and is never buried — no part of the
 * centerline has to be excluded from the test for that to hold, provided the
 * threshold is strictly below r by more than the measurement error. Excluding
 * anything is a numerical crutch, and it was the wrong one.
 *
 * It cost the whole of F15. The window was an arc-length span around a piece's
 * OWN generator, so neighbouring pieces of the same chain used DIFFERENT
 * predicates. Where the stroke curls back on itself at an arc separation near
 * the window's edge, the window's trailing end sweeps over the overlapping ink
 * as the generator advances, and burial flips between one piece and the next —
 * at a chain junction, with no crossing there to cut at. Measured: a drawn ring
 * came out 510 wrong of 2,038 with 31 open chains.
 *
 * What the window was really covering for was the oracle reading short: its
 * chords lie inside the true curve, so a point on the concave side measures
 * nearer than it is. That is what `buried()` now subtracts, exactly, which is
 * why the window can go. Verified: excluding the piece's own generating cubic
 * and excluding nothing at all give identical output on every case, so the
 * exclusion is gone entirely rather than merely narrowed.
 */

/**
 * Resolve a stroke into ONE perimeter of cubics.
 *
 * @param {Array<[number,number]>} pts centerline samples, frame units
 * @param {number} width stroke width, frame units
 * @param {object} opts
 *   fitTol      max deviation of a fitted offset from the true offset (frame units)
 *   lineTol     below this chord deviation a centerline piece IS a line
 *   enterScale  frame->px at the level's deepest zoom (sizes cap arcs)
 *   crumb       a pre-built Crumb (algorithm C hands one in)
 *   oracleTol   distance-oracle flattening; defaults to a fraction of r
 *   curved      false to treat `pts` as a polyline (testing)
 * @returns {{loops: Array<Array<cubic>>, stats: object}}
 */
export function curvePerimeter(pts, width, opts = {}) {
    const r = width / 2;
    const ms = {};
    if (!(r > 0) || !pts || !pts.length) return { loops: [], stats: { ms } };

    // BUILD FINER THAN THE TOLERANCE YOU MUST MEET.
    //
    // `fitTol` is what the result has to be worth — a quarter pixel at the
    // level's deepest zoom. It is NOT a safe tolerance to build at, because the
    // two halves of this algorithm measure different things: cuts are made where
    // the FITTED offsets cross, and burial is judged by distance to the TRUE
    // centerline. Wherever those disagree, they disagree by the fitting error —
    // and at a crossing of angle θ an error of δ across the curve displaces the
    // crossing ALONG the curve by δ/sin θ. Shallow crossings are exactly what a
    // stroke that runs back alongside itself is made of, so the amplification is
    // not a corner case.
    //
    // Measured on a pen-drawn scrawl at width 90: at the required tolerance it
    // left six unclosed chains with dangling ends 8 to 35 units apart — from a
    // fitting error of 0.02. Building an order finer closed all of them.
    //
    // It is cheap because offset fitting converges fast: the piece count grows
    // roughly as the fourth root, so 8x the accuracy costs well under 2x the
    // pieces. The margin below then shrinks with it, so the result is both more
    // robust AND tighter.
    const { fitTol, lineTol } = buildTolFor(r, opts);
    const enterScale = opts.enterScale || 1;
    const curved = opts.curved !== false;

    let t0 = now();
    const centre = centerlineCubics(pts, curved);
    if (!centre.length) {
        return { loops: [circleLoop(pts[0], r, enterScale, fitTol)], stats: { ms, trivial: true } };
    }
    // The oracle has to exist BEFORE the offset now, because it is what decides
    // which centerline cubics are worth offsetting at all.
    // The oracle's flattening tolerance is subtracted from the burial threshold,
    // so it IS the width of the band just inside the boundary where burial
    // cannot be judged. At r/64 that band is most of a unit, wide enough for a
    // whole sub-piece to sit inside it and be called wrong; the consequence is
    // not a fuzzy edge but a dropped partner at a junction and a chain left open.
    // r/512 puts the band under a tenth of a unit and costs ~2.8x the segments,
    // which is cheap because the oracle is not where the time goes.
    const oracleTol0 = oracleTolFor(r, opts);
    const oracle0 = opts.oracle || new DistOracle(centre, r, oracleTol0);
    ms.oracle = +(now() - t0).toFixed(1); t0 = now();

    // CENTERLINE PRE-CULL. The offset point at parameter t is exactly
    // c(t) +/- r * perp(unit tangent), so a cubic's rails can be probed without
    // fitting anything. If every probe on both rails is buried by ink that is
    // not this cubic or its neighbours, the whole cubic contributes no boundary
    // and never needs to be offset.
    // OFF BY DEFAULT. It is a 3.5x win on a dense scribble (369 -> 106 ms in
    // jest) and it is UNSOUND at the sampling density that makes it cheap: a
    // rail that pokes out between two probes is missed, the cubic is dropped,
    // and the perimeter loses a piece it needed. Caught in the browser at a
    // coarser tolerance than the unit tests use — 89 % of the ink missing from
    // the baked fill while every test stayed green.
    //
    // The piece-level pre-cull below does the same job soundly (it probes the
    // actual fitted offset rather than a guess at where it will be) and is
    // validated by membership on four strokes including a dense overlap. This
    // one needs a conservative sampling bound before it can be turned on —
    // probe spacing has to be tied to the smallest gap the ink can have, not to
    // the cubic's own length.
    const liveMask = new Uint8Array(centre.length).fill(1);
    if (opts.centerlineCull) {
        const m = marginOf(fitTol, r);
        for (let i = 0; i < centre.length; i++) {
            const c = centre[i];
            const bb = bboxOf(c);
            const n = Math.max(3, Math.ceil((Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) * 3) / r));
            let any = false;
            for (let k = 0; k <= n && !any; k++) {
                const t = k / n, p = cubicAt(c, t), u = cubicTangent(c, t);
                if (!u) { any = true; break; }
                for (const sg of [1, -1]) {
                    const qx = p[0] - u[1] * r * sg, qy = p[1] + u[0] * r * sg;
                    if (!oracle0.buried(qx, qy, m)) { any = true; break; }
                }
            }
            liveMask[i] = any ? 1 : 0;
        }
    }
    ms.precullC = +(now() - t0).toFixed(1); t0 = now();

    const chain = offsetLoop(centre, r, { fitTol, lineTol, enterScale, live: liveMask });
    ms.offset = +(now() - t0).toFixed(1); t0 = now();
    if (!chain.length) {
        return { loops: [circleLoop(pts[0], r, enterScale, fitTol)], stats: { ms, trivial: true } };
    }

    // --- the distance oracle -------------------------------------------------
    // Only ever consulted at sub-piece MIDPOINTS, which sit far from any
    // boundary, so r/64 is ample and costs a fraction of a display flatten.
    // Algorithm C hands in an oracle it maintained while drawing; it is monotone,
    // so what was accumulated during the stroke is still exactly right at pen-up.
    const oracle = oracle0;

    // --- index the chain -----------------------------------------------------
    // `k` is position along the closed chain (for adjacency), `ci` the centerline
    // cubic that generated the piece (for burial). Both are needed and they are
    // not the same thing: two pieces can be chain-adjacent while coming from
    // different centerline cubics, and vice versa.
    const pieces = chain.map((p, k) => ({ c: p.c, k, ci: p.ci, bb: bboxOf(p.c) }));
    const NK = pieces.length;
    // The tangential-contact pad, in arc length. It must cover the join at each
    // shared anchor and nothing more; a couple of oracle segments is enough, and
    // anything approaching r would start hiding genuine tight self-overlap.

    // --- cull: whole loops that are buried produce nothing -------------------
    const cellSize = opts.cellSize || r / 2;
    const crumb = !opts.cull ? null : opts.crumb || (() => {
        const cr = new Crumb(cellSize);
        const segs = oracle.segs;
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            cr.add({ a: [s.ax, s.ay], b: [s.ax + s.ux * s.L, s.ay + s.uy * s.L], ux: s.ux, uy: s.uy, L: s.L }, r, i);
        }
        return cr;
    })();
    ms.crumb = +(now() - t0).toFixed(1); t0 = now();

    // THE CRUMB CULL IS OFF BY DEFAULT, AND THAT IS DELIBERATE.
    //
    // It was the centrepiece of the polyline design, where it removed 94 % of
    // 3,768 capsules. In the curve world there is nothing for it to remove: a
    // stroke is a few hundred offset pieces, not tens of thousands, and the
    // classify step already discards buried ones correctly.
    //
    // Worse, it is UNSOUND here. The crumb records "some capsule covers this
    // cell entirely" and cannot express path adjacency, so a boundary piece gets
    // culled by the ink that joins it smoothly. Measured on a tight wiggle: one
    // genuine boundary piece of 133 culled, the chain broken into two loops,
    // each force-closed, giving 142 and 170 degree phantom corners and 18
    // misclassified points. The same stroke resolves perfectly with the cull off.
    //
    // Kept behind a flag only so the comparison can still be measured.
    const candidates = [];
    if (!opts.cull) {
        for (const p of pieces) candidates.push(p);
    } else
    for (const p of pieces) {
        // Probe the piece itself: if every sample sits in a cell somebody else
        // has already filled entirely, it contributes no boundary. Conservative
        // by construction — a cell counts only when one capsule covers it whole,
        // so partial coverage by several never culls anything.
        const n = Math.max(3, Math.ceil(Math.hypot(p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]) / cellSize));
        let exposed = false;
        for (let k = 0; k <= n && !exposed; k++) {
            const q = cubicAt(p.c, k / n);
            if (!crumb.coveredByOther(q[0], q[1], -1)) exposed = true;
        }
        if (exposed) candidates.push(p);
    }
    ms.cull = +(now() - t0).toFixed(1); t0 = now();

    // --- pre-cull: drop pieces that are buried along their whole length ------
    //
    // This is the crumb's job done with the RIGHT oracle. The crumb could not
    // express path adjacency and so culled real boundary (see the note above);
    // the distance oracle can, because `lo`/`hi` exclude a piece's own generator
    // and its neighbours.
    //
    // And unlike `strokeShape`, dropping a buried piece here is sound in BOTH of
    // its roles. Classification uses the oracle, not other pieces, so a dropped
    // piece is not needed as a trimmer. It is not needed as a cutter either: a
    // buried piece lies inside the ink, so crossing it does not change whether
    // anything else is inside the union. Nothing downstream can miss it.
    //
    // Worth it because the cut step is quadratic and everything else is not —
    // measured at 1,172 ms of 1,493 on the real stroke, 44,598 cuts to produce
    // 234 pieces.
    // ON BY DEFAULT. The cut step is quadratic in the pieces that reach it and
    // everything else is linear, so this is the difference between a bake and a
    // freeze: a dense scribble offers 11,152 pieces of which 364 carry any
    // boundary at all, and cutting the other 10,788 against each other cost 2.8 s
    // at pen-up for geometry that is discarded immediately afterwards.
    // CULL BY A BOUND, NOT BY SAMPLES.
    //
    // This used to probe the piece at intervals and drop it if every probe was
    // buried, which cannot be made sound: whatever the spacing, a span shorter
    // than it can poke out between two probes and be thrown away. It was tied to
    // a fixed number of probes per pen radius, so a 200-wide pen probed only
    // every 12.5 units — and Kobin's stroke lost 16 pieces of real boundary that
    // way. The renderer joined the resulting loose ends with straight lines whose
    // near-parallel pair left an unfilled diagonal band right across the drawing.
    //
    // A piece lies wholly inside the ink if its BOUNDING BOX does, and the box is
    // inside whenever its centre is buried by more than half its diagonal —
    // every point of the box is within that of the centre. One distance query,
    // no sampling, and it can only ever be too cautious: a piece it keeps merely
    // goes on to be classified exactly, which is what happens to it anyway.
    //
    // It is also cheaper than the sampled version it replaces (one probe instead
    // of eight or more) while still removing the great majority — on a dense
    // scribble, 44,000 pieces down to a few hundred.
    const exposed = [];
    if (opts.precull === false) { for (const p of candidates) exposed.push(p); } else
    for (const p of candidates) {
        const cx = (p.bb[0] + p.bb[2]) / 2, cy = (p.bb[1] + p.bb[3]) / 2;
        const halfDiag = Math.hypot(p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]) / 2;
        if (!oracle.buried(cx, cy, marginOf(fitTol, r) + halfDiag)) exposed.push(p);
    }
    ms.precull = +(now() - t0).toFixed(1); t0 = now();

    // --- cut: every crossing with every reachable other piece ----------------
    const grid = new PieceGrid(exposed, Math.max(r, cellSize));
    // SUBDIVISION ONLY HAS TO BRACKET THE CROSSING — Newton makes it exact.
    //
    // It used to isolate to r/10,000, which is 55x finer than the curves being
    // crossed are themselves accurate, and it is paid for by halving both curves
    // another four times. Where two offsets run nearly parallel — which is most
    // of a stroke that comes back alongside itself — the subdivision does not
    // converge to one box but fans out into a cloud of them, and the cost of that
    // cloud is exponential in the depth. Measured on a drawn ring: 110 ms of
    // cutting for 84 pairs, 1.3 ms a pair.
    //
    // Resolving finer than `fitTol` is meaningless anyway: the fitted offset is
    // only that close to the true one, so two crossings nearer than fitTol are
    // not distinguishable. Bracket to fitTol, then polish.
    const isectTol = Math.max(fitTol, r * 1e-6);
    // NEIGHBOURING CENTERLINE CUBICS MUST STILL BE CLIPPED AGAINST EACH OTHER.
    //
    // This used to skip any pair whose generators were neighbours, on the
    // assumption that consecutive offsets only ever MEET. That is true while the
    // centerline turns gently — and false exactly where it does not. Where the
    // pen doubles back tighter than its own radius, the two inner offsets really
    // do cross, and that crossing is the point at which the inside of the hairpin
    // has to be trimmed. Skipping it leaves burial flipping across a chain
    // junction with no cut there to carry it, which strands an end; the renderer
    // then joins the loose ends with a straight line right across the drawing.
    //
    // Measured on the 278-sample stroke from Kobin's tab: two loops left open
    // with 649- and 654-unit gaps, healed to zero by clipping neighbours, with
    // the unbalanced-vertex count falling 86 -> 60 and the worst weld 4.28 -> 1.65
    // units. Raising the weld distance also closed them, but that treats the
    // symptom — the crossing genuinely exists and belongs in the result.
    //
    // Pieces from the SAME cubic are still skipped (0), and chain-adjacent pieces
    // are skipped above, which together cover every join that is a join rather
    // than a crossing.
    const ciSkipN = opts.ciSkipN != null ? opts.ciSkipN : 0;
    let pairTests = 0, cutCount = 0;
    for (const p of exposed) p.cuts = [];
    // Crossings are registered as SHARED points, so the two pieces cut at one
    // land on identical coordinates rather than merely nearby ones.
    const vset = new VertexSet(Math.max(isectTol, r * 1e-9));
    const near = [];
    for (const p of exposed) {
        grid.nearInto(p.bb, near);
        for (const q of near) {
            if (q === p) continue;
            // Handle each unordered pair ONCE and cut BOTH sides from the same
            // computation. Doing it per-piece instead — trusting that q's own
            // turn will rediscover the crossing — is not symmetric: recursive
            // subdivision splits differently depending on argument order, so
            // (p,q) and (q,p) can disagree about how many crossings there are.
            // One side then gets cut and the other does not, the cut endpoint has
            // no partner to continue to, and the loop walk dead-ends at it.
            // Measured on a drawn stroke: 20 of 24 loops left open, gaps up to
            // 766 units, which the renderer closes with a straight line right
            // across the shape.
            // NOT skipped by index order. The grid query is not symmetric — a
            // small piece can find a large one without the reverse being true —
            // so "handle the pair from the lower index" silently drops any pair
            // only the higher index can see. Cut both sides every time instead;
            // a duplicate cut is harmless (it collapses to a zero-length
            // interval and is discarded), a missing one is not.
            const gap = Math.abs(p.k - q.k);
            if (gap <= 1 || gap === NK - 1) continue;
            if (Math.abs(p.ci - q.ci) <= ciSkipN) continue;
            if (hullsMiss(p.c, q.c, 0)) continue;
            pairTests++;
            for (const [ta, tb] of cubicIntersections(p.c, q.c, isectTol)) {
                const pa = cubicAt(p.c, ta), pb = cubicAt(q.c, tb);
                const v = vset.at((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
                if (ta > 1e-9 && ta < 1 - 1e-9) { p.cuts.push({ t: ta, v }); cutCount++; }
                if (tb > 1e-9 && tb < 1 - 1e-9) { q.cuts.push({ t: tb, v }); }
            }
        }
    }
    ms.cut = +(now() - t0).toFixed(1); t0 = now();

    // --- classify: keep the sub-pieces that are not buried -------------------
    // Each fragment is judged on its own, by distance to the centerline.
    //
    // COUNTING ALONG THE CHAIN WAS TRIED HERE AND IS WORSE — see F20. Carrying a
    // running count of covering capsules makes each crossing self-consistent, but
    // it needs the crossing set to be exactly right: every crossing found once,
    // with the right sign. Judging fragments independently needs no such thing —
    // a missed or duplicated crossing costs one fragment, not everything after
    // it. On a densely sampled stroke the offsets of neighbouring cubics are near
    // duplicates of each other and the crossing set cannot be made exact, so the
    // count drifts. Measured with the complete crossing set: 204 disagreements
    // between anchors, and 424 unclosed chains against 0 for this rule.
    const margin = marginOf(fitTol, r);
    const kept = [];
    for (const p of exposed) {
        // Each cut carries the shared point the two crossing pieces agreed on;
        // the two ends of the whole piece carry none and keep their own.
        const ts = [{ t: 0, v: null }];
        for (const c of p.cuts) if (c.t > 0 && c.t < 1) ts.push(c);
        ts.push({ t: 1, v: null });
        ts.sort((a, b) => a.t - b.t);
        let runStart = null;
        for (let i = 0; i < ts.length - 1; i++) {
            const a = ts[i], b = ts[i + 1];
            if (b.t - a.t < 1e-12) continue;
            const mid = cubicAt(p.c, (a.t + b.t) / 2);
            const dead = oracle.buried(mid[0], mid[1], margin);
            if (!dead && runStart === null) runStart = a;
            if ((dead || i === ts.length - 2) && runStart !== null) {
                const end = dead ? a : b;
                const c = subCubic(p.c, runStart.t, end.t);
                // Snap to the shared crossing points. The move is at most the
                // residual Newton left behind, so the curve is unchanged in any
                // way that can be seen — and the junction becomes exact.
                if (runStart.v) c[0] = [runStart.v[0], runStart.v[1]];
                if (end.v) c[3] = [end.v[0], end.v[1]];
                kept.push({ c, src: p });
                runStart = null;
            }
        }
    }
    ms.classify = +(now() - t0).toFixed(1); t0 = now();

    // The stitcher's weld only has to absorb float noise, so it must be TINY —
    // crossings already share one vertex object and chain joins are already
    // welded to identical coordinates, so there is nothing legitimate left for it
    // to close. Deriving it from the intersection tolerance was wrong: a dense
    // stroke's pieces are shorter than that, so a piece's two ends snapped
    // together and it became a closed loop of one piece. Measured on a drawn
    // ring: 16 such loops out of 18.
    const stitchTol = Math.max(r * 1e-6, 1e-12);
    let loops = stitchCubics(kept, stitchTol, repairTolFor(r, opts));
    ms.stitch = +(now() - t0).toFixed(1);
    const repairs = stitchCubics.lastRepairs;
    const worstRepair = +stitchCubics.lastWorstRepair.toFixed(3);

    // DROP THE STRIPS THAT ARE THINNER THAN THE MEASUREMENT.
    //
    // Where two boundary curves run closer together than the burial test can
    // resolve, both survive, and the result is a hairline that goes out and comes
    // straight back — a loop enclosing essentially nothing. Measured on a drawn
    // stroke at high zoom: 29 pieces, 12.4 units of path, area 0.18, so a mean
    // width of 0.03 against a resolution of 0.10. Another had 18 such loops
    // beside its 2 real ones, and welding a short piece's own two ends shut adds
    // more of the same as literal points.
    //
    // They are not shape. A doubled-back strip paints nothing (its winding
    // cancels), so removing it changes no pixel; it only stops the stored
    // perimeter carrying junk into tiling and erasing, and stops it showing up as
    // a spike once you zoom past the scale it lives at.
    //
    // The threshold is the resolution itself — mean width = 2*area/perimeter,
    // dropped when that is under the band within which "inside" is not a
    // statement this algorithm can make. Anything genuinely thinner than that was
    // never measured, only guessed.
    const band = marginOf(fitTol, r) + oracleTol0;
    loops = dropHairlines(loops, opts.minLoopWidth != null ? opts.minLoopWidth : band);
    const minArea = opts.minLoopArea != null ? opts.minLoopArea : 0;
    if (minArea > 0) loops = loops.filter((l) => Math.abs(cubicLoopArea(l)) >= minArea);

    return { loops, stats: { ms, chain: NK, pieces: pieces.length,
        candidates: candidates.length, exposed: exposed.length, pairTests, cuts: cutCount, kept: kept.length,
        repairs, worstRepair,
        out: loops.reduce((n, l) => n + l.length, 0) } };
}

/**
 * Remove loops whose mean width is under `minWidth` — see the note at the call
 * site. Exported so every schedule filters the same way; a private copy is how
 * the incremental one ended up keeping the spurs the batch one had removed.
 */
export function dropHairlines(loops, minWidth) {
    if (!(minWidth > 0)) return loops;
    return loops.filter((l) => {
        let per = 0;
        for (const c of l) {
            let px = c[0][0], py = c[0][1];
            for (let i = 1; i <= 4; i++) {
                const q = cubicAt(c, i / 4);
                per += Math.hypot(q[0] - px, q[1] - py); px = q[0]; py = q[1];
            }
        }
        if (!(per > 0)) return false;
        return (2 * Math.abs(cubicLoopArea(l))) / per >= minWidth;
    });
}

/** The sub-curve of `c` over [t0,t1], exactly (de Casteljau twice). */
export function subCubic(c, t0, t1) {
    let s = c;
    if (t0 > 0) s = splitCubic(s, t0)[1];
    if (t1 < 1) {
        const u = t0 > 0 ? (t1 - t0) / (1 - t0) : t1;
        s = splitCubic(s, Math.max(0, Math.min(1, u)))[0];
    }
    return [[s[0][0], s[0][1]], [s[1][0], s[1][1]], [s[2][0], s[2][1]], [s[3][0], s[3][1]]];
}

/** Uniform grid over piece bounding boxes. */
class PieceGrid {
    constructor(pieces, cell) {
        this.cell = cell; this.map = new Map();
        this.stamp = new Int32Array(pieces.length);
        this.tick = 0;
        for (let i = 0; i < pieces.length; i++) {
            pieces[i]._gi = i;
            const b = pieces[i].bb;
            for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) {
                for (let k = Math.floor(b[0] / cell); k <= Math.floor(b[2] / cell); k++) {
                    const key = k * 8388608 + j;
                    let arr = this.map.get(key);
                    if (!arr) this.map.set(key, arr = []);
                    arr.push(pieces[i]);
                }
            }
        }
    }
    nearInto(bb, out) {
        const c = this.cell, t = ++this.tick, st = this.stamp;
        out.length = 0;
        for (let j = Math.floor(bb[1] / c); j <= Math.floor(bb[3] / c); j++) {
            for (let k = Math.floor(bb[0] / c); k <= Math.floor(bb[2] / c); k++) {
                const arr = this.map.get(k * 8388608 + j);
                if (!arr) continue;
                for (let n = 0; n < arr.length; n++) {
                    const p = arr[n];
                    if (st[p._gi] === t) continue;
                    st[p._gi] = t;
                    out.push(p);
                }
            }
        }
        return out;
    }
}

export { DistOracle, PieceGrid, coverRuns, mergeCovers, freeRuns };
