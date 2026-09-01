/**
 * SS — strokeShape: a stroke's footprint as a resolved perimeter.
 *
 * The oracle is MEMBERSHIP, not shape comparison. For any point in the plane,
 * "inside the loops we computed" has to equal "within r of the polyline" — a
 * definition of the answer that owes nothing to the implementation. Sampling it
 * densely catches everything a piece-count or area assertion would miss: a lost
 * arc, an inverted hole, a run stitched the wrong way round, a cap trimmed on
 * the wrong side.
 *
 * The one thing membership cannot see is whether the loops are well FORMED
 * (closed, consistently oriented, no duplicated pieces), so that is asserted
 * separately.
 */
import { strokeShape, segmentsOf, loopArea, Crumb } from "./strokeShape";
import { flattenCurve } from "../geometry/polyline";

const TAU = Math.PI * 2;

// ---- the oracle ----
const distToPolyline = (p, pts) => {
    let best = Infinity;
    for (const s of segmentsOf(pts)) {
        let t = (p[0] - s.a[0]) * s.ux + (p[1] - s.a[1]) * s.uy;
        t = t < 0 ? 0 : (t > s.L ? s.L : t);
        const qx = s.a[0] + s.ux * t, qy = s.a[1] + s.uy * t;
        const d = Math.hypot(p[0] - qx, p[1] - qy);
        if (d < best) best = d;
    }
    if (!segmentsOf(pts).length && pts.length) best = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    return best;
};

/**
 * Winding number of `loops` about p, by casting a ray along +x. Lines are the
 * usual crossing test; for an arc, the point at angle t is
 * (cx + r cos t, cy + r sin t) and CCW travel has dy/dt = r cos t, so the
 * crossing counts up when cos t > 0.
 */
const windingAt = (loops, p) => {
    let w = 0;
    for (const loop of loops) {
        for (const pc of loop) {
            if (pc.kind === "line") {
                const { sx, sy, ex, ey } = pc;
                if ((sy > p[1]) === (ey > p[1])) continue;
                const x = sx + ((p[1] - sy) / (ey - sy)) * (ex - sx);
                if (x > p[0]) w += ey > sy ? 1 : -1;
            } else {
                const dy = p[1] - pc.cy;
                if (Math.abs(dy) >= pc.r) continue;
                const dx = Math.sqrt(pc.r * pc.r - dy * dy);
                for (const x of [pc.cx + dx, pc.cx - dx]) {
                    if (x <= p[0]) continue;
                    const t = Math.atan2(dy, x - pc.cx);
                    // is t inside the arc's CCW span [a0, a1]?
                    let rel = t - pc.a0; while (rel < 0) rel += TAU; while (rel >= TAU) rel -= TAU;
                    let span = pc.a1 - pc.a0; while (span < 0) span += TAU;
                    if (rel > span) continue;
                    w += Math.cos(t) > 0 ? 1 : -1;
                }
            }
        }
    }
    return w;
};

/**
 * Sample the plane over the shape's bounding box and compare membership with
 * the oracle. Points within `skin` of the true boundary are skipped — that is
 * where a ray cast is legitimately ambiguous, not where bugs hide.
 */
function checkMembership(pts, width, opts = {}) {
    const r = width / 2;
    const { loops } = strokeShape(pts, width, opts);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    x0 -= r * 1.5; y0 -= r * 1.5; x1 += r * 1.5; y1 += r * 1.5;
    const n = opts.samples || 60, skin = opts.skin != null ? opts.skin : r * 0.02;
    let checked = 0;
    const bad = [];
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
            // irrational offsets: never land exactly on a vertex or a tangency
            const p = [x0 + ((x1 - x0) * (i + 0.31830988)) / (n + 1),
                       y0 + ((y1 - y0) * (j + 0.27182818)) / (n + 1)];
            const d = distToPolyline(p, pts);
            if (Math.abs(d - r) < skin) continue;
            checked++;
            const want = d < r;
            const got = windingAt(loops, p) !== 0;
            if (want !== got) bad.push({ p: [+p[0].toFixed(3), +p[1].toFixed(3)], want, got, d: +d.toFixed(4) });
        }
    }
    return { loops, checked, bad };
}

