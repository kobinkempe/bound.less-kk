/**
 * review1012.audit.q2.probe.js — PERF-DEEP agent B (AUDIT), Q2: work accounting per operation on R4 (the 2,664-native
 * canvas), jsdom, a raster engine on Kobin's screen and desktop budget, jobs answered by the shipped `runJob`. F139/F151
 * and F142 taken as fixed (frame GC off, shapes lwFrame 0). Cases (Q2_CASE):
 *   cross — a continuous zoom out at 2 octaves/s (60 steps/s, 16 ms apart, every job answered at once) across the
 *           crossing up into the parent: per step the view cells exact / refused for `covered` / asked / in flight,
 *           the table's missing tiles by kind, the plan's paper share, and whether an idle read ran;
 *   ops   — one camera step with no crossing (a pan, a zoom), an idle tile read and one view job: calls and counts of
 *           every stage they pass through, pieces walked against pieces that meet each plate;
 *   cycle — a zoom out two octaves and back at 2 octaves/s: bytes posted to the workers, items packed, and how many
 *           of those packs were the same geometry again.
 * A probe, not a suite.
 *   Q2_CASE=cross CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1012.audit.q2.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient, rasterWorkerReport } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";
import { packJob, packStats, resetPackStats } from "./raster/rasterPack";
import { renderPlate, occStats } from "./raster/rasterCore";
import { unwireJob, jobBytes } from "./raster/rasterJob";
import { levelCell } from "./raster/PyramidStore";
import { PLATE_PX } from "./raster/plate";
import { perfNow } from "./now";

const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "audit");
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(30 * 60 * 1000);
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R4 = "report-2026-10-07T03-24-11-129Z.json";
const RESULTS = {};

function gate(onJob = null) {
    const parked = [];
    const g = { parked, workerMs: 0, jobs: 0, plates: 0 };
    setRasterTransport((msg) => new Promise((resolve) => { if (onJob) onJob(msg); parked.push({ msg, resolve }); }));
    g.answer = async (max = Infinity) => {
        let n = 0;
        while (parked.length && n < max) {
            const p = parked.shift();
            const out = await runJob(p.msg);
            const t = out.msg.timings;
            if (t) for (let k = 1; k < t.length; k += 7) g.workerMs += t[k];
            g.jobs++; n++; g.plates += out.msg.plates.length / 2;
            p.resolve(out.msg);
        }
        for (let t = 0; t < 3; t++) await tick();
        return n;
    };
    return g;
}
async function settle(E, n = 2) { for (let k = 0; k < n; k++) { E.renderer.syncCameraOnly(); for (let m = 0; m < 4; m++) await tick(); } }
function busy(E, g) {
    const r = E.renderer.queue.report();
    return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0);
}
async function drain(E, g, rounds = 8) {
    for (let round = 0; round < rounds; round++) {
        let did = 0;
        for (let k = 0; k < 600 && busy(E, g); k++) { did += await g.answer(); await settle(E, 1); }
        await sleep(180); await settle(E, 2);
        if (!busy(E, g) && did === 0) return round;
    }
    return rounds;
}

/** Call counts and inclusive times of named methods (re-entry counted once). */
function counters() {
    const C = { on: false, t: new Map(), undo: [] };
    C.wrap = (obj, name, label = name) => {
        const orig = obj[name];
        if (typeof orig !== "function") return;
        let depth = 0;
        obj[name] = function (...a) {
            if (!C.on) return orig.apply(this, a);
            depth++;
            const t0 = perfNow();
            try { return orig.apply(this, a); } finally {
                depth--;
                let e = C.t.get(label);
                if (!e) C.t.set(label, (e = { n: 0, ms: 0 }));
                e.n++;
                if (depth === 0) e.ms += perfNow() - t0;
            }
        };
        C.undo.push(() => { obj[name] = orig; });
    };
    C.reset = () => C.t.clear();
    C.dump = () => Object.fromEntries([...C.t.entries()].sort((a, b) => b[1].ms - a[1].ms).map(([k, e]) => [k, { n: e.n, ms: +e.ms.toFixed(2) }]));
    return C;
}

