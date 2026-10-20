/**
 * review1012.audit.q5.probe.js — PERF-DEEP agent B (AUDIT), Q5: a memory census by structure, forced GC (`--expose_gc`
 * through V8's flags, as `review1006.mem.keep.probe.js`). A report's whole drawing (R4 default, REPORT=… for R6) in a
 * raster engine on Kobin's screen and desktop budget, rendered and drained (every job answered by `runJob`), then each
 * structure released in turn and the heap read after a forced collection: the plates (raw pixels in jsdom; GPU bitmaps
 * in Chrome), the pack memo, the reroute memo, the Stage's logs, the tiles, the Stage's table, the engine, the document,
 * the lattice. Case `history` (R4): twenty drops and eight eraser strokes, then what the undo history holds, and what a
 * save's serialisation allocates. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1012.audit.q5.probe.js"
 * Q5_CASE=census|history.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob, runCut } from "./worker/rasterWorker";
import { clearPackCaches, packMemoBytes, packStats } from "./raster/rasterPack";
import { encodeObjects } from "./format2";

const v8 = require("v8");
const vm = require("vm");
v8.setFlagsFromString("--expose_gc");
const gcFn = vm.runInNewContext("gc");
const heap = () => { gcFn(); gcFn(); const m = process.memoryUsage(); return m.heapUsed + (m.arrayBuffers || 0); };
const ext = () => process.memoryUsage().external + (process.memoryUsage().arrayBuffers || 0);
const MB = (b) => +(b / 1048576).toFixed(2);
const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "audit");
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(40 * 60 * 1000);
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESULTS = {};

function gate() {
    const parked = [];
    const g = { parked };
    setRasterTransport((msg, transfer, kind) => (kind ? Promise.resolve(runCut(kind, msg).msg) : new Promise((resolve) => parked.push({ msg, resolve }))));
    g.answer = async () => { let n = 0; while (parked.length) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); n++; } for (let t = 0; t < 3; t++) await tick(); return n; };
    return g;
}
async function settle(E, n = 2) { for (let k = 0; k < n; k++) { E.renderer.syncCameraOnly(); for (let m = 0; m < 4; m++) await tick(); } }
function busy(E, g) { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); }
async function drain(E, g, rounds = 6) {
    for (let round = 0; round < rounds; round++) {
        let did = 0;
        for (let k = 0; k < 600 && busy(E, g); k++) { did += await g.answer(); await settle(E, 1); }
        await sleep(180); await settle(E, 2);
        if (!busy(E, g) && did === 0) return round;
    }
    return rounds;
}

/** What the document holds: natives, loops, pieces, the loops' typed-array bytes. */
function docCensus(E) {
    let natives = 0, loops = 0, pieces = 0, bufBytes = 0, idxBytes = 0, tables = 0, withBox = 0;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) {
        natives++;
        if (o.below) tables++;
        if (o._bbox) withBox++;
        for (const L of o.loops || []) { loops++; pieces += L.length; if (L.buf) bufBytes += L.buf.byteLength; const ix = "_idx" in L ? L._idx : L.idx; if (ix) idxBytes += ix.byteLength; }   // `_idx`: reading `idx` would build it
    }
    return { natives, loops, pieces, bufMB: MB(bufBytes), idxMB: MB(idxBytes), tables, withBox };
}
function tileCensus(E) {
    let tiles = 0, pieces = 0, loops = 0, bytes = 0, polys = 0, pts = 0;
    for (const t of E.store.cache.values()) {
        tiles++;
        for (const p of t.objs || []) {
            pieces++;
            for (const L of p.loops || []) { loops++; if (L.buf) bytes += L.buf.byteLength; }
            for (const r of p.polys || []) { polys++; pts += r.length; }
        }
    }
    return { tiles, pieces, loops, loopMB: MB(bytes), polys, polyPoints: pts };
}

afterAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "q5-" + (process.env.Q5_CASE || "all") + "-" + (process.env.REPORT ? process.env.REPORT.slice(18, 26) : "R4") + ".json"), JSON.stringify(RESULTS, null, 1));
});
const only = process.env.Q5_CASE;
const maybe = (n) => (only && only !== n ? test.skip : test);

async function load(name) {
    resetRasterWorkerClient(); setRasterWorkerCount(4);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true, writable: true });
    Object.defineProperty(window, "screen", { value: { width: 2560, height: 1440 }, configurable: true, writable: true });
    const g = gate();
    const f = path.join(REPORT_DIR, name);
    const H = { base: heap(), extBase: ext() };
    let rep = readReportFile(f), parts = drawingPartsOf(f);
    H.reportObjects = heap() - H.base;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: rep.extract.screen.w, height: rep.extract.screen.h, raster: true });
    loadReport(E, rep, { drawing: parts });
    const sel = rep.moves && rep.moves.selection ? rep.moves.selection : null;
    rep = null; parts = null;
    H.loaded = heap() - H.base;
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    E.lm.forget = () => false;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
    E.setTool("select");
    if (sel) E._setSelection(sel.ids, sel.frames, true);
    E._render();
    await drain(E, g);
    H.rendered = heap() - H.base;
    return { E, g, host, H, sel };
}

