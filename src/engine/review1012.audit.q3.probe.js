/**
 * review1012.audit.q3.probe.js — PERF-DEEP agent B (AUDIT), Q3 and Q4 on one camera: what was computed to decide a
 * pixel's colour or an edge's pixels, against what determines it. A report's whole drawing at its own camera (R4 by
 * default; REPORT=… for another), a raster engine on Kobin's screen and desktop budget, GC off + shape cull (F139/F151/
 * F142 taken as fixed). Every tile is re-baked once under counters (which natives each bake examined and kept, and which
 * parent tiles it read), every screen plate is packed from the camera's table and analysed (pieces walked against pieces
 * that meet the plate), and every family on a plate is rendered alone on transparent paper so each sample pixel's stack
 * of coverages is known: the minimal set is the topmost opaque cover and every translucent family above it. Five chosen
 * pixels and one edge are reported in full. Q4: per family, pieces against visible pixels, and the core with an early
 * arc prune (a patched copy built at run time; the source is untouched) against the shipped core. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1012.audit.q3.probe.js"
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
import { G as CELL } from "./frameLattice";
import { perfNow } from "./now";

// The bake's inputs, counted per tile (the probe's copy of the module; the source is untouched).
jest.mock("./geometry/derive", () => {
    const actual = jest.requireActual("./geometry/derive");
    const cur = () => { const B = global.__BAKE; return B && B.stack.length ? B.stack[B.stack.length - 1] : null; };
    return {
        ...actual,
        classifyUp: (o, ...a) => { const t = actual.classifyUp(o, ...a); const c = cur(); if (c) { c.examined.add(o.id); if (t !== "empty") c.kept.add(o.id); if (t === "solid") c.solid++; } return t; },
        projectedSizePx: (o, ...a) => { const v = actual.projectedSizePx(o, ...a); const c = cur(); if (c && c.dir === "down") c.examined.add(o.id); return v; },
    };
});
const BAKE = { stack: [], log: new Map() };
global.__BAKE = BAKE;

const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "audit");
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(40 * 60 * 1000);
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** The shipped core with an early arc prune before `arcDepth` (built from the source at run time, nothing written). */
function patchedCore() {
    const babel = require("@babel/core");
    let src = fs.readFileSync(path.join(__dirname, "raster", "rasterCore.js"), "utf8").split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
    const at = "    const D = arcDepth(ax, ay, bx, by, sweep), f = arcForced(sweep);";
    if (!src.includes(at)) return null;
    src = src.replace(at, `    {
        const L = Math.hypot(bx - ax, by - ay), th = Math.abs(sweep);
        const g = th <= Math.PI ? 0.5 * L * Math.tan(th / 4) : L / Math.max(1e-300, Math.sin(th / 2));
        const ylo = (ay < by ? ay : by) - g, yhi = (ay < by ? by : ay) + g;
        if (yhi < oy + CY0 || ylo > oy + CY1) return 0;
        const xlo = (ax < bx ? ax : bx) - g, xhi = (ax < bx ? bx : ax) + g;
        if (mode === ARC_EDGE) {
            if (xlo > ox + TW) return 0;
            if (xhi < ox) return addEdge(0, ay - oy, 0, by - oy);
        } else {
            if (xlo > ox + TW) return pushUnionEdge(TW, ay - oy, TW, by - oy, yb0, yb1) ? 0 : -1;
            if (xhi < ox) return pushUnionEdge(0, ay - oy, 0, by - oy, yb0, yb1) ? 0 : -1;
        }
    }
` + at);
    const out = babel.transformSync(src, { babelrc: false, configFile: false, filename: "rasterCore.early.js", plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")] });
    const mod = { exports: {} };
    const req = (p) => (p === "./plate" ? require("./raster/plate") : p === "../geometry/chordMath" ? require("./geometry/chordMath") : require(p));
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", out.code)(req, mod, mod.exports);
    return mod.exports;
}

/** The shipped core with counters in its inner functions (a copy built at run time): row steps, deposits, arcs, left deposits. */
function countingCore() {
    const babel = require("@babel/core");
    let src = fs.readFileSync(path.join(__dirname, "raster", "rasterCore.js"), "utf8").split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
    const rep = (a, b) => { if (!src.includes(a)) throw new Error("countingCore: no " + a.slice(0, 60)); src = src.replace(a, b); };
    const L = (...xs) => xs.join("\n");
    rep(L("function depositRun(y, xs, xe, d) {", ""), L("function depositRun(y, xs, xe, d) {", "    CNT.deposits++;", ""));
    rep(L("function addStep(y, xs, xe, d) {", ""), L("function addStep(y, xs, xe, d) {", "    CNT.steps++;", ""));
    rep(L("export function addEdge(x0, y0, x1, y1) {", ""), L("export function addEdge(x0, y0, x1, y1) {", "    CNT.edgeCalls++;", ""));
    rep(L("function emitArc(ax, ay, bx, by, sweep, cx, cy, ox, oy, mode, yb0, yb1) {", ""), L("function emitArc(ax, ay, bx, by, sweep, cx, cy, ox, oy, mode, yb0, yb1) {", "    CNT.arcs++;", ""));
    rep("                if (mode === ARC_EDGE) edges += addEdge(0, nay - oy, 0, nby - oy);", L("                CNT.leftArcNodes++;", "                if (mode === ARC_EDGE) edges += addEdge(0, nay - oy, 0, nby - oy);"));
    rep("        chordMidK(nax, nay, nbx, nby, k, MID);                   // one tan per depth, shared by every pair", L("        CNT.bisections++;", "        chordMidK(nax, nay, nbx, nby, k, MID);"));
    rep(L("            acc += ACC[base + x];", "            let c = acc < 0 ? -acc : acc;", "            if (c > 1) c = 1;", "            if (maskBits)"),
        L("            acc += ACC[base + x];", "            CNT.resolvePx++;", "            let c = acc < 0 ? -acc : acc;", "            if (c > 1) c = 1;", "            if (maskBits)"));
    src = L("const CNT = { deposits: 0, steps: 0, edgeCalls: 0, arcs: 0, leftArcNodes: 0, bisections: 0, resolvePx: 0 };", "export function coreCounts() { return CNT; }", "") + src;
    const out = babel.transformSync(src, { babelrc: false, configFile: false, filename: "rasterCore.count.js", plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")] });
    const mod = { exports: {} };
    const req = (p) => (p === "./plate" ? require("./raster/plate") : p === "../geometry/chordMath" ? require("./geometry/chordMath") : require(p));
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", out.code)(req, mod, mod.exports);
    return mod.exports;
}

/** Per plate: pieces of the drawn items walked, those whose box meets the plate, and per item its pieces. */
function pieceWalk(job, p) {
    const meta = job.meta, attr = job.attr, geom = job.geom, subs = job.subs, Zq = job.Zq, n = job.nItems;
    const W = { 0: 3, 1: 8, 2: 9, 3: 16 };
    const ox = job.plates[2 * p] * PLATE_PX, oy = job.plates[2 * p + 1] * PLATE_PX;
    const items = [];
    for (let it = 0; it < n; it++) {
        const b = it * 9;
        const x0 = attr[b] * Zq - ox, x1 = attr[b + 2] * Zq - ox, y0 = attr[b + 1] * Zq - oy, y1 = attr[b + 3] * Zq - oy;
        if (!(x1 >= 0 && x0 <= PLATE_PX && y1 >= 0 && y0 <= PLATE_PX)) continue;
        const rx = attr[b + 4], ry = attr[b + 5];
        const kind = meta[it * 8], gs = meta[it * 8 + 2], gl = meta[it * 8 + 3], ss = meta[it * 8 + 4], sc = meta[it * 8 + 5];
        const rec = { it, fam: meta[it * 8 + 1], id: job.ids[it], loops: sc, pieces: 0, meet: 0, arcs: 0, arcsMeet: 0, boxes: [], subPx: x1 - x0 < 1 && y1 - y0 < 1 };
        for (let k = 0; k < sc; k++) {
            const lo = kind === 0 ? gs + subs[ss + k] : gs + 2 * subs[ss + k];
            const hi = k + 1 < sc ? (kind === 0 ? gs + subs[ss + k + 1] : gs + 2 * subs[ss + k + 1]) : gs + gl;
            let ax = (geom[lo] + rx) * Zq - ox, ay = (geom[lo + 1] + ry) * Zq - oy;
            const fx = ax, fy = ay;
            const add = (bx0, by0, bx1, by1, arc) => {
                rec.pieces++; if (arc) rec.arcs++;
                if (by1 >= 0 && by0 <= PLATE_PX) rec.band = (rec.band || 0) + 1;
                if (bx1 >= 0 && bx0 <= PLATE_PX && by1 >= 0 && by0 <= PLATE_PX) { rec.meet++; if (arc) rec.arcsMeet++; rec.boxes.push([bx0, by0, bx1, by1]); }
                else if (bx1 < 0 && by1 >= 0 && by0 <= PLATE_PX) rec.boxes.push([bx0, by0, bx1, by1]);   // left of the plate: it carries winding
            };
            if (kind === 0) {
                for (let o = lo + 2; o < hi; o += W[geom[o]] || 8) {
                    const code = geom[o];
                    let bx, by, sweep = 0;
                    if (code === 0) { bx = geom[o + 1]; by = geom[o + 2]; } else if (code === 2) { bx = geom[o + 7]; by = geom[o + 8]; } else if (code === 1) { bx = geom[o + 6]; by = geom[o + 7]; sweep = geom[o + 5]; } else { bx = geom[o + 14]; by = geom[o + 15]; sweep = geom[o + 5]; }
                    bx = (bx + rx) * Zq - ox; by = (by + ry) * Zq - oy;
                    let g = 0;
                    if (sweep !== 0) { const L = Math.hypot(bx - ax, by - ay), th = Math.abs(sweep); g = th <= Math.PI ? 0.5 * L * Math.tan(th / 4) : L / Math.max(1e-300, Math.sin(th / 2)); }
                    add(Math.min(ax, bx) - g, Math.min(ay, by) - g, Math.max(ax, bx) + g, Math.max(ay, by) + g, sweep !== 0);
                    ax = bx; ay = by;
                }
                add(Math.min(ax, fx), Math.min(ay, fy), Math.max(ax, fx), Math.max(ay, fy), false);
            } else {
                for (let o = lo + 2; o <= hi; o += 2) {
                    const q = o < hi ? o : lo;
                    const bx = (geom[q] + rx) * Zq - ox, by = (geom[q + 1] + ry) * Zq - oy;
                    add(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), false);
                    ax = bx; ay = by;
                }
            }
        }
        items.push(rec);
    }
    return items;
}

const RESULTS = {};
afterAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "q3-" + (process.env.REPORT ? process.env.REPORT.slice(18, 26) : "R4") + ".json"), JSON.stringify(RESULTS, null, 1));
});

