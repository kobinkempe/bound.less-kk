// F175: at the level where an arc first freezes, the seam pad's stretch is chopped and frozen as the tile next door
// does it. One level down, a tile on its parent's edge reads each square from its owner (F181 part 2), so this seam
// reads one source; under the centre rule, which phased shapes keep, it reads the next owner's pad, and the chop is
// what keeps the edge from stepping. Break-check: the chop's cells shrunk by one each way (exactly the old lines)
// bring the step back under the centre rule.
import { useEngines, mkEngine } from "./__testkit__/harness";
import { Loop } from "./geometry/loop";
import { circleLoop } from "./geometry/antRuns";

jest.mock("./geometry/freeze", () => {
    const a = jest.requireActual("./geometry/freeze");
    const shrink = (c) => ({ i0: c.i0 + 1, i1: c.i1 - 1, j0: c.j0 + 1, j1: c.j1 - 1 });
    return { ...a, chopFreezeLoops: (l, ph, tol, cells) => a.chopFreezeLoops(l, ph, tol, global.__OLD_CHOP ? shrink(cells) : cells) };
});

useEngines();
const W = 131072, ENTER = 256;

/** Where object `id`'s line pieces in up-tile (i, j) of F cross the vertical line x (the window's edges left out). */
function crossAtX(E, F, i, j, id, x) {
    const ys = [];
    for (const p of E.store._ensureUp(F, i, j).objs) {
        if (p.id !== id || !p.loops) continue;
        for (const l of p.loops) for (const q of l.toPieces()) {
            const [a, b] = q.A[0] <= q.B[0] ? [q.A, q.B] : [q.B, q.A];
            if (!q.line || !(a[0] <= x && x <= b[0]) || a[0] === b[0]) continue;
            if (a[1] === b[1] && Math.abs(Math.abs(a[1] - j * W) - (W / 2 + 48)) < 1e-6) continue;
            ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
        }
    }
    return ys;
}
/**
 * The step at the seam between tiles (0, j) and (1, j) of a depth-4 frame, px at its deepest zoom, for a near-horizontal
 * edge; `centre`: every object read by the centre rule, as a phased shape is.
 */
function seamStep(k, phi, centre = false) {
    const E = mkEngine(800, 600);
    if (centre) E.store._ownPart = () => false;
    const r0 = (k * 8.8e12) / Math.pow(4096, 3), cx = 10.123456789123, cy = -20.98765432101;
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: [Loop.from(circleLoop(cx, cy, r0))], color: "#123", opacity: 1, w: 6 };
    E.doc.add(o, "0");
    const P = [cx + r0 * Math.cos(phi), cy + r0 * Math.sin(phi)];
    let F = E.lm.frame("0");
    for (let d = 1; d <= 3; d++) { const q = E.lm.mapPointF(P, "0", F.id); F = E.lm.cellChild(F.id, Math.round(q[0] / 32), Math.round(q[1] / 32)); }
    const y3 = crossAtX(E, F.id, 0, 0, o.id, 65520)[0];
    const F4 = E.lm.cellChild(F.id, 2047, Math.round(y3 / 32));
    const y4 = (y3 - Math.round(y3 / 32) * 32) * 4096, j4 = Math.floor((y4 + W / 2) / W);
    const a = crossAtX(E, F4.id, 0, j4, o.id, 65536 - 1e-6), b = crossAtX(E, F4.id, 1, j4, o.id, 65536 + 1e-6);
    let gap = Infinity;
    for (const u of a) for (const v of b) gap = Math.min(gap, Math.abs(u - v));
    return gap * ENTER;
}

afterEach(() => { global.__OLD_CHOP = false; });

test("F175: a near-horizontal edge one level below its first freeze does not step at the seam", () => {
    for (const [k, phi] of [[1.05, Math.PI / 2 + 1e-3], [1.05, Math.PI / 2 + 1e-4], [4, Math.PI / 2 + 1e-3]]) {
        expect([k, phi, seamStep(k, phi) < 1e-3, seamStep(k, phi, true) < 1e-3]).toEqual([k, phi, true, true]);
    }
    global.__OLD_CHOP = true;
    expect(seamStep(1.05, Math.PI / 2 + 1e-3)).toBeLessThan(1e-3);            // owner reads: the pad is not read
    expect(seamStep(1.05, Math.PI / 2 + 1e-3, true)).toBeGreaterThan(0.01);   // the old chop: 0.12 px (45 px before F181's line chop)
});
