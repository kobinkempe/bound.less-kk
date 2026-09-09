/**
 * M — Move (docs/erase-tile-window-test-catalog.md), the part that does not
 * depend on the per-level offset architecture.
 *
 * M-4 is the headline: a SLOW drag must move as far as a fast one. Applying and
 * rounding each pointer event separately made that false — four crossings from
 * an object, one 1-px step is below one ulp of its own coordinates and is
 * silently discarded, so forty consecutive 1-px steps moved it ZERO pixels while
 * a single 100-px flick moved it correctly.
 */
import KobinEngine from "./KobinEngine";
import { loopsBBox } from "./geometry/arcShape";

// A stroke RESOLVES into its perimeter shortly after pen-up, and selecting one
// settles it first, so anything a drag test looks at is a shape by the time it
// looks. Read the geometry through one accessor rather than reaching for `pts`.
const anchorOf = (o) => (o.type === "shape" ? o.loops[0].at(0).A : o.pts[0]);
const geomOf = (o) => (o.type === "shape"
    ? JSON.stringify(loopsBBox(o.loops))
    : JSON.stringify(o.pts));

jest.setTimeout(120000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } } });

const drawStroke = (E, pts, width = 13) => {
    E.setTool("pen"); E.setWidth(width);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1];
};
const descend = (E, n) => {
    let guard = 0;
    while (E.activeLevel < n && guard++ < 400) E.zoomAt(400, 300, -1000);
    expect(E.activeLevel).toBe(n);
};
// Drag the object under (sx,sy) by (dx,dy) in `steps` pointer events.
const drag = (E, sx, sy, dx, dy, steps) => {
    E.setTool("select");
    E.pointerDown(sx, sy); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
    E.pointerDown(sx, sy);
    for (let i = 1; i <= steps; i++) E.pointerMove(sx + (dx * i) / steps, sy + (dy * i) / steps);
    E.pointerUp();
};

describe("M-4 — a slow drag moves as far as a fast one", () => {
    // Whether a single 1-px step survives depends on how one ulp of the
    // object's OWN coordinates compares with the step, and that ratio moves
    // with the in-level zoom — so a single camera position proves nothing.
    // Sweep the in-level range at each depth; the failing regime is the ~100×
    // window where a 100-px flick clears an ulp and a 1-px step does not.
    const zooms = [1, 3, 10, 30, 100];
    for (const n of [2, 3, 4]) {
        for (const z of zooms) {
            test(`${n} crossing(s) down, ×${z} within the level`, () => {
                const run = (steps) => {
                    const E = mkEngine();
                    const o = drawStroke(E, [[350, 280], [450, 320]], 20);
                    descend(E, n);
                    if (z !== 1) {
                        const lvl = E.activeLevel;
                        E.zoomFactorAt(400, 300, z);
                        if (E.activeLevel !== lvl) return null; // crossed: skip
                    }
                    // Settle the perimeter BEFORE measuring: the first drag
                    // would otherwise resolve it and the anchor would move for a
                    // reason that has nothing to do with the drag.
                    E.flushBakes();
                    const a0 = anchorOf(o);
                    const before = [a0[0], a0[1]];
                    drag(E, 400, 300, 100, 0, steps);
                    const a1 = anchorOf(o);
                    return [a1[0] - before[0], a1[1] - before[1]];
                };
                const flick = run(1);
                const slow = run(100);
                if (!flick || !slow) return;
                // Whatever the flick achieves, the slow drag must achieve too.
                // (If the flick itself is below an ulp, both are zero and there
                // is nothing to compare — but then say so rather than pass mutely.)
                if (Math.abs(flick[0]) === 0) { expect(Math.abs(slow[0])).toBe(0); return; }
                const tol = Math.abs(flick[0]) * 1e-6;
                expect(Math.abs(slow[0] - flick[0])).toBeLessThanOrEqual(tol);
            });
        }
    }
});

