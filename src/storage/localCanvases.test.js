import {
    INDEX_KEY, LEGACY_AUTOSAVE_KEY, slotKey, trashSlotKey, newCanvasId,
    readIndex, upsertIndexEntry, removeCanvas, statsFromDoc,
    migrateLegacyAutosave, editedLabel, deletedLabel, depthLabel,
    packSlot, unpackSlot, loadCanvasRaw, saveCanvasRaw, backupCanvasSlot,
    trashCanvas, readTrash, restoreCanvas, renameCanvasLocal, thumbKey,
    purgeTrashEntry, duplicateCanvas, stashOverwrittenVersion, getDeviceId,
} from "./localCanvases";

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

beforeEach(() => localStorage.clear());

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

    test("removeCanvas drops the entry and the slot", () => {
        localStorage.setItem(slotKey("a"), "{}");
        upsertIndexEntry({ id: "a", name: "A" });
        removeCanvas("a");
        expect(readIndex()).toEqual([]);
        expect(localStorage.getItem(slotKey("a"))).toBeNull();
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
    });

    test("legacy autosave migrates once, keeps the legacy key", () => {
        const raw = JSON.stringify(sampleDoc("My drawing"));
        localStorage.setItem(LEGACY_AUTOSAVE_KEY, raw);
        const entry = migrateLegacyAutosave();
        expect(entry).not.toBeNull();
        expect(entry.name).toBe("My drawing");
        expect(entry.strokes).toBe(4);
        expect(loadCanvasRaw(entry.id)).toBe(raw); // stored compressed, reads back verbatim
        expect(localStorage.getItem(LEGACY_AUTOSAVE_KEY)).toBe(raw);
        expect(readIndex()).toHaveLength(1);
        // Second call is a no-op.
        expect(migrateLegacyAutosave()).toBeNull();
        expect(readIndex()).toHaveLength(1);
    });

    test("nothing to migrate → flag set, no entries", () => {
        expect(migrateLegacyAutosave()).toBeNull();
        expect(readIndex()).toEqual([]);
        // An autosave appearing later (e.g. /v2 harness) does not resurrect migration.
        localStorage.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(sampleDoc()));
        expect(migrateLegacyAutosave()).toBeNull();
    });

    test("blank legacy drawing is not adopted", () => {
        localStorage.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify({ natives: { 0: [] } }));
        expect(migrateLegacyAutosave()).toBeNull();
        expect(readIndex()).toEqual([]);
    });

    test("labels", () => {
        expect(editedLabel(new Date().toISOString())).toBe("Edited just now");
        expect(editedLabel(new Date(Date.now() - 3 * 3600e3).toISOString())).toBe("Edited 3 hours ago");
        expect(editedLabel("garbage")).toBe("Saved locally");
        expect(depthLabel(0)).toBe("Surface level");
        expect(depthLabel(1)).toBe("Surface level");
        expect(depthLabel(3)).toBe("3 levels deep");
    });

    test("packSlot/unpackSlot round-trip; slots store much smaller than raw", () => {
        const json = JSON.stringify(sampleDoc("Big")).repeat(50);
        const packed = packSlot(json);
        expect(unpackSlot(packed)).toBe(json);
        expect(packed.length).toBeLessThan(json.length / 2);
    });

    test("unpackSlot passes legacy plain-JSON slots through untouched", () => {
        const raw = JSON.stringify(sampleDoc("Old"));
        expect(unpackSlot(raw)).toBe(raw);
        expect(unpackSlot(null)).toBeNull();
        // A legacy slot written before compression still loads via loadCanvasRaw.
        localStorage.setItem(slotKey("legacy"), raw);
        expect(loadCanvasRaw("legacy")).toBe(raw);
    });

    test("saveCanvasRaw stores compressed; loadCanvasRaw restores; backup stashes", () => {
        const json = JSON.stringify(sampleDoc("Round trip"));
        expect(saveCanvasRaw("rt", json)).toBe(true);
        expect(localStorage.getItem(slotKey("rt")).startsWith("lz1:")).toBe(true);
        expect(loadCanvasRaw("rt")).toBe(json);
        backupCanvasSlot("rt");
        expect(localStorage.getItem(slotKey("rt") + ".bak")).toBe(localStorage.getItem(slotKey("rt")));
    });

    test("trashCanvas moves entry + slot to the bin; restoreCanvas brings both back", () => {
        const json = JSON.stringify(sampleDoc("Doomed"));
        saveCanvasRaw("d1", json);
        upsertIndexEntry({ id: "d1", name: "Doomed", strokes: 4, levels: 4, savedAt: "2026-07-01T00:00:00Z" });

        const t = trashCanvas("d1");
        expect(t.name).toBe("Doomed");
        expect(t.deletedAt).toBeTruthy();
        expect(readIndex()).toEqual([]);
        expect(localStorage.getItem(slotKey("d1"))).toBeNull();
        expect(localStorage.getItem(trashSlotKey("d1"))).not.toBeNull();
        expect(readTrash().map((e) => e.id)).toEqual(["d1"]);

        const r = restoreCanvas("d1");
        expect(r.id).toBe("d1");
        expect(readTrash()).toEqual([]);
        expect(localStorage.getItem(trashSlotKey("d1"))).toBeNull();
        expect(loadCanvasRaw("d1")).toBe(json); // slot back verbatim
        const entry = readIndex().find((e) => e.id === "d1");
        expect(entry.name).toBe("Doomed");
        expect(entry.savedAt).toBe("2026-07-01T00:00:00Z"); // original edit time survives
    });

    test("trashCanvas with no index entry uses the fallback; nothing → null", () => {
        saveCanvasRaw("scratch", JSON.stringify(sampleDoc("scratch")));
        const t = trashCanvas("scratch", { id: "scratch", name: "Scratch", strokes: 4, levels: 4 });
        expect(t.name).toBe("Scratch");
        expect(readTrash()).toHaveLength(1);
        expect(trashCanvas("ghost")).toBeNull(); // no entry, no slot, no fallback
        expect(readTrash()).toHaveLength(1);
    });

    test("cloud-only trash rows (no slot) restore without minting a broken index entry", () => {
        trashCanvas("cloudy", { id: "cloudy", name: "Cloud only" });
        expect(localStorage.getItem(trashSlotKey("cloudy"))).toBeNull();
        const r = restoreCanvas("cloudy");
        expect(r.name).toBe("Cloud only");
        expect(readTrash()).toEqual([]);
        expect(readIndex()).toEqual([]); // comes back via the cloud listing instead
    });

    test("expired trash entries purge on read (slot + thumbs included)", () => {
        saveCanvasRaw("old", JSON.stringify(sampleDoc("Old")));
        upsertIndexEntry({ id: "old", name: "Old" });
        localStorage.setItem(thumbKey("old", "cover"), JSON.stringify({ hash: "h", data: "d" }));
        trashCanvas("old");
        // Backdate the deletion past the 30-day TTL.
        const list = JSON.parse(localStorage.getItem("kobin.trash"));
        list[0].deletedAt = new Date(Date.now() - 31 * 24 * 3600e3).toISOString();
        localStorage.setItem("kobin.trash", JSON.stringify(list));

        expect(readTrash()).toEqual([]);
        expect(localStorage.getItem(trashSlotKey("old"))).toBeNull();
        expect(localStorage.getItem(thumbKey("old", "cover"))).toBeNull();
        expect(restoreCanvas("old")).toBeNull();
    });

    test("renameCanvasLocal updates the index entry and the slot's embedded meta", () => {
        saveCanvasRaw("rn", JSON.stringify(sampleDoc("Before")));
        upsertIndexEntry({ id: "rn", name: "Before", savedAt: "2026-07-01T00:00:00Z" });
        renameCanvasLocal("rn", "After", "2026-07-16T00:00:00Z");
        const entry = readIndex().find((e) => e.id === "rn");
        expect(entry.name).toBe("After");
        expect(entry.savedAt).toBe("2026-07-16T00:00:00Z");
        expect(JSON.parse(loadCanvasRaw("rn")).meta.name).toBe("After");
    });

    test("deletedLabel mirrors editedLabel wording", () => {
        expect(deletedLabel(new Date().toISOString())).toBe("Deleted just now");
        expect(deletedLabel("garbage")).toBe("Deleted");
    });

    test("purgeTrashEntry permanently removes entry, slot, and thumbs", () => {
        saveCanvasRaw("p1", JSON.stringify(sampleDoc("Purged")));
        upsertIndexEntry({ id: "p1", name: "Purged" });
        localStorage.setItem(thumbKey("p1", "cover"), JSON.stringify({ hash: "h", data: "d" }));
        trashCanvas("p1");
        purgeTrashEntry("p1");
        expect(readTrash()).toEqual([]);
        expect(localStorage.getItem(trashSlotKey("p1"))).toBeNull();
        expect(localStorage.getItem(thumbKey("p1", "cover"))).toBeNull();
        expect(restoreCanvas("p1")).toBeNull();
    });

    test("duplicateCanvas copies content under '<name> copy' with its own id + thumb", () => {
        const json = JSON.stringify(sampleDoc("Original"));
        saveCanvasRaw("o1", json);
        upsertIndexEntry({ id: "o1", name: "Original", strokes: 4, levels: 4 });
        localStorage.setItem(thumbKey("o1", "cover"), JSON.stringify({ hash: "h", data: "img" }));

        const copy = duplicateCanvas("o1");
        expect(copy).not.toBeNull();
        expect(copy.id).not.toBe("o1");
        expect(copy.name).toBe("Original copy");
        expect(copy.strokes).toBe(4);
        const copyDoc = JSON.parse(loadCanvasRaw(copy.id));
        expect(copyDoc.meta.name).toBe("Original copy");
        expect(copyDoc.natives).toEqual(sampleDoc().natives);
        expect(localStorage.getItem(thumbKey(copy.id, "cover"))).toBe(localStorage.getItem(thumbKey("o1", "cover")));
        expect(readIndex().map((e) => e.id)).toContain("o1"); // original untouched
        expect(loadCanvasRaw("o1")).toBe(json);
    });

    test("duplicateCanvas falls back to supplied json/name for cloud-only canvases", () => {
        const json = JSON.stringify(sampleDoc("untitled"));
        expect(duplicateCanvas("nope")).toBeNull();
        const copy = duplicateCanvas("nope", json, "Cloudy");
        expect(copy.name).toBe("Cloudy copy");
        expect(JSON.parse(loadCanvasRaw(copy.id)).meta.name).toBe("Cloudy copy");
    });

    test("stashOverwrittenVersion files the losing copy in the bin under a fresh id", () => {
        const json = JSON.stringify(sampleDoc("Solar System"));
        const t = stashOverwrittenVersion(json, "Solar System");
        expect(t.name).toBe("Solar System (overwritten)");
        expect(t.strokes).toBe(4);
        expect(t.deletedAt).toBeTruthy();
        expect(readTrash().map((e) => e.id)).toEqual([t.id]);
        // Restoring resurrects it as its OWN canvas with the disambiguated name.
        const r = restoreCanvas(t.id);
        expect(r.id).toBe(t.id);
        const doc = JSON.parse(loadCanvasRaw(t.id));
        expect(doc.meta.name).toBe("Solar System (overwritten)");
        expect(doc.natives).toEqual(sampleDoc().natives);
        expect(readIndex().find((e) => e.id === t.id).name).toBe("Solar System (overwritten)");
        expect(stashOverwrittenVersion("not json", "X")).toBeNull();
    });

    test("getDeviceId is stable per browser", () => {
        const a = getDeviceId();
        expect(a).toBeTruthy();
        expect(getDeviceId()).toBe(a);
    });
});
