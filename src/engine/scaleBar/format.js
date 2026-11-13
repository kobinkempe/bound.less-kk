/**
 * HUD label formatting (presentation-side, unit-symbol level).
 * Number grammar lives in nice.js; this only assembles the visible label.
 */

import { formatScaleNumber, formatShiftedValue } from "./nice";

export function formatUnitSymbol(unit) {
    return unit.replace(/ℓP/g, "ℓₚ");
}

/** `reading` is a ScaleReading (or legacy-shaped hud with value/unit/labels); `decades`: see `computeScale`. */
export function formatScaleLabel(reading) {
    if (!reading) return "";
    const num = reading.decades ? formatShiftedValue(reading.value, reading.decades)
        : reading.displayLabel ?? reading.sciLabel ?? formatScaleNumber(reading.value);
    return `${num} ${formatUnitSymbol(reading.unit)}`;
}
