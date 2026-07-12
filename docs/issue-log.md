# bound.less v2 — Issue Log & Backlog

Status of known issues in the v2 infinite-zoom engine (branch `v2` / `new-ui`).
Last updated **2026-07-09**. Diagnoses below were reproduced on desktop by loading the
exact phone snapshots (via the Report button → `.kobin-reports/`) unless noted.

Legend: **Sev** = user impact (visual-correctness > perf > polish). **Repro** = can it be
reproduced deterministically today.

---

## 🎨 2026-07-08 — Product UI shell (`new-ui` branch, Phase 2 partial)

The zoom-out-joy **artist-version** prototype was ported into the CRA app as bound.less
product pages (`HomeV2`, `CanvasesV2`, `CanvasEditor`), rebranded from Everdraw. The real
`KobinEngine` draws in `CanvasEditor`; `CanvasV2` (`/#/v2`) remains the dev harness.

**Phase 2 (engine-backed):**

| Feature | Implementation |
|---------|----------------|
| Scenes sidebar | Phase 1 stub — static demo list; clicks toast "coming soon" |
| Gallery thumbnails | Demo JPGs on `/canvases` |
| Scale bar / Set scale | `scaleBar.js` + drag-to-define; `meta.scaleDef` in persist; unit-lock via `minUnitRank` |
| Multi-canvas | Route param is cosmetic; single `localStorage` autosave (`kobinAutosave`) |
| Tool rail | Select, straight line, erase object, wipe, undo/redo, color picker, width/opacity, file actions |

Files: `src/engine/scaleBar.js`, `src/Components/editor/*`, `src/Pages/{CanvasEditor,CanvasesV2,HomeV2}.js`,
`src/hooks/useKobinEngine.js`, `src/Stylesheets/boundless-ui.css`.

**Reverted (2026-07-09):** Scene auto-detect, `canvasRegistry` multi-canvas, thumbnail capture,
and pixelation fix attempts — no visible improvement in testing.

---

## 🎨 2026-07-08 — Product UI shell (`new-ui` branch, Phase 1) — superseded by Phase 2 above

**Phase 1 stubs (styled, not engine-backed yet):**

| Feature | Phase 1 | Phase 2 |
|---------|---------|---------|
| Scenes sidebar | Static list + demo JPG thumbnails; clicks toast "coming soon" | ✅ Done — see Phase 2 table |
| Gallery thumbnails | Demo JPGs on `/canvases` | ✅ Done |
| Scale bar / Set scale | HUD shows `effectiveZoom`; dialog saves local UI state only | ✅ Done |
| Multi-canvas | Route param is cosmetic; single `localStorage` autosave | ✅ Done — localStorage registry |

Files: `src/Pages/HomeV2.js`, `CanvasesV2.js`, `CanvasEditor.js`, `src/hooks/useKobinEngine.js`,
`src/Stylesheets/boundless-ui.css`.

---

## ⚡ 2026-07-06 — Symmetric-engine rewrite (roadmap items 4 + 5, all five bugs fixed)

The god-class `KobinEngineV0` was replaced by a class-per-concern engine
(`KobinEngine` facade over `LevelMap` / `Document` / `Camera` / `TileStore` /
`Renderer` / `geometry/{derive,clipperOutline,hittest}`) built around ONE mechanism:
**universal bidirectional tiles at every level** (incl. 0 and negatives). Zoom-in and
zoom-out now obey the same symmetric size policy — too-small content is culled/faded,
too-big content collapses to bounded tile fills — so the old up-projection explosion
class is impossible by construction. Global z-order = creation id; rendering is
incremental (persistent per-id groups, diffed). Fixes **BUG-01..05** and
**ISSUE-11/13/14/15/17** (see per-item notes); validated by a ground-truth fidelity
harness over all 13 real report snapshots and a perf bench (BUG-05 scene re-render:
111 ms → 0.2 ms/frame). The old engine remains ONLY as the golden-test oracle
(`KobinEngineV0.js`); v1 (`src/Draw`, `/canvas` routes) was deleted and `/#/v2` is now
the home canvas. The fixed bug invariants live in `KnownBugs.fixed.test.js` (green).

---

## A. Phone-reported bugs (2026-07-04)

### BUG-01 — Sluggishness on a simple-looking scene ("11") — ✅ FIXED 2026-07-06
> Fixed by the incremental renderer (ISSUE-11): persistent per-id groups, piece-identity
> diff — a no-change frame reuses every path. Bench on the BUG-05 scene: 111 ms → 0.2 ms.
- **Report:** `.kobin-reports/report-2026-07-04T05-47-53-356Z.json` (`05-47`) — level −4,
  **329 objects** (only ~8–29 on screen), `hasFat: true`.
  (The "11" scene: two dark strokes under the translucent yellow overlay; the visible
  drawing looks trivial.)
- **Symptom:** lag "for apparently no reason" — the screen shows a simple "11", but it
  stutters.
- **Root cause (confirmed from the perf log):** renders take **184–241 ms for only 8–29
  visible objects**. Two compounding costs, neither visible on screen: (1) a large **fat
  fill re-outlines every render** (the width-gate outline path — likely the big translucent
  yellow overlay and/or a background stroke — re-baked on the 25%-scale band); (2) the
  drawing has **~150 translucent objects** (opacity 0.45/0.9), each rendered as its own
  isolated `<g opacity>` group that the browser must composite. On top, `_renderActive`
  tears down and rebuilds the **entire SVG DOM every frame** (no diff). So the lag scales
  with total scene complexity (hidden translucent geometry + a fat overlay), not with the
  few marks you see — hence "for no reason". A phone (~3–4× slower) makes 200 ms renders
  clearly janky.
