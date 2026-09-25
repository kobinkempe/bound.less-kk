/**
 * OPEN-FLAGS F99 on Kobin's report 04-06-17: the 42 ceded kids under a `#2` twin's child load into a frame
 * the lattice has (`LevelMap.ensureId`). Slow: the report's whole drawing (43k natives). Skipped without it.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";

jest.setTimeout(180000);

describe("EI — ensureId on a recorded drawing", () => {
    const FILE = path.join(REPORT_DIR, "report-2026-09-24T04-06-17-306Z.json");
    (fs.existsSync(FILE) ? test : test.skip)("EI-4 Kobin's report 04-06-17: every native's home is a frame the lattice has (the 42 kids included)", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const E = new KobinEngine(host, { width: 1504, height: 868 });
        try {
            loadReport(E, readReportFile(FILE), { drawing: drawingPartsOf(FILE) });
            const orphans = [];
            for (const k of Object.keys(E.doc.nativesByLevel)) if (!E.lm.frame(k) && E.doc.nativesByLevel[k].length) orphans.push(k);
            expect(orphans).toEqual([]);
            expect(E.doc.getById(47214)).toBeTruthy();
            expect(E.lm.frame(E.doc.getById(47214).level)).toBeTruthy();
        } finally { E.destroy(); host.remove(); }
    });
});
