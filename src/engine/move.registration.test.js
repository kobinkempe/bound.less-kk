/**
 * MR — a move keeps a coarse object registered with detail drawn against it
 * at ANY depth (F55, geometry/offsets.js).
 *
 * Kobin's question (2026-09-05): a star drawn in a corner twenty levels down,
 * the object and the star moved together from level 2 — the star must still
 * be in the corner. As built (F41) it was not: the move's one rounded addition
 * at the move level was magnified 4096x per level below, 3.25 units of the
 * deep level after a home-level move, 1,229 after a level-1 move, measured by
 * the probe this file grew out of (`move.registration.probe.js`, deleted).
 *
 * THE DESIGN NOW. A move never touches a stored coordinate and never enters
 * the tile chain. The displacement is snapped to 2^-10 of the move level's
 * unit, kept in the object's table, and turned at render time into whole cell
 * digits per level plus a sub-frame remainder that paint applies — zero from
 * three levels below the move. The small stroke moves by the same digits. So
 * at four levels down there is nothing to round: the coarse object's pieces
 * are the SAME BITS in a shifted frame, and the gap is exactly what it was.
 */
import { useEngines, mkEngine, drawStroke, painted } from "./__testkit__/harness";
import { inks } from "./__testkit__/ink";
import { snapDisplacement } from "./geometry/offsets";

jest.setTimeout(300000);
useEngines();

const geomOf = (o) => JSON.stringify((o.loops || []).map((loop) => loop.map((p) => (p.line
    ? [0, p.A[0], p.A[1], p.B[0], p.B[1]]
    : [1, p.A[0], p.A[1], p.B[0], p.B[1], p.C[0], p.C[1], p.r, p.a0, p.sweep]))));
const edgeOf = (E, sx, id, y0, y1) => {
    const list = painted(E);
    const ink = (y) => !!inks(list, E.cam.screenToFrame(sx, y), id);
    const a = ink(y0), b = ink(y1);
    if (a === b) return null;
    let lo = y0, hi = y1;
    for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (ink(m) === a) lo = m; else hi = m; }
    return (lo + hi) / 2;
};
const scanEdge = (E, sx, id) => {
    const list = painted(E);
    const ink = (y) => !!inks(list, E.cam.screenToFrame(sx, y), id);
    let prev = ink(-2000);
    for (let y = -1996; y <= E.height + 2000; y += 4) {
        const cur = ink(y);
        if (cur !== prev) return edgeOf(E, sx, id, y - 4, y);
        prev = cur;
    }
    return null;
};
// Descend one crossing at a time, re-aiming on `id`'s upper edge under (col, y).
const descendOnEdge = (E, col, id, n, y0) => {
    let y = y0;
    for (let d = E.activeLevel; d < n; d++) {
        const e = edgeOf(E, col, id, y - 20, y + 5) ?? scanEdge(E, col, id);
        expect(e).not.toBeNull();
        y = e;
        let guard = 0;
        while (E.activeLevel === d && guard++ < 40) E.zoomAt(col, y, -1000);
        expect(E.activeLevel).toBe(d + 1);
    }
    return y;
};
const ascendTo = (E, col, n, y) => {
    let guard = 0;
    while (E.activeLevel > n && guard++ < 600) E.zoomAt(col, y, 1000);
    expect(E.activeLevel).toBe(n);
};
// The coarse object's pieces in the active frame's tiles over the view, as bits.
const piecesOf = (E, id) => {
    const out = [];
    for (const p of E.store.content(E.cam.frame, E.cam.frameWindow(0))) {
        if (p.id !== id) continue;
        out.push(p.type === "shape" ? geomOf(p) : JSON.stringify(p.polys));
    }
    return out.sort().join("#");
};

describe("MR — a small stroke drawn against a coarse edge four levels below the move, both moved together", () => {
    test.each([[0], [1]])("move made at level %s: the gap is unchanged and the coarse pieces are the same bits", (moveLevel) => {
        const E = mkEngine(800, 600);
        const deep = moveLevel + 4;
        // The coarse stroke sits far from the frame origin (x ~ 60,000): a
        // coordinate's ulp there is 7e-12, the worst an object can have in its cell.
        E.cam.set({ frame: "0", activeLevel: 0, inScale: 1, inPanX: -60000, inPanY: 0 });
        E.renderer.clear(); E._render();
        drawStroke(E, [[100, 300], [700, 300]], 20);
        const big = E.doc.at("0").slice(-1)[0];
        const e0 = descendOnEdge(E, 400, big.id, deep, 290);
        const s = E.cam.inScale;
        drawStroke(E, [[380, e0 - 30], [420, e0 - 30]], 4);
        const star = E.doc.at(E.cam.frame).slice(-1)[0];
        const starBits = geomOf(star), starHome = star._home;
        const sb0 = edgeOf(E, 400, star.id, e0 - 30, e0 - 10);
        const be0 = edgeOf(E, 400, big.id, e0 - 5, e0 + 5);
        const gap0 = (be0 - sb0) / s;
        const bits0 = piecesOf(E, big.id);
        expect(bits0.length).toBeGreaterThan(0);

        ascendTo(E, 400, moveLevel, e0);
        E.setTool("select");
        E._setSelection([big.id, star.id]);
        const sMove = E.cam.inScale;
        const hitY = e0 + 2;
        expect(E._hitTest(400, hitY)).toBe(big.id);
        E.pointerDown(400, hitY);
        for (let i = 1; i <= 12; i++) E.pointerMove(400 + 37.3 * i / 12, hitY + 13.7 * i / 12);
        E.pointerUp();

        // The small stroke moved by address digits alone: its bits are untouched.
        const starNow = E.doc.getById(star.id);
        expect(starNow.level).not.toBe(starHome);
        expect(geomOf(starNow.obj)).toBe(starBits);
        expect(starNow.obj.below).toBeUndefined();
        // The coarse stroke's bits are untouched too; its table holds the move.
        expect(geomOf(E.doc.getById(big.id).obj)).toBe(geomOf(big));
        expect(E.doc.getById(big.id).obj.below[moveLevel]).toBeTruthy();

        // Back down on the coarse edge, at the column the small stroke moved to —
        // the SNAPPED displacement, which is where the picture actually is.
        const dxPx = snapDisplacement(37.3 / sMove) * sMove, dyPx = snapDisplacement(13.7 / sMove) * sMove;
        const y2 = descendOnEdge(E, 400 + dxPx, big.id, deep, e0 + dyPx);
        const s2 = E.cam.inScale;
        const sb = E.doc._bboxNow(starNow.obj);
        const p = E.cam.levelPointToScreen(starNow.level, (sb.x0 + sb.x1) / 2, sb.y1);
        const be1 = edgeOf(E, p[0], big.id, y2 - 5, y2 + 5) ?? scanEdge(E, p[0], big.id);
        expect(be1).not.toBeNull();
        const gap1 = (be1 - p[1]) / s2;
        // Bit-identical placement, measured through a 48-step bisection whose
        // own resolution is ~3e-13 of a pixel.
        expect(Math.abs(gap1 - gap0)).toBeLessThan(1e-9);
        // ...and literally the same bits: the coarse object's pieces in the
        // deep frame after the move are the pieces before it, in a new frame.
        expect(piecesOf(E, big.id)).toBe(bits0);
    });
});