test("Q3/Q4 pixels, an edge, and complex shapes at a report's camera", async () => {
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
    let t0 = perfNow();
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    const loadMs = perfNow() - t0;
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    E.lm.forget = () => false;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
    E.setTool("select");
    if (rep.moves && rep.moves.selection) E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
    E._render();
    await drain(E, g, 4);
    const res = RESULTS.main = { report: name, gitDiff: process.env.GIT_DIFF || null, loadMs: Math.round(loadMs), natives: 0 };
    for (const k of E.doc.levels()) res.natives += E.doc.list(k).length;
    // Every tile re-baked once under the counters.
    const ts = E.store;
    const wrapEnsure = (nm, dir) => {
        const orig = ts[nm].bind(ts);
        ts[nm] = (F, i, j) => {
            const cf = E.lm.frameFor(F), key = (cf ? cf.id : F) + "|" + dir + "|" + i + "," + j;
            const parent = BAKE.stack[BAKE.stack.length - 1];
            if (parent) parent.parents.add(key);
            let rec = BAKE.log.get(key);
            const fresh = !rec;
            if (fresh) BAKE.log.set(key, (rec = { key, dir, examined: new Set(), kept: new Set(), solid: 0, parents: new Set(), out: 0, ms: 0 }));
            BAKE.stack.push(rec);
            const t = perfNow();
            try { const tile = orig(F, i, j); if (tile && tile.objs) rec.out = tile.objs.length; return tile; } finally { rec.ms += perfNow() - t; BAKE.stack.pop(); }
        };
    };
    wrapEnsure("_ensureUp", "up"); wrapEnsure("_ensureDown", "down");
    ts.bumpEpoch();
    t0 = perfNow();
    E._render();
    res.rebakeMs = Math.round(perfNow() - t0);
    await drain(E, g, 4);
    const st = E.stage, R = E.renderer, pyr = R.pyramid, v = pyr._v;
    res.bakeTiles = [...BAKE.log.values()].map((r) => ({ key: r.key.slice(-30), dir: r.dir, examined: r.examined.size, kept: r.kept.size, out: r.out, ms: +r.ms.toFixed(1), parents: r.parents.size }));
    res.bakeSums = { examinedSum: res.bakeTiles.reduce((a, x) => a + x.examined, 0), keptSum: res.bakeTiles.reduce((a, x) => a + x.kept, 0), outSum: res.bakeTiles.reduce((a, x) => a + x.out, 0) };
    res.view = { mode: v.mode, level: v.level, Z: v.Z, Zq: v.Zq, cells: (v.i1 - v.i0 + 1) * (v.j1 - v.j0 + 1), frame: String(v.frameId).slice(-40) };
    res.tiles = { baked: BAKE.log.size, examined: new Set([...BAKE.log.values()].flatMap((r) => [...r.examined])).size, kept: new Set([...BAKE.log.values()].flatMap((r) => [...r.kept])).size,
        pieces: [...BAKE.log.values()].reduce((a, r) => a + r.out, 0), solidQuads: [...BAKE.log.values()].reduce((a, r) => a + r.solid, 0),
        upTiles: [...BAKE.log.values()].filter((r) => r.dir === "up").length, downTiles: [...BAKE.log.values()].filter((r) => r.dir === "down").length,
        emptyTiles: [...BAKE.log.values()].filter((r) => !r.out).length };
    const list = R._sceneList();
    res.list = { items: list.length, natives: new Set(list.map((it) => it.id)).size, own: list.filter((it) => it.key === "own").length };
    const closure = (keys) => {
        const seen = new Set(), ex = new Set(), kept = new Set();
        let pieces = 0;
        const visit = (k) => { if (seen.has(k)) return; seen.add(k); const r = BAKE.log.get(k); if (!r) return; for (const id of r.examined) ex.add(id); for (const id of r.kept) kept.add(id); pieces += r.out; for (const p of r.parents) visit(p); };
        for (const k of keys) visit(k);
        return { tiles: seen.size, examined: ex, kept, pieces };
    };
    // The plates on screen at the view's own grid.
    const Z = v.mode === "rest" ? v.Z : v.Zq;
    const W = pyr.wDev, H = pyr.hDev;
    const devToPlate = (X, Y) => { const px = (X - v.tx) / v.k, py = (Y - v.ty) / v.k; const gx = px * Z, gy = py * Z; const i = Math.floor(gx / PLATE_PX), j = Math.floor(gy / PLATE_PX); return { i, j, x: Math.floor(gx - i * PLATE_PX), y: Math.floor(gy - j * PLATE_PX), fx: px, fy: py }; };
    const tl = devToPlate(0, 0), br = devToPlate(W - 1, H - 1);
    const STRIDE = 8;
    const samples = new Map();        // "X,Y" -> [{fam, a, opaque, ids}] top-down filled below
    const famStats = new Map();       // family key -> stats over the screen
    const plates = [];
    const RGBA = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    const keepPlanes = new Map();     // "i,j" -> { fams: [{ key, ids, alpha: Uint8Array }], job }
    let coreAll = 0, coreEarly = 0, earlyDiff = 0, earlyMax = 0;
    const early = patchedCore();
    res.earlyCore = !!early;
    const counting = countingCore();
    for (let j = tl.j; j <= br.j; j++) {
        for (let i = tl.i; i <= br.i; i++) {
            const job = packJob(list, { plates: Int32Array.of(i, j), Zq: Z, dpr: pyr.dpr, cfg: R.cfg, paper: R._paperRgb, G: st.generation });
            const counts = new Uint32Array(8), tm = new Float64Array(7);
            let t = perfNow();
            if (job.nItems) renderPlate(job, 0, RGBA, counts, tm);
            coreAll += perfNow() - t;
            const full = RGBA.slice();
            let cc = null;
            if (counting && job.nItems) {
                const C = counting.coreCounts(); for (const k of Object.keys(C)) C[k] = 0;
                counting.renderPlate(job, 0, new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4), new Uint32Array(8));
                cc = { ...C };
            }
            if (early && job.nItems) {
                const c2 = new Uint32Array(8), out2 = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
                t = perfNow(); early.renderPlate(job, 0, out2, c2); coreEarly += perfNow() - t;
                for (let q = 0; q < out2.length; q++) { const d = Math.abs(out2[q] - full[q]); if (d) { earlyDiff++; if (d > earlyMax) earlyMax = d; } }
            }
            const walk = job.nItems ? pieceWalk(job, 0) : [];
            // The families of this plate, in paint order, each rendered alone on transparent paper.
            const famIds = new Map();
            for (let it = 0; it < job.nItems; it++) { const fk = job.meta[it * 8 + 1]; if (!famIds.has(fk)) famIds.set(fk, new Set()); famIds.get(fk).add(job.ids[it]); }
            const fams = [];
            for (const [fk, ids] of famIds) {
                const sub = packJob(list, { plates: Int32Array.of(i, j), Zq: Z, dpr: pyr.dpr, cfg: R.cfg, paper: [0, 0, 0, 0], G: st.generation, only: ids });
                const c = new Uint32Array(8);
                const out = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
                if (sub.nItems) renderPlate(sub, 0, out, c);
                const alpha = new Uint8Array(PLATE_PX * PLATE_PX);
                let cov = 0;
                for (let q = 0; q < alpha.length; q++) { alpha[q] = out[q * 4 + 3]; if (alpha[q]) cov++; }
                const first = [...ids][0], rec = E.doc.getById(first);
                const opacity = rec && rec.obj.opacity != null ? rec.obj.opacity : 1;
                const w = walk.filter((x) => x.fam === fk);
                const key = [...ids].sort((a, b) => a - b).join(",");
                fams.push({ fk, key, ids, alpha, cov, opacity, edges: c[4], chords: c[5], rows: c[6], pieces: w.reduce((a, x) => a + x.pieces, 0), meet: w.reduce((a, x) => a + x.meet, 0), color: rec ? rec.obj.color : null });
            }
            // The minimal set at every pixel (stride 2 inside the plate): top-down to the first opaque cover.
            const visible = new Map(fams.map((F) => [F.fk, 0]));
            const S2 = 2;
            for (let y = 0; y < PLATE_PX; y += S2) for (let x = 0; x < PLATE_PX; x += S2) {
                const q = y * PLATE_PX + x;
                for (let n = fams.length - 1; n >= 0; n--) {
                    const F = fams[n], a = F.alpha[q];
                    if (!a) continue;
                    visible.set(F.fk, visible.get(F.fk) + 1);
                    if (a === 255) break;
                }
            }
            for (const F of fams) {
                let s = famStats.get(F.key);
                if (!s) famStats.set(F.key, (s = { key: F.key.slice(0, 40), ids: F.ids.size, color: F.color, opacity: F.opacity, plates: 0, platesVisible: 0, pieces: 0, meet: 0, edges: 0, chords: 0, rows: 0, covPx: 0, visPx: 0 }));
                s.plates++; s.pieces += F.pieces; s.meet += F.meet; s.edges += F.edges; s.chords += F.chords; s.rows += F.rows; s.covPx += F.cov; s.visPx += visible.get(F.fk) * S2 * S2;
                if (visible.get(F.fk)) s.platesVisible++;
            }
            // Screen samples for choosing the pixels.
            for (let Y = 0; Y < H; Y += STRIDE) for (let X = 0; X < W; X += STRIDE) {
                const pp = devToPlate(X, Y);
                if (pp.i !== i || pp.j !== j) continue;
                const q = pp.y * PLATE_PX + pp.x, stack = [];
                for (let n = fams.length - 1; n >= 0; n--) { const a = fams[n].alpha[q]; if (a) stack.push({ n, a, op: fams[n].opacity }); }
                samples.set(X + "," + Y, { X, Y, i, j, x: pp.x, y: pp.y, fx: pp.fx, fy: pp.fy, stack });
            }
            const itemKeys = new Set();
            for (let it = 0; it < job.nItems; it++) for (const o of list) if (o.id === job.ids[it]) itemKeys.add(o.key);
            plates.push({ i, j, items: job.nItems, fams: fams.length, famsVisible: fams.filter((F) => visible.get(F.fk) > 0).length, pieces: walk.reduce((a, x) => a + x.pieces, 0), meet: walk.reduce((a, x) => a + x.meet, 0), band: walk.reduce((a, x) => a + (x.band || 0), 0),
                edges: counts[4], chords: counts[5], rows: counts[6], covered: counts[7], geomBytes: job.geom.byteLength,
                edgesMs: +tm[4].toFixed(2), accumMs: +tm[6].toFixed(2), clipMs: +tm[2].toFixed(2), cc });
            keepPlanes.set(i + "," + j, { fams, job, walk, itemKeys });
        }
    }
    res.plates = plates;
    res.core = { shippedMs: +coreAll.toFixed(1), earlyPruneMs: +coreEarly.toFixed(1), earlyDiffBytes: earlyDiff, earlyMaxDiff: earlyMax };
    const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
    res.platesTotal = { plates: plates.length, items: sum(plates, "items"), fams: sum(plates, "fams"), famsVisible: sum(plates, "famsVisible"), pieces: sum(plates, "pieces"), meet: sum(plates, "meet"), band: sum(plates, "band"), edges: sum(plates, "edges"), chords: sum(plates, "chords"), geomBytes: sum(plates, "geomBytes") };
    log(`[${name.slice(18, 26)}] natives ${res.natives}; view ${JSON.stringify(res.view)}; tiles ${JSON.stringify(res.tiles)}; list ${JSON.stringify(res.list)}`);
    const ccSum = {}; for (const p of plates) if (p.cc) for (const [k, x] of Object.entries(p.cc)) ccSum[k] = (ccSum[k] || 0) + x;
    res.coreCounts = ccSum; res.coreSplit = { edgesMs: +plates.reduce((a, p) => a + p.edgesMs, 0).toFixed(1), accumMs: +plates.reduce((a, p) => a + p.accumMs, 0).toFixed(1), clipMs: +plates.reduce((a, p) => a + p.clipMs, 0).toFixed(1) };
    log(`   plates ${JSON.stringify(res.platesTotal)}; core ${JSON.stringify(res.core)}; split ${JSON.stringify(res.coreSplit)}; counts ${JSON.stringify(ccSum)}; bake sums ${JSON.stringify(res.bakeSums)}`);
    // Q4: families by pieces per visible pixel.
    const fs4 = [...famStats.values()].map((s) => ({ ...s, piecesPerVisPx: +(s.pieces / Math.max(1, s.visPx)).toFixed(3), hidden: s.visPx === 0 }));
    fs4.sort((a, b) => b.pieces - a.pieces);
    res.families = fs4.slice(0, 40);
    res.familiesSummary = { families: fs4.length, hidden: fs4.filter((s) => s.hidden).length, piecesAll: sum(fs4, "pieces"), piecesHidden: sum(fs4.filter((s) => s.hidden), "pieces"), covPx: sum(fs4, "covPx"), visPx: sum(fs4, "visPx") };
    log(`   families ${JSON.stringify(res.familiesSummary)}`);
    for (const s of fs4.slice(0, 12)) log(`     ${JSON.stringify(s)}`);
    // The five pixels.
    const S = [...samples.values()];
    const opaqueTop = (s) => s.stack.findIndex((e) => e.a === 255);
    const pick = {};
    pick.inside = S.filter((s) => s.stack.length && s.stack.every((e) => e.a === 255 || e.a === 0)).sort((a, b) => b.stack.length - a.stack.length)[0];
    pick.edge = S.filter((s) => s.stack.length >= 2 && s.stack[0].a > 0 && s.stack[0].a < 255 && opaqueTop(s) > 0).sort((a, b) => b.stack.length - a.stack.length)[0];
    pick.dense = S.slice().sort((a, b) => b.stack.length - a.stack.length)[0];
    const selIds = new Set(E.selection ? E._selectionMembers().map((m) => m.obj.id) : []);
    pick.selected = S.filter((s) => { const P = keepPlanes.get(s.i + "," + s.j); return s.stack.some((e) => [...P.fams[e.n].ids].some((id) => selIds.has(id))); }).sort((a, b) => b.stack.length - a.stack.length)[0];
    pick.frameEdge = S.filter((s) => s.stack.length && (Math.abs(((s.fx / CELL) % 1 + 1) % 1 - 0.5) < 4 / (Z * CELL) || Math.abs(((s.fy / CELL) % 1 + 1) % 1 - 0.5) < 4 / (Z * CELL))).sort((a, b) => b.stack.length - a.stack.length)[0];
    res.pixels = {};
    for (const [k, s] of Object.entries(pick)) {
        if (!s) { res.pixels[k] = null; continue; }
        const P = keepPlanes.get(s.i + "," + s.j), q = s.y * PLATE_PX + s.x;
        const stack = [];
        for (let n = P.fams.length - 1; n >= 0; n--) { const F = P.fams[n], a = F.alpha[q]; if (a) stack.push({ fam: F.key.slice(0, 30), ids: F.ids.size, alpha: a, opacity: F.opacity, color: F.color }); }
        const minimal = [];
        for (const e of stack) { minimal.push(e); if (e.alpha === 255) break; }
        const tiles = closure(P.itemKeys);
        const minIds = new Set();
        for (const e of minimal) { const F = P.fams.find((x) => x.key.slice(0, 30) === e.fam); if (F) for (const id of F.ids) minIds.add(id); }
        // Pieces a pixel's coverage needs: the minimal families' pieces crossing its row at or left of it.
        let need = 0, walked = 0;
        for (const w of P.walk) {
            walked += w.pieces;
            if (!minIds.has(w.id)) continue;
            for (const b of w.boxes) if (b[1] <= s.y + 1 && b[3] >= s.y && b[0] <= s.x + 1) need++;
        }
        res.pixels[k] = { X: s.X, Y: s.Y, plate: [s.i, s.j], at: [s.x, s.y], stackDepth: stack.length, stack: stack.slice(0, 8), minimal: minimal.length,
            plateItems: P.job.nItems, plateFamilies: P.fams.length, tilesFeeding: tiles.tiles, nativesExaminedByBakes: tiles.examined.size, nativesKeptByBakes: tiles.kept.size, piecesProducedByBakes: tiles.pieces,
            nativesInMinimalSet: minIds.size, piecesWalkedOnPlate: walked, piecesNeeded: need };
        log(`   pixel ${k}: ${JSON.stringify(res.pixels[k])}`);
    }
    // One edge: the partial-coverage pixels of the edge pixel's top family in a 64 × 64 window around it.
    const e = pick.edge || pick.selected;
    if (e) {
        const P = keepPlanes.get(e.i + "," + e.j), q0 = e.y * PLATE_PX + e.x;
        let topN = -1;
        for (let n = P.fams.length - 1; n >= 0; n--) if (P.fams[n].alpha[q0]) { topN = n; break; }
        const F = P.fams[topN], px = [];
        for (let y = Math.max(0, e.y - 32); y < Math.min(PLATE_PX, e.y + 32); y++) for (let x = Math.max(0, e.x - 32); x < Math.min(PLATE_PX, e.x + 32); x++) { const a = F.alpha[y * PLATE_PX + x]; if (a > 0 && a < 255) px.push([x, y]); }
        const reach = new Set();
        let piecesTouching = 0;
        for (const w of P.walk) {
            for (const b of w.boxes) if (px.some(([x, y]) => b[0] <= x + 1 && b[2] >= x && b[1] <= y + 1 && b[3] >= y)) { piecesTouching++; reach.add(w.fam); }
        }
        const famsPartial = P.fams.filter((G) => px.some(([x, y]) => { const a = G.alpha[y * PLATE_PX + x]; return a > 0 && a < 255; })).length;
        res.edge = { plate: [e.i, e.j], family: F.key.slice(0, 30), edgePixels: px.length, familiesWithPartialCoverageThere: famsPartial, familiesWhosePiecesReachThem: reach.size, piecesReachingThem: piecesTouching,
            plateFamilies: P.fams.length, plateItems: P.job.nItems, piecesWalkedOnPlate: P.walk.reduce((a, w) => a + w.pieces, 0) };
        log(`   edge: ${JSON.stringify(res.edge)}`);
    }
    E.destroy(); host.remove();
    setRasterTransport(null); setRasterWorkerCount(null);
});
