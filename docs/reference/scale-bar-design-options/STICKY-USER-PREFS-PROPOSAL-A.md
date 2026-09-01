# Proposal A — Full-bar userBand lifetime (L2-aligned exit)

**Status:** **SHIPPED as A-pool hybrid** (2026-07-11) — pool-exit + `tLog > logHi` far-edge cap; keep B⁺ install bar headroom + A6 write-back. Do **not** clear solely for `tLog < logLo`. `userHit` = any in-pool stop of the preferred unit. See `STICKY-USER-PREFS-LIVE-FAILURE.md`. Historical sections below describe the pre-ship interval-exit world.  
**Author:** Proposal Agent A (sticky user preferences).  
**Coordinator notes:** `STICKY-USER-PREFS-COORDINATOR.md` was not present at draft time (checked twice).  
**Authority:** bible constraint 5 / L5–L12; implementation `scaleBar/` as-built.

---

## 1. Problem statement

User preferred ranges feel **non-sticky**: after an L5/L12 pick, a modest zoom that stays within the preferred *unit’s usable bar* still drops the override and snaps back to auto (standard bands / promote / handoff).

Engine unit tests already cover “hold while inside `[logLo, logHi]`” and “tear down at Qpc (S2)”. The live failure mode is the **gap between those two**: zoom that leaves the **stored install interval** while the preferred unit can still draw a legal bar.

---

## 2. Root-cause hypothesis

**Primary:** I-02 teardown is tied to the **install interval**, not to the unit’s **full allowed bar range**.

| Piece | Behavior today |
|-------|----------------|
| `buildUserBand(ladderId, unit, pickLogLen, { logBarMax })` | Stores `[min(pick, far), max(pick, far)]`, optionally extending **coarse** `logHi` to `logBarMax` (`preference.js`). |
| `userBandExited(userBand, tLog)` | `true` when `tLog < logLo - eps` **or** `tLog > logHi + eps` (`preference.js`). |
| `clearUserBandIfExited(session, mpp)` | Clears when exited (`session.js`). |
| `computeScale` | Calls `clearUserBandIfExited` then `resolveReading` (`index.js`). |
| `resolveReading` | Also nulls local `userBand` when `userBandExited`; `userHit` requires `stop.logLen ∈ [logLo, logHi]` **and** `stop.unit === userBand.unit` (`resolve.js`). |

Consequences:

1. **Fine-side cliff:** `logLo` is the **quantized pick** at install, not the finest in-bounds nice for that unit. Zooming slightly finer than the pick (still with e.g. `dm` stops in `candidatesOnLadder`) → `clearUserBandIfExited` → auto wins. Preference dies while the unit is still displayable.
2. **Coarse-side band-aid already admits the bug:** `pick.js` extends `logHi` via `logBarMax` so `am` from `5 pm` survives ~`1e-6` zoom-out (`userRange.test.js` “coarse headroom”). That is a one-sided patch for the same interval-exit model; the fine side has no equivalent.
3. **Scoring vs lifetime mismatch risk:** even if session teardown were delayed, `userHit` still requires `logLen ∈ [logLo, logHi]`, so a kept `userBand` outside the interval would not outrank standard bands until zoom re-enters the interval (soft sticky re-entry — also wrong).

**Secondary (not the main fix, but do not regress):**

- **L6** preferred picks intentionally set `userBand: null` (`pick.js`); stickiness is only `incumbentUnit` + L2. Out of scope for this proposal’s code change, but product may still perceive “picks aren’t sticky” on L6 paths.
- **CanvasEditor** already write-backs `computeScale`’s session (`useEffect` on `hudBundle`, ZS-01). Keep that. Do **not** “fix” stickiness by skipping I-02 write-back (that reopens S2 sticky re-entry).
- **`engine.engineReady` effect** still calls `clearDisplayPrefs` on ready/canvas change — correct for L9 bootstrap; ensure it does not re-fire spuriously mid-session.

**Rejected as primary cause:** “never persisting session in the HUD” — write-back is present; engine tests for in-interval hold are green. The interval **definition of exit** is what makes prefs feel non-sticky.

---

## 3. Design (one architecture)

### Name

**Full-bar userBand lifetime** — align user-preference **exit** (and **userHit**) with L2 incumbent exit: preference lasts while the preferred unit still has any in-bounds stop on the sticky ladder; clear when it does not.

### Semantics

Keep install math unchanged (`buildUserBand` / L5 / L12 far edge / `logBarMax`). Change **lifetime + scoring**:

