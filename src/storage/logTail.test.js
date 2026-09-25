/**
 * F86: a kobin-2 canvas's log tail — entries past its frames' snapshots — goes with it into a
 * download, the recycle bin (a delete or a cloud tombstone), a duplicate and a backup; and a
 * canvas whose only copy is kobin-2 in the cloud can be downloaded and duplicated.
 */
import { IDBFactory } from "fake-indexeddb";
import { fake } from "../engine/__testkit__/fakeFirestore";
import { _resetDbForTests, getCanvasHeader } from "./db";
import {
    writeCanvas2, loadCanvasStore, loadCanvasDoc, trashCanvas, restoreCanvas, readTrash, duplicateCanvas,
    backupCanvasDoc, upsertIndexEntry, readIndex, purgeTrashEntry, cloudPushSource, removeCanvas,
} from "./localCanvases";
import * as local from "./localCanvases";
import { cloudPushCanvas2, cloudLoadCanvas } from "../cloud/canvasSync";
import { encodeRecords, encodeEntry } from "../engine/format2";
import KobinEngine from "../engine/KobinEngine";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));

beforeEach(() => {
    fake.reset();
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});

const stroke = (id) => ({ type: "stroke", origin: "native", id, pts: [[0, 0], [30, 20], [60, 10]], lwFrame: 2, color: "#000", opacity: 1 });
const entry = (seq) => { const e = encodeEntry({ k: "add", level: "0", index: 0, obj: stroke(100 + seq) }); return { seq, t: seq, op: e.op, geo: e.geo, touches: ["0"] }; };
const count = (doc) => Object.values(doc.natives).reduce((n, a) => n + a.length, 0);

// Frame 0's snapshot holds one stroke as of seq 1; entries 2 and 3 add a stroke each after it.
async function seedTail(id = "c1", name = "A") {
    await writeCanvas2(id, {
        header: { format: "boundless-drawing", version: 1, meta: { name }, camera: null, crossings: {}, name, strokes: 3, levels: 1, seq: 3 },
        snapshots: { 0: { ...encodeRecords([stroke(1)]), seq: 1 } }, frameIds: ["0"], entries: [entry(2), entry(3)], full: true, resetLog: true,
    });
    upsertIndexEntry({ id, name, strokes: 3, levels: 1 });
    expect((await loadCanvasStore(id)).entries.length).toBe(2);
}

test("a download holds the edits only the log has", async () => {
    await seedTail();
    expect(count(await loadCanvasDoc("c1"))).toBe(3);
});

test("delete to the bin and restore keeps the log tail and the undo history", async () => {
    await seedTail();
    await trashCanvas("c1");
    expect(readIndex().some((e) => e.id === "c1")).toBe(false);
    expect((await readTrash()).find((t) => t.id === "c1")).toMatchObject({ store: true, strokes: 3 });
    await restoreCanvas("c1");
    expect(readIndex().some((e) => e.id === "c1")).toBe(true);
    expect((await loadCanvasStore("c1")).entries.length).toBe(2);
    expect(count(await loadCanvasDoc("c1"))).toBe(3);
});

// The bin entry of a canvas trashed 31 days ago, while the canvas is back in the gallery.
function ageTrash(id) {
    const list = JSON.parse(localStorage.getItem("kobin.trash"));
    for (const t of list) if (t.id === id) t.deletedAt = new Date(Date.now() - 31 * 86400000).toISOString();
    localStorage.setItem("kobin.trash", JSON.stringify(list));
}
test("a bin entry never deletes a canvas that is back in the gallery (a tombstone undone elsewhere)", async () => {
    await seedTail();
    await trashCanvas("c1");
    upsertIndexEntry({ id: "c1", name: "A", strokes: 3, levels: 1 });   // listed again by a pull
    await purgeTrashEntry("c1");
    expect(await loadCanvasStore("c1")).not.toBeNull();
    await trashCanvas("c1");
    upsertIndexEntry({ id: "c1", name: "A", strokes: 3, levels: 1 });
    ageTrash("c1");
    await readTrash();                                                  // expired while listed: the store stays
    expect(await loadCanvasStore("c1")).not.toBeNull();
});

test("a canvas trashed again replaces its old bin entry rather than expiring over it", async () => {
    await seedTail();
    await trashCanvas("c1");
    upsertIndexEntry({ id: "c1", name: "A", strokes: 3, levels: 1 });
    ageTrash("c1");
    await trashCanvas("c1");
    expect((await readTrash()).filter((t) => t.id === "c1").length).toBe(1);
    expect((await loadCanvasStore("c1")).entries.length).toBe(2);
});

