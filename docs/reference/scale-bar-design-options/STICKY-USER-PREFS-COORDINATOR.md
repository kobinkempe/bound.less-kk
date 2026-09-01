# Sticky User Prefs — Coordinator / Adversarial Review

**Role:** coordination + adversarial review (do **not** implement from this doc)  
**Audience:** Proposal Agents A/B/C, later implementer, later critique pass  
**Code surveyed:** `CanvasEditor.js` (session + write-back), `scaleBar/index.js` (`computeScale`), `session.js` (`clearUserBandIfExited`), `preference.js` (`buildUserBand` / `userBandExited`), `pick.js` (`applyUnitPick`), `resolve.js` (`userHit` vs exit), `nice.js` (`bestInBoundsNice`), `ScaleUnitPicker.js`, `useKobinEngine.js` (zoom flush), bible L5–L12 / I-02 / S2, `userRange.test.js` / ZS-01  
**Status:** historical findings for proposal guidance. **Shipped I-02 = A-pool hybrid** (clear when preferred unit ∉ bar pool **or** `tLog > logHi`; do not clear solely for `tLog < logLo`; `userHit` = any in-pool stop; keep B⁺ + A6) — see `STICKY-USER-PREFS-LIVE-FAILURE.md`. Sections below describe the pre-ship interval-exit world.

---

## 1. Problem statement

### Symptom

After an L5/L12 unit pick that should install a durable `userBand` (e.g. true-metric HUD on `cm` → pick `dm`; imperial on `in` → pick `mi`), the live HUD **does not stay on the picked unit** through ordinary nearby zoom. Preference feels “not sticky”: the bar snaps back to auto preference within the first frame or the first tiny zoom-in / wheel jitter.

### What is *not* the primary gap

CanvasEditor **already** write-backs `computeScale`’s returned session (commented ZS-01 / UP3). Engine unit tests that **thread the returned session by hand** (ZS-01, I-02/S2 in `userRange.test.js`) can pass while the product still feels broken. **Do not propose “add write-back” as the sole fix** — it is already there and can *amplify* premature teardowns.

### Verified failure mechanism (code)

**A. Install edge vs I-02 exit predicate (primary)**

1. `applyUnitPick` (L5) quantizes with `bestInBoundsNice(..., BAR_PX_TARGET)` and builds:
   - `userBand = buildUserBand(dest, unit, niceStop.logLen, { logBarMax })`
   - `buildUserBand`: `logLo/logHi = min/max(pickLogLen, farLog)`, then `logHi = max(logHi, logBarMax)`.
2. I-02 exit (**historical interval reading**): `userBandExited` / `clearUserBandIfExited` was on **`targetLogLen(mpp)`**, not on “unit still has any in-bounds stop”:
   - clear when `tLog < logLo - eps` **or** `tLog > logHi + eps`.
   - **Shipped:** `userBandShouldClear` — clear when preferred unit missing from pool **or** `tLog > logHi`; do **not** clear solely for `tLog < logLo`.
3. For coarser-than-auto picks, `farLog > pickLogLen` ⇒ **`logLo = pickLogLen`**.
4. `pickLogLen` is the discrete nice nearest `BAR_PX_TARGET` in log space — **not guaranteed ≤ `targetLogLen`**. Bar window is `[60, 180]` px vs target `120`. If the winning nice sits on the **coarse** side of target (`barPx > 120`), then:
   - `pickLogLen > targetLogLen`
   - at the **same zoom as the pick**, `tLog < logLo` ⇒ **I-02 already true**
5. Post-pick HUD path (`useMemo` → `computeScale`):
   - `clearUserBandIfExited` drops the band
   - `resolveReading` scores without `userHit`
   - HUD reading reverts to auto
   - write-back **persists** `userBand: null`

So stickiness can die on the **first `computeScale` after pick**, before any intentional zoom-away. Tiny zoom-**in** fails the same way when `logLo ≈ tLog` (knife-edge). Coarse-end float was already papered with `logBarMax` only (`am` / bar-max comment in `pick.js`); **fine-side / target-side headroom is missing**.

```
bar window at install mpp:   [logBarMin -------- tLog/target -------- logBarMax]
typical L5 coarse pick:                 pick=logLo -------------------- far=logHi
                                         ^ if pick > tLog → exited at install
```

