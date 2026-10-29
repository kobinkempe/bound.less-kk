/**
 * review1006.moves.r3r4.probe.js — MOVES, the 2026-10-06 review (analysis only, not a test of record).
 * R3's and R4's whole drawings (2,664 natives) in a raster jsdom engine at each report's camera, screen and dpr, on
 * Kobin's desktop budget. Q3: the plane's cut for R3's selection [3287] (its level k, plates per layer, the quick level,
 * the far levels), what each drag step draws and at what resolution, the drop's patch. Q4: R4's selection [3326]: the
 * far levels and whether a level packed from the camera's table holds paper where ink is.
 * Run alone with NODE_OPTIONS=--max-old-space-size=8192. Output: .claude/REVIEW-2026-10-06/moves/.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import MovePlane, { planeStats, resetPlaneStats } from "./raster/MovePlane";
import { PLATE_PX } from "./raster/plate";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { runJob, runCut } from "./worker/rasterWorker";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { planeCell } from "./raster/PyramidStore";
import { paintFamilies } from "./raster/rasterPack";
import { loadReport } from "./report";

jest.setTimeout(1800000);

const OUT = path.join(REPORT_DIR, "..", ".claude", "REVIEW-2026-10-06", "moves");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const engines = [];
const log = [];
const note = (k, v) => { log.push({ k, v }); console.log(k, JSON.stringify(v).slice(0, 4000)); };

function transport(ms) {
    return (msg, transfer, kind) => sleep(ms).then(() => (kind ? runCut(kind, msg).msg : runJob(msg, { receivedAt: performance.now() }).then((o) => o.msg)));
}

async function mk(file, { workerMs = 12, dpr = 1.25 } = {}) {
    resetRasterWorkerClient(); resetPlaneStats();
    setRasterWorkerCount(4); setRasterTransport(transport(workerMs));
    Object.defineProperty(window, "screen", { value: { width: 2560, height: 1440 }, configurable: true, writable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true, writable: true });
    const rep = readReportFile(file), parts = drawingPartsOf(file);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scr = rep.extract.screen;
    const E = new KobinEngine(host, { width: scr.w, height: scr.h, raster: true });
    engines.push({ E, host });
    const t0 = performance.now();
    loadReport(E, rep, { drawing: parts });
    const R = E.renderer, pack = R._pyrPack.bind(R);
    R._refused = []; R._packs = []; R._forgot = [];
    const forget = E.lm.forget.bind(E.lm);
    E.lm.forget = (id) => { const ok = forget(id); if (ok) R._forgot.push(String(id)); return ok; };
    const covers = E.stage.covers.bind(E.stage);
    let why = null;
    E.stage.covers = (f, r) => { const ok = covers(f, r); if (!ok && why && why.length < 2) why.push(coversWhy(E.stage, f, r)); return ok; };
    R._pyrPack = (job, jobId, pool) => {
        why = job.table ? null : [];
        const n0 = job.cells.length, out = pack(job, jobId, pool);
        const kept = job.packedCells ? job.packedCells.length : 0;
        if (job.kind === "plane") R._packs.push({ tag: job.cells[0] && job.cells[0].tag, Z: +job.Z.toFixed(4), n: n0, kept: out ? kept : 0, own: !!job.table, items: out ? out.nItems : 0 });
        if (!out || kept < n0) R._refused.push({ kind: job.kind, asked: n0, kept: out ? kept : 0, why: why && why[0] });
        why = null;
        return out;
    };
    E._render();
    await idle(E, 60000);
    return { E, rep, loadMs: Math.round(performance.now() - t0) };
}

async function idle(E, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        await sleep(10);
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
    fs.writeFileSync(path.join(OUT, "r3r4-probe-" + (process.env.PROBE_TAG || "run") + ".json"), JSON.stringify(log, null, 1));
});

function planeDump(E) {
    const R = E.renderer, pl = R._plane, v = R._view;
    if (!pl.main) return { refused: pl.refused, state: pl.state };
    const lv = (L) => L && {
        k: L.k, octavesUnderView: +Math.log2(v.Zq / L.pZq).toFixed(2), pZq: +L.pZq.toFixed(4), plates: L.plates, far: L.k > 2, list: L.list === undefined ? "camera" : L.list ? "own" : "fallback",
        frame: L.frame, layers: L.layers.map((x) => ({ kind: x.kind, k: x.k, margin: !!x.hole, cells: x.cells.length, ids: x.ids ? x.ids.size : undefined, omit: x.omit ? x.omit.size : undefined })),
    };
    return {
        state: pl.state, mode: v.mode, viewZ: +v.Z.toFixed(4), viewZq: +v.Zq.toFixed(4), s: v.s, viewCells: (v.i1 - v.i0 + 1) * (v.j1 - v.j0 + 1), cap: R.planeCap,
        main: lv(pl.main), quick: lv(pl.quick), selIds: pl.selIds ? pl.selIds.size : 0, keys: pl.keys.length, ready: pl.ready,
    };
}

const cellsByKind = (L) => { const o = {}; for (const x of L.layers) o[x.kind] = (o[x.kind] || 0) + x.cells.length; return o; };

/** Paper share of a plane level's BELOW plates: fully paper pixels / all pixels (raw RGBA in jsdom). */
function belowPaper(E, lvl) {
    if (!lvl) return null;
    const pl = E.renderer._plane, below = lvl.layers.find((L) => L.kind === "below");
    if (!below) return null;
    let px = 0, paper = 0, plates = 0, missing = 0, empty = 0;
    for (const [i, j] of below.cells) {
        const e = E.plates.get(pl._key(below.tag, below.pZq, i, j));
        if (!e) { missing++; continue; }
        plates++;
        if (!e.pixels) { empty++; continue; }          // an empty plate is paper
        const p = e.pixels;
        for (let o = 0; o < p.length; o += 4 * 7) { px++; if (p[o] === 255 && p[o + 1] === 255 && p[o + 2] === 255) paper++; }
    }
    return { plates, missing, emptyPlates: empty, paperShare: px ? +(paper / px).toFixed(3) : null };
}

