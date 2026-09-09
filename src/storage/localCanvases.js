/**
 * Local, per-browser canvas store — the public face of `db.js`.
 *
 * Documents, thumbnails, recycle-bin payloads and pre-pull backups live in
 * IndexedDB (see db.js for why, and for the per-frame shape). Three small
 * things stay in localStorage because the shell reads them synchronously:
 * the gallery index (`kobin.canvases`), the trash index (`kobin.trash`) and
 * the device id. Everything that touches a document is async.
 *
 * An unsaved canvas still autosaves (so reload never loses work) but only
 * INDEXED canvases are listed in the gallery; leaving the editor files a
 * drawn-on scratch canvas as a draft, and `sweepStorage` adopts any the shell
 * missed (a crash, a killed tab) rather than deleting them.
 *
 * The pre-multi-canvas app kept one drawing in `kobinAutosave`; on first
 * gallery visit that drawing is migrated into a canvas + index entry. That
 * legacy key is left in place as a safety net.
 */

import { encodeRecords, decodeObjects } from "../engine/format2";
import {
    putCanvas, putCanvas2, getCanvas2, getFrames2, getLogFrom, getCanvasHeader, listCanvasHeaders, patchCanvasHeader, deleteCanvas,
    deleteOrphanFrames, putTrashDoc, getTrashDoc, deleteTrashDoc, listTrashIds,
    putBackup, sweepBackups, putThumbs, getThumbs, deleteThumbs, sweepThumbs,
    migrateLocalStorage, storageEstimate, requestPersistentStorage as requestPersist,
    packSlot, unpackSlot,
} from "./db";

export { packSlot, unpackSlot };

export const INDEX_KEY = "kobin.canvases";
export const LEGACY_AUTOSAVE_KEY = "kobinAutosave";
const MIGRATED_FLAG = "kobin.canvases.migrated";

// The old localStorage key shapes. Still exported for the one-time migration
// and its tests; nothing writes them any more.
export const SLOT_PREFIX = "kobin.canvas.";
export const slotKey = (id) => SLOT_PREFIX + id;
export const thumbKey = (canvasId, sceneId) => `kobin.thumb.${canvasId}.${sceneId}`;

export function newCanvasId() {
    // Eight random base-36 characters, not four: four is 1.7 million values,
    // and two ids minted in the same millisecond collided one run in eighty
    // (`ids are unique enough` drew 199 distinct ids from 200 on 2026-09-06).
    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10)
    );
}

/** Stable per-browser id — lets a device recognize its own cloud heartbeat. */
export function getDeviceId() {
    try {
        let id = localStorage.getItem("kobin.device");
        if (!id) {
            id = newCanvasId();
            localStorage.setItem("kobin.device", id);
        }
        return id;
    } catch (err) {
        return "unknown";
    }
}

// ---- the gallery index (localStorage, synchronous) ----

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

