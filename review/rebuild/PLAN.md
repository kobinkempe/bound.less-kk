# The renderer rebuild — the plan (2026-09-25)

The record of the rebuild: Kobin's decisions, the design targets, the order of work, the
invariants that define done, and the working protocol. The analysis behind it is
`review/RENDERER-REBUILD-2026-09-25.md`; the reviews it rests on are `review/DESIGN-REVIEW-2026-09-25.md`,
`review/RENDER-DESIGN-REVIEW-2026-09-24.md` and `review/REVIEW-2026-09-24.md`. Section numbers
below cite those documents. The status log is `review/rebuild/STATUS-LOG.md`.

## 0. Kobin's decisions (2026-09-25, in his words where they matter)

1. **Plate levels: whole doublings**, and "possibly go even further to 4× or 8×". The level step
   is a constant with a lever on the Dev panel (`?dev`) so he can test 2×, 4× and 8× himself.
   The plate cache keeps a byte cap (it is necessary for memory); its default is sized by screens
   with a hard ceiling, also on the Dev panel.
2. **Blurrier now, never older**, with the blur limited to what actually changed: an undo of one
   stroke re-renders that rectangle at full resolution; the coarse-first patch applies only to
   large dirty regions and only over the changed cells.
3. **Erasing: `handledBy` on objects (part one, a), and the barriers stay (part two, b).** His
   semantics: *"if I click a low z-order object and drag it across a pending erase mark, it should
   show through the erase mark."* So an eraser removes what was under it when it was drawn; a mark
   records its targets at pen-up; anything moved under a pending mark later is untouched and
   shows through; anything baked shows on top of a pending mark (his rule of 2026-09-23).
4. **Drag: keep five layers with today's merging rules (c), and keep the pre-render at rest.**
   No document writes during a drag (tables written once at the drop) is accepted.
5. **Partial re-raster first (b)**; recent-change layers only if pen-up cost measures too high.
6. **The SVG renderer was kept for comparison; the new renderer is accurate enough.** It stays
   as a separate class for the export and the comparison; the raster renderer stops inheriting it.
7. **"Go foundational → helpers. I want a strong architecture and logical design."** Big jobs
   for the Opus agents; the orchestrator checks them; browser tests in the container's Chromium;
   Kobin checks the full fixed design at the end. Not too many steps.
8. The orchestrator's own calls (analysis §7 item 8) stand.
9. **Selection stays frame-based; no selection by object ids.** His model: *"a frame is just a
   collection of objects and frames, which is written at a location — the frame is not defined as
   its location. The frame should be more of a data structure that makes it easy to find and draw
   the appropriate objects. The frame and the lattice may need some untangling throughout the code
   to make this true."* The untangling (§1.7 below) gets its own design and its own build step.

Standing rules for agents: `review/rebuild/AGENT-PREAMBLE-CLOUD.md`. Dropped as one-time: "never
describe the eraser as working" (say what was measured, still), the budget gates, "no background
agents", "keep two reviewers going", "the orchestrator implements every fix".

## 1. The design targets

The geometry pipeline (lattice, tiles, the boolean, the bake, moves as tables, the erase as a
white stroke with a deferred bake) is unchanged except where §1.7 says. The rasteriser core
(`rasterCore.js`: coverage, family union, masks, occlusion) is unchanged except for a clip box.

### 1.1 The scene: one object between the document and the renderer (§3.2; A2 §2–§3; R25 §4.2, §4.10, §10.1, §10.5)

- The class is **`Stage`** (`src/engine/Stage.js`, `engine.stage`; "the scene" in prose — the Scenes
  panel owns that word in code). It subscribes to the document after `TileStore` and keeps, for the
  camera's frame, an **item table** in paint order: a chunked z-sorted list (24–26 µs to replace one
  item by three at 25k–45k items, A2 exp2) with indexes by native id, by source tile, by piece and by
  home frame. Items are the frame's own natives, the visible tiles' pieces (a new `TileStore.onTile`
  hook reports every in-place patch; an id → tiles index replaces the whole-cache scan on remove)
  and the re-routed moved objects (a pushed memo). An item reads z, family key and erase data from
  the live native (R25 H8), keeps its box and its offset, and is `pending` from pen-down until its
  shape bake lands (packs skip it, the pick sees it) and `held` during a drag. Nothing is written
  onto a piece or a native.
- **Generation.** One global integer `G`, bumped once per commit: an event outside a batch, a batch
  (a drop, an undo, a delete, a load: `stage.batch`), a mask-state change, a drag delta while view
  plates draw held items. Events apply eagerly; the table is never behind the document.
- **Dirtiness is the changed native's drawn footprint, before and after, from the event itself**
  (`oldBbox`/`oldLw` exist; B-SCENE adds `oldBelow` to offsets-only changes), mapped into every frame
  that has plates. The plate store **tracks** every cell it holds or has a job for
  (`track(key, frame, box)`), and a commit sets `dirtySince = G` on every tracked cell its
  footprints meet — the grid is exactly the cells anyone can ask about. A bounded dirt log per frame
  gives a partial re-render the rectangles to clip to. Picture-preserving changes (a settle, a merge,
  an inkless refusal) carry no footprint; a change that flips a family's union routing, sign, colour
  or alpha dirties the family's whole box (measured first, §5.1 Q15).
- **Freshness is one comparison.** A job carries the `G` it was packed from; a result replaces the
  stored plate iff its `G` is newer (F106 with nothing added); a plate is exact iff
  `plate.G ≥ dirtySince(key)`. The interface A3 builds on is A2 §3.4: `generation`, `onCommit`,
  `sync`, `covers`, `items`, `placed`, `placeNative`, `changesSince`, `snapshot`, `marks`, `masks`,
  `track`/`untrack`/`dirtySince`/`dirtyRects`, `hold`/`setDragDelta`/`release`, `batch`.
- **`placed(item)`** is the one read of an item's geometry as drawn; **`placeNative(nat, frame)`** the
  same for any native (box, `toStored`, `fromStored`). Both read membership and placement only
  through A1's `PlacementModel` (`nativesIn`, `placement`, `displaced`, plus `frameFootprint`), which
  B-SCENE implements over today's calls and B-MODEL replaces underneath.
- **One frame path**: `engine.frame()` runs `stage.sync(frame, window, budget)`, the renderer's step,
  the overlay decision keyed on `G`, and the status; `syncCameraOnly`, `_render`'s five predicates,
  `_eraseListStale`, `_renderSoon`'s skip and `_renderPending` go on the raster path. A crossing or a
  frame re-address rebuilds the table; a window change adds and drops tiles; the camera's tile read
  is budgeted (`TileStore.read` lists misses instead of throwing) and `covers()` says which cells may
  be rendered.
- Deleted by this: per-key epochs and their five drop kinds, the job's epoch array, ids per plate,
  `_footBelow`, `_drawnRectIn`, the plate-event queue and drain, the drag's hold of plate events
  (`stage.hold` replaces it), the per-list mark snapshots, the stale-list machinery. `listFor` stays
  for the SVG renderer and the equivalence fuzz (`stage.equiv`), and goes with them.

### 1.2 Plates: a picture pyramid with a level step (§3.3, R25 §4.1, §4.3, §4.8, §6.5, §8; A3)

