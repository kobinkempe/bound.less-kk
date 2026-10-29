/**
 * review1013.persistcheck.probe.js — which `.kobin-reports` snapshot fails persist.slow's round trip ("real report snapshots
 * load as drawings"): every report with `snapshot.natives` loaded, serialized and compared native for native. A probe.
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/review1013.persistcheck.probe.js"
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { isLegacySnapshot, convertLegacySnapshot } from "./__testkit__/legacyFixture";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(30 * 60 * 1000);
const dir = path.join(__dirname, "..", "..", ".kobin-reports");
const RETIRED = ["windows", "srcId"];   // persist.slow.test.js's
const strip = (natives) => { const out = {}; for (const l of Object.keys(natives)) { if (!natives[l].length) continue; out[l] = natives[l].map((o) => { const c = { ...o }; for (const k of RETIRED) delete c[k]; return c; }); } return out; };
const flat = (n) => { const out = []; for (const l of Object.keys(n).sort()) for (const o of n[l]) out.push(l + "|" + JSON.stringify(o)); return out; };

test("each report's round trip", () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    let bad = 0, seen = 0;
    for (const file of files) {
        const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        if (!report.snapshot || !report.snapshot.natives) continue;
        seen++;
        const host = document.createElement("div");
        document.body.appendChild(host);
        const E = new KobinEngine(host, { width: 800, height: 600 });
        try {
            const doc = isLegacySnapshot(report.snapshot) ? convertLegacySnapshot(report.snapshot) : report.snapshot;
            E.loadDrawing(doc);
            const a = E.serializeDrawing().natives, b = strip(doc.natives);
            const ja = flat(a), jb = new Set(flat(b));
            const extra = ja.filter((s) => !jb.has(s)), sa = new Set(ja), missing = [...jb].filter((s) => !sa.has(s));
            if (extra.length || missing.length) {
                bad++;
                log(`PERSISTCHECK ${file}: ${jb.size} in, ${ja.length} out, ${extra.length} only out, ${missing.length} only in; out e.g. ${extra.slice(0, 1).map((s) => s.slice(0, 400))} || in e.g. ${missing.slice(0, 1).map((s) => s.slice(0, 400))}`);
            }
        } catch (err) { bad++; log(`PERSISTCHECK ${file}: threw ${err && err.message}`); }
        E.destroy(); host.remove();
    }
    log(`PERSISTCHECK ${seen} reports with natives, ${bad} differ`);
    expect(seen).toBeGreaterThan(0);
});
