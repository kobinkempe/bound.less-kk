/**
 * Persisted scaleDef validation (document meta).
 *
 * The anchor is only { value, unit, barPx, zoomAt }. Legacy `minUnit` /
 * `minUnitZoomAt` fields from older docs are dropped: preferred ranges
 * replaced the minUnit hysteresis lock (bible Q4), so the engine never
 * consults them.
 *
 * A scale set past a double's range (OPEN-FLAGS F167) has `zoomAtLog10` in place of `zoomAt`.
 */

import { unitMeters } from "./catalog";

const normal = (x) => typeof x === "number" && x >= 1e-300 && x <= 1e300;

export function validateScaleDef(raw) {
    if (!raw || typeof raw !== "object") return null;
    const { value, unit, barPx, zoomAt, zoomAtLog10 } = raw;
    if (typeof unit !== "string" || !unitMeters(unit)) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    if (typeof barPx !== "number" || !Number.isFinite(barPx) || barPx <= 0) return null;
    if (typeof zoomAt === "number" && Number.isFinite(zoomAt) && zoomAt > 0) return { value, unit, barPx, zoomAt };
    if (typeof zoomAtLog10 === "number" && Number.isFinite(zoomAtLog10)) return { value, unit, barPx, zoomAtLog10 };
    return null;
}

/** The anchor zoom of a new scale definition: `zoomAt`, or `zoomAtLog10` past a double's range (F167). */
export function scaleAnchorZoom(effectiveZoom, zoomLog10) {
    return normal(effectiveZoom) || !Number.isFinite(zoomLog10) ? { zoomAt: effectiveZoom } : { zoomAtLog10: zoomLog10 };
}
