/**
 * MB — moving an object from BELOW its home (F41; geometry/offsets.js).
 *
 * THE FAILURE, measured 2026-09-04 on Kobin's phone (report 14-45-44): a
 * level-1 object dragged from level 4 and 5 moved in 127 px jumps at 254x, or
 * not at all. The drag divided the displacement by R^k and added it to the
 * home coordinates, and three crossings down one screen pixel is a hundredth
 * of a float64 step of a coordinate 60,000 units from its origin — the journal
 * shows moves of 1e-12 and 1e-33 units being written, and the geometry
 * rounding them to nothing or to a whole step.
 *
 * THE DESIGN (Kobin's, 2026-09-04): "the move is only handled locally." The
 * displacement stays in the camera's own units, in the object's table of
 * offsets at that depth below its home; the hop into that level adds it, once,
 * at that level's precision; coarser levels see it as a translation of the
 * picture; whole frames carry up as integers, and the home coordinates change
 * only by whole cells. The tiles at every level are generated bit-identically
 * from the previous level's stored bits, exactly as before.
 *
 * So the assertions are exact where the design is exact: the pointer and the
 * ink agree to a millionth of a pixel at any depth; the home coordinates do not
 * change by a bit; a slow drag lands where a fast one does; there and back is
 * bit-identical; undo restores everything; a carry is an integer.
 */
import {
    useEngines, mkEngine, drawStroke, eraseGesture, painted, camShot, camRestore,
} from "./__testkit__/harness";
import { inks } from "./__testkit__/ink";
import { W, G } from "./frameLattice";
import { SNAP, snapDisplacement } from "./geometry/offsets";

// Since F55 (2026-09-05) a displacement is SNAPPED to 2^-10 of the camera
// level's unit before it enters the table — a quarter pixel at that level's
// deepest zoom — so "exactly where the pointer left it" means within half a
// snap step on screen, which at the zooms here is a few hundred-thousandths of
// a pixel.
const tolPx = (E) => (SNAP / 2) * E.cam.inScale + 1e-6;

jest.setTimeout(300000);
useEngines();

const geomOf = (o) => JSON.stringify((o.loops || []).map((loop) => loop.map((p) => (p.line
    ? [0, p.A[0], p.A[1], p.B[0], p.B[1]]
    : [1, p.A[0], p.A[1], p.B[0], p.B[1], p.C[0], p.C[1], p.r, p.a0, p.sweep]))));
const belowOf = (o) => JSON.stringify(o.below ? o.below.map((e, k) => (e ? [k, e[0], e[1]] : null)).filter(Boolean) : []);

/** The ink's upper boundary on screen column `sx` (paper at y0, ink at y1), to 1e-4 px. */
const edgeAt = (E, sx, y0, y1) => {
    const list = painted(E);
    const ink = (y) => inks(list, E.cam.screenToFrame(sx, y));
    expect([ink(y0), ink(y1)]).toEqual([false, true]);
    let lo = y0, hi = y1;
    for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (ink(m)) hi = m; else lo = m; }
    return (lo + hi) / 2;
};
/** The ink's LEFT boundary on screen row `sy` (paper at x0, ink at x1). */
const edgeAtX = (E, sy, x0, x1) => {
    const list = painted(E);
    const ink = (x) => inks(list, E.cam.screenToFrame(x, sy));
    expect([ink(x0), ink(x1)]).toEqual([false, true]);
    let lo = x0, hi = x1;
    for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (ink(m)) hi = m; else lo = m; }
    return (lo + hi) / 2;
};
/** Descend `n` crossings keeping the edge under (400, ~288), re-aimed each time. */
const descendOnEdge = (E, n) => {
    for (let d = E.activeLevel; d < n; d++) {
        const y = edgeAt(E, 400, 250, 300);
        let guard = 0;
        while (E.activeLevel === d && guard++ < 40) E.zoomAt(400, y, -1000);
        expect(E.activeLevel).toBe(d + 1);
    }
    return edgeAt(E, 400, 250, 300);
};
/** Select the ink under (sx, sy) and drag it by (dx, dy) in `steps` events. */
const dragOn = (E, sx, sy, dx, dy, steps = 6) => {
    E.setTool("select");
    E.pointerDown(sx, sy); E.pointerUp();       // tap-select first: a drag with nothing selected is a lasso
    expect(E.selection).toBeTruthy();
    E.pointerDown(sx, sy);
    for (let i = 1; i <= steps; i++) E.pointerMove(sx + (dx * i) / steps, sy + (dy * i) / steps);
    E.pointerUp();
};
const only = (E) => { const a = E.doc.at("0"); expect(a).toHaveLength(1); return a[0]; };
const inkAt = (E, sx, sy) => inks(painted(E), E.cam.screenToFrame(sx, sy));

