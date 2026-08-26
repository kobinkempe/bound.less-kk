# The Frame Lattice and the Exact Chain — Design Bible

**Status: BUILT, 2026-08-19.** Sections 0-9 are the design as agreed; section 10 records what
the implementation actually did, including the four places where building it changed the
design. Read section 10 before trusting a detail in sections 1-9.

Written *before* the measurements rather than after them, at Kobin's instruction:
*"I want to solve this logically before building anything... so we don't have to rely on
measurements, which we can only make for scenarios we can imagine, not anything we might
forget."*

Claims are labelled **[proved]** (measurement or derivation in hand), **[argued]** (follows
from the principles), **[open]** (no answer yet).

**Changes from draft 1**, both from Kobin, both structural:

* **§4.3 was wrong.** It objected that a frozen line drifts from "the true arc". There is no
  true arc after the freeze — the line *is* the source of truth, nothing can consult what it
  replaced, and self-consistency is the entire requirement. The real defect is narrower and
  is now stated correctly: the current flatten is not one freeze, it is ~800 premature ones.
* **§6 is replaced.** Re-homing is not a problem for the lattice, it is the *point* of it.
  With cell indices as an object's address, a move is integer arithmetic on one rung, deep
  members follow their ancestor with no arithmetic at all, and the per-level offset map of
  `erase-tile-window-design-bible.md` §5.1 is **no longer needed**.

When approved this supersedes §5 and §2.3 of `erase-tile-window-design-bible.md` and the
re-entry rules of `local-frames-design-bible.md`.

---

## 0. DECISIONS LOCKED (Kobin, 2026-08-18)

Nothing below this line is still being argued. Read this first.

| # | decision | Kobin |
|---|---|---|
| D1 | **A piece is `{A, B, bulge}`.** Centre and radius are derived, never carried. | — |
| D2 | **Keep the freeze.** A curve becomes a line when it is within ¼ px over a tile. | *"keep freezing for cheapness. The arc will get comically straight anyways."* |
| D3 | **Freeze late, not early** — but the requirement is determinism, not lateness. | *"The important thing about freezing is that it happens at the same time every time you bake it."* |
| D4 | **Frame = lattice cell (space). Tile = clip/freeze partition (the object).** Same size. A logical object and its ceded children share one tile grid. | *"The object is a logical object — if it's been erased and that created child-ceded zones, the child objects go with it and have the same tile/clip-boundary structure."* |
| D5 | **Frame/tile size = 131,072 units (2¹⁷), a document constant** — no longer derived from canvas size. | *"I think 96,000 is good... I don't think it matters as long as it's consistent."* then *"would 131,072 be a better ratio?"* — yes, see below. |
| D6 | **Crossing ratio 3000 → 4096**, and every related constant a power of two. | *"Would it be better to switch our thus-far constant 3000 to 2048 or 4096?"* |
| D7 | **Position is an address**: balanced base-4096 digits counting CELLS, plus a float local coordinate. | *"maybe split to 1500 either way"* (now ±2048) |
| D8 | **No migration.** A legacy file is refused with a clear error, never converted. | *"I haven't saved anything I need to keep... Nobody else has drawn anything besides me."* |
| D9 | **Over-wide strokes promote to the parent level at pen-up.** | *"it should just go into the parent frame immediately after it is drawn"* |
| D10 | **The touching-arcs case is severance-only and deferred.** Visually it needs no fix. | *"to the user, it looks like zooming in and discovering that the arcs were suuuper close but never touched. That's fine."* |

### The constants

| constant | value | note |
|---|---|---|
| `base` | 1/16 = 0.0625 | 2⁻⁴ |
| `enter` | 256 | 2⁸ |
| ratio `R` | **4096** | = enter/base. Scaling by a power of two is **exact** — only the exponent moves — so cross-level transforms stop spending an ulp per crossing, and a digit is exactly 12 bits. |
| `exit` | 1/32 = 0.03125 | 2⁻⁵, keeps the 2× hysteresis |
| frame = tile `W` | **131,072** | 2¹⁷, so `W/R = 32 = 2⁵`. Today's `38,400/3000 = 12.8` is not representable at all, so every cell origin in the current build is already slightly wrong. |
| digits | balanced `[−2048, +2048)` | an object re-homes to the **nearest** cell, so it sits near its frame origin and straddles fewer neighbours |

**Why 131,072 rather than 96,000** (Kobin asked, 2026-08-18). Both are exact — `96,000/4096 =
375/16` is a dyadic rational and `i·23.4375` never rounds for any index a digit can hold. The
gain is structural: at 2¹⁷ every lattice quantity is a power of two times a small integer, so a
cell origin costs **no mantissa bits for the step size**, only for the index. That matters
because the exponent spread is already 2¹² per crossing and eats the 53-bit budget quickly;
spending 9 of those bits on the constant itself is avoidable, and this is the last moment it is
free to avoid. Second, 4,096 px means invariant 1 holds naturally on every real display
including 4K, instead of being leaned on as soft.

The cost is ~37% more tile area (3.2 screens on a 1280 px canvas, 10 on a 411 px phone, against
2.3 and 7.3). It largely cancels: a view needs 1–4 tiles either way, so proportionally fewer are
baked, and larger tiles re-bake **less** often while panning — which is what `bufferScreens`
exists to buy. Invariant 1 (screen never wider than a frame) holds to 4,096 px and is a
**convenience, not a requirement** — invariant 2 is what matters and D9 enforces it.

---

## 1. The three failures this exists to fix

Measured 2026-08-18 on the current build.

**F-A — approximation enters the chain prematurely.** A tile is built from its *parent
tile*. A stroke's arcs are flattened to a polygon at the first magnification and every
level below inherits it. Rendered edge position against the shape's own geometry:

| depth | what paints it | measured |
|---|---|---|
| 0 | the real shape — 42 arcs | exact |
| 1 | a polygon, 793 points | 0.855 px |
| 2 | a polygon, 5 points | 263 px |
| 3–4 | a polygon, 5 points | edge not on screen |

See §4.3 for what this does and does not mean.

**F-B — re-entry is a decision that fails on a 1 px aim error.** Returning to depth 6:

| aim error at the top | held without correction | correcting on a visible landmark |
|---|---|---|
| 1 px | **new frames from depth 3** | same frames |
| 100 px | new frames | same frames |

Works today only because a person steers by what they can see. No answer at all for a spot
with nothing visible near it.

**F-C — a move destroys deep geometry.** A drag rewrites coordinates by
`displacement × 3000^k`. Pieces stay registered with each other (≤5.7e-14 px drift at every
depth) but the deep piece's own shape is destroyed: 0.12% of its area lost at 4 levels of
separation, **82.9% at 5**, coordinates reaching 7.3e18.

---

## 2. Principles

> **P1 — A swap of source of truth must be invisible at the moment it happens, and total
> afterwards.** Within ¼ px of what is on screen when it occurs; consistent with everything
> drawn under and over it; and thereafter the *only* truth — nothing may consult what it
> replaced.

> **P2 — Freeze a curve to a line only when the piece VISIBLE AT THIS LEVEL is within ¼ px
> of ONE line.** Never subdivide-and-freeze: a sub-chord is a freeze made for a span you are
> about to zoom past.

> **P3 — An arc is its two endpoints and its bulge. The centre is derived, never carried.**

> **P4 — Which frame you are in is a function of WHERE you are, not of how you got there.**

> **P5 — Position is an address, not a coordinate.** A path of integer cell indices plus one
> small local offset. A move is integer arithmetic on that path.

