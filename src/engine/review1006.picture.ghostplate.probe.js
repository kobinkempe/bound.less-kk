/**
 * review1006.picture.ghostplate.probe.js — PERF's gap state (R3: a drop, its frame GC, a 3 px pan; see
 * `review1006.perf.gcgap.probe.js`): for each ghost (a displaced native whose picture-source frame is missing, drawn by the
 * Stage at its stored place with zero offset), one view-level plate over its stored place is packed and rendered IN the
 * gap; then the next render re-mints the frames; is that plate still exact (nothing dirtied it), and does it differ from
 * the same cell packed from the settled table? A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.ghostplate.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { levelCell } from "./raster/PyramidStore";
import { zOf } from "./raster/level";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(4); setRasterTransport(() => new Promise(() => {})); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test("R3 gap: a plate packed over a ghost, then the re-mint", () => {
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-19-33-862Z.json");
    const rep = readReportFile(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true });
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E.setTool("select");
    E._render(); E.sweepFrames();
    E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
    E._render();
    const sx = E.width / 2, sy = E.height / 2;
    E._dragSel = { start: [sx, sy], moved: false };
    E._beginHold();
    for (let k = 1; k <= 10; k++) E._dragSelection(sx + 6 * k, sy + 4 * k);
    E._pointerUp();
    E.panBy(3, 0);                                                         // PERF's gap: the reroute re-diffed, no render
    const F = String(E.cam.frame), pyr = E.renderer.pyramid, v = pyr._v, S = v.S, l = v.level, Z = zOf(l, S);
    const miss = E.store._rerouteGroups(F).miss;
    const ghosts = E.stage.items().filter((it) => miss.has(it.id) && !it.off[0] && !it.off[1]);
    log(`gap: frame ${F} view ${v.mode} ℓ${l}; ghosts ${ghosts.length} (natives ${new Set(ghosts.map((g) => g.id)).size}); G ${E.stage.generation}`);
    // One plate per ghost: the ℓ cell under the middle of its stored box, packed and rendered now (renderNow = the inline path).
    const plates = [];
    for (const it of ghosts) {
        const b = it.box, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
        const i = Math.floor((cx * Z) / 512), j = Math.floor((cy * Z) / 512);
        if (plates.some((p) => p.i === i && p.j === j)) continue;
        const c = levelCell(F, l, S, i, j);
        const job = pyr._job("view", 1, { frame: F, level: l, S, Z, cells: [c], purpose: "view", gen: pyr.gens.view });
        const recs = pyr.renderNow(job);
        const rec = E.plates.get(c.key);
        plates.push({ id: it.id, color: it.color, i, j, key: c.key, G: rec ? rec.G : null, px: rec && rec.pixels ? rec.pixels.slice() : null, landed: recs.length });
    }
    log(`packed in the gap: ${plates.length} plates; with pixels ${plates.filter((p) => p.px).length}; G of each ${JSON.stringify(plates.map((p) => p.G))}`);
    // The re-mint, and what the commit dirtied.
    const G0 = E.stage.generation;
    E._render();
    const miss2 = E.store._rerouteGroups(F).miss.size;
    let stillExact = 0, dirtied = 0;
    for (const p of plates) { const r = E.plates.get(p.key); if (!r) continue; if (E.plates.exact(r)) stillExact++; else dirtied++; }
    log(`after the render (re-mint): G ${G0} -> ${E.stage.generation}; missing sources ${miss2}; of the gap's plates still stored: exact ${stillExact}, dirtied ${dirtied}`);
    // The settled picture of the same cells: packed again from the settled table (a newer G replaces the stored one).
    let differ = 0, maxPx = 0;
    for (const p of plates) {
        const c = levelCell(F, l, S, p.i, p.j);
        E.plates.dropWhere((r) => r.key === c.key);
        const job = pyr._job("view", 1, { frame: F, level: l, S, Z, cells: [c], purpose: "view", gen: pyr.gens.view });
        pyr.renderNow(job);
        const r = E.plates.get(c.key), q = r && r.pixels;
        let n = 0;
        if (p.px && q) for (let k = 0; k < q.length; k += 4) if (Math.abs(q[k] - p.px[k]) + Math.abs(q[k + 1] - p.px[k + 1]) + Math.abs(q[k + 2] - p.px[k + 2]) > 24) n++;
        else if (!!p.px !== !!q) n = -1;
        if (n) differ++;
        maxPx = Math.max(maxPx, n);
        log(`  ghost ${p.id} ${p.color}: cell ${p.i},${p.j} — gap plate vs settled plate: ${n < 0 ? "one is empty, the other not" : n + " px differ"}`);
    }
    log(`plates over a ghost that differ from the settled picture: ${differ} of ${plates.length} (worst ${maxPx} px of 262,144)`);
    E.destroy();
});
