/**
 * frame.gc.probe.js — frame GC (F94) and §2.2 measured on Kobin's phone drawing (report 08-16-23) and
 * on the Magnum Opus export. A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=10240 npx react-scripts test --watchAll=false --testMatch "**\/frame.gc.probe.js"
 */
import { mkEngine } from "./__testkit__/harness";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { OpLog } from "./oplog";
import { encodeObjects, decodeObjects } from "./format2";
import { collectFrames } from "./frameGc";

const path = require("path");
const fs = require("fs");
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
jest.setTimeout(30 * 60 * 1000);

const snapshot = (E, lg) => {
    const frames = {}, frameSeq = {};
    for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = encodeObjects(E.doc.at(level)); frameSeq[level] = lg.seq; }
    return { frames, frameSeq, crossings: E.lm.serialize(), camera: E.cam.state() };
};
const restore = (snap, entries, crossings, w, h) => {
    const F = mkEngine(w, h);
    const nat = {};
    for (const level of Object.keys(snap.frames)) nat[level] = decodeObjects(snap.frames[level].objects, snap.frames[level].geo);
    F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: snap.camera, crossings, natives: nat });
    new OpLog(F).replay(entries, snap.frameSeq);
    return F;
};
const nat = (E) => { for (const k of [...E.lm.frames.keys()]) E.doc.at(k); const n = E.doc.serializeNatives(); for (const k of Object.keys(n)) if (!n[k].length) delete n[k]; return JSON.stringify(n); };
// The same content with frames and lists in id order: tells an order difference from a content one.
const natSorted = (E) => { const n = JSON.parse(nat(E)); return JSON.stringify(Object.keys(n).sort().map((k) => [k, n[k].sort((a, b) => a.id - b.id)])); };
const order = (E) => { const n = JSON.parse(nat(E)); return JSON.stringify(Object.keys(n).sort().map((k) => [k, n[k].map((o) => o.id)])); };
const lat = (E) => JSON.stringify(E.lm.serialize());
const empties = (E) => { let n = 0; for (const f of E.lm.frames.values()) if (!E.doc.count(f.id) && !(f._kids && f._kids.size) && !(f._shadows && f._shadows.size)) n++; return n; };
const timed = (fn) => { const t = now(); const r = fn(); return [r, +(now() - t).toFixed(2)]; };

