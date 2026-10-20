/**
 * review1014.f157.probe.js — F157 at a report's camera (R6, the Magnum Opus at depth 10, by default): per screen plate,
 * the families the core's occlusion cull skips, what its cover is made of, and the items and bytes packed under it —
 * what a pack-time cover test could leave out at most. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1014.f157.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";
import { packJob } from "./raster/rasterPack";
import { renderPlate, occStats, TW, TH } from "./raster/rasterCore";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(40 * 60 * 1000);
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gate() {
    const parked = [];
    const g = { parked };
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    g.answer = async () => { let n = 0; while (parked.length) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); n++; } for (let t = 0; t < 3; t++) await tick(); return n; };
    return g;
}
async function settle(E, n = 2) { for (let k = 0; k < n; k++) { E.renderer.syncCameraOnly(); for (let m = 0; m < 4; m++) await tick(); } }
function busy(E, g) { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); }
async function drain(E, g, rounds = 8) {
    for (let round = 0; round < rounds; round++) {
        let did = 0;
        for (let k = 0; k < 600 && busy(E, g); k++) { did += await g.answer(); await settle(E, 1); }
        await sleep(180); await settle(E, 2);
        if (!busy(E, g) && did === 0) return round;
    }
    return rounds;
}

test("F157 at a report's camera: the core's covers, and what is packed under them", async () => {
    const name = process.env.REPORT || "report-2026-10-07T03-39-00-036Z.json";
    resetRasterWorkerClient(); setRasterWorkerCount(4);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true, writable: true });
    Object.defineProperty(window, "screen", { value: { width: 2560, height: 1440 }, configurable: true, writable: true });
    const g = gate();
    const f = path.join(REPORT_DIR, name);
    const rep = readReportFile(f);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: rep.extract.screen.w, height: rep.extract.screen.h, raster: true });
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    E.lm.forget = () => false;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
    E.setTool("select");
    E._render();
    await drain(E, g, 4);
    const R = E.renderer, v = R._view, list = R._sceneList(), cfg = R.cfg, dpr = R.pyramid.dpr, Zq = v.Zq;
    const byId = new Map();
    for (const o of list) if (!byId.has(o.id)) byId.set(o.id, o);
    const out = new Uint8ClampedArray(TW * TH * 4), counts = new Uint32Array(8);
    const rows = [], kinds = {};
    let items = 0, bytes = 0, skipped = 0, underItems = 0, underBytes = 0;
    for (let j = v.j0; j <= v.j1; j++) {
        for (let i = v.i0; i <= v.i1; i++) {
            const plates = Int32Array.from([i, j]), opts = { plates, Zq, dpr, cfg, paper: [255, 255, 255] };
            const a = packJob(list, opts);
            const s0 = occStats.occluded;
            renderPlate(a, 0, out, counts);
            const sk = occStats.occluded - s0;
            // the cover: the job's families in order; the core skipped the first `sk`
            const fams = [];
            for (let k = 0; k < a.nItems;) { const fm = a.meta[k * 8 + 1]; let e = k; while (e + 1 < a.nItems && a.meta[(e + 1) * 8 + 1] === fm) e++; fams.push([k, e]); k = e + 1; }
            let cover = null;
            for (let q = 0; q < sk && q < fams.length; q++) for (let k = fams[q][0]; k <= fams[q][1]; k++) { underItems++; underBytes += a.meta[k * 8 + 3] * 8 + a.meta[k * 8 + 5] * 4 + 107; }
            if (sk > 0 && fams[sk]) {
                cover = [];
                for (let k = fams[sk][0]; k <= fams[sk][1]; k++) {
                    const o = byId.get(a.ids[k]);
                    cover.push({ id: a.ids[k], type: o ? o.type : "?", origin: o ? o.origin : "?", covers: !!(o && o.covers), union: !!(a.meta[k * 8 + 6] & 4),
                        alpha: +a.attr[k * 9 + 7].toFixed(2), geomLen: a.meta[k * 8 + 3], subs: a.meta[k * 8 + 5] });
                }
                const key = cover.map((c) => c.type + (c.covers ? "+covers" : "") + (c.union ? "+union" : "")).join(",") + " ×" + cover.length;
                kinds[key] = (kinds[key] || 0) + 1;
            }
            items += a.nItems; bytes += a.geom.byteLength; skipped += sk;
            rows.push({ i, j, items: a.nItems, famsSkippedByCore: sk, cover: cover && cover.slice(0, 3) });
        }
    }
    log(JSON.stringify({ report: name, view: { level: v.level, Zq, cells: rows.length }, list: list.length,
        items, geomKB: Math.round(bytes / 1024), underTheCoresCover: { items: underItems, KB: Math.round(underBytes / 1024) }, famsSkippedByCore: skipped, coverKinds: kinds }, null, 1));
    for (const r of rows) log(JSON.stringify(r));
    E.destroy && E.destroy();
});
