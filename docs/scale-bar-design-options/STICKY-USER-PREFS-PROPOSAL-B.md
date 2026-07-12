# Sticky User Prefs — Proposal B (band-extent headroom)

**Agent:** Proposal B  
**Status:** **B⁺ install headroom SHIPPED**; I-02 is **not** interval-only anymore — shipped teardown is A-pool hybrid (pool-exit **or** `tLog > logHi`; do not clear solely for `tLog < logLo`). See `STICKY-USER-PREFS-LIVE-FAILURE.md`. Historical sections below assume interval I-02.  
**Coordinator:** `STICKY-USER-PREFS-COORDINATOR.md` (absent at write time; not re-read)  
**Approach (distinct from session write-back):** fix **userBand physical extent at install** so I-02 teardown is not hair-triggered at the pick edge. CanvasEditor already write-backs `computeScale` sessions (ZS-01 / UP3); this proposal does **not** center on that path.

---

## 1. Root cause

User preferred ranges feel non-sticky because the **installed interval is one-sided / knife-edged relative to how I-02 exits**, not because the session fails to persist.

### What already works

| Layer | Behavior |
|-------|----------|
| `applyUnitPick` L5/L12 | Installs `userBand` via `buildUserBand` |
| `resolveReading` | Tier-0 `userHit` while band active |
| `computeScale` | `clearUserBandIfExited` then `withReading` |
| `CanvasEditor` | `useMemo` → `useEffect` write-back of returned session (ZS-01 / UP3) |

Engine unit tests (`userRange.test.js`, ZS-01) pass when the session object is threaded correctly. **Missing write-back is not the remaining gap.**

### Failure mechanism

1. **Install edge ≈ bar target.** L5 quantizes onto `bestInBoundsNice` at `BAR_PX_TARGET`. That stop’s `logLen` becomes one endpoint of `userBand` (`min/max(pick, far)` in `buildUserBand`).
2. **I-02 was strict interval exit (historical).** Pre-hybrid `userBandExited` / `clearUserBandIfExited` cleared on the first `targetLogLen` outside `[logLo, logHi]` (eps only). **Shipped:** clear on pool-missing **or** `tLog > logHi` only. Sticky re-entry after clear is correctly rejected (S2).
3. **Headroom is asymmetric.** `pick.js` already passes `logBarMax = log10(BAR_PX_MAX) + log10(mpp)` so coarse-end picks (e.g. `am` from `5 pm`) survive tiny zoom-out. There is **no** symmetric `logBarMin` / fine-side headroom. Coarser-than-auto picks (e.g. `mi` from `1 in`, `dm` from `cm` when pick sits near the fine end of the usable bar) put `logLo ≈ pickLogLen ≈ targetLogLen`. Any modest zoom-**in**, wheel jitter, or mpp float drift crosses `logLo` → I-02 clears → auto reclaim → HUD snaps off the pick.
4. **Write-back amplifies correct teardowns.** Once the engine returns `userBand: null`, the editor persists it. Hardening write-back cannot restore stickiness when the engine intentionally exits a too-narrow band.

**Verdict:** non-stickiness is an **extent / teardown-threshold** bug at the pick edge, partially papered over for one direction (`logBarMax` only).

```
install:  [==== bar min ── TARGET/pick ── bar max ====]······ far edge
userBand today (fine-end pick):          |pick ────────────── far|
                                         ^ I-02 fires on any zoom-in past pick

needed:   |barMin ── pick ─────────────────────────── max(far, barMax)|
```

---

## 2. Design (one architecture)

### Name

**Symmetric install bar-window union into `userBand`.**

### Policy

**Proposal B (historical):** Keep I-02’s interval predicate (`targetLogLen ∉ [logLo, logHi]` → clear; no sticky re-entry). Change **only** how `[logLo, logHi]` is built at pick time.

**Shipped:** B⁺ install unions below **plus** A-pool I-02 (clear on unit ∉ pool **or** `tLog > logHi`; not solely `tLog < logLo`). Keep L5/L12 far-edge product meaning (`userBandFarEdge`).

```
logBarLo = log10(BAR_PX_MIN) + log10(mpp_at_install)
logBarHi = log10(BAR_PX_MAX) + log10(mpp_at_install)
farLog   = log10(userBandFarEdge(ladderId, unit)) + unitLog

logLo = min(pickLogLen, farLog, logBarLo)
logHi = max(pickLogLen, farLog, logBarHi)
```

Properties:

- **B⁺:** both zoom directions get at least one full allowed bar-width of headroom from the install mpp (same-zoom / knife-edge survival).
- **Shipped fine-side lifetime:** pool-exit — not limited to that one bar window.
- **Long zoom-out** still limited by L12 far edge when far ≫ bar max (`tLog > logHi` cap).
- **I-08 stays intact:** still no union with standard `band.lo`.
- **S2 intact:** at Qpc, unit ∉ pool → clear; zoom-back does not re-install.

