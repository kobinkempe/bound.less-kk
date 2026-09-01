# Sticky User Prefs — Debate & Winner

**Inputs:** `STICKY-USER-PREFS-COORDINATOR.md`, Proposals A / B / C  
**Constraints:** L5–L12; no far-pin; write-back already exists (do not treat as sole fix); product stickiness = pick + nearby zoom within the intended physical interval; **S2 sticky re-entry stays rejected**.  
**Status:** **SUPERSEDED for I-02** — live dogfood proved B⁺-only interval exit insufficient; **shipped = A-pool hybrid** (pool-exit **or** `tLog > logHi`; keep B⁺ install + A6; `userHit` = any in-pool stop; do not clear solely for `tLog < logLo`). See `STICKY-USER-PREFS-LIVE-FAILURE.md`. Sections below are the pre-ship debate record.

---

## 0. Shared facts (non-negotiable)

Coordinator verified:

1. **Knife-edge at install (P0):** L5 `pickLogLen` is the nicest near `BAR_PX_TARGET`, often **coarser** than `targetLogLen(mpp)`. With `logLo = pickLogLen`, I-02 can be **true at the pick mpp** → first `computeScale` clears the band → write-back persists null.
2. **Asymmetric headroom:** `logBarMax` already papers coarse-end float; fine / target side has none.
3. **Write-back exists** and **amplifies** premature clears; a latent stale-`hudBundle` effect can also wipe a fresher banded pick (A6).
4. **Dual quantities (historical):** pre-hybrid I-02 used `targetLogLen`; `userHit` used stop `logLen` ∈ `[logLo, logHi]`. **Shipped:** both use pool membership; coarse clear also uses `tLog > logHi`.
5. **Product ceiling:** stick through nearby zoom while the unit can still draw a bar — **not** survive Qpc and reclaim on the way back.

---

## 1. Steelmans & fatal flaws

### Proposal A — Full-bar lifetime / clear when unit ∉ pool

**Steelman (A speaking)**

Users do not experience “install interval geometry”; they experience “I picked dm — keep dm while dm can still draw a bar.” Aligning teardown and `userHit` with L2’s pool check (`unit ∈ candidatesOnLadder`) fixes fine-side cliffs without inventing new session fields. S2 still works: at Qpc, `dm ∉` pool → clear → zoom-back cannot re-enter. The existing `logBarMax` patch becomes mostly redundant because lifetime no longer hinges on knife-edge `logLo`.

**Fatal flaws (adversarial)**

| Flaw | Why it hurts |
|------|----------------|
| **Misses coordinator’s preferred lever** | Rank-1/2 causes are **install extent vs I-02**, already half-fixed by `logBarMax`. A changes the **exit architecture** instead of finishing the bar-window precedent. |
| **Over-sticky vs product reading** | Preference can hold **past L12 far edge** while any in-bounds nice of that unit remains in pool — wider than “pick↔far (+ bar headroom).” |
| **A1 is accidental, not measured** | Pool exit *would* survive install (unit still in pool even if `tLog < logLo`), but A never unions `logBarMin`, so `userHit` under today’s interval gate would still fail unless A also drops the `logLen ∈ [logLo, logHi]` check — which it does. That couples scoring to a bigger semantic rewrite. |
| **A6 ignored** | Explicitly keeps CanvasEditor write-back unchanged; stale `next` replace landmine remains. |
| **Doc / bible churn** | Rewrites constraint 5 teardown (d) away from interval exit; larger review surface than a headroom fix. |

**A vs knife-edge-at-install:** Survives first frame **only because** exit/scoring stop using `[logLo, logHi]`. It does not fix the interval that I-02 and the bible still describe; it replaces that model.

---

### Proposal B — Symmetric `logBarMin`+`logBarMax` install window; keep I-02

**Steelman (B speaking)**

The bug is the same class as the `am`/`logBarMax` fix — incomplete. Union the **full bar pixel window at install mpp** into `[logLo, logHi]`:

```
logLo = min(pick, far, logBarMin)
logHi = max(pick, far, logBarMax)
```

Then I-02 stays literal (`targetLogLen` outside interval → clear; no sticky re-entry). Same-zoom survival: `logBarMin ≤ tLog` even when `pickLogLen > tLog`. Modest zoom-in/out gets a full `[60,180]` px of world-length headroom before teardown. I-08 stays clean (bar window ≠ §5 `band.lo`). S2 unchanged. Smallest coherent engine change.

**Fatal flaws (adversarial)**

