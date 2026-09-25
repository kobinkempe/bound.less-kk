/**
 * A press on selected ink that another object covers (Kobin, 2026-09-23, decision 1):
 * a DRAG moves the selection; a TAP still takes the topmost object. Found by the
 * ERASE-TEST agent: the hit test took the covering object, so the drag selected and
 * moved that one instead.
 */
import KobinEngine from "./KobinEngine";

jest.setTimeout(60000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } } });

const drawStroke = (E, pts, width = 20) => {
    E.setTool("pen"); E.setWidth(width);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1].id;
};
const tap = (E, sx, sy, ctrl = false) => { E.pointerDown(sx, sy, ctrl); E.pointerUp(); };
const dragFrom = (E, sx, sy, dx, dy, steps = 10, ctrl = false) => {
    E.pointerDown(sx, sy, ctrl);
    for (let i = 1; i <= steps; i++) E.pointerMove(sx + (dx * i) / steps, sy + (dy * i) / steps);
    E.pointerUp();
};
const tableOf = (E, id) => { const r = E.doc.getById(id); return r && r.obj.below ? r.obj.below[0] : null; };

// A horizontal bar under a vertical one; they cross at (400, 300).
const scene = () => {
    const E = mkEngine();
    const under = drawStroke(E, [[250, 300], [550, 300]]);
    const over = drawStroke(E, [[400, 150], [400, 450]]);
    E.flushBakes();
    E.setTool("select");
    return { E, under, over };
};

describe("SC — a press on covered selected ink", () => {
    test("SC-1 a drag from the crossing moves the selected lower bar, not the bar over it", () => {
        const { E, under, over } = scene();
        tap(E, 300, 300);
        expect(E.selection.ids).toEqual([under]);
        expect(E.hitTestAt(400, 300)).toBe(over);            // the covering bar is the topmost hit
        dragFrom(E, 400, 300, 60, 40);
        expect(E.selection.ids).toEqual([under]);
        expect(tableOf(E, under)).toEqual([60, 40]);
        expect(tableOf(E, over)).toBeNull();
    });
    test("SC-2 a tap on the crossing still selects the topmost bar", () => {
        const { E, under, over } = scene();
        tap(E, 300, 300);
        tap(E, 400, 300);
        expect(E.selection.ids).toEqual([over]);
        expect(tableOf(E, under)).toBeNull();
    });
    test("SC-3 a drag from the covering bar where nothing selected is under it selects and moves that bar", () => {
        const { E, under, over } = scene();
        tap(E, 300, 300);
        dragFrom(E, 400, 200, 30, 0);
        expect(E.selection.ids).toEqual([over]);
        expect(tableOf(E, over)).toEqual([30, 0]);
        expect(tableOf(E, under)).toBeNull();
    });
    test("SC-4 with the top bar selected, a drag from the crossing moves the top bar", () => {
        const { E, under, over } = scene();
        tap(E, 400, 200);
        expect(E.selection.ids).toEqual([over]);
        dragFrom(E, 400, 300, -20, 50);
        expect(E.selection.ids).toEqual([over]);
        expect(tableOf(E, over)).toEqual([-20, 50]);
        expect(tableOf(E, under)).toBeNull();
    });
    test("SC-5 a ctrl drag from the crossing is still a lasso and moves nothing", () => {
        const { E, under, over } = scene();
        tap(E, 300, 300);
        dragFrom(E, 400, 300, 60, 40, 10, true);
        expect(tableOf(E, under)).toBeNull();
        expect(tableOf(E, over)).toBeNull();
    });
    test("SC-6 with nothing selected, a drag from the crossing is a lasso and moves nothing", () => {
        const { E, under, over } = scene();
        dragFrom(E, 400, 300, 60, 40);
        expect(tableOf(E, under)).toBeNull();
        expect(tableOf(E, over)).toBeNull();
    });
});
