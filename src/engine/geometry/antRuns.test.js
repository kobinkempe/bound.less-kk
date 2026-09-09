/**
 * The selection indicator's geometry on arcs: nothing flattened, and the
 * answers checked against what the shapes plainly are.
 */
import {
    pieceLength, runLength, onRectEdge, loopRuns, runPathData, loopsBounds, edgeSpans, circleLoop,
    rectLoopOf, insideLoops, clipRunToRect,
} from "./antRuns";
import { chordCubic } from "./arcShape";
import { insideShape } from "./arcShape";

const line = (A, B) => ({ line: true, A, B });
const arc = (C, r, a0, sweep) => ({
    A: [C[0] + r * Math.cos(a0), C[1] + r * Math.sin(a0)],
    B: [C[0] + r * Math.cos(a0 + sweep), C[1] + r * Math.sin(a0 + sweep)],
    C, r, a0, sweep,
});

describe("lengths", () => {
    test("a line is its hypot, an arc is r times sweep", () => {
        expect(pieceLength(line([0, 0], [3, 4]))).toBeCloseTo(5, 12);
        expect(pieceLength(arc([0, 0], 10, 0, Math.PI))).toBeCloseTo(10 * Math.PI, 12);
        expect(runLength(circleLoop(5, 5, 2))).toBeCloseTo(4 * Math.PI, 12);
    });
});

describe("seams", () => {
    const R = { x0: 0, y0: 0, x1: 100, y1: 100 };
    test("a straight piece along a side of the rect is a seam; one that crosses it is not", () => {
        expect(onRectEdge(line([0, 10], [0, 60]), R, 1e-9)).toBe(true);
        expect(onRectEdge(line([20, 100], [80, 100]), R, 1e-9)).toBe(true);
        expect(onRectEdge(line([-5, 50], [5, 50]), R, 1e-9)).toBe(false);
        expect(onRectEdge(line([0, 10], [1, 60]), R, 1e-9)).toBe(false);
    });
    test("an arc never lies along a side", () => {
        expect(onRectEdge(arc([0, 50], 1e9, -1e-9, 2e-9), R, 1e-3)).toBe(false);
    });
    test("a loop with no seam is one closed run; seams open it into stretches of free edge", () => {
        // A shape clipped to the rect: two free edges crossing the inside, and
        // three cuts along the top, right and bottom.
        const loop = [
            line([20, 100], [0, 60]),       // free (one end on the left side, not along it)
            line([0, 60], [30, 0]),         // free
            line([30, 0], [100, 0]),        // along the top: seam
            line([100, 0], [100, 100]),     // along the right: seam
            line([100, 100], [20, 100]),    // along the bottom: seam
        ];
        const runs = loopRuns(loop, [{ rect: R, eps: 1e-9 }]);
        expect(runs.length).toBe(1);
        expect(runs[0].closed).toBe(false);
        expect(runs[0].pieces.length).toBe(2);
        expect(runs[0].pieces[0].A).toEqual([20, 100]);
        expect(runs[0].pieces[1].B).toEqual([30, 0]);
        expect(loopRuns(circleLoop(50, 50, 10), [{ rect: R, eps: 1e-9 }])).toEqual([{ pieces: circleLoop(50, 50, 10), closed: true }]);
    });
    test("a seam in the middle of the loop splits it in two, in loop order", () => {
        const loop = [line([0, 0], [10, 0]), line([10, 0], [10, 10]), line([10, 10], [0, 10]), line([0, 10], [0, 0])];
        // Call the right side a seam: the run wraps around the start.
        const runs = loopRuns(loop, [{ rect: { x0: -50, y0: -50, x1: 10, y1: 50 }, eps: 1e-9 }]);
        expect(runs.length).toBe(1);
        expect(runs[0].pieces.map((p) => p.A)).toEqual([[10, 10], [0, 10], [0, 0]]);
    });
});

