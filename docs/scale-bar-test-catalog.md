# Scale Bar — Acceptance Test Catalog

**Status:** design-time specs + automated implementation suite under `boundless/src/engine/scaleBar/`.  
**Authority:** [scale-bar-ruling-design-bible.md](./scale-bar-ruling-design-bible.md)  
**Build plan:** [scale-bar-ruling-implementation.md](./scale-bar-ruling-implementation.md) (locked L1–L12; **T-F1 / T-Z coalesced cases = target-mpp matrices per L1**, not visitation traces)

Each case: **id**, **title**, **setup**, **action**, **expected**, **maps-to-rule(s)**.

---

## Implementation suite

Automated Jest tests under `boundless/src/engine/scaleBar/` exercise the **real** ruling module API (imports from sibling modules / `index.js` — not the legacy `scaleBar.js` adapter). Legacy top-level suites (`scaleBar.test.js`, `*.ladderWalk.test.js`, `*.astroWalk.test.js`) are gutted stubs; see [`scale-bar-design-options/LEGACY-REMOVAL-NOTES.md`](./scale-bar-design-options/LEGACY-REMOVAL-NOTES.md).

| File | Covers (locked L + catalog) | Focus |
|------|-----------------------------|--------|
| [`membership.test.js`](../src/engine/scaleBar/membership.test.js) | bible §2 / Q2; **L9** owner priority | Five ladders; ultra omit `yd`/`mil`/`ld`/`R☉`/`R⊕`; related table; `stackForUnit(Qpc)` → SM |
| [`nice.test.js`](../src/engine/scaleBar/nice.test.js) | constraint 3 / 3a; T-IN-* | 1/32 inch fractions; 1/2/5; plain↔sci thresholds |
| [`resolve.test.js`](../src/engine/scaleBar/resolve.test.js) | **L1**, **L3**, **L4**, **L8**, **L9**; **I-01** prefer-≥1 promote; **L2 enter**; **ZS-02** m↔km / yd↔0.5 mi; ultra absorption; **ZS-01** dm session round-trip | Absolute `resolveReading`; handoffs; sticky `Qpc`; `computeScale` façade |
| [`userRange.test.js`](../src/engine/scaleBar/userRange.test.js) | **L5**, **L6**, **L7**, **L12**; **I-02/I-08/I-15** | `applyUnitPick` user bands; teardown; L6 highestPriority; no `pinMode` |
| [`rungs.test.js`](../src/engine/scaleBar/rungs.test.js) | **L10**; T-POP / T-SET; **I-03/I-04** membership tables | Related auto-show; popover/set-scale membership ≠ full catalog |
| [`logLength.test.js`](../src/engine/scaleBar/logLength.test.js) | **L11** | Log-length round-trip; extreme mpp no-throw; bar bounds |
| [`testSupport.js`](../src/engine/scaleBar/testSupport.js) | (helpers) | Cold/probe sessions, `mppForReading`, overlap mpp |

**Run (from `boundless/`):**

```bash
npm test -- --watchAll=false src/engine/scaleBar
```

**Deferred:** full T-POP-6b…6e / T-SET-7c–7d matrices; UX T-R9-01.

---

## A. Core rules 1–9

### T-R1-01 — Extreme zoom-out past Qpc
- **Setup:** Scale defined; HUD on `Qpc` at 5000.
- **Action:** Zoom out by many decades (mpp × 10^6+).
- **Expected:** Reading stays finite, bar in bounds, sci notation on ceiling unit (or documented successor); no NaN/Infinity.
- **Maps-to:** 1, 2, 3

### T-R1-02 — Extreme zoom-in past qℓP
- **Setup:** HUD on `qℓP` decimal/sci floor.
- **Action:** Zoom in by many decades.
- **Expected:** Sci sub-Planck readings; bar in bounds; no crash.
- **Maps-to:** 1, 2, 3

