/**
 * Preference layer — the §5 standard preference bands (constraint 8 config).
 * The preference ORDER (lowest-in-range-number rule) lives in resolve.js.
 *
 * Bands are per (ladderId, unit) preferred display magnitudes from bible §5,
 * with the L4 update (ultra mi = 0.25–1).
 */

import { LADDER_IDS } from "./constants";
import { unitLog10Meters } from "./catalog";
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

// NOTE: HANDOFF_WINNERS and PROMOTE_NEXT_GE1 were removed 2026-07-15. The owner's
// unified rule — "lowest in-range number, default range lower bound 1" (see
// resolve.js) — subsumes every handoff and prefer-≥1 promote: 200 yd beats
// 500 ft (both Tier A, 200 < 500), 1/16 in beats 50 mil (both Tier A, sub-1
// counts), mi beats an out-of-band yd (Tier A > Tier B), 1 ft beats 10 in (both
// Tier B, ≥1). No per-pair tables needed.

/**
 * Extra nice values beyond the 1/2/5 grammar, per (ladderId, unit).
 * Ultra imperial needs quarter-mile readings so `0.25 mi` is a candidate.
 */
const EXTRA_NICE = {
    [ULTRA_STANDARD_IMPERIAL]: { mi: [0.25] },
};

// NOTE: user preferred ranges no longer use hardcoded far edges. A pick's span
// is derived from where the unit NATURALLY flips under the auto rule
// (pick.js#autoSpanForUnit), per the owner-clarified constraint 5.

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

