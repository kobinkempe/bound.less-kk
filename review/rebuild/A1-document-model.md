# A1 — The document model: the frame as a container, the lattice as an address (2026-09-26)

Analysis A1 of the renderer rebuild (PLAN.md §0 item 9, §1.7). Read-only: no file under `src/`,
`public/`, `docs/`, `tools/` or `DESIGN.md` was edited. Every `file:line` below was read in the tree
at commit ff0c6c7 (branch `claude/hopeful-dirac-iotb9n`). Measurements are node + jsdom on the repo's
own modules (the scripts are in §13); none is a browser measurement, and none used the Magnum Opus,
which is not in this container — where a Magnum Opus number appears, the document it comes from is
named.

---

## 0. Summary

**The framing holds, with two corrections.** A frame today is a coordinate system, a spatial bucket
and a container at once, and the engine re-buckets ink to keep the first two true. The corrections:

1. **The tile derivation needs invariant 2 only for STORED bits, and stored bits never move.** Tiles
   are unmoved space (`TileStore.js:186-198`); a moved object's picture is already found through an
   index of displaced objects (`_rerouteGroups`, `objShift`). The carries keep the *picture* within
   half a frame of the stored bits, and two kinds of reader depend on that: `LevelMap.objShift` at the
   home depth (`LevelMap.js:936`) and `offsets.residual` (`offsets.js:209-213`) drop a whole-frame
   carry — measured: 0.75 W comes back as −0.25 W with the frame unchanged (§13, E2) — and the
   enclosed-frame boxes (the lasso, the erase's frame pass, the selection box, the plate footprints)
   assume a picture near its cell. Both are local fixes, not a reason to rebuild the tile derivation.
2. **The re-bucketings are more than the three named.** Besides settle carries, whole-cell re-homes
   and cedes, the engine also merges a shadow into its cell's resident at the resident's first read
   (`Document.js:364, 461-484`), re-parents a moved frame's descendants under the neighbour cell by a
   digit carry and mints containers along their chains (`LevelMap.js:494-551`), translates a member's
   geometry by whole frames at the drop (`_normalizeHome`, `selection.js:862-868`), and revives a
   deleted frame when ink lands in its cell (`Document.js:533-538`). The selection chases all of them.

**The evidence is for the untangling.** Of the eleven move flags, nine trace to a conflict between the
three roles (F78, F93, F94, F100, F107, F108, F110, F116, F126); F65 and F91 are unrelated (§3). A
census of one 40-step drag of a 25-frame subtree: 183–290 frames minted during the drag, 0–16 of 24
descendants re-parented away from the dragged frame, and — with the prior move tables real drawings
carry — 443–1,511 natives carried by read-time settles (§1.4).

**Recommended: option (c), in four steps (confidence 0.75 for C1–C2, 0.65 for C3, 0.55 for C4).**

- **C1 — A frame's shift is placement, composed on read.** It is never pushed into its natives: no
  settle, no carry, no read that mutates. One accessor composes (frame shift ⊕ table); the reroute and
  the two readers above honour the home-depth carry. Measured picture-neutral: 716 of 720 placements
  bit-identical to today's settled ones, the other 4 one ulp apart at the parent view (§13, E3).
- **C2 — Membership changes only at the end of a user action.** No document writes during a drag
  (PLAN §1.4); at the drop a per-object member is re-homed once, a subtree once; `_normalizeHome` goes;
  the selection is repaired from the op's own record, never from events.
- **C3 — A frame keeps its identity.** A frame that lands on an occupied cell stays a co-resident for
  good (no merges); lookups and cell readers see co-residents; a deleted frame leaves the lattice
  instead of lingering as a revivable cell.
- **C4 — A cede's kids live in private frames of their object.** The city's frames never hold the
  backdrop's patches, so the lasso takes them whole again (F108's 17,007-id torn walk).

It deletes the settle and merge machinery, `_followCarries`/`_flushCarried`/`_keepingSelection`, the
F107 revival sets, `_bakeSettled`, the F116 and F126 special cases, and (with C4) the torn walk for new
families. It adds one composition accessor, co-resident lookups, a `private` frame flag and a
version-3 gate. It keeps the lattice's coordinates exactly as they are — frames stay lattice cells,
and a frame's shift never enters a frame-to-frame map — so the renderer's crossing arithmetic (A3) is
untouched. The orchestrator's option (b) — tables that hold whole cells so nothing is ever
re-homed — is rejected for per-object moves, for three reasons given in §4.3: it needs
negative-depth table entries that the deployed build refuses or silently drops, it makes every
enclosed-frame test consult far-moved natives, and it pushes the reroute's tile reads further from the
view (F83's cost).

---

## 1. What a frame is today, and the inventory

### 1.1 The three roles

| role | what it guarantees | who needs it |
|---|---|---|
| **coordinate system** (exactness) | a native's numbers are in its frame's units, small (`LevelMap.js:32-36`); every hop between frames is exact (`frameLattice.js:30-38`, `LevelMap.js:755-760`) | storage, the tile chain, the erase, the camera |
| **spatial bucket** (finding ink) | invariant 2: a native's stored bits lie within its cell ± REACH (`frameLattice.js:49`, DESIGN §1) — the ring of 8 is complete (bible §10.5), a subtree is pruned by its cell ± REACH | tiles, the lasso's prune, the erase's frame pass, plate footprints |
| **container** (grouping) | a frame and its subtree are one unit of selection, move, delete, erase-whole, save and GC | selection, the O(1) subtree move, delete, `bakeFrames`, the store, frame GC |

Stored bits satisfy invariant 2 by construction: a stroke is born in the camera's cell
(`KobinEngine.js:1381, 1423`), an over-wide one is promoted (D9, `erasePipeline.js:236-260`), a cut
piece is a subset of its source, a cede kid is one square of its parent's picture. A move never
touches stored bits (F55, `offsets.js:5-21`). So the only thing the carries protect is the distance
between a *picture* and its stored bits.

### 1.2 Where membership is decided or changed by position

"Role" says which of the three roles the site serves; "when" says whether a user action, a read or an
engine task runs it.

| # | site | what it does | role | when | fate under (c) |
|---|---|---|---|---|---|
| 1 | `KobinEngine.js:1381, 1423` | a stroke is added to `cam.frame`, the cell the view centre is in | exactness; container ("drawn into") | user | kept |
| 2 | `erasePipeline._promoteOversize` `:236-260` | an over-wide native re-homed to the parent at pen-up, geometry ÷ R | bucket (D9) | user's end | kept (Kobin's D9) |
| 3 | `Document.at` → `_settleIfPending` `Document.js:361-369, 383-409` | a frame's pending shift added to every native's k=0 entry at the first read; one leaving ±W/2 re-homed next door (`:400-404`) | bucket | **any read**: tile bakes (`TileStore.js:347, 434, 493`), `ownContent` (`:295`), the saver (`useKobinEngine.js:348`), idle fits (`KobinEngine.js:1298`), and every mutation path (`Document.js:581, 641, 660, 857-858, 898-899`) | **deleted (C1)** |
| 4 | `Document.unsettle` `:427-443`, `applySettle` `:445-454` | the inverse (a carried native comes home by id), the replayed form | bucket | undo, drag, replay | deleted; `applySettle` kept for old logs |
| 5 | `selection._dragSelection` `:668-716` → `_displaceMember` `:821-838` → `Document.rehomeManyById` `:893-932` | every pointer event: a member's whole cells become an address change, the rest a table (`setOffsetsById` `:775-784`) | bucket (table < W/2) | **every pointer event** | once, at the drop (C2) |
| 5b | `KobinEngine._endMove` `:873-882`, `_dropHold` `:884-892`, `_releaseMove` `:894-910` | the drop's one exit: its render settles the moved frames (row 3), `_reselect` takes the carries and the frames the drag moved out (`:880`), `collectFrames` runs (`:881`); `_releaseMove` stales plates over every member's footprint and each moved frame's cell ± REACH (`_framesFootIn` `:794-807`) | bucket (the settle), container (the reselect) | user's end | the render no longer settles (C1); the repair from the op (C2) |
| 6 | `_normalizeHome` / `_homeShift` `selection.js:840-868`, called at the drop `KobinEngine.js:1517-1526` | a member whose stored box centre is outside its cell re-homed **and translated by whole frames** (`moveById`) — the one move path that rewrites coordinates | neither (stored bits are within REACH anyway) | user's end | **deleted (C2)** |
| 7 | `Document._undoMove` `:1225-1233`; replay `applyMoves` `oplog.js:432-454` | re-home to an op's `from`/`to` | recorded | undo, redo, replay | kept |
| 8 | `LevelMap.subtreeStart` `:463-476`, `moveSubtreeTargets` `:494-551`, `readdressMany` `:559-576`, `_take` `:347-366`; `selection._dragFramesStart` `:735-749`, `_dragFrames` `:758-787` | per event: every frame within three levels of the camera re-addressed from its start chain; a descendant whose own digit carries lands under the root's lattice **neighbour**; a missing step of a chain is minted (`:530, :540`); a collision makes a shadow; a cell a moved frame vacated mints a twin `#n` when next visited (`_childId` `:174-185`) | coordinates (a frame's address is where its content is) | **every pointer event** | once, at the drop (C2); re-parenting kept, repaired from the op |
| 9 | `Document.setFrameShift` `:411-416`, `noteFrameOwner` `:418-421`, `noteRefile` `:328` | the shift and the op that owns a later settle | bucket bookkeeping | drag | shift kept as placement; owner deleted |
| 10 | `Document._mergeShadows` `:461-484` + `LevelMap.adoptShadow` `:372-404`, at the resident's first `at()` (`Document.js:364`) unless `holdMerges` (`:267`) | a shadow's natives appended to the resident's list, its kids re-parented, the shadow deleted | bucket (one frame a cell for lookups) | **a read** | **deleted (C3)** |
| 11 | `unmerge` `:543-562`, `unadoptShadow` `LevelMap.js:406-443`, `mergeReplay`/`unmergeReplay` `Document.js:540-541` | the inverses and the replay | bucket | undo, replay | kept for old logs only |
| 12 | `LevelMap.ensureId` `:604-632`, `merge` `:583-596`, `_loadFrames` `:1126-1152`, `files._mintNamedFrames` `files.js:31` | a frame a native's key names is re-minted, as a shadow when its cell is taken (F67, F99) | repair | load, worker merge | kept |
| 13 | `erasePipeline._bakeOne` `:689-699` → `_bakeRehome` `:1061-1093` → `eraseDescent.descentJob` `:150-284` (kid frame `Fn = lm.neighbour(F, i, j)` `:224-227`, which mints; `minted` `:281-283`) → `cedeVirtual` `:110-137` → `_applyDescent` `:1102-1143` (`lm.merge` `:1116`); `Document.cedeTileById` `:1064-1129` | the remnants stay in the target's frame; each kid is stored in the frame the target's **picture** occupies one crossing down, along the mark's chain | exactness (a hole is sub-ulp in the parent's units, `erasePipeline.js:1049-1060`) — which makes one logical object span several frames | engine (a bake) | kids in private frames (C4) |
| 14 | `Document.eraseReplaceById` `:997-1041` | pieces stay in the source's frame, with its table | exactness | engine | kept |
| 15 | `erasePipeline._eraseFramesPass` `:455-500` | a frame whose cell ± REACH lies inside the mark's ink goes as containers (`removeFrameSubtree`) | container, judged by the bucket rule | engine | kept; box shifted (C1) |
| 16 | `Document.removeFrameSubtree` `:939-954`, `detachFrame` `:496-527`, `insertFrameSubtree` `:960-990`, `_reuseDetached` `:533-538`, `getById` `:606-610` (F107) | a deleted frame's lists set aside while its **cell stays live**; the first placement there flags the old natives `_gone` and revives the frame | container vs coordinates | user + any later placement | the subtree leaves the lattice (C3) |
| 17 | `frameGc.collectFrames` `frameGc.js:75-112` (candidates `:42-49`, `lm.minted` `:31`), `LevelMap.forget` `:192-207`, `Document.forgetFrame` `:1261-1274`, `_forgetIfEmpty` `:353-359` | a frame with no natives, kids or shadows forgotten at a gesture's end | container (Kobin: "a frame holds something") | user's end | kept; promotes a co-resident (C3) |
| 18 | `Camera._maybeShift` `Camera.js:82-100` (`neighbour`, mints), `_crossUp` `:133-165` (`ensureChild`, mints) | the camera's frame is the cell the view centre is in | coordinates (P4) | camera | kept; the camera stays in a resident (C3) |
| 19 | `LevelMap.objShift` `:931-948` (`neighbour` `:944`, `frameAtChain` `:946`) | a moved picture's source frame F0, minted if never visited | bucket (the reroute) | **a read** (F111) | kept; a peeking form is a later option |

