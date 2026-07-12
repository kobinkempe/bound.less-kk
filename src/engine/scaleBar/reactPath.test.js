/**
 * CanvasEditor React integration — session write-back + pick (no preference math).
 * Simulates useMemo(computeScale) → useEffect(write-back) → onPickUnit(applyUnitPick).
 */

import { computeScale, applyUnitPick, clearDisplayPrefs } from "./index";
import { shouldApplyScaleSessionWriteBack } from "./session";

/** Mirror CanvasEditor write-back updater. */
function applyWriteBack(live, next, sourceSession) {
    if (!live) return live;
    if (!shouldApplyScaleSessionWriteBack(live, next, { sourceSession })) {
        return live;
    }
    const sameBand =
        (!live.userBand && !next.userBand) ||
        (live.userBand &&
            next.userBand &&
            live.userBand.unit === next.userBand.unit &&
            live.userBand.logLo === next.userBand.logLo &&
            live.userBand.logHi === next.userBand.logHi);
    if (
        live.ladderId === next.ladderId &&
        live.incumbentUnit === next.incumbentUnit &&
        sameBand &&
        live.lastReading?.unit === next.lastReading?.unit &&
        live.lastReading?.value === next.lastReading?.value
    ) {
        return live;
    }
    return next;
}

function simulateHud(scaleDef, scaleSession, zoom) {
    const { reading, session: nextSession } = computeScale(
        zoom,
        scaleDef,
        scaleSession,
    );
    if (!reading) return { reading: null, nextSession: null, sourceSession: scaleSession };
    return { reading, nextSession, sourceSession: scaleSession };
}

describe("CanvasEditor React path (userBand stickiness)", () => {
    test("R1: pick dm → write-back keeps band at same zoom (editor sequence)", () => {
        const scaleDef = { value: 1, unit: "cm", barPx: 120, zoomAt: 1 };
        let scaleSession = clearDisplayPrefs(null, scaleDef);
        let zoom = 1;

        let bundle = simulateHud(scaleDef, scaleSession, zoom);
        scaleSession = applyWriteBack(
            scaleSession,
            bundle.nextSession,
            bundle.sourceSession,
        );
        expect(bundle.reading.unit).toMatch(/cm|mm/);

        // Stale pre-pick bundle (A6 race fodder)
        const stale = simulateHud(scaleDef, scaleSession, zoom);

        const picked = applyUnitPick("dm", bundle.reading.metersPerPx, scaleSession);
        scaleSession = picked.reading
            ? { ...picked.session, lastReading: picked.reading }
            : picked.session;
        expect(scaleSession.userBand?.unit).toBe("dm");

        // Stale effect after pick must not wipe
        scaleSession = applyWriteBack(
            scaleSession,
            stale.nextSession,
            stale.sourceSession,
        );
        expect(scaleSession.userBand?.unit).toBe("dm");

        // Fresh useMemo + write-back after pick
        bundle = simulateHud(scaleDef, scaleSession, zoom);
        expect(bundle.reading.unit).toBe("dm");
        expect(bundle.nextSession.userBand?.unit).toBe("dm");
        scaleSession = applyWriteBack(
            scaleSession,
            bundle.nextSession,
            bundle.sourceSession,
        );
        expect(scaleSession.userBand?.unit).toBe("dm");
    });

    test("R2: pick uses closed-over scaleSession (non-functional setState) then zoom status bump", () => {
        const scaleDef = { value: 1, unit: "in", barPx: 120, zoomAt: 1 };
        let scaleSession = clearDisplayPrefs(null, scaleDef);
        let zoom = 1;

        let bundle = simulateHud(scaleDef, scaleSession, zoom);
        scaleSession = applyWriteBack(
            scaleSession,
            bundle.nextSession,
            bundle.sourceSession,
        );

        // Picker closure captures this session + hud mpp (like CanvasEditor render)
        const closedSession = scaleSession;
        const closedMpp = bundle.reading.metersPerPx;

        const picked = applyUnitPick("mi", closedMpp, closedSession);
        // Non-functional replace (matches CanvasEditor onPickUnit)
        scaleSession = picked.reading
            ? { ...picked.session, lastReading: picked.reading }
            : picked.session;

        // Zoom status update (same effectiveZoom identity change simulation)
        zoom = 1; // identical zoom
        bundle = simulateHud(scaleDef, scaleSession, zoom);
        scaleSession = applyWriteBack(
            scaleSession,
            bundle.nextSession,
            bundle.sourceSession,
        );
        expect(scaleSession.userBand?.unit).toBe("mi");
        expect(bundle.reading.unit).toBe("mi");

        // Tiny zoom status change like useKobinEngine immediate flush
        zoom = 1 * (1 + 1e-6);
        bundle = simulateHud(scaleDef, scaleSession, zoom);
        scaleSession = applyWriteBack(
            scaleSession,
            bundle.nextSession,
            bundle.sourceSession,
        );
        expect(scaleSession.userBand?.unit).toBe("mi");
        expect(bundle.reading.unit).toBe("mi");
    });

    test("R3: clearDisplayPrefs only on redefine — not on zoom write-back", () => {
        const scaleDef = { value: 1, unit: "cm", barPx: 120, zoomAt: 1 };
        let scaleSession = clearDisplayPrefs(null, scaleDef);
        let bundle = simulateHud(scaleDef, scaleSession, 1);
        scaleSession = applyWriteBack(
            scaleSession,
            bundle.nextSession,
            bundle.sourceSession,
        );
        const picked = applyUnitPick("dm", bundle.reading.metersPerPx, scaleSession);
        scaleSession = picked.session;
        expect(scaleSession.userBand?.unit).toBe("dm");

        // Zoom-only path must not call clearDisplayPrefs
        bundle = simulateHud(scaleDef, scaleSession, 1.01);
        scaleSession = applyWriteBack(
            scaleSession,
            bundle.nextSession,
            bundle.sourceSession,
        );
        expect(scaleSession.userBand?.unit).toBe("dm");

        // Redefine does wipe (L9)
        scaleSession = clearDisplayPrefs(null, scaleDef);
        expect(scaleSession.userBand).toBeNull();
    });

    test("R4: A6 fail-closed — missing sourceSession must not wipe banded live session", () => {
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
        const staleNext = {
            ladderId: "true-metric",
            userBand: null,
            incumbentUnit: "cm",
            lastReading: { unit: "cm", value: 1 },
        };
        expect(shouldApplyScaleSessionWriteBack(banded, staleNext, {})).toBe(
            false,
        );
        expect(
            shouldApplyScaleSessionWriteBack(banded, staleNext, {
                sourceSession: { ladderId: "true-metric", userBand: null },
            }),
        ).toBe(false);
        expect(
            shouldApplyScaleSessionWriteBack(banded, staleNext, {
                sourceSession: banded,
            }),
        ).toBe(true);
    });
});