| Flaw | Why it hurts |
|------|----------------|
| **A6 explicitly out of scope** | Coordinator: extent-only fix leaves the stale-`next` wipe. “If still broken at identical zoom, look at writer discipline” is not good enough once we know the race. |
| **Stickiness ceiling is the install bar window** | Fine zoom that leaves `[logBarMin…logHi]` but still shows the unit in the pool will clear — A argues that still “feels” non-sticky. Coordinator product text, however, endorses **interval** stickiness, not full-bar. |
| **Does not change `userHit`** | Fine — as long as extent is widened, stop `logLen` stays inside the band for nearby zooms. Must prove A1 with a case where `bestInBoundsNice.barPx > BAR_PX_TARGET`. |
| **Diversity miss** | Coordinator asked B for extent (hit); asked someone to own write-back merge — B declined. |

**B vs knife-edge-at-install:** **Direct hit.** This is the fix that matches ranked causes #1–#2 and the existing `logBarMax` precedent.

---

### Proposal C — Picker-driven; suspend not destroy; revises S2

**Steelman (C speaking)**

Ownership is wrong: zoom should not cancel a deliberate pick. Suspend when outside `[logLo, logHi]`, reactivate on return, clear only via picker Auto / L6 / L7 / L9. That matches “I chose this until I say otherwise,” adds an explicit release surface, and stops write-back from “locking in” geography-based teardowns.

**Fatal flaws (adversarial)**

| Flaw | Why it hurts |
|------|----------------|
| **Violates locked S2** | Coordinator + constraints: sticky re-entry after true exit is **rejected**. C inverts I-02/S2/ZS-01 by design. |
| **Fails knife-edge A1** | If `pickLogLen > tLog`, band is “exited” at install. C keeps permanent clear off `computeScale`, but `resolveReading` still **locally ignores** exited bands → HUD reverts to auto on the **first** post-pick frame. Suspend-not-destroy does not install stickiness when the interval is already exited at t=0. |
| **No fine-side headroom** | Relies on existing `logBarMax`; fine-side knife edge remains for scoring. |
| **L12 bands become long-lived ghosts** | `mi` preference can suspend across huge zooms and snap back — far-pin-adjacent product feel without calling it `pinMode` (L12 spirit). |
| **UI + bible rewrite tax** | Picker Auto, catalog inversion, S2 rewrite — large product change for a P0 that bar-window headroom already explains. |

**C vs knife-edge-at-install:** **Does not survive** without also adopting B-like extent (or A-like scoring). Pure C fails the coordinator’s primary repro.

---

## 2. Cross-examination

| Stress test | A (pool exit) | B (bar-window extent) | C (suspend / revise S2) |
|-------------|----------------|------------------------|-------------------------|
| **First post-pick `computeScale` (same zoom; `pick > tLog`)** | **Pass** — unit still in pool; `userHit` = unit match | **Pass** — `logLo ≤ logBarMin ≤ tLog`; interval exit false; `userHit` coherent | **Fail** — local exit ignore still drops tier-0 at install |
| **S2 (dm → Qpc → ~1 cm, no re-entry)** | **Pass** — dm ∉ pool at Qpc → clear | **Pass** — tLog ≫ logHi → clear; zoom-back no band | **Fail (by design)** — reactivates dm |
| **L6** | Pass if unchanged (no band) | Pass | Pass (treats L6 as clear) |
| **L7** | Pass (explicit clear then reinstall) | Pass | Pass |
| **Stale React effect (A6)** | **Fail** — unaddressed | **Fail** — explicitly deferred | Partial — lifetime not owned by I-02 null write-back, but blind `return next` can still replace a banded pick with a stale unbanded `next` |
| **L10 probes** | Pass if probes keep `ignoreUserBand` | Pass | Pass |
| **`userHit` ↔ I-02 coherence** | Rewired together (pool) | Kept together (widened interval) | Split: session retains band while resolve ignores — intentional, but install knife-edge still breaks display |
| **No far-pin / L12** | Risk: hold past far while unit in pool | Far edge still caps coarse span; bar max only adds install headroom | Risk: dormant band behaves like soft pin across distance |
| **Coordinator “write-back already exists”** | Honored (doesn’t claim missing write-back) | Honored | Honored, but then revises teardown ownership |

### Round notes

- **A on B:** “Bar window is still an install snapshot; users zoom past it while dm remains drawable.”  
  **B reply:** Coordinator product text *is* that snapshot interval (+ bar headroom). Full-bar is a different product (open rank-7), not the P0.
- **B on C:** “You revise S2 and still lose A1.”  
  **C reply:** Add Auto + extent later.  
  **Chair:** Extent-later admits B is load-bearing; S2 revision is out of bounds for this pass.
