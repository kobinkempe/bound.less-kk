# Scale Bar — Inconsistencies Register & Fix Proposal

**Status:** historical review fold-in; **I-08 / I-15 fixed in code**; **I-02 shipped as A-pool hybrid** (pool-exit **or** `tLog > logHi`; do not clear solely for `tLog < logLo`; `userHit` = any in-pool stop; keep B⁺ + A6) — prefer bible + implementation docs for current locks. Remaining items below may be stale.  
**Path:** `boundless/docs/scale-bar-design-options/INCONSISTENCIES-AND-FIX-PROPOSAL.md`  
**Authority:** [`scale-bar-ruling-design-bible.md`](../scale-bar-ruling-design-bible.md) (product constraints) + [`scale-bar-ruling-implementation.md`](../scale-bar-ruling-implementation.md) (locked L1–L12, architecture). Where they conflict, **locked L decisions win** until the bible tables are edited.  
**Code skimmed:** `resolve.js` (`keyFor`), `preference.js` (bands / `buildUserBand` / handoffs), `pick.js`, `rungs.js`, `nice.js` / `formatScaleNumber`, `constants.js`, `logMath.js` (`logBarBounds`), `ScaleUnitPicker.js`, `CanvasEditor.js` (`applyUnitPick`).

This merges **12 review tracks** (scenarios S1–S6 + bible audits B1–B6) into one deduped register, a resolution per item, an ordered implementation plan with concrete code targets, acceptance mapping, and an explicit defer list. Sign-off: **no REJECTs** (S4 APPROVE; all others APPROVE-WITH-GAPS). Gaps below are folded into the register and patches A–H.

---

## 0. How to read this doc

| Column | Meaning |
|--------|---------|
| **Id** | Stable inconsistency id (`I-*`) |
| **Sev** | `P0` must-fix before claiming F1/L4/L5/UI DoD; `P1` correct before polish; `P2` docs/hygiene; `Defer` intentional first-build skip |
| **Reviewers** | Which of the 12 tracks reported it (deduped) |
| **Resolution** | `fix code` / `fix docs` / `defer` — and the chosen product reading when docs conflict |

**Top 5 must-fix (summary):** `I-01` (1 ft unreachable — **not** 0.5 mi), `I-02`+`I-08` (userBand teardown **and** drop `band.lo` union — both required for S2), `I-03` (popover >12 membership table), `I-04`+`I-16` (set-scale >22 membership; ladder on **save**), `I-15` (L6 always `highestPriority(preferredLadders)`). See §5. Critical docs Patch A still includes `I-05` (L4 / T-P-08 / T-U-06) so implementers do not regress ultra cutover.

---

## 1. Deduped inconsistency register

### I-01 — `1 ft` unreachable on auto zoom-out (bandHit blocks prefer≥1)

| | |
|--|--|
| **Sev** | **P0** — **not deferrable** (bible F1 / constraint 4.3 / §5 “→ 1 ft”; catalog `T-R4-03`, `T-IN-01`, `T-F1-*`) |
| **Bible / L** | Constraint 4.3; §5 shared “Prefer ≥1 next unit”; §5 `in (whole) → 1 ft`; F1 |
| **Evidence** | `preference.js`: standard/ultra `ft` band **`[2, …]`** — `1` never `bandHit`s. `resolve.js` `keyFor`: `bandHit` (index 1) outranks `preferGe1` (index 4). While `10 in` still band-hits and `1 ft` fits, inches win; when inches leave bounds, first ft band-hit is **`2 ft`**. `HYSTERESIS_ENTER_PAST_EDGE` unused (does not cause this). |
| **Reviewers** | **S1**, **B2**, **B6** (L2 enter unused noted alongside). **Not B1** — B1 is format/grammar (I-10). |

**Scope boundary (sign-off):** Patch B / `promoteNextGe1` fixes **`1 ft` only**. The separate **`0.5 mi` vs yd** bandHit/prefer≥1 tie is **not** I-01 — see **§6 defer** (rationale below). Do not claim Patch B fixes mi/yd.

**Proposed resolution — FIX CODE (+ small doc clarify in Patch A)**

- Prefer bible §5 promote rule over a naïve reading of “bandHit always beats prefer≥1”.
- Add an explicit lexicographic key **`promoteNextGe1`** (name flexible) **above `bandHit`** (or demote the finer unit’s `bandHit` when the promote applies):
  - When a stop with `niceValue === 1` on the **next coarser rung** of the sticky ladder fits the bar, it beats any still-fitting band-hit on the finer unit (e.g. `1 ft` beats `10 in`; `1 m` beats large `cm` when that promote is intended).
  - Keep normal `bandHit` for same-unit / non-promote competition.
- Do **not** change owner `ft` standard band to start at `1` unless product revises §5 (`2 ft`–`500 ft` stays the *preferred magnitude while ft is preferred*; `1 ft` is the **handoff-in** via prefer≥1).

**Concrete code**

- `resolve.js` — extend `keyFor` (today roughly `[userHit, bandHit, handoffSuppress, incumbent, preferGe1, …]`). Insert promote key after `userHit`, before or as a modifier of `bandHit`.
- Optionally `preference.js` — export `promoteTarget(ladderId, fromUnit) → { unit, value: 1 }` table derived from §5 handoff notes (`in→ft`, `cm→m` on standard metric, etc.) so promote is data, not hard-coded unit names in `keyFor`.
- `resolve.test.js` — replace/extend the current “feet when large inches no longer fit” case (which already notes `2 ft` may win) with a **true 1 ft while 10 in fits** case.
- **Do not** add a “0.5 mi beats yd via promote” assertion under I-01.

