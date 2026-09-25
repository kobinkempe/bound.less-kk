/**
 * The local store's side of SYNC-PLAN R1/R3/R4/R5: the sync fields ride every saver write, a
 * whole-document write has no lineage, a pull is written whole or as a fast-forward, and a
 * conflict's copy is the whole store under a new id without the cloud lineage.
 */
import { IDBFactory } from "fake-indexeddb";
import { _resetDbForTests, getCanvasHeader, getCanvas2Chunked } from "./db";
import {
    writeCanvas2, loadCanvasStore, saveCanvasDoc, setSyncState, applyPulledStore, forkCanvas,
    cloudPushSource, readIndex, upsertIndexEntry, claimStore, stashCanvasStore, readTrash, restoreCanvas,
    purgeTrashEntry, renameCanvasLocal,
} from "./localCanvases";
import { encodeRecords, encodeEntry } from "../engine/format2";

beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});

const shape = (id, x = 0) => ({ type: "shape", origin: "native", id, loops: [[x, 0, 1, x + 10, 0, 1, x + 10, 10, 1, x, 10, 1, x, 0]], color: "#123456", opacity: 1, w: 3 });
const stroke = (id) => ({ type: "stroke", origin: "native", id, pts: [[0, 0], [1, 2], [3, 3]], lwFrame: 2, color: "#000", opacity: 1 });
const header = (seq, over = {}) => ({ format: "boundless-drawing", version: 1, meta: { name: "A" }, camera: null, crossings: {}, name: "A", strokes: 2, levels: 1, seq, ...over });
const entry = (seq) => { const e = encodeEntry({ k: "add", level: "0", index: 0, obj: stroke(100 + seq) }); return { seq, t: seq, op: e.op, geo: e.geo, touches: ["0"] }; };
async function seed(id, seq = 3) {
    const f = encodeRecords([shape(1), shape(2, 20)]);
    await writeCanvas2(id, { header: header(seq), snapshots: { 0: { ...f, seq } }, frameIds: ["0"], entries: [entry(1), entry(2), entry(3)].filter((e) => e.seq <= seq), full: true, resetLog: true });
}
const BASE = { epoch: "eA", seq: 3, col: "dev-canvases" };

test("a fast-forward pull drops the local entries below the cloud's log floor (REVIEWER-3 SAVE-3)", async () => {
    await seed("c1", 3);
    const pulledHeader = { ...header(12), frameSeq: { 0: 3 }, frameIds: ["0"] };
    await applyPulledStore("c1", { full: false, header: pulledHeader, frames: {}, entries: [entry(10), entry(11), entry(12)], logFloor: 10 },
        { epoch: "eB", seq: 12, col: "dev-canvases" });
    const s = await loadCanvasStore("c1");
    expect(s.entries.map((e) => e.seq)).toEqual([10, 11, 12]);          // red: 1, 2, 3 kept, 4..9 never seen
});

test("the sync fields ride the saver's writes, which never name them", async () => {
    await seed("c1");
    await setSyncState("c1", { base: BASE, pending: [{ chunk: "l_4_4_eA", parts: 1 }], intent: null });
    await writeCanvas2("c1", { header: header(4), frameIds: ["0"], entries: [entry(4)] });
    await writeCanvas2("c1", { header: header(4), snapshots: { 0: { ...encodeRecords([shape(1)]), seq: 4 } }, frameIds: ["0"], full: true });
    const h = await getCanvasHeader("c1");
    expect(h.base).toEqual(BASE);
    expect(h.pending).toEqual([{ chunk: "l_4_4_eA", parts: 1 }]);
    expect(h.seq).toBe(4);
    const src = await cloudPushSource("c1");
    await src.setSync({ base: { ...BASE, seq: 4 }, pending: [] });
    expect((await getCanvasHeader("c1")).base.seq).toBe(4);
});

test("a push source is alive until another tab claims the store", async () => {
    await seed("c1");
    await claimStore("c1", "tabA.1");
    const src = await cloudPushSource("c1", "tabA.1");
    expect(await src.alive()).toBe(true);
    await claimStore("c1", "tabB.1");
    expect(await src.alive()).toBe(false);
});