- **C on A:** “Pool exit is still zoom-owned teardown.”  
  **A reply:** Yes — and that is required for S2 without a picker Auto mandate.
- **Chair on A6:** None of A/B/C close the stale-`next` replace. Winner **must** add writer discipline regardless of extent/exit.

---

## 3. Winner

### Verdict (debate-time): **Hybrid B⁺** — **SUPERSEDED**

Debate-time pick was B’s extent + A6 write-back with **interval** I-02. **Shipped after live failure:** keep B⁺ + A6, escalate I-02 / `userHit` to **A-pool hybrid** (see `STICKY-USER-PREFS-LIVE-FAILURE.md`).

| Piece | Source | Debate | Shipped |
|-------|--------|--------|---------|
| Symmetric `logBarMin` ∪ `logBarMax` at L5/L12 install | **B** | Yes | **Yes** |
| I-02 interval exit + S2 no sticky re-entry | **B** | Yes | **No** — interval exit replaced |
| Clear when unit ∉ pool **or** `tLog > logHi`; `userHit` = unit-in-pool | **A** (+ far-edge) | Deferred | **Yes** |
| CanvasEditor A6 write-back race guard | Coordinator A6 | Yes | **Yes** |
| Suspend / reactivate; picker Auto; invert S2 | **C** | No | **No** |

### Rationale

1. **Matches the verified P0.** Install knife-edge and zoom-in ε are extent bugs. B finishes the one-sided `logBarMax` fix the codebase already endorsed.
2. **Honors locks.** L5–L12, I-08 (no `band.lo` union), L12 no far-pin, **S2 retained**. C is incompatible with “coordinator guidance wins” on sticky re-entry.
3. **Right stickiness feel.** Pick + modest zoom hold inside bar-window∪pick↔far. That is what “pick a unit and zoom a bit” means in the coordinator. A’s full-bar lifetime is a larger product move (and can outlive L12 far) — escalate only if B⁺ still feels short in HUD dogfood.
4. **Closes the P1 landmine.** Extent without A6 leaves a race that can look identical to “prefs aren’t sticky.” Equality / merge must prefer keeping `s.userBand` when `next.userBand` is null **only** when the clear is not a coherent engine teardown from the same generation — practical rule below.
5. **Rejects A’s exit as v1** so we do not rewrite bible teardown and `userHit` while fixing a bug that bar-min already solves. A remains the ranked fallback if product later wants L2-aligned full-bar preference.

### Why not “B’s extent + A’s exit”? (debate-time)

Debate argued combining both muddies I-02. **Live dogfood overturned that:** B⁺ alone clears at ~2× zoom-in; shipped hybrid keeps B⁺ for install knife-edge **and** A-pool for fine-side lifetime, with `logHi` as the coarse cap. Docs must state the hybrid explicitly (not “interval exit in docs, pool exit in code”).

### Stale-effect rule (concrete)

In `CanvasEditor` write-back updater:

- If `s.userBand` is non-null and `next.userBand` is null, **do not** blindly `return next` when `next` is observably stale relative to a newer pick (e.g. compare band identity / a monotonically increasing session generation, or: if `s.userBand` was set and `next` has the same ladder/incumbent but empty band **without** matching an engine clear that `hudBundle` was computed **from** current `s`).
- Minimal robust approach: stamp `prefsEpoch` (or reuse a pick counter) on `applyUnitPick` / `clearDisplayPrefs`; `computeScale` path threads epoch; effect ignores `next` with older epoch than `s`.
- Simpler acceptable approach if epoch is too heavy: when `s.userBand && !next.userBand`, keep `s` **unless** `hudBundle` was produced with `scaleSession` reference equal to current `s` (compute from latest session only — already true in `useMemo` deps) **and** equality failure is solely band nulling from that compute. The latent bug is **closed-over `next` from an older `hudBundle`**; fix by including a generation in the effect dependency payload or by merging: `userBand: next.userBand ?? s.userBand` **is wrong** for true I-02. Prefer **epoch** or “ignore this effect run if `s` changed since `hudBundle` was created.”

Recommended minimal fix: store `hudSourceSessionRef` / compare `scaleSession` identity the memo saw; if `setScaleSession` already advanced past that identity with a band, skip applying unbanded `next`.

---

## 4. Implementation checklist

### Engine — install extent (Proposal B)