- Plates keyed `(frame, level ℓ, i, j)` with `LEVEL_STEP` = S doublings per level: `Z(ℓ) = 2^(ℓS)`,
  **finer is larger**. S ∈ {1, 2, 3} (1 by default; the Dev panel lever, decision 1); S must divide 12
  for the cross-frame map to be integral. The view draws from `ℓv = floor((log2 Z − log2 σmin)/S)` with
  a bounded stretch `σ ∈ [σmin, σmin·2^S)`, `σmin = 2^−½` (at S = 1 this is nearest rounding; at S = 2
  and 3 the view is magnified up to 2.8× and 5.7× mid-gesture and never minified past 0.71, so a view
  needs 40 plates at every S on Kobin's desktop instead of 77 / 135); σmin rises to 1 or 2^½ on screens
  where the view would need more than 48 plates. The Dev panel shows the magnification range beside the
  step.
- **Compose is a plan per screen cell, freshness before resolution** (decision 2): the fresh plate at
  ℓv; else the same picture from another frame (integer mapping across a crossing); else the fresh
  finer children (within the image budget); else a fresh coarser plate up to N levels up, and where a
  stale plate at ℓv exists, that stale plate with the fresh coarser picture drawn over its dirty
  rectangles only (so nothing outside a change blurs); else the stale plate; else paper. Base plates are
  opaque and cells are disjoint, so every pixel is drawn from exactly one source. Across a frame
  crossing the parent frame's level `ℓ + 12/S` is the same picture, cell `(i + ci·2^(8+ℓS), j + cj·2^(8+ℓS))`,
  integral iff `ℓS ≥ −8` (R = 4096 = 2^12; checked to the bit on 3,036 corners, A3 E2); coarser than
  that a frame's picture *is* its parent's level.
- **The image budget**: a compose draws at most `COMPOSE_IMAGES` (30) distinct images directly; past it
  the plan is drawn once into a surface and blitted scaled. The cliff past ~33 scaled images is real in
  headless Chromium too (A3 E6: 0.1 → 26 ms), so the harness gates it. Own-grid plates (1:1 in the
  surface) are never refused; the scaled ones — stand-ins, children, and at rest the level plan's plates —
  are at most `COMPOSE_IMAGES` − the plane's images (§5.6 M1).
- **The rest render**: at the first still animation frame the visible cells at the exact Z, **inline**
  when `0.73 µs·chords + 34 ns·box-pixels + 0.15 ms·non-empty cells ≤ 8 ms` (constants calibrated
  online from `rasterPerf`), else in the workers after 100 ms more of stillness; shown when complete;
  its plates are records like any other, kept through a pure pan (Z unchanged) and discarded by a zoom,
  a frame change, a lateral frame shift, a resize or a dpr change. This is the whole of today's sync
  path and settle.
- **Partial re-render** (decisions 2, 5): `renderPlate` takes a clip box (rows restricted, x not folded;
  the union pass applies every crossing at one x before it tests the winding and starts each band edge
  from the edge's own start — the B-FOUNDATION review of 2026-09-28 found stroke bands crossing the
  clip's top off by one level in 30 of 799 clips without those two rules; with them 0 of 1,879 clips
  differ from the whole render); a patch lands in the immutable plate by a GPU merge through one scratch
  `OffscreenCanvas` (0.5 ms median). A small dirty rectangle is
  re-rendered inline at full resolution within a 6 ms budget; a large dirty region gets the finest
  coarser level whose patch fits the budget, drawn over the dirty rectangles only, with the full
  patches following from the workers at top priority.
- **One prefetch queue**, budgeted and centre-out: the near coarser levels ℓv − 1 and ℓv − 2 with a
  one-cell margin; the far coarser levels the ladder used to hold (about 50 plates, now ordinary
  pyramid levels found by index); the crossing target; the ring at ℓv − 1 (at ℓv only at rest within
  budget). The camera's own tile read is cache-only while moving; missing tiles bake at idle one per
  slice; a cell whose tiles are not all in the scene is planned from stand-ins, never rendered. The
  ladder, the prebake, the preview, the carry, the hold, the pending quantum, the settle machine,
  `fallbackCover`, sync-as-a-mode and quantum-string job identity are deleted (A3 §4.6).
- **Cache**: LRU by bytes; pinned = the drawn set plus the plane (≤ own-grid records + 30 stand-ins + the
  plane cap by construction, H1 closed: 110 plates on Kobin's desktop, 99 on a 390×844@3 phone, §5.6 M2);
  protected = ℓv's ring, the rest set, ℓv − 1, ℓv − 2, the frame just left, the far levels; default budget
  3 views (120 MiB) desktop and 2 views phone under a 256 / 96 MiB ceiling, never under the pinned bound
  (the floor; the ceiling rises to it: 89 MiB on a 1079×1969 phone, 99 on 390×844@3); views and ceiling on the Dev panel; levers persist in localStorage with a URL
  override, never in the canvas record.
- **Input** is coalesced in the engine: events move the camera at once and request a frame; one
  `requestAnimationFrame` step renders, plans, posts, triggers the rest render and emits; `cfg.frames =
  "raf" | "sync"` and `engine.flush()` for the suites and the harness. The scale HUD gets its own
  `engine.onZoom` subscription so the editor page stops re-rendering per wheel event (R25 W1).
- **Scheduling** (A3 §4.4): typed jobs with a required priority (rest 0 > view 1 > plane 2 > cuts 3 with
  one worker reserved while any are pending > prefetch 4 > thumbnails 5); cells sorted by distance from
  the attention point and dealt round-robin across strips; a per-frame pack budget (4 ms) while
  moving; a job aimed at where the camera will be on arrival; cancellation by purpose generation.
- *As built (B-PYRAMID-2b P6, 2026-09-29):* the old path is deleted and the pyramid is the only raster path;
  the cuts run through the same `JobQueue` (§1.6). "Older" is counted by cause: `olderPatchMs` (a stale plate
  while its worker patch is asked or in flight, A3 §3.4) and `olderOtherMs` (0 is the rule; the never-older
  fuzz still reaches a stale coarser stand-in after a zoom from rest before the prefetch's quiet; the
  orchestrator's answer — the rest records kept after a zoom as a stand-in source — goes to the P6 review).
  The camera's table window grows to a view while
  a selection is on the plane's path (D1); the attention point is the last pointer, wheel focus or pinch
  centre; the prefetch holds while a report sends; a stale rest cell's cover takes the mapped frame's exact
  cells; a request made outside a camera step is pumped in a microtask (the rest after its quiet had waited
  for the next input) and packed in a row of kind `settle`; the inline executor's core time is the row's
  (`rasterPerf.noteCore`). The undo of one stroke in the dense scene is never inline: its patch estimate is
  34–41 ms against the 6 ms budget (2 cells, E at the 20,001-chord cap, A 666 k box pixels), and no coarser
  level fits. *Reviewed (the B-PYRAMID review, 2026-09-29):* the rest records stay after a zoom as the stand-in
  (A3 §2.4's dated note); a patch's E is its items' rows' share inside the clips and a user's patch (undo, redo,
  pen-up's group) has 16 ms (A3 §3.3's); at rest the pack budget is a task's (A3 §4.4's).

### 1.3 Erasing: the mask as document state, cuts in parallel (decision 3; A2 §4; §3.5; R25 §4.9, §10.2, §12.2)

- **Three fields**, all document state, restored by reference by the step graph: `targets` on the
  mark (the ids under it when its shape landed, never changed after); `targetOf` and `handledBy` on
  any native, inherited by every piece a cut or a cede mints (the cutting mark added to
  `handledBy`); a refusal or a graze adds the mark to `handledBy`.
- **Registration** runs in the same commit as the mark's shape landing (the first bake slice, a
  macrotask after pen-up; every reader that needs the mask before that — the pick, a barrier —
  resolves pending perimeters first): the frames pass, the candidate scan once, `targets` recorded.
  Nothing can move under a mark before that: every gesture that moves ink flushes pending perimeters
  first, and the mark's op is on top of the undo stack (a stated invariant with a test).
- **The rule is pure** (`eraseRule.underMask`): item *i* is masked by mark *M* iff *M* has landed,
  `M ∈ i.targetOf`, `M ∉ i.handledBy`, `z(i) < z(M)`, and their boxes meet. Kobin's semantics follow:
  an object dragged under a pending mark is not a target and shows through; anything baked has the
  mark in `handledBy` and shows on top; a new stroke has a higher z. The pick skips a masked target
  where the mark covers it.
- **What an erase step dirties.** The shape landing: the mark's box. A cut or descent applied on a
  pending pair: `box(mark) ∩ box(target)` ∪ the dust boxes — a small rectangle, re-rendered through
  the clip box (inline when small) — so the band where the target's edge crosses the eraser's is
  exact step by step (A2 measured it at up to 57/255 if left; the outlines of re-flattened arcs
  outside the mark's box differ by ≤ 16/255, the arc tolerance, until those cells next render).
  A refusal over ink: `box(target) ∩ box(mark)`. A graze or an inkless refusal: nothing. The mark
  spent: its box.
- **Cuts in parallel**: dispatched ahead in the serial order (marks oldest first, targets top-down)
  through `pool.submit({kind: "cut" | "descent", prio: 3, …})`, applied strictly in serial order
  through a reorder buffer so a parallel bake produces the serial bake's document, ids and op log;
  descents serialised; a per-target lock; one worker reserved for cuts while any are pending. Until
  A3's queue lands, an interim N-worker erase pool behind the same `submit`.
- **The barriers stay, asynchronous and uncapped**: a tap, a drag start and a lasso dispatch their
  pending pairs at the head of the cut queue and park the gesture's continuation; rounds apply in
  serial order until no pair is left; the selection follows the cuts to the pieces (a tap re-picks the
  point once they land, SM-5: B-ERASE, A2 §4.14); the tab stays
  responsive; a chip "Finishing the erase…" after 150 ms; a new gesture, tool change or undo cancels
  the parked continuation. A drag's barrier bakes the selection's members and the marks homed under
  its frames only (B4); a lasso's bakes every pair whose target's box meets the loop's (H5).
- **Mask slots**: 16, byte-sized, marks sharing a slot exactly when no item lies under both with
  different bits; past 16 the least-conflicting pair is merged and the older mark's cuts raised;
  **never white ink** (it would hide exactly the objects Kobin's rule says show).
- Persistence: the fields in object headers (kobin-1 stays version 1: additive), refusals as `attr`
  entries, `targetOf` derived at load from every known mark's `targets`; a file saved before the
  change registers each mark once by the old rule minus its log's bake entries. Spent marks' ids are
  pruned from live natives.
- Deleted: `_lowerMark` and the half-integer z, `_bakeDone`/`_uncut`, the per-list snapshots,
  `_eraseStrokes()` scans (a set maintained by events), the one-cut-at-a-time queue, the 200-round
  cap, the neutral mode flag (the Stage classifies from the event's `by` and the rule),
  `_renderSoon`'s skip. One boolean per target under several marks is deferred (measure ten dabs
  with the pool first).

### 1.4 Moving (decision 4; §3.4, R24 §4.7, R25 D1)

- `MovePlane` stays: five layers with today's merging rules, coarsening, the quick level, the
  stopgap, and the pre-render at rest. It is ported to the scene's job identity and the cache
  budget, and its cells are grown by one screen so a selection larger than the viewport is not
  clipped at drag start (R25 D1).
- **No document writes during a drag**: the scene holds the selected items and applies the pointer
  delta at pack time; at the drop every member's table is written once, one undo entry, old ∪ new
  boxes dirtied; the plane holds per cell until the fresh plates land, as now. **Built 2026-09-30
  (B-DRAG)**: `stage.setDragDelta`; held natives placed at + δ for every input (`placed`,
  `placeNative`) and painted there by the view only when the plane does not draw them (`Item.res`,
  so the raster pack and the SVG path needed no edit); the drop (`_dropMove`) one Stage commit with
  its merges, a user's patch budget; per drag event 0 document events, re-homes, mints, settles.

### 1.5 The live stroke and the SVG renderer (decision 6; R25 §4.5, §4.10; A3 §3.6, §7)

- The SVG tail and frozen chunks stay in a `LiveStrokeLayer` inside one `SvgLayer` (one Two.js
  instance: the live stroke, the lasso, the debug overlays). `RasterRenderer` becomes a plain class
  composing `PicturePyramid`, `SvgLayer`, `OverlayLayer` (ants) and the chevrons, and stops inheriting
  `Renderer`; the lasso, the debug overlays and the chevrons become one shared module both renderers
  call. `Renderer` (Two.js) stays as a separate class for `?svg`, the SVG export and the pixel
  comparison.
- **Pen-up**: the new stroke, and a new eraser mark, is *pending* in the scene from pen-up until its
  shape bakes (packs skip it, it is hit-testable, it dirties nothing; the SVG path shows it); when the
  shape lands, one partial re-render of the drawn cells under its rectangle, and a **group commit**
  publishes those plates and releases the SVG path in the same task, so no frame shows both or neither
  (a translucent stroke's alpha is applied once). This ends the double raster (D-3) and the per-cell
  clipPath. A group older than 3 s commits what it has.
- *Built (2026-09-29, B-PYRAMID-3 items 1–3):* `raster/SvgLayer.js`, `raster/LiveStrokeLayer.js` (`begin(o, origin)`,
  `arcs`, `hold()`, `release(id)`, `cancel()`), `raster/svgOverlay.js` (the lasso, the debug overlays, the chevrons and
  the SVG ants) and `raster/svgAnchors.js`, composed by `Renderer`, which draws the Stage's items; `?svg` masks a landed
  pending mark's targets (`eraseRule.underMask`, an SVG `<mask>`), the export bakes every mark in its copy first, and
  a group at opacity 0 is not rebuilt (F133). *Item 4:* `RasterRenderer` extends nothing: FC1's one list is
  `[PicturePyramid, SvgLayer, OverlayLayer, bl-sel-edges]`, `endLive` is `LiveStrokeLayer.hold()` and the group
  commit's callback `release(id)`, and a crossing carries a held path into the new frame (root scaled, box and group
  rectangle mapped), so a pending stroke's path no longer comes down there (§5.15 item 1's last clause); `listFor`,
  `_buildList` and `TileStore.content`/`contentOffCamera` are deleted, and the prefetch's tile reads are warm (§5.14 item 5).

### 1.6 The worker pool

One pool for plates and cuts (the scene index keeps its own worker), one priority ladder: the rest
render for the view > the view's plates > the drag layers > cuts, with one worker guaranteed to cuts
whenever any are pending > prefetch > thumbnails and snapshots. Cancellation by generation and
visibility. Buffers pooled as now; the pack memo by reference (no second copy of visible loops).

### 1.7 The document model: container and lattice untangled (decision 9; A1's option (c))

Today a frame is three things at once: a coordinate system that keeps numbers small and exact; a
spatial bucket the tile derivation relies on (invariant 2: a native's *stored bits* lie within its
cell ± REACH, so a tile finds its ink in nine cells); and the container Kobin means. A1 found that
invariant 2 is needed only for stored bits, and stored bits never move: what the engine's
re-bucketings protect is the distance between a *picture* and its stored bits. The re-bucketings are
the settle that carries natives across a cell edge at any read, the per-event re-homes and frame
mints of a drag, the merge of a shadow into its cell's resident at a read, `_normalizeHome`'s
whole-frame translation at the drop, the revival of a deleted frame when ink lands in its cell, and the
cede that spreads one object over several frames. Nine of the eleven move flags Kobin saw trace to
them (F78, F93, F94, F100, F107, F108, F110, F116, F126; F65 is the erase rule, F91 the phone's plate
cap). The design, `A1-document-model.md` §4.4, in four steps:

- **C1 — a frame's shift is placement, composed on read.** Never pushed into its natives: no settle,
  no carry, no read that mutates. One model accessor composes frame shift ⊕ own table; `objShift` and
  `residual` honour the whole-frame carry at the home depth (today they drop it: 0.75 W comes back as
  −0.25 W); the reroute covers every displaced picture including whole shifted frames and views above
  the home; new ink in a shifted frame takes −shift in its own table; enclosure boxes are the union of
  the cell ± REACH and its shifted copy (closes H6). Measured picture-neutral: 716 of 720 placements
  bit-identical, the rest one ulp at the parent view, 480 of 480 at and below the home.
  **Built 2026-09-29 (B-MODEL-C1)**: the model before it frozen as `__oracles__/model-v1/`; the
  tile fuzz against it (`model.equivalence.probe.js`, 20 seeds × 40 ops) 6,336 native items at
  1,717 frame views, every one bit-identical, the 33 the oracle carried included; a 20-event drag
  of a frame of 300 natives writes 0 tables an event (the oracle 300, then 600). Where building
  changed the step: a shadow now merges at the end of the user action that made it (the drop, an
  undo or redo, a load, a replay's end), the frames' shift difference folded into the merged
  natives' own tables, since a read may no longer merge (C3 still removes merges); `displaced`
  keeps minting the empty frame a picture is read from, the one exception to §3 row 8 (C3
  revisits it when a deleted subtree leaves the lattice); a geometry edit that takes a table away
  moves `offRev` (the reroute memo kept a promoted newcomer's old placement). The settle's inverses
  for old stores live in `legacy/modelV1.js`, deletion date 2026-12-31. Version 3 is written only
  when the lattice carries a shift; a shift-free file is byte-identical to the model before C1.
- **C2 — membership changes only at the end of a user action.** No document writes during a drag; at
  the drop a per-object member is re-homed once and a subtree re-addressed once (the 183–290 frames a
  40-step drag mints become the final 8–13); `_normalizeHome` goes; the selection is repaired from the
  op's own record, never from events. "An object belongs to the frame it was drawn or moved into."
  **Built 2026-09-30 (B-DRAG; A1 §15)**: A1 §1.4's census 145–239 frames minted during a 40-step
  drag → 0, the drop leaving 4–14; `_normalizeHome`, `_homeShift`, `_restoreFrames`,
  `_keepingSelection` and the per-remove listener deleted; the repair (`_opUnder`/`_repairSelection`)
  reads the op's frames and per-object members before a drop, an undo or a redo; a 5,000-native delete
  585 s → 0.5–1.5 s in jsdom. The merge hand-over stays until C3. Found: a long subtree drag landed a
  carried kid a cell off (F136, 400 of 1,250 natives at one seed), gone with the per-event writes.
- **C3 — a frame keeps its identity.** No merges: a frame landing on an occupied cell is a permanent
  co-resident; lookups and every by-cell reader see co-residents; each co-resident is its own
  selection unit; the camera is handed to the resident at the re-address; GC promotes; a deleted
  subtree leaves the lattice (F107's revival sets go).
  **Built 2026-09-30 (B-MODEL-C34; A1 §16)**: the frames at a cell are one group all the way down (a
  landing links kids, a leaving splits them); readers read the cell (`cellList`, `cellFrames`, `sameCell`) and
  geometry walks cells, so co-residents' pictures are bit-exact; no read mints (`displaced`'s mint moved to the
  action's end, `TileStore.prepare`; row 8 without exception); a deleted subtree's op carries each frame's
  address, its replay takes the frames out again. Measured at the landing (2026-10-04): every C3 rule's break-check red; frames minted during a drag 0/0/0; scenario 1 in headless Chromium no worse than before C3/C4; the 200-seed tile fuzz not clean (OPEN-FLAGS F138).
- **C4 — a cede's kids live in private frames of their object.** The lasso never takes a private frame
  whole and every other frame keeps the O(1) enclosed rule with no family pass; F108's 17,007-id torn
  walk goes for new content (legacy kids keep the backstop rule). Severance compares cells.
  **Built 2026-09-30 (B-MODEL-C34; A1 §16)**: `privateFrame(parent, i, j, key)`, keyed by the public frame the
  family's chain hangs from; version 3 covers co-residents and private frames. The city lasso takes 16 frames and 0 ids where the oracle read 48 ids; every C4 rule's break-check red.

What it deletes: `_settleIfPending` and its seven call sites, `unsettle` (legacy inverse only), the
settle entries and their coalescing, `_bakeSettled`, `_followCarries`/`_flushCarried`/`_keepingSelection`,
F116's foreign-shift settle, `_mergeShadows`/`adoptShadow`/`unmerge`/`holdMerges`, the `mergeFrame` event,
the merge handler and F126's follow, `_reuseDetached` and the F107 sets, `_normalizeHome`. What it adds:
one composition accessor, co-resident lookups, a `private` frame flag, a version-3 gate (an older build
refuses a file with a shift, a co-resident or a private frame rather than dropping them; files the
deployed build and the phone saved carry none and open unchanged). The lattice's coordinates are
unchanged, so A3's integer crossing map is untouched. **The contract with the scene** (A1 §6):
`nativesIn(F)`, `placement(o, F) → {F0, rem}`, `displaced(F)`, and shift fields on `refile` events; the
scene reads nothing else for membership or placement, so B-MODEL lands without touching the renderer.
Order: the contract inside B-SCENE (step 0); C1 right after B-SCENE; C2 inside B-DRAG; then C3; then C4.
Equivalence: a frozen copy of today's model under `__oracles__/model-v1/` and a fuzz that compares every
derived tile piece bit for bit and the selection's ink after every random op.

### 1.8 Kept as is

The coverage rasteriser and its family union; TileStore's tiles and in-place patches; the boolean,
the freeze and the descent maths; the op log with results; the overlay ants; the subtree move; the
report pipeline; the diagnostics rings (`rasterPerf`, `longFrames`), extended for the new counters.

## 2. The order of work

**Wave 1 — analyses (now, three at once, read-only):** A1 the document model (§1.7); A2 the scene,
generation and the erase rule (§1.1, §1.3, §1.6); A3 the pyramid, the rest render, partial
re-render, the queue, the budget and Dev levers, the MovePlane port and the SVG demotion (§1.2,
§1.4, §1.5). Each returns a design document under `review/rebuild/`. The orchestrator reads them,
writes the per-component design and the answers, and writes or commissions the invariant tests.

**Wave 2 — builds (big jobs):** B-FOUNDATION (the clip box, `level.js`, input coalescing and the
scale HUD, the Dev levers, the harness — landed 2026-09-28 and reviewed); B-SCENE (§1.1 with the
freshness rule and `placed()`; the `listFor` equivalence fuzz; the property tests; S1–S3), then
B-ERASE (§1.3) on it; B-PYRAMID in two halves so that each fits one builder's context window and
stays out of B-SCENE's files: **B-PYRAMID-1** (new modules only, from B-SCENE's S2 checkpoint:
`PyramidStore`, `PicturePyramid` with the plan, the rest render, the patch merge and the integrals,
`jobQueue`, the prefetch policy, and their property tests) and **B-PYRAMID-2** (after B-SCENE's S3:
the renderer under `cfg.pyramid`, the pen-up group commit on the live path, the MovePlane port, the
levers taking effect, the harness comparison both ways, the deletion of the old layer and store, the
SVG demotion, docs). One reviewer pass per build. The orchestrator reads every diff and runs the
harness.

**Wave 3:** B-MODEL-C1 (the composition on read, right after B-SCENE and in parallel with B-PYRAMID; its
first item is the `LevelMap.ensureId` spine gap B-FOUNDATION found, so that a load mints a missing spine
frame as F67 promises),
B-DRAG (no writes during a drag, §1.4, carrying C2), then B-MODEL-C3 and C4 (§1.7). Then the
remaining helpers from the analysis §3.1 that the waves above have not absorbed (batch delete,
`objShift` per group at a crossing, the plate budget arithmetic).

Each build ends with the old mechanism deleted, the docs corrected (`DESIGN.md` §7–§10, the
`docs/ai/` files, the plan sections a change makes false), a commit on the session branch by the
orchestrator, and its harness numbers in the status log. Kobin looks at the whole at the end.

## 3. Invariants → tests (the acceptance list; R25 §10.9, corrected for decision 9)

| invariant | the test |
|---|---|
| a stored plate's generation is monotone; exact iff `plate.G ≥ cell.dirtySince` | random interleavings of changes, dispatches and arrivals: no arrival lowers a plate's G; the compose never draws as exact a plate a later change touched |
| the scene's items equal `listFor`'s sorted output | a jsdom fuzz over draw, erase, move, undo, crossing; compared after every operation until `listFor` is deleted |
| a mark hides exactly its targets, and the masked target looks like its cut pieces | A2 §6.4 row 3: the pack's bit equals an oracle from the op history; plates kept through a bake against a fresh raster differ only within 1.5 px of a mark's edge (re-rendered step by step under §1.3) or on a cut arc's outline by ≤ 16/255; an object moved under the mark after its registration is unmasked and never cut |
| a family's union is insensitive to a one-ulp disagreement at a shared edge | perturb one shared edge by an ulp; the plate is unchanged, except that a byte on the shared edge may move one alpha step where the exact value is a rounding tie (built: `raster.familyUlp.test.js`) |
| the placed read equals the numeric table | random tables and depths: the picture through `placed()` equals the picture through the home frame with the table applied, to 1e-9 |
| the pyramid's crossing mapping is exact | random frames and cells: the parent's coarser cell by integer arithmetic equals `_mapFrame`'s affine to the bit |
| a selection stands for the same ink through drags, undo, redo and cuts, with no event chasing | the selection fuzz against the frozen model oracle (A1 §5 check 2): the selection's ink equals the oracle's and the ink it was made with, mapped through cuts to pieces; no inkless frame (built: `select.stands.probe.js`) |
| no read changes the document | `rev`, `offRev`, `addrEpoch` and the lattice's frame set unchanged across `listFor`, `content`, a lasso, a hit test, a pack and a snapshot, over the fuzz's states — the one exception: `displaced` may mint the empty frame a picture's pieces are read from (A1 §1.2 row 19; frame GC's; C3 revisits it) (built: `model.pureRead.test.js`) |
| every derived tile piece is bit-identical to the frozen model's | the tile fuzz (A1 §5 check 1) over random op sequences, at and below the home to the bit, one ulp above it (built: `model.equivalence.probe.js`) |
| a partial re-render equals a full one | random dirty rectangles: the plate re-rendered through the clip box equals the plate rendered whole, pixel for pixel |

The existing raster suites that assert an ordered call log on a recording context (about fifteen
thousand lines) encode the mechanisms being removed; each is deleted with the mechanism it
asserts, never ported. The fuzz harnesses live under `src/engine/*.probe.js` so they survive.

## 4. The working protocol

Fable-led. The orchestrator writes the design and the invariant tests; a proposal precedes each
build (approach in 300 words, decisions with confidence, at least three questions, the files, the
acceptance list restated); the orchestrator answers in writing here, under §5; the builder builds
to the answers; the orchestrator reads the diff itself; one reviewer pass against the invariant
list, whose findings name the invariant they break; a second pass only for a major. At most three
agents at once. Agents write status to `review/rebuild/STATUS-LOG.md`. The orchestrator runs the
harness (`tools/harnesses/browser-check.js`) before and after each build and records the numbers.

## 5. The orchestrator's answers, per component (appended as proposals return)

### 5.1 To A3 (the pyramid, the rest render, partial re-render, the queue, levers, MovePlane, SVG) — 2026-09-26

Read in full. The design is adopted as written in `A3-pyramid.md`; §1.2 and §1.5 above were rewritten
to it. The sixteen questions:

1. **Q1 yes.** Levels finer = larger, `Z(ℓ) = 2^(ℓS)`; the parent's same picture is `ℓ + 12/S`,
   integral iff `S | 12` and `ℓS ≥ −8`. PLAN corrected; DESIGN §9 gets the same sentence when B-PYRAMID
   lands.
2. **Q2 yes.** The bounded band `[σmin, σmin·2^S)`, σmin = 2^−½, adaptive past 48 plates. The lever
   shows the magnification range for the chosen S.
3. **Q3 yes.** Inline at the first still frame; the worker rest set after `REST_QUIET_MS` = 100 ms of
   stillness, a cfg so the Dev panel can show it.
4. **Q4 yes.** Rest plates survive a pure pan; a lateral frame shift, a zoom, a frame change, a resize
   or a dpr change discards them.
5. **Q5 yes.** Freshness first, with the patch rule and `PATCH_MAX` = ½ cell; `olderMs` counts the one
   case older can still show, and the harness reports it.
6. **Q6 yes.** The ring at ℓv − 1 by default, at ℓv only at rest within budget.
7. **Q7 yes.** A new stroke and a new mark are pending from pen-up to their shape bake, then one
   rectangle re-render and the group commit (§1.5). This is an ask on B-SCENE: A2's `finalize` row
   becomes "pending until `bakeShapeById`, then packable with its footprint". For a mark, its targets
   are recorded when its shape lands (A2-Q10), in the same commit; the pick and the barriers resolve
   pending perimeters first; the live white path covers its region until then, as today.
8. **Q8 yes.** localStorage per device, a URL override that wins, never the canvas record.
9. **Q9 yes.** The GPU merge through one scratch `OffscreenCanvas`; jsdom keeps raw pixels and a
   typed-array sub-rectangle copy, which is what the property test checks.
10. **Q10 yes.** Coalescing in the engine's frame; `cfg.frames = "raf" | "sync"`, `engine.flush()`; the
    suites and the one-off SVG engines run sync.
11. **Q11 yes.** `engine.onZoom(cb)` once per frame; a `<ScaleHud>` leaf owns `scaleSession` and the
    write-back; `onStatus` throttled at 100 ms with no bypass; the scale dialog reads the camera when it
    saves.
12. **Q12 yes.** Cache-only camera reads while moving; missing tiles bake at idle one per slice; the
    partial read `read(F, rect, budgetMs) → {items, missing, complete}` is B-SCENE's (it owns
    TileStore's surface with the scene); the resumable per-tile bake cursor is its own item after
    B-PYRAMID, measured on the Magnum-class synthetic drawing.
13. **Q13 yes.** "Never both."
14. **Q14 yes.** Only the SEL layers grow by one screen.
15. **Q15 yes, measured first.** B-SCENE dirties the family's whole box when a change alters its union
    routing, winding sign, alpha or colour; a cut of a target under its own mark dirties nothing
    (A2's picture-preserving rule). One measurement (bytes changed in untouched pieces when routing
    flips, on the synthetic drawing) decides whether the family rule stays or becomes dead weight.
16. **Q16 yes.** `maxImagesPerCompose` and compose ms become harness metrics; the harness header and
    the cloud preamble are corrected today.

Two additions of the orchestrator's: the plane is keyed by its own zoom `Zp` as A3 §6 argues (not by
ℓv), and the level lever offers 1, 2 and 3 only. B-PYRAMID's scope and its split into builders are set
in §5.3 once A2 is answered.

### 5.2 To A1 (the document model) — 2026-09-26

Read in full. Option (c) is adopted as written; §1.7 above was rewritten to it. The eleven questions:

1. **Q1 at the drop.** A per-object member is re-homed once, at the drop (C2). Kobin's words are "a
   collection of objects and frames, which is written at a location", and an object dragged into a
   cell joins that cell's frame: "moved into" is the reading. It is put to him once (leastSure 3);
   the build does not wait for it.
2. **Q2 the op repair** in B-MODEL. Whether a moved frame's subtree must stay literally the same group
   after a re-parenting is put to Kobin; if yes, the second parent pointer is the contained follow-up
   A1 describes.
3. **Q3 the −shift entry** for new ink in a shifted frame.
4. **Q4 C4 as B-MODEL's last step.** It is F108-COST's option (c), which he was offered.
5. **Q5 yes**, version 3 when the lattice carries a shift, a co-resident or a private frame.
6. **Q6 keep** the legacy inverses in one quarantined module with a deletion date and a test that no
   production path outside replay imports it.
7. **Q7 the frozen copy** under `src/engine/__oracles__/model-v1/`, as `KobinEngineV0` was.
8. **Q8 yes**, each co-resident its own selection unit.
9. **Q9 yes**, a deleted subtree leaves the lattice.
10. **Q10 the order as recommended**: the contract inside B-SCENE; C1 as its own build right after
    B-SCENE, in parallel with B-PYRAMID; C2 inside B-DRAG; then C3; then C4.
11. **Q11 no**, legacy ceded kids stay where they are under the backstop rule.

Orchestrator's additions: the lint that forbids `.below` reads outside the model (A1 risk 1) is part
of C1's deliverable; the "no read mutates" property (`rev`, `offRev`, `addrEpoch` unchanged across
every read) is added to PLAN §3.

### 5.3 To A2 (the scene, the generation model, the erase rule) — 2026-09-26

Read in full. Adopted as written in `A2-scene.md`, with §1.1 and §1.3 above rewritten to it and one
change of the orchestrator's (A2-Q2). The fifteen questions:

1. **A2-Q1 `Stage`.** Yes; "the scene" in prose.
2. **A2-Q2 a cut step re-renders its small rectangle.** Not fully neutral: an applied cut or descent on
   a pending pair dirties `box(mark) ∩ box(target)` ∪ its dust boxes, re-rendered through A3's clip
   box (inline when small); the mark's box at spend. That is Kobin's decision 2 applied to the band
   exp4 measured (up to 57/255 along the eraser's edge), at about fourteen small re-renders per
   Magnum-Opus bake. The arc-outline differences outside the mark's box (≤ 16/255, the flattening
   tolerance) are accepted until those cells next render, and row 3 (b)'s envelope is the gate for
   them. The classifier stays per event from `by` and the rule; the choice is one line there, as A2
   says.
3. **A2-Q3 merge, never white ink.**
4. **A2-Q4 defer** one boolean per target; measure ten quick dabs with the pool first.
5. **A2-Q5 build against `submit`**; an interim N-worker erase pool if B-ERASE lands before A3's
   queue; the transport swap is B-PYRAMID's.
6. **A2-Q6 asynchronous always**, inline where there is no worker. Kobin's "barriers stay" is the
   semantics (nothing selected, moved or judged before its cuts land); the freeze was never the
   feature. The feel (a tap that selects a moment later, a drag that jumps to the finger, the chip
   after 150 ms) is his to judge at the end, and is named in the report to him.
7. **A2-Q7 yes**, the pick follows the mask.
8. **A2-Q8 yes**, JSON ids on the header; the geometry array only if a real mark measures over ~1k.
9. **A2-Q9 keep**, and Kobin is asked once with the example (an undone older erase's source comes
   back whole and the newer mark drawn over its pieces does not cut it).
10. **A2-Q10 at the shape landing.** §5.1 Q7's wording corrected.
11. **A2-Q11 yes**, B-SCENE's hold queues held natives' events and releases one batch.
12. **A2-Q12 keep** `z(i) < z(M)`.
13. **A2-Q13 yes**, the frames pass at registration.
14. **A2-Q14 yes**, off-camera reads through `stage.snapshot`.
15. **A2-Q15 yes**, prune spent marks' ids.

Orchestrator's additions: A1's contract gains `frameFootprint(frame)` (A2 §7.3), so a frame's
footprint is the model's answer, not `cell ± REACH` computed in the Stage; the two cede bodies become
one function with a receiver (R25 D4) in B-ERASE; `Document.setZById` keeps no production caller and is
noted as the reserved z op's hook.


### 5.4 To B-SCENE-2 (its end report of 2026-09-28) and asks carried to B-PYRAMID-2

1. **Q1 no interim fix** for the erase bake's 1.6× (a cut step re-rasters whole plates under the mark
   until the clip re-render lands): B-PYRAMID-2's partial re-render is the fix; the reviewer attributes
   the cost meanwhile.
