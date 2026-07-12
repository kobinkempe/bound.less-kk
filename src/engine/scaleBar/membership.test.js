/**
 * Ladder membership — five inventories, priority, related (bible §2 / Q2).
 * Imports the real membership + constants modules (not the legacy adapter).
 */

import { LADDER_IDS, LADDER_PRIORITY } from "./constants";
import {
    LADDERS,
    RELATED_LADDERS,
    ladderForStack,
    laddersOwning,
    stackForUnit,
    highestPriorityLadder,
    floorUnit,
    ceilingUnit,
    ULTRA_STANDARD,
} from "./membership";

const OMITTED_FROM_ULTRA = ["yd", "mil", "ld", "R☉", "R⊕"];

describe("scaleBar/membership (bible §2)", () => {
    test("five ladders exist with expected ids", () => {
        expect(Object.keys(LADDERS).sort()).toEqual(
            [
                LADDER_IDS.STANDARD_IMPERIAL,
                LADDER_IDS.STANDARD_METRIC,
                LADDER_IDS.TRUE_METRIC,
                LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
                LADDER_IDS.ULTRA_STANDARD_METRIC,
            ].sort(),
        );
    });

    test("LADDER_PRIORITY is SM → SI → UM → UI → TM", () => {
        expect(LADDER_PRIORITY).toEqual([
            LADDER_IDS.STANDARD_METRIC,
            LADDER_IDS.STANDARD_IMPERIAL,
            LADDER_IDS.ULTRA_STANDARD_METRIC,
            LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
            LADDER_IDS.TRUE_METRIC,
        ]);
    });

    test("ultra-standard inventories omit yd / mil / ld / R☉ / R⊕ (Q2)", () => {
        for (const ladderId of [
            LADDER_IDS.ULTRA_STANDARD_METRIC,
            LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
        ]) {
            const names = ladderForStack(ladderId).map((r) => r.name);
            for (const omitted of OMITTED_FROM_ULTRA) {
                expect(names).not.toContain(omitted);
            }
        }
        expect(ladderForStack(LADDER_IDS.ULTRA_STANDARD_METRIC).map((r) => r.name)).toEqual([
            "ℓP", "fm", "pm", "nm", "µm", "mm", "cm", "m", "km", "AU", "ly", "pc",
        ]);
        expect(ladderForStack(LADDER_IDS.ULTRA_STANDARD_IMPERIAL).map((r) => r.name)).toEqual([
            "ℓP", "fm", "pm", "nm", "µm", "in", "ft", "mi", "AU", "ly", "pc",
        ]);
    });

    test("ULTRA_STANDARD helper is the union of both ultra inventories", () => {
        for (const u of ["ℓP", "in", "ft", "mi", "mm", "m", "km", "AU", "ly", "pc"]) {
            expect(ULTRA_STANDARD).toContain(u);
        }
        for (const omitted of OMITTED_FROM_ULTRA) {
            expect(ULTRA_STANDARD).not.toContain(omitted);
        }
    });

    test("related-ladder table matches bible §2", () => {
        expect(RELATED_LADDERS[LADDER_IDS.ULTRA_STANDARD_IMPERIAL]).toEqual([
            LADDER_IDS.ULTRA_STANDARD_METRIC,
            LADDER_IDS.STANDARD_IMPERIAL,
        ]);
        expect(RELATED_LADDERS[LADDER_IDS.ULTRA_STANDARD_METRIC]).toEqual([
            LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
            LADDER_IDS.STANDARD_METRIC,
        ]);
        expect(RELATED_LADDERS[LADDER_IDS.STANDARD_METRIC]).toEqual([
            LADDER_IDS.ULTRA_STANDARD_METRIC,
            LADDER_IDS.TRUE_METRIC,
            LADDER_IDS.STANDARD_IMPERIAL,
        ]);
        expect(RELATED_LADDERS[LADDER_IDS.TRUE_METRIC]).toEqual([
            LADDER_IDS.ULTRA_STANDARD_METRIC,
            LADDER_IDS.STANDARD_METRIC,
            LADDER_IDS.STANDARD_IMPERIAL,
        ]);
        expect(RELATED_LADDERS[LADDER_IDS.STANDARD_IMPERIAL]).toEqual([
            LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
            LADDER_IDS.STANDARD_METRIC,
            LADDER_IDS.TRUE_METRIC,
        ]);
    });

    test("L9: stackForUnit(Qpc) → standard-metric (highest-priority owner)", () => {
        expect(stackForUnit("Qpc")).toBe(LADDER_IDS.STANDARD_METRIC);
        expect(laddersOwning("Qpc")[0]).toBe(LADDER_IDS.STANDARD_METRIC);
        expect(highestPriorityLadder(laddersOwning("Qpc"))).toBe(
            LADDER_IDS.STANDARD_METRIC,
        );
    });

    test("ultra ceilings are pc; standard/true ceilings are Qpc", () => {
        expect(ceilingUnit(LADDER_IDS.ULTRA_STANDARD_METRIC)).toBe("pc");
        expect(ceilingUnit(LADDER_IDS.ULTRA_STANDARD_IMPERIAL)).toBe("pc");
        expect(ceilingUnit(LADDER_IDS.STANDARD_METRIC)).toBe("Qpc");
        expect(ceilingUnit(LADDER_IDS.TRUE_METRIC)).toBe("Qpc");
        expect(floorUnit(LADDER_IDS.ULTRA_STANDARD_METRIC)).toBe("ℓP");
        expect(floorUnit(LADDER_IDS.STANDARD_METRIC)).toBe("qℓP");
    });
});
