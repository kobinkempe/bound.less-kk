/**
 * zoomout.paper.probe.js — Kobin's realistic zoom-out on the Magnum Opus (report 2026-10-20T15-54-32: "tons of white
 * space … I'd prefer blurry images or slow framerate"), with the workers answering on a simulated clock. His perfLog's
 * last 4 s: bursts of 6–7 frames zooming ~4.2 octaves (up to 1.1 a frame), ~400 ms still between them, from depth 2 to
 * the root. Here: from the deepest native frame on his undo path, drained (the opening view and its far prefetch), to
 * the root at his final 0.2. Per frame: the plan's paper, blur and older shares, charged at 16.7 ms a frame (the
 * pyramid's clock is the simulated one). A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/zoomout.paper.probe.js"
 * Env: LAT=<frames before a posted job may be answered> (2); PER=<jobs answered a frame> (3); PAUSE=<still frames
 * between bursts> (24); BURSTS=<max bursts> (60); LABEL=<output name>; START_DEPTH=<deepest depth to start at>.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";
import { bboxOf } from "./geometry/derive";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(3 * 60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "zoomout");
const tick = () => new Promise((r) => setTimeout(r, 0));
const FRAME_MS = 1000 / 60;
/** One burst's octaves a frame, from his perfLog 664.839–664.936 (2.542 → 0.172). */
const BURST = [0.22, 0.61, 0.87, 0.58, 1.11, 0.49, 0.3];
const LAT = process.env.LAT != null ? +process.env.LAT : 2;
const PER = process.env.PER != null ? +process.env.PER : 3;
const PAUSE = process.env.PAUSE != null ? +process.env.PAUSE : 24;
const BURSTS = process.env.BURSTS != null ? +process.env.BURSTS : 60;

