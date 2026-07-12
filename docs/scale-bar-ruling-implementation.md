# Scale Bar — Ruling Implementation Design

**Status:** as-built under `boundless/src/engine/scaleBar/` (engine shipped; UI session API wired).  
**Path:** `boundless/docs/scale-bar-ruling-implementation.md`  
**Product constraints:** [`scale-bar-ruling-design-bible.md`](./scale-bar-ruling-design-bible.md)  
**Acceptance:** [`scale-bar-test-catalog.md`](./scale-bar-test-catalog.md)  
**Architecture lineage:** hardened Option 03 (concretized) + Option 07 layers + Option 02 rung predicates + Option 08 contracts. See [`scale-bar-design-options/OPUS-bible-risk-review.md`](./scale-bar-design-options/OPUS-bible-risk-review.md) and [`ANALYSIS-finalists.md`](./scale-bar-design-options/ANALYSIS-finalists.md).

This is the **single document implementers must follow**. The bible remains the product-constraint source of truth; this file is the concrete build plan (modules, types, data flow, session shape, DoD). Where locked decisions below update a bible PROPOSED band or Q&A default, **this document wins for implementation** until the bible tables are edited to match.

---

## A. Locked product decisions

Authoritative from product Q&A. Treat as frozen for the first build.

| # | Decision |
|---|----------|
| **L1** | **Coalesced zoom = target result only.** One resolve at the final mpp / log-length. No mandatory intermediate rung trace (`in → ft → yd → mi`). Optional animation bridge is display-only and must not affect correctness. Catalog cases `T-F1-*` / `T-Z-*` are interpreted as **target-mpp matrices**, not visitation traces. |
| **L2** | **Anti-flicker = asymmetric handoff hysteresis**. Enter the next unit only after the target length is ~**5% past** the current unit’s bar-range / band edge (**wired** via `HYSTERESIS_ENTER_PAST_EDGE`); exit the incumbent when leaving the **full allowed bar range** for that unit. Both margins are **tunable constants**. Typed **droppable incumbent** carries which side of the handoff is held; deleting the incumbent must still yield a valid absolute reading. Handoff/promote winners are never blocked by enter. |
| **L3** | Overlap **`500 ft` vs `200 yd`** → **`200 yd` wins** (explicit handoff winner, not “prefer lower number” coincidence). |
| **L4** | Ultra-standard **`mi` preferred band = `0.25–1 mi`** (updated). When **`0.25 mi` fits** bar bounds, it **wins over feet** (including toward 5000 ft). Standard-imperial `mi` band remains per bible §5 unless later edited; ultra absorption / cutover uses this updated ultra band. |
| **L5** | **Off-ladder / non-preferred pick** (e.g. µm → `in`): switch to destination ladder by priority; install **user preferred range** from the **quantized nice value** of the pick (physical/log length of that nice reading) through the unit’s **normal far edge** on that ladder (≈ `10⁻⁵`–`10⁻⁴ in` nice through far edge `10 in`). |
| **L6** | Pick that is **preferred on another ladder** (e.g. `5 hm` → `m`): **switch ladder only, no user range**. If preferred on multiple ladders → **highest ladder priority**. |
| **L7** | Pick of a **different unit** while a `userBand` is still active → **clear the entire user range**, then run normal pick resolve (L5/L6). (Under A-pool I-02 the band may still be active with `tLog < logLo`, so do not gate L7 on install-interval membership alone.) |
| **L8** | **Sticky ladder** through shared units (e.g. `Qpc`). Auto resolve never re-derives ladder from `stackForUnit`. |
| **L9** | Set-scale save of a multi-owner unit (e.g. `Qpc`) → initial ladder = **standard metric** (highest priority among owners). |
| **L10** | Popover related-ladder peer = unit that related ladder would **auto-show at current zoom** (constraint 4 on a clean hypothetical session) — **not** nearest-by-size. |
| **L11** | Extreme zoom: **end-to-end log / normalized magnitude** for unit meters, mpp, band edges, and comparisons. Round-trips and scene jumps must stay consistent. **Never hard-error** on float limits; clamp / sci on floor–ceiling units and keep a finite bar. |
| **L12** | **No far-pin.** Distant / non-preferred picks are **user preferred ranges only**. Example: at `1 in`, pick `mi` → install mi user range ~`10⁻⁵ mi`–`2000 mi` (before Earth-radii / body bands). While that range is active, any in-pool **mi** stop wins → **`ft` / `yd` skipped** until cleared (L7, L6, ladder switch/clear, or I-02: unit leaves bar pool **or** `tLog > logHi`). |

