/**
 * PAPER-PLAN R3 / B-drag-bitmap §1.2, §2.3: while a drag is live its members' plate events are
 * held rather than drained, and every way a drag can end goes through the one exit `_endMove`,
 * which releases the hold as ONE collapsed invalidation. The hold is on only where the renderer
 * draws the dragged ink itself (`supportsDragPlane`); the tests switch it on by hand.
 */
import KobinEngine from "./KobinEngine";
import { SELECT_DRAG_PX } from "./selection";

const hosts = [];
function mkE(raster, hold = true) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster });
    if (raster) E.renderer.layer.syncBudget = 0;
    E._moveHoldOn = hold;
    hosts.push({ E, host });
    return E;
}
afterEach(() => { while (hosts.length) { const h = hosts.pop(); try { h.E.destroy(); } catch (e) { /* torn down */ } h.host.remove(); } });

const S = 200;
const mkFill = (E, ox, oy) => ({
    type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1,
    polys: [[[ox, oy], [ox + S, oy], [ox + S, oy + S], [ox, oy + S]]],
});
/** Two fills at level 0 side by side, both lassoed (the loop is placed through the camera's own mapping). */
function drawAndSelect(E) {
    const a = E.doc.add(mkFill(E, -300, -100), "0");
    const b = E.doc.add(mkFill(E, 0, -100), "0");
    E._render();
    E.setTool("select");
    const c = E.cam.levelPointToScreen("0", -50, 0);              // the pair's centre
    const loop = [];
    for (let k = 0; k <= 32; k++) { const a0 = (k / 32) * Math.PI * 2; loop.push([c[0] + 330 * Math.cos(a0), c[1] + 240 * Math.sin(a0)]); }
    E.pointerDown(loop[0][0], loop[0][1]);
    for (const p of loop.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
    expect(E.selection && E.selection.ids.slice().sort()).toEqual([a.id, b.id].sort());
    return [a, b];
}
/** Press on the first fill's ink and drag right `steps` px, one pixel a step. */
function dragSteps(E, steps) {
    const p = E.cam.levelPointToScreen("0", -200, 0);
    E.pointerDown(p[0], p[1]);
    for (let k = 1; k <= steps; k++) E.pointerMove(p[0] + k, p[1]);
}
const pressAt = (E) => E.cam.levelPointToScreen("0", -200, 0);

describe("R3 — the drag's hold and its one exit", () => {
    test("raster: no plate event is drained during a 200-step drag; the drop is one collapsed invalidation", () => {
        const E = mkE(true);
        const [a, b] = drawAndSelect(E);
        const drained = jest.spyOn(E.plates, "onDocEvent");
        const byId = jest.spyOn(E.plates, "dropById");
        const byRect = jest.spyOn(E.plates, "dropRectPerFrame");
        dragSteps(E, 200);
        expect(E._dragSel && E._dragSel.moved).toBe(true);
        expect(E._holdMove && [...E._holdMove.ids].sort()).toEqual([a.id, b.id].sort());
        expect(drained).not.toHaveBeenCalled();                     // red with the hold off: 400+ events
        expect(byId).not.toHaveBeenCalled();
        E.pointerUp();
        expect(E._dragSel).toBeNull();
        expect(E._holdMove).toBeNull();
        expect(E.store._batch).toBe(false);
        expect(byId).toHaveBeenCalledTimes(1);
        expect(byId.mock.calls[0][0]).toBeInstanceOf(Set);
        expect(byId.mock.calls[0][0].size).toBe(2);
        expect(byRect).toHaveBeenCalledTimes(1);
        // The move itself happened: both members carry a table now, and the op is undoable.
        expect(E.doc.getById(a.id).obj.below).toBeTruthy();
        expect(E.doc.getById(b.id).obj.below).toBeTruthy();
        expect(E.doc.canUndo()).toBe(true);
        // Nothing queued was left behind.
        expect(E._plateEvents.length).toBe(0);
    });

    test("raster, hold off: every step drains its events, as before", () => {
        const E = mkE(true, false);
        drawAndSelect(E);
        const drained = jest.spyOn(E.plates, "onDocEvent");
        dragSteps(E, 50);
        expect(E._holdMove).toBeNull();
        expect(drained.mock.calls.length).toBeGreaterThanOrEqual(50);
        E.pointerUp();
        expect(E._dragSel).toBeNull();
    });

    test("the footprint names both addresses of a moved member", () => {
        const E = mkE(true);
        const [a] = drawAndSelect(E);
        dragSteps(E, 40);
        const h = E._holdMove;
        const rects = E._movedRectsIn(h, "0");
        expect(Array.isArray(rects) && rects.length).toBe(4);       // two members, start and end each
        const box = E.doc.getById(a.id).obj;
        expect(box.below).toBeTruthy();                             // moved: the start box differs from the end
        E.pointerUp();
    });

    test("undo mid-drag cancels the drag first and puts the members back", () => {
        const E = mkE(true);
        const [a, b] = drawAndSelect(E);
        dragSteps(E, 30);
        expect(E._dragSel).not.toBeNull();
        E.undo();
        expect(E._dragSel).toBeNull();
        expect(E._holdMove).toBeNull();
        expect(E.store._batch).toBe(false);
        expect(E.doc.getById(a.id).obj.below || null).toBeNull();   // the cancel restored the start table
        expect(E.doc.getById(b.id).obj.below || null).toBeNull();
    });

    test("deselect and delete mid-drag release the batch, the hold and the merge hold", () => {
        const E = mkE(true);
        drawAndSelect(E);
        dragSteps(E, 10);
        E.doc.holdMerges = true;                                    // as a frame drag sets it
        E.deselect();
        expect(E._dragSel).toBeNull();
        expect(E._holdMove).toBeNull();
        expect(E.store._batch).toBe(false);
        expect(E.doc.holdMerges).toBe(false);

        const E2 = mkE(true);
        const [a, b] = drawAndSelect(E2);
        dragSteps(E2, 10);
        E2.doc.holdMerges = true;
        E2.deleteSelection();
        expect(E2._dragSel).toBeNull();
        expect(E2._holdMove).toBeNull();
        expect(E2.store._batch).toBe(false);
        expect(E2.doc.holdMerges).toBe(false);
        expect(E2.doc.getById(a.id)).toBeNull();
        expect(E2.doc.getById(b.id)).toBeNull();
    });

    test("SVG: the same exit, with no plates to release", () => {
        const E = mkE(false);
        const [a] = drawAndSelect(E);
        dragSteps(E, 20);
        expect(E._holdMove).toBeNull();                             // no plates: nothing to hold
        E.pointerUp();
        expect(E._dragSel).toBeNull();
        expect(E.doc.getById(a.id).obj.below).toBeTruthy();
    });

    test("the drag state the renderer pulls: the member set and the first pointer it was read at", () => {
        const E = mkE(true);
        const [a, b] = drawAndSelect(E);
        expect(E._dragState()).toBeNull();
        dragSteps(E, 12);
        const st = E._dragState();
        expect([...st.ids].sort()).toEqual([a.id, b.id].sort());
        expect(st.drag).toBe(E._dragSel);
        const p = pressAt(E);
        // The renderer pulls it on the drag's first step (the plane, PAPER-PLAN §10 S4): SELECT_DRAG_PX in.
        expect(st.at).toEqual([p[0] + SELECT_DRAG_PX, p[1]]);
        E.pointerMove(p[0] + 40, p[1]);
        expect(E._dragState().at).toEqual([p[0] + SELECT_DRAG_PX, p[1]]);   // fixed for the whole drag
        E.pointerUp();
        expect(E._dragState()).toBeNull();
    });
});
