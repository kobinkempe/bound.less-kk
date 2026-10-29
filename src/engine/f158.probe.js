/**
 * f158.probe.js — F158's levers (OPEN-FLAGS F158), checked bit for bit and timed. Every tile a cold sample bakes
 * (cullcompat's: each frame's tiles i, j in [-1, 1]^2, up and down) and every tile the Magnum Opus's zoom-out
 * derives after each crossing (zoomout.reads.probe.js test 2) is hashed piece for piece (cullcompat's signature).
 * F158_MODE=save writes the hashes (.claude/PERF-DEEP-2026-10-12/compat/f158-<name>.json); check (default) compares.
 * F158_STATS=1 adds the shape clips' loop and piece counts (slows the timing). A probe, not a suite. Run (bash):
 *   F158_MODE=save CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/f158.probe.js"
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
import { encodeLoops } from "./geometry/arcShape";
import { bboxOf } from "./geometry/derive";
import { perfNow } from "./now";

// F158_HEAD=1: every module gets the committed derivation (a copy written by `git show HEAD:… > geometry/__head_derive.js`).
jest.mock("./geometry/derive", () => (process.env.F158_HEAD ? jest.requireActual("./geometry/__head_derive") : jest.requireActual("./geometry/derive")));
const AS = require("./geometry/arcShape");
const FZ = require("./geometry/freeze");

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(3 * 60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "PERF-DEEP-2026-10-12", "compat");
const MODE = process.env.F158_MODE || "check";
const STATS = !!process.env.F158_STATS;

const sig = (p) => {
    const g = p.loops ? JSON.stringify(encodeLoops(p.loops)) : p.polys ? JSON.stringify(p.polys) : JSON.stringify(p.pts || null);
    return `${p.id}|${p.type}|${p.origin}|${p.z}|${g}|${p.covers ? 1 : 0}|${p.lwFrame == null ? "" : p.lwFrame}`;
};
const hashOf = (tile) => crypto.createHash("sha1").update(tile.objs.map(sig).sort().join("\n")).digest("hex").slice(0, 20);

/** The shape branch's parts, timed through the exports derive.js calls; returns the restore. */
function timeParts(T) {
    const wraps = [[AS, "clipShapeToRect"], [AS, "insideShape"], [AS, "transformLoopsAbout"], [AS, "transformLoops"], [AS, "loopsBBox"], [FZ, "chopFreezeLoops"]];
    const saved = wraps.map(([m, k]) => [m, k, m[k]]);
    for (const [m, k, f] of saved) {
        T[k] = { n: 0, ms: 0 };
        m[k] = (...a) => {
            if (STATS && k === "clipShapeToRect") clipStats(T, a[0], a[1]);
            const t0 = perfNow();
            try { return f(...a); } finally { T[k].n++; T[k].ms += perfNow() - t0; }
        };
    }
    return () => { for (const [m, k, f] of saved) m[k] = f; };
}
function clipStats(T, loops, r) {
    const s = T.clip || (T.clip = { calls: 0, loops: 0, pieces: 0, hotLoops: 0, hotPieces: 0, oneLoop: 0 });
    s.calls++;
    s.loops += loops.length;
    if (loops.length === 1) s.oneLoop++;
    for (const loop of loops) {
        const b = AS.loopsBBox([loop]);
        s.pieces += loop.length;
        if (!b || b.x1 < r.left || b.x0 > r.right || b.y1 < r.top || b.y0 > r.bottom) continue;
        s.hotLoops++;
        for (const p of loop) {
            const q = AS.pieceBBox(p);
            if (q[2] >= r.left && q[0] <= r.right && q[3] >= r.top && q[1] <= r.bottom) s.hotPieces++;
        }
    }
}

function load(name) {
    resetRasterWorkerClient(); setRasterWorkerCount(4);
    setRasterTransport(() => new Promise(() => {}));
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true, scenes: false });
    const f = path.join(REPORT_DIR, name);
    loadReport(E, readReportFile(f), { drawing: drawingPartsOf(f) });
    return E;
}