describe("path data", () => {
    test("lines are lines, arcs are SVG arcs, relative to the origin and scaled", () => {
        const d = runPathData({ pieces: [line([100, 100], [110, 100])], closed: true }, 100, 100, 2);
        expect(d).toBe("M0.00,0.00L20.00,0.00Z");
        const q = runPathData({ pieces: [arc([0, 0], 10, 0, Math.PI / 2)], closed: false }, 0, 0, 1);
        // An ordinary radius fits the arc command: one arc, radius as given,
        // small-arc, positive sweep, to its end — whatever the sweep.
        expect(q).toBe("M10.00,0.00A10.00,10.00 0 0,1 0.00,10.00");
        const ten = arc([0, 0], 10, 0, Math.PI / 18);
        expect(runPathData({ pieces: [ten], closed: false }, 0, 0, 1)).toBe("M10.00,0.00A10.00,10.00 0 0,1 9.85,1.74");
        // A radius the browser's float32 centre could not place within a
        // quarter pixel at this scale goes as cubics from the endpoints and
        // sweep: 1e8 px, 10° — one cubic, chordCubic's, byte for byte.
        const huge = arc([0, 0], 1e8, 0, Math.PI / 18);
        const c = runPathData({ pieces: [huge], closed: false }, 0, 0, 1);
        const cc = chordCubic(huge);
        const f = (v) => v.toFixed(2);
        expect(c).toBe("M" + f(huge.A[0]) + "," + f(huge.A[1]) + "C" + f(cc[1][0]) + "," + f(cc[1][1]) + " " + f(cc[2][0]) + "," + f(cc[2][1]) + " " + f(cc[3][0]) + "," + f(cc[3][1]));
        expect(c.includes("A")).toBe(false);
        // The radius is a length: it scales with k like the coordinates.
        expect(runPathData({ pieces: [arc([0, 0], 10, 0, Math.PI / 2)], closed: false }, 0, 0, 3)).toBe("M30.00,0.00A30.00,30.00 0 0,1 0.00,30.00");
        // A negative sweep is the other flag.
        expect(runPathData({ pieces: [arc([0, 0], 10, Math.PI / 2, -Math.PI / 2)], closed: false }, 0, 0, 1)).toBe("M0.00,10.00A10.00,10.00 0 0,0 10.00,0.00");
        // Two half turns stay two arcs; never a cubic.
        const circle = runPathData({ pieces: circleLoop(0, 0, 10), closed: true }, 0, 0, 1);
        expect((circle.match(/A/g) || []).length).toBe(2);
        expect(circle.includes("C")).toBe(false);
        // A single piece past a half turn is split at its midpoint: an SVG arc
        // is named by its endpoints, and a full circle would draw nothing.
        const full = runPathData({ pieces: [arc([0, 0], 10, 0, 2 * Math.PI)], closed: true }, 0, 0, 1);
        expect(full).toBe("M10.00,0.00A10.00,10.00 0 0,1 -10.00,0.00A10.00,10.00 0 0,1 10.00,0.00Z");
        const most = runPathData({ pieces: [arc([0, 0], 10, 0, 1.5 * Math.PI)], closed: false }, 0, 0, 1);
        expect((most.match(/A/g) || []).length).toBe(2);
        expect(most.endsWith(" 0.00,-10.00")).toBe(true);
    });
});

describe("bounds", () => {
    test("an arc's bounds reach past its chord where it passes a cardinal angle", () => {
        const b = loopsBounds([[arc([0, 0], 10, -Math.PI / 4, Math.PI / 2)]]);   // through angle 0: reaches x = 10
        expect(b.x1).toBeCloseTo(10, 12);
        expect(b.y0).toBeCloseTo(-10 * Math.SQRT1_2, 12);
        expect(loopsBounds([circleLoop(5, 5, 3)])).toEqual({ x0: 2, y0: 2, x1: 8, y1: 8 });
    });
});

