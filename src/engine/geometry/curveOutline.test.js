/**
 * curveOutline — the resolution-independent stroke outline. The contract under
 * test: every point of the TRUE outline boundary (spline ± width/2, sampled
 * densely) lies within fitTol of the built outline; ink coverage is solid
 * (centerline in, far field out) even across cusps; loops are watertight; and
 * the lineTol constant turns straight-enough pieces into exact line capsules.
 */
import { strokeOutlineCurves, flattenLoops } from "./curveOutline";
import { controlsFor, flattenCurve } from "./clipperOutline";
import { windingOfPoint, distToPolyline } from "./hittest";

const ENTER = 300;
const FIT = (0.25 * 0.5) / ENTER; // 0.25 px at the deepest zoom, in frame units

const opts = { curved: true, fitTol: FIT, lineTol: FIT, enterScale: ENTER };

// distance from p to the outline BOUNDARY (flattened fine, closed rings)
function boundaryDist(polys, p) {
    let best = Infinity;
    for (const poly of polys) {
        const ring = poly.concat([poly[0]]);
        const d = distToPolyline(ring, p);
        if (d < best) best = d;
    }
    return best;
}
const inked = (polys, p) => windingOfPoint(polys, p) !== 0;

// true outline boundary samples, computed EXACTLY from the spline's cubics
// (point ± true unit normal × r) — chord normals off a flattened polyline are
// r·Δθ wrong, which would swamp the tolerance being verified.
function cubicAt(c, t) {
    const s = 1 - t;
    const a = s * s * s, b = 3 * s * s * t, d = 3 * s * t * t, e = t * t * t;
    return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0],
            a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}
function cubicNormal(c, t) {
    const s = 1 - t;
    let dx = 3 * s * s * (c[1][0] - c[0][0]) + 6 * s * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]);
    let dy = 3 * s * s * (c[1][1] - c[0][1]) + 6 * s * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1]);
    let L = Math.hypot(dx, dy);
    if (L < 1e-9) { // degenerate handle: central difference recovers the limit tangent
        const h = 1e-4;
        const p0 = cubicAt(c, Math.max(0, t - h)), p1 = cubicAt(c, Math.min(1, t + h));
        dx = p1[0] - p0[0]; dy = p1[1] - p0[1]; L = Math.hypot(dx, dy);
        if (L < 1e-12) return null;
    }
    return [-dy / L, dx / L];
}
function trueBoundarySamples(pts, r) {
    const n = pts.length, last = n - 1;
    const ctrl = [];
    for (let i = 0; i < n; i++) ctrl.push(controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, last)]));
    const out = [];
    for (let i = 1; i < n; i++) {
        const c = [pts[i - 1], ctrl[i - 1].right, ctrl[i].left, pts[i]];
        for (let k = 1; k < 24; k++) {
            const t = k / 24;
            const nrm = cubicNormal(c, t);
            if (!nrm) continue;
            const q = cubicAt(c, t);
            out.push([q[0] + nrm[0] * r, q[1] + nrm[1] * r]);
            out.push([q[0] - nrm[0] * r, q[1] - nrm[1] * r]);
        }
    }
    return out;
}

test("straight stroke: rectangle sides and semicircle caps within tolerance", () => {
    const pts = [[100, 100], [300, 100]];
    const r = 10;
    const loops = strokeOutlineCurves(pts, 2 * r, { ...opts, curved: false });
    expect(loops).toHaveLength(1);
    const polys = flattenLoops(loops, FIT * 0.25);
    // sides
    for (let x = 100; x <= 300; x += 10) {
        expect(boundaryDist(polys, [x, 90])).toBeLessThan(FIT * 2);
        expect(boundaryDist(polys, [x, 110])).toBeLessThan(FIT * 2);
    }
    // caps: sample the true end semicircles
    for (let a = -Math.PI / 2; a <= Math.PI / 2; a += Math.PI / 16) {
        expect(boundaryDist(polys, [300 + r * Math.cos(a), 100 + r * Math.sin(a)])).toBeLessThan(FIT * 2);
        expect(boundaryDist(polys, [100 - r * Math.cos(a), 100 + r * Math.sin(a)])).toBeLessThan(FIT * 2);
    }
    // coverage
    expect(inked(polys, [200, 100])).toBe(true);
    expect(inked(polys, [200, 100 + r - 0.5])).toBe(true);
    expect(inked(polys, [200, 100 + r + 0.5])).toBe(false);
    expect(inked(polys, [305 + r, 100])).toBe(false);
});

test("curved stroke: the fitted offset tracks the true spline offset within fitTol", () => {
    const pts = [[100, 300], [180, 220], [260, 300], [340, 240], [420, 300]];
    const r = 8;
    const loops = strokeOutlineCurves(pts, 2 * r, opts);
    const polys = flattenLoops(loops, FIT * 0.25);
    const samples = trueBoundarySamples(pts, r);
    expect(samples.length).toBeGreaterThan(100);
    let worst = 0;
    for (const s of samples) worst = Math.max(worst, boundaryDist(polys, s));
    expect(worst).toBeLessThan(FIT * 2.5); // fit + flatten + sampling slack
    // solid ink along the whole centerline, clean far field
    const center = flattenCurve(pts, FIT);
    for (let i = 0; i < center.length; i += 25) expect(inked(polys, center[i])).toBe(true);
    expect(inked(polys, [100, 100])).toBe(false);
    expect(inked(polys, [420, 400])).toBe(false);
});

