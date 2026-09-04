/**
 * L — Selection and multi-select (docs/erase-tile-window-test-catalog.md).
 *
 * Kobin's spec, 2026-08-03: a selection lasso. Everything fully bounded within
 * the lasso gets selected. Clicking something else drops the lasso selection and
 * selects that object instead. Ctrl adds to / removes from the lasso — ctrl with
 * a lasso overlapping the current selection adds everything in it, ctrl with a
 * lasso drawn purely inside the current selection removes those objects. Colour,
 * size and opacity editing of a selection are removed along with the style box.
 *
 * The drag rule, settled by Kobin on the phone on 2026-09-03: with NOTHING
 * selected a drag is always a lasso, ink under the finger or not; with a
 * selection, a drag from a selected member moves it, from another object
 * selects and moves that one, and from paper lassoes. And nothing changes on
 * the way down — a press becomes a tap on the way up or a drag once it has
 * moved, so the first finger of a pinch cannot select or deselect anything.
 */
import KobinEngine from "./KobinEngine";
import { rectInsidePolygon, pointInPolygon } from "./geometry/lasso";
import { bboxOf } from "./geometry/derive";

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
// Draw a rectangular loop with the select tool.
const lasso = (E, ax, ay, bx, by, ctrl = false) => {
    E.setTool("select");
    E.pointerDown(ax, ay, ctrl);
    let cx = ax, cy = ay;
    for (const [x, y] of [[bx, ay], [bx, by], [ax, by], [ax, ay]]) {
        for (let t = 1; t <= 8; t++) E.pointerMove(cx + ((x - cx) * t) / 8, cy + ((y - cy) * t) / 8);
        cx = x; cy = y;
    }
    E.pointerUp();
    return E.selection ? [...E.selection.ids] : [];
};
const click = (E, sx, sy, ctrl = false) => {
    E.setTool("select");
    E.pointerDown(sx, sy, ctrl);
    E.pointerUp();
    return E.selection ? [...E.selection.ids] : [];
};

describe("the lasso judges by ink where the box fails (F32, 2026-09-03)", () => {
    test("a slanted stroke whose box corners poke out of the loop is selected when its ink is inside", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[100, 100], [300, 300]], 13);   // a diagonal: a 200x200 box around a thin band
        E.setTool("select");
        // A band hugging the diagonal, 35 px to either side: every point of
        // the ink is inside, the box's corners (300,100) and (100,300) are not.
        E.pointerDown(95, 45);
        for (const p of [[355, 305], [305, 355], [45, 95], [95, 45]]) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        expect(E.selection && E.selection.ids).toEqual([o.id]);
        // ...and a loop the ink itself crosses still leaves it out.
        E.deselect();
        E.pointerDown(95, 45);
        for (const p of [[225, 175], [175, 225], [45, 95], [95, 45]]) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        expect(E.selection).toBeNull();
    });
});

describe("a press decides on the way up (2026-09-03)", () => {
    test("with nothing selected, a drag that starts on ink draws a lasso instead of moving", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [150, 150]]);   // under the finger
        const b = drawStroke(E, [[200, 220], [250, 260]]);   // inside the loop
        const before = { ...bboxOf(a, E.store.live) };
        E.setTool("select");
        E.pointerDown(120, 120);
        for (const p of [[300, 120], [300, 300], [180, 300], [180, 180], [120, 120]]) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        expect({ ...bboxOf(a, E.store.live) }).toEqual(before);   // nothing moved
        // The loop's own boundary runs through the ink it started on, so
        // that object is not bounded; the one the loop went round is.
        expect(E.selection && E.selection.ids).toEqual([b.id]);
    });
    test("a tap selects; a second finger cancels a press or a young drag and keeps the selection", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [150, 150]]);
        drawStroke(E, [[400, 400], [450, 450]]);
        E.setTool("select");
        E.pointerDown(125, 125); E.pointerUp();
        expect(E.selection.ids).toEqual([a.id]);
        // A pinch that begins over paper: the press would have deselected.
        E.pointerDown(600, 100); E.cancelSelectGesture(false);
        expect(E.selection.ids).toEqual([a.id]);
        // A pinch that begins over the other object: the press would have selected it.
        E.pointerDown(425, 425); E.cancelSelectGesture(false);
        expect(E.selection.ids).toEqual([a.id]);
        // A drag that had moved, cancelled inside the grace: put back exactly.
        const before = { ...bboxOf(a, E.store.live) };
        E.pointerDown(125, 125); E.pointerMove(165, 125); E.pointerMove(205, 125);
        E.cancelSelectGesture(false);
        expect({ ...bboxOf(a, E.store.live) }).toEqual(before);
        expect(E.selection.ids).toEqual([a.id]);
        // ...and past the grace it is committed as a normal pen-up would.
        E.pointerDown(125, 125); E.pointerMove(165, 125); E.pointerMove(205, 125);
        E.cancelSelectGesture(true);
        expect(bboxOf(a, E.store.live).x0).toBeGreaterThan(before.x0 + 70);
    });
});