test("a document written whole has no cloud lineage", async () => {
    await seed("c1");
    await setSyncState("c1", { base: BASE });
    await saveCanvasDoc("c1", { format: "boundless-drawing", version: 1, meta: { name: "A" }, camera: null, crossings: {}, natives: { 0: [shape(9)] } });
    const h = await getCanvasHeader("c1");
    expect(h.base).toBe(null);
    expect(h.seq).toBe(0);
});

test("a fast-forward pull appends the entries and replaces only the frames it fetched; a whole one replaces the log", async () => {
    await seed("c1", 3);
    const f1 = encodeRecords([shape(5, 50)]);
    const pulledHeader = { ...header(6), frameSeq: { 0: 3, 1: 6 }, frameIds: ["0", "1"] };
    const ok = await applyPulledStore("c1", { full: false, header: pulledHeader, frames: { 1: { ...f1, seq: 6 } }, entries: [entry(4), entry(5), entry(6)] }, { epoch: "eB", seq: 6, col: "dev-canvases" });
    expect(ok).toBe(true);
    const s = await loadCanvasStore("c1");
    expect(s.header.seq).toBe(6);
    expect(s.header.frameSeq).toEqual({ 0: 3, 1: 6 });
    expect(s.header.base).toEqual({ epoch: "eB", seq: 6, col: "dev-canvases" });
    expect(s.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Object.keys(s.frames).sort()).toEqual(["0", "1"]);
    await applyPulledStore("c1", { full: true, header: { ...header(9), frameIds: ["1"] }, frames: { 1: { ...f1, seq: 9 } }, entries: [entry(9)] }, { epoch: "eC", seq: 9, col: "dev-canvases" });
    const w = await loadCanvasStore("c1");
    expect(w.entries.map((e) => e.seq)).toEqual([9]);
    expect(Object.keys(w.frames)).toEqual(["1"]);
});

test("a conflict's copy is the whole store under a new id, without the cloud lineage, listed in the gallery", async () => {
    await seed("c1", 3);
    await setSyncState("c1", { base: BASE, pending: [{ chunk: "x", parts: 1 }] });
    upsertIndexEntry({ id: "c1", name: "A", strokes: 2, levels: 1 });
    const e = await forkCanvas("c1", "A — edits from Chrome on Windows, Sep 22");
    expect(e.id).not.toBe("c1");
    expect(readIndex().map((x) => x.id).sort()).toEqual(["c1", e.id].sort());
    const copy = await loadCanvasStore(e.id), orig = await loadCanvasStore("c1");
    expect(copy.header.name).toBe("A — edits from Chrome on Windows, Sep 22");
    expect(copy.header.meta.name).toBe("A — edits from Chrome on Windows, Sep 22");
    expect(copy.header.base).toBeUndefined();
    expect(copy.header.pending).toBeUndefined();
    expect(copy.entries.map((x) => x.seq)).toEqual(orig.entries.map((x) => x.seq));
    expect(Array.from(copy.frames[0].geo)).toEqual(Array.from(orig.frames[0].geo));
    expect(orig.header.base).toEqual(BASE);
});