async function selectAndWait(E, ids, ms = 30000) {
    E.setTool("select");
    E._setSelection(ids, []);
    const pl = E.renderer._plane, t0 = Date.now();
    let farDone = false;
    while (Date.now() - t0 < ms) {
        await sleep(20);
        if (pl.main && pl.checkReady(E.plates)) break;
    }
    const tReady = Date.now() - t0;
    // the far levels' own tables come at idle: wait for them too
    while (Date.now() - t0 < ms) {
        const pend = [pl.main, pl.quick].some((l) => l && l.listPending);
        if (!pend) { farDone = true; break; }
        await sleep(50);
    }
    return { readyMs: tReady, farDone, totalMs: Date.now() - t0 };
}

/** Why `stage.covers` says no (the probe's re-statement of `Stage.covers`). */
function coversWhy(st, frameId, rect) {
    const shifted = (r, off) => (off[0] || off[1] ? { left: r.left - off[0], top: r.top - off[1], right: r.right - off[0], bottom: r.bottom - off[1] } : r);
    if (String(frameId) !== st.frame) return "otherFrame";
    if (st._need) return "need";
    for (const key of st._tileKeys(st.frame, rect)) { const k = st._keys.get(key); if (!k || !k.tile || st._missing.has(key)) return "camera tile " + key; }
    for (const g of st._groups.values()) for (const key of st._tileKeys(g.F0, shifted(rect, g.rem))) { const k = st._keys.get(key); if (!k || !k.tile || st._missing.has(key)) return "group F0 " + g.F0 + (st.lm.frame(g.F0) ? " (exists)" : " (forgotten)"); }
    return "ok";
}

/**
 * The cut the plane would make for the same selection, list and view under another cap: fresh MovePlane instances, the
 * shipped `_cut`. (A D1-off what-if went with F145's per-layer cut, 2026-10-19: the near layer is the on-screen cut.)
 */