### Implications for as-built / older options

- Do **not** implement Option 05 walker unless product later requires traces (it does not — L1).
- Do **not** reintroduce `pinMode: "near"|"far"|"stack"` as the durable override model (L12). Thin UI adapters may map legacy calls into `applyUnitPick` + user ranges.
- `previousHud` / `lastReading` is **display-only** (Option 08); never required for unit choice (L1, F5).

---

## B. Chosen architecture

**Name:** Hardened 03, concretized — absolute resolve on a **log-length spine**, with a typed droppable incumbent for hysteresis.

**Not chosen:** Option 05 walker (no mandatory traces).  
**Borrowed:**

| Source | What to take |
|--------|----------------|
| **03** | Small absolute `resolveReading` / `applyUnitPick` core; lexicographic preference; no bridge for correctness |
| **07** | Layer split: Unit Catalog / Ladder Membership / Preference / Presentation(rungs) |
| **02** | Closed rung-predicate registry (`type` + params); ordered rung plans as data |
| **08** | `ZoomEpoch` / durable session contracts; `lastReading` display-only; split meta vs display writers |
| **01** (light) | End-to-end magnitude discipline — prefer **log-length** over a full decimal library unless log proves insufficient |
| **Opus sketch** | `Stop` / `PreferBand` in log space; incumbent for enter/exit; physical/log user bands |

### B.1 Coordinate spine

```text
logLen = log10(worldLength_meters)
targetLogLen = log10(BAR_PX_TARGET * mpp)   // or equivalent: log10(BAR_PX_TARGET) + log10(mpp)
```

- Catalog stores each unit’s factor as **`log10Meters`** (and may keep a finite `meters` for everyday units only as a convenience — comparisons and extremes use log).
- Preferred bands and user ranges are **`{ logLo, logHi }`** intervals (plus owning `unit` / `ladderId`).
- Candidate stops precompute `logLen = log10(niceValue) + unit.log10Meters`.
- Bar fit: `barPx = 10^(stop.logLen - log10(mpp))` with careful exp, or compare in log space against `log10(BAR_PX_MIN/MAX)`.
- Under/overflow: never throw; expand to sci on floor/ceiling unit; keep `barPx` clamped (L11).

### B.2 Module layout

Prefer new modules under `boundless/src/engine/scaleBar/` with a thin compatibility façade so `CanvasEditor` / `ScaleUnitPicker` keep working during migration.

```text
boundless/src/engine/scaleBar/
  catalog.js              // Unit Catalog (physical truth)
  membership.js           // five ladders, priority, related
  preference.js           // bands, handoffs, user-range lifecycle, incumbent hysteresis
  nice.js                 // 1/2/5, plain↔sci, inch fractions
  resolve.js              // candidates + resolveReading (absolute)
  pick.js                 // applyUnitPick (constraint 5 / L5–L7)
  rungs.js                // predicate registry + popover / set-scale expanders
  session.js              // ScaleSession helpers, clearDisplayPrefs
  logMath.js              // log10 helpers, safe exp, mpp ↔ logLen
  constants.js            // BAR_*, PLAIN_*, HYSTERESIS_*, TABLE_AT
  index.js                // public façade: computeScale, applyUnitPick, getPopoverUnits, …

boundless/src/engine/scaleBar.js   // thin re-exports / adapters (legacy names)
```

Config data may live beside these modules or under `scaleBar/config/` (bands, rung plans, inventories) — **data edits must not require rewriting `resolve.js`**.

### B.3 Layer ownership (from 07)

