/**
 * review1006.perf.drop.probe.js — Kobin's 2026-10-06 session (R3, R4): what the select tool's DROP spends in
 * `eng.list` (the Stage's sync in `KobinEngine._render`). The whole drawing at the report's camera, the report's
 * selection, a drag through the engine, and timers around every candidate phase of the drop. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.perf.drop.probe.js"
 * PERF_CASE=<name> runs one case (see CASES).
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { perfNow } from "./now";

// The geometry the bakes call, timed (the probe's own copy of the module; the source is untouched).
const GEO = { classifyUp: { ms: 0, n: 0 }, deriveStep: { ms: 0, n: 0, objs: 0 }, on: false };
jest.mock("./geometry/derive", () => {
    const actual = jest.requireActual("./geometry/derive");
    const timed = (name, fn, count) => (...a) => {
        // eslint-disable-next-line no-undef
        const G = global.__GEO;
        if (!G || !G.on) return fn(...a);
        const t0 = global.performance.now();
        try { return fn(...a); } finally { G[name].ms += global.performance.now() - t0; G[name].n++; if (count) G[name].objs += count(a); }
    };
    return { ...actual, classifyUp: timed("classifyUp", actual.classifyUp), deriveStep: timed("deriveStep", actual.deriveStep, (a) => a[0].length) };
});
global.__GEO = GEO;

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "perf");

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}

/** Inclusive timers around methods, re-entrancy counted once (a bake's recursion is one span). */
class Timers {
    constructor() { this.t = new Map(); this.on = false; this.undo = []; this.trace = []; }
    wrap(obj, name, label = name, note = null) {
        const orig = obj[name];
        if (typeof orig !== "function") return;
        const self = this;
        let depth = 0;
        obj[name] = function (...args) {
            if (!self.on) return orig.apply(this, args);
            depth++;
            const t0 = perfNow();
            let res;
            try { res = orig.apply(this, args); return res; } finally {
                depth--;
                const ms = perfNow() - t0;
                let e = self.t.get(label);
                if (!e) self.t.set(label, (e = { ms: 0, n: 0, nested: 0, max: 0 }));
                if (depth === 0) { e.ms += ms; e.max = Math.max(e.max, ms); } else e.nested++;
                e.n++;
                if (note && (depth === 0 || note.all)) self.trace.push(`${label}${depth ? " (nested)" : ""} ${ms.toFixed(1)} ms ${note(args, res)}`);
            }
        };
        this.undo.push(() => { obj[name] = orig; });
    }
    reset() { this.t.clear(); this.trace = []; }
    dump() {
        return [...this.t.entries()].sort((a, b) => b[1].ms - a[1].ms)
            .map(([k, e]) => `${k.padEnd(28)} ${e.ms.toFixed(1).padStart(8)} ms  calls ${e.n}${e.nested ? ` (nested ${e.nested})` : ""}  max ${e.max.toFixed(1)}`).join("\n");
    }
}

