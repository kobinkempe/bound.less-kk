/**
 * Fixtures and assertions for the scale-bar suites.
 *
 * Was `scaleBar/testSupport.js`, sitting among the modules it tests. It moved
 * here on 2026-08-31 so that `src/engine/scaleBar/` contains only shipping code
 * and the boundary is visible from the directory listing rather than from a
 * banner comment inside one file.
 *
 * `__testkit__` is not collected by jest, so nothing here runs on its own.
 * Imports the real module API under `scaleBar/`, not the legacy `scaleBar.js`
 * adapter.
 */

import { BAR_PX_TARGET, BAR_PX_MIN, BAR_PX_MAX } from "../scaleBar/constants";
import { unitMeters, unitLog10Meters } from "../scaleBar/catalog";
import { targetLogLen } from "../scaleBar/logMath";

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
        throw new Error(`testkit/scaleBar: unknown unit ${unit}`);
    }
    return (niceValue * meters) / barPx;
}

/** mpp where both candidate readings fit bar bounds (mid of overlapping mpp intervals). */
export function mppWhereBothFit(a, b) {
    const lo = Math.max(a.worldM / BAR_PX_MAX, b.worldM / BAR_PX_MAX);
    const hi = Math.min(a.worldM / BAR_PX_MIN, b.worldM / BAR_PX_MIN);
    if (!(lo < hi)) {
        throw new Error(
            `testkit/scaleBar: no mpp overlap for ${a.niceValue} ${a.unit} vs ${b.niceValue} ${b.unit}`,
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
