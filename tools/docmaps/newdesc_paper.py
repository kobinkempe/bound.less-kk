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
add("eng._beginHold", "_beginHold()",
    "At a drag's start, takes the hold: the Stage draws the selection's members and selected frames at the drag's delta and holds their events until the drop.",
    ["Taken once at `_beginSelectDrag`: `stage.hold` takes the members (`_selectionMembers`) and the selected frames' roots, and nothing is written until the drop (A1 C2). `plane` records whether the renderer's drag plane draws them (`planeAccepts`, which also aims the plane and posts what it lacks); when it does not, the view's plates draw the drag at the same delta (A2 §2.7)."],
    "§8")
add("eng._planeLost", "_planeLost()",
    "The renderer's drag plane can no longer draw the live drag: the view's plates draw it from here, at the same delta.",
    ["Called by `RasterRenderer` when the camera leaves the plane's frame or a sync frame takes the drag. Clears the hold's `plane` and hands the Stage the drag's delta with `viewDraws`, so the drag goes on in the view's plates; returns 1, or 0 when the plane was not drawing it."],
    "§9")
add("eng._planeState", "_planeState()",
    "The selection's ids in the current render list, for the raster renderer's drag plane; null with nothing selected.",
    ["Takes the members from the indicator's table for this selection (`_selTable(s).ids`, its families already expanded: 0.24 s when done again here on a 29k-id lasso, REVIEWER-4) and every listed piece homed under a selected frame, found by its home, so a selected subtree costs the list's length rather than its object count. Memoised on the list and the selection; raster path only."],
    "§9")
add("eng._dragState", "_dragState()",
    "The live drag as the renderer pulls it each frame: the gesture, the held ids and frame roots, and the pointer at the first read — while the drag plane draws it.",
    ["Null unless a drag is under way with a hold whose `plane` is set; once the view's plates draw the drag (`_planeLost`), null. `RasterRenderer._planeStep` moves its plane by the gesture's `last - start`."],
    "§9")
add("eng._endMove", "_endMove(why)",
    "The one exit of a drag (drop, cancel, delete, deselect, undo): a drop writes the move and releases the hold as one commit; any other exit writes nothing. Then the renderer is told, one render, and the selection repaired.",
    ["In one Stage batch: on a drop that moved, `_dropMove` writes the drag's one op (A1 C2: a drag writes nothing until its drop), and `_releaseMove` ends the hold. Then the gesture is cleared, the renderer told (`endMove`, and `noteUserEdit` when the drop wrote), and what the drop moved out of a selected frame is kept selected (`_repairSelection` from the op's frames, DESIGN.md §10) before the one render; the frames the drop minted or emptied are collected (F94)."],
    "§8")
add("eng._dropHold", "_dropHold(why)",
    "`_endMove` without the write or the render: the hold released and the renderer told, for a document event (a reset) where a render would re-enter.",
    ["-"], "§8")
