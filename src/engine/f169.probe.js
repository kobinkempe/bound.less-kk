/**
 * f169.probe.js — Kobin's "the selection shows the tile" (OPEN-FLAGS F169) on his phone drawing: report 1's whole drawing
 * (report 2's state) with report 2's selection at report 2's camera. Family 277 is the ceded kid 299 (homed in the
 * selected frame "-3") and the parent piece 305 (selected by id, homed in the camera's frame); the ants along 305's hole
 * are measured as the canvas is, then with 299 moved by the four drags of 20:23:24-33 that moved 305 and refused "-3"
 * (F168): 89.673828125, 13.5166015625 units of depth -3. A probe, not a suite: it reads .kobin-reports. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/f169.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { onRectEdge } from "./geometry/antRuns";
import { rectTol } from "./rectMath";
import { addOffset } from "./geometry/offsets";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(10 * 60 * 1000);

const SEL = [305, 265, 266, 268, 269, 271, 272, 300, 306, 308, 309];

test("F169: the ants along 305's hole at report 2's camera, torn and re-registered", () => {
    const f1 = path.join(REPORT_DIR, "report-2026-10-21T20-24-08-055Z.json");
    const rep2 = readReportFile(path.join(REPORT_DIR, "report-2026-10-21T20-24-24-825Z.json"));
    Object.defineProperty(window, "devicePixelRatio", { value: 2.625, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 411, height: 750, raster: true, scenes: false });
    loadReport(E, readReportFile(f1), { drawing: drawingPartsOf(f1) });
    E.cam.set(rep2.extract.camera);
    E.setTool("select");
    E._setSelection(SEL, ["-3"]);
    Object.defineProperty(E.renderer, "antPainter", { value: true, configurable: true });
    const F = E.cam.frame, sc = E.cam.inScale;
    const kid = E.doc.getById(299), par = E.doc.getById(305), A = kid.obj.attachRect;
    log(`family ${E.doc.editKey(par.obj)}: ${E.doc.editGroup(par.obj).map((m) => m.obj.id + "@" + m.level).join(" ")}; camera ${F} at inScale ${sc.toFixed(3)}`);
    const measure = (label) => {
        E._render(); E._selDec = null;
        const got = E._selectionAnts();
        // The hole where 305 is drawn: its long axis-aligned pieces, its only straight edges.
        const xs = [], ys = [];
        for (const it of E.stage.items()) {
            if (it.id !== 305) continue;
            const { geom, off } = E.stage.placed(it);
            for (const loop of geom.loops) for (let i = 0; i < loop.length; i++) {
                const q = loop.at(i);
                if (!q.line || Math.hypot(q.B[0] - q.A[0], q.B[1] - q.A[1]) * sc < 20) continue;
                if (q.A[0] === q.B[0]) xs.push(q.A[0] + off[0]); else if (q.A[1] === q.B[1]) ys.push(q.A[1] + off[1]);
            }
        }
        const rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, eps = rectTol(rect);
        const w = E.stage.placeNative(kid.obj, F).fromStored({ left: A.x0, top: A.y0, right: A.x1, bottom: A.y1 });
        let px = 0, n = 0;
        for (const r of got ? got.runs : []) for (const q of r.pieces) if (onRectEdge(q, rect, eps)) { px += Math.hypot(q.B[0] - q.A[0], q.B[1] - q.A[1]) * sc; n++; }
        log(`${label}: the hole ${((rect.x1 - rect.x0) * sc).toFixed(1)} px square; ants along it ${px.toFixed(1)} px in ${n} pieces; hole less the kid's window where drawn ${[rect.x0 - w.left, rect.y0 - w.top].map((v) => v.toExponential(3))} units, the seam tolerance ${eps.toExponential(3)}`);
    };
    measure("as the canvas is");
    E.doc.setOffsetsById(299, addOffset(E.doc.ownTable(kid.obj), 0, 89.673828125, 13.5166015625).below);
    measure("299 moved by the four refused drags");
    E.destroy();
});
