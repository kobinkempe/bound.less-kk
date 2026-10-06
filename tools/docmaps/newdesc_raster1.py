# -*- coding: utf-8 -*-
"""Per-function entries for the raster renderer (RasterRenderer.js), the drag plane
(MovePlane.js), the plate grid (plate.js), the raster worker client and the raster worker."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/raster/RasterRenderer.js ----
add("rr.resetRasterStats", "resetRasterStats()",
    "Zeroes every counter in `rasterStats`, the renderer's own report counters.", ["-"], "§14")
add("rr.RasterRenderer", "RasterRenderer",
    "The raster renderer: paints the Stage's items into the picture pyramid's plates on a canvas instead of into SVG.",
    ["No longer a `Renderer` subclass: it owns one Two.js `<svg>` (`SvgLayer`) for the stroke under the pen (`LiveStrokeLayer`), the lasso and the debug overlays (`SvgOverlays`), and the chevrons; the ink goes through the `PicturePyramid` (the plan and the compose), the `PyramidStore` (the plates and their freshness against the Stage's generation) and the job queue to the worker pool (A3 §1, §4).",
     "The app's default renderer since 2026-09-22; the SVG renderer is behind `?svg`. The engine's own `raster` option defaults to off, so the suites and the one-off engines are SVG (DESIGN.md §9)."],
    "§9")
add("rr.RasterRenderer.constructor", "RasterRenderer.constructor(container, camera, cfg, opts)",
    "Builds the SVG layer, the live stroke, the SVG overlays, the pyramid with its store and queue, the drag plane and the counters, attaches the perf recorder and spawns the worker pool.",
    ["Positions the one Two.js `<svg>` (`SvgLayer`) absolutely at z-index 1 over the pyramid's canvas (0); the ants' `OverlayLayer` (2) comes with the first selection and the chevrons' `bl-sel-edges` (3) while one shows — one list of screen layers (`_layers`) that `setSize`, `destroy` and the store's release walk. Reads the dpr and builds the store, the pyramid and the queue (`_pyrBuild`); hooks the store's `onRelease` and `onShow` (the tab visible again: a commit step, or the engine's `onShown` after a release); halves the pack memo's budget on a phone; notes the Stage's commits; creates the `MovePlane`; attaches `rasterPerf` to its sources; arms the dpr listener and calls `ensureRasterPool`.",
     "It draws from the engine's Stage (`opts.stage`): packs read its items at its generation, and the store's freshness is measured against it (A2 §3). `forcePerStepDrag` is a test hook that turns the drag plane off, so every drag renders each step."],
    "§9")
add("rr._buildSelOverlay", "_buildSelOverlay(svg)",
    "Builds the one SVG selection layer the raster path needs, `bl-sel-edges` for the chevrons, at z-index 3.",
    ["The ants are painted on `OverlayLayer`'s canvas, so `bl-sel-layer` is never created; `_selOv` and `_selEls` have the shape `svgOverlay`'s functions read (`renderSelChevrons`, `dropSelOverlay`)."],
    "§10")
add("rr.antPainter", "antPainter (getter)",
    "True: tells `overlays._selDecide` to keep each ant run's pieces for the canvas painter instead of building an SVG path string.",
    ["The code records 8.3 ms and 345 KB taken off a decision at F39's density."],
    "§10")
add("rr._renderSelOverlay", "_renderSelOverlay(view)",
    "Draws the selection indicator on the raster path: the ants on the overlay canvas, the chevrons in SVG, both at the published view.",
    ["Asks the engine for its decision (`_selAntsFn`), timing it as the overlay's `decideMs`; with nothing to show it drops the overlay. Otherwise it sizes `bl-sel-edges`, builds the `OverlayLayer` on first use, hands it the decision, the view and `_edgeShift`, draws the chevrons with `renderSelChevrons` (`raster/svgOverlay.js`) and keeps the edge layer last in the host.",
     "It takes the published view, never the camera, so the ants and the ink share one mapping. With no view published yet it leaves what is drawn."],
    "§10")
add("rr._dropSelOverlay", "_dropSelOverlay()",
    "Hides the ant canvas and removes the SVG chevron layer when the selection goes.",
    ["The overlay's buffer is kept, so the next selection does not reallocate it."],
    "§10")
add("rr._makeOverlay", "_makeOverlay()",
    "Creates the `OverlayLayer` for the ants on the first selection decision and adds it to the renderer's list of screen layers.",
    ["Never at construction: a tool change must not cost the plane's 10.48 MiB. Joining `_layers` is what has it resized, released and destroyed with the ink layer. It also arms the reduced-motion listener."],
    "§10")
add("rr._edgeShift", "_edgeShift(view)",
    "The CSS-px difference between the published view's snapped translation and the camera's pan, applied to the screen-edge ant spans.",
    ["The edge spans are computed in the camera's screen px while the ink is composed at the view's whole-pixel translation; the overlay adds this to the spans only. One two-element array, reused."],
    "§10")
add("rr._armReducedMotion", "_armReducedMotion()",
    "Listens to `prefers-reduced-motion` and passes it to the ant overlay, which owns the crawl clock.",
    ["A CSS rule cannot stop the canvas crawl; the chevrons keep the stylesheet's own rule. A no-op without `matchMedia` (jsdom), which is what lets a raster engine construct there."],
    "§10")
add("rr._dropReducedMotion", "_dropReducedMotion()",
    "Removes the reduced-motion listener.", ["-"], "§10")
add("rr.setSize", "setSize(w, h)",
    "Resizes every screen layer at the current devicePixelRatio, sets the store's budget for the new screen (A3 §4.5) and re-arms the dpr listener.",
    ["The layers take `(w, h, dpr)`, so this is the one place that reads `devicePixelRatio`."], "§9")
add("rr._armDpr", "_armDpr(dpr)",
    "Listens for a devicePixelRatio change, which fires no `resize`, and resizes the layers when one happens.",
    ["`matchMedia(\"(resolution: Ndppx)\")` matches one ratio, so the query is re-armed at the new ratio on each `setSize`. The case is a window dragged to a second monitor. A no-op without `matchMedia`."],
    "§9")
add("rr._dropDpr", "_dropDpr()",
    "Removes the dpr listener.", ["-"], "§9")
add("rr._onStoreRelease", "_onStoreRelease(reason)",
    "The store's release when the tab is hidden: ends the drag plane and passes the release to every screen layer.",
    ["Driven by `PlateStore.onRelease`, which the constructor sets."],
    "§9")
add("rr.setPlaneState", "setPlaneState(fn)",
    "Stores the engine's selection callback, pulled each camera step as `{ key, ids }` of the current list, or null.",
    ["The engine's `_planeState`, memoised on the list and the selection; a selected frame's natives are found by their home."],
    "§9")
add("rr.planeAccepts", "planeAccepts()",
    "At a drag's start: aims the drag plane at the selection and posts what it lacks; false leaves the drag to the view's plates, which draw it each step at the Stage's delta.",
    ["Ends a plane still landing from the last drop first. False with a view that is neither the pyramid's level view nor its rest view, no selected ink on screen, or `forcePerStepDrag` set; a large or interleaved selection is not refused, the plane merges runs or cuts coarser instead (`MovePlane._cut`). The refusal is kept in `_noPlaneDrag`, which stops `_planeIdle` aiming a plane under that drag.",
     "Called from the engine's `_beginHold`, which takes the hold either way and records the answer as the hold's `plane`."],
    "§9")
add("rr._planeViewOk", "_planeViewOk(v)",
    "Whether a view can carry a drag plane: the pyramid's level view or its rest view.", ["-"], "§9")
add("rr.dragLight", "dragLight()",
    "Whether a drag step may skip the list build: the plane has layers, the view carries it, and it is not landing.",
    ["`selection.js` asks it on each drag step while the engine holds the move; true means the step is a camera frame only (the list build it skips is 120–240 ms on the Magnum Opus, per the caller's comment)."],
    "§9")
add("rr.planeCap", "planeCap (getter)",
    "The most plates a drag plane may pin, both its levels together: 40 on a desktop, 24 on a phone, or a test's override.", ["-"], "§9")
add("rr._aimPlane", "_aimPlane(v)",
    "Keeps the drag plane aimed at the current selection and view, re-pins its plates in the store and posts what they lack; false when the plane is refused.",
    ["Under the `forcePerStepDrag` test hook it ends any plane and returns false. Otherwise it pulls the selection through `_planeFn` and calls `MovePlane.aim`; every old tag the plane no longer carries — all of them after a reset or a refusal, a renamed layer after a re-cut — is dropped from the queue and the store. Pins the plane's keys with `setPlanePins`, or clears them on a refusal; lists its far levels and posts what the plane lacks (`_postPlane`)."],
    "§9")
add("rr._postPlane", "_postPlane(pl)",
    "Posts the plates each plane layer lacks to the job queue, one job per layer, each cell asked once per change.",
    ["A layer's cells are a list, not a range. A cell is asked when the store wants it, the pyramid covers it (or the layer carries its own list), and it was not asked since it was last dirtied (`_pyrPlaneAsked` holds the Stage generation it was asked at, against the store's `dirtySince`). The jobs go to the queue at the plane's priority and are pumped at once; returns how many."],
    "§9")
add("rr._dropPlaneTags", "_dropPlaneTags(tags)",
    "Removes a plane's layer tags' plates from the store and bumps the pyramid's plane generation.",
    ["Each tag names one cut of the plane's layers, which no other request reads, so its plates go by tag (`dropWhere`); the asked set is cleared, so the next aim asks again."],
    "§9")
add("rr._planeStep", "_planeStep(v)",
    "Each camera step: follows a live drag with the plane, ends a landing that is done, or keeps an idle plane ready; then picks the level to draw and hands it to the pyramid.",
    ["Under a drag, a plane with no layers, at another frame, or in a view that cannot carry it is lost (`_losePlane`); otherwise it moves by the pointer's displacement from the drag's start and re-posts any plane plate a change staled mid-drag.",
     "The drawn level is `MovePlane.pick`'s: the main level whole, else the quick one whole, else the selected layers of either alone (partial). Under a drag with no whole level, `_pyrStopgap` rasters a small selection here and the level is picked again. Only a whole level sets `_dragOmit`, which makes every other pack leave the selection out; while partial the plates still show the ink where it was. The pyramid draws the plane through `setPlane` (`_pyrPlaneOf`). Counts the steps drawn not ready, partial and from the quick level."],
    "§9")
add("rr._losePlane", "_losePlane()",
    "Ends the plane under a live drag and tells the engine (`onPlaneLost`), whose view plates then draw the drag at its delta.",
    ["Counted in `planeStats.lost`; sets `_noPlaneDrag` so no new plane is aimed under that drag."], "§9")
add("rr._planeIdle", "_planeIdle()",
    "With nothing dragged, aims the plane at the view once the published view has stayed unchanged for 150 ms with no Stage commit in that time.",
    ["Unchanged means the same frame, zoom quantum and view revision, a pan included; the code records 938 plates posted over a 60-step pan in Kobin's Chrome when each pan step re-cut the layers. A commit in the last `PLANE_QUIET_MS` (`_commitAt`) means a change is still settling. A plane aimed at another frame or zoom quantum is ended at once; otherwise one timer re-checks after `PLANE_QUIET_MS`.",
     "Does nothing under `forcePerStepDrag`, after a refused drag, or during a drag. Also called from `_pyrLand`, since landed plates arrive without a camera step."],
    "§9")
add("rr._planeLanded", "_planeLanded(v)",
    "Whether a landing plane can go: every cell it covers has a fresh plate again, the camera left its frame or quantum, or `MOVE_HOLD_MS` passed.",
    ["A timeout is counted in `planeStats.landTimeouts`."],
    "§9")
add("rr._endPlane", "_endPlane()",
    "Takes the plane down: records the landing's length, clears its timer, drops its plates and pins, resets it and tells the pyramid.",
    ["The next camera step or `_planeIdle` aims a new one."], "§9")
add("rr.endMove", "endMove(why)",
    "The engine's end of a drag: a drop lands the plane until the plates under it are fresh; any other end takes it down.",
    ["Clears `_noPlaneDrag` and `_dragOmit` first, so the drop's render packs the moved ink. A drop lands the plane only when it was drawing the drag from a whole level (`cur` set and not partial, the quick level included); a timer ends the landing at `MOVE_HOLD_MS` + 20 ms and recomposes. A drop drawn partial or from the stopgap, a cancel, a delete or a deselect ends it at once.",
     "Called from the engine's `_dropHold`."],
    "§9")
add("rr._abandon", "_abandon(why)",
    "Reports every in-flight job as dropped so the store frees its keys; used at teardown only.",
    ["It frees no worker capacity: an abandoned job holds its slot until its own answer arrives (`rasterWorkerReport().heldSlots`). Not on the render path, because a quantum change already bumps the dead keys' epochs, and freeing them there would re-post plates the camera has just left."],
    "§9")
add("rr.destroy", "destroy()",
    "Tears down the raster path: empties the job queue, unhooks the pyramid and the Stage, clears the timers, abandons in-flight jobs, stops the pool and the perf recorder, then destroys the live stroke and every screen layer.",
    ["Every job still in flight is reported so its end runs: a job never reported would leave its keys in flight for ever — a permanent hole with every suite green. The SVG layer is one of the screen layers (`_layers`), and the chevrons' slot drops the indicator."],
    "§9")
add("rr.endLive", "endLive()",
    "Pen-up: keeps the stroke's SVG path on screen, held, until the plates under it are published; without a path or a published view it goes at once.",
    ["With a live path, points and a published view, `LiveStrokeLayer.hold` keeps the path with its frame, its box (half its width added) and a limit of `LIVE_HOLD_MS` (3,000 ms), and the timer is armed: the path stays until the group commit publishes the plates that hold the stroke (A3 §3.6, §7.2). Otherwise `cancel` removes it."],
    "§9")
add("rr._armLiveTimer", "_armLiveTimer()",
    "Arms one timer for all held live paths, at the earliest limit; it releases what it can and re-arms while any path is held.",
    ["A release is followed by `update()`, so Two redraws without the path."],
    "§9")
add("rr.addLive", "addLive(o)",
    "Starts the live stroke's SVG path at the view's centre, re-syncing the world transform when that moved the live stroke's origin.",
    ["The origin is one object with one writer, `LiveStrokeLayer.begin`, and a new choice is a new object, because `_selDecide` caches on the origin's identity. Re-syncing here is what puts a stroke begun after a pan or zoom under the pen instead of offset by the origin's move until pen-up."],
    "§9")
add("rr._syncWorldTransform", "_syncWorldTransform(view)",
    "Sets the SVG world group's scale and translation from the published view, with the live stroke's origin folded in, so the live stroke sits on the composed ink.",
    ["The view maps a frame point to `p·k + tx` in device px and the SVG is in CSS px, so both are divided by the view's dpr. Without a view (or its dpr) it uses the camera's in-level transform."],
    "§9")
add("rr.syncWorld", "syncWorld(view)",
    "The world transform, the lasso and debug overlays (`SvgOverlays.render`) and the selection indicator, timed into the `ovl.tail` slot.",
    ["Both `render` and `syncCameraOnly` reach the tail here, so one bracket times both and neither counts twice."],
    "§9")
add("rr.beginRender", "beginRender()",
    "Opens the frame's perf row before the engine builds its list, so the list build counts inside the frame.",
    ["`render` finds the row open and does not open a second; a caller that skips this gets the row opened in `render`."],
    "§14")
add("rr.noteList", "noteList(ms)",
    "Charges the engine's own list-build time to the `eng.list` slot.", ["-"], "§14")
add("rr.render", "render(list, frame)",
    "A full frame on the raster path: reads the Stage's items (`_sceneList`), runs the camera step (the plan, the compose, the posts) and syncs the SVG world and overlays.",
    ["The list the engine passes is not read: the packs read the Stage's items at its generation (A2 §3). Inert once destroyed, since the next engine shares the host (F101). The fat gate is the SVG renderer's (A3 §7.2), so nothing is recorded for an idle fitter here. Returns false: there are no ink groups to reorder."],
    "§9")
add("rr.syncCameraOnly", "syncCameraOnly()",
    "A camera-only frame: reads the Stage's items, runs the camera step (the plan, the compose, the posts) and syncs the SVG world and overlays.",
    ["There is no document-event drain any more: a plate's freshness is read against the Stage's generation, and its commits drop the plates they stale. Inert once destroyed. No list build and no overlay rebuild."],
    "§9")
add("rr._frameStep", "_frameStep()",
    "One camera step: the live stroke's crossing, the pyramid's view of the camera, the job queue told the motion and pumped, the plane step, the pyramid's compose, the held live strokes released, and a prefetch when the camera is still.",
    ["In order: `_liveCross` (before the retarget, which reads a group's rectangle); `PicturePyramid.frameFor(cam)`, timed into `SLOT.view` without the packs and the core work done inside it; the queue's motion (`_pyrMotion`), frame and pump; `_planeStep`; `compose` (counted in images); `_pyrLive`; and `_pyrPrefetch` when not moving. There is no sync path and no want-and-post of misses any more: the pyramid's plan asks for what the view lacks (A3 §4)."],
    "§9")
add("rr._beginFrame", "_beginFrame(kind)",
    "Advances `frameSeq` (from the engine's counter when given), counts the frame, and opens its perf row.", ["-"], "§14")
add("rr._endFrame", "_endFrame()",
    "Closes the frame's perf row and marks the engine's row closed.", ["-"], "§14")
add("rr._openRow", "_openRow(seq, kind, backMs)",
    "Opens a perf row and marks one as live, so `_post` and `_pack` can tell whether to open their own; `backMs` is main-thread time the task spent before the row could open.",
    ["-"], "§14")
add("rr._closeRow", "_closeRow()",
    "Closes the live perf row.", ["-"], "§14")
add("rr._add", "_add(name, ms)",
    "Adds a duration to one named perf slot, through `rasterPerf`'s slot index or the name itself for a test recorder.",
    ["-"], "§14")
add("rr._endJob", "_endJob(jobId)",
    "Ends a job id in the store, freeing its in-flight keys.", ["-"], "§9")
add("rr.snapshotJob", "snapshotJob(o)",
    "Rasters one plate of any frame and rect off camera, for the Scenes panel, and resolves with its bitmap; never stored.",
    ["Reads the frame's table at idle, a budget at a time (`_readIdle`), then goes through the job queue at `PRIO.thumb` (A3 §4.1) with a key of its own (`t1`, `t2`, …), so no snapshot is reused at a zoom it was not rastered at. The rect lands on the plate's own origin through an `offset` folded into each item at pack time; an offset at or past the coordinate bound is rejected before any work.",
     "Resolves null for an empty plate or a table the reads could not finish, and the raw pixels where there is no `createImageBitmap`; rejects on an abort (one while queued also takes the job out of the queue) or a failure. Called by `sceneOps.snapshotView`."],
    "§11")
add("rr.report", "report()",
    "The renderer's flat report: frame seq, view mode, the plane's state and plate count, every `rasterStats` counter, the pack's packed and culled counts, and the job queue's report.",
    ["-"], "§14")

# ---- src/engine/raster/MovePlane.js ----
add("mvp.resetPlaneStats", "resetPlaneStats()",
    "Zeroes the drag plane's counters.", ["-"], "§14")
add("mvp.rangeOf", "rangeOf(cells)",
    "The bounding plate range of a cell list, or null when it is empty.", ["-"], "§9")
add("mvp.MovePlane", "MovePlane",
    "The drag plane: a selection's picture split by z into layers of plates, kept ready while it is selected, so a drag moves bitmaps and re-rasters only at the drop.",
    ["Layers in paint order: BELOW (everything except the selected runs and the runs above them, opaque, with the paper), then each run of selected families (SEL, transparent, drawn at the pointer's offset) and of unselected families above one (OVER, transparent, in place). A dragged object therefore passes under ink above it.",
     "Only a selection with no ink on screen is refused. Past 5 layers the smallest unselected run between two selected ones is drawn under the selection; past the plate cap (40 on a desktop, 24 on a phone) the layers are cut up to 3 octaves coarser and drawn magnified, the coarsest taken whatever it costs. A quick level 2 octaves coarser again is asked for first and drawn until the main level is whole; until either is, the selected layers are drawn alone, or a small selection is rastered on the main thread (`RasterRenderer._planeStopgap`). The plates live in `PlateStore` under the plane's own tags, pinned (DESIGN.md §9)."],
    "§9")
add("mvp.MovePlane.constructor", "MovePlane.constructor()",
    "Points `stats` at the module's counters and starts the plane empty and idle.", ["-"], "§9")
add("mvp._reset", "_reset()",
    "Empties the plane — selection, list, both levels, the drawn level, layers, tags, keys, ranges, offset, landing times — sets it idle and bumps `gen`.",
    ["The caller compares `gen` to know it must free the old layers' plates. `layers`, `r` and `selR` mirror the main level; `tags` and `keys` cover both levels. A small selection's stopgap is the renderer's (`_pyrStopgap`), not the plane's."],
    "§9")
add("mvp.showing", "showing (getter)",
    "Whether the plane is drawn this compose: while it is dragging or landing.", ["-"], "§9")
add("mvp.cellCount", "cellCount()",
    "The number of plates the plane pins.", ["-"], "§9")
add("mvp.aim", "aim(st, list, view, cfg, max, dpr)",
    "(Re)aims the plane at a selection, a list and a view; true while it is valid for them.",
    ["Does nothing while dragging or landing. A new selection key, frame or zoom resets it, and with no selected ids it is refused; a new list, id set, cap or plate range under the same selection re-cuts it, so a pan keeps the plates of every layer whose members are unchanged."],
    "§9")
add("mvp.idsHash", "idsHash(ids)",
    "A short FNV-1a hash of an id set, the same for the same ids in any order: the part of a layer's tag that names its members.",
    ["-"], "§9")
add("mvp._cut", "_cut(list, ids, view, cfg, max, dpr)",
    "Cuts the plane: groups the pack's families in paint order into selected and unselected runs, merges runs past the layer cap, and picks a main level that fits the plate cap and a quick level under it.",
    ["Families come from `rasterPack.paintFamilies`, so the layers split exactly where the pack paints; a family with no item box on the view's plates is skipped — a selected one counts on the view grown by its own size each way, so a drag across the screen still has its plates — and unselected families below the first selected run stay in BELOW. Past `MOVE_PLANE_LAYERS` the smallest unselected run sandwiched between two selected ones is merged away, so it is drawn under the selection (counted in `merged`).",
     "The main level is the first of 0 to 3 octaves coarser (`_level`) whose plates fit the cap — at most 16 for a level drawn magnified — else the coarsest (counted in `overCap`). A plane of more than 4 plates also gets a quick level 2 octaves under the main, kept when it has fewer plates, fits the cap together with the main, and is within 16. Refused only when no selected ink is on screen."],
    "§9")
add("mvp._level", "_level(runs, view, k)",
    "Builds the plane's layers at `k` octaves coarser than the view: each layer's cells, tag and keys, the plate count, the bounding ranges and BELOW's cell set.",
    ["The level's zoom is the view's over 2^k (A3 §6), and the view's plate range — grown by its own size each way for a selected run — is mapped onto its grid. A run's cells are its item boxes on that grid; BELOW covers the union of every run's cells and omits every run's ids.",
     "A layer's tag is `z<n>_<k>_<members hash>`, so a re-cut that changes a run's members is a new layer and never reuses the old plates."],
    "§9")
add("mvp.requests", "requests()",
    "One request per layer, the quick level's first — BELOW with its omitted ids, the others with only their own ids on transparent paper — or null when refused or landing.",
    ["Each carries its level's zoom, its tag and its cell list instead of a range, and a far level's own table (`list`, at the Stage generation `G` it was read at) when it has one; a level whose list is still being read is skipped."],
    "§9")
add("mvp._whole", "_whole(lvl, store, selOnly)",
    "Whether every plate of a level, or of its selected layers only, is cached, live and exact (`store.exact`).",
    ["-"], "§9")
add("mvp.checkReady", "checkReady(store)",
    "Whether the main level is cached and live; once true it stays true for this plane.",
    ["`pick` falls back to the quick level or the selected layers until it is."],
    "§9")
add("mvp.pick", "pick(store)",
    "Chooses the level to draw this compose: the main level whole, else the quick level whole, else the selected layers of either alone; null when none is in.",
    ["Sets `cur` and `partial`. While partial the layer draws only the SEL layers, and the plates underneath still show the ink where it was, so the other packs do not omit the selection."],
    "§9")
add("mvp.dragTo", "dragTo(dxCss, dyCss, dpr)",
    "Enters the drag state and sets the offset to the pointer's displacement since the drag's start, in whole device px.",
    ["-"], "§9")
add("mvp.land", "land(now)",
    "The drop: moves a dragging plane to the landing state, with a limit of `MOVE_HOLD_MS` (3,000 ms).", ["-"], "§9")
add("mvp.landCells", "landCells(v)",
    "The view cells a landing plane still covers: the drawn level's cells and the selection's destination, bounded and clipped to the view.",
    ["Uses the drawn level (`cur`, else the main one), mapping its plate indices into the view's grid by the zoom ratio and adding the drag offset in view plates, so the answer holds for a level coarser than the view."],
    "§9")

# ---- src/engine/raster/plate.js ----
add("plt.plateRange", "plateRange(win, Zq)",
    "The inclusive range of plates a frame-unit window touches at zoom `Zq`.",
    ["The grid is anchored at the frame origin, so a screen W device px wide touches floor(W/512) + 1 or + 2 columns."],
    "§9")

# ---- src/engine/raster/rasterWorkerClient.js ----
add("rwc.named", "named(names, a)",
    "Turns a totals array into an object keyed by the given names, for the report.", ["-"], "§14")
add("rwc.now", "now()",
    "The main thread's clock: `performance.now()`, or `Date.now()` where there is none.", ["-"], "")
add("rwc.setRasterTransport", "setRasterTransport(t)",
    "Tests only: replaces the whole worker pool with a `(msg, transfer) => Promise` transport.", ["-"], "")
add("rwc.setRasterWorkerCount", "setRasterWorkerCount(n)",
    "The suite's worker-count override (at least 1); null restores the rule.", ["-"], "")
add("rwc.rasterWorkerCount", "rasterWorkerCount()",
    "How many raster workers to run: min(4, max(1, cores − 1)), unless a test or `?rasterWorkers=N` overrides it.",
    ["-"], "§9")
add("rwc.urlOverride", "urlOverride()",
    "The worker count from the page URL's `?rasterWorkers=N`, or null where there is no window.", ["-"], "")
add("rwc.workerCountFromSearch", "workerCountFromSearch(search)",
    "Parses `rasterWorkers=N` from a query string, capped at 4; null when absent or not positive.", ["-"], "")
add("rwc.workerUrl", "workerUrl()",
    "The worker script's URL: `/raster-worker.js` under `PUBLIC_URL`.", ["-"], "")
add("rwc.ensureRasterPool", "ensureRasterPool()",
    "Spawns the worker pool if it is not up yet; the renderer's constructor calls it so the first render does not pay for it.",
    ["Four workers loading the bundle cost tens of ms on a desktop and up to a hundred each on a phone. Returns the live worker count, 0 on the inline path."],
    "§9")
add("rwc.spawnPool", "spawnPool(late)",
    "Creates the workers once per session and wires their messages and errors; with no `Worker`, or a constructor that throws, it marks the pool broken, which is the inline path.",
    ["A spawn from the dispatch path is late and counted in `spawnedLate`. Does nothing under a transport, once broken, or once spawned."],
    "§9")
add("rwc.terminateWorkers", "terminateWorkers()",
    "Terminates every worker and forgets the pool, reporting nothing.",
    ["`destroyRasterPool` is the teardown that also reports the in-flight jobs."],
    "§9")
add("rwc.destroyRasterPool", "destroyRasterPool()",
    "Teardown: terminates the workers and reports every in-flight job as dropped, since a terminated worker never answers.",
    ["-"], "§9")
add("rwc.abandonInFlight", "abandonInFlight(why)",
    "Reports every in-flight job as dropped with its id, so the caller can end it in the store; each job's capacity stays held until it answers.",
    ["A worker slot is marked abandoned, not freed: the worker is still drawing into its one scratch, and a second job would overwrite pixels the first one's `ImageData` aliases. A slotless job (inline or transport) is held by the `heldNoSlot` count. A result arriving later finds no record and only releases the hold, so each id is reported once."],
    "§9")
add("rwc.releaseAbandoned", "releaseAbandoned(slot)",
    "Releases an abandoned job's hold when its answer comes — the slot, or one of `heldNoSlot` — and says whether to pump.",
    ["-"], "§9")
add("rwc.onWorkerError", "onWorkerError(e)",
    "A worker failed to load or threw outside a job: marks the pool broken for the session, reports each in-flight strip dropped, re-queues them and pumps them onto the inline path.",
    ["Each stranded strip is re-packed under a new job id, so the caller must still end the old one."],
    "§9")
add("rwc.activeCount", "activeCount()",
    "The workers available for strip sizing: the transport's count, the pool's (spawning it late if needed), or 1 for the inline path.",
    ["-"], "§9")
add("rwc.freeSlot", "freeSlot()",
    "A worker with no job; `null` for the slotless paths when they have room; `undefined` when everything is busy.",
    ["A transport takes as many jobs as the pool would and the inline path takes one; both count abandoned slotless jobs as held. Spawns the pool late if needed."],
    "§9")
add("rwc.dispatch", "dispatch(entry, slot)",
    "Mints a job id, has the caller pack the strip, records it in flight and posts it to its worker, the transport, or the inline `runJob`; an erase cut goes to `dispatchCut`. Returns whether a job went out.",
    ["A pack that throws or returns null is reported dropped with the new id (`pack`, `empty`). The posted-at time is the main thread's; the wire and post time goes to `postMs`.",
     "The inline path runs the worker's own `runJob` on a later microtask, so both paths draw the same pixels and jsdom checks the shipped code."],
    "§9")
add("rwc.onFailed", "onFailed(jobId, err, slot)",
    "A job's terminal failure: frees its slot, reports it dropped with the error, and pumps; an unknown id only releases an abandoned hold.",
    ["-"], "§9")
add("rwc.onMessage", "onMessage(slot, data)",
    "A worker's answer: a cut's result goes to `onCutMessage`; otherwise frees the slot, returns the job's buffers to the pool, derives the timings, totals the guards and counts, and calls `onResult`.",
    ["Queueing time is the main thread's wall time minus the phases the worker reports, since the worker returns durations only. A `raster-error` message goes to `onFailed`. A result with no record is ignored except to release an abandoned hold. Freshness is not judged here: the result carries the Stage generation `G` it was packed at, and the store decides."],
    "§9")
add("rwc.plateBitmap", "plateBitmap(px)",
    "Converts one plate's raw RGBA to an `ImageBitmap`, or null where the scope has no `createImageBitmap`.",
    ["The layer composes bitmaps only; where this is null (jsdom) the caller puts the raw pixels."],
    "§9")
add("rwc.rasterWorkerReport", "rasterWorkerReport()",
    "The worker client's report: mode, worker counts, in-flight size, held slots, job and cut totals, bytes, timings, the guard and count totals and the buffer pool.",
    ["`heldSlots` is the capacity abandoned jobs still hold. The queue is `jobQueue`'s, which reports itself."],
    "§14")
add("rwc.resetRasterWorkerClient", "resetRasterWorkerClient()",
    "The suite's reset: empties the in-flight map, terminates the workers, and clears the broken flag, ids, overrides, buffer pool and counters.",
    ["It reports nothing in flight; the live teardown is `destroyRasterPool`."], "§9")

# ---- src/engine/worker/rasterWorker.js ----
add("rwk.resetGuards", "resetGuards()",
    "Zeroes the raster core's guard counters, so a job's guards are its own.", ["-"], "§9")
add("rwk.runJob", "runJob(msg, opts)",
    "Rasters every plate of one strip — each inside its clip when the job has clips — into the one RGBA scratch and returns the wired result: bitmaps or pixel copies, timings, counts, guards and the job's buffers.",
    ["Each plate is serialised (a bitmap awaited, or the bytes copied) before the next is drawn, because the scratch is reused. A plate no item reached after the prune stays null: nothing is drawn there. Times are durations only; receipt-to-start, start-to-finish and serialisation partition the worker's time, so the main thread's queueing subtraction cannot hide a phase.",
     "Exported because `rasterWorkerClient`'s inline path runs it on the main thread; jsdom always takes that path."],
    "§9")

# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]

# One or two sentences per FILE in the batch: what the file is for in the design.
ROLE = {
    "src/engine/raster/RasterRenderer.js":
        "The raster renderer, the app's default: a `Renderer` subclass that draws the ink into plates through "
        "`PictureLayer`, `PlateStore` and the worker pool, and keeps only the live stroke and the selection chevrons "
        "in SVG. It is the only poster of raster jobs, and it runs the drag plane, the pen-up hold, the crossing "
        "prebake, the zoom-out ladder and the Scenes snapshots (DESIGN.md §9).",
    "src/engine/raster/MovePlane.js":
        "The drag plane: the picture under, of and over a selection split by z into layers of plates, rastered "
        "while the selection exists — cut coarser where it would not fit its cap, with a quick coarse level asked "
        "for first — so a drag moves the selected ink as a translated bitmap and re-rasters once at the drop "
        "(DESIGN.md §9).",
    "src/engine/raster/plate.js":
        "The plate grid: 512-device-pixel squares measured in pixels, the quarter-octave zoom quanta, and the "
        "plate cache key. No state and no imports.",
    "src/engine/raster/rasterWorkerClient.js":
        "The raster worker pool on the main thread: one strip queue ordered by priority, the per-quantum "
        "staleness rule, the buffer pool, the end-job contract, and the inline fallback that runs the worker's "
        "own entry on this thread.",
    "src/engine/worker/rasterWorker.js":
        "The raster worker's entry, bundled to `public/raster-worker.js`: rasters each plate of a strip with "
        "`rasterCore.renderPlate` into one reused scratch and posts back the pixels, per-plate timings and counts, "
        "painted-id sets, guard words and the job's buffers. `runJob` is also the inline path.",
}

# ---- 2026-10-05, the rebuilt tree ----
add("rr.idle", "idle(fn)",
    "Runs `fn` at idle within a second (`requestIdleCallback`), else after 30 ms.", ["-"], "§9")
add("rr._sizeEdges", "_sizeEdges(w, h)",
    "Sizes FC1's z 3, the selection's edge layer, to the screen; nothing while no selection shows.", ["-"], "§10")
add("rr.setLasso", "setLasso(fn) · setTileDebug(v, fn) · setEraseDebug(v, fn)",
    "The lasso's loop and the tile and erase debug overlays, handed to the SVG overlays (`svgOverlay.js`).", ["-"], "§9")
add("rr.refreshSelection", "refreshSelection()",
    "Redraws the lasso alone — what a lasso drag calls, not `syncWorld`.", ["-"], "§10")
add("rr.setSelectionAnts", "setSelectionAnts(fn)",
    "The engine's selection-indicator decision (`overlays._selectionAnts`), pulled at each camera step.", ["-"], "§10")
add("rr.setDragState", "setDragState(fn)",
    "The engine's live drag, pulled here because the raster renderer draws the dragged ink itself (PAPER-PLAN R3).", ["-"], "§9")
add("rr.update", "update()", "The SVG layer's update: the live stroke and the overlays follow.", ["-"], "§9")
add("rr._farList", "_farList(pl, lvl)",
    "A far plane level's own items (F122): the Stage's snapshot of its rectangle, read at idle a budget at a time; the level is posted when its snapshot is in, packed at the snapshot's G, and a re-cut level is forgotten.",
    ["Read in the aim, it was a 0.2–0.6 s frame after every select and every drop (TESTER-3). A read that runs out leaves the level with no list and is counted (`farListFallbacks`)."],
    "§9")
add("rr._readIdle", "_readIdle(frameId, rectOf, stale, done, tries)",
    "An off-camera table read at idle, IDLE_READ_MS at a time, up to IDLE_READ_TRIES: `done(snapshot)`, or `done(null)` when the rectangle is gone or the reads ran out; nothing once `stale()` holds.",
    ["A read past its budget keeps the tiles it baked, so the next try goes further."], "§9")
add("rr.setLiveArcs", "setLiveArcs(gaps)",
    "The live stroke's arcs handed to the live layer (`LiveStrokeLayer.arcs`).", ["-"], "§9")
add("rr._origin", "_origin()",
    "The world transform's origin: the live layer's (FC6) — `overlays._selDecide` caches on its identity.", ["-"], "§9")
add("rr._sceneList", "_sceneList()",
    "The Stage's items that packs paint — a stroke pending its shape skipped (PLAN §1.5) — one array per table version and G.", ["-"], "§9")
add("rr._pumpSoon", "_pumpSoon()",
    "Dispatches the job queue in a microtask, for a request made outside a camera step — the rest's quiet, a commit's group — since nothing else pumps while the camera is still and nothing is in flight.",
    ["-"], "§9")
add("rr._noteCore", "_noteCore(s)",
    "An inline render's core phases, into the frame's perf row and out of the view's time around it.", ["-"], "§14")
add("rr._pyrBuild", "_pyrBuild(container, dpr, opts)",
    "Builds the picture pyramid's parts (A3 §1, §4): the plate store, the pyramid (the layer) and the job queue over the raster pool; this renderer packs, measures, posts and lands for them (FC3).",
    ["It also subscribes to the Stage's commits: a shape that landed in a commit opens its group first, before any patch step could publish its plates while the live path is still up (A3 §3.6), and the commit's patch step is made due in its task. A slot an orphaned answer frees pumps the queue."],
    "§9")
add("rr._pyrCommitStep", "_pyrCommitStep()",
    "A commit's patch step that no compose or camera step ran in its task, in a `settle` perf row of its own when none is open; not while the tab is hidden — it stays due (PLAN §5.22 item 3).",
    ["-"], "§9")
add("rr.onLevers", "onLevers()",
    "A Dev lever changed (A3 §8): the plate budget is applied in one eviction pass; a step change is the next view's.", ["-"], "§14")
add("rr.noteUserEdit", "noteUserEdit()",
    "The user's own action just committed (an undo, a redo, a drop): its patch gets the user's budget (A3 §3.3).", ["-"], "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("rr.setBusy", "setBusy(fn)",
    "Whether the engine is busy sending a report: the prefetch plans nothing meanwhile (A3 §4.3).", ["-"], "§9")
add("rr.noteAttention", "noteAttention(sx, sy)",
    "The attention point (A3 §1.5, §4.4) — the last pointer, wheel focus or pinch centre — handed to the pyramid in device pixels: the plan's and the queue's nearest-first.",
    ["-"], "§9")
add("rr._pyrMotion", "_pyrMotion(v)",
    "The queue's motion (A3 §4.4): moving iff the published view's affine changed since the last step in the same frame, with its pan and zoom velocity, the attention point and the view.",
    ["The velocity drives the queue's velocity rule — skipping cells the camera will have left by a strip's arrival — and the re-aim of a view strip at the level the camera is heading to (DESIGN.md §9)."],
    "§9")
add("rr._pyrPrefetch", "_pyrPrefetch(v)",
    "The prefetch, at idle — the camera still and nothing of the view's or a patch's queued or in flight — once a view revision and a generation: a change stales the cached coarser levels, and a zoom's stand-in must be fresh (blurrier, never older).",
    ["The scene must be idle too: the plan waits for the rest's quiet after the last commit, because a bake commits every few frames and a plan per commit re-rendered the coarser levels each step (P5). A new plan supersedes the queued one by generation. Its off-camera tile reads are warm, so they survive crossings (F83: the zoom back in baked 19–22 tiles without it, 9–10 with it). A report being sent plans nothing."],
    "§9")
add("rr.listMargin", "listMargin(inScale)",
    "The margin the camera's table window is grown by: four view cells, so the near prefetch's ℓv − 1 packs from the camera's table (A3 §4.2); at least a view while a selection is on the plane's path, whose SEL cells reach a view past the screen (A3 §6 D1).",
    ["-"], "§9")
add("rr._tableList", "_tableList(tab)",
    "A snapshot table's items that packs paint — a stroke pending its shape skipped — one array per table, so the pack's prepass memoised on the list's identity is reused.",
    ["-"], "§9")
add("rr._pyrPack", "_pyrPack(job, jobId, bufPool)",
    "Packs a typed job (A2 §3.1): from its own table (the prefetch's off-camera snapshot) at that table's G, else from the Stage at its G keeping only the cells the camera's table covers; a refused cell is un-asked, to be asked again once covered (F119).",
    ["A plane layer packs its own members (`only`) or everything but them (`omit`); any other pack leaves the dragged selection out while the plane draws the move. A clipped job packs only what meets its clips (PLAN §5.18). The pack's prepass and item costs calibrate the pyramid's estimate (A3 §2.2). `jobId` null: the inline executor's."],
    "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("rr._pyrMeasure", "_pyrMeasure(job)",
    "The estimate's inputs over a job's cells at its Z, or over their clips (A3 §2.2, §3.3): the visible chords, the item-box pixels, the union items' rows, the cells an item meets, the items the pack keeps, the list's items.",
    ["For a clipped patch each item's chords count by its rows' share inside the clips — the rows a clipped render deposits (A3 §3.1). The pyramid prices an inline render from these against its calibration, which decides an inline patch, a coarser level or the workers (DESIGN.md §9)."],
    "§9")
add("rr._pyrSubmit", "_pyrSubmit(st, pool)",
    "The queue's pool face over the worker client (A3 §4.4): a strip packed and posted now, or refused; a cut posts its own entry. A dispatch outside a step or an arrival opens a `settle` perf row, the rest's.",
    ["-"], "§9")
add("rr._pyrPost", "_pyrPost(st, pool)",
    "Posts one strip to the raster pool: its plates, a pack callback run at dispatch, and the result, drop and requeue handlers; the post less the pack is timed as `xfer.out`.",
    ["The strip's queued-at goes to `rasterPerf`, where an arrival's wall time starts (every phase of the frame in a bucket)."], "§9")
add("rr._pyrRequeue", "_pyrRequeue(st, jobId)",
    "The pool failed under a strip — a worker's error or silence (RW-1): its job id ended and the strip put back at the head of its priority (H7).",
    ["-"], "§9")
add("rr._pyrResult", "_pyrResult(st, res, info)",
    "A strip's result: one plate record per cell — a whole plate's pixels made an image bitmap first where the scope can, a clip kept as the patch — then landed in an `arrival` perf row.",
    ["When any bitmap has to be made, the landing waits for them all, so the strip lands at once."], "§9")
add("rr._pyrLand", "_pyrLand(st, recs, res, info)",
    "Lands a strip's plate records in the pyramid (a late plate of a dropped layer is refused by the store), ends its job, calibrates the estimate, pumps the queue, moves the drag plane on, and composes once.",
    ["The plane composes on its own plates' arrival; a landing plane ends on the last fresh plate under it; a dragging plane picks its best level again (DESIGN.md §9)."],
    "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("rr._pyrPlaneOf", "_pyrPlaneOf(pl, lvl)",
    "The drag plane as the pyramid draws it (A3 §6): the drawn level's Zp and layers, with the plane's state, partial flag, frame and offset read live.",
    ["-"], "§9")
add("rr._pyrStopgap", "_pyrStopgap(pl)",
    "No whole plane level at a drag step (A3 §6, H4): a small selection's own layers of the quick level, with what lies below and over them on its start footprint, rendered on this thread now and landed as plane plates; true when it ran.",
    ["Bounded by STOPGAP_OBJECTS selected objects and STOPGAP_PLATES plates; its time is counted in the plane's stats."], "§9")
add("rr._pyrDrop", "_pyrDrop(st, d)",
    "A strip that will not land: its job id ended, its slot freed, and its cells asked for again at the next step.",
    ["A drop the queue's own pump made (`before`) is counted there; a failure gives the velocity rule no arrival sample."], "§9")
add("rr._pyrUnask", "_pyrUnask(st, why)",
    "Forgets a dropped strip's own asks — those made at or before its own — so its cells are asked for again; a newer ask, and every other cell's, stands, since its job brings them. A strip whose cells were exact asks for nothing.",
    ["-"], "§9")
add("rr._pyrLive", "_pyrLive(v)",
    "The pen-up rule (PLAN §1.5, A3 §3.6): a held live path stays while its stroke is pending, with no limit; once its shape has landed, one group commit publishes the drawn cells under its box and takes the path down in the same task.",
    ["An undo or a cancel (the stroke left the document) takes it down now; a crossing carries it (`_liveCross`); while the new frame's table lacks the stroke the document says whether it is pending; a group past LIVE_HOLD_MS commits what it has. Run at every Stage commit and every step; returns how many paths came down."],
    "§9")
add("rr._liveCross", "_liveCross(F)",
    "A frame crossing with held live paths: each carried into the new frame — its root scaled by R^Δdepth and moved, its box and a waiting group's rectangle mapped — so it stays where its stroke is drawn until its group commits; one with no map comes down.",
    ["Never neither the path nor the stroke's plates (PLAN §1.5)."], "§9")
add("rr._pyrTakeDown", "_pyrTakeDown(h, handoff)",
    "Takes one held live path down — `handoff`: its plates published in this task — with the hold's length counted; false when it was already gone.",
    ["-"], "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("rwc.setOnSlotFreed", "setOnSlotFreed(fn)",
    "Registers the hook called when an abandoned job's answer frees its worker slot — nothing else reports that capacity, so the renderer pumps the job queue there.",
    ["-"], "§9")
add("rwc.freed", "freed(released)", "Calls the slot-freed hook when a release freed a slot.", ["-"], "§9")
add("rwc.failPool", "failPool(e, respawn, silent)",
    "Every job in flight handed back and the pool terminated: a strip goes back to the head of its priority (H7), a request with no requeue is dropped; a new pool while respawns are left, else the inline path for the session.",
    ["The re-pack mints a new job id, so the caller ends the old one. `silent`: the record the watchdog found silent, whose requeue hears \"watchdog\"; every other hears \"worker\" (RW-1)."],
    "§9")
add("rwc.armWatchdog", "armWatchdog()",
    "While a worker holds a job, a check every half WATCHDOG_MS.", ["-"], "§9")
add("rwc.checkWatchdog", "checkWatchdog()",
    "A job held past WATCHDOG_MS is marked, and the pool replaced only if it is still unanswered at the next check, since an answer queued behind a long main-thread task lands before then (RW-1).",
    ["-"], "§9")
add("rwc._checkWatchdogForTests", "_checkWatchdogForTests()",
    "For the tests: one watchdog check now.", ["-"], "§9")
add("rwc.dispatchCut", "dispatchCut(entry, slot)",
    "Posts an erase cut or descent (PLAN §1.6) into a worker slot of the raster pool, through a transport when one is set, or — with no worker, a broken pool — runs the worker's own `runCut` on this thread a turn later.",
    ["The cut's message is built at dispatch (`req.wire()`); a build that throws is dropped before it is posted. The cuts share the pool with the plates (DESIGN.md §7, §9)."],
    "§7")
add("rwc.onCutMessage", "onCutMessage(slot, data)",
    "A cut's answer: its record ended and its `onResult` called; a job that threw in the worker fails; an answer for an abandoned record frees the slot.",
    ["-"], "§7")
add("rwc.poolBroken", "poolBroken()",
    "Whether the pool is broken — no transport and no worker: the script did not load, or the pool failed past its respawns — so the erase runs its jobs inline.",
    ["-"], "§9")
add("rwc.freeSlots", "freeSlots()",
    "The free slots now: idle workers, a transport's spare capacity, or the one inline slot when nothing is in flight.", ["-"], "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("mvp.farLevels", "farLevels()",
    "The drag plane's levels whose plates overhang the camera's table — more than two octaves coarser, so one packed from the table would hold paper where ink is (REVIEWER-4 P-2); each gets its own table over its cover, read at idle.",
    ["The camera's table reads four view cells past the screen (A3 §4.2) and a plate k octaves coarser spans 2^k of them. Until its table is in (`listPending`) the level is left out of the plane's requests (`_farList`)."],
    "§9")
add("mvp.coverOf", "coverOf(lvl)",
    "The rectangle, in frame units, a plane level's plates cover.", ["-"], "§9")
add("mvp._key", "_key(tag, pZq, i, j)",
    "A plane plate's store key at the level's Zp (`planeKey`, A3 §6).", ["-"], "§9")
add("rwk.runCut", "runCut(kind, job)",
    "One erase cut or descent in the raster worker: its wired job in, its wired result out; the inline path (a broken pool) runs this same function on the main thread.",
    ["So every erase suite checks the same geometry whether its cuts run in workers or inline (DESIGN.md §7: one cut is a job)."], "§7")