describe("geometry — fully bounded, not merely touched", () => {
    const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
    test("a rect wholly inside is bounded; one poking out is not", () => {
        expect(rectInsidePolygon(square, { left: 10, top: 10, right: 90, bottom: 90 })).toBe(true);
        expect(rectInsidePolygon(square, { left: 10, top: 10, right: 110, bottom: 90 })).toBe(false);
        expect(rectInsidePolygon(square, { left: -50, top: -50, right: 150, bottom: 150 })).toBe(false);
    });
    test("a CONCAVE loop whose boundary dips through the rect does not bound it", () => {
        // A "C": all four corners of the test rect sit inside the outer hull,
        // but the notch cuts right through it. A corners-only test says yes.
        const c = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 60], [100, 60], [100, 100], [0, 100]];
        expect(rectInsidePolygon(c, { left: 10, top: 10, right: 90, bottom: 90 })).toBe(false);
        expect(rectInsidePolygon(c, { left: 5, top: 65, right: 35, bottom: 95 })).toBe(true);
    });
    test("pointInPolygon", () => {
        expect(pointInPolygon(square, [50, 50])).toBe(true);
        expect(pointInPolygon(square, [150, 50])).toBe(false);
    });
});

describe("L-1/L-2 — click selects one; a lasso selects everything it bounds", () => {
    test("click", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [160, 140]]);
        drawStroke(E, [[300, 100], [360, 140]]);
        expect(click(E, 130, 120)).toEqual([a.id]);
    });
    test("lasso", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [160, 140]]);
        const b = drawStroke(E, [[180, 120], [240, 160]]);
        const far = drawStroke(E, [[600, 400], [660, 440]]);
        const got = lasso(E, 60, 60, 300, 220);
        expect(got.slice().sort()).toEqual([a.id, b.id].sort());
        expect(got).not.toContain(far.id);
    });
});

describe("L-3/L-4 — size does not decide membership; boundedness does", () => {
    test("an object far too small to see is still selected", () => {
        const E = mkEngine();
        // Drawn three crossings down, so at level 0 it paints nothing at all.
        let guard = 0;
        while (E.activeLevel < 3 && guard++ < 400) E.zoomAt(400, 300, -1000);
        const tiny = drawStroke(E, [[390, 290], [410, 310]], 8);
        guard = 0;
        while (E.activeLevel > 0 && guard++ < 400) E.zoomAt(400, 300, 1000);
        E._render();
        expect(E._objs().some((o) => o.id === tiny.id)).toBe(false);
        // ...and the lasso finds it anyway.
        expect(lasso(E, 200, 150, 600, 450)).toContain(tiny.id);
    });

    test("an object larger than the lasso is NOT selected", () => {
        const E = mkEngine();
        const big = drawStroke(E, [[-4000, 300], [4000, 300]], 40);
        const small = drawStroke(E, [[380, 380], [420, 420]], 10);
        const got = lasso(E, 340, 340, 460, 460);
        expect(got).toContain(small.id);
        expect(got).not.toContain(big.id);
    });
});

describe("L-5 — clicking elsewhere drops the lasso selection", () => {
    test("and selects that object instead", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [160, 140]]);
        const b = drawStroke(E, [[180, 120], [240, 160]]);
        const c = drawStroke(E, [[500, 400], [560, 440]]);
        expect(lasso(E, 60, 60, 300, 220).slice().sort()).toEqual([a.id, b.id].sort());
        expect(click(E, 530, 420)).toEqual([c.id]);
    });
    test("a lasso over empty paper clears the selection", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [160, 140]]);
        expect(lasso(E, 60, 60, 300, 220)).toHaveLength(1);
        expect(lasso(E, 500, 400, 700, 560)).toHaveLength(0);
        expect(E.selection).toBeNull();
    });
});

