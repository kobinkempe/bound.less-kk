# -*- coding: utf-8 -*-
"""Per-function entries for the local store: db.js (IndexedDB), localCanvases.js (its public
face), foldStore.js, thumbnails.js and the sync chip."""

E = {}


def add(key, fn, what, long, ref="§13"):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# What each file is for; the file's article heading on the Code Map.
ROLE = {
    "src/storage/db.js":
        "The browser-side store on IndexedDB: one header per canvas, the kobin-2 frame snapshots and op "
        "log (and the v1 frame records an old canvas still opens from), thumbnails as JPEG bytes under a "
        "12 MiB LRU budget, bin payloads and pre-pull backups, all structured data with no JSON text and no "
        "compression. It knows nothing of the engine; `localCanvases.js` is its only importer (DESIGN.md §13).",
    "src/storage/localCanvases.js":
        "The local store's public face: whole-document and saver writes, the editor's restore read, the "
        "recycle bin, thumbnails, the one-time migrations, the gallery's sweep, and the sync's reads and "
        "writes of the kobin-2 store (pushes, pulls, stashes, conflict copies, one tab's writer claim). The gallery index, the bin index and "
        "the device id and name stay in localStorage, read synchronously (DESIGN.md §13).",
    "src/storage/foldStore.js":
        "A stored or pulled kobin-2 canvas as one kobin-1 document: its frame snapshots, with the log "
        "entries they do not hold yet replayed through a detached engine (F86). The gallery's download, "
        "the v1 paths of the bin and backup, and `cloudLoadCanvas` read through it (DESIGN.md §13).",
    "src/storage/thumbnails.js":
        "Scene thumbnails as 320×240 JPEG data URLs, cached by each scene's content hash: from the live "
        "raster engine's snapshots by default, or from a one-off SVG engine (`withSvgEngine`), which also "
        "makes the SVG export in raster mode (DESIGN.md §9).",
    "src/Components/editor/SyncChip.js":
        "The editor's sync state (DESIGN.md §13, several tabs and devices): a status button inside the title "
        "chip (an icon on a phone, icon and short label on a desktop) that opens a details card with this "
        "device's name, and a banner under the top bar while another tab or device has the pen, while the "
        "pen moves, and briefly after Edit here.",
}


# ---- src/storage/db.js ----
add("db.idbAvailable", "idbAvailable()",
    "Whether this environment has IndexedDB: false where the global is missing or reading it throws.",
    ["-"], "")
add("db.openDb", "openDb()",
    "The one IndexedDB connection, opened and upgraded on first use; resolves null where the database is missing or refused.",
    ["Caches one promise. The upgrade creates whichever stores are missing: `canvases` (headers), `frames` (v1), `thumbs` (indexed by canvas and by `usedAt`), `trash`, `backups`, and version 2's `frames2` and `log`; every per-canvas store has a `byCanvas` index.",
     "On `versionchange` (a newer build upgrading in another tab) it closes and forgets the connection, so the next call opens afresh. A null connection makes `tx` resolve null and do nothing."])
add("db._resetDbForTests", "_resetDbForTests()",
    "Tests only: closes and forgets the cached connection, since fake-indexeddb is reset between tests.",
    ["-"], "")
add("db.reqp", "reqp(r)", "An IndexedDB request as a promise of its result.", ["-"], "")
add("db.tx", "tx(names, mode, fn)",
    "Runs `fn` over the named stores inside one transaction and resolves with its value once the transaction commits.",
    ["Resolves only on `complete`, so an awaited write is on disk; rejects on abort, and aborts the transaction when `fn` throws or its promise rejects. Resolves null, doing nothing, where there is no database.",
     "`fn` may be async, but a request issued after an `await` must follow directly from one that just completed: a transaction auto-commits the moment it has nothing in flight."])
add("db.only", "only(v)", "`IDBKeyRange.only(v)`, for the per-canvas index lookups.", ["-"], "")
add("db.putCanvas", "putCanvas(id, { ... })",
    "Writes a canvas in the v1 store: its header and one record of kobin-1 natives per frame, in one transaction.",
    ["`frames` holds the frames to write and `frameIds` the full set. An incremental write deletes the frames that left the set since the last one; `full` makes the stored set match exactly.",
     "Resolves false, writing nothing, for an incremental write of a canvas with no header: the header would list frames the store does not hold.",
     "Callers: the localStorage migration and `localCanvases.writeCanvas`. The saver writes kobin-2 through `putCanvas2`."])
add("db.headerToDoc", "headerToDoc(h, natives)",
    "Builds the kobin-1 envelope from a stored header and a natives map, leaving the listing fields behind.",
    ["Keeps `format`, `version`, `meta`, `camera` and `crossings`; the header's name, stats, frame list, seqs and sync fields are not part of the document."])
add("db.getCanvasHeader", "getCanvasHeader(id)",
    "One canvas's stored header (listing fields, meta, frame seqs, sync fields) without reading a frame.",
    ["-"])
add("db.listCanvasHeaders", "listCanvasHeaders()",
    "Every stored canvas header, for the storage sweep; an empty list where there is no database.",
    ["-"])
add("db.patchCanvasHeader", "patchCanvasHeader(id, fn, writer)",
    "Rewrites one stored header through `fn`, touching no frame; false when the canvas has none, 'fenced' when another tab holds the store.",
    ["With a `writer` token the patch is refused as 'fenced' when the header names a different writer (SYNC-PLAN R2); without one (the gallery's rename, `claimStore`) it always applies. The id is re-applied after `fn`, so `fn` cannot move the record."])
add("db.deleteCanvas", "deleteCanvas(id)",
    "Deletes a canvas's header and all its records in the v1 frames, `frames2` and log stores, in one transaction.",
    ["Thumbnails, the bin payload and the backup are left: a binned canvas keeps its covers, and `sweepStorage` drops thumbnails nothing lists."])
add("db.deleteOrphanFrames", "deleteOrphanFrames()",
    "Deletes frame and log records whose canvas header is gone (a torn delete); returns how many went.",
    ["Walks every key of the three stores against the set of header ids. Run by `sweepStorage`."])
add("db.bufferOf", "bufferOf(geo)",
    "The ArrayBuffer to store for a Float64Array: its own buffer when the view spans all of it, else a copy of the view's bytes.",
    ["A structured clone of a buffer copies all of it, so a view into a larger buffer is sliced to its own bytes first."], "")
