# Sticky User Prefs — Live Failure (Adversarial)

**Date:** 2026-07-11  
**Status:** P0 identified and fixed (Proposal A hybrid; B⁺ alone insufficient)  
**Do not rubber-stamp Hybrid B⁺.**

---

## 1. Symptom

After an L5/L12 pick (`dm` from `cm`, `mi` from `in`, `am` from `pm`), the live HUD does **not** stay on the picked unit through ordinary nearby zoom. Preference feels “not sticky at all” despite green A1/A2/A6/A8 engine tests.

---

## 2. What we ruled out (adversarial checklist)

| Hypothesis | Verdict |
|------------|---------|
| Pick UI skips `applyUnitPick` / `buildUserBand` | **False.** `ScaleUnitPicker` → `CanvasEditor.onPickUnit` → `applyUnitPick` with functional `setScaleSession`. |
| `logBarMin` / `logBarMax` unused or wrong log space | **False.** Install uses `log10(BAR_PX_*) + log10(mpp)` (log-length, same as `targetLogLen`). Measured: mi/dm `logLo === logBarMin`. |
| L6 preferred path swallows dm/mi/am | **False.** `preferredLadders` empty for those fixtures; L5 installs `userBand`. |
| Same-zoom I-02 knife-edge (coordinator A1) | **Fixed by B⁺** — first `computeScale` at pick zoom keeps band. |
| A6 write-back race wiping fresher band | **Fixed in editor** (`sourceSession` + fail-closed `shouldApplyScaleSessionWriteBack`). RTL proves legacy blind `return next` wipes; A6 does not. |
| HUD `useMemo` reading before pick, then effect overwrites | Covered by A6 + functional pick updater. |
| `engineReady` / `clearDisplayPrefs` mid-zoom | **Not ordinary path.** Only `[engine.engineReady, canvasId]` (L9). HMR/nav wipe ≠ zoom stickiness. |
| Promote/handoff beating `userHit` | **False** while band active (tier 0). |
| Wrong app surface (`CanvasV2`) | Product path is `/canvas/:id` → `CanvasEditor`. |

Engine-threaded A1/A2/A8 and simulated CanvasEditor write-back all stayed green **while live still felt broken**. That was the tell: the remaining gap was **product zoom distance vs B⁺ interval ceiling**, not “band never installs.”

---

## 3. Root cause (P0)

**Hybrid B⁺ only buys ~one bar window of fine-side headroom.** I-02 still cleared when `targetLogLen` left `[logBarMin_at_install, logHi]`.

| Quantity | Value |
|----------|--------|
| Fine-side zoom-in ceiling | `BAR_PX_TARGET / BAR_PX_MIN` = **2×** |
| KobinEngine wheel law | `factor = 2^(-deltaY / 1000)` (`Camera.js` / `KobinEngine.zoomAt`) |
| Typical mouse notch | `deltaY ≈ 100` → **~1.072×** per notch |
| Notches to clear B⁺ | **~10** |
| Trackpad flick | cumulative `Δy ≈ 1000` → **2× in one gesture** |

So after a correct pick + same-zoom survival, the **first ordinary scroll/trackpad gesture** can cross `logLo`, tear down `userBand`, and write-back persists `null`. Unit tests that only probe ±1% (A2) never hit this ceiling.

```
B⁺ interval:   |logBarMin -------- pick -------- far/logHi|
zoom-in 2×:     ^ tLog exits here → I-02 clear → HUD snaps to auto

Live wheel:    one flick ≈ 2× → “sticky prefs don’t work at all”
```

B⁺ remains necessary for **same-zoom / knife-edge install** (pickLog > tLog). It is **not** sufficient for live stickiness.

---

## 4. Recommended fix (shipped): Proposal A hybrid

Keep B⁺ install headroom + A6 write-back. Change I-02 / `userHit`:

| Layer | Behavior |
|-------|----------|
| **`userHit`** | Any in-pool stop of `userBand.unit` (not gated on install `[logLo, logHi]`) |
| **Clear** | Preferred unit **missing from bar pool**, **or** `tLog > logHi` (coarse / L12 far-edge / S2) |
| **Do not clear** | Solely because `tLog < logLo` (that was the live B⁺ cliff) |

S2 preserved: at Qpc, `dm` ∉ pool (and/or past far edge) → clear → zoom-back does not re-capture.

**Reject for this P0:** Proposal C suspend/reactivate (sticky re-entry; breaks S2).

---

## 5. Code touchpoints

| File | Change |
|------|--------|
| `preference.js` | `userBandShouldClear`, `userBandUnitMissingFromPool`; `userBandExited` kept as interval helper |
| `session.js` | `clearUserBandIfExited` uses pool + far-edge cap |
| `resolve.js` | Same clear oracle; `userHit = unit match in pool` |
| `CanvasEditor.js` | A6 write-back + functional pick (already required) |
| `userRange.test.js` | **`A-pool`**: dm survives past 2× using KobinEngine notch factors |

---

## 6. Test that would have caught the live failure

```text
A-pool: dm sticks past B⁺ bar-min ceiling using KobinEngine wheel notches
```

Repeatedly apply `z *= 2^(100/1000)` past `BAR_PX_TARGET/BAR_PX_MIN` and assert `userBand` + HUD unit remain `dm`. B⁺-only interval I-02 fails this; pool-exit passes. A1/A2 alone are insufficient.

---

## 7. Verification

- `npm test -- --watchAll=false --testPathPattern=scaleBar` → **86/86 pass** (including `A-pool`, A1–A8, S2/A3, RTL A6).
- After refresh: pick `dm`/`mi`, wheel/trackpad zoom through more than 2× — HUD should hold until the unit leaves the drawable bar (or past install far edge on zoom-out).
