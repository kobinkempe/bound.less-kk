/**
 * phone.bugs.probe.js — Kobin's three phone reports of 2026-09-23 replayed in a raster engine at
 * the phone's 411x750 @2.625 with the phone's plate cap. A probe, not a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/phone.bugs.probe.js"
 */
import KobinEngine from "../KobinEngine";
import { PHONE_CACHE_BYTES } from "./PlateStore";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "../__testkit__/reportReplay";
import { loadReport } from "../report";
import { resetRasterWorkerClient, setRasterWorkerCount, rasterWorkerReport } from "./rasterWorkerClient";
import { planeStats, resetPlaneStats } from "./MovePlane";

const path = require("path");
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const W = 411, H = 750, DPR = 2.625;

jest.setTimeout(10 * 60 * 1000);

function mkPhone() {
    Object.defineProperty(window, "devicePixelRatio", { value: DPR, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: W, height: H, raster: true });
    E.plates.maxBytes = PHONE_CACHE_BYTES; E.plates.phone = true;
    E.renderer.layer.syncBudget = 0; E.renderer.layer._sync = false;
    return E;
}
async function flush(rounds = 40) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return k + 1;
    }
    return rounds;
}
const r3 = (v) => Math.round(v * 1000) / 1000;
function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return [r3(x0), r3(y0), r3(x1), r3(y1)];
}
function describeDoc(E) {
    for (const F of E.lm.frames ? [...E.lm.frames.keys()] : []) {
        for (const o of E.doc.list(F) || []) {
            const pts = o.pts || (o.polys ? [].concat(...o.polys) : o.loops ? [] : []);
            log(`  frame ${F} id ${o.id} ${o.type} ${o.color} op ${o.opacity} lw ${r3(o.lwFrame || 0)} z ${o.z} below ${JSON.stringify(o.below || null)} bbox ${pts.length ? bbox(pts) : "-"} key ${o.editKey || o.familyKey || ""}`);
        }
    }
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); resetPlaneStats(); });

/** Natives in a frame's whole subtree. */
function subtreeCount(E, id) { let n = 0; E.lm.walk(id, (f) => { n += E.doc.count(f.id || f); }); return n; }

