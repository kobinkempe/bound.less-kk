/* Scratch probe (R-MODEL-C34; deleted before hand-back): who inserts/removes native ID during a store reload's replay. */
const { runPairFuzz, framesToCompare, comparePictures, placeOf } = process.env.DBG_OLD ? require("./__testkit__/zz_modelFuzzOld") : require("./__testkit__/modelFuzz");
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
import LevelMap from "./LevelMap";
let watch = false;
{
    const rs = LevelMap.prototype.removeSubtree, rf = LevelMap.prototype.restoreFrame, sf = Document.prototype.setFrameShift;
    LevelMap.prototype.removeSubtree = function (id) { const out = rs.call(this, id); if (watch) lines.push("LM removeSubtree " + id + " -> " + JSON.stringify(out)); return out; };
    LevelMap.prototype.restoreFrame = function (rec, e) { const f = rf.call(this, rec, e); if (watch) lines.push("LM restoreFrame " + JSON.stringify(rec) + " -> " + (f && f.id) + " sh " + JSON.stringify(f && f.shift) + " ~" + (f && f.shadowOf)); return f; };
    Document.prototype.setFrameShift = function (id, sh) { if (watch) lines.push("DOC setFrameShift " + id + " " + JSON.stringify(sh) + " " + new Error().stack.split("\n").slice(2, 5).map((x) => x.trim().slice(3, 60)).join(" < ")); return sf.call(this, id, sh); };
}
import KE from "./KobinEngine";
import OKE from "./__oracles__/model-v1/KobinEngine";
for (const [K, tag] of [[KE, "LIVE"], [OKE, "ORAC"]]) {
    const u = K.prototype.undo;
    K.prototype.undo = function () { const top = this.doc._undo[this.doc._undo.length - 1]; const r = u.call(this); if (watch) lines.push(tag + " undo " + (top && top.op) + " ids " + JSON.stringify(top && (top.moves || [top]).map((m) => m.id)) + " -> sel " + JSON.stringify(this.selection && { ids: this.selection.ids, frames: this.selection.frames })); return r; };
}
for (const [K, tag] of [[KE, "LIVE"], [OKE, "ORAC"]]) {
    const ss = K.prototype._setSelection;
    K.prototype._setSelection = function (ids, frames, ...rest) { if (watch) lines.push(tag + " _setSelection " + JSON.stringify(ids) + " " + JSON.stringify(frames) + " < " + new Error().stack.split("\n").slice(2, 6).map((x) => x.trim().slice(3, 50)).join(" < ")); return ss.call(this, ids, frames, ...rest); };
}
import TileStore from "./TileStore";
{
    const T = TileStore.prototype;
    const rm = T._removeObject, ad = T._appendDown, bd = T._bakeDown, od = T._onDoc, st = T._setTile, dt = T._dropTile;
    T._removeObject = function (id) { const had = this._idTiles.get(id) ? [...this._idTiles.get(id)] : null; const r = rm.call(this, id); if (watch && id === ID) lines.push("TS _removeObject " + id + " had " + JSON.stringify(had) + " now " + JSON.stringify(this._idTiles.get(id) ? [...this._idTiles.get(id)] : null)); return r; };
    T._appendDown = function (tile, o, H) { if (watch && o.id === ID) lines.push("TS _appendDown " + tile.level + "|" + tile.i + "," + tile.j + " H " + H + " live doc " + !!this.doc.getById(ID)); return ad.call(this, tile, o, H); };
    T._bakeDown = function (F, i, j) { const r = bd.call(this, F, i, j); const t = this.cache.get(F + "|down|" + i + "," + j); if (watch && t && t.objs.some((q) => q.id === ID)) lines.push("TS _bakeDown " + F + " " + i + "," + j + " has " + ID + " doc " + !!this.doc.getById(ID)); return r; };
    T._onDoc = function (ev) { if (watch && process.env.DBG_STACK && ev.id === ID && this.lm.cellFrames) lines.push("TS ev " + ev.kind + " L " + ev.level + " < " + new Error().stack.split("\n").slice(3, 9).map((x) => x.trim().slice(3, 45)).join(" < ")); if (watch && (ev.kind === "removeFrame" || ev.kind === "addFrame" || ev.kind === "refile")) lines.push("TS frame ev " + ev.kind + " " + ev.frame + " n" + ev.count + " at " + JSON.stringify(ev.at) + " lattice has " + !!this.lm.frame(ev.frame) + " by " + ev.by); if (watch && ev.id === ID) lines.push("TS ev " + ev.kind + " L " + ev.level + (ev.rehome ? " rehome " + ev.rehome : "")); return od.call(this, ev); };
    const fe = T._onFrameEvent; T._onFrameEvent = function (ev) { const before = [...this.cache.keys()];
        if (watch && ev.at) { const { G: GG, R: RR, W: WW } = require("./frameLattice"); const reach = (WW * 1.5) / RR; const i = ev.at.i, j = ev.at.j; const rc = { left: i * GG - reach, top: j * GG - reach, right: i * GG + reach, bottom: j * GG + reach };
            const levels = [...new Set([...this.cache.values()].map((t) => String(t.level)))];
            for (const L of levels) { const r = this.lm.mapRectF(rc, ev.at.parent, L); lines.push("TS   map to " + L + " -> " + JSON.stringify(r && [r.left, r.top, r.right, r.bottom].map((v) => +v.toFixed(3))) + " tiles " + [...this.cache.values()].filter((t) => String(t.level) === L).map((t) => t.dir + t.i + "," + t.j).join(" ")); } } const r = fe.call(this, ev); if (watch) { const gone = before.filter((k) => !this.cache.has(k)); lines.push("TS   dropped " + gone.length + ": " + gone.slice(0, 6).join(" ; ")); } return r; };
    T._setTile = function (key, tile) { if (watch && tile && tile.objs && tile.objs.some((q) => q.id === ID)) lines.push("TS _setTile " + key + " with " + ID + " doc " + !!this.doc.getById(ID)); return st.call(this, key, tile); };
}
for (const [K, tag] of [[KE, "LIVE"], [OKE, "ORAC"]]) {
    const ac = K.prototype._applyCut;
    if (ac) K.prototype._applyCut = function (...a) { const before = new Set(); for (const L of this.doc.levels()) for (const o of this.doc.list(L)) before.add(o.id); const r = ac.apply(this, a);
        if (process.env.DBG_CUTS) { const after = new Set(); for (const L of this.doc.levels()) for (const o of this.doc.list(L)) after.add(o.id); const gone = [...before].filter((x) => !after.has(x)), made = [...after].filter((x) => !before.has(x)); if (gone.length || made.length) lines.push(tag + " _applyCut gone " + JSON.stringify(gone) + " made " + JSON.stringify(made)); }
        return r; };
}
for (const [K, tag] of [[KE, "LIVE"], [OKE, "ORAC"]]) {
    const pp = K.prototype._pendingPairs;
    if (pp) K.prototype._pendingPairs = function (pred, mp) {
        const r = pp.call(this, (rec) => { const v = pred(rec); if (watch && process.env.DBG_PAIRS) lines.push(tag + " pair? " + rec.obj.id + " -> " + v); return v; }, mp);
        if (watch && process.env.DBG_PAIRS) { const marks = this._eraseStrokes().map((m) => m.obj.id + ":" + JSON.stringify([...(this._lineage.get(m.obj.id) || [])])); lines.push(tag + " pendingPairs marks " + marks.join(" ") + " -> " + r.map((x) => x.Erec.obj.id + "/" + x.rec.obj.id).join(",")); }
        return r;
    };
}
for (const [K, tag] of [[KE, "LIVE"], [OKE, "ORAC"]]) {
    const pd = K.prototype.pointerDown;
    K.prototype.pointerDown = function (x, y, ...rest) {
        if (watch && process.env.DBG_PRESS) {
            const s = this.selection, m = this.doc.getById(17);
            lines.push(tag + " press " + x.toFixed(1) + "," + y.toFixed(1) + " tool " + this.tool + " sel " + JSON.stringify(s && { ids: s.ids, frames: s.frames }) + " frameUnder " + (this._frameUnderPoint ? this._frameUnderPoint(x, y) : "?")
                + " hit " + (this._hitTest ? this._hitTest(x, y) : "?") + " mark17@" + (m ? m.level + " place " + placeOf(this, m.level) + " underSel " + !!(s && s.frames.length && this._underFrames(m.level, s.frames)) : "-")
                + " frame place " + (s && s.frames[0] ? placeOf(this, s.frames[0]) : "-"));
        }
        return pd.call(this, x, y, ...rest);
    };
}
for (const [K, tag] of [[KE, "LIVE"], [OKE, "ORAC"]]) {
    const eb = K.prototype._eraseBarrier;
    if (eb) K.prototype._eraseBarrier = function (kind, pairsOf, then, follow) {
        if (watch && process.env.DBG_PRESS) lines.push(tag + " barrier " + kind + " follow " + JSON.stringify(follow) + " < " + new Error().stack.split("\n").slice(2, 6).map((x) => x.trim().slice(3, 50)).join(" < "));
        return eb.call(this, kind, pairsOf, then, follow);
    };
}
for (const [K, tag] of [[KE, "LIVE"], [OKE, "ORAC"]]) {
    const bs = K.prototype._beginSelectDrag, al = K.prototype._applyLasso;
    K.prototype._beginSelectDrag = function (P, sx, sy) { const r = bs.call(this, P, sx, sy); if (watch && process.env.DBG_PRESS) lines.push(tag + " beginSelectDrag hit " + P.hit + " ctrl " + P.ctrl + " lasso " + !!this._lasso + " dragSel " + !!this._dragSel + " pressWait " + !!this._pressWait); return r; };
    if (al) K.prototype._applyLasso = function (...a) { if (watch && process.env.DBG_PRESS) lines.push(tag + " applyLasso pts " + (this._lasso ? this._lasso.pts.length : "?") + " " + JSON.stringify(this._lasso && this._lasso.pts.slice(0, 4))); return al.apply(this, a); };
}
wrapLog(OpLog, "LIVE", decodeEntry); wrapLog(OOpLog, "ORAC", oDecodeEntry);
test("trace", () => {
    const st = {};
    runPairFuzz(SEED, STEP + 1, (O, N, step, op) => {
        watch = process.env.DBG_WATCH != null && step + 1 >= Number(process.env.DBG_WATCH);
        if (process.env.DBG_CUTS && lines.length) log("CUTS after " + step + " " + op + "\n  " + lines.filter((l) => l.includes("_applyCut")).join("\n  "));
        const hn = N.doc.getById(ID), ho = O.doc.getById(ID);
        if (process.env.DBG_FROM && step >= Number(process.env.DBG_FROM)) {
            const fl = (E) => [...E.lm.frames.values()].filter((f) => f.parent != null && (E.doc.count(f.id) || f.shift || f.shadowOf != null || f.private != null || String(f.id).split("/").length <= 3))
                .map((f) => f.id + "<" + f.parent + "@" + f.cell.i + "," + f.cell.j + (f.shift ? " sh" + JSON.stringify(f.shift) : "") + (f.shadowOf != null ? " ~" + f.shadowOf : "") + (f.private != null ? " P" + f.private : "") + " n" + E.doc.count(f.id)).join(" | ");
            log("FR " + step + " " + op + "\n  O: " + fl(O) + "\n  N: " + fl(N) + "\n  sel O " + JSON.stringify(O.selection && { ids: O.selection.ids, frames: O.selection.frames }) + " N " + JSON.stringify(N.selection && { ids: N.selection.ids, frames: N.selection.frames }) + " cam " + N.cam.frame);
        }
        if (process.env.DBG_FULL && step >= Number(process.env.DBG_FULL)) {
            const sub = (E, root) => [...E.lm.frames.values()].filter((f) => String(f.id).startsWith(root) || (f.parent && String(f.parent).startsWith(root)))
                .sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1))
                .map((f) => "    " + f.id + " <" + f.parent + " @" + f.cell.i + "," + f.cell.j + " d" + f.depth + (f.shift ? " sh" + JSON.stringify(f.shift) : "") + (f.shadowOf != null ? " ~" + f.shadowOf : "") + (f.private != null ? " P" + f.private : "") + " n" + E.doc.count(f.id) + " place " + placeOf(E, f.id)).join("\n");
            const inv = (E) => { const bad = []; for (const f of E.lm.frames.values()) { if (f.parent == null) continue; const r = E.lm.residentOf(f.id); for (const g of E.lm.cellFrames(r.id)) { if (g.parent == null) continue; if (E.lm.residentOf(g.parent) !== E.lm.residentOf(f.parent)) bad.push(f.id + " vs " + g.id); } } return bad; };
            log("FULL " + step + " " + op + "\n  N:\n" + sub(N, process.env.DBG_ROOT || "0/14,15") + "\n  O:\n" + sub(O, process.env.DBG_ROOT || "0/14,15") + "\n  N invariant breaks: " + JSON.stringify(inv(N)));
        }
        if (process.env.DBG_CAM) { const c = (E) => JSON.stringify(E.cam.state()) + " place " + placeOf(E, E.cam.frame); const a = c(O), b = c(N); log("CAM " + step + " " + op + (a === b ? " same " + a : "\n  O " + a + "\n  N " + b)); }
        if (process.env.DBG_BOX) {
            const B = process.env.DBG_BOX;
            const one = (E) => { const h = E.doc.getById(ID); if (!h || !E.lm.frame(B)) return "-"; const bx = E.stage.placeNative(h.obj, B).box(); const f = E.lm.frame(String(h.level)); return (bx ? [bx.left, bx.top].map((v) => v.toFixed(2)).join(",") : "nobox") + " home " + h.level + " @" + (f ? f.cell.i + "," + f.cell.j + " <" + f.parent + " sh" + JSON.stringify(f.shift) : "?") + " own " + JSON.stringify(E.doc.ownTable ? E.doc.ownTable(h.obj) : h.obj.below); };
            log("BOX " + step + " " + op + "\n  O " + one(O) + "\n  N " + one(N));
        }
        if (process.env.DBG_ROOTS && step >= Number(process.env.DBG_ROOTS)) {
            const rs = (E) => [...E.lm.frames.values()].filter((f) => f.depth <= 0).map((f) => f.id + "<" + f.parent + "@" + f.cell.i + "," + f.cell.j + " d" + f.depth + (f.shadowOf != null ? " ~" + f.shadowOf : "") + " n" + E.doc.count(f.id) + " kids" + (f._kids ? f._kids.size : 0) + " place " + placeOf(E, f.id)).join(" | ");
            log("ROOTS " + step + " " + op + "\n  O: " + rs(O) + "\n  N: " + rs(N) + "\n  cam O " + O.cam.frame + " N " + N.cam.frame);
        }
        if (process.env.DBG_GEOM) {
            const ids = process.env.DBG_GEOM.split(",").map(Number);
            const g = (E, id) => { const r = E.doc.getById(id); if (!r) return "-"; const n = []; for (const l of r.obj.loops || []) for (const e of l) { n.push(e.A[0], e.A[1]); } return r.level.split("/").length + ":" + n.length + ":" + n.slice(0, 4).map((v) => v.toFixed(6)).join(",") + "|h" + n.reduce((a, v) => (a * 31 + Math.round(v * 1e9)) % 1e9, 0); };
            log("GEOM " + step + " " + op + " " + ids.map((id) => id + " O " + g(O, id) + " N " + g(N, id) + (g(O, id).split("|h")[1] === g(N, id).split("|h")[1] ? " =" : " DIFF")).join(" ; "));
        }
        log("TL " + step + " " + op + " live=" + (hn ? hn.level + (N.lm.frame(String(hn.level)) ? "" : " MISSING") : "-") + " oracle=" + (ho ? ho.level : "-") + (lines.length ? "\n  " + lines.splice(0).join("\n  ") : ""));
        if (step < STEP) { for (const V of framesToCompare(O, N)) comparePictures(O, N, V, st, C34 ? 2 : 1); return true; }
        for (const V of framesToCompare(O, N)) { const d = comparePictures(O, N, V, st, C34 ? 2 : 1); if (d) { log("DIFF " + d); break; } }
        return false;
    }, { c34: C34 });
});
