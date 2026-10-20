/**
 * review1013.bakeprof.probe.js — where a cold tile bake's time goes with F142's cull in: every frame's tiles (i, j) in
 * [-1, 1]^2, up and down, baked once from a cold cache, with self/inclusive time and calls per step (TileStore's bake
 * methods, derive.js's exports, the document's spatial index). A probe, not a suite. PROF_REPORTS=<names,>,
 * PROF_FRAMES (default 400).
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1013.bakeprof.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import TileStore from "./TileStore";
import Document from "./Document";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { perfNow } from "./now";

const D = require("./geometry/derive");

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(3 * 60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "compat");

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}

/** Self and inclusive time per wrapped function; returns { stats, restore }. */
function profiler() {
    const stats = new Map(), stack = [], undo = [];
    const wrap = (obj, name, label = name, note = null) => {
        const orig = obj[name];
        if (typeof orig !== "function") return;
        obj[name] = function wrapped(...a) {
            const fr = { t0: perfNow(), child: 0, label };
            stack.push(fr);
            let r;
            try { r = orig.apply(this, a); } finally {
                stack.pop();
                const incl = perfNow() - fr.t0;
                if (stack.length) stack[stack.length - 1].child += incl;
                let s = stats.get(label);
                if (!s) stats.set(label, (s = { calls: 0, incl: 0, self: 0, n: 0 }));
                s.calls++; s.self += incl - fr.child;
                if (!stack.some((f) => f.label === label)) s.incl += incl;
                if (note) s.n += note(a, r);
            }
            return r;
        };
        undo.push(() => { obj[name] = orig; });
    };
    return { stats, wrap, restore: () => { while (undo.length) undo.pop()(); } };
}

const NAMES = (process.env.PROF_REPORTS || "report-2026-10-07T03-24-11-129Z.json").split(",");
for (const name of NAMES) {
    test(`a cold bake's time by step: ${name}`, () => {
        resetRasterWorkerClient(); setRasterWorkerCount(4);
        setRasterTransport(() => new Promise(() => {}));
        const f = path.join(REPORT_DIR, name);
        const E = mk(1806, 1070);
        loadReport(E, readReportFile(f), { drawing: drawingPartsOf(f) });
        const max = +(process.env.PROF_FRAMES || 400);
        const frames = [...E.lm.frames.keys()].filter((F) => E.lm.frame(F).parent != null).slice(0, max);
        const P = profiler();
        const TS = TileStore.prototype, DP = Document.prototype;
        P.wrap(TS, "_bakeUp");
        P.wrap(TS, "_bakeDown");
        P.wrap(TS, "_upPiecesOver");
        P.wrap(TS, "_ringNatives", "_ringNatives", (a, r) => r.length);
        P.wrap(DP, "cellList", "cellList", (a, r) => r.length);
        P.wrap(DP, "queryRect", "queryRect", (a, r) => r.length);
        P.wrap(D, "classifyUp", "classifyUp", (a, r) => (r === "empty" ? 1 : 0));
        const piecesOf = (objs) => { let n = 0; for (const o of objs) if (o.type === "shape" && o.loops) for (const l of o.loops) n += l.length; return n; };
        P.wrap(D, "deriveStep", "deriveStep", (a) => piecesOf(a[0]));
        const A = require("./geometry/arcShape"), Z = require("./geometry/freeze");
        const len = (ls) => { let n = 0; if (ls) for (const l of ls) n += l.length; return n; };
        P.wrap(A, "transformLoopsAbout", "xfAbout", (a) => len(a[0]));
        P.wrap(Z, "chopFreezeLoops", "chopFreeze", (a) => len(a[0]));
        P.wrap(A, "transformLoops", "xfLoops", (a) => len(a[0]));
        P.wrap(A, "insideShape", "insideShape", (a) => len(a[0]));
        P.wrap(A, "clipShapeToRect", "clipShape", (a, r) => len(r && r.loops));
        P.wrap(A, "loopsBBox", "loopsBBox");
        P.wrap(A, "flattenShape", "flattenShape");
        E.store.bumpEpoch();
        const t0 = perfNow();
        let tiles = 0, pieces = 0;
        try {
            for (const F of frames) {
                for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
                    pieces += E.store._ensureUp(F, i, j).objs.length;
                    pieces += E.store._ensureDown(F, i, j).objs.length;
                    tiles += 2;
                }
                E.store._evict();
            }
        } finally { P.restore(); }
        const total = perfNow() - t0;
        const rows = [...P.stats].map(([k, s]) => ({ fn: k, calls: s.calls, selfMs: Math.round(s.self), inclMs: Math.round(s.incl), n: s.n }))
            .sort((a, b) => b.selfMs - a.selfMs);
        const res = { name, frames: frames.length, tiles, pieces, totalMs: Math.round(total), rows };
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `bakeprof-${name}`), JSON.stringify(res, null, 1));
        log(`BAKEPROF ${name} frames ${frames.length} tiles ${tiles} pieces ${pieces} total ${Math.round(total)} ms`);
        for (const r of rows) log(`BAKEPROF   ${r.fn.padEnd(14)} calls ${String(r.calls).padStart(8)} self ${String(r.selfMs).padStart(7)} incl ${String(r.inclMs).padStart(7)} n ${r.n}`);
        E.destroy();
        setRasterTransport(null); setRasterWorkerCount(null);
        expect(tiles).toBeGreaterThan(0);
    });
}
