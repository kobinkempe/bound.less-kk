# bound.less — the design

An infinite-zoom vector drawing surface. Zoom in as far as you like; the ink you
drew stays exactly where you drew it, at whatever scale you drew it, and stays
exact when you erase it, move it, or save it.

This is the one document to read. The design bibles it was distilled from are in
`docs/reference/` and remain the authority on their own subjects — but nothing
here depends on having read them.

---

## 1. The problem, and the one decision that follows from it

Zoom in far enough and float64 gives out. A pan of *D* units at one depth is
*D × 4096* one depth finer; a measured session put the view at 2.1e17 units,
where a double resolves 32 units and pen input visibly snapped to a grid. SVG
and Skia give out sooner still — they rasterise in float32.

**So nothing is stored in one global coordinate system.** Space is divided into
a lattice of cells; every object is stored in the cell it was drawn in, in that
cell's own small coordinates; and everything shown at any other depth is
*derived*, never stored.

Every consequence in this document falls out of that.

### The five constants (`src/engine/frameLattice.js`)

| | value | |
|---|---|---|
| `BASE` | 1/16 | 2⁻⁴ |
| `ENTER` | 256 | 2⁸ — in-frame zoom crosses **up** past this |
| `EXIT` | 1/32 | 2⁻⁵ — …and **down** below this (2× hysteresis) |
| `R` | 4096 | `ENTER/BASE`, the crossing ratio |
| `W` | 131072 | 2¹⁷ — a frame, and a cache tile, in its own units |
| `G` | 32 | `W/R` — a child cell, in **parent** units |

Every one is a power of two, so scaling across a level moves only a float
exponent and spends no mantissa bit. The pre-lattice values (3000, 38400) were
not commensurate — 38400/3000 = 12.8 is not representable at all, so every cell
origin in that build was already slightly wrong.

### The two invariants everything rests on

1. **A screen is never wider than a frame.** Holds unaided to 4,096 px.
2. **An object never extends past its frame's immediate neighbours.** This is the
   load-bearing one. It makes the lasso's tree prune sound, it makes the ring
   pickup complete, and it bounds every neighbourhood query in the engine.

What keeps (2) true: **D9 promotion** — an over-wide native is promoted to its
parent level at pen-up, dividing its coordinates by `R`, which is a change of
*units* and not a loss of precision — and the fact that **no move rewrites a
stored coordinate** (§8: a move is an address and a table), so stored bits stay
where they were drawn, within the cell ± REACH. `_normalizeHome`, which walked an
object whose centre a move had carried past its cell into the neighbour by whole
frames, went with A1 C2 (2026-09-29). Break the promotion and things start
silently disappearing rather than merely being slow.

---

## 2. The four structures, and what each one owns

| | what it is | owner |
|---|---|---|
| **Frame** | a cell of the lattice. Belongs to **space**. An object's address and the spatial index. Frames cannot overlap, so "which frame am I in" is a division, not a search. A frame **never cuts geometry**; it only decides which objects are looked at. | `LevelMap.js` |
| **Tile** | where an object is clipped, and therefore where a curve may be frozen to a line. Belongs to **the object**: carried as a phase `(px, py)` in `[0, W)`, two numbers, surviving every move for free, because re-homing changes local coordinates by exactly one frame and `W mod W` is zero. Same *size* as a frame, a different *grid*. | `frameLattice.js`, `geometry/freeze.js` |
| **Cache tile** | the render cache's own frame-aligned square. Decides how much work one bake covers, and nothing else. Clips arcs, which is exact. (Until 2026-09-07 it also marked every end it made, `seamA`/`seamB`, so the level below could not freeze on an edge it invented; the one-radius freeze's endpoint guard refuses such an edge on its own, and the marks are gone.) | `TileStore.js` |
| **Object** | a native, stored in one frame. Its id is its creation order *and* its z-order. A logical object may be several natives across several frames sharing one `editId` — which is what an erase leaves when it cedes a tile downward. | `Document.js` |

The frame, the tile and the cache tile are all `W` across and were three near-identical APIs with two phase conventions. Since 2026-09-07 they are one value type, `TileGrid` (`frameLattice.js`): the object's grid is `TileGrid.at(o.tile)`, the cache's is `TileGrid.CACHE`, and a frame's own square is that grid's `(0, 0)`. `range` is the half-open rule (a rect ending on a boundary belongs below — what the chop and the cede cut on), `touching` the closed one the cache reads by; each keeps its callers' arithmetic to the bit, because which squares a cache reads and where an object's tiles fall are both things a saved drawing's deep picture depends on.

---

## 3. The object model

Three types, and the pipeline is one-way:

- **stroke** — only between pointer-down and the moment its perimeter resolves,
  usually one frame. Carries `pts` (pen samples), `lwFrame` (width in frame
  units), `_pen` (the live biarc chain).
- **shape** — what it becomes. `loops`, closed chains of arcs and lines, plus
  `w`, the pen that drew it. **`pts` and `lwFrame` are deleted.** The shape is
  the single source of truth; there is no centerline left to keep in agreement
  with it.
- **fill** — polygon rings. A native fill only exists in drawings saved before
  the arc pipeline, and only until something cuts one
  (`Document.fillToShapeById` promotes it at that moment). Converting at load was
  tried and reverted: one recorded drawing carries a 1.8-million-vertex fill, and
  converting it cost more than the rest of the load put together.

A piece of a loop reads as `{line: true, A, B}` or
`{line: false, C, r, a0, sweep, A, B}`. **`A` and `B` are carried explicitly**,
so consecutive pieces share their endpoints bit for bit. That is the invariant
the whole representation rests on, and it is why a fill never leaks at a seam.

