/**
 * A lasso takes a ceded family whose other pieces are homed under an enclosed frame, and a drag
 * then moves every piece once (Kobin's phone report 2026-09-24T04-25-10: "the lasso select is
 * missing objects"). Replayed from the report; skipped on a checkout without it.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";

jest.setTimeout(120000);

const FILE = path.join(REPORT_DIR, "report-2026-09-24T04-25-10-645Z.json");
const have = fs.existsSync(FILE);
const t = have ? test : test.skip;

const engines = [];
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* torn down */ } } });
function mkPhone() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 411, height: 750 });
    engines.push(E);
    return E;
}
const load = () => {
    const E = mkPhone();
    loadReport(E, readReportFile(FILE), { drawing: drawingPartsOf(FILE) });
    E.flushBakes();
    return E;
};
const screenLoop = (E, inset = 2) => {
    const { width: w, height: h } = E;
    return [[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]].map(([x, y]) => E.cam.screenToFrame(x, y));
};

describe("CL — a ceded family under an enclosed frame", () => {
    t("CL-1 a lasso round the whole screen takes the ceded families 60 and 66", () => {
        const E = load();
        const { ids } = E._lassoFind(screenLoop(E));
        expect(ids).toEqual(expect.arrayContaining([60, 66]));
    });
    t("CL-2 a drag moves 60 and its pieces 62 and 63 by the same amount, each once", () => {
        const E = load();
        const { ids, frames } = E._lassoFind(screenLoop(E));
        E._setSelection(ids, frames);
        const before = new Map([60, 62, 63].map((id) => { const r = E.doc.getById(id); return [id, E._rectInActive(r.obj, r.level)]; }));
        E.setTool("select");
        const r60 = before.get(60);
        const sx = r60.left * E.cam.inScale + E.cam.inPanX + 2, sy = r60.top * E.cam.inScale + E.cam.inPanY + 2;
        E._dragSel = null;
        E._beginSelectDrag({ sx, sy, hit: 60, ctrl: false }, sx + 30, sy);
        E._dragSelection(sx + 30, sy);
        E._pointerUp();
        const shift = [60, 62, 63].map((id) => {
            const r = E.doc.getById(id);
            const a = before.get(id), b = E._rectInActive(r.obj, r.level);
            return [+(b.left - a.left).toFixed(6), +(b.top - a.top).toFixed(6)];
        });
        expect(shift[0][0]).not.toBe(0);
        expect(shift[1]).toEqual(shift[0]);
        expect(shift[2]).toEqual(shift[0]);
    });
});