**0.5 mi vs yd (LOCKED — implemented)**

| | |
|--|--|
| **Product reading** | Bible §5: **`yd → 0.5 mi` when 0.5 mi fits**. Implemented as handoff `mi` over `yd` on standard-imperial (plus L2 enter does not block handoff). Cold and walked resolves agree at the 0.5 mi target. |
| **Resolution** | **Implemented** — not deferred. L3 remains **`200 yd` over `500 ft`**; yd→mi is a separate handoff. |

---

### I-02 — Lingering `dm` `userBand` re-captures cm-scale on zoom-back (**teardown**)

| | |
|--|--|
| **Sev** | **P0** |
| **Bible / L** | L8 sticky ladder OK; constraint 5 persistence / L7 teardown; F2 spirit; L2 exit = leave full allowed bar range |
| **Evidence** | Core L8 sticky through `Qpc` works (`resolve.test.js`). After a non-preferred `dm` pick, `applyUnitPick` installs `userBand` via `buildUserBand`. Zooming away then back to cm-scale physical length can still `userHit` fractional/`dm` stops if `logLen` remains inside `{logLo, logHi}` **or** if the range was never torn down on exit. Docs/status still say “not yet implemented” in places while code exists. L8 tests do not cover the full dm-pick → zoom → zoom-back path. |
| **Reviewers** | **S2**, **B3** (user-range lifecycle) |

**Split from I-08 (blocking sign-off):**

| Id | Owns | Alone fixes S2? |
|----|------|-----------------|
| **I-08** | Drop `band.lo` union so range = pick↔far only (L5/B.7 literal) | **No** — narrower range helps, but without teardown a still-active band re-owns on re-entry |
| **I-02** | **Auto-clear `userBand`** when preferred unit leaves bar pool **or** `tLog > logHi` (A-pool hybrid; not solely `tLog < logLo`) | **Required** for S2 expected test |

**Proposed resolution — FIX CODE (+ FIX DOCS status)**

- **Chosen product reading (shipped A-pool hybrid):** Tear down `userBand` when the preferred unit has **no** in-bounds bar stop **or** `targetLogLen > logHi`. Do **not** clear solely because `tLog < logLo`. Tier-0 `userHit` = any in-pool stop of `userBand.unit`. Keep B⁺ install bar headroom + A6 write-back. (Historical Patch C preferred literal interval exit; that reading is superseded — see `STICKY-USER-PREFS-LIVE-FAILURE.md`.)
- **Do not** choose sticky re-entry (range survives exit and re-captures on zoom-back) — that fails S2: dm pick → Qpc → back to ~1 cm must land on **cm/mm**, not sticky dm.
- **Do not claim I-08 alone fixes S2.** Patch C must list teardown as its own concrete step.
- Update bible / implementation **status** lines (“docs only; not yet implemented”) to “as-built under `scaleBar/`” where true (`LEGACY-REMOVAL-NOTES.md` already says cutover complete) — via **I-14**.

**Concrete code**

- `preference.js` / `session.js` / `resolve.js`: `userBandShouldClear` — pool-missing **or** `tLog > logHi`; `userHit` = unit match in pool.
- `userRange.test.js` / new case: true-metric, pick `dm` at cm-ish mpp → zoom to `Qpc` → zoom back to `1 cm` target → expect **`cm`** (or `mm`), **not** fractional `dm`. Assert `userBand === null` after exit. Also **A-pool**: dm survives past B⁺ ~2× bar-min ceiling.
- `resolve.test.js` L8: keep sticky ladder; add companion pick-path test (not skip).
- I-08 formula change lands in the **same Patch C** but is a **separate step** — see I-08.

---

### I-03 — Popover `>12` jumps to full catalog table (skips membership table / intermediate rungs)

| | |
|--|--|
| **Sev** | **P0** |
| **Bible / L** | Constraint 6: if >12 units would display → full-name **table**; if still truncated, last row is **more**. Table is the **membership set at that depth**, not necessarily 6e. Never show current unit. |
| **Evidence** | `rungs.js` `popoverUnits`: sets `asTable` when `units.length > POPOVER_TABLE_AT`. `ScaleUnitPicker.js` on `showTable \|\| asTable` calls **`allUnitsTableRows()`** — entire catalog — and does **not** exclude `currentUnit`. `handleMore` forces `setShowTable(true)` when `nextIsTable`, skipping chip rungs that would have been intermediate. Related ±1 empty when `currentUnit ∉` related ladder (`ladderNeighbors`) — expected empty, but table path hides the issue. |
| **Reviewers** | **S6**, **B4** |

**Proposed resolution — FIX CODE**

- When `asTable`, render **`units` from `popoverUnits`** (membership at current effective level) as full-name rows, **excluding current unit** (already excluded in engine for chips; keep exclude in table UI).
- Only use `allUnitsTableRows()` at **6e** (or when membership === all units).
- Preserve **more** on the table when `hasMore` / next cumulative level adds units (bible: last row **more** if still truncated).
- Do not skip from mid-rung chip overflow straight to 6e catalog.

**Concrete code**

- `ScaleUnitPicker.js` — table branch: map `units` through `unitFullName` / `formatUnitSymbol`; pass `hasMore` + `onMore` into table footer; stop calling `allUnitsTableRows()` except for true 6e.
- `rungs.js` — optionally return `tableRows` / `isFullCatalog` flags; ensure `nextIsTable` means “next level is table-mode membership”, not “dump catalog”.
- `rungs.test.js` — map to catalog **`T-R6-03`** / **`T-POP-*`**: >12 at 6c/6d still excludes current; more advances; 6e only is full union.

---

### I-04 — Set-scale `>22` jumps to full catalog (kills More / skips 7c→7d)