### 1.3 Where ink is found by invariant 2 (and by the displaced index)

Every row serves the bucket role (finding ink) except two: `_isSelected`/`_underFrames` (grouping) and
save and load (grouping and exactness: the frame is the unit of storage and the units of its numbers).

| site | how it finds ink | what it relies on |
|---|---|---|
| `Document`'s `LevelIndex` `:67-154` (one a frame: `queryRect` `:1195-1201`, `frameExtent` `:1207-1219`, `maxZUnder` `:750-756`) | a uniform grid over each frame's stored boxes; `ext`, `maxSize` and `maxZ` only grow, so they bound what the frame holds | stored bits, in the frame's own units — the frame as a bucket |
| `TileStore._bakeUp` `:333-364` | the parent's natives, all of them (`doc.at(parentId)` `:347`, culled by `classifyUp`), plus the ring (`:348`) | invariant 2 on stored bits |
| `_ringNatives` `:431-451` | `peekRing` — the 8 cells around the parent (`:433`) — each asked through its index (`:441`) | invariant 2 makes the ring complete (bible §10.5) |
| `_upPiecesOver` `:369-411` | one parent square per object | the seam pad (48) > half a cell (16) |
| `_bakeDown` `:473-507`, `_downSources` `:515-536` | the frame tree from F then outward, a subtree pruned by its cell ± REACH (`:519`); a frame skipped whole by its index extent (`:485`) | invariant 2 on a whole subtree |
| `_addObject` `:678-701`, `_upVia` `:706-716`, `_ringCopy` `:718-725` | the same rules, patched in place | as above |
| `_onFrameEvent` `:600-629` | tiles dropped over the moved frame's cell ± REACH (`:608`), old and new | invariant 2 |
| `_reroute` `:199-219`, `_rerouteGroups` `:231-276` | **the displaced index**: every native with a table, grouped by (F0, rem) at F; own natives skipped (`:241`); views above the home skipped (`:242`); memo on `offRev` and the lattice (`:234-237`), patched from `offTouchedSince` (`:253-267`) | `objShift` |
| `LevelMap.objShift` `:931-948`, `offsets.residual` `:209-213`, `KobinEngine.listFor` res `:659-664` | the picture's source frame and remainder | **below[0] within ±W/2** — the carry at the home depth is dropped (§13, E2) |
| `selection._lassoFind` `:342-422` | the lattice walk from the camera outward (`_lassoWalk` `:424-434`), OUT / ENCLOSED / STRADDLING by the cell ± REACH (`:365-369`), inkless frames skipped (`_inkedFrames` `:185-192`) | invariant 2; a pending shift ignored (H6: pictures off by up to half a frame) |
| `_lassoMoved` `:480-496` | every tabled native judged where drawn, except those under an enclosed frame (`:488`) | the displaced index |
| `_isSelected` `:148-157`, `_underFrames` `:165-179` | a native is selected when its home is under a selected frame (with shadows, `LevelMap.isUnder` `:782-789`) | container = storage |
| `erasePipeline._candidatesUnder` `:402-444` | **every** frame's index with the mark's box mapped in (`:421-425`) — not the reach rule — plus every tabled native, the mark's box mapped once per (home, table) (`:429-438`) | the displaced index |
| `_eraseFramesPass` `:455-500` | covered = the cell ± REACH inside the ink (`:471-473`) | invariant 2 |
| `overlays._selTable` `:583-631` | a selected frame is one box, its own cell (`:626`) — "the frame's box bounds them all, by invariant 2" (DESIGN §10) | invariant 2 |
| `_selFrameRect` `:637-646`, `_selFrameContent` `:652-663` | members' boxes through their tables; a frame's index extents through its pending shift | the shift composed here already |
| `KobinEngine._framesFootIn` `:794-807`, `_cellFootIn` `:751-759`, `_refilePlates` `:744-749`, `_frameListPlates` `:765-772` | plate drops over a moved or removed frame's cell ± REACH | invariant 2 |
| `sceneClient` `:514-518`, `_frameRec` `:550-553`; `sceneIndex` `:467, 478, 1350` | an item is its home and `residual(o.below, 0)`; frames are sent with their shift and the index adds it (`+ f.sx`) | **already composes the frame shift on read**; `residual` drops the carry |
| save and load | natives are listed per frame (`Document.serializeNatives` `:1537-1554`; `persist.decodeNatives` `:296-379`, `FRAME_ID` `:210`); a header has no frame field (`format2.objectHeader` `:55-71`); rows are keyed `[canvasId, frameId]` (`storage/db.js:63-64`) and a row whose frame left `frameIds` is deleted (`:249-257`); entries name frames (`level`, `touches`) and replay places by them (`oplog.js:466, 445`), with `snapshotRule` per frame (`:45-49`) | container + exactness (the frame is the unit of storage and the units of its numbers) — not the reach rule |

### 1.4 What one drag re-buckets, counted

Synthetic fixture shaped like `move.subtree.test.js` (camera at depth 1; a root R one level under it,
6 kids two levels under, 18 grandkids three under; 50 natives a frame, 1,250 in all); the drag through
the pointer, a render per step (§13, E1). "Prior tables" gives every native a k=0 entry uniform in
±W/2, as real drawings carry (the Earth's deep natives had `[-49152, -49152]`,
EARTH-MOVE-ANALYSIS §6).

| path, drag | settles | natives carried | frames minted during / left after GC | R's descendants re-parented away | selection at the drop |
|---|---|---|---|---|---|
| subtree, 40 × 7 px | 71 | 0 | 249 / 13 | 16 of 24 | 10 frames |
| subtree, 40 × 30 px | 79 | 0 | 246 / 10 | 12 | 9 frames |
| subtree, 10 × 120 px | 19 | 0 | 72 / 13 | 12 | 12 frames |
| subtree, 40 × 7 px, prior tables | 57 | **1,264** | 183 / 8 | 8 | 5 frames + 20 ids |
| subtree, 40 × 30 px, prior tables | 79 | **1,511** | 290 / 12 | 4 | 4 frames + 13 ids |
| subtree, 10 × 120 px, prior tables | 19 | **443** | 88 / 13 | 0 | 1 frame + 23 ids |
| per-object, 40 × 7 px | — | — | 1,333 / 37 | — | ~1,209 re-homes **per event** |
| per-object, 40 × 30 px, prior tables | — | — | 1,573 / 45 | — | ~1,221 re-homes per event; homes 25 → 45 |

Every carried native became an id in the selection through `_followCarries` (19–77 calls), and every
re-parented descendant a frame entry through `_outsideSelection`. The selection "stands for the same
ink" only because of that machinery.

---

## 2. The chasing machinery, and what each piece compensates for