async function setup({ inScale = null, workers = 4 } = {}) {
    resetRasterWorkerClient(); setRasterWorkerCount(workers);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true, writable: true });
    Object.defineProperty(window, "screen", { value: { width: 2560, height: 1440 }, configurable: true, writable: true });
    const hooks = { onJob: null };
    const g = gate((msg) => { if (hooks.onJob) hooks.onJob(msg); });
    const f = path.join(REPORT_DIR, R4);
    const rep = readReportFile(f);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: rep.extract.screen.w, height: rep.extract.screen.h, raster: true });
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    E.lm.forget = () => false;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
    if (inScale) {
        const cx = E.width / 2, cy = E.height / 2;
        const px = (cx - E.cam.inPanX) / E.cam.inScale, py = (cy - E.cam.inPanY) / E.cam.inScale;
        E.cam.inScale = inScale; E.cam.inPanX = cx - px * inScale; E.cam.inPanY = cy - py * inScale;
    }
    E.setTool("select");
    E._render();
    await drain(E, g);
    return { E, g, rep, host, hooks };
}
function teardown(E, host) { E.destroy(); host.remove(); setRasterTransport(null); setRasterWorkerCount(null); }

/** The view's cells now: exact, stale, missing; covered or refused; asked; in flight. */
function viewCells(E) {
    const pyr = E.renderer.pyramid, v = pyr._v, st = E.plates;
    const out = { mode: v.mode, level: v.level, cells: 0, exact: 0, stale: 0, none: 0, covered: 0, notCovered: 0, asked: 0, inflight: 0 };
    for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) {
        const c = levelCell(v.frameId, v.level, v.S, i, j), r = st.get(c.key);
        out.cells++;
        if (!r) out.none++; else if (st.exact(r)) out.exact++; else out.stale++;
        if (pyr.covered(c)) out.covered++; else out.notCovered++;
        if (pyr._asked.has(c.key)) out.asked++;
        if (st.inflight.has(c.key)) out.inflight++;
    }
    return out;
}
/** The plan's screen shares by draw class. */
function shares(E) {
    const pyr = E.renderer.pyramid, P = pyr.lastPlan;
    if (!P) return null;
    const v = P.v, W = pyr.wDev, H = pyr.hDev, a = {};
    for (const c of P.cells) for (const d of c.draws) {
        const x0 = Math.max(0, (d.x0 - v.ox) * v.s + v.dx), y0 = Math.max(0, (d.y0 - v.oy) * v.s + v.dy);
        const x1 = Math.min(W, (d.x1 - v.ox) * v.s + v.dx), y1 = Math.min(H, (d.y1 - v.oy) * v.s + v.dy);
        if (x1 > x0 && y1 > y0) a[d.cls] = (a[d.cls] || 0) + (x1 - x0) * (y1 - y0);
    }
    for (const k of Object.keys(a)) a[k] = +(a[k] / (W * H)).toFixed(3);
    return a;
}
/**
 * Each reroute group of the camera table: whether any of its natives' drawn boxes (placed in the camera frame) meets the
 * list window, and how many of its watched keys are unread — the keys `covers` waits for although the group draws nothing
 * there.
 */
function groupReach(E) {
    const st = E.stage, F = String(E.cam.frame), win = E._listWin();
    const meets = (a, b) => !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
    let groups = 0, reach = 0, keys = 0, keysUnread = 0, keysUnreadNoReach = 0, natives = 0;
    for (const g of st._groups.values()) {
        groups++;
        let any = false;
        for (const id of g.ids) {
            natives++;
            const rec = E.doc.getById(id);
            if (!rec) continue;
            const b = st.placeNative(rec.obj, F).box();
            if (b && meets(b, win)) { any = true; break; }
        }
        if (any) reach++;
        for (const key of g.keys) { keys++; if (st._missing.has(key)) { keysUnread++; if (!any) keysUnreadNoReach++; } }
    }
    return { groups, groupsReachingWindow: reach, natives, groupKeys: keys, groupKeysUnread: keysUnread, unreadOfGroupsThatDrawNothingHere: keysUnreadNoReach };
}

/** The camera table's missing keys: the frame's own window keys or a reroute group's, by direction. */
function missing(E) {
    const st = E.stage, out = { total: st._missing.size, own: 0, group: 0, up: 0, down: 0, framesAbsent: 0 };
    for (const key of st._missing) {
        const ks = st._keys.get(key);
        if (!ks) continue;
        if (ks.win) out.own++; else out.group++;
        if (ks.d) out.down++; else out.up++;
        if (!E.lm.frame(ks.frame)) out.framesAbsent++;
    }
    return out;
}

afterAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "q2-" + (process.env.Q2_CASE || "all") + ".json"), JSON.stringify(RESULTS, null, 1));
});
const only = process.env.Q2_CASE;
const maybe = (name) => (only && !only.split(",").includes(name) ? test.skip : test);

