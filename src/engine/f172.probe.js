// Local report replay; run with --testMatch "**/f172.probe.js" (the saved manual report is required).
import path from "path";
import { useEngines, mkEngine, inkAt } from "./__testkit__/harness";
import { readReportFile, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { insideShape } from "./geometry/arcShape";

useEngines();
jest.setTimeout(120000);

test("F172 report keeps ceded pieces while zooming out", () => {
    const rep = readReportFile(path.join(REPORT_DIR, "Manual Report", "kobin-report-2026-10-29T22-03-34-565Z-c9ola1.json.gz"));
    const E = mkEngine(1806, 1014, { scenes: false });
    loadReport(E, rep);
    const ids = new Set(E.stage.items().map((it) => it.id));
    for (const id of [274, 275, 306, 307, 338, 339, 370, 371]) expect(ids.has(id)).toBe(true);
    const native = E.doc.getById(274).obj;
    const stored = E.stage.placeNative(native, E.cam.frame).toStored(E.cam.screenToFrame(800, 600));
    expect(insideShape(native.loops, stored)).toBe(true);
    const original = E.doc.serializeNatives();
    for (let k = 0; k <= 24; k++) {
        if (k) E.zoomAt(903, 507, 250);
        E._render();
        const p = E.stage.placeNative(native, E.cam.frame).fromStored(stored);
        const sx = p[0] * E.cam.inScale + E.cam.inPanX, sy = p[1] * E.cam.inScale + E.cam.inPanY;
        expect(inkAt(E, sx, sy)).toBe(true);
    }
    expect(E.doc.serializeNatives()).toEqual(original);
});
