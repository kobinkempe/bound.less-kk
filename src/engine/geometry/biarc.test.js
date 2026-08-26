import {
    arcThrough, arcPoint, arcTangent, arcDist, biarc, arcsForGap, splineCubics,
    chainFor, BiarcPen, arcToCubics, offsetArc, gapError, arcSagitta, tracePath,
    distinctSamples, MIN_SPAN,
} from "./biarc";
import { cubicAt } from "./curveOutline";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angBetween = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180 / Math.PI;
// `acos` cannot resolve angles below about this: its slope runs to infinity at
// 1, so a dot product one ULP short of exact reads back as ~1e-6 degrees even
// when the two vectors are the identical object. Assertions below this floor
// would be testing Math.acos, not the geometry.
const ACOS_FLOOR = 1e-5;

describe("arcThrough", () => {
    test("quarter circle: unit tangent +x at the origin, through (1,1)", () => {
        const a = arcThrough([0, 0], [1, 0], [1, 1]);
        expect(a.line).toBe(false);
        expect(a.r).toBeCloseTo(1, 12);
        expect(a.C[0]).toBeCloseTo(0, 12);
        expect(a.C[1]).toBeCloseTo(1, 12);
        expect(Math.abs(a.sweep)).toBeCloseTo(Math.PI / 2, 12);
        expect(dist(arcPoint(a, 0), [0, 0])).toBeLessThan(1e-12);
        expect(dist(arcPoint(a, 1), [1, 1])).toBeLessThan(1e-12);
        expect(angBetween(arcTangent(a, 0), [1, 0])).toBeLessThan(ACOS_FLOOR);
    });

    test("collinear points come back as a line, at any distance from the origin", () => {
        expect(arcThrough([0, 0], [1, 0], [5, 0]).line).toBe(true);
        expect(arcThrough([1e5, 1e5], [1, 0], [1e5 + 5, 1e5]).line).toBe(true);
    });
});

describe("arcDist", () => {
    // The bug this exists for: a reversed arc's `a0` can sit outside [-pi,pi],
    // and a naive branch test then reports a point in the MIDDLE of the arc as
    // off its end — returning a distance the size of the whole arc.
    test("a point on a reversed, nearly-flat arc reads as on it", () => {
        const P0 = [1056.51, 665.77], P1 = [1049.87, 1116.9];
        const T0 = [-0.0206, 0.9998], T1 = [0.0043, 0.99999];
        const [, a2] = biarc(P0, T0, P1, T1);
        const mid = arcPoint(a2, 0.5);
        expect(arcDist(a2, mid)).toBeLessThan(1e-9);
    });

    test("distance off the end is measured to the end", () => {
        const a = arcThrough([0, 0], [1, 0], [1, 1]);
        expect(arcDist(a, [-3, 0])).toBeCloseTo(3, 9);
    });
});

describe("biarc", () => {
    test("interpolates both ends and is tangent-continuous at the joint", () => {
        // `biarc` takes UNIT tangents by contract, so the fixtures are normalised
        // here rather than written out by hand — a fixture that is 1.5e-4 long
        // of unit reads back as a one-degree tangent error and looks like a bug
        // in the construction.
        const unit = (v) => { const L = Math.hypot(v[0], v[1]); return [v[0] / L, v[1] / L]; };
        const cases = [
            [[0, 0], [1, 0], [10, 5], [0, 1]],
            [[0, 0], [1, 0], [10, -5], [0, -1]],
            [[0, 0], [1, 0], [3, 0.001], [0.9998, 0.02]],      // nearly straight
            [[0, 0], [1, 0], [1, 0.2], [-0.99, 0.14]],          // hairpin
            [[0, 0], [0.6, 0.8], [-4, 9], [-0.6, 0.8]],
        ].map(([P0, T0, P1, T1]) => [P0, unit(T0), P1, unit(T1)]);
        for (const [P0, T0, P1, T1] of cases) {
            const [a1, a2] = biarc(P0, T0, P1, T1);
            expect(dist(arcPoint(a1, 0), P0)).toBeLessThan(1e-9);
            expect(dist(arcPoint(a2, 1), P1)).toBeLessThan(1e-9);
            expect(dist(a1.B, a2.A)).toBeLessThan(1e-9);
            expect(angBetween(arcTangent(a1, 0), T0)).toBeLessThan(ACOS_FLOOR);
            expect(angBetween(arcTangent(a2, 1), T1)).toBeLessThan(ACOS_FLOOR);
            // the join is the whole point: a kink here is a crease in the ink
            expect(angBetween(arcTangent(a1, 1), arcTangent(a2, 0))).toBeLessThan(ACOS_FLOOR);
        }
    });

    test("a duplicated sample yields no arcs rather than a NaN one", () => {
        expect(biarc([5, 5], [1, 0], [5, 5], [1, 0])).toEqual([]);
    });
});