describe("L-6/L-7/L-8 — ctrl", () => {
    test("ctrl+click toggles one object in and out", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [160, 140]]);
        const b = drawStroke(E, [[300, 100], [360, 140]]);
        expect(click(E, 130, 120)).toEqual([a.id]);
        expect(click(E, 330, 120, true).slice().sort()).toEqual([a.id, b.id].sort());
        expect(click(E, 330, 120, true)).toEqual([a.id]);
    });

    test("ctrl + a lasso overlapping the selection ADDS everything in it", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [160, 140]]);
        const b = drawStroke(E, [[300, 100], [360, 140]]);
        const c = drawStroke(E, [[500, 100], [560, 140]]);
        expect(lasso(E, 60, 60, 200, 200)).toEqual([a.id]);
        const got = lasso(E, 260, 60, 600, 200, true);
        expect(got.slice().sort()).toEqual([a.id, b.id, c.id].sort());
    });

    test("ctrl + a lasso drawn PURELY INSIDE the selection REMOVES those objects", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 100], [160, 140]]);
        const b = drawStroke(E, [[300, 100], [360, 140]]);
        const c = drawStroke(E, [[500, 100], [560, 140]]);
        expect(lasso(E, 60, 60, 620, 220).slice().sort()).toEqual([a.id, b.id, c.id].sort());
        // This loop catches nothing that is not already selected, so it
        // subtracts rather than adding.
        const got = lasso(E, 280, 80, 380, 180, true);
        expect(got.slice().sort()).toEqual([a.id, c.id].sort());
    });
});

describe("L-9 — dragging a mixed-level selection moves every member", () => {
    test("all of them, by the same physical displacement", () => {
        const E = mkEngine();
        const shallow = drawStroke(E, [[360, 280], [420, 320]], 10);
        let guard = 0;
        while (E.activeLevel < 1 && guard++ < 400) E.zoomAt(400, 300, -1000);
        const deep = drawStroke(E, [[360, 340], [420, 380]], 10);
        guard = 0;
        while (E.activeLevel > 0 && guard++ < 400) E.zoomAt(400, 300, 1000);
        E._render();
        // Zooming in and back out does not restore the original camera exactly
        // (the step counts differ), so place the loop from where the objects
        // ACTUALLY are on screen rather than from where they were drawn.
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const it of E._selectableRects()) {
            for (const [x, y] of [[it.rect.left, it.rect.top], [it.rect.right, it.rect.bottom]]) {
                const p = E.cam.levelPointToScreen(E.cam.frame, x, y);
                l = Math.min(l, p[0]); r = Math.max(r, p[0]);
                t = Math.min(t, p[1]); b = Math.max(b, p[1]);
            }
        }
        const got = lasso(E, l - 30, t - 30, r + 30, b + 30);
        expect(got.length).toBeGreaterThanOrEqual(2);
        // Both strokes have RESOLVED into perimeters by now (a lasso settles
        // them), so measure the object by its bounding box rather than by a
        // centerline it no longer has.
        E.flushBakes();
        const boxOf = (o) => bboxOf(o, null);
        const s0 = boxOf(shallow).x0, d0 = boxOf(deep).x0;
        const sb = boxOf(shallow);
        // Grab one member and drag: the whole selection travels.
        const grab = E.cam.levelPointToScreen("0", (sb.x0 + sb.x1) / 2, (sb.y0 + sb.y1) / 2);
        E.setTool("select");
        E.pointerDown(grab[0], grab[1]); E.pointerMove(grab[0] + 40, grab[1]); E.pointerUp();
        const ds = boxOf(shallow).x0 - s0;
        const dd = boxOf(deep).x0 - d0;
        expect(Math.abs(ds)).toBeGreaterThan(0);
        expect(Math.abs(dd)).toBeGreaterThan(0);
        // Same physical distance: the deep one's own units are 3000× finer.
        const f = E.lm.frameFactor("0", deep._home);
        expect(dd / f).toBeCloseTo(ds, 6);
    });
});

describe("L-10 — the colour/size/opacity box is gone", () => {
    test("no path on the engine can reach a restyle", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [160, 140]]);
        expect(E.restyleSelection).toBeUndefined();
        click(E, 130, 120);
        // The status carries identity and count, and no style at all — nothing
        // downstream can render a swatch or a slider from it.
        expect(E._selectionStatus()).toEqual({
            id: expect.any(Number), ids: expect.any(Array), count: 1, type: "shape", level: "0",
        });
    });
});

/**
 * L-T — the lasso walks the FRAME TREE (bible §6.4).
 *
 * Kobin, 2026-08-18: *"the frame tree should tell you which objects you need to
 * look at when selecting and zooming... since we're only worrying about objects
 * fully enclosed in the lasso, it can't be fully enclosed if it extends to a
 * neighbouring frame that is not included in the lasso."*
 *
 * Two things have to be true and they pull against each other. The answer must
 * be IDENTICAL to asking every object in the document — pruning that drops a
 * real hit is worse than no pruning at all. And it must actually prune, or the
 * tree is decoration.
 */
