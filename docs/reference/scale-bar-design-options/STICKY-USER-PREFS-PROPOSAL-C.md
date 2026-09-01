# Sticky User Prefs — Proposal C (Picker-Driven Persistence)

**Status:** **REJECTED** (violates S2 sticky re-entry). I-02 shipped as **A-pool hybrid** (not interval-only, not C suspend/reactivate) — see `STICKY-USER-PREFS-LIVE-FAILURE.md`. Historical sections below.  
**Agent:** Proposal Agent C  
**Coordinator notes:** `STICKY-USER-PREFS-COORDINATOR.md` was not present at write time  
**Approach (distinct):** **Picker-driven persistence** — preference install/clear is owned only by picker / clear / set-scale paths. Auto zoom may *suspend* an out-of-range preference for the current frame but must not destroy it.  
**Not this proposal:** L2-style exit hysteresis on `userBand` edges, and a silent session `stickyUntilCleared` flag with no picker affordance.

---

## 1. Root cause

User preferred ranges / picks feel non-sticky because **preference lifetime is owned by the auto zoom path**, not by the act of picking.

### 1.1 Auto zoom permanently tears down `userBand` (I-02)

```94:101:boundless/src/engine/scaleBar/index.js
export function computeScale(effectiveZoom, scaleDef, session, opts = {}) {
    const mpp = mppFromDef(scaleDef, effectiveZoom);
    // ...
    const cleared = clearUserBandIfExited(session, mpp);
    const reading = resolveReading(mpp, cleared, opts);
    return { reading, session: withReading(cleared, reading) };
}
```

`clearUserBandIfExited` nulls `userBand` as soon as `targetLogLen` leaves `[logLo, logHi]`. CanvasEditor write-back then persists that null (`ZS-01` / UP3). Zooming back into the old interval cannot recover the preference — by design today (“sticky re-entry rejected”).

`resolveReading` already *locally* ignores an exited band for that frame; the permanent loss is the session mutation in `computeScale`, not the resolver.

### 1.2 Geographic interval ≠ user intent

`buildUserBand` stores a physical log interval from quantized nice → far edge. Leaving that interval is treated as “user no longer wants this unit,” even when the user only zoomed away briefly (or past the far edge by float/zoom noise). L2 already acknowledges that hard boundaries flicker: incumbent release uses ~5% enter / full bar-range exit. **User bands get no such treatment** — and Proposal C does not add it; instead it moves teardown off the zoom path entirely.

### 1.3 L6 preferred picks install nothing to remember

```48:63:boundless/src/engine/scaleBar/pick.js
    if (preferredLadders.length) {
        const dest = highestPriorityLadder(preferredLadders);
        // ...
        const next = {
            ladderId: dest,
            userBand: null,           // ← no preference object
            incumbentUnit: pickedUnit,
            lastReading: reading,
        };
        return { session: next, reading };
    }
```

A pick that is “already preferred” on another ladder only switches `ladderId`. After the next resolve, stickiness is only L2 incumbent hysteresis on standard bands — not a user override. From the picker’s point of view the user *chose* a unit; the engine immediately forgets that choice as a preference.

### 1.4 No picker control surface for “keep” vs “release”

`ScaleUnitPicker` only calls `onPickUnit(unit)`. There is no “prefer auto again” / clear-preference action short of redefining scale (`clearDisplayPrefs`) or hoping I-02 fires. Legacy near/far pins made release explicit or zoom-coupled in the UI; the ruling model replaced pins with `userBand` but left release **implicit on geography**.

### 1.5 What is *not* the root cause

- Sticky **ladder** (L8) works (`Qpc` round-trips keep `ladderId`).
- Editor session write-back works (nulling sticks because I-02 cleared it).
- Coarse-end `logBarMax` headroom already mitigates *instant* teardown at the pick edge (`am` from `pm`); that is a band-construction patch, not preference ownership.

---

## 2. Design — picker-driven persistence

### 2.1 Product reading (revises I-02 / S2)

