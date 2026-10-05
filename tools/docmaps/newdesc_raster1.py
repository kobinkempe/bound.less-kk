# -*- coding: utf-8 -*-
"""Per-function entries for the raster renderer (RasterRenderer.js), the drag plane
(MovePlane.js), the plate grid (plate.js), the raster worker client and the raster worker."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/raster/RasterRenderer.js ----
add("rr.resetRasterStats", "resetRasterStats()",
    "Zeroes every counter in `rasterStats`, the renderer's own report counters.", ["-"], "§15")
add("rr.RasterRenderer", "RasterRenderer",
    "The raster renderer: a `Renderer` subclass that paints the render list into cached plates on a canvas instead of into SVG.",
    ["It keeps the base class's Two.js `<svg>` for the live stroke and the selection chevrons only; the ink goes through `PictureLayer` (the mapping and the compose), `PlateStore` (the cache and its invalidation) and `rasterWorkerClient` (the queue and the workers). It is the only module that posts raster jobs.",
     "The app's default renderer since 2026-09-22; the SVG renderer is behind `?svg`. The engine's own `raster` option defaults to off, so the suites and the one-off engines are SVG (DESIGN.md §9)."],
    "§9")
add("rr.RasterRenderer.constructor", "RasterRenderer.constructor(container, camera, cfg, opts)",
    "Builds the SVG base, the `PictureLayer`, the drag plane and the counters, attaches the perf recorder and spawns the worker pool.",
    ["Positions the Two.js `<svg>` absolutely at z-index 1 (ink canvas 0, ant canvas 2, chevrons 3), reads the dpr, builds the layer with its `onPlates` and `onRepost` callbacks routed to `_post`, hooks the store's `onRelease`, creates the `MovePlane`, attaches `rasterPerf` to its seven sources, arms the dpr listener and calls `ensureRasterPool`.",
     "It also forwards the store's `onShow` (the tab visible again) to the engine's `onShown`, and sets `forcePerStepDrag`, a test hook that turns the drag plane off so every drag renders each step.",
     "The camera must be the same object the engine later hands `frameFor`: the settle's publish and the quantum switch read the injected one outside the animation-frame cycle. The engine constructs the `PlateStore` and owns its lifetime."],
    "§9")
add("rr._buildSelOverlay", "_buildSelOverlay(svg)",
    "Builds the one SVG selection layer the raster path needs, `bl-sel-edges` for the chevrons, at z-index 3.",
    ["The ants are painted on `OverlayLayer`'s canvas, so `bl-sel-layer` is never created. `_selOv` and `_selEls` keep the base class's shape, so `Renderer._dropSelOverlay` and `_renderSelChevrons` run unchanged."],
    "§12")
add("rr.antPainter", "antPainter (getter)",
    "True: tells `overlays._selDecide` to keep each ant run's pieces for the canvas painter instead of building an SVG path string.",
    ["The code records 8.3 ms and 345 KB taken off a decision at F39's density."],
    "§12")
add("rr._renderSelOverlay", "_renderSelOverlay(view)",
    "Draws the selection indicator on the raster path: the ants on the overlay canvas, the chevrons in SVG, both at the published view.",
    ["Asks the engine for its decision (`_selAntsFn`), timing it as the overlay's `decideMs`; with nothing to show it drops the overlay. Otherwise it sizes `bl-sel-edges`, builds the `OverlayLayer` on first use, hands it the decision, the view and `_edgeShift`, draws the chevrons with `Renderer._renderSelChevrons` and keeps the edge layer last in the host.",
     "It takes the published view, never the camera, so the ants and the ink share one mapping. With no view published yet it leaves what is drawn."],
    "§12")
add("rr._dropSelOverlay", "_dropSelOverlay()",
    "Hides the ant canvas and removes the SVG chevron layer when the selection goes.",
    ["The overlay's buffer is kept, so the next selection does not reallocate it."],
    "§12")
add("rr._makeOverlay", "_makeOverlay()",
    "Creates the `OverlayLayer` for the ants on the first selection decision and adds it to the renderer's list of screen layers.",
    ["Never at construction: a tool change must not cost the plane's 10.48 MiB. Joining `_layers` is what has it resized, released and destroyed with the ink layer. It also arms the reduced-motion listener."],
    "§12")
add("rr._edgeShift", "_edgeShift(view)",
    "The CSS-px difference between the published view's snapped translation and the camera's pan, applied to the screen-edge ant spans.",
    ["The edge spans are computed in the camera's screen px while the ink is composed at the view's whole-pixel translation; the overlay adds this to the spans only. One two-element array, reused."],
    "§12")
add("rr._armReducedMotion", "_armReducedMotion()",
    "Listens to `prefers-reduced-motion` and passes it to the ant overlay, which owns the crawl clock.",
    ["A CSS rule cannot stop the canvas crawl; the chevrons keep the stylesheet's own rule. A no-op without `matchMedia` (jsdom), which is what lets a raster engine construct there."],
    "§12")
add("rr._dropReducedMotion", "_dropReducedMotion()",
    "Removes the reduced-motion listener.", ["-"], "§12")
add("rr.setSize", "setSize(w, h)",
    "Resizes the SVG base and every screen layer at the current devicePixelRatio, and re-arms the dpr listener.",
    ["The base `setSize` carries no dpr and the layers take `(w, h, dpr)`, so this is the one place that reads `devicePixelRatio`."],
    "§9")
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
    "At a drag's start: aims the drag plane at the selection and posts what it lacks; false sends the drag down the per-step render path.",
    ["Ends a plane still landing from the last drop first. False with no store, a view that is neither plates nor a settle, no selected ink on screen, or `forcePerStepDrag` set; a large or interleaved selection is not refused, the plane merges runs or cuts coarser instead (`MovePlane._cut`). The refusal is kept in `_noPlaneDrag`, which stops `_planeIdle` aiming a plane under that drag.",
     "Called from the engine's `_beginHold`; on false the engine takes no hold."],
    "§9")
add("rr._planeViewOk", "_planeViewOk(v)",
    "Whether a view can carry a drag plane: plates mode, or a settled view.", ["-"], "§9")
add("rr.dragLight", "dragLight()",
    "Whether a drag step may skip the list build: the plane has layers, the view carries it, and it is not landing.",
    ["`selection.js` asks it on each drag step while the engine holds the move; true means the step is a camera frame only (the list build it skips is 120–240 ms on the Magnum Opus, per the caller's comment)."],
    "§9")
add("rr.planeCap", "planeCap (getter)",
    "The most plates a drag plane may pin, both its levels together: 40 on a desktop, 24 on a phone, or a test's override.", ["-"], "§9")
add("rr._aimPlane", "_aimPlane(v)",
    "Keeps the drag plane aimed at the current selection and view, re-pins its plates in the store and posts what they lack; false when the plane is refused.",
    ["Under the `forcePerStepDrag` test hook it ends any plane and returns false. Otherwise it pulls the selection through `_planeFn` and calls `MovePlane.aim`; every old tag the plane no longer carries — all of them after a reset or a refusal, a renamed layer after a re-cut — is dropped from the queue and the store. Pins the plane's keys with `setPlanePins`, or clears them on a refusal. After a post it calls `onPlaneAimed` (the engine's ladder check), because the new pins can push the ladder's plates out."],
    "§9")
add("rr._postPlane", "_postPlane(pl)",
    "Posts the plates each plane layer lacks, one post per layer, skipping cells already fresh or in flight.",
    ["A layer's cells are a list, not a range, so each missing cell is asked of the store as a one-cell unpinned `want`. Fresh and in-flight cells are checked directly and never reach `want`, which evicts: this runs on every drag step. Returns the strips posted."],
    "§9")
add("rr._dropPlaneTags", "_dropPlaneTags(tags)",
    "Removes a plane's layer tags from the queue and the store.",
    ["Each tag is a pseudo-quantum (`z<n>_<quantum>_<members hash>`) no other request reads, so its queued strips go through `dropQueued` and its plates through `dropQuantum`."],
    "§9")
add("rr._planeStep", "_planeStep(v)",
    "Each camera step: follows a live drag with the plane, ends a landing that is done, or keeps an idle plane ready; then picks the level to draw and tells the layer.",
    ["Under a drag, a plane with no layers, at another frame, or in a view that cannot carry it is lost (`_losePlane`); otherwise it moves by the pointer's displacement from the drag's start and re-posts any plane plate staled mid-drag.",
     "The drawn level is `MovePlane.pick`'s: the main level whole, else the quick one whole, else the selected layers of either alone (partial). Under a drag with none of those and no stopgap yet, `_planeStopgap` rasters a small selection here. Only a whole level sets `_dragOmit`, which makes every other pack leave the selection out; while partial the plates still show the ink where it was. Counts the steps drawn not ready, partial and from the quick level."],
    "§9")
add("rr._losePlane", "_losePlane()",
    "Ends the plane under a live drag and tells the engine, which releases its hold so the drag renders each step.",
    ["Counted in `planeStats.lost`; sets `_noPlaneDrag` so no new plane is aimed under that drag."],
    "§9")
add("rr._planeIdle", "_planeIdle()",
    "With nothing dragged, aims the plane at the view once the published view has stayed unchanged for 150 ms and the layer is not holding a zoom.",
    ["Unchanged means the same frame, quantum, zoom and view revision, a pan included, with no settle about to publish and no quantum hold; the code records 938 plates posted over a 60-step pan in Kobin's Chrome when each pan step re-cut the layers. A plane aimed at another frame or quantum is ended at once, and so is any plane while the layer holds a zoom, whose hold pins its own set. Otherwise one timer re-checks after `PLANE_QUIET_MS`.",
     "Does nothing under `forcePerStepDrag`, after a refused drag, or during a drag. Also called from `_deliver`, since a settle's publish arrives without a camera step."],
    "§9")
add("rr._planeLanded", "_planeLanded(v)",
    "Whether a landing plane can go: every cell it covers has a fresh plate again, the camera left its frame or quantum, or `MOVE_HOLD_MS` passed.",
    ["A timeout is counted in `planeStats.landTimeouts`."],
    "§9")
add("rr._endPlane", "_endPlane()",
    "Takes the plane down: records the landing's length, clears its timer, drops its plates and pins, resets it and tells the layer.",
    ["The next camera step or `_planeIdle` aims a new one."],
    "§9")
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
    "Tears down the raster path: abandons in-flight jobs, empties the queue, clears the timers, stops the pool and listeners, destroys the layers, then the SVG base.",
    ["The abandon comes first: a job never reported leaves its keys in the store's in-flight map and `want` reads them as in flight rather than missing, a permanent hole."],
    "§9")
add("rr.endLive", "endLive()",
    "Pen-up: releases the live stroke's model now and keeps its SVG path on screen until the plates under it are fresh.",
    ["On the plates or settle path, with a store, a live path and points, it records the stroke's box (half its width added), its frame and a limit of `LIVE_HOLD_MS` (3,000 ms, extended while its plates are on the way) in `_liveHeld`, and arms the timer; every later pack paints the stroke. Anywhere else the base `endLive` removes the path at once: the sync path rasters the stroke in the pen-up frame itself."],
    "§9")
add("rr._armLiveTimer", "_armLiveTimer()",
    "Arms one timer for all held live paths, at the earliest limit; it releases what it can and re-arms while any path is held.",
    ["A release is followed by `update()`, so Two redraws without the path."],
    "§9")
add("rr.addLive", "addLive(o)",
    "Starts the live stroke's SVG path, first re-centring the overlay origin on the view and re-syncing the world transform if it moved.",
    ["The origin is one object with one writer, this method, and a new choice is a new object, because `_selDecide` caches on the origin's identity. Re-syncing here is what puts a stroke begun after a pan or zoom under the pen instead of offset by the origin's move until pen-up."],
    "§9")
add("rr._syncWorldTransform", "_syncWorldTransform(view)",
    "Sets the SVG world group's scale and translation from the published view, with the overlay origin folded in, so the live stroke sits on the composed ink.",
    ["The view maps a frame point to `p·k + tx` in device px and the SVG is in CSS px, so both are divided by the view's dpr. Without a view (or its dpr) it falls back to the base's camera transform."],
    "§9")
add("rr.syncWorld", "syncWorld(view)",
    "The base world sync and overlay tail, timed into the `ovl.tail` slot.",
    ["Both `render` and `syncCameraOnly` reach the tail here, so one bracket times both and neither counts twice."],
    "§9")
add("rr.beginRender", "beginRender()",
    "Opens the frame's perf row before the engine builds its list, so the list build counts inside the frame.",
    ["`render` finds the row open and does not open a second; a caller that skips this gets the row opened in `render`."],
    "§15")
add("rr.noteList", "noteList(ms)",
    "Charges the engine's own list-build time to the `eng.list` slot.", ["-"], "§15")
add("rr.render", "render(list, frame)",
    "A full frame on the raster path: records the list, runs the camera step (mapping, plates, compose, posts) and syncs the SVG world and overlays.",
    ["The document-event drain is the engine's and runs just before this call, because `_buildList` itself emits events the drain must see. Records the widest unfitted fat stroke for the idle fitter and sets `_hasFat`. Returns false: there are no ink groups to reorder."],
    "§9")
add("rr.syncCameraOnly", "syncCameraOnly()",
    "A camera-only frame: drains document events, then maps, composes and posts from the last list, and moves the SVG overlay.",
    ["The drain is called here rather than at the engine's call sites because `selection.js` calls this method too, and a compose there would otherwise use plates a queued event has invalidated. No list build and no overlay rebuild."],
    "§9")
add("rr._frameStep", "_frameStep(list)",
    "One camera step: culls for the chord estimate, gets the published view, drops dead quanta's strips, then either rasters in sync mode or wants, composes and posts plates.",
    ["Plates path, in order: `store.want(view)` (the visible pins, after `frameFor` has added its own), the plane step, `compose(hits)`, the held-live release, and a post of the misses. The sync path ends or loses the plane, rasters on this thread, releases held paths and gives the layer the measured core time.",
     "`frameFor` can post inside itself; that time is subtracted from `eng.view` because it is already counted in `eng.pack` and `xfer.out`. Returns the published view, which the overlays are handed."],
    "§9")
add("rr._beginFrame", "_beginFrame(kind)",
    "Advances `frameSeq` (from the engine's counter when given), counts the frame, and opens its perf row.", ["-"], "§15")
add("rr._endFrame", "_endFrame()",
    "Closes the frame's perf row and marks the engine's row closed.", ["-"], "§15")
add("rr._openRow", "_openRow(seq, kind)",
    "Opens a perf row and marks one as live, so `_post` and `_pack` can tell whether to open their own.", ["-"], "§15")
add("rr._closeRow", "_closeRow()",
    "Closes the live perf row.", ["-"], "§15")
add("rr._add", "_add(name, ms)",
    "Adds a duration to one named perf slot, through `rasterPerf`'s slot index or the name itself for a test recorder.",
    ["-"], "§15")
add("rr._endJob", "_endJob(jobId)",
    "Ends a job id in the store, freeing its in-flight keys.", ["-"], "§9")
add("rr.snapshotJob", "snapshotJob(o)",
    "Rasters one plate of any frame and rect off camera, for the Scenes panel, and resolves with its bitmap; the plate cache is never touched.",
    ["Each call has its own quantum string (`t1`, `t2`, …), so no cached plate is reused at a zoom it was not rastered at, and snapshots never drop each other's queued strips. The rect lands on plate (0, 0) through an `offset` folded into each item at pack time; an offset at or past the coordinate bound is rejected before any work.",
     "Priority 4. Resolves null for an empty plate and the raw pixels where there is no `createImageBitmap`; rejects on a drop or an abort, and an abort also drops the queued strip. Called by `sceneOps.snapshotView`."],
    "§14")
add("rr.report", "report()",
    "The renderer's flat report: frame seq, view mode, the plane's state and plate count, every `rasterStats` counter, and the pack's packed and culled counts.",
    ["-"], "§15")

# ---- src/engine/raster/MovePlane.js ----
add("mvp.resetPlaneStats", "resetPlaneStats()",
    "Zeroes the drag plane's counters.", ["-"], "§15")
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
    "Empties the plane — selection, list, both levels, the drawn level, the stopgap, layers, tags, keys, ranges, offset, landing times — sets it idle and bumps `gen`.",
    ["The caller compares `gen` to know it must free the old layers' plates. `layers`, `r` and `selR` mirror the main level; `tags` and `keys` cover both levels."],
    "§9")
add("mvp.showing", "showing (getter)",
    "Whether the plane is drawn this compose: while it is dragging or landing.", ["-"], "§9")
add("mvp.cellCount", "cellCount()",
    "The number of plates the plane pins.", ["-"], "§9")
add("mvp.aim", "aim(st, list, view, cfg, max, dpr, live)",
    "(Re)aims the plane at a selection, a list and a view; true while it is valid for them.",
    ["Does nothing while dragging or landing. A new selection key, frame, quantum or zoom resets it, and with no selected ids it is refused; a new list, id set or cap under the same selection re-cuts it, so a pan keeps the plates of every layer whose members are unchanged. The zoom is compared as well as the quantum because a settled view is `q` \"e\" at any exact zoom."],
    "§9")
add("mvp.idsHash", "idsHash(ids)",
    "A short FNV-1a hash of an id set, the same for the same ids in any order: the part of a layer's tag that names its members.",
    ["-"], "§9")
add("mvp._cut", "_cut(list, ids, view, cfg, max, dpr, live)",
    "Cuts the plane: groups the pack's on-screen families in paint order into selected and unselected runs, merges runs past the layer cap, and picks a main level that fits the plate cap and a quick level under it.",
    ["Families come from `rasterPack.paintFamilies`, so the layers split exactly where the pack paints; a family with no item box on the view's plates is skipped, and unselected families below the first selected run stay in BELOW. Past `MOVE_PLANE_LAYERS` the smallest unselected run sandwiched between two selected ones is merged away, so it is drawn under the selection (counted in `merged`).",
     "The main level is the first of 0 to 3 octaves coarser (`_level`) whose plates fit the cap — at most 16 for a level drawn magnified, that is coarser or with the view between quanta — else the coarsest (counted in `overCap`). A plane of more than 4 plates also gets a quick level 2 octaves under the main, kept when it has fewer plates, fits the cap together with the main, and is within 16. Refused only when no selected ink is on screen."],
    "§9")
add("mvp._level", "_level(runs, view, k)",
    "Builds the plane's layers at `k` octaves coarser than the view: each layer's cells, tag and keys, the plate count, the bounding ranges and BELOW's cell set.",
    ["The level's quantum is the view's less 4k (derived from the zoom when the view is a settle) and the view's plate range is mapped onto its grid. A run's cells are its item boxes on that grid; BELOW covers the union of every run's cells and omits every run's ids.",
     "A layer's tag is `z<n>_<quantum>_<members hash>`, so a re-cut that changes a run's members is a new layer and never reuses the old plates. BELOW's cell set is what `PictureLayer` reads to skip the view's own plates under a whole BELOW mid-drag."],
    "§9")
add("mvp.requests", "requests(list)",
    "One store request per layer, the quick level's first — BELOW with its omitted ids, the others with only their own ids on transparent paper — or null when refused or landing.",
    ["Each is off camera, priority 2, mode `plane`, at its level's zoom, and carries its cell list instead of a range."],
    "§9")
add("mvp._whole", "_whole(lvl, store, selOnly)",
    "Whether every plate of a level, or of its selected layers only, is cached and live.", ["-"], "§9")
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
    "Turns a totals array into an object keyed by the given names, for the report.", ["-"], "§15")
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
    "Mints a job id, has the caller pack the strip, records it in flight and posts it to its worker, the transport, or the inline `runJob`.",
    ["A pack that throws or returns null is reported dropped with the new id (`pack`, `empty`). The posted-at time is the main thread's; the wire and post time goes to `postMs`.",
     "The inline path runs the worker's own `runJob` on a later microtask, so both paths draw the same pixels and jsdom checks the shipped code."],
    "§9")
add("rwc.onFailed", "onFailed(jobId, err, slot)",
    "A job's terminal failure: frees its slot, reports it dropped with the error, and pumps; an unknown id only releases an abandoned hold.",
    ["-"], "§9")
add("rwc.onMessage", "onMessage(slot, data)",
    "A worker's answer: frees the slot, returns the job's buffers to the pool, derives the timings, totals the guards and counts, checks staleness, then calls `onDrop` for stale plates and `onResult`.",
    ["Queueing time is the main thread's wall time minus the phases the worker reports, since the worker returns durations only. A `raster-error` message goes to `onFailed`. A result with no record is ignored except to release an abandoned hold. A stale arrival fires both `onDrop` (naming the stale plates) and `onResult`; the caller ends the id once."],
    "§9")
add("rwc.plateBitmap", "plateBitmap(px)",
    "Converts one plate's raw RGBA to an `ImageBitmap`, or null where the scope has no `createImageBitmap`.",
    ["The layer composes bitmaps only; where this is null (jsdom) the caller puts the raw pixels."],
    "§9")
add("rwc.rasterWorkerReport", "rasterWorkerReport()",
    "The worker client's report: mode, worker counts, queue and in-flight sizes, held slots, live quanta, job totals, bytes, timings, the guard and count totals and the buffer pool.",
    ["`heldSlots` is the capacity abandoned jobs still hold; `liveRequests` counts the quanta with a newest frame on record, and falls only at the next submit or drop."],
    "§15")
add("rwc.resetRasterWorkerClient", "resetRasterWorkerClient()",
    "The suite's reset: empties the queue and the in-flight map, terminates the workers, and clears the broken flag, ids, overrides, buffer pool and counters.",
    ["It reports nothing in flight; the live teardown is `destroyRasterPool`."],
    "")

# ---- src/engine/worker/rasterWorker.js ----
add("rwk.resetGuards", "resetGuards()",
    "Zeroes the raster core's guard counters, so a job's guards are its own.", ["-"], "§9")
add("rwk.runJob", "runJob(msg, opts)",
    "Rasters every plate of one strip into the one RGBA scratch and returns the wired result: bitmaps or pixel copies, ids, timings, counts, guards and the job's buffers.",
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
