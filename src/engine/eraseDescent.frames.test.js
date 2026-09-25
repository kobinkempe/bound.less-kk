/**
 * A descent cannot home ink where the lattice has no frame (REVIEWER A1-3, against new F99s): the
 * worker's copy of the lattice knows the retired ids it must not mint again, and a result whose
 * piece names a frame still missing after the merge is refused, the document untouched.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture } from "./__testkit__/harness";
import { wireDescent, unwireDescent } from "./eraseDescent";

useEngines();

test("A13-1 the worker's lattice copy keeps the retired ids: a moved frame's id is not minted again there", () => {
    const E = mkEngine();
    const X = E.lm.cellChild("0", 7, 3);
    X.addrSeq = 1;                                                     // it moved once: its id retires with it
    expect(E.lm.forget(X.id)).toBe(true);
    const { msg } = wireDescent({ lm: E.lm, cfg: E.cfg, width: E.lm.width, opacityGroups: true },
        { freezeR: 1, HE: "0", target: { level: "0", obj: { type: "shape", id: 1, loops: [] } }, E: { id: 2, w: 1, loops: [] } });
    const { world } = unwireDescent(JSON.parse(JSON.stringify(msg)));
    expect(E.lm.cellChild("0", 7, 3).id).not.toBe(X.id);               // the engine's own rule
    expect(world.lm.cellChild("0", 7, 3).id).not.toBe(X.id);          // red: the copy minted it again
});

test("A13-2 a descent whose piece names a frame the lattice lacks is refused, the document untouched", () => {
    const E = mkEngine();
    const o = drawStroke(E, [[300, 300], [500, 300]], 20);
    E._scheduleBake = () => {};
    eraseGesture(E, [[380, 280], [420, 320]], 20);
    const Erec = E._eraseStrokes()[0];
    const before = JSON.stringify(E.doc.serializeNatives());
    const kid = { type: "shape", origin: "native", loops: o.loops, color: "#000", opacity: 1 };
    const r = { stats: { seals: [], dust: 0 }, minted: [], steps: [{ removedId: o.id, parents: [], kids: [{ vid: -1, level: "0/99,99/5,5", obj: kid }] }] };
    expect(E._applyDescent(Erec, { obj: o, level: "0" }, r, { op: { op: "eraseCommit", baked: [] }, done: new Set() })).toBe(false);
    expect(JSON.stringify(E.doc.serializeNatives())).toBe(before);     // red: the kid homed in a missing frame
});
