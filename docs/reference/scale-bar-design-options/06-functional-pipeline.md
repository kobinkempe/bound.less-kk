# Design Option 06 — Pure Functional Pipeline

**Status:** proposal (docs only; not adopted).  
**Authority:** [`../scale-bar-ruling-design-bible.md`](../scale-bar-ruling-design-bible.md) · [`../scale-bar-test-catalog.md`](../scale-bar-test-catalog.md)  
**UX surface:** unchanged (bible §1 / constraint 9).

---

## Thesis

Replace the as-built `computeScale` + React-ref walk (`previousHud`, `prevHudForCalcRef`, near/far pins, `minUnit` lock) with a **three-layer pure pipeline**:

1. **World scale math** — meters-per-pixel and bar geometry only.  
2. **Unit preference policy** — absolute candidate enumeration + lexicographic scoring (stay-ladder → preferred range → prefer ≥1 → bar target).  
3. **UI rung assembly** — popover / set-scale membership as reorderable predicates over the same immutable snapshot.

Every frame is `f(immutable inputs, config) → { reading, pickerOptions }`. Correctness under coalesced zoom does **not** depend on a hidden walk ref: large Δzoom is just a new `metersPerPx`. Preference stickiness lives in an explicit `PreferenceState` value (ladder + optional user range), owned by the editor and passed in — never mutated inside the engine.

---

## Metaphor

**Surveyor’s kit, not a breadcrumb trail.**

- The **tape** (world math) measures how many meters one pixel spans.  
- The **field book** (preference policy) picks which labeled mark to announce, using written rules and sticky notes (ladder + user range) — not by remembering the last shout.  
- The **catalog pages** (rung assembly) decide which alternate marks to offer when the surveyor opens the book to “more.”

Skipping intermediate zooms is fine: the tape still reads the ground; the field book still applies the same rules to that reading. You do not need to walk every meter between here and there to know which mark is preferred.

---

## Function graph

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Immutable inputs                                                         │
│   ScaleAnchor { value, unit, barPx, zoomAt }                             │
│   effectiveZoom                                                          │
│   PreferenceState { ladderId, userRange? }                               │
│   moreLevel (popover | set-scale)                                        │
│   ScaleConfig (data)                                                     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L1  World scale math                                                     │
│   metersPerPx(anchor, zoom) → Mpp                                        │
│   barPx(value, unitId, mpp) → px                                         │
│   niceMagnitudes(unitId, cfg) → number[]                                 │
│   candidatesOnLadder(ladderId, mpp, cfg) → Candidate[]                   │
│   candidatesAllLadders(mpp, cfg) → Candidate[]   (for pickers / peers)   │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L2  Unit preference policy                                               │
│   score(candidate, PreferenceState, cfg) → Score                         │
│   selectReading(candidates, PreferenceState, cfg) → Reading              │
│   resolvePick(unitId, Reading, PreferenceState, cfg) → PreferenceState'  │
│   autoOnLadder(ladderId, mpp, PreferenceState|null, cfg) → Reading       │
│     (null prefs = discard user; empty prefs = discard all prefs)         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L3  UI rung assembly                                                     │
│   popoverUnits(moreLevel, snapshot, cfg) → PickerResult                  │
│   setScaleUnits(moreLevel, ladderId?, cfg) → PickerResult                │
│   skipEmptyRungs / tableFlip(>12 | >22)                                  │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
                     { reading, preferenceHints?, picker }
```

**Editor / React boundary (impure shell only):**

```text
CanvasEditor
  holds PreferenceState in React state (or doc-ephemeral meta)
  on zoom:  reading = selectReading(...pure...)
  on pick:  PreferenceState' = resolvePick(...pure...); setState
  on Clear / redefine scale: reset PreferenceState
  NEVER: engine writes refs; NEVER: previousHud required for correctness