describe("MB-1 — the ink follows the pointer exactly, from any depth", () => {
    test.each([[1], [2], [3], [5], [8]])("%i crossing(s) below the home", (n) => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, n);
        const home = geomOf(o);
        const dx = 37, dy = 23;
        dragOn(E, 400, y + 12, dx, dy);
        // THE HEADLINE. Before this fix a drag at n = 3 moved the ink in 127 px
        // jumps at 254x; at n = 5 and beyond it did not move at all.
        const y2 = edgeAt(E, 400 + dx, y + dy - 30, y + dy + 30);
        expect(Math.abs(y2 - (y + dy))).toBeLessThan(tolPx(E));
        // The home coordinates did not change by a bit. The displacement lives
        // in the offset table, at the camera's depth below the home, as the
        // pointer moved in frame units, snapped to the level's grid (F55).
        const cur = only(E);
        expect(geomOf(cur)).toBe(home);
        const tx = snapDisplacement(dx / E.cam.inScale), ty = snapDisplacement(dy / E.cam.inScale);
        expect(cur.below[n]).toEqual([tx, ty]);
        for (let k = 1; k < n; k++) expect(cur.below[k]).toBeUndefined();
    });
});

describe("MB-2 — the design's exactness properties", () => {
    test("a slow drag lands exactly where a fast one does (M-4, from below)", () => {
        const run = (steps) => {
            const E = mkEngine();
            drawStroke(E, [[250, 280], [550, 320]], 24);
            const y = descendOnEdge(E, 4);
            dragOn(E, 400, y + 12, 31, -17, steps);
            const o = only(E);
            return { below: belowOf(o), geom: geomOf(o), edge: edgeAt(E, 431, y - 47, y - 5) };
        };
        const fast = run(1), slow = run(40);
        expect(slow.below).toBe(fast.below);
        expect(slow.geom).toBe(fast.geom);
        expect(slow.edge).toBe(fast.edge);
    });

    test("there and back leaves nothing behind: no offsets, geometry bit-identical", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, 4);
        const home = geomOf(o);
        E.setTool("select");
        E.pointerDown(400, y + 12); E.pointerUp();
        E.pointerDown(400, y + 12);
        E.pointerMove(440, y + 42); E.pointerMove(470, y - 10); E.pointerMove(400, y + 12);
        E.pointerUp();
        const cur = only(E);
        expect(cur.below).toBeUndefined();
        expect(geomOf(cur)).toBe(home);
        expect(Math.abs(edgeAt(E, 400, y - 30, y + 30) - y)).toBeLessThan(1e-9);
    });

    test("undo puts the offsets and the picture back; redo re-applies them", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, 3);
        const home = geomOf(o);
        dragOn(E, 400, y + 12, 0, 40);
        expect(only(E).below[3]).toBeTruthy();
        const moved = belowOf(only(E));
        expect(E.undo()).toBe(true);
        expect(only(E).below).toBeUndefined();
        expect(geomOf(only(E))).toBe(home);
        expect(Math.abs(edgeAt(E, 400, y - 30, y + 30) - y)).toBeLessThan(1e-9);
        expect(E.redo()).toBe(true);
        expect(belowOf(only(E))).toBe(moved);
        expect(Math.abs(edgeAt(E, 400, y + 10, y + 70) - (y + 40))).toBeLessThan(tolPx(E));
    });

    test("a move past half a frame carries a whole frame up, as an integer", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, 3);
        const home = geomOf(o);
        // More than W/2 units at this level: the offset here wraps into
        // [-W/2, W/2) and one frame — G units — moves up to level 2.
        const dy = Math.ceil(0.6 * W * E.cam.inScale);
        dragOn(E, 400, y + 12, 0, dy, 8);
        const cur = only(E);
        const ty = snapDisplacement(dy / E.cam.inScale);
        expect(cur.below[3]).toEqual([0, ty - W]);
        expect(cur.below[2]).toEqual([0, G]);
        expect(cur.below[1]).toBeUndefined();
        expect(geomOf(cur)).toBe(home);
        // ...and the ink is exactly where the pointer left it.
        E.panBy(0, -dy);
        expect(Math.abs(edgeAt(E, 400, y - 30, y + 30) - y)).toBeLessThan(tolPx(E));
    });

    test("carrying all the way out of level 1 lands in the home level's own entry, never in a coordinate (F55)", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, 1);
        const home = geomOf(o);
        const dy = Math.ceil(0.6 * W * E.cam.inScale);
        dragOn(E, 400, y + 12, 0, dy, 8);
        const cur = only(E);
        const ty = snapDisplacement(dy / E.cam.inScale);
        expect(cur.below[1]).toEqual([0, ty - W]);
        // One frame of level 1 is G home units: an exact integer, kept in the
        // table's home-level entry. Not one stored bit changed — adding even a
        // whole cell to a float loses its low bits when the sum crosses a
        // power of two, and four levels down that bit is a screen.
        expect(cur.below[0]).toEqual([0, G]);
        expect(geomOf(cur)).toBe(home);
        E.panBy(0, -dy);
        expect(Math.abs(edgeAt(E, 400, y - 30, y + 30) - y)).toBeLessThan(tolPx(E));
    });
});

