# Scale Bar v1 Spec (locked)

## v1 behavior

- **HUD at rest:** bar + reading only (`2 ft`) — no chevron, no mode badge.
- **HUD popover:** tap label → **one flat popover** with **exactly 3 unit abbreviations** — **no Auto**, **no Other**, **no nested sub-menu**. Slots = neighbor smaller + neighbor larger on the current display ladder + one cross-stack peer. Abbreviations only; dismiss on outside tap / Esc.
  - Example: HUD shows `2 ft` → popover shows `in`, `yd`, `m` (imperial neighbors + metric peer).
  - If a neighbor slot is unavailable (ladder end), show the next-best substitute per [scale-bar-ladders.md](./scale-bar-ladders.md) § HUD slot rules — still 3 choices when possible.
  - Units outside the 3 contextual slots → **Set scale** dialog (not HUD).
- **Set scale — More units:** progressive disclosure inside the dialog only. First screen = Tier A everyday row. **More units…** expands a **truncated** list (not a full dump). If more rungs remain, another **More units…** row at the bottom opens the **next layer** (recursive). Layer taxonomy in [scale-bar-ladders.md](./scale-bar-ladders.md) § Selection tiers — **UI only**; does not alter engine walk.
- **Cross-stack pick:** **display-only** — `scaleDef` anchor unchanged; only display ladder switches. Bar length auto-adjusts; nice numbers within floor.
- **Override (Option C):** popover pick pins display unit; sticky until **next zoom-driven unit change** (coarser or finer), then silent return to algorithm. Exit also via Clear or re-define in Set scale. Override does not write `minUnit`; if promotion ran while pinned, release may land coarser until zoom crosses `minUnitZoomAt`.
- **Auto algorithm:** **one continuous engine ladder per stack** — auto-promotes on zoom through the full rung list with **within-rung nice numbers** (`1, 2, 5, 10, 20, 50, 100`) before each rank promotion. Float-safe: SI meter rungs store **`prefixExp` integers** (official SI 2022 exponents) and **`ratioFromPrev`** for one-hop promotion — not all-in-meters. Beyond `100 Qpc` → sci notation on `Qpc`.
  - **Metric:** `ℓP → qm → rm → ym → zm → am → fm → pm → nm → µm → mm → cm → dm → m → dam → hm → km → Mm → Gm → Tm → Pm → Em → Zm → Ym → Rm → Qm → AU → ly → pc → kpc → Mpc → Gpc → Qpc → sci notation on Qpc`.
  - **Imperial:** `mil → in → ft → yd → mi → AU → ly → pc → kpc → Mpc → Gpc → Qpc → sci notation on Qpc`.
  - **Not** a separate lean vs extended walk. One-way `minUnit` promotion on zoom-out; `minUnitZoomAt` hysteresis. Imperial everyday band: `in → ft → yd → mi` (supports **5 in → … → 100 yd**).
- **Float safety:** at Planck-to-quettameter extremes, rung promotion uses **`prefixExp` integers** (SI 2022) plus **rung-to-rung ratios** (`ratioFromPrev`), not repeated multiplication through absolute meters. Each hop compares bar length relative to the current rung only. See [scale-bar-ladders.md](./scale-bar-ladders.md) § Prefix exponent storage.
- **Set scale:** Tier A — drag on canvas → length + everyday units (`mm cm m km in ft yd mi`). **More units…** → truncated layers per ladders doc. Save commits anchor `scaleDef`; resets display floor.
- **No scale defined:** zoom label (`1.5×`) — no HUD nudge.

## Ladder definitions (approval required)

Full engine ladder tables (collapsible by family), within-rung nice-number rules, HUD slot rules, and Set scale selection-tier breakdown live in **[scale-bar-ladders.md](./scale-bar-ladders.md)**. **Do not implement ladder changes until those tables are approved.**

## Phase A — engine

- [ ] Unified continuous ladders in `scaleBar.js` — metric: ℓP through Qm (+ c/d/da/h, Rm) + astro; imperial: mil through Qpc
- [ ] Within-rung nice numbers: `1, 2, 5, 10, 20, 50, 100` before rank promotion
- [ ] `prefixExp` integers per SI prefix + rung-to-rung `ratioFromPrev`; avoid all-in-meters chains at extremes
- [ ] `computeScale` + `minUnit` / `minUnitZoomAt` / `promoteMinUnitRank` (existing hysteresis)
- [ ] Sci-notation fallback beyond `100 Qpc` via `formatScaleNumber` on the `Qpc` unit
- [ ] Display-ladder state + Option C override release on zoom-driven unit change
- [ ] Display-only cross-stack conversion (anchor meters unchanged)
- [ ] Tests: imperial 5 in→100 yd progression; km→Mm→…→Rm→Qm→AU promotion; astro tail; override sticky/release
- [ ] Persist `scaleDef` in meta; display preference ephemeral

## Phase B — HUD

- [ ] Clickable label + anchor-popover (reuse `useAnchorPopoverStyle`)
- [ ] **3 contextual abbreviations only** — flat popover, **no Auto**, **no Other**, **no nesting**
- [ ] Cross-stack slot switches display ladder only
- [ ] Bar width from `hud.barPx`; label from override or `computeScale`

## Phase C — Set scale dialog

- [ ] Tier A: drag overlay + everyday unit row incl. `yd`
- [ ] **More units…** truncated list per selection tier; bottom **More units…** drills to next layer (recursive progressive disclosure)
- [ ] Save → `scaleDef` + reset display floor; Clear → null `scaleDef`

## Deferred (v2+)

- Preset ratio grid / architectural survey presets
- Explicit Auto control or mode indicator in HUD
- Anchor conversion on cross-stack pick
- OVERRIDE value pinning / frozen bar length
- Grouped unit picker tabs; exotic units on Tier A without progressive disclosure
- HUD scroll/expansion for >3 units (v1 uses Set scale instead)