add("db.putCanvas2", "putCanvas2(id, { ... })",
    "Writes a canvas in the kobin-2 store in one transaction: the header, the frame snapshots given, the new log entries and the compaction.",
    ["`snapshots` maps frame id to `{ objects, geo, seq }` and `frameIds` is the full set; the header's `frameSeq` keeps each frame's snapshot seq and loses frames that left. `full` makes the stored frame set match exactly and deletes the canvas's v1 frame records; `resetLog` empties the log first; `dropBelow` deletes the entries with a seq under it.",
     "Writes nothing and resolves: false for an incremental write of a canvas with no header on disk (the saver retries in full); 'fenced' when `writer` is given and the stored header names another writer (SYNC-PLAN R2); 'stale' when the new header's seq is behind the stored kobin-2 one and `rewind` is not set, so a document the store was pulled in under cannot overwrite the pull. Only a whole-document write and a full pull rewind.",
     "The sync fields (`base`, `intent`, `pending`, `writer`) are carried over from the stored header unless the new header names them, because the saver's header never does; a given `writer` is stamped on the header."])
add("db.getCanvas2", "getCanvas2(id)",
    "Reads a stored canvas: header, frame snapshots and log entries for kobin-2, `{ legacy }` for a v1 canvas, or null.",
    ["Frame geometry comes back as a Float64Array over the stored buffer; entries are sorted by seq, one with no geometry given an empty Float64Array.",
     "A v1 canvas is reassembled as a kobin-1 document; its next full write moves it into `frames2`.",
     "One transaction for the whole canvas: `loadCanvasDoc` reads through it, and `getCanvas2Chunked` falls back to it; the editor's restore reads chunked."])
add("db.copyCanvas2", "copyCanvas2(fromId, toId, patch)",
    "Copies every record of a stored canvas to a new id in one transaction, the header through `patch`.",
    ["The v1 frames, the `frames2` snapshots and the log are copied as they are, so the copy keeps its undo history. Resolves true only when the source had a header.",
     "Called by `copyCanvas2Chunked` for a v1 canvas and when the source changed during a chunked copy."])
add("db.stamp", "stamp(h)",
    "A header's fingerprint for the chunked read and copy: its seq, `savedAt`, frame seqs and frame ids, or '' for none.",
    ["A store write sets `savedAt`, so a write that lands between two reads of the header changes the stamp. A header patch that touches none of these fields (a rename, the sync fields) leaves it as it was."], "§13")
add("db.getCanvas2Chunked", "getCanvas2Chunked(id, { ... })",
    "Reads a stored canvas as `getCanvas2` does, in short transactions: the header, one frame per transaction, the log, then the header again.",
    ["If the stamp changed during the read (a write landed), it reads again, three tries, then falls back to `getCanvas2` in one transaction; a v1 canvas goes straight there. The frames are the ones the header lists; `onChunk` runs after each, for tests. Read by `loadCanvasStore`, the editor's restore and reload.",
     "A transaction's scope is a whole store, so one that reads a whole canvas holds up every read-write on these stores across the origin. Measured 2026-09-22 in Chrome on a store the size of the Magnum Opus (60 frames, 42,856 objects, 60 MB of geometry): a one-transaction read 400–500 ms, a small write elsewhere waiting all of it; one frame per transaction, 25 ms at most, the small write waiting 1–3 ms."],
    "§13")
add("db.copyCanvas2Chunked", "copyCanvas2Chunked(fromId, toId, patch)",
    "Copies a stored canvas as `copyCanvas2` does, in short transactions: one frame per transaction, then the log, the header last.",
    ["The header, through `patch`, is written only if the source's stamp has not changed, so a copy torn midway has no header and the gallery's sweep deletes its records (`deleteOrphanFrames`). If the source did change, the partial copy is deleted and the copy made again in one transaction; a v1 canvas goes straight to `copyCanvas2`. True when the copy landed.",
     "The source must not change meanwhile: its callers (`forkCanvas`, `stashCanvasStore`) run while the session holds the pen with the saver off. Measured on the same Magnum Opus-sized store: a one-transaction copy 1.4 s, a small write elsewhere waiting all of it."],
    "§13")
add("db.putTrashDoc", "putTrashDoc(id, doc, deletedAt)",
    "Stores a binned canvas's whole kobin-1 document in the `trash` store, stamped with when it was deleted.",
    ["-"])
add("db.getTrashDoc", "getTrashDoc(id)", "A binned canvas's stored document, or null.", ["-"])
add("db.deleteTrashDoc", "deleteTrashDoc(id)", "Deletes a binned canvas's stored document.", ["-"])
add("db.listTrashIds", "listTrashIds()",
    "The ids the `trash` store holds, for the sweep that drops payloads with no bin row.", ["-"])
add("db.putBackup", "putBackup(id, doc, at)",
    "Stores a backup of a canvas's document, one per canvas, the newest replacing the last.", ["-"])
add("db.getBackup", "getBackup(id)", "A canvas's backup document, or null.",
    ["Only the tests read it; the app has no restore-from-backup action."])
add("db.sweepBackups", "sweepBackups(maxAgeMs)",
    "Deletes backups older than `maxAgeMs`, and any whose date will not parse; returns how many went.",
    ["`sweepStorage` runs it with a week (`BACKUP_TTL_MS`)."])
add("db.dataUrlToBytes", "dataUrlToBytes(dataUrl)",
    "Parses a data URL into its media type and an ArrayBuffer of its bytes, or null.",
    ["Reads base64 and percent-encoded bodies. Thumbnails are stored as bytes because base64 is a third bigger."], "")
add("db.bytesToDataUrl", "bytesToDataUrl(type, bytes)",
    "Encodes stored bytes back into a base64 data URL.",
    ["Builds the binary string 32 KiB at a time: `String.fromCharCode.apply` takes the bytes as arguments, and a whole image would exceed the argument limit."], "")
add("db.putThumbs", "putThumbs(canvasId, map)",
    "Stores scene thumbnails as JPEG bytes with their content hashes, then trims the store to its budget, in one transaction.",
    ["`map` is `{ sceneId: { hash, data } }`; an entry whose data is not a data URL is skipped. Each record carries its size and `usedAt`, which the trim reads.",
     "One transaction: a failure loses the whole batch, and `localCanvases.saveThumbs` swallows it."])