What a stored loop **is**, since 2026-09-08, is one `Float64Array` — the same
numbers the file holds (§13's grammar: `ax, ay`, then a record per piece) with a
`Uint32Array` of record offsets — wrapped as a `Loop` (`geometry/loop.js`). A
piece read (`at(i)`, iteration, `map`) is a transient view shaped as above;
nothing retains a view and nothing writes through one — a move is `translate`,
a new Loop. Builders (the boolean, the freeze, the pen, the transforms) still
produce plain piece arrays, and the storage boundaries (`Document`, `TileStore`)
flatten them with `Loop.from`; readers changed only where they indexed
(`loop.at(i)`, polyfilled for Node 14 in `src/polyfills.js`). Measured on the
12,844-object canvas: an arc piece as an object was 344 B for 56 B of numbers;
the live heap after load went from 721 MB to 453 MB in jsdom (geometry 51 MB,
the view's tiles 14 MB), and in Chrome from 660 MB to 260 MB at load.

---

## 4. Why arcs

The offset of a circular arc is a concentric arc: same centre, radius ± the pen.
Exact, closed form, no fitting. So:

- both edges of a stroke are exact, with no fit tolerance;
- consecutive offsets share an endpoint computed once per vertex, so the rail is
  watertight by construction and there are no round joins to build;
- crossings are circle-circle — one square root, no Newton polish;
- cutting an arc at a crossing is arithmetic on an angle, so both halves share
  the crossing *point* rather than two roundings of it.

A cubic can do none of that. Its exact offset is not a cubic, so both edges had
to be **fitted**, and every question downstream was then asked of an
approximation while burial was judged against the exact centerline. Those two
disagree by the fit error, amplified by 1/sin θ at a shallow crossing. That is
the family F15 and F20 belong to, and it is why the *representation* changed
rather than the tolerances.

A stroke is drawn as **biarcs**: two arcs per sample gap, using the same samples
and the same tangents the cardinal spline has, so it passes through every sample
and leaves it in the same direction. On real strokes that costs about 2.0 arcs
per gap. `BiarcPen` maintains the chain *while drawing* at O(1) per sample — a
new sample only disturbs the last two gaps — and the renderer paints that chain,
so pen-up changes nothing you can see (measured: 233 pixels of 921,600, all
antialiasing).

---

## 5. The bake

At pen-up the perimeter is **resolved**: build both rails and both caps as one
closed chain, cut it at its own self-crossings, throw away the fragments buried
under the pen, restitch the survivors into closed loops. A stroke that retraces itself exactly
(a computed ring drawn past one turn) lays two copies of its boundary on one
circle: those are cut where each other ends and kept once, an all-but-tangent
pair meets at one point, and the sliver of one copy that peels off inside the
other by less than the burial margin is pruned before the restitch (OPEN-FLAGS
F89) — the union has winding 1 everywhere. A stroke whose last sample IS its first is periodic:
its seam gets one tangent (`BiarcPen.closeLoop`), so every rail arc ends on its own circle (the
two one-sided tangents left 4 seam arcs up to 0.039 units off, which the inside test read as two
crossings, F117).

It is a **job with a cursor in it** (`ArcBakeJob`) — eight phases, every one
resumable, stepped in 8 ms slices off the same timer the erase bakes use. It
publishes nothing until it is finished, so a half-resolved perimeter can never be
drawn, stored, or erased against. Slicing is bit-identical to running it in one
go.

> The lesson that took four attempts: **a chunk is only as small as its slowest
> item**, and "item" has to mean the same thing as the work. Fixed counts, chunks
> sized from cheap items and handed expensive ones, unchunked tails, and chunking
> over *loops* when a dense scribble resolves to two loops of three thousand
> pieces — each one overran.

### The freeze — one radius

Every level's tiles are chopped from the level above on the object's own
grid, and a chopped arc that has gone straight becomes a line, for cheapness
and because "the arc will get comically straight anyways". **The test is one
number** (Kobin, 2026-09-06): an arc's bow over a chord c is c²/(8r) and no
chord inside a tile is longer than the tile's diagonal, so an arc whose
radius is at or above `freezeRadius(tol)` — the radius whose bow over the
diagonal is exactly the quarter-pixel tolerance, about 8.8e12 units — is
within the tolerance everywhere in a tile and freezes wherever it is; one
below it stays an arc. A tile is the same size at every level in its own
units and the radius maps down exactly, so it is the same number at every
level, in every cache square, for every fragment of an arc: a nick cannot
change the decision and neighbouring squares cannot disagree. The one guard
is that both ends lie between the lines the chop applied, since a stub beyond
the outermost line was not cut at every line that crosses it. The frozen line
is the chord between the piece's own ends, never a fit, so a neighbour that
has not frozen still meets it exactly.

Until then the test was the chopped piece's own sagitta behind a guard that
grew its box by its bow and required it inside the applied lines — which
every piece cut *on* one of those lines failed by its own bow. Deep arcs were
never frozen, survived to where their centres are 1e16 units away, and were
cut and positioned through those centres: a curved stroke's edge moved a
screen at its fifth crossing (F44).

Two things follow. An arc the gate is about to freeze has its grid cuts found
**in its own chord frame** — the circle written from its chord and its bulge,
h(a) = ((L/2)² − a²)/(d + √(r² − a²)), nothing through the centre — because
those cuts are the ends of its frozen chords and the level below inherits
them; an arc under the gate is cut through its centre, which is at most 8.8e12
away, a thousandth of a unit. And the boolean (section 6) stands in for an
arc by its chord by the **same gate and no other test**: "erasers shouldn't
need to re-calculate a freeze — if it's frozen it's frozen." The only arcs
over the gate that reach it unfrozen are an object's home-level pen arcs,
which no chop has seen.

---

## 6. The boolean (`geometry/arcShape.js`)

`A − B` and `A ∩ B` on two resolved perimeters. Cut both at their crossings and
at their overlaps, classify each fragment by a winding query at its midpoint,
stitch the survivors. **There is no lattice anywhere**, so the result is as
precise as the doubles it is written in, at any depth.

Three things in it are not obvious, and each was a defect first:

- **Coincident boundary has no crossing to find**, and "no crossings" was read as
  "nothing to do here". A second erase down the path of the first generates
  exactly the same arc; `pieceOverlap` finds those stretches and cuts at their
  ends, and a coincident fragment is classified by **orientation**.
- **A nearly straight arc is a line.** A biarc pen emits radii like 4.99e17,
  whose sagitta is thousands of times below one ulp of its own coordinates.
  `straighten()` converts those on the boolean's working copy.
- **Vertex identity is scaled off the overlap**, not off the largest number in
  the room. A level-0 object clipped into a tile five crossings down arrives
  2.4e17 times its own size; a fuzz taken from that welded a result into 871
  pieces in 68 open chains.
- **A cut piece keeps what it was cut from.** The crossings on a line that
  already carries canonical points are found on *that* line (`cutLine`), and
  the fragment inherits `P`–`Q` with new `sa`–`sb`; a cut arc's fragments
  inherit its canonical arc `K` with new positions `ua`–`ub` (`cutArc`), and
  an arc is stood in for by K's chord exactly when K's radius is at or over
  the freeze radius — the chain's own rule (section 5), and no other test. A
  piece without canonical data is its own. Section 7 has why (F43).

Every loop that leaves **closes**. Where the walk cannot close one it is sealed
with a chord and counted (`stats.sealed` / `sealedArea`), because losing a real
stretch of boundary is worse than drawing it straight — but the count is the
health check, and F34 is what it looks like when it goes wrong.

---

## 7. Erasing

An eraser **is** a stroke through the pen pipeline, so the gesture costs nothing
however complex the drawing. When its shape lands it records its **targets** — the
ink under it when it was drawn — and until it is spent it hides exactly those (the
erase rule, below): ink moved under it later, drawn after it, or already baked shows
(Kobin, 2026-09-25). Cutting it out of each target happens later, in workers and in
slices.

**The invariant: an erase never removes more than the eraser swept.**

Two cases, decided by where the gesture was made relative to the target:

- **Cut in place** — the target is at or below the erase level, or there is no
  ancestor chain between them. Project the eraser into the target's frame and
  subtract. The boolean is centred on the **subject**, not the eraser: an eraser
  three crossings above its target arrives 2.7e10 times its own size, and
  centring on that leaves the target out at 1e13, where its own features are
  below the rounding.
- **Cede a tile** — the target is homed *shallower* than the gesture, on an
  ancestor chain. The hole belongs at the level it was drawn at, where it is
  screen-sized. So descend **one crossing at a time**, and at each step cut a
  tile out of the parent and hand its ink to the level below. Ceding straight
  from the target's home to the erase level looks simpler and dies at five
  crossings: the ceded rect is 1.9e-8 units wide at three, 9.1e-12 at four, and
  **exactly zero** at five. And the descent takes each level's ink from the
  render chain's own derived pieces — the tile store's piece for the cache
  square, which becomes the kid bit for bit, its padded window the rect ceded
  — never recomputing it (F42, measured and fixed 2026-09-04): the descent and
  the magnify chain were the same math in two functions, their results
  differed in the last bits at level 2, and every crossing multiplied that by
  4,096 — 1,788 units at level 6, a whole tile at 7, with nothing but straight
  lines involved. At depth the only "same" is the same bits. The same rule
  cuts the parent in its own coordinates and makes the boolean pass what it
  does not cut through by reference: a rounding step anywhere in a parent is
  its whole picture moved four crossings down.

The parent is genuinely **cut**, not left whole with a rect recorded against it.
That removed a per-view re-derive whose cache went stale on the fast zoom path,
232–386 ms renders rebuilding it, and a view-sized pad that was 2 px at one zoom
and 0.19 px at another.

**A cut line remembers the line it was cut from** (F43, built 2026-09-05). A
line piece defined by its two endpoints cannot be cut anywhere without being
redefined everywhere: the new endpoint is a rounded crossing, and every level
below interpolates its own clip vertices from that endpoint, 4,096× per
crossing — a 12-px nick at level 3, 300 px along an edge, emptied the level-8
tile the edge's corner had been zoomed to. So a line piece carries its
**canonical** line, `P`–`Q`, the endpoints it had when it was chopped from its
parent before any erase, beside the stretch of it that survives, `sa`–`sb`.
An erase or a window clip moves `sa`/`sb`; every cut the chain makes below is
computed from `P`/`Q`, and the severed stretch only decides which cuts fall
inside. The canonical line maps down a level exactly as the piece does, and
the same numbers reach every level whether the line was nicked or not.
Measured: the level-8 picture bit-identical after that nick, the edge in the
same place to the last digit (`depth.corner.probe.js`, `erase.depth.test.js`).
**A cut arc remembers the arc it was cut from**, the same way: `K`, the angles
and end points the piece would have at this level had nothing cut it — which
is exactly the piece the chain would have made, re-parametrised at each chop
and re-cut on each window as the chain does — with the surviving stretch as
positions `ua`–`ub` on it. The chop runs on K and trims the chain's fragments
to the piece's stretch; the freeze is the chain's decision on the canonical
fragment, and where it freezes the piece becomes a cut line on that chord;
after every window clip the canonical arc is re-anchored to the fragment the
chain would have clipped. K is never reversed, and a cut arc's own ends stay
the points the erase made: recomputing a point on a circle of radius 1e16
through its centre quantises it by units (F44), while mapping a point down a
level is exact. Measured: all three of Kobin's corner cases bit-identical at
level 8 after a level-3 nick, the edge unmoved to the last digit. The join-arc
case needed one more thing: the boolean used to decide "this arc is flat" by
its own formula, which read 0 for any sweep under ~1e-8, and so chorded an arc
the chain kept, moving the picture one level down by the arc's bulge. Since
the freeze became one radius (section 5) the boolean uses that gate and no
other test, so the two agree everywhere.

### Targets, the rule, the parallel bake and the barriers (2026-09-28)

`review/rebuild/A2-scene.md` §4 is the design; `eraseRule.js`, `erasePipeline.js` and
`eraseWorkerClient.js` are the code.

**Targets are recorded when the mark's shape lands** (`_registerMark`, in the landing's
commit: the plates gain its mask as the live white path goes). First the frames it covers
whole go as containers (below); then every reachable native under its box, below its z,
whose box its eraser's reaches — from the index of every reachable level, plus every moved
native through its table, the box mapped once per home and table (mapped per object, the first
scan over the Magnum Opus's 19,547 moved natives took 300 ms, then 95). The ids go in the mark's
`targets` and the mark in each target's `targetOf`. A frame's index answers a rect off its union
box at once and scans flat past 2^40 units (F127); a mark whose chain leaves its frame sideways
into a ring neighbour cedes down its own chain below that neighbour (F129). **Nothing can move
under a mark before its targets are recorded**: every gesture that moves ink resolves pending
perimeters first, and until the landing the mark's op is on top of the undo stack
(`erase.rule.test.js`, `raster.eraseRule.test.js` (c)).

**The rule** (`eraseRule.underMask`): native `o` is under mark `M`'s mask iff `M` has landed,
`M ∈ o.targetOf`, `M ∉ o.handledBy` and `z(o) < z(M)`. Every piece a cut or a cede mints inherits
its source's `targetOf`, and its `handledBy` plus the cutting mark (`inheritErase`, at the three
mint sites: `eraseReplaceById`, `cede.js` — the one body of `Document.cedeTileById` and the
descent's virtual cede — and `_applyDescent`, which mints the descent's pieces again from the live
target, the worker's copy being as old as the dispatch); a refusal or a graze adds the
mark to `handledBy` (`setHandledById`). So an object dragged across a pending mark, a stroke drawn
over it, and a piece it has cut all show; a piece of a target another mark still owes stays masked
by that one until it cuts it (two marks over one object, the lower cutting first: at no moment does
the ink under the upper show). The mark's z never moves. The raster renderer draws a pending mark as
nothing: the pack sets an item's mask bits from the rule where the boxes meet, in up to 16 slots that
marks share exactly (the core masks a family whole, by all its items' bits, so no family whose box
meets both marks' may hold one and not the other; past 16 the slot it over-hides least, counted as
`maskOverflow`, never white ink), and the core multiplies the family's coverage by (1 − the slot's
coverage), a byte plane. The pick skips a masked target where its mark's ink covers
the point, so a press there takes what shows. The SVG renderer (`?svg`) masks by the same rule (PLAN
§5.8 item 2, B-PYRAMID-3): a landed mark is drawn as nothing, and the group of any member under its mask
takes an SVG `<mask>` of the mark's shape (a family masked whole, as the core masks it), so an object
dragged under the mark shows; a mark not yet landed is ink at its z until it lands. The SVG export and
the `?svg` thumbnails bake every pending mark first (`thumbnails.withSvgEngine` runs `flushErases` in its
copy), so no pending mark reaches a picture.

**What an erase step dirties** (PLAN §5.3 A2-Q2; the scene classifies each event by the mark it
names, `by`, and the rule): a cut or a descent on the mark's lineage, the target's box inside the
mark's and the boxes of the dust it dropped; a refusal over ink, the target's box inside the mark's
(its ink under the mark shows again); a graze or an inkless refusal, nothing; a frame taken whole at
the landing, nothing past the landing's box; the landing and the spend, the mark's box. Measured
(`raster.eraseRule.test.js` (b), plates kept through a bake against a fresh raster): 0 differing
bytes for fills; strokes differ on the outlines of cut arcs, flattened again from their new ends
(≤ 9/255 measured over seven seeds, 16/255 the bound), and within 1.5 px of a mark's edge, until those
cells next render or the mark is spent. Two things reach the edge band without dirt of their own: a
graze that splits two marks' shared slot turns a family's 1 − max(a, b) into (1 − a)(1 − b) where their
edges overlap (36/255 measured), and a family half handled — a piece a mark has cut beside a piece it
still masks — is masked whole, so the cut piece's fringe along the mark's edge loses c − c² of its
coverage (59/255 for near-black ink, node and headless Chromium alike). Both are inside row 3 (b)'s
envelope (R-ERASE, 2026-09-29).

**The bake** (A2 §4.7). The pending marks are a set kept by events, and each mark's lineage (the live
natives with it in `targetOf`) an index. The serial order is marks oldest first, each mark's targets
top-down by (z, id) as they joined. Jobs are dispatched ahead in that order through the raster pool's
`JobQueue` (`eraseWorkerClient.submit`, B-PYRAMID-2b 2026-09-29: `kind: "cut"` at `PRIO.cut` with one worker
kept for cuts while any is pending; a job a worker error lost is requeued once; a job the watchdog took is
refused over the ink — `setHandledById`, a journal reason, `report().erase.counters` — never run inline; inline
only when the pool is broken or there is no worker) and applied strictly in that order through a reorder buffer, so a
parallel bake leaves the inline bake's document, ids, steps and log (three seeds of shuffled
arrivals, `erase.rule.test.js`). A target pending under an earlier mark is not dispatched for a
later one; descents run one at a time; a landed job applies only if its target is unchanged
(`_ver`: a move projected the eraser through another table), the lattice not
re-addressed and the pair still pending, else it is dispatched again; a pair its eraser's box
misses is handled in memory only (no pixel of it is under the mask). The lookahead writes nothing
to the document. A mark with nothing pending is spent, logged `spent`, its box re-rastered, and its
id pruned from its lineage; a live native never names a mark that cannot return (spent, or its redo
branch gone): dropped as it re-enters by an undo, when a new op drops the redo branch that held the
mark, and at a load, so the undo of a finished erase restores the document exactly. `erase.cost.test.js`:
no scan during the bake.

**The bake terminates** (PLAN §5.8 item 3). Each id pending under a mark costs it one step, and a step
its pair survives is tried once more, so a mark's steps past 2 × its supply + 8 — its supply being what
was pending under it at its first step plus every id that arrives pending under it later (another mark's
piece, a source an undo returns, a deleted frame an undo puts back) — can only be a wrong rule: the mark is
aborted, spent with the cuts it made, and reported (`report().erase.counters.aborted`, `status.erase.aborted`,
its journal note, a console error). Measured: with the `handledBy` clause ignored the bake ends within
the budget on the tick through a pool, in `flushErases` and in an inline barrier; the correct rule's steps
never exceed its supply (`erase.rule.test.js`).