describe("MB-3 — what the coarser levels see", () => {
    test("one level up, the picture is translated by the offset over R, and nothing jumps", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        descendOnEdge(E, 2);
        const y2 = edgeAt(E, 400, 250, 300);
        const shot2 = camShot(E);
        const y3 = descendOnEdge(E, 3);
        const dy = 29;
        dragOn(E, 400, y3 + 12, 0, dy);
        const ty = snapDisplacement(dy / E.cam.inScale);   // level-3 units, on the grid
        camRestore(E, shot2);
        expect(E.activeLevel).toBe(2);
        // In level-2 units the move is ty / R; on screen at level 2 that many
        // times the level-2 scale — and it must be there, not rounded away in
        // coordinates 4,096 times too coarse to hold it.
        const want = (ty / 4096) * E.cam.inScale;
        expect(want).toBeGreaterThan(1e-4);
        const y2b = edgeAt(E, 400, y2 - 30, y2 + 30 + want);
        expect(Math.abs(y2b - (y2 + want))).toBeLessThan(1e-6);
    });

    test("the home level itself is left alone: no coordinate moved, and the picture is where it was", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 280], [550, 320]], 24);
        const y0 = edgeAt(E, 400, 250, 300);
        const home = geomOf(o);
        const y3 = descendOnEdge(E, 3);
        dragOn(E, 400, y3 + 12, 0, 40);
        E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 0, inPanY: 0 });
        E._render();
        expect(geomOf(only(E))).toBe(home);
        // The translation at level 0 is 40 / inScale_3 / R^3 units: far below
        // a pixel here, and applied as a residual rather than to the geometry.
        expect(Math.abs(edgeAt(E, 400, 250, 300) - y0)).toBeLessThan(1e-6);
    });
});

