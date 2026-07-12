/**
 * Preference layer — standard bands, handoff winners, user-range lifecycle (layer 07).
 * All numeric data here is tunable config (constraint 8); the preference ORDER
 * lives in resolve.js and is not editable.
 *
 * Bands are per (ladderId, unit) preferred display magnitudes from bible §5
 * (PROPOSED table) with the L4 update (ultra mi = 0.25–1).
 */

import { LADDER_IDS } from "./constants";
import { unitLog10Meters } from "./catalog";
import { ladderForStack } from "./membership";
import { log10 } from "./logMath";

const { STANDARD_METRIC, STANDARD_IMPERIAL, TRUE_METRIC, ULTRA_STANDARD_METRIC, ULTRA_STANDARD_IMPERIAL } = LADDER_IDS;

/** Default preferred band for any rung not listed below (decade SI pattern). */
const DEFAULT_BAND = [1, 500];

/**
 * Per-ladder overrides of the default band. Bible §5 magnitudes.
 * qℓP floor keeps decimals down to 0.05 before sci (bible §5 floor policy).
 */
const BAND_OVERRIDES = {
    [STANDARD_METRIC]: {
        "qℓP": [0.05, 500],
        mm: [1, 5],
        cm: [1, 5],
        "R☉": [1, 200],
        ld: [5, 200],
        pc: [200, 500],
        Qpc: [1, 5000],
    },
    [TRUE_METRIC]: {
        "qℓP": [0.05, 500],
        mm: [1, 5],
        cm: [1, 5],
        dm: [1, 5],
        m: [1, 5],
        dam: [1, 5],
        hm: [1, 5],
        km: [1, 5],
        Qpc: [1, 5000],
    },
    [STANDARD_IMPERIAL]: {
        "qℓP": [0.05, 500],
        mil: [1, 50],
        // Owner / bible §5: preferred in = 1/16–1 (not 1/32…1 + whole 1…10).
        // 1/32 remains nice grammar (3a) but is not auto-preferred; mil owns that band.
        in: [1 / 16, 1],
        ft: [2, 500],
        yd: [200, 500],
        mi: [0.5, 1],
        "R⊕": [1, 200],
        "R☉": [1, 200],
        ld: [5, 200],
        pc: [200, 500],
        Qpc: [1, 5000],
    },
    [ULTRA_STANDARD_METRIC]: {
        mm: [1, 5],
        cm: [1, 5],
        km: [1, 5000],   // absorbs Mm / R☉ (Q2)
        ly: [1, 5000],   // ultra override (owner)
        pc: [200, 5000], // absorbs kpc…Qpc; ceiling on pc
    },
    [ULTRA_STANDARD_IMPERIAL]: {
        // Absorbs omitted mil; lo matches owner / bible §5 1/16 (1/32 = grammar only).
        in: [1 / 16, 10],
        ft: [2, 5000],    // absorbs yd; through 5000 until 0.25 mi fits (L4)
        mi: [0.25, 1],    // LOCKED L4
        ly: [1, 5000],
        pc: [200, 5000],
    },
};

/**
 * Explicit overlap winners (L3 / L4 / §5 notes). When BOTH units have a
 * band-hit stop in the candidate pool on this ladder, the loser's band hits
 * are demoted. ladderId null = applies to any ladder carrying both units.
 */
export const HANDOFF_WINNERS = [
    // L3: 200 yd beats 500 ft at the ft∩yd overlap.
    { ladderId: STANDARD_IMPERIAL, winner: "yd", over: "ft" },
    // §5: when 0.5 mi fits (bandHit), mi wins over yd (locked; was deferred).
    { ladderId: STANDARD_IMPERIAL, winner: "mi", over: "yd" },
    // §5 / I-01 companion: mil owns its band vs shared fine-head µm (flip at 1 mil;
    // without this, L2 enter held µm until band hi ≈ 20 mil when 1 mil left the pool).
    { ladderId: STANDARD_IMPERIAL, winner: "mil", over: "µm" },
    // mil↔in bridge: inch fractions are sub-1, so preferGe1 would always keep
    // mil (≥1) through the bar-overlap and then jump to 1/8 via barTarget.
    // Explicit handoff: when both band-hit, inches win → 50 mil ↔ 1/16 in.
    { ladderId: STANDARD_IMPERIAL, winner: "in", over: "mil" },
    // L4: ultra-standard imperial — mi (0.25–1) beats ft when it fits.
    { ladderId: ULTRA_STANDARD_IMPERIAL, winner: "mi", over: "ft" },
    // ly holds through its band before pc takes over (as-built demote spirit).
    { ladderId: null, winner: "ly", over: "pc" },
    // True-metric Qm → Ppc bridge: Qm holds through 500 before Ppc.
    { ladderId: TRUE_METRIC, winner: "Qm", over: "Ppc" },
];