| piece | compensates for |
|---|---|
| `selection._reselect` `:257-273` | ink that crossed a selected frame's boundary by any of §1.2 rows 3, 8, 10: re-derives ids and frames from what moved, drops inkless frames |
| `_followCarries` `:200-215` (subscribed at `KobinEngine.js:289`) | a read-time settle carrying natives out of a selected frame (row 3) |
| `_flushCarried` `:217-228` (`KobinEngine.js:1001`) | carries that happen inside a list build, outside any gesture, so the selection cannot change mid-render |
| `_keepingSelection` `:242-250` + the `_moving` capture `KobinEngine.js:311-315` | an undo's `unsettle` and re-address moving ink out without a notice |
| `_outsideSelection` `:230-240` | descendants re-parented by a digit carry (row 8) |
| the merge handler `KobinEngine.js:302-309` | a selected frame merged into its resident at a read (row 10): its natives become ids |
| the camera's merge follow `KobinEngine.js:152-156` (F126) | a merge deleting the camera's own frame |
| `_familyBounded` `:439-442` (F100) | a cede spreading one object over several frames (row 13): a piece under an enclosed frame must count as found |
| `_tornUnder` `:449-473` + `Document.keyedIn`, `_keyIn`/`_keyOut` `:564-574` and their seventeen maintenance lines in twelve `Document` methods (F108) | the same, the other way: an enclosed frame holding a piece of an object the loop does not bound |
| `_reuseDetached`, `detachFrame(rec)`, `insertFrameSubtree`'s `kept`, `_detached`/`_detachedLists`/`_reused`/`_detachedKeyed`, `_gone` (F107, `Document.js:270-274, 496-538, 960-990`) | a deleted frame being also a live cell that new ink lands in |
| `holdMerges` (`Document.js:267`, `selection.js:737`, `KobinEngine.js:889`) | a merge happening at a read in the middle of a drag |
| `TileStore._bakeSettled` `:323-332` (F78) | a settle inside a bake moving ink the bake had already passed |
| `unsettle` in `_dragFrames` `:765` and `_restoreFrames` `:790` | a render settling a dragged frame mid-drag |
| `_invert`'s foreign-shift settle `Document.js:1349-1350` (F116) | a pending shift that is not the op's own when the op inverts |
| `oplog._onSettle` coalescing `:107-115` and `_ownerSeq` `:94-101` (F110) | settles logged at reads under no op, owned by whichever op placed the frame |
| `_dragFramesStart`'s empty-leaf skip `selection.js:742` | containers minted along chains accreting into the next drag |

Every row is a consequence of §1.2 rows 3, 8, 10, 13 and 16. None is needed once those stop moving
ink between user actions.

---

## 3. The move bugs Kobin saw, traced

Entries read in `docs/OPEN-FLAGS.md` and `review/REVIEW-2026-09-24.md`.

| flag | what happened | what it stems from | verdict |
|---|---|---|---|
| **F65** | an object dragged out from under an eraser mark that never baked into it | the barrier gates by result: z, the box prefilter, a bake that returns without a cut, cost (OPEN-FLAGS F65's four ways) | **unrelated** — the erase rule; PLAN §1.3 (targets at pen-up, `handledBy`) is its fix. No re-bucketing is among the four ways. |
| **F78** | the Earth's houses vanished after a lasso drag | a read-time settle (row 3) carried natives into a frame the bake had already skipped, mid-bake, and the empty tile was cached | **bucket role** (normalising the shift into natives at a read). Impossible under C1: reads never mutate. |
| **F91** | a phone drag was jumpy | the drag plane's 12-plate cap on the phone | **unrelated** (renderer budget). |
| **F93** | a zoomed-out lasso selected 50 empty frames; a drag left its ink unselected | three things: F94's minted containers taken as frames; settles carrying natives out of the selected frames; a kid re-parented under the neighbour container by a digit carry | **all three role conflicts**: containers minted for coordinates (row 8), the bucket's carries (row 3), a lattice cell forced to an integer address (row 8). C1 removes the carries, C2 the per-event mints; the re-parenting stays a lattice fact, repaired from the op. |
| **F94** | 80–103 empty frames minted per 40-step drag | `moveSubtreeTargets` mints the missing steps of every descendant's target chain, per event (row 8) | **coordinates vs container**: a frame must have a lattice parent at every level. C2 (one re-address at the drop) leaves only the final scaffolding (8–13 in §1.4). |
| **F100** | a phone lasso missed objects | a ceded family's pieces under an enclosed frame were taken as a frame while the family test counted ids (row 13) | **storage vs logical object**. C4 keeps a family's kids in its own private frames. |
| **F107** | ink drawn where a lassoed frame had been deleted could not be selected | the deleted frame stayed a live cell; `getById` refused everything homed there (row 16) | **container vs coordinates**. C3: the deleted subtree leaves the lattice. |
| **F108** | a lasso took a ceded kid whose stroke ran outside; a drag tore it out | an enclosed frame taken whole held a piece of an outside family (row 13) | **storage vs logical object**; its fix costs 17,007 ids on the Earth (REVIEW-2026-09-24, F108-COST). C4 removes both. |
| **F110** | after a reload, an undo of a subtree move put natives at the wrong table | settle entries (logged at reads) coalesced across ops | **the settle mechanism**. No settle entries under C1. |
| **F116** | two subtree moves undone and redone landed half a cell off | a pending shift from an earlier redo overwritten by the next op's shift | **the settle mechanism** (pending vs settled). Under C1 the shift is placement data an op restores exactly. |
| **F126** | an undo made the canvas blank | a merge (row 10) deleted the camera's frame (the vacated cell's twin) | **one frame a cell**. C3: no merges. |

**Nine of eleven stem from a role conflict; two are unrelated.** The same shape runs through flags
outside the list: F98 (members walked through containers the next drop emptied — per-event re-homes),
F80 and F99 (twins: a vacated cell mints a twin because an id is its birth cell), F111 (a read minting
a frame a GC had forgotten), F104 and F124 (families across cells). Honest limits: F100 and F108 are
not about carries at all, only C4 addresses them; F94's scaffolding is reduced, not abolished, because
a re-parented kid still needs a lattice parent.

---

## 4. The design

### 4.1 What must hold

- **M1** A selected frame stands for the same ink through everything the engine does between user
  actions, with no event chasing (Kobin, decision 9: selection stays frame-based, never by ids).
- **M2** No read changes the document.
- **M3** Exactness: no move rewrites a stored number; every hop exact; small numbers stay small.
- **M4** The O(1) subtree move survives: work per gesture proportional to frames, never objects.
- **M5** A tile never misses ink; no reroute cost blow-up (F83: 754 ms of a crossing in `_reroute`).
- **M6** A frame holds something (F94), and frame GC stays store-safe (F98).
- **M7** Undo and redo byte-exact; the op log records results; replay idempotent.
- **M8** Files from the deployed build and Kobin's phone open unchanged; an older build refuses what it
  cannot keep rather than dropping it.
- **M9** The model can change later without touching the renderer (the §6 contract).

### 4.2 Option (a) — an explicit container field per native

Each native carries `container` (a frame id) beside its storage frame; storage keeps today's rules
(settles, carries, re-homes, merges, cedes). Selection asks "is `o.container` under a selected frame".