const expectMembership = (pts, width, opts) => {
    const { checked, bad, loops } = checkMembership(pts, width, opts);
    expect(checked).toBeGreaterThan(500);       // the probe must actually probe
    expect(bad.slice(0, 6)).toEqual([]);
    return loops;
};

// Every loop closes, and no piece is used twice.
const expectWellFormed = (loops, tol = 1e-6) => {
    const seen = new Set();
    for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i], b = loop[(i + 1) % loop.length];
            expect(Math.hypot(a.ex - b.sx, a.ey - b.sy)).toBeLessThan(tol);
            const k = a.kind + ":" + a.owner + ":" + a.sx.toFixed(9) + ":" + a.sy.toFixed(9);
            expect(seen.has(k)).toBe(false);
            seen.add(k);
        }
    }
};

describe("SS-1 — the shapes we can write down by hand", () => {
    test("one segment is a stadium: two lines, two arcs, exact area", () => {
        const r = 10, L = 100;
        const { loops } = strokeShape([[0, 0], [L, 0]], 2 * r);
        expect(loops).toHaveLength(1);
        expect(loops[0].filter((p) => p.kind === "line")).toHaveLength(2);
        expect(loops[0].filter((p) => p.kind === "arc").length).toBeGreaterThanOrEqual(2);
        expect(Math.abs(loopArea(loops[0]))).toBeCloseTo(2 * r * L + Math.PI * r * r, 6);
    });
    test("...and collinear points give the SAME stadium, not one per segment", () => {
        const r = 10, L = 100;
        const pts = [];
        for (let i = 0; i <= 10; i++) pts.push([(i / 10) * L, 0]);
        const { loops } = strokeShape(pts, 2 * r);
        expect(loops).toHaveLength(1);
        expect(Math.abs(loopArea(loops[0]))).toBeCloseTo(2 * r * L + Math.PI * r * r, 4);
    });
    test("a lone point is a disc", () => {
        const { loops } = strokeShape([[5, 7]], 12);
        expect(loops).toHaveLength(1);
        expect(Math.abs(loopArea(loops[0]))).toBeCloseTo(Math.PI * 36, 6);
    });
    test("the outer loop runs counter-clockwise", () => {
        const { loops } = strokeShape([[0, 0], [100, 0]], 20);
        expect(loopArea(loops[0])).toBeGreaterThan(0);
    });
});

describe("SS-2 — membership against the definition", () => {
    test("a straight stroke", () => {
        expectWellFormed(expectMembership([[20, 50], [180, 50]], 30));
    });
    test("a right-angle corner (the outside of the turn is one arc)", () => {
        expectWellFormed(expectMembership([[20, 20], [120, 20], [120, 120]], 26));
    });
    test("a hairpin tighter than the stroke is wide", () => {
        // The offset self-intersects here: the classic case a naive offset gets
        // wrong by leaving the crossing loop in.
        expectWellFormed(expectMembership([[20, 60], [120, 60], [22, 66]], 40));
    });
    test("a stroke that crosses itself", () => {
        expectWellFormed(expectMembership([[20, 20], [140, 140], [20, 140], [140, 20]], 22));
    });
    test("two passes close enough to merge", () => {
        expectWellFormed(expectMembership([[20, 60], [180, 60], [180, 74], [20, 74]], 26));
    });
    test("a zig-zag", () => {
        const pts = [];
        for (let i = 0; i <= 9; i++) pts.push([20 + i * 18, i % 2 ? 40 : 100]);
        expectWellFormed(expectMembership(pts, 24));
    });
});