add("db.trimThumbs", "trimThumbs(thumbs, budget)",
    "Evicts least-recently-used thumbnails until the store holds at most `budget` bytes; returns how many went.",
    ["Runs inside the caller's transaction (`putThumbs`, `sweepThumbs`). The budget is `THUMB_BUDGET_BYTES`, 12 MiB."])
add("db.getThumbs", "getThumbs(canvasId, sceneIds)",
    "The stored thumbnails for some scenes of one canvas, as data URLs, marking each one found as just used.",
    ["A read-write transaction because a hit rewrites `usedAt`: being read is what keeps a thumbnail from LRU eviction. Missing scenes are simply absent."])
add("db.deleteThumbs", "deleteThumbs(canvasId)",
    "Deletes every thumbnail of one canvas; returns how many went.",
    ["Called when a bin entry expires or is purged."])
add("db.sweepThumbs", "sweepThumbs(keepIds, budget)",
    "Deletes the thumbnails of every canvas not in `keepIds`, then trims to the budget; returns how many went.",
    ["`sweepStorage` passes the gallery's and the bin's ids, so a binned canvas keeps its covers."])
add("db.thumbBytesTotal", "thumbBytesTotal()", "The bytes the thumbnail store holds.",
    ["Only the tests read it."])
add("db.packSlot", "packSlot(json)",
    "Writes a document string in the old localStorage slot form: `lz1:` then lz-string's UTF-16 compression.",
    ["Nothing in the app writes slots; the tests seed old slots with it for the migration. `localCanvases` re-exports it."])
add("db.unpackSlot", "unpackSlot(raw)",
    "Reads an old localStorage slot: an `lz1:` slot decompressed, a plain-JSON one returned as it is, null for null.",
    ["The one-time migration's reader. `localCanvases` re-exports it."])
add("db.migrateLocalStorage", "migrateLocalStorage(docToRecord)",
    "Moves every document, bin payload and thumbnail out of localStorage into IndexedDB and deletes the keys, once per browser.",
    ["Skipped when the `kobin.idb.migrated` flag is set, localStorage throws, or there is no database. Each `kobin.canvas.*` slot goes into the v1 store through `putCanvas` (full), each `kobin.trash.*` into `trash`, the `kobin.thumb.*` keys into `thumbs` a canvas at a time; `.bak` copies, `boundlessDrawing*` and `kobinSnapshot` are deleted unread.",
     "A key that fails is left in place and named in the console, and the flag is still set, so it is not tried again; only a flag that will not write makes the next load retry.",
     "`docToRecord` is passed in because it lives in `localCanvases`, this module's only importer."])
add("db.storageEstimate", "storageEstimate()",
    "The browser's `{ usage, quota }` for this origin in bytes, or null where it will not say.", ["-"], "")
add("db.requestPersistentStorage", "requestPersistentStorage()",
    "Asks the browser not to evict this origin's storage under pressure; true when it is, or already was, persisted.",
    ["The gallery asks on mount. Chrome grants it silently by engagement, Firefox prompts, Safari ignores it; a signed-out user's drawings exist nowhere else."])
add("db.readPushState", "readPushState(id, cloudFrameSeq, fromSeq)",
    "What a cloud push sends, read in one transaction so the three agree: the header, the frames the cloud lacks, and the entries after `fromSeq`.",
    ["A frame is read when the cloud has no seq for it or a different one; the entries are those in (`fromSeq`, header seq], ascending, one with no geometry given an empty Float64Array. Null for a canvas not in the kobin-2 store.",
     "Read through `cloudPushSource`'s `read`."])


# ---- src/storage/localCanvases.js ----
add("loc.getDeviceName", "getDeviceName()",
    "This device's name as other devices see it: the stored one, else the browser and OS read from the user agent.",
    ["Kept in localStorage (`kobin.deviceName`). The cloud lease carries it, so a read-only device shows 'editing on <name>', and a conflict's copy is named after it."])
add("loc.setDeviceName", "setDeviceName(name)",
    "Stores this device's name, trimmed and cut to 40 characters; a blank name is ignored.", ["-"])
add("loc.statsFromNatives", "statsFromNatives(natives)",
    "Stroke count and level span of a natives map, for the gallery badge and the stored header.",
    ["Strokes counts every object in every frame. The span is taken only over frame ids that are plain numbers, which in the lattice are the spine frames (their id is their depth), so ink only in an off-spine frame such as `3/1,2` adds strokes and no levels.",
     "The saver writes the result into every header it stores; the gallery's `depthLabel` shows the levels."])
add("loc.docName", "docName(doc, fallback)",
    "A document's display name: `meta.name` unless it is missing or the engine's default `untitled`, else the fallback.",
    ["-"])
add("loc.docToRecord", "docToRecord(doc)",
    "Turns a kobin-1 document into the `{ header, frames, frameIds }` a whole write stores, listing fields added.",
    ["The header is the envelope without natives plus `name`, `strokes`, `levels` and, when `meta.modifiedAt` parses, `savedAt` from it, so a migrated or adopted drawing keeps its real edit date. Used by `saveCanvasDoc`, and passed to the localStorage migration."])
add("loc.saveCanvasDoc", "saveCanvasDoc(id, doc)",
    "Writes a whole kobin-1 document into the kobin-2 store: every frame a fresh snapshot, an empty log, seq 0.",
    ["Each frame is encoded with `format2.encodeRecords`; `full`, `resetLog` and `rewind` replace whatever was stored, even a store whose seq is ahead, and with no writer token it is never fenced. `base` and `intent` are written null: a document written whole has no cloud lineage, which the next open decides (SYNC-PLAN R4).",
     "Resolves true when stored and false on any failure; never throws. Used by restore, duplicate, the legacy-autosave migration, the gallery's import, the hook's `keepUnsaved` (work that could not be written here, kept as a new canvas) and both sides of an old lz1 cloud copy's pull."])
