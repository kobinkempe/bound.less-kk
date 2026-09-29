/**
 * report.js — the dev report's assembly (OPEN-FLAGS F58, DESIGN.md §14).
 *
 * One bounded JSON document: the numbers today's issues are measured by (paper, freezes,
 * moves, erasing, saving, scenes, memory), the recent history (the journal, the undo and redo
 * stacks), and a LOCAL EXTRACT of the drawing — the natives on screen and around it, in
 * kobin-2 frame form, with the whole lattice — that `loadReport` turns back into an engine
 * state. The whole drawing is an opt-in of its own (`drawingPlan` / `drawingChunk`), sent in
 * parts. Built task by task with a yield between, so a 42,856-native drawing never holds the
 * main thread for the whole build.
 *
 * It only reads: nothing here mints a frame, settles a shift or emits a document event. The
 * transport is `hooks/reportSend.js`, the receiver `tools/report-server.js`, the reader
 * `tools/report-read.js`, the jsdom loader `__testkit__/reportReplay.js`.
 */
import { encodeObjects, decodeObjects, packChunk, unpackChunk, CHUNK_FRAME } from "./format2";
import { bboxOf } from "./geometry/derive";
import { encodeBelow, hasOffsets, shiftAt } from "./geometry/offsets";
import { W } from "./frameLattice";
import { perfNow } from "./now";
import * as rasterPerf from "./raster/rasterPerf";
import { eraseWorkerStats } from "./eraseWorkerClient";

export const REPORT_V = 2;
/** The extract's JSON before gzip: "a few MB" (F58). The whole drawing is the opt-in. */
export const EXTRACT_MAX_BYTES = 4 << 20;
/** "Around" reaches one level crossing out: a native first seen at a zoom-out past this is left out. */
export const EXTRACT_ZOOM_OUT = 4096;
/** A native under this many px wherever it could first be seen is left out. */
export const EXTRACT_MIN_PX = 0.25;
/** A lattice larger than this is cut to the frames the extract's natives and the camera hang from. */
export const LATTICE_MAX = 20000;
/** One whole-drawing part's doubles, before gzip: encoding is ~45 ms a MB on the main thread (3 MB parts reached 372 ms). */
export const DRAWING_CHUNK_BYTES = 1 << 20;
// The extract's size is estimated before it is encoded: a double as JSON text with its comma,
// and one object header with its table. Measured on the Magnum Opus: 16.3 and 166 bytes.
const BYTES_PER_NUMBER = 17;
const BYTES_PER_HEADER = 200;
const HEAD = 20;
const SCORE_SLICE = 1500;          // natives scored in one task
const ENCODE_SLICE = 512 << 10;    // estimated bytes encoded in one task

const msg = (err) => String((err && err.message) || err).slice(0, 200);
const r3 = (v) => (typeof v === "number" && isFinite(v) ? +v.toPrecision(6) : v);

/**
 * A yield to the event loop that a hidden tab does not throttle. Chained timers run once a
 * second there, and once a minute after five minutes hidden: a 20-task report over
 * `setTimeout(0)` took 11 minutes to send (measured 2026-09-22). A message is not a timer.
 */
let yq = null;
export function macroYield() {
    if (typeof MessageChannel !== "function") return new Promise((res) => setTimeout(res, 0));
    if (!yq) {
        const ch = new MessageChannel(), q = [];
        ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
        if (ch.port1.unref) ch.port1.unref();   // Node's port would keep a test process alive
        yq = { q, post: () => ch.port2.postMessage(0) };
    }
    return new Promise((res) => { yq.q.push(res); yq.post(); });
}
const defaultYield = macroYield;

/**
 * A bounded copy of anything for the JSON: primitives kept, strings cut at 160, typed arrays
 * and natives summarised, arrays cut to their first HEAD with the count, three levels deep.
 * Displacement tables go in their file form.
 */
