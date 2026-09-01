> **PARTLY SUPERSEDED (2026-08-19).** `docs/frame-lattice-design-bible.md`
> replaces **§5** (position as per-level offsets) and **§2.3**, and deletes §5.4's
> residue bookkeeping: a move is address arithmetic now, so path-independence is
> what the arithmetic does rather than something to be arranged. §2.6/§3.2 (cut
> the tile out of the parent) shipped — see `docs/HANDOFF-cede-refactor.md`.
> Everything else here still describes the erase model.

# Erase by Tile Window — Design Bible

**Status: approved direction (Kobin, 2026-08-03). Nothing built yet.**

Supersedes every earlier deep-erase model: the giant-mask (`V2.1`, reverted), the first
re-home/`windows` attempt (reverted), and "deep cuts recorded in the erase frame" (built
and reverted 2026-07-28; that work is in `git stash@{0}`, *"deep-cut erase work"*).

Read this before touching the eraser, `TileStore`, `derive.js`, `LevelMap`, or the erase
and move paths in `Document` / `persist`.

Every decision below carries its date and, where it matters, why the alternative lost.
Every number is measured, not estimated.

---

## 1. Why this exists

`×3000` per level crossing makes "the object is far bigger than the eraser" the normal
case. Cutting a hole in an object **in that object's own frame** becomes impossible a
few crossings down. Measured 2026-07-28: at four crossings the eraser's radius is
`3.6e-14` frame units against an object `1.1e3` across — `3e-17` of its own extent, an
order of magnitude *below* float64's relative resolution. The hole's coordinates and the
object's are the same number. Clipper's widest integer range (`hiRange` 4.5e15) is still
~7× too coarse at four crossings and ~3e7× at five.

**No grid, range or origin change reaches this.** The cut has to be represented where it
is screen-sized — which is what the tile system already does for everything else.

---

## 2. The model

> **The rule: an erase cuts the representation at the level it was made in.**
> (Kobin, 2026-08-03)

Standing at an object's own home level, that representation *is* the object, so it is cut
in place — exactly as the engine does today, exactly, with no window. Anywhere else the
representation is a tile, so the erase is baked into that tile and a window opens. One
rule, two outcomes: no depth threshold to tune, and no boundary between two mechanisms
that have to be kept in agreement.

The rest of this section is the second case.

### 2.1 Cutouts nest — one per crossing — BUILT AS APPROVED

> **2026-08-06 — THE PARENT IS CUT, NOT ANNOTATED.** Everything below about nesting
> stands unchanged and is still what the code does. What changed is what the parent does
> about a ceded tile. It used to keep its geometry whole and record the rect in a
> `windows` array, which rendering subtracted per view. It now has that tile **cut out of
> its rings** (`geometry/cede.js`). Kobin's call. Read §2.6 before anything else in this
> section; the word "window" below means "the tile a parent cedes", and the rect no longer
> exists as a stored field.

**Status, 2026-08-05: built, and the nesting is load-bearing.** A "recipe" variant was
tried in between (the object carried the eraser footprint and every tile bake
re-subtracted it) and was reverted at Kobin's direction — pixel-level precision is fine,
and baking starts as soon as the eraser stroke is done. The measurements that decided it
are kept at the end of this section, because the reason nesting is necessary is only
visible in numbers.

The single most important rule, and the one that removes every precision limit:

> **A cutout is always exactly one crossing below the shape it is cut into.**

An erase at level 5 does *not* put a level-5-sized rect into the level-0 object. It puts
a **level-1** tile cutout in the parent; that level-1 tile's content carries a
**level-2** cutout; and so on down to the level-5 tile holding the actual cut. Every
cutout is `38,400 / 3000 = 12.8` units against a `38,400`-unit frame — a ratio of
`1/3000`, at every level, forever. Nothing approaches float64's floor.

Zooming five levels into a region no tile covers therefore materialises the whole
containment chain: the level-1 tile(s) the site falls in, then the level-2 tile(s) inside
those, down to level 5.

**Corollary — the wall is gone.** An earlier version of this design put the deep tile's
rect straight into the parent, which fails at five crossings: a level-5 tile is `1.6e-13`
parent units and one float64 step at parent coordinates ~1e3 is `2.3e-13`, so the window
is narrower than the smallest distance the parent's frame can express, the slit closes to
zero width, and no fill rule separates it. Nesting makes that unreachable.

#### What was actually built (2026-08-05)

`_bakeRehome` descends **one crossing at a time** along `framePath(HO, HE).down`. At each
step it takes the tile(s) of that frame the erase falls in, extracts the parent's ink
inside them, cedes that rect, and hands the ink to a child native one level down. The
last step is the only one that cuts.

Two amendments to the rule as approved, both forced by measurement:

* **A step cedes the BLOCK of tiles the erase touches, not the first one.** A gesture
  landing on a tile boundary spans two, and ceding only the tile its top-left corner
  happens to fall in bit exactly half the mark: measured, an erase straddling a seam
  under-erased by **19.5 px against a 20 px eraser**, and the result looked like a
  perfectly ordinary hole of the wrong size. The block stays small by construction — a
  tile is three screens wide at the widest in-level zoom, so a screen-sized gesture can
  never touch more than two of them per axis. Pinned by `erase.layered.slow.test.js` LX-8.

* **The eraser's outline is flattened at ITS OWN display fidelity, carried into the
  target's frame** (`tol × frameFactor(HE, HO)`), not at the target's. The constant
  `arcTolerancePx/2/enter` is half a pixel measured in frame units, which is right for ink
  that lives there and catastrophic for a stroke magnified into it: a target three
  crossings down turns a 120-unit eraser cap into one of radius 3e12, and flattening that
  to 4e-4 units wants ~2e8 points. Measured **155,000 ms for one gesture, against 585 ms
  after**. Nothing crashed and nothing looked wrong — it simply stopped. Pinned by
  `perf.layered.slow.test.js` PL-1.

