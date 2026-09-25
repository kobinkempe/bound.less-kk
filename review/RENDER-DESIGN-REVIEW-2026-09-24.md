# Rendering, erasing, moving — design review and recommended design

2026-09-24. A read-only review: `DESIGN.md`, every line of `live-code/live-code-changed.js.txt`,
and `live-code/live-code.js.txt` where context was needed. Nothing in `src/` was changed.

- `cl N` = line N of `live-code/live-code-changed.js.txt`; `lc N` = line N of
  `live-code/live-code.js.txt`. The extract is trimmed (dev-only and SVG-only code removed, see
  `live-code/trims.tsv`), so a few oddities there are trim artifacts (for example
  `CANVAS_COLLECTION = REAL_COLLECTION`).
- **Verified** = the path was traced end to end in the code. **Latent** = verified, but normal UI
  flows rarely reach it. Nothing here was measured in a browser. Per CLAUDE.md, reproduce each bug
  in paint before and after its fix.

Contents: 1 the existing design · 2 bugs · 3 design concerns · 4 recommended design ·
5 the six scenarios, today and recommended · 6 order of work · 7 decisions for Kobin.

---

## 1. The existing design, in plain terms

### 1.1 Storage (unchanged by this review)
Space is nested squares (frames), 4,096× smaller per level. An object is stored in the frame it
was drawn in, in that frame's own coordinates. A move never rewrites coordinates: whole cells
change the object's home frame, and the rest goes into a per-level displacement table. A frame
subtree moves by re-addressing frames. Content from other levels is derived on demand and cached
per cache tile (`TileStore`): ancestors are magnified down one crossing at a time, descendants are
projected up, and moved objects are fetched from the frame their table names.

### 1.2 From document to screen (raster renderer, the default)
1. **The render list.** Each render concatenates the pieces of every cache tile in view, plus the
   frame's own objects. It then decorates each item (family key, eraser flag and depth, move
   remainder `res`) and sorts everything by depth (`listFor`, cl 2786-2829).
2. **Plates.** A plate is a 512 px square of the screen at one of 4 zoom steps per doubling
   (cl 10173-10198). Our JS coverage rasteriser renders it in up to 4 workers (cl 12408-12440).
   A family (one object and its pieces) is filled as one union, with one colour and one opacity.
   Pending eraser marks act as masks. Families under the topmost opaque whole-plate family are
   skipped. Finished plates are cached as bitmaps: 96 MiB on a desktop, 56 on a phone.
3. **Putting plates on screen** (`PictureLayer`, cl 7162-8236). The current step's plates are
   stretched between steps. When a plate is missing, a dozen stand-ins can fill its cell:
   - an out-of-date plate of the same step;
   - plates of other steps or other frames, up to 30 images;
   - the previous screen moved into place (the "carry");
   - a coarse preview 8 steps down;
   - the "hold", which keeps the old step until the new one is complete;
   - the exact-zoom "settle" set, rendered after 150 ms still;
   - the idle "ladder" of zoomed-out plates;
   - prebaked plates for the next frame crossing;
   - a main-thread render for light views (the "sync" path);
   - the drag plane;
   - the held live stroke;
   - the main-thread "stopgap" layer for small drags.
4. **Keeping plates current.** Document events are queued and turned into work at the next render
   (`_drainPlates`, cl 2833-2862). A plate is marked out of date if it lists the changed object's id
   (every plate lists the ids it painted), or if it meets a rectangle mapped into its frame.
   Structural events drop whole frames (cl 2864-2888, 8601-8614). "Out of date" bumps a counter;
   the old bitmap is kept as a stand-in.

### 1.3 Drawing
The live stroke is SVG: a short tail under the pen, frozen chunks of 128 anchors behind it, and
one group carrying the opacity (cl 3764-3822). At pen-up the outline is resolved exactly, in 8 ms
slices (`ArcBakeJob`). The SVG path is kept until the plates under it are fresh (3 s limit,
cl 9118-9186). The plates are rastered twice: once for the band, then for the resolved shape (D-3).