describe("SS-3 — holes", () => {
    // A ring encloses a hole when the loop is wider than the stroke. This is the
    // case a union that only ever tracked an outer contour would silently lose.
    const ring = (R, n = 48) => {
        const pts = [];
        for (let i = 0; i <= n; i++) { const t = (i / n) * TAU; pts.push([200 + R * Math.cos(t), 200 + R * Math.sin(t)]); }
        return pts;
    };
    test("a wide ring has an outer loop and a hole, oriented oppositely", () => {
        const { loops } = strokeShape(ring(80), 30);
        expect(loops.length).toBeGreaterThanOrEqual(2);
        const areas = loops.map(loopArea).sort((a, b) => b - a);
        expect(areas[0]).toBeGreaterThan(0);                       // outer, CCW
        expect(areas[areas.length - 1]).toBeLessThan(0);           // hole, CW
    });
    test("the hole is really empty, and the ink around it really is ink", () => {
        expectMembership(ring(80), 30, { samples: 80 });
    });
    test("a ring narrower than the stroke closes up — no hole", () => {
        const { loops } = strokeShape(ring(12), 60);
        expect(loops.filter((l) => loopArea(l) < 0)).toHaveLength(0);
    });
});

describe("SS-4 — the cull is sound", () => {
    // The load-bearing claim: dropping buried capsules cannot change the answer.
    // Compare against a crumb that knows nothing, so nothing is ever culled.
    const blindCrumb = () => ({ coveredByOther: () => false });
    const scribble = () => {
        const pts = [];
        for (let row = 0; row < 9; row++) {
            const y = 40 + row * 9;
            if (row % 2 === 0) for (let x = 40; x <= 200; x += 12) pts.push([x, y]);
            else for (let x = 200; x >= 40; x -= 12) pts.push([x, y]);
        }
        return pts;
    };
    test("culled and un-culled agree on membership, on a dense scribble", () => {
        const pts = scribble(), w = 26;
        const a = strokeShape(pts, w);
        const b = strokeShape(pts, w, { crumb: blindCrumb() });
        expect(a.stats.candidates).toBeLessThan(a.stats.segs);      // it did cull
        const areaOf = (res) => res.loops.reduce((s, l) => s + loopArea(l), 0);
        expect(areaOf(a)).toBeCloseTo(areaOf(b), 6);
    });
    test("a dense scribble's membership is right", () => {
        expectMembership(scribble(), 26, { samples: 90 });
    });
    test("burial really does happen, and hard", () => {
        const { stats } = strokeShape(scribble(), 40);
        expect(stats.candidates / stats.segs).toBeLessThan(0.5);
    });
});

describe("SS-5 — the crumb", () => {
    test("a cell filled by one capsule does not count against that capsule", () => {
        const c = new Crumb(5);
        const [s] = segmentsOf([[0, 0], [100, 0]]);
        c.add(s, 20, s.id);
        expect(c.coveredByOther(50, 0, s.id)).toBe(false);   // its own ink
        expect(c.coveredByOther(50, 0, 999)).toBe(true);     // somebody else's
    });
    test("nothing is claimed outside the capsule", () => {
        const c = new Crumb(5);
        const [s] = segmentsOf([[0, 0], [100, 0]]);
        c.add(s, 20, s.id);
        expect(c.coveredByOther(50, 200, 999)).toBe(false);
    });
    test("an incrementally built crumb equals a batch one", () => {
        const pts = [];
        for (let i = 0; i < 40; i++) pts.push([20 + i * 4, 50 + 20 * Math.sin(i / 3)]);
        const segs = segmentsOf(pts);
        const batch = new Crumb(6), live = new Crumb(6);
        for (const s of segs) batch.add(s, 15, s.id);
        for (const s of segs) live.add(s, 15, s.id);          // same order, arriving one at a time
        expect([...live.count.entries()].sort()).toEqual([...batch.count.entries()].sort());
    });
});

describe("SS-6 — degenerate input", () => {
    test("repeated identical points", () => {
        const { loops } = strokeShape([[10, 10], [10, 10], [10, 10]], 8);
        expect(loops).toHaveLength(1);
        expect(Math.abs(loopArea(loops[0]))).toBeCloseTo(Math.PI * 16, 6);
    });
    test("a doubled-back segment (out and exactly back)", () => {
        const pts = [[20, 20], [120, 20], [20, 20]];
        expectWellFormed(expectMembership(pts, 24));
    });
    test("zero and negative width produce nothing", () => {
        expect(strokeShape([[0, 0], [10, 0]], 0).loops).toHaveLength(0);
        expect(strokeShape([[0, 0], [10, 0]], -5).loops).toHaveLength(0);
    });
    test("an empty path produces nothing", () => {
        expect(strokeShape([], 10).loops).toHaveLength(0);
    });
});

