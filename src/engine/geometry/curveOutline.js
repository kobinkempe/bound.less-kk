/**
 * curveOutline.js — resolution-independent stroke outlines ("curve capsules").
 *
 * Replaces the per-zoom polyline/Clipper display bake for fat strokes: the
 * outline is built ONCE per object in its own level frame, out of cubic Bézier
 * segments, and is exact (within fitTol) at EVERY in-level zoom — SVG renders
 * Béziers natively, so nothing needs re-tessellating as the camera moves.
 * Representation switches happen only at level handoffs (tiles polygonize
 * inherited copies at the next level's entry fidelity, as before).
 *
 * Shape: one closed LOOP per centerline piece — a "capsule": the piece's left
 * offset, a round cap arc at its far end, the reversed right offset, and a
 * round cap arc back at the near end. Consecutive capsules overlap at their
 * shared anchor's cap disc, which does three jobs at once:
 *   - round JOINS between pieces emerge from the overlap (no join geometry),
 *   - every loop has the SAME orientation, so under NONZERO fill overlaps only
 *     add winding — solid ink, no pockets, exactly the guarantee the analytic
 *     strip gave the polygon path (see D5: per-id groups made union unneeded),
 *   - a cusp inside one piece (curvature radius < width/2, where the true
 *     offset self-intersects) can at worst wrinkle that piece's own side; the
 *     subdivision fallback turns such slivers into exact line capsules.
 *
 * Segments are stored as absolute cubics [p0, c1, c2, p1]; straight segments
 * are cubics with the controls ON the endpoints (geometrically the exact
 * segment), so a loop is a uniform cubic list for the renderer.
 *
 * Tolerances (frame units; callers derive them from device px at the level's
 * DEEPEST zoom, cfg.enter — the worst case a level ever shows):
 *   fitTol  — max deviation of a fitted offset from the true offset curve.
 *   lineTol — a centerline cubic whose deviation from its chord is under this
 *             is "basically a line" and gets an exact LINE capsule (the
 *             polygonize constant, cfg.lineTolPx).
 *   enterScale — frame→px factor at the deepest zoom; sizes cap-arc segments
 *             so kappa-arc error also stays under fitTol on screen.
 */
import { controlsFor } from "./clipperOutline";

const MAX_FIT_DEPTH = 12;

// ---- vector / cubic helpers ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mulv = (a, k) => [a[0] * k, a[1] * k];
const hyp = (v) => Math.hypot(v[0], v[1]);
const perp = (v) => [-v[1], v[0]];
const unit = (v) => { const l = hyp(v); return l > 0 ? [v[0] / l, v[1] / l] : null; };

function cubicAt(c, t) {
    const s = 1 - t;
    const a = s * s * s, b = 3 * s * s * t, d = 3 * s * t * t, e = t * t * t;
    return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0],
            a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}
// Unit tangent. Where B'(t) vanishes (coincident control points — the spline's
// endpoint anchors have degenerate handles by construction) the LIMIT tangent
// is what the curve actually leaves along (e.g. direction c2−c0 at t=0, NOT the
// chord); recover it with a tiny central difference of positions.
function cubicTangent(c, t) {
    const s = 1 - t;
    const dx = 3 * s * s * (c[1][0] - c[0][0]) + 6 * s * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]);
    const dy = 3 * s * s * (c[1][1] - c[0][1]) + 6 * s * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1]);
    const u = unit([dx, dy]);
    if (u) return u;
    const h = 1e-4;
    const t0 = Math.max(0, t - h), t1 = Math.min(1, t + h);
    return unit(sub(cubicAt(c, t1), cubicAt(c, t0))) || unit(sub(c[3], c[0]));
}
function splitCubic(c, t) {
    const m = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const p01 = m(c[0], c[1]), p12 = m(c[1], c[2]), p23 = m(c[2], c[3]);
    const p012 = m(p01, p12), p123 = m(p12, p23), mid = m(p012, p123);
    return [[c[0], p01, p012, mid], [mid, p123, p23, c[3]]];
}
const lineCubic = (p0, p1) => [[p0[0], p0[1]], [p0[0], p0[1]], [p1[0], p1[1]], [p1[0], p1[1]]];

// Perpendicular deviation of the control points from the chord (an upper bound
// on the curve's own deviation — the curve lies inside its control hull).
function chordDeviation(c) {
    const d = sub(c[3], c[0]);
    const L = hyp(d);
    if (L < 1e-12) return Math.max(hyp(sub(c[1], c[0])), hyp(sub(c[2], c[0])));
    const off = (p) => Math.abs((p[0] - c[0][0]) * d[1] - (p[1] - c[0][1]) * d[0]) / L;
    return Math.max(off(c[1]), off(c[2]));
}

