/**
 * F173 — a cut's corner re-solved at every level (`rederiveJoins`, `deriveStep`), the stable
 * line–circle roots, and the cede that refuses a seal. The corner is Kobin's report of
 * 2026-10-30 (`.kobin-reports/report-2026-10-30T17-57-28-972Z`): natives 206/207 at depth 18
 * and the depth-19 cell (-1991, -399) whose hole the cede cut. Ported from the 2026-10-31 trial.
 */
import { circleCrossSeg, canonPos, canonArc } from "./arcPerimeter";
import { rederiveJoins, subtractShape, clipShapeToRect, rectLoop, transformLoops, encodeLoops } from "./arcShape";
import { deriveStep } from "./derive";
import { DEFAULT_FREEZE_R } from "./freeze";
import { cede } from "../cede";

const cfg = { base: 1 / 16, enter: 256, exit: 1 / 32, arcTolerancePx: 0.25, cullPx: 0.3, fadeLoPx: 0.15 };
const windowRect = { left: -65536, top: -65536, right: 65536, bottom: 65536 };
const hole = { left: -63728.01171875, top: -12784.01171875, right: -63695.98828125, bottom: -12751.98828125 };
// Depth 18: 206's canonical line, the corner as carried (12.4 units off the circle), 207's arc.
const P = [-65584, -13800.104315668344], Q = [65584, 57550.61493444443];
const S = [-63694.557235596156, -12772.314761644986], C = [31728259.455932617, 24892233.18359375], r = 40385500.21382847;
const arcB = [-65536, -10441.33195693791], end = [-65584, -10380.049173407679];
const source = () => [[
    { line: true, A: P, B: S, P, Q, sa: 0, sb: canonPos(P, Q, S) },
    { line: false, A: S, B: arcB, C, r, a0: -2.477071754188082, sweep: -0.00007355518938645389 },
    { line: false, A: arcB, B: end, C, r, a0: -2.4771453093774682, sweep: -0.0000019275061813317507 },
    { line: true, A: end, B: P },
]];
const closed = (loops) => loops.every((l) => l.every((p, i) => p.B[0] === l[(i + 1) % l.length].A[0] && p.B[1] === l[(i + 1) % l.length].A[1]));
const offCircle = (pt, c, rr) => Math.abs(Math.hypot(pt[0] - c[0], pt[1] - c[1]) - rr);
const step = (loops, centre) => {
    const out = [];
    deriveStep([{ type: "shape", id: 1, origin: "native", color: "#222222", opacity: 0.45, loops, w: 0.01 }],
        256, { x: -centre[0] * 256, y: -centre[1] * 256 }, windowRect, "child",
        { cfg, width: 411, opacityGroups: true, parentCurved: false, childCurved: false }, out);
    return out.flatMap((o) => o.loops || []);
};
const arcOf = (A, B, c, rr, dir) => {
    const a0 = Math.atan2(A[1] - c[1], A[0] - c[0]);
    let sweep = Math.atan2(B[1] - c[1], B[0] - c[0]) - a0;
    if (dir > 0 && sweep <= 0) sweep += 2 * Math.PI;
    if (dir < 0 && sweep >= 0) sweep -= 2 * Math.PI;
    return { line: false, A, B, C: c, r: rr, a0, sweep };
};
const cutK = (p) => Object.assign(p, { K: { a0: p.a0, sweep: p.sweep, A: p.A, B: p.B }, ua: 0, ub: 1 });
// A cut arc whose canonical arc runs `extra` radians on past the piece's end: that end is a point a cut made.
const cutPast = (p, extra) => {
    const sw = p.sweep + Math.sign(p.sweep) * extra, th = p.a0 + sw;
    return Object.assign(p, { K: { a0: p.a0, sweep: sw, A: p.A, B: [p.C[0] + p.r * Math.cos(th), p.C[1] + p.r * Math.sin(th)] }, ua: 0, ub: p.sweep / sw });
};

