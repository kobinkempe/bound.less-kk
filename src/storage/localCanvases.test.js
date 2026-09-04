import { IDBFactory } from "fake-indexeddb";
import {
    INDEX_KEY, LEGACY_AUTOSAVE_KEY, slotKey, thumbKey, newCanvasId,
    readIndex, upsertIndexEntry, removeCanvas, statsFromDoc, statsFromNatives,
    migrateLegacyAutosave, editedLabel, deletedLabel, depthLabel,
    packSlot, unpackSlot, loadCanvasDoc, saveCanvasDoc, writeCanvas, hasCanvasDoc, backupCanvasDoc,
    trashCanvas, readTrash, restoreCanvas, renameCanvasLocal,
    purgeTrashEntry, duplicateCanvas, stashOverwrittenVersion, getDeviceId,
    loadThumbs, saveThumbs, loadCoverThumb, migrateStorage, sweepStorage, BACKUP_TTL_MS,
} from "./localCanvases";
import {
    _resetDbForTests, getBackup, putBackup, getTrashDoc, listCanvasHeaders,
    tx, sweepThumbs, thumbBytesTotal, MIGRATED_FLAG, dataUrlToBytes, bytesToDataUrl,
} from "./db";

const sampleDoc = (name = "Sample") => ({
    format: "boundless-drawing",
    version: 1,
    meta: { name },
    camera: { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 },
    crossings: {},
    natives: {
        "-1": [{ type: "stroke", id: 1, pts: [[0, 0]], lwFrame: 1 }],
        0: [
            { type: "stroke", id: 2, pts: [[0, 0]], lwFrame: 1 },
            { type: "stroke", id: 3, pts: [[1, 1]], lwFrame: 1 },
        ],
        2: [{ type: "stroke", id: 4, pts: [[2, 2]], lwFrame: 1 }],
        5: [],
    },
});

// A 1x1 white JPEG is overkill; the store only needs bytes it can round-trip.
const jpeg = (fill = "A", n = 60) => "data:image/jpeg;base64," + btoa(fill.repeat(n));

beforeEach(() => {
    localStorage.clear();
    // A fresh database per test: the module caches its connection, so drop that too.
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});