maybe("cross")("Q2 cross: a continuous zoom out across the crossing up", async () => {
    const { E, g, host } = await setup({ inScale: 2.7029 });
    const res = RESULTS.cross = { gitDiff: process.env.GIT_DIFF || null, steps: [] };
    const st = E.stage, R = E.renderer;
    // Idle reads (`_readIdle`'s slice is a sync with a positive budget below Infinity) and refusals at the pack.
    let idleReads = 0, refusedCells = 0, packedCells = 0;
    const sync0 = st.sync.bind(st);
    st.sync = (F, w, b = Infinity) => { if (b > 0 && b !== Infinity) idleReads++; return sync0(F, w, b); };
    const pack0 = R._pyrPack.bind(R);
    R._pyrPack = (job, jobId, pool) => {
        const n0 = job.cells.length, out = pack0(job, jobId, pool);
        const kept = out && job.packedCells ? job.packedCells.length : 0;
        if (!job.table) { refusedCells += n0 - kept; packedCells += kept; }
        return out;
    };
    const cx = E.width / 2, cy = E.height / 2, f = 2 ** (-2 / 60);
    const d0 = E.cam.activeLevel;
    let crossedAt = -1, k = 0;
    const t0 = perfNow();
    for (; k < 700; k++) {
        const ts = perfNow();
        E.zoomFactorAt(cx, cy, f);
        const stepMs = perfNow() - ts;
        await g.answer();                       // the workers are never the bottleneck here
        if (crossedAt < 0 && E.cam.activeLevel !== d0) crossedAt = k;
        const after = crossedAt >= 0 ? k - crossedAt : null;
        if (crossedAt < 0 ? k % 30 === 0 : after <= 12 || after % 6 === 0) {
            res.steps.push({ k, after, ms: +stepMs.toFixed(1), depth: E.cam.activeLevel, inScale: +E.cam.inScale.toPrecision(4), cells: viewCells(E),
                missing: missing(E), covers: st.covers(E.cam.frame, E._listWin()), share: shares(E), idleReads, refusedCells, packedCells, jobs: g.jobs });
        }
        if (crossedAt >= 0 && k - crossedAt === 2) res.groupReach = groupReach(E);
        if (crossedAt >= 0 && k - crossedAt >= 90) break;
        const left = 16 - (perfNow() - ts);
        if (left > 0) await sleep(left);
    }
    res.crossedAt = crossedAt; res.zoomMs = Math.round(perfNow() - t0);
    // The hand comes off: the idle read, then the cells.
    const t1 = perfNow();
    const recover = [];
    for (let w = 0; w < 12; w++) {
        await sleep(60); await g.answer(); await settle(E, 1);
        recover.push({ ms: Math.round(perfNow() - t1), cells: viewCells(E), missing: missing(E).total, share: shares(E), idleReads, refusedCells });
    }
    res.recover = recover;
    for (const s of res.steps) log(`k ${s.k} after ${s.after} d${s.depth} inScale ${s.inScale} step ${s.ms} ms | cells ${JSON.stringify(s.cells)} | missing ${JSON.stringify(s.missing)} covers ${s.covers} | share ${JSON.stringify(s.share)} | idleReads ${s.idleReads} refused ${s.refusedCells} packed ${s.packedCells}`);
    log(`groupReach after the crossing: ${JSON.stringify(res.groupReach)}`);
    for (const s of recover) log(`  +${s.ms} ms | cells ${JSON.stringify(s.cells)} | missing ${s.missing} | share ${JSON.stringify(s.share)} | idleReads ${s.idleReads}`);
    teardown(E, host);
});