```

Optional soft input `lastReading` may be passed for **tie-break only** when two candidates share an identical `Score` (e.g. exact band edge). It must not gate search windows or bridge steps. Prefer fixing ties via inclusive preferred bands + tiny configurable hysteresis margin in L2 before relying on `lastReading`.

---

## Types

```ts
/** Anchor committed by Set scale (doc meta). */
type ScaleAnchor = {
  value: number;
  unitId: UnitId;
  barPx: number;       // drag length at commit
  zoomAt: number;      // effectiveZoom at commit
};

type LadderId =
  | "standard-metric"
  | "standard-imperial"
  | "ultra-standard-metric"
  | "ultra-standard-imperial"
  | "true-metric";

type UnitId = string; // registry key: "ft", "µm", "ℓP", …

/** Explicit sticky preference — replaces displayStack + pins + minUnit. */
type PreferenceState = {
  ladderId: LadderId;
  /** User preferred range on ladderId; outranks standard bands. */
  userRange: UserPreferredRange | null;
};

type UserPreferredRange = {
  unitId: UnitId;
  /** Inclusive magnitude bounds in that unit’s display space. */
  minValue: number;
  maxValue: number;
};

type Mpp = number; // meters per pixel at current zoom

type Candidate = {
  ladderId: LadderId;
  unitId: UnitId;
  value: number;       // nice magnitude (incl. inch fractions as numbers)
  barPx: number;
  meters: number;      // value × unitMeters(unitId)
  label: string;       // formatted (fractions / plain / sci)
};

/** Lexicographic score — compare field-by-field, first difference wins. */
type Score = {
  fitsBounds: 0 | 1;           // must be 1 to win
  onStickyLadder: 0 | 1;       // constraint 4.1
  inUserRange: 0 | 1;          // constraint 5
  inStandardPreferred: 0 | 1;  // constraint 4.2 / §5 table
  preferGeOne: 0 | 1;          // constraint 4.3 (value ≥ 1 when competing)
  barTargetCloseness: number;  // higher = closer to BAR_PX_TARGET (or −|Δ|)
  // optional lastReading tie-break applied only after full Score equality
};

type Reading = {
  value: number;
  unitId: UnitId;
  barPx: number;
  ladderId: LadderId;
  metersPerPx: Mpp;
  label: string;
};

type PickerResult = {
  units: UnitId[];           // sorted small → large; current excluded for HUD
  presentation: "chips" | "table";
  moreAvailable: boolean;
};

/** Full immutable snapshot for one HUD/picker evaluation. */
type ScaleSnapshot = {
  anchor: ScaleAnchor;
  effectiveZoom: number;
  preference: PreferenceState;
  moreLevel: number;
  surface: "hud-popover" | "set-scale";
};
```

**No engine types for:** `previousHud`, `pinMode`, `pinnedUnit`, `minUnit`, `minUnitZoomAt`, `bridgePreviousHudAcrossJump`. Those as-built concepts are absorbed into `PreferenceState` + absolute scoring (or deleted).

---

## Config

All retunable without touching walk/score core (constraint 8). Suggested shape:

```ts
type ScaleConfig = {
  bar: { minPx: number; maxPx: number; targetPx: number }; // 60 / 180 / 120

  nice: {
    mantissas: number[];              // [1, 2, 5]
    plainMin: number;                 // 0.001
    plainMax: number;                 // 5000
    inchFractions: number[];          // [1/8, 1/16, 1/32] (+ wholes via mantissas)
    inchDecimalFloor: number;         // 0.01 after fractions
  };

  ladders: Record<LadderId, {
    units: UnitId[];                  // ascending inventories (§2)
    preferredBands: Record<UnitId, { min: number; max: number }>; // §5
  }>;

  ladderPriority: LadderId[];         // most → least (§2)
  relatedLadders: Record<LadderId, LadderId[]>;

  /** Optional edge hysteresis in log-meters (or relative mpp) to kill flip-flop. */
  bandHysteresis?: { relative: number }; // e.g. 1.05

  popoverRungs: RungRule[][];         // 6a…6e as ordered predicate lists
  setScaleRungs: RungRule[][];        // 7a…7d
  popoverTableAt: number;             // 12
  setScaleTableAt: number;            // 22
};