### 1.4 Erasing
- **The mark.** An eraser stroke becomes a mark object on top of the drawing.
- **How plates show it.** An item is masked, meaning its coverage is multiplied by (1 − the mark's),
  when two things hold: its depth is below the mark's current depth, and it is not in the mark's
  "done" set (cl 11763-11815, 10327-10388).
- **The bake.** A background bake takes the objects under the mark, top-down, one at a time. The
  whole engine has one cut in a worker at a time (cl 4421-4459, 4570-4608). After each object the
  mark's depth steps down (cl 4501-4507). Steps that change no pixel are tagged neutral so that no
  plate re-renders (cl 4516-4522, 2672-2689). The mark is deleted when nothing is left under it.
- **Waiting for the bake.** Selecting, dragging and lassoing first finish the cuts they need, on the
  main thread (cl 4825-4930).

### 1.5 Moving
- **Per-object drag.** Every pointer event recomputes each member's table from the drag start and
  writes it into the document (cl 15410-15455).
- **Frame drag.** Frames are re-addressed instead (cl 15457-15485).
- **The drag plane.** The selection slides over pre-rendered layers split by depth (cl 6552-6788,
  8930-9094).
- **The drop.** Plates at the start and at the end are marked out of date (cl 2984-3023). Each cell
  keeps the plane until its fresh plate lands (3 s limit).

### 1.6 Selecting
- **Lasso.** It walks the frame tree out from the camera, and a frame wholly inside the loop becomes
  one entry (cl 15249-15321).
- **Tap.** It hit-tests the render list top-down (cl 15569-15604).
- **Ants.** They are painted by the CPU onto an overlay canvas every 50 ms (cl 9688-10171,
  6789-7161).

---

## 2. Bugs

### B1. Out-of-date pictures stand in for correct ones (Verified; matches the undo-then-zoom report)
- `PlateStore.fallbackCover` never skips out-of-date plates (cl 8389-8429), and
  `PictureLayer._drawable` never checks for them (cl 7956-7967).
- `compose` draws an out-of-date plate of the current step as if it were fresh (cl 7533-7536).
- The carry is the previous screen with no version (cl 7595-7659). It is dropped only on a
  document reset (cl 2674).
- **Scenario:** undo a stroke that the plates already hold. Its plates are marked out of date but
  kept, and they keep drawing the stroke until each one is re-rastered. So do other steps' copies
  and the carry. Zooming switches to other-step plates that still hold the stroke, and it "comes
  back".
- Additions mostly escape this, because the live SVG path is held over the plates. Removals have
  no such cover.
- **Fix:** judge every stand-in by the same freshness rule as the view's own plates, and cover a
  changed area with a fresh patch (§4.2-4.4). A quick partial fix: skip out-of-date plates in
  `fallbackCover` and in the carry.

### B2. A quick undo after a drop can leave a ghost at the drop spot (Verified by trace)
- A table-only change (`setOffsetsById`, lc 4574) carries no old table, so the old footprint has to
  come from `_footBelow`.
- `_drainPlates` empties `_footBelow` whenever it holds more than 1,024 entries (cl 2859). Just
  before each drain, `listFor` re-seeds it with the *current* tables (cl 2799, 2806-2808; order at
  cl 3055-3057).
- So on any view with more than 1,024 list items, the old footprint of a table-only change is
  never computed. The same is true of the remove half of a rehome, whose rectangle is computed
  later with the new table.
- Cached plates are still caught by id (cl 8492-8504). Plates already in a worker are caught only
  by rectangle (cl 8527-8530).
- **Scenario:** drop a selection on a dense drawing, while the drop spot's plates are still in the
  workers (they can take seconds), then undo. Those plates land as fresh, with the objects drawn at
  the drop spot.
- **Fix:** put the old table and old home into the event, or compute the dirty rectangles at the
  moment of the change. Then delete `_footBelow`.

### B3. More than 8 pending marks in one strip hide ink they never touched (Verified)
- `MASKS_MAX = 8` (cl 11031). Marks 8 and up all share mask slot 7 (cl 11769), and slot 7 becomes
  the union of those marks' shapes (cl 10451-10473).
- So an item below mark #9 but above mark #8 is also masked by #8's shape.
- It is reachable during a long bake (20-30 s on the Magnum Opus) if you keep erasing the same area.
- **Fix:** use up to 32 slots; the core's bit mask already allows 32 (cl 10329). If a strip would
  need more, bake the oldest marks first.

### B4. Dragging a selection that holds whole frames first bakes every pending erase (Verified)
- When the selection has frames, `_settleSelectionErases` calls `flushErases()` with no filter
  (cl 4856). That runs synchronously, on the main thread, and includes erases nowhere near the
  selection.
- After a big erase elsewhere, the first drag of a frame selection freezes for that whole bake.
- **Fix:** bake only the marks whose footprints meet the selected frames' extents.

### B5. The drag's pre-bake stops after 200 cuts (Latent)
- `_settleSelectionErases` runs at most 200 rounds, with one real cut per round (cl 4865-4876). A
  selection needing more cuts is dragged with some of its targets still whole.
- Moved away from the mark, a target's hidden part reappears. The mark's later bake no longer
  reaches it, because the candidate test uses the moved position (cl 4485-4493). The erase is lost
  for good.
- Normal flows rarely get here: switching to the eraser deselects (lc 5289), and a lasso bakes its
  marks fully first. A tapped family with more than 200 members under a pending mark does get here.
- **Fix:** no cap. Bake in parallel, with a visible "finishing the erase" state.

### B6. Deleting a big per-object selection is quadratic (Verified; performance)
- For each member, `removeById` does an `indexOf` and a `splice` over its frame's list
  (cl 2223-2225). It also emits a remove event, which makes the tile store scan every cached tile's
  pieces (cl 4046-4053).
- 10,000 objects in one frame cost about 10⁸ list steps plus 10,000 cache scans. The undo
  re-inserts them one `splice` at a time.
- **Fix:** remove in batches per frame, as `rehomeManyById` does, with one batch event and an
  id → tiles index in the tile store.

### Minor
- `PlateStore.want` with `pin: "add"` replaces the previous caller's protected set (cl 8362-8366;
  counted as `addCallerMismatch`). The settle plates and the pending step's plates can then evict
  each other on a phone.