maybe("census")("Q5 census by structure", async () => {
    const name = process.env.REPORT || "report-2026-10-07T03-24-11-129Z.json";
    const { E, host, H } = await load(name);
    const res = RESULTS.census = { report: name, gitDiff: process.env.GIT_DIFF || null };
    res.doc = docCensus(E);
    res.tilesBefore = tileCensus(E);
    res.stage = { items: E.stage._list.size, keys: E.stage._keys.size, groups: E.stage._groups.size, gOf: E.stage._gOf.size, cells: E.stage._cells.size, dirtLog: E.stage._dirtLog.length, log: E.stage._log.length };
    res.rr = E.store._rrMemo ? { entries: E.store._rrMemo.size, moved: [...E.store._rrMemo.values()].reduce((a, m) => a + m.moved.size, 0) } : null;
    res.plates = { records: E.plates.cache.size, bytesMB: MB(E.plates.bytes) };
    res.packMemo = { memoMB: MB(packMemoBytes()), entries: packStats.memoEntries, recs: packStats.recs };
    res.lattice = { frames: E.lm.frames.size };
    const steps = [];
    let prev = heap();
    const step = (label, fn) => { fn(); const h = heap(); steps.push({ label, freedMB: MB(prev - h), heapMB: MB(h - H.base) }); prev = h; };
    step("plates (dropAll; jsdom keeps raw pixels, Chrome GPU bitmaps)", () => { E.plates.dropAll(); E.renderer.pyramid._freeSurface(); });
    step("pack memo (clearPackCaches)", () => clearPackCaches());
    step("reroute memo (_rrMemo)", () => { if (E.store._rrMemo) E.store._rrMemo.clear(); });
    step("Stage dirt log and delta log", () => { E.stage._dirtLog = []; E.stage._log = []; E.stage._landed.clear(); });
    step("tiles (and the Stage's tile items)", () => E.store._clearTiles());
    step("the Stage's table", () => E.stage._clearTable());
    const doc = E.doc, lm = E.lm;
    step("the engine (destroy; document and lattice kept)", () => { E.destroy(); host.remove(); setRasterTransport(null); });
    step("the document", () => { doc._undo = []; doc._redo = []; doc._groups = null; doc._offLog = []; doc._subs.clear(); doc._replace({ 0: [] }, true); });
    step("the lattice", () => { if (lm.frames) lm.frames.clear(); });
    res.heap = { reportObjectsMB: MB(H.reportObjects), loadedMB: MB(H.loaded), renderedMB: MB(H.rendered) };
    res.steps = steps;
    res.perNative = { docBytesPerNative: null };
    const docStep = steps.find((s) => s.label === "the document");
    if (docStep) {
        const raw = (res.doc.bufMB + res.doc.idxMB) * 1048576;
        res.perNative = { heapPerNativeB: Math.round((docStep.freedMB * 1048576) / res.doc.natives), rawPerNativeB: Math.round(raw / res.doc.natives),
            heapPerPieceB: +((docStep.freedMB * 1048576) / res.doc.pieces).toFixed(1), rawPerPieceB: +(raw / res.doc.pieces).toFixed(1) };
    }
    log(`[census ${name.slice(18, 26)}] ${JSON.stringify({ heap: res.heap, doc: res.doc, tiles: res.tilesBefore, stage: res.stage, rr: res.rr, plates: res.plates, packMemo: res.packMemo, lattice: res.lattice, perNative: res.perNative })}`);
    for (const s of steps) log(`   ${s.label}: freed ${s.freedMB} MB, heap now ${s.heapMB} MB over the base`);
});