| Layer | Module | Owns | Must not |
|-------|--------|------|----------|
| **Unit Catalog** | `catalog.js` | id, `log10Meters`, names, `family`, `siPrefixBase`, `formatKind` | ladder membership, bands, rungs |
| **Ladder Membership** | `membership.js` | five inventories, `LADDER_PRIORITY`, `RELATED_LADDERS`, rank/neighbors/owners | preferred magnitudes |
| **Preference** | `preference.js` + bands config | standard bands, handoff winners, user-range install/teardown, incumbent enter/exit | chip layout |
| **Presentation** | `rungs.js` + rung config | 6a–6e / 7a–7d predicate lists, table flip 12/22 | meters or auto math |
| **Reading engine** | `resolve.js` + `nice.js` + `logMath.js` | candidates, bar bounds, format, absolute pick | inventing units |

### B.4 Core types

```text
LadderId =
  | "standard-metric"
  | "standard-imperial"
  | "ultra-standard-metric"
  | "ultra-standard-imperial"
  | "true-metric"

Stop = {
  ladderId, unit, niceValue,
  logLen,                         // log10(niceValue * unitMeters)
  form: "plain" | "fraction" | "sci",
  label
}

PreferBand = { ladderId, unit, logLo, logHi }   // from §5 magnitudes × unit factor

UserBand = {
  unit,
  ladderId,
  logLo,                          // min(pick, far, logBarMin) at install (L5 / Hybrid B⁺); not a fine-side I-02 clear edge
  logHi,                          // max(pick, far, logBarMax); coarse I-02 cap (clear when tLog > logHi)
}

HysteresisMargins = {
  enterPastEdge: 0.05,            // ~5% past edge to enter next (L2); tunable
  exitFullBarRange: true,         // exit when leaving full allowed bar range; tunable companion constants OK
}

ScaleSession = {
  ladderId: LadderId,             // sticky (L8); never per-frame stackForUnit
  userBand: UserBand | null,
  incumbentUnit: string | null,   // hysteresis only; droppable (L2)
  lastReading: ScaleReading | null,  // DISPLAY-ONLY (08)
}

ScaleReading = {
  value, unit, barPx, ladderId,
  metersPerPx,                    // or logMpp + derived
  displayLabel?, sciLabel?,
  reason?: "user-band" | "standard-band" | "handoff" | "prefer-ge1" | "bounds-fit" | …
}

ZoomEpoch = {                     // 08 contract; wiring may be phased
  seq, effectiveZoom, atMs,
  kind: "flush" | "throttled" | "synthetic-bridge"
}
```

**No** `pin` / far-pin in the durable session (L12).

### B.5 Key functions

| Function | Role |
|----------|------|
| `mppFromDef(scaleDef, effectiveZoom)` | Anchor → mpp using log-safe path (L11) |
| `targetLogLen(mpp)` | Bar-target world length in log space |
| `candidatesOnLadder(ladderId, mpp)` | All grammar-legal Stops with bar in `[MIN, MAX]` |
| `extremeCandidates(ladderId, mpp)` | Floor/ceiling sci fallback; still bounded bar |
| `resolveReading(mpp, session, opts?)` | Absolute winner (see §B.6) |
| `applyUnitPick(pickedUnit, mpp, session)` | Constraint 5 / L5–L7 → new session + reading |
| `clearDisplayPrefs(session, scaleDef?)` | Clear / redefine: ladder from anchor via priority (L9 for multi-owner), `userBand = null`, `incumbentUnit = null` |
| `popoverUnits(level, ctx)` | Cumulative rung expand (6a–6e) |
| `setScaleUnits(level, ctx)` | Set-scale rungs (7a–7d) |
| `computeScale(effectiveZoom, scaleDef, session)` | Facade: mpp → resolve → HUD fields; may write `lastReading` only |

`opts` for probes / tests:

| Flag | Effect |
|------|--------|
| `ladderId` | Override sticky ladder (related auto-show) |
| `ignoreUserBand` | Discard user preferred range |
| `ignoreAllPrefs` | Ignore user + standard bands; stay on ladder; prefer-≥1 + bar target |
| `ignoreIncumbent` | Drop hysteresis (cold absolute) |

