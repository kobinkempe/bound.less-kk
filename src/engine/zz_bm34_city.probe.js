// B-MODEL-C34 scratch probe (deleted before hand-back): why a city frame is read one by one.
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import { G } from "./frameLattice";

useEngines();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const lasso = (E, pts) => { E.setTool("select"); E.pointerDown(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]); E.pointerUp(); };

test("city", () => {
    const N = 4;
    const E = mkEngine();
    drawStroke(E, [[100, 300], [700, 300]], 200);
    for (let i = 0; i < 6; i++) E.zoomFactorAt(400, 300, 16);
    const cam = E.cam.state(), F2 = E.cam.frame;
    const c = E.cam.screenToFrame(400, 300), ci = Math.round(c[0] / G) - N / 2, cj = Math.round(c[1] / G) - N / 2;
    const cells = [];
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
        const [x, y] = E.cam.levelPointToScreen(F2, (ci + a) * G, (cj + b) * G);
        for (let i = 0; i < 3; i++) E.zoomFactorAt(x, y, 16);
        cells.push(E.cam.frame);
        for (let k = 0; k < 3; k++) E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: -900 + k * 700, top: -400, right: -500 + k * 700, bottom: 300 }), color: "#246", opacity: 1, w: 6 }, E.cam.frame);
        erase(E, [[x - 30, y - 30], [x + 30, y + 30]], 10);
        E.cam.set(cam); E._render();
    }
    E.deselect();
    const m = G / 2 + 6;
    const lo = E.cam.levelPointToScreen(F2, ci * G - m, cj * G - m), hi = E.cam.levelPointToScreen(F2, (ci + N - 1) * G + m, (cj + N - 1) * G + m);
    let torn = null;
    const tu = E._tornUnder.bind(E);
    E._tornUnder = (...a) => { const r = tu(...a); torn = r; return r; };
    lasso(E, [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]], [lo[0], lo[1] + 2]]);
    const s = E.selection || { ids: [], frames: [] };
    const out = [];
    for (const F of cells) {
        const f = E.lm.frame(F);
        const keyed = [...(E.doc.keyedIn(F) || [])].map((o) => (o.erase ? "mark" : "k") + o.id + (o.attachRect ? "a" : ""));
        const grp = E.lm.cellFrames(F).map((g) => g.id.split("/").slice(-1)[0] + (g.private != null ? "P" : "") + ":" + E.doc.count(g.id) + (g.parent === f.parent ? "" : "^" + g.parent.split("/").slice(-1)[0]));
        const kids = E.lm.childrenOf(F).map((k) => k.id.split("/").slice(-1)[0] + (k.private != null ? "P" : "") + ":" + E.doc.count(k.id));
        out.push(F.split("/").slice(-1)[0] + " sel " + s.frames.includes(F) + " n " + E.doc.count(F) + " keyed [" + keyed.join(",") + "] grp [" + grp.join(" ") + "] kids [" + kids.join(" ") + "] torn " + (torn ? torn.has(F) : "-"));
    }
    log("CITY ids " + s.ids.length + " frames " + s.frames.length + " torn " + (torn ? [...torn].map((x) => x.split("/").slice(-1)[0]).join(",") : "none") + "\n" + out.join("\n"));
});
