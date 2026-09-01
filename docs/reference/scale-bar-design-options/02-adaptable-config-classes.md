# Design Option 02 — Adaptable Config + Classes

**Status:** proposal (docs only; not implemented).  
**Authority:** [scale-bar-ruling-design-bible.md](../scale-bar-ruling-design-bible.md)  
**Acceptance:** [scale-bar-test-catalog.md](../scale-bar-test-catalog.md)  
**Sibling options:** [`./`](./)

This proposal is a **brand-new** engine architecture. It keeps the UX surface of bible §1 and satisfies constraints 1–9, but replaces the as-built heuristic soup (`LADDER_PROMOTE_AT`, special-case bridges, `minUnit` lock, hard-wired picker levels) with a **data-first** model: named constants, declarative tables, and small classes whose behavior is driven by config.

---

## 1. Thesis

Make every product rule a **named, movable piece of data**. The walk core only knows how to:

1. Generate in-bounds 1/2/5 (and inch-fraction) candidates on a ladder.
2. Score candidates against an ordered preference stack.
3. Expand picker/dialog membership by evaluating an ordered list of **predicate rules**.
4. Apply user overrides as first-class range objects with explicit teardown.

Retuning a preferred band, swapping a popover predicate between rungs, or adding a sixth ladder should be a **config edit**, not a rewrite of `pickScaleReading`.

---

## 2. Metaphor

**Railroad switchyard.**

- **Ladders** are parallel tracks (five named routes).
- **Preferred ranges** are speed zones painted on each track — the train stays in-zone until the next zone is clearly better.
- **Related-ladder tables** are signed transfer platforms between tracks.
- **Rung rules** are ticket windows: each “more” opens the next window’s predicate list; empty windows are skipped.
- **User preferred ranges** are temporary private speed zones the passenger paints; leaving the zone (or changing tracks) tears the paint down.
- The **dispatcher** (`ScaleBarEngine`) never invents routes — it only reads the timetable (config) and the train’s current car (`PreferenceState`).

As-built code is a single engineer who memorized every junction. This design is a switchyard with labeled levers.

---

## 3. Types / modules

### 3.1 Module map (proposed)

```
scaleBarConfig.js          // pure data: constants, ladders, ranges, rung rules, related map
scaleBarRegistry.js        // UnitRegistry + Ladder built from config (meters, ranks, kinds)
scaleBarNice.js            // NiceNumberPolicy (1/2/5, plain↔sci, inch fractions)
scaleBarPreference.js      // PreferredRange, UserPreferredRange, PreferenceState
scaleBarCandidates.js      // CandidateGenerator (bar-bounds filter)
scaleBarScorer.js          // PreferenceScorer (constraint 4 stack)
scaleBarWalk.js            // WalkBridge (coalesced zoom; durable walk cursor)
scaleBarPicker.js          // RungRuleEngine (popover 6a–6e, set-scale 7a–7d)
scaleBarEngine.js          // ScaleBarEngine.compute / applyPick / clear
scaleBar.js                // thin re-exports for CanvasEditor compatibility
```

UI (`CanvasEditor`, `ScaleUnitPicker`, `useKobinEngine`) stays chrome-identical; it talks only to `ScaleBarEngine` + existing HUD shape.

### 3.2 Core classes

| Class | Responsibility |
|-------|----------------|
| **`ScaleBarConfig`** | Immutable bag of named constants + tables. Loaded once; tests can clone-and-mutate for T-R8. |
| **`UnitRegistry`** | Global unit → meters, kind, SI-prefix flag, owning ladder ids. Built from ladder inventories. |
| **`Ladder`** | Ordered rungs for one `stackId`; rank lookup; neighbor ±N; ceiling/floor unit. |
| **`NiceNumberPolicy`** | Emits candidate magnitudes for a unit given zoom direction + plain/sci bands + inch mode. |
| **`PreferredRange`** | `{ unit, min, max }` on a ladder (standard band from §5). |
| **`UserPreferredRange`** | Extends preferred range with `ladderId`, `createdFromMeters`, teardown rules. |
| **`PreferenceState`** | Durable session state: `currentLadderId`, optional `userRange`, optional near/far pin, `walkCursor` (replaces fragile `previousHud`-only coupling). |
| **`CandidateGenerator`** | For mpp + ladder → readings with `barPx ∈ [MIN, MAX]`. |
| **`PreferenceScorer`** | Orders candidates: stay-ladder → in preferred/user range → prefer ≥1 → bar-target proximity. |
| **`WalkBridge`** | When Δmpp is large, steps along the ladder using the same scorer so coalesced zoom cannot skip rungs (F1/F6). |
| **`RungRuleEngine`** | Evaluates declarative predicate lists for popover/dialog levels; skips empty; flips to table past thresholds. |
| **`ScaleBarEngine`** | Public façade: `compute`, `classifyPick`, `pickerOptions`, `setScaleOptions`, `clear`. |