- `_eraseStrokes()` scans every native of every frame (lc 8135-8142), and it runs once per target
  inside `flushErases` (cl 4918-4928). `_settleLassoErases` scans every native on each lasso
  (cl 4896).
- After every in-family cut:
  - `_familyComponents` re-flattens the same outlines for every pair of members (cl 4695-4719;
    `_inkOutline` has no cache, lc 8588);
  - `_familyMembers` scans every native (lc 8593).

---

## 3. Design concerns — why the code is brittle

**C1. A dozen ways to fill a screen cell, each with its own rule for being current.** The list is
in §1.2. Every new kind of change has to be taught to each of them, and B1 is what happens when
one is missed.

**C2. What changed, and where, is reconstructed late and in many places.**
- Events are turned into rectangles at the next render, from the object's state at that later
  moment (cl 2833-2862, 3025-3045). The old state comes from a lossy side table (B2).
- Invalidation has separate paths:
  - ids;
  - rectangles;
  - frame refiles;
  - frame lists;
  - drag holds (events dropped, bulk release);
  - neutral events;
  - list staleness (`_eraseListStale`).

**C3. The picture depends on the bake's progress.**
- Mask membership is "below the mark's current depth and not done". The depth steps down per
  object, the done set changes per cut, cuts in flight are subtracted (`_uncut`), and each render
  list snapshots all of that (F121).
- The bake's ordering rules exist mainly to keep this picture right: in-order versus out-of-order
  barrier bakes, and when the mark may step.

**C4. Main-thread work that grows with the drawing, in hot paths.**
- Every render rebuilds and sorts the whole list, and each new list re-runs the family prepass
  (cl 2786-2829, 11635-11670).