**Why the recipe was not enough.** It satisfied §2.1's real requirement ("the cut is never
expressed in the coarse object's units") and it was cheaper to save. What it could not do
was requirement 6 — the erased edge is re-subtracted at every bake, so it is never one
definition shared with the fat-stroke outline — and it left the tile/window mechanism
unexercised, which is the mechanism the rest of the design is built on. Kobin's call.

**The wall, measured.** Ceding straight from the target's home to the erase level, the
ceded rect in the target's frame is:

| crossings | width in target units | outcome |
|---|---|---|
| 3 | 1.9e-8 | works |
| 4 | 9.1e-12 | works |
| **5** | **exactly 0** | silent failure — a zero-width window is recorded and no hole ever appears |

One float64 step at coordinate 400 is 8.9e-14. Nested, each step cedes 38,400 child units
= 12.8 parent units, a ratio of 1/3000 at every depth, forever. All six depths pass, and
`erase.fidelity.slow.test.js` measures mark-vs-hole agreement at **≤ 1 px at every depth
0–6**.

#### Two defects this uncovered, both measured

* **A ±4 crossings guard in `_nextEraseTarget`** — left over from when a cut had to be
  representable in the *target's* own units — meant an erase five or more crossings from
  its target **silently did nothing**: the gesture painted, the white stroke was consumed,
  and no ink was ever removed. Under the recipe there is no depth limit, so the guard is
  gone.
* **The guillotine's overlap band punched a second, spurious hole.** The subtraction
  splits the subject into "near the cut" (a boolean on a fine lattice) and "everywhere
  else" (pure float ring clipping), and those two halves were overlapped, on the same
  reasoning that makes tiles overlap. But they come from different producers with
  different orientation conventions, so wherever they overlapped the nonzero fill rule
  summed +1 and −1 to **zero**. Measured **16.8 px of ink missing in a ring around every
  cut** at two crossings' depth, and a thinner ring at every other depth. The halves now
  abut exactly: they are subpaths of ONE path, filled once, so a shared float edge
  rasterizes with no seam — the antialiasing hairline that forces tiles to overlap only
  arises between separately composited paths.

### 2.2 The parent's hidden ink is not kept