No `pinMode: "stack"` without a pinned unit (F10). Pins are either `{ mode: "near"|"far", unit }` or absent.

### 3.3 Key value types (conceptual)

```ts
type LadderId =
  | "standard-metric"
  | "standard-imperial"
  | "ultra-standard-metric"
  | "ultra-standard-imperial"
  | "true-metric";

type Reading = {
  value: number;
  unit: string;
  barPx: number;
  ladderId: LadderId;
  meters: number;       // value × unitMeters
  label?: string;       // fraction / sci display
};

type WalkCursor = {
  reading: Reading;
  metersPerPx: number;
};

type PreferenceState = {
  ladderId: LadderId;
  userRange: UserPreferredRange | null;
  pin: { mode: "near" | "far"; unit: string } | null;
  walkCursor: WalkCursor | null;
};
```

---

## 4. APIs / data flow

### 4.1 Compute path

```
effectiveZoom + scaleDef + PreferenceState
        │
        ▼
 metersPerPxNow = f(scaleDef, zoom)     // same physics as as-built (constraint 1)
        │
        ▼
 if pin.mode === "far" → NiceNumberPolicy on pinned unit only
        │
        ▼
 WalkBridge.ensureCursor(state, mpp)    // if |Δmpp| large, step along ladder
        │
        ▼
 CandidateGenerator.on(state.ladderId, mpp)
        │
        ▼
 PreferenceScorer.pick(candidates, state, config.preferredRanges)
        │
        ▼
 Reading + updated walkCursor (never null after successful compute)
        │
        ▼
 HUD { value, unit, barPx, stack, metersPerPx, displayLabel? }
```

**Sticky ladder:** `PreferenceState.ladderId` is authoritative. Shared units (`Qpc`, `AU`, …) never re-resolve ownership via `stackForUnit` during auto-walk (F3). Ownership resolution runs only on pick / set-scale / clear.

**Anti-flicker (Q4):** Standard + user preferred ranges are the only hysteresis. No `minUnit` / `minUnitZoomAt`. Scorer treats “still inside current unit’s preferred band” as a strong stickiness bonus so small zoom noise does not flip at handoff boundaries (T-P-07).

### 4.2 User pick path (constraint 5)

```
classifyPick(unit, state, mpp) →
  owners = registry.laddersOwning(unit)
  dest = highestPriority(owners)           // config.LADDER_PRIORITY
  preferredOnDest = scorer.autoUnit(dest, mpp) === unit

  if unit not on state.ladderId:
    state.ladderId = dest
    clear prior userRange
    if !preferredOnDest:
      state.userRange = UserPreferredRange.fromCurrentToBandEdge(...)
    // else: switch only (rule 3 / T-R5-05)
  else if unit !== autoUnit(state.ladderId, mpp):
    if preferredOnOtherLadder(unit, mpp):
      state.ladderId = that ladder; no userRange
    else:
      state.userRange = UserPreferredRange.fromCurrentToBandEdge(...)
  seed walkCursor from a reading on (unit, nice value at mpp)
```

Teardown: picking a different unit **while meters are inside** the user range clears the whole range. Any ladder switch clears prior user range first (then rule 1 may install a new one).

### 4.3 Picker / set-scale path

```
RungRuleEngine.expand({
  surface: "popover" | "setScale",
  level,
  context: { currentUnit, state, mpp, registry, scorer }
}) →
  for each rule in config.rungs[surface][level]:
    union rule.evaluate(context)
  exclude current (popover)
  sort small → large
  skip empty levels
  if count > TABLE_FLIP → full-name table (+ trailing more if truncated)
```

Moving a rule from 6a to 6b = cut/paste one object in the rung array.

### 4.4 What UI must stop doing

