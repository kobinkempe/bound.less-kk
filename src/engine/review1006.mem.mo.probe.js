/**
 * review1006.mem.mo.probe.js — Kobin 2026-10-12, "more memory than processing?": the Magnum Opus (R6) in jsdom, the
 * report's camera, then camera steps out and back in, each with a full document render (every tile read at once —
 * what the app spreads over idle slices). Per step: time; GC pauses and bytes allocated come from --trace_gc (see
 * `review1006.mem.keep.probe.js`); heap retained after the load and after the walk. As built, and with the shape cull.
 * A probe, not a suite. In band, stdout to a file:
 *   CI=true MO_CASE=built node --max-old-space-size=8192 node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --testMatch "**\/review1006.mem.mo.probe.js" > trace.txt
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";

const v8 = require("v8");
const vm = require("vm");
const { performance: NP } = require("perf_hooks");
v8.setFlagsFromString("--expose_gc");
const gc = vm.runInNewContext("gc");
const heapGc = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
const MB = (b) => +(b / 1048576).toFixed(1);
const say = (s) => process.stdout.write(`@@ ${s}\n`);
jest.setTimeout(60 * 60 * 1000);

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}

const R6 = "report-2026-10-07T03-39-00-036Z.json";
const CASES = { built: {}, cull: { cull: true } };

for (const [name, C] of Object.entries(CASES)) {
    const only = process.env.MO_CASE;
    (only && !only.split(",").includes(name) ? test.skip : test)(`Magnum Opus camera walk: ${name}`, async () => {
        resetRasterWorkerClient(); setRasterWorkerCount(4);
        setRasterTransport(() => new Promise(() => {}));
        const hBase = heapGc();
        const f = path.join(REPORT_DIR, R6);
        const rep = readReportFile(f);
        let t = NP.now();
        const E = mk(1806, 1070);
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        const loadMs = NP.now() - t;
        if (C.cull) for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
        const hLoaded = heapGc();
        say(`INFO ${name} loaded ${Math.round(loadMs)} ms, heap ${MB(hLoaded - hBase)} MB over base, natives ${E.doc.levels().reduce((n, k) => n + E.doc.count(k), 0)}, depth ${E.cam.activeLevel}`);
        v8.setFlagsFromString("--trace_gc");
        const c0 = NP.now(); gc(); const c1 = NP.now();
        say(`CALIB ${name} ${c0.toFixed(3)} ${c1.toFixed(3)}`);
        const step = (label, fn) => {
            const h0 = process.memoryUsage().heapUsed;
            const t0 = NP.now();
            fn();
            const t1 = NP.now();
            say(`DROP ${name} ${label} ${t0.toFixed(3)} ${t1.toFixed(3)} ${h0} ${process.memoryUsage().heapUsed}`);
        };
        E.setTool("select");
        step(0, () => E._render());
        E.sweepFrames();
        const sx = E.width / 2, sy = E.height / 2, d0 = E.cam.activeLevel;
        let k = 1;
        for (let g = 0; g < 24 && E.cam.activeLevel > Math.max(0, d0 - 2); g++) step(k++, () => { E.zoomAt(sx, sy, 300); E._render(); });
        for (let g = 0; g < 24 && E.cam.activeLevel < d0; g++) step(k++, () => { E.zoomAt(sx, sy, -300); E._render(); });
        for (let g = 0; g < 6; g++) step(k++, () => { E.panBy(120, 60); E._render(); });
        v8.setFlagsFromString("--notrace_gc");
        const hEnd = heapGc();
        say(`INFO ${name} after the walk: heap ${MB(hEnd - hBase)} MB over base; frames ${E.lm.frames.size}; tiles ${E.store.cache.size}; steps ${k}`);
        E.destroy();
        setRasterTransport(null); setRasterWorkerCount(null);
    });
}
