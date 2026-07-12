/**
 * Persisted scaleDef validation (document meta).
 *
 * The anchor is only { value, unit, barPx, zoomAt }. Legacy `minUnit` /
 * `minUnitZoomAt` fields from older docs are dropped: preferred ranges
 * replaced the minUnit hysteresis lock (bible Q4), so the engine never
 * consults them.
 */

import { unitMeters } from "./catalog";

export function validateScaleDef(raw) {
    if (!raw || typeof raw !== "object") return null;
    const { value, unit, barPx, zoomAt } = raw;
    if (typeof unit !== "string" || !unitMeters(unit)) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    if (typeof barPx !== "number" || !Number.isFinite(barPx) || barPx <= 0) return null;
    if (typeof zoomAt !== "number" || !Number.isFinite(zoomAt) || zoomAt <= 0) return null;
    return { value, unit, barPx, zoomAt };
}
