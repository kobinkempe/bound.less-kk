/**
 * Public facade for the ruling scale-bar engine (implementation doc B.2).
 */

import { mppFromDef } from "./logMath";
import { resolveReading } from "./resolve";
import { clearUserBandIfExited, withReading } from "./session";

export {
    BAR_PX_TARGET,
    BAR_PX_MIN,
    BAR_PX_MAX,
    MIN_DRAG_PX,
    PLAIN_MIN,
    PLAIN_MAX,
    NICE_MANTISSAS,
    INCH_FRACTIONS,
    HYSTERESIS_ENTER_PAST_EDGE,
    POPOVER_TABLE_AT,
    SET_SCALE_TABLE_AT,
    LADDER_IDS,
    LADDER_PRIORITY,
    PLANCK_LENGTH_M,
} from "./constants";

export {
    getUnit,
    unitMeters,
    unitLog10Meters,
    allCatalogUnits,
    unitFullName,
    allUnitsTableRows,
    hasSiPrefix,
    isNoSiPrefix,
} from "./catalog";

export {
    LADDERS,
    RELATED_LADDERS,
    ULTRA_STANDARD,
    ladderForStack,
    unitRank,
    laddersOwning,
    stackForUnit,
    highestPriorityLadder,
    floorUnit,
    ceilingUnit,
} from "./membership";

export {
    bandFor,
    bandLogInterval,
    extraNiceFor,
} from "./preference";
export {
    PreferenceRange,
    StandardPreferenceRange,
    UserPreferenceRange,
    RANGE_PRIORITY,
    toUserRange,
} from "./preferenceRange";
export { Ladder, ladder, ALL_LADDERS } from "./ladder";

export {
    log10,
    safeExp10,
    targetLogLen,
    logLenFromNice,
    mppFromDef,
    barPxFromLogLen,
} from "./logMath";

export {
    niceValuesForUnit,
    bestInBoundsNice,
    formatScaleNumber,
    formatSciValue,
} from "./nice";

export { resolveReading, candidatesOnLadder, extremeCandidates, pastIncumbentEnterEdge } from "./resolve";
export { applyUnitPick } from "./pick";
export {
    createSession,
    clearDisplayPrefs,
    clearUserBandIfExited,
    withReading,
    shouldApplyScaleSessionWriteBack,
} from "./session";
export { popoverUnits, setScaleUnits, POPOVER_RUNGS, SET_SCALE_RUNGS } from "./rungs";
export { formatUnitSymbol, formatScaleLabel } from "./format";
export { validateScaleDef } from "./validate";

/**
 * Facade: mpp from the anchor -> absolute resolve on the sticky session.
 * Returns { reading, session } -- tears down userBand when the preferred unit
 * leaves the bar pool or tLog > logHi (I-02 / A-pool hybrid), then updates display-only fields
 * (incumbentUnit / lastReading). Ladder and user-band install are owned by
 * applyUnitPick / clearDisplayPrefs.
 */
export function computeScale(effectiveZoom, scaleDef, session, opts = {}) {
    const mpp = mppFromDef(scaleDef, effectiveZoom);
    if (!(mpp > 0) || !Number.isFinite(mpp)) {
        return { reading: null, session };
    }
    const cleared = clearUserBandIfExited(session, mpp);
    const reading = resolveReading(mpp, cleared, opts);
    return { reading, session: withReading(cleared, reading) };
}