test("the report's contact: the stable roots lie on the small circle against its long canonical line", () => {
    const cc = [42245.89896413421, 60814.179005216574], rr = 2.407163394321708;
    const a = [-65584, 2158.101648611948], b = [51015.36048843339, 65584];
    const roots = circleCrossSeg(cc, rr, a, b);
    expect(roots).toHaveLength(2);
    // The textbook quadratic put this corner 7.3e-7 off the circle; 80-digit arithmetic says (42244.00401535867, 60812.69455085721).
    for (const x of roots) expect(offCircle(x, cc, rr)).toBeLessThan(1e-9);
    expect(roots[0][0]).toBeCloseTo(42244.00401535867, 8);
    expect(roots[0][1]).toBeCloseTo(60812.69455085721, 8);
    expect(circleCrossSeg(cc, rr, b, a).every((x) => offCircle(x, cc, rr) < 1e-9)).toBe(true);
});

test("the carried corner seals the parent's hole cut; re-solved on its circle, the same cut closes", () => {
    const original = source(), before = JSON.stringify(encodeLoops(original));
    expect(subtractShape(original, rectLoop(hole)).stats.sealed).toBe(2);
    const fixed = rederiveJoins(original, 32);
    expect(closed(fixed)).toBe(true);
    expect(fixed[0][0].B).toBe(fixed[0][1].A);
    expect(offCircle(fixed[0][1].A, C, r)).toBeLessThan(1e-7);
    const cut = subtractShape(fixed, rectLoop(hole));
    expect(cut.stats.sealed).toBe(0);
    expect(cut.stats.unbalanced).toBe(0);
    expect(closed(cut.loops)).toBe(true);
    expect(JSON.stringify(encodeLoops(original))).toBe(before);   // the input is not touched
});

test("derived from depth 16, the corner is on its circle at 17 and 18, and the hole cut needs no seal", () => {
    const level17 = transformLoops(source(), 1 / 4096, 16416, 52000);
    const level16 = transformLoops(level17, 1 / 4096, 42240, 60800);
    const at17 = step(level16, [42240, 60800]);
    const at18 = step(at17, [16416, 52000]);
    expect(at18.length).toBeGreaterThan(0);
    expect(closed(at18)).toBe(true);
    const cut = subtractShape(at18, rectLoop(hole));
    expect(cut.stats.sealed || 0).toBe(0);
    expect(cut.stats.unbalanced || 0).toBe(0);
});

test("a corner at its canonical arc's own end moves K's end with it; the far end keeps its angle", () => {
    const loops = source(), p = cutK(loops[0][1]);
    const farAngle = p.a0 + p.sweep;
    const arc = rederiveJoins(loops, 32)[0][1], k = canonArc(arc);
    expect(arc.A).toEqual(k.A);
    expect(arc.ua).toBe(0);
    expect(arc.ub).toBeCloseTo(1, 12);
    expect(arc.a0 + arc.sweep).toBeCloseTo(farAngle, 12);
    expect(offCircle(k.A, C, r)).toBeLessThan(1e-7);
});

test("past the freeze the report's arc descends as lines with a closed boundary", () => {
    let loops = rederiveJoins(source(), 32);
    loops = step(loops, [-63712, -12768]);
    loops = step(loops, [26784, -41952]);
    expect(loops.length).toBeGreaterThan(0);
    expect(closed(loops)).toBe(true);
    expect(loops.flat().every((p) => p.line)).toBe(true);
    expect(DEFAULT_FREEZE_R).toBeLessThan(r * 4096 * 4096);
});

