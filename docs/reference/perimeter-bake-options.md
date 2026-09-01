# Perimeter bake — the options, the research, and the measurements

Recovered 2026-08-13 from the session transcript. The analysis behind the A/B/C choice was
done in conversation and never written down; `HANDOFF-strokeShape.md` §5b cited "§6's
sources" and no such section existed. This file is that section.

**Read `docs/OPEN-FLAGS.md` first.** F1/F2 there say the *cost* numbers below are void
(they were measured against a polyline core that creases). The *reasoning*, the
literature, the scaling laws and the structural results all still hold — those are what
this file is for.

All measurements are on one real drawing of Kobin's: a **3,769-point stroke, 90 units
wide**, centerline 78,644 units in a 521 × 465 box.

---

## 1. The problem

The painted footprint is the **Minkowski sum of the path with a disc of radius r** —
equivalently the r-level set of "distance to the path."

Two facts from the literature shape everything:

* **For a polyline source the exact boundary is only lines and circular arcs.** Offsets of
  lines and circles are closed under offsetting; nothing else is (the evolutes of
  parabolic arcs aside). So a polyline admits an exact answer with zero tolerance.
* **Modern stroke expansion deliberately does not compute the union.** Vello's GPU stroke
  expansion emits overlapping "line soup" and lets nonzero fill resolve it — explicitly
  *weak correctness*. That is exactly what `curveOutline.js` already does, and it is why
  rendering is cheap. The union is only hard because we need it as **geometry**.

For a **cubic** source there is no exact answer: the offset of a polynomial curve is not
polynomial (there is a square root in the unit normal). Only Pythagorean-hodograph curves
have rational offsets. So a fitted approximation is unavoidable — the question is only
whether its error is *smooth* (fine) or a *crease* (fatal; see F1).

### The classic three-phase offset algorithm

*Offset every segment → trim or join **adjacent** offsets → clip globally.*

`strokeShape.js` does phases 1 and 3 and **skips phase 2**. On a finely flattened curve
consecutive capsules are ~103 mutually overlapping neighbours per piece and account for
essentially all of the work, and they all go through the general machinery instead of a
linear walk. On a non-self-intersecting curve *every* neighbour is path-adjacent, so an
adjacency pass would remove the whole density term.

### Sources