| Event | New rule |
|-------|----------|
| **Install** | Unchanged: L5/L12 via `applyUnitPick` → `buildUserBand(...)`. |
| **userHit** (tier 0) | While `session.userBand` is non-null and not ignored: `userHit = (s.unit === userBand.unit)` for any stop in the resolve pool (i.e. any bar-legal stop of the preferred unit). Drop the `logLen ∈ [logLo, logHi]` gate for scoring. |
| **Auto teardown (I-02)** | Clear iff the preferred unit has **no** stop in `candidatesOnLadder(ladderId, mpp)` (same predicate spirit as L2: `incumbentActive = pool.some(s => s.unit === incumbent)`), **or** (shipped hybrid) `tLog > logHi`. Do **not** clear solely because `targetLogLen` left past `logLo`. |
| **L7 / L6 / `clearDisplayPrefs`** | Unchanged explicit clears. |
| **Sticky re-entry** | Still rejected: once cleared (full-bar exit or L6/L7/clear), zoom-back must not revive `userBand` without a new pick. S2 remains: `dm` → `Qpc` (no `dm` in pool) → clear → ~1 cm → `cm`/`mm`. |

### Concrete API / call-site changes

1. **`preference.js`**
   - Replace or narrow `userBandExited(userBand, tLog)` usage for teardown.
   - Add e.g. `userBandUnitMissingFromPool(userBand, pool) → boolean`  
     `!pool.some(s => s.unit === userBand.unit)`.
   - Keep `{ logLo, logHi }` on the stored band for debugging / docs / future enter margins; they are no longer the teardown oracle.

2. **`session.js` — `clearUserBandIfExited(session, mpp)`**
   - Resolve pool: `candidatesOnLadder(session.ladderId \|\| userBand.ladderId, mpp)` (import from `resolve.js`, or move a tiny shared `unitInBarPool(ladderId, unit, mpp)` helper to avoid cycles).
   - If `userBand` set and preferred unit absent from pool → `{ ...session, userBand: null }`.
   - Else return `session` unchanged.

3. **`resolve.js` — `resolveReading`**
   - Local ignore: if `session.userBand` and preferred unit not in `pool`, treat `userBand` as null for this resolve (mirror today’s in-frame clear).
   - `userHit` assignment: unit match only (see table).
   - Remove dependence on `userBandExited(..., tLog)` for these paths (or leave the function as a deprecated interval helper used only by tests until updated).

4. **`index.js` — `computeScale`**
   - Call order unchanged: `clearUserBandIfExited` → `resolveReading` → `withReading`. Behavior changes via session helper.

5. **`pick.js` / `buildUserBand`**
   - No change required for this proposal. Keep `logBarMax` (harmless headroom; no longer load-bearing for stickiness).

6. **Docs**
   - Bible constraint 5 teardown **(d):** change from “`targetLogLen` leaves `[logLo, logHi]`” to “preferred unit has no in-bounds bar stop on the sticky ladder (L2-aligned full-bar exit); sticky re-entry still rejected.”
   - Implementation doc B.6 / I-02 notes: same.

7. **`CanvasEditor.js`**
   - Keep session write-back. No architecture change unless equality check needs to tolerate the new lifetime (should already handle `userBand` nulling).

### Flow (after fix)

```text
pick (L5) → userBand installed [pick↔far]
     │
zoom (any direction)
     │
computeScale → clearUserBandIfExited
     │            └─ clear only if unit ∉ candidatesOnLadder
     ▼
resolveReading → userHit = any pool stop of userBand.unit
     │
leave full bar (e.g. dm at Qpc) → userBand = null → auto
zoom back → no re-install → cm/mm (S2)
```

---

## 4. Files to change

| File | Change |
|------|--------|
| `src/engine/scaleBar/preference.js` | New pool-based exit helper; stop using interval exit as teardown truth. |
| `src/engine/scaleBar/session.js` | `clearUserBandIfExited` uses pool absence. |
| `src/engine/scaleBar/resolve.js` | `userHit` = unit-in-pool; in-frame clear on pool absence. |
| `src/engine/scaleBar/index.js` | Comment / contract only (optional). |
| `src/engine/scaleBar/userRange.test.js` | New stickiness cases; update I-02 wording; keep S2. |
| `src/engine/scaleBar/resolve.test.js` | ZS-01 / any interval-exit assumptions. |
| `docs/scale-bar-ruling-design-bible.md` | Constraint 5 teardown (d). |
| `docs/scale-bar-ruling-implementation.md` | I-02 / B.6 lifetime. |
| `docs/scale-bar-test-catalog.md` | S2 / user-range sticky-while-in-bar notes. |