function instrument(E, T) {
    const st = E.stage, so = E.store, doc = E.doc;
    T.wrap(E, "_render", "E._render");
    T.wrap(E, "_dropMove", "E._dropMove");
    T.wrap(E, "_releaseMove", "E._releaseMove");
    T.wrap(E, "_prepareView", "E._prepareView");
    T.wrap(E, "_camToLattice", "E._camToLattice");
    T.wrap(E, "_repairSelection", "E._repairSelection");
    T.wrap(E, "_selectionAnts", "E._selectionAnts");
    T.wrap(E.renderer, "render", "R.render");
    T.wrap(E.renderer, "endMove", "R.endMove");
    T.wrap(E.renderer, "update", "R.update");
    T.wrap(st, "sync", "stage.sync");
    T.wrap(st, "_rebuild", "stage._rebuild");
    T.wrap(st, "_setWindow", "stage._setWindow");
    T.wrap(st, "_settle", "stage._settle");
    T.wrap(st, "_rerouteDiff", "stage._rerouteDiff");
    T.wrap(st, "_reconcile", "stage._reconcile");
    T.wrap(st, "_watchGroup", "stage._watchGroup");
    T.wrap(st, "_refreshKey", "stage._refreshKey");
    T.wrap(st, "_readMissing", "stage._readMissing");
    T.wrap(st, "_install", "stage._install");
    T.wrap(st, "_commit", "stage._commit");
    T.wrap(st, "_dirt", "stage._dirt");
    T.wrap(st, "release", "stage.release");
    T.wrap(so, "readTiles", "store.readTiles", (a) => `${a[0].length} cells budget ${a[1]}`);
    const parentOf = (F) => { const f = E.lm.frame(F); return f ? f.parent : null; };
    const bakeNote = (a, res) => {
        const P = parentOf(a[0]);
        return `${a[0]} ${a[1]},${a[2]} -> ${res ? res.length : "?"} pieces; parent ${P} natives ${P != null ? doc.cellList(P).length : "-"}`;
    };
    bakeNote.all = true;
    T.wrap(so, "_bakeUp", "store._bakeUp", bakeNote);
    T.wrap(so, "_bakeDown", "store._bakeDown", (a, res) => `${a[0]} ${a[1]},${a[2]} -> ${res ? res.length : "?"} pieces`);
    T.wrap(so, "_upPiecesOver", "store._upPiecesOver");
    T.wrap(so, "_ringNatives", "store._ringNatives", (a, res) => `${a[0]} -> ${res ? res.length : "?"}`);
    T.wrap(so, "_downSources", "store._downSources");
    T.wrap(so, "_rerouteGroups", "store._rerouteGroups");
    T.wrap(so, "prepare", "store.prepare");
    T.wrap(so, "framesLeft", "store.framesLeft");
    T.wrap(so, "_onDoc", "store._onDoc");
    T.wrap(so, "forgetFrame", "store.forgetFrame");
    T.wrap(doc, "rehomeManyById", "doc.rehomeManyById");
    T.wrap(doc, "setOffsetsById", "doc.setOffsetsById");
    T.wrap(E.lm, "objShift", "lm.objShift");
}

function cacheState(E) {
    const so = E.store;
    let pinned = 0, warm = 0, pieces = 0;
    for (const [key, t] of so.cache) { pieces += t.objs.length; if (so._pins.has(key)) pinned++; if (so._warm.has(key)) warm++; }
    return { tiles: so.cache.size, pinned, warm, pieces };
}

function stageState(E) {
    const st = E.stage;
    const F0s = new Set([...st._groups.values()].map((g) => g.F0));
    return { items: st._list.size, keys: st._keys.size, groups: st._groups.size, groupSources: F0s.size, gOf: st._gOf.size, frame: st.frame };
}

/** One select-tool drag through the engine (the press's hit test skipped): `steps` moves of (dx, dy) px in all, then the drop. */
function dragAndDrop(E, T, { dx, dy, steps = 10 }) {
    const sx = E.width / 2, sy = E.height / 2;
    E._dragSel = { start: [sx, sy], moved: false };
    E._beginHold();
    const tDrag = perfNow();
    for (let k = 1; k <= steps; k++) E._dragSelection(sx + (dx * k) / steps, sy + (dy * k) / steps);
    const dragMs = perfNow() - tDrag;
    const before = { cache: cacheState(E), stage: stageState(E), frames: E.lm.frames.size, forgotten: E._gcStats.forgotten };
    T.reset(); T.on = true;
    GEO.classifyUp.ms = GEO.classifyUp.n = 0; GEO.deriveStep.ms = GEO.deriveStep.n = GEO.deriveStep.objs = 0; GEO.on = true;
    const t0 = perfNow();
    E._pointerUp();
    const dropMs = perfNow() - t0;
    T.on = false; GEO.on = false;
    const after = { cache: cacheState(E), stage: stageState(E), frames: E.lm.frames.size, forgotten: E._gcStats.forgotten };
    const geo = `classifyUp ${GEO.classifyUp.ms.toFixed(1)} ms / ${GEO.classifyUp.n} calls; deriveStep ${GEO.deriveStep.ms.toFixed(1)} ms / ${GEO.deriveStep.n} calls over ${GEO.deriveStep.objs} edge objects`;
    return { dragMs, dropMs, before, after, timers: T.dump(), geo, trace: T.trace.filter((s) => /_bake|_ring/.test(s)).slice(0, 120) };
}

