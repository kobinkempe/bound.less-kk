/**
 * BSP — the three schedules on a real-sized stroke.
 *
 * Modelled on the drawing Kobin made and then could not erase: 3,769 samples,
 * 90 units wide, 78,644 units of centerline in a 521 x 465 box, coverage ratio
 * 29.2. That ratio is the case the whole design is for — the stroke paints its
 * own bounding box twenty-nine times over, so almost all of it is buried and the
 * perimeter is a tiny fraction of the input.
 *
 * For scale, on that drawing today's machinery produced 156,525 cubics and
 * 1,853,649 vertices, and took 4,469 ms just to flatten before the boolean.
 */
import { runBaker } from "./bakeStrategies";
import { curvePerimeter, centerlineCubics } from "./curvePerimeter";
import { cubicTangent } from "./curveOutline";

jest.setTimeout(900000);

/** A serpentine with the real stroke's sample count, width, extent and coverage. */
function realScribble(rows = 151, cols = 24) {
    const W = 521, H = 465, pts = [];
    for (let row = 0; row < rows; row++) {
        const y = 100 + (row / (rows - 1)) * H;
        for (let k = 0; k <= cols; k++) {
            const f = row % 2 === 0 ? k / cols : 1 - k / cols;
            pts.push([300 + f * W, y]);
        }
    }
    return pts;
}

const coverage = (pts, width) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    return { len, rho: (len * width) / ((x1 - x0) * (y1 - y0)) };
};

const maxKink = (loops) => {
    let worst = 0;
    for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i], b = loop[(i + 1) % loop.length];
            const ta = cubicTangent(a, 1), tb = cubicTangent(b, 0);
            if (!ta || !tb) continue;
            worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1]))) * 180 / Math.PI);
        }
    }
    return worst;
};

const TOL = { fitTol: 0.045, lineTol: 0.045, enterScale: 1 };   // 0.25 px at 1:1 for r=45

describe("BSP-1 — the real stroke's profile", () => {
    test("A: where the time actually goes", () => {
        const pts = realScribble(), width = 90;
        const cov = coverage(pts, width);
        const t0 = Date.now();
        const { loops, stats } = curvePerimeter(pts, width, TOL);
        const ms = Date.now() - t0;
        const out = loops.reduce((n, l) => n + l.length, 0);
        // eslint-disable-next-line no-console
        console.log(`BSP-1  ${pts.length} samples, rho ${cov.rho.toFixed(1)}  ->  ${ms} ms`
            + `  chain ${stats.chain} -> ${out} pieces in ${loops.length} loops`
            + `  cuts ${stats.cuts} pairTests ${stats.pairTests}`
            + `  PHASES ${JSON.stringify(stats.ms)}`);
        expect(cov.rho).toBeGreaterThan(20);
        expect(loops.length).toBeGreaterThan(0);
    });

    test("all three, head to head", () => {
        const pts = realScribble(), width = 90;
        const rows = [];
        for (const k of ["A", "C", "B"]) {
            const t0 = Date.now();
            const { loops, stats } = runBaker(k, pts, width, TOL);
            rows.push({ k, total: Date.now() - t0, draw: stats.drawMs, finish: stats.finishMs,
                pp: stats.perPoint, out: loops.reduce((n, l) => n + l.length, 0), loops: loops.length,
                kink: maxKink(loops) });
        }
        for (const r of rows) {
            // eslint-disable-next-line no-console
            console.log(`BSP-2 ${r.k}: total ${r.total}ms = draw ${r.draw} + finish ${r.finish}`
                + `  | per-point mean ${r.pp.mean} p95 ${r.pp.p95} p99 ${r.pp.p99} max ${r.pp.max}`
                + `  | ${r.out} pieces / ${r.loops} loops, worst kink ${r.kink.toFixed(2)}deg`);
        }
        expect(rows.length).toBe(3);
    });
});

describe("BSP-3 — how cost grows with the stroke", () => {
    test("the perimeter saturates while the path keeps growing", () => {
        // The claim that makes this bounded over a long session: once an area is
        // enclosed, more scribbling inside it costs nothing permanent. If the
        // OUTPUT grows linearly with the input here, the whole design is wrong.
        const width = 90, rows = [];
        for (const nrows of [20, 40, 80, 151]) {
            const pts = realScribble(nrows);
            const t0 = Date.now();
            const { loops, stats } = curvePerimeter(pts, width, TOL);
            rows.push({ n: pts.length, ms: Date.now() - t0, chain: stats.chain,
                out: loops.reduce((a, l) => a + l.length, 0), cuts: stats.cuts });
        }
        // eslint-disable-next-line no-console
        console.log("BSP-3 " + rows.map((r) => `${r.n}pts: ${r.ms}ms chain ${r.chain} out ${r.out} cuts ${r.cuts}`).join("  |  "));
        expect(rows.length).toBe(4);
    });

    test("a plain pen line — the case that must be nearly free", () => {
        // Coverage ratio near 1. Most strokes in a drawing are this, not the
        // scribble, and if this is not fast nothing else matters.
        const pts = [];
        for (let i = 0; i <= 400; i++) {
            const t = i / 400;
            pts.push([100 + t * 900, 300 + 160 * Math.sin(t * 5) + 30 * Math.cos(t * 17)]);
        }
        const width = 24, cov = coverage(pts, width);
        const rows = [];
        for (const k of ["A", "C", "B"]) {
            const t0 = Date.now();
            const { loops, stats } = runBaker(k, pts, width, { fitTol: 0.012, lineTol: 0.012, enterScale: 1 });
            rows.push(`${k}: ${Date.now() - t0}ms (draw ${stats.drawMs} finish ${stats.finishMs}) `
                + `${loops.reduce((n, l) => n + l.length, 0)} pieces`);
        }
        // eslint-disable-next-line no-console
        console.log(`BSP-4 pen line ${pts.length}pts rho ${cov.rho.toFixed(2)} — ` + rows.join("  |  "));
        expect(cov.rho).toBeLessThan(5);
    });
});
