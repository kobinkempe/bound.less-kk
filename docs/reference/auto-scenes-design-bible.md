# Auto-Scenes Design Bible (v2)

The definitive semantics for scene discovery, thumbnails, the canvas cover,
and manual capture. Supersedes the v1 per-level clustering shipped 2026-07-12.
Code: `src/engine/scenes.js` (pure rules) + the scene methods on
`KobinEngine`. Tests: `src/engine/scenes.test.js`.

## Design constraints (why it looks like this)

1. **No global frame exists.** Scale compounds ×3000 per level; floats
   overflow near level 88. Every computation here projects through **at most
   two adjacent crossing records** — all math is local, like the engine
   itself.
2. **No physical screens.** All distances are relative to *stroke width*,
   which encodes the zoom the ink was drawn at and is identical on every
   device. The same drawing yields the same scenes everywhere.
3. **Cheap and dumb beats clever.** Three primitive shapes only: rectangle
   overlap, one-record projection, one weighted sort. Anything smarter is a
   workaround away (capture / split / delete).
4. **Nothing is ever lost.** There is **no minimum size and no minimum stroke
   count** — the tiniest dot drawn 3000× deep is a scene (that is the point
   of the feature).

## Vocabulary

- **width `w`** — a stroke's line width in its home-level frame (`lwFrame`).
- **window(w)** — the "screen" a stroke was drawn against, defined without
  any real screen: a square of side `WINDOW_WIDTHS × w`.
- **anchor level** — the coarsest level a scene has ink on. A scene's rect is
  stored `{ level, rect }` in its anchor frame (never absolute).
- **natural zoom** — the zoom that fits a scene's frame in the viewport
  (`KobinEngine.sceneZoom`).

## The constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `WINDOW_WIDTHS` | 600 | window side = 600 × stroke width |
| `JOIN_WINDOWS` | 1.5 | ink joins across gaps ≤ 1.5 windows **of the coarser stroke** |
| `CHUNK_WINDOWS` | 1 | long strokes are split into ≤ 1-window pieces for geometry |
| `CHUNK_PAIR_RATIO` | 4 | chunk-vs-chunk only between strokes within 4× width; wider pairs test coarse chunks vs. the fine stroke's whole box |
| `DETAIL_RATIO` | 16 | pocket members are ≥ 16× finer than the scene's **coarsest** member |
| `POCKET_EXTENT_FRAC` | 1/3 | echo guard: a nested scene must be ≤ 1/3 of its parent's extent (else it's the parent's view again) |
| `POCKET_RECURSION` | 6 | max nesting depth of pockets inside pockets |
| `FRAME_QUANTILE` | 0.05 | frame = per-axis [5%, 95%] of painted-ink mass |
| `FRAME_PAD_FRAC` | 0.10 | + 10% padding per side |
| `MATCH_IOU` | 0.5 | recompute keeps a scene's id/name at frame overlap > this |
| `RETARGET_IOU` | 0.4 | capture retargets an existing scene at overlap ≥ this… |
| `RETARGET_ZOOM` | 4 | …when zooms differ ≤ 4× and its center is inside the capture |
| `SPLIT_FACTOR` | 0.5 | manual split re-clusters at half the join gap |

## 1. Scene determination

**Chunking.** A stroke whose bbox exceeds one window of its own width is cut
into consecutive polyline pieces each ≤ 1 window (`CHUNK_WINDOWS`). Chunk
rectangles hug the ink, so a long diagonal can't capture bystanders sitting in
its bounding box's empty corner. Chunks are geometry only — membership is
always whole strokes.

**Join rule.** Two strokes join when the rectangle gap between their geometry
is ≤ `JOIN_WINDOWS × window(w_coarse)` — the *coarser* stroke's window, so
fine detail drawn on or near coarse ink joins the coarse composition, and the
threshold reads "still on the same drawing as seen while drawing it."
Geometry granularity follows `CHUNK_PAIR_RATIO`: similar-width pairs test
chunk-vs-chunk; very different widths test the coarse stroke's chunks against
the fine stroke's whole bbox (chunking a relatively tiny stroke buys nothing).

**Adjacent-level stitch.** Levels are bookkeeping, not boundaries. Clustering
runs per level *pair* (L, L+1) that both hold ink, projecting the finer
level's rectangles into L through that one crossing record. Union-find is
keyed by global stroke id, so membership chains across consecutive pairs and
a composition drawn while crossing a boundary (a mark at 260× and another at
305×) is one scene. Ink drawn much deeper has microscopic width in the shared
frame and joins only if it literally touches coarse ink — which is correct,
and pockets then separate it.

**Qualification.** None. Every cluster is a scene.

