/**
 * Presentation rungs — closed predicate registry (Option 02) driving the
 * HUD popover (constraint 6, rungs 6a–6e) and set-scale dialog (constraint 7,
 * rungs 7a–7d). Rungs are CUMULATIVE unions (implementation doc §B.8
 * ASSUMPTION); rungs that add no new units are skipped (constraint 6).
 *
 * Rung membership is data (RUNG plans below) — move a rule between rungs or
 * retune a factor without touching the expanders (constraint 8).
 */

import {
    POPOVER_TABLE_AT,
    SET_SCALE_TABLE_AT,
    BAR_PX_TARGET,
    LADDER_IDS,
    LADDER_PRIORITY,
} from "./constants";
import {
    RELATED_LADDERS,
    ladderForStack,
    ladderNeighbors,
    unitsOnLadderWithinFactor,
    ULTRA_STANDARD,
} from "./membership";
import {
    allCatalogUnits,
    getUnit,
    unitLog10Meters,
    isNoSiPrefix,
    hasSiPrefix,
} from "./catalog";
import { resolveReading } from "./resolve";
import { createSession } from "./session";
import { log10, safeExp10 } from "./logMath";

/** Auto-show probe on a ladder — clean hypothetical session, no live overlay (L10). */
function autoShowUnit(ladderId, mpp, discard) {
    const reading = resolveReading(mpp, createSession(ladderId), {
        ladderId,
        ignoreUserBand: true,
        ignoreIncumbent: true,
        ignoreAllPrefs: discard === "all",
    });
    return reading?.unit ?? null;
}

/** Units on a ladder whose displayed reading at mpp falls in [lo, hi]. */
function ladderUnitsReadingBetween(ladderId, mpp, lo, hi) {
    if (!(mpp > 0)) return [];
    const out = [];
    const logTarget = log10(BAR_PX_TARGET) + log10(mpp);
    for (const rung of ladderForStack(ladderId)) {
        const value = safeExp10(logTarget - rung.log10Meters);
        if (value >= lo && value <= hi) out.push(rung.name);
    }
    return out;
}

function unitsBetween(names, loUnit, hiUnit) {
    const lo = unitLog10Meters(loUnit);
    const hi = unitLog10Meters(hiUnit);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
    return names.filter((n) => {
        const u = getUnit(n);
        return u && u.log10Meters >= lo - 1e-9 && u.log10Meters <= hi + 1e-9;
    });
}

function allLadderUnion() {
    const seen = new Set();
    for (const ladderId of LADDER_PRIORITY) {
        for (const rung of ladderForStack(ladderId)) seen.add(rung.name);
    }
    return [...seen];
}

/**
 * Closed predicate registry. Each rule: { type, ...params } → UnitId[].
 * ctx = { currentUnit, ladderId, mpp, session }.
 */