describe("L-T — selection is a tree query, and it is the same answer", () => {
    // A tower: one object at each depth, all under the same screen point, plus
    // a couple off to the side so there is something for the walk to skip.
    const tower = (E, n) => {
        const ids = [];
        for (let d = 0; d <= n; d++) {
            if (d) { let g = 0; while (E.activeLevel < d && g++ < 600) E.zoomAt(400, 300, -1000); }
            ids.push(drawStroke(E, [[360, 280], [400, 300], [440, 320]], 12).id);
            ids.push(drawStroke(E, [[120, 120], [160, 140]], 8).id);
        }
        let g = 0;
        while (E.activeLevel > 0 && g++ < 600) E.zoomAt(400, 300, 1000);
        E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 0, inPanY: 0 });
        E._render();
        return ids;
    };
    // What asking every object in the document would say.
    const bruteForce = (E, poly) => E._selectableRects()
        .filter((x) => rectInsidePolygon(poly, x.rect)).map((x) => x.o.id).sort((a, b) => a - b);
    const polyOf = (E, ax, ay, bx, by) => [[ax, ay], [bx, ay], [bx, by], [ax, by]]
        .map(([x, y]) => E.cam.screenToFrame(x, y));

    test("the same answer as asking every object, for every loop", () => {
        const E = mkEngine();
        tower(E, 5);
        for (const box of [[120, 120, 680, 480], [300, 240, 500, 360], [60, 60, 200, 200],
            [390, 290, 410, 310], [0, 0, 800, 600], [700, 500, 780, 580]]) {
            const poly = polyOf(E, ...box);
            expect([box, E._lassoFind(poly).sort((a, b) => a - b)])
                .toEqual([box, bruteForce(E, poly)]);
        }
    });

    test("...and it does not look at every object to get there", () => {
        // Count the per-object tests. A loop round the whole canvas encloses
        // whole frames, so their subtrees come in without a single one; a loop
        // off in the corner reaches nothing and prunes them all.
        const E = mkEngine();
        const ids = tower(E, 5);
        let tests = 0;
        const real = E._rectInActive.bind(E);
        E._rectInActive = (o, k) => { tests++; return real(o, k); };

        tests = 0;
        E._lassoFind(polyOf(E, 0, 0, 800, 600));
        const enclosing = tests;

        tests = 0;
        E._lassoFind(polyOf(E, 700, 500, 780, 580));
        const missing = tests;

        // eslint-disable-next-line no-console
        console.log(`L-T: ${ids.length} objects — enclosing loop tested ${enclosing}, missing loop tested ${missing}`);
        expect(enclosing).toBeLessThan(ids.length);
        expect(missing).toBeLessThan(ids.length);
    });

    test("pruning is by LOCATION, never by depth or size", () => {
        // The property SM-4 exists to protect: something far too small to see is
        // still selectable. A tree walk is where that would quietly break.
        const E = mkEngine();
        let g = 0;
        while (E.activeLevel < 5 && g++ < 600) E.zoomAt(400, 300, -1000);
        const fine = drawStroke(E, [[360, 280], [440, 320]], 12);
        E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 0, inPanY: 0 });
        E._render();
        expect(E._lassoFind(polyOf(E, 120, 120, 680, 480))).toContain(fine.id);
        expect(E._lassoFind(polyOf(E, 60, 60, 200, 200))).not.toContain(fine.id);
    });
});

describe("a re-homed family is one object (Kobin, 2026-09-03)", () => {
    // Two pieces sharing an editId stand in for a parent and the tile ceded
    // out of it: the object is the pair, and "fully bounded by the loop" is
    // asked of the pair.
    const family = (E) => {
        const parent = drawStroke(E, [[100, 300], [220, 300]]);
        const tile = drawStroke(E, [[400, 300], [430, 300]]);
        tile.editId = parent.id;
        E.doc.keysChanged();
        return { parent, tile };
    };
    test("a loop around the ceded tile alone selects nothing", () => {
        const E = mkEngine();
        const { tile } = family(E);
        E.setTool("select");
        lasso(E, 360, 260, 470, 340);
        expect(E.selection).toBeNull();
        // ...and the tile on its own is not selectable apart from its object.
        expect(E._lassoFind([[360, 260], [470, 260], [470, 340], [360, 340]])).toEqual([]);
        expect(tile.editId).toBeDefined();
    });
    test("a loop around the whole family selects it, both pieces", () => {
        const E = mkEngine();
        const { parent, tile } = family(E);
        E.setTool("select");
        lasso(E, 60, 260, 470, 340);
        expect(E.selection).not.toBeNull();
        expect([...E.selection.ids].sort((a, b) => a - b)).toEqual([parent.id, tile.id].sort((a, b) => a - b));
    });
    test("a loop around the parent piece alone selects nothing either", () => {
        const E = mkEngine();
        family(E);
        E.setTool("select");
        lasso(E, 60, 260, 260, 340);
        expect(E.selection).toBeNull();
    });
});