**B. Dual quantities (easy to mis-fix)**

| Check | Quantity | File |
|-------|----------|------|
| I-02 teardown (**historical**) | `targetLogLen(mpp)` vs `[logLo, logHi]` | `session.js` / `preference.js` |
| I-02 teardown (**shipped**) | unit missing from pool **or** `tLog > logHi` | `userBandShouldClear` |
| Tier-0 `userHit` (**historical**) | **stop.`logLen`** vs `[logLo, logHi]` + unit match | `resolve.js` |
| Tier-0 `userHit` (**shipped**) | any in-pool stop of `userBand.unit` | `resolve.js` |

A fix that only tweaks `userHit` without fixing install extent / exit will still clear the session. A fix that widens exit without fixing `userHit` bounds can leave a band that never scores.

**C. Stale write-back overwrite (secondary / latent)**

```183:207:boundless/src/Pages/CanvasEditor.js
    useEffect(() => {
        if (!hudBundle?.nextSession) return;
        const next = hudBundle.nextSession;
        setScaleSession((s) => {
            // ... equality on ladder / incumbent / band / lastReading ...
            return next; // closed-over `next`, not merge(s, next)
        });
    }, [hudBundle]);
```

If an effect from a pre-pick `hudBundle` (no band) runs after `applyUnitPick` has set a banded session, the functional updater sees latest `s` (banded) but **returns stale `next` (no band)** because equality fails → **wipe**. Uncommon under React 17’s paint→effect→then-click ordering; more plausible with Strict Mode double-invoke, concurrent features, or any future reordering. Proposals must **not** ignore this: equality must prefer “keep richer userBand on `s`” or write-back must be merge/ref-based, not blind replace with closed-over `next`.

**D. Not HUD “discarding” the session for display**

- Live label uses `hudBundle.reading` from `computeScale(scaleSession)` — band-aware when session still has a live band.
- `ScaleUnitPicker` passes `session={scaleSession}` into rung probes; L10 correctly uses clean / `ignoreUserBand` probes. That is **not** the stickiness bug.
- Pick handler correctly calls `applyUnitPick(unit, hud.metersPerPx, scaleSession)` and `setScaleSession`.

**E. Zoom coalescing**

`useKobinEngine` flushes `effectiveZoom` immediately (no 50 ms coalesce). That is good for rung visitation; it does **not** cause missing intermediate sessions for I-02. It **does** make knife-edge exits more visible (every tiny Δzoom is applied).

### Repro steps (agents must re-run)

**Engine (preferred automated):**

1. Cold true-metric session; `mpp` ≈ `1 cm` bar target.
2. `applyUnitPick("dm", mpp, session)` → assert `userBand?.unit === "dm"`.
3. Immediately `computeScale(sameZoom, scaleDef, withDm)` **without changing zoom**.
4. **Expect (bug today):** often `session.userBand === null` and/or `reading.unit !== "dm"` when `niceStop.logLen > targetLogLen(mpp)`.
5. Variant: keep band by construction, then zoom **in** by ~0.1%–1% effectiveZoom → band clears.

**Live app:**

1. Set scale; get HUD on `cm` (true-metric) or `in` (imperial).
2. Popover-pick non-preferred coarser unit (`dm` / `mi`).
3. Observe HUD: either instant revert, or revert on first wheel notch inward.
4. Control: pick `am` from a coarser pico reading (coarse-end + `logBarMax`) — may hold slightly better on zoom-out; do not treat that as “sticky prefs work.”

**S2 must still pass after any fix:** dm pick → zoom to Qpc → zoom back to ~1 cm → `userBand === null`, unit ∈ `{cm, mm}`, **not** sticky dm re-entry.

---

## 2. Constraints any fix must satisfy