- **Exactness**: unchanged (storage keeps the numbers small the way it does today).
- **Finding ink**: unchanged — storage still keeps invariant 2 for pictures by carrying.
- **Every frame-level operation reconciles two sets**: natives *stored* in the moved or deleted
  subtree that belong elsewhere ("foreigners": a carried neighbour, an outside family's kid) must be
  held back — re-homed out or counter-moved — and natives *belonging* to it but stored elsewhere
  ("emigrants") moved or deleted per object. Two per-frame indexes, maintained on every add, remove,
  re-home, settle, merge and cede.
- **Keeps** read-time settles and merges, so F78, F110, F116 and F126 stay in their current,
  patched form. **Removes** only the selection's chasing.
- **Save**: a new native header field `c`; an older build keeps it through `_extra`
  (`format2.js:69, 73-77`) but does not maintain it, so it goes stale under an older build's edits —
  needs the version gate anyway.
- **Verdict**: rejected. It fixes the selection by adding a second relation to keep consistent, and
  leaves the mechanisms Kobin wants gone.

### 4.3 Option (b) — storage = container; tables hold whole cells; never re-homed, never carried

Nothing moves between frames except by a cede or a promotion. A per-object drag writes only a table;
the frame shift is composed on read; the displaced index is the only way to find a moved picture.

- **Exactness**: holds for a member homed at or above the camera — its home-level entry is an
  integer multiple of 2⁻¹⁰ and stays exact to about 2⁴³ units, 6.7e7 frames. **But** a member homed
  deeper than the camera cannot take the move at its home level: five levels down, a 2,000-unit move
  is 2,000·R⁵ ≈ 2⁷¹ home units, whose ulp is 2¹⁸ units — two frames — so any later move made at the
  home level rounds away, which is F41's jump again. A move must stay in the units of the level it was
  made at (`offsets.js:5-12`), and a move made above the home needs an entry *above* the home — a
  negative depth. `offsets.decodeBelow` refuses those (`offsets.js:275-276`), so the deployed build
  either refuses the whole file (`persist.js:320-325`) or, through the kobin-2 path, silently drops
  the table (`Document.js:175`) and writes the object back unmoved.
- **Finding ink**: invariant 2 still holds for stored bits, so tiles still bake by the reach rule;
  every moved picture is found through the displaced index, generalised to whole frames at the home
  depth and to views above the home (`TileStore.js:242` skips those today). Index: every native with a
  non-zero composed table, grouped by (home, table) — on the Magnum Opus 16,889 to 19,666 natives
  carried a table at different dates, and 19,547 of them fell into **61 groups** (REVIEW-2026-09-24
  CAND-1). Cost per move: O(members) regrouping at the drop; per add
  and remove: O(1); per tile bake: 0 (tiles are unmoved space); per camera frame: O(groups) `objShift`
  calls plus the F0 tiles they name. Memory: one set membership per moved native (~0.8 MB for 19.7k at
  the 39 bytes an entry measured in §13 E4) plus the groups.
- **The cost that decides against it**: a picture can be anywhere, so (1) every enclosed-frame
  judgment (the lasso, the erase's frame pass, the selection indicator, the plate footprints) must
  consult a per-frame set of far-moved natives, and a frame whose members were dragged away stops
  being taken whole — the O(1) lasso degrades with every per-object move; (2) the reroute reads the
  tiles of the frame the unmoved picture is in, and the further pictures move from their homes the
  more of those tiles are cold at a crossing — F83 measured 106 cold tiles and 754 ms of `_reroute`
  at one crossing with today's tables, each within half a frame at its level. Today a per-object
  member is re-homed near its picture, so its F0 is near the view; under (b) its F0 stays where it
  was drawn.
- **Verdict**: adopted for reads (C1: nothing is carried, the shift composes), rejected for
  per-object moves (C2 re-homes once at the drop instead).

A full per-level index of every native by the cells it overlaps was considered for (b) and is not
needed: at the home level it is the frame lists themselves, and coarser levels are the tree. Its size,
for scale: 44,128 home-level entries (1.6 MB) or 308,537 with every coarser level (9.1 MB) on 42,857
synthetic natives (§13, E4); the scene index's real grid, the same idea, is 318,431 entries on the
Magnum Opus (SCENES-PLAN §7.8: 36.7 MB before packing).

### 4.4 Option (c) — recommended: placement is data, membership changes only at a user action's end

Frames stay lattice cells: a frame's address is where its content is, up to the frame's own shift, and
every hop between frames stays the centre arithmetic it is today. What changes is that nothing moves
ink between frames except a user action, at its end, recorded in its op.

#### C1 — A frame's shift is placement, composed on read

The shift a subtree move leaves on a frame (the k = 0 entry every native of the frame owes, DESIGN §8)
stays on the frame for good. It was settled into the natives because `below` was read at eleven
sites then (SUBTREE-O1-PLAN §2.2: "a single settle point keeps 'the table on the object is the
truth'"; twenty-two picture-side reads now, §13); the scene's `placed()` (PLAN §1.1) and one model
accessor make them one, and the scene index already composes the shift (`sceneIndex.js:467, 478,
1350`).

- **One composition**: the picture's table = the native's own table with the home frame's shift added
  at k = 0, *without* a carry. It may reach one frame (two terms, each within ±W/2).
- **Two readers honour the home-depth carry**: `objShift` at k0 = 0 names `F0 = neighbour(F, −carry)`
  and, when F0 is the native's own home, the native itself; `residual` returns the carry in whole
  frames beside the remainder. Pieces of F0 are taken with their numbers as they are (the reroute's
  rule, `TileStore.js:186-198`), never mapped by W — which is why the result is bit-identical (§13 E3).
- **The reroute covers every displaced picture**: natives of a shifted frame form one group per frame
  (membership by home, not an id set); natives with their own tables group by (home, composed table)
  as now; views above the home are rerouted too (drop `TileStore.js:242`'s skip, which was sound only
  while the residual there was sub-cell).
- **Newcomers cancel the shift**: a stroke drawn in a shifted frame, or a cede kid homed in one, takes
  −shift in its own k = 0 entry, so it is drawn where it was put (today `add` settles first,
  `Document.js:581`). A cut piece keeps its source's table (`eraseReplaceById` `:1019`), a promoted
  native composes its old frame's shift one level down.
- **Boxes follow the shift**: a frame's own natives lie within its cell ± REACH translated by its
  shift (its kids are not shifted), so the lasso's enclosure (`selection.js:365`), the erase's frame
  pass (`erasePipeline.js:471`), `_selTable`'s frame box (`overlays.js:626`) and the plate footprints
  (`KobinEngine.js:797, 752`) use the union of the two boxes. This also closes H6 (DESIGN-REVIEW
  §11.10): natives with their own tables under an enclosed frame are judged where drawn.
- **Deleted**: `_settleIfPending` and its seven call sites; `unsettle` (kept only as a legacy inverse,
  §5); `_frameOwner`, `noteFrameOwner`; `settled` on `moveFrames` entries; `oplog._onSettle`,
  `_ownerSeq`, the settle drain (decode kept for replay); `TileStore._bakeSettled`, `_rebakes`;
  `_followCarries`, `_flushCarried`, `_carried`, `_carriedLater`, `_dropping`; the unsettles in
  `_dragFrames` (`:765`) and `_restoreFrames` (`:790`); F116's foreign-shift settle
  (`Document.js:1349-1350`); the settle subscription (`KobinEngine.js:289`).
- **Measured**: the composition places every native where today's settle-and-carry does: 720 of 720
  bit-identical with integer coordinates; with full-mantissa coordinates 716 of 720, the 4 all at the
  parent view (k0 = −1) for natives today's settle would have carried, worst 5.7e-14 units — one ulp —
  and 480 of 480 at and below the home level, where the tile chain and the erase work (§13 E3).

#### C2 — Membership changes only at the end of a user action

- **No writes during a drag** (PLAN §1.4, B-DRAG). At the drop, a per-object member is re-homed once:
  `_displaceMember`'s arithmetic on the composed table, its whole cells into the address, its rest
  into its own table less the target frame's shift. The member's table stays within ±W/2 at its home,
  as today, so containers stay compact and the reach rule stays sound for pictures up to a shift.
  "An object belongs to the frame it was drawn or moved into" (PLAN §1.7), literally.
- **A subtree is re-addressed once, at the drop.** The census's 183–290 frames minted per drag become
  the final scaffolding only (8–13, §1.4).
- **`_normalizeHome` and `_homeShift` go.** Stored bits are within REACH without them; they were the
  one move path that rewrote coordinates (`KobinEngine.js:1519-1520`), and `move` ops lose their
  `base`/`after` snapshots (decode kept).
- **The selection is repaired from the op, never from events.** After a drop, an undo or a redo of a
  `moveFrames` op, the selection's frames are its roots plus the op's frames no longer under a selected
  frame (`_outsideSelection` on the op's frame ids). Per-object members are ids and need nothing.
  `_keepingSelection`'s event capture goes.
- **What stays a lattice fact**: a moved frame's descendant whose own digit carries is re-parented
  under the root's lattice neighbour — its content really is in that cell, and a lattice cell cannot
  sit at a fractional address. The alternative is a second parent pointer (§4.6).

#### C3 — A frame keeps its identity

- **No merges.** A frame that lands on an occupied cell (`_take`, `LevelMap.js:347-366`) stays a
  co-resident permanently; its natives never move into the resident's list. When it lands, its kids at
  cells the resident also has are linked as co-residents of those kids — the structural half of
  `adoptShadow` without moving natives or deleting anything.
- **Lookups see co-residents**: `findCellChild` and `cellChild` look through the resident's
  co-residents' kids before minting; `peekNeighbour`/`peekRing` return the resident, and every reader
  of a cell's ink reads its co-residents: `ownContent` (`TileStore.js:292-296`), `_bakeUp`'s parent
  (`:347`), `_ringNatives` (`:434, 441`), the idle fits (`KobinEngine.js:1298`), the erase debug
  overlay (`overlays.js:243`). `_downSources` and the lasso's walk already list co-residents
  (`childrenOf`, `LevelMap.js:132-141`).
- **Each co-resident is its own selection unit.** The lasso's walk visits it and judges it on its own
  box; `isUnder` loses its shadow clause (`LevelMap.js:785`) and `subtreeStart` stops dragging shadows
  along (`:471`), so selecting a resident no longer drags a neighbour's moved frame with it.
- **The camera stays in a resident.** When `_take` turns the camera's frame into a co-resident, the
  camera is handed to the resident — the same cell, the same coordinates — at the re-address, not at a
  later merge event (F126's follow goes).
- **GC promotes**: an empty, childless resident with co-residents hands the cell to one (`_leave`'s
  rule, `LevelMap.js:333-341`) and is forgotten.
- **A deleted frame subtree leaves the lattice.** Its records hold the frames and their lists; an undo
  puts the root back at its cell, as a co-resident if new ink has taken the cell since; the camera in a
  deleted frame moves to a fresh frame at the same cell. This replaces F107's revival: `_reuseDetached`,
  `_detached`, `_detachedLists`, `_reused`, `_detachedKeyed`, `_gone`, `kept` and `getById`'s set-aside
  test go (the op log's drain finds set-aside natives in the op's records, F115).
- **Deleted**: `_mergeShadows`, `adoptShadow`/`unadoptShadow`, `unmerge`, `holdMerges`, the
  `mergeFrame` event and entry (decode kept), the selection's merge handler, F126's follow.

#### C4 — A cede's kids live in private frames of their object

- `descentJob` stores each step's kids not in the chain's frame at that cell but in a **private
  co-resident** of it: created on first use, its lattice parent the previous step's private frame (the
  target's own frame at the first step), flagged `private` with the target frame's id and persisted.
  Remnants stay in the target's frame. The worker path is unchanged in shape (`minted`,
  `eraseDescent.js:281-283`; `lm.merge`, `erasePipeline.js:1116`).
- **The lasso never takes a private frame whole**: it is read as straddling and its natives are
  judged with their families (`_familyBounded`). Every other frame keeps the O(1) enclosed rule with no
  family pass: the city's frames no longer hold the backdrop's patches, so the Earth lasso is frames
  again, not 17,007 ids (F108-COST option (c), which Kobin was offered).
- **Severance compares cells**: `_cellOffset` (`erasePipeline.js:999-1008`) asks `peekNeighbour`, which
  returns residents; with kids in co-residents it must compare lattice cells, or two kids of one blob
  in neighbouring private frames never join (F124 again).
- **Legacy families** — kids already stored in shared frames — keep today's rule (`_tornUnder` over
  `keyedIn`) as a backstop; a frame's `keyedIn` set is non-empty only for legacy content.

### 4.5 The options against every criterion

| criterion | (a) container field | (b) never re-home | (c) recommended |
|---|---|---|---|
| exactness; a far-moved object's numbers | as today: carries keep tables within ±W/2; stored numbers untouched except by `_normalizeHome` | stored numbers untouched; an entry holds any displacement exactly (~2⁴³ units at its level), but a move made above a member's home needs a negative-depth entry or a later move at the home rounds away (F41) | stored numbers never rewritten (`_normalizeHome` gone); tables within ±W/2 per level as today; the composed k = 0 sum within one frame; bit-identical at and below the home (E3) |
| how tiles find ink | as today | reach rule for stored bits; every picture through the displaced index, extended to whole frames and to views above the home; F0 tiles where the object was drawn, often cold | reach rule for stored bits; the reroute completed (frame groups, the home-depth carry, views above the home); F0 near the view, as today |
| displaced index: per move / add / remove / tile bake / camera frame; memory | as today | O(members) at the drop / O(1) / O(1) / 0 / O(groups) + the F0 tiles; ~40 B a displaced native (0.8 MB for 19.7k) | the same shape; groups ≈ 61 (home, table) on the Magnum Opus plus one a shifted frame |
| O(1) subtree move | survives, plus O(emigrants + foreigners) a move to reconcile | survives | survives; once at the drop; no settle ever |
| cedes | a kid's `container` is its object's; stored deeper | kids stored deeper, in other frames; F100/F108 rules stay | kids in private frames of their object (C4) |
| erase candidate scan | as today | as today; far-moved natives always in its moved walk | as today, composing the shift |
| lasso walk | spatial enclosure mapped to container membership: emigrants judged where drawn, foreigners left out | enclosed frames consult their far-moved members; the O(1) lasso degrades with per-object moves | as today with shifted boxes; co-residents judged alone; private frames straddle |
| scene index | as today | composed translation with its carry (whole frames) | composed translation with its carry (at most one frame) |
| frame GC, F94 | a frame with no stored natives but emigrant members must stay | per-event mints gone with B-DRAG | final scaffolding only; co-residents promote; a deleted subtree is out of the lattice, its ids reserved while an op names them |
| undo/redo entries | as today (`settle`, `mergeFrame` stay) + container changes | no `settle`; `move` members carry signed tables; `moveFrames` without `settled` | no `settle`, no `mergeFrame`; `moveFrames` without `settled`/`merged`; `move` without `base`/`after`; `removeFrames` restores into a co-resident when its cell is taken |
| save format | a native field `c`; an older build keeps it through `_extra` (`format2.js:69, 73-77`) and lets it go stale | negative-depth `below` entries: the deployed build refuses the file (kobin-1, `persist.js:320-325`) or drops the table (kobin-2, `Document.js:175`) | no native field; the lattice header already carries `shift` and `shadowOf` (`LevelMap.js:1105-1106`); C4 adds `private`; version 3 when any is present |
| existing files | containers default to storage frames | load as they are | load as they are; legacy replay for rasteriser-branch stores |
| multi-device sync | followers still settle on read | reads pure | reads pure; frame ids mean the same frame on every device |
| deleted | the selection's chasing | settles, carries, per-event re-homes | settles, carries, per-event re-homes, merges, F107's revival, the chasing, the torn walk for new content |
| added | a field; foreigner and emigrant indexes on every mutation | signed tables; far-moved sets per frame | a composition accessor; co-resident lookups; one frame flag; a version gate |
| of the nine flags | F93's selection half, F100, F108 | F78, F110, F116, F93's carries, F94 (with B-DRAG) | all nine |

### 4.6 Considered and not recommended

- **Placement shifts in the lattice.** Make a frame's shift part of its edge, so its kids follow it
  and only a selected root is ever re-addressed — O(roots) a move, no re-parenting, no scaffolding.
  It makes P4 path-dependent (the same place reached as two frames through two sub-lattices), breaks
  "neighbouring origins differ by exactly W" under every re-home and tile-phase argument
  (`frameLattice.js:187-193`), and breaks the pyramid's integer crossing map (PLAN §3: "the parent's
  coarser cell by integer arithmetic equals `_mapFrame`'s affine to the bit"). Too deep a change for
  what it buys.
- **Cells separate from frames** (a lattice of address nodes that index container frames). The clean
  end state Kobin's words describe, and the model C3's co-residents approximate. Thirteen engine
  modules call the lattice by frame id, and the plate cache, the scene index's `FrameTable`, the store
  and the op log key by it; every one would have to tell a cell from a frame. C3 gets the behaviour
  without the rewrite.
- **A second parent pointer on frames** (`container` beside `parent`, diverging only where C2
  re-parents a descendant). Structurally stronger than the op repair: a moved frame's subtree is the
  same set forever. It adds a container walk to selection, delete, count, GC and the drag, a mapping
  in the lasso from lattice-enclosed subtrees to container units, and a header field. Observable
  behaviour is identical to the op repair, so it is Question 2.

### 4.7 Recommendation

**Option (c), C1 → C2 → C3 → C4.** Confidence: 0.75 that C1 and C2 are right and cheap (C1 is measured
picture-neutral; C2 rides B-DRAG); 0.65 for C3 (co-residency must reach every by-address reader, §9);
0.55 for C4 (it changes where cedes store kids and touches severance). What it buys, counted against
§2: every row but the family rule for legacy content goes.

---

## 5. The migration path

**Step 0 — inside B-SCENE (wave 2).** Build the scene to the §6 contract: `placed()` and the item table
call the model's three functions and never read `o.below`, `f.shift`, `o._home` or `doc.at`. Today's
implementation of the three functions composes a pending shift too (a no-op after a settle), so the
contract is live before anything else changes. Equivalence: the scene's items equal `listFor`'s, as
PLAN §3 already requires.

**Step 1 — C1, alone.** The composition is in place first (step 0 and the lasso, erase, overlay and
scene-client readers switched to it), then the settle is removed. Because the composition is
measured bit-identical at and below the home, the app works identically half-way: with the settle
still running, the composition sees a zero shift; with it gone, it sees the shift. Old stores: pending
shifts load as placement; old `settle` entries replay through `applySettle` (their result tables are
idempotent), and old undo ops with `settled` records invert through the kept `unsettle`, in a
quarantined legacy module deleted once Kobin's stores have compacted past them (the undo window is 200
ops, `Document.js:193`).

**Step 2 — C2, with B-DRAG (wave 3).** One write at the drop; `_normalizeHome` deleted; the op-driven
repair replaces `_keepingSelection`, `_followCarries`, `_flushCarried`.

**Step 3 — C3.** Co-resident lookups and readers first — while merges still run they only show a
shadow's ink, between a drop and the resident's first read, where the merge would have put it — then
the merge removed, then the delete that leaves the lattice. Old `mergeFrame` entries and ops with
`merged` records keep their legacy inverses (step 1's module).

**Step 4 — C4.** New cedes only; legacy kids stay where they are under the backstop rule.

**Versions.** A file whose lattice carries a shift, a co-resident or a private frame is written as
version 3 (`persist.js:52, 68-76`: the same mechanism as version 2's cut lines). The deployed build
(before 4c99a8a) knows none of the three and would drop them on its next write; with the gate it
refuses the file with its "saved by a newer version" message (`persist.js:103-105`). Files the
deployed build and Kobin's phone saved carry none of them and open unchanged; no conversion pass
exists or is needed. Kobin's dev stores from the rasteriser branch (pending shifts, settle and merge
entries, shadows) load through step 1's legacy replay.

**The equivalence checks.**

1. **Tile fuzz, bit for bit.** A frozen copy of today's `Document`, `LevelMap`, `TileStore`,
   `selection` and `oplog` under `src/engine/__oracles__/model-v1/` (as `KobinEngineV0` was), and a
   probe that feeds both engines one random op sequence (draw, erase at depth, per-object drag,
   subtree drag, undo, redo, delete, save and reload) and, after every op, bakes the up and down tiles
   of the camera frame, its parent, a ring neighbour and a child, and compares every derived piece bit
   for bit for every native whose home is the same in both engines; for a native the oracle carried,
   the drawn piece mapped into the view frame, to the bit at and below the home and to one ulp above
   it (E3's measured bound). Plus a cache check inside the new engine: every cached tile equals a cold
   bake (`tile.patch.test.js`'s rule).
2. **Selection fuzz.** The same op sequences with lassos (whole frames, straddling loops, loops round
   a nick), ctrl-taps, drags, undo, redo, delete and cuts under barriers; after every op the
   selection's ink — its ids, plus every native under its frames — equals the oracle's, and equals the
   ink it was made with, mapped through cuts to pieces. No inkless frame in either.
3. **No read mutates.** `doc.rev`, `offRev` and the lattice's `addrEpoch` unchanged across `listFor`,
   `content`, a lasso, a hit test, the scene's pack and a snapshot (a property over the fuzz's states).

---

## 6. The contract with the scene (for A2)

A2's Stage (`A2-scene.md` §2.3, §2.6, §2.10 as of this writing) already has the right shape: an
item's `off` for paint, `placeNative(nat, frameId)` for inputs, a pushed reroute memo, and `byHome` so
that "an event about a frame's placement updates O(its natives)". What it still reads directly is
what C1 and C3 change: `off = residual(nat.below, D − depth(home))` (A2 §2.3), `placeNative` over
`LevelMap`'s `*Obj` functions (§2.6), groups from `LevelMap.objShift` (§2.10), and own natives
through `Document.at`, with a loop in `sync` for the settles that read raises (§2.4). The contract
below is those four reads behind one model object A1 owns, so B-MODEL lands without touching the
Stage:

```js
/**
 * The document model as the Stage reads it. The Stage calls nothing else for membership or placement:
 * never `o.below`, `f.shift`, `o._home`, `Document.at`, `offsetIds`, `residual` or the `*Obj`
 * functions of `LevelMap` directly.
 */
interface PlacementModel {
    /**
     * The natives drawn live when the camera is in frame F: F's own and its co-residents' (frames
     * sharing F's cell), as stored. Pure: never settles, merges or mints. Today: `doc.at(F)`.
     */
    nativesIn(F: FrameId): Iterable<Native>;

    /**
     * Where native `o`'s picture is, seen from frame F:
     *   F0   the frame whose unmoved tiles hold the pieces drawn in F; F0 === home(o) means `o`
     *        itself, drawn live;
     *   rem  the translation, in F's units, those pieces or that native are painted with (the item's
     *        `off`, the drag delta aside), and that every input reaching `o`'s geometry is shifted back
     *        by (`placeNative`'s `toStored`/`fromStored` are this, applied to a point, rect or loops).
     * Composes o's home frame's placement and o's own table, never one without the other, and honours
     * the whole-frame carry at the home depth. Pure in the model's revision; null when F cannot see o.
     * Today: `LevelMap.objShift` / `residual` on `o.below`.
     */
    placement(o: Native, F: FrameId): { F0: FrameId, rem: [number, number] } | null;

    /**
     * Every group of natives whose picture is not at their stored bits as seen from F, keyed by the
     * (F0, rem) they share: `members` an id set, or a frame (all its natives without a table of their
     * own). `rev` moves whenever any placement can have changed. Today: `TileStore._rerouteGroups`.
     */
    displaced(F: FrameId): { rev: number, groups: Map<string, { F0, rem, members: Set<Id> | FrameId }> };
}
```

Events: a placement change names one native (`{kind: "change", id, offsetsOnly, oldBelow}`, A2's
addition) or one frame (`{kind: "refile", frame, from, to, shiftBefore, shiftAfter}` — the shift fields
are the addition this contract needs). The Stage re-places `byHome.get(frame)` for a frame event,
never a walk of the document. Under C1 no `settle` events exist, so A2's `settle: true` flag and the
re-entry loop in `sync` are needed only until C1 lands; under C3 no `mergeFrame`/`splitFrame` events
exist. Selection membership (`held`) stays the engine's question (`_isSelected`), outside this
contract.

## 7. Impact on the other workstreams

- **A2 / B-SCENE**: builds §6 — four reads moved behind the model (`off`, `placeNative`, the reroute
  groups, own natives) and the shift fields on `refile`. The erase rule (PLAN §1.3) is untouched; its
  targets at pen-up come from `_candidatesUnder`, which composes through `placement`. The "placed read
  equals the numeric table" invariant (PLAN §3) reads "the home frame's placement and the table
  applied".
- **B-ERASE**: `_candidatesUnder` and `_eraseFramesPass` compose the shift (C1); the descent's kid
  tables cancel a shifted target frame (C1) and its kids go to private frames (C4). Barriers stay
  (decision 3), which is also what keeps cuts from changing a selection.
- **A3 / B-PYRAMID**: nothing. A3 asks whether A1 adds non-cell offsets to frames, since `mapCell`,
  like `mapPointF` (`LevelMap.js:897-903`), ignores `frame.shift` (`A3-pyramid.md` §11). It does not:
  under C1 a frame's shift is a per-native placement composed through `placement()`, never an offset of
  the frame's coordinates, so frame-to-frame maps stay pure cell arithmetic (the rejected "placement
  shifts in the lattice", §4.6, is what would have changed them). Plates stay keyed by frame; with no
  merges, `PlateStore.dropFrames` on `mergeFrame` (`KobinEngine.js:720-721`) goes.
- **B-DRAG**: shares C2's drop: one re-home per per-object member, one re-address per subtree, the op
  written once, the selection repaired from it.
- **Scene index**: the item translation composes with its carry; `mergeFrame`/`splitFrame` handling
  (`sceneClient.js:235-238`) becomes legacy.
- **Store and sync**: the version-3 gate; old entries replayed through the legacy module.
- **Docs**: DESIGN §1 (invariant 2 is about stored bits; the carries are gone), §2 (the frame row),
  §8 (the subtree move, shadows, the settle — rewritten), §10 ("the selection stands for the same
  ink" paragraph — rewritten), §13 (settle and merge entries, version 3); OPEN-FLAGS F78, F93, F94,
  F107, F108, F110, F116, F126 annotated; the bible §10 gets an entry for C1.

---

## 8. Tests that define done

| test | what it pins |
|---|---|
| `model.equivalence.probe.js` (new, §5 check 1) | every derived piece bit for bit against the frozen oracle over random op sequences |
| `select.stands.probe.js` (new, §5 check 2) | the selection's ink unchanged through drags, undo, redo, cuts; no inkless frame |
| `model.pureRead.test.js` (new) | no read changes `rev`, `offRev`, `addrEpoch` or the lattice's frame set |
| `model.compose.test.js` (new) | `objShift`/`residual` honour the home-depth carry (0.75 W → F0 one cell over, rem −0.25 W); the live-native case; newcomer cancellation; a promoted native; registration per-object vs subtree (`move.subtree.test.js` t2, kept) |
| `lattice.coresident.test.js` (new) | lookups through co-residents; kids linked on landing; the camera handed to the resident; GC promotion; a deleted subtree out of the lattice and back as a co-resident |
| `move.subtree.test.js`, `move.normalise.test.js` N1–N4 | kept: registration and the shift normalisation into the address (§2.2) still hold; settle-specific assertions rewritten as placement assertions |
| `select.inkless.test.js` | I1–I2 kept; I3/I5/I6/I8 rewritten as op-driven repair cases; I4 (merge hand-over), I9 (settle inside a render) deleted with their mechanisms |
| `erase.privateCede.test.js` (new) | a cede adds no keyed piece to a non-private frame; the F108 repro takes the enclosed frame whole and none of the family; a torn-family lasso is O(frames) |
| `hooks/store.model.test.js` (new) | a rasteriser-branch store (pending shifts, settle and merge entries, `moveFrames` with `settled`/`merged`) loads to the oracle's picture and undoes; version 3 written only when needed; a version-2 reader refuses it |
| deleted with their mechanisms (PLAN §3) | `move.settle.test.js` (F78's `_bakeSettled`), `move.camMerge.test.js` (F126), `select.detachedFrame.test.js`'s revival cases (replaced), `move.twin.test.js`'s merge cascade, the settle/merge cases of `oplog.test.js`, `format2.test.js`, `Document.test.js`, `LevelMap.test.js` |

Counters to measure, not to gate: per drag event 0 re-homes, 0 mints, 0 settles; mints at the drop =
final scaffolding; the Earth-shaped torn-family lasso's id count.

---

## 9. Risks

1. **A missed composition site draws ink half a cell off**, visible only at depth. Twenty-two reads
   of `o.below` for the picture, in eight files (§13's grep), must all go through the composition. The
   equivalence probe is the guard; a lint that forbids `.below` outside the model keeps it so.
2. **A missed co-resident reader makes ink invisible** — the F78 symptom class. §4.4 C3 lists six; the
   descent's `lm.neighbour` lookups and `_cellOffset` are two more.
3. **Newcomer cancellation** puts a non-zero own table on ink that never moved; any code that treats
   "has a table" as "was moved" (`hasOffsets`, `_offsetIds`, `_lassoMoved`'s walk) must ask the
   composed placement instead, or it pays a reroute for nothing.
4. **The version gate** makes Kobin's phone refuse a canvas the desktop wrote until it reloads the
   app. That is the designed behaviour (DESIGN §13), but it is new friction.
5. **Legacy code lingers**: `unsettle`, `unmerge`, `applySettle`, `mergeReplay` stay until stores
   compact. A quarantined module with a deletion date keeps it from growing new callers.
6. **C4 and severance**: private co-residents at neighbouring cells must still join (F124); the
   doorway test's frame arithmetic must accept a private frame as a kid's parent.
7. **Scheduling**: step 0 must land inside B-SCENE, or B-MODEL touches the renderer again.

---

## 10. Effort

| step | agent-days |
|---|---|
| step 0, the contract inside B-SCENE | 0.5 |
| C1: composition, ~22 picture reads, `objShift`/`residual`, reroute groups, newcomers, settle removed, legacy replay, oracle copy and equivalence probe | 3 |
| C2 on top of B-DRAG: drop-time writes, `_normalizeHome` gone, op-driven repair | 1.5 |
| C3: co-resident lookups and readers, camera and GC rules, merges removed, delete leaves the lattice, selection fuzz | 3 |
| C4: private cede frames, sealed lasso rule, severance by cells | 2 |
| docs (DESIGN §1, §2, §8, §10, §13; OPEN-FLAGS; bible §10) | 0.5–1 |
| review passes | 1–1.5 |
| **total** | **11.5–12.5** (the core, C1 + C2 with step 0: 5) |

---

## 11. leastSure

1. **That every picture reader is on the list.** I found twenty-two reads of `o.below` for the
   picture in eight files and six by-cell readers of a frame's natives; the codebase has grown callers
   faster than documents record them (SUBTREE-O1-PLAN §2.2 counted eleven), and one missed site is
   exactly the ink-in-the-wrong-place class Kobin has seen.
2. **The census is synthetic.** Random kid cells and uniform prior tables, 25 frames. The real
   proportion of re-parented kids and carried natives on the Magnum Opus was not measured here (the
   drawing is not in the container). The Earth's recorded `[-49152, -49152]` tables suggest carries
   are the norm, not the exception.
3. **Reading Kobin's model as "moved into".** C2 re-homes a per-object member into the frame it lands
   in. If Kobin means that an object dragged anywhere stays a member of the frame it was drawn in, the
   answer is option (b) with its format change and its slower lasso — Question 1.
4. **C1's one-ulp difference above the home.** Measured on 240 natives with full-mantissa rects; real
   arcs with centres far from their endpoints were not tried. The down path is a leaf (bible §10.4b),
   so an ulp there is paint-only, but a test that compares coarser pictures bit for bit will see it.
5. **The effort estimate**, ±50 %: C3's co-residency touches the lattice's most-called functions.

---

## 12. Questions, each with my recommendation

1. **Per-object moves: re-home once at the drop, or never?** Recommend **at the drop** (C2): containers
   stay compact, the table format stays, the lasso stays O(1). Never re-homing needs negative-depth
   tables the deployed build refuses or silently drops.
2. **A moved frame's re-parented descendants: repair the selection from the op, or give frames a
   second parent pointer (`container`)?** Recommend **the op repair** for B-MODEL: identical behaviour,
   no second tree. Ask Kobin whether he wants frames to be literally the same group after a move;
   if so, the pointer is a contained follow-up.
3. **New ink in a shifted frame: a −shift entry in its own table, or a fresh unshifted co-resident for
   new ink?** Recommend **the −shift entry**: no extra frames, and replay composes it correctly in any
   order.
4. **C4 in B-MODEL, or keep the torn walk until Kobin answers F108-COST?** Recommend **C4 as B-MODEL's
   last step**: it is the (c) he was offered, and it deletes the walk for new content.
5. **Write version 3 when the lattice carries a shift, a co-resident or a private frame?** Recommend
   **yes**: an older build refusing a file beats one silently dropping every frame's placement.
6. **Old undo history with `settled`/`merged` records: keep legacy inverses, or clear history at the
   first load by the new build?** Recommend **keep them** in a quarantined module with a deletion date;
   Kobin's undo across the upgrade keeps working.
7. **The equivalence oracle: a frozen copy of five modules under `__oracles__/model-v1/`, or golden
   files?** Recommend **the frozen copy**: golden files cannot follow a random op sequence.
8. **Is each co-resident its own selection unit** (no shadow clause in `isUnder`)? Recommend **yes**:
   the lasso judges each on its own box, and a resident no longer drags a neighbour's moved frame.
9. **A deleted frame subtree leaves the lattice** (replacing F107's revival)? Recommend **yes**.
10. **Order**: recommend step 0 inside B-SCENE; C1 right after B-SCENE (independent of the drag, and
    measured picture-neutral); C2 inside B-DRAG; then C3; then C4.
11. **Legacy ceded kids: move them into private frames at load?** Recommend **no**: it is an engine
    re-bucketing at load; the backstop rule is correct, and they age out as Kobin erases and redraws.

---

## 13. The experiments

Scripts under the session scratchpad `a1/` (not in the repo): `run.cjs` sets the jsdom globals
`src/setupTests.js` sets and requires a bundle made with
`npx esbuild <entry> --bundle --platform=node --format=cjs --loader:.js=jsx`.

- **E1 `census.js`** — §1.4's table: the synthetic fixture, a lasso-equivalent frame selection or all
  ids, 40- or 10-step drags through the pointer with a render each step; counts from the op channel,
  spies on `rehomeById`, `rehomeManyById`, `setOffsetsById`, `unsettle`, `_reselect`,
  `_followCarries`, `_flushCarried`, `_outsideSelection`, and the lattice's frame count.
- **E2 `objshift.js`** — a home frame at depth 2 and a composed table of 0.75 W: `shiftAt(k0 = 0)`
  gives carry 1, rem −32,768; `residual` gives −32,768; `objShift` from the home and from its right
  neighbour gives F0 unchanged with rem −32,768 (the frame dropped); from the neighbour's child
  (k0 = 1) it gives `1/5,5/1024,0`, the carry honoured.
- **E3 `compose.js`, `compose2.js`** — two engines from one seed, the same 30-step subtree drag;
  engine A as built then every frame read, engine B with `_settleIfPending` disabled. Each native's
  first point placed in its parent, its A-home and a child of that: integer rects 720/720
  bit-identical (78 of 240 homes differ); full-mantissa rects 716/720, the 4 at the parent view among
  the 76 carried natives, worst 5.7e-14 units; B kept 6 frames with a shift.
- **The picture-side reads of `o.below`**: `grep -n '\.below\b' src/engine/*.js src/engine/raster/*.js`
  less storage and serialisation (`Document`'s own mutations, `format2`, `persist`, `oplog`'s file
  forms): `KobinEngine.js:657-662, 714, 728, 784, 933-935, 967-973`; `TileStore.js:243`;
  `eraseDescent.js:195-204`; `erasePipeline.js:432, 607-612, 986`; `overlays.js:262, 454, 609-611,
  875`; `sceneClient.js:312, 349-359, 514`; `selection.js:297-306, 698-712`; `report.js:558-560` (which
  already adds the carry back: `carry·W + rem`).
- **E4 `cellindex.cjs`** (`node --expose-gc`) — 42,857 synthetic boxes, depths weighted by the Earth
  probe's per-frame counts, widths 20–900 px at in-frame zooms log-uniform in [1/32, 256]: 1.03 cells a
  native at its home (1,111 straddling), 44,128 entries in 1.6 MB; with every coarser level 308,537
  entries in 9.1 MB (31–39 bytes an entry, sets of numbers).

---

## 14. As built: C1 (B-MODEL-C1, 2026-09-29)

Dated notes where building C1 changed or sharpened §4.4, §5 and §8. The oracle is the model before C1
frozen whole at 5e9b1dd (`src/engine/__oracles__/model-v1/`); every number below is jsdom.

- **Merges move to the end of the user action in C1, not at C3.** §4.4 keeps the merge at a read
  until C3 deletes it, but C1's pure reads forbid that. A shadow now merges when the action that made
  it ends — the drop, an undo, a redo, a load, a replay's end (`Document.mergePending(op)`) — and the
  merge folds the difference of the two frames' shifts into the merged natives' own tables, so their
  pictures stay; the tables before and after go on the op's record for `unmerge` and the log. A
  shadow holding no natives, kids or shadows is not merged: it is frame GC's (F94; `move.subtree` t9).
- **`displaced` still mints** the frame a picture's pieces are read from when the lattice lacks it
  (§1.2 row 19, kept). PLAN §3 row 8 names it as the one lattice change a read may make: an empty
  frame, GC'd. `model.pureRead.test.js` counted 77 such mints over 180 states with an unread shift put
  on an inked frame; nothing else changed. The review pinned it: each mint is a displaced group's
  source frame or on its chain and goes at the next frame GC (82 over the same states with the
  budgeted snapshot, the drag's pick, the erase frame pass and the scene index added, and `report()`
  a case of its own); read by read over 600 states, only the Stage's first read of a view minted.
- **The home-depth carry, as built**: `residual` returns `{carry, rem}`; `objShift`'s k0 = 0 branch reads
  F0 = the neighbour the carry points back from, so E2's 0.75 W from the right neighbour is F0 = the
  home, rem −0.25 W, the native drawn live there (`placementModel.nativesIn`'s `live` set). A picture
  table is never carried: its k = 0 entry may reach 1.5 W.
- **Two staleness bugs the fuzz and the compose suite found, fixed**: a drag set a frame's shift after
  its refile event, so the reroute memo keyed on `offRev` kept the old groups (`setFrameShift` now bumps
  `offRev` and runs before the refile); and a geometry edit that took a native's table away emitted an
  event that looked table-less, so `offRev` stayed (a promoted newcomer drawn off by its old −shift at
  the view above; the oracle has the same flaw, unreached). The event now carries `oldBelow`.
- **The oracle drops a pending shift when it promotes an older native** of the shifted frame; its only
  promotion was a landing stroke, which its `add` had settled first, so it never happened there. C1
  composes the shift one level down for any native (`promotedTable`).
- **§5 check 1's comparison, as run**: at and below a native's home its pieces and offsets to the bit;
  above it its painted points within one ulp — measured 0 ulp for all 33 items the oracle carried
  (20 seeds × 40 ops, 6,336 items). Two rules were needed: above the home only the square's interior
  (64 units in) is compared, because the oracle read the unshifted window there and drew less at the
  square's edges; and a native the oracle carried which a later frame operation then moves in one
  engine only (C1's point) is counted, not failed — 0 in the run.
- **The comparison, as reviewed (R-MODEL-C1)**: frames and homes are matched by place, since one id can
  sit at two cells (the oracle zeroed a shift at its settle, so a later drag carried another whole cell
  into the address; seeds 50, 145). Above a home the whole square is compared: every oracle item is in
  C1's picture to the bit, and each C1 item it lacks comes from a tile only the composition's shifted
  window reaches, painted with the composition's remainder (checked by arithmetic), none missing. A
  divergence of a carried native passes only when one of its homes moved since the carry (seed 81, 46
  of them). Seeds 1–200 × 40: 55,896 items, 107 carried (≤ 1 ulp), 36 edge-only. Past seed 20 it found
  a reroute memo naming a frame frame GC forgot, in both models (fixed in `TileStore.forgetFrame`;
  while both memos were stale the old comparison saw two equal empty pictures).
- **Counters**: a 20-event subtree drag of a frame of 300 natives, a render each event: the oracle 1
  settle and 300 then 600 table writes an event, C1 0 and 0. The harness's scenarios 3 and 4 against
  the pre-C1 tree: the ink pixel-identical; with the selection shown, the ants' dashes differ in phase
  along the same outline after the drag. Traced by the review: the selection, its 1,044 natives' items
  and the ants' 45 runs are the same in both trees, in the same order; the phase is the crawl clock at
  the screenshot (reduced motion: 0 px apart; one tree's page 150 ms later: 54,503 px).
- **Stores**: a store the oracle wrote opens to its pictures (its pending shifts read as placement, its
  settle entries replayed by result through `legacy/modelV1.js`, deletion date 2026-12-31) and undoes
  and redoes to them; version 3 is written only when the lattice carries a non-zero shift, and a
  shift-free file is byte-identical to the oracle's.

## 15. As built: C2 (B-DRAG, 2026-09-30)

Dated notes where building C2 changed or sharpened §4.4, §5 and §8. jsdom unless said; the browser numbers are
headless Chromium 141 on `git archive`s of d206cd3 (before) and the build.

- **The hold carries the drag.** `stage.hold` takes the members and every native under the selected frames;
  `stage.setDragDelta(δ, {frame, viewDraws})` per event. Held natives are placed at + δ for every input
  (`placed`, `placeNative`: hit tests, the lasso) and painted there by the view only when the drag plane does
  not draw them (`Item.res`; each δ change then one commit dirtying the old and the new boxes). So the pack
  rule needed no edit to `RasterRenderer`/`rasterPack` — the SVG path reads the same `res` — and the plane's
  own SEL packs keep reading the rest. `stage.atRest(fn)` reads without δ: the ants decide on the picture the
  drag began from, and a decision still good at rest becomes the drag's (a re-decision there cost 220–250 ms
  on the dense scene). Counters over 40 events (per-object, a frame, both): 0 document events, re-homes,
  settles; `rev`, `offRev`, `addrEpoch`, the frame count and the undo stack unchanged (`move.drop` D1).
- **The drop, once** (`selection._dropMove`): §4.4's arithmetic on the picture table, the frames by
  `_dragFramesStart`/`_dragFrames` against the lattice as it stood at the press, one op, the write, the hold's
  release and `mergePending(op)` in one Stage batch, then `noteUserEdit` (PLAN §5.15 item 2). A cancel writes
  nothing, so no shadow exists to merge (`move.drop` D3: byte-equal after a drag across an occupied cell,
  for a pinch, an undo mid-drag and a deselect; `mergePending` never called).
- **The census** (§1.4's fixture, 40 × 7 px, a render each; seeds 12345/777/4242): frames minted during the
  drag, the tree before 211/145/239 (the oracle the same), now 0/0/0; left after GC 14/4/4 → 14/5/4 (oracle
  15/5/5: it keeps an emptied cell its trail shadowed).
- **Registration, found while measuring it (F136).** The per-event path re-addressed each event against the
  lattice the previous event left, where the moving root could sit in the cell a carried kid's chain named:
  over the census walk, 400 of 1,250 natives landed 32 units (a cell) off the per-object picture at seed 777,
  and in the harness's scenario 4 frame "1/-1,1"'s 100 natives sat at x 271.99 instead of 239.99 (too small to
  see there: its ink screenshots matched). The drop computes once against the unmoved lattice: 0 of 1,250 at
  seeds 777/12345/99 (`move.drop` D2, red on d206cd3).
- **`_normalizeHome` goes**, and with it every coordinate a move wrote: `move` ops carry no `base`/`after`
  (the codecs still carry them on older ops, for replay and for an undone old op's inverse). The tile fuzz's
  oracle still normalises, so `modelFuzz.comparePictures` compares a native whose stored numbers differ
  between the two by its drawn box through each model's placement (one draws it live, the other through a
  tile): 16 such over 25 seeds × 40, within 1.5e-8 home units (`NORMALISED_TOL` 1e-6).
- **The selection from the op.** `_opUnder(op)` reads, before a drop, an undo or a redo, the op's frames under a
  selected frame and its per-object members listed or under one; `_repairSelection` runs `_reselect` on them
  quietly after, before the one render. The per-object members are read too, not only the frames: an undo of
  an older per-object move can carry a native out of a newer frame selection, which the event capture kept
  as an id (`select.inkless` I11). `_keepingSelection`, the `_moving` capture and the per-remove listener are
  deleted; the subscriber keeps `reset` and the merge hand-over, which C3 deletes with merges (so `select.inkless`
  I4 stays; I9 went). An id a remote edit removes now stays in the selection, skipped, until the next repair. The
  inkless rule now follows every undo and redo: a selected frame an undo empties leaves, where the oracle
  keeps it (`select.stands` 12 × 40: 480 checks, 133 selections against 135, `inklessBoth` 2 → 0).
  `deleteSelection` reads every family before one removal batch (reading them between removals rebuilt the
  family index per id): 5,000 natives 532–585 s (4,999 `_setSelection` calls) → 1.3–1.5 s SVG, 0.53 s raster, 0 calls.
- **Browser, scenario 4** (dense, 45 selected of 3,441): ink 0 px apart, with the ants frozen 0 px; drag event
  median 1.2–1.7 → 0.7–0.8 ms; the drag's first event 64–83 → 27–33 ms; the drop 1.7–2.0 → 1.5–1.9 s; harness long
  frames 22|26 → 24|16, `olderPatchMs` 953|1,218 → 988|886 (load 2.3–4.5).
- **What stays a lattice fact** (§4.4's last bullet): a carried kid is re-parented under the root's lattice
  neighbour at the drop. A second parent pointer (§4.6, Question 2) would take: `container` beside `parent`,
  set by `_dragFrames` when `readdressMany` re-parents a kid away from its root; `_underFrames`/`isUnder`,
  `walk`, `_subtreeCount`, the delete's `removeFrameSubtree` and frame GC reading `container` first; and the
  op's frame entries recording it for undo — `_outsideSelection` and the repair's frame half then go.
- **As reviewed (R-DRAG, 2026-09-30).** A selection of a frame and per-object members: the drop re-homed a member
  carried into a selected frame's start cell into that frame and then re-addressed the frame, moving the member twice
  (38.4 px for a 19.2 px drop; d206cd3 had a different defect there, 24 px, its last event only). `_dropMove` now
  re-addresses the frames first and runs the members' arithmetic against the lattice they left (`move.drop` D2b, red
  on 8f9c073); the arithmetic is still once per (home, picture table). A member landing in a moving frame's vacated
  cell takes a new frame there; an undo that returns the frame to that cell merges it into that frame when it keeps an
  emptied kid (F80's mechanism; the picture exact, the redo byte-exact) — C3's co-residents remove it. The census is
  unchanged (0 during the drag; 14/5/4 after GC). The pair fuzz's oracle follows DESIGN §10 after an undo or a redo
  (TEST-MAP); `model.equivalence` 200 × 40: 8,000 checks, 55,701 items, 137 normalised within 1.46e-8;
  `select.stands` 50 × 40: 2,000 checks, 432 selections. `move.hold.probe.js`: the document byte-equal at every event
  of drags interleaved with renders, hit tests, lassos, resizes and crossings, under every exit.

## 16. As built: C3 and C4 (B-MODEL-C34, 2026-09-30)

Dated notes where building C3 and C4 changed or sharpened §4.4, §5 and §8. jsdom unless said.

- **A cell's frames are one group, all the way down.** `_take` makes the mover a co-resident (`shadowOf` the resident,
  in its `_shadows`); a frame's `_kids` maps a cell to one of its own kids, so a lookup goes through every frame of the
  parent's group (`_kidAt`) and returns the resident. Linking kids when a frame lands (`_linkKids`) is recursive and
  splitting them when it leaves (`_splitKids`) is its inverse, so the invariant holds after any re-address: the frames
  at one cell are one group, and their parents are one group. Container (`parent`) and geometry are separate: paths
  and chains walk cells through residents (`_cellParent`), so the path between co-residents is empty and their
  pictures are bit-exact (`lattice.coresident`).
- **Who holds the cell.** An empty childless resident yields to the mover (the visited cell); a private frame never
  keeps residency from a public one. `_regroup` picks the resident; `sameCell`, `cellFrames`, `residentOf` and
  `Document.cellList` are the readers' four primitives. Every by-cell reader named in §4.4 reads the cell; the erase
  debug overlay needed no change (it reads every frame of `levels()`).
- **No read mints** (row 8 without exception). `objShift`'s `mint` is false in the reroute; a missing source is in
  the grouping's `miss` (the native drawn nowhere until its frame exists); `TileStore.prepare(F)` mints at the end of
  the action that moved something or the camera (`KobinEngine._prepareView`, keyed on the camera's frame, `offRev`,
  `addrEpoch` and the frame count), and a snapshot of another view that finds a source missing returns null
  (`store.want`) until the engine mints it at idle (`prepareWanted`). Measured (the builder's minting-callers probe over a fuzz run and the engine's renders): every `objShift` call that minted came from `TileStore.prepare` — at a zoom's end (291), a render after an action (149), an undo or redo (57), a pan (6), the fuzz's idle step (232) — or from the descent's write (9); none from a read.
- **The camera.** A camera whose frame becomes a co-resident is handed to the cell's resident, same coordinates
  (`_camToResident`, at the frame events and a load); a camera whose frame was deleted goes to a fresh frame at the
  chain the last render read (`_camToLattice`), its cached tiles, table and plates dropped (the id may come back).
- **A deleted subtree leaves the lattice.** `removeFrameSubtree` returns records `{frame, natives, index, at}`, parents
  first, and retires the ids; `insertFrameSubtree` puts them back (`restoreFrame`: a co-resident where a frame holds
  the cell, its resident when that one is empty and childless); the redo deletes again in place (`detachFrames`). The
  op carries each frame's address (`at`, in `format2` too), so a replay takes the frames out again (`dropFrames`,
  which forgets a frame only stale rows named). The op log's drain finds a deleted native in the op's records
  (`aside`, F115), and the eraser's alive test in the undo stack's (`_asideMarks`).
- **Private frames.** `eraseDescent.kidHome` homes a kid in `LevelMap.privateFrame(parent, i, j, key)`: `key` the id
  of the public frame the family's chain hangs from, `parent` the piece's own frame when it is the cell's parent (the
  chain), else the cell's parent; created on first use, a co-resident of whatever holds the cell. `ownTableFor` is the
  one −shift helper (`Document.ownFor`, the cede's kid). The lasso takes a frame whole only when it is not private
  (`_lassoFind`'s `visit`); `_tornUnder` stays for families ceded before C4. Severance: `_cellOffset` by `sameCell`.
- **Version 3** covers a co-resident and a private frame (`latticeNeedsV3`), refused by a version-2 reader.
- **Remote edits.** A remote edit arrives as a reload, whose reset drops the selection: no dead id is left and there
  is no op to repair around (`select.remote.test.js`); a live follow, if one is built, wraps its apply in
  `_opUnder`/`_repairSelection`.
- **Measured** (2026-10-04, at the landing, by the orchestrator: the builder stopped at the weekly limit before its measurement pass; jsdom unless said). Break-checks on an unimported copy, one rule at a time, each red: the group lookup (2 tests), no read mints (1), kids linked all the way down (1, a test added: the builder's linked one level), the camera hand-over (3), a deleted subtree out of the lattice (6), a cede's kid in a private frame (3), the lasso never taking a private frame whole (1), severance by cell (1, an assertion added), each version-3 clause (1, and 1 for a private frame alone, a check added). The city lasso: 16 frames and 0 ids against the oracle's 48 ids. The drop census: frames minted during a drag 0/0/0, left after GC 14/5/4 (the oracle 15/5/5). The list build over the dense drawing out and back (the builder's probes): the SVG path warm 7,051 → 6,872 ms; the raster path cold 6,056 → 6,790 and warm 4,965 → 6,156 ms, the difference in tile bakes. Headless Chromium against the tree before C3/C4 with the same raster code, one run each, load 1.7–3.1: scenario 1's paper 173 | 264 → 100 | 0 ms and its worst frame 865 | 876 → 821 | 645 ms; scenarios 3 and 4 no paper and no stale draw on either tree; the round trip's ink hashes identical at all four states. **Not clean:** the tile fuzz at 200 plain and 200 C3/C4 seeds finds 11 walks where a native is drawn differently from the oracle, 3 of them new with C3c/C4 and 8 already on the C3b tree, and the selection fuzz at 50 + 50 one difference of C3b's age (OPEN-FLAGS F138; seed 131 traced to a replay that brings back an undone cede under a private frame id GC freed). Nothing in Kobin's Chrome.
- **Reviewed** (R-MODEL-C34 and C34b, 2026-10-04/06, jsdom unless said). F138 closed: four live defects fixed with tests
  red before (a subtree delete's events carry the root's address; a drop lists its members at the press; a private frame
  never takes nor keeps a cell from a public one; a load adds "0" only to an empty lattice), every other difference named
  and counted in the fuzzes, each exception break-checked red (OPEN-FLAGS F138). `_prepareView`'s key counts frame GC's
  forgets: a forget and a mint between two renders left the frame count as it was and the view unprepared
  (`model.pureRead`, red before). The list build's slower tile bakes are not reproduced: the zoom out and back on the
  dense drawing, raster path, 3 runs × 3 passes per tree at load 0.1–2.1, 3,171 → 3,284 ms a pass (+3.6 %), its one
  `_bakeUp` 2,920 → 3,012 ms, inside the runs' 2,314–3,973 ms spread; `sameCell`'s 1,413 calls 1 ms. City lasso 16 frames,
  0 ids, 12 ms; the census and seed 777's frames as above; the 5,000-native delete 588–642 ms raster, 1,716–1,758 SVG,
  its undo 697–719 / 2,862–3,075 (load 2.1); the drop's `setBatch` wrap no faster at 2,000 natives (211–387 vs
  209–385 ms). Final runs: the tile fuzz 500 + 500 TILE; the selection fuzz 200 + 200 green (16,000 checks, 3,188
  selections, `held` 41); the quick suite 2,210 passed, 0 failed, 12 skipped; `test:erase` 303 passed, 1 skipped;
  typecheck 0; lint 0 errors. Headless Chromium against the landed tree (59f0a76): scenario 4's ink after the lasso and
  after the drop identical (hashes equal, 2 runs a tree), the round trip's identical at every state.
  Frame GC forgets an empty picture source `_prepareView` minted at an undo's or a redo's end (a
  drop's end runs the same order, not measured), and the next render mints it again: 1 frame, 2 tile bakes, 1 plate drop a step, the same before C3/C4; a keep rule is a
  design question. Nothing in Kobin's Chrome.
