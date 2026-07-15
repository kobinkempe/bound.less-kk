# Local Frames ("K-groups") — Design Bible

**Status: approved direction (Kobin, 2026-07-14). Supersedes the single-frame-per-level
model described in `tile-grid-and-natives-report.md` and closes ISSUE-19 / US-11
("re-anchoring for very long pans"), whose "float headroom is large" assessment was
wrong — see Motivation. This document is the reference for the frame-tree engine;
read it before touching LevelMap, Camera, TileStore, persist, or scenes.**

---

## 1. Motivation — the measured failure

The engine re-anchors **scale** at every level crossing (×~3000 per record) but never
re-anchors **translation**: each level index has exactly one `{s, t}` record, pinned
wherever that level was first crossed into. A pan of `D` units at a coarse level
therefore becomes `D × 3000^k` in the frame of a level `k` deeper. Measured live on
the Star canvas (2026-07-14), at the region ~7.9e6 units (level −1 frame) from the
original drawing:

| Depth | Coordinate magnitude | Resolution limit there | Observed symptom |
|---|---|---|---|
| level −1 | 7.9e6 | float32 (browser SVG rasterizer): 0.5 units | jagged strokes (fixed renderer-side by the per-scene origin rebase, commit 48f9a53 — that fix REMAINS necessary) |
| level 1 | 7.1e13 | float64: 0.016 units = **30% of the pen width** | stored anchor noise → spline micro-wiggle → chord zigzags → round-join disc scallops on inherited pieces |
| level 2 | 2.1e17 | float64: 32 units = **42 px on screen** | pen input quantized to a visible grid at capture (x-deltas literally 0,0,0,jump — anisotropic because y sat at smaller magnitude); damage is permanent in the stored points |

Root truth: **a single float64 frame has a finite sharp radius** (~1e13 units for ink
storage at typical pen widths; ~4.5e15/inScale for input capture). No re-pinning of a
shared frame can serve two far-apart regions — moving the pin just moves which
region's ink is destroyed. Locality is the only fix.

The engine already refuses to compose long jumps **vertically** (magnify chains one
record at a time, because composed jumps cancel catastrophically). Local frames apply
the same discipline **horizontally**. This is the design Kobin originally called
"localgroups"/"K-groups": every object is tied to a local anchor; groups are
positioned only relative to their neighbours and to the one-level-coarser group in
bakeable range; nothing is ever global.

---

## 2. The model

### 2.1 Frames

A **frame** is a bounded, locally-anchored coordinate system:

```
Frame {
  id:      string   // stable, persisted ("f0", "f1", …)
  parent:  string | null   // the one-level-coarser frame it is anchored in
  edge:    { s, t: {x, y} }   // maps parent → this frame:  child = (parent·s + t)/base
  depth:   int      // parent.depth + 1;  the display "level" number
  grid:    { w, h, ox, oy }   // this frame's tile grid (captured at creation)
}
```

- The frames form a single **connected tree** (every frame is created from an
  existing one, by crossing up or down), rooted at the coarsest frame ever visited.
  Zooming out from the root creates a new root (the old root becomes its child,
  `depth = oldRoot.depth − 1` — depths may be negative, exactly like levels today).
- The **edge math is byte-identical to today's record math**. A one-frame-per-depth
  tree ("the spine") reproduces the current engine exactly.
- The **spine** = the chain of frames created by the canvas's original zooming.
  Display depth, the scale bar, and kobin-1 migration key off it.

### 2.2 The boundedness invariant

> Every stored coordinate — native points, camera pan, scene rects, tile rects —
> is expressed in some frame, and stays within `~REUSE_RADIUS` of that frame's
> origin **by construction**.

Enforced at exactly one place: **crossing up**. When the camera crosses from frame
`F` into depth `d+1`, project the entry view-centre through each existing child edge:
reuse child `C` iff the projected centre magnitude ≤ `REUSE_RADIUS`; otherwise
**spawn a sibling** child anchored at the entry point (the existing fresh-record
formula — `t = inPan·enter/inScale` — lands the new frame with `pan = 0`, i.e.
anchored exactly at the view).

No other spawn triggers are needed:

- **Hand panning** cannot cover `REUSE_RADIUS` within a frame (1e9 units ≈ 1.25M
  screens at entry zoom).
- **jumpTo / scenes** target content that lives in some frame — the jump switches
  to that frame; it never strands the camera far from an anchor.
- **Crossing down** always follows the parent edge (bounded), creating a new root
  only when none exists (view-anchored by the existing `ensureDown` formula).

### 2.3 Constants

