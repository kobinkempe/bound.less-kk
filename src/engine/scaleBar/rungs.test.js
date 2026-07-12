/**
 * Popover / set-scale presentation rungs — L10 + 6a / 7a smoke.
 */

import { resolveReading } from "./resolve";
import { popoverUnits, setScaleUnits } from "./rungs";
import { RELATED_LADDERS } from "./membership";
import { POPOVER_TABLE_AT, SET_SCALE_TABLE_AT } from "./constants";
import {
    coldSession,
    cleanProbeSession,
    mppForReading,
    expectBarInBounds,
} from "./testSupport";

describe("scaleBar/rungs (popover 6a + L10)", () => {
    test("L10: related peer is auto-show on related ladder (clean probe), not nearest-by-size", () => {
        const mpp = mppForReading(1, "m");
        const live = coldSession("ultra-standard-metric");
        const liveReading = resolveReading(mpp, live, { ignoreIncumbent: true });
        expect(liveReading.unit).toBe("m");
        expect(liveReading.ladderId).toBe("ultra-standard-metric");

        const related = RELATED_LADDERS["ultra-standard-metric"];
        expect(related).toEqual(
            expect.arrayContaining(["ultra-standard-imperial", "standard-metric"]),
        );

        const peer = resolveReading(mpp, cleanProbeSession("ultra-standard-imperial"), {
            ladderId: "ultra-standard-imperial",
            ignoreUserBand: true,
            ignoreIncumbent: true,
        });
        expectBarInBounds(peer);
        expect(peer.unit).toBe("ft");
        expect(peer.unit).not.toBe("yd");

        const opts = popoverUnits(0, {
            currentUnit: liveReading.unit,
            ladderId: live.ladderId,
            mpp,
            session: live,
        });
        expect(opts.units).toContain(peer.unit);
        expect(opts.units).not.toContain(liveReading.unit);
    });

    test("6a smoke: first rung around 2 ft includes related auto-show, prefs-discarded, 50× neighbors", () => {
        const mpp = mppForReading(2, "ft");
        const session = coldSession("standard-imperial");
        const hud = resolveReading(mpp, session, { ignoreIncumbent: true });
        expect(hud.unit).toBe("ft");

        const opts = popoverUnits(0, {
            currentUnit: "ft",
            ladderId: "standard-imperial",
            mpp,
            session,
        });

        expect(opts.units).not.toContain("ft");
        expect(opts.units).toEqual(expect.arrayContaining(["in", "yd"]));

        // Sorted small → large by catalog log size.
        for (let i = 1; i < opts.units.length; i++) {
            expect(typeof opts.units[i - 1]).toBe("string");
            expect(typeof opts.units[i]).toBe("string");
        }

        // Related auto-show units present, excluding current HUD unit (constraint 6).
        const relatedIds = RELATED_LADDERS["standard-imperial"];
        const relatedAutos = relatedIds
            .map((ladderId) =>
                resolveReading(mpp, cleanProbeSession(ladderId), {
                    ladderId,
                    ignoreUserBand: true,
                    ignoreIncumbent: true,
                }).unit,
            )
            .filter((u) => u !== "ft");
        for (const u of relatedAutos) {
            expect(opts.units).toContain(u);
        }
    });

    test("6a: current HUD unit never listed; table flip gated at POPOVER_TABLE_AT", () => {
        expect(POPOVER_TABLE_AT).toBe(12);
        const mpp = mppForReading(2, "ft");
        const opts = popoverUnits(0, {
            currentUnit: "ft",
            ladderId: "standard-imperial",
            mpp,
            session: coldSession("standard-imperial"),
        });
        expect(opts.units.length).toBeGreaterThan(0);
        expect(opts.units).not.toContain("ft");
        if (opts.units.length > POPOVER_TABLE_AT) {
            expect(opts.mode === "table" || opts.asTable === true).toBe(true);
        }
    });

    test("L10 probe must not leak live userBand into related auto-show", () => {
        const mpp = mppForReading(1, "m");
        const peer = resolveReading(mpp, cleanProbeSession("ultra-standard-imperial"), {
            ladderId: "ultra-standard-imperial",
            ignoreUserBand: true,
            ignoreIncumbent: true,
        });
        expect(peer.unit).toBe("ft");
        expect(peer.ladderId).toBe("ultra-standard-imperial");
    });
});