/** Per plate of a packed job: pieces walked against pieces that meet the plate, items under a pixel, the cull. */
function analyseJob(job) {
    const out = [];
    const meta = job.meta, attr = job.attr, geom = job.geom, subs = job.subs, Zq = job.Zq, n = job.nItems;
    const W = { 0: 3, 1: 8, 2: 9, 3: 16 };
    for (let p = 0; p < job.plates.length / 2; p++) {
        const ox = job.plates[2 * p] * PLATE_PX, oy = job.plates[2 * p + 1] * PLATE_PX;
        const a = { items: n, drawn: 0, subPx: 0, pieces: 0, piecesMeet: 0, piecesLeft: 0, arcs: 0, arcsMeet: 0, doubles: 0, doublesMeet: 0, fams: new Set() };
        for (let it = 0; it < n; it++) {
            const b = it * 9;
            const x0 = attr[b] * Zq - ox, x1 = attr[b + 2] * Zq - ox, y0 = attr[b + 1] * Zq - oy, y1 = attr[b + 3] * Zq - oy;
            if (!(x1 >= 0 && x0 <= PLATE_PX && y1 >= 0 && y0 <= PLATE_PX)) continue;
            a.drawn++; a.fams.add(meta[it * 8 + 1]);
            if (x1 - x0 < 1 && y1 - y0 < 1) a.subPx++;
            const rx = attr[b + 4], ry = attr[b + 5];
            const kind = meta[it * 8], gs = meta[it * 8 + 2], gl = meta[it * 8 + 3], ss = meta[it * 8 + 4], sc = meta[it * 8 + 5];
            a.doubles += gl;
            const meet = (bx0, by0, bx1, by1) => bx1 >= 0 && bx0 <= PLATE_PX && by1 >= 0 && by0 <= PLATE_PX;
            for (let k = 0; k < sc; k++) {
                const lo = kind === 0 ? gs + subs[ss + k] : gs + 2 * subs[ss + k];
                const hi = k + 1 < sc ? (kind === 0 ? gs + subs[ss + k + 1] : gs + 2 * subs[ss + k + 1]) : gs + gl;
                if (kind === 0) {
                    let ax = (geom[lo] + rx) * Zq - ox, ay = (geom[lo + 1] + ry) * Zq - oy;
                    for (let o = lo + 2; o < hi; o += W[geom[o]] || 8) {
                        const code = geom[o];
                        let bx, by, sweep = 0, r = 0, ccx = 0, ccy = 0;
                        if (code === 0) { bx = geom[o + 1]; by = geom[o + 2]; }
                        else if (code === 2) { bx = geom[o + 7]; by = geom[o + 8]; }
                        else if (code === 1) { bx = geom[o + 6]; by = geom[o + 7]; sweep = geom[o + 5]; r = geom[o + 3]; ccx = geom[o + 1]; ccy = geom[o + 2]; }
                        else { bx = geom[o + 14]; by = geom[o + 15]; sweep = geom[o + 5]; r = geom[o + 3]; ccx = geom[o + 1]; ccy = geom[o + 2]; }
                        bx = (bx + rx) * Zq - ox; by = (by + ry) * Zq - oy;
                        let bx0 = Math.min(ax, bx), bx1 = Math.max(ax, bx), by0 = Math.min(ay, by), by1 = Math.max(ay, by);
                        if (sweep !== 0) {
                            a.arcs++;
                            const L = Math.hypot(bx - ax, by - ay), th = Math.abs(sweep);
                            if (th <= Math.PI / 2) { const sg = (L / 2) * Math.tan(th / 4); bx0 -= sg; bx1 += sg; by0 -= sg; by1 += sg; }
                            else { const R = r * Zq, X = (ccx + rx) * Zq - ox, Y = (ccy + ry) * Zq - oy; bx0 = Math.min(bx0, X - R); bx1 = Math.max(bx1, X + R); by0 = Math.min(by0, Y - R); by1 = Math.max(by1, Y + R); }
                        }
                        a.pieces++;
                        const w = W[code] || 8;
                        if (meet(bx0, by0, bx1, by1)) { a.piecesMeet++; a.doublesMeet += w; if (sweep !== 0) a.arcsMeet++; } else if (bx1 < 0 && by1 >= 0 && by0 <= PLATE_PX) a.piecesLeft++;
                        ax = bx; ay = by;
                    }
                } else {
                    let ax = (geom[lo] + rx) * Zq - ox, ay = (geom[lo + 1] + ry) * Zq - oy;
                    for (let o = lo + 2; o < hi + 2; o += 2) {
                        const q = o < hi ? o : lo;
                        const bx = (geom[q] + rx) * Zq - ox, by = (geom[q + 1] + ry) * Zq - oy;
                        a.pieces++;
                        if (meet(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by))) { a.piecesMeet++; a.doublesMeet += 2; } else if (Math.max(ax, bx) < 0 && Math.max(ay, by) >= 0 && Math.min(ay, by) <= PLATE_PX) a.piecesLeft++;
                        ax = bx; ay = by;
                    }
                }
            }
        }
        a.fams = a.fams.size;
        out.push(a);
    }
    return out;
}