2. **Q2 yes**, no cap on a pending stroke's live path: the path is the picture until the shape lands.
   Applied by the B-SCENE reviewer as a minor.
3. **Q3 yes**, dispatch refusals counted by reason in `report()` and read by the harness; the reviewer
   adds them for the zoom-out diagnosis, B-PYRAMID-2 keeps them.
4. **Q4 yes**, the `raster.plates` tests whose code still runs stay until B-PYRAMID-2 deletes that code.

Asks carried to B-PYRAMID-2 from B-SCENE-2's open items: the camera's `sync` budget (`Infinity`
today; A3 §4.2's budgeted read with `covers` planning stand-ins); `_renderPending`'s removal;
`job.ids` off the wire once the cover test reads the Stage; the harness printing the load average
with every run (a contended run must be visible); the zoom-out paper regression's cause as the
reviewer finds it (a `covers` refusal after crossings is the suspect).

Correction to the status log of 14:25 UTC: the jest run that loaded the machine for 8.7 hours was
B-SCENE-2's own S2 break-check, orphaned when the session limit stopped it, not the first builder's.

### 5.5 To B-PYRAMID-1 (its end report of 2026-09-28)

1. **Q1 yes**, the opt-in `softCanvas` extension stays: one implementation.
2. **Q2 yes**, fit `K_u` against the union rows the estimate priced each job with.
3. **Q3 no**: the literal surface rule ("scaled stand-ins ≤ 30 − own plates") leaves a large screen no
   stand-ins at all, which is paper where a source exists (the builder's own least-sure item 2). A3 E6
   measured the cliff on scaled draws and 1:1 draws mild; the review pass decides the rule from those
   numbers, with the 84-cell screen as a constructed test.
4. **Q4 yes**, the cut reservation and the low-priority cap at `max(1, workers − 1)`.

The builder's ten decisions (children second nearest the attention point first, rest-mode layering, the
pin bound through a one-view plan cap, the rest trigger on cells with no plate, the patch overlay grown
by one pixel, the group commit's G rule and re-targeting, calibration fed by the renderer, refusal by
job id, the queue caps, smoothing on) are accepted subject to the review; the one-view plan cap is
checked there against a phone screen whose stand-ins come from two levels (least-sure item 4). Its
open-items list (every line the shared files need) is B-PYRAMID-2's brief.

### 5.6 To the B-PYRAMID-1 review (its report of 2026-09-28) and the B-SCENE review's zoom-out verdict

The review found the plan's two caps wrong against decision 2 and PLAN §1.2's lookup order (paper or an older
picture shown while a fresh source is cached), with four constructed screens as evidence (4 of 4 red on the
shipped plan; 4 of 4 green with the fix), and fixed three minors (a hard drop now refuses by job, so a job a
newer one overtook is refused too; children upgrade paper → older → blur, nearest first within each; the far
prefetch test on a frozen clock). Its edits are committed with this section.

1. **M1 adopted**: stand-ins are counted apart from own plates, `cap = COMPOSE_IMAGES − plane.images`;
   `_ownCount` goes; in rest mode the level plan's ℓv plates are drawn scaled and count as stand-ins. The
   measurement behind it: at 34 bitmaps a 1:1 draw costs about a quarter of a scaled one (A3 E6 6.3 vs 26.3 ms;
   the review's E6b 6.6 vs 21.9 ms, headless), so the limit of 30 belongs to scaled images. This is the surface
   rule §5.5 Q3 left to the review; A3 §1.5's "scaled ≤ 30 − own" is corrected.
2. **M2 adopted**: the one-view record cap goes; the pinned bound counts what the plan draws — pinned ≤ own-grid
   records (≤ `max(viewPlates(σmin·2^−h), viewPlates(1))`) + 30 stand-ins + the plane cap — and the budget floor
   is that sum. A3 §4.5's "pinned ≤ 80" becomes this sum.
3. **Both land in B-PYRAMID-2 as its first step** (its brief, §2 P0): the four constructed cases move into
   `PicturePyramid.plan.test.js`, the three tests that pin the old caps are rewritten, each rule a break-check.
4. **Q2 no change now**: stand-ins stay inside the surface. Whether they are cheaper on the ink canvas after the
   blit is a compositor question headless cannot price (Kobin's tab: 4 scaled + 32 1:1 at 37 ms on one canvas);
   it goes on the list for his Chrome at the end.
5. **Q3 yes**: the phone's ceiling becomes `max(96 MiB, the floor)` so the lever range is never empty; the floor
   is 99 MiB on a 390×844@3 phone. Pins are never evicted whatever the ceiling, so this changes a reported
   number, not memory; `overCapPinned` stays the counter, and the phone's pinned high-water mark is measured by
   B-PYRAMID-2 (a jsdom count at that screen; the harness's phone viewport if it has one).
6. **Q4 yes**: `MOVE_PLANE_PLATES` and `MOVE_PLANE_PLATES_PHONE` move to `raster/level.js` beside
   `VIEW_PLATES_MAX`, `MovePlane` re-exporting them until it is ported (B-PYRAMID-2 P3's first edit).
7. **Notes carried to B-PYRAMID-2**: a stale rest cell's cover searches only its own frame's levels, so after a
   crossing the frame just left can hold the fresh picture while the cell shows stale — scenario 1's `olderMs`
   must be 0, so the cover extends to the mapped frame (A3 §1.4's step (b)) for rest cells too; `_aim`'s arrival
   estimate adds the in-flight count although `pump` dispatches only to a free slot — settled from
   `rasterWorkerClient`'s real dispatch; `raster.move` L3 (a held path released past `LIVE_HOLD_MS`) is red on the
   tree since the 19:15 snapshot because the B-SCENE reviewer applied §5.4 Q2 (no limit on a pending path) — the
   reviewer rewrites L3 to the new rule.
8. **The B-SCENE review's zoom-out verdict** (its 19:17 entry): B-SCENE-2's 9,784 vs 821 ms was the harness's
   rAF-only sampler, which charges the share read before the engine's frame across the whole long frame and
   spreads 2–9 s between runs of one tree; a post-paint sampler on the same runs gives 36.6 ms (the landing)
   against 49.8 ms (the list path); no `covers` or dirt refusal occurred in seven runs. Not a defect; nothing for
   the budgeted read to fix. §5.4's ask 5 is closed. B-PYRAMID-2's harness step uses the post-paint sampler (the
   reviewer's `rv2/bcp.js` patch, folded into `browser-check.js`) for the old path and the pyramid's own
   integral for the new one, and says which produced each number.

### 5.7 To the B-SCENE review (its report of 2026-09-28)

Read in full. Its fixes are committed with this section (a hard drop's refusal kept per job in `PlateStore`; no
limit on a pending stroke's live path and the 15 s counted from the landing; refusals counted by reason in
`rasterStats`; `changesSince` reporting re-keys and z re-sorts; the ants' window through `placeNative`; the cover
test reading the pack's list; `undo`/`redo` in one `stage.batch`; three raster seeds in the equivalence fuzz).
Its measurements replace B-SCENE-2's where they disagree: the zoom-out pair was the sampler (§5.6 item 8; the
correction that 9b1edbb, not 18d5e2f, carries both paths); the erase bake is 36.0 s (Stage) against 34.8 s (list)
with about one whole plate re-rastered per cut step, and undo to exact 70 against 69 ms — B-SCENE-2's 1.6× and
97 vs 37 ms did not reproduce, so §5.4 Q1 stands on the per-step re-raster (the partial re-render's target), not
on a ratio.

1. **The batching major** — the three remaining per-event writers are wrapped in `stage.batch` by **B-ERASE now**
   (it is in `selection.js` and the hook): `deleteSelection`'s removal loop, the no-plane drag step's
   `setOffsetsById` loop (it goes with B-DRAG's no-writes rule; the wrapper is one line meanwhile) and
   `log.replay`. The node numbers to beat: a 5,000-native delete 487–558 ms → 42–43 ms; its undo 796–867 → 58–61;
   three drag steps × 2,000 writes 365–570 → 60–110.
2. **The post-paint sampler replaces the harness's paper sampler**, with the load average on every run:
   B-PYRAMID-2 (its brief §3.4–§3.5), on the old path; the pyramid's own integrals on the new one.
3. **Row 5's survivors outside the reviewer's files** (`sceneClient.js`, the erase contact and descent code,
   `overlays.js:454`, `erasePipeline.js:973`, `eraseDescent.js:195–204`, the memo keys, `listFor`'s stamping) are
   B-MODEL-C1's lint list (its brief §5), routed through the model or allowed with a reason.
4. **`job.ids` off the wire and `_renderPending`**: B-PYRAMID-2, as briefed.
5. **Row 2** is proved on the SVG engine by the `listFor` comparison and on the raster engine by the three seeds
   (30 × 80 steps, 0 differences, 150 holds); `listFor` itself is deleted with the SVG renderer's demotion
   (B-PYRAMID-3), after which the row's test is the raster fuzz alone.

### 5.8 To B-ERASE (its report of 2026-09-29) and to B-PYRAMID-2's checkpoints

B-ERASE landed as 5e84d43 (E1–E5 of A2 §6.2; `test:quick` 2,216 pass with 3 reds in B-PYRAMID-2's in-flight
suites, `test:erase` 303 pass, `test:slow` 502 pass; 27 rules break-checked; row 3 (b) measured: fills 0 bytes,
strokes 3–6/255 on cut outlines; the clip goldens' attribution found and fixed a per-item slot rule that hid a
family's ink above a mark). Its review is launched with this section (`review/rebuild/briefs/R-ERASE.md`).

1. **Q5 keep SM-5**: a tap after its barrier selects the piece under the finger, as SM-5 and RR-3/4 (Kobin's
   rules) require; A2 §5.5's "all the target's pieces" was the analyst's reading and is corrected in A2. A
   drag's barrier still carries the selection to every piece of its members.
2. **Q6 to B-PYRAMID-3**: the SVG renderer (`?svg` and the export) masks a pending mark's targets with the same
   rule (`eraseRule.underMask`), one implementation, instead of painting the mark as white ink at its z; and
   the export and the thumbnails run the erase barrier first, so no pending mark reaches an export at all.
   Until then `?svg` is the comparison view only, and its white ink over a dragged object is a known difference.
3. **The bake must terminate** (B-ERASE's least-sure 3: with the `handledBy` clause removed the bake hangs, and
   an inline barrier with no worker would spin if the rule were ever wrong): the reviewer adds a bound — a step
   budget per mark derived from its targets and their pieces, past which the mark's bake aborts with a report
   entry and the mark is spent — so a wrong rule fails loudly instead of hanging the page.
4. **The interim erase pool stays until B-PYRAMID-2 P6**: B-PYRAMID-2 routes cuts through the `JobQueue` at
   `PRIO.cut` with the reservation only after the B-ERASE review has ended (the orchestrator says when), since
   the review is in `eraseWorkerClient.js` first.
5. **The ~70 s engine-level delete of 5,000 selected natives** (both trees, not the Stage): the reviewer
   attributes it with a node profile and reports; it is fixed only if the fix is one line, else it is wave 3's
   batch-delete helper (§2) with the profile as its brief.
6. **The three ported probes** (`erase.stack.probe`, `erase.stuck.probe`, `paper.cost.probe`) are run by the
   reviewer once each.
7. **F65 stays open** until Kobin's browser; nothing here describes the eraser as working (CLAUDE.md).
8. **B-PYRAMID-2's P0–P2 questions**: the coarsest-source reserve is adopted (yes); the fuzz's reading of
   step (f) is right — older is allowed only where nothing fresh is cached at any level, and `olderMs` = 0 in
   the harness stays the target; `_renderPending` goes at P6.

### 5.9 To the B-ERASE review (its report of 2026-09-29)

Read in full; its fixes are committed as 5e9b1dd (the bake's step budget — 2 × supply + 8, past which the mark aborts,
is spent and reported; a round's fills promoted first so the log's order is the same inline and through workers; dead
marks pruned when a redo branch drops and `_markAlive` read from the redo stack; the old-store test with a store made by
the pre-B-ERASE engine; the parallel fuzz: 60 seeds, 42 worker deaths, 52 respawns, documents equal after every op).
Measured in headless Chromium: Kobin's drag-across case (the dragged object's own colour over the pending mark at every
step and after the drop; the bake lands with it uncut), plates kept through a bake equal to a fresh page, the barriers'
timings (a tap parks and selects in 84–126 ms, a drag's start parks 418 ms, a lasso is judged at 378 ms), the fringe
of a half-handled family within 1.5 px of the mark's edge. The eraser is not described as working; F65 stays open.

1. **Major 1, Q1 yes**: a cut or descent the watchdog took is refused over ink (`setHandledById`, a journal reason, a
   report count) instead of run inline; a job lost to a worker error is re-submitted once to the fresh pool; inline only
   when the pool is broken. It lands with **B-PYRAMID-2's P6**, which moves the cuts into the shared `JobQueue` at
   `PRIO.cut` (the queue's `requeue` is the one re-submission) — the B-ERASE review has ended, so `eraseWorkerClient.js`
   is B-PYRAMID-2's from P6 on. A refusal shows the target's ink under the mark again (A2 §5.7): an honest failure,
   never a hung tab.
2. **Major 2, Q2 yes**: a selection left up during a bake makes the bake 8–9× slower (42–48 s against 5.1 s, the main
   thread saturated: `packJob` → `prepassFor`/`famFill`/`loopBBox` 5.9 of 8.3 s, `_aimPlane` → `paintFamilies` 1.0 s;
   profile `scratchpad/r-erase/cancel-profile.json`). To B-PYRAMID-2 (P5/P6): the pack's family prepass memoised by
   family identity across steps, and the plane's pre-aim not re-run per cut step (it waits for the bake's quiet as it
   waits for the view's). The measurement to beat: the same scenario under 8 s with the 413-piece object selected.
3. **Major 3 to B-DRAG (C2)**: deleting 5,000 selected natives spends 18.7 of 25 s re-rendering the selection overlay,
   once per removed member, from the per-remove listener (`KobinEngine.js:284–317` → `_setSelection`) — O(n²). C2's
   "the selection is repaired from the op's own record, never from events" deletes that listener; until then the
   batch-delete helper clears the selection once before the removals. The profile is the brief.
4. **Q3, the sentence for Kobin** on undo under a newer mark, carried to him as the reviewer wrote it: "Undo takes the
   newest gesture first, so a pending erase is undone before an older one. Undoing both and redoing both gives you back
   the same drawing, and the newer erase cuts again. If you draw something after undoing them, both are gone for good and
   nothing they covered stays hidden."
5. **Open items**: `tools/docmaps/newdesc_engine.py` still describes done sets, `_uncutOf` and `_neutralUnder` (the
   orchestrator's final docs pass); `stage.cover.test.js:84,228` pass a dead `markDone` option (B-PYRAMID-2 P6, with the
   old layer's deletions); the deployed build drops an `attr`-set `targets` at its next snapshot — recoverable, since a
   landed mark without `targets` is registered at first sight by the old rule (§5.8), so no version gate for the erase
   fields (noted in A2 §4.9).

### 5.10 To B-MODEL-C1's checkpoints (2026-09-29)

M0 (237cd6a): the frozen oracle is the whole engine closure at 5e9b1dd, not the five model files alone — accepted (the
settle's glue lives in the engine, the selection and the Stage; a live driver over a frozen model would not be today's
engine). The spine-id load gap closed in `LevelMap.ensureId`; no file-version change (the app never writes such a
file; the deployed build loads it undrawn and writes it back unchanged). M1 (b62c2b4): the composition beside the
settle, the tile fuzz (20 seeds × 40 steps, 6,705 items bit-identical, 0 carried at M1) and the round trip
pixel-identical between the pre-C1 and M1 worktrees.

1. **Q1 keep** `displaced`'s mint of a picture's source frame for C1 (A1 §1.2 row 19): it is the one exception to §3
   row 8's "the lattice's frame set unchanged across reads" — an empty frame, GC'd — and the pure-read test asserts the
   rest; C3 revisits it when a deleted subtree leaves the lattice.
2. **Q2 no harness edit** (B-PYRAMID-2 is in it): the scenario 3 and 4 final-frame comparison through a Playwright
   script of C1's own against the pre-C1 worktree; a `--shot` flag is B-PYRAMID-2's successor's.

### 5.11 To B-PYRAMID-2 (its checkpoint report of 2026-09-29, P0–P5) — P6 goes to B-PYRAMID-2b

Read in full. P0–P5 landed (P5 as 22f4c8e). Its reference pair on one frozen tree (post-paint sampler on the old path,
the pyramid's own integrals on the new): the zoom-out's paper 304 → 4.1 ms, frames over 33 ms 61 → 9, long frames 24
(worst 7.7 s) → 4 (worst 0.7 s); the slow zoom's long frames 27 → 9; the pen-up's release 200 → 155 ms with the
picture exact at release; the drag at 33 images on both paths, the pyramid's through the surface; the bake 5.3 → 6.6 s;
the round trip identical (25,244 px, one hash). `olderMs` 0 in scenarios 1, 2, 3, 5, 6 on every run; 357–595 ms in the
drag's drop and 1.7–2.2 s in the bake, attributed to A3 §3.4's one allowed case (a stale cell whose patch fits no
level inline waits for the workers) but not verified per cell. The pack memo's thrash (wrapper keys, 10 MiB against
20 MiB of entries) was the pyramid path's main cost and is fixed (keyed by geometry, 64 MiB).

1. **Q1 yes**, `PACK_BUDGET` 64 MiB (32 on a phone); a scan-resistant memo is a wave 3 helper, not P6's.
2. **Q2 yes**: while a plane is aimed, the camera's read window grows to one view past the screen so D1's SEL cells
   are covered and asked (A3 §4.2's window is "the union of the covers of every cell the renderer will pack").
3. **Q3 split `olderMs` by cause** before judging: `olderPatchMs` (a worker patch pending for a cell that no level
   can patch inline — §3.4's case, reported and shown to Kobin) and `olderOtherMs`, which must be 0 in every
   scenario; the drop's and the bake's numbers are re-measured with the split. The undo's 299 ms against 46 ms
   (least-sure 4) is investigated with it: the inline patch (A3 §3.5's worked example) should make an undo exact
   within one frame plus its budget, so 299 ms means the estimate sent it to the workers.
4. **P6 is B-PYRAMID-2b's** (`briefs/B-PYRAMID-2b.md`): the deletion with the old path, the cuts through the queue
   with the watchdog refusal (§5.9 item 1), `_renderPending`, the TEST-MAP ports, the duplicates to one each,
   `snapshotView` through the pyramid, the open pyramid items (items 2–3 here, the attention point, `reportBusy`, a
   stale rest cell's cover through the mapped frame, the motion's break-check), the docs and OPEN-FLAGS; then the
   harness once more on a frozen tree against P5's reference table. One reviewer for P0–P6 after it.
3. **M2 (2026-09-29 05:51)**: the settle removed; the tile fuzz with shifts live is bit-identical against the oracle
   (6,336 items, 33 carried at 0 ulp); merges moved from the first read to the action's end (a pure read cannot merge
   — A1's dated note at M4). Its question: `raster.nopaper` R3 expects a merge for a frame dropped on a visited empty
   cell — **no port**: the suite is deleted by B-PYRAMID-2b's P6 with the carry, the ladder and the hold (TEST-MAP).

### 5.12 To B-MODEL-C1 (its report of 2026-09-29)

Read in full. C1 landed as 2fa7a26 (M0–M4): a frame's shift is placement composed on every read (`Document.tableOf`),
never written into a table; no read settles, carries, merges or writes; the settle machinery deleted; merges at the
action's end; newcomers cancel the shift; boxes the reach united with its shifted copy (H6 closed by the box union,
measured by `model.compose`); old stores replay through `legacy/modelV1.js` (delete on or after 2026-12-31); version 3
only with a non-zero shift; the `.below` lint. Measured: the tile fuzz bit-identical to the frozen oracle (20 seeds ×
40 ops, 6,336 items, the 33 carried ones at 0 ulp); the selection fuzz equal (135 selections); pure reads leave
`rev`/`offRev`/`addrEpoch`/the natives/the lattice unchanged (the one named exception minted 77 empty frames); a
20-event drag of a 300-native frame from 1 settle and 300–600 table writes per event to 0 and 0; scenarios 3 and 4
pixel-identical on ink against the pre-C1 tree. Its review is launched with this section (`briefs/R-MODEL-C1.md`).

1. **Q1, Q2 to B-PYRAMID-2b's item 5**: the hook's saver comment "Reading a frame for its snapshot settles a pending
   shift" (now false) and its redundant second drain; `rasterPack.js`'s line naming the deleted `TileStore.ownContent`.
2. **Q3 the ants' dash phase after a lasso and drag** (29–50k px differ on the ants only, the same outline): the
   reviewer traces it first — if the selection's piece set differs between the trees it is a C1 defect; if only the
   outline's segment order it is cosmetic and goes to B-DRAG (C2), which rewrites the drag.
3. **The fuzz's two relaxations** (least-sure 2: above a native's home only the square's interior is compared, and a
   native that diverges after a carry is counted, not failed): the reviewer establishes the picture at a square's
   edge above the home by the composition's own arithmetic (the oracle read the unshifted window there and is the
   wrong side), and turns the count into an assertion or a named, measured exception.
4. **The SVG path's drag** (least-sure 3, the pre-C1 page crashed): the reviewer runs scenario 4 on `?svg` on the
   current tree alone; a crash there is a finding.
5. **Test names that still say settle** (`hooks/store.subtree.test.js`'s `settleAll`, `sceneIndex.test.js`'s "a settle
   is a no-op"): the reviewer renames them to what they now assert.
6. F94, F100, F107, F108, F126 stay open for C2–C4 as noted; the legacy module's deletion date is in its header.

### 5.13 To B-PYRAMID-2b (its report of 2026-09-29, P6) — the B-PYRAMID review follows

P6 landed as ac9a7e1: the old picture path deleted (the quick suite 2,118 pass, 0 fail on the pyramid-only tree), the
cuts through the one queue with the watchdog refusal, six of the seven open pyramid items built, the undo's delay
attributed (the patch's estimate 34–41 ms against a 6 ms budget with the chords at the 20,001 cap, no coarser level
fitting, and the main thread packing prefetch strips at 171–480 ms each while still), the docs corrected. Three
things are open and go to the review of the whole B-PYRAMID build (`briefs/R-PYRAMID.md`):

1. **`olderOtherMs` is not 0** (scenario 7: 853–869 ms; the fuzz: 88–91 plans drawing a stale coarser stand-in with no
   patch pending, 5 plans with no rest set). The rest set becomes a stand-in source after a zoom (§5.11's answer,
   restated in the review brief) — the reviewer builds it, since it is the never-older invariant's fix and local to
   the plan's lookup and the store's discard rule, asserts `olderOtherMs` = 0 in the fuzz, and finds the cause of the
   five plans that remain without a rest set.
2. **Packs on the main thread at rest** (171–480 ms per strip): a per-task pack budget at rest as while moving (the
   4 ms per frame becomes a per-task budget with the rest of the strip in the next task) — the reviewer, bounded;
   packing off the main thread is a wave 3 item (§2), not now.
3. **The zoom-out's paper** (0–4.6 ms on P5's tree, 37–150 on P6's, same day): bisected between 22f4c8e and 15b3738
   on a quiet machine, three runs each, by the reviewer; the cause fixed or named.
4. **The undo never inline on dense cells**: the estimate's chords are capped at 20,001 so it cannot discriminate; the
   reviewer re-derives the estimate's inputs clipped to the patch's cells and raises the inline budget for a
   user-initiated patch (undo, redo, pen-up) to one frame's worth, 16 ms — a single action, not a per-frame cost — and
   measures the undo's key-to-exact time against P6's 215–554 ms.
5. **The small open items** to the reviewer: `rasterPack`'s dead `q` memo key; a released orphan worker slot that
   pumps no queue; an aborted snapshot's strip left queued until dispatch; the prefetch's tile reads inside a camera
   step unbucketed (a 319 ms camera row); the one stale comment naming `_maybePrebake` (`TileStore.js:222`, with the
   ladder comments at lines 82, 217–225, 335 and `reroute.memo.test.js:46` — the C1 reviewer's files, sent to it).
6. **Wave 3**: `raster-worker.js` at 431 KB parsed by each of four workers (the erase geometry moved in with the cut
   kind); packing off the main thread; `tools/docmaps/newdesc_raster1–4` for the pyramid's modules.

### 5.14 To the B-MODEL-C1 review (its report of 2026-09-29)

Read in full; its fixes are committed as 930365c. The one major, found by running the tile fuzz past C1's 20 seeds and
fixed on the orchestrator's instruction, predates C1: `TileStore.forgetFrame` dropped only the forgotten frame's own
reroute memo, so another view's memo could keep a key a later mint restored and a moved object's ink went missing
from that view (6 of 8,000 live renders; the oracle has the same fault). The fuzz now matches frames and homes by
place and compares the whole square: 200 seeds, 55,896 items, every one bit-identical or within one ulp where the
old model carried it. The ants' difference after a drag was the crawl clock, not C1's; the `?svg` crash under a
drag on the dense scene is the SVG renderer's (about 57 MB retained per drag event, both trees).

1. **`warmReads`, `_warm`, `clearWarm` and `listFor`'s off-camera branch** have no production caller since P6:
   B-PYRAMID-3 measures the prefetch's tile reads on the crossing scenario with the warm on and off (F83's reason
   for keeping it) and deletes them with `listFor` if the numbers do not need them (§5.7 item 5).
2. **The Stage's `_home` read** (`Stage.js:1261`, forbidden by A1 §6) becomes `placementModel.homeOf` in B-DRAG,
   which rewrites the Stage's drag paths; the box united with its shifted copy, written three times (`reachBox`,
   `frameFootprint`, `overlays._selTable`), becomes one helper there too; `_endMove`'s merge without an op record on
   a non-drop exit (a cancel) is B-DRAG's to pin with a test (C2: membership changes only at the action's end).
3. **The SVG path's retention** (57 MB per drag event; the tab crashes on the dense scene at the third event) is
   filed as a renderer flag by B-PYRAMID-3 (grep OPEN-FLAGS first) and fixed or bounded in the demotion.
4. **`eraseDescent.ownIn` and `Document.ownFor`** become one helper when C4 moves cedes into private frames.
5. **Amendment to item 1 (B-PYRAMID-3's measurement, 16:09)**: the warm reads stay and every prefetch snapshot read
   is wired as warm — on the dense drawing's zoom-out and back, the back-in re-bakes halve (19–22 → 9–10 tiles,
   11.6–12.9 → 3.5–4.9 s of main-thread bakes) with the LRU cap still bounding the cache; the plan-time clearing (the
   ladder's rule) measured no different from off and goes. The remaining main-thread bakes are the resumable bake
   cursor's, a wave 3 item. `listFor` and `_buildList` go as planned.

### 5.15 To the B-PYRAMID review (its report of 2026-09-29, P0–P6)

Read in full; landed as c7fed1a. Built with leave: the rest set kept as a stand-in after a zoom (older plans in the
never-older fuzz from 79 of 121 to 24–87 of 113–176, every one left after a crossing with nothing fresh at any level and
its tiles unread or its view job in flight; `other` asserted 0); the pack budget per task at rest; the undo's estimate
clipped to the patch with 16 ms for a user's action (key-to-exact 203–348 ms against P6's 334 | 983, the longest task
156–293 against 352 | 310, older 0). Two more defects found and fixed: a snapshot's strip queued as a copy leaked a
worker slot per thumbnail for the session (two thumbnails on three workers stopped the prefetch for good), and a strip
dropped at dispatch cleared every pending ask. The zoom-out A/B settled: no regression between P5's and P6's trees
(load spread and a 20 s harness settle on P6's trees, fixed). The final table is in its 19:59 entry and its report.

1. **Proposal 6 yes** — the patch step runs in the commit's task (beside `_pyrLive`), not at the next render the bake
   schedules ≤ 100 ms later; scenario 7's `olderOtherMs` (1.3–1.4 s: stale own plates with no patch asked) is the
   number to bring down. **Proposal 7 yes** — the pack priced in the estimate and the prepass kept across commits
   (the inline render's pack at 89 ms is why the undo goes coarse-first on the dense scene). **Proposal 8**: the (f′)
   last resort after a crossing split into its own integral (`olderUnreadMs`) and measured first; a budgeted read of
   those cells' tiles at the crossing's step is decided from the number. All three and the reviewer's "pending path
   at a crossing" (a short "neither" while the path comes down before its plates land) go to **B-PYRAMID-4**, a
   small builder after B-PYRAMID-3 lands (they share `RasterRenderer.js` and `PicturePyramid.js`).
2. **A drop gets `patchUserMs` like an undo** (one action): B-DRAG's D2, one `noteUserEdit` line at the drop.
3. The two inline defect fixes are accepted as landed. H1, H4, D1, D-3 and D272 are review-document rows, not
   OPEN-FLAGS entries: the final docs pass marks them closed where they live, with the review's numbers.
4. Wave 3: packing off the main thread (items 2 and 7 both point at it).

### 5.16 Kobin, 2026-09-29: C3 and C4 as one build

"Can you have just one agent do both C3 and C4, instead of splitting it into two agents? And then one reviewer for the
combined implementation?" — Yes. §2's wave 3 becomes: B-DRAG (with C2) and its review, then **B-MODEL-C34** (one
builder: C3 co-residents, no merges, a deleted subtree leaving the lattice, `displaced`'s read-time mint revisited;
C4 private frames for cede kids, `ownIn`/`ownFor` as one helper) and **one reviewer** for both. Its brief is written
when B-DRAG reports, so that B-DRAG's open items are in it.

### 5.17 To B-PYRAMID-3 (its report of 2026-09-29)

Landed as b793360 (items 1–5): both renderers draw the Stage's items; `SvgLayer`, `LiveStrokeLayer`, `svgOverlay` and
`svgAnchors` each one implementation; `RasterRenderer` extends nothing (one layers list); a held path carried across a
crossing; every prefetch read warm; `listFor`, `_buildList` and the old tile reads deleted (the brute-force list lives
in `__oracles__/renderList.js`); a pending mark masked by the erase rule in the SVG renderer; the export barrier;
F133's retention fixed (memory flat over 40 drag events). Measured: the `?svg` round trip 0 px in 9 of 9 states, the
raster ink hashes identical, the raster screenshots 0 px once the live stroke's hold state is matched; the back-in
re-bakes 8 against 19–22 with the warm reads.

1. **Q1**: `Stage.js:97`'s mention of `listFor` is B-DRAG's to reword (it owns `Stage.js`) to the oracle's `renderList`.
2. **Q2**: `tools/docmaps` (still listing `listFor`, `content`, `contentOffCamera`; lacking the four new modules) is the
   orchestrator's final docs pass, with `newdesc_raster1–4` (§5.13 item 6).
3. **Q3**: `MovePlane.aim`/`paintFamilies`' dead `live` argument is B-PYRAMID-4's to delete.
4. **The possible double alpha at the "drawn" shot** (53,919 px in 3 of 4 runs, both trees, unconfirmed) is checked by
   B-PYRAMID-4 with a state log while it fixes F135: if the path and the plates are both shown for a frame it is the
   pen-up rule's never-both, and the fix goes with F135's.
5. Not verified in Kobin's Chrome: F133, the mask rule, the crossing carry, the warm reads — on the final check's list.

### 5.18 To B-PYRAMID-4 (its question of 2026-09-30 01:22: the clip cull)

Its measurement: the undo's inline pack is 45–64 ms on scenario 6, of which the copy is 21–29 ms because a clipped job
keeps every item of its two whole cells (764 items, 31.5 MB) although its clips are the undone stroke's dirt, and the
prepass 18–33 ms because the family fill never matched a prefetch snapshot's re-wrapped items (rule 2's records by
geometry fix that). It asks to build the clip cull here. **Yes, build it here**, as the pack's existing cull narrowed:
a clipped job's per-plate cull tests an item's box against the plate ∩ its clips instead of the plate (the binner's
filing), with the same edge margin the plate cull uses (an item ending inside the clip's edge pixel is filed). The
union routing and the union sign stay taken over every item of the family, as they are now: the cull already runs
after the families are grouped, so nothing about a family changes with the clip. It is exact by the plate cull's own
argument: a patch's pixels are its clip's, a plate's pixels outside the clip come from the record the patch merges into
(A3 §3.2), and a mark whose box misses the clip masks nothing inside it. Conditions:

1. The plates byte-equal to a whole render (the existing test) with the cull on, plus a fuzz over random clips and
   lists — families, translucent ink, thin strokes at a coarse Zq, marks and their targets on both sides of a clip's
   edge, an item ending inside the edge pixel: the culled clipped pack's plates equal the unculled clipped pack's inside
   the clip, byte for byte.
2. Break-checks: the margin removed (red); a mark culled while a target it masks is kept although the mark's box meets
   the clip (red).
3. Measured on scenario 6: the copy ms before and after, the undo's T against 16 ms, and whether the undo's patch is
   now inline and exact rather than coarse-first at ℓ − 1.
4. Clipped jobs only; a whole-cell job's cull stays as it is. `rasterPack.js` is a bundle input: the bundles rebuilt.
5. Rule 2's records keyed by geometry per zoom/dpr/cfg/offset, rebuilt when the entry, fade, z, family, erase flag or
   `res` changed, shared by the camera's and a snapshot's lists: as decided; the entry says what bounds the record set
   (evicted with the memo's entry under F77's budget, or otherwise) with a number after scenarios 1, 4 and 6.

`stage.cover` C4 red in its run at load 5–7 and green alone 5/5 is not B-PYRAMID-4's: it goes to the B-PYRAMID-3/4
reviewer (make it deterministic as LH-1 was, or say why it is load-only). The section numbers move: B-DRAG's report is
answered in §5.19, B-PYRAMID-4's in §5.20 (the briefs updated).

### 5.19 To B-DRAG (its report of 2026-09-30)

Read in full; landed with this section (D1–D4). A drag writes nothing until its drop: the Stage's hold carries δ
(`setDragDelta`; `placed`/`placeNative` at +δ for inputs, `Item.res` for paint while the view draws the hold, the release
dirtying where the view drew them); the drop once (`_dropMove`: the arithmetic once per (home, picture table) on the
composed table, the subtree re-addressed once; the write, the hold's release and the merges one batch, one undo entry,
then `noteUserEdit`); the selection repaired from the op (`_opUnder` before, `_repairSelection` after) at a drop, an
undo or a redo; `_normalizeHome`, `_homeShift`, `_restoreFrames`, `_keepingSelection`, the `_moving` capture and the
per-remove listener deleted; `deleteSelection` reads the families first and removes in one batch. F136 found (400 of
1,250 natives a cell off after a long subtree drag at seed 777) and gone with the per-event writes. Measured: 0 writes,
re-homes, mints and settles per event over 40 events; frames minted during a drag 211/145/239 → 0/0/0; scenario 4's
ink 0 px different after the drop against d206cd3, the drag event median 1.2–1.7 → 0.7–0.8 ms, the first event 64–83
→ 27–33 ms, the drop 1.7–2.0 → 1.5–1.9 s; the 5,000-native delete 532–585 s → 0.53 s raster and 1.3–1.5 s SVG; the
quick suite 2,169 passed, 0 failed; 17 break-checks red. Nothing in Kobin's Chrome.

1. **"Moved into"** (Kobin's §5.2 Q1): built literally — a per-object member joins the frame of the cell it lands in;
   a carried kid goes under the root's lattice neighbour at the drop. Kept; the final summary shows Kobin scenario 4's
   kid "1/-1,1" and asks once; R-DRAG item 4 writes the plain-words answer.
2. **The second parent pointer** (Q2): not built. B-DRAG's three lines — a `container` beside `parent`, set where
   `readdressMany` re-parents a kid away from its root; the walks (`isUnder`, `walk`, `_subtreeCount`,
   `removeFrameSubtree`, the GC) reading it first; the op's frame entries recording it — are here for Kobin's decision.
   The op repair already keeps a re-parented subtree selected, which is what the pointer was for; the final summary
   puts it to him.
3. **The inkless rule after an undo or a redo** stands as DESIGN §10 says (a frame left with no ink leaves the
   selection; the oracle and d206cd3 kept it; a redo does not restore it): user-visible, on the final check's list for
   Kobin; R-DRAG item 4 checks it against §10's words.
4. **The drop's patch** (an estimate of 437–555 ms, over both budgets, so `noteUserEdit` changes nothing there):
   R-PYRAMID-34 §2 attributes the drop's render by part; R-DRAG item 2 times the drop with and without
   `TileStore.setBatch` around its writes (unmeasured) and keeps or deletes the wrap on the number.
5. **Dead ids after a remote edit** (leastSure 1): a sync's removal reaches the selection through no repair now.
   B-MODEL-C34 (C4's sync) repairs a remote op like a local one, with a test; its brief says so.
6. **RV4** load-sensitive on both trees and **seed 777's** 5 frames after GC against 4: R-DRAG (deterministic or why;
   the one-frame difference traced).
7. **`supportsDragPlane`**, read only by `raster.pyramid.test.js:59` and the oracle now: B-PYRAMID-4 deletes the getter
   and the assertion (told). **`ownIn`** in `eraseDescent.js` duplicating `Document.ownFor`: R-DRAG, a minor under
   rule 3 if identical. Empty leaf containers left by `_dragFramesStart`: as before, F94's GC after the drop.
8. The C3/C4 items (the `mergeFrame` hand-over, I4, F126's follow, F107, F100, F108): in B-MODEL-C34's brief.

### 5.20 To B-PYRAMID-4 (its report of 2026-09-30)

Read in full; landed as fea473e (its end entry has the table). The five rules are in, each red-before and break-checked
(18 of 18 red on the final tree): the patch step in the commit's task (`noteCommit`, run by the next compose or camera
step, else a microtask); the pack priced (`packItemUs`/`packListUs`, calibrated from every pack) and the prepass's
records kept by geometry with the placement seen through `res` by value; the clip cull (§5.18); F134 (`_aim` within two
levels of the view's and never under `ownFloor`; the −19 plate's 2.6–2.9 s and 1.5 GB gone); F135 as the overlap merge
(3,050–3,083 ms with 12 doubled composes → 41–63 ms with 0; never-both holds for each path of a joined group, the round
trip 0 both-composes in both trees); `olderUnreadMs` split out. The dead `live` arguments and `supportsDragPlane`
deleted. Measured after against before (load 1.9–4.4): scenario 4's drag olderPatch 1,040 | 937 → 567 | 575 ms and its
worst task 2,068 | 1,851 → 1,177 | 1,158; scenario 7's olderOther 1,370 | 1,573 → 254 | 78 (not 0), its bake 6.7 s |
stalled → 7.6 | 5.5 s; the jsdom fuzz's olderOther 178.6 → 0. **Two regressions reported, not fixed (my bound):**
scenario 1's back-in paper 0 | 0 → 88 | 765 ms (F137, unbisected), and scenario 6's undo — priced, ℓ − 1 no longer
fits 16 ms (T 31.7 | 26.8), so the undo goes to the workers and the coarse search measures every level (246–278 ms of
`eng.view`): key-to-exact 260 | 819 → 874 | 319 ms. Scenario 5 has no valid numbers (the harness polled a field gone
since bcba05a; fixed, not run). Nothing in Kobin's Chrome.

1. **F137 is the reviewer's first item, with leave to fix:** bisect by rule on frozen copies (the aim's clamp in
   `jobQueue.js` first, then the records, then the commit-task patch step), scenario 1's back-in paper back to 0.
2. **The undo:** Q3 yes — the coarse search stops at the first level with no records (leave to build). And the budget:
   an honest price must not make the feel worse than the unpriced path it replaced (a change on screen in one ~60 ms
   task against 300–870 ms of nothing): for a user's action (undo, redo, a drop) the coarse-first path is admitted when
   its priced T is within three frames, 48 ms, one action, not a per-frame cost; `patchInlineMs` for the bake's patches
   stays 6. The reviewer sets it, then measures the undo's first change and key-to-exact against the review's 203–348.
3. **Q1 no** (a budgeted read at the crossing's step): the 16 unread cells drew fresh stand-ins (`olderUnreadMs` 0) and
   their tiles baked in 536 | 549 ms by the reads that covered them at 29–36 ms a tile; a read at the step costs at
   least one tile. Closed.
4. **Q2 yes**, (f′) waiting on its own job is `olderPatchMs` — and scenario 7's residual `olderOther` (254 | 78; the
   builder suspects uncovered stale own plates that `_patchStep` skips and `_older` does not classify) is the reviewer's
   to classify or fix: no stale draw hides under a name.
5. **Q4 leave `Stage.covers`** (O(tiles); `_aim` is bounded now).
6. **The record set's bound** (8 keys × the last list, 20,974 records after scenario 1, 9,264 after 4 and 6): accepted;
   the reviewer's item 8 checks the moved item's `res` in the key and the byte-equal plates with the memo warm.
7. **The doubling** (PLAN §5.17 item 4): not path-and-plates in four round trips (0 both-composes, nothing held at
   "drawn"); off the pen-up rule's account; the final check looks once in Kobin's Chrome (translucent ink at the shot).
8. **Scenario 5** with the harness fix: the reviewer's one run. The `stage.cover` C4 flake and item 11b's stall
   (pre-existing; the bake finished in both after runs): the reviewer's, short.

### 5.21 To the R-DRAG review (its report of 2026-09-30, scope narrowed at 02:41 per Kobin)

Read in full; landed as ce6f397. **The major, fixed with leave:** a drop of a selected frame R plus a per-object member
X homed in R's neighbour moved X twice (38.4 px for a 19.2 px drop; 89.6 for 44.8; a deeper member 70.4 for 35.2):
`_dropMove` re-homed the members into R against the press lattice, then re-addressed R, which carried X again — DESIGN
§8's registration broken. Now the frames are re-addressed first and the member loop runs against the lattice they
left, the arithmetic still once per (home, picture table); `move.drop` D2b (three cases, each member at +δ to 1e-9,
undo and redo exact) red on 8f9c073, green now. d206cd3 had a different defect there (24 px for 19.2, its last event
only). Minors fixed: the oracle harness follows DESIGN §10 after an undo or redo and cancels the oracle's drag before a
deselect, tool change or delete mid-drag (seeds 126 and 43 pinned; the frozen oracle module untouched); F136's walk
runnable on d206cd3 (red there at 400 of 1,250, green now). Added: `move.hold.probe.js` (42 drags, 291 events, hit
tests, lasso finds, resizes and crossings interleaved, all eight exits: the document byte-equal at every event, every
held native at +δ); D3 over a tool change and a redo mid-drag. Skipped per the scope: Chromium (B-PYRAMID-4's batch was
running), the `setBatch` timing, items 5 and 7, RV4's and seed 777's traces. Nothing in Kobin's Chrome.

1. **F80 on the mixed drop's undo** (X landing in R's vacated cell mints a frame there; an undo merges R into it when
   it kept an emptied kid; the picture exact, the redo byte-exact): B-MODEL-C34's, with the co-residents (its brief).
2. **The harness rule** (leastSure 2: the pair fuzz can no longer catch a live defect of those shapes): accepted;
   `select.inkless` and D3 carry them, and the final summary says so.
3. **Kobin's answers, in the reviewer's words** (for the final summary): *"Moved into"* — loose objects you drag
   belong, after the drop, to the frame of the place they land, as if drawn there; if a dragged frame has moved into
   that place they join it, if a dragged frame left it a new frame is made there; a dragged frame keeps its contents;
   if it lands where another frame already has ink its contents merge into that frame (until C3); a sub-frame the move
   pushes across a cell edge becomes a child of the neighbouring frame and stays selected. Kept. *The second parent
   pointer* — not built; it would keep a dragged frame's sub-frames its own for good, not only for the current
   selection; B-DRAG's three lines miss two readers and a file header field (`subtreeStart`, the lasso's enclosed-frame
   mapping, the format). Recommendation: not unless Kobin wants groups that persist after deselecting.
4. **On Kobin's check list** (user-visible, per DESIGN §10/§8): an undo that empties a selected frame deselects it and
   a redo does not bring it back; undoing the cut of a selected piece selects the restored whole stroke; a deselect or
   tool change mid-drag puts the drag back where it started.
5. **Routed:** the remote removal's dead id → B-MODEL-C34 (its brief); RV4 (`raster.move`, load-sensitive) → the
   B-PYRAMID-3/4 reviewer, one line; the drop's render → the same reviewer's §2 (already); seed 777's 5 frames after
   GC against the oracle's 5 (live ≤ oracle holds) → a note in the final summary; `ownIn` (the same arithmetic as
   `Document.ownFor`, worker-side, T uncloned) and the drop's `setBatch` wrap → the final pass's list, not built now.

### 5.22 To the R-PYRAMID-34 review (its report of 2026-09-30; scoped, bounded after the 03:39 stop)

Read in full; landed as 1b95eb2. **Built with leave:** the coarse search stops at the first level with no records; a
user's action (undo, redo, a drop) admits its coarse level within 3 × `patchUserMs` = 48 ms; a pen-up's group searches
no level (it measured the levels and discarded the plan); two red-before tests. Scenario 6 on the final tree: the full
patch's T 74, ℓ − 1's 41 admitted after one level measured, its clipped pack inline in 56.7 ms, the change on screen in
the commit's task (polled at 194 ms), exact at 432 ms (B-PYRAMID-4: 874 | 319; the B-PYRAMID review: 203–348 — under a
builder's jest, once). Scenario 7's residual `olderOther` 62.5 ms (was 254 | 78): 28 composes of covered stale own
plates in no group and never asked; an uncovered stale own plate is now charged as unread (red-before 1). Never-both
holds on the final tree (3 holds, 3 handoffs, 0 both-composes; the crossing carry's break-check 2 red). Scenario 5's
release 98 ms, exact 105. Typecheck 0, lint 0 on its files, 192/192 in 11 raster files; the quick suite not run. Nothing
in Kobin's Chrome. **F137 stays open, bisected and not attributed:** every before-based run 0 (3), 13 of 14 after-based
runs show paper; no single rule reverted removes it (the table is in OPEN-FLAGS F137); untested: `RasterRenderer.js`'s
own changes (`_pyrPack`'s calibration and clips, `_pyrMeasure`'s kept count) and combinations.

1. **The final tree's scenario 1** (out 2,157–2,583, back in 1,104–1,257 ms, no patch and no older draw): the
   `eng.list` rows are 995–1,175 ms against 492–781 on B-PYRAMID-4's copy — the model files changed since (B-MODEL-C34
   in progress). Sent to B-MODEL-C34 to profile and fix inside its build, both numbers in its entry.
2. **The reviewer's question — a full-resolution patch whose T ≤ 48 ms preferred to coarse-first for a user's action:
   yes** (when both fit, exact beats coarse: the user's budget is 48 ms for either path). Not built — Kobin's stop; a
   next step, one threshold.
3. **Proposed, not verified, next steps:** the `unask` G check (an older dropped strip erasing a newer patch's ask —
   the candidate for the 28 never-asked composes); the hidden tab's commit step (return while hidden, the next compose
   runs it); RV4 (`cfg.patchUserMs = 1e9` in the test) and `stage.cover` C4 (stub the idle read's clock); the
   `RasterRenderer.js` half of F137's bisect.
4. **The drop's render on the dense scene** (2.2 s = the overlay's tail 1.16 s + the list 0.67 s + the view 0.2 s; the
   patch goes to the workers): the overlay's decision after a drop is the largest part — a next step for the overlays
   (re-decide only the moved pieces), not the pyramid's.
5. **Scenario 7's 6 both-composes** (the erase's held path; pre-existing, intermittent, in B-PYRAMID-4's before run too):
   on Kobin's check list — whether it is visible.
6. **Not measured this pass** (the scope): F133's memory, the `?svg` round trips, F134/F135's jsdom timings, the bundle
   md5s — B-PYRAMID-3's and 4's own measurements stand; on the final check's list.

### 5.23 B-MODEL-C34 (C3 and C4): landed by the orchestrator after the builder's weekly-limit stop (2026-10-04)

The builder stopped at 07:21 UTC on 2026-09-30 (the weekly limit) with C3a and C3b entered, C3c and C4 built but not
entered, the docs partly done and no report. Its last 27 minutes of edits were uncommitted in the container (on no
branch: the remote had nothing newer than 3662169) and are snapshot b750633. Per Kobin (stop when C3 and C4 land, no
more reviewers) the orchestrator landed it, without a review:

1. **Tests that read one frame.** C4 homes a cede's kid in a private co-resident of the crossing's cell; 21 cede tests
   (`erase.cede`, `erase.depth`, `erase.curve.depth`, `KobinEngine.edit`, `erase.severance.slow` V-3) read the kid
   from one frame's list. Ported to `Document.cellList`, every assertion unchanged; F42 maps a kid to its cell's
   resident; F46 reads a frame's depth from the lattice (a co-resident's id carries `#n`).
2. **The F108 city lasso** was drawn inside the cells' reach boxes, so the edge cells were read object by object by the
   enclosure rule, not by C4; sized to the reach boxes it measures 16 frames and 0 ids (the oracle 48 ids).
3. **`raster.pyramid`'s F119 test** raced the velocity re-aim, which reads wall-clock frame times and dropped the zoom's
   strips as offscreen: 1 run in 3 on 1b95eb2, 6 in 7 once C3 checked the camera at every render. The re-aim is stubbed
   in that test; 3 of 3 green.
4. **Break-checks**, one rule at a time on an unimported copy: all nine red; three needed a test first (kids linked
   four levels below a join; severance by cell for a private frame; the version-3 clause for a private frame alone).
5. The worker bundle rebuilt (the descent changed; raster a949be55…, 434,437 B); the builder's six scratch probes
   deleted; A1 §16, PLAN §1.7, TEST-MAP, OPEN-FLAGS F94/F108 filled with numbers.
6. **Measured**: the quick suite 2,186 passed, 0 failed, 12 skipped; `test:erase` 303 passed, 1 skipped (after V-3's
   port); typecheck 0; lint 0 errors (5 warnings, none in these files); the hold fuzz green; the city lasso and the
   census as A1 §16 says; headless Chromium against the tree before C3/C4 with the same raster code: scenario 1 no
   worse (paper 173 | 264 → 100 | 0 ms), scenarios 3 and 4 no paper and no stale draw, the round trip's ink identical.
   The list build the R-PYRAMID-34 review saw doubled (PLAN §5.22 item 1) is not doubled on the landed tree in the
   browser; in jsdom the raster path's tile bakes are 10–25 % slower.
7. **Not clean — OPEN-FLAGS F138**: the tile fuzz at 200 + 200 seeds finds 11 walks where a native is drawn
   differently from the oracle (3 new with C3c/C4, 8 already on the C3b tree, never run there at that size), and the
   selection fuzz one of C3b's age. One traced (seed 131: a store reload replays an undone cede under a private frame
   id GC freed and a later frame took; the resurrection of the undone native is older than C3 — the oracle does it
   too). C3 and C4 are in the tree and their tests pass; they are not done until F138 is classified and fixed. That
   is the next model pass.
8. **On Kobin's check list** (user-visible): a frame dropped where another holds ink stays itself, a co-resident,
   never merged; a lasso over ink a cede tore takes the frames whole, not the pieces; an undo of a subtree delete can
   put the subtree back beside new ink in its cell; a camera left in a deleted frame moves to a fresh frame there.

### 5.24 Kobin, 2026-10-04: "go ahead onto the reviews and fixes"

Two agents side by side, files disjoint: **R-MODEL-C34** (`briefs/R-MODEL-C34.md`, opus-reviewer) — F138's twelve fuzz
differences classified and fixed, then a short review of C3/C4; **B-PYRAMID-5** (`briefs/B-PYRAMID-5.md`, opus-builder)
— PLAN §5.22's next steps (exact over coarse when both fit 48 ms, the `unask` G check, the hidden tab's commit step,
RV4 and `stage.cover` C4 made deterministic), F137 established as real or not before more bisecting, the overlay's tail
after a drop measured and proposed. After both land: the final full-design check (the harness on every scenario, the
docmaps, the review-document rows, `docs/ai/10-STATUS.txt`, the summary for Kobin).
