/**
 * A selected frame moves as a frame (DESIGN.md §8, the subtree move, 2026-09-15): the
 * drag re-addresses the frames within three levels of the camera and leaves a shift for
 * their natives, never touching an object; the per-object path gives the same picture,
 * native for native; one op undoes the gesture, a settle since included.
 */
import { useEngines, mkEngine, eraseGesture } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import { encodeBelow } from "./geometry/offsets";

const rects = (E, frame, n, seed) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const x = ((i * 7919 + seed) % 40000) - 20000, y = ((i * 104729 + seed) % 40000) - 20000;
        const o = { type: "shape", origin: "native", id: E.doc.allocId(),
            loops: rectLoop({ left: x, top: y, right: x + 50 + (i % 900), bottom: y + 40 }), color: "#123", opacity: 1, w: 8 };
        E.doc.add(o, frame); ids.push(o.id);
    }
    return ids;
};
// The camera at depth 1; a root R one level below it, K two, L three (the depths a move
// re-addresses), 300 natives in each.
const fixture = (n = 300) => {
    const E = mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const R = E.lm.cellChild("1", 5, 5), K = E.lm.cellChild(R.id, 7, -7), L = E.lm.cellChild(K.id, 1, 1);
    const ids = { R: rects(E, R.id, n, 1), K: rects(E, K.id, n, 2), L: rects(E, L.id, n, 3) };
    E._render();
    return { E, R, K, L, ids, all: [...ids.R, ...ids.K, ...ids.L] };
};
const addrOf = (E, id) => { const f = E.lm.frame(id); return f ? { parent: f.parent, i: f.cell.i, j: f.cell.j } : null; };
// A frame's address as cells from just below `depth` down to itself.
const chainOf = (E, id, depth) => {
    const out = [];
    let f = E.lm.frame(id);
    while (f && f.depth > depth) { out.unshift([f.cell.i, f.cell.j]); f = E.lm.frame(f.parent); }
    return out;
};
const bytes = (E) => {
    const n = E.doc.serializeNatives();
    return JSON.stringify(Object.keys(n).sort().map((k) => [k, n[k].slice().sort((a, b) => a.id - b.id)]));
};
const press = (E, frameId) => E._levelPointToScreen(frameId, 0, 0);
const spy = (obj, name) => { const orig = obj[name].bind(obj); let n = 0; obj[name] = (...a) => { n++; return orig(...a); }; return () => n; };
// The same gesture without the pointer: the per-object path needs no hit on sub-pixel ink.
const dragDirect = (E, p, dx, dy) => {
    E._dragSel = { start: [p[0], p[1]], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
    E.store.setBatch(true);
    E._dragSelection(p[0] + dx, p[1] + dy);
};
const settleAll = (E) => { for (const k of [...E.lm.frames.keys()]) E.doc.at(k); };

describe("a selected frame moves as a frame (subtree O(1), 2026-09-15)", () => {
    useEngines();
    test("t1 a drag from the frame's mark re-addresses the frames and touches no object", () => {
        const { E, R, K, L, ids } = fixture();
        E._setSelection([], [R.id]);
        const rehome = spy(E.doc, "rehomeById"), rehomeMany = spy(E.doc, "rehomeManyById"), offsets = spy(E.doc, "setOffsetsById");
        const p = press(E, R.id);
        E.setTool("select"); E.pointerDown(p[0], p[1]); E.pointerMove(p[0] + 40, p[1]);
        expect(E._dragSel).toBeTruthy();
        const st = E._dragSel.frames.get(R.id);
        expect(st.to).toEqual({ parent: "1", i: 6, j: 5 });                                // 40 units = one cell of "1" and 8 over
        expect(addrOf(E, R.id)).toEqual({ parent: "1", i: 6, j: 5 });
        expect(st.shiftAfter).toEqual([8 * 4096, 0]);                                      // the 8 units, in R's own units
        // The render of the drag reads R's natives (they are above the cull at R's deepest zoom),
        // which settles the shift into their tables right away; either state is the same picture.
        if (E.lm.frame(R.id).shift) expect(E.lm.frame(R.id).shift).toEqual([8 * 4096, 0]);
        else { expect(st.settled.tables.length).toBe(300); expect(encodeBelow(E.doc.getById(ids.R[0]).obj.below)).toEqual(encodeBelow([[8 * 4096, 0]])); }
        expect(addrOf(E, K.id)).toEqual({ parent: R.id, i: 7 + 1024, j: -7 });              // and 1,024 of K's cells
        expect(E.lm.frame(K.id).shift).toBeNull();
        expect(addrOf(E, L.id)).toEqual({ parent: K.id, i: 1, j: 1 });                      // three levels down: nothing left over
        expect([rehome(), rehomeMany(), offsets()]).toEqual([0, 0, 0]);
        E.pointerUp();
        const op = E.doc._undo[E.doc._undo.length - 1];
        expect(op.op).toBe("moveFrames");
        expect(op.frames.map((e) => e.id).sort()).toEqual([R.id, K.id].sort());
        expect(op.moves).toEqual([]);
        expect([rehome(), rehomeMany(), offsets()]).toEqual([0, 0, 0]);
    });
    test("t2 the per-object path gives the same picture, native for native", () => {
        const A = fixture(), B = fixture();
        const p = press(A.E, A.R.id);
        A.E._setSelection([], [A.R.id]);
        dragDirect(A.E, p, 40, 0); A.E.pointerUp();
        B.E._setSelection(B.all);
        dragDirect(B.E, p, 40, 0); B.E.pointerUp();
        settleAll(A.E);
        for (const id of A.all) {
            const a = A.E.doc.getById(id), b = B.E.doc.getById(id);
            expect(chainOf(A.E, a.level, 1)).toEqual(chainOf(B.E, b.level, 1));
            expect(encodeBelow(a.obj.below) || null).toEqual(encodeBelow(b.obj.below) || null);
        }
    });
    test("t3 a cancelled drag puts the frames and their natives back", () => {
        const { E, R, K, L } = fixture();
        const start = { bytes: bytes(E), R: addrOf(E, R.id), K: addrOf(E, K.id), L: addrOf(E, L.id) };
        E._setSelection([], [R.id]);
        const p = press(E, R.id);
        dragDirect(E, p, 40, 0);
        expect(addrOf(E, R.id)).not.toEqual(start.R);
        E.doc.at(R.id);                                    // a settle during the drag, undone by the cancel
        E.cancelSelectGesture(false);
        expect(bytes(E)).toBe(start.bytes);
        expect([addrOf(E, R.id), addrOf(E, K.id), addrOf(E, L.id)]).toEqual([start.R, start.K, start.L]);
        expect(E.lm.frame(R.id).shift).toBeNull();
    });
    test("t4 one op: undo and redo are exact on the natives and the addresses", () => {
        const { E, R, K, L } = fixture();
        const start = { bytes: bytes(E), R: addrOf(E, R.id), K: addrOf(E, K.id), L: addrOf(E, L.id) };
        E._setSelection([], [R.id]);
        dragDirect(E, press(E, R.id), 40, 0); E.pointerUp();
        E.doc.at(R.id); E.doc.at(K.id);                          // the settled state, so bytes compare
        const after = { bytes: bytes(E), R: addrOf(E, R.id), K: addrOf(E, K.id) };
        expect(after.bytes).not.toBe(start.bytes);
        expect(E.undo()).toBe(true);
        expect(bytes(E)).toBe(start.bytes);
        expect([addrOf(E, R.id), addrOf(E, K.id), addrOf(E, L.id)]).toEqual([start.R, start.K, start.L]);
        expect(E.lm.frame(R.id).shift).toBeNull();
        expect(E.redo()).toBe(true);
        E.doc.at(R.id); E.doc.at(K.id);
        expect([addrOf(E, R.id), addrOf(E, K.id)]).toEqual([after.R, after.K]);
        expect(bytes(E)).toBe(after.bytes);
        expect(E.undo()).toBe(true);
        expect(bytes(E)).toBe(start.bytes);
    });
    test("t5 undo after a settle subtracts the settled tables", () => {
        const { E, R, K, ids } = fixture();
        const start = bytes(E);
        E._setSelection([], [R.id]);
        dragDirect(E, press(E, R.id), 40, 0); E.pointerUp();
        E.doc.at(R.id); E.doc.at(K.id);
        expect(encodeBelow(E.doc.getById(ids.R[0]).obj.below)).toBeTruthy();
        const op = E.doc._undo[E.doc._undo.length - 1];
        expect(op.frames.find((e) => e.id === R.id).settled.tables.length).toBe(300);
        expect(E.undo()).toBe(true);
        expect(bytes(E)).toBe(start);
        expect(E.doc.getById(ids.R[0]).level).toBe(R.id);
    });
    test("t6 a loose object and a frame move in one op", () => {
        const { E, R } = fixture();
        const loose = rects(E, "1", 1, 9)[0];
        const start = bytes(E);
        E._setSelection([loose], [R.id]);
        dragDirect(E, press(E, R.id), 40, 0); E.pointerUp();
        const op = E.doc._undo[E.doc._undo.length - 1];
        expect(op.op).toBe("moveFrames");
        expect(op.moves.length).toBe(1);
        expect(encodeBelow(E.doc.getById(loose).obj.below)).toBeTruthy();
        expect(E.undo()).toBe(true);
        expect(bytes(E)).toBe(start);
        expect(E.redo()).toBe(true);
        expect(encodeBelow(E.doc.getById(loose).obj.below)).toBeTruthy();
        expect(addrOf(E, R.id)).toEqual({ parent: "1", i: 6, j: 5 });
    });
});

describe("a frame dropped on an occupied cell (subtree O(1), 2026-09-15)", () => {
    useEngines();
    // Two frames a level under the camera at cells (10, 0) and (12, 0), 100 natives each; A has
    // a kid at (1, 1) with natives, B a kid at (2, 2). A drag of two cells of "1" (2 G units at
    // the camera) puts A on B's cell.
    const build = () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const A = E.lm.cellChild("1", 10, 0), A1 = E.lm.cellChild(A.id, 1, 1);
        const B = E.lm.cellChild("1", 12, 0), B1 = E.lm.cellChild(B.id, 2, 2);
        const ids = { A: rects(E, A.id, 100, 1), A1: rects(E, A1.id, 30, 2), B: rects(E, B.id, 100, 3), B1: rects(E, B1.id, 30, 4) };
        E._render();
        return { E, A, A1, B, B1, ids };
    };
    const drop = (E, A, dx) => { E._setSelection([], [A.id]); dragDirect(E, press(E, A.id), dx, 0); E.pointerUp(); };
    test("t8 the mover shadows the resident, keeps its natives, merges at the resident's first read, and undo splits it back", () => {
        const { E, A, A1, B, B1, ids } = build();
        const start = bytes(E);
        drop(E, A, 64);
        expect(E.lm.frame(A.id).shadowOf).toBe(B.id);
        expect(addrOf(E, A.id)).toEqual({ parent: "1", i: 12, j: 0 });
        expect(E.lm.findCellChild("1", 12, 0)).toBe(B);
        expect(E.doc.getById(ids.A[0]).level).toBe(A.id);
        expect(E.doc.count(A.id)).toBe(100);
        expect(E.selection.frames).toEqual([A.id]);
        expect(E._isSelected(ids.A[0])).toBe(true);
        expect(E._selectionStatus().count).toBe(130);
        const op = E.doc._undo[E.doc._undo.length - 1];
        expect(op.op).toBe("moveFrames");
        expect(op.frames.find((e) => e.id === A.id).merged).toBeNull();
        // The first read of B merges A into it: natives, kids, and the selection follows.
        E.doc.at(B.id);
        expect(E.lm.frame(A.id)).toBeUndefined();
        expect(E.doc.getById(ids.A[0]).level).toBe(B.id);
        expect(E.doc.count(B.id)).toBe(200);
        expect(E.doc.count(A.id)).toBe(0);
        expect(addrOf(E, A1.id)).toEqual({ parent: B.id, i: 1, j: 1 });
        expect(addrOf(E, B1.id)).toEqual({ parent: B.id, i: 2, j: 2 });
        expect(E.doc.getById(ids.A1[0]).level).toBe(A1.id);
        const merged = op.frames.find((e) => e.id === A.id).merged;
        expect(merged.length).toBe(1);
        expect(merged[0].ids.length).toBe(100);
        expect(E.selection.ids.slice().sort()).toEqual(ids.A.slice().sort());
        expect(E.selection.frames).toEqual([A1.id]);
        // Undo: A is back at (10, 0) with its natives and its kid; the bytes are the start's.
        expect(E.undo()).toBe(true);
        expect(addrOf(E, A.id)).toEqual({ parent: "1", i: 10, j: 0 });
        expect(E.lm.frame(A.id).shadowOf).toBeNull();
        expect(E.lm.findCellChild("1", 10, 0)).toBe(E.lm.frame(A.id));
        expect(addrOf(E, A1.id)).toEqual({ parent: A.id, i: 1, j: 1 });
        expect(E.doc.count(A.id)).toBe(100);
        expect(E.doc.count(B.id)).toBe(100);
        expect(bytes(E)).toBe(start);
        // Redo puts A on B's cell again; the redo's render reads B (its natives are above the
        // cull at the camera's deepest zoom), so the merge comes straight back, on the same op.
        expect(E.redo()).toBe(true);
        E.doc.at(B.id);
        expect(E.lm.frame(A.id)).toBeUndefined();
        expect(E.doc.count(B.id)).toBe(200);
        expect(E.doc._undo[E.doc._undo.length - 1].frames.find((e) => e.id === A.id).merged.length).toBe(1);
        expect(E.undo()).toBe(true);
        expect(bytes(E)).toBe(start);
        expect(addrOf(E, A1.id)).toEqual({ parent: A.id, i: 1, j: 1 });
    });
    test("t9 an empty visited cell yields to the mover and takes its place back when the mover leaves", () => {
        const { E, A } = build();
        const C = E.lm.cellChild("1", 8, 0);              // visited, nothing in it
        const start = bytes(E);
        drop(E, A, -64);
        expect(E.lm.findCellChild("1", 8, 0)).toBe(E.lm.frame(A.id));
        expect(E.lm.frame(C.id).shadowOf).toBe(A.id);
        expect(E.lm.frame(A.id).shadowOf).toBeNull();
        // Reading A merges the empty shadow away; undo restores the container as the cell's resident.
        E.doc.at(A.id);
        expect(E.lm.frame(C.id)).toBeUndefined();
        expect(E.undo()).toBe(true);
        expect(E.lm.findCellChild("1", 8, 0)).toBe(E.lm.frame(C.id));
        expect(E.lm.frame(C.id).shadowOf).toBeNull();
        expect(addrOf(E, A.id)).toEqual({ parent: "1", i: 10, j: 0 });
        expect(bytes(E)).toBe(start);
    });
    test("t10 a drag across visited cells never merges and never touches an object", () => {
        const { E, A } = build();
        for (let i = 7; i <= 9; i++) E.lm.cellChild("1", i, 0);
        const rehome = spy(E.doc, "rehomeById"), rehomeMany = spy(E.doc, "rehomeManyById"), offsets = spy(E.doc, "setOffsetsById");
        E._setSelection([], [A.id]);
        const p = press(E, A.id);
        E._dragSel = { start: [p[0], p[1]], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        E.store.setBatch(true);
        for (const dx of [-32, -64, -96, -64, -32, 0, 32, 64]) { E._dragSelection(p[0] + dx, p[1]); E.doc.at(E.cam.frame); }
        expect(E.doc.count(A.id)).toBe(100);
        expect(E.lm.frame(A.id).shadowOf).toBe(E.lm.frame("1/12,0").id);
        E.pointerUp();
        expect([rehome(), rehomeMany(), offsets()]).toEqual([0, 0, 0]);
        for (let i = 7; i <= 9; i++) expect(E.lm.findCellChild("1", i, 0).id).toBe("1/" + i + ",0");
        expect(E.lm.findCellChild("1", 10, 0)).toBeNull();
    });
});

// An erase covering a frame whole - its cell plus reach inside the mark - takes the subtree as
// containers, one bake step, no cut (SUBTREE-O1-PLAN §5; Kobin's rule and his undo decision).
describe("an erase covering a frame takes it whole (subtree O(1), 2026-09-15)", () => {
    useEngines();
    // R a level under the camera at cell (5, 5) of "1": its centre is at (560, 460) on screen and
    // its reach box (+-REACH/R = 48 units of "1") spans 512..608 x 412..508. K under R.
    const build = () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const R = E.lm.cellChild("1", 5, 5), K = E.lm.cellChild(R.id, 7, -7);
        const ids = { R: rects(E, R.id, 100, 1), K: rects(E, K.id, 50, 2) };
        E._render();
        return { E, R, K, ids };
    };
    const lastOp = (E) => E.doc._undo[E.doc._undo.length - 1];
    test("t11 covered: one step of containers, no cut; undo puts every native back, redo takes them again", () => {
        const { E, R, K } = build();
        const start = bytes(E);
        const cuts = spy(E.doc, "eraseReplaceById"), removes = spy(E.doc, "removeById");
        eraseGesture(E, [[500, 460], [620, 460]], 130);          // 435..685 x 395..525: the reach box with 60 px to spare
        E.flushBakes();
        expect(E._eraseStrokes().length).toBe(1);
        E.flushErases();
        expect(E.doc.count(R.id)).toBe(0);
        expect(E.doc.count(K.id)).toBe(0);
        expect(cuts()).toBe(0);
        expect(removes()).toBe(1);                                  // the spent mark itself
        const op = lastOp(E);
        expect(op.op).toBe("eraseCommit");
        expect(op.baked.length).toBe(1);
        expect(op.baked[0].frames.map((r) => r.frame).sort()).toEqual([R.id, K.id].sort());
        expect(E.journal.find((j) => j.kind === "erase").cuts).toEqual([{ frame: R.id, mode: "frame", natives: 150 }]);
        expect(E.undo()).toBe(true);
        expect(bytes(E)).toBe(start);
        expect(E.doc.count(R.id)).toBe(100);
        expect(E.redo()).toBe(true);
        expect(E.doc.count(R.id)).toBe(0);
        expect(E.doc.count(K.id)).toBe(0);
        expect(E.undo()).toBe(true);
        expect(bytes(E)).toBe(start);
    });
    test("t12 a native drawn after the mark keeps the frame on the per-object path", () => {
        const { E, R, K, ids } = build();
        eraseGesture(E, [[500, 460], [620, 460]], 130);
        const late = rects(E, R.id, 1, 9)[0];                       // drawn under the pending mark: above it in z
        const cuts = spy(E.doc, "eraseReplaceById");
        E.flushErases();
        expect(E.doc.getById(late)).toBeTruthy();                   // not erased: it is above the mark
        expect(E.doc.getById(ids.R[0])).toBeNull();                 // the older ones are, one by one
        expect(cuts() + E.doc.count(R.id)).toBeGreaterThan(0);
        const taken = lastOp(E).baked.flatMap((st) => (st.frames ? st.frames.map((r) => r.frame) : []));
        expect(taken).not.toContain(R.id);                          // R stays on the per-object path...
        expect(taken).toContain(K.id);                              // ...and its kid, wholly under the mark and below it in z, goes whole
    });
    test("t13 a mark that covers the natives but not the frame's reach cuts per object", () => {
        const { E, R } = build();
        eraseGesture(E, [[540, 460], [580, 460]], 40);            // 520..600 x 440..480: the natives (+-5 px), not R's box
        E.flushErases();
        expect(E.doc.count(R.id)).toBe(0);
        const taken = lastOp(E).baked.flatMap((st) => (st.frames ? st.frames.map((r) => r.frame) : []));
        expect(taken).not.toContain(R.id);
        expect(lastOp(E).baked.filter((st) => !st.frames).length).toBeGreaterThan(1);   // R's natives, one by one
    });
});