| | |
|--|--|
| **Sev** | **P0** |
| **Bible / L** | Constraint 7: flip to full table only when >22; rungs 7a–7d cumulative; More units…; L9 on save |
| **Evidence** | Same pattern as I-03: `setScaleUnits` sets `asTable` / `showFullTable`; `ScaleUnitButtonGrid` with `showFullTable` uses **`allUnitsTableRows()`**, dropping intermediate 7c membership and More. Engine rung plans in `rungs.js` are OK. |
| **Reviewers** | **S6**, **B5** |

**Proposed resolution — FIX CODE**

- Mirror I-03 for set-scale: table shows **current rung membership** (`setScaleUnits().units`), not full catalog, until 7d.
- Keep More when `hasMore`.

**Concrete code**

- `ScaleUnitPicker.js` `ScaleUnitButtonGrid` — table body from `units` prop; CanvasEditor / dialog must pass membership units + `hasMore` instead of only `showFullTable`.
- Grep set-scale dialog wiring in `CanvasEditor.js` (or dialog component) for `setScaleUnits` / `showFullTable`.
- Tests: set-scale >22 membership ≠ full catalog; More advances 7c→7d.

**Ladder timing — see I-16** (product reading: “Selecting a unit sets initial ladder” = **on save** / L9, not live dialog preview).

---

### I-05 — Preference order / handoff vs incumbent / T-P-08 / T-U-06 vs L4

| | |
|--|--|
| **Sev** | **P1** (behavior mostly correct for L3/L4; docs + catalog cases wrong) |
| **Bible / L** | L3, L4, L2; implementation §B.6; bible §4 under-specified; T-P-08; **T-U-06** |
| **Evidence** | Code `keyFor`: `handoff` suppress before `incumbentHold` — **correct for L3/L4** (mi wins via L4 when 0.25 mi band-hits; `HYSTERESIS_ENTER_PAST_EDGE` unused). §B.6 table lists `incumbentHold` **before** `handoffWinner` — conflicts with code and with locked cutovers. Bible §4 omits explicit handoffs / still points at stale examples. **T-P-08** still says cutover when `1 mi` or `0.5 mi` wins — **superseded by L4** (`0.25 mi` beats ft when it fits). **T-U-06** (ultra ft absorbs yd then → mi) must match the same L4 product line. Ultra ft→mi via L4 is intended (**S5** OK at runtime). |
| **Reviewers** | **S5**, **B2**, **B6** |

**Product line — ultra ft↔mi unit-level handoff (lock in Patch A):**

- **Any in-band `mi` stop beats `ft`** once that mi stop is in the candidate pool (L4 / `HANDOFF_WINNERS`).
- **Earliest cutover:** when **`0.25 mi` fits** the bar.
- **Nearer 5000 ft:** while `0.25 mi` is **out of bar**, **`0.5` / `1 mi`** may still win over ft if those stops fit (still “any in-band mi beats ft”).
- Standard-imperial `mi` preferred band remains **`0.5–1`** (not L4); do not rewrite standard §5 mi cells to 0.25.

**Proposed resolution — FIX DOCS (code order keep)**

- Edit §B.6 priority table to match code: `userHit → bandHit → handoffWinner → incumbentHold → preferGe1 → …` (or keep incumbent below handoff and say so).
- Bible §4: add bullet for **explicit handoff winners** (L3/L4); move long magnitude examples to **§5 pointers** (avoid duplicating stale `0.5–1 mi` ultra cutover prose in §4).
- Update **T-P-08** and **T-U-06** / Opus notes: cutover when **`0.25 mi` fits** (L4), not 0.5/1 only; document nearer-5000 behavior above.
- Scrub bible §5 **owner-examples** prose that still says **`0.5–1 mi` for ultra cutover** → **`0.25 mi` (L4)**; leave **standard-imperial** mi **`0.5–1`** unchanged.
- **Defer** wiring `HYSTERESIS_ENTER_PAST_EDGE` (see §6 / I-12) — does not block L4.

---

### I-06 — L5 µm→in OK; bible example / “current size” vs quantized nice; CanvasEditor drops reading

| | |
|--|--|
| **Sev** | **P1** (path OK; docs + minor UI) |
| **Bible / L** | L5; constraint 5 example `2×10⁻⁵ in`–`10 in` |
| **Evidence** | `pick.js` + `bestInBoundsNice` + `buildUserBand` implement L5. Example magnitude is illustrative; live nice at bar bounds is ~`5×10⁻⁵` (or similar), not literally `2e-5`. Bible still says “from the **current size**”; L5 locks **quantized nice**. µm→in is filed under constraint 5 **rule 2** in places but is an **off-ladder / L5 rule 1** path. `CanvasEditor` `onPickUnit` keeps only `session` from `applyUnitPick`, ignores `reading` (HUD refreshed via `computeScale` — usually OK). Catalog **T-R5-02** OOM wording may still imply raw size / wrong bounds. |
| **Reviewers** | **S3** |

**Proposed resolution — FIX DOCS (+ optional tiny code deferred)**

- Bible constraint 5 / examples: “from the **quantized nice reading** (L5), not raw pre-nice size”; example → “≈ `10⁻⁵`–`10⁻⁴ in` (nice), through far edge `10 in`”.
- **Relocate µm→in** from constraint 5 **rule 2** → **rule 1 / L5** (off-ladder switch + user range).
- Patch A: update **T-R5-02** OOM wording to quantized nice → far edge (L5/L12), not raw “current size”.
- **Optional / defer (S1 optional):** CanvasEditor value-only `lastReading` seed from `applyUnitPick.reading` is **display-only** (L1); do not block P0. If landed, `setScaleSession({ ...next, lastReading: reading })` — Patch F.
- Confirm example files / cross-links sit under L5/L12, not wrong rule headings (**I-14**).

