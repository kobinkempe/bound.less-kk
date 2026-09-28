/**
 * The erase barrier at a drag's start (`_dragBarrier`, A2 §4.11) scans the document a bounded number
 * of times, not once per selected id (REVIEWER A3-2: on the Magnum Opus 1,000 selected ids took 7.7 s
 * and 4,000 took 39 s with no mark pending — two full scans per id).
 */
import { useEngines, mkEngine, eraseGesture } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";

jest.setTimeout(60000);
useEngines();

const shapes = (E, n) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const x = (i % 50) * 14 - 350, y = Math.floor(i / 50) * 14 - 280;
        const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: x, top: y, right: x + 10, bottom: y + 10 }),
            color: "#345", opacity: 1, w: 2 };
        E.doc.add(o, E.cam.frame); ids.push(o.id);
    }
    return ids;
};

describe("MS — a drag's start costs a bounded number of document scans", () => {
    test("MS-3 a drag reads its members once, not on every step; each member moves by the step (A1-4)", () => {
        const E = mkEngine();
        const ids = shapes(E, 600);
        E._render();
        E._setSelection(ids.slice(0, 200));
        const p = E.cam.levelPointToScreen(E.cam.frame, -345, -275);   // on the first shape
        E.setTool("select");
        E.pointerDown(p[0], p[1]);
        E.pointerMove(p[0] + 10, p[1] + 4);                             // the drag begins
        const members = jest.spyOn(E, "_selectionMembers");
        for (let k = 2; k <= 21; k++) E.pointerMove(p[0] + 10 * k, p[1] + 4 * k);
        expect(members.mock.calls.length).toBeLessThanOrEqual(1);       // red: one a step
        E.pointerUp();
        const moved = ids.slice(0, 200).filter((id) => { const r = E.doc.getById(id); return r && r.obj.below; });
        expect(moved.length).toBe(200);
        expect(ids.slice(200).filter((id) => E.doc.getById(id).obj.below).length).toBe(0);
    });
    test("MS-1 no mark pending: 500 selected ids, the barrier scans a handful of times, not 1,000", () => {
        const E = mkEngine();
        const ids = shapes(E, 2000);
        E._render();
        E._setSelection(ids.slice(0, 500));
        const scans = jest.spyOn(E, "_eraseStrokes");
        E._dragBarrier(() => {});
        expect(scans.mock.calls.length).toBeLessThanOrEqual(2);   // red: two per id
    });
    test("MS-2 a mark pending over the selection is still baked out before the drag, and the new pieces stay selected", () => {
        const E = mkEngine();
        const ids = shapes(E, 400);
        E._render();
        eraseGesture(E, [[-350, -280], [-300, -270]], 8);          // over the first few shapes
        E.flushBakes();
        E._setSelection(ids.slice(0, 100));
        const before = new Set(ids.slice(0, 100));
        E._dragBarrier(() => {});
        expect(E._eraseStrokes().length).toBe(0);                    // the mark is spent
        const sel = E.selection ? E.selection.ids : [];
        const pieces = [];                                             // what the bake cut out of the selected shapes
        for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (!o.erase && o.editId != null && before.has(o.editId)) pieces.push(o.id);
        expect(pieces.length).toBeGreaterThan(0);
        for (const id of pieces) expect(sel).toContain(id);           // red without following the minted pieces
    });
});
