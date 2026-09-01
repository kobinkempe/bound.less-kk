# The "cut the tile out of the parent" refactor — DONE

**State: complete and green. 966 tests, 54 suites, one deliberate failure (PR-4).
Uncommitted, on `main`.** Written 2026-08-06.

The design record lives in `docs/erase-tile-window-design-bible.md` §2.6 and §3.2 — read
that for the reasoning. This file is the short version of what changed and what to watch.

---

## 1. What changed

Kobin's call: when an erase re-homes, **cut the ceded tile out of the parent's geometry**
instead of leaving the parent whole and recording a `windows` rect subtracted at render
time.

The rationale that had blocked it was in `derive.js` — "an erase below an object's home
cannot be baked into it, Clipper's grid would round the hole away." True of the **erase**;
false of the **tile**, which is 12.8 parent units, 1/3000 of the parent's own frame. That
distinction is the whole basis of the change.

All four defects that motivated it are closed, and three were verified in the browser
rather than only in jest:

| defect | outcome |
|---|---|
| 1. `ownContent` staleness on in-level zoom | **fixed.** 10 fast-path zoom steps, ONE render, hole 2→4→6→10→18→34→64 px. Before: frozen at the first size. |
| 2. `ownContent` re-derive cost (232–386 ms renders) | **fixed by deletion** — nothing is re-derived per view. |
| 3. `_axisSplit` declining any non-straight cut | **fixed by deletion** — severance is re-labelling now, not a second cut. |
| 4. hairline outline round every erase | **fixed**, but not where expected — see §3. |

---

## 2. Where the work landed

