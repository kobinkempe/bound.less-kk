// TEMPORARY (B-ERASE debugging; deleted before the checkpoint).
import { useEngines, mkEngine, drawStroke, eraseGesture } from "./__testkit__/harness";

useEngines();

const dragSteps = (E, from, to, steps) => {
    E.setTool("select");
    E.pointerDown(from[0], from[1]); E.pointerUp();
    E.pointerDown(from[0], from[1]);
    for (let i = 1; i <= steps; i++) E.pointerMove(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    E.pointerUp();
};
const zoom = (E, x, y, f, n) => { for (let i = 0; i < n; i++) E.zoomFactorAt(x, y, f); };
const BIG = [[567, 496], [742.5, 541.25], [731.75, 455], [665, 263.25], [761.25, 420]];
const SMALL = [[708, 234], [633, 145], [677, 90], [651, 161]];
const OLD_MARK = [[641, 86], [670.5, 125.5], [693.25, 164.75], [728.5, 197.5], [764.25, 224.75], [763.25, 237.5], [714.75, 242.75], [672.75, 237.5], [676.25, 199.25], [670.5, 154.5], [679.5, 114.5], [685.5, 65.25], [705.75, 20.75], [728.25, 48.75], [705.5, 86.5], [671, 83.75]];
const NEW_MARK = [[641, 12], [665.25, 84.75], [734.5, 207.5]];

test("debug EP-3", () => {
    const E = mkEngine();
    zoom(E, 340, 94, 1 / 1.3, 7); zoom(E, 176, 53, 8, 6); zoom(E, 299, 217, 1 / 8, 3);
    zoom(E, 643, 367, 16, 3); zoom(E, 46, 549, 2, 6); zoom(E, 668, 258, 1 / 2, 6);
    E.setColor("#aa3311"); drawStroke(E, BIG, 60);
    E.setColor("#11aa55"); drawStroke(E, SMALL, 16);
    eraseGesture(E, OLD_MARK, 6);
    zoom(E, 668, 340, 1.3, 7);
    dragSteps(E, [621, 505], [768, 599], 5);
    eraseGesture(E, NEW_MARK, 48);
    const log = (tag) => { for (const op of E.doc._undo) if (op.op === "eraseCommit") console.log(tag, "op", op.strokeId, JSON.stringify(op.baked.map((st) => [st._seq, st.removed ? st.removed.obj.id : "F", (st.pieces || []).map((p) => p.obj.id)]))); };
    log("A");
    for (const m of E._eraseStrokes()) console.log("mark", m.obj.id, "targets", JSON.stringify(m.obj.targets));
    dragSteps(E, [650, 70], [467, -92], 3);
    log("B");
    for (const m of E._eraseStrokes()) console.log("mark", m.obj.id, "targets", JSON.stringify(m.obj.targets));
    const ink = []; for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (!o.erase) ink.push([k, o.id, o.z, o.targetOf, o.handledBy]);
    console.log("ink", JSON.stringify(ink));
});