**Pockets (nested scenes).** Within each scene, take only member strokes
≥ `DETAIL_RATIO` finer than the scene's **coarsest** member — the
composition's structural scale, deliberately not the median: when outer
zoomed-out ink merges whole compositions into one cluster (the "Star"
regression, 2026-07-13), fine strokes dominate the population, a median
reference sees no detail, and every interior scene silently vanishes.
Re-cluster the detail subset at its own scale, ignoring connectivity to the
parent's ink (a cascade of intermediate marks cannot hide a deep detail).
Every resulting cluster becomes a nested scene UNLESS it spans more than
`POCKET_EXTENT_FRAC` (1/3) of the parent's extent — the **echo guard**: a
"pocket" nearly as large as its parent is just the parent's view again, not
a findable sub-scene. (This was originally a 1/50 smallness gate; the Star
incident showed interior compositions merged by outer ink are LARGE
relative to their parent and were rejected before recursion could descend —
losing entire subtrees.) Parent links are recorded; recurse to
`POCKET_RECURSION`. This is both the slow-zoom answer (a continual dive
yields a chain of nested scenes) and the draw-around-it answer (interior
compositions survive an outer merge as pockets, keeping their ids).

## 2. Scene thumbnail determination

A scene's **frame** is the **90% ink core**, not the bounding box: per axis,
the span between the 5th and 95th percentile of painted-ink mass
(chunk length × width), padded 10% per side. Long wispy edges overflow the
frame instead of shrinking the subject. The frame is simultaneously the jump
target and the thumbnail crop (aspect-fitted at render time) — one
definition, no separate thumbnail logic. Rendering mechanics are unchanged
from v1: offscreen 320×240 engine render → JPEG data URL, regenerated only
when the scene's content hash changes, cached locally and synced to the
Firestore canvas doc under a size budget.

## 3. Full-canvas scene determination

There is **no synthetic Overview scene**. The **primary scene** is the
top-level scene with the most drawing in it, measured scale-free:
`size = Σ(chunk length × width) / median_width²` — "how many pen-widths² of
ink" — so a dense picture beats a huge sparse wisp and the comparison is
valid across levels. The primary sorts first and its thumbnail is the
canvas's gallery card. The rest of the panel lists parents before their
pockets (indented), siblings by size descending: a table of contents reading
outer → inner.

## 4. Custom scene capture

One button — **Capture this view** — with two outcomes:

- **Retarget**: if an existing scene's frame center lies inside the captured
  view, their overlap is ≥ `RETARGET_IOU`, and their zooms differ ≤
  `RETARGET_ZOOM`, the capture *is* that scene reframed: it keeps its id and
  name, becomes pinned, and its frame/thumbnail become exactly the captured
  view (the "zoom out to include the wisps and overwrite" case).
- **Create**: otherwise a new pinned scene of the captured view — which is
  also the manual split tool (capture each half, delete the original).

## Evaluation schedule (what runs when)

- **Pen-up (every stroke)** — O(#scenes): the new stroke is provisionally
  assigned to the nearest existing scene at its level (join rule against the
  scene's frame) or opens a provisional new scene, so the panel is never
  stale. Provisional state is marked unresolved; no clustering runs.
- **Scenes-panel open and Save** — the real recompute, incremental: each
  level keeps an ink hash; only levels whose hash changed (plus their stitch
  neighbors) re-cluster. Unchanged levels' scenes carry over verbatim.
  Identity survives via `MATCH_IOU` frame matching; renamed scenes are
  pinned and never auto-drop; deleted auto scenes leave a suppressed frame
  behind so the same cluster cannot resurrect; provisional scenes are
  confirmed or absorbed here. Thumbnails re-render only on hash change.
- A 3000-level drawing recomputes only the level or two just edited. Worst
  case per changed level is quadratic in chunk count with rectangle
  early-outs; a level with many thousands of strokes degrades to whole-stroke
  boxes rather than getting clever.

## Known edge cases, accepted on purpose

- Same-level detail 4×–16× finer than its surroundings is neither chunk-fine
  nor pocket-fine: it stays merged with the parent (capture it manually).
- Two dense drawings ~2+ windows apart are separate scenes even if a wide
  monitor could show both (capture merges them).
- A connecting trail of ink chains everything it touches into one scene
  (split or capture to taste).
- Scenes spanning many levels are anchored at their coarsest level; ink
  deeper than anchor+4 contributes membership but not frame geometry
  (pockets re-anchor at their own coarsest level, regaining reach at every
  recursion step — fine-direction projection only underflows floats, which
  is harmless).
- v1 documents carried a synthetic "cover" scene; it is dropped on first v2
  recompute (the primary scene takes its role).

## Tuning guide

Feel wrong in practice? One knob each: scenes merge too eagerly →
lower `JOIN_WINDOWS` (or `WINDOW_WIDTHS`); too many micro-scenes → raise
`POCKET_EXTENT_FRAC` denominator; pockets missed → lower `DETAIL_RATIO`;
capture overwrites when it shouldn't → raise `RETARGET_IOU`.