- **Related debt:** ISSUE-11 (no incremental render), ISSUE-12 (fat re-bake cadence),
  and translucent-group compositing cost (many `<g opacity>` buffers).
- **Proposed tests:**
  1. Perf unit: render time must not scale with off-screen object count; assert a scene of
     N mostly-off-screen objects renders in ~O(on-screen).
  2. Assert `_renderActive` is not called on a pan/zoom that changes neither the visible
     tile set nor leaves the baked window.
  3. Assert a steady-state zoom tick within the 25% band does not re-outline the fat fill.

### BUG-02 — Random cutout in a purple shape — ✅ FIXED 2026-07-06
> Bake-window pad is now max(half screen, 1.2 × widest visible fat half-width), so the
> window can never be outrun by the band (safe now that projection giants no longer
> exist as strokes). Green invariant: KnownBugs.fixed.test.js.
- **Reports:** purple `#640055` appears in four `.kobin-reports/` snapshots —
  `report-2026-07-04T05-12-22-208Z.json` (`05-12`, primary), `…T05-33-05-055Z.json` (`05-33`),
  `…T05-47-53-356Z.json` (`05-47`), `…T06-02-53-580Z.json` (`06-02`). The root cause was
  verified separately at a *live* Chrome state (level 9, window 1504×812), not from these
  reports — the cutout wasn't on-screen when any Report was tapped.
- **Symptom:** at high zoom a LARGE part of a fat purple stroke stops being drawn,
  revealing the shapes behind it; zoom out a hair and it snaps back, zoom in and it cuts
  out again at the same window. (An earlier, much smaller thin-slit artifact was a red
  herring — the real bug is a big coverage loss.)
- **Status: REPRODUCED at the user's exact live state + camera + window, root cause
  confirmed, fix verified.** Live state: level 9, inScale 73.5, window **1504×812**, purple
  id 119 (`lwFrame` 87). Loading that exact snapshot renders the purple at **8% coverage**
  (`purpleFrac` 0.078, 55% black) — matching the user's screenshot. Interactive zoom-out
  shows a **sharp snap** from 0.099 → 0.573 between inScale ~60 and ~54 (the re-bake
  boundary), i.e. the user's "snaps back".
- **Root cause (confirmed): the fat-stroke bake window is smaller than the stroke's
  half-width at high zoom.** `_outlinePad()` returns half a screen in frame units
  (`0.5*width/inScale`); at inScale 73.5 that is **10.2 frame units**, but the purple's
  half-width is **43.5 frame units**. The fat outline is built for `vw =
  _frameWindow(_outlinePad())`, so centerline whose fat band still paints on-screen — but
  which lies beyond the too-small padded window — is dropped, and the purple's fill is cut
  off. The fresh bake at inScale 73.5 is itself broken (outline `d` collapses to 3096 chars
  vs 19382 at inScale 53), so it is a scale-dependent **bake** bug, not staleness; the
  visible snap is just the 25%-scale re-bake cadence on top of the continuous degradation.
- **Fix VERIFIED (in-page diagnostic, not yet in code):** overriding `_outlinePad()` to
  `max(0.5*width/inScale, maxOnScreenStrokeHalfWidth)` restores the purple to **0.569** at
  the exact broken camera (0.078 → 0.569, visually correct fill). Forcing the browser-stroke
  path (bypassing the fat outline) also gives 0.569, confirming the loss is in the
  windowed fat-outline generation. NOTE: an earlier "pad isn't it" test was wrong because it
  ran on a contaminated state that had no real cutout.
- **Severity: high** (large visible chunk of a drawn shape vanishes; intermittent).
- **The fix:** make `_outlinePad()` at least the largest on-screen fat-stroke half-width
  (in frame units), so the bake window always contains every centerline whose band reaches
  the screen. (Costs a slightly larger bake for very fat strokes — acceptable.) Keep an eye
  on the re-bake window/`_windowCovered` using the same pad so panning still doesn't thrash.
- **Proposed tests:**
  1. **Coverage-vs-zoom (promote the scan used here):** at a fixed window, load a fat
     stroke and sweep inScale; assert on-screen purple coverage is a **continuous** function
     of zoom with **no sudden drop** (fails today: 0.57 → 0.08 across the re-bake near
     inScale 57 at 1504×812).
  2. **Band-membership unit:** the emitted fat outline must cover every window pixel within
     `width/2` of the centerline, across scales and window sizes — especially where the pad
     would otherwise be < half-width.

### BUG-03 — Translucent yellow composites incorrectly (black shapes above *and* behind) — ✅ FIXED 2026-07-06
> Global z-order: render list merged and sorted by creation id; one Two.Group per id,
> groups kept id-sorted under the world. Representation buckets no longer decide order.
- **Report:** `.kobin-reports/report-2026-07-04T05-33-05-055Z.json` (`05-33`) — level 1.
  Yellow `#efff00` @ **0.45**, plus many opaque blacks.
- **Symptom:** a faint yellow layer over the drawing, but some black shapes show *through*
  it (behind) while others sit *on top* of it — inconsistently.