type RungRule =
  | { kind: "related-auto-show" }
  | { kind: "current-ladder-discard-user" }
  | { kind: "current-ladder-discard-all-prefs" }
  | { kind: "current-ladder-within-factor"; factor: number }      // 50
  | { kind: "any-ladder-current-unit-at-zoom" }
  | { kind: "any-ladder-discard-all-prefs" }
  | { kind: "related-within-factor"; factor: number }
  | { kind: "any-ladder-reading-in"; min: number; max: number } // 0.1–500
  | { kind: "ladder-neighbors"; ladder: "current" | "related"; up: number; down: number }
  | { kind: "ultra-standard-all" }
  | { kind: "unit-ids"; ids: UnitId[] }                         // e.g. kpc
  | { kind: "non-si-prefix" }
  | { kind: "ultra-band"; from: UnitId; to: UnitId }            // mm…mi
  | { kind: "all-ladders-between"; from: UnitId; to: UnitId }
  | { kind: "current-ladder-non-si-prefix" }
  | { kind: "true-metric-si-meters" }
  | { kind: "all-units" };
```

Moving a rule between rungs = reorder `popoverRungs` / `setScaleRungs` entries. Changing `ly` max 500→5000 on ultra = edit one preferred-band cell (T-R8-01).

---

## Layer contracts

### L1 — World scale math

Pure. No preference. No React.

| Function | Contract |
|----------|----------|
| `metersPerPx(anchor, zoom)` | `anchor.value * unitMeters(anchor.unitId) / anchor.barPx * (anchor.zoomAt / zoom)` |
| `barPx(value, unitId, mpp)` | `(value * unitMeters(unitId)) / mpp` |
| `niceMagnitudes(unitId, cfg)` | 1/2/5 (and decade powers) inside plain band; sci mantissas outside; inch special-case 3a |
| `candidatesOnLadder(ladderId, mpp, cfg)` | Every `{unit, nice value}` on that ladder with `minPx ≤ barPx ≤ maxPx` |
| `formatLabel(value, unitId, cfg)` | Fractions / plain / sci — display only |

Extreme zoom (constraint 1): use the same numeric path as as-built for `unitMeters` / Planck constants; L1 must stay finite (no NaN). Sci labels are formatting, not a separate pin mode.

### L2 — Unit preference policy

Pure. Absolute selection — **no incremental search window, no bridge loop**.

**`score` order (constraint 4 + 5):**

1. `fitsBounds`  
2. `onStickyLadder`  
3. `inUserRange` (user range outranks standard)  
4. `inStandardPreferred` (§5 band for that unit on sticky ladder)  
5. `preferGeOne` (among remaining, prefer value ≥ 1 / “1 of next unit” spirit)  
6. `barTargetCloseness`

**`selectReading`:** score all candidates on the sticky ladder first; if none fit (pathological), widen to related ladders then all ladders — still pure, still scored. Sticky ladder id always survives in the returned `Reading.ladderId` when any sticky-ladder candidate fits (F3).

**`autoOnLadder(ladderId, mpp, prefsMode, cfg)`:** used by popover 6a related-auto-show and preference-discarded peers:

- `prefsMode: "full"` → sticky ladder’s normal select  
- `prefsMode: "no-user"` → ignore `userRange`  
- `prefsMode: "no-prefs"` → ignore user + standard preferred bands; still stay-on-ladder + prefer≥1 + bar target  

**`resolvePick(unitId, reading, preference, cfg)` → PreferenceState** (constraint 5):

1. Destination ladder = highest-priority ladder owning `unitId` (or keep sticky if already on it).  
2. If unit is the preferred auto unit on that destination at current mpp → switch ladder only; `userRange = null`.  
3. Else → switch ladder; install `userRange` from current reading size to the **standard preferred-band edge** for that unit on the destination ladder.  
4. Picking a different unit while inside an active user range → tear down entire user range, then apply 1–3.  
5. Any ladder switch invalidates prior user range before 2–3.

No `pinMode: "near" | "far" | "stack"`. Far-pin release semantics are replaced by leaving the user range (or picking another unit). F10 is structurally impossible.

### L3 — UI rung assembly

Pure. Inputs: `Reading`, `PreferenceState`, `mpp`, `moreLevel`, `cfg`.

1. Evaluate rung rule list for `moreLevel` → bag of `UnitId`.  
2. Union with all lower rungs (cumulative “more”).  
3. Exclude current HUD unit (popover).  
4. Sort by registry meters ascending.  
5. If rung adds nothing new vs previous effective set → skip to next (constraint 6).  
6. If count > table threshold → `presentation: "table"`; if truncated, `moreAvailable`.

Set-scale rungs do not need a live reading for 7a/7b; 7c may use optional current ladder. Selecting a unit in the dialog sets initial `PreferenceState.ladderId` by priority (T-R7-04) with `userRange: null`.

---

## Failure-mode avoidance

| ID | As-built cause | Pipeline avoidance |
|----|----------------|--------------------|
| **F1** | Walk window / stale `previousHud` skips `ft` | Absolute candidates on sticky ladder; `ft` wins by score when it fits — no need to visit `10 in` first |
| **F2** | Far/stack pick clears walk → cold Planck search | `resolvePick` always leaves a concrete `PreferenceState` + reading on picked unit; next `selectReading` enumerates from mpp, not from null walk |
| **F3** | `stackForUnit(Qpc)` flips ladder | Sticky `ladderId` is an input; shared units never re-resolve ownership during auto walk |
| **F4** | `commitScaleDef` → `resetDisplayFloor()` | Preference writes update `userRange` / bands only; `ladderId` cleared only on Clear, redefine scale, or explicit cross-ladder pick rules |
| **F5** | `previousHud` in ref after render | Engine is pure; editor stores `PreferenceState` in state. Optional `lastReading` is an argument, not a hidden ref |
| **F6** | Fine-step tests hide coalescing | Catalog `T-Z-*` call `selectReading` once with large Δmpp; no bridge required for correctness |
| **F7** | Cold start prefers oversized anchor | Candidates filtered by bar bounds; oversized anchor value is not a candidate |
| **F8** | Missing `1/32` | `cfg.nice.inchFractions` includes `1/32` |
| **F9** | Docs/code drift | Config + bible §5 are the data source; ladders.md is not consulted at runtime |
| **F10** | Dead `pinMode: "stack"` | Type deleted; picks always produce unit + ladder |

Anti-flicker (Q4 / T-P-07): standard + user preferred bands are the primary hysteresis. Optional `bandHysteresis.relative` widens “stay in band” slightly past the numeric edge so small zoom noise does not flip. No `minUnit` / `minUnitZoomAt`.

---

## Test mapping

Every catalog case is a pure-function assertion (no React mount required except T-R9-01 / T-Z-01 chrome/throttle).

| Catalog area | Pipeline hook |
|--------------|---------------|
| `T-R1-*`, `T-R2-*` | L1 `barPx` / `metersPerPx` + L2 select at extreme mpp |
| `T-R3-*`, `T-IN-*`, `T-F8-*` | L1 `niceMagnitudes` + `formatLabel` |
| `T-R4-*`, `T-P-*`, `T-U-*` | L2 `selectReading` with sticky ladder + §5 bands in config |
| `T-R5-*` | L2 `resolvePick` → `PreferenceState'`; then `selectReading` |
| `T-R6-*`, `T-POP-*` | L3 `popoverUnits` |
| `T-R7-*`, `T-SET-*` | L3 `setScaleUnits` |
| `T-R8-01` | Mutate config preferred band; same L2 binary |
| `T-R9-01` | Manual / UI (shell only) |
| `T-F1-*`, `T-Z-02/03/04` | Single `selectReading(mppLarge)`; assert unit — **no** multi-step bridge |
| `T-F2-*`, `T-F5-*`, `T-F7-*` | `resolvePick` then `selectReading` with empty `lastReading` |
| `T-F3-*`, `T-F4-*` | Assert `Reading.ladderId` / `PreferenceState.ladderId` unchanged across meta writes |
| `T-F6-01` | CI includes at least one large-Δmpp case |
| `T-F10-01` | Type/API: no stack-pin constructor |
| `T-X-01/02` | Shell resets `PreferenceState`; pure layer sees fresh inputs |
| `T-X-03`, `T-U-01/02/05` | Config data audit |

