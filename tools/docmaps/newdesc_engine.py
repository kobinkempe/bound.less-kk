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
add("doc.setFrameShift", "setFrameShift(frameId, shift)",
    "Sets the shift a frame's natives owe after a subtree move; a zero shift clears it.",
    ["Nothing is applied here; the first read of the frame's list settles it (`_settleIfPending`)."],
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
add("erp._eraserRectInto", "_eraserRectInto(rect, HE, o, HO)",
    "A mark's rect, drawn in frame HE, in the coordinates object `o` is stored in at its home HO.",
    ["With no table it is `mapRectF`, bit for bit; a moved object's table is undone on the way in (`LevelMap.mapRectObj` with `toHome`). The erase prefilter's box goes through it."],
    "§10")
add("erp._eraserLoopsInto", "_eraserLoopsInto(loops, HE, o, HO)",
    "The mark's loops in the coordinates object `o` is stored in: the clip of an in-place cut.",
    ["`LevelMap.projectLoopsObj` with `toHome`: the exact chain, through the object's table when it has one."],
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
    "erp.flushErases": {
        "why": "Says it runs the background erase worker to completion. There is a real erase worker and this never uses it: pending marks (all, or those in `only`) are baked synchronously on the main thread, the cut in flight landed first. It is also the lasso's and the selected-frame drag's barrier, not only the tests' settle point.",
        "what": "Bakes pending marks to completion now, every one or those whose ids are in `only`, synchronously on the main thread.",
        "long": ["Resolves every pending stroke, lands the cut in flight first when its mark is included (a mark with its last cut in flight looks spent), then bakes each mark's targets, oldest mark first, with `_bakeOne` in sync mode and consumes the mark when nothing is left under it. Never uses the worker; only the landed cut in flight steps a mark down.",
                 "The tests' settle point, and the barriers': a lasso (`_settleLassoErases`, the marks it meets) and a drag holding a selected frame (every mark)."],
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

# ---- 2026-10-05, the rebuilt tree ----
add("lm.NEVER", "NEVER()",
    "The `empty` test that is never true: with it no resident is taken as empty, so a frame put back or re-contained never takes a cell's residency for that reason (`restoreFrame`'s default, `reparent`).",
    ["-"], "§8")
add("lm.residentOf", "residentOf(id)",
    "The frame that stands for `id`'s cell: `id` itself, or the resident it is a co-resident of — what an address lookup returns.",
    ["-"], "§8")
add("lm.cellFrames", "cellFrames(id)",
    "Every frame sharing `id`'s cell, its resident first — what a by-cell reader walks, so co-residents read as one cell.",
    ["-"], "§8")
add("lm.sameCell", "sameCell(a, b)",
    "Whether two frames are one cell: the same frame, or co-residents.",
    ["A frame alone in its cell, the common case, is answered by the ids without looking up a resident (DESIGN.md §8)."], "§8")
add("lm._kidAt", "_kidAt(p, key)",
    "The resident of child cell `key` under `p`'s cell, found through every co-resident's kids, since the kids of one cell's frames are one group.",
    ["-"], "§8")
add("lm._regroup", "_regroup(list, r)",
    "Makes the frames at one cell one group with one resident: `r` when given, else the present public resident, else a public frame; the others become its co-residents.",
    ["Nothing merges: each frame keeps its id, its table and its kids (A1 C3). Used where a cell's group is formed again — a private frame made or put back (`privateFrame`, `restoreFrame`), a group split as frames leave (`_splitKids`), a load's saved resident restored (`_loadFrames`). Clears the route cache."],
    "§8")
add("lm._joinGroups", "_joinGroups(a, b, empty)",
    "Two residents of one cell become one group: an empty, childless `b` hands the residency to `a`, and a private frame never keeps the cell from a public one nor takes it from one (F138). Returns the resident.",
    ["The other frame and its co-residents all become the resident's co-residents; nothing merges (A1 C3). `empty` is the caller's test that a frame holds no natives. A unit moving together leaves its cells first, so its empty public frame is childless when its private co-resident lands — hence the private rule (DESIGN.md §8)."],
    "§8")
add("lm._linkKids", "_linkKids(r, empty)",
    "After a join, the kids of the frames now sharing `r`'s cell are grouped child cell by child cell, all the way down, so the frames at a cell and their parents are one group.",
    ["-"], "§8")
add("lm._splitKids", "_splitKids(A, B)",
    "The inverse of `_linkKids`: when frames `A` leave a cell that frames `B` keep, each child cell's group is split into A's kids and B's, all the way down.",
    ["-"], "§8")
add("lm._cellParent", "_cellParent(f)",
    "The resident of `f`'s container's cell — the lattice parent every geometric walk reads, so the path between co-residents is empty and their pictures are bit-exact.",
    ["-"], "§8")
add("lm.forget", "forget(id)",
    "Frame GC's removal of a frame that contains no frames (its natives and keepers checked by the caller): it leaves its cell's group, a co-resident taking the residency (A1 C3); false if refused.",
    ["A frame that was ever moved has its id retired for the session (`retire`): caches keyed by the id picture its last address, which a new mint at its birth cell would not be. The spine is rebuilt when the frame was on it."],
    "§8")
add("lm.retire", "retire(id)",
    "Marks an id no new frame may take this session — a moved frame's, a deleted one's — because caches and history still name it.",
    ["-"], "§8")
add("lm.privateFrame", "privateFrame(parentId, i, j, key)",
    "The private frame of family `key` at child cell (i, j) of `parentId`'s cell, made on first use (A1 C4): a co-resident there flagged `private` with the id of the public frame the family's chain hangs from. A cede's kids live in it, so no shared frame holds a family's piece.",
    ["Its container is `parentId`; the selection never takes a private frame whole but judges its natives one by one, so the lasso can take every other frame whole (DESIGN.md §7, §10). Called by the erase descent's `kidHome`; null for a cell digit out of range."],
    "§7")
add("lm.restoreFrame", "restoreFrame(rec, empty)",
    "Puts a removed frame back at its address — the undo of a subtree delete or of a legacy merge: a co-resident where a frame holds the cell, or the cell's resident when that one holds nothing and contains no frame.",
    ["Its kids come back after it, each joining its cell's group as it is added. Its `addrSeq` is bumped so the caches keyed on its chain read it afresh; a private flag regroups the cell; the address epoch moves and the spine is rebuilt. Null when its parent is gone (DESIGN.md §10: an undo puts the subtree back, a co-resident where new ink holds a cell)."],
    "§10")
add("lm.removeSubtree", "removeSubtree(rootId)",
    "A deleted subtree leaves the lattice (A1 C3): the root and every frame it contains leave every group they share, their ids retired for the session; returns their addresses, parents first, for `restoreFrame`.",
    ["Each address carries the cell, the depth, the shift, `addrSeq` and the private flag. A parentless root is given its parent first (`_growRoot`). Called by `Document.removeFrameSubtree`; history names the ids, hence the retirement."],
    "§10")
add("lm.reparent", "reparent(id, parentId)",
    "Makes `parentId` frame `id`'s container at the cell it already has — the live undo of a legacy merge (`legacy/modelV1.unmerge`) giving a frame its kids back.",
    ["-"], "§13")
add("lm._ensureSpineId", "_ensureSpineId(sid, depth)",
    "A spine id minted at the spine cell of `depth` for `ensureId`: the spine frame itself (\"2\"), or a moved spine frame's twin (\"2#3\") made there as a co-resident of the cell's resident.",
    ["-"], "§8")
add("lm.peekAtChain", "peekAtChain(rootId, chain)",
    "The frame at a chain of child cells below `rootId` if the lattice has it, never minting — the read side of `frameAtChain`, so a read adds no frame.",
    ["-"], "§8")
add("lm._loadFrames", "_loadFrames(data)",
    "Builds the lattice from a saved one: frames added parents first (a missing parent minted by id, not left an orphan, F99), their shifts and private flags restored, and each shared cell's saved resident put back.",
    ["Frames sharing a cell are grouped as they are added (`_addFrame`); a group whose saved resident lost the cell is regrouped round it. An empty list gets the root `0`; a `0` that a subtree delete took is not minted parentless beside the tree (F138). The spine is rebuilt at the end."],
    "§13")

# ---- 2026-10-05, the rebuilt tree ----
add("doc.opFrames", "opFrames(op, out)",
    "Every frame an op names — where its undo or redo puts something back by frame id: homes, sources and targets, a moved frame and its parents, a deleted subtree's roots and their parents, a bake step's pieces and frames.",
    ["Frame GC keeps these frames while the op is in history (F94; `namedFrames`, `frameGc.namedBy`); a frame goes when the op leaves history. A delete gesture's parts are walked one by one; an old store's merge records and settle carries are named too."],
    "§8")
add("doc.tableOf", "tableOf(o, home)",
    "Native `o`'s picture table (A1 C1): its own table with its home frame's shift added at k = 0, never written into it. Every reader of where a native is drawn composes here.",
    ["The shift is placement, composed on read (DESIGN.md §8): a change of a frame's shift moves every native in it without touching one. `home` defaults to the native's own."],
    "§8")
add("doc.displacedNatives", "displacedNatives()",
    "Every live native drawn away from its stored bits, as `[obj, home, picture table]`: the ones with an own table, then every other native of each shifted frame.",
    ["A shifted frame's other natives share one table array, so a reader may key a placement on it (the selection's union box, the store's routes, the erase targets' scan of moved natives, DESIGN.md §7)."],
    "§8")
add("doc.hasOwnTable", "hasOwnTable(o)",
    "Whether native `o` carries a table of its own, not only its frame's shift.", ["-"], "§8")
add("doc.ownTable", "ownTable(o)",
    "A copy of native `o`'s own table, as an undo entry records it; undefined when it has none.", ["-"], "§8")
add("doc.promotedTable", "promotedTable(o, from, to)",
    "The own table native `o` needs once promoted from frame `from` to its parent `to`: its picture table one level down, less `to`'s shift (A1 C1).",
    ["-"], "§8")
add("doc._shifted", "_shifted(k)",
    "Whether frame `k` carries a shift, so its natives are drawn displaced by it.", ["-"], "§8")
add("doc.offTouchedSince", "offTouchedSince(rev)",
    "The ids whose table or home may have changed since the table revision was `rev`, or null when that cannot be told — so a reader memoised at `rev` re-reads only these.",
    ["Null when an event since named no one object, or the log no longer reaches back. The store's `_rerouteGroups` reads it: re-walking 19.7k moved natives was 166 ms of a drop on the Magnum Opus (TESTER-3)."],
    "§9")
add("doc.cellList", "cellList(frame)",
    "The natives of every frame sharing `frame`'s cell, the resident's first (A1 C3) — what a by-cell reader reads, so co-residents draw as one cell; the frame's own list when it is alone.",
    ["-"], "§8")
add("doc.ownFor", "ownFor(T, home)",
    "The own table a native homed in `home` must carry to be drawn with picture table `T`: `T` less the frame's shift (A1 C1), so new ink in a shifted frame stays where it was drawn.",
    ["-"], "§8")
add("doc._keyIn", "_keyIn(k, o) · _keyOut(k, o)",
    "Keep the per-frame set of natives with a family key (an `editId`: ceded kids, erase pieces) as natives enter and leave frame `k`.",
    ["-"], "§10")
add("doc.keyedIn", "keyedIn(frame) · keyedFrames()",
    "The natives of a frame with a family key, or null; and every frame holding one — so the lasso reads only the keyed natives under the frames it encloses, never their other natives.",
    ["-"], "§10")
add("doc.setHandledById", "setHandledById(id, markId, {inkless})",
    "A mark's bake dealt with native `id` without cutting it — a refusal or a graze (A2 §4.1): the mark joins its `handledBy`, so the erase rule stops masking it; logged as an `attr` entry (A2 §4.9).",
    ["`inkless`: no ink of it lay under the mark, so no pixel changes. Nothing is emitted when the mark is already there."],
    "§7")
add("doc.setTargetsById", "setTargetsById(id, targets)",
    "A mark's `targets`, recorded once when its shape lands (A2 §4.2), as an `attr` entry in the log — what a reopened mid-bake erase resumes from.",
    ["-"], "§7")
add("doc.detachFrames", "detachFrames(records)",
    "The redo of a subtree delete: each root the records hold is deleted again (`removeFrameSubtree`), and the records are refreshed in place to what went, since the op and its inverse share the array.",
    ["A root the lattice no longer has — a replay, where the header's lattice was written after the delete — keeps its records. Also the redo of a bake step that took frames the mark covered whole."],
    "§10")
add("doc.dropFrames", "dropFrames(records, stale)",
    "A subtree delete replayed from the log: the natives a snapshot still lists go, and a frame only those rows named — minted at the load because the header's lattice lacked it — leaves the lattice again (A1 C3).",
    ["`stale(record)`: a snapshot at or past the record, nothing to do there. A record from before C3 has no address and its frame stays. Every id is retired, because history names them."],
    "§13")
add("doc.namedFrames", "namedFrames()",
    "Every frame an op in the undo or redo history names (`opFrames`): frame GC keeps them (F94).", ["-"], "§8")
add("doc.forgetFrame", "forgetFrame(frame)",
    "The document's side of frame GC (F94): a forgotten frame's empty list, index and keyed set go; false when the frame still holds natives.",
    ["-"], "§8")
add("doc.noteForgotten", "noteForgotten(frames)",
    "One collection's forgotten frames, sent to the op log as a `forget` record (F94).", ["-"], "§8")
add("doc._stepIndex", "_stepIndex(extra)",
    "The bake steps of every erase gesture in history in the order they landed, with the step that consumed each object, each step's gesture and the applied gestures — so undo and redo follow what each step consumed, not the stack.",
    ["Two marks pending at once bake out of stack order: one's step can cut the other's piece and then cut it again (REVIEWER-3 ERASE-2, F118). Each step carries `_on` (applied); a step rebuilt by a reload has none and is taken as applied when its gesture is, its source is gone and the step that minted its source is applied."],
    "§7")
add("doc._revertStep", "_revertStep(st)",
    "Undoes one bake step: a frame the mark covered whole comes back with its subtree, a severance's re-key runs backwards, else the step's pieces go and its source comes back.",
    ["The source comes back only for pieces the step still owns: pieces something unrecorded took (a stale replay) are that thing's ink now, and the source over them would stack ink twice."],
    "§7")
add("doc._applyStep", "_applyStep(st)",
    "Re-applies one bake step — the frames taken again, the re-key forward, or the source removed and its pieces put back; false, still suspended, when its source is not in the document.",
    ["What this redo takes out is what its undo puts back (F70)."], "§7")
add("doc._stepsUndo", "_stepsUndo(op)",
    "The undo of an erase gesture: its applied steps and every applied step that consumed what they made, reverted newest first.",
    ["-"], "§7")
add("doc._stepsRedo", "_stepsRedo(op)",
    "The redo of an erase gesture: its steps in landing order where their sources are back, then any suspended step of an applied gesture whose source now is, until none applies.",
    ["-"], "§7")

# ---- 2026-10-05, the rebuilt tree ----
add("erp.cutKey", "cutKey(m, t)",
    "The reorder buffer's key for the pair (mark, target).", ["-"], "§7")
add("erp._initErase", "_initErase()",
    "The erase state, made once from the engine's constructor: the pending marks, each mark's lineage and serial order, the reorder buffer of cuts, the parked barrier, the step budgets — and the document subscriptions that keep them.",
    ["Runs after the scene subscribes. The marks set and the lineage index are kept by events (`_onEraseEvent`), the history forks by ops (`_onEraseStep`), and the index is built once from the document (`_rebuildEraseIndex`). DESIGN.md §7, A2 §4.6."],
    "§7")
add("erp._onEraseEvent", "_onEraseEvent(ev)",
    "Keeps the pending marks and the lineage index from the document's events: a mark added or removed, a native entering or leaving a mark's lineage; a reset drops every cut in flight and the parked barrier and rebuilds the index.",
    ["A reset bumps the erase generation, so a job from before it is dropped when it lands. A frame put back (`addFrame`) brings its natives back by reference with no events of their own, so its natives are pruned of dead marks and counted into the budgets here. A native re-entering is pruned of marks that cannot return (`_pruneDead`) and, unless it is a re-home, grows the budgets of the marks it is pending under (`_supplyAdd`)."],
    "§7")
add("erp._supplyAdd", "_supplyAdd(o, by)",
    "Native `o` arrived pending under marks other than `by` — another mark's piece, a source an undo returned, a frame an undo put back: each such mark's step budget grows by one.",
    ["-"], "§7")
add("erp._stepBudget", "_stepBudget(M)",
    "Mark M's step budget, taken at its first step: the steps so far and its supply, the ids pending under it then.",
    ["-"], "§7")
add("erp._overBudget", "_overBudget(Erec)",
    "Counts one step of a mark's bake; past 2 × its supply + 8 steps the bake is not converging — a wrong rule — so the mark is aborted, reported, noted on its journal entry and spent with the cuts it made, and true returned.",
    ["So no loop can hang the page (DESIGN.md §7, the bake terminates; PLAN §5.8 item 3). The abort is kept for `report().erase.counters` and logged as a console error; the correct rule's steps never exceed the supply (`erase.rule.test.js`)."],
    "§7")
add("erp._markAlive", "_markAlive(id)",
    "Whether mark `id` can mask anything again: it is in the document, deleted with its frame by an op in history (its undo puts it back, A1 C3), or held by an undone gesture on the redo stack.",
    ["A spent mark never returns (its gesture undoes by its steps), nor one whose redo branch a new op cleared. The redo and undo scans are memoised on the stacks' identity, length and top."],
    "§7")
add("erp._pruneDead", "_pruneDead(o)",
    "Drops from a native's `targetOf` and `handledBy` every mark that cannot return (A2 §4.6) — as it re-enters the document and at a load — so the undo of a finished erase restores the document exactly.",
    ["-"], "§7")
add("erp._onEraseStep", "_onEraseStep(ev)",
    "The op-log side: a new op forks history, so the marks its dropped redo branch held leave the live natives' fields; a bake step replaces, in what a running barrier follows, the source by its pieces (A2 §4.11).",
    ["-"], "§7")
add("erp._rebuildEraseIndex", "_rebuildEraseIndex()",
    "Builds the pending marks and the lineage index afresh from every frame's list; the serial orders, silent pairs and projections are dropped.",
    ["-"], "§7")
add("erp._lineageAdd", "_lineageAdd(m, id) · _lineageDelete(m, id)",
    "Native `id` joins or leaves mark `m`'s lineage — the live natives with `m` in `targetOf`; one that joins is also noted for the mark's serial order (`_headOf`).",
    ["-"], "§7")
add("erp._marksUnlanded", "_marksUnlanded()",
    "Whether any mark's shape has not landed, other than the one being drawn: a reader of the mask resolves it first.",
    ["-"], "§7")

# ---- 2026-10-05, the rebuilt tree ----
add("erp._registerMark", "_registerMark(Erec)",
    "Records a landed mark's targets, once (A2 §4.2): the frames its ink covers whole set aside as one step, then every reachable native under it below its z, in the mark's `targets` and in each target's `targetOf`.",
    ["Nothing can have moved under the mark before this runs: every gesture that moves ink resolves pending perimeters first, and the mark's op is on top of the undo stack until its shape lands (DESIGN.md §7). A mark from a file written before `targets` registers by the same scan under its stepped z, less the ids its op's steps name, whose pieces join its lineage as handled. Runs in the landing's Stage batch, so the mask reaches the plates with the shape."],
    "§7")
add("erp._registerLanded", "_registerLanded()",
    "Registers every landed mark that has no `targets` yet: one from before the field, a direct add, one back by a redo (A2 §4.9).",
    ["-"], "§7")
add("erp._deriveTargetOf", "_deriveTargetOf()",
    "After a load or a replay: every known mark's `targets` — live, or held by an op in the undo or redo stack — put back into its targets' `targetOf`, dead marks pruned, and the index rebuilt (A2 §4.9).",
    ["A union, so idempotent. A snapshot written before a registration lacks the fields, and no log entry carries `targetOf`: it is derived."],
    "§13")
add("erp._eraseLoaded", "_eraseLoaded()",
    "The erase side of a load: the lineage derived and, when this tab holds the pen, every mark from before `targets` registered, its `targets` logged once.",
    ["-"], "§13")
add("erp._opOf", "_opOf(id)",
    "Mark `id`'s gesture op — its `eraseCommit` — from the commits seen or the undo stack, without minting one.", ["-"], "§7")
add("erp._rectMayTouch", "_rectMayTouch(r, o)",
    "Whether the eraser's rect, in native `o`'s stored coordinates, meets its box — a shape's loop by loop, a stroke's grown by half its width.",
    ["-"], "§7")
add("erp._projected", "_projected(E, HE, o)",
    "Mark E's loops in native `o`'s stored coordinates, memoised per home and picture table, so targets moved together share one projection (A2 §4.7).",
    ["The memo is keyed on the lattice's address epoch and the mark's version, so a re-address or a re-projected mark reads it afresh."], "§7")
add("erp._pendingPair", "_pendingPair(M, o)",
    "Whether the bake still owes the pair (mark M, native o): `o` is under M's mask by the erase rule and the eraser's box has not ruled it out.",
    ["-"], "§7")
add("erp._silentAdd", "_silentAdd(m, id)",
    "A pair the tighter box test rules out, handled in memory only — no pixel of it is under the mask; a reload derives it again.",
    ["-"], "§7")
add("erp._orderOf", "_orderOf(M)",
    "Mark M's lineage in the serial order — top-down by (z, id) — with a cursor past what is no longer pending; ids that joined since are inserted in place.",
    ["Keyed by the z each id had when it joined (a native's z never changes; a piece inherits it), so a removed id keeps its place and the order is a function of the ids alone, whenever they arrive — what lets a parallel bake leave the inline bake's document (DESIGN.md §7)."],
    "§7")
add("erp._headOf", "_headOf(Erec)",
    "Mark E's first pending target in the serial order, or null; the cursor moves past what is no longer pending.", ["-"], "§7")

# ---- 2026-10-05, the rebuilt tree ----
add("erp._pendingOf", "_pendingOf(Erec)",
    "Mark E's pending targets in the serial order, from its head on (a generator).", ["-"], "§7")
add("erp._serialHead", "_serialHead()",
    "The serial head: the oldest mark and its first pending target — the target null when the mark has nothing left — or null when no mark is pending.",
    ["-"], "§7")
add("erp._bakeRun", "_bakeRun(deadline)",
    "The bake's work until `deadline`: the serial head applied when its job has landed (run inline where there is no worker), a mark with nothing pending spent in its turn, then the lookahead dispatched; it stops at a head still in flight.",
    ["Results apply strictly in the serial order, so the ids, steps and log are the inline bake's (DESIGN.md §7, A2 §4.7). One pair a tick always runs, or a pair costing more than the budget would be refused for ever (BS-3); the next pair is started only when the last one's cost fits the deadline. A pair its own inline step left pending is set aside as handled, not looped on. Returns whether anything changed, a mark was spent, and whether work is left that waits on no worker."],
    "§7")
add("erp._lookahead", "_lookahead()",
    "Dispatches pairs ahead of the serial head, in the serial order, up to the pool's free cut slots; a target pending under an earlier mark is not dispatched for a later one (the per-target lock).",
    ["The lookahead writes nothing to the document: only shape-on-shape pairs are dispatched ahead, and the scan stops after LOOKAHEAD_SCAN targets."],
    "§7")
add("erp._bakeNext", "_bakeNext()",
    "For the tests: the serial head baked inline, or the oldest mark spent when it has nothing left; false when nothing is pending.", ["-"], "§7")
add("erp._dispatchPair", "_dispatchPair(Erec, target, {ahead, barrier, inline})",
    "Bakes one pair (mark, target): the target resolved to a shape, its job built (a cut or a descent), then sent to the raster pool's queue — landing in the reorder buffer — or, with no worker or `inline`, run and applied at once.",
    ["A mark not yet landed is landed and registered first; a stroke target is resolved, a fill turned into a shape. A pair the eraser's box misses is handled in memory only; a target with no perimeter is refused. Descents run one at a time (\"wait\" while one is out). `ahead`: dispatch only, never write the document. Returns \"flight\", \"wait\", \"applied\", \"handled\" or \"none\" (DESIGN.md §7, A2 §4.7)."],
    "§7")
add("erp._jobFor", "_jobFor(E, HE, o, HO)",
    "A pair's job: a descent when the target is homed shallower along the mark's own chain — the hole belongs at the level the mark was drawn at — else a cut in the target's stored coordinates, the eraser brought there through its table; null when the eraser maps to nothing.",
    ["A target homed in a ring neighbour's cell cedes down the mark's chain below it (REVIEWER-3 ERASE-4). The cut in stored coordinates keeps every piece it does not cut bit for bit (F41, F42); its dust bar is a quarter pixel at the mark's zoom, through the frame factor (F66)."],
    "§7")
add("erp._onLanded", "_onLanded(c, r, err)",
    "A worker's job has landed: into the reorder buffer, then the tick or the parked barrier applies it in its turn; a job no longer in the buffer is counted stale.",
    ["-"], "§7")
add("erp._cutQ", "_cutQ()",
    "The job queue cuts go through: the renderer's, where plates and cuts share the raster pool (A3 §4.1), else the engine's own.",
    ["-"], "§7")
add("erp._applyLanded", "_applyLanded(Erec, rec, c)",
    "Applies a landed job in its turn if it is still valid — the target live and unchanged (`_ver`), the pair still pending, the lattice not re-addressed, the document not reset — else counts it stale, to be dispatched again; a job the pool lost is refused here.",
    ["A move projects the eraser through another table, so a changed `_ver` makes the result wrong for the target as it is now (DESIGN.md §7). The apply is timed for the erase journal."],
    "§7")

# ---- 2026-10-05, the rebuilt tree ----
add("erp._refuseLost", "_refuseLost(Erec, rec, c)",
    "A job the pool lost — the watchdog, a second worker error, a throw in the worker — refused over the ink, with the reason journaled and counted, never run inline (PLAN §5.9 item 1).",
    ["-"], "§7")
add("erp._applyPair", "_applyPair(Erec, rec, kind, r)",
    "Applies one pair's result — a descent's steps or a cut's pieces — after counting the step against the mark's budget.", ["-"], "§7")
add("erp._dropCut", "_dropCut(c) · _dropCuts(id)",
    "A job out of the reorder buffer (and the descent slot); and every job of a mark that left the document, so their late answers are ignored.",
    ["-"], "§7")
add("erp._eraseBusy", "_eraseBusy()",
    "Whether a cut or a descent is in a worker.", ["-"], "§7")
add("erp._spendMark", "_spendMark(Erec)",
    "A mark with nothing pending is spent: removed from the document (logged `spent`, its box re-rastered exactly) and its id pruned from its lineage (A2 §4.6).",
    ["-"], "§7")
add("erp._pruneMark", "_pruneMark(id)",
    "A spent or unreturnable mark's id taken off every live native of its lineage, with its order, silent pairs, projections and budget — it never comes back, since its gesture undoes by its steps.",
    ["-"], "§7")
add("erp._refuse", "_refuse(E, o, HO, why, inkless)",
    "A refusal: the mark's bake leaves native `o` whole and adds the mark to its `handledBy`, so its ink under the mark shows again unless `inkless` (A2 §5.7); the bail is journaled.",
    ["-"], "§7")
add("erp._noteOf", "_noteOf(id)",
    "Mark `id`'s erase entry in the engine's journal.", ["-"], "§14")
add("erp._renderSoon", "_renderSoon()",
    "One render within ERASE_RENDER_MS for a bake's steps, not one per landed cut: a render per cut or per slice was most of a bake's main thread on a big drawing (REVIEWER E-2).",
    ["A spent mark renders at once. On the raster path a cut under its mark has already staled only its band (PLAN §5.3 A2-Q2)."], "§7")
add("erp._cellOffset", "_cellOffset(A, B)",
    "What to add to frame B's coordinates to read them in frame A, for a cell of the same depth at most one away; null past that. Cells, not frames: a kid in a private frame is its cell's (F124, A1 C4).",
    ["-"], "§7")
add("erp._eraseBarrier", "_eraseBarrier(kind, pairsOf, then, follow)",
    "The barrier (A2 §4.11): bakes the pending pairs a tap, a drag or a lasso names, round after round in serial order, then runs the gesture's `then` — so nothing is selected, moved or judged before its cuts land.",
    ["Pending perimeters resolve first, so a mark registers before anything moves under it. Each round takes every named pair whose target is not pending under an earlier mark; the pieces still pending under another form the next, so a target under k marks takes k rounds and no cap is needed. `follow`: the ids replaced by their pieces as steps land. With no worker the rounds run inline and `then` runs before it returns true; otherwise the gesture is parked (false) until the last round applies, and a new press, a tool change, an undo, a deselect or a pinch cancels it while its cuts go on as the bake's (DESIGN.md §7)."],
    "§7")
add("erp._barrierStep", "_barrierStep()",
    "A job landed while a gesture is parked: its barrier's rounds go on.", ["-"], "§7")

# ---- 2026-10-05, the rebuilt tree ----
add("erp._barrierAdvance", "_barrierAdvance(b)",
    "Runs a barrier's rounds: the landed jobs of the last round applied in serial order, then the next round dispatched; false when a round waits on a worker, true when none is left and the gesture's `then` has run.",
    ["A round's fill targets become shapes before any pair is dispatched, so the log reads the same whether its cuts run inline or in workers. A pair its own inline step left pending is set aside as handled, not looped on."],
    "§7")
add("erp._barrierRound", "_barrierRound(b)",
    "A barrier's next round: each target its pairs name, with the earliest mark it is pending under anywhere, in serial order — the per-target lock, so an older mark never cuts a newer one's piece.",
    ["-"], "§7")
add("erp._finishBarrier", "_finishBarrier(b)",
    "A barrier's end: every mark it emptied is spent, the gesture's continuation runs with the followed ids still live, and the bake is rescheduled.",
    ["-"], "§7")
add("erp._cancelBarrier", "_cancelBarrier()",
    "Drops a parked gesture — a new press, a tool change, an undo, a pinch, a load: its continuation never runs, a parked lasso's loop goes, and its cuts go on as the bake's.",
    ["-"], "§7")
add("erp._pendingPairs", "_pendingPairs(pred, markPred)",
    "Every pending pair whose live target `pred` accepts, of the marks `markPred` accepts, as `{Erec, rec}`.", ["-"], "§7")
add("erp._familiesOf", "_familiesOf(ids)",
    "The natives of the families of the ids a barrier follows, so a tap or a drag bakes a family whole.", ["-"], "§7")
add("erp._tapBarrier", "_tapBarrier(id, then)",
    "A tap's barrier: bakes the pending pairs of the hit object's family, then hands `then` its pieces, so the tap selects the piece under the finger (A2 §5.5, SM-5).",
    ["-"], "§7")
add("erp._dragBarrier", "_dragBarrier(then)",
    "A drag's barrier (B4): bakes the pending pairs among the selection's members and under its frames, and every pending pair of a mark homed under a selected frame — a mark moved with its frame would carry its mask off its targets.",
    ["The selection follows the cuts to the pieces (re-selected, or deselected when nothing is left), then `then(b)` starts the drag."],
    "§7")
add("erp._lassoBarrier", "_lassoBarrier(poly, then)",
    "A lasso's barrier (H5): bakes every pending pair whose target's drawn box — placed by the Stage at the camera's frame — meets the loop's box, wherever its mark is.",
    ["-"], "§7")
add("erp._eraseStatus", "_eraseStatus()",
    "The erase part of the engine's status: the pending marks, whether a gesture is parked on their cuts (the editor's \"Finishing the erase…\" chip) and how many bakes were aborted.",
    ["-"], "§7")

# ---- 2026-10-05, the rebuilt tree ----
add("sel._opUnder", "_opUnder(op)",
    "What an action applying `op` can carry out of the selection, read before it runs: the op's frames under a selected frame, and its per-object members listed or under one (A1 C2: the selection is repaired from the op, never from events).",
    ["-"], "§10")
add("sel._repairSelection", "_repairSelection(under)",
    "After a drop, an undo or a redo: what `_opUnder` read before the action is repaired into the selection, quietly — the caller renders.",
    ["-"], "§10")
add("sel._lassoWalk", "_lassoWalk(visit)",
    "The lasso's frame walk: the camera's frame and everything under it, then out through each ancestor at its scale and offset, skipping the branch already walked.",
    ["-"], "§10")
add("sel._familyBounded", "_familyBounded(o, found, frames)",
    "Whether the loop bounds native o's family: every member found, a pending mark, or under an enclosed frame (a piece homed there is taken through it).",
    ["-"], "§10")
add("sel._tornUnder", "_tornUnder(frames, found)",
    "The enclosed frames that may not stand for themselves whole: the path from each keyed native under one whose family the loop does not bound — a ceded kid of a stroke outside — up to the enclosed frame.",
    ["Reads only the keyed natives under enclosed frames (`Document.keyedIn`), never their other ink (REVIEWER-3 LASSO-1: a drag then tore the kid out of its stroke). Since A1 C4 a cede's kids live in private frames under their family's chain, so this is the backstop for kids in shared frames: content from before C4, a kid ceded across its chain's parent cell, a member moved per object."],
    "§10")
add("sel._lassoMoved", "_lassoMoved(poly, box, ink, found, frames)",
    "Judges every displaced native where it is drawn, since a moved native is indexed at its stored bits and the frames' indexes never see its picture (F69); returns the frames a native with its own table drawn outside the loop keeps from being taken whole (H6).",
    ["Under an enclosed frame, the union box already covers what the frame's shift displaces, so only a native with an own table is judged there; elsewhere a displaced native inside the loop joins `found` (DESIGN.md §10, A1 C1)."],
    "§10")
add("sel._judgeLasso", "_judgeLasso(L, poly)",
    "A finished loop's verdict: what it finds becomes the selection; with ctrl, a loop that catches nothing new subtracts what it catches, and one that catches anything new adds.",
    ["A ctrl loop catching nothing new is one drawn purely inside the selection, so it subtracts — one rule that reads the same way round as a group-level toggle."],
    "§10")
add("sel._dropMove", "_dropMove(d)",
    "The drop — a drag's one write (A1 C2): the selected frames re-addressed from their addresses at the press, then each member placed once per (home frame, picture table), and the move recorded as one op.",
    ["Every member of a frame with one table takes the same answer, which registration rests on (DESIGN.md §8): `_displaceMember` puts whole cells into the address and the rest into the member's own table, less the target frame's shift. Frames go first, because a member re-homed into a selected frame's start cell would be moved again by that frame's re-address; the members are listed at the press, because a frame carried out from under a selected one moves its natives itself (F138 seed 70). The store's batch mode is on for the write; the Stage's hold stands, so the table takes the whole displacement at the release. A member the drag could not move is journaled with why (F35). Returns the op pushed (`move`, `moveMany` or `moveFrames`), or null."],
    "§8")
add("sel._tinyHit", "_tinyHit(b, slack)",
    "Whether a mark is smaller than the reach, so it is picked anywhere its box is within reach — the eight probes sit on the reach's ring and missed a sub-pixel dot between them (TESTER-2).",
    ["-"], "§10")
add("sel._marksAt", "_marksAt(items, p0)",
    "The landed marks whose ink covers a frame point, or null: a pick skips their masked targets there, so a press takes what shows (DESIGN.md §7).",
    ["Each mark is read where the Stage places it."], "§10")

# ---- 2026-10-05, the rebuilt tree ----
add("eng.idleHop", "idleHop(fn)",
    "Runs `fn` at idle (`requestIdleCallback` with no forced timeout), else after 30 ms.", ["-"], "§9")
add("eng._prepareView", "_prepareView()",
    "Mints the camera view's picture sources (`TileStore.prepare`) at the first render after a placement, address or camera-frame change — the end of the action that moved them — so no read mints (A1 C3); views a read found wanting are minted then too, or at idle.",
    ["Keyed on the camera's frame, the table revision, the address epoch and the frame count, so a render with none of them changed costs nothing. A view still wanting after the render is prepared at idle and rendered again (DESIGN.md §8: no read settles, mints or changes a table)."],
    "§8")
add("eng._camToLattice", "_camToLattice()",
    "The camera's frame deleted with a subtree (A1 C3: it left the lattice): the camera goes to a fresh frame at the same cell — its chain as the last render read it — with the same coordinates; else the chain is noted. True when it moved.",
    ["What the deleted frame's id cached goes — the store's tiles, the Stage's items, the plates — as frame GC's forget does, because an undo brings the id back (F111). With no chain to follow, the camera goes to the spine at its level."],
    "§10")
add("eng._camToResident", "_camToResident()",
    "A camera whose frame became a co-resident is handed to its cell's resident, with the same coordinates (A1 C3); true when it moved.",
    ["-"], "§8")
add("eng.setLevers", "setLevers(patch)",
    "The Dev levers (A3 §8, `devLevers.js`): the valid fields of `patch` into the engine's config, anything else ignored; on the raster path they take effect at once — the plate budget in one eviction pass, a level-step change at this render's view.",
    ["-"], "§14")
add("eng.setLevelStep", "setLevelStep(s)",
    "Sets the pyramid's level step S — 1, 2 or 3, the Dev panel's toggle — through the levers; returns the step in force.", ["-"], "§14")
add("eng.setPlateBudget", "setPlateBudget({views, ceilingMiB})",
    "Sets the plate store's budget — `views` screens (1–8) under `ceilingMiB` (64–512) — through the levers; returns the pair in force.", ["-"], "§14")
add("eng._listWin", "_listWin()",
    "The window the Stage's table (and the SVG path's list) reads: the camera's frame window, on the raster path grown by the renderer's margin of four view cells, so a plate reaching past the squares the table read is not rendered without that ink (REVIEWER-4 P-1).",
    ["-"], "§9")
add("eng._tableStep", "_tableStep(crossed)",
    "The raster path's camera step (A2 §2.11): the table synced to the window — a window change reads and drops tiles, nothing is rebuilt — then the renderer's step; a frame crossing renders instead.",
    ["-"], "§9")
add("eng._syncStep", "_syncStep()",
    "A camera step without a render: on the raster path the Stage's table is synced to the window from the cache alone and the rest left to `_readIdle`, then the renderer follows the camera.",
    ["-"], "§9")
add("eng._readIdle", "_readIdle()",
    "Reads the tiles a camera step left unread, once the camera has been still for the rest's quiet, a slice at a time at idle (READ_SLICE_MS, shorter on a phone); each slice steps the renderer, whose plan asks for the cells now covered.",
    ["A camera step reads the cache alone, so a tile not read is absent that frame: its cells are drawn from stand-ins and never packed (`covers`, F119). A move during the wait starts the quiet again; a bake is not recalled, as a posted job is not (A3 §2.1)."],
    "§9")
add("eng._pend", "_pend()",
    "The step the next animation frame takes (\"raf\" frames): asked for at the first event and filled by every event until it runs (A3 §5).",
    ["The camera moves at each event, so hit tests and the float arithmetic are what they were; only the consequences wait for the frame."],
    "§9")
add("eng.flush", "flush()",
    "Takes the pending frame step now, if there is one — for a press or a release, the suites and the harness.", ["-"], "§9")
add("eng._frame", "_frame()",
    "One animation frame's step, once: the drag's at the last pointer, then the camera's — a zoom's consequences, else a pan's; else the live stroke's SVG update; else one compose for the plates that arrived.",
    ["The drag recomputes its move from the drag's start (M-4). Stillness is seen only on a frame (A3 §2.1), so the raster path takes one more frame after a camera step to notice the camera is still."],
    "§9")
add("eng._panStep", "_panStep(crossed, t0)",
    "A pan's consequences, once a call or once a frame: on the raster path the table step; on the SVG path a render when the view crossed a cell, changed its visible set or left its window's inner half (F40, REVIEWER-3 CAM-1), else a camera-only update.",
    ["-"], "§9")
add("eng._zoomBy", "_zoomBy(sx, sy, factor, crossedBefore)",
    "Zooms the camera about a screen point: the attention point moved there (the wheel focus or the pinch centre), the camera zoomed, and its consequences taken now or at the next frame.",
    ["The camera's last move is stamped so the bake's slices keep off this frame (`_camBusy`)."], "§9")
add("eng._zoomStep", "_zoomStep(crossed, t0)",
    "A zoom's consequences, once a call or once a frame: on the raster path the table step; on the SVG path a render when a crossing, the visible set, a fat or fade flip, a re-origin or the window demands it, else a camera-only update.",
    ["Outlines are pre-fitted at idle when a stroke nears the gate or a new level activates."], "§9")
add("eng._history", "_history(stack, step)",
    "An undo or a redo: a parked gesture cancelled, the op applied as one commit, the selection repaired from it (A1 C2), the renderer told a user's edit is coming, one render, then frame GC.",
    ["GC runs after the render because a plate drop's mapping can mint a frame. False in a read-only tab or when there was nothing to apply."], "§10")
add("eng.sweepFrames", "sweepFrames()",
    "Frame GC over every frame, called by the saver once a restored store is in (F94); 0 in a read-only tab.", ["-"], "§8")
add("eng.onZoom", "onZoom(cb)",
    "Subscribes `cb(effectiveZoom)` to every status emit that finds the zoom changed — once a frame — so the scale HUD follows a zoom without re-rendering the page (A3 §5, R25 W1); returns the unsubscribe.",
    ["-"], "§12")

# ---- 2026-10-05, the rebuilt tree ----
add("ovl._selFrameContent", "_selFrameContent(f, F)",
    "A selected frame's content where it is drawn, in F's units: the union of its subtree's frames' own natives (`_selFrameInk`) — O(frames), no list read (F103).",
    ["-"], "§10")
add("ovl._selFrameInk", "_selFrameInk(g, F)",
    "Frame g's own natives where they are drawn, in F's units: its index extent moved by its shift and mapped into F; null when it holds none.",
    ["-"], "§10")
add("ovl._selDragStart", "_selDragStart(c, drag, table, F)",
    "Makes a selection-indicator decision the drag's: anchored at the drag's start, with where the selection's ink is then (at rest), since a drag writes nothing until its drop (A1 C2).",
    ["-"], "§10")
add("ovl._selFrameOf", "_selFrameOf(id, table, memo)",
    "The selected frame a native is homed under, or null, memoised by id.", ["-"], "§10")
add("ovl._selMembersAt", "_selMembersAt(table, F)",
    "The ink the selection stands for, each entry's drawn box in F's units: its natives on the scene's list and its own members off it, and every frame under a selected frame by its own natives; null when a native is not drawn.",
    ["Frames are entered by their own natives, so a kid that a drop's rest tears off a selected frame — which the repair then makes a selected frame itself — is the same entry before and after (DESIGN.md §10)."],
    "§10")
add("ovl._selMovedBy", "_selMovedBy(at, table, F, sc, win, vp)",
    "Whether a drag's indicator decision still stands at the drop or a cancel: every piece of ink in both the start's set and now moved by one displacement (to 0.01 px), and the view inside the kept window moved by it and cut short of the ink that entered or left the list; `{d, win}`, else null.",
    ["Ink that entered or left the list — a moved frame's tile pieces at its edges — may not meet the view. Else the decision is remade: re-deciding in the dense scene's drop frame was 338–803 ms (B-PYRAMID-5, DESIGN.md §10)."],
    "§10")
