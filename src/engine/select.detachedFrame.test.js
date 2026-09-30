/**
 * A deleted frame subtree leaves the lattice (A1 C3), and ink placed where it was goes to a fresh frame
 * at that cell, which reads, selects and erases (REVIEWER-3 DOC-1, F107: until C3 the frame stayed with
 * its list set aside, `getById` answered null for every native homed there, the new ones too, and a
 * revival flagged the old ones `_gone`). An undo puts the subtree back at its cell: the fresh frame's
 * co-resident while it holds ink, its resident when it holds nothing.
 */
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";

useEngines();

const zoom = (E, f, n) => { for (let i = 0; i < n; i++) E.zoomFactorAt(400, 300, f); };
const lasso = (E, pts) => {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
};
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]];
/** Every listed native reads back as itself. */
const readable = (E) => {
    const bad = [];
    for (const k of Object.keys(E.doc.nativesByLevel)) for (const o of E.doc.nativesByLevel[k] || []) {
        const r = E.doc.getById(o.id);
        if (!r || r.obj !== o || r.level !== k) bad.push(o.id);
    }
    return bad;
};

/** `Document.keyedIn` holds exactly each listed frame's natives with a family key (LASSO-1's bookkeeping). */
const keyedOk = (E) => {
    const bad = [];
    for (const k of Object.keys(E.doc.nativesByLevel)) {
        const want = (E.doc.nativesByLevel[k] || []).filter((o) => o.editId != null).map((o) => o.id).sort();
        const have = [...(E.doc.keyedIn(k) || [])].map((o) => o.id).sort();
        if (want.join() !== have.join()) bad.push({ k, want, have });
    }
    for (const k of E.doc.keyedFrames()) if (!E.doc.nativesByLevel[k]) bad.push({ k, orphan: true });
    return bad;
};

/** A stroke A at depth 1, its frame lassoed from depth 0 and deleted, a stroke B drawn where it was. */
function scene() {
    const E = mkEngine();
    zoom(E, 16, 3);
    const F = E.cam.frame;
    const A = drawStroke(E, [[380, 300], [400, 280], [420, 310]], 8);
    erase(E, [[400, 250], [402, 350]], 6);                          // A's pieces carry its key
    zoom(E, 1 / 16, 3);
    E.deselect();
    lasso(E, box(200, 100, 600, 500));
    expect(E.selection.frames).toContain(F);
    E.deleteSelection();
    expect(E.doc.getById(A.id)).toBeNull();
    expect(E.lm.frame(F)).toBeUndefined();                          // out of the lattice
    expect(keyedOk(E)).toEqual([]);
    zoom(E, 16, 3);
    const F2 = E.cam.frame;
    expect(F2).not.toBe(F);                                         // a fresh frame at the cell: F's id is retired
    const B = drawStroke(E, [[300, 300], [350, 250], [420, 330]], 8);
    return { E, F, F2, A, B };
}
const deletedIds = (E) => {
    for (let i = E.doc._undo.length - 1; i >= 0; i--) { const op = E.doc._undo[i]; if (op.op === "removeFrames") return op.records.flatMap((r) => r.natives.map((o) => o.id)); }
    return [];
};

describe("DF — a deleted frame subtree leaves the lattice; ink where it was, and its undo", () => {
    test("DF-1 the new stroke lives in a fresh frame at the cell, and is read, tapped, lassoed and erased", () => {
        const { E, F2, B } = scene();
        expect(B._home).toBe(F2);
        expect(E.doc.getById(B.id)).not.toBeNull();
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
        E.setTool("select");
        expect(E.select(350, 250)).toBe(B.id);
        E.deselect();
        lasso(E, box(100, 100, 700, 500));
        expect(E.selection && E.selection.ids).toContain(B.id);
        E.deselect();
        erase(E, [[280, 300], [440, 280]], 30);
        expect(E.doc._byId.has(B.id)).toBe(false);                   // cut
    });

    test("DF-2 undo brings the deleted subtree back into its cell and takes the new stroke away; redo the other way", () => {
        const { E, F, F2, B } = scene();
        const Apieces = deletedIds(E);
        expect(Apieces.length).toBeGreaterThan(1);
        E.undo(); E.undo();                                           // the add, then the delete
        for (const id of Apieces) expect(E.doc.getById(id)).not.toBeNull();
        expect(E.doc.getById(B.id)).toBeNull();
        expect(E.lm.frame(F)).toBeTruthy();
        expect(E.lm.residentOf(F2).id).toBe(F);                        // the fresh frame held nothing: F took its cell
        expect(E.cam.frame).toBe(F);                                   // and the camera
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
        E.redo(); E.redo();
        for (const id of Apieces) expect(E.doc.getById(id)).toBeNull();
        expect(E.lm.frame(F)).toBeUndefined();
        expect(E.doc.getById(B.id)).not.toBeNull();
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
        E.setTool("select");
        expect(E.select(350, 250)).toBe(B.id);
    });

    test("DF-4 the redo of a frame delete, after the op before it was undone and redone, deletes the ink again (REVIEWER-3 DOC-2)", () => {
        const E = mkEngine();
        const A = drawStroke(E, [[380, 300], [400, 280], [420, 310]], 8);
        zoom(E, 1 / 16, 3);
        E.deselect();
        lasso(E, box(200, 100, 600, 500));
        expect(E.selection.frames).toContain("0");
        E.deleteSelection();
        E.undo(); E.undo(); E.redo(); E.redo();                        // the delete, the add; the add, the delete
        expect(E.doc.getById(A.id)).toBeNull();
        expect(E.doc.at("0").includes(A)).toBe(false);
        expect(readable(E)).toEqual([]);
        E.undo();
        expect(E.doc.getById(A.id)).not.toBeNull();
        expect(E.doc.at("0").includes(A)).toBe(true);
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
    });

    test("DF-3 a subtree put back where a frame holds new ink is its co-resident; deleted again, the new ink stays", () => {
        const E = mkEngine();
        zoom(E, 16, 3);
        const F = E.cam.frame;
        const A = drawStroke(E, [[380, 300], [400, 280], [420, 310]], 8);
        const recs = E.doc.removeFrameSubtree(F);
        E._render();                                                  // the camera to a fresh frame at the cell
        const F2 = E.cam.frame;
        expect(F2).not.toBe(F);
        const B = drawStroke(E, [[300, 300], [350, 250], [420, 330]], 8);
        E.doc.insertFrameSubtree(recs);                               // not the LIFO order a user's undo keeps: a bake's pieces
        expect(E.lm.frame(F).shadowOf).toBe(F2);                       // B's frame keeps the cell
        expect(E.doc.cellList(F2).map((o) => o.id).sort()).toEqual([A.id, B.id].sort());
        expect(E.stage.model.nativesIn(F2).map((o) => o.id).sort()).toEqual([A.id, B.id].sort());
        expect(readable(E)).toEqual([]);
        E.doc.detachFrames(recs);
        expect(E.doc.getById(A.id)).toBeNull();
        expect(E.lm.frame(F)).toBeUndefined();
        expect(E.doc.cellList(F2).map((o) => o.id)).toEqual([B.id]);
        expect(readable(E)).toEqual([]);
    });
});