| As-built hazard | This design |
|-----------------|-------------|
| `prevHudForCalcRef` as sole walk memory | `PreferenceState.walkCursor` owned by engine; UI stores/passes opaque state blob |
| `commitScaleDef` → `resetDisplayFloor()` | Meta writes never clear `ladderId` unless Clear / new Set scale |
| Far pick clears `previousHud` | Far pick sets pin + seeds `walkCursor` on pinned unit |
| `pinMode: "stack"` null pin | Removed from API |

---

## 5. Config shape for rules 1–9

All of the following live in **`scaleBarConfig.js`** (or split `*Config` files imported into one `ScaleBarConfig`). Core classes import config; they do not hard-code bible numbers.

### Rule 1 — Zoom accuracy

```js
export const ZOOM = {
  // Physics unchanged: mpp from scaleDef; use same PLANCK_LENGTH_M registry meters.
  // WalkBridge uses log-space stepping so float stress does not skip ranks.
  BRIDGE_MPP_RATIO_TRIGGER: 1.35,   // enter bridge if |mpp ratio| outside [1/r, r]
  BRIDGE_STEP_FACTOR: 1.3,          // per bridge micro-step
  BRIDGE_MAX_STEPS: 64,
};
```

Engine keeps as-built meter derivation; bridge is config-tuned, not special-cased per unit pair.

### Rule 2 — Bar length bounds

```js
export const BAR = {
  PX_TARGET: 120,
  PX_MIN: 60,
  PX_MAX: 180,
  MIN_DRAG_PX: 12,
};
```

`CandidateGenerator` rejects any reading outside `[PX_MIN, PX_MAX]`. Target used only as soft score.

### Rule 3 / 3a — Nice multiples + inch fractions

```js
export const NICE = {
  MANTISSAS: [1, 2, 5],
  PLAIN_MIN: 0.001,
  PLAIN_MAX: 5000,
  SCI_MANTISSAS: [1, 2, 5],
  INCH: {
    FRACTIONS: [
      { value: 1 / 8, label: "1/8" },
      { value: 1 / 16, label: "1/16" },
      { value: 1 / 32, label: "1/32" },
    ],
    // After finest fraction, decimals begin at:
    DECIMAL_FLOOR: 0.01,
    WHOLE: [1, 2, 5, 10],
  },
};
```

`NiceNumberPolicy` is the only place that knows fractions vs decimals vs sci. Ceiling units use the same `PLAIN_MAX` then sci (ultra `pc`, standard `Qpc`).

### Rule 4 — Auto unit preference

```js
export const LADDER_PRIORITY = [
  "standard-metric",
  "standard-imperial",
  "ultra-standard-metric",
  "ultra-standard-imperial",
  "true-metric",
];

export const RELATED_LADDERS = {
  "ultra-standard-imperial": ["ultra-standard-metric", "standard-imperial"],
  "ultra-standard-metric": ["ultra-standard-imperial", "standard-metric"],
  "standard-metric": ["ultra-standard-metric", "true-metric", "standard-imperial"],
  "true-metric": ["ultra-standard-metric", "standard-metric", "standard-imperial"],
  "standard-imperial": ["ultra-standard-imperial", "standard-metric", "true-metric"],
};

export const LADDERS = {
  "standard-metric": {
    id: "standard-metric",
    rungs: [/* qℓP…Qpc per bible §3/§5 */],
  },
  "standard-imperial": { /* … */ },
  "ultra-standard-metric": {
    rungs: ["ℓP", "fm", "pm", "nm", "µm", "mm", "cm", "m", "km", "AU", "ly", "pc"],
  },
  "ultra-standard-imperial": {
    rungs: ["ℓP", "fm", "pm", "nm", "µm", "in", "ft", "mi", "AU", "ly", "pc"],
  },
  "true-metric": { /* … */ },
};

/** Per-ladder preferred magnitude bands (§5 PROPOSED). Easy to edit. */
export const PREFERRED_RANGES = {
  "standard-imperial": {
    ft: { min: 2, max: 500 },
    yd: { min: 200, max: 500 },
    mi: { min: 0.5, max: 1 },
    // …
  },
  "ultra-standard-imperial": {
    ft: { min: 2, max: 5000 },  // absorbs yd
    ly: { min: 1, max: 5000 },
    pc: { min: 200, max: 5000 },
    // …
  },
  "ultra-standard-metric": {
    km: { min: 1, max: 5000 },  // absorbs Mm/R☉
    ly: { min: 1, max: 5000 },
    pc: { min: 200, max: 5000 },
    // …
  },
  // standard-metric, true-metric: full §5 tables
};

export const SCORE_WEIGHTS = {
  STAY_LADDER: 1_000_000,
  IN_USER_RANGE: 500_000,
  IN_STANDARD_RANGE: 100_000,
  PREFER_GE_ONE: 50_000,       // bonus for value === 1 on next unit when eligible
  BAR_TARGET_PROXIMITY: 1,     // soft: |barPx - TARGET|
  STICKINESS: 10_000,          // same unit as walkCursor while still in band
};
```

