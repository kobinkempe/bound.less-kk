/**
 * mem.tables.probe.js — memory lever 1 (shared offset tables, memory-chrome-2026-10-20.md) in jsdom: 6,000 shapes in
 * one frame, all selected, five drops; then the heap the undo history and the gesture journal hold (each dropped, collected, read) and the
 * distinct table arrays the natives hold. Lever 2: a report's drawing loaded (R6, the Magnum Opus, unless REPORT=…), the
 * heap the engine holds and how many of its loops have built their record index; lever 3: the family map against the
 * one editGroup built before (every native grouped); lever 4: the index boxes shared with the cached boxes, against
 * the copies the index kept before. Lever 5: records parsed from JSON and loaded, the heap their natives keep. `.claude/PERF-DEEP-2026-10-12/tools/memtables-ab.py` runs it beside a copy
 * on the build before the lever. Node has no pointer compression: Chrome's bytes are about half. A probe, not a suite.
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/mem.tables.probe.js"
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { bboxOf } from "./geometry/derive";
import { nativeFromRecord } from "./Document";

const v8 = require("v8");
const vm = require("vm");
v8.setFlagsFromString("--expose_gc");
const gcFn = vm.runInNewContext("gc");
const heap = () => { gcFn(); gcFn(); return process.memoryUsage().heapUsed; };
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(10 * 60 * 1000);

useEngines();

test("five drops of 6,000 selected shapes: what the undo history and the natives' tables hold", () => {
    const N = 6000, DROPS = 5;
    const E = mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const ids = [];
    for (let i = 0; i < N; i++) {
        const x = i === 0 ? -200 : ((i * 7919) % 40000) - 20000, y = i === 0 ? -100 : ((i * 104729) % 40000) - 20000;
        const o = { type: "shape", origin: "native", id: E.doc.allocId(), color: "#123", opacity: 1, w: 8,
            loops: rectLoop({ left: x, top: y, right: x + 40, bottom: y + 40 }) };
        E.doc.add(o, "1");
        ids.push(o.id);
    }
    E._render();
    E.setTool("select");
    E._setSelection(ids, []);
    const h0 = heap();
    let px = -180, py = -80;
    for (let k = 0; k < DROPS; k++) {
        const s = k % 2 ? -1 : 1, dx = s * 23.7, dy = s * 11.3;
        const p = E._levelPointToScreen("1", px, py);
        E.pointerDown(p[0], p[1]);
        for (let st = 1; st <= 4; st++) E.pointerMove(p[0] + (dx * st) / 4, p[1] + (dy * st) / 4);
        E.pointerUp();
        px += dx; py += dy;
    }
    const h1 = heap();
    const ops = E.doc._undo.length, members = E.doc._undo.reduce((n, op) => n + (op.moves ? op.moves.length : 1), 0);
    const tables = new Set(ids.map((id) => E.doc.getById(id).obj.below));
    const jm = E.journal.reduce((n, e) => n + (e.moves ? e.moves.length : 0), 0);
    // Dropped, not set aside: a local holding them would keep them in the heap.
    E.doc._undo.length = 0; E.doc._redo.length = 0;
    const h2 = heap();
    E.journal.length = 0;
    const h3 = heap();
    const undoB = h1 - h2;
    log("[mem.tables] " + JSON.stringify({ ops, members, dropsRetainedMB: +((h1 - h0) / 1048576).toFixed(2),
        undoMB: +(undoB / 1048576).toFixed(2), undoBytesPerMember: Math.round(undoB / members), journalMB: +((h2 - h3) / 1048576).toFixed(2), journalMoveMembers: jm, distinctNativeTables: tables.size }));
    expect(ops).toBe(DROPS);
    expect(members).toBe(DROPS * N);
});

test("a report loaded: the heap the engine holds and its loops' indexes", () => {
    const name = process.env.REPORT || "report-2026-10-07T03-39-00-036Z.json";
    const f = path.join(REPORT_DIR, name);
    let rep = readReportFile(f), parts = drawingPartsOf(f);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const h0 = heap(), t0 = Date.now();
    const E = new KobinEngine(host, { width: rep.extract.screen.w, height: rep.extract.screen.h, scenes: false });
    loadReport(E, rep, { drawing: parts });
    const loadMs = Date.now() - t0;
    rep = null; parts = null;
    const h1 = heap();
    let loops = 0, indexed = 0, idxBytes = 0;
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) for (const L of o.loops || []) {
        loops++;
        const ix = "_idx" in L ? L._idx : L.idx;           // `_idx`: reading `idx` would build it
        if (ix) { indexed++; idxBytes += ix.byteLength; }
    }
    log("[mem.loops] " + JSON.stringify({ report: name.slice(18, 26), loadMs, engineMB: +((h1 - h0) / 1048576).toFixed(2),
        loops, indexed, idxMB: +(idxBytes / 1048576).toFixed(2) }));
    // Lever 3: the family map editGroup builds, and the one it built before (every native grouped), each dropped and read.
    const first = E.doc.levels().map((k) => E.doc.list(k)[0]).find(Boolean);
    E.doc.editGroup(first.id);
    const groups = E.doc._groups.size, g1 = heap();
    E.doc._groups = null;
    const g2 = heap();
    let old = new Map();
    for (const level of Object.keys(E.doc.nativesByLevel)) for (const obj of E.doc.nativesByLevel[level] || []) {
        const k = E.doc.editKey(obj);
        let a = old.get(k);
        if (!a) { a = []; old.set(k, a); }
        a.push({ obj, level });
    }
    const oldGroups = old.size, g3 = heap();
    old = null;
    const g4 = heap();
    log("[mem.groups] " + JSON.stringify({ groups, groupsMB: +((g1 - g2) / 1048576).toFixed(2), oldGroups, oldGroupsMB: +((g3 - g4) / 1048576).toFixed(2) }));
    // Lever 4: once every native's box is read, as a session reads them, the index shares a shape's and a fill's;
    // before, each was a copy — measured as the bytes of those copies.
    let shared = 0, own = 0;
    const sharedBoxes = [];
    for (const k of E.doc.levels()) {
        const ix = E.doc._index[k];
        if (!ix) continue;
        for (const [id, b] of ix.boxes) { if (b === bboxOf(ix.objs.get(id))) { shared++; sharedBoxes.push(b); } else own++; }
    }
    const b0 = heap();
    const copies = sharedBoxes.map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }));
    const b1 = heap();
    log("[mem.boxes] " + JSON.stringify({ shared, own, copiesMB: +((b1 - b0) / 1048576).toFixed(2), n: copies.length }));
    E.destroy(); host.remove();
    expect(loops).toBeGreaterThan(0);
});

test("header strings: records parsed from JSON and loaded, the heap their natives keep", () => {
    const N = 43135, colours = ["#1d3557", "#e63946", "#2a9d8f", "#f4a261", "#264653"];
    const text = JSON.stringify(Array.from({ length: N }, (_, i) => ({ type: "stroke", origin: "native", id: i + 1,
        color: colours[i % 5], opacity: 1, w: 2, pts: [[0, 0], [1, 1]] })));
    // JSON.parse shares short strings itself; a structured clone (a worker's message, IndexedDB) makes each anew,
    // which is how Kobin's Chrome held one "shape" a native.
    const h0 = heap();
    const parsed = JSON.parse(text).map(nativeFromRecord);       // no local holds the records
    const h1 = heap();
    const cloned = v8.deserialize(v8.serialize(JSON.parse(text))).map(nativeFromRecord);
    const h2 = heap();
    log("[mem.strings] " + JSON.stringify({ natives: parsed.length, parsedMB: +((h1 - h0) / 1048576).toFixed(2),
        clonedMB: +((h2 - h1) / 1048576).toFixed(2), n: cloned.length }));
    const natives = cloned;
    expect(natives[7].color).toBe(colours[2]);
});
