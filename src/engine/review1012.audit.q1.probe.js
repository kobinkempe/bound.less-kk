/**
 * review1012.audit.q1.probe.js — PERF-DEEP agent B (AUDIT), Q1: "lines already on screen go blurry when I move
 * something unrelated". R4's whole drawing at its drop camera (inScale 2.7029), a raster engine on Kobin's screen and
 * desktop budget, every job answered by the shipped worker entry (`runJob`). F139/F151 (frame GC) and F142 (the shape
 * cull) are taken as fixed: no frame is forgotten, every shape carries lwFrame 0. After a drain: the selection, a plane
 * drag, the drop. Per level: the cells the Stage dirtied, their dirty-rectangle area, the pixels that really changed
 * (each dirtied cell rendered from a snapshot before the drag and after the drop, diffed), what a per-piece footprint
 * would have dirtied, and what the compose showed blurred during the drag and after the drop. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1012.audit.q1.probe.js"
 * Q1_CASE=plane|perstep picks one case.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";
import { packJob } from "./raster/rasterPack";
import { renderPlate } from "./raster/rasterCore";
import { PLATE_PX } from "./raster/plate";
import { planeStats, resetPlaneStats } from "./raster/MovePlane";
import { cellBox } from "./raster/PyramidStore";
import { pieceBBox } from "./geometry/arcPerimeter";
import { perfNow } from "./now";

const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "audit");
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(30 * 60 * 1000);
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R4 = "report-2026-10-07T03-24-11-129Z.json";

function gate() {
    const parked = [];
    const g = { parked, workerMs: 0, jobs: 0 };
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    g.answer = async (max = Infinity) => {
        let n = 0;
        while (parked.length && n < max) {
            const p = parked.shift();
            const out = await runJob(p.msg);
            const t = out.msg.timings;
            if (t) for (let k = 1; k < t.length; k += 8) g.workerMs += t[k];
            g.jobs++; n++;
            p.resolve(out.msg);
        }
        for (let t = 0; t < 4; t++) await tick();
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

/** A store record's cell, its rect in its frame's units. */
const cellRect = (r) => { const u = PLATE_PX / r.Z; return { left: r.i * u, top: r.j * u, right: (r.i + 1) * u, bottom: (r.j + 1) * u }; };