**Related-ladder probes (L10):** call `resolveReading` with `{ ladderId: related, ignoreUserBand: true }` and a **clean** session clone (no foreign user band, no live incumbent). Never leak the live overlay.

### B.6 Resolve reading (data flow)

```text
scaleDef + effectiveZoom ──► mpp (log-safe)
session.ladderId ─────────────────────────┐
session.userBand ─────────────────────────┼──► resolveReading ──► ScaleReading
session.incumbentUnit ────────────────────┤         │
config (bands, handoffs, nice, BAR_*) ────┘         │
                                                    ▼
                                         session.lastReading (display only)
```

**Algorithm (absolute, sticky ladder only):**

1. `pool = candidatesOnLadder(session.ladderId, mpp)`; if empty → `extremeCandidates`.
2. Lexicographic preference (lower wins), bible 4 + locked handoffs:

| Priority | Key | Meaning |
|----------|-----|---------|
| 0 | `userHit` | Any in-pool stop of `userBand.unit` while the band is active (I-02 / A-pool; **not** gated on install `[logLo, logHi]`) |
| 1 | `promoteNextGe1` | When `1 <next coarser>` fits, demote finer-unit bandHits (I-01 / §5; e.g. `1 ft` over `10 in`; `1 km` over large `m`) |
| 2 | `bandHit` | Stop in that unit’s standard `PreferBand` on this ladder (unless ignore prefs) |
| 3 | `handoffWinner` | Explicit overlap table (L3, L4, §5 notes) — e.g. yd over 500 ft; **mi over yd when 0.5 mi fits**; **mil over µm**; **in over mil** (`50 mil` ↔ `1/16 in`); ultra `0.25 mi` over ft when it fits |
| 4 | `incumbentHold` | If incumbent set and still **in the candidate pool** (L2 exit = full allowed bar range / still fits), prefer incumbent unit. **L2 enter ~5%** (`HYSTERESIS_ENTER_PAST_EDGE`) gates band/prefer release past the incumbent band edge; does **not** override handoff/promote |
| 5 | `preferGe1` | Prefer lower displayed number ≥ 1 (inch fractions / `0.25`–`0.5 mi` already won via bands/handoffs) |
| 6 | `floorPull` | All-sub-1 pools prefer the finest rung (sci floor) |
| 7 | `barTarget` | Closer to `BAR_PX_TARGET` |
| 8 | `unitRank`, `value` | Stable ties |

3. Update `incumbentUnit` to the winning unit (or clear on cold `ignoreIncumbent`). Auto zoom does **not** change `ladderId`. **`userBand` is torn down** when the preferred unit has no in-bounds bar stop **or** `targetLogLen > logHi` (I-02 / A-pool hybrid; owned by `computeScale` / `clearUserBandIfExited` / `userBandShouldClear`). Do **not** clear solely because `tLog < logLo`. Sticky re-entry after exit is rejected.

**Stay-on-ladder** is structural: auto pool is only the sticky ladder.

### B.7 Apply unit pick (data flow)

```text
applyUnitPick(pickedUnit, mpp, session):
  // L7 — other-unit pick while userBand still active tears down first
  // (band may remain active with tLog < logLo under A-pool I-02)
  if session.userBand && pickedUnit !== session.userBand.unit:
       session = { ...session, userBand: null }

  preferredLadders = ladders where resolveReading(mpp, {ladderId, userBand:null}, ignoreIncumbent).unit === pickedUnit
  if preferredLadders non-empty:                    // L6
    dest = highestPriority(preferredLadders)
    return { session: { ladderId: dest, userBand: null, incumbentUnit: pickedUnit }, reading on pickedUnit }

  owners = laddersOwning(pickedUnit)
  dest = session.ladderId if owns pickedUnit else highestPriority(owners)   // L5 / L8 / L9 spirit

  // L5 — non-preferred (or off-ladder): switch + user band from quantized nice → far edge
  // Hybrid B⁺: union full bar window at install mpp (logBarMin + logBarMax) with pick↔far
  niceStop = bestInBoundsNice(pickedUnit, mpp)      // never cold-search Planck
  farLog = userBandFarEdgeLog(dest, pickedUnit)
  logBarMin = log10(BAR_PX_MIN) + log10(mpp)        // fine/target-side headroom
  logBarMax = log10(BAR_PX_MAX) + log10(mpp)        // coarse-end headroom
  userBand = { unit: pickedUnit, ladderId: dest,
               logLo: min(niceStop.logLen, farLog, logBarMin),
               logHi: max(niceStop.logLen, farLog, logBarMax) }  // no band.lo union (I-08)

  return { session: { ladderId: dest, userBand, incumbentUnit: pickedUnit }, reading: niceStop }
```

