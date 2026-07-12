/**
 * Absolute reading resolver on the log-length spine (hardened Option 03).
 *
 * resolveReading(mpp, session, opts) picks the winner at the TARGET mpp only
 * (L1 — no walk traces), on the sticky ladder only (L8 — never re-derives
 * via stackForUnit), with the bible-4 lexicographic preference order:
 *
 *   0. userHit         — any in-pool stop of the active userBand unit (I-02)
 *   1. promoteNextGe1  — `1 <next>` beats finer unit bandHit (I-01 / §5)
 *   2. bandHit         — stop inside its standard preferred band
 *   3. handoffWinner   — explicit overlap winners (L3 / L4 / §5 notes)
 *   4. incumbentHold   — droppable hysteresis incumbent (L2); exit = still in pool
 *   5. preferGe1       — lower displayed number ≥ 1 (constraint 4.3)
 *   6. floorPull       — all-sub-1 pools prefer the finest rung (sci floor)
 *   7. barTarget       — closeness to BAR_PX_TARGET (in log space)
 *   8. unitRank, value — stable ties
 *
 * This ORDER is locked (implementation doc §B.6) and is intentionally not
 * configurable; the data it consumes (bands, handoffs, nice, bar bounds) is.
 *
 * L2 enter (~5% past incumbent band edge): when the incumbent is active and
 * a neighbor would win only via band/prefer tiers, require targetLogLen past
 * the incumbent band edge by HYSTERESIS_ENTER_PAST_EDGE before releasing.
 * Promote and handoff winners (L3/L4 / §5) sit above incumbent and are never
 * blocked by the enter margin.
 */

import {
    BAR_PX_MIN,
    BAR_PX_MAX,
    BAR_PX_TARGET,
    LADDER_IDS,
    HYSTERESIS_ENTER_PAST_EDGE,
} from "./constants";
import { ladderForStack } from "./membership";
import {
    bandFor,
    bandLogInterval,
    extraNiceFor,
    handoffSuppressedUnits,
    promoteSuppressedUnits,
    userBandShouldClear,
} from "./preference";
import { niceValuesForUnit, bestInBoundsNice } from "./nice";
import { log10, safeExp10, targetLogLen } from "./logMath";

const REL_EPS = 1e-9;
const LOG_EPS = 1e-9;

/**
 * True when tLog is ≥ ~5% past the incumbent unit's standard preferred band
 * (L2 enter). Margin is linear on band magnitude → additive in log space.
 */
export function pastIncumbentEnterEdge(ladderId, incumbentUnit, tLog) {
    if (!incumbentUnit || !Number.isFinite(tLog)) return true;
    const { logLo, logHi } = bandLogInterval(ladderId, incumbentUnit);
    if (!Number.isFinite(logLo) || !Number.isFinite(logHi)) return true;
    const marginLog = log10(1 + HYSTERESIS_ENTER_PAST_EDGE);
    return tLog > logHi + marginLog + LOG_EPS || tLog < logLo - marginLog - LOG_EPS;
}

/**
 * All grammar-legal Stops on the ladder whose bar fits [BAR_PX_MIN, BAR_PX_MAX].
 * Everything is computed on the log spine so float extremes never throw (L11).
 */