| Event | Today (I-02) | Proposal C |
|-------|--------------|------------|
| Zoom leaves `[logLo, logHi]` | Permanently clear `userBand` | **Suspend** only: resolve ignores band this frame; session keeps it |
| Zoom returns into interval | Auto cm/mm (S2) — no re-capture | **Reactivate** userHit on the stored band |
| Different unit pick in-range | L7 clear + new install | Unchanged |
| L6 preferred-elsewhere pick | Clear band, switch ladder | Clear band **and** treat as explicit “return toward auto” (unchanged intent) |
| Clear / redefine scale (L9) | Clear | Clear |
| New: explicit “Auto units” in picker | N/A | Clear `userBand` without changing ladder |

**S2 revision:** `dm` pick → zoom to `Qpc` → zoom back toward cm-scale **may** re-show `dm` while the stored interval still contains `targetLogLen`. That is intentional under picker ownership: leaving the range pauses the override; it does not cancel the user’s pick. Cancel requires an explicit picker/clear action (or L6 / L9).

Document this as superseding the I-02 line “sticky re-entry rejected” in the bible / implementation doc when this proposal is adopted.

### 2.2 Session shape (minimal)

Keep existing `userBand` fields (`unit`, `ladderId`, `logLo`, `logHi`). Do **not** add a silent `stickyUntilCleared` boolean (that is Approach B). Stickiness comes from **who is allowed to null the field**.

Optional clarity rename (docs only, or later refactor): treat `userBand` as “picker-installed preference interval,” with active vs suspended decided per frame by `userBandExited`.

### 2.3 Ownership rules

| Writer | May install `userBand` | May clear `userBand` |
|--------|------------------------|----------------------|
| `applyUnitPick` (L5/L12) | Yes | Yes (L7 before reinstall; L6 clears) |
| `clearDisplayPrefs` / set-scale save (L9) | No | Yes |
| New `clearUserPreference(session)` (picker “Auto”) | No | Yes |
| `computeScale` / `clearUserBandIfExited` | No | **No — remove permanent clear** |
| `resolveReading` | No | No (local ignore only, already true) |

### 2.4 Concrete algorithm changes

1. **`computeScale`:** stop calling `clearUserBandIfExited` (or make that helper a no-op / delete). Pass session through; `resolveReading` continues to null `userBand` *locally* when exited so HUD can show `Qpc` etc. while zoomed out.
2. **`withReading`:** still updates `incumbentUnit` / `lastReading` from the winner; does not touch `userBand`.
3. **`applyUnitPick`:** unchanged L5/L7/L12 install. L6 remains “clear user preference + switch ladder” (explicit return toward auto).
4. **`ScaleUnitPicker` + `CanvasEditor`:** add a small **Auto** (or “Clear unit preference”) control that calls `clearUserPreference` / sets `userBand: null` without requiring a unit chip. Hide or disable when `userBand == null`.
5. **L6 gap (optional same PR or follow-up):** when the user picks a unit that is already preferred on the destination ladder, still record a *picker acknowledgment* only if product wants those picks sticky too — default in this proposal: **L6 stays clear-only** (picking preferred = “I want auto on that ladder”). Stickiness problem for L5/L12 non-preferred picks is the P0; L6 is intentional release.

### 2.5 Why this is distinct from A / B

| Approach | Mechanism | Who cancels preference |
|----------|-----------|------------------------|
| **A — L2-matching exit hysteresis** | Widen/delay teardown when `tLog` crosses `logHi`/`logLo` (margin / full bar exit) | Still auto zoom, after a softer exit test |
| **B — Silent sticky flag** | `stickyUntilCleared` survives exit; resolve may re-hit without UI | Clear prefs / new pick; flag is invisible |
| **C — Picker-driven (this)** | Auto never destroys `userBand`; suspend/reactivate by geography; UI owns cancel | Picker Auto, L6, L7, L9 only |

---

## 3. Files to touch (when implementing)