No React redesign. No new session fields (`stickyUntilClear`, pins, etc.).

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Preference holds across a **wider** zoom than `[pick, far]` (e.g. past L12 far edge while large nice values still fit) | Accept as matching L12 “while range active, unit wins”; far edge remains install documentation. If product wants a hard coarse cap, add optional `tLog > logHi` **or** pool-missing (AND), not instead of fine-side full-bar. Prefer pool-missing alone first. |
| Cycle: `session.js` → `resolve.js` → `preference.js` | Extract `unitHasBarStop(ladderId, unit, mpp)` next to `candidatesOnLadder`, or pass pool into `clearUserBandIfExited`. |
| Extreme floors (`qℓP` / sci) always “in pool” | Same as L2 incumbent; extremes already special-cased via `extremeCandidates`. Mirror that path in the missing-unit check. |
| L6 still non-sticky | Document as residual; separate proposal if product wants preferred picks to install a band. |
| Doc drift vs older I-02 interval wording | Patch bible + implementation in the same PR as code. |

---

## 6. Acceptance tests

Add / adjust automated cases (engine-first; editor smoke optional):

1. **Sticky fine of install (new):** true-metric; pick `dm` at ~1 cm mpp; zoom finer to a target where `dm` still appears in `candidatesOnLadder` but `targetLogLen < userBand.logLo`; expect `userBand` **retained**, reading `unit === "dm"`, `reason === "user-band"`.
2. **Sticky coarse inside far edge (existing spirit):** pick `dm`; zoom to ~2–5 dm; expect hold.
3. **S2 / no sticky re-entry (keep):** pick `dm` → mpp for `1 Qpc` → `clearUserBandIfExited` / `computeScale` → `userBand === null` → zoom back ~1 cm → `cm`/`mm`, not `dm` (`userRange.test.js` I-02/S2; `resolve.test.js` ZS-01).
4. **L12 mi hold:** pick `mi` from `1 in`; mid-range land zooms keep `mi` and suppress `ft`/`yd` while `mi` remains in pool.
5. **L7 unchanged:** in-range pick of another unit clears old band then normal L5/L6.
6. **L6 unchanged:** preferred-elsewhere pick → `userBand === null`, ladder switch only.
7. **am coarse noise (keep):** `am` from `5 pm` + tiny zoom-out still `am` (may pass without relying on `logBarMax` alone).
8. **Editor contract (keep):** `computeScale` returned session with cleared `userBand` must be written back (CanvasEditor equality path) so S2 cannot resurrect via stale React state.

---

## 7. Why better than naive “never clear `userBand`”

| | Never clear | Proposal A (full-bar exit) |
|--|-------------|----------------------------|
| S2 (`dm` → Qpc → ~1 cm) | **Fails** — dormant `userBand` re-captures `dm` on zoom-back | **Passes** — at Qpc, `dm ∉` pool → clear; zoom-back is auto |
| Modest zoom inside unit’s bar | Sticky (accidentally) | Sticky **by design** |
| L7 / L6 / clear scale | Must special-case anyway | Already clears; unchanged |
| Mental model | Pin forever | Same as L2 incumbent exit |
| Coarse `logBarMax` patch | Still needed ad hoc | Mostly redundant for lifetime |
| Bible “sticky re-entry rejected” | Violated | Honored |

Naive “never clear” optimizes for stickiness by deleting teardown. This proposal **keeps teardown**, but moves the exit oracle from **install interval geometry** to **“can this unit still form a bar?”** — which is what users mean by “my pick should stick until this unit is no longer usable.”

---

## 8. Out of scope (explicit)

- Installing `userBand` on L6 preferred picks.
- Persisting `userBand` in document meta.
- Reintroducing `pinMode` / far-pin.
- Changing lexicographic order in `keyFor` (tier 0 remains `userHit`).
- Skipping CanvasEditor write-back of cleared sessions.

---

## 9. Implementation checklist (for the winning implementer)

1. Implement pool-based `clearUserBandIfExited` + `userHit` unit match.  
2. Update bible/implementation I-02 wording.  
3. Green: new fine-sticky test + existing S2/ZS-01/L5/L6/L7/L12.  
4. Manual: pick non-preferred unit → zoom slightly finer and coarser within that unit’s bar → HUD stays on pick; jump to absurd zoom → returns to auto; zoom back → stays auto.