`deriveStep` computes the parent's ink inside a window **once**, at bake time, to produce
the child tile's content. After that the parent simply has a hole there. No second copy,
nothing recomputes it. (Kobin: *"were you still planning on calculating the parent
geometry that is hidden by the tile window? That seems unnecessary."*)

### 2.3 Rendering needs no new mechanism

* **Deeper than the erase** — the baked tiles are ancestors; `upContent`'s existing
  magnify chain inherits them.
* **At the erase level** — the tile content is the ink; the parent contributes nothing
  inside the cutout.
* **Coarser than the erase** — the baked content is deeper, non-ancestor content, so
  `_bakeDown` projects it directly (a minify, precision-safe at any distance) and the
  existing sub-pixel cull drops it when it stops mattering. **This is what makes zooming
  out continuous with no upward re-baking**, and it is why an earlier proposal to bake
  the erase into parent levels turned out to be unnecessary.

### 2.4 Reuse, don't reinvent

Tile baking and polygonization use the existing functions — `classifyUp`, `deriveStep`,
`solidQuad`, `strokeOutline`, `strokeStripNear`, `clipRingsToRect`, `flattenCurveNear` —
generalized where necessary rather than duplicated. Above the existing threshold,
outlines polygonize **as curves, not points**, exactly as they already do when a zoom
threshold is crossed (`curveOutline.js`, the `fatWidthPx` display gate). The eraser
gesture is itself a stroke and goes through the same polygonization.

### 2.5 Tiles overlap past their own boundary — DIAGNOSED AND FIXED 2026-08-03

Each tile is baked slightly **past** its own line so neighbours overlap rather than abut;
abutting edges each half-cover the seam pixel and antialiasing leaves a hairline
(composite two 50 %-covered opaque fills and a quarter of the background still shows).
The cutout overlaps for the same reason.

**Kobin, 2026-08-03: "This is not working exactly correctly today."** Measured, and there
were four separate defects. Every number below is from the probe; the fixes are pinned by
`geometry/seams.test.js` (S-1…S-8), each mutation-tested.

| # | Defect | Measured |
|---|---|---|
| 1 | The `forceOutline` path clipped the **centerline** to `rect ± half` while clipping the resulting **rings** to `rect ± pad`. With a stroke narrower than the pad the band stops short of the padded rect, so the two sides ABUT. This is every window-owning native, which is polygonized however thin it is. | **0.05** units of overlap where every other path gave **38.4** |
| 2 | The pad was a FRACTION of the tile (`5e-4`), so it depended on the canvas size the frame's grid happened to be captured at. | 0.96 px at 1280 px wide; **0.48 px at 640 px** — a visible hairline on exactly the small screens least able to hide it, and under the one pixel it exists to cover even on desktop |
| 3 | Thin strokes overlapped by `2·lw` (+ a round cap) instead of the pad — a different rule that is far larger for a wide stroke and far **smaller** for a thin one, so a stroke piece and a fill piece of the same object disagreed across the same seam. | 180 units for `lw = 60`, **12** for `lw = 6` |
| 4 | `classifyUp` decided "solid" against the **unpadded** rect, but the quad it emits is padded — so a window sitting just outside a tile and inside its pad was invisible to the classifier and the tile-covering quad painted straight over the neighbour's hole. | — |

**The rule now:** one seam policy, `SEAMS` in `derive.js`, applied to the ring clip, both
centerline clip windows, and the bbox cull alike. The pad is absolute and cfg-derived —
`SEAM_PX / cfg.exit` — because `exit` is the shallowest in-level zoom, where a tile is
smallest on screen and the pad has to earn its keep. Deeper in it only grows, which costs
nothing: every piece carries the same windows and cuts, so a wider overlap can never
refill a hole its neighbour cut.

`LEGACY_SEAMS` reproduces the old rule and exists only so `derive.test.js` can keep
golden-comparing `deriveStep` against `KobinEngineV0._deriveInto` byte-for-byte — the
P-1 discipline: generalize, then prove the original parameters still give the original
answer.

**Consequence for the erase, and it is a hard constraint:** because pieces overlap, two
tiles both hold a copy of the ink in the band. If each computed its own cut in its own
tile-local coordinates, the two copies of the hole would disagree by a lattice cell and
leave a sliver of ink inside it. **A cut must therefore be computed once, in coordinates
anchored to the ERASE, and merely clipped per tile** — never re-derived per tile. The
window path already works this way (`rectSubtract` is pure float on the shared window
rect, so it is tile-independent), which is why windows have never shown this failure.

Partial opacity is already solved: per-object opacity groups union the pieces before
opacity applies, so overlap is safe for translucent ink too. With grouping OFF the pad is
deliberately surrendered to zero — overlap would double-darken, and the hairline is the
lesser evil.

### 2.6 The parent is CUT, not annotated — DECIDED AND BUILT 2026-08-06

**Kobin:** *"I think it would be better to cut the tile shape out of the parent —
otherwise, this severance idea gets complicated, as beneath the part they are ceding to
the child they are still one object. So, once the tile is created, which splits the bridge
between the objects, the parent should be two objects, held together by the knowledge that
they are connected in the child."*

A ceded tile is now removed from the parent's rings by `geometry/cede.js`. `windows` and
`srcId` are gone from the model, from the save format, and from the loader (which strips
them out of older files — Kobin ruled that no migration was owed).

**Why the cut is safe when baking the ERASE never was.** The objection that produced the
window model in the first place is quoted in §2.1: a hole thousands of times finer than
the parent's own units rounds away on Clipper's grid. That is true of the *erase* and
false of the *tile*, which is `12.8` parent units — `1/3000` of the parent's own frame and
perfectly ordinary to represent. `cedeRect` is float-only anyway (`rectSubtract` +
Sutherland–Hodgman, no integer lattice), so the surviving edge IS the tile's coordinates,
bit for bit, at any distance from the origin.

**What it buys, measured in the browser rather than argued:**

| | window model | cut model |
|---|---|---|
| picture after 10 in-level zoom steps on the fast path | frozen at the first size — the per-view subtraction is cached and `zoomFactorAt` never re-renders (measured: object 3018×1608 px on screen, cache describing a 15.8×13.1 px hole) | correct at every step: hole 2→4→6→10→18→34→64 px across **one** render, at the level crossing |
| render cost, 6–9 objects on a level-3 view | **232–386 ms**, re-deriving | nothing to re-derive |
| severance below the object's own level | the parent was still one polygon under the ceded rect, so severance needed a second, worse cut from bounding boxes — and declined on any cut that was not dead straight | falls out: `cedeRect` returns connected pieces, and severance is re-labelling |

**Connectivity is one symmetric relation, asked over the whole family at once.** Kobin:
*"parents ask the child if their separate pieces are linked within the child, and the child
asks the parents if its separate pieces are linked within the parent."* Both directions
are the same edge: a parent piece and a child piece are joined when their ink meets on the
same stretch of the ceded tile's perimeter. Nodes are the family's natives, edges are those
meetings, and the object is severed exactly when the graph is disconnected
(`_familyComponents`). See §3.

**Three ways to get "connected" wrong, all found by measurement, all now pinned.** The
first two are in `cedeRect` and the third is downstream of it:

1. **A cell is not a chunk.** `rectSubtract` leaves ≤4 cells around the hole, and the ink
   inside ONE cell is routinely two separate lumps — anything being ceded has usually been
   erased before. `ringComponents` splits them, by winding (ink or hole) and by proven
   separation (boxes that do not touch). Deliberately biased: it only splits on proof,
   because an object wrongly left whole merely drags as one lump while one wrongly severed
   comes apart in the user's hands.
2. **A ring is not a chunk either.** Sutherland–Hodgman emits one ring per input ring
   *always*, so when the clip genuinely parts the ink it runs the boundary along the clip
   line from one lump to the other and back — a corridor of no width. Every ring-level
   test then agrees the two lumps are one thing. This is what §3's thinning produces every
   single round, and it is why DS-2 reported one parent piece after a gesture that had cut
   clean through the neck. `splitCorridors` finds the stretch walked in both directions and
   cuts there; the corridor has no area to lose.
3. **Clipper does not merge abutting subject paths.** A cut parent is stored as the
   guillotine cells around the hole, so every deep-erased object arrives at the next
   ordinary erase as several abutting rings — and `subtractPolys` returned one region per
   cell. Measured: three stacked rectangles gave **four** regions where the identical
   single rectangle gave two, so the band came apart into horizontal strips at the old
   tile's edges. `subtractPolys` now unions the subject first when it has more than one
   ring.

**The seam between a cut parent and its child is solved by drawing, not by geometry.**
The cut is exact, so parent and child abut with no overlap at all — and two opaque SVG
paths meeting like that antialias independently, leaving up to a quarter of the background
showing. Measured before the fix: an interior pixel lifted **18–25 % toward white** at
every in-level zoom, right down the tile edge. That is the "hairline outline around the
erase" this feature was repeatedly reported for.

An overlap is the wrong instrument here — it has to be sized against the view, which is
exactly what the old `windowPad = 2/enter` did, and it came to 2.0 px at `inScale` 300 and
**0.186 px** at `inScale` 27.9. Instead the Renderer draws a family's fill pieces as **one
path**: subpaths of a single path accumulate coverage before anything composites, so there
is no seam to cover. This is the same reasoning §2.1 already records for the guillotine's
two halves; it simply had not been applied across a family.

One exception, and it is the reason the merge is conditional: a down-piece **actually**
inside the cull ramp keeps its own group, because opacity lives on the group and folding a
fading child into the family would fade the coarse parent with it. The test is the fade
VALUE, not the presence of a `fadeTag` — every down-piece carries one, it is a size and not
an alpha, and testing for the tag kept an 11 px child out of its family at every zoom where
it was plainly visible.

---

## 3. Severance

The scenario that must work: erase 98% through an object, zoom in, erase 98% of what
remains, keep going, until at ~1e6× (≈2 crossings) the object is finally cut through.

Severance is decided **locally at each level and relayed upward**:

1. In a level-`L` tile, the surviving ink is cut in two and the cut reaches the tile edge.
2. That tile reports upward which of its boundary intervals its surviving ink still
   connects to each other.
3. The level above asks its own local question — *"is my shape cut in two by my child's
   cutout?"* — in its own coordinates at its own precision, using the child's report to
   decide whether the two sides reconnect *through* the window.
4. Repeat to the top.

Un-baked territory is un-erased and therefore trivially connected, which keeps the
structure sparse: only tiles actually erased into carry any of this.

#### How it is actually computed (2026-08-05, `geometry/connect.js`)

A window is the ONE place two levels of an object meet: the parent paints everything
outside the rect, the child everything inside, and they share exactly its boundary. So
"still one object?" is answered by walking that boundary.

Each lump's contact with the rect is recorded as intervals in a **normalized perimeter
parameter** `t ∈ [0,4)` — one unit per side, clockwise from the top-left corner.
Normalized, because the parent measures the rect in its own units and the child measures
the same rect 3000× bigger in its; in `t` those are the same numbers, which is what lets a
contact found at one level be compared with one found at the next **without ever composing
a transform across the crossing**. Overlapping intervals are unioned; the classes are
carried up; the walk stops the moment a level presents a single connected face upward,
because from there nothing above can tell the pieces apart.

Everything rounds towards *still whole*: corners count on both sides, a bare vertex touch
counts as contact, a window the walk did NOT come through is treated as a bridge, and a
severance that cannot be realised exactly (§3.2) is declined. The asymmetry is the reason
— an object wrongly left whole renders correctly and merely drags as one lump; an object
wrongly severed comes apart under the user's hands and cannot be put back.

One bug in this arithmetic is worth recording because it failed *silently in the safe
direction*, which is the hardest kind to notice: wrapping the left side's `t` from 4 round
to 0 turned a short arc up the left edge into `[0, 3.47]` — nearly the whole perimeter —
which then overlapped everything, and **severance never happened at any depth**. The
circularity belongs in the comparison (`arcsTouch` tests against ±4 shifts) and nowhere
else. Pinned by `geometry/connect.test.js`.

#### What a gesture at depth can and cannot do

Severing an object from **below its own level is a requirement and it works.** The rule is
simply: *a gesture severs when it crosses the ink at the level it is made.* Nothing about
being below the object's home level prevents that — the relay carries the verdict up the
chain a crossing at a time and it arrives as one answer.

What being deep DOES change is how much ink there is to cross. Measured on a 600 px
canvas with the eraser at its 200 px maximum, at the widest in-level zoom the level allows:

| stroke at level 0 | its height one crossing down | a gesture's reach there | crosses? |
|---|---|---|---|
| 60 units (a normal pen) | 1.8e5 u | 7.3e3 u | no |
| 2 units (a hairline) | 6.0e3 u | 7.3e3 u | **yes** |

So a hairline is severed one crossing down **in a single stroke of the eraser** — no
progression, no thinning. Anything thicker, or anything deeper, has to be thinned first,
which is exactly what §3's 98 % scenario does: the neck shrinks ~50× per round while the
zoom grows 3000×, so it converges fast. Note also that the window a level cedes is always
12.8 of its own units while the neck inside it shrinks by 3000 per crossing, so once the
cut fits inside one tile at the erase level, every ancestor above sees a window that spans
its neck. That is why the relay reaches the root.

Pinned by `erase.deepsever.slow.test.js`: DS-1 severs a hairline in one gesture one
crossing below its home, DS-2 walks §3's scenario to **four** crossings below the home
(asserting the object is still whole at every round short of the last), DS-3 checks the
halves then select, drag and undo independently, and DS-5 is the negative control — a
full-screen gesture with the largest eraser, at four depths, removes ink and severs
nothing. `erase.severance.slow.test.js` V-1 remains the open-ended version.

### 3.1 Chopping a piece off inside one tile

A fragment the erase **fully encloses** touches no tile edge, so it is severed with no
relay needed. Fragments reaching an edge go to the relay. Note an object can never be
entirely inside a tile below its home level — it is ~3000× magnified there — so there is
always ink at the boundary to be connected to.

### 3.2 On severance, the parent splits in two

**Decision (Kobin, 2026-08-03):** when the relay concludes the two sides are no longer
one global object, the parent splits into two natives. Not selection grouping, not
bookkeeping.

**How the split is realised — 2026-08-06, and it stopped being a cut at all.** Under the
window model this needed a second cut through the parent, and the implementation
(`_axisSplit`) looked for an axis that separated the components and clipped down the void
between them. That is gone, along with the defect it carried: any cut that was not dead
straight leaves the halves' bounding boxes overlapping, so it declined — which is what a
real scribbled erase always looks like, and why severance never fired in actual use.

**The parent is already in pieces.** Ceding cuts the tile out (§2.6), so by the time
anything asks whether the object came apart, `cedeRect` has returned however many connected
groups the cut left and each is its own native. Severance is therefore **pure re-labelling**
— `_resplitFamily` walks the family's connected components and mints a fresh `editId` for
each one past the first. No geometry is touched, because there is none left to cut, and the
precision question disappears with it.

Those key changes are recorded as a `rekey` step on the gesture's `eraseCommit` op, so one
Ctrl+Z unwinds the geometry AND the identity together. The first component keeps the
original key, so a selection already pointing at the object stays valid.

**A related trap, since it bit twice.** Outlining a stroke to a fill mints a new object,
and it used to mint a new family key with it — so any key held across that conversion named
nothing afterwards. `eraseReplaceById` now keeps the key whenever the replacement is a
single region: several regions is a split and the pieces are rightly strangers, but one
region is the same object with less ink.

### 3.3 A coarser erase descends and prunes

**Decision (Kobin, 2026-08-03):** an erase at level `k` walks down the nested window
chain it overlaps. A window it **fully covers is pruned outright** — subtree, fragments
and all; one it **partly covers is recursed into** and cut there.

Cheap by construction: the eraser is enormous at those depths, so nearly every window it
meets is fully covered, making the common case a delete rather than a boolean. The point
is that erasing means the same thing at every zoom — without it, ink erased at level 2 is
still sitting there when you zoom back to level 5. Undo must restore the pruned subtree,
so the prune records what it removed.

### 3.4 Tiles are invisible; identity is what moves

**Rule of thumb (Kobin, 2026-08-03): "the windows are not noticeable to the user — they
are only a tool that allows us to keep things in local coordinates when working with up
to infinite zooms."**

Every question of the form *"what happens to the ceded tile when…"* is answered by asking
what should happen to the **object**, then making the tile follow. Concretely:

* Un-erased ink inside a ceded tile **moves with the parent**, because it *is* the parent —
  only its representation lives down there. The `attachRect` moves with it: that rect is
  the doorway the two levels meet through, and a move that left it behind would part the
  object the next time anything asked.
* A piece the relay has declared **severed** does not, because it is no longer that
  object.
* Clicking inside a ceded tile selects the **parent** while the content is unsevered. The
  existing `editId` / `editGroup` indirection is the mechanism.

Since 2026-08-06 the tile leaves exactly two traces in the document: `editId`, the family
a piece belongs to, and `attachRect`, the tile a re-homed piece fills, in its own frame.
There is no third — the hole is in the parent's geometry, not in a field beside it.

---

## 4. What an erase creates

The surviving regions inside a tile become **their own natives** at that level — the same
shape as today's shallow erase (`Document.eraseReplaceById` retires the source and adds
the survivors). But per §3.4 they remain *part of the parent* until the relay says
otherwise: they ride inside the parent's window and move with it.