maybe("history")("Q5 history: drops, erases, the undo history, a save's serialisation (R4)", async () => {
    const name = process.env.REPORT || "report-2026-10-07T03-24-11-129Z.json";
    const { E, g, host, H } = await load(name);
    const res = RESULTS.history = { report: name, gitDiff: process.env.GIT_DIFF || null, renderedMB: MB(H.rendered) };
    const cx = E.width / 2, cy = E.height / 2;
    let h0 = heap();
    // Twenty drops of the selection, 20 px each way.
    for (let k = 0; k < 20; k++) {
        const s = k % 2 ? -1 : 1;
        E._dragSel = { start: [cx, cy], moved: false };
        E._beginHold();
        for (let st = 1; st <= 4; st++) E._dragSelection(cx + (s * 20 * st) / 4, cy + (s * 12 * st) / 4);
        E._pointerUp();
        await g.answer();
    }
    await drain(E, g, 3);
    let h1 = heap();
    res.drops = { ops: E.doc._undo.length, retainedMB: MB(h1 - h0) };
    // Eight eraser strokes across the view, each baked (cuts inline).
    E.deselect();
    const before = { natives: docCensus(E).natives, pieces: docCensus(E).pieces };
    const t0 = Date.now();
    for (let k = 0; k < 8; k++) {
        const y = cy - 160 + k * 40;
        E.setEraserSize(24);
        E.setTool("erasePartial");
        E.pointerDown(cx - 500, y);
        for (let x = cx - 500; x <= cx + 500; x += 25) E.pointerMove(x, y + (x % 50 ? 6 : -6));
        E.pointerUp();
        E.flushErases();
        await g.answer();
    }
    const eraseMs = Date.now() - t0;
    await drain(E, g, 3);
    const h2 = heap();
    const after = docCensus(E);
    res.erases = { strokes: 8, ms: eraseMs, ops: E.doc._undo.length, nativesBefore: before.natives, nativesAfter: after.natives, piecesBefore: before.pieces, piecesAfter: after.pieces, retainedMB: MB(h2 - h1) };
    const last = E.doc._undo.slice(-8).map((op) => ({ op: op.op, baked: op.baked ? op.baked.length : undefined, keys: Object.keys(op).slice(0, 8) }));
    res.lastOps = last;
    // A save's serialisation, as the autosaver builds it: every frame's snapshot and the drawing envelope.
    const mu = () => { const m = process.memoryUsage(); return m.heapUsed + (m.arrayBuffers || 0); };
    const hs = mu();
    const t1 = Date.now();
    const snaps = {};
    for (const L of Object.keys(E.nativesByLevel)) snaps[L] = encodeObjects(E.doc.at(L));
    const env = E.serializeDrawing({}, { frames: [] });
    const serMs = Date.now() - t1;
    const he = mu();
    let geo = 0; for (const s of Object.values(snaps)) geo += s.geo ? s.geo.byteLength : 0;
    res.serialise = { ms: serMs, allocatedMB: MB(he - hs), snapshotGeoMB: MB(geo), envelopeKeys: Object.keys(env).length };
    // What the undo history holds: dropped, not set aside (a local holding the ops kept them: 0.25 MB was that error).
    const h3 = heap();
    E.doc._undo.length = 0; E.doc._redo.length = 0;
    res.undoHoldsMB = MB(h3 - heap());
    log(`[history ${name.slice(18, 26)}] ${JSON.stringify(res)}`);
    E.destroy(); host.remove(); setRasterTransport(null); setRasterWorkerCount(null);
});

maybe("serial")("Q5 serial: one save's serialisation and the pack memo after a zoom cycle", async () => {
    const name = process.env.REPORT || "report-2026-10-07T03-24-11-129Z.json";
    const { E, g, host, H } = await load(name);
    const res = RESULTS.serial = { report: name, gitDiff: process.env.GIT_DIFF || null, renderedMB: MB(H.rendered) };
    const mu = () => { const m = process.memoryUsage(); return m.heapUsed + (m.arrayBuffers || 0); };
    const h0 = heap(), a0 = mu();
    const t1 = Date.now();
    const snaps = {};
    for (const L of Object.keys(E.nativesByLevel)) snaps[L] = encodeObjects(E.doc.at(L));
    const env = E.serializeDrawing({}, { frames: [] });
    const serMs = Date.now() - t1;
    const a1 = mu();
    let geo = 0; for (const x of Object.values(snaps)) geo += x.geo ? x.geo.byteLength : 0;
    res.serialise = { ms: serMs, allocatedMB: MB(a1 - a0), snapshotGeoMB: MB(geo), envelopeKeys: Object.keys(env).length };
    for (const L of Object.keys(snaps)) delete snaps[L];
    res.afterSerialiseRetainedMB = MB(heap() - h0);
    // The pack memo across a zoom cycle (6 octaves out and back at 2 octaves/s, jobs answered at once).
    const cx = E.width / 2, cy = E.height / 2, m0 = packMemoBytes();
    const t2 = Date.now();
    for (const dir of [-1, 1]) for (let k = 0; k < 180 && Date.now() - t2 < 120000; k++) { E.zoomFactorAt(cx, cy, 2 ** (dir * 2 / 60)); await g.answer(); await sleep(4); }
    await drain(E, g, 2);
    res.memo = { beforeMB: MB(m0), afterMB: MB(packMemoBytes()), entries: packStats.memoEntries, evictions: packStats.evictions, cycleMs: Date.now() - t2 };
    log(`[serial ${name.slice(18, 26)}] ${JSON.stringify(res)}`);
    E.destroy(); host.remove(); setRasterTransport(null); setRasterWorkerCount(null);
});
