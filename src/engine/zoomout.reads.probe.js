/**
 * zoomout.reads.probe.js — why the far prefetch's off-camera reads never complete on the Magnum Opus (F166): at the
 * deepest native frame on Kobin's undo path, every far step's snapshot is tried with the plan's 8 ms budget a few
 * times, then without a budget; per step: the frame, the rect's tiles, whether the source frames were minted
 * (`displaced().missing`), and each read's tiles read and missing. A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/zoomout.reads.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { bboxOf } from "./geometry/derive";
import { prefetchPlan } from "./raster/prefetch";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);

test("the far prefetch's reads on the Magnum Opus", async () => {
    const f = path.join(REPORT_DIR, "report-2026-10-20T15-54-32-768Z.json");
    const rep = readReportFile(f), parts = drawingPartsOf(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true, scenes: false });
    loadReport(E, rep, { drawing: parts });
    const frames = E.doc.levels().map((id) => ({ id, d: E.lm.depthOf(id), n: E.doc.count(id) })).filter((x) => x.d != null && x.n >= 20).sort((a, b) => b.d - a.d || b.n - a.n);
    const S0 = frames[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of E.doc.list(S0.id)) { const b = bboxOf(o); if (!(b.x1 > b.x0)) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    E.jumpTo(S0.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    E._render();
    const st = E.stage, ts = st.store, view = E.renderer.pyramid._v;
    log(`at ${E.cam.frame} depth ${E.cam.activeLevel} inScale ${E.cam.inScale.toFixed(3)}; view level ${view.level}; tiles cached ${ts.cache ? ts.cache.size : "?"}`);
    // The steps the plan reads: its own snapshot calls, recorded.
    const calls = [];
    const fake = { ...st, lm: st.lm, covers: st.covers.bind(st), snapshot: (F, rect, budget) => { calls.push({ F, rect }); return null; } };
    prefetchPlan(view, fake, E.plates, { ...E.cfg, gens: { prefetch: 0 } });
    log(`the plan reads ${calls.length} rects`);
    for (const c of calls) {
        const range = st.lm.tileRange(st.lm.frameFor(c.F).id, c.rect), nt = (range.i1 - range.i0 + 1) * (range.j1 - range.j0 + 1);
        const d = st.model.displaced(String(st.lm.frameFor(c.F).id));
        const tries = [];
        for (let k = 0; k < 4; k++) {
            const t0 = Date.now(), m0 = ts.overBudget || 0;
            const ok = !!st.snapshot(c.F, c.rect, 8);
            tries.push({ ok, ms: Date.now() - t0, over: (ts.overBudget || 0) - m0 });
            if (ok) break;
        }
        const t0 = Date.now(), r = ts.read(c.F, c.rect, Infinity), ms = Date.now() - t0;
        const t1 = Date.now(), full = !!st.snapshot(c.F, c.rect, Infinity), ms1 = Date.now() - t1;
        log(`  ${String(c.F).slice(-24)} depth ${st.lm.depthOf(c.F)} tiles ${nt} (x2 dirs) groups ${d.groups ? d.groups.size : "?"} missing ${!!d.missing}; 8ms tries ${JSON.stringify(tries)}; unbounded read ${ms} ms complete ${r.complete} (${r.tiles.length} read, ${r.missing.length} missing); unbounded snapshot ${full} ${ms1} ms`);
    }
    E.destroy();
});

test("the camera's table after each crossing of a zoom-out on the Magnum Opus", async () => {
    const f = path.join(REPORT_DIR, "report-2026-10-20T15-54-32-768Z.json");
    const rep = readReportFile(f), parts = drawingPartsOf(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true, scenes: false });
    loadReport(E, rep, { drawing: parts });
    const frames = E.doc.levels().map((id) => ({ id, d: E.lm.depthOf(id), n: E.doc.count(id) })).filter((x) => x.d != null && x.n >= 20).sort((a, b) => b.d - a.d || b.n - a.n);
    const S0 = frames[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of E.doc.list(S0.id)) { const b = bboxOf(o); if (!(b.x1 > b.x0)) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    E.jumpTo(S0.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    E._render();
    const st = E.stage, ts = st.store;
    // Tile derivations, counted and timed.
    const der = { n: 0, ms: 0 };
    for (const m of ["_ensureUp", "_ensureDown"]) { const o = ts[m].bind(ts); ts[m] = (...a) => { const t0 = Date.now(); try { return o(...a); } finally { der.n++; der.ms += Date.now() - t0; } }; }
    let last = String(E.cam.frame);
    for (let k = 0; k < 400 && !(E.cam.activeLevel === 0 && E.cam.inScale < 0.3); k++) {
        E.zoomFactorAt(903, 535, 0.5);
        if (String(E.cam.frame) === last) continue;
        last = String(E.cam.frame);
        const win = E._listWin(), F = String(E.cam.frame);
        const covered0 = st.covers(F, win), d = st.model.displaced(F);
        let steps = 0;
        const n0 = der.n, m0 = der.ms;
        while (!st.covers(F, win) && steps < 2000) { st.sync(F, win, 4); steps++; }          // the moving camera's STEP_READ_MS a frame
        const stepDer = der.n - n0, stepMs = der.ms - m0;
        log(`  crossed into depth ${E.cam.activeLevel} (inScale ${E.cam.inScale.toFixed(1)}): covered at once ${covered0}; groups ${d.groups ? d.groups.size : "?"}; frames of 4 ms reads to cover ${steps}, tiles derived ${stepDer} in ${stepMs} ms; tiles cached ${ts.cache.size}`);
    }
    E.destroy();
});
