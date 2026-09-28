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
  headless Chromium too (A3 E6: 0.1 → 26 ms), so the harness gates it.
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
- **Cache**: LRU by bytes; pinned = the drawn set plus the plane (≤ one view + 40 plates by
  construction, H1 closed); protected = ℓv's ring, the rest set, ℓv − 1, ℓv − 2, the frame just left,
  the far levels; default budget 3 views (120 MiB) desktop and 2 views (70 MiB) phone under a
  256 / 96 MiB ceiling; views and ceiling on the Dev panel; levers persist in localStorage with a URL
  override, never in the canvas record.
- **Input** is coalesced in the engine: events move the camera at once and request a frame; one
  `requestAnimationFrame` step renders, plans, posts, triggers the rest render and emits; `cfg.frames =
  "raf" | "sync"` and `engine.flush()` for the suites and the harness. The scale HUD gets its own
  `engine.onZoom` subscription so the editor page stops re-rendering per wheel event (R25 W1).
- **Scheduling** (A3 §4.4): typed jobs with a required priority (rest 0 > view 1 > plane 2 > cuts 3 with
  one worker reserved while any are pending > prefetch 4 > thumbnails 5); cells sorted by distance from
  the attention point and dealt round-robin across strips; a per-frame pack budget (4 ms) while
  moving; a job aimed at where the camera will be on arrival; cancellation by purpose generation.

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
  serial order until no pair is left; the selection follows the cuts to the pieces; the tab stays
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
  boxes dirtied; the plane holds per cell until the fresh plates land, as now.

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
- **C2 — membership changes only at the end of a user action.** No document writes during a drag; at
  the drop a per-object member is re-homed once and a subtree re-addressed once (the 183–290 frames a
  40-step drag mints become the final 8–13); `_normalizeHome` goes; the selection is repaired from the
  op's own record, never from events. "An object belongs to the frame it was drawn or moved into."
- **C3 — a frame keeps its identity.** No merges: a frame landing on an occupied cell is a permanent
  co-resident; lookups and every by-cell reader see co-residents; each co-resident is its own
  selection unit; the camera is handed to the resident at the re-address; GC promotes; a deleted
  subtree leaves the lattice (F107's revival sets go).
- **C4 — a cede's kids live in private frames of their object.** The lasso never takes a private frame
  whole and every other frame keeps the O(1) enclosed rule with no family pass; F108's 17,007-id torn
  walk goes for new content (legacy kids keep the backstop rule). Severance compares cells.

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
| a selection stands for the same ink through drags, undo, redo and cuts, with no event chasing | the selection fuzz against the frozen model oracle (A1 §5 check 2): the selection's ink equals the oracle's and the ink it was made with, mapped through cuts to pieces; no inkless frame |
| no read changes the document | `rev`, `offRev`, `addrEpoch` and the lattice's frame set unchanged across `listFor`, `content`, a lasso, a hit test, a pack and a snapshot, over the fuzz's states |
| every derived tile piece is bit-identical to the frozen model's | the tile fuzz (A1 §5 check 1) over random op sequences, at and below the home to the bit, one ulp above it |
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