describe("M-6 — move by +delta then -delta returns", () => {
    test("a there-and-back drag leaves the geometry where it started", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[350, 280], [450, 320]], 20);
        E.flushBakes();
        const before = geomOf(o);
        drag(E, 400, 300, 120, 80, 40);
        // Since F55 the geometry is never touched by a move at all: the
        // displacement is in the table, and there-and-back is bit-exact
        // because the table simply empties.
        expect(geomOf(o)).toBe(before);
        expect(o.below[0]).toEqual([120, 80]);
        drag(E, 520, 380, -120, -80, 40);
        expect(geomOf(o)).toBe(before);
        expect(o.below).toBeUndefined();
    });
});

describe("M-10/M-11 — an erase belongs to the object it cut", () => {
    test("move an erased object and the hole goes with it; an un-erased one is untouched", () => {
        const E = mkEngine();
        const erasedKey = drawStroke(E, [[250, 290], [450, 290]], 30).id;
        const clean = drawStroke(E, [[250, 420], [450, 420]], 30);
        descend(E, 1);
        E.setEraserSize(16);
        E.setTool("erasePartial");
        E.pointerDown(350, 290); E.pointerUp();
        E.flushErases();
        // A deep erase cedes a TILE: the source's ink there is cut away and
        // handed to a child of the erase level, which records the tile it fills.
        // The hole is not a rect stored beside the object any more, so what has
        // to travel with a move is the geometry on both sides of it AND the
        // doorway between them.
        // The kid lives at the erase's DEPTH, in the frame whose own cell holds
        // the ceded square (F56, 2026-09-06) — here that is the camera frame's
        // neighbour, because a descent aimed at (400, 300) lands on a cell edge
        // at level 1 and (350, 290) is fifty pixels the other side of it.
        const depthOf = (k) => k.split("/").length - 1;
        const atDepth = [...E.doc.levels()].filter((k) => depthOf(k) === depthOf(E.cam.frame)).flatMap((k) => E.doc.at(k));
        const kid = atDepth.find((o) => !o.erase && E.doc.editKey(o) === erasedKey);
        expect(kid).toBeTruthy();
        expect(kid.attachRect).toBeTruthy();
        const parent = (E.doc.at("0") || []).find((o) => E.doc.editKey(o) === erasedKey);
        expect(parent).toBeTruthy();
        const beforeAttach = { ...kid.attachRect };
        const beforeParent = geomOf(parent);

        // Moving the object moves all three, so the hole stays put relative to
        // the ink rather than staying put on the paper.
        E.setTool("select");
        E.pointerDown(300, 290); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(300, 290); E.pointerMove(300, 350); E.pointerUp();
        // The doorway travels the way everything travels since F55: the kid's
        // coordinates, its window included, are untouched, and its table at
        // depth 0 holds the displacement, the same numbers as the parent's
        // entry one level below its home. (Until F56 this asserted that the
        // window's numbers CHANGED, which they did only because the kid had
        // been homed in the wrong frame and the pen-up re-home moved it a
        // whole cell.)
        expect(kid.attachRect).toEqual(beforeAttach);
        expect(kid.below[0]).toEqual([0, 60 / E.cam.inScale]);
        // The parent is homed a level ABOVE the camera, so since F41
        // (2026-09-04) the drag does not touch its coordinates at all: the
        // move lives in its offset one level below the home, exactly as the
        // pointer moved in this frame's units. (Before F41 it was translated
        // by the displacement over R, which three crossings down is below a
        // float64 step and moved the object in jumps.)
        expect(geomOf(parent)).toBe(beforeParent);
        expect(parent.below[1]).toEqual([0, 60 / E.cam.inScale]);

        // The clean object ceded nothing, so it has no family and no doorway,
        // and nothing can follow it anywhere.
        expect(clean.attachRect).toBeUndefined();
        expect(E.doc.editGroup(clean.id)).toHaveLength(1);
        E.pointerDown(300, 420); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(300, 420); E.pointerMove(300, 290); E.pointerUp();
        expect(clean.attachRect).toBeUndefined();
        expect(E.doc.editGroup(clean.id)).toHaveLength(1);
    });
});