test("hairpin (curvature radius < width/2): no pockets — ink stays solid through the cusp region", () => {
    // a tight 180° turn whose inner offset self-intersects
    const pts = [[100, 300], [200, 300], [230, 280], [200, 260], [100, 260]];
    const r = 30; // much larger than the 20-unit turn radius
    const loops = strokeOutlineCurves(pts, 2 * r, opts);
    const polys = flattenLoops(loops, FIT * 0.25);
    const center = flattenCurve(pts, FIT);
    for (let i = 0; i < center.length; i += 10) expect(inked(polys, center[i])).toBe(true);
    // points just inside the band near the turn are covered (winding never cancels)
    expect(inked(polys, [215, 280])).toBe(true);
    expect(inked(polys, [200, 280])).toBe(true);
    // far field clean
    expect(inked(polys, [400, 280])).toBe(false);
    expect(inked(polys, [100, 400])).toBe(false);
});

test("dot (1-point stroke) is a circle within tolerance", () => {
    const r = 6.5;
    const loops = strokeOutlineCurves([[50, 50]], 2 * r, opts);
    expect(loops).toHaveLength(1);
    const polys = flattenLoops(loops, FIT * 0.25);
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 12) {
        expect(boundaryDist(polys, [50 + r * Math.cos(a), 50 + r * Math.sin(a)])).toBeLessThan(FIT * 2);
    }
    expect(inked(polys, [50, 50])).toBe(true);
    expect(inked(polys, [50 + r + 0.1, 50])).toBe(false);
});

test("lineTol: straight-enough spline pieces become exact line capsules", () => {
    // a 3-pt centerline that is exactly collinear -> spline deviation 0 < any lineTol
    const loops = strokeOutlineCurves([[0, 0], [50, 0], [100, 0]], 10, { ...opts, lineTol: 0.5 });
    // side segments of each capsule must be line-cubics (controls ON the endpoints)
    let lines = 0, curves = 0;
    for (const loop of loops) {
        for (const [p0, c1, c2, p1] of loop) {
            const isLine = c1[0] === p0[0] && c1[1] === p0[1] && c2[0] === p1[0] && c2[1] === p1[1];
            if (isLine) lines++; else curves++;
        }
    }
    expect(lines).toBeGreaterThanOrEqual(4);     // 2 sides x 2 capsules
    // the only curves are cap arcs: 2 caps x 2 segs x 2 capsules = 8 at small radius
    expect(curves).toBeLessThanOrEqual(2 * loops.length * 4);
});

test("loops are watertight and share one orientation", () => {
    const pts = [[100, 300], [180, 220], [260, 300], [340, 240]];
    const loops = strokeOutlineCurves(pts, 16, opts);
    // tame pieces merge into runs: at least one loop, never more than one per piece
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(loops.length).toBeLessThanOrEqual(pts.length - 1);
    let firstSign = 0;
    for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
            const cur = loop[i], nxt = loop[(i + 1) % loop.length];
            expect(cur[3][0]).toBe(nxt[0][0]); // exact, not approximate
            expect(cur[3][1]).toBe(nxt[0][1]);
        }
        // signed area of the flattened loop -> orientation
        const poly = flattenLoops([loop], FIT)[0];
        let area = 0;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            area += a[0] * b[1] - b[0] * a[1];
        }
        const sign = Math.sign(area);
        if (!firstSign) firstSign = sign;
        expect(sign).toBe(firstSign);
    }
});

test("huge on-screen cap radius: arcs subdivide to hold the pixel budget", () => {
    // lwFrame 130 (13px pen drawn just after entry) -> cap radius 65 frame units
    // = 19,500 px at the deepest zoom; a 2-cubic semicircle would err ~5 px.
    const r = 65;
    const loops = strokeOutlineCurves([[0, 0], [400, 0]], 2 * r, { ...opts, curved: false });
    const polys = flattenLoops(loops, FIT * 0.25);
    let worst = 0;
    for (let a = -Math.PI / 2; a <= Math.PI / 2; a += Math.PI / 48) {
        worst = Math.max(worst, boundaryDist(polys, [400 + r * Math.cos(a), r * Math.sin(a)]));
    }
    // FIT is the frame-unit budget for 0.25 px at enter; allow small slack
    expect(worst).toBeLessThan(FIT * 2);
    // and the cap really did subdivide beyond the classic 2 segments
    const capSegs = loops[0].filter(([p0, c1, c2, p1]) => !(c1[0] === p0[0] && c1[1] === p0[1] && c2[0] === p1[0] && c2[1] === p1[1]));
    expect(capSegs.length).toBeGreaterThan(4);
});

test("degenerate inputs don't crash and still produce ink", () => {
    // duplicate points, zero-length pieces
    const loops = strokeOutlineCurves([[10, 10], [10, 10], [60, 10], [60, 10]], 8, opts);
    const polys = flattenLoops(loops, FIT);
    expect(inked(polys, [35, 10])).toBe(true);
    // all-coincident points behave as a dot
    const dot = strokeOutlineCurves([[5, 5], [5, 5], [5, 5]], 8, opts);
    expect(inked(flattenLoops(dot, FIT), [5, 5])).toBe(true);
});

// sanity: the spline used for centerline pieces is the SAME one Two.js paints
test("centerline pieces reproduce flattenCurve's spline", () => {
    const pts = [[0, 0], [40, 30], [90, 10]];
    const n = pts.length;
    const ctrl = [];
    for (let i = 0; i < n; i++) ctrl.push(controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, n - 1)]));
    // outline of a hair-thin stroke hugs the spline: every flattened spline point
    // is within (width/2 + fitTol) of the outline boundary
    const w = 0.5;
    const loops = strokeOutlineCurves(pts, w, opts);
    const polys = flattenLoops(loops, FIT * 0.25);
    const spline = flattenCurve(pts, FIT * 0.2);
    for (let i = 0; i < spline.length; i += 20) {
        expect(boundaryDist(polys, spline[i])).toBeLessThanOrEqual(w / 2 + FIT * 2);
    }
});