- Every pan or zoom step walks up to the whole list to count chords, and touches the pack cache
  twice per item (cl 9291, 11472-11488, 11419-11434).
- Several paths scan every native: the pending marks, the family members, and the inked frames
  (cl 15171-15178).
- Tile-store removal scans every cached tile (B6).

**C5. Erasing is serial and blocks.**
- The whole engine has one cut in flight at a time (cl 4431, 4597).
- Each cut carries the whole eraser outline (cl 4596).
- Descents are dispatched even when the target has no ink near the eraser: 84 of 98 steps on the
  Magnum Opus (DESIGN §7).
- A bake of about 100 objects takes 20-30 s. Selecting inside that window waits for it on the main
  thread.

**C6. A drag rewrites the document on every pointer event.**
- Every member's table is recomputed and written, per event (cl 15421-15445), even while the drag
  plane is already showing the motion.
- 2,000 members cost 31.6 ms an event (DESIGN §8), so 20,000 would cost roughly 0.3 s.

**C7. The drag plane is expensive exactly when the selection is old.**
- Every unselected family above the lowest selected one, anywhere in view, goes into an "over"
  layer. The "below" layer must then cover all of those cells as well (cl 6637-6720).
- Select an old object in a dense view and the plane renders the view about twice, exceeds its
  40-plate cap, and is coarsened by up to 8× (cl 6666-6672).
- Beyond 5 layers, an unselected run that lies between selected ones is drawn under them
  (cl 6654-6663). This one is documented.

**C8. Render-only fields are written onto document objects.** `listFor` writes `res`, `editId`,
`erase` and `z` onto list items, and a frame's own natives *are* list items (cl 2803-2814).

**C9. The gesture state is spread across many flags.**
- `_drawing`, `_erasing`, `_dragSel`, `_lasso`, `_panLast`, `_holdMove`, `_moving`, `_dropping`,
  `_carried`, `_carriedLater`, `_cutInflight`, `_eraseListStale`, `_renderPending`,
  `_pictureNeutral`, and more.
- Each background task tests its own subset: the bake (cl 4422), scenes (cl 13103-13113), the
  ladder (cl 3135) and frame GC (cl 5018).

**C10. Speculative work competes with needed work.** These all share 4 workers and 96 MiB with the
view and the bake:
- ladder rungs (up to 11 lists at idle after every pause, cl 3125-3207);
- prebakes;
- previews;
- settle sets;
- thumbnails.

**C11. A pen-up rasters its plates twice** (band, then shape; D-3 is open).

**C12. Geometry is copied three times on its way to a worker:**
1. into tile pieces;
2. into the pack cache's flattened copy (cl 11372-11396);
3. into each job's arrays (cl 11779-11828).

---

## 4. Recommended design

### 4.1 Principles
1. A pixel on screen is never older than the document; it may be blurrier.
2. Work is proportional to what changed and what is on screen, never to the whole drawing.
3. Pointer events never wait for background work. The only waits are explicit, short and visible.
4. One rule per concept: one freshness rule, one path from change to pixels, one scheduler.

### 4.2 A change log with version numbers
This replaces the plate counters, `_footBelow`, and the per-kind invalidation paths.
- **The log.** Every document change raises the version and appends an entry. The entry records
  the footprint before and after, captured at the moment of the change: home frame, box grown by
  the pen, and displacement table. A frame change records its cell before and after, plus
  "everything under frame X".
- **Neutral entries.** Changes that alter no pixel (a cut under its own mark, a mark's own
  bookkeeping) are logged as neutral.
- **The rule.** A plate records the version of the list it was painted from. It is **fresh** for a
  region if no non-neutral entry after that version touches the region. One rule covers every
  plate: current step, other steps, other frames, plates in workers, ladder and plane plates.
- **Cost.**
  - An entry is mapped into a frame once, and the result is cached.
  - A big entry (a 20,000-object move) keeps its rectangles in a small grid, so tests stay cheap.
  - Entries older than the oldest cached plate are dropped.