/** Stroke/level stats for gallery badges, from a natives map (frame id -> objects). */
export function statsFromNatives(natives) {
    let strokes = 0;
    let minLevel = Infinity;
    let maxLevel = -Infinity;
    for (const [lvl, arr] of Object.entries(natives || {})) {
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

/** Same, from a kobin-1 (or dev-0) document. */
export function statsFromDoc(doc) {
    return statsFromNatives(doc && doc.natives);
}

export function upsertIndexEntry(entry) {
    const list = readIndex().filter((e) => e.id !== entry.id);
    list.unshift({ savedAt: new Date().toISOString(), ...entry });
    list.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    return writeIndex(list);
}

// ---- documents ----

const docName = (doc, fallback = "Untitled canvas") => {
    const nm = doc && doc.meta && doc.meta.name;
    return nm && nm !== "untitled" ? nm : fallback;
};

/**
 * A kobin-1 document -> the { header, frames, frameIds } shape the store writes.
 * `savedAt` comes from the document's own `meta.modifiedAt` when it has one,
 * so a drawing moved in by the migration, or adopted by the sweep, keeps its
 * real edit date instead of reading "Edited just now" (seen in Kobin's own
 * gallery on 2026-09-03: two adopted drafts stamped with the migration time).
 */
export function docToRecord(doc) {
    const { natives, ...header } = doc;
    const frames = natives || {};
    const modified = header.meta && header.meta.modifiedAt;
    const savedAt = typeof modified === "string" && Number.isFinite(Date.parse(modified)) ? modified : undefined;
    return {
        header: { ...header, name: docName(doc), ...statsFromNatives(frames), ...(savedAt ? { savedAt } : {}) },
        frames,
        frameIds: Object.keys(frames),
    };
}

/**
 * Write a whole document. Returns true when stored, false when the store is
 * missing or the write failed (quota, a closed database).
 */
export async function saveCanvasDoc(id, doc) {
    try {
        const { header, frames, frameIds } = docToRecord(doc);
        const snapshots = {};
        for (const fid of frameIds) snapshots[fid] = { ...encodeRecords(frames[fid] || []), seq: 0 };
        const ok = await putCanvas2(id, { header: { ...header, seq: 0 }, snapshots, frameIds, full: true, resetLog: true });
        return ok === true;
    } catch (err) {
        return false;
    }
}
/**
 * The saver's write: this tick's log `entries`, the frames whose `snapshots` it took,
 * the full frame set, and the compaction floor. Rejects on failure; false when there is
 * no base record and `full` was not set.
 */
export function writeCanvas2(id, args) {
    return putCanvas2(id, args);
}
/**
 * What the editor restores from: `{ header, frames: { frameId: { objects, geo, seq } },
 * entries }` for a kobin-2 canvas, `{ legacy: kobin1Doc }` for one still in the v1
 * store (its first save writes it anew), or null.
 */
export async function loadCanvasStore(id) {
    try {
        const r = await getCanvas2(id);
        if (!r) return null;
        if (r.legacy) return r;
        const frames = {};
        for (const f of r.frames) frames[f.frameId] = { objects: f.objects, geo: f.geo, seq: f.seq };
        return { header: r.header, frames, entries: r.entries };
    } catch (err) { return null; }
}
// A kobin-2 frame as kobin-1 records with PLAIN arrays (a stored loop is a view of the
// frame's geometry; a document handed to JSON, the trash or a backup must not carry one).
function plainRecords(objects, geo) {
    return decodeObjects(objects, geo).map((r) => (r.loops ? { ...r, loops: r.loops.map((l) => Array.from(l)) } : r));
}

/**
 * The incremental write the editor's autosave uses. `header` is the envelope
 * without natives, `frames` only the frames that changed, `frameIds` the full
 * current set. Rejects on failure so the caller can tell quota from anything
 * else; resolves false when there is no base record and `full` was not set.
 */
export function writeCanvas(id, { header, frames, frameIds, full }) {
    return putCanvas(id, { header, frames, frameIds, full });
}

/** The stored document as kobin-1 (plain arrays), from either store, or null. */
export async function loadCanvasDoc(id) {
    try {
        const r = await getCanvas2(id);
        if (!r) return null;
        if (r.legacy) return r.legacy;
        const natives = {};
        for (const f of r.frames) natives[f.frameId] = plainRecords(f.objects, f.geo);
        const { store, frameIds, frameSeq, seq, ...h } = r.header;
        return { format: h.format, version: h.version, meta: h.meta, camera: h.camera, crossings: h.crossings, natives };
    } catch (err) { return null; }
}

export async function hasCanvasDoc(id) {
    try { return !!(await getCanvasHeader(id)); } catch (err) { return false; }
}

export async function removeCanvas(id) {
    writeIndex(readIndex().filter((e) => e.id !== id));
    try { await deleteCanvas(id); } catch (err) { /* ignore */ }
}

/**
 * Rename without opening the editor: freshens the index entry and the stored
 * meta.name so the next cloud pull/save carries the new name.
 */
export async function renameCanvasLocal(id, name, savedAt = new Date().toISOString()) {
    const entry = readIndex().find((e) => e.id === id);
    if (entry) upsertIndexEntry({ ...entry, name, savedAt });
    try {
        await patchCanvasHeader(id, (h) => ({ ...h, name, meta: { ...(h.meta || {}), name } }));
    } catch (err) { /* leave the stored copy untouched */ }
}

/**
 * Keep a copy of the current document before a cloud pull overwrites it —
 * belt-and-braces recovery for a bad merge decision. Backups expire after a
 * week (`sweepStorage`); one per canvas, the newest wins.
 */
export async function backupCanvasDoc(id) {
    try {
        const doc = await loadCanvasDoc(id);
        if (doc) await putBackup(id, doc);
    } catch (err) { /* best-effort */ }
}

// ---- recycle bin ----
// Deleting moves the index entry into a trash index (localStorage) and the
// document into the trash store, so it can be restored; entries expire after
// 30 days. Scene thumbs stay under their normal keys while trashed (restore
// gets covers back for free) and are only removed when the trash entry
// expires or is purged.

export const TRASH_INDEX_KEY = "kobin.trash";
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readTrashIndex() {
    let list;
    try {
        const raw = localStorage.getItem(TRASH_INDEX_KEY);
        list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) list = [];
    } catch (err) {
        list = [];
    }
    return list.filter((e) => e && typeof e.id === "string");
}

function writeTrash(list) {
    try { localStorage.setItem(TRASH_INDEX_KEY, JSON.stringify(list)); } catch (err) { /* quota */ }
}

/** Trash entries newest-deletion-first; expired ones are purged on read, payloads included. */
export async function readTrash() {
    const list = readTrashIndex();
    const now = Date.now();
    const live = [];
    for (const e of list) {
        const t = Date.parse(e.deletedAt);
        if (Number.isFinite(t) && now - t <= TRASH_TTL_MS) { live.push(e); continue; }
        try { await deleteTrashDoc(e.id); } catch (err) { /* ignore */ }
        try { await deleteThumbs(e.id); } catch (err) { /* ignore */ }
    }
    if (live.length !== list.length) writeTrash(live);
    live.sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
    return live;
}

/**
 * Move a canvas (index entry + document) to the trash. `fallbackEntry` covers
 * canvases with no index entry (never-saved scratch, or cloud-only listings)
 * so the recycle bin still shows a row for them. Returns the trash entry.
 */
export async function trashCanvas(id, fallbackEntry = null) {
    const entry = readIndex().find((e) => e.id === id) || fallbackEntry;
    let doc = null;
    try { doc = await loadCanvasDoc(id); } catch (err) { /* ignore */ }
    writeIndex(readIndex().filter((e) => e.id !== id));
    if (!entry && !doc) return null;
    if (doc) {
        try { await putTrashDoc(id, doc); } catch (err) { doc = null; /* quota — entry still listed; cloud may hold the data */ }
        try { await deleteCanvas(id); } catch (err) { /* ignore */ }
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
    writeTrash([t, ...(await readTrash()).filter((e) => e.id !== id)]);
    return t;
}

/**
 * Bring a trashed canvas back: the document returns and the index entry is
 * re-created (only when a stored document existed — cloud-only rows come back
 * via the cloud listing instead). Returns the trash entry, or null if unknown.
 */
export async function restoreCanvas(id) {
    const list = await readTrash();
    const t = list.find((e) => e.id === id);
    if (!t) return null;
    let doc = null;
    try { doc = await getTrashDoc(id); } catch (err) { /* ignore */ }
    if (doc) {
        if (!(await saveCanvasDoc(id, doc))) return null; // quota — keep it in the bin
        upsertIndexEntry({
            id,
            name: t.name || "Untitled canvas",
            strokes: t.strokes || 0,
            levels: t.levels || 0,
            savedAt: t.savedAt || new Date().toISOString(),
        });
    }
    try { await deleteTrashDoc(id); } catch (err) { /* ignore */ }
    writeTrash(list.filter((e) => e.id !== id));
    return t;
}

/**
 * File the losing side of a cross-device overwrite in the recycle bin. The
 * snapshot gets a FRESH id and a "(overwritten)" name, so restoring it
 * becomes its own canvas instead of fighting the live one for the same slot.
 * Returns the trash entry, or null if the snapshot couldn't be stored.
 */
export async function stashOverwrittenVersion(doc, name) {
    if (typeof doc === "string") { try { doc = JSON.parse(doc); } catch (err) { return null; } }
    if (!doc || typeof doc !== "object") return null;
    const label = (name || "Untitled canvas") + " (overwritten)";
    const copy = { ...doc, meta: { ...(doc.meta || {}), name: label } };
    const id = newCanvasId();
    try {
        await putTrashDoc(id, copy);
    } catch (err) {
        return null; // quota — the backup copy still exists
    }
    const t = {
        id,
        name: label,
        savedAt: new Date().toISOString(),
        ...statsFromDoc(copy),
        deletedAt: new Date().toISOString(),
    };
    writeTrash([t, ...(await readTrash()).filter((e) => e.id !== id)]);
    return t;
}

/** Permanently remove a trash entry: index row, stored document, thumbnails. */
export async function purgeTrashEntry(id) {
    const list = await readTrash();
    try { await deleteTrashDoc(id); } catch (err) { /* ignore */ }
    try { await deleteThumbs(id); } catch (err) { /* ignore */ }
    writeTrash(list.filter((e) => e.id !== id));
}

/**
 * Copy a canvas into a fresh document + index entry named "<name> copy", cover
 * thumb included. `fallbackDoc`/`fallbackName` cover cloud-only canvases whose
 * drawing was fetched separately (a document or its JSON). Returns the new
 * entry, or null.
 */
export async function duplicateCanvas(id, fallbackDoc = null, fallbackName = null) {
    let doc = await loadCanvasDoc(id);
    if (!doc && fallbackDoc) {
        if (typeof fallbackDoc === "string") { try { doc = JSON.parse(fallbackDoc); } catch (err) { return null; } }
        else doc = fallbackDoc;
    }
    if (!doc) return null;
    const entry = readIndex().find((e) => e.id === id);
    const base = (entry && entry.name) || fallbackName || docName(doc, null) || "Untitled canvas";
    const name = base + " copy";
    const copy = { ...doc, meta: { ...(doc.meta || {}), name } };
    const newId = newCanvasId();
    if (!(await saveCanvasDoc(newId, copy))) return null;
    try {
        const cover = await getThumbs(id, ["cover"]);
        if (cover.cover) await putThumbs(newId, { cover: cover.cover });
    } catch (err) { /* thumb is a nicety */ }
    const newEntry = { id: newId, name, savedAt: new Date().toISOString(), ...statsFromDoc(copy) };
    upsertIndexEntry(newEntry);
    return newEntry;
}

/**
 * One-time move of the legacy single-slot drawing into the multi-canvas world.
 * Keeps the legacy key untouched. Returns the migrated entry (or null).
 */
export async function migrateLegacyAutosave() {
    try {
        if (localStorage.getItem(MIGRATED_FLAG)) return null;
        const raw = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
        if (!raw) { localStorage.setItem(MIGRATED_FLAG, "1"); return null; }
        const doc = JSON.parse(raw);
        const { strokes, levels } = statsFromDoc(doc);
        if (strokes === 0) { localStorage.setItem(MIGRATED_FLAG, "1"); return null; }
        const id = newCanvasId();
        if (!(await saveCanvasDoc(id, doc))) return null;
        const name = docName(doc, "My drawing");
        const entry = { id, name, strokes, levels, savedAt: new Date().toISOString() };
        upsertIndexEntry(entry);
        localStorage.setItem(MIGRATED_FLAG, "1");
        return entry;
    } catch (err) {
        return null;
    }
}

// ---- scene thumbnails (JPEG, keyed per canvas + scene, LRU under a budget) ----

/** { sceneId: { hash, data } } for the requested scenes (missing ones absent). */
export async function loadThumbs(canvasId, sceneIds) {
    try { return await getThumbs(canvasId, sceneIds); } catch (err) { return {}; }
}

export async function saveThumbs(canvasId, map) {
    try { await putThumbs(canvasId, map); } catch (err) { /* derived data — regenerated next time */ }
}

export async function loadCoverThumb(canvasId) {
    try {
        const t = await getThumbs(canvasId, ["cover"]);
        return t.cover ? t.cover.data || null : null;
    } catch (err) { return null; }
}

// ---- housekeeping ----

/** One-time move of everything document-sized out of localStorage. Safe to call every load. */
export function migrateStorage() {
    return migrateLocalStorage(docToRecord);
}

export const BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What used to leak. Run from the gallery, after migration:
 *   - documents the gallery does not list and the bin does not hold: an empty
 *     one goes; a drawn-on one is ADOPTED as a draft, because it is somebody's
 *     work that a crash or a killed tab kept from being filed;
 *   - frame records whose header is gone;
 *   - backups older than a week;
 *   - thumbnails for canvases that exist nowhere, then the LRU budget;
 *   - expired trash entries (readTrash does that on the way past).
 * Returns counts, for the console and the tests.
 */
export async function sweepStorage() {
    const out = { adopted: 0, deleted: 0, orphanFrames: 0, backups: 0, thumbs: 0 };
    let headers = [];
    try { headers = await listCanvasHeaders(); } catch (err) { return out; }
    const trash = await readTrash();
    const trashIds = new Set(trash.map((e) => e.id));
    const indexed = new Set(readIndex().map((e) => e.id));
    for (const h of headers) {
        if (indexed.has(h.id) || trashIds.has(h.id)) continue;
        const strokes = h.strokes || 0;
        if (strokes > 0) {
            // The engine's default meta name is lowercase "untitled" — never
            // let it become a visible gallery label.
            upsertIndexEntry({
                id: h.id,
                name: (h.name && h.name !== "untitled" ? h.name : null) || docName({ meta: h.meta }),
                savedAt: h.savedAt || new Date().toISOString(),
                strokes,
                levels: h.levels || 0,
            });
            indexed.add(h.id);
            out.adopted++;
        } else {
            try { await deleteCanvas(h.id); out.deleted++; } catch (err) { /* ignore */ }
        }
    }
    try { out.orphanFrames = await deleteOrphanFrames(); } catch (err) { /* ignore */ }
    try { out.backups = await sweepBackups(BACKUP_TTL_MS); } catch (err) { /* ignore */ }
    try {
        // A trash payload whose index row is gone is unreachable: drop it too.
        for (const id of await listTrashIds()) if (!trashIds.has(id)) await deleteTrashDoc(id);
    } catch (err) { /* ignore */ }
    try { out.thumbs = await sweepThumbs([...indexed, ...trashIds]); } catch (err) { /* ignore */ }
    return out;
}

/** "Using 12 MB of browser storage" — or null where the browser will not say. */
export async function storageUsage() {
    const e = await storageEstimate();
    if (!e) return null;
    return { ...e, label: `Using ${formatMB(e.usage)} of browser storage` };
}

function formatMB(bytes) {
    const mb = bytes / (1024 * 1024);
    if (mb < 0.1) return "under 0.1 MB";
    if (mb < 10) return mb.toFixed(1) + " MB";
    if (mb < 1024) return Math.round(mb) + " MB";
    return (mb / 1024).toFixed(1) + " GB";
}

export const requestPersistentStorage = requestPersist;

// ---- labels ----

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

/** Badge copy: how deep the drawing goes, in engine levels (×4,096 each). */
export function depthLabel(levels) {
    if (!levels || levels <= 1) return "Surface level";
    return `${levels} levels deep`;
}

/**
 * What the cloud push reads: the stored header (frame seqs and the last entry seq)
 * and two readers the push calls for only what the cloud is missing. Null for a
 * canvas not yet in the kobin-2 store.
 */
export async function cloudPushSource(id) {
    const header = await getCanvasHeader(id);
    if (!header || header.store !== "kobin-2") return null;
    return {
        header,
        readFrames: (frameIds) => getFrames2(id, frameIds),
        readLog: (fromSeq) => getLogFrom(id, fromSeq),
    };
}
/** A pulled kobin-2 store written whole, its log replacing the local one. */
export async function replaceCanvasStore(id, { header, frames, entries }) {
    const snapshots = {};
    for (const fid of Object.keys(frames)) snapshots[fid] = frames[fid];
    return putCanvas2(id, { header, snapshots, frameIds: Object.keys(frames), entries, full: true, resetLog: true });
}
