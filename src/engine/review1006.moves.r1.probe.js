/**
 * review1006.moves.r1.probe.js — MOVES, the 2026-10-06 review (analysis only, not a test of record).
 * R1's whole drawing (11 natives) in a raster jsdom engine at R1's camera, screen and dpr, its pyramid composited into
 * `softCtx` so the picture can be read pixel by pixel. Q1: the plane's cut for [36, 27] and [27, 31, 36], what the
 * drag, the landing and the selected-but-dropped state draw against the settled picture. Q2: a second drag at
 * 0 / 100 / 300 / 1000 ms after a drop: pick, stopgap, notReady per step. Output: .claude/REVIEW-2026-10-06/moves/.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { planeStats, resetPlaneStats } from "./raster/MovePlane";
import { PLATE_PX } from "./raster/plate";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { runJob, runCut } from "./worker/rasterWorker";
import { softCtx, softCanvas } from "./__testkit__/softCanvas";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";

jest.setTimeout(600000);

const OUT = path.join(REPORT_DIR, "..", ".claude", "REVIEW-2026-10-06", "moves");
const R1 = path.join(REPORT_DIR, "report-2026-10-07T02-57-59-087Z.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const engines = [];
const log = [];
const note = (k, v) => { log.push({ k, v }); console.log(k, JSON.stringify(v)); };

/** A worker pool stand-in: the shipped job `ms` later, `n` at once. */
function transport(ms) {
    return (msg, transfer, kind) => sleep(ms).then(() => (kind ? runCut(kind, msg).msg : runJob(msg, { receivedAt: performance.now() }).then((o) => o.msg)));
}

/** Why `stage.covers` says no: the first failing condition, as `covers` tests them. */
function coversWhy(st, frameId, rect) {
    const shifted = (r, off) => (off[0] || off[1] ? { left: r.left - off[0], top: r.top - off[1], right: r.right - off[0], bottom: r.bottom - off[1] } : r);
    if (!st.frame) return "noFrame";
    if (String(frameId) !== st.frame) return "otherFrame";
    if (st._need) return "need";
    for (const key of st._tileKeys(st.frame, rect)) {
        const k = st._keys.get(key);
        if (!k) return "camUnwatched " + key;
        if (!k.tile) return "camUnread " + key;
        if (st._missing.has(key)) return "camMissing " + key;
    }
    for (const g of st._groups.values()) {
        for (const key of st._tileKeys(g.F0, shifted(rect, g.rem))) {
            const k = st._keys.get(key);
            if (!k || !k.tile || st._missing.has(key)) return "group " + g.gk + " F0 " + g.F0 + " rem " + g.rem.map((x) => +x.toFixed(1)) + " " + (!k ? "unwatched " : !k.tile ? "unread " : "missing ") + key;
        }
    }
    return "ok";
}