export function brief(v, depth = 0, key = "") {
    if (v == null || typeof v === "boolean") return v;
    if (typeof v === "number") return isFinite(v) ? v : String(v);
    if (typeof v === "string") return v.length > 160 ? v.slice(0, 160) + "…" : v;
    if (typeof v === "function" || typeof v === "symbol") return undefined;
    if (/^below/.test(key) && Array.isArray(v)) return encodeBelow(v) || null;
    if (ArrayBuffer.isView(v)) return { f64: v.length };
    if (v.loops || v.pts || v.polys) return nativeBrief(v);
    if (v instanceof Map || v instanceof Set) return { size: v.size };
    if (Array.isArray(v)) {
        if (depth >= 3) return { n: v.length };
        const head = [];
        for (let i = 0; i < Math.min(v.length, HEAD); i++) head.push(brief(v[i], depth + 1));
        return v.length > HEAD ? { n: v.length, head } : head;
    }
    const keys = Object.keys(v);
    if (depth >= 3) return { keys: keys.length };
    const out = {};
    let n = 0;
    for (const k of keys) {
        if (k[0] === "_" && k !== "_seq") continue;
        if (n++ >= 24) { out["…"] = keys.length; break; }
        const b = brief(v[k], depth + 1, k);
        if (b !== undefined) out[k] = b;
    }
    return out;
}
function nativeBrief(o) {
    const out = { id: o.id, type: o.type };
    if (o.loops) out.pieces = o.loops.reduce((n, l) => n + (l.length || 0), 0);
    if (o.pts) out.pts = o.pts.length;
    if (o.z != null && o.z !== o.id) out.z = o.z;
    if (o.editId != null) out.editId = o.editId;
    if (o.erase) out.erase = true;
    const below = encodeBelow(o.below);
    if (below) out.below = below;
    return out;
}
const boxOf = (b) => (b ? [r3(b.x0), r3(b.y0), r3(b.x1), r3(b.y1)] : null);

/** The doubles an object's kobin-2 span holds (`format2.pushGeometry`'s count). */
export function numbersOf(o) {
    if (o.type === "shape") {
        let n = 1;
        for (const l of o.loops || []) n += 1 + (l.buf ? l.buf.length : (l.length || 0) * 8);
        return n;
    }
    if (o.type === "fill") {
        let n = 1;
        for (const ring of o.polys || []) n += 1 + 2 * ring.length;
        return n;
    }
    return 1 + 2 * ((o.pts && o.pts.length) || 0);
}
const costOf = (o) => BYTES_PER_HEADER + numbersOf(o) * BYTES_PER_NUMBER;

/**
 * The report, section by section. `opts`: `why`; `save`, `cloud`, `errors`, `console` (the
 * hook's own state, taken as given); `extract` (options for `buildExtract`, or false);
 * `yieldFn` (between tasks; a macrotask by default). Every section is caught: one that throws
 * is named in `build.errors` and the rest of the report stands.
 */
export async function buildReport(E, opts = {}) {
    const yieldFn = opts.yieldFn || defaultYield;
    const t0 = perfNow();
    const tasks = [], errors = {};
    const rep = { v: REPORT_V, kind: "kobin-report", headline: null };
    const run = async (name, fn) => {
        const t = perfNow();
        let v;
        try { v = fn(); } catch (err) { errors[name] = msg(err); v = undefined; }
        tasks.push([name, +(perfNow() - t).toFixed(1)]);
        await yieldFn();
        return v;
    };
    const section = (name, fn) => run(name, () => { const v = fn(); if (v !== undefined) rep[name] = v; return v; });
    const sub = (name, fn) => { try { return fn(); } catch (err) { errors[name] = msg(err); return null; } };

    await section("meta", () => metaOf(E, opts));
    await section("camera", () => cameraOf(E, sub));
    await section("counts", () => countsOf(E));
    await section("raster", () => rasterOf(E, sub));
    await section("instruments", () => instrumentsOf(E, sub));
    await section("memory", () => memoryOf(E, sub));
    await section("moves", () => movesOf(E, sub));
    await section("erase", () => eraseOf(E, sub));
    await section("scenes", () => scenesOf(E, sub));
    await section("save", () => (opts.save ? brief(opts.save) : null));
    await section("cloud", () => (opts.cloud ? brief(opts.cloud) : null));
    await section("errors", () => ({
        page: brief((opts.errors || []).slice(-30)),
        console: brief((opts.console || []).slice(-50)),
    }));
    await section("history", () => historyOf(E));
    if (opts.extract !== false) {
        try { rep.extract = await buildExtract(E, opts.extract || {}, run); } catch (err) { errors.extract = msg(err); }
    }
    try { rep.families = await familiesOf(E, rep.extract, run); } catch (err) { errors.families = msg(err); }
    let longest = ["", 0];
    for (const t of tasks) if (t[1] > longest[1]) longest = t;
    rep.build = {
        ms: +(perfNow() - t0).toFixed(1), tasks: tasks.length, longestTask: { name: longest[0], ms: longest[1] },
        byTask: tasks, errors,
    };
    rep.headline = sub("headline", () => headlineOf(rep));
    return rep;
}

// ---- the sections ----

