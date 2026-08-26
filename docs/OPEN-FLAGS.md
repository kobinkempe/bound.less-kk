# OPEN FLAGS — the live list

**Hands-on testing lives in `docs/UAT.md`** — the run-it-yourself checklist, with the
environment matrix for the browsers and monitors this has not been tried on.

**This is the one place open concerns live.** It is a *current state* list, not a log:
edit entries in place, delete them when they close. `docs/issue-log.md` is the historical
log and is a different thing.

Read this file at the start of any session about baking, erasing, or stroke geometry.
When summarising status for a handoff, point at this file by path.

Last updated **2026-08-26**.

**THE FRAME LATTICE IS IN (2026-08-19).** A frame is a cell of a fixed lattice, a move is
arithmetic on an address rather than a translation of geometry, and the magnify chain carries
exact arcs. That closes F25, F28, and the two failures the design was written against (F-A, the
chain flattening curves; F-B, re-entry failing on a 1 px aim error). Read
`docs/frame-lattice-design-bible.md` — section 10 first, which records where building it changed
the design — before touching frames, tiles, moving or persistence. Pre-lattice files are refused,
not converted (D8).

**The arc pipeline is WIRED IN (F22).** A stroke is no longer a centerline plus a
width — it is drawn as a biarc chain, and at pen-up it RESOLVES into a perimeter
of circular arcs which becomes the object. Erasing is an exact boolean on those
arcs with no polygon library anywhere. Read F22 before touching drawing, erasing,
tiles or persistence; F21 is the geometry it stands on.

**Everything below the F21/F22 entries is HISTORY on the cubic pipeline.** A, B
and C, the bake schedules, `curvePerimeter`, `strokeShape` — none of that runs any
more. It is kept because the diagnoses in it are what led here, and because the
cubic bake survives as the independent oracle the arc tests compare against.

The labs are `/#/arcpen` (the pen) and `/#/arcbake` (the resolve); `/#/bakelab`
still drives the old cubic schedules for that comparison.

