# HANDOFF — curve-native stroke shapes (`geometry/strokeShape.js`)

> **Start here instead:**
> * `docs/OPEN-FLAGS.md` — the live list of open concerns. **F1 disqualifies the core this
>   file describes** (it chords the centerline, so concave edges crease permanently), and
>   **F2 voids every performance number below.**
> * `docs/perimeter-bake-options.md` — the algorithm research, the literature with sources,
>   and the A/B/C/raster measurements. This is the section §5b used to cite as "§6's
>   sources", which never existed.
>
> Keep this file for the bug catalogue in §4 and the optimisation history in §5 — those are
> still worth reading before touching the code. Treat the conclusions as superseded.

**Status: core primitive BUILT AND GREEN (25 tests; 482 in the quick suite, no
regressions). Performance improved 6,229 -> 472 ms; not yet good enough. Uncommitted, on
`main`.** Written 2026-08-06.

## 1. The decision this implements

Kobin's call, after the analysis below: **option B — a curve-native boolean with a
resolved perimeter.** Clipper leaves the erase path entirely. Applied to fat strokes
too: a stroke becomes a shape at bake time, and **the centerline is not kept**.

Baking strategy: **crumb + bake.** A cheap occupancy grid is maintained while drawing
(14 microseconds a point); at pen-up it makes the expensive cull nearly free.

---

## 2. Why — the measurements that drove it

All on one real drawing of Kobin's: a **3,769-point stroke, 90 units wide**, centerline
78,644 units packed into a 521 x 465 box.

**Coverage ratio** `ρ = (length x width) / bbox area` = **29.2** — the stroke paints its
own bounding box twenty-nine times over. This one number is the strategy switch: `ρ ≈ 1`
is a pen line (walk the stroke), `ρ >> 1` is a blob (cull through space).

