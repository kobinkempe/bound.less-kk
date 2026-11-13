# The compact lattice — runs of empty levels (OPEN-FLAGS F199, F202)

2026-11-12. Kobin: "implement your suggestion for F199 and F202, which should remove the memory wall. That would let
us get to 10^13 levels, right?" The answer given then: partly. Runs remove the memory wall, the `Map` cap and the
export cap, but the walks a render makes, the pictures derived far below their ink and the cede of a far erase are
each still a level at a time, and each needs the same treatment. This is the design for all of it. What it changes
and what it leaves are in "Stages" and "Not in this round".

## What is stored today, and why it grows

A frame is a lattice cell (`LevelMap`, the frame-lattice bible). Every frame from the root to the camera, and to
every frame holding ink, is a record: about 465 bytes in Chrome. Frame GC (F94) forgets a frame only when it holds
nothing and contains nothing, so a chain to a deep camera or to deep ink stays whole. Measured
(`infinite-zoom-audit-2026-11-11.md`, "Beyond 10,000"): 1.88 million frames took 1.3–2.4 GB; V8's `Map` holds at most
2²⁴ entries; at 1,000,000 levels every render walked the chain (10–15 s a crossing); the cloud manifest holds the whole
lattice and Firestore refused it at 12,457 frames (F199).

## The shape of a deep chain

A zoom without a pan picks the same cell at every level once the anchor's digits run out. The 1,000-level chain of
the F196 tests was cell (1638, 0) all the way down. A pan changes the cell at one level, then the zoom settles on a
cell again. So a deep chain is a few levels of different cells, then long stretches of one cell. A stretch holds
no information except its length. A chain whose cell changes at every level cannot be compressed: that is a pan a
level, a record a level, and it stays a record a level.

## The representation: a run

A frame may carry `run: { n, i, j }`: between it and its `parent` lie n levels, each the cell (i, j) of the level
above. Its `depth` is `parent.depth + n + 1`; its own `cell` is its cell in the lowest of those levels. Those n
levels are **run levels**: no record, no id.

The invariant that makes this safe (checked at every fold):
- a run level holds no ink and contains only the next level;
- no frame is in its ring (the eight cells around it at its depth), so no ink reaches it from beside (invariant 2:
  ink never reaches past its frame's neighbours, `REACH`);
- it has no co-resident, no shift, no private frame, and was never moved;
- its cell is not on its parent's edge (|i|, |j| ≤ R/2 − 2), so its picture comes from the level above alone.

So every level of a run derives its picture from the one above by the same function. That is what lets a run be
stepped instead of walked.

`frames` holds frames only, so `frames.size` is no longer a count of levels. The caches that key on
`addrEpoch|frames.size` to see a mint key on a new `latticeSeq` instead, which every mint, forget, fold and unfold
bumps.

## Folding and unfolding

**Fold.** Frame GC gets a second rule. A candidate that holds nothing and that nothing keeps (the camera's frame and
its trail, history, the selection, the source frames, as F94 already says) is forgotten when it contains no frame,
as now. When it contains exactly one frame and meets the invariant above, it joins that frame's run (the kid's run
cell must be its cell, or the kid has none). Its tiles go (`forgetFrame`). The camera's ancestors are no longer kept
whole: the camera's frame and its trail are, and the levels above them fold. A load folds what qualifies at the
host's sweep (`sweepFrames`).

**Unfold.** A run level becomes a frame when something needs it:
- the camera crosses up into it;
- a mint under it: `cellChild` at another cell, or a `neighbour` through it;
- an id names it (`ensureId`);
- a structural edit reaches it: a move's top three levels, a co-resident join, a private frame, a restored subtree.

Unfolding level m splits the run in two around the new frame. Every structural operation that exists today works on
frames only, and unfolds first.

**Mint in bulk.** `ensureSpine(N)`, `frameAtChain` over a stretch of one cell, and a moved object's unmoved chain
(`objShift`: 880,000 frames in the F202 test) make a run, not a frame a level.

