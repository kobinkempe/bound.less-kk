// B-MODEL-C34 scratch probe (deleted before hand-back): cold tile reads of the dense drawing's views, three times each.
import KobinEngine from "./KobinEngine";

const { synth } = require("../../tools/harnesses/synth-drawing");
jest.setTimeout(900000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

test("cold reads", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1280, height: 800, scenes: false });
    E.renderer.render = () => {}; E.renderer.update = () => {};
    const snap = synth({ seed: 1, w: 1280, h: 800 });
    delete snap.stats;
    E.loadSnapshot(snap);
    E.flushBakes();
    if (E.flushErases) E.flushErases();
    let natives = 0;
    for (const L of E.doc.levels()) natives += E.doc.count(L);
    const out = { natives, frames: E.lm.frames.size, views: {} };
    for (const F of ["0", "1", "2"]) {
        E.cam.set({ frame: F, activeLevel: E.lm.depthOf(F), inScale: 1, inPanX: 640, inPanY: 400 });
        const win = E._listWin();
        const ms = [];
        let pieces = 0;
        for (let k = 0; k < 3; k++) {
            E.store.bumpEpoch();
            const a = now();
            const r = E.store.read(F, win);
            ms.push(Math.round(now() - a));
            pieces = 0;
            for (const t of r.tiles.values ? r.tiles.values() : r.tiles) pieces += (t.objs || (t[1] && t[1].objs) || []).length;
        }
        out.views[F] = { ms, pieces };
    }
    log("BAKE " + JSON.stringify(out));
    E.destroy(); host.remove();
});
