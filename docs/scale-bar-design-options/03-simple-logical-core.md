# Design Option 03 — Simple Logical Core

**Status:** proposal (docs only; not adopted).  
**Authority:** must satisfy [`../scale-bar-ruling-design-bible.md`](../scale-bar-ruling-design-bible.md) §7.  
**Acceptance map:** [`../scale-bar-test-catalog.md`](../scale-bar-test-catalog.md).  
**Contrast:** as-built `scaleBar.js` walks from `previousHud` with scoring, search windows, bridge jumps, `minUnit` hysteresis, and near/far pins. This option **deletes that machinery** and replaces it with one auditable resolve step.

---

## 1. Thesis

**Resolve, don’t walk.**

At any zoom, the correct HUD reading is a pure function of:

1. meters-per-pixel (from the scale anchor + `effectiveZoom`),
2. durable display state `{ ladderId, userRange | null }`,
3. config (ladders, preferred bands, nice numbers, bar bounds).

Preference is an **ordered filter stack**, not a score soup. Coalesced zoom cannot skip feet because the engine never steps through neighbors — it asks “which in-bounds candidate wins the preference stack at this mpp?”

That is the smallest model that still covers bible constraints 1–9, Q4 anti-flicker via preferred ranges, and failure modes F1–F10.

---

## 2. Metaphor

**Band ownership on a fixed ladder.**

Each ladder is a sorted spine of units. Each unit owns a **standard preferred band** (magnitude interval on that unit — bible §5). Physical length under the bar is a point on a meter line; the engine maps that point onto the sticky ladder’s bands, then picks a 1/2/5 (or inch-fraction) label that keeps the bar in pixel bounds.

User picks temporarily **claim a band** (`userRange`). Related ladders and picker rungs are **queries against the same resolve function** with prefs discarded or ladder swapped — not a second peer-distance heuristic.

---

## 3. Types / modules

Three modules. No pin modes, no bridge stepper, no `minUnit` lock, no `previousHud` correctness dependency.

| Module | Owns |
|--------|------|
| **`scaleBarConfig`** | Five ladder inventories, ladder priority, related-ladder map, §5 preferred bands, bar bounds, plain↔sci handoff, inch fractions, rung predicate lists (6a–6e / 7a–7d), table-flip thresholds (12 / 22). |
| **`scaleBarCore`** | `mppFromDef`, `candidates`, `resolveReading`, `applyUnitPick`, `clearDisplayPrefs`. Pure. |
| **`scaleBarRungs`** | `popoverUnits(level)`, `setScaleUnits(level)` — evaluate config predicates; skip empty rungs; sort; flip to table. |

UI (`CanvasEditor`, `ScaleUnitPicker`) stays chrome-identical (constraint 9). It holds `scaleDef` + ephemeral `displayState`; it does **not** feed a walk ref into the core for correctness.

### 3.1 Core types

```text
LadderId =
  | "standard-metric"
  | "standard-imperial"
  | "ultra-standard-metric"
  | "ultra-standard-imperial"
  | "true-metric"

PreferredBand = { unit, min, max }   // inclusive display magnitudes on `unit`

UserRange = {
  unit,
  minMeters,   // physical length under bar at install (or equiv. mpp×barPx)
  maxMeters,   // physical length at the standard-band edge for `unit`
}

DisplayState = {
  ladderId: LadderId,
  userRange: UserRange | null,
}

Reading = {
  value, unit, barPx, ladderId,
  displayLabel?, sciLabel?,
  metersPerPx,
}

Candidate = Reading   // same shape; pool before preference
```

`scaleDef` (anchor) remains document meta: `{ value, unit, barPx, zoomAt }` (as today). Display prefs stay ephemeral unless product later chooses otherwise.

---

## 4. APIs / data flow

### 4.1 Primary API

```text
computeScale(effectiveZoom, scaleDef, displayState) → { reading: Reading, displayState }
```

- Derives `mpp` from `scaleDef` and `effectiveZoom` (same geometry as as-built; keep extreme-zoom numerics).
- Calls `resolveReading(mpp, displayState)`.
- Returns the reading; `displayState` is unchanged on auto zoom (only picks mutate it).

```text
resolveReading(mpp, displayState, opts?) → Reading
```

`opts` (for rungs / tests only):

| Flag | Effect |
|------|--------|
| `ladderId` | Override sticky ladder (related-ladder auto-show). |
| `ignoreUserRange` | Discard user preferred range. |
| `ignoreAllPrefs` | Ignore user + standard bands; still stay on ladder; break ties with prefer-≥1 + bar target. |

