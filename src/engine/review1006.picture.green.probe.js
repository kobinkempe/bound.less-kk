/**
 * review1006.picture.green.probe.js — R6 (the Magnum Opus at depth 10): which native's STORED geometry is topmost under
 * screen points at the report's camera, tested in each native's home frame through its placement (no tile, no up/down
 * content, no plate) — an independent check of the rasteriser's all-green picture. A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.green.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import { insideLoops } from "./geometry/antRuns";
import { shapeFromRings } from "./geometry/arcShape";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(20 * 60 * 1000);
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); });

test("R6: the topmost stored ink under screen points", () => {
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-39-00-036Z.json");
    const rep = readReportFile(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true });
    loadReport(E, rep);
    E._render();
    const F = E.cam.frame;
    // Every native the scene draws from, once.
    const nats = new Map();
    for (const it of E.stage.items()) { const rec = E.doc.getById(it.id); if (rec && !nats.has(it.id)) nats.set(it.id, rec); }
    log(`camera ${F} depth ${E.cam.activeLevel} inScale ${E.cam.inScale}; ${nats.size} natives behind ${E.stage.items().length} items`);
    const geomOf = (o) => (o.type === "shape" ? o.loops : o.type === "fill" ? shapeFromRings(o.polys) : null);
    const pts = [];
    for (const fy of [0.1, 0.5, 0.9]) for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) pts.push([1806 * fx, 1070 * fy]);
    pts.push([924.5, 512]);   // the selected cluster's middle
    for (const s of pts) {
        const p = E.cam.screenToFrame(s[0], s[1]);
        const hits = [];
        for (const [id, rec] of nats) {
            const o = rec.obj, g = geomOf(o);
            if (!g) continue;
            const q = E.stage.placeNative(o, F).toStored(p);
            if (!q) continue;
            let inside = false;
            try { inside = insideLoops(g, q); } catch (err) { inside = null; }
            if (inside) hits.push({ id, z: o.z, color: o.color, op: o.opacity, home: String(rec.level).slice(-24) });
        }
        hits.sort((a, b) => ((b.z ?? b.id) - (a.z ?? a.id)) || (b.id - a.id));
        log(`screen (${s[0].toFixed(0)}, ${s[1].toFixed(0)}): ${hits.length} natives contain it; top-down ${hits.slice(0, 4).map((h) => `${h.id} z${h.z} ${h.color} op${h.op} home …${h.home}`).join(" | ")}`);
    }
    E.destroy();
});
