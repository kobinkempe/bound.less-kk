# Design Option 04 — Scored Preference / Constraint-Ranking Engine

**Status:** proposal (docs only; not adopted).  
**Authority:** [scale-bar-ruling-design-bible.md](../scale-bar-ruling-design-bible.md) remains ruling. This doc is an alternative algorithm shape.  
**Acceptance tests:** [scale-bar-test-catalog.md](../scale-bar-test-catalog.md)  
**UX surface:** unchanged (bible §1 / constraint 9).

---

## 1. Thesis

Replace the as-built **search-window + heuristic promote/demote + opaque score** walk with an explicit **generate → filter → rank** pipeline:

1. **Generate** every legal `(ladder, unit, niceValue)` candidate that can produce a bar length in `[BAR_PX_MIN, BAR_PX_MAX]` at the current meters-per-pixel.
2. **Filter** hard constraints (bounds, nice-number legality, ladder inventory, pin/user-range locks).
3. **Rank** survivors with a **transparent, ordered, tunable score vector** whose lexicographic order encodes bible constraint 4 (stay-ladder → preferred range → prefer ≥1) plus bar-target closeness and anti-flicker stickiness.
4. **Emit** the top-ranked candidate as the HUD reading; expose the score breakdown in debug/tests so preference changes are auditable.

User overrides (constraint 5) are not a parallel pin machine — they **mutate the preference config** (install/tear down user preferred ranges, switch sticky ladder) and then re-enter the same ranking pipeline. Preferred ranges replace `minUnit` / `minUnitZoomAt` (Q4).

**Why this shape:** constraint 4 is already a ranked preference stack. Encoding it as opaque heuristics (promote-at tables, special bridges, search windows) is how F1/F2/F7 arise. A scored engine makes the stack **data**, the winner **deterministic**, and retunes **config-only** (constraint 8).

---

## 2. Metaphor

**Casting call, not a hike.**

The as-built model is a hiker on a trail: from the last foothold (`previousHud`), take small steps, promote/demote neighbors, hope coalesced zoom did not teleport past a rung.

This design is a **casting call**:

- Every unit that *could* play the scene (fit the bar) auditions.
- The director holds a **scorecard with ordered columns** (ladder stickiness, user range, standard range, prefer-≥1, bar target, continuity).
- Columns are compared **left-to-right**; the first column that separates two actors decides the part.
- The previous reading is not the path — it is only a **continuity bonus** in a late column, so large zoom jumps still cast correctly without depending on a fragile walk state.

Anti-flicker is **range membership**, not a locked door: once an actor is in their preferred band, they keep the part until a higher-priority column says otherwise.

---

## 3. Types / modules

Proposed module split (names illustrative; may live under `engine/`):

| Module | Responsibility |
|--------|----------------|
| `scaleBarLadders.js` (extended) | Five ladder inventories, related-ladder map, ladder priority, unit registry, ratio/meters helpers |
| `scaleBarNice.js` | Nice generators: 1/2/5 decades, plain↔sci handoff (`.001`…`5000`), inch fractions `1/8`/`1/16`/`1/32` → `.01` |
| `scaleBarRanges.js` | Standard preferred bands (§5 PROPOSED table as data); user-range build/teardown; “in band?” predicates |
| `scaleBarCandidates.js` | Candidate generation + hard filters (bar bounds, inventory, pin) |
| `scaleBarScore.js` | Score-vector construction, lexicographic compare, tunable weights/order |
| `scaleBarPick.js` | Orchestrator: `computeScale` / `pickScaleReading` → generate → score → select |
| `scaleBarPickerRungs.js` | Popover 6a–6e / Set-scale 7a–7d as reorderable rule lists (constraint 8) |
| `scaleBarPreference.js` | Sticky ladder + user override application (constraint 5); Clear / redefine resets |

### Core types