add("loc.writeCanvas2", "writeCanvas2(id, args)",
    "The saver's write: this tick's log entries, the frames it snapshotted, the full frame set and the compaction floor, passed to `putCanvas2`.",
    ["Rejects on failure, so the saver can tell a full store from anything else. Resolves false when there is no stored header and `full` was not set, and 'fenced' or 'stale' when `putCanvas2` refuses (the store is another tab's, or ahead of this document); the saver then stops writing and hands either to the session (`onRefused`), which keeps the work in memory as a new canvas."])
add("loc.loadCanvasStore", "loadCanvasStore(id)",
    "What the editor restores from: the stored header, frame snapshots by id and log entries; `{ legacy }` for a v1 canvas; or null.",
    ["Reads through `getCanvas2Chunked`, one frame per transaction, so restoring a large canvas does not hold up writes elsewhere in the origin. Null on a read failure as well as for no canvas.",
     "The editor's restore and its reload after another tab or a pull wrote the store both read it, and replay the entries past each frame's seq (DESIGN.md §13)."])
add("loc.writeCanvas", "writeCanvas(id, { ... })",
    "An incremental or full write of kobin-1 frames into the v1 store, through `putCanvas`.",
    ["No caller in the app; the tests drive the v1 store through it. The saver writes kobin-2 through `writeCanvas2`."])
add("loc.loadCanvasDoc", "loadCanvasDoc(id)",
    "A stored canvas as ONE kobin-1 document with plain arrays: its frames with the log tail folded in (`docFromStore`), or null.",
    ["Null for no canvas and on any read or fold failure.",
     "Callers: the gallery's download and its cloud catch-up for a canvas still in the v1 store, and `trashCanvas`, `duplicateCanvas` and `backupCanvasDoc` for a v1 canvas (a kobin-2 one is kept or copied whole)."])
add("loc.hasCanvasDoc", "hasCanvasDoc(id)", "Whether a canvas has a stored header.",
    ["Only the tests call it."])
add("loc.backupCanvasDoc", "backupCanvasDoc(id)",
    "Keeps a copy of a stored canvas that failed to open, before an autosave may write over it; best-effort.",
    ["A kobin-2 canvas is copied whole into the bin as '<name> (could not be opened)' (`binCopy`, every record, since reading it is what failed; F86), once per stored seq: a bin row with the same `backupOf` and `seq` means the copy is already there.",
     "A v1 canvas's `loadCanvasDoc` document goes to the `backups` store, one per canvas, the newest replacing the last; `sweepStorage` drops it after a week. Called when the editor's restore cannot decode the stored copy."])
add("loc.readTrashIndex", "readTrashIndex()",
    "The bin's index from localStorage: an empty list on anything malformed, rows without a string id dropped.",
    ["-"])
_REMOVE_WHAT = "Deletes a canvas with no bin row: its gallery row, and its stored records unless the bin holds it as a whole store."
_REMOVE_LONG = [
    "Its index row goes, and every stored record (header, frames, log) unless the bin lists the id as a whole store (`isBinnedStore`: binned by another tab or a cloud tombstone while this one had it open), which is the bin's to keep. Its thumbnails are left for `sweepStorage`.",
    "Called for a canvas the gallery never listed: the editor's delete of an empty scratch canvas, and Discard when leaving an unsaved one.",
]
add("loc.removeCanvas", "removeCanvas(id)", _REMOVE_WHAT, _REMOVE_LONG)
add("loc.isBinnedStore", "isBinnedStore(id)",
    "Whether the bin lists `id` as a whole store (`store: true`), read synchronously from the bin index.",
    ["The editor's leave prompt asks it: a canvas binned by another tab or a cloud tombstone while this one had it open is not offered as a draft, since the bin has it, edits included. `removeCanvas` leaves such a store to the bin."])
add("loc.isIndexed", "isIndexed(id)", "Whether the gallery index lists `id`.",
    ["A whole-store bin row whose id is listed again (a tombstone undone elsewhere) never deletes that store on expiry or purge (`readTrash`, `purgeTrashEntry`)."])
add("loc.migrateStorage", "migrateStorage()",
    "Runs the one-time move out of localStorage with this module's `docToRecord`; safe to call on every gallery load.",
    ["-"])
add("loc.sweepStorage", "sweepStorage()",
    "The gallery's housekeeping: adopts or deletes unlisted documents, then drops orphaned records, old backups, unreachable bin payloads and unlisted thumbnails.",
    ["A stored canvas that neither the gallery index nor the bin lists is adopted into the index when its header counts strokes (a crash or a killed tab kept it from being filed) and deleted when it counts none. Then: orphaned frame and log records, backups over a week old, bin payloads with no bin row, thumbnails of canvases in neither list, and the LRU budget. Expired bin entries go on the way past (`readTrash`).",
     "Returns the counts, for the console and the tests. The gallery runs it after the migration and before the legacy-autosave adoption."])
add("loc.storageUsage", "storageUsage()",
    "'Using 12 MB of browser storage', with the browser's usage and quota, or null where it will not say.",
    ["-"], "")
add("loc.formatMB", "formatMB(bytes)",
    "A byte count as MB or GB for the storage line, 'under 0.1 MB' below that.", ["-"], "")
add("loc.cloudPushSource", "cloudPushSource(id, writer)",
    "What the cloud push reads from the local store: the stored header, `read` for what the cloud lacks, a setter for the sync bookkeeping, and `alive`.",
    ["`read(cloudFrameSeq, fromSeq)` goes to `readPushState`, one transaction, so the header, frames and entries agree; `setSync` goes to `setSyncState` under the given `writer`. The editor's hook passes the tab's token; the gallery's catch-up passes none, so its bookkeeping is never fenced.",
     "`alive()` reads the header again and is false once another tab's token holds the store (always true without a writer); the push checks it before each part and stops, leaving its parts pending for a later push to sweep.",
     "Null for a canvas not yet in the kobin-2 store, which the gallery's catch-up then pushes as its kobin-1 document."])
add("loc.getStoreHeader", "getStoreHeader(id)",
    "A canvas's stored header (listing fields, seqs, sync fields), or null; never throws.",
    ["The session reads the local `base` from it at open (SYNC-PLAN R4)."])
add("loc.setSyncState", "setSyncState(id, patch, writer)",
    "Patches a stored canvas's sync fields without touching its frames; `addPending` and `dropPending` edit the pending chunk list in the same transaction.",
    ["The rest of `patch` is spread over the header. `addPending` adds chunks not already listed and `dropPending` removes the named ones, inside the transaction, so two patches at once both land. Resolves true, false for no canvas, or 'fenced' when `writer` is given and another tab holds the store."])
