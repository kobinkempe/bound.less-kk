import {
    INDEX_KEY, LEGACY_AUTOSAVE_KEY, slotKey, newCanvasId,
    readIndex, upsertIndexEntry, removeCanvas, statsFromDoc,
    migrateLegacyAutosave, editedLabel, depthLabel,
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
        expect(localStorage.getItem(slotKey(entry.id))).toBe(raw);
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
});
