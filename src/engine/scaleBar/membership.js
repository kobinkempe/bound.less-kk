/**
 * Ladder Membership — five inventories, priority, related (layer 07).
 * Must not: preferred magnitudes.
 */

import {
    LADDER_IDS,
    LADDER_PRIORITY,
} from "./constants";
import {
    SM_RUNGS,
    TM_RUNGS,
    SI_RUNGS,
    ULTRA_STANDARD_METRIC_NAMES,
    ULTRA_STANDARD_IMPERIAL_NAMES,
    getUnit,
} from "./catalog";

export { LADDER_IDS, LADDER_PRIORITY };

/** Bible §2 related-ladder table. */
export const RELATED_LADDERS = {
    [LADDER_IDS.ULTRA_STANDARD_IMPERIAL]: [
        LADDER_IDS.ULTRA_STANDARD_METRIC,
        LADDER_IDS.STANDARD_IMPERIAL,
    ],
    [LADDER_IDS.ULTRA_STANDARD_METRIC]: [
        LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
        LADDER_IDS.STANDARD_METRIC,
    ],
    [LADDER_IDS.STANDARD_METRIC]: [
        LADDER_IDS.ULTRA_STANDARD_METRIC,
        LADDER_IDS.TRUE_METRIC,
        LADDER_IDS.STANDARD_IMPERIAL,
    ],
    [LADDER_IDS.TRUE_METRIC]: [
        LADDER_IDS.ULTRA_STANDARD_METRIC,
        LADDER_IDS.STANDARD_METRIC,
        LADDER_IDS.STANDARD_IMPERIAL,
    ],
    [LADDER_IDS.STANDARD_IMPERIAL]: [
        LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
        LADDER_IDS.STANDARD_METRIC,
        LADDER_IDS.TRUE_METRIC,
    ],
};

function rungsFromNames(names) {
    return names.map((name) => {
        const u = getUnit(name);
        if (!u) throw new Error(`membership: unknown unit ${name}`);
        return {
            name,
            meters: u.meters,
            log10Meters: u.log10Meters,
            kind: u.kind,
            family: u.family,
        };
    });
}

function rungsFromBuilt(built) {
    return built.map((r) => ({
        name: r.name,
        meters: r.meters,
        log10Meters: getUnit(r.name)?.log10Meters ?? Math.log10(r.meters),
        kind: r.kind,
        family: r.family || r.kind,
    }));
}

export const LADDERS = {
    [LADDER_IDS.STANDARD_METRIC]: rungsFromBuilt(SM_RUNGS),
    [LADDER_IDS.TRUE_METRIC]: rungsFromBuilt(TM_RUNGS),
    [LADDER_IDS.STANDARD_IMPERIAL]: rungsFromBuilt(SI_RUNGS),
    [LADDER_IDS.ULTRA_STANDARD_METRIC]: rungsFromNames(ULTRA_STANDARD_METRIC_NAMES),
    [LADDER_IDS.ULTRA_STANDARD_IMPERIAL]: rungsFromNames(ULTRA_STANDARD_IMPERIAL_NAMES),
};

/** Owner map: unit → ladderIds in priority order. */
const ownersMap = new Map();

for (const ladderId of LADDER_PRIORITY) {
    const ladder = LADDERS[ladderId];
    for (const rung of ladder) {
        let owners = ownersMap.get(rung.name);
        if (!owners) {
            owners = [];
            ownersMap.set(rung.name, owners);
        }
        if (!owners.includes(ladderId)) owners.push(ladderId);
    }
}

export function ladderForStack(ladderId) {
    return LADDERS[ladderId] || LADDERS[LADDER_IDS.TRUE_METRIC];
}

export function unitRank(name, ladderOrId) {
    const ladder = typeof ladderOrId === "string" ? ladderForStack(ladderOrId) : ladderOrId;
    const i = ladder.findIndex((u) => u.name === name);
    return i >= 0 ? i : -1;
}

/** Ladders owning this unit, sorted by LADDER_PRIORITY. */
export function laddersOwning(unit) {
    const owners = ownersMap.get(unit);
    if (owners?.length) return owners.slice();
    return [];
}

/** Highest-priority ladder that owns the unit (L9 spirit). */
export function stackForUnit(unit) {
    const owners = laddersOwning(unit);
    if (owners.length) return owners[0];
    return LADDER_IDS.STANDARD_METRIC;
}

export function highestPriorityLadder(ladderIds) {
    for (const id of LADDER_PRIORITY) {
        if (ladderIds.includes(id)) return id;
    }
    return ladderIds[0] || LADDER_IDS.STANDARD_METRIC;
}

export function ladderNeighbors(unit, ladderId, up = 1, down = 1) {
    const ladder = ladderForStack(ladderId);
    const rank = unitRank(unit, ladder);
    if (rank < 0) return [];
    const out = [];
    for (let d = 1; d <= down; d++) {
        if (rank - d >= 0) out.push(ladder[rank - d].name);
    }
    for (let u = 1; u <= up; u++) {
        if (rank + u < ladder.length) out.push(ladder[rank + u].name);
    }
    return out;
}

export function unitsOnLadderWithinFactor(unit, ladderId, factor) {
    const center = getUnit(unit);
    if (!center) return [];
    const ladder = ladderForStack(ladderId);
    const logLo = center.log10Meters - Math.log10(factor);
    const logHi = center.log10Meters + Math.log10(factor);
    return ladder
        .filter((r) => r.log10Meters >= logLo - 1e-12 && r.log10Meters <= logHi + 1e-12)
        .map((r) => r.name);
}

export function floorUnit(ladderId) {
    const ladder = ladderForStack(ladderId);
    return ladder[0]?.name || null;
}

export function ceilingUnit(ladderId) {
    const ladder = ladderForStack(ladderId);
    return ladder[ladder.length - 1]?.name || null;
}

/** Ultra-standard union for the rung predicates (both ultra ladders). */
export const ULTRA_STANDARD = [
    ...new Set([
        ...ULTRA_STANDARD_METRIC_NAMES,
        ...ULTRA_STANDARD_IMPERIAL_NAMES,
    ]),
];
