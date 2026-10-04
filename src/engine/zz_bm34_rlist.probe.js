// B-MODEL-C34 scratch probe (deleted before hand-back): the raster path's list build (`stage.sync`, `stage.snapshot`)
// over scenario 1's zoom on the dense drawing, the pool parked (no pack runs).
import KobinEngine from "./KobinEngine";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";

const { synth } = require("../../tools/harnesses/synth-drawing");
jest.setTimeout(1800000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

test("raster list build over a zoom out and back on the dense drawing", () => {
    resetRasterWorkerClient(); setRasterWorkerCount(1);
    setRasterTransport(() => new Promise(() => {}));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1280, height: 800, raster: true, scenes: false });
    const snap = synth({ seed: 1, w: 1280, h: 800 });
    delete snap.stats;
    E.loadSnapshot(snap);
    E.flushBakes();
    if (E.flushErases) E.flushErases();
    E.cam.set({ frame: "2", activeLevel: E.lm.depthOf("2"), inScale: 1, inPanX: 640, inPanY: 400 });
    E._render();
    const t = { sync: 0, syncN: 0, snap: 0, snapN: 0, snapNull: 0, maxSync: 0 };
    const sync = E.stage.sync.bind(E.stage), sn = E.stage.snapshot.bind(E.stage);
    E.stage.sync = (...a) => { const a0 = now(); const r = sync(...a); const d = now() - a0; t.sync += d; t.syncN++; if (d > t.maxSync) t.maxSync = d; return r; };
    E.stage.snapshot = (...a) => { const a0 = now(); const r = sn(...a); t.snap += now() - a0; t.snapN++; if (!r) t.snapNull++; return r; };
    let bakes = 0, bakeMs = 0;
    for (const name of ["_bakeUp", "_bakeDown"]) {
        const f = E.store[name].bind(E.store);
        E.store[name] = (...a) => { const a0 = now(); try { return f(...a); } finally { bakes++; bakeMs += now() - a0; } };
    }
    const zoom = (f, n) => { for (let k = 0; k < n; k++) E.zoomFactorAt(640, 400, f); };
    const pass = () => {
        const s0 = { ...t }, b0 = bakes, m0 = bakeMs, a0 = now();
        t.maxSync = 0;
        zoom(0.9, 90); zoom(1 / 0.9, 90);
        E._render();
        return { ms: Math.round(now() - a0), sync: Math.round(t.sync - s0.sync), syncN: t.syncN - s0.syncN, maxSync: Math.round(t.maxSync),
            snap: Math.round(t.snap - s0.snap), snapN: t.snapN - s0.snapN, snapNull: t.snapNull - s0.snapNull, bakes: bakes - b0, bakeMs: Math.round(bakeMs - m0) };
    };
    const cold = pass(), warm = pass();
    log("RLIST " + JSON.stringify({ cold, warm, frames: E.lm.frames.size }));
    E.destroy(); host.remove();
    setRasterTransport(null); resetRasterWorkerClient();
});
