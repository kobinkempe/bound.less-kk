/**
 * review1006.picture.drop.probe.js — Q4's "older" pictures: on Kobin's R5 canvas (extract), a drop of the purple family
 * at P (depth 5), a short wait, then a zoom IN across the crossing into C (depth 6), one worker job answered a step;
 * each compose's cells by class (sharp, blur, older-unread, older-wait, older-other, paper) and where the stand-in went.
 * MOVE=0 runs the same zoom without the drop. A probe, not a suite. Run:
 *   MOVE=1 WAIT=2 CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.drop.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "picture");
const tick = () => new Promise((r) => setTimeout(r, 0));
function gate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return { parked, async answer(n = Infinity) { let k = 0; while (parked.length && k < n) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); k++; } for (let t = 0; t < 6; t++) await tick(); return k; } };
}
async function settle(E, n = 2) { for (let k = 0; k < n; k++) { E.renderer.syncCameraOnly(); for (let m = 0; m < 4; m++) await tick(); } }
async function drain(E, g) {
    const busy = () => { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); };
    for (let k = 0; k < 400 && busy(); k++) { await g.answer(); await settle(E, 1); }
    await new Promise((r) => setTimeout(r, 150)); await settle(E, 3);
    for (let k = 0; k < 400 && busy(); k++) { await g.answer(); await settle(E, 1); }
}
function classes(pyr) {
    const P = pyr.lastPlan, out = { sharp: 0, blur: 0, unread: 0, wait: 0, other: 0, paper: 0, held: 0 };
    for (const c of P.cells) for (const d of c.draws) {
        if (d.cls === "older") out[d.wait ? "wait" : d.unread ? "unread" : "other"]++; else out[d.cls] = (out[d.cls] || 0) + 1;
    }
    return out;
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(4); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test("a drop, then a zoom in across the crossing", async () => {
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-26-51-275Z.json");
    const rep = readReportFile(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    Object.defineProperty(window, "screen", { value: { width: 1920, height: 1080 }, configurable: true });
    const g = gate();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true });
    loadReport(E, rep);
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    const pyr = E.renderer.pyramid;
    E.setTool("select");
    E._render();
    await drain(E, g);
    const P0 = E.cam.frame;
    if (process.env.MOVE !== "0") {
        let at = null;
        for (let y = 300; y < 800 && !at; y += 20) for (let x = 500; x < 1300 && !at; x += 20) { const id = E._hitTest(x, y); if (id != null) at = [x, y, id]; }
        E.pointerDown(at[0], at[1]); E.pointerUp();
        E.pointerDown(at[0], at[1]);
        for (let s = 1; s <= 8; s++) E.pointerMove(at[0] + (60 * s) / 8, at[1] + (30 * s) / 8);
        E.pointerUp();
        const stale = [...E.plates.records()].filter((r) => !E.plates.exact(r)).length;
        log(`drop of ${at[2]} by (60, 30) px at P; stale plates right after: ${stale} of ${E.plates.cache.size}; selection ${JSON.stringify(E.selection && E.selection.ids)}`);
        for (let k = 0; k < (+process.env.WAIT || 0); k++) { await g.answer(4); await settle(E, 1); }
        E.deselect && E.deselect();
        await settle(E, 1);
        log(`after the wait (${+process.env.WAIT || 0} rounds of 4 answers): view ${pyr._v.mode}; stale plates ${[...E.plates.records()].filter((r) => !E.plates.exact(r)).length}; classes ${JSON.stringify(classes(pyr))}`);
    }
    const rows = [];
    for (let k = 0; k < 200; k++) {
        if (E.cam.frame !== P0 && E.cam.inScale > 1) break;
        E.zoomFactorAt(801, 333, 2 ** 0.1);
        await g.answer(1);
        E.renderer.syncCameraOnly();
        const c = classes(pyr);
        rows.push({ k, depth: E.cam.activeLevel, inScale: +E.cam.inScale.toPrecision(4), level: pyr._v.level, standIn: pyr._standIn ? +pyr._standIn.Z.toFixed(2) : null, images: pyr.lastPlan.images, ...c });
    }
    const tot = rows.reduce((a, r) => { for (const k of ["sharp", "blur", "unread", "wait", "other", "paper"]) a[k] = (a[k] || 0) + r[k]; return a; }, {});
    const atP = rows.filter((r) => r.depth === 5), atC = rows.filter((r) => r.depth === 6);
    const sum = (a, k) => a.reduce((x, r) => x + r[k], 0);
    log(`zoom in: ${rows.length} steps (${atP.length} at P, ${atC.length} at C); cells by class ${JSON.stringify(tot)}`);
    log(`  at P: older ${sum(atP, "unread") + sum(atP, "wait") + sum(atP, "other")}, blur ${sum(atP, "blur")}, paper ${sum(atP, "paper")}; at C: older ${sum(atC, "unread") + sum(atC, "wait") + sum(atC, "other")}, blur ${sum(atC, "blur")}, paper ${sum(atC, "paper")}`);
    for (const r of rows.filter((x, i) => i % 4 === 0 || x.unread || x.other || x.paper)) log(`  ${JSON.stringify(r)}`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "drop-move" + (process.env.MOVE === "0" ? 0 : 1) + "-wait" + (+process.env.WAIT || 0) + ".json"), JSON.stringify(rows, null, 1));
    E.destroy();
});
