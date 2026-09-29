# A3 — the picture pyramid, the rest render, partial re-render, the queue and the budget, input coalescing, the Dev levers, the MovePlane port and the SVG renderer's demotion

2026-09-26. Analysis A3 of the renderer rebuild (PLAN §1.2, §1.4, §1.5, §1.6). Read-only: nothing under
`src/`, `public/`, `docs/`, `tools/` or `DESIGN.md` was edited. Experiments ran in the session scratchpad
(`scratchpad/a3/`, listed in the appendix) against unimported copies. Line numbers are this tree's
(branch `claude/hopeful-dirac-iotb9n`, commit `ee36fac`).

Conventions used throughout. **Z** is device pixels per frame unit, `inScale · dpr`. A **level** ℓ is an
integer with **Z(ℓ) = 2^(ℓ·S)**, S = `LEVEL_STEP` (octaves per level); **finer is larger**. A **cell**
(i, j) at level ℓ is the plate `[i·512, (i+1)·512)` in that level's device pixels. **σ** is the view's
stretch, `Z / Z(ℓv)`. **G** is the scene's generation (PLAN §1.1, A2's design). "R24"/"R25" are the
09-24 and 09-25 reviews, "PP" is `.claude/PAPER-PLAN.md`, "RP" is `.claude/RASTERISER-PLAN.md`.

---

## 0. Summary

**What the design is, in twelve lines.**

1. Plates are keyed `(frame, ℓ, i, j)` and carry a generation; a plate is exact iff `plate.G ≥ dirtySince(cell)`.
   Three key spaces share one store: level plates, **rest** plates (keyed by the exact Z), **plane** plates.
2. The view draws from level `ℓv = floor((log2 Z − log2 σmin)/S)` with a bounded stretch
   σ ∈ [σmin, σmin·2^S); σmin = 2^−½ by default (the same band as nearest-rounding at S = 1), raised on
   screens too big for it. PLAN §1.2's symmetric band costs 77 plates at S = 2 and 135 at S = 3 on
   Kobin's desktop (E3); the bounded band keeps 40 at every S.
3. The **compose is a plan per view cell**, freshness before resolution (Kobin's decision 2): fresh at ℓv →
   the same picture in another frame (a crossing) → fresh finer (within the image budget) → fresh coarser →
   the stale plate **with the fresh coarser plate drawn over its dirty rectangles only** → stale → paper.
   Base plates are opaque, so every pixel ends with exactly one source.
4. **Across frames the pictures are the same by integer arithmetic**: frame C's cell (i, j) at ℓ is its
   parent's cell `(i + ci·2^(8+ℓS), j + cj·2^(8+ℓS))` at **ℓ + 12/S** (not ℓ − 12/S: PLAN §1.2's sign is
   reversed under finer-is-larger), integral iff `S | 12` and `ℓS ≥ −8`. Checked to the bit against
   `LevelMap`'s affine on 3,036 plate corners (E2).
5. The **rest render** replaces sync and settle: at the first still animation frame the visible cells at
   the exact Z, **inline** when `0.73 µs·chords + 34 ns·box-pixels + 0.15 ms·cells ≤ 8 ms`, else in the
   workers after a short quiet; shown whole; kept through a pure pan (Z unchanged), dropped by a zoom.
6. **Partial re-render**: `renderPlate(job, p, out, counts, timings, clip)`. Restricting rows and blending
   only inside the clip, with x NOT folded at the clip's edge, reproduced the shipped core's plate **byte for
   byte in 960 of 960 clips** (E1); folding x at the clip edge differed in 129 bytes. The patch lands in the
   plate as a **new ImageBitmap** made by one scratch `OffscreenCanvas` (draw the old, `putImageData` the
   dirty rect, `transferToImageBitmap`): correct and 0.5 ms median in headless Chromium (E6).
7. **Pen-up**: the stroke stays out of the plates until its shape is baked, then its rectangle is re-rendered
   once and the SVG path is removed **in the same task the new plates are published** (a group commit):
   no double raster (D-3), no per-cell clipPath.
8. **One queue**: typed jobs, priorities rest 0 > view 1 > plane 2 > cuts 3 (one worker reserved while any
   are pending) > prefetch 4 > thumbnails 5; centre-out, dealt across strips; a per-frame pack budget while
   moving; jobs aimed at where the camera will be (the velocity rule); cancellation by purpose generation.
9. **Budget**: bytes = views × `viewPlates(σmin)` MiB — 3 views (120 MiB) desktop, 2 (70 MiB) phone, under a
   256 / 96 MiB ceiling; the drawn set and the plane are pinned, the view level, rest set and near coarser
   levels are protected; pinned ≤ one view + the plane by construction (H1 closed). *Corrected by the
   B-PYRAMID-1 review (PLAN §5.6 M2), built in B-PYRAMID-2 P0:* pinned ≤ own-grid records + 30 stand-ins + the
   plane cap, and the budget never goes under that sum (110 MiB desktop, 89 / 99 MiB on the two phones).
10. **Input** is coalesced in the engine: events move the camera at once, the render runs once per animation
    frame; the scale HUD gets its own subscription so the editor page stops re-rendering per wheel event (W1).
11. **MovePlane** keeps five layers, merging, coarsening, the quick level, the stopgap and the pre-aim at rest,
    keyed `(frame, planeZ, tag, i, j, G)`; SEL layers grow by one screen (D1); "never both" ends H4.
12. **`RasterRenderer` stops extending `Renderer`**: it composes `PicturePyramid` (canvas), `SvgLayer` (one
    Two.js scene: `LiveStrokeLayer`, the lasso, the debug overlays), `OverlayLayer` (ants) and the chevrons.

**Measured here, beyond the above:** the ~33-image cliff **is** visible in the container's headless
Chromium as JS time of the compose (0.1 → 26 ms at 34 scaled bitmaps; E6), contradicting
`tools/harnesses/browser-check.js:13-14`; so the harness can gate the image budget. A clipped render's cost
scales with the clip's rows on stroke bands (a 64² clip is 33 ms of a 404 ms band-heavy plate, node; E1c).

