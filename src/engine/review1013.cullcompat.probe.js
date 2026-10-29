/**
 * review1013.cullcompat.probe.js — F142's shape cull as a compatibility check: every tile of a sample baked twice,
 * without the cull and with it, compared piece for piece (id, type, origin, z, every coordinate, covers). A probe,
 * not a suite.
 *   COMPAT_MODE=head (default, for the tree with F142): side A runs HEAD's derivation by wrapping the module's
 *     exports (`classifyUp` calls a shape EDGE, `deriveStep` sees shapes with an infinite width: the NaN of
 *     HEAD, which never culled); side B is the tree's.
 *   COMPAT_MODE=emulate (for HEAD itself): side B gives every shape `lwFrame = 0`, which is what `|| 0` reads.
 *   COMPAT_MODE=cellquery (F156): side A scans the parent's whole cell (`doc.cellList`), side B queries its index.
 * COMPAT_REPORTS=<names,> picks the reports (default R4 and R6), COMPAT_FRAMES caps the frames (default 400).
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1013.cullcompat.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { encodeLoops } from "./geometry/arcShape";
import { perfNow } from "./now";

const D = require("./geometry/derive");

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(3 * 60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "compat");
const MODE = process.env.COMPAT_MODE || "head";

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}
const sig = (p) => {
    const g = p.loops ? JSON.stringify(encodeLoops(p.loops)) : p.polys ? JSON.stringify(p.polys) : JSON.stringify(p.pts || null);
    return `${p.id}|${p.type}|${p.origin}|${p.z}|${g}|${p.covers ? 1 : 0}|${p.lwFrame == null ? "" : p.lwFrame}`;
};

/** HEAD's derivation through the exports every caller reads (TileStore, eraseDescent); returns the restore. */
function headDerivation(calls) {
    const cu = D.classifyUp, ds = D.deriveStep;
    const wide = (o) => (o && o.type === "shape" && o.lwFrame === undefined ? Object.create(o, { lwFrame: { value: Infinity } }) : o);
    D.classifyUp = (o, ...a) => { calls.n++; return o && o.type === "shape" && o.lwFrame === undefined ? "edge" : cu(o, ...a); };
    D.deriveStep = (objs, ...a) => { calls.n++; return ds(objs.map(wide), ...a); };
    return () => { D.classifyUp = cu; D.deriveStep = ds; };
}

/** Every frame's tiles (i, j) in [-1, 1]^2, both directions, baked from a cold cache: key -> sorted piece signatures. */
function bakeAll(E, frames) {
    E.store.bumpEpoch();
    const out = new Map();
    let ms = 0;
    for (const F of frames) {
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            for (const dir of ["up", "down"]) {
                const t0 = perfNow();
                const tile = dir === "up" ? E.store._ensureUp(F, i, j) : E.store._ensureDown(F, i, j);
                ms += perfNow() - t0;
                out.set(F + "|" + dir + "|" + i + "," + j, tile.objs.map(sig).sort());
            }
        }
        E.store._evict();
    }
    return { out, ms };
}

const NAMES = (process.env.COMPAT_REPORTS || "report-2026-10-07T03-24-11-129Z.json,report-2026-10-07T03-39-00-036Z.json").split(",");
for (const name of NAMES) {
    test(`F142's cull leaves every sampled tile's pieces as they were: ${name}`, () => {
        resetRasterWorkerClient(); setRasterWorkerCount(4);
        setRasterTransport(() => new Promise(() => {}));
        const f = path.join(REPORT_DIR, name);
        const rep = readReportFile(f);
        const E = mk(1806, 1070);
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        const max = +(process.env.COMPAT_FRAMES || 400);
        const all = [...E.lm.frames.keys()].filter((F) => E.lm.frame(F).parent != null);
        const frames = all.slice(0, max);
        let shapes = 0;
        for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) shapes++;
        const calls = { n: 0 };
        let a;
        if (MODE === "head") {
            const restore = headDerivation(calls);
            try { a = bakeAll(E, frames); } finally { restore(); }
        } else if (MODE === "cellquery") {
            E.store._cellNatives = (P) => { calls.n++; return E.doc.cellList(P); };
            try { a = bakeAll(E, frames); } finally { delete E.store._cellNatives; }
        } else a = bakeAll(E, frames);
        if (MODE === "emulate") for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
        const b = bakeAll(E, frames);
        let same = 0, diff = 0, pieces = 0;
        const eg = [];
        for (const [key, A] of a.out) {
            const B = b.out.get(key) || [];
            pieces += A.length;
            if (A.length === B.length && A.every((s, k) => s === B[k])) { same++; continue; }
            diff++;
            if (eg.length < 8) {
                const onlyA = A.filter((s) => !B.includes(s)), onlyB = B.filter((s) => !A.includes(s));
                eg.push({ key, a: A.length, b: B.length, onlyA: onlyA.map((s) => s.slice(0, 80)).slice(0, 3), onlyB: onlyB.map((s) => s.slice(0, 80)).slice(0, 3) });
            }
        }
        const res = { name, mode: MODE, wrapCalls: calls.n, frames: frames.length, framesAll: all.length, shapes, tiles: a.out.size,
            same, diff, pieces, msBuilt: Math.round(a.ms), msCulled: Math.round(b.ms), eg };
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `cullcompat-${MODE}-${name}`), JSON.stringify(res, null, 1));
        log(`CULLCOMPAT ${JSON.stringify({ ...res, eg: res.eg.length })}`);
        E.destroy();
        setRasterTransport(null); setRasterWorkerCount(null);
        expect(a.out.size).toBeGreaterThan(0);
        if (MODE !== "emulate") expect(calls.n).toBeGreaterThan(0);   // the wrap reached the callers
    });
}