describe("chainFor", () => {
    const hand = () => {
        const p = [];
        for (let i = 0; i <= 60; i++) {
            const t = i / 60;
            p.push([100 + t * 600, 300 + 120 * Math.sin(t * 7) + 25 * Math.cos(t * 19)]);
        }
        return p;
    };

    test("without a tolerance it is exactly two arcs per gap", () => {
        const pts = hand();
        const { stats } = chainFor(pts, { tol: 0 });
        expect(stats.gaps).toBe(pts.length - 1);
        expect(stats.arcs).toBe(2 * (pts.length - 1));
        expect(stats.splitGaps).toBe(0);
    });

    test("with a tolerance every gap is inside it", () => {
        const pts = hand();
        for (const tol of [1, 0.25, 0.05, 0.01]) {
            const { gaps, cubics } = chainFor(pts, { tol });
            for (let i = 0; i < cubics.length; i++) {
                expect(gapError(cubics[i], gaps[i], 40)).toBeLessThanOrEqual(tol * 1.6);
            }
        }
    });

    test("tightening the tolerance never removes arcs", () => {
        const pts = hand();
        let prev = 0;
        for (const tol of [4, 1, 0.25, 0.05, 0.01]) {
            const n = chainFor(pts, { tol }).stats.arcs;
            expect(n).toBeGreaterThanOrEqual(prev);
            prev = n;
        }
    });

    test("the chain passes through every sample", () => {
        const pts = hand();
        const { gaps } = chainFor(pts, { tol: 0.25 });
        for (let i = 0; i < gaps.length; i++) {
            expect(dist(gaps[i][0].A, pts[i])).toBeLessThan(1e-9);
            expect(dist(gaps[i][gaps[i].length - 1].B, pts[i + 1])).toBeLessThan(1e-9);
        }
    });

    test("no crease anywhere in the chain, including across gaps", () => {
        const pts = hand();
        const { arcs } = chainFor(pts, { tol: 0.25 });
        let worst = 0;
        for (let i = 1; i < arcs.length; i++) {
            worst = Math.max(worst, angBetween(arcTangent(arcs[i - 1], 1), arcTangent(arcs[i], 0)));
        }
        expect(worst).toBeLessThan(1e-4);
    });

    test("degenerate strokes do not throw", () => {
        expect(chainFor([], {}).stats.arcs).toBe(0);
        expect(chainFor([[1, 1]], {}).stats.arcs).toBe(0);
        expect(chainFor([[1, 1], [1, 1]], {}).stats.arcs).toBe(0);
        expect(chainFor([[0, 0], [10, 0]], {}).stats.arcs).toBeGreaterThan(0);
    });
});

describe("BiarcPen", () => {
    // The claim being tested is that a sample only disturbs its two nearest
    // gaps — if that were wrong the live pen would drift away from the batch
    // result, and the sandbox would be measuring something the bake cannot do.
    test("incremental matches the batch chain exactly", () => {
        const pts = [];
        for (let i = 0; i <= 90; i++) {
            const t = i / 90;
            pts.push([50 + t * 700, 260 + 140 * Math.sin(t * 9) + 18 * Math.cos(t * 31)]);
        }
        for (const tol of [0, 0.25]) {
            const pen = new BiarcPen({ tol });
            for (const p of pts) pen.addSample(p);
            const batch = chainFor(pts, { tol });
            const live = pen.arcs(), want = batch.arcs;
            expect(live.length).toBe(want.length);
            for (let i = 0; i < want.length; i++) {
                expect(dist(live[i].A, want[i].A)).toBeLessThan(1e-9);
                expect(dist(live[i].B, want[i].B)).toBeLessThan(1e-9);
                expect(!!live[i].line).toBe(!!want[i].line);
                if (!want[i].line) expect(live[i].r).toBeCloseTo(want[i].r, 6);
            }
        }
    });

    test("a repeat in the middle of the stream changes nothing", () => {
        // A touch digitizer repeats a coordinate whenever the finger rests. The
        // live pen has to drop it exactly as the batch chain does, or the two
        // stop agreeing the moment the user pauses.
        const clean = wiggle(), paused = withPause(wiggle(), 20, 2);
        const feed = (pts) => {
            const pen = new BiarcPen({ tol: 0.25 });
            for (const p of pts) pen.addSample(p);
            return pen.arcs();
        };
        const a = feed(clean), b = feed(paused);
        expect(b.length).toBe(a.length);
        for (let i = 0; i < a.length; i++) {
            expect(dist(b[i].A, a[i].A)).toBeLessThan(1e-12);
            expect(dist(b[i].B, a[i].B)).toBeLessThan(1e-12);
        }
        // ...and still matches the batch chain fed the same repeats.
        const batch = chainFor(paused, { tol: 0.25 }).arcs;
        expect(batch.length).toBe(a.length);
        for (let i = 0; i < a.length; i++) expect(dist(batch[i].A, a[i].A)).toBeLessThan(1e-12);
    });

    test("survives being fed one point, then a duplicate", () => {
        const pen = new BiarcPen({ tol: 0.25 });
        pen.addSample([3, 3]);
        expect(pen.arcs()).toEqual([]);
        pen.addSample([3, 3]);
        expect(() => pen.arcs()).not.toThrow();
    });
});