| Lock | Requirement |
|------|-------------|
| **L5** | Off-ladder / non-preferred pick: switch by ownership/priority; install user range from **quantized nice** through **normal far edge** (not raw size; not Planck cold-search). |
| **L6** | Preferred-elsewhere (or preferred on dest): **switch only**, `userBand = null`. Dest = `highestPriority(preferredLadders)` (I-15). |
| **L7** | In-range pick of a different unit: clear whole user range, then normal L5/L6. |
| **L8** | Sticky `ladderId`; auto resolve never `stackForUnit` per frame. |
| **L9** | Clear / redefine / set-scale commit: `clearDisplayPrefs` — ladder from anchor priority; wipe band + incumbent. |
| **L10** | Related-ladder probes: clean session / `ignoreUserBand`; no live overlay leak. |
| **L11** | Log-safe; no throw at extremes. |
| **L12** | **No far-pin / `pinMode`.** Distant picks are user bands only. Far edge may exceed §5 preferred hi (mi ~2000, yd ~5000). |
| **I-02 / S2** | **Shipped:** clear when preferred unit leaves the bar pool **or** `tLog > logHi`. Do **not** clear solely for `tLog < logLo`. **Sticky re-entry after true exit is rejected.** (Historical lock said interval exit on `targetLogLen`.) |
| **I-08** | User band = pick↔far (plus any **bar-window** headroom product agrees to). **Do not** re-union standard `band.lo` for install. |
| **F4 / meta** | Meta / scaleDef writes must not casually wipe sticky ladder mid-session except clear/redefine paths. |
| **Session shape** | Durable fields: `ladderId`, `userBand`, `incumbentUnit`, `lastReading` (display-only). No resurrecting pin state. |

**Product reading to preserve:** stickiness means “stay on the picked unit across nearby zoom **while that unit can still draw a bar** (and before coarse far-edge),” not “survive zoom to Qpc and re-capture on the way back.”

---

## 3. Guidance checklist for proposal agents

### Must measure / report

- [ ] At L5 install: `pickLogLen`, `targetLogLen(mpp)`, `logBarMin/Max`, `farLog`, resulting `[logLo, logHi]`, and `userBandExited` **at the same mpp**.
- [ ] First `computeScale` after pick at **unchanged** zoom (band survival + HUD unit + `reading.reason`).
- [ ] Zoom-in ε and zoom-out ε matrices (e.g. ±1e-6, ±0.1%, ±1%, ±10% effectiveZoom).
- [ ] True exit: leave past far edge / to Qpc; assert clear; zoom-back assert **no** dm/mi re-capture (S2).
- [ ] L6 control: preferred pick installs **no** band and must not regress.
- [ ] Write-back: simulate stale `hudBundle.nextSession` after pick; state whether your design still wipes.
- [ ] `userHit` vs I-02 quantity mismatch: confirm both still coherent after extent changes.
- [ ] Coarse-end regression: existing `am` / `logBarMax` case must not get worse.

### Forbidden approaches

- **Never clear `userBand` / disable I-02** — fails S2 and bible tear-down (d).
- **Sticky re-entry** after true exit (keep band across Qpc and reclaim on zoom-back).
- **Reintroduce `pinMode` / far-pin** as the durable override (L12).
- **Union standard preferred `band.lo` into userBand** (I-08 regression).
- **“Just add write-back”** as the only fix — already present; treats amplification as cause.
- **IgnoreUserBand on the live HUD path** to “simplify.”
- **Per-frame `stackForUnit` / ladder flip** to fake stickiness (L8).
- **Widen far edge past L12 catalog** without an explicit product decision.
- **Softening exit to “incumbent still in pool” without proving S2** — optional alternate, but must still clear on true leave and must not re-enter.

### Acceptance tests proposals must list (implementer later)

| Id | Case |
|----|------|
| **A1** | L5 pick → immediate `computeScale(same zoom)` keeps `userBand` and `user-band` / picked unit on HUD. |
| **A2** | L5 pick → modest zoom-in and zoom-out within bar-window headroom keeps band + unit. |
| **A3** | L5 pick → zoom past far / to Qpc → `userBand === null`; zoom-back ≠ sticky re-entry (S2 / T-F2-01). |
| **A4** | L6 preferred pick → no band; ladder switch only. |
| **A5** | L7 in-range other-unit pick clears prior band then applies normal rules. |
| **A6** | CanvasEditor write-back does not overwrite a fresher banded pick with a stale unbanded session. |
| **A7** | L10 probes still ignore live `userBand`. |
| **A8** | Coarse-end `am` (or equivalent) still survives 1e-6 zoom-out noise. |

### Diversity ask (A / B / C)

