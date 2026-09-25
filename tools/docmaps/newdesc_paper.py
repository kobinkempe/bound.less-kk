# -*- coding: utf-8 -*-
"""Per-function entries for the paper batch: the engine facade's render list, plate drain, drag
hold and zoom-out ladder (KobinEngine.js), the select gesture and the frame move (selection.js),
the tile cache's reroute, settle re-bake and frame events (TileStore.js), and the SVG renderer's
arc plan, chop window, drag hooks and indicator layers (Renderer.js); since the delta pass also
the plate drain's frame rules, the carries that keep moved ink selected, and loadDrawing (files.js)."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/KobinEngine.js ----
add("eng.listFor", "listFor(frameKey, rect, forCamera)",
    "The render list for any frame and window: its tile pieces and own natives, residuals stamped, sorted by z then id.",
    ["Normalises the frame, reads the tile pieces (`TileStore.content` for the camera's own build, `contentOffCamera` otherwise) and the frame's own natives, copies each object's `editId` onto its pieces, stamps `res` (the object's displacement table as a translation at this frame's depth) and sorts by `(z ?? id, id)`. `_buildList` is this call for the camera; the crossing prebake, the zoom-out ladder and `snapshotView` call it for other frames.",
     "The residual's depth is the listed frame's, never the camera's: a wrong depth draws every moved object at the wrong offset, in a picture nobody is looking at yet (F41).",
     "`forCamera` pins the tiles read and seeds `_footBelow`, the table each object was last drawn with. An off-camera build does neither, or the next plate drain would take the new table for the old address. An unvisited frame pays its tile bake here, synchronously (F59); an off-camera build over 8 ms is logged as `listFor`."],
    "§9")
add("eng._drainPlates", "_drainPlates()",
    "Maps every document event since the last frame onto the plate cache's invalidation rules, at the top of a render.",
    ["Walks the queued events by index (a handler may add more) and skips those a live drag holds (`_heldByMove`). A `neutral` event (an erase bake step under its mark, F90) drops nothing and only updates `_footBelow`. A frame `refile` goes to `_refilePlates`; a merge drops only the merged-away frame's own plates and a split nothing; a frame's list removed or put back goes to `_frameListPlates`. Anything else goes to `PlateStore.onDocEvent` with `_drawnRectIn` as its footprint (a frame event it cannot narrow is a `dropAll` there), and the object's new table is recorded in `_footBelow`. Returns the count; 0 on the SVG path.",
     "Runs after the list build and before the renderer draws, because the build itself emits: `Document.at` settles a moved frame and sends one change per native. The camera-only path reaches it through the renderer's injected `drain`. `_footBelow` is a hint and is cleared past 1,024 entries."],
    "§9")
add("eng._refilePlates", "_refilePlates(ev)",
    "A frame re-addressed (a subtree drag's step or its undo): removes its own plates and those under it, and stales its cell grown by one at the old and new addresses.",
    ["Returns the plates dropped. Kept narrow: a `dropAll` here wiped every stand-in at each step of a frame drag the drag plane refused (899 in one phone report, PAPER-PLAN §10.13)."],
    "§9")
add("eng._cellFootIn", "_cellFootIn(at, G)",
    "Cells, each grown by a subtree's reach, mapped into frame G's units; null when none maps.",
    ["Each `{ parent, i, j }` is the cell's centre in its parent's units, grown by REACH / R: the bound invariant 2 puts on everything under the cell. The footprint `_refilePlates` and `_frameListPlates` stale."],
    "§9")
add("eng._frameListPlates", "_frameListPlates(ev)",
    "A frame's list removed or put back (a subtree delete or its undo): stales every plate of the frame and those under it, and elsewhere its cell grown by one.",
    ["An event naming no natives needs nothing. Returns false for a root or a frame the lattice no longer has, and the drain falls back to `onDocEvent`, which drops every plate."],
    "§9")
add("eng._beginHold", "_beginHold()",
    "At a drag's start, records the members and selected frames whose plate events wait until the drop.",
    ["Raster path only, and only when the renderer's drag plane accepts the selection (`planeAccepts`, which also aims the plane); otherwise `_holdMove` stays null and the drag re-rasters each step. Records each member's id, home frame and table, the selected frame roots, and the roots' footprints in every frame the plate cache holds (`_framesFootIn`).",
     "Taken once, from `_beginSelectDrag`; released once, by `_releaseMove` (PAPER-PLAN R3)."],
    "§9")
add("eng._framesFootIn", "_framesFootIn(frames)",
    "Each selected frame's reach, its cell grown by one, mapped into every frame the plate cache holds or has a job for.",
    ["Returns frame id -> rects. The box is [-REACH, REACH]² in the root's own units, which bounds its whole subtree by invariant 2. Taken at the drag's start and again at the drop, so the drop stales where the subtree was and where it landed."],
    "§9")
add("eng._planeLost", "_planeLost()",
    "The renderer's drag plane can no longer draw the drag: releases the hold once, so each step renders.",
    ["Called by `RasterRenderer` when the camera leaves the plane's frame or the view leaves plates under a live drag. Runs `_releaseMove` and clears the drag's `listAt`, so the ants decide from the list as it stands, which now holds the move. Returns the plates dropped."],
    "§9")
add("eng._heldByMove", "_heldByMove(ev)",
    "Whether a document event belongs to the live drag and must wait for its drop.",
    ["True for an event naming a held member, a `refile` of a dragged frame or one under it, or any event whose frame is under a dragged root (a settle's per-native change). A held event is neither drained nor recorded in `_footBelow`, so the memo keeps the table the object was last drawn with."],
    "§9")
add("eng._underHeldFrames", "_underHeldFrames(level)",
    "Whether a frame is one of the dragged frame roots, under one, or a shadow of either (`LevelMap.isUnder`).",
    ["-"], "§9")
add("eng._planeState", "_planeState()",
    "The selection's ids in the current render list, for the raster renderer's drag plane; null with nothing selected.",
    ["Collects the members' ids (`_selectionMembers`) and adds every listed piece homed under a selected frame, found by its home, so a selected subtree costs the list's length rather than its object count. Memoised on the selection object and the list; returns `{ key, ids }`.",
     "Pulled by `RasterRenderer` each camera step, so the plane is ready before a drag starts (PAPER-PLAN §10 S4). Null on the SVG path."],
    "§9")
add("eng._dragState", "_dragState()",
    "The live drag as the renderer pulls it each frame: the gesture, the held ids and frame roots, and the pointer at the first read.",
    ["Null unless a drag is under way and a plate hold was taken. `RasterRenderer._planeStep` moves its plane by the gesture's `last - start`."],
    "§9")
add("eng._endMove", "_endMove(why)",
    "The one exit of a drag (drop, cancel, delete, deselect, undo): releases everything the drag held, renders once, and keeps selected what the drag moved out of the selection.",
    ["Takes the drag and its carried ids, runs `_dropHold`, then `_render` with `_dropping` set, so the carries that render's settles make join the drag's. Then, on a drop or when anything was carried, `_reselect`s the carried natives and, on a drop, the dragged frames no selected frame holds any more (`_outsideSelection`) (DESIGN.md §10, F93).",
     "On a drop it runs after the move's undo entry is pushed, so a shadow merge the render triggers is recorded on that entry (DESIGN.md §8)."],
    "§6")
add("eng._dropHold", "_dropHold(why)",
    "`_endMove` without the render, for a document event where rendering would re-enter.",
    ["Clears the drag gesture and its carried ids, turns off the tile cache's batch mode and the Document's merge hold, releases the plate hold (`_releaseMove`), and tells the renderer (`endMove(why, dropped)`) if a drag or a hold was live. The selection's document subscription uses it on a reset or when the last member goes."],
    "§6")
add("eng._releaseMove", "_releaseMove()",
    "Releases a drag's held plate events as one collapsed invalidation.",
    ["Drops every plate painting a member, then every plate under the members' drawn boxes at their start and end addresses (`_movedRectsIn`). When frames moved, removes every plate of a moved frame or one under it and stales the subtrees' start and end footprints in the other frames. Clears `_holdMove` first, so it runs once; returns the plates dropped.",
     "PAPER-PLAN §5.4's rules 1-4, applied once per drag instead of once per event."],
    "§9")
add("eng._movedRectsIn", "_movedRectsIn(h, frameId)",
    "Every held member's drawn box in one frame, at its end address and, where it changed, its start address.",
    ["Each box is the bbox plus half the line width, mapped through the member's own home and table (`mapRectObj`). Past 256 members (MOVE_RECTS_MAX) they collapse to one union box a frame. Null when nothing maps.",
     "Over-dropping is safe; under-dropping leaves a plate holding the old picture (F68, F69)."],
    "§9")
add("eng._drawnRectIn", "_drawnRectIn(ev, prev, frameId)",
    "One document event's drawn footprint in a frame, at both old addresses an edit can have.",
    ["The bbox plus half the wider of the old and new line widths, mapped through the object's displacement table. An edit has two independent old addresses, the geometry it had (`oldBbox` on the event) and the table it had (`prev`, from `_footBelow`), so the result is every combination that changed: up to four rects.",
     "A move replaces the table rather than mutating it, so identity says whether it changed. A bare bbox would leave a fat stroke's outer edge on the plates."],
    "§9")
add("eng._crossTarget", "_crossTarget()",
    "The frame and in-frame scale the camera would land at if the crossing it is approaching happened now.",
    ["Past 0.8 of `enter`: the child frame under the view, defined early by `LevelMap.ensureChild` while `preBake` is on (its default). Under 1.25 x `exit`: the parent. The scale is `_crossUp`'s or `_crossDown`'s arithmetic on the same edge record. Null otherwise; it never grows a root.",
     "One copy of the crossing arithmetic: a second copy is what F45 cost."],
    "§9")
add("eng._maybeLadder", "_maybeLadder()",
    "Restarts the quiet timer after which the zoom-out ladder is built at idle.",
    ["Raster path only. Every render and camera step restarts the 300 ms timer (LADDER_QUIET_MS), so nothing is built during a gesture; when it runs out, `_buildLadder` runs at the next idle callback. The renderer also calls it when its drag plane is aimed, since the plane's pins can evict rungs."],
    "§9")
add("eng._buildLadder", "_buildLadder()",
    "Queues the zoom-out ladder: coarse plates for the screens 4x to 4,194,304x zoomed out, then the view just past each crossing in that span.",
    ["Skipped mid-gesture, within 300 ms of a camera move, and when the camera is where the last ladder was built, unless a pinned drag plane has since evicted rungs (rebuilt once a view). Clears the tile cache's warm set, lists the rungs (the first three on a phone) and then the crossing steps, and starts `_ladderRung(0)`. Returns what the first rung posted.",
     "The crossing steps come last so their tile, which a zoom-out crossing otherwise bakes on the main thread (measured 1,199 ms cold, 101 warm, on the Magnum Opus), stays inside TileStore's per-frame cap. Ladder plates are drawn only as stand-ins (DESIGN.md §9)."],
    "§9")
add("eng._ladderCrossings", "_ladderCrossings(maxFactor)",
    "The zoom-out factors, from the camera, just past each level crossing within `maxFactor`.",
    ["Walks up the parent chain with `_crossDown`'s arithmetic, 2% past each exit so the camera would be in the parent; stops at a root or past `maxFactor`."],
    "§9")
add("eng._ladderKey", "_ladderKey()",
    "The camera and the screen size as one string, so a ladder is built once a view.",
    ["-"], "§9")
add("eng._ladderRung", "_ladderRung(k, key)",
    "Builds one ladder rung and schedules the next at the following idle callback.",
    ["Stops when the camera moved (`key` changed), a gesture started, or the engine was destroyed. Computes the zoomed-out view (`_zoomedOut`); builds its list off camera and posts its plates (`ladderPlates`) only when the renderer reports a plate missing, or always for a crossing step, whose purpose is warming the tiles. Tiles it reads are marked warm, so `TileStore.framesLeft` keeps them (F83).",
     "One rung an idle callback because a list build is 100-300 ms of main thread on the Magnum Opus."],
    "§9")
add("eng._zoomedOut", "_zoomedOut(factor)",
    "The view zoomed out `factor`x about the screen centre, computed through each crossing without running a camera.",
    ["Maps the centre up through the parents at `_crossDown`'s scale until the in-frame scale is back at or above `exit`; returns the frame, its scale, and the zoomed-out screen grown 2.5x (LADDER_MARGIN) as the window. Null where the zoom would pass a root.",
     "No `Camera` runs, so no frame is minted."],
    "§9")
add("eng.screenToFrame", "screenToFrame(sx, sy)",
    "A screen point in the camera frame's own units; a pass-through to the camera.",
    ["-"], "")

# ---- src/engine/selection.js ----
add("sel.everyNth", "everyNth(pts, max)",
    "Thins a point list to at most `max` points, for the lasso's hand-precision tests.",
    ["The list itself when it is short enough; otherwise every ceil(n / max)-th point, the last not necessarily included."],
    "§12")
add("sel._selectTap", "_selectTap(P)",
    "A select press that never moved: select, ctrl-toggle, or clear, decided at pen-up.",
    ["On paper a plain tap deselects and a ctrl tap keeps the selection. On ink a ctrl tap toggles the object; a plain tap on a member keeps the whole selection, and anywhere else selects the object under the point (`select`, which applies pending erases over it first).",
     "Nothing changes on the way down: a press may turn out to be the first finger of a pinch (DESIGN.md §10)."],
    "§12")
add("sel._beginSelectDrag", "_beginSelectDrag(P, sx, sy)",
    "A select press that has travelled SELECT_DRAG_PX: decides between a lasso and a move, and starts it.",
    ["A lasso when the press was on paper (and not on a selected frame's mark), with ctrl, or with nothing selected. Otherwise a move: an unselected object under the press is selected alone first, then every pending eraser mark over the selection is applied (`_settleSelectionErases`); if that took the selection away, it lassoes instead.",
     "A move sets up `_dragSel`, turns on the tile cache's batch mode, takes the plate hold (`_beginHold`) and applies the first step.",
     "The erase barrier covers every member, not only the one pressed: ink dragged from under an unapplied mark leaves the mark behind to cut whatever arrives there."],
    "§12")
add("sel.cancelSelectGesture", "cancelSelectGesture(commitIfMoved)",
    "Forgets the select gesture in progress when a pinch starts; a drag that moved is put back, or finished if asked.",
    ["Drops an unmoved press and any lasso. A moved drag is finished as a pen-up when `commitIfMoved` (the shell passes it once the press is old enough to have been deliberate); otherwise each member goes back to its start frame and start table and the dragged frames are restored (`_restoreFrames`). Ends through `_endMove('cancel')`.",
     "Undo and redo call it first when a drag is live: the drag's start records describe the document the undo is about to change."],
    "§12")
add("sel._underFrames", "_underFrames(level, frames)",
    "Whether a frame is one of `frames`, under one, or a shadow of either: the selection's frame rule.",
    ["Uses `LevelMap.isUnder`, which counts shadows; the tile cache uses `isAncestor` instead."],
    "§12")
add("sel._inkedFrames", "_inkedFrames()",
    "Every frame with a native in its subtree: each frame that holds one, and its ancestors.",
    ["Stops climbing at an ancestor already seen. The lasso skips frames outside it and the selection drops them, because a visited cell with nothing under it stands for nothing: a selection holding such cells drew a dot each on blank paper (50 in one report, F93)."],
    "§12")
add("sel._followCarries", "_followCarries(frame, carries)",
    "A settle carried natives across a cell edge, out of or back into a selected frame: queues them to stay selected.",
    ["Subscribed to the document's `settle` ops. During a drag, or its drop's render, natives carried out of a dragged frame or one under the selection wait in the drag's carried set for `_endMove`. Otherwise, from a frame under the selection, they are queued for `_flushCarried` at the render's end, with a microtask as the fallback for a list built outside a render (a ladder rung, a prebake).",
     "Not applied inside the render: a selection change there ran a camera step on the old list and cut the render's perf row short."],
    "§12")
add("sel._flushCarried", "_flushCarried()",
    "Applies the carries queued outside a drag to the selection they were carried out of: at a render's end, or a microtask later.",
    ["Keeps the queued natives whose source frame still exists and is under a selected frame; mid-drag they join the drag's carried set, otherwise `_reselect` adds them. Called at the end of `_render`, by `deleteSelection`, and by the microtask `_followCarries` schedules."],
    "§12")
add("sel._outsideSelection", "_outsideSelection(ids)",
    "Of a set of frame ids, those no selected frame holds any more, coarsest first and none under another.",
    ["The frames a subtree drag or an undo moved out of the selected subtrees (a sub-cell rest re-homed them next door), so they can join the selection as frames."],
    "§12")
add("sel._keepingSelection", "_keepingSelection(fn)",
    "Runs an undo or a redo so that the natives it re-homes and the frames it re-addresses out of the selection stay selected.",
    ["With frames selected, sets `_moving`, which the engine's document subscription fills with re-homed natives that were selected or under a selected frame, and re-addressed frames whose old parent was under one; afterwards `_reselect`s them, the frames through `_outsideSelection`. Returns `fn`'s result."],
    "§12")
add("sel._reselect", "_reselect(ids, torn)",
    "Keeps the selection standing for the same ink after ink crossed cell edges: carried natives join as ids, torn frames as frames, empty frames leave.",
    ["The frames are the selection's plus `torn`. A native no selected frame holds joins the ids; one listed and held by a selected frame again leaves them. Frames with no native under them (`_inkedFrames`) are dropped. Nothing is set when all that already holds; otherwise `_setSelection` (DESIGN.md §10, F93)."],
    "§12")
add("sel._objPointInActive", "_objPointInActive(o, level, p)",
    "A point of a native, mapped into the active frame where its picture is drawn.",
    ["Through the native's displacement table when it has one (`mapPointObj`), else a plain frame-to-frame map. Null when the frames have no path between them."],
    "§12")
add("sel._inkInsidePolygon", "_inkInsidePolygon(o, level, ink)",
    "Whether an object's ink, not only its box, lies wholly inside the lasso; asked of objects whose box straddles the loop.",
    ["First the points the object already has (a stroke's samples, a fill's vertices, a shape's piece ends; a few hundred at most), mapped where the picture is and tested one by one; any outside answers no. Only then is the outline flattened at 3 screen px (LASSO_INK_TOL_PX), capped at 3,000 points a ring, and each ring tested against the prepared loop.",
     "The cheap reject is where most crossed objects leave: flattening a scribble of twenty thousand arcs costs 14 ms even coarsely (measured). An outline that throws answers no."],
    "§12")
add("sel._dragFramesStart", "_dragFramesStart(d, camDepth)",
    "Records, once per drag, the start address and shift of every frame the drag moves as a frame.",
    ["For each selected root not under another: its subtree to three levels below the camera (`LevelMap.subtreeStart`; deeper frames follow their parent pointer), leaving out empty childless containers. Each gets an entry `{ from, to, shiftBefore, shiftAfter, settled, merged }`, which becomes part of the `moveFrames` undo op.",
     "Sets `Document.holdMerges`: a shadow the drag makes is merged only once the op is pushed."],
    "§6")
add("sel._dragFrames", "_dragFrames(d, camDepth, tx, ty)",
    "One drag step for the frames: re-addresses each from its start address, the sub-cell rest kept as a shift on the frame.",
    ["Targets come from the start record (`LevelMap.moveSubtreeTargets`, `displaceFrame`'s arithmetic frame for frame). A frame's new shift is its starting shift plus this step's rest; a frame a render settled mid-drag is unsettled first. The targets are applied in one two-phase `readdressMany`; each changed address is noted (`noteRefile`), the shift set, and the frame's entry recorded as the owner of later settles. Returns whether anything moved.",
     "No native is touched: a frame's shift is settled into its natives' tables at the first read of its list (DESIGN.md §8)."],
    "§6")
add("sel._restoreFrames", "_restoreFrames(d)",
    "Puts a cancelled drag's frames back at their start addresses and shifts, undoing any settle.",
    ["Unsettles each settled frame, re-addresses the moved ones in one `readdressMany`, restores every shift, clears the owner records, and releases the merge hold."],
    "§6")
add("sel._frameUnderPoint", "_frameUnderPoint(sx, sy)",
    "The selected frame whose mark is within 8 px of a screen point, or null.",
    ["The mark is the frame's origin on screen. A press there drags the selection, as a press on selected ink does."],
    "§12")
add("sel._displaceMember", "_displaceMember(from, below, camDepth, tx, ty)",
    "Where one member goes for a drag displacement: its new home frame and table, or why it cannot move.",
    ["Homed at or above the camera's depth: the displacement enters the table at the camera's depth (`addOffset`). Deeper: `LevelMap.displaceFrame` turns the whole-cell digits into a new home and the rest enters the home-level entry. A carry out of the home level moves the member to the neighbour cell. Stored coordinates are never touched (DESIGN.md §8).",
     "Pure in the lattice's state, so `_dragSelection` asks once per (home frame, starting table) and every member sharing those takes the same answer; registration rests on that."],
    "§6")
add("sel._homeShift", "_homeShift(id)",
    "The neighbour cell an object's stored bbox centre lies in, as the re-home that would put it there; null in its own cell.",
    ["Returns `{ level, dx, dy }`, dx and dy the whole-frame shift for its coordinates. Read at pen-up for every member a drag touched; only a non-null answer re-homes (`_normalizeHome`)."],
    "§6")
add("sel._subtreeCount", "_subtreeCount(f)",
    "How many natives a selected frame stands for (its list, its subtree's and its shadows'), for the status count.",
    ["O(frames): sums `Document.count` over `LevelMap.walk`, reading no native."],
    "§12")

# ---- src/engine/files.js ----

# ---- src/engine/TileStore.js ----
add("ts.flattenAll", "flattenAll(objs)",
    "Turns derived pieces' loops into stored Loops, so a cached tile holds eight doubles a piece.",
    ["In place, and returns the list. The freeze and the chop hand over transient piece arrays; the cache keeps the `Loop` form the document's natives use."],
    "§7")
add("ts.contentOffCamera", "contentOffCamera(F, rect)",
    "`content` for a frame the camera is not at, without unpinning or evicting the camera's own tiles.",
    ["Saves the pin set by value, holds eviction for the read, restores the pins and evicts once. With `warmReads` on (the ladder, the crossing prebake) the tiles it read go into the warm set, which `framesLeft` keeps.",
     "By value because `content` mutates `_pins` in place before replacing it. The tiles this bakes stay cached and evictable."],
    "§9")
add("ts.clearWarm", "clearWarm()",
    "Returns the last ladder's warm tiles to the ordinary eviction rules; called as a new ladder starts.",
    ["-"], "§9")
add("ts._reroute", "_reroute(F, win, out, pins)",
    "Swaps moved objects' pieces for the ones read from where their picture is: the frame their table's whole cells point to, over the shifted window.",
    ["Drops every moved object's pieces from F's own tiles, then for each group from `_rerouteGroups` reads and pins the source frame's tiles over the window shifted back by the remainder, keeping only the group's ids. The pieces are painted translated by that remainder (`res`, stamped in `listFor`).",
     "Tiles are in unmoved space: a move invalidates no tile, it only changes which tiles a moved object is read from (F55, DESIGN.md §8)."],
    "§6")
add("ts._rerouteGroups", "_rerouteGroups(F)",
    "The moved objects to be read from another frame at F, grouped by source frame and remainder; memoised.",
    ["Skips objects homed at F (natives, rendered live) and those homed deeper than F, which the residual draws. For the rest `LevelMap.objShift` names the source frame and remainder; objects sharing both form one group, so each tile is scanned once a group.",
     "Memoised per frame on the document's `rev`, the lattice's `addrEpoch` and its frame count, for the last four frames; a key that changed during the walk is not kept. Measured: the walk was 70 ms of a 113-140 ms list build on the Magnum Opus (16,889 tables, jsdom)."],
    "§6")
add("ts._bakeSettled", "_bakeSettled(bake)",
    "Runs a tile bake again when the document changed under it, at most three times (F78).",
    ["A bake reads frames through `Document.at`, which can settle a moved frame's shift and carry its natives into a frame the bake has already passed; the tile is not cached yet, so no event patches it. `rev` bumps on every emit; a bake that saw it move is repeated and counted in `_rebakes`. After three tries the last result stands."],
    "§9")
add("ts._upPiecesOver", "_upPiecesOver(parentId, pr, only)",
    "The parent's magnified pieces over a rectangle, one square's copy of each object when the rectangle straddles squares.",
    ["Inside one parent cache square: that square's up pieces. Across several: the square holding the rectangle's centre, and another square's piece of an object only when the centre square's clip does not cover the rectangle. `only` limits it to one object id; its one caller passes null.",
     "Two squares' pieces are the same ink with clip vertices rounded on different rectangles, and 4,096x per crossing later the copies diverged by thousands of units (F42). The erase's descent cedes the same square by the same rule."],
    "§9")
add("ts._downSources", "_downSources(F, rect)",
    "The frames a down tile of F reads: every non-ancestor at F's depth or deeper whose cell, grown by one, meets the tile.",
    ["Walks F's subtree, then out through each ancestor into its other children's subtrees, carrying scale and offset into F's units; a subtree whose cell grown by one (REACH, invariant 2) misses the tile is skipped whole. Lists only frames with natives, counted with `Document.count`, which settles nothing. Ascending depth.",
     "A native overhanging its frame's neighbours is not found, as with the ring pickup (DESIGN.md §9)."],
    "§9")
add("ts.chainSeq", "chainSeq(F)",
    "The sum of the address sequence numbers of F and its ancestors, stamped on every tile built at F.",
    ["A tile built under an older sum read its content through an address a subtree move has since changed, and is rebuilt on its next lookup; no walk over the moved subtree is needed. Memoised per frame for one lattice `addrEpoch`."],
    "§6")
add("ts._onFrameEvent", "_onFrameEvent(ev)",
    "A frame moved, was set aside, came back or merged: drops every cached tile its footprint touches, at the old address and the new.",
    ["The footprint is the frame's cell grown by its subtree's reach (invariant 2), in the parent's units, at its current address (the recorded one for a merged frame) and, for a `refile`, its previous one; mapped into each cached tile's frame and tested against the tile padded by the seam pad. A merged frame's own tiles are deleted outright.",
     "Tiles of the moved subtree itself go stale through `chainSeq`; a table change drops nothing (F55)."],
    "§6")
add("ts.framesLeft", "framesLeft(F)",
    "The camera has moved to frame F: drops every cached tile except F's ancestors', those just pinned by the camera's read, and the ladder's warm ones.",
    ["Called by `_buildList` after its read, so the tiles `_reroute` read from other frames survive. Returns the count dropped.",
     "Keeping the warm tiles is F83: dropping them re-baked cold the tiles the zoom that followed needed (measured 440 -> 64 ms for the first list in jsdom)."],
    "§9")

# ---- src/engine/Renderer.js ----
add("rnd.pushMove", "pushMove(verts, pt, og)",
    "Appends a move anchor at a point, relative to the scene origin.",
    ["-"], "§9")
add("rnd.pushLine", "pushLine(verts, A, B, og, ctx)",
    "Appends a line as anchors, split into equal parts when the length split is on and the line is not a seam.",
    ["A line longer than `ctx.segMax` is cut into ceil(len / segMax) parts unless it lies on the rectangle that cut its piece. `segMax` is 0 unless the `Renderer.lengthChop` dev toggle is on, so in the app a line is one anchor."],
    "§9")
add("rnd.pushArcPiece", "pushArcPiece(verts, p, og, ctx)",
    "Appends one arc piece by its once-per-piece plan: SVG arc commands, or kappa cubics built from its ends and sweep.",
    ["A line, or an arc with no finite radius, goes through `pushLine`. Otherwise `planArc` chooses at the quarter-pixel tolerance and the frame's deepest zoom: the arc command while the browser's float32 centre is within tolerance, else as many centre-free cubics as the sixth-root law needs. A cubic's first handle is written onto the previous anchor. Each anchor carries `_mid`, the part's midpoint, for the thin rescale.",
     "The plan never changes while zooming (DESIGN.md §9, F40)."],
    "§9")
add("rnd.pushRingAnchors", "pushRingAnchors(verts, poly, og, ctx)",
    "Appends a polygon ring as a move and lines; the closing edge is written out only when long enough to be split, otherwise the fill closes it.",
    ["-"], "§9")
add("rnd.areaBounds", "areaBounds(o)",
    "An area piece's bounds for the chop window's verdict: a shape by its true arc extremes, a fill by its points.",
    ["-"], "§9")
add("rnd.asClip", "asClip(clip)",
    "A tile piece's clip rectangle in the form the seam test takes, with its tolerance.",
    ["-"], "§9")
add("rnd._renderOverlays", "_renderOverlays(view)",
    "Redraws what follows the camera over the ink: the tile and erase debug views, the lasso, and the selection indicator.",
    ["Called from `syncWorld`, so on every render and camera-only frame. The raster renderer passes its published view, so the ink and the overlays take one mapping (RASTERISER-PLAN §2.5 seam 1)."],
    "§9")
add("rnd._syncWorldTransform", "_syncWorldTransform()",
    "Writes the world group's scale and translation, folding the scene origin in at float64.",
    ["`translation = inPan + inScale * origin`: anchors are origin-relative, and the cancellation between the pan and the scaled origin happens here in doubles, so nothing large reaches Two.js's float32 matrices or the browser (DESIGN.md §9). `RasterRenderer` overrides it to take the snapped translation from its view."],
    "§9")
add("rnd._chopHolds", "_chopHolds(chop)",
    "Whether a scene's chop window still holds: the view inside its inner half, the zoom under 4x the zoom it was chosen at.",
    ["-"], "§9")
add("rnd.needsWindowChop", "needsWindowChop()",
    "Tells the engine a camera-only frame must become a full render, because the view has left its chop window's budget.",
    ["False mid-stroke (the live path's anchors must not move under the pen) and with the chop off. The full render chooses a new window and rebuilds only the groups that straddle it, before the old edge can reach the screen (F40). `RasterRenderer` returns false."],
    "§9")
add("rnd._maybeRechop", "_maybeRechop(sc)",
    "Chooses the scene's chop window afresh, centred on the view, when it has none or the last no longer holds.",
    ["The window is +-`_chopPx` device px (2^18 for the default config) at the current zoom, under a new key. Nothing is rebuilt here: the key enters the signature of every piece that straddles the window, and the diff rebuilds exactly those."],
    "§9")
add("rnd._chopFor", "_chopFor(o)",
    "The chop window an area piece must be clipped to, or null when it can go to the browser whole.",
    ["Null for a piece inside the window or wholly outside it (hundreds of screens off, where what the browser makes of far coordinates cannot show), and for anything but a shape or a fill. A tile piece is settled first by the rectangle it was cut on; otherwise by its bounds, a pass over a fill's points. A piece with a residual is judged against the window shifted back. Memoised per render: the signature asks, then the build."],
    "§9")
add("rnd._pushArea", "_pushArea(verts, o, og)",
    "Appends one area piece, a shape's arcs or a fill's rings, as anchors, clipped to the chop window where it reaches past it.",
    ["The residual is folded into the origin the anchors are taken against, and the window shifted to match, so the piece's geometry is untouched. A shape is cut by `shapeLoopsInRect` (exact on arcs; the window quad when the window lies wholly inside the ink), a fill by `clipRingsToRect`. The cut exists only in this build; the selection indicator and the erase overlay read the whole piece."],
    "§9")
add("rnd._planFor", "_planFor(o)",
    "The arc plan for one piece: the frame's constants plus the piece's clip rectangle, so its seams are known.",
    ["A covering quad (classifyUp's solid tier) takes the plan with no length split: its edges are the tile's own, overlapped by the neighbours."],
    "§9")
add("rnd.setDragState", "setDragState(fn)",
    "Registers the engine's live-drag getter, pulled each frame by a renderer that draws the dragged ink itself.",
    ["The SVG renderer only stores it; `RasterRenderer` reads it each camera step to move its drag plane (PAPER-PLAN R3)."],
    "§9")
add("rnd.setPlaneState", "setPlaneState(fn)",
    "Registers the engine's getter for the selection a drag plane is kept ready for.",
    ["Stored and unused here; `RasterRenderer` overrides it and aims its plane from it (PAPER-PLAN §10 S4)."],
    "§9")
add("rnd.endMove", "endMove()",
    "The engine's notice that a drag ended; nothing to do in the SVG renderer.",
    ["`RasterRenderer.endMove(why)` lands its drag plane on a drop and drops it on any other end."],
    "§9")
add("rnd._renderSelChevrons", "_renderSelChevrons(edges, kt, W, H)",
    "Draws the breathing chevrons that point where a selection carries on past a side of the screen.",
    ["One pooled path per edge run marked `chevron`, 24 px in from its side at the run's middle and rotated to face out, in the `bl-sel-edges` layer. Returns how many were drawn.",
     "The raster overlay calls this same method, so the chevrons have one implementation on both paths."],
    "§12")
add("rnd._antPath", "_antPath(width, nonScaling)",
    "Makes one ant path element: no fill, the terracotta, butt caps, the `bl-sel-ants` class.",
    ["A non-scaling stroke unless told otherwise, so the band and the dashes stay in screen pixels under the layer's transform; the screen-edge runs pass false."],
    "§12")
add("rnd._mkSelLayer", "_mkSelLayer(svg, host, cls)",
    "Makes one indicator `<svg>` layer, laid exactly over the drawing's own and promoted to its own compositing layer.",
    ["Absolutely positioned at the drawing's offset within the host, no pointer events, `will-change: transform`. The SVG renderer builds two (`bl-sel-layer`, `bl-sel-edges`); the raster one builds the edge layer only.",
     "Its own layer so the crawl repaints the ants and not the drawing: measured 50 ms a frame with the ants in the drawing's `<svg>`, 16.7 split out (DESIGN.md §9)."],
    "§12")


# Existing descriptions of functions in this batch's files that are now FALSE.
GONE_BAKE = ("Went with the windowed fat-stroke display bake, deleted 2026-09-14 (ROADMAP S7, DESIGN.md §15). "
             "A camera-only frame is now promoted to a full render by `needsReorigin` and `needsWindowChop`.")
FIX = {
    "eng.redo": {
        "why": "the undo · redo row's text does not say redo runs inside `_keepingSelection`",
        "what": None,
        "long": ["The mirror of `undo`: cancels a live drag, runs `Document.redo` inside `_keepingSelection`, re-schedules the bake and renders. Returns false when nothing was redone."],
    },
    "fil.loadDrawing": {
        "why": "the serializeDrawing · loadDrawing row's text does not mention `{ render: false }`, the restore path (STALL 2026-09-23)",
        "what": None,
        "long": ["In order: decode (it throws first), load the lattice, mint every frame the natives name, drop the bake queue, load the natives (the reset event clears the tiles, the selection and, on the raster path, the plate memo and the carried picture), set and settle the camera into a legal zoom, clear the erase bookkeeping and any cut in flight, reschedule the bake, take the file's name, scale bar and scenes, clear the renderer, render, and queue idle outline fits.", "`{ render: false }` skips the render: the store restore (`useKobinEngine.restoreFrom`) and `foldStore` load the snapshots this way, replay the op log, and render once, a task later (on the Magnum Opus the load and a cold render were one 5-7 s task, STALL 2026-09-23)."],
    },
    "sel._selectionStatus": {
        "why": "the row's text does not say a frame under another selected frame is counted once",
        "what": None,
        "long": ["The count is the ids plus each selected frame's subtree count (`_subtreeCount`); a frame under another selected one is counted once, through that one. Style is not reported: nothing downstream edits a selection's colour, width or opacity."],
    },
    # ---- KobinEngine.js ----
    "eng.KobinEngine": {
        "why": "says the file is 855 lines holding only the shape of a gesture; it is 1,535 lines and also owns listFor, the raster path's plate drain, the drag's plate hold and the zoom-out ladder",
        "what": None,
        "long": ["Wires the frame lattice, the document, the camera, the tile cache and a renderer together (the SVG `Renderer`, or `RasterRenderer` with a `PlateStore` when constructed with `raster`) and routes input to whichever one owns it.",
                 "Its own methods: construction and teardown, the compat accessors, the tool and style setters, the perf log and journal, the render list (`_buildList`, `listFor`), the raster path's plate drain, the drag's plate hold and its one exit (`_endMove`), the crossing prebake and the zoom-out ladder, pan and zoom, pointer input, undo, redo and clear (DESIGN.md §15).",
                 "Five files are mixed onto the prototype by `mixin.js` (erasePipeline, overlays, selection, files, sceneOps); their methods run with `this` bound to the engine, and `mixin` throws if two claim one name. The quasi-private surface is pinned by `KobinEngine.contract.test.js`."],
    },
    "eng.setTool": {
        "why": "calls the setters plumbing except trace; setTool also drops the selection when leaving the select tool",
        "what": None,
        "long": ["Tool and diagnostic settings, mostly plumbing. `setTool` drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean."],
    },
    "eng.setOutlineMode": {"why": "gone", "what": None, "long": ["Went with the renderer's windowed fat-stroke bake (ROADMAP S7). Nothing replaced it; `setLazyOutlines` remains."]},
    "eng.setKDebug": {"why": "gone", "what": None, "long": ["Nothing replaced it. The engine's debug views are `setDebug`, `setTileDebug` and `setEraseDebug`."]},
    "eng._outlinePad": {"why": "gone", "what": None, "long": ["Went with the windowed fat-stroke bake (ROADMAP S7); nothing replaced it."]},
    "eng.pointerDown": {
        "why": "names the logged op `pointerDown`; it is `ptrDown`, and the time also goes to the `_noteFast` distribution",
        "what": None,
        "long": ["The public entry for a press: times `_pointerDown` and records it as `ptrDown` in the operation log (past the 8 ms floor, or always in trace mode) and in the `_noteFast` distribution.",
                 "Input handlers are where a user feels cost, so the boundary is what is measured."],
    },
    "eng._pointerDown": {
        "why": "says the select tool hit-tests and starts a move or a lasso on the way down; it only records the press, and a later move or pen-up decides",
        "what": None,
        "long": ["Starts the gesture, by tool. First a stroke still open (its pen-up never arrived) is finished as a pen-up would, and a select press or lasso left behind by a tool change is dropped.",
                 "**Pan**, or any press while `readOnly` (another tab or device has the pen): remember the point. **Whole-object eraser**: delete what is under the point. **Area eraser**: start a background-coloured stroke through the pen pipeline; the cut happens later, in the background.",
                 "**Select**: nothing changes on the way down. The press is recorded with what lies under it (`_selPress`); `_pointerMove` turns it into a lasso or a move once it travels SELECT_DRAG_PX, `_pointerUp` treats it as a tap if it never did, and a pinch forgets it (`cancelSelectGesture`).",
                 "**Pen**: allocate an id, build the stroke at the pen width over the zoom, attach its live arc chain (`_startPen`), add it to the document as live (unindexed while it grows), and hand it to the renderer."],
    },
    "eng._pointerMove": {
        "why": "omits the select press, which becomes a lasso or a move only past SELECT_DRAG_PX (`_beginSelectDrag`)",
        "what": None,
        "long": ["Extends what `_pointerDown` started. Pan (or read-only) moves the camera; the whole-object eraser erases under the point; the area eraser falls through to the pen path, because it is a stroke.",
                 "Select: a lasso appends a point once the pointer has moved more than a pixel; a press waits until it has travelled SELECT_DRAG_PX, then `_beginSelectDrag` decides lasso or move; a move in progress takes one `_dragSelection` step.",
                 "Pen: the sample goes into the stroke and its live arc chain, which rebuilds only the last two gaps, O(1) a point; the line tool replaces its second point and re-seeds a two-sample pen instead."],
    },
    "eng._startPen": {
        "why": "says the straight-line tool gets no live chain; every stroke gets one, the line tool re-seeding a two-sample pen on each move (the Code Map row's `straight` parameter is gone too)",
        "what": None,
        "long": ["Attaches a live arc chain (`BiarcPen`) to a stroke about to be drawn, seeded with its first sample, at a tolerance of half the arc tolerance at the zoom it is drawn at.",
                 "Every stroke gets one, the line tool included. The swap from the live chain to the resolved shape is the only moment their difference could show, and at this tolerance it is sub-pixel there."],
    },
    "eng._pointerUp": {
        "why": "says a drag re-homes every moved object and misses the tap; the drag re-homes only members whose bbox centre left their cell, records tables and frames, and ends through `_endMove`",
        "what": None,
        "long": ["Ends the gesture. **Tap**: a select press that never moved goes to `_selectTap`. **Lasso**: apply the loop if it moved and has three points, then always redraw the selection layer, or the loop stays on screen.",
                 "**Drag**: if anything moved, each member whose stored bbox centre has left its cell is re-homed by whole frames (`_normalizeHome`, the one case a move writes coordinates, so its entry keeps geometry snapshots); the move is journaled and pushed as one undo entry, `moveFrames` when frames moved, else `move` or `moveMany`, each member's frames and tables either side. Then `_endMove('drop')`, after the op is on the stack.",
                 "**Stroke**: journal it before its samples go, end the live path, finalise it in the document, queue its perimeter resolve and schedule the bake. An eraser pushes one `eraseCommit` entry its background cuts append to; anything else one `add`. Then the one render a pen-up makes."],
    },
    "eng.zoomFactorAt": {
        "why": "lists five questions that force a full render; there are six (the chop window is missing), and the ladder timer restarts",
        "what": None,
        "long": ["Zoom about a point; wheel and pinch both arrive here. The camera applies it, possibly crossing a level or stepping into a neighbouring cell.",
                 "A full render when the level was crossed, the visible tile set changed, a pending fat stroke must flip to its outline, a piece crossed the fully-present line, the view drifted past the re-origin budget, or it left the chop window's budget. **Otherwise one transform is written and nothing is rebuilt.** On the raster path the last three are always false.",
                 "Then the crossing prebake at idle, the ladder's quiet timer restarted, and idle outline fits queued after a crossing or when fat strokes near the gate."],
    },
    "eng.panBy": {
        "why": "says only the visible tile set and re-anchoring can force a render; leaving the chop window's inner half does too",
        "what": None,
        "long": ["Pan by a pixel delta. A full render when the visible tile set changed, the view drifted past the re-origin budget, or it left the chop window's inner half; otherwise one transform. Restarts the ladder's quiet timer."],
    },
    "eng._maybePrebake": {
        "why": "says it warms the child's tiles; it warms whichever frame the approaching crossing leads to, up or down, and on the raster path rasters that view's preview plates",
        "what": None,
        "long": ["Near a crossing (`_crossTarget`), queues one idle callback that re-checks the target, builds its render list off camera over the view mapped into it (which bakes its tiles, kept warm for the zoom), and on the raster path posts preview plates for it (`prebakePlates`, unpinned).",
                 "Fire-and-forget and idempotent. On the way up the child may be defined early (`preBake`, on by default): a child's crossing record is fixed when first defined, so a frame made on the approach is the one the crossing will use."],
    },
    "eng.undo": {
        "why": "says undo, redo and clear each re-schedule the background worker; clear does not, undo and redo cancel a live drag, run inside `_keepingSelection`, and are refused while read-only",
        "what": None,
        "long": ["Undo and redo cancel a live drag first (its start records describe the document about to change), run the document's undo or redo inside `_keepingSelection`, so the natives and frames it moves out of the selected frames stay selected, then re-schedule the background bake and render, because reversing an action can leave strokes unresolved or erases unapplied. Clear drops the bake jobs and resets the document, the lattice, the camera and the renderer. All three do nothing while `readOnly`."],
    },
    "eng.KobinEngine.constructor": {
        "why": "the Code Map row (constructor · resize · destroy) covers only the stale-selection subscription; the constructor also queues document events for the plate drain, tagging a bake step's as neutral (F90), follows settle carries so carried ink stays selected (F93), and re-renders when a hidden tab is shown",
        "what": None,
        "long": ["Builds the lattice, the document, the camera, the tile cache and a renderer (with `raster`, a `PlateStore` and a `RasterRenderer`, and a document subscription that queues every event for `_drainPlates`, tagged `neutral` during an erase bake step that changes no pixel, unless the mark's step passes ink it left uncut that now lies above it: `_uncut`, dropped on a reset or when the mark goes), then the tool state, bake queues, instruments, journal and scene index.",
                 "Keeps the selection true: settle carries out of a selected frame go to `_followCarries`; a document event drops a member that vanished, turns a merged selected frame into its ids plus its kids that hold ink, and during an undo or a redo records what moves out of the selection for `_keepingSelection`."],
    },
    "eng._render": {
        "why": "misses what a render now does beyond list, draw and status: the plate drain, the raster perf row opened before the list build, and the carries its settles made applied to the selection at its end (F93)",
        "what": None,
        "long": ["A full render: on the raster path the frame's perf row opens first; then `_buildList`, `_drainPlates` (after the build, which itself emits), the renderer's render and update, and status. Carries queued by this render's settles are applied to the selection at its end (`_flushCarried`, F93). Ends by poking the frame meter and restarting the ladder's quiet timer.",
                 "The frame meter is poked here as well as in gestures: the worst stall seen was a cold one, opening a drawing at a deep camera."],
    },
    "sel._applyLasso": {
        "why": "misses the erase barrier: the pending eraser marks the loop meets are baked out before the find (`_settleLassoErases`)",
        "what": None,
        "long": ["Turns a finished loop into a selection change. First every pending eraser mark whose box meets the loop is applied (`_settleLassoErases`), so the lasso finds the cut-outs rather than the ink under an unapplied mark.",
                 "Plain: replace the selection, or deselect when the loop caught nothing. Ctrl with the loop catching anything new: add. Ctrl with the loop catching nothing new (drawn inside the selection): remove."],
    },
    # ---- selection.js ----
    "sel._selectableRects": {
        "why": "calls it the lasso's candidates; nothing in the engine uses it, `_lassoFind` walks the frame tree, and it stays as the ground truth the suites check the walk against",
        "what": "Every native with its box in the active frame: the brute-force ground truth the lasso's tree walk is checked against.",
        "long": ["Walks every frame's natives through `Document.at` (which settles pending shifts) and maps each box with `_rectInActive`. No production caller."],
    },
    "sel._lassoFind": {
        "why": "says an enclosed box's objects are taken; an enclosed frame is one entry of the selection with nothing under it read, a frame with no ink under it is skipped, and the result is `{ ids, frames }`",
        "what": None,
        "long": ["Finds what a lasso fully encloses by walking the frame tree outward from the active frame, one hop at a time: **out of reach** skips a frame and its subtree; **enclosed** makes the frame one entry of the selection, nothing under it read; **straddling** asks the frame's index and tests each candidate's box, then its ink (`_inkInsidePolygon`) where the box meets the loop's box. A frame with no native in its subtree (`_inkedFrames`) is skipped, so an empty visited cell is never selected (F93).",
                 "Objects with a displacement table are indexed at their stored bits and drawn elsewhere, so each one the active frame can reach is judged again where its picture is (F69). A family is taken only when every piece is in; a keyless native is a family of one. Returns `{ ids, frames }`.",
                 "The prune rests on invariant 2: a frame's subtree lies inside its cell grown by one (DESIGN.md §10)."],
    },
    "sel._setSelection": {
        "why": "says it pulls in each object's family; it stores the live ids and existing frames as given, and families are resolved by `_isSelected` and `_selectionMembers`",
        "what": None,
        "long": ["Installs ids and frames as the selection, keeping only live ids and frames the lattice still has; with neither it deselects. The primary member (id, edit key, level, object) is the first live id, or the first frame when there are no ids.",
                 "Families are not expanded here; `_isSelected` and `_selectionMembers` resolve them. Redraws the overlays with a camera-only sync and emits status."],
    },
    "sel._selectionRect": {
        "why": "says it is in screen coordinates, is the drag's anchor and is what the Renderer draws; it is in the active frame's units, has no production caller, and the drag measures from the press point",
        "what": "The visible union of the selection's families in the active frame; read only by the suites.",
        "long": ["Unions the drawn boxes (bbox, half the line width, the residual) of every listed piece whose family is selected. With none drawn: the primary member's box where its picture is (F68), or failing that its box in its own frame."],
    },
    "sel._dragSelection": {
        "why": "says members translate their coordinates or add the sub-box remainder to them; no stored coordinate is touched: whole cells re-home, the rest enters the displacement table, and selected frames are re-addressed",
        "what": "One drag step: each member's new home and displacement table from the displacement since the drag started, and the selected frames re-addressed.",
        "long": ["Recomputed from where the drag started. The displacement is snapped to 2^-10 of the camera level's unit (F55); each member's new home and table is computed once per (home frame, starting table) (`_displaceMember`); re-homes are one `rehomeManyById` a target frame, table changes one `setOffsetsById` each. **No stored coordinate is touched** (DESIGN.md §8).",
                 "Selected frames move as frames (`_dragFramesStart`, `_dragFrames`). With the raster drag plane drawing the move, the step is a camera-only sync and no list is built; otherwise it renders.",
                 "Members sharing a home frame and a table take one answer, so their relative positions cannot drift. A member it could not move is recorded with why and journaled at pen-up (F35)."],
    },
    "sel._normalizeHome": {
        "why": "says a drag puts the whole displacement into coordinates; a drag changes only the table and the address, and this re-homes, at pen-up, a member whose stored bbox centre lies outside its cell",
        "what": None,
        "long": ["At pen-up, for a moved member whose stored bbox centre lies in a neighbouring cell (`_homeShift`): re-home it there and shift its coordinates by the whole frames, so invariant 2 holds again. Exact, because neighbouring origins differ by exactly W, a power of two.",
                 "The only place a move writes coordinates, so that member's undo entry keeps geometry snapshots."],
    },
    "sel._selectionMembers": {
        "why": "says every object the selection covers; selected frames are not expanded, so it returns the selected ids and their families only",
        "what": None,
        "long": ["The selected ids plus the rest of each one's family, de-duplicated, as document records. Selected frames are not expanded: the drag moves them as frames and delete sets them aside as containers."],
    },
    "sel.deleteSelection": {
        "why": "covers objects only; selected frames are deleted too, as containers, the op is `eraseMany`, `removeFrames` or `deleteMany`, and pending carries and a live drag's torn-out frames join the selection first",
        "what": None,
        "long": ["First brings the selection up to date: pending carries are applied (`_flushCarried`), and mid-drag the carried natives and the frames the drag tore out join it (`_reselect`).",
                 "Then removes every selected id and its family one by one, and every selected frame's subtree as containers (`Document.removeFrameSubtree`, O(frames)), skipping a frame under another selected one. One undo entry: `eraseMany`, `removeFrames`, or `deleteMany` holding both. Ends a live drag through `_endMove('delete')`, then deselects and renders."],
    },
    # ---- TileStore.js ----
    "ts.setOpacityGroups": {
        "why": "says the epoch moves instead of the cache being cleared; `bumpEpoch` moves the epoch and clears the cache",
        "what": None,
        "long": ["A policy change invalidates the whole cache at once: `bumpEpoch` moves the epoch counter and clears the map, and a tile stamped with an old epoch fails its check."],
    },
    "ts._depth": {
        "why": "names a deepest-content helper; only `_minContentDepth` exists",
        "what": None,
        "long": ["`_depth` is a frame's depth, 0 when unknown. `_minContentDepth` is the shallowest depth any frame with natives has, which lets `_bakeUp` return nothing when the parent is coarser than all content."],
    },
    "ts.content": {
        "why": "describes only the tiles covering the window; a moved object's pieces are swapped for ones read from another frame (`_reroute`)",
        "what": None,
        "long": ["Everything to draw at one frame inside one window. Works out which cache tiles the window covers and takes both content classes from each, coarser ink magnified in and finer ink minified in, building either on demand.",
                 "When any object has a displacement table, `_reroute` replaces moved objects' pieces with those read from where their picture is. Then pins exactly the tiles read and evicts down to the caps."],
    },
    "ts._ensureUp": {
        "why": "rebuilds only on a miss or an epoch change; it also rebuilds when `chainSeq` changed (a subtree move), and bakes through `_bakeSettled`",
        "what": None,
        "long": ["Returns a magnify tile, building it when the cache misses, the epoch moved, or the address sequence of the frame and its ancestors (`chainSeq`) changed. The bake runs through `_bakeSettled`, so a settle under it re-runs it (F78).",
                 "Pins the tile before baking, so the recursion through the parent's tiles cannot evict it."],
    },
    "ts._ensureDown": {
        "why": "builds only on a miss; it also rebuilds on an epoch or `chainSeq` change, and bakes through `_bakeSettled`",
        "what": None,
        "long": ["Returns a minify tile, building it when the cache misses, the epoch moved or `chainSeq` changed. The bake runs through `_bakeSettled` (F78)."],
    },
    "ts._bakeDown": {
        "why": "says every content-bearing non-ancestor frame is gathered and a size test stops early; candidates come from the tree walk `_downSources`, and frames are skipped, not stopped at, by a size bound and their index's extent",
        "what": None,
        "long": ["Builds one tile of finer and sideways ink minified into this frame. Candidates come from `_downSources`, in depth order.",
                 "A frame is skipped whole when even the largest possible object would be under the fade floor, or when its index's extent (`Document.frameExtent`) is under it or misses the tile. Per object: its size at this frame's deepest zoom (view-independent, so the verdict does not flicker) culls it below `fadeLoPx` and tags it for the fade; then a box test against the tile, one direct projection, and `_downPieces`.",
                 "One jump is safe here at any distance because minifying only shrinks coordinates."],
    },
    "ts._onDoc": {
        "why": "says an edit patches out and in; a change that only moves the table or an attribute is ignored, frame events go to `_onFrameEvent`, and a reset clears the cache",
        "what": None,
        "long": ["Routes a document event to the cache: a reset clears it; a frame event (`refile`, `removeFrame`, `addFrame`, `mergeFrame`, `splitFrame`) goes to `_onFrameEvent`; a removal filters pieces out; an add or finalise patches pieces in, a live add waiting for its finalise.",
                 "A change marked `offsetsOnly` or `attrOnly` is ignored: a move changes nothing a tile is made of (F55). Any other change removes and re-adds."],
    },
    # ---- Renderer.js ----
    "rnd.Renderer": {
        "why": "calls it the only class that touches Two.js and the app's renderer; `RasterRenderer` extends it and imports Two.js too, and this SVG renderer is behind `?svg`",
        "what": "The SVG renderer, behind `?svg`, and the base class the raster renderer extends.",
        "long": ["Owns the Two.js scene: one persistent group per object id sorted by (z, id), the per-frame diff by signature, retained per-level scenes, the per-scene origin and chop window, the live pen path, and the lasso and selection-indicator layers.",
                 "`RasterRenderer` subclasses it, drawing the ink into plates and keeping the live stroke and the chevrons from here (DESIGN.md §9). The engine's own default is this renderer, so the suites and the one-off engines are SVG."],
    },
    "rnd.pushCubicChain": {"why": "gone", "what": None, "long": ["Replaced by `pushArcPiece`, which writes each arc by its once-per-piece plan: the SVG arc command, or kappa cubics."]},
    "rnd.needsRebake": {"why": "gone", "what": None, "long": [GONE_BAKE]},
    "rnd._windowCovered": {"why": "gone", "what": None, "long": [GONE_BAKE]},
    "rnd.outlinePad": {"why": "gone", "what": None, "long": [GONE_BAKE]},
    "rnd._fatPolys": {"why": "gone", "what": None, "long": ["Deleted with the windowed fat-stroke bake (ROADMAP S7). A fat stroke is drawn only as its curve-capsule outline (`ensureOutline`, `_buildOutlineInto`)."]},
    "rnd.extendLive": {"why": "gone", "what": None, "long": ["`setLiveArcs` draws the live stroke for every tool, the line tool included."]},
    "rnd.setLiveEnd": {"why": "gone", "what": None, "long": ["`setLiveArcs` draws the live stroke for every tool, the line tool included."]},
    "rnd.setSelection": {"why": "gone", "what": None, "long": ["The bounding-box indicator went on 2026-09-14; the selection is shown by the ants (`setSelectionAnts`, `_renderSelOverlay`)."]},
    "rnd.selectionDrawable": {"why": "gone", "what": None, "long": ["The bounding-box indicator went on 2026-09-14; the selection is shown by the ants (`setSelectionAnts`, `_renderSelOverlay`)."]},
    "rnd.setOutlineMode": {"why": "gone", "what": None, "long": ["Nothing replaced it; `setLazyOutlines` remains."]},
    "rnd._renderSelection": {
        "why": "says it draws the selection box with a viewport test; it draws only the lasso loop",
        "what": "Redraws the lasso loop in progress; the selection indicator is drawn elsewhere.",
        "long": ["Clears the selection layer and draws the lasso, in screen coordinates, as a dashed terracotta path. That is all it draws; the indicator is `_renderSelOverlay`."],
    },
    "rnd._sig": {
        "why": "says a resolved outline's signature carries no window; a shape or fill straddling the chop window carries the window's key, and a piece with a residual carries it too",
        "what": None,
        "long": ["A group's signature: same signature, same geometry, paths reused. It must include coordinates, not only counts: scrolling the tile set by one swaps pieces without changing any count.",
                 "A shape's part is its loop and piece counts and its bbox to two decimals, memoised per piece on `_ver`; the edit counter is in it because a pixel of drag at the deepest zoom is under the rounding. A fill uses its first and last points; a stroke its ends, width and representation (raw, outline, or pending past the gate).",
                 "A piece straddling the chop window carries the window's key, so a re-chop rebuilds exactly those groups; a piece with a residual carries it, since a drag from below moves it every event."],
    },
    "rnd._buildInto": {
        "why": "says a resolved outline goes through its cubic conversion; it goes through `_pushArea`, the arc plan and the chop window",
        "what": None,
        "long": ["Builds one unmerged piece into a group. A shape goes through `_pushArea`: arcs by their plan, clipped to the chop window where it reaches past it. A stroke still carrying its pen's chain is drawn from that chain; a fat stroke as its curve-capsule outline (a pending one fitted within 12 ms a render); a fill as a polygon path; anything else as a stroked path, shifted by its residual.",
                 "Drawing the pen's own chain is what makes pen-up invisible: the ink under the pen, before the bake and after it are one curve."],
    },
    "rnd._buildPieces": {
        "why": "says plain fills are merged; resolved shapes merge into the same bucket, since a cut parent's arcs and its tile pieces are one object's ink",
        "what": None,
        "long": ["Builds a group's paths, merging every area piece (tile fills and resolved arc shapes) of one effective colour and opacity into a single path, in order; anything else flushes the bucket and goes through `_buildInto`.",
                 "Abutting paths seam: each covers part of the boundary pixel and composites in turn, measured at 18-25% toward white. Subpaths of one path do not, because coverage accumulates before compositing (DESIGN.md §9)."],
    },
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]

# One or two sentences per FILE in the batch: what the file is for in the design.
ROLE = {
    "src/engine/KobinEngine.js":
        "The facade the app talks to: wires the lattice, the document, the camera, the tile cache and a renderer, "
        "builds the render list, and routes pan, zoom, pointer input and undo to their owners. On the raster path it "
        "also drains document events into the plate cache, holds a drag's plate invalidations until the drop, and "
        "builds the zoom-out ladder; five more files are mixed onto its prototype (DESIGN.md §15).",
    "src/engine/selection.js":
        "Selecting, hit-testing and dragging, mixed onto the engine's prototype. A selection is ids plus whole frames "
        "that hold ink, and keeps standing for the same ink when a move or an undo carries it across cell edges; a "
        "select press becomes a tap, a lasso or a move only once it resolves, and a move changes addresses and "
        "displacement tables, never a stored coordinate (DESIGN.md §8, §10).",
    "src/engine/files.js":
        "Saving and loading, mixed onto the engine's prototype: the kobin-1 drawing (`serializeDrawing`, "
        "`loadDrawing`), which the local store and the cloud carry, and the dev-0 snapshot the tests and reports load "
        "(DESIGN.md §13).",
    "src/engine/TileStore.js":
        "The derived-content cache, keyed by frame: coarser ink magnified in by chaining through the parent, finer and "
        "sideways ink minified in by one projection, and a moved object's pieces read from where its picture is. Tiles "
        "are a pure function of stored bits, so a move invalidates none; a frame move stales them by footprint and "
        "address sequence (DESIGN.md §9).",
    "src/engine/Renderer.js":
        "The SVG renderer, behind `?svg`, and the base class the raster renderer extends: one Two.js group per object "
        "diffed by signature, arcs planned once per piece, a per-scene float64 origin and chop window, retained "
        "per-level scenes, the live pen path, and the selection indicator's SVG layers (DESIGN.md §9).",
}