> **P6 — No constant that affects geometry may depend on canvas size.** (Violated today, §7.3.)

---

## 3. The arc representation

### 3.1 A piece is `{A, B, bulge}`

Today: `{line, C, r, a0, sweep, A, B}`. Under a transform `a0` and `sweep` pass through
**completely unchanged** — a similarity does not alter angles — and only `C` and `r` scale.
**[proved — `transformLoops`]** So centre and radius are redundant *and* are the only part
that can explode.

`bulge = tan(sweep/4)`, the ratio of sagitta to half-chord. Dimensionless, so magnification
cannot touch it. Everything else derives locally:

```
sagitta = (chord / 2) · bulge
radius  = (chord / 2) · (1 + bulge²) / (2·bulge)
centre  = chord midpoint + normal · (chord / 2) · (1 − bulge²) / (2·bulge)
```

### 3.1a THE CENTRE IS NEVER COMPUTED — so there is no precision ceiling

Checked operation by operation 2026-08-18; every one turns out to be local:

| operation | formula | needs the centre? |
|---|---|---|
| straightness | `(chord/2) · bulge` | no |
| bisection midpoint | chord midpoint + normal · sagitta | no |
| half-bulge (recursive split) | `(√(1+b²) − 1) / b` | no |
| **cubic control handle length** | **`(chord/3) · (1 + bulge²)`** | **no** |

The last was the one expected to need it. The textbook handle is `(4/3)·tan(θ/4)·r`; substituting
`r = (c/2)(1+b²)/(2b)` cancels the bulge out entirely. **[verified against a quarter circle:
0.55228 by both routes]**

**Consequence: §4.6's straightness/representability window is moot.** There is no 1e13 ceiling to
stay under, because the radius never materialises. The freeze (D2) is therefore an
*optimisation* — a line is cheaper than an arc — not a numerical necessity. Kobin kept it anyway:
*"keep freezing for cheapness. The arc will get comically straight anyways."*

**One numerical trap this leaves, and it is mandatory.** `(√(1+b²) − 1)/b` cancels
catastrophically for bulge below ~1e-8: `√(1+b²)` rounds to exactly 1 and the numerator becomes
0. Use the series `≈ (b/2)·(1 − b²/4)` below that threshold. Without it, bisecting a
nearly-straight arc silently returns garbage.

### 3.2 Why not Bézier

A **polynomial** cubic cannot represent an arc exactly — radial error as a fraction of r
**[proved]**:

| sweep | 180° | 90° | 45° | 22.5° | 10° | 1° |
|---|---|---|---|---|---|---|
| error | 1.8e-2 | 2.7e-4 | 4.2e-6 | 6.6e-8 | 5.1e-10 | 1.1e-15 |

A **rational quadratic** *is* exact and is equivalent information to `{A, B, bulge}`, but its
middle control point runs to infinity as the sweep approaches 180° — and **every pen cap is
exactly 180°**. Bulge handles that (`tan 45° = 1`) and only degenerates at a full circle,
which a piece cannot be. **So: bulge.**

Kobin's fallback — *"if the arc centre being too far away causes small deviations before we
turn it into a line, we can add a bulge or quadratic bezier intermediate step, with the same
logic"* — is exactly right as an escape hatch and §5.3 says why it should not be needed.

### 3.3 Clipping by bisection

Solving arc ∩ line needs the centre. Instead **bisect**, using only local values:

```
midpoint    = chord midpoint + normal · sagitta
half-bulge  = (√(1 + bulge²) − 1) / bulge
```

Recursion against the tile rect ends when a piece is wholly in or wholly out. Every
intermediate is a convex combination of local points, so nothing can cancel, at any
magnification. **[argued]**

---

## 4. The chain, and what "freezing" actually means

### 4.1 Chaining is not optional

Deriving each tile straight from the native does not work. A depth-k tile mapped back to
level 0 is `38,400 / 3000^k` level-0 units — at k=5, 1.6e-13 against coordinates of ~1e3.
The window is 1e-16 of the coordinate magnitude, below double precision. **You cannot clip
there.** **[derived]** So the chain stays. What changes is what it carries.

### 4.2 The chain carries exact arcs until the freeze

Clip the parent's arcs to this tile (§3.3), transform one edge down. Clipping an exact arc
gives an exact sub-arc — endpoints on the true arc, bulge of the sub-sweep. Transforming is
exact.

### 4.3 What the freeze is, and the one thing that is actually wrong today

**Draft 1 had this wrong.** It argued that a frozen line drifts 750 px from the true arc one
level down, and called that a defect. It is not, because **after the freeze there is no true
arc.** Nothing in the system can consult it; at that depth its centre is not even
computable. The line is the source of truth. Kobin: *"What matters is that you've switched
sources of truth, and that source of truth is consistent with what you can see when you
switch, and it's consistent with what's drawn under, and it's consistent with what's drawn
over."* Zoom into the middle of the arc-now-a-line, draw a star, come back: the star is the
same distance from that line, because the line has not changed.

The real defect is narrower:

> **The current flatten is not one freeze. It is ~800 of them, every one premature.**

Flattening replaces the arc with a polygon whose every segment is a ¼ px chord. That passes
P1 at the moment it happens — the polygon *as a whole* is within ¼ px. But a chord is only a
valid stand-in for the span it was fitted to, and the next level magnifies one segment to
fill the screen. Measured: the 793-point polygon at depth 1 becomes a **5-point** piece at
depth 2 and stays 5 points forever after. One of those 800 sub-chords has become the object.

P2 is the fix: freeze only when the piece visible **at this level** is within ¼ px of **one**
line. Everything else stays an arc and is re-clipped, exactly, at the next level.

### 4.4 The freeze is monotone, so it can never fire early

One level deeper you see a smaller portion of an arc — smaller sweep, smaller bulge. On-screen
sagitta falls by 3,000 per level. So a piece that is straight at level k is straighter at every
level below, and the decision, re-taken from exact geometry at each level, can never
un-straighten. That is why nothing needs storing and why no user ever sees a curve become a
line. **[argued]**

### 4.5 The tile seam

Kobin: *"if we zoom right into the tile seam, we'd be looking at two lines, and they have to
meet at one point."*

**They do, exactly.** Both pieces are clipped from the same source arc against the same shared
boundary, so both compute the same endpoint from the same inputs. The overlap does not have to
carry this; the shared clip does.

The remaining question is the **kink** where a frozen piece meets an unfrozen neighbour. At the
freeze threshold `sagitta = (chord/2)·bulge ≤ ¼ px` with a chord of roughly a screen, so
`bulge ≈ 0.5px / screen`, giving a sweep of ~0.002 rad and a slope discontinuity of ~0.001 rad —
about **0.06°**. Invisible. **[derived — wants a rasterized check]**

Kobin's note that this may want an antialiasing rule (only the line pushing *into* the shape
extends past the meeting point) is recorded as **[open]**, to be settled by looking at it.

### 4.6 When an arc is straight, measured

0.25 px deviation over one tile height at 300× zoom **[proved]**:

| canvas | tile height | straight once the centre is | headroom to float64's ~1e13 |
|---|---|---|---|
| 800×600 | 18,000 u | 4.86e10 u | 206× |
| 1280×800 | 24,000 u | 8.64e10 u | 116× |
| 411×750 | 22,500 u | 7.59e10 u | 132× |

**The safe window is ~100–200×. One level is 3,000×.** Narrower than a level, so straightness
must be tested at *every* level — that 4.86e10 centre becomes 1.46e14 one level down, past
where float64 stays sharp. And it is why the test must be `(chord/2)·bulge`: by the time the
centre is big enough to matter, computing it is already the unsafe operation.

