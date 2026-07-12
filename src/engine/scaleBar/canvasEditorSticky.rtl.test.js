/**
 * Adversarial RTL repro: CanvasEditor hudBundle + write-back + pick,
 * with React 17 unbatched setStatus(zoom) interleaving (useKobinEngine style).
 *
 * Run: npm test -- --testPathPattern=canvasEditorSticky.rtl --watchAll=false --no-coverage --forceExit
 */
import React, { useEffect, useMemo, useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
    computeScale,
    applyUnitPick,
    clearDisplayPrefs,
    shouldApplyScaleSessionWriteBack,
} from "./index";

const SCALE_DEF = { value: 1, unit: "cm", barPx: 120, zoomAt: 1 };

/** Mirror CanvasEditor equality + A6 write-back updater. */
function applyEditorWriteBack(s, next, sourceSession) {
    if (!s) return s;
    if (!shouldApplyScaleSessionWriteBack(s, next, { sourceSession })) {
        return s;
    }
    const sameBand =
        (!s.userBand && !next.userBand) ||
        (s.userBand &&
            next.userBand &&
            s.userBand.unit === next.userBand.unit &&
            s.userBand.logLo === next.userBand.logLo &&
            s.userBand.logHi === next.userBand.logHi);
    if (
        s.ladderId === next.ladderId &&
        s.incumbentUnit === next.incumbentUnit &&
        sameBand &&
        s.lastReading?.unit === next.lastReading?.unit &&
        s.lastReading?.value === next.lastReading?.value
    ) {
        return s;
    }
    return next;
}

/** Pre-A6 CanvasEditor write-back (blind return next) — race fodder. */
function applyLegacyWriteBack(s, next) {
    if (!s) return s;
    const sameBand =
        (!s.userBand && !next.userBand) ||
        (s.userBand &&
            next.userBand &&
            s.userBand.unit === next.userBand.unit &&
            s.userBand.logLo === next.userBand.logLo &&
            s.userBand.logHi === next.userBand.logHi);
    if (
        s.ladderId === next.ladderId &&
        s.incumbentUnit === next.incumbentUnit &&
        sameBand &&
        s.lastReading?.unit === next.lastReading?.unit &&
        s.lastReading?.value === next.lastReading?.value
    ) {
        return s;
    }
    return next;
}

/**
 * Minimal mirror of CanvasEditor.js scale HUD ownership.
 * `writeBackMode`: "a6" (current) | "legacy" (pre-A6 blind replace).
 */
function ScaleHudMirror({ initialZoom = 1, writeBackMode = "a6" }) {
    const [scaleDef] = useState(SCALE_DEF);
    const [scaleSession, setScaleSession] = useState(() =>
        clearDisplayPrefs(null, SCALE_DEF),
    );
    const [status, setStatus] = useState({ effectiveZoom: initialZoom });

    const hudBundle = useMemo(() => {
        if (!scaleDef || !scaleSession) return null;
        const { reading, session: nextSession } = computeScale(
            status.effectiveZoom,
            scaleDef,
            scaleSession,
        );
        if (!reading) return null;
        return { reading, nextSession, sourceSession: scaleSession };
    }, [scaleDef, scaleSession, status.effectiveZoom]);

    useEffect(() => {
        if (!hudBundle?.nextSession) return;
        const next = hudBundle.nextSession;
        const sourceSession = hudBundle.sourceSession;
        setScaleSession((s) =>
            writeBackMode === "legacy"
                ? applyLegacyWriteBack(s, next)
                : applyEditorWriteBack(s, next, sourceSession),
        );
    }, [hudBundle, writeBackMode]);

    const hud = hudBundle?.reading ?? null;

    return (
        <div>
            <div data-testid="unit">{hud?.unit ?? "none"}</div>
            <div data-testid="band">
                {scaleSession?.userBand?.unit ?? "none"}
            </div>
            <div data-testid="reason">{hud?.reason ?? "none"}</div>
            <button
                type="button"
                data-testid="pick-dm"
                onClick={() => {
                    const mpp = hud?.metersPerPx;
                    setScaleSession((s) => {
                        if (!s || !(mpp > 0)) return s;
                        const { session: next, reading } = applyUnitPick(
                            "dm",
                            mpp,
                            s,
                        );
                        return reading
                            ? { ...next, lastReading: reading }
                            : next;
                    });
                }}
            >
                pick dm
            </button>
            <button
                type="button"
                data-testid="nudge-zoom-sync"
                onClick={() => {
                    setStatus((st) => ({
                        effectiveZoom: st.effectiveZoom * (1 + 1e-6),
                    }));
                }}
            >
                nudge sync
            </button>
            <button
                type="button"
                data-testid="pick-then-async-zoom"
                onClick={() => {
                    const mpp = hud?.metersPerPx;
                    const z = status.effectiveZoom;
                    setScaleSession((s) => {
                        if (!s || !(mpp > 0)) return s;
                        const { session: next, reading } = applyUnitPick(
                            "dm",
                            mpp,
                            s,
                        );
                        return reading
                            ? { ...next, lastReading: reading }
                            : next;
                    });
                    // useKobinEngine: setStatus from timer is NOT batched with this click.
                    setTimeout(() => {
                        setStatus({ effectiveZoom: z * (1 + 1e-6) });
                    }, 0);
                }}
            >
                pick+async zoom
            </button>
            <button
                type="button"
                data-testid="stale-writeback-race"
                onClick={() => {
                    // Capture pre-pick unbanded next, pick, then apply stale
                    // write-back as if a deferred effect closed over old hudBundle.
                    const staleNext = hudBundle?.nextSession;
                    const staleSource = hudBundle?.sourceSession;
                    const mpp = hud?.metersPerPx;
                    setScaleSession((s) => {
                        if (!s || !(mpp > 0)) return s;
                        const { session: next, reading } = applyUnitPick(
                            "dm",
                            mpp,
                            s,
                        );
                        return reading
                            ? { ...next, lastReading: reading }
                            : next;
                    });
                    setScaleSession((s) =>
                        writeBackMode === "legacy"
                            ? applyLegacyWriteBack(s, staleNext)
                            : applyEditorWriteBack(s, staleNext, staleSource),
                    );
                }}
            >
                stale race
            </button>
        </div>
    );
}