### T-R2-01 — Bar always within bounds during smooth zoom
- **Setup:** Anchor `1 in` at 120 px; standard imperial.
- **Action:** Zoom out then in across land + astro with fine steps.
- **Expected:** Every frame `BAR_PX_MIN ≤ barPx ≤ BAR_PX_MAX` (or redesign’s documented bounds).
- **Maps-to:** 2

### T-R3-01 — Nice 1/2/5 only (non-inch)
- **Setup:** True-metric sticky; start `1 mm`.
- **Action:** Zoom out through `mm → cm → dm → m`.
- **Expected:** Values only in {1,2,5}×10^k within plain band; decade hop to `1` of next unit when preferred.
- **Maps-to:** 3, 4

### T-R3-02 — Plain band .001–5000 then sci
- **Setup:** Unit with wide within-rung range (e.g. `Qpc` or redesign ceiling).
- **Action:** Zoom out through 1…5000 then beyond.
- **Expected:** Plain labels through 5000; then sci with 1/2/5 mantissas. Constants adjustable.
- **Maps-to:** 3

### T-R3a-01 — Inch fraction chain includes 1/32
- **Setup:** Imperial; HUD `0.25 in`.
- **Action:** Zoom in stepwise through fractions **or** enumerate inch nice magnitudes in the fraction region.
- **Expected:** Grammar visits `1/8`, `1/16`, `1/32` (labels), then decimals at/below `.01`. On **standard imperial auto walk**, `1/32` is **not** preferred (`bandHit`) — mil owns that band; handoff is **`50 mil` ↔ `1/16 in`** (§5 owner).
- **Maps-to:** 3a, §5

### T-R3a-02 — After 1/32, decimals at .01
- **Setup:** HUD at `1/32 in` (grammar / user pick), or nice window below `1/16`.
- **Action:** Zoom in further while still on inches (if mil not yet preferred).
- **Expected:** Next inch readings use decimal form at `.01` band (not new fractions); auto preference may already be on mil.
- **Maps-to:** 3a, §5

### T-R4-01 — Stay on current ladder
- **Setup:** Sticky true-metric at `5 dm`.
- **Action:** Zoom out/in across shared units (`mm`, `km`, `Qpc`).
- **Expected:** `stack` remains true-metric; no flip to `R☉` / standard-only rungs.
- **Maps-to:** 4

### T-R4-02 — Preferred range beats larger same-ladder alternative
- **Setup:** Standard imperial; zoom where both `500 ft` and `200 yd` fit bounds.
- **Action:** Auto choose reading.
- **Expected:** Prefers `yd` in 200–500 band over `500 ft` (per owner example).
- **Maps-to:** 4

### T-R4-03 — Prefer 1 next unit over 10 current
- **Setup:** `10 in` exhausted; `1 ft` fits bounds.
- **Action:** Zoom out one step.
- **Expected:** `1 ft`, not `yd` and not lingering invalidly on inches.
- **Maps-to:** 4, F1

### T-R5-01 — Cross-ladder pick switches to highest-priority ladder
- **Setup:** On ultra-standard imperial showing `ft`.
- **Action:** Pick `m` (exists on multiple metric ladders).
- **Expected:** Current ladder → **standard metric** (highest preference among owners of `m`); no spurious user range if `m` is preferred there (constraint 5 rule 3).
- **Maps-to:** 5, Q5

### T-R5-02 — Non-preferred pick creates user preferred range
- **Setup:** Auto would show `1 µm`; user picks `in`.
- **Action:** Continue zooming within the implied inch band.
- **Expected:** User range from **quantized nice** at install through far edge `10 in` (L5/L12; ≈ `10⁻⁵`–`10⁻⁴ in` nice, not raw `2e-5`); inches preferred until teardown (L7 / L6 / ladder switch / I-02 range exit).
- **Maps-to:** 5, L5

### T-R5-03 — User range teardown on in-range unit change (L7 → then L5 if non-preferred)
- **Setup:** User range `200 yd`–`5000 yd` active; HUD `300 yd`.
- **Action:** Pick `ft`.
- **Expected:** Entire user yd range cleared (L7); then normal pick — at 300 yd zoom `ft` is not auto-preferred, so L5 installs a fresh ft user range (bible wins). Feet reading on sticky standard-imperial.
- **Maps-to:** 5, L7, L5