---

### I-07 — L12 far edge vs constraint 5 “preferred band edge” (mi hi = 1 vs 2000 mi) — **DOCS FIXED**

| | |
|--|--|
| **Status** | **Docs fixed** — far edge = `userBandFarEdge` (may exceed §5 preferred hi); T-R5-06/07 + bible §5 blurb. Code: `mi: 2000`, `yd: 5000`. |
| **Sev** | Was **P1** (code matched L12; bible wording tension) |
| **Bible / L** | **L12 wins**: user range through **normal far edge** |
| **Reviewers** | **S4**, **B3** |

---

### I-08 — `buildUserBand` unions with `band.lo` (≠ B.7 / L5) — **FIXED**

| | |
|--|--|
| **Status** | **Fixed in code** — `buildUserBand` = `min/max(pickLogLen, farLog)` only; no `band.lo` union (`userRange.test.js` I-08). |
| **Sev** | Was **P1** (feeds I-02 range width; **does not replace I-02 teardown**) |
| **Bible / L** | L5 / B.7: user band from quantized nice through far edge |
| **Evidence (historical)** | Prior `buildUserBand` expanded downward via **`band.lo`**. |
| **Reviewers** | **B3**, **S2** |

**Resolution — FIXED**

```js
logLo = Math.min(pickLogLen, farLog);
logHi = Math.max(pickLogLen, farLog);
```

S2 still required **I-02 teardown** (also fixed in engine; CanvasEditor must persist `computeScale` session).

---

### I-09 — L6 same-ladder preferred pick clears `userBand` outside range (≠ L7-only teardown)

| | |
|--|--|
| **Sev** | **P1** |
| **Bible / L** | Constraint 5: persist until change **from within** range (L7). L6: preferred elsewhere → switch only, `userBand = null`. |
| **Evidence** | `pick.js`: any L6 hit sets `userBand: null`, including same-ladder preferred pick while physical length is **outside** the dormant range (L7 does not run). |
| **Reviewers** | **B3** |

**Proposed resolution — FIX DOCS (keep code)**

- **Chosen product reading:** An explicit pick of the **auto-preferred** unit is “return to auto” → clear user range always (L6). L7 covers in-range picks of a *different* unit that is not handled solely as preferred-elsewhere.
- Amend bible persistence sentence: tear down on (a) L7 other-unit pick while band active, (b) L6 preferred pick, (c) ladder switch / clear, **(d) I-02 auto exit** when preferred unit leaves the bar pool **or** `tLog > logHi` (not solely `tLog < logLo`).

---

### I-10 — Nice / format / constants drift (plain thresholds, inch grammar, unused floor, hardcoded bar bounds, catalog throw)

| | |
|--|--|
| **Sev** | **P1** / **P2** |
| **Bible / L** | Constraint 3: plain `.001`…`5000`; 3a fractions then decimals at `.01`; L11 no hard-error; BAR_* in constants |
| **Evidence** | `nice.js` `formFor` uses `PLAIN_MIN/MAX` (0.001/5000) ✅; **`formatScaleNumber`** still uses **`0.01` / `10000`** for display sci. Inches inject **`0.25` / `0.5`** as plain (as-built). `INCH_DECIMAL_FLOOR` exported but **unused** in grammar gate. `logBarBounds` hardcodes `60`/`180` instead of `BAR_PX_MIN/MAX`. `catalog.js` / `membership.js` **throw** on unknown unit (resolve path avoids; picker/tests can still throw). |
| **Reviewers** | **B1** |

**Inch grammar lock (B1 sign-off):**

- **Keep as-built:** decimals **`.01` / `.02`**, fractions per 3a, and plain **`0.25` / `0.5`**.
- **Delete unused `INCH_DECIMAL_FLOOR`** (do not wire it into a new gate that would change as-built admission).
- **3a / 0.25 doc edits → Patch A** (bible + implementation note), not only Patch E.

**Proposed resolution — FIX CODE (hygiene) + FIX DOCS (Patch A)**

- Patch A: document inch grammar lock; mention plain `0.25`/`0.5` alongside 3a.
- Patch E: `formatScaleNumber` use `PLAIN_MIN` / `PLAIN_MAX` (or dedicated `FORMAT_PLAIN_*` if display band should differ — if so, document; default align to constraint 3).
- Patch E: **delete** `INCH_DECIMAL_FLOOR` from `constants.js` (and any re-exports).
- `logBarBounds`: import `BAR_PX_MIN` / `BAR_PX_MAX`.
- Catalog: return null / safe fallback on unknown in hot paths (L11 spirit); keep throw in tests/`testSupport` only.

---

### I-11 — Related-ladder ±1 empty when unit ∉ related inventory

| | |
|--|--|
| **Sev** | **P2** |
| **Bible / L** | 6c related ±1; ultra omits yd etc. |
| **Evidence** | `ladderNeighbors(currentUnit, relatedLadder)` returns [] if unit absent — correct. Chip rungs OK; confusion amplified by I-03 table dump. |
| **Reviewers** | **B4**, **B6** |

**Proposed resolution — FIX DOCS (optional code)**

- **Patch A:** bible **6c** — clarify empty related ±1 when current unit ∉ related ladder inventory; skip-empty still applies.
- **Files:** `scale-bar-ruling-design-bible.md` (constraint 6c), optionally `scale-bar-ruling-implementation.md` §B.8, `rungs.js` comment.
- Optional: map current unit to nearest related-ladder unit by log size before ±1 — **defer** unless product asks.
- Patch D tests name **`T-R6-03`** / **`T-POP-*`** (membership table); related-empty can be a named comment or small `T-POP` case once table dump no longer hides it.

