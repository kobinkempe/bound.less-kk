/**
 * review1012.audit.q1b.probe.js — PERF-DEEP agent B, Q1's soundness check: is a moved native's footprint (its stored
 * boxes mapped through its picture table, `Stage._mapState`) where its pixels are drawn (the Stage's items, `_itemBox`)?
 * R4's whole drawing at the drop camera, frame GC off and the shape cull on (F139/F151/F142 taken as fixed), the
 * selection dragged and dropped; then per member: the union of its items' boxes against its mapped native box and its
 * mapped piece boxes, in device px. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1012.audit.q1b.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { pieceBBox } from "./geometry/arcPerimeter";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(20 * 60 * 1000);
const R4 = "report-2026-10-07T03-24-11-129Z.json";
const uni = (a, b) => (a ? { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) } : { ...b });

test("Q1b footprints against drawn items", async () => {
    resetRasterWorkerClient(); setRasterWorkerCount(4);
    setRasterTransport(() => new Promise(() => {}));
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true, writable: true });
    const f = path.join(REPORT_DIR, R4);
    const rep = readReportFile(f);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: rep.extract.screen.w, height: rep.extract.screen.h, raster: true });
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E.lm.forget = () => false;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
    const cx = E.width / 2, cy = E.height / 2, s = 2.7029;
    const px = (cx - E.cam.inPanX) / E.cam.inScale, py = (cy - E.cam.inPanY) / E.cam.inScale;
    E.cam.inScale = s; E.cam.inPanX = cx - px * s; E.cam.inPanY = cy - py * s;
    E.setTool("select");
    E._render();
    E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
    E._render();
    const members = E._selectionMembers().map((m) => m.obj.id);
    const st = E.stage, Z = E.cam.inScale * 1.25, F = String(E.cam.frame);
    const report = (when) => {
        const out = [];
        for (const id of members) {
            const rec = E.doc.getById(id);
            const items = st.itemsOf(id);
            let drawn = null, pieceU = null;
            for (const it of items) drawn = uni(drawn, st._itemBox(it));
            const table = st.model.table(rec.obj, rec.level);
            let nb = 0;
            for (const L of rec.obj.loops) for (const p of L) {
                const b = pieceBBox(p);
                const x = st._mapState({ home: String(rec.level), table, rect: { left: b[0], top: b[1], right: b[2], bottom: b[3] } }, F);
                if (x) { pieceU = uni(pieceU, x); nb++; }
            }
            const nat = st._mapState(st._stateOf(rec.obj, rec.level), F);
            const pl = st.placeNative(rec.obj, F).box();
            const d = (a, b) => (a && b ? [a.left - b.left, a.top - b.top, a.right - b.right, a.bottom - b.bottom].map((v) => +(v * Z).toFixed(2)) : null);
            out.push({ id, items: items.length, pieces: nb, natVsPlace: d(nat, pl), pieceUnionVsNat: d(pieceU, nat),
                drawnVsPiece: d(drawn, pieceU), drawnPx: drawn ? [Math.round((drawn.right - drawn.left) * Z), Math.round((drawn.bottom - drawn.top) * Z)] : null,
                itemOffs: [...new Set(items.map((it) => (it.off[0] * Z).toFixed(2) + "," + (it.off[1] * Z).toFixed(2)))].slice(0, 4),
                itemKeys: [...new Set(items.map((it) => it.key.split("|").slice(1).join("|") + "@" + it.key.split("|")[0].slice(-14)))].slice(0, 4) });
        }
        log(`[${when}] ` + JSON.stringify(out, null, 0));
    };
    report("before");
    const sx = E.width / 2, sy = E.height / 2;
    E._dragSel = { start: [sx, sy], moved: false };
    E._beginHold();
    for (let k = 1; k <= 10; k++) E._dragSelection(sx + (60 * k) / 10, sy + (40 * k) / 10);
    E._pointerUp();
    report("after");
    E.destroy(); host.remove();
    setRasterTransport(null); setRasterWorkerCount(null);
});
