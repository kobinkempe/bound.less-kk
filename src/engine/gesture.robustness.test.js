/**
 * Gesture robustness — the seven defects the 2026-09-05 browser hunt found by
 * driving the real pointer path (docs/OPEN-FLAGS.md F48–F54). Each test is the
 * jsdom form of the Chrome measurement that found it; the measurement itself
 * is in the flag's section. None of these is geometry: they are what happens
 * to the document, the undo stack and the render list around a gesture.
 */
import { W as FRAME_W } from "./frameLattice";
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";

useEngines();

const count = (E) => E.doc.levels().reduce((a, k) => a + E.doc.at(k).length, 0);
const ser = (E) => JSON.stringify(E.doc.serializeNatives());

// A drag through the public pointer API: down, a few moves past SELECT_DRAG_PX, up.
function drag(E, from, to, steps = 8) {
    E.pointerDown(from[0], from[1]);
    for (let i = 1; i <= steps; i++) E.pointerMove(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps);
    E.pointerUp();
}
const tap = (E, p) => { E.pointerDown(p[0], p[1]); E.pointerUp(); };

describe("F48 — a press while a stroke is still open finishes that stroke first", () => {
    test("two pointerdowns without a pointerup leave two finished, undoable strokes and nothing pending", () => {
        const E = mkEngine(800, 600);
        E.setTool("pen"); E.setWidth(8);
        E.pointerDown(100, 100); for (let i = 1; i <= 10; i++) E.pointerMove(100 + 5 * i, 100 + 2 * i);
        const first = E._drawing.id;
        E.pointerDown(300, 300); for (let i = 1; i <= 10; i++) E.pointerMove(300 + 5 * i, 300 + 2 * i);
        E.pointerUp();
        E.flushBakes();
        expect(count(E)).toBe(2);
        expect(E.doc._pending.size).toBe(0);
        expect(E.doc.getById(first).obj.type).toBe("shape");
        expect(E.doc._index["0"].boxes.has(first)).toBe(true);
        expect(E.undo()).toBe(true);
        expect(E.undo()).toBe(true);
        expect(count(E)).toBe(0);
    });
    test("a select press left behind by a tool change does not turn the next pen-up into a tap-select", () => {
        const E = mkEngine(800, 600);
        drawStroke(E, [[100, 100], [200, 110]], 8);
        E.setTool("select");
        E.pointerDown(150, 105);          // a press on the ink, never released
        E.setTool("pen");
        E.pointerDown(300, 300); E.pointerMove(340, 310); E.pointerUp();
        E.flushBakes();
        expect(E.selection).toBeNull();
        expect(count(E)).toBe(2);
    });
});

describe("F49 — Delete on a multi-selection is one undo step", () => {
    test("three lassoed strokes, Delete, one undo op, one Ctrl+Z restores all three", () => {
        const E = mkEngine(800, 600);
        drawStroke(E, [[200, 200], [240, 210]], 6);
        drawStroke(E, [[300, 200], [340, 210]], 6);
        drawStroke(E, [[200, 300], [240, 310]], 6);
        E.setTool("select");
        drag(E, [150, 150], [150, 150.1], 1);   // a no-op press, cleared by the lasso below
        E.pointerDown(150, 150);
        for (const p of [[400, 150], [400, 350], [150, 350], [150, 150]]) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        expect(E.selection && E.selection.ids.length).toBe(3);
        const ops = E.doc._undo.length;
        expect(E.deleteSelection()).toBe(true);
        expect(count(E)).toBe(0);
        expect(E.doc._undo.length).toBe(ops + 1);
        expect(E.doc._undo[E.doc._undo.length - 1].op).toBe("eraseMany");
        expect(E.undo()).toBe(true);
        expect(count(E)).toBe(3);
    });
});

