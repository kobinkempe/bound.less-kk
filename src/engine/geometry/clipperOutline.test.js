/**
 * Regression tests for the pure-geometry layer. These pin down the exact
 * behaviours the engine's losslessness arguments rest on: flatten fidelity
 * (incl. the collinear-overshoot guard), segment-distance decimation, the
 * winding compensation in the float ring clip, and stroke-outline shape.
 */
import { strokeOutline, strokeStripNear, clipRingsToRect, clipPolylineToRect, flattenCurve, flattenCurveNear, decimatePolyline } from "./clipperOutline";

// point -> polyline distance (min over segments)
function distToPolyline(pts, p) {
    if (pts.length === 1) return Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]);
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
        if (d < best) best = d;
    }
    return best;
}
// nonzero winding of p w.r.t. rings
function winding(rings, p) {
    let w = 0;
    for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
            const a = r[i], b = r[(i + 1) % n];
            if (a[1] <= p[1]) { if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++; }
            else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
        }
    }
    return w;
}
function ringArea(r) {
    let a = 0;
    for (let i = 0, n = r.length; i < n; i++) {
        const p = r[i], q = r[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}

describe("flattenCurve", () => {
    const anchors = [[0, 0], [40, 30], [80, -10], [120, 25], [160, 0], [200, 40]];

    test("keeps the endpoints exactly", () => {
        const out = flattenCurve(anchors, 0.5);
        expect(out[0]).toEqual([0, 0]);
        expect(out[out.length - 1]).toEqual([200, 40]);
    });

    test("a coarse flatten stays within tol of the true curve", () => {
        // The fine polyline (tol/100) stands in for the true spline; every fine
        // vertex must lie within tol (+ the fine error) of the coarse polyline.
        const tol = 1;
        const coarse = flattenCurve(anchors, tol);
        const fine = flattenCurve(anchors, tol / 100);
        for (const p of fine) expect(distToPolyline(coarse, p)).toBeLessThan(tol * 1.05 + 0.01);
    });

    test("collinear overshoot (sharp reversal) still subdivides", () => {
        // Handles pointing ALONG the chord used to pass the perpendicular-only
        // flatness test while the curve overshot the chord ends.
        const rev = [[0, 0], [100, 0], [2, 0.5]];
        const tol = 0.5;
        const coarse = flattenCurve(rev, tol);
        const fine = flattenCurve(rev, tol / 100);
        for (const p of fine) expect(distToPolyline(coarse, p)).toBeLessThan(tol * 1.05 + 0.01);
        expect(coarse.length).toBeGreaterThan(3); // it actually subdivided
    });
});

describe("flattenCurveNear (windowed flatten for oversized strokes)", () => {
    // A mega-magnified stroke (like a native projected up several levels):
    // anchors spanning ~1e8 units around a small window.
    const R = 1e6;
    const mega = [];
    for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI;
        mega.push([Math.cos(a) * R, Math.sin(a) * R - R]); // huge arc through ~(0,0)
    }
    const rect = { left: -300, top: -300, right: 300, bottom: 300 };

    test("stays small overall but full-fidelity near the window", () => {
        const tol = 0.5;
        const out = flattenCurveNear(mega, tol, rect, 0, 5000);
        // a full flatten at tol 0.5 needs ~ piR/sqrt(8*R*tol) ~ 1,500+ chords;
        // the windowed one must collapse everything far from the window
        expect(out.length).toBeLessThan(300);
        // near the window it must match a locally-accurate reference: a much
        // finer full flatten (chord spacing ~sqrt(8*R*0.005) ~ 200 units)
        const fine = flattenCurve(mega, 0.005);
        const nearFine = fine.filter(([x, y]) => Math.abs(x) < 2000 && Math.abs(y) < 2000);
        expect(nearFine.length).toBeGreaterThan(3); // the curve does pass the window
        for (const p of nearFine) {
            let best = Infinity;
            for (let i = 0; i < out.length - 1; i++) {
                const a = out[i], b = out[i + 1];
                const dx = b[0] - a[0], dy = b[1] - a[1];
                const L2 = dx * dx + dy * dy;
                let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
                if (d < best) best = d;
            }
            expect(best).toBeLessThan(tol * 1.1 + 0.005);
        }
    });

    test("far from the window it collapses to coarse chords", () => {
        const farRect = { left: 9e6, top: 9e6, right: 9e6 + 600, bottom: 9e6 + 600 };
        const out = flattenCurveNear(mega, 0.5, farRect, 0, 5000);
        expect(out.length).toBeLessThanOrEqual(mega.length + 2); // pruned everywhere
    });
});

describe("decimatePolyline", () => {
    test("stays within tol and keeps endpoints", () => {
        const pts = [];
        for (let i = 0; i <= 400; i++) pts.push([i, 20 * Math.sin(i / 15) + 0.3 * Math.sin(i * 2)]);
        const tol = 0.5;
        const dec = decimatePolyline(pts, tol);
        expect(dec.length).toBeLessThan(pts.length / 3);
        expect(dec[0]).toEqual(pts[0]);
        expect(dec[dec.length - 1]).toEqual(pts[pts.length - 1]);
        for (const p of pts) expect(distToPolyline(dec, p)).toBeLessThanOrEqual(tol + 1e-9);
    });
});

describe("clipPolylineToRect", () => {
    const rect = { left: 0, top: 0, right: 100, bottom: 100 };

    test("inside / crossing / outside", () => {
        expect(clipPolylineToRect([[10, 10], [90, 90]], rect)).toEqual([[[10, 10], [90, 90]]]);
        const runs = clipPolylineToRect([[-50, 50], [150, 50]], rect);
        expect(runs.length).toBe(1);
        expect(runs[0][0]).toEqual([0, 50]);
        expect(runs[0][runs[0].length - 1]).toEqual([100, 50]);
        expect(clipPolylineToRect([[-50, -50], [-10, -30]], rect)).toEqual([]);
    });

    test("a polyline that leaves and re-enters yields two runs", () => {
        const runs = clipPolylineToRect([[-10, 10], [50, 10], [110, 10], [110, 90], [50, 90]], rect);
        expect(runs.length).toBe(2);
    });
});

describe("clipRingsToRect (float clip + winding compensation)", () => {
    const rect = { left: -2, top: -2, right: 2, bottom: 2 };

    test("a ring covering the rect clips to full coverage", () => {
        const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
        const out = clipRingsToRect([ring], rect);
        expect(winding(out, [0.3, 0.2])).not.toBe(0);
    });

    test("a concave ring WRAPPING the rect leaves it empty (regression)", () => {
        // Square donut with a slit: the rect sits in the cavity. Plain
        // Sutherland-Hodgman reports full coverage here; the probe-measured
        // winding compensation must cancel it.
        const donut = [
            [-0.1, -10], [-10, -10], [-10, 10], [10, 10], [10, -10], [0.1, -10],
            [0.1, -5], [5, -5], [5, 5], [-5, 5], [-5, -5], [-0.1, -5],
        ];
        expect(winding([donut], [0.3, 0.2])).toBe(0); // sanity: cavity is empty in the source
        const out = clipRingsToRect([donut], rect);
        expect(winding(out, [0.3, 0.2])).toBe(0);
    });

    test("holes survive (opposite-winding inner ring still cuts)", () => {
        const outer = [[-50, -50], [50, -50], [50, 50], [-50, 50]];
        const hole = [[-20, -20], [-20, 20], [20, 20], [20, -20]]; // reversed orientation
        const r = { left: -30, top: -30, right: 30, bottom: 30 };
        const out = clipRingsToRect([outer, hole], r);
        expect(winding(out, [25, 0])).not.toBe(0); // between hole and outer: ink
        expect(winding(out, [0.3, 0.2])).toBe(0);  // inside the hole: empty
    });
});

describe("strokeStripNear (analytic band for oversized strokes)", () => {
    // Ground truth: a point is inside the stroke's ink iff its distance to the
    // centerline polyline is <= width/2 (round caps included via endpoint
    // distance). The strip must reproduce that exactly INSIDE the window.
    test("matches true band membership inside the window", () => {
        const run = [[-5000, -180], [-800, -60], [900, 40], [5200, 260]]; // near-straight, spans far past the window
        const width = 900; // band edge crosses the window
        const rect = { left: -300, top: -300, right: 300, bottom: 300 };
        const rings = strokeStripNear(run, width, rect, { startCap: true, endCap: true });
        expect(rings.length).toBeGreaterThan(0);
        let checked = 0;
        for (let gx = 0; gx <= 20; gx++) for (let gy = 0; gy <= 20; gy++) {
            const p = [rect.left + (600 * gx) / 20, rect.top + (600 * gy) / 20];
            const d = distToPolyline(run, p);
            if (Math.abs(d - width / 2) < 2) continue; // skip the edge itself (tessellation tolerance)
            expect(winding(rings, p) !== 0).toBe(d < width / 2);
            checked++;
        }
        expect(checked).toBeGreaterThan(300);
    });

    test("a visible true-end cap is reproduced by the sector piece", () => {
        // stroke END sits left of the window; its round cap edge crosses the window
        const run = [[-9000, 0], [-450, 0]];
        const width = 800; // cap disc radius 400 centred at (-450, 0): edge at x = -50
        const rect = { left: -300, top: -300, right: 300, bottom: 300 };
        const rings = strokeStripNear(run, width, rect, { startCap: false, endCap: true });
        for (let gy = -280; gy <= 280; gy += 70) {
            for (const [x, expectInk] of [[-120, true], [200, false]]) {
                const p = [x, gy];
                const d = distToPolyline(run, p);
                if (Math.abs(d - width / 2) < 2) continue;
                expect(winding(rings, p) !== 0).toBe(d < width / 2);
                expect(winding(rings, p) !== 0).toBe(expectInk && d < width / 2);
            }
        }
    });

    test("a sharp CONCAVE corner stays solid — no hourglass hole (regression)", () => {
        // A right-angle turn: the inner-side offsets cross. The old single miter
        // ribbon (L forward, R reversed) folded a reversed sub-loop there, so
        // nonzero fill zeroed the winding and punched a hole — a fat stroke with
        // an inside corner became an hourglass after a level crossing. Band
        // membership = distance-to-polyline (a round-joined, round-capped stroke),
        // which the rectangles + round joins reproduce with NO hole and no spill.
        const run = [[-300, 0], [0, 0], [0, 300]];
        const half = 60, width = 2 * half; // the band's inner overlap sits well inside the window
        const rect = { left: -200, top: -200, right: 200, bottom: 200 };
        const rings = strokeStripNear(run, width, rect, { startCap: true, endCap: true });
        let insideChecked = 0, cornerInk = 0;
        for (let gx = 0; gx <= 40; gx++) for (let gy = 0; gy <= 40; gy++) {
            const p = [rect.left + (400 * gx) / 40, rect.top + (400 * gy) / 40];
            const d = distToPolyline(run, p);
            const ink = winding(rings, p) !== 0;
            if (d < half - 5) { insideChecked++; expect(ink).toBe(true); } // NO hole anywhere in the band (the bug)
            else if (d > half + 60) expect(ink).toBe(false);               // no runaway spill (miter tips stay local)
            // the previously-holed region: the concave overlap up-left of the corner
            if (d < half && p[0] > -60 && p[0] < -8 && p[1] > 8 && p[1] < 60 && ink) cornerInk++;
        }
        expect(insideChecked).toBeGreaterThan(200);
        expect(cornerInk).toBeGreaterThan(10); // the concave overlap is solid, not an hourglass
    });
});

describe("strokeOutline", () => {
    test("a single point becomes a dot of radius width/2", () => {
        const rings = strokeOutline([[10, 20]], 4);
        expect(rings.length).toBeGreaterThan(0);
        for (const ring of rings) for (const p of ring) {
            const d = Math.hypot(p[0] - 10, p[1] - 20);
            expect(d).toBeGreaterThan(1.8);
            expect(d).toBeLessThan(2.05);
        }
    });

    test("a straight segment becomes a capsule of the right size", () => {
        const rings = strokeOutline([[0, 0], [100, 0]], 10);
        expect(rings.length).toBe(1);
        const ring = rings[0];
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of ring) {
            x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
            y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
        }
        expect(Math.abs(x0 - -5)).toBeLessThan(0.3);
        expect(Math.abs(x1 - 105)).toBeLessThan(0.3);
        expect(Math.abs(y0 - -5)).toBeLessThan(0.3);
        expect(Math.abs(y1 - 5)).toBeLessThan(0.3);
        const want = 100 * 10 + Math.PI * 25; // rectangle + two half-disc caps
        expect(Math.abs(Math.abs(ringArea(ring)) - want) / want).toBeLessThan(0.02);
    });

    test("a self-crossing stroke unions cleanly", () => {
        const rings = strokeOutline([[0, 0], [100, 100], [100, 0], [0, 100]], 8);
        expect(rings.length).toBeGreaterThan(0);
        expect(winding(rings, [50, 50])).not.toBe(0); // the crossing point is ink, once-filled
    });
});