Scorer applies weights in constraint-4 order; weights themselves are tunable constants (T-R8).

### Rule 5 — User preference overrides

```js
export const USER_RANGE = {
  // Edge of user range = standard preferred band edge for that unit on dest ladder.
  // Construction: metersFrom = current reading meters;
  //               metersTo   = bandEdgeMeters(unit, ladder, PREFERRED_RANGES);
  TEARDOWN_ON_IN_RANGE_UNIT_CHANGE: true,
  CLEAR_ON_LADDER_SWITCH: true,
  // Far-pin release: when auto reading on sticky ladder reaches ≥1 of pinned unit
  // (list remains data, not hard-wired release logic).
  FAR_PIN_RELEASE_AT_ONE: ["ft", "yd", "mi", "m", "km", "AU", "ly", "pc" /* … */],
};
```

`UserPreferredRange.fromCurrentToBandEdge(currentMeters, unit, ladderId, config)` is the single constructor used by all constraint-5 paths (T-R5-06/07).

### Rule 6 — HUD popover rungs (declarative predicates)

```js
export const POPOVER = {
  TABLE_FLIP_AT: 12,
  EXCLUDE_CURRENT: true,
  SORT: "small-to-large",
  RUNGS: [
    /* level 0 = 6a */ [
      { id: "related-auto-show", type: "RelatedLadderAutoShow" },
      { id: "discard-user-prefs", type: "CurrentLadderAuto", prefs: "standard-only" },
      { id: "discard-all-prefs", type: "CurrentLadderAuto", prefs: "none" },
      { id: "within-factor", type: "CurrentLadderWithinFactor", factor: 50 },
    ],
    /* level 1 = 6b */ [
      { id: "current-on-any-ladder", type: "UnitOnAnyLadderAtZoom" },
      { id: "any-ladder-no-prefs", type: "AnyLadderAuto", prefs: "none" },
      { id: "related-within-factor", type: "RelatedWithinFactor", factor: 50 },
      { id: "current-reading-band", type: "CurrentLadderReadingBand", min: 0.1, max: 500 },
    ],
    /* level 2 = 6c */ [
      { id: "any-reading-band", type: "AnyLadderReadingBand", min: 0.1, max: 500 },
      { id: "neighbors-current", type: "LadderNeighbors", ladder: "current", up: 2, down: 2 },
      { id: "neighbors-related", type: "LadderNeighbors", ladder: "related", up: 1, down: 1 },
    ],
    /* level 3 = 6d */ [
      { id: "all-ultra", type: "AllUnitsOnLadders", ladders: ["ultra-standard-metric", "ultra-standard-imperial"] },
      { id: "kpc", type: "NamedUnits", units: ["kpc"] },
      { id: "non-si-prefix", type: "UnitsMatching", predicate: "no-si-prefix" },
    ],
    /* level 4 = 6e */ [
      { id: "all", type: "AllRegisteredUnits" },
    ],
  ],
};
```

**Predicate registry:** each `type` maps to a class/function `(ctx, params) → string[]`. Reordering or moving `{ type: "CurrentLadderWithinFactor", factor: 50 }` between rungs is a one-line config change (constraint 8 / T-R8-01).

`RelatedLadderAutoShow` uses the scorer on each related ladder at current mpp (Q3) — not log-distance peers.

### Rule 7 — Set-scale dialog rungs