describe("the store is fenced by the tab holding the pen (review major 1)", () => {
    test("after another tab claims the store, this tab's writes are refused and change nothing", async () => {
        await seed("c1", 3);
        await claimStore("c1", "tabA.1");
        expect(await writeCanvas2("c1", { header: header(4), frameIds: ["0"], entries: [entry(4)], writer: "tabA.1" })).toBe(true);
        await claimStore("c1", "tabB.1");
        const before = await loadCanvasStore("c1");
        expect(await writeCanvas2("c1", { header: header(5), frameIds: ["0"], entries: [entry(5)], writer: "tabA.1" })).toBe("fenced");
        expect(await setSyncState("c1", { base: BASE }, "tabA.1")).toBe("fenced");
        const pulled = { full: false, header: { ...header(9), frameSeq: { 0: 3 }, frameIds: ["0"] }, frames: {}, entries: [entry(9)] };
        expect(await applyPulledStore("c1", pulled, BASE, "tabA.1")).toBe("fenced");
        const after = await loadCanvasStore("c1");
        expect(after.header.seq).toBe(before.header.seq);
        expect(after.entries.map((e) => e.seq)).toEqual(before.entries.map((e) => e.seq));
        expect(after.header.base).toBe(before.header.base);
        // The holder writes; the gallery (no token) may rename.
        expect(await writeCanvas2("c1", { header: header(5), frameIds: ["0"], entries: [entry(5)], writer: "tabB.1" })).toBe(true);
        await renameCanvasLocal("c1", "Renamed");
        expect((await loadCanvasStore("c1")).header.name).toBe("Renamed");
        // A write that names no writer keeps the store's: the fence stands.
        expect(await writeCanvas2("c1", { header: header(6), frameIds: ["0"], entries: [entry(6)] })).toBe(true);
        expect(await writeCanvas2("c1", { header: header(7), frameIds: ["0"], entries: [entry(7)], writer: "tabA.1" })).toBe("fenced");
    });

    test("an incremental write behind the stored seq is refused: a stale document must not delete frames a pull added (review major 2)", async () => {
        await seed("c1", 3);
        const f1 = encodeRecords([shape(5, 50)]);
        await applyPulledStore("c1", { full: false, header: { ...header(6), frameSeq: { 0: 3, 1: 6 }, frameIds: ["0", "1"] }, frames: { 1: { ...f1, seq: 6 } }, entries: [entry(4), entry(5), entry(6)] }, { epoch: "eB", seq: 6, col: "dev-canvases" });
        // The engine still holds the pre-pull document: one frame, seq 3; a camera save of its header.
        expect(await writeCanvas2("c1", { header: header(3), frameIds: ["0"], entries: [] })).toBe("stale");
        const s = await loadCanvasStore("c1");
        expect(Object.keys(s.frames).sort()).toEqual(["0", "1"]);
        expect(s.header.seq).toBe(6);
    });

    test("pending chunk lists change inside one transaction, so two changes at once both land", async () => {
        await seed("c1", 3);
        await Promise.all([
            setSyncState("c1", { addPending: [{ chunk: "a", parts: 1 }] }),
            setSyncState("c1", { addPending: [{ chunk: "b", parts: 2 }] }),
        ]);
        expect((await loadCanvasStore("c1")).header.pending.map((c) => c.chunk).sort()).toEqual(["a", "b"]);
        await setSyncState("c1", { dropPending: ["a"] });
        expect((await loadCanvasStore("c1")).header.pending).toEqual([{ chunk: "b", parts: 2 }]);
    });
});

describe("whole-canvas reads in short transactions (review: the origin-wide blocking)", () => {
    test("a write landing between the chunks is not read half: the read starts over", async () => {
        await seed("c1", 3);
        const f1 = encodeRecords([shape(5, 50)]);
        await writeCanvas2("c1", { header: header(4), snapshots: { 1: { ...f1, seq: 4 } }, frameIds: ["0", "1"], entries: [entry(4)] });
        let wrote = false;
        const r = await getCanvas2Chunked("c1", { onChunk: async () => {
            if (wrote) return;
            wrote = true;
            await writeCanvas2("c1", { header: header(5), snapshots: { 0: { ...encodeRecords([shape(9, 90)]), seq: 5 } }, frameIds: ["0", "1"], entries: [entry(5)] });
        } });
        expect(r.header.seq).toBe(5);
        expect(r.frames.find((f) => f.frameId === "0").seq).toBe(5);
        expect(r.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
        const whole = await loadCanvasStore("c1");
        expect(Object.keys(whole.frames).sort()).toEqual(["0", "1"]);
        expect(whole.header.seq).toBe(5);
    });
});

describe("the recycle-bin stash is a copy of the store (review minor 8)", () => {
    test("stashed, listed in the bin, restored whole; purging deletes the copy", async () => {
        await seed("c1", 3);
        upsertIndexEntry({ id: "c1", name: "A", strokes: 2, levels: 1 });
        const t = await stashCanvasStore("c1", "A");
        expect(t).toBeTruthy();
        expect(t.name).toBe("A (overwritten)");
        expect((await readTrash()).map((e) => e.id)).toContain(t.id);
        expect(readIndex().map((e) => e.id)).toEqual(["c1"]);
        const copy = await loadCanvasStore(t.id);
        expect(copy.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
        expect(copy.header.base).toBeUndefined();
        await restoreCanvas(t.id);
        expect(readIndex().map((e) => e.id).sort()).toEqual(["c1", t.id].sort());
        expect((await loadCanvasStore(t.id)).header.seq).toBe(3);
        const t2 = await stashCanvasStore("c1", "A");
        await purgeTrashEntry(t2.id);
        expect(await loadCanvasStore(t2.id)).toBe(null);
        expect((await loadCanvasStore("c1")).header.seq).toBe(3);
    });
});
