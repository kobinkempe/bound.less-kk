/**
 * Stores and files across A1 C1 (B-MODEL-C1 brief §3, "Stores"). A kobin-2 store written by the model
 * before C1 — the frozen oracle `__oracles__/model-v1`, which settles a frame's shift into its natives at
 * the first read — holding a pending shift in its header, settle and merge entries and a `moveFrames`
 * entry carrying `settled`, opened by the editor's own restore (the REAL hook over fake IndexedDB): it
 * loads to the oracle's picture, and undo then redo walk the oracle's pictures. The oracle writes the
 * store as the hook's saver does: its forced and unlisted frames snapshotted, then the drained log.
 * And the file's version: 3 only when the lattice carries a shift, refused by a version-2 reader; a
 * drawing without a shift written byte for byte as the model before C1 writes it.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import KobinEngine from "../engine/KobinEngine";
import OracleEngine from "../engine/__oracles__/model-v1/KobinEngine";
import { OpLog as OracleOpLog } from "../engine/__oracles__/model-v1/oplog";
import { encodeObjects as oEncodeObjects } from "../engine/__oracles__/model-v1/format2";
import { decodeDrawing as decodeV2, VERSION as READS_V2 } from "../engine/__oracles__/model-v1/persist";
import { decodeDrawing, VERSION } from "../engine/persist";
import { _resetDbForTests } from "../storage/db";
import { writeCanvas2, getStoreHeader } from "../storage/localCanvases";
import { fake } from "../engine/__testkit__/fakeFirestore";
import { pictureAt, comparePictures } from "../engine/__testkit__/modelFuzz";
import { eraseGesture } from "../engine/__testkit__/harness";
import { rectLoop } from "../engine/geometry/arcShape";
import { G } from "../engine/frameLattice";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));
jest.setTimeout(120000);

let api = null;
function Harness({ id }) {
    api = useKobinEngine({ canvasId: id });
    return <div ref={api.hostRef} />;
}
const later = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function mount(id) {
    let view;
    act(() => { view = render(<Harness id={id} />); });
    for (let i = 0; i < 200 && !api.engineReady; i++) await act(async () => { await later(); });
    expect(api.engineReady).toBe(true);
    return view;
}
const N = () => api.engineRef.current;

const engines = [];
function engine(Kind) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new Kind(host, { width: 800, height: 600, scenes: false });
    engines.push(E);
    return E;
}
beforeEach(() => {
    fake.reset();
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const shape = (E, frame, left, top, w, h, color = "#135") => {
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left, top, right: left + w, bottom: top + h }), color, opacity: 1, w: 8 };
    E.doc.add(o, frame);
    return o.id;
};
// The camera at depth 1 on frame "1"; its kids A (with a kid), B, C (B's neighbour), D and F, 200 cells from
// the view, each holding shapes.
function build(E) {
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const f = {
        A: E.lm.cellChild("1", 200, 0).id, B: E.lm.cellChild("1", 240, 0).id, C: E.lm.cellChild("1", 239, 0).id,
        D: E.lm.cellChild("1", -200, 60).id, F: E.lm.cellChild("1", 0, 200).id,
    };
    f.A1 = E.lm.cellChild(f.A, 5, 5).id;
    const ids = {
        edge: shape(E, f.A, 50000, -3000, 9000, 6000),
        mid: shape(E, f.A, -2000, -2000, 4000, 4000, "#a33"),
        kid: shape(E, f.A1, -1000, 0, 3000, 2000),
        b: shape(E, f.B, 0, 0, 20000, 10000, "#3a3"),
        c: shape(E, f.C, -30000, -5000, 12000, 12000),
        d: shape(E, f.D, 40000, 40000, 20000, 20000, "#33a"),
        dMid: shape(E, f.D, 0, 0, 8000, 8000),
        e: shape(E, f.F, -60000, 0, 10000, 10000),
        cam: shape(E, "1", -60, -40, 120, 80, "#999"),
    };
    E._render();
    return { f, ids };
}
const pxPerCell = (E) => E._levelPointToScreen("1", G, 0)[0] - E._levelPointToScreen("1", 0, 0)[0];
// A selection dragged by (dx, dy) cells of "1", as the pointer does it, then dropped.
function dragBy(E, ids, frames, dx, dy) {
    const s = pxPerCell(E);
    E.setTool("select");
    E._setSelection(ids, frames);
    E._dragSel = { start: [400, 300], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
    E.store.setBatch(true);
    E._dragSelection(400 + dx * s, 300 + dy * s);
    E.pointerUp();
}

// The hook saver's write, by the oracle: every frame the log forces or the store does not list is
// snapshotted (its read settles it, and that settle's entry joins the write), then the log.
async function oracleWrite(id, O, log, st, full = false) {
    const d = log.drain();
    const entries = d.entries.slice();
    const holding = () => Object.keys(O.doc.nativesByLevel);
    const want = new Set(full ? holding() : d.forced);
    const snapshots = {};
    for (let guard = 0; guard < 5; guard++) {
        for (const L of holding()) if (!(L in st.frameSeq)) want.add(L);
        for (const L of want) if (!(L in snapshots) && O.doc.nativesByLevel[L]) snapshots[L] = { ...oEncodeObjects(O.doc.at(L)), seq: log.seq };
        if (!log.queue.length) break;
        const d2 = log.drain();
        entries.push(...d2.entries);
        for (const L of d2.forced) want.add(L);
    }
    const frameIds = holding();
    for (const L of Object.keys(snapshots)) if (!frameIds.includes(L)) delete snapshots[L];
    const { natives, ...header } = O.serializeDrawing({}, { frames: [] });
    for (const L of frameIds) st.frameSeq[L] = L in snapshots ? log.seq : (st.frameSeq[L] || 0);
    st.entries.push(...entries);
    st.header = header;
    const ok = await writeCanvas2(id, { header: { ...header, name: header.meta.name, seq: log.seq }, snapshots, frameIds, entries, full, resetLog: full, dropBelow: 0, writer: null });
    expect(ok).toBe(true);
}

// The two pictures compared at the camera's frame, its parent and every frame either engine inks.
function samePictures(O, E, st, what) {
    const frames = new Set(["0", "1"]);
    for (const X of [O, E]) for (const k of Object.keys(X.doc.nativesByLevel)) if (X.doc.count(k) && O.lm.frame(k) && E.lm.frame(k)) frames.add(k);
    for (const V of [...frames].sort()) {
        const diff = comparePictures(O, E, V, st);
        if (diff) throw new Error(what + ": " + diff);
    }
    st.checks += frames.size;
}

describe("a store written before A1 C1 opens to the oracle's picture", () => {
    test("pending shifts, settle and merge entries, `moveFrames` with `settled`: loaded, undone, redone", async () => {
        const O = engine(OracleEngine);
        const { f, ids } = build(O);
        // No render until the store is written: the oracle's renders read (and so settle) every frame a
        // drag moves; here only the reads below do, where a frame the view never reached would be read.
        const render = O._render;
        O._render = () => {};
        const log = new OracleOpLog(O);
        const st = { frameSeq: {}, entries: [], header: null, items: 0, exact: 0, carried: 0, carriedExact: 0, carriedUlp: 0, maxUlp: 0, checks: 0 };
        await oracleWrite("m1", O, log, st, true);
        // 0. A's middle shape moved on its own, 0.4 W: its own table's k = 0 entry.
        dragBy(O, [ids.mid], [], 0.4, 0);
        expect(O.doc.getById(ids.mid).level).toBe(f.A);
        await oracleWrite("m1", O, log, st);                        // A snapshotted, as the move forces
        // 1. A moved 0.3 W, unread: its shift pending in the header of the write that follows.
        dragBy(O, [], [f.A], 0.3, 0);
        expect(O.lm.frame(f.A).shift).toBeTruthy();
        await oracleWrite("m1", O, log, st);
        expect(st.header.crossings.frames.find((r) => r.id === f.A).shift).toBeTruthy();
        // 2. A read: its settle carries the middle shape next door, 0.7 W past its cell's centre (a settle
        // entry, recorded on 1's op).
        O.doc.at(f.A);
        expect(O.doc.getById(ids.mid).level).not.toBe(f.A);
        // 3. C dropped on B, which holds ink: C shadows B and merges at the read (a merge entry).
        dragBy(O, [], [f.C], 1, 0);
        O.doc.at(f.B);
        expect(O.lm.frame(f.C)).toBeUndefined();
        // 4. The camera's shape moved on its own.
        dragBy(O, [ids.cam], [], 0.4, 0.25);
        // 5. D moved and read in the same tick: its `moveFrames` entry carries `settled`.
        dragBy(O, [], [f.D], -0.4, 0.2);
        O.doc.at(f.D);
        await oracleWrite("m1", O, log, st);
        // 6. F moved, never read: a pending shift in the last header.
        dragBy(O, [], [f.F], 0.2, -0.35);
        await oracleWrite("m1", O, log, st);
        const kinds = st.entries.map((e) => e.op.k);
        expect(kinds).toEqual(expect.arrayContaining(["moveFrames", "settle", "mergeFrame", "move"]));
        expect(st.entries.some((e) => e.op.k === "moveFrames" && e.op.frames.some((r) => r.settled))).toBe(true);
        expect(st.header.crossings.frames.filter((r) => r.shift).map((r) => r.id)).toContain(f.F);
        expect(st.header.version).toBe(1);   // the model before C1 wrote a pending shift under version 1

        O._render = render;
        const view = await mount("m1");
        const E = N();
        samePictures(O, E, st, "loaded");
        // Undo the six ops, then redo them, the two engines in step.
        for (let n = 0; n < 6; n++) {
            expect(O.undo()).toBe(true);
            let ok;
            act(() => { ok = E.undo(); });
            expect(ok).toBe(true);
            samePictures(O, E, st, "undo " + (n + 1));
        }
        for (let n = 0; n < 6; n++) {
            expect(O.redo()).toBe(true);
            let ok;
            act(() => { ok = E.redo(); });
            expect(ok).toBe(true);
            samePictures(O, E, st, "redo " + (n + 1));
        }
        expect(st.carried).toBeGreaterThan(0);                     // the middle shape, compared through its picture
        expect(st.carriedExact).toBe(st.carried);
        // Saved again by the composed model: its lattice carries F's shift, so version 3.
        await act(async () => { expect(await api.flushSave()).toBe(true); });
        expect((await getStoreHeader("m1")).version).toBe(3);
        act(() => view.unmount());
    });
});

describe("the file's version (PLAN §5.2 Q5)", () => {
    test("3 only while the lattice carries a shift; a version-2 reader refuses it", () => {
        const E = engine(KobinEngine);
        const { f, ids } = build(E);
        dragBy(E, [ids.cam], [], 0.4, 0);                           // an own table is not a shift
        expect(E.serializeDrawing().version).toBe(1);
        dragBy(E, [], [f.A], 0.3, 0);
        expect(E.lm.frame(f.A).shift).toBeTruthy();
        const v3 = JSON.parse(JSON.stringify(E.serializeDrawing()));
        expect(v3.version).toBe(3);
        expect(VERSION).toBe(3);
        expect(decodeDrawing(v3).crossings.frames.find((r) => r.id === f.A).shift).toEqual(E.lm.frame(f.A).shift);
        expect(READS_V2).toBe(2);
        expect(() => decodeV2(v3)).toThrow("this drawing was saved by a newer version of bound.less (file v3, app reads up to v2)");
        expect(E.undo()).toBe(true);                                  // the shift gone, version 1 again
        expect(E.lm.frame(f.A).shift).toBeFalsy();
        expect(E.serializeDrawing().version).toBe(1);
    });

    test("a drawing without a shift is written byte for byte as the model before C1 writes it", () => {
        const files = [];
        for (const Kind of [OracleEngine, KobinEngine]) {
            const E = engine(Kind);
            const { ids } = build(E);
            dragBy(E, [ids.cam], [], 0.4, 0.25);                    // an own table
            eraseGesture(E, [[330, 300], [400, 305], [470, 300]], 12);   // cut pieces: version 2
            E.flushErases();
            const d = E.serializeDrawing({ name: "same", createdAt: "2026-09-29T00:00:00.000Z" });
            d.meta.modifiedAt = "stamped at encode";
            files.push(JSON.stringify(d));
        }
        expect(JSON.parse(files[1]).version).toBe(2);
        expect(files[1]).toBe(files[0]);
    });
});
