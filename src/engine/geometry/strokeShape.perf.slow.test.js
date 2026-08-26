/**
 * SSP — strokeShape on a stroke the size of a real one.
 *
 * Modelled on a drawing Kobin made and then could not erase: 3,769 points,
 * 90 units wide, 78,644 units of centerline packed into a 521 x 465 box. The
 * ratio that matters is COVERAGE — (length x width) / bbox area — which comes
 * to 29, meaning the stroke paints its own bounding box twenty-nine times over.
 * At that density almost every capsule is buried and the boundary is a tiny
 * fraction of the input, which is what the whole design turns on.
 *
 * For scale, on that drawing the existing machinery produced:
 *     the capsule outline      1,405 loops, 156,525 cubics, 157,930 anchors
 *                              (past Two.js's 131,072 limit — it threw)
 *     flattened for Clipper    1,853,649 vertices, 4,469 ms before the boolean
 */
import { strokeShape, segmentsOf } from "./strokeShape";
import { flattenCurve } from "./clipperOutline";

jest.setTimeout(600000);

/** A serpentine with the same point count, width, extent and coverage ratio. */
function realisticScribble() {
    const W = 521, H = 465, rows = 151, pts = [];
    for (let row = 0; row < rows; row++) {
        const y = 100 + (row / (rows - 1)) * H;
        const n = 12;
        for (let k = 0; k <= n; k++) {
            const f = row % 2 === 0 ? k / n : 1 - k / n;
            pts.push([300 + f * W, y]);
        }
    }
    return pts;
}

const stats = (pts, width) => {
    let len = 0;
    for (const s of segmentsOf(pts)) len += s.L;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return { len, coverage: (len * width) / ((x1 - x0) * (y1 - y0)) };
};

describe("SSP-1 — a real-sized dense stroke", () => {
    test("resolves to a small exact shape, fast", () => {
        const pts = realisticScribble(), width = 90;
        const s = stats(pts, width);
        const t0 = Date.now();
        const { loops, stats: st } = strokeShape(pts, width);
        const ms = Date.now() - t0;
        const pieces = loops.reduce((n, l) => n + l.length, 0);
        // eslint-disable-next-line no-console
        console.log(`SSP-1  ${pts.length} pts, coverage ${s.coverage.toFixed(1)}x  ->  `
            + `${st.candidates}/${st.segs} candidates, ${loops.length} loops, ${pieces} pieces, ${ms} ms  PHASES ${JSON.stringify(st.ms)}`);

        expect(s.coverage).toBeGreaterThan(20);          // the case we care about
        expect(loops.length).toBeGreaterThan(0);
        expect(loops.every((l) => !l.open)).toBe(true);  // every loop closed
        // The point of the whole exercise: output bounded by PERIMETER, not by
        // path length. A few hundred pieces, not a hundred thousand.
        expect(pieces).toBeLessThan(2000);
        expect(st.candidates).toBeLessThan(st.segs * 0.35);
    });

    test("the boundary stops growing while the path keeps growing", () => {
        // Draw the same region with 2x the points and the shape must not get
        // meaningfully more complex — that is what makes this bounded over a
        // long session rather than degrading as a picture fills in.
        const width = 90;
        const grow = (rows) => {
            const pts = [];
            for (let row = 0; row < rows; row++) {
                const y = 100 + (row / (rows - 1)) * 465;
                for (let k = 0; k <= 12; k++) {
                    const f = row % 2 === 0 ? k / 12 : 1 - k / 12;
                    pts.push([300 + f * 521, y]);
                }
            }
            return pts;
        };
        const a = strokeShape(grow(80), width);
        const b = strokeShape(grow(160), width);
        const pa = a.loops.reduce((n, l) => n + l.length, 0);
        const pb = b.loops.reduce((n, l) => n + l.length, 0);
        // eslint-disable-next-line no-console
        console.log(`SSP-2  80 rows -> ${pa} pieces ; 160 rows -> ${pb} pieces`);
        expect(pb).toBeLessThan(pa * 2.2);
    });
});

describe("SSP-3 — the SPARSE case, where the cull cannot help", () => {
    // The 1,963-point scribble above is the FAVOURABLE case: dense, so 74 % of
    // its capsules are buried, and its segments are long, so few capsules reach
    // any one piece. A hand-drawn curve is the opposite, and it is the case that
    // has to work — a stroke's samples are spline anchors, so faithfully baking
    // what Chrome paints means flattening the spline first, which makes the
    // segments SHORT.
    //
    // Cost here is driven by 2r / segmentLength: every piece must be trimmed
    // against every capsule that can reach it. Since segmentLength = totalLength
    // / n, that density grows WITH n, so the cost is quadratic in the point
    // count — and flattening finer to buy fidelity buys quadratic cost with it.
    // That is why "approximate the spline finely, then call strokeShape" is not
    // merely slow, it is the wrong shape of solution.
    const samples = () => {
        const p = [];
        for (let i = 0; i <= 6; i++) { const t = i / 6; p.push([100 + t * 500, 300 + 140 * Math.sin(t * 3.0)]); }
        return p;
    };

    test("cost is quadratic in the flattening density, and nothing gets culled", () => {
        const width = 60;
        const rows = [];
        // DISPLAY FIDELITY is (arcTolerancePx * 0.5) / enter = 0.125 / 300 —
        // half a pixel at the level's deepest zoom. Anything finer is not a
        // fidelity the level can show, and timing it overstates the problem.
        const DISPLAY = (0.25 * 0.5) / 300;
        // The ratio below is a ratio of two WALL CLOCKS, so the cheap end has to
        // be measured as carefully as the dear one. Un-warmed, the 45-point call
        // is mostly the JIT compiling `strokeShape` for the first time — 210 ms
        // against the ~10 ms it costs once warm, which flatters the small end by
        // twenty times and sinks the ratio below the point ratio on an idle
        // machine. Warm first, then take the best of three: the minimum is the
        // right statistic here, since every source of noise adds time.
        strokeShape(flattenCurve(samples(), DISPLAY * 400), width);
        for (const [name, tol] of [["1/400", DISPLAY * 400], ["1/50", DISPLAY * 50], ["display", DISPLAY]]) {
            const flat = flattenCurve(samples(), tol);
            const segs = segmentsOf(flat);
            let len = 0; for (const s of segs) len += s.L;
            let ms = Infinity, res = null;
            for (let rep = 0; rep < 3; rep++) {
                const t0 = Date.now();
                res = strokeShape(flat, width);
                ms = Math.min(ms, Date.now() - t0);
            }
            rows.push({ name, pts: flat.length, density: +(width / (len / segs.length)).toFixed(0),
                culled: res.stats.segs - res.stats.candidates, ms });
        }
        // eslint-disable-next-line no-console
        console.log("SSP-3 " + rows.map((r) => `${r.name}: ${r.pts}pts density=${r.density} culled=${r.culled} ${r.ms}ms`).join("  |  "));
        // Nothing is buried on a simple curve, so the crumb saves nothing here.
        expect(rows.every((r) => r.culled === 0)).toBe(true);
        // Superlinear: this is the pin. If a future change makes the sparse case
        // linear (an adjacency fast path), this expectation should FLIP and the
        // comment above should be rewritten.
        const a = rows[0], b = rows[rows.length - 1];
        const ptRatio = b.pts / a.pts, msRatio = Math.max(b.ms, 1) / Math.max(a.ms, 1);
        expect(msRatio).toBeGreaterThan(ptRatio);
    });
});
