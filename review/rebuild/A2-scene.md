# A2 — The scene, the generation model and the erase rule (2026-09-26)

Analysis A2 of the renderer rebuild (PLAN §1.1, §1.3, §1.6). Read-only: nothing under `src/` was
changed. Every claim about today's code is quoted `file:line` against the tree at `ff0c6c7` (`src/` is the same at `acfd3f7`); every
number says where it came from. The node experiments are in the session scratchpad under `a2/`
(`exp1`–`exp4`; esbuild bundles of the repo's modules run under node 22 + jsdom).

Contents: 0 summary · 1 the facts the design rests on · 2 the scene API · 3 freshness end to end and
the interface A3 builds on · 4 the erase rule end to end · 5 Kobin's semantics traced · 6 deletions,
migration, tests, risks, effort · 7 seams with A1 and A3 · 8 least sure · 9 questions · appendix A
measurements.

---

## 0. Summary

**The scene** is one object between the document and the renderer. It keeps, for the camera's frame,
an item table in paint order (a chunked z-sorted list: 24–26 µs to replace one item by three at 25k–45k
items, measured), an index by native id, by source tile and by home frame, a global generation `G`,
and the freshness of every plate cell the plate store holds or has in flight (`dirtySince`). It is
updated by document events and by a new TileStore hook that reports each tile patch; it never goes
stale, so the hit test, the ants, the pack and the drag plane read one current table. Dirtiness comes
from the changed native's drawn footprint before and after, carried by the event itself and mapped
into every frame that has plates — `_footBelow`, `_drawnRectIn`, the drain and the per-key epochs go.
`placed(item)` is the one read of an item's geometry as drawn (a geometry reference and a numeric
offset); `placeNative(nat, frame)` is the same for a native anywhere, and it is the adapter A1's
untangling lands behind.

**The measured case for incremental.** A warm `listFor` is cheap (2.7 ms at 25k items, 16.8 ms at 45k
items with 20k moved; node, synthetic), but the pack's family prepass on each new list is 24–39 ms
(cold 110–198 ms). A table rebuilt per generation during a parallel bake would pay that every frame; a
table updated per event lets the prepass patch only the families a delta touched (A3's pack).

**The erase rule.** A mark records `targets` (ids) when its shape lands; every native carries
`targetOf` and `handledBy` (mark ids), set at registration and inherited by the pieces a cut or a cede
mints (the cutter added to `handledBy`); a refusal or a graze adds the mark to `handledBy`. The rule,
one pure function used by the pack, the bake, the barriers and the hit test:

> item *i* is masked by mark *M* iff *M*'s shape has landed, `M ∈ i.targetOf`, `M ∉ i.handledBy`,
> `z(i) < z(M)`, and their boxes meet.

From pen-up until its shape lands a mark is *pending* in the scene like a new stroke (PLAN §1.5, §5.1
Q7): no pack applies it, the live white path covers its region, and the pick and the barriers resolve
it (registering its targets) before they read it.

Undo restores the fields by reference (a removed object is frozen), the op log carries them in the
object headers it already writes, and a file saved before the change derives them at load from the
mark's z and the log's bake entries. A cut applied by its own mark on a target it masked changes
almost no pixel — the masked target renders as its pieces except in a thin band where the target's
edge crosses the eraser's (measured on real strokes: up to 57/255 there, and ≤ 13/255 on the cut arcs'
outlines elsewhere, the rasteriser's own 1/16 px arc tolerance; 0 bytes on axis-aligned fills,
`raster.mask.test.js` K4) — so the scene classifies it as
neutral from the rule and the event's `by` field, as today's bake does, and the spent mark's re-raster
of its box settles the band — no mode flag, no `_uncut`, no untagging. Cuts run in parallel (A3's one pool, priority 3 with a reserved worker; an
interim N-worker erase pool behind the same `submit` if B-ERASE lands first), results are applied in
the serial bake's order so a parallel bake produces the serial bake's document, descents stay serial,
and the barriers become asynchronous rounds with a visible "finishing the erase" state.

**Where this departs from PLAN §1.1/§1.3** (each is a question in §9, numbered A2-Q1…A2-Q15 so they are
not confused with PLAN §5.1's): the class is named `Stage`, not
`Scene` (the Scenes panel owns that word); mask overflow past 16 slots merges slots and never paints
white ink (white ink hides exactly the drag-across objects Kobin's rule protects); one boolean per
target under several marks is deferred (it makes a step belong to several gestures); the barriers are
asynchronous (parallel cuts cannot be waited for synchronously on the main thread); and the targets are
recorded when the mark's shape lands, a macrotask after pen-up, not at the pen-up itself (every reader
gets the same answer, and the pen-up does not pay the scan).

**Written against the adopted A3 design and A1's contract**: PLAN §5.1's asks on B-SCENE (Q7 a pending
item from pen-up to its shape bake; Q12 the partial tile read; Q15 family-level dirt) are in §2.3, §2.8,
§2.12 and §2.5; A1 §6's `PlacementModel` is how the Stage reads membership and placement (§2.6, §2.10);
A3 §4.1's one pool is where cuts run (§4.7).

**Effort** (§6.6): B-SCENE 11–13 agent-days (with PLAN §5.1's three asks), B-ERASE 8–10, both with
their tests.

---

## 1. The facts the design rests on

- **The list today.** `KobinEngine.listFor` (`KobinEngine.js:617–686`) concatenates the visible
  tiles' pieces (`TileStore.content`, `TileStore.js:127–149`, which reroutes moved objects through
  `_reroute`/`_rerouteGroups`, `:199–276`) and the frame's own natives (`ownContent` → `Document.at`,
  `:292–296`), then looks each item up in the document (`KobinEngine.js:644`) to stamp `editId`, a
  mark's `erase` and z (`:645–650`), seeds `_footBelow` (`:651–658`), stamps the residual `res`
  (`:659–664`), sorts by `(z ?? id, id)` (`:668`) and snapshots each pending mark's z and handled set for the renderer
  (`:669–680`, F121). It WRITES onto the objects it returns: `o.res` onto a native in the camera
  frame, `o.editId`/`o.erase`/`o.z` onto tile pieces.
- **Between rebuilds** the picture is composed from the same list (`syncCameraOnly`,
  `RasterRenderer.js:1017–1023`), and the engine decides which path by five predicates plus
  `_eraseListStale` (`KobinEngine.js:1040`, `:1065`).
- **Invalidation** is reconstructed late: document events are queued (`KobinEngine.js:194–216`, with
  the neutral tag), drained at the next render (`_drainPlates`, `:704–737`) into per-key epoch bumps
  by id and by rectangle (`PlateStore.dropById` `:498`, `dropRectPerFrame` `:524`), with the old
  table remembered in `_footBelow` (cleared past 1,024 entries, `:734`, D6/B2). A drag holds its
  members' events (`_heldByMove` `:824`) and releases one collapsed invalidation (`_releaseMove`
  `:894`, `_movedRectsIn` `:916`).
- **TileStore patches in place**: a remove filters every cached tile (`_removeObject`, `:663–670`, a
  scan of the whole cache per event), an add appends to the tiles a cold bake would put it in or drops
  a chained tile whose parents are not cached (`_addObject`, `:678–700`); frame events drop tiles by
  footprint (`_onFrameEvent`, `:600–629`); a stale `chainSeq` rebuilds a tile at its next read.
- **Erase state** lives in six places: the mark's stepped z (`_lowerMark`, `erasePipeline.js:528`),
  the done sets (`_bakeDone`, `KobinEngine.js:243`; `_doneSet` `erasePipeline.js:176`), `_uncut`
  (`erasePipeline.js:559`), the neutral tag (`_neutral` `:551`, `_neutralUnder` `:557`, the engine's
  untagging `KobinEngine.js:204–215`), the per-list snapshots (`noteListMarks`,
  `RasterRenderer.js:1319–1329`) and `_eraseListStale`/`_renderSoon` (`erasePipeline.js:777–789`).
- **The pack's mask** (`rasterPack.js:965–1016`): a mark gets slot `min(markOf.size, 7)` (`:974`,
  `MASKS_MAX = 8`, `rasterJob.js:45`), an item gets the bit iff its family's z is below the mark's,
  the mark's done set lacks it, and the boxes meet (`:1013–1016`). The core resolves masks first as
  1 MiB float32 planes (`rasterCore.js:409–429`) and multiplies coverage by Π(1 − mask) (`:259–273`).
- **Pieces are minted in exactly three places**: `Document.eraseReplaceById` (`Document.js:997`),
  `Document.cedeTileById` (`:1064`) and `eraseDescent.cedeVirtual` (`eraseDescent.js:110`, D4's copy),
  whose specs `_applyDescent` mints with `{...sp.obj}` (`erasePipeline.js:1126`).
- **The bake** walks `_eraseStrokes()` (a scan of every native, `erasePipeline.js:111–118`) oldest
  first, each mark's candidates top-down by z (`_candidatesUnder` `:402–444`, rebuilt whenever
  `doc.rev` moved), one cut in the one erase worker at a time (`_cutInflight`, `:725–736`), the result
  applied on the main thread (`_applyCut` `:803`, `_applyDescent` `:1102`).
- **The barriers** are synchronous: `select` → `_flushErasesFor` (`selection.js:614`), a drag's
  start → `_flushErasesFor(hit)` + `_settleSelectionErases` (`selection.js:92`, `:101`; 200 rounds at
  most, `erasePipeline.js:1272`, with every mark flushed when frames are selected, `:1262`, B4), a
  lasso → `_settleLassoErases` (`selection.js:582`; marks whose box meets the loop's box, H5).
- **The op log records results**: a bake step encodes the removed object and the pieces with their
  headers the moment it lands (`oplog.js:139–160`); a header is `format2.objectHeader`'s whitelist
  (`format2.js:55–71`) plus any field a reader did not know (`_extra`, `:73–77`); replay rebuilds
  ops and one object per id (`oplog.js:343–600`) and the pending marks' done sets from their bake
  entries (`:601–609`).
- **Undo of an erase** is the step graph: `_stepsUndo` reverts the gesture's steps and every step that
  consumed what they made, newest first, restoring each source BY REFERENCE (`Document.js:1451–1462`);
  `_stepsRedo` re-applies to a fixpoint (`:1489–1500`).

---

## 2. The scene API

### 2.1 Name, owner, lifetime

The object PLAN §1.1 calls "the scene" is named **`Stage`** in code (`src/engine/Stage.js`, the
engine's `this.stage`). The codebase already has a Scenes feature — `sceneIndex.js`, `sceneClient.js`,
`sceneOps.js`, `docMeta.scenes`, the Scenes panel — and an engine field `this.scene` beside
`this._sceneClient` would read as one of those. Prose keeps "the scene". (A2-Q1.)

The engine constructs it after the TileStore (`KobinEngine.js:170`), so its document subscription
runs after TileStore's for every event and it always sees tiles already patched. It holds no camera
and no plates: the engine tells it the camera's frame and the window (`sync`), the plate store
registers the cells it holds (`track`). It exists in both renderer modes; the SVG renderer ignores it.

### 2.2 The table: representation

What its readers need:

| reader | needs |
|---|---|
| the pack (per strip, lazily at dispatch) | the items in paint order, each with its box, family key, offset, erase data; families whole across strips |
| the hit test, the mark-aware pick | top-down order; one item's geometry and offset |
| the ants, the drag plane's cut, `_planeState` | the selection's items by id, in paint order |
| dirtiness | the old state of whatever changed (§2.5: taken from the event, not the table) |
| A3's pack memo | which items changed since generation G (`changesSince`) |

Four structures were weighed, measured where it mattered (appendix A):

1. **Rebuild per generation** (`listFor` under a new name). Correct by construction and the least
   code, but every generation is a new list: `listFor` 2.7–16.8 ms and the pack's family prepass on a
   new list 24–39 ms (cold 110–198 ms) at 25k–45k items. A parallel bake lands a cut every few tens of
   milliseconds; paying 30–55 ms of main thread per landed batch is the "janky during a bake" the
   rebuild exists to remove. Rejected.
2. **One sorted array, splice per change.** 1.5–3.4 ms to replace one item by three at 20k–45k items
   (V8 moves the tail on every splice). Rejected.
3. **One sorted array, batched merge per commit.** 0.6–1.1 ms per commit at 20k–45k items (a new
   array and a membership test per element). Acceptable, but a commit per landed cut is still ~1 ms.
4. **A chunked sorted list** — chunks of at most 256 items (split at 512, an empty chunk removed), each
   sorted by the item key; binary search over the chunks' last keys, then within the chunk. **24–26 µs**
   to replace one item by three at 25k–45k items, build 2.8–5.0 ms, a plain walk of 45k–100k items
   0.3–1.6 ms. Chosen.

The item key is `(zKey, id, srcRank, seq)`: `zKey = nat.z ?? nat.id`, then the native id, then the
source's rank (tile order `i`, `j`, up before down, rerouted tiles after, the own native last — the
concatenation order `listFor` sorts stably from, `KobinEngine.js:625`, `TileStore.js:131–146`,
`:202–217`), then the position in its tile. Paint order is thereby the order `listFor` gives, piece for
piece. Beside the list:

- `byId: Map<nativeId, Item[]>` — a native's items (all its pieces in the table);
- `bySrc: Map<srcKey, Item[]>` — the items a source contributed (`"own"`, a tile key, or a rerouted
  tile key with its group);
- `byPiece: Map<piece, Item>` — a tile piece object to its item (the TileStore hook reports pieces);
- `byHome: Map<frameId, Set<nativeId>>` — natives in the table by home frame, so an event about a
  frame's placement (a shift composed on read, A1's leaning) updates O(its natives), not O(table).

No spatial grid in the first build: a pack's strip cull walks the table (0.3–1.6 ms for 45k–100k
items). If the partial re-render (A3, PLAN §1.2) or a large pack shows the walk in a profile, add a
uniform grid over the camera frame (cells an eighth of a cache tile) mapping cell → items.

### 2.3 The item record

```js
Item = {
  nat,      // the Document's native object (live reference): z, family key, erase data are read from it
  id,       // nat.id
  piece,    // the geometry holder: the native itself (own item) or the TileStore piece (never mutated)
  src,      // "own" | tileKey | "rr|" + tileKey + "|" + groupKey
  kind,     // piece.type: "shape" | "fill" | "stroke"
  box,      // Float64Array(4), camera-frame units, WITHOUT the offset (bbox, ± lwFrame/2 for a stroke)
  off,      // [dx, dy] the offset paint applies: the model's placement(nat, F).rem (§2.6; today
            // residual(nat.below, D − depth(home))), plus the drag delta while held; a NEW array
            // on every change (the pack memo compares by identity)
  zKey,     // nat.z ?? nat.id, refreshed on the native's attr/rekey events (R25 H8: never piece.z)
  fam,      // nat.editId ?? nat.id, refreshed likewise
  held,     // in a drag's hold (§2.7)
  pending,  // from pen-down until its shape bake lands (PLAN §1.5): hit-testable, skipped by every pack
  seq,      // position within the source, for a total order
}
```

Nothing is copied from the native at derive time except what is refreshed by the native's own events:
z, the family key and the erase flag are the native's (`nat.z`, `nat.editId`, `nat.erase`), and the
erase data of §4 (`nat.targetOf`, `nat.handledBy`, a mark's `targets`) is read at pack time, never
stored on the item. For the pack and the tests the record exposes the field names a list item has
today (`type, id, z, editId, erase, res, clip, loops|polys|pts, lwFrame, color, opacity, covers,
fadeTag, origin, _ver, _outline`) through getters on the record, so `E._objs()` and `_lastList` — which
43 suites read, directly or through the harness's `painted` — keep their shape; no field is written onto a piece or a native (today `listFor` writes `o.res`
onto natives, `KobinEngine.js:664`, which is what made the pack memo key box-without-res,
`rasterPack.js:7–10`).

### 2.4 Generation, commit, and the delta log

- **`G`** is one global integer. It increments once per **commit**: a document event handled outside
  a batch, or a whole batch (§2.5), or a mask-state change (registration, a refusal, a mark resolved),
  or a drag-delta change while the view plates draw held items (§2.7). A table change always bumps G;
  a G bump need not change the table.
