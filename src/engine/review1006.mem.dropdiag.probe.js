/**
 * review1006.mem.dropdiag.probe.js — why R4's drop re-bakes tiles when frame GC forgets nothing from the drop on
 * (`review1006.mem.keep.probe.js`: still ~4 s), when forgetting nothing from the load on made it 31–139 ms
 * (`review1006.perf.drop.probe.js` r4keep). Per drop: every tile dropped (by whom) and every tile baked (missing or
 * stale, and why), split into the drag and the drop. A probe, not a suite.
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.mem.dropdiag.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { perfNow } from "./now";

// "view": the frames the Stage's reroute groups read are not frame-GC candidates this run, and stay candidates.
jest.mock("./frameGc", () => {
    const actual = jest.requireActual("./frameGc");
    const collectFrames = (E, inRender = false) => {
        // eslint-disable-next-line no-undef
        const K = global.__DIAGKEEP;
        if (!K || !K.view || !E._gcCand || !E._gcCand.size) return actual.collectFrames(E, inRender);
        const src = new Set();
        if (E.stage && E.stage._groups) for (const g of E.stage._groups.values()) src.add(String(g.F0));
        const held = [...E._gcCand].filter((id) => src.has(String(id)));
        for (const id of held) E._gcCand.delete(id);
        const n = actual.collectFrames(E, inRender);
        for (const id of held) E._gcCand.add(id);
        return n;
    };
    // the load's sweep through the same rule (the module's own sweep calls its own collectFrames)
    const sweepFrames = (E) => { if (!E._gcCand) return 0; for (const id of E.lm.frames.keys()) E._gcCand.add(id); return collectFrames(E); };
    return { ...actual, collectFrames, sweepFrames };
});
const DIAGKEEP = { view: false };
global.__DIAGKEEP = DIAGKEEP;

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}

const callerOf = () => {
    const st = new Error().stack.split("\n").slice(3, 9).map((l) => (/at (?:\S+\.)?(\w+) /.exec(l) || [])[1]).filter(Boolean);
    return st.slice(0, 3).join("<");
};

function instrument(E, S) {
    const so = E.store;
    const drop = so._dropTile.bind(so);
    so._dropTile = (key) => {
        if (S.on && so.cache.has(key)) {
            const c = callerOf();
            const w = E.stage._keys.has(key) ? (E.stage._keys.get(key).groups.size ? "watched-by-group" : "watched-window") : "unwatched";
            const k = `${c} [${w}${so._pins.has(key) ? ",pinned" : ""}]`;
            S.dropped[k] = (S.dropped[k] || 0) + 1;
        }
        return drop(key);
    };
    const why = (dir, F, i, j) => {
        const cf = E.lm.frameFor(F);
        const key = (cf ? cf.id : F) + "|" + dir + "|" + i + "," + j;
        const hit = so.cache.get(key);
        if (!hit) return S.before.has(cf ? cf.id : String(F)) ? "missing (frame existed before the drag)" : "missing (frame new since the drag)";
        if (hit.epoch !== so._epoch) return "stale epoch";
        if (hit.seq !== so.chainSeq(cf ? cf.id : F)) return "stale chainSeq";
        return "hit";
    };
    for (const [name, dir] of [["_ensureUp", "up"], ["_ensureDown", "down"]]) {
        const orig = so[name].bind(so);
        so[name] = (F, i, j) => {
            if (!S.on) return orig(F, i, j);
            const w = why(dir, F, i, j);
            if (w !== "hit") { const k = `${dir} ${w}`; S.baked[k] = (S.baked[k] || 0) + 1; }
            return orig(F, i, j);
        };
    }
    const ev = (e) => { if (S.on) { const k = e.kind + (e.offsetsOnly ? "(offsets)" : ""); S.events[k] = (S.events[k] || 0) + 1; } };
    E.doc.subscribe(ev);
}

const R4 = "report-2026-10-07T03-24-11-129Z.json";
const CASES = {
    built: {},
    keepFromLoad: { keepAt: "load" },     // perf.drop's r4keep
    keepFromDrop: { keepAt: "drop" },     // mem.keep's r4all
    keepView: { view: true },                  // frames the groups read kept from the drop on
    keepViewFromLoad: { view: true, viewAtLoad: true },   // ... from the load on (the sweep included)
    pinFix: { pinFix: true },                  // a forgotten frame makes the Stage send its pins again; GC as built
    pinFixKeepView: { pinFix: true, view: true },
};

for (const [name, C] of Object.entries(CASES)) {
    const only = process.env.DIAG_CASE;
    (only && !only.split(",").includes(name) ? test.skip : test)(`R4 drop diagnosis: ${name}`, async () => {
        resetRasterWorkerClient(); setRasterWorkerCount(4);
        setRasterTransport(() => new Promise(() => {}));
        const f = path.join(REPORT_DIR, R4);
        const rep = readReportFile(f);
        const E = mk(1806, 1070);
        loadReport(E, rep, { drawing: drawingPartsOf(f) });
        const cx = E.width / 2, cy = E.height / 2, s = 2.7029;
        const px = (cx - E.cam.inPanX) / E.cam.inScale, py = (cy - E.cam.inPanY) / E.cam.inScale;
        E.cam.inScale = s; E.cam.inPanX = cx - px * s; E.cam.inPanY = cy - py * s;
        if (C.keepAt === "load") E.lm.forget = () => false;
        if (C.viewAtLoad) DIAGKEEP.view = true;
        if (C.pinFix) { const fg = E.stage.forgetFrame.bind(E.stage); E.stage.forgetFrame = (id) => { fg(id); E.stage._keysVer++; }; }
        E.setTool("select");
        E._render();
        E.sweepFrames();
        E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
        E._render();
        for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 30));
        if (C.keepAt === "drop") E.lm.forget = () => false;
        DIAGKEEP.view = !!C.view;
        const S = { on: false, dropped: {}, baked: {}, events: {}, before: new Set() };
        instrument(E, S);
        log(`[${name}] lattice ${E.lm.frames.size}, tiles ${E.store.cache.size} (pinned ${[...E.store.cache.keys()].filter((k) => E.store._pins.has(k)).length}), camera ${E.cam.frame}`);
        {
            const st = E.stage, keys = [...st._keys.values()];
            const byGroup = keys.filter((ks) => ks.groups.size), cached = (ks) => E.store.cache.has(ks.key);
            const frameOf = new Map();
            for (const t of E.store.cache.values()) frameOf.set(String(t.level), (frameOf.get(String(t.level)) || 0) + 1);
            const srcs = new Set([...st._groups.values()].map((g) => String(g.F0)));
            log(`[${name}] stage keys ${keys.length} (by groups ${byGroup.length}, cached ${keys.filter(cached).length}, group keys cached ${byGroup.filter(cached).length}); ` +
                `pin set ${E.store._pins.size}; groups ${st._groups.size}, source frames ${srcs.size} (existing ${[...srcs].filter((f) => E.lm.frame(f)).length}); ` +
                `cached tiles by frame: ${[...frameOf.entries()].map(([f, n]) => `${srcs.has(f) ? "SRC " : ""}${f.slice(-22)}:${n}`).slice(0, 14).join(" ")}`);
            log(`[${name}] group keys e.g. ${byGroup.slice(0, 4).map((ks) => ks.key.slice(-40)).join(" ; ")}`);
        }
        for (let k = 0; k < 3; k++) {
            const sign = k % 2 ? -1 : 1;
            S.before = new Set(E.lm.frames.keys());
            S.dropped = {}; S.baked = {}; S.events = {}; S.on = true;
            E._dragSel = { start: [cx, cy], moved: false };
            E._beginHold();
            for (let st = 1; st <= 10; st++) E._dragSelection(cx + (sign * 60 * st) / 10, cy + (sign * 40 * st) / 10);
            const drag = { dropped: S.dropped, baked: S.baked, events: S.events, frames: E.lm.frames.size, tiles: E.store.cache.size };
            S.dropped = {}; S.baked = {}; S.events = {};
            const t0 = perfNow();
            E._pointerUp();
            const ms = perfNow() - t0;
            S.on = false;
            log(`[${name}] drop ${k + 1}: ${ms.toFixed(0)} ms; frames ${E.lm.frames.size}, tiles ${E.store.cache.size}, pinned ${[...E.store.cache.keys()].filter((key) => E.store._pins.has(key)).length}\n` +
                `   DRAG dropped ${JSON.stringify(drag.dropped)} baked ${JSON.stringify(drag.baked)} events ${JSON.stringify(drag.events)} (frames ${drag.frames}, tiles ${drag.tiles})\n` +
                `   DROP dropped ${JSON.stringify(S.dropped)} baked ${JSON.stringify(S.baked)} events ${JSON.stringify(S.events)}`);
            for (let w = 0; w < 20; w++) await new Promise((r) => setTimeout(r, 30));
        }
        DIAGKEEP.view = false;
        E.destroy();
        setRasterTransport(null); setRasterWorkerCount(null);
    });
}