* **`geometry/cede.js`** — `cedeRect(rings, hole)` cuts a rect out of ink, float-exact,
  and returns the survivors grouped into connected pieces. Three separate connectivity
  traps, all measured, all pinned (`cede.test.js` CD-1…CD-7): a cell is not a chunk, a
  ring is not a chunk (Sutherland–Hodgman's zero-width corridors), and the bias is
  deliberately toward not splitting.
* **`geometry/clipperOutline.js`** — `localFrame()` (the lattice is local and snapped, so
  precision no longer falls off with pan distance) and a **subject pre-union** in
  `subtractPolys`, without which every deep-erased object shattered into one native per
  guillotine cell at the next ordinary erase.
* **`Document`** — `cedeTileById` replaces `eraseRehomeById`; `windows`/`srcId` are gone
  from the model, the format and the loader. `eraseReplaceById` keeps the family key
  across a one-region replace.
* **`KobinEngine`** — `_bakeRehome` cuts the parent at each step; `_familyMembers` /
  `_familyComponents` / `_resplitFamily` replace `_severPlan` / `_applySever` /
  `_axisSplit` / `_paintedComponents` / `_windowFor` / `_homeFor` / `_rekeyBelow`.
* **`TileStore.ownContent`** is a plain read of the frame's natives.
* **`Renderer`** — a family's fill pieces render as ONE path (§3).
* **`scenes` filter** now tests `attachRect`, not the deleted `srcId`.

---

## 3. The one that was NOT where I expected it

Defect 4 (the hairline) survived the refactor and changed shape. The cut is exact, so the
parent and its child **abut with no overlap at all**, and two opaque SVG paths meeting
like that antialias independently — measured in the browser, an interior pixel lifted
**18–25 % toward white** at every in-level zoom, right down the tile edge.

The fix is not an overlap. An overlap has to be sized against the view, which is precisely
what the old `2/enter` pad did and why it was 2.0 px at `inScale` 300 and 0.19 px at
`inScale` 27.9. The Renderer now draws a family's fills as one path with several subpaths,
which accumulates coverage before compositing. Seam gone at every zoom measured.

One conditional: a down-piece **actually** inside the cull ramp keeps its own group, since
opacity lives on the group. The test is the fade VALUE — every down-piece carries a
`fadeTag`, it is a size and not an alpha, and testing for the tag's presence kept an 11 px
child out of its family at every zoom where it was plainly visible.

---

## 4. Still open

* **PR-4, red on purpose — and much smaller than it first looked.** A baked cut is stored
  as a flat polygon. The tempting measurement (deviation from the ideal curve: 0.09 px at
  the level of the cut, 280 px one crossing down) is the WRONG quantity — see bible §8.1.
  Zooming into a curve makes the visible arc straighter, so one crossing down both the
  curve and the frozen polygon are dead straight (the curve bows 0.0025 px across a
  screen; one chord spans 550 screens). What is visible is the corner between chords,
  which is an ANGLE and therefore depth-independent: measured **0.14° median, 0.36° max**,
  i.e. 2-5 px across an 800 px screen, one faint bend every few hundred screens.
  Closing it is a tolerance change (turn angle goes as `sqrt(tol)`, so 5× smaller costs
  ~5× the vertices), not an architecture change. Kobin's call. The base cost is already
  worth knowing: a 41-point stroke nicked anywhere becomes **2,203 vertices**, because the
  whole silhouette freezes, not just the cut.
* **§5.1, position as per-level offsets.** Untouched, and unrelated to the erase.
* `cedeRect` under-severs interlocking lumps inside a single guillotine cell — deliberate,
  documented in §8.1, and the opposite bias to `_familyComponents`, which is exact.

---

## 5. Measurements worth not re-deriving

* **Lattice vs pan distance**, rounding error at the level's deepest zoom, before → after:
  0 units: 0.07→0.07 · 1e5: 0.26→0.07 · 6e5: 0.67→0.07 · 4e6: 3.70→0.07 · 2e7: **137→0.07 px**.
  Also caused "the shape changed where I didn't touch it" — a boolean re-quantizes its
  whole subject, so cutting one end moved the other.
* **Eraser flatten tolerance**: erasing a magnified object flattened the eraser at the
  target's tolerance — **155,000 ms → 585 ms** for one gesture.
* **Tile straddle**: ceding only the tile the erase's corner fell in under-erased by
  **19.5 px against a 20 px eraser**.
* **Clipper does not merge abutting subjects**: three stacked rectangles → **4 regions**
  where the identical single rectangle → 2.
* **The seam**: interior pixels lifted 18–25 % toward white before the one-path fix; none
  after, at `inScale` 1, 4, 16, 64 and 256.
* **Fast-path zoom**: 10 steps, 1 render, hole 2→4→6→10→18→34→64 px.

---

## 6. Method notes that kept paying

* **A green suite is not sufficient evidence for this feature.** The 2026-07-28 attempt
  passed 458 tests and was still judged worse. Every defect this round that mattered was
  found by rasterizing or by Kobin using the app — none of them is visible to a geometric
  oracle, because they only exist at rasterization.
* **You can rasterize the app's own SVG from the page** and read pixels:
  serialize `document.querySelector("svg")`, load it as a data-URI `Image`, draw it into a
  canvas over white, `getImageData`. That is how the hairline was measured and how the fix
  was confirmed. Far better than a screenshot for this.
* **Observing through the browser can heal the bug you are chasing** — attaching changes
  the page layout, which resizes the canvas, which forces a full rebuild. Capture state
  before attaching, or drive the whole scenario in one script.
* **Measure, then mutation-test the test.** The nesting invariant in `erase.cede.test.js`
  W-2/W-3 was verified by flattening `_bakeRehome`'s chain and watching 7 tests go red;
  the same mutation slips past W-7/W-9, which is noted in that test so nobody assumes
  otherwise.
* Test-writing traps that each cost a cycle: `ascend(n)` reaches a LEVEL, not a view;
  `descend(n, sx, sy)` keeps only the frame point under (sx,sy); at depth a coarse object
  covers the whole canvas; **`inkRunY` reports a run the VIEWPORT truncated** — use the
  fitting check in `erase.deepsever.slow.test.js`.
* Probing the exact point an erase was centred on will find the chain's own sub-pixel hole
  every time, at any zoom. That is correct behaviour, not a bug; sample across instead.

---

## 7. Suite layout

`npm run test:quick` (no `*.slow.test.js`, ~45 s, 456 tests) ·
`npm run test:slow` (~290 s, 511 tests) · `npm run test:all`.

Servers: dev on :3000 (`preview_start` name `boundless`, `.claude/launch.json`), report
server on :3001 (`node tools/report-server.js`, writes `.kobin-reports/`).
