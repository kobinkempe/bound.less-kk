/* Scratch probe (R-MODEL-C34; deleted before hand-back): who inserts/removes native ID during a store reload's replay. */
const { runPairFuzz, framesToCompare, comparePictures } = process.env.DBG_OLD ? require("./__testkit__/zz_modelFuzzOld") : require("./__testkit__/modelFuzz");
import { OpLog } from "./oplog";
import { OpLog as OOpLog } from "./__oracles__/model-v1/oplog";
import Document from "./Document";
import ODocument from "./__oracles__/model-v1/Document";
import { decodeEntry } from "./format2";
import { decodeEntry as oDecodeEntry } from "./__oracles__/model-v1/format2";

jest.setTimeout(10 * 60 * 1000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const SEED = Number(process.env.DBG_SEED || 131), STEP = Number(process.env.DBG_STEP || 39), ID = Number(process.env.DBG_ID || 14), C34 = process.env.DBG_C34 === "1";
const lines = [];
let who = null;
const ids = (e) => JSON.stringify(e).match(new RegExp('"id":' + ID + '[,}]')) != null;
function wrap(D, tag) {
    const ins = D.prototype.insertAt, rem = D.prototype.removeById;
    D.prototype.insertAt = function (obj, level, index) { if (who && obj && obj.id === ID) lines.push(tag + " insert " + ID + " @" + level + " during " + who); return ins.call(this, obj, level, index); };
    D.prototype.removeById = function (id, o) { const r = rem.call(this, id, o); if (who && id === ID) lines.push(tag + " remove " + ID + " (" + (r ? "was @" + r.level : "absent") + ") during " + who); return r; };
}
wrap(Document, "LIVE"); wrap(ODocument, "ORAC");
function wrapLog(L, tag, dec) {
    const rp = L.prototype.replay;
    L.prototype.replay = function (entries, frameSeq, listed) {
        lines.push(tag + " replay " + entries.length + " entries; frameSeq keys " + Object.keys(frameSeq || {}).length + " max " + Math.max(0, ...Object.values(frameSeq || {})));
        const orig = this._replay;
        // tag every entry by seq
        const self = this;
        const marks = entries.map((raw) => raw.seq);
        self._replay = function (es, fs, li) {
            const out = [];
            for (const raw of es) {
                const e = dec(raw);
                if (ids(e)) lines.push(tag + "  entry seq " + raw.seq + " k=" + e.k + " touches=" + JSON.stringify(raw.touches) + " fs=" + JSON.stringify((raw.touches || []).map((t) => (fs || {})[t])));
                if (process.env.DBG_ALL || e.k === "undo" || e.k === "redo") lines.push(tag + "  entry seq " + raw.seq + " " + e.k + (e.of != null ? " of " + e.of : "") + (e.mark != null ? " mark " + e.mark : "") + (e.obj ? " obj " + e.obj.id + " @" + e.level : "") + " touches=" + JSON.stringify(raw.touches));
            }
            return orig.call(this, es, fs, li);
        };
        who = tag + " replay";
        try { return rp.call(this, entries, frameSeq, listed); } finally { who = null; delete self._replay; void marks; }
    };
}
wrapLog(OpLog, "LIVE", decodeEntry); wrapLog(OOpLog, "ORAC", oDecodeEntry);
test("trace", () => {
    const st = {};
    runPairFuzz(SEED, STEP + 1, (O, N, step, op) => {
        const hn = N.doc.getById(ID), ho = O.doc.getById(ID);
        if (process.env.DBG_FROM && step >= Number(process.env.DBG_FROM)) {
            const fl = (E) => [...E.lm.frames.values()].filter((f) => f.parent != null && (E.doc.count(f.id) || f.shift || f.shadowOf != null || f.private != null || String(f.id).split("/").length <= 3))
                .map((f) => f.id + "<" + f.parent + "@" + f.cell.i + "," + f.cell.j + (f.shift ? " sh" + JSON.stringify(f.shift) : "") + (f.shadowOf != null ? " ~" + f.shadowOf : "") + (f.private != null ? " P" + f.private : "") + " n" + E.doc.count(f.id)).join(" | ");
            log("FR " + step + " " + op + "\n  O: " + fl(O) + "\n  N: " + fl(N) + "\n  sel O " + JSON.stringify(O.selection && { ids: O.selection.ids, frames: O.selection.frames }) + " N " + JSON.stringify(N.selection && { ids: N.selection.ids, frames: N.selection.frames }) + " cam " + N.cam.frame);
        }
        log("TL " + step + " " + op + " live=" + (hn ? hn.level + (N.lm.frame(String(hn.level)) ? "" : " MISSING") : "-") + " oracle=" + (ho ? ho.level : "-") + (lines.length ? "\n  " + lines.splice(0).join("\n  ") : ""));
        if (step < STEP) { for (const V of framesToCompare(O, N)) comparePictures(O, N, V, st, C34 ? 2 : 1); return true; }
        for (const V of framesToCompare(O, N)) { const d = comparePictures(O, N, V, st, C34 ? 2 : 1); if (d) { log("DIFF " + d); break; } }
        return false;
    }, { c34: C34 });
});