describe("CanvasEditor sticky RTL (Hybrid B⁺ path)", () => {
    test("pick dm → band + unit survive same-zoom write-back", async () => {
        render(<ScaleHudMirror />);
        await act(async () => {});

        fireEvent.click(screen.getByTestId("pick-dm"));
        await act(async () => {});

        expect(screen.getByTestId("band").textContent).toBe("dm");
        expect(screen.getByTestId("unit").textContent).toBe("dm");
        expect(screen.getByTestId("reason").textContent).toBe("user-band");
    });

    test("pick dm → tiny zoom status bump keeps band (A2)", async () => {
        render(<ScaleHudMirror />);
        await act(async () => {});

        fireEvent.click(screen.getByTestId("pick-dm"));
        await act(async () => {});
        fireEvent.click(screen.getByTestId("nudge-zoom-sync"));
        await act(async () => {});

        expect(screen.getByTestId("band").textContent).toBe("dm");
        expect(screen.getByTestId("unit").textContent).toBe("dm");
    });

    test("React 17: pick then unbatched setTimeout setStatus keeps band", async () => {
        render(<ScaleHudMirror />);
        await act(async () => {});

        fireEvent.click(screen.getByTestId("pick-then-async-zoom"));
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
        });

        expect(screen.getByTestId("band").textContent).toBe("dm");
        expect(screen.getByTestId("unit").textContent).toBe("dm");
    });

    test("A6: stale unbanded write-back after pick must not wipe band", async () => {
        render(<ScaleHudMirror writeBackMode="a6" />);
        await act(async () => {});

        fireEvent.click(screen.getByTestId("stale-writeback-race"));
        await act(async () => {});

        expect(screen.getByTestId("band").textContent).toBe("dm");
        expect(screen.getByTestId("unit").textContent).toBe("dm");
    });

    /**
     * Legacy lock: pre-A6 blind write-back wipes a fresh pick. Kept green as
     * documentation that A6 is load-bearing (writeBackMode="a6" sibling above).
     */
    test("legacy pre-A6 blind write-back wipes pick (A6 guards this)", async () => {
        render(<ScaleHudMirror writeBackMode="legacy" />);
        await act(async () => {});

        fireEvent.click(screen.getByTestId("stale-writeback-race"));
        await act(async () => {});

        expect(screen.getByTestId("band").textContent).toBe("none");
    });

    /**
     * L9: clearDisplayPrefs on canvasId / engineReady is intentional.
     * Not a stickiness bug during ordinary zoom — only remount/nav resets.
     */
    test("L9: clearDisplayPrefs on init-token change wipes band (canvas nav)", async () => {
        function MirrorWithInitWipe({ wipeToken }) {
            const [scaleDef, setScaleDef] = useState(SCALE_DEF);
            const [scaleSession, setScaleSession] = useState(() =>
                clearDisplayPrefs(null, SCALE_DEF),
            );
            const [status] = useState({ effectiveZoom: 1 });

            useEffect(() => {
                setScaleDef(SCALE_DEF);
                setScaleSession(clearDisplayPrefs(null, SCALE_DEF));
            }, [wipeToken]);

            const hudBundle = useMemo(() => {
                if (!scaleDef || !scaleSession) return null;
                const { reading, session: nextSession } = computeScale(
                    status.effectiveZoom,
                    scaleDef,
                    scaleSession,
                );
                if (!reading) return null;
                return { reading, nextSession, sourceSession: scaleSession };
            }, [scaleDef, scaleSession, status.effectiveZoom]);

            useEffect(() => {
                if (!hudBundle?.nextSession) return;
                const next = hudBundle.nextSession;
                const sourceSession = hudBundle.sourceSession;
                setScaleSession((s) =>
                    applyEditorWriteBack(s, next, sourceSession),
                );
            }, [hudBundle]);

            const hud = hudBundle?.reading ?? null;
            return (
                <div>
                    <div data-testid="band2">
                        {scaleSession?.userBand?.unit ?? "none"}
                    </div>
                    <button
                        type="button"
                        data-testid="pick2"
                        onClick={() => {
                            const mpp = hud?.metersPerPx;
                            setScaleSession((s) => {
                                if (!s || !(mpp > 0)) return s;
                                const { session: next, reading } = applyUnitPick(
                                    "dm",
                                    mpp,
                                    s,
                                );
                                return reading
                                    ? { ...next, lastReading: reading }
                                    : next;
                            });
                        }}
                    >
                        pick
                    </button>
                </div>
            );
        }

        const { rerender } = render(<MirrorWithInitWipe wipeToken={0} />);
        await act(async () => {});
        fireEvent.click(screen.getByTestId("pick2"));
        await act(async () => {});
        expect(screen.getByTestId("band2").textContent).toBe("dm");

        rerender(<MirrorWithInitWipe wipeToken={1} />);
        await act(async () => {});

        expect(screen.getByTestId("band2").textContent).toBe("none");
    });
});
