# The renderer rebuild — options, next steps, and the way of working

2026-09-25, a cloud session (no access to Kobin's machine, his Chrome or `.kobin-reports/`).

**What was read.** The three branches on the private remote: `rasteriser` (56e36b3, today's
work-in-progress commit), `claude-context` (8168e24, the orphan branch carrying the gitignored
`.claude/` plans, Claude's memory and the live-code scripts) and `claude/gallant-meitner-co1x1c`
(today's design review). The three review documents: `.claude/REVIEW-2026-09-24.md` (the ranked
fix list of the two-stream bug hunt and its state), `.claude/RENDER-DESIGN-REVIEW-2026-09-24.md`
(a read-only design review of the renderer) and `review/DESIGN-REVIEW-2026-09-25.md` (1,940
lines, sections 1–13, written from the live-code dumps and cross-checked against the plans).
Beside them: `DESIGN.md` §9, `docs/ai/00-START-HERE.txt`, the worklist, the anchor, the agent
preamble, the workflow-mode memories, the rasteriser plan's headings and protocol, the status
log's 465 entries, and the code where a claim needed checking.

**What was run.** Everything in §6: typecheck, lint, the worker bundles, a jest suite, the dev
server, and a real-browser check in the container's headless Chromium. Nothing here about
paint was measured on Kobin's screen; the browser numbers are from a 1280 × 800 headless window.

Contents: 0 summary · 1 what the three reviews say · 2 the brittleness, checked against the code ·
3 the options · 4 next steps · 5 the agent workflow modes · 6 the test tooling in a cloud session ·
7 decisions for Kobin.

---

## 0. Summary

- **The three reviews agree on the diagnosis**, and the code bears it out: the rasteriser core,
  the plate cache, the tile store, the lattice, the subtree move and the erase-as-mark are sound.
  The brittleness is in the layer that composes them: `PictureLayer`, the renderer's posting
  and result handling, the engine's plate-event drain, and the erase pipeline's "did a pixel
  change" bookkeeping. Every need got its own mechanism with its own state, and they meet in
  three functions.
- **They agree on the cure's shape too**, by different routes: one generation number that
  decides freshness everywhere; one lookup that picks the best picture for a screen cell; a
  render list that is kept incrementally and owns dirtiness; the erase mask as a pure function
  of document state; typed jobs under one scheduler. The 09-25 review's form (§4, §10) is the
  more complete one and corrects the 09-24 review's erase rule in one case (§12.2).
- **The bug-hunt loop of 09-24 is the machine that makes the brittleness.** About thirty flags
  (F99–F131) were found and fixed in a day and a half, each with a break-checked guard, memo,
  snapshot or cap. The next day's review found nine hazards in that freshly fixed code. The
  loop is excellent at closing flags and structurally unable to reduce mechanisms, because no
  step in it owns an invariant.
- **Recommendation (§3–§4):** take the cheap, user-visible items first (a few days, none of them
  fights the rebuild), then rebuild the composition layer one component at a time behind a
  flag, in the order generation-and-scene → pyramid compose → drag layers → erase masks, with
  the invariants written as tests *before* each builder starts and the browser harness run at
  every step. Two of the steps need Kobin's decision before they are designed (§7).
- **Process (§5):** keep the preamble, the break-checks, anchor mode and the propose-then-answer
  protocol; add a design step that produces the invariant tests, make reviewers name the
  invariant a finding breaks, keep a standing browser harness instead of per-agent tabs, roll
  the status log per task, and keep `claude-context` current so cloud sessions can work.
- **Tooling (§6):** in this container everything runs except Kobin's Chrome: typecheck 0
  errors, lint 0 errors, a raster suite green in 4 s, the dev server on Node 14 (CRA 4 will not
  start on Node 17+), and a headless Chromium 141 that drew, zoomed out 28× and back and
  restored the picture with zero page errors. `tools/harnesses/browser-check.js` is that run,
  made repeatable.

---

## 1. What the three reviews say, and where they differ

| document | method | what it delivers |
|---|---|---|
| `REVIEW-2026-09-24.md` | five reviewer agents and three tester agents over ~36 h, findings implemented by the orchestrator | the ranked fix list with its state: ~31 flags fixed, each break-checked; six decisions D1–D6 left for Kobin; the open items (AN-1, E-6, A3-4, R-1(d,e), S-2, D-3, D-4, PENUP-HL) |
| `RENDER-DESIGN-REVIEW-2026-09-24.md` | one read-only pass over the live-code dumps | six bugs B1–B6, twelve design concerns C1–C12, a recommended design (change log with versions, best fresh source per cell, recent-change layers, tile-by-tile list, target-set erase masks, no document writes during a drag, one scheduler), an order of work, five decisions |
| `DESIGN-REVIEW-2026-09-25.md` | one read-only pass over the same dumps, then a cross-check against the flags, the roadmap and the `.claude` plans | six defects D1–D6, the brittleness table (§3.7), six components (§4), a rendering-algorithm survey with sources (§6), the zoom-out options Z1–Z7 (§8), the low-level cost model (§9), eight invariants with their provable forms (§10), a function-by-function pass with hazards H1–H10 (§11, §12), duplicated work and memory levers (§13) |

**Where they agree.** Freshness by one integer instead of epochs, quantum strings and request
records. "Best picture per cell" as one ordered lookup instead of hold, pending, preview,
settle, carry and a greedy cover. The render list as something kept, not rebuilt. Erase masking
decided by document state, not by the bake's progress. `_footBelow` deleted. Mask slots raised.
Cuts in parallel. Delete in batches. One scheduler with cancellation by version. GPU rendering
deferred, with the same reasoning (phones, draw calls, MSAA).

**Where they differ, and which side to take.**

- *Which ink a pending mark hides.* The 09-24 review masks by a target list recorded at pen-up.
  The 09-25 review shows that fails with two marks over one object (a lower mark's pieces are new
  ids the higher mark never listed) and proposes `handledBy` on the object, inherited by its
  pieces. Take `handledBy`; it is the one that survives two marks, and it persists and replays
  through the op log's bake entries.
- *Recent-change layers versus partial re-raster.* Kobin's rule of 09-24 (plates for the bulk,
  small layers for recently changed objects) is the 09-24 review's §4.4; the 09-25 review meets
  the same ends (no double pen-up raster, no clipped translucent hold) with generation-stamped
  plates and a clip box in `renderPlate`, and lists the layers as an option. Both are valid;
  the second adds no new source to the compose. This is Kobin's decision (§7, item 4).
- *Octave versus quarter-octave levels.* The 09-25 review recommends octaves (41 % stretch
  between rests, four times fewer rasters during a zoom) with an exact "rest" raster at every
  stop; it also says to keep the step a constant so the choice is a measurement. Agree; the
  lookup is identical either way.
- *Change log versus generation.* The 09-24 review's per-frame change log with mapped
  footprints and the 09-25 review's generation plus a `dirtySince` per plate cell are the same
  idea; the second is simpler (one integer compare, no log to prune) and is the one to build.
- *What only one of them found.* B5 (the 200-round pre-bake cap can lose an erase for good) and
  B6 (a quadratic delete) from 09-24; W10 (a crossing re-routes every moved object one by one,
  754 of F83's 834 ms) and H1 (pinned plates exceed the budget on HiDPI desktops) from 09-25.
  All four go on the list.

**What none of them measured.** Every defect in the two design reviews is "as read". CLAUDE.md
is right that this codebase has been misdiagnosed from the wrong instrument three times. §4.4
below says how to measure each step without Kobin having to.

---

## 2. The brittleness, checked against the code

**The state.** `PictureLayer.js` (1,855 lines) assigns 62 distinct private fields at 145
sites, keeps four request records (`_v`, `_req`, `_pend`, `_prev`) and six stage codes inside one
`_frame()`; `RasterRenderer.js` (1,684 lines) has 50 private fields; `KobinEngine.js` has 42,
a dozen of them gesture flags that four background tasks each test a different subset of. The
erase pipeline keeps four pieces of state for one fact, "did a visible pixel change and where":
neutral event tags, `_uncut`, the per-list done snapshot (F121) and `_eraseListStale`.

**The four seams.** Reading the 09-24 fix list against the code, nearly every renderer fix of
that day is a patch on one of four seams, and the 09-25 hazards land on the same four:

1. *Freshness* — an epoch per key, bumped by five kinds of drop; a job's identity a quantum
   string plus a frame sequence; arrivals matched against four records. F106 (a newer stale
   result must replace older stale pixels), H2 (the second "add" pinner unpins the first), H3
   and H9 (a plate rastered from a stale list is stamped fresh).
2. *The list against the document* — `listFor` rebuilt whole, and between rebuilds the picture
   composed from a list the bake has moved past. F109, F121, D3 (a tap on freshly cut ink hits
   the removed target), H8 (derived pieces carry a z copied at derive time).
3. *Invalidation reconstructed late* — events turned into rectangles at the next render from
   the object's state then, with `_footBelow` as the memory of the old table, cleared past
   1,024 entries. B2/D6, F119 (a plate past the listed squares cached as paper), F122 (far
   plane levels packed from the camera list), the reroute memo (`offTouchedSince`).
4. *Which picture to show* — hold, pending, preview, settle, sync, carry, greedy fallback cover,
   the drag plane's five layers plus quick level plus stopgap, the live hold with its clipPath.
   F120, F123, H1, H4, D1 (a drag clips the selection to the viewport).

Each fix was right, small, break-checked and landed in hours. Each also added a rule that the
next reader has to know not to break, which is what "brittle" means here: the number of things
that must all agree grows with every fix, and nothing in the loop can make it shrink.

**What is good and must not be refactored away** (both reviews and the roadmap's own list agree):
the layering (`frameLattice` knows integers, `arcShape` knows geometry, `Document` knows no
camera); the coverage rasteriser and its family union (a family filled as one nonzero union,
alpha once); plates as the cache with stale-until-replaced; the tile store's derivation and
in-place patches; the subtree move; the erase mark as a mask (correct on any backdrop, which
white ink is not); the SVG live stroke; the op log with results, not gestures; the report
pipeline; the comments that record measurements.

---

## 3. The options

Each option says what it replaces, what it costs, and what it needs from Kobin. They are not
exclusive; §3.10 is the recommended combination.

### 3.1 Keep the design; work the fix lists (the 09-24 order of work, items 1–5)

B1's quick fix (skip out-of-date plates in the fallback cover and the carry); B2 (old table and
home in the event, `_footBelow` deleted); B3 (32 mask slots); B4/B5 (a scoped, uncapped
pre-bake); B6 (batch delete with an id → tiles index); W1 (the editor page re-renders on every
wheel event); input coalesced to one view step per animation frame; W10 (`objShift` once per
home-frame-and-table group at a crossing); H1 (the plate budget in screens, the settle replacing
the view's pins); H2 (one request set per purpose).

*Gain:* every item is user-visible on the Magnum Opus (a crossing 834 → ~300 ms, no ghost after
an undo, no 20 s freeze on a frame drag, a zoom that no longer re-renders the React tree per
tick). *Cost:* days, not weeks. *Risk:* low; each is local and measurable. *What it does not
do:* touch the four seams. The next bug-hunt day adds the next ten mechanisms.

### 3.2 Generation and the scene object (09-25 §4.2, §4.3, §4.10, §10.1, §10.5; 09-24 §4.2, §4.5)

One object between the document and the renderer: it subscribes to document events, keeps a
per-camera-frame item table sorted by z (own natives, visible tiles' pieces, re-routed moved
objects), and increments a generation G on every change. An item update dirties the plate cells
over old box ∪ new box at every level of the frame; each cell records `dirtySince`. A job is
`{frame, level, i, j, G}`; a result replaces the stored plate iff its G is newer; a plate is
exact iff `plate.G ≥ cell.dirtySince`. Every consumer (pack, hit test, ants, lasso, erase) reads
an item's placed geometry through one accessor.

*Replaces:* the per-key epochs and their five drop kinds, quantum strings and frame sequences,
the four request records, `_footBelow` and `_drawnRectIn`, ids per plate, neutral tags, `_uncut`,
the done snapshots, `_eraseListStale`, `_renderSoon`'s skip rule, the list rebuild on every erase
step. *Closes by construction:* B2/D6, D3, F121's class, H3, H8, H9. *Keeps:* a full rebuild on a
crossing and on a tile-range change (rare, already paid). *Cost:* the largest single step;
touches `KobinEngine`, `RasterRenderer`, `PlateStore`, `rasterPack`, `erasePipeline`, and the z
read in `TileStore`. *Risk:* an item whose geometry is mutated in place without an item update
(the shape bake does this today); forbid it or route it through the table. *Decision:* none for
the model itself; `handledBy` (§3.5) can be built with it or after it.

### 3.3 The picture pyramid, the rest raster and one prefetch queue (09-25 §4.1, §4.8; 09-24 §4.3)

Plates keyed `(frame, integer level, i, j)`. Compose is a lookup per screen cell: the fresh
plate at the view's level, else its stale one, else the parent cell's plate one or two levels
coarser, else the children, else paper; parent and child cells are index arithmetic, and across
a frame crossing the parent frame's level L−12 is the same picture (R = 4096 = 2^12). At rest
the visible cells are rastered at the exact zoom (inline when the chord estimate and the screen
are small, in the workers otherwise) and shown when complete. Idle prefetch in one queue: one
ring beyond the view, then coarser levels, then the crossing target. The camera's own tile
derivation gets the same budget off-camera reads already have; a tile not ready is absent this
frame and the pyramid covers it.

*Replaces:* hold, pending, preview, settle as a state machine, sync as a mode, the carry, the
greedy fallback cover and its cache scans, the ladder and the prebake as special cases, the
synchronous cold tile bake inside `_render()` (F59, the crossing stall). *Closes:* B1, H1 (with
the budget in screens and stand-in levels at quarter resolution), the compose-per-wheel-event
cost. *Cost:* a new `PictureLayer` (the current one is mostly the machinery being removed) and
the compose part of `RasterRenderer`. *Risk:* the exact integer mapping across a crossing must
be proven once (a property test against `_mapFrame`); the 41 % stretch between rests if octaves
are chosen. *Decision:* octave or quarter-octave (a constant; measure both), and whether coarse
patches may show first (blurrier, never older).

### 3.4 Three fixed drag layers, no document writes during a drag (09-25 §4.4; 09-24 §4.7)

BELOW, SEL on transparent paper, ABOVE, covering the selection's box ∩ the view grown by one
screen; the normal picture with the selection in place until SEL is ready; selected items
"held" in the item table so their residual changes dirty nothing until the drop; at the drop
every member's table written once, one undo entry, old ∪ new boxes dirtied, the layers held
until the plates are fresh.

*Replaces:* most of `MovePlane` (runs, run merging past five layers, the quick level, the
stopgap tags, the speculative pre-aim), the per-event table rewrites (`_dragSelection`), the
per-event `refile` and `offRev` churn (F83's mechanism), the drop's union rectangle past 256
members. *Closes:* D1, H4, C6, C7, the plane-cap decision. *Cost:* medium. *Risk:* sandwiched
unselected ink is drawn above the selection during the drag only. *Decision:* two, three or five
layers; whether to keep the pre-aim.

### 3.5 Erase masks as document state; cuts in parallel (09-25 §4.9, §10.2, §12.2; 09-24 §4.6 with the correction)

Each native carries `handledBy`, the set of mark ids whose bake has dealt with it (pieces inherit
the parent's set plus the mark; a refusal adds the mark; the op log's bake entries name the mark,
so it replays). The mask rule is then a pure function: masked iff `z < mark.z`, the mark is not in
`handledBy`, and the boxes meet. The pending marks are a set maintained by events, not a scan of
every native per tick. Cuts of different targets run one per worker, results applied in the
mark's z order; an object under several marks that are all above it gets one boolean of their
union. Mask slots raised to 16 with merging, or every pending mark painted white past the cap.
The pre-bake before a drag covers the selection's targets only, in parallel, without the
200-round cap.

*Replaces:* the z-stepping (`_lowerMark`), the done sets, `_uncut`, the per-list snapshots,
`_eraseStrokes()`' scans, the one-cut-at-a-time worker queue. *Closes:* B3/D2, B4, B5/H10, D3's
erase half, F65's class (which ink is under a mark becomes a property of the object). *Cost:*
medium; a save-format field and an op-log rule. *Risk:* compatibility of saved drawings
(derivable from the bake entries on load, but it is a format change and every deploy already
waits on the 1.0 compatibility decision). *Decision:* Kobin's, before design.

### 3.6 Recent-change layers (Kobin, 09-24; 09-24 review §4.4)

The last K added objects stay out of the plates and are drawn as small exact layers until they
age in; removals and changes to older ink are patched at once. Ends D-3 (the pen-up's double
raster) and the translucent hold's clipping. With §3.2's generation and a clip box in
`renderPlate` (a bake step re-rasters the ink under the mark, not four plates) the same ends are
met without a new source in the compose. Either is consistent with the rest; do not build both.

### 3.7 Inside the rasteriser, each measurable on its own (09-25 §9, §13)

Trust `FLAG_COVERS` in the core (a derived piece that fills its clip rectangle is a cover without a
deposit or a scan); cull at the list under the topmost opaque cover; reject occlusion misses by
sampling a few rows before the full 262,144-pixel scan; guard the union pass's cliff past 16,384
edges in one row; pack-time level of detail (a sub-two-pixel item ships a quad or a dot, and
sub-quarter-pixel area accumulates into a density mark: Z4, the single largest change for far
plates and the fix for the union cliff on baked bands); per-plate item lists from the binner
instead of the DRAWN test; bitmaps created together after the strip; Uint8 mask planes; the pack
memo by reference instead of a second copy of every visible loop; the sparse-strip experiment
last, on close-zoom and far-zoom plates separately. None of these touches the seams; all of them
are safe to do in parallel with the rebuild by someone else.

### 3.8 The zoom-out options Z1–Z7 (09-25 §8)

Warm the ancestor chain early (Z1); post own and up content first and the down content as a
later generation of the same plates (Z2); adaptive resolution while the camera moves (Z3);
pack-time LOD (Z4, also §3.7); a frame summary atlas as the floor (Z5); stand-in levels at
quarter resolution (Z6); smaller jobs while moving (Z7). Z1, Z3, Z4 and Z6 fall out of §3.3's
queue and budget; Z2 and Z5 are additions to decide after §3.3 is measured. PAPER-PLAN §10.18
measured a 50-octave zoom-out at 0 ms of paper with the far rungs warm, so the coarse plates
are sufficient and their cost is the whole problem; §3.3 plus Z4 is what makes them affordable.

### 3.9 A GPU live view, or another rasteriser (09-25 §6)

Both reviews defer it and the survey gives the numbers: a batched WebGL2 live view estimated at
30–100 ms a frame on a 2020 phone, the MSAA store cliff on tile GPUs, WebGPU not universal, and
every constraint (float64 exactness, family union with alpha once, masks in z order) already met
by the CPU plates. The 2026-09-08 GPU plan reached the same standing. Not now; watch
`vello_gpu`. The one rasteriser experiment worth running is sparse strips inside `rasterCore`,
after the composition is simplified.

### 3.10 The combination to build, and why in this order

1. **§3.1 first**, because its items are cheap, visible and independent of the rebuild, and
   because two of them (input coalescing, W1) change the baseline every later measurement is
   taken against.
2. **§3.2**, because it is the seam most of the 09-24 fixes patched and the enabler for
   everything after: the pyramid needs the generation for freshness, the drag layers need the
   held items, the erase rule needs a list that is never behind the document.
3. **§3.3**, the largest deletion of state for the largest visible effect (zoom-outs).
4. **§3.4**, mostly deletion once §3.2 holds items.
5. **§3.5**, once Kobin has decided the format question; §3.6 is decided with it.
6. **§3.7 and §3.8** as measured, by whoever is free, throughout.

The order also matches the 09-25 review's §7 with one change: its step 1 (input coalescing and
W1) and the rest of §3.1 are pulled together to the front, and the erase change is moved behind
its decision.

---

## 4. Next steps — how to rebuild without breaking it

### 4.1 Write the invariants as tests first

The 09-25 review's §10.9 lists them and they are the acceptance list for every step below,
which is what turns CLAUDE.md's rule 1 ("a green suite is not evidence") into something a suite
can be evidence *of*: a property test per invariant, through real code paths, most of them at the
pixel level because `rasterCore.renderPlate` runs in node (the raster oracle suite already
compares plates to an oracle).

| invariant | the test |
|---|---|
| a stored plate's generation is monotone; exact iff `plate.G ≥ cell.dirtySince` | random interleavings of document changes, job dispatches and arrivals; assert no arrival ever lowers a plate's G and the compose never draws a plate marked exact that a later change touched |
| the masked target looks like its cut pieces | a random object under a random mark: raster the plate with the mask, then with the cut pieces and no mask; pixel diff under the AA tolerance |
| a family's union is insensitive to a one-ulp disagreement at a shared edge | perturb one shared edge by an ulp and assert the plate is unchanged |
| the placed read equals the numeric table | random tables and depths: the picture through `F0 + rem` equals the picture through the home frame with the table applied, to 1e-9 |
| seam flags survive cuts | random cuts of a piece minted along a window; every fragment of a seam line is a seam, no other line is |
| the selection stands for the same ids through carries, settles, merges and cuts | fuzz over the lasso lane's operations; `isSelected` is set membership before and after |
| the pyramid's crossing mapping is exact | for random frames and cells, the parent's level L−12 cell computed by integer arithmetic equals `_mapFrame`'s affine to the bit |

The raster suites that exist (26 files, about 15,000 lines, most of them asserting an ordered
call log on a recording context) encode the mechanisms being removed: hold, settle, carry, the
request records, the string quanta. They are not ported; they are deleted with what they test,
one step at a time, and the property tests above are what replaces them. The fuzz harnesses the
reviewers wrote on 09-24 (`scratchpad/review2`, `review3`, the lasso and erase lanes) were in a
session scratchpad and are lost; the ones written for this rebuild go under
`src/engine/*.probe.js` so they survive.

### 4.2 Build each component beside the old one, behind a flag

The strangler shape, so the browser comparison DESIGN insists on is always possible:

- `Scene` (the item table and generation) is built beside `listFor`, driven by the same document
  events, and checked for equality against `listFor`'s sorted output in a jsdom fuzz over the
  operations that exist (draw, erase, move, undo, crossing) before any renderer reads it. Then
  the renderer reads it behind `cfg.scene`; `listFor` stays for the SVG renderer and the
  comparison; it is deleted when the numbers are in.
- `PicturePyramid` beside `PictureLayer`, behind `cfg.pyramid`, compared on the same synthetic
  drawing with the paper metric and the frame-time histogram from the harness.
- The drag layers and the erase rule the same way.

Each step ends with the old mechanism deleted, the docs updated in the same task (`DESIGN.md`
§9, the plan's D-rows, `docs/ai/20-` and `40-`), and the reference pages rebuilt.

### 4.3 The sequence, with what each step deletes

| step | builds | deletes | proof |
|---|---|---|---|
| 0 | §3.1's items | `_footBelow`; the 200-round cap; the mask-slot cap at 8 | the existing suites plus one browser number each (the crossing, a frame-selection drag after an erase, a zoom with the React profiler quiet) |
| 1 | `Scene`: item table, generation, `dirtySince`, `placed()` | epochs and their drops, quantum strings, the four request records, ids per plate, neutral tags, `_uncut`, done snapshots, `_eraseListStale`, `_renderSoon`'s skip | the first, second and fourth tests of §4.1; the `listFor` equivalence fuzz; the harness |
| 2 | `PicturePyramid`, the rest raster, one prefetch queue, the budgeted camera read | hold, pending, preview, settle machine, sync mode, carry, `fallbackCover`, the ladder and prebake as special cases, the cold bake in `_render()` | the crossing-mapping test; the paper metric on a fast 3–4 level zoom-out; F59's cold first draw |
| 3 | three drag layers, held items, tables written at the drop | most of `MovePlane`, `_dragSelection`'s per-event writes, `_holdMove`, `_releaseMove`'s rectangle rules | the selection-ids test; a 20,000-member drag timed per event; D1 and H4 on screen |
| 4 | `handledBy`, marks as a set, parallel cuts, one boolean per target | z-stepping, `_eraseStrokes()` scans, the serial cut queue, the selection barrier's cap | the mask-equivalence test; a 100-object bake timed; ten quick dabs on a dense area |
| 5 | §3.7's items as measured; Z2/Z5 if paper remains | — | plate timings by class (empty, one backdrop, close zoom, far zoom, translucent, bands, masks) |

Sizes, roughly: step 0 a few days; step 1 the largest, one to two weeks with the tests; step 2
a week; steps 3 and 4 a few days each once 1 holds. These are working estimates for one builder
at a time, not commitments.

### 4.4 Measure every step in a browser without Kobin having to

`tools/harnesses/browser-check.js` (added today, §6) drives a running dev server in a real
Chromium: it draws, zooms out and back, screenshots each state, and prints the engine's own
counters (`renderer.report()`, `layer.report()` with its paper counters, `plates.report()`,
`longFrames`) and an ink-pixel count of the composed canvas before and after the round trip. To
make it the gate for the rebuild it needs three additions, each small:

1. **A dense synthetic drawing generated in-page** (a few thousand strokes at three zooms, a
   backdrop, some translucent ink, a stack under an eraser mark), because the Magnum Opus export
   is not in the repository and a cloud session cannot see `.kobin-reports/`. The same generator
   gives every session the same drawing.
2. **The paper metric** as PAPER-PLAN §9 defines it (each frame's uncovered share × its time on
   screen) computed from `layer.report()` deltas across a scripted zoom, and the frame-time
   histogram from `longFrames`, printed as two numbers per scenario.
3. **A screenshot diff against the `?svg` renderer** at rest, which is DESIGN §9's own fidelity
   check (20 views agreeing to 0.001–0.98 % of pixels), so exactness at rest is asserted, not
   assumed.

Run it in both places: the cloud's headless Chromium after every push, and Kobin's Chrome when
he has a moment. The two disagree in known ways (headless has no GPU compositor, so texture-upload
hitches and the compositor's scaling are invisible there; the scripting costs, the pixels and,
as A3 measured, the 33-image compose cliff are the same), which is why both are needed and why
neither replaces the phone.

### 4.5 What stays open after all of it

The frame-lazy document (W4: geometry in memory proportional to what is near the camera) is the
only lever on the memory floor and is not a renderer item. Event-sourced undo for erase steps
(§10.6) is an option to measure. The touching-arcs severance case and the 1.0 compatibility
decision are unchanged. The SVG renderer's future (kept for `?svg` and the export, or replaced by
a `LiveStrokeLayer` around one path) decides whether `RasterRenderer` stops inheriting
`Renderer`; that is §3.2's natural moment to ask.

---

## 5. The agent workflow modes, reviewed

### 5.1 What exists

- **Three modes** (`memory/workflow-modes.md`, Kobin 2026-09-22): FABLE-DIRECT (the orchestrator
  does it all); FABLE-LED, the default for design-and-build (the orchestrator reads the code and
  names the challenge, Opus agents do narrow analyses, the orchestrator writes the high-level
  design, agents flesh it into a doc, the orchestrator corrects it and runs the build as
  proposal → answers → build → the orchestrator reads the diff → one review pass with a fixed
  checklist); LOW-FABLE (agents do the work, the orchestrator verifies) at 85 % weekly usage.
- **The gates**: the shared-budget rule (off when Kobin asks for an agent or the session is
  Opus); the 3-agent cap counting workflow and background agents; "agents, not workflows"
  (2026-09-24) and no background agents unless asked; "keep two reviewers going until findings
  dry up"; the orchestrator implements what reviewers recommend.
- **The scaffolding**: the 18-rule agent preamble (comments, helpers, the test command, browser
  rules, break-checks on an unimported copy, the status-log entry, the report shape with
  `leastSure` ≥ 1); the 2026-09-20 protocol (propose before building, a report with no questions
  is incomplete, checkpoints on the big stages, the orchestrator's written checks, the reviewer
  reads the answers first); anchor mode (`.claude/ANCHOR.md` rewritten at every step boundary so
  a compaction loses one sentence); `KOBIN-QA.md`; the saved `full-code-review` workflow script.
- **The record**: `rasteriser/STATUS-LOG.md`, 778 KB, 465 entries from 2026-09-15 to 09-24.

### 5.2 What the record shows

Stage 0 of the rasteriser went implementer → reviewer → fixer → re-reviewer → fixer #2 →
second-fix review → close-out → close-out review → close-out fixer: nine passes for the first
stage, which is what prompted the 09-20 protocol; later stages ran in two to three. That
protocol's stated purpose (catch misreadings one step earlier, when they cost a paragraph) is
the right one, and stages 5–6 show it working.

The 09-24 bug hunt is the other shape: two streams (a tester in a Chrome tab, a reviewer
reading), then five reviewers and three testers over ~36 hours, the orchestrator implementing
every confirmed finding with a test and a break-check. Output: about thirty flags fixed, seven
thousand fuzz steps at zero failures on the final tree, and a code base in which the next day's
reader found nine hazards, several of them in the day's own fixes (the `_underFrames` memo, the
done-set copy, the `add` pinner). The loop's fitness function is "does removing the guard turn a
test red", which every guard passes; nothing in it asks whether the guard should exist.

### 5.3 What works and should stay

The preamble, in particular rules 4–6 (the test command, "a green suite is not evidence", "state
what was measured"), 14 (break-checks on a copy, after the 09-23 overwrite) and 17 (one visible
tab per task). `leastSure` and the propose-then-answer step: the reports that carried real
questions were the ones whose stages closed in one review. Anchor mode: the anchor file read
today was enough to reconstruct the state of a session that had compacted several times. The
status-log entry shape (working on / measured / decisions / questions). The reviewer reading the
orchestrator's answers first. The report pipeline and jsdom replay of phone reports. The 3-agent
cap and "agents, not workflows" are Kobin's constraints and cost nothing that matters.

### 5.4 What to change for the rebuild

1. **A design step that produces the invariant tests.** FABLE-LED's step 3 (the orchestrator
   writes the high-level design) is right for the rebuild; add to it that the design is not done
   until §4.1's tests exist and fail against the current code where they should. They are the
   acceptance list every builder is briefed with, and the checklist every reviewer reviews
   against.
2. **A finding must name the invariant it breaks.** A reviewer's fix proposal that adds a flag,
   a memo, a snapshot or a cap is accepted only with the sentence in `DESIGN.md` or the plan that
   the new rule adds; otherwise it goes back as "which invariant, and where should it live". This
   is the one rule that turns the fix loop from a mechanism generator into a mechanism reducer.
3. **One builder per component, one component at a time**, under LOW-FABLE once the design and
   the tests exist: the design and the diff reads are where the orchestrator's judgement earns
   its cost; the build of a component whose contract is a test file does not need it.
4. **A standing measurement agent with the harness**, not a tester improvising in a tab. It
   runs `browser-check.js` with the synthetic drawing before and after every step and reports
   the two numbers; it never fixes anything. Today's testers each rebuilt their own tab
   choreography and their measurements are not comparable across the day.
5. **Roll the status log per task.** 778 KB cannot be read by any agent; today's readers grep it
   for their own name. One file per task (`STATUS-LOG-<task>.md`) with a ten-line summary
   appended to an index is what a reviewer can actually read first.
6. **Keep `claude-context` current**, and commit it at each session's end, because it is what
   makes a cloud session possible at all (§5.5); the scratchpad harnesses of 09-24 are gone for
   the same reason the branch was created.
7. **Two review agents at once is the right number** for a bug hunt; for the rebuild it is one
   reviewer per component reading against the test file, and the tester above. Keep "until
   findings dry up" for hunts, not for rebuild steps, whose end is the acceptance list.

### 5.5 Cloud sessions: what differs, measured on this one

| on Kobin's machine | in a cloud session |
|---|---|
| `.claude/` plans, the anchor, the memory | absent from the code branches; `origin/claude-context` has them (extract with `git archive`); the memory files are not loaded automatically and must be read |
| Kobin's Chrome through the `claude-in-chrome` tools; `preview_start` | no such tools; a headless Chromium 141 through Playwright 1.56 (both preinstalled); the dev server started from Bash, backgrounded |
| Node 14 for CRA 4 | Node 22 by default: jest suites run, `npm start` does not (postcss 8.2's `"./": "./"` folder export was removed in Node 17); `nvm install 14` takes five seconds and fixes it |
| `.kobin-reports/`, the Magnum Opus export | absent; replay tests skip themselves; the harness needs its own dense drawing (§4.4 item 1) |
| Firebase sign-in | blocked by the proxy's certificate (`ERR_CERT_AUTHORITY_INVALID`); local canvases work, which is all the harness needs |
| the tree persists | the container is reclaimed: anything not committed to the session's branch is lost, which is why the 09-25 review and this document live on `claude/` branches |

A cloud variant of the preamble's rules 7 and 9 (browsers, files) is a ten-line addition; the
rest applies as written.

---

## 6. The test tooling, verified in this container

| command | result | time |
|---|---|---|
| `npm ci` | 2,023 packages | 60 s |
| `npm run typecheck` | 0 errors | 2 s |
| `npm run build:worker` | three bundles (erase 370 KB, raster 44 KB, scene 95 KB) | < 1 s |
| `npm run lint` | 0 errors, 5 warnings (the docs say 3; two are in 09-24's new tests: `arcShape.both.test.js:50` a non-string title, `move.camMerge.test.js:56` an unused variable) | 23 s |
| `CI=true npx react-scripts test --watchAll=false src/engine/raster/rasterCore.test.js` on Node 22 | 26 of 26 passed | 4 s |
| `npm start` on Node 22 | fails at module load (`ERR_PACKAGE_PATH_NOT_EXPORTED`, `postcss/lib/tokenize`) | — |
| `npm start` on Node 14.21.3 (nvm) | compiled, serving on :3000 | ~40 s |
| `npm run test:quick` on Node 14, beside the dev server and a browser run | 166 suites passed, 1 failed, 5 skipped (the report-replay suites, no `.kobin-reports/`); 2,061 tests passed, 1 failed. The failure is `report.e2e.test.js` RS-4 (a 300 KB part over a 256 KB cap must be refused with 413): a 5 s timeout, and the suite alone under Node 14 hung past five minutes; under Node 22 alone it passes, 10 of 10, RS-4 in 8 ms. A Node 14 http difference in this container, not the renderer; unresolved | 489 s |
| `node tools/harnesses/browser-check.js` (Node 22, headless Chromium 141, 1280 × 800, dpr 1, 4 workers) | below; run twice, the second time beside the quick suite | 12–17 s |

**The browser run.** The engine mounted in the raster mode 0.9 s after navigation. Three strokes
through the real pointer path: 16 plates posted, 84 sync plates, 3 live holds with 2 handoffs
(the longest hold 67 ms), 21 items packed and 11 culled. A 40-tick wheel zoom-out to 1/27.9×
(the ticks sent over 2.1 s): 11 quantum changes, 9 holds, 9 previews with 10 hits, 2 abandoned
quanta, 59 held composes, 14 carry composes, 24 fallback composes, 7 composes that showed paper
with at most 6 paper cells, 0 evictions, 143 plates cached (28 MB of 96 MiB), and the picture in
sync mode at the end (a three-stroke drawing is under the chord budget). The zoom back to 1.00×
restored the drawing exactly: the composed canvas held 25,244 ink pixels before the round trip
and 25,244 after, with the same pixel hash (the two screenshots differ only in the scale
readout). Three long frames,
all React's mount work (221, 129 and 126 ms of `performWorkUntilDeadline`), none the engine's.
Zero page errors; one console error from Firebase behind the proxy certificate.

What this run proves: the whole path from a pointer event to composed plates in workers runs
in this container, and the engine's own counters are readable from a script. What it does not
prove: anything about a dense drawing, a phone, GPU compositing, or Kobin's screen. The
harness is the start of §4.4, not the gate yet.

---

## 7. Decisions for Kobin

Consolidated from the three reviews and this document; each blocks the step it names.

1. **`handledBy` on objects** (a save-format field and an op-log rule) — blocks §3.5. The
   alternative keeps the z-stepping and its four flags.
2. **Octave or quarter-octave plate levels** — §3.3 builds either; keep the step a constant and
   measure both on the synthetic drawing and in your Chrome.
3. **Drag layers: two, three or five**, and whether the plane is still pre-aimed at a quiet
   stop — blocks §3.4. The three-layer form draws sandwiched unselected ink above the selection
   during the drag only.
4. **Recent-change layers or partial re-raster** for pen-up and small edits — one of the two,
   with §3.2.
5. **Coarse patches first for large changes** (blurrier, never older) — §3.3's rest raster.
6. **The lasso as a barrier or a re-judge** (select the pre-cut object now, re-target to its
   pieces when the cut lands; no freeze, the ants briefly outline the uncut object) — §3.5.
7. **The zoom-out extras** Z2 (cheap layers first) and Z5 (a summary atlas) — only if paper
   remains after §3.3 and Z4.
8. **Whether the SVG renderer stays** for `?svg` and the export — decides whether the raster
   renderer stops inheriting `Renderer` in §3.2.
9. **The 09-24 list's open decisions D1–D6** fold into the above: D1 and D5 into item 3, D2 (the
   cloud format) is separate and unchanged, D3 (the ant crawl on huge selections) and D4 (an undo
   byte cap) stand as before, D6 (marks past the seventh) into §3.5.
10. **The 1.0 compatibility gate** is unchanged and still gates every deploy.