### Non-goals (left to other proposals)

- Replacing or redesigning CanvasEditor session write-back / React batching merges.
- Changing resolve ignore flags (`ignoreUserBand` / probes).
- Softening I-02 into L2-style “no stop in pool” exit or enter hysteresis (valid alternate; not this proposal).
- Sticky-until-explicit-clear flags / resurrecting `pinMode`.

### Call-site ownership

| Step | Owner |
|------|--------|
| Compute `logBarLo` / `logBarHi` at install mpp | `applyUnitPick` (already has mpp + bar constants) |
| Union into interval | `buildUserBand(..., { logBarMin, logBarMax })` |
| Exit / persist | unchanged: `clearUserBandIfExited` → `computeScale` → editor write-back |

---

## 3. Files to touch (when implementing)

| File | Change |
|------|--------|
| `src/engine/scaleBar/preference.js` | Extend `buildUserBand` opts: accept `logBarMin` (and keep/clarify `logBarMax`); `logLo/logHi = min/max(pick, far, logBarMin, logBarMax)`. Update comment (drop “coarse-end only” framing). |
| `src/engine/scaleBar/pick.js` | Pass both `logBarMin` and `logBarMax` at install mpp for every L5/L12 install. |
| `src/engine/scaleBar/userRange.test.js` | Headroom cases (below); keep I-08 / L12 / S2 assertions. |
| `docs/scale-bar-ruling-implementation.md` | One lock note under L5/L12 / coarse-end paragraph: install unions full bar window, not only max. |
| `docs/scale-bar-ruling-design-bible.md` | Constraint 5: B⁺ install headroom; I-02 = A-pool hybrid (not interval-only). |

**Do not require** `CanvasEditor.js` changes for this architecture.

---

## 4. Risks

| Risk | Mitigation |
|------|------------|
| Reads as widening past “quantized nice → far edge” literal | Document bar window as **install headroom**, far edge remains the product hi; bible/implementation one-liners. |
| Slightly longer hold near pick before I-02 vs today’s knife edge | Intentional; S2 still clears once target leaves the widened interval (Qpc ≫ dm bar window). |
| I-08 / “no band.lo union” tests confused with bar union | Keep I-08 asserting no §5 `band.lo` expansion; add explicit bar-min assertions separate from that test. |
| Overlap with write-back race (stale `useEffect` returning pre-pick `next`) | Out of scope here; if picks still vanish at **identical zoom**, investigate Proposal A–style writer discipline. This fix addresses snaps after **tiny zoom / float**. |
| Double-counting with future L2-aligned teardown | If a later proposal changes exit to “no unit stop in pool,” bar-window union remains harmless (superset still correct). |

---

## 5. Acceptance tests

Add / extend in `userRange.test.js` (engine-pure; no React):

1. **Fine-side headroom (new):** L5 pick coarser-than-auto (e.g. `mi` @ `1 in` mpp, or `dm` @ `1 cm` mpp). `computeScale` / `resolveReading` after `effectiveZoom *= (1 + 1e-6)` (zoom-in) still shows picked unit and `userBand` non-null.
2. **Coarse-side regression:** Keep existing `am` from `5 pm` + `1e-6` zoom-out stays `am` (now via general min/max, not a special path).
3. **Both edges from builder:** `buildUserBand` with `logBarMin`/`logBarMax` → `logLo ≤ logBarMin`, `logHi ≥ logBarMax` when those sit outside pick↔far alone.
4. **I-08 unchanged:** pick↔far still does **not** expand to standard preferred `band.lo`.
5. **S2 / I-02 unchanged:** `dm` pick → Qpc-scale → `userBand === null` → zoom-back → `cm`/`mm`, not `dm` (ZS-01 companion may stay in `resolve.test.js`).
6. **L12 hold:** while inside range, `mi` userBand still suppresses `ft`/`yd` at land-scale mpp inside the band.

Manual / editor (optional smoke): pick non-preferred unit → nudge wheel both ways one notch → HUD unit holds until a deliberate large zoom leaves the range.

---

## 6. Summary

| | |
|--|--|
| **Root cause** | `userBand` ends at the install pick (`≈ BAR_PX_TARGET`) on the fine side; I-02 clears on first exit; only coarse `logBarMax` headroom exists today. |
| **Fix** | Union **both** install bar log-bounds into `buildUserBand` for every L5/L12 pick. |
| **Not this proposal** | Session write-back, React batching merges, ignore-flag changes, sticky-until-clear pins. |