describe("edgeSpans", () => {
    const V = { x0: 0, y0: 0, x1: 400, y1: 300 };
    const inside = (loops) => (p) => insideShape(loops, p);
    const D = 0.01;                                  // the hair inside the edge
    test("a box poking in from the left spans the left side exactly where it is", () => {
        const loops = [rectLoopOf({ x0: -50, y0: 100, x1: 60, y1: 180 })];
        const s = edgeSpans(loops, V, inside(loops), D);
        expect(s.left).toEqual([[100, 180]]);
        expect(s.right).toEqual([]);
        expect(s.top).toEqual([]);
        expect(s.bottom).toEqual([]);
        expect(s.covered).toBe(false);
    });
    test("a shape with a hole across the edge spans the ink, not the hole", () => {
        // A ring: outer box from x=-100..100, inner hole x=-50..50, both across the left side.
        const loops = [rectLoopOf({ x0: -100, y0: 50, x1: 100, y1: 250 }), rectLoopOf({ x0: -50, y0: 100, x1: 50, y1: 200 }).reverse().map((p) => ({ line: true, A: p.B, B: p.A }))];
        const s = edgeSpans(loops, V, inside(loops), D);
        expect(s.left).toEqual([[50, 100], [200, 250]]);
    });
    test("a circle across the top spans the chord it cuts", () => {
        const loops = [circleLoop(200, 0, 50)];
        const s = edgeSpans(loops, V, inside(loops), D);
        expect(s.top.length).toBe(1);
        expect(s.top[0][0]).toBeCloseTo(150, 2);
        expect(s.top[0][1]).toBeCloseTo(250, 2);
        expect(s.left).toEqual([]);
        // ...and exactly on the line, where the circle's two arcs meet the
        // line at their shared vertices, each vertex is still counted once.
        const t = edgeSpans(loops, V, inside(loops), 0);
        expect(t.top.length).toBe(1);
        expect(t.top[0][0]).toBeCloseTo(150, 9);
        expect(t.top[0][1]).toBeCloseTo(250, 9);
    });
    test("a vertex exactly on the side is counted once", () => {
        // A diamond whose left vertex sits on x = 0: the two pieces meeting there
        // must not both count, or the winding would be off by one for the rest.
        const loops = [[line([0, 150], [60, 90]), line([60, 90], [120, 150]), line([120, 150], [60, 210]), line([60, 210], [0, 150])]];
        const s = edgeSpans(loops, V, inside(loops), 0);
        expect(s.left).toEqual([]);
        // A hair inside, the diamond's tip is a span a hair long — and nothing more.
        const h = edgeSpans(loops, V, inside(loops), D);
        const total = h.left.reduce((a, [p, q]) => a + (q - p), 0);
        expect(total).toBeLessThan(3 * D);
        // ...and the same diamond shifted 30 px left has a real span.
        const shifted = loops.map((l) => l.map((p) => ({ line: true, A: [p.A[0] - 30, p.A[1]], B: [p.B[0] - 30, p.B[1]] })));
        const t = edgeSpans(shifted, V, inside(shifted), D);
        expect(t.left.length).toBe(1);
        expect(t.left[0][0]).toBeCloseTo(120, 1);
        expect(t.left[0][1]).toBeCloseTo(180, 1);
    });
    test("ink that floods the view is covered on every side; a view inside a hole is not", () => {
        const big = [rectLoopOf({ x0: -1000, y0: -1000, x1: 1000, y1: 1000 })];
        const s = edgeSpans(big, V, inside(big), D);
        expect(s.covered).toBe(true);
        expect(s.left).toEqual([[0, 300]]);
        expect(s.top).toEqual([[0, 400]]);
        // With no crossing anywhere near — a disc far bigger than the view —
        // the centre decides.
        const disc = [circleLoop(200, 150, 5000)];
        const u = edgeSpans(disc, V, inside(disc), D);
        expect(u.covered).toBe(true);
        expect(u.bottom).toEqual([[0, 400]]);
        const ring = [rectLoopOf({ x0: -1000, y0: -1000, x1: 1000, y1: 1000 }), rectLoopOf({ x0: -500, y0: -500, x1: 500, y1: 500 }).map((p) => ({ line: true, A: p.B, B: p.A })).reverse()];
        const t = edgeSpans(ring, V, inside(ring), D);
        expect(t.covered).toBe(false);
        expect(t.left).toEqual([]);
    });
    test("ink stopping exactly at the side — a piece clipped to the view's edge — still spans it", () => {
        // A half-disc inside the view whose flat side lies ON the right edge,
        // as arcs and as a fine polygon. On the line itself the scan is
        // degenerate; a hair inside it is not, and both agree.
        const arcs = [[arc([400, 150], 80, Math.PI / 2, Math.PI), line([400, 70], [400, 230])]];
        const poly = [];
        for (let i = 0; i <= 64; i++) { const t = Math.PI / 2 + Math.PI * i / 64; poly.push([400 + 80 * Math.cos(t), 150 + 80 * Math.sin(t)]); }
        const lines = [poly.map((p, i) => line(p, poly[(i + 1) % poly.length]))];
        const a = edgeSpans(arcs, V, inside(arcs), D), b = edgeSpans(lines, V, inside(lines), D);
        expect(a.right.length).toBe(1);
        expect(a.right[0][0]).toBeCloseTo(70, 1);
        expect(a.right[0][1]).toBeCloseTo(230, 1);
        expect(b.right[0][0]).toBeCloseTo(a.right[0][0], 1);
        expect(b.right[0][1]).toBeCloseTo(a.right[0][1], 1);
        expect(a.top).toEqual([]);
        // The same half-disc OUTSIDE the view, touching the edge from beyond it, spans nothing.
        const outside = [[arc([400, 150], 80, -Math.PI / 2, Math.PI), line([400, 230], [400, 70])]];
        expect(edgeSpans(outside, V, inside(outside), D).right).toEqual([]);
    });
});