/** The simulated clock: `t` advances a frame at a time; timers set on it fire as it passes them. */
function simClock() {
    const c = { t: 0, timers: new Map(), seq: 0 };
    c.now = () => c.t;
    c.set = (fn, ms) => { const id = ++c.seq; c.timers.set(id, { at: c.t + ms, fn }); return id; };
    c.clear = (id) => { c.timers.delete(id); };
    c.advance = (ms) => {
        const end = c.t + ms;
        for (;;) {
            let next = null;
            for (const [id, x] of c.timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
            if (!next) break;
            c.timers.delete(next[0]); c.t = Math.max(c.t, next[1].at); next[1].fn();
        }
        c.t = end;
    };
    return c;
}

/** Jobs parked at the transport, each answered once LAT frames have passed, PER a frame, oldest first. */
function gate(clock) {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve, at: clock.frame })));
    return {
        parked,
        async answer(n = PER, lat = LAT) {
            let k = 0;
            while (parked.length && k < n && clock.frame - parked[0].at >= lat) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); k++; }
            for (let t = 0; t < 4; t++) await tick();
            return k;
        },
    };
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(4); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test("the Magnum Opus: Kobin's burst zoom-out from the deepest native frame to the root", async () => {
    const f = path.join(REPORT_DIR, "report-2026-10-20T15-54-32-768Z.json");
    const rep = readReportFile(f), parts = drawingPartsOf(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    Object.defineProperty(window, "screen", { value: { width: 1920, height: 1080 }, configurable: true });
    const clock = simClock();
    clock.frame = 0;
    const g = gate(clock);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true, scenes: false });
    loadReport(E, rep, { drawing: parts });
    const R = E.renderer, pyr = R.pyramid;
    pyr._now = clock.now; pyr._setTimer = clock.set; pyr._clearTimer = clock.clear;
    E.plates.phone = false;
    E.plates.setBudget(pyr.budgetBytes()); pyr._sized();
    log(`budget ${E.plates.maxBytes / 1048576} MiB (his Chrome: 144), pinBound ${pyr.pinBound}, sigmaMin ${pyr.sigmaMin}`);
    // Counters: jobs queued by purpose, off-camera reads, far-set sizes.
    const tally = { jobs: {}, cells: {}, snaps: 0, snapNull: 0, snapMs: 0, setFar: 0, farMax: 0, plans: 0 };
    const push0 = R.queue.push.bind(R.queue);
    R.queue.push = (jobs) => { for (const j of jobs) { const p = j.purpose || j.kind; tally.jobs[p] = (tally.jobs[p] || 0) + 1; tally.cells[p] = (tally.cells[p] || 0) + (j.cells ? j.cells.length : 0); } return push0(jobs); };
    const snap0 = E.stage.snapshot.bind(E.stage);
    E.stage.snapshot = (...a) => { const t0 = Date.now(), r = snap0(...a); tally.snaps++; if (!r) tally.snapNull++; tally.snapMs += Date.now() - t0; return r; };
    const setFar0 = pyr.setFar.bind(pyr);
    pyr.setFar = (keys) => {
        tally.setFar++;
        // FAR_KEEP: the far set accumulates while its plates are cached (a lever, patched here only).
        const v = E.plates.view, prev = process.env.FAR_KEEP && v && v.far ? [...v.far].filter((k) => E.plates.get(k) || E.plates.inFlightExact(k)) : [];
        setFar0([...prev, ...keys]);
        tally.farMax = Math.max(tally.farMax, E.plates.view.far.size);
    };
    const pf0 = R._pyrPrefetch.bind(R);
    R._pyrPrefetch = (v, retry) => { tally.plans++; if (retry) tally.retries = (tally.retries || 0) + 1; return pf0(v, retry); };
    const rn0 = pyr.renderNow.bind(pyr);
    pyr.renderNow = (job) => { const t0 = Date.now(), out = rn0(job); if (job.purpose === "net") { tally.netReal = (tally.netReal || 0) + Date.now() - t0; tally.netMax = Math.max(tally.netMax || 0, Date.now() - t0); } return out; };
    if (process.env.NET_MS != null) E.cfg.netMs = +process.env.NET_MS;
    const census = () => {
        const by = {};
        for (const r of E.plates.records()) { const k = r.kind + " d" + E.lm.depthOf(r.frame) + (r.kind === "level" ? " L" + r.level : ""); by[k] = (by[k] || 0) + 1; }
        return by;
    };

    // The start: the deepest frame with natives (at most START_DEPTH), its natives' box filling the screen.
    const maxD = process.env.START_DEPTH != null ? +process.env.START_DEPTH : Infinity;
    const frames = E.doc.levels().map((id) => ({ id, d: E.lm.depthOf(id), n: E.doc.count(id) }))
        .filter((x) => x.d != null && x.d <= maxD && x.n >= 20).sort((a, b) => b.d - a.d || b.n - a.n);
    log(`deepest native frames: ${JSON.stringify(frames.slice(0, 6))}`);
    const S0 = frames[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of E.doc.list(S0.id)) { const b = bboxOf(o); if (!(b.x1 > b.x0)) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    E.setTool("pan");
    E.jumpTo(S0.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });

    const busy = () => { const r = R.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); };
    const frame = async () => { clock.frame++; clock.advance(FRAME_MS); await g.answer(); };
    // Drained at the start: the view, its rest set and the far prefetch, as after a while at the opening view.
    for (let k = 0; k < 3000 && (busy() || k < 40); k++) {
        await frame(); R.syncCameraOnly();
        if (k % 50 === 49) await new Promise((r) => setTimeout(r, 120));      // the prefetch's real-time quiet after commits
    }
    const far0 = E.plates.view && E.plates.view.far ? E.plates.view.far.size : 0;
    log(`start: frame ${E.cam.frame} depth ${E.cam.activeLevel} inScale ${E.cam.inScale.toFixed(3)}; plates ${E.plates.cache.size}, far ${far0}, busy ${busy()}`);
    log(`start tally ${JSON.stringify(tally)}; census ${JSON.stringify(census())}`);
    const s0 = { ...pyr.s };

    const rows = [], ax = 903, ay = 535;
    const sum = { paper: 0, blur: 0, older: 0, frames: 0, paperFrames: 0, worst: 0, burstPaper: 0, pausePaper: 0 };
    const charge = (phase, b) => {
        const P = pyr.lastPlan, sh = pyr._share, v = P && P.v;
        sum.paper += sh.paper * FRAME_MS; sum.blur += sh.blur * FRAME_MS;
        sum.older += (sh.olderPatch + sh.olderUnread + sh.olderOther) * FRAME_MS; sum.frames++;
        if (sh.paper > 0) sum.paperFrames++;
        sum.worst = Math.max(sum.worst, sh.paper);
        if (phase === "burst") sum.burstPaper += sh.paper * FRAME_MS; else sum.pausePaper += sh.paper * FRAME_MS;
        rows.push({ b, phase, depth: E.cam.activeLevel, inScale: +E.cam.inScale.toPrecision(3), mode: v && v.mode, level: v && v.level,
            paper: +sh.paper.toFixed(3), blur: +sh.blur.toFixed(3), images: P && P.images, plates: E.plates.cache.size, busy: busy() });
    };
    let b = 0;
    for (; b < BURSTS; b++) {
        if (E.cam.activeLevel === 0 && E.cam.inScale <= 0.21) break;
        for (const oct of BURST) {
            if (E.cam.activeLevel === 0 && E.cam.inScale * 2 ** -oct < 0.2) break;
            await frame();
            E.zoomFactorAt(ax, ay, 2 ** -oct);
            charge("burst", b);
        }
        for (let p = 0; p < PAUSE; p++) { await frame(); R.syncCameraOnly(); charge("pause", b); }
    }
    const d = {};
    for (const k of ["paperMs", "blurMs", "standInCells", "restInline", "restWorker", "restDiscards", "nets", "netPlates"]) d[k] = +(pyr.s[k] - s0[k]).toFixed(1);
    const res = { LAT, PER, PAUSE, bursts: b, frames: sum.frames, simMs: Math.round(sum.frames * FRAME_MS),
        paperMs: Math.round(sum.paper), blurMs: Math.round(sum.blur), olderMs: Math.round(sum.older), burstPaperMs: Math.round(sum.burstPaper),
        pausePaperMs: Math.round(sum.pausePaper), paperFrames: sum.paperFrames, worstPaper: +sum.worst.toFixed(3), pyr: d,
        end: { frame: String(E.cam.frame), depth: E.cam.activeLevel, inScale: E.cam.inScale }, evictedByRank: E.plates.report().evictedByRank };
    log(`zoom-out: ${JSON.stringify(res)}`);
    log(`end tally ${JSON.stringify(tally)}`);
    // Per burst: paper ms in the burst and in the pause after it, and the frames until the first paper-free one.
    const per = [];
    for (let k = 0; k < b; k++) {
        const rs = rows.filter((r) => r.b === k), bu = rs.filter((r) => r.phase === "burst"), pa = rs.filter((r) => r.phase === "pause");
        const clear = pa.findIndex((r) => r.paper === 0);
        per.push({ b: k, depth: rs[0] && rs[0].depth, level: rs[0] && rs[0].level, burstPaperMs: Math.round(bu.reduce((a, r) => a + r.paper, 0) * FRAME_MS),
            pausePaperMs: Math.round(pa.reduce((a, r) => a + r.paper, 0) * FRAME_MS), worst: Math.max(0, ...rs.map((r) => r.paper)), clearAfter: clear });
    }
    for (const p of per) log(`  ${JSON.stringify(p)}`);
    fs.mkdirSync(OUT, { recursive: true });
    const label = process.env.LABEL || "shipped";
    fs.writeFileSync(path.join(OUT, `${label}-lat${LAT}-per${PER}.json`), JSON.stringify({ res, per, rows }, null, 1));
    E.destroy();
});
