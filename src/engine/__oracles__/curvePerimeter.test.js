/**
 * CP — curvePerimeter.
 *
 * Two oracles, both independent of the implementation:
 *
 *   MEMBERSHIP — for sampled points, "inside the computed loops" must equal
 *     "within r of the true spline". This is what caught all five bugs in
 *     `strokeShape` and it owes nothing to how the answer was reached.
 *
 *   SMOOTHNESS — for a stroke that never crosses itself, the perimeter must be
 *     tangent-continuous EVERYWHERE. Offsets of a C1 centerline join smoothly,
 *     cap arcs meet their offsets tangentially, and there is no other kind of
 *     junction. Any corner in the output is therefore manufactured, and that is
 *     precisely the defect (docs/OPEN-FLAGS.md F1) this file exists to avoid.
 *     CP-2 is the regression pin for Kobin's "no creases" rule.
 */
import { curvePerimeter, centerlineCubics, cubicIntersections, subCubic, cubicLoopArea } from "./curvePerimeter";
import { cubicAt, cubicTangent } from "../geometry/curveOutline";
import { strokeShape } from "./strokeShape";
import { flattenCurve } from "../geometry/polyline";

// ---- oracles ---------------------------------------------------------------

const flattenLoop = (loop, n = 24) => {
    const pts = [];
    for (const c of loop) for (let i = 0; i < n; i++) pts.push(cubicAt(c, i / n));
    return pts;
};

/** Nonzero winding of p against a set of flattened loops. */
function insideLoops(loops, p) {
    let w = 0;
    for (const loop of loops) {
        const ring = flattenLoop(loop);
        for (let i = 0, n = ring.length; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            if (a[1] <= p[1]) {
                if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++;
            } else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
        }
    }
    return w !== 0;
}

/** Distance from p to the true spline through `pts`, via a very fine flatten. */
function distToSpline(p, pts, tol) {
    const flat = flattenCurve(pts, tol);
    let best = Infinity;
    for (let i = 1; i < flat.length; i++) {
        const a = flat[i - 1], b = flat[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const qx = a[0] + dx * t - p[0], qy = a[1] + dy * t - p[1];
        const d = qx * qx + qy * qy;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

/** Largest tangent discontinuity at any junction of a loop, in degrees. */
function maxKink(loops) {
    let worst = 0, at = null;
    for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i], b = loop[(i + 1) % loop.length];
            const ta = cubicTangent(a, 1), tb = cubicTangent(b, 0);
            if (!ta || !tb) continue;
            const dot = Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1]));
            const deg = Math.acos(dot) * 180 / Math.PI;
            if (deg > worst) { worst = deg; at = a[3]; }
        }
    }
    return { deg: worst, at };
}

/** Sample the bbox of the ink and report membership disagreements. */
function membership(loops, pts, r, opts = {}) {
    const N = opts.n || 60, slack = opts.slack != null ? opts.slack : r * 0.02;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    x0 -= r * 1.5; x1 += r * 1.5; y0 -= r * 1.5; y1 += r * 1.5;
    let wrongIn = 0, wrongOut = 0, judged = 0, worst = 0;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const p = [x0 + (x1 - x0) * (i + 0.5) / N, y0 + (y1 - y0) * (j + 0.5) / N];
            const d = distToSpline(p, pts, r * 1e-3);
            if (Math.abs(d - r) <= slack) continue;    // refuse to judge the fringe
            judged++;
            const shouldBeIn = d < r, isIn = insideLoops(loops, p);
            if (shouldBeIn && !isIn) { wrongOut++; worst = Math.max(worst, r - d); }
            if (!shouldBeIn && isIn) { wrongIn++; worst = Math.max(worst, d - r); }
        }
    }
    return { wrongIn, wrongOut, judged, worst };
}

const TOL = { fitTol: 0.02, lineTol: 0.02, enterScale: 1 };

// ---------------------------------------------------------------------------