test("a corrected corner just outside the tile is a closed, stable cut-off along the tile's edge (Kobin, 2026-10-30)", () => {
    const S2 = [9.9999, 0], A = [-20, 0], B = [0, 10], D = [-20, 10];
    const loop = [
        { line: true, A, B: S2, P: A, Q: [20, 0], sa: 0, sb: canonPos(A, [20, 0], S2) },
        { line: false, A: S2, B, C: [0, 0], r: 10, a0: 0, sweep: Math.PI / 2 },
        { line: true, A: B, B: D }, { line: true, A: D, B: A },
    ];
    const tile = { left: -25, top: -2, right: 9.99995, bottom: 12 };
    const fixed = rederiveJoins([loop], 0.001);
    expect(fixed[0][0].B[0]).toBeGreaterThan(tile.right);
    const clipped = clipShapeToRect(fixed, tile);
    expect(clipped.stats.sealed || 0).toBe(0);
    expect(closed(clipped.loops)).toBe(true);
    const ends = clipped.loops.flat().flatMap((p) => [p.A, p.B]);
    expect(ends.every((p) => p[0] <= tile.right + 1e-10)).toBe(true);
    expect(clipped.loops.flat().some((p) => p.line && Math.abs(p.A[0] - tile.right) < 1e-10 && Math.abs(p.B[0] - tile.right) < 1e-10)).toBe(true);
    // The cut-off does not regrow when the clipped shape is re-solved and clipped again.
    const again = clipShapeToRect(rederiveJoins(clipped.loops, 0.001), tile);
    expect(closed(again.loops)).toBe(true);
    expect(again.loops.flat().every((p) => p.A[0] <= tile.right + 1e-10 && p.B[0] <= tile.right + 1e-10)).toBe(true);
});

test("a cede whose hole cut needs a seal changes nothing and says why", () => {
    const record = { obj: { type: "shape", id: 1, origin: "native", loops: source(), w: 0.01 }, level: "0" };
    const doc = { getById: () => record, removeById: jest.fn() };
    const step1 = cede(doc, 1, "child", [], { x0: hole.left, y0: hole.top, x1: hole.right, y1: hole.bottom }, null, null, null, {});
    expect(step1.unresolved).toEqual(expect.objectContaining({ openChains: 2, sealed: 2 }));
    expect(doc.removeById).not.toHaveBeenCalled();
});

test("a line–line corner after the freeze may sit past a canonical end before the tile clips it", () => {
    const a = [-20, 0], s = [9.9999, 0], b = [10, 10], d = [-20, 10];
    const lines = [
        { line: true, A: a, B: s, P: a, Q: s, sa: 0, sb: 1 },
        { line: true, A: s, B: b, P: [10, -10], Q: b, sa: 0.5, sb: 1 },
        { line: true, A: b, B: d }, { line: true, A: d, B: a },
    ];
    const fixed = rederiveJoins([lines], 0.001);
    expect(fixed[0][0].B).toEqual([10, 0]);
    expect(fixed[0][1].A).toBe(fixed[0][0].B);
    expect(fixed[0][0].sb).toBeGreaterThan(1);
    const cut = clipShapeToRect(fixed, { left: -25, top: -2, right: 9.99995, bottom: 12 });
    expect(cut.stats.sealed || 0).toBe(0);
    expect(closed(cut.loops)).toBe(true);
    expect(cut.loops.flat().every((p) => p.A[0] <= 9.99995 + 1e-10 && p.B[0] <= 9.99995 + 1e-10)).toBe(true);
});

test.each([1, -1])("a circle–circle corner takes the branch it was on (%i); both circles are kept", (sign) => {
    const A = [-5, 0], S2 = [3.00001, sign * 4.00002], B = [11, 0];
    const a = cutPast(arcOf(A, S2, [0, 0], 5, -sign), 0.2), b = cutK(arcOf(S2, B, [6, 0], 5, -sign));
    const fixed = rederiveJoins([[a, b, { line: true, A: B, B: A }]], 0.001)[0];
    expect(fixed[0].B).toEqual([3, sign * 4]);
    expect(fixed[1].A).toBe(fixed[0].B);
    expect(fixed[0].C).toEqual([0, 0]); expect(fixed[1].C).toEqual([6, 0]);
    expect(fixed[0].r).toBe(5); expect(fixed[1].r).toBe(5);
    for (const p of fixed.slice(0, 2)) {
        expect(offCircle(fixed[0].B, p.C, p.r)).toBeLessThan(1e-12);
        expect(p.ua).toBeGreaterThanOrEqual(0); expect(p.ub).toBeLessThanOrEqual(1);
    }
    expect(closed([fixed])).toBe(true);
});