- **Root cause (confirmed, provable from render order):** **there is no global z-order.**
  `_rebuildLevelObjects` builds the draw list as
  `[visible tiles, tile-by-tile] → up-projected → natives → down-projected`, and with
  per-object opacity groups each object's z is fixed at its **first appearance** in that
  list. Observed for this scene: the yellow fill (id 628, inherited) lands at z3/z7; the
  same black shapes (id 1/44/46) appear **both** before it (z0–2 → behind) and the black
  **natives** (id 50/54/58, z8+) always draw after *all* inherited tiles (→ in front).
  So identical-looking blacks composite on different sides of the translucent yellow purely
  by which representation-bucket they came from — not by when they were drawn. The
  "universal ordered stack" from the design was never implemented; draw order is structural.
- **Severity: high** (visible mis-compositing; also means erase/edit z is unreliable).
- **Related:** the boat scene (780 objs, mixed opacity across many levels) will show this
  strongly; ISSUE-13 (universal-z), which the structure refactor is meant to deliver.
- **Proposed tests:**
  1. Z-order unit: draw A (opaque) then B (opaque) overlapping at the same level; after a
     zoom that puts one in a tile and one as a native, assert the pixel where they overlap
     is B's color (last-drawn wins) — fails today.
  2. Translucent-order unit: opaque black under a 0.45 yellow drawn later → the overlap
     pixel must be the *blended* value, and must be identical whether the black is a native
     or an inherited tile copy. Fails today (order depends on bucket).

### BUG-04 — Boat detail "appears out of nowhere" on zoom-in — ✅ FIXED 2026-07-06
> Content in the fade band [fadeLoPx 0.15, cullPx 0.3) px-at-enter is baked with a size
> tag; its group opacity ramps continuously with zoom instead of popping at 0.3 px.
- **Reports:** `.kobin-reports/report-2026-07-04T06-02-53-580Z.json` (`06-02`) /
  `report-2026-07-04T06-03-01-766Z.json` (`06-03`) — level 12, 780 objects (detail at
  levels 13+).
- **Symptom:** zooming into the boat, fine detail pops in abruptly rather than resolving.
- **Root cause (confirmed): LOD, by design — but it *pops* instead of fading.** Two hard
  thresholds create discrete appearance boundaries:
  1. **Sub-pixel cull:** `_projectedNatives(…, "down")` skips any finer-level native whose
     projected size `(diag + lw)·factor·enter < 0.3 px`. Below the threshold it renders
     **nothing**; cross it while zooming and the object appears instantly.
  2. **±6-level projection cap:** natives more than 6 levels from the active level are not
     projected at all (float headroom guard). In this scene **90 objects are beyond the
     cap** and only appear once you zoom within 6 levels of them.
  Plus tile fault-in at each crossing. None of this is a *correctness* bug — it is the
  intended level-of-detail behaviour — but there is **no fade/ramp**, so the transition is
  a pop. This is the legitimate complaint.
- **Severity: polish** (expected behaviour, poor transition).
- **Proposed tests / work:**
  1. Add an **alpha ramp** near the 0.3 px cull (e.g. fade over 0.3→1.5 px) so detail
     fades in; test that an object's rendered opacity is a continuous function of its
     projected size across the threshold.
  2. Document the ±6 cap as intended; optionally test that crossing into range is the only
     way beyond-cap objects appear (no flicker at the boundary).

### BUG-05 — Drawing "disappears" and the pen goes janky when zooming IN across many scales — ✅ FIXED 2026-07-06
> Coarse content now reaches finer levels through the tile chain (one ×3000 step at a
> time) with the symmetric size policy: bands that flood a tile become bounded fills
> (solid-quad tier / edge backstop), so nothing ever enters the render list as a monster
> stroke. Fidelity harness: all three 2026-07-05 snapshots now render their true ink.
- **Reports:** three desktop-Chrome snapshots in `.kobin-reports/` —
  `report-2026-07-05T16-44-51-256Z.json`, `report-2026-07-05T16-44-55-702Z.json`,
  `report-2026-07-05T16-44-59-683Z.json` (4 s apart), window 1504×868. One drawing built across **8 levels** (natives at 0, −1 … −7; bulk 52 at −6,
  22 at −4; ~106 total). The three are a zoom-IN sequence: effectiveZoom 8.6e‑20 → 2.1e‑19
  → 5.6e‑19, active level −6 → −5.
- **Symptom (user):** "the pen started acting all funny and everything would disappear when
  I zoomed in"; intuition that zooming out isn't symmetric with zooming in. Confirmed.
- **Status: root cause confirmed** from the reports by re-running the projection math on the
  exact snapshots. Levels ≤ 0 have no tiles, so every off-level stroke is **projected** to
  the view, and the two directions are **asymmetric**:
  - **down** (finer → coarser, zooming out) culls anything under 0.3 px
    (`_projectedNatives` down-cull) — detail shrinks away gracefully.
  - **up** (coarser → finer, zooming in) has **no size guard**, only a hard **±6-level cap**.
    Each level step magnifies by `enter/base = 3000×`.
  So a normal 16 px stroke drawn at level −6, viewed from −5, projects to a ~6,500 px
  on-screen linewidth (4× the screen); from −4 it would be ~19,000,000 px. Measured across
  the three snapshots: fat-on-screen strokes **34 / 37 / 43**; strokes wide enough to flood
  the whole window (half-linewidth > screen diagonal) **15 / 24 / 33**; max on-screen
  linewidth **1.7M / 4.3M / 11M px** — climbing as the camera zooms in.
