/**
 * Absolute resolveReading — locked decisions L1, L3, L4, L8, L9 (+ prefer-≥1 / ultra absorption).
 * Coalesced cases are target-mpp only (L1); lastReading stays null / display-only.
 *
 * L2 enter ~5% (HYSTERESIS_ENTER_PAST_EDGE) is wired; handoff/promote still override.
 */

import { resolveReading, pastIncumbentEnterEdge } from "./resolve";
import { clearDisplayPrefs, createSession } from "./session";
import { computeScale, applyUnitPick } from "./index";
import { HYSTERESIS_ENTER_PAST_EDGE } from "./constants";
import { bandFor, bandLogInterval } from "./preference";
import { log10 } from "./logMath";
import {
    coldSession,
    mppForReading,
    mppWhereBothFit,
    worldMeters,
    expectBarInBounds,
    BAR_PX_TARGET,
    BAR_PX_MIN,
    BAR_PX_MAX,
} from "./testSupport";

describe("scaleBar/resolveReading", () => {
    test("L3: at ft∩yd overlap, 200 yd wins over 500 ft (standard-imperial)", () => {
        const mpp = mppWhereBothFit(
            { niceValue: 200, unit: "yd", worldM: worldMeters(200, "yd") },
            { niceValue: 500, unit: "ft", worldM: worldMeters(500, "ft") },
        );
        const reading = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).toBe("yd");
        expect(reading.value).toBe(200);
        expect(reading.ladderId).toBe("standard-imperial");
    });

    test("L4: ultra-standard imperial — when 0.25 mi fits, mi wins over ft", () => {
        const mpp = mppForReading(0.25, "mi", 90);
        const reading = resolveReading(mpp, coldSession("ultra-standard-imperial"), {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).toBe("mi");
        expect(reading.value).toBeCloseTo(0.25, 6);
        expect(reading.ladderId).toBe("ultra-standard-imperial");
    });

    test("L8: sticky ladder through shared Qpc — never re-derives via stackForUnit", () => {
        const session = coldSession("true-metric");
        const mpp = mppForReading(1, "Qpc");
        const reading = resolveReading(mpp, session, { ignoreIncumbent: true });
        expectBarInBounds(reading);
        expect(reading.ladderId).toBe("true-metric");
        expect(reading.unit).toBe("Qpc");
        expect(session.ladderId).toBe("true-metric");
    });

    test("L8: zoom back from Qpc on true-metric stays true-metric (no R☉ / standard-only)", () => {
        const session = coldSession("true-metric");
        const coarse = mppForReading(1, "Qpc");
        const atQpc = resolveReading(coarse, session, { ignoreIncumbent: true });
        expect(atQpc.ladderId).toBe("true-metric");

        const land = mppForReading(1, "m");
        const back = resolveReading(land, { ...session, incumbentUnit: null }, {
            ignoreIncumbent: true,
        });
        expect(back.ladderId).toBe("true-metric");
        expect(back.unit).not.toBe("R☉");
        expect(back.unit).not.toBe("Tpc");
        expect(["mm", "cm", "dm", "m", "dam", "hm", "km"]).toContain(back.unit);
    });

    test("L9: clearDisplayPrefs / set-scale of multi-owner Qpc → standard-metric", () => {
        const prior = {
            ladderId: "true-metric",
            userBand: {
                unit: "hm",
                ladderId: "true-metric",
                logLo: -1,
                logHi: 2,
            },
            incumbentUnit: "hm",
            lastReading: null,
        };
        const scaleDef = { value: 1, unit: "Qpc", barPx: BAR_PX_TARGET, zoomAt: 100 };
        const cleared = clearDisplayPrefs(prior, scaleDef);
        expect(cleared.ladderId).toBe("standard-metric");
        expect(cleared.userBand).toBeNull();
        expect(cleared.incumbentUnit).toBeNull();
    });

    test("L1: coalesced jump is target-only — destination mpp yields ft (no walk trace)", () => {
        const targetMpp = mppForReading(2, "ft");
        const reading = resolveReading(targetMpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).toBe("ft");
        expect(reading.value).toBeGreaterThanOrEqual(1);
        expect(reading.value).toBeLessThanOrEqual(10);
    });

    test("L1: large single-frame Δmpp from inch land to few-feet target still lands on ft", () => {
        const session = coldSession("standard-imperial");
        const destMpp = mppForReading(5, "ft");
        const reading = resolveReading(destMpp, session, { ignoreIncumbent: true });
        expect(reading.unit).toBe("ft");
        expect(reading.ladderId).toBe("standard-imperial");
    });

    test("absolute resolve ignores lastReading for unit choice (display-only)", () => {
        const mpp = mppForReading(200, "yd");
        const session = {
            ...coldSession("standard-imperial"),
            lastReading: { value: 10, unit: "in", barPx: 120, ladderId: "standard-imperial" },
        };
        const reading = resolveReading(mpp, session, { ignoreIncumbent: true });
        expect(reading.unit).toBe("yd");
        expect(reading.value).toBe(200);
    });

    test("I-01 / T-F1: prefer ≥1 promote — 1 ft wins while 10 in still fits", () => {
        // At BAR_PX_TARGET for 1 ft, 10 in still fits the bar but is outside the
        // preferred in band (1/16–1); promoteNextGe1 demotes in so cold lands on 1 ft.
        const mpp = mppForReading(1, "ft", BAR_PX_TARGET);
        const reading = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).toBe("ft");
        expect(reading.value).toBe(1);
        // Sanity: 10 in still fits the bar at this mpp.
        const tenInBar = (10 * worldMeters(1, "in")) / mpp;
        expect(tenInBar).toBeGreaterThanOrEqual(60);
        expect(tenInBar).toBeLessThanOrEqual(180);
    });

    test("constraint 4.3: prefer ≥1 next unit — feet when large inches no longer fit the bar", () => {
        // At BAR_PX_MIN for 1 ft, inches drop out of bounds; resolve stays on feet.
        const mpp = mppForReading(1, "ft", 60);
        const reading = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).toBe("ft");
        expect(reading.value).toBeGreaterThanOrEqual(1);
        expect(reading.unit).not.toBe("in");
        expect(reading.unit).not.toBe("yd");
    });

    test("ultra absorption: no yd on ultra-imperial — land band resolves to ft (not yd)", () => {
        const mpp = mppForReading(200, "yd");
        const reading = resolveReading(mpp, coldSession("ultra-standard-imperial"), {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).not.toBe("yd");
        expect(["ft", "mi"]).toContain(reading.unit);
        expect(reading.ladderId).toBe("ultra-standard-imperial");
    });

    test("façade computeScale(effectiveZoom, scaleDef, session) returns reading + session", () => {
        const scaleDef = { value: 1, unit: "m", barPx: BAR_PX_TARGET, zoomAt: 100 };
        const session = createSession("standard-metric");
        const { reading, session: next } = computeScale(100, scaleDef, session, {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).toBe("m");
        expect(reading.value).toBe(1);
        expect(next.ladderId).toBe("standard-metric");
        expect(next.lastReading).toEqual(reading);
        expect(next.incumbentUnit).toBe("m");
    });

    test("ZS-02: m↔km same-mpp up vs down agree on 1 km (promoteNextGe1)", () => {
        const mpp = mppForReading(1, "km", BAR_PX_TARGET);
        const cold = resolveReading(mpp, coldSession("standard-metric"), {
            ignoreIncumbent: true,
        });
        const fromM = resolveReading(mpp, {
            ...coldSession("standard-metric"),
            incumbentUnit: "m",
        });
        const fromKm = resolveReading(mpp, {
            ...coldSession("standard-metric"),
            incumbentUnit: "km",
        });
        expectBarInBounds(cold);
        expect(cold.unit).toBe("km");
        expect(cold.value).toBe(1);
        expect(fromM.unit).toBe(cold.unit);
        expect(fromM.value).toBe(cold.value);
        expect(fromKm.unit).toBe(cold.unit);
        expect(fromKm.value).toBe(cold.value);
    });

    test("ZS-02: yd↔0.5 mi same-mpp up vs down agree on 0.5 mi (handoff)", () => {
        const mpp = mppForReading(0.5, "mi", BAR_PX_TARGET);
        const cold = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        const fromYd = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "yd",
        });
        const fromMi = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "mi",
        });
        expectBarInBounds(cold);
        expect(cold.unit).toBe("mi");
        expect(cold.value).toBeCloseTo(0.5, 6);
        expect(fromYd.unit).toBe(cold.unit);
        expect(fromYd.value).toBeCloseTo(cold.value, 6);
        expect(fromMi.unit).toBe(cold.unit);
        expect(fromMi.value).toBeCloseTo(cold.value, 6);
    });

    test("ZS-02 / I-01: µm↔mil flip at 1 mil (promoteNextGe1), not µm band hi ≈ 20 mil", () => {
        // 500 µm ≈ 19.7 mil — without µm→mil promote/handoff, L2 enter held
        // incumbent µm until that band edge. At 1 mil, mil must win both ways.
        const mpp = mppForReading(1, "mil", BAR_PX_TARGET);
        const cold = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        const fromUm = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "µm",
        });
        const fromMil = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "mil",
        });
        expectBarInBounds(cold);
        expect(cold.unit).toBe("mil");
        expect(cold.value).toBe(1);
        expect(fromUm.unit).toBe("mil");
        expect(fromUm.value).toBe(1);
        expect(fromMil.unit).toBe("mil");
        expect(fromMil.value).toBe(1);
        // Sanity: ~25 µm still fits the bar at this mpp (µm band still hits).
        const umBar = (25 * worldMeters(1, "µm")) / mpp;
        expect(umBar).toBeGreaterThanOrEqual(BAR_PX_MIN);
        expect(umBar).toBeLessThanOrEqual(BAR_PX_MAX);
    });

    test("handoff mil over µm: mid-band mil wins even when 1 mil is out of bar pool", () => {
        // At 5 mil target, 1 mil bar ≈ 24px < BAR_PX_MIN — promote alone cannot
        // fire; mil↔µm handoff still demotes µm bandHits through the overlap.
        const mpp = mppForReading(5, "mil", BAR_PX_TARGET);
        const fromUm = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "µm",
        });
        expectBarInBounds(fromUm);
        expect(fromUm.unit).toBe("mil");
        expect(fromUm.value).toBe(5);
    });

    test("I-01: below 1 mil, mil loses — µm wins cold and with mil incumbent", () => {
        const mpp = mppForReading(10, "µm", BAR_PX_TARGET);
        const cold = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        const fromMil = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "mil",
        });
        expectBarInBounds(cold);
        expect(cold.unit).toBe("µm");
        expect(fromMil.unit).toBe("µm");
    });

    test("preferred bands: standard-imperial mil 1–50, in 1/16–1", () => {
        expect(bandFor("standard-imperial", "mil")).toEqual({ lo: 1, hi: 50 });
        expect(bandFor("standard-imperial", "in").lo).toBeCloseTo(1 / 16, 10);
        expect(bandFor("standard-imperial", "in").hi).toBe(1);
    });

    test("ZS-mil-in: at 1/16 in mpp, cold + mil/in incumbents agree on 1/16 in (not 50/20 mil)", () => {
        const mpp = mppForReading(1 / 16, "in", BAR_PX_TARGET);
        const cold = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        const fromMil = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "mil",
        });
        const fromIn = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "in",
        });
        expectBarInBounds(cold);
        expect(cold.unit).toBe("in");
        expect(cold.value).toBeCloseTo(1 / 16, 10);
        expect(fromMil.unit).toBe(cold.unit);
        expect(fromMil.value).toBeCloseTo(cold.value, 10);
        expect(fromIn.unit).toBe(cold.unit);
        expect(fromIn.value).toBeCloseTo(cold.value, 10);
    });

    test("ZS-mil-in: at 50 mil ideal-target mpp, handoff yields 1/16 in (symmetric)", () => {
        // 50 mil @ 120px and 1/16 in @ 150px both fit; in-over-mil handoff picks inches.
        // (preferGe1 alone would keep mil forever through fraction overlap → 1/8 skip.)
        const mpp = mppForReading(50, "mil", BAR_PX_TARGET);
        const cold = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        const fromMil = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "mil",
        });
        const fromIn = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "in",
        });
        expectBarInBounds(cold);
        expect(cold.unit).toBe("in");
        expect(cold.value).toBeCloseTo(1 / 16, 10);
        expect(fromMil.unit).toBe(cold.unit);
        expect(fromMil.value).toBeCloseTo(cold.value, 10);
        expect(fromIn.unit).toBe(cold.unit);
        expect(fromIn.value).toBeCloseTo(cold.value, 10);
    });

    test("ZS-mil-in: at 20 mil mpp, mil wins (1/16 out of bar) — cold = incumbents", () => {
        const mpp = mppForReading(20, "mil", BAR_PX_TARGET);
        const cold = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        const fromMil = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "mil",
        });
        const fromIn = resolveReading(mpp, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "in",
        });
        expectBarInBounds(cold);
        // preferGe1 among mil stops may pick 10 over 20 when both fit; unit must be mil.
        expect(cold.unit).toBe("mil");
        expect(cold.value).toBeGreaterThanOrEqual(1);
        expect(cold.value).toBeLessThanOrEqual(50);
        expect(fromMil.unit).toBe(cold.unit);
        expect(fromMil.value).toBe(cold.value);
        expect(fromIn.unit).toBe(cold.unit);
        expect(fromIn.value).toBe(cold.value);
        // 1/16 would be ~375px here — out of bounds.
        const sixteenthBar = worldMeters(1 / 16, "in") / mpp;
        expect(sixteenthBar).toBeGreaterThan(BAR_PX_MAX);
    });

    test("ZS-mil-in: fine sweep up/down — unit sequence is symmetric at shared mpps", () => {
        const lid = "standard-imperial";
        const start = mppForReading(20, "mil", BAR_PX_TARGET);
        const end = mppForReading(1, "in", BAR_PX_TARGET);

        function walk(fromMpp, toMpp, factor) {
            const session = { ...coldSession(lid), incumbentUnit: null };
            let mpp = fromMpp;
            const steps = [];
            for (let i = 0; i < 200; i++) {
                const r = resolveReading(mpp, session);
                session.incumbentUnit = r.unit;
                session.lastReading = r;
                const label = r.displayLabel || String(r.value);
                const key = `${label} ${r.unit}`;
                if (steps.length === 0 || steps[steps.length - 1] !== key) {
                    steps.push(key);
                }
                if (factor > 1 ? mpp >= toMpp : mpp <= toMpp) break;
                mpp *= factor;
            }
            return steps;
        }

        const up = walk(start, end, 1.06);
        const down = walk(end, start, 1 / 1.06);

        // Must visit 1/16 in both directions; must not skip to 1/8 from mil,
        // and must not demote through 1/32 before mil.
        expect(up.some((s) => s.includes("1/16") && s.endsWith(" in"))).toBe(true);
        expect(down.some((s) => s.includes("1/16") && s.endsWith(" in"))).toBe(true);

        const upBridge = up.findIndex((s) => s.endsWith(" in"));
        expect(upBridge).toBeGreaterThan(0);
        expect(up[upBridge]).toMatch(/1\/16/);
        expect(up[upBridge - 1]).toMatch(/mil$/);

        const downBridge = down.findIndex((s) => s.endsWith(" mil"));
        expect(downBridge).toBeGreaterThan(0);
        expect(down[downBridge - 1]).toMatch(/1\/16/);
        expect(down.some((s) => s.includes("1/32"))).toBe(false);

        // Shared-mpp symmetry: sample midpoints between 20 mil and 1 in.
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            const mpp = lo * Math.pow(hi / lo, t);
            const cold = resolveReading(mpp, coldSession(lid), { ignoreIncumbent: true });
            const fromMil = resolveReading(mpp, {
                ...coldSession(lid),
                incumbentUnit: "mil",
            });
            const fromIn = resolveReading(mpp, {
                ...coldSession(lid),
                incumbentUnit: "in",
            });
            expect(fromMil.unit).toBe(cold.unit);
            expect(fromMil.value).toBeCloseTo(cold.value, 8);
            expect(fromIn.unit).toBe(cold.unit);
            expect(fromIn.value).toBeCloseTo(cold.value, 8);
        }
    });

    test("T-P-07 / L2 enter: incumbent holds inside band; handoff still overrides enter", () => {
        expect(HYSTERESIS_ENTER_PAST_EDGE).toBe(0.05);

        // Exit-hold: incumbent ft still in pool at 2 ft target.
        const mppFt = mppForReading(2, "ft");
        const held = resolveReading(mppFt, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "ft",
        });
        expect(held.unit).toBe("ft");

        // Enter not released just inside yd band hi (500 yd) — but L3 handoff
        // still lets yd win over ft when both band-hit (enter must not block).
        const mppL3 = mppWhereBothFit(
            { niceValue: 200, unit: "yd", worldM: worldMeters(200, "yd") },
            { niceValue: 500, unit: "ft", worldM: worldMeters(500, "ft") },
        );
        const withFt = resolveReading(mppL3, {
            ...coldSession("standard-imperial"),
            incumbentUnit: "ft",
        });
        expect(withFt.unit).toBe("yd");
        expect(withFt.value).toBe(200);

        // pastIncumbentEnterEdge: just inside band hi → false; 5% past → true.
        const { logHi } = bandLogInterval("standard-metric", "m");
        const marginLog = log10(1 + HYSTERESIS_ENTER_PAST_EDGE);
        expect(pastIncumbentEnterEdge("standard-metric", "m", logHi)).toBe(false);
        expect(
            pastIncumbentEnterEdge("standard-metric", "m", logHi + marginLog + 1e-6),
        ).toBe(true);
    });

    test("ZS-01: dm sticky CanvasEditor-style session round-trip via computeScale", () => {
        // Fixed scaleDef; vary effectiveZoom like the editor (I-02 / UP3).
        const scaleDef = { value: 1, unit: "cm", barPx: BAR_PX_TARGET, zoomAt: 100 };
        const cmMpp = mppForReading(1, "cm");
        const qpcMpp = mppForReading(1, "Qpc");
        const zQpc = 100 * (cmMpp / qpcMpp);

        let session = createSession("true-metric");
        const { session: withDm } = applyUnitPick("dm", cmMpp, session);
        expect(withDm.userBand?.unit).toBe("dm");

        // Zoom out to Qpc — computeScale must clear userBand on returned session.
        const atQpc = computeScale(zQpc, scaleDef, withDm);
        expect(atQpc.session.userBand).toBeNull();

        // Persist session (editor write-back), then zoom back to ~1 cm.
        session = atQpc.session;
        const back = computeScale(100, scaleDef, session);
        expect(back.session.userBand).toBeNull();
        expectBarInBounds(back.reading);
        expect(back.reading.unit).not.toBe("dm");
        expect(["mm", "cm"]).toContain(back.reading.unit);
    });
});