describe("cubics — the outline of a stroke not yet resolved", () => {
    // A quarter circle of radius 10 about the origin as the standard cubic.
    const k = (4 / 3) * Math.tan(Math.PI / 8);
    const quarter = [[10, 0], [10, 10 * k], [10 * k, 10], [0, 10]];
    test("length is estimated within a percent, and a straight cubic exactly", () => {
        expect(Math.abs(pieceLength(quarter) - 10 * Math.PI / 2) / (10 * Math.PI / 2)).toBeLessThan(0.01);
        expect(pieceLength([[0, 0], [1, 0], [2, 0], [3, 0]])).toBeCloseTo(3, 12);
    });
    test("path data carries the cubic through; it is never a seam; its bounds hold its hull", () => {
        expect(runPathData({ pieces: [quarter], closed: false }, 0, 0, 1)).toBe("M10.00,0.00C10.00,5.52 5.52,10.00 0.00,10.00");
        expect(onRectEdge(quarter, { x0: 0, y0: 0, x1: 10, y1: 10 }, 1e-9)).toBe(false);
        const b = loopsBounds([[quarter]]);
        expect(b.x1).toBeCloseTo(10, 12);
        expect(b.y1).toBeCloseTo(10, 12);
    });
    test("a cubic loop across the side of the view spans it where its ink is, and knows its inside", () => {
        // A capsule-ish loop: four cubics around the origin's quarter circle,
        // i.e. a full circle of radius 10 centred at (0, 150), crossing x = 0.
        const circ = [];
        for (let q = 0; q < 4; q++) {
            const a0 = q * Math.PI / 2, a1 = a0 + Math.PI / 2;
            const p0 = [10 * Math.cos(a0), 150 + 10 * Math.sin(a0)], p3 = [10 * Math.cos(a1), 150 + 10 * Math.sin(a1)];
            circ.push([p0, [p0[0] - k * 10 * Math.sin(a0), p0[1] + k * 10 * Math.cos(a0)], [p3[0] + k * 10 * Math.sin(a1), p3[1] - k * 10 * Math.cos(a1)], p3]);
        }
        const V = { x0: 0, y0: 0, x1: 400, y1: 300 };
        const s = edgeSpans([circ], V, (pt) => insideLoops([circ], pt), 0.01);
        expect(s.left.length).toBe(1);
        expect(s.left[0][0]).toBeCloseTo(140, 1);
        expect(s.left[0][1]).toBeCloseTo(160, 1);
        expect(insideLoops([circ], [0, 150])).toBe(true);
        expect(insideLoops([circ], [30, 150])).toBe(false);
        expect(insideLoops([circleLoop(50, 50, 10)], [52, 50])).toBe(true);
        expect(insideLoops([rectLoopOf({ x0: 0, y0: 0, x1: 5, y1: 5 })], [6, 2])).toBe(false);
    });
});