add("eng._releaseMove", "_releaseMove()",
    "The hold's end: the Stage applies what it held as one commit, dirtying where the drag started, where it ends and where the view drew it.",
    ["`stage.release()`; 0 when no hold was taken (A2 §2.7)."], "§8")
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
add("sel._outsideSelection", "_outsideSelection(ids)",
    "Of a set of frame ids, those no selected frame holds any more, coarsest first and none under another.",
    ["The frames a subtree drag or an undo moved out of the selected subtrees (a sub-cell rest re-homed them next door), so they can join the selection as frames."],
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
add("sel._frameUnderPoint", "_frameUnderPoint(sx, sy)",
    "The selected frame whose mark is within 8 px of a screen point, or null.",
    ["The mark is the frame's origin on screen. A press there drags the selection, as a press on selected ink does."],
    "§12")
add("sel._displaceMember", "_displaceMember(from, below, camDepth, tx, ty)",
    "Where one member goes for a drag displacement: its new home frame and table, or why it cannot move.",
    ["Homed at or above the camera's depth: the displacement enters the table at the camera's depth (`addOffset`). Deeper: `LevelMap.displaceFrame` turns the whole-cell digits into a new home and the rest enters the home-level entry. A carry out of the home level moves the member to the neighbour cell. Stored coordinates are never touched (DESIGN.md §8).",
     "Pure in the lattice's state, so `_dragSelection` asks once per (home frame, starting table) and every member sharing those takes the same answer; registration rests on that."],
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
add("ts._rerouteGroups", "_rerouteGroups(F)",
    "The moved objects to be read from another frame at F, grouped by source frame and remainder; memoised.",
    ["Skips objects homed at F (natives, rendered live) and those homed deeper than F, which the residual draws. For the rest `LevelMap.objShift` names the source frame and remainder; objects sharing both form one group, so each tile is scanned once a group.",
     "Memoised per frame on the document's `rev`, the lattice's `addrEpoch` and its frame count, for the last four frames; a key that changed during the walk is not kept. Measured: the walk was 70 ms of a 113-140 ms list build on the Magnum Opus (16,889 tables, jsdom)."],
    "§6")
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
add("rnd.areaBounds", "areaBounds(o)",
    "An area piece's bounds for the chop window's verdict: a shape by its true arc extremes, a fill by its points.",
    ["-"], "§9")
add("rnd.asClip", "asClip(clip)",
    "A tile piece's clip rectangle in the form the seam test takes, with its tolerance.",
    ["-"], "§9")
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


# Existing descriptions of functions in this batch's files that are now FALSE.
GONE_BAKE = ("Went with the windowed fat-stroke display bake, deleted 2026-09-14 (ROADMAP S7, DESIGN.md §15). "
             "A camera-only frame is now promoted to a full render by `needsReorigin` and `needsWindowChop`.")
FIX = {
    "eng.redo": {
        "why": "redo is `_history` over the redo stack",
        "what": None,
        "long": ["The mirror of `undo`: `_history` over the redo stack. Returns false when nothing was redone."]},
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
        "why": "calls the setters plumbing except trace; setTool also cancels a parked gesture and drops the selection",
        "what": None,
        "long": ["Tool and diagnostic settings, mostly plumbing. `setTool` cancels a gesture parked at an erase barrier when the tool changes (`_cancelBarrier`: a parked gesture goes with its tool, A2 §4.11) and drops the selection when the tool leaves select, so the indicator cannot linger over a drawing being edited; `setTrace` clears the operation log so a trace starts clean. The SVG renderer's settings (opacity groups, debug, retained scenes, lazy outlines) reach only a renderer that has them."]},
    "eng.setOutlineMode": {"why": "gone", "what": None, "long": ["Went with the renderer's windowed fat-stroke bake (ROADMAP S7). Nothing replaced it; `setLazyOutlines` remains."]},
    "eng.setKDebug": {"why": "gone", "what": None, "long": ["Nothing replaced it. The engine's debug views are `setDebug`, `setTileDebug` and `setEraseDebug`."]},
    "eng._outlinePad": {"why": "gone", "what": None, "long": ["Went with the windowed fat-stroke bake (ROADMAP S7); nothing replaced it."]},
    "eng.pointerDown": {
        "why": "names the logged op `pointerDown`; it is `ptrDown`, and the time also goes to the `_noteFast` distribution; the press is also the renderer's attention point",
        "what": None,
        "long": [
            "The public entry for a press: hands the renderer the attention point (`noteAttention`: the pyramid's plan and its queue work nearest-first from it, A3 §4.4), then times `_pointerDown` and records it as `ptrDown` in the operation log (past the 8 ms floor, or always in trace mode) and in the `_noteFast` distribution.",
            "Input handlers are where a user feels cost, so the boundary is what is measured."]},
    "eng._pointerDown": {
        "why": "says the select tool hit-tests and starts a move or a lasso on the way down; it only records the press, and a later move or pen-up decides; a press also takes the pending frame, cancels a parked gesture and lands unlanded marks",
        "what": None,
        "long": [
            "Starts the gesture, by tool. First the pending frame step is taken (`flush`), so the press hit-tests the picture the last move left; a gesture parked at an erase barrier is cancelled (`_cancelBarrier`); a select or erase press lands every mark whose shape has not landed (`flushBakes`); a stroke still open (its pen-up never arrived) is finished as a pen-up would, and a select press or lasso left behind by a tool change is dropped.",
            "**Pan**, or any press while `readOnly` (another tab or device has the pen): remember the point. **Whole-object eraser**: delete what is under the point. **Area eraser**: start a background-coloured stroke through the pen pipeline; the cut happens later, in the background.",
            "**Select**: nothing changes on the way down. The press is recorded with what lies under it (`_selPress`); `_pointerMove` turns it into a lasso or a move once it travels SELECT_DRAG_PX, `_pointerUp` treats it as a tap if it never did, and a pinch forgets it (`cancelSelectGesture`).",
            "**Pen**: allocate an id, build the stroke at the pen width over the zoom, attach its live arc chain (`_startPen`), add it to the document as live and fresh (unindexed while it grows), and hand it to the renderer."]},
    "eng._pointerMove": {
        "why": "omits the select press, which becomes a lasso or a move only past SELECT_DRAG_PX (`_beginSelectDrag`); with \"raf\" frames the drag step and the SVG update wait for the frame, and a parked drag only records the finger",
        "what": None,
        "long": [
            "Extends what `_pointerDown` started. Pan (or read-only) moves the camera; the whole-object eraser erases under the point; the area eraser falls through to the pen path, because it is a stroke.",
            "Select: a drag parked on its erase barrier only records the finger, for its start; a lasso appends a point once the pointer has moved more than a pixel; a press waits until it has travelled SELECT_DRAG_PX, then `_beginSelectDrag` decides lasso or move; a move in progress takes one `_dragSelection` step — with \"raf\" frames the frame's step reads the last pointer instead (`_pend`).",
            "Pen: the sample goes into the stroke and its live arc chain, which rebuilds only the last two gaps, O(1) a point; the line tool replaces its second point and re-seeds a two-sample pen instead. The renderer updates now, or with \"raf\" frames at the frame."]},
    "eng._startPen": {
        "why": "says the straight-line tool gets no live chain; every stroke gets one, the line tool re-seeding a two-sample pen on each move (the Code Map row's `straight` parameter is gone too)",
        "what": None,
        "long": ["Attaches a live arc chain (`BiarcPen`) to a stroke about to be drawn, seeded with its first sample, at a tolerance of half the arc tolerance at the zoom it is drawn at.",
                 "Every stroke gets one, the line tool included. The swap from the live chain to the resolved shape is the only moment their difference could show, and at this tolerance it is sub-pixel there."],
    },
    "eng._pointerUp": {
        "why": "the drop no longer builds the move op here: `_endMove('drop')` writes it through `_dropMove`; a release also takes the pending frame, and a parked drag applies when its barrier ends",
        "what": None,
        "long": [
            "Ends the gesture. The pending frame step is taken first (`flush`), so a drop, a tap or a pen-up comes after the last move's step; a drag parked on its erase barrier is marked released instead, and applies whole when the barrier ends.",
            "**Tap**: a select press that never moved goes to `_selectTap`. **Lasso**: apply the loop if it moved and has three points, then always redraw the selection layer, or the loop stays on screen.",
            "**Drag**: `_endMove('drop')`, whose `_dropMove` writes the drag's one op — a drag writes nothing until its drop (A1 C2).",
            "**Stroke**: journal it before its samples go, end the live path, finalise it in the document, queue its perimeter resolve and schedule the bake. An eraser pushes one `eraseCommit` entry its background cuts append to; anything else one `add`. Then the one render a pen-up makes."]},
    "eng.zoomFactorAt": {
        "why": "the zoom and its render decision moved to `_zoomBy`",
        "what": None,
        "long": ["Zoom about a point (the wheel): `_zoomBy` with no pan. A pinch comes through `pinchUpdate`, which pans the camera first and hands `_zoomBy` whether that pan crossed a cell, so a pinch step is one camera step."]},
    "eng.panBy": {
        "why": "the render decision moved to `_panStep`, and the ladder is gone",
        "what": None,
        "long": ["Pan by a pixel delta: the camera pans, and its consequences (`_panStep`) are taken now — or, with \"raf\" frames, at the next animation frame (`_pend`), which gathers every pan until it runs."]},
    "eng.undo": {
        "why": "undo and redo now go through `_history`: a parked gesture cancelled, one commit, the selection repaired from the op; `_keepingSelection` is gone",
        "what": None,
        "long": ["Undo and redo go through `_history`: refused while `readOnly`; a parked gesture is cancelled and a live drag cancelled first (its start records describe the document about to change); the op is applied as one Stage commit and the selection repaired from it, so what it moves out of a selected frame stays selected (A1 C2, DESIGN.md §10); then the background bake is re-scheduled — reversing an action can leave strokes unresolved or erases unapplied —, the renderer told of a user's edit, one render, and frame GC. Clear drops the bake jobs and resets the document, the lattice, the camera and the renderer; it too does nothing while `readOnly`."]},
    "eng.KobinEngine.constructor": {
        "why": "the Code Map row (constructor · resize · destroy) says only what the document subscription does; the constructor builds the Stage and wires the renderer's plate cache to its commits",
        "what": None,
        "long": [
            "Builds the configuration (the defaults, the device's lever defaults, the levers passed in; `frames` picks rAF or sync frames), the lattice, the document — whose frame shifts are its natives' placement, composed on read (A1 C1) —, frame collection (F94), the camera, the tile cache, and the Stage over a placement model. With `raster`, a `RasterRenderer` drawing from the Stage, whose plate cache (`PyramidStore`) the Stage's commits invalidate: a reset drops every plate, a commit the frames it names. Otherwise the SVG `Renderer`.",
            "Then the tool state, the bake queues, the erase state (`_initErase`), the instruments, the journal and the scene index; the renderer's hooks (the ants, the lasso — a parked one stays drawn —, the drag and plane states, a busy flag that stops prefetch while a report sends); the camera moved to the resident frame when a frame is refiled or added (`_camToResident`); and a document subscription that drops the selection on a reset. The selection is repaired where a drop or an undo commits (`_repairSelection`), not here."]},
    "eng._render": {
        "why": "a render now syncs the Stage's table and draws its items: no list build, no plate drain, no carries, no ladder",
        "what": None,
        "long": [
            "A full render: the camera's frame checked against the lattice (`_camToLattice`), frame collection on a camera-frame change, the view's picture sources minted where an action moved them (`_prepareView`), and on the raster path the frame's perf row opened. Then the Stage syncs its table to the camera's frame and window (`stage.sync`, reading at most `readMs`: a camera step reads nothing and leaves the rest to `_readIdle`), the tile cache is told of a frame the camera left, and the Stage's items are what the renderer draws; then update, status and the perf row. `_renderedG` records the Stage generation this render drew, which `flushBakes` reads.",
            "The frame meter is poked here as well as in gestures: the worst stall seen was a cold one, opening a drawing at a deep camera."]},
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

# ---- 2026-10-05, the rebuilt tree ----
add("ts.onTile", "onTile(fn)",
    "The tile hook (A2 §2.9): subscribes `fn` to every write to the cache or to a tile's pieces — a bake, an append, a remove, a drop, a clear — reported synchronously as it happens; returns the unsubscribe.",
    ["Nothing else writes the cache or a tile's `objs`, so the Stage, the one subscriber, sees every change to the content its items were built from."],
    "§9")
add("ts._tileEv", "_tileEv(ev)", "Hands one tile event to every `onTile` subscriber.", ["-"], "§9")
add("ts._indexTile", "_indexTile(key, tile) · _unindexTile(key, tile)",
    "Keep the index from a native's id to the cached tiles holding its pieces as a tile enters or leaves the cache (`tilesOf`).",
    ["-"], "§9")
add("ts._setTile", "_setTile(key, tile)",
    "The one way a tile enters the cache: indexed by its pieces' ids and reported as a `bake`.", ["-"], "§9")
add("ts._dropTile", "_dropTile(key)",
    "The one way a tile leaves the cache: unindexed, out of the warm set, reported as a `drop`; false when it was not cached.",
    ["-"], "§9")
add("ts._clearTiles", "_clearTiles()",
    "Empties the cache, the warm set and the id index, reported as one `clear`.", ["-"], "§9")
add("ts._appended", "_appended(tile, n0)",
    "Pieces patched onto a cached tile from index `n0` on: indexed by id and reported as an `append`, so an added native reaches the picture without a re-bake.",
    ["-"], "§9")
add("ts._keyOf", "_keyOf(tile)", "A tile's cache key: `frame|dir|i,j`.", ["-"], "§9")
add("ts.tilesOf", "tilesOf(id)",
    "The keys of the cached tiles holding pieces of native `id`, read-only, or null.", ["-"], "§9")
add("ts.peek", "peek(key)",
    "A cached tile that is current — same cache epoch, same chain sequence — or null; it neither bakes nor touches the LRU.",
    ["-"], "§9")
add("ts.read", "read(F, rect, budgetMs)",
    "The tiles over `rect` in frame `F`, both directions, cached or baked while the budget lasts; a miss past the budget is listed, never thrown (A3 §4.2).",
    ["`budgetMs`: Infinity reads everything, 0 the cache alone, anything else bakes until the deadline and at least one tile. Returns the tiles, the missing keys and whether the read was complete. The Stage reads the store through it (DESIGN.md §15); it leaves the camera's pins and the eviction as they were."],
    "§9")
add("ts.readTiles", "readTiles(cells, budgetMs)",
    "`read` for a list of tiles, `[frame, dir, i, j]` each: each served from the cache or baked, stopping between tiles (never inside a parent chain) once the deadline passes.",
    ["The eviction is held for the read and the pins restored after it, so a read never evicts what the camera pinned. A read the budget stopped is counted (`overBudget`); with `warmReads` set, the keys read join the warm set (the prefetch's reads, F83)."],
    "§9")
add("ts.setCameraPins", "setCameraPins(keys)",
    "Replaces the camera's pin set, then runs the eviction a read had held.", ["-"], "§9")
add("ts.prepare", "prepare(F)",
    "Mints the frames F's displaced pictures are read from — at the end of the action that moved them or the camera, or for a view a read found wanting — never in a read (A1 C3); returns how many were minted.",
    ["Called by the engine's `_prepareView` (DESIGN.md §8: no read settles, mints or changes a table). Runs the reroute with minting on when the document has any displaced native."],
    "§8")
add("ts.want", "want(F) · wanted()",
    "Notes a view whose read found a picture's source frame missing (the reroute's `miss`), for `prepareWanted`; and how many are waiting.",
    ["-"], "§8")
add("ts.prepareWanted", "prepareWanted()",
    "`prepare` for every view a read found wanting, the set then cleared; returns how many frames were minted.", ["-"], "§8")
add("ts.forgetFrame", "forgetFrame(frame)",
    "The store's side of frame GC: a forgotten frame's tiles, pins and chain sequence go, with every reroute memo that names it — its own and each whose group reads its tiles.",
    ["A memo whose group read the frame would, after a later mint restored its key, read a frame that is gone and leave the native undrawn (R-MODEL-C1, 6 of 8,000 fuzz renders); a later read can mint the same id again, and its old tiles would be served without what changed since (REVIEWER-3 RENDER-1)."],
    "§8")
add("ts._tileLive", "_tileLive(key, tile)",
    "Whether a cached tile still stands: it is dropped during a drag's batch mode unless pinned on screen, and when its frame is gone (RENDER-1).",
    ["-"], "§9")
add("ts._upVia", "_upVia(H, F)",
    "The frame whose child chain carries frame `H`'s natives up into F's up tiles: F's ancestor at H's depth when that is H's cell, or when H is in its ring; null when H's natives never reach F.",
    ["-"], "§9")
add("ts._ringCopy", "_ringCopy(o, H, A, pr)",
    "Native `o` of ring frame `H` as `_ringNatives(A, pr)` would hand it over — projected into `A`'s coordinates — or null when it would not.",
    ["-"], "§9")
add("ts._reaches", "_reaches(o, H, tile)",
    "Whether native `o`'s box at `H` meets an up tile's rect grown by the seam pad — the cold bake's cull, so a patch adds a native only where a bake would.",
    ["-"], "§9")
add("ts._appendChained", "_appendChained(key, tile, o)",
    "Patches an added native into a chained up tile from its parent squares' pieces; when one of those parent tiles is not cached and current, the tile is dropped instead (DESIGN.md §8: an added native is patched into the cached tiles a cold bake would put it in).",
    ["-"], "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("rnd.landedMarks", "landedMarks(list)",
    "The landed pending marks among a render list — those whose `targets` are recorded — as mark id → its items (DESIGN.md §7).",
    ["-"], "§9")
add("rnd._setMask", "_setMask(entry, marks)",
    "The SVG renderer's erase rule (PLAN §5.8 item 2): a group with any member under a landed mark's mask gets an SVG `<mask>` — white over the group's box, the marks' shapes black — so what the rule says shows, shows; a family is masked whole, as the raster core masks it.",
    ["So an object dragged under the mark, a stroke drawn over it and a piece it has cut all show, and a mark not yet landed is ink at its z (DESIGN.md §9, the SVG renderer). The mask is in the group's own units — its transform is the thin rescale's 1/S, so a mark drawn at S_m is scaled by S/S_m, exact in powers of two — and is rebuilt only when its marks, their signatures, the scale or the box change."],
    "§9")
add("rnd._dropMask", "_dropMask(entry, gone)",
    "Removes a group's mask; `gone`: the group itself went, so no attribute is left to clear.", ["-"], "§9")
add("rnd._applyMasks", "_applyMasks()",
    "After each Two.js render: the `mask` attribute set or cleared on each changed group's element, once it has one.", ["-"], "§9")
add("rnd._markDef", "_markDef(id, items)",
    "A mark's shape in the SVG `<defs>`, built from its items by the ink's own path and the thin rescale: a fill takes the `<use>`'s black, a stroke keeps its width; rebuilt when its pieces' signatures move.",
    ["-"], "§9")
add("rnd._maskBox", "_maskBox(entry)",
    "A masked group's box in its own units: its pieces' drawn boxes where they are drawn, padded by two pixels at the frame's coarsest zoom, inside the scene's window (float32 stays in budget); null when empty.",
    ["-"], "§9")
add("rnd._defsEl", "_defsEl()", "The SVG renderer's `<defs>` element, where the masks and the marks' shapes live.", ["-"], "§9")
add("rnd._groupOpacity", "_groupOpacity(entry, o)",
    "A group's opacity: a family group is painted at full presence, never at the fade of whichever member sorts first; in erase-debug the opacity lives on each path instead.",
    ["An erase family spans frames at very different depths; reading the first member's fade let a microscopic member's fade-out take the window-filling parent with it (the fade-out bug, 2026-08-20). In erase-debug two overlapping pieces of one object must read darker, which a group alpha would hide."],
    "§9")
add("rnd._isLive", "_isLive(o)",
    "Whether a list item is the stroke under the pen, whose only picture is the live path.", ["-"], "§9")