### T-R5-04 — Ladder switch invalidates prior user range
- **Setup:** User inch range active on current ladder.
- **Action:** Pick `cm` (forces metric ladder) when `cm` is **not** the preferred auto unit there.
- **Expected:** Prior user inch range gone; new user preferred range created on the destination ladder for `cm` (to that unit’s **normal far edge**).
- **Maps-to:** 5, Q5

### T-R5-05 — Preferred-on-other-ladder only switches ladder (L6)
- **Setup:** True-metric at `5 hm`.
- **Action:** Pick `m`.
- **Expected:** Switch to standard metric (always `highestPriority(preferredLadders)`, I-15); **no** new user preferred range.
- **Maps-to:** 5, L6, I-15

### T-R5-06 — Off-ladder pick creates user range on new ladder
- **Setup:** Sticky standard metric at a zoom where auto shows e.g. `1 cm`; user picks `ft` (not on current ladder).
- **Action:** Resolve pick; then zoom within the implied feet band.
- **Expected:** Ladder → highest-priority owner of `ft` (standard imperial); **user preferred range** installed on that ladder from quantized nice to the unit’s **normal far edge** (`ft` → 500 on standard imperial = band hi here); feet stick while inside that user range.
- **Maps-to:** 5, Q5, L12

### T-R5-07 — Normal far edge defines user-range extent (I-07)
- **Setup:** Any ladder; pick a non-preferred unit that has a documented far edge (may exceed §5 preferred hi — e.g. `mi` → 2000, `yd` → 5000).
- **Action:** Build user preferred range.
- **Expected:** Range extends from quantized nice to **`userBandFarEdge`** (L12), not necessarily the standard preferred-band hi alone. Standard preferred bands remain for auto `bandHit` only.
- **Maps-to:** 5, Q5, L12, I-07

### T-R6-01 — Popover never lists current unit
- **Setup:** HUD `2 ft`; open popover rung 1.
- **Action:** Inspect options.
- **Expected:** `ft` absent; units sorted small→large.
- **Maps-to:** 6

### T-R6-02 — Empty rung skips
- **Setup:** Construct zoom where rung N adds no new units vs prior.
- **Action:** Click **more**.
- **Expected:** Advances until new units appear or table.
- **Maps-to:** 6

### T-R6-03 — >12 units flips to table
- **Setup:** Deep more level that would exceed 12 chips.
- **Action:** Open that rung.
- **Expected:** Full-name table; trailing **more** if still truncated.
- **Maps-to:** 6

### T-R7-01 — Set-scale first rung mm–mi ultra-standard
- **Setup:** Open Set scale dialog, moreLevel 0.
- **Action:** List units.
- **Expected:** Ultra-standard units from `mm`…`mi` only (metric+imperial ultra everyday band); ≤22 chips.
- **Maps-to:** 7a

### T-R7-02 — Set-scale second rung all ultra-standard
- **Setup:** Dialog more once.
- **Expected:** All ultra-standard imperial ∪ metric rungs (`ℓP`…`pc` both sides as defined).
- **Maps-to:** 7b

### T-R7-03 — Set-scale table only above 22
- **Setup:** Rung that yields ≤22 units.
- **Expected:** Chip grid, not table. Rung with >22 → table.
- **Maps-to:** 7

### T-R7-04 — Save sets initial ladder by priority
- **Setup:** Pick `AU` (multi-ladder) and save.
- **Expected:** Current ladder = highest priority owner (standard metric).
- **Maps-to:** 7, 5

### T-R8-01 — Constants are data
- **Setup:** Design/code review after implementation.
- **Action:** Change preferred `ly` max 500→5000 for ultra-standard only.
- **Expected:** No core walk rewrite; behavior changes via config.
- **Maps-to:** 8

