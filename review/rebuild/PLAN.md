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

### 1.1 The scene: one object between the document and the renderer (§3.2, R25 §4.2, §4.10, §10.1, §10.5)

- `Scene` subscribes to the document and keeps, per camera frame, an **item table** sorted by z:
  the frame's own natives, the visible tiles' pieces (TileStore already patches those in place),
  and the re-routed moved objects. An item carries id, z (read from the object, not copied at
  derive time: R25 H8), kind, a geometry reference, its box, its residual, its family key, the
  erase data of §1.3, and `held` during a drag.
- Document events update the table incrementally; a full rebuild only on a crossing or a change
  of the visible tile range.
- **Generation.** Every change to the table increments `G`. An item update dirties the plate
  cells over old box ∪ new box at every level of the frame; each cell records `dirtySince = G`.
- **Freshness is one comparison.** A job carries the `G` it was packed from; a stored plate
  carries its `G`; a result replaces the stored plate iff its `G` is newer; a plate is exact iff
  `plate.G ≥ cell.dirtySince`, otherwise it is a stand-in.
- **`placed(item)`** is the one accessor for an item's geometry as drawn (or the numeric offset
  the worker applies). The pack, the hit test, the ants, the lasso and the erase read through it.
- Deleted by this: per-key epochs and their five drop kinds, quantum strings and frame
  sequences, the four request records, `_footBelow` and `_drawnRectIn`, ids per plate,
  `noteListMarks`/done snapshots, neutral event tags, `_uncut`, `_eraseListStale`,
  `_renderSoon`'s skip rule, the list rebuild per erase step, `listFor`'s per-item document
  lookups. `listFor` stays only for the SVG renderer and the comparison until the SVG renderer's
  own step; the scene's items equal `listFor`'s sorted output, checked by a fuzz.

### 1.2 Plates: a picture pyramid with a level step (§3.3, R25 §4.1, §4.3, §4.8, §6.5, §8)

- Plates keyed `(frame, level, i, j)`, level an integer; `LEVEL_STEP` doublings per level (1 by
  default; 2 and 3 selectable on the Dev panel; the cross-frame mapping needs `LEVEL_STEP` to
  divide 12). At zoom Z the view draws from the nearest level, stretched between `2^-(s/2)` and
  `2^(s/2)`.
- **Compose is a lookup per screen cell**: the fresh plate at the view's level; else its stale
  one; else the parent cell's plate up to N levels coarser; else the children one level finer;
  else paper. Across a frame crossing the parent frame's level `L − 12/LEVEL_STEP` is the same
  picture, by integer arithmetic (R = 4096 = 2^12). Every pixel is drawn from exactly one source.
- **The rest render**: when the camera has been still one animation frame, the visible cells at
  the exact zoom, inline on the main thread when the estimate (chords *and* screen pixels) is
  small, in the workers otherwise; shown when complete; discarded by any move. This is the whole
  of today's sync path and settle.
- **Partial re-render** (decision 2, 5): `renderPlate` takes a clip box; a small dirty rectangle
  is re-rendered inline into the existing bitmap at full resolution; a large dirty region shows
  the coarser level's cells (blurrier, never older) until the fresh plates land.
- **One prefetch queue**, all budgeted, in this order: one ring beyond the view at the view's
  level; the coarser levels for the view; the crossing target's first level. The camera's own
  tile derivation gets the same budget off-camera reads have; a tile not ready is absent this
  frame and the pyramid covers it. The ladder, the prebake, the preview, the carry, the hold, the
  pending quantum, the settle machine, `fallbackCover` and sync-as-a-mode are deleted.
- **Cache**: LRU by bytes, protecting the view's level and the rest set; the default budget is
  three views' worth on a desktop and two on a phone, under a hard ceiling, both on the Dev panel.
- **Input** is coalesced to one view step per animation frame; the editor page stops re-rendering
  on every wheel event (R25 W1).
- **Scheduling** (R25 §6.5): jobs sorted by distance from the attention point (screen centre, or
  the wheel focus, or the pointer) and dealt round-robin across strips; at most a few new plate
  jobs admitted per frame while the camera moves; a job whose plate the camera's velocity will
  carry off screen is skipped.

### 1.3 Erasing: the mask as document state, cuts in parallel (decision 3; §3.5, R25 §4.9, §10.2, §12.2; R24 §4.6)

- **Targets at pen-up.** A mark records the ids the candidate scan finds under it when it is
  drawn (saved with the mark). Only targets and their pieces are ever masked or cut. An object
  moved under a pending mark later is not a target: it shows through and is untouched.
- **`handledBy`** on each native: the set of mark ids whose bake has dealt with it; pieces inherit
  the parent's set plus the cutting mark; a refusal adds the mark. Persisted; derivable for old
  files from the op log's bake entries at load.
- **The mask rule is pure**: item *i* is masked by mark *M* iff *i* is a target of *M* (or a piece
  of one), `M.id ∉ i.handledBy`, `i.z < M.z`, and their boxes meet. No z-stepping, no done sets,
  no per-list snapshots. Anything baked shows on top of a pending mark.
