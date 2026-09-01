# Scale Bar — Design Decisions (non-ladder)

**Status:** agreed direction for UI and behavior. **Ladder rungs, ratios, and unit catalogs are explicitly out of scope here** — still being designed separately.

**Related:** [scale-bar-v1-spec.md](./scale-bar-v1-spec.md) (full spec, includes ladder placeholders) · UI mockup canvas: `scale-bar-ui-options.canvas.tsx`

---

## Product goal

Keep the scale HUD **quiet and readable**. Unit switching should be possible without permanent extra chrome. Avoid preset grids, mode badges, and nested menus on the canvas.

---

## HUD (bottom-right)

| At rest | On interaction |
|---------|----------------|
| Scale bar + label (e.g. `2 ft`) | Tap label → **one flat popover** |

**Popover rules:**

- **Exactly 3 unit abbreviations** — no fourth slot, no **Auto**, no **Other**, no nested sub-menu.
- Slots: smaller neighbor on current ladder + larger neighbor + one cross-stack peer.
- Example: `2 ft` → `in`, `yd`, `m`.
- Abbreviations only — no section headers or explanatory copy.
- Dismiss on outside tap or Esc.
- Anything beyond those three choices → **Set scale** dialog, not the HUD.

**Also at rest:** **Set scale** (ruler / drag-to-define) and **Clear** when a scale exists. No chevron on the label, no zoom badge next to the bar.

**No scale defined:** show zoom multiplier only (e.g. `1.5×`) — no “set scale” nudge in the HUD.

---

## Set scale dialog

**Default (Tier A):** user drags a line on canvas → dialog with **length** + **unit** from an everyday set. No preset ratio grid on first screen.

**More units…** (progressive disclosure, dialog only):

- Each click reveals a **truncated** chunk of additional units — not the full catalog at once.
- If more units remain, show another **More units…** at the bottom of that layer (recursive).
- Save commits the anchor (`scaleDef`: value, unit, barPx, zoomAt) and resets any display-floor preference.

**Clear** removes scale and returns to zoom label.

---

## Auto display vs manual override

Once scale is defined, the HUD **auto-updates** on zoom: nice numbers and unit rank change so the bar stays a sensible width (~60–180 px).

**Flip-flop fix (engine):** one-way promotion when zooming out; asymmetric unlock when zooming back in past the zoom level where promotion happened (`minUnit` / `minUnitZoomAt`). User does not see a mode toggle for this.

**Manual unit pick (HUD popover):**

- Sets a **display floor** (preference for which unit to show), not a frozen numeric reading.
- **Option C:** sticky until the **next zoom-driven unit change** (finer or coarser), then silently return to full auto.
- Also cleared by **Clear** or re-defining scale via drag.
- Does not write `minUnit` promotion state.

**Cross-stack pick** (e.g. tap `m` while defined in inches):

- **Display-only** — stored anchor stays in the original unit; only what the HUD shows switches ladder.
- Bar length still auto-adjusts; no anchor conversion in v1.

---

## What we cut (simplicity)

- Preset ratio grid (1:100, architectural presets, etc.)
- **Auto** button or OVERRIDE mode badge in HUD
- **Other** slot or nested popovers on HUD
- Always-visible Clear (can stay as today or hover-only — not a hard requirement)
- Metric/imperial tabs or grouped picker upfront
- Exotic / astro units on the default Set scale row (relegated to **More units…** layers)
- Value pinning / frozen bar length (Tier 3 complexity)

---

## Implementation order (no ladder detail)

1. **Engine** — auto display, hysteresis, override release, display-only cross-stack, persist `scaleDef`.
2. **HUD** — clickable label, 3-slot flat popover, anchor positioning (reuse existing popover pattern).
3. **Dialog** — Tier A + recursive **More units…** layers.

Ladder tables and promotion walk are a **separate approval step** before engine ladder code changes.

---

## Deferred to v2+

- Preset ratio grid
- Explicit Auto control in HUD
- Anchor conversion on cross-stack pick
- Frozen bar length / value pinning
- Full grouped unit picker without progressive disclosure
