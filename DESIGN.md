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

Two mechanisms keep (2) true: **D9 promotion** — an over-wide native is promoted
to its parent level at pen-up, dividing its coordinates by `R`, which is a change
of *units* and not a loss of precision — and **`_normalizeHome`**, which re-homes
an object a move has walked out of its cell. Break either and things start
silently disappearing rather than merely being slow.

---

## 2. The four structures, and what each one owns

| | what it is | owner |
|---|---|---|
| **Frame** | a cell of the lattice. Belongs to **space**. An object's address and the spatial index. Frames cannot overlap, so "which frame am I in" is a division, not a search. A frame **never cuts geometry**; it only decides which objects are looked at. | `LevelMap.js` |
| **Tile** | where an object is clipped, and therefore where a curve may be frozen to a line. Belongs to **the object**: carried as a phase `(px, py)` in `[0, W)`, two numbers, surviving every move for free, because re-homing changes local coordinates by exactly one frame and `W mod W` is zero. Same *size* as a frame, a different *grid*. | `frameLattice.js`, `geometry/freeze.js` |
| **Cache tile** | the render cache's own frame-aligned square. Decides how much work one bake covers, and nothing else. Clips arcs, which is exact. (Until 2026-09-07 it also marked every end it made, `seamA`/`seamB`, so the level below could not freeze on an edge it invented; the one-radius freeze's endpoint guard refuses such an edge on its own, and the marks are gone.) | `TileStore.js` |

All three are `W` across and were three near-identical APIs with two phase conventions. Since 2026-09-07 they are one value type, `TileGrid` (`frameLattice.js`): the object's grid is `TileGrid.at(o.tile)`, the cache's is `TileGrid.CACHE`, and a frame's own square is that grid's `(0, 0)`. `range` is the half-open rule (a rect ending on a boundary belongs below — what the chop and the cede cut on), `touching` the closed one the cache reads by; each keeps its callers' arithmetic to the bit, because which squares a cache reads and where an object's tiles fall are both things a saved drawing's deep picture depends on.
| **Object** | a native, stored in one frame. Its id is its creation order *and* its z-order. A logical object may be several natives across several frames sharing one `editId` — which is what an erase leaves when it cedes a tile downward. | `Document.js` |

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
under the pen, restitch the survivors into closed loops.

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

An eraser **is** a stroke: background-coloured ink through the pen pipeline, so
the gesture costs nothing however complex the drawing. It commits instantly and
z-order alone makes the picture correct — it covers exactly what was below it
when drawn. Folding it into the ink beneath happens later, one object per idle
slice.

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

### Order, gate and the worker (2026-09-08)

**Top-down by z, from the index.** The objects under a mark come from the spatial
index of every reachable level (plus every moved object, whose stored bits sit
elsewhere than its picture), sorted by z, highest first, cached on the mark until the
document changes (`_candidatesUnder`). Before this the bake walked every object of
every level per mark at ~0.6 ms each: on the 12,849-object canvas five minutes a mark
before the next mark got a turn, and a second per pointer-up, because the selection
barrier asked the same question (erase.stuck.probe.js).

**The mark's z follows the bake down** (Kobin's design). After each object the mark
has handled — cut, grazed, refused or not touching — its z steps to just below that
object's z, once no unhandled object shares the z. Pieces a cut mints inherit their
parent's z and so land above the mark. The mark is white ink on a white ground, so at
every moment the picture is right: objects above it show their holes, objects below
it are hidden by it — and the move gate is the z order: `_flushErasesFor` skips what
sits above the mark. The barrier never lowers the mark (it bakes out of order); the z
rides the log as a `put` of the mark and a reload resumes above it.

**A target the bake cannot take is done**, with the refusal on the gesture's journal
note; a mark with nothing left under it is consumed. Nothing retries.