async function mk({ workerMs = null, dpr = 1.25, phone = false } = {}) {
    resetRasterWorkerClient(); resetPlaneStats();
    // Kobin's desktop: not the phone budget (jsdom's screen is 0 x 0, which reads as a phone)
    Object.defineProperty(window, "screen", { value: phone ? { width: 390, height: 844 } : { width: 2560, height: 1440 }, configurable: true, writable: true });
    if (workerMs != null) { setRasterWorkerCount(4); setRasterTransport(transport(workerMs)); } else { setRasterTransport(null); setRasterWorkerCount(1); }
    Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true, writable: true });
    const rep = readReportFile(R1), parts = drawingPartsOf(R1);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scr = rep.extract.screen;
    const E = new KobinEngine(host, { width: scr.w, height: scr.h, raster: true });
    engines.push({ E, host });
    E.cfg.compose = "direct";                      // the soft context draws images, not the surface canvas
    loadReport(E, rep, { drawing: parts });
    const L = E.renderer.layer;
    const soft = (w, h) => softCtx(w, h, PLATE_PX, { scaled: true });
    L._ctx = soft(L._canvas.width, L._canvas.height);
    L._mk = (w, h) => softCanvas(soft(w, h));
    const put = E.plates.put.bind(E.plates);
    E.plates.put = (rec) => { if (rec.pixels && !rec.bitmap) rec.bitmap = { pixels: rec.pixels }; return put(rec); };
    // every refusal at the pack, by job kind
    const R = E.renderer, pack = R._pyrPack.bind(R);
    R._refused = [];
    const covers = E.stage.covers.bind(E.stage);
    let why = null;
    E.stage.covers = (f, r) => { const ok = covers(f, r); if (!ok && why) why.push(coversWhy(E.stage, f, r)); return ok; };
    R._pyrPack = (job, jobId, pool) => {
        why = job.table ? null : [];
        const n0 = job.cells.length, out = pack(job, jobId, pool);
        const kept = job.packedCells ? job.packedCells.length : 0;
        if (!out || kept < n0) R._refused.push({ kind: job.kind, tag: job.cells[0] && job.cells[0].tag, asked: n0, kept: out ? kept : 0, why: why ? why.slice(0, 2) : null, t: Math.round(performance.now()) });
        why = null;
        return out;
    };
    E._render();
    await idle(E);
    return E;
}

/** Until the queue is empty and nothing is in flight (and the plane timer has fired), or `ms`. */
async function idle(E, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        await sleep(5);
        const r = E.renderer.queue.report();
        if (!r.queued.some((n) => n) && !r.inFlight.some((n) => n) && E.renderer._planeTimer == null) return Date.now() - t0;
    }
    return -1;
}

afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
    setRasterTransport(null); setRasterWorkerCount(null);
});
afterAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "r1-probe-" + (process.env.PROBE_TAG || "run") + ".json"), JSON.stringify(log, null, 1));
});

/** The drawn box of a native in the camera frame, and its centre on screen (CSS px). */
function placed(E, id) {
    const it = E.stage.itemsOf(id)[0];
    if (!it) return null;
    const p = E.stage.placed(it), b = it.box;
    const box = [b.left + p.off[0], b.top + p.off[1], b.right + p.off[0], b.bottom + p.off[1]];
    const c = E.cam, sx = (x) => x * c.inScale + c.inPanX, sy = (y) => y * c.inScale + c.inPanY;
    return { box, scr: [sx(box[0]), sy(box[1]), sx(box[2]), sy(box[3])], c: [sx((box[0] + box[2]) / 2), sy((box[1] + box[3]) / 2)] };
}

/** The plane as cut: per layer its kind, ids, cell count; the level, the quick level, the cap. */
function planeDump(E) {
    const R = E.renderer, pl = R._plane, v = R._view;
    if (!pl.main) return { refused: pl.refused, state: pl.state };
    const lv = (L) => L && { k: L.k, pZq: +L.pZq.toFixed(4), plates: L.plates, frame: L.frame, layers: L.layers.map((x) => ({ kind: x.kind, k: x.k, hole: !!x.hole, tag: x.tag, cells: x.cells.length, ids: x.ids ? [...x.ids] : undefined, omit: x.omit ? x.omit.size : undefined })) };
    return { state: pl.state, viewZq: +v.Zq.toFixed(4), viewS: v.s, mode: v.mode, viewCells: (v.i1 - v.i0 + 1) * (v.j1 - v.j0 + 1), cap: R.planeCap, main: lv(pl.main), quick: lv(pl.quick), selIds: pl.selIds ? [...pl.selIds] : null, keys: pl.keys.length, ready: pl.ready };
}

/** RGB at CSS points through the soft compose of the last compose. */
const pics = (E, pts) => { const ctx = E.renderer.layer._ctx, d = E.renderer.layer.dpr; return pts.map(([x, y]) => ctx.at(x * d, y * d)); };
const diff = (a, b, tol = 6) => a.reduce((n, p, k) => n + (p.some((c, i) => Math.abs(c - b[k][i]) > tol) ? 1 : 0), 0);