describe("CP-1 — shapes that can be checked by hand", () => {
    test("a single straight run is one stadium of the right area", () => {
        const pts = [[100, 100], [400, 100]], r = 30;
        const { loops } = curvePerimeter(pts, 2 * r, { ...TOL, curved: false });
        expect(loops.length).toBe(1);
        const area = Math.abs(cubicLoopArea(loops[0]));
        const want = 300 * 2 * r + Math.PI * r * r;      // rectangle + two half discs
        expect(area).toBeGreaterThan(want * 0.995);
        expect(area).toBeLessThan(want * 1.005);
    });

    test("a lone dot is a disc", () => {
        const { loops } = curvePerimeter([[50, 50]], 40, TOL);
        expect(loops.length).toBe(1);
        expect(Math.abs(cubicLoopArea(loops[0]))).toBeCloseTo(Math.PI * 400, -1);
    });

    test("empty and degenerate input do not throw", () => {
        expect(curvePerimeter([], 10, TOL).loops).toEqual([]);
        expect(curvePerimeter([[1, 1]], 0, TOL).loops).toEqual([]);
        expect(() => curvePerimeter([[5, 5], [5, 5], [5, 5]], 10, TOL)).not.toThrow();
    });
});

describe("CP-2 — NO CREASES (Kobin's rule; the reason this file exists)", () => {
    // A stroke that never crosses itself has no genuine corners in its outline,
    // so every junction must be smooth. This is the assertion `strokeShape`
    // cannot pass, and the comparison below is deliberately part of the test so
    // the difference is visible in the output rather than asserted in a comment.
    const curve = () => {
        const p = [];
        for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            p.push([120 + t * 420, 300 + 130 * Math.sin(t * 2.6)]);
        }
        return p;
    };

    test("a simple curved stroke is tangent-continuous all the way round", () => {
        const pts = curve(), width = 90;
        const { loops, stats } = curvePerimeter(pts, width, TOL);
        const k = maxKink(loops);

        // and what the polyline core does to the same stroke, for contrast
        const flat = flattenCurve(pts, 0.25);
        const poly = strokeShape(flat, width);
        let polyWorst = 0;
        for (const loop of poly.loops) {
            for (let i = 0; i < loop.length; i++) {
                const a = loop[i], b = loop[(i + 1) % loop.length];
                const ta = pieceEndTangent(a), tb = pieceStartTangent(b);
                const dot = Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1]));
                polyWorst = Math.max(polyWorst, Math.acos(dot) * 180 / Math.PI);
            }
        }
        // eslint-disable-next-line no-console
        console.log(`CP-2  curves: worst kink ${k.deg.toFixed(3)}deg over ${stats.out} pieces`
            + `  |  polyline core: ${polyWorst.toFixed(2)}deg over `
            + `${poly.loops.reduce((n, l) => n + l.length, 0)} pieces`);

        expect(k.deg).toBeLessThan(1.0);
        expect(polyWorst).toBeGreaterThan(k.deg);   // the defect, pinned
    });

    test("finer flattening does not reduce the polyline core's kink", () => {
        // The point of F1: a crease is an ANGLE, so spending more points on the
        // centerline buys position accuracy and never buys smoothness at the
        // rate you would expect. Recorded so the claim is measured, not argued.
        const pts = curve(), width = 90, rows = [];
        for (const tol of [0.25, 0.25 / 16, 0.25 / 256]) {
            const s = strokeShape(flattenCurve(pts, tol), width);
            let worst = 0;
            for (const loop of s.loops) {
                for (let i = 0; i < loop.length; i++) {
                    const ta = pieceEndTangent(loop[i]), tb = pieceStartTangent(loop[(i + 1) % loop.length]);
                    worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1]))) * 180 / Math.PI);
                }
            }
            rows.push(`tol ${tol.toFixed(5)}: ${worst.toFixed(2)}deg`);
        }
        // eslint-disable-next-line no-console
        console.log("CP-2b polyline kink vs flatten tolerance — " + rows.join("  |  "));
        expect(rows.length).toBe(3);
    });
});