maybe("ops")("Q2 ops: a camera step, an idle read, one view job", async () => {
    const { E, g, host } = await setup({});
    const res = RESULTS.ops = { gitDiff: process.env.GIT_DIFF || null };
    const st = E.stage, R = E.renderer, pyr = R.pyramid, ts = E.store;
    const C = counters();
    for (const [o, names, pre] of [
        [st, ["sync", "_setWindow", "_watchGroup", "_tileKeys", "covers", "_readMissing", "_settle", "_rerouteDiff", "_commit", "_refreshKey", "snapshot", "_dirtIn", "dirtyRects"], "stage."],
        [ts, ["readTiles", "_ensureUp", "_ensureDown", "_bakeUp", "_bakeDown", "_rerouteGroups"], "tiles."],
        [pyr, ["frameFor", "plan", "_planCell", "_planCells", "_planRest", "_mapped", "_coarserExact", "_patchStep", "_requestView", "covered", "_wanted", "compose", "_charge", "_onStill", "estimate"], "pyr."],
        [R, ["_frameStep", "_planeStep", "_pyrPrefetch", "syncWorld", "_pyrPack", "_pyrMeasure", "_sceneList"], "R."],
        [R.queue, ["pump", "frame", "push"], "queue."],
        [E.plates, ["_evict", "exact", "rankOf", "wants"], "store."],
    ]) for (const n of names) C.wrap(o, n, pre + n);
    const cx = E.width / 2, cy = E.height / 2;
    const op = async (name, fn, settleAfter = true) => {
        C.reset(); C.on = true;
        const t0 = perfNow();
        await fn();
        const ms = perfNow() - t0;
        C.on = false;
        res[name] = { ms: +ms.toFixed(1), calls: C.dump(), tableItems: st._list.size, groups: st._groups.size, keys: st._keys.size };
        log(`[${name}] ${ms.toFixed(1)} ms; items ${st._list.size}, groups ${st._groups.size}, watched keys ${st._keys.size}\n   ${JSON.stringify(res[name].calls)}`);
        if (settleAfter) await drain(E, g);
    };
    await op("pan3px", async () => { E.panBy(3, 0); });
    await op("zoomStep", async () => { E.zoomFactorAt(cx, cy, 2 ** (1 / 30)); });
    await op("zoomStep2", async () => { E.zoomFactorAt(cx, cy, 2 ** (1 / 30)); });
    // A pan that brings new tiles in: a screen to the right, then the idle read that reads them.
    E.panBy(-E.width * 3, 0);
    await op("idleRead", async () => { await sleep(260); }, true);
    // One view job: the view's cells, packed from the Stage and rendered here, every plate analysed.
    const v = pyr._v, cells = [];
    for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) cells.push(levelCell(v.frameId, v.level, v.S, i, j));
    const list = R._sceneList();
    resetPackStats();
    const occ0 = occStats.occluded;
    const tp = perfNow();
    const plates = new Int32Array(cells.length * 2);
    cells.forEach((c, k) => { plates[2 * k] = c.i; plates[2 * k + 1] = c.j; });
    const job = packJob(list, { plates, Zq: cells[0].Z, dpr: pyr.dpr, cfg: R.cfg, paper: R._paperRgb, G: st.generation });
    const packMs = perfNow() - tp;
    const per = analyseJob(job);
    const px = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4), counts = new Uint32Array(8), tm = new Float64Array(7);
    let coreMs = 0;
    for (let p = 0; p < cells.length; p++) {
        const t = perfNow(); renderPlate(job, p, px, counts, tm); coreMs += perfNow() - t;
        Object.assign(per[p], { coreItems: counts[0], coreDrawn: counts[1], coreFams: counts[2], edges: counts[4], chords: counts[5], rows: counts[6], coveredPx: counts[7] });
    }
    const sum = (k) => per.reduce((a, x) => a + (x[k] || 0), 0);
    res.viewJob = {
        level: v.level, Z: cells[0].Z, plates: cells.length, listItems: list.length, packedItems: job.nItems, packMs: +packMs.toFixed(1), coreMs: +coreMs.toFixed(1),
        jobBytes: jobBytes(job), geomBytes: job.geom.byteLength, occludedFamilies: occStats.occluded - occ0, packStats: { ...packStats },
        totals: { drawnItems: sum("drawn"), subPxDrawn: sum("subPx"), pieces: sum("pieces"), piecesMeet: sum("piecesMeet"), piecesLeft: sum("piecesLeft"), arcs: sum("arcs"), arcsMeet: sum("arcsMeet"),
            doubles: sum("doubles"), doublesMeet: sum("doublesMeet"), edges: sum("edges"), chords: sum("chords"), rows: sum("rows"), coveredPx: sum("coveredPx"), fams: sum("fams"), coreFams: sum("coreFams") },
        perPlate: per.map((x, k) => ({ k, drawn: x.drawn, pieces: x.pieces, meet: x.piecesMeet, left: x.piecesLeft, arcs: x.arcs, arcsMeet: x.arcsMeet, edges: x.edges, chords: x.chords, fams: x.fams, coreFams: x.coreFams })),
    };
    log(`[viewJob] ${JSON.stringify({ ...res.viewJob, perPlate: undefined })}`);
    log(`   per plate: ${JSON.stringify(res.viewJob.perPlate)}`);
    teardown(E, host);
});

