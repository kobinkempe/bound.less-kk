/**
 * review1006.perf.cull.probe.js — `classifyUp`'s EMPTY test and `deriveStep`'s bbox cull read `o.lwFrame`, which a
 * resolved shape does not have (`Document.bakeShapeById` deletes it): `half`/`m` are NaN and every comparison is false,
 * so every shape of the parent cell takes the whole magnify path in every up-tile bake. This bakes the up tiles the
 * R3 drop re-bakes, as the tree does and with `lwFrame = 0` on every shape (what the cull means for a shape), and
 * compares the time and the pieces. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.perf.cull.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { encodeLoops } from "./geometry/arcShape";
import { classifyUp } from "./geometry/derive";
import { perfNow } from "./now";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "perf");

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}

/** A piece's geometry as a string: its id, type and every coordinate. */
function pieceSig(p) {
    const g = p.loops ? JSON.stringify(encodeLoops(p.loops)) : p.polys ? JSON.stringify(p.polys) : JSON.stringify(p.pts || null);
    return `${p.id}|${p.type}|${p.origin}|${g}|${p.covers ? 1 : 0}`;
}

test("the up-tile bakes of the R3 drop, with and without the shape cull", () => {
    resetRasterWorkerClient(); setRasterWorkerCount(4);
    setRasterTransport(() => new Promise(() => {}));
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-19-33-862Z.json");
    const rep = readReportFile(f);
    const E = mk(1806, 1070);
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E._render();
    const so = E.store, doc = E.doc, lm = E.lm;
    // The camera view's picture sources (what `prepare` mints): the reroute groups' F0 frames.
    const m = so._rerouteGroups(String(E.cam.frame), true);
    const sources = [...new Set([...m.groups.values()].map((g) => String(g.F0)))].filter((F) => F !== String(E.cam.frame));
    const win = E._listWin();
    const cells = [];
    for (const F of sources) {
        // the tiles each group reads: its F0 over the window shifted back by its remainder
        for (const g of m.groups.values()) {
            if (String(g.F0) !== F) continue;
            const w = { left: win.left - g.rem[0], top: win.top - g.rem[1], right: win.right - g.rem[0], bottom: win.bottom - g.rem[1] };
            const r = lm.tileRange(F, w);
            for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) {
                const k = F + "|" + i + "," + j;
                if (!cells.some((c) => c.k === k)) cells.push({ k, F, i, j });
            }
        }
    }
    log(`camera ${E.cam.frame}; ${m.groups.size} groups, ${sources.length} source frames other than the camera's; ${cells.length} up tiles`);
    // census of the parents' natives
    const parents = new Map();
    for (const c of cells) { const P = lm.frame(c.F).parent; parents.set(P, (parents.get(P) || 0) + 1); }
    for (const [P, n] of parents) {
        const list = doc.cellList(P), types = {};
        let noLw = 0;
        for (const o of list) { types[o.type] = (types[o.type] || 0) + 1; if (o.type !== "fill" && !(o.lwFrame >= 0)) noLw++; }
        log(`parent ${P}: ${list.length} natives ${JSON.stringify(types)}; ${noLw} non-fill natives without lwFrame; ${n} tiles read under it`);
    }
    // classifyUp's tiers for one tile, as it is
    const tierOf = (c) => {
        const fr = lm.frame(c.F), rec = fr.edge, rect = lm.tileRect(c.F, c.i, c.j), out = {};
        for (const o of doc.cellList(fr.parent)) { const t = classifyUp(o, rec.s, rec.t, rect, E.cfg, null, null); out[o.type + ":" + t] = (out[o.type + ":" + t] || 0) + 1; }
        return out;
    };
    const bakeAll = (label) => {
        so.bumpEpoch();
        const res = [];
        for (const c of cells) {
            const t0 = perfNow();
            const objs = so._bakeUp(c.F, c.i, c.j);
            res.push({ k: c.k, ms: perfNow() - t0, n: objs.length, sigs: objs.map(pieceSig).sort() });
        }
        const total = res.reduce((s, r) => s + r.ms, 0);
        log(`${label}: ${res.length} up tiles baked in ${total.toFixed(0)} ms (max ${Math.max(...res.map((r) => r.ms)).toFixed(0)}), ${res.reduce((s, r) => s + r.n, 0)} pieces`);
        return res;
    };
    log(`tiers, as built, tile ${cells[0].k}: ${JSON.stringify(tierOf(cells[0]))}`);
    const asIs = bakeAll("as built (shape cull NaN)");
    const asIs2 = bakeAll("as built, again");
    // the cull as meant: a shape's half-width is 0 (lwFrame 0 changes nothing else: every other reader takes `lwFrame || 0`)
    const shapes = [];
    for (const k of doc.levels()) for (const o of doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) { o.lwFrame = 0; shapes.push(o); }
    log(`tiers, culled, tile ${cells[0].k}: ${JSON.stringify(tierOf(cells[0]))}`);
    const culled = bakeAll(`with lwFrame 0 on ${shapes.length} shapes`);
    const culled2 = bakeAll("with lwFrame 0, again");
    let same = 0, diff = 0;
    const diffs = [];
    for (let k = 0; k < asIs.length; k++) {
        const a = asIs[k].sigs, b = culled[k].sigs;
        const eq = a.length === b.length && a.every((s, n) => s === b[n]);
        if (eq) same++; else { diff++; diffs.push({ k: asIs[k].k, asIs: a.length, culled: b.length, onlyAsIs: a.filter((s) => !b.includes(s)).map((s) => s.slice(0, 40)), onlyCulled: b.filter((s) => !a.includes(s)).map((s) => s.slice(0, 40)) }); }
    }
    log(`pieces identical in ${same} of ${asIs.length} tiles; ${diff} differ ${JSON.stringify(diffs).slice(0, 3000)}`);
    for (const o of shapes) delete o.lwFrame;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "cull.json"), JSON.stringify({ cells: cells.map((c) => c.k), asIs: asIs.map((r) => [r.k, +r.ms.toFixed(1), r.n]), asIs2: asIs2.map((r) => [r.k, +r.ms.toFixed(1), r.n]), culled: culled.map((r) => [r.k, +r.ms.toFixed(1), r.n]), culled2: culled2.map((r) => [r.k, +r.ms.toFixed(1), r.n]), diffs }, null, 1));
    E.destroy();
    setRasterTransport(null); setRasterWorkerCount(null);
});