**Rule-3 / L6 order matters:** find ladders where the pick is **auto-preferred first**, then take highest priority among that subset — do **not** pick highest owner then test preferred-ness only there (Opus / finalist correction). **L6 dest is always `highestPriority(preferredLadders)`** — no stay-on-sticky when sticky also prefers the pick (I-15).

**L12 example:** `1 in` → pick `mi` → `userBand` ≈ bar-min headroom through `2000 mi` (quantized near ∪ install `[BAR_PX_MIN, BAR_PX_MAX]` → standard mi far edge on dest ladder). While active, any in-pool mi stop wins over ft/yd (`userHit`). Auto-clear when mi leaves the bar pool **or** `targetLogLen > logHi` (I-02 / A-pool hybrid) — not merely because `tLog < logLo`.

**Install bar-window headroom (Hybrid B⁺) + A-pool I-02:** L5/L12 install still unions **both** `logBarMin` and `logBarMax` at pick mpp into `[logLo, logHi]` so same-zoom / knife-edge install survives when the quantized pick sits above `targetLogLen` (fine/target side) or at the coarse bar end (e.g. pick `am` while HUD is at `5 pm`). Far edge still caps product `logHi` when it exceeds bar max; that `logHi` is the coarse I-02 cap (`tLog > logHi`). Fine-side lifetime is **pool-exit**, not interval exit past `logLo`. CanvasEditor A6 write-back race guard retained. Sticky re-entry rejected (S2).

### B.8 Popover rungs (6a–6e)

- Closed predicate registry (02): each rule `{ id, type, ...params }` → `UnitId[]`.
- Rungs are **cumulative unions** (ASSUMPTION — freeze with bible): level *n* = union of predicates on rungs 0…*n*.
- Exclude current HUD unit; sort small→large by catalog meters/log; **skip empty leading / no-op rungs** (More never lands on a no-op — e.g. empty 6a at `pm`); flip to table at **> 12**.

| Rung | Predicate types (illustrative ids) |
|------|-------------------------------------|
| 6a | `RelatedLadderAutoShow`, `CurrentLadderAuto(standard-only)`, `CurrentLadderAuto(none)`, `CurrentLadderWithinFactor(50)` |
| 6b | `UnitOnAnyLadderAtZoom`, `AnyLadderAuto(none)`, `RelatedWithinFactor(50)`, `CurrentLadderReadingBand(0.1, 500)` |
| 6c | `AnyLadderReadingBand(0.1, 500)`, `LadderNeighbors(current, ±2)`, `LadderNeighbors(related, ±1)` |
| 6d | `AllUltraStandard`, `NamedUnits(kpc)`, `UnitsMatching(no-si-prefix)` |
| 6e | `AllRegisteredUnits` |

`RelatedLadderAutoShow` = L10 (clean session resolve on each related ladder).

### B.9 Set-scale rungs (7a–7d)

Same expander machinery; thresholds **> 22** → membership table; full catalog only at **7d**. Ladder assignment runs **on save** (L9 / I-16), not on dialog click.

| Rung | Predicates |
|------|------------|
| 7a | `UltraStandardBetween(mm, mi)` |
| 7b | `AllUltraStandard` |
| 7c | `AllLaddersBetween(µm, kpc)`, `CurrentLadderMatching(no-si-prefix)` when has ladder, `CurrentLadderMatching(si-prefixed-meter)` when true-metric |
| 7d | `AllRegisteredUnits` |