```ts
type LadderId =
  | "standard-metric"
  | "standard-imperial"
  | "ultra-standard-metric"
  | "ultra-standard-imperial"
  | "true-metric";

type NiceValue = {
  /** Numeric magnitude in unit space (e.g. 0.5, 1, 200, 1/32). */
  value: number;
  /** Display form: plain | sci | inch-fraction. */
  form: "plain" | "sci" | "inch-fraction";
  label?: string; // e.g. "1/32"
};

type PreferredBand = {
  unit: string;
  ladderId: LadderId;
  /** Inclusive magnitude bounds while this unit is preferred (standard or user). */
  min: number;
  max: number;
  kind: "standard" | "user";
};

type ScaleCandidate = {
  ladderId: LadderId;
  unit: string;
  nice: NiceValue;
  barPx: number;
  /** Physical length represented (for prefer-≥1 / band checks). */
  meters: number;
};

/** Ordered score vector — earlier components dominate (lexicographic). */
type ScoreVector = number[];

type ScoredCandidate = {
  candidate: ScaleCandidate;
  score: ScoreVector;
  /** Human-readable component labels for tests/debug. */
  breakdown: { key: string; value: number }[];
};

type PreferenceState = {
  stickyLadderId: LadderId;
  userBand: PreferredBand | null;
  /** Optional near/far pin for explicit lock until release rules fire. */
  pin: { unit: string; mode: "near" | "far" } | null;
};

type RankConfig = {
  /** Component keys in lexicographic order (tunable). */
  order: ScoreComponentKey[];
  /** Optional soft weights inside a component (usually unused if pure lex). */
  weights?: Partial<Record<ScoreComponentKey, number>>;
  barPxTarget: number;
  barPxMin: number;
  barPxMax: number;
  plainMin: number; // 0.001
  plainMax: number; // 5000
};
```

### Score component keys (default order)

| Key | Meaning | Higher / lower wins |
|-----|---------|---------------------|
| `hardFeasible` | 1 if in bar bounds + legal nice; else filtered out | must be 1 |
| `userBandHit` | 1 if candidate unit/value ∈ active user preferred range | higher |
| `stickyLadder` | 1 if `candidate.ladderId === stickyLadderId` | higher |
| `standardBandHit` | 1 if ∈ that unit’s standard preferred band on sticky ladder | higher |
| `preferGteOne` | 1 if value ≥ 1 (or fraction≥1 inch whole), with bonus for `1` of next unit when that is the prefer-≥1 handoff | higher (see §4.3) |
| `barTarget` | −|barPx − BAR_PX_TARGET| (or inverted distance) | higher (closer) |
| `continuity` | proximity to previous reading’s unit rank / value (soft) | higher |
| `ladderPriority` | only when sticky ladder does not apply (cold start / multi-owner) | higher = better priority |

**Lexicographic rule:** compare `score[0]`, then `score[1]`, … — first differing component decides. No blended “total points” unless a component is explicitly soft (e.g. `barTarget`, `continuity`).

---

## 4. Scoring pipeline

```
effectiveZoom + scaleDef + PreferenceState + RankConfig
        │
        ▼
┌───────────────────┐
│ 1. Resolve mpp    │  metersPerPx from anchor (constraint 1 float-safe ratios)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 2. Generate       │  For each ladder in scope → each unit → each nice value
│    candidates     │  Compute barPx = meters(nice, unit) / mpp
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 3. Hard filter    │  barPx ∈ [min,max]; unit on ladder; pin lock; sci/plain legality
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 4. Score vector   │  Build ScoreVector per RankConfig.order
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ 5. Lex pick       │  Argmax; stable tie-break (ladder priority, then unit rank, then value)
└─────────┬─────────┘
          ▼
     HUD reading + optional debug breakdown
```

### 4.1 Generation scope

| Mode | Ladders scored |
|------|----------------|
| **Auto (normal)** | Sticky ladder only (constraint 4.1). Related ladders are **not** auto-walked. |
| **Cold start** (no sticky yet) | All five; `ladderPriority` component selects among winners. |
| **Popover / Set-scale “what would auto-show”** | Run the pipeline once per related ladder with that ladder forced sticky (6a / Q3). |
| **Preference-discarded probes** (6a/6b) | Re-run with `userBand` cleared and/or `standardBandHit` disabled in config — same generator, different score order / masks. |

Generation must be **complete within the sticky ladder** for auto: every unit × every legal nice that could fit bounds. Do not rely on a ±N rank search window for correctness (F1, F6, F7). Optional **performance window** may prune far ranks only after proving it never changes the winner vs full generation (guarded by tests).

**Nice sets per unit** come from config:

- Default: 1/2/5 × 10^k within plain band; sci mantissas 1/2/5 outside.
- Inches: fraction chain then decimals (3a); mil nice list on standard imperial only.
- Ceiling units: through `plainMax` then sci.

### 4.2 Hard filters (non-negotiable)

1. `BAR_PX_MIN ≤ barPx ≤ BAR_PX_MAX` (constraint 2).
2. Unit ∈ sticky ladder inventory (or scoped ladder in probe mode).
3. If `pin.mode === "far"`: only candidates with `unit === pin.unit` (until release).
4. If `pin.mode === "near"`: treat as strong continuity / temporary sticky unit — still must pass bounds; release on any zoom change (as-built UX).
5. Reject illegal nice forms (e.g. inch fraction outside 3a set).

Candidates failing hard filters never enter ranking.

### 4.3 Score components in detail (maps to constraint 4 + 5)

**Default lexicographic order** (tunable via `RankConfig.order`):

1. **`userBandHit`** — User preferred ranges outrank standard (constraint 5). If a user band is active, candidates inside it beat all outside it *on the sticky ladder*. (Out-of-band candidates may still win only if no in-band candidate is feasible — then teardown/release rules apply separately.)

2. **`stickyLadder`** — Always 1 in normal auto (generation already scoped). Kept explicit so cold-start / multi-ladder probes share one scorer.

3. **`standardBandHit`** — 1 if the candidate’s magnitude lies in the §5 standard preferred band for `(ladder, unit)`. Encodes “choose a unit inside a custom preferred range” (constraint 4.2). Overlaps (e.g. `500 ft` vs `200 yd`) are resolved because only `yd`’s band contains 200–500 yd while `ft`’s standard max is 500 — both may hit; then later components decide. Owner example: prefer `200`–`500 yd` over `500 ft` → ensure `preferGteOne` / band tables make `yd` win (see below).

4. **`preferGteOne`** — Prefer lower numbers ≥ 1 (constraint 4.3). Suggested sub-encoding (still one lex component, or split if needed):
   - Primary: prefer `value ≥ 1` over `value < 1` when both band-hit.
   - Secondary (tie within component): prefer smaller “step index” toward `1` of the next coarser unit when that `1 next` candidate exists and fits (e.g. `1 ft` beats `10 in` and beats skipping to `yd`).
   - For the ft/yd overlap: standard bands already prefer yd in 200–500; additionally score `1` of next unit higher than large values on the previous unit when both are band-eligible.

5. **`barTarget`** — Soft: maximize closeness to `BAR_PX_TARGET` among remaining ties.

6. **`continuity`** — Soft: prefer same unit as last HUD, then adjacent rank, then nearer value. **Must not outrank** components 1–4. This replaces brittle “must walk through previousHud” without making correctness depend on it (F5).

7. **`ladderPriority`** — Cold start / classify multi-owner unit: Standard Metric → Standard Imperial → Ultra Metric → Ultra Imperial → True Metric.

### 4.4 Large zoom jumps (no fragile hike)

Because generation is from **mpp**, not from last foothold:

- A coalesced jump from `10 in` to a zoom where `1 ft` fits will include `1 ft` in the candidate set; `preferGteOne` + bands select feet before yards (F1, T-Z-*).
- Optional **bridge sampling** (as-built 1.3× steps) remains a **test/debug aid** or animation helper, not a correctness dependency. If used, each sample runs the full score pipeline; final frame is still a pure rank at target mpp.

### 4.5 User override path (constraint 5)

| User action | PreferenceState update | Then |
|-------------|------------------------|------|
| Pick unit **not** on sticky ladder | Switch sticky to highest-priority owner; **unless** rule 3 (unit is preferred auto on destination) → switch only; else install **user band** from current size → standard band edge on destination | Re-rank |
| Pick unit on sticky ladder but not preferred | Install user band current → standard edge | Re-rank |
| Pick unit that is preferred on another ladder | Switch sticky only; **no** user band | Re-rank |
| Pick different unit **inside** active user band | Tear down entire user band | Re-rank |
| Switch ladders (any) | Invalidate prior user band; rule 1 may install new | Re-rank |
| Clear / redefine scale | Reset PreferenceState | Fresh |