/** One cell rendered from a fresh snapshot of its frame (the prefetch's off-camera path): RGBA, or null. */
function renderCell(E, r, o = {}) {
    let list = o.list, G = 0;
    if (!list) {
        const snap = E.stage.snapshot(r.frame, cellRect(r));
        if (!snap) return null;
        list = snap.items().filter((it) => !it.pending);
        G = snap.generation;
    }
    const R = E.renderer;
    const packed = packJob(list, { plates: Int32Array.of(r.i, r.j), Zq: r.Z, dpr: R.pyramid.dpr, cfg: R.cfg, paper: o.paper || R._paperRgb, G, only: o.only || null, omit: o.omit || null });
    const out = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    const counts = new Uint32Array(8);
    if (packed.nItems > 0) renderPlate(packed, 0, out, counts);
    else { for (let p = 0; p < out.length; p += 4) { out[p] = R._paperRgb[0]; out[p + 1] = R._paperRgb[1]; out[p + 2] = R._paperRgb[2]; out[p + 3] = 255; } }
    return { px: out, items: packed.nItems, drawn: counts[1], G, list };
}
/** Pixels differing between two plates: any channel (>0) and visibly (>8 of 255). */
function diff(a, b) {
    let any = 0, vis = 0;
    const mask = new Uint8Array(PLATE_PX * PLATE_PX);
    for (let p = 0, q = 0; p < a.length; p += 4, q++) {
        const d = Math.max(Math.abs(a[p] - b[p]), Math.abs(a[p + 1] - b[p + 1]), Math.abs(a[p + 2] - b[p + 2]));
        if (d > 0) { any++; mask[q] = 1; }
        if (d > 8) vis++;
    }
    return { any, vis, mask };
}
/** The bounding box of a change mask, in plate px, and its area. */
function maskBox(mask) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < PLATE_PX; y++) for (let x = 0; x < PLATE_PX; x++) if (mask[y * PLATE_PX + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? { area: 0 } : { x0, y0, x1, y1, area: (x1 - x0 + 1) * (y1 - y0 + 1) };
}
/** Plate px a set of rects (frame units of the cell's frame) covers inside the cell, each grown by a pixel. */
function rectsArea(rects, r, pad = 1) {
    const Z = r.Z, ox = r.i * PLATE_PX, oy = r.j * PLATE_PX, m = new Uint8Array(PLATE_PX * PLATE_PX);
    let n = 0;
    for (const x of rects) {
        const a = Math.max(0, Math.floor(x.left * Z - ox) - pad), b = Math.min(PLATE_PX, Math.ceil(x.right * Z - ox) + pad);
        const c = Math.max(0, Math.floor(x.top * Z - oy) - pad), d = Math.min(PLATE_PX, Math.ceil(x.bottom * Z - oy) + pad);
        if (!(b > a && d > c)) continue;
        for (let y = c; y < d; y++) for (let xx = a; xx < b; xx++) { const k = y * PLATE_PX + xx; if (!m[k]) { m[k] = 1; n++; } }
    }
    return { n, m };
}
const keyOf = (r) => r.key;
const maskMemo = new WeakMap();
/** The change mask of a cell's truth before (`b.px`) vs after (`t.px`), computed once. */
function d0mask(b, t) { let m = maskMemo.get(t); if (!m) { m = diff(b.px, t.px).mask; maskMemo.set(t, m); } return m; }
/** The record's level as the view's: `rel` the view frame's level it stands for, by the frame path. */
function relLevel(E, r) {
    const v = E.renderer.pyramid._v;
    if (r.kind === "rest") return "rest";
    if (r.kind === "plane") return "plane";
    let id = v.frameId, shift = 0;
    for (let n = 0; id != null && n < 64; n++) {
        if (String(id) === String(r.frame)) return r.level - shift - v.level;
        const f = E.lm.frame(id);
        id = f ? f.parent : null;
        shift += 12 / v.S;
    }
    return "off-path";
}
/** Screen (device px) areas by the plan's draw class, the plane's layers and the landing's clip. */
function planAreas(E) {
    const pyr = E.renderer.pyramid, P = pyr.lastPlan, v = P.v, W = pyr.wDev, H = pyr.hDev;
    const dev = (d) => {
        const x0 = Math.max(0, (d.x0 - v.ox) * v.s + v.dx), y0 = Math.max(0, (d.y0 - v.oy) * v.s + v.dy);
        const x1 = Math.min(W, (d.x1 - v.ox) * v.s + v.dx), y1 = Math.min(H, (d.y1 - v.oy) * v.s + v.dy);
        return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
    };
    const a = { sharp: 0, blur: 0, older: 0, paper: 0, held: 0 };
    for (const c of P.cells) for (const d of c.draws) a[d.cls] = (a[d.cls] || 0) + dev(d);
    const out = { screenPx: W * H, mode: v.mode, level: v.level, Z: +v.Z.toFixed(4), Zq: +v.Zq.toFixed(4), images: P.images, byClass: a };
    const pl = P.plane;
    if (pl && pl.layers.length) {
        const plane = E.renderer._plane;
        const lay = [];
        for (const { L, recs } of pl.layers) {
            let px = 0;
            for (const rr of recs) {
                const s = v.Zq / plane.cur.pZq, g = [rr.i * PLATE_PX * s, rr.j * PLATE_PX * s, (rr.i + 1) * PLATE_PX * s, (rr.j + 1) * PLATE_PX * s];
                px += dev({ x0: g[0], y0: g[1], x1: g[2], y1: g[3] });
            }
            lay.push({ kind: L.kind, plates: recs.length, screenPx: Math.round(px) });
        }
        let skipPx = 0;
        if (pl.skip) for (const k of pl.skip) { const [i, j] = k.split(",").map(Number); skipPx += dev({ x0: i * PLATE_PX, y0: j * PLATE_PX, x1: (i + 1) * PLATE_PX, y1: (j + 1) * PLATE_PX }); }
        out.plane = { state: plane.state, k: plane.cur ? plane.cur.k : null, quick: plane.cur === plane.quick, partial: plane.partial, layers: lay,
            baseCellsReplacedByBelow: pl.skip ? pl.skip.size : 0, baseScreenPxReplacedByBelow: Math.round(skipPx) };
        if (plane.state === "land") {
            const cells = pyr._landClip(v);
            let px = 0;
            for (const g of cells) px += dev({ x0: g[0], y0: g[1], x1: g[2], y1: g[3] });
            out.plane.landCells = cells.length; out.plane.landScreenPx = Math.round(px);
        }
    }
    return out;
}
/** The selection's own drawn items: their boxes on screen (device px, union by a mask over a coarse grid). */
function selScreenPx(E, ids, d = null) {
    const pyr = E.renderer.pyramid, v = pyr._v, W = pyr.wDev, H = pyr.hDev, st = E.stage;
    const m = new Uint8Array(W * H);
    let n = 0, items = 0;
    for (const id of ids) {
        for (const it of st.itemsOf(id)) {
            items++;
            const b = st._itemBox(it), dx = d ? d[0] : 0, dy = d ? d[1] : 0;
            const x0 = Math.max(0, Math.floor((b.left + dx) * v.k + v.tx)), x1 = Math.min(W, Math.ceil((b.right + dx) * v.k + v.tx));
            const y0 = Math.max(0, Math.floor((b.top + dy) * v.k + v.ty)), y1 = Math.min(H, Math.ceil((b.bottom + dy) * v.k + v.ty));
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = y * W + x; if (!m[k]) { m[k] = 1; n++; } }
        }
    }
    return { items, boxScreenPx: n };
}
/** Per-piece footprint states of the given natives, as the Stage's `_stateOf` would make them with one rect a piece. */
function pieceStates(E, ids) {
    const out = [];
    let pieces = 0;
    for (const id of ids) {
        const rec = E.doc.getById(id);
        if (!rec || !rec.obj.loops) continue;
        const table = E.stage.model.table(rec.obj, rec.level);
        for (const L of rec.obj.loops) {
            for (const p of L) {
                const b = pieceBBox(p);
                pieces++;
                out.push({ home: String(rec.level), table, rect: { left: b[0], top: b[1], right: b[2], bottom: b[3] } });
            }
        }
    }
    return { states: out, pieces };
}