### T-R9-01 — UX chrome unchanged
- **Setup:** Manual UI pass.
- **Expected:** Same HUD, Clear, Set scale drag, flat popover+more, no new badges.
- **Maps-to:** 9

---

## B. Failure-mode regressions

### T-F1-01 — Coarse zoom from 10 in visits feet
- **Setup:** Target mpp where `1 ft` and `10 in` both fit (L1 target-mpp; not a visitation trace).
- **Action:** Cold `resolveReading` / single `computeScale` at that mpp.
- **Expected:** **`1 ft`** (I-01 promoteNextGe1), not `10 in`; before any `yd`/`mi`.
- **Maps-to:** F1, 4, T-Z, L1

### T-F1-02 — Wheel-burst simulation from inches
- **Setup:** Reach `10 in` with fine steps; apply large Δzoom to a feet-scale target mpp.
- **Expected:** Lands on `ft`, not `yd` (target-mpp per L1).
- **Maps-to:** F1, F6, L1

### T-F2-01 — dm pick from cm; teardown on exit (S2 / I-02)
- **Setup:** True-metric HUD `cm`; pick `dm` (installs userBand).
- **Action:** Zoom out past the user range (e.g. to `Qpc`); zoom back to ~`1 cm`.
- **Expected:** After exit, `userBand === null`; zoom-back lands on **`cm`/`mm`**, not sticky `dm`.
- **Maps-to:** F2, 5, I-02, I-08

### T-F2-02 — Far pick must not Planck-jump on release
- **Setup:** From `in`, far-pick `mi`; zoom until far pin releases.
- **Expected:** Continues on imperial (or sticky stack) near miles/land band — not Planck.
- **Maps-to:** F2, F4, F5

### T-F3-01 — Qpc stickiness on true-metric
- **Setup:** Enter true-metric via `dm`; zoom to `Qpc`; zoom back.
- **Expected:** Stack remains true-metric; never `R☉`/`Tpc`.
- **Maps-to:** F3, 4

### T-F4-01 — Preference promotion does not clear displayStack
- **Setup:** Sticky true-metric; zoom out across a preferred-range handoff (redesign: no separate minUnit lock).
- **Action:** Persist any floor/preference meta write if present.
- **Expected:** `displayStack` unchanged; no flip-flop from missing hysteresis (preferred ranges provide stickiness).
- **Maps-to:** F4, Q4

### T-F4-02 — Far-pin release keeps sticky stack
- **Setup:** Far pin on `mi` with `displayStack` standard-imperial.
- **Action:** Release condition met.
- **Expected:** Pin cleared; stack still standard-imperial.
- **Maps-to:** F4

### T-F5-01 — Null previousHud after far pick recovers safely
- **Setup:** Far pick clears walk state (as-built) or redesign equivalent.
- **Action:** Zoom moderately.
- **Expected:** Deterministic land-band reading; no Planck.
- **Maps-to:** F5, F7

### T-F6-01 — Test harness includes coalesced jumps
- **Setup:** CI suite.
- **Expected:** At least one automated case with Δzoom ≫ fine step (document factor).
- **Maps-to:** F6

### T-F7-01 — Cold start demotes when anchor bar too large
- **Setup:** Anchor `1 in` but effective zoom makes `1 in` ≫ max bar; no previousHud.
- **Action:** `computeScale`.
- **Expected:** Finer unit/value chosen; not stuck on oversized anchor.
- **Maps-to:** F7

### T-F8-01 — 1/32 present in inch nice grammar (not auto-preferred on SI)
- **Setup:** Imperial inches; nice / candidate pool.
- **Action:** Enumerate fraction-region nice magnitudes; separately auto-walk mil↔in.
- **Expected:** Grammar includes `1/32` (F8 / 3a). Auto preferred band is **`1/16`–`1`**; mil↔in handoff visits **`1/16`**, not `1/32`, before mil.
- **Maps-to:** F8, 3a, §5

### T-F10-01 — No stack-pin without pinned unit
- **Setup:** API/contract test.
- **Expected:** Cross-ladder pick always supplies pinned unit or explicit user-range state; no null-pin stack mode.
- **Maps-to:** F10