---

## 5. The frame lattice

### 5.1 A frame is a lattice cell

A frame stops being "a region anchored wherever you first crossed into it" and becomes **one
cell of a fixed lattice at its level**, about one tile across.

**Aligned, not merely tile-sized.** With alignment, "which frame am I in" is a division, not
a nearest-neighbour search:

- Re-entry is a **lookup** — same place, same cell, same frame, always. **F-B has nothing left
  to fail at.**
- Neighbours are `(i±1, j±1)`.
- Frames cannot overlap, so an object is never ambiguously in two.
- `REUSE_RADIUS`, `findChild` and sibling-spawning are **deleted**, not tuned.

Free-floating tile-sized frames lose all four, and two frames could cover the same ground with
different origins. **Alignment is the load-bearing part.**

### 5.2 Exact lattice arithmetic

A child cell's origin in parent units is `(i·W, j·H)` for integer `i, j`. For the tree to be
exact by construction, `W/R` (the cell size expressed in the parent's units, `R` = the crossing
ratio) must be exactly representable in binary and `i·(W/R)` must not round. Today
`38,400 / 3000 = 12.8` is **not** exactly representable, so every cell origin is already
slightly wrong.

**Proposed (Kobin: "make it representable in binary, just pick a number that makes sense"):**

| constant | value | why |
|---|---|---|
| crossing ratio `R` | **3000**, unchanged | changing it would rescale every existing drawing |
| frame/tile size `W` | **96,000 units** = 3000 × 32 | `W/R = 32`, a power of two — `i·32` is exact for any integer to 2⁴⁸ |
| max canvas width | **4,800 px** | invariant 1 needs `width/exit ≤ W`, i.e. `width ≤ 96,000 × 0.05` |

