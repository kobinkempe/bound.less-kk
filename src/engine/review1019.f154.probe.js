/**
 * review1019.f154.probe.js — F154: the core with row runs against the core without, on a report's screen plates. A
 * report's whole drawing at its own camera (R4 by default; REPORT=… for another), every screen plate packed as the
 * renderer packs it (`packJob`), its items' row runs built here (`rowRuns`) and attached; each plate drawn both ways,
 * alternately, `REPS` times: the bytes compared, the time taken the minimum. Pieces walked: every piece of a drawn item,
 * against the pieces of the runs that reach the plate's rows. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1019.f154.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";
import { packJob } from "./raster/rasterPack";
import { renderPlate, rowRuns } from "./raster/rasterCore";
import { PLATE_PX } from "./raster/plate";
import { perfNow } from "./now";

const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "f154");
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(40 * 60 * 1000);
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPS = +(process.env.REPS || 5);
const PERS = (process.env.PERS || "4,8,16,32").split(",").map(Number);

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

/** The job's runs, item by item from its own spans, as the pack would ship them. */
function withRuns(job, per) {
    const parts = [], subRun = new Uint32Array(job.subs.length);
    let nRuns = 0;
    const t = perfNow();
    for (let it = 0; it < job.nItems; it++) {
        const m = it * 8, kind = job.meta[m], gs = job.meta[m + 2], gl = job.meta[m + 3], ss = job.meta[m + 4], sc = job.meta[m + 5];
        const r = rowRuns(kind, job.geom.subarray(gs, gs + gl), job.subs.subarray(ss, ss + sc), gl, per);
        for (let s = 0; s < sc; s++) subRun[ss + s] = nRuns + r.subRun[s];
        parts.push(r.runs);
        nRuns += r.runs.length / 3;
    }
    const runs = new Float64Array(nRuns * 3);
    let at = 0;
    for (const p of parts) { runs.set(p, at); at += p.length; }
    return { job: { ...job, runs, subRun }, buildMs: perfNow() - t, nRuns };
}

/** Pieces of the drawn items, and of the runs reaching the plate's rows. */
function visits(job, p) {
    const ox = job.plates[2 * p] * PLATE_PX, oy = job.plates[2 * p + 1] * PLATE_PX, Zq = job.Zq;
    const W = { 0: 3, 1: 8, 2: 9, 3: 16 };
    let all = 0, kept = 0, runsAll = 0, runsKept = 0;
    for (let it = 0; it < job.nItems; it++) {
        const a = it * 9;
        const x0 = job.attr[a] * Zq - ox, x1 = job.attr[a + 2] * Zq - ox, y0 = job.attr[a + 1] * Zq - oy, y1 = job.attr[a + 3] * Zq - oy;
        if (!(x1 >= 0 && x0 <= PLATE_PX && y1 >= 0 && y0 <= PLATE_PX)) continue;
        const m = it * 8, kind = job.meta[m], gs = job.meta[m + 2], gl = job.meta[m + 3], ss = job.meta[m + 4], sc = job.meta[m + 5];
        const ry = job.attr[a + 5];
        for (let k = 0; k < sc; k++) {
            const lo = kind === 0 ? gs + job.subs[ss + k] : gs + 2 * job.subs[ss + k];
            const hi = k + 1 < sc ? (kind === 0 ? gs + job.subs[ss + k + 1] : gs + 2 * job.subs[ss + k + 1]) : gs + gl;
            const r0 = job.subRun[ss + k], r1 = ss + k + 1 < job.subRun.length ? job.subRun[ss + k + 1] : job.runs.length / 3;
            if (r1 === r0) {
                let n = 0;
                for (let o = lo + 2; o < hi; o += kind === 0 ? (W[job.geom[o]] || 8) : 2) n++;
                all += n + 1; kept += n + 1;
                continue;
            }
            for (let r = r0; r < r1; r++) {
                const o0 = lo + job.runs[3 * r + 2], o1 = r + 1 < r1 ? lo + job.runs[3 * r + 5] : hi;
                let n = 0;
                for (let o = o0; o < o1; o += kind === 0 ? (W[job.geom[o]] || 8) : 2) n++;
                if (o1 === hi) n++;
                all += n; runsAll++;
                const ylo = (job.runs[3 * r] + ry) * Zq - oy, yhi = (job.runs[3 * r + 1] + ry) * Zq - oy;
                if (!(yhi < -1 || ylo > PLATE_PX + 1)) { kept += n; runsKept++; }
            }
        }
    }
    return { all, kept, runsAll, runsKept };
}