Flip to table at **> 22**. On save: `ladderId = highestPriority(ownersOf(unit))` (L9 → `Qpc` ⇒ standard metric); `userBand = null`; seed reading on chosen unit.

### B.10 Session state shape (editor)

```text
// Document meta (persisted)
scaleDef: { value, unit, barPx, zoomAt }

// Ephemeral display session (not a post-render-only ref for correctness)
ScaleSession: {
  ladderId,
  userBand | null,
  incumbentUnit | null,
  lastReading | null,   // optional UI cache
}
```

**Writers (08):**

- Auto resolve → may update `lastReading` / `incumbentUnit` only.
- Pick → `applyUnitPick` owns ladder + userBand + incumbent.
- `commitScaleDef` / meta persist → **must not** reset `ladderId` (kills F4).
- Clear / redefine scale → `clearDisplayPrefs` only.

`ZoomEpoch`: every distinct `effectiveZoom` flush (keep `useKobinEngine` immediate zoom flush). Synthetic bridge epochs are optional animation only (L1).

### B.11 Config constants (initial)

| Constant | Initial value | Notes |
|----------|---------------|--------|
| `BAR_PX_TARGET / MIN / MAX` | 120 / 60 / 180 | Keep unless retuned |
| `PLAIN_MIN / PLAIN_MAX` | 0.001 / 5000 | Then 1/2/5 sci |
| `NICE_MANTISSAS` | [1, 2, 5] | |
| `INCH_FRACTIONS` | 1/8, 1/16, **1/32** | Nice grammar (3a) then decimals at 0.01; **preferred** auto `in` band is still **`1/16`–`1`** (§5 owner) |
| `LADDER_PRIORITY` | SM → SI → UM → UI → TM | Bible §2 |
| `HYSTERESIS_ENTER_PAST_EDGE` | **0.05** (~5%) | L2; tunable; **wired** in `resolveReading` — gates band/prefer release; does not override L3/L4 handoff or promote |
| *(exit hold)* | incumbent still in pool | L2 exit = full allowed bar range; no separate `HYSTERESIS_EXIT_*` constant (removed unused export) |
| `HANDOFF_WINNERS` | e.g. `(standard-imperial, ft∩yd) → yd`; `(standard-imperial, yd∩mi when 0.5 mi fits) → mi`; `(standard-imperial, µm∩mil) → mil`; `(standard-imperial, mil∩in) → in` (`50 mil` ↔ `1/16 in`); `(ultra-standard-imperial, ft∩mi when 0.25 mi fits) → mi` | L3, L4, §5 yd→0.5 mi, µm→mil, mil↔in |
| `PREFERRED_BANDS` | Bible §5 PROPOSED + **ultra `mi`: 0.25–1** + **standard-imperial `in`: `1/16`–`1`** (owner; `1/32` = nice grammar only) + **`mil`: 1–50** | L4 update; mil↔in / µm→mil handoffs |
| `PROMOTE_NEXT_GE1` | e.g. standard-imperial `µm→mil`, `in→ft`; metric `cm→m` / `m→km` as §5 | I-01; µm→mil flip at 1 mil |
| `POPOVER_TABLE_AT` | 12 | |
| `SET_SCALE_TABLE_AT` | 22 | |

---

## C. Implementation boundaries

| Boundary | Rule |
|----------|------|
| **UX surface** | Unchanged (bible §1 / constraint 9). Same HUD quietness, popover shell, set-scale dialog, Clear. Only membership depth and reading choice change. |
| **Migration** | Replace brittle `previousHud` walk in `scaleBar.js` **over time**. Prefer clean modules under `boundless/src/engine/scaleBar/`; keep thin adapters / re-exports so `CanvasEditor`, `ScaleUnitPicker`, and tests keep compiling. |
| **Numeric** | Prefer **log-space** for unit meters and mpp comparisons (L11). Do not leave extreme zoom on raw float `meters` alone. |
| **Correctness vs animation** | Absolute resolve is source of truth (L1). No Option 05 walker. No far-pin (L12). |
| **Configurability** | Bands, handoffs, rung predicates, hysteresis margins, bar/nice constants = data (constraint 8). Preference **order** (user → band → handoff → ≥1 → bar) is **not** a free-form editable score order. |
| **Tests** | Map [`scale-bar-test-catalog.md`](./scale-bar-test-catalog.md) 1:1; coalesced suites use `lastReading = null` and large Δmpp; interpret temporal wording as target-mpp expectations (L1). |