```js
export const SET_SCALE = {
  TABLE_FLIP_AT: 22,
  INCLUDE_CURRENT: true,
  RUNGS: [
    /* 7a */ [
      { id: "ultra-everyday", type: "UltraStandardBetween", from: "mm", to: "mi" },
    ],
    /* 7b */ [
      { id: "all-ultra", type: "AllUnitsOnLadders",
        ladders: ["ultra-standard-metric", "ultra-standard-imperial"] },
    ],
    /* 7c */ [
      { id: "um-to-kpc", type: "AllLaddersBetween", from: "µm", to: "kpc" },
      { id: "current-non-prefix", type: "CurrentLadderMatching", predicate: "no-si-prefix",
        when: "has-current-ladder" },
      { id: "true-si-meters", type: "CurrentLadderMatching", predicate: "si-prefixed-meter",
        when: "current-ladder-is-true-metric" },
    ],
    /* 7d */ [
      { id: "all", type: "AllRegisteredUnits" },
    ],
  ],
  // On save: ladderId = highest LADDER_PRIORITY owner of chosen unit
};
```

### Rule 8 — Configurability (meta)

Satisfied by construction: ladders, related map, preferred ranges, nice bands, bar bounds, rung predicate arrays, and score weights are all data. The walk/picker cores are interpreters.

**Retune checklist (no core rewrite):**

| Change | Edit |
|--------|------|
| Ultra `ly` max 500→5000 | `PREFERRED_RANGES["ultra-standard-metric"].ly.max` |
| Move “within 50×” from 6a to 6b | Cut object from `POPOVER.RUNGS[0]` → `[1]` |
| Add related ladder | `RELATED_LADDERS[id].push(...)` |
| Change table flip 12→16 | `POPOVER.TABLE_FLIP_AT` |
| Narrow true-metric `hm` band | `PREFERRED_RANGES["true-metric"].hm` |

### Rule 9 — UX sameness

No config for chrome. Engine returns the same HUD fields; picker still returns `{ chips | table, more? }`. Constraint 9 is an integration invariant, not a data table.

---

## 6. Failure-mode avoidance

| ID | Avoidance in this design |
|----|---------------------------|
| **F1** | `WalkBridge` always steps through intermediate ranks on large Δmpp using the same scorer; feet cannot be skipped when `10 in` → land band. Prefer-≥1 + `ft` preferred band encoded in data. |
| **F2** | Picks always seed `walkCursor` on the chosen unit; never clear walk state. Cross-ladder `dm` pick sets true-metric + cursor on `dm`. |
| **F3** | Auto-walk never calls `stackForUnit`; sticky `PreferenceState.ladderId` survives `Qpc` and shared astro units. |
| **F4** | Preference/meta persistence updates ranges only; `commitScaleDef`-equivalent must not reset `ladderId`. Far-pin release clears pin, keeps ladder + cursor. |
| **F5** | `walkCursor` is part of durable preference state passed into `compute`, not a post-render ref alone. UI may still cache it, but engine treats missing cursor as cold-start with demotion rules (F7), not anchor stickiness forever. |
| **F6** | Catalog requires coalesced cases; `WalkBridge` is the production path those tests exercise. |
| **F7** | Cold start: if anchor reading’s `barPx > PX_MAX` (or `< PX_MIN`), generator demotes/promotes until in bounds — no “prefer anchor when !previousHud” stall. |
| **F8** | `NICE.INCH.FRACTIONS` includes `1/32`; policy walks fractions before `DECIMAL_FLOOR`. |
| **F9** | Single config module is the code mirror of bible §2/§5; older v1 docs remain non-authoritative. |
| **F10** | API rejects `pin` without `unit`; no stack-only pin mode. |

---

## 7. Test mapping

| Catalog area | How this design proves it |
|--------------|---------------------------|
| **T-R1 / T-R2** | Generator + BAR constants; extreme zoom on ceiling/floor units |
| **T-R3 / T-R3a / T-IN-*** | `NiceNumberPolicy` unit tests against `NICE` config |
| **T-R4 / T-P-*** | Scorer + `PREFERRED_RANGES` fixtures (incl. yd vs 500 ft, ultra ft→5000) |
| **T-R5-*** | `classifyPick` / `UserPreferredRange` construction & teardown |
| **T-R6 / T-POP-*** | `RungRuleEngine` with `POPOVER.RUNGS`; assert membership sets |
| **T-R7 / T-SET-*** | Same engine, `SET_SCALE.RUNGS`; table flip at 22 |
| **T-R8-01** | Clone config, change ultra `ly.max`, assert walk without code change |
| **T-R9** | Manual / snapshot of chrome (no engine assert) |
| **T-F1 / T-Z-*** | `WalkBridge` with large mpp ratios |
| **T-F2 / T-F5 / T-F7** | Pick seeding + cold-start demotion |
| **T-F3 / T-F4** | Sticky `ladderId` through shared units & pin release |
| **T-F8** | Inch fraction list |
| **T-F10** | API contract test |
| **T-U-*** | Ultra ladder inventories + absorption bands in `PREFERRED_RANGES` |
| **T-X-*** | `clear()` / redefine scale resets `PreferenceState` |