- **Why it disappears — BUG-02 amplified.** Those up-projected bands feed the fat-outline
  fill, which bakes coverage only inside a window padded by `_outlinePad() = 0.5·width/inScale`
  (~5,500 frame units at the level −5 camera). The projected **half-widths are 24,000 →
  5,000,000 frame units**, so pad ≪ half-width and the windowed bake drops the coverage that
  should paint — exactly BUG-02, now unavoidable by construction (you cannot grow the pad to
  5,000,000 units without re-entering the OOM regime `6863fe6` fixed). Strokes whose
  centreline passes near the view centre instead hit the "disc covers the whole window"
  short-circuit and flood a **solid quad**, so the screen becomes a mix of blank (dropped
  bands) and solid-colour floods and the detail is buried — "everything disappears."
- **Pen "acting funny":** every `pointerMove` re-renders, re-baking ~10–30 monster fat
  strokes (flatten + offset at 1e6–1e7 px scale) plus the full O(N) teardown (ISSUE-11), so
  drawing stutters, and a fresh thin stroke is immediately buried under the coarse floods.
- **Not precision:** no NaN/Inf in the projected geometry; pans (~3.5e8) are still within
  float64 headroom at these depths. It is the up-projection ↔ fat-bake interaction.
- **Severity: high** (content vanishes / view unusable when drawing across many scales — the
  core "draw at any zoom" workflow).
- **Related:** BUG-02 (same fat-outline window defect, milder), BUG-04 (the ±6 cap and hard
  LOD boundaries), ISSUE-11 (full-teardown render behind the jank), BUG-03 / ISSUE-13
  (within the up-projected bucket, draw order is not strict coarse→fine).