describe("bug 3 — the zoomed-out lasso", () => {
    test("the lattice and the selection", async () => {
        const f = path.join(REPORT_DIR, "report-2026-09-23T08-16-23-082Z.json");
        const rep = readReportFile(f);
        const E = mkPhone();
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        E._render(); await flush();
        log(`camera depth ${E.cam.activeLevel} frame ${E.cam.frame} inScale ${E.cam.inScale} pan ${E.cam.inPanX},${E.cam.inPanY}; frames ${E.lm.frames.size}`);
        const byDepth = new Map();
        for (const fr of E.lm.frames.values()) {
            const k = fr.depth;
            const e = byDepth.get(k) || { n: 0, withNatives: 0, byParent: new Map() };
            e.n++; if (E.doc.count(fr.id)) e.withNatives++;
            e.byParent.set(fr.parent, (e.byParent.get(fr.parent) || 0) + 1);
            byDepth.set(k, e);
        }
        for (const [d, e] of [...byDepth].sort((a, b) => a[0] - b[0])) log(`  depth ${d}: ${e.n} frames, ${e.withNatives} with natives; parents ${JSON.stringify([...e.byParent])}`);
        for (const fr of E.lm.frames.values()) if (E.doc.count(fr.id)) log(`  natives in ${fr.id} (depth ${fr.depth}): ${E.doc.list(fr.id).map((o) => o.id + (o.below ? "[" + JSON.stringify(o.below) + "]" : "")).join(",")}`);
        for (const fr of E.lm.frames.values()) if (fr.shift || fr.shadowOf || fr._shadows) log(`  frame ${fr.id} shift ${JSON.stringify(fr.shift)} shadowOf ${fr.shadowOf} shadows ${fr._shadows ? [...fr._shadows] : ""}`);
        const sel = rep.moves.selection;
        let empty = 0;
        for (const id of sel.frames) { const fr = E.lm.frame(id); if (!fr) { log(`  selected frame ${id} not in the lattice`); continue; } if (!subtreeCount(E, id)) empty++; }
        log(`  the report's selection: ${sel.frames.length} frames, ${empty} with no native in their subtree; kids of -2/0,2: ${E.lm.childrenOf("-2/0,2").length}`);
        // the depth-0 cells under -2/0,2 on screen
        const c = E.lm.frame("-2/0,2");
        log(`  -2/0,2 cell ${JSON.stringify(c && c.cell)} shift ${JSON.stringify(c && c.shift)}; -2/0,1 cell ${JSON.stringify(E.lm.frame("-2/0,1").cell)}; -1 cell ${JSON.stringify(E.lm.frame("-1").cell)} parent ${E.lm.frame("-1").parent}`);
        // where the selected frames sit on screen
        const scr = sel.frames.map((id) => E.cam.levelPointToScreen(id, 0, 0)).map((p) => [Math.round(p[0]), Math.round(p[1])]);
        log(`  the 50 frames on screen: ${JSON.stringify(scr.slice(0, 12))} ...`);
        for (const id of ["-2/0,1", "-2/0,2", "-2/0,3", "-2/0,4", "-2/1,2", "-2/1,3", "-1"]) {
            const p = E.cam.levelPointToScreen(id, 0, 0); log(`  frame ${id} centre on screen ${p.map(Math.round)}`);
        }
        // "select everything": a loop along the screen's edge, 12 px in
        E.setTool("select");
        const m = 12, loop = [[m, m], [W - m, m], [W - m, H - m], [m, H - m]];
        const pts = [];
        for (let k = 0; k < 4; k++) { const a = loop[k], b = loop[(k + 1) % 4]; for (let t = 0; t < 20; t++) pts.push([a[0] + (b[0] - a[0]) * t / 20, a[1] + (b[1] - a[1]) * t / 20]); }
        E.pointerDown(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerMove(pts[0][0], pts[0][1]);
        E.pointerUp();
        const S = E.selection;
        const emptyF = S ? S.frames.filter((id) => !subtreeCount(E, id)) : [];
        log(`  lasso of the whole screen: ids ${S && JSON.stringify(S.ids)} frames ${S && S.frames.length} (${emptyF.length} empty) ${S && JSON.stringify(S.frames.slice(0, 6))}; status ${JSON.stringify(E._selectionStatus && E._selectionStatus().count)}`);
        const a = E._selectionAnts();
        log(`  indicator: runs ${a ? a.runs.length : 0} marks (dots) ${a ? a.marks.length : 0}`);
        E.destroy();
    });

    test("a zoomed-out drag of the lassoed drawing: frames minted per step", async () => {
        const f = path.join(REPORT_DIR, "report-2026-09-23T08-16-23-082Z.json");
        const rep = readReportFile(f);
        const E = mkPhone();
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        E._render(); await flush();
        const c0 = E.cam.levelPointToScreen("-2", 0, 20);
        E.zoomFactorAt(c0[0], c0[1], 2.8992 / E.cam.inScale);
        E._render(); await flush();
        log(`camera inScale ${E.cam.inScale}; -2 origin on screen ${E.cam.levelPointToScreen("-2", 0, 0).map(Math.round)}`);
        E.setTool("select");
        const m = 12, loop = [[m, m], [W - m, m], [W - m, H - m], [m, H - m]];
        const pts = [];
        for (let k = 0; k < 4; k++) { const a = loop[k], b = loop[(k + 1) % 4]; for (let t = 0; t < 20; t++) pts.push([a[0] + (b[0] - a[0]) * t / 20, a[1] + (b[1] - a[1]) * t / 20]); }
        E.pointerDown(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerMove(pts[0][0], pts[0][1]);
        E.pointerUp();
        const S = E.selection;
        log(`  lasso: ids ${JSON.stringify(S.ids)} frames ${JSON.stringify(S.frames)}`);
        // drag from a selected object (28)
        let at = null;
        for (let y = 5; y < H && !at; y += 2) for (let x = 5; x < W && !at; x += 2) if (E._hitTest(x, y) === 28) at = [x, y];
        const n0 = E.lm.frames.size;
        const before = new Set(E.lm.frames.keys());
        E.pointerDown(at[0], at[1]);
        const steps = 40, DX = 28.895508 * E.cam.inScale, DY = 15.689453 * E.cam.inScale;
        const perStep = [];
        for (let k = 1; k <= steps; k++) { E.pointerMove(at[0] + DX * k / steps, at[1] + DY * k / steps); perStep.push(E.lm.frames.size); }
        const carriedAtDrop = E._carried ? [...E._carried] : null;
        E.pointerUp();
        log(`  carried mid-drag: ${JSON.stringify(carriedAtDrop)}; selection right after the drop: ${JSON.stringify(E.selection.frames)} ids ${JSON.stringify(E.selection.ids)}`);
        E._render(); await flush();
        const minted = [...E.lm.frames.keys()].filter((k) => !before.has(k));
        log(`  drag of ${steps} steps: frames ${n0} -> ${E.lm.frames.size}; per step ${perStep.join(",")}`);
        log(`  minted: ${minted.length}, e.g. ${JSON.stringify(minted.slice(0, 8))}; empty ${minted.filter((k) => !subtreeCount(E, k)).length}`);
        log(`  after the drop: ids ${JSON.stringify(E.selection && E.selection.ids)} frames ${E.selection && E.selection.frames.length} (${E.selection ? E.selection.frames.filter((id) => !subtreeCount(E, id)).length : 0} empty)`);
        for (const id of [18, 22, 93, 106, 1, 12, 83, 89]) {
            const rec = E.doc.getById(id);
            log(`    native ${id}: home ${rec && rec.level} exists ${!!(rec && E.lm.frame(rec.level))} selected ${E._isSelected(id)}`);
        }
        for (const id of ["-1", "-2/0,1", "-2/0,2", "-2/0,3"]) {
            const fr = E.lm.frame(id);
            log(`    frame ${id}: exists ${!!fr} inSel ${E.selection.frames.includes(id)} shadowOf ${fr && fr.shadowOf} count ${subtreeCount(E, id)} cell ${fr && JSON.stringify(fr.cell)}`);
        }
        log(`    selected frames ${JSON.stringify(E.selection.frames)}`);
        for (const id of [83, 95, 108, 85, 88, 89]) { const r = E.doc.getById(id); const chain = []; for (let f = E.lm.frame(r.level); f; f = f.parent != null ? E.lm.frame(f.parent) : null) chain.push(f.id + (f.shift ? "(shift)" : "")); log(`    ${id} selected ${E._isSelected(id)} chain ${chain.join(" < ")}`); }
        const st = E._selectionStatus();
        log(`    status count ${st.count}; ants ${(() => { const a = E._selectionAnts(); return a ? a.runs.length + " runs " + a.marks.length + " dots" : "none"; })()}`);
        E.undo(); E._render(); await flush();
        log(`  after undo: frames ${E.lm.frames.size}; selection ids ${JSON.stringify(E.selection && E.selection.ids)} frames ${E.selection && E.selection.frames.length} (${E.selection ? E.selection.frames.filter((id) => !subtreeCount(E, id)).length : 0} empty)`);
        E.destroy();
    });
});

describe("bug 1 — the beige object's drag", () => {
    test("load and inspect", async () => {
        const f = path.join(REPORT_DIR, "report-2026-09-23T08-11-20-977Z.json");
        const rep = readReportFile(f);
        const E = mkPhone();
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        E._render();
        await flush();
        log(`camera depth ${E.cam.activeLevel} frame ${E.cam.frame} inScale ${E.cam.inScale} pan ${E.cam.inPanX},${E.cam.inPanY}`);
        describeDoc(E);
        const v = E.renderer._view;
        log(`view mode ${v.mode} q ${v.q} Zq ${v.Zq} range i ${v.i0}..${v.i1} j ${v.j0}..${v.j1} dpr ${v.dpr}`);
        log(`list ${E._lastList.map((o) => o.id + ":" + o.type + (o.res ? " res" : "")).join(", ")}`);
        for (const id of [39, 44]) {
            E._setSelection([id]);
            E._render();
            await new Promise((r) => setTimeout(r, 200));
            E._render();
            await new Promise((r) => setTimeout(r, 200));
            await flush();
            const pl = E.renderer._plane;
            log(`select ${id}: cap ${E.renderer.planeCap} refused ${pl.refused} layers ${pl.layers.map((L) => L.kind + ":" + L.cells.length).join(" ")} keys ${pl.keys.length} stats ${JSON.stringify(planeStats)}`);
            // the plane's cut without the cap
            E.renderer._planeCap = 1000;
            E.renderer._endPlane(); E._render();
            await new Promise((r) => setTimeout(r, 200)); E._render(); await flush();
            log(`   uncapped: layers ${pl.layers.map((L) => L.kind + ":" + L.cells.length).join(" ")} keys ${pl.keys.length}`);
            E.renderer._planeCap = null;
            E.deselect();
        }
        E.destroy();
    });

    test("the plane at the journal's zoom, and a drag of 39", async () => {
        const f = path.join(REPORT_DIR, "report-2026-09-23T08-11-20-977Z.json");
        const rep = readReportFile(f);
        const E = mkPhone();
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        E._render(); await flush();
        E.zoomFactorAt(W / 2, H / 2, 21.7595 / E.cam.inScale);
        E._render(); await new Promise((r) => setTimeout(r, 200)); E._render(); await flush();
        log(`camera inScale ${E.cam.inScale} view ${JSON.stringify((({ q, i0, i1, j0, j1 }) => ({ q, i0, i1, j0, j1 }))(E.renderer._view))}`);
        E.renderer._planeCap = 1000;
        for (const id of [39, 44]) {
            E._setSelection([id]); E._render();
            await new Promise((r) => setTimeout(r, 200)); E._render(); await new Promise((r) => setTimeout(r, 200)); await flush();
            const pl = E.renderer._plane;
            log(`  zoom 21.76 select ${id}: layers ${pl.layers.map((L) => L.kind + ":" + L.cells.length).join(" ")} keys ${pl.keys.length}`);
            E.deselect(); E.renderer._endPlane();
        }
        E.renderer._planeCap = null;
        // a point on 39 alone
        let at = null;
        for (let y = 5; y < H && !at; y += 4) for (let x = 5; x < W && !at; x += 4) if (E._hitTest(x, y) === 39) at = [x, y];
        log(`  39 is under ${at}`);
        E.setTool("select");
        E.pointerDown(at[0], at[1]); E.pointerUp();
        E._render(); await new Promise((r) => setTimeout(r, 200)); E._render(); await new Promise((r) => setTimeout(r, 200)); await flush();
        const lists = jest.spyOn(E, "_buildList");
        const { rasterStats } = require("./RasterRenderer");
        const p0 = rasterStats.posts;
        E.pointerDown(at[0], at[1]);
        for (let k = 1; k <= 30; k++) E.pointerMove(at[0] + k * 2, at[1] + k);
        log(`  drag of 39 (cap ${E.renderer.planeCap}): hold ${!!E._holdMove} plane ${E.renderer._plane.state} refused ${E.renderer._plane.refused} lists ${lists.mock.calls.length} posts ${rasterStats.posts - p0}`);
        E.pointerUp();
        E.destroy();
    });
});

describe("the 3.15e7 warning on item 28", () => {
    test("what reaches past the bound: a point, or an arc's centre and radius", () => {
        const { entryFor, COORD_BOUND } = require("./rasterPack");
        const f = path.join(REPORT_DIR, "report-2026-09-23T08-16-23-082Z.json");
        const E = mkPhone();
        loadReport(E, readReportFile(f), { drawing: drawingPartsOf(f) });
        const o = E.doc.getById(28).obj;
        const e = entryFor(o, E.cfg);
        let pt = 0, c = 0, r = 0, n = 0;
        for (const loop of o.loops) for (const p of loop) { n++; pt = Math.max(pt, Math.abs(p.A[0]), Math.abs(p.A[1]), Math.abs(p.B[0]), Math.abs(p.B[1])); if (p.C) c = Math.max(c, Math.abs(p.C[0]), Math.abs(p.C[1])); if (p.r) r = Math.max(r, p.r); }
        log(`item 28: ${o.type}, ${n} pieces; maxAbs ${e.maxAbs.toExponential(3)} (bound ${COORD_BOUND}); points reach ${pt.toExponential(3)}; centres ${c.toExponential(3)}; radius ${r.toExponential(3)}`);
        E.destroy();
    });
});
