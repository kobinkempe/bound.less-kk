/**
 * review1006.picture.ants.probe.js — Kobin's R2 (report 03-17-06-829Z, "a phantom circle selected"):
 * the whole drawing at the report's camera with the report's selection, and the ants the engine
 * decides, each run attributed to the item it traces. A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.ants.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import { loopRuns, clipRunToRect, runLength, loopsBounds } from "./geometry/antRuns";
import { translateLoops } from "./geometry/arcShape";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(20 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "picture");
const r2 = (v) => Math.round(v * 100) / 100;

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}
const toScr = (E, p) => [r2(p[0] * E.cam.inScale + E.cam.inPanX), r2(p[1] * E.cam.inScale + E.cam.inPanY)];
function piecesScr(E, pieces) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const arcs = [];
    for (const p of pieces) {
        for (const q of [p.A, p.B]) { if (!q) continue; const s = toScr(E, q); x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[0]); y1 = Math.max(y1, s[1]); }
        if (p.C && p.r != null) arcs.push({ C: toScr(E, p.C), rPx: r2(p.r * E.cam.inScale), sweep: r2(p.sweep) });
    }
    return { box: [x0, y0, x1, y1].map(r2), arcs };
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); });

test("R2: the ants the engine decides at the report's camera and selection", async () => {
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-17-06-829Z.json");
    const rep = readReportFile(f);
    const t0 = Date.now();
    const E = mk(1806, 1070);
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    log(`loaded in ${Date.now() - t0} ms; frame ${E.cam.frame} inScale ${E.cam.inScale} pan ${E.cam.inPanX},${E.cam.inPanY}`);
    E.setTool("select");
    E._render();
    const sel = rep.moves.selection;
    E._setSelection(sel.ids, sel.frames, true);
    E._render();
    const s = E.selection;
    log(`selection ids ${JSON.stringify(s.ids)} frames ${JSON.stringify(s.frames)} id ${s.id} level ${s.level}`);
    const out = { frames: {}, members: [], items: [], runs: [], marks: [], table: null };
    // where the selected frames and the members' homes are now
    const frameInfo = (id) => {
        const fr = E.lm.frame(id);
        if (!fr) return null;
        return { id, parent: fr.parent, cell: fr.cell, shift: fr.shift || null, private: !!fr.private, depth: fr.depth, natives: E.doc.count(id) };
    };
    for (const id of sel.frames) out.frames[id] = frameInfo(id);
    for (const id of sel.ids) {
        const rec = E.doc.getById(id);
        if (!rec) { out.members.push({ id, missing: true }); continue; }
        const grp = E.doc.editGroup(id).map((m) => ({ id: m.obj.id, level: m.level, frame: frameInfo(m.level), erase: !!m.obj.erase, type: m.obj.type, attach: m.obj.attachRect || null, below: m.obj.below || null }));
        const box = E.stage.placeNative(rec.obj, E.cam.frame).box();
        out.members.push({ id, level: rec.level, homeFrame: frameInfo(rec.level), below: rec.obj.below || null, drawnBoxScr: box && [toScr(E, [box.left, box.top]), toScr(E, [box.right, box.bottom])], group: grp });
    }
    const table = E._selTable(s);
    out.table = { count: table.count, cross: [...table.cross], frames: [...table.frames], byLevel: [...table.byLevel].map(([L, e]) => ({ L, objs: e.objs.map((o) => o.id), frame: !!e.frame, boxes: [...e.boxes].map(([k, b]) => ({ k: k.slice(0, 60), nat: b.nat ? b.nat.id : null, box: b.box })) })) };
    for (const [L, info] of table.byLevel) {
        const r = E._selFrameRect(info, L, E.cam.frame);
        log(`table level ${L}: objs ${info.objs.map((o) => o.id)} frame ${!!info.frame}; drawn rect ${r ? JSON.stringify([toScr(E, [r.left, r.top]), toScr(E, [r.right, r.bottom])]) : "null"} span ${r ? r2(Math.max(r.right - r.left, r.bottom - r.top) * E.cam.inScale) : "-"} px`);
    }
    for (const fr of table.frames) {
        const r = E._selFrameContent(fr, E.cam.frame);
        log(`frame ${fr}: content (F103) ${r ? JSON.stringify([toScr(E, [r.left, r.top]), toScr(E, [r.right, r.bottom])]) : "null"} span ${r ? r2(Math.max(r.right - r.left, r.bottom - r.top) * E.cam.inScale) : "-"} px`);
        E.lm.walk(fr, (g) => { const ink = E._selFrameInk(g, E.cam.frame); log(`   subtree frame ${g.id} natives ${E.doc.count(g.id)} shift ${JSON.stringify(g.shift || null)} cell ${JSON.stringify(g.cell)} parent ${g.parent} private ${!!g.private} ink ${ink ? JSON.stringify([toScr(E, [ink.left, ink.top]), toScr(E, [ink.right, ink.bottom])]) : "null"}`); });
    }
    // The decision itself.
    E._selDec = null;
    const ants = E._selectionAnts();
    const dec = E._selDec;
    log(`decision: ${dec.runs.length} runs, ${dec.marks.length} marks, inkPx ${dec.inkPx}`);
    for (const m of dec.marks) {
        const p = m.pieces[0];
        out.marks.push({ C: toScr(E, p.C), rPx: r2(p.r * E.cam.inScale) });
    }
    log(`marks: ${JSON.stringify(out.marks)}`);
    // Each run, attributed: replay the decision's per-item loop with the real helpers.
    const F = E.cam.frame, sc = E.cam.inScale;
    const memo = new Map(), seam = new Map();
    const keepWin = dec.win, keep = { x0: keepWin.left, y0: keepWin.top, x1: keepWin.right, y1: keepWin.bottom };
    for (const item of E.stage.items()) {
        const own = table.ids.has(item.id);
        const fr = own ? null : E._selFrameOf(item.id, table, memo);
        if (!own && !fr) continue;
        const { geom: piece, off } = E.stage.placed(item);
        let loops = E._selPieceLoops(piece);
        const nat = E.doc.getById(item.id);
        const info = { id: item.id, own, underFrame: fr, key: item.key, type: item.type, off: item.off, color: item.color, opacity: item.opacity, erase: !!item.erase, fadeTag: item.fadeTag || null,
            home: nat ? nat.level : null, clip: item.clip || null, nLoops: loops ? loops.length : 0 };
        if (!loops || !loops.length) { out.items.push(info); continue; }
        if (off[0] || off[1]) loops = translateLoops(loops, off[0], off[1]);
        const b = loopsBounds(loops);
        info.boundsScr = b && [toScr(E, [b.x0, b.y0]), toScr(E, [b.x1, b.y1])];
        info.loopsScr = loops.map((L) => piecesScr(E, L));
        const rects = E._selSeamRects(piece, off, table, F, seam);
        info.seamRects = rects.map((r) => r.rect);
        info.runs = [];
        for (const loop of loops) {
            for (const seamRun of loopRuns(loop, rects)) {
                for (const run of clipRunToRect(seamRun, keep)) {
                    const len = runLength(run.pieces) * sc;
                    if (len < 0.5) continue;
                    const ps = piecesScr(E, run.pieces);
                    info.runs.push({ lenPx: r2(len), closed: run.closed, n: run.pieces.length, box: ps.box, arcs: ps.arcs.slice(0, 6) });
                }
            }
        }
        out.items.push(info);
    }
    for (const it of out.items) log(`item ${it.id} own ${it.own} underFrame ${it.underFrame} key ${it.key} type ${it.type} home ${it.home} off ${JSON.stringify(it.off)} color ${it.color} op ${it.opacity} fade ${JSON.stringify(it.fadeTag)} loops ${it.nLoops} bounds ${JSON.stringify(it.boundsScr)} runs ${it.runs ? it.runs.length : 0}`
        + (it.runs ? it.runs.map((r) => `\n     run ${r.lenPx}px closed ${r.closed} n ${r.n} box ${JSON.stringify(r.box)} arcs ${JSON.stringify(r.arcs.slice(0, 3))}`).join("") : ""));
    log(`edges ${JSON.stringify(ants && ants.edges)}`);
    // The F103 box against where the frame's natives are drawn: `_selFrameInk` reads the index extent through
    // the FRAME's shift only; each native also carries its own table.
    const FR = "-1/-6,-2/1424,1352";
    const g = E.lm.frame(FR);
    const ext = E.doc.frameExtent(FR);
    log(`frame ${FR}: extent ${JSON.stringify(ext && ext.box)} shift ${JSON.stringify(g.shift)}`);
    for (const o of E.doc.at(FR)) {
        const pb = E.stage.placeNative(o, F).box();
        log(`  native ${o.id} below ${JSON.stringify(o.below || null)} tableOf ${JSON.stringify(E.doc.tableOf(o, FR))} drawn box (placeNative) ${pb ? JSON.stringify([toScr(E, [pb.left, pb.top]), toScr(E, [pb.right, pb.bottom])]) : "null"}`);
    }
    // Experiments (no source edited): the decision again (1) without the frame entry, (2) with the
    // F103 fallback answering null, (3) ids only for the frame's natives taken out.
    const again = (label) => { E._selDec = null; E._selTableCache = null; const a = E._selectionAnts(); const d = E._selDec;
        log(`${label}: ${d.runs.length} runs, marks ${JSON.stringify(d.marks.map((m) => ({ C: toScr(E, m.pieces[0].C), rPx: r2(m.pieces[0].r * E.cam.inScale) })))}`); return a; };
    E._setSelection(sel.ids, sel.frames.filter((x) => x !== FR), true); again("(1) without the frame entry " + FR);
    E._setSelection(sel.ids, sel.frames, true);
    const orig = E._selFrameContent; E._selFrameContent = () => null; again("(2) F103 fallback silenced"); E._selFrameContent = orig;
    E._setSelection([], sel.frames, true); again("(3) frames only, no ids");
    E._setSelection(sel.ids, sel.frames, true); again("(4) the report's selection again");
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "r2-ants.json"), JSON.stringify(out, null, 1));
    E.destroy();
});
