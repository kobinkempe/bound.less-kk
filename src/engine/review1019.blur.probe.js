/**
 * review1019.blur.probe.js — Kobin's two F145 reports of 2026-10-19: 14:35, a drag of [3326] ("what was already rendered
 * on screen became blurry"), and 14:38, a drag of [2344], a massive object behind everything ("everything on screen
 * became blurry, even though the image wasn't even changing"); R3 and R4 (2026-10-07) beside them. Each report's whole
 * drawing in a raster jsdom engine at its camera, screen and dpr, on the desktop cap; the plane's cut per layer (kind, k,
 * cells), each run's cells, BELOW's cells that hold ink of its own (the rest are paper), and the cut each rule would take:
 * the order (the selection on screen first, as built, or BELOW and OVER first), the plate cap, BELOW's paper cells
 * without plates, and the compose cliff (30 images with one scaled) or none. A probe, not a suite.
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/review1019.blur.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { planeStats, resetPlaneStats } from "./raster/MovePlane";
import { paintFamilies } from "./raster/rasterPack";
import { PLATE_PX } from "./raster/plate";

jest.setTimeout(30 * 60 * 1000);
const OUT = path.join(REPORT_DIR, "..", ".claude", "REVIEW-2026-10-06", "moves");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const note = (k, v) => { out.push({ k, v }); console.log(k, JSON.stringify(v)); };   // eslint-disable-line no-console
const engines = [];
afterEach(() => { while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); } });
afterAll(() => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "blur1019-" + (process.env.PROBE_TAG || "run") + ".json"), JSON.stringify(out, null, 1)); });

// [name, report, a zoom to set about the screen's centre (null: the report's camera)]
const CASES = [
    ["first", "report-2026-10-19T14-35-43-033Z.json", null],
    ["massive", "report-2026-10-19T14-38-34-523Z.json", null],
    ["R3", "report-2026-10-07T03-19-33-862Z.json", null],
    ["R4", "report-2026-10-07T03-24-11-129Z.json", 2.7029],
];
const ORDERS = {
    sel: (f) => { for (let n = 0; n <= 3; n++) for (let b = 0; b <= 3; b++) for (let m = n; m <= 3; m++) f([b, n, m]); },
    below: (f) => { for (let b = 0; b <= 3; b++) for (let n = 0; n <= 3; n++) for (let m = n; m <= 3; m++) f([b, n, m]); },
};

async function idle(E, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        await sleep(5);
        const r = E.renderer.queue.report();
        if (!r.queued.some((n) => n) && !r.inFlight.some((n) => n) && E.renderer._planeTimer == null) return Date.now() - t0;
    }
    return -1;
}

async function mk(file, zoom) {
    resetRasterWorkerClient(); resetPlaneStats();
    Object.defineProperty(window, "screen", { value: { width: 2560, height: 1440 }, configurable: true, writable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true, writable: true });
    setRasterTransport(null); setRasterWorkerCount(1);
    const full = path.join(REPORT_DIR, file), rep = readReportFile(full), parts = drawingPartsOf(full);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scr = rep.extract.screen;
    const E = new KobinEngine(host, { width: scr.w, height: scr.h, raster: true });
    engines.push({ E, host });
    loadReport(E, rep, { drawing: parts });
    if (zoom) {
        const c = E.cam, cx = E.width / 2, cy = E.height / 2, px = (cx - c.inPanX) / c.inScale, py = (cy - c.inPanY) / c.inScale;
        c.inScale = zoom; c.inPanX = cx - px * zoom; c.inPanY = cy - py * zoom;
    }
    E._render();
    await idle(E);
    return { E, rep };
}

describe("Kobin's F145 reports of 2026-10-19", () => {
    for (const [name, file, zoom] of CASES) {
        test(name, async () => {
            const { E, rep } = await mk(file, zoom);
            const R = E.renderer, pl = R._plane;
            let cap = null;
            const count = pl._count.bind(pl);
            pl._count = (runs, view, ks, C) => { if (!cap || cap.runs !== runs) cap = { runs, view, C }; return count(runs, view, ks, C); };
            const sel = rep.moves.selection;
            E.setTool("select");
            E._setSelection(sel.ids, sel.frames || []);
            E._render();
            const t0 = Date.now();
            while (Date.now() - t0 < 20000 && !(pl.main && pl.checkReady(E.plates))) await sleep(10);
            const v = R._view;
            note(name + ".view", { mode: v.mode, Zq: +v.Zq.toFixed(4), s: +v.s.toFixed(4), n: (v.i1 - v.i0 + 1) * (v.j1 - v.j0 + 1), cap: R.planeCap, sel: sel.ids, aimMs: Date.now() - t0, ready: pl.ready });
            if (!pl.main) { note(name + ".refused", { refused: pl.refused }); return; }
            const lv = (L) => L && { k: L.k, kOn: L.kOn, plates: L.plates, frame: L.frame, layers: L.layers.map((x) => [x.kind + (x.hole ? "m" : ""), x.k, x.cells.length, x.paper ? x.paper.length : undefined, x.ids ? x.ids.size : x.omit.size]) };
            note(name + ".cut", { surfaces: R.pyramid.planeSurfaces, main: lv(pl.main), quick: lv(pl.quick), stats: { coarse: planeStats.coarse, merged: planeStats.merged, maxLayers: planeStats.maxLayers } });
            // as in Chrome: a 2D canvas can be made, so each layer is one surface and no cut is bounded by the image cliff
            R.layer._mk = (w, h) => ({ width: w, height: h, getContext: () => ({}) });
            pl.list = null; cap = null;
            R._aimPlane(R._view);
            note(name + ".cutSurf", { surfaces: R.pyramid.planeSurfaces, main: lv(pl.main), quick: lv(pl.quick) });
            const { runs, view, C } = cap;
            note(name + ".runs", runs.map((r, n) => ({ sel: r.sel, ids: r.ids.size, on0: C.on(n, 0).size, grown0: C.grown(n, 0).size })));
            // BELOW's own ink: the families no run holds, at each k on BELOW's cells
            const inRuns = new Set();
            for (const r of runs) for (const id of r.ids) inRuns.add(id);
            const boxes = [];
            for (const f of paintFamilies(pl.list, 0, view.Zq, R.layer.dpr, E.cfg)) {
                if (f.all.some((d) => inRuns.has(d.o.id)) || (f.all.length && f.all.every((d) => d.o.erase))) continue;
                for (const d of f.all) boxes.push(d.box);
            }
            const own = (k) => {
                const s = view.Zq / 2 ** k / PLATE_PX, u = C.under(k), o = new Set();
                for (const b of boxes) {
                    for (let j = Math.floor(b[1] * s); j <= Math.floor(b[3] * s); j++) {
                        for (let i = Math.floor(b[0] * s); i <= Math.floor(b[2] * s); i++) { const c = i + "," + j; if (u.has(c)) o.add(c); }
                    }
                }
                return o;
            };
            const ownN = [0, 1, 2, 3].map((k) => own(k).size);
            note(name + ".below", { cells0: C.under(0).size, ownInk: ownN });
            const countP = (x, paper) => {
                const c = count(runs, view, x, C);
                if (!paper) return c;
                const d = C.under(x[0]).size - ownN[x[0]];
                return { plates: c.plates - d, frame: c.frame - d, scaled: c.scaled };
            };
            const choose = (order, capN, paper, cliff) => {
                const fits = (x) => { const c = countP(x, paper); return c.plates <= capN && (!c.scaled || c.frame <= cliff); };
                let ku = 0;
                while (ku < 3 && !fits([ku, ku, ku])) ku++;
                let ks = null;
                ORDERS[order]((x) => { if (!ks && x.every((k) => k <= ku) && fits(x)) ks = x; });
                if (!ks) ks = [ku, ku, ku];
                const c = countP(ks, paper);
                return ks.join("") + " " + c.plates + "p/" + c.frame + "f";
            };
            const table = {};
            for (const order of ["sel", "below"]) {
                for (const paper of [false, true]) {
                    for (const cliff of [30, Infinity]) {
                        table[order + (paper ? "+paper" : "") + (cliff === 30 ? "" : " nocliff")] = [40, 64, 96].map((n) => choose(order, n, paper, cliff)).join(" | ");
                    }
                }
            }
            note(name + ".choose", table);
        });
    }
});