/**
 * Extra nice values beyond the 1/2/5 grammar, per (ladderId, unit).
 * L4 requires quarter-mile readings on the ultra imperial ladder.
 */
const EXTRA_NICE = {
    [ULTRA_STANDARD_IMPERIAL]: { mi: [0.25] },
};

/**
 * Prefer≥1 promote edges (§5 / I-01): when `1 <toUnit>` fits, it beats
 * still-fitting bandHits on `fromUnit`. yd→0.5 mi is a handoff (sub-1),
 * not a promote-to-1 edge.
 */
const PROMOTE_NEXT_GE1 = {
    // §5 / I-01: imperial fine head → mil at 1 mil (not at µm band hi ≈ 20 mil).
    [STANDARD_IMPERIAL]: { µm: "mil", in: "ft" },
    [ULTRA_STANDARD_IMPERIAL]: { in: "ft" },
    [STANDARD_METRIC]: { cm: "m", mm: "cm", m: "km" },
    [TRUE_METRIC]: { cm: "dm", dm: "m", mm: "cm" },
    [ULTRA_STANDARD_METRIC]: { cm: "m", mm: "cm", m: "km" },
};

/**
 * "Normal far edge" for user preferred ranges (L5/L12) when it exceeds the
 * standard band max. mi is usable through ~2000 mi before body bands (L12);
 * yd user ranges reach 5000 per owner/catalog examples.
 */
const USER_BAND_FAR_EDGE = {
    // in standard preferred hi is 1; L5/L12 user far edge still reaches 10 in.
    [STANDARD_IMPERIAL]: { mi: 2000, yd: 5000, in: 10 },
    [ULTRA_STANDARD_IMPERIAL]: { mi: 5000, in: 10 },
};

/** Standard preferred band { lo, hi } in display magnitudes, or default. */
export function bandFor(ladderId, unit) {
    const o = BAND_OVERRIDES[ladderId]?.[unit];
    if (o) return { lo: o[0], hi: o[1] };
    return { lo: DEFAULT_BAND[0], hi: DEFAULT_BAND[1] };
}

/** Band as a log-length interval on this ladder (B.1 spine). */
export function bandLogInterval(ladderId, unit) {
    const band = bandFor(ladderId, unit);
    const logUnit = unitLog10Meters(unit);
    if (!Number.isFinite(logUnit)) {
        return { logLo: NaN, logHi: NaN };
    }
    return {
        logLo: log10(band.lo) + logUnit,
        logHi: log10(band.hi) + logUnit,
    };
}

export function extraNiceFor(ladderId, unit) {
    return EXTRA_NICE[ladderId]?.[unit] ?? [];
}

export function userBandFarEdge(ladderId, unit) {
    return USER_BAND_FAR_EDGE[ladderId]?.[unit] ?? bandFor(ladderId, unit).hi;
}

/**
 * Units whose band hits lose an active handoff on this ladder.
 * bandHitUnits: Set of units that currently have a band-hit stop in the pool.
 */
export function handoffSuppressedUnits(ladderId, bandHitUnits) {
    const suppressed = new Set();
    for (const rule of HANDOFF_WINNERS) {
        if (rule.ladderId && rule.ladderId !== ladderId) continue;
        if (!rule.ladderId) {
            // Generic rule only applies when the ladder actually carries both units.
            const ladder = ladderForStack(ladderId);
            const names = new Set(ladder.map((r) => r.name));
            if (!names.has(rule.winner) || !names.has(rule.over)) continue;
        }
        if (bandHitUnits.has(rule.winner) && bandHitUnits.has(rule.over)) {
            suppressed.add(rule.over);
        }
    }
    return suppressed;
}

