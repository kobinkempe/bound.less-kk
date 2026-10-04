/* Scratch probe (R-MODEL-C34; deleted before hand-back): the frame census after a drop on an occupied cell, live vs oracle. */
import { useEngines, mkEngine } from "./__testkit__/harness";
import OracleEngine from "./__oracles__/model-v1/KobinEngine";
import { collectFrames, sweepFrames } from "./frameGc";
import { collectFrames as oCollect } from "./__oracles__/model-v1/frameGc";
import { rectLoop } from "./geometry/arcShape";

useEngines();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const rects = (E, frame, n) => {
    for (let i = 0; i < n; i++) E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: -400 + i * 90, top: -300, right: -340 + i * 90, bottom: -250 }), color: "#123", opacity: 1, w: 8 }, frame);
};
function run(oracle) {
    const E = oracle ? new OracleEngine(document.body.appendChild(document.createElement("div")), { width: 800, height: 600, scenes: false }) : mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const A = E.lm.cellChild("1", 10, 0).id, B = E.lm.cellChild("1", 12, 0).id;
    const A1 = E.lm.cellChild(A, 1, 1).id, A2 = E.lm.cellChild(A, 2, 2).id, A11 = E.lm.cellChild(A1, 5, 5).id;
    const B1 = E.lm.cellChild(B, 1, 1).id, B11 = E.lm.cellChild(B1, 5, 5).id;
    for (const [f, n] of [[A, 5], [A1, 2], [A2, 2], [A11, 2], [B, 3], [B1, 2], [B11, 2]]) rects(E, f, n);
    E._render();
    const n0 = E.lm.frames.size;
    E._setSelection([], [A]);
    const p = E._levelPointToScreen(A, 0, 0);
    E.setTool("select");
    E.pointerDown(p[0], p[1]); E.pointerMove(p[0] + 32, p[1]); E.pointerMove(p[0] + 64, p[1]); E.pointerUp();
    E._render();
    if (oracle) for (const id of [B, B1, B11]) if (E.lm.frame(id)) E.doc.at(id);   // the oracle merges at a read
    const n1 = E.lm.frames.size;
    (oracle ? oCollect : collectFrames)(E);
    if (!oracle) sweepFrames(E);
    const n2 = E.lm.frames.size;
    const groups = oracle ? 0 : [...E.lm.frames.values()].filter((f) => f._shadows && f._shadows.size).length;
    const lists = [A, A1, A2, A11, B, B1, B11].map((f) => (E.lm.frame(f) ? E.doc.count(f) : "gone"));
    return { before: n0, afterDrop: n1, afterGc: n2, coresidentGroups: groups, lists };
}
test("census", () => {
    log("DROP-ONTO-CENSUS " + JSON.stringify({ live: run(false), oracle: run(true) }));
});