function whatIf(E) {
    const R = E.renderer, v = R._view, st = R._planeFn(), list = R._lastList, out = [];
    const cut = (P, cap) => { const p = new P(); p.aim(st, list, v, R.cfg, cap, R.layer.dpr); return p.main ? { k: p.main.k, plates: p.main.plates, frame: p.main.frame, layers: p.main.layers.map((x) => x.kind + x.k + (x.hole ? "m" : "") + ":" + x.cells.length).join(" "), quick: p.quick ? p.quick.k : null, quickPlates: p.quick ? p.quick.plates : 0, byKind: cellsByKind(p.main) } : { refused: p.refused }; };
    for (const cap of [40, 64, 96, 144]) out.push({ cap, ...cut(MovePlane, cap) });
    return out;
}

/** The first selected id the camera's table draws: the plane's SEL members, in order. */
function drawnMember(E, ids) {
    const pl = E.renderer._plane;
    for (const id of [...ids, ...(pl.selIds || [])]) if (E.stage.itemsOf(id).length) return id;
    return null;
}

/**
 * A plane level rendered twice on this thread, each layer's cells: from the level's own snapshot table, and from the
 * camera's table (the fallback `_farList` takes when its snapshot does not come, `farListFallbacks`). Per plate: pixels
 * where the own-table plate has ink (alpha > 0 on SEL/OVER, not paper on BELOW) and the camera-table one does not.
 */
function fallbackCompare(E, lvl) {
    const R = E.renderer, pl = R._plane, pyr = R.pyramid, out = [];
    if (!lvl || !lvl.list) return { skipped: lvl ? "no own list" : "no level" };
    for (const L of lvl.layers) {
        const cells = L.cells.map(([i, j]) => planeCell(pl.frameId, lvl.pZq, L.tag + "_cmp", i, j));
        const base = { kind: "plane", frame: pl.frameId, Z: lvl.pZq, clips: null, only: L.kind === "below" ? null : L.ids, omit: L.kind === "below" ? L.omit : null, paper: L.kind === "below" ? null : [0, 0, 0, 0] };
        const own = pyr._renderInline({ ...base, cells, table: { items: () => lvl.list, generation: lvl.G } });
        const cam = pyr._renderInline({ ...base, cells, table: null });
        const camBy = new Map(cam.map((r) => [r.i + "," + r.j, r]));
        for (const r of own) {
            const c = camBy.get(r.i + "," + r.j);
            const ink = (px, o) => (L.kind === "below" ? !(px[o] === 255 && px[o + 1] === 255 && px[o + 2] === 255) : px[o + 3] > 0);
            let inkOwn = 0, lost = 0, n = 0;
            const a = r.pixels, b = c && c.pixels;
            for (let o = 0; o < PLATE_PX * PLATE_PX * 4; o += 4 * 5) {
                n++;
                const io = a ? ink(a, o) : false, ic = b ? ink(b, o) : false;
                if (io) inkOwn++;
                if (io && !ic) lost++;
            }
            out.push({ kind: L.kind, cell: [r.i, r.j], camPacked: !!c, inkOwn: +(inkOwn / n).toFixed(3), inkLostInCam: +(lost / n).toFixed(3) });
        }
    }
    return out;
}

function center(E, id) {
    const its = E.stage.itemsOf(id);
    if (!its.length) return null;
    const c = E.cam;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const it of its) {
        const p = E.stage.placed(it), x = it.box;
        l = Math.min(l, x.left + p.off[0]); t = Math.min(t, x.top + p.off[1]); r = Math.max(r, x.right + p.off[0]); b = Math.max(b, x.bottom + p.off[1]);
    }
    const W = E.width, H = E.height;
    const sx = Math.min(W - 40, Math.max(40, ((l + r) / 2) * c.inScale + c.inPanX)), sy = Math.min(H - 40, Math.max(40, ((t + b) / 2) * c.inScale + c.inPanY));
    return { box: [l, t, r, b], scr: [sx, sy] };
}

