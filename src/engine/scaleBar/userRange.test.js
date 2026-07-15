/**
 * applyUnitPick + user preferred ranges — constraint 5 (bible / owner-clarified).
 *
 * A user range spans `[min(current, flip-down), max(current, flip-up)]`, where
 * the flip points are the picked unit's NATURAL auto-interval edges (derived
 * from the resolver, no hardcoded far edge). It forces its unit inside that span
 * and PERSISTS until a user action — zoom never tears it down, and zooming out
 * and back re-shows the unit (sticky re-entry).
 */

import { resolveReading } from "./resolve";
import { applyUnitPick } from "./pick";
import {
    clearUserBandIfExited,
    shouldApplyScaleSessionWriteBack,
} from "./session";
import { computeScale } from "./index";
import {
    coldSession,
    mppForReading,
    expectBarInBounds,
    unitLog10Meters,
    targetLogLen,
    BAR_PX_TARGET,
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
        expect(held.unit).toBe("mi"); // forced across the span (100 ft is inside it)
    });

    test("span covers the current view down to the pick (fine-side headroom)", () => {
        // Pick mi while viewing ~1 in: current is far BELOW mi's natural band, so
        // the span extends down to include the current view.
        const mpp = mppForReading(1, "in");
        const { session: next, reading } = applyUnitPick("mi", mpp, coldSession("standard-imperial"));
        expect(reading.unit).toBe("mi");
        // logLo reaches at/below the current target length (so 'mi' shows here).
        expect(next.userBand.logLo).toBeLessThanOrEqual(targetLogLen(mpp) + 1e-9);
        // and the pick itself resolves as mi.
        const here = resolveReading(mpp, next, { ignoreIncumbent: true });
        expect(here.unit).toBe("mi");
    });

    test("L7: pick inside active user range clears it; a non-preferred pick installs a fresh range", () => {
        // At 300 yd, pick inches — not preferred on any ladder there, so L5
        // installs a fresh in range and the old yd range is torn down.
        const mpp = mppForReading(300, "yd");
        const session = {
            ladderId: "standard-imperial",
            userBand: {
                unit: "yd",
                ladderId: "standard-imperial",
                logLo: Math.log10(10) + unitLog10Meters("yd"),
                logHi: Math.log10(5000) + unitLog10Meters("yd"),
            },
            incumbentUnit: "yd",
            lastReading: null,
        };
        const { session: next, reading } = applyUnitPick("in", mpp, session);
        expect(next.userBand?.unit).not.toBe("yd"); // old range gone
        expect(next.userBand).not.toBeNull();
        expect(next.userBand.unit).toBe("in");
        expect(reading.unit).toBe("in");
    });

    test("L6: preferred-elsewhere pick switches ladder only (no user range) — 5 hm → m", () => {
        const mpp = mppForReading(5, "hm");
        const session = coldSession("true-metric");
        expect(resolveReading(mpp, session, { ignoreIncumbent: true }).ladderId).toBe("true-metric");
        const { session: next, reading } = applyUnitPick("m", mpp, session);
        expect(reading.unit).toBe("m");
        expect(next.ladderId).toBe("standard-metric");
        expect(next.userBand).toBeNull();
    });

    test("I-15 / L6: always highestPriority(preferredLadders) — no stay-on-sticky", () => {
        const mpp = mppForReading(1, "m");
        const { session: next, reading } = applyUnitPick("m", mpp, coldSession("true-metric"));
        expect(reading.unit).toBe("m");
        expect(next.ladderId).toBe("standard-metric");
        expect(next.userBand).toBeNull();
    });

    test("L5: off-ladder in pick from µm installs an imperial user range up to inches' flip", () => {
        const mpp = mppForReading(1, "µm");
        const { session: next, reading } = applyUnitPick("in", mpp, coldSession("standard-metric"));
        expect(reading.unit).toBe("in");
        expect(next.ladderId).toBe("standard-imperial");
        expect(next.userBand.unit).toBe("in");
        // span covers the current µm view…
        expect(next.userBand.logLo).toBeLessThanOrEqual(targetLogLen(mpp) + 1e-9);
        // …up through inches' natural region (well past 1 in, roughly the ft flip).
        expect(next.userBand.logHi).toBeGreaterThan(Math.log10(1) + unitLog10Meters("in"));
        expect(next.userBand.logHi).toBeLessThan(Math.log10(100) + unitLog10Meters("in"));
        // held inside the span; auto again far above it.
        expect(resolveReading(mppForReading(0.5, "in"), next, { ignoreIncumbent: true }).unit).toBe("in");
        expect(resolveReading(mppForReading(100, "ft"), next, { ignoreIncumbent: true }).unit).not.toBe("in");
    });

    test("L5: off-ladder ft from metric installs an imperial user range across ft's natural band", () => {
        const mpp = mppForReading(1, "cm");
        const { session: next, reading } = applyUnitPick("ft", mpp, coldSession("standard-metric"));
        expect(reading.unit).toBe("ft");
        expect(next.ladderId).toBe("standard-imperial");
        expect(next.userBand.unit).toBe("ft");
        // ft held at a mid-band ft zoom…
        expect(resolveReading(mppForReading(20, "ft"), next, { ignoreIncumbent: true }).unit).toBe("ft");
        // …its upper flip sits in the hundreds of feet (before yd/mi take over).
        expect(next.userBand.logHi).toBeGreaterThan(Math.log10(50) + unitLog10Meters("ft"));
    });

    test("A1: same-zoom computeScale keeps userBand when pick nice is coarser than target", () => {
        const scaleDef = { value: 1, unit: "in", barPx: BAR_PX_TARGET, zoomAt: 1 };
        let session = coldSession("standard-imperial");
        let bundle = computeScale(1, scaleDef, session);
        session = bundle.session;
        expect(bundle.reading.unit).toBe("in");

        const mpp = bundle.reading.metersPerPx;
        const picked = applyUnitPick("mi", mpp, session);
        expect(picked.reading.unit).toBe("mi");
        expect(picked.session.userBand).not.toBeNull();
        expect(picked.session.userBand.logLo).toBeLessThanOrEqual(targetLogLen(mpp) + 1e-9);

        session = { ...picked.session, lastReading: picked.reading };
        bundle = computeScale(1, scaleDef, session);
        expect(bundle.session.userBand).not.toBeNull();
        expect(bundle.session.userBand.unit).toBe("mi");
        expect(bundle.reading.unit).toBe("mi");
        expect(bundle.reading.reason).toBe("user-band");
    });

    test("A2: after L5 pick, tiny zoom-in/out keeps band + unit", () => {
        const scaleDef = { value: 1, unit: "cm", barPx: BAR_PX_TARGET, zoomAt: 1 };
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

    test("sticky: a user range PERSISTS across a big zoom-out and re-shows on zoom-back", () => {
        // Pick dm on true-metric at ~1 cm; dm is forced across its natural band.
        const cmMpp = mppForReading(1, "cm");
        const { session: withDm } = applyUnitPick("dm", cmMpp, coldSession("true-metric"));
        expect(withDm.userBand?.unit).toBe("dm");

        // Zoom WAY out — dm leaves its span, auto takes over, but band persists.
        const qpcMpp = mppForReading(1, "Qpc");
        const kept = clearUserBandIfExited(withDm, qpcMpp);
        expect(kept.userBand).not.toBeNull(); // never torn down by zoom
        const far = resolveReading(qpcMpp, kept, { ignoreIncumbent: true });
        expect(far.unit).not.toBe("dm"); // auto out there

        // Zoom back to ~1 cm — sticky re-entry: dm returns.
        const back = resolveReading(cmMpp, kept, { ignoreIncumbent: true });
        expectBarInBounds(back);
        expect(back.unit).toBe("dm");
        expect(back.reason).toBe("user-band");
    });

    test("sticky via computeScale round-trip (editor-style)", () => {
        const scaleDef = { value: 1, unit: "cm", barPx: BAR_PX_TARGET, zoomAt: 100 };
        const cmMpp = mppForReading(1, "cm");
        const qpcMpp = mppForReading(1, "Qpc");
        const zQpc = 100 * (cmMpp / qpcMpp);

        const { session: withDm } = applyUnitPick("dm", cmMpp, coldSession("true-metric"));
        expect(withDm.userBand?.unit).toBe("dm");

        const atQpc = computeScale(zQpc, scaleDef, withDm);
        expect(atQpc.session.userBand).not.toBeNull(); // persists
        expect(atQpc.reading.unit).not.toBe("dm");

        const back = computeScale(100, scaleDef, atQpc.session);
        expect(back.session.userBand?.unit).toBe("dm");
        expect(back.reading.unit).toBe("dm"); // sticky re-entry
    });

    test("user range outranks the standard band while inside its span", () => {
        const session = {
            ladderId: "standard-imperial",
            userBand: {
                unit: "yd",
                ladderId: "standard-imperial",
                logLo: Math.log10(10) + unitLog10Meters("yd"),
                logHi: Math.log10(5000) + unitLog10Meters("yd"),
            },
            incumbentUnit: "yd",
            lastReading: null,
        };
        const held = resolveReading(mppForReading(500, "yd"), session, { ignoreIncumbent: true });
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

    test("A6: stale unbanded next must not wipe fresher banded session", () => {
        const banded = {
            ladderId: "true-metric",
            userBand: { unit: "dm", ladderId: "true-metric", logLo: -2, logHi: 0 },
            incumbentUnit: "dm",
            lastReading: { unit: "dm", value: 1 },
        };
        const prePick = coldSession("true-metric");
        const staleNext = { ...prePick, incumbentUnit: "cm", lastReading: { unit: "cm", value: 1 } };
        expect(shouldApplyScaleSessionWriteBack(banded, staleNext, { sourceSession: prePick })).toBe(false);
        expect(shouldApplyScaleSessionWriteBack(banded, staleNext, {})).toBe(false);
        const clearedFromCurrent = { ...banded, userBand: null };
        expect(shouldApplyScaleSessionWriteBack(banded, clearedFromCurrent, { sourceSession: banded })).toBe(true);
    });
});