const PREDICATES = {
    /** 6a: unit each related ladder would auto-show at this zoom (L10 / Q3). */
    "related-ladder-auto-show": (rule, ctx) =>
        (RELATED_LADDERS[ctx.ladderId] || [])
            .map((rl) => autoShowUnit(rl, ctx.mpp, "user"))
            .filter(Boolean),

    /** 6a: current-ladder auto with user / all preferences discarded. */
    "current-ladder-auto": (rule, ctx) => {
        const u = autoShowUnit(ctx.ladderId, ctx.mpp, rule.discard);
        return u ? [u] : [];
    },

    /** 6a: units on the current ladder within `factor`× of the current unit. */
    "current-ladder-within-factor": (rule, ctx) =>
        unitsOnLadderWithinFactor(ctx.currentUnit, ctx.ladderId, rule.factor),

    /** 6b: the unit every ladder would auto-show at this zoom. */
    "any-ladder-auto": (rule, ctx) =>
        LADDER_PRIORITY.map((l) => autoShowUnit(l, ctx.mpp, rule.discard)).filter(Boolean),

    /** 6b: units on related ladders within `factor`× of the current unit. */
    "related-within-factor": (rule, ctx) =>
        (RELATED_LADDERS[ctx.ladderId] || []).flatMap((rl) =>
            unitsOnLadderWithinFactor(ctx.currentUnit, rl, rule.factor),
        ),

    /** 6b: current-ladder units reading between lo and hi at this zoom. */
    "current-ladder-reading-band": (rule, ctx) =>
        ladderUnitsReadingBetween(ctx.ladderId, ctx.mpp, rule.lo, rule.hi),

    /** 6c: any-ladder units reading between lo and hi at this zoom. */
    "any-ladder-reading-band": (rule, ctx) =>
        LADDER_PRIORITY.flatMap((l) =>
            ladderUnitsReadingBetween(l, ctx.mpp, rule.lo, rule.hi),
        ),

    /** 6c: rungs up/down from the current unit on the current ladder. */
    "current-ladder-neighbors": (rule, ctx) =>
        ladderNeighbors(ctx.currentUnit, ctx.ladderId, rule.up, rule.down),

    /** 6c: rungs up/down on each related ladder. */
    "related-ladder-neighbors": (rule, ctx) =>
        (RELATED_LADDERS[ctx.ladderId] || []).flatMap((rl) =>
            ladderNeighbors(ctx.currentUnit, rl, rule.up, rule.down),
        ),

    /** 6d / 7b: every ultra-standard unit (both ultra ladders). */
    "all-ultra-standard": () => ULTRA_STANDARD.slice(),

    /** 6d: explicit unit list (kpc). */
    "named-units": (rule) => rule.units.slice(),

    /** 6d: catalog units without an SI prefix (bodies, imperial, astro, m, ℓP…). */
    "no-si-prefix-units": () =>
        allCatalogUnits().filter((u) => isNoSiPrefix(u.name)).map((u) => u.name),

    /** 6e / 7d: everything registered on any ladder. */
    "all-units": () => allLadderUnion(),

    /** 7a: ultra-standard units between two sizes (inclusive). */
    "ultra-standard-between": (rule) =>
        unitsBetween(ULTRA_STANDARD, rule.lo, rule.hi),

    /** 7c: all-ladder units between two sizes (inclusive). */
    "all-ladders-between": (rule) =>
        unitsBetween(allLadderUnion(), rule.lo, rule.hi),

    /** 7c: current-ladder units without an SI prefix (when a ladder exists). */
    "current-ladder-no-si-prefix": (rule, ctx) => {
        if (!ctx.ladderId) return [];
        return ladderForStack(ctx.ladderId)
            .map((r) => r.name)
            .filter((n) => isNoSiPrefix(n));
    },

    /** 7c: SI-prefixed meter units on the current ladder (true-metric only). */
    "current-ladder-si-prefixed-meters": (rule, ctx) => {
        if (ctx.ladderId !== LADDER_IDS.TRUE_METRIC) return [];
        return ladderForStack(ctx.ladderId)
            .map((r) => r.name)
            .filter((n) => {
                const u = getUnit(n);
                return u && u.siPrefixBase === "m" && hasSiPrefix(n);
            });
    },
};

/** Popover rung plan (6a–6e) — reorderable data, cumulative unions. */
export const POPOVER_RUNGS = [
    // 6a
    [
        { type: "related-ladder-auto-show" },
        { type: "current-ladder-auto", discard: "user" },
        { type: "current-ladder-auto", discard: "all" },
        { type: "current-ladder-within-factor", factor: 50 },
    ],
    // 6b
    [
        { type: "any-ladder-auto", discard: "user" },
        { type: "any-ladder-auto", discard: "all" },
        { type: "related-within-factor", factor: 50 },
        { type: "current-ladder-reading-band", lo: 0.1, hi: 500 },
    ],
    // 6c
    [
        { type: "any-ladder-reading-band", lo: 0.1, hi: 500 },
        { type: "current-ladder-neighbors", up: 2, down: 2 },
        { type: "related-ladder-neighbors", up: 1, down: 1 },
    ],
    // 6d
    [
        { type: "all-ultra-standard" },
        { type: "named-units", units: ["kpc"] },
        { type: "no-si-prefix-units" },
    ],
    // 6e
    [{ type: "all-units" }],
];