| Step | File | Function / detail |
|------|------|-------------------|
| 1 | `src/engine/scaleBar/preference.js` | `buildUserBand`: accept `logBarMin` + `logBarMax`; `logLo = min(pick, far, …mins)`; `logHi = max(pick, far, …maxes)`; update comments (not coarse-only). |
| 2 | `src/engine/scaleBar/pick.js` | In L5/L12 path, pass `logBarMin = log10(BAR_PX_MIN)+log10(mpp)` and existing `logBarMax`. |
| 3 | Leave | `userBandExited`, `clearUserBandIfExited`, `resolveReading` interval/`userHit` gates — **unchanged**. |
| 4 | Leave | No `pinMode`; no pool-based exit; no suspend-only session. |

### Editor — stale write-back (A6)

| Step | File | Function / detail |
|------|------|-------------------|
| 5 | `src/Pages/CanvasEditor.js` | `useEffect` on `hudBundle`: never replace a newer banded `s` with a stale unbanded closed-over `next`. Prefer session-identity / epoch guard over “always keep band.” True I-02 clears from a compute that used current `s` must still persist null. |
| 6 | Optional | Tiny helper `shouldApplyScaleSessionWriteBack(s, next, meta)` colocated or in session helpers — keep editor thin. |

### Docs (same change set)

| Step | File | Detail |
|------|------|--------|
| 7 | `docs/scale-bar-ruling-implementation.md` | L5/L12 install unions **full** bar window at pick mpp; **shipped I-02 = A-pool hybrid** (not interval exit). |
| 8 | `docs/scale-bar-ruling-design-bible.md` | Constraint 5 teardown (d): pool-exit **or** `tLog > logHi`; keep B⁺ + A6. |
| 9 | Do **not** adopt C’s S2 rewrite. A-pool exit **did** ship after B⁺-only live failure. |

### Tests (must be green)

| Id | Where | Assert |
|----|-------|--------|
| **A1** | `userRange.test.js` | L5 pick with `niceStop.barPx > BAR_PX_TARGET` (or constructed `pickLogLen > targetLogLen`) → immediate `computeScale(same mpp)` keeps `userBand` + `user-band` / picked unit. |
| **A2** | `userRange.test.js` | After pick, `effectiveZoom` ±1e-6 / ±0.1% / ±1% within bar headroom → band + unit hold. |
| **A3** | `userRange.test.js` (+ ZS-01 companion) | dm → Qpc → `userBand === null`; zoom-back ≠ dm (S2). |
| **A4** | existing | L6 → no band. |
| **A5** | existing | L7 clears then normal install. |
| **A6** | editor unit or focused regression | Simulate pre-pick `nextSession` (no band) applied after pick set banded `s` → band **survives**; simulate real I-02 clear from current session → band **clears**. |
| **A7** | existing L10 / probe tests | Live `ignoreUserBand` probes unchanged. |
| **A8** | `userRange.test.js` | `am` from `5 pm` + 1e-6 zoom-out still `am` (via general min/max). |
| Builder | `userRange.test.js` | `buildUserBand` with both bar bounds → `logLo ≤ logBarMin`, `logHi ≥ logBarMax` when those sit outside pick↔far; I-08 still no §5 `band.lo` union. |

### Manual HUD smoke

1. True-metric: HUD on `cm` → pick `dm` → **same frame** stays `dm`.  
2. Wheel one notch in and out → stays `dm`.  
3. Zoom to absurd / Qpc → auto; zoom back → `cm`/`mm`, not `dm`.  
4. Imperial: `in` → pick `mi` → nearby zoom holds; large leave clears.  
5. L6 preferred pick still installs no band.

### Explicit non-goals this PR (debate-time; A-pool later shipped)

- Picker “Auto units” control (C).  
- Sticky re-entry / suspend-reactivate (C).  
- Pool-missing exit / unit-only `userHit` (A) — **deferred at debate time; shipped after live B⁺ cliff** (`STICKY-USER-PREFS-LIVE-FAILURE.md`).  
- “Add write-back” as the fix (already present).

---

## 5. Chair’s summary

| Proposal | Score vs coordinator P0 + locks |
|----------|----------------------------------|
| **A** | Solves symptoms via exit rewrite; overreaches product span; skips A6. |
| **B** | Correct root-cause lever; incomplete without A6. |
| **C** | Fails A1; illegal under S2 lock. |

**Debate-time ship B⁺:** symmetric bar-window install + race-safe session write-back; keep interval I-02/S2.

**Shipped after live failure:** B⁺ + A6 **plus** A-pool hybrid I-02 (pool-exit **or** `tLog > logHi`; `userHit` = unit-in-pool; do not clear solely for `tLog < logLo`). Reject C. See `STICKY-USER-PREFS-LIVE-FAILURE.md`.