- **Events are applied eagerly**, so a reader never sees a table behind the document: the hit test at
  pointer-down, the pack at dispatch, the ants. The one exception is the Stage's own reads: `sync`
  reads tiles (which can bake) and own natives (`Document.at`, which settles a pending frame shift and
  emits `offsetsOnly` changes and carries, `Document.js:361–369`, `:383–409`). Events raised inside
  `sync` are queued and applied at its end, in order, looping until none arrive (bounded like
  TileStore's `_bakeSettled`, three rounds). Under A1's C1 (a frame's shift composed on read) no read
  settles and the loop has nothing to do; it goes with the settles.
- **`changesSince(G0)`** returns the item deltas since G0 — `{added: Item[], removed: Item[],
  changed: Item[]}` with each changed item's previous box and offset — or `null` when the log no
  longer reaches G0 (a bounded ring, 4,096 deltas; a crossing or a reset truncates it). This is what
  lets A3's pack patch its family table instead of rebuilding it per list (appendix A: the rebuild is
  the 24–39 ms).

### 2.5 Dirtiness

**One mechanism: the changed native's drawn footprint, before and after, mapped into every frame that
has plates.** The footprint is the native's bbox grown by `lwFrame/2` (0 for a fill or a shape), in
its home's units, placed by its displacement table (`LevelMap.mapRectObj`, `LevelMap.js:997`) — what
`_drawnRectIn` computes today (`KobinEngine.js:956–978`), with the one difference that makes it sound:
**the before-state comes from the event, not from a memo.** `Document` already carries `oldBbox`/
`oldLw` on geometry edits (`_afterEdit`, `Document.js:1186–1191`) and the removed object on removals;
B-SCENE adds `oldBelow` to every offsets-only change (`setOffsetsById` `:775`, `unsettle` `:427`,
`applySettle` `:445`) and the old home to the add half of a re-home (already `ev.rehome`). With that,
`_footBelow` and its 1,024-entry cap (D6, B2's ghost after a quick undo) have nothing left to do.

Why native footprints and not item boxes: other frames' plates (the parent frame's during a crossing,
a prefetched crossing target, the ladder today, a drag plane level) hold the same native at other
scales, and only the native's footprint maps into them; the camera frame's plates are covered by the
same mapping. One rule, every frame. The item boxes serve the pack and the hit test.

**Cells.** The plate store registers every plate it holds and every plate a job is in flight for:
`stage.track(key, frameId, box)` with the cell's box in that frame's units grown by one device pixel,
`stage.untrack(key)` when it is evicted and not in flight. For each tracked key the Stage keeps
`dirtySince`. On a commit, for every frame with tracked keys: map the commit's footprints into it
(once per frame per commit, memoised per native home and table as the candidate scan already does,
`erasePipeline.js:432–440`), and set `dirtySince = G` on every tracked key whose box meets one. This is
PLAN §1.1's "per-frame-per-level sparse grid of plate cells": the grid is exactly the cells that have
a plate or a job, which is all a freshness judgement can ever be asked about (a job dispatched later
packs at a later G). O(tracked keys) per commit — 100–300 (A3's budget, PLAN §1.2: 120 MiB of 1 MiB
plates on a desktop, 70 on a phone, plus the in-flight set).

**Batches.** Bulk operations commit once: `stage.batch(fn)` around a drop, an undo or redo, a
delete, a subtree set-aside, a load and a replay. Inside a batch the footprints are collected per
native (the earliest before, the latest after); at its end they are unioned per frame past 256
(`MOVE_RECTS_MAX`'s rule today, `KobinEngine.js:63`) and one pass sets `dirtySince`. A 20k-member undo is
one pass, as `_releaseMove` is today for a drop.

**What is picture-preserving** (no footprint; G bumps if the table changed):

| change | why no pixel moves |
|---|---|
| a settle, an unsettle, a replayed settle (`offsetsOnly` with `settle: true`) | the frame's shift is already in every picture (every picture reader settles through `Document.at` first); the `refile` that set the shift dirtied the footprints |
| a shadow merge or split (`mergeFrame`/`splitFrame`) for the natives it moves | shadow and resident share the cell, so the coordinates are unchanged; the vanished frame id's plates are removed (its key names a frame that no longer exists) |
| the frames pass (§4.2), in the commit where the mark's shape lands | the covered natives lie inside the mark's box, which that commit dirties anyway |
| an erase step by the mark that was masking its target (`by`, §4.5) | the masked target renders as its pieces up to the anti-aliasing of the eraser's edge and the arc tolerance (measured, §4.5); only the dust boxes are dirtied, and the spent mark's box later |
| a graze, a refusal with no ink under the mark (`inkless`) | nothing under the mark changes |

**What reaches past the changed native** (A3 §3.7; PLAN §5.1 Q15, adopted for B-SCENE with one
measurement to decide whether it stays):

- **A family's shared attributes.** The pack decides a family's union routing and winding sign over
  every item of the family (`familyUnion`, `unionSignOf`, `rasterPack.js:940–946`, D64, D90) and paints
  it with one colour and one alpha (`:995–1002`); a change of one member that flips the routing, the
  sign, the colour or the alpha changes the pixels of every member (the union pass samples 16
  sub-scanlines where the fast path is analytic). On a commit that adds, removes or re-keys a member of
  a family with more than one member, the Stage recomputes those four with the pack's own functions
  over the family's entries — zoom-independent for shapes and fills (their entries' boxes and signed
  areas), per level for a family holding a raw stroke (its band's winding), which is then treated as
  changed whenever its membership changes — and, if any differs, dirties **the family's whole box**
  (the union of its members' footprints). A neutral erase step is exempt: the mask-equivalence test
  (§6.4 row 3) covers families cut under their own mark, including one that flips its routing.
  The measurement (PLAN §5.1 Q15): bytes changed in the untouched pieces when the routing flips, on A3's
  synthetic drawing; if it is 0 or one alpha step, the rule is dead weight and goes.
- **The fade band.** `renderIdOf` gives an item under the fully-present line its own family
  (`rasterPack.js:703–705`); a geometry change of a keyed native moves its pieces' `fadeTag` and can
  regroup them at the levels where the fade is partial — the family's box at those levels (the Stage
  dirties the family's box on a geometry change of a keyed member whose pieces carry a `fadeTag`).
- **Masks.** A mark's shape landing dirties the mark's box; a target leaving a mark's targets (a
  refusal) dirties box(target) ∩ box(mark); a spent mark its box (§4.5). A target joining happens only
  at registration, inside the mark's box.

### 2.6 `placed()` and `placeNative()`

```js
stage.placed(item)  → { geom: item.piece, off: item.off }
// the geometry reference in the camera frame's units and the numeric offset paint applies
// (attr[4..5] in the job, rasterPack.js:1026–1027). Inverse for an input at point p: p − off.

stage.placeNative(nat, frameId) → {
  box(),                // the native's drawn box in frameId's units (mapRectObj home → frame)
  toStored(p | rect | loops),   // an input made in frameId, in the native's stored coordinates
                                // (mapPointObj / mapRectObj / projectLoopsObj with toHome = true)
  fromStored(p | rect | loops), // stored → frameId, drawn
}
```

`placed` is what the pack, the hit test (`selection.js:998–1000`), the ants (`overlays.js:750`,
`:857`) and `_planeState` read. `placeNative` is what the lasso (`_rectInActive` `selection.js:293`,
`_objPointInActive` `:303`), the erase (`_eraserRectInto`/`_eraserLoopsInto`,
`erasePipeline.js:606–613`), the candidate scan, the ants' member windows (`_selSeamRects`,
`overlays.js:853`, `_selFrameRect` `:637`) and the footprints of §2.5 read. Today each of those calls
`LevelMap`'s `*Obj` functions itself; after B-SCENE they call `placeNative`.

**Where placement comes from: A1's `PlacementModel`** (A1 §6). The Stage reads membership and
placement through three calls and nothing else — never `o.below`, `f.shift`, `o._home`, `Document.at`,
`offsetIds`, `residual` or the `*Obj` functions directly:

- `model.nativesIn(F)` — the natives drawn live in F (today `doc.at(F)`; under A1's C1 a pure read that
  never settles; under C3 with F's co-residents);
- `model.placement(o, F) → {F0, rem} | null` — the frame whose unmoved tiles hold `o`'s pieces as seen
  from F (F0 = home: `o` itself, drawn live) and the translation paint applies and inputs subtract
  (today `LevelMap.objShift`/`residual`);
- `model.displaced(F) → {rev, groups}` — every group of natives whose picture is not at its stored
  bits, keyed by the (F0, rem) they share (today `TileStore._rerouteGroups`).

`item.off` is `placement(o, F).rem` (plus the drag delta while held); `placeNative(nat, F).toStored` /
`fromStored` are `placement` applied to a point, a rectangle or loops through the exact chain between
F and F0. B-SCENE implements the model over today's calls; B-MODEL replaces its body — a frame's shift
composed on read, co-residents, private cede frames — and neither the Stage nor any consumer changes.
A held item's `off` includes the drag delta; `placeNative` of a held native does not (inputs never read
a held native during its drag).

### 2.7 The hold and the drag delta

Two phases, because B-SCENE lands before B-DRAG (PLAN §2):

- **B-SCENE — today's hold, moved into the Stage.** `stage.hold({ids, frames})` at `_beginSelectDrag`
  (where `_beginHold` runs today, `KobinEngine.js:775`, called at `selection.js:107`) records each member's start
  footprint and each held frame's reach footprint (`_framesFootIn`, `:794`). While the hold stands,
  events about held natives and natives under held frames (today's `_heldByMove`/`_underHeldFrames`,
  `:824–835`) are queued, not applied: the table keeps the pre-drag list for them, which is exactly
  what the drag plane was aimed from (`dragLight`, `RasterRenderer.js:483`; the drag builds no list
  today). `stage.release()` (the drop, a cancel, a delete, a lost plane) applies the queue and commits
  ONE batch whose footprints are the start states and the end states — `_releaseMove`'s rules, now
  the Stage's.
- **B-DRAG — no document writes during a drag.** `stage.hold` as above, plus
  `stage.setDragDelta([dx, dy])` in the camera frame's units: held items' `off` includes it. When the
  drag plane draws the held items (view plates omit them, `_dragOmit` today), a delta change bumps
  nothing; when it does not (the plane was refused or lost), a delta change bumps G and dirties the
  held items' placed boxes at the old and the new delta. At the drop the engine writes every member's
  table once inside `stage.batch`, releasing the hold: footprints before (the stored placement) and
  after (the written one). One undo entry, as PLAN §1.4 says.

### 2.8 Every document event, as a table delta and a dirt rule

`F` is the camera's frame, `D` its depth. "Tile deltas" arrive through TileStore's hook (§2.9) for the
same event, before the Stage's own handler runs. "Footprint" is §2.5's, in every frame with tracked
cells.

| event (emitter) | table delta | dirt |
|---|---|---|
| `add`, `live: true` (`Document.add`, pen-down, `Document.js:579`) | an own item, `pending` (PLAN §1.5, §5.1 Q7): hit-testable, skipped by every pack and snapshot | none — the SVG live path draws it |
| `finalize` (`:597`, pen-up) | still `pending`; its pieces in other frames' tiles (tile deltas) are pending with it — the flag is the native's | none |
| `change` from `bakeShapeById` (`:1144`) on a pending native: the shape lands | `pending` cleared: packable from this G; for a mark, the frames pass and registration in the same commit (§4.2) | footprint after — the shape's box; for a mark, its box, which bounds every pixel its mask changes. A3's partial re-render and group commit publish it and release the SVG path in one task |
| `remove` of a native still `pending` (an undo before its shape landed, `cancelStroke`) | its items leave | none — it was never packed |
| `add` (a new object, an undo's `insertAt` `:658`, a replay insert) | own item if homed in F; tile deltas; a rerouted item if its table has digits at D (§2.10) | footprint after, or none if `by` is a neutral erase step (§4.5) |
| `remove` (`removeById` `:638`) | every item of the id (`byId`) | footprint before (the removed object is frozen), or dust only if `by` is neutral |
| `remove` + `add` with `rehome` (`rehomeById` `:854`, `rehomeManyById` `:893`) | the own item leaves or joins F; tile deltas; its reroute group recomputed | footprint before (old home) ∪ after (new home); none for a settle's carry (`carry: true`, picture-preserving) |
| `change` with `oldBbox`/`oldLw` (`_afterEdit` `:1186`: a legacy geometry move, `setGeometryById`, `bakeShapeById` of a stroke loaded raw — never pending — and `fillToShapeById`) | the own item's box recomputed (the pack memo refreshes on `_ver`); tile deltas (remove + add) | footprint with the old box ∪ the new |
| `change`, `offsetsOnly` (`setOffsetsById` `:775`) — **adds `oldBelow`** | `off` recomputed for the native's items; its reroute group recomputed; if the group's frame changed, its items leave and the new group's pieces join | footprint at the old table ∪ the new |
| `change`, `offsetsOnly`, `settle: true` (`_settleIfPending` `:383`, `unsettle` `:427`, `applySettle` `:445`) — **flag added** | `off` and the group recomputed (the picture does not move) | none |
| `change`, `attrOnly` (`setZById` `:757`, a replayed `attr`) | `zKey`/`fam` refreshed and the items re-sorted | footprint (paint order moved) — none for an `attr` that only sets erase fields (below) |
| **new** `rekey` with `ids` (`keysChanged(ids)`: `_resplitFamily` `erasePipeline.js:1042`, `_revertStep`/`_applyStep` `Document.js:1456`, `:1466`, replay `oplog.js:510`) | `fam` refreshed for the ids (a family split or joined) | footprint of the ids (a translucent family's alpha-once grouping changed; today a re-key emits nothing and no plate is invalidated) |
| **new** `handled` `{id, mark, inkless}` (a refusal or a graze, §4.5) | none (mask state) | box(target) ∩ box(mark) mapped, unless `inkless` or a graze |
| **new** `targets` `{mark}` (the mark's registration, §4.2) | none | none |
| `refile` (a frame re-addressed: `noteRefile` `:328`, a subtree drag step, its undo `:1366`) | if F is the frame or under it: full rebuild (§2.12); else the tiles TileStore dropped for the footprint are re-read at the next `sync`, and every rerouted group is recomputed (the lattice moved) | the frame's reach footprint at the old and the new address (`_cellFootIn`'s rule, `KobinEngine.js:751`); the plates of frames under the moved frame are **removed**, not staled (their frame id now means another place: the plate store's `dropFrames`) |
| `removeFrame`/`addFrame` (`removeFrameSubtree` `:939`, `detachFrame` `:496`, `insertFrameSubtree` `:960`) | own items rebuilt if F is the frame or under it; dropped tiles re-read; groups recomputed | the frame's reach footprint (`_frameListPlates`'s rule, `KobinEngine.js:765`); none when `by` is a neutral erase step (the frames pass, §4.2) |
| `mergeFrame`/`splitFrame` (`_mergeShadows` `:461`, `unmerge` `:543`) | own items for `ids` if F is the resident or the shadow; the merged frame's tiles were dropped (`TileStore.js:606`), re-read; if the camera followed the merge (`KobinEngine.js:152–156`), full rebuild | none for the natives; the vanished frame's plates removed |
| `reset` (`_replace` `:1508`: clear, load) | full rebuild; `changesSince` truncated | every plate removed (`dropAll(false)` today: another document) |
| frame GC (`collectFrames` → `TileStore.forgetFrame`, `frameGc.js:96–101`) — **not a document event today** | the Stage is told (`stage.forgetFrame(id)`): tracked cells of that frame untracked, its tiles' items gone | the plates of the frame removed (as today) |

The three new event kinds (`rekey`, `handled`, `targets`) are the only additions to `Document`'s
vocabulary, and `oldBelow`, `settle`, `carry` (B-SCENE) and `by`, `dust` (B-ERASE) the only new fields; the Scenes index (`sceneClient.js:220–245`) must ignore the
`attrOnly` events that carry only erase fields (§4.9) — it would otherwise re-index the object for a
refusal.

### 2.9 TileStore's hook

TileStore keeps patching tiles in place inside `_onDoc` (PLAN §1.8 keeps it). Two additions:

1. **A listener**, called synchronously as each tile changes:
   ```js
   store.onTile((ev) => …)
   ev = { kind: "remove", key, tile, pieces }   // `pieces` just filtered out of tile.objs (one id)
      | { kind: "append", key, tile, pieces }   // `pieces` just pushed onto tile.objs
      | { kind: "drop",   key, tile }           // deleted: evicted, framesLeft, a frame event's footprint,
                                                //   a chained tile with a parent missing, batch mode, forgetFrame
      | { kind: "bake",   key, tile }           // (re)baked: tile.objs is a new array
      | { kind: "clear" }                       // bumpEpoch / reset: every tile gone
   ```
   The Stage acts only on tiles in its window or its reroute groups (a Set of watched keys, checked
   first, so the rest of the cache costs one lookup per event): `remove` → the items of those piece
   objects (`byPiece`) leave, their boxes known from the items; `append` → new items (for a rerouted
   source, only the group's ids; for a window tile, never a rerouted id — it is drawn from its group);
   `drop` → the tile's items leave and the key is re-read at the next `sync` if still watched; `bake` →
   the tile's items are replaced. A tile made stale by `chainSeq` (a re-addressed ancestor) is not a
   TileStore event — it rebuilds at its next read — so the Stage re-reads every watched tile of a frame
   under a `refile`'s frame at the next `sync`.
2. **An id → tile-keys index**, maintained where pieces enter and leave a tile (`bake`, `append`,
   `remove`, `drop`). `_removeObject` then touches the tiles that hold the id instead of scanning the
   whole cache (`TileStore.js:663–670`), which R24 B6/W9 and R25 §13.2 both ask for, and which makes a
   bake's hundreds of removals and a big delete's thousands proportional to what they touch.

### 2.10 The reroute memo

For the camera's frame the Stage keeps, per displaced native, its group `(F0, rem)` from
`model.placement` (§2.6; today `LevelMap.objShift`, `LevelMap.js:931`) — computed once per (home,
table) as the candidate scan already groups (`erasePipeline.js:432–440`) and as W10 asks for the
crossing. It is **pushed**: an event about one native (a table change with `oldBelow`, a re-home)
recomputes that native's group and, if it changed, moves its items; an event about one frame (a
`refile`, with `shiftBefore`/`shiftAfter` under A1's C1) re-places the natives `byHome` holds for that
frame and its subtree; a lattice change the events do not name (frame GC, a descent's minted frames
merged, `lm.addrEpoch` moving) re-reads `model.displaced(F)` once and diffs it against the Stage's
groups. `offRev`, `_offLog` and `offTouchedSince` (`Document.js:254–256`, `:310–318`) exist because
TileStore's memo is pulled; the Stage does not use them. They stay for `listFor` (the SVG renderer and
the fuzz) and go with it — or sooner, when A1's `displaced` becomes the one implementation of the
displaced index that `listFor`'s reroute also calls.

A rerouted group's pieces come from F0's tiles over the window shifted back by `rem`, filtered by the
group's ids — `TileStore._reroute`'s rule (`TileStore.js:199–217`), including its quirk that a group
whose F0 is F itself reads F's tiles over the SHIFTED window (a picture moved into view from outside
the unshifted range).

### 2.11 What `syncCameraOnly` becomes

There is one frame path. Every camera step and every animation frame that has work calls
`engine.frame()` (coalesced to one per animation frame, A3's input coalescing, PLAN §1.2):

```js
frame() {
  stage.sync(cam.frame, pyramid.window(), budgetMs);   // cheap when nothing moved: O(watched tiles)
  renderer.frameStep(stage);                           // A3: the pyramid lookup, posts, compose
  overlays.refreshIfStale(stage.generation);           // the ants' decision keyed on G, not list identity
  emitStatusIfChanged();
}
```

`_render()` survives only as "frame + the overlay decision + status" where a caller needs all three
at once, and on the SVG path, which keeps `listFor` and today's `render(list)`. The five predicates
that choose between a rebuild and a camera step today (`KobinEngine.js:1040`, `:1065`) go on the raster
path: `_visibleChanged` becomes the Stage's own window diff, `_eraseListStale` has nothing to mean
(the table is never behind), and `needsFatFlip` becomes `stage.touch(id)` when the idle fitter sets an
outline (`KobinEngine.js:1303–1306` today drops the id's plates by hand because the fit emits nothing).
`_renderPending` and `_renderSoon`'s skip rule (`erasePipeline.js:777–789`) become "schedule a frame":
a frame with no dirt and no camera movement costs one `sync` walk and nothing else. The suites and the
one-off SVG engines run A3's `cfg.frames = "sync"`, or call `engine.flush()`, where they expect a
render per API call today (PLAN §5.1 Q10).

### 2.12 When a full rebuild is still needed, and the window

- **A crossing** (the camera changes frame), a `refile` of F or an ancestor, a merge the camera
  follows, a `reset` or load, `bumpEpoch`: the table is rebuilt for the frame. Warm, that is `listFor`'s
  cost without the stamping: 2.7 ms at 25k items, 16.8 ms at 45k items with 20k moved (node, appendix
  A); in Kobin's Chrome on the Magnum Opus a pen-up's list was 8–13 ms for 9.4k items
  (REVIEW-2026-09-24 "PEN-UP (Magnum, Chrome)"). Cold, it is the tiles' bakes, 0.3–0.8 s a level
  (DESIGN §9) — which A3's budgeted camera read turns into a table that fills over several frames.
- **The window changes** (a pan across a cache-tile boundary, a zoom that grows or shrinks the
  window): **not** a full rebuild. The tiles that left are dropped from the table (their items by
  `bySrc`), the tiles that entered are read and their items batch-inserted (sorted, then merged into
  the chunks). Cost ∝ the entering tiles' pieces.
- **Coverage.** Because the camera's read is budgeted (A3 §4.2: cache-only while the camera moves,
  missing tiles baked at idle one per slice), the table may cover less than the window for a few
  frames. B-SCENE builds TileStore's partial read for it (PLAN §5.1 Q12): `store.read(F, rect,
  budgetMs) → {items, missing: [tileKey], complete}` on the existing `_deadline`/`_readBakes`/`_nest`
  machinery (`TileStore.js:166–183`, `:306`, `:466`), a miss past the deadline listed instead of
  thrown; `sync` inserts what it read and remembers what is missing. `stage.covers(frameId, rect)` says whether every tile under `rect` is in the table;
  the renderer dispatches a job only for a plate whose rectangle is covered, and composes a stand-in
  elsewhere. This replaces `_listWin`'s one-preview-plate margin (F119, `KobinEngine.js:1016–1021`) with
  a statement the renderer can check: "every plate job holds every item overlapping the plate" (the
  TEST-MAP's replacement for `raster.listCover.test.js`).
- **The window itself is the renderer's** (A3's pyramid decides which cells of which levels it will
  raster: the view, one ring, the coarser levels' cells). `stage.sync(frame, window)` is told it.

### 2.13 Off-camera tables

The crossing target's prefetch, a drag plane level coarser than the camera list's margin (F122), a
thumbnail (`snapshotView`) and the far coarser levels in ancestor frames (the ladder's reads, now
ordinary pyramid levels, A3 §4.3) need items for a frame or a rectangle the camera table does not
cover. `stage.snapshot(frameId, rect, budgetMs)` builds a
read-only table by the same builder the crossing rebuild uses (per-tile reads through TileStore with
its off-camera pin discipline, `contentOffCamera`'s, `TileStore.js:166–183`), stamped with the G it was
built at, and returns `null` past its budget (as `contentOffCamera` does). A job packed from it
carries that G; its cells are tracked like any others, so a change after the snapshot stales its
plates by the same rule. A snapshot is not maintained; `snapshot.fresh()` is "no commit since its G
has a footprint meeting its rectangle in its frame", answered from the dirt log (§3.4).

### 2.14 The `listFor` equivalence fuzz (PLAN §3 row 2)

- **Harness** (`src/engine/stage.equiv.probe.js`, 60 seeds × 80 steps, run by hand; and
  `stage.equiv.test.js`, 5 seeds × 40 steps, in the quick suite): a jsdom engine, seeded random
  operations — a stroke at a random zoom, an eraser gesture, bake slices and whole flushes, a tap and a
  drag, a lasso and a drag, a subtree drag, a delete, undo and redo in runs, a zoom across one to three
  crossings, a pan across tile boundaries, a save and reload (kobin-2 through the op log, and kobin-1),
  a frame GC.
- **After every step** (and not inside a held drag — the hold keeps the pre-drag state by design, §2.7):
  `A = stage.items()`; `B = engine.listFor(F, stage.window, false, 0)` (off camera, so its pin
  bookkeeping does not disturb the tile cache). Both are mapped to `(zKey, id, kind, geometry object,
  off, fam, erase)`, grouped by `(zKey, id)`, and compared group by group as multisets (the order
  within one native's pieces can differ after a tile is patched rather than rebaked, and does not
  change a family's union). `listFor`'s stamping (`o.res` and the rest) is harmless: the Stage reads
  none of those fields.
- **On failure**: the seed, the step number and the first differing group, with the op log to replay.
- It is kept until `listFor` is deleted with the SVG renderer's step; then the probe is deleted and the
  Stage's own property tests (§6.4) stand.

---

## 3. Freshness end to end, and the interface A3 builds on

### 3.1 The plate, its generation, the two rules

- A stored plate carries the **G its job was packed at** — one integer per job, read from
  `stage.generation` at the moment the job is packed (the pack is lazy, at dispatch,
  `RasterRenderer._packNow` `RasterRenderer.js:1331`, after the frame's `sync`), or the snapshot's G for
  a job packed from a snapshot. The per-plate epoch array in the job (`rasterJob.js`'s `epochs`, filled
  by `PlateStore.beginJob`, `PlateStore.js:456–469`) goes.
- **Rule 1 — replace.** A result for key `k` at generation `g` replaces the stored plate iff there is
  none or `g > stored.G`. At equal G the pixels are equal (the pack and the core are deterministic), so
  the stored one stays. This is F106 with nothing added: a newer result that is itself already stale
  still replaces older stale pixels (today's `"newer"` branch, `PlateStore.js:411–422`).
- **Rule 2 — exact.** A stored plate `p` is exact iff `p.G >= stage.dirtySince(p.key)`. Otherwise it is
  a stand-in, and A3's compose treats it as one (PLAN §1.2's lookup order is A3's).
- The key is A3's (A3 §1.1): a level plate `F │ L<ℓ>s<S> │ i,j`, a rest plate `F │ R<Z> │ i,j`, a plane
  plate `F │ P<Zp> │ <tag> │ i,j`. The Stage needs only the opaque key and the cell's box in its
  frame's units (grown by one device pixel of its level, as `rectOf`'s `EDGE_PAD_PX` does today,
  `PlateStore.js:42`, `:119`).

### 3.2 Jobs: `beginJob`/`endJob` without epochs

- `beginJob(jobId, keys)` records the keys in flight **and tracks each** (`stage.track(key, frame,
  box)`); it returns nothing — the job's G is one scalar the pack writes into the job.
- `endJob(jobId)` releases the in-flight keys; a key that is neither stored nor in flight is
  **untracked**. `put` tracks the key it stores (it already is, from `beginJob`); eviction untracks
  unless a job for the key is in flight.
- `_stillWanted` (`RasterRenderer.js:1356–1380`) keeps only its visibility half (is the cell still
  wanted by a live request — A3's); its epoch half (`:1367–1378`) has nothing to compare, because a job
  is packed at the current G when it is dispatched.
- `_takeResult` (`:1405–1438`) builds records with `G: res.G` instead of `epoch` and `ids`
  (`plateIds`, `rasterWorkerClient.js:613`); the worker stops computing painted-id sets
  (`idsForPlate`, `rasterWorker.js:60–72`).

### 3.3 Every plate set under the same rule

| plate set | packed from | tracked | exact when | notes |
|---|---|---|---|---|
| the view pyramid (A3) | the live table at G | from `beginJob` to eviction | rule 2 | a large dirty region shows the coarser exact level (A3's "blurrier, never older") |
| the rest render (A3) | the live table at G | while it lives; untracked when the camera moves and it is discarded | rule 2 | |
| prefetch: the ring, coarser levels | the live table at G | as the view's | rule 2 | |
| prefetch: the crossing target, a far plane level, a thumbnail | a snapshot at its G | as the view's | rule 2 | the snapshot's G is older than the live G; any commit after it that meets the cell stales the plate |
| the drag plane's layers (MovePlane, kept, PLAN §1.4) | the live table at G, with `only`/`omit` | as the view's, under the layer's own set name | rule 2 — conservative: a change to an item outside the layer but inside the cell stales the layer's plate too | held items do not change during a drag (§2.7), so a plane plate stays exact through the drag unless something else changes under it; today's mid-drag re-post of a staled plane plate (`RasterRenderer.js:560`, `_postPlane`) is the same rule |
| the landing (`_planeLanded`, `RasterRenderer.js:666`) | — | — | each view cell under the plane exact by rule 2 (`cellFresh`, `PictureLayer.js:1132`) | |
| the pen-up's live path (`_releaseHeldLive`, `RasterRenderer.js:809`, today) | — | — | a plate shows the stroke iff `plate.G >= Gs`, `Gs` the G of the commit where its shape lands (it is pending before, §2.8) | A3's group commit (PLAN §1.5) publishes the plates of that rectangle and releases the path in one task; `_plateShows`'s ids per plate (`:854–857`, F123) go |

### 3.4 The interface

This is what A3's pyramid, pack and MovePlane port are written against, and what B-SCENE builds.

```js
/**
 * The Stage: the camera frame's item table, its generation, and the freshness of every plate cell
 * the plate store holds or has in flight. Owns no camera and no plates.
 */
interface Stage {
  // ---- generation ----
  readonly generation: number;
  //   Monotone. Bumped once per commit: an event outside a batch, a batch, a mask-state change,
  //   a drag delta while view plates draw held items. A job packed now reads the table at exactly
  //   this G: every commit <= G is in it, none after.
  onCommit(fn: (G: number, frames: Set<FrameId>) => void): () => void;
  //   After each commit, the frames whose tracked cells it dirtied: the renderer schedules a frame.

  // ---- the live table ----
  readonly frame: FrameId;                         // the camera frame the table is for
  sync(frameId, window: Rect, budgetMs: number): void;
  //   Make the table the camera frame's over `window` (the pyramid's union of wanted cells):
  //   a crossing rebuilds, a window change adds and drops tiles, queued events are applied.
  //   Reads tiles until the budget; what is not read yet is not covered.
  covers(frameId, rect: Rect): boolean;           // every tile under rect is in the table
  items(): Iterable<Item>;                          // paint order, bottom-up (§2.2)
  itemsTopDown(): Iterable<Item>;
  itemsOf(nativeId): Item[];
  placed(item): { geom: Piece, off: [number, number] };
  placeNative(nat, frameId): Placement;            // box(), toStored(x), fromStored(x) (§2.6)
  changesSince(G0: number): Delta | null;          // §2.4; null: rebuild your derived state
  snapshot(frameId, rect: Rect, budgetMs: number): Table | null;
  //   A read-only table for another frame or rectangle, stamped with the G it was read at;
  //   null past the budget. Table has items(), placed(), covers(), generation, fresh().

  // ---- marks (§4) ----
  marks(): Iterable<Item>;                          // the landed pending marks' items in the table
  masks(item: Item, mark: Item): boolean;          // the pure rule of §4.1, boxes included

  // ---- freshness ----
  track(key: string, frameId, box: Rect): void;    // a plate stored or a job begun for this cell
  untrack(key: string): void;                      // evicted, nothing in flight
  dirtySince(key: string): number;
  //   The largest G of a commit since `track(key)` whose footprint (§2.5) meets the cell's box;
  //   0 if none. Rule 2: a plate is exact iff plate.G >= dirtySince(key).
  dirtyRects(frameId, sinceG: number): Rect[] | null;
  //   The footprints, in frameId's units, of the commits after sinceG (a bounded log per frame,
  //   pruned below the oldest tracked plate's G): what a partial re-render clips to. null when
  //   the log no longer reaches sinceG — re-render the whole cell.

  // ---- the drag (§2.7) ----
  hold(sel: { ids: Set<number>, frames: FrameId[] }): void;
  setDragDelta(d: [number, number], opts: { viewDraws: boolean }): void;   // B-DRAG
  release(): void;
  batch<T>(fn: () => T): T;                        // one commit for a bulk change
}
```

What A3 owns and the Stage does not: the key, the cell's box, which cells are wanted and at which
level, the order jobs run in, the compose's choice among exact plates and stand-ins, and the pack's
family table (fed by `changesSince`). What the Stage owns and A3 does not: G, `dirtySince`, the table
and its coverage, the mask rule, `placed`.

### 3.5 Why the invariants hold (PLAN §3 row 1)

- **A stored plate's G never decreases**: rule 1.
- **An exact plate reflects every commit that could change its pixels.** Suppose `p.G >=
  dirtySince(k)` and some commit `c` with `G_c > p.G` has a footprint meeting `k`'s box. When `c`
  committed, `k` was tracked — its plate was stored, or the job that produced `p` was in flight
  (tracked from `beginJob`) — so `dirtySince(k) >= G_c > p.G`: contradiction. The two premises are
  that footprints are conservative (every pixel a commit changes lies in its footprint, §2.5) and that
  the picture-preserving classes of §2.5 change no pixel (within the AA tolerance §4.5 states for the
  erase step).
- **A plate is one consistent snapshot**: the pack reads the table synchronously at one G, and the
  table is never behind the document (§2.4). H3 — a plate packed from a list older than the document
  and stamped fresh (R25 §11.3) — cannot happen: there is no older list. A snapshot's plates carry the
  snapshot's G, so a later commit stales them.
- **Cancellation is only an optimisation**: dropping a queued job whose cell is no longer wanted, or
  re-posting one whose result arrived stale, cannot make a plate exact that is not.

---

## 4. The erase rule, end to end

### 4.1 The state, and the one rule

Three fields, all document state, all on objects the step graph already restores by reference:

| field | on | holds | set by |
|---|---|---|---|
| `targets` | the mark (an erase native) | the ids of the natives under it when its shape landed; never changed after | registration (§4.2) |
| `targetOf` | any native | the marks whose `targets` named it or an object it was cut from | registration (adds the mark); inherited by every piece minted from it (§4.3) |
| `handledBy` | any native | the marks whose bake has dealt with it or with an object it was cut from | a refusal or a graze (adds the mark); a cut or a cede (its pieces inherit the source's set plus the cutting mark) |

Words, since "pending" has two senses in the plan: a **pending mark** is a mark in the document not
yet spent (PLAN §1.3's sense); an item is **pending in the scene** from pen-up until its shape lands
(PLAN §1.5's sense) — for a mark, **unlanded**; a **pending pair** `(M, i)` is a target `i` of `M` under
its mask, not yet handled.

From pen-up until its shape bake lands (`bakeShapeById`) a mark is unlanded, as a new stroke is
pending (PLAN §1.5, §5.1 Q7): packs skip it, the live white SVG path covers its region, and `targets`
is undefined. When the shape lands,
registration (§4.2) runs in the same commit and the mark becomes packable. The rule, in
`src/engine/eraseRule.js`, one pure function used by the pack, the bake, the barriers, the pick and
the Stage's neutral classification:

```js
/** Is native `o` under mark `M`'s mask (before any box test)? */
export function underMask(o, M) {
    if (M.targets === undefined || o.erase || !(zOf(o) < zOf(M))) return false;   // not yet landed: masks nothing
    return has(o.targetOf, M.id) && !has(o.handledBy, M.id);
}
```

A reader that must see a mark's mask before its shape has landed — the pick at a press, a barrier —
resolves pending perimeters first (`flushBakes`), as every barrier already does
(`erasePipeline.js:1207`, `:1256`, `:1314`); the press does it only when a mark is pending, which is
a press within the first slices after an eraser's pen-up.

- **The pack** adds "their boxes meet" (the item's box against the mark's mask box in the job, as
  today, `rasterPack.js:1013–1016`).
- **The bake** adds `_eraseMayTouch` (`erasePipeline.js:569`: the eraser's box mapped into the
  native's stored coordinates, loop by loop) — a tighter box test that decides whether a pending pair
  needs a boolean at all.
- `z(o) < z(M)` is implied by `targetOf` for every operation that exists (a target existed at the
  mark's pen-up, so its z — creation order, inherited by pieces — is below the mark's; the mark's z
  never moves now). It stays in the rule because the reserved `attr` z-op (DESIGN §13) would otherwise
  let the pack and the bake disagree: with it, a target raised above its mark is neither masked nor cut.
- Marks drawn before this change keep the z the old bake stepped them to (`_lowerMark`), and the rule
  reads it: everything the old bake had handled sits above the stepped z.

### 4.2 Registration: targets recorded when the mark's shape lands

**Where.** In `_stepShapeBakes` (`erasePipeline.js:274`) right after `bakeShapeById` for an erase
native, and in `_forceBake` (`:137`) — every path that resolves a mark's perimeter — the pipeline runs
`_registerMark(M)`, synchronously, in the same slice:

1. **The frames pass** (`_eraseFramesPass`, `:455–500`) moves here from the first `_nextEraseTarget`:
   frames the mark's ink covers whole, with `maxZUnder(F) < z(M)`, are set aside as one bake step
   (`removeFrameSubtree(F, { by: M.id })`), O(frames). Their natives lie wholly inside the mark's full
   coverage, under the live white path, and inside the box this commit dirties (§4.5).
2. **The candidate scan** (`_candidatesUnder`'s body, `:402–444`, without the done set and without
   the `doc.rev` keying): every reachable frame's index over the mark's box, and every moved native
   mapped once per (home, table); kept if not an erase native, `z < z(M)` and `_eraseMayTouch`.
3. `M.targets = ids` (sorted), and for each target `o`: `o.targetOf = o.targetOf ∪ {M.id}`.
4. The mark lands: one commit with the shape's change, the frames pass and the
   registration, dirtying the mark's box (§2.8) — the plates under it gain the mask there, A3's partial
   re-render and group commit publish them and release the live white path in one task (PLAN §1.5).

**Why at the shape landing and not at pen-up.** The scan needs the mark's box, and a pen-up is main-thread time
the user feels: the scan measured 20 ms (10.5k candidates) to 131 ms (45k natives, 20k moved) in node
(appendix A), 55–95 ms on the Magnum Opus in Chrome (REVIEW-2026-09-24 CAND-1 and F121 rows). The
first bake slice runs one macrotask after the pen-up (`_scheduleBake(0)`, `KobinEngine.js:1579`), the
same moment today's first `_candidatesUnder` runs, so registration adds no main-thread time — it
replaces the rebuilt scans (§4.13).

**Nothing can move under the mark before its targets are recorded.** Between pen-up and the shape's
landing the plates do not apply the mark (the live white path covers its region, as today), so the
only question is whether the recorded targets are what was under the mark when it was drawn. They are,
because nothing can be moved under it in that window: every gesture that moves ink first
flushes pending perimeters — a select (`_flushErasesFor` → `flushBakes`, `erasePipeline.js:1207`), a
drag's start (`_settleSelectionErases` → `flushBakes`, `:1256`), a lasso (`_settleLassoErases`,
`:1314`) — and an undo of anything but the mark itself is impossible while the mark's op is on top of
the stack; a redo of the mark after an undo re-resolves it against the same document (a new op would
have cleared the redo branch). Settles and merges move no picture. So the recorded targets are what
was under the mark when it was drawn. B-ERASE keeps this as a stated invariant with a test (§6.4 row 3
case c).

**A mark with no targets** after registration is spent at the next tick, as today.

### 4.3 Inheritance at the three mint sites

`Document.eraseReplaceById` (`Document.js:997`), `Document.cedeTileById` (`:1064`) and
`eraseDescent.cedeVirtual` (`eraseDescent.js:110`) each build pieces field by field from the source.
Each gains two lines and one parameter, `by` (the mark whose bake this is):

```js
if (src.targetOf) obj.targetOf = src.targetOf.slice();
obj.handledBy = union(src.handledBy, by);          // a cut or a cede by M has dealt with every piece
```

For a descent every piece is handled by the mark: the remnants of an intermediate link lie outside the
ceded windows and so outside the eraser, and the last link's kids are cut by the eraser. The descent's
specs carry the fields to the main thread already (`objOut`/`objIn` copy the whole object,
`eraseDescent.js:290–296`), and `_applyDescent` mints `{...sp.obj, id}` (`erasePipeline.js:1126`) —
but as they were **at dispatch**: a registration of another mark can land while the job is in the
worker, and registration does not bump `_ver` (it changes no geometry), so the result is still valid.
`_applyDescent` therefore sets every minted piece's `targetOf` and `handledBy` from the **live** target
at apply (all of a descent's pieces descend from that one object); an in-place cut already builds its
pieces from the live object (`eraseReplaceById` reads `src` when it runs). D4
(R25 §2) — the two cede bodies are one function copied — is worth closing in the same change: one
`cede(receiver, …)` with the Document and the virtual document as receivers.

### 4.4 The pack: mask bits from the rule, 16 slots, merged exactly

In `packJob` (`rasterPack.js:965–1016`) the mark block becomes:

- **Marks in the job**: the mark items whose boxes the strip's binner kept (today's `markOf`, keyed
  by family). A mark's mask box is the union of its items' boxes in the job (unchanged).
- **Bits**: item `d` gets mark `K`'s bit iff `underMask(d.nat, K.nat)` and the boxes meet. No done
  set, no z snapshot: the job is packed at one G from a table that is never behind (§3.5), and the
  fields it reads are the document's (E-9/F121's race — a stale list packed with a live done set —
  has no list to be stale).
- **Slots.** Two marks may **share a slot exactly** when no item in the job lies under both marks'
  boxes with different bits: then the shared mask (the max of their coverages, `resolveMask`,
  `rasterCore.js:409–429`) multiplies every item that has either bit by what each would have alone
  (an item under only one of the two boxes gets zero coverage from the other). Marks are assigned
  greedily in z order to the first slot they can share exactly — a quick sequence of dabs over the
  same targets, or dabs over disjoint places, takes one slot — up to **16 slots** (`MASKS_MAX`,
  `rasterJob.js:45`; the item's mask word is 32 bits, `meta[m + 7]`).
- **Past 16 slots** (R24 B3, R25 D2): merge the pair whose shared slot over-hides the fewest items
  (an item gets a mask it should not have: its ink under the other mark's coverage is hidden until one
  of the two is baked), count it (`packStats.maskOverflow`), and raise the older mark's cuts in the
  bake's queue so the overflow clears. **Never white ink**: a mark painted as white ink at its z hides
  every item below it in its region — the objects dragged across it, the targets it refused, the
  pieces other marks have baked — which are exactly what Kobin's rule says must show (A2-Q3).
- **Masks as bytes.** A mask plane is a `Float32Array(512 × 512)`, 1 MiB per slot per worker
  (`rasterCore.js:411`); sixteen are 16 MiB a worker, 64 MiB for four workers. Coverage stored as a
  `Uint8Array` (coverage × 255, rounded) is 256 KiB a slot, 4 MiB for sixteen; the quantisation is
  under half an alpha step, below the byte the plate stores. `resolveMask`, `keepAt` and
  `resolveFamily`'s mask reads (`rasterCore.js:259–273`, `:401–429`) change their arithmetic only.

### 4.5 What an erase change dirties

| change | pixels | dirt |
|---|---|---|
| the shape landing, with registration and the frames pass (§4.2) | the mark's mask appears on the plates (the live white path covered it until now) | box(mark), every frame — one commit; A3's group commit swaps the path for the plates |
| the frames pass (a covered frame set aside, `by: M`) | inside the mark's full coverage, in the landing commit | nothing beyond the landing's box(mark) |
| a cut or a descent applied by the bake or a barrier, `by: M`, on a pending pair `(M, target)` | the masked target renders almost as its pieces: coverage × (1 − mark) against the coverage of target − eraser. `raster.mask.test.js` K4 measured **0 differing bytes** between plates kept through such steps and a fresh raster of the result, for axis-aligned fills and a ring. On real resolved strokes (exp4, appendix A: 8 seeds, 7 strokes, two of them translucent, one random eraser) the kept plates differ from a fresh raster in 86–500 pixels a case: **within 1.5 px of the eraser's edge by up to 11–57 per channel** (the product against the exact area where the target's edge crosses the eraser's), and **elsewhere by at most 3–13, mostly ≤ 4**, on object outlines up to 64 px away and 0–28 pixels outside the mark's box. No target or piece used the union pass in these runs (`entryFor(o).union` false for all), so the far differences are not a routing flip; they fit the rasteriser's own arc tolerance: an arc the cut split is flattened again from its new end points (`ARC_TOL` = 1/16 device px, `rasterPack.js:44`), so its chords move by up to 1/16 px along its whole surviving length — at most 16/255 on its edge pixels | the **dust boxes** only: components `dropDust` removed (`eraseJob.js:49–52`, `Document.js:1092`, `eraseDescent.js:117`, `:237`) can lie outside the eraser's box — a hairline narrower than a quarter pixel at the bake's zoom goes whole — so the job returns their boxes and the step's events carry them |
| a graze, or a refusal with `inkless` | no ink under the mark | none |
| a refusal over ink (`handled`) | the target's ink under the mark reappears | box(target) ∩ box(mark), every frame |
| the mark spent (removed) | the AA-level differences of the neutral steps are replaced by the exact raster | box(mark), every frame |
| an undo of the gesture (steps reverted, the mark removed) | the sources come back whole | ordinary footprints — or, as an optimisation, each reverted step's box(mark) ∩ box(source) ∪ its dust boxes (the step records the mark's box and frame) |

A step is one batch (a descent removes and mints intermediate objects inside it), and the rule is
stated on the batch: a batch tagged `by: M` is neutral iff every native it removes that existed before
it was in a pending pair with M at the previous G; its dirt is then the union of its dust boxes.

This is where today's "neutral" lives now: not a mode flag set around code (`_neutral`,
`erasePipeline.js:551`) and untagged by the engine when a step passes a target left whole
(`KobinEngine.js:204–215`), but a per-event classification the Stage makes from two facts — the
event says which mark's bake it is (`by`), and the rule says whether that mark was masking the target
at the previous G. It holds for a barrier's out-of-order cut exactly as for the tick's, because the
mark's z no longer steps (today's `_neutralUnder`, `:557`, had to ask).

**What the measurement means for the rule.** "Neutral" is "equal to within the anti-aliasing of the
eraser's edge and the rasteriser's arc tolerance", which is also what today's neutral steps leave on
screen. Until the
mark is spent, a plate kept through its steps differs from the exact raster in the band along the
eraser's edge (up to 57/255 on a few hundred pixels) and on the cut arcs' outlines (≤ 13/255 measured,
≤ 16/255 by the flattening tolerance); the
spent mark's re-raster of box(mark) replaces the band, and the outline pixels outside the mark's box are
replaced the next time those cells are rendered — at the latest by A3's rest render at the camera's next
stop, as today's settle does. The alternatives cost more than they buy:

- dirty box(mark) ∩ box(target) per step (TEST-MAP's wording for `raster.bake.test.js`'s replacement):
  replaces the band step by step but not the outlines outside the mark's box; on the Magnum Opus's
  98-step bake (84 refusals, F109) ~14 small rectangles;
- dirty each cut family's whole box at spend: exact, but on a backdrop that is the screen, and A3's
  coarse-first patch would blur it once at the end of every bake.

A2-Q2 recommends the neutral rule; the switch to either alternative is one line in the Stage's classifier.

### 4.6 The pending marks and the pending index

- **The pending marks are a set maintained by events** (R25 §4.6, §4.9), in the erase module:
  `marks: Map<markId, {obj, level}>`, updated on `add`/`insertAt`/`finalize` of an erase native, its
  `remove`, `removeFrame`/`addFrame` of a frame holding one, `mergeFrame`/`splitFrame` (its home), and
  rebuilt from the natives once on `reset`. `_eraseStrokes()` (`erasePipeline.js:111–118`) becomes a
  read of this set in z order — kept under that name for the 23 suites that call it.
- **The pending index**: `lineage: Map<markId, Set<nativeId>>`, the live natives with the mark in
  `targetOf`, maintained on `add`/`remove` of a native carrying `targetOf` and on registration. A mark's
  pending pairs are the members of its lineage the rule keeps. The bake picks its next target from it,
  the barriers select pairs from it, and a mark with no pending pair and nothing in flight is spent.
  Rebuilt from the natives on `reset` and after a replay, O(natives with fields).
- **Pruning.** When a mark is spent, its id is dropped from the `targetOf`/`handledBy` of the live
  natives in its lineage: the mark will never be live again (a spent mark's gesture undoes and redoes
  by its steps; its stroke is not restored, `Document.js:1391–1406`), so the ids are dead data. Objects
  out of the document keep theirs (frozen, and harmless). Headers stay small.

### 4.7 The bake loop, rewritten for parallel cuts

**The serial order** is today's: marks oldest first (`_eraseStrokes` sorts by z ascending,
`erasePipeline.js:116`), each mark's pending targets top-down (`(z, id)` descending, `:439`). With the
mark no longer stepping, the order no longer shapes the picture; it is kept because it makes the
result reproducible.

**Apply in serial order; dispatch ahead of it** — a reorder buffer:

```js
tick():                                  // the timer tick, as today (stands aside for gestures, zoom)
  resolve perimeters (registering each mark as its shape lands, §4.2)
  apply():                               // strictly in serial order
    while (head = serialHead()):         // the lowest-z mark with a pending pair; its highest target
      r = buffer.take(head)
      if (!r) break                      // not landed yet: wait (it is dispatched, below)
      if (!valid(r)) { redispatch(head); continue }
      applyResult(head, r)               // eraseReplaceById / removeById / _applyDescent / setHandled
  dispatch():                            // lookahead in serial order, up to the pool's free slots
    for (M, t) in serialOrder() while pool.free():
      if (inFlight(t) || buffered(M, t)) continue
      if (t is claimed by an earlier mark in serial order) continue   // per-target lock
      if (isDescent(M, t) && descentInFlight) continue                 // descents stay serial
      if (!_eraseMayTouch(M, t)) { handleSilently(M, t); continue }    // no boolean: not pending
      submit(job(M, t), priority)
  spent(): every mark with no pending pair and nothing in flight or buffered: remove it (logged
           `spent`), prune its lineage (§4.6)
```

- **Valid on apply** means: the target is live and unchanged (`_ver` as dispatched — a settle bumps
  it, and the eraser was projected through the old table), the mark is live, and `(M, target)` is
  still a pending pair. An invalid result is dropped and the pair re-dispatched (today's rule,
  `_onCutResult`, `erasePipeline.js:746–771`); a worker failure runs the job inline (today's).
- **The per-target lock** is what keeps a speculative cut from being wasted: a target pending under
  two marks is dispatched only for the first in serial order; the second mark's cut goes to the pieces
  once they exist.
- **Why serial-order apply.** Results arrive in any order; applying them in the serial order makes
  piece ids, step `_seq` order and the op log the same as the inline (jsdom) bake produces. The
  existing erase suites — which run inline — then check exactly what the browser produces, and a bug
  report replays to the same ids on another machine. The cost is head-of-line blocking, which nothing
  sees: every applied step is neutral (§4.5) until the mark is spent.
- **`handleSilently`** marks a pair the tighter box test rules out (a piece a sibling cut minted far
  from this mark) handled in memory only — it is not pending by the bake's rule, has no pixel under
  the mask, and is not persisted; a reload re-derives the same answer.
- **The job** is today's (`eraseJob.cutJob`, `descentJob`), plus the dust boxes in the result. The
  eraser's projection into the target's coordinates (`_eraserLoopsInto`, `erasePipeline.js:611`) is
  memoised per (home, table), as the candidate scan groups — targets that moved together share it.

**The pool** (PLAN §1.6, adopted from A3 §4.1): one pool for plates and cuts, typed jobs with a
required priority — rest 0 > view 1 > plane 2 > **cuts 3, with one worker reserved while any cut is
pending** > prefetch 4 > thumbnails 5 — and one worker script bundling the raster core and the geometry
(`erase-worker.js` 379 KB and `raster-worker.js` 45 KB today). A3 leaves the cut job's contract to
B-ERASE; it is:

```js
pool.submit({ kind: "cut" | "descent", prio: 3, barrier: boolean,   // a barrier's pairs go first within 3
              job,                  // eraseJob's cutJob input, or descentJob's { world, input }, wired as today
              key: { mark, target, ver } })                          // what the reorder buffer validates
  → Promise<result>                 // cutJob's result + dust boxes, or descentJob's steps
```

The order of the two builds decides where cuts run first:

| | B-PYRAMID's queue (A3 §10.1 step 5) has landed | it has not |
|---|---|---|
| where cuts run | the one pool, `kind: "cut"`, the reservation | an interim erase pool: `eraseWorkerClient.js` becomes N workers (`max(1, min(3, cores − 1 − rasterWorkers))`; 3 on 8 cores, 1 on 4, as today) behind the same `submit` |
| what B-ERASE touches in the pool | the reservation rule and the cut kind only | only `eraseWorkerClient.js` — nothing A3 rewrites |
| what goes later | — | the interim pool, when the queue lands (a transport swap behind `submit`) |

Recommendation: build against `submit` either way, and let the order be the orchestrator's (A2-Q5). If
B-ERASE runs concurrently with B-PYRAMID (PLAN §2 lets it), the interim pool keeps the two builds out of
each other's files.

### 4.8 One boolean per target under several marks — weighed, deferred

R25 §4.9: when a target is pending under several marks all above it, subtract their union once. The
saving is real in one scenario (ten quick dabs over a dense area: ten booleans of each object
underneath become one). The cost is structural: the one step belongs to several gestures. Undoing any
one of them must revert it (the target comes back pending under the others, which re-cut it); redoing
it finds the step's source gone and must leave it suspended while its mark cuts the new pieces
instead; the step graph (`Document._stepIndex`, `:1427`) maps a step to one op, the op log's bake
entry names one mark, and the reload rule for `_on` assumes one gesture per step. All of it is doable;
none of it is needed for correctness, and the parallel pool gives 3× where the joint cut gives its
saving only in the dabs case. **Defer**: measure the ten-dabs case with the pool first (A2-Q4).

### 4.9 Persistence

**Fields** (`format2.objectHeader`, `format2.js:55–71`; `KNOWN`, `:52`): an erase native writes
`targets` (sorted ids) once registered; any native writes `targetOf` and `handledBy` when non-empty
(sorted mark ids). `nativeFromRecord` (`Document.js:172`) keeps them; `persist.decodeNatives`
(`persist.js:296–379`) validates them leniently (an array of integers, else dropped — the object
stays). kobin-1 stays version 1: the fields are additive, and a build that does not know them keeps
them through `_extra` (`format2.js:73–77`, DESIGN §13).

**Entries** (`oplog.js`): nothing new is needed for the pieces — a bake entry encodes the removed
object and each piece with `objectHeader` the moment the step lands (`oplog.js:139–160`), so their
`targetOf`/`handledBy` ride in it; a `bakeFrames` entry carries the set-aside natives' headers. Two
additions:

- **A refusal or a graze** (`setHandled(id, M, {inkless})`, emitting `change attrOnly` with
  `attr: {handledBy}`) is logged as an **`attr` entry** `{k: "attr", id, set: {handledBy}}` — the kind
  DESIGN §13 reserves for per-object changes, replayed by the existing case (`oplog.js:591–595`: applied
  when the object's frame's snapshot predates it). Today an `attrOnly` change is logged as a `put` of
  the whole object (`_onEvent`, `oplog.js:84–90`) — for a refused backdrop that re-encodes its geometry.
- **Registration** changes the mark's header (`targets`) and the targets' `targetOf`. The mark's
  change rides the mark's own `mark` entry if the tick has not drained yet, else a `put` of the mark
  that `bakeShapeById` already causes in the same slice (the resolve is a geometry change of the
  mark). The targets' `targetOf` are **not logged**: they are derived at load from the marks'
  `targets` (below), so no target's frame needs a new snapshot at registration.

**Load and replay** — the derivation, in the erase module after `loadDrawing`/`loadSnapshot`
(`files.js:80–106`, `:32–47`) and after `OpLog.replay` (`oplog.js:332`):

1. **Every mark object known** — live in the document, or held by an op in the rebuilt undo/redo
   stacks (an undone gesture's `strokeRec`) — with `targets` registers `targetOf ∪= {M}` on each
   target that exists. Idempotent (a set union), so a target whose snapshot already carries it is
   unchanged. Marks in history count: an undone mark's targets may be cut by another mark before the
   redo, and the pieces must inherit it (§4.10).
2. **A mark without `targets`** (saved before this change) is registered by the old rule, once:
   targets = the candidate scan under its stepped z (everything the old bake had handled lies above
   that z — the reason the old rule resumed "from its own z on a file load", DESIGN §7), minus the ids
   its log's bake entries name (the done set `oplog.js:604–608` rebuilds today; empty for a kobin-1
   file, where re-cutting an already-cut piece grazes: `erase.resume.test.js`'s out-of-order cases
   show nothing is cut twice); and the pieces those entries name get `handledBy ∪= {M}`. The mark's
   `targets` is then logged (an `attr` entry), so the derivation runs once per mark.
3. The lineage index and the pending-marks set are rebuilt (§4.6).

**`snapshotRule`** (`oplog.js:45–49`): a bake entry applies per frame whose snapshot predates it,
unchanged; its pieces carry their fields in their headers either way. An `attr` entry for a refusal
applies only if the object's frame's snapshot predates it — the snapshot, when newer, carries the
field. The derivation is not an entry: it runs after replay over the result, so the rule does not
touch it.

**Size.** `targets` for a wide mark over a dense area can be long — 16k candidates in the synthetic
quarter-view mark of appendix A, about 100 KB of JSON. It lives only while the mark is pending (a
spent mark is removed with its header). If measured large in practice, store it in the frame's
geometry array (the header's `g` span already points there) rather than as JSON (A2-Q8).

**Across versions.** A build without this change editing a drawing mid-bake keeps the fields
(`_extra`) but mints pieces without them and steps the mark's z; opened again in the new build, the
mark's `targets` name ids that no longer exist and the new pieces lack `targetOf`, so that mark's
remaining erase is lost. The drawings affected are those with a mark pending across a version switch;
it belongs with the 1.0 compatibility decision (RENDERER-REBUILD §3.5).

### 4.10 Undo, redo, and the step graph

The step graph stays (PLAN §1.3). What must hold, and why it does:

- **Undo restores `targetOf` and `handledBy`.** `_revertStep` re-inserts the step's source by
  reference (`Document.js:1461`); the source's fields are the ones it had when the step removed it,
  because nothing writes a removed object: registration, refusals and pruning touch live natives only.
  The pieces leave with their fields. A reverted frames-pass step re-attaches the lists by reference.
- **Undo restores `targets`.** The mark leaves and returns as its object (`op.strokeRec`,
  `Document.js:1391–1406`); `targets` is a field on it.
- **The entry carries them.** The step's bake entry encodes the removed object and the pieces with
  their headers (`oplog.js:139–160`) at the moment the step lands — the same moment the live objects
  are frozen — so replay rebuilds the same objects with the same fields (one object per id, the later
  record winning, `oplog.js:355–368`).
- **Replay after a reload agrees with live undo**: both undo by `_stepsUndo` over the same objects;
  the fields that are not in any entry (`targetOf` from registration) are re-derived from `targets`
  at load (§4.9 step 1) over the marks live AND in history, so an undone mark's lineage survives the
  reload.
- **The cases that need thought** (each a test in §6.4):
  - *Undo the mark mid-bake, redo:* the reverted sources carry `targetOf ∋ M` and not `handledBy ∋ M`,
    so when the mark returns they are pending again and masked; the redone steps re-apply (neutral);
    the bake resumes.
  - *Undo an older erase K after M was drawn over K's pieces:* `_stepsUndo(K)` reverts K's steps and
    M's steps that consumed K's pieces; K's source returns with the fields it had before M existed —
    not a target of M. It shows whole, M does not cut it; redo of K re-applies K and then M's suspended
    steps. Today's z-stepping produces the same picture (M had stepped below the source's z). This is
    Kobin's rule read literally — the eraser removes what was under it when drawn, and K's source was
    not under it (K's pieces were) — and it is the one place where "undo means it never happened"
    reads differently (A2-Q9).
  - *A mark undone, its target cut by another mark, the mark redone:* the pieces inherit `targetOf ∋ M`
    from the source (whose registration predates the other cut) and `handledBy ∌ M`, so the redone
    mark cuts them. Today the z rule gives the same result.

### 4.11 The barriers: uncapped, parallel, asynchronous, visible

What a barrier bakes, now expressible exactly because targets are data:

| barrier | the pending pairs it bakes | fixes |
|---|---|---|
| a tap-select (`select`, `selection.js:608`) | every pending pair whose native is the hit object or in its family | — |
| a drag's start (`_beginSelectDrag`, `:76`) | every pending pair among the selection's members (ids, families) **and** under its selected frames, **and** every pending pair of a mark homed under a selected frame (a mark dragged with its frame would carry its mask off its targets) | B4 (today every mark is flushed when a frame is selected, `erasePipeline.js:1262`), B5/H10 (the 200-round cap, `:1272`) |
| a lasso (`_applyLasso`, `:580`) | every pending pair whose target's drawn box meets the loop's box — wherever its mark is | H5 (today only marks whose own box meets the loop, `erasePipeline.js:1318–1323`, so a mark outside the loop that trims an object into it was missed) |
| `flushErases` (tests) | everything | — |

How it runs:

1. The barrier resolves unlanded marks (`flushBakes`, as every barrier does today), computes its pair
   set from the pending index, dispatches it at the head of the cut
   queue (priority above the tick's lookahead), and parks the gesture's continuation: the re-hit and
   `_setSelection` for a tap, the drag's start for a drag, `_lassoFind` for a lasso.
2. **Rounds.** When a round's cuts have all landed, they are applied in serial order (the round is a
   deterministic set, so ids stay deterministic); the pieces still pending under another mark form the
   next round (a target pending under k marks is done in at most k rounds: each cut removes the
   cutting mark from its pieces' pending set). No cap: the loop terminates by that count.
3. **The selection follows the cuts.** A selected id replaced by a step is replaced in the selection
   by all the step's pieces (today's diff of document events inside the barrier,
   `erasePipeline.js:1266–1284`, becomes the steps' own `removed → pieces`).
4. **The state is visible.** The engine's status gains `erase: { marks, finishing }` (`_emit`,
   `KobinEngine.js:1627–1635`, the payload `useKobinEngine` throttles into `status`,
   `useKobinEngine.js:180–194`); the editor shows a chip beside the title's sync status
   (`CanvasEditor.js:822–840`, `SyncChip.js`'s pattern) reading "Finishing the erase…" once a barrier
   has waited 150 ms. A lasso's loop stays drawn until its barrier ends.
5. **Meanwhile** the camera pans and zooms freely; a tool change, a new press or an undo cancels the
   parked continuation (the cuts go on — they are the bake's anyway); a pinch cancels as today.
6. **A drag whose barrier ends while the pointer is still down** starts from the press point, so the
   selection jumps to the finger and follows it; if the pointer was released meanwhile, the drag is
   applied whole (press → release) as one move. **A tap** selects when its barrier ends.
7. **Where there is no worker** (jsdom, a failed script) the cuts run inline inside the barrier, so it
   completes synchronously — every existing test that selects over a pending mark keeps its
   synchronous expectation.

Why asynchronous: parallel cuts cannot be waited for on the main thread (there is no blocking wait
for a worker there), and the synchronous barrier is the 18–30 s freeze of a lasso over a stack still
baking on the Magnum Opus (DESIGN §7, R25 §3.3). Kobin's rule — "if an object is baking, you can't
even select it until it is baked" — holds: nothing is selected, moved or judged before its cuts land.
What changes is that the tab stays responsive while it waits (A2-Q6).

### 4.12 The pick follows the mask

`_hitTest` (`selection.js:992–1041`) walks the table top-down and skips pending marks. It should also
skip an item at a point inside a pending mark's coverage when `(mark, item)` is a pending pair: a
press on the white region of a mark then picks what is visible there — an object dragged across it,
ink drawn after it — instead of the masked target whose selection would start a barrier and then a
re-hit (`select`'s loop, `:608–621`). The test is one `insideTester` per pending mark whose box holds
the point (the pick already builds one per object, `_shapeHit` `:957–975`). A press in the first slices
after an eraser's pen-up resolves the unlanded mark first (§4.1), so the pick never reads a mark
without its targets. A press on the visible part of a pending target still selects it, through its
barrier (A2-Q7).

### 4.13 What happens to each named mechanism

| mechanism | where | becomes |
|---|---|---|
| `_neutral`, `_pictureNeutral`, `_neutralUnder` | `erasePipeline.js:551–557`, `KobinEngine.js:204–216` | the Stage's classification from `by` and the rule (§4.5) |
| `_uncut`, `_uncutOf` | `KobinEngine.js:201–215`, `erasePipeline.js:559–564` | `handledBy` (a refusal over ink shows at once; `inkless` is neutral) |
| `_bakeDone`, `_doneSet`, the replay's done sets | `KobinEngine.js:243`, `erasePipeline.js:176–180`, `oplog.js:601–609`, `files.js:89` | `handledBy` on the objects; the lineage index |
| `_lowerMark` and the half-integer z | `erasePipeline.js:528–534` (`setZById` loses its only caller) | deleted; old marks keep their stepped z as data |
| `_eraseStrokes()` scans | `erasePipeline.js:111–118`, 15 call sites | the maintained set (§4.6), same name |
| `noteListMarks`, `_markNow`, `_listMarks`, `_marksOf`, `markDone`, `markZ` | `KobinEngine.js:650`, `:669–680`, `:692`, `:282–285`; `RasterRenderer.js:246–250`, `:1319–1329`; `rasterPack.js:915`, `:973–974` | deleted: the pack reads the rule at the job's G (§4.4) |
| `_eraseListStale` | `KobinEngine.js:985`, `:1040`, `:1065`; `erasePipeline.js:786` | deleted: the table is never behind (§2.11) |
| `_renderSoon`'s skip rule, `_renderPending` | `erasePipeline.js:777–789`, `:303–307` | "schedule a frame" |
| `_candidatesUnder`'s `doc.rev` keying, `_zScan`, `_ownChange` | `erasePipeline.js:402–444`, `:539–544` | one scan per mark at registration; the lineage index after |
| `_nextEraseTarget` | `erasePipeline.js:504–521` | `serialHead()` over the lineage index |
| `_cutInflight`, `_settleInflight`, the one-at-a-time queue | `erasePipeline.js:725–736`, `:746–796`, `:1083–1092`; `frameGc.js:79`; `sceneClient.js:397`; `report.js:342–349` | the pool's in-flight map and the reorder buffer; `frameGc` waits on a descent in flight only; the report reads the new state |
| the 200-round cap, the barrier's document diff | `erasePipeline.js:1266–1284` | rounds over pairs (§4.11) |
| `_flushErasesFor`'s in-order / out-of-order split | `erasePipeline.js:1206–1234` | gone: the mark does not step, every applied step is neutral |
| the mask slot cap of 8 | `rasterJob.js:45`, `rasterPack.js:974` | 16 exact slots, bytes, overflow merged (§4.4) |

### 4.14 As built (B-ERASE, 2026-09-28) — where the build differs or adds

- **A tap re-picks after its barrier** (§4.11 step 1's "the re-hit"): the selection is the piece under the
  finger, not all of the target's pieces as §5.5 and §6.4 row 7 (a) say — SM-5 and RR-3/4 pin Kobin's
  rule that the half not pressed stays. A drag's barrier still carries a selection to all the pieces of its
  members (step 3). Asked of the orchestrator (B-ERASE Q5).
- **Pruning is an invariant**, not only a spend-time step (§4.6): a live native never names a mark that
  cannot return (spent, or its redo branch cleared) — dropped at the spend from the lineage, as a native
  re-enters (an undo, a frame back) and at a load. Without it an undo of a finished erase left the dead
  id on the restored sources, and a replay disagreed with the live history.
- **The serial order** is keyed by each id's z as it joined the mark's order (a native's z never changes):
  a removed id keeps its place, so the order is a function of the ids alone; ordered by a live lookup, the
  parallel bake diverged from the serial one (two of three seeds). **The lookahead writes nothing**: a
  target still a stroke or a fill waits for its turn at the head.
- **The per-target lock is global in a barrier**: each target a barrier names is cut with the earliest
  mark it is pending under anywhere, so no live bake has an older mark cut a newer one's piece (those
  histories remain possible from an older build's log and from a test's `flushErases(only)`; the step
  graph still handles them).
- **Every tap and drag barrier resolves pending perimeters first**, as the old ones did (a raw stroke
  dragged by its table broke the ants); a lasso only with a mark pending. A barrier ends by spending the
  marks it emptied. `deselect` also cancels a parked gesture.
- **A landed mark without `targets`** — an old file, a test's direct add, an undone old mark redone —
  registers at first sight (the tick, `flushBakes`) by the §4.9 rule: one path.
- **Slots**: two marks share only when no family whose box meets both holds one and not the other among
  its items' marks — the core masks a family whole, by the OR of its items' bits (judged per item first,
  three of the clip suite's 24 plates hid a family's ink above one mark because a piece of it was under
  another). A family carrying both bits reads 1 − max(a, b) for (1 − a)(1 − b), which differ only where
  the two marks' edges overlap. Past 16, the slot the mark over-hides fewest families in
  (`maskOverflow`); the serial order already bakes the oldest mark first, so no separate raise.
- **Redo** re-applies steps with ordinary footprints (a step does not record its dust); only a live bake
  step carries `by`.
- **The SVG renderer** still paints a pending mark as white ink at its z, now over baked pieces and
  objects dragged under it too (`?svg`, export): a mask per target there is B-PYRAMID-2's (the SVG
  demotion), asked as B-ERASE Q6.

---

## 5. Kobin's semantics, traced through the new rule

Each case says what the screen shows at each moment. "Masked" means the item's coverage is multiplied
by (1 − the mark's coverage) in every plate packed after that moment; "neutral" means the step dirties
no plate (§4.5). Plates are rastered in workers and land a frame or a few later; until then the
previous plate shows (rule 1), and PLAN §1.5's held live path covers a fresh stroke or mark.

### 5.1 The drag-across (Kobin: "if I click a low z-order object and drag it across a pending erase mark, it should show through the erase mark")

Y is a low-z object away from the mark's footprint; T is under it.

| moment | what happens | screen |
|---|---|---|
| pen-up of M | M is unlanded (pending in the scene, PLAN §1.5): no pack applies it | the live white path over T; Y unaffected |
| the first bake slice (a macrotask later) | M's shape lands: the frames pass and registration (targets = {T}; Y is not under M) in one commit, box(M) dirtied; A3's partial re-render and group commit | the plates now mask T and the white path goes in the same task: no pixel changes |
| tap on Y | Y has no pending pair: no barrier, selected at once; the drag plane is aimed | Y's ants |
| drag Y across M | the plane's layers: BELOW (the rest, T still masked), SEL = Y packed with the marks — `underMask(Y, M)` is false, no bit — OVER | **Y shows over M's region at every step**; T stays hidden; the bake goes on cutting T in a worker, neutral, invisible |
| drop inside M's region | tables written once (B-DRAG; before it, the hold released): Y's old and new footprints dirtied | the plane holds per cell until the fresh plates land; they show Y unmasked over M's region |
| M's cut of T lands | neutral | no change |
| M spent | removed; box(M) dirtied | the same picture, re-rastered exactly |

Today Y shows through by an accident of bookkeeping: the drag's barrier finds Y not touching M and
adds it to M's done set (`_flushErasesFor`, `erasePipeline.js:1218`), which keeps it unmasked and
uncut. That entry is not a bake step, so it is not saved: after a reload the done set holds only the
ids the log's bake entries name (`oplog.js:604–608`), and while M's stepped z is still above Y's, the z
rule makes Y a candidate and the bake cuts it (REVIEWER-5 noted the done-set side of this,
REVIEW-2026-09-24). Here Y is simply not in M's `targets`, before and after any reload.

### 5.2 A new stroke drawn over a pending mark

S is drawn after M: `z(S) > z(M)`, and S is in no mark's `targets`. At pen-up the live path shows S
over M; its plates land with S unmasked; the bake never looks at S. Unchanged from today.

### 5.3 "Anything baked shows on top of a pending mark" (Kobin, 2026-09-23)

M cuts T into P1, P2 (`handledBy ∋ M`): the step is neutral (the masked T and P1 ∪ P2 are the same
pixels); P1 and P2 are no longer masked by M. Dragged anywhere — across M's region too — they show,
because nothing masks them. If T was also a target of an older mark M0 not yet baked, the pieces
inherit `targetOf ∋ M0` without `handledBy ∋ M0` and stay masked by M0 until M0 cuts them (5.6).

### 5.4 The lasso barrier

A loop is drawn over a region where M has pending targets (it is still baking elsewhere, too).

| moment | what happens | screen |
|---|---|---|
| pointer-up | the pairs whose target's drawn box meets the loop's box (M's, and any other mark's) are dispatched at the head of the cut queue; `_lassoFind` is parked | the loop stays drawn; after 150 ms the chip "Finishing the erase…" |
| each round lands | applied in serial order, neutral; the pieces still pending under another mark are the next round | no change in the picture |
| the last round | `_lassoFind(poly)` over the baked document: the cut-outs inside the loop, not the pre-cut objects | the ants march on the cut-outs; the chip goes; the camera could pan and zoom throughout |
| after | M's other targets, outside the loop, go on baking | no change |

A mark outside the loop's box that trims an object into the loop is now covered (H5): the pair is
selected by the target's box, not the mark's.

### 5.5 The select-before-drag barrier

T is pending under M. With nothing selected, a drag from ink is a lasso (`_beginSelectDrag`,
`selection.js:89`), so the barrier meets a tap first, or a drag begun while something else is selected.

| moment | what happens | screen |
|---|---|---|
| tap on T | the pick finds T where it is visible (outside M's coverage, §4.12); `select`'s barrier dispatches the pairs of T and its family; the selection is parked | T stays masked, nothing selected yet; after 150 ms the chip |
| the cuts land | T's pieces become the selection — all of them, from the steps' own `removed → pieces` | the ants on the pieces; the chip goes |
| press on a piece and drag | `_settleSelectionErases`'s pairs among the members: none left, so the drag starts at once | the pieces follow the finger |
| — or, with another object already selected: press on T and drag | `select(T)`'s barrier, then the members' (none left); the drag is parked meanwhile | T does not move; then the pieces jump to the finger and follow it |
| — released before the cuts landed | the move is applied whole, press → release, as one drag | the pieces land where the finger lifted |

### 5.6 Two marks over one object, the lower one cutting first (R25 §12.2)

M1 (older, lower z) and M2 (newer, higher z) both target T.

| moment | T's state | screen |
|---|---|---|
| both landed | `targetOf = {M1, M2}`, `handledBy = {}` | T masked by both: hidden under E1 ∪ E2 |
| M1 cuts T (serial order: M1 first) | P1 = T − E1: `targetOf {M1, M2}`, `handledBy {M1}` → still masked by M2 | unchanged (neutral) |
| M1 spent | box(M1) re-rastered: P1 masked by M2 inside it | unchanged |
| M2 cuts P1 | P12 = T − E1 − E2, `handledBy {M1, M2}` | unchanged (neutral) |
| M2 spent | box(M2) re-rastered | final picture; at no moment did T's ink under E2 show (the failure R25 §12.2 found in a target-list-only rule) |

### 5.7 A target under a mark that is refused over ink

M's descent of T is refused ("a piece's frame is missing", "no tile ceded", a sealed boolean the
graze rule rejects):

| moment | what happens | screen |
|---|---|---|
| before | T pending under M | T hidden under M |
| the refusal applies (in serial order) | `setHandled(T, M)`: `handledBy ∋ M`, an `attr` entry, the refusal on the gesture's journal note (as today) | box(T) ∩ box(M) re-rastered: **T's ink under M reappears** — the erase did not happen on T, and the picture says so |
| an `inkless` refusal or a graze (F109) | the same field, no dirt | no change (no ink of T was under M) |

Today's `_uncut` kept a refusal over ink masked until the mark stepped past it, then showed it; the end
state is the same, reached without the z step.

### 5.8 Two cases the list above does not name

- **Undo mid-bake.** The gesture's steps revert (the sources come back with `handledBy ∌ M`), the mark
  leaves: the footprints of the reverted steps are dirtied and the original ink returns. Redo: the mark
  returns, its targets are pending again (masked), the steps re-apply (neutral), the bake resumes. A
  result that lands for a mark an undo took is dropped on apply and redone after the redo (F88's rule).
- **Reload mid-bake.** `targets` from the mark's header, `targetOf` re-registered from it, `handledBy`
  from the pieces' headers: the bake resumes on exactly the pairs left, and an object dragged across
  the mark before the reload is still not a target after it — which the z rule could not keep (it
  re-derived candidates from z at every scan).

---

## 6. Deletions, migration, tests, risks, effort

### 6.1 The deletion list

**B-SCENE** (deleted when `cfg.scene` becomes the default, step S3 below; the SVG path keeps `listFor`):

| what | where |
|---|---|
| the queued plate events and their subscriber (the neutral-tag half moves into the Stage's classifier until B-ERASE) | `KobinEngine.js:177`, `:194–216` |
| `_footBelow` and its seeding and clearing | `KobinEngine.js:182`, `:199`, `:641`, `:651–658`, `:714`, `:726–728`, `:734` |
| the drain and its footprint rules | `_drainPlates` `KobinEngine.js:704–737`, `_refilePlates` `:744–749`, `_cellFootIn` `:751–759`, `_frameListPlates` `:765–772`, `EVERYWHERE` `:89` |
| the drag's hold of plate events | `_holdMove` `:185`, `_beginHold` `:775–788`, `_framesFootIn` `:794–807`, `_heldByMove` `:824–830`, `_underHeldFrames` `:831–835`, `_releaseMove` `:894–910`, `_movedRectsIn` `:916–939`, `MOVE_RECTS_MAX` `:63` → `stage.hold`/`release` |
| `_drawnRectIn` | `KobinEngine.js:956–978` |
| the per-list mark snapshot | `listFor`'s `:650`, `:669–680`; `_markNow` `:692`; `RasterRenderer.js:249–250`, `:1319–1329` (`noteListMarks`, `_marksOf`); `rasterPack.js` `markZ` (`:915`, `:973`) |
| the stale-list machinery | `_eraseListStale` `KobinEngine.js:985`, `:1040`, `:1065`, `erasePipeline.js:786`; `_visibleChanged` `KobinEngine.js:1022–1026` and the `_render`/`syncCameraOnly` split in `panBy`/`zoomFactorAt` `:1040–1042`, `:1065–1067` (raster path) |
| the camera step's drain | `RasterRenderer.syncCameraOnly`'s `_drain` `:1018`, `opts.drain` `:178` |
| per-key epochs and their drops | `PlateStore.js`: `epochs` `:143`, `epochOf` `:448`, `isCurrent` `:450`, `beginJob`'s epoch array `:456–469`, `staleInFlight` `:482–486`, `dropById` `:498–510`, `dropRectPerFrame` `:524–554`, `onDocEvent` `:685–700`, `_drop` `:789–792`, `_isStale` `:795`, `_bump` `:805–809`, `_pruneEpochs` `:812–818`, `EPOCH_MAX` `:46`; the epoch counters in `this.s` |
| ids per plate | `PlateStore.js:84–106` (`ascending`, `anyId`, `holdsId`), `put`'s `ids` `:429–430`; `rasterWorker.js` `idsForPlate` `:60–72` and the id runs in the result; `rasterWorkerClient.js` `plateIds` `:613–616`; `RasterRenderer._plateShows` `:854–857` (→ `plate.G >= Gs`) |
| the job's epoch array | `rasterJob.js`'s `JOB_ARRAYS` `"epochs"` → one `G` scalar; `rasterPack.packJob`'s `epochs` (`rasterPack.js:1053`, `:1066`) |
| the dispatch epoch check | `RasterRenderer._stillWanted`'s `:1367–1378` |
| `TileStore._removeObject`'s scan of every tile | `TileStore.js:663–670` → the id → tiles index |
| suites (TEST-MAP) | `raster.markSnap.test.js` (148), `raster.listCover.test.js` (140, replaced by the coverage property), `move.hold.test.js` (164); the epoch and id rules of `raster.plates.test.js`; `raster.job.test.js`'s epoch cases ported to G |

**B-ERASE:**

| what | where |
|---|---|
| the neutral mode flag and the untagging | `_neutral` `erasePipeline.js:551–555`, `_neutralUnder` `:557`, `_pictureNeutral`; the Stage's temporary `isNeutral` predicate from B-SCENE |
| `_uncut` | `KobinEngine.js:201–202`, `:206–215`; `_uncutOf` `erasePipeline.js:559–564` and its 6 call sites |
| done sets | `_bakeDone` `KobinEngine.js:243`; `_doneSet` `erasePipeline.js:176–180`; `markDone` `KobinEngine.js:282–285`, `RasterRenderer.js:246`; `files.js:89`; `oplog.js:601–609` (becomes the old-file derivation, §4.9) |
| the z step | `_lowerMark` `erasePipeline.js:528–534` (and its calls `:372`, `:768`, `:1230`); `setZById` keeps no production caller |
| the rebuilt candidate scans | `_candidatesUnder`'s keying `erasePipeline.js:402–409`, `_zScan`, `_ownChange` `:539–544`; `_nextEraseTarget` `:504–521` → `serialHead()` |
| the one-cut queue | `_cutInflight` (17 sites: `erasePipeline.js:338`, `:725–736`, `:746–771`, `:791–796`, `:1083–1092`, `:1216–1225`, `:1289`, `:1335–1336`; `files.js:90`; `oplog.js:602`; `frameGc.js:79`; `sceneClient.js:397`; `report.js:344`) → the pool's in-flight map |
| the barrier loops | `_flushErasesFor` `erasePipeline.js:1206–1234`, `_settleSelectionErases` `:1253–1303` (the 200-round cap `:1272`), `_settleLassoErases` `:1310–1327`, `flushErases` `:1333–1351` → one barrier over pairs (§4.11) |
| the scans for marks | `_eraseStrokes`'s body `erasePipeline.js:111–118`; `_settleLassoErases`'s scan of every native `:1311–1312` |
| `_renderSoon`'s skip | `erasePipeline.js:777–789`, `ERASE_RENDER_MS` `:55` |
| the done-set mask | `rasterPack.js:965–984`, `:1011–1016`; `MASKS_MAX = 8` `rasterJob.js:45`; float masks `rasterCore.js:80`, `:409–429` |
| suites (TEST-MAP) | `erase.neutral.test.js` (125), `erase.zorder.test.js` (86), `raster.bake.test.js` (212); `raster.mask.test.js` replaced (row 3); `erase.markFrame.test.js` replaced (z and erase read from the object); `erase.cost`, `erase.worker`, `erase.stack`'s barrier mechanics, `move.startCost` MS-2, `hooks/erase.resume` ported |

### 6.2 The migration path

The strangler order R25/RENDERER-REBUILD §4.2 asks for, with the Stage built beside `listFor` and one
flag, `cfg.scene` (engine option and `?scene=0|1`), keeping both until the browser comparison is in:

| step | builds | behind the flag? | runs in both modes |
|---|---|---|---|
| **S1** | `Stage` (table, G, pending items, `placed`/`placeNative` over the `PlacementModel` adapter, `hold`, snapshots), TileStore's hook, id index and partial `read`, the event fields (`oldBelow`, `settle`, `carry`, the `rekey` event); the equivalence probe and test (row 2), the placed test (row 5) | no behaviour change: the Stage is maintained, nothing reads it but the tests | everything |
| **S2** | freshness by G: the plate store's G and tracked cells, `dirtySince` and the dirt log, jobs with one G, the family-level rule with PLAN §5.1 Q15's measurement; the drain, epochs, ids per plate, `_footBelow` and the rect footprints deleted; `_holdMove` → `stage.hold` | the **source of the pack** is switched: the Stage's items (on) or `_lastList` stamped with the G it was built at (off) | G-freshness and the hold, in both: a list built at G packs jobs at G, which is also H3's fix for the old path |
| **S3** | the harness comparison (A3's paper metric, frame times, the pixel diff against `?svg` at rest, before and after); then `cfg.scene` on by default; the raster path stops calling `listFor`; `_eraseListStale`, the list snapshots, `_visibleChanged`'s split deleted | the default flips | `listFor` stays for the SVG renderer and the probe |
| **E1** | the fields, inheritance at the mint sites, registration (with the frames pass moved), persistence and the load-time derivation | requires S3 | — |
| **E2** | the rule in the pack; 16 exact slots, byte masks, overflow merging; the neutral classification by `by`; the mark-aware pick | | |
| **E3** | the lineage index, the reorder-buffer bake, cuts through `pool.submit` (A3's one pool, or the interim erase pool, §4.7) | | |
| **E4** | the asynchronous barriers, `status.erase`, the chip | | |
| **E5** | the deletions of §6.1 and their suites; DESIGN §7/§9, `docs/ai/20-`/`40-` | | |

B-PYRAMID starts from S2's checkpoint (the G interface fixed, PLAN §2). B-ERASE does not depend on
B-PYRAMID: its cuts go through `submit` to whichever pool exists (§4.7). B-DRAG replaces the hold's
queued events with `setDragDelta`. B-MODEL replaces `placeNative`'s internals and the Stage's reroute
adapter (§7).

### 6.3 What stays after both builds

`listFor` (the SVG renderer, the probe), `TileStore`'s reroute memo and `offTouchedSince` (for
`listFor` only; deleted with it or with A1's displaced index), the step graph, `eraseJob`/
`eraseDescent`'s geometry, the frames pass (moved, not changed), `setZById` (the reserved z op).

### 6.4 The property tests (PLAN §3 rows 1, 2, 3, 5, 7)

**Row 1 — a stored plate's generation is monotone; exact iff `plate.G ≥ cell.dirtySince`.** Two
halves: the store's (monotone G, the compose plan never drawing a touched plate as exact) is A3's
`PyramidStore.property.test.js` (A3 §10.2), driven by synthetic footprints; the Stage's — that
`dirtySince` is right for **real document events** — is this one: `src/engine/stage.fresh.test.js`
(plus a 200-seed probe). A Document, LevelMap, TileStore and Stage
(no renderer); the new PlateStore; a fake pool whose jobs are packed at dispatch (the job's G =
`stage.generation` then) and answered in a random order after random delays. Seeded random steps: a
document change (add, remove, a table change, a re-home, a geometry edit, a frame re-address, an
undo — some inside `stage.batch`), a dispatch for a random wanted cell at one of three frames and four
levels, an arrival, an eviction. After every step: (a) no stored plate's G ever decreased; (b) for
every stored plate, `exact` equals the brute-force answer "no commit after plate.G whose footprint —
recomputed independently from the logged before/after states through `LevelMap.mapRectObj` — meets the
cell"; (c) an arrival with `g > stored.G` replaced a stale stored plate (F106). Drives: the Stage's
event handlers and batching, `track`/`untrack`/`dirtySince`, `PlateStore.put`/`beginJob`/`endJob`.

**Row 2 — the scene's items equal `listFor`'s sorted output.** §2.14: `stage.equiv.test.js` (5 seeds ×
40 steps, quick suite) and `stage.equiv.probe.js` (60 × 80). Drives: every event handler of §2.8,
TileStore's hook, the window diff, the reroute adapter, a crossing's rebuild, a reload.

**Row 3 — a mark hides exactly its targets; the masked target looks like its cut pieces; an object
moved under the mark after pen-up is unmasked.** `src/engine/raster/raster.eraseRule.test.js`
(replacing `raster.mask.test.js`), real pixels from `packJob` + `renderPlate` over the Stage's items
(`softCanvas` for the composed view where needed). Seeded: 3–12 objects (strokes, fills, shapes, one
translucent, one keyed family through a cede), 1–3 eraser gestures, a random subset of other objects
dragged across a mark after its registration.
- (a) *Exactly its targets*: at every step of the bake, for every item and pending mark, the bit the
  pack sets equals an oracle computed from the op history (targets recorded at registration; each cut
  step maps its removed id to its pieces; a refusal adds the mark) — lineage by replay, not by the
  fields under test.
- (b) *The masked target is its pieces*: rasterise the plates before a step and after it, and after the
  whole bake compare a fresh raster with the plates kept through the neutral steps: every differing
  pixel lies within 1.5 px of a mark's edge (any difference) or on a cut arc's outline (≤ 16 per
  channel, the flattening tolerance), and nothing differs outside the union of the marks' boxes and the
  cut families' boxes —
  the envelope exp4 measured (appendix A); exactly 0 bytes for axis-aligned fills (K4). This is the
  test the neutral classification (§4.5) stands on: a difference outside the envelope is a bug.
- (c) *Moved under after pen-up*: every dragged-across object's pixels equal those of a raster with the
  marks deleted outright, at every drag step (the drag plane's SEL layer) and after the drop; and it is
  never cut (its id never appears in a step's `removed`). Includes a drag begun while the mark is still
  unlanded (the barrier's `flushBakes` lands it and registers its targets first).
- (d) *Two marks, lower first* (§5.6) and *refused over ink* (§5.7), deterministic cases.
Drives: registration, the three mint sites, `underMask`, the pack's slots and bits, the core's mask
pass, the reorder buffer, the Stage's classifier.

**Row 5 — the placed read equals the numeric table.** `src/engine/stage.placed.test.js`. Random natives
at random homes with random snapped tables (entries at depths 0–4), a camera frame at random depths
above and below the home over random lattice paths of up to three frame steps (A3's E2: beyond that the
float affine itself rounds). For each native's items in the camera table: the points of `placed(item)`
(`geom` translated by `off`) against a reference computed exactly — the stored points mapped through
the exact chain plus the table's total translation Σ below[k]·R^(D−hd−k), in BigInt dyadic arithmetic,
rounded once — to 1e-9 of the frame's units; and the inverse, `placeNative(nat, F).toStored(p)` for
random input points, back to the same tolerance. Drives: `objShift`, the tile derivation of rerouted
groups, `placed`, `placeNative`, the hit test's inverse (`p − off`).

**Row 7 — the selection stands for the same ink through cuts** (A1 owns settles and merges).
`src/engine/select.eraseBarrier.test.js`. Random objects under random pending marks; (a) a tap on a
pending target: after the barrier, `selection.ids` is exactly the set of the target's pieces — all
descendants through every mark pending over it — and `_selectionMembers` covers them and nothing else;
a drag moves exactly them; (b) a lasso over a region with pending targets: the selection equals
`_lassoFind` of the same loop over a clone of the document baked to completion first (the
brute-force oracle), including a mark outside the loop's box trimming an object into it (H5); (c) a
frame selection with a pending mark homed under it: the mark is finished before the frame moves (B4's
scope). Drives: the barrier rounds, the selection's re-targeting from the steps, `_lassoFind`.

### 6.5 Risks

1. **Hidden writers.** Anything that changes what an item draws without an event leaves the table
   wrong: the idle fitter's `_outline` (`KobinEngine.js:1303–1306`), `_resplitFamily` writing `editId`
   then `keysChanged()` with no event (`erasePipeline.js:1036–1042`), replay's `adopt` mutating an object
   in place (`oplog.js:356–361`, harmless because a load resets the Stage after it). Each gets an event
   or a `stage.touch(id)`; the equivalence fuzz is what finds the next one.
2. **Re-entrancy.** `Document.at` settles and carries inside the Stage's own reads; tile bakes can
   settle frames they read (F78). The Stage queues events raised inside `sync` and drains them after,
   bounded; a bug here is a table off by one event, which the fuzz catches.
3. **Dirt cost on bulk operations.** Per-event footprints on a 20k-member undo without `batch` would be
   20k passes over the tracked cells; every bulk entry point must be wrapped. Measure the 20k undo
   (today's `_releaseMove` is the reference: one pass).
4. **The neutral classification's premise** (§4.5, least-sure 1).
5. **Asynchronous barriers** change what a tap and a drag feel like (least-sure 2).
6. **Two builds in one file.** B-ERASE's mask block and B-PYRAMID's pack both edit
   `rasterPack.packJob`, and both touch the worker pool. Keep B-ERASE to the mark block and the erase
   client; B-PYRAMID owns the rest.
7. **A1 changes the mint sites.** "Cede kids in private frames" (A1's leaning) must keep §4.3's two
   lines in whatever mints the kids.
8. **Mixed-version editing mid-bake** loses the remaining erase of a pending mark (§4.9).

### 6.6 Effort (agent-days, one builder, tests and docs included)

| build | pieces | estimate |
|---|---|---|
| **B-SCENE** | the Stage core — table, indexes, window diff, rebuild, G, commit/batch, `changesSince`, pending items (3); TileStore's hook, id index and partial `read` (1.5–2); the event fields, the dirt and tracking, the family-level rule and its measurement (2); the plate store's G and the renderer's pack from items (1.5); the consumers — pick, ants, `_planeState`, `_selectionRect`, the overlay's cache keys (1); rows 1, 2, 5 and the probe (1.5–2); deletions and docs (0.5–1) | **11–13** |
| **B-ERASE** | fields, inheritance, registration with the frames pass moved (1.5); persistence, `attr` entries, the load-time derivation (1.5); the rule in the pack, slots, byte masks (1); the lineage index, the reorder buffer, the cut contract and — if B-ERASE lands before A3's queue — the interim pool (2); asynchronous barriers, `status.erase`, the chip (1.5); rows 3 and 7 and the ported suites (1.5); deletions and docs (0.5) | **8–10** (joint cuts not included: +2–3 if A2-Q4 says now) |

RENDERER-REBUILD §4.3 put step 1 at "one to two weeks with the tests" and step 4 at "a few days once 1
holds"; the asynchronous barriers and the persistence derivation are why B-ERASE is more than a few.

---

## 7. Seams: what A2 needs from A1, what A3 needs from A2, and where they could conflict

### 7.1 From A1 (the document model) — through `placed()`/`placeNative()`

A1 §6 already wrote the contract as an interface, and this design adopts it whole (§2.6, §2.10): the
Stage reads membership and placement through `PlacementModel.nativesIn(F)`, `placement(o, F) → {F0,
rem}` and `displaced(F) → {rev, groups}`, and nothing else. B-SCENE implements the model over today's
calls (`doc.at`, `objShift`/`residual`, `_rerouteGroups`); B-MODEL replaces the body. What else A2 needs
from A1:

- **Events that name what moved.** A placement change names one native (`offsetsOnly` with `oldBelow`)
  or one frame (`refile` with `from`/`to` and, under C1, `shiftBefore`/`shiftAfter`); the Stage
  re-places `byHome`'s natives of that frame and its subtree, never a walk of the document. Under C1 the
  `settle` events and the Stage's re-entry loop go; under C3 `mergeFrame`/`splitFrame` go.
- **The mint sites keep the erase fields.** C4 ("a cede's kids live in private frames of their object")
  changes where `cedeTileById`/`cedeVirtual` home their kids; the two lines of §4.3 (`targetOf` copied,
  `handledBy` plus the cutting mark) must survive the change, and the frames pass (§4.2) must treat a
  private frame like any other under the mark.
- **The barrier's frame questions.** A frame selection's barrier (§4.11) asks "is this native under a
  selected frame" (`_underFrames`, `selection.js:165`) and "is this mark homed under one"; under C3 and
  C4 that is A1's container relation, not the lattice's `isUnder`.
- **The selection's re-targeting** after a cut (§4.11 step 3, row 7 of §6.4) and A1's C2 ("the
  selection is repaired from the op's own record, never from events") are the same idea; B-ERASE
  repairs from the bake steps' `removed → pieces`, which is an op record.

### 7.2 To A3 (the pyramid) — the interface of §3.4, adopted in PLAN §5.1

A3 §4.2 and §11 read §2 of this document as the interface and ask for two changes, both taken here:

- **PLAN §5.1 Q7, pending from pen-up to the shape bake** (§2.3 `pending`, §2.8's rows): packs and snapshots skip a
  pending native, the pick sees it, its `remove` dirties nothing, the shape landing is one commit with its
  footprint; for a mark the frames pass and registration ride that commit, so its mask appears on the
  plates exactly when A3's group commit swaps the white path for them.
- **PLAN §5.1 Q15, family-level dirt** (§2.5): a membership change that flips a family's routing, sign, colour or
  alpha dirties the family's whole box, measured before it is kept.

And what A3 relies on that §3.4 states: `generation`, `track`/`untrack`/`dirtySince`, `dirtyRects` (the
dirt log a patch clips to), `covers` and the partial `store.read` (A3 §4.2), `snapshot` (its far levels,
the crossing target, thumbnails), `items`/`placed`/`changesSince` (its pack and family table),
`hold`/`release`/`setDragDelta` (its MovePlane port, §6 of A3), `marks`/`masks` (the pack's mark block).

### 7.3 Where the three could conflict

| place | A1 | A2 | A3 | resolution |
|---|---|---|---|---|
| `rasterPack.packJob` | — | the mark block: bits from the rule, slots, merging (§4.4) | the prepass keyed on `(G, Zq, only, omit)` patched from `changesSince`, one geometry snapshot per generation | B-ERASE edits the mark block only; B-PYRAMID owns the rest; whichever lands second rebases |
| the worker pool | — | the cut job's contract and the reservation (§4.7) | the queue, priorities, cancellation (A3 §4.1, §4.4) | the `submit` contract of §4.7; an interim erase pool if B-ERASE lands first |
| the drag | C2: no writes during a drag, re-home once at the drop | `hold`/`release` (B-SCENE), `setDragDelta` (B-DRAG) | the plane's layers and the "never both" rule | B-DRAG is one build; A1's C2 and PLAN §1.4 describe the same drop |
| the frames pass and frame footprints | C4's private frames; invariant 2's reach box assumed by the enclosed-frame tests (A1 §0 correction 1) | the frames pass at registration (§4.2); frame footprints for dirt (§2.8's `refile` row) | frames' plates removed on a re-address | the footprint of a frame is A1's to define once C1/C4 land (a private frame's content is not bounded by its cell ± REACH if its object's picture is displaced) — the Stage asks the model for a frame's footprint rather than computing `cell ± REACH` itself |
| `TileStore` | the displaced index replaces the reroute (A1's `displaced`) | the hook and the id → tiles index (§2.9); the partial `read` (PLAN §5.1 Q12) | cache-only camera reads, idle bakes (A3 §4.2) | B-SCENE owns TileStore's surface (PLAN §5.1 Q12); A1's `displaced` is called by it, not reimplemented |
| `Document` events | removes `settle`, `mergeFrame`/`splitFrame`; adds frame shift fields | adds `oldBelow`, `settle`/`carry` flags (until C1), `rekey`, `handled`, `targets`, `by` | — | the Stage's event table (§2.8) is the one list; each build edits its rows |

The one real overlap is the frame footprint: today's `cell ± REACH` rule (`_cellFootIn`,
`KobinEngine.js:751`) is correct only while invariant 2 bounds a frame's content, and A1's C1 (a frame's
shift composed on read) and C4 (private frames) both loosen what "a frame's content" is near. The Stage
should take a frame's footprint from the model (`model.frameFootprint(frame)`) so the question is
answered in one place.

---

## 8. Least sure

1. **The neutral classification's premise** (§4.5): that a target masked by its mark renders as its cut
   pieces closely enough to leave the plate alone. Measured twice: `raster.mask.test.js` K4 (axis-aligned
   fills, 0 differing bytes) and exp4 (real resolved strokes: up to 57/255 in the band along the eraser's
   edge, ≤ 13/255 on the cut arcs' outlines elsewhere — the 1/16 px arc tolerance — 86–500 pixels a
   case). Not measured: descents (a cede's kids
   against the masked parent at depth), translucent keyed families through the union pass, arcs frozen to
   chords by the boolean. The rule is today's in effect (today's neutral steps leave the same pixels), so
   the risk is not new; row 3 (b)'s envelope is what would catch a class outside it.
2. **The asynchronous barriers' feel** (§4.11): nothing here was tried in a browser. The drag that
   starts late and jumps to the finger, the tap whose selection appears a moment later, and the chip
   after 150 ms are my reading of "the barriers stay, visibly"; Kobin may prefer today's freeze for a
   small barrier, or no jump.
3. **"Nothing can move under a mark before its targets are recorded"** (§4.2) is proved by
   enumerating the paths that move ink — the three gestures that flush pending perimeters, the undo
   stack's order, settles and merges moving no picture. A path I did not enumerate (a cloud follower
   applying a remote store while a mark is pending — read-only tabs do not bake or register, but the
   holder's tab reloads nothing mid-gesture; a report replay) would record a moved-in object as a
   target. Row 3 (c) tests the three gestures, not the unknown path.
4. **The measurements are synthetic.** Every number of appendix A is node + jsdom on rectangles; the
   case for the incremental table rests on the pack's prepass costing 24–39 ms per new list there. On
   the Magnum Opus in Chrome a pen-up's list was 8–13 ms and its prepass ~7 ms with family reuse
   (REVIEW-2026-09-24); the per-generation saving on real drawings is inferred, not measured.
5. **Parallel = serial, bit for bit** (§4.7): the reorder buffer applies in the serial order computed
   as it goes; I have not traced whether a descent's minted frames (serialised, but dispatched against
   the lattice as it stood at dispatch) or a `handleSilently` decision made against a placement that a
   settle then changes can make the inline and the parallel bakes differ. The erase suites, run through
   the pool's inline path and through a fake transport with shuffled arrivals, are the check.
6. **The family-level rule's cost** (§2.5): recomputing a family's routing and sign at every membership
   change is O(k²) pairwise box tests in the worst case (`familyUnion`); a backdrop cut into hundreds of
   keyed pieces pays it per commit that touches it. Unmeasured; PLAN §5.1 Q15's measurement may remove the rule.
7. **`targets` in the header** (§4.9): 16k ids for the synthetic quarter-view mark, ~100 KB of JSON while
   the mark is pending. Real marks on the Magnum Opus are unmeasured.

---

## 9. Questions, each with my recommendation

**A2-Q1. The class's name.** PLAN calls it `Scene`; the Scenes panel (`sceneIndex`, `sceneClient`,
`sceneOps`, `docMeta.scenes`) owns the word in code. *Recommend `Stage`* (`src/engine/Stage.js`,
`engine.stage`), "the scene" in prose.

**A2-Q2. An erase step under its own mark: neutral, or its rectangle re-rendered?** TEST-MAP's line for
`raster.bake.test.js` reads "a cut under its mark re-renders its rectangle to the same pixels"; §4.5
dirties nothing but the dust boxes (A3 §3.7 adopted this). Measured (exp4): not the same pixels —
up to 57/255 in the band along the eraser's edge, ≤ 13/255 on outlines elsewhere — which the spent
mark's box re-raster and the next rest render replace, as today. *Recommend neutral*, with row 3 (b)'s
envelope as the gate; re-rendering box(mark) ∩ box(target) per step would fix the band a step earlier
and leave the outline pixels, at ~14 extra re-rasters a Magnum Opus bake.

**A2-Q3. Past 16 mask slots: merge, or white ink?** PLAN §1.3 says white ink. White ink at a mark's z hides
everything below it in its region — the objects dragged across it, the targets it refused, the pieces
other marks baked — which is what Kobin's rule says shows. *Recommend merging the least-conflicting pair
(an over-hide until one of them is baked), counting it, and raising the older mark's cuts; never white
ink.*

**A2-Q4. One boolean per target under several marks: in B-ERASE, or later?** It makes one step belong to
several gestures (undo of any reverts it and the others re-cut; redo leaves it suspended), for a saving
in one scenario. *Recommend later*: measure ten quick dabs over a dense area with the parallel pool
first.

**A2-Q5. Where cuts run first.** A3's queue (cuts at priority 3, one worker reserved) is the target; it is
B-PYRAMID's step 5. *Recommend B-ERASE builds against the `submit` contract of §4.7, and — if it runs
before or beside B-PYRAMID — ships an interim N-worker erase pool behind it*, so neither build edits the
other's files; the interim pool goes when the queue lands.

**A2-Q6. Barriers asynchronous?** Parallel cuts cannot be waited for synchronously on the main thread.
*Recommend asynchronous always* (inline only where there is no worker, which keeps the suites
synchronous), with the chip after 150 ms, a drag that starts from the press point when its cuts land
(the selection jumps to the finger), a tap that selects when they land, and any new gesture, tool change
or undo cancelling the parked continuation. Alternative, if Kobin prefers: keep a synchronous barrier
when its estimated work is small (one cut under ~2k pieces) — two paths; I would not.

**A2-Q7. The pick follows the mask?** A press on a mark's white region picks what is visible there instead
of the masked target (then a barrier, then a re-hit). *Recommend yes* (§4.12).

**A2-Q8. `targets` as JSON ids on the mark's header.** *Recommend yes*, moved into the frame's geometry
array only if a real mark is measured over ~1k ids.

**A2-Q9. Undo of an older erase K after a mark M was drawn over K's pieces.** K's source comes back whole
and M does not cut it (M's targets were K's pieces). Today's z-stepping gives the same picture. It is
Kobin's rule read literally; "undo means K never happened" would read differently. *Recommend keep; ask
Kobin once, with the example.*

**A2-Q10. When targets are recorded: at the shape landing, not at pen-up.** PLAN §5.1 Q7 says the mark's
"targets are recorded and its mask is in force for the hit test and the bake from pen-up". Recorded at
the shape landing (the first bake slice, a macrotask after pen-up), with the pick and the barriers
resolving pending perimeters first, every reader gets the same answer, and the pen-up does not pay the
scan (20–131 ms synthetic, 55–95 ms on the Magnum Opus). *Recommend at the shape landing.*

**A2-Q11. B-SCENE's hold before B-DRAG.** Held natives' events are queued (the table keeps the pre-drag
state, which is what the drag plane was aimed from) and applied at the release as one batch; the
equivalence fuzz skips held states. *Recommend yes.*

**A2-Q12. Keep `z(i) < z(M)` in the rule.** Implied by `targetOf` today; it keeps the pack and the bake
agreeing if the reserved z op ever lands. *Recommend keep.*

**A2-Q13. The frames pass at registration.** It runs in the commit where the mark's shape lands instead of
before the first target, so its set-aside cannot catch an object moved in later. *Recommend yes.*

**A2-Q14. Off-camera reads through `stage.snapshot` in B-SCENE.** The crossing target, far plane levels,
thumbnails and the far levels read snapshots; `listFor` is left to the SVG renderer and the fuzz.
*Recommend yes.*

**A2-Q15. Prune a spent mark's id from the live natives' fields.** Dead data once the mark is spent;
objects out of the document keep theirs. *Recommend yes.*

---

## Appendix A. Measurements

Node 22.22.2 + jsdom 16, esbuild bundles of the repo's modules at `ff0c6c7`, the SVG engine
(`raster: false`) built by `doc.add` without renders; synthetic rectangle shapes (`rectLoop`), N in the
camera's frame over the view, M one level down (read by the camera as down pieces), "moved" = a
home-level table entry within ±25 units. Scripts: `scratchpad/a2/exp1.entry.js`, `exp2.entry.js`,
`exp3.entry.js`. Medians of 5–7 runs unless noted.

**exp1 — `listFor` and two whole-array tables**

| N own | M down | list items | `listFor` warm | sort alone | table: splice per item (replace 1 by 3) | table: batched merge |
|---|---|---|---|---|---|---|
| 2,000 | 0 | 2,000 | 0.43 ms | 0.14 ms | 181 µs | 25 µs |
| 5,000 | 2,000 | 7,000 | 0.77 ms | 0.25 ms | 530 µs | 71 µs |
| 15,000 | 5,000 | 20,000 | 3.68 ms | 0.49 ms | 1,491 µs | 1,095 µs |
| 40,000 | 5,000 | 45,000 | 4.31 ms | 1.15 ms | 3,403 µs | 640 µs |

(The SVG engine's first render was 0.95 s to 137 s at these sizes — the reason the experiment builds
without rendering, and irrelevant to the raster path.)

**exp2 — moved objects, the pack's prepass, the chunked table, the candidate scan**

| N own | M down | moved | list items | `listFor` warm | prepass, new list | prepass, cold | chunked: replace 1 by 3 | chunked: build | candidate scan (quarter-view mark) |
|---|---|---|---|---|---|---|---|---|---|
| 20,000 | 5,000 | 0 | 25,000 | 2.74 ms | 26.8 ms | 145.4 ms | 26.0 µs | 3.7 ms | 19.5 ms, 10,521 candidates |
| 20,000 | 5,000 | 10,000 | 25,000 | 7.75 ms | 24.4 ms | 110.3 ms | 24.4 µs | 2.8 ms | 68.6 ms, 10,690 |
| 40,000 | 5,000 | 20,000 | 45,000 | 16.79 ms | 38.7 ms | 197.7 ms | 25.4 µs | 5.0 ms | 131.0 ms, 16,321 |

"Prepass, new list" is `paintFamilies` on a freshly built list of unchanged objects (the `sameFamily`
reuse path, `rasterPack.js:816–828`); "cold" after `clearPackCaches`.

**exp4 — the masked target against its pieces, on real strokes** (`scratchpad/a2/exp4.entry.js`, the
flow of `raster.mask.test.js` K4 with the raster engine, `softCanvas` and the inline worker path: 7
random strokes drawn through the pointer API, widths 8–68 px, two at opacity 0.45; one random eraser
of 10–40 px, left pending; plates rastered; the whole bake run in order (every step neutral); the kept
plates compared with a fresh raster of the result)

| seed | steps | pixels differing | outside the mark's box | > 1.5 px from its edge | max diff near the edge | max diff farther (≤1 / ≤4 / ≤16 / >16) | farthest |
|---|---|---|---|---|---|---|---|
| 1 | 4 | 222 | 0 | 69 | 29 | 7 (27 / 36 / 6 / 0) | 12.0 px |
| 2 | 2 | 86 | 28 | 64 | 11 | 3 (52 / 12 / 0 / 0) | 45.0 px |
| 3 | 4 | 270 | 4 | 101 | 31 | 9 (45 / 35 / 21 / 0) | 13.7 px |
| 4 | 4 | 218 | 6 | 80 | 18 | 13 (37 / 30 / 13 / 0) | 10.4 px |
| 5 | 2 | 125 | 0 | 22 | 22 | 6 (10 / 9 / 3 / 0) | 20.7 px |
| 6 | 7 | 500 | 4 | 96 | 33 | 10 (47 / 39 / 10 / 0) | 31.2 px |
| 7 | 1 | 159 | 0 | 68 | 57 | 7 (37 / 21 / 10 / 0) | 10.6 px |
| 8 | 3 | 117 | 3 | 40 | 14 | 5 (27 / 12 / 1 / 0) | 64.0 px |

Differences are per RGB channel on a 0–255 byte; "pixels" of 2–4 plates of 512² (1–4 M bytes). K4's
0 bytes comes from bars whose edges lie on pixel boundaries, so the product and the exact area agree.
No target and no piece used the union pass in these runs (`entryFor(o).union` false for all 27 targets
and 74 pieces), so the far differences are not a routing flip (PLAN §5.1 Q15's case is not exercised here); they
are within the 16/255 the 1/16 px arc tolerance allows on the edge pixels of an arc re-flattened from
new end points.

**exp3 — a plain walk of the chunked table, and the rule over every item**

| items | walk | `underMask` + box test × 3 marks over every item |
|---|---|---|
| 25,000 | 1.14 ms (JIT warm-up) | 4.68 ms |
| 45,000 | 0.34 ms | 1.54 ms |
| 100,000 | 1.60 ms | 4.16 ms |

A pack evaluates the rule only for the items of its strip.

**From the repository's records** (not measured here): a pen-up's list 8–13 ms and prepass ~7 ms for
9.4k items on the Magnum Opus in Chrome (REVIEW-2026-09-24, "PEN-UP (Magnum, Chrome)"); the first
candidate scan 95 ms there after CAND-1, 55–87 ms on a clean load (the F121 row); a bake step ~200 ms
with the boolean 143–175 ms of it (R25 §4.9); F109's bake 30–31 s → 18–22 s and renders per bake 52 → 2–3
once steps under the mark stopped re-rastering (REVIEW-2026-09-24, TESTER); `raster.mask.test.js` K4, 0
differing bytes between plates kept through neutral cuts and a fresh raster.
