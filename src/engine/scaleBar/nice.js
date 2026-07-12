/**
 * Nice-number grammar: 1/2/5, plain↔sci, inch fractions (constraint 3 / 3a).
 *
 * The grammar is uniform across units: 1/2/5 mantissas per decade, shown
 * plain inside [PLAIN_MIN, PLAIN_MAX] and sci outside. Inches replace the
 * decimal region between .02 and 1 with the fraction chain
 * (1/32, 1/16, 1/8, 1/4, 1/2) per constraint 3a ("fractions, then decimals
 * at .01").
 */

import {
    NICE_MANTISSAS,
    PLAIN_MIN,
    PLAIN_MAX,
    INCH_FRACTIONS,
    BAR_PX_MIN,
    BAR_PX_MAX,
    BAR_PX_TARGET,
} from "./constants";
import { unitLog10Meters } from "./catalog";
import { log10, safeExp10 } from "./logMath";

const REL_EPS = 1e-9;

function formatSciValue(value) {
    if (value === 0) return "0";
    let exp = Math.floor(Math.log10(Math.abs(value)));
    let mantissa = value / Math.pow(10, exp);
    let m = parseFloat(mantissa.toPrecision(2));
    // toPrecision can round 9.99… → 10; renormalize so we never emit 10×10ⁿ
    // or a lone ×10⁰ from a drifted mantissa.
    if (Math.abs(m) >= 10) {
        m /= 10;
        exp += 1;
    }
    if (exp === 0) return String(m);
    const superscript = String(exp)
        .replace(/-/g, "⁻")
        .replace(/0/g, "⁰")
        .replace(/1/g, "¹")
        .replace(/2/g, "²")
        .replace(/3/g, "³")
        .replace(/4/g, "⁴")
        .replace(/5/g, "⁵")
        .replace(/6/g, "⁶")
        .replace(/7/g, "⁷")
        .replace(/8/g, "⁸")
        .replace(/9/g, "⁹");
    if (m === 1) return `10${superscript}`;
    return `${m}×10${superscript}`;
}

export function formatScaleNumber(n) {
    if (n === 0) return "0";
    const abs = Math.abs(n);
    if (abs > PLAIN_MAX || abs < PLAIN_MIN) return formatSciValue(n);
    if (abs >= 100) return Math.round(n).toLocaleString();
    return parseFloat(n.toPrecision(3)).toString();
}

function formFor(value) {
    return value >= PLAIN_MIN * (1 - REL_EPS) && value <= PLAIN_MAX * (1 + REL_EPS)
        ? "plain"
        : "sci";
}

/** Inch decimal region excluded in favor of fractions (3a). */
const INCH_FRACTION_REGION_LO = 0.02 * (1 + REL_EPS);
const INCH_FRACTION_REGION_HI = 1 * (1 - REL_EPS);

/**
 * Nice candidate values for a unit within [magLo, magHi] (display magnitudes).
 * Returns sorted { value, form, label }[]. Never throws; empty on bad input.
 */
