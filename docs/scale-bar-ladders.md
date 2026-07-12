# Scale Bar Ladders (unified — approval required)

**Status:** draft for review. Ladder tables and HUD slot rules must be approved before engine/UI implementation changes land.

**Related:** [scale-bar-v1-spec.md](./scale-bar-v1-spec.md) · `boundless/src/engine/scaleBar.js`

**SI source of truth:** official SI 2022 prefix table (name → short → exponent). Unit notation = prefix letter + `m` on the meter (e.g. quecto-meter `qm`, ronna-meter `Rm` — capital **R**, not ronto `r`).

---

## Canonical constants (user-defined)

Store as documented literals; derive ladder `ratioFromPrev` from these, not chained float accumulation in meters.

| Unit | Symbol | Definition | In meters (for reference) |
|------|--------|------------|---------------------------|
| Planck length | `ℓP` | **1.616255×10⁻³⁵ m** | `1.616255e-35` |
| Light year | `ly` | **9 460 730 472 580.8 km** | `9.4607304725808×10¹⁵` |
| Parsec | `pc` | **(96 939 420 213 600 / π) km** | `≈ 3.085677581491×10¹⁶` |

**Derived ratios (from canonical values):**

| Hop | `ratioFromPrev` | Notes |
|-----|-----------------|-------|
| `ℓP` → `qm` | **≈ 61 871** | `10⁻³⁰ m / 1.616255×10⁻³⁵ m` — matches Planck sub-ladder `qm` row (61.87×10³) when `klₚ`…`qm` band is used |
| `ly` → `pc` | **≈ 3.2616** | `pc_km / ly_km` |

Other astro/body anchors (AU, `ld`, R☉, R⊕, LD) — pending your definitions; use spreadsheet ratios once sizes are confirmed.

---

## Design principle

