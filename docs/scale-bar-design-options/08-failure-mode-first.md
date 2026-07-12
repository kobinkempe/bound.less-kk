# Design Option 08 — Failure-Mode-First Scale Bar

**Status:** proposal (docs only; not authoritative).  
**Authority:** [`../scale-bar-ruling-design-bible.md`](../scale-bar-ruling-design-bible.md)  
**Acceptance tests:** [`../scale-bar-test-catalog.md`](../scale-bar-test-catalog.md)  
**Focus:** robustness — make F1–F10 structurally impossible or automatically guarded via explicit contracts between the engine zoom stream and the scale resolver.

---

## 1. Thesis

Treat every known failure mode as a **type-system / module-boundary violation**, not a scoring tweak.

The as-built design fails when correctness depends on:

1. a **post-render `previousHud` ref** that any path can null,
2. a **narrow search window** around that ref under coalesced Δzoom,
3. **ladder identity derived from the current unit** (`stackForUnit`) instead of durable session state,
4. **shared commit helpers** that wipe display prefs as a side effect,
5. **dead pin modes** and **fine-step-only tests** that hide the real failure surface.

This option inverts that: the scale reading is a **pure function of absolute meters-per-pixel + durable session prefs**. The zoom stream’s only job is to deliver a well-formed **ZoomEpoch**. Intermediate walk state is optional for animation continuity, never required for correctness. Preferred ranges (bible §5) are the sole anti-flicker mechanism (Q4). Pins and user ranges are explicit, non-null, and never share a “stack with no unit” mode.

**Correctness claim:** Given `(ZoomEpoch, ScaleSession, LadderConfig)`, `resolveScaleReading` returns the unique preferred reading under constraints 1–5. Coalesced jumps, cold starts, far-pin release, and meta writes cannot produce Planck jumps, skipped feet, or ladder flips through shared units — because those outcomes are unreachable from the resolver’s inputs.

---

## 2. Metaphor

**Ruler, not trail.**

A physical scale bar does not remember the last tick you glanced at; it reports the length that fits the current view. The HUD is a **ruler held against absolute meters-per-pixel**, with a **sticky unit system** (ladder + preferred bands) taped to the side. Zoom bursts are just larger view changes — the ruler still reads the same absolute length. You never “walk the trail of previous ticks” to find the answer; you only consult the trail if you want smoother label animation.

---

## 3. Types / modules

### 3.1 Core types (conceptual)

```ts
/** Monotonic zoom sample from the engine → React status path. */
type ZoomEpoch = {
  seq: number;              // strictly increasing per engine session
  effectiveZoom: number;    // > 0, finite
  atMs: number;             // performance.now() or engine clock
  kind: "flush" | "throttled" | "synthetic-bridge";
};

/** Durable display preference — survives remount of HUD memo, not a walk ref. */
type ScaleSession = {
  ladderId: LadderId;       // one of five; NEVER inferred from unit alone
  userRange: UserPreferredRange | null;
  pin: ScalePin | null;     // near | far only; unit always present
  // lastReading is DISPLAY-ONLY (label continuity); resolver may ignore it
  lastReading: ScaleReading | null;
};

type ScalePin =
  | { mode: "near"; unit: UnitId }
  | { mode: "far"; unit: UnitId };
  // intentionally NO "stack" mode

type UserPreferredRange = {
  ladderId: LadderId;
  unit: UnitId;
  /** Inclusive magnitude band in display units (bible constraint 5). */
  minValue: number;
  maxValue: number;
};

type ScaleReading = {
  value: number;
  unit: UnitId;
  barPx: number;
  ladderId: LadderId;
  metersPerPx: number;
  displayLabel: string;
  /** Provenance for tests / debug — which preference rule won. */
  reason:
    | "pin-far"
    | "pin-near"
    | "user-range"
    | "standard-preferred"
    | "stay-ladder-ge1"
    | "bounds-fit";
};

type LadderConfig = {
  ladders: Record<LadderId, UnitId[]>;
  priority: LadderId[];           // bible §2 order
  related: Record<LadderId, LadderId[]>;
  preferredBands: PreferredBandTable; // bible §5 PROPOSED
  bar: { minPx: number; maxPx: number; targetPx: number };
  nice: NiceNumberConfig;         // 1/2/5, inch fractions incl. 1/32, sci band
  popoverRungs: RungRule[];       // 6a–6e as data
  setScaleRungs: RungRule[];      // 7a–7d as data
};
```