const RESULTS = {};
afterAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "f154-" + (process.env.REPORT ? process.env.REPORT.slice(18, 26) : "R4") + ".json"), JSON.stringify(RESULTS, null, 1));
});

test("F154: row runs against the whole walk on a report's screen plates", async () => {
    const name = process.env.REPORT || "report-2026-10-07T03-24-11-129Z.json";
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
    if (rep.moves && rep.moves.selection) E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
    E._render();
    await drain(E, g, 4);
    const st = E.stage, R = E.renderer, pyr = R.pyramid, v = pyr._v;
    const list = R._sceneList();
    const Z = v.mode === "rest" ? v.Z : v.Zq;
    const W = pyr.wDev, H = pyr.hDev;
    const devToPlate = (X, Y) => { const px = (X - v.tx) / v.k, py = (Y - v.ty) / v.k; return { i: Math.floor(px * Z / PLATE_PX), j: Math.floor(py * Z / PLATE_PX) }; };
    const tl = devToPlate(0, 0), br = devToPlate(W - 1, H - 1);
    const res = RESULTS.main = { report: name, view: { mode: v.mode, Z, cells: (br.i - tl.i + 1) * (br.j - tl.j + 1) }, reps: REPS, byPer: {} };
    const A = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4), B = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    const cA = new Uint32Array(8), cB = new Uint32Array(8);
    const jobs = [];
    for (let j = tl.j; j <= br.j; j++) for (let i = tl.i; i <= br.i; i++) {
        const job = packJob(list, { plates: Int32Array.of(i, j), Zq: Z, dpr: pyr.dpr, cfg: R.cfg, paper: R._paperRgb, G: st.generation });
        if (job.nItems) jobs.push(job);
    }
    for (const per of PERS) {
        const row = res.byPer[per] = { plates: jobs.length, msWhole: 0, msRuns: 0, diffBytes: 0, edgesSame: 0, rowsSame: 0, coveredSame: 0, chordsWhole: 0, chordsRuns: 0, pieces: 0, piecesWalked: 0, runs: 0, runsWalked: 0, buildMs: 0, runBytes: 0, geomBytes: 0 };
        for (const job of jobs) {
            const w = withRuns(job, per);
            row.buildMs += w.buildMs; row.runBytes += w.job.runs.byteLength + w.job.subRun.byteLength; row.geomBytes += job.geom.byteLength;
            let tw = Infinity, tr = Infinity;
            for (let k = 0; k < REPS; k++) {
                let t = perfNow(); renderPlate(job, 0, A, cA); tw = Math.min(tw, perfNow() - t);
                t = perfNow(); renderPlate(w.job, 0, B, cB); tr = Math.min(tr, perfNow() - t);
            }
            row.msWhole += tw; row.msRuns += tr;
            for (let q = 0; q < A.length; q++) if (A[q] !== B[q]) row.diffBytes++;
            if (cA[4] === cB[4]) row.edgesSame++;
            if (cA[6] === cB[6]) row.rowsSame++;
            if (cA[7] === cB[7]) row.coveredSame++;
            row.chordsWhole += cA[5]; row.chordsRuns += cB[5];
            const vv = visits(w.job, 0);
            row.pieces += vv.all; row.piecesWalked += vv.kept; row.runs += vv.runsAll; row.runsWalked += vv.runsKept;
        }
        for (const k of ["msWhole", "msRuns", "buildMs"]) row[k] = +row[k].toFixed(1);
        row.speedup = +(row.msWhole / row.msRuns).toFixed(2);
        row.visitRatio = +(row.pieces / Math.max(1, row.piecesWalked)).toFixed(2);
        log(`[${name.slice(18, 26)}] per ${per}: ${JSON.stringify(row)}`);
    }
    E.destroy(); host.remove();
    setRasterTransport(null); setRasterWorkerCount(null);
});
