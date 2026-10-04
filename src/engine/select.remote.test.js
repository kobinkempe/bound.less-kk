/**
 * A remote edit reaches this device as a reload (`useKobinEngine`'s `reload`: `loadDrawing` of the store, then
 * `OpLog.replay` of its entries). The load's reset drops the selection, so no id the other device removed is left
 * in it, dead (PLAN §5.19 item 5, DESIGN.md §10); a local action's removals are repaired from its op (A1 C2).
 */
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";
import { OpLog } from "./oplog";
import { encodeObjects, decodeObjects } from "./format2";

useEngines();

test("a remote removal of a selected native leaves no dead id in the selection", () => {
    const A = mkEngine(), log = new OpLog(A);
    const s1 = drawStroke(A, [[100, 100], [300, 120]], 12);
    const s2 = drawStroke(A, [[100, 300], [300, 320]], 12);
    log.drain();
    const frames = {}, frameSeq = {};
    for (const k of Object.keys(A.doc.nativesByLevel)) { frames[k] = encodeObjects(A.doc.list(k)); frameSeq[k] = log.seq; }
    const load = (E) => {
        const natives = {};
        for (const k of Object.keys(frames)) natives[k] = decodeObjects(frames[k].objects, frames[k].geo);
        E.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: E.cam.state(), crossings: A.lm.serialize(), natives });
    };
    const B = mkEngine();
    load(B);
    B.setTool("select");
    B._setSelection([s1.id, s2.id], [], true);
    expect(B.selection.ids).toEqual([s1.id, s2.id]);
    // The other device deletes s1; its entries reach this one through a reload.
    A.setTool("select");
    A._setSelection([s1.id], [], true);
    A.deleteSelection();
    const { entries } = log.drain();
    expect(entries.length).toBeGreaterThan(0);
    load(B);
    new OpLog(B).replay(entries, frameSeq);
    B._render();
    expect(B.doc.getById(s1.id)).toBeNull();
    expect(B.doc.getById(s2.id)).not.toBeNull();
    const ids = B.selection ? B.selection.ids : [];
    expect(ids.filter((id) => !B.doc.getById(id))).toEqual([]);
});