describe("MB-4 — the rest of the engine sees the moved picture", () => {
    test("hit-testing finds the ink where it is drawn", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, 3);
        dragOn(E, 400, y + 12, 0, 60);
        expect(E.hitTestAt(400, y + 72)).not.toBeNull();
        expect(E.hitTestAt(400, y + 48)).toBeNull();
    });

    test("an erase at the drag's level lands on the moved ink", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, 3);
        dragOn(E, 400, y + 12, 0, 60);
        const y2 = y + 60;
        E.setEraserSize(20);
        eraseGesture(E, [[400, y2 - 40], [400, y2 + 40]]);
        E.flushErases();
        expect(inkAt(E, 400, y2 + 12)).toBe(false);
        expect(inkAt(E, 300, y2 + 12)).toBe(true);
    });

    test("an erase one level ABOVE the drag's level lands on the moved ink (the residual)", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        descendOnEdge(E, 2);
        const shot2 = camShot(E);
        const y3 = descendOnEdge(E, 3);
        // A big move: at level 2 the picture shifts by ty / R, which at this
        // zoom is many pixels — the whole point of applying the residual.
        const dy = Math.ceil(0.3 * W * E.cam.inScale);
        dragOn(E, 400, y3 + 12, 0, dy, 8);
        camRestore(E, shot2);
        const y2 = edgeAt(E, 400, 100, 550);
        E.setEraserSize(20);
        eraseGesture(E, [[400, y2 - 40], [400, y2 + 40]]);
        E.flushErases();
        expect(inkAt(E, 400, y2 + 12)).toBe(false);
        expect(inkAt(E, 300, y2 + 12)).toBe(true);
    });

    test("a ceded family dragged from below moves as one, hole included", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40);
        let guard = 0;
        while (E.activeLevel < 2 && guard++ < 400) E.zoomAt(400, 300, -1000);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 260], [400, 340]]);
        E.flushErases();
        // The hole's right edge is near x = 410 here. Find it to 1e-4 px and go
        // one more level down ABOUT it, so it still crosses the screen at level
        // 3 (a crossing magnifies an aim error 4,096 times).
        const xh = edgeAtX(E, 300, 400, 440);
        guard = 0;
        while (E.activeLevel < 3 && guard++ < 400) E.zoomAt(xh, 300, -1000);
        const x0 = edgeAtX(E, 300, xh - 30, xh + 30);
        let members = 0;
        for (const L of E.doc.levels()) members += E.doc.at(L).filter((q) => !q.erase).length;
        expect(members).toBeGreaterThan(2);           // parent, and a kid per crossing
        dragOn(E, x0 + 20, 300, 37, 0);
        const x1 = edgeAtX(E, 300, x0 + 17, x0 + 77);
        expect(Math.abs(x1 - (x0 + 37))).toBeLessThan(tolPx(E));
        // Every member took the same displacement, in its own table — the
        // members homed at the camera's own level in their home-level entry.
        const tx = snapDisplacement(37 / E.cam.inScale);
        for (const L of E.doc.levels()) {
            for (const q of E.doc.at(L)) {
                if (q.erase) continue;
                const k = 3 - E.lm.depthOf(L);
                expect([L, q.below && q.below[k]]).toEqual([L, [tx, 0]]);
            }
        }
    });

    test("the offsets survive a save and a load", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        const y = descendOnEdge(E, 3);
        dragOn(E, 400, y + 12, 11, 60);
        const before = belowOf(only(E));
        const file = JSON.parse(JSON.stringify(E.serializeDrawing()));
        const F = mkEngine();
        expect(F.loadDrawing(file)).toBeTruthy();
        expect(belowOf(F.doc.at("0")[0])).toBe(before);
        expect(Math.abs(edgeAt(F, 411, y + 30, y + 90) - (y + 60))).toBeLessThan(tolPx(F));
    });
});
