# HUD user-test scenarios (25)

Manual walkthroughs for the scale-bar ruling design bible / implementation locks. Each paragraph is a phone- or desktop-followable script: start state → action → expected HUD / ladder / preference behavior.

**Authority:** [`scale-bar-ruling-design-bible.md`](../scale-bar-ruling-design-bible.md), [`scale-bar-ruling-implementation.md`](../scale-bar-ruling-implementation.md) §A (L1–L12), A-pool I-02 / S2.

**How to use:** Set a scale first (ruler drag + save). Read the HUD label at rest. Tap the label for the popover; use **More** to deepen rungs. Magnitudes below are approximate — exact nice labels may be `1`, `2`, `5`, fractions, or sci.

---

### 1 — L8 sticky ladder through shared `Qpc`

Start on **standard imperial** with the HUD around everyday land (e.g. `2 ft`–`10 ft`). Zoom out steadily through `yd` / `mi` / `R⊕` / `AU` / `ly` / `pc` until the bar is on **`Qpc`** (or a large sci `Qpc`). Confirm the session stays on **standard imperial** the whole way — auto must not flip to standard metric just because `Qpc` is shared. Zoom back in; you should re-enter imperial land units (`mi` / `yd` / `ft`…) on the **same** sticky ladder, not metric (`km` / `Mm`).

### 2 — L5 / L12 off-ladder user band (`µm` → `in`)

HUD shows something like **`5 µm`–`50 µm`** on **standard metric**. Open the popover and pick **`in`**. Expect switch to **standard imperial** and a **user preferred range** from the quantized nice inch reading at that zoom (roughly **`10⁻⁵`–`10⁻⁴ in`**) through the L12 far edge **`10 in`**. HUD should read inches immediately. Zoom out within that band; inches should keep winning over auto `mil` / `ft` until you pass the far edge or clear the preference.

### 3 — L5 / L12 non-preferred same-ladder pick (`1 in` → `mi`)

`**in**` is showing on **standard imperial** near the preferred inch band (`1/16`–`1`). Switch the HUD unit to **`mi`**. Miles are not auto-preferred at inch range, so the ladder stays **standard imperial** and a user preference installs ≈ **`10⁻⁵ mi`–`2000 mi`** (nice pick ∪ bar headroom → mi far edge). Zoom out; HUD should stay on **miles** (skipping `ft` / `yd`) until you reach body / Earth-radii territory past ~`2000 mi`. Zoom back in; miles should return until you drop finer than the pool can show `mi`, then auto should resume (e.g. inches) **without** reviving the old user band (S2).

### 4 — L6 preferred-on-another-ladder switch only (`5 hm` → `m`)

Start on **true metric** with the HUD around **`5 hm`**. Pick **`m`** from the popover. Meters are the preferred auto unit on **standard metric** (and/or ultra) at that physical length, so this is **L6**: switch to the **highest-priority** ladder that prefers `m` (**standard metric**), and **do not** install a `userBand`. Zoom a notch either way; behavior should follow standard metric auto bands (`m` / promote to `1 km`), not a sticky user override.

### 5 — L7 clear whole range on other-unit pick

With the L12 miles preference from scenario 3 still active (HUD in `mi` while zoomed where auto would prefer `ft`/`yd`), open the popover and pick **`ft`**. Expect **L7**: the entire `mi` user range clears first, then normal pick resolve runs. Feet should show with either a new foot user band (if non-preferred) or plain auto — but the old miles preference must be **gone**. Zoom out again through foot/yard land; you should **not** jump back onto the previous miles override without picking `mi` again.

### 6 — A-pool sticks through many zoom notches (I-02)

On **standard imperial** at ~`1 in`, pick **`yd`** so a user band installs (~nice yards → far edge **`5000 yd`**). Zoom out **many notches** while yards still fit the bar (through hundreds of yards). HUD must keep showing **yards** via A-pool `userHit` even if `targetLogLen` dips below the install `logLo`. The preference must **not** die just because you zoomed slightly finer than the pick interval.

### 7 — A-pool clears past `logHi` / pool miss; no sticky re-entry (S2)

Continue from a yards (or `dm`) user preference. Zoom **out** until either `targetLogLen > logHi` (past the install far-edge cap) **or** the preferred unit has **no** in-bounds bar stop (e.g. drive `dm` all the way to **`Qpc`**). Preference clears. Zoom back in to a magnitude where that unit could display again (~`1 cm` / land yards). Auto must win (`cm`/`mm` or `ft`/`yd` standard bands) — the old `userBand` must **not** reappear without a new pick (**S2**).

### 8 — prefer≥1 / I-01 promote `1 ft` over `10 in`

