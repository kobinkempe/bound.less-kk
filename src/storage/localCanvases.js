/**
 * Local, per-browser canvas store.
 *
 * Each canvas gets its own autosave slot (`kobin.canvas.<id>`, kobin-1 JSON);
 * an index (`kobin.canvases`) makes explicitly saved canvases enumerable for
 * the gallery. Unsaved canvases still autosave to their slot (so reload never
 * loses work) but only indexed canvases are listed.
 *
 * The pre-multi-canvas app kept one drawing in `kobinAutosave`; on first
 * gallery visit that drawing is migrated into a slot + index entry. The legacy
 * key is left in place both as a safety net and because the /v2 dev harness
 * still reads it.
 */

export const INDEX_KEY = "kobin.canvases";
export const SLOT_PREFIX = "kobin.canvas.";
export const LEGACY_AUTOSAVE_KEY = "kobinAutosave";
const MIGRATED_FLAG = "kobin.canvases.migrated";

export const slotKey = (id) => SLOT_PREFIX + id;

export function newCanvasId() {
    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 6)
    );
}

export function readIndex() {
    try {
        const raw = localStorage.getItem(INDEX_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string") : [];
    } catch (err) {
        return [];
    }
}

function writeIndex(list) {
    try {
        localStorage.setItem(INDEX_KEY, JSON.stringify(list));
        return true;
    } catch (err) {
        return false;
    }
}

/** Stroke/level stats for gallery badges, from a kobin-1 (or dev-0) document. */
export function statsFromDoc(doc) {
    const natives = (doc && doc.natives) || {};
    let strokes = 0;
    let minLevel = Infinity;
    let maxLevel = -Infinity;
    for (const [lvl, arr] of Object.entries(natives)) {
        if (!Array.isArray(arr) || arr.length === 0) continue;
        strokes += arr.length;
        const n = Number(lvl);
        if (Number.isFinite(n)) {
            if (n < minLevel) minLevel = n;
            if (n > maxLevel) maxLevel = n;
        }
    }
    const levels = strokes > 0 && maxLevel >= minLevel ? maxLevel - minLevel + 1 : 0;
    return { strokes, levels };
}

export function upsertIndexEntry(entry) {
    const list = readIndex().filter((e) => e.id !== entry.id);
    list.unshift({ savedAt: new Date().toISOString(), ...entry });
    list.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    return writeIndex(list);
}

export function removeCanvas(id) {
    writeIndex(readIndex().filter((e) => e.id !== id));
    try { localStorage.removeItem(slotKey(id)); } catch (err) { /* ignore */ }
}

export function loadCanvasRaw(id) {
    try {
        return localStorage.getItem(slotKey(id));
    } catch (err) {
        return null;
    }
}

/**
 * One-time move of the legacy single-slot drawing into the multi-canvas world.
 * Keeps the legacy key untouched. Returns the migrated entry (or null).
 */
export function migrateLegacyAutosave() {
    try {
        if (localStorage.getItem(MIGRATED_FLAG)) return null;
        const raw = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
        if (!raw) { localStorage.setItem(MIGRATED_FLAG, "1"); return null; }
        const doc = JSON.parse(raw);
        const { strokes, levels } = statsFromDoc(doc);
        if (strokes === 0) { localStorage.setItem(MIGRATED_FLAG, "1"); return null; }
        const id = newCanvasId();
        localStorage.setItem(slotKey(id), raw);
        const name = (doc.meta && doc.meta.name) || "My drawing";
        const entry = { id, name, strokes, levels, savedAt: new Date().toISOString() };
        upsertIndexEntry(entry);
        localStorage.setItem(MIGRATED_FLAG, "1");
        return entry;
    } catch (err) {
        return null;
    }
}

// ---- scene thumbnails (JPEG data URLs, keyed per canvas + scene) ----

export const thumbKey = (canvasId, sceneId) => `kobin.thumb.${canvasId}.${sceneId}`;

/** { sceneId: { hash, data } } for the requested scenes (missing ones absent). */
export function loadThumbs(canvasId, sceneIds) {
    const out = {};
    for (const sid of sceneIds) {
        try {
            const raw = localStorage.getItem(thumbKey(canvasId, sid));
            if (raw) out[sid] = JSON.parse(raw);
        } catch (err) { /* ignore */ }
    }
    return out;
}

export function saveThumbs(canvasId, map) {
    for (const [sid, t] of Object.entries(map)) {
        try { localStorage.setItem(thumbKey(canvasId, sid), JSON.stringify(t)); } catch (err) { /* quota */ }
    }
}

export function loadCoverThumb(canvasId) {
    try {
        const raw = localStorage.getItem(thumbKey(canvasId, "cover"));
        return raw ? JSON.parse(raw).data || null : null;
    } catch (err) { return null; }
}

/** "Edited just now" / "Edited 3 hours ago" / "Edited May 4" */
export function editedLabel(savedAt) {
    const t = Date.parse(savedAt);
    if (!Number.isFinite(t)) return "Saved locally";
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return "Edited just now";
    if (mins < 60) return `Edited ${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Edited ${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "Edited yesterday";
    if (days < 7) return `Edited ${days} days ago`;
    return "Edited " + new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Badge copy: how deep the drawing goes, in engine levels (×3,000 each). */
export function depthLabel(levels) {
    if (!levels || levels <= 1) return "Surface level";
    return `${levels} levels deep`;
}
