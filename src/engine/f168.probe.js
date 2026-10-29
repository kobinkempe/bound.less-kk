/**
 * f168.probe.js — Kobin's "a move being refused" (OPEN-FLAGS F168) on his phone drawing: report 1's whole drawing (report
 * 2's state: no op between them), report 2's selection, report 3's camera (inside the selected frame "-3") and the drag of
 * 20:24:37 (24.896, 9.254 units). Prints the op, where frame "-3"'s natives went, family 277's join (the kid 299 homed in
 * "-3", the parent piece 305 selected by id) and the selection, with the shipped drop and with the drop before F168's fix
 * (every selected root through `moveSubtreeTargets`). A probe, not a suite: it reads .kobin-reports. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/f168.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(10 * 60 * 1000);

const SEL = [305, 265, 266, 268, 269, 271, 272, 300, 306, 308, 309];
const R1 = "report-2026-10-21T20-24-08-055Z.json", R3 = "report-2026-10-21T20-24-39-612Z.json";

// The drop's frames before F168's fix: every selected root's subtree through moveSubtreeTargets, anchored at the camera.
function preFixFramesStart(d, camDepth) {
    d.frameStart = new Map(); d.natives = [];
    const all = this.selection.frames;
    for (const f of all) {
        if (this._underFrames(f, all.filter((x) => x !== f))) continue;
        for (const [id, e] of this.lm.subtreeStart(f, camDepth)) {
            if (id !== f && !this.lm.childrenOf(id).length && this.doc.count(id) === 0) continue;
            d.frameStart.set(id, e);
            const fr = this.lm.frame(id);
            d.frames.set(id, { id, depth: e.depth, from: { parent: e.parent, i: e.i, j: e.j }, to: null,
                shiftBefore: fr && fr.shift ? [fr.shift[0], fr.shift[1]] : null, shiftAfter: null });
        }
    }
}

function run(label, preFix) {
    const f1 = path.join(REPORT_DIR, R1), rep3 = readReportFile(path.join(REPORT_DIR, R3));
    Object.defineProperty(window, "devicePixelRatio", { value: 2.625, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 411, height: 750, raster: true, scenes: false });
    loadReport(E, readReportFile(f1), { drawing: drawingPartsOf(f1) });
    if (preFix) E._dragFramesStart = preFixFramesStart;
    E.cam.set(rep3.extract.camera);
    E.setTool("select");
    E._setSelection(SEL, ["-3"]);
    E._render();
    const at = (id) => E.stage.placeNative(E.doc.getById(id).obj, E.cam.frame).fromStored([0, 0]);
    const join = () => { const p = at(305), k = at(299); return [p[0] - k[0], p[1] - k[1]]; };
    const ids3 = E.doc.list("-3").map((o) => o.id);
    const before = new Map(ids3.map((id) => [id, at(id)])), j0 = join(), p0 = at(305);
    // A press on 228, a native of "-3" on screen (selected through the frame), and the drag.
    const b = E.stage.placeNative(E.doc.getById(228).obj, E.cam.frame).box();
    const s = E.cam.levelPointToScreen(E.cam.frame, (b.left + b.right) / 2, (b.top + b.bottom) / 2);
    const dx = 24.896484375 * E.cam.inScale, dy = 9.25390625 * E.cam.inScale, u0 = E.doc._undo.length;
    E.pointerDown(s[0], s[1]);
    for (let k = 1; k <= 8; k++) E.pointerMove(s[0] + (dx * k) / 8, s[1] + (dy * k) / 8);
    const held = at(228), rest = E.stage.atRest(() => at(228));
    E.pointerUp();
    const op = E.doc._undo.length > u0 ? E.doc._undo[E.doc._undo.length - 1] : null;
    const moved = ids3.filter((id) => { const a = before.get(id), q = at(id); return Math.abs(q[0] - a[0] - 24.896484375) < 1e-6 && Math.abs(q[1] - a[1] - 9.25390625) < 1e-6; });
    const p1 = at(305), j1 = join();
    const jr = E.journal[E.journal.length - 1];
    log(`${label}: mid-drag 228 drawn ${[held[0] - rest[0], held[1] - rest[1]].map((v) => v.toFixed(3))} from rest; op ${op ? op.op : "none"}, frames ${JSON.stringify(op && op.frames ? op.frames.map((e) => e.id) : [])}, moves ${op && op.moves ? op.moves.length : 0}`
        + `\n  "-3": ${moved.length} of ${ids3.length} natives moved by the drag; 305 moved ${[p1[0] - p0[0], p1[1] - p0[1]].map((v) => v.toFixed(6))}`
        + `\n  family 277, 305 less 299 where drawn: ${j0.map((v) => v.toFixed(6))} -> ${j1.map((v) => v.toFixed(6))}`
        + `\n  camera ${E.cam.frame}; selection ${JSON.stringify([E.selection.ids.length, E.selection.frames])}; journal skipped ${JSON.stringify(jr.skipped || null)}`);
    E.destroy();
}

test("F168: the drag with the camera in the selected frame, shipped and before the fix", () => {
    run("before the fix", true);
    run("shipped", false);
});