test("report 08-16-23: load sweep, a 40-step drag, a delete, undo/redo, reload", () => {
    const f = path.join(REPORT_DIR, "report-2026-09-23T08-16-23-082Z.json");
    const E = mkEngine(411, 750);
    loadReport(E, readReportFile(f), { drawing: drawingPartsOf(f) });
    E._render();
    log(`load: ${E.lm.frames.size} frames, ${empties(E)} empty`);
    const [swept, ms0] = timed(() => E.sweepFrames());
    log(`the load sweep (the first gesture's end): forgot ${swept} in ${ms0} ms -> ${E.lm.frames.size} frames, ${empties(E)} empty (the camera's chain and history keep those)`);
    const lg = new OpLog(E); lg.drain();
    const snap = snapshot(E, lg);
    const c0 = E.cam.levelPointToScreen("-2", 0, 20);
    E.zoomFactorAt(c0[0], c0[1], 2.8992 / E.cam.inScale); E._render();
    E.setTool("select");
    const m = 12, loop = [[m, m], [411 - m, m], [411 - m, 750 - m], [m, 750 - m]], pts = [];
    for (let k = 0; k < 4; k++) { const a = loop[k], b = loop[(k + 1) % 4]; for (let t = 0; t < 20; t++) pts.push([a[0] + (b[0] - a[0]) * t / 20, a[1] + (b[1] - a[1]) * t / 20]); }
    E.pointerDown(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]); E.pointerMove(pts[0][0], pts[0][1]); E.pointerUp();
    const S = E.selection;
    log(`lasso: ids ${JSON.stringify(S.ids)} frames ${JSON.stringify(S.frames)}; status count ${E._selectionStatus().count}`);
    const before = { nat: nat(E), lat: lat(E), frames: E.lm.frames.size };
    let at = null;
    for (let y = 5; y < 750 && !at; y += 2) for (let x = 5; x < 411 && !at; x += 2) if (E._hitTest(x, y) === 28) at = [x, y];
    const DX = 28.895508 * E.cam.inScale, DY = 15.689453 * E.cam.inScale;
    let peak = 0;
    E.pointerDown(at[0], at[1]);
    for (let k = 1; k <= 40; k++) { E.pointerMove(at[0] + DX * k / 40, at[1] + DY * k / 40); peak = Math.max(peak, E.lm.frames.size); }
    const [, msDrop] = timed(() => E.pointerUp());
    E._render();
    log(`40-step drag: frames ${before.frames} -> peak ${peak} during -> ${E.lm.frames.size} after the drop (${empties(E)} empty; drop ${msDrop} ms incl. its collection); selection count ${E._selectionStatus().count}; shifts over W/2: ${[...E.lm.frames.values()].filter((fr) => fr.shift && (Math.abs(fr.shift[0]) > 65536 || Math.abs(fr.shift[1]) > 65536)).length}`);
    const moved = { nat: nat(E), lat: lat(E), sorted: natSorted(E), order: order(E) };
    E.deleteSelection();
    log(`delete: ${E.lm.frames.size} frames (${empties(E)} empty: the removeFrames op names them)`);
    const deleted = { nat: nat(E), lat: lat(E) };
    E.undo(); log(`undo the delete: natives ${nat(E) === moved.nat ? "EXACT" : "DIFFER"} (content ${natSorted(E) === moved.sorted ? "EXACT" : "DIFFERS"}, list order ${order(E) === moved.order ? "same" : "differs: " + order(E).slice(0, 300) + " vs " + moved.order.slice(0, 300)}), lattice ${lat(E) === moved.lat ? "EXACT" : "DIFFER"}`);
    E.redo(); log(`redo the delete: natives ${nat(E) === deleted.nat ? "EXACT" : "DIFFER"}, lattice ${lat(E) === deleted.lat ? "EXACT" : "DIFFER"}`);
    E.undo(); E.undo();
    const was = new Set(JSON.parse(before.lat).frames.map((fr) => fr.id));
    const extra = [...E.lm.frames.keys()].filter((k) => !was.has(k));
    const named = E.doc.namedFrames();
    log(`undo the drag too: natives ${nat(E) === before.nat ? "EXACT" : "DIFFER"}, lattice ${lat(E) === before.lat ? "EXACT" : "+" + extra.length + " frames, all empty and named by the redo stack: " + extra.every((k) => named.has(k) && !E.doc.count(k))}`);
    {
        // the redo branch dies with a new action: its containers go, and the lattice is the start's
        const B = mkEngine(411, 750);
        B.loadSnapshot(E.snapshot()); B.doc._undo = E.doc._undo.slice(); B.doc._redo = E.doc._redo.slice();
        B.doc.pushUndo({ op: "noop" }); collectFrames(B);
        const bl = JSON.stringify(B.lm.serialize().frames.map((fr) => fr.id).sort()), el = JSON.stringify(JSON.parse(before.lat).frames.map((fr) => fr.id).sort());
        log(`... after a new action kills the redo branch: frames ${bl === el ? "EQUAL the start's" : "DIFFER: " + bl + " vs " + el}`);
    }
    E.redo(); E.redo();
    const d = lg.drain();
    const F = restore(snap, d.entries, E.lm.serialize(), 411, 750);
    log(`reload through the op log: natives ${nat(F) === nat(E) ? "EXACT" : "DIFFER"}, lattice ${lat(F) === lat(E) ? "EXACT" : "DIFFER"}; ${F.lm.frames.size} frames`);
    E.undo(); F.undo();
    log(`undo after the reload: natives ${nat(F) === nat(E) ? "EXACT" : "DIFFER"}, lattice ${lat(F) === lat(E) ? "EXACT" : "DIFFER"}`);
    E.redo(); F.redo();
    log(`redo after the reload: natives ${nat(F) === nat(E) ? "EXACT" : "DIFFER"}, lattice ${lat(F) === lat(E) ? "EXACT" : "DIFFER"}`);
    log(`GC stats ${JSON.stringify(E._gcStats)}`);
});

const OPUS = "C:/Users/Surface/Documents/Claude projects/Magnum Opus.boundless.json";
(fs.existsSync(OPUS) ? test : test.skip)("the Magnum Opus export: frames at load, and after the sweep", () => {
    const E = mkEngine(1504, 868);
    const raw = JSON.parse(fs.readFileSync(OPUS, "utf8"));
    const [, msLoad] = timed(() => E.loadDrawing(raw));
    log(`Magnum Opus: loaded in ${msLoad} ms: ${E.lm.frames.size} frames, ${empties(E)} empty, ${Object.keys(E.doc.nativesByLevel).length} lists`);
    const [n, ms] = timed(() => E.sweepFrames());
    log(`the sweep forgot ${n} in ${ms} ms -> ${E.lm.frames.size} frames, ${empties(E)} empty (the camera's chain and trail)`);
});
