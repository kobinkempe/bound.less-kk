# -*- coding: utf-8 -*-
"""Per-function entries for the raster renderer's picture layer and plate cache
(src/engine/raster/PictureLayer.js, src/engine/raster/PlateStore.js)."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/raster/PictureLayer.js ----
add("pic.resetPictureStats", "resetPictureStats()",
    "Zeroes every counter in the module's `pictureStats`, for the suites and the probes.", ["-"], "§15")
add("pic.snapPx", "snapPx(x)",
    "The module's one rounding: the screen translation `d` and the canvas backing-store size.",
    ["`Math.round`. FC2 keeps the snap of `d` in this one place; a second snap anywhere would separate the ink from the ants (up to 46 device px between quanta, RASTERISER-PLAN §2.7)."],
    "§9")
add("pic.stretchOf", "stretchOf(Z, Zq)",
    "The stretch `s = Z / Zq` a view composes at; 1 when `Zq` is not positive.",
    ["The one derivation of `s`: `_frame` takes it at the held quantum and again at the live one when a hold breaks, and `_switchQuantum`'s guard takes it before it publishes."],
    "§9")
add("pic.mkCanvas", "mkCanvas(w, h)",
    "The default canvas factory: a `<canvas>` of the given size from `document`, or null where there is none.",
    ["-"], "")
add("pic.PictureLayer", "PictureLayer",
    "The ink canvas: maps the camera to plates once a step and composes the cached plates onto the screen, paper only where nothing reaches.",
    ["Owns the opaque `<canvas class=\"bl-ink\">` at z-index 0, the published view (`view()`, one object mutated in place with a monotonic `rev`), a lazily allocated layer canvas for composing between quanta, the settle, the quantum hold, the zoom-out preview and the carry: the last composed picture, re-mapped under the next compose where neither a plate nor a stand-in reaches. A frame point `p` lands at device px `(p·Zq − o)·s + d`, also published as `k, tx, ty` for the ants.",
     "It never posts a job: every miss goes out through `onPlates`/`onRepost` with the request it belongs to, and `RasterRenderer` posts it and owns the in-flight map.",
     "The paper colour, the host's CSS background and `ERASE_COLOR` must agree; a difference shows at the canvas edge, and only in a browser."],
    "§9")
add("pic.PictureLayer.constructor", "PictureLayer.constructor(host, camera, opts)",
    "Sets up the layer's state and its three store requests, then mounts the ink canvas in the host.",
    ["Reads the store, paper colour, settle delay, the sync budgets (`syncBudget`, `syncMaxMs`), the canvas factory, the two callbacks and injectable clock and timers from `opts`, and takes dpr and CSS size from `opts` or the camera. Allocates once the published view and the three requests handed to `onPlates`: the settle's (`q \"e\"`, prio 2), the incoming quantum's (prio 1) and the preview's (prio 0). It starts with no carried picture.",
     "`RasterRenderer` constructs it and sets `onPlates`/`onRepost` after any `layerOpts`, so the renderer stays the only poster."],
    "§9")
add("pic._mount", "_mount()",
    "Creates the ink canvas at `round(css × dpr)`, positions it absolutely at z-index 0 and appends it to the host.",
    ["Its 2D context is opaque (`alpha: false`); a missing context is counted in `noContext` and the layer then composes nothing. The stack order is z-index, never append order (FC1)."],
    "§9")
add("pic.setSize", "setSize(cssW, cssH, dpr)",
    "Resizes the ink canvas for a new CSS size or dpr and keeps every cached plate.",
    ["Returns false when nothing changed. Otherwise resizes the backing store and the CSS box, drops the layer canvas (its worst-case grid moved), forgets the carried picture (a resized canvas is cleared), makes the next `frameFor` remap, and tells the store (`noteDpr`). dpr is not in the plate key, so no plate is invalidated (D27)."],
    "§9")
add("pic.onStoreRelease", "onStoreRelease(reason)",
    "The store released its cache (the tab was hidden): drops the layer canvas, the hit list and any hold.",
    ["The ink canvas stays, and with it the carried picture: it is the screen. Reached through `RasterRenderer`'s release handler, which the store's `onRelease` calls."],
    "§9")
add("pic.destroy", "destroy()",
    "Stops the settle timer, ends any hold, frees the layer canvas and removes the ink canvas from the DOM.",
    ["-"], "§9")
add("pic.view", "view()",
    "The published view: the same object every call, mutated in place, with a monotonic `rev`.",
    ["Carries `mode, frameId, q, Zq, Z, s, ox, oy, dx, dy`, the plate range and the derived affine `k, tx, ty` (device px `X = p·k + tx`), so no reader re-derives the composite (FC2)."],
    "§9")
add("pic.settleRequest", "settleRequest()",
    "The settle's store request (`q \"e\"` at the exact zoom), the same object every call.",
    ["A request, not a mapping: it has no `s`, `d` or affine, because the settled view is published only when the whole screenful is cached (D154). Valid while a settle is pending. The renderer receives it through `onPlates`; only the suites call this getter."],
    "§9")
add("pic.previewRequest", "previewRequest()",
    "The zoom-out preview's store request, the same object every call.",
    ["Valid while `status().prevQ` is not `\"\"`. The renderer receives it through `onPlates`; only the suites call this getter."],
    "§9")
add("pic.quantumRequest", "quantumRequest()",
    "The incoming quantum's store request while the view is held at the old one, the same object every call.",
    ["A request, not a mapping: the view keeps publishing the held quantum's affine until this quantum's visible set is cached. Valid while `status().pendQ` is not `\"\"`."],
    "§9")
add("pic.status", "status()",
    "Which quanta are live (published, incoming, held, preview) and whether a settle is pending, as one reused object.",
    ["`RasterRenderer` reads it once a camera step to see which quantum has died and drop that quantum's queued strips; `onPlates` fires only when there are misses, so it cannot say. `pendQ`, `heldQ` and `prevQ` are `\"\"` for none, never null. The diagnostic report reads it too."],
    "§9")
add("pic.syncSurface", "syncSurface()",
    "Hands the layer canvas to the sync path, which rasters the screen's plates into it, and marks the layer dirty.",
    ["In sync mode `s` is 1, so `compose` does not use the layer, and the sync branch ends any hold, so this cannot overwrite a held picture. Reusing the layer saves a second screen-sized surface."],
    "§9")
add("pic.frameFor", "frameFor(cam, chords)",
    "The camera step's entry: publishes the view for this camera, then asks for the preview's and the incoming quantum's plates.",
    ["`_frame(cam, chords, 0)` maps the camera and publishes; then `_askPreview` when a preview is live (first, prio 0) and `_askQuantum` during a hold. `chords` is the renderer's visible chord estimate and decides the sync path only. The only public method that maps a camera (FC3)."],
    "§9")
add("pic._frame", "_frame(cam, chords, stage)",
    "The one mapping of camera to view: picks the quantum and mode, takes the plate range, snaps `d` once and publishes.",
    ["`stage` 0 is a camera step: with nothing moved and a settled view standing it returns at once, and a move runs `_onMove`. It then takes sync (`_syncSwitch`, ending any hold) or plates: `quantumFor` with hysteresis, `_onQuantumChange` on a crossing, `_aimPreview` on a frame crossing, and the HELD quantum published while a hold lasts. Stages 1, 3 and 5 fill the settle's, the incoming quantum's and the preview's request from the camera and publish nothing; 2 publishes the settle (`q \"e\"`, `Zq = Z`, `s = 1`); 4 publishes `_pend`'s quantum without re-deriving it (D183).",
     "During a hold the published range is the held range clipped to the screen. A stretch above `S_MAX_HOLD` (2) or below `S_MIN_HOLD` (0.5), or a clip that leaves nothing, ends the hold and publishes the live quantum. `_rFull` keeps the unclipped screen range for the stand-ins, the coverage count and the carry.",
     "`d = round(pan·dpr + o·s)` with `o` the range's grid origin, so `(p·Zq − o)·s + d` equals `p·Z + pan`. The view is rewritten and `rev` bumped only when a field changed; the layer is marked dirty only when the plate set, `o`, dpr or size moved, never for `d` alone. Every move re-arms the settle timer."],
    "§9")
add("pic._maybeArm", "_maybeArm(mode, s)",
    "Re-arms the settle timer after a camera step that leaves a stretched plate view, clearing any earlier one.",
    ["Arms only in `\"plates\"` mode with `s ≠ 1`, a store and no hold: a held view is stretched by definition, and a settle beside it would pin a third screenful against the phone's cap (D179)."],
    "§9")
add("pic._moved", "_moved(cam, frameId)",
    "Did the frame, zoom, pan or canvas size change since the last camera step? Records the new values.",
    ["-"], "§9")
add("pic._onMove", "_onMove()",
    "On a camera move, drops the settled `\"e\"` plates first and resets the settle state.",
    ["`dropQuantum(\"e\")` then `unpinAdded()` when anything was settled: the `\"e\"` key carries no zoom, so a settled plate left in the cache would be a hit at a zoom it was not rastered for (D83). A published settle also empties the hit list, whose bitmaps that drop closed."],
    "§9")
add("pic._syncSwitch", "_syncSwitch(chords)",
    "Decides whether this frame takes the synchronous main-thread path, with hysteresis on the chord estimate and a measured exit.",
    ["Enters below `SYNC_CHORD_BUDGET` (5,000) chords and stays up to twice that; no estimate means the plate path. A sync frame whose measured core cost is over `SYNC_MAX_MS` (8 ms) leaves the path, which is re-entered only once the estimate is under half the chords it was slow at (D272)."],
    "§9")
add("pic.noteSyncCost", "noteSyncCost(ms)",
    "Records the renderer's measured core cost of the last sync frame, which `_syncSwitch` reads.", ["-"], "§9")
add("pic.compose", "compose(plates)",
    "Paints the screen from the cached view and hits: the carried last picture or paper, then the stand-ins, the view's own plates and the drag plane.",
    ["Takes no camera (FC3). Optionally replaces the hit list, works out the screen in view-plate units and, outside sync mode, plans the stand-ins (`_planFallbacks`). Where this view's range is short and the plates and stand-ins leave screen cells bare, the last picture is re-mapped under everything (`_drawCarry`); otherwise the canvas is filled with paper. Then `_drawFallbacks`; then at `s = 1` each usable hit 1:1 at `i·512 − o + d` (an empty plate painted as paper when something older lies beneath, a cell a mid-drag plane's BELOW draws whole skipped), or between quanta the layer canvas, recomposed when dirty, of which only the published range's sub-rectangle is blitted, scaled by `s`. The drag plane goes last.",
     "Sets `covered` (every cell of the published range has its plate) and `screenCovered` (every on-screen cell shows ink, stand-ins and carry counted); the second counts paper on screen (`paperComposes`, `paperCellsMax`). Ends with `_keepCarry`. Returns the `drawImage` count."],
    "§9")
add("pic._rangeCovered", "_rangeCovered(v)",
    "Does every cell of the published range hold a drawable plate of the view's own, ink or empty?", ["-"], "§9")
add("pic._carryXf", "_carryXf(v)",
    "The affine that re-maps the carried picture's device px into this view's, `X' = X·sc + o`, or null.",
    ["Crosses frames through `_mapFrame`. Null when either view has no scale, the frames have no path, or the scale is past 2^16 either way (`CARRY_MAX_SC`, the stand-ins' own window)."],
    "§9")
add("pic._drawCarry", "_drawCarry(ctx, c, v)",
    "Re-maps the last picture, still on the ink canvas, to this view with paper outside it; false when nothing carries over.",
    ["Maps the carried ink boxes into this view's plate units (`_cyB`) for the coverage count. Unless the affine is the identity, draws the canvas onto itself through it with composite `copy`, then paints paper around the mapped rectangle. The rects the drag plane drew into the last picture are painted paper, since those pixels are not the document's.",
     "The ink canvas is the only copy of the last picture; no bitmap is kept for it (PAPER-PLAN §10.13)."],
    "§9")
add("pic._keepCarry", "_keepCarry(v, c)",
    "Records what this compose leaves on the canvas for the next one to carry: its view and the device-px boxes that hold ink.",
    ["The whole canvas when no cell was left as paper and no drag plane drew; otherwise each covered screen cell (up to `SCREEN_CELLS_MAX` cells) except those the plane drew into, whose rects are kept as `dirty`. No boxes, no carry."],
    "§9")
add("pic.dropCarry", "dropCarry()",
    "Forgets the carried picture, for a load or a reset where the canvas shows another document.",
    ["`KobinEngine` calls it through `RasterRenderer.dropCarry` on a `reset` event; counted in `carryDropped`."],
    "§9")
add("pic._planFallbacks", "_planFallbacks(v)",
    "Plans this compose's stand-ins, drawing nothing: which cached plates of other quanta or frames to stretch, and where.",
    ["In `\"plates\"` or `\"settle\"` mode only, and costs nothing when the published range is the whole screen and has its plates. Otherwise asks `PlateStore.fallbackCover` for the full screen range, keeps usable bitmaps and empty cover plates, maps each corner into the view frame (through `_mapFrame` for another frame), and records its box in view-plate units (`_fbB`) and its position and stretch `Zq_view / Zq_plate` (`_fbD`). Past four, `_fbBudget` cuts them. Returns the number planned.",
     "A settled view can be short of its own plates after a release or an eviction, so it takes numeric-quantum stand-ins too; the `\"e\"` plates never stand in (D83)."],
    "§9")
add("pic._fbBudget", "_fbBudget(v, n)",
    "Cuts the planned stand-ins to those that show and to the compose's image budget; returns how many are kept.",
    ["Drops stand-ins off the screen or touching no on-screen cell that lacks a plate of the view's own (`fallbackCulled`). When the bitmaps left exceed the budget, `COMPOSE_IMAGES` (30) less the carry, the view's plate bitmaps or its layer, and the drag plane's cells (never below four), it keeps first a greedy cover (the stand-in covering the most needy cells whole, ties to the nearest zoom), then the rest by nearest zoom and larger on-screen part, and drops the surplus (`fallbackOverBudget`). An empty plate costs no image. Kept entries stay coarse to fine; skipped when the screen range is over `SCREEN_CELLS_MAX` cells.",
     "Measured in Kobin's Chrome (2026-09-23): up to 33 distinct images a frame, any of them scaled, drew in ~2 ms and 34 in ~100 ms; a 90-tick zoom-out at 48 stand-ins a compose took 42 s."],
    "§9")
add("pic._fbCovers", "_fbCovers(k, need, W, mark)",
    "Counts the needy screen cells whose on-screen part stand-in `k`'s box contains whole; with `mark`, marks them covered.",
    ["-"], "§9")
add("pic._drawFallbacks", "_drawFallbacks(ctx, v)",
    "Draws the planned stand-ins, coarsest first and stretched, under the view's own plates; returns how many it drew.",
    ["Empty cover plates draw nothing. Counts the worst stretch drawn (`fallbackMaxR`) and the stand-ins from another frame (`crossFrameBlits`)."],
    "§9")
add("pic.settleComing", "settleComing()",
    "Is a settled view on its way: the settle timer armed, or its plates asked for?",
    ["`RasterRenderer` waits on it before aiming the drag plane, which is built at the view's quantum and zoom."],
    "§9")
add("pic.holding", "holding()",
    "Is a zoom holding the last quantum's plates right now?",
    ["`RasterRenderer` does not aim the drag plane during a hold, and frees the plane's plates, since the hold pins its own two sets."],
    "§9")
add("pic._planeBelow", "_planeBelow(v)",
    "The plane cells a whole mid-drag plane's BELOW layer draws, with the view-to-plane cell ratio, or null.",
    ["Returned as `{cells, d}`: view cell (i, j) lies in plane cell (⌊i/d⌋, ⌊j/d⌋). Only while dragging with a level that is not partial, in the view's frame and in plates or settle mode, and only when the plane is at the view's `Zq` or a whole number of octaves coarser. `compose` does not draw the view's own plates under those cells at `s = 1`, which keeps a plane and the screen's plates inside the image budget."],
    "§9")
add("pic.setPlane", "setPlane(p)",
    "Sets the drag plane the compose draws over the picture, or clears it with null.", ["-"], "§9")
add("pic.cellFresh", "cellFresh(v, i, j)",
    "Does view cell (i, j) hold a live plate of the view's own frame and quantum at the key's current epoch?",
    ["A stale plate is not fresh. A landing drag plane stays drawn over every cell that is not fresh, and `RasterRenderer` reads the same test to decide when a landing is over."],
    "§9")
add("pic._composePlane", "_composePlane(ctx, v)",
    "Draws the drag plane last: the drawn level's layers in paint order, the selection's shifted by the drag offset.",
    ["Only for a showing plane in the view's frame, in plates or settle mode. The level is the plane's current one (`cur`), else its stopgap, scaled to the view by `Zq_view / Zq_plane`. BELOW is drawn in place (an empty plate filled with paper), each SEL run offset by the pointer displacement and each OVER run in place, so the moved ink passes under what is above it; a partial level draws its SEL runs alone. A stopgap's layers carry their own bitmaps; the others are read from the store under the layer's tag.",
     "While the plane lands, all of it is clipped to the landing cells whose own plate is not yet fresh. Every rect it draws is recorded, so `_keepCarry` does not carry the plane's pixels. Returns the `drawImage` count."],
    "§9")
add("pic._emptyCover", "_emptyCover(p, v)",
    "Can this empty plate (no ink, 0 bytes) of another quantum or frame count as cover for the view?",
    ["It needs a finite quantum and a usable `Zq`, and must be in the view's frame or one `_mapFrame` can map. It covers its box and draws nothing."],
    "§9")
add("pic._screenCoverOf", "_screenCoverOf(v, withCarry)",
    "Counts the screen cells a compose leaves with no ink, and answers whether there are none.",
    ["Walks every cell of the unclipped screen range through `_cellCovered`, the carried picture counted when `withCarry`, and stores the count in `_uncovered`. Over `SCREEN_CELLS_MAX` (4,096) cells it declines (`coverRefused`) and reports every cell uncovered. `compose` asks once without the carry, to decide whether to carry, and once after drawing."],
    "§9")
add("pic._cellCovered", "_cellCovered(i, j, v, withCarry)",
    "Is screen cell (i, j) showing ink: its own plate, a stand-in or, with `withCarry`, the carried picture covering its on-screen part whole?",
    ["Only the part of the cell inside the screen needs cover, and a cell wholly off screen counts as covered. A carried box is compared with a looser tolerance (1e-6) because it has been through two affines."],
    "§9")
add("pic._mapFrame", "_mapFrame(G)",
    "Frame `G`'s similarity into the view's frame, `{a, bx, by}` with `p_F = p_G·a + b`, or null where the lattice has no path.",
    ["Built from `lm.frameFactor` and `lm.mapPointF` of the origin, memoised until the view's frame or the lattice's `addrEpoch` changes (a subtree move re-addresses frames). The stand-in planning, `PlateStore.fallbackCover` and the carry use it to bring another frame's pixels in."],
    "§9")
add("pic.uncoveredCells", "uncoveredCells()",
    "Screen cells the last compose left as paper; 0 when the screen was covered.",
    ["Read by the diagnostic report's `raster.layer` section."], "§15")
add("pic._isStale", "_isStale(p)",
    "Is this plate's ink behind the document? The store's epoch for its key has moved past the plate's.", ["-"], "§9")
add("pic._rangeCount", "_rangeCount(v)",
    "The number of plate cells in the published range; 0 for an empty range.", ["-"], "§9")
add("pic._recomposeLayer", "_recomposeLayer(L, v)",
    "Redraws the layer canvas: cleared to transparent, then each usable hit 1:1 at `i·512 − o`, an empty plate as paper.",
    ["Returns the plates counted inside the published range, which `covered`, and so the hold, is read from. A plate that would fall outside the layer is skipped and counted in `layerOverflow` (D158). Cleared rather than filled, so a cell with no plate shows what the ink canvas holds beneath (a stand-in or the carry), while an empty plate paints paper over it."],
    "§9")
add("pic._inRange", "_inRange(p, v)",
    "Is this plate inside the published range? Only those count toward `covered`.", ["-"], "§9")
add("pic._drawable", "_drawable(p, v)",
    "What the view can do with a plate: 0 unusable, 1 blit 1:1, 2 empty cover, 3 stand-in to stretch.",
    ["0 for a removed (`dead`) entry, raw pixels, or another frame no affine reaches; 2 for an empty plate at the view's `Zq`; 3 for a bitmap at another `Zq` or frame with a finite quantum. `\"e\"` and `\"s\"` cannot be 3: their quantum is not finite (D83). It counts nothing, so the stand-in planning can call it as often as it needs."],
    "§9")
add("pic._usable", "_usable(p, v)",
    "`_drawable` plus the report's counters: a stand-in or unusable plate in the hit list is counted as a zoom mismatch.",
    ["Also counts `deadRefused` and `noBitmap`. The hit loops call this; the stand-in planning calls `_drawable`, because a cross-quantum entry among the hits is a fault while among the stand-ins it is expected."],
    "§9")
add("pic.plateDestRect", "plateDestRect(view, i, j, out)",
    "Plate (i, j)'s destination on the ink canvas as an integer, half-open device-px rect, written into `out`.",
    ["The smallest integer box containing the possibly fractional destination, in `OverlayBuffer.dirty`'s shape (FC4); returns the rect count, 1. Nothing outside the suites calls it."],
    "§9")
add("pic.onPlate", "onPlate(rec)",
    "One rastered plate arrives: cached, composed if it changes the screen, re-posted if stale and still wanted.",
    ["Runs `_take` then `_flush`. A job of several plates goes through `onPlateBatch` instead, so it composes once. Returns the store's `\"cached\"` or `\"stale\"`."],
    "§9")
add("pic.onPlateBatch", "onPlateBatch(recs)",
    "One job's plates arrive: each is taken in, then one re-post call and one compose serve the whole job.",
    ["A compose is a full paper fill plus a blit per plate, so composing per plate cost a screenful of blits for every plate of the job (D173). `RasterRenderer` hands each job's records here. Returns each record's status in order."],
    "§9")
add("pic._take", "_take(rec, b)",
    "One arrived record: stores it, logs it if stale, and routes it to the settle, the incoming quantum, the preview or the hit list.",
    ["A `q \"s\"` record is refused before the store sees it and its bitmap closed: the sync path is composed, never cached (D159). Otherwise `store.put`: a stale result is logged, and queued for a re-post with the request it belongs to when still wanted. A settle or incoming-quantum plate may complete its set and publish at once (`_settleArrived`, `_quantumArrived`). A preview plate, or one at another numeric quantum, only asks for a compose; a wanted plate of the view joins the hits.",
     "The compose and the re-posts are accumulated in `b` for `_flush`."],
    "§9")
add("pic._flush", "_flush(b)",
    "Sends the batch's pending re-posts, then makes its one compose if any arrival asked for one.", ["-"], "§9")
add("pic._addMiss", "_addMiss(b, req, m)",
    "Adds a plate to the batch's re-post list, flushing first when the list belongs to a different request.",
    ["One call never mixes two requests: a re-post naming the wrong request would raster the plate at the wrong zoom (D160)."],
    "§9")
add("pic._flushMisses", "_flushMisses(b)",
    "Hands the batch's re-posts to `onRepost` with their request, counting plates in `reposts`.", ["-"], "§9")
add("pic._reqFor", "_reqFor(rec)",
    "The request an arrived record belongs to: the settle's, the incoming quantum's, the preview's, or the published view.",
    ["Matched by `q` against whichever of those is live, in that order."], "§9")
add("pic._wanted", "_wanted(rec)",
    "Is this record still wanted: the same frame and quantum as its request, and inside that request's range?", ["-"], "§9")
add("pic.staleLog", "staleLog()",
    "The last eight stale or refused arrivals, each with its key, reason, epoch and time.", ["-"], "§15")
add("pic._noteStale", "_noteStale(key, rec, why)",
    "Writes one stale arrival into the eight-entry ring `staleLog` returns.",
    ["`why` is `\"epoch\"` (still wanted, re-posted), `\"unwanted\"` or `\"sync\"`."], "§15")
add("pic._clear", "_clear()",
    "Cancels the settle timer if one is armed.", ["-"], "§9")
add("pic._settleNow", "_settleNow()",
    "The settle timer fired (`SETTLE_MS`, 150 ms still): asks for the screen's plates at the exact zoom, keyed `\"e\"`.",
    ["Declines without a camera or store, outside a stretched plate view, or during a hold (D179). Marks the settle pending and runs `_askSettle`. The published view does not change until the whole settled screenful is cached: one compose has one `s`, and a half-settled screen would show paper."],
    "§9")
add("pic._askSettle", "_askSettle()",
    "Fills the settle's request from the camera and asks the store, pinned in its added set; publishes if all are cached, else hands out the misses.",
    ["The misses go out with the settle's own request, never the published view, which is still the quantum's (D154)."],
    "§9")
add("pic._settleArrived", "_settleArrived()",
    "A settled plate arrived: publishes the settle once every plate of its screenful is cached.",
    ["Returns true when it published."], "§9")
add("pic._publishSettle", "_publishSettle(hits)",
    "Publishes the settled view (`q \"e\"`, exact zoom, `s = 1`) and composes it.",
    ["`_frame`'s stage 2. The settled view stands until the next camera move, where `_onMove` drops its plates."],
    "§9")
add("pic._onQuantumChange", "_onQuantumChange(qf, frameId)",
    "The zoom crossed a quantum: holds the published picture and makes the new quantum the pending request.",
    ["A pending quantum not yet complete is abandoned (`abandonQuantum`: its stragglers refused, its cached plates kept as stand-ins). On a zoom out the preview is aimed `PREVIEW_QUANTA` (8) quanta coarser, or 12 when zoom-out crossings come under 150 ms apart, unless a live preview in this frame is already two or more quanta ahead. With nothing composed there is nothing to hold, and the new quantum is published at once (`holdSkips`).",
     "Otherwise the published view becomes the hold, and a return to the held quantum ends it. The pending request's range is filled by `_frame`'s stage 3."],
    "§9")
add("pic._aimPreview", "_aimPreview(qLive, frameId, dq)",
    "Aims the one preview request `dq` quanta below the live quantum in this frame; `_frame`'s stage 5 fills its range.",
    ["Called on a zoom-out crossing and on a frame crossing. The preview's plates are never pinned and never join the hits: they are stand-ins for the fallback planning."],
    "§9")
add("pic._askPreview", "_askPreview(cam)",
    "Asks the store for the preview's plates, unpinned, and hands the misses out at prio 0; ends the preview once all are cached.",
    ["Runs each camera step before the incoming quantum's ask. Its cached plates stay as stand-ins after it ends."],
    "§9")
add("pic._askQuantum", "_askQuantum(cam)",
    "During a hold, asks the store for the incoming quantum's plates in the added pin set; switches if all are cached, else hands out the misses.",
    ["Once a camera step, from `frameFor`. The added set is rebuilt from this range on each ask, so a pan during a hold pins only the current screenful (D184)."],
    "§9")
add("pic._quantumArrived", "_quantumArrived()",
    "A plate of the incoming quantum arrived: switches to it once its whole visible set is cached.", ["-"], "§9")
add("pic._switchQuantum", "_switchQuantum(cam)",
    "Publishes the incoming quantum and composes it in one step, ending the hold.",
    ["Declines when the stretch it would publish, from the camera as it is now, is below `S_MIN` (0.8781) or above `S_MAX_HOLD` (D188); the hold and the request then stand for the next step. Otherwise it ends the preview and the hold (`unpinAdded`), re-wants the incoming range as the visible pin set, publishes through `_frame`'s stage 4 (the pending quantum, never re-derived, D183), composes and re-arms the settle."],
    "§9")
add("pic._endHold", "_endHold(why)",
    "Ends a hold: clears it, records why, empties the store's added pin set and clears the pending flag.",
    ["The pending quantum is abandoned (its in-flight plates refused) only for `\"return\"` and `\"release\"`. No cached plate is dropped: the held quantum's plates stay valid and serve as stand-ins."],
    "§9")
add("pic._setHits", "_setHits(list)",
    "Copies the caller's hit list into the reused array and clears the surplus slots; a changed set marks the layer dirty.",
    ["Clearing the slots past the end keeps no reference to a dropped plate's bitmap."], "§9")
add("pic._addHit", "_addHit(e)",
    "Puts one arrived store entry into the hit list, replacing the entry with its key or appending.", ["-"], "§9")
add("pic._ensureLayer", "_ensureLayer()",
    "Allocates the layer canvas on first use, sized for the worst-case plate grid between quanta.",
    ["`(floor(W / (512·S_MIN)) + 2) × 512` each way, so a range a column or row larger than at the quantum still fits (D158) and a pan never reallocates. Its context has alpha, so a cell with no plate is transparent. Dropped by a resize, a store release and `destroy`."],
    "§9")
add("pic._dropLayer", "_dropLayer()",
    "Frees the layer canvas and its context and marks the layer dirty.", ["-"], "§9")
add("pic.report", "report()",
    "Flat scalars for the diagnostic report's `raster` section: the view, coverage, settle and hold state, and every `pictureStats` counter.",
    ["`covered` is the published range's cells and `screenCovered` the whole screen with stand-ins counted; they differ when a held view leaves a ring of paper. Scalars only, so the report stays bounded (F58)."],
    "§15")

# ---- src/engine/raster/PlateStore.js ----
add("pls.isPhoneBudget", "isPhoneBudget(env)",
    "Does this device get the phone cache budget: 4 GB of memory or less, or a screen under 1,200 px on its longer side?",
    ["`env` overrides `navigator` and `window.screen` for a test. A budget, not a capability test; it is on the perf record so a phone report reads against a desktop one."],
    "§9")
add("pls.defaultCacheBytes", "defaultCacheBytes(env)",
    "The device's byte cap: 56 MiB (56 plates) on the phone budget, 96 MiB (96 plates) otherwise.", ["-"], "§9")
add("pls.ascending", "ascending(ids)",
    "Is a plate's painted-id set strictly ascending? `put` sorts one that is not, since the drop rules binary-search it.",
    ["-"], "§9")
add("pls.anyId", "anyId(ids, want)",
    "Does a plate's sorted painted-id set hold any id of a `Set`? Walks whichever of the two is shorter.", ["-"], "§9")
add("pls.holdsId", "holdsId(ids, id)",
    "Binary search: is `id` in a plate's sorted painted-id set?", ["-"], "§9")
add("pls.boxOf", "boxOf(i0, i1, j0, j1, Zq, pad)",
    "A plate range's box in its frame's own units, grown by `pad` device px; null when `Zq` is unusable.", ["-"], "§9")
add("pls.rectOf", "rectOf(p)",
    "One plate's box in frame units, grown by one device pixel (`EDGE_PAD_PX`).", ["-"], "§9")
add("pls.meets", "meets(r, b)",
    "Does a plate's box meet a footprint rect? Touching counts, and a plate with no box always meets.",
    ["Conservative by design: a plate whose `Zq` is unusable is dropped rather than kept stale."], "§9")
add("pls.closeOf", "closeOf(holder, s)",
    "Closes a record's `ImageBitmap`, if it has one, and counts the close.", ["-"], "§9")
add("pls.PlateStore", "PlateStore",
    "The plate cache: keyed by frame, quantum and cell, LRU under a byte cap, with invalidation that keeps the old pixels as stale hits.",
    ["Holds the cache, a per-key epoch map, the in-flight map and the protected sets. Never evicted: the visible pins (`want`'s replace), the added pins (the settle's or the incoming quantum's), the drag plane's pins and the base (the zoom-out ladder's first rung). Evicted last: the rest of the ladder. An invalidating drop bumps the key's epoch and keeps the record; a record is stale when its epoch is behind (D25), and a result posted before a change is refused at `put` for the same reason.",
     "Only `_remove` closes a bitmap, and it marks the entry `dead` first so a compose still holding it draws nothing. It holds no camera, document or lattice: `KobinEngine` maps each document event into rects in a frame's own units and hands them here."],
    "§9")
add("pls.PlateStore.constructor", "PlateStore.constructor(opts)",
    "Sets the byte cap (the device budget unless given), the empty maps and protected sets, the counters and the `visibilitychange` listener.",
    ["The listener calls `release(\"hidden\")` when the tab is hidden and `onShow` when it is shown again. `RasterRenderer` sets both callbacks: `onRelease` drops the picture layer's canvas, and `onShow` has the engine re-render and rebuild what the release took."],
    "§9")
add("pls.want", "want(view, opts)",
    "The plates a view's range wants: cached ones as hits, uncached ones not in flight as misses, with the range pinned.",
    ["Walks the range's cells: a cached plate is touched in the LRU and returned as a hit; a stale one is also returned as a miss carrying the bumped epoch, so the old ink stays on screen while the re-post goes out; a key in flight is counted and never made a second miss. Then evicts to the cap.",
     "`opts.pin`: `\"replace\"` (the default) rebuilds the visible pin set from this range, `\"add\"` rebuilds the separate added set so neither evicts the other (D178, D184), `\"none\"` pins nothing (the preview). A second `\"add\"` caller with a different `mode` over a live added set is counted in `addCallerMismatch`, not refused."],
    "§9")
add("pls.unpinAdded", "unpinAdded()",
    "Empties the added pin set; returns the number of keys unpinned.",
    ["`PictureLayer` calls it at every end of a hold and after the settle's own drop. Nothing else empties the set."],
    "§9")
add("pls.markLadder", "markLadder(keys, fresh)",
    "Marks keys as the zoom-out ladder's, evicted last; `fresh` starts a new ladder and makes these keys its base, which is never evicted.",
    ["The base is the first rung, the screen zoomed out 4×: the cover a pan or a short zoom-out always has under the carried picture (PAPER-PLAN §10.13). `RasterRenderer` marks each rung's keys, cached or still to come."],
    "§9")
add("pls.setPlanePins", "setPlanePins(keys)",
    "Pins the drag plane's plate keys against eviction, or releases them with null.", ["-"], "§9")
add("pls.fallbackCover", "fallbackCover(req, out, mapFrame)",
    "The cached plates of other quanta or frames that can stand in for a view's range, coarsest first, written into `out`.",
    ["Scans the whole cache for a live bitmap or an empty (0-byte) plate with a numeric quantum and usable `Zq` whose box, mapped into the view's frame by `mapFrame` when it is another frame's, meets the range, and whose effective quantum is from 64 coarser to 8 finer than the view's (`FB_Q_LO`, `FB_Q_HI`). The view's own quantum is a hit, not a stand-in, and is skipped. Sorts by effective quantum, then row, then column, and keeps the first `FB_MAX` (48), so the cap costs sharpness, not coverage.",
     "`req` is the full screen range, not the held one. It touches no pin and no LRU, so a stand-in stays early to evict. A non-numeric `q` (the settle's `\"e\"`, a drag plane's tags) never stands in: it has no zoom (D83). Returns the count written; its scratch arrays are reused, so a per-frame caller allocates nothing."],
    "§9")
add("pls.get", "get(key)",
    "One cached record by key, or undefined; does not touch the LRU.", ["-"], "§9")
add("pls.size", "size()", "The number of plates cached.", ["-"], "§9")
add("pls.plateBytes", "plateBytes()",
    "The bytes the cache counts itself as holding, stale plates included.",
    ["No browser API reports what a bitmap costs, so this count is what the cap is measured against."], "§9")
add("pls.put", "put(rec)",
    "A rastered plate arrives: refused if its epoch is behind, else cached (replacing and closing any older record) and the cache evicted to its cap.",
    ["Ends the key's in-flight record first. A result with no `epoch` is cached anyway and counted in `noEpoch`; an id set out of order is sorted and counted in `badIds` (D84). A refused result has its bitmap closed and the caller re-posts. A key in the base or the ladder stays there across the replace. Returns `\"cached\"` or `\"stale\"`."],
    "§9")
add("pls.epochOf", "epochOf(key)",
    "The epoch a job must carry for this key; 0 for a key never invalidated.", ["-"], "§9")
add("pls.isCurrent", "isCurrent(key, epoch)",
    "Is this epoch still the key's current one?",
    ["Only the suites call it; `RasterRenderer` compares `epochOf` itself before dispatch."], "§9")
add("pls.beginJob", "beginJob(jobId, view, plates)",
    "Records a job's plates as in flight and returns their current epochs in the job's plate order.",
    ["The epochs travel with the job and come back on each result, which `put` judges them by (D25)."], "§9")
add("pls.endJob", "endJob(jobId)",
    "A job came back, failed or was abandoned: removes its keys from the in-flight map where this job still owns them.",
    ["A key re-posted under a later job is left alone. Returns the keys removed."], "§9")
add("pls.staleInFlight", "staleInFlight()",
    "The number of in-flight plates whose epoch is already behind.", ["-"], "§15")
add("pls.dropById", "dropById(id)",
    "Rule 1: stales every cached plate whose painted-id set holds the id, or any id of a `Set`.",
    ["One walk of the cache for a whole set of moved ids. A plate with no id set cannot be tested and is staled too (`noIds`). The pixels stay until replaced (`_drop`)."],
    "§9")
add("pls.dropRectPerFrame", "dropRectPerFrame(foot)",
    "Rules 2 and 3: stales every cached plate, in any frame, whose box meets the rects `foot(frameId)` returns for its frame, and bumps matching plates in flight.",
    ["`foot` is called once per frame and memoised; it returns the object's drawn box (stroke width included) at the old and new addresses. The in-flight bump is the only rule that reaches a plate posted before the change."],
    "§9")
add("pls.dropQuantum", "dropQuantum(q)",
    "Removes every cached plate at one quantum outright, unpins them, and bumps the epochs of that quantum's plates in flight.",
    ["A hard remove, not a stale drop: a settled `\"e\"` plate carries no zoom and must never survive as a stale hit or a stand-in (D83). `PictureLayer` calls it for `\"e\"` on every camera move, `RasterRenderer` for a drag plane's tags."],
    "§9")
add("pls.abandonQuantum", "abandonQuantum(q)",
    "A quantum the camera moved past: unpins its cached plates, keeping them as stand-ins, and bumps its in-flight plates so they are refused.",
    ["The document did not change, so the cached plates are not staled: that is the difference from `dropQuantum`. Returns the keys touched."],
    "§9")
add("pls.dropAll", "dropAll(keepStandIns)",
    "Rule 4: removes every cached plate except the drag plane's and the base's, bumps every epoch cached or in flight, and empties both pin sets.",
    ["The kept plates stay, staled: the moved picture's own, and the last cover a zoom-out or a pan has. With `keepStandIns` false (a `reset`: another document) the plane and base sets are emptied first and nothing stays. No other stale pixels are kept: after a frame event a `frameId` may name another place, so a kept plate could be ink in the wrong place. Called by `onDocEvent`, `release` and `destroy`."],
    "§9")
add("pls.dropFrames", "dropFrames(pred)",
    "Removes the cached plates of every frame `pred` names (bar the drag plane's), unpinning them and bumping those in flight.",
    ["`KobinEngine` calls it for a subtree move (`_releaseMove`), a refile (`_refilePlates`: the frame and those under it) and a merged-away frame, and stales the footprints elsewhere with `dropRectPerFrame`, so the rest of the screen, stand-ins and ladder included, is kept. A base plate of a named frame goes too."],
    "§9")
add("pls.release", "release(reason)",
    "Frees the cache except the base, drag plane included, and tells the picture layer through `onRelease`.",
    ["The base (the ladder's first rung) is kept, staled, as cover for when the tab is shown again. Installed on `visibilitychange` so a hidden tab frees its other bitmaps; public for the engine and the suites."],
    "§9")
add("pls.onDocEvent", "onDocEvent(ev, foot)",
    "Maps one drained document event to the drop rules.",
    ["A `reset` drops everything, stand-ins included (`dropAll(false)`); a frame event (`refile`, `addFrame`, `removeFrame`, `mergeFrame`, `splitFrame`) drops everything but the drag plane's and the base's plates; a live stroke's `add` is ignored, since the live stroke is drawn as SVG; an event with no object that is not a `remove` does nothing; otherwise `dropById` for the event's id plus `dropRectPerFrame(foot)`.",
     "`KobinEngine._drainPlates` calls it at the top of a render, never where the event arrives (`Document.at` settles a moved frame inside `_buildList`). The engine narrows a refile, a frame merge or split and most frame adds and removes itself with `dropFrames` and `dropRectPerFrame`, so the frame branch here is the fallback; a bake step under its mark (F90) is counted in `neutralEvents` and never reaches it."],
    "§9")
add("pls.noteDrain", "noteDrain(n)",
    "Counts one render's drain and the events it handled, for the report.", ["-"], "§15")
add("pls.noteDpr", "noteDpr(dpr)",
    "Records a dpr change; every plate stays valid because dpr is not in the key (D27).", ["-"], "§9")
add("pls.report", "report()",
    "Flat scalars for the diagnostic report: plate count and bytes, the cap, pin, base and in-flight sizes, stale plates and bytes, and every counter.",
    ["-"], "§15")
add("pls.destroy", "destroy()",
    "Drops the cache, removes the `visibilitychange` listener and clears the in-flight, job and epoch maps.",
    ["`dropAll(false)`: the drag plane's and the base's plates go too, every bitmap closed."],
    "§9")
add("pls._evict", "_evict()",
    "Evicts to the byte cap: stale plates first, then by LRU, the ladder's last; never a pinned, drag-plane or base plate.",
    ["The visible, added, drag-plane and base sets are never evicted, and a stale plate on screen is in the visible set. An eviction is not an invalidation: the epoch is not bumped, so a result in flight for that key is still cached. Still over the cap with everything else gone is counted in `overCapPinned`."],
    "§9")
add("pls._remove", "_remove(key)",
    "Takes a plate out of the cache and closes its bitmap: the only path that closes one.",
    ["Marks the entry `dead` before closing, because `PictureLayer` holds entries between composes and `drawImage` on a closed `ImageBitmap` throws in Chrome. Also takes it off the ladder and the base and out of the byte count."],
    "§9")
add("pls._drop", "_drop(key)",
    "An invalidating drop: bumps the key's epoch and keeps the pixels as a stale hit.",
    ["The bytes stay counted: a stale plate is real memory inside the cap. `put`'s replace or an eviction frees it."], "§9")
add("pls._isStale", "_isStale(e)",
    "Is this record's epoch behind its key's? Derived from the epoch map, never stored as a flag (D25).", ["-"], "§9")
add("pls._staleBytes", "_staleBytes()",
    "Counts the stale records and the bytes they hold, for the report.", ["-"], "§15")
add("pls._bump", "_bump(key)",
    "Moves a key's epoch on, cached or not, and prunes the map past `EPOCH_MAX` (4,096) keys.",
    ["Bumping an uncached key is what refuses a result still in flight (D25)."], "§9")
add("pls._pruneEpochs", "_pruneEpochs()",
    "Forgets the epochs of keys neither cached nor in flight.",
    ["Only a cached record or a job can carry an old epoch, so no other key needs one."], "§9")
add("pls._endKey", "_endKey(key, jobId)",
    "A result arrived: removes its key from the in-flight map and from its job's key list, deleting the job when empty.",
    ["With a `jobId`, only that job's record is removed, so a late result from an earlier job cannot cancel a re-post in flight for the same plate."],
    "§9")

# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = []

# One or two sentences per FILE in the batch: what the file is for in the design.
ROLE = {
    "src/engine/raster/PictureLayer.js":
        "The raster renderer's ink canvas and the one place the camera becomes a mapping: it quantises the "
        "zoom, publishes one stable view, and composes the cached plates onto an opaque canvas: the last "
        "picture re-mapped where nothing newer reaches (else paper), then stand-ins from other quanta and frames "
        "within an image budget, then the view's own plates, stretched between quanta, then the drag plane. "
        "It also runs the settle, the quantum hold and the zoom-out preview; the renderer posts every job it "
        "asks for (DESIGN.md §9).",
    "src/engine/raster/PlateStore.js":
        "The plate cache: 512-device-pixel plates keyed by frame, zoom quantum and cell, LRU under a byte cap "
        "(96 MiB on a desktop, 56 MiB on a phone) with the visible, incoming and drag-plane sets and the "
        "zoom-out ladder's first rung never evicted and the rest of the ladder evicted last. An invalidation bumps a per-key epoch and keeps the old pixels as a stale "
        "hit until the replacement lands, and `fallbackCover` finds the other quanta's and frames' plates that "
        "stand in for a missing one (DESIGN.md §9).",
}
