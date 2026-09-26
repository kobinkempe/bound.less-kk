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
- **Partial re-render** (decisions 2, 5): `renderPlate` takes a clip box (rows restricted, x not folded:
  byte-identical to a whole render in 960 of 960 clips, A3 E1); a patch lands in the immutable plate by
  a GPU merge through one scratch `OffscreenCanvas` (0.5 ms median). A small dirty rectangle is
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
   are recorded and its mask is in force for the hit test and the bake from pen-up; the plates apply it
   when the shape lands, and the live white path covers the targets until then, as today.
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