// ---- arcs (round caps) as kappa cubics, adaptively segmented ----
// A single 90° kappa arc deviates ~2.7e-4·r from the true circle; the error
// scales ~(θ/90°)^6. Size θ so the ON-SCREEN error at the deepest zoom stays
// inside fitTol — cap radii can reach tens of thousands of px there, where the
// classic 2-segment semicircle would be off by several px.
function arcSegments(center, r, a0, sweep, enterScale, fitTol) {
    const rPx = r * (enterScale || 1);
    const tolPx = fitTol * (enterScale || 1);
    let thetaMax = Math.PI / 2;
    const e90 = 2.7e-4 * rPx;
    if (e90 > tolPx && tolPx > 0) thetaMax = (Math.PI / 2) * Math.pow(tolPx / e90, 1 / 6);
    thetaMax = Math.max(Math.PI / 12, Math.min(Math.PI / 2, thetaMax));
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / thetaMax));
    const dth = sweep / n;
    const k = (4 / 3) * Math.tan(dth / 4); // signed with dth
    const segs = [];
    for (let i = 0; i < n; i++) {
        const t0 = a0 + i * dth, t1 = t0 + dth;
        const P0 = [center[0] + r * Math.cos(t0), center[1] + r * Math.sin(t0)];
        const P1 = [center[0] + r * Math.cos(t1), center[1] + r * Math.sin(t1)];
        const C1 = [P0[0] - k * r * Math.sin(t0), P0[1] + k * r * Math.cos(t0)];
        const C2 = [P1[0] + k * r * Math.sin(t1), P1[1] - k * r * Math.cos(t1)];
        segs.push([P0, C1, C2, P1]);
    }
    return segs;
}
// Semicircular cap at `center`: from center+n·r through center+t̂·r (t̂ = the
// outward tangent) to center−n·r; the sweep sign is chosen so the arc's
// midpoint lands on the tangent side.
function capArcs(center, nvec, tvec, r, enterScale, fitTol) {
    const a0 = Math.atan2(nvec[1], nvec[0]);
    const aMid = Math.atan2(tvec[1], tvec[0]);
    let d = aMid - a0;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    const sweep = d >= 0 ? Math.PI : -Math.PI;
    return arcSegments(center, r, a0, sweep, enterScale, fitTol);
}

// ---- offset fitting (Tiller–Hanson + measured error + subdivision) ----
function tillerHanson(c, r) {
    const legs = [sub(c[1], c[0]), sub(c[2], c[1]), sub(c[3], c[2])];
    const us = legs.map(unit);
    // degenerate legs borrow a neighbour's direction (coincident controls)
    for (let i = 0; i < 3; i++) if (!us[i]) us[i] = us[i === 0 ? 1 : i - 1] || us[i === 2 ? 1 : i + 1];
    if (!us[0] || !us[1] || !us[2]) return null; // fully degenerate piece
    const ns = us.map((u) => perp(u));
    const Q0 = addv(c[0], mulv(ns[0], r));
    const Q3 = addv(c[3], mulv(ns[2], r));
    // intersect consecutive offset legs; near-parallel legs meet at the shared
    // control point pushed along the averaged normal
    const meet = (P, u, Q, v, fallbackPt, n1, n2) => {
        const den = u[0] * v[1] - u[1] * v[0];
        if (Math.abs(den) < 1e-9) {
            const nm = unit(addv(n1, n2)) || n1;
            return addv(fallbackPt, mulv(nm, r));
        }
        const w = sub(Q, P);
        const t = (w[0] * v[1] - w[1] * v[0]) / den;
        return addv(P, mulv(u, t));
    };
    const Q1 = meet(addv(c[0], mulv(ns[0], r)), us[0], addv(c[1], mulv(ns[1], r)), us[1], c[1], ns[0], ns[1]);
    const Q2 = meet(addv(c[1], mulv(ns[1], r)), us[1], addv(c[2], mulv(ns[2], r)), us[2], c[2], ns[1], ns[2]);
    return [Q0, Q1, Q2, Q3];
}

