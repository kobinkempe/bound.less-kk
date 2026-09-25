# Renderer design review, 2026-09-25

**Scope.** `DESIGN.md`, every line of `review/live-code-changed.js.txt` (16,508 lines, the
uncommitted work), and the parts of `review/live-code.js.txt` needed for context (Camera,
TileStore, LevelMap mapping, Document families and settle, the erase bake loop, the
selection helpers, the hook's input wiring). Sections 1–11 were written from those alone;
section 12 was added afterwards from the repository's own records and the plan files on the
`origin/claude-context` branch.

**Method.** Reading only. Nothing here was measured in a browser, and CLAUDE.md is right
that the browser is where the truth is: every "defect" below is *as read* and needs one
look on screen before it is treated as real.

Contents: 1 the design as built · 2 probable defects · 3 design concerns, by scenario ·
4 the recommended design, with the options and their trade-offs · 5 the rest of the app ·
6 rendering algorithms compared for a dense drawing · 7 an order to build it in · 8 fast
zoom-outs and paper · 9 the low-level path: pack, transfer, plate, compose, with trade-offs
by plate type · 10 correctness: the invariants, where each lives today, and the form that
makes it provable · 11 function by function: what must hold, how it is made true, where it
is fragile (hazards H1–H9) · 12 cross-check against the repository's own records (the open
flags, the roadmap, the `.claude` plans and the 2026-09-24 review on `origin/claude-context`;
H10, W9, W10) · 13 shortcuts, duplicated work, and memory (the cull extended to the list and to
`FLAG_COVERS`, a table of repeats, where the memory goes, the three causes of jank without CPU,
ten memory levers) · A the changed files and what each does.

---

## 1. The design as built

### 1.1 The picture pipeline in one page

```
Document ──events──▶ TileStore        derived pieces per (frame | up/down | tile), patched in place
         ──events──▶ _plateEvents ──▶ PlateStore epochs   (drop by id, by rect, by frame; "neutral" events skipped)

camera event (wheel / pointer / pinch, one call per DOM event)
   └─▶ KobinEngine.panBy / zoomFactorAt
         ├─ crossed, tile range changed, erase list stale …  ▶ _render()          full list rebuild
         └─ otherwise                                        ▶ syncCameraOnly()   same list, new view

_render():  listFor(camera frame, window + one preview plate)
              = visible up/down tiles' pieces + the frame's own natives (+ re-routed moved objects)
              → per item: editId, erase flag, residual of its displacement table
              → sort by (z, id) → snapshot of each mark's (z, done set) for this list
            _drainPlates()  → PlateStore invalidations
            RasterRenderer.render(list)

RasterRenderer._frameStep(list):
   visibleChords(list)  →  PictureLayer.frameFor(camera, chords)  →  view {mode, q, Zq, stretch s, plate range}
   mode "sync"   : renderPlate() for every visible plate on the main thread, every event
   mode "plates" : PlateStore.want(view) → compose(hits) → _post(view, misses)

_post → rasterWorkerClient: strips, priorities, per-strip lazy packJob(list) → worker renderPlate
      → bitmaps → _deliver → PictureLayer.onPlateBatch → compose

Layers on screen:  ink canvas (z0) · SVG live stroke + held pen-up paths (z1) · ants canvas (z2) · chevrons SVG (z3)
Drag:   MovePlane = separate plate sets below / selected / above, composed with the selected set translated
Erase:  a pending mark is a per-job coverage mask over the unhandled ink below it; the bake cuts later
```

### 1.2 The pieces, and the numbers they run on

**Plates and quanta** (`plate.js`, `PlateStore`). A plate is 512 device px. Zoom is
quantised to 2^(q/4) (four quanta per octave, 19 % steps) with 0.75 quanta of hysteresis.
Key = `frame|q|i,j`. The cache is bounded by bytes, 96 MiB desktop / 56 MiB phone, and a
plate with any ink costs 1 MiB, so the cache holds about 96 / 56 inked plates. Invalidation
bumps a per-key epoch; the stale bitmap stays and is drawn until its replacement lands
(F106). Every invalidation (`dropById`, `dropRectPerFrame`, `dropQuantum`, `dropFrames`,
`fallbackCover`) is a scan of the whole cache.

**PictureLayer.** One ink canvas plus a layer canvas for stretched composes. `_frame()`
has six stage codes (0 view, 1 settle request, 2 settle publish, 3 pending-quantum request,
4 quantised pending view, 5 preview request) and three request records beside the view:
`_req` (exact-zoom "settle" plates, quantum `"e"`, asked 150 ms after the camera stops,
discarded on the next move), `_pend` (the next quantum while the old one is *held* and
stretched, until every plate of the new quantum is in and the stretch is inside [0.71, 2]),
`_prev` (a preview 8 quanta = 2 octaves coarser on zoom-out, 12 when the zoom is fast).
`compose()` draws, in order: the previous canvas re-projected ("carry") or paper; up to 30
stand-in plates from other quanta or frames chosen by a greedy cover; the view's plates
(direct at stretch 1, else via the layer canvas); the drag plane. Coverage is recounted per
compose to decide whether paper showed. About sixty counters record what happened.

**Sync path.** When the estimated chord count of the visible list is under 5,000, every
visible plate is rasterised on the main thread on every camera event (no cache); the path
is left when a frame's raster passes 8 ms and not re-entered until the chords halve.

**Rasteriser** (`rasterCore`, in `raster-worker.js`). Signed-area coverage accumulation
(float32 accumulator, exact horizontal AA, per-row prefix sum). Arcs are subdivided
centre-free by chord and bulge to a 1/16 px sagitta. A *family* (the pieces sharing an edit
id) is filled as one nonzero union and gets its alpha once, so cut pieces never seam and a
translucent object never double-darkens at its own seams. Strokes and overlapping families
go through a 16-sub-scanline nonzero union pass. Occlusion: from the topmost family whose
box covers the plate with alpha 1, deposit and test full coverage; a miss costs a full
deposit. Pending erase marks are resolved first into up to 8 float32 masks; an ink item
below a mark, not in the mark's done set, is multiplied by (1 − mask). Measured (DESIGN):
6.3 families and 10.8 ms a plate at the Magnum Opus's nucleus with the cull, 165–580 ms
without.

**Packing** (`rasterPack`). A per-object memo (box, sub-boxes, a *copy* of the loop numbers,
stroke bands per quantum, 10 MiB LRU) and a per-list family prepass. `packJob` bins items
to the strip's plates and concatenates every drawn item's geometry into one transferable
buffer per strip, so an item is copied once per strip whose plates it touches: small items
once, a screen-spanning backdrop once per strip.

**Worker client.** min(4, cores − 1) workers, strips of ⌈plates / (workers × 2)⌉,
priorities 0 preview, 1 view, 2 drag plane, 3 prebake/ladder (at most workers − 1 in
flight), 4 thumbnails. A request's identity is its quantum *string* plus a frame sequence:
`"e"` settle, `"s"` sync, `"z0_q_hash"` plane layers, `"tN"` thumbnails, a number for the
view. Newer submits drop older queued strips of the same string; in-flight results are
checked by epoch on arrival.

**Render list** (`KobinEngine.listFor`). Rebuilt whole whenever the visible tile range,
the frame, a fat/fade flip, or a stale erase list says so: concatenate the visible tiles'
pieces and the frame's own natives, look every item up in the document for its edit id,
erase flag and residual, sort by z. DESIGN puts a Magnum Opus render at 120–220 ms; the
list is most of it. Between rebuilds `syncCameraOnly()` composes the *same* list.

**TileStore.** Up tiles are derived from the parent's up tiles plus the parent's natives
plus the ring natives, one crossing at a time; down tiles project deeper non-ancestor
frames. Tiles are patched by document events: a remove scans every cached tile's pieces, an
add re-derives into every tile it reaches. Caps: 512 tiles, 64 per level. Off-camera reads
(ladder, plane far lists, thumbnails) run with a deadline that throws `OVER_BUDGET` between
bakes; a deadline of 0 means no deadline.

**Drag** (`MovePlane`). At drag start the list's families that touch the view are grouped
into z-runs alternating selected / unselected; runs are cut into ≤ 5 layers (a sandwiched
unselected run is merged *under* its neighbours when there are more), each layer a set of
plate cells = the run's boxes ∩ the view, coarsened one octave at a time until the plates
fit the cap (40 desktop, 24 phone, 16 when the view is stretched), plus a "quick" level two
octaves coarser. Layers are rastered as separate plate sets (transparent paper for selected
and above). While the plane is whole, view plates are rastered with the selection omitted.
A stopgap rasters small selections on the main thread when nothing is ready. At drop the
plane is held up to 3 s until the plates under it are fresh. A plane is *pre-aimed*
speculatively 150 ms after the view goes quiet whenever a selection exists.

**Live stroke.** Two.js SVG path: a tail under the pen and frozen chunks of 128 anchors. At
pen-up the path is held (3 s, extended while plates are in flight, 15 s max) until every
plate under its box is fresh; a translucent one is clipped to the still-stale cells with an
SVG clipPath. The finished stroke is rastered twice: banded from its samples, then as the
resolved shape.

**Erase.** A mark is a white stroke that commits at once. In the raster renderer it draws
as nothing and masks the unhandled ink below it; the bake (`_bakeTickInner`, 8 ms slices,
one cut in the erase worker at a time) cuts one object per step and steps the mark's z below
it. Bookkeeping for "did the picture change": `_pictureNeutral` (events raised inside a
neutral step are tagged), `_uncut` per mark (targets still whole: cut in the worker, refused
over ink), the done set snapshot per list (`noteListMarks`, F121), `_eraseListStale`. A step
whose events are all neutral skips the render entirely. Barriers (`_flushErasesFor`,
`_settleSelectionErases`, `_settleLassoErases`, `flushErases`) run cuts inline on the main
thread. `_candidatesUnder` caches the mark's target scan on `doc.rev`, kept across the
mark's own edits only.

**Overlay.** Ants are decided from the render list, painted into an RGBA buffer per phase
(50 ms), blitted by `putImageData`, and moved by a CSS transform between paints.

**Ladder / prebake.** After 300 ms of quiet, up to 11 zoomed-out views (4× … 4M×) get a
budgeted off-camera list (50 ms slices, 120 tries) and ≤ 24 plates each at low priority; a
crossing target is prebaked the same way.

---

## 2. Probable defects (as read)

**D1. The drag plane clips the selection to the viewport at drag start.**
`MovePlane._cut` keeps only families whose box touches the view, and `_level.cellsOf`
clamps every layer's cells to the view's plate range; `aim()` returns early while
`state === "drag"`, so the plane is never rebuilt during the drag. Selected ink that was
outside the viewport (beyond the last plate column/row) when the drag began is in no layer
and the view plates omit the selection, so it is invisible until the drop, and the visible
part ends at a hard plate edge that moves with the pointer. Bites exactly the "select a lot
and move it" case whenever the selection is bigger than the screen.

**D2. Nine or more pending marks in one job share a mask.** `packJob` gives a mark slot
`min(markOf.size, 7)`; `resolveMask` clears a slot only the first time it is used in a
plate and max-merges after. Marks 8, 9, … become one union mask, and an ink item below
mark 8 is then hidden wherever mark 9 lies, even if mark 9 is below that item or has already
handled it. Reproduce with ten quick eraser dabs on a dense drawing while the bake is slow.

**D3. The render list goes stale for the length of a neutral bake.** Every cut of a target
under its mark is neutral, `_renderSoon` skips the render when all queued plate events are
neutral, and the list is only rebuilt by a camera step, `flushBakes`, or the mark being
spent. Meanwhile `_hitTest` walks the stale list: a tap on freshly cut ink returns the
removed target's id, `select()` finds no such object and deselects; the ants trace the old
pieces. Small, but it is the kind of "why did that tap do nothing" report that is hard to
attribute.

**D4. `eraseDescent.cedeVirtual` is `Document.cedeTileById` copied whole**, against the
one-implementation rule; the two already differ only by their receiver and will drift.