describe("F50 / F52 — a drag whose pen-up re-homes the object", () => {
    // A stroke drawn ACROSS the root cell's right edge at the shallowest zoom,
    // its centre just past W/2. Its first drag's pen-up runs `_normalizeHome`,
    // which moves it to the neighbour cell (growing a parent above the root,
    // since the root has no siblings until it needs one) and shifts its
    // coordinates by exactly one frame. Since F55 a drag itself never re-homes
    // a native this way — the displacement goes to the table — so the
    // straddling stroke is what still exercises the pen-up path.
    function acrossEdge() {
        const E = mkEngine(800, 600);
        E.cam.set({ frame: "0", activeLevel: 0, inScale: 1 / 32, inPanX: 300 - FRAME_W / 2 / 32, inPanY: 200 });
        E.renderer.clear(); E._render();
        E.setWidth(12);
        drawStroke(E, [[300, 200], [320, 190], [340, 205]], 12);
        const id = E.doc.at("0").slice(-1)[0].id;
        return { E, id };
    }
    test("F50: the render list, the hit test and the ants follow the object to its new cell at pen-up", () => {
        const { E, id } = acrossEdge();
        expect(E._hitTest(320, 192)).toBe(id);
        E.setTool("select");
        tap(E, [320, 192]);
        expect(E.selection.ids).toEqual([id]);
        drag(E, [320, 192], [380, 192], 12);
        expect(E.doc.getById(id).level).not.toBe("0");
        // No manual render: what pen-up left behind is what the next tap reads.
        expect(E._hitTest(380, 192)).toBe(id);
        // Seen from its old frame it is down content now — one piece per tile
        // its picture straddles, every one of them derived.
        const origins = E._lastList.filter((o) => o.id === id).map((o) => o.origin);
        expect(origins.length).toBeGreaterThan(0);
        expect(origins.every((o) => o === "derived")).toBe(true);
        expect(E._selectionAnts()).not.toBeNull();
    });
    test("F52: a piece shown from another frame picks with the same slack as a native", () => {
        const { E, id } = acrossEdge();
        // 9 px below the centreline of a 12 px stroke: 3 px outside the ink, inside the 6 px slack.
        expect(E._hitTest(320, 199)).toBe(id);
        E.setTool("select");
        tap(E, [320, 192]);
        drag(E, [320, 192], [380, 192], 12);
        expect(E._lastList.find((o) => o.id === id).type).toBe("fill");
        expect(E._hitTest(380, 199)).toBe(id);
        expect(E._hitTest(380, 215)).toBeNull();
    });
});

describe("F51 / F55 — a move never touches the stored object; undo empties the table", () => {
    test("drag at the home level, undo: the object is bit-identical throughout, tile phase included", () => {
        const E = mkEngine(800, 600);
        drawStroke(E, [[200, 200], [260, 220], [320, 200]], 10);
        const id = E.doc.at("0").slice(-1)[0].id;
        const bits = () => JSON.stringify(E.doc.serializeNatives(["0"])["0"].find((o) => o.id === id).loops);
        const before = ser(E), loops = bits();
        expect(E.doc.getById(id).obj.tile).toBeUndefined();
        E.setTool("select");
        tap(E, [260, 214]);
        drag(E, [260, 214], [320, 244], 12);
        // The bits and the grid stayed; the picture moved by the table.
        expect(E.doc.getById(id).obj.tile).toBeUndefined();
        expect(bits()).toBe(loops);
        expect(E.doc.getById(id).obj.below[0]).toEqual([60, 30]);
        E.undo();
        expect(E.doc.getById(id).obj.below).toBeUndefined();
        expect(ser(E)).toBe(before);
        E.redo();
        expect(E.doc.getById(id).obj.below[0]).toEqual([60, 30]);
        expect(bits()).toBe(loops);
    });
    test("a pinch that cancels a moved drag empties the table too", () => {
        const E = mkEngine(800, 600);
        drawStroke(E, [[200, 200], [260, 220], [320, 200]], 10);
        const id = E.doc.at("0").slice(-1)[0].id;
        const before = ser(E);
        E.setTool("select");
        tap(E, [260, 214]);
        E.pointerDown(260, 214); for (let i = 1; i <= 8; i++) E.pointerMove(260 + 5 * i, 214);
        expect(E.doc.getById(id).obj.below[0]).toEqual([40, 0]);
        E.cancelSelectGesture(false);
        expect(E.doc.getById(id).obj.below).toBeUndefined();
        expect(ser(E)).toBe(before);
    });
});

describe("F53 — a render mid-stroke does not paint the live stroke twice", () => {
    test("the growing stroke has no render group of its own until pen-up", () => {
        const E = mkEngine(800, 600);
        E.setTool("pen"); E.setPenType("highlight"); E.setWidth(26);
        E.pointerDown(100, 100); for (let i = 1; i <= 20; i++) E.pointerMove(100 + 5 * i, 100 + i);
        const id = E._drawing.id;
        E._render();                                   // what Ctrl+Z, a resize or an idle fit does
        expect(E.renderer._live).not.toBeNull();
        expect(E.renderer._groups.has(id)).toBe(false);
        E.pointerUp(); E.flushBakes(); E._render();
        expect(E.renderer._live).toBeNull();
        expect(E.renderer._groups.has(id)).toBe(true);
    });
});