/** A grid of sample points over a CSS rect. */
function grid(r, n = 9) {
    const out = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) out.push([r[0] + ((a + 0.5) * (r[2] - r[0])) / n, r[1] + ((b + 0.5) * (r[3] - r[1])) / n]);
    return out;
}

function stepState(E, s0) {
    const R = E.renderer, pl = R._plane;
    return {
        st: pl.state, cur: pl.cur ? (pl.cur === pl.main ? "main" : pl.cur === pl.quick ? "quick" : "?") : null, partial: pl.partial,
        drawn: !!R.layer._plane, notReady: planeStats.notReady - s0.notReady, stopgaps: planeStats.stopgaps - s0.stopgaps,
        partialSteps: planeStats.partialSteps - s0.partialSteps, quickSteps: planeStats.quickSteps - s0.quickSteps, refused: R._refused.length,
    };
}

async function selectAndWait(E, ids) {
    E.setTool("select");
    E._setSelection(ids, []);
    E._render();
    const pl = E.renderer._plane, t0 = Date.now();
    while (Date.now() - t0 < 6000 && !(pl.main && pl.checkReady(E.plates))) await sleep(10);
    return Date.now() - t0;
}

/** The Stage's reroute groups: each one's source frame, remainder, members and its watched tiles' state. */
function groupsOf(E) {
    const st = E.stage, out = [];
    for (const g of st._groups.values()) {
        const keys = [...g.keys].map((key) => { const k = st._keys.get(key); return key + ":" + (!k ? "unwatched" : !k.tile ? "unread" : st._missing.has(key) ? "missing" : "read"); });
        out.push({ gk: g.gk, F0: g.F0, rem: g.rem, ids: [...g.ids], frameExists: !!E.lm.frame(g.F0), keys });
    }
    return { frame: st.frame, window: st.window, missing: [...st._missing], groups: out };
}

