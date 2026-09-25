/**
 * restore.cost.probe.js — what the store-to-engine restore (useKobinEngine `restoreFrom`) costs on
 * the Magnum Opus, phase by phase (the STALL agent, 2026-09-23). A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=10240 npx react-scripts test --watchAll=false
 *     --testMatch "**\/restore.cost.probe.js"
 */
import KobinEngine from "./KobinEngine";
import { encodeRecords, decodeObjects, encodeEntry } from "./format2";
import { decodeDrawing } from "./persist";
import { nativeFromRecord } from "./Document";
import { OpLog } from "./oplog";
import { docFromStore } from "../storage/foldStore";

const fs = require("fs");
const FILE = "C:/Users/Surface/Documents/Claude projects/Magnum Opus.boundless.json";
const W = 1504, H = 812;

jest.setTimeout(30 * 60 * 1000);
const now = () => performance.now();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };

describe("the restore on the Magnum Opus", () => {
    const big = fs.existsSync(FILE) ? test : test.skip;
    big("phases", () => {
        const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
        const { natives, ...envelope } = raw;
        const frames = {};
        for (const fid of Object.keys(natives)) frames[fid] = encodeRecords(natives[fid]);
        for (const raster of [false, true]) {
            const host = document.createElement("div");
            document.body.appendChild(host);
            const E = new KobinEngine(host, { width: W, height: H, raster });
            const t = {};
            let t0 = now();
            const recs = {};
            let worstFrame = 0;
            for (const fid of Object.keys(frames)) {
                const a = now();
                recs[fid] = decodeObjects(frames[fid].objects, frames[fid].geo);
                worstFrame = Math.max(worstFrame, now() - a);
            }
            t.decode = now() - t0; t.decodeWorstFrame = worstFrame;
            t0 = now(); const d = decodeDrawing({ ...envelope, natives: recs }); t.validate = now() - t0;
            t0 = now(); let n = 0; for (const fid of Object.keys(d.natives)) n += d.natives[fid].map(nativeFromRecord).length; t.nativeFromRecord = now() - t0;
            const r0 = E._render.bind(E); let renders = []; E._render = (...a) => { const s = now(); try { return r0(...a); } finally { renders.push(now() - s); } };
            t0 = now(); E.loadDrawing({ ...envelope, natives: recs }); t.loadDrawing = now() - t0;
            t.loadDrawingRender = renders.slice();
            renders = [];
            t0 = now(); E._render(); t.secondRender = now() - t0;
            log(`raster ${raster}: natives ${n}; ` + JSON.stringify(t, (k, v) => (typeof v === "number" ? +v.toFixed(0) : v)));
            E.destroy(); host.remove();
        }
    });
    // The fold (storage/foldStore.docFromStore: a download, a backup, a cloud load) with a one-entry
    // tail, as built and with the render its detached engine did until F87.
    big("the fold", () => {
        const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
        const { natives, ...envelope } = raw;
        const fids = Object.keys(natives);
        const frames = {}, frameSeq = {};
        for (const fid of fids) { frames[fid] = { ...encodeRecords(natives[fid]), seq: 1 }; frameSeq[fid] = 1; }
        const obj = { type: "stroke", origin: "native", id: 99000000, pts: [[0, 0], [5, 5]], lwFrame: 2, color: "#000", opacity: 1 };
        const e = encodeEntry({ k: "add", level: fids[0], index: 0, obj });
        const entries = [{ seq: 2, t: 2, op: e.op, geo: e.geo, touches: [fids[0]] }];
        const res = { header: { ...envelope, store: "kobin-2", frameIds: fids, frameSeq, seq: 2 }, frames, entries };
        let t0 = now(); const doc = docFromStore(res); const fold = now() - t0;
        const recs = {}; for (const fid of fids) recs[fid] = decodeObjects(frames[fid].objects, frames[fid].geo);
        t0 = now();
        const E = new KobinEngine(document.createElement("div"), { width: 1024, height: 768, scenes: false });
        E.loadDrawing({ ...envelope, natives: recs });
        new OpLog(E).replay(entries, { ...frameSeq });
        E.serializeDrawing(); E.destroy();
        const old = now() - t0;
        const n = Object.values(doc.natives).reduce((a, l) => a + l.length, 0);
        log(`fold: ${n} natives; as built ${fold.toFixed(0)} ms, with the render ${old.toFixed(0)} ms`);
    });
});
