# Sticky User Prefs — Coordinator Critique of Proposals A / B / C

**Role:** coordinator critique (do **not** implement from this doc)  
**Inputs:** `STICKY-USER-PREFS-COORDINATOR.md`, `STICKY-USER-PREFS-PROPOSAL-{A,B,C}.md`  
**Date:** 2026-07-11  
**Status:** critique-time verdict (B primary) is **SUPERSEDED** for I-02 — B⁺ alone failed live; **shipped = A-pool hybrid** + B⁺ + A6. See `STICKY-USER-PREFS-LIVE-FAILURE.md`.

---

## 1. Executive verdict

| Proposal | Hits knife-edge install bug? | Preserves S2 / L5–L12 / no-pins? | Critique-time | Shipped |
|----------|------------------------------|----------------------------------|---------------|---------|
| **A** — Full-bar / pool-exit lifetime | **Yes** (by making install interval irrelevant to exit + `userHit`) | **Mostly yes** (S2 kept; I-02 *wording* revised; no pins) | Strong alternate | **Yes (hybrid)** — pool-exit + `tLog > logHi`; keep B⁺ + A6 |
| **B** — Symmetric bar-window install extent | **Yes** (direct fix of `logLo`/`logHi` knife-edge) | **Yes** (was paired with interval I-02) | Primary winner | **B⁺ install only** — interval I-02 dropped |
| **C** — Picker-driven persistence / suspend-reactivate | **No / incomplete** (still interval-gates scoring) | **No** — **violates S2 / “sticky re-entry rejected”** | Reject | **Reject** |

**Recommended path (critique-time):** implement **B**, plus A6; keep A as fallback. **Shipped path:** escalate to **A** (pool-exit + unit `userHit` + far-edge cap) after B⁺ live cliff; keep B⁺ + A6; reject C.

---

## 2. Which proposals address the knife-edge vs distractors

### Coordinator P0 reminder

Failure is **`logLo = pickLogLen`** with no fine/target-side headroom; when `bestInBoundsNice.barPx > BAR_PX_TARGET`, **`pickLogLen > targetLogLen`** ⇒ I-02 true **at the same zoom as the pick**. Write-back then persists the clear. Missing write-back is a **distractor** (already present).

### Proposal A

- **Addresses stickiness symptom** by changing the **exit + scoring oracle**: clear only when preferred unit ∉ `candidatesOnLadder`; `userHit` = unit match for any in-pool stop.
- That **does** fix A1/A2 even when `pickLogLen > tLog`, because interval exit is no longer load-bearing.
- Correctly rejects “never clear” and keeps S2 via pool-empty at Qpc.
- **Misaligned with diversity ask:** coordinator suggested A = write-back/session ownership; A shipped an **exit-policy** design (closer to the C lever). Still a coherent architecture — just not the editor-contract lever.
- **Distractor risk:** downplays install extent; leaves `buildUserBand` knife-edged. Harmless if pool-exit ships; confusing if someone implements only half of A.

### Proposal B

- **Directly targets P0:** union `logBarMin` + `logBarMax` at install into `buildUserBand`.
- Matches existing `logBarMax`-only precedent; completes the half-fix.
- Keeps literal I-02 interval exit and S2.
- Correctly names write-back as amplifier, not root cause.
- **Gap vs coordinator:** still treats stale write-back as out-of-scope; must be filled in hybrid (below). Acceptance tests should **explicitly** include same-zoom survival when `niceStop.barPx > BAR_PX_TARGET`, not only `1e-6` zoom-in.

### Proposal C

- **Primary lever is ownership / sticky re-entry**, not knife-edge extent.
- Claims coarse `logBarMax` already mitigates instant teardown — **coordinator contradicts this** for fine-end / pick-above-target cases.
- **Critical incomplete fix:** even after removing `clearUserBandIfExited` from `computeScale`, `resolveReading` still does in-frame `userBandExited` → local null. At install with `pickLogLen > tLog`, **HUD still won’t `userHit`**. C’s own C-REACTIVATE path still depends on `tLog ∈ [logLo, logHi]` — so **A1 can still fail** unless C also widens the band or stops interval-gating scoring.
- Treats “picks aren’t sticky” as product desire for suspend/reactivate — that is a **lock change**, not a bugfix under current bible.

---

## 3. Lock / constraint violations

| Lock | A | B | C |
|------|---|---|---|
| **S2 / I-02 no sticky re-entry** | Honors (clear at Qpc; no revive) | Honors | **Violates** — C-REACTIVATE is sticky re-entry; explicitly retires S2/ZS-01 |
| **L5** (nice → far install) | Keeps install; changes lifetime | Keeps + bar-window headroom (consistent with `logBarMax` precedent) | Keeps install; changes cancel semantics |
| **L6** | Unchanged | Unchanged | Unchanged (clear = return toward auto) |
| **L7** | Unchanged | Unchanged | Unchanged |
| **L8–L11** | OK | OK | OK |
| **L12 no pins** | OK (no `pinMode`) | OK | OK surface, but long-lived suspend **behaves like a soft pin** without calling it one |
| **I-08** no `band.lo` union | OK | OK (bar window ≠ band.lo) | OK |
| **Forbidden: disable I-02 permanent clear** | No — retargets exit | No | **Yes — removes permanent clear** |
| **Forbidden: sticky re-entry** | No | No | **Yes** |

**Reject C** unless product explicitly reopens constraint 5 teardown (d) and catalog T-F2-01 / ZS-01. Do not smuggle C in as a “bugfix.”

**A’s doc revision** of I-02 (interval → pool-missing) is allowed **if** S2 still holds and bible/implementation are updated in the same PR. It is a controlled lock *reinterpretation*, not a silent violation.