function census(E) {
    const st = E.plates, by = {};
    for (const r of st.records()) {
        const k = r.kind + ":" + relLevel(E, r);
        const e = by[k] || (by[k] = { n: 0, exact: 0 });
        e.n++; if (st.exact(r)) e.exact++;
    }
    return by;
}

async function setup(withPlane) {
    resetRasterWorkerClient(); setRasterWorkerCount(4); resetPlaneStats();
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true, writable: true });
    Object.defineProperty(window, "screen", { value: { width: 2560, height: 1440 }, configurable: true, writable: true });
    const g = gate();
    const f = path.join(REPORT_DIR, R4);
    const rep = readReportFile(f);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: rep.extract.screen.w, height: rep.extract.screen.h, raster: true });
    const t0 = perfNow();
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    // F139/F151 and F142 taken as fixed.
    E.lm.forget = () => false;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
    const cx = E.width / 2, cy = E.height / 2, s = 2.7029;
    const px = (cx - E.cam.inPanX) / E.cam.inScale, py = (cy - E.cam.inPanY) / E.cam.inScale;
    E.cam.inScale = s; E.cam.inPanX = cx - px * s; E.cam.inPanY = cy - py * s;
    if (!withPlane) E.renderer.forcePerStepDrag = true;
    E.setTool("select");
    E._render();
    const r1 = await drain(E, g);
    const sel = rep.moves.selection;
    E._setSelection(sel.ids, sel.frames, true);
    E._render();
    await sleep(200);
    const r2 = await drain(E, g);
    log(`[setup] loaded+drained in ${(perfNow() - t0).toFixed(0)} ms (rounds ${r1}, ${r2}); camera depth ${E.cam.activeLevel} inScale ${E.cam.inScale}; G ${E.stage.generation}; jobs ${g.jobs} workerMs ${g.workerMs.toFixed(0)}`);
    return { E, g, rep, host };
}

const RESULTS = {};
afterAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "q1-" + (process.env.Q1_CASE || "all") + ".json"), JSON.stringify(RESULTS, null, 1));
});