**D5. Scene thumbnails bake tiles on the main thread with no budget.** `snapshotView` →
`listFor(frame, win)` → `contentOffCamera(F, rect, 0)`: a budget of 0 is *no deadline*. Every
scene without a fresh thumbnail, four at a time, when the Scenes panel opens (and again
whenever a scene's hash changes, polled each second). On the Magnum Opus a cold level is
0.3–0.8 s of tile bakes (DESIGN), per scene.

**D6. `_footBelow` is cleared past 1,024 entries.** The next event for such an object has
no previous table, so the rect at its *old* place is not dropped. `dropById` covers the
plates that already list the id, so the gap is only in-flight plates; minor, but it is a
history the renderer should not need to keep at all (see 4.2).

---

## 3. Design concerns, by scenario

### 3.1 Zooming in and out quickly

- Every wheel event runs a full view step (compose of up to 30 stand-in images plus the
  view's plates) synchronously; nothing is coalesced to the animation frame. Trackpads emit
  60–120 wheel events a second.
- Quarter-octave quanta mean a fast zoom posts a new full-screen raster every 19 %; most are
  dropped before they finish, and each post drops the queued strips of the previous quantum.
  The hold/pending/preview machinery exists to hide this churn.
- Settle plates (exact zoom) are thrown away on every move and asked again 150 ms after
  every pause: a slow, halting zoom on a dense drawing re-rasters the whole screen at each
  pause and shows a stretched picture (up to 2× or 0.5× while a hold lasts) between them.
- The ladder keys on the exact camera state, so any camera stop restarts its walk (cheap
  when the plates are cached, a budgeted list build per rung when they are not), and its
  plates compete with the view's under a 96-plate cap.
- Stand-ins are found by scanning the whole plate cache and solving a cover with a greedy
  budget, and the previous canvas is carried as another stand-in: three mechanisms for one
  need ("show the best cached picture at the new zoom").

### 3.2 Selecting and moving many objects a long way

- D1 above.
- The plane is a bespoke plate set per drag: runs, run merging, coarsening, a quick level, a
  stopgap, a landing hold, and its own pin set in the cache. Pre-aiming rasters up to 40
  plates whenever anything is selected and the view rests, whether or not a drag follows.
- At the drop, `_movedRectsIn` invalidates a rect per moved object at start and end (two per
  object up to 256), then the *union* beyond that: a long move of 300 objects drops every
  plate between the two boxes.
- Each drag event with a plane does no list rebuild (good); without one (`dragLight` false)
  each event rebuilds the list (bad on dense drawings).
- `_selectionMembers`, `_isSelected` and `_selTable` call `editGroup`, and `editGroup`
  rebuilds its map over *every* native after any document change; on a 40 k-native canvas a
  press during a bake can cost tens of milliseconds before anything moves.
- The subtree-move design (frames re-addressed, shifts settled on read) is sound; the cost
  that leaks into the renderer is the `refile` event, which drops *all* plates and rebuilds
  the re-route memo (`_offWide`) on every drag event when moved objects exist.

### 3.3 Erasing many objects

- The bake is one object per step with the cut in a worker; the *render* side is where the
  time goes: a step that changes the picture needs a list rebuild (120–220 ms on the Magnum
  Opus, C1), which is why neutral steps, `_uncut`, `_eraseListStale` and the per-list done
  snapshot were built. They are correct but they are four flags for one fact ("did any
  visible pixel change, and which plates").
- `_eraseStrokes()` scans every object of every level on every tick and every select press;
  `_candidatesUnder` rescans every level's index and every moved object whenever *any* other
  change lands (a pen-up during a bake, a second mark's cut).
- Every remove walks every cached tile's pieces (`TileStore._removeObject`); every add
  re-derives into every tile it reaches. A bake of hundreds of cuts is hundreds of full
  tile-cache walks.
- The barriers run the rest of the bake inline. Lassoing over a stack that is still baking
  freezes the tab for the remaining bake (DESIGN says so; on the Magnum Opus a bake is
  18–30 s). That is a product decision, but the renderer could offer a cheaper one (4.6).

### 3.4 Erasing to cut objects into pieces

- Rendering is right: pieces share the edit id, are one family, one union, one alpha.
- `_resplitFamily` after every multi-region cut runs `_familyComponents`, O(members²)
  contact tests each re-outlining a member; a scribble cut into 50 pieces is 2,500 outline
  pairs per further cut.
- D3: pieces exist in the document but not in the list until the next camera step.

### 3.5 Translucent objects

- Family-once alpha, mask multiply, transparent-paper drag layers with unpremultiply, and
  the clipped live hold are all correct as read. Two soft spots: a family under the fade
  band is split into per-piece families (`renderIdOf` uses the id when fade < 1), so a
  fading translucent object can seam; and a translucent pen-up held as SVG over fresh plates
  is prevented from doubling only by the per-cell clipPath, which is the kind of fix that
  works until the next layer is added.

### 3.6 Memory and CPU on dense and light drawings

- Light: the sync path re-rasters every visible plate on every camera event, including pans
  where nothing changed. Fine on a desktop, the main cost on a phone.
- Dense: the list rebuild (C1) is the single main-thread stall; then per-strip geometry
  copies, the memo's second copy of every visible loop (10 MiB cap, thrashing on dense
  views), the O(cache) invalidations, and the O(N) rebuilds of `editGroup`.
- Memory is bounded and mostly fine: 96 MiB plates, canvas + layer canvas, overlay buffers,
  8 MiB buffer pool, 10 MiB memo, ≤ 512 tiles. The document's geometry dominates
  everything else, as DESIGN's numbers say.
- Screen size: a 2560×1440 display at dpr 2 needs about 77 inked plates for the view alone;
  with a drag plane (≤ 40, pinned) and the preview the 96-plate cap is exceeded and the
  store reports `overCapPinned`.

### 3.7 Why it feels brittle

Each need got its own mechanism with its own state, and they meet in `compose()`,
`_take()` and `_drainPlates()`:

| need | mechanism | its private state |
|---|---|---|
| picture at a zoom we have no plates for | hold + pending quantum + preview + fallback cover + carry | `_hold`, `_pend`, `_prev`, `_carry`, `_fb*`, 6 stage codes |
| exact pixels at rest | settle ("e") | `_req`, `_settlePending`, `_eLive`, timer |
| light drawings | sync ("s") | `_sync`, `_syncSlowAt`, `_syncMs` |
| drag | MovePlane | runs, layers, tags, quick, stop, land, `_dragOmit`, pins |
| erase without re-rastering | neutral events, `_uncut`, done snapshots, `_eraseListStale` | four flags in three files |
| plate invalidation | by id, by rect (with `_footBelow` history), by frame, by quantum | `_footBelow`, `_holdMove`, epochs |
| job identity | quantum strings + frameSeq + epochs | `current`, `_postQ`, `_qWas/_pendWas/_prevWas` |

The rasteriser itself, the plate cache with epochs, the family union, the mask idea, the
subtree move and the erase-as-white-stroke commit are all good and worth keeping. The
brittleness is in the *composition* layer above them.

---

## 4. The recommended design

Six components. Each replaces the mechanisms named beside it. The geometry pipeline
(lattice, tiles, boolean, bake, moves as tables, erase as a white stroke with a deferred
bake) is unchanged.

### 4.1 One picture pyramid per frame (replaces hold, pending, preview, settle, sync, carry, fallback cover)

- Plates keyed `(frame, octave L, i, j)`, L an integer. At zoom Z the view is drawn from
  level `round(log2 Z)`, stretched between 0.71× and 1.41×.
- **Compose is a lookup, not a search.** For each screen cell at level L: the fresh plate;
  else its stale plate; else the parent cell's plate at L−1 (a quarter of it, scaled up), or
  L−2, …; else the four child plates at L+1 scaled down; else paper. Parent and child cells
  are integer index arithmetic. No cache scan, no greedy cover, no carry canvas.
- **Rest raster.** When the camera has been still for one animation frame, the visible cells
  are rasterised at the *exact* zoom (a "rest" plate set, keyed by the exact zoom) and shown
  when complete; any move discards them. This is what settle does today, and it is the only
  place exact-zoom pixels exist.
- **Executor.** The rest raster runs inline on the main thread when the chord estimate is
  small, in the workers otherwise. That is the whole of the sync path: on a light drawing the
  rest raster finishes inside the frame, so every frame is crisp; on a dense one the pyramid
  shows until it lands.
- **Prefetch at idle**, in this order and all budgeted: level L one ring beyond the view;
  L−1 for the view (the zoom-out preview); L−2 … the frame's coarsest level (the ladder);
  the crossing target's first level. One queue, one priority ladder.
- **Across a frame crossing** the parent frame's level L−12 is the same picture (R = 4096 =
  2^12 and the lattice is powers of two), so the pyramid lookup can step into the parent
  frame with exact integer offsets. Option: keep one affine fallback for the last crossing
  only, which is what `_mapFrame` does today.
- Eviction stays LRU by bytes, protecting the current level and the rest set; size the budget
  in screens (three views' worth, two on a phone) rather than a fixed 96 MiB. A useful
  property of octave levels: every level coarser than the view costs a quarter of the one
  above, so the whole pyramid below the view is at most a third more than the view itself.
- **Option: the rest picture as one screen bitmap, not plates.** Exact-zoom pixels exist only
  for the current camera state, so they need no cell keys at all: one screen-sized raster
  (strips per worker, or inline when cheap), invalidated by dirty rects, and re-rastered only
  in the dirty strips. Plates then exist *only* in the pyramid, and the "settle"/"e" plate
  set, its range record and its pin rule disappear. The cost is that a small pan invalidates
  the whole rest picture rather than sliding plates; with the pyramid underneath, that is one
  frame of stand-in.
- **Partial re-raster inside a plate.** An erase step dirties a rect far smaller than a plate.
  `renderPlate` can take a clip box (fill and resolve only those rows and columns) and the
  result be copied into the existing bitmap, so a bake step costs the ink under the mark, not
  four whole plates.

*Trade-off.* Octave levels blur up to 41 % between rests where quarter-octaves blur 19 %,
in exchange for four times fewer full-screen rasters during a zoom and no hold/switch
state machine. If 41 % is judged too soft, keep quarter-octaves inside the same design
(the lookup is unchanged; only `round(log2 Z)` becomes `round(4·log2 Z)`), and keep the
rest raster as the crispness at rest. Sync mode as a *mode* is gone either way.

### 4.2 An incremental render list (replaces listFor rebuilds, `_footBelow`/`_drawnRectIn`, neutral events, `_uncut`, done snapshots, `_eraseListStale`)

- Per camera frame, a persistent item table ordered by z: `{id, z, kind, geometry ref,
  box, residual, family, erase flag}`. Items come from the frame's own natives and from the
  visible tiles' pieces (TileStore already patches those in place) and the re-routed moved
  objects.
- Document events update the table in O(log n): remove deletes, add inserts, change replaces
  (keeping the old box), an offsets-only change updates the residual (keeping the old box).
  Pieces already carry z, colour, opacity and edit id from the derive step; add the erase
  flag there so the per-item document lookup disappears.
- **Plate dirtiness comes from the table's deltas, not from document events**: an item update
  dirties the plates (every level of this frame) overlapping old box ∪ new box. That is the
  single invalidation rule; ids per plate, rect footprints and table histories are no longer
  needed.
- Marks: a mark is an item with the erase flag; an item is masked by a mark iff its z is below
  the mark's, the mark's id is not in the item's `handledBy` set (a property of the object,
  10.2), and their boxes meet. The packer reads items and marks in one generation and stamps
  the job with it. A cut is a remove plus adds, which dirties the mark's plates and re-rasters
  them in the workers; no list rebuild, no neutral flag, no done snapshot. If a steady stream
  of cut steps is measured to cost too much worker time, coalesce dirty plates per animation
  frame (they already are, by the compose cadence).
- Every change to the table increments its generation G; jobs and plates carry G and a plate
  cell records the G of its last dirtying, so "fresh" is one integer comparison (10.1).
- Each item exposes its geometry as drawn through one accessor (`placed`, 10.5); the pack,
  the hit test, the ants, the lasso and the erase all read through it.
- The hit test, the ants and the drag read this table; it is never stale (fixes D3).

*Cost.* A full rebuild is still needed on a crossing and when the visible tile range
changes; those are rare and already paid today. Everything else becomes an insert or delete.

### 4.3 Pack once per generation, one job identity (replaces per-strip packs and string quanta)

- Geometry is packed once per (frame, generation) into one buffer; workers receive it once
  (a copy per worker, or a `SharedArrayBuffer` where cross-origin isolation allows) and jobs
  after that carry only plate lists. Drop the memo's second copy of every loop; the Loop's
  own `Float64Array` is already the wire format.
- A job is `{frame, level | "rest", i, j, generation}`. It is skipped at dispatch or dropped
  at arrival when its generation is not the plate's current one. Priorities: rest for the
  view > pyramid for the view > drag layers > prefetch > thumbnails. No quantum strings, no
  `stillWanted` callbacks, no epoch arrays in the message.
- Keep `rasterCore` as is (coverage, union, occlusion, masks). For D2: a mask is a 1 MiB
  float32 plane per worker, so raise the cap to 16 (16 MiB a worker), merge marks that no
  masked item lies between in z into one slot (their union is then exact), and paint any
  mark past that as plain white ink, which is right for everything except a done piece
  under it. Option, simpler still: paint every pending mark as white ink and paint the done
  pieces *after* it; wrong only where a done piece overlaps unhandled higher ink under the
  same mark (the out-of-order barrier case), and unusable on the drag layers' transparent
  paper, which is why the mask exists.

### 4.4 Three fixed drag layers (replaces MovePlane's runs, merging, quick level, stopgap tags)

- At drag start, three plate sets at the current level covering the selection's box ∩ the
  view grown by one screen (fixes D1): BELOW = unselected items with z under the lowest
  selected item; SEL = the selected items on transparent paper; ABOVE = unselected items
  with z over the lowest selected item, transparent paper. If SEL exceeds the plate budget,
  coarsen one octave at a time.
- During the drag: compose BELOW, SEL translated by the pointer delta, ABOVE. Until SEL is
  ready, draw the normal picture with the selection still in place (the main-thread stopgap
  stays for small selections, it is cheap and it is the common case).
- The item table treats selected items as *held*: their residual changes during the drag do
  not dirty plates. At the drop they dirty old ∪ new boxes, the normal picture re-rasters,
  and the drag layers stay composited until those plates are fresh (bounded hold), then go.
- No speculative pre-aim; a drag that starts shows the stopgap or the picture for the one or
  two frames the layers take.

*Trade-off.* Today up to five layers keep the exact z of unselected ink sandwiched between
selected runs; three layers draw all sandwiched unselected ink above the selection during the
drag only. Option: two layers (selection on top while dragging, as most editors do) if the
exact z during a drag is not worth a layer.

### 4.5 Live stroke: keep it, with one simplification

- The SVG tail and frozen chunks stay; they use the browser's compositor well.
- At pen-up, when the shape is small enough for the inline executor, paint it into the rest
  set on the main thread in the same frame and drop the SVG path at once; hold the SVG path
  only when the workers must do it. The per-cell clipPath for translucent holds then runs
  only on that slower path.

### 4.6 The bake and its barriers (renderer-adjacent, small)

- Maintain `editGroup`'s map incrementally (key in / key out on add, remove, re-key) instead
  of rebuilding it after every change; keep the pending marks as a set maintained by events
  instead of `_eraseStrokes()` scanning every object.
- Make `cedeVirtual` and `cedeTileById` one function taking a document-like receiver (D4).
- Give thumbnails and every other off-camera read a real budget (D5), and take them out of
  the render path: a thumbnail is a prefetch-priority job on the pyramid.
- Barriers: keep the semantics ("a lasso takes every cut-out"), but let the lasso *select the
  whole target now* and re-target the selection to its pieces when the cut lands (the
  `_reselect` machinery already follows ids through events). The tab never freezes; the ants
  briefly outline the uncut object. Product call; the renderer supports both.

### 4.7 Input

- Coalesce wheel and pointer events to one view step per animation frame (apply the last
  camera state, then one compose). This removes the compose-per-event cost and the
  post/drop churn without touching any of the above.

### 4.8 Tile derivation off the camera's critical path

Today a crossing, or a pan onto tiles that were never derived, bakes those tiles inside
`_render()` on the main thread: 0.3–0.8 s a level on the Magnum Opus (DESIGN), hidden only
when the idle prebake got there first. Off-camera reads already have a budget
(`contentOffCamera` throws `OVER_BUDGET` between bakes); give the camera's read the same
budget. A tile that is not ready is simply absent from the list this frame, the pyramid's
stand-in (the parent frame's coarser level, an exact integer mapping across the crossing)
covers it, and the bake resumes at the next frame or idle slice. With that, the prebake and
the crossing special case disappear into the prefetch queue, and no camera step can stall
on geometry work. Same shape as `ArcBakeJob`: every long bake is a job with a cursor.

### 4.9 Erase throughput: cut in parallel, cut once per target

The erase pipeline is one cut in one worker at a time, ~200 ms a step on the Magnum Opus
(the boolean is 143–175 ms of it). Two changes, both inside the existing job boundary:

- **A pool for cuts.** Cuts of different targets are independent pure jobs; dispatch up to
  one per worker (the raster pool's size) and apply the results in the mark's z order,
  buffering any that arrive early. Descents (which mint frames) stay serialised. Expected
  3–4× on a desktop.
- **One boolean per target, not one per mark.** When several marks are pending over the same
  object and all of them are above it in z, subtract the *union* of their perimeters once.
  Only an object that sits between two marks' z values needs them one at a time. Ten quick
  eraser dabs over a dense area today cost ten booleans per object underneath.
- Keep the pending marks as a set maintained by events; `_eraseStrokes()` scanning every
  object on every tick is the other constant cost of a long bake.

### 4.10 Structure: one object between the document and the renderer

The facade (`KobinEngine.js` plus five mixins) currently owns plate invalidation, the hold
during a drag, moved-rect bookkeeping, the ladder and the prebake, and `erasePipeline`
owns the neutral/uncut flags: the engine knows about plates. With 4.2 in place, all of that
is the render list's job. One object, the *scene*, subscribes to the document, keeps the
item table, computes dirtiness, and is what the renderer reads; the engine talks to the
scene, never to the plate store. On the renderer side, `RasterRenderer` should *compose*
layers (picture, live stroke, ants, chevrons) rather than inherit the SVG renderer: the
inherited `needsReorigin/needsWindowChop/needsFatFlip` stubs, the `_ov` pseudo-scene and
the arc plan exist only because Two.js's machinery is the base class. A small
`LiveStrokeLayer` around one SVG path is all the raster app needs of it; whether Two.js stays
is then a question about the `?svg` renderer and the export, not about the live view.

### 4.11 What is deliberately unchanged

The coverage rasteriser and its family union; the plate cache with stale-until-replaced;
the erase mark as a mask with a done set (the z-lag makes the done set inherent); TileStore's
tiles and patches; the overlay ants; the subtree move; the workers-with-inline-fallback
pattern; the diagnostics ring.

---

## 5. The rest of the app

Performance findings outside the renderer, as read.

**W1. The editor page re-renders on every wheel event.** The hook's `onStatus` throttles
status updates to 50 ms, except that a change of `effectiveZoom` bypasses the throttle and
calls `setStatus` at once. Every wheel event changes the zoom, so a zoom gesture re-renders
the React tree (toolbars, scenes list, banners) at wheel-event rate, on the same thread as
the compose. Throttle the zoom path too, or give the scale bar its own subscription so the
page does not depend on it.

**W2. A piece read allocates three objects.** `Loop.at()` and iteration build a fresh
`{line, A, B, …}` with new coordinate arrays for every piece. The packer and the scene
client read the number buffer directly, but `loopBBox`, `loopsBBox`, the chord estimate
(`itemChords`), the boolean's `flatPieces`, the hit test's `insideTester` and the level
index's `add` all iterate pieces: a list build over 100,000 visible pieces allocates a few
hundred thousand short-lived objects. Walk the buffer for boxes and chords (a bounding box
cached on the `Loop` at construction covers most callers), and leave the piece view for the
boolean, where it is the working representation.

**W3. `editGroup` is rebuilt over every native after any change** (also C9). Selection,
lasso, delete, the indicator, family re-splits and the scene client's `isInk` all ask it.
Maintain the map on add, remove and re-key.

**W4. Load and memory scale with the whole drawing.** A load decodes every frame's
snapshot, indexes every native, replays the log, then the first render bakes the camera's
tiles synchronously (4.8 removes that last part). Memory is the document's geometry (DESIGN:
260 MB in Chrome at load for the Magnum Opus after the Float64 loops), which no renderer
change touches. The store is already per frame and the lattice is spatial, so a *frame-lazy*
document is possible: load the frames within a few crossings of the camera, render, and
bring the rest in at idle or when something asks for them. Everything that assumes the whole
document (the mark's candidate scan across all levels, the lasso's outward walk, scenes,
frame GC, saves) would treat an unloaded frame as "not reachable yet" and fault it in. A
large change with a large payoff for very big canvases; not a renderer item.

**W5. One worker pool.** Today: up to four raster workers, one erase worker, one scene
worker, each its own bundle and buffers, and a cut cannot use an idle raster worker. One
pool with typed jobs (plate, cut, descent, scene batch, thumbnail) and one priority ladder is
smaller and is what 4.9's parallel cuts need anyway.

**W6. Thumbnails** (D5): budget them and schedule them as prefetch-priority pyramid jobs.
A scene whose rectangle lies inside cached plates (the camera's frame and its pyramid) can be
made by scaling those plates down, with no raster and no tile bake at all; only scenes far
from the camera need a job.

**W7. Garbage from the boolean.** A cut allocates piece objects for both operands and every
fragment; inherent to `arcShape`'s working representation and fine at one cut at a time, but
it is the pause you will see if 4.9's parallelism is done on the main thread instead of in
workers. Keep cuts in workers.

**W8. Fine as read:** the per-frame IndexedDB reads, autosave's per-frame re-encoding of
forced frames, the op log's growth by erased geometry until compaction, the undo/redo step
index (bounded by the 200-op cap), the level index (2,048-unit cells, "big" objects scanned
linearly), `Document.at()`'s settle-on-read, the scene index in its worker.

---

## 6. Rendering algorithms compared for a dense drawing

### 6.1 What the current design costs, per operation

Derived from DESIGN.md's measurements on the Magnum Opus (42,857 natives) in Kobin's Chrome;
the screen sizes are assumed. Treat as order-of-magnitude.

| operation | main thread | worker CPU | basis |
|---|---|---|---|
| render list rebuild (crossing, tile range change, erase stale) | 120–220 ms | – | DESIGN §9, "about 50 renders a Magnum Opus bake at 120–220 ms each" |
| one plate at the nucleus, with the occlusion cull | – | 10.8 ms avg | DESIGN §9 (165–580 ms before the cull) |
| one full-screen generation, 1440p at dpr 2 (~77 inked plates) | pack + compose ~10–30 ms | ~830 ms CPU, ~210 ms wall on 4 workers | 77 × 10.8 ms |
| same on a phone (390×844 at dpr 3, ~15 plates) | | ~160 ms CPU on 1–3 workers | 15 × 10.8 ms |
| a 4-octave zoom, octave levels | | ~4 generations | one per level |
| a 4-octave zoom, quarter-octave quanta, pausing at each | | up to 16 generations (most dropped if not pausing) | one per quantum |
| compose, any camera frame | 1–3 ms (≤ 30 stand-ins + view plates) | – | `COMPOSE_IMAGES` 30 |
| one erase step | ~25–60 ms apply/scan/render | 143–175 ms cut | DESIGN §7; 98 steps in 18–30 s |
| drag start, ≤ 40 plane plates | pack | ~430 ms CPU, ~110 ms wall | 40 × 10.8 ms |
| a level of cold tiles for the ladder or a crossing | 300–800 ms | – | DESIGN §9 |

Two things stand out. The worker side is healthy: a whole screen of dense ink is a fifth of a
second of wall time, and the pyramid hides it. The main-thread items (the list rebuild and
cold tile derivation) are the stalls a user feels, and both are removed by 4.2 and 4.8
rather than by a faster rasteriser. A faster rasteriser would shorten the time stand-ins are
on screen, which is the second-order problem.

### 6.2 The alternatives, against this codebase's constraints

The constraints that decide the comparison are particular to bound.less: exact geometry
(float64, arcs, a lattice for precision), families that must fill as one union with alpha
once, pending erase marks that mask the ink below them in z order, unbounded zoom, and a
document that is far larger than the screen.

**A. CPU coverage plates in workers (as built).** Exact, deterministic, identical to the
SVG renderer to a fraction of a pixel (DESIGN §9), and every constraint above is already
met. Its costs are the per-generation full-screen raster (a fifth of a second of wall time
on a dense desktop view), the stand-in blur between generations, and the compositing state
that grew around hiding both. Section 4 keeps A and simplifies the compositing.

**B. GPU stencil-then-cover per frame, no view cache.** Each family: draw its loops as fans
into the stencil with wrap-around increments (nonzero winding for free, union of the
family's pieces for free), then cover its box with the colour and alpha once. This is the
one GPU method that gives the family union and alpha-once without any CPU boolean; it is
NV_path_rendering's method (Kilgard & Bolz 2012). Its problem here is draw calls: two per
family, and a dense screen shows thousands of families whose boxes overlap, so they cannot
be batched into one stencil pass without mixing windings. A browser manages a few thousand
separate draws a frame (6.3), so tens of thousands is too slow on any device.

**B'. GPU triangles, batched.** Baked shapes never self-overlap: a resolved perimeter is an
outer loop with holes, and the pieces of a family are *adjacent* along shared edges, never
overlapping (only stroke bands and legacy fills overlap themselves, which is what
`rasterPack` flags as `union`). Adjacent triangles with bit-identical shared vertices are
watertight under GPU rasterisation, including MSAA: each sample belongs to exactly one
triangle, so a translucent family drawn as separately triangulated pieces does *not*
double-blend at its seams. The condition is that the shared edge reaches the GPU as the same
float32 numbers from both pieces: true when both pieces come through the same derive chain
(the bit-exactness DESIGN §7 builds the cede on), not guaranteed when the two pieces are
mapped from different frames, and for those families a stencil union pass stays as the
fallback. With that caveat, stencil is not needed for baked shapes. Arcs fit the
Loop-Blinn decomposition: triangulate the polygon through the arcs' endpoints (or tangent
intersections for inward bulges), and draw one extra triangle per arc whose fragment shader
computes the circle's coverage analytically and writes it as alpha (a discard would alias:
WebGL2 has no per-sample shading, 6.3), with the test done in chord-relative screen
coordinates so the huge-radius precision problem never appears (an arc whose screen sagitta is
under the tolerance is a chord, the same freeze rule as today). Then a whole tile's ink is one vertex
buffer and the screen is a handful of draw calls: opaque families front-to-back with the
depth test (overdraw of forty backdrops becomes one), translucent families back-to-front.
Erase marks: render each pending mark's coverage into one channel of a mask texture with
stencil-cover (there are few marks), pass each vertex its z, and multiply alpha by
(1 − mask) where z is below the mark's z: the current rule, as a shader. Level of detail:
the triangulation depends on the flattening tolerance, so tiles are triangulated per octave,
as web maps re-tessellate per tile zoom, in the worker, into retained buffers; a live view
then draws at the exact zoom every frame from the current octave's buffers, so there is no
quantum, no stretch, no settle and no sync mode at all. Precision: vertices are stored
relative to a per-view origin in float32, the trick the SVG renderer already uses (0.18 px at
3e6 px, DESIGN §9), with the float64 subtraction done on the CPU before upload. Costs: a new
renderer of some thousands of lines, MSAA rather than analytic antialiasing, a fill-rate
budget on phones that the depth test has to earn, and a second code path for the live band
(stencil-cover per frame, one path, cheap).

**C. GPU analytic coverage (Vello-class, compute shaders).** The best quality and the
closest in spirit to the current rasteriser, moved to the GPU. It requires WebGPU, whose
coverage in 2025–2026 the survey in 6.3 reports; until it is universal it can only be an
optional executor behind the same job interface.

**D. Hybrid: B' for the live view, A's plates only as stand-ins.** With a GPU live view the
pyramid is needed only across frame crossings and for a fallback while a tile's buffers are
being built, so the plate cache shrinks to a few coarse levels. This is the design that
removes the most state, at the price of building B'.

**E. CPU sparse strips (Linebender's 2025 vello_cpu approach).** Instead of a 512×512
accumulation buffer per plate, coverage is accumulated only in thin strips that contain
edges, and flat runs between them are filled directly. For plates where most pixels are paper
or a single flat backdrop, that is most of the work saved; the occlusion cull already wins a
similar amount on flat backdrops here, so the gain is on the *edges* side of dense ink. A
drop-in change inside `rasterCore` with no effect on the rest of the design; worth
measuring after the compositing simplification, not before.

### 6.3 What the survey found (September 2026)

Researched by a subagent from primary sources where reachable; figma.com, blog.google,
raphlinus.github.io, skia.org and linebender.org were blocked from its sandbox, so the Figma,
Skia Graphite, Impeller-MSAA and Levien-2025 statements rest on search excerpts. Figures
marked *est.* are its order-of-magnitude estimates.

**Web-map pyramids.** MapLibre GL JS picks the tile level with `floor` for vector sources
(drawn at 1–2×, since vector re-renders sharply) and `round` for raster (0.71–1.41×, the
rule 4.1 proposes); Leaflet rounds; Google Maps enables fractional zoom by default only for
vector maps. For an ideal tile without data MapLibre's TileManager keeps loaded descendants
up to 3 levels down and, if they do not cover it, the nearest ancestor up to 10 levels up;
Leaflet keeps parents 5 up and children 2 down; nothing is removed before its replacement
has data, raster tiles fade in over 200–300 ms, and each tile gets a stencil id so every
pixel is drawn from exactly one tile (parents first, children overwrite). Its LRU holds the
tiles in view × 5 zoom levels. Scheduling: MapLibre aborts fetches and queued worker tasks of
tiles that are neither ideal nor retained and drops unfinished lower-zoom tiles when zooming
in; OpenLayers allows 16 loads idle, 8 in flight and 2 new per frame while interacting, none
once the frame has used 8 ms, ordered by 65,536·ln(resolution) + distance from centre; Cesium
skips tiles that will be off-screen on arrival. Workers prepare geometry (earcut, int16
tile-local vertices), not pixels; MapLibre settled on 1 worker in Chrome and up to 3 in
Safari because each re-parses the style (PR #2354, 2023).

**GPU filling.** Stencil-then-cover in WebGL2 (fans with INCR_WRAP/DECR_WRAP, cover quad,
clear) gives nonzero union and alpha-once for free but antialiases only through MSAA
(Kilgard: 4 samples minimum, 8–16 good). Correction to 6.2 as first drafted: MapLibre's fills
are earcut triangles plus an antialiased outline pass on an `antialias:false` context, with
the stencil used for tile clipping; MapLibre 6 added `fill-layer-opacity` ("applied once so
overlapping fills appear as a single surface") through an offscreen framebuffer. WebGL2
multisampled renderbuffers resolve with `blitFramebuffer`; there are no multisample textures
and no per-sample shading. Phones typically give 4 samples (5 coverage levels, against the
effectively 8-bit coverage of 16 sub-scanlines). On tile-based mobile GPUs MSAA is cheap
only while samples stay on-chip: storing Impeller's MSAA stencil on a Pixel 7 Pro gave ~4 fps
against ~80 (Flutter #137302, 2023). Skia Graphite (Chrome on Apple-silicon Macs, 2025)
"relies on MSAA where it can" and falls back to CPU path masks in an atlas; Impeller uses 4×
MSAA everywhere; in both, group alpha is a `saveLayer` offscreen target. Draw calls: an
emscripten benchmark managed 5–6 k separate draws per 60 fps frame against ~450 k instanced.
Analytic GPU coverage: Pathfinder 3 (16×16 tiles, WebGL2, little development since 2020);
Vello (WebGPU compute, exact area or 8/16 samples, layers, clips; paris-30k at 177 fps at
1600² on an M1 Max, "something of a best case"; conflation and GPU memory allocation open;
the 2026 repository moves it to `research/` as experimental and points users to vello_cpu and
vello_gpu, formerly vello_hybrid: CPU strips, fragment-shader raster, a WebGL2 backend, no
mask layers yet); Slug (per-pixel winding from banded fp16 curve textures, built for glyphs,
patent dedicated to the public domain in March 2026). WebGPU (gpuweb status, Sept 2026):
Chrome desktop from 113 and Android from 121 (Android 12+, ARM/Qualcomm), Linux partial;
Safari 26 on all Apple platforms; Firefox 141 on Windows and 145 on macOS ARM, not Linux or
Android. Precision: GPU paths compute in float32; deck.gl uses viewport offsets above zoom 12
and deprecated emulated fp64 as slower for similar precision. Any GPU option needs per-view
origins computed in float64 and arcs re-flattened per zoom band.

**CPU rasterisers.** font-rs (Levien 2016) accumulates signed-area deltas and prefix-sums,
7.6× faster than FreeType at large sizes; FreeType sweeps per-cell cover/area pairs; Skia's
CPU path uses exact trapezoid coverage; Blend2D (analytic cells, bit-vector skipping of empty
cells, JIT) is fastest overall. **Sparse strips** (Stampfl, ETH thesis, Oct 2025; shipped as
vello_cpu): flatten to lines, list the 4×4-px tiles each line crosses, sort, merge horizontal
neighbours into strips, compute coverage only inside strips, and record for each strip
whether the gap to its left is inside the shape, so interiors are implicit spans and empty
space costs nothing. Single thread on an M1 Pro: an unaligned 256² rectangle 14 µs against
Skia's 50; a 40-vertex self-intersecting nonzero polygon 68 µs against 275 (Blend2D 11 and
54); eight threads give 3.4×. Weakness: tiny segments; at 8×8 px a many-segment shape
spends over 85 % of its time building tiles and strips. A 512² shape caches as ~50 KB of
strips against 262 KB of coverage. Caveat for this app: accumulated winding is less exact
than 16 sub-scanlines where a family's contours overlap inside one pixel (Vello #1953, Sept
2026, proposes sub-pixel sample masks in strips).

**Retained-canvas apps.** Excalidraw keeps one offscreen canvas per element (dropped when the
element's size or points change, rebuilt on zoom change except during a pinch or wheel zoom,
reset 300 ms later), so a drag re-blits cached bitmaps in z order and stays exact. tldraw
keeps a DOM/SVG node per shape under a camera transform, culls off-screen shapes with a
spatial index, and drops shadows and sketchy strokes when zoomed out. Penpot 2.16 (2026,
beta renderer, Rust/Skia in WASM) uses 512 px tiles keyed by scale, at most 1,024 cached
textures, renders visible uncached tiles first, then cached, then prefetch, over a scaled
whole-document atlas of at most 4,096 px; users report "huge pixelated artifacts and missing
tiles" while zooming (#10155). Figma has run a tile-based GPU renderer since 2015, on WebGPU
since Sept 2025 with a WebGL fallback; nothing public on its invalidation. Photoshop keeps 1–8
downsampled cache levels; Krita's Instant Preview paints on a downscaled canvas while the
full result computes. tippecanoe preserves the density of sub-pixel polygons by emitting a
pixel-sized placeholder each time a pixel's worth of area has accumulated.

**Erase.** The multiplicative mask is PencilKit's `PKStroke.mask` and SVG `<mask>`, and has
the maths of a zero-opacity shape in a PDF knockout group: correct on any backdrop, exports
with transparency, commutes with family alpha; every plate under a pending mask must evaluate
it; multiplying coverages conflates where an erase edge and an ink edge coincide (0.5 × 0.5
leaves a 25 % fringe, Vello #49), which sub-scanline span subtraction shrinks to the
sub-scanline quantum. On a GPU, destination-out into an isolated transparent ink layer at the
erase's z, then paper composited underneath, is per-sample under MSAA and fringe-free, at the
cost of an offscreen layer. Background-coloured ink (Xournal++ "whiteout") is trivial and
correct only on a uniform known backdrop, never over grids, images, dark mode or a
transparent export.

### 6.4 Comparison for this workload

The subagent's table, lightly edited. "100k pieces" is the dense screen; 0.5–2 M segments
after flattening at 1/16 px; ~10⁸ typed-array operations a second per phone core in JS and
about 4× that per desktop core; B assumes 3–5× fan overdraw at 4× MSAA; C scales Vello's
M1 Max result to a phone GPU with 1–5 % of that throughput.

| option | per frame, 2020 mid phone / 2023 desktop | memory | antialiasing | extreme zoom | translucent family / erase mask | size, risk | browsers |
|---|---|---|---|---|---|---|---|
| **A** CPU plates in workers (today) | cached: ~1–3 / <1 ms compose; full-view re-raster ~10³ / ~10² ms wall across the pool (est.) | 1 MiB per inked plate, ~50–150 MB with a pyramid (est.); iOS caps canvas memory at 224–384 MB if plates were canvases | very high: 16 sub-scanlines, exact union | exact: float64, 1/16 px | native / pixel multiply (fringe at coincident edges) | exists | all |
| **B** GPU stencil-cover, no cache | ~30–100+ / ~5–15 ms if batched to a few thousand draws, plus re-flattening (est.) | ~80 MB MSAA colour+stencil at 2.6 Mpx unless on-chip; 10–50 MB vertices (est.) | 4× MSAA phones, 8× desktop; conflation-free | float32: per-view origins, re-flatten per band | alpha-once via stencil / dest-out layer; z-order limits batching | medium; high on phones (draw calls, MSAA cliff) | all (WebGL2) |
| **C** GPU compute, Vello-class | ~10² ms (est.) / ~3–10 ms (paris-30k 5.6 ms on M1 Max, best case) | scene-dependent GPU buffers; allocation unsolved | exact area or 8/16 samples | float32; arcs to cubics per band | layer alpha / dest-out or clip | large: WASM + WebGPU + fallback; upstream calls it experimental | WebGPU only; A still needed |
| **D** GPU live view + plate stand-ins | desktop as B or vello_gpu; phones mostly fall back to A (est.) | A + B | two looks; a pop at the handoff unless matched | live view as B/C, plates as A | both paths must agree exactly | largest | WebGL2 (+WebGPU) |
| **E** CPU sparse-strip plates | cached as A; re-raster ~1–4× faster, most at close zoom (est., thesis ratios) | as A; ~5× smaller if cached as strips | exact area in strips; keep sub-scanline masks for exact union | exact, as A | strips per family / strip intersection | small–medium, low: a JS port, or vello_cpu via WASM SIMD | all (WASM SIMD: Safari 16.4+) |

### 6.5 What the survey changes in the recommendation

- **A stays the base, on every device.** The estimates put a GPU live view at 30–100 ms a
  frame on a 2020 phone even when batched, and the MSAA store cliff on tile GPUs is a
  failure mode that no amount of design avoids. D would therefore be a desktop-only second
  renderer, which is more code to keep agreeing, not less. Defer B/C/D; the thing to watch is
  vello_gpu (CPU strips feeding a fragment-shader raster with a WebGL2 backend), which is E
  with the last step on the GPU.
- **E is the one rasteriser experiment worth running**, inside `rasterCore`, after the
  compositing is simplified: it wins most on close-zoom plates (mostly paper or flat
  families) and little on the zoomed-out dense plates full of 4 px pieces, and it must keep
  the 16-sub-scanline union for the bands and any family whose contours overlap in a pixel.
  Measure both plate classes before adopting it.
- **Pyramid rules, confirmed and sharpened** (4.1): round to the nearest level (MapLibre's
  raster rule); keep descendants up to 3 levels down and ancestors as far up as needed until
  the ideal level lands; never remove a plate before its replacement exists; and draw *every
  pixel from exactly one source*. The lookup in 4.1 does that by construction, which is what
  keeps translucent ink from double-blending where a stand-in and a plate would otherwise
  overlap; today's greedy cover relies on plates being opaque paper.
- **A scheduling policy for the pool** (4.3), from OpenLayers and Cesium: while the camera is
  moving, admit at most a few new plate jobs per frame, none once the frame's budget is spent;
  order by level distance then distance from the screen centre; and skip a job whose plate the
  camera's current velocity will carry off-screen before it can arrive. Today only the
  preview and the pending-quantum requests are sorted centre-out; the view's own plates, the
  settle plates, the ladder, the prebake and the drag layers go row-major from the top-left,
  and strips are contiguous chunks, so the first worker takes the top rows. Sort every request
  by distance from the attention point (the screen centre, or the wheel/pinch focus during a
  zoom and the pointer during a drag) and *deal* the sorted plates round-robin across the
  strips, so every worker starts near the centre. A fade-in of 150–300 ms
  for arriving plates is an option against the stand-in-to-exact pop; it costs a compose per
  frame during the fade.
- **Density-preserving cull** (option, for dense drawings zoomed out): objects under the fade
  band vanish today. tippecanoe's rule, accumulate their area and emit a pixel-sized mark
  each time a pixel's worth has gathered, keeps a scribble's darkness at any zoom for the
  price of one counter per plate cell.
- **Per-object bitmaps for drags** (Excalidraw) keep exact z by re-blitting cached bitmaps in
  order; rejected here because a dense screen would mean thousands of `drawImage` calls a
  frame. The three-layer split (4.4) is the right shape for this workload, as the survey's
  own conclusion also says.
- **The erase mask is the right primitive**, and the reasons are stronger than "it works
  today": it is correct on any backdrop (a grid, an image, dark mode, a transparent export)
  where white ink is not, so keep it even where white ink would be simpler now. Its one flaw,
  the fringe where an erase edge coincides with an ink edge, is already reduced by the
  sub-scanline union and would be removed by per-sample destination-out on a GPU.
- **Workers.** MapLibre's one-worker choice came from per-worker style parsing, which this
  app does not have; three or four raster workers are right, but the per-strip geometry copy
  is the cost to remove (4.3), and a phone should keep its 56 MiB plate budget: the iOS canvas
  memory cap is a reason not to hold plates as canvases.

---

## 7. An order to build it in

Each step is shippable on its own and measured before the next.

1. **Coalesce input to frames and throttle the zoom status** (4.7, W1). One afternoon;
   removes a class of churn before anything else is measured.
2. **Incremental render list with delta-based dirtiness, as the one scene object** (4.2,
   4.10), carrying the generation number (10.1), `handledBy` on objects with the pure mask
   rule (10.2), and the `placed` accessor (10.5). The biggest win on dense drawings and the
   enabler for deleting the erase bookkeeping and the `_footBelow` history. Keep the old
   rebuild behind a flag for the browser comparison DESIGN insists on, and land the property
   tests of 10.9 with it.
3. **Pyramid compose + rest raster + one prefetch queue + budgeted camera tiles** (4.1, 4.3,
   4.8). Delete sync, settle, hold, pending, preview, carry, the greedy cover and the crossing
   prebake in one change, with the quantum step a constant so octave vs quarter-octave is a
   measurement, not an argument.
4. **Three-layer drag** (4.4). Fixes D1 and deletes most of MovePlane.
5. **One worker pool, parallel cuts, one boolean per target** (W5, 4.9).
6. **Bake-side and hot-loop cleanups** (4.6, W2, W3): incremental `editGroup`, marks set,
   one cede, budgeted thumbnails, mask count, buffer-walking boxes and chords.
7. **Pool scheduling policy and the sparse-strip experiment** (6.5): admission per frame,
   velocity-based skipping, then sparse strips inside `rasterCore` measured on close-zoom and
   zoomed-out dense plates separately, adopted only if both hold.
8. **Seam flags on pieces and ants by flag** (10.4); **ids as the selection's truth** with
   frames derived (10.7); the lasso re-judging pieces instead of blocking (10.8, Kobin's call).
9. **Zoom-out work** (8.3): warm ancestors early, cheap layers first, adaptive resolution under
   motion, pack-time level of detail; then the frame summary atlas if paper remains.
10. **Options to decide separately:** event-sourced undo for erase steps (10.6); the frame-lazy
    document (W4); the density-preserving cull for zoomed-out dense drawings (6.5); a fade-in
    for arriving plates (6.5). A GPU live view (6.2 B′/D) is deferred on the survey's phone
    estimates; revisit when vello_gpu or a WebGPU-class analytic renderer is mature on the
    devices the app must run on.

---

## 8. Fast zoom-outs and paper

### 8.1 Why this project shows paper on a zoom-out

A zoom-out of three or four *levels* in a second or two is three or four frame crossings,
each a factor of 4,096. Every crossing lands in a parent whose picture never existed at any
resolution, and starts three latencies in series, all on a cold parent:

1. **Tile derivation, main thread.** The parent's down tile projects every deeper frame's
   natives (pruned by the frame-extent culls) and its up tile chains from the grandparent:
   0.3–0.8 s a level on the Magnum Opus (DESIGN §9).
2. **The list rebuild**, 120–220 ms.
3. **The raster**, about 0.2 s of wall time for a dense desktop screen (6.1).

Meanwhile the stand-ins the design has are all too small or too late for this case:

- The **carry** is the old view re-projected: after two octaves it is a sixteenth of the
  screen, a centre patch.
- The **preview** (8 quanta coarser) covers the *current window* only, so it refines that same
  patch, not the surroundings; and with the fallback filter `FB_Q_HI = 8`, plates finer than
  the view by more than two octaves are not even considered as stand-ins.
- The **prebake** of the crossing target starts when `inScale < exit × 1.25`, the last third
  of an octave before the crossing, and covers the current window mapped into the parent, the
  child cell. On a fast zoom the camera is in that band for tens of milliseconds.
- The **ladder** needs the camera to rest 300 ms, is restarted on any camera move, builds one
  budgeted list per rung (each a cold level on a dense drawing), and caps a rung at 24 plates,
  which is about a third of a 1440p screen at dpr 2. Even a finished ladder shows paper
  around a centre third.
- The **plate budget** (96 inked plates) cannot hold a screen's worth of stand-ins for several
  coarser levels: one full screen at any level is ~77 plates at 1440p dpr 2.

So during the zoom the screen is: a shrinking correct patch in the middle, paper around it,
then plates popping in level by level. That is the "chunky" look, and no amount of
scheduling removes it while a coarse picture of the surroundings costs a cold tile bake plus
a list plus a full-resolution raster.

### 8.2 What is particular to the lattice

- **The ancestor chain is short and view-independent.** Down tiles are judged at the frame's
  deepest zoom (`enter`), so a parent's tiles do not depend on where the camera is inside the
  child. They can be warm *before* the zoom-out starts, and they stay valid (patched by
  document events) until evicted. `framesLeft` already keeps the ancestor chain's tiles.
- **A parent's screen is its cells.** After a crossing the screen shows the child cell (about
  4,096 px at the crossing) and, as the zoom continues, more and more of the parent's 4,096 ×
  4,096 cells. Content arrives cell by cell, from frames that were never on screen.
- **Zoom-out is unbounded but the picture is not.** At a deep zoom-out a dense drawing is
  thousands of sub-pixel pieces per plate: expensive to ship and to walk, and invisible one
  by one. The information on screen is *density*, not shape.
- **Zoom-out is the common big move.** Zoom-in is bounded by the pen (you zoom in where you
  drew); zoom-out is how people look around. The idle budget should lean that way.

### 8.3 Design options for zoom-out

Each option says what the user sees. They combine; Z1–Z4 are the ones I would build.

**Z1. Warm the ancestor chain early, and keep it.** Whenever the camera is in the lower half
of a frame's zoom range (below `inScale ≈ 2`, six octaves above the crossing), derive the
parent's tiles for a window of one screen around the child cell at idle, budgeted (4.8), and
do the same one level further up when that is done. At the crossing the parent's list is
then a concatenation, not a bake. *Sees:* the first level of a zoom-out fills in ~0.3 s
instead of ~1 s. *Costs:* idle main-thread time after every crossing up; a few tiles of
memory per ancestor.

**Z2. Paint the cheap layers first.** The parent's own natives and its up tiles are cheap (the
strokes drawn *at* that level, magnified content from above); its down tiles (the detail
from below) are the expensive part. With a budgeted list (4.8) and the item table (4.2), post
plates for own + up content as soon as they are ready and add the down content as it
arrives, as a new generation of the same plates. *Sees:* the big strokes of the wider drawing
appear at once, the fine detail fills in over the next half second; nothing is paper where
anything was drawn at the coarser level. *Costs:* plates rastered twice per level during a
zoom-out; sensible only because Z3 and Z4 make each raster cheap.

**Z3. Adaptive resolution while the camera moves.** While the zoom is moving faster than a
threshold, request the *whole screen* at a level two octaves coarser than the view (plates of
a sixteenth of the pixels) and draw them stretched; the rest raster (4.1) replaces them at
the stop. This generalises the preview from "the centre patch" to "the screen". *Sees:* a
blurry but complete picture during the motion, sharp within a frame or two of stopping;
never paper for content whose geometry is ready. *Costs:* blur during motion (the survey's
maps do exactly this); a generation of small plates per two octaves.

**Z4. Level of detail at pack time.** When `packJob` bins an item whose box at this plate's
zoom is under about two pixels, ship a four-vertex quad (or a dot) of the same area instead
of its geometry, and accumulate the ones under a quarter pixel into a per-cell density that
is emitted as one mark per pixel's worth of area (tippecanoe's rule, 6.3). *Sees:* at deep
zoom-outs a dense scribble stays a dark smudge of the right darkness instead of vanishing or
being drawn from thousands of slivers; no visible change at working zooms, where the
threshold is never reached. *Costs:* two orders of magnitude fewer bytes shipped and edges
walked for a far plate of a dense drawing (a 3,000-piece scribble that is two pixels tall
ships 8 doubles, not 24,000); a dot is not the exact silhouette of a two-pixel blob. This is
also the fix for the union pass's worst case (9.3).

**Z5. A frame summary atlas.** Keep, for every frame that holds ink, one small bitmap (128² or
256²) of that frame's whole subtree, all summaries packed into one atlas canvas so that
drawing many of them is many sub-rectangle blits from one source (Chrome's slow path is many
*distinct* scaled images). Maintain at idle: a frame whose content changed is re-rendered as
one tiny plate job. At any zoom where a frame is at most its summary's size on screen, draw
the summary until real plates arrive. *Sees:* on a deep zoom-out every cell that has ink shows
something within a frame, however cold the parent; paper only where nothing was drawn.
*Costs:* 64–256 KiB per inked frame (a few MB for hundreds of frames), a small idle job per
edited frame, one more source in the compose lookup (4.1: after the pyramid, before paper).

**Z6. Lean the prefetch toward coarser levels**, and hold stand-in levels at quarter
resolution (a plate rendered at Zq/4 and drawn ×4 costs a sixteenth of the memory), so two
or three coarser levels of the *whole screen* fit in a few MB rather than 77 MiB each.
*Sees:* a soft but complete picture immediately on a zoom-out of up to two octaves, sharp
after the rest raster. *Costs:* idle worker time; the survey's maps keep five levels around
the view for the same reason.

**Z7. Smaller jobs while the camera moves.** A ten-plate strip runs to completion even when
its plates are obsolete, and a fast zoom makes most in-flight plates obsolete. Post one to
three plates per job during motion and full strips at rest. *Sees:* stand-ins replaced
sooner. *Costs:* message overhead per plate (~0.1 ms).

Expected effect on the 3–4-level zoom-out on a dense drawing, as estimates: today ~1 s of
mostly paper per level; with Z1 + Z3 + Z4 a complete blurry picture within ~0.2–0.4 s per
level (the tile bake is the remaining wait, hidden by Z1 when the chain is warm); with Z5
something on every inked cell within one frame at every level; with Z2 the coarse strokes
of each level first. The subjective choice is **blur versus paper**: every option above
trades the second for the first, and only Z4 changes what is *drawn* (dots for sub-pixel
blobs).

---

## 9. The low-level path: pack, transfer, plate, compose

Read for cost. The shape of the pipeline is right: signed-area accumulation is the correct
primitive for shapes that have winding 1 everywhere (every baked shape does), arcs are
flattened centre-free, buffers move by transfer, results come back as bitmaps, the buffer
pool recycles job arrays, and the accumulation buffer is float32 (half the bandwidth of
float64 for an error far below a level). The costs that matter are specific.

### 9.1 Pack, on the main thread (`rasterPack.packJob`)

What it does per strip: a family prepass over the list (memoised per list and per
(quantum, dpr, cfg, live, only, omit, offset) key, so a quantum change during a zoom runs it
again: O(items) plus a sort of the families), a plate binner (each item's box against the
strip's plates), a union decision per family (sub-ring box tests, capped at 20,000), then a
copy of every drawn item's geometry into one job buffer, and a mark-bit pass O(items ×
marks).

- **Geometry shipped is full resolution regardless of size on screen.** The far-zoom dense
  plate is the worst case: thousands of pieces of a pixel or less, each shipped whole and each
  walked record by record in the worker. Z4 (pack-time LOD) is the fix, and it is a pack-only
  change.
- **The memo keeps a second copy of every visible shape's numbers** (`flattenGeom`, 10 MiB
  LRU, thrashing on dense views). A single-loop shape's `Loop.buf` *is* the wire format;
  reference it and concatenate only for multi-loop shapes. The copy into the job buffer is the
  one copy that stays, unless the geometry lives in a `SharedArrayBuffer` (9.2).
- **Per-strip repacking.** An item is copied into every strip whose plates it touches;
  screen-spanning backdrops are copied once per strip, small items once. Packing once per
  generation (4.3) makes the strip a plate list.
- **`scanNums` walks every number of a shape for finiteness on first build.** Fine once; it
  is the kind of pass that should happen at `Loop.from`, not at render.
- **The DRAWN test in the worker repeats the binning.** Each plate tests every item in the
  strip's job against its box; the binner already knows which items touch which plate.
  Sending per-plate item index lists removes an O(items) loop per plate: trivial at working
  zoom, a few ms per plate at far zoom before Z4.

### 9.2 Transfer

- `postMessage` with a transfer list moves the job's buffers without copying, and the worker
  hands the arrays back (`recycled`) for the pool. Good.
- **Results:** the worker creates an `ImageBitmap` per plate with `await createImageBitmap`
  *inside the plate loop*, so raster and bitmap creation are serialised. Raster all plates
  of the strip into per-plate buffers (from the pool), then create the bitmaps together.
  Where `createImageBitmap` is missing, pixels come back and the main thread makes the bitmap:
  the same 1 MiB copy, on the wrong thread.
- **Bitmaps versus pixels.** A bitmap costs a copy on creation and a GPU upload on its first
  `drawImage`; a pixel array costs a `putImageData` (a CPU blit) on every compose that needs
  it. For plates drawn many times, bitmaps are right; for the sync path, which draws each
  plate once, `putImageData` is right, and that is what it does.
- **SharedArrayBuffer** would remove the pack copy and let every worker read one geometry
  snapshot. It needs cross-origin isolation (COOP `same-origin` plus COEP), and COOP
  `same-origin` breaks Firebase's `signInWithPopup` (`signInWithRedirect` works). A hosting
  and auth decision, not a renderer one; the gain is a few ms per generation.

### 9.3 Populating a plate (`rasterCore.renderPlate`)

A cost model, per plate (estimates; the worker timings ring, `rasterPerf`, can confirm them):

| step | cost | when it dominates |
|---|---|---|
| paper fill (`u32.fill`) | ~0.1 ms | never |
| DRAWN box test | O(items in the strip) | far zoom, before Z4 |
| mask pass, per pending mark | deposit + O(rows × width) resolve into a float32 plane | many marks over one plate |
| occlusion probe, per candidate | deposit + `fillsPlate` full scan (262k) + clear: ~1–2 ms | families whose box covers the plate but whose shape does not (rings, U-shapes): each is a miss at full price |
| edge deposit (`addEdge` → `depositRun`) | ~tens of ns per row crossed | long edges at close zoom (a full-height edge is 512 row steps) |
| arc flattening (`emitArc`, `arcDepth`) | one `hypot` + `tan` for sub-tolerance arcs; a small subdivision otherwise | fine either way |
| per-family overhead (`beginFamily`, `resolveFamily`, `clearFamily`) | O(rows touched) + O(pixels touched); ~0.2–1 µs for a tiny family | thousands of tiny families per plate at far zoom (a few ms) |
| union pass (bands, overlapping families) | rows × 16 sub-scanlines × active edges, edges bucketed by row | see the worst case below |
| ids per plate (`idsForPlate`) | O(items) + sort | far zoom; unnecessary with 4.2 |

Findings and trade-offs:

- **The union pass has a cliff.** Edges are loaded per band into a fixed table of 16,384
  (`MAX_UEDGE`). If one *row* holds more union edges than that, the band cannot be halved
  further and `walkRowChunked` re-walks the whole band's geometry once per sub-scanline per
  chunk of 16,384 edges: for each overflowing row, 16 × ⌈edges in the row / 16,384⌉ full
  passes over every record of every union item in the family. A 3,000-sample scribble's band
  (a quad per segment, a fan per joint, tens of thousands of edges) collapsed into two rows by
  a far zoom is exactly that case: on the order of a hundred full walks of the band per plate,
  tens of milliseconds, for an object that is two pixels tall. It is the same object DESIGN's
  "4–16 s a plate" insertion-sort fix was about. Z4 removes it for baked strokes (a two-pixel
  band is a quad). For the live stroke it cannot arise (you draw at working zoom). A cheap
  guard is to raise the table and, past it, fall back to coverage accumulation for that band
  (slightly wrong where the band overlaps itself, invisible at that size).
- **Occlusion misses are the expensive kind of nothing.** A candidate is tested by depositing
  it in full and scanning every pixel. Reject early by testing a handful of sampled rows
  first (a row that is not fully covered proves a miss; only a family that passes the sample
  pays for the full scan). Exact, and it turns most misses into microseconds. Option: remember
  per (family, plate cell) that a family filled the plate last generation and probe it first.
- **Winding-1 accumulation is the right primitive for baked shapes, and the union pass is the
  right add-on for bands.** Per the survey (6.3), sparse strips would win on close-zoom plates
  (long edges, big flat interiors) and lose on far-zoom plates full of tiny pieces, and they
  are less exact than 16 sub-scanlines where a band overlaps itself. If tried, keep the union
  pass for bands.
- **Float32 accumulation** is a good trade: the per-row prefix sum's error is ~1e-7 relative
  per add, invisible against 8-bit output, at half the memory traffic.
- **Coverage multiply for masks conflates** where an erase edge and an ink edge coincide
  (6.3: 0.5 × 0.5). Rare in practice (the eraser crosses ink, it seldom runs along an edge);
  the sub-scanline union path would avoid it if ever needed.

### 9.4 The sync path has a fixed cost proportional to screen pixels

`_renderSync` rasterises every visible plate on every camera event and `putImageData`s each:
even for an empty drawing that is a paper fill and a 1 MiB blit per plate, ~77 plates on a
1440p dpr-2 screen, 20–40 MB of copies a frame. `SYNC_MAX_MS` 8 will exit sync almost at
once on such a screen, so the sync path is effectively a phone and laptop feature, and its
"exact zoom every frame" advantage exists only where the screen is small. Any "inline when
cheap" rule (4.1's rest raster) must count screen pixels, not just chords.

### 9.5 Compose

At stretch 1 the compose is one unscaled `drawImage` per plate (fast blits); at any other
stretch the plates are drawn unscaled into the layer canvas once (when dirty) and the layer
is drawn once, scaled. That is the right structure. Two costs to know: Chrome's 2D canvas
slows sharply past about 33 *distinct scaled* images in a frame (the reason for
`COMPOSE_IMAGES` 30 and the reason a frame summary atlas must be one image, 8.3 Z5), and
`fallbackCover` scans the whole plate cache per compose (fine at ~100 entries, gone with the
pyramid lookup).

### 9.6 The ants

Each phase (every 50 ms) repaints the dirty rows of the overlay buffer and blits them with
`putImageData`; ants spanning the screen make that a near-full-screen blit, ~3–6 ms at 1440p
dpr 2, a steady 6–12 % of the main thread while anything is selected. The custom stamping was
chosen because SVG dashing was slow; Chrome's 2D canvas is GPU-backed and dashed strokes of
the runs' paths (`setLineDash`, `lineDashOffset`, exact arcs via `ctx.arc`) may be cheaper.
An experiment, not a recommendation: measure both on a screenful of ants.

### 9.7 Tile derivation is the geometry-side cost

`_bakeUp` runs, per parent piece, a transform, a chop with freeze and a boolean clip to the
tile rect; `_bakeDown` runs, per native of every candidate frame, a projection and a
flatten-and-clip. Both allocate piece objects (W2) and both run on the main thread inside
`_render()` when cold. 4.8 (budgeted, resumable, with the pyramid covering the gap) is the
structural fix; moving derivation to a worker would need the document there and is not worth
it while the budgeted version has not been measured.

### 9.8 Trade-offs by plate type

| plate | what dominates today | accumulation (current) | sparse strips | supersampling | GPU stencil-cover | recommendation |
|---|---|---|---|---|---|---|
| empty paper | fill + bitmap | ~1 ms | same | same | – | skip the job: an empty plate costs 0 bytes in the store already; detect emptiness at pack (no items binned) and never post it |
| one opaque backdrop | occlusion probe + resolve | ~1–2 ms | faster (implicit spans) | slow (every sample) | trivial | fine as is; sampled-row probe for misses |
| few large shapes, close zoom | long edges, resolve over big boxes | good | 2–5× better (the survey's case) | poor | good | the case for a strips experiment |
| thousands of tiny pieces, far zoom | pack bytes, DRAWN test, per-family overhead, union cliff for bands | poor before Z4, good after | worse (strip building per tiny shape) | poor | good (vertices are cheap) but you would still ship them | Z4, then it is cheap everywhere |
| translucent families overlapping each other | normal blend | exact, alpha once per family | same, with the sub-pixel caveat | exact | needs an offscreen layer per group | keep |
| stroke bands (self-overlapping rings) | union pass | exact (16 sub-scanlines) | less exact inside a pixel | exact | stencil handles it | keep the union pass; guard the cliff |
| pending erase marks | mask planes | 1 MiB float32 per mark, multiply per pixel | strips intersect only where both have strips | – | dest-out into a layer, per-sample | keep; cap and merge slots (4.3) |

The single change with the largest effect across this table is Z4, because the far-zoom
dense plate is where three costs meet (bytes shipped, records walked, the union cliff), and
it is the plate a zoom-out needs most.

---

## 10. Correctness: the invariants, where each lives today, and the form that makes it provable

The test of a good structure is that each thing the picture must get right is guaranteed by
*one* mechanism, so the argument is one sentence about that mechanism. Below, for each
invariant: what it says, where the code establishes it today (and why that is hard to
reason about), and the form in which it becomes provable. Section 10.9 lists the resulting
changes to section 4.

### 10.1 "A stale plate never shows once a fresher one exists, and a plate is one consistent snapshot"

**Today.** A per-key epoch in `PlateStore.epochs` is bumped by five kinds of drop; a result is
kept if its epoch equals the current one, or is newer than a stored stale plate (F106); the
arrival is then matched against four request records (`_req`, `_pend`, `_prev`, `_v`) to decide
whether to compose or repost; queued strips are dropped by quantum *string* and frame
sequence; `_dropDead` compares strings against the layer's status. To argue that the screen
never regresses you have to hold all of that in your head, and F106 was the bug that showed it
had not been held.

**Provable form.** One integer, the **generation** G of the scene (the render list), increases
by one on every change to it. Every job is stamped with the G it was packed from; every stored
plate carries its G; every plate cell carries `dirtySince`, the G of the last change that
touched its box. Two rules:

1. A result replaces the stored plate iff `result.G > stored.G`.
2. A plate is exact iff `plate.G ≥ cell.dirtySince`; otherwise it is a stand-in and the
   compose treats it as one.

Then: the stored plate's G is monotone (rule 1), so no arrival can bring back older pixels;
"exact" is a comparison of two integers; a job packed at G read the scene synchronously at G,
so a plate is a consistent snapshot of one document state; and the F106 property (a newer
but still stale result replaces older stale pixels) is rule 1 with nothing added. Coherence
is *per plate*: neighbouring plates may show different generations during a bake, which is
stated rather than hidden. Option: apply arriving plates of one generation together, so the
screen flips at once (latency for coherence). Cancellation (dropping queued or in-flight work
whose G is behind) is an optimisation and cannot affect what is shown.

### 10.2 "Before the bake, the screen shows what the bake will produce"

**Today.** An item is masked by a mark when `f.z < K.z`, the item is not in the mark's done set
as snapshot with the list (`noteListMarks`, F121), and their boxes overlap; the done set is
`_bakeDone` minus `_uncut` (targets whose cut is in the worker or refused over ink); events
raised inside `_neutral()` are tagged and skipped by the plate drain; `_eraseListStale` says the
list is out of date; `_ownChange` keeps the candidate scan valid across the mark's own edits;
`_lowerMark` steps the mark's z. Six pieces of state in three files, and the argument that
they agree is the history of F109, F121 and D3.

**Provable form.** Make "handled" a property of the object in the document: each native
carries `handledBy`, the set of mark ids whose bake has dealt with it (its pieces inherit the
parent's set plus the mark; a refusal adds the mark; the op log's bake entries already name the
mark, so it persists and replays). The mask rule is then a pure function of document state:

> item *i* is masked by mark *M* iff `i.z < M.z` and `M.id ∉ i.handledBy` and their boxes meet.

With the incremental scene (4.2) the list is never stale, the pack reads items and marks in
the same generation, and the equivalence "the masked target looks like its cut pieces" is a
statement about two document states that the plate cannot disagree with, because it was
rastered from exactly one of them. `_uncut`, the done snapshots, the neutral tags and the
stale flag are not needed: a cut is a removal plus additions, which dirties the plates of the
target's box like any other change. Skipping the re-raster when the pixels cannot differ is an
optimisation with its own small proof (target wholly below one mark, no other change) and can
be added later, measured.

### 10.3 "The pieces of one object join without a seam and get their alpha once"

**Today.** True, by three facts that are not written down together: the plate binner includes
every item whose box meets the plate, so every piece of a family that touches a plate is in
that plate's job; the rasteriser accumulates a family's pieces into one coverage buffer and
resolves once with the family's alpha; and coverage is clamped at 1.

**Provable form.** The same three facts, stated as the contract of `packJob` and `renderPlate`,
plus the robustness statement that makes the shared edge safe: *a family's union is
insensitive to last-bit disagreement at a shared edge*: an overlap of one ulp clamps to 1, a
gap of one ulp loses coverage proportional to its width, ~1e-16 px. So the join between a
ceded kid and its parent, or between two cut pieces, is correct whether or not the two edges
arrive as the same bits, provided both pieces are in the same family. The bit-exactness of
the derive chain (DESIGN §7) is still needed for *geometry* (the cede's numbers), but the
*picture* does not depend on it. A test can state this directly: perturb one shared edge by an
ulp and assert the plate is unchanged.

### 10.4 "Ants run along the outer line of the family, never along an internal cut"

**Today.** `overlays._selSeamRects` collects, per traced piece, the `attachRect` of every
family member mapped into the camera frame with that member's table (F125), plus the piece's
own `clip`; `loopRuns` then drops the parts of the loop that lie on those rectangles. Three
sources of seams, one of them re-derived per render through frame mappings that must match the
ones the tiles used.

**Provable form.** Seam-ness is a property of the **piece**, set once by the three functions
that create seams (the tile chop, the window clip, the cede's rectangle cut) and inherited by
`cutLine` when a seam line is cut again; no other operation creates or clears it. The ants
rule is "trace every piece that is not a seam", a local test with no rectangles and no
mappings. Stored pieces (a kid's rectangle edges) need the flag to persist: either a record
code in the loop grammar (a version-3 record beside the canonical line) or, avoiding a format
change, a one-time pass at load that flags the lines of a keyed family lying on its
`attachRect` boundary. Proof: a piece is a seam iff it was minted along a window by one of
three functions, and every later operation preserves the flag.

### 10.5 "A moved object is drawn where it is, and every input is inverted the same way"

**Today.** `listFor` computes `o.res` (the residual at the camera's level) and every consumer
applies it itself: the pack through `attr[4..5]`, the hit test by subtracting from the point,
the ants by `translateLoops`, the lasso by `_rectInActive`, the erase by inverting the eraser
into the object. The invariant is distributed over five call sites.

**Provable form.** The scene item owns the placement: a single accessor, `placed(item)`,
returning the geometry as drawn (or the numeric offset the worker applies), and every consumer
goes through it. One function, one proof. The arithmetic behind it (`objShift`, the digit and
carry walk) stays as it is and is the right subject for a property test: for random tables and
depths, the picture through `F0 + rem` equals the picture through the home frame with the
table applied numerically, to 1e-9 (the registration test already checks the move; this checks
the read).

### 10.6 "Undo of an erase restores exactly what it removed, and a later cut of its pieces follows"

**Today.** `_stepIndex` rebuilds consumed/minted maps over every erase step in both stacks;
`_on` flags are cached on the step objects and recomputed only where undefined; `_stepsUndo`
walks consumers newest-first; `_stepsRedo` re-applies waiting steps to a fixpoint (F118, F128).
Each flag mutation is a place the invariant can break.

**Provable form.** The store already has the machinery: entries carry results and replay is
idempotent (DESIGN §13). Treat undo of an erase as **replay without it**: rebuild the frames the
op touched from their snapshots, applying every logged step except the undone op's, with one
rule added to replay: *a bake step applies only if the object it removes exists*. Then a later
mark's cut of a piece the undone erase minted is suspended by that rule (its source does not
exist), and redo (replay with the op) re-applies it because its source is back. That is F118 as
one line in one function, instead of a dependency index in another. Cost: a replay of the
touched frames' entries since their snapshots (bounded by the store's snapshot rule: 64 KiB or
a quarter of the snapshot), milliseconds. Option, to be measured; the current code stays until
it is.

### 10.7 "The selection stands for the same ink through moves, settles, merges and cuts"

**Today.** `selection.ids` plus `selection.frames`, with `_reselect`, `_followCarries`,
`_flushCarried`, `_keepingSelection`, `_outsideSelection` and the merge handler chasing the
events that move ink across the boundary of a selected frame (F93, F100, F107, F108), and
`_isSelected` consulting families through `editGroup`.

**Provable form.** Ids are the truth: a selection is a set of native ids, and "selected" is set
membership. Two rules keep it true: a bake step that removes a selected id adds its pieces'
ids; a delete removes them. Nothing about frames, settles or carries can change an id, so
nothing needs to be chased. Frames stay as a *derived* move unit: at drag start, a frame all of
whose natives are selected may be re-addressed as a whole (the O(1) subtree move survives),
computed by counting, not stored. The cost is the one DESIGN paid to avoid: enclosing a frame
of 20,000 natives materialises 20,000 ids (about 10 ms and a few hundred KB), once per lasso.
Family membership (`editGroup`) is used only to *expand* a tap to the family at selection time,
never to answer `isSelected`.

### 10.8 "A lasso takes the cut-outs, not the pre-cut object"

**Today.** The lasso is a barrier: every mark whose box meets the loop is baked out inline before
the loop is judged (`_settleLassoErases`), freezing the tab for the remaining bake.

**Provable form.** Keep the loop as drawn (it already is, LD-1/2) and *re-judge*: select the
pre-cut object now; when a bake step later removes a selected object, judge its pieces against
the stored loop and keep those inside. The final selection equals the lasso over the final
document, which is the property the barrier was buying, without the freeze. Option, Kobin's
call; the ants outline the uncut object until the cut lands.

### 10.9 Changes to section 4 that follow

- **4.2** The scene keeps a generation number; every job and plate carries it; plate cells carry
  `dirtySince`; the store's replace rule is `G > stored.G` (replaces epochs). Items expose
  `placed()`; every consumer uses it. Objects carry `handledBy`; the mask rule is the pure
  function of 10.2; `_uncut`, done snapshots, neutral tags and the stale flag go.
- **4.3** Job identity is `{frame, level | rest, i, j, G}`. Scheduling sorts by distance from the
  attention point and deals across strips (6.5).
- **Geometry** Pieces minted along a window carry a seam flag, preserved by `cutLine`; the ants
  trace non-seam pieces (10.4).
- **Selection** Ids are the truth, frames a derived move unit; a cut step re-targets ids to its
  pieces; the lasso re-judges pieces against its stored loop instead of blocking (10.7, 10.8).
- **Undo** Event-sourced undo for erase steps as an option to measure (10.6).
- **Tests as proofs.** Each invariant above has a one-line property test: monotone plate G;
  mask equivalence (masked target versus cut pieces, pixel-diff under AA tolerance); ulp
  perturbation of a shared edge; the placed-read property; seam flags after random cuts;
  selection ids after random carries and cuts. These are cheaper to keep true than the
  mechanisms they replace, and they are what a green suite should mean for this renderer.

---

## 11. Function by function: what must hold, how it is made true, where it is fragile

Read against the code in `review/live-code-changed.js.txt` with context from the full dump.
Marks: **✓** sound as read, with the reason; **~** sound, but by a coincidence or a
distributed obligation rather than by construction; **✗** a hazard (numbered H1–H9,
collected in 11.14 with the redesign's answer). Every ✗ needs a browser before it is a bug.

### 11.1 PictureLayer

- **`_frame(cam, chords, stage)`** ~ One function builds the view (stage 0), the settle request
  (1), the settle view (2), the pending-quantum request (3), the quantised pending view (4)
  and the preview request (5), writing into four different records and returning `null` for
  three of the stages. Each path is short, but "which record did this call mutate" is the
  first question in every bug here. The hysteresis state `_qPrev` persists across the sync
  mode, so the first plates frame after sync compares against a quantum from before it;
  benign (the hold is skipped when there are no hits), but it is state that outlives the mode
  it belongs to.
- **`_syncSwitch(chords)`** ✓ Enters sync below the chord budget, leaves when a frame's raster
  passed `syncMaxMs`, and refuses re-entry until chords halve: a proper hysteresis, and
  `_endHold("sync")` clears the hold on entry so no held quantum survives into sync.
- **`_onQuantumChange` → `_askQuantum` → `_switchQuantum` → `_endHold`** ~ The switch refuses
  when the stretch to the pending quantum is outside [0.878, 2]; a refusal leaves the hold and
  the pending request live, and `_maybeArm` never arms the settle while a hold exists, so a
  refused switch at rest would show a stretched picture indefinitely. The pending quantum is
  always the one nearest the current zoom (within the 0.75-quantum hysteresis), so the stretch
  is within [0.878, 1.139] and the refusal cannot happen except at the exact floating-point
  boundary. Sound, but the guarantee lives in `quantumFor`, not here.
- **`_settleNow` / `_askSettle` / `_settleArrived` / `_publishSettle` / `_onMove`** ✓ A settle
  publishes only when `store.want(_req)` reports no misses and nothing in flight; any camera
  move drops the "e" quantum and unpins it. The request range is recomputed from the current
  camera in `_settleArrived`, which is safe because a move would have cleared
  `_settlePending` first.
- **`compose(plates)`** ~ The order carry → fallbacks → view plates (or layer canvas) → drag
  plane is right for opaque plates, and `_usable`/`_drawable` classify every plate before it
  is drawn. Correctness of "no paper while a stand-in exists" rests on `_planFallbacks` (a scan
  and a greedy budget) having found one, which is a heuristic, not a rule. With `_planeBelow`
  the view's plates inside the plane's below cells are skipped and the below layer stands in;
  if a below-layer plate were missing the cell would show the paper fill, but `pick()` chose
  the level only after `_whole()` saw every plate of every layer, and nothing evicts between
  `pick` and `compose` in the same frame (`_evict` runs in `want`/`put`, both earlier). ✓ for
  that reason, which is a reason about call order.
- **`_composePlane`** ✗ **H4.** In `partial` mode only the `sel` layers are drawn, over the
  normal picture; `_dragOmit` is set only when the plane is whole, and `_holdMove` skips the
  selection's move events, so the view plates still contain the selection at its start
  position. For the first frames of a drag (the stopgap, or the `sel`-only partial plane) the
  selection is shown twice: where it was and where it is. DESIGN describes this state ("the
  selection's own layers alone") without saying the original remains.
- **`_take(rec, b)`** ~ Five outcomes (sync refused, stale, newer, settle/quantum/preview
  arrival, view hit) decided by string equality of quanta against four records in a fixed
  order. If the camera zooms out to exactly the preview's quantum, `_reqFor` answers `_prev`
  before `_v`, and a view plate outside the old preview range is "unwanted": stored, not
  composed until the next camera frame. A latency glitch, not a wrong pixel, but a symptom of
  identity by string.
- **`_keepCarry` / `_drawCarry`** ✓ The carry is redrawn with `globalCompositeOperation =
  "copy"` and papered outside its box and inside the plane's rectangles, so it cannot leak
  old pixels where a stand-in or plane is drawn. It is the fourth stand-in mechanism, and the
  one the pyramid lookup makes unnecessary.

### 11.2 PlateStore

- **`want(view, {pin})`** ✗ **H2.** `pin: "add"` *replaces* `_held` with this request's keys.
  The settle request and the pending-quantum request both use "add", so whichever asked last
  unpins the other's plates mid-flight (`addCallerMismatch` counts it). Under memory pressure
  the unpinned set is evicted, `_settleArrived` or `_quantumArrived` sees misses, re-requests,
  and the two can alternate. Correct in the sense that it converges when memory allows;
  livelock-prone when it does not.
- **`put(rec)`** ✓ The replace rule is explicit: an arrival whose epoch is not current is
  dropped unless the stored plate is itself stale and the arrival is newer (F106), and the
  stored epoch is then the arrival's. Monotone per key. This is the generation rule of 10.1
  written per key with more cases.
- **`_evict()`** ✗ **H1.** Pins (`_pins` = the view, `_held` = settle or pending, `_plane` ≤ 40
  or 56 keys, `_base` = the first ladder rung) are never evicted; when they exceed the budget
  the store is over cap (`overCapPinned`) and every other plate is evicted as soon as it is put.
  An inked plate is 1 MiB. A 1440p display at dpr 2 needs ~77 plates for the view alone, so
  view + settle at rest is ~154 MiB against a 96 MiB cap; a 1080p display at dpr 2 is ~54 + 54.
  On any HiDPI desktop the store is over budget whenever a settle is pending or has published,
  and stand-ins (preview, ladder rungs, the previous quantum) do not survive their arrival.
  This is a first-order cause of the paper Kobin sees on zoom-outs (§8), and it is a policy
  arithmetic, not a bug in any one function.
- **`dropRectPerFrame` / `dropById` / `dropQuantum` / `dropFrames`** ✓ Each bumps the epoch of
  every matching key (in cache or in flight) and keeps stale bitmaps; correct given correct
  footprints from the caller, which is where the obligation moves (11.7).
- **`fallbackCover`** ~ A scan of the whole cache filtered by quantum distance and box, sorted
  by distance; `FB_Q_HI = 8` excludes plates finer than the view by more than two octaves, so
  on a zoom-out the previous view's plates are not stand-ins (the carry covers that case).
  Correct as a heuristic; the pyramid lookup replaces the scan with an index.

### 11.3 RasterRenderer

- **`_frameStep(list)`** ✓ chords → view → drop dead requests → sync or (want → plane step →
  compose → post misses). The plane step precedes the compose so the compose sees the plane;
  misses are posted after the compose so an arrival cannot land inside it.
- **`_packNow` / `PlateStore.beginJob`** ✗ **H3.** A plate's epoch is read at *dispatch*, when
  the pack reads `req.list || this._lastList`. The pixels therefore reflect the list as of
  dispatch, and the epoch says "current as of dispatch". That is right when the list is
  current; it is wrong when the list is stale relative to the document, which
  `syncCameraOnly()` allows: it drains document events (bumping epochs) and then rasters from
  the *unrebuilt* list, stamping the result fresh. Today this is kept safe by three separate
  things: `_eraseListStale` forces a rebuild on the next camera step after a neutral bake, a
  shape bake mutates the own native in place so the old list item *is* the new geometry, and
  drags skip the held ids' events. Each is a reason; none is the rule. The generation model
  (10.1) makes it one: a job carries the list's generation and the list is never behind the
  document.
- **`_stillWanted(req, strip)`** ✓ Refuses at dispatch a request whose quantum is no longer
  live (for on-camera requests) and any plate whose epoch moved since the request. A refused
  plate stays a miss and is re-requested by the next `want`.
- **`_takeResult` / `_deliver`** ✓ Results are epoch-checked on arrival (`resultStale`), the
  layer decides per plate in `_take`, and `_endJob` releases the in-flight slot in `finally`.
- **`endLive` / `_releaseHeldLive` / `_clipHeld`** ✓ A held pen-up path is removed when every
  plate under its box is fresh; a translucent one is clipped to the stale cells whose plates
  do *not* list the stroke's id, so it is never drawn over a plate that already contains it.
  Correct given `ids` per plate, which is a box test (`DRAWN`) and therefore conservative: a
  plate may list the stroke without any of its pixels, and the SVG is then hidden where there
  was nothing to draw. Harmless.
- **`_planeStep` / `_planeStopgap`** ✗ **H4** as above; **`_planeIdle`** ~ pre-aims a plane 150 ms
  after the view goes quiet whenever a selection exists, pinning up to 40 plates (H1 again).
- **`endMove` / `_planeLanded` / `_endPlane`** ✓ A landing holds the plane until every cell of
  the union of the below range and the shifted selection range is fresh, or 3 s; the timer
  path and the arrival path both end in `_endPlane` + `compose`.

### 11.4 MovePlane

- **`_cut(list, ids, view, …)`** ~ Runs alternate selected/unselected in z; a leading unselected
  run is dropped (it is "below" by definition) and its ids are therefore not in `omit`, so the
  below layer draws it: correct, but only because `omit` is rebuilt from the surviving runs in
  `_level`. The merge past five layers folds a sandwiched unselected run into `below` by the
  same mechanism. Cells are `boxes ∩ view` at every level (D1).
- **`_level(runs, view, k)`** ✓ Cell sets per layer at the coarsened quantum; tags include the
  quantum and a hash of the ids so a changed selection can never reuse a stale layer's plates.
- **`pick(store)`** ✓ `main` whole → `quick` whole → `sel`-only partial → nothing; `_whole`
  checks every cell of every layer against live entries.
- **`landCells(v)`** ✓ Union of the below range and the selection range translated by `off`,
  clipped to the view; the compose clips the plane to cells not yet fresh, so the landed
  picture in those cells is exactly the drag picture until real plates arrive.

### 11.5 rasterWorkerClient

- **`submitPlates` / `dropStale` / `pump`** ✓ A newer submit for the same quantum string drops
  older queued strips; `pump` re-checks `current` and `stillWanted` at dispatch. In-flight
  work cannot be cancelled and is epoch-checked on arrival.
- **`bestIndex`** ✗ **H7.** Strips requeued by `failPool` after a worker error are pushed
  without `prio`; `undefined` comparisons make the selection loop pick the *last* such entry
  and the low-priority cap miscount. Ordering only, not correctness, and only after a worker
  failure.
- **`onMessage` / `resultStale`** ✓ Per-plate epoch comparison; recycled buffers returned to
  the pool before any callback can throw.

### 11.6 rasterPack and rasterCore

- **`prepassFor` / `sameFamily` / `famTake`** ✓ The family reuse across lists compares object
  identity, fade, z, edit id, erase flag, memo version and residual per item, in order; a
  changed member invalidates the family. Conservative and correct.
- **`packJob` marks** ✓ A mark's mask box is the union of its items' boxes in the job; an item
  gets a mark's bit iff its family's z is below the mark's, the mark's done set (as snapshot
  with the list) lacks it, and boxes meet. Correct given the snapshot (F121) and the slot cap
  (D2).
- **`renderPlate` pass order** ✓ Masks first (so `maskLive` is known), then the occlusion probe
  (which refuses masked and mask families), then ink bottom-up. A family that filled the plate
  is not re-deposited; its rows are set to the whole plate.
- **`coverCandidate` / `fillsPlate`** ✓ Exact: a candidate must be alpha 1, unmasked, box over
  the plate, and every row's running coverage ≥ 1 − 1/4096 across the plate. Expensive on a
  miss (9.3), never wrong.
- **`resolveFamily` / `resolveMask`** ✓ Coverage = |prefix sum| clamped, times alpha, times
  (1 − mask); the tail past `ROWMAX` is filled when the running sum is non-zero, which is
  exactly the case of a shape leaving the plate on the right. Float32 error is far below one
  level.
- **`depositFamily` sign handling** ~ Non-union items deposit signed area by their own
  orientation; union items deposit runs with `uSign` from the declared family sign or a
  shoelace. A family mixing both kinds with opposite orientations cancels to a hole
  (`mixedWinding`, logged). Correct for the geometry the pipeline produces (resolved
  perimeters have consistent orientation; bands are normalised in `flatten`), not for
  arbitrary input.
- **`unionPass` / `walkRowChunked`** ✓ correct, ✗ costly past 16,384 edges in one row (9.3).
- **`emitArc` / `arcDepth`** ✓ Chord-and-bulge subdivision to a 1/16 px sagitta with forced
  splits above 90°; off-plate sub-arcs become vertical edges at the plate's side so winding is
  preserved; whole turns are split in two. No centre is used for any point on the arc.

### 11.7 KobinEngine invalidation

- **`_drainPlates`** ~ Events for held ids and held frames are *dropped*, not deferred, during a
  drag; `_releaseMove` must then cover everything they would have invalidated: it drops by id,
  by each moved object's start and end rectangles (or their union past 256), by frames under
  the held roots, and by the frame footprints at start and end. It does, for moves; nothing
  else can change a held object during a drag because the bake is held (`_dragSel`) and
  selection barriers ran first.
- **`_drawnRectIn(ev, prev, frameId)`** ✓ New box at the new table, old box (`ev.oldBbox`,
  supplied by every geometry edit through `_afterEdit`), and both at the old table when the
  table moved; mapped per plate frame through `mapRectObj`. `_footBelow` provides `prev`, and
  its clearing past 1,024 entries is D6.
- **`_refilePlates` / `_frameListPlates`** ✓ A re-addressed frame drops every plate of the frames
  under it and every plate whose frame sees the moved cell's reach box at either address,
  through `mapRectF`, which reaches ancestors as well as siblings.
- **`listFor`** ✗ **H8.** Derived pieces copy the object's z when the tile is baked;
  `listFor` patches z from the live object *only for erase marks* (whose z the bake lowers).
  Correct today because nothing else changes z; the reserved `attr` op-log entry for
  per-object z changes would break it silently. The scene item table should read z from the
  object, not from the piece.

### 11.8 erasePipeline

- **`_bakeTickInner`** ✓ Marks are baked lowest z first; the order does not affect the result
  because each mark's targets are filtered by `z < zE` and pieces inherit their parent's z, so
  a lower mark never touches ink above it and a higher mark's rebuilt scan (`_candidatesUnder`
  is keyed on `doc.rev`) sees the pieces a lower mark minted.
- **`_candidatesUnder`** ✓ Rebuilt whenever the document changed by anything but this mark's
  own edits (`_ownChange`); `_nextEraseTarget` re-validates every candidate against the live
  object (exists, not erase, z below, reachable, may touch). Cost is the concern (C9), not
  correctness.
- **`_bakeOne`** ✓ Adds the target to `_uncut` before anything can suspend, adds it to `done`
  before the cut, and returns `"pending"` with the in-flight record holding the target's
  `_ver`; a target changed meanwhile is dropped from `done` on arrival and retried.
- **`_lowerMark`** ✓ Lowers the mark to `zo − 0.5` only when the next target is strictly below
  the handled one, so shared-z targets are finished before the mark passes them; marks get
  half-integer z and no other object ever does, so the step lands between integers.
- **`_applyCut`** ✓ Grazed → whole (uncut deleted, nothing recorded); cut → `eraseReplaceById`
  under `_neutralUnder`, pieces added to `done`, uncut deleted, step recorded (once: the
  multi-region family path records before `_resplitFamily` and returns).
- **`_applyDescent`** ✓ Refused → uncut deleted only if `inkless`, so a refusal *over ink* stays
  masked until `_lowerMark` steps past it (the very next call), then shows whole. Minted
  frames are merged before pieces are added; a piece whose frame is missing bails before any
  removal.
- **`_onCutResult` / `_settleInflight`** ✓ A late worker result for a job the barrier already
  settled inline is dropped by identity (`_cutInflight !== inflight`); the inline descent mints
  frames on the live lattice and `merge` of the returned `minted` list is then a no-op.
- **`_flushErasesFor`** ✓ Handles the in-flight cut for another target of the same mark by
  settling it first, and only lowers the mark when the flushed target was the mark's next in
  order; out-of-order pieces stay below the mark and rely on the `done` snapshot after the
  caller's `_render()`.
- **`_settleSelectionErases`** ✓ (as a barrier) Follows added and removed ids through a temporary
  subscription while it bakes, up to 200 rounds; selected frames force `flushErases()` of
  every mark, which is the freeze.
- **`_settleLassoErases(poly)`** ✗ **H5.** Flushes the marks whose box meets the *lasso's*
  box. A mark outside that box can still trim an object *into* the loop (the object's part
  outside the loop is what the mark removes), and that object is judged pre-cut and left out.
  Rare; the re-judge design (10.8) handles it because it re-judges on every cut of an object
  the lasso considered, wherever the mark is.
- **`_eraseFramesPass`** ✓ A frame is taken whole only when its reach box, grown by the flatten
  tolerance, is inside the mark's ink *and* `maxZUnder` is below the mark, and never the
  mark's own frame; the removal is one bake step with the natives by reference.

### 11.9 Document

- **`eraseReplaceById` / `cedeTileById`** ✓ Pieces inherit z, colour, opacity, tile, a clone of
  the table, and the edit key when the source was keyed or the cut left one piece; a keyless
  object cut into several pieces yields keyless pieces, which is right because a cut of
  non-zero width leaves them disjoint. The cede's kids get `shiftDown` tables and the attach
  rect. The two functions are one body (D4).
- **`_emit` / `offTouchedSince`** ✓ The condition is a double negative but the effect is
  exact: any event on an object with a table, or any offsets-only event, logs the id; any
  event without an object sets `_offWide`; `offTouchedSince` answers `null` (rebuild) if the
  wide mark or the log's truncation reaches past `rev`. Sound; hard to read.
- **`_stepIndex` / `_revertStep` / `_applyStep` / `_stepsUndo` / `_stepsRedo`** ~ Consumers
  revert before producers because a consumer's `_seq` is always greater (it consumed a piece
  that already existed); re-application to a fixpoint re-enables suspended steps whose source
  is back. The `_on` cache is recomputed only where `undefined`, so its truth depends on every
  path that changes step state also setting `_on`; the two that do are `_revertStep` and
  `_applyStep`, and replay assigns `_seq` from entry order so the ordering argument survives a
  reload. Sound as read; the replay-based form (10.6) has no cache to keep true.
- **`detachFrame(frame, rec)` / `insertFrameSubtree`** ~ The partial path (F107) keeps natives
  in `rec.kept`, flags the rest `_gone`, and `insertFrameSubtree` merges the set-aside list
  back beside whatever was drawn since. Three sets (`_detached`, `_detachedLists`, `_reused`)
  and a per-object flag track one fact: "this native is set aside". A `gone` flag on the
  native alone, checked by `getById`, would carry it.
- **`at(level)` / `_settleIfPending`** ✓ A read settles the frame's shift into its natives'
  tables and carries any that cross a cell edge; `list()` and `count()` read as stored. The
  separation is the load-bearing rule of §8 and is honoured by the callers that need
  identity only.

### 11.10 selection and overlays

- **`_lassoFind`** ✗ **H6.** An enclosed frame is one whose reach box (±REACH, invariant 2) is
  inside the loop; every native under it is then taken without a test. A native under it that
  carries a displacement table is drawn up to half a frame away from its stored bits, and
  `_lassoMoved` deliberately skips moved natives under selected frames, so such a native can be
  drawn outside the loop and still be selected: "everything fully bounded" is violated by up
  to half a frame at that level. Grow the enclosure test by the largest residual under the
  frame, or judge moved natives under enclosed frames as `_lassoMoved` does for the others.
- **`_familyBounded` / `_tornUnder`** ✓ A keyed native is in only if every non-erase member is
  found or under a selected frame; a family that fails under an enclosed frame marks the
  frames from it upward as "not whole", and the next pass reads them as straddling (three
  passes at most).
- **`_isSelected`** ✓ Set membership, frame ancestry, or family membership through `editGroup`;
  correct, and the family clause is what 10.7 moves to selection time.
- **`_reselect` / `_followCarries` / `_flushCarried` / `_keepingSelection`** ~ Each follows one
  kind of event that moves ink across a selected frame's boundary. They are consistent with
  each other as read; the invariant they maintain is set membership in 10.7's form.
- **`_hitTest`** ✓ Top-down over the list with the residual inverted per item and an
  `insideTester` memo per object and version; erase marks are skipped; the `only` predicate is
  applied after the geometric test. It reads `_lastList`, hence D3.
- **`_selectionAnts` / `_selDecide` / `_selSeamRects`** ~ Correct given that every internal seam
  is one of: a piece's clip window, or a family member's attach rect mapped by that member's
  table (F125). The mapping repeats, per render, arithmetic the tiles already did; a mismatch
  shows as ants inside the ink. 10.4's flag removes the repetition.

### 11.11 TileStore

- **`_bakeSettled`** ✓ A bake that changed `doc.rev` (a settle it triggered) is run again, up to
  three times; a bake cannot change `rev` on its second pass unless another settle fires,
  which the first pass exhausted.
- **`_addObject` / `_upVia` / `_appendChained`** ✓ Shallower tiles are patched before deeper
  ones so a chained patch reads a patched parent; a tile whose parent squares are not all
  cached and current is dropped rather than patched, which is the conservative choice.
  `tile.patch.test.js` compares every cached tile to a cold bake, which is the right proof.
- **`_removeObject` / `_onDoc`** ✓ A change is a remove plus an add; attribute-only and
  offsets-only events are ignored because tiles are unmoved space, and the z copied into
  pieces is then stale for anything but erase marks (H8).
- **`_reroute` / `_rerouteGroups`** ✓ A moved object is read from the tiles of the frame its
  digits name (`objShift`), grouped with objects that share a frame and remainder; the memo
  is patched from `offTouchedSince` when fewer than half the moved objects changed. Sound;
  the arithmetic of `objShift` is the property-test candidate of 10.5.

### 11.12 Camera and frame GC

- **`Camera._settle`** ✓ Shift, cross up, cross down until nothing changes, guarded at 64
  iterations; `onCross` fires once with the start and end levels.
- **`frameGc.collectFrames`** ✓ Forgets a frame only if it has no natives, kids or shadows, is
  not on the camera's chain or trail, and is named by no undo/redo op; drops its tiles and
  plates; a moved frame's id is retired so a later read cannot mint it again with stale caches
  (F111).

### 11.13 The future options, examined the same way

- **Generation model (10.1).** The rule "a plate is fresh iff `plate.G ≥ cell.dirtySince`"
  needs every change to dirty the right cells. It does by construction if the item table is
  the only source of changes and every item stores its placed box, so the old box is always
  known; the one path to guard is an item whose geometry reference changes without an item
  update (a mutation in place). Forbid in-place mutation of a listed item's geometry, or make
  the table's update the only way to change it.
- **`handledBy` (10.2).** Old op logs have no handled sets; replay can rebuild them because a
  bake entry names its mark. A pending mark across a version upgrade is the only case where
  the derivation matters, and it derives correctly.
- **Seam flag (10.4).** The one wrong case: a *real* ink boundary that lies exactly on a window
  line (a straight stroke edge aligned to the ulp with a tile or cede rectangle) is flagged
  as a seam and loses its ants along that stretch. Today's rectangle test has the same
  behaviour. Vanishingly rare, and it should be stated.
- **Ids as truth (10.7).** A lasso that encloses a huge frame materialises its ids: O(natives)
  once. Frames as a derived move unit need "all natives under F are selected" at drag start:
  O(natives under F) by counting. Both are bounded by the size of what the user selected.
- **Replay undo (10.6).** The added replay rule ("a bake step applies only if its removed object
  exists") is exactly the current `_applyStep` precondition, so the two agree by construction;
  the risk is cost, which the snapshot rule bounds.
- **Pyramid lookup order (4.1).** "Fresh at L, stale at L, coarser, finer, paper" prefers
  resolution over freshness: a stale plate at the view's level can show older content than a
  fresh coarser plate. If that matters, order by (fresh first, then resolution); either way
  the rule is one line and total. Coarser stand-ins covering four cells may be drawn once and
  overdrawn by fresher cells because plates are opaque; only the drag layers are transparent,
  and they are drawn last.
- **Adaptive resolution and pack-time LOD (8.3 Z3, Z4).** Exactness at rest requires that the
  rest raster never uses LOD above a quarter-pixel threshold; LOD at two pixels applies only to
  stand-in levels. A dot for a two-pixel blob is a different shape of the same area; it is not
  a wrong pixel at rest because it never reaches the rest raster.
- **Frame summary atlas (Z5).** A summary lags edits until its idle job runs; it is drawn only
  where no plate exists, so the lag shows only as an older stand-in, never over a fresh plate.
- **Three-layer drag (4.4).** The double-image of H4 disappears only if the view plates are
  re-rastered with the selection omitted *before* the drag layers are shown, or the normal
  picture is shown until the layers are whole (the option 4.4 recommends). Showing `sel` alone
  over the unmodified picture is the state to avoid.

### 11.14 Hazards found in this pass, and where each goes

| | hazard | today | in the redesign |
|---|---|---|---|
| H1 | pinned plates exceed the budget on HiDPI desktops; stand-ins evicted on arrival | `_evict` arithmetic | budget in screens; settle *replaces* the view's pins; drag layers counted (4.1) |
| H2 | second "add" pinner unpins the first mid-flight | `want(pin:"add")` | one request set per purpose, or generation pins |
| H3 | a plate rastered from a stale list is stamped fresh | epoch at dispatch, list from `_lastList` | job carries the list's generation; list never behind the document (4.2, 10.1) |
| H4 | selection shown twice in a drag's first frames | partial plane over unmodified plates | normal picture until layers are whole (4.4) |
| H5 | a mark outside the lasso's box can trim an object into the loop, unflushed | `_settleLassoErases` | re-judge on every cut of a considered object (10.8) |
| H6 | a moved native under an enclosed frame can be drawn outside the loop yet selected | `_lassoFind` reach box | grow the enclosure test by the largest residual, or judge moved natives (10.7 ids) |
| H7 | requeued strips lose their priority | `failPool` → `bestIndex` | typed job records with a required priority (4.3) |
| H8 | derived pieces carry z copied at derive time | `listFor` patches marks only | z read from the object in the item table (4.2) |
| H9 | the dispatch-time pack reads `_lastList`, which may not be the list the request was made from | `_packNow` | the job names its generation (4.3) |

None of these needed a new mechanism to fix; each disappears when the one rule that owns
the invariant (10.9) is in place.

---

## 12. Cross-check against the repository's own records

Read after the rest was written: `docs/OPEN-FLAGS.md` (the open rows and F65), `docs/ROADMAP.md`
(the structural lane and the register of deferred design changes), `docs/ai/10-STATUS.txt`, and on
the `origin/claude-context` branch `.claude/PAPER-PLAN.md` (§7.5 R5, §10.18),
`.claude/GPU-RENDERER-PLAN.md` (§8), `.claude/rasteriser/04-CRITIQUE-CORRECTNESS.md` (M2–M4) and
`.claude/RENDER-DESIGN-REVIEW-2026-09-24.md`, a design review written the day before this one
from the same two dumps.

### 12.1 What the earlier review and this one agree on

The 2026-09-24 review reaches the same structure by a different route, which is the best
evidence either of us has: a change log with version numbers (this document's generation, 10.1);
"the best fresh source per cell" in a fixed order (the pyramid lookup, 4.1); the render list as
an index over tiles that hold their own sorted pieces (4.2); cuts in parallel with indexes for
marks and families (4.9, 4.6); one scheduler with priorities and cancellation by version (4.3);
mask slots to be raised (D2, its B3); `_footBelow` to be deleted (D6, its B2); the second "add"
pinner (H2, its minor list). It also names two things this review missed:

- **B5, a lost erase.** `_settleSelectionErases` stops after 200 rounds; a selection needing more
  cuts is dragged with targets still whole, and once moved away the mark's candidate test (which
  uses the drawn position) no longer reaches them: the erase is lost for good. Rare (a tapped
  family of more than 200 members under a pending mark), and a correctness hazard, **H10**.
- **B6, a quadratic delete.** `removeById` is an `indexOf` and a `splice` per member plus a tile
  scan per remove event; 10,000 members in one frame is ~10⁸ list steps. Batch per frame as
  `rehomeManyById` does. **W9.**

Two of its proposals are worth adding here as options:

- **No document writes during a drag** (its 4.7). Today every pointer event re-homes members and
  rewrites tables (`_dragSelection`); the plane shows the motion anyway. Writing every member's
  table once at the drop makes a pointer event cost the same for any selection size, removes the
  per-event `refile` and `offRev` churn (C2, F83's mechanism), and leaves one undo entry. It is
  the natural companion of the three-layer drag (4.4).
- **Recent-change layers** (its 4.4): the last few added objects stay out of the plates and are
  drawn as small exact layers of their own until they age into the plates. That ends the
  double pen-up raster (D-3) and the translucent hold's clipping, at the cost of one more source
  in the compose. Kobin's decision; with generation-stamped plates and partial re-raster (4.1) the
  same ends are met without a new layer kind, so this document lists it as an option rather than
  adopting it.

### 12.2 One correction to the earlier review's erase rule

Its Option A masks an item iff its id is in a pending mark's *target list* recorded at pen-up,
and says cut pieces, being new objects, are never masked. With two marks that is wrong in one
case: a lower mark M1 cuts object O, which the higher mark M2 also targets; M1's pieces are new
ids not in M2's list, so they would show under M2 before M2 has cut them. The `handledBy` form
(10.2) gets this right because a piece inherits its parent's handled set: M1 is in it, M2 is not,
the piece's z is below M2's, so it stays masked until M2's cut lands. Both forms remove the
z-stepping, the done snapshots and `_uncut`; only the inherited set survives two marks.

### 12.3 What the plans correct in this review

- **H1's numbers, on Kobin's own machine.** PAPER-PLAN §10.18 measured his tab at 1504 × 812 CSS px
  at dpr 1.5: about 20 plates a screen, not 77, so view plus settle is ~40 MiB there. What fills
  the cache is the *ladder*: "68 of 96 MiB at the nucleus", "88 of 96 MiB" with the far rungs
  warm. The conclusion of H1 stands (the budget binds in normal use and stand-ins are the first
  to go) but the mechanism on his machine is the ladder's full-resolution rungs, which is why 8.3's
  Z6 (stand-in levels at quarter resolution) matters as much as the budget itself. The 77-plate
  arithmetic is right for a 1440p HiDPI desktop.
- **Why a 3–4 level zoom-out ends on paper, exactly.** PAPER-PLAN R5b/§10.18: the near ladder is 11
  rungs, 22 octaves, about two frame levels; the far rungs to 52 octaves exist but are off
  (`ladderFar`) because each was "one unsliced 10–17 s list build at depth 9 in Kobin's tab". A
  zoom-out of three or four levels is 36–48 octaves: it runs past the warm ladder and shows paper
  for its last stretch, which is what he reports. The same plan measured a 50-octave zoom-out at
  **0 ms of paper** with the far rungs warm. So coarse plates are sufficient; their *cost* is the
  whole problem, and 8.3's options are the ways to make far rungs affordable: pack-time level of
  detail (Z4) makes a far rung's plates cheap, budgeted derivation (4.8) makes its list a
  background job instead of a 10 s task, and the summary atlas (Z5) is the floor when neither has
  run yet.
- **F83, the crossing freeze.** OPEN-FLAGS: 834 ms at each zoom-out crossing on the Magnum Opus, 754
  of it `TileStore._reroute` reading 16,889 moved objects back one by one for the new frame.
  `_rerouteGroups.place` calls `objShift` per id; objects moved together share a home frame and a
  table, and the candidate scan already exploits that (300 → 95 ms by mapping "once per home frame
  and offset table"). Compute `objShift` once per (home, table) key and assign the group's F0 to
  its members: the same 3× and more, and it is the hot path of every crossing on a drawing with
  moved objects. **W10.**
- **F65 is still open** (an object dragged out from under a mark that never baked into it, on
  Kobin's big canvas; not reproduced on a fresh one). Three of this document's proposals bear on
  it: ids as the selection's truth (10.7), `handledBy` on objects (10.2) and no document writes
  during a drag (12.1), because together they make "which ink is under a pending mark" a property
  of the object rather than of the bake's progress.
- **The epoch was M3's answer.** The rasteriser critique (04-CRITIQUE M3) introduced per-key epochs
  precisely so an invalidation that lands while a plate is in flight is not lost; the generation of
  10.1 is that idea completed (one integer for the scene, a `dirtySince` per cell) rather than a
  departure from it. M2's rule, "map the footprint into every cached frame", is what
  `_drainPlates` does today and what the item table's delta rule keeps.
- **The GPU question was already decided once.** GPU-RENDERER-PLAN §8: a five-option panel chose the
  coverage-tile rasteriser and positioned WebGL2 analytic coverage ("Sagitta") as the next backend
  behind the same tiler if the phone's raster rate or the zoom softness proved unacceptable. That is
  this document's option D with the survey's phone estimates added; the standing has not changed.

### 12.4 Additions to the hazard and finding lists

| | finding | source | goes to |
|---|---|---|---|
| H10 | the 200-round pre-bake cap can lose an erase for good | 2026-09-24 review B5 | parallel cuts without a cap, or the deferred re-judge (4.9, 10.8) |
| W9 | delete of a big per-object selection is quadratic | 2026-09-24 review B6 | batch removal per frame, id → tiles index in the tile store |
| W10 | a crossing re-routes every moved object one by one (754 ms of F83's 834) | OPEN-FLAGS F83 | `objShift` once per (home frame, table) group |
| D6↑ | `_footBelow` cleared past 1,024 entries: in-flight plates at the drop spot land fresh with the objects drawn there after a quick undo | 2026-09-24 review B2 | old boxes from the item table (4.2) |

---

## 13. Shortcuts, duplicated work, and memory

### 13.1 Stopping early: the cull, extended

The occlusion cull exists (10.18 of PAPER-PLAN; `coverCandidate`/`fillsPlate` in the core) and
took the nucleus plate from 165–580 ms to 10.8 ms. It has three limits that cost real work:

- It runs in the worker, per plate, *after* everything below the backdrop was packed, copied,
  transferred and box-tested. At the nucleus ~40 whole-plate backdrops per plate are shipped so
  that 39 can be skipped.
- It proves coverage by depositing the candidate's edges and scanning all 262,144 pixels, once per
  candidate, and pays that in full for every miss.
- It knows nothing about the tile store's own knowledge: derived pieces that fill their whole clip
  rectangle are already marked (`covers`, from `solidQuad` and `shapeRingsInRect`'s `covered`), and
  the pack writes that as `FLAG_COVERS`, which the core never reads.

Three extensions, each exact:

1. **Trust `FLAG_COVERS` in the core.** An item with the flag, alpha 1, unmasked, whose clip
   rectangle contains the plate, is a cover without any deposit or scan. The flag is exact by
   construction: `solidQuad` *is* the padded rectangle, and `covered` means the rings equal the
   rectangle.
2. **Cull at the list, not only at the plate.** When the camera's item table is built or updated,
   find the topmost opaque `covers` piece whose clip rectangle contains the whole list window
   (window plus margin), and drop every item below it in z. Everything downstream shrinks: the
   list, the chord estimate, the pack, every plate. It is safe for the hit test (a fully covered
   object cannot be tapped), for the lasso (which reads the document's index, not the list), and
   for the ants (a selected object under a backdrop is a dot, as F73 already draws it). Translucent
   backdrops and any pending mark over the window disable it, as in the core.
3. **Reject misses cheaply** (9.3): sample a few rows before the full scan.

### 13.2 Duplicated work, collected

Each row names the repeat, where it is, and what removes it.

| repeat | where | removal |
|---|---|---|
| the plate's `DRAWN` box test repeats the strip's binning, per plate | `renderPlate` | per-plate item lists from the binner (9.1) |
| the chord estimate walks every list item on every camera frame | `visibleChords` | a running sum per tile, kept when tiles are built or patched |
| a pen-up rasters its plates twice: the band, then the resolved shape (D-3) | `_pointerUp` → band plates → bake → shape plates | post the band plates only if the shape has not landed within ~150 ms; the held SVG path covers the gap either way. Two attempts to run the bake inside pen-up were reverted; this delays the *raster*, not the bake |
| severance is re-checked after every multi-region cut, re-outlining every member pair | `_resplitFamily` / `_familyComponents` | once per mark per family after its cuts land; outlines cached per object version; contacts tested only for the new pieces |
| the mark's candidate scan is rebuilt after any change not its own | `_candidatesUnder` | an incremental candidate list: remove the cut target, add its pieces |
| every pending mark found by scanning all natives, per tick and per press | `_eraseStrokes` | a set maintained by events (4.9) |
| the family map rebuilt over all natives after any change | `editGroup` | maintained on add, remove, re-key (4.6) |
| `objShift` per moved object at every crossing (754 ms of F83) | `_rerouteGroups.place` | once per (home frame, table) group (W10) |
| a screen-spanning item copied into every strip | `packJob` | one geometry snapshot per generation (4.3) |
| every plate's drawn-id list built and sorted | `idsForPlate` | unnecessary with delta-based dirtiness (4.2) |
| the selection status (subtree counts) recomputed on every pan and zoom event | `_emit` → `_selectionStatus` | cache per (selection, document revision) |
| a tile's pieces removed by scanning every cached tile per remove event | `TileStore._removeObject` | an id → tiles index |
| a thumbnail's list built cold for a scene the pyramid already covers | `snapshotView` | scale from cached plates when they cover the rectangle (W6) |

### 13.3 Where the memory goes

Estimates for Kobin's tab (2256 × 1218 device px) on the Magnum Opus, from DESIGN's numbers and
the code; the `growth` sampler already records the heap, the plate bytes and the tile count, and
should record the rest of this table.

| pool | size | bounded by | notes |
|---|---|---|---|
| document geometry (`Loop` buffers + `idx`) | ~130–260 MB | the drawing | the floor; Float64 by design; `idx` is 4 B a piece |
| plate bitmaps | up to 96 MiB (56 phone), 1 MiB an inked plate | bytes cap | measured 68–88 MiB with a warm ladder; GPU-backed on first draw |
| tile store (derived pieces, chopped copies per level) | tens of MB on dense drawings | 512 tiles, 64 per level (counts, not bytes) | a deep zoom chain re-materialises ancestor ink at every level |
| pack memo (a second copy of visible loops, stroke bands) | ≤ 10 MiB | LRU by bytes | thrashes on dense views |
| ink canvas + layer canvas | 11 + 25 MB | screen | the layer exists for the stretched compose (F79: 30 ms a blit) |
| ants buffer + strips + ImageData | ~11 MB | screen | full-screen RGBA even for a small selection |
| per worker: RGBA 1 MiB, accumulator 1 MB, masks up to 8 × 1 MiB float32, edge tables ~0.5 MB, job buffers in flight | 3–12 MB each, ×4 | worker count | masks are float32 for an 8-bit result |
| worker heaps (4 raster + erase + scene), each with its bundle | ~5 MB each | 6 processes | one pool would be 4 |
| buffer pool | ≤ 8 MiB | cap | |
| undo stack | unbounded in bytes | 200 ops | an erase or delete op keeps the removed geometry; 200 big deletes could hold hundreds of MB |
| op-log queue before the 1.5 s drain | small | time | |
| scene index (main-thread share) | 26 MB | the drawing | typed arrays already (DESIGN §11) |
| level index, id maps, keyed sets | ~10 MB | the drawing | |

### 13.4 Why "CPU fine, still janky" happens, and how to test each cause

Three mechanisms produce hitches that no CPU profile attributes to script, and they need
different tests:

- **GPU texture uploads in bursts.** A plate bitmap is uploaded to the GPU the first time it is
  drawn. A generation of 20–77 plates landing in one frame is 20–77 MiB of uploads inside that
  frame's compose, a 20–50 ms hitch on an integrated GPU, and the same again when evicted plates
  are re-created. *Test:* Chrome's Performance panel with the GPU track during a zoom; then deliver
  arriving plates to the compose at most N per animation frame (the admission rule of 6.5 applied
  to results) and compare the frame-time histogram.
- **Major garbage collection on a large heap.** With a 300–500 MB heap a full mark-sweep is
  50–200 ms, and the allocation rate that triggers it comes from transient piece objects (W2), job
  buffers, and per-frame arrays. *Test:* the Memory checkbox in the Performance panel (the heap
  saw-tooth and GC markers) during a pan on the Magnum Opus; then W2's buffer-walking boxes and
  the pool reuse, and compare GC counts.
- **Memory pressure on phones.** iOS caps canvas memory at 224–384 MB and kills tabs past ~1–1.5
  GB; Android compresses or kills under pressure. *Test:* the phone with `performance.memory`
  unavailable, watch the plate store's `releases` and the page's lifecycle events; then the
  levers below at the phone budget.

### 13.5 Memory levers, each testable on its own

1. **Uint8 (or Uint16) mask planes.** The output is 8-bit; a float32 plane is 4× the bytes for no
   visible gain. 8 masks × 4 workers: 32 MiB → 8 MiB.
2. **Stand-in levels at quarter resolution** (Z6): the pyramid below the view at a sixteenth of
   the bytes; on Kobin's tab the ladder's 68 MiB becomes ~5 MiB, and the cap stops binding (H1).
3. **The pack memo by reference.** A single-loop shape's `Loop.buf` is the wire format; keep no
   copy (9.1). Removes the 10 MiB and the copying.
4. **One worker pool** (W5): four heaps instead of six, one set of scratch per worker, and the
   erase and scene work sharing them.
5. **Choose the stretched compose by plate count.** Below Chrome's cliff of ~33 distinct scaled
   images, draw plates scaled directly and skip the layer canvas: on a 20-plate screen that is 25 MB
   and F79's 30 ms blit; above the cliff, keep the layer. A one-line switch to measure.
6. **Ants buffer sized to the selection's box**, or the canvas-dash experiment (9.6), which needs
   no buffer at all.
7. **Undo bounded by bytes, or event-sourced.** Either cap the stack by geometry bytes (dropping
   the oldest, which the op log still holds) or take 10.6's replay form, where the stack holds
   entry ids and the geometry lives once, in the store.
8. **Tile store bounded by bytes.** `Loop.byteLength` exists; sum it per tile and evict by bytes
   and depth rather than by count, and drop tiles (not only plates) when the tab is hidden.
9. **A per-subsystem budget scaled by the device** (`navigator.deviceMemory`, screen size): plates
   in screens, tiles and memo in bytes, workers by cores *and* memory, so a 4 GB phone and a 32 GB
   desktop are not the same two constants.
10. **The frame-lazy document** (W4) is the only lever on the floor itself: geometry in memory
    proportional to what is near the camera rather than to the drawing.

The order to try them: 1, 2 and 3 are small and cut the most; 4 and 5 next; 7–9 make the rest
measurable and bounded; 10 is the large one.

---

## A. The changed files, one line each

| file | role in the pipeline |
|---|---|
| `raster/plate.js` | plate size, quantum maths, keys |
| `raster/PlateStore.js` | bitmap cache: epochs, pins, LRU by bytes, drops, fallback scan |
| `raster/PictureLayer.js` | view quantisation, hold/pending/preview/settle, compose, arrivals |
| `raster/RasterRenderer.js` | frame step, sync path, posts, results, live hold, plane driving, ladder/prebake/snapshot entry points |
| `raster/rasterPack.js` | per-object memo, family prepass, job packing, chord estimate, stroke bands |
| `raster/rasterJob.js` | job/result wire format, validation, buffer pool |
| `raster/rasterCore.js` | the coverage rasteriser: edges, union pass, arcs, masks, occlusion |
| `raster/rasterWorkerClient.js` | worker pool, strips, priorities, watchdog, inline fallback |
| `worker/rasterWorker.js` | per-strip loop: renderPlate → ids → bitmap |
| `raster/MovePlane.js` | drag layers: runs, cells, coarsening, requests, landing |
| `raster/OverlayLayer.js`, `raster/antPaint.js` | ants: RGBA buffer, dashes, stamps, CSS transform between paints |
| `raster/rasterPerf.js` | per-frame timing ring |
| `KobinEngine.js` (raster parts) | plate event drain and invalidation, hold during drag, list building, ladder, prebake |
| `erasePipeline.js` | bake loop, neutral/uncut bookkeeping, barriers, families |
| `eraseDescent.js`, `eraseJob.js` | pure cut and descent jobs (worker and inline) |
| `Document.js` | offsets log, keyed-native sets, detached frames, erase step undo/redo |
| `TileStore.js` | budgeted off-camera reads, re-route memo, tile patching, settle-safe bakes |
| `selection.js`, `overlays.js` | selection under moves and frames, lasso passes, indicator decisions |
| `frameGc.js`, `LevelMap.js` | frame forgetting, retired ids, subtree targets with shifts |
| `sceneClient.js`, `sceneIndex.js`, `sceneWorkerClient.js`, `worker/sceneWorker.js`, `sceneOps.js` | the scene index (not renderer) |
| `cloud/*`, `storage/*`, `hooks/useKobinEngine.js`, `Pages/*`, `Components/*` | one-editor-at-a-time sync, the store fence, UI (not renderer) |