---

## C. Ultra-standard ladders

### T-U-01 — Ultra-standard metric inventory
- **Setup:** Ladder constant.
- **Expected:** Ascending `ℓP, fm, pm, nm, µm, mm, cm, m, km, AU, ly, pc` only.
- **Maps-to:** §2 ladders

### T-U-02 — Ultra-standard imperial inventory
- **Expected:** Ascending `ℓP, fm, pm, nm, µm, in, ft, mi, AU, ly, pc` only (no `yd`/`mil`/`ld`/`R☉`/`R⊕` on this ladder).
- **Maps-to:** §2 ladders, Q2

### T-U-03 — Ultra-standard ly preferred to 5000
- **Setup:** Sticky ultra-standard metric; zoom through ly.
- **Expected:** Prefers ly through 5000 before pc (vs standard ly≤500).
- **Maps-to:** §2 notes, 4, §5

### T-U-04 — Priority places ultra below standard
- **Setup:** Unit shared by standard metric and ultra-standard metric (e.g. `km`).
- **Action:** Resolve ladder with no sticky stack.
- **Expected:** Standard metric wins.
- **Maps-to:** §2 priority, 5

### T-U-05 — Related map wiring
- **Setup:** Current = ultra-standard imperial.
- **Expected:** Related = ultra-standard metric + standard imperial for popover 6a/6b/6c.
- **Maps-to:** related table, 6

### T-U-06 — Ultra-standard ft absorbs yd then → mi when 0.25 mi fits (L4)
- **Setup:** Sticky ultra-standard imperial; zoom out through land band.
- **Action:** Auto walk past everyday feet into the thousands.
- **Expected:** Stays on `ft` through preferred `2`…`5000` (no `yd`); **any in-band mi beats ft** once that mi stop is in the pool. **Earliest cutover:** when **`0.25 mi` fits**. Nearer 5000 ft, while `0.25 mi` is out of bar, `0.5` / `1 mi` may still win over ft if those stops fit.
- **Maps-to:** §5 ultra-imperial, Q2, 4, L4

### T-U-07 — Ultra-standard no mil; inches absorb fine side
- **Setup:** Ultra-standard imperial; zoom in from `1 in` through fractions.
- **Expected:** Preferred lo is **`1/16`**; grammar still has `1/32` / `.01 in`. Next finer preferred unit is `µm` (or finer ultra rung), never `mil`.
- **Maps-to:** §5 ultra-imperial, Q2, 3a

### T-U-08 — Ultra-standard AU → ly (no ld)
- **Setup:** Ultra-standard metric at large `AU`.
- **Action:** Zoom out until ly preferred.
- **Expected:** Promotes to `ly` without visiting `ld`.
- **Maps-to:** §5 ultra-metric, Q2

### T-U-09 — Ultra-standard pc ceiling absorbs kpc…
- **Setup:** Ultra-standard; zoom out past `500 pc`.
- **Expected:** Remains on `pc` through `5000` then sci on `pc` (no `kpc`).
- **Maps-to:** §5 ultra, 3

---

## D. Sticky ladder + preferred ranges

### T-P-01 — Standard imperial land walk visits ft
- **Setup:** Start `1 in`; zoom out to miles.
- **Expected:** Sequence includes feet before yards/miles.
- **Maps-to:** 4, F1

### T-P-02 — User range outranks standard band
- **Setup:** User yd range 200–5000; zoom where standard would prefer mi.
- **Expected:** Stays on yards while inside user range.
- **Maps-to:** 5, 4

### T-P-03 — ft preferred band 2–500 (standard imperial)
- **Setup:** Auto standard imperial; no user range.
- **Action:** Zoom across feet.
- **Expected:** Prefers feet for magnitudes in `2`…`500` when competing with neighbors; at overlap with `200`–`500 yd`, prefers yards over `500 ft`.
- **Maps-to:** 4, §5