for (const name of ["plane", "perstep"]) {
    const only = process.env.Q1_CASE;
    (only && only !== name ? test.skip : test)(`Q1 R4 drop damage: ${name}`, async () => {
        const { E, g, host } = await setup(name === "plane");
        const res = RESULTS[name] = { gitDiff: process.env.GIT_DIFF || null };
        const pyr = E.renderer.pyramid, st = E.stage;
        const members = E._selectionMembers().map((m) => m.obj.id);
        res.members = members.length;
        res.view0 = { mode: pyr._v.mode, level: pyr._v.level, Z: pyr._v.Z, Zq: pyr._v.Zq, cells: (pyr._v.i1 - pyr._v.i0 + 1) * (pyr._v.j1 - pyr._v.j0 + 1) };
        res.census0 = census(E);
        const pl = E.renderer._plane;
        if (pl.main) {
            res.planeCut = {
                k: pl.main.k, quickK: pl.quick ? pl.quick.k : null, plates: pl.main.plates, quickPlates: pl.quick ? pl.quick.plates : 0,
                layers: pl.main.layers.map((L) => ({ kind: L.kind, k: L.k, margin: !!L.hole, cells: L.cells.length, ids: L.ids ? L.ids.size : L.omit.size })), frame: pl.main.frame,
                merged: planeStats.merged, coarse: planeStats.coarse,
            };
        }
        res.selOnScreen = selScreenPx(E, members);
        // The plane's cut from the selection's PIECE boxes instead of its item boxes: cells on the view and the grown view.
        {
            const v = pyr._v, gw = v.i1 - v.i0 + 1, gh = v.j1 - v.j0 + 1, items = [];
            for (const id of members) for (const it of st.itemsOf(id)) items.push(it);
            const boxes = [], itemBoxes = [];
            for (const it of items) {
                const o = it.off, p = it.piece;
                const ib = st._itemBox(it); itemBoxes.push([ib.left, ib.top, ib.right, ib.bottom]);
                if (p.loops) for (const L of p.loops) for (const q of L) { const b = pieceBBox(q); boxes.push([b[0] + o[0], b[1] + o[1], b[2] + o[0], b[3] + o[1]]); }
                if (p.polys) for (const ring of p.polys) for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length]; boxes.push([Math.min(a[0], b[0]) + o[0], Math.min(a[1], b[1]) + o[1], Math.max(a[0], b[0]) + o[0], Math.max(a[1], b[1]) + o[1]]); }
            }
            const cut = [];
            for (let k = 0; k <= 3; k++) {
                const f = 1 / 2 ** k, sc = (v.Zq * f) / PLATE_PX;
                const rangeAt = (w, h) => ({ i0: Math.floor((v.i0 - w) * f), i1: Math.floor((v.i1 + 1 + w) * f - 1e-9), j0: Math.floor((v.j0 - h) * f), j1: Math.floor((v.j1 + 1 + h) * f - 1e-9) });
                const cellsOf = (bs, R) => { const out = new Set(); for (const b of bs) { const i0 = Math.max(Math.floor(b[0] * sc), R.i0), i1 = Math.min(Math.floor(b[2] * sc), R.i1), j0 = Math.max(Math.floor(b[1] * sc), R.j0), j1 = Math.min(Math.floor(b[3] * sc), R.j1); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.add(i + "," + j); } return out.size; };
                const on = rangeAt(0, 0), grown = rangeAt(gw, gh);
                cut.push({ k, viewCells: (on.i1 - on.i0 + 1) * (on.j1 - on.j0 + 1), selOnView_itemBoxes: cellsOf(itemBoxes, on), selGrown_itemBoxes: cellsOf(itemBoxes, grown), selOnView_pieceBoxes: cellsOf(boxes, on), selGrown_pieceBoxes: cellsOf(boxes, grown) });
            }
            res.planeCutByPieces = { items: items.length, pieceBoxes: boxes.length, cut };
            log(`[${name}] plane cut, item boxes vs piece boxes: ${JSON.stringify(res.planeCutByPieces)}`);
        }
        if (process.env.Q1_CUT_ONLY) { E.destroy(); host.remove(); setRasterTransport(null); setRasterWorkerCount(null); return; }
        // The store's records before the drag, and each one's truth rendered from a snapshot.
        const before = new Map();
        let tr = perfNow(), sane = 0, insane = 0, nosnap = 0;
        for (const r of [...E.plates.records()]) {
            if (r.kind === "plane") continue;
            const t = renderCell(E, r);
            if (!t) { nosnap++; continue; }
            const own = r.pixels ? diff(r.pixels, t.px).any : null;
            if (own === 0) sane++; else if (own != null) insane++;
            before.set(r.key, { r: { key: r.key, frame: r.frame, kind: r.kind, level: r.level, Z: r.Z, i: r.i, j: r.j, G: r.G }, px: t.px, rel: relLevel(E, r), items: t.items, drawn: t.drawn, list: t.list });
        }
        res.truthBefore = { cells: before.size, ownPlateEqualsSnapshotRender: sane, ownPlateDiffers: insane, noSnapshot: nosnap, ms: Math.round(perfNow() - tr) };
        log(`[${name}] truth before: ${JSON.stringify(res.truthBefore)}; census ${JSON.stringify(res.census0)}`);
        const pieceBefore = pieceStates(E, members);
        // Dirt: every commit's states, and every tracked cell's dirtySince before.
        const commits = [];
        const dirt0 = st._dirt.bind(st);
        st._dirt = (G, states, frames) => {
            const grouped = st._grouped(states);
            const perFrame = {};
            for (const F of st._cellsByFrame.keys()) { const rs = st._rectsIn(grouped, F); if (rs.length) perFrame[F] = rs; }
            commits.push({ G, states: states.length, grouped: grouped.length, frames: Object.keys(perFrame).length, perFrame, kinds: grouped.map((s) => (s.kind === "frame" ? "frame" : s.clip ? "clip" : s.kind === "sweep" ? "sweep" : "native")) });
            const t0 = perfNow();
            try { return dirt0(G, states, frames); } finally { commits[commits.length - 1].dirtMs = +(perfNow() - t0).toFixed(2); }
        };
        // What the Stage's damage queries cost (the review: median 0.42-0.73 ms a call before the per-piece build).
        const drCalls = [], dr0 = st.dirtyRects.bind(st);
        st.dirtyRects = (F, G, box) => { const t0 = perfNow(); try { return dr0(F, G, box); } finally { drCalls.push(perfNow() - t0); } };
        const dirtyBefore = new Map();
        for (const [k, c] of st._cells) dirtyBefore.set(k, c.dirty);
        // The drag: 10 steps of (60, 40) px.
        const sx = E.width / 2, sy = E.height / 2;
        E._dragSel = { start: [sx, sy], moved: false };
        E._beginHold();
        res.holdPlane = !!(E._holdMove && E._holdMove.plane);
        const steps = [];
        const c0 = st.stats.commits;
        for (let s = 1; s <= 10; s++) {
            const t0 = perfNow();
            E._dragSelection(sx + (60 * s) / 10, sy + (40 * s) / 10);
            const ms = perfNow() - t0;
            if (s === 1 || s === 5 || s === 10) {
                // a step's compose, and the plane's state, as drawn
                let dirtiedNow = 0;
                for (const [k, c] of st._cells) if (c.dirty > (dirtyBefore.get(k) || 0)) dirtiedNow++;
                steps.push({ step: s, ms: +ms.toFixed(1), commits: st.stats.commits - c0, dirtiedSoFar: dirtiedNow, patch: pyr.lastPatch ? { cells: pyr.lastPatch.cells, T: pyr.lastPatch.T, budget: pyr.lastPatch.budget, inline: pyr.lastPatch.inline, coarse: pyr.lastPatch.coarse } : null, plan: planAreas(E) });
            }
            if (s === 3) { await g.answer(); await settle(E, 1); }   // the plane's own plates come in mid-drag
        }
        res.drag = { steps, commitsDuringDrag: st.stats.commits - c0, dirtCommits: commits.length, planeStats: { ...planeStats } };
        if (name === "perstep") {
            // what a step without the plane dirties: the last step's commit
            const last = commits[commits.length - 1];
            if (last) res.drag.lastStepDirt = { states: last.states, grouped: last.grouped, frames: last.frames };
        }
        const dragCommits = commits.length;
        // F153: why each held native is swept at the drop or not, and where the Stage's dirt time goes.
        {
            const h = st._hold, why = {};
            if (h) for (const id of h.ids) {
                const rec = E.doc.getById(id), was = h.nat.get(id);
                const ev = h.queue.filter((q) => q.ev.id === id).map((q) => q.ev.kind + (q.ev.offsetsOnly ? ":offsets" : q.ev.attrOnly ? ":attr" : ""));
                why[id] = { type: rec ? rec.obj.type : null, events: [...new Set(ev)].join(","), sameGeom: !!(was && rec && was.geom && (rec.obj.loops || rec.obj.polys) === was.geom) };
            }
            res.sweepWhy = { held: h ? h.ids.size : 0, frames: h ? h.frames.length : 0, view: h ? !!(h.view && h.d) : null, why };
            log(`[${name}] F153 held at the drop: ${JSON.stringify(res.sweepWhy)}`);
            const rel0 = st.release.bind(st);
            st.release = () => {
                const hh = st._hold, at = {};
                if (hh) for (const id of hh.ids) {
                    const rec = E.doc.getById(id), was = hh.nat.get(id);
                    at[id] = { events: hh.queue.filter((q) => q.ev.id === id).map((q) => q.ev.kind + (q.ev.offsetsOnly ? ":offsets" : q.ev.attrOnly ? ":attr" : "")).join(","),
                        sameGeom: !!(was && rec && was.geom && (rec.obj.loops || rec.obj.polys) === was.geom), home: rec ? String(rec.level).slice(-12) : null };
                }
                res.atRelease = { queue: hh ? hh.queue.length : 0, kinds: hh ? [...new Set(hh.queue.map((q) => q.ev.kind + (q.ev.offsetsOnly ? ":offsets" : "") + (q.ev.id == null ? ":noid" : "")))] : [], at };
                const sw0 = st.stats.swept, out = rel0();
                res.atRelease.swept = st.stats.swept - sw0;
                log(`[${name}] F153 at release: ${JSON.stringify(res.atRelease)}`);
                return out;
            };
            const tm = res.stageTime = { sweepIn: 0, sweepInN: 0, rectsIn: 0, rectsInN: 0 };
            for (const k of ["_sweepIn", "_rectsIn"]) {
                const f0 = st[k].bind(st), key = k.slice(1);
                st[k] = (...a) => { const t0 = perfNow(); try { return f0(...a); } finally { tm[key] += perfNow() - t0; tm[key + "N"]++; } };
            }
        }
        // The drop.
        const tDrop = perfNow();
        E._pointerUp();
        res.dropMs = Math.round(perfNow() - tDrop);
        res.dropPatch = pyr.lastPatch;
        res.afterDrop = planAreas(E);
        const dropDirt = commits.slice(dragCommits);
        {
            const v = pyr._v, F = String(v.frameId), last = dropDirt[dropDirt.length - 1];
            res.memberBoxes = [];
            if (last) for (const rs of Object.values(last.perFrame)) for (const x of rs) res.memberBoxes.push({ wPx: Math.round((x.right - x.left) * v.Z), hPx: Math.round((x.bottom - x.top) * v.Z) });
            res.memberPieces = members.map((id) => { const rec = E.doc.getById(id); let n = 0; if (rec && rec.obj.loops) for (const L of rec.obj.loops) n += L.length; return { id, home: rec ? String(rec.level).slice(-24) : null, pieces: n }; });
            res.cameraFrame = F.slice(-40);
        }
        res.dropCommits = dropDirt.map((c) => ({ G: c.G, states: c.states, grouped: c.grouped, frames: c.frames, kinds: c.kinds.reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {}) }));
        // The cells the drag + drop dirtied (now, before any lands), then the landing to exact.
        const dirtied = [];
        for (const [k, c] of st._cells) if (c.dirty > (dirtyBefore.get(k) || 0)) dirtied.push(k);
        // F153: the store's exact records right after the drop (a changed cell among them is a stale plate nothing repaints).
        const exactAfterDrop = new Set();
        for (const r of E.plates.records()) if (r.kind !== "plane" && E.plates.exact(r)) exactAfterDrop.add(r.key);
        // The landing to exact: the plan after each answered job.
        const timeline = [];
        let w0 = g.workerMs;
        for (let n = 0; n < 200 && busy(E, g); n++) {
            const got = await g.answer(1);
            await settle(E, 1);
            const a = planAreas(E);
            timeline.push({ job: n, workerMs: +(g.workerMs - w0).toFixed(1), blur: a.byClass.blur, older: a.byClass.older, paper: a.byClass.paper, land: a.plane ? a.plane.landScreenPx || 0 : 0, sharp: a.byClass.sharp });
            if (!got) await sleep(60);
        }
        res.landing = { jobs: timeline.length, workerMs: +(g.workerMs - w0).toFixed(0), timeline: timeline.filter((x, k) => k < 12 || k % 5 === 0) };
        // Every cell the drag + drop dirtied, by level.
        const pieceAfter = pieceStates(E, members);
        // The cells' truths after, and the areas by level.
        tr = perfNow();
        const byLevel = {};
        const add = (rel, k, v) => { const e = byLevel[rel] || (byLevel[rel] = { cells: 0, cellPx: 0, dirtyRectPx: 0, changedPx: 0, changedVisPx: 0, changedBoxPx: 0, pieceBoxPx: 0, noChange: 0, pieceMissedPx: 0, pieceCells: 0, changedCells: 0 }); e[k] = (e[k] || 0) + v; };
        let notTracked = 0, rendered = 0;
        const allRects = (F, G0) => { const out = []; for (const c of commits) if (c.G > G0 && c.perFrame[F]) for (const x of c.perFrame[F]) out.push(x); return out; };
        // Each piece's box before and after, as one rect: the swept box (a translation's swept band lies inside it).
        const sameOrder = pieceBefore.states.length === pieceAfter.states.length;
        const pieceRectsIn = (F) => {
            const out = [];
            if (sameOrder) {
                for (let q = 0; q < pieceBefore.states.length; q++) {
                    const a = st._mapState(pieceBefore.states[q], F), b = st._mapState(pieceAfter.states[q], F);
                    if (a && b) out.push({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });
                    else if (a || b) out.push(a || b);
                }
            } else for (const s of pieceBefore.states.concat(pieceAfter.states)) { const x = st._mapState(s, F); if (x) out.push(x); }
            return out;
        };
        const pieceMemo = new Map();
        for (const k of dirtied) {
            const b = before.get(k);
            if (!b) { notTracked++; continue; }
            const t = renderCell(E, b.r);
            if (!t) continue;
            rendered++;
            const d = diff(b.px, t.px);
            const rects = dr0(b.r.frame, b.r.G, cellBox(b.r)) || [{ left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }];   // what the cell's patch is asked with
            const ra = rectsArea(rects, b.r);
            { let sm = 0; for (let q = 0; q < d0mask(b, t).length; q++) if (d0mask(b, t)[q] && !ra.m[q]) sm++; add(b.rel, "stageMissedPx", sm); }
            let pr = pieceMemo.get(b.r.frame);
            if (!pr) pieceMemo.set(b.r.frame, (pr = pieceRectsIn(b.r.frame)));
            const pa = rectsArea(pr, b.r);
            add(b.rel, "cells", 1); add(b.rel, "cellPx", PLATE_PX * PLATE_PX); add(b.rel, "dirtyRectPx", ra.n);
            add(b.rel, "changedPx", d.any); add(b.rel, "changedVisPx", d.vis); add(b.rel, "changedBoxPx", maskBox(d.mask).area); add(b.rel, "pieceBoxPx", pa.n);
            if (!d.any) add(b.rel, "noChange", 1); else add(b.rel, "changedCells", 1);
            if (pa.n) add(b.rel, "pieceCells", 1);
            // a piece footprint that misses a changed pixel would be unsound: count them
            let missed = 0;
            for (let q = 0; q < d.mask.length; q++) if (d.mask[q] && !pa.m[q]) missed++;
            add(b.rel, "pieceMissedPx", missed);
            if (d.any && name === "plane") {
                // Attribution: everything but the moved family before vs after (should not change), and the misses' distance.
                const mem = new Set(members);
                const ob = renderCell(E, b.r, { list: b.list, omit: mem }), oa = renderCell(E, b.r, { list: t.list, omit: mem });
                const od = diff(ob.px, oa.px);
                add(b.rel, "othersChangedPx", od.any);
                for (const padPx of [4, 16, 64]) {
                    const pw = rectsArea(pr, b.r, padPx);
                    let ms = 0;
                    for (let q = 0; q < d.mask.length; q++) if (d.mask[q] && !pw.m[q]) ms++;
                    add(b.rel, "pieceMissedPad" + padPx, ms);
                }
                // and the misses that the others' change explains
                let byOthers = 0;
                for (let q = 0; q < d.mask.length; q++) if (d.mask[q] && !pa.m[q] && od.mask[q]) byOthers++;
                add(b.rel, "missedByOthers", byOthers);
            }
        }
        res.dirtied = { cells: dirtied.length, notInStoreBefore: notTracked, rendered, ms: Math.round(perfNow() - tr), pieces: pieceBefore.pieces, sweptBoxes: sameOrder };
        // F153: cells the drop did NOT dirty whose pixels changed — with an exact plate stored right after the drop, a stale one.
        {
            const dset = new Set(dirtied);
            let checked = 0, changedCells = 0, changedPx = 0, staleExact = 0, staleExactPx = 0;
            for (const [k, b] of before) {
                if (dset.has(k)) continue;
                const t = renderCell(E, b.r);
                if (!t) continue;
                checked++;
                const d = diff(b.px, t.px);
                if (!d.any) continue;
                changedCells++; changedPx += d.any;
                if (exactAfterDrop.has(k)) { staleExact++; staleExactPx += d.any; }
            }
            res.undirtied = { checked, changedCells, changedPx, staleExact, staleExactPx, exactAfterDrop: exactAfterDrop.size, swept: st.stats.swept };
            log(`[${name}] F153 cells not dirtied: ${checked} checked; changed ${changedCells} (${changedPx} px), of them exact right after the drop ${staleExact} (${staleExactPx} px); swept states ${st.stats.swept}`);
        }
        // What computing the swept-piece footprint costs: map every piece state into each frame with tracked cells, timed.
        { const t0 = perfNow(); let n = 0; for (const F of st._cellsByFrame.keys()) { n += pieceRectsIn(F).length; } res.sweptFootprintMs = +(perfNow() - t0).toFixed(1); res.sweptFootprintRects = n; }
        res.byLevel = byLevel;
        {
            const q = drCalls.slice().sort((a, b) => a - b), at = (f) => (q.length ? +q[Math.min(q.length - 1, Math.floor(f * q.length))].toFixed(3) : 0);
            res.dirtyRectsCost = { calls: q.length, totalMs: +q.reduce((a, b) => a + b, 0).toFixed(1), median: at(0.5), p95: at(0.95), max: at(1) };
            res.dirtMs = commits.slice(dragCommits).map((c) => c.dirtMs);
            log(`[${name}] dirtyRects: ${JSON.stringify(res.dirtyRectsCost)}; the drop's _dirt ms ${JSON.stringify(res.dirtMs)}; Stage time ${JSON.stringify(res.stageTime)}`);
        }
        log(`[${name}] drop ${res.dropMs} ms; patch ${JSON.stringify(res.dropPatch)}; dirtied ${JSON.stringify(res.dirtied)}`);
        for (const [rel, e] of Object.entries(byLevel)) {
            log(`   ${String(rel).padStart(8)}: cells ${e.cells}, dirty-rect px ${e.dirtyRectPx}, changed px ${e.changedPx} (vis ${e.changedVisPx}), stage-missed ${e.stageMissedPx || 0}, piece-box px ${e.pieceBoxPx} (missed ${e.pieceMissedPx}), unchanged cells ${e.noChange}; ` +
                `re-rendered/changed ${(e.cellPx / Math.max(1, e.changedPx)).toFixed(1)}x, dirty/changed ${(e.dirtyRectPx / Math.max(1, e.changedPx)).toFixed(1)}x, piece/changed ${(e.pieceBoxPx / Math.max(1, e.changedPx)).toFixed(1)}x`);
        }
        log(`[${name}] drag: ${JSON.stringify(res.drag.steps.map((x) => ({ s: x.step, ms: x.ms, commits: x.commits, cls: x.plan.byClass, plane: x.plan.plane })))}`);
        log(`[${name}] after drop: ${JSON.stringify(res.afterDrop)}`);
        await drain(E, g);
        res.censusEnd = census(E);
        res.planeStatsEnd = { ...planeStats };
        log(`[${name}] landing: ${JSON.stringify(res.landing).slice(0, 1500)}`);
        E.destroy(); host.remove();
        setRasterTransport(null); setRasterWorkerCount(null);
    });
}