/** Cullcompat's sample: every frame's tiles i, j in [-1, 1]^2, both directions, from a cold cache. */
function bakeSample(E, hashes) {
    E.store.bumpEpoch();
    const frames = [...E.lm.frames.keys()].filter((F) => E.lm.frame(F).parent != null).slice(0, 400);
    let ms = 0;
    for (const F of frames) {
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            for (const dir of ["up", "down"]) {
                const t0 = perfNow();
                const tile = dir === "up" ? E.store._ensureUp(F, i, j) : E.store._ensureDown(F, i, j);
                ms += perfNow() - t0;
                hashes["s|" + F + "|" + dir + "|" + i + "," + j] = hashOf(tile);
            }
        }
        E.store._evict();
    }
    return { frames: frames.length, ms: Math.round(ms) };
}

/** The Magnum Opus's zoom-out from its deepest native frame: each crossing's tile derivations, hashed and timed. */
function crossings(E, hashes) {
    const frames = E.doc.levels().map((id) => ({ id, d: E.lm.depthOf(id), n: E.doc.count(id) })).filter((x) => x.d != null && x.n >= 20).sort((a, b) => b.d - a.d || b.n - a.n);
    const S0 = frames[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of E.doc.list(S0.id)) { const b = bboxOf(o); if (!(b.x1 > b.x0)) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    E.jumpTo(S0.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    E._render();
    const st = E.stage, ts = st.store;
    if (process.env.F158_RAM === "0") ts.ramBytes = 0;   // the tile RAM tier off, for the comparison
    // Timed at the outermost call only (a tile's derivation reads its parent's), less the hashing inside it.
    const der = { n: 0, ms: 0, twice: 0, moved: 0, bakes: 0 };
    const orig = {};
    // A bake, as distinct from a hit or a restore: `twice` counts every key asked for again, hits included.
    for (const m of ["_bakeUp", "_bakeDown"]) { const o = ts[m].bind(ts); orig[m] = o; ts[m] = (...a) => { der.bakes++; return o(...a); }; }
    let depth = 0, hashMs = 0;
    for (const m of ["_ensureUp", "_ensureDown"]) {
        const o = orig[m] = ts[m].bind(ts);
        // eslint-disable-next-line no-loop-func -- the counters are the walk's, shared on purpose
        ts[m] = (F, i, j, ...a) => {
            const t0 = perfNow(), h0 = hashMs;
            depth++;
            let tile;
            try { tile = o(F, i, j, ...a); } finally { depth--; }
            der.n++;
            if (depth === 0) der.ms += perfNow() - t0 - (hashMs - h0);
            const t1 = perfNow();
            const key = "c|" + F + "|" + m + "|" + i + "," + j, h = hashOf(tile);
            if (hashes[key] != null) { der.twice++; if (hashes[key] !== h) der.moved++; } else hashes[key] = h;
            hashMs += perfNow() - t1;
            return tile;
        };
    }
    // Stage._groupBox: timed where covers calls it, and checked against a box per member after each crossing.
    const gb = { n: 0, ms: 0, same: 0, diff: 0, perMemberMs: 0, groupedMs: 0 };
    const ogb = st._groupBox.bind(st);
    st._groupBox = (g) => { const t0 = perfNow(); try { return ogb(g); } finally { gb.n++; gb.ms += perfNow() - t0; } };
    const checkGroups = () => {
        for (const g of st._groups.values()) {
            const t0 = perfNow();
            let b = null;
            for (const id of g.ids) {
                const rec = E.doc.getById(id), r = rec && st.placeNative(rec.obj, st.frame).box();
                if (!r) continue;
                b = b ? { left: Math.min(b.left, r.left), top: Math.min(b.top, r.top), right: Math.max(b.right, r.right), bottom: Math.max(b.bottom, r.bottom) } : { ...r };
            }
            gb.perMemberMs += perfNow() - t0;
            const keep = g.box;
            g.box = undefined;
            const t1 = perfNow(), nb = ogb(g);
            gb.groupedMs += perfNow() - t1;
            if (keep !== undefined) g.box = keep;
            if (JSON.stringify(b) === JSON.stringify(nb)) gb.same++; else gb.diff++;
        }
    };
    const rows = [];
    let last = String(E.cam.frame);
    for (let k = 0; k < 400 && !(E.cam.activeLevel === 0 && E.cam.inScale < 0.3); k++) {
        E.zoomFactorAt(903, 535, 0.5);
        if (String(E.cam.frame) === last) continue;
        last = String(E.cam.frame);
        const win = E._listWin(), F = String(E.cam.frame);
        const n0 = der.n, m0 = der.ms, b0 = der.bakes, r0 = ts.ramStats ? ts.ramStats.restores : 0;
        let steps = 0;
        while (!st.covers(F, win) && steps < 2000) { st.sync(F, win, 4); steps++; }
        rows.push({ depth: E.cam.activeLevel, tiles: der.n - n0, bakes: der.bakes - b0, restores: (ts.ramStats ? ts.ramStats.restores : 0) - r0, ms: Math.round(der.ms - m0), steps });
        checkGroups();
    }
    st._groupBox = ogb;
    for (const m of Object.keys(orig)) ts[m] = orig[m];
    return { rows, n: der.n, bakes: der.bakes, ms: Math.round(der.ms), twice: der.twice, moved: der.moved,
        ram: { ...ts.ramStats, held: ts._ram ? ts._ram.size : null, mb: ts._ram ? +(ts._ramBytes / 1048576).toFixed(1) : null, cached: ts.cache.size },
        groupBox: { n: gb.n, ms: Math.round(gb.ms), same: gb.same, diff: gb.diff, perMemberMs: Math.round(gb.perMemberMs), groupedMs: Math.round(gb.groupedMs) } };
}

const RUNS = (process.env.F158_REPORTS || "report-2026-10-20T15-54-32-768Z.json:c,report-2026-10-07T03-24-11-129Z.json:s,report-2026-10-07T03-39-00-036Z.json:s,report-2026-10-13T16-08-52-852Z.json:s").split(",");
for (const run of RUNS) {
    const [name, what] = run.split(":");
    test(`F158: ${name} (${what === "c" ? "the zoom-out's crossings" : "the cold sample"})`, () => {
        const E = load(name);
        const T = {};
        const restore = timeParts(T);
        const hashes = {};
        let res;
        try { res = what === "c" ? crossings(E, hashes) : bakeSample(E, hashes); } finally { restore(); }
        const parts = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.ms != null ? { n: v.n, ms: Math.round(v.ms) } : v]));
        fs.mkdirSync(OUT, { recursive: true });
        const file = path.join(OUT, `f158-${what}-${name}`);
        let cmp = null;
        if (MODE === "save") fs.writeFileSync(file, JSON.stringify(hashes));
        else {
            const old = JSON.parse(fs.readFileSync(file, "utf8"));
            cmp = { tiles: 0, same: 0, diff: 0, onlyOld: 0, onlyNew: 0, eg: [] };
            for (const [k, h] of Object.entries(old)) {
                if (hashes[k] == null) { cmp.onlyOld++; continue; }
                cmp.tiles++;
                if (hashes[k] === h) cmp.same++; else { cmp.diff++; if (cmp.eg.length < 6) cmp.eg.push(k); }
            }
            for (const k of Object.keys(hashes)) if (old[k] == null) cmp.onlyNew++;
        }
        log(`F158 ${MODE} ${what} ${name}: ${JSON.stringify({ ...res, tiles: Object.keys(hashes).length, parts, cmp })}`);
        E.destroy();
        setRasterTransport(null); setRasterWorkerCount(null);
        if (cmp) expect(cmp.diff).toBe(0);
    });
}