function metaOf(E, opts) {
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const loc = typeof window !== "undefined" && window.location ? window.location : null;
    const query = loc ? String(loc.hash + loc.search).replace(/^[^?]*\??/, "") : "";
    return {
        when: new Date().toISOString(), why: opts.why || null, id: opts.id || null,
        renderer: E.raster ? "raster" : "svg",
        // The route without its query: the canvas id is not identity; the query is read as flags.
        route: loc ? String(loc.hash || "").replace(/\?.*$/, "") : null,
        flags: query ? query.split("&").filter(Boolean).map((p) => p.split("=")[0]).slice(0, 12) : [],
        docName: E.docMeta ? E.docMeta.name : null,
        device: {
            ua: nav.userAgent || null, platform: nav.platform || null,
            cores: nav.hardwareConcurrency || null, memoryGB: nav.deviceMemory || null,
            touch: nav.maxTouchPoints || 0, online: nav.onLine !== false,
            dpr: typeof window !== "undefined" ? window.devicePixelRatio : null,
            window: typeof window !== "undefined" ? { w: window.innerWidth, h: window.innerHeight } : null,
            engine: { w: E.width, h: E.height },
            visibility: typeof document !== "undefined" ? document.visibilityState : null,
        },
        engine: {
            tool: E.tool, trace: !!E.trace, preBake: !!E.preBake, retainScenes: !!E.retainScenes,
            opacityGroups: !!E.opacityGroups, drawing: !!E._drawing, erasing: !!E._erasing,
            lasso: !!E._lasso, dragging: !!E._dragSel,
        },
    };
}

function cameraOf(E, sub) {
    const c = E.cam.state();
    const lm = E.lm;
    const path = [];
    for (let f = lm.frame(c.frame), guard = 0; f && guard < 200; f = f.parent != null ? lm.frame(f.parent) : null, guard++) {
        path.push({ id: f.id, depth: f.depth, i: f.cell.i, j: f.cell.j, natives: E.doc.count(f.id),
            kids: f._kids ? f._kids.size : 0, shift: f.shift || undefined, shadowOf: f.shadowOf != null ? f.shadowOf : undefined });
    }
    const near = (f) => ({ id: f.id, natives: E.doc.count(f.id) });
    return {
        ...c, depth: lm.depthOf(c.frame),
        effectiveZoom: sub("camera.zoom", () => E._effectiveZoom()),
        view: E.cam.frameWindow(0),
        path,
        ring: sub("camera.ring", () => lm.peekRing(c.frame).map(near)),
        children: sub("camera.children", () => lm.childrenOf(c.frame).slice(0, 30).map(near)),
        latticeFrames: lm.frames.size,
    };
}

function countsOf(E) {
    const doc = E.doc;
    const byFrame = [];
    let natives = 0, pieces = 0, shapes = 0, strokes = 0, fills = 0, marks = 0;
    for (const L of doc.levels()) {
        const arr = doc.list(L);
        if (!arr.length) continue;
        natives += arr.length;
        byFrame.push([L, arr.length]);
        for (const o of arr) {
            if (o.type === "shape") { shapes++; for (const l of o.loops || []) pieces += l.length || 0; }
            else if (o.type === "fill") fills++;
            else strokes++;
            if (o.erase) marks++;
        }
    }
    byFrame.sort((a, b) => b[1] - a[1]);
    return {
        natives, pieces, shapes, strokes, fills, marks, frames: byFrame.length,
        moved: doc.offsetIds().size, undo: doc._undo.length, redo: doc._redo.length, rev: doc.rev,
        byFrame: byFrame.slice(0, 40),
        listed: (E._lastList || []).length,
    };
}

function rasterOf(E, sub) {
    const R = E.renderer;
    if (!E.raster) return { renderer: "svg", groups: R && R._groups ? R._groups.size : null, hasFat: !!(R && R._hasFat) };
    return {
        perf: sub("raster.perf", () => rasterPerf.report({ longFrames: E.longFrames })),
        // This engine's own store: the perf ring above is a module singleton, attached to the last renderer built.
        plates: sub("raster.plates", () => (E.plates && E.plates.report ? E.plates.report() : null)),
        renderer: sub("raster.renderer", () => (R.report ? R.report() : null)),
        layer: sub("raster.layer", () => ({ status: { ...R.layer.status() }, uncoveredCells: R.layer.uncoveredCells() })),
        plane: sub("raster.plane", () => (R._plane && R._plane.stats ? { ...R._plane.stats } : null)),
        overlay: sub("raster.overlay", () => (R._overlay && R._overlay.report ? brief(R._overlay.report()) : null)),
        ladder: { built: E._ladderAt != null, busy: !!E._ladderBusy, steps: (E._ladderSteps || []).length },
        stage: sub("raster.stage", () => ({ G: E.stage.generation, ...E.stage.stats })),
    };
}

function instrumentsOf(E, sub) {
    return {
        perfLog: (E.perfLog || []).slice(-300),
        perfLong: (E.perfLong || []).slice(),
        fast: sub("instruments.fast", () => E.fastStats()),
        frameMeter: sub("instruments.frameMeter", () => E.frameMeter.report()),
        longFrames: sub("instruments.longFrames", () => E.longFrames.report()),
        eventLatency: sub("instruments.eventLatency", () => E.eventLatency.report()),
        growth: sub("instruments.growth", () => E.growth.report()),
    };
}