test("a duplicate carries the log tail, without the cloud lineage", async () => {
    await seedTail();
    const e = await duplicateCanvas("c1", null, "A");
    expect(e.name).toBe("A copy");
    expect(count(await loadCanvasDoc(e.id))).toBe(3);
    expect((await loadCanvasStore(e.id)).entries.length).toBe(2);      // the undo history came too
    const h = await getCanvasHeader(e.id);
    expect(h.base == null && h.writer == null).toBe(true);
});

test("a backup of a canvas that would not open is the whole store, once while it is unchanged", async () => {
    await seedTail();
    await backupCanvasDoc("c1");
    await backupCanvasDoc("c1");
    const kept = (await readTrash()).filter((t) => t.backupOf === "c1");
    expect(kept.length).toBe(1);
    expect(kept[0].store).toBe(true);
    expect((await loadCanvasStore(kept[0].id)).entries.length).toBe(2);
    await restoreCanvas(kept[0].id);
    const listed = readIndex().find((e) => e.id === kept[0].id);
    expect(listed.name).toBe("A (could not be opened)");
    expect("backupOf" in listed || "seq" in listed || "store" in listed).toBe(false);
});

test("a kobin-2 cloud copy downloads and duplicates whole", async () => {
    await seedTail();
    const src = await cloudPushSource("c1");
    await cloudPushCanvas2("u1", { id: "c1", name: "A", strokes: 3, levels: 1 }, src, { deviceId: "d1" });
    const res = await cloudLoadCanvas("u1", "c1");
    expect(count(JSON.parse(res.json))).toBe(3);
    const e = await duplicateCanvas("gone", res.json, "A");          // nothing stored here: the cloud's document
    expect(count(await loadCanvasDoc(e.id))).toBe(3);
});

test("the fold replays the tail without rendering: a detached engine's cold render is waste (F87)", async () => {
    await seedTail();
    const orig = KobinEngine.prototype._render, drawn = [];
    const render = jest.spyOn(KobinEngine.prototype, "_render").mockImplementation(function (...a) {
        drawn.push(Object.values(this.nativesByLevel).reduce((n, l) => n + l.length, 0));
        return orig.apply(this, a);
    });
    try {
        expect(count(await loadCanvasDoc("c1"))).toBe(3);
        expect(drawn.filter((n) => n > 0)).toEqual([]);   // only the new engine's empty first frame
    } finally { render.mockRestore(); }
});

// A stroke whose geometry runs outside its frame: its replay throws, as a damaged log's would.
const badEntry = (seq) => { const e = encodeEntry({ k: "add", level: "0", index: 0, obj: stroke(900 + seq) }); return { seq, t: seq, op: e.op, geo: new Float64Array(1), touches: ["0"] }; };

test("Discard of a canvas another tab put in the bin drops only its gallery row (review major 1)", async () => {
    await seedTail();
    await trashCanvas("c1");                                            // another tab's gallery, or a cloud tombstone
    await removeCanvas("c1");                                           // this tab's Discard, or its Delete of an unlisted canvas
    expect(await loadCanvasStore("c1")).not.toBeNull();
    await restoreCanvas("c1");
    expect((await loadCanvasStore("c1")).entries.length).toBe(2);
    expect(count(await loadCanvasDoc("c1"))).toBe(3);
});

test("the bin's own stores are known at once, for the editor's leave prompt (review major 1)", async () => {
    await seedTail();
    expect(local.isBinnedStore("c1")).toBe(false);
    await trashCanvas("c1");
    expect(local.isBinnedStore("c1")).toBe(true);
});

test("a canvas whose log will not replay still downloads, as its snapshots (review minor 7)", async () => {
    await writeCanvas2("c1", {
        header: { format: "boundless-drawing", version: 1, meta: { name: "A" }, camera: null, crossings: {}, name: "A", strokes: 3, levels: 1, seq: 3 },
        snapshots: { 0: { ...encodeRecords([stroke(1)]), seq: 1 } }, frameIds: ["0"], entries: [entry(2), badEntry(3)], full: true, resetLog: true,
    });
    const doc = await loadCanvasDoc("c1");
    expect(doc).not.toBeNull();
    expect(count(doc)).toBe(1);
});
