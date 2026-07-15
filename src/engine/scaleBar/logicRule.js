/**
 * LogicRule — a single membership rule for a popover / set-scale rung
 * (bible constraints 6a–6e / 7a–7d). Each rule is an object with
 * `evaluate(ctx) -> unitName[]`; a rung LEVEL is an ordered list of LogicRules,
 * and the level's units are the union of its rules' outputs (see rungs.js).
 *
 * Rules are data-configurable (constraint 8): move a rule between levels or
 * retune a factor by editing the plans in rungs.js — the rule classes here never
 * change. ctx = { currentUnit, ladderId, mpp, session, selectedUnit }.
 */

import { LADDER_PRIORITY, BAR_PX_TARGET, LADDER_IDS } from "./constants";
import {
    allCatalogUnits,
    getUnit,
    unitLog10Meters,
    isNoSiPrefix,
    hasSiPrefix,
} from "./catalog";
import { ladder } from "./ladder";
import { ULTRA_STANDARD } from "./membership";
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
    for (const rung of ladder(ladderId).rungs) {
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
        for (const rung of ladder(ladderId).rungs) seen.add(rung.name);
    }
    return [...seen];
}

/** Base class: a rung membership rule. Subclasses implement evaluate(). */
export class LogicRule {
    constructor(params = {}) { this.params = params; }
    // eslint-disable-next-line no-unused-vars
    evaluate(ctx) { return []; }
}

/** 6a: unit each related ladder would auto-show at this zoom (L10 / Q3). */
export class RelatedLadderAutoShow extends LogicRule {
    evaluate(ctx) {
        return (ladder(ctx.ladderId).relatedIds || [])
            .map((rl) => autoShowUnit(rl, ctx.mpp, "user"))
            .filter(Boolean);
    }
}

/** 6a: current-ladder auto with user / all preferences discarded. */
export class CurrentLadderAuto extends LogicRule {
    evaluate(ctx) {
        const u = autoShowUnit(ctx.ladderId, ctx.mpp, this.params.discard);
        return u ? [u] : [];
    }
}

/** 6a: units on the current ladder within `factor`× of the current unit. */
export class CurrentLadderWithinFactor extends LogicRule {
    evaluate(ctx) {
        return ladder(ctx.ladderId).unitsWithinFactor(ctx.currentUnit, this.params.factor);
    }
}

/** 6b: the unit every ladder would auto-show at this zoom. */
export class AnyLadderAuto extends LogicRule {
    evaluate(ctx) {
        return LADDER_PRIORITY.map((l) => autoShowUnit(l, ctx.mpp, this.params.discard)).filter(Boolean);
    }
}

/** 6b: units on related ladders within `factor`× of the current unit. */
export class RelatedWithinFactor extends LogicRule {
    evaluate(ctx) {
        return (ladder(ctx.ladderId).relatedIds || []).flatMap((rl) =>
            ladder(rl).unitsWithinFactor(ctx.currentUnit, this.params.factor),
        );
    }
}

/** 6b: current-ladder units reading between lo and hi at this zoom. */
export class CurrentLadderReadingBand extends LogicRule {
    evaluate(ctx) {
        return ladderUnitsReadingBetween(ctx.ladderId, ctx.mpp, this.params.lo, this.params.hi);
    }
}

/** 6c: any-ladder units reading between lo and hi at this zoom. */
export class AnyLadderReadingBand extends LogicRule {
    evaluate(ctx) {
        return LADDER_PRIORITY.flatMap((l) =>
            ladderUnitsReadingBetween(l, ctx.mpp, this.params.lo, this.params.hi),
        );
    }
}

/** 6c: rungs up/down from the current unit on the current ladder. */
export class CurrentLadderNeighbors extends LogicRule {
    evaluate(ctx) {
        return ladder(ctx.ladderId).neighbors(ctx.currentUnit, this.params.up, this.params.down);
    }
}

/** 6c: rungs up/down on each related ladder. */
export class RelatedLadderNeighbors extends LogicRule {
    evaluate(ctx) {
        return (ladder(ctx.ladderId).relatedIds || []).flatMap((rl) =>
            ladder(rl).neighbors(ctx.currentUnit, this.params.up, this.params.down),
        );
    }
}

/** 6d / 7b: every ultra-standard unit (both ultra ladders). */
export class AllUltraStandard extends LogicRule {
    evaluate() { return ULTRA_STANDARD.slice(); }
}

/** 6d: explicit unit list (e.g. kpc). */
export class NamedUnits extends LogicRule {
    evaluate() { return this.params.units.slice(); }
}

/** 6d: catalog units without an SI prefix (bodies, imperial, astro, m, ℓP…). */
export class NoSiPrefixUnits extends LogicRule {
    evaluate() {
        return allCatalogUnits().filter((u) => isNoSiPrefix(u.name)).map((u) => u.name);
    }
}

/** 6e / 7d: everything registered on any ladder. */
export class AllUnits extends LogicRule {
    evaluate() { return allLadderUnion(); }
}

/** 7a: ultra-standard units between two sizes (inclusive). */
export class UltraStandardBetween extends LogicRule {
    evaluate() { return unitsBetween(ULTRA_STANDARD, this.params.lo, this.params.hi); }
}

/** 7c: all-ladder units between two sizes (inclusive). */
export class AllLaddersBetween extends LogicRule {
    evaluate() { return unitsBetween(allLadderUnion(), this.params.lo, this.params.hi); }
}

/** 7c: current-ladder units without an SI prefix (when a ladder exists). */
export class CurrentLadderNoSiPrefix extends LogicRule {
    evaluate(ctx) {
        if (!ctx.ladderId) return [];
        return ladder(ctx.ladderId).names.filter((n) => isNoSiPrefix(n));
    }
}

/** 7c: SI-prefixed meter units on the current ladder (true-metric only). */
export class CurrentLadderSiPrefixedMeters extends LogicRule {
    evaluate(ctx) {
        if (ctx.ladderId !== LADDER_IDS.TRUE_METRIC) return [];
        return ladder(ctx.ladderId).names.filter((n) => {
            const u = getUnit(n);
            return u && u.siPrefixBase === "m" && hasSiPrefix(n);
        });
    }
}