### 4.2 Resolve algorithm (the whole preference model)

```text
resolveReading(mpp, state, opts):
  ladderId = opts.ladderId ?? state.ladderId
  pool = candidatesOnLadder(ladderId, mpp)   // all nice readings with BAR_PX_MIN..MAX

  if pool empty:
    pool = extremeCandidates(ladderId, mpp)  // sci floor/ceiling; still bounded bar

  ranked = stableSort(pool, preferenceKey(state, opts, mpp))
  return ranked[0]
```

**`preferenceKey` — lexicographic, lower wins (auditable order = constraint 4 + 5):**

| Priority | Key | Meaning |
|----------|-----|---------|
| 0 | `userHit` | `0` if candidate’s physical length ∈ `userRange` **and** `candidate.unit === userRange.unit` (unless `ignoreUserRange` / `ignoreAllPrefs`); else `1`. |
| 1 | `bandHit` | `0` if candidate magnitude ∈ that unit’s **standard** preferred band on this ladder (unless `ignoreAllPrefs`); else `1`. |
| 2 | `preferGe1` | `0` if `value ≥ 1` (or inch-fraction / documented sub-1 band like `0.5 mi`); else `1`. Among band hits, prefer the candidate that is the **handoff target** when both a large prior-unit and `1` of next fit (bible 4.3 / §5 notes). Implemented as: among keys 0–1 ties, prefer the unit whose standard band **claims** this physical length; overlapping claims use the §5 handoff note (e.g. `200–500 yd` beats `500 ft`). |
| 3 | `barTarget` | `abs(barPx − BAR_PX_TARGET)`. |
| 4 | `unitRank` | Ladder index (stable tie-break). |
| 5 | `value` | Smaller nice magnitude (stable). |

**Stay-on-ladder (4.1)** is structural: auto `pool` is only the sticky ladder. Cross-ladder appearance happens only via pick or rung queries with an override `ladderId`.

**Anti-flicker (Q4):** bands are inclusive with a single open side at handoffs (`[min, max)` or documented closed edge in config). No `minUnit` / `minUnitZoomAt`. Small zoom noise inside a band cannot flip units; at the exact boundary the open/closed convention picks one winner. If a future edge still chatters, widen the band in config — do not reintroduce a lock.

### 4.3 Candidates

```text
candidatesOnLadder(ladderId, mpp):
  for unit in inventory(ladderId):
    for nice in niceSet(unit, ladderId):   // 1/2/5, inch fractions, mil, etc.
      barPx = (nice * unitMeters(unit)) / mpp
      if BAR_PX_MIN ≤ barPx ≤ BAR_PX_MAX:
        emit Candidate
```

- Plain labels for magnitudes in `[PLAIN_MIN, PLAIN_MAX]` (`.001`…`5000`); outside → 1/2/5 sci on that unit (constraint 3).
- Inches: `1/8`, `1/16`, `1/32` then decimals at `.01` (3a) — data in config, not special walk modes.
- Ultra-standard inventories omit `yd`/`mil`/`ld`/`R☉`/`R⊕`; absorption is **only** wider bands on neighbors (§5), not runtime bridges.

### 4.4 User pick (constraint 5)

```text
applyUnitPick(pickedUnit, mpp, displayState) → { reading, displayState }
```

Deterministic rules — no near/far pins:

1. **Resolve destination ladder** = highest-priority ladder that contains `pickedUnit` (bible priority list).
2. **Compute** `autoOnDest = resolveReading(mpp, { ladderId: dest, userRange: null })`.
3. **If** `autoOnDest.unit === pickedUnit` → **rule 3**: switch ladder only; `userRange = null`.
4. **Else if** `pickedUnit` not on previous ladder **or** not preferred at this zoom → install  
   `userRange = { unit: pickedUnit, minMeters: currentBarMeters(mpp), maxMeters: metersAtStandardBandEdge(pickedUnit, dest) }`  
   (from current size to §5 band edge — Q5 / T-R5-07). Ladder becomes `dest`. Prior `userRange` always cleared on ladder change.
5. **Reading** = best in-bounds candidate for `pickedUnit` at this mpp (or nearest in-bounds nice if exact pick value is out of bounds — still on that unit, never cold-search Planck).

**Teardown:**

- Pick a **different** unit while current physical length ∈ active `userRange` → clear entire `userRange`, then apply rules above for the new pick.
- Ladder switch → clear prior `userRange`, then maybe install new (rule 1).
- Clear scale / redefine scale → `clearDisplayPrefs()` (ladder from new anchor unit via priority; `userRange = null`).