- **The fix (direction; not just BUG-02's "grow the pad"):** give up-projection a size policy
  that mirrors down's cull — treat "the camera is inside a coarse stroke" as a first-class
  **solid-coverage** case via a robust band-contains-window test (not the windowed outline
  bake), and/or **clamp/skip** up-projected bands whose on-screen half-width exceeds the
  window so they never reach the outline offset. A fade near the ±6 cap (shared with BUG-04)
  removes the hard vanish.
- **Proposed tests:**
  1. **Invariant (added — `KnownBugs.test.js`):** an up-projected coarse stroke must not be a
     fat band the bake window cannot contain — assert `_outlinePad() ≥ projectedHalfWidth`.
     Fails today (~400 vs ~1.8e7 for a 2-level up-projection).
  2. **Asymmetry:** a fine stroke symmetric to a coarse one about the view — the fine one is
     culled from the render list (down), the coarse one is not (up); once fixed, the up path
     should have an equivalent bound.
  3. **Coverage-vs-zoom (needs rasterization):** with content on several levels, sweep zoom
     in and assert total inked coverage does not collapse to blank/solid across a level.

---

## B. Known unfixed issues (prior sessions)

- ✅ **ISSUE-11 (FIXED 2026-07-06) — full-teardown render.** Every render removes all SVG
  children and rebuilds every object's paths + `two.update()` rebuilds the whole SVG DOM.
  No diffing. The per-object opacity groups (αSeam work) are the structure an incremental
  renderer would sit on. *Primary driver of BUG-01.* Test: render-call count and DOM-node
  churn stay flat when only the camera moves within a baked window.
- ✅ **ISSUE-12 (FIXED 2026-07-07 — display side) — fat-stroke re-bake cadence is GONE.**
  D11 landed as `geometry/curveOutline.js`: fat strokes render as filled **curve-capsule
  outlines** (Bézier offset fits + arc caps, one loop per curvature-bounded run; exact to
  0.25 px at the level's deepest zoom) built ONCE per object in frame coordinates — SVG
  rasterizes the curves, so one bake serves the whole ×6000 in-level range and
  `needsRebake()` is now outlineMode-debug-only. Inherited pieces never need display fat
  handling: the tile bake polygonizes any stroke that could exceed `fatWidthPx` within
  the child level (representation switches only at level handoffs). Handoff fidelity is
  pinned by KobinEngine.fatOutline.test.js (outline at max in-level fatness vs the tile
  bake after the crossing: pixel-constant vs ground truth outside a ~2 px edge band).
  Measured (desktop, 780-native snapshot, 48-step zoom sweep): 12 renders at 209–430 ms
  per 25% band → **0 renders, ~2 ms/step**; the 42-piece deep-zoom scene that hit 5.5 s
  renders → 0 renders. New one-time cost: the offset fit at pen-up (~50 ms typical,
  ~135 ms for a 400-point stroke) — future option: fit incrementally during the stroke.
  Clipper now runs ONLY in tile bakes and the outlineMode debug view.
  Original note: Gate-wide strokes re-outline on every 25%
  scale change and on leaving the padded window. Fine alone; compounds with ISSUE-11.
- ✅ **ISSUE-13 (FIXED 2026-07-06) — universal z-order.** Delivered by the Document/id design (see BUG-03). Root cause of BUG-03. Draw order is representation-
  bucket order, not creation order. The design's "universal ordered stack" is unbuilt.
  The structure refactor (Document model) is where this lands.
- ✅ **ISSUE-14 (FIXED 2026-07-06) — mega gate now keys on span OR offset radius** (half-width > 4× window/tile diag routes to the analytic strip). The `mega` gate keys on span, not
  width; a wide-but-short giant (e.g. a level-0 pen stroke baked deep, offset radius ~9k)
  falls through to Clipper's offset (~11k pts/cap, hundreds of ms) instead of the analytic
  strip. Slow, not fatal. Found during the OOM-fix (`6863fe6`). Test: a wide-short stroke
  baked several levels deep bakes under a time bound.
- ✅ **ISSUE-15 (FIXED 2026-07-06) — subsumed:** the minify bake culls at fadeLoPx before any geometry work; live projection no longer exists. Finer natives that
  project to 1–2 px are still constructed as full curved strokes before the browser shrinks
  them; a stricter visibility cull would skip them. Minor.
- **ISSUE-16 (open; largely neutralized) — offset quantization.** Offsets now run in tile-/window-LOCAL coords, so magnitudes are small and Clipper’s scale cap rarely binds; a float offsetter (curve outlines, D11) remains the durable fix.  
  Original note: At the capped Clipper integer scale, very
  fat strokes quantize by whole frame-units (visible once magnified). Durable fix = a float
  offsetter (analytic normals + arc joins), Clipper only for union.
- ✅ **ISSUE-17 (FIXED 2026-07-06) — per-level uniform-grid spatial index** in Document (half-width-inflated bboxes, big-object overflow, flat-scan fallback for huge queries). Tile bakes and eraser hit-tests scan all objects
  linearly. Fine at hundreds; matters at thousands. A per-level grid hash is the fit.
- **ISSUE-18 — Dense-region LOD "blob" (US-4 TODO).** Coarse levels don't collapse dense
  sub-pixel clusters; a tile with thousands of tiny strokes would stall. Not yet hit.
- **ISSUE-19 — Re-anchoring for very long pans (US-11).** `reanchor` is unimplemented;
  float headroom is large so this is low priority.
- **ISSUE-20 (open; mitigated) — paint slowness.** Smaller dirty sets + window-clipped fills reduce pressure; still watch on-device.  
  Original note: Desktop `Page.captureScreenshot`
  repeatedly times out (30 s) on these scenes while JS stays responsive — the SVG *paint*
  is the bottleneck (large fat-fill paths). Consistent with BUG-01's on-device sluggishness
  and worth watching as scenes grow.  
  2026-07-07 addendum: the perf log is blind to paint — a scripted desktop pinch on a
  few-object scene ran 0 renders and ~3 ms JS per frame while the browser repainted
  ~900 px-wide SVG strokes every frame. The Report payload needs a rAF frame-delta
  histogram so on-device paint jank becomes visible. Related JS-side fix landed
  2026-07-07: `onStatus` → React re-rendered the whole CanvasV2 toolbar on EVERY
  pan/zoom event (~12 ms/frame measured); status updates are now throttled to 50 ms
  trailing-edge. Curve outlines also shrink SVG path payloads ~5–7× vs the flattened
  polygons they replace, which should ease paint pressure on the phone.
- ✅ **ISSUE-24 (found + FIXED 2026-07-08) — a fat stroke with an inside (concave)
  corner rendered as an HOURGLASS after a crossing.** Reported as an "opacity" bug:
  zooming into a stroke with an inner corner, crossing the level barrier, a large part
  of the stroke vanished / merged with the stroke beneath, leaving an hourglass. Root
  cause: the up-content fat bake's analytic strip (`strokeStripNear`) built the band as a
  SINGLE miter ribbon (`L` forward, `R` reversed). On the concave side of a sharp corner
  the inner offsets cross into a reversed sub-loop whose winding is opposite the body, so
  under nonzero fill it cancels to a HOLE. (The level-0 curve outline is pocket-proofed
  for this — the bug only showed after the handoff to the tile bake, which is why it
  appeared "at the crossing.") Fix: keep the miter ribbon for the outer boundary (so the
  crossing stays pixel-stable vs the level-0 outline — the fatOutline handoff test still
  passes at 0 mismatches) and add convex per-segment rectangles underneath; same-oriented
  and additive under nonzero fill, they overwrite the cancellation to a solid fill.
  Every ring is orientation-normalized so pieces only ADD. GOTCHA that cost a detour: a
  first attempt used per-segment rectangles + `capPiece` round-join fans at every vertex —
  a `capPiece` sector wider than 180° is NON-convex, which trips `clipRingsToRect`'s
  winding compensation and BLANKS interior tiles (deep holes 46–189 px inside the band).
  Convex-only pieces keep that compensation quiet. Measured on the report drawing: level-0
  ↔ level-1 coverage divergence 128 → 40 sample points, layers-lost-at-level-1 118 → 30.
  Regression: clipperOutline.test.js "a sharp CONCAVE corner stays solid".
- 🧪 **Scene retention (prototype, 2026-07-08) — a level flip now swaps SVG subtrees
  instead of rebuilding every path.** The 2026-07-08 report trace showed crossings costing
  1–3 s EACH and never getting cheaper on repeat (21.6 s across 12 flips): the timer wraps
  `render()` + `two.update()`, and a flip changed `activeLevel` → an entirely different
  piece set → all ~50 groups torn down and their SVG `<path>` `d` strings rebuilt, every
  crossing, because one `world` group held one level at a time. Renderer now keeps a
  per-level scene (a `Two.Group` under `world` + its own id→group map, LRU-bounded to 8);
  a crossing detaches one root and attaches the target's, so bouncing across a boundary
  reuses cached paths (Two.js only rebuilds `d` when a path's vertices change) and moves
  DOM instead of reconstructing it. Correctness stays the render diff's job (value-based
  sigs). Dev toggle "Retain" (default on); off = one shared scene = the old
  rebuild-on-crossing behavior. Tests: Renderer.retention.test.js (0 rebuilds on a
  round-trip, path-identity reuse, LRU bound, engine wiring). Real-browser perf win is
  Kobin's on-device retest.
- ✅ **ISSUE-22 (found + FIXED 2026-07-07) — Clipper's self-union made fat BAKES
  quadratic in stroke points; one dense stroke = a 167-second level flip.** The
  non-mega fat bake offset the full display-fidelity chord set through Clipper, whose
  offset internally UNIONS the band with itself. A dense freehand centerline magnified
  ×3000 self-overlaps everywhere → ~n² intersections: a 1,321-point stroke took 583 s to
  bake ONE tile (measured; a 181-point stroke took 25 s — 7× points, 23× time). Fix: all
  fat bakes route through the O(n) analytic strip (`strokeStripNear`) — with per-id
  opacity groups + nonzero fill, self-overlap needs no union (same argument that removed
  Clipper from the display path, D5/D11). Result: that tile bake 585,745 ms → 550 ms.
  The legacy Clipper branch survives only for V0 golden comparisons (gated on
  `cfg.fatWidthPx`). Related perf work same day: **incremental tile updates** (add/erase/
  edit strips or appends per-object pieces in cached tiles instead of dropping them —
  "one added stroke invalidated the entire cache" is gone; only chained up-tiles ≥ 2
  levels deeper still invalidate), **fatWidthPx 500 → 4000** (fidelity-neutral: raw
  stroking and the curve outline are both exact; the gate only trades Skia-mis-stroke
  margin ~25k/4000 ≈ 6× against fitting work — the default 13 px pen now never needs an
  outline at its own level), **lazy outlines** (fat strokes render raw until they
  approach the gate; fitting runs in idle slices or a 12 ms/render budget past the gate —
  dev toggle "LazyFat"), **early prebake** (near a first crossing the child record is
  defined at 0.8×enter and its tiles baked in idle, so first flips land warm — dev
  toggle "PreBake"), **autosave dirty-flag + idle** (stringifying MBs every 4 s during
  pure browsing was the "scrolling has a delay" hitch), and a fixed bbox-vs-rect field
  mismatch that had silently disabled `_bakeDown`'s pruning.
- ✅ **ISSUE-21 (found 2026-07-07, FIXED same day by the curve-outline redesign) — fat
  conversion was only re-evaluated inside a render.** Original problem: `_hasFat` was
  computed in `render()`, `needsRebake()` consulted the stale flag, and a centre-zoom
  inside one tile range never rendered — a stroke could paint as a raw SVG stroke up to
  ×6000 past its last render (27k–67k px for wide pens: BUG-02's Skia regime + hidden
  paint cost). Fix (structural, not a gate patch): the representation choice is now a
  property of the OBJECT, not the view — any stroke with `lwFrame × enter > fatWidthPx`
  (i.e. could EVER exceed the gate within its level) renders as a curve-capsule outline
  from its first render, so no camera motion can ever produce an over-wide raw stroke.
  Pinned by KobinEngine.fatOutline.test.js.

---

## C. Roadmap backlog (agreed order; items 1–5 done)

1. ✅ Everyday tools (undo/redo, eraser, pen types, palette, width, wipe, download) — `f765d7d`
2. ✅ Regression tests (geometry + headless engine) — `f765d7d`
3. ✅ Touch / pinch input + LAN access — `f765d7d`
4. ✅ **Structure refactor — DONE 2026-07-06.** Document model (objects, ids, global z,
   change events) + class-per-concern split (LevelMap / Camera / TileStore / Renderer /
   facade); stale scaffolding deleted; universal bidirectional tiles replace live
   projection. Delivered ISSUE-13 / BUG-03 and the foundation for editing.
5. ✅ **Perf / robustness backlog — DONE 2026-07-06** (as part of item 4): incremental
   render diffing (ISSUE-11 → BUG-01), idle pre-bake of the next level's tiles, tile LRU
   eviction, spatial index (ISSUE-17), radius-keyed strip routing (ISSUE-14), sub-pixel
   cull in-bake (ISSUE-15), detail fade (BUG-04). Float offsetter (ISSUE-16) deferred —
   largely neutralized by tile-local offsets; the durable form is the curve-outline
   display path (see D11 note below).
6. ✅ **Persistence / save format — DONE 2026-07-06.** `src/engine/persist.js`: the
   **kobin-1** format — `{ format:"boundless-drawing", version:1, meta:{name, createdAt,
   modifiedAt, app}, camera, crossings, natives }`. The payload shapes are exactly what
   Camera.state / LevelMap.serialize / Document.serializeNatives emit, so dev-0
   byte-compat holds; `decodeDrawing` also reads legacy dev-0 snapshots (autosave
   migration) and hard-validates ids/geometry/version while preserving unknown fields
   (forward compat). Engine: `serializeDrawing(meta)` / `loadDrawing(raw)` (throws a
   readable Error, validates BEFORE touching state). UI: Save (prompt for a name →
   downloads `<name>.boundless.json`), Open (file picker, confirm + autosave backup to
   `kobinAutosave.backup`), SVG export — all under one file group. Autosave now writes
   kobin-1. Objects gained an optional `z` field (see item 7/true-erase) that only
   serializes when ≠ id.
7. ✅ **Selection / edit (US-10) — DONE 2026-07-06.** "Select" tool: tap-select the
   topmost object (same hit policy as the eraser; selecting a derived piece selects the
   NATIVE), drag to move (deltas map through the level chain to the home frame; the
   whole drag is one undo op), edit panel for color / width(px on screen) / opacity /
   delete (a continuous edit gesture coalesces into one undo op). Document gained
   `getById/moveById/restyleById` — edits mutate in place, bust the derive caches
   (_bbox/_dispFlat/_flat), reindex, and emit `change` events carrying the OLD footprint
   so the TileStore invalidates both where the object was and where it is (ghost-move
   test in KobinEngine.edit.test.js). Renderer draws the selection bbox in screen space.
   **True erase** landed with it (see C2).
8. **Expansion.** Shapes, text (opentype.js), touch polish, minimap / "return to my
   drawing" (the long-standing README wish), then the backend decision (Firebase is
   decommissioned).

Also still open from the original user stories: **US-11 reanchor**
(US-7 erase and US-10 edit are now done).

### C2. Feature backlog (unscheduled — captured 2026-07-05)

Ideas beyond the ordered roadmap above; not yet prioritized. Several extend item 8
(Expansion) and depend on the Document model (4), persistence (6), or selection (7).

**Signature / infinite-zoom feature**
- **Scale reference / measurement.** A way to compare scales across the zoom depth — how
  big the current view is relative to something drawn at another depth — and, if possible,
  anchor the canvas to **real-world units** (Planck lengths, µm, inches, AU, light-years, …).
  Pick a unit for a reference mark and every level reads out its true size. Fits the existing
  level math (each crossing ≈ ×3000, `effectiveZoom` is already tracked) → surface it as a
  labelled scale bar / ruler that relabels as you cross levels. Design open.

**Tools & editing**
- **Brush types.** More pens/brushes beyond freehand / highlight / straight (calligraphy,
  tapered, textured, dashed, …).
- **Other drawing tools.** Shapes (rect / ellipse / line / polygon), fill, etc. (overlaps
  item 8; shapes already stubbed in the model).
- **Rotation.** Two senses: rotate the *view/canvas* (a two-finger twist gesture alongside
  the existing pinch pan/zoom, plus its inverse on export) and rotate *selected objects*
  (needs selection, item 7). View rotation adds a camera angle to the level/crossing
  transform — check the tile grid + fat-outline bake stay correct under a rotated window.
- **Colour-picker sampler (eyedropper).** Sample a colour from anywhere on the canvas into
  the palette.
- ✅ **True erase — DONE 2026-07-06.** The "Eraser" tool (`erasePartial`) cuts stroke
  centerlines with a disc (`geometry/cut.js`, exact circle/segment intersections; cut
  radius = eraser radius + lw/2, so surviving pieces' round caps land tangent to the
  eraser). Pieces are new natives inheriting the source's **z** (render depth = (z, id)
  now — threaded through derive/TileStore/Renderer), replayed by cut/uncut undo ops.
  Rubbing takes EVERY stroke the disc touches; strokes the eraser can't span (painted
  width > 6× eraser radius — e.g. magnified giants) are skipped, and fills fall back to
  whole-object erase. The old whole-object eraser stays as "Erase Object" (`erase`).
  Still open: a paint-eraser mode (area subtract on fills).