function memoryOf(E, sub) {
    let heap = null;
    try {
        const m = typeof performance !== "undefined" ? performance.memory : null;
        if (m) heap = { usedMB: Math.round(m.usedJSHeapSize / 1048576), totalMB: Math.round(m.totalJSHeapSize / 1048576), limitMB: Math.round(m.jsHeapSizeLimit / 1048576) };
    } catch (err) { /* not everywhere */ }
    return {
        heap,
        plates: sub("memory.plates", () => {
            if (!E.plates || !E.plates.report) return rasterPerf.growth();
            const r = E.plates.report();
            return { plates: r.plates, plateBytes: r.plateBytes, maxBytes: r.maxBytes };
        }),
        tiles: sub("memory.tiles", () => tileCensus(E.store)),
        undoOps: E.doc._undo.length,
    };
}
function tileCensus(store) {
    const byDir = {}, byFrame = new Map();
    let tiles = 0, pieces = 0;
    for (const t of store.cache.values()) {
        tiles++;
        const n = (t.objs || []).length;
        pieces += n;
        byDir[t.dir] = (byDir[t.dir] || 0) + 1;
        const f = byFrame.get(t.level) || [0, 0];
        f[0]++; f[1] += n;
        byFrame.set(t.level, f);
    }
    const frames = [...byFrame.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12).map(([id, [n, p]]) => ({ id, tiles: n, pieces: p }));
    return { tiles, pieces, byDir, frames };
}

function movesOf(E, sub) {
    const s = E.selection;
    const lm = E.lm;
    const shifts = [], shadows = [];
    for (const f of lm.frames.values()) {
        if (f.shift && shifts.length < 50) shifts.push({ id: f.id, shift: f.shift, natives: E.doc.count(f.id) });
        if (f.shadowOf != null && shadows.length < 50) shadows.push({ id: f.id, of: f.shadowOf, natives: E.doc.count(f.id) });
    }
    const d = E._dragSel, h = E._holdMove;
    const recent = [];
    const undo = E.doc._undo;
    for (let i = undo.length - 1; i >= 0 && recent.length < 10; i--) {
        const op = undo[i];
        if (op && (op.op === "move" || op.op === "moveMany" || op.op === "moveFrames")) recent.push(brief(op));
    }
    return {
        selection: s ? { n: s.ids.length, ids: s.ids.slice(0, 50), frames: (s.frames || []).slice(0, 50), id: s.id, editId: s.editId, level: s.level } : null,
        members: s ? sub("moves.members", () => E._selectionMembers().slice(0, 50).map((m) => ({
            id: m.obj.id, level: m.level, type: m.obj.type, z: m.obj.z != null ? m.obj.z : m.obj.id,
            editId: m.obj.editId, below: encodeBelow(m.obj.below) || null, box: boxOf(bboxOf(m.obj, E._drawing)),
        }))) : null,
        drag: d ? { start: d.start, last: d.last || null, moved: !!d.moved, members: d.moves ? d.moves.size : 0, frames: d.frames ? d.frames.size : 0 } : null,
        hold: h ? { ids: h.ids.size, frames: h.frames, at: h.at } : null,
        holdOn: !!E._moveHoldOn,
        shifts, shadows, recent,
    };
}

function eraseOf(E, sub) {
    const marks = sub("erase.marks", () => E._eraseStrokes()) || [];
    const jobs = E._bakeJobs || [];
    const flying = E._cuts ? [...E._cuts.values()].filter((c) => c.state === "flight") : [];
    return {
        pending: marks.length,
        marks: marks.slice(0, 50).map(({ obj, level }) => ({
            id: obj.id, level, z: obj.z != null ? obj.z : obj.id, bakePx: obj.bakePx,
            targets: obj.targets ? obj.targets.length : null,
            committed: !!(E._eraseCommits && E._eraseCommits.get(obj.id)),
            box: boxOf(bboxOf(obj, E._drawing)),
        })),
        bakeJobs: { n: jobs.length, ids: jobs.slice(0, HEAD).map((j) => j.id) },
        inflight: flying.length ? { n: flying.length, ids: flying.slice(0, HEAD).map((c) => c.id), ageMs: Math.round(perfNow() - Math.min(...flying.map((c) => c.t0))) } : null,
        buffered: E._cuts ? E._cuts.size - flying.length : 0,
        barrier: E._barrier ? { kind: E._barrier.kind, rounds: E._barrier.rounds, ms: Math.round(perfNow() - E._barrier.t0) } : null,
        heldMs: E._bakeHeldSince ? Math.round(perfNow() - E._bakeHeldSince) : 0,
        counters: {
            dustCulled: E._dustCulled || 0, boolSeals: E._boolFailures || 0, bakeRepairs: E._bakeRepairs || 0,
            cutFailures: E._cutFailures || 0, cutStale: E._cutStale || 0,
            aborted: (E._eraseAborted || []).slice(),   // marks whose bake passed its step budget (PLAN §5.8 item 3)
            lastSeal: brief(E._lastBoolFailure || null), lastBakeRepair: brief(E._lastBakeRepair || null),
            rehomeWhy: brief(E._rehomeWhy || null),
        },
        worker: sub("erase.worker", () => eraseWorkerStats()),
    };
}