Keeping `R = 3000` makes this the smallest possible change: `base`, `enter` and `exit` are all
untouched, only the grid size moves — from canvas-derived (38,400 at 1280 px) to the constant
96,000. The 4,800 px ceiling covers 4K comfortably. **[proposed — wants Kobin's yes]**

### 5.3 The two invariants

1. **A screen is never wider than a frame.**
2. **An object never extends past its frame's immediate neighbours** — so at most a 2×2 block
   of cells, when it sits on a four-corner junction.

Against today's constants: a tile is 38,400 units; the widest a screen gets within a level is
at the shallowest in-level zoom (0.05), where it is 25,600 units — a tile is **1.5 screens**,
so invariant 1 holds with a 1.5× margin. An object drawn there spans at most 0.67 of a frame,
so it can straddle two but never reach a third. **[proved]**

**Enforcement (Kobin, draft 2):** a native that violates invariant 2 is **promoted to its
parent level immediately after it is drawn**. Promotion divides its coordinates by 3,000, which
is a change of units and not a loss of relative precision, and the object becomes a small,
finely-detailed native one level up — where the invariant holds trivially. This closes the
pointer-dragged-past-the-screen-edge hole. **[argued]**

### 5.4 Cost

Branching factor is 3000 × 3000 = 9,000,000 cells per parent, materialised sparsely — only
visited cells exist. Consequences **[argued]**:

- A frame's children need a map keyed by `(i, j)`, not today's linear scan.
- **Empty ancestor frames must be retained**, because they carry the address of everything
  beneath them (Kobin: *"a small storage cost"*). Empty frames with no non-empty descendants
  may still be collected.

---

## 6. Position is an address (this replaces the per-level offset map)

### 6.1 The address

An object's position is:

> **a path of integer cell indices, one rung per level, each bounded 0…2999 within its parent —
> plus one small local coordinate at the leaf.**

The path is not stored per object; it *is* the frame chain, shared by everything in those
cells. An object holds a pointer to its leaf frame and its local coordinate.

### 6.2 A move is integer arithmetic in base 3000

A displacement made at level `k` is written as a positional number in base 3,000: whole cells
at level `k`, remainder carried down as whole cells at level `k+1`, and so on — terminating a
few levels down when a digit falls below anything that can matter.

Applying it adjusts the rung at each of those levels, with carries. Every quantity involved is
a small integer or a sub-cell local coordinate.

**Three consequences, all large:**

* **Deep members are not translated at all.** They are addressed *relative to their ancestor*,
  so adjusting the shared ancestor's rung moves them exactly, with zero arithmetic performed on
  their geometry. **F-C is not mitigated; it is unreachable.**
* **Move-and-move-back returns bit-exactly** — integer arithmetic with carries, not float
  translation.
* **`erase-tile-window-design-bible.md` §5.1 (per-level offsets) is no longer needed.** The
  rungs *are* the offsets, exact integers rather than floats.

### 6.3 What a move actually does

Because the old ancestor cell is shared with everything else in it, a moved family needs its
own chain from the moved level down:

1. Compute the base-3000 digits of the displacement from level `k` down.
2. Mint (or reuse) the cell at level `k` that the family lands in.
3. Copy the family's chain below `k` under it — **the rungs below are unchanged**, so this is
   a structural copy, never a coordinate rewrite.
4. Re-point each member at its new leaf. Local coordinates untouched except at the last level
   the displacement reaches.

Cost is `(deepest level − k)` small frame records per move. At realistic depth, six to ten.
**[argued]**

### 6.4 Selection becomes a tree query

Kobin: *"since we're only worrying about objects fully enclosed in the lasso... it can't be
fully enclosed if it extends to a neighbouring frame that is not included in the lasso."*

That is the whole rule, and it is exact rather than heuristic. A frame wholly inside the lasso
contributes its entire subtree without testing objects individually; wholly outside, it and its
subtree are skipped. Only frames straddling the boundary need per-object tests, and invariant 2
bounds how far an object can reach out of its own cell.

This must keep selecting things too small to render — the query prunes by **location, never by
depth**, which is exactly right.

### 6.5 Tile edges need not match frame edges

Kobin: *"the tile edges for an object may not match the frame edges, if the object has been
moved for example. This is ok."* Recorded, and it is what makes §6.3 cheap: re-homing changes an
object's address without disturbing any tiling it already has.

### 6.6 TILES belong to the object; FRAMES belong to space

**Terminology, settled with Kobin 2026-08-18.** Draft 2 called these the "freeze partition"
and the "cache partition", which were new names for things that already had names:

| Kobin's term | what it is | anchored to |
|---|---|---|
| **frame** | one lattice cell — an object's address and the spatial index | **space** |
| **tile** | where an object is clipped, and therefore where a curve may freeze to a line | **the object** |

They are the same size. A **logical object** owns one tile structure — and if erasing has ceded
child zones, those children share it, so a family clips on one partition at every level.

**Found by walking scenario C (§9.3); this is a correction to draft 2's own §4.**

If the freeze is evaluated on pieces cut by the *frame lattice*, then moving an object changes
where the cuts land on it, which changes each piece's chord, which changes the frozen line. Two
arcs crossing would then cross somewhere ¼ px away after a move — invisible at the freeze level
and **750 px away one level below it, and 3000× that again below that.** A star drawn at their
intersection would no longer be at it. That is precisely the failure this design exists to
prevent, arriving by a route draft 2 did not close.

An object's **tile** grid is anchored to the object — an origin point stored once with it,
stepped by the tile size at each level. Tile grids at successive levels are **nested**, sharing
that origin, each step dividing the one above by exactly the crossing ratio. So the
decomposition is a fixed property of the object's geometry, identical at every level, and
**completely invariant under any move** — exactly the "two numbers which say where chops and
culls are made" Kobin proposed.

**The rule that keeps tiles and frames from interfering:** freeze only on the object's own tile
boundaries, never on a frame clip. Clipping a frozen line to a frame yields a line; clipping an
unfrozen arc to a frame yields an arc with a smaller bulge, which must **not** be re-tested —
otherwise the frame boundary has silently become a freeze boundary.

Two things fall out for free:

* **Frame boundaries produce no kink at all.** Both sides of a frame edge hold the same piece,
  merely clipped. The only slope discontinuity is at the object's own tile edges (§4.5).
* **Cede rects are minted on the object's tile grid too**, which closes draft 2's open question
  6: two cedes made either side of a move land on the same grid and cannot partially overlap.

### 6.8 An address may extend BELOW the object's home level

**Correction to draft 2, from Kobin 2026-08-18.** Draft 2 claimed a move finer than an object's
own units should be refused. Kobin: *"what you're seeing at that zoom is really a tile-clipped
representation of the level 2 object, and that clipped representation has to exist in a frame
and have coordinates. Since we have to calculate it anyway, then it doesn't need to be a no-op...
if you move something 9,000,000 points at level 5, there should be a noticeable move at level 3."*

Correct, and the address model already supports it — nothing says the digits stop at the level
where the *geometry* lives. Position is a positional number; it may carry rungs finer than the
object's home. Those rungs are pure position refinement and are simply not consulted when
drawing at a level coarser than they describe.

Worked: 9,000,000 units of movement at level 5 is `9e6 / 3000² = 1` unit at level 3 — a real,
visible displacement, arrived at by accumulation. **A slow drag must therefore add up to exactly
what a fast one does, at every separation** — the M-4 property, but now guaranteed by integer
arithmetic rather than by the residue-tracking workaround of `erase-tile-window-design-bible.md`
§5.4, which can be deleted.

**A digit counts CELLS, not units** (Kobin: *"if you accumulate 3000 points of move at level 5,
level 4 accumulates 1 point, and level 5 resets"*). This matters: 3,000 level-k **cells** is
exactly 1 level-(k−1) cell, so the carry is clean and the base is exactly the crossing ratio.
3,000 level-k *units* would carry into 32 units, which is not a base at all.

**Digits are balanced: [−1500, +1500)**, Kobin's *"maybe split to 1500 either way"*. Worth
taking for a reason beyond symmetry — an object re-homes to the **nearest** cell rather than the
containing one, so it sits near its frame's origin instead of possibly hard against a cell edge,
and it straddles fewer neighbouring frames (§5.3 invariant 2 gets easier, not harder).

**How many digits you need to draw at level k — about three, not one.** Kobin: *"To draw the
object at level 3, you need both the level 3 and 4 information."* Right in shape, short by two.
With `W = 96,000` and level 3 at its deepest in-level zoom, one pixel is 1/300 level-3 units:

| digit | step, in level-3 units | as pixels at level 3's deepest zoom |
|---|---|---|
| level 4 | 32 | 9,600 px |
| level 5 | 0.0107 | 3.2 px |
| level 6 | 0.00000356 | 0.001 px |

So **level+3 is the first digit that is reliably sub-pixel**, and that is also exactly where a
float local coordinate gives out: a coordinate bounded by one tile has precision
`W / 2^52 = 2.1e-11`, which still registers a move ~3 levels finer than the home and no further.
The two bounds agree, which is the reassuring part.

**The rule:** carry a float local coordinate for the sub-cell position, and extend the address
with real digits only when a move lands **more than ~3 levels finer** than the object's home.
Stored sparsely — almost all digits are zero.

### 6.9 The endpoint invariant at a tile edge

Kobin, 2026-08-18: *"if one side converts, but the other is a tighter arc... we would need to
confirm that the endpoint of that arc continues to match perfectly the endpoint of the
already-converted line."*

This is safe **by construction**, given two rules that must be stated explicitly because both
are easy to violate by accident:

1. **A freeze replaces an arc with the chord between its OWN existing endpoints** — never a
   best-fit or least-squares line, which would not pass through them. The endpoints are then
   bit-identical before and after the freeze, so the neighbour still meets them exactly.
2. **Frame origins differ by exact integers × the frame size** (§5.2). Two pieces in adjacent
   frames therefore map to screen through transforms that agree exactly at the shared edge.

Both pieces are clipped from one source arc at one shared tile boundary, so they take that
endpoint from the same computation. With (1) and (2) it survives the freeze and the render.

**This wants a test, not an argument** — one that freezes one side, leaves the other an arc, and
asserts the two endpoints are bit-equal in screen coordinates. **[open — cheap to pin]**

---

## 7. Open questions and concerns

1. ~~The lattice constants.~~ **Answered** — §5.2 proposes `R = 3000` unchanged, frame/tile
   size a constant **96,000** units (`W/R = 32`, exact in binary), max canvas 4,800 px. Wants a yes.
2. ~~Canvas-size dependence.~~ **Answered by Kobin** — it becomes a new constant, and the
   zoom/draw/home logic must guarantee a stroke can never be drawn larger than its home frame
   (§5.3 promotion). *Was:* `makeGrid()` derived tile size from canvas dimensions and the grid is
   **serialized**, so the §4.6 straightness threshold differed per device — 18,000 units on the
   test canvas, 24,000 on desktop, 22,500 on the phone — and a document worked across devices
   baked in a *mixture*, breaking P1 at the root.
3. ~~Migration.~~ **Answered by Kobin 2026-08-18: not required.** *"I haven't saved anything I
   need to keep... Nobody else has drawn anything besides me."* A file in the old format is
   **refused with a clear error** ("legacy format"), not converted. No dual code path, no
   coordinate rewriting. This removes what was the largest single risk in the plan.
4. **Objects that touch, freezing at different levels — SCOPED DOWN, and deferred.** Two objects
   drawn to touch, with different curvature, freeze at different levels; below the first freeze
   one is a line and the other still an arc, so the tangency opens by up to ¼ px at the freeze
   level — 750 px one level down.

   **Kobin, 2026-08-18: this is not a rendering problem.** *"If you zoom in to two touching arcs,
   and then they don't touch, you couldn't have known if they touch from a distance — so to the
   user, it looks like zooming in and discovering that the arcs were suuuper close but never
   touched. That's fine."* Correct, and it means the visual case needs no fix at all.

   **What remains is severance only.** Severance asks a yes/no question about contact and relays
   the answer upward, so it must not answer *touching* at one level and *not touching* at
   another. The uncertain band is calculable — it is the freeze tolerance expressed at whatever
   level is asking, so ±¼ px at the freeze level.

   **Kobin's resolution, to build later:** when a contact falls inside that band and the answer
   cannot be decided where it is asked, **tile the area and descend to find out** — then use that
   verdict everywhere, so if the pieces turn out not to touch, they are not touching at level 0
   either. This is the existing relay of `erase-tile-window-design-bible.md` §3 run in the other
   direction, and it inherits the same bias: everything rounds toward *still whole*.

   **[open — deliberately not built yet. Scoped, understood, and not blocking.]**
5. **§4.5 — the seam antialiasing rule.** Settle by looking at it.
6. ~~Cede rects under re-homing.~~ **Closed by §6.6** — mint them on the object's freeze
   partition and they are move-invariant, so two cedes either side of a move cannot land on
   different alignments.
6b. **A move finer than the object can hold is a no-op, and should be.** Viewing level 5 and
   dragging a level-2 object 100 px asks for a displacement 3.7e-16 of the object's own size —
   below any representation. Correct to refuse, since at that magnification the object fills
   2.7e10 screens and is not visible *as* an object. But the UI should not show a drag doing
   something the model will discard. **[open — UI, not geometry]**
7. **Migration.** Existing drawings carry free-floating frames with arbitrary edges. Converting
   them to lattice cells means rewriting stored coordinates — the operation this design exists
   to avoid. Loading old frames as legacy free-floating nodes alongside lattice nodes means two
   code paths forever. **[open]**
8. **Frame garbage collection.** Today abandoned frames leak on every move-and-revisit
   (measured: 4 → 10 after five cycles). A lattice makes them re-findable, which may make the
   leak harmless — an assumption, not a result.

---

## 8. Where it plugs in

Ordered so each step is independently testable and the suite stays green throughout.

| # | change | files | risk |
|---|---|---|---|
| 1 | Piece carries `bulge`; `transformLoops` carries `{A,B,bulge}`; derive `C`/`r` at use sites | `geometry/arcShape.js` | low — additive |
| 2 | Clip by bisection | `geometry/arcShape.js` (`clipShapeToRect`) | medium — oracle-testable against today's clip |
| 3 | **Tiles keep arcs** (task #9), minify path: drop the trailing flatten, emit `shape` pieces | `geometry/derive.js`, `TileStore._downPieces` | medium — Renderer already dispatches on type |
| 4 | Freeze per P2 at paint only, via `(chord/2)·bulge` | `Renderer`, `arcShape.straighten` (exists, from F24) | low |
| 5 | Magnify path keeps arcs — **the F-A fix** | `TileStore._bakeUp`, `deriveStep` | **high** — most entangled with Clipper-era code |
| 6 | Tile size becomes a document constant (P6) | `LevelMap.makeGrid`, `persist.js` | low, but a format decision |
| 7 | Frame lattice: cells replace `REUSE_RADIUS`/`findChild`; `(i,j)` child map; neighbour query | `LevelMap`, `Camera._crossUp/_crossDown` | **high** — frame identity and save format |
| 8 | Invariant-2 enforcement: promote an over-wide native to its parent level at pen-up | `KobinEngine` pen-up path | low |
| 9 | Position as an address; move as base-3000 digit arithmetic | `Document`, `KobinEngine._dragSelection`, `persist.js` | medium — needs 7 |
| 10 | Selection via the tree | `KobinEngine._selectableRects` | low once 7 and 9 land |

**Steps 1–5 are the F-A fix and stand on their own merits whatever happens to the lattice.**
Steps 6–10 are the lattice and are one decision. Step 4 now also needs the object's freeze
origin (§6.6), which is two numbers stored at creation and never changed.

---

## 9. Scenarios walked

Worked through to check the model holds, and to find what it does not cover. §9.3 found a hole
that changed the design (§6.6).

### 9.1 The walk-in (test catalog M-1)

Draw a tiny star at level 6. Zoom out, lasso it at level 0, nudge 100 px. Zoom to level 1,
nudge again. Repeat to level 6.

A 100-unit nudge at level 0 is `100 / 38,400 = 7.81e-4` cells. In base 3,000: digit 0 at
rung 0, remainder ×3000 = **2.34** → rung 1 digit 2, remainder ×3000 = **1031.25** → rung 2
digit 1031, remainder ×3000 = **750** → rung 3 digit 750, remainder **0**. Terminates in three
digits.

So the nudge adjusts rungs 1, 2 and 3 by small integers. Rungs 4–6 untouched, local coordinate
untouched, **geometry never read or written**. Every subsequent nudge, one level finer, does the
same thing three rungs deeper. The final nudge at level 6 — the object's own level — has nowhere
left to carry to, so its remainder lands in the local coordinate as an ordinary sub-cell number.

**The rule this fixes in place:** *the remainder becomes the local coordinate, which carries
into the leaf rung when it exceeds a cell.*

**Draft 2 said digits terminate at the object's own level. That was wrong — see §6.8.** An
address may carry rungs *below* the object's home, which is what makes a move finer than the
object's own units accumulate instead of vanishing.

### 9.2 Moving a family spanning levels 0–6 (F-C / F28)

Move the family 30 px at level 0. Digits: rung 1 += 2, rung 2 += 1031, rung 3 += 750, remainder 0.

* The **level-0 parent** takes the whole 30 units into its local coordinate (sub-cell).
* The **level-6 member** takes rungs 1–3 and nothing else. Its geometry is not touched.

Are they still registered? The rung digits sum to
`(2/3000 + 1031/3000² + 750/3000³) × 38,400 = 30.000000` level-0 units — **exactly**, because the
expansion terminated. Registration is exact *by construction*, not by luck, and it is integer
arithmetic rather than float translation.

Today the same move destroys 82.9% of the deep member's area. Here the deep member is never
translated at all.

### 9.3 The star at the intersection, then move everything — THIS FOUND THE HOLE

Two arcs crossing, a star drawn at the intersection deep below. Lasso all three, move at level 0.

The addressing is fine: all three take identical digits, so their relative addresses are
unchanged.

But the **freeze** was not fine, in draft 2. The frozen line for a piece is the chord between its
clipped endpoints. If the clip comes from the frame lattice, moving the object slides the cuts
along it — different chords, different frozen lines, and the two arcs now cross up to ¼ px away
from where they did. Invisible at the freeze level. **750 px one level below, and ×3000 for every
level after that.** The star would be nowhere near the intersection.

Fixed by §6.6: the freeze partition is anchored to the object, so the cuts land on the same
physical points no matter where the object is, and the frozen lines — and therefore their
intersection — are bit-identical before and after any move.

### 9.4 Zooming into a seam

With §6.6 in place there are two kinds of boundary and they behave differently:

* **Cell boundary** — both sides hold the same piece, merely clipped. Same freeze state, same
  line or same arc. **No kink at all**, and no dependence on the overlap.
* **The object's own freeze boundary** — a frozen piece can meet an unfrozen one. They share an
  endpoint exactly (same source arc, same partition point), and the slope discontinuity is
  bounded by the sweep that permitted the freeze: ~0.002 rad, about **0.06°**. **[derived]**

Kobin's antialiasing question — whether only the line pushing *into* the shape should extend past
the meeting point — applies to the second case only, and is a look-at-it question.

### 9.5 An over-wide stroke

A stroke dragged past the screen edge can break invariant 2. At pen-up it is promoted to its
parent level: coordinates divided by 3,000, which is a change of units and not a loss of relative
precision. It becomes a small, finely-detailed native one level up, where the invariant holds
with room to spare. Its address gains a rung; nothing else changes.

---

## 10. WHAT WAS BUILT (2026-08-19)

**Every decision in section 0 is in the code**, D1 excepted (10.4c). Section 10 records the
places where building it changed the design, and the ones where an earlier build of this section
got the design wrong and had to come back to it — 10.3 and 10.4a in particular, where the tile
grid was anchored to the frame lattice and the freeze was left out, and the argument for doing so
turned out to rest on the other omission.

### 10.1 Where it lives

| piece | file |
|---|---|
| the constants and the address arithmetic | `src/engine/frameLattice.js` |
| frames as lattice cells, `displaceFrame`, neighbour/ring queries | `src/engine/LevelMap.js` |
| crossings, and the new LATERAL shift | `src/engine/Camera.js` |
| the exact chain (arcs survive the magnify) | `src/engine/geometry/derive.js` |
| the OBJECT's tile grid: the chop, the freeze, the cache-cut marks | `src/engine/geometry/freeze.js` |
| the uncle fix (ring pickup) | `src/engine/TileStore.js` |
| re-homing, geometry snapshots, address-aware undo | `src/engine/Document.js` |
| the move, and D9 promotion | `src/engine/KobinEngine.js` |
| legacy refusal, lattice frame ids | `src/engine/persist.js` |

Tests: `frameLattice.test.js` (the arithmetic), `LevelMap.test.js` (cells and re-entry),
`move.deep.test.js` (F-C, and moving things together), `chain.exact.test.js` (F-A),
`objectTiles.test.js` (D2/D3/D4 and section 6.6 — written against the design rather than against
the code, including the star-at-an-intersection scenario end to end).

### 10.2 CORRECTION — cells are CENTRED on their index

Section 5.1 left the cell's extent as "[i*G, (i+1)*G)", which puts the world origin on a cell
CORNER. Zooming into it then walks to the corner of every frame at every depth for ever, and
every object drawn there straddles four cells. Cells are centred on `i*G` instead, "which cell"
is a ROUND rather than a floor, and the origin is a fixed point of the whole descent. `t` comes
out simpler too: `-i * G * ENTER`, with no half.

### 10.3 The tile grid is the OBJECT's, and it is centred

D4 is built as written: a tile is the same size as a frame (`TILE = W`, `TILE_DIV = 1`), and it
is a different GRID from the frame lattice — the object's own, carried as a phase `(px, py)` in
`[0, W)`. Kobin's "two numbers which say where chops and culls are made", and the whole of it.

Two things about the grid are worth stating because neither is in sections 0–9.

**A phase is enough, and it survives a move for free.** Re-homing is how the lattice moves
anything by a cell or more, and it changes an object's local coordinates by exactly one frame —
so `origin mod W` is untouched by every whole-cell part of any displacement. Only the sub-cell
remainder moves the phase, and it moves it by exactly the amount it moves the ink. The grid is
therefore welded to the object through re-homing, carries and drags alike, at the cost of two
numbers and no bookkeeping. (`frameLattice.tilePhase`, `childTilePhase`.)

**Tiles are CENTRED on their index**, like cells, and for the same reason (10.2). Cornering them
on the frame origin is the same trap one level down: a centred zoom leaves the view exactly at
the origin, so every cede splits four ways at every depth. Measured while building the first
version — a hole cut at the view centre straddled four tiles at six consecutive depths and the
parent had no ink either side of it.

The cache partition (`LevelMap.tileRect`) is also frame-sized now, and is **only** a cache: it
decides how much work one bake covers. It clips arcs, which is exact, and every end it makes is
marked so nothing downstream can freeze on it (10.4).

### 10.4 The freeze, and the rule that keeps the two grids apart

D2 is built. `geometry/freeze.js`:

* **The chop.** At every crossing, before the cache clip, each object's pieces are cut at its own
  tile-grid lines. The window is the cache rect expressed in tiles — a tile is frame-sized, so a
  cache tile plus its seam pad can only ever reach two per axis, and the work is bounded by
  construction rather than by a clamp.
* **The freeze.** A chopped piece whose sagitta is within `shapeTol` becomes the chord between
  its OWN endpoints (section 6.9 rule 1), so both endpoints are bit-identical before and after
  and a neighbour that has not frozen still meets them exactly.
* **The sagitta is local.** `(chord/2) * |tan(sweep/4)|` — the bulge form. The centre never
  appears, so section 3.1a's "no precision ceiling" is preserved and a radius of 1e18 cannot
  spoil the test.
* **The tolerance is a document constant.** `shapeTol(cfg)`, which depends on `cfg` and nothing
  else — not the canvas, not the tile, not the camera. That is D3: *"the important thing about
  freezing is that it happens at the same time every time you bake it."* It is deliberately the
  same number the renderer already flattens to, so the swap of source of truth cannot be seen at
  the moment it happens.

**Section 6.6's interference rule, and A FRAME NEVER CUTS ANYTHING.**

Kobin, 2026-08-19, on reading the first version of this section: *"I can see two kinds of
trimming — tile trimming (cutting down arcs and other shapes to fit within the tile... this is
when freezing happens too) and frame trimming (we ignore objects that are not in this frame or
neighboring frames...)."* Two kinds, and only the tile one touches geometry.

The first version had a third. It clipped to the render cache's frame-aligned square, whose edge
is not a tile boundary — so two neighbouring squares held one arc cut in two different places,
froze each to its own chord, and disagreed by a quarter pixel where it happened and by 1,000 px
one level down.

`deriveStep` now clips to the object's own tile. Two squares that both hold a stretch of curve
hold the SAME pieces of it, bit for bit, freeze verdict and all. Three numbers came out of getting
there and none of them was obvious:

* **The window comes from the BARE square, not the padded one.** A tile is the same size as a
  square (D4), so an object that has not been moved needs exactly one — but a tile is half-open,
  and rounding the padded square's two edges outward asks for THREE tiles per axis. That is nine
  times the area stored per square, and it took a level-1 render from **49 ms to 258 ms**. Fixing
  the range to be half-open at the top (`objTileRange`) is what makes the whole approach viable.
* **The seam overhang is real and had no test.** S-1 requires every kind of piece to overlap its
  neighbour by `2*pad`, or antialiasing leaves a hairline down each boundary — and it had cases
  for fills, thin strokes, fat strokes and quads, but none for a SHAPE, which is what a baked
  stroke is and therefore what most of a document is made of. Clipped to the bare tile, shapes
  overlapped by **0** against a required 96. So the clip rect is the tile GROWN BY THE PAD, which
  is still a property of the object and the tile — identical in every square that holds it.
* **The overhang is not the object's edge**, and the level below must not treat it as one: it is a
  duplicate of what the next tile along holds properly, cut short, and freezing it would give a
  chord that tile disagrees with. So the clip marks the ends it made (`seamA`/`seamB`, carried
  through every transform) and a piece carrying one stays an arc. Only the sub-piece that touches
  the mark is held back; its siblings are bounded by the grid and freeze normally.

Measured after all three: level-1 render **37 ms** against 49 ms for the frame-clipped build it
replaced, deep drag 62 ms against 81, deep erase 22 ms against 31. Doing it the way the design
says came out faster than not doing it.

**Measured** (`chain.exact.test.js`, `objectTiles.test.js`): the freeze fires at the third
crossing on a normal pen stroke and everything is a line by the fourth — Kobin's *"the arc will
get comically straight anyways"*, with numbers. The painted edge is exact at depths 1 and 2 and
**0.0021 px** from the shape at depth 3, against a budget of a quarter pixel. F-A was 0.855 px,
then 263 px, then off screen.

### 10.4a Why the object's grid, and not the frame's — restated with what it cost

An earlier build of this section anchored the chop to the frame lattice and argued that D4's
purpose was met a different way, because carrying exact arcs meant nothing was frozen and a
sliding cut could not change a curve. That argument is only available if the freeze is absent,
and the freeze is D2 — so it used one dropped decision to justify dropping another. Both are
built now.

What the object grid buys, stated as the property and pinned by `objectTiles.test.js` OT-2:
chop an object, move it by any sub-cell amount, chop again, and every cut lands on the same
point of the object — bit for bit. Move the ink and leave the grid where space put it, and they
do not; that is asserted too, so the test has teeth.

It also closes draft 2's **open question 6**: a cede rect is minted on the object's grid
(`KobinEngine._bakeRehome`), so two cedes made either side of a move are a whole number of tiles
apart and cannot partially overlap. And D4's *"the child objects go with it and have the same
tile/clip-boundary structure"* is what `Document.cedeTileById` does — the parent's remnant keeps
the parent's grid, the ceded child gets that same grid in its own units, so a family clips on one
partition at every level.

### 10.4b WHAT IS STILL FLATTENED — the down path, and why it is safe

`TileStore._downPieces` still calls `shapeRingsInRect`, so **minified content is stored as
polygons**. Those are chords standing in for curves, cut on a frame-anchored grid, and moving the
object does change where the cuts land — the same shape as section 6.6's trap.

They are harmless for one reason only, and it is worth stating so that a future change does not
quietly break it:

> **A down tile is a LEAF.** `_bakeUp` reads the parent's UP tiles and natives, never its down
> tiles, so a down-path polygon is never inherited by another tile. It is also never a boolean
> operand: `_bakeOne` takes natives from the Document. So its error stays at display tolerance at
> the level that made it, and nothing magnifies it.

F-A was that error being inherited. Nothing about the down path reproduces that, but the safety
is structural rather than inherent — feed a down tile into a derivation and it comes back.

### 10.4c Two things about the freeze that sections 0-9 do not say

**D1 is still not built, and the chop uses the stored centre.** A piece is
`{C, r, a0, sweep, A, B}`, not `{A, B, bulge}` — that predates this change and nothing here
alters it. The freeze TEST is bulge-only, as section 3.1a requires, so no radius can spoil the
decision. But finding where an arc crosses a grid line does read `C` and `r`:
`u = (k - C[axis]) / r`. What keeps that safe is structural rather than careful — a line is never
chopped (it needs no cut to stay a line), and by the third crossing the freeze has turned
everything into lines, so an arc is only ever chopped at shallow depths where its centre is an
ordinary number. Build D1 and this stops depending on that argument.

**A CEDE stores exact arcs, not the frozen picture.** `_bakeRehome` goes through `projectF` and
`clipShapeToRect` rather than through `deriveStep`, so nothing a cede writes has ever been
frozen. That is deliberate: what is STORED stays exact, and only the render chain freezes.
Natives are re-read exactly at every level (`_bakeUp` takes `doc.at(parent)` fresh), so the
freeze is inherited by inherited content and by nothing else.

The visible consequence is that at the erase level the user sees the chain's chord while the cut
is made against the arc. They differ by at most the freeze tolerance — which is the number chosen
so the swap cannot be seen at the level it happens — and the cede rect itself is exact on both
sides, so the doorway a child fills is still bit-identical to the hole its parent keeps.

### 10.5 NEW — the uncle problem became routine, and is now closed

Section 5.4's cost note assumed coarser off-branch content was a curiosity. It is not. A cell
is about three screens across, so zooming in slightly off-centre shifts the camera to the next
cell along and ink that is ON SCREEN becomes a sibling of your ancestor — coarser than you, not
an ancestor. The magnify chain skipped it and the down path skipped it too, and it vanished.
Found by an erase test that cut a hole and then could not find the object.

`TileStore._ringNatives` closes it: at every step of the up-chain, pick up the natives of the
parent's eight neighbouring cells as well. Invariant 2 is what makes that complete — an object
never reaches past its frame's immediate neighbours — and the neighbours' origins differ by
whole frames, so the translation is exact. It reads through the Document's spatial index, and
measured no cost.

### 10.6 NEW — a lateral shift must never fire under the pen

Panning while drawing would otherwise move the cell the live stroke is being written in, and
its samples would be appended against a different origin. A crossing already finalizes the live
stroke; a shift instead WAITS, and D9's promotion cleans up the over-wide stroke at pen-up,
which is what that rule was for.

### 10.7 CHANGED — severance asks about GEOMETRY, not ancestry

`_familyComponents` required a member's parent to be literally `lm.parentOf(kid.level)`. Once
re-homing normalizes each member on its own local coordinates, two members of one family can
settle on different branches while sitting in exactly the same place — and the object was
reported as three objects without changing at all. The contact test now takes any member one
level coarser and maps the doorway into ITS frame. Severance is a geometric question and asking
it geometrically cannot be knocked over by an address change.

### 10.8 What the move actually does

Confirmed by measurement, at 3, 4, 5 and 6 levels of separation:

* the deep member's **area is unchanged, exactly** — the old build lost 82.9% of it at five;
* its coordinates stay inside its own frame — the old build reached 7.3e18;
* when the displacement lands on a whole cell, its geometry is **bit-identical**;
* every member of a family moves by the same world displacement, and the two deepest members'
  relative position is unchanged in the DEEPEST one's own units;
* a slow drag and a fast one produce bit-identical geometry, at every depth;
* drag-and-return, and undo, restore the geometry bit-exactly.

The residue bookkeeping of `erase-tile-window-design-bible.md` §5.4 is deleted: a drag is
recomputed from the geometry it started with, so path-independence is not something to be
arranged, it is what the arithmetic does.

### 10.10 NEW — loading settles the camera

A file records whatever the camera was, and nothing guarantees that is inside [exit, enter];
a converted one is rescaled and can land outside it too. Until it was settled, the FIRST
interaction after a load paid for the crossing. Measured on one of Kobin's recordings: the first
pan cost 200 ms and every pan after it 0.2 ms, and it read as "panning is slow" because a
benchmark averages the two. `loadSnapshot` and `loadDrawing` now call `cam.settle()`, which
brought that document's pan from 52 ms to 0.50 ms — level with the pre-lattice engine.

### 10.11 NEW — two abutting cedes meet on a point, and the ink oracle had to learn that

A cache tile is frame-sized now, so a child cell sitting on its parent's tile boundary is
ordinary rather than exotic — cell -2048 is exactly there, and a camera that has panned half a
frame lands on it. Two cedes taken either side of that boundary produce natives that ABUT
exactly: no gap, no overlap, the cut put the shared edge in both.

That is correct and it broke six tests, all in the same way. A point standing on the shared edge
is strictly inside neither region; a ray cast from it grazes whichever way it goes, so the
winding query declines to answer and the test read "no ink" at the one point where two pieces
meet. Measured on CP-1: every screen position from 380 to 420 reads ink except that one.

`__testkit__/ink.js` now counts a point that is EXACTLY on a boundary as painted, with a
tolerance of a few ulps rather than a margin — the shared edge is bit-identical on both sides, so
the quantity that should be zero comes out zero. A real hairline is still a hairline.

### 10.12 NEW — a ceded block must contain the cell the descent is about to enter

Found by MX-1 at five crossings, and it is a genuine defect that frame-sized tiles exposed
rather than caused.

`_bakeRehome` walks down one crossing at a time and cedes, at each step, the tiles the eraser
falls in. The next step then cuts inside a CELL of that frame — so if the block does not cover
that cell, the chain arrives holding only part of the cell's ink and the rest of the erase has
nothing to cut. Two things make that reachable:

* **A cell at the extreme digit is centred on its frame's own edge.** Digits are balanced, so
  cell −2048 sits at −W/2 and half of it lies outside the parent frame. With a tile the size of a
  frame, the frame's edge IS a tile boundary, so that cell straddles two tiles where before it sat
  inside one. It is not exotic: it is where the camera lands whenever a zoom point falls on a cell
  boundary, which `Math.round` resolves to the far side.
* **Past about four crossings the eraser's footprint in a coarse frame is narrower than one float
  step of `x / TILE`.** Asking which tiles it touches then collapses to one, and picks a side.

Measured before the fix: at five crossings the hole came out **18 px short against an 18 px
eraser**, and the chain looked perfectly healthy — every link present, each holding half a cell.

The fix is one line of intent: union the next frame's cell extent into the rect the tile range is
taken over. The block is then where the erase is AND where the chain is going.

### 10.9 Still open

* **D1 is not built** (10.4c). A piece is still `{C, r, a0, sweep, A, B}`. The freeze TEST never
  touches the centre, and a line is never chopped, so an arc only meets a grid line at shallow
  depths where its centre is an ordinary number — but that is a structural argument standing in
  for a representation change, and it is the last thing in section 0 still outstanding.
* **Section 7.4, the touching-arcs severance case.** Deliberately not built, exactly as scoped.
* **Section 7.5, the seam antialiasing rule.** A look-at-it question; nothing measured.
* **Section 7.6b, a move finer than the object can hold.** The model handles it (section 6.8);
  the UI question of what a drag should LOOK like at that magnification is untouched.
* **Frame garbage collection (section 7.8).** Abandoned cells are now re-findable rather than
  lost, so the leak is harmless, but nothing collects them.
* **Legacy files.** Refused, per D8. The recorded `.kobin-reports` fixtures are re-expressed by
  a TEST-ONLY converter (`src/engine/__testkit__/legacyFixture.js`) so the regression coverage
  they carry survives; nothing in the product converts anything.

  The converter has to do one thing the design did not anticipate, and it is worth knowing
  about because it says something about the invariant. A legacy frame could be anchored
  ANYWHERE — up to `REUSE_RADIUS` = 1e9 from its own origin — so re-expressing one drops its ink
  wherever that lands: measured on two of these recordings, **27,779 cells** from the frame
  holding it, against an invariant that allows one. The tile machinery quite correctly could not
  find content that far out, and two of sixty-one fixtures rendered mostly blank.
  
  This is not something an object drawn IN the lattice can do — it is drawn at the camera's
  cell, and D9 promotes anything over-wide — so the fix belongs in the converter, which now
  moves each object into the cell that actually contains it. The offset is a whole number of
  frames, so it is exact and every mapper stays exactly composable: a child's doorway still
  lands on its parent's cut, and severance is undisturbed. Invariant 2 afterwards: 0.5 and 0.8
  cells.

---

## 11. CONFORMANCE — every clause of the design conversation, checked against the code

Written 2026-08-19 after the second pass, at Kobin's instruction: *"review the design
conversation again and verify the logical design has been followed accurately."* Each row is
something Kobin actually said, not a paraphrase of the bible.

| # | what was decided | where it is | state |
|---|---|---|---|
| 1 | *"we need the tile chain carrying arcs"* | `derive.js` `shapeLoopsInRect` | **built** |
| 2 | *"each shape having its own tile grid"*, *"two numbers which say where chops and culls are made"* | `frameLattice` phase, `freeze.js` | **built** |
| 3 | *"The object subdivides on the same tiles, even if it is moved"* | phase translates with the ink | **built** — OT-2, bit-exact, with the frame-anchored contrast asserted |
| 4 | *"the tile is where you chop the arc... done the same, every time"* | `chopFreezeLoops` | **built** — idempotent and deterministic, OT-2 |
| 5 | *"keep freezing for cheapness. The arc will get comically straight anyways"* | `pieceSagitta` + `freezePiece` | **built** — fires at the 3rd crossing, all lines by the 4th |
| 6 | *"it happens at the same time every time you bake it"* | tolerance is `shapeTol(cfg)` and nothing else | **built** — D-1 (evict-and-rebuild) reproduces the picture exactly |
| 7 | *"a curve is frozen to a line if it is within one pixel of the curve at the clip boundaries, when it gets clipped"* | sagitta of the CHOPPED piece | **built** — OT-3 asserts the rule, not a number |
| 8 | *"confirm that the endpoint of that arc continues to match perfectly the endpoint of the already-converted line"* | freeze keeps A and B | **built** — OT-3, bit-identical |
| 9 | *"frames and tiles be the same size"* | `TILE = W`, `TILE_DIV = 1` | **built** |
| 10 | *"the child objects go with it and have the same tile/clip-boundary structure"* | `cedeTileById(..., kidTile)` | **built** — OT-4 walks the whole family |
| 11 | *"the tile edges for an object may not match the frame edges, if the object has been moved. This is ok"* | that IS the phase | **built** |
| 12 | *"The whole point of the lattice is that you now rehome objects"* | `displaceFrame`, `rehomeById` | **built** (first pass) |
| 13 | *"an object can only be in neighboring frames"* + *"it should just go into the parent frame immediately after it is drawn"* | invariant 2, D9 `_promoteOversize` | **built** — MD-7, MD-8 |
| 14 | *"a screen is never wider than a frame tile"* | `MAX_CANVAS_PX = 4096` | **built** |
| 15 | *"make it representable in binary"*, 3000 → 4096, W = 131072 | `frameLattice` constants | **built** |
| 16 | *"if you move something 9,000,000 points at level 5, there should be a noticeable move at level 3"* | digits carry below the home level | **built** — MD-3 |
| 17 | *"maybe split to 1500 either way"* (balanced digits) | `carryDigit`, `HALF_R` | **built** |
| 18 | *"Just throw an error message... this is a legacy file"* | `persist.decodeCrossings` | **built** |
| 19 | *"Right now, tiles are calculated once when you pass 300x zoom at that level. I guess that wouldn't change"* | unchanged | **built** |
| 20 | *"can you represent an arc perfectly with a cubic bezier?"* → D1, a piece is `{A, B, bulge}` | — | **NOT BUILT** (10.4c) — the only one left |
| 21 | *"the frame tree should tell you which objects you need to look at when selecting and zooming"* (§6.4) | `KobinEngine._lassoFind` | **built** — L-T |
| 24 | *"I can see two kinds of trimming"* — the tile cuts geometry, the frame only culls | `deriveStep` clips on `tileClipRect` + the seam pad | **built** — OT-3, S-1 |
| 22 | *"It might change how we have to do anti-aliasing... We'll have to test to see how it looks"* (§7.5) | — | **open, by agreement** |
| 23 | *"this scenario seems rare... We don't need to build that yet"* (touching-arcs severance, §7.4) | — | **open, by agreement** |

Two of these are worth saying plainly rather than leaving in a table.

**Row 20, D1.** The freeze test is bulge-only and never computes a centre, so section 3.1a's
guarantee holds where it matters. But finding where an arc crosses a tile boundary does read the
stored `C` and `r`. What keeps that safe is structural — a line is never chopped, and by the third
crossing everything is a line — rather than a property of the representation. It is the last
decision from section 0 outstanding.

**Row 21, section 6.4.** `_lassoFind` walks the tree from the active frame outward, one hop at a
time, and gives every frame one of three answers: OUT OF REACH (skip it and its subtree), ENCLOSED
(take everything in the subtree, no per-object test at all), or STRADDLING (ask its own spatial
index, and recurse). What makes the prune sound is invariant 2 — an object never extends past its
frame's neighbours — so a subtree's content is inside its own cell grown by one. D9 and
`_normalizeHome` are what keep that true; break either and this starts missing things rather than
merely being slow.

Measured on a six-level tower of twelve objects: a loop round the whole canvas tests **2** of them
and a loop in an empty corner tests **0**, and both give the identical answer to asking all twelve
(L-T). The pruning is by LOCATION and never by depth or size, so something five levels down and a
hundredth of a pixel across is still caught from the top — the property SM-4 exists to protect,
and the one a tree walk could quietly have broken.

The walk goes outward from the active frame rather than down from the root, because that is the
only direction in which the scale factor stays a number: from the root it would be R^depth before
the first useful comparison. Per-object rects still go through `mapRectF` hop by hop; the composed
factor is used only for the two frame-level decisions, which are coarse.