---

## 4. Blind spots

### Proposal A

1. **Holds past L12 far edge** while any large nice of that unit still fits the bar — may exceed “nice → far” product intent on the coarse side. A acknowledges optional `tLog > logHi` AND; implementer must decide before ship.
2. **`extremeCandidates` / floor-ceiling** can keep a unit “in pool” at absurd zooms — must mirror L2 carefully or S2-like exits weaken.
3. **No A6 write-back race fix** despite touching lifetime that write-back persists.
4. **`userHit` vs stored `[logLo, logHi]` diverge** — band fields become debug-only; docs/tests that assert interval membership for scoring must be rewritten.
5. Did not re-read coordinator (absent at draft); missed explicit A1 “pick > target” framing.

### Proposal B

1. **A6 ignored** — extent-only fix leaves stale-`next` wipe landmine.
2. **Stickiness only ~one bar window** past install on the fine side — may feel “still not sticky enough” if users expect full-unit lifetime (A’s product reading). Measure after A1/A2 before escalating to A.
3. Acceptance list under-emphasizes **same-zoom A1** with forced `barPx > BAR_PX_TARGET` fixture.
4. Did not re-read coordinator for A6 / dual-quantity warnings.

### Proposal C

1. **Does not fix A1** while `resolveReading` still interval-ignores exited bands.
2. **Openly breaks S2** — unacceptable under current coordinator locks.
3. New Auto UI is good product hygiene but **orthogonal**; does not excuse re-entry.
4. Wide L12 bands + suspend ⇒ preference lurks across huge zooms — surprise / support cost.
5. Mis-labels coordinator’s “Approach B” (silent flag) vs actual Proposal B (extent) — debate confusion risk.

### Shared (all three drafted without final coordinator)

None fully owned **both** P0 extent/exit **and** P1 write-back race. Hybrid required.

---

## 5. Recommended winner / hybrid

### Critique-time ship: **B + A6** — **SUPERSEDED for I-02**

1. **Engine (B):** `buildUserBand` unions install `logBarMin` and `logBarMax` with pick↔far; `pick.js` passes both on every L5/L12 install; **critique assumed** keep interval I-02 / S2 / I-08.
2. **Editor (A6):** CanvasEditor write-back race guard (shipped).
3. **Docs:** install headroom note (B).

### Shipped (after live failure)

Escalate to **A-pool hybrid**: pool-exit **or** `tLog > logHi`; `userHit` = unit-in-pool; do not clear solely for `tLog < logLo`; **keep** B⁺ + A6; reject C. See `STICKY-USER-PREFS-LIVE-FAILURE.md`.

### Do not ship

- **C** (lock violation / sticky re-entry).
- Interval-only I-02 as the live lifetime oracle.

---

## 6. Hard acceptance tests (implementer must pass)

Engine-first; editor tests where noted. Fail the PR if any red.

| Id | Must pass | Notes |
|----|-----------|-------|
| **A1** | L5 pick → `computeScale` at **identical** zoom keeps `userBand` + picked unit (`reason` user-band or equivalent) | Include a fixture where `bestInBoundsNice(...).barPx > BAR_PX_TARGET` (pick above `targetLogLen`) |
| **A2** | After L5 pick, ±1e-6 and ~0.1%–1% effectiveZoom both directions keep band + unit | Within install bar-window headroom |
| **A3** | dm → Qpc → `userBand === null`; zoom-back → `cm`/`mm`, **not** dm | S2 / T-F2-01 / ZS-01 spirit — **non-negotiable** |
| **A4** | L6 preferred pick → `userBand === null`, ladder switch only | |
| **A5** | L7 in-range other-unit pick clears prior band then normal install | |
| **A6** | Simulate: banded session `s` + stale unbanded `next` from pre-pick `hudBundle` → write-back **must not wipe** band | Editor unit or pure merge-helper test |
| **A7** | L10 related probes still ignore live `userBand` | |
| **A8** | `am` from coarse pico + 1e-6 zoom-out still holds | Regression for former `logBarMax`-only path |
| **A9** | I-08: install still does **not** union §5 `band.lo` | Bar-window ≠ preferred-band lo |
| **A10** | L12: while inside active range, `mi` suppresses `ft`/`yd` | |

**Explicitly rejected as acceptance for this fix:** C-REACTIVATE (sticky re-entry after Qpc).

---

## 7. Guidance the debate / implementer must not ignore

1. **P0 is install knife-edge / pick-above-target**, not missing write-back. Write-back amplifies clears.
2. **A1 same-zoom survival is mandatory** — ε zoom-only tests are insufficient.
3. **S2 stands.** Suspend/reactivate is a product reopen, not a stealth fix.
4. **No pins / no `pinMode` / no silent stickyUntilCleared.**
5. **I-08:** bar-window headroom ≠ reintroducing `band.lo` union.
6. **Dual quantities:** I-02 uses `targetLogLen`; `userHit` uses `stop.logLen`. Extent fixes must keep both coherent; exit-policy fixes must update both.
7. **A6 is part of the hybrid**, even though B scoped it out.
8. **Do not “fix” L6** by forcing bands onto preferred picks.
9. **Do not disable `clearUserBandIfExited`** without replacing it with a teardown that still passes A3.
10. **Live check after green CI:** pick `dm`/`mi` → first frame + one wheel notch each way → hold; big zoom away → auto; zoom back → stay auto.

---

## 8. One-line scorecard for the parent thread

**Winner:** Proposal **B** (extent) + **A6 write-back merge**. **Reject C** (S2/re-entry). **Park A** as optional v2 full-bar lifetime if B’s headroom is not sticky enough.
