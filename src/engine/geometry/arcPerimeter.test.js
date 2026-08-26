import { bakeArcPerimeter, ArcBakeJob, ptAt, pieceBBox } from "./arcPerimeter";
import { chainFor, arcPoint } from "./biarc";
import { BAKERS } from "./bakeStrategies";

// Two strokes captured from Kobin's browser, now kept IN THE REPO. They used to
// be required from a session scratchpad, so the suite quietly depended on a temp
// directory that is not there any more.
const STROKE = require("../__fixtures__/arc-stroke.json");
const STROKE2 = require("../__fixtures__/arc-stroke2.json");
// Two strokes from Kobin's PHONE, 2026-08-26 -- ordinary pen marks, each drawn
// with a pause in the middle. See the "a pause" block at the end of this file.
const PAUSE = require("../__fixtures__/arc-stroke-pause.json");
const PAUSE2 = require("../__fixtures__/arc-stroke-pause2.json");

/** Distance from a point to the arc centerline, brute force (test-only). */
function distToCentre(centre, q) {
    let best = Infinity;
    for (const a of centre) {
        for (let i = 0; i <= 8; i++) {
            const p = arcPoint(a, i / 8);
            const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (d < best) best = d;
        }
    }
    return best;
}

const report = (name, s) => {
    // eslint-disable-next-line no-console
    console.log(`${name}: ${s.ms} ms | samples ${s.samples} | centre arcs ${s.centreArcs}` +
        ` (${s.arcsPerGap}/gap) | chain ${s.chainPieces} -> live ${s.live}` +
        ` | crossings ${s.crossings} | kept ${s.kept} | loops ${s.loops}` +
        ` | OPEN ${s.openChains} | UNBALANCED ${s.unbalanced}`);
    // eslint-disable-next-line no-console
    console.log(`   phases: ${Object.entries(s.phases).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
};

describe("arc perimeter — small shapes first", () => {
    test("a straight stroke resolves to one closed loop", () => {
        const pts = [];
        for (let i = 0; i <= 20; i++) pts.push([100 + i * 20, 300]);
        const { loops, stats } = bakeArcPerimeter(pts, 40, { tol: 0.25 });
        report("straight", stats);
        expect(stats.openChains).toBe(0);
        expect(stats.unbalanced).toBe(0);
        expect(loops.length).toBe(1);
    });

    test("a self-crossing stroke resolves and every loop closes", () => {
        const pts = [[200, 430], [450, 210], [700, 430], [450, 650], [340, 430], [600, 310]];
        const { loops, stats } = bakeArcPerimeter(pts, 90, { tol: 0.25 });
        report("self-crossing", stats);
        expect(stats.openChains).toBe(0);
        for (const l of loops) {
            expect(Math.hypot(l[0].A[0] - l[l.length - 1].B[0], l[0].A[1] - l[l.length - 1].B[1]))
                .toBeLessThan(1e-6);
        }
    });

    test("every point of the outline sits on the pen, not across it", () => {
        // The check that catches a fabricated closing edge: a correct perimeter
        // is everywhere exactly r from the centerline. A straight line welded
        // across the shape is not.
        const pts = [];
        for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            pts.push([120 + t * 700, 400 + 160 * Math.sin(t * 8)]);
        }
        const r = 45;
        const { loops } = bakeArcPerimeter(pts, r * 2, { tol: 0.25 });
        const centre = chainFor(pts, { tol: 0.25 }).arcs;
        let worst = 0;
        for (const loop of loops) {
            for (const p of loop) {
                for (const s of [0.15, 0.5, 0.85]) {
                    worst = Math.max(worst, Math.abs(distToCentre(centre, ptAt(p, s)) - r));
                }
            }
        }
        // eslint-disable-next-line no-console
        console.log(`outline-to-centerline worst |d - r| = ${worst.toFixed(4)} units (r = ${r})`);
        expect(worst).toBeLessThan(0.6);   // brute-force sampling floor, not algorithm error
    });
});

describe("arc perimeter — the captured stroke", () => {
    test("stroke.json bakes, and how it compares to schedule A on cubics", () => {
        const s = STROKE;
        const pts = s.pts, width = s.width;

        const arc = bakeArcPerimeter(pts, width, { tol: 0.25 });
        report("ARC  stroke.json", arc.stats);

        const t0 = Date.now();
        const baker = new BAKERS.A(width, { fitTol: 0.1, lineTol: 0.1, enterScale: 1 });
        for (const p of pts) baker.addSample(p);
        const old = baker.finish();
        const oldMs = Date.now() - t0;
        // eslint-disable-next-line no-console
        console.log(`CUBIC stroke.json (schedule A): ${oldMs} ms | loops ${old.loops.length}` +
            ` | pieces ${old.loops.reduce((n, l) => n + l.length, 0)}`);

        expect(arc.stats.openChains).toBe(0);
        expect(arc.stats.unbalanced).toBe(0);
        // The cubic pipeline is the only independent answer available, and it
        // agrees on the loop count — which it would not if either were wrong.
        expect(arc.loops.length).toBe(old.loops.length);
    }, 120000);

    test("stroke2.json — the heavy fill-in that F20 lives on", () => {
        const arc = bakeArcPerimeter(STROKE2.pts, STROKE2.width, { tol: 0.25 });
        report("ARC  stroke2.json", arc.stats);
        // This is the F20 stroke: the cubic resolve held 121 inconsistent
        // junctions together here and fell into 121 open chains without the weld.
        expect(arc.stats.openChains).toBe(0);
        expect(arc.stats.unbalanced).toBe(0);
    }, 180000);
});

describe("arc perimeter — sliced", () => {
    // The whole point of the job is that stopping and resuming changes nothing.
    // If it did, the shape a user gets would depend on how busy their machine
    // was while they drew it.
    const same = (a, b) => {
        expect(b.loops.length).toBe(a.loops.length);
        for (let i = 0; i < a.loops.length; i++) {
            expect(b.loops[i].length).toBe(a.loops[i].length);
            for (let k = 0; k < a.loops[i].length; k++) {
                const p = a.loops[i][k], q = b.loops[i][k];
                expect(q.A).toEqual(p.A);
                expect(q.B).toEqual(p.B);
                expect(!!q.line).toBe(!!p.line);
                if (!p.line) { expect(q.r).toBe(p.r); expect(q.a0).toBe(p.a0); expect(q.sweep).toBe(p.sweep); }
            }
        }
    };
    test("a 1 ms budget gives bit-identical loops to running it in one go", () => {
        const pts = [[200, 430], [450, 210], [700, 430], [450, 650], [340, 430], [600, 310]];
        const batch = bakeArcPerimeter(pts, 90, { tol: 0.125 });
        const job = new ArcBakeJob(pts, 90, { tol: 0.125 });
        let slices = 0;
        while (!job.step(1)) { if (++slices > 100000) throw new Error("job never finished"); }
        same(batch, job.result);
        expect(job.result.stats.openChains).toBe(0);
    });
    test("nothing is published until the job is finished", () => {
        const job = new ArcBakeJob(STROKE.pts, STROKE.width, { tol: 0.125 });
        let seen = 0;
        while (!job.step(2)) { if (job.result) throw new Error("published early"); seen++; }
        expect(seen).toBeGreaterThan(5);       // it really did take many slices
        expect(job.result.loops.length).toBeGreaterThan(0);
        expect(job.result.stats.openChains).toBe(0);
        expect(job.result.stats.unbalanced).toBe(0);
    }, 120000);
    test("the captured fill-in survives slicing too, and every phase is billed", () => {
        const batch = bakeArcPerimeter(STROKE2.pts, STROKE2.width, { tol: 0.125 });
        const job = new ArcBakeJob(STROKE2.pts, STROKE2.width, { tol: 0.125 });
        while (!job.step(3)) { /* slice */ }
        same(batch, job.result);
        const ph = job.result.stats.phases;
        for (const k of ["centerline", "chain", "oracle", "precull", "cut", "classify", "stitch"]) {
            expect(ph[k]).toBeGreaterThanOrEqual(0);
        }
        // eslint-disable-next-line no-console
        console.log(`SLICED stroke2: ${job.result.stats.ms} ms busy · ` +
            Object.entries(ph).map(([k, v]) => `${k} ${v}`).join(" · "));
    }, 180000);
});

describe("arc perimeter — a stroke that ends where it began", () => {
    // The case that was missing entirely, and it is not exotic: a circle, a
    // letter O, a box, or an eraser swept round something. A stroke whose two
    // ends COINCIDE has no ends, and capping it anyway puts two half-turns on
    // the SAME circle — a pair with no transverse crossing to find, so they are
    // invisible to circle-circle however much they overlap. The overlap is a
    // stretch of doubled boundary where every point sits at distance exactly r
    // from both generators; burial there is a coin flip, and the resolve kept
    // fragments whose partners it dropped.
    //
    // Measured before the fix, on the 36-point ring below: an unclosed loop of
    // 72 pieces, which then shredded every boolean it was handed — 74 loops and
    // 72 open chains out of a plain rect-minus-ring.
    const ringPts = (R, n) => {
        const p = [];
        for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2; p.push([R * Math.cos(t), R * Math.sin(t)]); }
        return p;
    };
    const closedAll = (loops) => loops.every((l) => Math.hypot(
        l[l.length - 1].B[0] - l[0].A[0], l[l.length - 1].B[1] - l[0].A[1]) < 1e-9);

    test.each([[180, 40, 64], [70, 14, 36], [773, 155, 36], [200, 30, 64], [50, 60, 24]])(
        "a ring R=%i w=%i (%i samples) is an annulus, closed and balanced",
        (R, w, n) => {
            const { loops, stats } = bakeArcPerimeter(ringPts(R, n), w, { tol: 0.125 });
            expect(stats.openChains).toBe(0);
            expect(stats.unbalanced).toBe(0);
            expect(closedAll(loops)).toBe(true);
            expect(loops.length).toBe(2);            // outer and hole
            // ...and it is the right annulus, to the sampling of the ring.
            let area = 0;
            for (const l of loops) {
                let a = 0;
                const ox = l[0].A[0], oy = l[0].A[1];
                for (const p of l) {
                    a += (p.A[0] - ox) * (p.B[1] - oy) - (p.B[0] - ox) * (p.A[1] - oy);
                    if (!p.line) a += p.r * p.r * (p.sweep - Math.sin(p.sweep));
                }
                area += a / 2;
            }
            const want = Math.PI * ((R + w / 2) ** 2 - (R - w / 2) ** 2);
            expect(Math.abs(area - want) / want).toBeLessThan(2e-4);
        },
    );

    test("an open stroke still gets its caps", () => {
        const { loops, stats } = bakeArcPerimeter([[0, 0], [100, 20], [200, -10], [300, 30]], 40, { tol: 0.125 });
        expect(stats.openChains).toBe(0);
        expect(stats.unbalanced).toBe(0);
        expect(loops.length).toBe(1);
        expect(closedAll(loops)).toBe(true);
        // The half-turn caps are there: two pieces sweeping a half turn.
        const halves = loops[0].filter((p) => !p.line && Math.abs(Math.abs(p.sweep) - Math.PI) < 1e-9);
        expect(halves.length).toBe(2);
    });

    test("a stroke that doubles back onto its own start keeps its caps", () => {
        // Ends coincide but the tangents OPPOSE, so this is a cusp and not a
        // loop: it genuinely wants caps. What it wants is the two DIFFERENT
        // halves of one circle. Built from the same data they came out as the
        // same half twice — half the circle drawn twice and the other half not
        // at all — which left the boundary open by exactly that half: a 104-unit
        // fabricated edge across a 200-unit stroke.
        const { loops, stats } = bakeArcPerimeter([[0, 0], [100, 0], [200, 0], [100, 0], [0, 0]], 30, { tol: 0.125 });
        expect(stats.openChains).toBe(0);
        expect(stats.unbalanced).toBe(0);
        expect(loops.length).toBe(1);
        expect(closedAll(loops)).toBe(true);
        // The spline swings wide of the retraced line — it is a cusp, not a fold
        // — so the ink reaches further than the pen's own half-width, and the
        // outline has to reach with it.
        // Piece boxes, not endpoints: the cap that reaches x = -15 is an arc
        // whose two ends both sit at x = 0, so an endpoint scan would miss the
        // whole point of it.
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of loops[0]) {
            const b = pieceBBox(p);
            if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1];
            if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3];
        }
        expect(x0).toBeCloseTo(-15, 6);
        expect(x1).toBeCloseTo(215, 6);
        expect(y1 - y0).toBeGreaterThan(30);
    });
});

/**
 * A PAUSE MID-STROKE used to sever the outline.
 *
 * Reported as "2 out of 5 came back wrong": long straight lines across two
 * otherwise ordinary pen strokes. A touch digitizer repeats a coordinate while
 * the finger rests -- a mouse reports nothing at all, which is why this never
 * showed up on the desktop. The repeat collapsed the spline handles at that
 * anchor, the two cubics either side recovered their limit tangent from
 * DIFFERENT control polygons, and the centerline came out with a 163.7 degree
 * kink in one stroke and 84.4 in the other. `ChainBuilder` hands one side's
 * tangent to both pieces at a joint, so the piece before the kink declared an
 * endpoint 11.9 units -- 2r, the whole pen -- from where its own arc ends. One
 * severed boundary, a stitch that cannot close, and `_sealed` then drew a chord
 * across the middle of the stroke.
 *
 * Fixed where the spline is DEFINED (`distinctSamples`, biarc.js) rather than at
 * pointer intake, so a drawing already saved with the repeats in it comes back
 * right when it re-bakes on load.
 */
describe("a pause in the middle of a stroke", () => {
    const CASES = [["three repeats, 163.7 degree kink", PAUSE], ["one repeat, 84.4 degree kink", PAUSE2]];
    for (const [name, F] of CASES) {
        test(`resolves to one closed loop -- ${name}`, () => {
            const arc = bakeArcPerimeter(F.pts, F.width, { tol: 0.125 });
            expect(arc.stats.openChains).toBe(0);
            expect(arc.stats.unbalanced).toBe(0);
            expect(arc.loops.length).toBe(1);
            // The damage was VISIBLE: a chord across the shape. A pen stroke's
            // perimeter is arcs end to end, so any straight piece at all is one.
            expect(arc.loops[0].filter((p) => p.line).length).toBe(0);
        });
    }
    test("the repeats are the only difference -- dropping them by hand agrees", () => {
        for (const [, F] of CASES) {
            const asDrawn = bakeArcPerimeter(F.pts, F.width, { tol: 0.125 });
            const byHand = [];
            for (const p of F.pts) {
                const q = byHand[byHand.length - 1];
                if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.0001) continue;
                byHand.push(p);
            }
            const cleaned = bakeArcPerimeter(byHand, F.width, { tol: 0.125 });
            expect(asDrawn.loops[0].length).toBe(cleaned.loops[0].length);
        }
    });
});