- **Cuts in parallel**: up to one cut per worker, results applied in the mark's z order, early
  arrivals buffered; descents (which mint frames) stay serialised. One boolean per target when
  several marks pending over it are all above it in z.
- **Barriers stay** (decision 3, part two): a lasso and a tap-select over pending targets bake
  those targets first, in parallel, without the 200-round cap, with a visible "finishing the
  erase" state. Because a target is always cut before it can be dragged, a target never moves
  while pending, so the mask by position is exact.
- Pending marks are a set maintained by events. Mask slots: 16, marks that no masked item lies
  between merged into one slot, marks past that painted as white ink.
- Deleted: `_lowerMark` and the half-integer z steps, `_bakeDone`/`_uncut`, `noteListMarks`,
  `_eraseStrokes()` scans, the one-cut-at-a-time queue, the 200-round cap.

### 1.4 Moving (decision 4; §3.4, R24 §4.7, R25 D1)

- `MovePlane` stays: five layers with today's merging rules, coarsening, the quick level, the
  stopgap, and the pre-render at rest. It is ported to the scene's job identity and the cache
  budget, and its cells are grown by one screen so a selection larger than the viewport is not
  clipped at drag start (R25 D1).
- **No document writes during a drag**: the scene holds the selected items and applies the pointer
  delta at pack time; at the drop every member's table is written once, one undo entry, old ∪ new
  boxes dirtied; the plane holds per cell until the fresh plates land, as now.

### 1.5 The live stroke and the SVG renderer (decision 6; R25 §4.5, §4.10)

- The SVG tail and frozen chunks stay. A `LiveStrokeLayer` around one SVG group is what the raster
  app needs of Two.js; `RasterRenderer` composes layers (picture, live stroke, ants, chevrons) and
  stops inheriting `Renderer`. `Renderer` (Two.js) stays as a separate class for the SVG export and
  the pixel comparison; `?svg` remains a gate for now.
- At pen-up the resolved shape is re-rendered into the dirty rectangle (§1.2); the SVG path is
  held only until that lands. The translucent hold's per-cell clipPath goes with the double raster.

### 1.6 The worker pool

One pool for plates and cuts (the scene index keeps its own worker), one priority ladder: the rest
render for the view > the view's plates > the drag layers > cuts, with one worker guaranteed to cuts
whenever any are pending > prefetch > thumbnails and snapshots. Cancellation by generation and
visibility. Buffers pooled as now; the pack memo by reference (no second copy of visible loops).

### 1.7 The document model: container and lattice untangled (decision 9; its own design first)

Today a frame is three things at once: a coordinate system that keeps numbers small and exact; a
spatial bucket the tile derivation relies on (invariant 2: a native never overhangs its frame's
neighbourhood by more than REACH, so a tile finds its ink in nine cells); and the container Kobin
means. The engine re-buckets objects to keep the first two true (a settle carries natives across a
cell edge, a whole-cell move re-homes, an erase at depth cedes into child frames), and a frame-based
selection has to chase those re-bucketings (`_reselect`, `_followCarries`, `_flushCarried`,
`_keepingSelection`, the merge handler; F78, F93, F100, F107, F108, F126). The target: the
container relation is its own thing (an object belongs to the frame it was drawn or moved into),
an object's numbers live in whatever frame keeps them exact, and finding ink for a tile goes
through an index of displaced objects (which exists for moved objects: `_rerouteGroups`,
`objShift`) instead of the reach rule; carries and whole-cell re-homes go; the O(1) subtree move
survives. Analysis A1 designs it; it is built as its own step after §1.1–§1.3, and the scene's
`placed()` accessor is what lets it land without touching the renderer again.

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

**Wave 2 — builds (big jobs):** B-SCENE (§1.1 with the freshness rule and `placed()`; the
`listFor` equivalence fuzz; the property tests), then B-ERASE (§1.3) on it; B-PYRAMID (§1.2, §1.5,
§1.6, input coalescing, the Dev levers, the MovePlane port) starting from B-SCENE's checkpoint,
when the generation API is fixed. One reviewer pass per build. The orchestrator reads every diff
and runs the harness.

**Wave 3:** B-MODEL (§1.7, to A1's design) and B-DRAG (no writes during a drag, §1.4). Then the
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
| a mark hides exactly its targets, and the masked target looks like its cut pieces | random object under a random mark: the plate with the mask equals the plate with the pieces and no mask, under the AA tolerance; an object moved under the mark after pen-up is unmasked |
| a family's union is insensitive to a one-ulp disagreement at a shared edge | perturb one shared edge by an ulp; the plate is unchanged, except that a byte on the shared edge may move one alpha step where the exact value is a rounding tie (built: `raster.familyUlp.test.js`) |
| the placed read equals the numeric table | random tables and depths: the picture through `placed()` equals the picture through the home frame with the table applied, to 1e-9 |
| the pyramid's crossing mapping is exact | random frames and cells: the parent's coarser cell by integer arithmetic equals `_mapFrame`'s affine to the bit |
| a selection stands for the same ink through settles, merges and cuts | the lasso lane's fuzz; a selected frame's contents before and after, and a cut step re-targeting a selected object to its pieces |
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