describe("SS-7 — the input is a POLYLINE, and that is a hard contract", () => {
    // A native stroke's `pts` are NOT a polyline. Two.js draws them as a
    // Catmull-Rom-like cubic spline (tension 0.33, `utils/curves.js`
    // getControlPoints), and that spline is what Chrome paints. Handing the raw
    // samples to strokeShape therefore bakes a DIFFERENT SHAPE from the one on
    // screen — which is exactly the defect docs/outline-fidelity-report.md
    // records as "~1,900 px of solid mismatch" and the reason the corrected
    // curveOutline starts from the spline.
    //
    // The area barely moves, so an area assertion would wave this through. It is
    // the EDGE POSITION that is wrong. Anything wiring strokeShape into the fat
    // stroke or the eraser must flatten the spline first.
    const samples = () => {
        const p = [];
        for (let i = 0; i <= 6; i++) { const t = i / 6; p.push([100 + t * 500, 300 + 140 * Math.sin(t * 3.0)]); }
        return p;
    };
    const CFG = { arcTolerancePx: 0.25, enter: 300 };

    test("the displayed spline departs from its own chords by whole units", () => {
        const pts = samples();
        const smooth = flattenCurve(pts, (CFG.arcTolerancePx * 0.5) / CFG.enter);
        let worst = 0;
        for (const q of smooth) {
            let best = Infinity;
            for (const s of segmentsOf(pts)) {
                let t = (q[0] - s.a[0]) * s.ux + (q[1] - s.a[1]) * s.uy;
                t = t < 0 ? 0 : (t > s.L ? s.L : t);
                best = Math.min(best, Math.hypot(q[0] - (s.a[0] + s.ux * t), q[1] - (s.a[1] + s.uy * t)));
            }
            if (best > worst) worst = best;
        }
        // Measured 3.83 units — 3.8 px at 1:1, and 1,149 px at this level's
        // deepest zoom. Not an anti-aliasing difference by any reading.
        expect(worst).toBeGreaterThan(1);
    });

    test("...so a raw-sample bake misplaces the edge, while its AREA looks fine", () => {
        const pts = samples(), width = 60, r = width / 2;
        const smooth = flattenCurve(pts, (CFG.arcTolerancePx * 0.5) / CFG.enter);
        const dTo = (q, path) => {
            let best = Infinity;
            for (const s of segmentsOf(path)) {
                let t = (q[0] - s.a[0]) * s.ux + (q[1] - s.a[1]) * s.uy;
                t = t < 0 ? 0 : (t > s.L ? s.L : t);
                best = Math.min(best, Math.hypot(q[0] - (s.a[0] + s.ux * t), q[1] - (s.a[1] + s.uy * t)));
            }
            return best;
        };
        let disagree = 0, checked = 0;
        for (let x = 40; x < 680; x += 4) {
            for (let y = 100; y < 520; y += 4) {
                const ds = dTo([x, y], pts), dm = dTo([x, y], smooth);
                if (Math.abs(ds - r) < 1 || Math.abs(dm - r) < 1) continue;
                checked++;
                if ((ds < r) !== (dm < r)) disagree++;
            }
        }
        expect(checked).toBeGreaterThan(1000);
        expect(disagree).toBeGreaterThan(0);       // the shapes genuinely differ
        const areaStraight = strokeShape(pts, width).loops.reduce((a, l) => a + loopArea(l), 0);
        const areaSmooth = strokeShape(flattenCurve(pts, 1e-3), width).loops.reduce((a, l) => a + loopArea(l), 0);
        // Within a quarter of one percent — which is why area cannot be the test.
        expect(Math.abs(areaStraight - areaSmooth) / areaSmooth).toBeLessThan(0.004);
    });
});