Propose **different primary levers** so critique can compare:

| Agent | Suggested distinct lever (not mandatory, but preferred) |
|-------|--------------------------------------------------------|
| **A** | Session ownership / write-back merge / race-safe editor contract |
| **B** | Band extent / install headroom (`logBarMin`∪`logBarMax`) — *already drafted; must still address A1 immediate-exit and A6* |
| **C** | Exit policy / resolve interaction (e.g. exit only when no user-unit stop in pool, or couple exit to bar bounds dynamically) **without** sticky re-entry |

If two proposals collide on the same lever, the third must pick another.

---

## 4. Suspected root causes (ranked)

| Rank | Cause | Severity | Notes |
|------|--------|----------|-------|
| **1** | **`logLo = pickLogLen` with no fine/target-side headroom; pick often `>` `targetLogLen` ⇒ I-02 true at install** | **P0** | Explains “never sticky” on first HUD frame. Asymmetric `logBarMax`-only fix proves the team already knew edge float is real — only half-fixed. |
| **2** | **Knife-edge I-02 on zoom-in** when `logLo ≈ tLog` even if install barely survives | **P0** | Matches “first wheel notch kills preference.” Write-back then locks the clear. |
| **3** | **Stale `useEffect` write-back returns closed-over `next` and can wipe a newer pick** | **P1** | Latent under React 17; still a contract bug; any extent-only fix leaves this landmine. |
| **4** | **Mis-attribution: “missing write-back”** | **Distractor** | Write-back exists; tests that manually assign `session = computeScale(...).session` hide the install-exit bug if they only assert after large zoom-out (ZS-01). |
| **5** | **L6 / “no band” confusion** | **P2** | Preferred picks correctly install no band; auto `bandHit` may still hold briefly — do not “fix” by forcing bands onto L6. |
| **6** | **Zoom throttle / HUD discard / picker `ignoreUserBand`** | **Unlikely** | Zoom flushes immediately; HUD uses computeScale session; picker probes are intentional. |
| **7** | **I-02 “too aggressive” as product policy** | **Resolved (shipped A-pool)** | Interval exit on `targetLogLen` was the live cliff past B⁺. Shipped: pool-exit + `tLog > logHi`; S2 still holds. |

---

## 5. Holes other agents are likely to miss

1. **Immediate post-pick `computeScale` clear** when `pickLogLen > targetLogLen` — not only “zoom-in jitter.”
2. **Write-back amplifies engine clears** — hardening persistence cannot restore a band the engine already nulled; fixing only React is insufficient, fixing only extent without race-safe merge is incomplete.
3. **`userHit` uses stop.`logLen`; exit uses `targetLogLen`** — fixes must keep both aligned.
4. **Equality in write-back treats “s has band, next doesn’t” as replace** — correct for true I-02, fatal for stale `next`.
5. **ZS-01 / S2 tests zoom far away** — they do not assert stickiness under ε zoom or same-zoom survival; green CI ≠ sticky prefs.
6. **`logBarMax` at install mpp is fixed in the band** — it does not grow as the user zooms; that is OK. Do not confuse with dynamic bar bounds at every frame (that would delay I-02 forever).
7. **Popover session lag** (one frame behind `nextSession`) affects rung membership, not the core HUD unit bug.
8. **`engine.engineReady` / `commitScaleDef` / `clearDisplayPrefs`** legitimately wipe bands — do not “fix” those.

---

## 6. Critique preview (for later)

When proposals land, reject or demand revision if they:

- Claim missing write-back is the root cause without addressing install-exit.
- Disable I-02 or allow sticky re-entry.
- Only add `logBarMin` but never prove **A1** (same-zoom survival) with a case where `bestInBoundsNice.barPx > BAR_PX_TARGET`.
- Change resolve ignore flags on the live path.
- Leave the stale-`next` replace bug unaddressed while touching CanvasEditor.

---

## 7. Deliverable ownership

| Doc | Owner |
|-----|--------|
| This file | Coordinator (adversarial) |
| `STICKY-USER-PREFS-PROPOSAL-{A,B,C}.md` | Proposal agents |
| Implementation | Single implementer after critique |
| Post-impl critique | Coordinator |

**Do not implement until proposals are critiqued against this checklist.**
