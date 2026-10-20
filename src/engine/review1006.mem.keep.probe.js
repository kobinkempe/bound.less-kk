/**
 * review1006.mem.keep.probe.js — Kobin 2026-10-12: would F139's keep rule make memory worse, and is the drop stall
 * memory (garbage collection) or processing? A report's drop three ways: as built; frame GC keeping the frames the
 * view's reads use (the rule as proposed, kept frames left as candidates so they go once nothing reads them); frame
 * GC forgetting nothing (any keep rule's upper bound). Per drop: time, heap after a forced GC, frames, tiles. The GC
 * pauses and the bytes allocated inside each drop come from V8's --trace_gc on stdout (parsed afterwards; the
 * windows are written to OUT). A probe, not a suite. Run in band, stdout to a file:
 *   CI=true node --max-old-space-size=8192 node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --testMatch "**\/review1006.mem.keep.probe.js" > trace.txt
 * MEM_CASE=<name>[,<name>] runs some cases (see CASES).
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";

// "view": the frames a current read uses are not candidates this run, and stay candidates for the next.
jest.mock("./frameGc", () => {
    const actual = jest.requireActual("./frameGc");
    const collectFrames = (E, inRender = false) => {
        // eslint-disable-next-line no-undef
        const K = global.__MEMKEEP;
        if (!K || K.mode !== "view" || !E._gcCand || !E._gcCand.size) return actual.collectFrames(E, inRender);
        const src = new Set();
        if (E.stage && E.stage._groups) for (const g of E.stage._groups.values()) src.add(String(g.F0));
        if (E.store && E.store._rrMemo) for (const m of E.store._rrMemo.values()) for (const g of m.groups.values()) src.add(String(g.F0));
        const held = [...E._gcCand].filter((id) => src.has(String(id)));
        for (const id of held) E._gcCand.delete(id);
        const n = actual.collectFrames(E, inRender);
        for (const id of held) E._gcCand.add(id);
        K.held += held.length;
        return n;
    };
    return { ...actual, collectFrames };
});
const MEMKEEP = { mode: "built", held: 0 };
global.__MEMKEEP = MEMKEEP;

const v8 = require("v8");
const vm = require("vm");
const { performance: NP } = require("perf_hooks");
v8.setFlagsFromString("--expose_gc");
const gc = vm.runInNewContext("gc");
const heapGc = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
const MB = (b) => +(b / 1048576).toFixed(1);
const say = (s) => process.stdout.write(`@@ ${s}\n`);

jest.setTimeout(60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "mem");

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}

function counts(E) {
    let pieces = 0, loopBytes = 0;
    for (const t of E.store.cache.values()) for (const o of t.objs || []) {
        pieces++;
        if (o.loops) for (const L of o.loops) if (L.byteLength != null) loopBytes += L.byteLength;
    }
    let empty = 0;
    for (const id of E.lm.frames.keys()) { const f = E.lm.frame(id); if (!E.doc.count(id) && !(f._kids && f._kids.size)) empty++; }
    return { frames: E.lm.frames.size, emptyFrames: empty, forgotten: E._gcStats.forgotten, tiles: E.store.cache.size, pieces,
        tileLoopMB: MB(loopBytes), stageGroups: E.stage._groups.size, stageCells: E.stage._cells ? E.stage._cells.size : null };
}

const settle = async () => { for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 30)); };

const R3 = "report-2026-10-07T03-19-33-862Z.json", R4 = "report-2026-10-07T03-24-11-129Z.json";
const CASES = {
    r4built: { file: R4, inScale: 2.7029, mode: "built" },
    r4view: { file: R4, inScale: 2.7029, mode: "view" },
    r4all: { file: R4, inScale: 2.7029, mode: "all" },
    r3built: { file: R3, mode: "built" },
    r3view: { file: R3, mode: "view" },
    r3all: { file: R3, mode: "all" },
    // the Stage sends its pins again when frame GC forgets a frame it watches (the stale-pin fix), with "view"
    r4fixed: { file: R4, inScale: 2.7029, mode: "view", pinFix: true },
    // the shape cull (F142's lever B) alone, and with the two fixes
    r4cull: { file: R4, inScale: 2.7029, mode: "built", cull: true },
    r4fixedcull: { file: R4, inScale: 2.7029, mode: "view", pinFix: true, cull: true },
};
const WINDOWS = [];

for (const [name, C] of Object.entries(CASES)) {
    const only = process.env.MEM_CASE;
    (only && !only.split(",").includes(name) ? test.skip : test)(`memory of a drop: ${name}`, async () => {
        resetRasterWorkerClient(); setRasterWorkerCount(4);
        setRasterTransport(() => new Promise(() => {}));   // jobs post and never answer: no plates; the main thread alone
        MEMKEEP.mode = "built"; MEMKEEP.held = 0;
        const hBase = heapGc();
        const f = path.join(REPORT_DIR, C.file);
        const rep = readReportFile(f);
        const E = mk(1806, 1070);
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        if (C.inScale) {
            const cx = E.width / 2, cy = E.height / 2;
            const px = (cx - E.cam.inPanX) / E.cam.inScale, py = (cy - E.cam.inPanY) / E.cam.inScale;
            E.cam.inScale = C.inScale; E.cam.inPanX = cx - px * C.inScale; E.cam.inPanY = cy - py * C.inScale;
        }
        if (C.cull) for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
        if (C.pinFix) { const fg = E.stage.forgetFrame.bind(E.stage); E.stage.forgetFrame = (id) => { fg(id); E.stage._keysVer++; }; }
        E.setTool("select");
        E._render();
        E.sweepFrames();
        E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
        E._render();
        await settle();
        if (C.mode === "all") E.lm.forget = () => false;
        MEMKEEP.mode = C.mode;
        const hLoaded = heapGc();
        const res = { name, depth: E.cam.activeLevel, loadedMB: MB(hLoaded - hBase), start: counts(E), drops: [], wander: null };
        // calibration: the first "testing" GC after the trace is on is this one
        v8.setFlagsFromString("--trace_gc");
        const c0 = NP.now(); gc(); const c1 = NP.now();
        say(`CALIB ${name} ${c0.toFixed(3)} ${c1.toFixed(3)}`);
        const sx = E.width / 2, sy = E.height / 2;
        for (let k = 0; k < 6; k++) {
            const sign = k % 2 ? -1 : 1;
            E._dragSel = { start: [sx, sy], moved: false };
            E._beginHold();
            for (let s = 1; s <= 10; s++) E._dragSelection(sx + (sign * 60 * s) / 10, sy + (sign * 40 * s) / 10);
            const h0 = heapGc();
            const t0 = NP.now();
            E._pointerUp();
            const t1 = NP.now();
            const h1 = process.memoryUsage().heapUsed;
            WINDOWS.push({ name, k, t0, t1, h0, h1 });
            say(`DROP ${name} ${k} ${t0.toFixed(3)} ${t1.toFixed(3)} ${h0} ${h1}`);
            await settle();
            const hR = heapGc();
            res.drops.push({ dropMs: Math.round(t1 - t0), retainedMB: MB(hR - hBase), ...counts(E) });
        }
        // the camera leaves the frame and comes back: do kept frames go once nothing reads them?
        const before = counts(E);
        const lvl = E.cam.activeLevel;
        let g = 0;
        while (E.cam.activeLevel > Math.max(0, lvl - 2) && g++ < 200) { E.zoomAt(sx, sy, 400); E._render(); }
        await settle();
        const out = { ...counts(E), retainedMB: MB(heapGc() - hBase), depth: E.cam.activeLevel };
        g = 0;
        while (E.cam.activeLevel < lvl && g++ < 200) { E.zoomAt(sx, sy, -400); E._render(); }
        await settle();
        const back = { ...counts(E), retainedMB: MB(heapGc() - hBase), depth: E.cam.activeLevel };
        res.wander = { before, out, back };
        v8.setFlagsFromString("--notrace_gc");
        res.held = MEMKEEP.held;
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `keep-${name}.json`), JSON.stringify({ res, windows: WINDOWS.filter((w) => w.name === name) }, null, 1));
        say(`RESULT ${JSON.stringify(res)}`);
        MEMKEEP.mode = "built";
        E.destroy();
        setRasterTransport(null); setRasterWorkerCount(null);
    });
}
