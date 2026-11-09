// The deep picture does not read the engine's maths library (OPEN-FLAGS F176). The browser's Math is moved one last
// bit on half its calls and the deep tiles are derived again: the same bits. The break-check moves detMath's results the
// same way instead, and the same tiles move, so a pass is not a blind spot.
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";
import { ptAt } from "./geometry/arcPerimeter";
import { Loop } from "./geometry/loop";
import { circleLoop } from "./geometry/antRuns";
import * as detMath from "./geometry/detMath";

useEngines();

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
/** `fn` with one last bit moved on about half its results, chosen by the arguments' bits. */
const nudged = (fn) => (...a) => {
    const r = fn(...a);
    if (!Number.isFinite(r) || r === 0) return r;
    let h = 0x811c9dc5;
    for (const x of a) { f64[0] = x; h = Math.imul(h ^ u32[0], 16777619) ^ Math.imul(u32[1], 2246822519); }
    if ((h >>> 0) % 2 === 0) return r;
    f64[0] = r;
    if (u32[0] === 0xffffffff) { u32[0] = 0xfffffffe; } else u32[0] += 1;
    return f64[0];
};
const MATH = ["sin", "cos", "tan", "atan", "atan2", "acos", "asin", "hypot", "pow"];
const DET = ["sin", "cos", "tan", "atan", "atan2", "acos", "asin", "hypot"];

function tileVerts(E, F) {
    const t = E.store._ensureUp(F, 0, 0), vs = [];
    for (const p of t.objs) if (p.loops) for (const l of p.loops) for (const q of l.toPieces()) vs.push(q.A[0], q.A[1], q.B[0], q.B[1]);
    return vs;
}
/** The frames down to `depth` holding level-0 point P. */
function chainTo(E, P, depth) {
    const out = [];
    let F = E.lm.frame("0");
    for (let d = 1; d <= depth; d++) { const q = E.lm.mapPointF(P, "0", F.id); F = E.lm.cellChild(F.id, Math.round(q[0] / 32), Math.round(q[1] / 32)); out.push(F.id); }
    return out;
}
function scene() {
    const E = mkEngine(1369, 925);
    const pts = [];
    for (let k = 0; k <= 40; k++) { const t = k / 40; pts.push([300 + 700 * t, 420 + 160 * Math.sin(5.1 * t) + 40 * t * t]); }
    drawStroke(E, pts, 18);
    // One bite, so cut pieces and their corners are in the mix.
    const sx = 640 * E.cam.inScale + E.cam.inPanX, sy = 480 * E.cam.inScale + E.cam.inPanY;
    E.setEraserSize(12); E.setTool("erasePartial");
    E.pointerDown(sx, sy); E.pointerMove(sx + 0.5, sy); E.pointerUp(); E.flushBakes(); E.flushErases();
    E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), loops: [Loop.from(circleLoop(1500.123456789, 700.987654321, 90.5))], color: "#123", opacity: 1, w: 6 }, "0");
    const pieces = E.doc.list("0").filter((x) => x.type === "shape").flatMap((x) => x.loops.flatMap((l) => l.toPieces()));
    const sites = [0.1, 0.3, 0.55, 0.8, 0.97].map((f) => ptAt(pieces[Math.floor(f * pieces.length)], 0.41));
    const frames = sites.flatMap((P) => chainTo(E, P, 5));
    return { E, frames };
}
const read = (E, frames) => { E.store.bumpEpoch(); return frames.map((F) => tileVerts(E, F)); };
const same = (a, b) => a.length === b.length && a.every((v, k) => v.length === b[k].length && v.every((x, n) => x === b[k][n]));

test("F176: the deep tiles are the same bits whatever the browser's Math returns", () => {
    const { E, frames } = scene();
    const base = read(E, frames);
    expect(base.filter((v) => v.length).length).toBeGreaterThan(15);
    const orig = Object.fromEntries(MATH.map((n) => [n, Math[n]]));
    let moved;
    try {
        for (const n of MATH) Math[n] = nudged(orig[n]);
        moved = read(E, frames);
    } finally { for (const n of MATH) Math[n] = orig[n]; }
    expect(same(base, moved)).toBe(true);
    // Break-check: the same nudge on detMath moves them.
    const spies = DET.map((n) => jest.spyOn(detMath, n).mockImplementation(nudged(orig[n])));
    try {
        expect(same(base, read(E, frames))).toBe(false);
    } finally { for (const s of spies) s.mockRestore(); }
    expect(same(base, read(E, frames))).toBe(true);
});