- **Worker results** are accepted if they are fresh on arrival. Jobs in flight need no bookkeeping,
  so B2 cannot happen.

### 4.3 Putting plates on screen: the best fresh source per cell
For each screen cell, use the first of these that exists:
1. a fresh plate at the current step;
2. a fresh plate of another step or frame (finer preferred, coarser up to 8×);
3. an out-of-date plate, with patches over its changed parts (§4.4);
4. paper.

Missing current-step plates are requested nearest the centre first. Around that rule:
- **Hold** becomes a preference inside the choice: while zooming, keep one step on screen until
  the next is complete, within 0.5-2× stretch.
- **Previews, the ladder and prebakes** are just low-priority requests into the same cache.
- **The carry** goes, because it has no version. The sync render saves its result as plates, so it
  stands in like any other plate.
- **Settle** stays as a low-priority request after the camera stops (decision D2).

### 4.4 Recent changes on top of the plates (Kobin's "recent-change layers")
- **Additions stay out of the plates for a while.** The last K added objects (say 16, or the last
  few seconds) are packed out of the plates and drawn as small layers of their own. They are the
  newest objects, so they are topmost and the layers are exact.
  - Undoing or redoing one of them only drops or restores its layer.
  - A pen-up rasters no plate at all, which ends D-3.
  - A translucent stroke is composited exactly once.
  - The layers are re-rendered on a zoom-step change; that is cheap, one object each.
  - An object that ages out is added to the plates in the background, and its layer stays until
    those plates are fresh.
- **Removals and changes to older ink are patched now.** This covers undo, delete, a visible cut,
  and a moved frame.
  - The changed cells are re-rendered at once on the main thread, within a frame budget, using the
    sync renderer restricted to those cells.
  - If they don't fit the budget, the same cells are rendered coarser (blurrier, still correct),
    and the full-size plates are requested at top priority (decision D4).
- **Eraser pen-up.** An eraser mark masks older ink, so it is a change, not a layer. Any recent
  layers older than the mark that lie in its footprint join the plates, and the footprint is
  patched with the mask.
- **Drag.** The drag plane is the recent layer. At the drop it holds per cell until fresh plates
  land, as now.

### 4.5 The render list, tile by tile
- **Tiles hold the work.** Each cache tile keeps its pieces sorted by depth, along with their family
  keys and their chord counts per zoom band. All of it is computed when the tile is built or
  patched.
- **"The list" is only an index.** It is the set of tiles in view plus the frame's own objects.
  - A plate job merges only the tiles over its strip, and forms families per job.
  - Move remainders and eraser flags are looked up for that job's items and kept in the job, not
    written onto objects (C8).
- **Sync or plates** is decided from the per-tile chord counts, so each camera step costs work in
  proportion to the tiles, not the items.
- **Tiles only when needed.** A shrinking window needs no rebuild. A growing window builds its new
  tiles within a per-frame time budget; cells whose tiles aren't ready keep their stand-ins.
- **Tiles of recently left frames** stay in a small cache rather than being dropped at once
  (`framesLeft`, lc 7721).
- **Renders get cheap.** A render costs about as much as the number of tiles, so rendering after
  every change is fine. The tricks for skipping renders can go: `_renderSoon`, `_eraseListStale`,
  and the neutral skip.

### 4.6 Erasing
**Keep:** the eraser as a stroke, cuts in workers, the exact boolean, the descent, dust, and the
step records for undo.

**Option A (recommended now):**
1. **Mask by explicit targets.**
   - At pen-up the mark records the ids of the objects it will cut; the spatial query in
     `_candidatesUnder` already finds them.
   - An item is masked if and only if its id is in a pending mark's targets.
   - Cut pieces are new objects, so they are never masked. Objects moved in later are not targets.
   - No depth stepping, no done sets, no `_uncut`, and no mark snapshots per list. The bake's order
     no longer matters to the picture.
   - Targets are saved with the mark.
   - The SVG export flushes pending erases first.
2. **Cut in parallel.** Up to the worker count at once, with one cut per object at a time (per
   object, marks are applied in order). Severance is checked once per family per mark, after all
   of that family's cuts have landed.
