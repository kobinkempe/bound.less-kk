/**
 * scenes.first.probe.js — the scene index on the real Magnum Opus (SCENES-PLAN §7.6), in jsdom:
 * the first build of an old file (main-thread prep + index), the scene count and tree, the saved
 * state's size, a load from it, a pen-up, and moves of 2,000 objects, of a whole scene and of the
 * biggest scene. A probe: `*.probe.js` is outside the suites.
 *   CI=true NODE_OPTIONS=--max-old-space-size=10240 npx react-scripts test --watchAll=false --testMatch "**\/scenes.first.probe.js"
 */
import KobinEngine from "./KobinEngine";
import { SceneIndex } from "./sceneIndex";

const fs = require("fs");
const FILE = "C:/Users/Surface/Documents/Claude projects/Magnum Opus.boundless.json";
jest.setTimeout(30 * 60 * 1000);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const log = (...a) => console.log("[scenes]", ...a);   // eslint-disable-line no-console

test("the scene index on the Magnum Opus", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1504, height: 868, raster: false });
    const tl = Date.now();
    E.loadDrawing(JSON.parse(fs.readFileSync(FILE, "utf8")));
    log("load " + (Date.now() - tl) + " ms; old scenes " + (E.docMeta.scenes || []).length);
    const c = E._sceneClient;
    const old = (E.docMeta.scenes || []).map((s) => ({ id: s.id, name: s.name }));

    // 1. the first build (an old file: no index)
    const t0 = Date.now();
    const list = E.refreshScenes();
    const ms = Date.now() - t0;
    log(`first build ${ms} ms total: prep ${c.stats.prepMs.toFixed(0)} ms, index ${c.stats.lastApplyMs.toFixed(0)} ms; items ${c.stats.lastItems}; scenes ${list.length}`);
    log("index stats", JSON.stringify(c.stats.lastStats));
    const depths = {};
    for (const s of list) depths[s.depth] = (depths[s.depth] || 0) + 1;
    const roots = list.filter((s) => !s.parent);
    const sizes = list.map((s) => s.count).sort((a, b) => b - a);
    log("tree depths", JSON.stringify(depths), "roots", roots.length, "largest", sizes.slice(0, 8).join(","), "singletons", sizes.filter((n) => n === 1).length);
    const kept = list.filter((s) => old.some((o) => o.id === s.id && o.name === s.name));
    log("old scenes " + old.length + "; ids and names carried " + kept.length + ": " + kept.map((s) => s.name).join(" | "));
    log("old names not carried: " + old.filter((o) => !kept.some((s) => s.id === o.id)).map((o) => o.name).join(" | "));
    let maxKids = 0;
    const kids = {};
    for (const s of list) { const k = s.parent || "(top)"; kids[k] = (kids[k] || 0) + 1; maxKids = Math.max(maxKids, kids[k]); }
    log("most siblings under one parent", maxKids, "top-level", kids["(top)"] || 0);

    // 2. the saved state
    const ex = c.exportForSave();
    const bytes = JSON.stringify(ex).length;
    const mBytes = ex.scenes.reduce((a, s) => a + s.m.length, 0);
    log(`export ${bytes} bytes (${ex.scenes.length} scenes, member strings ${mBytes} bytes, ${ex.tomb.length} kept names)`);

    // 3. a load from it: every object filed straight in
    const ix = c.core;
    const frames = [...E.lm.frames.values()].map((f) => c._frameRec(f));
    const num = (x, k) => ix.XD[x.slot * 8 + k];   // 0 tx, 1 ty, 2 w (SceneIndex.XD)
    const items = [...ix.items.values()].map((x) => ({ id: x.id, home: x.home, w: num(x, 2), raw: ix._rawOf(x), t: [num(x, 0), num(x, 1)] }));
    const ix2 = new SceneIndex();
    const t2 = Date.now();
    const out2 = ix2.apply({ restore: { state: JSON.parse(JSON.stringify(ex)) }, frames, items });
    log(`restore from the saved state ${Date.now() - t2} ms (index ${out2.ms.toFixed(0)} ms), scenes ${out2.scenes.length}, same ids ${out2.scenes.every((s, i) => s.id === list[i].id)}`);

    // 4. pen-ups: a small mark beside existing ink, one batch each
    const pen = [];
    const some = [...ix.items.values()].filter((_, i) => i % 997 === 0).slice(0, 25);
    let nid = 10000000;
    for (const x of some) {
        const raw = ix._rawOf(x).slice(0, 5);
        raw[0] += num(x, 2) * 3; raw[2] += num(x, 2) * 3;
        const r = { id: nid++, home: x.home, w: num(x, 2), raw, t: [num(x, 0), num(x, 1)] };
        const o = ix.apply({ items: [r] });
        pen.push(o.ms);
    }
    log(`pen-up batch (index only): median ${med(pen).toFixed(2)} ms, max ${Math.max(...pen).toFixed(2)} ms over ${pen.length}`);

    // 5. moves: 2,000 objects of the biggest scene (a part), a whole mid-size scene, the biggest scene whole
    const byScene = [...ix.scenes].sort((a, b) => b.members.size - a.members.size);
    const big = byScene[0];
    const moveBy = (xs, d) => xs.map((x) => { const s = 2 ** (12 * (ix.frames.depth(x.home) - ix.frames.depth(big.anchor))); return { id: x.id, home: x.home, w: num(x, 2), t: [num(x, 0) + d * s, num(x, 1)] }; });
    const part = [...big.members].slice(0, Math.min(2000, big.members.size - 1));
    const T = big.frame.w;
    let o = ix.apply({ items: moveBy(part, T * 3) });
    log(`move ${part.length} of the biggest scene (${big.members.size}) 3 frames right: ${o.ms.toFixed(0)} ms, scenes changed ${o.changed.length}, queries ${o.stats.queries}, entries ${o.stats.entries}`);
    const mid = byScene.find((S) => S.members.size >= 20 && S.members.size <= 2000) || byScene[1];
    const n0 = ix.scenes.size;
    const spyCells = { n: 0 }; const cells = ix._cells.bind(ix); ix._cells = (...a) => { spyCells.n++; return cells(...a); };
    o = ix.apply({ items: moveBy([...mid.members], mid.frame.w * 0.25) });
    log(`move a whole scene (${mid.members.size} members): ${o.ms.toFixed(2)} ms, grid filings ${spyCells.n}, scenes ${n0} -> ${ix.scenes.size}`);
    spyCells.n = 0;
    const whole = byScene.find((S) => ix.scenes.has(S) && S !== mid) || big;
    o = ix.apply({ items: moveBy([...whole.members], whole.frame.w * 0.05) });
    log(`move the biggest remaining scene whole (${whole.members.size} members): ${o.ms.toFixed(1)} ms, grid filings ${spyCells.n}`);
    ix._cells = cells;
    const mem = process.memoryUsage();
    log(`heap ${(mem.heapUsed / 1048576).toFixed(0)} MB`);
    expect(list.length).toBeGreaterThan(0);
    E.destroy();
});