**Effort:** ≈ 23 agent-days for B-PYRAMID as scoped here (§10.4). **Questions:** 16, each with a
recommendation (§13); the ones that change PLAN text are Q1 (the sign), Q2 (the stretch band), Q3 (the
worker rest's quiet), Q4 (keep the rest set through a pan) and Q5 (the lookup order).

---

## 1. The pyramid data model

### 1.1 Keys and records

| key space | key | what it holds | exact iff |
|---|---|---|---|
| level plate | `F │ L<ℓ>s<S> │ i,j` | frame F's picture at Z(ℓ) = 2^(ℓS), cell (i, j) | `G ≥ dirtySince(F, ℓ, i, j)` |
| rest plate | `F │ R<Z> │ i,j` | frame F at the EXACT zoom Z (a double, printed exactly), cell (i, j) of the grid at Z | the same, and `Z === view.Z` for it to be drawn |
| plane plate | `F │ P<Zp> │ <tag> │ i,j` | one MovePlane layer at the plane's zoom Zp | the same, over the layer's cells |

A record is `{key, frame, kind, ℓ | Z, i, j, G, bitmap | null, bytes, lru, pinned}`; `bitmap: null` with
`bytes: 0` is an empty (paper) plate, as today (`RasterRenderer._takeResult`, `:1421-1423`). `S` is in the
level key so a lever change (§8) can never serve a plate of another step. There is **no epoch map**: the
store's `epochs`, `_bump`, `_pruneEpochs` (`PlateStore.js:143`, `:805-818`) and the five drop kinds go
with A2's generation model; what replaces them here is:

- `put(rec)` keeps `rec` iff `rec.G > stored.G` (monotone per key: PLAN §3 row 1). An older arrival is
  closed. A newer one that is still behind `dirtySince` is kept (it is newer than what it replaces) and
  counts as stale — F106 is this rule with nothing added (R25 §10.1).
- **Dirtiness is the scene's** (A2 §2.5, its `Stage`): the store registers every record it holds or has in
  flight — `stage.track(key, frameId, box)`, `untrack(key)` on eviction — and a commit sets
  `dirtySince = G` on every tracked key its footprints meet, in every frame (the mapping
  `dropRectPerFrame(foot)` does now, `PlateStore.js:524-554`). The store caches it on the record as
  `dirtyG`; `exact(r) = r.G ≥ r.dirtyG`. A record's box at level ℓ is `[i·2^(9−ℓS), (i+1)·2^(9−ℓS))` in
  F's units, grown by one device pixel as `rectOf` does (`PlateStore.js:112-119`).
- **The dirt log** (A2's, footprints with their G per frame) serves the two readers that need more than
  `dirtyG`: an arriving job packed at `G_job` (is any footprint with `G > G_job` over its cell?) and the
  patch rule (§1.4: *which rectangles* changed since this plate). It is pruned below the lowest G any
  tracked record of that frame carries.

**Why tracked keys and a log, not `dirtySince` per cell at every level.** PLAN §1.1 says a change "dirties
the plate cells over old box ∪ new box at every level of the frame". Eagerly that is unbounded: a 1,000-unit
box at Z = 2^9 covers 10^6 cells at one level. Only cells that hold a record (cached or in flight) need a
stamp, and a cell with nothing cached is exact for any job packed after the change by construction. A2
reached the same design independently (§2.5: "the grid is exactly the cells that have a plate or a job").

### 1.2 What replaces `plate.js`'s quantum maths

| `plate.js` today | replaced by (a new `raster/level.js`) |
|---|---|
| `QUANTA_PER_OCTAVE = 4` (`:14`), `zqOf(q) = 2^(q/4)` (`:44-46`) | `LEVEL_STEP` S ∈ {1, 2, 3} (cfg, §8); `zOf(ℓ) = 2^(ℓS)` (exact: a power of two) |
| `quantumFor(inScale, dpr, prev)` with `QUANTUM_HYSTERESIS = 0.75` (`:34-41`, `:16`) | `levelFor(Z, prev)`: `ℓ = floor((log2 Z − log2 σmin)/S)`; kept while σ stays inside the band grown by `LEVEL_HYST` = 1/8 octave |
| `PREVIEW_QUANTA = 8` (`:21`) | gone (no preview) |
| `plateRange(win, Zq)` (`:60-68`), `plateOriginPx` (`:49`) | kept unchanged — they are the plate grid, not the quantum |
| `plateKey(frameId, q, i, j)` (`:75`) | `levelKey(F, ℓ, S, i, j)`, `restKey(F, Z, i, j)`, `planeKey(F, Zp, tag, i, j)` |
| the `"e"` and `"s"` quanta (D83, D159) | gone: a rest plate's key carries its own Z, so D83's hazard (a key with no zoom of its own) cannot arise |
| `S_MIN` / layer canvas sizing (`PictureLayer.js:87`, `:1808-1827`) | `viewPlates(σ)` and the surface size at `σmin·2^−LEVEL_HYST` (§1.5) |
| (new) | `mapCell(A, ℓ, i, j, B)` — the integer cross-frame map (§1.6) |
| (new) | `coarser(F, ℓ, i, j, k)` — `(i ≫ kS, j ≫ kS)` at ℓ − k (floor division), stepping into the parent frame below `ℓS = −8` (§1.6) |

`bandFor`'s memo key (`rasterPack.js:564-597`) is `round(log2(Zq)·4)`, a quarter-octave bucket derived
from Z, not from a quantum index; it stays as it is (F77's rule, keyed on Z). `fadeQ` (`:691-701`) reads Z
and stays. So nothing in the packer changes for levels.

### 1.3 The view mapping at a level, and the stretch

The published view is FC2's object (RP §2.7; `PictureLayer.js:280-286`), one stable object with a
monotonic `rev`, so `OverlayLayer`, `rasterPerf.noteView` and `MovePlane` read it unchanged:

```
view = { rev, mode: "level" | "rest", frameId, level ℓv, S, Zq = Z(ℓv) (or Z at rest), Z, s = σ,
         ox, oy, dx, dy, dpr, cssW, cssH, k = Z, tx, ty, i0, i1, j0, j1 }
device px of frame point p:  X = (p·Zq − o)·σ + d,   o = (i0·512, j0·512),   d = round(P + o·σ)
```

One snap, one writer, as FC2/FC3 require; at rest `σ = 1` exactly and `Zq = Z`.

**The stretch band.** PLAN §1.2 says "stretched between 2^−(S/2) and 2^(S/2)", i.e. nearest-level rounding.
At S = 1 that is σ ∈ [0.707, 1.414]. At S > 1 the minified end multiplies the plates a view needs by
`σmin^−2`. Measured over 200,000 random camera states (E3, `plateRange` itself, hysteresis 1/8 octave):

| screen (device px) | S | band | max plates | mean | the surface that holds them 1:1 |
|---|---|---|---|---|---|
| Kobin's desktop 2256×1218 | 1 | nearest = bounded | **40** | 19.5 | 4096×2560, 41.9 MB |
| | 2 | nearest [0.5, 2) | 77 | 22.9 | 5632×3584, 80.7 MB |
| | 2 | **bounded [0.707, 2.83)** | **40** | 13.3 | 41.9 MB |
| | 3 | nearest [0.354, 2.83) | 135 | 28.6 | 7680×4608, 141.6 MB |
| | 3 | **bounded [0.707, 5.66)** | **40** | 10.3 | 41.9 MB |
| phone 1079×1969 | 1 / 2 / 3 bounded | | 35 | 15.7 / 11 / 8.7 | 2560×3584, 36.7 MB |
| 2560×1440 CSS at dpr 2 (5120×2880) | 1 | nearest | 170 | 78.7 | 8704×5120, 178 MB |
| today's quanta (layer at `S_MIN` 0.878) | — | — | 24 at s = 1 | — | desktop 29.4 MB, phone 25.2 MB, big 109 MB |

So I recommend **one rule for every S: `σ ∈ [σmin, σmin·2^S)`**, `ℓv = floor((log2 Z − log2 σmin)/S)`. At
S = 1 it is exactly the nearest rounding PLAN asks for; at S = 2 and 3 it trades plates for blur: the view
is magnified up to 2.83× and 5.66× mid-gesture (6.17× at the hysteresis edge), and the rest render makes the
resting picture exact either way. **σmin is per screen**: 2^−½ while `viewPlates(σmin·2^−h) ≤ VIEW_PLATES_MAX`
(48), else 1, else 2^½ — which keeps the 2560×1440@2 screen at 45 plates by drawing it at ~1.4 device px per
plate pixel while moving (still sharper than dpr 1). This is Q2.

### 1.4 The compose lookup per screen cell

The compose makes a **plan** — per view cell, an ordered list of draws — and then draws it. Base plates
(level and rest) are opaque (`fillPaper` with alpha 255, `rasterCore.js:604-612`), so a later opaque draw
over a pixel *replaces* it; only the plane's SEL and OVER layers are transparent, and they are z-ordered
overlays by design, drawn after the base.

```js
// ℓ: the view level; S: LEVEL_STEP; N: coarser levels searched (default ceil(8/S)); F: the view's frame.
// exact(r) = r.G >= r.dirtyG. `budget` counts distinct images this compose (§1.5).
function planCell(F, ℓ, i, j, budget) {
    const own = store.get(levelKey(F, ℓ, S, i, j));
    if (own && exact(own)) return [draw(own)];                                // (a) fresh here
    for (const H of store.framesWithLevels(F)) {                              // (b) the same picture elsewhere
        const m = mapCell(F, ℓ, i, j, H);                                     //     integer, or null (§1.6)
        const r = m && store.get(levelKey(H, m.ℓ, S, m.i, m.j));
        if (r && exact(r)) return [draw(r)];
    }
    const kids = childrenOf(F, ℓ + 1, i, j);                                  // (c) fresh finer: all 2^S×2^S,
    if (kids.every((k) => k && exact(k)) && budget.take(kids.length))         //     only inside the budget
        return kids.map((k) => drawScaled(k, 2 ** -S));
    for (let k = 1; k <= N; k++) {                                            // (d) fresh coarser, own frame
        const c = coarser(F, ℓ, i, j, k);                                     //     then parent's (§1.6)
        const r = c && store.get(c.key);
        if (r && exact(r) && budget.take(1)) {
            if (own) {                                                        // (e) the patch rule:
                const D = dirtyRectsSince(F, own.G, cellBox(ℓ, i, j));        //     the stale plate where
                if (D.area <= cellArea * PATCH_MAX)                           //     nothing changed, the fresh
                    return [draw(own), drawScaled(r, 2 ** (k * S), clipTo(bbox(D)))]; // coarser one over the change
            }
            return [drawScaled(r, 2 ** (k * S), subCell(c, i, j))];
        }
    }
    if (own) return [draw(own, { stale: true })];                             // (f) older: nothing fresh anywhere
    for (let k = 1; k <= N; k++) { const c = coarser(F, ℓ, i, j, k); const r = c && store.get(c.key);
        if (r) return [drawScaled(r, 2 ** (k * S), subCell(c, i, j), { stale: true })]; }
    return [PAPER];                                                           // (g)
}
```

**Before the per-cell loop**, the rest set: when the camera rests on the rest set's own Z and frame, every
cell whose rest plate is exact is drawn from it (σ = 1, a 1:1 blit); a rest cell that a change made stale
runs the same plan with the rest plate as `own` (so the patch rule covers it too).

**Why this order.** PLAN §1.2 lists "else its stale one" second. Kobin's decision 2 is *blurrier now, never
older*, and R25 §11.13 already noted that "fresh at L, stale at L, coarser…" prefers resolution over
freshness. The order above is freshness first, then resolution — with one refinement that makes decision
2's second clause precise: **step (e) keeps the sharp stale plate everywhere nothing changed and puts the
fresh coarser picture only over the rectangles that did** (the dirty log gives them). A pixel outside
those rectangles is not older (the rectangles bound every change since `own.G`), a pixel inside is
blurrier and current. `PATCH_MAX` (½ of the cell) switches to the whole coarser cell when the change is most
of it. This is Q5.

**Every pixel from exactly one source, argued.** A plan is a base draw followed by opaque patches:
(a)–(d), (f), (g) are one opaque source for the whole cell; (e) is an opaque source and an opaque patch that
replaces a sub-rectangle of it. Cells tile the screen and are drawn disjointly (1:1 at `(i·512 − o)·σ + d`,
or through the surface). No base source is ever drawn *under* another with alpha, so a translucent family
can never blend twice — the failure R25 §6.5 warns today's greedy cover avoids only because plates are
opaque. The test (§10.2) paints each source a flat colour and asserts every pixel carries exactly its
planned source's colour, and repeats it with a translucent family split across two levels.

*Corrected when B-PYRAMID-1 built it (2026-09-28), each forced by a red test:* (1) step (c) is planned as an
upgrade — every cell is planned without children first, then the cells not already sharp take their 2^S × 2^S
exact children — paper cells first, then older, then blurred (the review, 2026-09-28), each nearest the attention point first — while the budget has room; in cell order the children took the
whole budget and later cells fell to paper while a coarser plate that would have served them was cached. (2) Rest
mode: the rest grid at an arbitrary Z never aligns with a level grid, so the compose draws the level plan under the
rest cells that have no rest plate, then every rest cell that has one over it — exact 1:1; stale, the patch rule
(e) or a fresh level cover of the cell, else the stale plate. Every pixel still ends with one source. (3) The plan
took at most one view of distinct records; the B-PYRAMID-1 review showed that cap (and counting own plates against
the stand-ins) put paper or an older picture on screen while a fresh source was cached (PLAN §5.6 M1, M2). Since
B-PYRAMID-2 P0 the plan draws every own-grid record and at most `COMPOSE_IMAGES` − the plane's images stand-ins, which
is the construction behind §4.5's corrected pinned bound. (4) *B-PYRAMID-2 P0:* planned in cell order, a binding
budget spent its room on the first cells' finer stand-ins and left later cells paper beside a cached coarser plate
(jsdom, 300 seeded screens each: in level mode under a drag plane of 0–25 images, 8 / 13 / 17 runs on Kobin's desktop /
2560×1440@2 / 390×844@3, up to 17 cells; at rest after a long pan, 1 / 13 / 6 runs, up to 10 cells, 21 % of the
screen). So when the plan refuses a stand-in, every cell not drawn sharp from its own grid first reserves its coarsest
exact source and the cells are planned again nearest the attention point first: 1 / 1 / 1 runs of one cell (the
coarsest set itself over the cap) and 0 at rest. When nothing is refused the plan is the rules' choice, unchanged.

### 1.5 Direct scaled draws versus the surface, against the image cliff

Chrome's 2D canvas pays per frame once one frame holds more than ~33 distinct images with any scaled (PP
§10.14: 33 scaled 1.7 ms, 34 scaled 264 ms, 60 at 1:1 7.5 ms, 4 scaled + 32 at 1:1 37 ms, in Kobin's tab).
**The same step shows in the container's headless Chromium** (E6, SwiftShader): the JS time of the draw calls
of one compose is 0.1 ms up to 33 distinct 512² bitmaps and 26.3 ms at 34 scaled (6.3 ms at 34 unscaled),
flat to 64, then 52 ms at 80 — a flush per 33 images. `browser-check.js:13-14` says headless cannot see
it; it can, as script time, so the harness can gate on it (§9).

Two paths, one plan:

- **Direct** (R25 memory lever 5): when the plan's distinct images (base + patches + plane) are ≤
  `COMPOSE_IMAGES` (30, `PictureLayer.js:122`, kept), each is drawn straight onto the ink canvas with the
  view's affine. No surface, no per-frame blit (F79 measured that blit at ~30 ms smoothed, 6.5 unsmoothed).
- **Surface**: otherwise the plan is drawn once into the view surface (the layer canvas's successor, alpha,
  at the view level's grid, 1:1 for own plates) whenever the plan changes, and blitted once per frame scaled
  by σ. Its recompose draws the plan's images; the recompose is where the cliff would be paid, so a
  recompose also keeps its **scaled** images (stand-ins) ≤ 30 − the plane's images and moves any excess cells to
  coarser sources (fewer images each). Own plates 1:1 into the surface are the mild case (6 ms per 33 in E6), so
  they are counted apart (corrected from "30 − own plates" by PLAN §5.6 M1).

At rest the rest set is drawn 1:1; above 30 cells (the 2560×1440@2 screen's 84) it too goes through the
surface at σ = 1. The children rule (c) is what makes the budget bite: `2^S × 2^S` images a cell, so fresh
finer plates are used for a small region (the centre after a zoom-out step) and coarser ones elsewhere.

Memory: the surface is allocated on first need and freed after 10 s unused (today it lives until a release,
`PictureLayer.js:1808-1833`); 41.9 MB desktop / 36.7 MB phone at σmin·2^−h (E3), against 29.4 / 25.2 MB
today. R12's alternative — the surface as a DOM canvas scaled by a CSS transform, so the compositor does the
per-frame scaling with no main-thread blit — is the measured experiment for Kobin's Chrome (headless has no
compositor cost to compare, §9.4).

*Built (2026-09-28), corrected in B-PYRAMID-2 P0:* B-PYRAMID-1 took the rule literally ("≤ 30 − own"), so a plan
with 30 own plates or more drew no stand-in and showed paper beside a cached coarser plate (the review's four
constructed screens, now in `PicturePyramid.plan.test.js`). The cap is now `COMPOSE_IMAGES` − the plane's images for
scaled images only. At rest the level plan under the cells the rest set lacks is drawn scaled onto the rest grid,
so its plates count as stand-ins — except when Z is the level's own zoom, where they are 1:1 and own.

### 1.6 The cross-frame mapping

**Derivation.** `frameLattice.js`: `R = ENTER/BASE = 4096 = 2^12` (`:45`), `W = 2^17` (`:46`),
`G = W/R = 32 = 2^5` (`:47`); a child cell (ci, cj) is centred on `(ci·G, cj·G)` in the parent's units
(`cellCentre`, `:65`), and `LevelMap.mapPointF` maps a child point `c` to the parent as `c/R + (ci·G, cj·G)`
(`LevelMap.js:897-903`; `frameFactor` is `base/e.s = 1/R` per step up, `:888-896`). The camera confirms
the scale: `_crossUp` sets `inScale · base / s = inScale / R` (`Camera.js:160`). So a child view at Z is
the parent view at `R·Z`:

- same picture ⇔ `Z_P = R·Z_C` ⇔ `2^(ℓP·S) = 2^(12 + ℓC·S)` ⇔ **ℓP = ℓC + 12/S**, an integer iff **S | 12**;
- the parent's device pixel of a child point is `c·Z_C + ci·G·R·Z_C = c·Z_C + ci·2^(17 + ℓC·S)`, so the
  plate offset is **ci·2^(8 + ℓC·S)** plates, an integer iff **ℓC·S ≥ −8**, and then plate-local pixels
  are identical: `(i', j') = (i + ci·2^(8+ℓC S), j + cj·2^(8+ℓC S))`.
- going down (parent level ℓP into child (ci, cj)): `ℓC = ℓP − 12/S`, offset `−ci·2^(ℓP·S − 4)`;
- a lateral neighbour (`Camera._maybeShift` moves the camera by whole cells, `:93-98`) is the up step and the
  down step composed through the common parent: `x_F' = x_F − di·W`, offset `−di·2^(8+ℓS)`.

**Which `LEVEL_STEP` values keep it integral** (the level shift, and the coarsest level whose offset is
integral, `ℓS ≥ −8`):

| S | 12/S integral | coarsest integral level | its Z |
|---|---|---|---|
| **1** | yes (12) | −8 | 2^−8 |
| **2** | yes (6) | −4 | 2^−8 |
| **3** | yes (4) | −2 | 2^−6 (−9 is past −8) |
| 4 | yes (3) | −2 | 2^−8 |
| 5 | **no** | — | — |
| 6 | yes (2) | −1 | 2^−6 |

Kobin's lever values 1, 2 and 3 all work. **The sign**: with levels numbered finer = larger — the
convention in which "the parent cell's plate at L−1" is coarser (R25 §4.1, PLAN §1.2) — the parent frame's
same picture is **ℓ + 12/S**. PLAN §1.2 and R25 §4.1 write "L − 12"; that would be right only if levels
counted octaves *out*. Q1 asks to fix the text.

**What this gives the pyramid.** A frame's own levels are those with `ℓS ≥ −8`; anything coarser of its
region *is* its parent's level `ℓ + 12/S` (integral at every such level, since the parent's `ℓS ≥ 4`). So a
coarser lookup that walks below −8 steps into the parent frame with integer indices, and after a crossing in
either direction the frame just left serves the new view's cells exactly (`framesWithLevels` in §1.4): at a
zoom-out crossing from C (inScale ≈ 1/32, ℓC ≈ −4.4 at dpr 1.5) into P (inScale ≈ 128), C's level −4/−5
plates are P's 8/7 — the view level. No affine, no `_mapFrame` memo, no `addrEpoch` key
(`PictureLayer.js:1253-1265`): `mapCell` reads the frame path (`LevelMap.framePath`, `:862-873`), which the
lattice already caches and clears on every re-address.

**Checked (E2).** 370 frames minted by `cellChild` with random digits (10 % at each extreme of
[−2048, 2047]), 80 lateral neighbours; random pairs, S ∈ {1, 2, 3}, levels with Z in [2^−9, 2^11]; for each,
plate corners mapped by `lm.mapPointF` and scaled into B's grid, compared with `===` to the integer map
(BigInt). Paths of ≤ 3 frame steps (parent/child, grandparent, siblings, neighbours through one parent):
**3,036 corners, 0 mismatches, 0 straddles**. At 4 steps (cousins through a grandparent, plate indices
~2^43) the *float affine* rounds (4 of 6,884 corners off by one plate); the integer map is the right one, and
a property test must stay in the float-exact range or compare against BigInt.

**The property test (PLAN §3 row 6), concretely** — `src/engine/raster/level.crossmap.test.js`:
1. Mint a random lattice (as E2) with a seeded generator; include `readdress` of a subtree mid-test.
2. For random pairs (A, B) with `framePath` length ≤ 3, random S ∈ {1, 2, 3}, random ℓA with `ℓA·S ≥ −8`
   and `Z(ℓA) ≤ 2^12`, random (i, j) with `|i|, |j| ≤ 2^20`: `m = mapCell(A, ℓA, i, j, B)`;
3. assert `m.ℓ === ℓA + 12·(depthA − depthB)/S`;
4. assert the plate's box mapped through `lm.mapRectF` (two `mapPointF` corners — the pair
   `{frameFactor, mapPointF([0,0])}` that `PictureLayer._mapFrame` memoises, `:1253-1265`, while it exists)
   lands exactly on `(m.i, m.j)`–`(m.i + 1, m.j + 1)` in B's grid at `Z(m.ℓ)` (`===`, no epsilon);
5. assert `mapCell(B, m.ℓ, m.i, m.j, A)` returns (i, j) (round trip);
6. assert `mapCell` returns null when `S ∤ 12` (S = 5) or `ℓA·S < −8`, and that the affine's offset is then
   non-integral for some cell of that level;
7. after `readdress`, the map follows the new address (the frame path cache is cleared, `LevelMap.js:316`).

---

## 2. The rest render

### 2.1 Trigger

In the engine's frame (§5), the camera state `(frame, inScale, inPanX, inPanY)` equal to the previous
frame's and no input pending is **still**. On the first still frame:

- the **inline** executor runs in that same frame when the estimate fits (§2.2): the view is exact before the
  browser paints;
- otherwise the **worker** rest set is posted after `REST_QUIET_MS` (100 ms) more of stillness. PLAN says
  "still one animation frame"; for the worker path that is the settle's churn over again — a halting zoom
  whose wheel ticks are 50–120 ms apart (PP §10.14 measured 120–250 ms tick gaps) would post a screenful at
  top priority per pause, and a dispatched job cannot be recalled (`rasterWorkerClient.js:44-45`). Today's
  settle waits 150 ms (`SETTLE_MS`, `PictureLayer.js:129`) for this reason. This is Q3.

*Built (2026-09-28):* the still frame renders only the rest cells that have no plate; a stale rest plate is the
partial re-render's (§3), which the rest trigger otherwise pre-empted with a whole re-render (a red test). The
engine asks for one more frame after the camera stops: stillness is seen only on a frame.

### 2.2 The estimate, derived

What the numbers say (all from the records, then this container):

| fact | source |
|---|---|
| 5,000 chords ≈ 4 ms of edge setup, from a fitted **729 ns an edge** | RP §6.5; `SYNC_CHORD_BUDGET` comment, `PictureLayer.js:131-140` |
| a sync frame's core over **8 ms** leaves the path (`SYNC_MAX_MS`) | D272, `PictureLayer.js:141-148` |
| a covered plate costs **~9 ms** of `ras.accum` whatever its chords (17 plates 130–187 ms in Chrome): **~34 ns a resolved pixel** | D272 |
| an empty screen of 18 plates is 1.8–4.2 ms: **0.10–0.23 ms a plate** of fill + ImageData + blit | D272 |
| a 1440p dpr-2 screen is ~77 plates, so even empty it is 8–18 ms: sync is "a phone and laptop feature" | R25 §9.4 |
| node, this container (E1c): fast-path edges 0.16–0.21 µs, resolve 10–17 ns a covered pixel | E1c `fills200`, `fills2000`, `bigFills20` |

So the estimate over the cells to render inline is

```
T = 0.73 µs · E  +  34 ns · A  +  0.15 ms · P        inline iff T ≤ INLINE_MS = 8
E = visibleChords over the cells at the exact Z (rasterPack.js:516-535, band height already priced, F130)
A = Σ item box area in device px, clipped to the cells (an upper bound of the resolve's per-row spans)
P = cells with at least one item (an empty cell is paper: no raster, no upload)
```

Worked: a light desktop drawing (10 strokes, 50,000 px of box area, 2,000 chords, 6 non-empty cells) is
1.5 + 1.7 + 0.9 = **4.1 ms: inline**. 5,000 chords with 4 plates 30 % covered is 3.7 + 10.7 + 0.6 = 15 ms:
workers. A 1440p dpr-2 screen with ink in 60 of its 84 cells is ≥ 9 ms of `P` alone: always workers, which
is R25 §9.4's point made by the formula instead of by a special case. The constants are the Chrome-derived
ones (conservative: node is 3–4× faster); B-PYRAMID calibrates them online from what `rasterPerf` already
records per job (`ras.edges`/edges, `ras.accum`/coveredPx, `rasterWorker.js:103-108`), EWMA per session, so a
phone gets its own. D272's measured exit stays as the backstop: an inline rest that measured over 8 ms marks
the view class heavy until the estimate halves (`_syncSwitch`'s hysteresis, `PictureLayer.js:703-717`).

*Built (2026-09-28):* the calibration is a hook the renderer feeds — `calibrate(sample)`, with `sampleOf(res, U)`
for a worker result and `onSample` for an inline job — not applied by the inline executor to itself: a cold JIT's
first inline timings flipped the next rest to the workers in a test. K_u is fitted against the union family-rows
the estimate priced the job with, since a result counts none of its own.

### 2.3 The executor

**Inline**: `renderPlate` on the main thread into the one RGBA scratch (`_syncScratch`,
`RasterRenderer.js:1214-1225`, kept), then per cell `OffscreenCanvas.putImageData` + `transferToImageBitmap`
(synchronous; E6: 0.5 ms median in software GL) into a **rest plate** — a record like any other, so the
compose, the store, the partial re-render and the budget treat it uniformly. No layer canvas, no `"s"`.
The alternative the brief names — `putImageData` of each rendered cell straight into the ink canvas, as
`_renderSync` does into the layer canvas today (`:1166-1178`) — saves the upload into a bitmap but keeps
nothing: the next compose (an arrival, an overlay change) repaints the canvas from plates and loses it, a pan
cannot reuse it, a patch has nothing to land in, and the inline and worker paths produce different kinds of
picture. That is what made sync a mode; a rest plate makes it an executor.
**Workers**: the rest cells posted at priority 0 as one group (§3.6's group commit), shown when all have
arrived. Either way the rest set is `{frame, Z, cells, complete}`.

**A pure pan keeps it.** Rest plates are keyed by the exact Z and anchored at the frame's own grid, so after
a pan (Z unchanged bit for bit; `Camera.panBy` touches only the pan, `Camera.js:59`) they are still exact at
σ = 1. The compose draws them where they are and the level plan for the newly exposed strip; the next still
frame renders the missing rest cells (inline: a few cells). PLAN says "discarded by any move"; keeping them
through a pan removes a screenful of re-raster per pan stop. A lateral frame shift (`_maybeShift`) discards
them: `W·Z/512` is not an integer at an arbitrary Z. This is Q4.

### 2.4 Discard

A zoom (Z changed), a frame change, a resize or a dpr change: the rest set's records are removed at once (not
staled — they are wrong at any other Z, and removing is what closes their bitmaps), its queued jobs are
dropped by purpose generation (§4.4), and anything in flight is discarded on arrival (key mismatch). The
view falls to the level plan in the same frame, so a discard never shows paper.

### 2.5 What it replaces

| mechanism | where |
|---|---|
| the sync path: `_syncSwitch`, `_sync`, `_syncMs`, `_syncSlowAt`, `noteSyncCost`, `syncSurface`, `SYNC_CHORD_BUDGET`, `SYNC_MAX_MS` | `PictureLayer.js:703-720`, `:489-493`, `:140`, `:148`, `:263-266` |
| `_renderSync`, `CHORD_CAP`, the `"s"` quantum and `syncRefused` | `RasterRenderer.js:1142-1189`, `:85`; `PictureLayer.js:1443-1448` |
| the settle: `_req`, `SETTLE_MS`, `_settleNow`, `_askSettle`, `_settleArrived`, `_publishSettle`, `_maybeArm`, `_onMove`'s `"e"` drop, `settleRequest()`, `settleComing()`, `_eLive`, `_settleDone`, `_settlePending` | `PictureLayer.js:292`, `:129`, `:1565-1608`, `:663-669`, `:686-700`, `:443`, `:1109`, `:348-350` |
| `dropQuantum("e")` as a correctness rule (D83), `unpinAdded` and the `"add"` pin set (`_held`, D178, D184, H2) | `PlateStore.js:565-582`, `:284`, `:152`, `:260-265` |
| the `"e"` plane keys and `_dropDead`'s settle branch | `MovePlane.js:208`; `RasterRenderer.js:1089-1093` |
| `_stillWanted`'s `q === "e" && settlePending` liveness | `RasterRenderer.js:1363-1364` |

Kept: `visibleChords` (the estimate's E), `_syncScratch` and `_addCorePhases` (inline timing into
`rasterPerf`'s sync slots, `rasOnMain`, `rasterPerf.js:149`).

---

## 3. Partial re-render

### 3.1 A clip box in `renderPlate`

`renderPlate(job, p, out, counts, timings, clip)`, `clip = [x0, y0, x1, y1]` in plate-local pixels,
half-open, default the whole plate. The rules, each measured in E1 (a scratch copy of `rasterCore.js` built
by `scratchpad/a3/core/make-clip-core.py`, compared with the shipped core as the oracle):

1. **Paper** is filled over the clip only (`fillPaper`, `rasterCore.js:604-612`, over the whole plate today),
   and a transparent plate is un-premultiplied over the clip only (`:618-625`). Pixels outside the clip are
   never written: **0 bytes outside the clip touched in 1,248 clips**.
2. **Rows are restricted, x is not.** `addEdge` walks its edge from the same start as a whole-plate render
   (so the `x += dxdy·dy` accumulation is identical, `:230-239`) and deposits only in rows [y0, y1); the
   x-clamp stays at 0 and TW (`addStep`, `:184-204`). The resolve sums the row from its first touched
   column (`ROWMIN`) through the clip's left edge without writing, then blends only inside [x0, x1)
   (`resolveFamily`, `:259-326`); `resolveMask` the same (`:409-431`).
3. **The prune** keeps the plate's own item test (`:1141-1148`) and skips a *family* whose box misses the
   clip grown by 2 px (the deposit spills one column right, `depositRun :171`).
4. **The occlusion cull decides over the clip**: `coverCandidate` tests the clip rectangle and `fillsPlate`
   scans only the clip (`:368-399`). This is the one place a clipped render may differ from a whole one —
   by the cull's own `COVER_MIN` residue (< 0.07 of a byte), which it already has at the plate's scale.
5. **Arc prune** by the clip's rows (`emitArc`, `:799-812`): a pruned sub-arc deposits nowhere the clip reads.
6. **Family rows** are the family's rows ∩ the clip's (`:1207-1208`), including the covered family's.
7. **The buffers are unchanged**: `ACC` stays one plate wide (`ACC_STRIDE`, `:57-60`) because the running
   sum starts at `ROWMIN`, which can be left of the clip; `beginFamily`/`clearFamily` bound the rows to the
   clip's and clear the columns the deposit touched (`:248-251`, `:434-441`), so the bounded clear still
   costs the ink; a mask plane is still a whole plate (`MASKS`, filled on first use, `:409-412`) and is
   written and read only inside the clip.

**Result: byte-identical to the whole plate inside the clip in 960 of 960 clips** (40 plates × 6 clips × 4
configurations: opaque, a plate-covering backdrop with the cull on and off, transparent paper; 150 items of
fills, arc circles, stroke bands, families of pieces and pending marks), and in 288 of 288 on a second seed.
**The rejected variant** — the clip as a sub-plate, x clamped at the clip's edges — differed in 129 bytes
(max 1, 2 on transparent plates through the un-premultiply) over the same 960, because deposits left of the
clip then sum in float32 at one column instead of in the float64 running sum. It is ~20 % faster (20.2 against
26.0 ms a clip in the large run); the bit-exact one is what PLAN §3 row 8 can assert.

**What it costs** (E1c, node; medians of 7): a whole plate / a 16² / 64² / 128² / 256² clip at its centre —
`fills200` 6.2 / 0.35 / 0.42 / 0.84 / 1.8 ms; `fills2000` 11.5 / 1.1 / 1.4 / 1.1 / 2.9 ms; `bigFills20`
27.1 / 0.03 / 0.13 / 0.36 / 2.6 ms; `backdrops40` (the cull) 5.2 / 0.12 / 0.26 / 0.60 / 1.8 ms; but
`strokes60` (60 unbaked stroke bands, all union pass) 404 / 14.6 / 33 / 77 / 191 ms, and `light` (two bands)
14.2 / 2.7 / 10.3 / 8.3 / 9.9 ms: the union pass loads a family's whole band per row band and walks 16
sub-scanlines a row, so its cost follows the clip's **rows**, not its area. The inline estimate (§3.3) has to
price union items by rows.

**Wire**: `job.clips` (`Int32Array`, 4 per plate, absent = whole plates) in `rasterJob.js`'s job arrays
(`JOB_ARRAYS`, `:56`), read by `rasterWorker.runJob` (`:104`); the result's bitmap is the clip's rectangle
alone (`createImageBitmap(imageData, x0, y0, w, h)`), so a patch transfers `w·h·4` bytes, not 1 MiB.
`npm run build:worker` after it.

*Corrected by the review of B-FOUNDATION (2026-09-28):* the 960 of 960 above does not hold for union families.
Stroke bands crossing a clip's top row differed inside the clip in 30 of 799 clips (79 bytes; one level on opaque
paper, up to four on transparent paper after the un-premultiply), 4 of 120 through band splits and 1 of 960 on
this section's own mixed lists. Two causes: the clip's top row reverses the load order of union edges that start
above it, so two tied crossings (collinear edges of abutting rings, opposite directions) sort the other way and
`emitRuns` ends and restarts a run at that x, a −w then +w into one float32 cell that does not cancel exactly;
and the union edge stored x at its band's top, so a crossing's float depended on where the band began (25.6 % of
crossings moved by an ulp). The fix, in `rasterCore.js`: every crossing at one x is applied before the winding is
read, and each union edge keeps its own start (`x = x0 + (ys − y0)·dxdy`). With both, 0 of 799, 0 of 120 and 0 of
960; it moved 21 bytes of 10 of the suite's 24 golden whole plates by one level. The test is
`rasterCore.clip.test.js` (four seeds) and `rasterCore.clip.slow.test.js` (60 seeds).

### 3.2 Landing the patch in an immutable plate

| option | how | memory | cost per patch | verdict |
|---|---|---|---|---|
| canvas-backed plates | every plate an `OffscreenCanvas`; `putImageData(img, 0, 0, x0, y0, w, h)` into it | same 1 MiB each, as canvases | one sub-rect upload | **no**: 100–200 GPU canvases; Chrome may demote some to software, and a software canvas drawn into an accelerated one uploads on every compose — the texture-burst hazard of R25 §13.4 every frame |
| pixel buffer kept per plate | `Uint8ClampedArray` beside the bitmap; patch the buffer, `createImageBitmap` again | **+1 MiB per plate** (the cache doubles) | a 1 MiB copy + async bitmap (a frame late) | no |
| **GPU merge through one scratch** | `oc.drawImage(old, 0, 0)`; `oc.putImageData(patch, 0, 0, x0, y0, w, h)` (or `drawImage(patchBitmap, x0, y0)` for a worker's patch); `rec.bitmap = oc.transferToImageBitmap()`; close the old | **+1 MiB total** (the scratch) | one plate copy on the GPU + the patch's upload; synchronous | **yes** |

E6 ran the recommended path in the container's Chromium 141: 20 merges of a 128×96 patch into a plate,
**0.5 ms median, 6.3 ms max** (software GL; a GPU copy is cheaper), and the merged bitmap held the patch
inside the rectangle and the old pixels outside it. The record keeps its key, gets the new bitmap and
`G = G_patch`; `transferToImageBitmap` is synchronous, so an inline patch shows in the frame it was made.
Where `OffscreenCanvas` is missing (Safari before 16.4) the scratch is a `<canvas>` and the bitmap comes from
`createImageBitmap(canvas)`, a frame late. jsdom has neither: the store keeps raw pixels there (as it does
now, `PlateStore.js:433`) and the merge is a typed-array sub-rect copy — which is also how the property test
checks it.

**When a patch makes the plate exact.** A plate at `G_old` patched over rectangle `C` at `G_new` is exact at
`G_new` iff `C ⊇ ⋃{dirty rects of this frame with G_old < G ≤ G_new} ∩ plate`, grown by one pixel. The
dirty log gives that union; the patch's clip is its bounding box. Then the pixels outside C are the old
render's and nothing changed there — provided a dirty rect is conservative, which puts one requirement on
A2 (§3.7).

### 3.3 The inline-when-small threshold

The same form as §2.2, over the clip rectangles instead of whole cells, with union items priced by rows:

```
T_patch = 0.73 µs · E_clip + 34 ns · A_clip + K_u · Σ_union-families (their rows inside the clip) + 0.3 ms · plates
inline iff T_patch ≤ PATCH_INLINE_MS (6 ms, leaving the frame its compose)
```

`K_u` is seeded at ~73 µs a union family-row (E1c's `strokes60`: 404 ms over 5,555 family-rows touched, node)
and fitted online from the pool's own `ras.union` timings and row counts, as §2.2's constants are; 0.3 ms a
plate is the merge. An undo of one ordinary stroke is well
under it (§3.5); a 1,000-object delete is not, and takes §3.4.

### 3.4 Coarse-first for large dirty regions

When `T_patch` is over budget for the drawn cells a change touches:

1. **Which cells**: the drawn set's cells (rest cells at rest, else the view level's) that meet a dirty
   rectangle since their plate's G — no others.
2. **Which level**: the finest `ℓc = ℓv − k`, k = 1 … N, whose inline estimate over those cells' dirty
   rectangles fits `PATCH_INLINE_MS`. Each level quarters the area term (`A`) and the rows of a union
   term; edges (`E`) fall only for arcs. If none fits, no inline work: the workers take everything and the
   plan's step (f) shows the stale plates (counted as `olderMs`, §9.1 — the one case "older" can show, and
   the number that says how often).
3. **How it composes**: the coarse cells are patched (or rendered, if absent) inline at `G_now`; the plan's
   step (e) then draws, per changed cell, the sharp stale plate with the fresh coarse picture over its
   dirty rectangles only. Unchanged cells stay sharp; changed pixels are current and blurry.
4. **Then** the changed cells' full-resolution patches go to the workers at priority 0 (they are visible
   correctness) and replace the coarse patch as they land.

*Built (2026-09-28):* the fresh coarser picture is drawn over the dirty rectangles' box grown by a pixel (of the
screen or the plate, the larger) — §3.2's rule for a clip applied to the draw; without it 12 changed pixels at a
.5 edge kept their pre-undo value. The live path's group commit (§3.6) takes no coarse-first step: it waits for
full resolution.

### 3.5 Worked example: undo of one stroke (Kobin's decision 2)

Stroke s (id 812, 300 px long, 13 px pen) sits over a dense area; the view rests with the rest set complete
at Z = 3.37 (G0 = 900).

1. Ctrl+Z → `Document.undo` removes s → the Stage (A2) removes its items, G = 901, and maps s's footprint
   (bbox ⊕ lw/2, A2 §2.5) into every frame with tracked keys: the two rest cells it meets get
   `dirtySince = 901`. (The undo's render is the engine's next frame, §5.)
2. The frame's plan finds both cells stale. `T_patch` over the two clips (≈ 320×40 and 60×40 px): E ≈ 3,000
   chords of the ink under the rectangle, A ≈ 90,000 px, no union items → 2.2 + 3.1 + 0.6 = 5.9 ms ≤ 6: inline.
3. `packJob` over the scene's items at G = 901 meeting the clips (s is gone), `renderPlate(…, clip)` per cell,
   the GPU merge into each rest plate, `G = 901`. Same frame: the compose draws the two patched rest plates;
   **the stroke is gone at full resolution in the frame after the key press**, nothing else re-rendered.
4. The view level ℓv's plates and the coarser levels under the box keep `dirtyG = 901` and stay cached: they
   are stand-ins, re-rendered only when the plan wants them (a zoom starts) or evicted.
5. Redo is the same with the item back (G = 902).

Had s been a 1,500-px scribble over 30 cells, step 2 would fail the budget; step §3.4 picks ℓv − 2 (a
sixteenth of the area), patches the 3 coarse cells inline, the plan draws each of the 30 stale rest plates
with the coarse picture over s's rectangles only, and the 30 full-resolution patches land from the workers.
**Never older, and blurry only where s was.**

### 3.6 Pen-up: the resolved shape into its rectangle

Today a pen-up rasters twice: the render at pen-up packs the unresolved band (`KobinEngine.js:1575-1597`),
the shape bake mutates the native (`erasePipeline._stepShapeBakes` → `Document.bakeShapeById`,
`erasePipeline.js:274-308`, `Document.js:1144`) and the plates re-raster (D-3, open, two tries reverted: the
band kept on the plates is not the shape's picture, R24's 08-13-01 report). The live path is held until the
cells under it are fresh (`RasterRenderer.endLive`, `:769-787`), and a translucent one is clipped per cell
by an SVG `clipPath` meanwhile (`_clipHeld`, `:864-891`, D-2, F123), with a 15 s extension rule
(`_liveCellsComing`, `:897-910`).

The rule that ends both (R24's own condition for a safe D-3):

1. **At pen-up the new item is `pending` in the scene**: packs skip it, it is hit-testable, it dirties
   nothing. The SVG path stays up (`LiveStrokeLayer.hold`, §7.2). A2's table keeps the stroke `live` (skipped)
   only until `finalize` and makes it packable there (§2.8); this rule moves that to the shape bake (Q7).
2. **When its shape bake lands** (`bakeShapeById`), the item becomes packable at `G_s` and dirties its box.
3. **One partial re-render** of the drawn cells under the box — inline when `T_patch` fits (light drawings:
   the swap happens in that frame), else a worker job group.
4. **Group commit**: the results for those cells are held aside (not put, so the pre-stroke plates stay in
   the cache and on screen under the SVG path) until every cell of the group is in; then all are put, the
   compose publishes them, and `LiveStrokeLayer.release(id)` removes the path — **in the same task**, so no
   frame shows both (a translucent stroke's alpha is applied once) and none shows neither. Results held aside
   are bitmaps and count in the budget's bytes; a group is at most the drawn cells under one stroke's box.
5. Safety: a group older than `LIVE_HOLD_MS` (3 s) commits what it has and releases; an undo while pending
   drops the item and the path; a camera move keeps the path (it rides the SVG world transform) and
   re-targets the group to the new drawn set.

The eraser mark takes the same path: its mask applies to its targets when its shape lands (A2's targets at
pen-up), and the live white path is released at the commit. This deletes `LIVE_HOLD_MAX_MS`, `liveClipSeq`,
`_armLiveTimer`, `_releaseHeldLive`, `_plateShows`, `_clipHeld`, `_liveCellsComing` and the `liveClips` /
`liveExtends` counters (`RasterRenderer.js:68-71`, `:790-910`, `:131-132`), and `raster.phone`'s P3/P4
become the rectangle re-render test (TEST-MAP).

*Built (2026-09-28):* a group holds only results packed at or after its own G (the commit its stroke landed in): a
job packed before it comes back without the stroke and would otherwise release the path over a plate that lacks it.
The re-target of item 5 runs on every change of the view's drawn set.

*Wired (B-PYRAMID-2, 2026-09-28/29):* the renderer opens the group at the Stage commit where the shape lands
(`stage.onCommit`), not in the next frame: a frame's patch step would otherwise publish the stroke's plates while the
path was still up, one compose showing both (a jsdom call-order test, red without it). While a group waits for the
workers, a stale draw under its rectangle older than its stroke is class "held" — the path shows the change — and the
integrals do not charge it as older. Headless round trip (3 strokes, `?pyramid=1`): 3 holds, 3 handoffs, 0 timeouts.

### 3.7 What a dirty rectangle must include (a requirement on A2)

The patch rule is exact only if a change's rectangle bounds every pixel it changes. Three cases the item's
own old ∪ new box does not cover, each read in the packer:

- **Family-level attributes**: a family's union routing and winding sign are decided over *every* item of
  the family (`rasterPack.js:940-946`, D64, D90), and its alpha and colour once for the family
  (`:995-1002`). An edit that adds a piece and flips the family to the union pass changes the anti-aliasing
  of *all* its pieces (the union pass samples 16 sub-scanlines, the fast path is analytic). So a change that
  alters a family's routing, sign, alpha or colour dirties **the family's whole box**.
- **Fade**: `renderIdOf` puts an item under the fade band in a family of its own (`:703-705`); a change that
  moves an item across the fully-present line at some level regroups it there — the family's box at that level.
- **Masks**: a mark's change dirties the mark's box (its mask); a target joining or leaving a mark's targets
  dirties the target's box.

And one the other way: **a cut of a target under its own mark changes no pixel**. A2 §2.5 classifies it as
picture-preserving (no footprint, only the dust boxes; `raster.mask.test.js` K4 measured 0 differing bytes
between the masked target and its pieces) — which is what keeps an erase bake of 98 cuts over a screen-wide
backdrop from staling, and so from coarse-patching, the screen at every cut. I had proposed a `visual: false`
flag for it; A2's rule is stronger (nothing to re-render at all) and I adopt it. What A2's table (§2.8) does
not yet cover is the family routing case above: an `add` or `remove` of one piece dirties that piece's
footprint only. This is Q15.

---

## 4. The queue and the budget

### 4.1 Jobs and priorities (PLAN §1.6)

A job is a typed record — `{kind, prio, frame, level | Z | planeZ+tag, cells | clips, purpose, gen,
attention}` — and `prio` is required (H7: strips re-queued by `failPool` lose theirs today,
`rasterWorkerClient.js:270`). `G` is stamped at dispatch, when the pack reads the scene.

| prio | kind | when | notes |
|---|---|---|---|
| 0 | rest cells; patches of drawn cells | at rest; after a change on screen | the group commit (§3.6) |
| 1 | the view level's missing or stale cells | always | centre-out from the attention point |
| 2 | plane layers | a selection at rest; a drag | the quick level before the main |
| 3 | cuts | a mark's bake | **one worker reserved** while any cut is pending: non-cut jobs may hold at most `workers − 1` slots |
| 4 | prefetch: coarser levels, the crossing target, the ring | at rest / idle | budget-gated (§4.5) |
| 5 | thumbnails, snapshots | the Scenes panel | at most `workers − 1` slots, as `LOW_PRIO` today (`:432-455`) |

One pool for plates and cuts (PLAN §1.6; the scene index keeps its own worker). The cut job's contract is
A2's (B-ERASE); the queue only needs `kind: "cut"` and the reservation.

### 4.2 The budgeted camera tile read

Today the camera's list build bakes every cold tile inside `_render` (`TileStore.content`,
`TileStore.js:127-150`, via `KobinEngine._buildList`, `:577-587`): 0.3–0.8 s a level on the Magnum Opus
(DESIGN §9), 440 ms for the first list at a crossing before S1 (PP §10.2). Off-camera reads have a budget:
`contentOffCamera(F, rect, budgetMs)` (`:166-182`) arms `_deadline`, `_ensureUp`/`_ensureDown` throw
`OVER_BUDGET` at the first miss past it (never inside a chain, `_nest`, `:306`, `:466`), and the read returns
**null** — all or nothing.

"A tile not ready is absent this frame and the pyramid covers it" needs:

- **From TileStore**: a partial read, `read(F, rect, budgetMs) → {items, missing: [tileKey], complete}`,
  built on the same `_deadline` / `_readBakes` / `_nest`: past the deadline a miss is **listed, not thrown**,
  and the read continues over cached tiles only. While the camera moves the frame's read runs with budget 0
  (cache hits only); missing tiles are baked at idle one tile a slice (`LADDER_SLICE_MS`'s 50 ms / 30 on a
  phone keeps its meaning). A tile chain is still 0.3–0.8 s a level (R24 LADDER-SLICE), so until a resumable
  cursor inside `_bakeUp` exists (R24: "per-object classify batches, L — not done") the stall moves from the
  camera step to an idle slice right after it. The cursor is a separate item with its own measurement (Q12).
- **From the scene (A2)**: coverage — `stage.covers(frameId, rect)`, whether every tile under `rect` is in
  the table (A2 §2.12). The renderer dispatches a job only for a cell whose rectangle is covered and plans a
  stand-in elsewhere; when the tile arrives its items are inserted and its footprint dirtied at the new G —
  the ordinary path. Rendering a cell from an incomplete table and calling it exact is F119's defect class
  ("a plate past the listed squares was rastered as paper and cached fresh"); `covers` replaces `_listWin`'s
  one-preview-plate margin (`KobinEngine.js:1016-1021`).
- **From the scene, off camera**: `stage.snapshot(frameId, rect, budgetMs)`, a read-only table stamped with
  its G, `null` past its budget (A2 §2.13) — what `listFor(frame, rect, false, budgetMs)` is today
  (`KobinEngine.js:617-700`) — for the far zoom-out levels in ancestor frames, the crossing target and
  thumbnails (D5: `snapshotView` reads with no budget today, `sceneOps.js:88-104`).
- **The window** the Stage reads for the camera is the pyramid's (A2 §2.12 leaves it to A3): the union of
  the covers of every cell the renderer will pack from the camera table — the view level's cells and ring and
  the near coarser levels ℓv − 1, ℓv − 2 with their one-cell margin (§4.3). The far levels use snapshots.

A2's document appeared while this one was being finished (its §0–§2 read at 00:12; its §3, "the interface A3
builds on", not yet written then). Its interface matches this section's needs — `track`/`dirtySince`,
`covers`, `snapshot`, `hold`/`release`/`setDragDelta`, `changesSince`, `frame()` (A2 §2.11) — and the
remaining differences are Q7 (a pending item from pen-up to its shape bake) and Q15 (family routing).

### 4.3 Prefetch: what, how far, how much

In priority order within class 4 (PLAN §1.2's order, costed):

1. **Coarser levels for the view**, two kinds. *Near*: ℓv − 1 and ℓv − 2 over the screen and a one-cell
   margin (≈ 6 + 2 plates on the desktop) — the coarse-first patches' source (§3.4) and the first octaves of
   a zoom-out. *Far*, the ladder's geometry kept as pyramid levels: for the view zoomed out 4^k about its
   centre (k = 1 … 11, 22 octaves: Kobin's bacteria→ladybird gesture is 22.5, PP §10.3), the level three
   octaves under that zoomed-out view's (`LADDER_DQ`'s 12 quanta), over 2.5 zoomed-out screens
   (`LADDER_MARGIN`, which keeps a wheel anchored at the screen's edge inside every rung, PP §10.3 b) — 2–6
   plates each, read off camera with a budget in the parent and grandparent frames past `ℓS = −8`. About 50
   plates in all, the ladder's measured 45–68 (PP §10.3, §10.18); the plan's coarser search (N = ⌈8/S⌉
   levels) reaches them. What goes is the ladder's machinery (its keys, `markLadder`, the rung state
   machine), not its reads: these are ordinary level plates the plan finds by index.
2. **The crossing target**: zooming out within 1.16 levels of `EXIT`, the parent's level `ℓv + 12/S − 1`
   over the screen and one screen of margin — the same reads that warm the parent's tiles for the crossing
   (the predicate `inScale < exit · 1.25` and its mirror `> enter · 0.8` are `_crossTarget`'s,
   `KobinEngine.js:1090-1120`, kept as a predicate). Zooming in, the child's level `ℓv − 12/S + 1` over the
   wheel focus. The equal-picture level itself is never prefetched: the frame just left serves it (§1.6).
3. **The ring at ℓv**: PLAN puts it first. It is the dearest: on the desktop the view is ≤ 24 cells at σ = 1
   and one ring around it is **+24 more (+100 %)**; ℓv − 1 with a one-cell ring covers twice the margin (1,024
   device px) for a quarter of the pixels. I recommend the ring at ℓv − 1 by default and at ℓv only at rest
   when the budget has room (Q6).

All three stop while a report is sending (`E._reportBusy`, `hooks/reportSend.js:101-102`), as the ladder does
(`KobinEngine.js:1179-1183`).

*Wired (B-PYRAMID-2):* the plan runs at idle (the camera still, nothing of priority < 4 queued or in flight) once per
view revision **and Stage generation**: a change stales the cached coarser levels, and without the re-plan a zoom out of
rest fell to the stale ℓv under the rest set, drawn older (the P2 fuzz's trace).

### 4.4 Admission, ordering, the velocity rule, cancellation

- **Admission while moving**: packing is on the main thread at dispatch (`rasterWorkerClient.js:473-487`),
  14–45 ms a job on the Magnum Opus mid-zoom (PP §10.14). While the camera moves, `pump` dispatches only
  while the frame's pack time is under `PACK_MS_PER_FRAME` (4 ms) and defers the rest to the next frame; at
  rest the pool's size is the only limit.
- **Centre-out, dealt**: every request's cells sorted by distance from the attention point (the screen
  centre; the wheel or pinch focus during a zoom; the pointer during a drag) and dealt round-robin into
  `workers × STRIPS_PER_WORKER` strips (`:309-315`), so each worker's first plate is near the centre. Today
  only previews and the incoming quantum are sorted (`RasterRenderer.js:1255`) and strips are contiguous row
  chunks (`:342-354`), so the first worker takes the top rows (R25 §6.5).
- **The velocity rule**: the frame keeps the camera's velocity (pan px/ms, zoom d(log2 Z)/ms) from the last
  two frames. At dispatch a job predicts its arrival (queue position × mean job ms ÷ workers + mean job ms)
  and is **aimed at where the camera will be**: a view-level cell predicted off screen at arrival is skipped;
  during a zoom whose level will change before arrival, the job is re-aimed at the level the camera is
  heading to (coarser on a zoom-out). That is R25 §6.5's skip and Z3's adaptive resolution as one rule.
- **Cancellation by generation**: each purpose — the view, the rest set, the plane, a prefetch item — has a
  generation bumped when it changes (a new level or frame; any Z change for the rest; a re-cut). A queued job
  whose purpose generation is old, or whose cell is exact already (a duplicate), is dropped at dispatch; an
  in-flight job is never recalled and its result is kept if G-newer (it is a stand-in somewhere). This replaces
  one-live-`frameSeq`-per-`q` (`current`, `dropStale`, `:86`, `:362-371`), `dropQueued(why, deadQ)`
  (`:398-410`), `_dropDead` (`RasterRenderer.js:1076-1096`) and `_stillWanted` (`:1356-1380`). In-flight
  dedupe: a key in flight with `G_pack ≥ dirtyG` is not re-posted; one a later change overtook may be.

*Built (2026-09-28):* the cut reservation and the prefetch and thumbnail cap are `max(1, workers − 1)`, so a
one-worker pool is never starved by a bake; the velocity rule runs only while the camera moves.

*Corrected (B-PYRAMID-2 P2):* a re-aim takes the new level's cells under the strip's and on the predicted screen; it
built all 2^d × 2^d children of every cell first, and a descend (2× a step, twenty octaves by arrival) threw an invalid
array length (the P2 fuzz).

### 4.5 The cache budget

**Bytes, sized by screens.** `view = viewPlates(σmin·2^−h) MiB` (§1.3): 40 MiB on Kobin's desktop, 35 on the
phone. Default **3 views desktop (120 MiB), 2 views phone (70 MiB)**, ceiling **256 MiB / 96 MiB**, floor one
view + the plane cap. Both numbers on the Dev panel (§8). Today: 96 / 56 MiB (`PlateStore.js:39-40`).

**Pinned (never evicted)**: the records the current plan draws (the rest cells when the rest set shows,
else the view level's sources and patches) and the plane's (`MOVE_PLANE_PLATES` 40 / 24). At rest the view
level's plates under a complete rest set are *not* drawn, so they are not pinned. Hence
**pinned ≤ max(view level, rest set) + plane ≤ 40 + 40 = 80 ≤ 120** on the desktop and 35 + 24 = 59 ≤ 70 on the
phone — H1 (pins over the budget on HiDPI, `overCapPinned`) cannot recur by construction.

*Corrected (PLAN §5.6 M2, built in B-PYRAMID-2 P0):* the drawn set also holds up to 30 stand-ins beside the own-grid
records, so **pinned ≤ own-grid records (≤ `max(viewPlates(σmin·2^−h), viewPlates(1))`) + 30 + the plane cap**
(`PyramidStore.pinnedBound`): 110 on Kobin's desktop, 89 on the 1079×1969 phone, 99 on a 390×844@3 phone, 147 on
2560×1440@2. The budget's floor is that sum and the ceiling is raised to it, so the phone's default is 89 / 99 MiB,
not 70. Measured on the 390×844@3 screen (400 seeded jsdom screens, a full plane pinned): pinned high-water 70.

**Protected (evicted last; last-evicted first in this list)**: the view level ℓv's plates in the ring; the
rest set; ℓv − 1 and ℓv − 2 of the current frame (together a third of a view: the "base" PP §10.13 kept, now a
rule); the frame just left (the crossing's stand-ins); the far zoom-out levels of §4.3 (the ladder's
`markLadder` protection, PP §7.5, as a class). On the desktop these add up to ~130 plates against the 120 MiB
default, so the order is what decides, and the far levels are the first of them to go.

**Evicted first**: stale records not drawn; records of frames off the camera's path; levels finer than ℓv;
levels far from ℓv; then LRU. A hidden tab releases after 5 min (desktop) / at once (phone), keeping ℓv − 2
(PP §10.13's base, a few plates) so the return is never paper; `HIDDEN_RELEASE_MS` stays.

**The phone**: `isPhoneBudget` stays (`PlateStore.js:70-77`); the canvases around the plates grow too
(surface 36.7 MB against 25.2), which is the iOS risk named in §10.3.

### 4.6 The deletion list

| mechanism | file:line |
|---|---|
| **the ladder** | `KobinEngine.js:64-82` (`LADDER_*` constants, the comment), `:87` (`ladderIdle`), `:1122-1130` (`_maybeLadder`), `:1135-1157` (`_buildLadder`), `:1159-1170` (`_ladderCrossings`), `:1171` (`_ladderKey`), `:1173-1226` (`_ladderRung`), `:1228-1246` (`_zoomedOut`), `:286` (`onPlaneAimed`), `:292` (`onShown`'s `_ladderAt`), `:441`, and the calls at `:1007`, `:1045`, `:1071`, `:1137`; `RasterRenderer.js:57` (`LADDER_DQ`), `:61` (`LADDER_MAX_PLATES`), `:1558-1583` (`plateCover`, `listMargin`, `ladderPlates`, `ladderMisses`); `PlateStore.js:153` (`_ladder`), `:155` (`_base`), `:291-300` (`markLadder`), `:426`, `:438-439`, `:747-750`, `:776-777`; `TileStore`'s `warmReads`/`_warm`/`clearWarm` (`:83-86`, `:176`, `:184`) are **kept**: the prefetch's off-camera reads need `framesLeft` to spare the tiles they warmed (F83) |
| **the prebake** | `KobinEngine.js:1090-1120` (`_crossTarget`, kept as the predicate only), `:1248-1279` (`_maybePrebake`), `:1070` (its call), `:233` and `:372` (`preBake`, `setPreBake`), `hooks/useKobinEngine.js:148`, `:781`, `:932`, `Pages/CanvasEditor.js:941` (the PreBake button), `report.js:200`; `RasterRenderer.js:1531-1552` (`prebakePlates`) |
| **the preview** | `PictureLayer.js:106-114` (`PREVIEW_STICKY`, `PREVIEW_FAST`, `FAST_ZOOM_MS`), `:306-308` (`_prev`, `_prevLive`, `_qChangeAt`), `:445`, `:1627-1638`, `:1663-1686` (`_aimPreview`, `_askPreview`); `plate.js:17-21` (`PREVIEW_QUANTA`); `RasterRenderer.js:54-55`, `:88-93` |
| **the carry** | `PictureLayer.js:126` (`CARRY_MAX_SC`), `:336-343`, `:755-765`, `:842-931` (`_carryXf`, `_drawCarry`, `_keepCarry`, `dropCarry`); `RasterRenderer.js:455-456`; `KobinEngine.js:200` |
| **the hold** | `PictureLayer.js:87-104` (`S_MIN`, `S_MAX_HOLD`, `S_MIN_HOLD`), `:309-312`, `:563`, `:568-569`, `:596-620`, `:1111-1112` (`holding`), `:1620-1653` (`_onQuantumChange`), `:1753-1769` (`_endHold`) |
| **the pending quantum** | `PictureLayer.js:298`, `:310`, `:453` (`quantumRequest`), `:1688-1744` (`_askQuantum`, `_quantumArrived`, `_switchQuantum`); `PlateStore.js:593-608` (`abandonQuantum`) |
| **the settle machine** | §2.5's table |
| **`fallbackCover`** | `PlateStore.js:48-62` (`FB_Q_LO`, `FB_Q_HI`, `FB_MAX`), `:326-372`; `PictureLayer.js:124` (`FB_DRAW_MIN`), `:940-1106` (`_planFallbacks`, `_fbBudget`, `_fbCovers`, `_drawFallbacks`), `:1201-1205` (`_emptyCover`), `:1253-1265` (`_mapFrame`, replaced by `mapCell`) |
| **sync as a mode** | §2.5's table |
| **quantum identity in the queue** | `rasterWorkerClient.js:82-86` (`current`), `:362-387` (`dropStale`, `pruneCurrent`), `:398-410` (`dropQueued`'s q form), `:421-422`; `RasterRenderer.js:235-236` (`_qWas`…`_postQ`), `:1076-1096` (`_dropDead`), `:1356-1380` (`_stillWanted`), `:141-145` (`sortCentreOut`, generalised) |
| **the live hold** | §3.6's list |
| **counters and report fields** | `pictureStats` (`PictureLayer.js:159-196`): `quantumChanges`, `syncFlips`, `syncCostExits`, `previews`, `previewHits`, `previewKept`, `holds`, `holdsPartial`, `holdSkips`, `holdSwitches`, `quantumAbandons`, `heldComposes`, `holdMaxS`, `holdMinS`, `holdBreaks`, `holdShrinks`, `carryComposes`, `carryShifted`, `carryDropped`, `switchRefusedLow/High`, `settles`, `settlePublishes`, `settleDrops`, `fallback*` (8), `crossFrameBlits`, `coverRefused`, `zqMismatch`, `syncRefused`, `layerOverflow`; `report()`'s `settlePending`, `settleDone`, `held`, `heldQ`, `pendQ`, `holdWhy`, `covered`/`screenCovered` (replaced by the plan's counts) (`:1838-1854`); `rasterStats` (`RasterRenderer.js:118-135`): `dupPostQ`, `quantumDrops`, `settleDrops`, `syncFrames`, `syncPlates`, `syncNoImageData`, `syncBytes`, `prebakePosts`, `prebakePlates`, `ladderPosts`, `ladderPlates`, `ladderRefused`, `liveExtends`, `liveClips`; `PlateStore.s` (`:159-179`): `dropsByQ`, `addCallerMismatch`, `fallbackScans`, `fallbackCandidates`, `fallbackDropped`, `abandons`, `ladderEvictions`, `epochBumps`, `epochPrunes`, `noEpoch`, `staleNewer`; `rasterPerf` `MODES` gains `"level"`, `"rest"` appended (`:138`, append-only: D19), `KINDS`' `"settle"` row becomes the rest's (`:133`); `tools/harnesses/browser-check.js:54-56`'s picks |

What stays: the plate grid, the store's LRU/pins/byte cap/`close()` discipline (`_remove` is the only closer,
`PlateStore.js:772-782`), `dropFrames` for a frame whose meaning changed, the visibility release, the pool's
spawn/respawn/watchdog/inline fallback (RW-1), the buffer pool, `snapshotJob`, `rasterPerf`.

---

## 5. Input coalescing and the page re-render

**Today** every DOM event is a view step: the hook's `wheel` calls `engine.zoomAt` per event
(`hooks/useKobinEngine.js:706`), pointer moves call `pinchUpdate` or `pointerMove` → `panBy`
(`:663-671`, `KobinEngine.js:1430-1434`), and each runs `syncCameraOnly` or `_render`, then `update` and
`_emit` (`KobinEngine.js:1029-1074`). A trackpad sends 60–120 wheel events a second (R25 §3.1).

**Where**: in the engine, not the hook. `panBy`, `zoomFactorAt`, `pinchUpdate` and a drag's `_dragSelection`
keep mutating the camera (or recording the drag's last pointer) per event — the camera stays current for hit
tests and the float arithmetic is today's — and **request a frame**. One `requestAnimationFrame` callback,
`KobinEngine._frame()`, then does once: the crossing's consequences (a render) or a camera-only step, the
scene/tiles read within budget, the renderer's plan/compose/posts, the rest trigger, the drag's plane step,
`update`, `_emit`. Arrivals mark the frame dirty instead of composing per job (`PictureLayer._flush`,
`:1497-1504`), which also bounds GPU uploads to one compose a frame (R25 §13.4). A drag's per-event document
write collapses to one per frame for free: `_dragSelection` recomputes from the drag's start (M-4,
`selection.js:660-667`), so only the last pointer matters. Drawing is not coalesced: every sample goes into
the pen (`KobinEngine.js:1458-1479`); only its SVG `update` moves to the frame.

Why the engine: `panBy`/`zoomFactorAt` are also called by `jumpTo`, scene jumps, the testkit and the
harness; the frame loop is where the rest trigger and the arrival coalescing live anyway; the hook would
otherwise need a copy of the camera maths to compose zooms about different anchors. jsdom has rAF only with
`pretendToBeVisual`, so the engine takes `cfg.frames = "raf" | "sync"` (sync for the suites and the one-off
SVG engines) and `engine.flush()` runs a pending frame now (for the harness and tests).

**R25 W1.** `onStatus`'s 50 ms throttle is bypassed whenever `effectiveZoom` changes
(`useKobinEngine.js:179-195`) — every zoom event — so `setStatus` re-renders the whole `CanvasEditor`
(1,334 lines) per wheel event; its consumers of the zoom are the scale HUD (`hudBundle`,
`CanvasEditor.js:513-524`), the label (`:558-560`), the Dev panel (`:936`) and the scale dialog's `zoomAt`
(`:1237`). The fix: **a zoom subscription of its own** — `engine.onZoom(cb)` fired once per frame when
`effectiveZoom` changed — consumed by a small `<ScaleHud>` component that owns `scaleSession` and the
`computeScale` write-back (moved out of `CanvasEditor`), so a zoom re-renders that leaf alone; `onStatus`
keeps a plain 100 ms throttle with no bypass; the dialog reads `engine.cam.effectiveZoom()` when it saves.
"The HUD cannot skip rungs" (the bypass's reason) is still true: the leaf sees every frame's zoom. Q11.

---

## 6. The MovePlane port

**Kept as Kobin decided (decision 4)**: five layers (`MOVE_PLANE_LAYERS`), the merge of the smallest
sandwiched run (`MovePlane.js:171-180`), coarsening to `PLANE_COARSEN_MAX` octaves (`:186-190`), the quick
level `PLANE_QUICK_OCTAVES` coarser (`:192-196`), the main-thread stopgap (`RasterRenderer._planeStopgap`,
`:586-609`), the pre-aim when the view is quiet (`_planeIdle`, `:635-663`), the landing per cell
(`landCells`, `:323-334`; `_planeLanded`, `RasterRenderer.js:666-674`).

**Identity.** Layers stay named by their members' hash (`idsHash`, `:67-75`, review item 7); a plate is
`F │ P<Zp> │ <tag> │ i,j` with `G` (§1.1). The plane's zoom Zp is the rest Z when the plane is aimed at rest
(the common case: select, pause, drag — at σ = 1, so the cap is `MOVE_PLANE_PLATES` and not
`PLANE_SCALED_MAX`, `:184`) and the view level's Z otherwise; coarser plane levels are `Zp / 2^k`, the quick
level `Zp / 4` — plane levels are the plane's own and need not be pyramid levels. (Keying the plane at the
pyramid level ℓv instead, as the brief's `(frame, level, i, j, G)` reads, would draw it stretched by σ at rest
and put it under `PLANE_SCALED_MAX`'s 16 plates, `:184` — more coarsening, a blurrier drag, for a simpler key.) `_whole` checks exactness
(`G ≥ dirtyG`), not bare presence (`:276-283`); `_postPlane`'s freshness test (`RasterRenderer.js:534-535`)
becomes `exact`.

**Pins and budget.** `setPlanePins` (`PlateStore.js:303-307`) becomes the plane's share of the pinned set; the
budget floor reserves `MOVE_PLANE_PLATES` (§4.5); the rule "quick only when main + quick fit the cap" stays
(`MovePlane.js:195`).

**D1: grow the cells by one screen — the SEL layers only.** Today `_cut` keeps families touching the view
(`:152-160`) and `_level` clamps every layer's cells to the view's range (`:212-219`), so selected ink past
the viewport is in no layer and vanishes until the drop (R25 D1). During a drag by δ the screen needs BELOW
and OVER at the view's own cells (they are drawn in place) and SEL at `view − δ`. So only the SEL runs are
cut against the view **grown by one view in each direction** (families touching the grown window join SEL
runs; BELOW stays the union of the on-screen runs' cells). A drag of up to a screen shows all of the
selection; the growth is bounded by the selection's own area, and the existing cap/coarsening handles a
selection many screens wide. Q14.

**H4 (the selection shown twice in the first frames).** In `partial` mode `_composePlane` draws only the SEL
layers (`PictureLayer.js:1178`) over plates that still hold the selection at its start (`_dragOmit` is set
only when the plane is whole, `RasterRenderer.js:577`; the stopgap is SEL-only, `:589`). The rule that keeps
"a drag always moves" (PP §10.14) and removes the double image: **never both** — SEL is drawn translated only
where the selection's *start* footprint is covered by a BELOW source: a BELOW plate of the main or quick level
(cached, not necessarily whole), or a main-thread BELOW stopgap for those start cells when the inline
estimate (§3.3) fits; where neither exists, the selection stays in place for that frame and the ants move
(they are the overlay's). The test: at every drag step, each pixel of the start footprint shows either the
selection in place (and no translated copy exists) or BELOW. Q13.

**The plane in the compose plan.** The plane is drawn after the base plan, in paint order: BELOW over its
cells (the view's own base plates there are not drawn — `_planeBelow`, `PictureLayer.js:1119-1126` — which is
also what keeps a plane plus 24 plates under the image budget), SEL translated by the pointer (whole device
pixels), OVER in place. Landing: per view cell, the plane is drawn until that cell's base source is exact at
`G_drop`; then the cell shows its base alone (`landCells` × `exact`).

**`_dragOmit` and `_holdMove` under held items.** PLAN §1.4: no document writes during a drag; the scene
holds the selected items and applies the delta at pack time; tables written once at the drop. Then:
`_holdMove` (`KobinEngine.js:185`), `_beginHold` (`:775-788`), `_framesFootIn` (`:794-806`), `_heldByMove`
(`:824-830`), `_underHeldFrames` (`:831-835`), `_releaseMove` (`:894-910`) and `_movedRectsIn` (`:916-955`) go — there are no events to hold, and the drop dirties old ∪ new boxes through the
scene; `_dragOmit` (`RasterRenderer.js:577`, `:1341`) becomes the pack rule **"a held item is skipped while the
plane draws, and packed at `placed(item) + δ` when it does not"** (the plane lost: `_losePlane`, `:622-628`).
Wave 2 lands before B-DRAG (PLAN §2): until then the drag still writes per frame, and the scene's `hold(ids)` /
`release()` must keep today's semantics — held items' changes dirty nothing until the release dirties start ∪
end once. That is `_holdMove` moved into the scene (A2).

---

## 7. The SVG renderer's demotion

### 7.1 What `RasterRenderer` uses from `Renderer`

| used | where (`Renderer.js`) | on the raster path it is |
|---|---|---|
| the Two.js instance `two`, appended to the host | `:406-421` | the SVG layer at z-index 1 (`RasterRenderer.js:193-198`) |
| `world` (the camera group), `_activeRoot`, `_scenes` with the `_ov` scene | `:422`, `:466-470`, `:822-838` | the live stroke's parent; `_activateLevel` overridden to one persistent scene (`RasterRenderer.js:940-952`) |
| `tileDebugGroup`, `eraseDebugGroup`, `_renderTileDebug`, `_renderEraseDebug`, `setTileDebug`, `setEraseDebug` | `:423-425`, `:1877-1885`, `:1911-1955` | the Dev panel's Erase and tile overlays |
| `selGroup`, `setLasso`, `refreshSelection`, `_renderSelection` | `:426`, `:1402`, `:1417-1440` | the lasso loop |
| `_selAntsFn`, `setSelectionAnts`, `_selOv`/`_selEls`, `_mkSelLayer`, `_renderSelChevrons`, `_dropSelOverlay`, `_ensureSelStyle` | `:427-429`, `:1460`, `:1632-1741`, `:1820` | chevrons in `bl-sel-edges` (z 3); the ants are `OverlayLayer`'s (`RasterRenderer.js:280-343`) |
| `addLive`, `_livePath`, `_freezeLive`, `setLiveArcs`, `endLive`, `liveChunk`, `_live`, `_liveRoot`, `_liveModel`, `_liveStable`, `_liveGap` | `:1327-1398`, `:418` | the live stroke: tail + frozen chunks of 128 anchors, the root carrying the opacity (D-1) |
| `_origin`, `_viewCenter`, `_ovOrigin` | `:684-694`, `:473` | the live stroke's origin (FC6; the ants read none, G12) |
| `syncCameraOnly(view)` → `syncWorld` → `_syncWorldTransform` + `_renderOverlays` | `:643-673` | the world transform from the view (`RasterRenderer.js:955-976`) and the overlay tail |
| the arc plan `_arcPlan` and `pushGapAnchors` | `:415-416`, `:181-193` | how the live arcs become anchors |
| stubs overridden to false: `needsReorigin`, `needsWindowChop`, `needsFadeFlip` | `:705-708`, `:735-739`, `:536-544` | `RasterRenderer.js:749-760` |
| inherited and live: `needsFatFlip`, `hasPendingNearFat`, `_strokeMode`, `_fatEver`, `_fatOnScreen`, `_gatePx`, `ensureOutline` | `:498-555`, `:1267-1273` | the fat gate (a Skia mis-stroke guard, meaningless for the rasteriser) and the idle outline fit (`KobinEngine._queueIdleFits`, `:1281-1312`) |
| `setOpacityGroups`, `setLazyOutlines`, `setRetainScenes`, `setDebug`, `bumpAll`, `clear` | `:1871-1899` | mostly inert; `clear()` drops the `_ov` scene (D271) |
| `setDragState`, `setPlaneState`, `endMove` seams | `:1404-1408` | overridden (`RasterRenderer.js:462`, `:694-705`) |
| `destroy`, `setSize`, `update` | `:481-495` | the Two.js teardown (`Two.Instances` splice) and resize |
| `report()` | — (`Renderer` has none) | `RasterRenderer.report` (`:1675-1683`) |

### 7.2 `LiveStrokeLayer` and `SvgLayer`

`SvgLayer` (one Two.js instance, z-index 1): a `world` group whose transform is the view's
(`scale = k/dpr`, translation `(t + og·k)/dpr`, today's `RasterRenderer._syncWorldTransform`, `:955-965`), a
screen group for the lasso, the two debug groups, and `update()`. It owns the SVG element's lifetime.

`LiveStrokeLayer` (in `SvgLayer.world`):

```
begin(o)           pen-down: the origin re-chosen at the view centre, ONE object, one writer (FC6); held paths
                   re-anchored by the origin's move (F131, today RasterRenderer.addLive :918-928); a root group with
                   o.opacity; the tail path
arcs(gaps)         the pen's gaps into the tail; anchors that can no longer change frozen into chunks of liveChunk
                   (today Renderer.setLiveArcs/_freezeLive :1344-1392, moved)
hold(id)           pen-up: the root stays, tagged with the stroke's id and the origin it was drawn at
release(id)        called by the group commit (§3.6) in the same task that publishes the stroke's plates
cancel()           cancelStroke and an undo while held
```

The opacity rides the root, so a translucent stroke's frozen chunks never double over each other (D-1); the
per-cell `clipPath` is gone (§3.6). The lasso, `_renderTileDebug` and `_renderEraseDebug` move into a shared
module both renderers call (one implementation), as do the chevrons (`_renderSelChevrons`, `_mkSelLayer`,
`_ensureSelStyle`).

`RasterRenderer` becomes a plain class composing `[PicturePyramid (z 0), SvgLayer (z 1), OverlayLayer (z 2),
bl-sel-edges (z 3)]` — FC1's list, walked by `setSize`, `destroy` and the store's release
(`RasterRenderer.js:216`, `:408-413`, `:446-451`). `ensureOutline` moves to the engine (it is
`geometry/curveOutline`'s `strokeLoops`, `Renderer.js:1267-1273`); the fat gate (`needsFatFlip`,
`hasPendingNearFat`) is SVG-only and returns false on the raster path.

### 7.3 What `Renderer` keeps

All of the Two.js ink path for `?svg` and the export: per-object groups and the signature diff, per-scene
origin and re-origin, the thin rescale (F-Z), scene retention, the arc plan and the window chop, the selection
indicator in SVG (DESIGN §9 "The SVG renderer"), plus `addLive`/`setLiveArcs`/`endLive` for its own live
stroke (through the same `LiveStrokeLayer`, one implementation). It loses the raster seams (`_ovOrigin`,
`setDragState`, `setPlaneState`, `endMove` stubs: the engine calls them only where present, as it already does
for `planeAccepts`/`dragLight`, `KobinEngine.js:777`, `selection.js:724`). `thumbnails.withSvgEngine`
(`storage/thumbnails.js:57-71`) and the export (`hooks/useKobinEngine.js:860-864`) are unchanged: they build a
`KobinEngine` with `raster: false`.

### 7.4 The hook's gate

`rasterFromUrl` (`hooks/useKobinEngine.js:49-57`) keeps its meaning — raster by default, `?svg` (or
`?raster=0`) the SVG renderer — and `setRaster` still rewrites the URL and reloads (`:954-958`). During the
migration a second gate, `?pyramid=0|1`, read the same way and passed as `new KobinEngine(host, {raster,
pyramid})` → `cfg.pyramid`, selects the old `PictureLayer` path for the browser comparison (§10.1); it is
deleted with the old path.

---

## 8. The Dev-panel levers

**Where.** The panel is `CanvasEditor.js:933-983`, shown when `devUnlocked` (`?dev` in `location.search`,
`:86-90`) and `devOpen`; its buttons call hook setters (`engine.setPreBake`, `engine.setTrace`, `setRaster`
which reloads). The engine's `cfg` is `{...DEFAULTS}` (`KobinEngine.js:91-120`, `:138`) and the same object
is the renderer's (`RasterRenderer`'s constructor, `:172-173`).

**The levers**: `levelStep` ∈ {1, 2, 3} (a 1·2·3 toggle), `plateViews` (1–8, default 3 / 2 phone) and
`plateCeilingMiB` (64–512), `pyramid` (old/new, reload), and for measurement `restInline` (auto/never) and
`compose` (auto/direct/surface). New cfg fields in `DEFAULTS`; setters `engine.setLevelStep(s)` and
`engine.setPlateBudget({views, ceilingMiB})` through the hook as the other setters are (`useKobinEngine.js:
920-960`).

**A live change of the level step**: `cfg.levelStep = s`; the store drops every level record (their keys carry
the old S, §1.1) and bumps the view's and the prefetch's purpose generations (their queued jobs are dropped at
dispatch; in-flight results no longer match a key); rest plates (keyed by Z) and the plane (re-aimed at the
next quiet) are untouched; the frame renders — the rest set covers the screen at rest, so the change is visible
only on the next zoom. **A live change of the budget**: `store.setBudget(bytes)` and one eviction pass
(pins respected; if pins exceed the new cap, `overCapPinned` counts it rather than evicting drawn plates).

**Persistence.** URL parameter, localStorage or the canvas record: **localStorage per device, with a URL
override** (`?levelStep=2&plateViews=3`) that wins and is what the harness and a shared experiment link use.
Not the canvas record: a step or a byte cap is a device and taste setting, not document data; stored there it
would sync the desktop's 120 MiB to the phone and change the save format (1.0 compatibility gate). Q8.

**Counters beside them** (a `<DevStats>` leaf on its own 500 ms timer, so it never re-renders the page): the
view (`level ℓv`, σ, mode rest/level, rest executor inline/worker and its ms); `paperMs`, `blurMs`, `olderMs`
over the last gesture (§9.1); long frames in the last 10 s (count, worst ms) and the frame histogram
(`frameMeter`); plates (count, MiB / cap, pinned, stale), jobs (queued and in flight per priority), images per
compose (max over 10 s against 30). All are fields `report()` already carries or gains (§9.1), so the report
and the panel read one set.

---

## 9. Measurement

### 9.1 The paper metric, and its two companions

PP §9/§10.11 defines paper as **each frame's uncovered share of the screen × how long that frame stayed on
screen, charged forward**. The new layer keeps three integrals, updated at each compose:
`paperMs += shareUncovered × (now − lastCompose)`, `blurMs` the same for cells drawn from another level or a
patch (the price of "blurrier now"), `olderMs` for cells drawn stale (step (f): should be ~0). `report()`
carries them cumulatively; the harness reads `E.renderer.layer.report()` before and after each scripted
gesture and prints the deltas. For today's code, which has no integral, the harness runs an in-page rAF sampler
over `layer.uncoveredCells()` (`PictureLayer.js:1268`) and the cell count of `_rFull`, integrating forward —
the same number on both paths, so old and new compare (`cfg.pyramid`, §7.4).

### 9.2 The frame-time histogram

`E.frameMeter.report().hist` (buckets ≤17, ≤33, ≤50, ≤100, ≤250, ≤500, ≤1000, >1000 ms,
`instruments.js:254-330`) differenced across the gesture, and `E.longFrames.report()` (long animation frames,
≥ 50 ms, with script attribution, `:47-107`) for the list of the bad ones. The brief names `longFrames` for the
histogram; it records only the long frames, and `frameMeter` is the histogram — both are printed. Plus the
compose's own ms and max images per compose, which E6 shows headless *can* see.

### 9.3 A synthetic dense drawing, generated in page

The entry point that makes objects without pointer events is `E.loadSnapshot(dev0)` (`files.js:31-45`): a
`{v: "dev-0", camera, natives: {frameId: [record]}, crossings}` whose `natives` keys are minted as frames by
`_mintNamedFrames` → `LevelMap.ensureId` (`LevelMap.js:604-635`: `"0"`, `"1"`, `"2"` are spine frames,
`"1/3,-2"` an off-spine child). Records are `format2.objectHeader`'s shape (`format2.js:55-71`): strokes
`{type:"stroke", origin:"native", id, pts, lwFrame, color, opacity}`, fills `{type:"fill", …, polys}`, an eraser
`{…stroke, erase:true, bakePx}`. Then `E.flushBakes()` resolves every stroke's perimeter (`erasePipeline.js:
125-133`) before anything is timed. (`__testkit__/harness.js:37-47`'s `drawStroke` shows the pointer path; it
renders per pen-up and is for a handful of strokes, not thousands.)

`synth({seed})`, deterministic (a seeded LCG), placed with `page.evaluate` into `window.__kobinEngine`:

| part | content |
|---|---|
| depth 0 (`"0"`) | a backdrop fill over ±W/2, light grey; 1,500 strokes (random walks of 8–60 samples, widths 2–40 units at inScale 1); 300 fills (blobs of 5–16 vertices, 5–400 units) |
| depth 1 (`"1"`, and `"1/1,0"`, `"1/-1,1"`) | 800 strokes + 200 fills near the spine child's centre; 100 strokes in each off-spine child |
| depth 2 (`"2"`) | 400 strokes |
| translucent | 10 % of every group at opacity 0.35–0.6 (highlighter-like: width ×2.5, opacity ≤ 0.45) |
| a stack under a mark | at depth 0 around (−300, 200): 12 overlapping fills and strokes, then an eraser stroke (width 40) across them, left pending (its bake resumes on load) |

Scenarios, each printing paperMs / blurMs / olderMs deltas, the frame histogram, long frames, compose ms and max
images, plates/bytes/pinned, jobs by priority: (1) PP's fast zoom-out — 90 wheel ticks of +250 at 25 ms from
depth 2 to 0 — and back; (2) a slow zoom, 40 ticks at 120 ms; (3) a pan, 60 steps of (25, 8) at 16 ms; (4) a
lasso and a 40-step drag; (5) a translucent stroke's pen-up (live path held → released, time to exact); (6)
Ctrl+Z of it (time to exact; olderMs must stay 0); (7) an eraser stroke over the stack while zooming. Run with
`?dev&pyramid=0` and `?dev&pyramid=1`, `?levelStep=1|2|3`.

*Corrected when B-FOUNDATION built it (2026-09-28, `tools/harnesses/browser-check.js --dense`,
`synth-drawing.js`):* `"1/1,0"` and `"1/-1,1"` are children of `"1"`, so two levels down, beside `"2"` — the
table's row puts them at depth 1; the drawing keeps the ids. The snapshot must list the spine frames in its
`crossings`: `LevelMap.ensureId` mints `"1/1,0"` under an existing `"1"` but returns null for a bare spine id
(`"2"`), and those natives load undrawn. Scenario (3)'s 1,500 px do not fit a 1,280 px viewport as one pointer
drag, so its steps go through `panBy` (what the pan tool calls). Scenario (7) draws the eraser and then zooms
while its bake runs: a zoom under the pen ends the stroke (`Camera.zoomFactorAt` → `finalizeLiveStroke`).

### 9.4 What headless can and cannot say

Script time, pixels, counts, the paper integrals and the image-cliff step are real in the container's Chromium
(E6). GPU texture uploads, the compositor's scaling and the smoothed blit's cost (F79) are not: they wait for
Kobin's Chrome (the same harness with `--headed` against his machine, or his own run).

---

## 10. Migration, tests, risks, effort

### 10.1 The migration path

`cfg.pyramid` (URL `?pyramid=0|1`, §7.4) keeps `PictureLayer` for the comparison until step 10.

1. **The clip box** in `rasterCore`/`rasterJob`/`rasterWorker` + PLAN §3 row 8's test. Independent of
   everything; the old path passes `clip` absent. Worker bundle rebuilt.
2. **`level.js`**: `levelFor`, `zOf`, keys, `mapCell`, `coarser` + row 6's test. Pure.
3. **`PyramidStore`** beside `PlateStore`: G-keyed records, the dirty log, group commit, pins/protection/
   budget + row 1's test. Needs B-SCENE's generation API (A2) — the point PLAN §2 starts B-PYRAMID from.
4. **`PicturePyramid`** beside `PictureLayer`: the view (FC2 object), the plan (§1.4), direct/surface (§1.5),
   the rest executor (§2), the partial path and merge (§3), the integrals (§9.1).
5. **The queue** in `rasterWorkerClient`: typed jobs, priorities, purpose generations, admission, dealing,
   the velocity rule; the cuts' reservation lands with B-ERASE.
6. **`RasterRenderer` under the flag** (`_frameStep` → the pyramid), the pen-up rule (§3.6) and the MovePlane
   port (§6).
7. **Input coalescing and `ScaleHud`** — independent of the flag; R25 §7 step 1 says it can go first.
8. **The Dev levers and `DevStats`.**
9. **The harness** (§9), both flags, headless; then Kobin's Chrome.
10. **Delete** (§4.6): `PictureLayer`, the old `PlateStore` rules, `plate.js`'s quantum half, the suites per
    TEST-MAP; `cfg.pyramid` goes; DESIGN §9, `docs/ai/` 10/20/30/40 and PLAN §1.2's text corrected.
11. **The SVG demotion** (§7): `SvgLayer`, `LiveStrokeLayer`, the shared overlay helpers; `RasterRenderer` stops
    extending `Renderer`.

### 10.2 The tests that define done

| invariant (PLAN §3) | the test, concretely |
|---|---|
| **row 1** — a stored plate's G is monotone; exact iff `G ≥ dirtySince` | `PyramidStore.property.test.js`: a seeded random interleaving of commits (a footprint in a frame at `G++`, through the Stage's `track`/`dirtySince`), `beginJob(key, G)` (a job packed now), arrivals in random order (some older than a later change), evictions and releases, over 3 frames × 4 levels × 16 cells; after every step: (a) no key's stored G decreased; (b) `exact(r)` ⇔ no dirty entry with `G > r.G` meets r's box (checked against a brute-force log); (c) the compose plan never draws as exact (steps a–d) a record some later change touched; (d) an arrival older than the stored record is closed (`bitmapsClosed` counts it) |
| **row 6** — the crossing map is exact | §1.6's seven steps |
| **row 8** — a partial re-render equals a full one | `rasterCore.clip.test.js`: E1 as a test — seeded random lists (fills, arc shapes, stroke bands, families of pieces, pending marks), opaque and transparent paper, cull on and off; per plate 6 random clips; assert inside the clip `===` the whole-plate render byte for byte and outside the clip untouched; plus the merge: a plate rendered at G1, the list changed inside a rectangle, patched through the clip → `===` the plate rendered whole at G2 |
| every pixel from exactly one source | `PicturePyramid.plan.test.js` on `__testkit__/softCanvas`: sources painted flat distinct colours; random mixes of fresh/stale/coarser/finer/other-frame/missing; every screen pixel's colour is its planned source's; a translucent family split across ℓ and ℓ−1 never shows a pixel darker than either source |
| blurrier now, never older | the undo example (§3.5) end to end in jsdom, inline and coarse-first: after the undo's frame, wherever the post-undo whole render differs from the pre-undo picture, the screen differs from the pre-undo picture too (the stroke shows nowhere), and in the inline case the screen equals the post-undo render byte for byte; `olderMs` stays 0 |
| pen-up, no double | the recorder: no frame in which the SVG path and a plate containing the stroke are both drawn, and none with neither (PP §9's pen bar), for an opaque and a translucent stroke, inline and worker paths |
| H4 | §6's "never both" per drag step |
| D1 | a selection 2 screens wide dragged by a screen: every selected pixel is drawn at every step |
| the image budget | a compose never draws more than `COMPOSE_IMAGES` distinct images (counted) — and in the harness, compose script ms under 5 ms at the budget (E6's step is the red line) |
| input coalescing | 10 wheel events inside one frame produce one compose, one `_emit`, one `setStatus` of the page (W1), and the same camera as today to the bit |

The old recorder suites go with their mechanisms (TEST-MAP), never ported.

### 10.3 Risks

- **The image cliff** (measured, E6 and PP §10.14): the plan must count images; the surface recompose may pay
  the step once per level change; children stand-ins are the budget's main consumer. Unknown: whether the cliff
  is per canvas flush (then the surface's recompose pays it separately from the frame) or per frame.
- **Memory on HiDPI**: the surface is 41.9 MB desktop and 36.7 MB phone at the bounded band (29.4 / 25.2 today);
  a 2560×1440@2 screen needs the adaptive σmin or 178 MB. iOS caps canvas memory at 224–384 MB (R25 §13.4).
- **The stretch**: octave levels blur 41 % mid-gesture at S = 1; at S = 2 / 3 the bounded band magnifies up to
  2.8× / 5.7×. It is a feel call; the rest render bounds it to motion.
- **The crossing**: the two frames' pictures come from two derivations (magnify chain vs projection), equal to
  sub-pixel, not to the bit; the map is exact, the pixels are stand-ins. A cold parent has no tiles: until the
  tile arrives the view is stand-ins only — and a tile is still 0.3–0.8 s of one idle task without a bake cursor.
- **Pen-up latency on dense drawings**: the group commit holds the SVG path until the whole rectangle is in;
  today releases per cell. Bounded by `LIVE_HOLD_MS`.
- **The erase bake**: if a cut under its own mark ever dirtied its target's box (A2 §2.5 says it will not), every
  cut would coarse-patch the screen; the harness's scenario 7 watches `blurMs` during a bake.
- **Coalescing**: tests and harnesses that assume a synchronous render per API call need `cfg.frames:"sync"` or
  `flush()`; a missed flush reads as a stale picture in a test.

### 10.4 Effort (agent-days)

| item | days |
|---|---|
| clip box + wire + row 8 test | 1 |
| `level.js` + cross map + row 6 test | 0.5 |
| `PyramidStore` (G, dirty log, group commit, budget, eviction) + row 1 test | 2.5 |
| `PicturePyramid` (view, plan, direct/surface, rest executor, merge, integrals) + plan tests | 4 |
| the queue (typed jobs, priorities, generations, admission, dealing, velocity) | 2 |
| `RasterRenderer` integration + pen-up rule + MovePlane port (identity, D1, H4) | 3.5 |
| budgeted camera read (TileStore partial read; scene incomplete regions with A2) | 1.5 |
| input coalescing + `ScaleHud` (W1) | 1 |
| Dev levers + `DevStats` | 1 |
| harness: synth drawing, integrals, scenarios, both flags | 1.5 |
| deletion, suites per TEST-MAP, docs | 2 |
| SVG demotion (`SvgLayer`, `LiveStrokeLayer`, shared helpers, the renderer interface) | 2.5 |
| **total** | **≈ 23**, plus the review pass and the Chrome round (~30 %) |

---

## 11. Impact on the other workstreams

- **A2 / B-SCENE**: the generation API (`G`, `track`/`dirtySince`, the dirt log), `placed(item)`, held items
  (`hold`/`release`/`setDragDelta`, §6), `covers` and `snapshot` (§4.2), and two asks: a **pending** item from
  finalize to its shape bake (§3.6, Q7 — A2 §2.8 makes `finalize` packable at once, which keeps D-3's double
  raster) and the **family routing** footprint (§3.7, Q15). The pack reads the Stage at dispatch and stamps G;
  its family prepass, keyed on a list object today (`rasterPack.js:766-814`, `PREPASS` per list), is keyed on
  `(G, Zq, only, omit)` and patched from `changesSince` (A2 §2.4) — the 24–39 ms prepass A2 measured on each new
  list is B-PYRAMID's to remove.
- **B-ERASE**: cuts as jobs in the one pool with a reserved worker (§4.1); marks' masks unchanged in the core; a
  cut of a target under its own mark dirties nothing (A2 §2.5). With the pending rule a new mark is not packed
  until its perimeter resolves (the live white path shows it), so A2's "unresolved mark masks everything below
  it" clause is not needed for plates.
- **B-DRAG** (wave 3): §6's pack rule for held items is the renderer half; until then the scene's hold emulates it.
- **A1 / B-MODEL**: the cross-frame map reads `LevelMap.framePath` and cells; a re-address (`readdress`,
  `addrEpoch`) invalidates plates of moved frames through the scene's dirtying (a frame's meaning changed:
  `dropFrames`), and the map follows the new path (row 6's step 7). If A1 changes frame centres or adds
  non-cell offsets to frames, `mapCell` must read them — today `mapPointF` ignores `frame.shift`
  (`LevelMap.js:897-903`) and so does the map.
- **Scenes / thumbnails**: `snapshotView` becomes a priority-5 job with a budgeted off-camera read (D5), and can
  scale from cached level plates when they cover the rectangle (R25 W6).
- **The save format**: none (the levers are not in the document, §8).

---

## 12. leastSure

1. **Whether the image cliff is per canvas flush or per frame.** E6 shows a synchronous ~26 ms step per 33
   distinct scaled images *on one canvas*; if drawing into the offscreen surface pays it separately, the surface
   path's recompose costs one step per level change and the per-frame blit none; if the budget is per frame
   across canvases, the surface does not save it. Headless showed the step; the magnitude in Kobin's GPU Chrome
   was 10× larger (264 ms). Not measured: the offscreen case.
2. **The bounded stretch at S = 3 (up to 5.7× magnification mid-gesture).** The arithmetic is clear (E3); whether
   Kobin finds a 5.7× blur during a zoom better than 3.4× the plates is a feel judgement nobody has made.
3. **The inline constants** (0.73 µs an edge, 34 ns a pixel, 0.15 ms a cell) come from the desktop records; node
   here is 3–4× faster, a phone slower. Online calibration is designed, not measured; until it is, a phone may
   take the inline path for a rest render that costs 20 ms.
4. **The worker rest's quiet (100 ms) against PLAN's "one frame".** The churn argument is from PP's halting-zoom
   numbers, not from a run of the new code.
5. **The group commit for pen-up on dense drawings**: holding the SVG path until the whole rectangle is exact may
   make the handoff visibly later than today's per-cell release (97, 77, 55 ms measured in PP §10.11); unmeasured.
6. **The family-routing footprint (§3.7)** is reasoned from the packer's code (routing and sign decided over the
   whole family, `rasterPack.js:940-946`), not measured: how many bytes a routing flip changes in a family's
   untouched pieces is unknown, and if it is always within a tie the rule is dead weight.
7. **A2's interface**: read at 00:12 from its §0–§2 (its §3, the interface A3 builds on, was not written yet).
   `covers`, `snapshot`, `hold`/`setDragDelta` and `track`/`dirtySince` match what §4.2 and §6 need; the pending
   item (Q7) and the family routing footprint (Q15) are asks A2 has not answered.

---

## 13. Questions, each with my recommendation

1. **Q1 — level numbering and the crossing's sign.** Levels numbered finer = larger (`Z = 2^(ℓS)`), and PLAN §1.2
   / R25 §4.1 corrected from "L − 12/LEVEL_STEP" to **"ℓ + 12/S"**, with the integrality condition `ℓS ≥ −8`
   written beside it? **Recommend yes** (E2 checked the corrected form to the bit).
2. **Q2 — the stretch band for S > 1.** PLAN's symmetric `[2^−S/2, 2^S/2)` (77 / 135 plates at S = 2 / 3 on the
   desktop) or the bounded `[σmin, σmin·2^S)` (40 at every S, more blur)? **Recommend bounded**, σmin = 2^−½,
   adaptive on screens that need more than 48 plates.
3. **Q3 — the rest trigger.** One still frame for the inline executor, but `REST_QUIET_MS` (100 ms) before posting a
   worker rest set? **Recommend yes**: the worker case is the settle's churn otherwise.
4. **Q4 — the rest set through a pan.** Keep rest plates across a pure pan (Z unchanged) instead of "discarded by
   any move"? **Recommend yes**; a lateral frame shift still discards.
5. **Q5 — the lookup order.** Freshness before resolution: fresh (own; other frame) → fresh finer → fresh coarser
   → stale with fresh patches over its dirty rectangles → stale → paper, instead of PLAN's "stale at L" second?
   **Recommend yes**; it is decision 2 made exact.
6. **Q6 — the ring.** The ring at ℓv − 1 by default (a quarter of the pixels, twice the margin), at ℓv only at rest
   within budget, instead of first at ℓv? **Recommend yes**.
7. **Q7 — pen-up.** The new stroke (and a new mark) out of the plates until its shape bakes — A2 §2.8's
   `finalize` row changed from "packable, footprint after" to "pending until `bakeShapeById`, then footprint
   after" — then one rectangle re-render and a group commit that removes the SVG path in the same task?
   **Recommend yes** (ends D-3 and the clipPath).
8. **Q8 — lever persistence.** localStorage per device with a URL override; never the canvas record? **Recommend
   yes**.
9. **Q9 — landing a patch.** The GPU merge through one scratch `OffscreenCanvas` (+1 MiB total) over canvas-backed
   plates or kept pixel buffers? **Recommend the merge** (E6: correct, 0.5 ms median headless).
10. **Q10 — where coalescing lives.** In the engine (camera per event, one frame per rAF, `cfg.frames` and `flush()`
    for tests) rather than the hook? **Recommend the engine**.
11. **Q11 — W1.** The scale HUD as its own component on an `onZoom` subscription, and the page's `onStatus` throttled
    at 100 ms with no bypass? **Recommend yes**.
12. **Q12 — the camera's tile read.** Cache-only reads while moving, bakes at idle a tile a slice, the partial read
    API in B-PYRAMID (or B-SCENE, whichever owns TileStore's surface), and the resumable per-tile bake cursor as a
    separate measured item? **Recommend yes**; the cursor is what finally removes the crossing stall.
13. **Q13 — H4.** "Never both": the selection is translated only where its start footprint has a BELOW source (any
    cached BELOW plate or an affordable main-thread BELOW stopgap), else it stays in place with the ants moving?
    **Recommend yes**.
14. **Q14 — D1.** Grow only the SEL layers by one screen (BELOW and OVER stay on the view's cells)? **Recommend
    yes**; growing all layers is 9× the area for no pixel.
15. **Q15 — dirtying rules for A2.** Beyond A2 §2.8's table: an `add` or `remove` that changes a family's union
    routing, winding sign, alpha or colour dirties the family's whole box, not only the piece's? **Recommend yes**,
    measured first (leastSure 6); A2's picture-preserving cut (no footprint) adopted in place of my `visual` flag.
16. **Q16 — the harness.** Make "max distinct images per compose" and compose script ms harness metrics, and correct
    `browser-check.js:13-14` (headless does see the cliff's step)? **Recommend yes**.

---

## Appendix — the experiments

All under `/tmp/claude-0/-home-user-bound-less-kk-private/b82730e6-76c1-5a46-a465-56b24d35c928/scratchpad/a3/`,
bundled with the repo's esbuild (`npx esbuild <entry> --bundle --platform=node --format=cjs`) and run on Node 22,
except E6 (Playwright 1.56, Chromium 141 headless, SwiftShader). Nothing in `src/` was touched; the clip core is
an unimported copy.

| | what | numbers |
|---|---|---|
| **E1** `core/make-clip-core.py`, `core/e1-clip.entry.js` | a copy of `rasterCore.js` with a clip box (two variants) vs the shipped core, random 150-item plates, 6 random clips a plate, 4 configurations × 40 plates | rows-restricted, x unfolded: **0 differing bytes in 960 clips**, 0 outside the clip touched; seed 4242 × 12 plates: 0 in 288. x folded at the clip: **129 bytes in 960 clips** differ by 1 (2 on transparent plates) |
| **E1c** `core/e1c-cost.entry.js` | cost of a whole plate vs centred clips, by content class | §3.1's table; whole plates 5.2–27 ms on fills, 404 ms on 60 bands |
| **E2** `e2-crossmap.entry.js` | the integer cross-frame map vs `LevelMap.mapPointF`/`frameFactor` | paths ≤ 3 steps: 3,036 corners, 0 mismatches; 4 steps: the float affine rounds at plate indices ~2^43 |
| **E3** `e3-platecount.entry.js` | plates a view needs under nearest vs bounded bands, S = 1–3, three screens, 200,000 states each | §1.3's table |
| **E6** `e6-compose.cjs` | compose ms vs distinct bitmaps (scaled and 1:1); the layer path; the GPU merge | 33 → 34 scaled bitmaps: 0.1 → 26.3 ms JS (1:1: 0.1 → 6.3), 80: 52 ms; merge 0.5 ms median / 6.3 max, correct; `OffscreenCanvas.transferToImageBitmap` present |