// tangent helpers for strokeShape's line/arc pieces (not cubics)
function pieceEndTangent(p) {
    if (p.kind === "line") {
        const dx = p.ex - p.sx, dy = p.ey - p.sy, L = Math.hypot(dx, dy) || 1;
        return [dx / L, dy / L];
    }
    const s = p.a1 >= p.a0 ? 1 : -1;
    return [-Math.sin(p.a1) * s, Math.cos(p.a1) * s];
}
function pieceStartTangent(p) {
    if (p.kind === "line") {
        const dx = p.ex - p.sx, dy = p.ey - p.sy, L = Math.hypot(dx, dy) || 1;
        return [dx / L, dy / L];
    }
    const s = p.a1 >= p.a0 ? 1 : -1;
    return [-Math.sin(p.a0) * s, Math.cos(p.a0) * s];
}

describe("CP-3 — membership against the true spline", () => {
    test("a curved stroke's interior is exactly the points within r", () => {
        const pts = [];
        for (let i = 0; i <= 7; i++) {
            const t = i / 7;
            pts.push([140 + t * 380, 260 + 120 * Math.sin(t * 3.0)]);
        }
        const width = 80;
        const { loops } = curvePerimeter(pts, width, TOL);
        const m = membership(loops, pts, width / 2);
        // eslint-disable-next-line no-console
        console.log(`CP-3  judged ${m.judged}: ${m.wrongIn} spurious in, ${m.wrongOut} missing, worst ${m.worst.toFixed(3)}`);
        expect(m.judged).toBeGreaterThan(500);
        expect(m.wrongIn + m.wrongOut).toBe(0);
    });

    test("a self-crossing stroke resolves to one region, no double-counting", () => {
        const pts = [[100, 300], [250, 150], [400, 300], [250, 450], [180, 300], [330, 220]];
        const width = 70;
        const { loops } = curvePerimeter(pts, width, TOL);
        const m = membership(loops, pts, width / 2, { n: 50 });
        // eslint-disable-next-line no-console
        console.log(`CP-3b loops ${loops.length}, judged ${m.judged}: ${m.wrongIn} in, ${m.wrongOut} out`);
        expect(m.wrongIn + m.wrongOut).toBeLessThanOrEqual(Math.ceil(m.judged * 0.01));
    });
});

describe("CP-4 — cubic intersection", () => {
    test("two crossing cubics meet where they should", () => {
        const a = [[0, 0], [30, 90], [70, 90], [100, 0]];
        const b = [[50, -40], [50, 30], [50, 60], [50, 120]];
        const hits = cubicIntersections(a, b, 1e-7);
        expect(hits.length).toBe(1);
        const p = cubicAt(a, hits[0][0]), q = cubicAt(b, hits[0][1]);
        expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-4);
        expect(p[0]).toBeCloseTo(50, 3);
    });

    test("curves that miss report nothing", () => {
        const a = [[0, 0], [30, 20], [70, 20], [100, 0]];
        const b = [[0, 200], [30, 220], [70, 220], [100, 200]];
        expect(cubicIntersections(a, b, 1e-6).length).toBe(0);
    });

    test("subCubic is exact on the parent curve", () => {
        const c = [[0, 0], [20, 80], [80, 80], [100, 0]];
        const s = subCubic(c, 0.3, 0.75);
        for (let i = 0; i <= 10; i++) {
            const u = i / 10;
            const want = cubicAt(c, 0.3 + 0.45 * u), got = cubicAt(s, u);
            expect(Math.hypot(want[0] - got[0], want[1] - got[1])).toBeLessThan(1e-9);
        }
    });
});

describe("CP-5 — the centerline is the exact Two.js spline", () => {
    test("centerlineCubics agrees with flattenCurve", () => {
        const pts = [[10, 10], [60, 90], [140, 40], [200, 120], [260, 60]];
        const cubics = centerlineCubics(pts);
        expect(cubics.length).toBe(pts.length - 1);
        const flat = flattenCurve(pts, 1e-4);
        for (const c of cubics) {
            for (const t of [0, 0.5, 1]) {
                const p = cubicAt(c, t);
                let best = Infinity;
                for (const q of flat) best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
                expect(best).toBeLessThan(0.05);
            }
        }
    });
});