async function dragAndDrop(E, sel, at, dx, dy, steps = 16) {
    const R = E.renderer, pl = R._plane, s0 = { ...planeStats };
    E.pointerDown(at[0], at[1]);
    const seq = [];
    for (let k = 1; k <= steps; k++) {
        E.pointerMove(at[0] + (dx * k) / steps, at[1] + (dy * k) / steps);
        await sleep(32);
        const lv = pl.cur;
        seq.push(lv ? (pl.partial ? "P" : lv === pl.main ? "M" + lv.k : "Q" + lv.k) : "-");
    }
    E.pointerUp();
    const lp = R.pyramid.lastPatch;
    const after = { notReady: planeStats.notReady - s0.notReady, stopgaps: planeStats.stopgaps - s0.stopgaps, quickSteps: planeStats.quickSteps - s0.quickSteps, partialSteps: planeStats.partialSteps - s0.partialSteps, lands: planeStats.lands - s0.lands };
    return { seq: seq.join(" "), ...after, patch: lp && { cells: lp.cells, T: lp.T, budget: lp.budget, inline: lp.inline, coarse: lp.coarse, levels: lp.levels } };
}

const R3 = path.join(REPORT_DIR, "report-2026-10-07T03-19-33-862Z.json");
const R4 = path.join(REPORT_DIR, "report-2026-10-07T03-24-11-129Z.json");