### 4.1 The cut is a recipe, not a finished polygon — REVERSED 2026-08-05

**Decision (Kobin, 2026-08-05): no recipes. "Pixel level precision is fine, just start
baking as soon as the eraser stroke is done."** The section below is the superseded
decision and its measurements, kept because the constraints it records still bind the
bake that replaced it.

What is built instead: the gesture commits instantly as a background-coloured stroke (so
the gesture itself costs nothing however complex the drawing is) and bakes on a timer,
one object per slice. Both operands go through `curveOutline.strokeLoops` — the SAME
builder the renderer displays fat strokes with — so the eraser's edge and the ink's edge
are one definition, not two that have to be kept in agreement. That is requirement 6, and
it is what the recipe could not deliver.

---

**Superseded decision (Kobin, 2026-08-03): recipe with a pre-unioned clip — "with an
asterisk, if it's too difficult, facets are ok."**

Storing the cut as flat polygons freezes it at the erase level's fidelity; zoom within
the level below and the facets grow to ~750 px. Instead, each level's tile bake re-runs
the subtraction at its own fidelity, so the cut edge is smooth at any zoom. The
bake-only fallback is a strict subset — nothing else in this document changes if we take
it.

**Constraints, all measured (§6.5):**

* The clip must be a **pre-unioned ring set**, built once at the gesture's own level and
  thereafter **mapped**, never rebuilt. Raw `strokeStripNear` output is 62
  self-overlapping rings and costs 8–33 ms per tile per object — the band self-union
  problem reappearing inside the boolean instead of inside the offset. Unioned, the same
  work is ~1 ms.
