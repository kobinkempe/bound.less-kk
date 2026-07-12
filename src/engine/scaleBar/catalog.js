/**
 * Unit Catalog — physical truth only (layer 07).
 * Owns: id, log10Meters, names, family, siPrefixBase, formatKind.
 * Must not: ladder membership, bands, rungs.
 */

import { PLANCK_LENGTH_M } from "./constants";

const SPECIAL_NAMES = {
    "ℓP": "Planck Length",
    "R☉": "Solar Radius",
    "R⊕": "Earth Radius",
    AU: "Astronomical Unit",
    ld: "Light Day",
    ly: "Light Year",
    pc: "Parsec",
    mil: "Mil/Thou",
    in: "Inch",
    ft: "Foot",
    yd: "Yard",
    mi: "Mile",
};

export const PREFIXES = [
    { name: "quetta", short: "Q", exp: 30 },
    { name: "ronna", short: "R", exp: 27 },
    { name: "yotta", short: "Y", exp: 24 },
    { name: "zetta", short: "Z", exp: 21 },
    { name: "exa", short: "E", exp: 18 },
    { name: "peta", short: "P", exp: 15 },
    { name: "tera", short: "T", exp: 12 },
    { name: "giga", short: "G", exp: 9 },
    { name: "mega", short: "M", exp: 6 },
    { name: "kilo", short: "k", exp: 3 },
    { name: "hecto", short: "h", exp: 2 },
    { name: "deca", short: "da", exp: 1 },
    { name: "deci", short: "d", exp: -1 },
    { name: "centi", short: "c", exp: -2 },
    { name: "milli", short: "m", exp: -3 },
    { name: "micro", short: "µ", exp: -6 },
    { name: "nano", short: "n", exp: -9 },
    { name: "pico", short: "p", exp: -12 },
    { name: "femto", short: "f", exp: -15 },
    { name: "atto", short: "a", exp: -18 },
    { name: "zepto", short: "z", exp: -21 },
    { name: "yocto", short: "y", exp: -24 },
    { name: "ronto", short: "r", exp: -27 },
    { name: "quecto", short: "q", exp: -30 },
];