/**
 * Promote target for prefer≥1 (I-01): `{ unit, value: 1 }` when `fromUnit`
 * has a §5 promote edge on this ladder, else null.
 */
export function promoteTarget(ladderId, fromUnit) {
    const to = PROMOTE_NEXT_GE1[ladderId]?.[fromUnit];
    return to ? { unit: to, value: 1 } : null;
}

/**
 * Finer units whose bandHits lose to an in-pool `1 <coarser>` promote stop.
 * onesInPool: Set of units that have a niceValue===1 stop in the candidate pool.
 * bandHitUnits: Set of units with a band-hit stop in the pool.
 */
export function promoteSuppressedUnits(ladderId, onesInPool, bandHitUnits) {
    const suppressed = new Set();
    const edges = PROMOTE_NEXT_GE1[ladderId];
    if (!edges) return suppressed;
    for (const [from, to] of Object.entries(edges)) {
        if (onesInPool.has(to) && bandHitUnits.has(from)) {
            suppressed.add(from);
        }
    }
    return suppressed;
}

/**
 * Install-interval helper (debug / docs). Fine-side teardown no longer uses
 * this — see userBandShouldClear (I-02 pool-exit + far-edge cap).
 */
export function userBandExited(userBand, tLog, eps = 1e-9) {
    if (!userBand || !Number.isFinite(tLog)) return false;
    return tLog < userBand.logLo - eps || tLog > userBand.logHi + eps;
}

/**
 * Preferred unit has no in-bounds bar stop in the resolve pool.
 */
export function userBandUnitMissingFromPool(userBand, pool) {
    if (!userBand) return false;
    if (!Array.isArray(pool) || !pool.length) return true;
    return !pool.some((s) => s.unit === userBand.unit);
}

/**
 * I-02 / Proposal A hybrid: clear when the preferred unit leaves the bar pool
 * (fine + mid stickiness), OR when targetLogLen passes the install far edge
 * (coarse S2 / L12 — sci nices can keep a unit "in pool" at absurd zooms).
 * Do NOT clear solely because tLog < logLo (that was the B⁺ knife-edge).
 */
export function userBandShouldClear(userBand, tLog, pool, eps = 1e-9) {
    if (!userBand) return false;
    if (userBandUnitMissingFromPool(userBand, pool)) return true;
    if (Number.isFinite(tLog) && Number.isFinite(userBand.logHi) && tLog > userBand.logHi + eps) {
        return true;
    }
    return false;
}

/**
 * Build a user preferred range (L5 / L12 / B.7): spans pick↔far
 * (min/max of quantized nice pick and far edge), optionally unioned with the
 * install bar pixel window. Does not union with §5 band.lo (I-08).
 * Stored purely in physical/log space (survives zoom + grammar regions).
 *
 * opts.logBarMin / opts.logBarMax — log-lengths of BAR_PX_MIN / BAR_PX_MAX at
 * install mpp. Union both so I-02 is not knife-edged when the quantized pick
 * sits above targetLogLen (fine/target side) or at the coarse bar end (e.g. am
 * from 5 pm). Far edge still caps the product hi when it exceeds bar max.
 */
export function buildUserBand(ladderId, unit, pickLogLen, opts = {}) {
    const logUnit = unitLog10Meters(unit);
    if (!Number.isFinite(logUnit) || !Number.isFinite(pickLogLen)) {
        return { unit, ladderId, logLo: pickLogLen, logHi: pickLogLen };
    }
    const farLog = log10(userBandFarEdge(ladderId, unit)) + logUnit;
    let logLo = Math.min(pickLogLen, farLog);
    let logHi = Math.max(pickLogLen, farLog);
    const logBarMin = opts.logBarMin;
    const logBarMax = opts.logBarMax;
    if (Number.isFinite(logBarMin)) {
        logLo = Math.min(logLo, logBarMin);
    }
    if (Number.isFinite(logBarMax)) {
        logHi = Math.max(logHi, logBarMax);
    }
    return { unit, ladderId, logLo, logHi };
}