- **Background edit.** Change the canvas background (colour now; image / gradient later);
  ties into export and the scale reference.
- **Images / files / AI insert.** Insert raster images or files onto the canvas, plus an
  AI-generated-content insert. Needs the Document model (4) to carry non-stroke objects and
  persistence (6) to store them.

**Export & I/O**
- **Partial / multi-format export.** Export a selected *region* (not just the whole canvas)
  and to raster formats (PNG / JPEG) in addition to the current full-SVG download. Region
  export needs selection (item 7).

**UX / housekeeping**
- **Select/eraser tool UX (reported 2026-07-07).** "The objects are weird and need to be
  made more user friendly" — the first-pass Select and Eraser tools (2026-07-06) behave
  oddly in real use. Known rough edges to revisit: tap-select hit slack vs spline bulge
  (taps near a curve can miss), selecting through giant magnified fills grabs surprising
  objects, drag-move has no visual affordance beyond the dashed bbox, the partial
  eraser's "can't span → silently skip" rule reads as a dead eraser (needs feedback,
  e.g. an eraser-circle cursor + a wiggle/flash when a stroke is skipped), eraser size
  is hidden state (follows pen width with no on-canvas preview), and the edit panel
  covers the canvas on phones. Needs a proper interaction-design pass.
- **Make v2 the default canvas.** Promote `/#/v2` to the home route so the app opens on the
  v2 engine (retire / redirect the old v1 canvas).