export function candidatesOnLadder(ladderId, mpp) {
    if (!(mpp > 0) || !Number.isFinite(mpp)) return [];
    const ladder = ladderForStack(ladderId);
    const logMpp = log10(mpp);
    const logBarMin = log10(BAR_PX_MIN);
    const logBarMax = log10(BAR_PX_MAX);
    const stops = [];

    for (let rank = 0; rank < ladder.length; rank++) {
        const rung = ladder[rank];
        const logUnit = rung.log10Meters;
        if (!Number.isFinite(logUnit)) continue;
        // Display-magnitude window whose bar lands inside the bounds.
        const logMagLo = logBarMin + logMpp - logUnit;
        const logMagHi = logBarMax + logMpp - logUnit;
        // Values outside the float envelope cannot be represented — neighbors
        // (or the floor/ceiling unit in sci form) absorb those regions.
        if (logMagHi < -320 || logMagLo > 306) continue;
        const magLo = safeExp10(logMagLo);
        const magHi = safeExp10(logMagHi);
        const values = niceValuesForUnit(rung.name, {
            magLo: magLo * (1 - 1e-7),
            magHi: magHi * (1 + 1e-7),
            extraValues: extraNiceFor(ladderId, rung.name),
        });
        for (const v of values) {
            const logLen = log10(v.value) + logUnit;
            const barPx = safeExp10(logLen - logMpp);
            if (!(barPx > 0) || !Number.isFinite(barPx)) continue;
            if (barPx < BAR_PX_MIN * (1 - REL_EPS) || barPx > BAR_PX_MAX * (1 + REL_EPS)) continue;
            stops.push({
                ladderId,
                unit: rung.name,
                rank,
                niceValue: v.value,
                value: v.value,
                logLen,
                barPx: Math.min(BAR_PX_MAX, Math.max(BAR_PX_MIN, barPx)),
                form: v.form,
                label: v.label,
            });
        }
    }
    return stops;
}

/**
 * Floor/ceiling sci fallback when no in-bounds stop exists (deep extremes).
 * Always returns a bounded bar (clamped) — never throws (L11).
 */
export function extremeCandidates(ladderId, mpp) {
    const ladder = ladderForStack(ladderId);
    if (!ladder.length || !(mpp > 0)) return [];
    const tLog = targetLogLen(mpp);
    const floor = ladder[0];
    const ceiling = ladder[ladder.length - 1];
    const useFloor = tLog < (floor.log10Meters + ceiling.log10Meters) / 2;
    const rung = useFloor ? floor : ceiling;
    const stop = bestInBoundsNice(
        rung.name,
        mpp,
        BAR_PX_MIN,
        BAR_PX_MAX,
        BAR_PX_TARGET,
        extraNiceFor(ladderId, rung.name),
    );
    if (!stop) return [];
    return [{
        ladderId,
        unit: rung.name,
        rank: useFloor ? 0 : ladder.length - 1,
        niceValue: stop.niceValue,
        value: stop.value,
        logLen: stop.logLen,
        barPx: stop.barPx,
        form: stop.form,
        label: stop.label,
    }];
}

function readingFromStop(stop, mpp, reason) {
    const out = {
        value: stop.value,
        niceValue: stop.niceValue,
        unit: stop.unit,
        barPx: stop.barPx,
        ladderId: stop.ladderId,
        metersPerPx: mpp,
        logLen: stop.logLen,
        form: stop.form,
        rank: stop.rank,
        reason,
    };
    if (stop.form === "fraction" && stop.label) out.displayLabel = stop.label;
    if (stop.form === "sci" && stop.label) out.sciLabel = stop.label;
    return out;
}

/**
 * Absolute winner at mpp for this session (see module header for the order).
 *
 * opts:
 *   ladderId        — override the sticky ladder (related-ladder probes, L10)
 *   ignoreUserBand  — discard the user preferred range
 *   ignoreAllPrefs  — discard user + standard bands + handoffs (stay ladder;
 *                     prefer-≥1 + bar target only)
 *   ignoreIncumbent — cold absolute resolve (drop hysteresis)
 *
 * Pure: never mutates the session (callers own incumbent/lastReading writes).
 */
