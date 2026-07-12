/**
 * HUD label formatting (presentation-side, unit-symbol level).
 * Number grammar lives in nice.js; this only assembles the visible label.
 */

import { formatScaleNumber } from "./nice";

export function formatUnitSymbol(unit) {
    return unit.replace(/ℓP/g, "ℓₚ");
}

/** `reading` is a ScaleReading (or legacy-shaped hud with value/unit/labels). */
export function formatScaleLabel(reading) {
    if (!reading) return "";
    const num =
        reading.displayLabel ?? reading.sciLabel ?? formatScaleNumber(reading.value);
    return `${num} ${formatUnitSymbol(reading.unit)}`;
}