// Max distance from sampled TRUE offset points to the fitted cubic (nearest
// point on a sampled polyline of the fit — geometric, so Tiller–Hanson's
// parameterization skew doesn't force needless subdivision; comparing at
// matched t looked cheaper but over-subdivided ~5×). Endpoints are exact by
// construction, so three interior probes suffice.
function offsetError(c, r, fitted) {
    const F = 9;
    const fpts = [];
    for (let i = 0; i <= F; i++) fpts.push(cubicAt(fitted, i / F));
    let worst = 0;
    for (const t of [0.2, 0.5, 0.8]) {
        const tan = cubicTangent(c, t);
        if (!tan) return Infinity;
        const q = addv(cubicAt(c, t), mulv(perp(tan), r));
        let best = Infinity;
        for (let i = 0; i < F; i++) {
            const a = fpts[i], b = fpts[i + 1];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const L2 = dx * dx + dy * dy;
            let u = L2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const d = Math.hypot(a[0] + u * dx - q[0], a[1] + u * dy - q[1]);
            if (d < best) best = d;
        }
        if (best > worst) worst = best;
    }
    return worst;
}

// One side of one centerline cubic: fitted offset cubics, subdivided to fitTol.
function fitOffset(c, r, fitTol, depth, out) {
    // flat-relative-to-tolerance pieces offset exactly as a line
    if (chordDeviation(c) <= fitTol * 0.5) {
        const u = unit(sub(c[3], c[0]));
        if (!u) return out; // zero-length: the neighbours' caps cover it
        const n = perp(u);
        out.push(lineCubic(addv(c[0], mulv(n, r)), addv(c[3], mulv(n, r))));
        return out;
    }
    const fitted = depth >= MAX_FIT_DEPTH ? null : tillerHanson(c, r);
    if (fitted && offsetError(c, r, fitted) <= fitTol) { out.push(fitted); return out; }
    if (depth >= MAX_FIT_DEPTH) {
        // pathological sliver (true cusp): the piece is tiny by now — its exact
        // chord offset is within tolerance of anything visible
        const u = unit(sub(c[3], c[0]));
        if (u) { const n = perp(u); out.push(lineCubic(addv(c[0], mulv(n, r)), addv(c[3], mulv(n, r)))); }
        return out;
    }
    const [l, rgt] = splitCubic(c, 0.5);
    fitOffset(l, r, fitTol, depth + 1, out);
    fitOffset(rgt, r, fitTol, depth + 1, out);
    return out;
}

// Reverse a chain of cubics (traverse the other way).
function reverseSegs(segs) {
    const out = [];
    for (let i = segs.length - 1; i >= 0; i--) {
        const [p0, c1, c2, p1] = segs[i];
        out.push([p1, c2, c1, p0]);
    }
    return out;
}
// Snap consecutive endpoints together (subdivision computes the shared point
// twice with different roundings; the loop must be watertight bit-for-bit).
function chain(segs) {
    for (let i = 1; i < segs.length; i++) segs[i][0] = segs[i - 1][3];
    return segs;
}

// A full-circle loop (the 1-point "dot" stroke).
function circleLoop(center, r, enterScale, fitTol) {
    const segs = arcSegments(center, r, 0, 2 * Math.PI, enterScale, fitTol);
    segs[segs.length - 1][3] = segs[0][0]; // watertight closure
    return chain(segs);
}

// Is this piece "tame" — curvature safely below 1/r, so its offsets cannot
// cusp/self-cross and it can share a capsule RUN with its neighbours? The
// spline is tangent-continuous at anchors, so a run of tame pieces has smooth,
// well-behaved sides and only needs caps at the run's two ENDS — one cap pair
// per run instead of per pointer sample (the difference between ~15k and ~1k
// outline segments on a long freehand stroke). Anything wild gets its own
// capsule, whose cap overlap restores the pocket-proofing locally.
function tamePiece(c, r) {
    const u0 = cubicTangent(c, 0), u1 = cubicTangent(c, 1);
    if (!u0 || !u1) return false;
    const dot = Math.max(-1, Math.min(1, u0[0] * u1[0] + u0[1] * u1[1]));
    const theta = Math.acos(dot);
    if (theta < 1e-3) return true;
    if (theta > 1.0) return false; // sharp turn inside one piece
    // control-polygon length ≥ arc length ≥ chord: average them for the radius estimate
    const L = (hyp(sub(c[1], c[0])) + hyp(sub(c[2], c[1])) + hyp(sub(c[3], c[2])) + hyp(sub(c[3], c[0]))) / 2;
    return L / theta > 1.5 * r;
}