* Magnification is *not* a risk provided the eraser takes the windowed analytic path
  every fat stroke already takes; `strokeStripNear` is magnification-independent.
* **Severed pieces bake.** Once a piece is cut loose and moved independently, a shared
  eraser no longer describes where its edges are, so it is frozen at the level it was
  severed at. This is what keeps "a wild erase splitting an object into hundreds of
  pieces" cheap: the pieces cost about one object's worth in total, hold only their own
  geometry, and being immutable are trivially deterministic.

### 4.2 The eraser is bound to the ink it cut

**Decision (Kobin, 2026-08-03): "Each object copies its small, relevant piece of the
eraser, which is done during the bake (which may not be a full bake now)."**

At bake time each affected object takes a copy of **only the portion of the eraser's
unioned rings relevant to it** — clipped to its own tile/extent — expressed in its own
coordinates. The stored clip is therefore bounded by the tile, not by the length of the
gesture, and the sum across objects stays bounded.

This binding is what makes both failure modes impossible:

* Move an erased object and its cut travels with it, because the clip is part of that
  object's own data. (A space-anchored eraser would leave the hole behind — the "erase
  doesn't follow the ink" behaviour already rejected once.)
* Move an *un-erased* object into that region and nothing happens to it, because it holds
  no clip.

---

## 5. Moving, anchoring, and selection

### 5.1 DECISION — position is a per-level offset, never rewritten coordinates

**Kobin, 2026-08-03: "I want consistency" — every object, always.**

An object's `pts` are immutable after creation. Its position is a **sparse map of
per-level offsets**, one small vector per level it was ever moved at. A drag at level `k`
adds to `move_k` in level-`k` units, where the number is screen-scale and therefore
always well-conditioned. The offset is applied *during the chain descent*, at its own
level, folded into that crossing's translation:

```
x_k = (x_{k-1} · s + t.x) / base + move_k.x      ≡      t'.x = t.x + move_k.x · base
```