maybe("cycle")("Q2 cycle: bytes posted and geometry re-sent over a zoom out and back", async () => {
    const { E, g, host, hooks } = await setup({});
    const res = RESULTS.cycle = { gitDiff: process.env.GIT_DIFF || null };
    const cx = E.width / 2, cy = E.height / 2;
    // Each posted job read as it is posted (the buffers go back to the pool and are reused): its items by a geometry
    // fingerprint (length and the first and last two numbers; no ids travel on the wire).
    let geomBytes = 0, items = 0, plates = 0, all = 0, jobs = 0;
    const byFp = new Map(), byFpZ = new Set(), byZ = {};
    hooks.onJob = (msg) => {
        const job = unwireJob(msg);
        if (!job || !job.meta) return;
        jobs++;
        const n = job.nItems;
        all += jobBytes(job); geomBytes += job.geom.byteLength; items += n; plates += job.plates.length / 2;
        for (let it = 0; it < n; it++) {
            const gs = job.meta[it * 8 + 2], gl = job.meta[it * 8 + 3];
            const fp = gl + "|" + job.geom[gs] + "|" + job.geom[gs + 1] + "|" + job.geom[gs + gl - 2] + "|" + job.geom[gs + gl - 1];
            const e = byFp.get(fp);
            if (e) e.n++; else byFp.set(fp, { n: 1, bytes: gl * 8 });
            byFpZ.add(fp + "|" + job.Zq);
        }
        const kz = "Z" + (+job.Zq).toPrecision(3);
        byZ[kz] = (byZ[kz] || 0) + 1;
    };
    const w0 = rasterWorkerReport();
    resetPackStats();
    const t0 = perfNow();
    const oct = +(process.env.CYCLE_OCT || 4), pause = +(process.env.CYCLE_PAUSE || 0);
    res.cycleShape = { octaves: oct, pauseMs: pause, rate: "2 oct/s, 60 steps/s" };
    const paperSteps = [];
    for (const dir of [-1, 1]) {
        for (let k = 0; k < 30 * oct; k++) {
            const ts = perfNow();
            E.zoomFactorAt(cx, cy, 2 ** (dir * 2 / 60));
            await g.answer();
            const sh = shares(E);
            if (sh) paperSteps.push(sh.paper || 0);
            const left = 16 - (perfNow() - ts);
            if (left > 0) await sleep(left);
        }
        if (dir < 0 && pause) { const tp = perfNow(); while (perfNow() - tp < pause) { await sleep(16); await g.answer(); await settle(E, 1); } }
    }
    const zoomMs = perfNow() - t0;
    res.paperStepMean = +(paperSteps.reduce((a, b) => a + b, 0) / Math.max(1, paperSteps.length)).toFixed(3);
    await drain(E, g);
    const w1 = rasterWorkerReport();
    let distinctBytes = 0;
    for (const e of byFp.values()) distinctBytes += e.bytes;
    const reps = [...byFp.values()].map((e) => e.n).sort((a, b) => b - a);
    res.cycle = {
        zoomMs: Math.round(zoomMs), totalMs: Math.round(perfNow() - t0), jobs, plates, itemsPacked: items, jobBytesSum: all, geomBytesSum: geomBytes,
        clientBytesOut: w1.bytesOut - w0.bytesOut, clientBytesIn: w1.bytesIn - w0.bytesIn,
        distinctItems: byFp.size, distinctItemZ: byFpZ.size, distinctGeomBytes: distinctBytes, resendFactor: +(geomBytes / Math.max(1, distinctBytes)).toFixed(2),
        repsTop: reps.slice(0, 10), repsMedian: reps[reps.length >> 1], jobsByZ: byZ, packStats: { ...packStats },
    };
    log(`[cycle] ${JSON.stringify(res.cycle)}`);
    teardown(E, host);
});