// One capsule loop around a RUN of consecutive centerline cubics (tangent-
// continuous, curvature-bounded — a single wild piece is a run of one).
function runCapsule(cubics, r, opts) {
    const { fitTol, lineTol, enterScale } = opts;
    const first = cubics[0], last = cubics[cubics.length - 1];
    const u0 = cubicTangent(first, 0), u1 = cubicTangent(last, 1);
    if (!u0 || !u1) return null; // zero-length run: neighbours' caps cover it
    const left = [], right = [];
    for (const c of cubics) {
        if (chordDeviation(c) <= lineTol) {
            // "basically a line" (the polygonize constant): exact line offsets
            const u = unit(sub(c[3], c[0]));
            if (!u) continue;
            const n = perp(u);
            left.push(lineCubic(addv(c[0], mulv(n, r)), addv(c[3], mulv(n, r))));
            right.push(lineCubic(addv(c[0], mulv(n, -r)), addv(c[3], mulv(n, -r))));
        } else {
            fitOffset(c, r, fitTol, 0, left);
            fitOffset(c, -r, fitTol, 0, right);
        }
    }
    if (!left.length || !right.length) return null;
    chain(left); chain(right);
    const n1 = perp(u1), n0 = perp(u0);
    const capEnd = capArcs(last[3], n1, u1, r, enterScale, fitTol);           // left end -> right end
    const rrev = reverseSegs(right);
    const capStart = capArcs(first[0], mulv(n0, -1), mulv(u0, -1), r, enterScale, fitTol); // right start -> left start
    // stitch: left … end cap … reversed right … start cap, watertight
    const loop = [];
    const push = (segs) => { for (const s of segs) { if (loop.length) s[0] = loop[loop.length - 1][3]; loop.push(s); } };
    push(left); push(capEnd); push(rrev); push(capStart);
    if (loop.length) loop[loop.length - 1][3] = loop[0][0]; // close exactly
    return loop;
}

/**
 * Build the outline loops for a stroke.
 * @param {Array<[number,number]>} pts centerline points (frame units)
 * @param {number} width stroke width (frame units)
 * @param {object} opts { curved, fitTol, lineTol, enterScale }
 * @returns {Array<Array<[p0,c1,c2,p1]>>} closed loops of absolute cubics
 */
export function strokeOutlineCurves(pts, width, opts = {}) {
    const r = width / 2;
    const fitTol = opts.fitTol > 0 ? opts.fitTol : r * 1e-3;
    const lineTol = opts.lineTol > 0 ? opts.lineTol : fitTol;
    const enterScale = opts.enterScale || 1;
    const o = { fitTol, lineTol, enterScale };
    if (!pts || !pts.length || !(width > 0)) return [];
    if (pts.length === 1) return [circleLoop(pts[0], r, enterScale, fitTol)];

    // centerline pieces: the exact Two.js spline's cubics, or raw segments
    const pieces = [];
    if (opts.curved && pts.length > 2) {
        const n = pts.length, last = n - 1;
        const ctrl = new Array(n);
        for (let i = 0; i < n; i++) ctrl[i] = controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, last)]);
        for (let i = 1; i < n; i++) pieces.push([pts[i - 1], ctrl[i - 1].right, ctrl[i].left, pts[i]]);
    } else {
        for (let i = 1; i < pts.length; i++) pieces.push(lineCubic(pts[i - 1], pts[i]));
    }
    // Group tangent-continuous tame pieces into runs (one cap pair per run);
    // wild pieces (curvature near 1/r, sharp turns, degenerate tangents) get
    // single-piece capsules whose cap overlap keeps the ink pocket-proof.
    const loops = [];
    let run = [];
    const flush = () => {
        if (!run.length) return;
        const loop = runCapsule(run, r, o);
        if (loop && loop.length) loops.push(loop);
        run = [];
    };
    for (const c of pieces) {
        if (tamePiece(c, r)) { run.push(c); continue; }
        flush();
        const loop = runCapsule([c], r, o);
        if (loop && loop.length) loops.push(loop);
    }
    flush();
    // every piece degenerate (all points coincide): it's a dot
    if (!loops.length) loops.push(circleLoop(pts[0], r, enterScale, fitTol));
    return loops;
}

// ---- flatten (tests + hit helpers; NOT used in the render hot path) ----
export function flattenLoops(loops, tol) {
    const polys = [];
    for (const loop of loops) {
        const poly = [];
        for (const seg of loop) flattenSeg(seg, tol * tol, poly);
        if (poly.length >= 3) polys.push(poly);
    }
    return polys;
}
function flattenSeg(c, tol2, out, depth = 0) {
    if (!out.length) out.push([c[0][0], c[0][1]]);
    const dev = chordDeviation(c);
    if (dev * dev <= tol2 || depth > 16) { out.push([c[3][0], c[3][1]]); return; }
    const [l, r] = splitCubic(c, 0.5);
    flattenSeg(l, tol2, out, depth + 1);
    flattenSeg(r, tol2, out, depth + 1);
}