| id | what | where | sev |
|---|---|---|---|
| ~~F13~~ | ~~bakes wrong on dense strokes~~ — **CLOSED by F15's fix**: the arc-length window is gone entirely | `geometry/curvePerimeter.js` | closed |
| ~~F14~~ | ~~pre-culls unsound~~ — **CLOSED**: the sampled cull is replaced by a conservative bbox bound, see F19; centerline cull still off | `geometry/curvePerimeter.js` | closed |
| ~~F19~~ | ~~pre-cull dropped real boundary at large pen widths~~ — **CLOSED** | `geometry/curvePerimeter.js` | closed |
| ~~F15~~ | ~~dense + self-crossing strokes bake wrong~~ — **CLOSED**, see below | `geometry/curvePerimeter.js` | closed |
| ~~F10~~ | ~~B disagrees with A~~ — **CLOSED**: A, B and C now agree exactly on all seven cases | `geometry/bakeStrategies.js` | closed |
| ~~F18~~ | ~~fabricated edges on hairpin strokes~~ — **CLOSED**: neighbouring cubics are clipped again; hairline loops dropped | `geometry/curvePerimeter.js` | closed |
| [F20](#f20) | ~~classification leaves ~121 junctions unbalanced~~ **SOLVED by the arc pipeline (F21)** — 0 unbalanced on the same stroke | `geometry/curvePerimeter.js` | superseded |
| [F21](#f21) | **arc pipeline lands: exact offsets, closed-form crossings, exact burial oracle** — 3.8x faster, F20 gone | `geometry/arcPerimeter.js` | live |
| [F22](#f22) | **the arc pipeline is WIRED IN**: biarc pens, sliced pen-up bake, exact arc-boolean erase, arc tiles | engine-wide | live |
| [F23](#f23) | **five things Kobin reported after using it** — unclosed geometry stored, dust natives, a move over an unbaked mark, one-object-per-80ms erase, tile churn on drags | engine-wide | live |
| [F24](#f24) | CLOSED. A cut that FINISHED an earlier cut fell on coincident boundary, which the intersectors cannot see; and a biarc pen's 4.99e17-radius arcs made the distance test cancel to zero | `geometry/arcShape.js` | closed |
| ~~F28~~ | ~~the app freezes when moving half of a split object~~ — **CLOSED by the frame lattice** (2026-08-19): it was F25 wearing a different coat, and a drag no longer rewrites deep coordinates at all | `KobinEngine._dragSelection` | closed |
| [F29](#f29) | **a piece fades out of existence while zooming out** after being cut off the main piece — caught mid-fade | `Renderer._fade` / `TileStore` | **high** |
| [F30](#f30) | **an eraser is consumed without cutting anything** — the first cede at a new level did nothing; does NOT reproduce synchronously | `KobinEngine._bakeTick` | **high** |
| ~~F-Z~~ | ~~a thin, long stroke vanishes while zooming out~~ — **FIXED AND VERIFIED 2026-08-26.** Chrome drops a filled path whose features are too small IN THE COORDINATES HANDED OVER, whatever the transform; the fix rescales such an object by a power of two at pre-render and divides its group matrix by the same. Kobin confirmed it in a browser. [Full account](#f-z--a-thin-long-stroke-vanishes-while-zooming-out) — keep it, the canvas-rasterization trap in it is what cost three wrong diagnoses | `Renderer._applyThinScale` | closed |
| F32 | **the lasso sometimes misses objects** — reported 2026-08-26, not yet reproduced; no capture, no conditions known. NOT diagnosed. Two things to rule out first, both read off the code rather than observed: (1) selection tests the object's AXIS-ALIGNED RECT (`_rectInActive` -> `rectInsidePolygon`), not its ink, so a diagonal or curved stroke lying comfortably inside the loop is skipped whenever its bbox corners poke out — correct by the stated rule, a miss to the person drawing the loop, and the cheapest to check; (2) `_rectInActive` returning null drops an object silently. After those, the frame walk itself: the `out of reach` REACH box, `queryRect`, and the ancestor pass that skips the branch already visited. **Ask for a report while it is on screen** — the lasso polygon and the missed object's id are what settle it. | `KobinEngine._lassoFind` / `geometry/lasso.js` | open |
| ~~F31~~ | ~~`repairLoops` seals each fragment separately instead of stitching them first~~ — **FIXED 2026-08-26**: it now chains fragments on the cheapest join available, bridges each join explicitly, and seals once. Measured on the two phone strokes with the `distinctSamples` fix switched off, so the same severed bakes arrive: stroke 1 went 2 loops + a phantom hole -> 1 loop, worst fabricated edge 46.39 -> 0.75 units; stroke 3 went 3 loops + a phantom hole -> 1 loop, 82.61 -> 1.02, and its **area from 38.6% too large to 0.2% under**. Both seals are now ~6-9% of the pen's own width. `_lastBakeRepair` carries `fragments/chords/worstChord/fabricated/dropped` into a phone report, which is what made the first one take a day to place. | `geometry/arcShape.js` | closed |
| ~~F25~~ | ~~dragging a deep family destroys its deepest pieces~~ — **CLOSED by the frame lattice** (2026-08-19): a move is an ADDRESS change, and a deep member's geometry is not touched | `KobinEngine._dragSelection` | closed |
| ~~F-A~~ | ~~the magnify chain flattened arcs, and every level inherited the polygon~~ — **CLOSED** (2026-08-19): tiles carry exact arcs; rendered edge error 0 px at every depth an oracle can check | `geometry/derive.js` | closed |
| ~~F-B~~ | ~~re-entry was a nearest-frame decision that failed on a 1 px aim error~~ — **CLOSED** (2026-08-19): a frame is a lattice cell, so re-entry is a lookup | `LevelMap.js` | closed |
| [F26](#f26) | ~~a cut that reaches a tile edge never parted the object~~ — **FIXED**: a point contact is a cut, not a join | `geometry/connect.js` | closed |
| [F27](#f27) | ~~an erase made in a sibling BRANCH silently skipped ink homed elsewhere~~ — **FIXED**: cut in place when there is no chain to cede along | `KobinEngine._bakeOne` | closed |
| ~~F16~~ | ~~the 3,775-point scribble takes ~2 s at pen-up~~ — **CLOSED**: 76 ms on arcs, and the bake is sliced (F22) | `geometry/curvePerimeter.js` | closed |
| ~~F17~~ | ~~B is badly wrong on real strokes~~ — **MOOT**: schedules are gone; the pen builds the chain incrementally and A resolves it | `geometry/bakeStrategies.js` | history |
| ~~F11~~ | ~~A and C cut a corner into a tight wiggle~~ — **FIXED**: the crumb cull was unsound; removed | `geometry/curvePerimeter.js` | closed |
| ~~F12~~ | ~~no harness, no real timings~~ — **DONE**: `/#/bakelab`, and 3,775-sample timings below | `src/Pages/BakeLab.js` | closed |
| ~~F1~~ | ~~`strokeShape` chords the centerline~~ — **CLOSED**: nothing chords a centerline; a stroke IS its arc perimeter (F22) | `geometry/strokeShape.js` | closed |
| ~~F2~~ | ~~the A/B/C cost numbers are void~~ — **re-measured in Chrome on the curve core**, see below | `docs/perimeter-bake-options.md` | closed |
| ~~F3~~ | ~~`strokeShape` takes a polyline; a stroke is a spline~~ — **CLOSED with F1** | `geometry/strokeShape.js` | closed |
| ~~F4~~ | ~~PR-4 documents the frozen corner as acceptable~~ — **CLOSED by F22**: a cut edge is arcs, re-flattened per level; PR-4 now measures that | `precision.slow.test.js` | closed |
| [F5](#f5) | ~~never passed a test by Kobin~~ — **HE USED IT (2026-08-15)**: "erasers seem to be mathematically exact... relatively little tile issues". Five defects reported, all in F23 | — | open |
| ~~F6~~ | ~~9 `fidelity.compare` failures predate this work~~ — **GONE**: its ground truth read `o.pts.length` on erase output; 33/33 green | `fidelity.compare.slow.test.js` | closed |
| ~~F7~~ | ~~`strokeShape` is wired to nothing~~ — still true, and now deliberate: it is oracle-only, like `curvePerimeter` and `bakeStrategies` | — | closed |
| ~~F8~~ | ~~no real-Chrome numbers~~ — **CLOSED**: the app runs; pen-up swap 233 px of 921,600, tile-seam lift 0 across 1,960 rows | — | closed |
| ~~F9~~ | ~~`_bakeOne` can still become an indivisible multi-second job~~ — **CLOSED by F22**: every bake phase is resumable | `KobinEngine.js` | closed |

---

## Cleanup backlog — AFTER the refactor

Dead or unreachable code found while tracing the live pipeline (2026-08-25). None of it
is a defect and none of it is urgent — it is all "this stopped being called and nobody
removed it". Batch it once the refactoring settles: the entries chain, and X3 depends on
whether `KobinEngineV0` is still wanted as an oracle.

| id | what | where |
|---|---|---|
| X1 | **the old erase RECIPE module is unreachable.** `subtractCuts`, `cutRecord`, `eraserFootprint`, `narrowCut`, `cutsResolveIn`, `removedFraction` implement the superseded model — "a cut is a recipe the object carries and every bake re-runs at its own fidelity". F22 replaced it: `_bakeOne` calls `subtractShape` on two resolved arc perimeters, and `derive.js:291` records the same shift from the tile side. Verified no production importer; only `erase.contract.slow.test.js` reaches it. **Check that test for invariants not covered by the engine-level erase suites before deleting the coverage** — port them rather than dropping them. | `geometry/erase.js` |
| X2 | `subtractPolys` and `clipPolysToRect` lose their last callers when X1 goes. `clipPolysToRect` is already test-only: `lattice.test.js` uses it as a precision probe for the `localFrame` fix, so that probe needs somewhere else to live. | `geometry/clipperOutline.js` |
| X3 | `strokeOutline` is *already* unreachable in this engine — the `derive.js` branch is gated by `legacyOffset: cfg.fatWidthPx == null` and `fatWidthPx` defaults to 4000; `Renderer._fatPolys` is documented debug-view-only; `engine.geom.strokeOutline` has no consumers. **`KobinEngineV0` still calls it**, so decide V0's fate first. | `geometry/clipperOutline.js` |
| X4 | if X1–X3 land, **`clipper-lib` comes out of `package.json`** — ClipperLib would have no live call site anywhere. The file is then misnamed: everything left in it (`clipRingsToRect`, `clipPolylineToRect`, `flattenCurve`, `flattenCurveNear`, `decimatePolyline`, `controlsFor`, `strokeStripNear`) is pure JS with no integer lattice. The banner at the top of this file already claims "no polygon library anywhere"; X4 is what makes that literally true rather than true of the erase path only. | `package.json` |

---

### The ERASE debug view (dev menu -> "Erase")

Everything that has gone wrong with erasing this month has been invisible on
screen: a family that would not come apart, a piece joined to the wrong
relative, a native made of nothing, a mark that never baked. All of it is
decided by connectivity across a tile boundary, and none of it is something you
can see in ink. This draws the decision.

| what you see | what it means |
|---|---|
| a real shape at **70%**, a temporary tile at **50%** | opacity is on each PATH, not on the object's group, so where two pieces of one logical object overlap it reads DARKER. They are supposed to tile, not overlap: a dark patch is a bug. The two levels also tell stored ink from a tile built for this view at a glance. |
| a **different colour per real shape** | one logical object, one colour per native it is actually made of — tiles, pieces cut by tiles, pieces still joined underneath. Assigned in first-seen order within the family, remembered by id, so nothing changes colour while you watch it. |
| **black** fill | ink that is not a shape HERE: either nothing resolved stands behind it, or it belongs to a COARSER object and this is a magnified view of it (an "up" tile). A piece stored FINER than the view — one an erase ceded — keeps its own colour, so zooming out does not blacken what you were just working on. |
| **orange** outline, 1 px | a STORED shape's own boundary, taken from the NATIVE in its own frame and mapped to screen — never from what is drawn. A shape shown at another level arrives as tile pieces each clipped to its tile, so outlining what is drawn traces the tile grid and stops dead at every seam; this runs continuously across them. |
| **green** outline, 1 px | the stretch where that piece is in CONTACT with a parent or child across their shared tile edge. **This is severance itself**: green means "these two are one object". A cut that has reached the tile edge shows as green shrinking to nothing — and the moment it becomes a single point, the family parts (F26). |
| **yellow** at 20% | an eraser mark. Marks already consumed are KEPT while the mode is on, so a gesture that appeared to do nothing can still be seen where it landed. |

**Every line on screen is green or orange, never both.** Green used to be drawn
over orange, which is two paths where the picture has one edge: a fraction of a
pixel of disagreement between them showed as a two-colour fringe that read as a
gap, and every shared edge cost twice. Now ONE walk of each stored boundary
splits it into runs — `_splitOnJoins` cuts a segment where a contact interval
starts and ends, so a side that is half joined comes out half green and half
orange instead of all of one — and each run goes to exactly one list. Both
pieces of a join draw their own share of it, which is what makes a join visible
from either level: measured live on a three-level family, `0#7`, `1#9` and
`2~1#10` all three draw green, 4 green paths and 1 orange path in the SVG, none
overlapping.

**Do a child and parent need an overlap so no seam shows when you zoom out?**
No — and the reason is worth keeping, because "add a pad" is the obvious wrong
answer. Two opaque paths that share an edge each cover part of the boundary
pixel and composite source-over, so up to a quarter of the background survives:
measured on a ceded tile, an interior pixel lifted 18-25% toward white. But
subpaths of ONE path do not seam — the rasterizer accumulates coverage across
all of them before compositing anything. `Renderer._buildPieces` merges every
piece of one logical object (grouped by `editId`) into a single path, so the cut
stays EXACT and the join still paints solid. That is what made the previous
`2/enter` pad unnecessary — it was 2 px at one zoom and 0.19 px at another,
which is what a view-dependent overlap always costs. `cedeTileById` subtracts
the tile rect from the parent exactly, and the parent's hole and the tile rect
agree to **0.00e+0 in every coordinate** across a 650-unit object; that
exactness is also what makes the contact test meaningful, since the stretches
`contactArcs` compares lie on the same line by construction. `seamPad` (1.5 px,
30 level units) survives for the cases merging cannot reach: derived tile QUADS,
and a sub-pixel down-piece that is actually FADED and so has to be its own
group. **In the debug view the merge does not apply** — every piece gets its own
colour by design — so a hairline along a tile edge THERE is the debug colouring,
not the geometry.

`KobinEngine._eraseDebugOverlay()` builds it in screen coordinates from the same
`contactArcs` / `arcOverlaps` the real severance test uses — so what is drawn is
the decision, not a second opinion about it. Two things keep it affordable, both
found by profiling rather than by guessing:

* **Clip before flattening.** A coarse object seen three levels down is 2.7e10 ×
  the window; flattened whole at the magnified view's tolerance that is tens of
  millions of points for the few hundred on screen, and it threw `RangeError:
  Maximum call stack size exceeded` out of Two.js's path constructor (`Collection`
  takes its array by `push.apply`, and apply spreads it onto the call stack).
  Now `shapeRingsInRect` clips to the view first, sub-pixel chords are dropped,
  and the anchors go in 2048 at a time regardless.
* **Cache the joins.** A join is a fact about the document, not about the camera,
  but finding one means flattening whole pieces at the rect's own lattice step.
  Keyed by member ids + `_ver`, with the visible outlines cached per (id, `_ver`,
  tolerance) whenever the object lies wholly inside the clip window: 160 ms per
  render became 61 ms cold and 31 ms warm on Kobin's own document.

### Confirmed GOOD — do not re-litigate

`curveOutline.js` already offsets correctly and already obeys Kobin's curves-not-lines
rule. Specifically:

* `curveOutline.js:257` — `chordDeviation(c) <= lineTol` is the only path that emits a
  straight line, i.e. a line is used **only where the piece genuinely is straight** at the
  tolerance in play. Everything else goes through `fitOffset` (Tiller–Hanson + measured
  error + subdivision) and comes out as fitted cubics.
* `strokeOutlineCurves` groups tangent-continuous pieces into **runs** with one cap pair
  per run, not per sample, so joins inside a run are smooth by construction.
* Tolerances are taken at the level's deepest zoom (`cfg.enter`) — the worst case a level
  ever shows.

What it does **not** do is resolve its overlapping capsule loops into a single perimeter.
That is the missing step, and it is the whole job.

---

<a id="f25"></a>
### F25 — CLOSED 2026-08-19. Dragging a deep family destroyed its deepest pieces

**What it was.** A drag translated every selected member's geometry by
`displacement x frameFactor`, which for a member k levels below the camera is
`displacement x R^k`. The members stayed beautifully registered with each other — drift under
6e-14 px at every depth — and each one's OWN SHAPE was destroyed: 0.12% of its area gone at
four levels of separation, **82.9% at five**, coordinates reaching 7.3e18. The object did not
move wrong. It came apart.

**What fixed it.** `docs/frame-lattice-design-bible.md`, built 2026-08-19. A frame is a lattice
cell, so a displacement decomposes into base-4096 DIGITS and everything a whole cell or larger
is applied to the member's ADDRESS: it is re-homed into the cell that many steps along and its
geometry is not touched, because neighbouring cells' origins differ by exactly one frame and the
same local coordinates therefore describe the moved object exactly. Only the sub-cell remainder
— under one frame, at any depth — ever reaches a coordinate.

Measured at 3, 4, 5 and 6 levels of separation (`move.deep.test.js`): area **exactly**
unchanged, coordinates inside the frame, geometry **bit-identical** when the displacement lands
on a whole cell, and a slow drag bit-identical to a fast one. F28 was the same defect and closes
with it.

The original diagnosis follows, because it is what led here.

### F25 — the original report (OPEN, blocker) — HISTORICAL

This is what actually corrupted Kobin's second scenario, and it is a MOVE bug
wearing a split bug's clothes. Measured by loading his own report and dragging
the object 20 px at the top level:

| level | coordinate reach before | after one 20 px drag | area drift |
|---|---|---|---|
| 0 | 304 | 314 | 0 |
| 1 | 7,893 | 62,058 | 0 |
| 2 | 15,000 | 1.8e8 | 0 |
| 3 | 9,466 | 5.4e11 | 0.000002% |
| 4 | 15,000 | 1.6e15 | 0.0005% |
| 5 | 9,022 | **4.9e18** | **3.6%** |

A member `k` crossings down must translate by 3000^k units to keep up with the
same physical movement. At 4.9e18 a double resolves ~500 units, and the piece's
own features are a few thousand — so its geometry is rewritten with a chisel.
Its contacts then break into points, and (correctly, under F26) the family falls
apart: components went 2 -> 8 on that one drag.

**The frame tree exists to prevent exactly this** — `LevelMap`'s own header says
frames "keep every stored coordinate within ~REUSE_RADIUS of its frame's origin
BY CONSTRUCTION". A drag is the one operation that violates it.

**THE FIX WAS ALREADY DECIDED AND IS SIMPLY NOT BUILT — bible §5.1**, "position
is a per-level offset, never rewritten coordinates" (Kobin, 2026-08-03: *"I want
consistency" — every object, always*). An object's `pts` are immutable; its
position is a sparse map of per-level offsets, one small vector per level it was
ever moved at, folded into that crossing's translation on the way down:

```
x_k = (x_{k-1}·s + t.x)/base + move_k.x        ≡    t'.x = t.x + move_k.x·base
```

Every number stays screen-scale, so nothing large ever materialises. Note this
is an offset **on the object**, NOT a frame per object — the bible rules that
out explicitly ("a frame per object would have made that walk O(objects) per
tile"). An earlier draft of this entry proposed re-homing into sibling frames;
that contradicts the decision and would cost exactly what §5.1 was chosen to
avoid. §5.1 also buys move-and-move-back returning EXACTLY, and drags that no
longer bust `_bbox` / `_dispFlat` / `_flat` / `_outline`.

What HAS been built is §5.4, the residue accumulation (`_dragSelection` measures
from where the drag started and credits only what the geometry actually took),
done 2026-08-03 with `move.drag.test.js`. §5.1 was never started. The bible's own
status list says so — "`pts` are still rewritten by a move ... the deeper claims
of §5.1 are untouched" — and acceptance scenario 7, *walk a tiny deep object in
over several rounds*, is still ❌ blocked on it.

**This is NOT family-only.** `_selectableRects()` walks `doc.levels()`, the whole
document, with no cull — as bible §5.3 requires, a lasso selects "everything
fully bounded by the loop, *including objects too small to see*". Verified: an
object homed three levels down, whose bbox is 2.79e-8 frame units wide and which
is not drawn at all, is in the selectable list. So a lasso can gather a piece
arbitrarily deep and drag it from the top, which is the same arithmetic that
destroys a family member. ("Fully bounded" excludes objects far LARGER than the
view, which is the other direction and is fine.)

Where the cliff is, measured on a 1140-unit object translated by 100·3000^k and
back:

| k | offset | ulp | worst point error | area drift |
|---|---|---|---|---|
| 1-3 | 3.0e5 … 2.7e12 | ≤4.9e-4 | ≤2.4e-4 | 0.000% |
| 4 | 8.1e15 | 1.0 | 0.50 (0.044% of span) | 0.099% |
| 5 | 2.4e19 | 4.1e3 | **1460 — 128% of span** | **90%** |

`select.multilevel.slow.test.js` SM-1 pairs a level-1 object with a level-4 one
and asserts they move together — k = 3, the last column that is still exact. The
suite stops one level short of the failure, which is why it is green.

<a id="f28"></a>
### F28 — CLOSED 2026-08-19 with F25 (it was the same defect) — HISTORICAL

Kobin, 2026-08-18, report `07-15-48` — taken deliberately BEFORE the move, so the
journal is empty (a reload clears it) and the snapshot is the state the freeze
started from. Two families of **7 pieces each, one component apiece**, spanning
levels **0 through 6**: a correctly split object, which is the thing that was
being fixed all week.

Almost certainly F25 wearing a different coat. A drag translates every member by
`tx * frameFactor(camera -> that member's level)`; at six levels of separation
that is 3000^6 = 7.3e20 units, where a double resolves ~131,000 and the piece's
own features are a few thousand. What F25 measures as *drift* at k=5 becomes, at
k=6, geometry so degenerate that the boolean and the connectivity walk grind:
`_familyComponents` re-derives contacts for all 7 members on every settle, and
every one of those flattens a shape whose coordinates have lost all meaning.

**Do not fix this separately until F25 (bible 5.1, per-level offsets) is done.**
If the drag never writes a large number, there is nothing here to be slow about.
Reproduction is in hand: load `07-15-48`, select either family, drag.

<a id="f29"></a>
### F29 — a piece fades out of existence while zooming out (OPEN)

Kobin, 2026-08-18: "a piece disappears as I am zooming out after it is cut off
the main piece. I caught it mid-fade." Report `07-22-12` is the one at level 2,
zoomed out (`inScale` 0.28).

There IS a fade, and it is not a bug by itself: `Renderer._fade` ramps a
down-piece's opacity to zero between `fadeLoPx` (0.15) and `cullPx` (0.3) so a
sub-pixel piece leaves quietly instead of popping. The question is why a piece
that is still a real part of the object on screen entered that ramp. Two
candidates, both cheap to check:

* `fadeTag` is `projectedSizePx` at the source frame's DEEPEST zoom, not at the
  current one, so a piece whose own frame is deep reads much smaller than it
  looks. A piece freshly CEDED to a fine level is exactly that case, and "after
  it is cut off the main piece" is precisely when it acquires one.
* The renderer puts a piece that is actually fading into its OWN group rather
  than the family's (`renderId = o.editId != null && this._fade(o) >= 1 ? ... :
  o.id`), so once it starts to fade it also stops sharing the family's opacity —
  which would make the fade visible rather than masked.

Not yet reproduced. `07-22-12` + a zoom-out sweep is the harness.

<a id="f30"></a>
### F30 — an eraser consumed without cutting anything (OPEN, and NOT the boolean)

Kobin, 2026-08-18: "an eraser doesn't bake (I erase and then it just
disappears)." Report `07-22-12`, gesture **e265**: a 113-unit eraser at frame 2,
`cuts: []`, and no pending mark left in the snapshot — so the mark was CONSUMED
having done nothing.

Its place in the session is the tell. He is doing the recursive workflow, and
each level goes the same way — zoom in, erase, zoom in, erase, and the first
erase after crossing into a new level CEDES:

```
e230 @L0  lw 3.56    cut 30
e233 @L0  lw 1.02    cut 231
e236 @L0  lw 0.33    cut 234
e239 @L1  lw 294.20  CEDE 237  + split      <- first erase at level 1
e244..e262 @L1       cut, seven times, each at a deeper in-level zoom
e265 @L2  lw 113.32  NOTHING                <- first erase at level 2
```

**e265 is the cede at the next crossing, and it is the one that did nothing.**

RULED OUT — the geometry. Replayed from `07-21-13`'s snapshot, all twelve
gestures reproduce his session move for move (cut, cut, cut, cede+split, seven
cuts) and **e265 cedes correctly**, taking the document from 20 natives to 23.
Replayed on the PRE-FIX boolean it also cedes. Replayed as a single gesture
against `07-22-12`'s own snapshot it cedes. The synchronous path is right.

WHAT IS LEFT is the difference between that replay and the app: the replay runs
`flushErases()`, and the app runs `_bakeTick` in 8 ms slices on a timer, deferred
whenever `_drawing || _erasing || _dragSel || _panLast`. The suspect mechanism is
the DONE SET. `_bakeOne` adds its target to the eraser's done set BEFORE it can
refuse (deliberately — it is what stops a refusing target being retried for
ever), so a refusal is permanent for that gesture; if nothing else lies under the
mark, `_bakeTick` then finds no target, and consumes the mark silently. That is
F27's shape exactly, and F27's fix only covered the sibling-branch case.

His session also recorded ONE seal in that window (`lastSeal {id: 263, open: 6}`)
that the replay does not reproduce on either build — more evidence that the app
took a path the replay does not.

**Instrumented 2026-08-18 so the next report answers it.** `_rehomeBail` records
every refusal against the gesture — `{target, level, why}`, with the reason taken
from the exact `break` that stopped the descent ("tile holds none of its ink",
"grazing: nothing removed", "cedeTileById refused", ...). `_noteSpent` records,
on any mark consumed WITHOUT cutting, the whole done set: what the gesture
considered and dismissed. A repeat of this bug now arrives with its own
explanation attached.

<a id="f27"></a>
### F27 — CLOSED. "Some erasures would never bake."

Kobin, pressing on a diagnosis that did not cover his symptoms. He was right.

Erasing ink homed SHALLOWER than the gesture re-homes it: the tile is cut out of
the parent and carried down. `_bakeRehome` can only do that along an ancestor
chain, and it checks — `if (!path || path.up.length || !path.down.length) return
false;`. The frame tree BRANCHES, though: a second visit to a region far from
the first mints a sibling (`2~3`, `4~6`), so "finer than" and "underneath" are
different questions, and between two branches there is no chain to cede along.

The refusal was silent, and it came after `_bakeOne` had already run
`done.add(o.id)`. That set is how an eraser remembers what it has handled, so
the object was marked done for that gesture and never revisited: the mark
painted, the baker consumed it, and the ink was never cut. Nothing logged it and
nothing retried it.

Measured on his own document (`report-2026-08-15T17-19-58`, 12 frames, 6 of them
siblings) — **8 of the 12 frames had a blind spot**:

```
erase made in 4~5: silently skips ink homed at 2 (4 objs), 3 (2 objs)
erase made in 4~6: silently skips ink homed at 2 (4 objs), 3 (2 objs)
erase made in 4~2: silently skips ink homed at 3 (2 objs), 2~3 (30 objs), 3~4 (5 objs)
erase made in 5:   silently skips ink homed at 2~3 (30 objs), 3~4 (5), 4~5 (1), 4~6 (7)
```

Ceding needs an ancestor chain; cutting does not. Where there is no chain, the
erase now falls through to the ordinary in-place cut — the eraser is projected
into the target's frame and subtracted, exactly as it is for two frames at the
same depth. The hole lands in the coarser object rather than in a tile of its
own, which is the right answer when the gesture is not underneath it.

<a id="f26"></a>
### F26 — CLOSED. A completed cut looked exactly like a join.

Kobin, 2026-08-15 pm: "some of them did split the pieces, but none of them were
split correctly." Three scenarios, before-and-after reports for each. Two
defects, both in what a family does with its tile boundary.

**1. A point contact was treated as connectivity.** Severance is read off the
tile edge: a child piece and a parent piece are joined when their ink meets on
the same stretch of the rect they share. `arcsTouch` accepted overlap-OR-ABUT,
so meeting at a single point counted. But when an erase finally cuts through to
the edge of a tile, the two pieces it leaves necessarily meet that edge **at the
same point** — the one the eraser crossed. That is the signature of a completed
cut, and it was being read as proof the object still hung together. Measured on
his simplest case, the lower half's contact with the upper parent was
`[0.19, 0.19]` — one point — against a real contact of 1.47 of the perimeter.

A join now needs a shared STRETCH. Ink has width, so anything genuinely crossing
a tile edge crosses it over an interval; the tolerance only has to exceed
rounding. Two `connect.test.js` cases asserted the old behaviour and are
rewritten: abutting contacts used to be bridged by `tol`, which dates from when
the boundary came off Clipper's integer lattice and one contact could be split
in two by quantization. The arc clip puts contacts exactly on the rect, so a gap
between two of them is a real gap.

With that alone his first scenario goes from one object to two, and every level
appears on both sides — one object split lengthwise, not a level left behind.

**2. A grazing clip minted a native made of nothing.** Where a parent's boundary
only grazes a tile, `_inkShapeInRect` returns a strip with no area — two line
pieces, out and back along the rect edge. `_bakeRehome` ceded a tile for it
anyway, and each one became a native that paints nothing, connects to nothing,
and counts as its own component of the object for ever. His third scenario
carried **fourteen** of them, all identical, one per gesture; they are why a
family of 18 pieces reported 16 components. The clip is now culled against the
pen before anything is ceded.

<a id="f24"></a>
### F24 — CLOSED. The stitch lost boundary when a cut finished an earlier cut

**FIXED 2026-08-15. Two defects, one on top of the other.** The trigger is a cut
that finishes an earlier cut; the reason it was so hard to see is that the second
defect only became visible once the first was repaired.

**1. Coincident boundary was invisible to the boolean.** `circleCircle` divides
by the distance between the two centres and `segSeg` by the cross product of the
two directions, so curves that lie ON each other report no crossing at all —
correctly, there is no isolated crossing. But "no crossings" was then read as
"nothing to do here", and the fragments were classified by a winding query taken
at a midpoint sitting exactly on the other shape's boundary, where there is no
answer to give. `pieceOverlap` now finds those stretches and cuts at their ends,
and a coincident fragment is classified by ORIENTATION instead:

|  | same direction | opposite direction |
|---|---|---|
| difference | B covers A here — the edge is gone | B is outside A here — A keeps its edge |
| intersection | the shared edge bounds A n B | nothing is in both — drop it |

The clip's copy is always dropped: where the edge survives, A's copy carries it,
and admitting both puts two fragments on one stretch and leaves the walk a
junction it cannot balance.

**2. A biarc pen writes lines down as circles of radius 4.99e17.** Fitting a
nearly-straight stretch, the pen emits an arc whose sagitta — its departure from
its own chord — is 2.5e-17 on an object spanning 3.5e4. That is thousands of
times below one ulp of the coordinates it is written in: it IS a line. Every
piece of arithmetic that treated it as a circle was then computing with a radius
five thousand billion times the object. `|m - C| - r` cancels completely (one ulp
at 4.99e17 is 64 units, so every point within 64 units reported a distance of
exactly ZERO — 45 fragments of a 146-unit eraser were declared to be lying on the
ink's boundary); its sweep is 2e-17 radians, so `paramOf` divides by a number
with no significant digits. `straighten()` converts any arc whose sagitta is
below a few ulps of the coordinates in play into a line, on the boolean's own
working copy. It changes the geometry by less than one ulp and makes all of it
exact.

**THE INVARIANT TO KEEP: an erase cannot remove more than its eraser swept.**
Width along the path, plus the round ends. That is what the failure broke, and
by four orders of magnitude — see the replay below. `erase.retrace.test.js`
asserts it on Kobin's own gestures.

**What this changes about the reports.** His e42 never severed anything. The
eraser swept 0.83 square units and the boolean removed 22,722 — the 58 chords
tore the object in half, and that is the "split" he saw. Replayed on the fixed
code the three gestures remove 987, 24 and 1 square units against swept areas of
942, 24 and 0.83, and the object stays whole. **This is the answer to "some of
them did split the pieces, but none of them were split correctly": several of
those splits were never cuts at all.**

Verified: `erase.retrace.test.js` (14 tests — the two-gesture reproduction, a
zoom x gap sweep, `pieceOverlap` unit tests, and his own session replayed from
report `20-54-08` + the gestures in `20-55-00`); the Y-junction ring eraser below
now seals nothing and an exact repeat of a ring gesture removes 0.0000; live in
the browser, the retraced cut removes 4,965 where the pen-one-unit-wider control
removes 5,209 — the inequality that used to be inverted by 13% of the object.
Full suite 66 suites / 1186 tests.

---

The original investigation follows.

**THE TRIGGER IS A CUT THAT FINISHES AN EARLIER CUT** (measured 2026-08-15).
Not depth, not tiles, not the size of the eraser. A second gesture that starts
inside the ground a previous eraser already removed and pushes past where it
stopped — which is exactly how anybody severs something they are being careful
about, and the only way to sever anything at depth, where the object is
thousands of times the eraser.

Minimal reproduction, level 0, one stroke, no tiles, no cede, two gestures:

```js
drawStroke(E, [[200, 430], [750, 450], [1300, 430]], 220);
erase(E, [[752, 300], [752, 434 - gap]], 60);   // cut in, stop short
erase(E, [[752, 380], [752, 434 + gap * 3]], 60);  // RETRACE and push through
// -> 3 open chains, sealed.  Coming at the same bridge from the FAR side
//    severs it just as thoroughly and seals nothing.
```

Held across a 9-cell sweep — in-level zoom 1x, 30x, 130x × gap 40, 8, 1 units.
Every retrace sealed; every far-side approach was clean. Kobin's own report
`20-55-00` is the same shape at depth: erases 38, 40, 42 nibble the same neck
with gestures spanning 139.7, 23.1 and 3.1 units, and the third one — the one
that finally severs, retracing the second — is the one that sealed 58 chains.
Erases 24 and 32 in the same session used SMALLER erasers (0.154 and 0.197
frame units against 0.250) and sealed nothing, so eraser scale is not the
variable.

**And the mechanism is CO-CIRCULAR boundary — proved by changing the pen by one
unit.** The edge a baked eraser leaves is a circular arc of exactly the pen's
radius. Retrace with the same pen and the new clip generates arcs of exactly
that radius along the same path, so the two boundaries do not cross, they
COINCIDE — and a boolean that decides everything by counting transversal
crossings has nothing to count. Five cuts that all sever the same object:

| second cut | pieces | ink left | seals |
|---|---|---|---|
| **same pen (60), same path** | 2 | **219,876** | **1 (2 open)** |
| wider pen (61), same path | 2 | 253,420 | 0 |
| narrower pen (45), same path | 2 | 256,985 | 0 |
| same pen, path offset 3 units | 2 | 253,580 | 0 |
| same pen, path offset 20 units | 2 | 251,651 | 0 |

A 61-unit eraser removes MORE ink than a 60-unit one, and still leaves 253,420.
The co-circular case destroyed **33,544 units, 13% of the object**, that no
eraser ever touched. One unit of pen radius, or three units of lateral offset,
and it is clean.

The retrace alone is not enough: a second gesture that stays strictly INSIDE the
channel the first one cleared is a no-op to 0.000% and seals nothing. It takes
retracing AND pushing past where the first one stopped — the point where the new
eraser's boundary leaves the old one's, which is exactly where two identical
circles part company.

So the fix is in `pieceIntersections` / the stitch: coincident (co-circular,
collinear) boundary needs handling as overlap, not as a pair of crossings.

Reduced case, in `arcShape.test.js` terms: a Y drawn with a 24-unit pen, cut by
a ring-shaped eraser gesture centred on the junction (`topology.slow.test.js`
TP-3 draws exactly this). The subtraction reports:

```
crossings 17   pieces 130   kept 52   unbalanced 2   sealed 2 (1,135 of 5,521 units)
```

**17 is the tell.** Two closed boundaries cross transversally an EVEN number of
times; an odd count means a crossing was found on one side and not the other, or
one was missed entirely. The two unbalanced vertices follow from it: a vertex
with more arrivals than departures cannot be walked through, and the two chains
that pass through them never close. What they carry is the island of ink inside
the ring — a third of the result.

Ruled out already:
* the welding radius. Retried at 0.1x, 10x and 0.01x (`shapeBoolean` does this
  automatically now when a seal was needed); the same two chains open every time.
* the crossing-parameter slack. Widening `eps` from the rounding scale to the
  welding radius changes nothing, so crossings are not being rejected for
  landing a hair outside a piece.
* the winding oracle: `ambiguous: 0`, so no query gave up and retried.

That leaves `pieceIntersections` missing a crossing (a tangency, or a crossing
exactly at a shared endpoint where only one of the two neighbouring pieces
reports it), or the burial classification keeping a set of fragments that is not
a valid boundary. **Next step: dump the 17 crossing points with the piece pairs
that produced them, and find the one whose partner is absent.** Everything the
seal does is a workaround for this.

<a id="f23"></a>
### F23 — what an evening of real use found (2026-08-15)

Kobin drew, erased and moved things on a phone for an evening and sent six
snapshots (`.kobin-reports/report-2026-08-15T07-4*.json`, 324 to 484 natives —
the tests in `reported.regress.test.js` and `erase.fuzz.slow.test.js` load them).
His verdict on the part that was in doubt: **"the erasers seem to be
mathematically exact — when I zoom way in to a corner after erasing through
multiple objects at the same time, I don't notice any unevenness or pieces
sticking through"**, with "relatively little tile issues and performance issues".
What he did report, in the order it matters:

**1. Geometry that does not close was being STORED.** The worst of the five, and
the only one that damages a document. `ArcBakeJob` has always counted the chains
it could not stitch (`stats.openChains`) and nothing ever asked. His document
carries the result: object #418, a 39-unit pen, **871 pieces in 68 chains, every
one of them open** — 338 on one rail, 467 on the other, and 66 slivers between.
An unclosed chain is painted shut with a straight line across the object, so its
winding means nothing and it paints nothing: this is the object he watched "fade
out of existence". It also made the drawing **unsaveable**, because the file
format validates closure and refuses the whole document over one bad object.

The invariant is now enforced where geometry is MADE, so nothing downstream has
to cope with an open chain:

* `shapeBoolean` closes what its walk could not, with a chord, and reports
  `sealed` / `sealedArea`. Dropping the chain instead loses real ink: measured on
  a plain Y-stroke cut by a ring eraser, the two open chains were the island
  inside the ring — 1,135 of the shape's 5,521 units — and losing it makes the
  erase visibly do the wrong thing. A chord in a place the arithmetic had already
  given up on is the better of the two, and the count says how often it happens.
* the bake SEALS the same way (`KobinEngine._sealed`), which is what #418 needed:
  a stroke has to become something, so it is repaired, and the damage stops at
  that stroke instead of spreading into every erase made against it afterwards.
* a drawing that already carries the damage is repaired ON LOAD
  (`arcShape.repairLoops`), and an object with nothing left after repair is
  dropped rather than taken as grounds to refuse the whole file.

**Refusing was tried first and is wrong.** An erase whose boolean did not close
was made a no-op — safe for the document, and it broke two existing topology
tests outright: a ring eraser cutting a figure-of-eight at its crossing, and the
same eraser on a three-way junction, both perfectly ordinary gestures, both
silently doing nothing. Those tests had been passing WITH the open chains
stored, which is the more uncomfortable finding: an erase that produced garbage
looked identical to one that worked, from any assertion about object counts.

**The stitch bug behind it is still open.** On the Y-stroke case the boolean
reports 17 crossings between two closed shapes, where a transversal count must
be even, and two unbalanced vertices. Neither the welding radius (tried at 0.1x,
10x and 0.01x) nor the crossing-parameter slack changes it, so it is a
classification or pairing defect, not a tolerance. The seal keeps it from
damaging documents; it does not fix it. **This is the first thing to pick up.**

**2. "Small pixel dots."** Two eraser passes a little further apart than their own
width leave a wafer of ink between them. His document has nine, the thinnest
0.028 units of mean width against a **39-unit pen** — 0.07% of the thinnest mark
that pen can make, i.e. not something a person put there. Cut components thinner
than 1% of the pen are now dropped rather than made into natives
(`arcShape.dropDust`); each one that survived was an object that got indexed,
tiled, erased against, selected, and painted as a speck.

**3/4. A move over a mark that had not baked yet.** A mark is a native at fixed
coordinates. The erase barrier covered only the object under the finger, so with
several objects selected — or one object with a re-homed piece at another level —
ink was dragged out from under a mark that had not been applied. The mark stayed
behind, went on painting white over whatever had arrived there, and then cut it.
`_settleSelectionErases` now settles every mark pending over anything in the
selection and consumes the spent ones. It carries the selection across those
bakes by REPLACEMENT (diffing the document around each bake), because ids change
when a cut splits an object and `z` is inherited by every descendant forever — a
piece split off ten minutes ago shares it and would silently join the drag.

**5. Performance.** Two separate costs, both measured on his document:

| | before | after |
|---|---|---|
| drag, 9-member family (5,810 arc pieces) | 138 ms/event | **56 ms** |
| erase across a 241-object screen | 3.5 s of white mark | **~0.9 s** |
| worst erase slice | 128 ms | **66 ms** |

* every drag event re-derived the moved geometry into **every cached tile**,
  on screen or not. Tiles the camera cannot see are dropped during a drag now
  (`TileStore.setBatch`) and rebuilt lazily if it ever goes back.
* `shapeRingsInRect` had a fast path for "no piece reaches this tile" and none
  for the opposite — a shape wholly INSIDE the tile, which is the common case
  for anything shown from a finer level, and which needs no clip at all. 5.5 ms
  per tile per member became 0.2 ms.
* the erase baker did ONE object per 80 ms tick. A gesture across a crowded
  region touches dozens of objects (94 of them, in one of his), so the ink lagged
  the gesture by seconds. It takes an 8 ms budget now, like every other sliced
  job here.
* `_eraseMayTouch` projected the eraser's whole GEOMETRY to test a bounding box,
  once per candidate object per scan. Every frame hop is a uniform scale plus a
  translation, so a box maps to a box exactly: it maps the box now.

**Still not proven.** The boolean's tolerances were also re-scaled — from the
largest magnitude in the room to the region where the two shapes actually MEET —
because a level-0 object clipped into a tile five crossings down arrives 2.4e17
times its own size and a fuzz taken from that comes to 1e5 units against a
12,330-unit rect, which would weld the result into exactly the wreck #418 is.
**That is reasoning, not a reproduction**: 70 randomized erase scenarios across
five depths behave identically with the old rule and the new one
(`erase.fuzz.slow.test.js`), so the tolerance change is hardening, and the seal
in (1) is what actually guarantees the damage cannot be stored again.

**Not reproduced at all:** the erase that "did not split the piece in two". His
own document, replayed from the snapshot immediately before it with the camera he
had, severs correctly pass by pass; so does a stroke cut through its thickness one
crossing down (which takes eleven passes, because one crossing down a 12-unit pen
is 36,000 units and a screen shows 4,700). The likeliest explanation is (1) plus
the 80 ms cadence — the cut was made, and what was on screen was seconds behind
the gesture. Ask him whether it still happens now that the mark keeps up.

<a id="f15"></a>
### F15 — CLOSED. Five separate defects, all in how the boundary was located.

Kobin's strokes baked with solid wedges bounded by long straight edges. Those
edges were fabricated: an unclosed chain gets painted shut with a straight line
across the shape, so a misjudgement of hundredths of a unit came out as a
400-unit slab. Everything below is measured.

**1. The burial window was the root cause.** Burial excluded an arc-length window
around the tested piece's OWN generating cubic, so neighbouring pieces of one
chain used *different predicates*. Where a stroke runs back alongside itself at
an arc separation near the window's edge, the window sweeps over the overlapping
ink as the generator advances and burial flips between one piece and the next —
at a chain junction, with no crossing there to cut at. It is gone; burial is a
function of position only. A hand-drawn ring went from **510 wrong of 2,038 with
31 open chains** to 0 and 0.

**2. One crossing was being reported at two different places.** Subdivision
returns the centre of the last surviving box, and its two halves are centres of
*different* boxes. For a shallow crossing the box is long and thin and the two
centres land far apart — measured at 0.05 units on a tight wiggle and **1.10
units** on a ring, both over the welding tolerance, so the two pieces cut there
never joined. Newton on `a(ta) - b(tb) = 0` now polishes every hit; disagreement
is **1e-13**. Crossings are then registered in a shared `VertexSet` so both
pieces literally use the same coordinates.

**3. The burial threshold had zero safety margin.** `margin = fitTol` exactly,
while a fitted offset may sit `fitTol` inside the true one — so a legitimate
boundary point landed precisely on the threshold. It survived only because the
oracle used to be coarse enough (r/64) that the tolerance it subtracts supplied
slack by accident. Sharpening the oracle removed the accident: the dense scribble
kept **66 boundary pieces of 11,152** and painted two thin slabs where the ink is
a solid blob. Margin is now `2 * fitTol`, and the oracle is r/512 — the only
setting clean on all seven cases (r/256 and coarser reopen the scribble).

**4. The perimeter must be BUILT finer than the tolerance it must meet.** Cuts
are made where the *fitted* offsets cross; burial is judged against the *true*
centerline. Where those disagree they disagree by the fitting error, and at a
crossing of angle θ an error of δ displaces the crossing along the curve by
δ/sin θ. A pen-drawn scrawl left six unclosed chains with dangling ends **8 to 35
units apart** — from a fitting error of 0.02. `buildTolFor` now divides the
required tolerance by 8 **and floors it at r/10,000**, the floor being what
matters because the amplification is geometric, not absolute.

**5. The walk depended on where it started.** It took the most clockwise UNUSED
departure, so an earlier loop could consume the piece a later one needed. The
turn rule was right; the greed was not. Edge-ends are now paired at each vertex
first (sweep clockwise, match each departure to the most recent arrival), which
makes `next` a bijection on pieces — its cycles ARE the loops, every piece used
once, every cycle closed, no traversal order to depend on.

**Plus a structural guarantee.** A vertex with equal in- and out-degree cannot
strand a walk, so `stitchCubics` now welds leftover +1/-1 vertex pairs within
`r/8` before walking. Unbalance means classification kept a piece whose partner
it dropped; the pair sits essentially on top of itself, and welding it moves an
endpoint only at a junction, where the union genuinely has a corner.

Also fixed on the way: the lab silently dropped whole strokes
(`getCoalescedEvents()` can return an empty array); B never welded its caps to
its body (180° junction on a stroke with no corner); B built no round joins
between cubics, so it was missing two boundary pieces on a six-sample stroke; B
judged burial from a sub-piece's midpoint *while drawing*, before the cut that
would have split it existed, and dropping is permanent — one germ of 149, 5.7
units long.

<a id="f16"></a>
### F16 — the scribble is correct but slow (1.9 s at pen-up)

3,775 samples forming a solid blob. Measured in Chrome: **1 loop, 0 open,
0.00 px worst edge error, 10 mismatched pixels of 121,265** — the best accuracy
this stroke has ever produced. The cost is the finer build tolerance from F15.4:
the offset chain is ~44,000 pieces of which ~900 carry any boundary.

Two sound options, neither tried:

* **A deep-interior fast path in the oracle.** Most `buried()` calls in the
  pre-cull are deep inside the ink and scan thousands of segments to say so. A
  coarse grid marking cells that are *definitely* buried (some segment within
  `eff - halfDiagonal` of the cell centre) answers those in one lookup and is
  conservative by construction — it only ever marks a definite yes.
* **Adaptive refinement.** Build at the required tolerance, and rebuild finer
  only if the stitcher reports vertices it could not balance. Most strokes would
  never pay. NOTE this conflicts with B: B builds incrementally and cannot
  cheaply rebuild, so A and B would stop agreeing unless B is dropped.

Do NOT reach for the centerline pre-cull for this. It is still off and still
unsound at the sampling density that makes it cheap.

<a id="f20"></a>
### F20 — the parity weld is load-bearing, and on a heavy stroke it runs out (SUPERSEDED)

**2026-08-14: this is no longer the live blocker.** It was not fixed on the cubic
pipeline; it was dissolved by changing the representation. See F21. The diagnosis
below stays because it is what pointed at the representation in the end — three
attempts to fix it *within* the cubic pipeline all failed, and the reason each
failed was the same: the crossing set could not be made exact while the offsets
were fitted approximations of the true offset.

### F20 (original diagnosis)

Kobin's 6,791-sample width-200 fill-in stroke (saved as `stroke2.json`): a big
dark wedge across the right of the shape. **12.08 % of the ink is not painted,
with 0 % painted where there is no ink** — so the outline encloses too little.

What it is NOT — all measured on that stroke:

* not the pre-cull (`kept` = 1,119 with it on and off),
* not the burial band (swept r/32 to r/4096; every setting leaves 12-28 open),
* not the fitting tolerance (`fitRefine 64` is slightly worse),
* not the neighbour-clipping rule, not the hairline filter,
* not a bad stroke — no jumps (median sample gap 7, max 72), no duplicates, and
  every centerline cubic does produce offset pieces on both sides.

What it IS: turn the parity weld OFF and the perimeter comes apart into **121
open chains**. The weld is not tidying up a handful of marginal junctions, it is
holding together 121 places where classification kept a germ whose partner it
dropped. At r/6 it heals 106 of them and 12 are out of reach; at repairTol = r it
heals all 114 but the worst weld is then **97 units on a 100-unit pen**, which is
not a repair, it is redrawing the shape.

The gap sizes form a continuum from 0.1 to 55 units with no natural cutoff, which
is the tell: there is no tolerance that separates "same junction" from
"different junction" here, so no choice of weld distance is right.

**Why this stroke.** Sample spacing 7 against r = 100, so every offset piece has
a near-duplicate a few pieces away and the whole stroke is one long near-tangency.
Burial is judged by distance to the TRUE centerline while cuts are made where the
FITTED offsets cross; wherever those two disagree the disagreement is amplified
by 1/sin(crossing angle), and on this stroke that situation arises thousands of
times. ~121 of them resolve inconsistently.

### Three fixes tried and REJECTED — do not repeat these

**1. Counting along the chain. BUILT, MEASURED, WORSE, REVERTED.**
The idea: carry a running count of how many capsules cover the current point,
changing it by +/-1 at each crossing, and keep the stretches where it is zero. At
a crossing the two sides get opposite changes, so degrees balance by construction
and the weld could be deleted.

It does not work, and the reason is worth keeping. Counting needs the crossing
set to be EXACTLY right — every crossing found once, with the right sign —
because an error accumulates into everything downstream. Judging each fragment
independently needs no such thing: a missed or duplicated crossing costs that one
fragment and nothing else. On a densely sampled stroke the offsets of
neighbouring cubics are near duplicates of each other, so the crossing set cannot
be made exact, and the count drifts. Measured with anchors re-seeding it wherever
the answer was certain, and with the COMPLETE crossing set (no pre-cull):

| | open chains | anchors disagreeing |
|---|---|---|
| judge each fragment (shipped) | 0 / 12 | — |
| count, pre-culled crossings | 38 / 20 | 157 / 95 |
| count, complete crossings | 424 / 75 | 204 / 150 |

The general lesson: **prefer the estimator that degrades locally.** Anything that
integrates along the boundary trades a bounded local error for an unbounded
global one, and this geometry cannot supply the exactness that trade needs.

**2. Simplifying the centerline first.** The input is heavily over-sampled for
the pen (7-unit spacing against a 100-unit radius), so thinning it should make
the offsets better conditioned. It barely thins: a hand stroke has tremor at
every sample, so Douglas-Peucker at the tolerance budget removes ~20 % of points
and the chain only drops 72,743 -> 57,000. Open chains 12 -> 9. Not the answer.

**3. Pairing loose ends by chain adjacency instead of distance.** Two ends belong
together when they are neighbours along the offset chain, which is a better
question than "are they close". It helps — 12 open -> 2 — but only by allowing
welds of 89 units on a 100-unit pen, which is the shape-redrawing this flag
already rules out. At safe distances it changes nothing.

Until this is solved the perimeter is sound on ordinary strokes and unreliable on
heavy fill-in ones. Do not widen `repairTolFor` to chase it.

<a id="f19"></a>
### F19 — CLOSED. The pre-cull dropped real boundary, and sampling could not fix it.

Kobin's 4,962-sample width-200 stroke baked with an unfilled diagonal band ruled
across it, plus a stray mark. Two loops were left OPEN with ~4,240-unit gaps;
their two bridge lines run nearly parallel and the strip between them cancels to
unfilled, which is what the band was.

The pre-cull was dropping **16 pieces of real boundary**. It probed each piece at
a fixed number of points per pen radius, so a 200-wide pen was probed only every
12.5 units and a shorter exposed span fell between two probes. No spacing fixes
this in principle — whatever it is, a span shorter than it can hide.

Replaced with a bound instead of samples: a piece lies wholly inside if its
BOUNDING BOX does, and the box does whenever its centre is buried by more than
half the box diagonal. One distance query, no sampling, and it can only ever be
too cautious — a piece it keeps just goes on to be classified exactly. It is also
cheaper than the eight-plus probes it replaces.

Proof it is sound now: on that stroke `kept` is **6,480 with the cull on and
6,480 with it off** (it was 6,464 before), at 1x, 13x and 100x, and the cull is
still worth 3.4x.

One junction then remained unweldable at zoom 1, 13.5 units apart against an
r/8 = 12.5 limit. `repairTolFor` is now r/6; r/4 was tried and welds nothing
further, so the extra reach buys nothing and only risks joining junctions that
are genuinely distinct.

**Not a defect:** the angular dark holes in that stroke are REAL. Toggling the
lab's new "show original stroke" button puts Chrome's own rendering underneath,
and every hole is in the same place with the same outline — the pen genuinely
left those gaps. 154 mismatched pixels of 106,072.

<a id="f18"></a>
### F18 — CLOSED. Fabricated edges on any stroke with a hairpin.

Kobin's own strokes, at width 90. The batch path left loops OPEN — measured 649-
and 654-unit gaps on a 278-sample scrawl — and the renderer joins a loose end to
its start with a straight line, so the drawing had long edges ruled clean across
it. Three causes, all now fixed:

**1. Neighbouring cubics were not clipped against each other.** The cut step
skipped any pair whose generating cubics were adjacent, assuming consecutive
offsets only ever MEET. That holds while the centerline turns gently and fails
exactly where it does not: where the pen doubles back tighter than its own
radius, the two inner offsets genuinely cross, and that crossing IS the point at
which the inside of the hairpin gets trimmed. Skipping it leaves burial flipping
across a chain junction with no cut to carry it, and an end is stranded.

Isolated by elimination on the captured stroke — finer fitting (`fitRefine 64`),
no pre-cull, and a sharper oracle all left both loops open; clipping neighbours
closed both, and dropped the unbalanced-vertex count 86 -> 60 with the worst weld
falling 4.28 -> 1.65 units. Raising the weld distance also closed them, which is
what told us it was the wrong lever: the crossing genuinely exists.

**2. Hairline strips survived as spurs.** Where two boundary curves run closer
together than the burial test can resolve, BOTH survive, and the result is a
path that goes out and comes straight back. Measured at high zoom: 29 pieces,
12.4 units of path, enclosing 0.18 — a mean width of 0.03 against a resolution of
0.10. One stroke carried 18 of these beside its 2 real loops, another 34 beside
1. `dropHairlines` removes loops whose mean width (2·area / perimeter) is under
that resolution. They paint nothing — a doubled-back strip's winding cancels — so
no pixel changes; it only stops junk being stored, tiled and erased against, and
stops it appearing as a spike once you zoom past the scale it lives at.

**3. The same filter removes the dots.** The parity weld pairs loose ends by
distance and will happily join a short piece's own two ends, collapsing it to a
closed loop of zero extent (109 of 228 loops on one stroke). Blocking that weld
was tried and is WRONG — those welds are load-bearing, and refusing them took one
stroke from 2 open chains to 7. Let the weld happen and drop the result.

Pinned by `bakeStrategies.test.js` BS-6, which replays the captured stroke at
1x, 30x, 630x and 3310x and requires one closed loop with no dots at every one.
The zoom sweep matters: this family got WORSE the further in you re-baked,
because the tolerances that tighten with zoom are not the ones that set the scale
of the defect.

Cost: clipping neighbours roughly triples the crossings found (98 -> 570 on that
stroke) and pen-up went ~150 -> ~246 ms for it.

<a id="f17"></a>
### F17 — B is badly wrong on real strokes (A and C are not)

Not "extra small loops" — that was measured on synthetic cases and understated
it. On a 278-sample stroke captured from Kobin's browser, **B got 91 % of pixels
wrong** (35,958 of 39,623) with 228 loops, 109 of them zero-extent dots. A and C
on the *identical* input: 1.2 % wrong, 5 loops. A second stroke showed the same
pattern.

B also still doubles a piece back on itself on the gentle curve (180° junction)
now that neighbouring cubics are clipped — inside an otherwise legitimate loop,
so `dropHairlines` cannot reach it. `BS-2` asserts A and C under 1° and lets B
past, deliberately.

B's incremental classify is the suspect: it judges burial from a span's midpoint
while drawing, before the cuts that would split that span exist, and dropping is
permanent. `_allBuried` samples across the span to make that conservative, but
evidently not conservatively enough once the cut set grows.

**Kobin is choosing A.** B's numbers should not be used for comparison until this
closes.

<a id="f13"></a>
### F13 — CLOSED. Burial was excluding by cubic index instead of arc length.

Kobin drew a ring and it baked into a dozen disconnected slivers. That was the real
reproduction — the scribble was the same bug, not a density-specific one.

A boundary piece sits at distance exactly r from its own generator and, because the path is
CONTINUOUS, within r of everything for a little way along the path in both directions. That
nearness is not overlap. The old rule excluded "the generating cubic plus one either side",
which is only equivalent when samples are spaced wider than the pen. A hand-drawn stroke
samples every few units against a 90-unit pen, so the window was ~40x too narrow, every rail
read as buried, and the perimeter dissolved.

Burial now excludes an ARC-LENGTH window of one pen radius either side (`arcPadFor`), which
is the right invariant: within r of arc length the path has not had room to come back on
itself.

A second error came out with it: the oracle's flattened chords lie inside the true curve by
up to `oracleTol` (r/64), which is ~35x the burial margin, so a rail read as buried by its
own neighbourhood. `buried()` now subtracts that known error, making burial conservative.

Verified in Chrome against Chrome's own stroke, raster-diffed:

| preset | pen-up | worst edge error | mismatched px |
|---|---|---|---|
| pen line (401) | 5.2 ms | **0.00 px** | 46 / 5,205 |
| tight wiggle (25) | 1.0 ms | **0.00 px** | 81 / 20,400 |
| hand-drawn ring (521) | 8.6 ms | **0.00 px** | 89 / 53,150 |
| the scribble (3,775) | 118.8 ms | **0.00 px** | 16 / 121,265 |

The residual counts are boundary antialiasing. The scribble was 107,414 wrong before.

The original description follows.

### F13 (original) — the extreme scribble bakes wrong

Measured in Chrome via `/#/bakelab`, raster-diffed against Chrome's own stroke:

| preset | pen-up | worst edge error | mismatched px |
|---|---|---|---|
| pen line (401 pts) | 9.3 ms | **0.00 px** | 46 / 5,205 |
| self-crossing (6 pts) | 1.6 ms | **0.00 px** | 212 / 56,902 |
| tight wiggle (25 pts) | 3.5 ms | **0.00 px** | 81 / 20,400 |
| **the scribble (3,775 pts)** | 399.9 ms | **277 px** | **107,414 / 121,265** |

The first three are exact (the residual is boundary antialiasing). The scribble is not: the
baked fill covers about 11 % of the ink and comes out as 214 pieces in **150 loops**, one
per row, where a serpentine with rows 3.1 apart and r = 45 is a single solid blob whose
perimeter should be one loop.

So the interior IS being buried — the per-row slivers are what survive — but the blob's
outer boundary is not being assembled. Since `cut` is 336 ms of the 400 and `classify` only
25, the suspect is the stitcher failing to chain across pieces that were cut, not the
classification.

This is NOT caused by the pre-culls (F14): it reproduces with both off. Note the unit tests
do not catch it — the densest membership case is rows 25 apart at r = 35, and this is rows
3.1 apart at r = 45. **A membership case at that density is the first thing to write.**

<a id="f14"></a>
### F14 — piece-level pre-cull is BACK ON; centerline one still off

Once F13 was fixed the piece-level pre-cull turned out to be sound after all — it was
reading a broken oracle, not sampling too coarsely. Re-enabled: **scribble 332.7 -> 118.8 ms,
ring 21 -> 8.6 ms, output identical in both cases** (same piece count, same loop count, same
0.00 px error).

The centerline pre-cull (`opts.centerlineCull`) is still off. It was worth another 3.5x and
should be retried now that the oracle is right, but it probes where a cubic's rails *will*
be rather than the fitted offset itself, so it needs its own verification pass.

The original description follows.

### F14 (original) — both pre-culls are unsound

Two culls were built, measured, and turned off. Both are correct in principle and wrong at
the sampling density that makes them cheap.

| | effect on the scribble in jest |
|---|---|
| piece-level pre-cull | 1,493 ms -> 369 ms (cut step 1,172 -> 9 ms) |
| centerline pre-cull | 369 ms -> 106 ms (offset 206 -> 10 ms) |

The centerline one probes where a cubic's rails *will* be (`c(t) +/- r * perp(tangent)`) and
skips offsetting cubics whose rails are entirely buried. A rail that pokes out between two
probes is missed. Caught in the browser: 89 % of the ink missing while every unit test
stayed green, because the tests run at a finer tolerance where nothing gets culled.

Both are behind flags (`opts.precull`, `opts.centerlineCull`). To turn either back on, the
probe spacing has to be tied to the smallest gap the ink can have rather than to the piece's
own length — and F13's membership case has to exist first, or there is no oracle that would
notice the damage.

<a id="f15"></a>
### F15 — dense AND self-crossing strokes leave open chains (BLOCKER)

Kobin drew a stroke; it baked with huge solid wedges bounded by long straight edges. The
edges were fabricated: canvas `closePath()` draws a line from a chain's dead end back to its
start, so every unclosed chain painted an invented span across the shape.

**Now reproduced in `bakeStrategies.test.js` BS-1 as "dense self-crossing"** — 380 samples,
width 90, a figure-eight. A and C score 64 wrong of 2,030. Every earlier case had density OR
self-crossing, never both, which is why the suite stayed green while the browser did not.

Measured: 834 chain pieces -> 646 kept -> **9 loops, 7 of them open**, gaps of 5 to 152
units. So classification keeps a sub-piece whose partner across the crossing was dropped,
and the walk dead-ends at that vertex.

Dropping the open chains is NOT the fix — it measured far worse (0 -> 1,172 wrong on the
self-crossing case), so they carry real boundary.

The likely cure is a deterministic planar-face pairing: at each vertex, sort all edge-ends
by angle and pair each incoming edge with the next outgoing edge in clockwise order. That
pairing is independent of traversal order, so every walk closes by construction. The current
walk picks the most counter-clockwise UNUSED departure, so an earlier loop can consume the
piece a later one needed.

Fixed on the way here, all real:
* the lab silently dropped whole strokes — `getCoalescedEvents()` can return an empty array
  and the loop over it then added nothing (only the first sample survived);
* the stitcher now snaps endpoints into a shared vertex set before walking, instead of
  matching "near my end" on coordinates computed from two different curves;
* crossings are cut on BOTH sides from one computation — `cubicIntersections(p,q)` and
  `(q,p)` subdivide differently and disagreed about how many crossings exist;
* intersection clusters merge by POSITION, not parameter: near-tangent offsets produced
  1,710 cuts from 206 pair tests, now 64.

<a id="f10"></a>
### F10 — B disagrees with A on a self-crossing stroke (BLOCKER)

`bakeStrategies.test.js` BS-1, case "self-crossing": **698 of 2,029 probe points**
classified differently from A, which is correct there (0 wrong). A and C agree exactly.

B is the incremental schedule, so the suspect is its step 3 — re-cutting live pieces
against ink that arrived later. On a stroke that crosses itself, a piece can be buried by
ink laid down much later and far away in path order, which is precisely the case the
adjacency skip must not swallow. Piece counts are close (B 146, A 149), so this is
mis-trimming, not a missing chunk.

<a id="f11"></a>
### F11 — CLOSED. The crumb cull was unsound.

A and C reported a 170 degree kink and 18 wrong points where B was perfect. The cause was
not the cut rule: **the crumb culled one genuine boundary piece of 133**, breaking the chain
into two loops which were then force-closed. The crumb records "some capsule covers this
cell entirely" and cannot express path adjacency, so a piece gets culled by the ink that
joins it smoothly.

The cull is now off by default and replaced by a pre-cull that uses the distance oracle,
which *can* express adjacency (`lo`/`hi` exclude a piece's own generator and its
neighbours). A, B and C now score 0 wrong on gentle curve, tight wiggle and dense overlap,
and the tight wiggle's worst junction fell to 0.000 degrees.

The original description follows.

### F11 (original) — A and C cut a corner into a tight wiggle that has none

Same suite, case "tight wiggle": A and C report a **170° kink and 18 wrong points**; B
reports **0° and 0 wrong**. On that stroke B is right and A is wrong.

A 170° junction means the resolve cut a piece where the boundary does not actually cross.
Suspects, in order: the cut step accepting a near-tangency cluster from
`cubicIntersections` as a real crossing; the burial margin (`fitTol`) being too coarse
where the two offsets pass close; the `gap <= 1` adjacency rule being too narrow when one
centerline cubic produces several offset pieces, so pieces that are effectively adjacent
still get clipped against each other.

Note this is the *good* kind of failure: the three schedules cross-check each other, which
is exactly why BS-1 compares them rather than testing each alone.

<a id="f12"></a>
### F12 — no visual harness, and no timings on a real-sized stroke

BS-3's numbers are on a 25-sample toy (A: draw 0.1 ms / finish 9.6 ms · B: draw 9.1 ms /
finish 0.9 ms · C: draw 1 ms / finish 6.3 ms). The shape of the answer is already visible —
A and C pay at pen-up, B pays while drawing, C's per-point cost is ~9x lower than B's — but
these are far too small to rank the schedules. Still to do: the `/bakelab` harness (draw,
pick a schedule, watch the colour flip on bake, raster-diff against Chrome's own stroke)
and a run on Kobin's 3,769-point drawing.

---

<a id="f1"></a>
### F1 — `strokeShape` chords the centerline (SUPERSEDED)

**Resolved by replacement, not by fixing `strokeShape`.** `curvePerimeter.js` resolves the
perimeter out of `curveOutline`'s offset cubics, so every emitted piece is a sub-interval of
a curve that was already smooth. Measured on a stroke with no corners in it
(`curvePerimeter.test.js` CP-2):

| | worst junction |
|---|---|
| `curvePerimeter` (curves) | **0.000°** |
| `strokeShape` (polyline), flatten 0.25 | 4.06° |
| `strokeShape`, flatten 0.0156 | 1.05° |
| `strokeShape`, flatten 0.00098 | 0.27° |

The second table is the point of the whole exercise: the polyline core's crease shrinks only
as √tolerance and never reaches zero, while the curve core is exactly zero at any tolerance.

`strokeShape.js` is still in the tree and still green; nothing should be built on it.

The original description follows, since the reasoning is what justifies the replacement.

`strokeShape.js` flattens the centerline to a polyline and takes the Minkowski sum with a
disc. That is exact *for the polyline*, but the polyline is not the stroke, and the result
creases on the inside of every bend where two offset lines meet.

The crease angle is `≈ sqrt(8·tol / R)` for centerline radius of curvature `R`, and **it
does not shrink with zoom** — an angle is scale-invariant. Measured: a tight bend
(R = 250) flattened at 0.25 units creases at **5.1°**, identically at 1×, 30× and 900×.
Crossing a level does not wash it out; chopping the stored shape into child tiles carries
the crease along unchanged.

This violates Kobin's rule (2026-08-13): *the perimeter must avoid corners; a straight
line is only allowed when the part being baked genuinely is straight.*

The outer side of a bend is fine — line → arc → line meet tangentially. Only concave
joins crease.

**Fix:** resolve `curveOutline`'s offset cubics into a perimeter instead of resolving
line/arc pieces from a chorded centerline. See `docs/perimeter-bake-options.md`.

<a id="f2"></a>
### F2 — CLOSED. Real Chrome numbers on the curve core.

All three produce the SAME shape now (0 wrong of ~2,050 probes on seven cases,
0 disagreement, every loop closed), so the schedules can finally be compared on
cost alone. Chrome, `/#/bakelab`, width 90, at zoom 1:

| stroke | | A batch | B incremental | C crumb+bake |
|---|---|---|---|---|
| scrawl, 420 pts | while drawing | 0.4 ms | **514.8 ms** | 19.6 ms |
| | at pen-up | 146.9 ms | **11.1 ms** | 108.8 ms |
| ring, 521 pts | while drawing | 0.8 ms | 208.1 ms | 20.4 ms |
| | at pen-up | 103 ms | 32 ms | 76.9 ms |
| scribble, 3,775 pts | at pen-up | 1,901 ms | — | — |

The shape of the answer is what the analysis predicted. B is the only schedule
whose pen-up is free, and it pays about 1.2 ms per sample to get there, which is
inside a pen's frame budget but not by much. C's draw cost is ~25x lower than B's
and it still pays most of A's bill at pen-up, because the oracle it pre-builds is
only ~10 % of the work.

One correction to C's premise: **the crumb it maintains is not used.** The cull
that consumed it is off (F11), so C's occupancy grid is pure overhead on every
sample. C is really "pre-build the distance oracle", and should be renamed or
have the crumb removed before the numbers are used to choose.

The original description follows.

### F2 (original) — the A/B/C cost numbers are void (BLOCKER)

Every measured cost for batch / incremental / crumb+bake was taken against the polyline
core, which F1 disqualifies. The *scheduling* question (when the work happens) is
untouched and still open; the numbers are not. They must be re-measured on the curve core.

Expect them to improve: `strokeShape`'s cost was piece-count × local crowding, and cap
circles alone were **437 ms of 479**. A run-based curve offset has few, long pieces and
almost no cap circles. What gets harder is curve-vs-curve intersection.

<a id="f3"></a>
### F3 — polyline input contract

`strokeShape` documents a polyline input, but Two.js paints a Catmull-Rom-like cubic
spline through the samples (tension 0.33, `two.js/src/utils/curves.js` → `getControlPoints`).
Feeding raw samples bakes a different shape from the one on screen — the defect
`docs/outline-fidelity-report.md` records as ~1,900 px of solid mismatch. Pinned by
`strokeShape.test.js` SS-7. Same root cause as F1; closes with it.

Measured on a 7-sample curve, 60 wide: 7 → 987 points at display fidelity; max departure
of the spline from its own chords **3.83 units**; worst edge displacement 3.77 units;
difference in AREA only **0.24 %**. That last number is the trap — any area-based test
waves this through. It is the edge position that is wrong.

<a id="f4"></a>
### F4 — PR-4 currently blesses the frozen corner

`precision.slow.test.js` PR-4 was rewritten to measure the depth-independent corner angle
(0.36°) and treat it as the accepted residual. Under F1 that is no longer the intended
behaviour. Revisit the test when F1 closes — it should assert smoothness, not measure a
tolerated crease.

<a id="f5"></a>
### F5 — the eraser has never passed a test by Kobin

Every pass so far has failed in real use. The cede refactor is merged and green
(966 tests) but its correctness in real use is **unestablished** — green tests are not
evidence here. Do not describe the eraser as working.

Related, from memory: the 2026-07-28 "deep cuts" attempt was reverted by Kobin as worse
despite a green suite. Get his acceptance criteria before claiming an improvement.

<a id="f6"></a>
### F6 — 9 pre-existing `fidelity.compare` failures

Recorded in memory as present at HEAD before this work started. Not re-verified this
session. Confirm the count before attributing any failure to new work.

<a id="f7"></a>
### F7 — `strokeShape` is wired to nothing

Nothing imports it. Wiring needs: fill natives carrying `loops`; the renderer drawing arcs
as cubics; `persist` round-tripping; the erase **difference** (a second algorithm, not
plumbing); severance/connectivity. Expected, not a defect — but do not describe the work
as integrated.

<a id="f8"></a>
### F8 — no real-Chrome numbers

Every figure for `strokeShape` is from jest. An attempt to measure in Chrome failed: port
3000 was down and CRA never finished compiling within the timeout. A temporary dev export
in `useKobinEngine.js` was added and then reverted (0 refs remain). Real-browser numbers
on Kobin's actual drawing are still outstanding.

<a id="f9"></a>
### F9 — `_bakeOne` granularity

`_bakeTick` defers one object per 80 ms slice — *between* objects, never inside one. One
object's bake was 4,469 ms of flattening plus a Clipper call, with no yield point inside
it. That is the freeze Kobin hit. Worth fixing independently of how fast the bake gets:
even at today's speeds, slicing the flatten would have turned the freeze into a stutter.


<a id="f21"></a>
### F21 — the arc pipeline (2026-08-14)

`geometry/biarc.js` + `geometry/arcPerimeter.js`, driven from `/#/arcpen` (the pen)
and `/#/arcbake` (the resolve). Kobin signed off on the pen at tolerance 0.25.

**What it is.** The centerline becomes two circular arcs per sample gap instead of
one cubic, using the same samples and the same tangents the cardinal spline has, so
it passes through every sample and leaves it in the same direction. A gap that
cannot follow the old curve within 0.25 units is halved. On real strokes that costs
2.00–2.09 arcs per gap.

**Why it matters.** The offset of an arc is a concentric arc. So:

* both edges are EXACT — no `fitTol`, no Tiller-Hanson, no subdivision-to-fit;
* consecutive offsets share an endpoint computed once per vertex, so the rail is
  watertight by construction and there are no round joins to build;
* crossings are circle-circle — one square root, no Newton polish, and no chance of
  one crossing being found twice at two slightly different places (F15's defect);
* cutting an arc at a crossing is arithmetic on the angle, so both halves share the
  crossing POINT rather than two roundings of it.

**Measured, Chrome, best of three, same thread, against schedule A on cubics:**

| stroke | arcs | cubics | speedup | open chains | unbalanced |
|---|---|---|---|---|---|
| captured stroke, 4,962 pts | 120.8 ms, 50 loops, 2,195 pieces | 456.5 ms, 50 loops, 3,923 pieces | 3.78x | 0 | 0 |
| captured fill-in, 6,791 pts (the F20 stroke) | 178.9 ms, 6 loops, 621 pieces | 587.8 ms, 19 loops, 1,066 pieces | 3.29x | 0 | 0 |

The loop counts agreeing on the first stroke is the useful corroboration — two
independent pipelines would not agree on 50 if either were wrong. F16 also goes
away: the 3,775-point scribble bakes in 76 ms, against ~2 s before.

**THE LESSON, and it is the one to carry.** The last approximation left was the
burial oracle, which flattened the centerline into a polyline. That single
tolerance was the binding constraint on the whole result:

    oracle at r/512   -> 122 open chains
    oracle at r/4096  ->  25 open chains
    oracle at r/32768 ->   0 open chains

The mechanism: every point of an offset piece is at distance exactly r from its own
generator, so an exposed piece reads exactly r and a buried one dips below. A
fragment between two crossings that are close together dips only a little, so with a
coarse oracle every shallow sliver reads as exposed, survives, and leaves a junction
with one more way in than out. Tuning the tolerance was the wrong move; point-to-arc
distance is closed form, so the oracle is now exact and the tolerance is gone. Do not
reintroduce a flattened oracle here.

**Not yet done.** Only schedule A exists on arcs; B and C do not. Nothing is wired
into the real engine — `Renderer` still consumes cubics, and `arcToCubics` is the
conversion for that (a RENDERING conversion; the arc stays the geometric truth).
Erase, cede and the tile pipeline have not been looked at.

**Float32 trap, already hit once.** A gap that is collinear to about 1e-8 — which is
what the spline's degenerate END handles produce — used to yield a real arc of radius
8e8 with a centre 1.7e9 units away. Correct in doubles, bowing 2e-8 of a unit, and
unrenderable: canvas and SVG rasterise in float32, whose quantum at 1.7e9 is 199
UNITS, so the renderer placed the arc's start hundreds of units from its own endpoint
and joined them with a line — a large visible spur at each end of a straight stroke.
`arcThrough` now classifies by sagitta, and `tracePath`/`arcPath`/`traceLoops` take a
flatness tolerance from the caller (which knows the zoom). Anything else that hands
arcs to a float32 rasteriser needs the same guard.

<a id="f22"></a>
### F22 — the arc pipeline IS the pipeline now (2026-08-14)

Kobin's instruction: make the biarc pen the standard pen, bake asynchronously at
pen-up in chunks small enough not to disturb drawing or zooming, and rebuild the
eraser on top of it. This is what that came to.

**The object model.** A native is a `stroke` only between pointer-down and the
moment its perimeter resolves — one frame, usually. After that it is a `shape`:
`loops`, closed chains of arcs and lines, plus `w`, the pen that drew it. `pts`
and `lwFrame` are DELETED. That was Kobin's call on 2026-08-13 — "you can
pre-bake all the shapes though, no need to store the original centerline" — and
it is what makes the shape the single source of truth rather than a cache that
has to be kept in agreement with something else.

`fill` survives as a NATIVE type only for drawings saved before this, and only
until something cuts one: `Document.fillToShapeById` promotes it at that moment.
Converting at LOAD was tried and reverted — one recorded drawing carries a
1.8-million-vertex fill, and turning that into arc pieces cost more than the
whole rest of the load put together. `fill` remains the ordinary type for TILE
PIECES, which are polygons by design — **NO LONGER TRUE as of 2026-08-19**: the magnify chain carries exact arcs and freezes nothing that is stored (bible section 10.4).

**What you watch appear IS the biarc chain.** `BiarcPen` runs in `pointerMove` at
O(1) a sample, and `Renderer.setLiveArcs` lays it into the live path — splicing
off only the last two gaps, which are the only ones a new sample can disturb. A
stroke that has been drawn but not yet resolved still draws from that chain
(`Renderer._buildInto`), so pen-up changes nothing on screen. Measured in Chrome:
swapping the raw chain for the resolved shape moves **233 pixels of 921,600**,
all of them antialiasing on the edge.

**The bake is a job with a cursor in it.** `ArcBakeJob.step(ms)` does bounded
work across all eight phases and publishes nothing until it is finished; the
engine steps it in 8 ms slices off the same timer the erase bakes use. Slicing is
bit-identical to running it in one go (pinned by `arcPerimeter.test.js`). This is
F9's freeze answered properly — deferring between OBJECTS was never enough, since
one heavy stroke was a single indivisible job.

Measured in Chrome, worst SLICE against the 8 ms it was asked for:

| stroke | draw, per sample | slices | worst slice | bake total |
|---|---|---|---|---|
| 400 samples, w 20 | 0.073 ms | 5 | **8.6 ms** | 38 ms |
| 1,500 samples, w 40 | 0.061 ms | 12 | **8.5 ms** | 93 ms |
| 3,000 samples, w 60 | 0.045 ms | 20 | **8.2 ms** | 157 ms |

Getting there took four goes, and the lesson is the same each time: **a chunk is
only as small as its slowest ITEM, and "item" has to mean the same thing as the
work.** A fixed 64 gave a 53.9 ms slice. Making the count adaptive was not enough
on its own — per-item cost varies by orders inside one phase, so a chunk sized
from cheap items and then handed expensive ones still overran (33.7 ms), which is
why growth is capped at 2x a step and the count is capped at 64 outright. The
unchunked TAILS were worth as much again: building the broad-phase grid,
registering twenty thousand endpoints, and allocating one cut list per piece all
sat between two chunked loops with nowhere to yield. And the last one was a
granularity mistake — the finish phase chunked over LOOPS, and a dense scribble
resolves to two loops of three thousand pieces, so a "chunk" of two items was the
entire phase.

**Tolerance.** The centerline is built to half an arc-tolerance pixel AT THE ZOOM
IT WAS DRAWN (`arcTolerancePx * 0.5 / inScale`). Kobin approved 0.25 units in the
`/#/arcpen` sandbox; this is tighter and measured free — 2.18 arcs per gap
against 2.09, on a captured 4,962-sample stroke.

**Erase.** Both operands are resolved perimeters, so an erase is one exact
boolean (`arcShape.subtractShape`) and nothing else: no polygonization, no
flatten fidelity to pick, no lattice, at any depth. The old path had to SCALE the
eraser's flatten tolerance by the magnification, because flattening a magnified
cap at frame fidelity wanted 2e8 points and took 155 seconds for one gesture; an
arc magnifies by changing one number. The tile-cede descent keeps its shape — one
crossing at a time, cutting the tile out of the parent — but every cut in it is
exact now, so a patch's contact with its tile edge is exact too and severance
reads it without a lattice tolerance.

**Tiles.** `derive.shapeRingsInRect` clips the arcs to the tile FIRST and
flattens afterwards, local to the tile and translated back. The other order is
ruinous under magnification: a x3000 radius needs ~55x the steps for the same
sagitta, so a 2,000-piece perimeter would tessellate to ~120,000 vertices per
tile before nearly all of it was thrown away. A tile that no piece reaches is
settled by ONE winding query — that is the `solid` tier, decided exactly instead
of by the anchor-disc heuristic.

**Four defects found on the way, all worth remembering:**

1. **`cubicTangent`'s degenerate-handle fallback was noisy.** The spline's end
   anchors have coincident handles, so the derivative vanishes there and the
   tangent came from a numeric difference over h = 1e-4. At frame coordinates of
   a few thousand that is 2e-5 of displacement against a 1e-12 ulp — about 4e-8
   radians of noise, and DIFFERENT at the two ends. A straight two-point stroke
   therefore had non-collinear rails and a 4e-6-unit step in its own edge:
   invisible where it is made, multiplied by 3000 at every crossing (34 units
   three levels down). The limit direction is exactly `c2 - c0` at the start and
   `c3 - c1` at the end; it is taken from the control polygon now.

2. **The winding query's graze band was scaled off the SCENE.** An eraser
   projected three crossings down is 2.7e10 times its own size, so the pair's
   span runs to 1e13 while the object being cut is 1e4 across — and a band of
   span*1e-9 is then wider than the target. Every query grazed, every fragment
   read as outside, and an erase that should have removed the object left it
   untouched. That band is a ROUNDING distance and is measured per piece off that
   piece's own magnitude now. Relatedly, `_bakeOne` centres the boolean on the
   SUBJECT rather than on the eraser, for exactly the same reason.

3. **A stroke that ends exactly where it began was capped anyway.** A circle, a
   letter O, a box, an eraser swept round something — all of them. The two
   half-turn caps then sit on the SAME circle, and two arcs of one circle have no
   transverse crossing to find, so the pair is invisible to circle-circle however
   much they overlap. That overlap is a stretch of doubled boundary where every
   point is at distance exactly r from BOTH generators, burial is a coin flip
   there, and the resolve kept fragments whose partners it dropped: measured on a
   36-sample ring, an unclosed loop of 72 pieces, which then shredded every
   boolean it was handed (74 loops and 72 open chains out of a plain
   rect-minus-ring). A closed stroke has no ends, so it now gets no caps: the
   rails close on themselves, and the seam tangent is taken ONCE as the mean of
   the two one-sided tangents the spline reports there, so `L[0]` and `L[n]` are
   the same point rather than two points a few thousandths apart. The adjacency
   skip became per-RAIL to match — a closed stroke has two closed rails, and the
   last piece of one is not a neighbour of the first piece of the other.

4. **A stroke that doubles back onto its own start got the same cap twice.**
   The ends coincide but the tangents oppose, so it is a cusp and genuinely wants
   caps — the two DIFFERENT halves of one circle. Built from the same data they
   came out identical: half the circle drawn twice and the other half not at all,
   leaving the boundary open by exactly that half. Measured: a 104-unit
   fabricated edge across a 200-unit stroke.

Both are pinned by `arcPerimeter.test.js`, which had no closed-stroke case at all
before this — the gap that let both through.

**Hairlines are dropped, as they were on the cubic path (F18.2).** A loop whose
MEAN WIDTH (2·area/perimeter) is negligible is a strip whose two sides are the
same curve traversed both ways. It paints nothing — the winding cancels — and
exists only to be stored, tiled, erased against, and counted as its own connected
component, which is how a ring cut once came apart into two objects. The bake
measures it against the PEN (`r·1e-3`), because it knows what made the shape; the
boolean measures it against the ROUNDING scale, because it does not, and a
perfectly legitimate hole can be a billionth of the object it is cut in.

**Aliasing at tile edges — measured, not assumed.** Rasterising the app's own SVG
in the browser with a vertical AND a horizontal tile seam on screen, inside solid
ink: the worst interior lift across **1,960 sampled rows and columns is 0**.
Every piece of one object still merges into a single path (`_buildPieces`), so
subpaths accumulate coverage before anything composites and there is no seam to
cover.

**Moves, verified live as well as in tests.** A lasso over two objects — one of
which has a re-homed child three thousand times finer — drags all three by the
same screen distance, each expressed in its own frame. `Document.moveById`
REPLACES a shape's loops rather than shifting coordinates in place, because
consecutive pieces share their endpoint arrays; mutating them would move every
shared point twice and tear the shape along its own seams.

**A cut edge holds its fidelity at every depth — the F4 gap, measured.** PR-4
takes the shape as it arrives a level `k` crossings away, clips it to one screen
exactly as `shapeRingsInRect` does, and measures the flatten error as the sagitta
of each sub-arc, `r(1 − cos(θ/2n))` — exact, and one pass:

| depth | chords on screen | arc edge | the same cut, frozen as a polygon |
|---|---|---|---|
| k = −1 | 172 | 0.119 px | 0 px |
| k = 0 | 981 | 0.125 px | 0.1 px |
| k = 1 | 42 | 0.122 px | **375 px** |
| k = 2 | 4 | 0.062 px | **1.1e6 px** |
| k = 3 | 4 | 0.000 px | **3.4e9 px** |

The budget is 0.125 px. The chord count FALLS with depth, which is the economy of
the whole thing: a magnified curve is flatter across a fixed window, so the
deeper you go the less there is to say about the piece you can actually see.

**The measurement itself was the last defect, and it hid behind a green bar.**
PR-4 originally found the error by flattening 200x finer and scanning for the
nearest segment. That is quadratic in the chord count, and `arcSteps` caps at
4,096 steps per arc, so at k = 3 BOTH flattens pin to the cap: the comparison
converges on itself and reports agreement where there is shared error — and it
does not terminate. **62 of 63 suites reported PASS and jest then hung for three
hours** on the 63rd, burning a core, with no failure to show for it. A suite that
cannot finish is not a suite that passes; check for the summary line, not for the
absence of FAIL. The analytic form runs in 4 s. In the same pass, the legacy
`strokeShape` perf pin turned out to be timing JIT warm-up as if it were work
(210 ms for a 45-point call that costs 4 ms warm), which sank its quadratic-cost
ratio below the point ratio on an IDLE machine — it warms up and takes the best
of three now.

**Superseded by this.** F1/F3 (`strokeShape` chords the centerline) — nothing
chords a centerline any more. `geometry/strokeShape.js`, `geometry/curvePerimeter.js`
and `geometry/bakeStrategies.js` are dead as production code and kept only as the
independent oracle the arc tests compare against. `geometry/cede.js`'s float
guillotine is unused: subtracting a rect from a resolved perimeter is the same
closed-form boolean as everything else.

**Not done.** Threading is still deliberately deferred — the work is small enough
now that a worker buys little, and `docs/perimeter-bake-options.md` section 4
explains why asynchrony against a mutable document is the real cost either way.
Schedules B and C do not exist on arcs and are not needed: the pen maintains the
chain incrementally already, which was the only part of B worth having.

---

## F-Z — a thin, long stroke vanishes while zooming out

**Status 2026-08-26: FIXED AND VERIFIED BY KOBIN IN A BROWSER.** Reproduced and
characterised in real Chrome on 2026-08-25; the mechanism below is still not
known, but the lever is, and the fix pulls it. Reported by Kobin while checking
the selection indicator: a very thin, very long stroke went "very visibly there,
very visibly gone, semi-visibly there" during a zoom-out.

The fix is a per-object power-of-two rescale at PRE-RENDER only — nothing earlier
in the engine sees it. `Renderer._applyThinScale` measures 2·area/perimeter over
a group's finished anchors, picks a power of two S, multiplies the coordinates by
S and sets the group's scale to 1/S. Painted output is identical by construction;
S is a power of two so 1/S survives Two.js's six-decimal flooring serialiser
exactly, which also caps S at 64 (1/64 = 0.015625 is the last one that does).
F-Z's feature went 0.00329 -> 0.21 path units, about 3x clear of the ~0.065
threshold. Constants `THIN_SCALE_MAX`, `THIN_TARGET_UNITS`, `THIN_COORD_MAX` in
`Renderer.js`; dev kill-switch `Renderer.thinScale = false`; seven tests in
`Renderer.thinscale.test.js`.

Kobin confirmed it on 2026-08-26. The one thing still worth watching in ordinary
use, because no test can settle it: the gate is 2·area/perimeter, and a dense
scribble is thin BY THAT MEASURE without being a thin object. If a scribble ever
looks wrong, `Renderer.thinScale = false` in the console turns the rescale off
and says whether it is this.

### READ THIS FIRST — canvas rasterization CANNOT see this bug

Every measurement that goes `SVG → Image → canvas.drawImage` renders the stroke
**correctly**, at 95–103% of its exact geometric ink, in every configuration that
fails live. The failure appears only in **live DOM compositing**. Three separate
diagnoses were talked out of the right answer by canvas measurements that could
not reproduce it — including one that "disproved" the correct explanation.

Measure this by screenshotting real Chrome. Never by rasterizing to a canvas.

A second trap: **read screenshots zoomed in.** Faint sub-pixel grey is destroyed
by JPEG compression in a full-page screenshot, which produced one confidently
reported "confirmed cliff" that was pure compression artefact. Magnify the region
before concluding anything is blank.

The Electron browser inside the Claude desktop app (Chromium 148, dpr 1) does not
reproduce it either, even in live DOM. Kobin's Chrome 151 at dpr 1.5 does.

### The reproduction

`report-2026-08-25T15-53-05-793Z`, loaded at its own camera, object **id 4**
(level 0, 15,120 × 7,273 units, ink 13.465, resolved arc perimeter, 610 pieces).
Sweeping `inScale` with everything else held still:

| inScale | ink on screen | live Chrome |
|---|---|---|
| 200 | 0.658 px | solid |
| 141 | 0.464 px | solid |
| 100 | 0.329 px | solid |
| 71 | 0.234 px | **solid** |
| **50** | **0.165 px** | **BLANK** |
| 35 | 0.115 px | fragments |
| 25 | 0.082 px | **visible again** |
| 18 | 0.059 px | visible |
| 12.5 | 0.041 px | fading |
| 6 | 0.020 px | nearly out |

There → gone → there, and **not monotonic**: 0.082 px is thinner than the blank
row and renders. This is not a perception or contrast effect.

The `d` string is **byte-identical at every row** (15,074 chars, verified by
string comparison, `matchErr` 0). Only the matrix differs. The frame stayed `-1`
throughout, so no crossing and no representation swap is involved.

### The lever — it is the size of the numbers in `d`, not the size on screen

Multiply every coordinate in `d` by F and divide the matrix's linear part by F.
The output is **pixel-identical by construction** (same 184.5 × 88.8 box, same
0.1645 px ink; `screen = a·x + c·y + e`, so scaling (x,y) and dividing (a,b,c,d)
cancels exactly). It rescues the stroke, with a sharp boundary:

| path-space width | matrix scale | live Chrome |
|---|---|---|
| 32.9 | 0.005 | visible |
| 0.329 | 0.5 | visible |
| **0.0657** | **2.50** | **visible** |
| **0.0641** | **2.56** | **BLANK** |
| 0.0329 | 5 | blank |
| **0.00329** | **50** | **blank ← what the app sends** |
| 0.0000329 | 5000 | blank |

A 2.5% window. The app hands Chrome coordinates about **20× too small** for this
feature to survive compositing. Note the boundary is NOT at matrix = 1, so
"magnification vs minification" is not the rule either.

### What is NOT the cause — do not re-litigate

- **`fadeTag` / the fade band.** `projectedSizePx` returns the bbox DIAGONAL
  (`hypot(w,h) + lwFrame`), so F-Z tags 1,049 px while its ink is 0.84 px at the
  same reference — a factor of 1,247, and `_fade` therefore never engages. That
  is a real inconsistency and worth its own entry, but it is **not this bug**,
  and Kobin's objection stands: culling on ink width alone would hide an object
  that still covers half the screen, which is worse than the symptom.
- **Geometry degeneration / winding cancellation.** The stored arc loop measures
  area 430,562 units² and effective thickness `2A/P` = 13.478 against an ink
  width of 13.465. The DOM path's own area, sampled at 40,000 points, is
  0.025650 against an expected 0.025664 — **ratio 0.9995**. Exact at every stage.
- **Sub-pixel position.** Ten translations in 1/10 px steps at inScale 50, all
  blank.
- **float32 precision / `REORIGIN_PX`.** Coordinates handed over max **2.3**
  against a 1.5e6 budget — 0.0002% used. Baking scale in does not change the
  float32 error either: the on-screen error is `C·K·2⁻²⁴`, invariant under the
  rescale above.
- **Clipper.** The stroke is a native arc perimeter and never goes through a
  boolean. (And ClipperLib has no live call site at all — see the cleanup
  backlog.)
- **Frame crossings, `cullPx`, the fat gate, degenerate rect tests.** All ruled
  out by the sweep above: same frame, same `d`, same representation.

### What is still open

**The rule.** It is not a single threshold on path-space size — at path width
0.00329 the stroke is visible at inScale 25 and at 71, and blank at 50. Nor is it
on-screen thickness alone — at a fixed 0.165 px, growing the coordinates rescues
it. The two interact, and for this path the dead zone sits near 0.165 px on
screen. The mechanism inside Skia is not identified.

**The fix direction.** Keep path-space feature sizes above roughly 0.1 units.
That is a thin-end sibling of `fatWidthPx`, which already exists for the opposite
failure (Skia mis-strokes above ~25k device px, gate at 4000). The cost is the
path cache: `d` currently survives every camera move untouched, and baking scale
means regenerating it. A quantized scale — bake the nearest power of two, leave a
residual transform in [1,2) — would regenerate once per octave instead of per
frame, and keep every feature within 2× of its on-screen size.

### F-Z — coordinate budget, and how much room "use bigger numbers" has

The fix direction is to hand the browser larger coordinates and a smaller matrix.
This is what that costs. Window 1504 x 812, so the half-diagonal is 855 px.

**What magnitudes actually go out.** Coordinates are `anchor - origin` with the
origin at the view centre, so anything you can SEE satisfies
`|coord| <= 855 / inScale`:

| inScale | max coord (visible) | text quantum on screen | float32 error on screen |
|---|---|---|---|
| 256 (`ENTER`) | 3.3 | 2.6e-4 px | 5.1e-5 px |
| 64 | 13.4 | 6.4e-5 px | 5.1e-5 px |
| 1 | 855 | 1.0e-6 px | 5.1e-5 px |
| 1/32 (`EXIT`) | 27,300 | 3.1e-8 px | 5.1e-5 px |

Measured anchor: F-Z at inScale 50 wrote a maximum coordinate of **5.30**, against
a predicted ceiling of 17 (its visible part is smaller than the window). So one
level spans coordinates of about **3 to 27,000** — a factor of 8192, which is
`ENTER/EXIT`, exactly as it must be.

**float32 error is CONSTANT and tiny.** On-screen error is
`|coord| x 2^-24 x inScale`, and `|coord|` is itself `855/inScale`, so the
`inScale` cancels: **5.1e-5 px at every zoom, at every level.** That is why the
origin rebase works, and it is the number that says precision has never been the
constraint here. (An UNCLIPPED native spanning a whole frame carries coordinates
up to `W` = 131,072; at `inScale` 256 that is 2.0 px of float32 error — but only
for points far outside the view. Visible points always have small coordinates.)

**Rescaling by S is precision-neutral.** Multiply coordinates by S and divide the
matrix by S: the float32 error is `|c|.S x 2^-24 x inScale/S` — **unchanged**.
The text quantum on screen becomes `1e-6 x inScale/S` — S times BETTER. Nothing
about precision argues against it.

**The two real bounds on S:**

- *Floor* — features must clear the compositing threshold, about 0.1 path units:
  `S >= 0.1 x inScale / feature_px`. For F-Z's 0.165 px ink that is
  `S >= 0.6 x inScale`.
- *Ceiling* — keep the largest coordinate under **2^23 = 8,388,607**. That is
  where float32 stops representing consecutive integers, and it is also exactly
  where Firefox drops an SVG path entirely (bugzilla 1314265). Gives
  `S <= 9,800 x inScale`.

Four orders of magnitude of room. **S = inScale** (path units become screen
pixels, max coordinate 855, every feature measured in px) sits comfortably inside
it; `S = 8 x inScale` (max coordinate ~6,800) gives an 8x margin on the floor and
still 1,000x of headroom on the ceiling.

**What it actually costs: the `d` string and the path cache.** At `S = 8 x inScale`
numbers go from `5.304694` (8 chars) to `6837.123456` (11), so `d` grows about
35% — F-Z's 15,074 chars becomes ~20,000. The real cost is that `d` currently
survives every camera move untouched; baking scale means regenerating it.
Quantizing S to powers of two fixes that: regenerate once per octave of zoom, and
carry a residual matrix in [1,2), which keeps every feature within 2x of its
on-screen size at all times.

**The 6-vs-3 decimal discrepancy.** Two.js v0.7.1 documents `Utils.toFixed` as "a
pretty fast toFixed(3) alternative" and then does `Math.floor(v * 1000000) / 1e6`
— six decimals. All three copies in the package (`build/two.js`,
`build/two.module.js`, `src/utils/math.js`) agree on 1e6, so the docstring is
simply stale upstream; the constant was widened and the comment was not. Two
consequences worth knowing: the quantum is an ABSOLUTE 1e-6 in path units (not
relative), so it buys 6.5 significant digits at `inScale` 256 and 10.4 at `EXIT`;
and it **floors rather than rounds**, so every coordinate carries a systematic
downward bias of up to 1e-6. Neither matters at current magnitudes — F-Z's
0.00329 ink is 3,290 quanta wide — and rescaling only improves both.

### Harnesses

`public/hairline/` — `index.html` (stroke vs filled sliver vs filled cubic loop,
canvas-measured; useful only as the negative control that shows canvas cannot see
the bug) and `chrome.html` / `chrome2.html` / `chrome3.html` (live-DOM grids for
screenshotting in real Chrome).