describe("R3 and R4 (MOVES review)", () => {
    test("Q1r2 R2's selection (5 ids + 2 frames): the runs before the merge, what the merges put under the selection", async () => {
        const R2 = path.join(REPORT_DIR, "report-2026-10-07T03-17-06-829Z.json");
        const { E, rep, loadMs } = await mk(R2);
        const s = rep.moves.selection;
        E.setTool("select");
        E._setSelection(s.ids, s.frames);
        const R = E.renderer, pl = R._plane, t0 = Date.now();
        while (Date.now() - t0 < 30000 && !(pl.main || pl.refused)) await sleep(20);
        const v = R._view, st = R._planeFn();
        // the runs exactly as MovePlane._cut builds them (a probe-local copy of its loop, for counting only)
        const s0 = v.Zq / PLATE_PX, gw = v.i1 - v.i0 + 1, gh = v.j1 - v.j0 + 1, runs = [];
        for (const f of paintFamilies(R._lastList, 0, v.Zq, R.layer.dpr, R.cfg)) {
            if (f.all.length && f.all.every((d) => d.o.erase)) continue;
            const sel = f.all.some((d) => st.ids.has(d.o.id)), w = sel ? gw : 0, h = sel ? gh : 0;
            let on = false;
            for (const d of f.all) { const b = d.box; if (Math.floor(b[2] * s0) >= v.i0 - w && Math.floor(b[0] * s0) <= v.i1 + w && Math.floor(b[3] * s0) >= v.j0 - h && Math.floor(b[1] * s0) <= v.j1 + h) on = true; }
            if (!on) continue;
            let run = runs[runs.length - 1];
            if (!run || run.sel !== sel) runs.push(run = { sel, ids: new Set(), boxes: [], fams: 0, z0: f.z, z1: f.z });
            run.fams++; run.z1 = f.z;
            for (const d of f.all) { run.ids.add(d.o.id); run.boxes.push(d.box); }
        }
        if (runs.length && !runs[0].sel) runs.shift();
        const pre = runs.length + 1;
        // the merges, by the shipped rule; each merged run's on-screen area against the selected runs it is drawn under
        const view = { left: v.i0 * PLATE_PX / v.Zq, top: v.j0 * PLATE_PX / v.Zq, right: (v.i1 + 1) * PLATE_PX / v.Zq, bottom: (v.j1 + 1) * PLATE_PX / v.Zq };
        const clipA = (b) => Math.max(0, Math.min(b[2], view.right) - Math.max(b[0], view.left)) * Math.max(0, Math.min(b[3], view.bottom) - Math.max(b[1], view.top));
        const vArea = (view.right - view.left) * (view.bottom - view.top);
        const merged = [];
        const work = runs.map((r) => ({ ...r, ids: new Set(r.ids), boxes: r.boxes.slice() }));
        while (work.length + 1 > 5) {
            let m = -1;
            for (let k = 1; k < work.length - 1; k++) if (!work[k].sel && (m < 0 || work[k].boxes.length < work[m].boxes.length)) m = k;
            if (m < 0) break;
            const r = work[m], below = work[m - 1];
            const area = r.boxes.reduce((a, b) => a + clipA(b), 0);
            // the part of it over the selected ink drawn before it (true order: it covers that ink; merged: it is under)
            let over = 0;
            for (const b of r.boxes) for (const q of below.boxes) {
                const x0 = Math.max(b[0], q[0], view.left), y0 = Math.max(b[1], q[1], view.top), x1 = Math.min(b[2], q[2], view.right), y1 = Math.min(b[3], q[3], view.bottom);
                if (x1 > x0 && y1 > y0) over += (x1 - x0) * (y1 - y0);
            }
            merged.push({ fams: r.fams, ids: r.ids.size, boxes: r.boxes.length, z: [r.z0, r.z1], screenShare: +(area / vArea).toFixed(4), overSelShare: +(over / vArea).toFixed(4) });
            for (const id of work[m + 1].ids) below.ids.add(id);
            for (const x of work[m + 1].boxes) below.boxes.push(x);
            work.splice(m, 2);
        }
        const sum = (k) => +merged.reduce((a, x) => a + x[k], 0).toFixed(4);
        note("q1r2", {
            loadMs, sel: s, camera: { mode: v.mode, Z: +v.Z.toFixed(3), cells: gw * gh }, selIdsOnList: st ? st.ids.size : 0,
            layersBefore: pre, selRuns: runs.filter((r) => r.sel).length, unselRuns: runs.filter((r) => !r.sel).length,
            selRunSizes: runs.filter((r) => r.sel).map((r) => r.ids.size).slice(0, 20), unselRunSizes: runs.filter((r) => !r.sel).map((r) => r.ids.size).slice(0, 20),
            merges: merged.length, mergedFamilies: merged.reduce((a, x) => a + x.fams, 0), mergedIds: merged.reduce((a, x) => a + x.ids, 0),
            mergedScreenShareSum: sum("screenShare"), mergedOverSelectedShareSum: sum("overSelShare"), biggestMerged: merged.slice().sort((a, b) => b.screenShare - a.screenShare).slice(0, 5),
            planeAfter: pl.main ? { k: pl.main.k, plates: pl.main.plates, layers: pl.main.layers.map((x) => x.kind + ":" + (x.ids ? x.ids.size : x.omit.size)) } : { refused: pl.refused },
            stats: { merged: planeStats.merged, maxLayers: planeStats.maxLayers },
        });
    });

    test("Q3 R3's [3287]: the plane's level, the quick level, each drag step's resolution, the drop's patch", async () => {
        const { E, rep, loadMs } = await mk(R3);
        const sel = rep.moves.selection.ids;
        note("q3.load", { loadMs, natives: E.doc.count ? undefined : undefined, items: E.stage.items().length, view: { mode: E.renderer._view.mode, Z: E.renderer._view.Z, level: E.renderer._view.level } });
        const w = await selectAndWait(E, sel);
        const pl = E.renderer._plane;
        note("q3.whatIf", whatIf(E));
        note("q3.cut", { sel, wait: w, plane: planeDump(E), byKind: pl.main ? cellsByKind(pl.main) : null, stats: { ...planeStats }, belowPaperMain: belowPaper(E, pl.main), belowPaperQuick: belowPaper(E, pl.quick), packs: E.renderer._packs.slice(0, 30), refused: E.renderer._refused.length });
        const c = center(E, sel[0]);
        note("q3.center", c);
        // two drags: the first after the plane is whole, the second 300 ms after the first drop
        const d1 = await dragAndDrop(E, sel, c.scr, 160, 80);
        const t0 = performance.now();
        const land = [];
        for (let k = 0; k < 20 && performance.now() - t0 < 4000; k++) { await sleep(100); land.push(pl.state[0]); }
        note("q3.drag1", { ...d1, land: land.join("") });
        await idle(E);
        await sleep(300);
        const c2 = center(E, sel[0]);
        const d2 = await dragAndDrop(E, sel, c2.scr, -120, 60);
        note("q3.drag2", { ...d2, plane: planeDump(E), refused: E.renderer._refused.length, why: [...new Set(E.renderer._refused.map((x) => x.why))].slice(0, 6), forgot: E.renderer._forgot });
        await idle(E);
    });

    test("Q4 R4's [3326]: the far levels, the fallback list, paper in BELOW", async () => {
        const { E, rep, loadMs } = await mk(R4);
        const sel = rep.moves.selection.ids;
        const w = await selectAndWait(E, sel);
        const pl = E.renderer._plane;
        note("q4.whatIf", whatIf(E));
        note("q4.cut", { loadMs, sel, wait: w, plane: planeDump(E), byKind: pl.main ? cellsByKind(pl.main) : null, stats: { ...planeStats }, belowPaperMain: belowPaper(E, pl.main), belowPaperQuick: belowPaper(E, pl.quick), packs: E.renderer._packs.slice(0, 30), refused: E.renderer._refused.length });
        note("q4.fallbackQuick", fallbackCompare(E, pl.quick));
        note("q4.fallbackMain", pl.main && pl.main.k > 2 ? fallbackCompare(E, pl.main) : { skipped: "main k <= 2: packs from the camera's table by design" });
        const c = center(E, drawnMember(E, sel));
        const d1 = await dragAndDrop(E, sel, c.scr, 160, 80);
        note("q4.drag1", { ...d1, plane: planeDump(E) });
        await idle(E);
    });

    test("Q4c R3 after a drop: the far levels' snapshots and farListFallbacks", async () => {
        const { E, rep } = await mk(R3);
        const sel = rep.moves.selection.ids;
        await selectAndWait(E, sel);
        const pl = E.renderer._plane, F = pl.frameId;
        const before = { fallbacks: planeStats.farListFallbacks, missing: E.stage.model.displaced(F).missing, snap: !!E.stage.snapshot(F, pl.coverOf(pl.quick), 40) };
        const c = center(E, drawnMember(E, sel));
        await dragAndDrop(E, sel, c.scr, 160, 80);
        await idle(E);
        // the landing ends, the plane is re-aimed at idle: its far levels read their tables at idle (40 tries)
        const t0 = Date.now();
        while (Date.now() - t0 < 8000 && !(pl.main && [pl.main, pl.quick].every((l) => !l || !l.listPending))) await sleep(50);
        await sleep(1500);
        const after = {
            fallbacks: planeStats.farListFallbacks, missing: E.stage.model.displaced(F).missing,
            snap: pl.quick ? !!E.stage.snapshot(F, pl.coverOf(pl.quick), 40) : null, wanted: E.store.wanted(),
            levels: [pl.main, pl.quick].map((l) => l && { k: l.k, list: l.list === undefined ? "camera" : l.list ? "own" : "fallback" }),
            forgot: E.renderer._forgot.length,
        };
        note("q4c", { before, after });
    });

    test("Q4b R3's [3287] far levels (k 3 and 5): own snapshot table against the camera's table", async () => {
        const { E, rep } = await mk(R3);
        await selectAndWait(E, rep.moves.selection.ids);
        const pl = E.renderer._plane;
        note("q4b.main", fallbackCompare(E, pl.main));
        note("q4b.quick", fallbackCompare(E, pl.quick));
    });
});