describe("offsetArc", () => {
    test("the offset endpoints are exactly the pen distance away", () => {
        const a = arcThrough([0, 0], [1, 0], [60, 30]);
        for (const side of [1, -1]) {
            const o = offsetArc(a, 12, side);
            expect(dist(o.A, arcPoint(a, 0))).toBeCloseTo(12, 9);
            expect(dist(o.B, arcPoint(a, 1))).toBeCloseTo(12, 9);
            expect(o.inverted).toBe(false);
        }
    });

    test("an arc tighter than the pen reports the inversion instead of hiding it", () => {
        const a = arcThrough([0, 0], [1, 0], [4, 4]);      // radius 4
        const inner = offsetArc(a, 10, a.sweep > 0 ? 1 : -1);
        expect(inner.inverted).toBe(true);
        expect(dist(inner.A, arcPoint(a, 0))).toBeCloseTo(10, 9);
    });

    test("the whole offset curve stays the pen distance from the whole arc", () => {
        const a = arcThrough([0, 0], [1, 0], [60, 30]);
        const o = offsetArc(a, 12, 1);
        for (let i = 0; i <= 20; i++) {
            expect(dist(arcPoint(o, i / 20), arcPoint(a, i / 20))).toBeCloseTo(12, 9);
        }
    });
});

describe("arcToCubics", () => {
    test("reproduces the arc within display tolerance", () => {
        for (const B of [[1, 1], [-3, 6], [0.4, 8]]) {
            const a = arcThrough([0, 0], [1, 0], B);
            const cs = arcToCubics(a);
            expect(dist(cs[0][0], a.A)).toBeLessThan(1e-9);
            expect(dist(cs[cs.length - 1][3], a.B)).toBeLessThan(1e-9);
            let worst = 0;
            for (const c of cs) {
                for (let i = 1; i < 8; i++) {
                    const p = cubicAt(c, i / 8);
                    worst = Math.max(worst, Math.abs(Math.hypot(p[0] - a.C[0], p[1] - a.C[1]) - a.r));
                }
            }
            expect(worst).toBeLessThan(3e-4 * a.r);
        }
    });
});

describe("float32 safety", () => {
    // The hairpin bug. A stroke's END gaps have degenerate spline handles, so
    // the tangent there comes from a central difference and lands collinear to
    // about 1e-8 rather than exactly. That used to produce a genuine arc of
    // radius 8e8 with a centre 1.7e9 units away — correct in doubles, bowing
    // 2e-8 of a unit, and completely unrenderable: canvas and SVG rasterise in
    // float32, whose quantum at 1.7e9 is 199 UNITS. The renderer put the arc's
    // start hundreds of units from its own endpoint and joined them with a line.
    const straightLeg = () => {
        const p = [];
        for (let i = 0; i <= 20; i++) p.push([300 + i * 14, 620 - i * 20]);
        for (let i = 1; i <= 20; i++) p.push([580 - i * 12, 220 + i * 21]);
        return p;
    };

    test("a straight run produces no absurd radii, ends included", () => {
        const { arcs } = chainFor(straightLeg(), { tol: 0.25 });
        for (const a of arcs) {
            if (a.line) continue;
            const chord = dist(a.A, a.B);
            expect(a.r).toBeLessThan(1.5e5 * chord);
            // float32 must be able to place the rim to well under a unit
            expect((Math.hypot(a.C[0], a.C[1]) + a.r) * 1.1920929e-7).toBeLessThan(0.5);
        }
    });

    test("a near-straight gap becomes a line rather than a vast circle", () => {
        // collinear to one part in 1e9 — a real pen cannot mean this
        const a = arcThrough([0, 0], [1, 0], [50, 5e-8]);
        expect(a.line).toBe(true);
    });

    test("a genuinely gentle curve is still an arc", () => {
        // a 12-unit gap on a 100,000-unit radius: 15x above the flattening bar
        const t = 12 / 100000;
        const a = arcThrough([0, 0], [1, 0], [100000 * Math.sin(t), 100000 * (1 - Math.cos(t))]);
        expect(a.line).toBe(false);
        expect(a.r).toBeCloseTo(100000, 0);
    });

    test("drawing flattens what float32 cannot hold, at the caller's tolerance", () => {
        const calls = [];
        const ctx = {
            moveTo: (x, y) => calls.push(["moveTo", x, y]),
            lineTo: (x, y) => calls.push(["lineTo", x, y]),
            arc: (...v) => calls.push(["arc", ...v]),
        };
        const gentle = arcThrough([0, 0], [1, 0], [60, 30]);
        expect(arcSagitta(gentle)).toBeGreaterThan(1);
        tracePath(ctx, [[gentle]], 0.05);
        expect(calls.some((c) => c[0] === "arc")).toBe(true);
        calls.length = 0;
        tracePath(ctx, [[gentle]], 1e6);          // absurd tolerance: draw it flat
        expect(calls.some((c) => c[0] === "arc")).toBe(false);
        expect(calls.some((c) => c[0] === "lineTo")).toBe(true);
    });

    test("the drawn path always ends where the arc ends", () => {
        const { gaps } = chainFor(straightLeg(), { tol: 0.25 });
        const calls = [];
        const ctx = {
            moveTo: (x, y) => calls.push([x, y]),
            lineTo: (x, y) => calls.push([x, y]),
            arc: () => calls.push(null),
        };
        tracePath(ctx, gaps, 0.05);
        const last = [...calls].reverse().find((c) => c);
        const flat = [];
        for (const g of gaps) for (const a of g) flat.push(a);
        expect(dist(last, flat[flat.length - 1].B)).toBeLessThan(1e-9);
    });
});