/**
 * The same comparison over whole chains: every tile the reads bake (the camera's window and every reroute group's
 * source tiles, parents included), keyed by tile, as built and with the cull. R4 (depth 3, chains of 3) and R6's
 * extract (the Magnum Opus around a depth-10 camera; the extract only, as CONTEXT asks).
 */
function chainCompare(file, { drawing = true, label }) {
    resetRasterWorkerClient(); setRasterWorkerCount(4);
    setRasterTransport(() => new Promise(() => {}));
    const f = path.join(REPORT_DIR, file);
    const rep = readReportFile(f);
    const E = mk(1806, 1070);
    loadReport(E, rep, { drawing: drawing ? drawingPartsOf(f) : null });
    E._render();
    const so = E.store, doc = E.doc, lm = E.lm;
    const F = String(E.cam.frame), win = E._listWin();
    const m = so._rerouteGroups(F, true);
    const cells = [];
    const add = (G, w) => { const r = lm.tileRange(G, w); for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) for (const d of ["up", "down"]) cells.push([G, d, i, j]); };
    add(F, win);
    if (m) for (const g of m.groups.values()) add(String(g.F0), { left: win.left - g.rem[0], top: win.top - g.rem[1], right: win.right - g.rem[0], bottom: win.bottom - g.rem[1] });
    const snap = (tag) => {
        so.bumpEpoch();
        const t0 = perfNow();
        so.readTiles(cells, Infinity);
        const ms = perfNow() - t0;
        const out = new Map();
        for (const [key, t] of so.cache) out.set(key, t.objs.map(pieceSig).sort());
        let pieces = 0; for (const v of out.values()) pieces += v.length;
        log(`${label} ${tag}: ${cells.length} cells read, ${out.size} tiles baked (parents included) in ${ms.toFixed(0)} ms, ${pieces} pieces`);
        return { out, ms };
    };
    const a = snap("as built");
    const shapes = [];
    for (const k of doc.levels()) for (const o of doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) { o.lwFrame = 0; shapes.push(o); }
    const b = snap(`culled (${shapes.length} shapes)`);
    let same = 0, diff = 0, onlyA = 0, onlyB = 0;
    const diffs = [];
    for (const [key, sa] of a.out) {
        const sb = b.out.get(key);
        if (!sb) { onlyA++; continue; }
        if (sa.length === sb.length && sa.every((x, n) => x === sb[n])) same++; else { diff++; if (diffs.length < 10) diffs.push({ key, a: sa.length, b: sb.length }); }
    }
    for (const key of b.out.keys()) if (!a.out.has(key)) onlyB++;
    log(`${label}: tiles identical ${same}, differ ${diff}, only as built ${onlyA}, only culled ${onlyB} ${JSON.stringify(diffs)}`);
    for (const o of shapes) delete o.lwFrame;
    E.destroy();
    setRasterTransport(null); setRasterWorkerCount(null);
    return { same, diff, onlyA, onlyB, msA: a.ms, msB: b.ms };
}

test("chains: R4 at its camera (depth 3)", () => {
    const r = chainCompare("report-2026-10-07T03-24-11-129Z.json", { label: "R4" });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "cull-chain-r4.json"), JSON.stringify(r, null, 1));
});

test("chains: R6's extract at its camera (depth 10)", () => {
    const r = chainCompare("report-2026-10-07T03-39-00-036Z.json", { drawing: false, label: "R6 extract" });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "cull-chain-r6x.json"), JSON.stringify(r, null, 1));
});
