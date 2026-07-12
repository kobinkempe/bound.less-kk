/**
 * Log-length spine helpers (L11).
 * logLen = log10(worldLength_meters)
 */

import { BAR_PX_TARGET, BAR_PX_MIN, BAR_PX_MAX } from "./constants";
import { unitLog10Meters } from "./catalog";

const LOG10_E = Math.LOG10E;
const LN10 = Math.LN10;

/** Safe log10 — never NaN/Infinity for positive finite inputs; clamps extremes. */
export function log10(x) {
    if (!(x > 0) || !Number.isFinite(x)) {
        if (x === 0) return -Infinity;
        return Number.isFinite(x) ? NaN : (x > 0 ? Infinity : -Infinity);
    }
    // Direct Math.log10 is fine for normal range; clamp result for subnormals.
    const v = Math.log10(x);
    if (Number.isFinite(v)) return v;
    // Fallback via ln for edge cases
    const ln = Math.log(x);
    if (!Number.isFinite(ln)) {
        return x > 1 ? 308.254 : -323.306;
    }
    return ln * LOG10_E;
}

/**
 * Safe 10^x — always finite and > 0. Clamps to JS float envelope.
 * Never throws (L11).
 */
export function safeExp10(logX) {
    if (!Number.isFinite(logX)) {
        if (logX === Infinity) return Number.MAX_VALUE;
        if (logX === -Infinity) return Number.MIN_VALUE;
        return 1;
    }
    // Clamp to roughly ±308 decades
    const clamped = Math.max(-323, Math.min(308, logX));
    const v = Math.pow(10, clamped);
    if (Number.isFinite(v) && v > 0) return v;
    if (clamped >= 0) return Number.MAX_VALUE;
    return Number.MIN_VALUE;
}

/** targetLogLen = log10(BAR_PX_TARGET * mpp) */
export function targetLogLen(mpp) {
    if (!(mpp > 0) || !Number.isFinite(mpp)) return 0;
    return log10(BAR_PX_TARGET) + log10(mpp);
}

/** log10(niceValue * unitMeters) via unit log factor. */
export function logLenFromNice(niceValue, unit) {
    if (!(niceValue > 0) || !Number.isFinite(niceValue)) return NaN;
    return log10(niceValue) + unitLog10Meters(unit);
}

/**
 * mpp from scaleDef at effectiveZoom — log-safe path (L11).
 * mpp = (value * unitMeters / barPx) * (zoomAt / effectiveZoom)
 */
export function mppFromDef(scaleDef, effectiveZoom) {
    if (!scaleDef) return NaN;
    const { value, unit, barPx, zoomAt } = scaleDef;
    if (!(value > 0) || !(barPx > 0) || !(zoomAt > 0) || !(effectiveZoom > 0)) {
        return NaN;
    }
    const logUnit = unitLog10Meters(unit);
    if (!Number.isFinite(logUnit)) return NaN;
    // log(mpp) = log(value) + logUnit - log(barPx) + log(zoomAt) - log(effectiveZoom)
    const logMpp =
        log10(value) + logUnit - log10(barPx) + log10(zoomAt) - log10(effectiveZoom);
    return safeExp10(logMpp);
}

/** barPx for a stop at given mpp: 10^(stop.logLen - log10(mpp)) */
export function barPxFromLogLen(stopLogLen, mpp) {
    if (!(mpp > 0)) return NaN;
    return safeExp10(stopLogLen - log10(mpp));
}

/** Compare logLen against bar bounds in log space. */
export function logBarBounds(mpp) {
    const logMpp = log10(mpp);
    return {
        logMin: log10(BAR_PX_MIN) + logMpp,
        logMax: log10(BAR_PX_MAX) + logMpp,
        logTarget: log10(BAR_PX_TARGET) + logMpp,
    };
}

export { LN10, LOG10_E };