No `pinMode: "stack"` without a pinned unit (F10). Near/far pins are optional UX locks layered **above** ranking (hard filter), not a substitute for user bands.

### 4.6 Anti-flicker (Q4)

Stickiness comes from:

1. User/standard **band hit** as dominant score columns.
2. Soft **continuity** only after bands.
3. Optional **hysteresis margin** inside band predicates: e.g. exit band only when mpp crosses edge by ε (config). Prefer ε = 0 initially; add only if T-P-07 fails.

Do **not** reintroduce `minUnit` / `minUnitZoomAt` unless preferred ranges prove insufficient.

---

## 5. Config (constraint 8)

All retunable without rewriting the rank core:

```js
// Illustrative shape — values from bible §2 / §3 / §5
export const SCALE_BAR_RANK_CONFIG = {
  barPxTarget: 120,
  barPxMin: 60,
  barPxMax: 180,
  plainMin: 0.001,
  plainMax: 5000,
  order: [
    "userBandHit",
    "stickyLadder",
    "standardBandHit",
    "preferGteOne",
    "barTarget",
    "continuity",
    "ladderPriority",
  ],
  continuity: {
    sameUnit: 3,
    adjacentRank: 2,
    valueProximityScale: 1,
  },
  bandExitEpsilon: 0, // anti-flicker margin; keep 0 until needed
};

export const LADDER_PRIORITY = [ /* five ids, bible order */ ];
export const RELATED_LADDERS = { /* bible table */ };
export const STANDARD_PREFERRED_BANDS = { /* §5 PROPOSED per ladder/unit */ };
export const NICE_BY_UNIT = { /* default 1/2/5; inch; mil; astro overrides */ };

export const POPOVER_RUNGS = [ /* 6a…6e rule lists */ ];
export const SET_SCALE_RUNGS = [ /* 7a…7d rule lists */ ];
```

**Retune examples (no core rewrite):**

- Ultra `ly` max 500 → 5000: edit `STANDARD_PREFERRED_BANDS` only (T-R8-01).
- Swap “prefer ≥1” above “standard band” experimentally: reorder `order` array (expect test failures — documents the trade).
- Move a popover membership rule between rungs: edit `POPOVER_RUNGS` entries.

---

## 6. Failure-mode avoidance

| ID | How this design avoids it |
|----|---------------------------|
| **F1** Feet skipped | Full candidate gen at target mpp; `1 ft` competes; prefer-≥1 + bands beat `yd`/`mi` when feet fit. No +1-rank-only search window. |
| **F2** dm → Planck | Pick installs sticky true-metric + user/standard band for `dm`; next rank cannot leave land band for Planck. Continuity soft only. |
| **F3** Qpc stack flip | `stickyLadderId` is durable PreferenceState; shared units do not re-resolve via `stackForUnit` alone. |
| **F4** meta write clears stack | Preference writes **must not** call `resetDisplayFloor`; sticky ladder independent of band updates. |
| **F5** previousHud coupling | Continuity is soft; correctness from mpp + bands. Null previousHud → cold continuity = 0, still deterministic. |
| **F6** fine-step tests only | Catalog T-Z / T-F1 coalesced cases required; generator does not assume fine steps. |
| **F7** cold start stuck on anchor | Anchor is not privileged in hard filters; if `1 in` bar ≫ max, filtered out; finer candidates win. |
| **F8** missing 1/32 | Inch nice config includes 1/32 (T-IN / T-R3a). |
| **F9** docs drift | Bands + ladders live as data mirrored from bible §5; this option defers to bible. |
| **F10** null stack pin | API: pin always has unit, or use user-band state only. |

---

## 7. Test mapping

How catalog areas exercise this engine:

| Catalog | Engine hook |
|---------|-------------|
| **T-R1 / T-R2** | Hard filter bounds + extreme mpp generation still returns finite sci candidates |
| **T-R3 / T-R3a / T-IN** | `NICE_BY_UNIT` + inch chain in generator |
| **T-R4-01** | stickyLadder scope + durable PreferenceState |
| **T-R4-02 / T-P-03…06 / T-P-08** | `standardBandHit` + preferGteOne on §5 bands |
| **T-R4-03 / T-F1 / T-Z** | Full gen + preferGteOne selects `1 ft` |
| **T-R5-*** / T-P-02** | PreferenceState user-band install/teardown before re-rank |
| **T-R6 / T-POP-*** | Picker rungs call pipeline in probe modes (related auto-show, discard prefs) |
| **T-R7 / T-SET-*** | Set-scale rung config only |
| **T-R8** | Change band/order config; assert no scorer rewrite |
| **T-R9** | No UI module changes required for chrome |
| **T-P-07** | Band stickiness / optional ε under noise |
| **T-U-*** | Five-ladder data + ultra absorption bands |
| **T-F2…F5 / T-F7 / T-F10** | PreferenceState + hard filters as in §6 |
| **T-X-*** | Clear/redefine resets PreferenceState |

**Debug assertion pattern (recommended):** for any failing preference test, dump `breakdown` of top-3 `ScoredCandidate`s so failures read as “wrong column won,” not “mysterious walk.”

---

## 8. Tradeoffs

| Pro | Con |
|-----|-----|
| Constraint 4/5 become inspectable columns | More candidates than neighbor-search → need careful generation pruning or memoization at extremes |
| Coalesced zoom correctness without hike state | Continuity is weaker than a forced walk — labels may jump more than one nice step on huge Δzoom (still correct unit; optional bridge for smoother intermediate frames) |
| Retune bands/order without rewriting promote helpers | Lex order mistakes are sharp: one swapped column can invert many behaviors (mitigate with catalog + breakdown dumps) |
| Single pipeline for auto + “what would X ladder show” probes | Popover probes multiply rank calls (bounded: related ladders × few discard modes) |
| Eliminates minUnit lock complexity | Must get §5 band tables right; wrong band data → wrong product behavior (data risk, not algorithm risk) |
| Transparent ties | Soft components (`barTarget`, `continuity`) can still feel “magic” if over-weighted — keep them last |

**Non-goals for this option:** changing HUD chrome; inventing new ladders beyond the bible’s five; keeping as-built `LADDER_PROMOTE_AT` as the primary preference mechanism.

---

## 9. Assumptions

1. Bible §5 PROPOSED preferred-range table is the authoritative standard-band dataset (Q1).
2. Ultra-standard inventories omit `yd`/`mil`/`ld`/`R☉`/`R⊕`; absorption is expressed **only** via bands + inventory (Q2).
3. Sticky ladder is session/ephemeral display state (as today), not necessarily persisted in doc meta — unless product later asks to persist.
4. Full per-ladder candidate generation is feasible at interactive rates; if not, pruning is allowed only with equivalence tests against full gen.
5. Near/far pin UX remains; far pin is a hard filter, not a scoring preference.
6. Float-safe rung ratios (existing / ladders doc) remain the physical basis for `barPx` and `meters` (constraint 1).
7. Open bible items (true-metric band widths, body/astro popover 6d, sci glyph style, ultra sub-ℓP floor) do not block this architecture — they are config rows once decided.
8. “Prefer ≥1” vs overlapping standard bands is resolvable by band tables + lex order without a separate promote-at graph; if a concrete owner example conflicts, adjust **data** first, then component split.

---

## 10. Evaluation checklist (bible §7)

- [x] **UX unchanged** — engine/preference only; chrome untouched.
- [x] **Five ladders + related + priority** — data modules.
- [x] **Bar bounds + extreme zoom** — hard filter + full gen.
- [x] **1/2/5 + inch 1/32 + plain/sci** — nice config.
- [x] **Preference stack 4 + user overrides 5 + Q4 ranges** — score order + PreferenceState.
- [x] **Popover/dialog rungs as config** — `POPOVER_RUNGS` / `SET_SCALE_RUNGS`.
- [x] **No fragile previousHud-only correctness** — continuity soft; mpp-ranked.
- [x] **Sticky ladder survives shared units / meta writes** — PreferenceState contract.
- [x] **Manual picks never Planck cold-start** — band install on pick.
- [x] **Catalog mappable** — §7 test mapping.
- [x] **Bible wins** — this is an option under `scale-bar-design-options/`.

---

## 11. Clarifying questions

None blocking. Remaining bible open questions (true-metric widths, body/astro 6d, sci style, ultra sub-ℓP) are config content, not architectural blockers for adopting this option.
