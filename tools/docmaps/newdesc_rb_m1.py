# -*- coding: utf-8 -*-
"""Per-function entries for the oracles added by the rebuild: the brute-force render list
(__oracles__/renderList.js), the scene oracle's additions, and the frozen pre-C1 model
(__oracles__/model-v1/, A1 §14). One-liners; a model-v1 function whose body is the live file's
same function at 6efaaf4 or 56e36b3 carries that entry as it was, except where the 56e36b3 entry
was written against another body (its length differs on the 09-23 pages): those, and the rest,
were read. ROLE written 2026-10-05; the entries 2026-10-20."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


_FROZEN = ("Frozen with the rest of the pre-C1 model at 5e9b1dd (A1 §14), which the model fuzzes and "
           "probes compare the live model against; not on any route.")
_WHAT = {
    "KobinEngine": "The engine facade as it was before C1.",
    "erasePipeline": "The erase pipeline as it was before C1.",
    "overlays": "The selection indicator and the debug overlays as they were before C1.",
    "selection": "Selection and moving as they were before C1: a drag re-addressed its frames every event, against the lattice the previous event had left.",
    "sceneOps": "The scene operations as they were before C1.",
    "files": "Undo, redo, delete and the files as they were before C1.",
    "eraseDescent": "The erase descent as it was before C1.",
    "eraseWorkerClient": "The erase worker client as it was before C1.",
    "cede": "The cede as it was before C1.",
    "LevelMap": "The lattice as it was before C1: a frame's shift a debt settled into its natives at the first read.",
    "frameGc": "Frame GC as it was before C1.",
    "TileStore": "The tile cache as it was before C1.",
    "Renderer": "The SVG renderer as it was before C1.",
    "Stage": "The scene as it was before C1.",
    "placementModel": "The placement model as it was before C1.",
    "Document": "The document as it was before C1.",
    "persist": "The file format as it was before C1.",
    "format2": "The store's frame encoding as it was before C1.",
    "oplog": "The op log and its replay as they were before C1.",
    "offsets": "The displacement tables as they were before C1.",
    "sceneClient": "The scene index's client as it was before C1.",
    "rasterShim": "Stand-ins for the raster modules the frozen engine imported, which the rebuild deleted.",
}
ROLE = {"src/engine/__oracles__/model-v1/%s.js" % f: w + " " + _FROZEN for f, w in _WHAT.items()}
ROLE["src/engine/__oracles__/renderList.js"] = (
    "The render list by brute force over a rect — every tile read from the store, the moved natives read back where "
    "their picture is, the frame's live natives, stamped and sorted: the list the SVG path drew until B-PYRAMID-3. "
    "The Stage's table and the plates are checked against it.")


# ---- src/engine/__oracles__/renderList.js, sceneOracle.js's additions ----
add("rls.tileContent", "tileContent(store, frameKey, rect)",
    "The pieces of the tile store's tiles over a rect in a frame — every tile, both directions, a moved native's pieces read back from where its picture is (`reroute`) — without the frame's live natives: `TileStore.content` as it was until B-PYRAMID-3.",
    ["An off-camera read: the camera's pins are put back by value and the eviction held until the end, so it never unpins or evicts the camera's tiles. `[]` for an unreachable frame."],
    "§15")
add("rls.renderList", "renderList(E, frameKey, rect)",
    "The render list over a rect by brute force: `tileContent` and the frame's live natives, stamped with what the old list carried (`editId`, a pending mark's pieces as `erase` at its z, the residual as `res`) and sorted by (z ?? id, id) — what the Stage's table and the plates are checked against.",
    ["-"], "§15")
add("rls.reroute", "reroute(store, lm, F, win, out)",
    "A moved native read from where its picture is (F55, A1 C1): its pieces in F's own tiles dropped, and each reroute group's read from its source frame's tiles over the window shifted back by the group's remainder.",
    ["-"], "§15")
add("sor._pad", "_pad(r, wmin)",
    "A scene's rectangle widened to at least `wmin` on each axis about its centre, then padded on every side by `FRAME_PAD` of its longer side.",
    ["-"], "§15")
add("sor._partCount", "_partCount(S, fr)",
    "How many parts a scene gets: the tree of cuts — each piece wider than the limit cut at the emptiest of 32 bins over its middle 60 % — expanded from the root, the widest open piece first, while fewer than `MAX_PARTS`; 0 for one member, a scene within the limit, or a single part.",
    ["-"], "§15")


# ---- src/engine/__oracles__/model-v1/: entries carried from the identical live body ----
add('m1doc.flattenLoops', 'flattenLoops(o)',
    "Turns a shape's plain piece-array loops into stored Loops, in place, at the door of the document.",
    ['Every way a shape enters or changes in the document calls it (`add`, `insertAt`, the geometry edits, `insertFrameSubtree`); builders hand over piece arrays and never see them again (DESIGN.md §3). A loop that already is a Loop is left as it is.', 'Not `curveOutline.flattenLoops`, which flattens arcs to polygons.'], "§15")
add('m1doc.LevelIndex', 'LevelIndex',
    'A uniform grid hash per level, with an overflow list for anything bigger than a cell.',
    ['A uniform grid hash per level, with an overflow list for anything larger than a cell.', 'Objects are indexed by their painted extent. A stroke gets a half-width margin, because round caps and joins never reach further than that from the centreline; a resolved outline gets **none**, because its bounding box already *is* the ink.'], "§15")
add('m1doc.LevelIndex.constructor', 'LevelIndex.constructor()',
    'A uniform grid hash per level, with an overflow list for anything bigger than a cell.',
    ['A uniform grid hash per level, with an overflow list for anything larger than a cell.', 'Objects are indexed by their painted extent. A stroke gets a half-width margin, because round caps and joins never reach further than that from the centreline; a resolved outline gets **none**, because its bounding box already *is* the ink.'], "§15")
add('m1doc._key', '_key(cx, cy)',
    'A uniform grid hash per level, with an overflow list for anything bigger than a cell.',
    ['A uniform grid hash per level, with an overflow list for anything larger than a cell.', 'Objects are indexed by their painted extent. A stroke gets a half-width margin, because round caps and joins never reach further than that from the centreline; a resolved outline gets **none**, because its bounding box already *is* the ink.'], "§15")
add('m1doc._cellsOf', '_cellsOf(b, fn)',
    'A uniform grid hash per level, with an overflow list for anything bigger than a cell.',
    ['A uniform grid hash per level, with an overflow list for anything larger than a cell.', 'Objects are indexed by their painted extent. A stroke gets a half-width margin, because round caps and joins never reach further than that from the centreline; a resolved outline gets **none**, because its bounding box already *is* the ink.'], "§15")
add('m1doc.LevelIndex.add', 'LevelIndex.add(o)',
    "Index an object by its painted extent and grow the frame's bounds: the union box, the largest object, the highest z.",
    ["A stroke's box gets a half-width margin; a resolved shape or a fill none, since its box already is the ink. A box over four cells across goes to the overflow set.", "`ext`, `maxSize` and `maxZ` only grow (a removal leaves them), so they bound what the frame holds: the bake's whole-frame skip reads the first two (`frameExtent`), the frame-covering erase the third (`maxZUnder`)."], "§15")
add('m1doc.remove', 'remove(o)',
    'Takes an object out of the spatial index.',
    ['Uses the box recorded when it went IN, not its current one. An object that has moved would otherwise be removed from the cells it now occupies and left behind in the ones it used to.'], "§15")
add('m1doc.nativeFromRecord', 'nativeFromRecord(o)',
    'A stored record, kobin-1 JSON or a kobin-2 span, as a live native: retired fields stripped, the table decoded, damaged loops repaired.',
    ['Drops `windows`, `srcId` and `paths`; decodes `below`, dropping a malformed one rather than refusing; keeps header fields this build does not know as `_extra` so they are written back. A well-formed encoding is wrapped as Loops with no copy; only a damaged one is decoded, repaired and rebuilt.', "A fill stays a fill; `fillToShapeById` converts one when something cuts it. Used by `loadNatives` and the op log's replay."], "§15")
add('m1doc.Document', 'Document',
    'The source of truth.',
    ['Every native object, the id counter that doubles as z-order, the undo stacks, and the per-box spatial index. No rendering, no camera, no tiles.', 'Its change events carry the OLD footprint as well as the new one, which is what lets the tile cache invalidate both where an object was and where it now is - the guarantee that makes stale-tile ghosts impossible rather than merely rare.'], "§15")
add('m1doc._noteBelow', '_noteBelow(o)',
    "Keeps the set of moved objects (`_offsetIds`) in step with one object's displacement table.",
    ['An object with a non-empty table is added; one without is removed and its empty `below` key deleted. Called wherever a table can change or an object enters.'], "§15")
add('m1doc.hasOffsets', 'hasOffsets()',
    'Does any native carry a displacement table? O(1), asked by the tile store on every bake.',
    ['-'], "§15")
add('m1doc.offsetIds', 'offsetIds()',
    'The ids of every native with a displacement table, for the scans that must judge moved objects where their picture is.',
    ["The live set, not a copy. The tile store's reroute, the lasso's moved-object pass and the report read it; the erase's candidate scan reads `_offsetIds` directly."], "§15")
add('m1doc.subscribe', 'subscribe(fn)',
    'Every mutation notifies, so the tile cache can invalidate both directions — deeper tiles inherit it magnified, coarser ones minified.',
    ['Notifies every subscriber of a change.', 'The tile cache is the main subscriber, and it needs both directions: deeper tiles inherit an object magnified, coarser tiles inherit it minified.'], "§15")
add('m1doc.offTouchedSince', 'offTouchedSince(rev)',
    'The ids whose table or home may have changed since the table revision was `rev`, or null when that cannot be told — so a reader memoised at `rev` re-reads only these.',
    ["Null when an event since named no one object, or the log no longer reaches back. The store's `_rerouteGroups` reads it: re-walking 19.7k moved natives was 166 ms of a drop on the Magnum Opus (TESTER-3)."], "§15")
add('m1doc.subscribeOps', 'subscribeOps(fn)',
    "Subscribes to the op channel: what the user did, as opposed to the change events' what moved on screen.",
    ['Carries every fresh undo op, every bake step appended to one, every undo and redo, every settle and every shadow merge, in order. The op log (the saver), the scene client and the editor hook subscribe. Returns the unsubscribe function.'], "§15")
add('m1doc._notifyOps', '_notifyOps(ev)',
    'Sends one op-channel event to every op subscriber.',
    ['-'], "§15")
add('m1doc.recordBake', 'recordBake(op, step)',
    "Appends a bake step to a gesture's eraseCommit op and announces it on the op channel; the one way steps are appended.",
    ['A step is `{ removed, pieces }`, `{ rekey }` or `{ frames }`; undo runs them newest first. The announcement is what puts the step in the op log.'], "§15")
add('m1doc.noteId', 'noteId(id)',
    'Keeps the id counter above an id a replayed log entry brought in, so no id is handed out twice.',
    ['-'], "§15")
add('m1doc.noteRefile', 'noteRefile(frameId, from, to)',
    'Announces that a subtree move re-addressed a frame, so the tile cache can re-file its tiles.',
    ['Emits a `refile` change event with the old and new `{ parent, i, j }`. No native changes.'], "§15")
add('m1doc.keysChanged', 'keysChanged(ids)',
    'Marks the family index stale after an editId changed in place, bumps the revision, and tells the subscribers which ids were re-keyed (`rekey`).',
    ['-'], "§15")
add('m1doc.allocId', 'allocId()',
    'Ids are handed out in creation order, which is also drawing order.',
    ['Hands out the next id. Ids are creation order, which is also drawing order, and they are never reused.'], "§15")
add('m1doc.levels', 'levels()',
    'Storage keyed by home frame. at is a plain read of the stored list: no read merges, settles or mints (A1 C1; DESIGN.md §8).',
    ["A plain read since A1 C1: no read merges, settles or mints. A frame's shift is its natives' placement, composed where they are drawn (DESIGN.md §8)."], "§15")
add('m1doc._forgetIfEmpty', '_forgetIfEmpty(k)',
    "Drop a box's bucket when its last object goes. A drag allocates one per pointer event; one measured session had 4,343 empty of 4,369, and dropping them took a render from 195 ms to 23.",
    ["Drops a box's bucket when its last object leaves.", 'Not housekeeping. Buckets are walked per tile bake and scanned per lookup, so an empty one costs on every render for the rest of the session — and they accumulate fast, because a drag re-homes on every pointer event and every erase cedes down a chain.', 'Measured on a real session: 4,343 of 4,369 buckets were empty, and dropping them took a render from 195 ms to 23.'], "§15")
add('m1doc.at', 'at(level)',
    "Storage keyed by home frame. at is not a plain read: it merges the frame's shadows and settles its pending shift first (DESIGN.md §8).",
    ["The first read of a frame after a subtree move pays for it: shadows merge (`_mergeShadows`, held while a drag is in progress) and the shift is settled into every native's table (`_settleIfPending`). Scans that need only identity use `list` or `count`, which do neither (DESIGN.md §8)."], "§15")
add('m1doc.count', 'count(level)',
    "A frame's native count as stored, with no shadow merged and no shift settled.",
    ["For scans that only need a number (the selection's status, the tile store, the report); `at` would pay a settle on every frame it counted (DESIGN.md §8)."], "§15")
add('m1doc.list', 'list(level)',
    "A frame's list as stored, for scans that need identity or flags only; never for positions.",
    ["No shadow merged and no shift settled, so a walk over every frame does no per-native work on frames nobody has looked at. The erase's mark and family scans, the overlays and the report read it (DESIGN.md §8)."], "§15")
add('m1doc.setFrameShift', 'setFrameShift(frameId, shift)',
    "Sets the shift a frame's natives owe after a subtree move; a zero shift clears it.",
    ["Nothing is applied here; the first read of the frame's list settles it (`_settleIfPending`)."], "§15")
add('m1doc.noteFrameOwner', 'noteFrameOwner(frameId, entry)',
    'Records which move-op entry last placed a frame, so a later settle or merge of it lands on that entry; null forgets.',
    ['-'], "§15")
add('m1doc.mergeReplay', 'mergeReplay(rec)',
    "Replays a logged shadow merge on the natives: the record's ids re-homed into the resident.",
    ["Idempotent from wherever a snapshot left them; the shadow's empty list is forgotten. The lattice needs nothing: the logged lattice already holds the result (DESIGN.md §13)."], "§15")
add('m1doc.unmergeReplay', 'unmergeReplay(rec)',
    "Replays the undo of a logged merge: the record's ids re-homed back into the shadow frame.",
    ['-'], "§15")
add('m1doc._idx', '_idx(level)',
    'Storage keyed by home frame. at is a plain read of the stored list: no read merges, settles or mints (A1 C1; DESIGN.md §8).',
    ["A plain read since A1 C1: no read merges, settles or mints. A frame's shift is its natives' placement, composed where they are drawn (DESIGN.md §8)."], "§15")
add('m1doc._keyIn', '_keyIn(k, o)',
    'Keep the per-frame set of natives with a family key (an `editId`: ceded kids, erase pieces) as natives enter and leave frame `k`.',
    ['-'], "§15")
add('m1doc._keyOut', '_keyOut(k, o)',
    'Keep the per-frame set of natives with a family key (an `editId`: ceded kids, erase pieces) as natives enter and leave frame `k`.',
    ['-'], "§15")
add('m1doc.keyedIn', 'keyedIn(frame)',
    'The natives of a frame with a family key, or null; and every frame holding one — so the lasso reads only the keyed natives under the frames it encloses, never their other natives.',
    ['-'], "§15")
add('m1doc.keyedFrames', 'keyedFrames()',
    'The natives of a frame with a family key, or null; and every frame holding one — so the lasso reads only the keyed natives under the frames it encloses, never their other natives.',
    ['-'], "§15")
add('m1doc.finalize', 'finalize(o)',
    'A live stroke stays out of the index until it stops growing, then is re-announced against its final extent.',
    ['Marks a live stroke finished: indexes it against its final extent and re-announces it, so the tile cache invalidates against the right footprint.'], "§15")
add('m1doc.getById', 'getById(id)',
    'Identity, and the family a piece belongs to.',
    ["One lookup in the id map, kept in step by every add, insert, removal and replace; the record's `level` is the object's home frame (`_home`).", 'Null for a native of a frame set aside by a subtree removal: it stays in the map by reference and comes back with the frame.'], "§15")
add('m1doc.editKey', 'editKey(o)',
    'Identity, and the family a piece belongs to.',
    ["One lookup in the id map, kept in step by every add, insert, removal and replace; the record's `level` is the object's home frame (`_home`). A deleted subtree's natives leave the map with it and come back with its undo."], "§15")
add('m1doc.editGroup', 'editGroup(idOrObj)',
    'Identity, and the family a piece belongs to.',
    ['Every object sharing one family key.', 'A family is the pieces of one logical object spread across levels by ceding. They select, move and undo together.'], "§15")
add('m1doc.moveById', 'moveById(id, dx, dy)',
    "Translate an object's stored coordinates — only where a move does touch them: a member the pen-up walks back into its cell, and old move entries.",
    ["A shape's loops are replaced by translated Loops (nothing writes through a piece view, DESIGN.md §3); a fill's or stroke's points shift in place; the attach rect moves with it. Then `_afterEdit`.", "Callers: `_normalizeHome` at pen-up, the undo of a move entry from before F41, and the op log's replay of either."], "§15")
add('m1doc.setGeometryById', 'setGeometryById(id, geom)',
    "Replace geometry outright, with its attach rect, grid phase and table when the snapshot carries them — for promotion and a move's undo. A drag never calls it: a drag changes addresses and displacement tables.",
    ["A key present in the snapshot but empty clears that field, so an undo restores 'no phase' as well as a phase. Busts the caches, reindexes and announces with the old footprint (`_afterEdit`).", "Callers: promotion to the parent level (`_promoteOversize`), the undo of a move entry with geometry snapshots (`_undoMove`), and the op log's replay of one."], "§15")
add('m1doc.maxZUnder', 'maxZUnder(rootId)',
    "An upper bound on the z of everything under a frame subtree: the erase's test for taking a frame whole.",
    ["The largest `maxZ` of the subtree's indexes (which only grow) and the z of any pending stroke homed there. `maxZUnder(F) < z` means nothing under F is drawn above z (DESIGN.md §7)."], "§15")
add('m1doc.setHandledById', 'setHandledById(id, markId, {inkless})',
    "A mark's bake dealt with native `id` without cutting it — a refusal or a graze (A2 §4.1): the mark joins its `handledBy`, so the erase rule stops masking it; logged as an `attr` entry (A2 §4.9).",
    ['`inkless`: no ink of it lay under the mark, so no pixel changes. Nothing is emitted when the mark is already there.'], "§15")
add('m1doc.setTargetsById', 'setTargetsById(id, targets)',
    "A mark's `targets`, recorded once when its shape lands (A2 §4.2), as an `attr` entry in the log — what a reopened mid-bake erase resumes from.",
    ['-'], "§15")
add('m1doc.setZById', 'setZById(id, z)',
    "Changes one object's z alone; the eraser mark's z steps down this way as its bake proceeds.",
    ["Raises the frame index's `maxZ` bound if needed and emits a `change` with `attrOnly`, which the tile store ignores; the next render re-sorts. Returns the previous z (DESIGN.md §7)."], "§15")
add('m1doc.snapGeometry', 'snapGeometry(o)',
    'A detached copy to translate from — including the tile offset, because that offset is geometry, and a drag that left it behind would slide the object out from under its own cutting grid.',
    ["A detached copy of an object's geometry, safe to translate from later.", '**Includes the tile-grid offset**, because that offset is geometry: it is where the object gets chopped, and a chop is where a curve may become a line. A drag that left it behind would slide the object out from under its own cutting grid — the exact failure the object-anchored grid exists to prevent.'], "§15")
add('m1doc.scaleGeometry', 'scaleGeometry(g, f, cx, cy)',
    "Change an object's units by a power of two. What promotion to the parent level does — the mantissa is untouched and only the exponent moves.",
    ['A geometry snapshot under a uniform scale about a point.', "Used to change an object's **units** — promoting an over-wide object to its parent level, where the same ink is described by numbers a crossing ratio smaller. Dividing by a power of two is a change of units and not a loss of relative precision: the mantissa is untouched and only the exponent moves."], "§15")
add('m1doc.translateGeometry', 'translateGeometry(g, dx, dy)',
    'A snapshot, moved. Never mutates the snapshot.',
    ['A geometry snapshot, moved. Never mutates the snapshot, so a drag can translate from the same starting state on every event.'], "§15")
add('m1doc.eraseReplaceById', 'eraseReplaceById(id, regions, by, dust)',
    'Replace an object with what an area erase left of it. One region keeps the family key — the same object with less ink; several regions is a genuine split and the pieces are strangers.',
    ['Replaces an object with the regions an area erase left of it.', "Each region becomes its own object with a fresh id, inheriting the source's drawing order, colour and opacity, so disjoint leftovers select and re-erase independently with tight bounding boxes.", '**One region keeps the family key** — that is the same object with less ink, a bite that did not sever. **Several regions is a split**, and the pieces are rightly strangers. Getting this wrong cost two debugging rounds: outlining a stroke minted a new family key, so every reference taken beforehand silently named nothing.', 'The pen width travels with every piece, so a stroke cut in two still clusters as the stroke it was rather than as two blobs the size of their bounding boxes.'], "§15")
add('m1doc.bakeShapeById', 'bakeShapeById(id, loops, w)',
    "A drawn stroke becomes its resolved outline, keeping its id — and so its drawing order, the selection pointing at it, and every undo record naming it. No undo entry: baking is the machine's decision, not the user's.",
    ['Turns a drawn stroke into its resolved outline, in place.', '**Keeps the id**, and so the drawing order, the selection pointing at it, and every undo record that names it.', 'Drops the centreline: it has done its job, nothing downstream reads it again, and keeping both would mean keeping them in agreement forever. The pen width survives as a property of the shape, which scene clustering needs and a perimeter cannot otherwise report.', "**Pushes no undo entry.** Baking is a system action — the user drew a stroke, and undo must reverse *that*, not the machine's decision about how to store it."], "§15")
add('m1doc.fillToShapeById', 'fillToShapeById(id)',
    'A pre-arc polygon fill becomes an outline — only when something is about to cut it, which is the only time the arc form buys anything.',
    ['Converts a legacy polygon fill into a resolved outline, in place.', 'Only ever called when something is about to cut the object. Everything else reads a fill perfectly well as it is, so this is not a migration — it is a promotion at the moment it pays for itself. One recorded drawing carries a 1.8-million-vertex fill, and converting that at load would cost more than everything else on the way in put together.'], "§15")
add('m1doc._bboxNow', '_bboxNow(o)',
    'Bust the derived caches, reindex, and announce with the old footprint so the cache can invalidate where the object was as well as where it is.',
    ['After any edit: drop the derived caches attached to the object, bump its edit counter, reindex it, and announce the change **with the old footprint** so the tile cache can invalidate where the object was as well as where it is now.', "The edit counter matters more than it looks: the renderer's signature rounds coordinates, and at the deepest in-level zoom a whole pixel of drag is below that rounding. Without the counter a dragged object would keep its old path and sit still while the pointer moved."], "§15")
add('m1doc._afterEdit', '_afterEdit(o, level, oldBbox, oldLw)',
    'Bust the derived caches, reindex, and announce with the old footprint so the cache can invalidate where the object was as well as where it is.',
    ['After any edit: drop the derived caches attached to the object, bump its edit counter, reindex it, and announce the change **with the old footprint** so the tile cache can invalidate where the object was as well as where it is now.', "The edit counter matters more than it looks: the renderer's signature rounds coordinates, and at the deepest in-level zoom a whole pixel of drag is below that rounding. Without the counter a dragged object would keep its old path and sit still while the pointer moved."], "§15")
add('m1doc.queryRect', 'queryRect(level, rect)',
    'Spatial query, plus any still-growing live stroke, which cannot be indexed.',
    ['Objects overlapping a rectangle at one level, from the spatial index, plus any still-growing live stroke — which cannot be indexed and so is reported unconditionally.'], "§15")
add('m1doc.frameExtent', 'frameExtent(level)',
    'What a frame holds, as a bound: the union box with line width and the largest object size, pending strokes included.',
    ["From the index's `ext` and `maxSize`, which only grow. The tile store's down-bake skips a frame whole when the bound is under the cull or off the tile; null for an empty frame."], "§15")
add('m1doc._undoMove', '_undoMove(moves)',
    'Undo a move: the frame back first, then the geometry snapshot where the pen-up normalised a member, then the displacement table — byte-exact on the stored natives.',
    ['Each step is independent, so a normalised member carries both pairs. An entry with only `dx`/`dy` is from before F41 and is undone by the inverse translation. `_invertMove` swaps each pair for the redo (DESIGN.md §8).'], "§15")
add('m1doc._invertMove', '_invertMove(m)',
    'Undo a move: the frame back first, then the geometry snapshot where the pen-up normalised a member, then the displacement table — byte-exact on the stored natives.',
    ['Each step is independent, so a normalised member carries both pairs. An entry with only `dx`/`dy` is from before F41 and is undone by the inverse translation. `_invertMove` swaps each pair for the redo (DESIGN.md §8).'], "§15")
add('m1doc.namedFrames', 'namedFrames()',
    'Every frame an op in the undo or redo history names (`opFrames`): frame GC keeps them (F94).',
    ['-'], "§15")
add('m1doc.noteForgotten', 'noteForgotten(frames)',
    "One collection's forgotten frames, sent to the op log as a `forget` record (F94).",
    ['-'], "§15")
add('m1doc.canUndo', 'canUndo()',
    "Op inversion. One gesture is one action, however much geometry it touched; an eraser's background work appends to the same action rather than making its own.",
    ['Records an action, caps the history, and clears the redo branch — a fresh action forks history. The ops it drops go to `onOpsDropped`, since frames they named may then be collected (F94).'], "§15")
add('m1doc.canRedo', 'canRedo()',
    "Op inversion. One gesture is one action, however much geometry it touched; an eraser's background work appends to the same action rather than making its own.",
    ['Records an action, caps the history, and clears the redo branch — a fresh action forks history. The ops it drops go to `onOpsDropped`, since frames they named may then be collected (F94).'], "§15")
add('m1doc.undo', 'undo()',
    "Op inversion. One gesture is one action, however much geometry it touched; an eraser's background work appends to the same action rather than making its own.",
    ['Records an action, caps the history, and clears the redo branch — a fresh action forks history.'], "§15")
add('m1doc.redo', 'redo()',
    "Op inversion. One gesture is one action, however much geometry it touched; an eraser's background work appends to the same action rather than making its own.",
    ['Records an action, caps the history, and clears the redo branch — a fresh action forks history.'], "§15")
add('m1doc._carrySeq', '_carrySeq(op, inv)',
    "Copies an op's log seq onto its inverse, so a redo is a log entry rather than a reset (F71).",
    ['-'], "§15")
add('m1doc._stepIndex', '_stepIndex(extra)',
    "The bake steps of every erase gesture in history in the order they landed, with the step that consumed each object, each step's gesture and the applied gestures — so undo and redo follow what each step consumed, not the stack.",
    ["Two marks pending at once bake out of stack order: one's step can cut the other's piece and then cut it again (REVIEWER-3 ERASE-2, F118). Each step carries `_on` (applied); a step rebuilt by a reload has none and is taken as applied when its gesture is, its source is gone and the step that minted its source is applied."], "§15")
add('m1doc._revertStep', '_revertStep(st)',
    "Undoes one bake step: a frame the mark covered whole comes back with its subtree, a severance's re-key runs backwards, else the step's pieces go and its source comes back.",
    ["The source comes back only for pieces the step still owns: pieces something unrecorded took (a stale replay) are that thing's ink now, and the source over them would stack ink twice."], "§15")
add('m1doc._stepsUndo', '_stepsUndo(op)',
    'The undo of an erase gesture: its applied steps and every applied step that consumed what they made, reverted newest first.',
    ['-'], "§15")
add('m1doc._stepsRedo', '_stepsRedo(op)',
    'The redo of an erase gesture: its steps in landing order where their sources are back, then any suspended step of an applied gesture whose source now is, until none applies.',
    ['-'], "§15")
add('m1doc.clear', 'clear(external, onExternal, restoreExternal)',
    'Wipe, carrying whatever engine state must round-trip with it.',
    ['Wipes the document, carrying whatever engine state must round-trip with it — the camera and the box tree — so undoing a clear restores the view as well as the ink.'], "§15")
add('m1doc.serializeNatives', 'serializeNatives(only)',
    'A whitelist per type, so runtime-only fields never reach a file. The cutting-grid offset is written because it is geometry.',
    ['Writes every object out, with a whitelist per type so runtime-only fields never reach a file.', 'A resolved outline is written as its encoded loops, which is usually **smaller** than the samples it came from, because burial culling threw most of the chain away.', 'Drawing order is written only when it differs from the id, so ordinary files stay byte-identical to what earlier builds produced.', 'The cutting-grid offset is written because it is geometry: drop it and a reloaded drawing subdivides somewhere else, which moves every straightened chord in it.'], "§15")
add('m1doc.loadNatives', 'loadNatives(snapNatives)',
    'Strips retired fields, repairs unclosed outlines, drops empty buckets, and never reuses an id.',
    ['Reads objects back, repairing what it can and refusing nothing it can mend.', '**Strips retired fields** at the door rather than carrying inert state that still looks meaningful — a field recording where a hole *should* have been is worse than no field at all.', '**Repairs unclosed outlines** on the way in, so a drawing damaged by an older build opens, renders, and — the part that matters — saves.', '**Leaves legacy polygon fills alone.** Converting at load would be the one expensive thing a load does; one recorded drawing carries a 1.8-million-vertex fill. They are promoted only when something needs to cut them.', '**Never reuses an id**, counting family keys as well, because an object whose id happened to equal a live family key would silently join that family.', 'Drops empty buckets, which is what repairs the drawings that already carry thousands of them.'], "§15")
add('m1eds.asLTRB', 'asLTRB(r)',
    'A rect in either spelling, as left/top/right/bottom.',
    ['The same one-liner as `overlays.asLTRB`.'], "§15")
add('m1eds.VirtualDoc', 'VirtualDoc',
    'The objects a descent reads and mints, kept apart from the document.',
    ['The target is its one real object; everything a virtual cede mints takes a negative id. Implements the few `Document` calls the descent needs (`getById`, `add`, `removeById`, `editKey`) with the same record shape.'], "§15")
add('m1eds.VirtualDoc.constructor', 'VirtualDoc.constructor(seed)',
    'Seeds the virtual document with `{ obj, level }` records, the level as a string; virtual ids start at -1.',
    ['-'], "§15")
add('m1eds.allocId', 'allocId()',
    'The next virtual id, -1, -2, ..., so a virtual object can never be taken for a real one.',
    ['-'], "§15")
add('m1eds.getById', 'getById(id)',
    'A virtual record `{ obj, level }` by id, or null.',
    ['-'], "§15")
add('m1eds.add', 'add(obj, level)',
    'Puts an object in the virtual document at a frame; returns the object.',
    ['-'], "§15")
add('m1eds.removeById', 'removeById(id)',
    'Takes an object out of the virtual document; returns its record, or null.',
    ['-'], "§15")
add('m1eds.editKey', 'editKey(o)',
    "An object's family key: its editId, else its id, as `Document.editKey` has it.",
    ['-'], "§15")
add('m1eds.squareInkOf', 'squareInkOf(world, vdoc, id, F, i, j)',
    "The tile store's piece for one object in square (i, j) of frame F, derived from the level above as the store derives it.",
    ["Runs `classifyUp`, then `solidQuad` or `deriveStep`, on the one object and on the same numbers `TileStore._bakeUp` uses, so the kid a cede mints is the store's piece bit for bit (F42). An object homed in a cell around the parent is first projected into the parent's coordinates, if its box meets the square's pre-image.", "Returns `{ loops, clip, tile }` (shape loops, or a covering fill's clip as a rect loop), or null when the square holds none of the object's ink."], "§15")
add('m1eds.own', 'own(l)',
    "A loop as a copied `{ buf, idx }` pair, ready to transfer; the caller's Loop stays usable.",
    ["The same helper as `eraseJob`'s `own`."], "§15")
add('m1eds.wrap', 'wrap(x)',
    'A transferred `{ buf, idx }` pair as a Loop again.',
    ['-'], "§15")
add('m1eds.objOut', 'objOut(o, transfer)',
    'An object copied for a worker message: runtime fields dropped, its loops copied into buffers pushed onto `transfer`.',
    ['Drops `_bbox`, `_home`, `_ver` and `_zScan`.'], "§15")
add('m1eds.objIn', 'objIn(o)',
    'An object back from a message, its loops wrapped as Loops.',
    ['-'], "§15")
add('m1eds.wireDescentResult', 'wireDescentResult(r)',
    "A descent result as a message: each step's objects copied out and their buffers transferred; a refusal as it is.",
    ['-'], "§15")
add('m1eds.unwireDescentResult', 'unwireDescentResult(m)',
    "A descent result back from a message, every step object's loops wrapped as Loops.",
    ['-'], "§15")
add('m1eng.KobinEngine', 'KobinEngine',
    'The facade the whole app talks to.',
    ['Wires the frame lattice, the document, the camera, the tile cache and a renderer together (the SVG `Renderer`, or `RasterRenderer` with a `PlateStore` when constructed with `raster`) and routes input to whichever one owns it.', "Its own methods: construction and teardown, the compat accessors, the tool and style setters, the perf log and journal, the render list (`_buildList`, `listFor`), the raster path's plate drain, the drag's plate hold and its one exit (`_endMove`), the crossing prebake and the zoom-out ladder, pan and zoom, pointer input, undo, redo and clear (DESIGN.md §15).", 'Five files are mixed onto the prototype by `mixin.js` (erasePipeline, overlays, selection, files, sceneOps); their methods run with `this` bound to the engine, and `mixin` throws if two claim one name. The quasi-private surface is pinned by `KobinEngine.contract.test.js`.'], "§15")
add('m1eng.activeLevel', 'activeLevel (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.inScale', 'inScale (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.inPanX', 'inPanX (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.inPanY', 'inPanY (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.nativesByLevel', 'nativesByLevel (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.crossings', 'crossings (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.levelObjects', 'levelObjects (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.tiles', 'tiles (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng._hasFat', '_hasFat (getter)',
    'The compatibility surface the interface and the tests read. Pass-throughs.',
    ['The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs.'], "§15")
add('m1eng.setTool', 'setTool(t)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setPenType', 'setPenType(t)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setColor', 'setColor(c)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setWidth', 'setWidth(w)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setOpacity', 'setOpacity(o)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setOpacityGroups', 'setOpacityGroups(b)',
    'Tool and diagnostic settings. Plumbing — except that leaving the select tool drops the selection.',
    ['Tool and diagnostic settings, mostly plumbing. `setTool` drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean.'], "§15")
add('m1eng.setDebug', 'setDebug(b)',
    'Tool and diagnostic settings. Plumbing — except that leaving the select tool drops the selection.',
    ['Tool and diagnostic settings, mostly plumbing. `setTool` drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean.'], "§15")
add('m1eng.setPreBake', 'setPreBake(b)',
    'Tool and diagnostic settings. Plumbing — except that leaving the select tool drops the selection.',
    ['Tool and diagnostic settings, mostly plumbing. `setTool` drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean.'], "§15")
add('m1eng.setTrace', 'setTrace(b)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setRetainScenes', 'setRetainScenes(b)',
    'Tool and diagnostic settings. Plumbing — except that leaving the select tool drops the selection.',
    ['Tool and diagnostic settings, mostly plumbing. `setTool` drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean.'], "§15")
add('m1eng.setLevelStep', 'setLevelStep(s)',
    "Sets the pyramid's level step S — 1, 2 or 3, the Dev panel's toggle — through the levers; returns the step in force.",
    ['-'], "§15")
add('m1eng.setPlateBudget', 'setPlateBudget({views, ceilingMiB})',
    "Sets the plate store's budget — `views` screens (1–8) under `ceilingMiB` (64–512) — through the levers; returns the pair in force.",
    ['-'], "§15")
add('m1eng.setScaleDef', 'setScaleDef(def)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setLazyOutlines', 'setLazyOutlines(b)',
    'Tool and diagnostic settings. Plumbing — except that leaving the select tool drops the selection.',
    ['Tool and diagnostic settings, mostly plumbing. `setTool` drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean.'], "§15")
add('m1eng.setTileDebug', 'setTileDebug(b)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.setEraseDebug', 'setEraseDebug(b)',
    'Tool and diagnostic settings. Plumbing — except that a tool change drops a parked gesture, and leaving the select tool drops the selection.',
    ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."], "§15")
add('m1eng.resize', 'resize(w, h)',
    'Wires the collaborators together — the lattice, the document, the camera, the Stage, the renderer and its plate cache — and drops the selection when the document is reset.',
    ['Wires the collaborators together: the box tree, the document, the camera, the tile cache and the renderer.', 'Injects one pure function into the document so it can convert between boxes without owning a camera or a tree.', 'Subscribes to the document so a vanishing object cannot leave a stale selection — and deliberately ignores a re-home, which is a change of address rather than the object going away.'], "§15")
add('m1eng.notePerf', 'notePerf(op, t0, extra)',
    'The operation log. High-frequency operations are aggregated, or a single pinch would evict everything else; the 8 ms floor is what once hid a session with 62 seconds elapsed and 157 ms recorded.',
    ['Records one operation in the rolling performance log, with the level, the in-level zoom, a wall-clock timestamp, and any extra fields the caller supplies.', 'Below an 8 ms floor an entry is dropped unless the caller insists or trace mode is on. The floor exists because the log holds 300 entries and a single pinch would otherwise evict everything else — but it is also what once hid a session with 62 seconds elapsed and 157 ms recorded, which is why trace mode can remove it.', 'An operation of 200 ms or more is also kept in `perfLong` (the last 100), which a report carries: the rolling log turns over in a minute or two of work.'], "§15")
add('m1eng._noteFast', '_noteFast(kind, ms)',
    'The operation log. High-frequency operations are aggregated, or a single pinch would evict everything else; the 8 ms floor is what once hid a session with 62 seconds elapsed and 157 ms recorded.',
    ['Aggregates a high-frequency operation instead of logging each one.', 'Zoom and pan steps happen hundreds of times per gesture. Keeping a count, a total and a worst case costs nothing and survives in the log, where individual entries would be evicted within seconds.'], "§15")
add('m1eng.fastStats', 'fastStats()',
    'The operation log. High-frequency operations are aggregated, or a single pinch would evict everything else; the 8 ms floor is what once hid a session with 62 seconds elapsed and 157 ms recorded.',
    ['Records one operation in the rolling performance log, with the level, the in-level zoom, a wall-clock timestamp, and any extra fields the caller supplies.', 'Below an 8 ms floor an entry is dropped unless the caller insists or trace mode is on. The floor exists because the log holds 300 entries and a single pinch would otherwise evict everything else — but it is also what once hid a session with 62 seconds elapsed and 157 ms recorded, which is why trace mode can remove it.', 'An operation of 200 ms or more is also kept in `perfLong` (the last 100), which a report carries: the rolling log turns over in a minute or two of work.'], "§15")
add('m1eng._note', '_note(entry)',
    'The journal: what the user did, not what the document became. Which erase, where, at what zoom, what it cut, whether the object came apart — and why anything was refused.',
    ['Appends an entry to the journal — the record of what the *user* did, as opposed to what the document ended up as.', 'A stroke entry carries the pen width, the line width in frame units, and a thinned copy of the samples. An erase entry carries the eraser size and an initially empty list of cuts that the background worker fills in as it goes.', 'This is what turns a bug report from a snapshot of wreckage into a sequence of gestures that produced it.'], "§15")
add('m1eng._thin', '_thin(pts, cap)',
    'The operation log. High-frequency operations are aggregated, or a single pinch would evict everything else; the 8 ms floor is what once hid a session with 62 seconds elapsed and 157 ms recorded.',
    ['Records one operation in the rolling performance log, with the level, the in-level zoom, a wall-clock timestamp, and any extra fields the caller supplies.', 'Below an 8 ms floor an entry is dropped unless the caller insists or trace mode is on. The floor exists because the log holds 300 entries and a single pinch would otherwise evict everything else — but it is also what once hid a session with 62 seconds elapsed and 157 ms recorded, which is why trace mode can remove it.', 'An operation of 200 ms or more is also kept in `perfLong` (the last 100), which a report carries: the rolling log turns over in a minute or two of work.'], "§15")
add('m1eng.reportFamilies', 'reportFamilies(limit)',
    'Diagnostics for multi-level families and for what a mark actually touched.',
    ['Diagnostics for multi-level objects: which pieces belong to which family, where their doorways are, and what an erase actually touched — the report fields that made severance debuggable at all.'], "§15")
add('m1eng._buildList', '_buildList()',
    "Merge the tile pieces and the active frame's own objects in id order — so a newer object always draws over an older one regardless of which class it arrived by.",
    ['Assembles everything to draw at the active frame.', "Takes the cached tile pieces covering the view, adds the active frame's own objects (which are drawn live, not cached), and tags each piece with its family key so the renderer can group a multi-level object into one path.", "Sorts by drawing order — which is creation order, with cut pieces inheriting their source's place so a stroke stays at its original depth after being split."], "§15")
add('m1eng._planeLost', '_planeLost()',
    "The renderer's drag plane can no longer draw the drag: releases the hold once, so each step renders.",
    ["Called by `RasterRenderer` when the camera leaves the plane's frame or the view leaves plates under a live drag. Runs `_releaseMove` and clears the drag's `listAt`, so the ants decide from the list as it stands, which now holds the move. Returns the plates dropped."], "§15")
add('m1eng._dragState', '_dragState()',
    'The live drag as the renderer pulls it each frame: the gesture, the held ids and frame roots, and the pointer at the first read.',
    ["Null unless a drag is under way and a plate hold was taken. `RasterRenderer._planeStep` moves its plane by the gesture's `last - start`."], "§15")
add('m1eng._dropHold', '_dropHold(why)',
    '`_endMove` without the render, for a document event where rendering would re-enter.',
    ["Clears the drag gesture and its carried ids, turns off the tile cache's batch mode and the Document's merge hold, releases the plate hold (`_releaseMove`), and tells the renderer (`endMove(why, dropped)`) if a drag or a hold was live. The selection's document subscription uses it on a reset or when the last member goes."], "§15")
add('m1eng._releaseMove', '_releaseMove()',
    "The hold's end: the Stage applies what it held as one commit, dirtying where the drag started, where it ends and where the view drew it.",
    ['`stage.release()`; 0 when no hold was taken (A2 §2.7).'], "§15")
add('m1eng._listWin', '_listWin()',
    "The window the Stage's table reads: the camera's frame window, grown on the raster path by four view cells, so a plate reaching past it is never rendered without its ink. The list itself is the Stage's items in one paint order — tile pieces and the frame's own natives together, so a newer object always draws over an older one whichever way it arrived.",
    ["The window the Stage's table (and the SVG path's list) reads: the camera's frame window, on the raster path grown by the renderer's margin of four view cells, so a plate reaching past the squares the table read is not rendered without that ink (REVIEWER-4 P-1)."], "§15")
add('m1eng._visibleChanged', '_visibleChanged()',
    'Render, or decide a camera-only sync is enough.',
    ['Has the set of visible tiles changed since the last full render?', 'This is the cheap question that decides whether a camera move needs a rebuild or just a new transform.'], "§15")
add('m1eng._pend', '_pend()',
    'The step the next animation frame takes ("raf" frames): asked for at the first event and filled by every event until it runs (A3 §5).',
    ['The camera moves at each event, so hit tests and the float arithmetic are what they were; only the consequences wait for the frame.'], "§15")
add('m1eng.flush', 'flush()',
    'Takes the pending frame step now, if there is one — for a press or a release, the suites and the harness.',
    ['-'], "§15")
add('m1eng.panBy', 'panBy(dx, dy)',
    'Input to the camera; its consequences (a table step, or a render) taken once a call, or once an animation frame.',
    ['Pan by a pixel delta: the camera pans, and its consequences (`_panStep`) are taken now — or, with "raf" frames, at the next animation frame (`_pend`), which gathers every pan until it runs.'], "§15")
add('m1eng.zoomAt', 'zoomAt(sx, sy, deltaY)',
    'Input to the camera; its consequences (a table step, or a render) taken once a call, or once an animation frame.',
    ['Pan by a pixel delta: the camera pans, and its consequences (`_panStep`) are taken now — or, with "raf" frames, at the next animation frame (`_pend`), which gathers every pan until it runs.'], "§15")
add('m1eng.pinchUpdate', 'pinchUpdate(mx, my, factor, dx, dy)',
    'Input to the camera; its consequences (a table step, or a render) taken once a call, or once an animation frame.',
    ['Pan by a pixel delta: the camera pans, and its consequences (`_panStep`) are taken now — or, with "raf" frames, at the next animation frame (`_pend`), which gathers every pan until it runs.'], "§15")
add('m1eng.zoomFactorAt', 'zoomFactorAt(sx, sy, factor)',
    'Input to the camera; its consequences (a table step, or a render) taken once a call, or once an animation frame.',
    ['Zoom about a point (the wheel): `_zoomBy` with no pan. A pinch comes through `pinchUpdate`, which pans the camera first and hands `_zoomBy` whether that pan crossed a cell, so a pinch step is one camera step.'], "§15")
add('m1eng._crossTarget', '_crossTarget()',
    'The frame and in-frame scale the camera would land at if the crossing it is approaching happened now.',
    ["Past 0.8 of `enter`: the child frame under the view, defined early by `LevelMap.ensureChild` while `preBake` is on (its default). Under 1.25 x `exit`: the parent. The scale is `_crossUp`'s or `_crossDown`'s arithmetic on the same edge record. Null otherwise; it never grows a root.", 'One copy of the crossing arithmetic: a second copy is what F45 cost.'], "§15")
add('m1eng._buildLadder', '_buildLadder()',
    'Queues the zoom-out ladder: coarse plates for the screens 4x to 4,194,304x zoomed out, then the view just past each crossing in that span.',
    ["Skipped mid-gesture, within 300 ms of a camera move, and when the camera is where the last ladder was built, unless a pinned drag plane has since evicted rungs (rebuilt once a view). Clears the tile cache's warm set, lists the rungs (the first three on a phone) and then the crossing steps, and starts `_ladderRung(0)`. Returns what the first rung posted.", "The crossing steps come last so their tile, which a zoom-out crossing otherwise bakes on the main thread (measured 1,199 ms cold, 101 warm, on the Magnum Opus), stays inside TileStore's per-frame cap. Ladder plates are drawn only as stand-ins (DESIGN.md §9)."], "§15")
add('m1eng._ladderCrossings', '_ladderCrossings(maxFactor)',
    'The zoom-out factors, from the camera, just past each level crossing within `maxFactor`.',
    ["Walks up the parent chain with `_crossDown`'s arithmetic, 2% past each exit so the camera would be in the parent; stops at a root or past `maxFactor`."], "§15")
add('m1eng._ladderKey', '_ladderKey()',
    'The camera and the screen size as one string, so a ladder is built once a view.',
    ['-'], "§15")
add('m1eng._zoomedOut', '_zoomedOut(factor)',
    'The view zoomed out `factor`x about the screen centre, computed through each crossing without running a camera.',
    ["Maps the centre up through the parents at `_crossDown`'s scale until the in-frame scale is back at or above `exit`; returns the frame, its scale, and the zoomed-out screen grown 2.5x (LADDER_MARGIN) as the window. Null where the zoom would pass a root.", 'No `Camera` runs, so no frame is minted.'], "§15")
add('m1eng.screenToFrame', 'screenToFrame(sx, sy)',
    "A screen point in the camera frame's own units; a pass-through to the camera.",
    ['-'], "§15")
add('m1eng.pointerDown', 'pointerDown(sx, sy, ctrl)',
    'Timed at the boundary, so the cost of a gesture is measured where the user feels it.',
    ['The public entry for a press: times `_pointerDown` and records it as `ptrDown` in the operation log (past the 8 ms floor, or always in trace mode) and in the `_noteFast` distribution.', 'Input handlers are where a user feels cost, so the boundary is what is measured.'], "§15")
add('m1eng.pointerMove', 'pointerMove(sx, sy)',
    'Timed at the boundary, so the cost of a gesture is measured where the user feels it.',
    ['The public entry for a drag. Times the call and delegates to `_pointerMove`.', 'This fires many times a second, so everything inside is designed to be cheap — the pen appends one sample, the drag recomputes one displacement.'], "§15")
add('m1eng.pointerUp', 'pointerUp()',
    'Timed at the boundary, so the cost of a gesture is measured where the user feels it.',
    ['The public entry for a release. Times the call and delegates to `_pointerUp`.', 'Also called indirectly by the camera: crossing a level finalises any live stroke first, through a hook, so a stroke is never left half-written across two coordinate systems.'], "§15")
add('m1eng._pointerMove', '_pointerMove(sx, sy)',
    'Everything a gesture can be: draw, erase, pan, lasso, drag. The select tool changes nothing on the way down: a tap selects at pen-up, and a move past SELECT_DRAG_PX starts a drag or a lasso. Pen-up journals a stroke, finalises it, queues the resolve, and pushes exactly one undo entry.',
    ['Extends what `_pointerDown` started. Pan (or read-only) moves the camera; the whole-object eraser erases under the point; the area eraser falls through to the pen path, because it is a stroke.', 'Select: a drag parked on its erase barrier only records the finger, for its start; a lasso appends a point once the pointer has moved more than a pixel; a press waits until it has travelled SELECT_DRAG_PX, then `_beginSelectDrag` decides lasso or move; a move in progress takes one `_dragSelection` step — with "raf" frames the frame\'s step reads the last pointer instead (`_pend`).', 'Pen: the sample goes into the stroke and its live arc chain, which rebuilds only the last two gaps, O(1) a point; the line tool replaces its second point and re-seeds a two-sample pen instead. The renderer updates now, or with "raf" frames at the frame.'], "§15")
add('m1eng._startPen', '_startPen(o)',
    'Attach the live arc chain, at a tolerance set by the zoom it is drawn at — the moment the raw stroke is swapped for its outline is the only moment the difference could be seen.',
    ['Attaches a live arc chain (`BiarcPen`) to a stroke about to be drawn, seeded with its first sample, at a tolerance of half the arc tolerance at the zoom it is drawn at.', 'Every stroke gets one, the line tool included. The swap from the live chain to the resolved shape is the only moment their difference could show, and at this tolerance it is sub-pixel there.'], "§15")
add('m1eng.cancelStroke', 'cancelStroke()',
    'Abandon the in-progress stroke.',
    ['Abandons the in-progress stroke and removes it from the document — used where a gesture is interrupted rather than completed.'], "§15")
add('m1eng.sweepFrames', 'sweepFrames()',
    'Frame GC over every frame, called by the saver once a restored store is in (F94); 0 in a read-only tab.',
    ['-'], "§15")
add('m1eng.clear', 'clear()',
    'One gesture is one action. Undo and redo cancel a live drag first, do nothing in a read-only tab, and re-schedule background work, because an undo can leave strokes unresolved.',
    ["Undo and redo cancel a live drag first (its start records describe the document about to change), run the document's undo or redo inside `_keepingSelection`, so the natives and frames it moves out of the selected frames stay selected, then re-schedule the background bake and render, because reversing an action can leave strokes unresolved or erases unapplied. Clear drops the bake jobs and resets the document, the lattice, the camera and the renderer. All three do nothing while `readOnly`."], "§15")
add('m1eng._emit', '_emit()',
    'Status reporting and the ported display invariants.',
    ["Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, the object count, undo and redo, and the erase status (the pending marks, and a gesture finishing its erase: the editor's chip). Then tells the zoom's subscribers (`onZoom`) when the zoom changed, so the scale HUD follows a zoom without a page render."], "§15")
add('m1eng.onZoom', 'onZoom(cb)',
    'Subscribes `cb(effectiveZoom)` to every status emit that finds the zoom changed — once a frame — so the scale HUD follows a zoom without re-rendering the page (A3 §5, R25 W1); returns the unsubscribe.',
    ['-'], "§15")
add('m1eng._effectiveZoom', '_effectiveZoom()',
    'Status reporting and the ported display invariants.',
    ["Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, the object count, undo and redo, and the erase status (the pending marks, and a gesture finishing its erase: the editor's chip). Then tells the zoom's subscribers (`onZoom`) when the zoom changed, so the scale HUD follows a zoom without a page render."], "§15")
add('m1eng._levelPointToScreen', '_levelPointToScreen(level, x, y)',
    'Status reporting and the ported display invariants.',
    ["Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, the object count, undo and redo, and the erase status (the pending marks, and a gesture finishing its erase: the editor's chip). Then tells the zoom's subscribers (`onZoom`) when the zoom changed, so the scale HUD follows a zoom without a page render."], "§15")
add('m1eng._objs', '_objs()',
    'Status reporting and the ported display invariants.',
    ["Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, the object count, undo and redo, and the erase status (the pending marks, and a gesture finishing its erase: the editor's chip). Then tells the zoom's subscribers (`onZoom`) when the zoom changed, so the scale HUD follows a zoom without a page render."], "§15")
add('m1eng._fatOnScreen', '_fatOnScreen(o)',
    'Status reporting and the ported display invariants.',
    ['Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, and the object count.'], "§15")
add('m1eng._frameWindow', '_frameWindow(margin)',
    'Status reporting and the ported display invariants.',
    ["Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, the object count, undo and redo, and the erase status (the pending marks, and a gesture finishing its erase: the editor's chip). Then tells the zoom's subscribers (`onZoom`) when the zoom changed, so the scale HUD follows a zoom without a page render."], "§15")
add('m1eng._debugTileRects', '_debugTileRects()',
    'Status reporting and the ported display invariants.',
    ["Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, the object count, undo and redo, and the erase status (the pending marks, and a gesture finishing its erase: the editor's chip). Then tells the zoom's subscribers (`onZoom`) when the zoom changed, so the scale HUD follows a zoom without a page render."], "§15")
add('m1erp.cutKey', 'cutKey(m, t)',
    "The reorder buffer's key for the pair (mark, target).",
    ['-'], "§15")
add('m1erp.ErasePipeline', 'ErasePipeline',
    'The eraser and the resumable bake behind it, as a mixin.',
    ["Never instantiated. Its prototype is copied onto KobinEngine's, so every method here runs with `this` bound to the engine.", 'A class rather than an object literal because that made the split a MOVE: every method arrived byte-identical, comments and indentation included, with no reformatting for a reviewer to read past. `mixin.js` says why `Object.assign` cannot do the copying.'], "§15")
add('m1erp.eraseAt', 'eraseAt(sx, sy)',
    'The whole-object eraser.',
    ['The whole-object eraser: hit-test at the point and remove what is under it, as one undo entry.'], "§15")
add('m1erp._eraseWhole', '_eraseWhole(id)',
    'The whole-object eraser.',
    ['The whole-object eraser: hit-test at the point and remove what is under it, as one undo entry.'], "§15")
add('m1erp.setEraserSize', 'setEraserSize(px)',
    'Eraser size and bookkeeping. Plumbing.',
    ["Sets the area eraser's width in screen pixels, clamped to 2–200 (16 when not a number)."], "§15")
add('m1erp._zOf', '_zOf(o)',
    'Eraser size and bookkeeping. Plumbing.',
    ["An object's paint-order key: its z, or its id when it has none."], "§15")
add('m1erp._initErase', '_initErase()',
    "The erase state, made once from the engine's constructor: the pending marks, each mark's lineage and serial order, the reorder buffer of cuts, the parked barrier, the step budgets — and the document subscriptions that keep them.",
    ['Runs after the scene subscribes. The marks set and the lineage index are kept by events (`_onEraseEvent`), the history forks by ops (`_onEraseStep`), and the index is built once from the document (`_rebuildEraseIndex`). DESIGN.md §7, A2 §4.6.'], "§15")
add('m1erp._onEraseEvent', '_onEraseEvent(ev)',
    "Keeps the pending marks and the lineage index from the document's events: a mark added or removed, a native entering or leaving a mark's lineage; a reset drops every cut in flight and the parked barrier and rebuilds the index.",
    ['A reset bumps the erase generation, so a job from before it is dropped when it lands. A frame put back (`addFrame`) brings its natives back by reference with no events of their own, so its natives are pruned of dead marks and counted into the budgets here. A native re-entering is pruned of marks that cannot return (`_pruneDead`) and, unless it is a re-home, grows the budgets of the marks it is pending under (`_supplyAdd`).'], "§15")
add('m1erp._supplyAdd', '_supplyAdd(o, by)',
    "Native `o` arrived pending under marks other than `by` — another mark's piece, a source an undo returned, a frame an undo put back: each such mark's step budget grows by one.",
    ['-'], "§15")
add('m1erp._stepBudget', '_stepBudget(M)',
    "Mark M's step budget, taken at its first step: the steps so far and its supply, the ids pending under it then.",
    ['-'], "§15")
add('m1erp._overBudget', '_overBudget(Erec)',
    "Counts one step of a mark's bake; past 2 × its supply + 8 steps the bake is not converging — a wrong rule — so the mark is aborted, reported, noted on its journal entry and spent with the cuts it made, and true returned.",
    ["So no loop can hang the page (DESIGN.md §7, the bake terminates; PLAN §5.8 item 3). The abort is kept for `report().erase.counters` and logged as a console error; the correct rule's steps never exceed the supply (`erase.rule.test.js`)."], "§15")
add('m1erp._pruneDead', '_pruneDead(o)',
    "Drops from a native's `targetOf` and `handledBy` every mark that cannot return (A2 §4.6) — as it re-enters the document and at a load — so the undo of a finished erase restores the document exactly.",
    ['-'], "§15")
add('m1erp._onEraseStep', '_onEraseStep(ev)',
    "The op-log side: a new op forks history, so the marks its dropped redo branch held leave the live natives' fields; a bake step replaces, in what a running barrier follows, the source by its pieces (A2 §4.11).",
    ['-'], "§15")
add('m1erp._rebuildEraseIndex', '_rebuildEraseIndex()',
    "Builds the pending marks and the lineage index afresh from every frame's list; the serial orders, silent pairs and projections are dropped.",
    ['-'], "§15")
add('m1erp._lineageAdd', '_lineageAdd(m, id)',
    "Native `id` joins or leaves mark `m`'s lineage — the live natives with `m` in `targetOf`; one that joins is also noted for the mark's serial order (`_headOf`).",
    ['-'], "§15")
add('m1erp._lineageDelete', '_lineageDelete(m, id)',
    "Native `id` joins or leaves mark `m`'s lineage — the live natives with `m` in `targetOf`; one that joins is also noted for the mark's serial order (`_headOf`).",
    ['-'], "§15")
add('m1erp._eraseStrokes', '_eraseStrokes()',
    'Eraser gestures whose own outline has resolved, oldest first. One still raw is not skipped — it is simply not ready yet.',
    ['Collects the eraser gestures that have a resolved outline, oldest first.', 'An eraser that is still raw is not skipped, it is simply not ready — the same tick resolves outlines before it touches erases, so it arrives here a tick later.'], "§15")
add('m1erp._marksUnlanded', '_marksUnlanded()',
    "Whether any mark's shape has not landed, other than the one being drawn: a reader of the mask resolves it first.",
    ['-'], "§15")
add('m1erp._forceBake', '_forceBake(o)',
    'Resolve now: for tests, and wherever an erase has reached an object that has not resolved yet.',
    ["Resolves one stroke's perimeter immediately, cancelling any queued job for it.", 'Used where an erase has reached an object that has not resolved yet — the boolean needs both operands as outlines and cannot wait for the queue.'], "§15")
add('m1erp._sealed', '_sealed(res, w)',
    'An outline that does not close is sealed rather than refused — the stroke has to become something — and how much edge was fabricated is recorded, because a seal a fifth of the pen wide is invisible and one at 45% is a line drawn across the stroke.',
    ['Guarantees a resolved outline actually closes.', 'A stroke whose two edges fail to stitch would otherwise be stored as its two rails plus the slivers between them: no boundary, no meaningful inside, nothing painted, and a drawing that cannot be saved at all because the file format validates closure.', 'Refusing is not an option — the stroke has to become something — so unclosed chains are stitched together and closed with straight lines, and the resulting dust is dropped.', "Records how much edge was fabricated. A seal a fifth of the pen wide is invisible; one at 45% of the loop's perimeter is a straight line drawn across the middle of a stroke, and the two are indistinguishable without the number."], "§15")
add('m1erp._scheduleBake', '_scheduleBake(delay)',
    "One timer, and the soonest request wins — otherwise a pending erase would delay every stroke's resolve behind it.",
    ['Arms the single background timer.', "One timer, and the soonest request wins: a pending 400 ms erase timer must not delay a stroke's resolve, which wants to run immediately. If a sooner deadline arrives the existing timer is cleared and replaced."], "§15")
add('m1erp._queueBake', '_queueBake(o)',
    'The pen-up resolve queue, run in slices. _ensureShapeBakes is the guarantee that no stroke is left raw for ever — after a load, an undo, or a job dropped because its object went away.',
    ["Queues a drawn stroke's perimeter resolve as a job with a cursor in it.", 'Hands the job the arc chain the live pen already built, which skips the single most expensive phase of the resolve — it was paid for a few microseconds at a time while the user drew.', 'Deliberately leaves the pen chain attached to the object: it is what the renderer draws until the resolved outline lands, so the ink does not change shape at pen-up and again when the bake finishes.'], "§15")
add('m1erp._promoteOversize', '_promoteOversize(id)',
    'Invariant 2, enforced. A stroke wider than a box is promoted to the level above, dividing every coordinate by 4,096 — a change of units, not a loss of accuracy.',
    ["Enforces the rule that an object never reaches past its box's immediate neighbours.", "If the object's extent exceeds one box width, it is moved to the parent level: every coordinate divided by the crossing ratio, which is a power of two, so this is a change of units and not a loss of accuracy — the mantissa is untouched and only the exponent moves.", 'The object becomes a small, finely-detailed object one level up, where the rule holds with room to spare. Repeats until it fits, which for any real gesture is never or once.', 'Line width and pen width are scaled to match, because they are lengths in the same units.'], "§15")
add('m1erp._ensureShapeBakes', '_ensureShapeBakes()',
    'The pen-up resolve queue, run in slices. _ensureShapeBakes is the guarantee that no stroke is left raw for ever — after a load, an undo, or a job dropped because its object went away.',
    ['Walks the whole document and queues a resolve for any stroke that is still raw.', 'Cheap, and it is the only thing guaranteeing no stroke is left unresolved forever — after a load, after an undo, or after a job was dropped because its object had been erased while it sat in the queue.'], "§15")
add('m1erp._camBusy', '_camBusy()',
    'The background loop. Resolve outlines first (an eraser cannot be subtracted until it has one), then fold erasers into ink in slices — charging the next object at what the last one actually cost, and never starving for more than a second and a half.',
    ['True if the camera moved recently enough that a background slice would land on a frame the user is watching.', 'A simple timestamp comparison against a fixed idle window. Being wrong in the cautious direction only delays work; being wrong the other way drops a frame.'], "§15")
add('m1erp._bakeTick', '_bakeTick()',
    'The background loop. Resolve outlines first (an eraser cannot be subtracted until it has one), then fold erasers into ink in slices — charging the next object at what the last one actually cost, and never starving for more than a second and a half.',
    ["The background worker's entry point. Wraps the real work in timing.", 'This is timed because it was once the largest piece of untimed main-thread work in the engine: a slice is budgeted at 8 ms but one object can cost far more, and until it was instrumented none of that reached a report.'], "§15")
add('m1erp._bakeTickInner', '_bakeTickInner()',
    'The background loop. Resolve outlines first (an eraser cannot be subtracted until it has one), then fold erasers into ink in slices — charging the next object at what the last one actually cost, and never starving for more than a second and a half.',
    ['One slice of background work, then re-arms itself if anything is left.', '**Stands aside** while the pointer is down or a drag is in progress, and for a short window after the camera moves — but never for more than about a second and a half in total, so a restless camera cannot starve the queue.', '**Resolves outlines first.** An eraser cannot be subtracted until it has a resolved outline, and neither can the ink beneath it.', "**Then registers and bakes.** Every landed mark is registered (`_registerLanded`). While a gesture is parked at an erase barrier nothing more runs: the parked gesture drives the cuts it waits on, and its end resumes the tick. Otherwise `_bakeRun` works to the slice's deadline — the serial head applied when its job has landed, a spent mark removed, the lookahead dispatched to the workers (A2 §4.7) —; a spent mark renders at once, any other change soon after."], "§15")
add('m1erp._registerMark', '_registerMark(Erec)',
    "Records a landed mark's targets, once (A2 §4.2): the frames its ink covers whole set aside as one step, then every reachable native under it below its z, in the mark's `targets` and in each target's `targetOf`.",
    ["Nothing can have moved under the mark before this runs: every gesture that moves ink resolves pending perimeters first, and the mark's op is on top of the undo stack until its shape lands (DESIGN.md §7). A mark from a file written before `targets` registers by the same scan under its stepped z, less the ids its op's steps name, whose pieces join its lineage as handled. Runs in the landing's Stage batch, so the mask reaches the plates with the shape."], "§15")
add('m1erp._registerLanded', '_registerLanded()',
    'Registers every landed mark that has no `targets` yet: one from before the field, a direct add, one back by a redo (A2 §4.9).',
    ['-'], "§15")
add('m1erp._deriveTargetOf', '_deriveTargetOf()',
    "After a load or a replay: every known mark's `targets` — live, or held by an op in the undo or redo stack — put back into its targets' `targetOf`, dead marks pruned, and the index rebuilt (A2 §4.9).",
    ['A union, so idempotent. A snapshot written before a registration lacks the fields, and no log entry carries `targetOf`: it is derived.'], "§15")
add('m1erp._eraseLoaded', '_eraseLoaded()',
    'The erase side of a load: the lineage derived and, when this tab holds the pen, every mark from before `targets` registered, its `targets` logged once.',
    ['-'], "§15")
add('m1erp._opOf', '_opOf(id)',
    "Mark `id`'s gesture op — its `eraseCommit` — from the commits seen or the undo stack, without minting one.",
    ['-'], "§15")
add('m1erp._eraseMayTouch', '_eraseMayTouch(E, HE, o, HO)',
    "A cheap prefilter in the target's frame, projecting the eraser's box and not its geometry. The old form put a whole perimeter inside a loop that runs once per object per scan: 128 ms per slice on a crowded screen.",
    ['A cheap rejection test: could this eraser possibly touch this object?', "Projects the eraser's **bounding box**, not its geometry, into the target's frame — a box maps to a box exactly, and costs a constant amount where projecting the outline rebuilds one arc per piece.", "The box is cached against the eraser's edit counter so it is computed once per gesture rather than once per candidate.", 'Only has to be cheap and never wrongly negative; the boolean itself is the arbiter and its no-op guard absorbs false positives. The earlier version put a whole perimeter inside a loop that runs once per object per scan and cost 128 ms per slice on a crowded screen.'], "§15")
add('m1erp._rectMayTouch', '_rectMayTouch(r, o)',
    "Whether the eraser's rect, in native `o`'s stored coordinates, meets its box — a shape's loop by loop, a stroke's grown by half its width.",
    ['-'], "§15")
add('m1erp._eraserRectInto', '_eraserRectInto(rect, HE, o)',
    "A mark's rect, drawn in frame HE, in the coordinates object `o` is stored in: the Stage's placement of `o` in HE, inverted (`toStored`).",
    ['-'], "§15")
add('m1erp._eraserLoopsInto', '_eraserLoopsInto(loops, HE, o)',
    "The mark's loops in the coordinates object `o` is stored in (the Stage's placement, `toStored`): the clip of an in-place cut.",
    ['-'], "§15")
add('m1erp._pendingPair', '_pendingPair(M, o)',
    "Whether the bake still owes the pair (mark M, native o): `o` is under M's mask by the erase rule and the eraser's box has not ruled it out.",
    ['-'], "§15")
add('m1erp._silentAdd', '_silentAdd(m, id)',
    'A pair the tighter box test rules out, handled in memory only — no pixel of it is under the mask; a reload derives it again.',
    ['-'], "§15")
add('m1erp._orderOf', '_orderOf(M)',
    "Mark M's lineage in the serial order — top-down by (z, id) — with a cursor past what is no longer pending; ids that joined since are inserted in place.",
    ["Keyed by the z each id had when it joined (a native's z never changes; a piece inherits it), so a removed id keeps its place and the order is a function of the ids alone, whenever they arrive — what lets a parallel bake leave the inline bake's document (DESIGN.md §7)."], "§15")
add('m1erp._headOf', '_headOf(Erec)',
    'The next object to bake under a mark: its first pending target in the serial order — the targets registered once, when the mark landed, after the pass that takes a covered frame whole (A2 §4.2). Reachability is the only bar.',
    ["Mark E's first pending target in the serial order, or null; the cursor moves past what is no longer pending."], "§15")
add('m1erp._pendingOf', '_pendingOf(Erec)',
    "Mark E's pending targets in the serial order, from its head on (a generator).",
    ['-'], "§15")
add('m1erp._serialHead', '_serialHead()',
    'The serial head: the oldest mark and its first pending target — the target null when the mark has nothing left — or null when no mark is pending.',
    ['-'], "§15")
add('m1erp._bakeRun', '_bakeRun(deadline)',
    "The bake's work until `deadline`: the serial head applied when its job has landed (run inline where there is no worker), a mark with nothing pending spent in its turn, then the lookahead dispatched; it stops at a head still in flight.",
    ["Results apply strictly in the serial order, so the ids, steps and log are the inline bake's (DESIGN.md §7, A2 §4.7). One pair a tick always runs, or a pair costing more than the budget would be refused for ever (BS-3); the next pair is started only when the last one's cost fits the deadline. A pair its own inline step left pending is set aside as handled, not looped on. Returns whether anything changed, a mark was spent, and whether work is left that waits on no worker."], "§15")
add('m1erp._bakeNext', '_bakeNext()',
    'For the tests: the serial head baked inline, or the oldest mark spent when it has nothing left; false when nothing is pending.',
    ['-'], "§15")
add('m1erp._jobFor', '_jobFor(E, HE, o, HO)',
    "A pair's job: a descent when the target is homed shallower along the mark's own chain — the hole belongs at the level the mark was drawn at — else a cut in the target's stored coordinates, the eraser brought there through its table; null when the eraser maps to nothing.",
    ["A target homed in a ring neighbour's cell cedes down the mark's chain below it (REVIEWER-3 ERASE-4). The cut in stored coordinates keeps every piece it does not cut bit for bit (F41, F42); its dust bar is a quarter pixel at the mark's zoom, through the frame factor (F66)."], "§15")
add('m1erp._onLanded', '_onLanded(c, r, err)',
    "A worker's job has landed: into the reorder buffer, then the tick or the parked barrier applies it in its turn; a job no longer in the buffer is counted stale.",
    ['-'], "§15")
add('m1erp._applyPair', '_applyPair(Erec, rec, kind, r)',
    "Applies one pair's result — a descent's steps or a cut's pieces — after counting the step against the mark's budget.",
    ['-'], "§15")
add('m1erp._dropCut', '_dropCut(c)',
    'A job out of the reorder buffer (and the descent slot); and every job of a mark that left the document, so their late answers are ignored.',
    ['-'], "§15")
add('m1erp._dropCuts', '_dropCuts(id)',
    'A job out of the reorder buffer (and the descent slot); and every job of a mark that left the document, so their late answers are ignored.',
    ['-'], "§15")
add('m1erp._eraseBusy', '_eraseBusy()',
    'Whether a cut or a descent is in a worker.',
    ['-'], "§15")
add('m1erp._spendMark', '_spendMark(Erec)',
    'A mark with nothing pending is spent: removed from the document (logged `spent`, its box re-rastered exactly) and its id pruned from its lineage (A2 §4.6).',
    ['-'], "§15")
add('m1erp._pruneMark', '_pruneMark(id)',
    "A spent or unreturnable mark's id taken off every live native of its lineage, with its order, silent pairs, projections and budget — it never comes back, since its gesture undoes by its steps.",
    ['-'], "§15")
add('m1erp._refuse', '_refuse(E, o, HO, why, inkless)',
    "A refusal: the mark's bake leaves native `o` whole and adds the mark to its `handledBy`, so its ink under the mark shows again unless `inkless` (A2 §5.7); the bail is journaled.",
    ['-'], "§15")
add('m1erp._noteOf', '_noteOf(id)',
    "Mark `id`'s erase entry in the engine's journal.",
    ['-'], "§15")
add('m1erp._renderSoon', '_renderSoon()',
    "One render within ERASE_RENDER_MS for a bake's steps, not one per landed cut: a render per cut or per slice was most of a bake's main thread on a big drawing (REVIEWER E-2).",
    ['A spent mark renders at once. On the raster path a cut under its mark has already staled only its band (PLAN §5.3 A2-Q2).'], "§15")
add('m1erp._applyCut', '_applyCut(Erec, target, r)',
    "The document side of one cut: `cutJob`'s verdict applied and recorded on the gesture's op.",
    ["Nothing if the mark or the target has gone. Adds the seal and dust tallies. A graze changes nothing but marks the target handled by the mark as inkless (`setHandledById`: no ink under the mark, F109). A cut replaces the target with the surviving regions (`eraseReplaceById`, the pieces inheriting the target's erase lineage, A2 §4.5); a removal takes the target out, `by` the mark. Each is one bake step on the gesture's op (`_eraseOp`), with a journal note.", 'A cut that left several regions inside a multi-level family asks `_resplitFamily` whether the object came apart. Returns true when the document changed.'], "§15")
add('m1erp._noteSeal', '_noteSeal(res, subject)',
    'Count the booleans that had to be sealed. A rise here is the stitch getting worse.',
    ['Counts the booleans that had to be closed with a fabricated chord.', 'The boolean guarantees closed loops by sealing a chain the walk could not finish. That is a real if small geometric compromise, so it is counted rather than hidden — a rise here is the stitch getting worse.'], "§15")
add('m1erp._inkOutline', '_inkOutline(o, tol)',
    "An object's ink as polygon rings at a tolerance — for the connectivity walk, the erase-debug join notes and the lasso's ink test.",
    ["A shape is flattened, a fill is its own rings, a stroke is outlined first. The family connectivity walk (`_familyComponents`), the erase-debug join notes (`_familyJoinNotes`) and the lasso's ink test (`_inkInsidePolygon`) read it."], "§15")
add('m1erp._familyMembers', '_familyMembers(key)',
    'The family graph. Every member is a node; two are joined when their ink meets on the same stretch of a ceded doorway. Asks a geometric question, not whether two boxes are formally parent and child — re-homing can settle two members on different branches in the same place.',
    ['Every object sharing one family key, across all levels.', 'A family is the pieces of one logical object that ended up at different levels because an erase ceded tiles downward.'], "§15")
add('m1erp._resplitFamily', '_resplitFamily(op, key)',
    'Severance as pure re-labelling. No geometry is touched, because ceding already left the parent in pieces. The first component keeps the original key so an existing selection stays valid.',
    ['Re-labels a family into its connected components, and reports whether it came apart.', 'Pure identity work — no geometry is touched, because ceding already left the parent in pieces. Severance used to need a second cut through the parent, which declined on any cut that was not dead straight, which is what a real scribbled erase always looks like.', "The first component keeps the original key so a selection already pointing at it stays valid; the rest get fresh keys. The key changes are recorded on the gesture's undo entry so one undo unwinds geometry and identity together."], "§15")
add('m1erp._descentWorld', '_descentWorld()',
    'What a descent job reads from the engine: the lattice, the config, the canvas width and the opacity groups.',
    ['The world `eraseDescent.descentJob` runs in on the main thread; the worker gets the same fields with the lattice serialised. Tests replace it to watch or fault the square ink.'], "§15")
add('m1erp._applyDescent', '_applyDescent(Erec, target, r)',
    "The descent, as one job for the family (eraseDescent.descentJob), in a worker where there is one: every cede on a virtual document, each level's square ink the store's own piece, nothing applied until the whole descent has succeeded — then applied here, step by step.",
    ['Adds the seal and dust tallies. A refusal is recorded (`_refuse`, which marks an `inkless` target handled, F109), and so is a descent with a piece whose frame is missing. Nothing if the target was replaced or the mark has gone.', "Then each step in order: its removed object (the target, or one minted a step earlier) taken out `by` the mark, its parents and kids added with real ids in the job's order — each inheriting the target's erase lineage (A2 §4.5) —, virtual ids mapped as it goes.", 'The steps go on the op newest last, so undo unwinds the chain bottom up; then `_resplitFamily` asks whether the family is still one object.'], "§15")
add('m1erp._removedArea', '_removedArea(subject, clip)',
    'The area an erase removes, measured as the area of the intersection (F46). Nothing calls it.',
    ["`eraseJob.cutJob` measures the removal the same way inside the job. The intersection's pieces are no longer than the eraser, so its area is exact to the eraser's own ulps where before-minus-after is not."], "§15")
add('m1erp._boolOpts', '_boolOpts()',
    "The boolean's one option, the freeze radius at this engine's tolerance, passed to every cut and descent job.",
    ['So an erase stands in for an arc by its chord exactly where the tile chain would have frozen it, and nowhere else (DESIGN.md §5).'], "§15")
add('m1erp._rehomeBail', '_rehomeBail(E, o, HO, why)',
    'Record why a cede refused, and what a spent mark looked at. A refusal is otherwise invisible, and invisible refusal is exactly what "I erase and it just disappears" looks like.',
    ['Records why a descent refused, against the gesture that made it.', "A refusal is otherwise invisible: the object is already in the eraser's done set, so the erase never returns to it, and if nothing else was under the gesture the mark is consumed having done nothing. That is exactly what 'I erase and then it just disappears' looks like from the outside."], "§15")
add('m1erp._noteSpent', '_noteSpent(E)',
    'Record why a cede refused, and what a spent mark looked at. A refusal is otherwise invisible, and invisible refusal is exactly what "I erase and it just disappears" looks like.',
    ['When a mark is about to be consumed having cut nothing, records what it considered: its targets (the first 24 and the count), the refusals, and how many marks are still pending.', "Writing it down turns 'the eraser did nothing' from a mystery into a list of objects with a reason beside each."], "§15")
add('m1erp._eraseBarrier', '_eraseBarrier(kind, pairsOf, then, follow)',
    "The barrier (A2 §4.11): bakes the pending pairs a tap, a drag or a lasso names, round after round in serial order, then runs the gesture's `then` — so nothing is selected, moved or judged before its cuts land.",
    ["Pending perimeters resolve first, so a mark registers before anything moves under it. Each round takes every named pair whose target is not pending under an earlier mark; the pieces still pending under another form the next, so a target under k marks takes k rounds and no cap is needed. `follow`: the ids replaced by their pieces as steps land. With no worker the rounds run inline and `then` runs before it returns true; otherwise the gesture is parked (false) until the last round applies, and a new press, a tool change, an undo, a deselect or a pinch cancels it while its cuts go on as the bake's (DESIGN.md §7)."], "§15")
add('m1erp._barrierStep', '_barrierStep()',
    "A job landed while a gesture is parked: its barrier's rounds go on.",
    ['-'], "§15")
add('m1erp._barrierAdvance', '_barrierAdvance(b)',
    "Runs a barrier's rounds: the landed jobs of the last round applied in serial order, then the next round dispatched; false when a round waits on a worker, true when none is left and the gesture's `then` has run.",
    ["A round's fill targets become shapes before any pair is dispatched, so the log reads the same whether its cuts run inline or in workers. A pair its own inline step left pending is set aside as handled, not looped on."], "§15")
add('m1erp._barrierRound', '_barrierRound(b)',
    "A barrier's next round: each target its pairs name, with the earliest mark it is pending under anywhere, in serial order — the per-target lock, so an older mark never cuts a newer one's piece.",
    ['-'], "§15")
add('m1erp._finishBarrier', '_finishBarrier(b)',
    "A barrier's end: every mark it emptied is spent, the gesture's continuation runs with the followed ids still live, and the bake is rescheduled.",
    ['-'], "§15")
add('m1erp._cancelBarrier', '_cancelBarrier()',
    "Drops a parked gesture — a new press, a tool change, an undo, a pinch, a load: its continuation never runs, a parked lasso's loop goes, and its cuts go on as the bake's.",
    ['-'], "§15")
add('m1erp._pendingPairs', '_pendingPairs(pred, markPred)',
    'Every pending pair whose live target `pred` accepts, of the marks `markPred` accepts, as `{Erec, rec}`.',
    ['-'], "§15")
add('m1erp._familiesOf', '_familiesOf(ids)',
    'The natives of the families of the ids a barrier follows, so a tap or a drag bakes a family whole.',
    ['-'], "§15")
add('m1erp._tapBarrier', '_tapBarrier(id, then)',
    'The barriers: nothing is selected, dragged or lassoed out from under a mark that has not landed — the gesture parks until the cuts it waits on are applied, or the ink would take its un-erased shape with it and the mark stay behind to cut whatever arrives. flushErases settles every mark at once, for the tests and the thumbnails.',
    ["A tap's barrier: bakes the pending pairs of the hit object's family, then hands `then` its pieces, so the tap selects the piece under the finger (A2 §5.5, SM-5)."], "§15")
add('m1erp._dragBarrier', '_dragBarrier(then)',
    'The barriers: nothing is selected, dragged or lassoed out from under a mark that has not landed — the gesture parks until the cuts it waits on are applied, or the ink would take its un-erased shape with it and the mark stay behind to cut whatever arrives. flushErases settles every mark at once, for the tests and the thumbnails.',
    ['The selection follows the cuts to the pieces (re-selected, or deselected when nothing is left), then `then(b)` starts the drag.'], "§15")
add('m1erp._lassoBarrier', '_lassoBarrier(poly, then)',
    'The barriers: nothing is selected, dragged or lassoed out from under a mark that has not landed — the gesture parks until the cuts it waits on are applied, or the ink would take its un-erased shape with it and the mark stay behind to cut whatever arrives. flushErases settles every mark at once, for the tests and the thumbnails.',
    ["A lasso's barrier (H5): bakes every pending pair whose target's drawn box — placed by the Stage at the camera's frame — meets the loop's box, wherever its mark is."], "§15")
add('m1erp._eraseStatus', '_eraseStatus()',
    'The erase part of the engine\'s status: the pending marks, whether a gesture is parked on their cuts (the editor\'s "Finishing the erase…" chip) and how many bakes were aborted.',
    ['-'], "§15")
add('m1erp.flushErases', 'flushErases(only)',
    'The barriers: nothing is selected, dragged or lassoed out from under a mark that has not landed — the gesture parks until the cuts it waits on are applied, or the ink would take its un-erased shape with it and the mark stay behind to cut whatever arrives. flushErases settles every mark at once, for the tests and the thumbnails.',
    ['Resolves every pending mark (all, or those in `only`) on the main thread, never through the worker: oldest mark first, its head pair (`_headOf`) dispatched inline — a cut of that pair in flight dropped first —, and a mark with nothing left spent (`_spendMark`).', "The tests' settle point; a thumbnail settles the document with it before it draws."], "§15")
add('m1ewc.workerUrl', 'workerUrl()',
    "The worker script's URL: `/erase-worker.js` under the app's PUBLIC_URL.",
    ['-'], "§15")
add('m1f2.F64Builder', 'F64Builder',
    "A growable Float64Array the kobin-2 encoders append a unit's geometry to.",
    ["`n` numbers used of `buf`, the capacity doubled when full. It has the variadic `push` that `loop.encodeLoopInto` writes through, so a loop's numbers go straight in with no intermediate array."], "§15")
add('m1f2.F64Builder.constructor', 'F64Builder.constructor(cap)',
    'Allocates the buffer, at least 16 doubles, and starts it empty.',
    ['-'], "§15")
add('m1f2.length', 'length (getter)',
    'The count of numbers written so far.',
    ['-'], "§15")
add('m1f2._grow', '_grow(need)',
    'Doubles the capacity until `need` fits and copies the written numbers across.',
    ['-'], "§15")
add('m1f2.push', 'push(...vs)',
    'Appends any number of values, growing the buffer first when they do not fit.',
    ['-'], "§15")
add('m1f2.slice', 'slice()',
    'The written numbers as a Float64Array of exactly that length, a copy.',
    ["What a snapshot or an entry stores as its `geo`; the builder's spare capacity never reaches the store."], "§15")
add('m1f2.objectHeader', 'objectHeader(o, geo)',
    "A native's serialisable fields apart from its geometry: the one header kobin-1 and kobin-2 both write.",
    ["Writes `type`, `origin`, `id`, then `geo` when given (kobin-1's geometry fields, where the JSON has them), colour and opacity, and only the fields that differ from their defaults: `w` above 0, `z` when it is not the id, a non-zero `tile`, the displacement table through `encodeBelow`, the erase flag with its `bakePx`, and the erase lineage (`targets`, `targetOf`, `handledBy`, A2 §4.5) when present. Fields named in `_extra` are copied through.", '`Document.serializeNatives` (kobin-1) and `encodeObjects`/`encodeEntry` (kobin-2) all call it, so the two forms agree field for field (DESIGN.md §13).'], "§15")
add('m1f2.extraFields', 'extraFields(h)',
    'The header fields this build does not know, so a native keeps them for its next write.',
    ['Checked against the `KNOWN` whitelist, which also names the retired `windows`, `srcId` and `paths` so they are dropped rather than carried. `nativeFromRecord` stores the result as `_extra` and `objectHeader` writes those fields back, so a field a newer build adds survives a save by an older one.'], "§15")
add('m1f2.pushGeometry', 'pushGeometry(b, o)',
    "Appends one object's geometry to the builder in the span grammar and returns its `[offset, length]`.",
    ["Shape: the loop count, then each loop's length and its numbers through `encodeLoopInto` (a stored `Loop` copies its buffer). Fill: the ring count, then per ring its number count and its points. Stroke: the point count and the points.", 'The numbers are the ones kobin-1 writes as text, so a span and a kobin-1 record decode to identical objects.'], "§15")
add('m1f2.readGeometry', 'readGeometry(h, geo)',
    "Decodes a header's span back to `loops`, `polys` or `pts`, throwing on a span that does not fit.",
    ["A shape's loops are `subarray` views of the frame's array, no copy; `nativeFromRecord` wraps each as a `Loop` over the same memory. Fills and strokes come back as point arrays.", "Every count and length is checked against the span and the array, so a damaged record fails naming its object rather than reading a neighbour's numbers."], "§15")
add('m1f2.recordOf', 'recordOf(h, geo)',
    'A header plus its span as a kobin-1 record: the header without `g`, with the decoded geometry.',
    ['-'], "§15")
add('m1f2.encodeObjects', 'encodeObjects(objs)',
    "One frame's live natives as a snapshot: a header per object, each with its span, and one Float64Array.",
    ["The saver's frame snapshots (`useKobinEngine`) and the dev report's local extract are written with it."], "§15")
add('m1f2.encodeRecords', 'encodeRecords(records)',
    'kobin-1 records into the same frame form, their flat loop numbers copied without decoding a piece.',
    ["For a whole kobin-1 document written to the store (`localCanvases.saveCanvasDoc`). Its loops are already the span grammar's numbers, so they are copied as they stand."], "§15")
add('m1f2.decodeObjects', 'decodeObjects(objects, geo)',
    'A stored frame back to kobin-1 records, loops as views of its array.',
    ["Checks that `objects` is an array and `geo` a Float64Array, then decodes each header with `recordOf`. The editor's restore, `localCanvases` and the report's loader read frames through it; a caller handing records to JSON copies the views to plain arrays first."], "§15")
add('m1f2.geomSlot', 'geomSlot(b, geom)',
    "A move member's before or after geometry as a typed header with its span in the entry's array.",
    ['The type is read off which geometry field is present. `attachRect`, `tile` and `below` ride along only when the source has the key, so a table-only move reads back with no geometry keys; `undefined` stays `undefined` and any other empty value becomes null.'], "§15")
add('m1f2.readGeomSlot', 'readGeomSlot(s, geo)',
    'Reads a `geomSlot` back: the decoded geometry plus the `attachRect`, `tile` and `below` it carried.',
    ['-'], "§15")
add('m1f2.encodeEntry', 'encodeEntry(op)',
    'One op-log entry as JSON plus one Float64Array: every object it carries becomes a header with a span.',
    ["Per kind: `add`, `put`, `remove` and `mark` carry `obj`; `bake` its removed object and pieces; `removeMany` its records; `move` and `moveFrames` each member as the object it now is, with `base`/`after` geometry only where the member has them; `removeFrames`, `bakeFrames` and `deleteMany` every deleted frame's natives. Kinds with no geometry pass through unchanged.", 'An entry carries RESULTS, never a gesture to recompute, so replay does not depend on the code version that wrote it (DESIGN.md §13).'], "§15")
add('m1f2.decodeEntry', 'decodeEntry(entry)',
    "An entry back to its op, every object a kobin-1 record with its geometry as views of the entry's array.",
    ['Throws on an entry with no kind. `OpLog._replay` decodes each stored entry through it.'], "§15")
add('m1f2.packChunk', 'packChunk(kind, header, geo)',
    'A snapshot or a run of entries as one byte array for the cloud: magic, kind, header JSON, padding, doubles.',
    ["Layout: `KB2\\0`, the kind (`CHUNK_FRAME` or `CHUNK_LOG`), the geometry version, the header's byte length, its UTF-8, zero padding to a multiple of 8, then the doubles little-endian, so a reader can view them in place. The module refuses to load on a big-endian platform.", "`cloud/store2.js` gzips the result and splits it into 700 KiB parts; the report's whole-drawing parts use it too."], "§15")
add('m1f2.unpackChunk', 'unpackChunk(u8)',
    'Parses a chunk back to kind, geometry version, header and geometry, refusing one malformed or written by a newer build.',
    ['Checks the magic, refuses a geometry version above `GEO_VERSION` with a message naming both, and checks the header and geometry lengths against the bytes. The geometry is a view of the buffer when its offset is 8-aligned, a copy otherwise.'], "§15")
add('m1f2.utf8Encode', 'utf8Encode(str)',
    "A string as UTF-8 bytes, surrogate pairs joined, for a chunk's header.",
    ['Dependency-free because `TextEncoder` is not on every test global.'], "§15")
add('m1f2.utf8Decode', 'utf8Decode(u8)',
    'UTF-8 bytes back to a string, four-byte sequences as surrogate pairs.',
    ["The inverse of `utf8Encode`, for `unpackChunk`'s header. It assumes well-formed input and does not validate continuation bytes."], "§15")
add('m1fil.Files', 'Files',
    'The two save formats, as a mixin.',
    ["kobin-1 (persist.js), the file format and the envelope the local store writes beside its frames; and dev-0, which the tests load and a report's extract is turned back into. Same mixin arrangement as ErasePipeline."], "§15")
add('m1fil.snapshot', 'snapshot()',
    'The development snapshot (dev-0): camera, natives and lattice, for tests and tools. A report carries a kobin-2 extract that report.loadReport turns back into one.',
    ["`loadSnapshot` is still how a report is reopened: `report.loadReport` rebuilds a dev-0 snapshot from the report's extract and loads it, which is how a browser bug becomes a failing test offline (DESIGN.md §13, §14).", 'Loading loads the lattice, mints every frame the natives name, loads the natives, clears the scene state, settles the camera and renders.'], "§15")
add('m1fil._mintNamedFrames', '_mintNamedFrames(natives)',
    "Mints every frame a loaded file's natives name, before the natives are added (F67).",
    ['`LevelMap.ensureId` per frame key, so no native is homed in a frame the lattice lacks. `loadSnapshot` and `loadDrawing` call it after the lattice loads.'], "§15")
add('m1fil.serializeDrawing', 'serializeDrawing(meta, {frames})',
    'The real save format. Loading settles the camera into a legal state, which is what stopped the first interaction after opening a file paying for a whole crossing.',
    ["The kobin-1 envelope around the engine's own state. `meta.sceneIndex` is the scene client's last state (`exportForSave`). `frames` is null for the whole drawing, a list for only those frames' natives, or [] for the envelope alone, which the autosave writes as the canvas header.", 'Loading (`loadDrawing`) validates everything before touching state, loads the lattice, mints every frame the natives name, loads the natives, **settles the camera** into a legal state, clears the erase bookkeeping and drops any cut in flight. Measured: an unsettled camera made the first pan after a load cost 200 ms and every later one 0.2 ms.'], "§15")
add('m1gc.initFrameGc', 'initFrameGc(E)',
    "The engine's frame-GC state, made once: the candidate set (the lattice's `minted` set too, so every frame minted becomes a candidate), the camera's trail, and the document's hook that makes the frames dropped ops named candidates.",
    ['-'], "§15")
add('m1gc.namedBy', 'namedBy(E, ops)',
    'Every frame a list of ops names (`Document.opFrames`).',
    ['-'], "§15")
add('m1gc.noteFrameEvent', 'noteFrameEvent(E, ev)',
    "A document event: the frame it may have emptied becomes a candidate — a removed native's home, a refiled frame and its old parent, a removed frame; a reset clears the camera's trail.",
    ['-'], "§15")
add('m1gc.noteCameraFrame', 'noteCameraFrame(E)',
    "The camera's frame, once a render: a change puts the frame it left on the trail of the last four, and what falls off becomes a candidate; true when it changed (a GC trigger).",
    ['The trail is kept because a crossing back composes through the frame left (DESIGN.md §8). The first frame after a load is not a change.'], "§15")
add('m1gc.sweepFrames', 'sweepFrames(E)',
    "Every frame made a candidate and collected: the host's sweep once a restored store is in (a load adds no candidates).",
    ['-'], "§15")
add('m1lm.cellKey', 'cellKey(i, j)',
    "A child map's key.",
    ['Two integers as a string. The child map is keyed by cell index rather than searched, which is what makes re-entry a lookup.'], "§15")
add('m1lm.phaseThrough', 'phaseThrough(tile, path, frames)',
    "Carry an object's grid offset along a frame path. A sideways hop is a whole number of boxes and leaves it alone — which is exactly why two numbers are enough.",
    ["Carries an object's cutting-grid offset along a route between boxes.", 'Up a level the grid coarsens and the box centre comes back; down a level it is the child transform. A sideways hop is a whole number of boxes and **leaves the offset alone** — which is exactly why two numbers are enough to pin the grid to the object through every kind of move.'], "§15")
add('m1lm.LevelMap', 'LevelMap',
    'The box lattice itself.',
    ['Owns the boxes, their cells and edges, and the pure transforms between them. No camera, no objects, no rendering.'], "§15")
add('m1lm.frame', 'frame(id)',
    'Tree reads. Plumbing.',
    ['Plain tree reads: a box by id, its depth, its parent, its children, the origin box at a depth, and the box on a given path at a depth. No side effects.'], "§15")
add('m1lm.depthOf', 'depthOf(key)',
    'Tree reads. Plumbing.',
    ['Plain tree reads: a box by id, its depth, its parent, its children, the origin box at a depth, and the box on a given path at a depth. No side effects.'], "§15")
add('m1lm.parentOf', 'parentOf(key)',
    'Tree reads. Plumbing.',
    ['Plain tree reads: a box by id, its depth, its parent, its children, the origin box at a depth, and the box on a given path at a depth. No side effects.'], "§15")
add('m1lm.childrenOf', 'childrenOf(id)',
    'Tree reads. Plumbing.',
    ['Plain tree reads: a box by id, its depth, its parent, its children, the origin box at a depth, and the box on a given path at a depth. No side effects.'], "§15")
add('m1lm.walk', 'walk(rootId, fn)',
    'Calls `fn` on every frame a subtree stands for: the root, its shadows, their kids and theirs.',
    ["Depth-first on an explicit stack, in no promised order. Shadows are included because they share their resident's cell and belong to its subtree for the selection and the erase (DESIGN.md §8).", "Read by `Document.maxZUnder`, `Document.removeFrameSubtree` and the selection's status count."], "§15")
add('m1lm.spineAt', 'spineAt(depth)',
    'Tree reads. Plumbing.',
    ['Plain tree reads: a box by id, its depth, its parent, its children, the origin box at a depth, and the box on a given path at a depth. No side effects.'], "§15")
add('m1lm.pathFrameAt', 'pathFrameAt(fromId, depth)',
    'Tree reads. Plumbing.',
    ['Plain tree reads: a box by id, its depth, its parent, its children, the origin box at a depth, and the box on a given path at a depth. No side effects.'], "§15")
add('m1lm._isSpine', '_isSpine(parentId, i, j)',
    'Id minting. The origin chain keeps its depth as its id; everything else is <parent>/<i>,<j>, with #n on the segment when a moved frame left that chain taken, or a forgotten moved frame retired it this session. Ids are document keys, so they never change once minted.',
    ["Ids are document keys and cache keys, so a frame's id never changes, even when a subtree move re-addresses it. A cell a moved frame vacated mints a twin with `#n`, and every descendant carries it (DESIGN.md §13, F80).", 'A re-addressed spine frame leaves the chain but keeps its id string, so `_spine` is the authority on which frame is the origin at a depth.'], "§15")
add('m1lm.cellChild', 'cellChild(parentId, i, j)',
    'The child box, minting on first visit. An out-of-range index carries up to the parent — which is what stopped a camera minting a box at index 2059 and making the drawing refuse to reopen.',
    ['Returns the child box at a given index, creating it if this is its first visit.', '**Carries out-of-range indices.** An index outside the balanced range names a box this parent does not own, so it carries up to a sibling of the parent and recurses — the same arithmetic a long addition uses.', "That carry was a hope rather than an invariant until it bit: a camera that crossed while its centre sat just half a percent outside the parent's square minted a box at an illegal index. The session carried on fine; the damage showed on **reload**, where the file was refused outright and the drawing could not be opened at all."], "§15")
add('m1lm.findCellChild', 'findCellChild(parentId, i, j)',
    'The child that already exists. No side effects.',
    ['The child box at an index, if it already exists. No side effects.', 'Refuses out-of-range indices outright rather than carrying, because resolving a carry would have to create boxes and this is required not to.'], "§15")
add('m1lm.neighbour', 'neighbour(id, di, dj)',
    'The box di, dj along at the same depth, carrying up through parents. Panning sideways and dragging sideways are the same operation seen from two ends.',
    ['The box a given number of steps away at the same depth.', "Adds the offset to this box's index; if that runs off the end of the range, the excess carries up to the parent, recursively — creating coarser boxes if the tree does not reach that far yet.", 'Panning sideways and dragging an object sideways are the same operation seen from two ends, and both come through here.'], "§15")
add('m1lm._growRoot', '_growRoot(f)',
    'Give a parentless box a parent so it can have siblings. Exact, and leaves every existing id untouched.',
    ['Gives a parentless box a parent, so it can have siblings.', 'The new coarser box is by definition the one containing it, so its index is zero and the origin chain stays the origin chain. Exact, and it leaves every existing box id untouched.'], "§15")
add('m1lm._adopt', '_adopt(f, p, cell)',
    'Makes a parentless frame cell `cell` of `p`, its edge and centre derived from the cell.',
    ["Wires `p`'s child map and drops the route cache. Used by `_growRoot` and `ensureSpine` when the root gains a parent, and by `merge` when another lattice gave a local root one."], "§15")
add('m1lm.readdress', 'readdress(id, parentId, i, j)',
    "Moves one frame to cell (i, j) of a parent one depth up; its id and every descendant's stay as they are.",
    ['Returns the frame, `{ occupied }` when another frame holds that cell, or null for a bad request (wrong depth, a digit out of range). The subtree follows through its parent pointer; the route cache is dropped, `addrEpoch` bumped and the spine rebuilt.', 'Only the tests call it; a drag re-addresses through `readdressMany`, which makes a shadow instead of refusing an occupied cell.'], "§15")
add('m1lm._leave', '_leave(f)',
    "Takes a frame out of its cell: a shadow leaves its resident's set; a resident hands the cell to one of its shadows.",
    ['The shadow that takes the cell inherits the other shadows. The first half of every re-address (`readdress`, `readdressMany`).'], "§15")
add('m1lm._take', '_take(f, p, i, j, empty)',
    'Gives a frame cell (i, j) of `p`, making a shadow when another frame already holds the cell.',
    ["Sets the frame's address (parent, cell, edge, centre), bumps its `addrSeq` and drops its record view. A free cell is taken. A resident with no kids that `empty(id)` reports as holding nothing yields the cell and becomes the newcomer's shadow, its own shadows with it; any other resident keeps the cell and the newcomer shadows it.", 'Returns `[shadow, resident]` when a shadow was made, else null. A resident with kids keeps the cell even when its whole subtree is empty (DESIGN.md §8, F80).'], "§15")
add('m1lm.adoptShadow', 'adoptShadow(M, E)',
    "The lattice half of merging shadow M into its resident E: M's kids and shadows move under E and M is deleted.",
    ["Each kid of M takes its cell under E, or shadows the child E already has there, its own shadows following. M's shadows become E's. The route cache is dropped, `addrEpoch` bumped and the spine rebuilt.", 'Returns the record `unadoptShadow` reverses. The natives are moved by `Document._mergeShadows`, which calls this.'], "§15")
add('m1lm.unadoptShadow', 'unadoptShadow(rec)',
    "Reverses `adoptShadow`: the merged frame comes back as E's shadow, with its kids and shadows under it.",
    ['Rebuilds the frame from the record (address, shift, a bumped `addrSeq`), takes back the shadows it gave E, and walks the kids in reverse, freeing the cells they took or un-shadowing them. Used by `Document.unmerge` on undo.'], "§15")
add('m1lm._rebuildSpine', '_rebuildSpine()',
    'Recomputes the origin chain: climbs to the true root, then follows the (0, 0) cells down.',
    ["Called after every re-address, merge and load, because `_spine`, not a frame's id, says which frame is the origin at a depth. It climbs first because `merge` can give the recorded root a parent without updating `_rootId`."], "§15")
add('m1lm.subtreeStart', 'subtreeStart(rootId, atDepth)',
    "Records a subtree's addresses at a drag's start, down to three levels below the camera's depth.",
    ['Returns id -> `{ parent, i, j, depth }` for the root, its shadows and every descendant to `atDepth + 3`; deeper frames take zero digits from any displacement, so the walk stops there.', 'Every target of the drag is computed from this one record, never from the current addresses, which is what makes a slow drag land where a fast one does (DESIGN.md §8).'], "§15")
add('m1lm.readdressMany', 'readdressMany(targets, opts)',
    'Applies a subtree move in two phases: every mover leaves its cell, then each takes its target, coarsest first.',
    ['Two phases so movers never collide with one another; coarsest first so a moving parent holds its new cell before its children ask who holds theirs. An occupied target makes a shadow (`_take`), the resident yielding when `opts.empty(id)` says it holds nothing.', 'Returns `{ moved, shadowed: [{ id, of }] }`; drops the route cache, bumps `addrEpoch` and rebuilds the spine. Used by the drag and by the undo of `moveFrames`.'], "§15")
add('m1lm.peekNeighbour', 'peekNeighbour(id, di, dj)',
    'The same without minting — reading tiles must not grow the tree. What the uncle pickup uses.',
    ['One neighbouring box, if it already exists.', 'A parentless box has no siblings yet and this must not invent any: returning the box itself would make every direction resolve to the same place, and a caller ringing the eight neighbours would get one box eight times.'], "§15")
add('m1lm.peekRing', 'peekRing(id)',
    'The same without minting — reading tiles must not grow the tree. What the uncle pickup uses.',
    ['The existing boxes surrounding one box at its own depth — up to eight.', 'Never mints. Reading tiles must not grow the tree, or looking at a drawing would change it.'], "§15")
add('m1lm.ensureParent', 'ensureParent(id)',
    'Crossing down needs a parent.',
    ['Makes sure a box has a parent (crossing down needs one) and returns the edge between them.'], "§15")
add('m1lm._viewCell', '_viewCell(inScale, inPanX, inPanY)',
    'Which child box a crossing lands in — a pure function of where the view centre is, with no history and no reuse test.',
    ['Which child box the view centre falls in, as an index pair.'], "§15")
add('m1lm.findChild', 'findChild(parentId, inScale, inPanX, inPanY)',
    'Which child box a crossing lands in — a pure function of where the view centre is, with no history and no reuse test.',
    ['Which child box the view centre falls in, as an index pair.'], "§15")
add('m1lm.ensureChild', 'ensureChild(parentId, inScale, inPanX, inPanY)',
    'Which child box a crossing lands in — a pure function of where the view centre is, with no history and no reuse test.',
    ['The child box a crossing at this camera position lands in, minting on first visit.', 'A pure function of **where the view centre is** — no history, no reuse test, no nearest-neighbour search. That is what makes returning to a place a lookup rather than a decision, and it is why aiming one pixel differently on the way down no longer creates a whole new branch.'], "§15")
add('m1lm.ensureParentEdge', 'ensureParentEdge(childId)',
    'Crossing down needs a parent.',
    ['Makes sure a box has a parent (crossing down needs one) and returns the edge between them.'], "§15")
add('m1lm._recOf', '_recOf(f)',
    "The spine's legacy per-depth { s, t, grid } records, read through the engine's crossings getter.",
    ["Derived from each spine frame's edge and the constant grid, cached on the frame until it is re-addressed. Nothing is stored here."], "§15")
add('m1lm.records', 'records (getter)',
    "The spine's legacy per-depth { s, t, grid } records, read through the engine's crossings getter.",
    ["Derived from each spine frame's edge and the constant grid, cached on the frame until it is re-addressed. Nothing is stored here."], "§15")
add('m1lm.makeGrid', 'makeGrid()',
    "The render cache's partition — frame-aligned, constant, canvas-independent. It only decides how much work one bake covers, and cannot influence geometry.",
    ["One cache tile's rectangle. Tiles are centred on their index, like boxes."], "§15")
add('m1lm.grid', 'grid()',
    "The render cache's partition — frame-aligned, constant, canvas-independent. It only decides how much work one bake covers, and cannot influence geometry.",
    ["One cache tile's rectangle. Tiles are centred on their index, like boxes."], "§15")
add('m1lm._frameFor', '_frameFor(key)',
    'Accept a frame id or a bare depth. Plumbing.',
    ['Accepts either a box id or a bare depth, so numeric callers and tests keep working unchanged.'], "§15")
add('m1lm.frameFor', 'frameFor(key)',
    'Accept a frame id or a bare depth. Plumbing.',
    ['Accepts either a box id or a bare depth, so numeric callers and tests keep working unchanged.'], "§15")
add('m1lm.tileRect', 'tileRect(key, i, j)',
    "The render cache's partition — frame-aligned, constant, canvas-independent. It only decides how much work one bake covers, and cannot influence geometry.",
    ["One cache tile's rectangle. Tiles are centred on their index, like boxes."], "§15")
add('m1lm.tileRange', 'tileRange(key, rect)',
    "The render cache's partition — frame-aligned, constant, canvas-independent. It only decides how much work one bake covers, and cannot influence geometry.",
    ['Which cache tiles a rectangle reaches, as an index range.', 'The cache partition is frame-aligned and constant, and only decides how much work one bake covers — it never cuts geometry.'], "§15")
add('m1lm._centre', '_centre(key)',
    "One box's centre in its parent's units.",
    ['An exact integer, and the reason a descent is exact: subtracting it BEFORE scaling makes the magnification a power of two on numbers that are already commensurate.'], "§15")
add('m1lm.toChild', 'toChild(p, key)',
    'One-edge point transforms. Cancel against the box centre first, then scale by a power of two — both steps exact, so a descent of any depth is a chain of exact steps.',
    ["A rectangle, expressed in the parent box's coordinates."], "§15")
add('m1lm.toParent', 'toParent(p, key)',
    'One-edge point transforms. Cancel against the box centre first, then scale by a power of two — both steps exact, so a descent of any depth is a chain of exact steps.',
    ["A rectangle, expressed in the parent box's coordinates."], "§15")
add('m1lm.rectToParent', 'rectToParent(rect, key)',
    'One-edge point transforms. Cancel against the box centre first, then scale by a power of two — both steps exact, so a descent of any depth is a chain of exact steps.',
    ["A rectangle, expressed in the parent box's coordinates."], "§15")
add('m1lm._ancestors', '_ancestors(id)',
    "Tree walks. chainFrom is an object's address relative to an ancestor — the digits themselves.",
    ["An object's address relative to an ancestor: the list of box indices, coarsest first."], "§15")
add('m1lm.isAncestor', 'isAncestor(aId, bId)',
    "Tree walks. chainFrom is an object's address relative to an ancestor — the digits themselves.",
    ["An object's address relative to an ancestor: the list of box indices, coarsest first."], "§15")
add('m1lm.isUnder', 'isUnder(aId, bId)',
    'Is frame b what frame a stands for in a selection: a itself, a descendant, or a shadow of either?',
    ['Walks up from b, true at a frame that is a or shadows a. Tiles use `isAncestor`, which excludes a itself and knows nothing of shadows (DESIGN.md §10).'], "§15")
add('m1lm.chainFrom', 'chainFrom(rootId, id)',
    "Tree walks. chainFrom is an object's address relative to an ancestor — the digits themselves.",
    ["An object's address relative to an ancestor: the list of box indices, coarsest first."], "§15")
add('m1lm.frameAtChain', 'frameAtChain(rootId, chain)',
    "Tree walks. chainFrom is an object's address relative to an ancestor — the digits themselves.",
    ['Walks (and mints) the box at a given address below a root.'], "§15")
add('m1lm.commonAncestor', 'commonAncestor(aId, bId)',
    "Tree walks. chainFrom is an object's address relative to an ancestor — the digits themselves.",
    ["An object's address relative to an ancestor: the list of box indices, coarsest first."], "§15")
add('m1lm.displaceFrame', 'displaceFrame(id, atDepth, dx, dy)',
    'The move. Expand the displacement into digits, add them to the address with carries, absorb a coarse-end carry by stepping the ancestor sideways, and hand back the leftover — the only part that ever touches geometry.',
    ['Where a box ends up when its contents are displaced — the whole of a move at depth, as integer arithmetic.', "Expands the displacement into whole-box digits, one per level between the level the drag was made at and the object's own.", "Adds those digits to the box's address, with carries.", 'A carry off the **coarse** end means the move crossed a box boundary at or above the level it was made at, which is real, so the ancestor steps sideways to absorb it.', "What the digits could not express comes back as a remainder, in the box's own units and smaller than one box — **the only part that ever touches geometry**."], "§15")
add('m1lm.framePath', 'framePath(fromKey, toKey)',
    'The route between two boxes: up to the common ancestor, then down. Cached, and the cache is dropped whenever a box is minted — on a seventeen-level document this walk dominated a pan.',
    ['The route between two boxes: up to their common ancestor, then down.', 'Cached, because this is called for every object, every tile, every render — on a seventeen-level document the walk alone dominated a pan. The cache is dropped whenever a box is minted, which is the only time the tree changes.'], "§15")
add('m1lm._buildPath', '_buildPath(fromId, toId)',
    'The route between two boxes: up to the common ancestor, then down. Cached, and the cache is dropped whenever a box is minted — on a seventeen-level document this walk dominated a pan.',
    ["Computes an uncached route: collect one box's ancestors, walk the other's until they meet, then list the downward steps."], "§15")
add('m1lm.frameFactor', 'frameFactor(fromId, toId)',
    'The scale between two boxes.',
    ['The scale between two boxes — the product of the per-step ratios along the route.'], "§15")
add('m1lm.mapPointF', 'mapPointF(p, fromId, toId)',
    'A point or rect across boxes, one edge at a time.',
    ["A point from one box's coordinates into another's, **one edge at a time**.", 'Going up divides and adds the box centre; going down subtracts the centre and multiplies. Never composed into a single jump, because a composed jump upward cancels catastrophically.'], "§15")
add('m1lm.mapRectF', 'mapRectF(rect, fromId, toId)',
    'A point or rect across boxes, one edge at a time.',
    ['A rectangle across boxes, by mapping two opposite corners and re-normalising.', 'Every edge is a uniform scale plus a shift, so a rectangle maps to a rectangle exactly — which is why the erase prefilter projects boxes rather than geometry.'], "§15")
add('m1lm.objShift', 'objShift(below, homeId, F)',
    "Where a moved object's picture comes from in frame F: the unmoved frame F0 holding its pieces, and the sub-frame remainder.",
    ["The object's table at F's depth (`shiftAt`) is walked back from F's address as negated cell digits with carries, from the frame on F's path at the home's depth; F0 is minted if it was never visited. At or above the home, or with no cell digits, F0 is F and only `rem` applies.", "F0's pieces are drawn in F translated by `rem` (`piece.res`), and an input made in F is translated back by it before it reaches the geometry (DESIGN.md §8, F55). Returns `{ F0, rem, sh }`, or null when the chain cannot be formed."], "§15")
add('m1lm.frameShifted', 'frameShifted(F0, hd, sh)',
    "The inverse of `objShift`: the frame at F0's depth where a picture read from F0 is drawn.",
    ["Adds the table's cell digits and carry to F0's address. Nothing calls it."], "§15")
add('m1lm._homeToX', '_homeToX(fromId, toId, homeId, toHome)',
    'Decides which way an object-table mapping runs: out from the home to a view, or back into the home.',
    ["True when `fromId` is the home, unless both ends are the home and the caller passed `toHome`: an input made in the object's own frame names the direction itself (F72)."], "§15")
add('m1lm.mapPointObj', 'mapPointObj(p, fromId, toId, below, homeId, toHome)',
    "`mapPointF` between an object's home and a frame where its picture is seen, through its displacement table.",
    ["Home to X: the exact chain to X's unmoved frame F0, then plus the remainder, which is the point as drawn in X. X to home: the remainder off first, then the exact chain back from F0, which is what an input in X means in the stored coordinates.", 'With no table it is `mapPointF`, bit for bit (DESIGN.md §8, F55).'], "§15")
add('m1lm.mapRectObj', 'mapRectObj(rect, fromId, toId, below, homeId, toHome)',
    "A rect through an object's displacement table: two corners by `mapPointObj`, re-normalised.",
    ["Exact as a rect, because every hop and the remainder are a uniform scale plus a translation. Every rect that reaches a moved object's geometry goes through it: an eraser's box, a selection box, a seam window (F68-F72)."], "§15")
add('m1lm.projectLoops', 'projectLoops(loops, fromId, toId)',
    'Arc loops carried across frames one edge at a time: what `projectF` does to a shape, without the tile phase.',
    ['Up an edge: scale by 1/R and add the cell centre; down: subtract the centre, then scale by R (`transformLoopsAbout`), so an arc stays an arc. Null when the two frames share no ancestor. Called by `projectLoopsObj`.'], "§15")
add('m1lm.projectLoopsObj', 'projectLoopsObj(loops, fromId, toId, below, homeId, toHome)',
    "Loops through an object's displacement table: how an eraser reaches the coordinates a moved object is stored in.",
    ["`mapPointObj` for whole loops: the exact chain to or from the unmoved frame, with the remainder as a translation on the frame's side. With no table it is `projectLoops`.", "The erase passes `toHome` (`_eraserLoopsInto`), so a mark drawn in the object's own frame still comes back through the remainder (F72)."], "§15")
add('m1lm.projectF', 'projectF(o, homeId, toId)',
    "An object across boxes. For a resolved outline the arcs survive untouched — the endpoints move, the bulge does not change at all — and the object's grid offset rides along. One edge at a time; a composed long jump upward cancels.",
    ["An object, expressed in another box's coordinates.", '**A resolved outline survives untouched.** Every edge is a uniform scale plus a translation, so an arc stays an arc: the endpoints move and the bulge does not change at all. The perimeter crosses a level with no re-resolving and no fitting, which is the property the whole representation exists for.', 'Hops are applied **one edge at a time**; a composed long jump cancels going up.', "The object's own tile-grid offset rides along, because a sideways hop is a whole number of boxes and leaves it alone, and a level crossing transforms it the same way the ink is transformed.", 'Raw strokes and legacy polygon fills take simpler paths through the same route.'], "§15")
add('m1lm.framePointToScreen', 'framePointToScreen(fromKey, x, y, activeKey, inScale, inPanX, inPanY)',
    'A point in one frame, in screen pixels: mapPointF into the active frame, then the in-frame zoom and pan. The depth-keyed wrappers that used to sit beside it are gone; Camera.levelPointToScreen is the one caller and it passes a frame id.',
    ['A point in one frame, in screen pixels.', 'Two steps, and the split is the whole point: `mapPointF` carries the point into the ACTIVE frame - address arithmetic, exact, and independent of where the view happens to be - and only then does the in-frame zoom and pan turn it into pixels.', 'It returns null rather than a guess when either frame id is unknown, because the caller is drawing an overlay and a wrong pixel is worse than no overlay.'], "§15")
add('m1lm.effectiveZoom', 'effectiveZoom(activeKey, inScale)',
    'Absolute zoom, for the scale bar.',
    ["Absolute zoom: the in-frame scale times the factor from the origin spine's level-0 frame to the active one.", 'Falls back to the in-frame scale when either frame is unknown. The scale bar reads it through `Camera.effectiveZoom`, and `sceneZoom` through the engine.'], "§15")
add('m1lm.serialize', 'serialize()',
    "The lattice as (id, parent, depth, cell), plus a moved frame's pending shift and shadow link; the edge is derived and the grid is a constant. A pre-lattice file is refused here, never converted.",
    ['The edge is derived from the cell and the grid is a constant, so neither is stored. Frames are written in depth, then id, order. Every kobin-2 write carries it beside its entries (DESIGN.md §13).', '**A pre-lattice file is refused**, never converted: converting would rewrite stored coordinates, the one operation the design exists to avoid.', '`load` adds parents before children, mints a root `0` if none came, re-attaches each shadow to its resident (the resident keeps the cell) and rebuilds the spine.'], "§15")
add('m1lm.ensureSpine', 'ensureSpine(depth)',
    'Grow the origin chain to a depth; wipe; note a new canvas size. A resize changes no geometry — grids are constants.',
    ['Grows the origin chain to a requested depth, in either direction.', 'Growing upward mints a new coarser root and adopts the old one as its child. Growing downward mints origin children. Both leave existing ids untouched.', '`reset` wipes the tree back to a single root; `resize` records a new canvas size and **changes no geometry at all**, because grids are constants now rather than derived from the canvas.'], "§15")
add('m1lm.resize', 'resize(width, height)',
    'Grow the origin chain to a depth; wipe; note a new canvas size. A resize changes no geometry — grids are constants.',
    ['Grows the origin chain to a requested depth, in either direction.', 'Growing upward mints a new coarser root and adopts the old one as its child. Growing downward mints origin children. Both leave existing ids untouched.', '`reset` wipes the tree back to a single root; `resize` records a new canvas size and **changes no geometry at all**, because grids are constants now rather than derived from the canvas.'], "§15")
add('m1off.snapDisplacement', 'snapDisplacement(v)',
    "Snap a displacement to 2^-10 of the move level's unit — a quarter pixel at its deepest zoom — before it enters the table.",
    ['Exact: a multiply and a divide by a power of two. Snapped, an entry is whole cells from three levels below the move, so the paint-time remainder lives on two levels only (DESIGN.md §8). The drag calls it.'], "§15")
add('m1off.offsetAt', 'offsetAt(below, k)',
    "The table's entry at depth `k` below the home, or null when it is absent or zero.",
    ['-'], "§15")
add('m1off.hasOffsets', 'hasOffsets(below)',
    'Does this table hold any non-zero entry?',
    ['-'], "§15")
add('m1off.cloneBelow', 'cloneBelow(below)',
    "A detached copy of a table's non-zero entries, or undefined when there are none.",
    ['-'], "§15")
add('m1off.tidy', 'tidy(out)',
    "Drop a table's zero entries, in place; undefined when nothing is left.",
    ['So an empty table has one form, undefined, never `[]`.'], "§15")
add('m1off.carryOf', 'carryOf(v)',
    'How many whole frames to carry so a remainder lands in [−W/2, W/2).',
    ['-'], "§15")
add('m1off.addOffset', 'addOffset(below, k, dx, dy)',
    'Add a displacement at depth `k` and carry whole frames upward; returns the new table and the whole home frames that left depth 0.',
    ['A frame at depth m is exactly G units at depth m − 1, so every carry is integer arithmetic. The carry out of the home level (`cellX`, `cellY`) is a change of address — the native is re-homed to the neighbour cell, and nothing is ever added to a stored coordinate (F41, F55). The input table is not touched.'], "§15")
add('m1off.shiftAt', 'shiftAt(below, k0)',
    "The table's translation at depth `k0` below the home, split into whole cells per depth, whole home frames, and the sub-frame remainder.",
    ['Returns `{ digits, carry, rem }`: `digits[m]` the cells at depth m (1 to `k0`), `carry` the home frames, `rem` in [−W/2, W/2) at `k0` — what paint applies and inputs subtract. Above the home (`k0` < 0) only `rem` is set.', "Digits and remainders from entries at or above `k0` are exact (the snap); deeper entries add exact power-of-two fractions, and only their sum can round, in paint's own precision."], "§15")
add('m1off.hasDigits', 'hasDigits(sh)',
    'Does a `shiftAt` result move the picture by any whole frame?',
    ["When it does not, `LevelMap` reads the picture from the object's own frame and applies only the remainder."], "§15")
add('m1off.residual', 'residual(below, k0)',
    "The translation paint applies to an object's picture at depth `k0` (`piece.res`): the sub-frame remainder, or null when it is zero.",
    ["The whole-frame part is the object's address at that level (`LevelMap.objShift`), not a translation."], "§15")
add('m1off.shiftDown', 'shiftDown(below, k)',
    "The table of a kid `k` levels below its parent: the parent's entries at or above the kid's level folded into its `below[0]`, the deeper ones moved up by `k`.",
    ["Only the folded entries' remainder enters the table; their whole frames are the kid's address. Folding the deeper entries into `below[0]` too counted the displacement twice — measured as an erase at the drag's level missing the moved ink by exactly the remainder. Used by the cede and by scaling down."], "§15")
add('m1off.shiftUp', 'shiftUp(below)',
    "The table of the same object promoted one level up: every entry one depth deeper, the home level's included.",
    ['-'], "§15")
add('m1off.sameShift', 'sameShift(a, b)',
    'Are two frame shifts (`[x, y]` or null) equal?',
    ['A shift is the k = 0 entry a moved frame owes its natives (DESIGN.md §8); the subtree drag and the pointer-up compare them.'], "§15")
add('m1off.sameBelow', 'sameBelow(a, b)',
    'Do two tables hold the same non-zero entries, absent and zero counting as equal?',
    ['-'], "§15")
add('m1off.encodeBelow', 'encodeBelow(below)',
    'A table in its file form, `[[k, ox, oy], ...]`, or undefined when it is empty.',
    ['The form the snapshot, the op log and the phone report carry.'], "§15")
add('m1off.decodeBelow', 'decodeBelow(raw)',
    'A table back from its file form; throws on a malformed entry rather than guessing.',
    ['The file loader validates first.'], "§15")
add('m1opl.lvl', 'lvl(v)',
    'A frame id as a string, or null: the one spelling every entry and `touches` list uses.',
    ['-'], "§15")
add('m1opl.snapshotRule', 'snapshotRule(frameSeq, listed)',
    "The replay's test whether the stored snapshots already hold a log entry at `seq` touching some frames: every such frame's snapshot is at or past it, and a frame the header does not list was empty at that write, so it holds every entry.",
    ["F98: a container a later drop emptied had lost its seq, and its entries replayed over newer snapshots. Replay and `foldStore`'s log tail share this one rule."], "§15")
add('m1opl.OpLog', 'OpLog',
    'The engine side of the kobin-2 op log: records what the document did as entries carrying results, and replays them at load.',
    ["It subscribes to `Document`'s change and op events and queues an entry per fresh op, bake step, consumed mark, undo, redo, settle, merge, and geometry change made under no op. `drain` hands the saver the tick's entries and the frames that must snapshot; the saver rewrites a frame's snapshot only then or when its entries have outgrown it (DESIGN.md §13).", '`replay` applies stored entries onto the loaded snapshots, rebuilds the undo and redo stacks from them and re-registers pending erasers with their done sets.', 'The lattice is not logged: every write carries `LevelMap.serialize`, so a replayed `moveFrames` or `mergeFrame` rebuilds the op and re-addresses nothing (DESIGN.md §8).'], "§15")
add('m1opl.OpLog.constructor', 'OpLog.constructor(engine)',
    "Binds to the engine's document and subscribes to its change and op events, with an empty tick.",
    ["`seq` is the last seq handed out; the saver sets it from the store's header on load. The tick is `queue` (items in event order), `queued` (the pending add, mark or put per id, for coalescing), `removed` (objects removed this tick), `forced` (frames that must snapshot) and `needFull`."], "§15")
add('m1opl.detach', 'detach()',
    'Unsubscribes from the document.',
    ['-'], "§15")
add('m1opl._next', '_next()',
    'Hands out the next seq.',
    ['A seq is taken when the event happens, so entries are in event order even when they are encoded later, at the drain.'], "§15")
add('m1opl._indexOf', '_indexOf(id)',
    "An object's current index in its frame's list, or null when the document does not hold it.",
    ['Reads the list through `Document.at`, which settles a pending shift first (DESIGN.md §8).'], "§15")
add('m1opl._onEvent', '_onEvent(ev)',
    "Turns document change events into the tick's items: a removed object remembered, a spent mark, a geometry change as a `put`, an attribute change as `attr`.",
    ['Ignored while replaying. A reset that is not a load sets `needFull`. A removal is remembered so the drain can encode an object added and removed within the tick; an erase mark removed outside undo and not by a rehome is queued as `spent`, since its consumption has no op of its own. An attribute-only change (a z change) is queued as an `attr` entry at once.', 'A change that is not offsets-only and not inside undo queues one `put` per id per tick, unless an add, mark or put for that id is already queued: those encode the current state at the drain anyway.'], "§15")
add('m1opl._ownerSeq', '_ownerSeq(owner)',
    "The seq of the `moveFrames` op a frame entry belongs to, found on the undo and redo stacks or among the replay's rebuilt ops.",
    ["Null while the op is not on a stack yet (a settle mid-drag), which is why a settle entry's `of` can be absent."], "§15")
add('m1opl._onSettle', '_onSettle(ev)',
    'Queues a `settle` entry carrying the result tables, coalesced with a settle of the same frame queued just before it.',
    ["A drag unsettles and settles a visible frame every event, so consecutive settles of one frame keep only the latest record. `touches` is the frame plus every carry's destination; a carry forces all of them to snapshot, since it changed which frame holds a native (DESIGN.md §13)."], "§15")
add('m1opl._onMerge', '_onMerge(ev)',
    "Queues a `mergeFrame` entry for a shadow merged into its resident and forces the resident's snapshot.",
    ["The resident now holds the shadow's natives and the shadow's row goes with the write. The entry names its `moveFrames` op (`of`) so replay hangs the record on it for undo."], "§15")
add('m1opl._forcedFor', '_forcedFor(op, touches)',
    "Which of an op's frames must be re-snapshotted: all of them, except for a subtree move.",
    ["A `moveFrames` forces only its per-object members' frames, both frames of every merge, and a settled frame with carries plus the carries' destinations. A frame moved as a frame keeps its natives' bytes: the header carries its address and the tables are entries (DESIGN.md §13)."], "§15")
add('m1opl._moveFile', '_moveFile(m)',
    'One move member in file form: id, frames, delta, the object as it now is with its index, the tables, any geometry snapshots.',
    ['`belowBefore`/`belowAfter` go through `encodeBelow`; `base`/`after` are written only for a member the pen-up walked back into its cell. `obj` lets replay give the object to a frame whose snapshot never held it.'], "§15")
add('m1opl.settleFile', 'settleFile(rec)',
    "A settle record in file form: the shift, each native's result table through `encodeBelow`, the carries' frames as strings.",
    ['-'], "§15")
add('m1opl.settleLive', 'settleLive(s)',
    'A stored settle record back to live form, its tables decoded.',
    ['-'], "§15")
add('m1opl.mergeFile', 'mergeFile(rec)',
    'A merge record as a plain-data deep copy, so the op and the entry never share it.',
    ['The same function reads it back (`mergeLive`).'], "§15")
add('m1opl.frameFile', 'frameFile(e)',
    'A `moveFrames` frame entry in file form: address before and after, shifts, and its settle inline; its merges are left out.',
    ['A settle is inline because one mid-drag has no op to be an entry of; a merge always happens after the op is on the stack, so its own `mergeFrame` entry names the op.'], "§15")
add('m1opl.geomLive', 'geomLive(g)',
    "A move's stored before or after geometry as `setGeometryById` takes it, loops wrapped as `Loop`s.",
    ["Decoded through `nativeFromRecord`, so a damaged loop is repaired as a loaded native's is; `attachRect`, `tile` and `below` are kept when the slot has them."], "§15")
add('m1ovl.mergeClose', 'mergeClose(rects, gap)',
    'Unions rects lying within `gap` of each other, so several specks on one pixel become one dot.',
    ['One greedy pass: each rect grows the first kept rect it is near, or is kept. Used on the dots of selected objects too small to trace (F73), with a 2 px gap.'], "§15")
add('m1ovl.clipRect', 'clipRect(r)',
    "A clip or attach rect as `{ rect, eps }` for the ants' seam test, the tolerance from `rectTol`.",
    ['-'], "§15")
add('m1ovl.asLTRB', 'asLTRB(r)',
    'A rect in either spelling, as left/top/right/bottom.',
    ['An `x0/y0/x1/y1` rect is converted; any other is returned as it is. `eraseDescent.asLTRB` is the same one-liner.'], "§15")
add('m1ovl.mergeSpans', 'mergeSpans(list, gap)',
    'Merges overlapping or nearly touching spans into the fewest runs.',
    ['Used on the screen-edge ants: a shape with several fingers of ink touching the top of the view produces several spans, and drawing each separately would put a gap between marks that are visually one run.'], "§15")
add('m1ovl.Overlays', 'Overlays',
    'The selection indicator and the erase debug view, as a mixin.',
    ['Everything the engine draws that is not ink. Same mixin arrangement as ErasePipeline.'], "§15")
add('m1ovl._keepDebugMark', '_keepDebugMark(E)',
    'Diagnostics for multi-level families and for what a mark actually touched.',
    ['Diagnostics for multi-level objects: which pieces belong to which family, where their doorways are, and what an erase actually touched — the report fields that made severance debuggable at all.'], "§15")
add('m1ovl._outlineInView', '_outlineInView(o, vr, tol)',
    "The erase-debug overlay's geometry: an object's boundary clipped to the view, cut where a family join starts and ends, orange where the edge is the piece's own and green where it is a join.",
    ["A shape's rings come from `shapeRingsInRect`; a shape whose ink floods the window has no boundary in view and returns none. A fill's rings are clipped to the rect; anything else returns none."], "§15")
add('m1ovl._splitOnJoins', '_splitOnJoins(entries, a, b)',
    "The erase-debug overlay's geometry: an object's boundary clipped to the view, cut where a family join starts and ends, orange where the edge is the piece's own and green where it is a join.",
    ["Returns the segment's parts flagged joined or not, or null when it is nowhere near a shared edge. A straight side flattens to one chord, so without the cut a partial join would colour the whole side."], "§15")
add('m1ovl._familyJoinNotes', '_familyJoinNotes(keys, byKey, C)',
    "The erase-debug overlay's geometry: an object's boundary clipped to the view, cut where a family join starts and ends, orange where the edge is the piece's own and green where it is a join.",
    ["Recorded against both pieces, each in its own level's coordinates, and cached per family keyed by its members and their edit counters. The erase-debug overlay paints these stretches green."], "§15")
add('m1ovl._selectionAnts', '_selectionAnts()',
    "The selection indicator handed to the renderer: ant runs and dots in retained space, a transform, and the screen-edge spans — built from the pieces the render list draws, never from the document. During a drag the first decision is kept and moved by the pointer's travel.",
    ["Builds or reuses a decision (`_selTable`, `_selDecide`) and adds the edge spans (`_selEdges`) per step. During a drag the first decision is kept and moved by the pointer's travel. Null when nothing is selected, the tool is not select, or nothing traces (DESIGN.md §10)."], "§15")
add('m1ovl._selFrameRect', '_selFrameRect(info, L, F)',
    "Where a frame's selected members are drawn, as one rect in the active frame's units.",
    ["The union of the frame's boxes, each mapped through its member's placement (`placeNative(nat, F).fromStored`) or exactly — a selected frame's own box already shifted by the frame's shift; null when none reaches F. The frame-dot decision reads it (F68)."], "§15")
add('m1ovl._selPieceLoops', '_selPieceLoops(piece)',
    'A render-list piece as loops of arcs and lines: the geometry its ink is drawn from.',
    ["A shape's own loops; a fill's rings as line loops; a stroke's capsule outline, as the renderer draws it. Cached on the piece against the array it was made from, because a native in the list is the document's own object and an edit replaces its loops."], "§15")
add('m1ovl._selSeamRects', '_selSeamRects(piece, off, table, F, cache)',
    "The rects a piece may have been cut on, its own clip and its family's attach windows, where the piece is drawn.",
    ["A straight run lying along one is a seam and gets no ants: both 'no ants on a tile edge' and the F37 join rule. Family windows are mapped into F through each member's placement (`placeNative`) or exactly and shifted by the piece's placement offset `off`; cached per piece id, with the piece's own clip added on each call."], "§15")
add('m1ovl._selEdges', '_selEdges(dec, off)',
    'Where the selected ink meets the sides of the screen, recomputed on every step as the view moves.',
    ["Only pieces straddling the view are scanned (`edgeSpans`), the view shifted back by a drag's offset. Spans become screen coordinates, merge across 1.5 px gaps, drop under 2 px, and take a chevron from a fifth of their side. Returns `{ list, covered }`; a selection wholly in view gives none."], "§15")
add('m1ovl._emitOutlineRing', '_emitOutlineRing(out, obj, L, ring, entries, onScreen)',
    "The erase-debug overlay's geometry: an object's boundary clipped to the view, cut where a family join starts and ends, orange where the edge is the piece's own and green where it is a join.",
    ["Maps points through the object's own picture (`_objPointInActive`), drops sub-pixel chords, and keeps only runs that cover some ground."], "§15")
add('m1per.encodeDrawing', 'encodeDrawing({camera, crossings, natives, meta})',
    'The envelope: format, version, metadata, camera, box tree, objects.',
    ["Wraps the engine's own serialised state in a versioned envelope: a sniffable format marker, a version, metadata, the camera, the box tree, and the objects.", 'The payload shapes are exactly what the collaborators produce, so the envelope adds validation without adding a translation layer that could drift.'], "§15")
add('m1per.decodeDrawing', 'decodeDrawing(raw)',
    'Validated decode. Also accepts the legacy development snapshot, which is how old autosaves keep opening.',
    ['Reads a file back, validated, or throws with a human-readable reason.', 'Refuses a version newer than this build understands, and accepts the legacy development snapshot as well, which is how old autosaves keep opening.'], "§15")
add('m1per.decodeScaleDef', 'decodeScaleDef(raw, {lenient})',
    'Metadata. Scenes validate leniently — they are regenerable, so a malformed one is dropped rather than failing the drawing.',
    ['Reads the metadata: name, timestamps, the scale definition, and the scenes.', 'Scenes validate **leniently** — they are regenerable, so a malformed entry is dropped silently rather than failing the whole drawing.'], "§15")
add('m1per.decodeMeta', 'decodeMeta(m, {lenient})',
    'Metadata. Scenes validate leniently — they are regenerable, so a malformed one is dropped rather than failing the drawing.',
    ['Reads the metadata: name, timestamps, the scale definition, and the scenes.', 'Scenes validate **leniently** — they are regenerable, so a malformed entry is dropped silently rather than failing the whole drawing.'], "§15")
add('m1per.finite', 'finite(v)',
    "A finite-number test for the scene index's fields.",
    ['The same test as `isFiniteNum` in this file.'], "§15")
add('m1per.decodeSceneIndex', 'decodeSceneIndex(si)',
    "Reads the scene index's saved state leniently: malformed entries dropped, a malformed whole read as no index.",
    ['Version 3 only. Keeps scenes with a valid id, name, anchor frame key and member string; tombstones (the last 256) with a valid rect; integer dirty ids; erase footprints whose raw numbers come in fives.', 'Null for a missing or wrong-version index, and the load builds one afresh (DESIGN.md §11).'], "§15")
add('m1per.validRect', 'validRect(r)',
    'Metadata. Scenes validate leniently — they are regenerable, so a malformed one is dropped rather than failing the drawing.',
    ['Reads the metadata: name, timestamps, the scale definition, and the scenes.', 'Scenes validate **leniently** — they are regenerable, so a malformed entry is dropped silently rather than failing the whole drawing.'], "§15")
add('m1per.isFrameKey', 'isFrameKey(v)',
    'A depth integer or a lattice path. The old free-floating sibling form is refused: a scene naming one would point at a box no document can contain.',
    ['Recognises a box key: a depth integer, or a lattice path built from one.', 'The old free-floating sibling form is deliberately **not** accepted — a scene naming one would point at a box no document can contain.'], "§15")
add('m1per.validScene', 'validScene(s)',
    'Metadata. Scenes validate leniently — they are regenerable, so a malformed one is dropped rather than failing the drawing.',
    ['Reads the metadata: name, timestamps, the scale definition, and the scenes.', 'Scenes validate **leniently** — they are regenerable, so a malformed entry is dropped silently rather than failing the whole drawing.'], "§15")
add('m1per.cloneRect', 'cloneRect(r)',
    'Metadata. Scenes validate leniently — they are regenerable, so a malformed one is dropped rather than failing the drawing.',
    ['Reads the metadata: name, timestamps, the scale definition, and the scenes.', 'Scenes validate **leniently** — they are regenerable, so a malformed entry is dropped silently rather than failing the whole drawing.'], "§15")
add('m1per.cloneScene', 'cloneScene(s)',
    'Metadata. Scenes validate leniently — they are regenerable, so a malformed one is dropped rather than failing the drawing.',
    ['Reads the metadata: name, timestamps, the scale definition, and the scenes.', 'Scenes validate **leniently** — they are regenerable, so a malformed entry is dropped silently rather than failing the whole drawing.'], "§15")
add('m1per.decodeCamera', 'decodeCamera(c)',
    'Camera state, which the engine then settles into a legal one.',
    ['Reads the camera state, which the engine then settles into a legal one — a saved camera need not be inside the legal zoom band, and a converted one can land outside it too.'], "§15")
add('m1per.decodeCrossings', 'decodeCrossings(cr)',
    'The box tree — and where a pre-lattice file is refused with a clear error rather than converted.',
    ['Validates and reads the box tree: every frame needs a unique string id, an integer depth, a string or null parent, and integer cell indices.', '**This is the gate that refuses a pre-lattice drawing** (per-depth `{s, t}` records or a `__frames` tree), with a clear error, rather than half-converting it.', 'A cell outside the balanced range is listed on the result (`__outOfRangeCells`), not refused, so a file an older build wrote with one still opens.'], "§15")
add('m1per.validPts', 'validPts(pts)',
    'Per-object validation. Numbers that are not numbers mean the file is not ours; an outline that does not close is damage that gets mended.',
    ['Validates every object: known type, finite numbers, well-formed geometry. The erase lineage (`targets`, `targetOf`, `handledBy`) is kept as sorted unique positive ids, or dropped when malformed.', '**Hard-fails on anything that would crash or corrupt** and stays lenient about everything else — unknown fields are preserved untouched, so an older build can open a file written by a newer one that only added fields.'], "§15")
add('m1per.validOwnedRect', 'validOwnedRect(r)',
    'Per-object validation. Numbers that are not numbers mean the file is not ours; an outline that does not close is damage that gets mended.',
    ['Validates every object: known type, finite numbers, well-formed geometry. The erase lineage (`targets`, `targetOf`, `handledBy`) is kept as sorted unique positive ids, or dropped when malformed.', '**Hard-fails on anything that would crash or corrupt** and stays lenient about everything else — unknown fields are preserved untouched, so an older build can open a file written by a newer one that only added fields.'], "§15")
add('m1per.isFiniteNum', 'isFiniteNum(v)',
    'Per-object validation. Numbers that are not numbers mean the file is not ours; an outline that does not close is damage that gets mended.',
    ['Validates every object: known type, finite numbers, well-formed geometry. The erase lineage (`targets`, `targetOf`, `handledBy`) is kept as sorted unique positive ids, or dropped when malformed.', '**Hard-fails on anything that would crash or corrupt** and stays lenient about everything else — unknown fields are preserved untouched, so an older build can open a file written by a newer one that only added fields.'], "§15")
add('m1plm.drawnBox', 'drawnBox(o, live)',
    "A native's drawn box in its home's units: its bbox, grown by half its pen for a stroke.",
    ['-'], "§15")
add('m1rnd.pushMove', 'pushMove(verts, pt, og)',
    'Appends a move anchor at a point, relative to the scene origin.',
    ['-'], "§15")
add('m1rnd.pushLine', 'pushLine(verts, A, B, og, ctx)',
    'Appends a line as anchors, split into equal parts when the length split is on and the line is not a seam.',
    ['A line longer than `ctx.segMax` is cut into ceil(len / segMax) parts unless it lies on the rectangle that cut its piece. `segMax` is 0 unless the `Renderer.lengthChop` dev toggle is on, so in the app a line is one anchor.'], "§15")
add('m1rnd.pushArcPiece', 'pushArcPiece(verts, p, og, ctx)',
    'Appends one arc piece by its once-per-piece plan: SVG arc commands, or kappa cubics built from its ends and sweep.',
    ["A line, or an arc with no finite radius, goes through `pushLine`. Otherwise `planArc` chooses at the quarter-pixel tolerance and the frame's deepest zoom: the arc command while the browser's float32 centre is within tolerance, else as many centre-free cubics as the sixth-root law needs. A cubic's first handle is written onto the previous anchor. Each anchor carries `_mid`, the part's midpoint, for the thin rescale.", 'The plan never changes while zooming (DESIGN.md §9, F40).'], "§15")
add('m1rnd.pushGapAnchors', 'pushGapAnchors(verts, gap, og, ctx)',
    "A chain's arcs and lines into Two.js anchors, each arc by the plan made once per piece (pushArcPiece; DESIGN.md §9).",
    ["Appends one gap's worth of the live pen's arcs as anchors."], "§15")
add('m1rnd.pushShapeAnchors', 'pushShapeAnchors(verts, loops, og, ctx)',
    "A chain's arcs and lines into Two.js anchors, each arc by the plan made once per piece (pushArcPiece; DESIGN.md §9).",
    ['Appends a resolved outline to a path as anchors.', 'Each loop ends exactly where it began and the path stays **open**: a fill auto-closes its subpaths, whereas marking the path closed would rule a stray segment from the end of one loop back to the start of the whole path.'], "§15")
add('m1rnd.pushRingAnchors', 'pushRingAnchors(verts, poly, og, ctx)',
    'Appends a polygon ring as a move and lines; the closing edge is written out only when long enough to be split, otherwise the fill closes it.',
    ['-'], "§15")
add('m1rnd.areaBounds', 'areaBounds(o)',
    "An area piece's bounds for the chop window's verdict: a shape by its true arc extremes, a fill by its points.",
    ['-'], "§15")
add('m1rnd.asClip', 'asClip(clip)',
    "A tile piece's clip rectangle in the form the seam test takes, with its tolerance.",
    ['-'], "§15")
add('m1rnd.perfRendererNow', 'perfRendererNow()',
    'Monotonic time for the render budget.',
    ['-'], "§15")
add('m1rnd.mkPath', 'mkPath(verts, closed, curved, manual)',
    'Never hand the library an unbounded array: its collection constructor gives out past about 131,000 anchors, and a fat stroke reaches that by being drawn — surfacing as a crash with no ink rather than a slow render.',
    ['Builds a path without ever handing the drawing library an unbounded array.', "The library's collection constructor spreads its input as function arguments, which gives out past roughly 131,000 anchors — and that is reachable by **drawing**, not only by pathological input: a wide stroke's capsule outline runs about thirteen curves per sample, so a few thousand points of one scribbled drag crosses it, and an erased fill is worse.", 'It surfaces as a crash with no ink at all rather than a slow render, because the throw happens before the path reaches the scene.'], "§15")
add('m1rnd.selAntScale', 'selAntScale(inkPx)',
    'Shrinks the marching ants for thin ink.',
    ["The design file's band is a fixed width, which buries a three-pixel mark under its own indicator. Below a reference width the whole dash pattern scales down together.", "The floor is the speck's own band, so the ants never get thinner than the thing they collapse into - which also removes a discontinuity, because as a mark shrinks past being traceable the band it had is the band its speck gets."], "§15")
add('m1rnd.Renderer', 'Renderer',
    'The SVG renderer, behind `?svg`, and the base class the raster renderer extends.',
    ['Owns the Two.js scene: one persistent group per object id sorted by (z, id), the per-frame diff by signature, retained per-level scenes, the per-scene origin and chop window, the live pen path, and the lasso and selection-indicator layers.', "`RasterRenderer` subclasses it, drawing the ink into plates and keeping the live stroke and the chevrons from here (DESIGN.md §9). The engine's own default is this renderer, so the suites and the one-off engines are SVG."], "§15")
add('m1rnd.destroy', 'destroy()',
    'Lifecycle. Plumbing.',
    ['Tells the drawing library to flush to the screen.'], "§15")
add('m1rnd.setSize', 'setSize(w, h)',
    'Lifecycle. Plumbing.',
    ['Tells the drawing library to flush to the screen.'], "§15")
add('m1rnd.update', 'update()',
    'Lifecycle. Plumbing.',
    ['Tells the drawing library to flush to the screen.'], "§15")
add('m1rnd._gatePx', '_gatePx()',
    'The fat-stroke gate: a stroke that could ever paint wider than the limit is drawn as its outline, because browser stroking of enormous widths misbehaves.',
    ['The wide-stroke gate: whether a stroke is painting wider than the limit now, whether it could ever within its level, and which representation it is currently using.', 'The gate is fidelity-neutral — raw stroking and the outline agree to well under display tolerance — so its value only trades safety against browser mis-stroking of enormous widths against the work of fitting outlines.'], "§15")
add('m1rnd._fatOnScreen', '_fatOnScreen(o)',
    'The fat-stroke gate: a stroke that could ever paint wider than the limit is drawn as its outline, because browser stroking of enormous widths misbehaves.',
    ['The wide-stroke gate: whether a stroke is painting wider than the limit now, whether it could ever within its level, and which representation it is currently using.', 'The gate is fidelity-neutral — raw stroking and the outline agree to well under display tolerance — so its value only trades safety against browser mis-stroking of enormous widths against the work of fitting outlines.'], "§15")
add('m1rnd._fatEver', '_fatEver(o)',
    'The fat-stroke gate: a stroke that could ever paint wider than the limit is drawn as its outline, because browser stroking of enormous widths misbehaves.',
    ['The wide-stroke gate: whether a stroke is painting wider than the limit now, whether it could ever within its level, and which representation it is currently using.', 'The gate is fidelity-neutral — raw stroking and the outline agree to well under display tolerance — so its value only trades safety against browser mis-stroking of enormous widths against the work of fitting outlines.'], "§15")
add('m1rnd._strokeMode', '_strokeMode(o)',
    'The fat-stroke gate: a stroke that could ever paint wider than the limit is drawn as its outline, because browser stroking of enormous widths misbehaves.',
    ['The wide-stroke gate: whether a stroke is painting wider than the limit now, whether it could ever within its level, and which representation it is currently using.', 'The gate is fidelity-neutral — raw stroking and the outline agree to well under display tolerance — so its value only trades safety against browser mis-stroking of enormous widths against the work of fitting outlines.'], "§15")
add('m1rnd.needsFatFlip', 'needsFatFlip()',
    'When a camera-only frame is not enough. needsFadeFlip is the fix for the fading-piece defect: grouping is decided during a full render but fading depends on the live camera, so the camera-only path could reapply opacity without regrouping.',
    ['Is a wide stroke approaching the point where raw stroking becomes unsafe, so it must flip to its outline form before the next frame?'], "§15")
add('m1rnd.needsFadeFlip', 'needsFadeFlip()',
    'When a camera-only frame is not enough. needsFadeFlip is the fix for the fading-piece defect: grouping is decided during a full render but fading depends on the live camera, so the camera-only path could reapply opacity without regrouping.',
    ['Has any piece crossed the fully-present line since its group was built?', 'Grouping is decided during a full render, but fade is a function of the live camera — so a zoom can invalidate the grouping without anything else changing, and a camera-only frame reapplies opacity **without regrouping**.', 'Without this the stale grouping simply persists: the member that should have left the family stays in it, and the whole family wears its fade. That is the defect where a cut-off piece faded out of existence while zooming.'], "§15")
add('m1rnd.hasPendingNearFat', 'hasPendingNearFat()',
    'When a camera-only frame is not enough. needsFadeFlip is the fix for the fading-piece defect: grouping is decided during a full render but fading depends on the live camera, so the camera-only path could reapply opacity without regrouping.',
    ['Are wide strokes close enough to the gate that the engine should start fitting their outlines during idle time?'], "§15")
add('m1rnd.render', 'render(list, level)',
    'The per-frame difference. Group by object — or by family, when a family is fully present — compare signatures, rebuild only what changed, insert at the id-sorted position.',
    ['The per-frame difference. Rebuilds only what actually changed.', 'Groups the display list by object — or by **family**, when every member of a family is fully present rather than fading, so a multi-level object draws as one path and its pieces do not seam.', 'Builds a signature per group and compares it with the last one. Same signature means identical geometry, so the existing paths are reused and only the opacity is reapplied.', 'Rebuilt groups are inserted at their drawing-order position; vanished ids are removed.', 'Reports whether anything was reordered, and records how many groups were rebuilt — zero means a fully cached crossing.'], "§15")
add('m1rnd.syncCameraOnly', 'syncCameraOnly(view)',
    'A pure camera move: one transform, plus opacity for faded groups. No geometry rebuild at all.',
    ['A camera move with no geometry rebuild: write the world transform, and refresh opacity for the groups that fade, because fade depends on the live zoom.'], "§15")
add('m1rnd.syncWorld', 'syncWorld(view)',
    "Fold the scene's origin into the world transform in full precision, so the cancellation happens here and nothing large ever reaches the browser's lower-precision maths.",
    ["Writes the world transform, folding the scene's local origin into it **in full precision**.", "Anchors are stored relative to a local origin so they stay small, and the bracketed translation is screen-sized whenever the view is near the content. The cancellation between the pan and the scaled origin happens here, in the engine's own arithmetic, where it is exact — nothing large ever reaches the drawing library's lower-precision matrices or the browser's rasterizer.", 'Also refreshes the debug overlays and the selection indicator, which all follow the same transform.'], "§15")
add('m1rnd._renderOverlays', '_renderOverlays(view)',
    'Redraws what follows the camera over the ink: the tile and erase debug views, the lasso, and the selection indicator.',
    ['Called from `syncWorld`, so on every render and camera-only frame. The raster renderer passes its published view, so the ink and the overlays take one mapping (RASTERISER-PLAN §2.5 seam 1).'], "§15")
add('m1rnd._syncWorldTransform', '_syncWorldTransform()',
    "Writes the world group's scale and translation, folding the scene origin in at float64.",
    ["`translation = inPan + inScale * origin`: anchors are origin-relative, and the cancellation between the pan and the scaled origin happens here in doubles, so nothing large reaches Two.js's float32 matrices or the browser (DESIGN.md §9). `RasterRenderer` overrides it to take the snapped translation from its view."], "§15")
add('m1rnd._origin', '_origin()',
    "The per-scene local origin, re-anchored when the view drifts too far. Never mid-stroke — the live path's anchors are origin-relative and a swap under the pen would desync them.",
    ["How far the view centre is from the scene's local origin, in screen pixels — the quantity that bounds the browser's own rounding error on painted vertices."], "§15")
add('m1rnd._viewCenter', '_viewCenter()',
    "The per-scene local origin, re-anchored when the view drifts too far. Never mid-stroke — the live path's anchors are origin-relative and a swap under the pen would desync them.",
    ["How far the view centre is from the scene's local origin, in screen pixels — the quantity that bounds the browser's own rounding error on painted vertices."], "§15")
add('m1rnd._driftPx', '_driftPx(sc)',
    "The per-scene local origin, re-anchored when the view drifts too far. Never mid-stroke — the live path's anchors are origin-relative and a swap under the pen would desync them.",
    ["How far the view centre is from the scene's local origin, in screen pixels — the quantity that bounds the browser's own rounding error on painted vertices."], "§15")
add('m1rnd.needsReorigin', 'needsReorigin()',
    "The per-scene local origin, re-anchored when the view drifts too far. Never mid-stroke — the live path's anchors are origin-relative and a swap under the pen would desync them.",
    ['Has a camera-only move drifted past the budget, so the engine must promote it to a full render?'], "§15")
add('m1rnd._maybeReorigin', '_maybeReorigin(sc)',
    "The per-scene local origin, re-anchored when the view drifts too far. Never mid-stroke — the live path's anchors are origin-relative and a swap under the pen would desync them.",
    ['Re-anchors a scene on a fresh local origin when the view has drifted too far from the old one.', "Wipes the scene's groups, keeping the map identity, so the next difference pass rebuilds every path relative to the new origin. Costs one level-flip-sized rebuild at a very rare cadence.", "Never mid-stroke: the live path's anchors are origin-relative and a swap under the pen would desynchronise them."], "§15")
add('m1rnd._chopHolds', '_chopHolds(chop)',
    "Whether a scene's chop window still holds: the view inside its inner half, the zoom under 4x the zoom it was chosen at.",
    ['-'], "§15")
add('m1rnd.needsWindowChop', 'needsWindowChop()',
    "Tells the engine a camera-only frame must become a full render, because the view has left its chop window's budget.",
    ["False mid-stroke (the live path's anchors must not move under the pen) and with the chop off. The full render chooses a new window and rebuilds only the groups that straddle it, before the old edge can reach the screen (F40). `RasterRenderer` returns false."], "§15")
add('m1rnd._maybeRechop', '_maybeRechop(sc)',
    "Chooses the scene's chop window afresh, centred on the view, when it has none or the last no longer holds.",
    ['The window is +-`_chopPx` device px (2^18 for the default config) at the current zoom, under a new key. Nothing is rebuilt here: the key enters the signature of every piece that straddles the window, and the diff rebuilds exactly those.'], "§15")
add('m1rnd._chopFor', '_chopFor(o)',
    'The chop window an area piece must be clipped to, or null when it can go to the browser whole.',
    ["Null for a piece inside the window or wholly outside it (hundreds of screens off, where what the browser makes of far coordinates cannot show), and for anything but a shape or a fill. A tile piece is settled first by the rectangle it was cut on; otherwise by its bounds, a pass over a fill's points. A piece with a residual is judged against the window shifted back. Memoised per render: the signature asks, then the build."], "§15")
add('m1rnd._pushArea', '_pushArea(verts, o, og)',
    "Appends one area piece, a shape's arcs or a fill's rings, as anchors, clipped to the chop window where it reaches past it.",
    ["The residual is folded into the origin the anchors are taken against, and the window shifted to match, so the piece's geometry is untouched. A shape is cut by `shapeLoopsInRect` (exact on arcs; the window quad when the window lies wholly inside the ink), a fill by `clipRingsToRect`. The cut exists only in this build; the selection indicator and the erase overlay read the whole piece."], "§15")
add('m1rnd._activateLevel', '_activateLevel(level)',
    'A retained subtree per level, so a crossing swaps a subtree in instead of rebuilding every path. Capped at eight.',
    ["Makes one level's retained scene subtree the active one, swapping it in under the world transform.", 'That is the whole point of retention: a crossing becomes one detach and one attach instead of rebuilding every path. With retention off, every level shares one scene and the difference rebuilds exactly as it did before.'], "§15")
add('m1rnd._evictScenes', '_evictScenes()',
    'A retained subtree per level, so a crossing swaps a subtree in instead of rebuilding every path. Capped at eight.',
    ['Caps how many level subtrees are retained, dropping the least recently activated.'], "§15")
add('m1rnd._insertSorted', '_insertSorted(id)',
    "Binary search for the drawing-order position. The pen's hot path only ever appends, because a live stroke has the highest id.",
    ['Inserts a group at its drawing-order position by binary search.', "The pen's hot path only ever appends, because a live stroke has the highest id."], "§15")
add('m1rnd._isTemporary', '_isTemporary(o)',
    'Colour, and the debug colouring that shows which role a piece arrived by.',
    ["Debug colouring: which role a piece arrived by — the level's own ink, magnified from coarser, or minified from finer — so the tile machinery can be seen rather than inferred."], "§15")
add('m1rnd._debugColor', '_debugColor(o)',
    'Colour, and the debug colouring that shows which role a piece arrived by.',
    ["Debug colouring: which role a piece arrived by — the level's own ink, magnified from coarser, or minified from finer — so the tile machinery can be seen rather than inferred."], "§15")
add('m1rnd._colorOf', '_colorOf(o)',
    'Colour, and the debug colouring that shows which role a piece arrived by.',
    ["Debug colouring: which role a piece arrived by — the level's own ink, magnified from coarser, or minified from finer — so the tile machinery can be seen rather than inferred."], "§15")
add('m1rnd._opacityOf', '_opacityOf(o)',
    'The continuous fade across the sub-pixel cull, so content shrinks out of existence smoothly rather than popping.',
    ["Applies an object's opacity to its group, multiplied by the continuous fade.", 'Opacity lives on the group rather than the paths so that overlapping pieces of one object union before opacity applies, instead of double-darkening where they overlap.'], "§15")
add('m1rnd._applyOpacity', '_applyOpacity(entry, o)',
    'The continuous fade across the sub-pixel cull, so content shrinks out of existence smoothly rather than popping.',
    ["Applies an object's opacity to its group, multiplied by the continuous fade.", 'Opacity lives on the group rather than the paths so that overlapping pieces of one object union before opacity applies, instead of double-darkening where they overlap.'], "§15")
add('m1rnd._fade', '_fade(o)',
    'The continuous fade across the sub-pixel cull, so content shrinks out of existence smoothly rather than popping.',
    ['The continuous fade factor across the sub-pixel cull.', "Converts a piece's tagged size into its actual on-screen size at the current zoom, and ramps linearly from fully transparent at the lower threshold to fully present at the upper one, so content shrinks out of existence smoothly rather than popping."], "§15")
add('m1rnd._sig', '_sig(o)',
    'A piece signature — same signature, same geometry, reuse the paths. Must include coordinates, not counts: scrolling the tile set by one swaps pieces without changing any count, and a count-only signature leaves stale paths on screen.',
    ["A group's signature: same signature, same geometry, paths reused. It must include coordinates, not only counts: scrolling the tile set by one swaps pieces without changing any count.", "A shape's part is its loop and piece counts and its bbox to two decimals, memoised per piece on `_ver`; the edit counter is in it because a pixel of drag at the deepest zoom is under the rounding. A fill uses its first and last points; a stroke its ends, width and representation (raw, outline, or pending past the gate).", "A piece straddling the chop window carries the window's key, so a re-chop rebuilds exactly those groups; a piece with a residual carries it, since a drag from below moves it every event."], "§15")
add('m1rnd._planFor', '_planFor(o)',
    "The arc plan for one piece: the frame's constants plus the piece's clip rectangle, so its seams are known.",
    ["A covering quad (classifyUp's solid tier) takes the plan with no length split: its edges are the tile's own, overlapped by the neighbours."], "§15")
add('m1rnd._buildPieces', '_buildPieces(group, pieces)',
    "Build a group's paths. A family's fills and resolved shapes go into one path, so coverage accumulates before anything composites and there is no seam to cover.",
    ["Builds a group's paths, merging every area piece (tile fills and resolved arc shapes) of one effective colour and opacity into a single path, in order; anything else flushes the bucket and goes through `_buildInto`.", 'Abutting paths seam: each covers part of the boundary pixel and composites in turn, measured at 18-25% toward white. Subpaths of one path do not, because coverage accumulates before compositing (DESIGN.md §9).'], "§15")
add('m1rnd._applyThinScale', '_applyThinScale(entry)',
    "The thin-object rescale. Chrome drops a filled path whose features are too small in the numbers handed over, however much the transform then enlarges them. Multiply the object's anchors by a power of two and divide its own group transform by the same — pixel-identical by construction.",
    ['Rescales an object whose features are too small **in the numbers handed over**, however much the transform then enlarges them.', 'Chrome drops such a path entirely. Measured on the real geometry, holding the on-screen result pixel-identical and varying only the numbers: a feature 0.0657 units across renders and 0.0641 does not, while the app was handing over 0.0033.', "The fix is a change of units for that object alone: multiply its anchors by a power of two and divide its own group's transform by the same number. Pixel-identical by construction, and applied at the end of the build so nothing upstream knows it happened.", 'It costs nothing in caching, because the numbers come from the level projection rather than the zoom and do not change as the camera moves.'], "§15")
add('m1rnd._addFillPath', '_addFillPath(group, verts, color, opacity)',
    "Build a group's paths. A family's fills and resolved shapes go into one path, so coverage accumulates before anything composites and there is no seam to cover.",
    ['Adds an accumulated polygon path to a group, with its colour and opacity.'], "§15")
add('m1rnd._addShapePath', '_addShapePath(group, verts, color, opacity)',
    "Build a group's paths. A family's fills and resolved shapes go into one path, so coverage accumulates before anything composites and there is no seam to cover.",
    ['Adds an accumulated outline path to a group, with its colour and opacity.'], "§15")
add('m1rnd._buildInto', '_buildInto(group, o)',
    "Build a group's paths. A family's fills and resolved shapes go into one path, so coverage accumulates before anything composites and there is no seam to cover.",
    ["Builds one unmerged piece into a group. A shape goes through `_pushArea`: arcs by their plan, clipped to the chop window where it reaches past it. A stroke still carrying its pen's chain is drawn from that chain; a fat stroke as its curve-capsule outline (a pending one fitted within 12 ms a render); a fill as a polygon path; anything else as a stroked path, shifted by its residual.", "Drawing the pen's own chain is what makes pen-up invisible: the ink under the pen, before the bake and after it are one curve."], "§15")
add('m1rnd.ensureOutline', 'ensureOutline(o, curved)',
    'Fat strokes as filled capsule outlines, fitted lazily and on approach rather than all at once.',
    ["A stroke's outline as curve loops (`curveOutline.strokeLoops`), the one definition the eraser shares; `_buildOutlineInto` lays those loops into one filled Two.js path.", "Used for a stroke not yet resolved that could paint wider than the fat gate at this level (`_strokeMode`): at once, or with lazy outlines when it nears the gate, within 12 ms a render; the engine's idle prefitter (`_queueIdleFits`) builds it ahead so the switch costs nothing. Anchors are origin-relative; each loop ends at its start and the path stays open, because fill closes every subpath and Two's `closed` would draw a stray segment across loops."], "§15")
add('m1rnd._buildOutlineInto', '_buildOutlineInto(group, o, curved)',
    'Fat strokes as filled capsule outlines, fitted lazily and on approach rather than all at once.',
    ["A stroke's outline as curve loops (`curveOutline.strokeLoops`), the one definition the eraser shares; `_buildOutlineInto` lays those loops into one filled Two.js path.", "Used for a stroke not yet resolved that could paint wider than the fat gate at this level (`_strokeMode`): at once, or with lazy outlines when it nears the gate, within 12 ms a render; the engine's idle prefitter (`_queueIdleFits`) builds it ahead so the switch costs nothing. Anchors are origin-relative; each loop ends at its start and the path stays open, because fill closes every subpath and Two's `closed` would draw a stray segment across loops."], "§15")
add('m1rnd.setLasso', 'setLasso(fn)',
    "The lasso loop while it is drawn. The selection indicator is the ants' own layer (overlays.js, and on the raster path OverlayLayer).",
    ['Clears the selection layer and draws the lasso, in screen coordinates, as a dashed terracotta path. That is all it draws; the indicator is `_renderSelOverlay`.'], "§15")
add('m1rnd.setDragState', 'setDragState(fn)',
    "Registers the engine's live-drag getter, pulled each frame by a renderer that draws the dragged ink itself.",
    ['The SVG renderer only stores it; `RasterRenderer` reads it each camera step to move its drag plane (PAPER-PLAN R3).'], "§15")
add('m1rnd.setPlaneState', 'setPlaneState(fn)',
    "Registers the engine's getter for the selection a drag plane is kept ready for.",
    ['Stored and unused here; `RasterRenderer` overrides it and aims its plane from it (PAPER-PLAN §10 S4).'], "§15")
add('m1rnd.endMove', 'endMove()',
    "The engine's notice that a drag ended; nothing to do in the SVG renderer.",
    ['`RasterRenderer.endMove(why)` lands its drag plane on a drop and drops it on any other end.'], "§15")
add('m1rnd.refreshSelection', 'refreshSelection()',
    "The lasso loop while it is drawn. The selection indicator is the ants' own layer (overlays.js, and on the raster path OverlayLayer).",
    ['Clears the selection layer and draws the lasso, in screen coordinates, as a dashed terracotta path. That is all it draws; the indicator is `_renderSelOverlay`.'], "§15")
add('m1rnd._renderSelection', '_renderSelection()',
    "The lasso loop while it is drawn. The selection indicator is the ants' own layer (overlays.js, and on the raster path OverlayLayer).",
    ['Clears the selection layer and draws the lasso, in screen coordinates, as a dashed terracotta path. That is all it draws; the indicator is `_renderSelOverlay`.'], "§15")
add('m1rnd.setSelectionAnts', 'setSelectionAnts(fn)',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view — drawn into the indicator's own <svg> layers by the one implementation both renderers share (buildSelOverlay, renderSelAnts in raster/svgOverlay.js).",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._renderSelOverlay', '_renderSelOverlay()',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._renderSelChevrons', '_renderSelChevrons(edges, kt, W, H)',
    'Draws the breathing chevrons that point where a selection carries on past a side of the screen.',
    ["One pooled path per edge run marked `chevron`, 24 px in from its side at the run's middle and rotated to face out, in the `bl-sel-edges` layer. Returns how many were drawn.", 'The raster overlay calls this same method, so the chevrons have one implementation on both paths.'], "§15")
add('m1rnd._antPath', '_antPath(width, nonScaling)',
    'Makes one ant path element: no fill, the terracotta, butt caps, the `bl-sel-ants` class.',
    ["A non-scaling stroke unless told otherwise, so the band and the dashes stay in screen pixels under the layer's transform; the screen-edge runs pass false."], "§15")
add('m1rnd._mkSelLayer', '_mkSelLayer(svg, host, cls)',
    "Makes one indicator `<svg>` layer, laid exactly over the drawing's own and promoted to its own compositing layer.",
    ["Absolutely positioned at the drawing's offset within the host, no pointer events, `will-change: transform`. The SVG renderer builds two (`bl-sel-layer`, `bl-sel-edges`); the raster one builds the edge layer only.", "Its own layer so the crawl repaints the ants and not the drawing: measured 50 ms a frame with the ants in the drawing's `<svg>`, 16.7 split out (DESIGN.md §9)."], "§15")
add('m1rnd._buildSelOverlay', '_buildSelOverlay(svg)',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._dropSelOverlay', '_dropSelOverlay()',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._d', '_d(pts, close)',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._len', '_len(pts)',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._fitDash', '_fitDash(el, len, on, off)',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._poolTo', '_poolTo(parent, pool, n, before, make)',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._ensureSelStyle', '_ensureSelStyle()',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd._selCss', '_selCss()',
    "The marching-ants indicator: a band on the object's own silhouette with tile joins dropped, plus marks and arrows at the screen edge where the object carries on past the view.",
    ["The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.", "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join."], "§15")
add('m1rnd.setOpacityGroups', 'setOpacityGroups(v)',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd.setLazyOutlines', 'setLazyOutlines(v)',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd.setRetainScenes', 'setRetainScenes(v)',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd.setDebug', 'setDebug(v)',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd.setTileDebug', 'setTileDebug(v, fn)',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd.setEraseDebug', 'setEraseDebug(v, fn, roleFn)',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd.bumpAll', 'bumpAll()',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd.clear', 'clear()',
    'Settings. Plumbing.',
    ['Settings pass-throughs. Plumbing.'], "§15")
add('m1rnd._renderEraseDebug', '_renderEraseDebug()',
    'The debug overlays: tile rectangles, and what an erase actually touched.',
    ['The debug overlays: tile rectangles, and what an erase actually touched.', "The erase overlay classifies a boundary by asking exactly the question severance asks, sharing the same perimeter-parameter code — a second, parallel notion of 'where on the rectangle is this' would drift from the one the engine severs on, and then the picture would lie."], "§15")
add('m1rnd._renderTileDebug', '_renderTileDebug()',
    'The debug overlays: tile rectangles, and what an erase actually touched.',
    ['The debug overlays: tile rectangles, and what an erase actually touched.', "The erase overlay classifies a boundary by asking exactly the question severance asks, sharing the same perimeter-parameter code — a second, parallel notion of 'where on the rectangle is this' would drift from the one the engine severs on, and then the picture would lie."], "§15")
add('m1scc.now', 'now()',
    "A millisecond clock for the client's slices and waits: `performance.now()` where there is one, else `Date.now()`.",
    ['-'], "§15")
add('m1scc.chunker', 'chunker(max)',
    'A running chunk builder: points go into one box until it would outgrow `max` on a side; the next box starts at the last point, so the chunks cover the ink with no gap.',
    ["Each chunk is `x0, y0, x1, y1, len`, `len` the path length it covers. `put(x, y, jump)` with `jump` starts a new run (a new loop) with no length from the last point; `starts` lists each run's first chunk."], "§15")
add('m1scc.walkLoops', 'walkLoops(loops, max)',
    "Walk a shape's loops once: chunks along the outline, each loop's first chunk (`loops`), and its area and perimeter for its mean width.",
    ["Reads the stored Loop records (line, arc, cut line, cut arc), subdividing every piece at half a chunk so a long line or arc never becomes one box. The area is the shoelace sum plus each arc's segment term."], "§15")
add('m1scc.walkPoly', 'walkPoly(rings, max, closed)',
    "Chunks along polylines, each segment subdivided at half a chunk: a stroke's centreline (open), or a fill's polygons (`closed`: each ring run back to its start, its first chunk returned in `loops`).",
    ['-'], "§15")
add('m1scc.boxSize', 'boxSize(out)',
    'The longer side of the bounding box of a chunk list, 0 when it is empty.',
    ['-'], "§15")
add('m1scc.isInk', 'isInk(doc, o)',
    'Does the index hold this object: not an eraser mark, not a stroke still being drawn, and not a ceded patch (`attachRect`, storage) while its family keeps ink outside patches?',
    ['A patch whose family has nothing else left is the drawing, and counts as ink (`orphanPatch`).'], "§15")
add('m1scc.orphanPatch', 'orphanPatch(doc, o)',
    'Is this ceded patch all that is left of its family: no other member that is neither an eraser mark nor a patch?',
    ['-'], "§15")
add('m1scc.SceneClient', 'SceneClient',
    "The main-thread side of the scene index: a dirty set from the Document's events, item records prepared at idle, one batch at a time to the index in its worker or inline.",
    ['The scene list lands in `docMeta.scenes`; the saved state rides `serializeDrawing` as `meta.sceneIndex` (`exportForSave`). Never runs while a stroke, a drag or a lasso is live, and waits behind the raster and erase workers for at most 3 s (DESIGN.md §11).', "It also records the fine eraser's footprints and rebuilds the index from the file on a load or a reset."], "§15")
add('m1scc.SceneClient.constructor', 'SceneClient.constructor(E, {worker})',
    "Subscribe to the engine's Document, its objects and its ops, with empty dirty, z-change, gone-frame, patch-family, sent and footprint state; `worker: false` forces the inline index.",
    ['The index itself opens on the first batch (`_mode`). `gen`, bumped by every restore, tells a worker result for the current document from one for the document before; `frameEv`, bumped by every frame event and settle, tells a prep that spanned one. The footprint caps are FOOT_MAX (512) and FOOT_CHUNKS (8,192).'], "§15")
add('m1scc.destroy', 'destroy()',
    'Stop: cancel the schedule, unsubscribe from the Document and terminate the worker.',
    ['-'], "§15")
add('m1scc.onChange', 'onChange(fn)',
    "Listen for each landed batch's result; returns the unsubscribe.",
    ['-'], "§15")
add('m1scc._family', '_family(o)',
    "An object added to or gone from a family with a ceded patch: that family's patches are re-checked at the flush, since whether a patch counts as ink depends on the rest of its family.",
    ['-'], "§15")
add('m1scc._onOp', '_onOp(ev)',
    "An erase bake hints each piece with the object it replaced, so it keeps that scene, and records the fine eraser's footprint; an eraser gesture's undo or redo turns its footprints off or on.",
    ["A new action ends the redo branch, so footprints turned off by an undo are dropped for good. A settle counts as a frame event (`frameEv`); its natives' change events follow.", "The hint rides the piece's first item record; the index files the piece into the replaced object's scene when the width range allows (storage, not new ink)."], "§15")
add('m1scc._capFoot', '_capFoot()',
    'Keep at most FOOT_MAX (512) footprints and FOOT_CHUNKS (8,192) chunk records: the oldest are marked to drop, and their scenes go with them.',
    ['-'], "§15")
add('m1scc._footItems', '_footItems(items)',
    "The footprints' item records for a batch: each followed to its host, re-hosted in the family when the host is gone, dropped when none is left.",
    ["A host re-homed to a frame of the same depth (a carry, a merged shadow) takes the footprint with it, stored coordinates unchanged. Otherwise a new host is a piece of the same edit group in the footprint's frame with the same table residual.", 'A footprint turned off (its gesture undone) is sent as gone but kept for the redo; one marked to drop is sent as gone and forgotten. Only changed records are sent.'], "§15")
add('m1scc._cancel', '_cancel()',
    'Cancel the scheduled tick, timer or idle callback.',
    ['-'], "§15")
add('m1scc._busy', '_busy()',
    "Must the index wait? Always while a stroke, a drag or a lasso is live; behind an erase job in flight or the raster worker's queue for at most MAX_WAIT_MS (3 s).",
    ['-'], "§15")
add('m1scc._tick', '_tick(deadline)',
    "One idle tick: retry in 150 ms while busy; else step a restore, or prepare the dirty objects' records in a time slice and send the batch when they are done.",
    ['A slice is SLICE_MS (8 ms) at most, 4 at least, within the idle deadline. Nothing is sent while a batch is in flight. A new batch starts from `_takeGone` and notes `frameEv`; `_sendPrepared` sends it.'], "§15")
add('m1scc._sendPrepared', '_sendPrepared(p)',
    'Send a prepared batch: the ids a frame event dirtied during the prep folded in first, then the z changes, the footprints, the frame diff and the renames.',
    ["Frame records are read at the send and item tables per slice, so after a frame event mid-prep (a settle moves a frame's shift into its natives' tables) the ids it dirtied are prepared into the batch (`_fold`) or its halves disagree. A z change goes as an `attr` record only for an object the index holds and the batch does not already carry."], "§15")
add('m1scc._hasWork', '_hasWork()',
    'Is there anything for a batch: dirty ids, z changes, gone frames, families to re-check, renames, footprints or a changed frame?',
    ['-'], "§15")
add('m1scc._fold', '_fold(st)',
    'Prepare the dirty ids into a batch already prepared, one record per id: a later record replaces an earlier one, keeping its chunks (with their loops) and erase hint when it has none.',
    ['-'], "§15")
add('m1scc._resyncWanted', '_resyncWanted()',
    'Should a restore run now? With a worker, always; inline, only for a document of at most 5,000 objects or when `flushNow` forces it.',
    ['-'], "§15")
add('m1scc._mode', '_mode()',
    'Where the index runs: in a worker if one opens (tried on the first call), else an inline SceneIndex.',
    ['-'], "§15")
add('m1scc._recSlot', '_recSlot()',
    "A record slot in the scene client's per-object columns — width, translation, home — reused from the free list or grown by doubling.",
    ['The main thread keeps three numbers an object in typed columns (DESIGN.md §11).'], "§15")
add('m1scc._homeIx', '_homeIx(home)',
    "The index of a home frame in the client's home table, added on first use.",
    ['-'], "§15")
add('m1scc._frameRec', '_frameRec(f)',
    "A lattice frame as the index's frame record `{id, parent, depth, cx, cy, sx, sy}`.",
    ['-'], "§15")
add('m1scc._sameFrame', '_sameFrame(r, f)',
    'Whether the frame record last sent to the scene worker is still frame f, field by field — a string key per frame per tick was the cost (SC-2).',
    ['-'], "§15")
add('m1scc._framesChanged', '_framesChanged()',
    'Has any frame been added, removed or changed since the last batch?',
    ['-'], "§15")
add('m1scc._loadFoot', '_loadFoot(list)',
    "Read the file's saved footprints (`sceneIndex.erase`), an undone gesture's still off, skipping malformed entries, then cap them (`_capFoot`).",
    ['-'], "§15")
add('m1scc._resyncStep', '_resyncStep(budget)',
    "Step a restore: read the file's footprints, prepare a record for every object in slices, then send one restore batch with the saved state.",
    ["Ids a frame event dirtied during the prep are folded in (`_fold`). A load restores from the file's index; a reset from the state it was given, falling back to the file's. The state is used only when it is v 3 with a scene list.", "Otherwise the old `meta.scenes` lend their ids and names by frame overlap (only v2 rows, `s<n>` with no `kind`, since a v3 part's or region's id would collide with the index's own) and `sceneSeq` seeds the id counter."], "§15")
add('m1scc._failed', '_failed(err, batch, ids)',
    "The index failed on a batch: warn, drop the inline index, and rebuild it from the last saved state with the failed batch's ids and everything dirty since listed as `dirty`.",
    ["The saved state is the last export, else the file's; a restore inserts the `dirty` ids by the ordinary rule. A failed restore is retried from the state it carried."], "§15")
add('m1scc._landed', '_landed(out)',
    "A batch's result: keep its saved state and timings, put the scene list in `docMeta.scenes`, tell the listeners, and schedule again if anything is owed (`_owed`).",
    ['-'], "§15")
add('m1scc._owed', '_owed()',
    'Is anything waiting for the next batch: a restore, a batch being prepared, or `_hasWork`?',
    ['-'], "§15")
add('m1scc.flushNow', 'flushNow()',
    'Bring the index up to date now: inline, synchronously, a restore included; with a worker, the next batch is scheduled at once. Returns whether the scenes are current.',
    ['Never inside a stroke, a drag or a lasso: it schedules instead and returns false. Forces the restore a large inline document otherwise leaves waiting (`_resyncWanted`). At most 1,000 rounds.'], "§15")
add('m1scc.rename', 'rename(id, name)',
    "A user's name for a scene: shown in `docMeta.scenes` at once, sent to the index with the next batch.",
    ['-'], "§15")
add('m1scc.exportForSave', 'exportForSave()',
    "The saved state for a file: the index's last export (or the file's own, before the first restore) with the names given since, every id not yet indexed as `dirty`, and the footprints as `erase`.",
    ['`dirty` includes the ids of the batch being prepared and of an ordinary batch in flight, and what a restore under way carries as dirty (a rebuild after a failure); a load inserts them by the ordinary rule.', "An undone gesture's footprints are saved too, marked `off`, since the op log brings the redo back after a load; dropped ones are not."], "§15")
add('m1sco.fitView', 'fitView(rect, w, h)',
    "The camera that frames a rect, centred, in a w × h viewport: `jumpTo`'s fit and `snapshotView`'s, one implementation.",
    ['Returns `{inScale, inPanX, inPanY}`, or null when the scale is not a positive finite number. CSS px for `jumpTo`, device px for `snapshotView`, so a thumbnail frames a scene exactly as jumping to it would.'], "§15")
add('m1sco.SceneOps', 'SceneOps',
    "The engine's scene calls, as a mixin: the scene index's client, jumping to a scene, and a scene's picture.",
    ['Same mixin arrangement as ErasePipeline.'], "§15")
add('m1sco._initScenes', '_initScenes(on)',
    "Make the engine's scene client, or none for an engine that never lists scenes (`scenes: false`, the thumbnails' copy).",
    ['-'], "§15")
add('m1sco.jumpTo', 'jumpTo(frameKey, rect)',
    'Go to a scene at its natural zoom: the camera fitView gives for its rect in its frame, then the ordinary crossing.',
    ['Sets the camera to `fitView(rect)` in the frame, lets `_maybeCross` bring an out-of-range scale to a legal level, clears the renderer and renders. A camera move, never a document change; a stroke in progress is ended first.'], "§15")
add('m1sco.refreshScenes', 'refreshScenes()',
    'The scene list brought up to date through the scene client: inline, now; with the worker, the next batch is started and the list as it stands comes back.',
    ['Calls `SceneClient.flushNow` and returns `docMeta.scenes`.'], "§15")
add('m1sco.renameScene', 'renameScene(id, name)',
    "A user's name for a scene: shown in the list at once, taken by the index with the next batch; a renamed scene keeps its id and name through merges.",
    ['Through `SceneClient.rename`; an engine without a client renames the row in `docMeta.scenes` directly. Trimmed, at most 120 characters.'], "§15")
add('m1sco.sceneReport', 'sceneReport()',
    "The scene client's account for a report: where the index runs, how many objects wait, whether a restore or a batch is under way, and its counters.",
    ['-'], "§15")
add('m1sco.sceneZoom', 'sceneZoom(s)',
    'Go to a scene at its natural zoom: the camera fitView gives for its rect in its frame, then the ordinary crossing.',
    ['Sets the camera to `fitView(rect)` in the frame, lets `_maybeCross` bring an out-of-range scale to a legal level, clears the renderer and renders. A camera move, never a document change; a stroke in progress is ended first.'], "§15")
add('m1sel.everyNth', 'everyNth(pts, max)',
    "Thins a point list to at most `max` points, for the lasso's hand-precision tests.",
    ['The list itself when it is short enough; otherwise every ceil(n / max)-th point, the last not necessarily included.'], "§15")
add('m1sel.Selection', 'Selection',
    'Selecting, hit-testing and dragging, as a mixin.',
    ['Same mixin arrangement as ErasePipeline.'], "§15")
add('m1sel._selectTap', '_selectTap(P)',
    'A select press that never moved: select, ctrl-toggle, or clear, decided at pen-up.',
    ['On paper a plain tap deselects and a ctrl tap keeps the selection. On ink a ctrl tap toggles the object; a plain tap on a member keeps the whole selection, and anywhere else selects the object under the point (`select`, which applies pending erases over it first).', 'Nothing changes on the way down: a press may turn out to be the first finger of a pinch (DESIGN.md §10).'], "§15")
add('m1sel._isSelected', '_isSelected(id)',
    "Is a native selected (its id, a family member's id, or its home under a selected frame); every native's box in the active frame, the ground truth the suites check the lasso against; one object's box there, through its displacement table.",
    ["Walks every frame's natives through `Document.at` (which settles pending shifts) and maps each box with `_rectInActive`. No production caller."], "§15")
add('m1sel._inkedFrames', '_inkedFrames()',
    'Every frame with a native in its subtree: each frame that holds one, and its ancestors.',
    ['Stops climbing at an ancestor already seen. The lasso skips frames outside it and the selection drops them, because a visited cell with nothing under it stands for nothing: a selection holding such cells drew a dot each on blank paper (50 in one report, F93).'], "§15")
add('m1sel._followCarries', '_followCarries(frame, carries)',
    'A settle carried natives across a cell edge, out of or back into a selected frame: queues them to stay selected.',
    ["Subscribed to the document's `settle` ops. During a drag, or its drop's render, natives carried out of a dragged frame or one under the selection wait in the drag's carried set for `_endMove`. Otherwise, from a frame under the selection, they are queued for `_flushCarried` at the render's end, with a microtask as the fallback for a list built outside a render (a ladder rung, a prebake).", "Not applied inside the render: a selection change there ran a camera step on the old list and cut the render's perf row short."], "§15")
add('m1sel._flushCarried', '_flushCarried()',
    "Applies the carries queued outside a drag to the selection they were carried out of: at a render's end, or a microtask later.",
    ["Keeps the queued natives whose source frame still exists and is under a selected frame; mid-drag they join the drag's carried set, otherwise `_reselect` adds them. Called at the end of `_render`, by `deleteSelection`, and by the microtask `_followCarries` schedules."], "§15")
add('m1sel._outsideSelection', '_outsideSelection(ids)',
    'Of a set of frame ids, those no selected frame holds any more, coarsest first and none under another.',
    ['The frames a subtree drag or an undo moved out of the selected subtrees (a sub-cell rest re-homed them next door), so they can join the selection as frames.'], "§15")
add('m1sel._keepingSelection', '_keepingSelection(fn)',
    'Runs an undo or a redo so that the natives it re-homes and the frames it re-addresses out of the selection stay selected.',
    ["With frames selected, sets `_moving`, which the engine's document subscription fills with re-homed natives that were selected or under a selected frame, and re-addressed frames whose old parent was under one; afterwards `_reselect`s them, the frames through `_outsideSelection`. Returns `fn`'s result."], "§15")
add('m1sel._reselect', '_reselect(ids, torn)',
    'Keeps the selection standing for the same ink after ink crossed cell edges: carried natives join as ids, torn frames as frames, empty frames leave.',
    ["The frames are the selection's plus `torn`. A native no selected frame holds joins the ids; one listed and held by a selected frame again leaves them. Frames with no native under them (`_inkedFrames`) are dropped. Nothing is set when all that already holds; otherwise `_setSelection` (DESIGN.md §10, F93)."], "§15")
add('m1sel._selectableRects', '_selectableRects()',
    "Is a native selected (its id, a family member's id, or its home under a selected frame); every native's box in the active frame, the ground truth the suites check the lasso against; one object's box there, through its displacement table.",
    ["Walks every frame's natives through `Document.at` (which settles pending shifts) and maps each box with `_rectInActive`. No production caller."], "§15")
add('m1sel._rectInActive', '_rectInActive(o)',
    "Is a native selected (its id, a family member's id, or its home under a selected frame); every native's box in the active frame, the ground truth the suites check the lasso against; one object's box there, through its displacement table.",
    ["One native's drawn box in the active frame: the Stage's placement of it there (`placeNative(o, F).box()`), its table and its frames' shifts composed (A1 C1)."], "§15")
add('m1sel._objPointInActive', '_objPointInActive(o, p)',
    "A point of a native, mapped into the active frame where its picture is drawn (the Stage's placement, `placeNative`).",
    ['-'], "§15")
add('m1sel._lassoWalk', '_lassoWalk(visit)',
    "The lasso's frame walk: the camera's frame and everything under it, then out through each ancestor at its scale and offset, skipping the branch already walked.",
    ['-'], "§15")
add('m1sel._familyBounded', '_familyBounded(o, found, frames)',
    "Whether the loop bounds native o's family: every member found, a pending mark, or under an enclosed frame (a piece homed there is taken through it).",
    ['-'], "§15")
add('m1sel._tornUnder', '_tornUnder(frames, found)',
    'The enclosed frames that may not stand for themselves whole: the path from each keyed native under one whose family the loop does not bound — a ceded kid of a stroke outside — up to the enclosed frame.',
    ["Reads only the keyed natives under enclosed frames (`Document.keyedIn`), never their other ink (REVIEWER-3 LASSO-1: a drag then tore the kid out of its stroke). Since A1 C4 a cede's kids live in private frames under their family's chain, so this is the backstop for kids in shared frames: content from before C4, a kid ceded across its chain's parent cell, a member moved per object."], "§15")
add('m1sel._inkInsidePolygon', '_inkInsidePolygon(o, level, ink)',
    "Whether an object's ink, not only its box, lies wholly inside the lasso; asked of objects whose box straddles the loop.",
    ["First the points the object already has (a stroke's samples, a fill's vertices, a shape's piece ends; a few hundred at most), mapped where the picture is and tested one by one; any outside answers no. Only then is the outline flattened at 3 screen px (LASSO_INK_TOL_PX), capped at 3,000 points a ring, and each ring tested against the prepared loop.", 'The cheap reject is where most crossed objects leave: flattening a scribble of twenty thousand arcs costs 14 ms even coarsely (measured). An outline that throws answers no.'], "§15")
add('m1sel._toggleSelected', '_toggleSelected(id)',
    'Selection state, including the ctrl rules: a loop overlapping the selection adds, one drawn purely inside removes.',
    ['Adds or removes one object from the selection — the ctrl-click behaviour.'], "§15")
add('m1sel._applyLasso', '_applyLasso(L)',
    'Selection state, including the ctrl rules: a loop overlapping the selection adds, one drawn purely inside removes.',
    ["Turns a finished loop into a selection change once the loop's erase barrier is clear: the pending marks whose box meets the loop land first (`_lassoBarrier`), so the lasso finds the cut-outs rather than the ink under an unapplied mark. Until then the loop is parked (`_lassoParked`, still drawn) and judged when the barrier ends.", '`_judgeLasso` applies the rules: plain replaces the selection, or deselects when the loop caught nothing; ctrl with the loop catching anything new adds; ctrl with the loop catching nothing new (drawn inside the selection) removes.'], "§15")
add('m1sel._judgeLasso', '_judgeLasso(L, poly)',
    "A finished loop's verdict: what it finds becomes the selection; with ctrl, a loop that catches nothing new subtracts what it catches, and one that catches anything new adds.",
    ['A ctrl loop catching nothing new is one drawn purely inside the selection, so it subtracts — one rule that reads the same way round as a group-level toggle.'], "§15")
add('m1sel.select', 'select(sx, sy, after, guard)',
    'Selection state, including the ctrl rules: a loop overlapping the selection adds, one drawn purely inside removes.',
    ['Selects whatever is under a point, replacing the current selection. When marks over the hit are still pending it waits on their erase barrier (`_tapBarrier`) and hit-tests again what shows there then, at most 8 rounds; `after` runs once it is decided.'], "§15")
add('m1sel.deselect', 'deselect()',
    'Selection state, including the ctrl rules: a loop overlapping the selection adds, one drawn purely inside removes.',
    ['Installs ids and frames as the selection, keeping only live ids and frames the lattice still has; with neither it deselects. The primary member (id, edit key, level, object) is the first live id, or the first frame when there are no ids.', 'Families are not expanded here; `_isSelected` and `_selectionMembers` resolve them. Redraws through one table step (`_syncStep`) and emits status, unless `quiet` (the caller renders).'], "§15")
add('m1sel._selectionRect', '_selectionRect()',
    "The visible union of the selection's families in the active frame. Only the suites read it.",
    ["Unions the drawn boxes (bbox, half the line width, the placement's offset) of every Stage item whose family is selected. With none drawn: the primary member's box where its picture is (F68), or failing that its box in its own frame."], "§15")
add('m1sel._dragFramesStart', '_dragFramesStart(d, camDepth)',
    'Records, once per drag, the start address and shift of every frame the drag moves as a frame.',
    ['For each selected root not under another: its subtree to three levels below the camera (`LevelMap.subtreeStart`; deeper frames follow their parent pointer), leaving out empty childless containers. Each gets an entry `{ from, to, shiftBefore, shiftAfter, settled, merged }`, which becomes part of the `moveFrames` undo op.', 'Sets `Document.holdMerges`: a shadow the drag makes is merged only once the op is pushed.'], "§15")
add('m1sel._restoreFrames', '_restoreFrames(d)',
    "Puts a cancelled drag's frames back at their start addresses and shifts, undoing any settle.",
    ['Unsettles each settled frame, re-addresses the moved ones in one `readdressMany`, restores every shift, clears the owner records, and releases the merge hold.'], "§15")
add('m1sel._frameUnderPoint', '_frameUnderPoint(sx, sy)',
    'The selected frame whose mark is within 8 px of a screen point, or null.',
    ["The mark is the frame's origin on screen. A press there drags the selection, as a press on selected ink does."], "§15")
add('m1sel._displaceMember', '_displaceMember(from, below, camDepth, tx, ty)',
    'Where one member goes for a drag displacement: its new home frame and table, or why it cannot move.',
    ["Homed at or above the camera's depth: the displacement enters the table at the camera's depth (`addOffset`). Deeper: `LevelMap.displaceFrame` turns the whole-cell digits into a new home and the rest enters the home-level entry. A carry out of the home level moves the member to the neighbour cell. Stored coordinates are never touched (DESIGN.md §8).", "Pure in the lattice's state, so `_dragSelection` asks once per (home frame, starting table) and every member sharing those takes the same answer; registration rests on that."], "§15")
add('m1sel._homeShift', '_homeShift(id)',
    "The neighbour cell an object's stored bbox centre lies in, as the re-home that would put it there; null in its own cell.",
    ['Returns `{ level, dx, dy }`, dx and dy the whole-frame shift for its coordinates. Read at pen-up for every member a drag touched; only a non-null answer re-homes (`_normalizeHome`).'], "§15")
add('m1sel._normalizeHome', '_normalizeHome(id)',
    'Put an object back inside its own box after a move, so invariant 2 holds again before anything else looks at the document.',
    ['At pen-up, for a moved member whose stored bbox centre lies in a neighbouring cell (`_homeShift`): re-home it there and shift its coordinates by the whole frames, so invariant 2 holds again. Exact, because neighbouring origins differ by exactly W, a power of two.', "The only place a move writes coordinates, so that member's undo entry keeps geometry snapshots."], "§15")
add('m1sel._selectionStatus', '_selectionStatus()',
    "The selection's ids with their families, and what happens to them: delete removes the objects and sets selected frames aside as containers (removeFrames).",
    ["The count is the ids plus each selected frame's subtree count (`_subtreeCount`); a frame under another selected one is counted once, through that one. Style is not reported: nothing downstream edits a selection's colour, width or opacity."], "§15")
add('m1sel._subtreeCount', '_subtreeCount(f)',
    "How many natives a selected frame stands for (its list, its subtree's and its shadows'), for the status count.",
    ['O(frames): sums `Document.count` over `LevelMap.walk`, reading no native.'], "§15")
add('m1sel._tinyHit', '_tinyHit(b, slack)',
    "Whether a mark is smaller than the reach, so it is picked anywhere its box is within reach — the eight probes sit on the reach's ring and missed a sub-pixel dot between them (TESTER-2).",
    ['-'], "§15")
add('m1sel.hitTestAt', 'hitTestAt(sx, sy)',
    'Clicking: the topmost thing under the cursor. This is how you reach something at depth, where no loop can bound anything.',
    ['Is this point inside a resolved outline, allowing a little slack?'], "§15")
add('m1sel._marksAt', '_marksAt(items, p0)',
    'The landed marks whose ink covers a frame point, or null: a pick skips their masked targets there, so a press takes what shows (DESIGN.md §7).',
    ['Each mark is read where the Stage places it.'], "§15")
add('m1sel._hitTest', '_hitTest(sx, sy, slackPx, only)',
    'Clicking: the topmost thing under the cursor. This is how you reach something at depth, where no loop can bound anything.',
    ['What is under this point? Returns the topmost object, or nothing.', "Walks the Stage's items from the top down, each at its placement's offset, testing resolved shapes by inside-ness and raw strokes by distance to their centreline with the pen width as slack. A native under a landed mark's mask (`_marksAt`) is passed over: what the mark erases is not there to hit."], "§15")
add('m1stg.Item', 'Item',
    "One drawn piece of the scene: a tile piece or a native of the camera's frame, with its paint-order key and the offset paint applies.",
    ['z, the family key and the erase fields are read from the live native, the geometry from the piece, so a z change or a mark landing needs no re-read of a tile (R25 H8).', 'Its getters give the fields a render-list item had, so the packs, the pick and the SVG renderer read an item as they read a piece; nothing is written onto a piece or a native.'], "§15")
add('m1stg.Item.constructor', 'Item.constructor(stage, piece)',
    'An item for one piece: no native yet, filed under `own`, no offset, not in the table.',
    ['-'], "§15")
add('m1stg.type', 'type (getter)',
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."], "§15")
add('m1stg.z', 'z (getter)',
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."], "§15")
add('m1stg.editId', 'editId (getter)',
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."], "§15")
add('m1stg.erase', 'erase (getter)',
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."], "§15")
add('m1stg.targets', 'targets (getter)',
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."], "§15")
add('m1stg.targetOf', 'targetOf (getter)',
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."], "§15")
add('m1stg.handledBy', 'handledBy (getter)',
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."], "§15")
add('m1stg.fam', 'fam (getter)',
    'The family the item paints with: its edit key, else its own id (a keyless native is a family of one).',
    ['-'], "§15")
add('m1stg.clip', 'clip (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.loops', 'loops (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.polys', 'polys (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.pts', 'pts (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.lwFrame', 'lwFrame (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.color', 'color (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.opacity', 'opacity (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.Item.covers', 'Item.covers (getter)',
    "The piece's geometry and style, read straight through.",
    ['A pack refuses a cell whose tiles the table does not cover and is asked again once covered (F119); the patch step skips such a cell (DESIGN.md §9).'], "§15")
add('m1stg.fadeTag', 'fadeTag (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.origin', 'origin (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.w', 'w (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.tile', 'tile (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.attachRect', 'attachRect (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg._home', '_home (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg._ver', '_ver (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg._outline', '_outline (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg._pen', '_pen (getter)',
    "The piece's geometry and style, read straight through.",
    ['-'], "§15")
add('m1stg.Item._bbox', 'Item._bbox (setter)',
    "`bboxOf`'s memo, kept on the piece — never written onto the stroke still being drawn.",
    ['-'], "§15")
add('m1stg.pending', 'pending (getter)',
    "True from pen-down until the stroke's shape lands: every pack skips it and the pick still sees it.",
    ["PLAN §1.5: a stroke whose perimeter has not resolved is drawn by its live path alone; the resolve's commit stales the plates under it."], "§15")
add('m1stg.Item.box', 'Item.box (getter)',
    "The item's drawn box in the camera frame's units, without the paint offset (`placementModel.drawnBox`).",
    ['-'], "§15")
add('m1stg.cmp', 'cmp(a, b)',
    "The scene's paint order: `(z ?? id, id)` as the oracle's `renderList` sorts, then the order one native's pieces were concatenated in.",
    ["Ties fall through the piece's tile position and sequence to the item's own uid, so the order is total and a remove finds exactly its item."], "§15")
add('m1stg.ChunkList', 'ChunkList',
    "The scene's sorted item list, in chunks of at most 512: a binary search over the chunks' last items, then within one.",
    ['Measured for A2 §2.2: replacing one item by three at 45,000 items costs 24–26 µs. Every change bumps `ver`, which `toArray` and the packs key on.'], "§15")
add('m1stg.ChunkList.constructor', 'ChunkList.constructor()',
    'An empty list at version 0.',
    ['-'], "§15")
add('m1stg.clear', 'clear()',
    'Empties the list and bumps its version.',
    ['-'], "§15")
add('m1stg.fill', 'fill(items)',
    'Replaces the contents with these items, sorted here, in half-full chunks.',
    ['-'], "§15")
add('m1stg._chunkFor', '_chunkFor(it)',
    "The chunk an item belongs in: binary search over the chunks' last items.",
    ['-'], "§15")
add('m1stg.insert', 'insert(it)',
    'Inserts an item at its paint-order place, splitting a chunk that passes 512.',
    ['-'], "§15")
add('m1stg.remove', 'remove(it)',
    'Removes this very item from its paint-order place; false when it is not there (a different item with the same key is never taken).',
    ['-'], "§15")
add('m1stg.toArray', 'toArray()',
    'The items in paint order as one array, rebuilt once per version.',
    ['-'], "§15")
add('m1stg.sameOff', 'sameOff(a, b)',
    'Offset and rectangle helpers: two offsets equal; a rectangle moved back by an offset; do two rectangles meet (touching counts — invalidation is conservative); the union of two.',
    ['-'], "§15")
add('m1stg.shifted', 'shifted(r, off)',
    'Offset and rectangle helpers: two offsets equal; a rectangle moved back by an offset; do two rectangles meet (touching counts — invalidation is conservative); the union of two.',
    ['-'], "§15")
add('m1stg.meets', 'meets(a, b)',
    'Offset and rectangle helpers: two offsets equal; a rectangle moved back by an offset; do two rectangles meet (touching counts — invalidation is conservative); the union of two.',
    ['-'], "§15")
add('m1stg.unionOf', 'unionOf(a, b)',
    'Offset and rectangle helpers: two offsets equal; a rectangle moved back by an offset; do two rectangles meet (touching counts — invalidation is conservative); the union of two.',
    ['-'], "§15")
add('m1stg.sameTraits', 'sameTraits(a, b)',
    'Do two families paint alike: the same union flag, sign, colour and alpha (`rasterPack.familyTraits`).',
    ['A family whose traits change between commits changes how its members composite, so the Stage dirties its whole box (`_famTouch`).'], "§15")
add('m1stg.Stage', 'Stage',
    "The scene: the camera frame's items in paint order, the generation G every commit moves, and the freshness of every plate cell.",
    ["Kept from the document's and the tile cache's own events, so it is never behind the document. It owns no camera and no plates: the engine hands it the camera's frame and window (`sync`), and the plate store registers its cells (`track`).", "What it must keep, from its header: a handler never bakes a tile — a tile the table needs and the cache does not hold current is listed missing and read at the next `sync`; no read raises a document event, and the tile events `sync`'s reads raise are queued and applied at its end; dirt is a changed native's drawn footprint before and after, taken from the event itself and mapped into every frame with tracked cells, so a plate is exact iff its G ≥ its cell's `dirtySince`; membership and placement come from the `PlacementModel` and nothing else.", "A drag writes nothing until its drop (A1 C2): `hold` and `setDragDelta` draw, hit and lasso the held natives at their placement plus the pointer's delta (DESIGN.md §8–§9, A2-scene.md §2–§3)."], "§15")
add('m1stg.destroy', 'destroy()',
    'Unsubscribes from both event sources and drops the commit listeners.',
    ['-'], "§15")
add('m1stg.items', 'items()',
    'The items in paint order, bottom-up: one array per table version, never mutated by a reader.',
    ["Both renderers draw it: the raster renderer packs the items into plates, the SVG renderer builds its Two.js groups from them, at the Stage's generation (DESIGN.md §9)."], "§15")
add('m1stg.itemsTopDown', 'itemsTopDown()',
    'The items top-down, over the same array.',
    ['-'], "§15")
add('m1stg.itemsOf', 'itemsOf(id)',
    "A native's items, in no order.",
    ['-'], "§15")
add('m1stg.Stage.covers', 'Stage.covers(frameId, rect)',
    "Whether every tile under a rectangle of the camera frame, and under it in each reroute group's source frame, is read into the table.",
    ['A pack refuses a cell whose tiles the table does not cover and is asked again once covered (F119); the patch step skips such a cell (DESIGN.md §9).'], "§15")
add('m1stg.onCommit', 'onCommit(fn)',
    'Subscribes to every commit: `fn(G, info)` with the frames whose tracked cells it dirtied, predicates over frame ids whose plates must go (the id now names another place), or a reset (another document).',
    ['-'], "§15")
add('m1stg.changesSince', 'changesSince(G0)',
    "The item deltas since a generation — added, removed, and changed with each one's previous offset — or null when the log no longer reaches back, so the reader rebuilds.",
    ['-'], "§15")
add('m1stg.landedAt', 'landedAt(id)',
    "The G at which a native's shape landed: a plate packed at or past it paints the shape.",
    ['-'], "§15")
add('m1stg.track', 'track(key, frameId, box, sinceG)',
    'A plate stored or a job begun for this cell: from now every commit whose footprint meets the cell moves its `dirtySince`.',
    ['A picture read at an older G (a snapshot read before a change, A2 §3.3) looks the commits since then up in the dirt log, so its plate is stale at once rather than taken for exact.'], "§15")
add('m1stg.untrack', 'untrack(key)',
    'The cell is neither stored nor in flight any more: forgotten.',
    ['-'], "§15")
add('m1stg.dirtySince', 'dirtySince(key)',
    'The largest G of a commit since `track` whose footprint met the cell, 0 if none: a plate is exact iff its G is at least this (rule 2).',
    ['-'], "§15")
add('m1stg.dirtyRects', 'dirtyRects(frameId, sinceG)',
    "The footprints of the commits after a G, in a frame's units — what a partial re-render clips to; null when the log no longer reaches back (re-render the whole cell).",
    ['-'], "§15")
add('m1stg._dirtIn', '_dirtIn(F, sinceG, box)',
    'The newest commit after a G whose footprint meets a box in frame F: its G, 0 if none, the current G when the log does not reach back.',
    ['-'], "§15")
add('m1stg.touch', 'touch(id)',
    "A native changed what it draws with no document event (the idle fitter's outline): its footprint is dirt, committed at once outside a batch.",
    ['-'], "§15")
add('m1stg.holding', 'holding (getter)',
    "Whether a drag's hold stands.",
    ['-'], "§15")
add('m1stg._held', '_held(ev)',
    "Whether the hold answers for a document event — a held native's, or one about a frame under a held frame — so it is queued until `release`.",
    ['-'], "§15")
add('m1stg._owed', '_owed()',
    'Whether anything was applied or changed since the last commit: an event, a footprint, a landing, a drop or a reset.',
    ['-'], "§15")
add('m1stg.batch', 'batch(fn)',
    'Runs `fn` as one commit however many events it raises: a drop, an undo, a delete, a load.',
    ['DESIGN.md §9: one integer G moves once a commit — an event outside a batch, or a whole batch.'], "§15")
add('m1stg.forgetFrame', 'forgetFrame(id)',
    'Frame GC forgot a frame: its tracked cells go (its tiles went with their events) and the reroute groups are re-diffed at the next commit.',
    ['-'], "§15")
add('m1stg._onDoc', '_onDoc(ev)',
    'A document event: queued while the hold answers for it or a sync is running, else applied and, outside a batch, committed.',
    ['-'], "§15")
add('m1stg._stepOf', '_stepOf(ev)',
    "An erase step's class, taken as its event arrives: a cut or a descent on an object of the mark's lineage dirties the object's box inside the mark's box and its dust whole, a refusal over ink the same, a graze or an inkless refusal nothing; null for an ordinary event.",
    ['The event names the mark whose bake it is (`by`), and the erase rule says whether that mark hid the object (`inLineage`). So plates the mark never reaches keep (DESIGN.md §9, PLAN §5.3 A2-Q2).'], "§15")
add('m1stg._onTile', '_onTile(ev)',
    'A tile cache event: queued during a sync, else applied.',
    ['-'], "§15")
add('m1stg._drainQueue', '_drainQueue()',
    'Applies what a sync queued, in arrival order.',
    ['-'], "§15")
add('m1stg._applyTile', '_applyTile(ev)',
    "Applies one tile cache event to the table: a bake installs a watched tile, a drop or a clear marks it missing, a patch appends or removes pieces — a held native's skipped, since the hold answers for them.",
    ['-'], "§15")
add('m1stg._frameState', '_frameState(f, addr, under)',
    "A frame's reach at an address (its own by default), optionally with everything under a frame, as a footprint state.",
    ['-'], "§15")
add('m1stg._before', '_before(id, s)',
    "Record a native's footprint before an event (the first one in a batch) and after it (the last one).",
    ['-'], "§15")
add('m1stg._after', '_after(id, s)',
    "Record a native's footprint before an event (the first one in a batch) and after it (the last one).",
    ['-'], "§15")
add('m1stg._rectsIn', '_rectsIn(states, G)',
    "A commit's footprint states in frame G's units; past 256 rectangles, their one union box.",
    ['-'], "§15")
add('m1stg._commit', '_commit()',
    'The end of one commit: the touched natives placed again, the family rule applied, the footprints made dirt, G moved, the shapes that landed stamped with it, and the listeners called.',
    ["The renderer's listener marks its patch step due, so no compose draws a plate the commit staled with no patch asked (DESIGN.md §9, PLAN §5.15)."], "§15")
add('m1stg._settle', '_settle()',
    "Places the touched natives' items again and, after a frame event or a lattice change, re-diffs the reroute groups (no table is written: the Stage's word for re-placing items).",
    ['-'], "§15")
add('m1stg._dirt', '_dirt(G, states, frames)',
    "Moves `dirtySince` on every tracked cell a commit's footprints meet, and logs the footprints for `dirtyRects` and late snapshots.",
    ['-'], "§15")
add('m1stg._traitsOf', '_traitsOf(items)',
    "A family's traits as the pack decides them, over its items in paint order; null for a stroke family.",
    ['-'], "§15")
add('m1stg._itemBox', '_itemBox(it)',
    "An item's drawn box at its offset, in the camera frame's units.",
    ['-'], "§15")
add('m1stg._famTouch', '_famTouch(fk)',
    'The first time a commit touches a family: its traits and box as they were, for the family rule (a family of one keeps its item instead).',
    ['-'], "§15")
add('m1stg._reset', '_reset()',
    'Another document: the table is rebuilt at the next sync, and the pending strokes, the landings, the hold and the change log are forgotten.',
    ['-'], "§15")
add('m1stg._clearTable', '_clearTable()',
    'Empties every index of the table — items, tile keys, reroute groups, families — and marks the items no longer live.',
    ['-'], "§15")
add('m1stg._rebuild', '_rebuild(F, window, budgetMs)',
    "The table for frame F from scratch: the reroute groups from the placement model, the window's tiles watched and read within the budget, the frame's live natives as its own items, sorted once.",
    ["A crossing or a reset rebuilds. The change log is cut, so a `changesSince` reader rebuilds too, and the families' traits are recorded as the plates packed from here will see them."], "§15")
add('m1stg._setWindow', '_setWindow(window)',
    'A window change: tiles that left are retired, tiles that entered are read (A2 §2.12).',
    ['-'], "§15")
add('m1stg._watchGroup', '_watchGroup(g)',
    "A reroute group's tiles: the window shifted back by its remainder, in its source frame; keys it no longer needs are let go.",
    ['-'], "§15")
add('m1stg._readMissing', '_readMissing(budgetMs)',
    'Reads every watched tile listed missing from the tile store, within the budget; what is not read stays missing.',
    ['-'], "§15")
add('m1stg._latKey', '_latKey()',
    "The lattice's address epoch and frame count as one key: a change means the reroute is re-diffed.",
    ['-'], "§15")
add('m1stg._rerouteDiff', '_rerouteDiff()',
    'The reroute re-diffed (A2 §2.10): every native whose group changed since the last diff placed again, groups made and let go.',
    ["A reroute group is the moved natives whose pictures are read from one source frame at one remainder (the placement model's `displaced`, `TileStore._rerouteGroups`' memo): their tiles are read in that frame over the window shifted back by the remainder, and their items painted at it."], "§15")
add('m1stg._dropGroup', '_dropGroup(g)',
    'Lets a reroute group go: its items removed, its tiles retired.',
    ['-'], "§15")
add('m1stg._staleUnder', '_staleUnder(X)',
    'Frames under a re-addressed frame: their watched tiles are stale (by `chainSeq`) and read again.',
    ['-'], "§15")
add('m1stg._tileKeys', '_tileKeys(F, rect)',
    'The up and down tile keys of frame F under a rectangle.',
    ['-'], "§15")
add('m1stg._parseKey', '_parseKey(key)',
    'A tile key back into its frame, direction and cell.',
    ['-'], "§15")
add('m1stg._watch', '_watch(key)',
    "Starts watching a tile key (once): the tile store's camera pins follow the watched set.",
    ['-'], "§15")
add('m1stg._retire', '_retire(ks)',
    'A key no role needs any more — not in the window, in no reroute group: its items go and it is no longer watched.',
    ['-'], "§15")
add('m1stg._install', '_install(ks, tile)',
    "A tile read or re-baked: the key's items become the tile's pieces in its order; a held native's items stay as they were.",
    ['-'], "§15")
add('m1stg._refreshKey', '_refreshKey(key)',
    "A key's items checked against its tile's pieces and the roles they have now; only differences move.",
    ['-'], "§15")
add('m1stg._roleOf', '_roleOf(ks, p)',
    "The role a piece of this key is drawn in: a window piece (null), a reroute group's key, or not drawn (undefined).",
    ['-'], "§15")
add('m1stg._place', '_place(ks, p, seq)',
    "One piece of a watched tile into the table, if a role draws it: its native, its offset (the group's remainder or its placement's), its paint key.",
    ['-'], "§15")
add('m1stg._dropKeyItems', '_dropKeyItems(key)',
    'Removes every item a tile key put in the table.',
    ['-'], "§15")
add('m1stg._itemFor', '_itemFor(piece)',
    "The item for a piece: the one it last was when that is not live, so the pack's per-item memo hits; else a new one.",
    ['-'], "§15")
add('m1stg._setOwn', '_setOwn(nat)',
    "A native the camera's frame draws live, into the table as its own item.",
    ['-'], "§15")
add('m1stg._offOf', '_offOf(nat)',
    "A native's paint offset in the camera's frame — its placement's remainder — as one array while it does not change.",
    ['-'], "§15")
add('m1stg._setOff', '_setOff(it, off)',
    'Gives an item a new offset, logging the change and touching its family for the family rule.',
    ['-'], "§15")
add('m1stg._file', '_file(it)',
    'File an item under its family key, and take it out.',
    ['-'], "§15")
add('m1stg._unfile', '_unfile(it)',
    'File an item under its family key, and take it out.',
    ['-'], "§15")
add('m1stg._removeItem', '_removeItem(it)',
    'Takes an item out of every index and the list, logged as removed.',
    ['-'], "§15")
add('m1stg._cur', '_cur()',
    'The change log of the commit in progress: items added, removed, and changed with their previous offset (a rebuild logs nothing).',
    ['-'], "§15")
add('m1stg._logAdd', '_logAdd(it)',
    'The change log of the commit in progress: items added, removed, and changed with their previous offset (a rebuild logs nothing).',
    ['-'], "§15")
add('m1stg._logRemove', '_logRemove(it)',
    'The change log of the commit in progress: items added, removed, and changed with their previous offset (a rebuild logs nothing).',
    ['-'], "§15")
add('m1stg._logChange', '_logChange(it)',
    'The change log of the commit in progress: items added, removed, and changed with their previous offset (a rebuild logs nothing).',
    ['-'], "§15")
add('m1stg._closeLog', '_closeLog()',
    "Closes the commit's change log at its G and cuts the oldest entries past 4,096 deltas, raising the floor `changesSince` can reach.",
    ['-'], "§15")
add('m1stg.Placement', 'Placement',
    "`placeNative`'s answer: one native seen from one frame, with the drag's delta when the native is held.",
    ['-'], "§15")
add('m1stg.zkOf', 'zkOf(it)',
    "An item's paint key (z, else its id); two rectangles equal.",
    ['-'], "§15")
add('m1stg.sameRect', 'sameRect(a, b)',
    "An item's paint key (z, else its id); two rectangles equal.",
    ['-'], "§15")
add('m1ts.flattenAll', 'flattenAll(objs)',
    "Turns derived pieces' loops into stored Loops, so a cached tile holds eight doubles a piece.",
    ["In place, and returns the list. The freeze and the chop hand over transient piece arrays; the cache keeps the `Loop` form the document's natives use."], "§15")
add('m1ts.TileStore', 'TileStore',
    'The bidirectional tile cache.',
    ['Keyed by box. Everything shown from another level comes through here, and nothing else caches derived geometry.'], "§15")
add('m1ts.destroy', 'destroy()',
    'Subscribes to the document, so every change patches the cache.',
    ['Builds the cache and subscribes to the document, so every change patches or invalidates the tiles that could hold it. Destroying unsubscribes and drops everything.'], "§15")
add('m1ts.onTile', 'onTile(fn)',
    "The tile hook (A2 §2.9): subscribes `fn` to every write to the cache or to a tile's pieces — a bake, an append, a remove, a drop, a clear — reported synchronously as it happens; returns the unsubscribe.",
    ["Nothing else writes the cache or a tile's `objs`, so the Stage, the one subscriber, sees every change to the content its items were built from."], "§15")
add('m1ts._tileEv', '_tileEv(ev)',
    'Hands one tile event to every `onTile` subscriber.',
    ['-'], "§15")
add('m1ts._indexTile', '_indexTile(key, tile)',
    "Keep the index from a native's id to the cached tiles holding its pieces as a tile enters or leaves the cache (`tilesOf`).",
    ['-'], "§15")
add('m1ts._unindexTile', '_unindexTile(key, tile)',
    "Keep the index from a native's id to the cached tiles holding its pieces as a tile enters or leaves the cache (`tilesOf`).",
    ['-'], "§15")
add('m1ts._setTile', '_setTile(key, tile)',
    "The one way a tile enters the cache: indexed by its pieces' ids and reported as a `bake`.",
    ['-'], "§15")
add('m1ts._appended', '_appended(tile, n0)',
    'Pieces patched onto a cached tile from index `n0` on: indexed by id and reported as an `append`, so an added native reaches the picture without a re-bake.',
    ['-'], "§15")
add('m1ts._keyOf', '_keyOf(tile)',
    "A tile's cache key: `frame|dir|i,j`.",
    ['-'], "§15")
add('m1ts.tilesOf', 'tilesOf(id)',
    'The keys of the cached tiles holding pieces of native `id`, read-only, or null.',
    ['-'], "§15")
add('m1ts.peek', 'peek(key)',
    'A cached tile that is current — same cache epoch, same chain sequence — or null; it neither bakes nor touches the LRU.',
    ['-'], "§15")
add('m1ts.setOpacityGroups', 'setOpacityGroups(v)',
    'A policy change invalidates everything at once.',
    ['A policy change invalidates the whole cache at once: `bumpEpoch` moves the epoch counter and clears the map, and a tile stamped with an old epoch fails its check.'], "§15")
add('m1ts.setBatch', 'setBatch(on)',
    'During a drag, a tile the camera cannot see is dropped rather than patched — it is stale either way, and rebuilding it later only happens if the camera goes back. Worth 105 ms of each 130 ms pointer event on a nine-member family.',
    ['Turns on drag mode: a tile the camera cannot see is **dropped** rather than patched.', 'A change normally patches every cached tile that could hold the object, because one edit is cheaper to patch in than to re-derive. A drag is not one edit — it is one per pointer event per member, and patching a tile nobody is looking at is work thrown away sixty times a second.', 'Measured on a nine-member family with 5,810 arc pieces and 45 cached tiles: 105 ms of the 130 ms each pointer event cost. Visible tiles are still patched, so what the user is watching stays exact.'], "§15")
add('m1ts.bumpEpoch', 'bumpEpoch()',
    'A policy change invalidates everything at once.',
    ['A policy change invalidates the whole cache at once: `bumpEpoch` moves the epoch counter and clears the map, and a tile stamped with an old epoch fails its check.'], "§15")
add('m1ts._depth', '_depth(frameId)',
    'Bounds, so a direction with no content costs nothing.',
    ["`_depth` is a frame's depth, 0 when unknown. `_minContentDepth` is the shallowest depth any frame with natives has, which lets `_bakeUp` return nothing when the parent is coarser than all content."], "§15")
add('m1ts._minContentDepth', '_minContentDepth()',
    'Bounds, so a direction with no content costs nothing.',
    ["`_depth` is a frame's depth, 0 when unknown. `_minContentDepth` is the shallowest depth any frame with natives has, which lets `_bakeUp` return nothing when the parent is coarser than all content."], "§15")
add('m1ts.content', 'content(F, windowRect)',
    'Everything to draw at this frame: the magnified and minified tiles covering the window. Pins what is visible, then evicts.',
    ['Everything to draw at one frame inside one window. Works out which cache tiles the window covers and takes both content classes from each, coarser ink magnified in and finer ink minified in, building either on demand.', "When any object has a displacement table, `_reroute` replaces moved objects' pieces with those read from where their picture is. Then pins exactly the tiles read and evicts down to the caps."], "§15")
add('m1ts.read', 'read(F, rect, budgetMs)',
    'The tiles over `rect` in frame `F`, both directions, cached or baked while the budget lasts; a miss past the budget is listed, never thrown (A3 §4.2).',
    ["`budgetMs`: Infinity reads everything, 0 the cache alone, anything else bakes until the deadline and at least one tile. Returns the tiles, the missing keys and whether the read was complete. The Stage reads the store through it (DESIGN.md §15); it leaves the camera's pins and the eviction as they were."], "§15")
add('m1ts.readTiles', 'readTiles(cells, budgetMs)',
    "The tiles the Stage's table asks for, each served from the cache or baked — a read stops between tiles once its budget passes, never inside a parent chain, and never mints a frame (A3 §4.2; A1 C3). Pins and eviction stay the camera's.",
    ["The eviction is held for the read and the pins restored after it, so a read never evicts what the camera pinned. A read the budget stopped is counted (`overBudget`); with `warmReads` set, the keys read join the warm set (the prefetch's reads, F83)."], "§15")
add('m1ts.setCameraPins', 'setCameraPins(keys)',
    "Replaces the camera's pin set, then runs the eviction a read had held.",
    ['-'], "§15")
add('m1ts.clearWarm', 'clearWarm()',
    "Returns the last ladder's warm tiles to the ordinary eviction rules; called as a new ladder starts.",
    ['-'], "§15")
add('m1ts._reroute', '_reroute(F, win, out, pins)',
    "Swaps moved objects' pieces for the ones read from where their picture is: the frame their table's whole cells point to, over the shifted window.",
    ["Drops every moved object's pieces from F's own tiles, then for each group from `_rerouteGroups` reads and pins the source frame's tiles over the window shifted back by the remainder, keeping only the group's ids. The pieces are painted translated by that remainder (`res`, stamped in `listFor`).", 'Tiles are in unmoved space: a move invalidates no tile, it only changes which tiles a moved object is read from (F55, DESIGN.md §8).'], "§15")
add('m1ts.ownContent', 'ownContent(F)',
    "The active frame's own objects — a plain read, and that is the whole point of cutting a ceded tile out of the parent rather than recording a rectangle over it.",
    ["The active box's own objects. A plain array read.", 'It used to re-derive. A parent that had ceded a window still held whole geometry, so its hole existed only as a rectangle and had to be subtracted **per view, every render**, by polygonizing the band and clipping it. Two defects came straight out of that: the result was cached against the view and the fast zoom path skips the render, so an in-level zoom left the cache describing a 16-pixel hole while the object on screen was 3,000 pixels wide; and when it did rebuild it cost 232–386 ms with a handful of objects on screen.', 'Cutting the ceded tile out of the parent is what made this a plain read.'], "§15")
add('m1ts._bakeSettled', '_bakeSettled(bake)',
    'Runs a tile bake again when the document changed under it, at most three times (F78).',
    ["A bake reads frames through `Document.at`, which can settle a moved frame's shift and carry its natives into a frame the bake has already passed; the tile is not cached yet, so no event patches it. `rev` bumps on every emit; a bake that saw it move is repeated and counted in `_rebakes`. After three tries the last result stands."], "§15")
add('m1ts._bakeUp', '_bakeUp(F, i, j)',
    "The magnify chain. Build this tile from the parent's tiles, plus the parent's own objects, plus the ring of neighbours. Chained one level at a time, because a composed jump upward cancels.",
    ['Builds one tile of coarser ink magnified into this box. **The chain.**', "Collects what the parent looks like over this tile's pre-image: the parent's own magnify tiles (recursively — this is the chain, one level at a time), the parent's own objects, and the objects of the eight boxes around the parent.", 'Classifies each into empty, solid, or edge. Solid means one object floods the whole tile with no edge in it, and is replaced by a four-cornered rectangle — which is what stops geometry outgrowing a tile and bounds the whole chain.', 'Edge content goes through the one-step derivation, which is where the chop, the freeze and the clip happen.', 'Returns nothing at all when nothing coarser than the parent has any content, which is the common case near the top of a drawing.'], "§15")
add('m1ts._upPiecesOver', '_upPiecesOver(parentId, pr, only)',
    "The parent's magnified pieces over a rectangle, one square's copy of each object when the rectangle straddles squares.",
    ["Inside one parent cache square: that square's up pieces. Across several: the square holding the rectangle's centre, and another square's piece of an object only when the centre square's clip does not cover the rectangle. `only` limits it to one object id; its one caller passes null.", "Two squares' pieces are the same ink with clip vertices rounded on different rectangles, and 4,096x per crossing later the copies diverged by thousands of units (F42). The erase's descent cedes the same square by the same rule."], "§15")
add('m1ts._ringNatives', '_ringNatives(parentId, rect)',
    "The uncle pickup: the eight neighbouring boxes' objects at every step. Invariant 2 is what makes it complete, and neighbouring origins differ by whole boxes so the translation is exact.",
    ["Picks up the objects of the eight boxes surrounding the parent, translated into the parent's coordinates.", '**The uncle.** A box is about three screens across, so zooming in slightly off-centre shifts the camera to the next box along, and ink that is right there on screen becomes a *sibling of your ancestor* — coarser than you, but not above you. The magnify chain skipped it and the minify path skipped it too, and it simply vanished. Found by an erase test that cut a hole and then could not find the object.', "Cheap and complete because an object never reaches past its box's immediate neighbours, so the ring of eight is the whole of it. Asks each neighbour's own spatial index rather than scanning its objects, because this runs on every bake for eight boxes and a linear scan there is what a drag over a crowded document feels like.", 'Neighbouring origins differ by whole boxes, so the translation is exact, and nothing is minted just because a tile was looked at.'], "§15")
add('m1ts._solid', '_solid(o, rec, rect)',
    'A tile-covering quad, overlapped into its neighbours.',
    ['Emits the tile-covering rectangle that stands in for a flooding object, overlapped into its neighbours by the seam pad.'], "§15")
add('m1ts._bakeDown', '_bakeDown(F, i, j)',
    'The minify path. Every non-ancestor box at or below this depth, projected in one jump — safe at any distance because coordinates only shrink. Sub-pixel content is culled and near-threshold content is size-tagged for the fade.',
    ['Builds one tile of finer and sideways ink minified into this frame. Candidates come from `_downSources`, in depth order.', "A frame is skipped whole when even the largest possible object would be under the fade floor, or when its index's extent (`Document.frameExtent`) is under it or misses the tile. Per object: its size at this frame's deepest zoom (view-independent, so the verdict does not flicker) culls it below `fadeLoPx` and tags it for the fade; then a box test against the tile, one direct projection, and `_downPieces`.", 'One jump is safe here at any distance because minifying only shrinks coordinates.'], "§15")
add('m1ts._downSources', '_downSources(F, rect)',
    "The frames a down tile of F reads: every non-ancestor at F's depth or deeper whose cell, grown by one, meets the tile.",
    ["Walks F's subtree, then out through each ancestor into its other children's subtrees, carrying scale and offset into F's units; a subtree whose cell grown by one (REACH, invariant 2) misses the tile is skipped whole. Lists only frames with natives, counted with `Document.count`, which settles nothing. Ascending depth.", "A native overhanging its frame's neighbours is not found, as with the ring pickup (DESIGN.md §9)."], "§15")
add('m1ts._downPieces', '_downPieces(o, d, rect, tag, out)',
    'One minified piece clipped to one tile — and flattened to polygons. Safe only because such a tile is a leaf that nothing inherits.',
    ['Clips one minified object to one tile.', "A resolved outline minifies exactly, so all that happens is a clip to the padded tile and a flatten at this level's display fidelity. Fills are clipped as rings with their winding preserved so holes stay holes; strokes are clipped as polylines with the line width added to the window so end caps land beyond the padded tile.", "**Stores polygons, not arcs** — the one place the chain's exactness is not carried through. Safe for exactly one structural reason: a minify tile is a leaf. The chain reads the parent's magnify tiles and its objects, never its minify tiles, so a polygon made here can never be inherited or used as a boolean operand."], "§15")
add('m1ts.chainSeq', 'chainSeq(F)',
    'The sum of the address sequence numbers of F and its ancestors, stamped on every tile built at F.',
    ['A tile built under an older sum read its content through an address a subtree move has since changed, and is rebuilt on its next lookup; no walk over the moved subtree is needed. Memoised per frame for one lattice `addrEpoch`.'], "§15")
add('m1ts._tileLive', '_tileLive(key, tile)',
    "Whether a cached tile still stands: it is dropped during a drag's batch mode unless pinned on screen, and when its frame is gone (RENDER-1).",
    ['-'], "§15")
add('m1ts._removeObject', '_removeObject(id)',
    'Incremental patching: one edit is cheaper to patch in than to re-derive, so a tile is rebuilt only when correctness needs it.',
    ["Filters a native's pieces out of the tiles that hold them — found by the id → tiles index, not a scan of the cache — and tells the tile listeners (`onTile`); in a drag's batch mode an off-screen tile is dropped outright (`_tileLive`)."], "§15")
add('m1ts._ringCopy', '_ringCopy(o, H, A, pr)',
    "Native `o` of ring frame `H` as `_ringNatives(A, pr)` would hand it over — projected into `A`'s coordinates — or null when it would not.",
    ['-'], "§15")
add('m1ts._reaches', '_reaches(o, H, tile)',
    "Whether native `o`'s box at `H` meets an up tile's rect grown by the seam pad — the cold bake's cull, so a patch adds a native only where a bake would.",
    ['-'], "§15")
add('m1ts._appendChained', '_appendChained(key, tile, o)',
    "Patches an added native into a chained up tile from its parent squares' pieces; when one of those parent tiles is not cached and current, the tile is dropped instead (DESIGN.md §8: an added native is patched into the cached tiles a cold bake would put it in).",
    ['-'], "§15")
add('m1ts._appendUp', '_appendUp(tile, objs)',
    'Incremental patching: one edit is cheaper to patch in than to re-derive, so a tile is rebuilt only when correctness needs it.',
    ['Adds one object to one already-built magnify tile, using the same classify-and-derive path a full bake uses.'], "§15")
add('m1ts._appendDown', '_appendDown(tile, o, H)',
    'Incremental patching: one edit is cheaper to patch in than to re-derive, so a tile is rebuilt only when correctness needs it.',
    ['Adds one object to one already-built minify tile, re-running the size gate and the bounding-box cull first.'], "§15")
add('m1ts._overlaps', '_overlaps(rect, b, margin)',
    'Incremental patching: one edit is cheaper to patch in than to re-derive, so a tile is rebuilt only when correctness needs it.',
    ['Routes a document event to the cache: a reset clears it; a frame event (`refile`, `removeFrame`, `addFrame`) goes to `_onFrameEvent`; a removal filters pieces out; an add or finalise patches pieces in, a live add waiting for its finalise.', 'A change marked `offsetsOnly` or `attrOnly` is ignored: a move changes nothing a tile is made of (F55). Any other change removes and re-adds.'], "§15")
add('m1ts.framesLeft', 'framesLeft(F)',
    "The camera has moved to frame F: drops every cached tile except F's ancestors', those just pinned by the camera's read, and those the prefetch read ahead (`_warm`).",
    ["Called by the engine's render after the Stage's read of F, so a moved object's tiles the reroute read from another frame survive. Returns the count dropped.", 'Keeping the read-ahead tiles is F83: dropping them re-baked cold the tiles the zoom that followed needed (measured 440 -> 64 ms for the first list in jsdom).'], "§15")
add('m1ts._evict', '_evict()',
    'Least-recently-used, globally and per frame, never touching what is on screen.',
    ['Evicts least-recently-used tiles down to the global cap, never touching anything currently on screen, then applies the per-box cap.'], "§15")
add('m1ts._evictPerLevel', '_evictPerLevel()',
    'Least-recently-used, globally and per frame, never touching what is on screen.',
    ['The per-box half of eviction, so one busy box cannot consume the whole cache.'], "§15")
add('m1ts.size', 'size()',
    'Inspection. Test-facing.',
    ['Cache size and keys. Test-facing only.'], "§15")
add('m1ts._tileKeys', '_tileKeys()',
    'Inspection. Test-facing.',
    ['Cache size and keys. Test-facing only.'], "§15")


# ---- src/engine/__oracles__/model-v1/: read ----
add("m1cde.cede", "cede(doc, id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts, dustBar, by)",
    "Cedes a tile: the parent's hole cut exactly in its own coordinates, what was inside made kids at the level, the remnants and kids one edit family on one tile grid; the remnants keep the object's own displacement table, the kids take it one level down unless given one.",
    ["-"], "§15")
add("m1eds.descentJob", "descentJob(world, input)",
    "The whole descent for one target on a virtual document: every cede down to the erase level, then the last link's cut; each step carries the dust it dropped, mapped into its frame.",
    ["-"], "§15")
add("m1eds.wireDescent", "wireDescent(world, input)",
    "A descent job as a worker message: the lattice serialised with its retired ids, the target and the eraser's loops in buffers of their own, transferred.",
    ["-"], "§15")
add("m1eds.unwireDescent", "unwireDescent(m)",
    "In the worker: the world and the input rebuilt, the lattice loaded from its serialised form with its retired ids.",
    ["-"], "§15")
add("m1fil.loadSnapshot", "loadSnapshot(snap)",
    "Loads the development snapshot (dev-0) — camera, natives and lattice — and registers the marks' lineage (A2 §4.9); for tests and tools.",
    ["-"], "§15")
add("m1fil.loadDrawing", "loadDrawing(raw, {render})",
    "Loads the real save format: decoded (it throws before anything changes), the lattice, the frames the natives name, the natives, the camera set and settled into a legal zoom, the marks' lineage derived (registered now when it renders, A2 §4.9), the bake resumed and the file's meta taken; renders unless told not to.",
    ["-"], "§15")
add("m1per.decodeNatives", "decodeNatives(n)",
    "Per-object validation. Numbers that are not numbers mean the file is not ours; an outline that does not close is damage that gets mended.",
    ["-"], "§15")
add("m1plm.createPlacementModel", "createPlacementModel({doc, lm, store})",
    "The placement model as it was before C1: `nativesIn` a frame's own natives (`doc.at`); `placement` a native's picture as its home's residual, its reroute group's, or its table's residual at the frame's depth; `displaced` the tile store's reroute groups; the footprints and the stored-coordinate mappings through the native's own table.",
    ["-"], "§15")
add("m1sco.snapshotView", "snapshotView(req)",
    "A picture of a rect in a frame, framed by `fitView` at a camera that is never set: the Stage's snapshot of the rect, one raster job on one plate, for the Scenes panel.",
    ["-"], "§15")
add("m1gc.collectFrames", "collectFrames(E, inRender)",
    "Frame GC as it was before C1: forgets every candidate that holds nothing and that nothing keeps — the camera's frame and its ancestors, the trail, a frame with kids or shadows, one the document names — and then each parent or shadow owner it empties; never mid-gesture, during a held merge or with a descent out. A forgotten frame's tiles, Stage items and plates go, and a selected one leaves the selection.",
    ["-"], "§15")
add("m1ovl._eraseDebugOverlay", "_eraseDebugOverlay()",
    "Diagnostics for multi-level families and for what a mark actually touched.", ["-"], "§15")
add("m1ovl._selTable", "_selTable(s)",
    "The selection's members grouped by frame, with each frame's union boxes, one per displacement table (F68).", ["-"], "§15")
add("m1ovl._selFrameContent", "_selFrameContent(f, F)",
    "The box, in frame F, of everything under a selected frame: each frame of its subtree's content extent, moved by that frame's shift and mapped into F.",
    ["-"], "§15")
add("m1ovl._selDecide", "_selDecide(s, table)",
    "Decides the ants: which frames are one dot, and which of the Stage's items get runs, in retained coordinates; a decision is reused while nothing it depends on has moved.",
    ["-"], "§15")
add("m1shm.isPhoneBudget", "isPhoneBudget(env)",
    "The phone budget as of 5e9b1dd: 4 GB of device memory or less, or a screen under 1,200 px on its long side.", ["-"], "§15")
add("m1shm.RasterRenderer", "RasterRenderer · PlateStore",
    "Stand-ins for the raster renderer and the plate store the frozen engine imports: model-v1 runs the SVG path only.", ["-"], "§15")
add("m1shm.RasterRenderer.constructor", "RasterRenderer.constructor() · PlateStore.constructor()",
    "Both refuse construction: the raster path is not frozen; the frozen engine is made with `raster: false`.", ["-"], "§15")
add("m1doc.query", "query(rect, out)",
    "The objects whose boxes overlap a rect: none when it misses the index's extent; a flat scan when it lies far out, spans more than 4,096 cells or more cells than objects; else the grid cells it meets and the big-object list.",
    ["-"], "§15")
add("m1doc.opFrames", "opFrames(op, out)",
    "Every frame an op names — its levels, a move's homes, a frame move's frames, parents, merges and carries, an erase's steps — the frames GC keeps while the op can be undone or redone.",
    ["-"], "§15")
add("m1doc.Document.constructor", "Document.constructor()",
    "The document empty: natives by frame, the ids and the step sequence, undo and redo, the subscribers, the per-frame indexes, the offset bookkeeping (`offRev` and its log), the frame owners, the merge hold, and the set-aside lists and keyed sets of deleted subtrees.",
    ["-"], "§15")
add("m1doc._emit", "_emit(ev)",
    "Every mutation notifies its subscribers, after moving `rev` and, for an event that can change an offset object's table or home, `offRev`, logged per object (`offTouchedSince`).",
    ["-"], "§15")
add("m1doc._settleIfPending", "_settleIfPending(level, arr)",
    "Applies a frame's pending shift to every native it holds, once, as the per-object path would have; a native it carries out of its cell is re-homed in the neighbour, and each change is emitted as a settle or a carry.",
    ["-"], "§15")
add("m1doc.unsettle", "unsettle(frameId, settled)",
    "Reverses a recorded settle from its result tables; a native the settle carried to a neighbour comes home, emitted as a settle and a carry.",
    ["-"], "§15")
add("m1doc.applySettle", "applySettle(frameId, rec)",
    "Replays a logged settle: the homes and tables it recorded, set as they are, as a carry and a settle.", ["-"], "§15")
add("m1doc._mergeShadows", "_mergeShadows(E)",
    "Merges every shadow of resident frame E into it: both settled, the natives appended to E's list, the kids re-parented (`LevelMap.adoptShadow`), the shadow's list and index deleted and the merge noted on the owning op; a shadow set aside by a delete waits.",
    ["-"], "§15")
add("m1doc._setKeyedAside", "_setKeyedAside(k)",
    "A frame's set of family-keyed natives set aside with its list, for the lasso's family test under an enclosed frame.", ["-"], "§15")
add("m1doc.detachFrame", "detachFrame(frame, rec)",
    "Sets one frame's list and index aside, as a subtree delete does — its natives stay in `_byId`, unreadable; with a record whose kept natives were placed meanwhile, only the others go aside, marked gone.",
    ["-"], "§15")
add("m1doc._reuseDetached", "_reuseDetached(k)",
    "A set-aside frame written again: its old natives are marked gone (DOC-1) and the frame counts as reused.", ["-"], "§15")
add("m1doc.unmerge", "unmerge(rec)",
    "Reverses one shadow merge on undo: the frame back as a shadow (`LevelMap.unadoptShadow`), its natives back in their own list, keyed and indexed there.",
    ["-"], "§15")
add("m1doc.Document.add", "Document.add(o, level, {live, by})",
    "Adds a native to a frame, settling the frame's pending shift first: its list, the id map, its displacement bookkeeping and the frame's index (a live stroke waits outside it), then the `add` event — with `by` when an erase step minted it (A2 §4.5).",
    ["-"], "§15")
add("m1doc.removeById", "removeById(id, {by, dust})",
    "Removes a native from its frame — its home's pending shift settled first, since a carry can re-home it — out of the list, the id map, the keyed set and the index; returns its frame and index for the undo. `by` and `dust` mark an erase step's removal.",
    ["-"], "§15")
add("m1doc.insertAt", "insertAt(obj, level, index)",
    "Puts a native back into a frame's list at a remembered index — the frame settled and reused first — with its id, table and index entries, and emits its `add`.",
    ["-"], "§15")
add("m1doc.setOffsetsById", "setOffsetsById(id, below, {settle})",
    "A move: replaces an object's displacement table and touches no coordinate; `settle` marks the event as a settle's.", ["-"], "§15")
add("m1doc.rehomeById", "rehomeById(id, toLevel, {carry})",
    "Moves an object to a different box without touching a coordinate: one remove and one add, tagged as a rehome so a drag does not read it as the object going away; `carry` marks a settle's carry.",
    ["-"], "§15")
add("m1doc.rehomeManyById", "rehomeManyById(ids, toLevel)",
    "`rehomeById` for many natives at once, their frames settled first: each source list compacted in one pass instead of spliced per object.", ["-"], "§15")
add("m1doc.removeFrameSubtree", "removeFrameSubtree(rootId, {by})",
    "Sets a frame subtree aside by reference: each frame's list and index detached, with no per-object work; `by` marks a frame a mark covers whole (A2 §4.2).",
    ["-"], "§15")
add("m1doc.insertFrameSubtree", "insertFrameSubtree(records)",
    "Puts set-aside frame lists and indexes back by reference — the undo of a subtree delete or a frame-covering erase; natives placed in a frame meanwhile are kept beside them.",
    ["-"], "§15")
add("m1doc.cedeTileById", "cedeTileById(id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts, dustBar, by)",
    "Cede a tile on the document (`cede`): the rect cut out of the parent exactly, in its own coordinates, and the ink inside minted as kids one level down.",
    ["-"], "§15")
add("m1doc.pushUndo", "pushUndo(op)",
    "One gesture, one action: the op on the undo stack (capped), the redo branch dropped, and what the dropped ops named offered to frame GC (F94).",
    ["-"], "§15")
add("m1doc.forgetFrame", "forgetFrame(frame)",
    "The document's side of frame GC: an empty frame's list, index, set-aside natives and bookkeeping go; false when it still holds natives.",
    ["-"], "§15")
add("m1doc._invert", "_invert(op)",
    "Applies one op's inverse and returns the op that undoes it: an add or erase by removing or re-inserting the native at its index, moves through `_undoMove`, the many-record and frame ops record by record, a delete's parts in reverse, an erase commit's steps.",
    ["-"], "§15")
add("m1doc._applyStep", "_applyStep(st)",
    "Re-applies one bake step — the frames set aside again, the re-key forward, or the source removed and its pieces put back; false, still suspended, when its source is not in the document.",
    ["-"], "§15")
add("m1doc._replace", "_replace(natives, load)",
    "Replaces the whole document with these natives: every index, map, set-aside list and keyed set rebuilt, then one `reset` event.", ["-"], "§15")
add("m1eng.ladderIdle", "ladderIdle(fn)",
    "The ladder's idle hop: `requestIdleCallback`, or a 30 ms timer where there is none.", ["-"], "§15")
add("m1eng.KobinEngine.constructor", "KobinEngine.constructor(container, {width, height, onStatus, raster, scenes, frames, levers, pyramid})",
    "Wires the frozen engine together — the lattice, the document, the camera, the tile store, the Stage over the frozen placement model and the SVG renderer (the raster one refuses) — with the Dev levers' defaults, the frame mode and the pyramid flag, and subscribes to the document.",
    ["-"], "§15")
add("m1eng.setLevers", "setLevers(patch)",
    "The Dev levers: the valid fields of `patch` into the engine's config, anything else ignored; with the pyramid on, the renderer takes them at once and the view renders.",
    ["-"], "§15")
add("m1eng.destroy", "destroy()",
    "Makes the engine inert: its timers (the bake's, the ladder's, the reads') and the pending frame cancelled, the meters stopped, the scene client, the Stage, the tile store, the renderer and the plate cache destroyed.",
    ["-"], "§15")
add("m1eng._perf", "_perf(op, t0, always, extra)",
    "The operation log: an operation of 8 ms or more (any, with `always` or tracing) recorded with the level and zoom, the last 300 kept (4,000 tracing), and every one past `PERF_LONG_MS` in its own capped list.",
    ["-"], "§15")
add("m1eng.listFor", "listFor(frameKey, rect, forCamera, budgetMs)",
    "The render list for any frame and window as the SVG path built it: the frame's tile pieces (on camera, or off camera within a budget — null past it) and its own natives, each stamped with its family, its mark and its residual, sorted by z then id.",
    ["-"], "§15")
add("m1eng._beginHold", "_beginHold()",
    "At a drag's start on the raster path, with the move hold on and a drag plane that accepts the selection: the Stage holds the selection's members and selected frames; otherwise the drag goes the old way.",
    ["-"], "§15")
add("m1eng._planeState", "_planeState()",
    "The selection's ids in the current render list — its members and what lies under its frames — for the raster renderer's drag plane, memoised per selection and list; null with nothing selected.",
    ["-"], "§15")
add("m1eng._endMove", "_endMove(why)",
    "The one exit of a drag (drop, cancel, delete, deselect, undo): the hold dropped (`_dropHold`), one render, what the drag carried selected again, and frame GC.",
    ["-"], "§15")
add("m1eng._render", "_render(readMs)",
    "One render: frame GC when the camera changed frame; the SVG path's list (`_buildList`), or on the raster path the Stage's table synced and its items taken; the renderer's render and update, status and the perf row; what this render's settles carried flushed (F93) and the ladder's quiet restarted.",
    ["-"], "§15")
add("m1eng._tableStep", "_tableStep(crossed)",
    "The raster path's camera step: a crossing renders (with the pyramid on, from the cache alone); otherwise the table step (`_syncStep`), the renderer's update and status.",
    ["-"], "§15")
add("m1eng._syncStep", "_syncStep()",
    "A camera step without a render: on the raster path the Stage's table synced to the window — with the pyramid on from the cache alone, the rest left to `_readIdle`; else every tile — then the renderer follows the camera.",
    ["-"], "§15")
add("m1eng._camReadMs", "_camReadMs()",
    "The budget a camera step's table sync reads tiles in: 0, the cache alone, with the pyramid on; else unbounded.", ["-"], "§15")
add("m1eng._readIdle", "_readIdle()",
    "Reads the tiles a camera step left unread once the camera has been still for the rest's quiet, a ladder slice at a time at idle, each slice stepping the renderer, until the window is covered.",
    ["-"], "§15")
add("m1eng._frame", "_frame()",
    "One animation frame's step, once: the drag's at the last pointer, then the camera's — a zoom's consequences, else a pan's (with the pyramid on, one more frame to see stillness); else the live stroke's SVG update; else a still camera's step or one compose for the plates that arrived.",
    ["-"], "§15")
add("m1eng._panStep", "_panStep(crossed, t0)",
    "A pan's consequences, once a call or once a frame: on the raster path the table step; on the SVG path a render when the view crossed a cell, changed its visible set or left its window's inner half, else a camera-only update; then the ladder's quiet restarted.",
    ["-"], "§15")
add("m1eng._zoomBy", "_zoomBy(sx, sy, factor, crossedBefore)",
    "Zooms the camera about a screen point and takes its consequences now or at the next frame.", ["-"], "§15")
add("m1eng._zoomStep", "_zoomStep(crossed, t0)",
    "A zoom's consequences, once a call or once a frame: on the raster path the table step; on the SVG path a render when a crossing, the visible set, a fat or fade flip, a re-origin or the window demands it, else a camera-only update; then the prebake, the ladder's quiet, and outline fits after a crossing or near the fat gate.",
    ["-"], "§15")
add("m1eng._maybeLadder", "_maybeLadder()",
    "Restarts the quiet timer after which the zoom-out ladder is built at idle — on the raster path, and not with the pyramid on, whose prefetch's far levels stand instead.",
    ["-"], "§15")
add("m1eng._ladderRung", "_ladderRung(k, key)",
    "Builds one ladder rung from a Stage snapshot of its cover, read a slice at a time, posts its plates, and schedules the next rung at the following idle callback; a rung not finished in `LADDER_RUNG_TRIES` hops ends this view's ladder.",
    ["-"], "§15")
add("m1eng._maybePrebake", "_maybePrebake()",
    "Warms the frame an approaching crossing leads to, up or down — on the raster path its Stage snapshot and plates, on the SVG path its tiles — and fits outlines while idle; nothing with the pyramid on (its prefetch's crossing target instead).",
    ["-"], "§15")
add("m1eng._queueIdleFits", "_queueIdleFits()",
    "Fits the outlines of the camera frame's wide raw strokes while idle, 8 ms at a time; a fit emits no document event, so with plates it is the Stage's dirt (`touch`); one render once done.",
    ["-"], "§15")
add("m1eng._pointerDown", "_pointerDown(sx, sy, ctrl)",
    "Everything a gesture can be, on the way down: draw, erase, pan, lasso or the select tool's press, which changes nothing; a pending frame step is flushed first, a parked gesture cancelled, and unlanded marks registered before a select or erase press reads them (A2 §4.11, §4.12).",
    ["-"], "§15")
add("m1eng._pointerUp", "_pointerUp()",
    "A gesture's end: a pending frame step flushed first; a press that waits on a barrier is only marked released; then the lasso's, the drag's or the stroke's end, and the pan and erase state cleared.",
    ["-"], "§15")
add("m1eng.undo", "undo() · redo()",
    "One gesture is one action: nothing in a read-only tab; a parked gesture and a live drag cancelled first; the history step in one Stage batch, keeping the selection where it can; then the bake rescheduled, a render and frame GC.",
    ["-"], "§15")
add("m1erp._markAlive", "_markAlive(id)",
    "Whether mark `id` can mask anything again: it is in the document and not set aside, or held by an undone gesture on the redo stack (memoised per redo stack).",
    ["-"], "§15")
add("m1erp.flushBakes", "flushBakes()",
    "Resolves every pending perimeter now and registers the marks that landed — for tests, and wherever a gesture needs settled ink; a pending bake render is done too.",
    ["-"], "§15")
add("m1erp._stepShapeBakes", "_stepShapeBakes(budgetMs)",
    "The pen-up resolve queue, run in slices: each finished job's outline sealed and baked into its stroke, promoted when oversize (invariant 2), a mark registered in its landing's commit (A2 §4.2); on the raster path a stroke off the camera frame syncs the table instead of rendering.",
    ["-"], "§15")
add("m1erp._candidatesUnder", "_candidatesUnder(Erec, exclude)",
    "The registration's scan: every reachable native under a mark's box and below its z that the eraser's box may reach, less `exclude`, as ascending ids — the moved ones through their own tables, the box mapped once per home and table; once per mark.",
    ["-"], "§15")
add("m1erp._eraseFramesPass", "_eraseFramesPass(Erec)",
    "At a mark's registration: takes whole the frames its ink covers — a frame's reach its cell ± REACH — and that hold nothing drawn above it.",
    ["-"], "§15")
add("m1erp._projected", "_projected(E, HE, o)",
    "Mark E's loops in native `o`'s stored coordinates, memoised per home and own displacement table, so targets moved together share one projection (A2 §4.7).",
    ["-"], "§15")
add("m1erp._eraseOp", "_eraseOp(E)",
    "Resolve the gesture's undo entry before touching the document — the mark's commit op, one found on the undo stack after a reload, or a new one pushed; a cut that cannot record itself must not happen.",
    ["-"], "§15")
add("m1erp._lookahead", "_lookahead()",
    "Dispatches pairs ahead of the serial head, in the serial order, up to the erase pool's free slots; a target pending under an earlier mark is not dispatched for a later one (the per-target lock).",
    ["-"], "§15")
add("m1erp._dispatchPair", "_dispatchPair(Erec, target, {ahead, barrier, inline})",
    "One mark against one object: ceded downward by the descent when the object is homed shallower on an ancestor chain, else cut in place; the job goes to the erase worker pool (`submit`) where there is one, landing in the reorder buffer, or runs inline and applies now.",
    ["-"], "§15")
add("m1erp._applyLanded", "_applyLanded(Erec, rec, c)",
    "Applies a landed job in its turn if it is still valid — the target live and unchanged, the pair still pending, the lattice not re-addressed, the document not reset — else counts it stale; a job the worker lost is run again here, inline.",
    ["-"], "§15")
add("m1erp._familyComponents", "_familyComponents(key)",
    "The family graph. Every member is a node; two are joined when their ink meets on the same stretch of a ceded doorway — a geometric question, not whether two boxes touch.",
    ["-"], "§15")
add("m1erp._cellOffset", "_cellOffset(A, B)",
    "The offset between two frames' cells in frame units: 0 for the same frame, a frame width a step for one of its eight ring neighbours, else null.",
    ["-"], "§15")
add("m1ewc.now", "now()", "The clock: `performance.now()`, else `Date.now()`.", ["-"], "§15")
add("m1ewc.setEraseTransport", "setEraseTransport(t, {slots})",
    "Tests only: stands a promise-returning transport, with its own slot count, in for the erase workers, to run the asynchronous path in jsdom.",
    ["-"], "§15")
add("m1ewc.eraseWorkerCount", "eraseWorkerCount()",
    "Erase workers to spawn: the cores less one and less the raster workers, between 1 and `MAX_ERASE_WORKERS` (3).", ["-"], "§15")
add("m1ewc.spawn", "spawn()",
    "Starts the erase pool once (none where there is no Worker, which marks it broken); each worker's answers go to `onMessage`, its errors to `onWorkerError`.",
    ["-"], "§15")
add("m1ewc.onWorkerError", "onWorkerError(e)",
    "A worker error: the pool fails, replaced only when some worker has already answered.", ["-"], "§15")
add("m1ewc.terminate", "terminate()", "Terminates every erase worker and forgets them.", ["-"], "§15")
add("m1ewc.submit", "submit({kind, prio, barrier, job, key})",
    "One cut or descent into the erase pool's queue: a promise of its result, or null where there is no worker (the caller runs it inline).",
    ["-"], "§15")
add("m1ewc.eraseFreeSlots", "eraseFreeSlots()",
    "Workers free for a lookahead: the idle ones less what is queued, or the transport's free slots.", ["-"], "§15")
add("m1ewc.takeHead", "takeHead()",
    "The queue's next job: a barrier's first, then the lowest priority, then the oldest.", ["-"], "§15")
add("m1ewc.wire", "wire(rec) · unwire(rec, out)",
    "A job as its worker message, a cut's or a descent's; and a worker's answer back as its result.", ["-"], "§15")
add("m1ewc.pump", "pump()",
    "Hands the queue's head to every idle worker (or to the transport while it has slots), the job wired and posted and the watchdog armed; a job that cannot be wired or posted rejects.",
    ["-"], "§15")
add("m1ewc.sendTransport", "sendTransport(rec)",
    "One job through the test transport: its answer resolves it, a failure rejects it, and the queue pumps again.", ["-"], "§15")
add("m1ewc.onMessage", "onMessage(slot, data)",
    "A worker's answer to the job it holds: resolved, or rejected when it failed or will not unwire; the slot is free and the queue pumps.",
    ["-"], "§15")
add("m1ewc.failPool", "failPool(e, respawn)",
    "The pool fails: its workers terminated and the jobs they held rejected; replaced up to `MAX_RESPAWNS` times when asked, else marked broken with every waiting job rejected — the callers run them inline.",
    ["-"], "§15")
add("m1ewc.armWatchdog", "armWatchdog() · checkWatchdog()",
    "The watchdog: a job silent past `WATCHDOG_MS` is suspect, and still silent at the next check replaces the pool.", ["-"], "§15")
add("m1ewc.resetEraseWorkerClient", "resetEraseWorkerClient()",
    "Tests only: the watchdog cleared, the workers terminated, the queue emptied, the transport and every flag and counter reset.", ["-"], "§15")
add("m1ewc._checkEraseWatchdogForTests", "_checkEraseWatchdogForTests()",
    "TEST: runs the watchdog's check now.", ["-"], "§15")
add("m1ewc.eraseWorkerStats", "eraseWorkerStats()",
    "For the report: the counters, the job sequence, the workers and how many are busy, the queue, whether the pool is broken, and the transport's state.",
    ["-"], "§15")
add("m1lm.LevelMap.constructor", "LevelMap.constructor(cfg, width, height)",
    "Starts a lattice holding only the root frame `0`, with an empty route cache, address epoch 0, no minted set and no retired ids.",
    ["-"], "§15")
add("m1lm._addFrame", "_addFrame(id, parent, cell, depth)",
    "Mints a frame — its parent, depth and cell, edge and centre, its shift and shadow fields — into the frames map (and the minted set), the spine and its parent's kids; the path cache dropped.",
    ["-"], "§15")
add("m1lm._childId", "_childId(parentId, i, j)",
    "Id minting: the origin chain keeps its depth as its id, everything else is `<parent>/<i>,<j>`, with `#n` when that id is taken or retired (a forgotten moved frame's).",
    ["-"], "§15")
add("m1lm.forget", "forget(id)",
    "Forgets a frame with no kids and no shadows: out of its parent's kids or its resident's shadows, retired when it was ever moved (never minted again this session), the path cache dropped and the spine rebuilt if it was on it; false otherwise.",
    ["-"], "§15")
add("m1lm.moveSubtreeTargets", "moveSubtreeTargets(rootId, atDepth, dx, dy, start, shiftOf)",
    "Where every frame of a moving subtree ends up, by `displaceFrame`'s digit arithmetic on the start addresses.", ["-"], "§15")
add("m1lm.merge", "merge(data)",
    "Adds the frames another lattice minted, in `serialize()`'s shape, parents first (F67): a parent lost since is minted again (F99), and a frame already here with no parent is adopted under its own.",
    ["-"], "§15")
add("m1lm.ensureId", "ensureId(id)",
    "The frame an id names, minted along its birth chain when missing — as a shadow beside a resident of its cell; null for an id no frame can have (F67).",
    ["-"], "§15")
add("m1lm.load", "load(data)",
    "Loads a lattice: the pre-lattice format refused (`LEGACY_FORMAT`), else the frames rebuilt from the data, the minted set held off meanwhile.",
    ["-"], "§15")
add("m1lm._loadFrames", "_loadFrames(data)",
    "A saved lattice's frames added parents first — a missing parent minted along its id (F99) — with their shifts, the root ensured, each shadow linked to its resident where they share a cell, and the spine rebuilt.",
    ["-"], "§15")
add("m1lm.reset", "reset()",
    "Wipes the lattice back to the root frame `0`: the path cache, the retired ids, the frames and the spine.", ["-"], "§15")
add("m1opl._onOp", "_onOp(ev)",
    "Turns document op events into the tick's items: settles, merges and forgets, bake steps, undo and redo, and each fresh op kind with its seq; while replaying only the settles are kept.",
    ["-"], "§15")
add("m1opl._opLevels", "_opLevels(op)",
    "Every frame an op touches now, for an undo or redo entry's `touches` and the snapshots it forces.", ["-"], "§15")
add("m1opl.drain", "drain()",
    "Encodes the tick's items into entries in seq order, with the frames each touches, the forced frames and the full flag, and resets the tick.",
    ["-"], "§15")
add("m1opl.replay", "replay(entries, frameSeq, listed)",
    "Applies stored entries onto the loaded snapshots, the log and the erase pipeline marked as replaying meanwhile (the lineage is derived once, at the end); the settles seen meanwhile are logged after.",
    ["-"], "§15")
add("m1opl._replay", "_replay(entries, frameSeq, listed)",
    "Replays entries idempotently, skipping those whose frames all hold a newer snapshot, and rebuilds the undo and redo stacks and the pending erasers' ops, their targets' lineage from `targets`.",
    ["-"], "§15")
add('m1scc._onEvent', '_onEvent(ev)',
    'A Document event marks the objects it touched dirty and schedules a batch; a reset or a load starts a full restore.',
    ["-"], "§15")
add('m1scc._footprint', '_footprint(markId, step)',
    "A cut by an eraser finer than the ink it cut: the mark's chunks within its reach of the cut shape become a footprint item, hosted by a surviving piece in that frame.",
    ["-"], "§15")
add('m1scc._schedule', '_schedule(delay)',
    'Schedule one tick at idle (`requestIdleCallback`, 1 s timeout), or on a timer where there is none; a tick already scheduled stands.',
    ["-"], "§15")
add('m1scc._takeGone', '_takeGone()',
    'Dirty the ids sent from frames removed since the last batch (one pass over `sent` for them all) and the patches of families that gained or lost an object.',
    ["-"], "§15")
add('m1scc._prepStep', '_prepStep(st, budget)',
    "Turn dirty ids into item records until the budget runs out: gone for what is no longer ink, else home, width, table residual and (when new or re-shaped) chunks with their closed loops' first chunks; true when done.",
    ["-"], "§15")
add('m1scc._frameDiff', '_frameDiff()',
    'The frame records that changed since the last batch, and `gone` for removed frames; remembers what it sent.',
    ["-"], "§15")
add('m1scc._startResync', '_startResync(kind, state)',
    'Start a full restore: forget everything sent and waiting and rebuild the index from the file (`load`), or (`reset`) from the state given, else the last export.',
    ["-"], "§15")
add('m1scc._send', '_send(batch, ids)',
    "Send a batch: inline, applied at once; to the worker, one in flight at a time, tagged with the client's generation.",
    ["-"], "§15")
add("m1rnd.Renderer.constructor", "Renderer.constructor(container, camera, cfg, opts)",
    "Builds the SVG renderer: the arc plans from the arc tolerance and the enter zoom (a length chop only when asked), the live chunk size, the Two.js scene with its world, debug and selection groups, the retained scenes per level and their anchor budget, the window chop, and the dev toggles.",
    ["-"], "§15")
add("m1rnd.addLive", "addLive(o)",
    "Begins the in-progress stroke: a group carrying its opacity holding one live path, in the active level's root; a stale live path is ended first.",
    ["-"], "§15")
add("m1rnd._livePath", "_livePath(color, lw, verts)",
    "A live stroke's open path: its colour and width, round caps and joins, no fill.", ["-"], "§15")
add("m1rnd._freezeLive", "_freezeLive()",
    "Freezes the live path's stable anchors into a chunk of their own and restarts the live path at the last of them, so an event rebuilds only the tail (D-1).",
    ["-"], "§15")
add("m1rnd.setLiveArcs", "setLiveArcs(gaps)",
    "The pen's chain onto the live path: the anchors past its stable part rebuilt from the gaps not yet final (`pushGapAnchors`), relative to the origin; a dot while the stroke has no gap.",
    ["-"], "§15")
add("m1rnd.endLive", "endLive()", "Ends the live stroke: its path and group out of the scene.", ["-"], "§15")
add("m1scc.sceneGeom", "sceneGeom(o)",
    "An object as the index sees it: the width it counts with and its chunk records in stored coordinates, coarsened until there are at most `MAX_CHUNKS`, with each closed loop's first chunk; null for one with no ink.",
    ["-"], "§15")
add("m1sel._beginSelectDrag", "_beginSelectDrag(P, sx, sy)",
    "A select press that has travelled SELECT_DRAG_PX: decides between a lasso and a move and starts it — a move's off-screen tile patching batched, and the members' plate events held until `_endMove`.",
    ["-"], "§15")
add("m1sel.cancelSelectGesture", "cancelSelectGesture(commitIfMoved)",
    "Forgets the select gesture in progress when a pinch starts — a parked select or drag goes with it; a drag that moved is put back, or finished if asked.",
    ["-"], "§15")
add("m1sel._underFrames", "_underFrames(level, frames)",
    "Whether a frame is one of `frames` or under one by its own parent links (`isUnder`): the selection's frame rule, memoised per frame list until the lattice's addresses or frame count change.",
    ["-"], "§15")
add("m1sel._lassoFind", "_lassoFind(poly)",
    "The tree query. Every frame gets one of three answers — out of reach, enclosed (one entry of the selection: the frame, nothing under it read), or straddling (ask its index and recurse). Walks outward from the current frame, because from the root the scale factor would be 4,096^depth before the first useful comparison.",
    ["-"], "§15")
add("m1sel._lassoMoved", "_lassoMoved(poly, box, ink, found, frames)",
    "The lasso's moved natives: each with a displacement table, not found yet, not under a selected frame and reachable from the camera frame, taken when its rect in the active frame lies inside the loop, or when its ink does.",
    ["-"], "§15")
add("m1sel._setSelection", "_setSelection(ids, frames)",
    "Installs ids and frames as the selection — only live ids and frames the lattice still has, and with neither it deselects; the primary member is the first live id, else the first frame — then one table step (`_syncStep`) and status.",
    ["-"], "§15")
add("m1sel._dragSelection", "_dragSelection(sx, sy)",
    "The move, at every pointer event: each member's new home and displacement table from the displacement since the drag started, once per home frame, written in one commit a step (none while the Stage holds the move), and the selected frames re-addressed (`_dragFrames`).",
    ["-"], "§15")
add("m1sel._dragFrames", "_dragFrames(d, camDepth, tx, ty)",
    "One drag step for the frames: re-addresses each from its start address, the sub-cell rest kept as a shift on the frame.", ["-"], "§15")
add("m1sel._selectionMembers", "_selectionMembers()",
    "The selection's ids with their families, once each, less what lies under a selected frame (its frame moves it).", ["-"], "§15")
add("m1sel.deleteSelection", "deleteSelection()",
    "Deletes the selection in one Stage batch: the selected ids with their families removed object by object, each selected frame (not under another) set aside as containers (`removeFrameSubtree`); one undo op; a live drag ended, the selection dropped and a render.",
    ["-"], "§15")
add("m1sel._shapeHit", "_shapeHit(loops, p, slack, o)",
    "Is a point inside a shape's loops, or within `slack` of them (tried at eight points around it)? The inside test is memoised per object and geometry version.",
    ["-"], "§15")
add("m1ts.TileStore.constructor", "TileStore.constructor(levelMap, doc, cfg)",
    "Starts the tile cache, with its per-native tile index and tile listeners, and subscribes to the document, so every change patches the cache.",
    ["-"], "§15")
add("m1ts._dropTile", "_dropTile(key)",
    "The one way a tile leaves the cache: unindexed and reported as a `drop`; false when it was not cached.", ["-"], "§15")
add("m1ts._clearTiles", "_clearTiles()", "Empties the cache and the per-native index, reported as one `clear`.", ["-"], "§15")
add("m1ts.contentOffCamera", "contentOffCamera(F, rect, budgetMs)",
    "`content` for a frame the camera is not at, without unpinning or evicting the camera's own tiles, within a budget (null past it); a warm read keeps the keys it read.",
    ["-"], "§15")
add("m1ts._rerouteGroups", "_rerouteGroups(F)",
    "The moved natives to be read from another frame at F — not in their own frame, not above their home — grouped by source frame and remainder; memoised per offset revision and lattice.",
    ["-"], "§15")
add("m1ts._ensureUp", "_ensureUp(F, i, j)",
    "An up tile: the cached one when its epoch and chain sequence stand, else baked (`_bakeUp`, its parents with it: a budgeted read stops between tiles, never inside a chain), pinned meanwhile, and cached.",
    ["-"], "§15")
add("m1ts._ensureDown", "_ensureDown(F, i, j)",
    "A down tile: the cached one when it stands, else baked (`_bakeDown`) and cached.", ["-"], "§15")
add("m1ts._onFrameEvent", "_onFrameEvent(ev)",
    "A frame moved, was deleted, came back, merged or split: drops every cached tile its footprint touches, at the old address and the new, and a merged frame's own tiles.",
    ["-"], "§15")
add("m1ts._onDoc", "_onDoc(ev)",
    "A document event, patched in: a reset clears the tiles; a frame event goes to `_onFrameEvent`; an object's remove, add or finalize, or a geometry change, patches the cached tiles (a live stroke, an offset-only or attribute-only change touches nothing).",
    ["-"], "§15")
add("m1ts.forgetFrame", "forgetFrame(frame)",
    "The store's side of frame GC: a forgotten frame's tiles dropped with their pins and warm keys, its reroute memo and its chain sequence.",
    ["-"], "§15")
add("m1ts._addObject", "_addObject(o, H)",
    "A new native patched into every live cached tile that inherits it: a down tile where its home is no ancestor and no shallower; an up tile seen through its parent appended directly or as a ring copy (`_upVia`), else re-derived along the chain, shallowest first, when the native reaches it.",
    ["-"], "§15")
add("m1ts._upVia", "_upVia(H, F)",
    "The frame through which frame F's up tiles see a native homed in H: H itself when it is F's ancestor, the ancestor at H's depth when H is in its ring, else null.",
    ["-"], "§15")
add("m1stg.res", "res (getter)", "The translation paint applies: the item's offset, undefined at zero.", ["-"], "§15")
add("m1stg.below", "below (getter)", "The item's piece's displacement table.", ["-"], "§15")
add("m1stg.belowKey", "belowKey(b)", "A displacement table as a string key: each entry's two numbers, `;` between entries.", ["-"], "§15")
add("m1stg.Stage.constructor", "Stage.constructor({doc, lm, store, model, cfg})",
    "Wires the scene to the document, the lattice, the tile cache and the placement model, and subscribes to the document's and the tile cache's events.",
    ["-"], "§15")
add("m1stg.placed", "placed(item)",
    "The one read of where an item is drawn: its geometry and its offset; an input at p reaches it at p − off.", ["-"], "§15")
add("m1stg.placeNative", "placeNative(nat, frameId)",
    "Any native as seen from any frame: a `Placement` with its drawn box there and inputs carried into its stored coordinates and back.",
    ["-"], "§15")
add("m1stg.snapshot", "snapshot(frameId, rect, budgetMs)",
    "A read-only table of another frame or rectangle, built as a rebuild builds the live one and stamped with the G it was read at; null when a tile was not read inside the budget.",
    ["-"], "§15")
add("m1stg.hold", "hold({ids, frames})",
    "A drag begins: the selection's natives and everything under its frames are held, their starting footprints recorded, and the events about them queued until `release`.",
    ["-"], "§15")
add("m1stg.release", "release()",
    "The hold's end — a drop, a cancel or a delete: the queued events applied quietly, then one commit dirtying where the selection started and where it ends.",
    ["-"], "§15")
add("m1stg.sync", "sync(frameId, window, budgetMs)",
    "Makes the table the camera frame's over a window: the frame's natives read first (a pending shift settles and shadows merge on that read, before C1), then, in up to `SYNC_ROUNDS` rounds while that queues events, a crossing rebuilds, a window change adds and drops tiles, and what an event dropped is read again within the budget; one commit when anything changed.",
    ["-"], "§15")
add("m1stg._applyDoc", "_applyDoc(ev, step)",
    "Applies one document event to the table: its footprint as dirt (not on the hold's quiet release), a stroke's pending start and its shape's landing, a frame event's re-diff (a merge or split into the camera frame rebuilds it), and the native marked touched for the commit.",
    ["-"], "§15")
add("m1stg._stateOf", "_stateOf(o, home, rect)",
    "A native's footprint state: its home, its own displacement table and its drawn box in its home's units.", ["-"], "§15")
add("m1stg._footOf", "_footOf(ev, step)",
    "One event's footprint states, before and after: a native's old and new drawn box with its own table, a refile's address either side, an added or removed frame's reach, an erase step's as `_stepOf` classed it; a merged frame's plates dropped.",
    ["-"], "§15")
add("m1stg._grouped", "_grouped(states)",
    "Past 256 states, one union state per (home, own table): natives moved together map as one box.", ["-"], "§15")
add("m1stg._mapState", "_mapState(s, G)",
    "One footprint state in frame G's units: a frame's reach (everywhere when G is under the state's subtree), or a native's box clipped to its erase step's mark.",
    ["-"], "§15")
add("m1stg._families", "_families()",
    "The family rule (PLAN §5.1 Q15): a family whose change flipped its union routing, sign, colour or alpha repaints every item, so its whole box is dirt; an erase step under its mark is exempt.",
    ["-"], "§15")
add("m1stg._reconcile", "_reconcile(id, d, refresh)",
    "One native placed again against the document as it is: its own item (drawn live when homed in the camera's frame), its reroute group, and its offset, paint key and family on every item; the tiles whose items must follow are re-read. A held native is skipped.",
    ["-"], "§15")
add("m1stg._ownDiff", "_ownDiff()",
    "The camera frame's own natives checked again against the document's list for that frame (a frame set aside or put back).", ["-"], "§15")
add("m1stg._addItem", "_addItem(it)",
    "Puts an item in every index — family, piece, native, tile key, home — and in the paint-order list (or the rebuild's batch), logged as added.",
    ["-"], "§15")
add("m1stg.Placement.constructor", "Placement.constructor(stage, nat, F)", "Holds the native and the frame.", ["-"], "§15")
add("m1stg.Placement.box", "Placement.box()",
    "The native's drawn box (its bbox, and half its pen for a stroke) in the frame's units, where its picture is.", ["-"], "§15")
add("m1stg.toStored", "toStored(x) · fromStored(x)",
    "An input made in the frame — a point, a rect or loops — into the native's stored coordinates, and back: the placement inverted on every input.",
    ["-"], "§15")