### 3.2 Module boundaries

| Module | Owns | Must not |
|--------|------|----------|
| **`zoomEpochStream`** (engine / `useKobinEngine`) | Emit `ZoomEpoch` on every distinct `effectiveZoom`; flush immediately on zoom; throttle non-zoom status | Coalesce away intermediate zooms without emitting; invent scale readings |
| **`scaleSessionStore`** (editor session, not a render ref) | `ladderId`, `userRange`, `pin`, optional `lastReading` | Derive ladder from `stackForUnit(reading.unit)`; clear ladder on preference/meta writes |
| **`mppFromAnchor`** | Pure: `(scaleDef, effectiveZoom) → metersPerPx` | Depend on previous HUD |
| **`resolveScaleReading`** | Pure: `(mpp, session, config) → ScaleReading` | Require `previousHud` for correctness; open a rank search window; call React |
| **`applyUnitPick`** | Constraint 5 transitions → new `ScaleSession` | Leave `pin` null with a “sticky stack only” mode; clear `ladderId` |
| **`pickerRungs` / `setScaleRungs`** | Membership from config rules | Hard-code one-off unit lists in UI |
| **`ladderConfig`** | Single data source for inventories, bands, rungs, constants | Duplicate tables in markdown-only form without a codegen or shared import path (see F9) |

### 3.3 Data flow

```
engine effectiveZoom
        │
        ▼
 zoomEpochStream ──ZoomEpoch──► CanvasEditor / session
        │                              │
        │                              ├─ scaleDef (doc)
        │                              └─ ScaleSession (ephemeral)
        │                                      │
        └────────── seq + zoom ────────────────┤
                                               ▼
                                    mppFromAnchor(scaleDef, zoom)
                                               │
                                               ▼
                                    resolveScaleReading(mpp, session, config)
                                               │
                                               ▼
                                    HUD + session.lastReading (display only)
```

**Invariant:** Dropping `lastReading` (or remounting) and calling `resolveScaleReading` again with the same `(mpp, session, config)` yields the **same** reading (modulo floating noise within a documented ε). That is the cold-start contract.

---

## 4. Contracts

### 4.1 ZoomEpoch stream ↔ resolver

| Rule | Contract |
|------|----------|
| **Z1 — Distinct zoom ⇒ epoch** | Every change to `effectiveZoom` that the engine observes produces a `ZoomEpoch` with a new `seq` before React status is published. Non-zoom status may remain throttled (~50 ms). |
| **Z2 — No silent coalesce** | The stream must not replace N zoom samples with one without either (a) emitting each, or (b) emitting a single epoch whose `effectiveZoom` is the **final** value **and** documenting that the resolver is absolute (this design chooses absolute — so final-only is OK for correctness). |
| **Z3 — Finite positive zoom** | Epochs with non-finite or ≤0 zoom are rejected; last good epoch retained; HUD shows last good reading. |
| **Z4 — Seq monotonic** | Consumers ignore epochs with `seq ≤ lastAppliedSeq` (stale async). |
| **Z5 — Resolver purity** | `resolveScaleReading` takes `mpp` derived from the epoch’s zoom + anchor; it does **not** read a walk ref. |
| **Z6 — Optional bridge** | A `synthetic-bridge` epoch series may be emitted for **label animation** only. Correctness tests must pass with bridge **disabled**. |

### 4.2 ScaleSession mutations