On **standard imperial**, zoom so both **`10 in`** and **`1 ft`** fit the bar (target length near `1 ft`). Cold or walked resolve should show **`1 ft`**, not `10 in` — promote-to-`1` of the next coarser unit wins even though inches could still draw. Nudge zoom slightly finer until `1 ft` leaves the pool; then expect the preferred inch band (`1/16`–`1`) or mil as appropriate — not a stuck `10 in` preference.

### 9 — Handoff L3: `200 yd` over `500 ft`

Stay on **standard imperial**. Zoom out through feet until you are in the overlap where **`500 ft`** and **`200 yd`** both band-hit. HUD must land on **`200 yd`** (explicit L3 handoff), not stay on `500 ft` via prefer-≥1 coincidence. Zoom a little either side of the cutover; yards should own that band (`200`–`500 yd`) until the next handoff.

### 10 — Handoff: `0.5 mi` over `yd`

From the yards band on **standard imperial**, keep zooming out until **`0.5 mi`** fits. Expect the locked handoff: HUD switches to **`0.5 mi`** (then `1 mi` in the standard `0.5`–`1 mi` preferred band), not `500 yd` stretched forever. Zoom back in; yards should return in their preferred window before feet reclaim land scale.

### 11 — L4 ultra: `0.25 mi` beats feet

Switch to **ultra-standard imperial** (pick a unit that lands you there, or set scale onto an ultra-owned path). Zoom feet through large readings toward thousands of feet. As soon as **`0.25 mi`** fits the bar, HUD must show **miles** (L4), not keep climbing toward `5000 ft`. Ultra has no `yd`; confirm you never see yards on this ladder.

### 12 — Handoff / promote: `µm` → `1 mil`

On **standard imperial**, start in the shared fine head around **tens of µm**. Zoom out until **`1 mil`** fits. Expect flip to **`1 mil`** (promote / mil-over-µm handoff), not holding µm until ~`20 mil`. Zoom back in; µm should reclaim once mil leaves the useful pool — roughly symmetric aside from brief L2 enter margin.

### 13 — Handoff: `1/16 in` over `mil` (`50 mil` ↔ `1/16 in`)

On **standard imperial**, walk mils up through **`20 mil`–`50 mil`**. At the cutover where **`50 mil`** and **`1/16 in`** both fit, HUD must show **`1/16 in`**, not jump to `1/8` while skipping the fraction. Preferred auto inches stay **`1/16`–`1`** (not `1/32` as preferred). Zoom back down through the same physical lengths; expect mils again below the inch handoff.

### 14 — Zoom-out vs zoom-in symmetry (except brief L2)

Pick a clean auto path on **standard metric** from ~`1 cm` out to ~`1 km` and note the unit sequence. Zoom back in along the same magnitudes. Readings at the **same physical target length** should match (same unit + comparable nice), aside from a **brief L2** hysteresis hold (~5% past band edge) when reversing across a handoff. Do not accept permanent one-way skips (F1-style `10 in` → `yd` without `ft`).

### 15 — Popover: empty rung skip + More

Zoom to a sparse related context (e.g. HUD on **`pm`** on a ladder where first-rung predicates add nothing new). Tap the label → first chip set must **not** be an empty no-op; **skip empty leading rungs**. Tap **More** once or twice; each More should deepen membership (new units appear). Current HUD unit must **never** appear in the list. Units order **smallest → largest**.

### 16 — Popover: related ±1 (L10 / 6c)

On **standard imperial** around **`2 ft`**, open the popover. First rung should include the **related-ladder auto-show** peers (L10 — what standard metric / ultra would auto-show at this zoom), not merely nearest-by-size names. Advance to the third rung (**More** as needed): expect current-ladder neighbors **±2** and related-ladder neighbors **±1**. If the current unit is **absent** from a related inventory (e.g. `yd` vs ultra), that related ±1 contribution is empty and skip-empty still applies.

### 17 — Popover: empty More / thin membership

From a zoom where 6a is already rich (> a handful of chips) or where a middle rung would add zero new units, tap **More**. You must never land on a screen that only repeats the previous set with no new units — empty / no-op rungs are skipped. If membership exceeds **12**, the UI flips to the full-name **table** with **more** as the last row when still truncated.

### 18 — Set-scale 7a everyday ultra band

Clear scale if needed, tap the ruler, drag a line, open the set-scale dialog. On the **first** unit rung (**7a**) you should see everyday ultra-standard units between **`mm` and `mi`** (chips / grid), plus **More units…**. Confirm exotic Planck / `Qpc` / full SI prefixes are **not** dumped here yet. Pick e.g. **`m`**, enter a length, save — HUD adopts that scale.

### 19 — Set-scale 7b–7c widen, then 7d all

Still in set-scale (or reopen), tap **More units…** to **7b**: all ultra-standard inventory units appear. Another More → **7c**: units on all ladders from **µm through kpc**, plus non-SI-prefix units on the current ladder (and true-metric SI-prefixed meters if that ladder is current). Final More → **7d**: **all** registered units. Table flip only when **> 22** would display before 7d; full catalog dump is only at 7d.