/** Set-scale rung plan (7a–7d). */
export const SET_SCALE_RUNGS = [
    // 7a
    [{ type: "ultra-standard-between", lo: "mm", hi: "mi" }],
    // 7b
    [{ type: "all-ultra-standard" }],
    // 7c
    [
        { type: "all-ladders-between", lo: "µm", hi: "kpc" },
        { type: "current-ladder-no-si-prefix" },
        { type: "current-ladder-si-prefixed-meters" },
    ],
    // 7d
    [{ type: "all-units" }],
];

function evaluateRung(rules, ctx) {
    const out = [];
    for (const rule of rules) {
        const fn = PREDICATES[rule.type];
        if (!fn) continue;
        for (const u of fn(rule, ctx)) {
            if (u) out.push(u);
        }
    }
    return out;
}

function sortBySize(units) {
    return [...units].sort((a, b) => {
        const la = unitLog10Meters(a);
        const lb = unitLog10Meters(b);
        if (!Number.isFinite(la) && !Number.isFinite(lb)) return 0;
        if (!Number.isFinite(la)) return 1;
        if (!Number.isFinite(lb)) return -1;
        return la - lb;
    });
}

/**
 * Cumulative effective rungs: level n = union of rungs 0…n, minus excluded
 * units; rungs adding nothing new are collapsed (constraint 6 skip rule),
 * including a leading empty first rung (e.g. 6a only yields the current unit).
 */
function effectiveRungs(plan, ctx, exclude) {
    const cumulative = new Set();
    const levels = [];
    for (const rules of plan) {
        for (const u of evaluateRung(rules, ctx)) {
            if (!exclude.has(u)) cumulative.add(u);
        }
        const units = sortBySize([...cumulative]);
        // Skip empty leading rungs as well as no-op expansions vs prior level.
        if (units.length === 0) continue;
        if (!levels.length || units.length > levels[levels.length - 1].length) {
            levels.push(units);
        }
    }
    if (!levels.length) levels.push([]);
    return levels;
}

/**
 * Popover units at a rung level (cumulative, current unit excluded, sorted
 * small → large; > POPOVER_TABLE_AT flips to the full-name membership table).
 * isFullCatalog is true only at the final 6e all-units level.
 */
export function popoverUnits(level, ctx) {
    const levels = effectiveRungs(POPOVER_RUNGS, ctx, new Set([ctx.currentUnit]));
    const idx = Math.max(0, Math.min(level, levels.length - 1));
    const units = levels[idx];
    const asTable = units.length > POPOVER_TABLE_AT;
    const isFullCatalog = idx === levels.length - 1;
    return {
        units,
        level: idx,
        hasMore: idx < levels.length - 1,
        nextMoreLevel: Math.min(idx + 1, levels.length - 1),
        nextIsTable:
            idx < levels.length - 1 && levels[idx + 1].length > POPOVER_TABLE_AT,
        asTable,
        isFullCatalog,
        mode: asTable ? "table" : "chips",
    };
}

/**
 * Set-scale dialog units at a rung level (> SET_SCALE_TABLE_AT flips to table).
 * Full catalog only at the final 7d level (isFullCatalog).
 * ctx: { ladderId: currentLadderId | null, selectedUnit }.
 * Ladder assignment runs on save (L9 / I-16) — dialog must not mutate ladderId.
 */
export function setScaleUnits(level, ctx = {}) {
    const levels = effectiveRungs(SET_SCALE_RUNGS, { ...ctx, mpp: ctx.mpp ?? null }, new Set());
    const idx = Math.max(0, Math.min(level, levels.length - 1));
    const units = levels[idx];
    const asTable = units.length > SET_SCALE_TABLE_AT;
    const isFullCatalog = idx === levels.length - 1;
    return {
        units,
        level: idx,
        hasMore: idx < levels.length - 1,
        nextMoreLevel: Math.min(idx + 1, levels.length - 1),
        asTable,
        showFullTable: asTable,
        isFullCatalog,
        mode: asTable ? "table" : "chips",
    };
}