---

### I-12 — L2 enter hysteresis unused; exit hold; B.6 vs code incumbent order

| | |
|--|--|
| **Sev** | **Defer** (enter 5%) + **FIX DOCS** (order / exit semantics) |
| **Bible / L** | L2 low priority; implementation §D; Q4 preferred-range = primary anti-flicker |
| **Evidence** | `HYSTERESIS_ENTER_PAST_EDGE` present; `resolve.js` header admits not consulted. Exit-hold ≈ **“incumbent still in pool”** (candidate still fits bar / band exit), not a separate consulted constant. `HYSTERESIS_EXIT_FULL_BAR_RANGE` is **exported and unused**. Order: handoff before incumbent (see I-05). |
| **Reviewers** | **S1** (noted), **S5**, **B2**, **B6** |

**Proposed resolution — DEFER enter margin; FIX DOCS order + exit note**

- **Q4 preferred-range = primary anti-flicker;** enter **5%** = **optional add-on** after bands/handoffs prove insufficient (I-12 optional sign-off).
- Do **not** block P0 on L2 enter. After I-01, re-evaluate T-P-07; only then implement enter-past-edge.
- Align §B.6 table with code (I-05).
- Document exit hold = incumbent unit still has an in-pool stop inside its full allowed bar range.
- **Patch H hygiene:** either **wire** `HYSTERESIS_EXIT_FULL_BAR_RANGE` as the documented exit policy flag, or **remove** the unused export and describe exit-hold in prose only — do not leave a dead constant without a note.

---

### I-13 — Missing e2e / scenario tests (S1 matrix, dm pick path, popover/set-scale table)

| | |
|--|--|
| **Sev** | **P1** |
| **Bible / L** | DoD §E.10; test catalog; L1 coalesced = target-mpp |
| **Evidence** | Unit tests exist for L3/L4/L8/L12 fragments; gaps called out by S1/S2/S6. |
| **Reviewers** | **S1**, **S2**, **S6**, **B5** |

**Proposed resolution — FIX CODE (tests)**

- Add targeted tests listed under §3 patches; map to catalog ids.
- Patch A note: **T-F1 / T-Z** coalesced cases = **target-mpp matrices per L1**, not visitation traces.

---

### I-14 — Doc status / inventory drift (implementation “not yet implemented”; bible code paths; wrong rule filing)

| | |
|--|--|
| **Sev** | **P2** |
| **Evidence** | Implementation header still “docs only; not yet implemented”; bible “Code (as-built)” still mentions `scaleBarLadders.js`; S3 notes examples under wrong rule; S6 notes L9/L10 engine OK while UI tables wrong. |
| **Reviewers** | **S2**, **S3**, **S6**, **B1** |

**Proposed resolution — FIX DOCS**

- Mark engine as shipped under `boundless/src/engine/scaleBar/`; point UI at session API; remove stale ladder file refs; fix example placement (µm→in under rule 1/L5).
- Note **L9 / L10 verified OK** at engine level (S6); remaining S6 work is UI membership tables (I-03/I-04) + tests (I-13).

---

### I-15 — L6 dest stays on sticky ladder when sticky is in `preferredLadders` (≠ B.7 / L6) — **FIXED**

| | |
|--|--|
| **Status** | **Fixed in code** — L6 dest is always `highestPriority(preferredLadders)` (`pick.js`; `userRange.test.js` I-15). |
| **Sev** | Was **P0** |
| **Bible / L** | **L6** / B.7 |
| **Reviewers** | **B3** |

---

### I-16 — Set-scale “Selecting a unit sets initial ladder” = on save (L9)

| | |
|--|--|
| **Sev** | **P2** (docs / dialog contract; blocks wrong implementer reading of B5) |
| **Bible / L** | L9; constraint 7 “Selecting a unit sets the initial current ladder” |
| **Evidence** | Ambiguous whether dialog 7c live selection mutates `ladderId` before commit. |
| **Reviewers** | **B5** |

**Proposed resolution — FIX DOCS (optional live preview deferred)**

- **Product reading:** Ladder assignment runs **on save / commit** (L9: `ladderId = highestPriority(ownersOf(unit))`). Until commit, dialog **7c `ladderId` = prior session ladder or `null`** — do not treat in-dialog highlight as sticky ladder mutation.
- **Optional live preview** of post-save ladder — **deferred**.
- Patch A: one sentence under constraint 7 / set-scale DoD. Implementers of I-04 must not “fix” 7c by writing `ladderId` on every click.

---

## 2. Proposed resolution matrix (compact)