| representation | size | cost |
|---|---|---|
| overlapping capsules (today) | 1,405 loops, **156,525 cubics**, 157,930 anchors | 4,590 ms first render; **crashed Two.js** |
| flattened for Clipper (today's erase) | **1,853,649 vertices** | **4,469 ms to flatten**, before the boolean |
| raster trace | 292 points, resolution-limited | ~100 ms |
| **resolved perimeter (this)** | **~200-640 exact pieces** | target ~100-300 ms |

The 157,930 anchors are the `RangeError` Kobin hit: Two.js's `Collection` constructor
spreads its argument into `push.apply`, which gives out at **131,072** in V8 (fine at
100,000). Fixed separately in `Renderer.js` (`mkPath`, chunked pushes).

**The decisive scaling result** — exact arrangement, no cull, growing prefixes:

| points | intersections computed | boundary pieces out |
|---|---|---|
| 100 | 29,214 | 85 |
| 400 | 300,952 | 141 |
| 800 | 1,201,604 | 127 |

Work quadruples when n doubles; **output does not move**. Extrapolated to 3,769 points:
~26M intersections, ~36 s. Output is bounded by PERIMETER, not path length — so the
algorithm has to be output-sensitive or nothing else matters.

---

## 3. What is built

`src/engine/geometry/strokeShape.js` — `strokeShape(pts, width, opts) -> { loops, stats }`.

Loops are closed, CCW for outers and CW for holes, each piece either
`{kind:"line", sx,sy, ex,ey}` or `{kind:"arc", cx,cy, r, a0,a1}` traversed CCW.
**Exact — no tolerance anywhere**, because the Minkowski sum of a polyline with a disc is
bounded only by line segments and circular arcs.

Pipeline: `snapPoints` → `segmentsOf` → `Crumb` (occupancy grid) → cull → exact
boundary → `stitch` → drop sub-threshold loops.

`src/engine/geometry/strokeShape.test.js` — **23 tests, green.** The oracle is
MEMBERSHIP: for thousands of sampled points, "inside the loops" must equal "within r of
the polyline". That owes nothing to the implementation and is what caught everything.

`src/engine/geometry/strokeShape.perf.slow.test.js` — 2 tests, green. A synthetic stroke
matched to the real one's point count, width, extent and coverage ratio.

---

## 4. Five bugs the membership oracle caught (do not regress these)

1. **Cross products where DOT products belong** in line-vs-band-edge intersection.
   Returned `det = 0` for a piece parallel to the other capsule's normal — i.e. every
   right-angle corner — so corners went untrimmed while straight runs looked perfect.
2. **Duplicate cap circles.** Walking `[s.a, s.b]` per segment emits every interior
   vertex's circle twice; the stitcher orphans one and loops stop closing.
3. **Tangency blindness.** Needed explicit END-PLANE crossings (`q = 0`, `q = L`), without
   which a lone stroke's caps came out as whole circles and the stadium never closed.
4. **Hash buckets splitting coincident endpoints.** A junction is computed twice, from
   two different primitives, agreeing only to a few ULP. Rounded keys separate them when
   they straddle a bucket boundary. Stitching now searches a 3x3 neighbourhood; the same
   trap needed `snapPoints` for near-coincident vertices (a closed ring misses its own
   start by 2e-14, because `cos(2pi)` is 1 but `sin(2pi)` is -2.4e-16).
5. **The cull was UNSOUND and I had argued otherwise.** A capsule plays two roles —
   producer of boundary, and trimmer of everyone else's. Burial removes only the first.
   A candidate's INWARD offset line sits deep in the interior, where the only capsules
   covering it are the buried ones; culling those from trimming too produced a spurious
   hole of area 4,795 and 373 interior sample points reported as outside.
   **Produce from candidates; trim against everything.**

---

## 5. Performance — where it stands

Synthetic stroke, 1,963 points, coverage 29.4x → 512/1,962 candidates, 1 loop, 477 pieces.

| change | ms |
|---|---|
| first working version | 6,229 |
| hoist the grid query out of the probe loop | 1,369 |
| exact reachability filter (`segSegDistSq <= r`) | 1,033 |
| per-capsule coverage intervals (replacing arrangement + classify) | 1,067 — **no gain** |
| no allocation in the hot path (stamp dedup, scratch point, raw distance) | 974 — **no gain** |
| early exit once a piece is fully covered | 618 |
| hoist the piece's own direction out of `segSegDistSq` | 595 |
| amortize the merge schedule | 628 — **no gain** |
| **cull each VERTEX, not just its segment** | **464** |
| guard arc cut candidates | 646 — **reverted, net loss** |

Now: **472 ms**, phases `{crumb 20, cull 50, grid 14, boundary 372, stitch 2}`.

**Read the "no gain" rows before optimising further.** Four separate hypotheses about
where the time went were wrong, and each cost a cycle. What finally located it was
splitting the timer between the line loop and the arc loop: **lines were 42 ms of 479;
cap circles were the other 437.** Cap circles are expensive because their neighbourhood
is a disc of radius 2r rather than a thin band, and because a genuinely exposed circle
never reaches full coverage, so the early exit cannot fire. Culling vertices independently
of their segments cut them 658 → 357.

**Do not guess at the next one — instrument first.** The counters that found it were:
pieces, grid hits, reach (survivors of the exact filter), cuts, and per-loop time.
Last measured: 1,381 pieces, 404,383 grid hits, 52,787 reach, of which arcs were 45,433.

Remaining ideas, none tried:
* The arc neighbourhood is still ~127 capsules per vertex. A tighter reach test than
  `dist(c, o) <= 2r` would help — most of those cannot cross the circle at all.
* Circle-vs-capsule coverage is analytically a SINGLE arc. Computing it with interval
  algebra instead of cut-and-probe removes the probes entirely. Fiddly at degeneracies,
  which is exactly what the 23 membership tests are for.
* Guarding cut candidates was tried and lost — cuts fell 366k → 122k but time rose to
  646 ms, because the guard needs the same trig the probe does.

**Estimate to refine:** the real 3,769-point stroke is ~2x the synthetic one, so ~900 ms
today. Good enough to unblock the wiring; not good enough to ship as a pen-up bake.

## 5b. THE GAP THAT INVALIDATES THE ESTIMATES ABOVE — read this first

**`strokeShape` takes a POLYLINE. A stroke's `pts` are not one.** Two.js draws a native
stroke as a Catmull-Rom-like cubic spline through those samples (tension 0.33,
`node_modules/two.js/src/utils/curves.js` → `getControlPoints`), and that spline is what
Chrome paints. Feeding the raw samples to `strokeShape` bakes a different shape from the
one on screen — which is precisely the defect `docs/outline-fidelity-report.md` records as
**~1,900 px of solid mismatch**, and the reason `curveOutline` was corrected to start
from the spline. Found by a second agent, confirmed here by measurement.

Measured on a 7-sample hand-drawn curve, 60 units wide:

| | |
|---|---|
| samples → spline at display fidelity | 7 → 987 points |
| max departure of the spline from its own chords | **3.83 units** — 3.8 px at 1:1, 1,149 px at the level's deepest zoom |
| worst edge displacement between the two bakes | 3.77 units |
| difference in AREA | **0.24 %** |

That last row is the trap: the area is almost identical, so any area-based test waves it
through. It is the EDGE POSITION that is wrong. Pinned by `strokeShape.test.js` SS-7.

**And the fix is not "flatten the spline first".** Flattening buys fidelity by making
segments SHORT, and this algorithm's cost is driven by `2r / segmentLength` — every
boundary piece is trimmed against every capsule that can reach it. Since
`segmentLength = totalLength / n`, that density grows *with* n, so cost is **quadratic in
the point count**. Measured (`strokeShape.perf.slow.test.js` SSP-3):

| flatten tolerance | points | density | culled | ms |
|---|---|---|---|---|
| display / 400 | 45 | 5 | 0 | 24 |
| display / 50 | 141 | 15 | 0 | 197 |
| **display fidelity** | **987** | **103** | **0** | **4,232** |

Note `culled = 0` throughout: **the crumb saves nothing on a sparse path.** Everything in
§5 was measured on a dense scribble where 74 % of capsules are buried and segments are
long — the favourable case. A simple hand-drawn curve is the unfavourable one, and it is
the one that has to work.

So: **§5's numbers are not the cost of matching Chrome.** ~900 ms for the dense stroke
stands; a single curvy pen stroke is ~4 s and gets worse the more faithfully you flatten.

### The actual fix

Not optimisation — a missing phase. The classic three-phase offset algorithm is *offset
every segment; trim or join ADJACENT offsets; then clip globally* (INRIA, "An offset
algorithm for polyline curves" — see `docs/perimeter-bake-options.md` §1 for the link and
the rest of the literature). This implementation does the first and third and
skips the second, so consecutive capsules — which on a finely flattened curve are ~103
mutually overlapping neighbours per piece and account for essentially all of the work —
go through the general machinery instead of a linear walk. On a non-self-intersecting
curve, *every* neighbour is path-adjacent, so an adjacency pass removes the entire density
term and leaves the grid handling only genuine distant self-intersections.

The alternative, larger, route: give `strokeShape` curve primitives instead of a polyline.
`curveOutline.strokeOutlineCurves` already produces correct offset cubics from the spline;
what it does not do is resolve them into a perimeter. Composing the two — its primitives,
this file's trimming — is the principled end state, and needs distance-to-cubic.

### The measurement that decides whether this approach survives

**A real-shaped stroke's samples blow up 42x when flattened at display fidelity.**
Measured: 1,963 samples -> **82,813 points**, mean segment 0.96 units against r = 45, so
a local density of 94. That is the input any polyline-based resolver must chew to bake
what Chrome actually paints.

What that COSTS is **not measured, and must not be extrapolated** from SSP-3. That table
is the sparse case, where the crumb culls nothing and cost is quadratic; a dense scribble
is the case where the cull does work (74 % buried). Extrapolating the sparse quadratic
gives an absurd figure and is meaningless here. **Measure it directly — it is the single
number that decides whether "resolve the perimeter at pen-up" is viable at all.**

Note also that this is not obviously the algorithm's fault: 82,813 points is simply how
much detail a display-fidelity polyline of that spline contains, and `curveOutline`'s
own answer for the same stroke was 156,525 cubics. The output is tiny either way
(~200-640 pieces); it is the input that is enormous.

### Accuracy, and the swap-jump problem (Kobin, 2026-08-06)

Recorded requirement: *"exact cubic-bezier shapes of the original path, or at least
within .25 pixels of the original curve. I prefer the exact shapes."* Plus: holes below a
pixel may be filled.

Kobin's concern, which sharpens it: if the bake lands **after** the user has zoomed in,
any inaccuracy shows as a visible jump. That exposes "0.25 px" as underspecified — a
tolerance in FRAME units is a different pixel count at every zoom. The codebase
convention (`fitTol = arcTolerancePx / 2 / cfg.enter`) means "half a pixel at the level's
deepest zoom", which covers a whole level but NOT a crossing: zoom in one level before
the bake lands and a tolerance chosen for the parent is 3000x too coarse.

**Zero error is not reachable** — the exact offset of a cubic is neither a cubic nor an
arc. So the error has to be placed, and the three placements are not equal:

1. Keep the spline as truth — error at every render, forever.
2. **Adopt the flattened path as the object's truth at pen-up** — one swap, at the zoom
   you drew at, where the tolerance is invisible; after that there is no second
   representation to jump against. The residual is exactly PR-4's frozen-chord corner
   (0.36 degrees, depth-independent, ~5 px across a screen).
3. Gate the swap on visibility — stateful, and holds the expensive representation
   precisely while zoomed in.

(2) is the only one with no LATER jump, and its residual is already quantified. It also
makes accuracy and performance the same decision, since flattening finer is what costs:

| flatten tolerance | points | deviation at the level's deepest zoom | strokeShape (sparse curve) |
|---|---|---|---|
| display / 400 | 45 | 50 px | 24 ms |
| display / 50 | 141 | 6.3 px | 197 ms |
| **display fidelity** | **987** | **0.125 px** | **4,232 ms** |

Only the last meets the stated spec. NOT YET RULED ON by Kobin.

### One decision to re-confirm with Kobin

The second agent recommended retaining the original centerline until every consumer
(render, erase, save, hit-test, select, undo, severance) is migrated. As a TRANSITION
plan that is sound. It is not the end state Kobin chose — *"you can pre-bake all the
shapes, no need to store the original centerline"* — so it should be adopted as
scaffolding with a removal step, not silently as the design.

---

## 6. The other options, measured, if this approach stalls

| | while drawing | at pen-up | total |
|---|---|---|---|
| batch exact | 0 | 1,033 ms | 1,033 ms |
| full incremental (maintain the boundary per point) | 7,395 ms (1.96/pt) | 0 | 7,395 ms |
| **crumb + bake** (chosen) | **53 ms (0.014/pt)** | ~590 ms est. | ~640 ms |

Full incremental measured: mean 1.96 ms/point, p50 1.7, p95 4.7, p99 5.5, max 12.6 (at
cell = 2r; other cell sizes showed 105-117 ms outliers, never explained — **suspect the
tail if that path is revived**). Its structural win: the live boundary saturated at ~207
pieces after 1,500 points and never grew again.

Raster trace is a dead end for the main path (resolution-limited), but its distance-field
form is the plausible way to make the cull nearly free if the crumb is not enough.

---

## 7. Not done

* **Wiring.** Fill natives carrying `loops`; `Renderer` drawing arcs as beziers (it
  already has a bezier path for strokes); `persist` round-tripping them; routing the erase
  through a shape-vs-shape boolean instead of `subtractPolys`.
* **Arc → cubic** for the renderer. Split at <= 90 degrees, `k = 4/3 tan(θ/4)`; error at
  90 degrees is ~2.7e-4 r, comfortably inside a quarter pixel.
* **The erase itself.** `strokeShape` computes a union; the erase needs a difference. Same
  machinery — trim one shape's boundary against the other and keep the opposite side.
* **Severance / connectivity** after an erase, currently read off resolved regions in
  `cede.js` / `_familyComponents`.

---

## 8. Standing decisions (Kobin, this session)

* Curve-native boolean with a **resolved perimeter** (option B), for erasing AND fat
  strokes.
* **Pre-bake all shapes; the original centerline need not be stored.**
* **crumb + bake**, not full-incremental and not batch-only.
* Holes smaller than a pixel may be filled — edge cases to be revisited later.
* Output should be exact cubics, or within 0.25 px. For a polyline source the lines-and-arcs
  answer is exact, so this is already satisfied.
* Threading (a worker for the bake) is **possible and deferred** — measured at 3% main-thread
  contention on 8 cores, but it hides work rather than removing it, and the real cost is
  invalidating an async bake against a mutable document. Make the work small first.