Suggested unit-test layout (implementation-time):

```text
scaleBarMath.test.js          // L1
scaleBarPreference.test.js    // L2 select + resolvePick
scaleBarRungs.test.js         // L3 membership
scaleBarConfig.audit.test.js  // inventories, related, priority, bands
```

---

## Tradeoffs

| Pro | Con |
|-----|-----|
| Deterministic under any Δzoom; F1/F5/F6 largely dissolve | Enumerating all nice candidates per ladder each frame is more work than a tiny search window (still cheap: ~tens–hundreds of candidates) |
| Engine 100% unit-testable without React | Editor must own `PreferenceState` explicitly (one more piece of state to persist/reset correctly) |
| Clear separation: math / policy / UI | Three modules to keep in sync on shared types (`Candidate`, `UnitId`) |
| Rung rules as data (constraint 8) | Predicate DSL must be expressive enough for 6a–6e / 7a–7d — risk of under-specified rule kinds |
| Deletes pins + minUnit + bridge complexity | Loses as-built “bridge through intermediate labels” animation of unit sequence during a single coalesced jump (HUD shows only the final preferred reading — acceptable under UX sameness) |
| Soft `lastReading` optional | If overused, reintroduces walk coupling; policy must forbid using it for windows |

**Non-goals of this option:** changing HUD chrome; keeping near/far pin UX badges (already absent); preserving as-built function names.