| Id | Resolution | Prefer |
|----|------------|--------|
| I-01 | **Fix code** (`promoteNextGe1` for **1 ft only**) | Bible F1 / 4.3 / §5 promote |
| I-02 | **Fix code** (**teardown** on pool-exit **or** `tLog > logHi`); **fix docs** status | S2 expected: cm/mm after dm→Qpc→back; **not** sticky re-entry; A-pool past B⁺ ceiling |
| I-03 | **Fix code** | Constraint 6 membership table |
| I-04 | **Fix code** | Constraint 7 membership through 7c |
| I-05 | **Fix docs** (B.6, §4→§5 pointers, T-P-08, T-U-06, ultra owner-examples); keep code handoff>incumbent | **L4** over old T-P-08 |
| I-06 | **Fix docs** (T-R5-02, rule 1 filing); optional seed `lastReading` **defer** | **L5** quantized nice |
| I-07 | **Fix docs** | **L12** far edge |
| I-08 | **Fix code** (`min/max(pick, far)` only; no `band.lo`) | **L5 / B.7** literal |
| I-09 | **Fix docs** (L6 clears always; + I-02 exit) | L6 return-to-auto |
| I-10 | **Fix code** hygiene + **fix docs** inch lock in Patch A; **delete** `INCH_DECIMAL_FLOOR` | Constraint 3 / 3a as-built |
| I-11 | **Fix docs** (6c empty ±1); optional defer map | Skip-empty OK |
| I-12 | **Defer** enter 5% (Q4 primary); **fix docs** exit=in-pool; Patch H hygiene unused exit const | §D low priority |
| I-13 | **Fix code** (tests) | DoD E.10; L1 target-mpp |
| I-14 | **Fix docs** | Cutover complete; L9/L10 engine OK |
| I-15 | **Fix code** | **L6 / B.7** always `highestPriority` |
| I-16 | **Fix docs** | Ladder on **save** (L9); 7c prior/null until commit |
| 0.5 mi vs yd | **Defer** (not I-01) | yd while yd in pool; 0.5 mi after yd empties |

---

## 3. Unified implementation plan (ordered patches)

Implement in this order so each patch is testable alone. **Docs-only patches may land first or with code.**

### Patch A — Docs authority sync (I-05, I-06, I-07, I-09, I-10 docs, I-11, I-12 docs, I-14, I-16, L1 note)

**Files:** `scale-bar-ruling-implementation.md`, `scale-bar-ruling-design-bible.md`, `scale-bar-test-catalog.md` (T-P-08, T-U-06, T-R5-02), this folder’s status blurb if any.

1. §B.6 priority table → match `resolve.js` (handoff before incumbent; note enter margin unused; exit hold = incumbent still in pool).
2. Bible §4: insert handoff winners; prefer≥1 **promote to 1 of next** may beat finer unit’s standard bandHit (sets up Patch B for **1 ft only**); move long examples to **§5 pointers**.
3. Constraint 5: quantized nice (L5); user hi = far edge (L12); L6 clears userBand; persistence (a)(b)(c)(d=I-02 A-pool hybrid: pool-exit **or** `tLog > logHi`); **relocate µm→in rule 2 → rule 1/L5**.
4. T-P-08 + **T-U-06**: cutover when **0.25 mi fits (L4)**; document any-in-band-mi-beats-ft / nearer-5000 `0.5`/`1` behavior.
5. Scrub §5 owner-examples ultra cutover **`0.5–1 mi` → `0.25 mi` (L4)**; leave standard-imperial mi **0.5–1**.
6. T-R5-02 OOM → quantized nice → far edge; inch grammar lock (`.01`/`.02`, fractions, plain `0.25`/`0.5`); bible 6c empty related ±1.
7. Headers: engine as-built path; drop `scaleBarLadders.js`; note L9/L10 engine OK; **T-F1/T-Z = target-mpp per L1**.
8. Constraint 7 / I-16: selecting unit sets ladder **on save**; dialog 7c ladderId = prior/null until commit; live preview deferred.
9. I-12 optional note: Q4 preferred-range primary anti-flicker; enter 5% optional add-on.

### Patch B — Prefer≥1 promote / `1 ft` (I-01) — **P0**

**Files:** `resolve.js`, optionally `preference.js`, `resolve.test.js`.

1. Add `promoteNextGe1` (or equivalent) in `keyFor` so `1 <nextUnit>` beats finer `bandHit` when in pool.
2. Data-drive promote edges from §5 where possible.
3. Tests: `10 in` + `1 ft` both fit → `1 ft`; ultra land still respects L4 when `0.25 mi` band-hits; standard `200 yd` vs `500 ft` still L3.
4. **Out of scope for this patch:** `0.5 mi` vs yd (deferred — see §6).

### Patch C — User band formula + teardown + L6 dest (I-08, I-02, I-15) — **P0**

**Files:** `preference.js` `buildUserBand`, `resolve.js` (or HUD resolve wrapper) for teardown, `pick.js` for L6, `userRange.test.js`, `resolve.test.js` / pick tests.

**Steps (all required; do not skip teardown):**

1. **I-08:** `buildUserBand` → `logLo = min(pickLogLen, farLog)`, `logHi = max(pickLogLen, farLog)`; **no `band.lo`**.
2. **I-02:** Auto-clear `userBand` when preferred unit leaves the bar pool **or** `tLog > logHi` (A-pool hybrid; do not clear solely for `tLog < logLo`). Historical Patch C preferred interval exit — superseded.
3. Re-assert L12 mi ~1e-5→2000; L5 in → far `10`.
4. **S2 test:** dm pick → leave to `Qpc` → return to ~1 cm → **`cm`/`mm`**, `userBand` null — **not** sticky dm. **I-08 alone must not be marked as closing S2.**
5. **I-15:** `pick.js` L6 dest = **always** `highestPriorityLadder(preferredLadders)`; remove stay-on-sticky.
6. **I-15 test:** sticky lower-priority + preferred on sticky and SM → highest priority; `userBand` null.

### Patch D — Popover / set-scale table membership (I-03, I-04) — **P0**

**Files:** `ScaleUnitPicker.js`, set-scale dialog wiring, `rungs.js` (flags), `rungs.test.js`.

1. Table UI binds to expander `units`, excludes current (popover), keeps More.
2. `allUnitsTableRows()` only for true full catalog level (6e / 7d).
3. Tests named **`T-R6-03` / `T-POP-*`** (popover) and set-scale >22 / More 7c→7d; synthetic ctx with >12 membership ≠ full catalog length; current unit absent; More advances.
4. Respect **I-16**: do not write `ladderId` on dialog click — only on save.

