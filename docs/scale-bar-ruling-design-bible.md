# Scale Bar — Ruling Design Status Bible

**Status:** source of truth for redesign **product constraints**; engine as-built under `boundless/src/engine/scaleBar/`.  
**Path:** `boundless/docs/scale-bar-ruling-design-bible.md` (settled).  
**UX surface:** unchanged (see §1).  
**Implementation plan (ruling):** [`scale-bar-ruling-implementation.md`](./scale-bar-ruling-implementation.md) — modules, session shape, locked Q&A, and definition of done. Implementers follow that doc for the build; this bible remains the constraint reference.  
**Related:** [scale-bar-v1-spec.md](./scale-bar-v1-spec.md) · [scale-bar-ladders.md](./scale-bar-ladders.md) · [scale-bar-design-decisions.md](./scale-bar-design-decisions.md) · [scale-bar-test-catalog.md](./scale-bar-test-catalog.md)  
**Design options (historical):** [`scale-bar-design-options/`](./scale-bar-design-options/) (proposals; architecture chosen in the implementation doc).  
**Code (as-built):** `boundless/src/engine/scaleBar/` (+ facade `scaleBar.js`), `CanvasEditor.js`, `ScaleUnitPicker.js`, `useKobinEngine.js`

This document freezes **product constraints**, documents **current implementation**, records **failure modes to avoid**, lists **open gaps**, and points to an **acceptance test catalog**. The **build plan** lives in [`scale-bar-ruling-implementation.md`](./scale-bar-ruling-implementation.md). Future design proposals must satisfy §7.

---

## Locked decisions (pointer)