test("a tiny circle meeting a huge one keeps its corner where it was, on both circles", () => {
    const R = 2 ** 36, A = [0, -32], S2 = [0.00001, -0.00001], B = [8, 4];
    const a = cutPast(arcOf(A, S2, [-R, 0], R, 1), 1e-9), b = cutK(arcOf(S2, B, [3, 4], 5, 1));
    const fixed = rederiveJoins([[a, b, { line: true, A: B, B: A }]], 0.001)[0];
    expect(Math.hypot(...fixed[0].B)).toBeLessThan(1e-4);
    expect(fixed[1].A).toBe(fixed[0].B);
    expect(offCircle(fixed[0].B, [3, 4], 5)).toBeLessThan(1e-4);
    expect(fixed[0].r).toBe(R); expect(fixed[1].r).toBe(5);
});

test("tangent joins, joins on one circle and uncut loops are left exactly as they were", () => {
    // A G1 vertex (two circles tangent at it), a chop's cut on one circle, and the same loop uncut.
    const t1 = cutK(arcOf([-10, 0], [10, 0], [0, 0], 10, -1)), t2 = cutK(arcOf([10, 0], [5, -5], [5, 0], 5, -1));
    const tangent = [[t1, t2, { line: true, A: [5, -5], B: [-10, 0] }]];
    expect(rederiveJoins(tangent, 0.001)).toBe(tangent);
    const o1 = cutK(arcOf([-5, 0], [3, 4], [0, 0], 5, -1)), o2 = cutK(arcOf([3, 4], [5, 0], [0, 0], 5, -1));
    const oneCircle = [[o1, o2, { line: true, A: [5, 0], B: [-5, 0] }]];
    expect(rederiveJoins(oneCircle, 0.001)).toBe(oneCircle);
    const uncut = [source()[0].map((p) => { const q = { ...p }; delete q.P; delete q.Q; delete q.sa; delete q.sb; return q; })];
    expect(rederiveJoins(uncut, 32)).toBe(uncut);
});

test("a vertex the ink was drawn with is carried, even on a piece a re-solved corner made cut (F178)", () => {
    // c1 is cut at J1, off its canonical line y = 0; l2 runs on to W, a sharp vertex 1e-6 off a3's circle.
    const J1 = [0, 1e-6], W = [10, 10], C3 = [10, 0], r3 = 10 + 1e-6;
    const c1 = { line: true, A: [-20, 0], B: J1, P: [-20, 0], Q: [20, 0], sa: 0, sb: canonPos([-20, 0], [20, 0], J1) };
    const l2 = { line: true, A: J1, B: W };
    const a3 = { line: false, A: W, B: [C3[0] + r3, 0], C: C3, r: r3, a0: Math.PI / 2, sweep: -Math.PI / 2 };
    const loop = [c1, l2, a3, { line: true, A: a3.B, B: c1.A }];
    const fixed = rederiveJoins([loop], 0.001)[0];
    expect(fixed[0].B[1]).toBe(0);                // the cut's corner is re-solved onto both lines
    expect(fixed[1].A).toBe(fixed[0].B);
    expect(fixed[1].P).toBe(J1);                  // l2 keeps its support as a cut line on what it was
    expect(fixed[1].B).toBe(W);                   // and its far vertex, drawn sharp, stays where it was
    expect(fixed[2]).toBe(a3);
});

test("a move past the cap is not taken: the parent level would see it", () => {
    const loops = source();
    expect(rederiveJoins(loops, 2)).toBe(loops);   // the corner is 12.4 units off; the cap at 4096x is 2
});