### T-P-04 — pc preferred 200–500 (standard)
- **Setup:** Astro region on standard metric.
- **Expected:** Prefers pc in 200–500 over premature kpc when both fit.
- **Maps-to:** 4, §5

### T-P-05 — m preferred through 500 before km (standard metric)
- **Setup:** Standard metric; zoom where both large `m` and `1 km` could fit.
- **Expected:** Prefers `m` in `1`…`500` band; hands off toward `1 km` per prefer-≥1 when appropriate.
- **Maps-to:** 4, §5

### T-P-06 — yd preferred 200–500 over 500 ft
- **Setup:** Standard imperial; zoom where both `500 ft` and `200 yd` fit bounds.
- **Action:** Auto choose reading.
- **Expected:** Prefers `yd` in 200–500 (same as T-R4-02; catalog cross-check against §5).
- **Maps-to:** 4, §5

### T-P-07 — Anti-flicker without separate minUnit lock
- **Setup:** Near a preferred-range handoff (e.g. `ft`↔`yd` L3, or ultra `ft`↔`mi`).
- **Action:** Small zoom in/out noise around the boundary; also verify L2 enter ~5% past incumbent band edge before band/prefer release.
- **Expected:** No rapid flip-flop; stickiness from preferred ranges (Q4) + L2 enter/exit; handoff/promote still win immediately (enter must not block L3/L4). No separate `minUnit`/`minUnitZoomAt` lock.
- **Maps-to:** 4, 5, Q4, L2

### T-P-08 — Ultra-standard ft preferred through 5000; cutover at 0.25 mi (L4)
- **Setup:** Sticky ultra-standard imperial; no user range.
- **Action:** Zoom across land band through thousands of feet.
- **Expected:** Prefers `ft` for magnitudes in `2`…`5000`; cutover toward `mi` when **`0.25 mi` fits** (L4) — not only at 0.5/1 mi; not at 2000 ft.
- **Maps-to:** 4, §5 ultra-imperial, L4

---

## E. Popover rung membership (examples)

### T-POP-6a-01 — First rung around 2 ft
- **Setup:** Standard imperial HUD `2 ft`.
- **Action:** Open popover (rung 1).
- **Expected:** Includes related-ladder **auto-show** unit at this zoom (not merely log-distance peer), preference-discarded candidates, and within-50× neighbors (`in`, `yd`); excludes `ft`; sorted.
- **Maps-to:** 6a, Q3

### T-POP-6a-02 — Related peer for ultra-standard is auto-show
- **Setup:** Ultra-standard metric HUD `1 m`.
- **Expected:** Rung 1 includes the unit ultra-standard imperial would **auto-show** at this zoom (likely `ft` in land band — not `yd`, which is absent), plus preference-discarded / 50× candidates per 6a.
- **Maps-to:** 6a, Q3, related table

### T-POP-6b-01 — Second rung widens to any-ladder .1–500
- **Setup:** Same `2 ft`; click more once (after skip-empty).
- **Expected:** Adds units from any ladder that would read .1–500 at zoom; related within 50×; still excludes current.
- **Maps-to:** 6b

### T-POP-6c-01 — Third rung ±2 current / ±1 related
- **Setup:** HUD mid-ladder.
- **Expected:** Membership includes 2 up/down current + 1 up/down related + .1–500 any-ladder set.
- **Maps-to:** 6c

### T-POP-6d-01 — Fourth rung ultra + kpc + non-prefix
- **Setup:** Advance to rung 4.
- **Expected:** All ultra-standard units, `kpc`, and non-SI-prefix units present (union); may flip to table if >12.
- **Maps-to:** 6d

### T-POP-6e-01 — Fifth rung all units
- **Setup:** Final more.
- **Expected:** Full registry (table).
- **Maps-to:** 6e

---

## F. Set-scale dialog rungs

### T-SET-7a-01 — Everyday ultra band
- **Setup:** Dialog open, first rung.
- **Expected:** Units ⊆ ultra-standard and between `mm` and `mi` inclusive on those ladders (e.g. `mm,cm,m,km,in,ft,mi` — exact set per ultra inventories).
- **Maps-to:** 7a