Product Q&A locked for the first build is recorded in full in **[scale-bar-ruling-implementation.md §A](./scale-bar-ruling-implementation.md#a-locked-product-decisions)**. Summary:

| # | Lock |
|---|------|
| L1 | Coalesced zoom = **target result only** (no mandatory intermediate trace) |
| L2 | Anti-flicker = asymmetric handoff hysteresis (~5% enter / full bar-range exit); tunable; **enter margin wired** in resolver |
| L3 | `500 ft` vs `200 yd` → **`200 yd` wins** |
| L4 | Ultra-standard **`mi` = `0.25–1 mi`**; `0.25 mi` beats feet when it fits |
| L5–L7 | User-range install / switch-only / other-unit teardown; I-02 = A-pool hybrid (see implementation §A / §B.6) |
| L8–L9 | Sticky ladder through shared `Qpc`; set-scale `Qpc` → **standard metric** |
| L10 | Popover related peer = **auto-show at current zoom** |
| L11 | End-to-end **log/normalized** magnitude; never hard-error on float limits |
| L12 | **No far-pin** — distant picks are user preferred ranges only |

Where a locked decision updates a §5 PROPOSED band (notably ultra `mi`), the **implementation doc wins** until this bible’s tables are edited to match.

---

## 1. Product / UX status (unchanged UX surface)

The redesign changes **engine logic, ladders, preference model, and picker membership rules**. It does **not** change what the user sees as chrome.

### What the user sees today

| Surface | Behavior |
|---------|----------|
| **No scale** | Bottom-right shows zoom multiplier only (e.g. `1.5×`). No scale bar nudge. |
| **HUD at rest** | Horizontal bar + reading label (e.g. `2 ft`). No chevron, no Auto/OVERRIDE badge, no mode indicator. |
| **HUD popover** | Tap label → flat popover of unit abbreviations + **more**. Outside tap / Esc dismisses. No nested sub-menus labeled Auto/Other. |
| **Set scale** | Ruler button → drag a line on canvas → dialog “This length equals…” with length input + unit chips + **More units…**. Save commits `scaleDef`. |
| **Clear** | Ghost **Clear** when a scale exists; removes scale and returns to zoom label. |

### UX sameness rule (constraint 9)

Popover layout, dialog layout, Clear, Set scale drag flow, and HUD quietness stay as they are. Only **which units appear on which “more” depth** and **how the reading is chosen** may change under the hood.

---

## 2. Authoritative design constraints (the new bible)

Constraints below are the ruling product rules for the redesign. Numbering matches the product owner’s list (1–9, with 3a and 6a–6e / 7a–7d).

### New ladders (two additions)

| Ladder id (proposed) | Ascending rungs |
|----------------------|-----------------|
| **Ultra-standard Imperial** | `ℓP`, `fm`, `pm`, `nm`, `µm`, `in`, `ft`, `mi`, `AU`, `ly`, `pc` |
| **Ultra-standard Metric** | `ℓP`, `fm`, `pm`, `nm`, `µm`, `mm`, `cm`, `m`, `km`, `AU`, `ly`, `pc` |

**Notes:**

- Ultra-standard ladders **omit** `yd`, `mil`, `ld`, `R☉`, and `R⊕` entirely (not on inventory, preference, or auto-walk). Neighbor units absorb those physical bands — see §5.
- For ultra-standard ladders, **`ly` preferred range goes up to 5,000 ly**; otherwise preferred ranges match the corresponding **standard** ladders where units overlap (with neighbor-absorption overrides in §5).
- Full ladder inventories for Standard Metric / Standard Imperial / True Metric remain as in the as-built registry (see §3), subject to redesign cleanup — but **preference order**, **related-ladder** tables, and **§5 preferred ranges** are authoritative for the new model.

### Ladder preference order (most → least)

1. Standard Metric  
2. Standard Imperial  
3. Ultra-standard Metric  
4. Ultra-standard Imperial  
5. True Metric  

### Related ladders

| Ladder | Related ladders |
|--------|-----------------|
| Ultra-standard Imperial | Ultra-standard Metric, Standard Imperial |
| Ultra-standard Metric | Ultra-standard Imperial, Standard Metric |
| Standard Metric | Ultra-standard Metric, True Metric, Standard Imperial |
| True Metric | Ultra-standard Metric, Standard Metric, Standard Imperial |
| Standard Imperial | Ultra-standard Imperial, Standard Metric, True Metric |

### Constraint 1 — Zoom accuracy

Zooming must remain accurate across extreme zooms (thousands of orders of magnitude past `qℓP` / `Qpc`), including where float precision is stressed. Current design is considered acceptable on this axis; redesign must not regress it.

### Constraint 2 — Bar length bounds

The scale bar must always stay within a bounded pixel length. Current bounds (`BAR_PX_MIN` / `BAR_PX_MAX` / `BAR_PX_TARGET`, see §3) are considered good when the algorithm works; redesign keeps the bounded-bar invariant.

### Constraint 3 — Nice multiples (1 / 2 / 5)

Readings use multiples of **1, 2, and 5**, including decimal / scientific forms (`.1`, `50`, `5×10⁵`, `2×10⁻⁴`, `2000`, etc.).

- Plain numeric range before scientific notation: **`.001` … `5000`** (constants, easily tunable).
- Outside that band → scientific notation with 1/2/5 mantissas.

#### Constraint 3a — Inch fractions

Inches show **`1/8`, `1/16`, `1/32`** before switching back to decimals at **`.01`**. As-built also admits plain **`0.25` / `0.5`** (and `.02` outside the fraction region).

### Constraint 4 — Unit choice preference (auto)

When choosing among candidates that fit bar bounds, prefer in order:

1. **Stay on the current ladder** (one of the five ladders; ladders are named constants). Auto resolve never re-derives ladder from ownership (L8).
2. **Choose a unit inside a custom preferred range** for that ladder (see §5 PROPOSED table). Preferred ranges are constants.
3. **Explicit handoff winners** (L3 / L4): e.g. `200 yd` over `500 ft`; ultra any in-band `mi` over `ft` once that mi stop fits (earliest cutover when **`0.25 mi` fits**).
4. **Prefer a lower number ≥ 1** (e.g. `1 ft` over `10 in` when both fit) — including **promote to `1` of the next coarser unit** even while the finer unit’s standard band still hits (I-01). Long magnitude examples live in **§5**.

### Constraint 5 — User preference overrides

User picks override auto preference as follows:

1. **Unit not on current ladder** (or not preferred at this zoom) → switch to the appropriate ladder (highest-preference ladder if the unit exists on multiple). Then create a **user preferred range on that new ladder** for the picked unit from the **quantized nice reading** (L5), not raw pre-nice size, through the unit’s **normal far edge** on that ladder (L12 — may exceed §5 preferred hi; e.g. mi through ~2000 mi, yd through 5000 yd). Example: µm-scale → inches yields ≈ `10⁻⁵`–`10⁻⁴ in` (nice) through far edge `10 in`.  
   - Exception: if rule 3 applies (unit is the preferred auto unit on the destination ladder at this zoom), **only switch ladders** — do **not** create a user preferred range (L6).
2. **Unit on current ladder but not the preferred unit at this zoom** → same user-range construction as rule 1 (quantized nice → far edge).  
   - Every unit has a **standard preferred band** derived from the “prefer lower numbers ≥ 1” rule together with bar-length bounds and nice numbers (§5 PROPOSED table) — used for auto `bandHit`, not as the user-range hi when far edge exceeds it (L12).  
   - User preferred ranges outrank standard preferred ranges.  
   - Tear down on: (a) L7 other-unit pick while a `userBand` is still active, (b) L6 preferred pick (return to auto), (c) ladder switch / clear, (d) **auto exit** when the preferred unit leaves the bar pool **or** `targetLogLen > logHi` (I-02 / A-pool hybrid — sticky re-entry rejected). Do **not** clear solely because `tLog < logLo`. Install extent still includes bar min/max headroom at pick mpp (Hybrid B⁺); CanvasEditor A6 write-back race guard retained. Tier-0 `userHit` = any in-pool stop of `userBand.unit` (not gated on install `[logLo, logHi]`).  
   - Switching ladders invalidates any prior user preferred range (then rule 1 may install a new one on the destination ladder).
3. **Unit not preferred on current ladder, but is the preferred unit on another ladder** → **only switch ladders** (highest preference if tied — always `highestPriority(preferredLadders)`, I-15). **Do not** create a user preferred range. Example: at `5 hm`, select `m`.

**Anti-flicker / hysteresis:** **Preferred ranges** (standard + user) are the primary mechanism (Q4). **L2 enter ~5%** (`HYSTERESIS_ENTER_PAST_EDGE`) is wired in the resolver: when the incumbent is active, neighbors that would win only via band/prefer tiers require target length ~5% past the incumbent band edge before release. Handoff / promote winners (L3/L4 / §5) are never blocked by enter. Do not reintroduce a separate minUnit hysteresis.

### Constraint 6 — HUD popover rungs

- Each **more** advances one rung; if a rung adds no new units, skip to the next.
- **Never show the current unit** on the popover.
- Units ordered **smallest → largest** (same as full table).
- If **> 12** units would display → switch to the full-name **table**; if still truncated, last row is **more**.

#### 6a — First rung

Show units that match any of:

- The unit each **related** ladder would **auto-show at this zoom** (same preference stack as constraint 4 on that ladder — **not** a log-distance peer).
- Units on the current ladder that would show if **user** preferences were discarded.
- Units on the current ladder that would show if **all** preferences were discarded.
- Units on the current ladder within **50×** of the current unit (e.g. `ft` → `in`, `yd`).

#### 6b — Second rung

- Current unit on **any** ladder at current zoom.
- Units on any ladder that would show if all preferences were discarded.
- Units on a **related** ladder within **50×** of the current unit.
- Units on the current ladder that would read between **`.1` and `500`** of that unit on the bar at current zoom.

#### 6c — Third rung

- Units on any ladder that would read between **`.1` and `500`** at current zoom.
- **2** rungs up and **2** down on the current ladder.
- **1** up and **1** down on related ladders. If the current unit is **absent** from a related ladder’s inventory (e.g. `yd` on ultra), related ±1 for that ladder is **empty** (skip-empty still applies; I-11).

#### 6d — Fourth rung

- All **ultra-standard** units, **`kpc`**, and any units **without an SI prefix**.

#### 6e — Fifth rung

- **All** units. Full-catalog table only at this depth; earlier `>12` flips use the **membership** table at that rung (not 6e dump).

### Constraint 7 — Set-scale dialog rungs

- Show all units on the current dialog rung + **More units…**.
- Flip to full table only when **> 22** units would display (membership through 7c; full catalog only at **7d**).
- Selecting a unit sets the initial **current ladder** **on save / commit** (L9: `ladderId = highestPriority(ownersOf(unit))`). Until commit, dialog ladderId stays the prior session ladder or `null` — do not mutate sticky ladder on every click (I-16). Live post-save ladder preview is optional/deferred.

#### 7a — First rung

- Units between **`mm` and `mi`** on the **ultra-standard** ladders.

#### 7b — Second rung

- **All** units on the ultra-standard ladders.

#### 7c — Third rung

- All units on all ladders between **micrometers and kpc**.
- If there is a current ladder: all units on it **without an SI prefix**.
- If current ladder is **true metric**: all meter units **with** an SI prefix on that ladder.

#### 7d — Last rung

- All units.

### Constraint 8 — Configurability

Rung membership rules and numeric constants (bar bounds, nice floors/ceilings, preferred ranges, related ladders, ladder priority) must be easy to retune — move a rule between rungs or change a constant without rewriting the walk core.

### Constraint 9 — UX sameness

See §1.

---

## 3. Current implementation design (as-built)

### 3.1 Architecture

```
boundless/src/engine/scaleBar/     CanvasEditor.js / ScaleUnitPicker.js
─────────────────────────────────  ────────────────────────────────────
catalog / membership / preference  scaleSession + computeScale
resolveReading / applyUnitPick     HUD popover + set-scale dialog
rungs (6a–6e / 7a–7d)              Clear → clearDisplayPrefs (L9)
session (sticky ladder, userBand)
```

**`computeScale(effectiveZoom, scaleDef, session)`** — absolute resolve on sticky ladder (L1/L8); tears down `userBand` when the preferred unit leaves the bar pool or `targetLogLen > logHi` (I-02 / A-pool hybrid); updates display-only incumbent/lastReading. Engine L9/L10 verified OK; popover/set-scale tables bind to membership (I-03/I-04). Legacy `scaleBarLadders.js` / walker / pinMode paths are superseded.

**Status throttle (`useKobinEngine`)**
- Non-zoom status updates throttled ~50 ms.
- **`effectiveZoom` changes flush immediately** so React does not coalesce away intermediate zooms for the HUD.

### 3.2 Current ladder inventories / `STACK_IDS`

**As-built stacks (only three):**

```js
STACK_IDS = {
  STANDARD_METRIC: "standard-metric",
  TRUE_METRIC: "true-metric",
  STANDARD_IMPERIAL: "standard-imperial",
}
```

**Shared fine head** (all three ladders):  
`qℓP → rℓP → … → mℓP → ℓP → kℓP → qm → rm → ym → zm → am → fm → pm → nm → µm`

| Stack | Tail (after µm) |
|-------|-----------------|
| **Standard Metric** | `mm → cm → m → km → Mm → R☉ → AU → ld → ly → pc → kpc…Qpc` |
| **True Metric** | `mm → cm → dm → m → dam → hm → km → Mm → Gm…Qm → Ppc…Qpc` |
| **Standard Imperial** | `mil → in → ft → yd → mi → R⊕ → R☉ → AU → ld → ly → pc → kpc…Qpc` |

**`ULTRA_STANDARD` today** is a **picker helper list**, not a walkable stack:

```js
["ℓP", "nm", "µm", "mm", "cm", "m", "km", "AU", "ly", "pc"]
```

It does **not** match the new ultra-standard imperial/metric ladders in §2 (missing `fm`/`pm`/`in`/`ft`/`mi` split; includes `mm`/`cm`/`m`/`km` only on the metric side).

**`STACK_PRIORITY` (as-built):** Standard Metric → Standard Imperial → True Metric.  
**Target (§2):** Standard Metric → Standard Imperial → Ultra-standard Metric → Ultra-standard Imperial → True Metric.

### 3.3 Current constants

| Constant | Value / notes |
|----------|----------------|
| `BAR_PX_TARGET` | `120` |
| `BAR_PX_MIN` / `BAR_PX_MAX` | `60` / `180` |
| `MIN_DRAG_PX` | `12` |
| `NICE_NUMBERS` | `[1, 2, 5, 10, 20, 50, 100, 200, 500]` |
| `INCH_WHOLE_NICE` | `[1, 2, 5, 10]` |
| `INCH_SUBDIVISIONS` | `1, 1/2, 1/4, 1/8, 1/16` — **no `1/32`** |
| `MIL_NICE` | `[50, 20, 10, 5, 2, 1]` |
| `IMPERIAL_LAND_NICE` | `ft`: 1…100; `yd`: 1…500; `mi`: 0.5…2000 |
| `ASTRO_NICE` | `AU`/`ly`: through 500; `ld`: through 200 |
| `LADDER_PROMOTE_AT` | `in→1 ft`; `ft→50 yd`; `yd→0.5/1/2/5 mi`; `AU→5 ld`; `ld→1 ly`; `ly→200 pc` |
| `FAR_PIN_RELEASE` | release when auto reaches ≥1 of pinned unit (listed units) |
| `PLANCK_FLOOR_UNIT` | `qℓP`; decimals `[1, 0.5, 0.2, 0.1, 0.05]` then sci mantissas `[1,2,5]` |
| `LADDER_CEILING_UNIT` | `Qpc`; `CEILING_NICE` through **5000**, then sci |
| `PLANCK_LENGTH_M` | `1.616255e-35` |
| `TIER_A_UNITS` | `mm cm m km in ft yd mi` |
| Bridge jump | factor `1.3`, max 48 steps when mpp ratio outside `[1/1.35, 1.35]` |
| Search window | with `previousHud`: zoom-out allows **+1** rank only; zoom-in **−2…+2** |
| Everyday floor | imperial: `mil`; metric stacks: `nm` (avoids full Planck search when centered above) |

### 3.4 Preference / promotion heuristics (today vs new model)

| Concern | As-built | New bible (§2) |
|---------|----------|----------------|
| Ladder stickiness | `displayStack` + `previousHud` scoring; shared units prefer current stack in `classifyUnitPick` | Explicit “stay on current ladder” as rule 4.1 |
| Preferred ranges | Implicit via `LADDER_PROMOTE_AT`, capped nice lists, special demote/promote helpers | Explicit per-unit preferred ranges + user override ranges |
| Prefer ≥1 next unit | `tryPromoteToOneWhenReady`, score penalties for skipping ranks | Rule 4.3 |
| Ultra-standard | List for picker expansion only | Two full ladders + ly to 5000 |
| User override | Near/far pin; Option C release on zoom / far threshold | Ladder switch + user preferred ranges with teardown rules (incl. user range on cross-ladder pick) |
| Anti-flicker | `minUnit` / `minUnitZoomAt` hysteresis lock | Preferred ranges replace minUnit functionally; no separate lock unless proven necessary |
| Sci band | Planck floor + Qpc ceiling special-cased; general `formatScaleNumber` at extremes | Unified `.001`–`5000` then sci (constraint 3) |

### 3.5 Picker / popover (today vs new rungs)

**Today (`getUnitPickerOptions`):**

- Level 0: ladder neighbors + cross-stack peer(s); imperial uses one peer.
- Level 1: + units within 100× + nearest `ULTRA_STANDARD` neighbors.
- Level 2: + units within 1000×.
- Level 3+: full name table.
- Current unit excluded unless `includeCurrent`.
- “Skip first more” can jump level 0 → 2 when level 0 is thin.

**New (§2 6a–6e):** related-ladder peers, preference-discarded candidates, 50× band, `.1`–`500` band, ultra-standard + kpc + non-prefixed, then all — with 12-unit table flip.

### 3.6 Set-scale unit options (today vs new)

**Today (`getSetScaleUnitOptions`):**

- Level 0: `TIER_A_UNITS` ∪ picker level 0 (includes current).
- Levels 1–2: expanded picker.
- Level 3+: full table.
- Table flip not gated on “> 22 units”.

**New (§2 7a–7d):** ultra-standard mm–mi → all ultra-standard → µm–kpc (+ non-prefix / true-metric SI meters) → all; table at > 22.

---

## 4. Known failure modes / issues to avoid

| ID | Symptom | Root-cause notes (as understood) |
|----|---------|----------------------------------|
| **F1** | **Feet skipped** when zooming out from inches (jump `10 in` → `yd`/`mi`) | Coarse zoom / status coalescing; `LADDER_PROMOTE_AT.in` only targets `1 ft`; `searchWindow` on zoom-out only opens **+1** rank but scoring/window fallback can still miss if `previousHud` stale; bridge jump added to mitigate — still brittle if `previousHud` cleared |
| **F2** | Manual pick of **`dm` from `cm`** lands on random / Planck unit | Historical **`pinMode: "stack"`** with **null pin** + **cleared `previousHud`** → cold search from everyday floor / full window; far picks still clear `previousHud` today |
| **F3** | **Display stack not sticky** through shared units (e.g. `Qpc`) | `stackForUnit("Qpc")` → standard-metric; without sticky `displayStack`, walk flips onto standard-only rungs (`R☉`, `Tpc`). Partial fix: prefer `currentDisplayStack` in `classifyUnitPick` |
| **F4** | **Far-pin release / promotion clears sticky stack** | `commitScaleDef` **always** calls `resetDisplayFloor()`; `minUnit` promotion path uses `commitScaleDef` → wipes `displayStack` mid-session |
| **F5** | Brittle **`previousHud` ↔ React status** coupling | HUD walk state lives in a ref updated after render; any path that nulls the ref (far pick, `resetHudWalk`, remount) loses monotonic walk; throttle flush helps but does not replace durable walk state |
| **F6** | Tests with **fine zoom steps** miss real wheel/trackpad coalescing | Fine `z *= 0.97` suites pass while large Δzoom still skips; coalesced tests were added late and are few |
| **F7** | **Cold start without `previousHud`** stuck on anchor unit | `pickScaleReading` prefers anchor when `!previousHud`; if anchor still “fits” loosely, demotion/promotion stalls |
| **F8** | Inch chain incomplete vs bible | Historical as-built stopped at **`1/16`**; constraint **3a** requires **`1/32` in nice grammar**. Preferred auto band remains **`1/16`–`1`** (owner / §5) — do not treat F8 as requiring preferred `1/32`. |
| **F9** | Docs vs code drift | `scale-bar-ladders.md` / v1 spec describe 2-stack continuous SI grids and 3-slot HUD; code has 3 stacks, body/astro extras, multi-level “more”, and different nice sets |
| **F10** | `pinMode: "stack"` dead path | Still special-cased in `resolveMinAllowedRank` / anchor use, but UI only sets near/far — leftover hazard if reintroduced without a pin |

---

## 5. Preferred ranges + open questions

### Settled product facts (Q1–Q5 + doc structure)

| ID | Decision |
|----|----------|
| **Q1** | Preferred-range table is **complete** below (agent-filled from owner examples + bible constraints + as-built promote/nice evidence). Marked **PROPOSED** — authoritative for redesign agents unless the user edits. |
| **Q2** | Ultra-standard ladders **omit** `yd`, `mil`, `ld`, `R☉`, and `R⊕` from inventory, preference, and auto-walk. Neighbor absorption in the ultra-standard tables is **authoritative**. |
| **Q3** | Popover 6a “related ladder at current zoom” = the unit that related ladder would **auto-show** under constraint 4 at this zoom (**not** log-distance peer). |
| **Q4** | Anti-flicker / hysteresis remains a **design requirement**, but is **handled by preferred ranges**. Preferred ranges replace the as-built `minUnit` / `minUnitZoomAt` mechanism functionally. Redesign must prevent flip-flop without a separate minUnit lock unless proven necessary later. |
| **Q5** | Every unit has a **standard preferred band** from prefer-≥1 + bar bounds + nice numbers (§5 table). When the user picks a unit **not on the current ladder**, switch to the appropriate ladder (ladder priority if on multiple) and create a **user preferred range on that new ladder** (unless constraint 5 rule 3 applies — preferred-on-other-ladder → switch only). |
| **Doc structure** | This bible lives at `boundless/docs/scale-bar-ruling-design-bible.md`. Ruling **implementation** plan: [`scale-bar-ruling-implementation.md`](./scale-bar-ruling-implementation.md). Historical design-option proposals under `boundless/docs/scale-bar-design-options/`. |

### PROPOSED preferred-range table

> **PROPOSED (authoritative for redesign agents unless user edits).**  
> Magnitudes are inclusive display values on that unit while it is the **preferred** auto choice. Outside a unit’s band, stay-on-ladder + prefer-≥1 (constraint 4.1 / 4.3) still apply; plain labels use `.001`…`5000` then sci (constraint 3).  
> User preferred ranges (constraint 5 / L5/L12) span **quantized nice → normal far edge** on the destination ladder. Far edge often matches the §5 preferred hi, but may exceed it (e.g. standard `mi` through ~2000 mi, `yd` through 5000 yd) — it is **not** always the standard preferred-band edge.  
> Owner examples preserved: **`1/16 in`–`1 in`** (preferred auto band — owner intent), `2 ft`–`500 ft`, `200`–`500 yd` over `500 ft`, **`yd → 0.5 mi` when 0.5 mi fits** (locked), `0.5 mi`–`1 mi`, `1 ly`–`500 ly` (ultra `ly`→`5000`), `200 pc`–`500 pc`. Constraint **3a** still requires **`1/32` in nice grammar** (labels / candidate pool), but **`1/32` is not auto-preferred** — mil owns that magnitude on standard imperial. User-override examples (`2×10⁻⁵ in`–`10 in`, `200 yd`–`5000 yd`) are **user** ranges (constraint 5), not standard bands.

#### Shared rules

| Rule | Value |
|------|-------|
| Plain → sci handoff | `.001` … `5000` on the active unit, then 1/2/5 sci mantissas |
| Inch fractions (3a) | `1/8`, `1/16`, `1/32` then decimals at `.01` — **grammar only**; preferred auto `in` band is **`1/16`–`1`** (owner), not `1/32` |
| Prefer ≥1 next unit | e.g. promote to `1 ft` / `1 m` / `1 km` / **`1 mil`** when that reading fits, even if prior unit’s band max is higher; **`yd → 0.5 mi`** via handoff when 0.5 mi band-hits (locked) |
| Ceiling unit | Last rung on the ladder (`Qpc` on standard/true; `pc` on ultra-standard) holds through `5000` then sci |

---

#### Standard Metric

Inventory tail after shared fine head: `mm → cm → m → km → Mm → R☉ → AU → ld → ly → pc → kpc…Qpc` (plus shared `qℓP…µm`).

| Unit | Preferred magnitude | Handoff / notes |
|------|---------------------|-----------------|
| `qℓP` | floor decimals `1`…`0.05`, then sci | Open: exact ℓP-family floor policy — see Open Questions |
| `rℓP`…`mℓP`, `kℓP` | `1` … `500` | Decade SI-prefix style; promote to `1` of next when ready |
| `ℓP` | `1` … `500` | Then `kℓP` / `qm` bridge as ladder defines |
| `qm`…`am` | `1` … `500` | Same decade pattern |
| `fm` | `1` … `500` | → `1 pm` |
| `pm` | `1` … `500` | → `1 nm` |
| `nm` | `1` … `500` | → `1 µm` |
| `µm` | `1` … `500` | → `1 mm` |
| `mm` | `1` … `5` | → `1 cm` (short everyday band) |
| `cm` | `1` … `5` | → `1 m` |
| `m` | `1` … `500` | Prefer `m` through hundreds before `km`; **→ `1 km` when ≥1 km fits** (`promoteNextGe1`; cold and walked agree) |
| `km` | `1` … `500` | → `1 Mm` |
| `Mm` | `1` … `500` | → `R☉` when body preferred, else stretch toward `AU` |
| `R☉` | `1` … `200` | Bridge toward `AU`; body rung (standard-only) |
| `AU` | `1` … `500` | → `5 ld` (as-built promote spirit) |
| `ld` | `5` … `200` | → `1 ly` |
| `ly` | `1` … `500` | → `200 pc` |
| `pc` | `200` … `500` | → `1 kpc` |
| `kpc`…`Rpc` | `1` … `500` | Decade hop to next parsec prefix |
| `Qpc` | `1` … `5000` then sci | Ladder ceiling |

---

#### True Metric

Shared fine head through `µm`, then `mm → cm → dm → m → dam → hm → km → Mm → Gm…Qm → Ppc…Qpc` (no bodies / `AU` / `ld` / `ly` / `pc` mid-band — jumps `Qm`→`Ppc` per as-built).

| Unit | Preferred magnitude | Handoff / notes |
|------|---------------------|-----------------|
| Fine head (`qℓP`…`µm`) | Same as Standard Metric | |
| `mm` | `1` … `5` | → `1 cm` |
| `cm` | `1` … `5` | → `1 dm` |
| `dm` | `1` … `5` | → `1 m` (true-metric decade) |
| `m` | `1` … `5` | → `1 dam` (narrower than standard — neighbors exist) |
| `dam` | `1` … `5` | → `1 hm` |
| `hm` | `1` … `5` | → `1 km` |
| `km` | `1` … `5` | → `1 Mm` |
| `Mm`…`Rm` | `1` … `500` | Decade SI; → `1` next |
| `Qm` | `1` … `500` | → `1 Ppc` (as-built bridge) |
| `Ppc`…`Rpc` | `1` … `500` | Decade hop |
| `Qpc` | `1` … `5000` then sci | Ceiling |

*True-metric `dm`/`dam`/`hm` and mega–quetta bands above are PROPOSED from decade-hop consistency; still listed under Open Questions if the owner wants different widths.*

---

#### Standard Imperial

Tail after shared fine head: `mil → in → ft → yd → mi → R⊕ → R☉ → AU → ld → ly → pc → kpc…Qpc`.

| Unit | Preferred magnitude | Handoff / notes |
|------|---------------------|-----------------|
| Fine head (`qℓP`…`µm`) | Same decade `1`…`500` as metric | Shared rungs; **→ `1 mil` when 1 mil fits** (`promoteNextGe1`; flip at 1 mil, not at µm band hi ≈ 20 mil). Explicit handoff **`mil` over `µm`** when both band-hit (companion to promote — without it, L2 enter held µm until ~20 mil once 1 mil left the bar pool). |
| `mil` | `1` … `50` | Owns the sub-`1/16 in` band (incl. where `1/32 in` would sit as grammar). Bridge to inches via handoff **`in` over `mil`**: **`50 mil` ↔ `1/16 in`** (symmetric cold/walked). Without that handoff, `preferGe1` keeps mil through fraction overlap and jumps to `1/8`. |
| `in` | `1/16` … `1` | **Owner intent.** Preferred auto band is **`1/16`–`1` only** — not `1/32`…1 and not whole `1`…`10`. `1/32` remains nice grammar (3a) for labels/candidates but is **not** `bandHit`. L5/L12 user far edge still reaches **`10 in`**. **→ `1 ft`** when 1 ft fits (`promoteNextGe1` / I-01). |
| `ft` | `2` … `500` | Owner; at overlap prefer `200`–`500 yd` over `500 ft` |
| `yd` | `200` … `500` | Owner; **→ `0.5 mi` when 0.5 mi fits** (locked handoff; cold and walked agree) |
| `mi` | `0.5` … `1` | Owner; then body/AU preference |
| `R⊕` | `1` … `200` | → `R☉` / `AU` |
| `R☉` | `1` … `200` | → `AU` |
| `AU` | `1` … `500` | → `5 ld` |
| `ld` | `5` … `200` | → `1 ly` |
| `ly` | `1` … `500` | → `200 pc` |
| `pc` | `200` … `500` | → `1 kpc` |
| `kpc`…`Rpc` | `1` … `500` | Decade hop |
| `Qpc` | `1` … `5000` then sci | Ceiling |

---

#### Ultra-standard Metric

Inventory: `ℓP, fm, pm, nm, µm, mm, cm, m, km, AU, ly, pc` only.

| Unit | Preferred magnitude | Handoff / notes |
|------|---------------------|-----------------|
| `ℓP` | `1` … `500` | No Planck-prefix chain on this ladder; table shows **ℓP floor** — confirm sub-ℓP behavior (Open Questions) |
| `fm`…`µm` | `1` … `500` | Same as standard |
| `mm` | `1` … `5` | Same as standard |
| `cm` | `1` … `5` | Same as standard |
| `m` | `1` … `500` | Same as standard |
| `km` | `1` … `5000` | **Absorbs** omitted `Mm` / `R☉` band before `AU`; plain up to sci handoff |
| `AU` | `1` … `500` | **Absorbs** omitted `ld` — hand off to `1 ly` (no light-day rung) |
| `ly` | `1` … `5000` | Ultra override (owner) |
| `pc` | `200` … `5000` then sci | **Absorbs** omitted `kpc`…`Qpc`; ceiling on `pc` |

---

#### Ultra-standard Imperial

Inventory: `ℓP, fm, pm, nm, µm, in, ft, mi, AU, ly, pc` only.

| Unit | Preferred magnitude | Handoff / notes |
|------|---------------------|-----------------|
| `ℓP` | `1` … `500` | Same ultra metric note (ℓP floor in table; sub-ℓP still open) |
| `fm`…`µm` | `1` … `500` | Then → inches (no `mil`) |
| `in` (fractions + whole) | `1/16` … `10` | **Absorbs** omitted `mil` on the fine side; preferred lo matches owner **`1/16`** (`1/32` = nice grammar only). Whole still → `1 ft`. |
| `ft` | `2` … `5000` | **Absorbs** omitted `yd`; preferred through **5000 ft** until **`0.25 mi` fits** (L4) — then mi wins |
| `mi` | `0.25` … `1` | **Locked (L4):** when `0.25 mi` fits, it wins over feet (incl. toward 5000 ft); **absorbs** omitted `R⊕`/`R☉` toward `AU` after preferred mi |
| `AU` | `1` … `500` | **Absorbs** omitted `ld` → `1 ly` |
| `ly` | `1` … `5000` | Ultra override |
| `pc` | `200` … `5000` then sci | Absorbs omitted parsec prefixes; ceiling on `pc` |

---

### Open questions / gaps (remaining)

1. ~~Complete preferred-range table~~ → **Resolved (Q1)** — see PROPOSED table above.
2. ~~Ultra-standard omit `yd`/`mil`/`ld`/`R☉`/`R⊕`~~ → **Resolved (Q2)** — absent from inventory/preference/auto-walk; absorption encoded above.
3. ~~6a related-ladder meaning~~ → **Resolved (Q3)** — auto-show unit on related ladder at this zoom.
4. ~~minUnit hysteresis~~ → **Resolved (Q4)** — anti-flicker required; preferred ranges replace `minUnit`/`minUnitZoomAt` unless a separate lock is proven necessary later.
5. ~~User preferred-range edge / cross-ladder user range~~ → **Resolved (Q5)** — standard bands from prefer-≥1 + bounds + nice; off-ladder pick → switch ladder (by priority) + user preferred range on the new ladder (unless rule 3).
6. ~~Doc structure~~ → **Resolved** — bible at `boundless/docs/scale-bar-ruling-design-bible.md`; design options under `boundless/docs/scale-bar-design-options/`.
7. **True Metric** band widths for `dm`/`dam`/`hm` and `Mm`…`Qm` — PROPOSED decade defaults above; confirm or edit.
8. Body/astro extras on **standard** ladders (`R☉`, `R⊕`, `ld`, `Tpc`…): confirm preferred widths; do they appear in popover rung 6d “non-SI-prefix”?
9. Sci notation **display** style (Unicode superscripts vs `e`) — keep as-built?
10. **ℓP / sub-ℓP floor** on ultra-standard — PROPOSED table shows an **`ℓP` floor** (`1`…`500`); confirm sub-ℓP behavior (how far below `1 ℓP` before sci-only, and whether ultra ever exposes `qℓP`…`mℓP` via picker only).

---


## 6. Acceptance test catalog

Full specs live in **[scale-bar-test-catalog.md](./scale-bar-test-catalog.md)** (not implemented — design-time specs only).

Coverage map:

| Area | Catalog ids |
|------|-------------|
| Rules 1–9 | `T-R1-*` … `T-R9-*` |
| Failure modes F1–F10 | `T-F1-*` … |
| Sticky ladder + preferred ranges | `T-P-*` (incl. Q4 anti-flicker `T-P-07`, ultra ft→5000 `T-P-08`) |
| Ultra-standard ladders | `T-U-*` (incl. absorption `T-U-06`…`T-U-09`; `T-U-06` = ft through 5000) |
| User override / Q5 | `T-R5-*` (incl. off-ladder user range `T-R5-06`, band edge `T-R5-07`) |
| Popover rungs 6a–6e | `T-POP-*` |
| Set-scale rungs 7a–7d | `T-SET-*` |
| Coalesced / large jumps | `T-Z-*` |
| Inch fraction chain incl. 1/32 | `T-IN-*` |

---

## 7. Redesign evaluation criteria

Future design proposals must check all of the following:

- [ ] **UX unchanged** — HUD, popover shell, Set scale, Clear behave as §1 (constraint 9).
- [ ] **Five ladders** with inventories matching §2 (incl. both ultra-standard); related-ladder + priority tables encoded as data.
- [ ] **Bar always in bounds** (constraint 2); extreme zoom still sane (constraint 1).
- [ ] **1/2/5** (and inch 1/8–1/32 → `.01`) with tunable `.001`–`5000` → sci (constraint 3 / 3a).
- [ ] **Preference stack** stay-ladder → preferred range → prefer ≥1 (constraint 4); user overrides per constraint 5 with teardown rules (incl. user range on off-ladder pick); preferred ranges match §5 PROPOSED table; anti-flicker via preferred ranges (no separate minUnit lock unless proven necessary).
- [ ] **Popover / dialog rung rules** 6a–6e and 7a–7d implemented as reorderable config (constraint 8), not hard-wired one-offs.
- [ ] **No dependence** on fragile `previousHud` alone for correctness under coalesced zoom; tests include large jumps (F1, F5, F6).
- [ ] **Sticky display ladder** survives shared units, far-pin release, and preference/meta writes (F3, F4).
- [ ] **Manual cross-ladder picks** never cold-start into Planck/random units (F2, F7).
- [ ] **Acceptance catalog** in `scale-bar-test-catalog.md` can be executed (or mapped 1:1 to automated tests) without contradicting this bible.
- [ ] **Docs/code alignment** — this bible wins over older v1/ladders drafts where they conflict until those drafts are revised.
- [ ] **Design options** — historical proposals under `boundless/docs/scale-bar-design-options/`; **build plan** is [`scale-bar-ruling-implementation.md`](./scale-bar-ruling-implementation.md); this bible remains the product-constraint source of truth.

---

## Appendix A — File map

| Path | Role |
|------|------|
| `boundless/docs/scale-bar-ruling-design-bible.md` | This bible (product constraints) |
| `boundless/docs/scale-bar-ruling-implementation.md` | Ruling implementation / build plan |
| `boundless/docs/scale-bar-test-catalog.md` | Acceptance test specs |
| `boundless/docs/scale-bar-design-options/` | Historical design-option proposals |
| `boundless/src/engine/scaleBar/` | Ruling engine (catalog, membership, preference, resolve, pick, rungs, session) |
| `boundless/src/engine/scaleBar.js` | Thin facade re-export |
| `boundless/src/Pages/CanvasEditor.js` | HUD, set-scale, clear, scaleSession |
| `boundless/src/Components/editor/ScaleUnitPicker.js` | Popover + dialog unit grid/table |
| `boundless/src/hooks/useKobinEngine.js` | Status throttle; immediate `effectiveZoom` flush |

## Appendix B — Supersedence

Where this bible conflicts with `scale-bar-v1-spec.md`, `scale-bar-ladders.md`, or `scale-bar-design-decisions.md`, **this bible rules for product constraints**. Older docs remain historical / partial UX notes.

Where **locked decisions** in [`scale-bar-ruling-implementation.md`](./scale-bar-ruling-implementation.md) conflict with §5 PROPOSED cells or design-option proposals, the **implementation doc rules for the build** until this bible is edited to match. Architecture choice (hardened 03 + 07/02/08) is recorded only in the implementation doc — options under `scale-bar-design-options/` are not binding.