add("loc.claimStore", "claimStore(id, token)",
    "Stamps a tab's writer token on a stored canvas's header, so from then on only that tab's writes land (SYNC-PLAN R2).",
    ["Unfenced, being the claim itself; `putCanvas2` and `patchCanvasHeader` then refuse any other token as 'fenced'. The session calls it at each lock grant with a fresh token (the tab id and the grant's generation), which the saver then writes under."])
add("loc.replaceCanvasStore", "replaceCanvasStore(id, { ... }, writer)",
    "Writes a pulled kobin-2 canvas whole: its frames as the snapshots, its log replacing the local one.",
    ["`full`, `resetLog` and `rewind`, with the frame set from the pulled header, under the given `writer`. Used by `applyPulledStore` for a full pull and by the dev panel's Copy real."])
add("loc.applyPulledStore", "applyPulledStore(id, pulled, base, writer)",
    "Writes a cloud pull into the local store with `base` the cloud head it came from: whole for a full pull, else a fast-forward.",
    ["A full pull goes through `replaceCanvasStore`, rewound. A fast-forward writes only the frames it downloaded and the entries past the local seq, with the cloud's frame set and header, and is not rewound, so `putCanvas2` refuses it as 'stale' if the stored seq is ahead. `intent` is cleared either way (SYNC-PLAN R4).",
     "Resolves false for a fast-forward onto a canvas with no stored header, and 'fenced' when another tab holds the store. The session pulls in full after a refused fast-forward, and after 'fenced' or a refused full pull stops, blocked."])
add("loc.copyHeader", "copyHeader(h, name)",
    "A copied canvas's header: the new name in the header and the meta, a fresh `savedAt`, no cloud lineage and no writer.",
    ["Drops `base`, `intent`, `pending` and `writer`, so the copy is a canvas the cloud has never seen and no tab holds. Used by `forkCanvas` and `stashCanvasStore`."])
add("loc.stashCanvasStore", "stashCanvasStore(id, name)",
    "The bin's safety net for a store a pull is about to replace: the whole store copied to a new id named '<name> (overwritten)' and listed in the bin.",
    ["Through `binCopy`, so the copy keeps its op log and restores as it is. Returns the bin entry, or null when no copy landed, and then the pull does not happen (SYNC-PLAN R4).",
     "The session calls it before pulling over a local copy of unknown ancestry, and before a newer lz1 cloud copy replaces this one."])
add("loc.binCopy", "binCopy(id, label, extra)",
    "Copies a stored canvas whole to a new id named `label` and lists it in the bin as a whole-store row (`store: true`), with `extra` on the row; the bin entry, or null when no copy landed.",
    ["Through `copyCanvas2Chunked` with `copyHeader` (one frame per transaction, the header last), so the copy keeps its op log and has no cloud lineage or writer; the row takes the header's stroke and level counts. A restore lists it again as it is; an expiry or purge deletes its records. Used by `stashCanvasStore` and `backupCanvasDoc`."])
add("loc.forkCanvas", "forkCanvas(id, name)",
    "A conflict's copy: every record of the stored canvas copied to a new id named `name`, without its cloud lineage, and listed in the gallery.",
    ["Through `copyCanvas2Chunked` with `copyHeader`: one frame per transaction and the header last, so a large copy does not hold up other writes. The copy keeps its op log and undo history, and has no `base`, `intent`, `pending` or `writer`: the cloud has never seen it. The cover thumbnail is copied too. Returns the new index entry, or null when no copy landed (SYNC-PLAN R5).",
     "The session calls it when both this device and the cloud moved, before pulling the cloud's copy into this canvas; null blocks the pull."])


# ---- src/storage/foldStore.js ----
add("fld.logTail", "logTail(entries, frameSeq)",
    "The log entries the frame snapshots do not hold yet: all but those whose every touched frame has a snapshot at or past the entry's seq.",
    ["`OpLog.replay`'s rule inverted; an entry that touches no frame is always kept. `docFromStore` makes an engine only when it is non-empty."])
add("fld.plainRecords", "plainRecords(objects, geo)",
    "A kobin-2 frame decoded to kobin-1 records whose loops are plain arrays.",
    ["A decoded loop is a view into the frame's geometry buffer; a document bound for JSON, the bin or a backup must not carry one."])
add("fld.docFromStore", "docFromStore(res)",
    "A stored or pulled kobin-2 canvas as ONE kobin-1 document: its frame snapshots, plus its log tail replayed through a detached engine; a v1 canvas's `legacy` as it is; null for nothing (F86).",
    ["Without a log tail the frames are the document: decoded with plain arrays under the header's format, version, meta, camera and crossings, and no engine is made. With one, the frames go into a detached `KobinEngine` (1024 × 768, scenes off) loaded with `render: false`, since nothing is shown and a cold render is seconds (F87); `OpLog.replay` applies the entries past each frame's seq as the editor's restore does, and `serializeDrawing` is the result. The engine is destroyed either way.",
     "A log that will not replay gives the snapshots alone, with a console warning: the download is the way out for such a canvas.",
     "Takes `loadCanvasStore`'s result or `cloudPullCanvas2`'s. Callers: `loadCanvasDoc`, and `cloudLoadCanvas` for a kobin-2 cloud copy."])


# ---- src/storage/thumbnails.js ----
add("thm.withSvgEngine", "withSvgEngine(doc, w, h, fn)",
    "Runs `fn(engine, host)` on a one-off SVG engine over a copy of the document, off screen, and destroys it after.",
    ["Always the SVG engine (raster off, scenes off, outlines built at once), because a thumbnail or an export is made by serialising its `<svg>` and the raster path's ink is on a canvas no serialiser sees (DESIGN.md §9). The document is deep-copied through JSON and loaded, so the camera is the file's.",
     "Once `fn` settles the engine is destroyed (its renderer detaches the `<svg>` and clears its scene) and the host removed; what `fn` returns outlives them. Used by `renderThumbs` and by the SVG export in raster mode."],
    "§9")