- **Dev-tools cleanup.** Move the debug toggles (K-debug, Tiles, Edges, αSeam, perf overlay,
  Report) out of the main toolbar into a dedicated dev menu / gated access, so the everyday
  UI stays clean.

---

## D. Design notes — the fat-stroke outline path (context for BUG-01/02, ISSUE-11/12/16)

Several issues share one subsystem, so the rationale and trade-offs are collected here.

**Why fat strokes are baked into outline fills at all.** A stroke wider on screen than
`polygonizeWidthFrac` of the page is NOT drawn as a browser stroke — the engine computes
its outline itself and draws a filled polygon (`_fatOnScreen` → the fat branch of
`_buildPaths`). The reason is a browser bug, not ours: at extreme widths the browser's
stroke rasterizer (Skia) mis-places the band edges — measured ~220 px off at ~284× in-level
zoom vs float64 ground truth. So for very fat strokes we can't trust the browser and roll
our own outline. **This whole path is a workaround for a browser defect** — and it brought
its own defects (BUG-02, and the perf cost behind BUG-01).

**Why it re-bakes instead of computing once.** Two independent reasons:
1. *Smoothness.* A baked outline is a polygon — curves (round caps/joins, the offset of a
   curved centreline) are approximated by straight segments to a tolerance chosen for the
   *current* zoom. Bake once and magnify 100× and those segments become visibly chunky. So
   it re-tessellates finer as you zoom in. Baking "fine enough for any zoom" up front is
   effectively infinite detail — huge and slow. Compromise: bake sub-pixel for the current
   zoom, re-bake only every 25 % scale step (ISSUE-12), magnify the last bake in between.