| Constant | Value | Why |
|---|---|---|
| `REUSE_RADIUS` | 1e9 (child-frame units, on the projected view centre) | Sharp radius of a float64 frame is ~1e13 (ink) — 1e9 gives 4 decimal orders of safety. Big enough that only cross-level pan amplification (the dance) ever spawns siblings: a coarse-level pan of D spawns iff `D×3000 > 1e9`, i.e. D ≳ 3.3e5 units ≈ 400+ screens. Hand-scale work never fragments. |
| `REORIGIN_PX` (renderer) | 1.5e6 (existing) | Frame coords still reach ~1e9 legitimately, far beyond float32's ~7 digits — the per-scene origin rebase in Renderer stays load-bearing. |

### 2.4 What never changes

- Per-edge transform math (`toChild`/`toParent`), the crossing hysteresis
  (enter/exit), `deriveStep`, `classifyUp`, `solidQuad`, cull/fade, the analytic
  strip, curve capsules, the renderer diff. A frame's interior is exactly today's
  level.
- Objects are born in the active frame and **never migrate between frames**
  (no retro-transformation of stored points — that is what would destroy precision).

---

## 3. Rendering composition (the XOR invariant, generalized)

Today: `up(L)` = chained from level L−1; `down(L)` = direct minify of levels > L;
self renders live. Frames generalize by classifying every other frame `G` relative
to the active/tile frame `F`:

| Relation of G to F | Route into F | Why it's precision-safe |
|---|---|---|
| **Ancestor** (the parent path) | `up(F)`: chain one edge at a time through the parent's tiles — **unchanged** | each step is one bounded edge; SOLID quads bound growth |
| **depth(G) ≥ depth(F), non-ancestor** (descendants, siblings, cousins-below) | `down(F)`: direct projection of G's natives via the tree walk (up to the common ancestor, then down) — the existing `_bakeDown` loop iterating frames instead of levels | net factor ≤ ~1 (minify or same-scale); intermediates stay bounded because only content near F's window survives the per-step bbox prune; cull/fade math identical (`f = frameFactor(G→F)`) |
| **depth(G) < depth(F), non-ancestor** ("uncles": coarse content from another branch, e.g. a giant background stroke underlying a far dive) | rides the **up-chain**: it reaches the parent `P` as one of P's down-pieces (same-depth-as-P, direct), and `up(F)` derives from `up(P) + natives(P) + P's down-pieces homed at depth == depth(P)` | magnification happens only through the chain, one edge per step, exactly like ancestor content today |

**XOR check** (every piece of ink reaches F exactly once):
- ancestors → up-chain only (they're excluded from `down` by the non-ancestor rule);
- non-ancestors at depth ≥ depth(F) → `down(F)` only (the up-chain's lateral pickup
  takes **exactly** depth == depth(P) = depth(F)−1, so nothing at depth ≥ depth(F)
  rides the chain);
- non-ancestors at depth < depth(F) → up-chain only (excluded from `down(F)` by the
  depth rule), entering at the ancestor whose depth equals theirs.

Tile keys become `frameId|dir|i,j`. Incremental invalidation (`_onDoc`) does the
same footprint tests through frame-tree `mapRect`.

**Down-walk pruning:** `down(F)` iterating "every frame with depth > depth(F)" must
prune by branch: project each candidate frame's content bbox toward F one edge at a
time and drop the whole subtree when it leaves the tile's reach or falls under the
cull — the same `DOWN_MAX_SIZE`/`fadeLoPx` break as today, applied per branch.

---

## 4. Camera

State: `{ frameId, inScale, inPanX, inPanY }`. `activeLevel` survives as a **façade**
returning `frame.depth` (UI, scale bar, and most tests keep working untouched).

- `_crossUp`: find-or-spawn child (per §2.2), then the existing arithmetic.
- `_crossDown`: follow `frame.edge` (or create a new root), existing arithmetic.
- `effectiveZoom` / scale bar: product of edge ratios along the tree path between
  the scale-anchor frame and the active frame (via common ancestor). Same float
  range caveat as today (~±100 depths for the display number only).

---

## 5. Persistence — `kobin-2`

```
{ format: "boundless-drawing", version: 2, meta, 
  camera: { frameId, inScale, inPanX, inPanY },
  frames: [ { id, parent, edge:{s,t}, depth, grid } ],
  natives: { <frameId>: [ objects… ] } }