3. **Make cuts cheaper.** Clip the eraser outline to each target's box before the boolean. Skip a
   descent whose target has no ink near the eraser, using a quick test before dispatch.
4. **Add indexes.**
   - A set of pending marks.
   - A family index (editId → members), kept up to date on add, remove and rekey.
   - Outlines cached per object version.
   - Severance tests only the new pieces' contacts.
5. **Scope the pre-bake, and remove its cap.**
   - Before a drag, bake every target in the selection, in parallel, showing "finishing the erase".
   - For frame selections, bake only the marks that meet those frames (B4, B5).
   - Lasso stays as now: bake the marks that meet the loop.
6. **Allow 32 mask slots per strip.** If a strip would need more, bake the oldest mark (B3).

**Option B (consider later): pending cuts attached to the objects.**
- Each target carries the eraser's shape in its own coordinates until it is cut. For a descent, the
  shape stays in the eraser's frame and moves with the object's table.
- The picture is exact from pen-up. A drag needs no pre-bake, because the pending cut moves with
  the object. "Which ink is masked" becomes a property of the object.
- Cost: a save-format field, per-object mask data, and more undo cases.
- Worth it only if the pre-bake still hurts after Option A.

### 4.7 Moving
**Keep:** displacement tables, whole-cell address changes, frame moves, snapping, and registration
by construction.

**Change:**
1. **No document writes during a drag.**
   - The plane shows the motion, the sync renderer draws the selection with the drag offset at
     pack time, and the ants already use that offset.
   - At the drop, every member's table is written once, as one undo entry.
   - Each pointer event then costs the same for any size of selection.
2. **Precise dirty cells at the drop.** They are the members' own footprints, at the start and at
   the end, kept as a grid in the change log. There is no single rectangle spanning the whole trip.
3. **Choose a plane** (decision D1):
   - lazy "over" layers per cell: true depth wherever it has been computed, and the selection
     floats briefly at the leading edge;
   - the current full precompute: true depth everywhere, blurry when the selection is large;
   - floating on top while dragging: the cheapest, with depth restored at the drop.

### 4.8 Selecting and deleting at scale
- Delete and its undo work in batches per frame, with one batch event and an id → tiles index in
  the tile store (B6).
- `_inkedFrames` gets per-frame ink counts up the tree, updated on add, remove and rehome.
- The ants stay as they are: their cost is the repaint, and AN-2 remains Kobin's decision.

### 4.9 One scheduler for the workers
Priorities, from first to last:
1. patches and the sync render;
2. current-view plates;
3. the drag plane;
4. previews;
5. erase cuts (at least one worker whenever cuts are pending, and all workers when idle);
6. settle;
7. prebake and ladder;
8. snapshots and thumbnails.

Work is cancelled by version and visibility. That replaces the per-step frame-sequence drops and
the separate erase worker's one-at-a-time queue.

### 4.10 What stays
- the lattice, tables and subtree moves;
- the boolean, the freeze and the descent math;
- the tile store's derivation;
- the rasteriser core: families, union, masks and the occlusion cull;
- plates as the cache;
- the SVG live stroke;
- the op log.

### 4.11 Alternatives considered
- **GPU raster (WebGL2 or WebGPU).** The largest speed-up for dense plates, but a large project, and
  exact antialiasing needs care. Not needed first.
- **OffscreenCanvas 2D in the same workers.**
  - float64 matters only for the transform into plate-local pixels, which the pack already does.
    The core's accumulator is already float32 (cl 10204).
  - Skia could therefore fill plates from the same jobs. Far geometry would have to be clipped to
    the plate, and masks emulated by compositing.
  - Measure it against the core on the Magnum Opus before deciding.
- **Per-object rendering.** Rejected (Kobin, 2026-09-24). Only recent changes get layers (§4.4).
- **8 zoom steps per doubling instead of settle.** At most ±9% stretch and no exact-zoom re-render
  at every stop, but twice as many plate sets while zooming.