add("thm.renderThumbsLive", "renderThumbsLive(engine, scenes, existing, opts)",
    "Scene thumbnails from the live raster engine: one `snapshotView` per scene whose hash changed, a few at a time, each landing as it is made.",
    ["Scenes whose stored hash still matches are skipped. Up to `opts.limit` lanes (4) run; each job waits for an idle callback, snapshots the scene's rect at 320×240 and encodes it with `scaleToDataUrl`. `opts.onThumb` fires per thumbnail so the panel fills progressively; `opts.signal` stops what has not started.",
     "Returns `{ out, missed }`: a scene the engine could not snapshot (raster off, an unreachable frame, no canvas context) is in `missed`. The editor renders those with `renderThumbs` only when raster is off; with raster on a miss keeps the scene's last picture.",
     "A cold frame's tile bake still runs inside `snapshotView` on the main thread (F59); the idle spacing keeps the panel responsive between jobs."],
    "§14")
add("thm.scaleToDataUrl", "scaleToDataUrl(bitmap, w, h)",
    "Copies the top-left `w`×`h` of a snapshot bitmap onto white and encodes it as a JPEG data URL; null without a 2D context.",
    ["The top-left is where `fitView` put the scene's rect in the plate (P3)."], "")


# ---- src/Pages/CanvasEditor.js (its row is newdesc_last's; this entry and the FIX below replace its text) ----
_EDITOR_LONG = [
    "The tool rail, the scenes panel, the scale HUD and the set-scale flow, the save, delete and keep-draft dialogs, the save bar, the sync status button in the title chip, the sync banner and the session's notices under the top bar (a notice about the pen moving is left to the banner, `showsNotice`), and the developer panel behind `?dev`. At a phone's width (`useNarrow`) the status button is an icon only and the title chip stops short of the top-right group.",
    "The cloud side is one `CanvasSession` per open canvas, started once the document is restored and sign-in has resolved (after 3 s it starts signed out): the device lock and cloud lease, the decision at open (push, pull or keep both), one push at a time, following another tab or device while read-only, and the hand-over (DESIGN.md §13).",
    "The engine is gated: read-only and not saving until the session holds the pen. Every tool but pan is disabled while read-only, which includes before the session starts. Leaving never offers to keep or discard a draft from a read-only tab, nor for a canvas the bin holds as a whole store (deleted elsewhere while open, `isBinnedStore`). A write the store refuses (another tab's, or ahead of this document) goes to the session (`onRefused`), which keeps the work in memory as a new canvas.",
    "The parts worth knowing: the save path serialises independently of whether the local write succeeded, so a full browser storage cannot take the cloud down with it; the session's dirty flag is driven off DOCUMENT CHANGES rather than off a successful local save, for the same reason; and the save notice is dismissible per KIND, so waving away 'autosave is off' does not also silence a real failure later.",
]
add("edt.CanvasEditor", "CanvasEditor()", "THE PRODUCT.", _EDITOR_LONG)


# ---- src/Pages/CanvasesV2.js (its row is newdesc_last's; its text there is still true, this adds the catch-up's form) ----
add("gal.CanvasesV2", "CanvasesV2()", "THE GALLERY.",
    ["Sign-in, the local and cloud listings merged by freshest timestamp, a one-way catch-up upload of canvases the account has not seen, tombstone propagation so a deletion elsewhere reaches this browser (one canvas at a time: each move rewrites the bin's index, and two at once can drop a row), rename, duplicate, download, delete, the recycle bin, and file import.",
     "The merge is the interesting part and it is deliberately asymmetric: a canvas this device has and the account does not is uploaded, but a canvas the account has TOMBSTONED is not - otherwise a stale device would resurrect everything anyone had deleted.",
     "The merged list shows before the catch-up, which can take minutes on a big canvas: one canvas at a time, a kobin-2 store as its chunks (`cloudPushSource`, never its JSON: F64), a v1 canvas as its document. A development build skips the catch-up, since its collection starts empty and would receive every local canvas (DESIGN.md §13)."])


# ---- src/Components/editor/SyncChip.js ----
add("syc.syncLabel", "syncLabel(sync, signedIn)",
    "The full sentence for a session state: the status button's accessible name, and the details card's headline when nothing shorter applies.",
    ["`sync` is `CanvasSession.state`, null until the session starts ('Opening…'). Then the read-only and hand-over states, a read-only tab naming why (another tab, or the holder device by name); then the cloud's. Signed out, with the cloud off, or for a canvas not yet in the gallery it reads 'Saved on this device'; any cloud state it does not name reads 'Saved'."])
add("syc.syncStatus", "syncStatus(sync, signedIn)",
    "What the status button shows for a session state: `{ key, short, icon, tone }`.",
    ["'Opening…' before a session. An error comes first, in red, except while editing offline; then viewing (read-only, or taking over), a hand-over shown as saving, checking, 'Saved here' when signed out, with the cloud off or for a canvas not yet in the gallery, saving, offline (amber), not synced (red), and 'Saved' with a cloud tick (green)."])
add("syc.syncSentence", "syncSentence(sync, signedIn)",
    "The details card's headline: the error when there is one, 'Saved to your account' when saved, 'Saving to your account…' while a signed-in editing tab saves, else `syncLabel`.",
    ["-"])
add("syc.syncName", "syncName(sync, signedIn, compact)",
    "The status button's accessible name: the full sentence, led on a desktop by the visible short label, with any error appended.",
    ["The visible label comes first so the name contains it (WCAG label in name); a compact button, whose face is an icon only, uses the sentence alone."])
add("syc.showsNotice", "showsNotice(n)",
    "Whether a session notice gets the notice banner: one with a message, except the pen-move notices (handed, lost, stolen), which the sync banner already shows.",
    ["-"])
add("syc.useNarrow", "useNarrow(max)",
    "React hook: true at a phone's width (480 px or less by default), kept current on resize.",
    ["Reads `matchMedia`, or the window width where it is missing. The editor uses it to make the status button an icon only and to bound the title chip."])
add("syc.svg", "svg(size, children, stroke, width)",
    "Wraps icon paths in a 24×24 outline SVG drawn at `size`, hidden from assistive technology.", ["-"], "")
add("syc.StatusIcon", "StatusIcon({ icon, size })",
    "The status icon by name: a cloud with a tick, with an up arrow or with an alert, a crossed-out cloud, an eye, or a plain tick.",
    ["-"], "")
