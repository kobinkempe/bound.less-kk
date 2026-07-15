/**
 * Absolute reading resolver on the log-length spine.
 *
 * resolveReading(mpp, session, opts) picks the winner at the TARGET mpp only
 * (L1 — no walk traces), on the sticky ladder only (L8), by the owner's unified
 * rule: **the lowest in-range number wins**, where a unit's range is its §5
 * preference band, and the DEFAULT range (for any value outside a preference
 * band) has lower bound 1. Preference-range hits rank above default-eligible
 * stops; that single rule subsumes the old band / prefer-≥1 / handoff tiers:
 *
 *   0. userHit    — the user's range claims the stop (bounded), outranks all
 *   1. bandHit    — value is inside the unit's §5 preference range (Tier A)
 *   2. incumbent  — droppable ~5% hysteresis hold (L2 anti-flicker)
 *   3. lowNumber  — lowest displayed number: raw within Tier A (so 1/16 in beats
 *                   50 mil), else the lowest value ≥ 1 (Tier B; 1 ft beats 10 in)
 *   4. floorPull  — all-sub-1 pools prefer the finest rung (sci floor)
 *   5. barTarget  — closeness to BAR_PX_TARGET (in log space)
 *   6. unitRank, value — stable ties
 *
 * Examples that used to need explicit handoffs and now fall out of the rule:
 * `200 yd` (Tier A, 200) < `500 ft` (Tier A, 500); `0.5 mi` (Tier A) beats
 * `500 yd` (Tier A, 500); `0.25 mi` beats `1320 ft`; `mi` (Tier A) beats an
 * out-of-band `yd` (Tier B). The DATA (ranges, nice, bounds) is config.
 */

import {
    BAR_PX_MIN,
    BAR_PX_MAX,
    BAR_PX_TARGET,
    LADDER_IDS,
    HYSTERESIS_ENTER_PAST_EDGE,
} from "./constants";
import { ladder } from "./ladder";
import { bandLogInterval } from "./preference";
import { toUserRange } from "./preferenceRange";
import { bestInBoundsNice } from "./nice";
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
 * All grammar-legal stops on the ladder whose bar fits [BAR_PX_MIN, BAR_PX_MAX]
 * (now owned by the Ladder; kept as a named export for callers/tests).
 */
export function candidatesOnLadder(ladderId, mpp) {
    return ladder(ladderId).candidatesAt(mpp);
}

/**
 * Floor/ceiling sci fallback when no in-bounds stop exists (deep extremes).
 * Always returns a bounded bar (clamped) — never throws (L11).
 */
export function extremeCandidates(ladderId, mpp) {
    const L = ladder(ladderId);
    const rungs = L.rungs;
    if (!rungs.length || !(mpp > 0)) return [];
    const tLog = targetLogLen(mpp);
    const floor = rungs[0];
    const ceiling = rungs[rungs.length - 1];
    const useFloor = tLog < (floor.log10Meters + ceiling.log10Meters) / 2;
    const rung = useFloor ? floor : ceiling;
    const stop = bestInBoundsNice(
        rung.name,
        mpp,
        BAR_PX_MIN,
        BAR_PX_MAX,
        BAR_PX_TARGET,
        L.extraNiceFor(rung.name),
    );
    if (!stop) return [];
    return [{
        ladderId,
        unit: rung.name,
        rank: useFloor ? 0 : rungs.length - 1,
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
    const L = ladder(ladderId);

    let pool = L.candidatesAt(mpp);
    if (!pool.length) pool = extremeCandidates(ladderId, mpp);
    if (!pool.length) return null;

    const tLog = targetLogLen(mpp);
    const ignoreAll = !!opts.ignoreAllPrefs;

    // User preferred range (constraint 5): forces its unit for any of its stops
    // inside the span; persists (never zoom-cleared).
    let userRange =
        !ignoreAll && !opts.ignoreUserBand && session?.userBand
            ? toUserRange(session.userBand)
            : null;
    if (userRange && userRange.shouldClear(tLog, pool, LOG_EPS)) {
        userRange = null;
    }

    // Collapse the pool to ONE representative stop per unit — the reading that
    // unit would actually show at this zoom (its nice value closest to the bar
    // target). This is what makes "lowest number" compare UNITS, not values of
    // the same unit (so `1 in` at target beats `0.5 in`), and it makes the whole
    // resolve a pure function of mpp — cold and walked agree by construction, so
    // there is no incumbent hysteresis to tune (preference ranges, which are
    // wide, are the anti-flicker mechanism — bible Q4).
    const byUnit = new Map();
    for (const s of pool) {
        s.userHit = Boolean(userRange && userRange.claims(s));
        s.bandHit = ignoreAll ? false : L.preferenceFor(s.unit).claims(s);
        const cur = byUnit.get(s.unit);
        if (!cur) { byUnit.set(s.unit, s); continue; }
        // keep a userHit rep, then the bar-target-closest.
        if (s.userHit && !cur.userHit) { byUnit.set(s.unit, s); continue; }
        if (cur.userHit && !s.userHit) continue;
        if (Math.abs(s.logLen - tLog) < Math.abs(cur.logLen - tLog)) byUnit.set(s.unit, s);
    }
    const reps = [...byUnit.values()];
    const allSubOne = reps.every((s) => s.niceValue < 1);

    // Lowest in-range number: within a unit's §5 preference band (Tier A) the raw
    // value counts (so a sub-1 stop like 1/16 in beats 50 mil); otherwise only
    // values ≥ 1 are eligible (default lower bound 1), so 1 ft beats 10 in and
    // neither loses to a sub-1 default stop.
    const lowNumber = (s) =>
        s.bandHit ? s.niceValue : (s.niceValue >= 1 ? s.niceValue : Infinity);

    const keyFor = (s) => [
        s.userHit ? 0 : 1,   // user range
        s.bandHit ? 0 : 1,   // Tier A: inside the §5 preference band
        lowNumber(s),        // lowest in-range number
        allSubOne ? s.rank : 0,
        Math.abs(s.logLen - tLog),
        s.rank,
        s.value,
    ];

    let best = null;
    let bestKey = null;
    for (const s of reps) {
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