## Ids

A frame's id is chosen when it is minted and never changes; a run level has none until it is unfolded. A child
minted in its parent's own cell (a stretch) is named by a new rule, from the parent's id in O(1):
- `h<code(T)>:i,j` (one level below T) has the child `s<code(T)>:i,j*2`;
- `s<code(T)>:i,j*k` has the child `s<code(T)>:i,j*(k+1)`;
- a spine frame keeps `String(depth)`.

So the frame k levels down a stretch is named without walking it, and unfolding level m of a run is O(1) at any depth.
An id already taken gets `#n`, as now. An empty frame folded and unfolded again may come back under another id. That
is safe because nothing that holds ink, or that history, the camera or the selection names, is ever folded. The
caches keyed on the old id are dropped at the fold. Saved ids are kept as they are.

## Walks: a run is stepped by the per-level rule until its numbers stop changing

Every walk over a chain is a loop of one step a level. Each step is a pure function of what the loop carries: a point
mapped up or down, a tile phase, a frame factor, a placement and scale in `nearWalk`, a down source's scale. On a run
the same step is applied a level at a time until the carried state repeats bit for bit, or the run ends. From there,
every level of the run gives the same numbers. The result is the per-level loop's, bit for bit, by construction.

It stops early because floats saturate:
- up, a point converges to the run's fixed point in about five levels (R = 2¹², a 53-bit mantissa);
- down, a point leaves it and reaches ±∞ within about 90 levels, or sits exactly on it;
- a scale underflows to 0 within about 90.

So a run costs at most about a hundred steps, whatever its length.

The walks, by where they live:
- **LevelMap:** `framePath` / `_buildPath` and `floatPath` (each entry of a path stands for its frame's own level and
  its run); `mapPointF`; `mapperObj`; `frameFactor`; `projectLoops`; `projectF` and `phaseThrough`; `pointsUpChain` /
  `rectUpChain` / `rectsUp`; `nearWalk`; `pathFrameAt`; `chainFrom` (cells as runs); `frameAtChain` and
  `peekAtChain`; `objShift`, `frameShifted` and `displaceFrame` (digits added to a run-length chain: a move's digits
  touch its top few levels, and a run below is copied whole); `_rebuildSpine` and `ensureSpine`; `_ancestors`,
  `isAncestor` and `commonAncestor` (frames only).
- **TileStore:** `chainSeq`; `_chainMemo` / `_upTo`; `_bakeUp` through a run (below); `_nb` (the virtual frame
  beside a run level is keyed on that level); `_downSources` through `nearWalk`.