| File | Change |
|------|--------|
| `src/engine/scaleBar/index.js` | Remove `clearUserBandIfExited` from `computeScale` façade |
| `src/engine/scaleBar/session.js` | Deprecate/remove `clearUserBandIfExited` permanent clear; add `clearUserPreference(session)` helper |
| `src/engine/scaleBar/resolve.js` | Keep per-frame `userBandExited` ignore; comment that session teardown is **not** owned here |
| `src/engine/scaleBar/pick.js` | No structural change required for L5/L7; document L6 as explicit clear |
| `src/Components/editor/ScaleUnitPicker.js` | Auto / clear-preference control when `session.userBand` set |
| `src/Pages/CanvasEditor.js` | Wire clear handler; stop relying on write-back of I-02 nulling for preference lifetime |
| `docs/scale-bar-ruling-design-bible.md` | Constraint 5 teardown list: drop auto interval-exit permanent clear; add picker Auto; revise S2 |
| `docs/scale-bar-ruling-implementation.md` | B.7 / I-02 status → picker-owned; façade bullet |
| `docs/scale-bar-test-catalog.md` | Rewrite T-F2-01 / I-02 expectations |
| `src/engine/scaleBar/userRange.test.js` | Invert I-02/S2; add suspend/reactivate + picker clear cases |
| `src/engine/scaleBar/resolve.test.js` | Rewrite ZS-01 for retained `userBand` across Qpc round-trip |

---

## 4. Risks

| Risk | Mitigation |
|------|------------|
| **S2 / I-02 product conflict** — dm re-captures after distant zoom | Explicit bible revision; acceptance tests inverted; call out in release notes |
| **Long-lived overrides surprise** — user forgets they pinned dm | Picker Auto affordance + optional subtle HUD cue later (out of scope for engine) |
| **Very wide L12 bands** (e.g. mi → 2000 mi) stay active across huge zooms | Accept under picker ownership; user clears via Auto / L6 / L9 |
| **Float edge flicker** while *inside* band | Unchanged; still userHit. Coarse `logBarMax` headroom remains useful for install edge |
| **Approach A still needed?** | If suspend/reactivate flickers at the far edge under noisy zoom, layer a small enter margin later — do not mix into this PR’s ownership change |
| **Test debt** | ZS-01, I-02/S2, catalog T-F2-01 currently encode permanent teardown — must update in the same change |

---

## 5. Acceptance tests

### Must pass after implementation

1. **C-SUSPEND — Out-of-range suspend, not destroy**  
   True-metric, pick `dm` at ~1 cm mpp → `userBand.unit === "dm"`. `computeScale` at Qpc-scale zoom: reading is not forced to dm (bar shows coarse unit), but **`session.userBand` remains non-null** with the same unit/interval.

2. **C-REACTIVATE — Sticky re-entry**  
   Continue from (1): zoom back so `targetLogLen ∈ [logLo, logHi]`. Expect `reading.unit === "dm"` (or fractional dm in-bounds) and `reason` user-band / userHit; `userBand` still present.

3. **C-PICKER-CLEAR — Explicit Auto**  
   After (1) or (2), call picker clear / `clearUserPreference`. Expect `userBand === null`. At cm-scale mpp, reading is `cm`/`mm` (auto), not dm.

4. **C-L7 — In-range unit change**  
   Active yd userBand; pick `ft` while still inside yd interval → old band gone; ft userBand installed (existing L7).

5. **C-L6 — Preferred pick clears preference**  
   Active non-preferred band; pick a unit that is auto-preferred on a destination ladder → `userBand === null`, ladder switched (existing L6 / I-15).

6. **C-L9 — Redefine scale clears**  
   `clearDisplayPrefs` / set-scale save → `userBand === null`.

7. **C-L8 — Ladder still sticky**  
   Unrelated: true-metric through shared `Qpc` still keeps `ladderId` (no regression).

8. **C-AM — Coarse install headroom**  
   Existing am-from-pm tiny zoom-out case still holds (band construction unchanged).

### Explicitly retired

- **I-02 / S2 / ZS-01** expectations that `userBand === null` after Qpc exit and that zoom-back must not be dm — replaced by C-SUSPEND + C-REACTIVATE + C-PICKER-CLEAR.

---

## 6. Recommendation

Adopt **picker-driven persistence** if the product goal is “my unit pick means prefer this until I say otherwise,” and geography should only pause the override. Prefer Approach A (exit hysteresis) if the only pain is brief overshoot past `logHi` while still wanting S2 permanent teardown. Prefer Approach B if engine-only sticky-until-clear is enough and no Auto control is desired.

Proposal C is the right fit when the bug report is “picks aren’t sticky” rather than “bands flicker at the edge.”