---

## Assumptions

1. Absolute scoring with §5 preferred bands is sufficient for anti-flicker; a separate minUnit lock will not be needed (bible Q4).  
2. Showing only the **final** preferred reading after a large zoom jump (without synthesizing intermediate HUD frames) satisfies product expectations and T-Z / F1.  
3. `PreferenceState` is ephemeral UI/session state (like today’s display stack), not required in saved doc meta — except whatever the product already persists for `scaleDef`. Clear / redefine scale resets it (T-X-01/02).  
4. User preferred range bounds are stored in **display magnitudes on the picked unit** (not raw meters), clipped to that unit’s standard band edge on the destination ladder (T-R5-07).  
5. When no candidate on the sticky ladder fits bar bounds (should be rare), falling back to related/all ladders is allowed, but `ladderId` in `PreferenceState` does not auto-switch unless `resolvePick` ran.  
6. Sci / Unicode label style stays as-built until bible open question 9 is settled.  
7. Ultra-standard sub-ℓP behavior follows bible open question 10; until settled, L1 exposes only inventory units on ultra ladders (`ℓP` floor in §5 table).  
8. Constraint 9 holds: L3 outputs unit lists only; `ScaleUnitPicker` chrome unchanged.

---

## Redesign criteria checklist (§7)

- [x] UX unchanged (shell only)  
- [x] Five ladders + related + priority as config data  
- [x] Bar bounds + extreme zoom in L1  
- [x] 1/2/5 + inch 1/32 + plain/sci constants in config  
- [x] Preference stack + user ranges in L2; no minUnit  
- [x] Popover / set-scale rungs as reorderable `RungRule` lists  
- [x] No fragile `previousHud` for correctness; large-jump tests map to single-call select  
- [x] Sticky ladder survives shared units and preference writes  
- [x] Manual picks cannot cold-start to Planck  
- [x] Catalog maps 1:1 to pure tests  
- [x] Lives under `scale-bar-design-options/`; bible remains ruling  

---

## Clarifying questions

None blocking. Open bible items (true-metric band widths, body/astro popover 6d, sci glyph style, ultra sub-ℓP) are inherited as config defaults from §5 PROPOSED and do not block this architecture.
