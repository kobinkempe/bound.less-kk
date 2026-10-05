/* Scratch probe (R-MODEL-C34; deleted before hand-back): seed 777's frames left after the D2 census drag and its GC, live
 * against the oracle, by place (R-DRAG's skipped item). The fixture is move.drop.test.js D2's. */
import { useEngines, mkEngine } from "./__testkit__/harness";
import OracleEngine from "./__oracles__/model-v1/KobinEngine";
import { placeOf } from "./__testkit__/modelFuzz";
import { rectLoop } from "./geometry/arcShape";

useEngines();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const lcg = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const shapeAt = (E, frame, x, y, w, h) => { const o = { type: "shape", origin: "native", id: E.doc.allocId(), color: "#123", opacity: 1, w: 8, loops: rectLoop({ left: x, top: y, right: x + w, bottom: y + h }) }; E.doc.add(o, frame); return o; };
const rects = (E, frame, n, seed) => { for (let i = 0; i < n; i++) { const x = ((i * 7919 + seed) % 40000) - 20000, y = ((i * 104729 + seed) % 40000) - 20000; shapeAt(E, frame, x, y, 50 + (i % 900), 40); } };
function fixture(oracle, seed) {
    const rnd = lcg(seed);
    const E = oracle ? new OracleEngine(document.body.appendChild(document.createElement("div")), { width: 800, height: 600, scenes: false }) : mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const R = E.lm.cellChild("1", 5, 5);
    rects(E, R.id, 50, 1);
    for (let a = 0; a < 6; a++) {
        const K = E.lm.cellChild(R.id, Math.round((rnd() - 0.5) * 4000), Math.round((rnd() - 0.5) * 4000));
        rects(E, K.id, 50, 10 + a);
        for (let b = 0; b < 3; b++) rects(E, E.lm.cellChild(K.id, Math.round((rnd() - 0.5) * 4000), Math.round((rnd() - 0.5) * 4000)).id, 50, 100 + 10 * a + b);
    }
    E._render();
    const before = new Set(E.lm.frames.keys());
    E._setSelection([], [R.id]);
    E.setTool("select");
    const p = E._levelPointToScreen(R.id, 0, 0);
    E.pointerDown(p[0], p[1]);
    let x = p[0], y = p[1];
    for (let s = 0; s < 40; s++) { x += (rnd() - 0.3) * 7; y += (rnd() - 0.4) * 7; E.pointerMove(x, y); E._render(); }
    E.pointerUp();
    E._render();
    const fresh = [...E.lm.frames.values()].filter((f) => !before.has(f.id))
        .map((f) => placeOf(E, f.id) + " n" + E.doc.count(f.id) + " kids" + (f._kids ? f._kids.size : 0) + (f.shadowOf != null ? " co" : "") + " id " + f.id).sort();
    const gone = [...before].filter((id) => !E.lm.frame(id));
    return { fresh, gone };
}
test("seed 777's frames after the drop and GC", () => {
    for (const seed of [777, 12345, 4242]) log("C777 " + seed + " " + JSON.stringify({ live: fixture(false, seed), oracle: fixture(true, seed) }, null, 1));
});
