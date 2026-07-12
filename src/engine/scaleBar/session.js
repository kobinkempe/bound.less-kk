/**
 * ScaleSession helpers (08 contracts).
 *
 * ScaleSession = {
 *   ladderId,            // sticky (L8); never re-derived per frame
 *   userBand | null,     // physical/log interval (L5/L12)
 *   incumbentUnit | null,// hysteresis only; droppable (L2)
 *   lastReading | null,  // DISPLAY-ONLY (never consulted for unit choice)
 * }
 */

import { LADDER_IDS } from "./constants";
import { stackForUnit } from "./membership";
import { userBandShouldClear } from "./preference";
import { targetLogLen } from "./logMath";
import { candidatesOnLadder, extremeCandidates } from "./resolve";

export function createSession(ladderId) {
    return {
        ladderId: ladderId || LADDER_IDS.STANDARD_METRIC,
        userBand: null,
        incumbentUnit: null,
        lastReading: null,
    };
}

/**
 * I-02 / Proposal A: clear userBand when the preferred unit has no in-bounds
 * bar stop (pool-exit) or targetLogLen passes the install far edge (S2 coarse
 * cap). Fine-side tLog < logLo alone does not clear. Sticky re-entry rejected.
 */
export function clearUserBandIfExited(session, mpp) {
    if (!session?.userBand || !(mpp > 0)) return session;
    const ladderId = session.userBand.ladderId || session.ladderId;
    let pool = candidatesOnLadder(ladderId, mpp);
    if (!pool.length) pool = extremeCandidates(ladderId, mpp);
    if (!userBandShouldClear(session.userBand, targetLogLen(mpp), pool)) {
        return session;
    }
    return { ...session, userBand: null };
}

/**
 * Clear / redefine scale (L9): ladder comes from the anchor unit via ladder
 * priority (multi-owner units like Qpc → standard metric); all display
 * preferences reset. Meta writes elsewhere must NOT call this (F4).
 */
export function clearDisplayPrefs(prior, scaleDef = null) {
    const ladderId = scaleDef?.unit
        ? stackForUnit(scaleDef.unit)
        : prior?.ladderId || LADDER_IDS.STANDARD_METRIC;
    return {
        ladderId,
        userBand: null,
        incumbentUnit: null,
        lastReading: null,
    };
}

/** Display-only bookkeeping after an auto resolve (never changes ladder/band). */
export function withReading(session, reading) {
    if (!reading) return session;
    return {
        ...session,
        incumbentUnit: reading.unit,
        lastReading: reading,
    };
}

/**
 * A6 / Hybrid B⁺: race-safe CanvasEditor write-back.
 *
 * Reject a `next` that would wipe a live `userBand` unless that `next` was
 * computed from the current session identity (`sourceSession === s`).
 * Fail closed when `sourceSession` is missing — a stale unbanded closed-over
 * `next` must never replace a fresher pick.
 * True I-02 pool-exit clears still apply: CanvasEditor passes `sourceSession` from the
 * same `useMemo` that produced `next`, so `sourceSession === s` on that path.
 *
 * @param {ScaleSession|null|undefined} s live React state
 * @param {ScaleSession} next computeScale result
 * @param {{ sourceSession?: ScaleSession|null }} [meta]
 * @returns {boolean}
 */
export function shouldApplyScaleSessionWriteBack(s, next, meta = {}) {
    if (!s || !next) return false;
    const { sourceSession } = meta;
    if (s.userBand && !next.userBand) {
        // Only persist a band clear from computeScale on the live session.
        if (sourceSession == null || sourceSession !== s) return false;
    }
    return true;
}