describe("R1 (MOVES review)", () => {
    test("Q1seq Kobin's 13 moves of [36, 27] (journal), engine A as shipped against engine B settled (GC inert), whole screen", async () => {
        // the journal's [36, 27] moves, in camera-frame units (inScale 13.0016): Kobin's displacements and their order
        const rep = readReportFile(R1);
        const moves = rep.history.journal.filter((e) => e.kind === "move" && e.moves.length === 2 && e.moves.some((m) => m.id === 36)).map((e) => [e.moves[0].dx, e.moves[0].dy]);
        const A = await mk({ workerMs: 12 });
        const B = await mk({ workerMs: 12 });
        B._gcCand = { size: 0, add() {}, clear() {}, delete() {}, has() { return false; }, [Symbol.iterator]: function* () {} };
        for (const E of [A, B]) await selectAndWait(E, [36, 27]);
        const W = A.width, H = A.height, pts = [];
        for (let y = 18; y < H; y += 36) for (let x = 18; x < W; x += 36) pts.push([x, y]);
        const cellOf = (E, [x, y]) => { const v = E.renderer._view, d = E.renderer.layer.dpr; return Math.floor(((x * d - v.dx) / v.s + v.ox) / PLATE_PX) + "," + Math.floor(((y * d - v.dy) / v.s + v.oy) / PLATE_PX); };
        const wrongs = (a, b) => { const out = []; for (let k = 0; k < a.length; k++) if (a[k].some((c, i) => Math.abs(c - b[k][i]) > 8)) out.push(k); return out; };
        const rows = [];
        for (let m = 0; m < moves.length; m++) {
            const s0 = { ...planeStats };
            const sc = A.cam.inScale, [dx, dy] = [moves[m][0] * sc, moves[m][1] * sc];
            const a = placed(A, 36);
            // the drag: 20 steps, 32 ms apart; B the same pointer path
            for (const E of [A, B]) E.pointerDown(a.c[0], a.c[1]);
            const steps = [];
            for (let k = 1; k <= 20; k++) {
                for (const E of [A, B]) E.pointerMove(a.c[0] + (dx * k) / 20, a.c[1] + (dy * k) / 20);
                await sleep(32);
                const st = stepState(A, s0);
                steps.push(st.cur ? (st.partial ? "P" : st.cur[0].toUpperCase()) : "-");
            }
            for (const E of [A, B]) E.pointerUp();
            const t0 = performance.now();
            const lp = A.renderer.pyramid.lastPatch;
            const shots = [];
            for (const w of [50, 300, 600]) {
                await sleep(Math.max(0, w - (performance.now() - t0)));
                A.renderer.layer.compose();
                shots.push({ t: w, st: A.renderer._plane.state, pic: pics(A, pts) });
            }
            // B settled: everything exact at this document state (a render re-mints, then idle)
            await idle(B); B._render(); await idle(B); B.renderer.layer.compose();
            const truth = pics(B, pts);
            const same = A.doc.getById(36).obj.below.join() === B.doc.getById(36).obj.below.join() && A.doc.getById(27).obj.below.join() === B.doc.getById(27).obj.below.join();
            rows.push({
                m, steps: steps.join(""), sameDoc: same, patch: lp && { T: lp.T, inline: lp.inline, coarse: lp.coarse && lp.coarse.level },
                shots: shots.map((x) => { const w = wrongs(x.pic, truth); const cells = {}; for (const k of w) { const c = cellOf(A, pts[k]); cells[c] = (cells[c] || 0) + 1; } return { t: x.t, st: x.st, wrong: w.length, cells }; }),
                refusedSoFar: A.renderer._refused.length,
            });
            await sleep(200);
        }
        // the deselect, as a tap would make it, then a render
        A.renderer.layer.compose();
        const preDes = pics(A, pts);
        A.deselect(); A.renderer.layer.compose();
        const atDes = pics(A, pts);
        await sleep(400); A.renderer.layer.compose();
        const afterDes = pics(A, pts);
        await idle(B); B.deselect(); await idle(B); B._render(); await idle(B); B.renderer.layer.compose();
        const truth = pics(B, pts);
        A._render(); await idle(A); A.renderer.layer.compose();
        const afterRender = pics(A, pts);
        note("q1seq", { moves: moves.length, points: pts.length, rows,
            deselect: { preDes: wrongs(preDes, truth).length, atDes: wrongs(atDes, truth).length, afterDes400: wrongs(afterDes, truth).length, afterRender: wrongs(afterRender, truth).length } });
    });

    test("Q2c the control: frame GC neutralised, a second drag 0 / 100 / 300 / 600 / 1000 ms after the drop", async () => {
        for (const sel of [[27], [36, 27]]) {
            for (const workerMs of [12, 40]) {
                for (const gap of [0, 100, 300, 600, 1000]) {
                    const E = await mk({ workerMs });
                    // no frame is ever a GC candidate: the picture-source frames stay (the Q2 cause taken away)
                    E._gcCand = { size: 0, add() {}, clear() {}, delete() {}, has() { return false; }, [Symbol.iterator]: function* () {} };
                    await selectAndWait(E, sel);
                    const pl = E.renderer._plane;
                    const cut = { k: pl.main && pl.main.k, plates: pl.main && pl.main.plates, quick: pl.quick ? pl.quick.plates : 0 };
                    const p0 = placed(E, sel[sel.length - 1]);
                    E.pointerDown(p0.c[0], p0.c[1]);
                    for (let k = 1; k <= 10; k++) { E.pointerMove(p0.c[0] + k * 8, p0.c[1] + k * 4); await sleep(16); }
                    E.pointerUp();
                    const dropAt = performance.now();
                    const lp = E.renderer.pyramid.lastPatch;
                    // the landing and the re-aim, as they happen
                    const trace = [];
                    while (performance.now() - dropAt < gap) {
                        trace.push({ t: Math.round(performance.now() - dropAt), st: pl.state, layers: pl.layers.length, ready: pl.ready, timer: E.renderer._planeTimer != null });
                        await sleep(Math.min(20, Math.max(1, gap - (performance.now() - dropAt))));
                    }
                    const s1 = { ...planeStats };
                    const p1 = placed(E, sel[sel.length - 1]);
                    const before2 = { st: pl.state, layers: pl.layers.length, ready: pl.ready };
                    E.pointerDown(p1.c[0], p1.c[1]);
                    const t1 = performance.now(), d2 = [];
                    for (let k = 1; k <= 20; k++) {
                        E.pointerMove(p1.c[0] + k * 8, p1.c[1] + k * 4);
                        await sleep(16);
                        d2.push({ ms: Math.round(performance.now() - t1), ...stepState(E, s1) });
                    }
                    E.pointerUp();
                    await idle(E);
                    const firstDrawn = d2.findIndex((x) => x.drawn && !x.partial);
                    note("q2c." + sel.join("_") + ".w" + workerMs + ".gap" + gap, {
                        cut, patch: lp && { T: lp.T, inline: lp.inline, coarse: lp.coarse }, before2,
                        trace: trace.filter((x, i) => i === 0 || x.st !== trace[i - 1].st || x.layers !== trace[i - 1].layers || x.ready !== trace[i - 1].ready),
                        steps: d2.map((x) => (x.cur ? (x.partial ? "P" : x.cur[0].toUpperCase()) : "-")).join(""),
                        firstDrawnMs: firstDrawn >= 0 ? d2[firstDrawn].ms : null, notReady: d2[d2.length - 1].notReady, stopgaps: d2[d2.length - 1].stopgaps,
                        quickSteps: d2[d2.length - 1].quickSteps, refused: E.renderer._refused.length, lands: planeStats.lands, landTimeouts: planeStats.landTimeouts,
                    });
                    { const e = engines.pop(); e.E.destroy(); e.host.remove(); }
                }
            }
        }
    });

    test("Q2e what a select and a deselect do in the GC gap: the stale cells, the cover, the next drag", async () => {
        const staleCells = (E) => { const v = E.renderer._view, L = E.renderer.layer; let n = 0; for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) if (!L.cellFresh(v, i, j)) n++; return n; };
        const coverView = (E) => E.stage.covers(E.cam.frame, E.cam.frameWindow(0));
        const out = {};
        for (const after of ["deselect", "reselect", "nothing"]) {
            const E = await mk({ workerMs: 12 });
            await selectAndWait(E, [36, 27]);
            const a = placed(E, 36);
            E.pointerDown(a.c[0], a.c[1]);
            for (let k = 1; k <= 12; k++) { E.pointerMove(a.c[0] + k * 10, a.c[1] + k * 5); await sleep(16); }
            E.pointerUp();
            await sleep(1000);
            const before = { stale: staleCells(E), cover: coverView(E), plane: E.renderer._plane.state, refused: E.renderer._refused.length };
            if (after === "deselect") E.deselect();
            if (after === "reselect") E._setSelection([36, 27], []);
            const at = { stale: staleCells(E), cover: coverView(E) };
            await idle(E);
            const later = { stale: staleCells(E), cover: coverView(E), refused: E.renderer._refused.length };
            let drag = null;
            if (after !== "deselect") {
                const s1 = { ...planeStats }, b = placed(E, 36), seq = [];
                await sleep(200);
                E.pointerDown(b.c[0], b.c[1]);
                for (let k = 1; k <= 12; k++) { E.pointerMove(b.c[0] - k * 10, b.c[1] + k * 5); await sleep(16); const x = stepState(E, s1); seq.push(x.cur ? (x.partial ? "P" : x.cur[0].toUpperCase()) : "-"); }
                E.pointerUp();
                drag = seq.join("");
            }
            out[after] = { before, at, later, drag };
            { const e = engines.pop(); e.E.destroy(); e.host.remove(); }
        }
        note("q2e", out);
    });

    test("Q2d after a drop's GC, a 3 px pan: the reroute re-diff, the cover, the displaced strokes, the next drag's picture", async () => {
        const A = await mk({ workerMs: 12 });
        const B = await mk({ workerMs: 12 });
        B._gcCand = { size: 0, add() {}, clear() {}, delete() {}, has() { return false; }, [Symbol.iterator]: function* () {} };
        for (const E of [A, B]) await selectAndWait(E, [27]);
        const W = A.width, H = A.height, pts = [];
        for (let y = 18; y < H; y += 36) for (let x = 18; x < W; x += 36) pts.push([x, y]);
        const p0 = placed(A, 27);
        for (const E of [A, B]) E.pointerDown(p0.c[0], p0.c[1]);
        for (let k = 1; k <= 10; k++) { for (const E of [A, B]) E.pointerMove(p0.c[0] + k * 8, p0.c[1] + k * 4); await sleep(16); }
        for (const E of [A, B]) E.pointerUp();
        for (const E of [A, B]) await idle(E);
        const offs = (E) => [2, 33, 34].map((id) => { const it = E.stage.itemsOf(id); return { id, items: it.length, off: it.length ? it[0].off.map((x) => +x.toFixed(1)) : null, key: it.length ? it[0].key : null }; });
        const coverView = (E) => E.stage.covers(E.cam.frame, E.cam.frameWindow(0));
        const st0 = { groups: groupsOf(A).groups.map((g) => g.F0 + (g.frameExists ? "" : " (gone)")), cover: coverView(A), items: A.stage.items().length, offs: offs(A) };
        // the pan: 3 CSS px, no crossing, both engines
        for (const E of [A, B]) { E.panBy(3, 0); E.flush && E.flush(); }
        for (const E of [A, B]) await idle(E);
        await sleep(400);
        for (const E of [A, B]) await idle(E);
        const st1 = { groups: groupsOf(A).groups.map((g) => g.F0 + (g.frameExists ? "" : " (gone)")), cover: coverView(A), items: A.stage.items().length, offs: offs(A), refused: A.renderer._refused.length };
        A.renderer.layer.compose();
        await idle(B); B._render(); await idle(B); B.renderer.layer.compose();
        const truth1 = pics(B, pts), pan1 = pics(A, pts);
        const wrong1 = pan1.reduce((n, p, k) => n + (p.some((c, i) => Math.abs(c - truth1[k][i]) > 8) ? 1 : 0), 0);
        // the next drag on A after the pan
        const s1 = { ...planeStats };
        const p1 = placed(A, 27);
        A.pointerDown(p1.c[0], p1.c[1]);
        const seq = [];
        for (let k = 1; k <= 12; k++) { A.pointerMove(p1.c[0] - k * 8, p1.c[1] + k * 4); await sleep(16); const x = stepState(A, s1); seq.push(x.cur ? (x.partial ? "P" : x.cur[0].toUpperCase()) : "-"); }
        A.renderer.layer.compose();
        const dragPic = pics(A, pts);
        A.pointerUp();
        await idle(A);
        // B the same drag, settled, as the truth for the drag's end position
        B.pointerDown(p1.c[0], p1.c[1]);
        for (let k = 1; k <= 12; k++) { B.pointerMove(p1.c[0] - k * 8, p1.c[1] + k * 4); await sleep(16); }
        B.pointerUp(); await idle(B); B._render(); await idle(B); B.renderer.layer.compose();
        const truth2 = pics(B, pts);
        const wrongDrag = dragPic.reduce((n, p, k) => n + (p.some((c, i) => Math.abs(c - truth2[k][i]) > 8) ? 1 : 0), 0);
        A.renderer.layer.compose();
        const afterDrop2 = pics(A, pts);
        const wrongAfter2 = afterDrop2.reduce((n, p, k) => n + (p.some((c, i) => Math.abs(c - truth2[k][i]) > 8) ? 1 : 0), 0);
        note("q2d", { afterDrop: st0, afterPan: st1, panPictureWrong: wrong1, points: pts.length, nextDrag: seq.join(""), dragPictureWrong: wrongDrag, afterDrop2Wrong: wrongAfter2 });
    });

    test("Q2b after a drop: the reroute groups, their tiles and the plane's cover, polled for 3 s", async () => {
        const E = await mk({ workerMs: 12 });
        note("q2b.groups.atLoad", groupsOf(E));
        const id = 27;
        await selectAndWait(E, [id]);
        note("q2b.groups.selected", groupsOf(E));
        const p0 = placed(E, id);
        E.pointerDown(p0.c[0], p0.c[1]);
        for (let k = 1; k <= 10; k++) { E.pointerMove(p0.c[0] + k * 8, p0.c[1] + k * 4); await sleep(16); }
        // what syncs run with a budget (the idle reads) from here
        const sync = E.stage.sync.bind(E.stage), syncs = [];
        E.stage.sync = (F, win, ms) => { syncs.push({ t: Math.round(performance.now()), ms: ms === Infinity ? "inf" : ms }); return sync(F, win, ms); };
        const readTiles = E.store.readTiles.bind(E.store), reads = [];
        E.store.readTiles = (cells, ms) => { const r = readTiles(cells, ms); reads.push({ t: Math.round(performance.now()), asked: cells.map((c) => c.join(":")).slice(0, 6), got: r.tiles.size, missing: r.missing.slice(0, 6).map((c) => (Array.isArray(c) ? c.join(":") : String(c))) }); return r; };
        E.pointerUp();
        const t0 = performance.now();
        note("q2b.groups.afterDrop", groupsOf(E));
        const poll = [];
        for (let k = 0; k < 30; k++) {
            await sleep(100);
            const pl = E.renderer._plane;
            const g = groupsOf(E);
            poll.push({ t: Math.round(performance.now() - t0), pl: pl.state, layers: pl.layers.length, ready: pl.ready, unread: g.groups.reduce((n, x) => n + x.keys.filter((q) => !q.endsWith(":read")).length, 0), missing: g.missing.length, refused: E.renderer._refused.length });
        }
        note("q2b.poll", { poll, syncs: syncs.slice(0, 40), reads: reads.slice(0, 20), refused: E.renderer._refused.slice(0, 10) });
        note("q2b.groups.end", groupsOf(E));
    });

    test("Q1 the cut, the drag, the landing and the selected state for [36, 27] and [27, 31, 36]", async () => {
        for (const sel of [[36, 27], [27, 31, 36]]) {
            const E = await mk({ workerMs: 12 });
            const ms = await selectAndWait(E, sel);
            note("q1.cut." + sel.join("_"), { aimMs: ms, plane: planeDump(E), stats: { ...planeStats } });
            const a = placed(E, sel[0]), all = sel.map((id) => placed(E, id));
            note("q1.placed." + sel.join("_"), all.map((p) => p && { box: p.box.map((x) => +x.toFixed(1)), c: p.c.map((x) => +x.toFixed(1)) }));
            const DX = 120, DY = 60;
            // where the selection is now and where it will be: the union of every member's screen box, both places
            const u = [Infinity, Infinity, -Infinity, -Infinity];
            for (const p of all) for (const [dx, dy] of [[0, 0], [DX, DY]]) { u[0] = Math.min(u[0], p.scr[0] + dx); u[1] = Math.min(u[1], p.scr[1] + dy); u[2] = Math.max(u[2], p.scr[2] + dx); u[3] = Math.max(u[3], p.scr[3] + dy); }
            const pts = grid(u, 12);
            const before = pics(E, pts);
            const s0 = { ...planeStats };
            E.pointerDown(a.c[0], a.c[1]);
            const steps = [];
            for (let k = 1; k <= 12; k++) {
                E.pointerMove(a.c[0] + (DX * k) / 12, a.c[1] + (DY * k) / 12);
                await sleep(16);
                steps.push(stepState(E, s0));
            }
            const lastDrag = pics(E, pts);
            E.pointerUp();
            const land = [];
            const t0 = performance.now();
            const lp = E.renderer.pyramid.lastPatch;
            land.push({ t: 0, ...stepState(E, s0), patch: lp && { cells: lp.cells, T: lp.T, budget: lp.budget, inline: lp.inline, coarse: lp.coarse }, pic: pics(E, pts) });
            for (const w of [16, 50, 100, 200, 400, 800, 1600, 3200]) {
                await sleep(Math.max(0, w - (performance.now() - t0)));
                E.renderer.layer.compose();
                land.push({ t: Math.round(performance.now() - t0), ...stepState(E, s0), pic: pics(E, pts) });
            }
            await idle(E);
            E.renderer.layer.compose();
            const selectedSettled = pics(E, pts);
            E.deselect();
            E.renderer.layer.compose();
            const atDeselect = pics(E, pts);
            await idle(E);
            await sleep(300);
            E._render(); await idle(E);
            E.renderer.layer.compose();
            const truth = pics(E, pts);
            note("q1.drag." + sel.join("_"), { steps, refusedAtPack: E.renderer._refused.slice(0, 40) });
            note("q1.compare." + sel.join("_"), {
                points: pts.length,
                beforeVsTruth: diff(before, truth),
                lastDragVsTruth: diff(lastDrag, truth),
                land: land.map((x) => ({ t: x.t, st: x.st, cur: x.cur, drawn: x.drawn, patch: x.patch, wrong: diff(x.pic, truth) })),
                selectedSettledVsTruth: diff(selectedSettled, truth),
                atDeselectVsTruth: diff(atDeselect, truth),
                wrongAt: lastDrag.map((p, k) => (p.some((c, i) => Math.abs(c - truth[k][i]) > 6) ? { at: pts[k].map(Math.round), drag: p, truth: truth[k] } : null)).filter(Boolean).slice(0, 12),
            });
        }
    });

    test("Q2 one object: the first drag at once and after the plane, then a second drag 0 / 100 / 300 / 1000 ms after the drop", async () => {
        for (const workerMs of [12, 40]) {
            for (const gap of [0, 100, 300, 1000]) {
                const E = await mk({ workerMs });
                const id = 27;
                E.setTool("select");
                E._setSelection([id], []);
                E._render();
                const p0 = placed(E, id);
                // the first drag at once: Kobin's "right after I selected one"
                const s0 = { ...planeStats };
                const at = [p0.c[0], p0.c[1]];
                await sleep(gap === 0 ? 0 : 200);           // a pause after the select, as a hand makes
                E.pointerDown(at[0], at[1]);
                const d1 = [];
                for (let k = 1; k <= 10; k++) { E.pointerMove(at[0] + k * 8, at[1] + k * 4); await sleep(16); d1.push(stepState(E, s0)); }
                E.pointerUp();
                const dropAt = performance.now();
                const afterDrop = stepState(E, s0);
                await sleep(gap);
                const s1 = { ...planeStats };
                const p1 = placed(E, id);
                const st0 = { pl: E.renderer._plane.state, layers: E.renderer._plane.layers.length, ready: E.renderer._plane.ready };
                E.pointerDown(p1.c[0], p1.c[1]);
                const t1 = performance.now();
                const d2 = [];
                for (let k = 1; k <= 20; k++) {
                    E.pointerMove(p1.c[0] + k * 8, p1.c[1] + k * 4);
                    await sleep(16);
                    // does any drawn source show the object at the pointer? the soft compose at the moved centre against the old
                    const c = [p1.c[0] + k * 8, p1.c[1] + k * 4];
                    const [atNew] = pics(E, [c]);
                    d2.push({ ms: Math.round(performance.now() - t1), ...stepState(E, s1), atNew });
                }
                E.pointerUp();
                await idle(E);
                note("q2.w" + workerMs + ".gap" + gap, { dropToPress: Math.round(t1 - dropAt), afterDrop, before2: st0, d1, d2, refused: E.renderer._refused.length,
                    refusedFirst: E.renderer._refused.slice(0, 6), groups: groupsOf(E) });
                { const e = engines.pop(); e.E.destroy(); e.host.remove(); }
            }
        }
    });
});