### Patch E — Nice / format / logBarBounds / throws (I-10)

**Files:** `nice.js`, `constants.js`, `logMath.js`, `catalog.js` (call sites).

1. Align `formatScaleNumber` thresholds with `PLAIN_*`.
2. **Delete** `INCH_DECIMAL_FLOOR` (grammar locked in Patch A / I-10).
3. `logBarBounds` ← `BAR_PX_*`.
4. Soft-fail unknown units on HUD paths.

### Patch F — Optional CanvasEditor reading seed (I-06) — **deferrable**

**Files:** `CanvasEditor.js` — `setScaleSession({ ...next, lastReading: reading })` from `applyUnitPick`.

Display-only (L1); not required for unit choice. S1 optional defer is acceptable.

### Patch G — Test catalog coverage (I-13)

Map S1/S2/S6 to automated cases; mark L2 enter tests skipped-with-ticket until Patch H. Include I-15 / I-02 cases if not already green from Patch C.

### Patch H — L2 enter 5% (I-12) — **only if T-P-07 fails after A–C**

**Files:** `resolve.js` — consult `HYSTERESIS_ENTER_PAST_EDGE` when comparing incumbent vs neighbor; do not let enter margin override L3/L4 handoffs.

**Hygiene (always when touching this area):** document or remove unused `HYSTERESIS_EXIT_FULL_BAR_RANGE`; exit hold remains “incumbent still in pool.”

---

## 4. Acceptance — how each original reviewer issue is addressed

| Reviewer issue | Addressed by |
|----------------|--------------|
| **S1** 1 ft unreachable / prefer≥1 vs bandHit / 0.5 mi ties / L2 enter unused / missing e2e / optional lastReading | **I-01** Patch B (**1 ft only**); **0.5 mi vs yd DEFER** (§6 — not L3, not Patch B); L2 enter **I-12** defer (Q4 primary); e2e **I-13**; optional `lastReading` Patch F defer; T-F1/T-Z = L1 target-mpp (**I-13**/Patch A) |
| **S2** L8 OK; dm userBand re-capture; docs “not implemented”; L8 tests skip dm path | **I-02 teardown** + **I-08** formula — **both** Patch C (I-08 alone ≠ S2); **I-14** status; tests Patch G |
| **S3** L5 OK; 2e-5 vs nice; wrong rule filing; drop reading; T-R5-02 OOM | **I-06**+**I-14** Patch A (+ optional F); µm→in → rule 1/L5; T-R5-02 wording |
| **S4** L12 OK; band edge vs 2000 mi tension | **I-07** Patch A |
| **S5** mi via L4 OK; enter unused; B.6 order; owner-examples 0.5–1 ultra scrub | **I-05**/**I-12** Patch A (+ H later); §5 ultra cutover → **0.25 mi** |
| **S6** engine L9/L10 OK; UI >12/>22 full catalog; tests/docs | **I-03**/**I-04** Patch D; **I-13**/**I-14** (L9/L10 verified OK noted) |
| **B1** format/plain/inch/logBarBounds/catalog throw; 3a/0.25 docs | **I-10** Patch A (inch lock + delete floor note) + Patch E; **not** attributed on I-01 |
| **B2** §4 handoffs; B.6 order; T-P-08 / **T-U-06** vs L4; ultra ft↔mi product line | **I-05** Patch A (§4 examples → §5 pointers) |
| **B3** buildUserBand lo union; L6 clear; L6 dest sticky; Patch C formula | **I-08**/**I-09**/**I-15**/**I-02** Patches A+C; formula = `min/max(pick, far)` only |
| **B4** popover table / current unit / related ±1 | **I-03**/**I-11** Patch A (6c) + Patch D (`T-R6-03` / `T-POP-*`) |
| **B5** set-scale >22; ladder on select vs save | **I-04** Patch D + **I-16** Patch A (ladder **on save**; 7c prior/null) |
| **B6** inventories OK; L2 unused; B.6 order; exit const | **I-12**/**I-05**; exit hold = in-pool; `HYSTERESIS_EXIT_FULL_BAR_RANGE` hygiene Patch H; inventories no change |

---

## 5. Top 5 must-fixes

1. **I-01 / Patch B** — Make **`1 ft`** reachable while inches still fit (`promoteNextGe1` / prefer≥1 vs bandHit). **Not deferrable.** Does **not** include `0.5 mi` vs yd.
2. **I-02 + I-08 / Patch C** — **Teardown** `userBand` (shipped: pool-exit **or** `tLog > logHi`) **and** `buildUserBand` = `min/max(pickLogLen, farLog)` (+ B⁺ bar window; no `band.lo`). **Both** required for S2; I-08 alone is insufficient.
3. **I-03 / Patch D** — Popover table = **membership**, not `allUnitsTableRows()`; exclude current; keep More (`T-R6-03` / `T-POP-*`).
4. **I-04 + I-16 / Patch D (+ A)** — Set-scale table = membership through 7c; full catalog only at 7d; ladder assignment **on save** (L9), not live 7c.
5. **I-15 / Patch C** — L6 preferred pick: always **`highestPriority(preferredLadders)`**; remove stay-on-sticky in `pick.js`.

**Also ship with Patch A (docs, blocks wrong “fixes”):** **I-05** — B.6 order, §4 handoffs, **T-P-08 / T-U-06 → L4 `0.25 mi`**, ultra owner-examples scrub.

---

## 6. Out of scope / defer