2. *Windowing (this is what BUG-02 lives in).* At deep levels a stroke can have astronomical
   span/coordinates. Baking the whole outline when a sliver is visible would be an enormous
   polygon (millions of points, a giant SVG node → ISSUE-20 paint cost) with poor float
   precision far from the view. So it bakes only the on-screen slice, in view-local
   coordinates, and re-bakes as different parts scroll in. Genuinely valuable for the huge
   worst case; pure overhead (and the bug) for ordinary strokes.

**The "bake window" and BUG-02.** The window is the screen plus a margin of half a screen
(`_outlinePad() = 0.5*width/inScale`), so you can pan a little before a re-bake. The engine
only bakes centreline that falls in this window — but a *wide* stroke paints on screen from
centreline that's off screen (its width reaches back in). The margin is measured against the
screen, so as you zoom in it shrinks in drawing-units until it's narrower than the stroke's
half-width — then the stroke's own width sticks out past the margin and that band is dropped
= the cutout. **A plain browser stroke has none of this** (the browser re-rasterizes the
vector at every zoom, smoothly, no window), which is exactly why forcing browser-stroke
rendering fixes BUG-02 in the probe — the only reason we avoid browser strokes is the Skia
defect above.

**Performance considerations.** The fat path's costs: (a) the offset/tessellation per
re-bake (bounded by decimating to the current view's pixel budget); (b) `two.update()`
rebuilding the SVG DOM every render, and `_renderActive` re-creating *every* path with no
diffing (ISSUE-11) — so even a near-empty scene with one fat stroke re-outlines + full-DOM-
rebuilds each frame (BUG-01); (c) large fat-fill `d` paths are slow for the browser to paint
(ISSUE-20); (d) at the capped Clipper integer scale, very fat strokes quantize by whole
frame-units (ISSUE-16).

**Recommended fixes (ordered).**
- *BUG-02, minimal:* make `_outlinePad()` at least the largest on-screen fat-stroke
  half-width, so the window can never be outgrown by the stroke. Small, safe. **Verified in
  Chrome** to restore the coverage (0.08 → 0.57 at the reporter's state).
- *BUG-02, better:* only window a stroke when it's genuinely huge; bake normal-sized strokes
  whole (one polygon, no window), so this class of bug can't touch the common case.
- *BUG-01 / ISSUE-11:* incremental render — diff against the per-object opacity groups and
  reuse unchanged paths instead of tearing down the whole scene each frame.
- *ISSUE-16:* replace the Clipper integer offset with a float offsetter (analytic normals +
  arc joins), Clipper only for the union — removes the quantization and the SAFE_RANGE cap.
- *Longer term:* if a future browser/Skia renders extreme-width strokes correctly, much of
  this path could collapse back to plain browser strokes.

## E. Test coverage of these issues

**All five bugs' invariants are GREEN** in `src/engine/KnownBugs.fixed.test.js` (BUG-02
pad ≥ half-width; BUG-05 no monster strokes, coarse content arrives as bounded fills;
BUG-04 opacity continuity) and `src/engine/KobinEngine.test.js` (BUG-03 creation-order z
across levels; ISSUE-11 path reuse; camera-only pans touch no paths). The old red suite
(`KnownBugs.test.js`, asserting against the retired engine) was deleted with the fix.

The wider suite (2026-07-06):
- `geometry/derive.test.js` + `LevelMap.test.js` — golden-compared against the retired
  `KobinEngineV0` (kept ONLY as this oracle) + the new classify tiers.
- `Document.test.js` — undo/redo inversion, change events, spatial index, and dev-0
  **byte-compat over every real `.kobin-reports` snapshot**.
- `TileStore.test.js` — chain termination/boundedness, XOR-source invariant,
  bidirectional invalidation incl. the erase-ghost case, bake determinism, LRU, epochs.
- `KobinEngine.contract.test.js` — the exact quasi-private surface CanvasV2 reads.
- `fidelity.compare.test.js` — the new engine vs GROUND TRUTH (projected true bands) on
  all 13 report snapshots: ≥60% of true ink reproduced everywhere, no monster strokes.
- `perf.bench.test.js` — BUG-05-scene re-render 111 ms → 0.2 ms/frame; pans unregressed.

Still not auto-tested: ISSUE-12 (re-bake timing), ISSUE-18/19 (architectural), ISSUE-20
(paint — needs a real browser).

---

### How these were diagnosed
Each phone Report bundles the full drawing snapshot + camera + perf log + device info to
`.kobin-reports/`. Loading a snapshot on desktop (`engine.loadSnapshot`) at the report's
exact **window dimensions** reproduces the scene; rendering is analysed by rasterizing the
live SVG to an off-screen canvas in-page (the CDP screenshot path hangs on these scenes —
ISSUE-20) and scanning pixels, and by inspecting the render-list order and per-object
geometry directly. BUG-02 specifically needed the reporter's *exact* live state, camera, and
1504×812 window — desktop guesses at other sizes did not reproduce it (the fat path is
window-relative). Capture a Report **while the cutout is visible** to get that state.