### 20 — Set-scale L9: `Qpc` → standard metric on save

In set-scale, navigate to a rung that lists **`Qpc`** (7c/7d). Select **`Qpc`**, enter a value, **Save**. Sticky ladder must become **standard metric** (highest priority among owners) — not true metric or imperial — even if you were previously on imperial. `userBand` should be null after commit. Zoom slightly; auto walk should follow **standard metric** tails (`Mm` / `R☉` / `AU`…), proving L8 stickiness from that L9 seed.

### 21 — L1 coalesced zoom = target only

On **standard imperial** near inches, perform a **large single zoom jump** (pinch / wheel flick / trackpad) that lands near **`1 mi`** (or `0.5 mi`) without pausing on intermediate zooms. Final HUD must be the **correct absolute reading at the target mpp** (miles or yards as bands require). It is **not** a failure if you never visually visited `ft` / `yd` mid-gesture — L1 forbids requiring an intermediate trace. Optional animation must not change the settled unit.

### 22 — L6 vs L5 contrast at land scale (`ft` preferred elsewhere)

HUD on **standard metric** around **`1 m`–`5 m`**. Pick **`ft`**. If feet are auto-preferred on **standard imperial** at that length, expect **L6**: switch to standard imperial, **no** user band, HUD shows feet. If the pick is treated as non-preferred at that exact mpp, expect **L5** instead (user band ~nice ft → far edge of `ft` on that ladder). Confirm which path by zooming: L6 follows standard `2`–`500 ft` bands; L5 holds feet past where auto would hand off until I-02 clears.

### 23 — User band teardown via L6 preferred pick

Install an L5 inches user band while auto would prefer mils (pick `in` from a mil-scale HUD). While that band is active, pick a unit that is **preferred on another ladder** at the current zoom (classic **`m`** from true-metric `hm`, or the L6 peer available in the popover). Expect L7-style clear of the inch band if the pick differs, then **L6** switch-only onto the destination ladder with **`userBand: null`**. Zoom afterward should be pure auto on the new sticky ladder.

### 24 — Standard band walk: mil → in → ft → yd → mi

Cold-start or clear prefs on **standard imperial**. Zoom out slowly from ~`1 mil` through land: expect **`mil` (1–50)** → handoff **`1/16 in`…`1 in`** → promote **`1 ft`** → feet **`2`–`500`** → handoff **`200 yd`…`500 yd`** → handoff **`0.5 mi`…`1 mi`**, then bodies. Zoom back in through the same span; sequence should reverse with only brief L2 holds at cutovers — no permanent skip of `ft` or `1/16 in`.

### 25 — A-pool pool-miss at ceiling + L8 (imperial `Qpc` then return)

On **standard imperial**, install a mid-scale user preference (e.g. pick **`dm`-equivalent peer** or stick with **`yd`** / **`mi`** from L5). Zoom all the way out until the preferred unit **vanishes from the bar pool** at ceiling (**`Qpc`**). Preference clears (I-02). Confirm ladder is still **standard imperial** (L8) while showing `Qpc`. Zoom back to land; auto imperial units return — **no** resurrection of the cleared user band (S2). Re-pick the same unit to prove a **new** preference can install again.

---

## Coverage checklist

| # | Primary locks / themes |
|---|------------------------|
| 1 | L8 sticky through `Qpc` |
| 2 | L5/L12 off-ladder `µm`→`in` (~`10⁻⁵`–`10 in`) |
| 3 | L5/L12 `in`→`mi` (~`10⁻⁵`–`2000 mi`) + S2 |
| 4 | L6 switch-only (`hm`→`m`) |
| 5 | L7 whole-range clear |
| 6 | A-pool stick while unit in pool |
| 7 | A-pool clear `logHi` / pool miss; S2 no re-entry |
| 8 | prefer≥1 / I-01 `1 ft` |
| 9 | L3 `200 yd` > `500 ft` |
| 10 | `0.5 mi` > `yd` handoff |
| 11 | L4 ultra `0.25 mi` |
| 12 | `µm`→`1 mil` |
| 13 | `1/16 in` > `mil` |
| 14 | Zoom in/out symmetry + L2 |
| 15 | Popover empty skip + More |
| 16 | L10 related auto-show / ±1 |
| 17 | Empty More / >12 table |
| 18 | Set-scale 7a |
| 19 | Set-scale 7b–7d |
| 20 | L9 `Qpc`→standard metric |
| 21 | L1 coalesced target-only |
| 22 | L6 vs L5 contrast |
| 23 | L7 then L6 teardown path |
| 24 | Full standard imperial handoff chain |
| 25 | A-pool + L8 + S2 at ceiling |