---

## 5. The six scenarios

**Selecting many objects and moving them far**
- *Today:*
  - A lasso bakes the marks it meets.
  - The drag rewrites every member each event (per-object path) or re-addresses frames.
  - A frame selection bakes every pending erase first (B4).
  - The plane may be coarsened (C7).
  - At the drop, more than 256 members become one union rectangle spanning start and end
    (cl 3007-3008).
  - A quick undo can ghost (B2).
- *Recommended:*
  - The pre-bake covers only this selection's targets, in parallel.
  - Each drag event only moves the plane.
  - At the drop the tables are written once, and dirty cells cover the start and end footprints.
  - The plane holds per cell until fresh plates land.
  - Undo is one entry, and versions rule out ghosts.

**Erasing a lot**
- *Today:* the mark masks at once, but the bake is serial and slow (C5). Pending marks can exceed 8
  per strip (B3), and a lasso inside the area waits on the main thread.
- *Recommended:*
  - At pen-up the targets are recorded and the footprint is patched with the mask, so the picture
    is exact at once.
  - Cuts are parallel and clipped, and neutral steps change no pixel.
  - A selection waits only for its own targets, visibly.

**Zooming in and out quickly**
- *Today:* hold, preview, ladder, fallbacks and carry fill the gaps, but some stand-ins can be out
  of date (B1). Crossings drop sibling tiles.
- *Recommended:*
  - Each cell shows the best fresh plate, and paper appears only where nothing was ever rendered.
  - Requests go only to the step the zoom is heading to; this is mostly the case already.
  - A growing window builds its tiles within a time budget.
  - Recently left frames keep their tiles.

**Erasing that cuts objects into pieces**
- *Today:* each in-family cut re-runs severance with pairwise outline flattening and a whole-drawing
  family scan (Minor), serially.
- *Recommended:*
  - The family index and cached outlines are used.
  - Severance runs once per family per mark, testing only the new pieces.
  - The cut is neutral under its mark, so pixels change only where the pieces differ.

**Translucent objects**
- *Today:* a family has one coverage and one opacity per plate. The held live stroke is clipped to
  stale cells to avoid double alpha (D-2).
- *Recommended:*
  - Recent layers are drawn only while the plates lack them, so alpha is never doubled.
  - Patches are opaque renders of whole cells.
  - Plane layers compose exactly, because source-over is associative.

**Dense and light drawings**
- *Today:* light drawings take the sync path. Dense drawings pay the per-render list rebuild and
  sort and the per-step chord count (C4), and plate memory holds about 2.4 full 4K views,
  stand-ins included.
- *Recommended:*
  - Light drawings keep the sync path, with its results saved as plates.
  - For dense drawings, per-render and per-step costs follow the tiles.
  - The pack cache's extra geometry copy is dropped: jobs copy straight from `Loop` buffers.
  - Plate memory is spent by the scheduler's priorities.

---

## 6. Order of work (each step small and checkable in paint)
1. B1 quick fix: skip out-of-date plates in fallbacks and the carry.
2. B2: put the old table and home in events, and remove `_footBelow`.
3. B3, B4, B5: 32 mask slots, and a pre-bake that is scoped and uncapped.
4. Indexes and batch delete: B6, pending marks, families, outlines.
5. Target-set masks, parallel cuts, and clipped erasers.
6. The change log and versions, and the best fresh source per cell. Remove the carry and the
   per-kind invalidation paths.
7. Patches for removals, and recent-addition layers.
8. The tile-by-tile list.
9. The drag with no document writes, and the plane choice.

## 7. Decisions for Kobin
- **D1. Depth during a drag:** lazy "over" per cell, the current full precompute, or floating on
  top.
- **D2. Crispness at rest:** keep settle, or use 8 zoom steps per doubling.
- **D3. Erasing:** Option A now, and Option B only if the pre-bake still hurts.
- **D4. Huge changes:** is a coarse patch first acceptable, blurrier but never older?
- **D5. Ladder scope:** how many rungs; the far rungs stay off.