Why this is affordable (Kobin's reasoning, confirmed):

* **Cost is one add to a constant already being computed**, per object per crossing.
  Coarser moves are already folded in by the recursion; finer ones are added on the way
  down and dropped once below that level's resolution. No large number ever
  materialises, because every step is tile-clipped.
* **No new frame-tree nodes.** Offsets live on the object, so `doc.levels()` and
  `_bakeDown`'s walk over content-bearing frames are unchanged. A frame per object would
  have made that walk O(objects) per tile — the one real performance risk in "every
  object, always", and this form avoids it.
* **Drags get cheaper than today:** `pts` never change, so a move no longer busts
  `_bbox` / `_dispFlat` / `_flat` / `_outline` or forces a re-flatten.
* **Registration is exact by construction** — every member of a group move records the
  same physical displacement in its own level's units, so nothing is rounded into a
  coarse object's coordinates. That rounding was the entire source of the drift in §6.3.
* **Move-and-move-back returns exactly**, since `+Δ` then `−Δ` restores the offset to
  zero. Rewriting `pts` does not guarantee that.

### 5.2 How tile anchors actually work

A tile's identity is `(frame id, i, j)`; its rect comes from the **frame's grid**, a fixed
lattice that is a pure function of canvas size, `base` and `bufferScreens` (`makeGrid`),
stored on the frame and serialized. The **frame** is the anchor: its `{s, t}` edge to its
parent is established the first time it is crossed into and never changes.

* *If a tile is evicted, how does it know where it is anchored?* It never forgot.
  Eviction discards baked content only.
* *What if the object baked into that tile moves away?* Nothing happens to the tile. It
  is a fixed region of frame space, not a container; it re-bakes with whatever is there
  now, possibly nothing.
* *An object's location is a local translation of…* its **frame**, not its tile.

Nothing anchors a deep native to a coarse object. That is the whole of the problem in
§6.3–§6.4.

### 5.3 Selection and multi-select

**Restyling is being removed** (Kobin, 2026-08-03). Colour, size and opacity editing of a
selection all go, and the selection style box goes with them. Any question of the form
"does a restyle reach inside a window" is therefore moot.

Multi-select replaces it:

* **Click** — selects one object, as today.
* **Click-and-drag** — draws a selection lasso. Everything **fully bounded** by the lasso
  is selected, *including objects too small to see*.
* **Click elsewhere** — drops the lasso selection and selects that object instead.
* **Ctrl** — adds to / removes from the selection, and allows lassoing further objects.
  Ctrl with a lasso **overlapping** the current selection adds everything in it; Ctrl with
  a lasso drawn **purely inside** the current selection removes those objects.
* UI details are open; use judgement for now.

Note "fully bounded" naturally excludes objects far larger than the view — which were
exactly the ones whose motion could not be recorded. The per-level offsets make that safe
anyway, but the two rules agree.

### 5.4 Pre-existing bug to fix regardless: drag steps don't accumulate — FIXED

`_dragSelection` applies and rounds **each pointer event separately**. At four crossings
of separation every individual 1-px step is below one ulp of a coarse object's
coordinates and is discarded, so forty consecutive 1-px steps move the object **zero**
pixels while a single 100-px flick moves it correctly. **A slow drag moves less than a
fast one.** Fix: track the drag's target and apply `target − current` each event so
residue accumulates. Independent of everything else here.

**Done 2026-08-03.** `_dragSelection` measures from where the drag STARTED and credits
only what the geometry actually took — read back off the object, not assumed — so a step
the coordinates could not represent stays owed and is re-requested next event.
`move.drag.test.js` sweeps depths 2–4 against five in-level zooms, because whether a
single step survives depends on how one ulp compares with it and that ratio moves with the
zoom: a single camera position proves nothing. Mutation-tested — restoring the per-event
delta fails four of the fifteen cases.

---

## 6. Measurements

Measured 2026-07-28 / 2026-08-03 on an 800×600 test canvas unless noted.

### 6.1 Constants

| Fact | Value | Source |
|---|---|---|
| Magnification per crossing | `enter/base` = 300/0.1 = **3000** | `DEFAULTS` |
| Tile size in frame units | `(1 + 2·bufferScreens) × width / base` = **30 × width** (38,400 at 1280 px) | `LevelMap.makeGrid` |
| A tile in its parent's units | 12.8 — always `1/3000` of a frame | §2.1 |
| In-frame cut exact to | **3 crossings**; impossible at 4 | probe |
| float64 step at coordinates ~1e3 | `2.3e-13` | — |

### 6.2 Tile bakes are deterministic; the chain is stable

* Evicting **every** tile and rebuilding with the source untouched reproduces the edge
  **bit-identically** at 1, 3 and 5 crossings. The "ejecting tiles is safe because the
  recomputation is identical" intent holds.
* Nudging the source by **one ulp** moves the deep rendering by **zero px at every
  depth**. Each crossing re-quantizes to the child's own scale, so error stays *relative*
  rather than multiplying by 3000 per level. This disproves the obvious fear that 1 ulp at
  level 0 becomes thousands of px at level 5.

### 6.3 Moving, as it works today

`_dragSelection` converts the pointer delta into each object's own home frame
(`frameFactor(activeFrame, home)`) and adds it to the stored points. Dragging a level-0
object (coordinates ~200) from N crossings down:

| viewing depth | 100 px flick | 1-px-at-a-time drag | ulp on screen |
|---|---|---|---|
| 0–3 | 100.000 px, 0.00% error | smooth, 1 px steps | ≤ 0.003 px |
| 4 | 100.000 px, 0.00% error | **never moves at all** | 6.25 px |
| 5 | **0 px** | never moves | 25,600 px |

Moving a big level-0 object and a tiny deep native **together** by 30 px, then evicting
and rebuilding — their relative position drifts by:

| separation | drift |
|---|---|
| 1 crossing | 0.000 px |
| 2 | 2.8e-8 px |
| 3 | 9.3e-4 px |
| **4** | **1.43 px** — visible |
| **5** | **30 px** — the whole drag; the coarse object never moved |

### 6.4 The "walk it in" test

Draw a tiny object at level 5 on blank paper, zoom out, nudge it 100 px from level 0:

| drawn at | coordinate after | ulp there | the 40 px mark |
|---|---|---|---|
| L1 | 3.05e5 | 6.8e-11 | intact |
| L2 | 9.0e8 | 2.0e-7 | intact |
| L3 | 2.7e12 | 6.0e-4 | intact to display precision |
| L4 | 8.1e15 | 1.8 | quantized, 368.345 → 369.000 |
| **L5** | **2.43e19** | **5,400** | **collapses to zero length** |

Not merely misplaced — destroyed. §5.1 is what fixes this.

### 6.5 Cost of the recipe

Magnification is not the risk, provided the eraser takes the windowed path:

| 400-point eraser band | `strokeStripNear` | full `strokeOutline` |
|---|---|---|
| ×1 | 1 ms | 111 ms |
| ×3,000 | 0 ms | 233 ms |
| ×9,000,000 | 0 ms | not attempted |

The clip's *form* is the risk. One erase boolean on tile-bounded geometry:

| clip | subject 50 pts | 500 pts | 5,000 pts |
|---|---|---|---|
| raw strip output (62 self-overlapping rings) | 8 ms | 13 ms | 33 ms |
| **pre-unioned, single ring** | **1 ms** | **1 ms** | 12 ms |

Building the unioned ring: **3 ms once** for a 60-point eraser, ~110 ms for a 400-point
one. At ~1 ms per tile per object, a full crossing re-derive adds ~60 ms and then caches.

---

## 7. Acceptance scenarios

The design is not done until each of these is a passing test. Status as of
2026-08-03; the suite is 499 green across 38 files.

| # | Scenario | Status |
|---|---|---|
| 1 | **Progressive severing** — erase 98 % through, zoom, again, to ~1e6×, until it finally severs into independently selectable natives | ✅ `erase.severance.test.js`. Whole at *every* round, severed at round 6, across 3 crossings |
| 2 | **Chop a piece off inside one tile** — the enclosed fragment severs with no relay | ✅ V-3, including undo |
| 3 | **Chop across a tile boundary** — no hairline, no notch | ✅ Verified in **rasterized browser pixels**: 0 dark px inside the hole, 0 light px inside the ink, and the hole's edges agree to **0 px across 73 rows** |
| 4 | **Erase 5 overlapping objects, then zoom to the shared cut edge** | ✅ C-1/C-2 — all five carry the identical footprint |
| 5 | **Erase deep, then zoom out across the crossing** — shrinks continuously, no pop | ✅ W-8, and in browser pixels the hole halves 48→24→12→6→2→0 straight through a crossing while the ink stays 1275 px |
| 6 | **Erase deep, then drag the parent** — the hole rides along | ✅ M-10/M-11: the cut is part of the object; an un-erased object dragged into the same place is untouched |
| 7 | **Walk a tiny deep object in** over several rounds | ❌ **NOT DONE** — needs §5.1 |
| 8 | **Erase at level 5, then at level 2 over the same area** | ✅ existing coverage in `KobinEngine.edit.test.js` |
| 9 | **Save, reload, re-derive from cold** — identical rendering | ✅ D-4/D-6 through the real drawing format, cuts and all |
| 10 | **A slow 1-px drag moves as far as a fast flick** | ✅ M-4, swept across depths 2–4 × five in-level zooms, and mutation-tested |

Scenario 7 is the one outstanding item, and it is the one that depends on §5.1 rather than
on anything in the erase design.

---

## 8. Open questions

1. ~~What exactly is wrong with the tile overlap today (§2.5)~~ — **ANSWERED 2026-08-03**;
   four separate defects, all measured and fixed. See §2.5.
2. **Home frame after a long walk.** Offsets can carry an object far enough that the
   camera spawns a new frame near its destination. Rendering it there via the
   cross-branch path would round-trip its detail through a coarse ancestor and lose it.
   The object's implied frame probably has to become a reuse candidate for the camera.
   **Still open, and it is what blocks §5.1 and acceptance scenario 7.**
3. ~~Undo granularity for an erase spanning many tiles across many levels.~~ — moot: an
   erase touches no tiles and no levels now, only the objects it cuts, so one gesture is
   one op by construction (U-1).
4. ~~Save-size growth: each erase materialises a tile chain from level 1 down.~~ — moot:
   nothing is materialised. An erase costs one footprint per object it cuts, narrowed to
   that object's own extent (§4.2).
5. Multi-select UI (§5.3) — the style box is gone and the panel now shows identity and a
   count. Where anything richer lives is still open.

### 8.0 Precision: two causes found from real use, 2026-08-05

Reported together — pixellation at deep zooms, hairline cracks, and shapes changing after
being erased or moved — and they turned out to be two unrelated things.

**Cause 1: the integer lattice was anchored at the frame origin. FIXED.**
Clipper is an integer library, so every boolean picks a scale, and the scale was capped by
the largest COORDINATE in play — dominated by how far the drawing has been panned, a
quantity with nothing to do with the shape being cut. Measured on a band with off-lattice
edges, rounding error at the level's deepest zoom:

| panned from origin | before | after |
|---|---|---|
| 0 | 0.07 px | 0.07 px |
| 1e5 | 0.26 px | 0.07 px |
| 6e5 | 0.67 px | 0.07 px |
| 4e6 | 3.70 px | 0.07 px |
| 2e7 | **137 px** | 0.07 px |

It caused the "shape changed where I didn't touch it" symptom too, because a boolean
re-quantizes its ENTIRE subject: cutting one end of a stroke moved the other end (the far
edge landed at 390.4545 instead of 390.4568, and walked further with every later cut).

The fix (`clipperOutline.localFrame`) works in a local frame whose origin is SNAPPED onto
the lattice. Both halves matter: local, so the scale follows the shape's own size rather
than its position; snapped, so it is still the same global grid — re-centring on the
shape's midpoint without snapping would anchor the grid differently for every call, and
two booleans over abutting geometry would then round a shared edge two different ways,
which is a hairline crack. Pinned by `geometry/lattice.test.js` (28 cases, 12 of which
fail on the old code) and `precision.slow.test.js` PR-1..PR-3.

This was a REGRESSION of an existing convention, not a new problem: every pre-existing
Clipper call site already re-centred (`derive.js`, `Renderer.js`, and `_bakeRehome`'s own
last step all do `[x - cx, y - cy]`). The two call sites added for the in-place cut and for
`_paintedComponents` did not. Doing it inside the primitive rather than at each call site
is what stops it happening a third time.

**Cause 2: a baked cut is stored as a flat polygon. NOT FIXED — see §8.1.**

### 8.1 What is NOT built, stated plainly

* **§5.1, position as per-level offsets.** `pts` are still rewritten by a move. §5.4's
  accumulation bug is fixed, which removes the "a slow drag moves less than a fast one"
  class entirely, but the deeper claims of §5.1 are untouched: **M-1 (walk a tiny deep
  object in), M-2, and M-5 (relative drift after evict-and-rebuild) remain as measured in
  §6.3/§6.4.** This is a separate architectural change — it touches every transform path,
  not the erase — and it is gated on open question 2 above.
* **A baked cut is frozen at the fidelity of the level it was cut at** — and this costs
  far less than the obvious measurement suggests. Requirement 6 for erased edges. A fat
  STROKE keeps its curve loops and `derive.js` re-polygonizes it per tile at each level's
  own fidelity; an erased shape becomes a `fill` and is flattened once.

  **The obvious measurement is the wrong quantity, and it was stated wrongly here until
  2026-08-06.** Deviation of the stored polygon from the curve it approximates is 0.09 px
  at the level of the cut, 280 px one crossing down and 8.4e5 two down — real numbers that
  nobody can ever see. Kobin's rule is the right frame:

  > *"when you've zoomed in so much that the curve is less than a pixel away from being a
  > straight line, then it turns into a true line from that point on and as you zoom in
  > past there."*

  That is what the geometry does. A screen's worth of a curve of radius `R` bows by
  `W²/(8R·mag)`, so zooming in makes the visible arc STRAIGHTER. Measured on a 70-wide
  curved stroke (tightest outline radius 35 units, 800 px canvas):

  | effective mag | chords per screen | the curve's own bow across a screen |
  |---|---|---|
  | 1 | 1616 | — |
  | 300 (this level's deepest) | 5.4 | 7.6 px |
  | 9.0e5 (one crossing down) | 0.0018 | **0.0025 px** |

  One crossing down the curve has genuinely become a straight line, and so has the frozen
  polygon: a single chord spans **550 screens**. Both are straight. They sit up to 375 px
  apart, and there is no way to see both at once — nothing else in the picture references
  the ideal curve, and after an erase the whole silhouette IS the polygon.

  **What is actually visible is the corner where two chords meet, and that is an ANGLE**,
  so it is scale-invariant: it neither grows nor shrinks with depth, while the spacing
  between corners grows. Measured: median **0.14°**, max **0.36°** — 2.0 and 5.0 px of
  deviation from a straight continuation across an 800 px screen, one faint bend every few
  hundred screens. Not pixellation, and it does not degrade with depth.

  Left red on that honest quantity (`precision.slow.test.js` PR-4). Closing it is a
  TOLERANCE change, not an architecture change: turn angle goes as `sqrt(tol)`, so a 5×
  smaller corner costs 25× finer flattening and roughly 5× the vertices on every erased
  object. Note the base cost already: a 41-point stroke nicked anywhere becomes **2,203
  vertices**, because the whole silhouette freezes and not just the cut. That trade —
  smoother deep edges against vertex count on every erased object — is Kobin's call.
* **The lasso is asymmetric by design, and that is the correct behaviour.** (Confirmed
  Kobin, 2026-08-05.) The two directions differ because the rule — "everything FULLY
  BOUNDED by the loop" — means different things at different depths:

  * *From far above*, a sub-pixel object is selected as readily as a visible one. It has a
    position and an extent whether or not the screen can show them, so a loop drawn round
    where it is contains it. Requirement; works at one through five crossings, and it can
    be dragged from up there afterwards (`select.multilevel.slow.test.js` SM-4).
  * *From far below*, a loop selects **nothing, correctly** — nothing fits inside it.
    Everything reachable down there is coarse ink magnified thousands of times, so no
    loop drawn on a 600 px canvas can bound any of it. To select at depth you **click the
    item you want**. (This is also why there is no blank paper to start a loop on: one
    crossing down, a coarse object covers the whole canvas.)

  A click from far above landing on the coarse ink rather than an invisible detail is the
  same rule seen from the other side — a click resolves to the topmost thing under the
  cursor, and the lasso is the gesture for reaching what a click cannot.
* **Severing a giant FILL by a deep erase.** Severance splits a stroke by cutting its
  centerline at the crossing, which is exact and precision-safe at any depth. A fill has
  no centerline; if its ink fits inside the connectivity window it is split exactly, and
  if it does not, it is left whole. It still renders correctly — the cut is applied
  either way — it simply keeps moving as one object. The bias is deliberate (§3): an
  object wrongly left whole is a much smaller wrong than one that splits under the user's
  hands.
* **`cedeRect` can leave two lumps in one cell joined when they overlap on both axes.**
  The same bias again, stated where it actually bites. Within a guillotine cell, two lumps
  are declared separate only when their bounding boxes do not touch — which proves it —
  and kept together otherwise, whether or not the ink meets. The notch a sweep of the
  eraser leaves is axis-aligned, which is exactly the case a disjoint box catches, so the
  scenario the design is built around (§3's progressive thinning) works at every depth
  tested. A deliberately interlocking cut inside one cell would under-sever. Note this is
  the *opposite* bias to `_familyComponents`, which is exact — the difference is that a
  wrong answer there is recoverable and a wrong cut is not.
