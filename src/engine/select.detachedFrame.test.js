/**
 * Ink placed in a frame whose subtree a delete set aside reads, selects and erases (REVIEWER-3
 * DOC-1: `getById` answered null for every native homed in a detached frame, the new ones too, so
 * a stroke drawn where a lassoed frame was deleted was drawn but could not be selected, lassoed
 * or erased until a reload).
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

/** A stroke A at depth 1, its frame lassoed from depth 0 and deleted, a stroke B drawn in the same frame. */
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
    expect(keyedOk(E)).toEqual([]);
    zoom(E, 16, 3);
    expect(E.cam.frame).toBe(F);
    const B = drawStroke(E, [[300, 300], [350, 250], [420, 330]], 8);
    return { E, F, A, B };
}

describe("DF — ink in a frame a delete set aside", () => {
    test("DF-1 the new stroke reads, is tapped, lassoed and erased", () => {
        const { E, F, B } = scene();
        expect(B._home).toBe(F);
        expect(E.doc.getById(B.id)).not.toBeNull();                 // red before: null
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
        E.setTool("select");
        expect(E.select(350, 250)).toBe(B.id);
        E.deselect();
        lasso(E, box(100, 100, 700, 500));
        expect(E.selection && E.selection.ids).toContain(B.id);
        E.deselect();
        erase(E, [[280, 300], [440, 280]], 30);
        expect(E.doc._byId.has(B.id)).toBe(false);                   // cut: red before, left whole
    });

    test("DF-2 undo brings the deleted stroke back and takes the new one away; redo the other way", () => {
        const { E, B } = scene();
        const Apieces = E.doc._detachedLists.size ? [...E.doc._detachedLists.values()].flat().map((o) => o.id) : [];
        expect(Apieces.length).toBeGreaterThan(1);
        E.undo(); E.undo();                                           // the add, then the delete
        for (const id of Apieces) expect(E.doc.getById(id)).not.toBeNull();
        expect(E.doc.getById(B.id)).toBeNull();
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
        E.redo(); E.redo();
        for (const id of Apieces) expect(E.doc.getById(id)).toBeNull();
        expect(E.doc.getById(B.id)).not.toBeNull();                  // red before: null
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
        E.setTool("select");
        expect(E.select(350, 250)).toBe(B.id);
    });

    test("DF-4 the redo of a frame delete, after the op before it was undone and redone, sets the ink aside again (REVIEWER-3 DOC-2)", () => {
        const E = mkEngine();
        const A = drawStroke(E, [[380, 300], [400, 280], [420, 310]], 8);
        zoom(E, 1 / 16, 3);
        E.deselect();
        lasso(E, box(200, 100, 600, 500));
        expect(E.selection.frames).toContain("0");
        E.deleteSelection();
        E.undo(); E.undo(); E.redo(); E.redo();                        // the delete, the add; the add, the delete
        expect(E.doc.getById(A.id)).toBeNull();                        // red: still listed and readable
        expect(E.doc.at("0").includes(A)).toBe(false);
        expect(readable(E)).toEqual([]);
        E.undo();
        expect(E.doc.getById(A.id)).not.toBeNull();
        expect(E.doc.at("0").includes(A)).toBe(true);
        expect(readable(E)).toEqual([]);
        expect(keyedOk(E)).toEqual([]);
    });

    test("DF-3 a restore into a frame that holds new ink keeps it; setting the record aside again leaves it", () => {
        const E = mkEngine();
        zoom(E, 16, 3);
        const F = E.cam.frame;
        const A = drawStroke(E, [[380, 300], [400, 280], [420, 310]], 8);
        const recs = E.doc.removeFrameSubtree(F);
        const B = drawStroke(E, [[300, 300], [350, 250], [420, 330]], 8);
        E.doc.insertFrameSubtree(recs);                               // not the LIFO order a user's undo keeps: a bake's pieces
        expect(E.doc.at(F).map((o) => o.id).sort()).toEqual([A.id, B.id].sort());   // red before: B dropped from the list
        expect(readable(E)).toEqual([]);
        expect(E.doc.queryRect(F, { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }).map((o) => o.id).sort()).toEqual([A.id, B.id].sort());
        for (const r of recs) E.doc.detachFrame(r.frame, r);
        expect(E.doc.getById(A.id)).toBeNull();
        expect(E.doc.at(F).map((o) => o.id)).toEqual([B.id]);         // red before: B set aside with the frame
        expect(readable(E)).toEqual([]);
        expect(E.doc.queryRect(F, { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }).map((o) => o.id)).toEqual([B.id]);
    });
});
