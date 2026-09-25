/**
 * reportReplay.js — a dev report into a jsdom engine (OPEN-FLAGS F58). NOT collected by jest.
 *
 *   const rep = readReportFile(latestReportFile());
 *   const E = engineFromReport(rep, { parts: drawingPartsOf(file) });   // parts: the whole drawing, when sent
 *
 * A v2 report loads its extract (or its whole drawing) through `report.loadReport`; a v1 report
 * its `snapshot`. The journal replays on top as the recipe in memory "replay-phone-report-jsdom"
 * says: `rep.history.journal` (v1: `rep.journal`), screen points at the recorded camera.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { mkEngine } from "./harness";
import { loadReport } from "../report";

export const REPORT_DIR = path.join(__dirname, "..", "..", "..", ".kobin-reports");
const REPORT_RE = /^report-[0-9TZ-]+\.json$/;

export function latestReportFile(dir = REPORT_DIR) {
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => REPORT_RE.test(f)).sort() : [];
    return names.length ? path.join(dir, names[names.length - 1]) : null;
}
/** A report file (gzip or not) as the object. */
export function readReportFile(file) {
    let buf = fs.readFileSync(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    return JSON.parse(buf.toString("utf8"));
}
/** The whole-drawing parts beside a report, gunzipped, in order; null when it has none. */
export function drawingPartsOf(file) {
    const dir = file.replace(/\.json(\.gz)?$/, ".drawing");
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).filter((f) => /^part-\d{4}\.kb2(\.gz)?$/.test(f)).sort().map((f) => {
        let b = fs.readFileSync(path.join(dir, f));
        if (f.endsWith(".gz")) b = zlib.gunzipSync(b);
        return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    });
}
/** A jsdom engine at the report's screen size holding its drawing at its camera. */
export function engineFromReport(rep, { parts = null, mk = mkEngine } = {}) {
    const scr = (rep.extract && rep.extract.screen) || rep.screen || { w: 800, h: 600 };
    const E = mk(scr.w, scr.h);
    if (rep.extract) loadReport(E, rep, { drawing: parts });
    else if (rep.snapshot) E.loadSnapshot(rep.snapshot);
    else throw new Error("this report carries no drawing");
    return E;
}
