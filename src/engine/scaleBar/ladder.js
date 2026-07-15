/**
 * Ladder — one of the five inventories as a first-class object (bible §2). Owns
 * its rungs (in ascending physical order), priority, related-ladder ids, and its
 * per-unit StandardPreferenceRanges, and generates the in-bounds candidate stops
 * at a given mpp. The resolver, rungs, and pick layers ask a Ladder these
 * questions instead of threading `ladderId` through free functions.
 *
 * Physical truth (unit sizes) stays in catalog.js; the §5 band / handoff /
 * promote / far-edge DATA still lives in preference.js and is surfaced here as
 * methods, so there is one source of truth while the model is OOP.
 *
 * No import of resolve.js (which imports this) — candidate generation lives here
 * to keep the dependency acyclic.
 */

import { LADDER_IDS, LADDER_PRIORITY, BAR_PX_MIN, BAR_PX_MAX } from "./constants";
import { getUnit } from "./catalog";
import { LADDERS, RELATED_LADDERS } from "./membership";
import { bandFor, extraNiceFor } from "./preference";
import { StandardPreferenceRange } from "./preferenceRange";
import { niceValuesForUnit } from "./nice";
import { log10, safeExp10 } from "./logMath";

const REL_EPS = 1e-9;

export class Ladder {
    constructor(id) {
        this.id = id;
        this.rungs = LADDERS[id] || LADDERS[LADDER_IDS.TRUE_METRIC];
        this.priority = LADDER_PRIORITY.indexOf(id); // lower index = higher priority
        this._rank = new Map(this.rungs.map((r, i) => [r.name, i]));
    }

    get relatedIds() { return RELATED_LADDERS[this.id] || []; }
    get names() { return this.rungs.map((r) => r.name); }

    has(unit) { return this._rank.has(unit); }
    rankOf(unit) { return this._rank.has(unit) ? this._rank.get(unit) : -1; }
    floorUnit() { return this.rungs[0]?.name ?? null; }
    ceilingUnit() { return this.rungs[this.rungs.length - 1]?.name ?? null; }

    /** `down` rungs below then `up` rungs above `unit` (constraint 6c). */
    neighbors(unit, up = 1, down = 1) {
        const r = this.rankOf(unit);
        if (r < 0) return [];
        const out = [];
        for (let d = 1; d <= down; d++) if (r - d >= 0) out.push(this.rungs[r - d].name);
        for (let u = 1; u <= up; u++) if (r + u < this.rungs.length) out.push(this.rungs[r + u].name);
        return out;
    }

    /** Rungs within `factor`× of `unit` in physical size (constraint 6a/6b 50×). */
    unitsWithinFactor(unit, factor) {
        const c = getUnit(unit);
        if (!c) return [];
        const logLo = c.log10Meters - log10(factor);
        const logHi = c.log10Meters + log10(factor);
        return this.rungs
            .filter((r) => r.log10Meters >= logLo - 1e-12 && r.log10Meters <= logHi + 1e-12)
            .map((r) => r.name);
    }

    // ---- preference data (source of truth still preference.js) ----
    bandFor(unit) { return bandFor(this.id, unit); }
    extraNiceFor(unit) { return extraNiceFor(this.id, unit); }

    /** The §5 StandardPreferenceRange for `unit` on this ladder. */
    preferenceFor(unit) {
        const b = this.bandFor(unit);
        return new StandardPreferenceRange({ ladderId: this.id, unit, lo: b.lo, hi: b.hi });
    }

    /**
     * All grammar-legal stops on this ladder whose bar fits [BAR_PX_MIN,
     * BAR_PX_MAX] at `mpp`, on the log spine (float extremes never throw, L11).
     * (Verbatim port of the old resolve.candidatesOnLadder, now owned here.)
     */
    candidatesAt(mpp) {
        if (!(mpp > 0) || !Number.isFinite(mpp)) return [];
        const logMpp = log10(mpp);
        const logBarMin = log10(BAR_PX_MIN);
        const logBarMax = log10(BAR_PX_MAX);
        const stops = [];
        for (let rank = 0; rank < this.rungs.length; rank++) {
            const rung = this.rungs[rank];
            const logUnit = rung.log10Meters;
            if (!Number.isFinite(logUnit)) continue;
            const logMagLo = logBarMin + logMpp - logUnit;
            const logMagHi = logBarMax + logMpp - logUnit;
            if (logMagHi < -320 || logMagLo > 306) continue;
            const magLo = safeExp10(logMagLo);
            const magHi = safeExp10(logMagHi);
            const values = niceValuesForUnit(rung.name, {
                magLo: magLo * (1 - 1e-7),
                magHi: magHi * (1 + 1e-7),
                extraValues: this.extraNiceFor(rung.name),
            });
            for (const v of values) {
                const logLen = log10(v.value) + logUnit;
                const barPx = safeExp10(logLen - logMpp);
                if (!(barPx > 0) || !Number.isFinite(barPx)) continue;
                if (barPx < BAR_PX_MIN * (1 - REL_EPS) || barPx > BAR_PX_MAX * (1 + REL_EPS)) continue;
                stops.push({
                    ladderId: this.id,
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
}

// ---- registry: one shared Ladder per id ----
const registry = new Map();

/** The shared Ladder instance for an id (created once). */
export function ladder(id) {
    let l = registry.get(id);
    if (!l) {
        l = new Ladder(id);
        registry.set(id, l);
    }
    return l;
}

/** All five ladders in priority order (bible §2). */
export const ALL_LADDERS = LADDER_PRIORITY.map(ladder);