add("syc.CheckIcon", "CheckIcon({ size })",
    "A tick in the sync green, for the details card's 'saved' headline and the 'You have the pen' banner.", ["-"], "")
add("syc.SyncDetails", "SyncDetails({ ... })",
    "The details card the status button opens: the state's headline and icon, the one-device-draws-at-a-time note, this device's name and Rename this device.",
    ["A dialog that takes the focus when it opens; a click outside (`useClickAway`) or Escape closes it, Escape handing the focus back to the button. Rename closes the card and calls `onRenameDevice`, which the editor answers with a prompt and `setDeviceName`."])
add("syc.SyncStatus", "SyncStatus({ ... })",
    "The save state as a button inside the title chip: its icon, plus the short label on a desktop; it opens the details card.",
    ["`compact` (a phone) shows the icon alone; the accessible name is `syncName` either way, and `data-sync` carries the status key."])
add("syc.bannerOf", "bannerOf(sync, took)",
    "What the sync banner shows for a state, or null: viewing only while read-only, taking or handing over while the pen moves, 'You have the pen' just after this tab took it.",
    ["Read-only names the other tab or the holder device and carries any error (a failed Edit here). `took` is the name of who had the pen; while editing otherwise nothing shows."])
add("syc.SyncBanner", "SyncBanner({ ... })",
    "The banner under the top bar: 'Viewing only' with Edit here while another tab or device has the pen, 'Taking over…' or 'Handing over…' while it moves, and 'You have the pen' after an Edit here lands.",
    ["It remembers who had the pen while read-only and whether this tab asked; on reaching editing after asking it shows 'You have the pen', '<who> is watching' under it, for `penMs` (4 s) with a dismiss button. Edit here calls `onTakeOver` (the session's `takeOver`). Nothing in the title row grows."])


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
    # -- names no longer in localCanvases.js
    "loc.packSlot": {"why": "gone", "what": None, "long": None},          # now db.packSlot (described above); localCanvases only re-exports it
    "loc.unpackSlot": {"why": "gone", "what": None, "long": None},        # now db.unpackSlot; localCanvases only re-exports it
    "loc.trashSlotKey": {"why": "gone", "what": None, "long": None},      # a bin payload is a record in the IndexedDB `trash` store (db.putTrashDoc)
    "loc.removeThumbs": {"why": "gone", "what": None, "long": None},      # db.deleteThumbs, called from readTrash and purgeTrashEntry
    "loc.loadCanvasRaw": {"why": "gone", "what": None, "long": None},     # loadCanvasDoc (kobin-1) and loadCanvasStore (kobin-2)
    "loc.saveCanvasRaw": {"why": "gone", "what": None, "long": None},     # saveCanvasDoc (whole) and writeCanvas2 (the saver)
    "loc.backupCanvasSlot": {"why": "gone", "what": None, "long": None},  # backupCanvasDoc, into the IndexedDB `backups` store

    # -- still in the file, text now false
    "loc.slotKey": {
        "why": "calls it the storage key for a canvas and the basis of listing and purging; it is the old localStorage key shape, which nothing writes",
        "what": "The old localStorage key of one canvas's slot, `kobin.canvas.<id>`; nothing writes it now.",
        "long": ["Exported for the tests of the one-time migration, which seed old slots with it; the migration itself (`db.migrateLocalStorage`) matches the prefix directly. Documents live in IndexedDB (DESIGN.md §13)."],
    },
    "loc.thumbKey": {
        "why": "calls it the key of a stored thumbnail; thumbnails are IndexedDB records keyed [canvasId, sceneId] and this is the old localStorage key shape",
        "what": "The old localStorage key of one scene thumbnail, `kobin.thumb.<canvas>.<scene>`; nothing writes it now.",
        "long": ["Exported for the migration's tests. Thumbnails are records in IndexedDB keyed `[canvasId, sceneId]`, under a 12 MiB LRU budget (`db.putThumbs`)."],
    },
    "loc.newCanvasId": {
        "why": "says four random characters; the code appends eight",
        "what": None,
        "long": ["Time in base 36 plus eight random base-36 characters: sortable and short. Four collided when two ids were minted in one millisecond (measured: 199 distinct ids from 200 in the uniqueness test).",
                 "Also mints the device id."],
    },
    "loc.getDeviceId": {
        "why": "names a cloud presence heartbeat; there is none now, the id rides the cloud lease and the manifest",
        "what": None,
        "long": ["`kobin.device` in localStorage, minted once with `newCanvasId`; 'unknown' where localStorage throws. The cloud lease and a push's manifest carry it, so a device recognises its own lease and, for a cloud copy from before versions, its own push (DESIGN.md §13)."],
    },
    "loc.readIndex": {
        "why": "calls the index a convenience over the slots; documents are IndexedDB records now",
        "what": None,
        "long": ["Returns an empty list rather than throwing on anything malformed, and drops rows without a string id. The index is a convenience over the stored documents, which are the real data (`sweepStorage` adopts any it misses), so it must never be the thing that stops the app starting."],
    },
    "loc.upsertIndexEntry": {
        "why": "says the gallery never sorts; a signed-in gallery sorts its merge with the cloud listing",
        "what": None,
        "long": ["Newest first, sorted on write, so the signed-out gallery shows the index as it stands; a signed-in gallery re-sorts its merge with the cloud listing."],
    },
    "loc.statsFromDoc": {
        "why": "says it measures the depth span; the span covers only frame ids that are plain numbers (the spine frames)",
        "what": None,
        "long": ["`statsFromNatives` over the document's natives: strokes in every frame, the level span over numeric frame ids only (the spine frames). It is also how the editor decides whether an unlisted canvas is worth keeping as a draft - a canvas with no strokes is not."],
    },
    "loc.removeCanvas": {
        "why": "says it is only for a never-saved empty scratch canvas and deletes outright; the leave dialog's Discard also calls it for an unsaved canvas with strokes, and a store the bin holds whole is left to the bin",
        "what": _REMOVE_WHAT,
        "long": _REMOVE_LONG,
    },
    "loc.readTrash": {
        "why": "says an expired entry takes its slot; it deletes the IndexedDB trash record, and a whole-store row's records unless the gallery lists that id again",
        "what": None,
        "long": ["Expiry happens on read rather than on a timer. There is no timer in a browser that can be relied on to run, and the bin is only interesting at the moment somebody looks at it.",
                 "An expired entry, older than 30 days (`TRASH_TTL_MS`), takes its stored document and its thumbnails with it, and for a whole-store row (`store`: a binned kobin-2 canvas, a stash or a backup) the store's records too, unless the gallery lists that id again (`isIndexed`)."],
    },
    "loc.trashCanvas": {
        "why": "says the slot is moved verbatim for a byte-identical restore; a kobin-2 canvas stays stored and only its row moves, and only a v1 canvas's document is copied into the bin",
        "what": "Moves a canvas to the recycle bin: a kobin-2 canvas stays stored and only its row moves; a v1 canvas's document goes to the `trash` store and its records are deleted.",
        "long": ["A kobin-2 canvas keeps every record, op log and undo history included. Its bin row carries `store: true` and the header's stroke and level counts, so a restore only lists it again and an expiry or purge deletes the records.",
                 "A v1 canvas's document is `loadCanvasDoc`'s (plain arrays), written anew on a restore. If that bin write fails the stored canvas is still deleted and the row still listed; a cloud copy, where there is one, holds the data.",
                 "An older bin row for the same id is dropped first, so it cannot expire over this one. The fallback entry covers a canvas with no index row - a never-saved scratch, or a cloud-only listing - so the bin still shows a row for it."],
    },
    "loc.restoreCanvas": {
        "why": "speaks of a local slot; a whole-store row is only listed again, and a v1 document goes back through saveCanvasDoc as a fresh kobin-2 store",
        "what": None,
        "long": ["A whole-store row (`store`: a binned kobin-2 canvas, a stash or a backup) still has its records, so it is only listed again, without its bin fields. Otherwise the bin's document goes back through `saveCanvasDoc`: a fresh kobin-2 store with an empty log and no cloud lineage. The index row is rebuilt only when the bin held a stored document; a cloud-only row comes back through the cloud listing instead, which is the one path that has the data.",
                 "If the write fails (quota) the entry stays in the bin rather than being lost between the two."],
    },
    "loc.stashOverwrittenVersion": {
        "why": "calls it the safety net for two devices editing one canvas; nothing in the app calls it now (a conflict forks with forkCanvas, a store about to be pulled over is kept whole with stashCanvasStore). The fn cell's first parameter is now `doc` (a document or its JSON)",
        "what": None,
        "long": ["Given a FRESH id and a '(overwritten)' name, so restoring it becomes its own canvas rather than fighting the live one for the same id. `doc` may be a document or its JSON.",
                 "No caller in the app; only the tests call it. The session keeps a store it is about to pull over with `stashCanvasStore` (the whole store, op log included) and a conflict's copy with `forkCanvas`."],
    },
    "loc.purgeTrashEntry": {
        "why": "speaks of a slot and calls it the module's only irreversible operation; removeCanvas, the bin's expiry and sweepStorage also delete outright",
        "what": None,
        "long": ["Bin row, stored document, thumbnails and, for a whole-store row (`store`), the store's records unless the gallery lists that id again (`isIndexed`); nothing local keeps a copy. The module's other outright deletes are `removeCanvas`, the bin's expiry in `readTrash` and `sweepStorage`'s removal of empty unlisted documents."],
    },
    "loc.duplicateCanvas": {
        "why": "speaks of a fresh slot; a kobin-2 canvas is forked with every record, and only a v1 or cloud-only canvas is written anew from its document. The fn cell's `fallbackJson` is now `fallbackDoc` (a document or its JSON)",
        "what": "Copies a canvas to a new id and gallery row named '<name> copy': a kobin-2 canvas through `forkCanvas`, anything else written whole from its kobin-1 document.",
        "long": ["A kobin-2 canvas is copied record for record (`forkCanvas`: op log, undo history and cover thumbnail kept, no cloud lineage); null when the copy fails. A v1 canvas's document is `loadCanvasDoc`'s, written by `saveCanvasDoc` as a fresh store with no undo history, and its cover thumbnail is carried across.",
                 "Takes a fallback document, or its JSON, for a cloud-only canvas whose data was fetched separately (the gallery's `cloudLoadCanvas`)."],
    },
    "loc.migrateLegacyAutosave": {
        "why": "says the dev harness still reads the legacy key and speaks of a slot; nothing reads `kobinAutosave` now and the drawing goes to IndexedDB",
        "what": None,
        "long": ["The pre-multi-canvas app kept one drawing in `kobinAutosave`. On the first gallery visit a drawing with strokes is written as a canvas (`saveCanvasDoc`) with its own index row; an empty one is not.",
                 "The legacy key is left in place as a safety net; nothing else reads it. A flag stops the migration running twice, and is not set when the write fails, so the next visit retries."],
    },
    "loc.saveThumbs": {
        "why": "says each write is independent; the batch is one IndexedDB transaction, so a failure loses all of it",
        "what": None,
        "long": ["One transaction through `db.putThumbs`, which also trims the store to its LRU budget: a failure loses the batch, and is swallowed because thumbnails are derived data, made again next time."],
    },
    "thm.rasterize": {
        "why": "says it rasterises the live SVG; its one caller passes the one-off SVG engine's `<svg>` (renderThumbs), and 'live' now names the raster engine's path",
        "what": "Turns the one-off SVG engine's `<svg>` into a 320×240 JPEG data URL.",
        "long": None,
    },
    "thm.renderThumbs": {
        "why": "calls it the most expensive thing the editor does, inside the save path; on the raster default it does not run, only with raster off",
        "what": None,
        "long": ["It builds a WHOLE SECOND ENGINE (`withSvgEngine`, the SVG one), loads the drawing into it and jumps it to each scene in turn, rasterising each view.",
                 "The editor calls it only with raster off (`?svg`); on the raster default thumbnails come from the live engine (`renderThumbsLive`), because a second engine on the Magnum Opus drawing is an out-of-memory reload.",
                 "Only scenes whose content hash has changed are re-rendered. Returns only the new entries."],
    },
    "edt.CanvasEditor": {
        "why": "names a presence heartbeat and a cloud pull of the editor's own; the cloud side is now one CanvasSession (lock, lease, open decision, push, follow, hand-over), with a gated engine, a read-only mode, the sync status button and the sync banner",
        "what": None,
        "long": _EDITOR_LONG,
    },
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]