| Event | Allowed mutations | Forbidden |
|-------|-------------------|-----------|
| Auto resolve | Update `lastReading` only | Change `ladderId`, `userRange`, `pin` |
| Near pick | Set `pin = {near, unit}`; set `ladderId` per constraint 5; maybe install `userRange` | Clear `ladderId`; set pin without unit |
| Far pick | Set `pin = {far, unit}`; set `ladderId`; seed `lastReading` from pinned reading at current mpp | Clear walk/session; null pin |
| Far release | `pin = null`; keep `ladderId` + `userRange` | `resetDisplayFloor` / clear ladder |
| User-range teardown (in-range unit change / ladder switch) | Per constraint 5 | Wipe ladder as side effect of unrelated meta write |
| Preference / band handoff (auto) | None on session prefs (bands are config) | Any `commitScaleDef` that clears display floor |
| Clear / redefine scale | Reset entire `ScaleSession` | Leave orphan pin/range |

**Commit split:** Document meta (`scaleDef`, optional persisted floor if any) and display session (`ScaleSession`) use **separate writers**. A helper that persists `scaleDef` must not call display reset. That structurally kills F4.

### 4.3 Resolver decision order (constraint 4 + 5)

Given `mpp` and `session`:

1. If `pin.mode === "far"` → reading on `pin.unit` only (sci-style as today); bar clamped to bounds; release checked separately via `shouldReleaseFarPin(autoReading, pin)`.
2. If `pin.mode === "near"` → force that unit’s nice reading that fits bounds at `mpp` (or nearest in-bounds nice); release on any zoom change (existing UX).
3. If `userRange` active and current size falls in band → stay on `userRange.unit` with nice values.
4. Else on `session.ladderId`: choose unit/value by **stay-ladder → standard preferred band → prefer ≥1** (constraint 4), using §5 bands as data.
5. Bar length always clamped to `[minPx, maxPx]`; if no nice fits, expand search on **same ladder only** by rank adjacency until bounds satisfied (never jump to another ladder’s exclusive rungs).

**No step consults `lastReading` for unit choice.** `lastReading` may only bias **which nice label** to show when two nices score equally (optional tie-break); tests for F1/F7 must pass with `lastReading = null`.

### 4.4 Ladder identity

- `ladderId` is **session-authoritative**.
- `stackForUnit(unit)` is used only when **installing** a ladder (set-scale save, cross-ladder pick) via **priority** among owners — never on every frame.
- Shared units (`Qpc`, `mm`, …) never flip the sticky ladder.

### 4.5 API surface bans

| Banned | Replacement |
|--------|-------------|
| `pinMode: "stack"` with null/`undefined` pin | Near/far with required `unit`, or `userRange` without pin |
| `previousHud` as required input to `computeScale` | Optional `lastReading` for ties/animation only |
| `resetDisplayFloor()` inside `commitScaleDef` | Explicit `resetScaleSession()` only on Clear / redefine |
| Rank search window gated on zoom-in vs zoom-out | Absolute preferred-band resolve on sticky ladder |
| Fine-step-only CI as sole zoom coverage | Mandatory coalesced suite (see §7) |

---

## 5. Config

All bible tunables live in one `ladderConfig` (or split files imported as one graph):

| Key | Role |
|-----|------|
| `ladders.*` | Five inventories (§2), ultra omit list enforced by absence |
| `priority` / `related` | Tables as data |
| `preferredBands[ladderId][unit]` | `{ min, max, handoffNotes? }` from §5 PROPOSED |
| `bar.minPx / maxPx / targetPx` | Constraint 2 |
| `nice.plainMin / plainMax` | `.001` … `5000` |
| `nice.mantissas` | `[1,2,5]` |
| `nice.inchFractions` | `[1/8, 1/16, 1/32]` then decimals at `.01` |
| `popoverRungs[]` | Ordered rule ids implementing 6a–6e |
| `setScaleRungs[]` | Ordered rule ids implementing 7a–7d |
| `tableFlipAt.popover` / `.setScale` | 12 / 22 |
| `zoomStream.flushOnEffectiveZoom` | `true` (Z1) |
| `resolver.requireLastReading` | **`false`** (hard default; tests assert) |

Constraint 8: moving a unit between preferred bands or a membership rule between rungs is a config edit, not a walk-core rewrite.

