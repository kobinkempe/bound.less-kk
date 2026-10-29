/**
 * review1006.picture.view.probe.js — what a report's camera shows: the render-list items at the recorded camera,
 * with their screen boxes, colours, opacity and z, from the report's extract (or its whole drawing). A probe, not a
 * suite. Run:
 *   REPORT=report-2026-10-07T03-26-51-275Z.json [WHOLE=1] CI=true NODE_OPTIONS=--max-old-space-size=8192 \
 *   npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.view.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import { loopsBounds } from "./geometry/antRuns";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(30 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "picture");
const r1 = (v) => Math.round(v * 10) / 10;

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); });

test("the items a report's camera shows", () => {
    const name = process.env.REPORT || "report-2026-10-07T03-26-51-275Z.json";
    const f = path.join(REPORT_DIR, name);
    const rep = readReportFile(f);
    Object.defineProperty(window, "devicePixelRatio", { value: (rep.meta.device && rep.meta.device.dpr) || 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scr = rep.extract.screen;
    const E = new KobinEngine(host, { width: scr.w, height: scr.h, raster: true });
    const parts = process.env.WHOLE ? drawingPartsOf(f) : null;
    const t0 = Date.now();
    loadReport(E, rep, { drawing: parts });
    E._render();
    log(`${name}: loaded (${parts ? "whole drawing" : "extract"}) in ${Date.now() - t0} ms; camera ${E.cam.frame} depth ${E.cam.activeLevel} inScale ${E.cam.inScale}; screen ${scr.w}x${scr.h}`);
    const sc = E.cam.inScale, px = E.cam.inPanX, py = E.cam.inPanY;
    const W = scr.w, H = scr.h, rows = [];
    for (const it of E.stage.items()) {
        const { geom, off } = E.stage.placed(it);
        let b = null;
        if (geom.type === "shape" && geom.loops) { const lb = loopsBounds(geom.loops); if (lb) b = { left: lb.x0, top: lb.y0, right: lb.x1, bottom: lb.y1 }; }
        if (!b) { const bx = it.box; b = bx; }
        if (!b) continue;
        const L = (b.left + off[0]) * sc + px, T = (b.top + off[1]) * sc + py, R = (b.right + off[0]) * sc + px, B = (b.bottom + off[1]) * sc + py;
        const cl = { left: Math.max(0, L), top: Math.max(0, T), right: Math.min(W, R), bottom: Math.min(H, B) };
        const area = cl.right > cl.left && cl.bottom > cl.top ? (cl.right - cl.left) * (cl.bottom - cl.top) : 0;
        const nat = E.doc.getById(it.id);
        rows.push({ id: it.id, key: it.key, type: it.type, home: nat ? nat.level : null, z: it.z, color: it.color, opacity: it.opacity, fade: it.fadeTag || null,
            erase: !!it.erase, box: [r1(L), r1(T), r1(R), r1(B)], screenShare: +(area / (W * H)).toFixed(4), covers: !!it.covers });
    }
    rows.sort((a, b) => (a.z ?? a.id) - (b.z ?? b.id));
    for (const r of rows) log(`  z ${r.z} id ${r.id} ${r.type} ${r.color} op ${r.opacity} fade ${r.fade} erase ${r.erase} key ${String(r.key).slice(-40)} home …${String(r.home).slice(-40)} box ${JSON.stringify(r.box)} share ${r.screenShare}`);
    log(`items ${rows.length}; covering > 50%: ${rows.filter((r) => r.screenShare > 0.5).map((r) => r.id + " " + r.color).join(", ")}`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "view-" + name.replace(/\.json$/, "") + (parts ? "-whole" : "") + ".json"), JSON.stringify({ camera: E.cam.state ? E.cam.state() : null, rows }, null, 1));
    E.destroy();
});