```

- **Migration from kobin-1 (and dev-0) is lossless and mechanical**: each level `K`
  with a record becomes spine frame `id = "L"+K`, `parent = "L"+(K−1)`,
  `edge = records[K]`; `nativesByLevel[K]` → `natives["L"+K]`; camera level → the
  spine frame at that depth. A canvas that never panned far round-trips to
  byte-equivalent geometry.
- Cloud sync (Firestore chunking) carries the same payload; no rule changes.
- Scenes metadata: scene frames stored as `(frameId, rect)`; kobin-1 scenes migrate
  by mapping their level to the spine frame.

**Legacy damage note:** already-quantized ink (the Star canvas's far region) stays
quantized — its coordinates are huge *in its home frame* and no transformation can
recover information that was never stored. New ink in those regions gets a fresh
sibling frame and is sharp; its *placement* inherits a few units of quantization
from the legacy parent coordinates (invisible: sub-pen-width).

---

## 6. Subsystem notes

- **Renderer**: retained scenes keyed by `frameId`; the per-scene origin rebase is
  unchanged and still required (float32 begins failing at ~1e7, well inside
  `REUSE_RADIUS`).
- **scenes.js**: consumes per-frame natives with the parent edge for adjacent-depth
  stitching (it already refuses to compose more than one record hop — frames make
  that per-edge instead of per-level-int). Sibling frames are far apart by
  construction, so the width-relative join gap never merges across them; no rule
  changes expected. Scene ids/hashes key off frame ids.
- **Eraser / hit-test / select**: pieces carry home `frameId`; edits map through
  the bounded tree walk to home coordinates (same as today's home-level mapping).
- **Report/debug overlays**: tile debug iterates frames.

---

## 6a. Implemented status (2026-07-14, localhost-verified, NOT deployed)

Stages 1–3 and most of Stage 4 are built and green (all suites pass; spine
behaviour byte-identical). Verified live on localhost by reproducing the dance
(draw → zoom out to depth −2 → pan far → zoom back in): a sibling frame `0~1`
spawned, the far-region stroke's stored coordinates were **1.36e3** (vs **1e17**
in the old engine — the input-quantization cure), anchors handed to the browser
were ~80 units, the ink rendered smooth, and a `__frames` save round-tripped
(load restored the tree + `camera.frame`). No console errors.

**Scenes are now frame-keyed (2026-07-14, done + localhost-verified).** A scene's
`level` is a frame KEY — an integer depth on the spine (unchanged; matches old
saves and the numeric spec tests), or a frame id like `"0~1"` for a local
sibling. `scenes.js` clustering stitches across frame-tree EDGES (parent ← each
child) instead of depth±1, injected via `proj.depthOf`/`proj.childrenOf` (with
integer-depth fallbacks so numeric callers are untouched); `normKey` keeps spine
levels integer-typed. `jumpTo(frameKey, rect)`, `_noteInkAdded`, `captureView`,
`refreshScenes`, and persist (`isFrameKey`) all speak frame keys. **Verified
live:** drew in home frame `0` and far sibling `0~1`, computed two scenes
(`s1`→level `0`, `s2`→level `"0~1"`), and confirmed **jumping to each lands in
the correct frame showing the correct ink** (s1→frame `0`/id 1, s2→frame
`0~1`/id 2) — the exact bug this fixes.

**Deferred:** the "uncle" render path (§3, coarse off-branch content
magnifying up into a deep far-branch view). Cannot occur in a spine; occurs only
when viewing deep in one branch while coarse content exists in another. Needs the
up-chain lateral pickup.

## 7. Open questions (flagged for Kobin)

1. **`REUSE_RADIUS` = 1e9** — big enough that normal work never fragments, small
   enough that coordinates stay 4 orders under the danger zone. Sibling frames cost
   one Map entry + tile-cache keys; there is no per-frame render cost when off
   screen. Any reason to prefer smaller (tighter locality, more frames) or larger?
2. **Same-depth sibling ink proximity**: two siblings' content can, in principle,
   grow toward each other until both are visible in one view (each renders via its
   own route — correct and bounded). If they *interleave* at pen-width scale, ink
   from the "other" frame is composited as derived pieces rather than live natives
   (entry-fidelity chords, exactly like cross-level ink today). Acceptable, or
   should heavy overlap trigger a (lossy) merge tool later?
3. **Scale bar across siblings**: depth is well-defined everywhere, so the ×N
   display never jumps; "Set scale" continues to anchor where it was set. Confirm
   that matches the scale-bar design docs' intent.
4. **Damaged-ink cleanup**: the far-region strokes drawn on Star before this fix
   (the stair-step test shapes, and stroke 173's noisy anchors) are permanently
   quantized in storage. Offer a one-time "delete damaged strokes" pass, or leave
   them?
5. **Cosmetic companion**: width-relative decimation (~lw/8) of flattened
   centerlines in `deriveStep` would soften the scallops on already-damaged ink and
   on any future noisy source. Independent of frames; include?

---

## 8. Implementation stages (suite green after each)

1. **Frame tree inside LevelMap** behind the existing integer-level API (spine
   only) — pure refactor, zero behavior change.
2. **Sibling spawn** at `_crossUp` + frame-keyed Camera/Document/TileStore/Renderer
   (this alone fixes input capture in far regions).
3. **Generalized composition** (§3) so sibling/cousin/uncle ink renders across
   frames.
4. **kobin-2 persist + migration**, scenes/jumpTo frame keys, localhost
   verification of the original dance (zoom out → pan far → zoom in → draw → smooth
   ink), on-device check.