- **Elsewhere:** `KobinEngine._camToLattice` (the camera's chain kept as runs); frame GC's keep set (frames only);
  the scene worker's `FrameTable` (`_up` and its offsets step a run).

A carry never runs through a run: its cell is not on an edge.

## Pictures through a run

An up tile below a run is derived from the tile above it, a level at a time (`_bakeUp` → `_upPiecesOver` → the
parent's tile (0, 0)). A run level holds nothing, has an empty ring and is not on an edge, so its tile (0, 0) is one
`deriveStep` through the run's cell from the level above's tile (0, 0): the same function at every level. The store
derives from the top of the run until a level's pieces equal the level above's, number for number. Every level
below, to the end of the run, has that tile. The run keeps it, keyed on the top's tile and its `chainSeq`, and the
bottom frame takes its own step from it.

Equal pieces are what a zoom into one point gives: the ink there either covers the square, misses it, or is an edge
through the run's fixed point, which maps to itself. Where pieces never repeat (an edge that drifts out of the square
takes a few levels), the derivation runs until they do or the run ends. Down tiles change nothing: the frames below
are reached through `nearWalk`, which steps the run.

## Saving

**Local (IndexedDB and the .json export).** `serialize()` writes `run: [n, i, j]` on a frame that has one. A lattice
with a run is written as version 5, which a version-4 build refuses as "saved by a newer version", as v3 and v4 did.
A lattice without one is written as before. A load reads it. An older save loads as it is, and the sweep folds it.
Autosave rewrites the lattice at each save; with runs that is the frames, not the depth.

**Cloud (F199).** With runs the lattice no longer grows with depth. The manifest also lists every inked frame, though
(`frames` and `frameIds`, about 120 bytes each), so a canvas with ink at thousands of levels still passes Firestore's
1 MiB cap. When the manifest would pass 512 KB, its `crossings`, `frameIds` and `frames` go into an index chunk,
gzipped in parts as the log's chunks are. The manifest keeps `index: { chunk, parts, bytes }`, and a pull reads the
index first. A smaller canvas is written as before, so the deployed build reads it; an indexed one it refuses (as
built: a stub in `frames`, not the version, since that build checks the version only after the pull is written).
Whether this ships is Kobin's deploy decision.

## Not in this round: an erase far below the object it cuts

An erase d levels below the object it cuts cedes a piece a level (F196: 8 levels a job). Those pieces hold ink, so
they are frames, not run levels. Measured at 1,000 levels: 10 s of background jobs. At 1,000,000 levels it would be
125,000 jobs and a million frames. Inside a run the pieces are all the same square less the next level's window, so
one record could stand for them. That would be a new kind of native that holds a run of levels, and it reaches the
document, the tiles, the family check, selection, undo and the save. It is Kobin's decision whether to:
- (a) build that record;
- (b) have an eraser cut only objects within some number of levels above it;
- (c) leave it as it is.

## Stages, and how each is checked

1. **LevelMap.** Runs, fold and unfold, ids, every walk. Check: a lattice with runs answers every query bit for bit
   as the same lattice with a frame at every level, on random deep lattices (20,000+ levels, branches, co-residents
   above the runs, every pair); serialize and load round trip; old saves load. Folding is called only by the tests.
2. **The tiles, the scene worker, the engine's callers.** Check: tiles through a run equal tiles through frames, bit
   for bit, at depths where a frame a level is still possible (a few thousand).
3. **Folding on.** GC and load fold; `ensureSpine` and `frameAtChain` make runs. Check: every suite; the deep tests
   at 10⁶ and 10⁹ levels in jsdom; then the app's built-in pane (local saves) at 10⁶, 10⁹, 10¹² and 10¹³ levels. At
   each: jump, render, cross, draw, select, move, save, reload, with memory and the long tasks.
4. **F199.** The manifest's index chunk. Check: a pull of a canvas with an index, and of one without, in the
   jsdom cloud suites. (Built: "Stage 4, as built" below.)
5. **Docs, all suites, then ask to commit.** Deploy is Kobin's.

## Stage 1, as built (2026-11-12, jsdom, uncommitted)

`LevelMap` holds runs; folding is called only by tests until stage 3, and a lattice that has never had a run takes
none of the new paths (`_anyRuns`), so the app is unchanged except for two things that start now: a frame minted in
its parent's own cell is named down the stretch, and a save holding such a name is version 5.
- **The invariant is checked in O(1).** A run cell is never on its parent's edge, so the ring of every level of a run
  lies inside its parent: a run is valid when its parent's group has no other kid at the run's cell or the eight around
  it. A frame added (`_addFrame`) or moved (`_take`) into such a cell unfolds the run's top level there
  (`_clearAround`), and a join of two groups does so for the runs it brings beside each other (`_linkKids`).
- **Names.** Stretch names are given only in cells a run may hold (|i|, |j| ≤ R/2 − 2), so a chain along an edge keeps
  `h` names. `ensureId` unfolds a level under the id it is asked for, so a folded frame named before this (a path id,
  an `h` name) comes back as itself. A stretch name is resolved from the stretch's top (`h<T>:i,j`), else from T, else
  from the run whose levels it names, and its missing levels are re-minted.
- **Bulk mints** (`ensureSpine` past the bottom, a chain walked with minting) make a frame a level until stage 3 sets
  `bulkRuns`.
- **Walks.** `_buildPath` is one loop (the deeper end climbs, both at equal depth); `floatPath` cuts the run levels its
  side hop covers (`upCut`, `downCut`); a path's steps are compiled once (`_pathOps`) for points, mappers, loops, tile
  phases and the frame factor; `nearWalk` places a kid through its run by the per-level recurrences and skips once they
  repeat; `objShift`, `frameShifted` and `displaceFrame` add their digits to the chain as runs (`chainSegs`,
  `addDigitsSegs`, `_walkSegs`); `shiftAt`'s digits are sparse. A drag's start unfolds the level it is measured at and
  the three it re-addresses.
- **Checked:** `lattice.runs.test.js` compares a lattice folded from a frame a level with that lattice, number for
  number, on 400- and 20,000-level stretches with branches, an edge stretch, co-residents and a spine run.

## Stage 2, so far (2026-11-12, jsdom, uncommitted)

Kobin chose exact runs only: no "forgetful stretches" (rewriting a path through empty space as one run).
- **Move tables by depth.** An object's table (`geometry/offsets.js`) is a sparse array by depth below its home, and
  every loop over it now visits its depths, not its length. A depth past an array's last index (2³² − 2, a move made
  4.3 billion levels below the home) is a plain key `length` does not count; `put` keeps such a table's length at 64
  or more so the loops read its keys. `offsets.deep.test.js`: depths to 10¹³, and a move far below the home has a
  shallow move's remainder and digits, shifted.