export function resolveReading(mpp, session, opts = {}) {
    if (!(mpp > 0) || !Number.isFinite(mpp)) return null;
    const ladderId =
        opts.ladderId || session?.ladderId || LADDER_IDS.STANDARD_METRIC;

    let pool = candidatesOnLadder(ladderId, mpp);
    if (!pool.length) pool = extremeCandidates(ladderId, mpp);
    if (!pool.length) return null;

    const tLog = targetLogLen(mpp);
    const ignoreAll = !!opts.ignoreAllPrefs;
    // I-02 / Proposal A: pool-exit + coarse far-edge cap. userHit = any
    // in-pool stop of the preferred unit (not gated on install [logLo, logHi]).
    let userBand =
        !ignoreAll && !opts.ignoreUserBand && session?.userBand
            ? session.userBand
            : null;
    if (userBand && userBandShouldClear(userBand, tLog, pool, LOG_EPS)) {
        userBand = null;
    }
    const incumbent =
        !opts.ignoreIncumbent && session?.incumbentUnit
            ? session.incumbentUnit
            : null;

    for (const s of pool) {
        s.userHit = Boolean(userBand && s.unit === userBand.unit);
        if (ignoreAll) {
            s.bandHit = false;
        } else {
            const band = bandFor(ladderId, s.unit);
            s.bandHit =
                s.niceValue >= band.lo * (1 - REL_EPS) &&
                s.niceValue <= band.hi * (1 + REL_EPS);
        }
    }

    const bandHitUnits = new Set(pool.filter((s) => s.bandHit).map((s) => s.unit));
    const onesInPool = new Set(
        pool.filter((s) => Math.abs(s.niceValue - 1) <= REL_EPS).map((s) => s.unit),
    );
    const promoteSuppressed = ignoreAll
        ? new Set()
        : promoteSuppressedUnits(ladderId, onesInPool, bandHitUnits);
    const suppressed = ignoreAll
        ? new Set()
        : handoffSuppressedUnits(ladderId, bandHitUnits);
    // Exit condition (L2): incumbent holds only while it still has any stop
    // inside the full allowed bar range (incumbent still in pool).
    const incumbentActive = Boolean(
        incumbent && pool.some((s) => s.unit === incumbent),
    );
    // Enter condition (L2): neighbors that would win only via band/prefer are
    // blocked until ~5% past the incumbent band edge. Handoff/promote keys sit
    // above incumbent and are unaffected.
    const enterReleased =
        !incumbentActive || pastIncumbentEnterEdge(ladderId, incumbent, tLog);
    const allSubOne = pool.every((s) => s.niceValue < 1);

    /**
     * Band-hit credit for scoring. Raw bandHit still drives handoff/promote
     * sets; enter margin only strips neighbor band credit until released —
     * unless handoff/promote already elevates that neighbor over the incumbent.
     */
    const scoreBandHit = (s) => {
        if (!s.bandHit) return false;
        if (!incumbentActive || enterReleased || s.unit === incumbent) return true;
        if (suppressed.has(incumbent) && !suppressed.has(s.unit)) return true;
        if (promoteSuppressed.has(incumbent) && !promoteSuppressed.has(s.unit)) {
            return true;
        }
        return false;
    };

    const keyFor = (s) => [
        s.userHit ? 0 : 1,
        // I-01 promoteNextGe1: demote finer-unit bandHits when 1<next> fits.
        promoteSuppressed.has(s.unit) ? 1 : 0,
        scoreBandHit(s) ? 0 : 1,
        s.bandHit && suppressed.has(s.unit) ? 1 : 0,
        incumbentActive && !enterReleased
            ? (s.unit === incumbent ? 0 : 1)
            : 0,
        s.niceValue >= 1 ? s.niceValue : Infinity,
        allSubOne ? s.rank : 0,
        Math.abs(s.logLen - tLog),
        s.rank,
        s.value,
    ];

    let best = null;
    let bestKey = null;
    for (const s of pool) {
        const key = keyFor(s);
        if (!bestKey) {
            best = s;
            bestKey = key;
            continue;
        }
        for (let i = 0; i < key.length; i++) {
            if (key[i] < bestKey[i]) {
                best = s;
                bestKey = key;
                break;
            }
            if (key[i] > bestKey[i]) break;
        }
    }

    const reason = best.userHit
        ? "user-band"
        : best.bandHit
            ? "standard-band"
            : best.niceValue >= 1
                ? "prefer-ge1"
                : "bounds-fit";
    return readingFromStop(best, mpp, reason);
}