function scenesOf(E, sub) {
    const m = E.docMeta || {};
    const scenes = m.scenes || [];
    return {
        count: scenes.length,
        list: scenes.slice(0, 60).map((s) => brief(s, 1)),
        // The scene index's own account, when the engine offers one (SCENES-PLAN §7).
        index: typeof E.sceneReport === "function" ? sub("scenes.index", () => brief(E.sceneReport())) : undefined,
    };
}

function historyOf(E) {
    return {
        journal: E.journal || [],
        undo: E.doc._undo.slice(-30).map((op) => brief(op)),
        redo: E.doc._redo.slice(-10).map((op) => brief(op)),
    };
}

/**
 * The multi-native families the extract touches and whether each still hangs together, as
 * `reportFamilies` reports them for the whole drawing. Components are left out for a family
 * with a moved member: `_familyComponents` maps its parent through `objShift`, which can mint.
 */
async function familiesOf(E, ex, run) {
    if (!ex || !ex.frames || typeof E._familyComponents !== "function") return null;
    const doc = E.doc;
    const fams = [];
    // One pass over the natives counting only the extract's keys: `editGroup`'s index over all
    // 42,856 was 218 ms cold, for no family at all.
    await run("families", () => {
        const members = new Map();
        for (const f of Object.values(ex.frames)) {
            for (const h of f.objects) {
                const rec = doc.getById(h.id);
                if (rec && !rec.obj.erase) members.set(doc.editKey(rec.obj), []);
            }
        }
        for (const L of doc.levels()) {
            for (const o of doc.list(L)) {
                if (o.erase) continue;
                const m = members.get(doc.editKey(o));
                if (m) m.push({ obj: o, level: L });
            }
        }
        for (const [key, group] of members) if (group.length > 1 && fams.length < 12) fams.push({ key, group });
    });
    const out = [];
    for (const { key, group } of fams) {
        await run("families.components", () => {
            const moved = group.some((m) => hasOffsets(m.obj.below));
            let components = null;
            if (!moved) {
                const fc = E._familyComponents(key);
                components = fc.classes.map((c) => c.map((i) => fc.members[i].obj.id));
            }
            out.push({
                key, moved,
                members: group.slice(0, 40).map((m) => ({ id: m.obj.id, level: m.level, type: m.obj.type, box: boxOf(m.obj.loops ? bboxOf(m.obj) : null),
                    attach: m.obj.attachRect ? [r3(m.obj.attachRect.x0), r3(m.obj.attachRect.y0), r3(m.obj.attachRect.x1), r3(m.obj.attachRect.y1)] : null })),
                n: group.length, components,
            });
        });
    }
    return out;
}

/** The numbers `tools/report-read.js` leads with, in one place at the top of the file. */
function headlineOf(rep) {
    const c = rep.counts || {}, cam = rep.camera || {}, ras = rep.raster || {}, ins = rep.instruments || {};
    const pic = ras.perf && ras.perf.picture ? ras.perf.picture : null;
    const lf = ins.longFrames || null;
    const worst = lf && lf.worst && lf.worst[0] ? lf.worst[0] : null;
    const ex = rep.extract ? rep.extract.stats : null;
    return {
        when: rep.meta ? rep.meta.when : null, why: rep.meta ? rep.meta.why : null,
        renderer: rep.meta ? rep.meta.renderer : null,
        camera: { frame: cam.frame, depth: cam.depth, inScale: r3(cam.inScale), zoom: r3(cam.effectiveZoom) },
        natives: c.natives, pieces: c.pieces, frames: c.frames, lattice: cam.latticeFrames, moved: c.moved, listed: c.listed,
        paper: pic ? { uncoveredNow: ras.layer ? ras.layer.uncoveredCells : null, paperComposes: pic.paperComposes, paperCellsMax: pic.paperCellsMax,
            fallbackBlits: pic.fallbackBlits, holds: pic.holds, previews: pic.previews } : null,
        worstLongFrameMs: worst ? worst.ms : null,
        heapMB: rep.memory && rep.memory.heap ? rep.memory.heap.usedMB : null,
        pendingMarks: rep.erase ? rep.erase.pending : null,
        selection: rep.moves && rep.moves.selection ? rep.moves.selection.n + (rep.moves.selection.frames || []).length : 0,
        saveFailing: rep.save ? !!rep.save.failCount : null,
        extract: ex ? { natives: ex.chosen, of: ex.candidates, visible: ex.visible, estBytes: ex.estBytes, truncated: ex.dropped > 0 } : null,
    };
}