const R3 = "report-2026-10-07T03-19-33-862Z.json", R4 = "report-2026-10-07T03-24-11-129Z.json";
const CASES = {
    // R3's last drop: camera depth 1 at inScale 1.351 (the report's camera is the drop's), the family of 3287 (15 members).
    r3: { file: R3, d: [60, 40] },
    // the same with frame GC forgetting nothing (the lever "F139's keep rule", its upper bound)
    r3keep: { file: R3, d: [60, 40], keep: true },
    // R4's last drop: camera depth 3 (report camera; the drop was at inScale 2.70), the family of 3326 (12 members).
    r4: { file: R4, d: [60, 40], inScale: 2.7029 },
    // R3's drawing and selection seen from depth 0 (Kobin's d0 drops at 22:18 were not in perfLong)
    r3d0: { file: R3, d: [60, 40], up: true },
    // the shape cull as meant (lwFrame 0 on every shape; every other reader takes `lwFrame || 0`), frame GC as built
    r3cull: { file: R3, d: [60, 40], cull: true },
    r4cull: { file: R4, d: [60, 40], inScale: 2.7029, cull: true },
    r4keep: { file: R4, d: [60, 40], inScale: 2.7029, keep: true },
};

for (const [name, C] of Object.entries(CASES)) {
    const only = process.env.PERF_CASE;
    (only && !only.split(",").includes(name) ? test.skip : test)(`drop cost: ${name}`, async () => {
        resetRasterWorkerClient(); setRasterWorkerCount(4);
        setRasterTransport(() => new Promise(() => {}));   // jobs post and never answer: the main thread alone is timed
        const f = path.join(REPORT_DIR, C.file);
        const rep = readReportFile(f);
        let t0 = perfNow();
        const E = mk(1806, 1070);
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        log(`[${name}] loaded in ${(perfNow() - t0).toFixed(0)} ms; frame ${E.cam.frame} depth ${E.cam.activeLevel} inScale ${E.cam.inScale}; lattice ${E.lm.frames.size}`);
        if (C.inScale) {
            const cx = E.width / 2, cy = E.height / 2;
            const px = (cx - E.cam.inPanX) / E.cam.inScale, py = (cy - E.cam.inPanY) / E.cam.inScale;
            E.cam.inScale = C.inScale; E.cam.inPanX = cx - px * C.inScale; E.cam.inPanY = cy - py * C.inScale;
        }
        if (C.up) { let g = 0; while (E.activeLevel > 0 && g++ < 400) E.zoomAt(E.width / 2, E.height / 2, 1000); log(`[${name}] zoomed out to depth ${E.activeLevel} inScale ${E.cam.inScale}`); }
        if (C.keep) E.lm.forget = () => false;
        if (C.cull) for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.type === "shape" && o.lwFrame === undefined) o.lwFrame = 0;
        E.setTool("select");
        t0 = perfNow(); E._render(); log(`[${name}] first render ${(perfNow() - t0).toFixed(0)} ms, list ${E._lastList.length}`);
        E.sweepFrames();   // as the app's saver does once the store is in (F94)
        const sel = rep.moves.selection;
        E._setSelection(sel.ids, sel.frames, true);
        t0 = perfNow(); E._render(); log(`[${name}] render with the selection ${(perfNow() - t0).toFixed(0)} ms, list ${E._lastList.length}; members ${E._selectionMembers().length}; lattice ${E.lm.frames.size}`);
        for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 30));
        const T = new Timers();
        instrument(E, T);
        const out = [];
        for (let rep_ = 0; rep_ < 4; rep_++) {
            const sign = rep_ % 2 ? -1 : 1;
            const r = dragAndDrop(E, T, { dx: sign * C.d[0], dy: sign * C.d[1] });
            out.push(r);
            log(`[${name}] drop ${rep_ + 1}: drag ${r.dragMs.toFixed(0)} ms, DROP ${r.dropMs.toFixed(0)} ms\n  before ${JSON.stringify(r.before)}\n  after  ${JSON.stringify(r.after)}\n  ${r.geo}\n${r.timers}\n  bakes:\n    ${r.trace.join("\n    ")}`);
            for (let k = 0; k < 20; k++) await new Promise((res) => setTimeout(res, 30));
        }
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `drop-${name}.json`), JSON.stringify(out, null, 1));
        E.destroy();
        setRasterTransport(null); setRasterWorkerCount(null);
    });
}