export function niceValuesForUnit(unit, opts = {}) {
    const {
        magLo = PLAIN_MIN,
        magHi = PLAIN_MAX,
        extraValues = [],
    } = opts;

    if (!(magLo > 0) || !(magHi > 0) || !(magLo <= magHi)) return [];

    const out = [];
    const seen = new Set();
    const inWindow = (v) => v >= magLo * (1 - REL_EPS) && v <= magHi * (1 + REL_EPS);

    const push = (value, form, label = null) => {
        if (!(value > 0) || !Number.isFinite(value)) return;
        if (seen.has(value)) return;
        seen.add(value);
        out.push({
            value,
            form,
            label: form === "sci" && label == null ? formatSciValue(value) : label,
        });
    };

    const loExp = Math.floor(log10(magLo)) - 1;
    const hiExp = Math.ceil(log10(magHi)) + 1;
    if (!Number.isFinite(loExp) || !Number.isFinite(hiExp) || hiExp - loExp > 800) {
        return [];
    }

    const isInch = unit === "in";

    for (let e = loExp; e <= hiExp; e++) {
        for (const m of NICE_MANTISSAS) {
            const v = m * Math.pow(10, e);
            if (!(v > 0) || !Number.isFinite(v)) continue;
            if (!inWindow(v)) continue;
            // 3a: inches use fractions instead of decimals between .02 and 1.
            if (isInch && v > INCH_FRACTION_REGION_LO && v < INCH_FRACTION_REGION_HI) continue;
            push(v, formFor(v));
        }
    }

    if (isInch) {
        for (const f of INCH_FRACTIONS) {
            if (inWindow(f.value)) push(f.value, "fraction", f.label);
        }
        // 1/4 and 1/2 shown as plain decimals (as-built style).
        for (const v of [0.25, 0.5]) {
            if (inWindow(v)) push(v, "plain");
        }
    }

    for (const v of extraValues) {
        if (inWindow(v)) push(v, formFor(v));
    }

    out.sort((a, b) => a.value - b.value);
    return out;
}

/**
 * Best in-bounds nice stop for a unit at mpp (L5 install / pick quantization).
 * Never cold-searches other units — quantizes onto the requested unit, with a
 * clamped sci fallback at float extremes (L11).
 */
export function bestInBoundsNice(
    unit,
    mpp,
    barMin = BAR_PX_MIN,
    barMax = BAR_PX_MAX,
    barTarget = BAR_PX_TARGET,
    extraValues = [],
) {
    if (!(mpp > 0) || !Number.isFinite(mpp)) return null;
    let logUnit = unitLog10Meters(unit);
    if (!Number.isFinite(logUnit)) return null;
    const logMpp = log10(mpp);
    const magLo = safeExp10(log10(barMin) + logMpp - logUnit);
    const magHi = safeExp10(log10(barMax) + logMpp - logUnit);
    const cands = niceValuesForUnit(unit, {
        magLo: magLo * (1 - 1e-6),
        magHi: magHi * (1 + 1e-6),
        extraValues,
    });

    let best = null;
    let bestScore = Infinity;
    for (const c of cands) {
        const logLen = log10(c.value) + logUnit;
        const barPx = safeExp10(logLen - logMpp);
        if (!(barPx > 0) || !Number.isFinite(barPx)) continue;
        const score = Math.abs(logLen - (log10(barTarget) + logMpp));
        if (score < bestScore) {
            bestScore = score;
            best = {
                unit,
                niceValue: c.value,
                value: c.value,
                logLen,
                form: c.form,
                label: c.label,
                barPx: Math.min(barMax, Math.max(barMin, barPx)),
                displayLabel: c.form === "fraction" ? c.label : undefined,
                sciLabel: c.form === "sci" ? c.label : undefined,
            };
        }
    }
    if (best) return best;

    // Extreme fallback: nearest 1/2/5 mantissa at the target exponent, clamped bar.
    const targetNiceLog = log10(barTarget) + logMpp - logUnit;
    let fallback = null;
    let fbScore = Infinity;
    for (let e = Math.floor(targetNiceLog) - 1; e <= Math.ceil(targetNiceLog) + 1; e++) {
        for (const m of NICE_MANTISSAS) {
            const vLog = log10(m) + e;
            const value = safeExp10(vLog);
            if (!(value > 0) || !Number.isFinite(value)) continue;
            const score = Math.abs(vLog - targetNiceLog);
            if (score < fbScore) {
                fbScore = score;
                const logLen = vLog + logUnit;
                const rawBar = safeExp10(logLen - logMpp);
                const form = formFor(value);
                fallback = {
                    unit,
                    niceValue: value,
                    value,
                    logLen,
                    form,
                    label: form === "sci" ? formatSciValue(value) : null,
                    barPx: Math.min(barMax, Math.max(barMin, rawBar)),
                    sciLabel: form === "sci" ? formatSciValue(value) : undefined,
                };
            }
        }
    }
    return fallback;
}

export { formatSciValue };
