/**
 * PreferenceRange — a first-class "this unit is preferred over this span" object
 * (bible constraint 4.2 / 5). Two subtypes, distinguished only by PRIORITY and
 * by what counts as a "claim":
 *
 *   StandardPreferenceRange — the §5 preferred band for a (ladder, unit). Claims
 *     a candidate stop when its NICE VALUE sits inside [lo, hi] display
 *     magnitudes (the historical `bandHit`).
 *
 *   UserPreferenceRange — installed when the user picks a non-preferred unit
 *     (constraint 5 / L5 / L12). Outranks every standard range. Claims ANY
 *     in-pool stop of its unit (I-02: userHit is not gated on the install
 *     interval), and owns its own teardown policy (constraint 5d).
 *
 * Everything lives on the log-length spine (logLen = log10(worldMeters)) so the
 * float envelope never throws (L11). Ranges are pure value objects; the resolver
 * asks each candidate "which range claims you, at what priority?".
 */

import { log10 } from "./logMath";
import { unitLog10Meters } from "./catalog";

const REL_EPS = 1e-9;

/** Higher wins. USER outranks STANDARD outranks nothing. */
export const RANGE_PRIORITY = { USER: 2, STANDARD: 1, NONE: 0 };

export class PreferenceRange {
    constructor({ ladderId, unit, logLo, logHi, priority }) {
        this.ladderId = ladderId;
        this.unit = unit;
        this.logLo = logLo; // log10 meters
        this.logHi = logHi;
        this.priority = priority;
    }

    /** Does target log-length fall inside this range? */
    contains(logLen, eps = REL_EPS) {
        return (
            Number.isFinite(this.logLo) &&
            Number.isFinite(this.logHi) &&
            logLen >= this.logLo - eps &&
            logLen <= this.logHi + eps
        );
    }

    /** Does a candidate stop belong to this range? (subtypes refine.) */
    claims(stop) {
        return stop.unit === this.unit && this.contains(stop.logLen);
    }

    get kind() { return "preference"; }
}

/**
 * The §5 standard band for (ladder, unit). `lo`/`hi` are display magnitudes on
 * the unit; the log interval is derived so hysteresis/other log-space checks can
 * use it, but a stop is CLAIMED by its nice value being inside [lo, hi] (bandHit).
 */
export class StandardPreferenceRange extends PreferenceRange {
    constructor({ ladderId, unit, lo, hi }) {
        const logUnit = unitLog10Meters(unit);
        super({
            ladderId,
            unit,
            logLo: Number.isFinite(logUnit) ? log10(lo) + logUnit : NaN,
            logHi: Number.isFinite(logUnit) ? log10(hi) + logUnit : NaN,
            priority: RANGE_PRIORITY.STANDARD,
        });
        this.lo = lo;
        this.hi = hi;
    }

    claims(stop) {
        return (
            stop.unit === this.unit &&
            stop.niceValue >= this.lo * (1 - REL_EPS) &&
            stop.niceValue <= this.hi * (1 + REL_EPS)
        );
    }

    get kind() { return "standard"; }
}

/**
 * A user-installed preferred range (constraint 5). Spans `[min(current,
 * flip-down), max(current, flip-up)]` where the flip points are where the picked
 * unit would NATURALLY hand off under the auto rule (computed from the resolver,
 * not a hardcoded far edge — pick.js builds it). Stored in log space.
 *
 * It outranks standard ranges and forces its unit for any in-pool stop WITHIN
 * its span. Outside the span the auto rule takes over, but the range PERSISTS —
 * it is torn down only by a user action (picking a different unit, switching
 * ladders, or clearing the scale), never by zooming. So zooming out of the span
 * and back in re-shows the unit (sticky re-entry). This is the bible constraint
 * 5 behavior: "persists until the user makes a change."
 */
export class UserPreferenceRange extends PreferenceRange {
    constructor({ ladderId, unit, logLo, logHi }) {
        super({ ladderId, unit, logLo, logHi, priority: RANGE_PRIORITY.USER });
    }

    /**
     * Force this unit for any of its stops inside the span. Bounded (not "any
     * stop of the unit anywhere") so the auto rule resumes outside the span
     * while the range stays installed.
     */
    claims(stop) {
        return stop.unit === this.unit && this.contains(stop.logLen);
    }

    /**
     * Zoom NEVER tears a user range down (constraint 5): it persists until a
     * user action. Kept for API compatibility; always false.
     */
    // eslint-disable-next-line no-unused-vars
    shouldClear() { return false; }

    toJSON() {
        return { unit: this.unit, ladderId: this.ladderId, logLo: this.logLo, logHi: this.logHi };
    }

    get kind() { return "user"; }
}

/** Rehydrate a persisted/plain user-band object into a UserPreferenceRange. */
export function toUserRange(obj) {
    if (!obj) return null;
    if (obj instanceof UserPreferenceRange) return obj;
    return new UserPreferenceRange({
        ladderId: obj.ladderId,
        unit: obj.unit,
        logLo: obj.logLo,
        logHi: obj.logHi,
    });
}