| Concern | Model |
|---------|--------|
| **Auto-zoom** | **One continuous engine ladder per stack.** `ladderFor` / `computeScale` walk the full ordered rung list. Zoom-out promotes through every rung — no separate “lean” vs “extended” auto path. |
| **Within-rung steps** | Before promoting to the next rung, exhaust **nice numbers** on the current rung: **1 → 2 → 5 → 10 → 20 → 50 → 100** (then repeat ×10 decades where applicable). |
| **Float safety** | Rung comparisons use **rung-to-rung ratios** (`ratioFromPrev`), not repeated accumulation in absolute meters. Prefix multipliers stored as **exponent integers**; see [§ Prefix exponent storage](#prefix-exponent-storage). |
| **Set scale unit picker** | **UI-only selection tiers.** Tier A shows everyday units; **More units…** reveals truncated chunks of the same registry. Picker layout ≠ engine walk boundary. |
| **HUD popover** | **Three contextual abbreviations only.** Neighbors on the current display ladder + one cross-stack peer. No Auto, no Other, no nesting. |

---

## SI 2022 prefix reference (coarse → fine)

Official table order **Q down to q**. Engine ladder walks **fine → coarse** (reverse), with **ℓP below q**.

| Prefix | Short | Exponent | Meter unit |
|--------|-------|----------|------------|
| quetta | Q | +30 | `Qm` |
| ronna | R | +27 | `Rm` |
| yotta | Y | +24 | `Ym` |
| zetta | Z | +21 | `Zm` |
| exa | E | +18 | `Em` |
| peta | P | +15 | `Pm` |
| tera | T | +12 | `Tm` |
| giga | G | +9 | `Gm` |
| mega | M | +6 | `Mm` |
| kilo | k | +3 | `km` |
| hecto | h | +2 | `hm` |
| deca | da | +1 | `dam` |
| *(base)* | — | 0 | `m` |
| deci | d | −1 | `dm` |
| centi | c | −2 | `cm` |
| milli | m | −3 | `mm` |
| micro | μ | −6 | `µm` |
| nano | n | −9 | `nm` |
| pico | p | −12 | `pm` |
| femto | f | −15 | `fm` |
| atto | a | −18 | `am` |
| zepto | z | −21 | `zm` |
| yocto | y | −24 | `ym` |
| ronto | r | −27 | `rm` |
| quecto | q | −30 | `qm` |

**Notation rule:** prefix letter + `m` — e.g. ronto-meter = `rm` (lowercase **r**); ronna-meter = `Rm` (uppercase **R**). Never use `rm` for ronna.

**Below quecto:** Planck length `ℓP` is the finest engine rung (not an SI prefix).

---

## Prefix exponent storage

At Planck-to-quettameter extremes, do **not** chain `value × 10^exp` through absolute meters for promotion/demotion.

| Field | Meaning |
|-------|---------|
| `name` | Display abbreviation (`km`, `AU`, `ℓP`, …) |
| `prefixExp` | Integer SI exponent for meter-prefix rungs (`k` → `+3`, `q` → `−30`, `Q` → `+30`). Omitted for non-SI rungs (`ℓP`, astro). |
| `ratioFromPrev` | Multiply the previous rung’s canonical length by this factor to reach this rung **in the previous rung’s unit space**, then switch display to `name` |

**Rules:**

1. **Promotion / demotion** compares bar length using `ratioFromPrev` along the ladder — one hop at a time at extremes.
2. **Anchor storage** (`scaleDef`) still records `{ value, unit }` in the user’s chosen unit; conversion to the walk uses one-hop ratios from the anchor rung outward.
3. **SI decade hops** (`q`…`k` and `M`…`Y` between adjacent 10³ prefixes): `ratioFromPrev = 1000`. **Ym → Rm → Qm** each use `1000`. **Qm → AU** uses the astro constant ratio (not 10⁶ within the SI band — the 10⁶ step is **Ym → Qm** skipping no prefixes; all prefixes Q…M are explicit rungs).
4. **deci / centi / deca / hecto** hops (`cm`, `dm`, `dam`, `hm`): `ratioFromPrev = 10`.
5. **Planck floor:** `ℓP` = **1.616255×10⁻³⁵ m**; `ratioFromPrev` for `qm` relative to `ℓP` is **≈ 61 871** (documented constant, not derived at runtime from meter accumulation).

---

## Section 1 — Engine ladders (auto-zoom)

These are the **only** rung orderings `ladderFor`, `computeScale`, and `promoteMinUnitRank` use.

**Within-rung nice numbers (all stacks):** `1, 2, 5, 10, 20, 50, 100` — exhaust before promoting to the next coarser rung.

**Beyond the final named rung (`Qpc`):** scientific notation on the `Qpc` unit (e.g. `2×10³ Qpc`) until `formatScaleNumber` takes over.

---

<details>
<summary><strong>Metric — Planck floor + quecto through milli</strong> (ranks 0–10)</summary>

Finest → coarser. `ℓP` below quecto; every SI sub-prefix through milli is an explicit engine rung.

| Rank | Unit | Prefix | Short | `prefixExp` | Zone | `ratioFromPrev` |
|------|------|--------|-------|-------------|------|-----------------|
| 0 | `ℓP` | Planck | — | — | Planck floor | — (floor) |
| 1 | `qm` | quecto | q | −30 | quecto | ≈ 61 871 |
| 2 | `rm` | ronto | r | −27 | ronto | 1000 |
| 3 | `ym` | yocto | y | −24 | yocto | 1000 |
| 4 | `zm` | zepto | z | −21 | zepto | 1000 |
| 5 | `am` | atto | a | −18 | atto | 1000 |
| 6 | `fm` | femto | f | −15 | femto | 1000 |
| 7 | `pm` | pico | p | −12 | pico | 1000 |
| 8 | `nm` | nano | n | −9 | nano | 1000 |
| 9 | `µm` | micro | μ | −6 | micro | 1000 |
| 10 | `mm` | milli | m | −3 | milli | 1000 |

**Within-rung example (`mm`):** `1 mm → 2 → 5 → 10 → 20 → 50 → 100 mm` → promote to `cm`.

</details>

<details>
<summary><strong>Metric — centi through kilo</strong> (ranks 11–16)</summary>

Includes **c / d / da / h** prefixes explicitly on the meter (SI order fine → coarse).

| Rank | Unit | Prefix | Short | `prefixExp` | Zone | `ratioFromPrev` |
|------|------|--------|-------|-------------|------|-----------------|
| 11 | `cm` | centi | c | −2 | centi | 10 |
| 12 | `dm` | deci | d | −1 | deci | 10 |
| 13 | `m` | (base) | — | 0 | base | 10 |
| 14 | `dam` | deca | da | +1 | deca | 10 |
| 15 | `hm` | hecto | h | +2 | hecto | 10 |
| 16 | `km` | kilo | k | +3 | kilo | 10 |

**Within-rung example (`m`):** `1 m → 2 → 5 → 10 → 20 → 50 → 100 m` → promote to `dam`.

**Within-rung example (`km`):** `1 km → 2 → 5 → 10 → 20 → 50 → 100 km` → promote to `Mm`.

</details>

<details>
<summary><strong>Metric — mega through quetta (km → AU bridge)</strong> (ranks 17–25)</summary>

Fills the **km → AU gap**. Auto-walk promotes through **every** coarse SI prefix rung (including **ronna `Rm`**) with the same within-rung nice-number pattern before the astro band.

| Rank | Unit | Prefix | Short | `prefixExp` | Zone | `ratioFromPrev` |
|------|------|--------|-------|-------------|------|-----------------|
| 17 | `Mm` | mega | M | +6 | mega | 1000 |
| 18 | `Gm` | giga | G | +9 | giga | 1000 |
| 19 | `Tm` | tera | T | +12 | tera | 1000 |
| 20 | `Pm` | peta | P | +15 | peta | 1000 |
| 21 | `Em` | exa | E | +18 | exa | 1000 |
| 22 | `Zm` | zetta | Z | +21 | zetta | 1000 |
| 23 | `Ym` | yotta | Y | +24 | yotta | 1000 |
| 24 | `Rm` | ronna | R | +27 | ronna | 1000 |
| 25 | `Qm` | quetta | Q | +30 | quetta | 1000 |

**km → AU promotion walk (zoom-out):**

```
100 km  →  Mm band (1 Mm … 100 Mm)
        →  Gm → Tm → Pm → Em → Zm → Ym → Rm → Qm bands (same 1/2/5/10/20/50/100 pattern each)
        →  AU
```

Each arrow is “exhaust nice numbers on current rung, then promote one rank.”

</details>

<details>
<summary><strong>Metric — astro tail</strong> (ranks 26–32)</summary>

| Rank | Unit | Zone | `ratioFromPrev` |
|------|------|------|-----------------|
| 26 | `AU` | astro | astro constant |
| 27 | `ly` | astro | `ly_km / AU_km` *(AU TBD)* |
| 28 | `pc` | astro | **≈ 3.2616 ly** (`pc = (96939420213600/π) km`, `ly = 9460730472580.8 km`) |
| 29 | `kpc` | astro | 1000 |
| 30 | `Mpc` | astro | 1000 |
| 31 | `Gpc` | astro | 1000 |
| 32 | `Qpc` | astro tail | 10 (v1 cap) |

**Within-rung example (`AU`):** `1 AU → 2 → 5 → 10 → 20 → 50 → 100 AU` → promote to `ly`.

**Within-rung example (`Qpc`):** `1 Qpc → 2 → 5 → 10 → 20 → 50 → 100 Qpc` → **scientific notation on `Qpc`**.

**Full metric engine chain (fine → coarse):**

```
ℓP → qm → rm → ym → zm → am → fm → pm → nm → µm → mm
   → cm → dm → m → dam → hm → km
   → Mm → Gm → Tm → Pm → Em → Zm → Ym → Rm → Qm
   → AU → ly → pc → kpc → Mpc → Gpc → Qpc → sci (on Qpc)
```

</details>

<details>
<summary><strong>Imperial — everyday band</strong> (ranks 0–4)</summary>

| Rank | Unit | Zone | `ratioFromPrev` |
|------|------|------|-----------------|
| 0 | `mil` | sub-base | — (floor) |
| 1 | `in` | everyday | 1000 |
| 2 | `ft` | everyday | 12 |
| 3 | `yd` | everyday | 3 |
| 4 | `mi` | everyday | 1760 |

**Within-rung examples:**

- `in`: `5 in → 10 → 20 → 50 → 100 in` → promote to `ft`
- `ft`: `1 ft → 2 → 5 → 10 → 20 → 50 → 100 ft` → promote to `yd`
- `yd`: `5 yd → 10 → 20 → 50 → 100 yd` → promote to `mi` (supports **5 in → … → 100 yd**)
- `mi`: `1 mi → 2 → 5 → 10 → 20 → 50 → 100 mi` → promote to `AU`

</details>

<details>
<summary><strong>Imperial — astro tail</strong> (ranks 5–11)</summary>

| Rank | Unit | Zone | `ratioFromPrev` |
|------|------|------|-----------------|
| 5 | `AU` | astro | astro constant |
| 6 | `ly` | astro | `ly_km / AU_km` *(AU TBD)* |
| 7 | `pc` | astro | **≈ 3.2616 ly** |
| 8 | `kpc` | astro | 1000 |
| 9 | `Mpc` | astro | 1000 |
| 10 | `Gpc` | astro | 1000 |
| 11 | `Qpc` | astro tail | 10 |

**Within-rung example (`Qpc`):** `1 Qpc → 2 → 5 → … → 100 Qpc` → sci notation on `Qpc`.

**Full imperial engine chain:**

```
mil → in → ft → yd → mi → AU → ly → pc → kpc → Mpc → Gpc → Qpc → sci (on Qpc)
```

</details>

### Auto-walk behavior

1. **Anchor** `scaleDef.unit` sets the ladder and starting rank.
2. **Zoom-in** descends to finer rungs; exhausts within-rung nice numbers before demoting rank.
3. **Zoom-out** promotes to coarser rungs through the **full** ladder; exhausts within-rung nice numbers before each promotion.
4. **`minUnit` promotion** is one-way until `minUnitZoomAt` hysteresis allows demotion.
5. **`unitMeters()`** must resolve **every** engine rung name for validation and anchor storage.

---

## Section 2 — Selection tiers (Set scale UI only)

Selection tiers control **which abbreviations appear in the Set scale dialog**. They do **not** define a second engine ladder or truncate auto-walk.

<details>
<summary><strong>Tier A — default dialog</strong></summary>

Single row, always visible after drag:

```
mm   cm   m   km   |   in   ft   yd   mi
```

Metric block first, then imperial. Visual separator optional. Everyday units only · UI selection tier.

</details>

<details>
<summary><strong>More units — progressive disclosure layers</strong></summary>

Each **More units…** tap appends **one truncated chunk** of the registry. Another **More units…** at the bottom opens the next layer. Closing the dialog resets depth.

| Layer | Units shown | Notes |
|-------|-------------|-------|
| **0 — Tier A** | `mm`, `cm`, `m`, `km`, `in`, `ft`, `yd`, `mi` | Everyday only |
| **1 — first More** | `µm`, `nm`, `pm`, `mil` | Sub-base chunk · truncated |
| **2 — second More** | `fm`, `am`, `zm`, `ℓP`, `qm`, `rm`, `ym` | Planck + quecto band |
| **3 — third More** | `AU`, `ly`, `pc` | Astro chunk |
| **4 — fourth More** | `kpc`, `Mpc`, `Gpc`, `Qpc`, `Mm`, `Gm`, `Tm` | Astro tail + coarse SI · final v1 layers |
| **5+ — further More** | `Pm`, `Em`, `Zm`, `Ym`, `Rm`, `Qm`, `dm`, `dam`, `hm` | Pm/Em/Zm/Ym/Rm/Qm + d/da/h via another More if needed |

**Rules:**

1. Each expansion shows **only that layer’s units** — never the full registry at once.
2. Oversized layers show a **truncated** subset plus **More units…** at the bottom.
3. **More units…** always sits at the **bottom** of the current expanded section.
4. Picking any unit commits to the **same** engine ladder — auto-walk uses Section 1 regardless of which tier surfaced the pick.

</details>

---

## Section 3 — HUD popover (3 slots)

**One popover. Three abbreviations. No Auto. No Other. No nesting.**

At rest the HUD shows bar + label only (e.g. `2 ft`). Tap label → flat popover.

When the HUD label shows unit **U** on display ladder **L**:

| Slot | Rule | Example: HUD `2 ft` |
|------|------|---------------------|
| 1 — smaller | Previous rung on **L** toward finer | `in` |
| 2 — larger | Next rung on **L** toward coarser | `yd` |
| 3 — peer | Cross-stack peer at comparable scale | `m` |

Display order: **smaller, larger, peer**. Slots: smaller neighbor, larger neighbor, cross-stack peer.

<details>
<summary><strong>Cross-stack peer map</strong></summary>

Peer = nearest engine rung on the **other** stack by log-scale distance from **U** (everyday band preferred when tied).

| Current unit (HUD) | Peer |
|--------------------|------|
| `ℓP` … `µm` | `mil` |
| `mm`, `cm` | `in` |
| `m`, `dm`, `dam`, `hm` | `ft` |
| `km`, `Mm` … `Qm` | `mi` |
| `mil` | `mm` |
| `in` | `cm` |
| `ft` | `m` |
| `yd` | `m` |
| `mi` | `km` |
| `AU`, `ly`, `pc`, `kpc`, `Mpc`, `Gpc`, `Qpc` | same unit on other stack |

</details>

<details>
<summary><strong>Ladder-end edge cases</strong></summary>

When a neighbor slot is missing, **backfill along L** until three distinct units are shown.

| Situation | Backfill rule |
|-----------|---------------|
| No smaller neighbor (at finest rung `ℓP` / `mil`) | Slot 1 → next-larger; slot 2 → next-next-larger; slot 3 → peer |
| No larger neighbor (at `Qpc` / sci) | Slot 1 → prev; slot 2 → prev-prev; slot 3 → peer |
| Middle rung (normal) | prev, next, peer |

If backfill cannot produce three distinct units, show fewer rows (minimum: existing neighbors + peer).

</details>

### HUD examples

| HUD label | Popover (3 abbrevs) | Notes |
|-----------|---------------------|-------|
| `2 ft` | `in`, `yd`, `m` | canonical — no Auto, no Other |
| `5 in` | `mil`, `ft`, `cm` | sub-base neighbor |
| `100 m` | `dm`, `km`, `yd` | metric everyday |
| `100 km` | `hm`, `Mm`, `mi` | pre-bridge; next promote → Mm |
| `1 Qpc` | `Gpc`, `2 Qpc`, `Qpc` | sci after 100 Qpc |

Units outside the three contextual slots → **Set scale** dialog (not HUD).

---

## Migration from current `scaleBar.js`

| Today | v1 target |
|-------|-----------|
| `METRIC_LADDER`: pm…pc (10 rungs) | Full ℓP → Qm SI grid (+ c/d/da/h, Rm) + astro through `Qpc` |
| `IMPERIAL_LADDER`: mil…pc (8 rungs) | Add astro `kpc`/`Mpc`/`Gpc`/`Qpc`; keep `yd` |
| `NICE_NUMBERS`: 11 values incl. 25, 250 | Documented within-rung set: 1/2/5/10/20/50/100 |
| All math via `u.m` absolute meters | `prefixExp` integers + rung-to-rung `ratioFromPrev` at extremes |
| `UNIT_OPTIONS`: no `yd` | Tier A includes `yd` |
| No selection-tier UI | Set scale layers per Section 2 |
| No HUD popover | Section 3 rules |

---

## Approval checklist

- [ ] **Metric engine:** `ℓP → full SI (q…Q incl. c/d/da/h, Rm) → Mm…Rm…Qm → AU → … → Qpc → sci on Qpc`
- [ ] **Imperial engine:** `mil → in → ft → yd → mi → AU → ly → pc → kpc → Mpc → Gpc → Qpc → sci on Qpc`
- [ ] **Within-rung nice numbers:** 1/2/5/10/20/50/100 before each promotion
- [ ] **Float safety:** `prefixExp` + rung-to-rung ratios; no all-in-meters chains at extremes
- [ ] **km → AU bridge:** Mm, Gm, Tm, Pm, Em, Zm, Ym, Rm, Qm explicit between km and AU
- [ ] **Auto walk:** single continuous ladder per stack (no lean/extended split)
- [ ] **Tier A row:** `mm cm m km in ft yd mi`
- [ ] **More layers:** truncated progressive disclosure (UI only)
- [ ] **HUD:** 3 slots only, flat popover, no Auto/Other; peer table + edge rules

Comments:

_(space for reviewer notes)_