// ---- the local extract ----

/**
 * The natives on screen and around it, in kobin-2 frame form, cut to `maxBytes` of JSON.
 *
 * Every native is scored by the zoom-out that first brings it on screen (1 when it is) and
 * its size in px there; what the render list draws on screen comes first, then the selection,
 * then the rest of the render list (the tile window), then the rest within `zoomOut`, each by
 * that size, largest first, while it fits. A native with a displacement table (or in
 * a frame with a pending shift) is judged where its picture is, from `shiftAt(below, 0)` in
 * its home's units. The lattice goes whole, so `loadReport` maps every frame as the engine did.
 */
export async function buildExtract(E, opts = {}, run = null) {
    const go = run || (async (name, fn) => fn());
    const maxBytes = opts.maxBytes != null ? opts.maxBytes : EXTRACT_MAX_BYTES;
    const zoomOut = opts.zoomOut || EXTRACT_ZOOM_OUT;
    const minPx = opts.minPx != null ? opts.minPx : EXTRACT_MIN_PX;
    const scoreSlice = opts.scoreSlice || SCORE_SLICE, encodeSlice = opts.encodeSlice || ENCODE_SLICE;
    const t0 = perfNow();
    const out = {
        v: 1, camera: E.cam.state(), screen: { w: E.width, h: E.height }, view: E.cam.frameWindow(0),
        limits: { maxBytes, zoomOut, minPx }, crossings: null, frames: {}, stats: null,
    };
    let sc = null, cands = null, pick = null;
    await go("extract.prep", () => { sc = scorer(E, zoomOut, minPx); });
    // Scored in slices: a native's first box is a walk of its loops (16,079 cold ones were 401 ms in one task).
    const scr = sc;
    for (const w of scr.work) {
        for (let i = 0; i < w.objs.length; i += scoreSlice) {
            await go("extract.score", () => { for (let j = i, e = Math.min(i + scoreSlice, w.objs.length); j < e; j++) scr.consider(w.objs[j], w); });
        }
    }
    await go("extract.score", () => { cands = scr.finish(); });
    await go("extract.choose", () => { pick = chooseNatives(cands.list, maxBytes); });
    // Encoded in slices of about ENCODE_SLICE bytes (one frame's 3 MB was 170 ms); a frame's slices are joined, spans offset.
    const { byFrame } = pick;
    const frames = [...byFrame.keys()];
    for (const G of frames) {
        const want = byFrame.get(G);
        const objs = E.doc.list(G).filter((o) => want.has(o.id));
        const acc = { objects: [], geo: [] };
        for (let i = 0; i < objs.length;) {
            const slice = [];
            for (let b = 0; i < objs.length && (!slice.length || b < encodeSlice); i++) { slice.push(objs[i]); b += costOf(objs[i]); }
            await go("extract.encode", () => {
                const enc = encodeObjects(slice), base = acc.geo.length;
                for (const h of enc.objects) { h.g = [h.g[0] + base, h.g[1]]; acc.objects.push(h); }
                for (let k = 0; k < enc.geo.length; k++) acc.geo.push(enc.geo[k]);
            });
        }
        if (acc.objects.length) out.frames[G] = acc;
    }
    await go("extract.lattice", () => { out.crossings = latticeFor(E, pick.homes); });
    out.stats = {
        candidates: cands.list.length, chosen: pick.n, estBytes: pick.bytes, dropped: pick.dropped,
        listed: cands.listed, listedIncluded: pick.listed, visible: cands.visible, visibleIncluded: pick.visible, visibleDropped: pick.droppedVisible,
        selected: cands.selected, selectedIncluded: pick.selected,
        tooBig: pick.tooBig, unreachable: cands.unreachable, tinyFrames: cands.tinyFrames,
        frames: frames.map((G) => [G, pick.byFrame.get(G).size, E.doc.count(G)]),
        latticeFrames: out.crossings ? out.crossings.frames.length : 0, latticeTrimmed: !!(out.crossings && out.crossings.trimmed),
        ms: +(perfNow() - t0).toFixed(1),
    };
    return out;
}