| Item | Why defer | Note |
|------|-----------|------|
| **`0.5 mi` vs yd bandHit / prefer≥1 ties** | **LOCKED / implemented** — `yd → 0.5 mi` when 0.5 mi fits (handoff); cold≈walked | Was deferred; now product lock |
| **L2 enter ~5% hysteresis** (`HYSTERESIS_ENTER_PAST_EDGE`) | **Wired** in `resolveReading`; does not override L3/L4 handoff | Was deferred |
| **CanvasEditor `lastReading` seed** | Display-only (L1); HUD usually refreshes via `computeScale` | Patch F optional |
| **Set-scale live ladder preview** | I-16: ladder on save is enough | Optional later |
| **Incumbent before handoff** (literal old §B.6) | Would break L3/L4 | Docs change, not code |
| **Related-ladder neighbor remap** when unit absent | Skip-empty is valid (I-11) | Optional later |
| **Changing §5 `ft` band lo from 2→1** | Owner band is 2–500; 1 ft is promote-in | Prefer Patch B |
| **Sticky userBand re-entry** after exit | Fails S2 | Rejected — use I-02 teardown |
| **Option 05 walker / far-pin revival** | L1 / L12 | Out of scope |
| **Editable score-order engine** | Preference order locked | Out of scope |
| **Full decimal `ScaleMagnitude` library** | Log-length sufficient (L11) | Out of scope unless log fails |
| **True-metric band width product edits** | §D ASSUMPTION | Unrelated unless dm tests force retune |

---

## 7. Implementer cheat-sheet (key code today)

```text
resolve.js keyFor (approx):
  [ !userHit, !bandHit, handoffSuppressed, !incumbent, preferGe1, floorPull, barTarget, rank, value ]
  → Patch B inserts promoteNextGe1 above bandHit (1 ft path only)

preference.js buildUserBand (today — WRONG vs L5/B.7):
  logLo = min(pick, band.lo log);  logHi = max(pick, farLog)
  → Patch C: logLo = min(pickLogLen, farLog); logHi = max(pickLogLen, farLog)
  → Patch C also: clear userBand when unit ∉ pool or tLog > logHi  (I-02 / A-pool hybrid; not interval-only)

pick.js L6 (today — WRONG vs L6/B.7):
  dest = preferredLadders.includes(sticky) ? sticky : highestPriority(...)
  → Patch C / I-15: always highestPriority(preferredLadders)

preference.js bands:
  ft standard [2,500], ultra [2,5000]; mi ultra [0.25,1] (L4); standard mi [0.5,1]
  USER_BAND_FAR_EDGE mi 2000/5000

rungs.js:
  popoverUnits / setScaleUnits set asTable on count; UI wrongly swaps in allUnitsTableRows()

nice.js:
  formFor uses PLAIN_*; formatScaleNumber still 0.01/10000
  INCH_DECIMAL_FLOOR unused → delete (I-10); keep .01/.02 + fractions + plain 0.25/0.5

constants.js:
  HYSTERESIS_ENTER_PAST_EDGE unused (defer); HYSTERESIS_EXIT_FULL_BAR_RANGE unused (doc or remove)
```

**Done when:** Patches B–D (+ C steps for I-02/I-08/I-15) green against catalog F1 / L5 / L12 / S2 / L6 / T-POP-* / T-SET-*; Patch A merged; `0.5 mi` vs yd and L2 enter still explicitly deferred with rationale.

---

## 8. Sign-off delta (vs first proposal version)

What changed after S1–S6 / B1–B6 APPROVE / APPROVE-WITH-GAPS (no REJECTs):

1. **I-02 vs I-08 split** — I-08 = drop `band.lo` only; I-02 = auto-teardown (shipped: pool-exit **or** `tLog > logHi`); Patch C lists both; I-08 alone does not close S2; sticky re-entry rejected.
2. **I-01 narrowed** — `promoteNextGe1` = **1 ft** only; **0.5 mi vs yd deferred** with yd-while-in-pool rationale; §4 no longer says “mi/yd via L3” for that tie; B1 attribution removed from I-01.
3. **I-15 added** — L6 always `highestPriority(preferredLadders)`; remove stay-on-sticky; B.7 aligned; sticky+SM preferred test.
4. **Patch C formula locked** — only `logLo/logHi = min/max(pickLogLen, farLog)`; dropped ambiguous “logLo = pick (+ swap)”.
5. **I-16 added** — set-scale ladder on **save** (L9); 7c prior/null until commit; live preview deferred (B5).
6. **S3 / Patch A** — T-R5-02 OOM; µm→in → rule 1/L5; §4 cites I-06+I-14.
7. **S5 / Patch A** — scrub ultra owner-examples `0.5–1 mi` → `0.25 mi` (L4); standard-imperial mi 0.5–1 kept.
8. **B1 / I-10** — inch grammar lock; **delete** `INCH_DECIMAL_FLOOR`; 3a/0.25 docs in Patch A.
9. **B2 / I-05** — also T-U-06; ultra ft↔mi product line (any in-band mi; earliest 0.25; nearer 5000 ft 0.5/1 may win); §4 examples → §5 pointers.
10. **B4 / I-11** — bible 6c empty ±1 in Patch A; files list; Patch D names `T-R6-03` / `T-POP-*`.
11. **S6** — §4 cites I-13/I-14; I-14 reviewers include S6; L9/L10 verified OK noted.
12. **B6 / I-12** — exit hold = incumbent in pool; `HYSTERESIS_EXIT_FULL_BAR_RANGE` document-or-remove in Patch H; Q4 primary anti-flicker; enter 5% optional; S1 optional `lastReading` defer; T-F1/T-Z = L1 target-mpp.
13. **Top-5** — updated: I-01 (1 ft), I-02+I-08, I-03, I-04+I-16, I-15 (I-05 remains critical Patch A docs).
