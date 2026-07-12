/**
 * applyUnitPick + user preferred ranges — L5, L6, L7, L12 (no far-pin).
 * Hybrid B⁺ install headroom + A6 write-back + Proposal A pool-exit (I-02).
 */

import { resolveReading } from "./resolve";
import { applyUnitPick } from "./pick";
import {
    clearUserBandIfExited,
    shouldApplyScaleSessionWriteBack,
} from "./session";
import { buildUserBand } from "./preference";
import { computeScale } from "./index";
import { log10 } from "./logMath";
import {
    coldSession,
    mppForReading,
    expectBarInBounds,
    unitLog10Meters,
    targetLogLen,
    BAR_PX_TARGET,
    BAR_PX_MIN,
} from "./testSupport";

describe("scaleBar/applyUnitPick + userBand", () => {
    test("L12: distant mi pick from 1 in installs user range; ft/yd suppressed while active", () => {
        const mpp = mppForReading(1, "in");
        const session = coldSession("standard-imperial");
        const { session: next, reading } = applyUnitPick("mi", mpp, session);

        expect(reading.unit).toBe("mi");
        expect(next.ladderId).toBe("standard-imperial");
        expect(next.userBand).not.toBeNull();
        expect(next.userBand.unit).toBe("mi");
        expect(next.userBand.ladderId).toBe("standard-imperial");
        expect(next.userBand.logHi).toBeGreaterThan(next.userBand.logLo);

        const landMpp = mppForReading(100, "ft");
        const held = resolveReading(landMpp, next, { ignoreIncumbent: true });
        expectBarInBounds(held);
        expect(held.unit).toBe("mi");
        expect(held.unit).not.toBe("ft");
        expect(held.unit).not.toBe("yd");
    });

    test("L12: userBand logLo uses install bar-min headroom (not Planck cold-search)", () => {
        const mpp = mppForReading(1, "in");
        const { session: next, reading } = applyUnitPick(
            "mi",
            mpp,
            coldSession("standard-imperial"),
        );
        expect(reading.unit).toBe("mi");
        expect(Number.isFinite(reading.value)).toBe(true);
        expect(reading.value).toBeGreaterThan(0);
        const pickLog = Math.log10(reading.value) + unitLog10Meters("mi");
        const logBarMin = log10(BAR_PX_MIN) + log10(mpp);
        // Hybrid B⁺: fine-side headroom — logLo ≤ pick and ≤ bar-min at install.
        expect(next.userBand.logLo).toBeLessThanOrEqual(pickLog + 1e-9);
        expect(next.userBand.logLo).toBeCloseTo(
            Math.min(pickLog, logBarMin),
            4,
        );
        // Still not cold-search Planck.
        expect(next.userBand.logLo).toBeGreaterThan(-40);
    });

    test("I-08: buildUserBand is min/max(pick, far) only — no band.lo union", () => {
        const pickLog = Math.log10(1e-5) + unitLog10Meters("mi");
        const band = buildUserBand("standard-imperial", "mi", pickLog);
        const farLog = Math.log10(2000) + unitLog10Meters("mi");
        expect(band.logLo).toBeCloseTo(pickLog, 6);
        expect(band.logHi).toBeCloseTo(farLog, 6);
        // Must not expand down to standard mi band.lo (0.5).
        const bandLoLog = Math.log10(0.5) + unitLog10Meters("mi");
        expect(band.logLo).toBeLessThan(bandLoLog - 1);
    });

    test("A9 / builder: logBarMin+logBarMax union outside pick↔far; still no §5 band.lo", () => {
        const pickLog = Math.log10(1) + unitLog10Meters("mi");
        const farLog = Math.log10(2000) + unitLog10Meters("mi");
        const logBarMin = pickLog - 0.5;
        const logBarMax = farLog + 0.25;
        const band = buildUserBand("standard-imperial", "mi", pickLog, {
            logBarMin,
            logBarMax,
        });
        expect(band.logLo).toBeCloseTo(logBarMin, 6);
        expect(band.logHi).toBeCloseTo(logBarMax, 6);
        const bandLoLog = Math.log10(0.5) + unitLog10Meters("mi");
        // Bar-window headroom ≠ preferred-band lo (I-08).
        expect(band.logLo).not.toBeCloseTo(bandLoLog, 1);
    });

    test("UP1: yd userBand far edge is 5000 (owner/catalog)", () => {
        const pickLog = Math.log10(200) + unitLog10Meters("yd");
        const band = buildUserBand("standard-imperial", "yd", pickLog);
        const farLog = Math.log10(5000) + unitLog10Meters("yd");
        expect(band.logHi).toBeCloseTo(farLog, 6);
    });

    test("L7: pick inside active user range clears entire range, then normal resolve", () => {
        // L7 tears down the old yd range; at 300 yd zoom, ft is not auto-preferred
        // on any ladder, so L5 installs a fresh ft user range (bible wins).
        const mpp = mppForReading(300, "yd");
        const session = {
            ladderId: "standard-imperial",
            userBand: {
                unit: "yd",
                ladderId: "standard-imperial",
                logLo: Math.log10(200) + unitLog10Meters("yd"),
                logHi: Math.log10(5000) + unitLog10Meters("yd"),
            },
            incumbentUnit: "yd",
            lastReading: null,
        };

        const { session: next, reading } = applyUnitPick("ft", mpp, session);
        expect(next.userBand?.unit).not.toBe("yd");
        expect(next.userBand).not.toBeNull();
        expect(next.userBand.unit).toBe("ft");
        expect(next.userBand.logHi).toBeGreaterThan(next.userBand.logLo);
        expect(reading.unit).toBe("ft");
        expect(next.ladderId).toBe("standard-imperial");
    });

    test("L6: preferred-elsewhere pick switches ladder only (no user range) — 5 hm → m", () => {
        const mpp = mppForReading(5, "hm");
        const session = coldSession("true-metric");
        const before = resolveReading(mpp, session, { ignoreIncumbent: true });
        expect(before.ladderId).toBe("true-metric");

        const { session: next, reading } = applyUnitPick("m", mpp, session);
        expect(reading.unit).toBe("m");
        expect(next.ladderId).toBe("standard-metric");
        expect(next.userBand).toBeNull();
    });

    test("I-15 / L6: always highestPriority(preferredLadders) — no stay-on-sticky", () => {
        // Sticky true-metric (lower priority); m is preferred on TM and SM → SM wins.
        const mpp = mppForReading(1, "m");
        const session = coldSession("true-metric");
        const { session: next, reading } = applyUnitPick("m", mpp, session);
        expect(reading.unit).toBe("m");
        expect(next.ladderId).toBe("standard-metric");
        expect(next.userBand).toBeNull();
    });

    test("L5: non-preferred / off-ladder pick installs user range from nice → far edge", () => {
        const mpp = mppForReading(1, "µm");
        const session = coldSession("standard-metric");
        const { session: next, reading } = applyUnitPick("in", mpp, session);

        expect(reading.unit).toBe("in");
        expect(next.ladderId).toBe("standard-imperial");
        expect(next.userBand).not.toBeNull();
        expect(next.userBand.unit).toBe("in");
        expect(next.userBand.ladderId).toBe("standard-imperial");
        expect(next.userBand.logHi).toBeGreaterThan(next.userBand.logLo);

        const logAt10in = Math.log10(10) + unitLog10Meters("in");
        expect(next.userBand.logHi).toBeCloseTo(logAt10in, 2);
    });

    test("L5: off-ladder ft from metric installs imperial user range to ft band edge", () => {
        const mpp = mppForReading(1, "cm");
        const session = coldSession("standard-metric");
        const { session: next, reading } = applyUnitPick("ft", mpp, session);

        expect(reading.unit).toBe("ft");
        expect(next.ladderId).toBe("standard-imperial");
        expect(next.userBand).not.toBeNull();
        expect(next.userBand.unit).toBe("ft");
        const logAt500ft = Math.log10(500) + unitLog10Meters("ft");
        expect(next.userBand.logHi).toBeCloseTo(logAt500ft, 2);
    });

    test("A1: same-zoom computeScale keeps userBand when pick nice is coarser than target", () => {
        // mi @ 1 in: quantized nice often sits above BAR_PX_TARGET → pickLog > tLog.
        // Without logBarMin, I-02 would clear on the first post-pick computeScale.
        const scaleDef = {
            value: 1,
            unit: "in",
            barPx: BAR_PX_TARGET,
            zoomAt: 1,
        };
        let session = coldSession("standard-imperial");
        let bundle = computeScale(1, scaleDef, session);
        session = bundle.session;
        expect(bundle.reading.unit).toBe("in");

        const mpp = bundle.reading.metersPerPx;
        const picked = applyUnitPick("mi", mpp, session);
        expect(picked.reading.unit).toBe("mi");
        expect(picked.reading.barPx).toBeGreaterThan(BAR_PX_TARGET);
        expect(picked.reading.logLen).toBeGreaterThan(targetLogLen(mpp));
        expect(picked.session.userBand).not.toBeNull();
        expect(picked.session.userBand.logLo).toBeLessThanOrEqual(
            targetLogLen(mpp) + 1e-9,
        );

        session = { ...picked.session, lastReading: picked.reading };
        bundle = computeScale(1, scaleDef, session);
        expect(bundle.session.userBand).not.toBeNull();
        expect(bundle.session.userBand.unit).toBe("mi");
        expect(bundle.reading.unit).toBe("mi");
        expect(bundle.reading.reason).toBe("user-band");
    });

    test("A2: after L5 pick, tiny zoom-in/out within bar headroom keeps band + unit", () => {
        const scaleDef = {
            value: 1,
            unit: "cm",
            barPx: BAR_PX_TARGET,
            zoomAt: 1,
        };
        let session = coldSession("true-metric");
        let bundle = computeScale(1, scaleDef, session);
        const picked = applyUnitPick("dm", bundle.reading.metersPerPx, bundle.session);
        expect(picked.session.userBand?.unit).toBe("dm");
        session = { ...picked.session, lastReading: picked.reading };

        for (const z of [1 * (1 + 1e-6), 1 * (1 - 1e-6), 1.001, 0.999, 1.01, 0.99]) {
            bundle = computeScale(z, scaleDef, session);
            expect(bundle.session.userBand?.unit).toBe("dm");
            expect(bundle.reading.unit).toBe("dm");
            session = bundle.session;
        }
    });

    test("A-pool: dm sticks past B⁺ bar-min ceiling using KobinEngine wheel notches", () => {
        // KobinEngine.zoomAt: factor = 2^(-deltaY/1000). Common mouse notch = 100.
        // B⁺ interval I-02 cleared at zoom-in ≈ BAR_PX_TARGET/BAR_PX_MIN = 2×.
        // One trackpad flick (cum Δ≈1000) is already 2× — so B⁺ feels "not sticky".
        const WHEEL_NOTCH_DELTA_Y = 100;
        const wheelInFactor = Math.pow(2, WHEEL_NOTCH_DELTA_Y / 1000);
        expect(wheelInFactor).toBeCloseTo(Math.pow(2, 0.1), 10);

        const scaleDef = {
            value: 1,
            unit: "cm",
            barPx: BAR_PX_TARGET,
            zoomAt: 1,
        };
        let session = coldSession("true-metric");
        let bundle = computeScale(1, scaleDef, session);
        const picked = applyUnitPick("dm", bundle.reading.metersPerPx, bundle.session);
        expect(picked.session.userBand?.unit).toBe("dm");
        session = { ...picked.session, lastReading: picked.reading };

        const bPlusCeiling = BAR_PX_TARGET / BAR_PX_MIN; // 2
        let z = 1;
        let notches = 0;
        while (z < bPlusCeiling * 1.25) {
            z *= wheelInFactor;
            notches += 1;
            bundle = computeScale(z, scaleDef, session);
            expect(bundle.session.userBand?.unit).toBe("dm");
            expect(bundle.reading.unit).toBe("dm");
            expect(bundle.reading.reason).toBe("user-band");
            session = bundle.session;
        }
        expect(z).toBeGreaterThan(bPlusCeiling);
        expect(notches).toBeGreaterThanOrEqual(10);
    });

    test("I-02 / S2 / A3: dm userBand tears down on range exit — zoom-back is cm/mm not sticky dm", () => {
        const cmMpp = mppForReading(1, "cm");
        const session = coldSession("true-metric");
        const { session: withDm } = applyUnitPick("dm", cmMpp, session);
        expect(withDm.userBand).not.toBeNull();
        expect(withDm.userBand.unit).toBe("dm");
        expect(withDm.ladderId).toBe("true-metric");

        // Leave the user range (Qpc is far outside pick↔far for dm).
        const qpcMpp = mppForReading(1, "Qpc");
        const afterExit = clearUserBandIfExited(withDm, qpcMpp);
        expect(afterExit.userBand).toBeNull();

        // Zoom back to ~1 cm — must not re-capture dm via sticky userBand.
        const back = resolveReading(cmMpp, afterExit, { ignoreIncumbent: true });
        expectBarInBounds(back);
        expect(back.unit).not.toBe("dm");
        expect(["mm", "cm"]).toContain(back.unit);
        expect(back.ladderId).toBe("true-metric");
    });

    test("user range outranks standard band while active", () => {
        const session = {
            ladderId: "standard-imperial",
            userBand: {
                unit: "yd",
                ladderId: "standard-imperial",
                logLo: Math.log10(200) + unitLog10Meters("yd"),
                logHi: Math.log10(5000) + unitLog10Meters("yd"),
            },
            incumbentUnit: "yd",
            lastReading: null,
        };
        const ydMpp = mppForReading(500, "yd");
        const held = resolveReading(ydMpp, session, { ignoreIncumbent: true });
        expect(held.unit).toBe("yd");
        expect(held.reason).toBe("user-band");
    });

    test("L12: no far-pin — distant pick is userBand only (session has no pinMode)", () => {
        const mpp = mppForReading(1, "in");
        const { session: next } = applyUnitPick("mi", mpp, coldSession("standard-imperial"));
        expect(next.userBand).not.toBeNull();
        expect(next).not.toHaveProperty("pinMode");
        expect(Object.keys(next).sort()).toEqual(
            ["incumbentUnit", "ladderId", "lastReading", "userBand"].sort(),
        );
    });

    test("A8: pick am from 5 pm — HUD stays am (coarse headroom survives tiny zoom-out)", () => {
        const scaleDef = {
            value: 5,
            unit: "pm",
            barPx: BAR_PX_TARGET,
            zoomAt: 1,
        };
        let session = coldSession("standard-metric");
        let bundle = computeScale(1, scaleDef, session);
        session = bundle.session;
        expect(bundle.reading.unit).toBe("pm");

        const picked = applyUnitPick("am", bundle.reading.metersPerPx, session);
        expect(picked.reading.unit).toBe("am");
        expect(picked.session.userBand?.unit).toBe("am");
        // Coarse end must reach bar-max log-length, not sit exactly on the pick.
        expect(picked.session.userBand.logHi).toBeGreaterThan(
            picked.reading.logLen,
        );

        session = { ...picked.session, lastReading: picked.reading };
        bundle = computeScale(1, scaleDef, session);
        expect(bundle.reading.unit).toBe("am");

        // Previously I-02 tore down on ~1e-6 zoom-out and HUD snapped back to pm.
        bundle = computeScale(1 * (1 - 1e-6), scaleDef, bundle.session);
        expect(bundle.reading.unit).toBe("am");
        expect(bundle.session.userBand?.unit).toBe("am");
    });

    test("A6: stale unbanded next must not wipe fresher banded session", () => {
        const banded = {
            ladderId: "true-metric",
            userBand: {
                unit: "dm",
                ladderId: "true-metric",
                logLo: -2,
                logHi: 0,
            },
            incumbentUnit: "dm",
            lastReading: { unit: "dm", value: 1 },
        };
        const prePick = coldSession("true-metric");
        const staleNext = {
            ...prePick,
            incumbentUnit: "cm",
            lastReading: { unit: "cm", value: 1 },
        };
        // Closed-over next from older hudBundle (sourceSession !== live s).
        expect(
            shouldApplyScaleSessionWriteBack(banded, staleNext, {
                sourceSession: prePick,
            }),
        ).toBe(false);

        // Fail closed: missing sourceSession must not wipe a live band.
        expect(
            shouldApplyScaleSessionWriteBack(banded, staleNext, {}),
        ).toBe(false);

        // True I-02 clear from computeScale on the current banded session.
        const clearedFromCurrent = { ...banded, userBand: null };
        expect(
            shouldApplyScaleSessionWriteBack(banded, clearedFromCurrent, {
                sourceSession: banded,
            }),
        ).toBe(true);
    });
});
