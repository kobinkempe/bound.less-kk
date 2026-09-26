# A2 — The scene, the generation model and the erase rule (2026-09-26)

Analysis A2 of the renderer rebuild (PLAN §1.1, §1.3, §1.6). Read-only: nothing under `src/` was
changed. Every claim about today's code is quoted `file:line` against the tree at `ff0c6c7`; every
number says where it came from. The node experiments are in the session scratchpad under `a2/`
(`exp1`, `exp2`, `exp3`; esbuild bundles of the repo's modules run under node 22 + jsdom).

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

**The erase rule.** A mark records `targets` (ids) when its perimeter resolves; every native carries
`targetOf` and `handledBy` (mark ids), set at registration and inherited by the pieces a cut or a cede
mints (the cutter added to `handledBy`); a refusal or a graze adds the mark to `handledBy`. The rule,
one pure function used by the pack, the bake, the barriers and the hit test:

> item *i* is masked by pending mark *M* iff `M ∈ i.targetOf`, `M ∉ i.handledBy`, `z(i) < z(M)`, and
> their boxes meet — and while *M* is still unresolved (pen-up to perimeter, a few ms), iff `z(i) < z(M)`.

Undo restores the fields by reference (a removed object is frozen), the op log carries them in the
object headers it already writes, and a file saved before the change derives them at load from the
mark's z and the log's bake entries. A cut applied by its own mark on a target it masked changes no
pixel (the masked target renders as its pieces: `raster.mask.test.js` K4 measured 0 differing bytes),
so the scene classifies it as neutral from the rule and the event's `by` field — no mode flag, no
`_uncut`, no untagging. Cuts run in parallel (N erase workers first, the one pool later), results are
applied in the serial bake's order so a parallel bake produces the serial bake's document, descents
stay serial, and the barriers become asynchronous rounds with a visible "finishing the erase" state.

**Where this departs from PLAN §1.1/§1.3** (each is a question in §9): the class is named `Stage`, not
`Scene` (the Scenes panel owns that word); mask overflow past 16 slots merges slots and never paints
white ink (white ink hides exactly the drag-across objects Kobin's rule protects); one boolean per
target under several marks is deferred (it makes a step belong to several gestures); the barriers are
asynchronous (parallel cuts cannot be waited for synchronously on the main thread).

**Effort** (§6.6): B-SCENE 8–11 agent-days, B-ERASE 8–10, both with their tests.

---

## 1. The facts the design rests on

- **The list today.** `KobinEngine.listFor` (`KobinEngine.js:617–686`) concatenates the visible
  tiles' pieces (`TileStore.content`, `TileStore.js:127–149`, which reroutes moved objects through
  `_reroute`/`_rerouteGroups`, `:199–282`) and the frame's own natives (`ownContent` → `Document.at`,
  `:292–296`), then looks each item up in the document (`:640`) to stamp `editId`, a mark's `erase`
  and z (`:647–650`), the residual `res` (`:656–661`), seeds `_footBelow` (`:651–655`), sorts by
  `(z ?? id, id)` (`:665`) and snapshots each pending mark's z and handled set for the renderer
  (`:669–680`, F121). It WRITES onto the objects it returns: `o.res` onto a native in the camera
  frame, `o.editId`/`o.erase`/`o.z` onto tile pieces.
- **Between rebuilds** the picture is composed from the same list (`syncCameraOnly`,
  `RasterRenderer.js:1017–1023`), and the engine decides which path by five predicates plus
  `_eraseListStale` (`KobinEngine.js:1040`, `:1065`).
- **Invalidation** is reconstructed late: document events are queued (`KobinEngine.js:194–216`, with
  the neutral tag), drained at the next render (`_drainPlates`, `:704–736`) into per-key epoch bumps
  by id and by rectangle (`PlateStore.dropById` `:498`, `dropRectPerFrame` `:524`), with the old
  table remembered in `_footBelow` (cleared past 1,024 entries, `:734`, D6/B2). A drag holds its
  members' events (`_heldByMove` `:824`) and releases one collapsed invalidation (`_releaseMove`
  `:894`, `_movedRectsIn` `:916`).