describe("localCanvases", () => {
    test("ids are unique enough", () => {
        const ids = new Set(Array.from({ length: 200 }, newCanvasId));
        expect(ids.size).toBe(200);
    });

    test("index upsert replaces by id and sorts newest first", () => {
        upsertIndexEntry({ id: "a", name: "A", savedAt: "2026-01-01T00:00:00Z" });
        upsertIndexEntry({ id: "b", name: "B", savedAt: "2026-06-01T00:00:00Z" });
        upsertIndexEntry({ id: "a", name: "A2", savedAt: "2026-07-01T00:00:00Z" });
        const list = readIndex();
        expect(list.map((e) => e.id)).toEqual(["a", "b"]);
        expect(list[0].name).toBe("A2");
    });

    test("removeCanvas drops the entry and the document", async () => {
        await saveCanvasDoc("a", sampleDoc());
        upsertIndexEntry({ id: "a", name: "A" });
        await removeCanvas("a");
        expect(readIndex()).toEqual([]);
        expect(await loadCanvasDoc("a")).toBeNull();
        expect(await hasCanvasDoc("a")).toBe(false);
    });

    test("readIndex survives garbage", () => {
        localStorage.setItem(INDEX_KEY, "not json");
        expect(readIndex()).toEqual([]);
        localStorage.setItem(INDEX_KEY, JSON.stringify({ nope: 1 }));
        expect(readIndex()).toEqual([]);
    });

    test("statsFromDoc counts strokes and spans levels (incl. negatives, skipping empties)", () => {
        expect(statsFromDoc(sampleDoc())).toEqual({ strokes: 4, levels: 4 }); // -1..2
        expect(statsFromDoc({ natives: {} })).toEqual({ strokes: 0, levels: 0 });
        expect(statsFromDoc(null)).toEqual({ strokes: 0, levels: 0 });
        expect(statsFromNatives(sampleDoc().natives)).toEqual({ strokes: 4, levels: 4 });
    });

    test("legacy autosave migrates once, keeps the legacy key", async () => {
        const raw = JSON.stringify(sampleDoc("My drawing"));
        localStorage.setItem(LEGACY_AUTOSAVE_KEY, raw);
        const entry = await migrateLegacyAutosave();
        expect(entry).not.toBeNull();
        expect(entry.name).toBe("My drawing");
        expect(entry.strokes).toBe(4);
        expect(await loadCanvasDoc(entry.id)).toEqual(JSON.parse(raw));
        expect(localStorage.getItem(LEGACY_AUTOSAVE_KEY)).toBe(raw);
        expect(readIndex()).toHaveLength(1);
        // Second call is a no-op.
        expect(await migrateLegacyAutosave()).toBeNull();
        expect(readIndex()).toHaveLength(1);
    });

    test("nothing to migrate → flag set, no entries", async () => {
        expect(await migrateLegacyAutosave()).toBeNull();
        expect(readIndex()).toEqual([]);
        // An autosave appearing later does not resurrect migration.
        localStorage.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(sampleDoc()));
        expect(await migrateLegacyAutosave()).toBeNull();
    });

    test("blank legacy drawing is not adopted", async () => {
        localStorage.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify({ natives: { 0: [] } }));
        expect(await migrateLegacyAutosave()).toBeNull();
        expect(readIndex()).toEqual([]);
    });

    test("labels", () => {
        expect(editedLabel(new Date().toISOString())).toBe("Edited just now");
        expect(editedLabel(new Date(Date.now() - 3 * 3600e3).toISOString())).toBe("Edited 3 hours ago");
        expect(editedLabel("garbage")).toBe("Saved locally");
        expect(depthLabel(0)).toBe("Surface level");
        expect(depthLabel(1)).toBe("Surface level");
        expect(depthLabel(3)).toBe("3 levels deep");
        expect(deletedLabel(new Date().toISOString())).toBe("Deleted just now");
        expect(deletedLabel("garbage")).toBe("Deleted");
    });

    test("packSlot/unpackSlot still read the old slots; legacy plain JSON passes through", () => {
        const json = JSON.stringify(sampleDoc("Big")).repeat(50);
        const packed = packSlot(json);
        expect(unpackSlot(packed)).toBe(json);
        expect(packed.length).toBeLessThan(json.length / 2);
        const raw = JSON.stringify(sampleDoc("Old"));
        expect(unpackSlot(raw)).toBe(raw);
        expect(unpackSlot(null)).toBeNull();
    });

    // ---- documents: whole and per frame ----

    test("saveCanvasDoc / loadCanvasDoc round-trip a document, numbers as numbers", async () => {
        const doc = sampleDoc("Round trip");
        doc.natives[0][0].pts = [[0.1 + 0.2, 1e-7], [123456.789012345, -3]];
        expect(await saveCanvasDoc("rt", doc)).toBe(true);
        const back = await loadCanvasDoc("rt");
        expect(back).toEqual(doc);
        expect(back.natives[0][0].pts[0][0]).toBe(0.1 + 0.2); // bit-exact, no text in between
        expect(back).not.toBe(doc);
    });

    test("writeCanvas: an incremental write touches only the frames it names and drops the ones that left", async () => {
        const doc = sampleDoc("Inc");
        await saveCanvasDoc("inc", doc);
        // Frame 0 edited, frame 2 gone, frame 7 new; -1 and 5 untouched.
        const edited = [{ type: "stroke", id: 2, pts: [[9, 9]], lwFrame: 1 }];
        const fresh = [{ type: "stroke", id: 9, pts: [[7, 7]], lwFrame: 1 }];
        const { natives, ...header } = doc;
        const ok = await writeCanvas("inc", {
            header: { ...header, name: "Inc" },
            frames: { 0: edited, 7: fresh },
            frameIds: ["-1", "0", "5", "7"],
            full: false,
        });
        expect(ok).toBe(true);
        const back = await loadCanvasDoc("inc");
        expect(Object.keys(back.natives).sort()).toEqual(["-1", "0", "5", "7"]);
        expect(back.natives[0]).toEqual(edited);
        expect(back.natives[7]).toEqual(fresh);
        expect(back.natives["-1"]).toEqual(doc.natives["-1"]);
        expect(back.natives[2]).toBeUndefined();
    });

    test("writeCanvas refuses an incremental write with no base record", async () => {
        const { natives, ...header } = sampleDoc("NoBase");
        const ok = await writeCanvas("nobase", { header, frames: { 0: natives[0] }, frameIds: ["0"], full: false });
        expect(ok).toBe(false);
        expect(await loadCanvasDoc("nobase")).toBeNull();
        // The full write goes through and a later incremental one then works.
        expect(await writeCanvas("nobase", { header, frames: natives, frameIds: Object.keys(natives), full: true })).toBe(true);
        expect(await writeCanvas("nobase", { header, frames: {}, frameIds: Object.keys(natives), full: false })).toBe(true);
        expect(await loadCanvasDoc("nobase")).toEqual(sampleDoc("NoBase"));
    });

    test("a full write makes the stored frame set match exactly", async () => {
        await saveCanvasDoc("f", sampleDoc());
        const small = { ...sampleDoc(), natives: { 0: sampleDoc().natives[0] } };
        await saveCanvasDoc("f", small);
        expect(Object.keys((await loadCanvasDoc("f")).natives)).toEqual(["0"]);
    });

    test("backupCanvasDoc keeps a copy; sweepStorage drops it after a week", async () => {
        await saveCanvasDoc("b", sampleDoc("Backed"));
        upsertIndexEntry({ id: "b", name: "Backed" });
        await backupCanvasDoc("b");
        expect(await getBackup("b")).toEqual(sampleDoc("Backed"));
        await sweepStorage();
        expect(await getBackup("b")).not.toBeNull(); // fresh: kept
        await putBackup("b", sampleDoc("Backed"), new Date(Date.now() - BACKUP_TTL_MS - 1000).toISOString());
        const out = await sweepStorage();
        expect(out.backups).toBe(1);
        expect(await getBackup("b")).toBeNull();
    });

    // ---- recycle bin ----

    test("trashCanvas moves entry + document to the bin; restoreCanvas brings both back", async () => {
        await saveCanvasDoc("d1", sampleDoc("Doomed"));
        upsertIndexEntry({ id: "d1", name: "Doomed", strokes: 4, levels: 4, savedAt: "2026-07-01T00:00:00Z" });

        const t = await trashCanvas("d1");
        expect(t.name).toBe("Doomed");
        expect(t.deletedAt).toBeTruthy();
        expect(readIndex()).toEqual([]);
        expect(await loadCanvasDoc("d1")).toBeNull();
        expect(await getTrashDoc("d1")).toEqual(sampleDoc("Doomed"));
        expect((await readTrash()).map((e) => e.id)).toEqual(["d1"]);

        const r = await restoreCanvas("d1");
        expect(r.id).toBe("d1");
        expect(await readTrash()).toEqual([]);
        expect(await getTrashDoc("d1")).toBeNull();
        expect(await loadCanvasDoc("d1")).toEqual(sampleDoc("Doomed")); // back verbatim
        const entry = readIndex().find((e) => e.id === "d1");
        expect(entry.name).toBe("Doomed");
        expect(entry.savedAt).toBe("2026-07-01T00:00:00Z"); // original edit time survives
    });

    test("trashCanvas with no index entry uses the fallback; nothing → null", async () => {
        await saveCanvasDoc("scratch", sampleDoc("scratch"));
        const t = await trashCanvas("scratch", { id: "scratch", name: "Scratch", strokes: 4, levels: 4 });
        expect(t.name).toBe("Scratch");
        expect(await readTrash()).toHaveLength(1);
        expect(await trashCanvas("ghost")).toBeNull(); // no entry, no document, no fallback
        expect(await readTrash()).toHaveLength(1);
    });

    test("cloud-only trash rows (no document) restore without minting a broken index entry", async () => {
        await trashCanvas("cloudy", { id: "cloudy", name: "Cloud only" });
        expect(await getTrashDoc("cloudy")).toBeNull();
        const r = await restoreCanvas("cloudy");
        expect(r.name).toBe("Cloud only");
        expect(await readTrash()).toEqual([]);
        expect(readIndex()).toEqual([]); // comes back via the cloud listing instead
    });

    test("expired trash entries purge on read (document + thumbs included)", async () => {
        await saveCanvasDoc("old", sampleDoc("Old"));
        upsertIndexEntry({ id: "old", name: "Old" });
        await saveThumbs("old", { cover: { hash: "h", data: jpeg() } });
        await trashCanvas("old");
        // Backdate the deletion past the 30-day TTL.
        const list = JSON.parse(localStorage.getItem("kobin.trash"));
        list[0].deletedAt = new Date(Date.now() - 31 * 24 * 3600e3).toISOString();
        localStorage.setItem("kobin.trash", JSON.stringify(list));

        expect(await readTrash()).toEqual([]);
        expect(await getTrashDoc("old")).toBeNull();
        expect(await loadCoverThumb("old")).toBeNull();
        expect(await restoreCanvas("old")).toBeNull();
    });

    test("renameCanvasLocal updates the index entry and the stored meta", async () => {
        await saveCanvasDoc("rn", sampleDoc("Before"));
        upsertIndexEntry({ id: "rn", name: "Before", savedAt: "2026-07-01T00:00:00Z" });
        await renameCanvasLocal("rn", "After", "2026-07-16T00:00:00Z");
        const entry = readIndex().find((e) => e.id === "rn");
        expect(entry.name).toBe("After");
        expect(entry.savedAt).toBe("2026-07-16T00:00:00Z");
        expect((await loadCanvasDoc("rn")).meta.name).toBe("After");
        expect((await loadCanvasDoc("rn")).natives).toEqual(sampleDoc().natives); // frames untouched
    });

    test("purgeTrashEntry permanently removes entry, document, and thumbs", async () => {
        await saveCanvasDoc("p1", sampleDoc("Purged"));
        upsertIndexEntry({ id: "p1", name: "Purged" });
        await saveThumbs("p1", { cover: { hash: "h", data: jpeg() } });
        await trashCanvas("p1");
        await purgeTrashEntry("p1");
        expect(await readTrash()).toEqual([]);
        expect(await getTrashDoc("p1")).toBeNull();
        expect(await loadCoverThumb("p1")).toBeNull();
        expect(await restoreCanvas("p1")).toBeNull();
    });

    test("duplicateCanvas copies content under '<name> copy' with its own id + thumb", async () => {
        await saveCanvasDoc("o1", sampleDoc("Original"));
        upsertIndexEntry({ id: "o1", name: "Original", strokes: 4, levels: 4 });
        await saveThumbs("o1", { cover: { hash: "h", data: jpeg("B") } });

        const copy = await duplicateCanvas("o1");
        expect(copy).not.toBeNull();
        expect(copy.id).not.toBe("o1");
        expect(copy.name).toBe("Original copy");
        expect(copy.strokes).toBe(4);
        const copyDoc = await loadCanvasDoc(copy.id);
        expect(copyDoc.meta.name).toBe("Original copy");
        expect(copyDoc.natives).toEqual(sampleDoc().natives);
        expect(await loadCoverThumb(copy.id)).toBe(await loadCoverThumb("o1"));
        expect(readIndex().map((e) => e.id)).toContain("o1"); // original untouched
        expect(await loadCanvasDoc("o1")).toEqual(sampleDoc("Original"));
    });

    test("duplicateCanvas falls back to a supplied document (or its JSON) for cloud-only canvases", async () => {
        const json = JSON.stringify(sampleDoc("untitled"));
        expect(await duplicateCanvas("nope")).toBeNull();
        const copy = await duplicateCanvas("nope", json, "Cloudy");
        expect(copy.name).toBe("Cloudy copy");
        expect((await loadCanvasDoc(copy.id)).meta.name).toBe("Cloudy copy");
        const copy2 = await duplicateCanvas("nope", sampleDoc("Given"));
        expect(copy2.name).toBe("Given copy");
    });

    test("stashOverwrittenVersion files the losing copy in the bin under a fresh id", async () => {
        const t = await stashOverwrittenVersion(sampleDoc("Solar System"), "Solar System");
        expect(t.name).toBe("Solar System (overwritten)");
        expect(t.strokes).toBe(4);
        expect(t.deletedAt).toBeTruthy();
        expect((await readTrash()).map((e) => e.id)).toEqual([t.id]);
        // Restoring resurrects it as its OWN canvas with the disambiguated name.
        const r = await restoreCanvas(t.id);
        expect(r.id).toBe(t.id);
        const doc = await loadCanvasDoc(t.id);
        expect(doc.meta.name).toBe("Solar System (overwritten)");
        expect(doc.natives).toEqual(sampleDoc().natives);
        expect(readIndex().find((e) => e.id === t.id).name).toBe("Solar System (overwritten)");
        expect(await stashOverwrittenVersion("not json", "X")).toBeNull();
    });

    test("getDeviceId is stable per browser", () => {
        const a = getDeviceId();
        expect(a).toBeTruthy();
        expect(getDeviceId()).toBe(a);
    });

    // ---- thumbnails ----

    test("data URL <-> bytes round-trips, and the store hands back the same data URL", async () => {
        const url = jpeg("Q", 30);
        const b = dataUrlToBytes(url);
        expect(b.type).toBe("image/jpeg");
        expect(bytesToDataUrl(b.type, b.bytes)).toBe(url);
        expect(dataUrlToBytes("garbage")).toBeNull();
        await saveThumbs("c", { s1: { hash: "h1", data: url }, s2: { hash: "h2", data: jpeg("R") }, bad: { hash: "x", data: 42 } });
        const got = await loadThumbs("c", ["s1", "s2", "s3"]);
        expect(Object.keys(got).sort()).toEqual(["s1", "s2"]);
        expect(got.s1).toEqual({ hash: "h1", data: url });
        expect(await loadThumbs("c", [])).toEqual({});
    });

    test("thumbnails are evicted least-recently-used first under a budget; other canvases' thumbs are swept", async () => {
        await saveThumbs("keep", { a: { hash: "a", data: jpeg("A", 60) } }); // 60 bytes each
        await saveThumbs("keep", { b: { hash: "b", data: jpeg("B", 60) } });
        await saveThumbs("keep", { c: { hash: "c", data: jpeg("C", 60) } });
        await saveThumbs("gone", { z: { hash: "z", data: jpeg("Z", 60) } });
        expect(await thumbBytesTotal()).toBe(4 * 60);
        // Reading `a` makes it the most recently used; `b` is now the oldest.
        await new Promise((r) => setTimeout(r, 5));
        await loadThumbs("keep", ["a"]);
        const n = await sweepThumbs(["keep"], 2 * 60);
        expect(n).toBe(2); // "gone"'s thumb, then the LRU one
        const left = await loadThumbs("keep", ["a", "b", "c"]);
        expect(Object.keys(left).sort()).toEqual(["a", "c"]);
        expect(await loadThumbs("gone", ["z"])).toEqual({});
    });

    // ---- the move out of localStorage ----

    test("migrateStorage moves documents, trash and thumbs to the database and deletes the old keys", async () => {
        const docA = sampleDoc("A"), docB = sampleDoc("B"), docT = sampleDoc("T");
        localStorage.setItem(slotKey("a"), packSlot(JSON.stringify(docA)));   // compressed slot
        localStorage.setItem(slotKey("b"), JSON.stringify(docB));             // pre-compression plain slot
        localStorage.setItem(slotKey("a") + ".bak", packSlot(JSON.stringify(docA)));
        localStorage.setItem("kobin.trash.t", packSlot(JSON.stringify(docT)));
        localStorage.setItem(thumbKey("a", "cover"), JSON.stringify({ hash: "h", data: jpeg("A") }));
        localStorage.setItem(thumbKey("a", "s1"), JSON.stringify({ hash: "h1", data: jpeg("B") }));
        localStorage.setItem("boundlessDrawing:x", "{}");
        localStorage.setItem("kobinSnapshot", "{}");
        localStorage.setItem(LEGACY_AUTOSAVE_KEY, "{}");
        localStorage.setItem(slotKey("broken"), "lz1:not really");
        upsertIndexEntry({ id: "a", name: "A" });

        const out = await migrateStorage();
        expect(out.canvases).toBe(2);
        expect(out.trash).toBe(1);
        expect(out.thumbs).toBe(2);
        expect(await loadCanvasDoc("a")).toEqual(docA);
        expect(await loadCanvasDoc("b")).toEqual(docB);
        expect(await getTrashDoc("t")).toEqual(docT);
        expect(await loadCoverThumb("a")).toBe(jpeg("A"));
        expect((await loadThumbs("a", ["s1"])).s1.hash).toBe("h1");
        for (const k of [slotKey("a"), slotKey("b"), slotKey("a") + ".bak", "kobin.trash.t",
            thumbKey("a", "cover"), thumbKey("a", "s1"), "boundlessDrawing:x", "kobinSnapshot"]) {
            expect(localStorage.getItem(k)).toBeNull();
        }
        expect(localStorage.getItem(LEGACY_AUTOSAVE_KEY)).toBe("{}");          // left alone on purpose
        expect(localStorage.getItem(slotKey("broken"))).toBe("lz1:not really"); // unreadable: kept, named
        expect(out.failed).toEqual([slotKey("broken")]);
        expect(localStorage.getItem(MIGRATED_FLAG)).toBeTruthy();
        expect(readIndex().map((e) => e.id)).toEqual(["a"]);
        // Once only.
        localStorage.setItem(slotKey("c"), JSON.stringify(sampleDoc("C")));
        expect(await migrateStorage()).toEqual({ skipped: true });
        expect(localStorage.getItem(slotKey("c"))).not.toBeNull();
    });

    // ---- the sweep ----

    test("sweepStorage adopts a drawn-on orphan, deletes an empty one, and clears orphan frames and thumbs", async () => {
        await saveCanvasDoc("listed", sampleDoc("Listed"));
        upsertIndexEntry({ id: "listed", name: "Listed" });
        await saveCanvasDoc("orphan", sampleDoc("Somebody's work"));   // drawn on, never indexed
        await saveCanvasDoc("empty", { ...sampleDoc("Empty"), natives: { 0: [] } });
        await saveCanvasDoc("binned", sampleDoc("Binned"));
        upsertIndexEntry({ id: "binned", name: "Binned" });
        await trashCanvas("binned");
        await saveThumbs("listed", { cover: { hash: "h", data: jpeg("L") } });
        await saveThumbs("nobody", { cover: { hash: "h", data: jpeg("N") } });
        // A frame record with no header, as a torn delete would leave.
        await tx(["frames"], "readwrite", (f) => { f.put({ canvasId: "ghost", frameId: "0", objects: [] }); });

        const out = await sweepStorage();
        expect(out).toMatchObject({ adopted: 1, deleted: 1, orphanFrames: 1, thumbs: 1 });
        const ids = readIndex().map((e) => e.id).sort();
        expect(ids).toEqual(["listed", "orphan"]);
        expect(readIndex().find((e) => e.id === "orphan").name).toBe("Somebody's work");
        expect(await loadCanvasDoc("empty")).toBeNull();
        expect(await loadCanvasDoc("orphan")).toEqual(sampleDoc("Somebody's work"));
        expect((await listCanvasHeaders()).map((h) => h.id).sort()).toEqual(["listed", "orphan"]);
        expect(await getTrashDoc("binned")).toEqual(sampleDoc("Binned")); // the bin is not the sweep's business
        expect(await loadCoverThumb("listed")).not.toBeNull();
        expect(await loadCoverThumb("nobody")).toBeNull();
        // Idempotent.
        expect(await sweepStorage()).toEqual({ adopted: 0, deleted: 0, orphanFrames: 0, backups: 0, thumbs: 0 });
    });
});