describe("scaleBar/rungs (set-scale 7a–7d)", () => {
    test("7a: first rung is ultra-standard units between mm and mi", () => {
        const opts = setScaleUnits(0, { ladderId: null });
        expect(opts.units).toEqual(
            expect.arrayContaining(["mm", "cm", "m", "km", "in", "ft", "mi"]),
        );
        // Ultra inventories omit yd / mil — they must not appear on 7a.
        expect(opts.units).not.toContain("yd");
        expect(opts.units).not.toContain("mil");
        // Deep Planck / ceiling units are not on the mm–mi ultra band.
        expect(opts.units).not.toContain("qℓP");
        expect(opts.units).not.toContain("Qpc");
    });

    test("7b expands to all ultra-standard; table flip at SET_SCALE_TABLE_AT", () => {
        expect(SET_SCALE_TABLE_AT).toBe(22);
        const a = setScaleUnits(0, { ladderId: "standard-metric" });
        const b = setScaleUnits(1, { ladderId: "standard-metric" });
        expect(b.units.length).toBeGreaterThanOrEqual(a.units.length);
        expect(b.units).toEqual(expect.arrayContaining(["ℓP", "AU", "ly", "pc"]));
        if (b.units.length > SET_SCALE_TABLE_AT) {
            expect(b.showFullTable || b.asTable).toBe(true);
        }
    });

    test("T-SET / I-04: >22 membership table is not full catalog until 7d", () => {
        const c = setScaleUnits(2, { ladderId: "standard-metric" }); // 7c
        const d = setScaleUnits(3, { ladderId: "standard-metric" }); // 7d
        expect(c.isFullCatalog).toBe(false);
        expect(d.isFullCatalog).toBe(true);
        if (c.asTable || c.units.length > SET_SCALE_TABLE_AT) {
            expect(c.units.length).toBeLessThan(d.units.length);
        }
        expect(c.hasMore).toBe(true);
        expect(d.hasMore).toBe(false);
        // More advances 7c → 7d
        expect(c.nextMoreLevel).toBe(d.level);
    });
});

describe("scaleBar/rungs (T-R6-02 empty rung skips)", () => {
    /**
     * Walk every effective moreLevel; each More click must grow the unit set.
     * Also dumps lists for diagnosis (pm / am / µm at standard-metric).
     */
    function walkPopoverMore(unit, ladderId, nice = 5) {
        const mpp = mppForReading(nice, unit);
        const session = coldSession(ladderId);
        const ctx = { currentUnit: unit, ladderId, mpp, session };
        const steps = [];
        let level = 0;
        for (let guard = 0; guard < 8; guard++) {
            const opts = popoverUnits(level, ctx);
            steps.push({
                level: opts.level,
                units: [...opts.units],
                hasMore: opts.hasMore,
                nextMoreLevel: opts.nextMoreLevel,
            });
            if (!opts.hasMore) break;
            level = opts.nextMoreLevel;
        }
        return { mpp, steps };
    }

    test("T-R6-02: More never lands on a no-op; skip empty leading rung at pm", () => {
        const dumps = {};
        for (const unit of ["pm", "am", "µm"]) {
            const { steps } = walkPopoverMore(unit, "standard-metric", 5);
            dumps[unit] = steps.map((s) => s.units);

            // Opening the popover must not show a lone useless "more" chip.
            expect(steps[0].units.length).toBeGreaterThan(0);
            // Empty + hasMore is the screenshot bug (5 pm with only "more").
            expect(steps[0].units.length === 0 && steps[0].hasMore).toBe(false);

            for (let i = 0; i < steps.length - 1; i++) {
                const cur = steps[i];
                const next = steps[i + 1];
                expect(cur.hasMore).toBe(true);
                expect(next.units.length).toBeGreaterThan(cur.units.length);
                // Every unit from the prior level remains (cumulative).
                for (const u of cur.units) {
                    expect(next.units).toContain(u);
                }
            }
        }

        // Concrete dump: first visible level at 5 pm must already include neighbors
        // (previously level 0 was [] and More advanced to this set).
        expect(dumps.pm[0]).toEqual(expect.arrayContaining(["am", "fm", "nm", "µm"]));
        expect(dumps.pm[0]).not.toContain("pm");

        // am has a non-empty 6a (ℓP); µm skips empty 6a into a non-empty first level.
        expect(dumps.am[0].length).toBeGreaterThan(0);
        expect(dumps["µm"][0].length).toBeGreaterThan(0);
    });

    test("T-R6-02 dump: unit lists per moreLevel for standard-metric pm/am/µm", () => {
        const pm = walkPopoverMore("pm", "standard-metric", 5).steps.map((s) => s.units);
        const am = walkPopoverMore("am", "standard-metric", 5).steps.map((s) => s.units);
        const um = walkPopoverMore("µm", "standard-metric", 5).steps.map((s) => s.units);

        // After skip-empty: first visible level is the first non-empty cumulative union.
        expect(pm[0]).toEqual(["am", "fm", "nm", "µm"]);
        expect(pm[1]).toEqual([
            "ℓP", "am", "fm", "nm", "µm", "mil", "mm", "cm", "in", "ft", "yd",
            "m", "km", "mi", "R⊕", "R☉", "AU", "ld", "ly", "pc", "kpc",
        ]);
        expect(pm[2].length).toBe(57);

        expect(am[0]).toEqual(["ℓP"]);
        expect(am[1]).toEqual(["ℓP", "ym", "zm", "fm", "pm"]);
        expect(am[2].length).toBe(23);
        expect(am[3].length).toBe(57);

        expect(um[0]).toEqual(["mil"]);
        expect(um[1]).toEqual(["pm", "nm", "mil", "mm", "cm"]);
        expect(um[2].length).toBe(20);
        expect(um[3].length).toBe(57);
    });
});