describe("arcsForGap", () => {
    test("splitting a hard turn does not introduce a kink", () => {
        const c = [[0, 0], [90, 0], [90, 90], [0, 60]];    // a tight, turning cubic
        const arcs = arcsForGap(c, 0.01);
        expect(arcs.length).toBeGreaterThan(2);
        for (let i = 1; i < arcs.length; i++) {
            expect(angBetween(arcTangent(arcs[i - 1], 1), arcTangent(arcs[i], 0))).toBeLessThan(1e-4);
        }
        expect(gapError(c, arcs, 60)).toBeLessThan(0.02);
    });
});

describe("splineCubics", () => {
    test("matches the curve the app already draws", () => {
        // Two anchors: Two.js emits the degenerate cubic, i.e. a straight line.
        const cs = splineCubics([[0, 0], [10, 0]]);
        expect(cs.length).toBe(1);
        expect(cubicAt(cs[0], 0.5)).toEqual([5, 0]);
    });
});

// A stroke that curves enough for a kink to matter, and the same stroke drawn
// with a pause in the middle of it.
const wiggle = (n = 44) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        pts.push([120 + 300 * t, 300 + 95 * Math.sin(t * 5.4) + 22 * Math.cos(t * 13)]);
    }
    return pts;
};
const withPause = (pts, at, times = 1) => {
    const out = pts.slice(0, at + 1);
    for (let k = 0; k < times; k++) out.push([pts[at][0], pts[at][1]]);
    return out.concat(pts.slice(at + 1));
};

describe("repeated samples", () => {
    test("distinctSamples drops repeats, and keeps the array when there are none", () => {
        const clean = wiggle();
        expect(distinctSamples(clean)).toBe(clean);              // same array, no copy
        expect(distinctSamples(withPause(clean, 20, 3))).toEqual(clean);
        // The threshold is controlsFor's own: just under is dropped, just over kept.
        expect(distinctSamples([[0, 0], [MIN_SPAN * 0.5, 0], [10, 0]]).length).toBe(2);
        expect(distinctSamples([[0, 0], [MIN_SPAN * 1.5, 0], [10, 0]]).length).toBe(3);
        expect(distinctSamples([]).length).toBe(0);
        expect(distinctSamples([[4, 4], [4, 4], [4, 4]])).toEqual([[4, 4]]);
    });

    /**
     * THE INVARIANT the outline rests on.
     *
     * `ChainBuilder` takes each rail vertex from ONE side's tangent and hands it
     * to both neighbouring pieces, so a centerline that is not tangent-continuous
     * puts an endpoint up to 2r from where its own arc ends, and severs the
     * boundary. A cardinal spline is C1 at every anchor with distinct neighbours
     * — `controlsFor` places the two handles at exactly opposite angles — so the
     * only way to put a kink in one is to collapse an anchor with a repeat.
     */
    test("a pause cannot put a kink in the centerline", () => {
        for (const [at, times] of [[20, 1], [20, 2], [7, 3], [40, 1]]) {
            const arcs = chainFor(withPause(wiggle(), at, times), { tol: 0.125 }).arcs;
            let worst = 0;
            for (let i = 0; i + 1 < arcs.length; i++) {
                const a = angBetween(arcTangent(arcs[i], 1), arcTangent(arcs[i + 1], 0));
                if (a > worst) worst = a;
            }
            expect(worst).toBeLessThan(ACOS_FLOOR);
        }
    });
});