/** The extract's scoring, as work lists a slice at a time can `consider`, and a `finish`. */
function scorer(E, zoomOut, minPx) {
    const lm = E.lm, doc = E.doc;
    const F = String(E.cam.frame), s = E.cam.inScale;
    const view = E.cam.frameWindow(0);
    const cx = (view.left + view.right) / 2, cy = (view.top + view.bottom) / 2;
    const hw = (view.right - view.left) / 2, hh = (view.bottom - view.top) / 2;
    const ctx = { left: cx - hw * zoomOut, top: cy - hh * zoomOut, right: cx + hw * zoomOut, bottom: cy + hh * zoomOut };
    // Listed: the render list's own sources, which is the whole tile window, not the screen; one
    // is ON SCREEN when its box meets the view as well. Selected: the selection and its families.
    const visible = new Set();
    for (const p of E._lastList || []) if (p && p.id != null) visible.add(p.id);
    const selected = new Set();
    if (E.selection) {
        for (const id of E.selection.ids.slice(0, 2000)) selected.add(id);
        try { for (const m of E._selectionMembers().slice(0, 2000)) selected.add(m.obj.id); } catch (err) { /* ids alone */ }
    }
    const pinned = new Set();
    for (const id of visible) { const r = doc.getById(id); if (r) pinned.add(String(r.level)); }
    for (const id of selected) { const r = doc.getById(id); if (r) pinned.add(String(r.level)); }
    const movedBy = new Map();
    for (const id of doc.offsetIds()) {
        const r = doc.getById(id);
        if (!r) continue;
        const L = String(r.level);
        (movedBy.get(L) || movedBy.set(L, []).get(L)).push(r.obj);
    }
    const shiftMemo = new Map();
    const seen = new Set();
    const list = [];
    let unreachable = 0, tinyFrames = 0, onScreenN = 0;
    const consider = (o, G, k, t, fshift, forced) => {
        if (seen.has(o.id)) return;
        seen.add(o.id);
        const b = bboxOf(o, E._drawing);
        const half = o.type === "stroke" ? (o.lwFrame || 0) / 2 : 0;
        let dx = 0, dy = 0;
        if (hasOffsets(o.below)) {
            let d = shiftMemo.get(o.below);
            if (!d) { const sh = shiftAt(o.below, 0); d = [sh.carry[0] * W + sh.rem[0], sh.carry[1] * W + sh.rem[1]]; shiftMemo.set(o.below, d); }
            dx = d[0]; dy = d[1];
        }
        if (fshift) { dx += fshift[0]; dy += fshift[1]; }
        const X0 = (b.x0 - half + dx) * k + t[0], X1 = (b.x1 + half + dx) * k + t[0];
        const Y0 = (b.y0 - half + dy) * k + t[1], Y1 = (b.y1 + half + dy) * k + t[1];
        const size = Math.max(X1 - X0, Y1 - Y0) * s;
        const nx = Math.min(Math.max(cx, X0), X1), ny = Math.min(Math.max(cy, Y0), Y1);
        const z = Math.max(1, Math.abs(nx - cx) / hw, Math.abs(ny - cy) / hh);
        const score = size / z;
        // Tiers: on screen, selected, in the render list (the tile window a small pan shows), around.
        const listed = visible.has(o.id), onScreen = listed && z <= 1, isSel = selected.has(o.id);
        if (!forced && !listed && !isSel && (!(z <= zoomOut) || !(score >= minPx))) return;
        if (onScreen) onScreenN++;
        list.push({ o, G, tier: onScreen ? 0 : isSel ? 1 : listed ? 2 : 3, score: isFinite(score) ? score : 0, cost: costOf(o) });
    };
    const work = [];
    for (const G of doc.levels()) {
        const n = doc.count(G);
        if (!n) continue;
        const k = lm.frameFactor(G, F);
        const t = lm.mapPointF([0, 0], G, F);
        if (!(k > 0) || !t) { unreachable += n; continue; }
        const fr = lm.frame(G);
        const fshift = fr && fr.shift ? fr.shift : null;
        if (!fshift && !pinned.has(G)) {
            const ext = doc.frameExtent(G);
            if (ext && ext.maxSize * k * s < minPx) { tinyFrames++; continue; }
        }
        if (fshift) { work.push({ G, k, t, fshift, objs: doc.list(G).slice() }); continue; }
        const inG = { left: (ctx.left - t[0]) / k, top: (ctx.top - t[1]) / k, right: (ctx.right - t[0]) / k, bottom: (ctx.bottom - t[1]) / k };
        work.push({ G, k, t, fshift: null, objs: doc.queryRect(G, inG).concat(movedBy.get(G) || []) });
    }
    const finish = () => {
        // The selection goes wherever it is.
        for (const id of selected) {
            if (seen.has(id)) continue;
            const r = doc.getById(id);
            if (!r) continue;
            const G = String(r.level);
            const k = lm.frameFactor(G, F) || 1, t = lm.mapPointF([0, 0], G, F) || [0, 0];
            consider(r.obj, G, k, t, null, true);
        }
        return { list, visible: onScreenN, listed: visible.size, selected: selected.size, unreachable, tinyFrames };
    };
    return { work, consider: (o, w) => consider(o, w.G, w.k, w.t, w.fshift, false), finish };
}

