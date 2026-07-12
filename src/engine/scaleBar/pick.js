/**
 * applyUnitPick — constraint 5 / L5–L7 / L12 (no far-pin; user bands only).
 *
 * Order (Opus / finalist correction): find the ladders where the pick is the
 * AUTO-PREFERRED unit first, then take the highest priority among that subset
 * — never "highest owner then test preferred-ness there".
 *
 * L6 dest is always highestPriority(preferredLadders) — no stay-on-sticky
 * when sticky is a lower-priority ladder that also prefers the pick (I-15 / B.7).
 */

import { LADDER_PRIORITY, BAR_PX_MIN, BAR_PX_MAX, BAR_PX_TARGET } from "./constants";
import { laddersOwning, highestPriorityLadder } from "./membership";
import { buildUserBand, extraNiceFor } from "./preference";
import { resolveReading } from "./resolve";
import { bestInBoundsNice } from "./nice";
import { log10 } from "./logMath";
import { createSession } from "./session";

/**
 * @returns {{ session: ScaleSession, reading: ScaleReading }}
 */
export function applyUnitPick(pickedUnit, mpp, session) {
    let s = session || createSession();

    // L7 — any other-unit pick while a userBand is still active tears it down
    // first, then normal resolve runs. Under pool-exit I-02 the band can remain
    // active with tLog outside the install [logLo, logHi], so do not gate on
    // the stored interval alone.
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
        // L6 / B.7 / I-15: always highest priority among preferred ladders.
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
    // quantize the pick onto a nice in-bounds stop (never cold-search Planck),
    // and install a user preferred range from that stop through the unit's
    // standard band / far edge on the destination ladder.
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

    // Full bar-window headroom at install mpp (Hybrid B⁺): fine/target side
    // via BAR_PX_MIN and coarse side via BAR_PX_MAX, unioned with pick↔far.
    const logMpp = log10(mpp);
    const userBand = buildUserBand(dest, pickedUnit, niceStop.logLen, {
        logBarMin: log10(BAR_PX_MIN) + logMpp,
        logBarMax: log10(BAR_PX_MAX) + logMpp,
    });
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