- **Caches** that keyed on `addrEpoch|frames.size` key on `addrEpoch|latticeSeq`: a fold, an unfold, or a forget and
  a mint between two reads change the frame count by nothing.
- **`nearWalk`'s callers** read the run-level handle only through `rectsUp`: nothing to change.
- **The camera's fallback chain** (`KobinEngine._camToLattice`) is kept as runs (`chainSegs`), and `frameAtChain` takes
  runs (RUN-6: a deleted frame 3,000 levels down comes back as one frame and a run).
- **Found: a hand zoom makes no runs as the camera stands.** `Camera.zoomFactorAt` re-derives the zoom point from its
  rounded pan at every step, and that rounding (about 2⁻³⁷ of a unit) is magnified 4,096 times a level, so it picks
  the cell about four levels down. Measured over 40 levels (`__review__/zoom-chain.probe.js`, untracked): wheel steps
  of 100 and 120 and trackpad-sized steps, at the screen's centre and off it, changed cell at 29 of 29 levels; zooms
  by exact factors of 2 settled on one cell from level 6. A camera that holds the zoom point exactly while the cursor
  stays still, rounds a new one to a power of two under a quarter pixel (at most 1/8 px), and maps it exactly at a
  crossing settled on one cell from level 3 in every one of those zooms; a cursor drifting a pixel every 30 steps
  settled too, and a one-pixel move every five levels cost one extra cell a move. Kobin (2026-11-12) left the camera
  as it is: runs come from jumps, and a hand zoom keeps a frame a level ("it would take a very long time to manually
  scroll multiple million levels").
- **An eraser far below an object** cedes a piece a level between, with no limit on how far up it reaches. Kobin
  (2026-11-12): leave it as it is.
- **The descent** cedes a piece a level, so it unfolds the run levels it is about to cross (`unfoldLevels`, in the
  job's lattice copy; the engine merges them back by id).
- **The plate map** (`raster/level.js` `mapCell`) adds a run's offsets as one geometric sum and skips a run of the
  cell (0, 0). A run of any other cell moves the window away from every boundary, so past a few levels the index is
  no plate a store holds; past 2^(2^20) plates it maps to nothing rather than build the number. `coarser` through a
  run lands in the frame above it, where the per-level lattice gives a run level: the same picture.
- **The tiles** (`TileStore`) take a run's levels as virtual frames, as they already took a cell no frame holds:
  "K^k" is the level k above frame K, and K's parent there is "K^1". A run level's tile (0, 0) is baked from the
  run's top until two levels' pieces are equal number for number (the derivation reads only the tile above it,
  `deriveStep`'s frame argument being a cache key); a level below is one bake from those pieces. The chain walks
  (`chainSeq`, the held adds' walks, `_upVia`, `_mapRect`) step over a run. A footprint below a run is taken at the
  run's top cell (`placementModel.frameFootprint`, the tiles' frame events).
- **The scene worker** (`sceneIndex.js` `FrameTable`). A record carries its run (`rn` levels in cell `rx, ry`); a
  position on a chain is a record and the run levels above it. `_up` steps a run until its scale and offset repeat
  (the scale is 0 after 90 levels, the offset a fixed point in a few); `_across` walks two chains in stretches where
  both cells hold, with the per-level walk's cap of 4,097 levels, and Horner steps a stretch until the offset repeats.
  A batch re-parents frames without moving them: `_samePlace` follows the old and new chains cell by cell to a frame
  they share, so a fold or an unfold is not a move. Frames an unfold makes join the pre-batch tree where the run had
  them (`_unfoldOld`), so the static frame a move is measured from stays a level above the moved frame, as with a frame
  a level; without it the move re-anchored its scene 600 levels up. A scene anchored in a frame that folds away goes
  to the frame whose run took its level (`foldInto`); a gone frame is never re-anchored past a run (to its ink's home
  instead); a scene with no static frame this side of a run moves whole when one moved frame carries all of it, else
  its members are filed again. Re-anchoring 600 levels up made every reach 0 and hung the worker (F203: bands kept
  finite). RUN-8 checks the maps bit for bit and the scene index's output against the frame-a-level lattice's.
- **Found for the depth limit:** the scene index's log widths are absolute, `log2(w) − 12·depth`, one double: their
  resolution is 2⁻⁶ octave at 10¹³ levels and a whole octave at 12·depth = 2⁵³ (about 7.5×10¹⁴ levels), where the
  16× zoom spread can no longer be told.

## Stage 3, so far (2026-11-12, jsdom, uncommitted)

- **Frame GC folds** (`frameGc.collectFrames`): a candidate that holds nothing and contains one frame is offered to
  `LevelMap.fold`, which checks the invariant; one that contains none is forgotten, as before. Kept: the camera's frame,
  its trail and the selection's frames; history's and the stage's source frames, as before. The camera's ancestors are
  not kept: they fold, and a crossing out unfolds the level it enters (`ensureParentEdge`). A fold is cleaned up as a
  forget (the tiles, the stage's cells, the plates) and logged as one; the next write's header lattice has the run.
- **One knob:** `LevelMap.bulkRuns` is the shortest stretch a bulk mint makes one frame and a run of (`true`: 2), and
  a lattice without it is a frame a level that GC never folds. The engine sets 64: a jump far down is a run, a chain of
  a few levels stays a frame a level (many callers and tests read `spineAt` on short chains).
- **The depth limit:** `frameLattice.MAX_DEPTH`, 2⁵³ − 1 (`Number.MAX_SAFE_INTEGER`). Past it `depth + 1 === depth`.
  The camera at that depth stops a zoom in at the crossing threshold (inScale 256), and at its negative stops a zoom out
  at 1/32; a loaded state past the threshold is scaled about the view's centre instead of crossed.
- **The scene index's base depth** (`SceneIndex.base`, `_depth`): its widths are log₂ w − 12 a level, and at 2⁵³ levels
  12 · depth has a 16-octave step, so every stroke there had one width. Depth is measured from the first depth the
  index sees when that is 2³² levels or more from 0, else from 0 (every file before runs, unchanged), and the base is
  saved with the state (persist keeps it). From 3×10¹⁵ levels off the base the bucket keys pass 2⁵³, where
  `k + 1 === k`: the walks over them end there (`nextKey`) rather than spin, as F203's band loop did.
- **Checked** (jsdom): `lattice.runs.deep.test.js` at 10⁶, 10⁹ and 2⁵³ − 2 levels: jump, render, a crossing each way,
  a stroke, a lasso, a drag, a save and a load, each under 40 ms, the lattice 4 frames; at 2⁵³ − 1 the zoom stops and
  ink drawn there saves and loads. `frame.gc.test.js` G16–G17. Suites that assumed a frame a level now read runs (a
  test's exact chain map, the model fuzz's places) or keep their reference engine a frame a level. The base depth:
  `sceneIndex.test.js` (at 2⁵³ − 1 a stroke 32× thinner is its own scene, saved and restored; ink at the root and at
  2⁵³ − 1 in one index is filed and the batch ends) and RUN-D (the engine's list at 2⁵³ − 1 is the one at depth 1, its
  base kept by the file). Break-checked: base 0 → both fail; without `nextKey` the root-and-limit test hangs.
- **In the app** (2026-11-12, the desktop app's Chromium 156 pane, local saves, a scratch canvas binned after): at
  2⁵³ − 1 levels the jump took 10 ms (2 frames), the zoom stopped at inScale 256 (10^32,537,245,831,191,544×), and
  a pen stroke, a partial erase with undo and redo, a lasso, a drag, a crossing each way, a save and a reload all
  worked, the scene list too (OPEN-FLAGS F202; the audit's "At the depth limit").

## Stage 4, as built (2026-11-12, jsdom, uncommitted): F199

- **The index chunk.** When a push's `crossings`, `frameIds` and `frames` would pass 512 KB of JSON
  (`canvasSync.INDEX_FROM`), they go into one chunk of kind 3 (`store2.packIndexChunk`), gzipped and split into
  700 KiB parts like the others, and the manifest keeps `index: {chunk, parts, bytes}` with `crossings` and `frameIds`
  empty. An index whose lattice, ids and frame records are unchanged is kept, so a push that uploads nothing (a
  rename) keeps the head. A smaller canvas is written exactly as before.
- **Every reader expands first** (`cloudExpandManifest`): the pull, the push (the copy it plans against, the copy in
  its transaction, its sweep), the delete, and the open decision when it reads the frames (a torn push's intent, a
  copy with no base). `chunksOf` and `chunkNames` name the index chunk.
- **The deployed build.** It pulls every entry of `frames` and checks no version before it writes the pull into the
  browser, so an indexed manifest with empty `frames` would be pulled as an empty canvas, and a stroke there would push
  the emptiness back over the cloud copy. An indexed manifest's `frames` is one entry naming a part that does not
  exist: the deployed build's pull stops at it with "missing part", having written nothing. Its pushes were already
  refused there (its base is not the head).
- **Checked** (jsdom): `canvasSync.push.test.js` "F199", with the fake Firestore refusing a document over 1 MiB
  (`fake.maxDocBytes`): a 20,000-frame lattice saves and pulls back whole, a changed frame takes a new index and the
  old one's part goes, a rename keeps the index and the head, a lattice that shrinks goes back to the old form, a
  second device pulls, draws and pushes and the first fast-forwards, and a delete takes every part. Break-checked.

## Where depth gives out after this

- Measured beside the runs: a chain whose cell changes at every level (a pan a level) is a frame a level. As the
  camera stands, a hand zoom is such a chain (stage 2, above).
- The scale bar steps from about 10¹³ levels (display only).
- The scene list's widths are exact near its base depth. Ink far from it (a canvas drawn near the top and also
  10¹⁴ levels down, which only a jump can reach) has its widths rounded, a quarter octave at 10¹⁴ levels off and
  16 octaves at 2⁵³, so the list groups and frames that ink coarsely.
- Depth itself stops at 2⁵³ ≈ 9×10¹⁵, where `depth + 1 === depth`. From 1.1: past it
  a depth is base-10¹⁵ limbs, as many as it needs, and the camera has no stop (`depth-overflow-design-2026-11-13.md`).
