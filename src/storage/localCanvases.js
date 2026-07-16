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

import LZString from "lz-string";

export const INDEX_KEY = "kobin.canvases";
export const SLOT_PREFIX = "kobin.canvas.";
export const LEGACY_AUTOSAVE_KEY = "kobinAutosave";
const MIGRATED_FLAG = "kobin.canvases.migrated";

export const slotKey = (id) => SLOT_PREFIX + id;

// ---- slot compression (lz-string UTF-16 — the dense form for localStorage) ----
// Compressed slots stretch the ~5 MB localStorage quota several-fold, so big
// drawings stop silently failing the 4s autosave. Legacy plain-JSON slots
// (first char "{") keep loading forever.

const SLOT_LZ_PREFIX = "lz1:";

/** kobin-1 JSON string → stored slot value (compressed). */
export function packSlot(json) {
    return SLOT_LZ_PREFIX + LZString.compressToUTF16(json);
}

/** Stored slot value (compressed or legacy plain JSON) → JSON string. */
export function unpackSlot(raw) {
    if (raw == null) return null;
    if (raw.startsWith(SLOT_LZ_PREFIX)) {
        return LZString.decompressFromUTF16(raw.slice(SLOT_LZ_PREFIX.length));
    }
    return raw;
}

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

// ---- recycle bin ----
// Deleting moves the index entry (+ slot, verbatim) into a trash index so it
// can be restored; entries expire after 30 days. Scene thumbs stay under their
// normal keys while trashed (restore gets covers back for free) and are only
// removed when the trash entry expires.

export const TRASH_INDEX_KEY = "kobin.trash";
export const TRASH_SLOT_PREFIX = "kobin.trash.";
const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const trashSlotKey = (id) => TRASH_SLOT_PREFIX + id;

function writeTrash(list) {
    try { localStorage.setItem(TRASH_INDEX_KEY, JSON.stringify(list)); } catch (err) { /* quota */ }
}

function removeThumbs(canvasId) {
    const prefix = `kobin.thumb.${canvasId}.`;
    try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) doomed.push(k);
        }
        doomed.forEach((k) => localStorage.removeItem(k));
    } catch (err) { /* ignore */ }
}

/** Trash entries newest-deletion-first; expired ones are purged on read. */
export function readTrash() {
    let list;
    try {
        const raw = localStorage.getItem(TRASH_INDEX_KEY);
        list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) list = [];
    } catch (err) {
        list = [];
    }
    list = list.filter((e) => e && typeof e.id === "string");
    const now = Date.now();
    const live = list.filter((e) => {
        const t = Date.parse(e.deletedAt);
        if (Number.isFinite(t) && now - t <= TRASH_TTL_MS) return true;
        try { localStorage.removeItem(trashSlotKey(e.id)); } catch (err) { /* ignore */ }
        removeThumbs(e.id);
        return false;
    });
    if (live.length !== list.length) writeTrash(live);
    live.sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
    return live;
}

/**
 * Move a canvas (index entry + slot) to the trash. `fallbackEntry` covers
 * canvases with no index entry (never-saved scratch, or cloud-only listings)
 * so the recycle bin still shows a row for them. Returns the trash entry.
 */
export function trashCanvas(id, fallbackEntry = null) {
    const entry = readIndex().find((e) => e.id === id) || fallbackEntry;
    let raw = null;
    try { raw = localStorage.getItem(slotKey(id)); } catch (err) { /* ignore */ }
    writeIndex(readIndex().filter((e) => e.id !== id));
    try {
        localStorage.removeItem(slotKey(id));
        localStorage.removeItem(slotKey(id) + ".bak");
    } catch (err) { /* ignore */ }
    if (!entry && !raw) return null;
    if (raw) {
        try { localStorage.setItem(trashSlotKey(id), raw); } catch (err) { raw = null; /* quota — entry still listed; cloud may hold the data */ }
    }
    const t = {
        id,
        name: "Untitled canvas",
        strokes: 0,
        levels: 0,
        savedAt: null,
        ...(entry || {}),
        deletedAt: new Date().toISOString(),
    };
    writeTrash([t, ...readTrash().filter((e) => e.id !== id)]);
    return t;
}

/**
 * Bring a trashed canvas back: slot returns verbatim and the index entry is
 * re-created (only when a local slot existed — cloud-only rows come back via
 * the cloud listing instead). Returns the trash entry, or null if unknown.
 */
export function restoreCanvas(id) {
    const list = readTrash();
    const t = list.find((e) => e.id === id);
    if (!t) return null;
    let raw = null;
    try { raw = localStorage.getItem(trashSlotKey(id)); } catch (err) { /* ignore */ }
    if (raw) {
        try { localStorage.setItem(slotKey(id), raw); } catch (err) { return null; /* quota — keep it in the bin */ }
        upsertIndexEntry({
            id,
            name: t.name || "Untitled canvas",
            strokes: t.strokes || 0,
            levels: t.levels || 0,
            savedAt: t.savedAt || new Date().toISOString(),
        });
    }
    try { localStorage.removeItem(trashSlotKey(id)); } catch (err) { /* ignore */ }
    writeTrash(list.filter((e) => e.id !== id));
    return t;
}

/**
 * Rename without opening the editor: freshens the index entry and the slot's
 * embedded meta.name so the next cloud pull/save carries the new name.
 */
export function renameCanvasLocal(id, name, savedAt = new Date().toISOString()) {
    const entry = readIndex().find((e) => e.id === id);
    if (entry) upsertIndexEntry({ ...entry, name, savedAt });
    const json = loadCanvasRaw(id);
    if (!json) return;
    try {
        const doc = JSON.parse(json);
        doc.meta = { ...(doc.meta || {}), name };
        saveCanvasRaw(id, JSON.stringify(doc));
    } catch (err) { /* leave the slot untouched */ }
}

/** The slot's kobin-1 JSON string (transparently decompressed), or null. */
export function loadCanvasRaw(id) {
    try {
        return unpackSlot(localStorage.getItem(slotKey(id)));
    } catch (err) {
        return null;
    }
}

/** Write a slot (compressed). Returns false on quota failure. */
export function saveCanvasRaw(id, json) {
    try {
        localStorage.setItem(slotKey(id), packSlot(json));
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Stash the current slot value under `<slot>.bak` before a cloud pull
 * overwrites it — belt-and-braces recovery for a bad merge decision.
 */
export function backupCanvasSlot(id) {
    try {
        const raw = localStorage.getItem(slotKey(id));
        if (raw) localStorage.setItem(slotKey(id) + ".bak", raw);
    } catch (err) { /* quota — best-effort */ }
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
        localStorage.setItem(slotKey(id), packSlot(raw));
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

function agoLabel(verb, iso, fallback) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return fallback;
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return `${verb} just now`;
    if (mins < 60) return `${verb} ${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${verb} ${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return `${verb} yesterday`;
    if (days < 7) return `${verb} ${days} days ago`;
    return `${verb} ` + new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Edited just now" / "Edited 3 hours ago" / "Edited May 4" */
export function editedLabel(savedAt) {
    return agoLabel("Edited", savedAt, "Saved locally");
}

/** "Deleted just now" / "Deleted 3 days ago" — for recycle-bin rows. */
export function deletedLabel(deletedAt) {
    return agoLabel("Deleted", deletedAt, "Deleted");
}

/** Badge copy: how deep the drawing goes, in engine levels (×3,000 each). */
export function depthLabel(levels) {
    if (!levels || levels <= 1) return "Surface level";
    return `${levels} levels deep`;
}