/** Shared fine head defs (ratio chain from qℓP). */
const PLANCK_SUB_LADDER = [
    { name: "qℓP", ratioFromPrev: null, kind: "planck-prefix", prefixShort: "q", family: "planck", siPrefixBase: "ℓP" },
    { name: "rℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "r", family: "planck", siPrefixBase: "ℓP" },
    { name: "yℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "y", family: "planck", siPrefixBase: "ℓP" },
    { name: "zℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "z", family: "planck", siPrefixBase: "ℓP" },
    { name: "aℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "a", family: "planck", siPrefixBase: "ℓP" },
    { name: "fℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "f", family: "planck", siPrefixBase: "ℓP" },
    { name: "pℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "p", family: "planck", siPrefixBase: "ℓP" },
    { name: "nℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "n", family: "planck", siPrefixBase: "ℓP" },
    { name: "µℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "µ", family: "planck", siPrefixBase: "ℓP" },
    { name: "mℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "m", family: "planck", siPrefixBase: "ℓP" },
    { name: "ℓP", ratioFromPrev: 1000, kind: "planck", family: "planck", siPrefixBase: null },
    { name: "kℓP", ratioFromPrev: 1000, kind: "planck-prefix", prefixShort: "k", family: "planck", siPrefixBase: "ℓP" },
];

const SHARED_SUB_UM = [
    ...PLANCK_SUB_LADDER,
    { name: "qm", ratioFromPrev: 61.87, kind: "si-meter", prefixShort: "q", family: "si-meter", siPrefixBase: "m" },
    { name: "rm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "r", family: "si-meter", siPrefixBase: "m" },
    { name: "ym", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "y", family: "si-meter", siPrefixBase: "m" },
    { name: "zm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "z", family: "si-meter", siPrefixBase: "m" },
    { name: "am", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "a", family: "si-meter", siPrefixBase: "m" },
    { name: "fm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "f", family: "si-meter", siPrefixBase: "m" },
    { name: "pm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "p", family: "si-meter", siPrefixBase: "m" },
    { name: "nm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "n", family: "si-meter", siPrefixBase: "m" },
    { name: "µm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "µ", family: "si-meter", siPrefixBase: "m" },
];

const PARSEC_TAIL = [
    { name: "kpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Mpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Gpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Tpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Ppc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Epc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Zpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Ypc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Rpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Qpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
];

const STANDARD_METRIC_TAIL = [
    { name: "mm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "m", family: "si-meter", siPrefixBase: "m" },
    { name: "cm", ratioFromPrev: 10, kind: "si-meter", prefixShort: "c", family: "si-meter", siPrefixBase: "m" },
    { name: "m", ratioFromPrev: 100, kind: "si-meter", family: "si-meter", siPrefixBase: null },
    { name: "km", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "k", family: "si-meter", siPrefixBase: "m" },
    { name: "Mm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "M", family: "si-meter", siPrefixBase: "m" },
    { name: "R☉", ratioFromPrev: 695.7, kind: "body", family: "body", siPrefixBase: null },
    { name: "AU", ratioFromPrev: 215.032, kind: "astro", family: "astro", siPrefixBase: null },
    { name: "ld", ratioFromPrev: 173.145, kind: "astro", family: "astro", siPrefixBase: null },
    { name: "ly", ratioFromPrev: 365.25, kind: "astro", family: "astro", siPrefixBase: null },
    { name: "pc", ratioFromPrev: 3.262, kind: "astro", family: "astro", siPrefixBase: null },
    ...PARSEC_TAIL,
];

const TRUE_METRIC_TAIL = [
    { name: "mm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "m", family: "si-meter", siPrefixBase: "m" },
    { name: "cm", ratioFromPrev: 10, kind: "si-meter", prefixShort: "c", family: "si-meter", siPrefixBase: "m" },
    { name: "dm", ratioFromPrev: 10, kind: "si-meter", prefixShort: "d", family: "si-meter", siPrefixBase: "m" },
    { name: "m", ratioFromPrev: 10, kind: "si-meter", family: "si-meter", siPrefixBase: null },
    { name: "dam", ratioFromPrev: 10, kind: "si-meter", prefixShort: "da", family: "si-meter", siPrefixBase: "m" },
    { name: "hm", ratioFromPrev: 10, kind: "si-meter", prefixShort: "h", family: "si-meter", siPrefixBase: "m" },
    { name: "km", ratioFromPrev: 10, kind: "si-meter", prefixShort: "k", family: "si-meter", siPrefixBase: "m" },
    { name: "Mm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "M", family: "si-meter", siPrefixBase: "m" },
    { name: "Gm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "G", family: "si-meter", siPrefixBase: "m" },
    { name: "Tm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "T", family: "si-meter", siPrefixBase: "m" },
    { name: "Pm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "P", family: "si-meter", siPrefixBase: "m" },
    { name: "Em", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "E", family: "si-meter", siPrefixBase: "m" },
    { name: "Zm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "Z", family: "si-meter", siPrefixBase: "m" },
    { name: "Ym", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "Y", family: "si-meter", siPrefixBase: "m" },
    { name: "Rm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "R", family: "si-meter", siPrefixBase: "m" },
    { name: "Qm", ratioFromPrev: 1000, kind: "si-meter", prefixShort: "Q", family: "si-meter", siPrefixBase: "m" },
    { name: "Ppc", ratioFromPrev: 30.857, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Epc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Zpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Ypc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Rpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
    { name: "Qpc", ratioFromPrev: 1000, kind: "astro", family: "astro", siPrefixBase: "pc" },
];

const STANDARD_IMPERIAL_TAIL = [
    { name: "mil", ratioFromPrev: 25.4, kind: "imperial", family: "imperial", siPrefixBase: null },
    { name: "in", ratioFromPrev: 1000, kind: "imperial", family: "imperial", siPrefixBase: null },
    { name: "ft", ratioFromPrev: 12, kind: "imperial", family: "imperial", siPrefixBase: null },
    { name: "yd", ratioFromPrev: 3, kind: "imperial", family: "imperial", siPrefixBase: null },
    { name: "mi", ratioFromPrev: 1760, kind: "imperial", family: "imperial", siPrefixBase: null },
    { name: "R⊕", ratioFromPrev: 3963.168, kind: "body", family: "body", siPrefixBase: null },
    { name: "R☉", ratioFromPrev: 109.076, kind: "body", family: "body", siPrefixBase: null },
    { name: "AU", ratioFromPrev: 215.032, kind: "astro", family: "astro", siPrefixBase: null },
    { name: "ld", ratioFromPrev: 173.145, kind: "astro", family: "astro", siPrefixBase: null },
    { name: "ly", ratioFromPrev: 365.25, kind: "astro", family: "astro", siPrefixBase: null },
    { name: "pc", ratioFromPrev: 3.262, kind: "astro", family: "astro", siPrefixBase: null },
    ...PARSEC_TAIL,
];

/**
 * Ultra inventories omit yd/mil/ld/R☉/R⊕ (bible §2 / Q2).
 * Physical sizes taken from the shared registry after standard ladders register.
 */
const ULTRA_STANDARD_METRIC_NAMES = [
    "ℓP", "fm", "pm", "nm", "µm", "mm", "cm", "m", "km", "AU", "ly", "pc",
];
const ULTRA_STANDARD_IMPERIAL_NAMES = [
    "ℓP", "fm", "pm", "nm", "µm", "in", "ft", "mi", "AU", "ly", "pc",
];

function buildRungs(defs) {
    const lpIndex = defs.findIndex((d) => d.name === "ℓP");
    let meters;
    if (lpIndex >= 0) {
        let factor = 1;
        for (let i = 1; i <= lpIndex; i++) {
            factor *= defs[i].ratioFromPrev ?? 1;
        }
        meters = PLANCK_LENGTH_M / factor;
    } else {
        meters = PLANCK_LENGTH_M;
    }
    return defs.map((def, i) => {
        if (i > 0 && def.ratioFromPrev != null) {
            meters *= def.ratioFromPrev;
        }
        return { ...def, meters };
    });
}

function safeLog10Meters(meters) {
    if (!(meters > 0) || !Number.isFinite(meters)) {
        // Extreme: derive from PLANCK chain via log ratios when float dies
        return Number.NEGATIVE_INFINITY;
    }
    return Math.log10(meters);
}

/** @type {Map<string, object>} */
const unitRegistry = new Map();

function registerUnit(rung) {
    const existing = unitRegistry.get(rung.name);
    if (existing) {
        // Keep first meters (canonical); merge format metadata if missing
        return existing;
    }
    const entry = {
        id: rung.name,
        name: rung.name,
        meters: rung.meters,
        log10Meters: safeLog10Meters(rung.meters),
        kind: rung.kind,
        family: rung.family || rung.kind || "other",
        siPrefixBase: rung.siPrefixBase ?? null,
        prefixShort: rung.prefixShort ?? null,
        formatKind: rung.kind === "imperial" && rung.name === "in" ? "inch" : "plain",
    };
    // For extreme units where meters under/overflows, recompute log via chain
    if (!Number.isFinite(entry.log10Meters) || entry.log10Meters === -Infinity) {
        entry.log10Meters = Math.log10(PLANCK_LENGTH_M); // fallback; fixed below for known units
    }
    unitRegistry.set(rung.name, entry);
    return entry;
}

// Build from standard metric (canonical physical sizes for shared units)
const SM_RUNGS = buildRungs([...SHARED_SUB_UM, ...STANDARD_METRIC_TAIL]);
for (const r of SM_RUNGS) registerUnit(r);

const TM_RUNGS = buildRungs([...SHARED_SUB_UM, ...TRUE_METRIC_TAIL]);
for (const r of TM_RUNGS) {
    if (!unitRegistry.has(r.name)) registerUnit(r);
}

const SI_RUNGS = buildRungs([...SHARED_SUB_UM, ...STANDARD_IMPERIAL_TAIL]);
for (const r of SI_RUNGS) {
    if (!unitRegistry.has(r.name)) registerUnit(r);
}

// Fix log10Meters for all registered units using linear meters when finite,
// else reconstruct from known ratios relative to a finite neighbor.
function repairLogFactors() {
    const ordered = [...unitRegistry.values()].sort((a, b) => {
        // Prefer finite meters ordering
        if (Number.isFinite(a.meters) && Number.isFinite(b.meters)) return a.meters - b.meters;
        return a.name.localeCompare(b.name);
    });
    for (const u of ordered) {
        if (Number.isFinite(u.meters) && u.meters > 0) {
            u.log10Meters = Math.log10(u.meters);
        }
    }
    // Explicit known constants for extremes that may lose float precision
    const planckLog = Math.log10(PLANCK_LENGTH_M);
    const planckChain = [
        ["qℓP", -30], ["rℓP", -27], ["yℓP", -24], ["zℓP", -21], ["aℓP", -18],
        ["fℓP", -15], ["pℓP", -12], ["nℓP", -9], ["µℓP", -6], ["mℓP", -3],
        ["ℓP", 0], ["kℓP", 3],
    ];
    for (const [name, exp] of planckChain) {
        const u = unitRegistry.get(name);
        if (u) u.log10Meters = planckLog + exp;
    }
}
repairLogFactors();

export function getUnit(name) {
    return unitRegistry.get(name) || null;
}

export function unitMeters(name) {
    const u = unitRegistry.get(name);
    return u?.meters ?? null;
}

export function unitLog10Meters(name) {
    const u = unitRegistry.get(name);
    if (!u) return NaN; // soft-fail on hot paths (L11); tests use testSupport throws
    if (Number.isFinite(u.log10Meters)) return u.log10Meters;
    if (Number.isFinite(u.meters) && u.meters > 0) return Math.log10(u.meters);
    return NaN;
}

export function allCatalogUnits() {
    return [...unitRegistry.values()].sort((a, b) => a.log10Meters - b.log10Meters);
}

export function allRegisteredUnits() {
    return allCatalogUnits().map((u) => ({
        name: u.name,
        meters: u.meters,
        log10Meters: u.log10Meters,
        kind: u.kind,
        family: u.family,
        siPrefixBase: u.siPrefixBase,
        stacks: [], // filled by membership
    }));
}

function prefixNameForShort(short) {
    return PREFIXES.find((p) => p.short === short)?.name ?? short;
}

function capitalizeWord(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function unitFullName(name) {
    if (SPECIAL_NAMES[name]) return SPECIAL_NAMES[name];
    const rung = unitRegistry.get(name);
    if (!rung) return name;

    if (rung.kind === "planck-prefix") {
        const prefix = prefixNameForShort(rung.prefixShort);
        return `${capitalizeWord(prefix)}-Planck Length`;
    }
    if (rung.kind === "planck") return "Planck Length";
    if (rung.kind === "si-meter") {
        if (!rung.prefixShort) return "Meter";
        const prefix = prefixNameForShort(rung.prefixShort);
        return `${capitalizeWord(prefix)}meter`;
    }
    if (rung.kind === "astro" && name.endsWith("pc")) {
        const prefixShort = name.slice(0, -2);
        if (!prefixShort) return "Parsec";
        const prefix = prefixNameForShort(prefixShort);
        return `${capitalizeWord(prefix)}parsec`;
    }
    if (rung.kind === "imperial") return SPECIAL_NAMES[name] || capitalizeWord(name);
    if (rung.kind === "body") return SPECIAL_NAMES[name] || name;
    return name;
}

export function allUnitsTableRows() {
    return allCatalogUnits().map((u) => ({
        name: unitFullName(u.name),
        shorthand: u.name,
        meters: u.meters,
    }));
}

export function hasSiPrefix(unit) {
    const u = unitRegistry.get(unit);
    if (!u) return false;
    return u.siPrefixBase != null || (u.kind === "si-meter" && u.prefixShort != null);
}

export function isNoSiPrefix(unit) {
    return !hasSiPrefix(unit);
}

export { PLANCK_SUB_LADDER, SHARED_SUB_UM, SM_RUNGS, TM_RUNGS, SI_RUNGS };
export {
    ULTRA_STANDARD_METRIC_NAMES,
    ULTRA_STANDARD_IMPERIAL_NAMES,
    PLANCK_LENGTH_M,
};
