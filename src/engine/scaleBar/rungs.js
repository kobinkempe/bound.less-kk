/**
 * Presentation rungs — the HUD popover (constraint 6, rungs 6a–6e) and set-scale
 * dialog (constraint 7, rungs 7a–7d), each built from ordered LogicRule objects
 * (logicRule.js). Rungs are CUMULATIVE unions (implementation doc §B.8);
 * rungs that add no new units are skipped (constraint 6).
 *
 * Membership is data — the RUNG plans below are lists of LogicRule instances, so
 * a rule can be moved between rungs or retuned without touching the rule classes
 * or the level engine (constraint 8).
 */

import {
    POPOVER_TABLE_AT,
    SET_SCALE_TABLE_AT,
} from "./constants";
import { unitLog10Meters } from "./catalog";
import {
    RelatedLadderAutoShow,
    CurrentLadderAuto,
    CurrentLadderWithinFactor,
    AnyLadderAuto,
    RelatedWithinFactor,
    CurrentLadderReadingBand,
    AnyLadderReadingBand,
    CurrentLadderNeighbors,
    RelatedLadderNeighbors,
    AllUltraStandard,
    NamedUnits,
    NoSiPrefixUnits,
    AllUnits,
    UltraStandardBetween,
    AllLaddersBetween,
    CurrentLadderNoSiPrefix,
    CurrentLadderSiPrefixedMeters,
} from "./logicRule";

/** Popover rung plan (6a–6e) — reorderable list of LogicRule instances. */
export const POPOVER_RUNGS = [
    // 6a
    [
        new RelatedLadderAutoShow(),
        new CurrentLadderAuto({ discard: "user" }),
        new CurrentLadderAuto({ discard: "all" }),
        new CurrentLadderWithinFactor({ factor: 50 }),
    ],
    // 6b
    [
        new AnyLadderAuto({ discard: "user" }),
        new AnyLadderAuto({ discard: "all" }),
        new RelatedWithinFactor({ factor: 50 }),
        new CurrentLadderReadingBand({ lo: 0.1, hi: 500 }),
    ],
    // 6c
    [
        new AnyLadderReadingBand({ lo: 0.1, hi: 500 }),
        new CurrentLadderNeighbors({ up: 2, down: 2 }),
        new RelatedLadderNeighbors({ up: 1, down: 1 }),
    ],
    // 6d
    [
        new AllUltraStandard(),
        new NamedUnits({ units: ["kpc"] }),
        new NoSiPrefixUnits(),
    ],
    // 6e
    [new AllUnits()],
];

/** Set-scale rung plan (7a–7d). */
export const SET_SCALE_RUNGS = [
    // 7a
    [new UltraStandardBetween({ lo: "mm", hi: "mi" })],
    // 7b
    [new AllUltraStandard()],
    // 7c
    [
        new AllLaddersBetween({ lo: "µm", hi: "kpc" }),
        new CurrentLadderNoSiPrefix(),
        new CurrentLadderSiPrefixedMeters(),
    ],
    // 7d
    [new AllUnits()],
];

function evaluateRung(rules, ctx) {
    const out = [];
    for (const rule of rules) {
        for (const u of rule.evaluate(ctx)) {
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