### 4.5 Rungs

Popover / Set-scale call `resolveReading` and set predicates — same core, no duplicate “peer” math.

**Popover membership (union, then exclude current HUD unit, sort small→large):**

| Rung | Predicates (config ids) |
|------|-------------------------|
| 6a | `relatedAutoShow`, `currentLadderIgnoreUser`, `currentLadderIgnoreAllPrefs`, `currentLadderWithinFactor(50)` |
| 6b | `unitOnAnyLadderAtZoom` (auto on each ladder), `anyLadderIgnoreAllPrefs`, `relatedWithinFactor(50)`, `currentLadderReadingIn(0.1, 500)` |
| 6c | `anyLadderReadingIn(0.1, 500)`, `currentLadderNeighbors(2)`, `relatedNeighbors(1)` |
| 6d | `allUltraStandard`, `unit("kpc")`, `nonSiPrefix` |
| 6e | `allUnits` |

**Set-scale:**

| Rung | Predicates |
|------|------------|
| 7a | `ultraBetween("mm","mi")` |
| 7b | `allUltraStandard` |
| 7c | `anyLadderBetween("µm","kpc")`, `currentNonSiPrefix`, `trueMetricSiMetersIfCurrent` |
| 7d | `allUnits` |

Empty rungs skip; `>12` / `>22` → table (constraint 6 / 7). Predicate order inside a rung is data — retune without touching `resolveReading` (constraint 8).

### 4.6 Data-flow diagram

```text
scaleDef + effectiveZoom ──► mpp
displayState.ladderId ──────────────┐
displayState.userRange ─────────────┼──► resolveReading ──► HUD label + barPx
config (bands, nice, bounds) ───────┘

Unit pick ──► applyUnitPick ──► new displayState (+ reading)
Popover/Set ──► rung predicates ──► resolveReading(overrides) / inventory filters
```

**Intentionally absent vs as-built:** `previousHud`, bridge jump, search window, `scoreReading`, `pinMode`, `FAR_PIN_RELEASE`, `minUnit` / `minUnitZoomAt`, `LADDER_PROMOTE_AT` special-case map (handoffs live in §5 bands).

---

## 5. Config for constants / rungs

All tunables live in `scaleBarConfig` (names illustrative):

| Key | Role |
|-----|------|
| `LADDERS[ladderId].units` | Ascending inventories (five ladders; ultra lists exact). |
| `LADDER_PRIORITY` | SM → SI → UM → UI → TM. |
| `RELATED_LADDERS` | Bible related table. |
| `PREFERRED_BANDS[ladderId][unit]` | `{ min, max }` from §5 PROPOSED (+ ultra absorption widths). |
| `HANDOFF_NOTES[ladderId]` | Optional overlap winners (e.g. yd 200–500 over 500 ft). |
| `BAR_PX_MIN/MAX/TARGET` | 60 / 180 / 120 (keep unless retuned). |
| `PLAIN_MIN/MAX` | `.001` / `5000`. |
| `NICE_DEFAULT` | `[1,2,5]` × decades inside plain band. |
| `NICE_BY_UNIT` | Inch fractions+wholes, mil, `0.5 mi`, etc. |
| `POPOVER_RUNGS` | Ordered list of predicate id arrays + `TABLE_AT: 12`. |
| `SET_SCALE_RUNGS` | Same pattern + `TABLE_AT: 22`. |

Changing ultra `ly` max `500→5000` is a band edit only (T-R8-01). Moving a picker rule between rungs is reordering predicate ids.

---

## 6. Failure-mode avoidance

| ID | As-built failure | How this design avoids it |
|----|------------------|---------------------------|
| **F1** | Coalesced zoom skips `ft` | No walk: at mpp where `ft` band wins, `ft` wins even in one jump (T-F1-*, T-Z-*). |
| **F2** | Pick → Planck | `applyUnitPick` always seeds ladder + unit (and usually `userRange`); never null-pin cold search. |
| **F3** | Shared unit flips stack | Auto never re-derives ladder from unit; sticky `ladderId` until pick/clear. |
| **F4** | Meta write clears stack | Preference/band logic does not call anything that resets `ladderId`. No `minUnit` promotion path. |
| **F5** | `previousHud` ref coupling | Core correctness independent of last frame; optional UI cache is display-only. |
| **F6** | Fine-step tests hide skips | Catalog T-Z / T-F6 required; resolve model makes large Δzoom the natural case. |
| **F7** | Cold start stuck on anchor | No previousHud preference; oversized anchor demotes via candidates + bands. |
| **F8** | Missing `1/32` | Inch nice set in config includes `1/32` then `.01`. |
| **F9** | Docs/code drift | Config tables mirror bible §2/§5; this option doc is the implementation contract. |
| **F10** | Dead `pinMode: "stack"` | Pins deleted; API has no null-pin mode (T-F10-01). |