**The barriers stay, asynchronous** (A2 §4.11; Kobin: "if an object is baking, you can't even
select it until it is baked"). A tap bakes the pending pairs of the hit object's family and then
picks the point again, so the selection is the piece under the finger (SM-5); a drag's start bakes
those among the selection's members and under its frames, and every pair of a mark homed under a
selected frame (B4); a lasso every pair whose target's drawn box meets the loop's box, wherever its
mark is (H5), and judges the cut-outs. Each target is cut with the earliest mark it is pending under,
round after round, in serial order, until none is left (no cap but the marks' step budgets); the selection
follows the steps to the pieces. A round turns its fill targets into shapes before it dispatches any
pair, so the log reads the same whether its cuts run inline or in workers. Where the cuts are in workers the gesture is parked: a tap selects when they land, a drag
starts from the press and jumps to the finger or, released meanwhile, applies whole, a lasso's loop
stays drawn; after 150 ms the title shows "Finishing the erase…" (`status.erase.finishing`,
`EraseChip.js`); a new press, a tool change, an undo, a deselect or a pinch cancels it (its cuts go on
as the bake's). Where there is no worker the rounds run inline and the gesture completes at once.
Every tap and drag barrier resolves pending perimeters first; a barrier ends by spending the marks
it emptied. `select.eraseBarrier.test.js`, `erase.stack.test.js`.

**One cut is a job** (`eraseJob.js`): the boolean, the removal measured locally, the
graze rule (in place, or the cede's), the components and the dust cull, on loops in
and Loops out — the same function on the main thread and in the raster workers
(`runCut` in `public/raster-worker.js`, esbuild's bundle; `npm run build:worker`, run before start and
build). The pipeline applies each result on the main thread (`_applyCut`), in the serial order above;
where there is no worker (jsdom, an old browser) or the pool is broken the job runs inline, so every
erase suite checks the same geometry. A result that lands
on a mark an undo took is dropped; its target stays pending and the redo cuts it (OPEN-FLAGS
F88). **Undo and redo follow the bake steps across marks**: a barrier bakes out of the marks'
stack order, and a history from before the rule (an older build's log) can hold an older mark's
cut of a newer mark's piece, so each step carries its order and whether it is applied. An erase's undo reverts
its steps and every step of any gesture that consumed what they made, newest first (those are
suspended); a redo re-applies its steps and then any suspended step of an applied gesture whose
source is back (`Document._stepsUndo`/`_stepsRedo`, F118); a reload rebuilds the flags from the
log's order, every kind of step included (a re-key step without it was undone out of order, F128),
and the document. **Only the pen's holder bakes**: a read-only tab or device
shows the store the holder bakes into and waits for the pen, and a closed editor drops a
late worker answer (F96). A mark saved mid-bake resumes on reopen from its `targets` and its
pieces' `handledBy` in their headers, `targetOf` derived at load from every known mark's `targets`
(live, or held by an undone gesture); either ends as an uninterrupted bake. A mark from a file
written before the fields registers once at load by the old rule — the scan under its stepped z,
less the ids its log's bake entries name, whose pieces it has handled — and its `targets` is logged.

**The descent is one job per family** (`eraseDescent.js`, Kobin's design: "invalidate
the whole object, wait till the worker sends the new object shapes back, then swap the
one object/family out for the new generated family"). The target is the only real
object the job reads; every cede is virtual, each level's square ink derived in the
job exactly as the tile store derives it for that one object (`classifyUp`,
`solidQuad`, `deriveStep` on the same numbers), so the kid a cede mints is the store's
piece bit for bit; nothing touches the document until the whole descent has succeeded,
so a refused last link needs no unwinding. The worker gets the target, the eraser and
the lattice (`LevelMap.serialize`) and returns the steps; `_applyDescent` mints the
family with real ids in the order its cedes minted them and records the steps on the
gesture's op. Inline where there is no worker. **A step's kids live in a private frame of
their family** (A1 C4, 2026-09-30): a co-resident (§8) of the chain's frame at the kid's
cell, contained by the frame the ceded piece lives in when that is the cell's parent (the
target's own frame at the first step), flagged `private` with the id of the non-private
frame the family's chain hangs from, made on first use (`LevelMap.privateFrame`); the
remnants stay in the target's frame. So no shared frame holds a family's kid, and the lasso
can take every other frame whole (§10). The frames the job mints on its lattice copy (a kid
is homed by the carry, often a cell over from any frame the engine has visited; its private
frames) come back with the steps and are added to the engine's lattice before a kid is
added; a load mints any frame its natives name (F67).

**Dust is what could not be seen** (Kobin, 2026-09-08). A fragment a cut leaves is
dust when it is narrower than a quarter of a pixel at the zoom the mark was drawn at
(`bakePx`, the mark's pixels per unit, through the frame factor into the subject's
units; `eraseJob.dustBarFor`). Not the pen's hundredth, which culled the slivers a
4 px eraser carves at 561,917× into a stroke drawn at 1× — ink the user shaped. The
cede's own parent cut and a descent's middle link are judged the same way (F112: by the pen,
a round cap 0.3 units past a ceded cell, 1,229 px tall at the erase's zoom, went as dust). A
rect cut with no mark behind it keeps the pen rule.

**The boolean's classifier** was the cost, not the cuts: every fragment of A was
ray-tested against every piece of B and back, so a 641-piece object under an eraser
whose perimeter has 1,205 pieces cost 2.6 s with seven crossings and 2.8 s with none,
twice (the removal measure). `RayIndex` buckets each shape's pieces, per ray
direction, by the extent of their box along the ray's normal; a query visits the
bucket the ray's line falls in and its neighbours, and the answer is `rayCross`'s
own. Measured on the same cuts: 2,630 → 175 ms and 2,377 → 143 ms, results identical.

**An erase covering a frame takes it whole** (2026-09-15; Kobin's rule, the subtree
move's counterpart in §8). At the mark's registration, before its targets are taken, the frames under
the mark's own are walked as the lasso walks them (out from the mark's frame, one hop
at a time, a subtree skipped when its box misses the mark): a frame whose cell plus the
reach its content may have (invariant 2), grown by the flatten's tolerance, lies inside
the mark's ink, and under which nothing is drawn above the mark (`Document.maxZUnder`,
an upper bound kept per frame index: a native drawn since the mark, or a piece a cut
minted, keeps the frame on the per-object path and its kids are judged on their own),
goes whole — its subtree leaves the lattice with its lists (§8, A1 C3), one bake step in the
gesture's op, no cut, O(frames). A native drawn at that cell after the landing goes to a frame of
its own there: it is not a target. Undo puts the subtree back with the rest of the gesture; the op
log carries the natives' geometry and the frames' addresses (`bakeFrames`) because their rows go
with the write. A subtree with no ink is not a step. `move.subtree.test.js` t11–t13, `oplog.test.js`.

### Severance — is the family still one object?

Once a ceded tile is cut out of its parent this is a **graph**, not a walk. Every
native in the family is a node. The only place two of them can meet is the
boundary of a ceded tile: the parent stops exactly at the rect, the child fills
exactly the rect, and they share its perimeter. So there is **one relation** — a
parent piece and a child piece are joined when their ink meets on the same
*stretch* of that perimeter — and the object is severed when the graph is
disconnected.

Contacts are compared in a **normalized perimeter parameter** (`t` in `[0,4)`,
one unit per side), so the parent's measurement in its own units and the child's
in units 4096× finer are the same numbers, and no transform is ever composed
across the crossing.

**A shared stretch, not a shared point.** When an erase finally cuts through to
the edge of a tile, the two pieces it leaves necessarily meet that edge at the
same point — the one the eraser crossed. Accepting that as a join meant an object
never came apart however carefully it was cut (F26).

Severance asks about **geometry, not ancestry**. Re-homing normalizes each member
on its own local coordinates, so two members of one family can settle on
different branches while sitting in exactly the same place; requiring literal
parent-child made one unchanged object report as three. Two kids side by side in
NEIGHBOURING cells (a cede over a cell seam) are compared in one cell's coordinates,
whole frames apart (`_cellOffset`): compared raw they never met, and one blob became
several split along the seam (F124, Kobin's "shattered" report). It compares cells, not
frames: a kid in a private frame (§7's descent, A1 C4) is its cell's.

A member the test **cannot evaluate** — its frame, or a frame one of its possible parents is
homed in, is missing from the lattice — keeps the family's key: "cannot evaluate" is not
"disconnected" (F104). A kid rekeyed away by a lost frame stays behind when its parent moves, a
rectangle left where the hole was.

---

## 8. Moving

A displacement is expanded into lattice **digits**, base `R`. Everything a whole
cell or larger is applied to the member's **address** — it is re-homed into the
cell that many steps along and its geometry is **not touched**, because
neighbouring cells' origins differ by exactly one frame and the same local
coordinates therefore describe the moved object exactly. Only the sub-cell
remainder, smaller than one frame at any depth, reaches geometry.

Every member expands the **same** displacement, so members that share an ancestor
take bit-identical digits there and their relative positions cannot move.
Registration by construction rather than by luck.

That is the whole of a move for a native drawn at the move level or below it.
For an object homed **above** the move — the coarse object whose corner the
detail was drawn against — the sub-cell part of the displacement has nowhere to
go: its coordinates cannot hold a level-5 quarter-pixel, and adding it to them
anyway rounds once at the move level, and the tile chain magnifies that one
rounding by 4,096 per level below while the detail moves by exact digits
(F55, measured 2026-09-05: 3.25 units four levels below a home-level move,
1,229 four levels below a level-1 move; Kobin's "star in a corner", and F35's
mechanism). So **a move never touches a stored coordinate, at any level**
(`geometry/offsets.js`, F41 then F55). The object carries a **displacement
table**, `below[k]` for every depth k at or below its home, in that level's
units, each entry bounded by half a frame and carrying upward in whole frames —
integers; a carry out of the home level is a change of address, the native
re-homed to the neighbour cell with its coordinates untouched. The tiles are
**unmoved space**: nothing about a move enters a bake, and the tile chain runs
on the same bits before and after. Where a moved object's picture is *read
from* is decided at render time: the table's whole-frame digits name the frame
to fetch the pieces from, and its sub-frame remainder is applied at **paint** as
a translation of the derived picture (`piece.res`) and **inverted on every
input** that reaches the object's geometry — an eraser projected into it, a hit
test, a lasso; an input made in the object's own frame names the direction itself,
since both ends are the home (F72). A displacement is **snapped to 2^-10 units at the move level**
before it enters the table — a quarter of a pixel at that level's deepest zoom,
finer at any shallower one; "a user cannot feel this level of detail" — so it is
whole cells from three levels below the move and the paint-time remainder lives
on two levels only. Result, measured (`move.registration.test.js`): the coarse
object's pieces four levels below a move are the same bits in the new frame,
and its gap to the detail drawn there is unchanged to 1e-9.

**A drag writes nothing until its drop** (A1 C2, 2026-09-29). Each pointer event
hands the Stage the displacement from the drag's start (`stage.setDragDelta`): the
selection's natives and everything under its frames are *held*, drawn, hit and
lassoed at their placement plus that delta (`placed`, `placeNative`), and painted
there by the view's plates only when the drag plane does not draw them (`Item.res`;
each change then dirties where they were drawn and where they are). Per event: no
document event, re-home, table, mint or settle (`move.drop.test.js` D1, 40 events).
The **drop** is the one write (`_dropMove`): the arithmetic runs **once per home
frame** — members that share a frame and a picture table take one answer
(`_displaceMember`), and their re-homes are one compaction of the frame's list
(`Document.rehomeManyById`, 56 us a re-home at 2,000 objects, 189 at 8,000;
2026-09-14) — and the selected frames are re-addressed once, first, so a member carried
into a selected frame's start cell is placed against where that frame went (`move.drop.test.js` D2b); the members are
listed at the press, before it, so a native under a selected frame moves with it once even when the re-address carries
its frame out from under the selected one (D2c, F138 seed 70); with the hold's
release it is one Stage commit, and its patch has a user's
budget, as an undo's has. A cancel (a pinch, an undo mid-drag, a deselect) writes
nothing: the document is as it was at the press. The undo entry of a move is the
address and the table either side, `{id, dx, dy, from, to, belowBefore,
belowAfter}` (an op from before C2 can carry `base`/`after` geometry, kept for its
replay and inverse). Undo is byte-exact on the stored natives (`move.below.test.js`
MB-5).

Kobin's words for it: "the move is only handled locally" — moving a level-6
object at level 8 "would affect level 7 but shouldn't make a change to the way
the tile is calculated for level 8. And it would not affect level 6 at all";
"each move should just move grandchild/descendant tiles to a new frame,
arithmetically." Before F41 the drag added the displacement straight into the
home coordinates, and three crossings down a screen pixel is a hundredth of a
float64 step of a coordinate 60,000 units from its origin: the object moved in
127 px jumps at 254×. F41 (2026-09-04) put the table in and applied it once
inside the hop; F55 (2026-09-05) took it out of the hop.

The old build translated by `displacement × R^k`. At five levels of separation
that rewrote a member's coordinates to 7.3e18 and destroyed 82.9% of its area —
the object did not move wrong, **it came apart** (F25/F28).

The whole move is computed from where the drag *started*, not from the previous
event, so a slow drag and a fast one apply the same arithmetic to the same
numbers — and since C2 it is computed once, at the drop, against the lattice as it
stood at the press.

**A subtree moves as frames** (2026-09-15; the design and its build record in
`.claude/SUBTREE-O1-PLAN.md`). A selected frame is one entry of the selection, and
its drag touches no object. A frame's id is its birth chain and never changes, but
its address — parent, cell, edge, centre — is mutable (`LevelMap.readdress`,
`readdressMany`), so re-addressing the root and its descendants within three levels
of the camera moves every native under them through the parent pointer. The targets
come from the addresses at the drag's start (`subtreeStart`, `moveSubtreeTargets`,
read at the drop against the lattice as it stood at the press) by `displaceFrame`'s
arithmetic, frame for frame, so a native lands exactly where the per-object path would
put it — registration by construction, proved native for native (`move.subtree.test.js`
t2; `move.drop.test.js` over a 40-step walk, 1,250 of 1,250); a step of a target chain
that a moving frame is headed for resolves to that frame, and the apply is two-phase so
movers never collide with each other. Until C2 each event re-addressed against the
lattice the previous event had left, where the moving root could sit in the cell a
carried kid's chain named: the kid landed a cell off (F136). Frames at the camera's depth + 1
and + 2 also take the sub-cell rest: it stays on the frame as its **shift**, and the
shift is **placement, composed on read** (A1 C1, 2026-09-29): a native's picture table
is its own table with its home frame's shift added at k = 0 (`Document.tableOf`), never
written into it. `LevelMap.objShift` reads a composed table as it reads any table —
whole frames name the frame the pieces are read from, the remainder is painted — and
honours a carry at the home depth: a native the shift puts past its cell is drawn live
in the neighbour (`placementModel.nativesIn`) and stays homed where it is. No read
settles, mints or changes a table (PLAN §3 row 8, `model.pureRead.test.js`): the frame a
picture's pieces are read from is minted at the end of the action that moved them or the
camera (`TileStore.prepare`, from `KobinEngine._prepareView`), and a snapshot of another view
that finds one missing is not ready until the engine mints it at idle (A1 C3). A native added to a shifted frame — a stroke, a ceded kid — cancels the
shift in its own k = 0 entry, so it is drawn where it was put (`Document.ownFor`,
`add(…, { fresh: true })`); a native promoted out of one composes the shift one level
down (`promotedTable`). Until C1 the shift was a debt settled into the natives' tables
at the first read of the frame's list, a carry re-homing to the neighbour, and a frame
a render settled mid-drag was unsettled before the next step: a 20-event drag of a frame
of 300 natives wrote 300 then 600 tables an event, 0 since (2026-09-29, the frozen model
`__oracles__/model-v1` against the tree).

**A frame keeps its identity** (A1 C3, 2026-09-30). A target cell another frame holds makes
the mover a permanent **co-resident** there (`LevelMap._take`); nothing merges. An empty,
childless resident — a visited cell, the common case — hands the mover the residency; a
private frame (§10) never keeps it from a public one, nor takes it from one (a unit moving together leaves its cells
first, so its empty public frame is childless when its private co-resident lands; F138). Co-residents' kids are linked the same
way all the way down (`_linkKids`; a frame leaving splits them, `_splitKids`), so the frames at a
cell are one group and their parents one group. Address lookups return the resident
(`findCellChild`); every by-cell reader reads the whole cell (`Document.cellList`,
`LevelMap.cellFrames`, `sameCell`), and geometry walks cells, so the path between co-residents
is empty and their pictures are bit-exact. Each co-resident is its own selection unit
(`isUnder` is the container chain); a camera whose frame becomes a co-resident is handed to
the cell's resident, same coordinates (`_camToResident`); frame GC promotes a co-resident when
the resident goes. Until C3 the mover was a shadow merged into the resident at the action's end —
tables folded, kids adopted, the merge recorded on the op and split back by its undo — and a
camera left on a merged frame drew nothing (F126); an old store's `mergeFrame` entry replays
through `legacy/modelV1.js`.

**No bake moves a native** (F78, 2026-09-22, Kobin's Earth move on the Magnum Opus: a settle
inside `_bakeDown` carried natives into a frame the bake had passed, and the empty tile was
served for the session; `TileStore._bakeSettled` re-ran such bakes until C1 took the settle
out of every read). **An added native is patched into the cached tiles** a cold
bake would put it in: a direct child's up tile derives it, a chained up tile takes it from its
parent squares' pieces, coarsest first, and one whose parents are not all cached goes
(2026-09-24 TB-1; dropped, a cut in an ancestor frame rebuilt the whole view cold, 1.4–1.7 s at
depth 9 on the Magnum Opus; `tile.patch.test.js` compares every cached tile to a cold bake).
**The shift stays within ±W/2** (`.claude/SUBTREE-O1-PLAN.md`
§2.2, built 2026-09-23): the drop carries whole cells of the frame's shift into its
address (`moveSubtreeTargets`, given each frame's shift at the drag's start), so only a native
whose own table adds to it is drawn past a cell edge, and a change of the shift alone
refiles the frame so its plates follow. A resident with kids keeps its cell even when its whole
subtree is empty; the mover is its co-resident under its own id until GC promotes it (A1 C3).

**A frame holds something** (frame GC, F94; Kobin: "if there ever is a frame, it has stuff in
it"). Until C2 every pointer event of a subtree drag minted the containers its target chains
passed through, and the next left most of them empty — 80–103 in one 40-step drag on his
phone drawing, whose lattice held 471 empty cells of 495; since C2 only the drop mints, its
final chains' (A1 §1.4's census, 40 × 7 px: 145–239 frames during the drag → 0, 4–14 left). `engine/frameGc.js` forgets a frame with
no natives or kids — a co-resident of it becomes its cell's resident (A1 C3) — at a gesture's
end or a change of the camera's frame, unless the
camera is in it or above it, left it within the last four frames (a crossing back composes
through it), or an undo or redo op names it (`opFrames`: history puts things back there by
id; the frame goes when the op leaves history). Never mid-gesture, and never during a load: a
restored store is swept once it is in (`engine.sweepFrames`). A forgotten frame held nothing,
so the store no longer lists it and replay counts it as holding every entry (§13, F98); the
next write's header lattice lacks it and the op log records it (`forget`); its tiles and
plates go with it, since an unmoved frame's id can be minted again by a later read and its old
tiles would be served without what changed meanwhile (F111); so does every reroute grouping
that reads its tiles — the grouping's key counts frames, so a mint after the forget restored the
key and a moved native was not drawn in that view (2026-09-29, R-MODEL-C1: 6 of 8,000 fuzz
renders, the model before C1 too). Undo and redo collect too. A moved frame's id is not minted
again in the session. The rest moves kids across cell edges — a
kid re-homed under the neighbour container — so what was selected stays selected by §10's rule; a
native's picture crosses a cell edge without leaving its frame (A1 C1).

One op per gesture, `{ op: "moveFrames", frames: [{ id, from, to, shiftBefore,
shiftAfter }], moves }`, the frame entries beside the per-object members. Undo
re-addresses to the start and restores the shift — a frame leaves the cell it shared, and
one that took its start cell since stays there beside it; redo is the inverse's inverse.
An op from before C3 can carry `merged` records, split back by `legacy/modelV1.js` (`unmerge`). A `settled` record on an op from a store written
before C1 is subtracted by `legacy/modelV1.js` (`unsettle`; deletion date 2026-12-31).
Byte-exact on the stored natives and the lattice, reload included (`move.subtree.test.js`,
`oplog.test.js`, `hooks/store.model.test.js`).

Measured 2026-09-15, before C1 (jsdom, the median of three runs; 2,000 natives over a root one
level under the camera with kids two and three levels under; the render aside): the
lasso enclosing the root 0.09 ms, one frame and no ids; one drag event 0.36 ms,
three targets, no re-home and no table set; the op two frame entries; undo of the
move 2.0 ms (700 tables unsettled) and redo 0.1 ms; delete of the subtree 0.9 ms
with no `removeById`, its undo 0.04 ms. The render after the drag is 77–113 ms: the
root's 700 natives are above the cull, settled and redrawn, which is drawing them.
The per-object path, measured the day before: lasso 0.75 ms, a drag event 31.6 ms,
an undo entry of 146,529 bytes. Since A1 C2 (2026-09-29, headless Chromium, the harness's
dense scene, 45 selected of 3,441 natives, a frame of 1,000 among them): a drag event
0.7–0.8 ms median against 1.2–1.7 before it, the drag's first event 27–33 ms against
64–83, the drop 1.5–1.9 s against 1.7–2.0 s (its render 1.5–1.6 s both; `_dropMove` 16–18 ms).

Why this was more than the lattice made it look. The structure was ready — a tree of
cells, natives homed by frame id, tables keyed by depth — and the move itself is the
pointer change (`readdress`). The work was in what had grown up assuming an id was
its address (tile stamps, the `#n` id a vacated cell mints, replay) and that one
frame holds a cell (the shadows; co-residents since A1 C3), and in the settle deferred to a read, which had to
be undone and logged exactly where the per-object path wrote every table at once — until
A1 C1 (2026-09-29) made the shift placement, composed on read and written nowhere.

---

## 9. Rendering

Both renderers draw the **scene** (`Stage.js`, below): the raster renderer packs its items into
plates, the SVG renderer builds its Two.js groups from them (`stage.items()` at the Stage's
generation, B-PYRAMID-3). **The raster renderer is the app's default since 2026-09-22** (Kobin);
the SVG renderer is behind the `?svg` URL gate (`useKobinEngine.rasterFromUrl`), and
a one-off SVG engine (`thumbnails.withSvgEngine`) makes the SVG export and the `?svg`
thumbnails, after the erase barrier (`flushErases`). The deployed build (2026-09-08) is SVG only.
The Two.js instance is `raster/SvgLayer.js` (the camera's `world` group, the debug groups, the
lasso's group), the stroke under the pen `raster/LiveStrokeLayer.js`, and the lasso, the debug
overlays and the selection indicator's SVG `raster/svgOverlay.js`: one implementation each, which
both renderers call (A3 §7).

### The raster renderer (`src/engine/raster/`)

`RasterRenderer` extends nothing (B-PYRAMID-3): it composes FC1's stack — the pyramid (z 0), `SvgLayer` (z 1),
the ants' `OverlayLayer` (z 2) and `bl-sel-edges` (z 3), one list that `setSize`, `destroy` and the store's
release walk — and draws the ink into **plates**: 512-device-pixel
squares of the screen, measured in **pixels** — a tile, a cell and a cache square are
measured in frame units, and calling two of them one thing once froze an arc to two
chords (F36). Our own float64 coverage rasteriser fills them (`rasterCore.js`: arcs
flattened centre-free to 1/16 device px, a family filled as one nonzero union) in a pool
of workers (`public/raster-worker.js`; the erase cuts run in the same pool), from jobs `rasterPack.js` packs off the scene's items.
The plates form the **picture pyramid** (`review/rebuild/A3-pyramid.md`; built by B-PYRAMID-2 and
B-PYRAMID-2b, 2026-09-29): a plate is a cell of a **level**, zoom Z(ℓ) = 2^(ℓS) with S the `levelStep`
lever (1, 2 or 3), of the **rest set** (the camera's exact Z once it is still) or of a drag **plane** layer
(`level.js` keys them; no dpr and no quantum in a key). `PicturePyramid` is the layer: each camera step
publishes one view — a level ℓv drawn stretched by σ inside a band [σmin, 2^S·σmin), or the rest set at σ = 1 —
and plans every screen cell from one rule list (A3 §1.4): its own exact plate; the same picture from another
frame's level (a crossing's frame just left); exact children; the finest exact coarser plate (blurrier: its own, else its twin in another frame — past a
crossing the frame left holds it, F137); the patch
rule (the stale plate sharp, the fresh coarser picture over the dirty rectangles only); the stale plate (older)
only while its worker patch is pending (A3 §3.4, counted as `olderPatchMs`); a stale coarser one; paper. A compose
draws at most `COMPOSE_IMAGES` 30 distinct images directly (Chrome's 2D canvas pays ~100 ms a frame past 33 with
any scaled) and goes through one view-sized surface past it. `PyramidStore` holds the plates by key, LRU with
the drawn set, the plane's pins and the rest set protected, in a budget of `plateViews` screens (3 on a desktop, 2
on a phone) never under the pinned bound; a result lands iff its G is newer (rule 1), and a plate is exact iff
its G ≥ its cell's `dirtySince` (rule 2). `jobQueue.js` cuts typed jobs into strips dealt round-robin from the
**attention point** (the last pointer, wheel focus or pinch centre) and dispatches them by priority — rest and
patches 0, the view 1, the plane 2, cuts 3 (one worker kept for cuts while any is pending), the prefetch 4,
thumbnails 5 — dropping a strip whose purpose's generation moved on or whose cells are exact; it packs at most 4 ms
a frame while the camera moves and 4 ms a task while it is still (the strip that crosses it ends the task, the rest
go in the next, so input runs between two 171–480 ms prefetch packs), and while moving skips cells the camera will
have left by the strip's arrival (the velocity rule) and re-aims a view strip at the level the camera is heading to — at
most `AIM_LEVELS` 2 levels from the view's and never under the frame's `ownFloor` (F134: unbounded, a fast zoom-out in
jsdom re-aimed strips 15–20 octaves out, and one strip's cover check alone took 2.6–2.9 s and 1.5 GB at ℓ −19). The pack
refuses a cell whose tiles the table does not cover (F119) and it is asked again once
covered. A still camera renders the rest set inline when its estimate fits `restInlineMs` (8 ms; the estimate is
calibrated from the core's own timings), else in the workers after `restQuietMs` (100 ms) as one group shown
when all are in. A zoom keeps the rest set's records as a stand-in at their own Z — exact there, they beat a stale
level plate, drawn scaled where their resolution ranks among the coarser levels — until the next zoom's set replaces
them; a frame change, a resize or a dpr change removes them. A change patches the drawn cells inline when its
estimate fits — three frames (`USER_COARSE_FRAMES` × `patchUserMs`, 48 ms: one action, not a per-frame cost) for an
undo, a redo or a drop, for either path, so the exact patch is taken whenever it fits (PLAN §5.22 item 2); one frame
(`patchUserMs`, 16 ms) for a pen-up's group, paid once; `patchInlineMs` (6 ms) for the patches the bake issues at every
step; the estimate's chords are each item's rows' share inside the clips, and it prices the pack (a kept item's and a
list item's cost, calibrated from every pack; over the budget alone, no coarser level is tried) — else the finest
coarser level that fits the same budget is patched inline and drawn over the dirty rectangles while the full patches go
to the workers; the search stops at the first level with no records (each level's estimate is a walk of the whole
list); a pen-up's group waits for full resolution and searches none. The patch step runs in the commit's task (PLAN §5.15 item 1): the commit hook marks it due, and the next
compose or camera step runs it, else a microtask of that task — not the hook itself, since an undo's `noteUserEdit`
follows its commit and sets the budget — so no compose draws a plate a commit staled with no patch asked; while the tab
is hidden the microtask leaves it due, and the next compose or the return to visible runs it (PLAN §5.22 item 3). A job
carries the G it was asked at (`askG`): a strip that will not land, or a result that lands, forgets only the asks made
at or before its own, so an older patch's drop or landing never leaves a newer patch's stale plate read as unasked. A clipped
job packs only the items whose box meets its clips (PLAN §5.18; a patch's pixels are its clip's), and the pack's
per-list half keeps each item's record by its geometry across lists, rebuilt where the item's entry, fade, z, family,
erase flag or `res` changed (a held drag moves `res` with no write): the dense undo's inline pack was 45–64 ms, a
prepass refilled 18–33 and a copy of both whole cells 21–29. After (headless, frozen copies, `--dense`, two runs a
tree): the undo's patch is not inline — T 31.7 | 26.8 against 16, its pack terms 9.4–9.5 ms (58 kept items at 105–110
µs, 2,841 list items at 1.1–1.2 µs, calibrated) — and no coarser level fits (ℓ −1's patch prices the same pack; a level
with no records is a whole render, whose kept items are the cell's); the search still measures every level, a walk of
the whole list each: the key task 303 | 272 ms, 246–278 of it in `eng.view` (before 178 ms with ℓ −1 inline, its pack 50
ms and 764 items, | 368 ms, T 39.4, workers); key to exact 874 | 319 ms (before 260 | 819). Open: the search should stop
at the first level with no records. `prefetch.js` renders ℓv − 1 and ℓv − 2 at idle from the live table, the far coarser
levels and a
crossing's target through budgeted snapshots, and the ring at rest; nothing while a report sends. Its tile reads are
warm: `framesLeft` keeps them across a change of frame (F83) and the LRU cap still evicts them (on the dense
drawing's zoom-out and back, 8–10 tiles re-baked on the way in, 19–22 without; PLAN §5.14 item 5). A pool that
fails after a worker has answered (an error, or a job silent past 30 s and still silent a check later) is
replaced, three times, before the session rasters inline (`rasterWorkerClient`, RW-1). A plate is painted
family by family in z order from the TOPMOST family whose coverage fills the whole plate opaquely (the occlusion
cull, Kobin 2026-09-23): at the Magnum Opus's nucleus ~40 whole-plate backdrops a plate were each resolved over
all 262,144 pixels, 97 % of a 165–580 ms job; with the cull 6.3 families a plate and 10.8 ms. A scanline's
crossings past 32 are merge-sorted (a wide band crosses one hundreds of times; the insertion sort was 4–16 s a
plate). The old picture path — `PictureLayer`, the quantum plates, the sync path, the settle, the ladder, the
crossing prebake, the carry and the hold — was deleted at P6 (B-PYRAMID-2b, 2026-09-29).

**The scene and freshness** (`Stage.js`, `placementModel.js`; `review/rebuild/A2-scene.md` §2–§3).
The Stage keeps the camera frame's items in paint order — its own natives, the visible tiles'
pieces, the rerouted moved objects — from the document's and the tile cache's events, so it is
never behind the document; an item reads z and the erase data from the live native, and `placed`
is the one read of where it is drawn. One integer **G** moves once a commit (an event outside a
batch; a drop, an undo, a delete, a load as one batch). A change dirties every plate cell its
drawn footprint meets, before and after (the event carries the old box, width and table;
a merge or an inkless refusal carries none; a union family whose routing flips dirties
its whole box); the plate store tracks every cell it holds or has a job for. A job carries the G
it was packed at, a result replaces the stored plate iff its G is newer, and a plate is exact iff
its G ≥ its cell's `dirtySince` — no epochs, no painted-id sets, no queued events drained at a
frame. A drag writes nothing (A1 C2): the Stage holds its natives (`stage.hold`) at the pointer's
delta (`setDragDelta`) — the plane draws them, or the view's plates do when there is none — and the
drop's one write is one commit that dirties where the selection started and where it ended. A stroke is pending
from pen-down until its shape lands: packs skip it and the pick sees it.

What keeps paper off the screen is the plan's order above: a stale plate is shown until its replacement lands, a
replacement that lands still behind but newer than the stale pixels takes their place (F106), and a missing cell is
drawn from the nearest fresh source the store holds, blurrier before older. The pyramid's own integrals say how
much of the screen was not exact and for how long, charged forward at each compose: `paperMs`, `blurMs`, and older by
cause — `olderPatchMs`, a stale picture while the worker job that makes its cell exact is asked or in flight (a patch
no level does inline, or the last resort's own job); `olderUnreadMs`, a stale own plate or the plan's last resort (a
stale coarser stand-in for a cell with nothing fresh at any level) while the cell's tiles are unread (the patch step
cannot pack it until they are read); and `olderOtherMs`,
anything else: 0 in the never-older fuzz and in scenarios 1–6 of the dense harness since the patch step runs in the
commit's task (scenario 7's was 1.3–1.6 s: stale own plates waiting for the bake's next render). After (headless, two
runs a tree): scenario 7's `olderOtherMs` 254 | 78 ms (before 1,370 | 1,573), not 0 — 36 | 30 cell-composes of a stale
own plate with nothing asked or in flight (159 | 86 before), suspected cells a zoom's crossing left unread, which the
patch step skips (`covered` false) and `_older` does not tell as unread (unverified; open); `olderPatchMs` 2,476 | 1,499
(899 | 721), the waits asked at once; the bake 7.6 | 5.5 s (6.7 s | not finished in 60 s). A desktop tab releases its
plates only after five minutes
hidden (a phone at once). A drag draws the selection from plates made when it was selected, split by z so the
drag keeps its true depth: the ink below the selection, the selected runs on transparent plates (moved with the
pointer), and the ink above them on transparent plates, drawn in place (`MovePlane.js`; over 5 layers the smallest
run between two selected ones is drawn under them; over `MOVE_PLANE_PLATES` 40 plates, 24 on a phone, the layers
are cut coarser; a quick level two octaves coarser is drawn until the plane's own is whole, a level coarser than
the table's margin reading a snapshot over its plates at idle, F122; the selected runs reach one view past the
screen and the camera's table is read that far while a selection is on the plane's path, D1; never the selection
twice, H4; a small selection's stopgap rastered on the main thread: a drag always moves); at the drop each cell
keeps the plane until its fresh plate lands (`MOVE_HOLD_MS`, a 3 s safety limit). A pen-up holds the live SVG path
(`LiveStrokeLayer.hold`) until one group commit publishes the drawn cells under its box and `release`s it in the
same task (A3 §3.6; no limit while the stroke's shape is pending, PLAN §5.4 Q2; `LIVE_HOLD_MS` 3 s after),
re-anchored when the next stroke moves the layer's origin (F131) and carried into the new frame at a crossing (its
root scaled by R^Δdepth, its box and its group's rectangle mapped: `_liveCross`). Pen-up groups over the same cells
are one group (F135): one commit publishes its plates and releases every member's path, a result that shows a member's
stroke is never put while that path is up — never both, for each path — a result counts when packed at or after the
group's G or exact at landing, and a need cell whose landing does not count is asked again inside the group unless a
job for it is coming (two groups over one cell each took the other's results: the first path stayed 3 s over plates
already showing its stroke, jsdom). Headless round trip (three strokes, two runs a tree, the never-both log at every
compose): before and after alike, 3 holds, 3 handoffs, 0 composes drawing a plate under a held path, no path held at the
"drawn" shot, its ink equal to the settled ink — the review's 53,919 px of double alpha there is not path-and-plates in
these runs.
The band is never packed: until its perimeter resolves a stroke is drawn by its live path alone,
and the resolve's commit stales the plates under it, which the next camera step re-posts. A bake
renders at most every 100 ms (`_renderSoon`); a cut on a pending pair dirties only its footprint
inside the mark's box and its dust (§7, PLAN §5.3 A2-Q2), so plates the mark never reaches keep. The live stroke stays
SVG: a short tail under the pen and frozen chunks of 128 anchors behind it, one group carrying the
opacity (one path's whole `d` was rebuilt every event: 27 ms at 3,000 samples, D-1); the selection ants are painted on an overlay canvas (`OverlayLayer.js`, `antPaint.js`). A destroyed engine is inert — `_render`, the camera steps and the overlay return at once — because a remount builds the next engine in the same host and a late step would put the old selection's ants back over it (F101).
`sceneOps.snapshotView` packs one plate of any frame and rect, off camera, for the Scenes panel's pictures:
the Stage's snapshot of the rect read at idle a budget at a time (D5), the plate through the queue at `PRIO.thumb`. The engine's own `raster` option defaults to off, so the suites and the
one-off engines are SVG. `renderPlate` takes a clip box (`job.clips` on the wire; the patches' primitive): rows are restricted to it and x is not folded at
its edges, so every pixel inside it is the whole plate's byte and nothing outside it is written —
measured on 180 seeded random clips and on a clip-and-paste merge per kind of change
(`rasterCore.clip.test.js`, A3 §3.1).
The page's engine takes input in animation frames (`cfg.frames` "raf"; the suites and the one-off
engines keep "sync"): a wheel, pinch, pan or drag event moves the camera or records the pointer at
once, and one `_frame()` a frame runs the camera step, the drag's step at the last pointer, a
stroke's SVG update and one compose for arrived plates; the scale HUD follows the zoom through
`engine.onZoom`, so a zoom no longer re-renders the editor (A3 §5). On the raster path the camera
step is the table's: `stage.sync(frame, window)` reads and drops tiles as the window moves, and
the renderer steps; only a crossing renders (a pinch's pan crossing a cell edge counts as one).

Measured in Kobin's Chrome on 2026-09-22: the Magnum Opus (42,857 natives) loads in 1.4 s
against the SVG renderer's 6.2 s, and the two agree on 20 views to 0.001–0.98 % of pixels,
the difference a sub-quarter-pixel vertical offset (the whole-device-pixel pan snap). The
paper work, measured in his tab on 2026-09-22 (paper = each frame's uncovered share × its
time on screen): a fast zoom-out 1,429 → 37–51 ms, a fast zoom-in 902 → 0 ms, slow zooms and
pans 0; drags on a scratch canvas build no list and show no paper. The design and its decision log are `.claude/RASTERISER-PLAN.md`;
Kobin's look is its stage 7.

### The SVG renderer (`?svg`)

`Renderer` is the class that builds Two.js paths for the ink (the anchors: `raster/svgAnchors.js`).
One persistent `Two.Group` per object id, kept sorted by `(z, id)`; a per-frame diff rebuilds a group
only when its piece *signature* changes; a camera-only frame touches nothing but the world
transform and faded groups' opacity. A group whose opacity is 0 (a fully faded down-piece) is not
rebuilt at all: Two.js never renders it, the removal of its old paths included, and a drag that moved
one every event kept every generation (F133: 57 MB an event, a crash on the dense scene); its signature
stays stale until the zoom that shows it, which `needsFadeFlip` promotes to a render.

Five things in it are load-bearing and none is obvious:

- **Per-scene origin.** Browsers rasterise SVG in float32, so a vertex at frame
  coordinate *c* carries `(c × inScale)/2²³` pixels of error. Every anchor is
  built relative to an origin at the view centre, and the origin is folded back
  into the world transform **in float64**, where the cancellation between `inPan`
  and `inScale × origin` is exact. The scene re-anchors when the view drifts
  1.5e6 screen px from the origin.
- **One path per logical object.** Two opaque paths sharing an edge each cover
  part of the boundary pixel and composite source-over, so up to a quarter of the
  background survives — a pale hairline down every join, measured at 18–25%
  toward white. **Subpaths of one path do not seam**: the rasteriser accumulates
  coverage across all of them before compositing anything. That is what lets the
  cede model keep its cut exact instead of paying for an overlap that would have
  to be sized against the view.
- **The thin rescale (F-Z).** Chrome drops a filled path whose features are too
  small *in the coordinates it is handed*, however much the transform then
  enlarges them: measured, 0.0657 units renders and 0.0641 does not, and the app
  was handing over 0.00329. Fix: multiply that object's anchors by a power of two
  and divide its own group's transform by the same number. Pixel-identical by
  construction, per-object, applied at the end of the build. Capped at 64 because
  1/64 is the last power of two exact at Two.js's six-decimal serialiser.
- **Scene retention.** Each level keeps its own SVG subtree; a crossing detaches
  one and attaches another instead of rebuilding ~50 paths and their giant `d`
  strings. Crossings cost 1–3 s each before this.
- **An arc reaches the browser by a plan made once per piece.** A browser
  draws lines, polynomial Béziers and the SVG arc command, and no circle is
  exactly a Bézier, so each arc is one of two things, chosen at the engine's
  quarter-pixel tolerance and the frame's *deepest* zoom so the choice never
  changes while zooming: the arc command (Two.js's `Commands.arc`, split only
  at a half turn because the command is named by its endpoints) while the
  browser's float32 centre is within tolerance — a screen radius up to 4.2
  million px, one instruction, exact — and beyond that as many kappa cubics,
  built from endpoints and sweep with no centre anywhere, as the sixth-root
  law demands: n = ⌈sweep·(1.8e-5·R_px/tol)^(1/6)⌉, at most a dozen or so for
  any piece the tile chop allows. Until 2026-09-04 every arc went out as
  quarter-turn cubics, whose error is 2.7e-4 of the radius — a re-homed circle
  one frame up, 2.9 million px of radius on screen, drew its edge 463 px from
  where it is (F40) — and the arc command alone was 159 px off at the child
  frame's deepest zoom. **And nothing far from the view is handed to the
  browser:** every coordinate reaches it in float32 relative to the scene
  origin, and Chrome's GPU raster drops a path whose curves run beyond
  roughly 1e7 device px — a piece spanning a tile at a frame's deepest zoom
  is thousands of screens wide however little of it is in view. So each scene
  keeps a window of ±2^18 device px around the view, any area piece that
  reaches past it is clipped to it with the tile chop's own exact boolean
  before it becomes anchors, and the window is chosen again — rebuilding only
  the groups that straddle it — when the view leaves its inner half or the
  zoom grows fourfold. No anchor is then ever farther from the origin than
  3.07e6 px, 0.18 px of float32. Render-only; the objects and tiles are
  untouched. Measured in paint, not by hit-testing, which lies about flat
  cubics (F40).
- **The selection indicator is raw SVG in layers of its own, not Two.js.** It
  is built from the pieces the renderer is drawing — never from the document —
  on arcs, nothing flattened, with the tile cuts skipped by the rectangle that
  made them (a family member's window placed where THAT member is drawn, by its
  own table or none: placed by the traced piece's residual, a kid ceded below a
  move drew a square of ants inside the ink, F125); decided once per render and moved between camera steps by a CSS
  transform the compositor applies. It has its own `<svg>` because in the
  drawing's, every frame of the crawl re-rasterised the drawing (measured
  2026-09-03: 50 ms a frame, 16.7 once split). The crawl is stepped, because the
  repaint of a screenful of dashed ants costs about a frame whatever the
  batching, and dashing is rasteriser work no profiler could name — the
  bounding box this all replaced projected to 877,395 px and cost 315 ms a frame
  behind 0.15 ms of JavaScript. `engine/overlays.js` carries the argument.

### How content from other levels arrives

| | |
|---|---|
| `upContent(F)` | **ancestor** frames' objects, magnified into F, built by **chaining** one crossing at a time through the parent's tiles. Magnify must chain: a composed long jump cancels catastrophically. Classified empty / solid / edge, where **solid** replaces a tile-covering band with a 4-vertex quad so geometry can never outgrow a tile. |
| `downContent(F)` | every **non-ancestor** frame at depth ≥ F, projected directly (net factor ≤ 1, so it cannot explode). A view-independent cull drops sub-pixel content; a fade band tags size. Candidates come from the frame tree (`_downSources`): F's subtree and, outward, each ancestor's other subtrees, a subtree skipped whole when its cell grown by one misses the tile (invariant 2), and a frame skipped whole when its index's extent misses the tile or its largest object is under the cull (`Document.frameExtent`). The scan rests on invariant 2 as the ring does: a native overhanging its frame's neighbourhood is not found by a down tile. |
| `nativesIn(F)` | the natives drawn live in F (`placementModel.js`): its own, read straight out of the Document, less those whose picture its shift carries out, plus those carried in (A1 C1). A plain read, because a cut parent's stored rings **are** the rings to paint. |
| `ringNatives` | the eight cells around each step of the up-chain. A cell is about three screens across, so zooming in slightly off-centre puts on-screen ink into a **sibling** of your ancestor — coarser than you, not an ancestor, so both other paths skipped it and it vanished. Invariant 2 is what makes the ring complete. |

---

## 10. Selecting

**"Everything fully bounded by the loop."** Two consequences fall out and both
are wanted: an object far too small to see is selected as readily as a visible
one, and an object far *larger* than the view is never selected, because a loop
drawn on screen cannot contain it — which is the same set of objects whose motion
the engine cannot record accurately.

`_lassoFind` walks the frame tree **outward** from the active frame, one hop at a
time, giving every frame one of three answers: *out of reach* (skip it and its
whole subtree), *enclosed* (take everything below, no per-object test at all), or
*straddling* (ask its own spatial index). Outward rather than down from the root,
because that is the only direction in which the scale factor stays a number.
Measured on a six-level tower of twelve objects: a loop round the whole canvas
tests **2** of them. An object with a displacement table is indexed at its stored
bits and drawn elsewhere, so after the walk every one the active frame can reach is
judged where its picture is (F69). A frame with no native anywhere in its subtree — a
visited cell — stands for nothing: the walk neither takes nor enters it (`_inkedFrames`,
O(frames with natives × depth); F93). An **enclosed frame is one entry** of the
selection (`selection.frames`, 2026-09-15): nothing under it is read; a native is
selected when its home is the frame or under it (`_isSelected`, `LevelMap.isUnder`: the
container chain, so a co-resident is its own unit, A1 C3); the status count sums the subtree's list
lengths (`walk`); a drag moves it as a frame (§8) and delete takes the subtree out of the
lattice with its lists (`Document.removeFrameSubtree`, one `removeFrames` op holding each
frame's address, O(frames); each frame's `removeFrame` event carries the root's address, the one whose parent is
still in the lattice, so the tiles and the scene drop the subtree's footprint, F138 seed 51). Ink placed at its cells afterwards goes to fresh frames, and an
undo puts the subtree back, a co-resident where new ink holds a cell; a camera in a deleted
frame moves to a fresh frame at its cell (A1 C3; F107's set-aside frames and `_gone` flags
went). A keyless native is a family of one and skips the family re-check (2026-09-14). A family piece homed under an enclosed frame counts as inside, and is moved by that frame's re-address, never also per object (F100). An object whose box pokes out of the loop is asked about its ink against the loop AS DRAWN (every 7th point of a slow loop, joined, cut inside the line by the finger's wiggle and dropped ink 0.6 px inside it; REPORTS 2026-09-24, `select.lasso.test.js` LD-1/2).
**A cede's kids live in private frames of their family** (A1 C4, 2026-09-30): a chain flagged
`private` hanging from the family's frame (`LevelMap.privateFrame`, `eraseDescent.kidHome`), so no
shared frame holds a family's piece. A private frame is never taken whole — its natives are judged
with their families — and every other frame keeps the O(1) enclosed rule. A family ceded before
C4 keeps the backstop: an enclosed frame is **not** one entry when a keyed native under it belongs
to a family the loop does not bound; the frames from that native up are read as straddling and
the rest is found one by one (`_tornUnder`, from `Document.keyedIn`; F108).

**The selection stands for the same ink** (F93). A drop's rest re-homes a selected frame's kid
under the neighbour container (§8; since A1 C1 no read moves a native, so a frame's natives
stay its own wherever its shift draws them). The selection is **repaired from the action's
op, never from document events** (A1 C2): before a drop, an undo or a redo, the op's frames
under a selected frame and its per-object members listed or under one are read
(`_opUnder`); after it, what left every selected frame joins the selection — a frame as a
frame, a native as an id — an id back under a selected frame leaves the ids, an id the
action removed goes (its family's first member takes its place when nothing else is
left), and a selected frame left with no ink leaves (`_repairSelection`, `_reselect`),
quietly, before the action's one render. Only a reset still reaches the selection as an
event: a remote edit arrives as a reload, whose reset drops the selection, so none of its
removals is left in it (`select.remote.test.js`). A frame under another selected frame is
counted once.

**A press picks, a drag moves** (`_selectTap`, `_beginSelectDrag`). Nothing changes on
pointer-down, so a pinch never selects. A tap takes the topmost object under the point, read
from the scene's items where they are drawn (`stage.placed`: an input at p reaches an item at
p − its offset), a stroke pending its shape included. A
drag with nothing selected, or with ctrl, is a lasso; from paper it lassoes; from ink it
moves the whole selection when selected ink is anywhere under the press — covered by an
unselected object or not (Kobin, 2026-09-23; `_hitTest`'s `only`), or a selected frame's
mark is there — and otherwise selects the topmost object there alone and moves it. A pick
reaches 6 px past the ink; a mark smaller than that reach is picked anywhere its box is within
it (`_tinyHit`: the reach's eight probes passed between them, and a press on a lassoed dot took
the ink under it, TESTER-2 2026-09-24).

**The indicator shows what is drawn.** Ants run along the scene's items (`stage.placed`; the
decision is remade when G moves; a drag keeps the decision made at rest, read through
`stage.atRest`, and moves it with the pointer from the drag's start; the drop, or a cancel, keeps it too, moved by the
displacement the drop wrote, when every selected member and frame is drawn exactly that far from where it was at the
drag's start and the view stays inside the kept window — else it is remade: re-deciding in the dense scene's drop
frame was 548–803 ms, B-PYRAMID-5),
so a magnified shape that the browser could not hold as arcs is shown from the
tile pieces that hold it, and a frame whose selected content is under 2 px on
screen is one dot with none of its members visited — the frame's box bounds
them all, by invariant 2, and the box is taken where the ink is drawn, through
each member's placement (`stage.placeNative`, F68). A selected member that traces to nothing —
its runs under the half-pixel minimum, or culled from the table — is a dot of its own
where its picture is, unless it is a re-homed family's kid, which shows through its
family (F73). A selected frame is one box, its own cell (`_selTable`): a dot under
2 px, and above it the pieces on screen homed under it are traced from the scene's
items, a member drawn but too small for a run a dot from its piece; the frame's
natives are never read. A selected frame that shows nothing that way — its content culled from the
table, three levels under a lasso made from far away — is a dot where its content is, from its
subtree's index extents (`_selFrameContent`, F103). There is no budget: every selected piece on screen is
outlined, and what a full selection costs is the repaint of its length, which
the roadmap holds.

---

## 11. Scenes

The coherent drawings hidden inside a canvas, kept by a **scene index saved in the
file** and updated at pen-up (and on every erase, move and undo) in a background
worker at the lowest priority — never re-clustered, so opening a file computes
nothing (`sceneIndex.js`, `sceneClient.js`; `docs/reference/scenes-v3-design-bible.md`).
A scene (1) tells you about ink you cannot see from here without a small pan or
zoom and (2) frames a picture of it, less long stray marks; levels never split one.
Every distance is in **stroke widths**, the width an object counts with being its
thickness now, capped at its pen: ink closer than 900 widths joins (`JOIN_PX` 2,250
px at the zoom where the stroke is 2.5 px), and a scene holds widths within 16×
(`ZOOM_SPREAD`) — finer detail inside it is a **child** scene, a coarser picture
drawn around it a parent. A lonely run of one object longer than two chunks is
**stray**: not framed, and it never bridges two drawings. A whole scene moved is
one origin change; part of one leaves and re-joins where it lands; removing ink
split-checks what is left, the side with more ink keeping the id and name (a
renamed scene keeps its own through a merge). Storage never makes a scene —
erase pieces keep their object's scene and re-homed patches (`attachRect`) are
not indexed while their family has other ink (a family of patches alone is the
drawing, and is) — but a **fine eraser's carving is detail**: its footprint, at the
eraser's width, is a child scene framed on the carving. Wide scenes get **parts** (at most 12),
crowds of siblings **regions**. Names set aside by a merge or an erase come back
to a scene covering their frame (undo, a split, a redraw). Nested scenes whose frames show the
same subject (each holding the other's centre, within 3×) are **one row** of the list, framed
on the tighter, or on its renamed member (Kobin 2026-09-23: "two scenes for Saturn"). A frame is
the ink and 10 %, with no minimum. The index is packed into typed arrays (grids as cell tables over
one pool, chunks in shared pools) and the main thread keeps three numbers an object: 26 MB on the
Magnum Opus where it was 79 (SCENES-PLAN §7.8). Its main-thread tick waits out a stroke, a drag,
a lasso, a cut in flight, rastering, a pan and a zoom step (`_camBusy`, 2026-09-24 SC-1), up to
3 s, and runs in idle time forced after 5 s at most. A worker that fails a batch is replaced and
the index restarts from the last saved state, three times, before it goes inline (SC-3).

---

## 12. The scale bar

The bar reads **the lowest in-range number**: one rule applied everywhere rather
than a special case per decade. A ladder of candidate lengths is generated in log
space, filtered to those that fit the on-screen band
(`BAR_PX_MIN`…`BAR_PX_MAX`), and the lowest survivor wins. Unit preference is
sticky per session, so the bar does not flip units under a small zoom.
`src/engine/scaleBar/` is fifteen small modules with one job each;
`docs/reference/scale-bar-ruling-design-bible.md` is the full argument.

---

## 13. Persistence

**kobin-1** (`src/engine/persist.js`) — a versioned envelope around exactly what
the collaborators serialize: `Camera.state`, `LevelMap.serialize`,
`Document.serializeNatives`. Hard-fails on anything the engine would crash or
corrupt on; lenient about everything else, and unknown fields are preserved so an
older build can open a file written by a newer one that only *adds*.

Two repairs happen at the door, both because a drawing that cannot be opened is
worse than a drawing with one mended object: an unclosed loop is sealed
(`arcShape.repairLoops`), and a tile phase of exactly `W` is normalised to 0.
Pre-lattice files are **refused** with a clear error, never converted — converting
would mean rewriting stored coordinates, which is the one operation this design
exists to avoid.

Version 2 (2026-09-05) adds one record: a cut line's canonical points (F43,
code 2 in `encodeLoops`), which a version-1 reader would take for an arc. A
drawing is written as version 2 only when it holds one; everything else is
still version 1 and opens in any build. An object's displacement table
(`below`, section 8) rides the native record in both versions.

Version 3 (2026-09-29, A1 C1): a frame's `shift` in the lattice is its natives'
placement, composed on read (§8), where a version-2 build reads it as a debt to settle
into their tables and the deployed build before 4c99a8a drops it. A drawing whose
lattice carries a shift is written as version 3, and those builds refuse it with
their "saved by a newer version" message; one without a shift is written exactly as
before, byte for byte (`hooks/store.model.test.js`). Measured against the deployed reader
(0732252's `persist.js`, 2026-09-29): a shifted file and a store header with a shift are refused
("file v3, app reads up to v2"), a shift-free file is read; a store and a cloud copy reach the
same check through `loadDrawing`. Since A1 C3/C4 a lattice with a co-resident or a private frame
is written as version 3 too (`persist.latticeNeedsV3`): a build before them would merge a
co-resident into its resident at the load and read a private frame as a shared one.

**Frame ids.** A frame's id is its birth chain, `0/i,j/…`; a cell a moved frame vacated
mints a twin with `#n` on its segment, and every descendant carries that `#n` inside its
own id. `persist.js` has one grammar for both of its checks (`FRAME_ID`, a `#n` on any
segment): until 2026-09-22 it allowed one on the last segment only, so a twin's children
failed `decodeNatives` and the scenes under them were dropped on save (F80).

**dev-0** (`snapshot`/`loadSnapshot`) is a second, separate format: the whole
engine state including the crossing records. Not the save format. The diagnostic
report carried it whole until 2026-09-22 (92 MB on a big drawing, F58); it now
carries a local extract in kobin-2 frame form that `report.loadReport` turns back
into a dev-0 snapshot (§14).

**kobin-2** (2026-09-08; `src/engine/format2.js`, `src/engine/oplog.js`) — the
store, as opposed to the file. A frame's natives are small JSON headers plus ONE
Float64Array of geometry (each header carries its span; the grammar inside a span
is `encodeLoopInto`'s, the same numbers kobin-1 writes as text, so the two decode
to identical objects), and an append-only op log records what the document did as
entries carrying RESULTS — the objects an edit removed and made, never a gesture
to recompute, because a replayed bake would differ across code versions. A tick
appends the entries and rewrites a frame's snapshot only when its entries have
outgrown it (64 KiB or a quarter of the snapshot) or an undo, redo or move touched
it; a load is the snapshots plus the entries after each frame's seq, replayed
idempotently, and the undo/redo stacks come back from the same entries — every
record of an id decoding to one object, the later record's state winning, so the
stacks share identity with the document as they do in a live session (F70), and an
op's inverse keeping its seq so a redo is an entry rather than a reset (F71). A pending
eraser resumes from its headers: the mark's `targets`, its pieces' `handledBy`, with
`targetOf` derived at load from every known mark's `targets` (§7), so an erase
interrupted by a tab close resumes where it left off. Compaction never drops an entry
younger than the undo window or belonging to a pending mark. Header fields a build does
not know ride through (`_extra`), and an `attr` entry carries a per-object field set on
its own: a mark's `targets`, a refusal's `handledBy` (A2 §4.9), and later z-order. The erase
fields are additive (no version bump): the deployed build (0732252) reads a kobin-1 file and
kobin-2 frames written now and writes the three fields back unchanged (measured, R-ERASE). Its replay applies an `attr`
entry without marking the field as one to keep (read from its `oplog.js`), so its next snapshot
of that frame drops it; the mark then registers again by the old-file rule here (A2 §4.9 "Across versions").
A store the pre-rule engine made (1cac470) loads, registers each landed mark once and ends its
bake at that engine's own result (`erase.oldStore.test.js`).

**The lattice is the header's** (2026-09-15, the subtree move of §8). Every write
carries `LevelMap.serialize` — addresses, shifts, co-residents, private flags — beside its
entries, so the stored lattice is never older than any stored entry, and a replayed
`moveFrames` or its undo re-addresses nothing: it rebuilds the op. A lattice whose frame `0` a subtree delete took
loads without it: the root `0` is added only to an empty lattice, never parentless beside the tree (F138 seed 174).
The natives' tables are entries, every apply by RESULT so it replays the same
whatever else the tick held (a frame moved as a frame is not re-snapshotted: its shift
is the header's, and no table takes it — A1 C1; a `settle` entry, from a store written
before C1, replays its result tables through `legacy/modelV1.js`, as does a `mergeFrame` from before
C3), a `moveFrames` carries its frame entries and its per-object members and none of the
frames' natives (Kobin's decision: the snapshots hold them), and a `removeFrames`
or `deleteMany` carries every deleted native's geometry, because its row goes with
the write, and each deleted frame's address (`at`, A1 C3), so its replay takes the frames
out of the lattice again. A failed write keeps its forced frames as well as its entries.

**What the snapshots hold** (F98, 2026-09-23, Kobin's Earth). A load skips an entry when
every frame it touches holds a snapshot at or past it (`oplog.snapshotRule`), and a frame the
header does not list held nothing at that write, so it holds every entry. A subtree drag walks
its per-object members through a container per drop, and the next drop empties it; an emptied
list leaves the header's frame list, its seq with it, and until that day replay read the
container as seq 0, put the older drop's tables back over the newer snapshot and skipped the
entry that had moved them since — the Earth's disc loaded two diameters off its city. A bake
step applies per frame (a piece whose frame's snapshot is newer is there already, or was cut
away since); the saver snapshots every listed frame that has no stored snapshot, so a frame
emptied and later drawn in again is never listed at seq 0; and replay caps the rebuilt undo
stack op by op, as `pushUndo` does. The format did not change: every listed frame has a
snapshot, so the cloud manifest's `frameIds` and chunks carry the rule as they are. Frame GC
(§8) leans on it: a forgotten frame is an unlisted one — so an undone cede whose private frames GC forgot, one id
taken again by a later cede, does not come back at a reload (F138 seed 131; `store.subtree`; a replay without the
listing brings it back). **Undo and redo in replay** (2026-09-24,
REVIEWER-2 U-1..U-4, REVIEWER-3 SAVE-1): the undo of an add names the frame the object was
removed from; a stale undo or redo of a move rewinds each member to the op it inverts —
always that op's `from` and `belowBefore`, since after an undo the op held is already the
inverse — so a later add entry, encoded at drain time, is not read as already moved; a
redone erase reuses its commit.

**Local storage**: IndexedDB (`src/storage/db.js`, version 2) — one header record
per canvas, one `frames2` record per frame holding the headers and the raw
Float64Array buffer, and the `log` store, one record per entry; no JSON text and
no compression. A canvas still in the v1 `frames` store opens the old way and its
first save moves it. Thumbnails, the recycle-bin payloads and the pre-pull backups
keep their own stores; only the gallery index and the recycle-bin index remain in
localStorage. Autosave waits 1.5 s behind the last change and flushes on tab hide.
(Until 2026-09-02 it was one lz-string slot per canvas in localStorage, F33.)
**Cloud**: Firestore, a MIRROR of the local store — a frame snapshot or a run of
log entries is one chunk (`src/cloud/store2.js`), gzipped by the browser's own
`CompressionStream` (`src/cloud/gzip.js`; raw where it is missing, never
lz-string, whose JS-object dictionary fails on a 100 MB drawing, F64) and split
into 700 KiB parts; a push sends the frames whose stored snapshot is newer than
the cloud's and the entries past the cloud's seq, then the manifest (the parent
doc) **last**, and deletes the parts it replaced after. An old lz1 copy is replaced
by the first kobin-2 push and still pulls the old way; nothing else is ever replaced
(below). A failed sync is shown in the save bar with its size and retried with a backoff,
1 min to 30 min. One push at a time (a 5 min deadline; busy holds until the SDK
settles) and one part a commit: measured 2026-09-08 on the 12,849-object canvas,
six parts a batch with the 30 s tick starting a second push beside the first had
Firestore's write stream answering `resource-exhausted` every minute for ten
minutes while the tab churned 2–3 GB; with the guard and one part a commit the
full push (27 MB gzipped, 50 parts) took 120 s, the SDK still logging that error
between batches and retrying through it. "One at a time" is per page, not per
session (2026-09-23): every push runs in `canvasSync`'s one lane, so a session
restarted mid-push (Fast Refresh, a remount) or the next canvas opened after a
leave push waits for it, and a push whose tab lost the store stops at its next part.

**Several tabs and devices: one editor at a time** (2026-09-22, `.claude/SYNC-PLAN.md`;
`src/cloud/syncCore.js`, `canvasSession.js`). A canvas's history has a head `{epoch,
seq}`: the op log's seq, and an epoch that changes each time another device or tab takes
the pen. The manifest carries `head` and `lease {device, tab, name, epoch, until}`; the
local header carries `base`, the cloud head it last pulled or pushed. On the device the
pen is a Web Lock per canvas (over localStorage where there are no Web Locks, freed when its
page goes away: F97); in the cloud
it is the lease, taken and renewed (every 20 s while visible, free after 90 s unrenewed —
to another device only 5 min past its holder's clock, or after a follower has watched it
sit unchanged for 90 s of its own) in transactions. A renewal waits out a push while the lease still has half its life (both transact on the manifest; racing, one failed its precondition and retried every few minutes). A tab or device without it is read-only
(the engine pans on every press and refuses undo; the saver writes nothing) and follows
while visible: a same-device tab reloads the store when the holder says "saved" on a
BroadcastChannel after a write that moved data, and reads only the header's name and scale
after one that did not (a camera, a name: the reload was 5–7 s of main thread on the Magnum
Opus, F87), another device pulls the new head (only the changed frames and the
entries past its base) when the manifest changes. "Edit here" asks the holder to save and
let go; the holder pushes and releases the lease to the asker alone, renewing while it does,
so a slow hand-over is waited for rather than forced. The lock is backed by a fence: every
grant claims the store with a token, every write carries it and is refused inside its
IndexedDB transaction once another tab has claimed (and so is a write whose document is
behind the store), so a tab that lost the pen mid-`await` or thawed after a freeze writes
nothing; what it could not write is kept as a new canvas. A push never overwrites: its
parts are named by its epoch and a nonce of its own, it is never doubled (busy holds until
the SDK settles it), and the manifest's transaction requires the cloud head to be the local
base and the lease to be this device's; a refused push leaves only parts no manifest names,
which the next push sweeps. Opening compares versions, never clocks: ahead is a fast-forward
push, behind a fast-forward pull (which drops the local entries below the cloud log's floor:
kept, they rebuilt ops the pusher had undone as undoable, F113), and both moved makes the local copy a new canvas
("<name> — edits from <device>, <date>") while the cloud copy stays this one. A clock
decides once, for a pair from before versions whose ancestry is unknown, and both of its
answers keep both copies (a copy of the whole store in the recycle bin, or a new canvas);
if the copy cannot be made, the pull does not happen. Whole-canvas reads and copies run a
frame per transaction: a transaction's scope is a store, so one over a whole canvas blocks
every write in the origin (0.4–1.4 s measured on a store the Magnum Opus's size). Only a
production build on the deployed app's own hosts reads and writes `canvases`; every other
build or host (the dev server, localhost, a LAN IP, a preview channel) uses
`users/{uid}/dev-canvases` (one Firebase project serves both); the dev panel's Copy real
reads a real canvas in as a new one.

---

## 14. Diagnostics

All dev-only, none of it on the drawing path. `src/engine/instruments.js` holds
the four instruments; `?dev` on an editor URL unlocks the panel.

| | |
|---|---|
| `perfLog` | operations over 8 ms (everything, in trace mode) |
| `perfLong` | every `perfLog` entry of 200 ms or more, the last 100 of the session: the log itself rolls over in a minute or two of work, so a report's long idle tasks were unattributable (2026-09-24). Idle work is timed by name — `ladder` (the rung's list), `ladderPost` (its pack), `prebake`, `prebakePost`, `idleFit`, `sceneTick`. |
| `frameMeter` | the gap between animation frames — the only instrument here that sees paint. Samples only around interaction. |
| `longFrames` | Chrome's long-animation-frame: script vs style-and-layout vs what is left over, which is paint and compositing. **The subtraction is the whole point.** |
| `eventLatency` | input to pixels in three phases. `presentMs` is the only one that reaches past the main thread to the compositor. |
| `growth` | heap and every cache that could grow, sampled over time. A snapshot cannot show accumulation. |
| `journal` | the last 40 **gestures** with their pointer paths, what each erase cut, and whether the object came apart. A snapshot shows the wreck; the journal shows the gesture that made it. |
| `report` | the Report button (`src/engine/report.js`, sent by `hooks/reportSend.js`; OPEN-FLAGS F58): the instruments above, the save, cloud, move, erase and scene state, the journal and the undo and redo stacks, and a **local extract** — the natives on screen and around it, largest first, up to 4 MB of JSON, with the whole lattice — which `loadReport` loads back into an engine at the recorded camera, so a report is still a **loadable drawing**. The whole drawing is an opt-in (`+Drawing`) in kobin-2 parts. Built task by task, gzipped off the main thread, posted in parts to `tools/report-server.js`; `tools/report-read.js` prints its headline numbers. Reports before 2026-09-22 carry the whole document as `snapshot`. |
| `rasterPerf` | the raster path's ring (`src/engine/raster/rasterPerf.js`): each frame's time in five buckets by phase — ENGINE, RASTERISER, TRANSFER, BROWSER, OVERLAY — with a one-word verdict; `E.renderer.perf.report()`, and the report's `raster` section. |

---

## 15. The code, as it stands

104 source files outside the oracles and the testkit, 131 test files and 12 probes
(counted 2026-09-22).

### The engine

| file | |
|---|---|
| `KobinEngine.js` | the facade: construction, the compat accessors, tool and style setters, the perf log, the render pipeline (the Stage's sync; both renderers draw its items), the drag's hold in the Stage and its one exit (`_endMove`), the idle outline fits (`strokeLoops`), pan/zoom, pointer input, undo/redo/clear |
| `erasePipeline.js` | the eraser and the resumable bake behind it |
| `eraseJob.js`, `eraseDescent.js`, `eraseWorkerClient.js` | one cut as a pure job; the descent as one job per family; the cuts' queue on the raster pool (`PRIO.cut`; inline only when the pool is broken or there is no worker) |
| `overlays.js` | the selection indicator and the erase debug view |
| `selection.js` | selecting, hit-testing, dragging |
| `sceneOps.js` | scenes: `refreshScenes` and `renameScene` through the scene client, `sceneZoom`, `jumpTo`/`fitView`, `snapshotView` |
| `files.js` | snapshot/dev-0 and the kobin-1 save format |
| `instruments.js` | the four measurement instruments |
| `report.js` | the dev report (§14, F58): its sections, the local extract, the whole drawing in parts, `loadReport`. Sent by `hooks/reportSend.js`, received by `tools/report-server.js`, read by `tools/report-read.js` |
| `mixin.js`, `now.js`, `rectMath.js` | the small shared pieces |

The five files after `KobinEngine.js` are **mixed onto its prototype** — they are
still the engine's methods, in another file. `mixin.js` says why it is done that
way, and throws if two files claim the same name.

| collaborator | |
|---|---|
| `LevelMap.js` | the frame lattice: addresses, crossings, projection |
| `Document.js` | natives, z-order, the undo stack; a native's picture table (`tableOf`: its own with its frame's shift, A1 C1) |
| `placementModel.js` | the document model as the Stage reads it: which natives a frame draws live, where a picture is read from and painted, a frame's footprint |
| `legacy/modelV1.js` | the inverses of the settling model, for stores and undo stacks written before A1 C1; deletion date 2026-12-31 |
| `Camera.js` | level, in-frame scale, and pan |
| `TileStore.js` | the derived-content cache; the Stage reads it (`read`, `readTiles`), and the prefetch's reads are warm (F83) |
| `Renderer.js` | the SVG renderer (`?svg`, the export); the raster one extends nothing since B-PYRAMID-3 |
| `raster/` | the raster renderer on the picture pyramid: `RasterRenderer`, `PicturePyramid` (the view, the plan, the compose), `PyramidStore`, `jobQueue`, `prefetch`, `level`, `rasterPack`, `rasterCore`, `rasterJob`, `rasterWorkerClient`, `MovePlane`, `OverlayLayer`, `antPaint`, `rasterPerf`, `plate`; the SVG layer both renderers draw with: `SvgLayer`, `LiveStrokeLayer`, `svgOverlay`, `svgAnchors`; `worker/rasterWorker.js` (the plates and the cuts) is bundled to `public/raster-worker.js` |
| `persist.js`, `format2.js`, `oplog.js`, `frameLattice.js` | the kobin-1 file, the kobin-2 store's codec and op log, the lattice constants |
| `sceneIndex.js`, `sceneClient.js`, `sceneWorkerClient.js`, `worker/sceneWorker.js` | the scene index (§11; `.claude/SCENES-PLAN.md` §6–§7): the pure core, its main-thread client (dirty set, item prep, restore, erase footprints) and its worker; saved in the file as `meta.sceneIndex`; it replaced `scenes.js`'s clustering |

`geometry/` is pure functions and no state: `loop` (the stored form), `arcShape` (the boolean),
`arcPerimeter` (the resumable bake), `biarc` (the pen), `derive`, `connect`,
`freeze`, `offsets` (the displacement table), `chordMath` (the radius-free chord arithmetic
the freeze and the rasteriser share), `antRuns`, `hittest`, `lasso`, `curveOutline`,
`polyline`, `clipperBoolean`.

### Two directories that are not shipped

- **`src/engine/__oracles__/`** — independent implementations the shipping code
  is checked against, including the whole pre-arc engine (`KobinEngineV0`).
  Reachable only from test suites, so webpack never bundles them.
  **Production code must never import from here**; an oracle the engine depends
  on has stopped being one. That folder's README says what each one checks.
- **`src/engine/__testkit__/`** — fixtures, harnesses and assertions for the
  suites. Not collected by jest.

### `clipper-lib` is still a dependency, and here is why

`geometry/polyline.js` is pure float64 with no coordinate ceiling, and it is what
sits on the hot path. `geometry/clipperBoolean.js` holds the only three functions
that still use `clipper-lib` — `strokeOutline`, `subtractPolys`,
`clipPolysToRect` — which work on a 64-bit integer lattice and therefore *have* a
ceiling.

The 2026-08-31 cleanup set out to remove the dependency and could not, because
`Renderer._fatPolys` — the windowed fat-stroke display bake — called
`strokeOutline` on a render path. **That bake was deleted on 2026-09-14
(ROADMAP S7)**, and with it `outlineMode`, the debug view that was the only way
to reach it. Nothing Clipper does now reaches the screen.

What still holds the dependency is a test: `derive.bandRings` under
`legacyOffset`, gated on `cfg.fatWidthPx == null`, which is the branch
`geometry/derive.test.js` walks to golden-compare against the V0 oracle — and
the oracle itself, which uses `strokeOutline` throughout. Dropping `clipper-lib`
means giving up the golden-compare the arc pipeline is checked against; that is
the whole of the remaining argument. (`KobinEngine.geom` also still holds a
reference to `strokeOutline` as a console handle, and nothing reads it.) The
file split is what makes the situation legible: `grep -l clipperBoolean src/`
names every place Clipper is still reached. See OPEN-FLAGS X2–X4.

---

## 16. Where everything else is

| | |
|---|---|
| `docs/OPEN-FLAGS.md` | the open defect register, F- and X-numbered. Start here when something is wrong. |
| `docs/ROADMAP.md` | the plan, the backlog, the register of deferred design changes and the DONE ledger |
| `docs/issue-log.md` | history, frozen at 2026-07-09 |
| `docs/UAT.md` | the acceptance script |
| `docs/ai/` | the same material as plain text, for an agent with no context |
| `docs/reference/` | the design bibles, handoffs, option papers, test catalogs and measurement reports this document was distilled from. Kept and tracked; consult when you need the full argument rather than the conclusion. |
| `tools/docmaps/` | generates the published Code Map, Call Graph and Call Map |

Three generated reference pages cover all of `src/`:

- **Code Map** — every function in the file that defines it, with a one-line
  summary and an expandable explanation.
- **Call Graph** — the same functions as a graph, drawn inside file blocks, with
  entry points marked and test-only functions greyed.
- **Call Map** — seven flows from the entry points as call trees, every row a
  call the source makes.

`python tools/docmaps/rebuild.py` rebuilds all three and stops at the first
failing check; `tools/docmaps/README.md` has the order. After any change to
`src/`, `verify_coverage.py` (every function is on both the Code Map and the
Call Graph) and `audit_stale.py` (neither names something the source no longer
defines) must pass. Rebuilt and republished 2026-09-23 from the working tree:
2,282 functions in 113 files, 0 missing, 0 stale.
