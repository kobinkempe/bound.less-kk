// B-MODEL-C34 scratch probe (deleted before hand-back): the list build (`stage.sync`) over scenario 1's zoom on the dense drawing.
import KobinEngine from "./KobinEngine";

const { synth } = require("../../tools/harnesses/synth-drawing");
jest.setTimeout(900000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

test("list build over a zoom out and back on the dense drawing", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1280, height: 800, scenes: false });
    const snap = synth({ seed: 1, w: 1280, h: 800 });
    delete snap.stats;
    E.loadSnapshot(snap);
    E.flushBakes();
    if (E.flushErases) E.flushErases();
    E.cam.set({ frame: "2", activeLevel: E.lm.depthOf("2"), inScale: 1, inPanX: 640, inPanY: 400 });
    E._render();
    E.renderer.render = () => {}; E.renderer.update = () => {};          // the engine's side alone: the list
    const sync = E.stage.sync.bind(E.stage);
    const t = { sync: 0, syncN: 0, render: 0, renders: 0 };
    E.stage.sync = (...a) => { const a0 = now(); const r = sync(...a); t.sync += now() - a0; t.syncN++; return r; };
    const prof = new Map();
    const wrap = (obj, name, label) => {
        const f = obj[name];
        if (typeof f !== "function") return;
        obj[name] = function (...a) { const a0 = now(); try { return f.apply(this, a); } finally { const p = prof.get(label) || { ms: 0, n: 0 }; p.ms += now() - a0; p.n++; prof.set(label, p); } };
    };
    wrap(E.store, "_bakeUp", "bakeUp"); wrap(E.store, "_bakeDown", "bakeDown"); wrap(E.store, "_downSources", "downSources");
    wrap(E.store, "_ringNatives", "ringNatives"); wrap(E.store, "_rerouteGroups", "reroute"); wrap(E.lm, "childrenOf", "childrenOf");
    wrap(E.lm, "framePath", "framePath"); wrap(E.stage.model, "nativesIn", "nativesIn"); wrap(E.stage.model, "placement", "placement");
    wrap(E.lm, "peekRing", "peekRing"); wrap(E.doc, "cellList", "cellList"); wrap(E.lm, "sameCell", "sameCell");
    const zoom = (f, n) => { for (let k = 0; k < n; k++) { E.zoomFactorAt(640, 400, f); const a0 = now(); E._render(); t.render += now() - a0; t.renders++; } };
    const a0 = now();
    zoom(0.9, 90);
    zoom(1 / 0.9, 90);
    t.total = now() - a0;
    // The same zoom again, its tiles cached: the list's own cost.
    const s0 = t.sync, n0 = t.syncN, b0 = now();
    for (const v of prof.values()) { v.ms0 = v.ms; v.n0 = v.n; }
    zoom(0.9, 90);
    zoom(1 / 0.9, 90);
    t.warm = { sync: Math.round(t.sync - s0), syncN: t.syncN - n0, total: Math.round(now() - b0) };
    t.warmProf = {};
    for (const [k, v] of prof) t.warmProf[k] = [Math.round(v.ms - v.ms0), v.n - v.n0];
    const p = {};
    for (const [k, v] of prof) p[k] = [Math.round(v.ms), v.n];
    log("LIST " + JSON.stringify({ sync: Math.round(t.sync), syncN: t.syncN, total: Math.round(t.total), warm: t.warm, warmProf: t.warmProf, frames: E.lm.frames.size, prof: p }));
    E.destroy(); host.remove();
});
