// F177: an erase on a home arc at or over the freeze radius leaves the rest of that arc's deep picture where it was.
// The boolean works on the arc's chord (`straighten`) but hands the fragments back as arcs on K, so the chain chops and
// freezes them as it does the uncut arc. Break-check: the same fragments as chord lines (the old result) move it.
import { useEngines, mkEngine } from "./__testkit__/harness";
import { Loop } from "./geometry/loop";

useEngines();
const W = 131072;

/** A slab at level 0 whose top edge is ONE arc of radius r, A -> B, closed by lines. */
function slab(E, x0, x1, y, r, h = 60) {
    const A = [x0, y], B = [x1, y], L = x1 - x0, d = Math.sqrt((r - L / 2) * (r + L / 2));
    const C = [(x0 + x1) / 2, y + d];
    const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]), a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
    const loop = [{ line: false, A, B, C, r, a0, sweep: a1 - a0 },
        { line: true, A: B, B: [x1, y + h] }, { line: true, A: [x1, y + h], B: [x0, y + h] }, { line: true, A: [x0, y + h], B: A }];
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: [Loop.from(loop)], color: "#123", opacity: 1, w: 6 };
    E.doc.add(o, "0");
    return o;
}
/** Every vertex of every shape piece in up-tile (0, 0) of each frame down to `depth` holding level-0 point P. */
function deep(E, P, depth) {
    const out = [];
    let F = E.lm.frame("0");
    for (let d = 1; d <= depth; d++) {
        const q = E.lm.mapPointF(P, "0", F.id);
        F = E.lm.cellChild(F.id, Math.round(q[0] / 32), Math.round(q[1] / 32));
        E.store.bumpEpoch();
        const vs = [];
        for (const p of E.store._ensureUp(F.id, 0, 0).objs) if (p.loops) for (const l of p.loops) for (const k of l.toPieces()) vs.push(k.A[0], k.A[1], k.B[0], k.B[1]);
        out.push(vs);
    }
    return out;
}
const dab = (E, x, y, size) => {
    const sx = x * E.cam.inScale + E.cam.inPanX, sy = y * E.cam.inScale + E.cam.inPanY;
    E.setEraserSize(size); E.setTool("erasePartial");
    E.pointerDown(sx, sy); E.pointerMove(sx + 1, sy); E.pointerUp(); E.flushBakes(); E.flushErases();
};

test("F177: a bite out of a 1e13-radius home arc leaves the arc's deep picture elsewhere bit for bit", () => {
    const E = mkEngine(1369, 925);
    const r = 1e13, x0 = -500.123456789, x1 = 500.987654321, y = 0.4567891234;
    const o = slab(E, x0, x1, y, r);
    const top = (x) => { const L = x1 - x0, m = x - (x1 + x0) / 2; return y - (L * L / 4 - m * m) / (2 * r); };
    const sites = [-300.4321, 0.1234, 200.5678].map((x) => [x, top(x)]);
    const before = sites.map((P) => deep(E, P, 3));
    dab(E, 420, y, 10);
    const nat = E.doc.list("0").filter((x) => x.type === "shape");
    expect(nat.length).toBe(1);
    const pieces = nat[0].loops.flatMap((l) => l.toPieces());
    // The big arc's fragments are arcs on their canonical arc, not chords.
    const big = pieces.filter((p) => !p.line && Math.abs(p.r) > 1e12);
    expect(big.length).toBeGreaterThan(0);
    expect(big.every((p) => p.K && p.K.sweep === o.loops[0].toPieces()[0].sweep)).toBe(true);
    const after = sites.map((P) => deep(E, P, 3));
    expect(after).toEqual(before);
    // Break-check: the fragments as cut lines on K's chord, which is what the boolean returned before.
    const chord = nat[0].loops.map((l) => Loop.from(l.toPieces().map((p) => (!p.line && p.K && Math.abs(p.r) > 1e12
        ? { line: true, A: p.A, B: p.B, P: p.K.A, Q: p.K.B, sa: p.sweep * p.K.sweep > 0 ? p.ua : p.ub, sb: p.sweep * p.K.sweep > 0 ? p.ub : p.ua, src: p.src }
        : p))));
    E.doc.removeById(nat[0].id);
    const o2 = { ...o, id: E.doc.allocId(), loops: chord };
    delete o2._bbox;
    E.doc.add(o2, "0");
    const old = sites.map((P) => deep(E, P, 3));
    expect(old).not.toEqual(before);
    void W;
});
