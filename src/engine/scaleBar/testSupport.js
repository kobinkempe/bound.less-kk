/**
 * Shared fixtures for ruling scale-bar tests.
 * Imports the real module API under scaleBar/ (not the legacy scaleBar.js adapter).
 */

import { BAR_PX_TARGET, BAR_PX_MIN, BAR_PX_MAX } from "./constants";
import { unitMeters, unitLog10Meters } from "./catalog";
import { targetLogLen } from "./logMath";

export { BAR_PX_TARGET, BAR_PX_MIN, BAR_PX_MAX, unitMeters, unitLog10Meters, targetLogLen };

/** Cold session on a sticky ladder (no user band, no incumbent, no lastReading). */
export function coldSession(ladderId) {
    return {
        ladderId,
        userBand: null,
        incumbentUnit: null,
        lastReading: null,
    };
}

/** Clean probe session for related-ladder auto-show (L10) — no foreign overlay. */
export function cleanProbeSession(ladderId) {
    return coldSession(ladderId);
}

/**
 * mpp such that `niceValue * unit` world length sits at BAR_PX_TARGET.
 * Everyday units use catalog meters; extremes should prefer log helpers.
 */
export function mppForReading(niceValue, unit, barPx = BAR_PX_TARGET) {
    const meters = unitMeters(unit);
    if (meters == null || !(meters > 0)) {
        throw new Error(`testSupport: unknown unit ${unit}`);
    }
    return (niceValue * meters) / barPx;
}

/** mpp where both candidate readings fit bar bounds (mid of overlapping mpp intervals). */
export function mppWhereBothFit(a, b) {
    const lo = Math.max(a.worldM / BAR_PX_MAX, b.worldM / BAR_PX_MAX);
    const hi = Math.min(a.worldM / BAR_PX_MIN, b.worldM / BAR_PX_MIN);
    if (!(lo < hi)) {
        throw new Error(
            `testSupport: no mpp overlap for ${a.niceValue} ${a.unit} vs ${b.niceValue} ${b.unit}`,
        );
    }
    return (lo + hi) / 2;
}

export function worldMeters(niceValue, unit) {
    return niceValue * unitMeters(unit);
}

export function expectBarInBounds(reading) {
    expect(reading).not.toBeNull();
    expect(Number.isFinite(reading.barPx)).toBe(true);
    expect(reading.barPx).toBeGreaterThanOrEqual(BAR_PX_MIN);
    expect(reading.barPx).toBeLessThanOrEqual(BAR_PX_MAX);
}