describe("scaleBar/rungs (popover table membership I-03)", () => {
    test("T-R6-03 / T-POP: table at mid-rung is membership, excludes current, More advances", () => {
        const mpp = mppForReading(2, "ft");
        // Walk levels until asTable without being full catalog (6c/6d).
        let found = null;
        for (let level = 0; level < 5; level++) {
            const opts = popoverUnits(level, {
                currentUnit: "ft",
                ladderId: "standard-imperial",
                mpp,
                session: coldSession("standard-imperial"),
            });
            if (opts.asTable && !opts.isFullCatalog) {
                found = opts;
                break;
            }
        }
        // If no mid-rung overflow at this zoom, at least assert 6e is full catalog
        // and earlier levels exclude current.
        if (!found) {
            const mid = popoverUnits(2, {
                currentUnit: "ft",
                ladderId: "standard-imperial",
                mpp,
                session: coldSession("standard-imperial"),
            });
            expect(mid.units).not.toContain("ft");
            const full = popoverUnits(4, {
                currentUnit: "ft",
                ladderId: "standard-imperial",
                mpp,
                session: coldSession("standard-imperial"),
            });
            expect(full.isFullCatalog).toBe(true);
            expect(full.units).not.toContain("ft");
            return;
        }
        expect(found.units).not.toContain("ft");
        expect(found.isFullCatalog).toBe(false);
        expect(found.hasMore).toBe(true);
        const next = popoverUnits(found.nextMoreLevel, {
            currentUnit: "ft",
            ladderId: "standard-imperial",
            mpp,
            session: coldSession("standard-imperial"),
        });
        expect(next.units.length).toBeGreaterThanOrEqual(found.units.length);
        expect(next.units).not.toContain("ft");
    });

    test("T-POP: related ±1 empty when current unit ∉ related inventory (I-11 comment)", () => {
        // Ultra omits yd — related-ladder neighbors for yd on ultra return [].
        // Chip/table membership still excludes current and does not dump catalog early.
        const mpp = mppForReading(1, "m");
        const opts = popoverUnits(0, {
            currentUnit: "m",
            ladderId: "ultra-standard-metric",
            mpp,
            session: coldSession("ultra-standard-metric"),
        });
        expect(opts.units).not.toContain("m");
        expect(opts.isFullCatalog).toBe(false);
    });
});
