# -*- coding: utf-8 -*-
"""Per-function entries for the engine batch: the lattice (LevelMap, TileGrid), the Document,
persist's scene index, the erase pipeline's worker path, the selection indicator's decision,
the file loader's frame mint, and the three erase-job files (eraseJob, eraseDescent,
eraseWorkerClient)."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/LevelMap.js ----
add("lm.LevelMap.constructor", "LevelMap.constructor(cfg, width, height)",
    "Starts a lattice holding only the root frame `0`, with an empty route cache and address epoch 0.",
    ["Keeps `cfg` (the edge constants `frameFactor` reads) and the canvas size (read by `_viewCell`, never by geometry). `frames` maps an id to its frame, `_spine` a depth to the origin chain's frame.",
     "`addrEpoch` is bumped by every re-address; the tile cache keys its stamps on it."],
    "§5")
add("lm.walk", "walk(rootId, fn)",
    "Calls `fn` on every frame a subtree stands for: the root, its shadows, their kids and theirs.",
    ["Depth-first on an explicit stack, in no promised order. Shadows are included because they share their resident's cell and belong to its subtree for the selection and the erase (DESIGN.md §8).",
     "Read by `Document.maxZUnder`, `Document.removeFrameSubtree` and the selection's status count."],
    "§6")
add("lm._adopt", "_adopt(f, p, cell)",
    "Makes a parentless frame cell `cell` of `p`, its edge and centre derived from the cell.",
    ["Wires `p`'s child map and drops the route cache. Used by `_growRoot` and `ensureSpine` when the root gains a parent, and by `merge` when another lattice gave a local root one."],
    "§5")
add("lm.readdress", "readdress(id, parentId, i, j)",
    "Moves one frame to cell (i, j) of a parent one depth up; its id and every descendant's stay as they are.",
    ["Returns the frame, `{ occupied }` when another frame holds that cell, or null for a bad request (wrong depth, a digit out of range). The subtree follows through its parent pointer; the route cache is dropped, `addrEpoch` bumped and the spine rebuilt.",
     "Only the tests call it; a drag re-addresses through `readdressMany`, which makes a shadow instead of refusing an occupied cell."],
    "§6")
add("lm._leave", "_leave(f)",
    "Takes a frame out of its cell: a shadow leaves its resident's set; a resident hands the cell to one of its shadows.",
    ["The shadow that takes the cell inherits the other shadows. The first half of every re-address (`readdress`, `readdressMany`)."],
    "§6")
add("lm._take", "_take(f, p, i, j, empty)",
    "Gives a frame cell (i, j) of `p`, making a shadow when another frame already holds the cell.",
    ["Sets the frame's address (parent, cell, edge, centre), bumps its `addrSeq` and drops its record view. A free cell is taken. A resident with no kids that `empty(id)` reports as holding nothing yields the cell and becomes the newcomer's shadow, its own shadows with it; any other resident keeps the cell and the newcomer shadows it.",
     "Returns `[shadow, resident]` when a shadow was made, else null. A resident with kids keeps the cell even when its whole subtree is empty (DESIGN.md §8, F80)."],
    "§6")
add("lm.adoptShadow", "adoptShadow(M, E)",
    "The lattice half of merging shadow M into its resident E: M's kids and shadows move under E and M is deleted.",
    ["Each kid of M takes its cell under E, or shadows the child E already has there, its own shadows following. M's shadows become E's. The route cache is dropped, `addrEpoch` bumped and the spine rebuilt.",
     "Returns the record `unadoptShadow` reverses. The natives are moved by `Document._mergeShadows`, which calls this."],
    "§6")
add("lm.unadoptShadow", "unadoptShadow(rec)",
    "Reverses `adoptShadow`: the merged frame comes back as E's shadow, with its kids and shadows under it.",
    ["Rebuilds the frame from the record (address, shift, a bumped `addrSeq`), takes back the shadows it gave E, and walks the kids in reverse, freeing the cells they took or un-shadowing them. Used by `Document.unmerge` on undo."],
    "§6")
add("lm._rebuildSpine", "_rebuildSpine()",
    "Recomputes the origin chain: climbs to the true root, then follows the (0, 0) cells down.",
    ["Called after every re-address, merge and load, because `_spine`, not a frame's id, says which frame is the origin at a depth. It climbs first because `merge` can give the recorded root a parent without updating `_rootId`."],
    "§5")
add("lm.subtreeStart", "subtreeStart(rootId, atDepth)",
    "Records a subtree's addresses at a drag's start, down to three levels below the camera's depth.",
    ["Returns id -> `{ parent, i, j, depth }` for the root, its shadows and every descendant to `atDepth + 3`; deeper frames take zero digits from any displacement, so the walk stops there.",
     "Every target of the drag is computed from this one record, never from the current addresses, which is what makes a slow drag land where a fast one does (DESIGN.md §8)."],
    "§6")
add("lm.moveSubtreeTargets", "moveSubtreeTargets(rootId, atDepth, dx, dy, start)",
    "Where every frame of a moving subtree ends up, by `displaceFrame`'s digit arithmetic on the start addresses.",
    ["For each frame, coarsest first: its start chain up to the frame at the camera's depth, the displacement expanded into base-R digits and added with carries, a coarse carry taken by the anchor's neighbour, then the chain resolved from the anchor down. A step a mover is headed for resolves to that mover; any other is found or minted in the live lattice.",
     "Returns one entry per frame, `{ id, depth, parent, i, j, rest }` or `{ id, why }`, deepest first. `rest` is the sub-cell remainder in the frame's own units, non-zero only one and two levels below the camera.",
     "A native under these frames lands exactly where the per-object path would put it; `move.subtree.test.js` checks it native for native."],
    "§6")
add("lm.readdressMany", "readdressMany(targets, opts)",
    "Applies a subtree move in two phases: every mover leaves its cell, then each takes its target, coarsest first.",
    ["Two phases so movers never collide with one another; coarsest first so a moving parent holds its new cell before its children ask who holds theirs. An occupied target makes a shadow (`_take`), the resident yielding when `opts.empty(id)` says it holds nothing.",
     "Returns `{ moved, shadowed: [{ id, of }] }`; drops the route cache, bumps `addrEpoch` and rebuilds the spine. Used by the drag and by the undo of `moveFrames`."],
    "§6")
add("lm.merge", "merge(data)",
    "Adds the frames another lattice minted, given in `serialize()`'s shape, parents first (F67).",
    ["A worker's descent runs on a copy of the lattice, and a kid it homes a cell over from any visited frame names a frame this lattice has never seen. Frames are added in depth order; one already here is left alone unless it was a root the other lattice gave a parent, which it adopts; one whose parent is missing is skipped.",
     "Returns how many were added. `_applyDescent` calls it before minting a kid."],
    "§6")
add("lm.ensureId", "ensureId(id)",
    "The frame an id names, minted along its birth chain when missing; null for an id no frame can have (F67).",
    ["Parses `<depth>/i,j/...`, grows the spine to the depth, then walks `cellChild` down the segments. Returns null unless the frame reached carries exactly that id, so a `#n` twin id, or a cell now held by a frame with another id, is not minted.",
     "Called for every frame key a loaded file's natives name, before the natives are added (`Files._mintNamedFrames`)."],
    "§13")
add("lm.isUnder", "isUnder(aId, bId)",
    "Is frame b what frame a stands for in a selection: a itself, a descendant, or a shadow of either?",
    ["Walks up from b, true at a frame that is a or shadows a. Tiles use `isAncestor`, which excludes a itself and knows nothing of shadows (DESIGN.md §10)."],
    "§12")
add("lm.objShift", "objShift(below, homeId, F)",
    "Where a moved object's picture comes from in frame F: the unmoved frame F0 holding its pieces, and the sub-frame remainder.",
    ["The object's table at F's depth (`shiftAt`) is walked back from F's address as negated cell digits with carries, from the frame on F's path at the home's depth; F0 is minted if it was never visited. At or above the home, or with no cell digits, F0 is F and only `rem` applies.",
     "F0's pieces are drawn in F translated by `rem` (`piece.res`), and an input made in F is translated back by it before it reaches the geometry (DESIGN.md §8, F55). Returns `{ F0, rem, sh }`, or null when the chain cannot be formed."],
    "§6")
add("lm.frameShifted", "frameShifted(F0, hd, sh)",
    "The inverse of `objShift`: the frame at F0's depth where a picture read from F0 is drawn.",
    ["Adds the table's cell digits and carry to F0's address. Nothing calls it."],
    "§6")
add("lm._homeToX", "_homeToX(fromId, toId, homeId, toHome)",
    "Decides which way an object-table mapping runs: out from the home to a view, or back into the home.",
    ["True when `fromId` is the home, unless both ends are the home and the caller passed `toHome`: an input made in the object's own frame names the direction itself (F72)."],
    "§6")
add("lm.mapPointObj", "mapPointObj(p, fromId, toId, below, homeId, toHome)",
    "`mapPointF` between an object's home and a frame where its picture is seen, through its displacement table.",
    ["Home to X: the exact chain to X's unmoved frame F0, then plus the remainder, which is the point as drawn in X. X to home: the remainder off first, then the exact chain back from F0, which is what an input in X means in the stored coordinates.",
     "With no table it is `mapPointF`, bit for bit (DESIGN.md §8, F55)."],
    "§6")
add("lm.mapRectObj", "mapRectObj(rect, fromId, toId, below, homeId, toHome)",
    "A rect through an object's displacement table: two corners by `mapPointObj`, re-normalised.",
    ["Exact as a rect, because every hop and the remainder are a uniform scale plus a translation. Every rect that reaches a moved object's geometry goes through it: an eraser's box, a selection box, a seam window (F68-F72)."],
    "§6")
add("lm.projectLoops", "projectLoops(loops, fromId, toId)",
    "Arc loops carried across frames one edge at a time: what `projectF` does to a shape, without the tile phase.",
    ["Up an edge: scale by 1/R and add the cell centre; down: subtract the centre, then scale by R (`transformLoopsAbout`), so an arc stays an arc. Null when the two frames share no ancestor. Called by `projectLoopsObj`."],
    "§5")
add("lm.projectLoopsObj", "projectLoopsObj(loops, fromId, toId, below, homeId, toHome)",
    "Loops through an object's displacement table: how an eraser reaches the coordinates a moved object is stored in.",
    ["`mapPointObj` for whole loops: the exact chain to or from the unmoved frame, with the remainder as a translation on the frame's side. With no table it is `projectLoops`.",
     "The erase passes `toHome` (`_eraserLoopsInto`), so a mark drawn in the object's own frame still comes back through the remainder (F72)."],
    "§10")

# ---- src/engine/Document.js ----
add("doc.flattenLoops", "flattenLoops(o)",
    "Turns a shape's plain piece-array loops into stored Loops, in place, at the door of the document.",
    ["Every way a shape enters or changes in the document calls it (`add`, `insertAt`, the geometry edits, `insertFrameSubtree`); builders hand over piece arrays and never see them again (DESIGN.md §3). A loop that already is a Loop is left as it is.",
     "Not `curveOutline.flattenLoops`, which flattens arcs to polygons."],
    "§7")
add("doc.nativeFromRecord", "nativeFromRecord(o)",
    "A stored record, kobin-1 JSON or a kobin-2 span, as a live native: retired fields stripped, the table decoded, damaged loops repaired.",
    ["Drops `windows`, `srcId` and `paths`; decodes `below`, dropping a malformed one rather than refusing; keeps header fields this build does not know as `_extra` so they are written back. A well-formed encoding is wrapped as Loops with no copy; only a damaged one is decoded, repaired and rebuilt.",
     "A fill stays a fill; `fillToShapeById` converts one when something cuts it. Used by `loadNatives` and the op log's replay."],
    "§13")
add("doc._noteBelow", "_noteBelow(o)",
    "Keeps the set of moved objects (`_offsetIds`) in step with one object's displacement table.",
    ["An object with a non-empty table is added; one without is removed and its empty `below` key deleted. Called wherever a table can change or an object enters."],
    "§6")
add("doc.hasOffsets", "hasOffsets()",
    "Does any native carry a displacement table? O(1), asked by the tile store on every bake.",
    ["-"], "§6")
add("doc.offsetIds", "offsetIds()",
    "The ids of every native with a displacement table, for the scans that must judge moved objects where their picture is.",
    ["The live set, not a copy. The tile store's reroute, the lasso's moved-object pass and the report read it; the erase's candidate scan reads `_offsetIds` directly."],
    "§6")
add("doc.subscribeOps", "subscribeOps(fn)",
    "Subscribes to the op channel: what the user did, as opposed to the change events' what moved on screen.",
    ["Carries every fresh undo op, every bake step appended to one, every undo and redo, every settle and every shadow merge, in order. The op log (the saver), the scene client and the editor hook subscribe. Returns the unsubscribe function."],
    "§13")
add("doc._notifyOps", "_notifyOps(ev)",
    "Sends one op-channel event to every op subscriber.",
    ["-"], "§13")
add("doc.recordBake", "recordBake(op, step)",
    "Appends a bake step to a gesture's eraseCommit op and announces it on the op channel; the one way steps are appended.",
    ["A step is `{ removed, pieces }`, `{ rekey }` or `{ frames }`; undo runs them newest first. The announcement is what puts the step in the op log."],
    "§10")
add("doc.noteId", "noteId(id)",
    "Keeps the id counter above an id a replayed log entry brought in, so no id is handed out twice.",
    ["-"], "§13")
add("doc.noteRefile", "noteRefile(frameId, from, to)",
    "Announces that a subtree move re-addressed a frame, so the tile cache can re-file its tiles.",
    ["Emits a `refile` change event with the old and new `{ parent, i, j }`. No native changes."],
    "§6")
add("doc.keysChanged", "keysChanged()",
    "Marks the family index stale after an editId changed in place, and bumps the revision.",
    ["Emits no change event: a re-key moves no ink. Severance and its undo call it."],
    "§12")
add("doc.count", "count(level)",
    "A frame's native count as stored, with no shadow merged and no shift settled.",
    ["For scans that only need a number (the selection's status, the tile store, the report); `at` would pay a settle on every frame it counted (DESIGN.md §8)."],
    "§6")
add("doc.list", "list(level)",
    "A frame's list as stored, for scans that need identity or flags only; never for positions.",
    ["No shadow merged and no shift settled, so a walk over every frame does no per-native work on frames nobody has looked at. The erase's mark and family scans, the overlays and the report read it (DESIGN.md §8)."],
    "§6")
add("doc._settleIfPending", "_settleIfPending(level, arr)",
    "Applies a frame's pending shift to every native it holds, once, as the per-object path would have.",
    ["The shift is the k = 0 table entry every native of a frame moved as a frame owes. It is cleared first (a re-home below re-enters here), added to each native's table with `addOffset`, and a native whose entry carried a whole cell is re-homed to the neighbour.",
     "The record `{ dx, dy, tables, carries }` goes on the move entry that placed the frame (`noteFrameOwner`) for undo, and to the op channel, where its result tables make a replay idempotent. `at`, `add`, `insertAt`, `removeById` and the re-homes call it first (DESIGN.md §8)."],
    "§6")
add("doc.setFrameShift", "setFrameShift(frameId, shift)",
    "Sets the shift a frame's natives owe after a subtree move; a zero shift clears it.",
    ["Nothing is applied here; the first read of the frame's list settles it (`_settleIfPending`)."],
    "§6")
add("doc.noteFrameOwner", "noteFrameOwner(frameId, entry)",
    "Records which move-op entry last placed a frame, so a later settle or merge of it lands on that entry; null forgets.",
    ["-"], "§6")
add("doc.unsettle", "unsettle(frameId, settled)",
    "Reverses a recorded settle from its result tables; a native the settle carried to a neighbour comes home.",
    ["Idempotent, because it works from the recorded results. Outside an undo (the next step of a drag, a cancelled drag) the restored tables go to the op log as a settle of their own."],
    "§6")
add("doc.applySettle", "applySettle(frameId, rec)",
    "Replays a logged settle: the homes and tables it recorded, set as they are.",
    ["Re-homes a carried native to the frame the record names, then sets its table (`setOffsetsById`). Idempotent. Called by the op log's replay."],
    "§13")
add("doc._mergeShadows", "_mergeShadows(E)",
    "Merges every shadow of resident frame E into it: natives appended to E's list, kids re-parented, the shadow deleted.",
    ["For each shadow not set aside by a delete: both frames' pending shifts settled, the shadow's natives appended to E's list and index with E as home, then `LevelMap.adoptShadow`. O(the shadow's natives), paid at the first `at` of E, and held while a drag is in progress (`holdMerges`).",
     "The record goes on the move entry that made the pair, for `unmerge`, and to the op channel (DESIGN.md §8)."],
    "§6")
add("doc.detachFrame", "detachFrame(frame)",
    "Sets one frame's list and index aside, as a subtree delete does; its natives stay in `_byId`, unreadable.",
    ["The redo of a subtree delete or of a frame-covering erase step, and the op log's replay of them. `getById` answers null for a native of a detached frame."],
    "§12")
add("doc.mergeReplay", "mergeReplay(rec)",
    "Replays a logged shadow merge on the natives: the record's ids re-homed into the resident.",
    ["Idempotent from wherever a snapshot left them; the shadow's empty list is forgotten. The lattice needs nothing: the logged lattice already holds the result (DESIGN.md §13)."],
    "§13")
add("doc.unmergeReplay", "unmergeReplay(rec)",
    "Replays the undo of a logged merge: the record's ids re-homed back into the shadow frame.",
    ["-"], "§13")
add("doc.unmerge", "unmerge(rec)",
    "Reverses one shadow merge on undo: the frame back as a shadow, its natives back in their own list.",
    ["`LevelMap.unadoptShadow` restores the frame; the record's natives are compacted out of the resident's list into the shadow's, re-indexed and re-homed, and a `splitFrame` event is emitted."],
    "§6")
add("doc.maxZUnder", "maxZUnder(rootId)",
    "An upper bound on the z of everything under a frame subtree: the erase's test for taking a frame whole.",
    ["The largest `maxZ` of the subtree's indexes (which only grow) and the z of any pending stroke homed there. `maxZUnder(F) < z` means nothing under F is drawn above z (DESIGN.md §7)."],
    "§10")
add("doc.setZById", "setZById(id, z)",
    "Changes one object's z alone; the eraser mark's z steps down this way as its bake proceeds.",
    ["Raises the frame index's `maxZ` bound if needed and emits a `change` with `attrOnly`, which the tile store ignores; the next render re-sorts. Returns the previous z (DESIGN.md §7)."],
    "§10")
add("doc.setOffsetsById", "setOffsetsById(id, below)",
    "A move: replaces an object's displacement table and touches no coordinate.",
    ["No cache is stale, so nothing is re-indexed; the `change` event says `offsetsOnly`, and the picture is read from the unmoved tiles at its new address on the next render (DESIGN.md §8, F55)."],
    "§6")
add("doc.rehomeManyById", "rehomeManyById(ids, toLevel)",
    "`rehomeById` for many natives at once: each source list compacted in one pass instead of spliced per object.",
    ["Every frame it touches is settled before the groups are formed, because a settle's carry can re-home a native. Ends in the same lists, indexes and events as one `rehomeById` per id; only the events' interleaving differs. Returns how many moved.",
     "The per-object splice made a whole-frame drag quadratic in the list's length (DESIGN.md §8)."],
    "§6")
add("doc.removeFrameSubtree", "removeFrameSubtree(rootId)",
    "Sets a frame subtree aside by reference: each frame's list and index detached, with no per-object work.",
    ["Returns the records `{ frame, natives, index }` the op holds, or null when no frame under the root has a list. The delete of a selected frame and the frame-covering erase use it; O(frames) (DESIGN.md §7, §10)."],
    "§12")
add("doc.insertFrameSubtree", "insertFrameSubtree(records)",
    "Puts set-aside frame lists and indexes back by reference: the undo of a subtree delete or a frame-covering erase.",
    ["A record rebuilt from the op log has no index; its natives are registered, homed and indexed here."],
    "§12")
add("doc.frameExtent", "frameExtent(level)",
    "What a frame holds, as a bound: the union box with line width and the largest object size, pending strokes included.",
    ["From the index's `ext` and `maxSize`, which only grow. The tile store's down-bake skips a frame whole when the bound is under the cull or off the tile; null for an empty frame."],
    "§9")
add("doc._carrySeq", "_carrySeq(op, inv)",
    "Copies an op's log seq onto its inverse, so a redo is a log entry rather than a reset (F71).",
    ["-"], "§13")

# ---- src/engine/persist.js ----
add("per.finite", "finite(v)",
    "A finite-number test for the scene index's fields.",
    ["The same test as `isFiniteNum` in this file."], "§13")
add("per.decodeSceneIndex", "decodeSceneIndex(si)",
    "Reads the scene index's saved state leniently: malformed entries dropped, a malformed whole read as no index.",
    ["Version 3 only. Keeps scenes with a valid id, name, anchor frame key and member string; tombstones (the last 256) with a valid rect; integer dirty ids; erase footprints whose raw numbers come in fives.",
     "Null for a missing or wrong-version index, and the load builds one afresh (DESIGN.md §11)."],
    "§14")

# ---- src/engine/frameLattice.js ----
add("fl.TileGrid", "TileGrid",
    "One value type for the three W-wide partitions: a frame's own square, an object's tile grid, and the cache's squares.",
    ["A grid is its phase `(px, py)`: an object's is `TileGrid.at(o.tile)`, the cache's is `TileGrid.CACHE` (phase 0), and a frame's own square is that grid's (0, 0). Squares are centred on their index.",
     "Two range rules, named: `range` is half-open (the chop and the cede cut on it), `touching` is closed (the cache reads by it). Each keeps its callers' arithmetic to the bit, because a saved drawing's deep picture depends on both (DESIGN.md §2)."],
    "§8")
add("fl.TileGrid.constructor", "TileGrid.constructor(px, py)",
    "A grid with phase (px, py); callers use `TileGrid.at`, so a zero phase is the shared cache grid.",
    ["-"], "§8")
add("fl.at", "at(phase)",
    "The grid with an object's phase, or the shared cache grid when the phase is absent or zero.",
    ["-"], "§8")
add("fl.rect", "rect(i, j)",
    "Square (i, j): [p + iW - W/2, p + iW + W/2) on each axis, centred on its index.",
    ["-"], "§8")
add("fl.range", "range(rect)",
    "Every square a rect reaches, half-open: a rect ending exactly on a boundary belongs to the square below.",
    ["The rule the chop and the cede cut on. Rounding both ends the same way turns one square into three per axis, nine times the area clipped per square: measured, a level-1 render went from 49 ms to 258 ms."],
    "§8")
add("fl.touching", "touching(rect)",
    "Every square a rect touches, boundaries included: the cache's read rule.",
    ["A window ending on a boundary reads the square above it too. `TileStore.content`, a child square's pre-image and `LevelMap.tileRange` read with it; for a single point it agrees with `range`."],
    "§9")
add("fl.span", "span(cells)",
    "The rect a window of whole squares spans, so its boundary is grid lines and nothing else.",
    ["What geometry is clipped to: every cut in the engine lands on a line of the object's own grid, so two tiles holding the same stretch of curve hold bit-identical pieces of it."],
    "§8")
add("fl.child", "child(c, f)",
    "The same grid one level down, through the edge with centre `c` and factor `f`.",
    ["`childTilePhase` on each axis. The grids nest, so the decomposition is a fixed property of the object at every level."],
    "§8")

# ---- src/engine/erasePipeline.js (mixed onto KobinEngine; `this` is the engine) ----
add("erp._candidatesUnder", "_candidatesUnder(Erec)",
    "The objects still to handle under a mark, top-down by z, from the spatial index; cached on the mark.",
    ["For every level with a route to the mark's frame, that level's index is queried with the mark's box mapped there; every reachable moved object is added too, since it is indexed at its stored bits and drawn elsewhere. Marks, handled ids and anything at or above the mark's z are skipped; the list is sorted by z, then id, highest first.",
     "Cached on the mark (`_zScan`) with a cursor, rebuilt when the document's revision or the mark's z changes. Each candidate is checked again when its turn comes (DESIGN.md §7)."],
    "§10")
add("erp._eraseFramesPass", "_eraseFramesPass(Erec)",
    "Before a mark's first target: takes whole the frames its ink covers and that hold nothing drawn above it.",
    ["Walks frames as the lasso does, out from the mark's frame one hop at a time, skipping a subtree whose box misses the mark. A frame other than the mark's own is taken when its cell grown by the content's reach (invariant 2) and the flatten tolerance lies inside the mark's ink (a corner inside, no flattened chord touching it) and `Document.maxZUnder` is below the mark's z; a taken frame is not descended into.",
     "Each subtree is set aside by reference (`removeFrameSubtree`) as one `{ frames }` bake step on the gesture's op, with a journal note; no cut. Runs once per mark per session (`_framesPassed`); after a reload it runs again and finds the frames already gone. Returns how many went (DESIGN.md §7)."],
    "§10")
add("erp._lowerMark", "_lowerMark(Erec, target)",
    "Steps a mark's z to just below the object it has handled, unless the next target shares that z; returns the next target.",
    ["The target may have been cut, refused or grazed. Pieces a cut mints inherit their parent's z and so sit above the mark: the white mark paints only over ink still to be cut, and the move gate is the z order (DESIGN.md §7). Called by the tick, by `_onCutResult`, and by the barrier (`_flushErasesFor`) only when it baked the mark's next target in the tick's order.",
     "The z change runs inside `_neutral`. The raster engine untags it when the step passes a target the mark's `_uncutOf` set still holds whole (refused over ink, or its cut not landed), since that ink comes out from under the mark (F90); a graze or an inkless descent refusal is not held (F109)."],
    "§10")
add("erp._neutral", "_neutral(fn)",
    "Runs `fn` with the picture-neutral flag set, so the document events it raises leave the raster plates as they are.",
    ["For the edits that change no pixel: a cut or a descent under the mark's white, which already paints what goes, and the mark's step down (DESIGN.md §7). The raster engine's document subscriber tags events raised under the flag `neutral` and the plate cache keeps its plates; the spent mark's removal stales them once (OPEN-FLAGS F90).",
     "The subscriber untags a mark's step that passes a target its `_uncutOf` set still holds whole. The previous flag is restored afterwards, so calls nest."],
    "§9")
add("erp._neutralUnder", "_neutralUnder(E, o, fn)",
    "Runs `fn` picture-neutral only while mark E is still above target `o` in z; otherwise plainly.",
    ["A cut or descent is hidden by the mark's white only while the mark is above the target; below it, the change is on screen and the plates must be re-rastered. `_applyCut` and `_applyDescent` wrap their document edits in it."],
    "§9")
add("erp._uncutOf", "_uncutOf(markId)",
    "The targets a mark has handled and left whole with ink under it (refused, or a cut not yet landed), created on first use.",
    ["`_bakeOne` adds each target; a landed cut, removal or descent takes it out, and so do a graze and a descent refused `inkless` (F109). The raster engine's document subscriber reads it: a neutral step of the mark that passes a target still in the set is untagged, because it uncovers that ink, and the target leaves the set. The subscriber drops a mark's set when the mark is removed and every set on a reset (F90)."],
    "§9")
add("erp._eraserRectInto", "_eraserRectInto(rect, HE, o, HO)",
    "A mark's rect, drawn in frame HE, in the coordinates object `o` is stored in at its home HO.",
    ["With no table it is `mapRectF`, bit for bit; a moved object's table is undone on the way in (`LevelMap.mapRectObj` with `toHome`). The erase prefilter's box goes through it."],
    "§10")
add("erp._eraserLoopsInto", "_eraserLoopsInto(loops, HE, o, HO)",
    "The mark's loops in the coordinates object `o` is stored in: the clip of an in-place cut.",
    ["`LevelMap.projectLoopsObj` with `toHome`: the exact chain, through the object's table when it has one."],
    "§10")
add("erp._onCutResult", "_onCutResult(inflight, r, err)",
    "Lands a worker's cut or descent: dropped when stale, run again inline on failure, else applied.",
    ["Ignored when the job in flight has been replaced: a load, a reset, or `_settleInflight` landing it first. Dropped when the mark is gone, the target is gone or replaced, or the target changed meanwhile (`_ver`); a changed target, and one whose mark an undo took, leave the mark's done set, so the next tick or the redo bakes them. A worker error or empty result runs the same job inline (`cutJob` or `descentJob`).",
     "Then `_applyCut` or `_applyDescent`, timed as `cutApply` or `descentApply` with the worker's round trip; the mark steps down, the engine renders and the tick is rescheduled. One job is in flight at a time (`_cutInflight`)."],
    "§10")
add("erp._settleInflight", "_settleInflight()",
    "Runs the job in the worker here and now, for a barrier that cannot wait, and lands it; the worker's late answer is ignored.",
    ["The inline result goes through `_onCutResult`, the same staleness checks and apply as a worker's; that clears `_cutInflight` first, so the worker's reply finds itself superseded. Returns false when nothing is in flight.",
     "Called by `_flushErasesFor` (the mark's cut on another object must land before the mark steps past this one) and by `flushErases` (a mark with its last cut in flight looks spent)."],
    "§10")
add("erp._applyCut", "_applyCut(Erec, target, r, ctx)",
    "The document side of one cut: `cutJob`'s verdict applied and recorded on the gesture's op.",
    ["Nothing if the mark or the target has gone. Adds the seal and dust tallies; a graze changes nothing and takes the target out of the mark's `_uncutOf` set (no ink under the mark, F109). A cut replaces the target with the surviving regions (`eraseReplaceById`) and puts the pieces in the done set; a removal takes the target out. Each is one bake step, with a journal note.",
     "The replacement or removal runs inside `_neutralUnder`, so while the mark is above the target the raster plates are kept (its white already paints what went); the target then leaves the mark's `_uncutOf` set, so the mark's step past it is neutral too (F90).",
     "A cut that left several regions inside a multi-level family asks `_resplitFamily` whether the object came apart. Returns true when the document changed."],
    "§10")
add("erp._descentWorld", "_descentWorld()",
    "What a descent job reads from the engine: the lattice, the config, the canvas width and the opacity groups.",
    ["The world `eraseDescent.descentJob` runs in on the main thread; the worker gets the same fields with the lattice serialised. Tests replace it to watch or fault the square ink."],
    "§10")
add("erp._applyDescent", "_applyDescent(Erec, target, r, ctx)",
    "The document side of a descent: the target's family swapped for the one the job built.",
    ["Adds the seal and dust tallies; a refusal is recorded on the gesture's note (`_rehomeBail`), and one the job marks `inkless` takes the target out of the mark's `_uncutOf` set (F109). Nothing if the target was replaced or the mark has gone. The frames the job minted are merged into the lattice first (F67).",
     "Then each step in order: its removed object (the target, or one minted a step earlier) taken out, its parents and kids added with real ids in the job's order, virtual ids mapped as it goes, every piece put in the done set. The swap runs inside `_neutralUnder`: the pieces land where the ink was, so under the mark's white no pixel moves (F90).",
     "The steps go on the op newest last, so undo unwinds the chain bottom up; the target leaves the mark's `_uncutOf` set; then `_resplitFamily` asks whether the family is still one object."],
    "§10")
add("erp._removedArea", "_removedArea(subject, clip)",
    "The area an erase removes, measured as the area of the intersection (F46). Nothing calls it.",
    ["`eraseJob.cutJob` measures the removal the same way inside the job. The intersection's pieces are no longer than the eraser, so its area is exact to the eraser's own ulps where before-minus-after is not."],
    "§10")
add("erp._boolOpts", "_boolOpts()",
    "The boolean's one option, the freeze radius at this engine's tolerance, passed to every cut and descent job.",
    ["So an erase stands in for an arc by its chord exactly where the tile chain would have frozen it, and nowhere else (DESIGN.md §5)."],
    "§11")
add("erp._settleLassoErases", "_settleLassoErases(poly)",
    "The erase barrier for a lasso: every pending mark whose box meets the loop's box bakes out before the loop selects.",
    ["Returns at once when no mark is pending. A raw mark is resolved first (a mark has no box until it has a shape); each mark's box is mapped into the camera's frame and compared with the loop's; the marks that meet it are baked to completion, their targets anywhere, and consumed (`flushErases` with their ids).",
     "Synchronous: the lasso waits for the bake, then selects the cut-outs (`_applyLasso`). Returns true when a mark was baked."],
    "§12")

# ---- src/engine/overlays.js (mixed onto KobinEngine; `this` is the engine) ----
add("ovl.mergeClose", "mergeClose(rects, gap)",
    "Unions rects lying within `gap` of each other, so several specks on one pixel become one dot.",
    ["One greedy pass: each rect grows the first kept rect it is near, or is kept. Used on the dots of selected objects too small to trace (F73), with a 2 px gap."],
    "§12")
add("ovl.clipRect", "clipRect(r)",
    "A clip or attach rect as `{ rect, eps }` for the ants' seam test, the tolerance from `rectTol`.",
    ["-"], "§12")
add("ovl.asLTRB", "asLTRB(r)",
    "A rect in either spelling, as left/top/right/bottom.",
    ["An `x0/y0/x1/y1` rect is converted; any other is returned as it is. `eraseDescent.asLTRB` is the same one-liner."],
    "")
add("ovl._selTable", "_selTable(s)",
    "The selection's members grouped by frame, with each frame's union boxes, one per displacement table (F68).",
    ["Each selected id expands to its family, erased marks dropped, each object once. A member of a family spanning several frames is listed but adds no box: it is drawn through its pieces. A selected frame is one box, its own cell, and its natives are never read.",
     "Returns `{ byLevel, ids, levelOf, cross, frames, count }`, cached against the selection object and the document's revision."],
    "§12")
add("ovl._selFrameRect", "_selFrameRect(info, L, F)",
    "Where a frame's selected members are drawn, as one rect in the active frame's units.",
    ["The union of the frame's boxes, each mapped through its members' displacement table (`mapRectObj`) or exactly; null when none reaches F. The frame-dot decision reads it (F68)."],
    "§12")
add("ovl._selDecide", "_selDecide(s, table)",
    "Decides the ants: which frames are one dot, and which pieces of the render list get runs, in retained coordinates.",
    ["A frame whose selected content is under 2 px on screen is one dot and none of its members is visited. Every other selected piece in `_lastList` (its own id, or homed under a selected frame) is traced: its loops, shifted by `piece.res`, cut into runs at its seam rects, clipped to the retained window, runs under half a pixel dropped. A member too small to trace, under 8 px, is a dot where its picture is; dots on one pixel merge (F73).",
     "Kept for the whole of a drag; otherwise reused while the list, selection, revision, frame and origin stand, the view is inside the retained window and the zoom is within 1.25x of the decision's. The SVG renderer gets path strings (`runPathData`), the canvas painter the pieces themselves (DESIGN.md §10)."],
    "§12")
add("ovl._selPieceLoops", "_selPieceLoops(piece)",
    "A render-list piece as loops of arcs and lines: the geometry its ink is drawn from.",
    ["A shape's own loops; a fill's rings as line loops; a stroke's capsule outline, as the renderer draws it. Cached on the piece against the array it was made from, because a native in the list is the document's own object and an edit replaces its loops."],
    "§12")
add("ovl._selSeamRects", "_selSeamRects(piece, table, F, cache)",
    "The rects a piece may have been cut on, its own clip and its family's attach windows, where the piece is drawn.",
    ["A straight run lying along one is a seam and gets no ants: both 'no ants on a tile edge' and the F37 join rule. Family windows are mapped into F through each member's table (`mapRectObj`) or exactly and shifted by the piece's residual; cached per piece id, with the piece's own clip added on each call."],
    "§12")
add("ovl._selEdges", "_selEdges(dec, off)",
    "Where the selected ink meets the sides of the screen, recomputed on every step as the view moves.",
    ["Only pieces straddling the view are scanned (`edgeSpans`), the view shifted back by a drag's offset. Spans become screen coordinates, merge across 1.5 px gaps, drop under 2 px, and take a chevron from a fifth of their side. Returns `{ list, covered }`; a selection wholly in view gives none."],
    "§12")

# ---- src/engine/files.js (mixed onto KobinEngine; `this` is the engine) ----
add("fil._mintNamedFrames", "_mintNamedFrames(natives)",
    "Mints every frame a loaded file's natives name, before the natives are added (F67).",
    ["`LevelMap.ensureId` per frame key, so no native is homed in a frame the lattice lacks. `loadSnapshot` and `loadDrawing` call it after the lattice loads."],
    "§13")

# ---- src/engine/eraseJob.js ----
add("ejb.dustBarFor", "dustBarFor(bakePx, f)",
    "The dust bar: a quarter pixel at the zoom the mark was drawn at, in the subject's units.",
    ["`DUST_PX / bakePx`, scaled by `f` (the mark's units into the subject's). Undefined when the mark recorded no zoom, and then the pen rule decides (DESIGN.md §7, F66)."],
    "§10")
add("ejb.cutJob", "cutJob(j)",
    "The geometry of one cut: the boolean, the removal measured locally, the graze rule, the components and the dust cull.",
    ["Subtracts the clip from the subject and measures what went as the area of subject ∩ clip (F46). Graze rule `cut` refuses a removal at or under the smaller of 1e-4·rE² and 1e-6 of the subject's area; `cede` refuses under 1e-4·rE² alone, rE being half the eraser's box. Then the result's components, less dust (`dropDust` against the pen and `dustBar`).",
     "Returns `{ kind: grazed | removed | cut, regions?, stats, removed, dust }`, regions as Loops. Imports geometry only and touches no document: the same function runs on the main thread, in the erase worker, and in a descent's last link (DESIGN.md §7)."],
    "§10")
add("ejb.own", "own(l)",
    "A loop as a copied `{ buf, idx }` pair, ready to transfer to a worker; the caller's Loop stays usable.",
    ["-"], "")
add("ejb.wrap", "wrap(x)",
    "A transferred `{ buf, idx }` pair as a Loop again.",
    ["-"], "")
add("ejb.wireJob", "wireJob(j)",
    "A cut job as a worker message plus the buffers to transfer: copies, so the document keeps its own.",
    ["-"], "§10")
add("ejb.unwireJob", "unwireJob(m)",
    "A cut job back from a message, its loops wrapped as Loops.",
    ["-"], "§10")
add("ejb.wireResult", "wireResult(r)",
    "A cut result as a message; a cut's regions are transferred, not copied, since nothing else holds them.",
    ["-"], "§10")
add("ejb.unwireResult", "unwireResult(m)",
    "A cut result back from a message, a cut's regions wrapped as Loops.",
    ["-"], "§10")

# ---- src/engine/eraseDescent.js ----
add("eds.asLTRB", "asLTRB(r)",
    "A rect in either spelling, as left/top/right/bottom.",
    ["The same one-liner as `overlays.asLTRB`."], "")
add("eds.VirtualDoc", "VirtualDoc",
    "The objects a descent reads and mints, kept apart from the document.",
    ["The target is its one real object; everything a virtual cede mints takes a negative id. Implements the few `Document` calls the descent needs (`getById`, `add`, `removeById`, `editKey`) with the same record shape."],
    "§10")
add("eds.VirtualDoc.constructor", "VirtualDoc.constructor(seed)",
    "Seeds the virtual document with `{ obj, level }` records, the level as a string; virtual ids start at -1.",
    ["-"], "§10")
add("eds.allocId", "allocId()",
    "The next virtual id, -1, -2, ..., so a virtual object can never be taken for a real one.",
    ["-"], "§10")
add("eds.getById", "getById(id)",
    "A virtual record `{ obj, level }` by id, or null.",
    ["-"], "§10")
add("eds.add", "add(obj, level)",
    "Puts an object in the virtual document at a frame; returns the object.",
    ["-"], "§10")
add("eds.removeById", "removeById(id)",
    "Takes an object out of the virtual document; returns its record, or null.",
    ["-"], "§10")
add("eds.editKey", "editKey(o)",
    "An object's family key: its editId, else its id, as `Document.editKey` has it.",
    ["-"], "§10")
add("eds.squareInkOf", "squareInkOf(world, vdoc, id, F, i, j)",
    "The tile store's piece for one object in square (i, j) of frame F, derived from the level above as the store derives it.",
    ["Runs `classifyUp`, then `solidQuad` or `deriveStep`, on the one object and on the same numbers `TileStore._bakeUp` uses, so the kid a cede mints is the store's piece bit for bit (F42). An object homed in a cell around the parent is first projected into the parent's coordinates, if its box meets the square's pre-image.",
     "Returns `{ loops, clip, tile }` (shape loops, or a covering fill's clip as a rect loop), or null when the square holds none of the object's ink."],
    "§10")
add("eds.cedeVirtual", "cedeVirtual(vdoc, id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts)",
    "`Document.cedeTileById` on the virtual document: the parent's hole cut exactly, remnants and kids minted with virtual ids.",
    ["The hole is subtracted in the parent's own coordinates and the remnant's slivers dropped against the pen. Remnants keep the parent's frame, attach rect, grid phase and table; kids go to `level` with the given window, phase and table (the parent's shifted one level down by default). Every piece keeps the parent's z, colour, opacity, pen and family key.",
     "Returns `{ removed, parents, kids, pieces }`, or null for a missing or non-shape object."],
    "§10")
add("eds.descentJob", "descentJob(world, input)",
    "The whole rehome descent for one target, on a virtual document: every cede down to the erase level, then the last link's cut.",
    ["Refuses unless the route from the target's frame to the mark's is a pure descent. At each crossing, for each object the step above minted: the frame F0 holding its picture (through its table), the eraser's box grown by half its size and widened to cover the cell the next crossing enters, and at most a 2x2 block of F0's squares, the square under the box's centre first and alone when its window covers the box. Each square's ink (`squareInkOf`) is ceded into a kid one level down; at the last link the kid is `cutJob`'s result under the `cede` graze rule.",
     "Nothing touches the document. The result is `{ steps, stats, minted }`, each step `{ removedId, parents, kids }`, or `{ refused, stats, inkless }` when no square was ceded or the last link refused, so a refusal needs no unwinding. `inkless` says the link it stopped at found none of the target's ink near the eraser (none, dust or a graze) and read every square it needed: the engine's mark then holds nothing whole there (F109). `minted` lists the frames the job added or re-parented on the lattice it ran on (F67). The same function runs on the main thread and in the erase worker (DESIGN.md §7)."],
    "§10")
add("eds.own", "own(l)",
    "A loop as a copied `{ buf, idx }` pair, ready to transfer; the caller's Loop stays usable.",
    ["The same helper as `eraseJob`'s `own`."], "")
add("eds.wrap", "wrap(x)",
    "A transferred `{ buf, idx }` pair as a Loop again.",
    ["-"], "")
add("eds.objOut", "objOut(o, transfer)",
    "An object copied for a worker message: runtime fields dropped, its loops copied into buffers pushed onto `transfer`.",
    ["Drops `_bbox`, `_home`, `_ver` and `_zScan`."], "")
add("eds.objIn", "objIn(o)",
    "An object back from a message, its loops wrapped as Loops.",
    ["-"], "")
add("eds.wireDescent", "wireDescent(world, input)",
    "A descent job as a worker message: the target and the eraser copied, the lattice as `LevelMap.serialize()`.",
    ["Carries the canvas size, config, opacity groups, freeze radius and the mark's frame beside them; the mark's zoom (`bakePx`) rides for the dust bar."],
    "§10")
add("eds.unwireDescent", "unwireDescent(m)",
    "In the worker: the world and input rebuilt, with a LevelMap loaded from the serialised lattice.",
    ["The descent runs on this copy, so any frame it mints comes back in `minted` for the engine to merge."],
    "§10")
add("eds.wireDescentResult", "wireDescentResult(r)",
    "A descent result as a message: each step's objects copied out and their buffers transferred; a refusal as it is.",
    ["-"], "§10")
add("eds.unwireDescentResult", "unwireDescentResult(m)",
    "A descent result back from a message, every step object's loops wrapped as Loops.",
    ["-"], "§10")

# ---- src/engine/eraseWorkerClient.js ---- (rewritten 2026-09-29, B-PYRAMID-2b P6: the cuts in the shared pool)
add("ewc.cutQueue", "cutQueue()",
    "A `JobQueue` over the raster pool for cuts alone: the SVG path's (the raster renderer's queue carries plates and cuts together).",
    ["-"], "§7")
add("ewc.cutSlots", "cutSlots(queue)",
    "How many more cuts the bake's lookahead may send: the pool's size less the cuts queued or out; 0 when the pool is broken.",
    ["-"], "§7")
add("ewc.submit", "submit(queue, {kind, barrier, job})",
    "One cut or descent as a `JobQueue` job of kind \"cut\" at `PRIO.cut`, posted to a raster worker (`runCut`): a promise of its result, or null when the pool is broken (the pipeline runs the job inline).",
    ["While any cut is pending the queue keeps one worker for cuts. A barrier's jobs go first. A job a worker error lost goes back to the head of its priority once (`requeue`); the one the watchdog found silent, a second loss, or a job that threw rejects with `err.why`, and the pipeline refuses the pair over ink — never inline, where the same job would stall the page (PLAN §5.9 item 1)."],
    "§7")
add("ewc.resetEraseWorkerClient", "resetEraseWorkerClient()",
    "Tests only: the counters back to zero.",
    ["-"], "")
add("ewc.eraseWorkerStats", "eraseWorkerStats()",
    "For the report: cuts posted, run inline, landed, requeued and lost.",
    ["-"], "§14")


# What each file NEW to the pages is for (the file's article heading on the Code Map).
ROLE = {
    "src/engine/eraseJob.js":
        "The geometry of one erase cut as a job: the boolean, the removal measured locally, the graze rule "
        "and the dust cull, with no document in reach, so the same function runs on the main thread and in "
        "a raster worker (`runCut`). It also moves a job and its result between threads as transferable buffers.",
    "src/engine/eraseDescent.js":
        "The rehome descent as one job per family: every cede down to the erase level runs on a virtual "
        "document, each square's ink derived exactly as the tile store derives it, and nothing reaches the "
        "document until the whole descent has succeeded. Runs on the main thread, or in a raster worker on "
        "a copy of the lattice.",
    "src/engine/eraseWorkerClient.js":
        "The cuts in the shared worker pool (B-PYRAMID-2b, 2026-09-29): a cut or a descent is a `JobQueue` "
        "job at `PRIO.cut` posted to a raster worker, with one worker kept for cuts while any is pending; "
        "a promise of its result, or null when the pool is broken, in which case the pipeline runs the "
        "same job inline, as jsdom always does.",
}


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
    # ---- erasePipeline.js ----
    "erp._bakeOne": {
        "why": "The long says both operands are shifted onto the subject's centre and that the graze, dust and severance are handled here. The cut now runs in the subject's stored coordinates as an `eraseJob.cutJob`, posted to the worker where there is one (returning \"pending\"), and `_applyCut` applies it.",
        "what": "One mark against one object: ceded down by the descent, or cut in place as a job, in the worker where there is one.",
        "long": ["Puts the target in the mark's `_uncutOf` set until a cut lands, so a step past it left whole stales the raster plates (F90). Both operands are made resolved outlines (a stroke force-baked, a legacy fill converted), the object joins the mark's done set, and the gesture's op is resolved before anything changes.",
                 "A target homed shallower than the mark on a pure descent goes to `_bakeRehome`. Otherwise the mark is brought into the coordinates the object is stored in (`_eraserLoopsInto`) and the cut is a `cutJob` there, so every piece it does not cut stays bit for bit (F42); its dust bar is a quarter pixel at the mark's zoom.",
                 "With a worker, nothing in flight and no `sync`, the job is posted and this returns \"pending\"; `_onCutResult` applies it later. Otherwise (the barriers, jsdom) the job runs inline and `_applyCut` applies it."],
    },
    "erp._bakeRehomeInner": {
        "why": "Describes the descent stepping crossing by crossing against the document. It now builds one `eraseDescent.descentJob` for the whole family on a virtual document, in the worker where there is one, and `_applyDescent` swaps the family in. The row `_bakeRehome · _bakeRehomeInner` needs the same correction.",
        "what": "Hands a target homed shallower than the mark to the descent: one job for the family, in the worker where there is one.",
        "long": ["Resolves a stroke or a legacy fill first and refuses anything that is not a shape (`_rehomeBail`). Builds the job's input (the target, the mark's loops, pen and zoom, the freeze radius) and its world (`_descentWorld`).",
                 "With a worker and nothing in flight the job is posted and this returns \"pending\" (`_onCutResult`); otherwise `descentJob` runs inline and `_applyDescent` applies it. The cede-by-cede algorithm is in `descentJob` (DESIGN.md §7)."],
    },
    "erp._inkShapeInRect": {
        "why": "gone",
        "what": None,
        "long": ["No longer in erasePipeline.js: the descent reads the tile store's piece for each square (`eraseDescent.squareInkOf`)."],
    },
    "erp._inkOutline": {
        "why": "Says the connectivity walk is its only consumer; the erase-debug join notes (`_familyJoinNotes`) and the lasso's ink test (`_inkInsidePolygon`, selection.js) call it too.",
        "what": "An object's ink as polygon rings at a tolerance, for the consumers that still speak polygons.",
        "long": ["A shape is flattened, a fill is its own rings, a stroke is outlined first. The family connectivity walk (`_familyComponents`), the erase-debug join notes (`_familyJoinNotes`) and the lasso's ink test (`_inkInsidePolygon`) read it."],
    },
    "erp._stepShapeBakes": {
        "why": "Says it triggers one render if anything changed. It renders when a stroke was promoted a level, or on a raster engine when a stroke homed outside the camera's frame resolved; otherwise it sets `_renderPending`, and a raster engine takes a camera step so the drain re-posts the plates still holding the raw band.",
        "what": None,
        "long": ["Runs perimeter resolves for up to a time budget and reports whether more remain.",
                 "For each queued job: skip it if its object is gone or no longer a raw stroke, step it with the time left, and when it finishes install the result: seal an unclosed outline (`_sealed`), bake the stroke into its shape in place, and promote it a level if it is now wider than a frame (`_promoteOversize`).",
                 "A promotion renders at once (the object changed frames). Otherwise the resolved shape waits for the next render (`_renderPending`, honoured by `flushBakes`): two renders a pen-up were 185 s of a 203 s jsdom session at 1,000 strokes.",
                 "On a raster engine the plates hold the raw band until re-rastered. A stroke homed in the camera's frame is its own list item, so a camera step re-posts them and no list is built; one homed elsewhere is a projected copy the old list still holds raw, so it takes a render (OPEN-FLAGS F92)."],
    },
    "erp._nextEraseTarget": {
        "why": "Incomplete to the point of misleading: it first runs `_eraseFramesPass`, which removes whole frames, and takes targets top-down by z from `_candidatesUnder`; 'drawn after the eraser' is now 'at or above the mark's z', which steps down as the bake proceeds.",
        "what": "The next object to bake under a mark: the highest still under it that the mark's box reaches. Runs the frame-covering pass first.",
        "long": ["Runs `_eraseFramesPass` (once per mark), then walks `_candidatesUnder`'s list from its cursor, skipping handled objects, marks and anything at or above the mark's z. An object with no route to the mark's frame, or one the box prefilter (`_eraseMayTouch`) misses, is marked done.",
                 "Reachability is the only depth bar: the cut lives in the frame it was made in (DESIGN.md §7)."],
    },
    "erp.flushErases": {
        "why": "Says it runs the background erase worker to completion. There is a real erase worker and this never uses it: pending marks (all, or those in `only`) are baked synchronously on the main thread, the cut in flight landed first. It is also the lasso's and the selected-frame drag's barrier, not only the tests' settle point.",
        "what": "Bakes pending marks to completion now, every one or those whose ids are in `only`, synchronously on the main thread.",
        "long": ["Resolves every pending stroke, lands the cut in flight first when its mark is included (a mark with its last cut in flight looks spent), then bakes each mark's targets, oldest mark first, with `_bakeOne` in sync mode and consumes the mark when nothing is left under it. Never uses the worker; only the landed cut in flight steps a mark down.",
                 "The tests' settle point, and the barriers': a lasso (`_settleLassoErases`, the marks it meets) and a drag holding a selected frame (every mark)."],
    },
    "erp._flushErasesFor": {
        "why": "Misses what the change added: the mark's cut in flight on another object lands first (`_settleInflight`), and a bake in the mark's z order steps the mark down (`_lowerMark`). It also runs on tap-select, not only before a drag.",
        "what": "The erase barrier for one object: every pending mark above it that reaches it is baked into it now.",
        "long": ["Resolves every pending stroke first. For each mark above the object: skipped if the object is handled for it (unless the object's own cut is in the worker, which is baked here anyway and its late result dropped); marked done if the box prefilter misses. The mark's cut in flight on another object lands first (`_settleInflight`), since stepping the mark below this object would pass that one uncut; if that replaced the object, it returns true.",
                 "Then the object is baked synchronously. When nothing above it is due first in the mark's z order, the mark steps down past it as the tick would (`_lowerMark`); out of order the mark stays (DESIGN.md §7). Returns true as soon as a bake changed the object; its callers (tap-select, the drag's start, `_settleSelectionErases`) re-hit or scan again."],
    },
    "erp._settleSelectionErases": {
        "why": "Misses what the change added: a mark whose last cut is in the worker is kept rather than consumed as spent. The long also omits that a selected frame with marks pending bakes every mark out (`flushErases`).",
        "what": "The erase barrier for a move: every mark pending over anything in the selection bakes now, and marks left with nothing to cut are consumed.",
        "long": ["With a selected frame and any mark pending, every mark is baked out (`flushErases`), since a frame's natives are not read. Then `_flushErasesFor` runs over the selection's members, families included, until nothing changes; members are carried across each bake by diffing the document's ids, not by id or z, so exactly the pieces a bake minted join the drag.",
                 "A mark with no target left and no cut in the worker is consumed, so it stops painting white over the drag; one whose last cut is in flight is kept. The selection is replaced with the surviving members if a bake changed them. Returns true when anything changed."],
    },
    # ---- overlays.js (the engine-select row `_outlineInView · _splitOnJoins _familyJoinNotes · _selectionAnts _selEdgeSpans · _selInkRings _emitAntRing · _emitOutlineRing`) ----
    "ovl._outlineInView": {
        "why": "The row and the long call it the marching-ants geometry, with edge marks and arrows. The ants are now built from the render list's pieces (`_selectionAnts`, `_selDecide`); this is the erase-debug view's outline of one stored object.",
        "what": "An object's boundary as polygon rings clipped to the view rect, for the erase-debug overlay.",
        "long": ["A shape's rings come from `shapeRingsInRect`; a shape whose ink floods the window has no boundary in view and returns none. A fill's rings are clipped to the rect; anything else returns none."],
    },
    "ovl._splitOnJoins": {
        "why": "Listed in the row as marching-ants geometry; only the erase-debug overlay uses it.",
        "what": "Cuts one boundary segment where a family join starts and ends, so the erase-debug view colours each stretch once.",
        "long": ["Returns the segment's parts flagged joined or not, or null when it is nowhere near a shared edge. A straight side flattens to one chord, so without the cut a partial join would colour the whole side."],
    },
    "ovl._familyJoinNotes": {
        "why": "Listed in the row as the ants dropping family joins; only `_eraseDebugOverlay` calls it now (the ants skip seams by `_selSeamRects`).",
        "what": "Where a family's members are joined, as intervals on the tile edge they share, for the erase-debug view.",
        "long": ["Recorded against both pieces, each in its own level's coordinates, and cached per family keyed by its members and their edit counters. The erase-debug overlay paints these stretches green."],
    },
    "ovl._emitOutlineRing": {
        "why": "Listed in the row as marching-ants geometry; it is the erase-debug overlay's ring emitter.",
        "what": "Pushes one boundary ring to the erase-debug overlay as screen polylines, orange where the edge is the piece's own and green where it is a join.",
        "long": ["Maps points through the object's own picture (`_objPointInActive`), drops sub-pixel chords, and keeps only runs that cover some ground."],
    },
    "ovl._selectionAnts": {
        "why": "The row calls the ants the silhouette clipped to the view with joins dropped; they now run along the render list's pieces, decided rarely and moved by a transform.",
        "what": "The selection indicator handed to the renderer: ant runs and dots in retained space, a transform, and the screen-edge spans.",
        "long": ["Builds or reuses a decision (`_selTable`, `_selDecide`) and adds the edge spans (`_selEdges`) per step. During a drag the first decision is kept and moved by the pointer's travel. Null when nothing is selected, the tool is not select, or nothing traces (DESIGN.md §10)."],
    },
    "ovl._selEdgeSpans": {"why": "gone", "what": None, "long": ["The screen-edge spans are `_selEdges` now."]},
    "ovl._selInkRings": {"why": "gone", "what": None, "long": ["The ants read render-list pieces as loops (`_selPieceLoops`)."]},
    "ovl._emitAntRing": {"why": "gone", "what": None, "long": ["The runs are built in `_selDecide`."]},
    # ---- files.js ----
    "fil.snapshot": {
        "why": "Says it is the shape a bug report carries. A report now carries a local kobin-2 extract, which `report.loadReport` turns back into this shape and loads through `loadSnapshot`; nothing in the product calls `snapshot()`.",
        "what": "The development snapshot (dev-0), camera, natives and lattice, for tests and tools. Nothing in the product calls it.",
        "long": ["`loadSnapshot` is still how a report is reopened: `report.loadReport` rebuilds a dev-0 snapshot from the report's extract and loads it, which is how a browser bug becomes a failing test offline (DESIGN.md §13, §14).",
                 "Loading loads the lattice, mints every frame the natives name, loads the natives, clears the scene state, settles the camera and renders."],
    },
    "fil.serializeDrawing": {
        "why": "Says saving refreshes the scenes first. The scene index's state now comes from the scene client (`exportForSave`), and `frames` limits the natives written.",
        "what": None,
        "long": ["The kobin-1 envelope around the engine's own state. `meta.sceneIndex` is the scene client's last state (`exportForSave`). `frames` is null for the whole drawing, a list for only those frames' natives, or [] for the envelope alone, which the autosave writes as the canvas header.",
                 "Loading (`loadDrawing`) validates everything before touching state, loads the lattice, mints every frame the natives name, loads the natives, **settles the camera** into a legal state, clears the erase bookkeeping and drops any cut in flight. Measured: an unsettled camera made the first pan after a load cost 200 ms and every later one 0.2 ms."],
    },
    "fil.Files": {
        "why": "Says dev-0 is what the diagnostic report carries; a report carries a kobin-2 extract that is turned back into dev-0 to load.",
        "what": None,
        "long": ["kobin-1 (persist.js), the file format and the envelope the local store writes beside its frames; and dev-0, which the tests load and a report's extract is turned back into. Same mixin arrangement as ErasePipeline."],
    },
    # ---- Document.js ----
    "doc.cedeTileById": {
        "why": "Says it works local to the rectangle; it cuts in the parent's own coordinates (F42). Nothing in the product calls it any more: the descent cedes on a virtual document (`eraseDescent.cedeVirtual`) and `_applyDescent` mints the result in this function's order.",
        "what": "Cedes a tile: cuts the rect out of the parent exactly and mints the ink inside as kids one level down. Only the tests call it.",
        "long": ["Converts a legacy fill first and refuses anything but a shape. The rect is subtracted in the parent's own coordinates, so every piece it does not cut stays bit for bit (F42); slivers along the rect are dropped against the pen.",
                 "Remnant pieces keep the parent's frame, attach rect, grid phase and table; kids go to `level` with the caller's window, phase and table (the parent's shifted one level down by default). All keep the parent's z, colour, opacity, pen and family key.",
                 "The product's descent runs its virtual twin, `eraseDescent.cedeVirtual`, and `_applyDescent` mints the result in the order this function gives; `KobinEngine.edit.test.js` calls this one."],
    },
    "doc.setGeometryById": {
        "why": "Says a drag needs it to recompute from where it started; a drag changes displacement tables and never geometry. It now serves promotion to the parent level and the undo and replay of a member the pen-up walked back into its cell.",
        "what": "Replaces an object's geometry outright, with its attach rect, grid phase and table when the snapshot carries them.",
        "long": ["A key present in the snapshot but empty clears that field, so an undo restores 'no phase' as well as a phase. Busts the caches, reindexes and announces with the old footprint (`_afterEdit`).",
                 "Callers: promotion to the parent level (`_promoteOversize`), the undo of a move entry with geometry snapshots (`_undoMove`), and the op log's replay of one."],
    },
    "doc.moveById": {
        "why": "Says consecutive pieces share their endpoint arrays; a stored loop is one Float64Array with each endpoint stored once, and pieces are read as transient views.",
        "what": "Translates an object's stored coordinates, only where a move does touch them: a member walked back into its cell, an old move entry.",
        "long": ["A shape's loops are replaced by translated Loops (nothing writes through a piece view, DESIGN.md §3); a fill's or stroke's points shift in place; the attach rect moves with it. Then `_afterEdit`.",
                 "Callers: `_normalizeHome` at pen-up, the undo of a move entry from before F41, and the op log's replay of either."],
    },
    "doc._undoMove": {
        "why": "Says undo applies the leftover translation and restores the drag's starting geometry. The sub-cell part is now the displacement table, restored as a table; geometry is restored only for a member the pen-up normalised.",
        "what": "Undoes move entries: the frame back first, then the geometry snapshot if the pen-up normalised the member, then the table.",
        "long": ["Each step is independent, so a normalised member carries both pairs. An entry with only `dx`/`dy` is from before F41 and is undone by the inverse translation. `_invertMove` swaps each pair for the redo (DESIGN.md §8)."],
    },
    "doc.getById": {
        "why": "Says it scans the buckets; it is one lookup in the `_byId` map, and answers null for a native whose frame a subtree removal has set aside.",
        "what": None,
        "long": ["One lookup in the id map, kept in step by every add, insert, removal and replace; the record's `level` is the object's home frame (`_home`).",
                 "Null for a native of a frame set aside by a subtree removal: it stays in the map by reference and comes back with the frame."],
    },
    "doc.at": {
        "why": "Says it is a plain array read (and the row calls it plumbing); it first merges the frame's shadows and settles its pending shift, O(those natives).",
        "what": "A frame's natives for anything that reads positions: its shadows merged in and its pending shift settled first.",
        "long": ["The first read of a frame after a subtree move pays for it: shadows merge (`_mergeShadows`, held while a drag is in progress) and the shift is settled into every native's table (`_settleIfPending`). Scans that need only identity use `list` or `count`, which do neither (DESIGN.md §8)."],
    },
    "doc.LevelIndex.add": {
        "why": "The long is Document.add's text (a bucket, an announcement, live strokes). LevelIndex.add indexes one object by its painted extent and grows the frame's bounds; it takes no level.",
        "what": "Indexes an object by its painted extent and grows the frame's bounds: union box, largest size, highest z.",
        "long": ["A stroke's box gets a half-width margin; a resolved shape or a fill none, since its box already is the ink. A box over four cells across goes to the overflow set.",
                 "`ext`, `maxSize` and `maxZ` only grow (a removal leaves them), so they bound what the frame holds: the bake's whole-frame skip reads the first two (`frameExtent`), the frame-covering erase the third (`maxZUnder`)."],
    },
    # ---- LevelMap.js ----
    "lm.serialize": {
        "why": "Says the tree is four fields per box with no coordinate in it; each frame also writes its pending `shift` (a sub-cell offset in its units) and `shadowOf`, and `load` restores both and rebuilds the spine.",
        "what": "Writes the lattice (id, parent, depth, cell, and a moved frame's pending shift and shadow link) and reads it back.",
        "long": ["The edge is derived from the cell and the grid is a constant, so neither is stored. Frames are written in depth, then id, order. Every kobin-2 write carries it beside its entries (DESIGN.md §13).",
                 "**A pre-lattice file is refused**, never converted: converting would rewrite stored coordinates, the one operation the design exists to avoid.",
                 "`load` adds parents before children, mints a root `0` if none came, re-attaches each shadow to its resident (the resident keeps the cell) and rebuilds the spine."],
    },
    "lm._recOf": {
        "why": "Says snapshots and scenes speak this record view; snapshots and files carry `serialize()`, and scenes.js is gone. Only the engine's `crossings` getter reads `records`.",
        "what": "The spine's legacy per-depth `{ s, t, grid }` records, read through the engine's `crossings` getter.",
        "long": ["Derived from each spine frame's edge and the constant grid, cached on the frame until it is re-addressed. Nothing is stored here."],
    },
    "lm._isSpine": {
        "why": "Says every non-spine id is `<parent>/<i>,<j>`; a birth chain already taken (its frame moved away) gets a `#n` suffix, and `_spine`, not the id, says which frame is the origin at a depth.",
        "what": "Id minting: the origin chain keeps its depth as the id, everything else is `<parent>/<i>,<j>`, with `#n` when that chain is taken.",
        "long": ["Ids are document keys and cache keys, so a frame's id never changes, even when a subtree move re-addresses it. A cell a moved frame vacated mints a twin with `#n`, and every descendant carries it (DESIGN.md §13, F80).",
                 "A re-addressed spine frame leaves the chain but keeps its id string, so `_spine` is the authority on which frame is the origin at a depth."],
    },
    # ---- persist.js ----
    "per.decodeCrossings": {
        "why": "Says it checks every box's edge record and every index against the legal range; the lattice form has no edge records, and an out-of-range cell is listed (`__outOfRangeCells`), not refused.",
        "what": None,
        "long": ["Validates and reads the box tree: every frame needs a unique string id, an integer depth, a string or null parent, and integer cell indices.",
                 "**This is the gate that refuses a pre-lattice drawing** (per-depth `{s, t}` records or a `__frames` tree), with a clear error, rather than half-converting it.",
                 "A cell outside the balanced range is listed on the result (`__outOfRangeCells`), not refused, so a file an older build wrote with one still opens."],
    },
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]
