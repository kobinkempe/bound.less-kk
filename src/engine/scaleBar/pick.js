/**
 * applyUnitPick — constraint 5 (user overrides).
 *
 * L6: if the picked unit is the AUTO-preferred unit on some ladder at this mpp,
 *     just switch to the highest-priority such ladder — no user range.
 * L5/L12: otherwise switch by ownership and install a UserPreferenceRange that
 *     spans `[min(current, flip-down), max(current, flip-up)]`, where the flip
 *     points are the edges of the unit's NATURAL auto-interval (where the auto
 *     rule would hand off to a finer / coarser unit). Those edges are derived
 *     from the resolver itself — there is no hardcoded far-edge table.
 * L7: any pick of a different unit tears down the active user range first.
 *
 * The installed range persists until a user action (see UserPreferenceRange);
 * zoom never clears it.
 */

import { LADDER_PRIORITY, BAR_PX_MIN, BAR_PX_MAX, BAR_PX_TARGET } from "./constants";
import { laddersOwning, highestPriorityLadder } from "./membership";
import { extraNiceFor, bandLogInterval } from "./preference";
import { UserPreferenceRange } from "./preferenceRange";
import { resolveReading } from "./resolve";
import { bestInBoundsNice } from "./nice";
import { unitLog10Meters } from "./catalog";
import { log10, safeExp10, targetLogLen } from "./logMath";
import { createSession } from "./session";

/**
 * The unit's natural auto-interval on a ladder: the log-length span over which
 * the AUTO rule (no user band, no incumbent) selects this unit. Its lower/upper
 * edges ARE the unit's flip-down / flip-up points (constraint 5). Scanned once
 * per pick (a user action), so the ~400-sample cost is irrelevant. Returns
 * `{ loLog, hiLog }` (padded by a step for inclusive re-entry) or null if the
 * unit is never auto-preferred on that ladder.
 */
function autoSpanForUnit(ladderId, unit) {
    const logUnit = unitLog10Meters(unit);
    if (!Number.isFinite(logUnit)) return null;
    const session = createSession(ladderId);
    const logTarget = log10(BAR_PX_TARGET);
    const step = 0.04;
    let loLog = null;
    let hiLog = null;
    for (let d = -8; d <= 8 + 1e-9; d += step) {
        const worldLog = logUnit + d; // reading ≈ 10^d of the unit
        const mpp = safeExp10(worldLog - logTarget);
        if (!(mpp > 0)) continue;
        const auto = resolveReading(mpp, session, {
            ladderId,
            ignoreUserBand: true,
            ignoreIncumbent: true,
        });
        if (auto && auto.unit === unit) {
            if (loLog === null) loLog = worldLog;
            hiLog = worldLog;
        }
    }
    if (loLog === null) return null;
    return { loLog: loLog - step, hiLog: hiLog + step };
}

/**
 * @returns {{ session: ScaleSession, reading: ScaleReading }}
 */
export function applyUnitPick(pickedUnit, mpp, session) {
    let s = session || createSession();

    // L7 — a different-unit pick tears down any active user range first.
    if (s.userBand && pickedUnit !== s.userBand.unit) {
        s = { ...s, userBand: null };
    }

    // L6 — ladders where the pick is the auto-preferred unit at this mpp
    // (clean probe: no user band, no incumbent).
    const preferredLadders = [];
    for (const ladderId of LADDER_PRIORITY) {
        const probe = resolveReading(mpp, createSession(ladderId), {
            ladderId,
            ignoreUserBand: true,
            ignoreIncumbent: true,
        });
        if (probe?.unit === pickedUnit) preferredLadders.push(ladderId);
    }
    if (preferredLadders.length) {
        // Preferred elsewhere → switch only (highest priority), no user range.
        const dest = highestPriorityLadder(preferredLadders);
        const reading = resolveReading(mpp, {
            ladderId: dest,
            userBand: null,
            incumbentUnit: pickedUnit,
            lastReading: null,
        }, { ignoreIncumbent: true });
        const next = {
            ladderId: dest,
            userBand: null,
            incumbentUnit: pickedUnit,
            lastReading: reading,
        };
        return { session: next, reading };
    }

    // L5 / L12 — non-preferred (or off-ladder) pick: switch by ownership,
    // quantize onto a nice in-bounds stop, and install a user range from the
    // current view to the unit's natural flip edges.
    const owners = laddersOwning(pickedUnit);
    const dest = owners.includes(s.ladderId)
        ? s.ladderId
        : highestPriorityLadder(owners);

    const niceStop = bestInBoundsNice(
        pickedUnit,
        mpp,
        BAR_PX_MIN,
        BAR_PX_MAX,
        BAR_PX_TARGET,
        extraNiceFor(dest, pickedUnit),
    );
    if (!niceStop) {
        // Unknown unit — keep the session untouched.
        const reading = resolveReading(mpp, s);
        return { session: s, reading };
    }

    const currentLog = targetLogLen(mpp);
    const span = autoSpanForUnit(dest, pickedUnit);
    let logLo;
    let logHi;
    if (span) {
        logLo = Math.min(currentLog, niceStop.logLen, span.loLog);
        logHi = Math.max(currentLog, niceStop.logLen, span.hiLog);
    } else {
        // Never auto-preferred (absorbed / edge unit): fall back to the §5 band.
        const bi = bandLogInterval(dest, pickedUnit);
        logLo = Math.min(currentLog, niceStop.logLen, Number.isFinite(bi.logLo) ? bi.logLo : currentLog);
        logHi = Math.max(currentLog, niceStop.logLen, Number.isFinite(bi.logHi) ? bi.logHi : currentLog);
    }
    const userBand = new UserPreferenceRange({ ladderId: dest, unit: pickedUnit, logLo, logHi });

    const reading = {
        value: niceStop.value,
        niceValue: niceStop.niceValue,
        unit: pickedUnit,
        barPx: niceStop.barPx,
        ladderId: dest,
        metersPerPx: mpp,
        logLen: niceStop.logLen,
        form: niceStop.form,
        reason: "user-band",
    };
    if (niceStop.displayLabel) reading.displayLabel = niceStop.displayLabel;
    if (niceStop.sciLabel) reading.sciLabel = niceStop.sciLabel;
    const next = {
        ladderId: dest,
        userBand,
        incumbentUnit: pickedUnit,
        lastReading: reading,
    };
    return { session: next, reading };
}