### T-SET-7b-01 — All ultra-standard
- **Setup:** More once.
- **Expected:** Full ultra metric ∪ ultra imperial lists.
- **Maps-to:** 7b

### T-SET-7c-01 — µm–kpc plus non-prefix / true SI
- **Setup:** More twice; optionally preselect true-metric unit.
- **Expected:** All ladders’ units from µm…kpc; plus current-ladder non-prefix; if true-metric current, include SI-prefixed meters on that ladder.
- **Maps-to:** 7c

### T-SET-7d-01 — All units
- **Setup:** Final more.
- **Expected:** Complete table.
- **Maps-to:** 7d

---

## G. Coalesced zoom / large jumps

### T-Z-01 — Status flush on effectiveZoom
- **Setup:** Instrument `useKobinEngine` onStatus (or integration).
- **Action:** Rapid wheel changing only effectiveZoom.
- **Expected:** Each distinct effectiveZoom can update React status without waiting 50 ms throttle (as-built flush preserved or equivalent).
- **Maps-to:** F5, F6, 1

### T-Z-02 — Single large mpp jump does not skip ft
- **Setup:** `10 in` previous; target mpp corresponding to ~few feet.
- **Expected:** Result unit `ft`.
- **Maps-to:** F1, 4

### T-Z-03 — Bridge or durable walk across 10× mpp
- **Setup:** Previous land reading; 10× coarser mpp in one call.
- **Expected:** Monotonic unit sequence if sampled via bridge; final reading on correct preferred unit.
- **Maps-to:** F1, F5

### T-Z-04 — Zoom-in large jump demotes without skip
- **Setup:** `2 mi` → large zoom-in toward feet.
- **Expected:** Does not jump to mil/Planck; passes yd/ft/in as preferred.
- **Maps-to:** 4, F7

---

## H. Inch fraction chain

### T-IN-01 — Whole inch zoom-out 1→2→5→10→1 ft
- **Setup:** `1 in` anchor.
- **Action:** Fine zoom out.
- **Expected:** Sees 1,2,5,10 in then 1 ft.
- **Maps-to:** 3, 3a, 4

### T-IN-02 — Zoom-in 1 → 1/2 → 1/4 → 1/8 → 1/16 → 1/32
- **Setup:** `1 in`.
- **Action:** Zoom in (grammar / candidate pool).
- **Expected:** Fraction chain including **1/32** in nice grammar. Auto preferred band still starts at **`1/16`**; standard-imperial auto walk hands off mil ↔ `1/16`, not via preferred `1/32`.
- **Maps-to:** 3a, F8, §5

### T-IN-03 — Mil bridge after finest preferred inch
- **Setup:** At `1/16 in` (preferred) or grammar `1/32` / `.01 in`.
- **Action:** Zoom in until mil preferred.
- **Expected:** Enters `mil` nice ladder without skipping to metric Planck; preferred bridge is **`1/16 in` ↔ `50 mil`** (handoff `in` over `mil`).
- **Maps-to:** 3a, 4, §5

### T-IN-04 — Labels for 1/8, 1/16, 1/32
- **Setup:** Fraction readings.
- **Expected:** `displayLabel` (or equivalent) shows vulgar fractions for those three; decimals otherwise.
- **Maps-to:** 3a

---

## I. Cross-cutting smoke

### T-X-01 — Clear resets all preference state
- **Setup:** Sticky ladder + user range + pin.
- **Action:** Clear.
- **Expected:** Zoom label only; no residual stack/range on next Set scale.
- **Maps-to:** 9, 5

### T-X-02 — Redefine scale resets display prefs
- **Setup:** Sticky true-metric; Set scale again with `in`.
- **Expected:** Ladder becomes imperial per priority; prior user ranges cleared.
- **Maps-to:** 7, 5, 9

### T-X-03 — Related ladders table completeness
- **Setup:** Data audit.
- **Expected:** All five ladders appear as keys; related lists match bible table exactly.
- **Maps-to:** §2 related table, 8