function chooseNatives(list, maxBytes) {
    list.sort((a, b) => (a.tier - b.tier) || (b.score - a.score));
    const byFrame = new Map(), bytesByFrame = new Map(), homes = new Set();
    const out = { byFrame, bytesByFrame, homes, n: 0, bytes: 0, dropped: 0, droppedVisible: 0, visible: 0, selected: 0, listed: 0, tooBig: [] };
    for (const c of list) {
        // Past the cap the scan goes on: a smaller native further down may still fit.
        if (out.bytes + c.cost > maxBytes) {
            out.dropped++;
            if (c.tier === 0) out.droppedVisible++;
            if (c.cost > maxBytes / 4 && out.tooBig.length < HEAD) out.tooBig.push({ id: c.o.id, frame: c.G, estBytes: c.cost, tier: c.tier });
            continue;
        }
        out.bytes += c.cost; out.n++;
        if (c.tier === 0) out.visible++;
        else if (c.tier === 1) out.selected++;
        else if (c.tier === 2) out.listed++;
        (byFrame.get(c.G) || byFrame.set(c.G, new Set()).get(c.G)).add(c.o.id);
        bytesByFrame.set(c.G, (bytesByFrame.get(c.G) || 0) + c.cost);
        homes.add(c.G);
    }
    return out;
}

/** The lattice, whole; past LATTICE_MAX the frames the natives and the camera hang from, and the camera's ring. */
function latticeFor(E, homes) {
    const all = E.lm.serialize();
    if (all.frames.length <= LATTICE_MAX) return all;
    const keep = new Set();
    const up = (id) => { for (let f = E.lm.frame(id); f && !keep.has(f.id); f = f.parent != null ? E.lm.frame(f.parent) : null) keep.add(f.id); };
    up(E.cam.frame);
    for (const f of E.lm.peekRing(E.cam.frame)) up(f.id);
    for (const G of homes) up(G);
    return { ...all, frames: all.frames.filter((f) => keep.has(f.id)), trimmed: { kept: keep.size, of: all.frames.length } };
}

// ---- the whole drawing, opt-in ----

/**
 * The whole drawing cut into parts of about `maxBytes` of doubles, per frame, each native once.
 * The plan holds the natives by reference, so a part encodes them as they are when it is sent.
 */
export function drawingPlan(E, maxBytes = DRAWING_CHUNK_BYTES) {
    const plan = [];
    const cap = Math.max(1, Math.floor(maxBytes / 8));
    for (const G of E.doc.levels()) {
        const arr = E.doc.list(G);
        let objs = [], nums = 0;
        for (const o of arr) {
            const n = numbersOf(o);
            if (objs.length && nums + n > cap) { plan.push({ frame: G, objs, numbers: nums }); objs = []; nums = 0; }
            objs.push(o); nums += n;
        }
        if (objs.length) plan.push({ frame: G, objs, numbers: nums });
    }
    return plan;
}
/** One planned part as a kobin-2 frame chunk (`format2.packChunk`), header `{ frame, part, objects }`. */
export function drawingChunk(step, part) {
    const { objects, geo } = encodeObjects(step.objs);
    return packChunk(CHUNK_FRAME, { frame: step.frame, part, objects }, geo);
}

// ---- back into an engine ----

/**
 * The report's drawing as a dev-0 snapshot (`files.loadSnapshot`'s input): the extract's
 * frames, or — when `drawing` holds the whole-drawing parts (chunk bytes, gunzipped) — those.
 */
export function extractToSnapshot(ex, drawing = null) {
    const natives = {};
    if (drawing && drawing.length) {
        for (const u8 of drawing) {
            const { header, geo } = unpackChunk(u8);
            const recs = decodeObjects(header.objects, geo);
            (natives[header.frame] || (natives[header.frame] = [])).push(...recs);
        }
    } else {
        for (const [G, f] of Object.entries(ex.frames || {})) natives[G] = decodeObjects(f.objects, Float64Array.from(f.geo));
    }
    return { v: "dev-0", camera: ex.camera, natives, crossings: ex.crossings };
}

/** Load a report's extract (or its whole drawing) into `E` at the recorded camera and screen size. */
export function loadReport(E, rep, { drawing = null, resize = true } = {}) {
    const ex = rep && rep.extract;
    if (!ex) throw new Error("this report carries no extract (a v1 report: load report.snapshot with loadSnapshot)");
    const snap = extractToSnapshot(ex, drawing);
    if (resize && ex.screen && (E.width !== ex.screen.w || E.height !== ex.screen.h)) E.resize(ex.screen.w, ex.screen.h);
    E.loadSnapshot(snap);
    let natives = 0;
    for (const a of Object.values(snap.natives)) natives += a.length;
    return { natives, frames: Object.keys(snap.natives).length, whole: !!(drawing && drawing.length) };
}