---

## 7. Test mapping

| Catalog area | How this design satisfies |
|--------------|---------------------------|
| **T-R1/R2** | Same mpp geometry + bar clamp; sci extremes via `extremeCandidates`. |
| **T-R3 / T-IN / T-F8** | `NICE_BY_UNIT` + plain/sci constants. |
| **T-R4 / T-P-*** | Keys 1–2 of `preferenceKey` + sticky ladder; bands from §5. |
| **T-R5 / T-P-02** | `applyUnitPick` + `userRange` outranks standard band. |
| **T-R6 / T-POP-*** | Predicate rungs; `relatedAutoShow` = `resolveReading` on related ladder. |
| **T-R7 / T-SET-*** | Set-scale predicate rungs; save → `ladderId` by priority. |
| **T-R8** | Config-only retunes. |
| **T-R9** | No chrome changes. |
| **T-U-*** | Five-ladder config + absorption bands; no omit-unit bridges. |
| **T-F\* / T-Z-*** | Resolve-from-mpp + durable `displayState`. |
| **T-X-*** | `clearDisplayPrefs` on Clear / redefine. |

Suggested unit-test seams (1:1 with catalog): `resolveReading` pure cases, `applyUnitPick` matrix (rules 1–3), rung snapshot lists, coalesced single-call jumps (no multi-step bridge harness required for correctness).

---

## 8. Tradeoffs

| Gain | Cost |
|------|------|
| Preference rules are readable as a 6-key sort — easy to audit against constraint 4/5 | Overlapping bands need explicit `HANDOFF_NOTES` (or non-overlapping intervals); ambiguity is config, not code cleverness |
| Large zoom jumps are correct by construction | Loses as-built “monotonic walk” aesthetics mid-jump if UI ever sampled intermediate frames without flushing zoom (engine status flush still recommended) |
| Deletes pins, bridge, scoring, minUnit — smaller surface | Must get §5 bands right; wrong band widths show up as “wrong unit” not as skip bugs |
| Rungs reuse `resolveReading` — one preference stack | Predicate evaluation can be chatty; cache per frame if needed (optimization, not semantics) |
| No `previousHud` correctness | Slightly less “sticky to last nice number” inside a band; bar-target key handles that |

**Non-goals for this option:** multi-strategy frameworks, pluggable scorer plugins, separate hysteresis subsystem, keeping near/far pin UX semantics under new names.

---

## 9. Assumptions

1. §5 PROPOSED preferred bands (incl. ultra absorption) are authoritative enough to encode as `PREFERRED_BANDS` without further product decisions for an implementable MVP; open bible items 7–10 (true-metric widths, body/astro popover 6d, sci glyph style, ultra sub-ℓP) stay as config defaults matching the bible’s PROPOSED text until the owner edits them.
2. Ephemeral `displayState` (not doc meta) matches today’s “display preference ephemeral” behavior.
3. `relatedAutoShow` means full constraint-4 resolve on the related ladder at the same mpp (Q3) — already settled.
4. Status path continues to flush on `effectiveZoom` (T-Z-01); that is UI/engine plumbing, not part of the preference model.
5. When no in-bounds nice exists for a forced user unit, snapping to the nearest in-bounds nice **on that unit** is acceptable; leaving the unit is not.
6. Inclusive/open handoff edges are sufficient for Q4; a separate lock is out of scope unless a catalog case fails after bands are correct.

---

## 10. Clarifying questions

None blocking. Open bible items 7–10 can ship as PROPOSED defaults inside `scaleBarConfig` and be retuned later (constraint 8).

---

## 11. §7 checklist (self-eval)

- [x] UX unchanged (constraint 9)
- [x] Five ladders + related + priority as data
- [x] Bar bounds + extreme zoom
- [x] 1/2/5 + inch 1/32 + plain/sci constants
- [x] Preference stack 4 + user overrides 5; anti-flicker via bands (no minUnit)
- [x] Rungs 6/7 as reorderable predicate config
- [x] No fragile `previousHud` correctness; large-jump tests map cleanly
- [x] Sticky ladder survives shared units / preference writes
- [x] Manual picks never cold-start Planck
- [x] Catalog mappable 1:1
- [x] Bible wins; this file is a design option only