---

## 6. How each F1–F10 is prevented

| ID | Failure | Structural prevention |
|----|---------|------------------------|
| **F1** | Feet skipped on coarse zoom-out from inches | Unit choice is **absolute** from `mpp` + sticky imperial ladder + preferred bands (`in` → `1 ft` via prefer-≥1 before `yd`/`mi`). No +1-rank search window; no dependence on fresh `previousHud`. Large Δzoom still lands on `ft` when that band wins. |
| **F2** | `dm` pick → Planck / random | `applyUnitPick("dm")` always sets `ladderId = true-metric`, installs pin or userRange with **unit = dm**, seeds `lastReading` from current mpp on that unit. Resolver never cold-searches from everyday floor with null session. Far pick does **not** clear session. |
| **F3** | Display stack not sticky at shared units | `ladderId` is durable session state; frame resolve never calls `stackForUnit`. `Qpc` on true-metric stays true-metric. |
| **F4** | Far-pin release / promotion clears sticky stack | Split writers: `commitScaleDef` ≠ `resetScaleSession`. Far release only clears `pin`. Auto preferred-range handoffs write **no** display floor. |
| **F5** | Brittle `previousHud` ↔ React coupling | Walk correctness lives in pure resolver + `ScaleSession` store updated **before** paint from the epoch, not a ref assigned after `useMemo`. Null `lastReading` is a valid, tested state. |
| **F6** | Fine-step tests miss coalescing | Contract **T-harness**: CI must include coalesced / large-Δ cases (`T-Z-*`, `T-F1-*`). Config flag `resolver.requireLastReading === false` ensures absolute path is what production uses. |
| **F7** | Cold start stuck on oversized anchor | Absolute resolve: if anchor unit/value fails bar bounds, demote/promote on sticky ladder from `mpp` alone. Prefer-anchor-when-`!previousHud` is **removed**. |
| **F8** | Inch chain missing `1/32` | `nice.inchFractions` includes `1/32` in config; inventory tests (`T-IN-*`, `T-F8-01`) lock it. |
| **F9** | Docs vs code drift | Ladder inventories + preferred bands + rung rules are **one config module**; bible §5 tables are generated from or checked against that module in CI (snapshot / schema test). Older v1 docs remain non-authoritative (bible Appendix B). |
| **F10** | `pinMode: "stack"` dead path | Type/API: `ScalePin` is only `near` \| `far` with required `unit`. No stack mode in resolver. Contract test `T-F10-01`. |

---

## 7. Test mapping

| Catalog / area | How this design satisfies |
|----------------|---------------------------|
| **T-F1-01, T-F1-02, T-Z-02, T-Z-03, T-P-01, T-R4-03** | Absolute resolve with `lastReading = null` and large Δmpp; expect `ft` before `yd`/`mi`. |
| **T-F2-01, T-F2-02** | Pick → session with unit+ladder; recompute; far release keeps ladder; never Planck. |
| **T-F3-01, T-R4-01** | Sticky `ladderId` through `Qpc` and shared rungs. |
| **T-F4-01, T-F4-02** | Meta write / far release leave `ladderId` intact; assert `commitScaleDef` does not call session reset. |
| **T-F5-01, T-F7-01, T-Z-04** | Null `lastReading`; oversized anchor demotes; large zoom-in stays on-ladder. |
| **T-F6-01, T-Z-01** | Harness includes coalesced jumps; zoom flush contract instrumented. |
| **T-F8-01, T-IN-*, T-R3a-*** | Config-driven inch fractions including `1/32`. |
| **T-F10-01** | Type/API: no stack-pin without unit. |
| **T-R5-*, T-P-02, T-P-07** | `applyUnitPick` + userRange / preferred bands; anti-flicker without minUnit. |
| **T-U-*, T-POP-*, T-SET-*, T-R8-01** | Five ladders + rung config data. |
| **T-X-01, T-X-02** | Clear / redefine call `resetScaleSession` only. |

**Harness rule (design-mandated):** At least one test per land-band handoff (`in→ft`, `ft→yd` or ultra `ft→mi`, `cm→dm` on true-metric) must run with:

- `lastReading = null`, and  
- Δmpp ≥ 10× (or documented wheel-burst equivalent),

in addition to any fine-step walk tests.

---

## 8. Tradeoffs

| Gain | Cost |
|------|------|
| Coalesced zoom correctness without brittle bridge | Bridge becomes optional polish; label may “jump” a rung visually on huge single-frame Δzoom unless synthetic epochs are added for animation |
| Cold start / far pick safety | Must keep `ScaleSession` in a real store (context/ref-as-store updated synchronously on pick), not only derived React state that remounts wipe |
| Sticky ladder forever | Session must be explicitly reset on Clear / Set scale; bugs shift to “forgot to reset” (covered by T-X-*) |
| Absolute preferred-band resolve | Scoring heuristics and special-case bridges (`inch↔mil`, etc.) move into **band + handoff config**; mis-tuned bands show up as preference bugs, not skip bugs — easier to fix in data |
| Ban `previousHud`-required path | Slightly less “sticky” nice-number continuity across equal-score ties; acceptable under constraint 4 |
| Stricter module split | More files / types than as-built `computeScale` monolith; worth it for F4/F5 |

**Non-goals of this option:** Changing UX chrome (constraint 9); inventing a new preference philosophy beyond bible §2/§5; keeping as-built `minUnit` hysteresis (Q4).

---

## 9. Assumptions

1. Bible §5 PROPOSED preferred bands are authoritative enough to uniquely determine the auto unit for a given `(ladderId, mpp)` within bar bounds (ties broken by prefer-≥1 then target bar px).
2. Immediate `effectiveZoom` flush (as-built) remains; absolute resolve means even a single final epoch after a burst is correct — flush is for responsiveness / animation, not for skip prevention.
3. `ScaleSession` is ephemeral (not in doc meta), matching today’s display preference lifetime; Clear / redefine wipe it.
4. Far-pin UX (force unit until release threshold) remains; implementation uses explicit `pin.mode === "far"`, not stack mode.
5. Float stress at extreme zoom (constraint 1) stays on the existing mpp/anchor approach; this option does not redesign numeric representation.
6. CI can import or snapshot `ladderConfig` to guard F9; markdown bible may lag until a generation step exists — until then, a schema test against bible-listed inventories is the minimum.

---

## 10. Clarifying questions

None blocking. Open bible items (true-metric band widths, body/astro popover membership, sci display style, ultra sub-ℓP floor) are product tunables that plug into `ladderConfig` without changing this architecture.

---

## 11. Evaluation checklist (bible §7)

- [x] UX unchanged (constraint 9) — session/resolver only  
- [x] Five ladders + related/priority as data  
- [x] Bar bounds + extreme zoom preserved  
- [x] 1/2/5 + inch 1/32 via config  
- [x] Preference stack + user ranges; anti-flicker via preferred ranges  
- [x] Popover / set-scale rungs as reorderable config  
- [x] No dependence on fragile `previousHud` for coalesced correctness  
- [x] Sticky ladder survives shared units, far release, meta writes  
- [x] Manual cross-ladder picks cannot cold-start to Planck  
- [x] Catalog mappable 1:1 (§7)  
- [x] Docs/code alignment via shared config (F9 plan)  
- [x] Lives under `scale-bar-design-options/`  

---

## Appendix — One-page algorithm

```
onZoomEpoch(e):
  if e.seq <= lastSeq: return
  lastSeq = e.seq
  mpp = mppFromAnchor(scaleDef, e.effectiveZoom)
  reading = resolveScaleReading(mpp, session, config)  // pure, absolute
  session.lastReading = reading                        // display only
  render(reading)

onUnitPick(unit):
  session = applyUnitPick(session, unit, mpp, config)  // constraint 5; always sets ladder + unit-bearing pin or userRange
  reading = resolveScaleReading(mpp, session, config)
  render(reading)

onFarRelease / onClear / onRedefine:
  mutate session per §4.2 only — never via commitScaleDef side effects
```