---

## D. Open items still deferred

Use Opus / bible DRAFT assumptions; mark **ASSUMPTION** in config comments until product edits.

| Item | ASSUMPTION for first build |
|------|----------------------------|
| **True-metric band widths** (`dm`/`dam`/`hm`, `Mm`…`Qm`) | Bible §5 PROPOSED decade defaults (`1…5` short land; `1…500` mega–quetta). |
| **Bodies / 6d classification** (`R☉`, `R⊕`, `ld`, non-SI-prefix) | Catalog `family` / `siPrefixBase` predicates; bodies + imperial + astro without SI prefix match 6d `no-si-prefix`; explicit `kpc` rule remains. |
| **Sci glyph style** | Keep as-built `formatScaleNumber` / Unicode style; only plain↔sci **thresholds** are config. |
| **Ultra sub-ℓP** | Ultra auto-walk floors at `ℓP`; sub-ℓP only via deep picker (6e/7d) from global catalog; below `1 ℓP` on ultra → sci on `ℓP` within bar bounds. |
| **Rung cumulativity** | ASSUMPTION: cumulative unions (see §B.8); confirm in bible when convenient. |
| **Hysteresis priority** | L2 enter ~5% **wired**; Q4 preferred-range remains primary anti-flicker. |

---

## E. Definition of done — first build

Ship when all of the following are true:

1. **Modules exist** under `scaleBar/` (or equivalent) with catalog / membership / preference / resolve / pick / rungs; `scaleBar.js` is a thin adapter or fully migrated call sites.
2. **`resolveReading`** is absolute on the sticky ladder; large single-frame Δmpp matches target-mpp golden cases (`T-F1-*`, `T-Z-*` as target matrices); no bridge required for green.
3. **Five ladders** + priority + related tables match bible §2; ultra inventories omit `yd`/`mil`/`ld`/`R☉`/`R⊕` with absorption via bands (L4 ultra mi `0.25–1`).
4. **`applyUnitPick`** implements L5–L7 and L12 (user bands only; no far-pin); L6 preferred-elsewhere = switch only; sticky ladder through `Qpc` (L8); set-scale `Qpc` → standard metric (L9).
5. **Handoffs:** `200 yd` beats `500 ft` (L3); ultra `0.25 mi` beats ft when it fits (L4).
6. **Popover / set-scale** use closed predicate config; related peer = auto-show (L10); table flips at 12 / 22.
7. **Log-length path** used for extremes; no thrown errors on float limits (L11); bar always in bounds.
8. **Session contracts:** `lastReading` optional; meta writes do not clear `ladderId`; Clear/redefine resets session.
9. **UX chrome** unchanged (manual `T-R9-01` pass).
10. **Catalog mapping:** core `T-R*`, `T-P*`, `T-U*`, `T-R5*`, `T-POP*`, `T-SET*`, `T-Z*` (target form) have automated or explicitly skipped-with-ticket coverage; deferred ASSUMPTIONs documented in config.

**Explicitly out of first-build scope:** Option 05 walker, far-pin revival, editable score-order engines, full `ScaleMagnitude` decimal library if log-length suffices.

---

## Appendix — Authority & supersedence

| Doc | Role |
|-----|------|
| [`scale-bar-ruling-design-bible.md`](./scale-bar-ruling-design-bible.md) | Product constraints, ladders, §5 bands, failure modes |
| **This file** | Ruling implementation plan; locked Q&A (A); build architecture (B–E) |
| [`scale-bar-test-catalog.md`](./scale-bar-test-catalog.md) | Acceptance specs (interpret coalesced cases per L1) |
| [`scale-bar-design-options/`](./scale-bar-design-options/) | Historical proposals; not binding once this file exists |

Where this file’s **Locked product decisions** conflict with older PROPOSED band cells or option docs, **this file wins** until the bible is updated to match.
