# Legacy scale-bar removal notes (for Opus)

**Status:** ✅ **CUTOVER COMPLETE** — the ruling engine under `boundless/src/engine/scaleBar/` is now the sole source of truth. Legacy walk / pins / `previousHud` / `minUnit` machinery, the `scaleBarLadders.js` registry, the adapter shims, and the gutted top-level test stubs have all been removed. This note is retained as a historical record.  
**Do not** treat this as a product-constraint doc — see the ruling bible + implementation plan.

## Completed cutover (verification)

- `src/engine/scaleBar.js` is a **one-line façade**: `export * from "./scaleBar/index"`. No legacy signatures, pins, or module-level session.
- `CanvasEditor.js` and `ScaleUnitPicker.js` consume the **session API** directly (`computeScale(zoom, def, session)`, `applyUnitPick`, `clearDisplayPrefs`, `popoverUnits`, `setScaleUnits`, `formatScaleLabel`, `validateScaleDef`). No `pinMode` / `prevHudForCalcRef` / far-pin effects remain.
- `persist.js` and `KobinEngine.js` import `validateScaleDef` from the façade; `useKobinEngine.js` only forwards `scaleDef` (no walk state).
- **Deleted:** `scaleBarLadders.js`, `scaleBar.test.js`, `scaleBar.ladderWalk.test.js`, `scaleBar.astroWalk.test.js`.

## Inventory (post-cutover)

| Path | Role |
|------|------|
| `src/engine/scaleBar/` (`catalog`, `membership`, `preference`, `nice`, `resolve`, `pick`, `rungs`, `session`, `logMath`, `constants`, `format`, `validate`, `index`) | **New engine** — source of truth |
| `src/engine/scaleBar.js` | **Thin façade** — `export * from "./scaleBar/index"`. No legacy surface. |
| ~~`src/engine/scaleBarLadders.js`~~ | **Deleted** — three-stack registry, no importers. |
| `src/engine/scaleBar/*.test.js` | **Authoritative tests** (bible L1–L12 against the new API) |
| ~~`src/engine/scaleBar.test.js`, `scaleBar.ladderWalk.test.js`, `scaleBar.astroWalk.test.js`~~ | **Deleted** — gutted stubs pointing at the new suite. |

## Does Opus need to remove the legacy walk?

**Yes — required for a clean cutover**, but the *walk algorithm* is already gone from `scaleBar.js` (it delegates to `resolveReading`). What remains is **editor + adapter surface** that still speaks pin / `previousHud` / `minUnit`.

### What CanvasEditor still imports (from `../engine/scaleBar`)

- `computeScale`, `formatScaleLabel`, `ladderFor`, `unitRank`
- `validateScaleDef`, `BAR_PX_TARGET`, `MIN_DRAG_PX`, `stackForUnit`
- `getSetScaleUnitOptions`, `classifyUnitPick`, `shouldReleaseFarPin`

Editor state still keeps `pinMode` (`near` / `far`), `prevHudForCalcRef`, `displayFloorUnit`, and far-pin release effects — even though the adapter ignores `previousHud` / `pinMode` for unit choice and maps distant picks to user bands (L12).

`ScaleUnitPicker` still imports `getUnitPickerOptions`, `allUnitsTableRows`, `unitFullName`, `formatUnitSymbol` from the adapter.

`persist.js` / `KobinEngine.js` import `validateScaleDef` from the adapter (keep a thin export or move validation into `scaleBar/`).

## Safe deletion list (after editor migration) — ✅ all done

1. ✅ **`scaleBarLadders.js`** — deleted; zero imports remained.
2. ✅ **Adapter-only dead exports** in `scaleBar.js` — gone (`scaleBar.js` is now a pure re-export; no `FAR_PIN_RELEASE`, `promoteMinUnitRank`, `shouldReleaseFarPin`, pin-shaped `classifyUnitPick`).
3. ✅ **Gutted legacy test stubs** (`scaleBar.test.js`, `*.ladderWalk.test.js`, `*.astroWalk.test.js`) — deleted.
4. ✅ **CanvasEditor pin / `previousHud` / far-pin effects** — replaced with durable `ScaleSession` (`ladderId`, `userBand`, `incumbentUnit`, optional `lastReading`); calls `computeScale` / `applyUnitPick` / `clearDisplayPrefs` from `scaleBar/index.js` directly.
5. **Do not delete** `scaleBar/` modules or the new `*.test.js` suite. (Retained.)

## Recommended Opus sequence — ✅ complete

1. ✅ Migrated `CanvasEditor` + `ScaleUnitPicker` to `scaleBar/index` (`clearDisplayPrefs`, `computeScale(zoom, def, session)`, `applyUnitPick`, `popoverUnits` / `setScaleUnits`).
2. ✅ Dropped pinMode / previousHud / far-pin UI state.
3. ✅ Shrank `scaleBar.js` to a one-line re-export of `scaleBar/index` (persist / KobinEngine import `validateScaleDef` through it).
4. ✅ Deleted `scaleBarLadders.js` + gutted top-level test stubs.
5. ⏳ Keep `scaleBar/*.test.js` green as the gate — **re-run pending** (`npm test -- --watchAll=false src/engine/scaleBar`); could not execute here due to an unavailable shell environment.