describe("clipRunToRect — the boundary cut to the retained window", () => {
    const R = { x0: 0, y0: 0, x1: 100, y1: 100 };
    test("a run wholly inside is returned as it is, closed and all", () => {
        const loop = circleLoop(50, 50, 10);
        const out = clipRunToRect({ pieces: loop, closed: true }, R);
        expect(out.length).toBe(1);
        expect(out[0].closed).toBe(true);
        expect(out[0].pieces).toEqual(loop);
    });
    test("a line crossing the window is cut to the part inside", () => {
        const out = clipRunToRect({ pieces: [line([-50, 50], [150, 60])], closed: false }, R);
        expect(out.length).toBe(1);
        expect(out[0].pieces.length).toBe(1);
        expect(out[0].pieces[0].A[0]).toBeCloseTo(0, 9);
        expect(out[0].pieces[0].B[0]).toBeCloseTo(100, 9);
        expect(runLength(out[0].pieces)).toBeCloseTo(Math.hypot(100, 5), 9);
        expect(clipRunToRect({ pieces: [line([-50, -50], [-10, -20])], closed: false }, R)).toEqual([]);
    });
    test("an arc is cut at the angles where it crosses the sides, and its length adds up", () => {
        // A circle of radius 40 about (100, 50): its left half is inside, its
        // right half out, and it clears the top and bottom (y from 10 to 90).
        const loop = circleLoop(100, 50, 40);
        const out = clipRunToRect({ pieces: loop, closed: true }, R);
        expect(out.length).toBe(1);
        expect(out[0].closed).toBe(false);
        // The circle meets x = 100 at angles ±π/2, so the kept part is the
        // half from π/2 to 3π/2: half the circumference, exactly.
        expect(runLength(out[0].pieces)).toBeCloseTo(Math.PI * 40, 6);
        for (const q of out[0].pieces) {
            const mid = q.a0 + q.sweep / 2;
            expect(100 + 40 * Math.cos(mid)).toBeLessThanOrEqual(100 + 1e-9);
        }
        // A circle that also runs past the top and bottom loses those bits too:
        // radius 60 spans y from -10 to 110, and on the left only the arc
        // between the crossings of y = 100 and y = 0 survives — the angles
        // where sin is ±5/6, which is 2·asin(5/6), about 113 degrees.
        const tall = clipRunToRect({ pieces: circleLoop(100, 50, 60), closed: true }, R);
        const kept = tall.reduce((a, r) => a + runLength(r.pieces), 0);
        expect(kept).toBeCloseTo(60 * 2 * Math.asin(5 / 6), 6);
        // A whole arc outside is dropped; one inside kept whole.
        expect(clipRunToRect({ pieces: [arc([300, 300], 10, 0, 1)], closed: false }, R)).toEqual([]);
        const inner = arc([50, 50], 10, 0, 1);
        expect(clipRunToRect({ pieces: [inner], closed: false }, R)[0].pieces[0]).toBe(inner);
    });
    test("a closed run that leaves and returns is opened, and its two ends are joined into one run", () => {
        // A box from x=-50..50: the right half inside. Start the loop inside,
        // at the top-right corner going clockwise, so the loop exits and returns.
        const loop = [line([50, 20], [50, 80]), line([50, 80], [-50, 80]), line([-50, 80], [-50, 20]), line([-50, 20], [50, 20])];
        const out = clipRunToRect({ pieces: loop, closed: true }, R);
        expect(out.length).toBe(1);
        expect(out[0].closed).toBe(false);
        // Bottom stretch, then the right side, then the top stretch: 50 + 60 + 50.
        expect(runLength(out[0].pieces)).toBeCloseTo(160, 9);
        expect(out[0].pieces[0].A).toEqual([0, 20]);
        expect(out[0].pieces[out[0].pieces.length - 1].B[0]).toBeCloseTo(0, 9);
    });
});