**One cut is a job** (`eraseJob.js`): the boolean, the removal measured locally, the
graze rule (in place, or the cede's), the components and the dust cull, on loops in
and Loops out — the same function on the main thread and in the erase worker
(`public/erase-worker.js`, esbuild's bundle of the geometry layer; `npm run
build:worker`, run before start and build). The pipeline dispatches one cut at a
time and applies the result on the main thread (`_applyCut`); a result whose target
is gone or changed (`_ver`) is dropped and the target baked again; a worker failure
runs the job inline; where there is no worker (jsdom, an old browser) the job runs
inline, so every erase suite checks the same geometry. The barrier stays synchronous:
"if an object is baking, you can't even select it until it is baked", and a cut in
flight for that object is baked on the spot, its late result dropped.

**The descent is one job per family** (`eraseDescent.js`, Kobin's design: "invalidate
the whole object, wait till the worker sends the new object shapes back, then swap the
one object/family out for the new generated family"). The target is the only real
object the job reads; every cede is virtual, each level's square ink derived in the
job exactly as the tile store derives it for that one object (`classifyUp`,
`solidQuad`, `deriveStep` on the same numbers), so the kid a cede mints is the store's
piece bit for bit; nothing touches the document until the whole descent has succeeded,
so a refused last link needs no unwinding. The worker gets the target, the eraser and
the lattice (`LevelMap.serialize`) and returns the steps; `_applyDescent` mints the
family with real ids in the order `cedeTileById` gave them and records the steps on the
gesture's op. Inline where there is no worker, and for the barrier. The frames the job
mints on its lattice copy (a kid is homed by the carry, often a cell over from any frame
the engine has visited) come back with the steps and are merged into the engine's lattice
before a kid is added; a load mints any frame its natives name (F67).

**Dust is what could not be seen** (Kobin, 2026-09-08). A fragment a cut leaves is
dust when it is narrower than a quarter of a pixel at the zoom the mark was drawn at
(`bakePx`, the mark's pixels per unit, through the frame factor into the subject's
units; `eraseJob.dustBarFor`). Not the pen's hundredth, which culled the slivers a
4 px eraser carves at 561,917× into a stroke drawn at 1× — ink the user shaped. A
rect cut with no mark behind it keeps the pen rule.

**The boolean's classifier** was the cost, not the cuts: every fragment of A was
ray-tested against every piece of B and back, so a 641-piece object under an eraser
whose perimeter has 1,205 pieces cost 2.6 s with seven crossings and 2.8 s with none,
twice (the removal measure). `RayIndex` buckets each shape's pieces, per ray
direction, by the extent of their box along the ray's normal; a query visits the
bucket the ray's line falls in and its neighbours, and the answer is `rayCross`'s
own. Measured on the same cuts: 2,630 → 175 ms and 2,377 → 143 ms, results identical.

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
parent-child made one unchanged object report as three.

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

The whole step is recomputed from where the drag *started*, not from the previous
event, so a slow drag and a fast one apply the same arithmetic to the same
numbers.

---

## 9. Rendering

`Renderer` is the only class that touches Two.js. One persistent `Two.Group` per
object id, kept sorted by `(z, id)`; a per-frame diff rebuilds a group only when
its piece *signature* changes; a camera-only frame touches nothing but the world
transform and faded groups' opacity.

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
  made them; decided once per render and moved between camera steps by a CSS
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
| `downContent(F)` | every **non-ancestor** frame at depth ≥ F, projected directly (net factor ≤ 1, so it cannot explode). A view-independent cull drops sub-pixel content; a fade band tags size. |
| `ownContent(F)` | the frame's own natives, read straight out of the Document. A plain read, because a cut parent's stored rings **are** the rings to paint. |
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
judged where its picture is (F69).

**The indicator shows what is drawn.** Ants run along the render list's pieces,
so a magnified shape that the browser could not hold as arcs is shown from the
tile pieces that hold it, and a frame whose selected content is under 2 px on
screen is one dot with none of its members visited — the frame's box bounds
them all, by invariant 2, and the box is taken where the ink is drawn, through
each member's displacement table (F68). A selected member that traces to nothing —
its runs under the half-pixel minimum, or culled from the list — is a dot of its own
where its picture is, unless it is a re-homed family's kid, which shows through its
family (F73). There is no budget: every selected piece on screen is
outlined, and what a full selection costs is the repaint of its length, which
the roadmap holds.

---

## 11. Scenes

The coherent drawings hidden inside a canvas, found by deterministic ink
clustering. All distances are relative to **stroke width**, which encodes the
zoom the ink was drawn at: a window is 600 stroke widths, and two things join
across a gap of 1.5 windows. Clustering runs per adjacent frame pair, projecting
the finer level's geometry through that one crossing; union-find is keyed by
global stroke id, so membership chains across levels. Much-finer members inside a
scene re-cluster at their own scale into nested **pockets**. Re-homed patches
(anything with an `attachRect`) are excluded — a deep erase would otherwise
invent a scene every time.

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

**dev-0** (`snapshot`/`loadSnapshot`) is a second, separate format: the whole
engine state including the crossing records, carried by the diagnostic report so
a bug can be replayed exactly as it was seen. Not the save format.

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
eraser's done set is the ids its bake entries name, so an erase interrupted by a
tab close resumes where it left off; with no entries it restarts from the stroke.
Compaction never drops an entry younger than the undo window or belonging to a
pending mark. Header fields a build does not know ride through (`_extra`), and
an `attr` entry is reserved for per-object changes such as z-order.

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
doc) **last**, and deletes the parts it replaced after. A copy pushed by another
device or an old lz1 copy is replaced whole; lz1 copies still pull the old way. A
failed sync is shown in the save bar with its size and retried with a backoff,
1 min to 30 min. One push at a time (a 5 min deadline; busy holds until the SDK
settles) and one part a commit: measured 2026-09-08 on the 12,849-object canvas,
six parts a batch with the 30 s tick starting a second push beside the first had
Firestore's write stream answering `resource-exhausted` every minute for ten
minutes while the tab churned 2–3 GB; with the guard and one part a commit the
full push (27 MB gzipped, 50 parts) took 120 s, the SDK still logging that error
between batches and retrying through it.

---

## 14. Diagnostics

All dev-only, none of it on the drawing path. `src/engine/instruments.js` holds
the four instruments; `?dev` on an editor URL unlocks the panel.

| | |
|---|---|
| `perfLog` | operations over 8 ms (everything, in trace mode) |
| `frameMeter` | the gap between animation frames — the only instrument here that sees paint. Samples only around interaction. |
| `longFrames` | Chrome's long-animation-frame: script vs style-and-layout vs what is left over, which is paint and compositing. **The subtraction is the whole point.** |
| `eventLatency` | input to pixels in three phases. `presentMs` is the only one that reaches past the main thread to the compositor. |
| `growth` | heap and every cache that could grow, sampled over time. A snapshot cannot show accumulation. |
| `journal` | the last 40 **gestures** with their pointer paths, what each erase cut, and whether the object came apart. A snapshot shows the wreck; the journal shows the gesture that made it. |
| `snapshot` | the whole document, and it is a **loadable drawing** — every captured report can be replayed. |

---

## 15. The code, as it stands

85 source files, 85 test files.

### The engine

| file | |
|---|---|
| `KobinEngine.js` | the facade: construction, the compat accessors, tool and style setters, the perf log, the render pipeline, pan/zoom, pointer input, undo/redo/clear |
| `erasePipeline.js` | the eraser and the resumable bake behind it |
| `eraseJob.js`, `eraseWorkerClient.js`, `worker/eraseWorker.js` | one cut as a pure job; the worker client (inline where there is none); the worker's entry, bundled to `public/erase-worker.js` |
| `overlays.js` | the selection indicator and the erase debug view |
| `selection.js` | selecting, hit-testing, dragging |
| `sceneOps.js` | auto-scenes |
| `files.js` | snapshot/dev-0 and the kobin-1 save format |
| `instruments.js` | the four measurement instruments |
| `mixin.js`, `now.js`, `rectMath.js` | the small shared pieces |

The five files after `KobinEngine.js` are **mixed onto its prototype** — they are
still the engine's methods, in another file. `mixin.js` says why it is done that
way, and throws if two files claim the same name.

| collaborator | |
|---|---|
| `LevelMap.js` | the frame lattice: addresses, crossings, projection |
| `Document.js` | natives, z-order, the undo stack |
| `Camera.js` | level, in-frame scale, and pan |
| `TileStore.js` | the derived-content cache |
| `Renderer.js` | the only class that touches Two.js |
| `persist.js`, `format2.js`, `oplog.js`, `scenes.js`, `frameLattice.js` | the kobin-1 file, the kobin-2 store's codec and op log, scene clustering, the lattice constants |

`geometry/` is pure functions and no state: `loop` (the stored form), `arcShape` (the boolean),
`arcPerimeter` (the resumable bake), `biarc` (the pen), `derive`, `connect`,
`freeze`, `hittest`, `lasso`, `curveOutline`, `polyline`, `clipperBoolean`.

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

The 2026-08-31 cleanup set out to remove the dependency and **could not**.
`strokeOutline` has live callers: `Renderer._fatPolys` under `outlineMode`, and
`derive.bandRings` under `legacyOffset`, which is the branch
`geometry/derive.test.js` walks to golden-compare against the V0 oracle. Removing
it means deleting outline mode *and* that golden-compare — that is, the oracle
the arc pipeline is checked against. The file split is what makes the situation
legible: `grep -l clipperBoolean src/` now names every place Clipper is still
reached, and it is six files, three of them tests. See OPEN-FLAGS X2–X4.

---

## 16. Where everything else is

| | |
|---|---|
| `docs/OPEN-FLAGS.md` | the open defect register, F- and X-numbered. Start here when something is wrong. |
| `docs/issue-log.md` | the running log of what was found and what was done |
| `docs/UAT.md` | the acceptance script |
| `docs/ai/` | the same material as plain text, for an agent with no context |
| `docs/reference/` | the design bibles, handoffs, option papers, test catalogs and measurement reports this document was distilled from. Kept and tracked; consult when you need the full argument rather than the conclusion. |
| `tools/docmaps/` | generates the published Code Map and Call Graph |

Two generated reference pages cover all of `src/` function by function:

- **Code Map** — every function in the file that defines it, with a one-line
  summary and an expandable explanation.
- **Call Graph** — the same functions as a graph, drawn inside file blocks, with
  entry points marked, test-only functions greyed, and unreferenced ones struck
  through.

`tools/docmaps/README.md` has the rebuild order. Both pages must pass
`verify_coverage.py` (every function is on both) and `audit_stale.py` (neither
names something the source no longer defines) after any change to `src/`.