Implementation can map each catalog id to one `it(...)` that injects a `ScaleBarConfig` fixture — no need to fork logic for tests.

---

## 8. Tradeoffs

| Pros | Cons |
|------|------|
| Constraint 8 is structural, not aspirational | More files / indirection than today’s single `scaleBar.js` |
| Rung rules and preferred bands editable by non-walk experts | Predicate DSL must be documented; bad config can silently empty a rung |
| Removes special-case promote/demote helpers that drift from docs | Initial port cost: re-express §5 tables and 6a–7d as data |
| Durable `PreferenceState` fixes F2–F5 class bugs by design | UI must thread state explicitly (small CanvasEditor change) |
| Score weights make preference debugging inspectable | Weights can be over-tuned; need catalog golden cases as anchors |
| Classes give clear ownership (Nice vs Scorer vs RungEngine) | Risk of “framework for one feature” if predicates proliferate — mitigate by keeping ≤12 predicate types |

**Non-goals of this option:** changing HUD chrome; inventing new units; keeping `minUnit` as a parallel lock; log-distance peers for 6a.

---

## 9. Assumptions for open bible items

Until the owner edits the bible, this proposal assumes:

| Open item | Assumption |
|-----------|------------|
| **True Metric** `dm`/`dam`/`hm` and `Mm`…`Qm` widths | Use §5 PROPOSED decade defaults (`1…5` for short true-metric land; `1…500` for mega–quetta). Encoded only in `PREFERRED_RANGES["true-metric"]` so a later edit is data-only. |
| **Body/astro extras** (`R☉`, `R⊕`, `ld`, `Tpc`…) preferred widths | Use §5 PROPOSED bands. For popover **6d** `no-si-prefix`: treat `kind ∈ {body, astro, imperial, planck}` and any unit without `prefixShort` as matching — so `R☉`, `ld`, `AU`, `ly`, `pc`, `in`, … appear; SI-prefixed meters/parsecs do not (except explicit `kpc` rule). |
| **Sci display style** | Keep as-built Unicode / existing `formatScaleNumber` behavior; only the plain↔sci **thresholds** are config (`NICE.PLAIN_*`). |
| **Ultra ℓP / sub-ℓP** | Ultra inventories **floor at `ℓP`** for auto-walk and preferred ranges. Sub-ℓP (`qℓP`…`mℓP`) remain on standard/true ladders only; they can still appear via deeper picker rungs (6e / 7d) from the global registry, but ultra auto-walk never selects them. Below `1 ℓP` on ultra → sci on `ℓP` within bar bounds. |

No clarifying questions — these assumptions unblock the design; owner can override via config tables without changing the architecture.

---

## 10. Evaluation checklist (bible §7)

- [x] **UX unchanged** — chrome out of scope; same HUD fields.
- [x] **Five ladders** + related + priority as data.
- [x] **Bar bounds** + extreme zoom via generator + bridge.
- [x] **1/2/5 + inch 1/32** via `NiceNumberPolicy` / `NICE`.
- [x] **Preference stack + user ranges**; no minUnit lock; §5 bands as `PREFERRED_RANGES`.
- [x] **Popover/dialog rungs** as reorderable predicate arrays.
- [x] **No sole dependence on previousHud** — `walkCursor` + `WalkBridge`.
- [x] **Sticky display ladder** in `PreferenceState`.
- [x] **Manual picks seed cursor** — no Planck cold-start.
- [x] **Catalog mappable 1:1**.
- [x] **Bible wins** over older drafts.
- [x] **Lives under** `scale-bar-design-options/`.

---

## 11. Summary

Option 02 treats the scale bar as a **config-driven switchyard**: ladders, preferred ranges, related maps, and rung predicates are declarative; classes only interpret them. That directly serves constraint 8 and systematically retires the failure modes caused by hard-wired promotes, cleared walk refs, and sticky-stack wipes — without changing what the user sees.
