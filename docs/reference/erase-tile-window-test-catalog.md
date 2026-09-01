# Erase by Tile Window — Test Catalogue

Companion to `erase-tile-window-design-bible.md`. Every scenario, constraint and decision
from the 2026-08-03 design conversation, written as something testable, with the reason it
exists — because a test whose *why* is lost gets deleted the first time it's inconvenient.

**Built 2026-08-03.** Where each area lives now:

| Area | File |
|---|---|
| F fidelity | `src/engine/erase.fidelity.test.js` |
| P polygonization | `erase.contract.test.js` + the V0 golden in `geometry/derive.test.js` |
| S seams | `src/engine/geometry/seams.test.js` |
| W cede · C composition | `src/engine/erase.cede.test.js` |
| V severance | `src/engine/erase.severance.test.js` |
| M move | `src/engine/move.drag.test.js` |
| L lasso | `src/engine/select.lasso.test.js` |
| D · U · X | `src/engine/erase.contract.test.js` |
| R regressions | `src/engine/KobinEngine.edit.test.js` (kept, retargeted at the new mechanism) |

Not built: **M-1, M-2, M-5** (they need the per-level offset architecture, bible §8.1).

IDs are stable handles; use them in test names.

Sections: [§0 traps](#0-methodology-traps) · [F fidelity](#f--erase-fidelity) ·
[P polygonization](#p--polygonization-and-the-curve-generalization) · [S seams](#s--seams-and-tile-overlap) ·
[W cede](#w--windows-and-nesting) · [V severance](#v--severance-and-connectivity) ·
[C composition](#c--composition-many-erases-many-objects) · [M move](#m--move-anchoring-and-offsets) ·
[L lasso](#l--selection-and-multi-select) · [D determinism](#d--determinism-and-persistence) ·
[U undo](#u--undo-and-redo) · [X budgets](#x--performance-budgets)

---

## 0. Methodology traps

Every one of these cost a wrong answer at least once while measuring for the design. Read
before writing any test in this area.

- **T-1 — `_hitTest` is not an ink oracle.** It grants strokes a 6 px grab margin and
  fills none, so a target reads 6 px fatter as a stroke than it does the moment an erase
  turns it into fills. Every mark-vs-hole comparison then picks up a spurious 6 px fringe
  right round the object. Use a slop-free oracle: fills by winding, strokes by
  `dist(p, spline) ≤ lw/2`.
- **T-2 — measure the object's edge, not the tile's.** A band running off-screen has its
  rendered pieces bounded by the *tile*, so max-y is the tile's bottom and never moves.
  A probe built that way reports "0 px of movement" for everything.
- **T-3 — nothing stays near a feature boundary under zoom.** A crossing is ×2.4e13, so
  anchoring a zoom on the edge of a hole puts the edge 240,000 px away one crossing later.
  Anchor *inside* the feature or *outside* it and assert accordingly; never on it.
- **T-4 — one wheel step is ×2 in effective zoom, and a crossing is continuous.** Assert
  *ratios* against neighbouring in-level steps, not absolute jumps. A hole shrinking
  4× in area per step through the crossing is correct behaviour, not a pop.
- **T-5 — use `elementsFromPoint`, not `elementFromPoint`, in the browser.** A selection
  overlay sits above the SVG and makes every sample read "no ink".
- **T-6 — sub-ulp and sub-cell effects need sampling at that scale.** A lattice
  disagreement of one grid cell (1/1200 unit) is invisible to a probe sampling at ±0.02.
- **T-7 — mutation-test the test.** Several tests written for the reverted attempt passed
  with the code deliberately broken: one never reached the `solid` tier it claimed to
  cover, another never reached the incremental tile path. Break the thing the test names
  and confirm it fails.
- **T-8 — `setEraserSize` is a RADIUS in px**, not a diameter.
- **T-9 — `descend(E, level, extra)`'s `extra` steps change the in-level zoom**, which
  changes every feature's size by hundreds of ×. Fix it deliberately per test.

---

## F — Erase fidelity

*The hole must be the shape the mark was.* An eraser gesture commits instantly as
background-coloured ink; baking replaces that mark with a boolean hole. Any disagreement
reads to the user as the erase moving after the fact, and it is invisible to every
structural test because mark and hole are each individually well-formed.

Metric: sample the view, classify each sample as ink/no-ink before and after the bake, and
report **over-erased** (ink removed the mark never covered) and **under-erased** (ink kept
that the mark did cover), in screen px. Bar: **≤ 1 px**.

| ID | Scenario | Asserts |
|---|---|---|
| F-1 | Gesture at the object's own level | mark and hole agree ≤ 1 px |
| F-2 | Gesture 1, 2, 3 levels below the target | same, per depth |
| F-3 | Gesture 4, 5, 6 levels below (window path) | same, per depth |
| F-4 | Shapes: dab, straight, zigzag, hairpin, loop, long sweep | the spline only leaves its chords where the gesture turns, so the turning shapes are what a chord-vs-curve mistake shows up in; dab and straight pin cap and join geometry |
| F-5 | Eraser radius 6, 20, 60 px | fidelity is radius-independent |
| F-6 | Translucent ink | same hole shape as opaque |
| F-7 | Erasing a fill an earlier erase produced | fills erase as faithfully as strokes |
| F-8 | A second gesture over the first | faithful to *its own* mark, not the union |
| F-9 | Gesture running off the object's edge | cuts cleanly in two; both halves hit-test, the gap does not |
| F-10 | Stroke→fill conversion, widths narrow/wide/fat/huge | the outline moves < 1 px, **caps included** — arcs are inscribed so the outline can only shrink, and the caps are where that error is largest |

**Why F-3 exists:** the reverted attempt put the hole 25.2 px from a 20 px mark at depth 2.
`flattenCurve` mirrors Two.js faithfully, including its habit of collapsing an anchor's
handles when a neighbour is within a hardcoded **absolute** `1e-4` — two levels of
minification put every anchor inside that, every handle collapsed, and the clip quietly
became the chord polygon instead of the painted curve. Build the footprint in the frame it
was drawn in and map the rings; rebuilding it from projected points does not give the same
answer. Fixed measurement was 0.080 px.

---

## P — Polygonization and the curve generalization

Bible §2.4: the erase path uses the **existing** bake functions, generalized rather than
duplicated, and above the existing threshold outlines polygonize **as curves, not points**,
the same way they already do when a zoom threshold is crossed.

| ID | Scenario | Asserts |
|---|---|---|
| P-1 | Generalized function vs original, on every pre-existing call site | **byte-identical output.** Golden test. This is the guard that makes the generalization safe |
| P-2 | Eraser stroke through the same gate as ink strokes | an eraser above `fatWidthPx` takes the curve-outline path; below it takes the raw path — same thresholds, same code |
| P-3 | Curved ink erased, then zoomed one level deeper | the *object's* surviving boundary is still curve-smooth, not faceted at the shallower level's tolerance |
| P-4 | Cut boundary, zoomed within the level below the erase | under the recipe (§4.1) it stays smooth; under the facets fallback it degrades to ~750 px — pin whichever was built, so the fallback is a deliberate change and not a silent regression |
| P-5 | Huge eraser band at ×1, ×3,000, ×9e6 | goes through `strokeStripNear`; runtime is magnification-**independent** (measured 0–1 ms vs 111/233 ms for a full offset) |
| P-6 | Eraser clip form | is a **pre-unioned ring set**, built once at the gesture's level and thereafter mapped, never rebuilt. Assert the clip handed to the boolean has 1 ring, not the 62 the raw strip produces |
| P-7 | A curve so large it is effectively a line | takes the line path, per the existing `lineTolPx` rule — the generalization must not lose that |

**Why P-1 matters most:** generalizing a function that four other call sites depend on is
the highest-risk mechanical step in this whole design.

---

## S — Seams and tile overlap

Bible §2.5, flagged **currently defective**. Diagnose before building on it.

| ID | Scenario | Asserts |
|---|---|---|
| S-1 | Current behaviour, characterised | *what is actually wrong today* — write this first, as a failing test, before changing anything |
| S-2 | Erase across a tile boundary | the two halves of the cut agree at the seam: no hairline of ink inside the hole, no notch out of the ink |
| S-3 | Two overlapping tile pieces of the same object, sampled at grid-cell resolution through the overlap band | they agree **point for point** on where the hole is. Sample at ±1 grid cell (1/1200 unit); a coarser probe cannot see this (T-6) |
| S-4 | The same hole cut in tiles of mismatched widths | still agrees — equal-width tiles share a lattice by accident and prove nothing |
| S-5 | Translucent ink across a seam | overlap does not double-darken; the per-object opacity group unions before opacity applies |
| S-6 | A stroke piece vs a fill piece across the same seam | both branches overlap consistently — today `deriveStep`'s fill branch uses `seamPad` while the stroke branch uses `ew = rect ± lw`, and `_bakeDown` differs again |
| S-7 | Long erase spanning many tiles, sampled along its whole length | no gap anywhere |

---

## W — Ceding a tile, and nesting

> **2026-08-06.** The parent's ink inside a ceded tile is now CUT, not recorded as a
> `windows` rect (bible §2.6). Every case below still holds; the words "window" and
> "cutout" mean the tile a parent has ceded, and the only fields left in the document are
> `editId` and `attachRect`. W-11 is new and covers what the cut costs.

| ID | Scenario | Asserts |
|---|---|---|
| W-1 | Erase at the object's own home level | cut **in place**, no window created at all (bible §2) |
| W-2 | Erase N levels below the object's home, N = 1…6 | a window chain exists with **exactly one cutout per crossing**; each cutout is ~1/3000 of its host frame |
| W-3 | Cutout size in the parent's units | never approaches float64's floor at any N — the property that removes the 5-crossing wall |
| W-4 | Zoom five levels into a region no tile covers, then erase | the whole containment chain materialises: level-1 tile(s), then level-2 inside those, down to the erase level |
| W-5 | The parent's ink inside a window | is **not** stored a second time; the child tile is the representation |
| W-6 | Render deeper than the erase | the hole is inherited through `upContent`'s existing chain, and is **not** re-solidified — a holed piece must stop claiming to cover, or `classifyUp` replaces it with a fresh quad one level down and the hole silently closes |
| W-7 | Render coarser than the erase | `_bakeDown` minifies the window content; sub-pixel content culls |
| W-8 | Zoom out across the crossing out of the erase level | the hole shrinks **continuously** — no pop. Assert the ratio against neighbouring in-level steps (T-4), not an absolute size |
| W-9 | Zoom out all the way to the object's home | the object renders whole; the erase is far sub-pixel there |
| W-10 | Erase into a `covers` fill / solid quad specifically | W-6 again, but on the tier that actually produces solid quads — a long band is always "edge" tier and cannot exercise this (T-7 found exactly this hole) |
| W-11 | The join between a cut parent and its re-homed child | must not SEAM. The cut is exact, so the two abut with no overlap, and separately composited opaque paths antialias to a hairline there — measured 18-25 % lift on an interior pixel at every in-level zoom, which is the "hairline outline round the erase" this feature was repeatedly reported for. Fixed by drawing the family as ONE path, not by an overlap (an overlap has to be sized against the view, which is where the old `2/enter` pad's 2.0 px / 0.19 px spread came from). A child genuinely inside the cull ramp still gets its own group, or its fade would take the coarse parent with it |

---

## V — Severance and connectivity

| ID | Scenario | Asserts |
|---|---|---|
| **V-1** | **The 98% scenario.** Erase 98% through an object; zoom in; erase 98% of what remains; repeat to ~1e6× (≈2 crossings), at which point the neck is finally cut | the object severs, and becomes **two independently selectable natives**. Assert at each round that it is *not yet* severed — a test that only checks the end state would pass on an implementation that severs too eagerly |
| V-2 | The same, continued to 4 and 5 crossings | still severs; nesting means there is no depth limit |
| V-3 | A cut fully enclosed within one tile | severs with **no relay** — it touches no tile edge |
| V-4 | A cut reaching one tile edge | goes to the relay; is **not** severed if the ink reconnects through the neighbouring tile |
| V-5 | A cut reaching the edge in two adjacent tiles, forming a continuous line | severs; the relay unions the boundary intervals across tiles at the same level |
| V-6 | Un-baked territory between two erased regions | counts as connected (it is un-erased) — the property that keeps the structure sparse |
| V-7 | On severance, the parent splits | into two natives, with the new edge landing **inside the cutout**, where it is hidden. Assert the split edge is never visible at any zoom |
| V-8 | Severed halves move independently | and the un-severed case does not — one drag moves the whole family |
| V-9 | Selection inside an unsevered window | selects the **parent**, not the fragment |
| V-10 | Selection inside a severed piece | selects that piece |
| V-11 | An object can never be entirely inside a tile below its home | ~3000× magnified there, so there is always ink at the boundary — a guard on the reasoning V-3/V-4 rests on |

---

## C — Composition: many erases, many objects

| ID | Scenario | Asserts |
|---|---|---|
| **C-1** | **Erase 5 overlapping objects with one gesture, then zoom in to the shared cut edge** | all five edges **coincide exactly** — no fringe of one object showing past another's boundary. Requires one clip shared by every target, not a per-object rebuild. This is the cross-layer mismatch the giant-mask notes recorded |
| C-2 | The same five at successively deeper zooms | they stay coincident; the shared edge does not fan out |
| C-3 | Erase at level 5, then erase at level 2 across the same area | the deep subtree is **pruned**; the level-5 fragments do **not** reappear when you zoom back in |
| C-4 | A coarse erase partly covering a deep window | recurses into it and cuts there, rather than pruning wholesale |
| C-5 | Two erases in the same tile at different times | compose; the second does not resurrect what the first removed |
| C-6 | 50 erases in one tile | the clip is unioned per tile and cached, so cost does not grow linearly with the number of gestures |
| C-7 | One gesture over objects at *different* home levels | each takes the right path — in-place at its own home, window elsewhere — and their cut edges still coincide |
| C-8 | A wild erase splitting one object into hundreds of pieces | total storage stays ≈ one object's worth; no piece holds a copy of the whole gesture |
| C-9 | One sweep across many thin strokes | cuts every one of them |
| C-10 | A piece split off by an erase, erased and split again | works; each pass cuts whatever the previous pass left |

---

## M — Move, anchoring and offsets

| ID | Scenario | Asserts |
|---|---|---|
| **M-1** | **The walk-in scenario.** Draw a tiny object at level 5 on blank paper. Zoom out, nudge it closer to a big object; zoom in, nudge again; repeat until it can be placed against the big object | its geometry **survives intact** at every step. Today this destroys it on the first nudge: a 40 px mark drawn at level 5 collapses to **zero length** after one 100 px move from level 0 |
| M-2 | The same, one round at each of 1…5 crossings | the mark's length is unchanged at every depth (today: intact to 3, quantized at 4, destroyed at 5) |
| M-3 | Drag a coarse object from N crossings down, 100 px | it moves 100 px on screen at every N (today: exact to 4, zero at 5) |
| **M-4** | **A slow drag moves as far as a fast one.** Forty 1-px pointer events vs one 100-px event | identical result. Today at 4 crossings the slow drag moves the object **zero** pixels while the flick moves it correctly, because each event is applied and rounded separately |
| M-5 | Move a big object and a tiny deep native together, then evict and rebuild | their relative position drifts by **0 px** (today: 1.43 px at 4 crossings, 30 px at 5) |
| M-6 | Move by +Δ then −Δ | returns **bit-identically**, not approximately |
| M-7 | An object's `pts` after any number of moves | unchanged — position lives in the per-level offsets |
| M-8 | Caches after a move | `_bbox` / `_dispFlat` / `_flat` / `_outline` survive; a move must not force a re-flatten |
| M-9 | Move a parent that owns a window | cutout, window and **unsevered** contents all ride along; **severed** pieces do not |
| M-10 | Move an erased object, then inspect its cut at depth | the cut is still exactly where it was relative to the ink |
| M-11 | Move an **un-erased** object into a previously erased region | nothing happens to it — it holds no clip |
| M-12 | Offsets at levels far finer than the view | dropped below that level's resolution, and no large intermediate is ever materialised |

---

## L — Selection and multi-select

| ID | Scenario | Asserts |
|---|---|---|
| L-1 | Click | selects one object, as today |
| L-2 | Click-and-drag | draws a lasso; everything **fully bounded** is selected |
| L-3 | An object too small to see, inside the lasso | is selected |
| L-4 | An object larger than the lasso, crossing it | is **not** selected |
| L-5 | Click elsewhere while a lasso selection exists | drops the lasso selection, selects that object |
| L-6 | Ctrl + click an object | adds/removes it from the selection |
| L-7 | Ctrl + lasso **overlapping** the current selection | adds everything in it |
| L-8 | Ctrl + lasso drawn **purely inside** the current selection | removes those objects |
| L-9 | Drag a mixed-level selection | every member moves by the same physical displacement; no drift (see M-5) |
| L-10 | The colour/size/opacity box | is gone; no path can reach a restyle |

---

## D — Determinism and persistence

| ID | Scenario | Asserts |
|---|---|---|
| D-1 | Evict every tile, rebuild, source untouched | **bit-identical** rendering, at 1, 3 and 5 crossings. This already holds today — it is the property the whole tile design rests on, so it needs a guard |
| D-2 | Perturb the source by one ulp | the deep rendering moves by **zero** px at every depth. Each crossing re-quantizes to the child's own scale, so error stays relative rather than multiplying by 3000 per level |
| D-3 | Zoom away and back | same picture |
| D-4 | Save, reload, re-derive from cold | identical rendering, including every cut parent and re-homed fragment |
| D-5 | A saved file whose erase frame no longer exists | renders the object **whole**, does not crash |
| D-6 | Round trip through the real save format, not just the snapshot | `editId`, `attachRect`, offsets and clips all validate and survive; the retired `windows`/`srcId` are DROPPED by the loader |
| D-7 | A pending (unbaked) eraser stroke at save time | survives the reload and resumes baking |
| D-8 | Re-render twice with no change | identical; no cache-dependent geometry |

---

## U — Undo and redo

| ID | Scenario | Asserts |
|---|---|---|
| U-1 | One eraser gesture | is **one** undo op, however many tiles, levels and objects it touched |
| U-2 | Undo an erase that opened a window chain | removes the whole chain; the object renders whole again |
| U-3 | Redo | restores it **exactly** — same picture, pixel for pixel |
| U-4 | Undo an erase that **pruned** a deep subtree (C-3) | the pruned subtree comes back |
| U-5 | Undo an erase that **severed** an object | the two natives become one again |
| U-6 | Two overlapping erases, undo once | removes only the newer |
| U-7 | Undo a drag of an object that owns a window | window and contents return with it |
| U-8 | A bake that resumed after a reload | is recorded, and one undo reverts it |
| U-9 | Stale replay guard | an undo/redo cycle can never double-stack ink or resurrect an object whose ink a later erase already absorbed |

---

## X — Performance budgets

Numbers measured 2026-08-03; treat as regression thresholds, not aspirations.

| ID | Budget | Measured basis |
|---|---|---|
| X-1 | One erase boolean on tile-bounded geometry ≤ **2 ms** | 1 ms with a pre-unioned single-ring clip; **8–33 ms** with the raw 62-ring strip. This is the test that stops someone "simplifying" the union away |
| X-2 | Building the unioned clip: once per gesture, ~3 ms at 60 points, ~110 ms at 400 | must not be rebuilt per tile or per level |
| X-3 | A full crossing re-derive with erasers present adds ≤ **~60 ms** | 20 tiles × 3 objects × 1 ms |
| X-4 | `strokeStripNear` runtime is magnification-independent | 0–1 ms at ×1 through ×9e6 |
| X-5 | A drag costs no re-flatten | `pts` immutable ⇒ caches survive (M-8) |
| X-6 | Erase across many tiles does not block interaction | the existing deferred `_bakeTick` slicing keeps a long gesture's work off the input path |
| X-7 | Save size growth per erase | bounded per tile; measure on a real drawing before shipping |

---

## Inherited regressions worth keeping

These were real bugs, already diagnosed. Whatever the new implementation looks like, these
must not come back.

- **R-1** — an eraser that covers a whole object removes it, rather than leaving an empty
  or zero-area fill that still hit-tests.
- **R-2** — erasing most of a stroke leaves a remnant that is **its own** object: clicking
  it selects the remnant, not the original.
- **R-3** — a cut straight across makes two objects that move independently.
- **R-4** — baked fills render correctly when zooming back **out** (the `projectF` /
  `_bakeDown` fill branch, and the `_appendDown` incremental branch — a regression test
  caught the second site after the first was fixed).
- **R-5** — eraser-made fills Kobinize normally at a crossing: chopped to tile size, ink
  and holes preserved.
- **R-6** — pending eraser ink is invisible to picking; a click in an erased gap falls
  through to whatever is under it.
- **R-7** — a grazing gesture that passes near ink without covering it changes nothing;
  it must not churn a stroke into fills for no reason.
- **R-8** — an erase never leaves stale white ink anywhere. The gesture's own mark is
  always consumed.

---

## Suite layout: quick vs slow (added 2026-08-05)

The suite is split by filename, and the split is enforced by npm scripts rather than by
convention:

| command | suites | cases | wall clock |
|---|---|---|---|
| `npm run test:quick` | 31 | 409 | **43 s** |
| `npm run test:slow` | 19 | 467 | ~15 min |
| `npm run test:all` | 50 | 876 | ~16 min |

Use **quick** for small fixes and while iterating; use **slow** (or **all**) before
declaring a build like this one done. The slow set is slow for a reason — several of its
cases zoom through five crossings, which is a 2.4e17× magnification, and there is no
shortcut to that. `fidelity.compare.slow.test.js` alone is ~12 minutes.

Slow suites: `fidelity.compare`, `erase.fidelity`, `erase.contract`, `erase.severance`,
`erase.layered`, `topology`, `zorder`, `select.multilevel`, `neighborhood`, `roundtrip`,
`perf.layered`, `perf.bench`, `persist`, `canvasCodec`, `App`.

---

## LAYERED suites (added 2026-08-05)

Every case above isolates one thing. These deliberately do not: each stacks three to six
of the hard axes at once, because that is where the design's tradeoffs collide. A cut that
is exact on a clean stroke may quantize on one already cut; a hole faithful mid-tile may
not be one straddling a seam; ink that survives a crossing may not survive one after being
re-homed four times.

The recurring question behind all of them: **looking at one window, could the user tell we
did not save this globally?**

| file | what it layers | count |
|---|---|---|
| `erase.matrix.slow.test.js` | one property at a time, over depth 0–5 x mid-tile / seam / tile-corner x clean / already-cut / re-homed subject | 88 |
| `erase.styles.slow.test.js` | colour, opacity, highlighter, straight pen, opacity-groups x depth x severance x reload | 54 |
| `erase.composition.slow.test.js` | two gestures in flight, drawing mid-bake, whole-object eraser, canvas resize, hair-thin and 900-unit strokes, dots, caps, shared edges, jumps, clear | 48 |
| `erase.layered.slow.test.js` | already-cut shapes x depth x tile seams x long paths x big strokes x moving holes | 41 |
| `topology.slow.test.js` | rings, junctions, figure-eights, nested islands x depth x selection x moving | 22 |
| `roundtrip.slow.test.js` | undo, redo, save/reload, mid-bake saves, scenes | 22 |
| `erase.deepsever.slow.test.js` | severing below the object's own level, 1-4 crossings, plus its negative control | 17 |
| `erase.matrix.slow.test.js` | one property x depth 0-5 x mid-tile/seam/corner x subject | 88 |
| `erase.styles.slow.test.js` | colour, opacity, highlighter, straight pen x depth x severance x reload | 54 |
| `scenes.erase.slow.test.js` | scene clustering over re-homed frames, severance, jumps | 15 |
| `geometry/connect.test.js` | the relay's arithmetic (quick) | 20 |
| `zorder.slow.test.js` | stacking through cuts, re-homing, severance, un-baked marks x crossings x eviction x pans | 18 |
| `select.multilevel.slow.test.js` | L1+L4 selections, families across five frames, lassos, the erase barrier | 18 |
| `neighborhood.slow.test.js` | moving between levels and neighbourhoods, window/child lockstep, drag residue | 17 |
| `scenes.erase.slow.test.js` | scene clustering, capture and jump over erased, severed and re-homed ink | 15 |
| `perf.layered.slow.test.js` | budgets under all of the above | 11 |

**374 new cases**, against a 502-case baseline.

### Bugs these found

1. **An erase straddling a tile boundary bit only one side.** `_bakeRehome` ceded the
   single tile containing the erase rect's origin corner. Measured 19.5 px under-erase
   against a 20 px eraser, and it looked like an ordinary hole of the wrong size. Fixed by
   ceding the block of tiles the erase touches. (LX-8)
2. **Erasing a magnified object flattened the eraser at the target's tolerance.** Measured
   155,000 ms for one gesture, 585 ms after. Nothing crashed; it simply stopped. (PL-1)
3. **The perimeter parameter wrapped the left side from 4 to 0**, turning a short arc into
   one covering almost the whole perimeter — so every cut read as still-joined and
   severance never happened at any depth. (connect.test.js)
4. **A family key could collide with an object id after a reload.** Keys are minted from
   the id counter; `loadNatives` only tracked ids, so the next object drawn could inherit
   a live family. (RT-2)
5. **A deep erase invented scenes.** Re-homed patches are natives in frames that
   previously held nothing, which is exactly what "someone drew a fine detail here" looks
   like to the scene clustering — so the user's scene list grew every time they erased
   deeply. That is the storage becoming visible, which §3.4 forbids. Patches (those with
   an `attachRect`) are left out of the clustering. NB this filter tested `srcId` until
   2026-08-06, and the cede refactor deleted that field — leaving it a silent no-op that
   let every deep erase invent a scene again. (SC-1, SC-2)
6. **Scene chunks never noticed a FILL moving.** The chunk cache was keyed on point-array
   identity, and a fill has no `pts` — so the key compared `undefined` with `undefined`
   and matched forever. Every erase-made piece kept its chunks at the position it used to
   have, so moving one never re-clustered. Now keyed on `_ver` as well. (SC-2)

### Two design items that needed tests, not notes

An earlier draft of this section listed both of the following as "behaviour, not bugs".
That was wrong on both counts — they are explicit design items, and the right response was
to test them:

* **Severing an object from below its own level.** It works. `erase.deepsever.slow.test.js`
  now pins it: a hairline is parted by ONE gesture one crossing below its home (DS-1), and
  §3's progressive scenario reaches **four** crossings below the home (DS-2), with the
  halves selecting, dragging and undoing independently afterwards (DS-3). What decides it
  is only whether the gesture crosses the ink at the level it is made — see the bible's
  §3 table. DS-5 is the negative control, and TP-2 has been reworded from the false
  general claim to that.
* **A lasso far above a sub-pixel object catches it.** It works, at one through five
  crossings, and it can be dragged from up there afterwards (SM-4). This is why
  `_selectableRects` walks the document rather than the render list, which culls exactly
  these objects. A CLICK from up there lands on the coarse ink instead, which is ordinary
  hit-testing rather than a gap (NB-2).

### Nothing left flagged

The lasso's asymmetry — catches a sub-pixel object from far above, selects nothing from
far below — was the last open question and is confirmed correct (Kobin, 2026-08-05):
nothing fits inside a loop drawn from below, so at depth you click the item you want. Both
directions are pinned in SM-4, and the rule is written up in the bible's §8.1.
* **Overlapping gestures leave crumbs between their round caps** (CP-1). Two parallel
  strokes 40 apart, each radius 20, through a band 120 tall: at the band's edges the caps
  have narrowed to ±17.3, so a 5.4 × 10 unit speck survives between them and becomes its
  own object. Geometrically correct — no eraser covered it — and what a physical eraser
  would do. Worth knowing it is there rather than discovering it as "why is there a dot".
* **Cut edges of two different objects agree to a pixel, not exactly** (CP-8). Two
  objects of different sizes with different anchors, cut by one gesture, compute their
  edges independently in their own units. Pixel-level agreement is the explicit decision
  (2026-08-05); exact agreement would need the eraser-anchored pinned lattice measured in
  bible §6.5.