* [GPU-friendly Stroke Expansion](https://arxiv.org/html/2405.00127v1) — Vello; Euler-spiral intermediate representation; flattened polylines *or* circular arcs; the "weak correctness" argument.
* [Converting stroked primitives to filled primitives](https://dl.acm.org/doi/pdf/10.1145/3386569.3392392) — Nehab, SIGGRAPH 2020.
* [An offset algorithm for polyline curves](https://inria.hal.science/inria-00518005/document) — INRIA; the three-phase algorithm; handles self-intersecting, overlapping, small-arc input.
* [IGB-offset: loop removal by scanning of interval sequences](https://www.sciencedirect.com/science/article/abs/pii/S0167839697000381)
* [Optimal compression of a polyline with segments and arcs](https://arxiv.org/pdf/1604.07476) — Gribov, Esri.
* [CavalierContours](https://github.com/jbuckmccready/CavalierContours) — 2D polyline offsetting/combining.
* [CGAL 2D Minkowski Sums](https://doc.cgal.org/latest/Minkowski_sum_2/index.html)
* [Polygon self-intersection removal](https://quadst.rip/poly-isect.html)

---

## 2. The two scaling laws

**Coverage ratio** `ρ = (centerline length × width) / bbox area` — how many times the
stroke paints its own bounding box. This drawing: 78,644 × 90 / (521 × 465) = **29.2**.

`ρ ≈ 1` is a pen line → walk the stroke. `ρ ≫ 1` is a blob → cull through space. It is one
multiply on data you already have, so the strategy switch is free.

**Output is bounded by perimeter, not path length.** Exact arrangement, no cull, growing
prefixes:

| points | intersections computed | boundary pieces out |
|---|---|---|
| 100 | 29,214 | 85 |
| 200 | 73,960 | 138 |
| 400 | 300,952 | 141 |
| 800 | 1,201,604 | 127 |

Work quadruples when n doubles; **output does not move**. Extrapolated to 3,769 points:
~26M intersections, ~36 s. So the algorithm must be output-sensitive or nothing else
matters.

The same result from the other direction — the live boundary during an incremental build:

| after N points | live pieces |
|---|---|
| 500 | 82 |
| 1,000 | 192 |
| 1,500 | **207** |
| 2,000–3,000 | 207 |
| 3,769 | 202 |

**The boundary saturates.** Once you have enclosed an area, more scribbling inside costs
nothing permanent. Draw for another hour and the shape is still ~200 pieces. This is the
answer to "what if the picture gets more complicated."

---

## 3. The four options

| | while drawing | at pen-up | geometry stored |
|---|---|---|---|
| today — path, outline on demand | 0 | 4,469 ms *just to flatten*, then Clipper | 156,525 cubics / 1.85M verts |
| **A — batch exact** | 0 | 1,033 ms (789 cull + 244 trace) | 641 pieces, exact |
| **B — full incremental** | 7,395 ms (1.96 ms/pt) | 0 | 202 pieces, exact |
| **C — crumb + bake** | 53 ms (0.014 ms/pt) | ~590 ms (64 measured + ~525 estimated) | 641 pieces, exact |
| raster trace | 0 | ~100 ms | 292 pts, resolution-limited |

### A — batch exact
Cull (sample each capsule's own boundary; drop it if every sample is strictly inside the
union), then exact arrangement on survivors only. **216 survivors of 3,768 — 94.3 % culled.**
641 pieces out: 310 lines + 331 arcs. 244× less geometry than today.

### B — full incremental
One primitive operation: *the parameter interval of a line or circle lying inside a
capsule* — closed form, and always a **single** interval, because a capsule is convex.
Per new point: trim what's there, trim what's new, insert survivors. No arrangement, no
sweep, no intersection sorting, no midpoint classification — the batch version needs all
four. **It is simpler than batch, not just differently priced.**

Safety comes from the representation: a piece is stored as *(primitive, parameter range)*,
never as coordinates, so 3,769 successive booleans accumulate no drift.

Per-point cost: mean **1.96 ms**, p50 1.7, p95 4.7, p99 5.5, max 12.6 (at cell = 2r). At
Kobin's drawing rate (~20–30 pts/s) that is ~5 % of the budget; at 60 Hz it is 12 % of a
frame.

Two unresolved items: (i) incremental was **never cross-validated against batch** — 202
pieces vs 641, believed to be fragment merging, unproven; (ii) **the tail is unstable
across grid sizes** — max 12.6 ms at cell = 2r but **105–117 ms at other cell sizes**,
never explained. A 100 ms hitch mid-stroke would be felt. Suspect the tail if this path is
revived.

### C — crumb + bake  *(the one Kobin chose)*
An occupancy grid: per cell, a count of capsules covering it *entirely*, plus one witness
id. 540 cells for the whole shape. Sound because **ink is monotone** — burial is a one-way
door, so it can be recorded as it happens and never revisited. (An erase breaks
monotonicity, which is why a crumb belongs to one stroke and is consumed at pen-up.)

While drawing: mean **0.014 ms/pt**, p99 0.1, max 1.5, total 53 ms — 140× cheaper per
point than maintaining the true boundary.

At pen-up the cull costs **64 ms** and yields 317 candidates (91.6 % culled), against
**789 ms** for the geometric cull yielding 216. Slightly over-inclusive, which is the safe
direction. Over-inclusion is tunable — a finer grid (r/4) would tighten it for negligible
drawing cost.

Free extras from the same pass: bbox + running length gives ρ for one multiply; count-0
cells enclosed by covered ones reveal interior holes before computing anything.

### Raster trace — measured, and a dead end for the main path
1. `ctx.stroke()` the centerline at `lineWidth = 90`, round caps/joins. The rasterizer
   resolves all self-overlap for free via scanline winding — **3.2 ms**.
2. Marching squares on the black/white boundary → 1 contour, 1,949 pixels. Holes appear as
   extra contours automatically.
3. Douglas–Peucker at half a pixel → **292 points**.

Killed by resolution: accurate to ~1 px *at the resolution you rasterized*, so one level in
it is 3,000 px wrong. Cannot be a stored shape in an infinite-zoom app. Its one unique
property is that cost depends on **screen area, not path** — scribble 100× more into the
same box and it is still 3.2 ms.

Tried as a culling oracle and **lost**: 2,557 ms vs 789 ms, because it scans each
segment's disc against an edge mask, O(n·r²). Its plausible role is as a **distance
field** instead — build once (3.2 ms), then each segment is one lookup ("is my midpoint
more than r + halfLength from the boundary?") instead of ~1,600 distance tests. That is
the route from 789 ms to roughly 10 ms. **Flagged, never measured.**

---

## 4. Threading — measured, and deliberately deferred

**3 % slowdown** to main-thread work while a worker grinds continuously, on 8 cores.

Why the freeze happened: the bake *is* deferred, but only **between objects** —
`_bakeTick` hands out one object per 80 ms slice. That stroke's bake was one indivisible
job (4,469 ms flatten, then Clipper) with no point inside it where control returns.

Three fixes and their ceilings:

* **Make the work smaller** — nothing to hide if it takes 20 ms.
* **Chunk on the main thread** — a resumable state machine yielding every ~10 ms. Hard
  limit: *you can only yield at boundaries you own.* `subtractPolys` is one call into
  clipper-lib; to the scheduler it is atomic. Chunking fixes our flatten and can do
  nothing about the Clipper call. It also lands GC pressure on the drawing thread.
* **Worker** — fixes the Clipper call too, and has its own heap so its GC never pauses
  drawing.

Against doing it: **react-scripts 4.0.2 / webpack 4.** Native `new Worker(new URL(...))`
needs webpack 5; `worker-loader` is not installed and there is no CRACO. A blob-URL worker
needs no config but **cannot import the app's modules**, and `clipperOutline.js`,
`curveOutline.js` and `cede.js` all import each other.

And the real cost is not threads at all: **asynchrony against a mutable document.** What
happens if you erase again, move the object, undo, or cross a level while a bake is in
flight? Versioning every job, discarding stale results, deciding what happens when you
select something still baking — it touches every mutation path, and you pay it identically
whether you chunk or use a worker. (`_flushErasesFor` is a synchronous version of that
barrier, so the scaffolding is partly there.)

**Standing decision: smaller first, threading second, possibly never.** A worker does not
make the work smaller — 640 ms hidden is still 640 ms before the shape is real, and you
wait anyway the moment you reach for it.

---

## 5. What is void, and what replaces it

Void (F1/F2): every cost figure for A, B and C, because all three wrap a core that chords
the centerline.

Not void: the framing, the literature, ρ, the quadratic-work/flat-output law, boundary
saturation, the crumb's monotonicity argument, the raster-trace verdict, the threading
verdict, and the two unresolved items under B.

The replacement core: resolve `curveOutline`'s **offset cubics** into one perimeter,
rather than resolving line/arc pieces from a chorded centerline. `strokeOutlineCurves`
already produces correct, crease-free offset curves and already obeys the
straight-only-where-straight rule (`curveOutline.js:257`); it stops one step short of
computing the union. Needs distance-to-cubic and cubic–cubic intersection, which is
numeric rather than closed form — estimated **2–4× on the trace step**, no change to the
cull. Then A/B/C get re-measured on top of it.

---

## 6. Implementation status — 2026-08-13

Built and green: `geometry/curvePerimeter.js` (the curve-native core, 11 tests) and
`geometry/bakeStrategies.js` (the three schedules, 8 tests). 495 tests pass in the quick
suite with no regressions.

### The core

`curvePerimeter(pts, width, opts) -> { loops, stats }`, loops being closed chains of
cubics. It does **not** recompute the offset — `curveOutline` already produces crease-free
offset curves and already obeys the straight-only-where-straight rule. It cuts them up and
throws the buried parts away.

Two jobs, deliberately using different machinery:

* **Cutting** — genuine cubic-cubic intersection by recursive subdivision on control hulls.
  Precision here is structural: two pieces meeting at a junction must be cut at the same
  point or the loop has a gap.
* **Classifying** — distance to the centerline, because the union of the capsules is
  exactly `{p : dist(p, C) <= r}`. Precision here barely matters, since the test runs at a
  sub-piece's midpoint, far from any boundary. A coarse flattened oracle (r/64) is ample and
  is never emitted, so it cannot crease anything.

One correction along the way that is worth keeping: consuming `strokeOutlineCurves`'s
per-run capsule loops does **not** work. Each run's end cap genuinely crosses the next
run's offset, so resolving their union manufactures a corner at every run boundary —
measured at 146° on a stroke with no corners in it. The offsets have to be chained straight
through instead (`offsetSide` / `endCaps`).

### A bug fixed in `curveOutline.js` that predates this work

`cubicTangent` normalised any non-zero derivative. The offset fitter routinely emits cubics
whose last two control points agree to the last ULP, and normalising a 1e-13 difference
returns a confident unit vector pointing in an arbitrary direction. It now measures
"vanishes" against the curve's own control-polygon size. This was showing up as a phantom
146° kink at a join that is in fact perfectly smooth, and it would mislead any consumer
that asks a fitted offset for its tangent.

### Where the three schedules stand

`bakeStrategies.test.js` BS-1 cross-checks all three by membership on the same strokes.

| case | A | B | C |
|---|---|---|---|
| gentle curve | 0 wrong | 0 wrong | 0 wrong |
| tight wiggle | 18 wrong, 170° kink | **0 wrong, 0° kink** | 18 wrong, 170° kink |
| self-crossing | 0 wrong | **698 wrong** | 0 wrong |

**C is now provably A with work moved earlier** — identical loop counts, identical piece
counts, zero classification differences on every case. That is the pinned invariant: if C
ever diverges from A it has stopped being a schedule and become a variant.

The two remaining defects are F10 (B on self-crossing) and F11 (A/C cutting a corner into a
tight wiggle that has none). They were found *by the three disagreeing with each other*,
which is the argument for testing them against one another rather than each alone.

One bug worth recording because it cost a cycle: control point i of a Catmull-Rom spline
depends on samples i-1, i and i+1, so the last **two** control points are provisional and
must be recomputed when a sample arrives, not merely appended to. Extending from
`ctrl.length` leaves the previous tail computed as if the stroke had ended there, which is
a different curve from the one `centerlineCubics` produces — and it made C disagree with A
even though C is supposed to be A exactly.

### Timings so far — NOT yet meaningful

On a 25-sample toy: A draw 0.1 / finish 9.6 ms · B draw 9.1 / finish 0.9 ms · C draw 1.0 /
finish 6.3 ms. Per-point: A 0.003 ms, C 0.041 ms, B 0.363 ms (p99 1.58).

The shape of the answer is already visible — A and C pay at pen-up, B pays while drawing,
and B costs roughly 9x C per point — but the stroke is two orders of magnitude too small to
rank them. F12 tracks the real measurement.
