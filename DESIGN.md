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
| **Cache tile** | the render cache's own frame-aligned square. Decides how much work one bake covers, and nothing else. Clips arcs, which is exact, and marks every end it makes (`seamA`/`seamB`) so the level below cannot freeze on an edge it invented. | `TileStore.js` |
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

A piece of a loop is `{line: true, A, B}` or
`{line: false, C, r, a0, sweep, A, B}`. **`A` and `B` are carried explicitly**,
so consecutive pieces share their endpoints bit for bit. That is the invariant
the whole representation rests on, and it is why a fill never leaks at a seam.

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
  **exactly zero** at five.

The parent is genuinely **cut**, not left whole with a rect recorded against it.
That removed a per-view re-derive whose cache went stale on the fast zoom path,
232–386 ms renders rebuilding it, and a view-sized pad that was 2 px at one zoom
and 0.19 px at another.

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
tests **2** of them.

**The indicator shows what is drawn.** Ants run along the render list's pieces,
so a magnified shape that the browser could not hold as arcs is shown from the
tile pieces that hold it, and a frame whose selected content is under 2 px on
screen is one dot with none of its members visited — the frame's box bounds
them all, by invariant 2. There is no budget: every selected piece on screen is
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

**dev-0** (`snapshot`/`loadSnapshot`) is a second, separate format: the whole
engine state including the crossing records, carried by the diagnostic report so
a bug can be replayed exactly as it was seen. Not the save format.

**Local storage**: IndexedDB (`src/storage/db.js`), one header record per canvas
and one record per frame, written incrementally from the document's own change
events — every event carries its frame id — with no JSON text and no compression
in between; thumbnails as JPEG bytes under an LRU budget; the recycle-bin
payloads and the pre-pull backups in their own stores. Only the gallery index
and the recycle-bin index remain in localStorage. Autosave waits 1.5 s behind
the last change and flushes on tab hide. (Until 2026-09-02 it was one lz-string
slot per canvas in localStorage, and that is what F33 is about.)
**Cloud**: Firestore — a parent doc for metadata and thumbnails, the drawing
chunked into 700 KiB binary parts beneath it, and the parent written **last**, so
a torn save never looks complete.

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
| `persist.js`, `scenes.js`, `frameLattice.js` | save format, scene clustering, the lattice constants |

`geometry/` is pure functions and no state: `arcShape` (the boolean),
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