- **TileStore patches in place**: a remove filters every cached tile (`_removeObject`, `:663–670`, a
  scan of the whole cache per event), an add appends to the tiles a cold bake would put it in or drops
  a chained tile whose parents are not cached (`_addObject`, `:678–700`); frame events drop tiles by
  footprint (`_onFrameEvent`, `:600–629`); a stale `chainSeq` rebuilds a tile at its next read.
- **Erase state** lives in six places: the mark's stepped z (`_lowerMark`, `erasePipeline.js:528`),
  the done sets (`_bakeDone`, `KobinEngine.js:243`; `_doneSet` `:176`), `_uncut`
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
  first, each mark's candidates top-down by z (`_candidatesUnder` `:402–446`, rebuilt whenever
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
`this._sceneClient` would read as one of those. Prose keeps "the scene". (Question Q1.)

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
  off,      // [dx, dy] the offset paint applies: residual(nat.below, D − depth(home)), plus the drag
            // delta while held; a NEW array on every change (the pack memo compares by identity)
  zKey,     // nat.z ?? nat.id, refreshed on the native's attr/rekey events (R25 H8: never piece.z)
  fam,      // nat.editId ?? nat.id, refreshed likewise
  held,     // in a drag's hold (§2.7)
  live,     // the stroke being drawn (the pack skips it; the SVG path draws it)
  seq,      // position within the source, for a total order
}
```

Nothing is copied from the native at derive time except what is refreshed by the native's own events:
z, the family key and the erase flag are the native's (`nat.z`, `nat.editId`, `nat.erase`), and the
erase data of §4 (`nat.targetOf`, `nat.handledBy`, a mark's `targets`) is read at pack time, never
stored on the item. For the pack and the tests the record exposes the field names a list item has
today (`type, id, z, editId, erase, res, clip, loops|polys|pts, lwFrame, color, opacity, covers,
fadeTag, origin, _ver, _outline`) through getters on the record, so `E._objs()` — which some 40 suites
read — keeps its shape; no field is written onto a piece or a native (today `listFor` writes `o.res`
onto natives, `KobinEngine.js:661`, which is what made the pack memo key box-without-res,
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
  TileStore's `_bakeSettled`, three rounds).
- **`changesSince(G0)`** returns the item deltas since G0 — `{added: Item[], removed: Item[],
  changed: Item[]}` with each changed item's previous box and offset — or `null` when the log no
  longer reaches G0 (a bounded ring, 4,096 deltas; a crossing or a reset truncates it). This is what
  lets A3's pack patch its family table instead of rebuilding it per list (appendix A: the rebuild is
  the 24–39 ms).

### 2.5 Dirtiness

**One mechanism: the changed native's drawn footprint, before and after, mapped into every frame that
has plates.** The footprint is the native's bbox grown by `lwFrame/2` (0 for a fill or a shape), in
its home's units, placed by its displacement table (`LevelMap.mapRectObj`, `LevelMap.js:997`) — what
`_drawnRectIn` computes today (`KobinEngine.js:956–977`), with the one difference that makes it sound:
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
packs at a later G). O(tracked keys) per commit — 100–300 today (96 MiB of 1 MiB plates plus the
in-flight set).

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
| the mark's registration (§4.2) | the unresolved rule masked the same ink |
| an erase step by the mark that was masking its target (`by`, §4.5) | the masked target renders as its pieces; only the dust boxes are dirtied |
| a graze, a refusal with no ink under the mark (`inkless`) | nothing under the mark changes |

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
`LevelMap`'s `*Obj` functions itself; after B-SCENE they call `placeNative`, which calls them. That is
the whole of the seam A1 needs (§7): B-MODEL changes what a native's placement is made of (a frame
shift composed on read, containers apart from coordinates), `placeNative` changes with it, and no
consumer changes again. A held item's `off` includes the drag delta; `placeNative` of a held native
does not (inputs never read a held native during its drag).

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
| `add`, `live: true` (`Document.add`, pen-down, `Document.js:579`) | an own item flagged `live` if homed in F (the pack skips it, as `packJob`'s `live` does) | none — the SVG live path draws it |
| `finalize` (`:597`) | the own item leaves `live`; tile deltas for its pieces elsewhere | footprint after |
| `add` (a new object, an undo's `insertAt` `:658`, a replay insert) | own item if homed in F; tile deltas; a rerouted item if its table has digits at D (§2.10) | footprint after, or none if `by` is a neutral erase step (§4.5) |
| `remove` (`removeById` `:638`) | every item of the id (`byId`) | footprint before (the removed object is frozen), or dust only if `by` is neutral |
| `remove` + `add` with `rehome` (`rehomeById` `:854`, `rehomeManyById` `:893`) | the own item leaves or joins F; tile deltas; its reroute group recomputed | footprint before (old home) ∪ after (new home); none for a settle's carry (`carry: true`, picture-preserving) |
| `change` with `oldBbox`/`oldLw` (`_afterEdit` `:1186`: a legacy geometry move, `setGeometryById`, `bakeShapeById`, `fillToShapeById`) | the own item's box recomputed (the pack memo refreshes on `_ver`); tile deltas (remove + add) | footprint with the old box ∪ the new |
| `change`, `offsetsOnly` (`setOffsetsById` `:775`) — **adds `oldBelow`** | `off` recomputed for the native's items; its reroute group recomputed; if the group's frame changed, its items leave and the new group's pieces join | footprint at the old table ∪ the new |
| `change`, `offsetsOnly`, `settle: true` (`_settleIfPending` `:383`, `unsettle` `:427`, `applySettle` `:445`) — **flag added** | `off` and the group recomputed (the picture does not move) | none |
| `change`, `attrOnly` (`setZById` `:757`, a replayed `attr`) | `zKey`/`fam` refreshed and the items re-sorted | footprint (paint order moved) — none for an `attr` that only sets erase fields (below) |
| **new** `rekey` with `ids` (`keysChanged(ids)`: `_resplitFamily` `erasePipeline.js:1042`, `_revertStep`/`_applyStep` `Document.js:1456`, `:1466`, replay `oplog.js:510`) | `fam` refreshed for the ids (a family split or joined) | footprint of the ids (a translucent family's alpha-once grouping changed; today a re-key emits nothing and no plate is invalidated) |
| **new** `handled` `{id, mark, inkless}` (a refusal or a graze, §4.2) | none (mask state) | box(target) ∩ box(mark) mapped, unless `inkless` or a graze |
| **new** `targets` `{mark}` (the mark's registration, §4.2) | none | none |
| `refile` (a frame re-addressed: `noteRefile` `:328`, a subtree drag step, its undo `:1366`) | if F is the frame or under it: full rebuild (§2.12); else the tiles TileStore dropped for the footprint are re-read at the next `sync`, and every rerouted group is recomputed (the lattice moved) | the frame's reach footprint at the old and the new address (`_cellFootIn`'s rule, `KobinEngine.js:751`); the plates of frames under the moved frame are **removed**, not staled (their frame id now means another place: the plate store's `dropFrames`) |
| `removeFrame`/`addFrame` (`removeFrameSubtree` `:939`, `detachFrame` `:496`, `insertFrameSubtree` `:960`) | own items rebuilt if F is the frame or under it; dropped tiles re-read; groups recomputed | the frame's reach footprint (`_frameListPlates`'s rule, `KobinEngine.js:765`); none when `by` is a neutral erase step (the frames pass, §4.2) |
| `mergeFrame`/`splitFrame` (`_mergeShadows` `:461`, `unmerge` `:543`) | own items for `ids` if F is the resident or the shadow; the merged frame's tiles were dropped (`TileStore.js:606`), re-read; if the camera followed the merge (`KobinEngine.js:152–156`), full rebuild | none for the natives; the vanished frame's plates removed |
| `reset` (`_replace` `:1508`: clear, load) | full rebuild; `changesSince` truncated | every plate removed (`dropAll(false)` today: another document) |
| frame GC (`collectFrames` → `TileStore.forgetFrame`, `frameGc.js:96–101`) — **not a document event today** | the Stage is told (`stage.forgetFrame(id)`): tracked cells of that frame untracked, its tiles' items gone | the plates of the frame removed (as today) |

The last three new event kinds are the only additions to `Document`'s vocabulary, and `oldBelow`/
`settle`/`carry` the only new fields; the Scenes index (`sceneClient.js:220–245`) must ignore the
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

For the camera's frame the Stage keeps, per native with a table, its placement at D: nothing (camera
above the home: its pieces are F's own tiles drawn with `off = residual`), or a group `(F0, rem)` from
`LevelMap.objShift` (`LevelMap.js:931`) — computed once per (home, table) as the candidate scan
already groups (`erasePipeline.js:432–440`) and as W10 asks for the crossing. It is **pushed**: an
event about the native (a table change, a re-home) recomputes its group and, if the group changed,
moves its items; a lattice change (`refile`, a merge, frame GC, a frame minted by a descent's merge,
`lm.addrEpoch` moving) recomputes every group once. `offRev`, `_offLog` and `offTouchedSince`
(`Document.js:254–256`, `:310–318`) exist because TileStore's memo is pulled; the Stage does not use
them. They stay for `listFor` (the SVG renderer and the fuzz) and go with it — or sooner, with A1's
"index of displaced objects" (PLAN §1.7), which should be the one implementation both the Stage and
any off-camera read call (§7).

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
a frame with no dirt and no camera movement costs one `sync` walk and nothing else.

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
- **Coverage.** Because the camera's read is budgeted (A3), the table may cover less than the window
  for a few frames. `stage.covers(frameId, rect)` says whether every tile under `rect` is in the table;
  the renderer dispatches a job only for a plate whose rectangle is covered, and composes a stand-in
  elsewhere. This replaces `_listWin`'s one-preview-plate margin (F119, `KobinEngine.js:1016–1021`) with
  a statement the renderer can check: "every plate job holds every item overlapping the plate" (the
  TEST-MAP's replacement for `raster.listCover.test.js`).
- **The window itself is the renderer's** (A3's pyramid decides which cells of which levels it will
  raster: the view, one ring, the coarser levels' cells). `stage.sync(frame, window)` is told it.

### 2.13 Off-camera tables

The crossing target's prefetch, a drag plane level coarser than the camera list's margin (F122), a
thumbnail (`snapshotView`) and — until A3 deletes it — a ladder rung need items for a frame or a
rectangle the camera table does not cover. `stage.snapshot(frameId, rect, budgetMs)` builds a
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
  by `PlateStore.beginJob`, `PlateStore.js:456–470`) goes.
- **Rule 1 — replace.** A result for key `k` at generation `g` replaces the stored plate iff there is
  none or `g > stored.G`. At equal G the pixels are equal (the pack and the core are deterministic), so
  the stored one stays. This is F106 with nothing added: a newer result that is itself already stale
  still replaces older stale pixels (today's `"newer"` branch, `PlateStore.js:411–422`).
- **Rule 2 — exact.** A stored plate `p` is exact iff `p.G >= stage.dirtySince(p.key)`. Otherwise it is
  a stand-in, and A3's compose treats it as one (PLAN §1.2's lookup order is A3's).
- The key is A3's: `(frame, set, level, i, j)`, `set` naming the view pyramid, the rest render, a drag
  plane layer, a snapshot. The Stage needs only an opaque string and the cell's box in its frame's
  units (grown by one device pixel of its level, as `rectOf`'s `EDGE_PAD_PX` does today,
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
| the pen-up's held live path (`_releaseHeldLive`, `RasterRenderer.js:809`) | — | — | a plate shows the stroke iff `plate.G >= Gs`, `Gs` the G of the stroke's `finalize` commit | replaces `_plateShows`'s ids per plate (`:854–857`, F123); PLAN §1.5 moves the hold itself into A3's `LiveStrokeLayer` |

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
  marks(): Iterable<Item>;                          // the pending marks' items in the table
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
| `targets` | the mark (an erase native) | the ids of the natives under it when its perimeter resolved; never changed after | registration (§4.2) |
| `targetOf` | any native | the marks whose `targets` named it or an object it was cut from | registration (adds the mark); inherited by every piece minted from it (§4.3) |
| `handledBy` | any native | the marks whose bake has dealt with it or with an object it was cut from | a refusal or a graze (adds the mark); a cut or a cede (its pieces inherit the source's set plus the cutting mark) |

A mark *M* is **pending** while it is an erase native in the document with a resolved perimeter or
still being resolved; it is **unresolved** from pen-up until its perimeter resolves (`targets`
undefined). The rule, in `src/engine/eraseRule.js`, one pure function used by the pack, the bake,
the barriers, the hit test and the Stage's neutral classification:

```js
/** Is native `o` under pending mark `M`'s mask (before any box test)? */
export function pendingUnder(o, M) {
    if (o.erase || !(zOf(o) < zOf(M))) return false;
    if (M.targets === undefined) return true;          // unresolved: everything below it, as drawn
    return has(o.targetOf, M.id) && !has(o.handledBy, M.id);
}
```

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

### 4.2 Registration: targets recorded when the mark resolves

**Where.** In `_stepShapeBakes` (`erasePipeline.js:274`) right after `bakeShapeById` for an erase
native, and in `_forceBake` (`:137`) — every path that resolves a mark's perimeter — the pipeline runs
`_registerMark(M)`, synchronously, in the same slice:

1. **The frames pass** (`_eraseFramesPass`, `:455–501`) moves here from the first `_nextEraseTarget`:
   frames the mark's ink covers whole, with `maxZUnder(F) < z(M)`, are set aside as one bake step
   (`removeFrameSubtree(F, { by: M.id })`), O(frames). Their natives are masked by the unresolved rule
   at that instant, and wholly inside the mark's full coverage, so the step changes no pixel (§4.5).
2. **The candidate scan** (`_candidatesUnder`'s body, `:402–446`, without the done set and without
   the `doc.rev` keying): every reachable frame's index over the mark's box, and every moved native
   mapped once per (home, table); kept if not an erase native, `z < z(M)` and `_eraseMayTouch`.
3. `M.targets = ids` (sorted), and for each target `o`: `o.targetOf = o.targetOf ∪ {M.id}`.
4. One `targets` event (§2.8) and a G bump; no dirt.

**Why at resolve and not at pen-up.** The scan needs the mark's box, and a pen-up is main-thread time
the user feels: the scan measured 20 ms (10.5k candidates) to 131 ms (45k natives, 20k moved) in node
(appendix A), 55–95 ms on the Magnum Opus in Chrome (REVIEW-2026-09-24 CAND-1 and F121 rows). The
first bake slice runs one macrotask after the pen-up (`_scheduleBake(0)`, `KobinEngine.js:1579`), the
same moment today's first `_candidatesUnder` runs, so registration adds no main-thread time — it
replaces the rebuilt scans (§4.13).

**The window between pen-up and resolve is exact.** Until registration the mark masks by the
unresolved rule (`z(o) < z(M)`), which at that moment is the same set of objects registration will
record, up to objects whose ink does not reach the eraser's box (the mask has no coverage over them
anyway). Nothing can be moved under the mark in that window: every gesture that moves ink first
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
`eraseDescent.js:290–296`), and `_applyDescent` mints `{...sp.obj, id}` (`erasePipeline.js:1126`). D4
(R25 §2) — the two cede bodies are one function copied — is worth closing in the same change: one
`cede(receiver, …)` with the Document and the virtual document as receivers.

### 4.4 The pack: mask bits from the rule, 16 slots, merged exactly

In `packJob` (`rasterPack.js:965–1016`) the mark block becomes:

- **Marks in the job**: the mark items whose boxes the strip's binner kept (today's `markOf`, keyed
  by family). A mark's mask box is the union of its items' boxes in the job (unchanged).
- **Bits**: item `d` gets mark `K`'s bit iff `pendingUnder(d.nat, K.nat)` and the boxes meet. No done
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
  pieces other marks have baked — which are exactly what Kobin's rule says must show (Q3).
- **Masks as bytes.** A mask plane is a `Float32Array(512 × 512)`, 1 MiB per slot per worker
  (`rasterCore.js:411`); sixteen are 16 MiB a worker, 64 MiB for four workers. Coverage stored as a
  `Uint8Array` (coverage × 255, rounded) is 256 KiB a slot, 4 MiB for sixteen; the quantisation is
  under half an alpha step, below the byte the plate stores. `resolveMask`, `keepAt` and
  `resolveFamily`'s mask reads (`rasterCore.js:259–273`, `:401–429`) change their arithmetic only.

### 4.5 What an erase change dirties

| change | pixels | dirt |
|---|---|---|
| registration | the same set is masked before and after (§4.2) | none |
| the frames pass (a covered frame set aside, `by: M`) | its natives were masked under full coverage | none |
| a cut or a descent applied by the bake or a barrier, `by: M`, target pending under M | the masked target renders as its pieces: coverage × (1 − mark) against the coverage of target − eraser; equal except where the target's own edge and the eraser's edge cross in one pixel. `raster.mask.test.js` K4 measured **0 differing bytes** between plates kept through such steps and a fresh raster of the result (fills and a ring) | the **dust boxes** only: components `dropDust` removed (`eraseJob.js:49–52`, `Document.js:1092`, `eraseDescent.js:117`, `:237`) can lie outside the eraser's box — a hairline narrower than a quarter pixel at the bake's zoom goes whole — so the job returns their boxes and the step's events carry them |
| a graze, or a refusal with `inkless` | no ink under the mark | none |
| a refusal over ink (`handled`) | the target's ink under the mark reappears | box(target) ∩ box(mark), every frame |
| the mark spent (removed) | the AA-level differences of the neutral steps are replaced by the exact raster | box(mark), every frame |
| an undo of the gesture (steps reverted, the mark removed) | the sources come back whole | ordinary footprints — or, as an optimisation, each reverted step's box(mark) ∩ box(source) ∪ its dust boxes (the step records the mark's box and frame) |

This is where today's "neutral" lives now: not a mode flag set around code (`_neutral`,
`erasePipeline.js:551`) and untagged by the engine when a step passes a target left whole
(`KobinEngine.js:204–215`), but a per-event classification the Stage makes from two facts — the
event says which mark's bake it is (`by`), and the rule says whether that mark was masking the target
at the previous G. It holds for a barrier's out-of-order cut exactly as for the tick's, because the
mark's z no longer steps (today's `_neutralUnder`, `:557`, had to ask).

If the row-3 property test (§6.4) finds shapes for which the masked target and its pieces differ by
more than the AA tolerance (translucent families through the union pass, arcs at a mark's edge,
cedes), the fallback is to dirty box(mark) ∩ box(target) per step (TEST-MAP's wording for
`raster.bake.test.js`'s replacement). It is correct and costs one small re-raster per step; on the
Magnum Opus's 98-step bake (84 of them refusals, F109) it is ~14 small rectangles instead of 0. The
switch is one line in the Stage's classifier (Q2).

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
  resolve perimeters (registering marks as they resolve, §4.2)
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
  it, and the eraser was projected through the old table), the mark is live, and the target is still
  pending under it. An invalid result is dropped and the pair re-dispatched (today's rule,
  `_onCutResult`, `erasePipeline.js:746–775`); a worker failure runs the job inline (today's).
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

**The pool** (PLAN §1.6). Two ways to get there:

| | one pool for plates and cuts now | N erase workers now, one pool with B-PYRAMID |
|---|---|---|
| threads on 8 cores | 4 raster, cuts share them (1 guaranteed) | 4 raster + up to 3 erase (`max(1, min(3, cores − 1 − rasterWorkers))`); 4 cores: 3 + 1, as today |
| priority | one ladder: rest > view > drag layers > cuts (≥ 1 worker) > prefetch > thumbnails | cuts compete with plates for cores; no ladder across the two |
| code | the raster client's queue learns a second job kind; one worker script bundling both (`erase-worker.js` 379 KB + `raster-worker.js` 45 KB today) | `eraseWorkerClient.js` becomes a small pool with `submit(kind, job, priority)`; the raster client untouched |
| coupling | B-ERASE waits on, or collides with, B-PYRAMID's scheduler (the same file, `rasterWorkerClient.js`, rewritten by A3) | independent; B-PYRAMID's unified pool later takes `submit(kind, job, priority)` as its cut interface |

Recommendation: **N erase workers in B-ERASE, behind the `submit` interface; the unified pool with
B-PYRAMID's scheduler**. It is the smaller step, it decouples the two builds that PLAN §2 lets run
concurrently, and the interface is the same either way (Q5).

### 4.8 One boolean per target under several marks — weighed, deferred

R25 §4.9: when a target is pending under several marks all above it, subtract their union once. The
saving is real in one scenario (ten quick dabs over a dense area: ten booleans of each object
underneath become one). The cost is structural: the one step belongs to several gestures. Undoing any
one of them must revert it (the target comes back pending under the others, which re-cut it); redoing
it finds the step's source gone and must leave it suspended while its mark cuts the new pieces
instead; the step graph (`Document._stepIndex`, `:1427`) maps a step to one op, the op log's bake
entry names one mark, and the reload rule for `_on` assumes one gesture per step. All of it is doable;
none of it is needed for correctness, and the parallel pool gives 3× where the joint cut gives its
saving only in the dabs case. **Defer**: measure the ten-dabs case with the pool first (Q4).

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
geometry array (the header's `g` span already points there) rather than as JSON (Q8).

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
    reads differently (Q9).
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

1. The barrier computes its pair set from the pending index, dispatches it at the head of the cut
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
What changes is that the tab stays responsive while it waits (Q6).

### 4.12 The pick follows the mask

`_hitTest` (`selection.js:992–1041`) walks the table top-down and skips pending marks. It should also
skip an item at a point inside a pending mark's coverage when the item is pending under that mark: a
press on the white region of a mark then picks what is visible there — an object dragged across it,
ink drawn after it — instead of the masked target whose selection would start a barrier and then a
re-hit (`select`'s loop, `:608–621`). The test is one `insideTester` per pending mark whose box holds
the point (the pick already builds one per object, `_shapeHit` `:957–975`). A press on the visible part
of a pending target still selects it, through its barrier (Q7).

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
| `_candidatesUnder`'s `doc.rev` keying, `_zScan`, `_ownChange` | `erasePipeline.js:402–446`, `:539–544` | one scan per mark at registration; the lineage index after |
| `_nextEraseTarget` | `erasePipeline.js:504–521` | `serialHead()` over the lineage index |
| `_cutInflight`, `_settleInflight`, the one-at-a-time queue | `erasePipeline.js:725–736`, `:746–795`, `:1083–1092`; `frameGc.js:79`; `sceneClient.js:397`; `report.js:342–349` | the pool's in-flight map and the reorder buffer; `frameGc` waits on a descent in flight only; the report reads the new state |
| the 200-round cap, the barrier's document diff | `erasePipeline.js:1266–1284` | rounds over pairs (§4.11) |
| `_flushErasesFor`'s in-order / out-of-order split | `erasePipeline.js:1206–1250` | gone: the mark does not step, every applied step is neutral |
| the mask slot cap of 8 | `rasterJob.js:45`, `rasterPack.js:974` | 16 exact slots, bytes, overflow merged (§4.4) |

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
| pen-up of M | M finalizes; unresolved: masks everything below it under its box; its footprint is dirtied | the live white path until the plates land, then T hidden under M's band (paper); Y unaffected |
| the first bake slice (a macrotask later) | M's perimeter resolves; registration: targets = {T}; Y is not under M | no change (the unresolved rule masked the same ink) |
| tap on Y | Y has no pending pair: no barrier, selected at once; the drag plane is aimed | Y's ants |
| drag Y across M | the plane's layers: BELOW (the rest, T still masked), SEL = Y packed with the marks — `pendingUnder(Y, M)` is false, no bit — OVER | **Y shows over M's region at every step**; T stays hidden; the bake goes on cutting T in a worker, neutral, invisible |
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

Press on T (pending under M) and drag.

| moment | what happens | screen |
|---|---|---|
| press | the hit test: T is visible where pressed (outside M's coverage) — §4.12 | nothing (nothing changes on the way down) |
| the press travels past `SELECT_DRAG_PX` | `select`: the pairs of T and its family are dispatched; the drag is parked | T does not move; after 150 ms the chip |
| the cuts land | T's pieces become the selection (all of them: the steps' own `removed → pieces`); `_settleSelectionErases`'s pairs among the members — none left — so the drag starts from the press point | the pieces jump to the finger and follow it; the ants on the pieces |
| released before the cuts landed | the move is applied whole, press → release, as one drag | the pieces land where the finger lifted |

### 5.6 Two marks over one object, the lower one cutting first (R25 §12.2)

M1 (older, lower z) and M2 (newer, higher z) both target T.

| moment | T's state | screen |
|---|---|---|
| both resolved | `targetOf = {M1, M2}`, `handledBy = {}` | T masked by both: hidden under E1 ∪ E2 |
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

