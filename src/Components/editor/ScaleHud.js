import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ruler } from "lucide-react";
import Button from "../ui/Button";
import SciText from "../ui/SciText";
import ScaleUnitPicker from "./ScaleUnitPicker";
import { zoomLabel } from "../../hooks/useKobinEngine";
import {
    computeScale, formatScaleLabel, applyUnitPick, clearDisplayPrefs, BAR_PX_TARGET,
    shouldApplyScaleSessionWriteBack,
} from "../../engine/scaleBar";

/**
 * The scale controls, bottom right — Clear, Set scale, the bar and its label — and the unit picker the label
 * opens. It owns the display session (sticky ladder L8, the user's preferred range L5/L12, the incumbent unit
 * L2) and `computeScale`'s write-back, and follows the zoom through `engine.onZoom`, once a frame: a zoom
 * re-renders this leaf alone, not the editor (A3 §5, R25 W1). A new scale definition starts a fresh session
 * from its anchor unit (L9). `onLadderId` hands the session's ladder to the scale dialog.
 */
export default function ScaleHud({ engineRef, engineReady, scaleDef, readOnly, onClear, onSetScale, onLadderId }) {
    const [zoom, setZoom] = useState(() => (engineRef.current ? engineRef.current.cam.effectiveZoom() : 1));
    useEffect(() => {
        const E = engineRef.current;
        if (!E) return undefined;
        setZoom(E.cam.effectiveZoom());
        return E.onZoom(setZoom);
    }, [engineRef, engineReady]);

    // The session belongs to the definition it was made from: a new one (commit, clear, load) resets it
    // here, in the same render, as setting both at once did in the editor.
    const [held, setHeld] = useState(() => ({ def: scaleDef, session: scaleDef ? clearDisplayPrefs(null, scaleDef) : null }));
    let scaleSession = held.session;
    if (held.def !== scaleDef) {
        scaleSession = scaleDef ? clearDisplayPrefs(null, scaleDef) : null;
        setHeld({ def: scaleDef, session: scaleSession });
    }
    const setScaleSession = useCallback((next) => setHeld((h) => ({ def: h.def, session: typeof next === "function" ? next(h.session) : next })), []);

    const hudBundle = useMemo(() => {
        if (!scaleDef || !scaleSession) return null;
        // Absolute resolve at the target zoom on the sticky session (L1/L8).
        // Persist returned session (userBand teardown I-02 + incumbent/lastReading).
        const { reading, session: nextSession } = computeScale(zoom, scaleDef, scaleSession);
        if (!reading) return null;
        return { reading, nextSession, sourceSession: scaleSession };
    }, [scaleDef, scaleSession, zoom]);

    // Write back computeScale session so clearUserBandIfExited sticks (ZS-01 / UP3).
    // A6: skip stale unbanded next when live s already holds a fresher band.
    useEffect(() => {
        if (!hudBundle?.nextSession) return;
        const next = hudBundle.nextSession;
        const sourceSession = hudBundle.sourceSession;
        setScaleSession((s) => {
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
        });
    }, [hudBundle, setScaleSession]);

    const ladderId = scaleSession?.ladderId ?? null;
    useEffect(() => { if (onLadderId) onLadderId(ladderId); }, [ladderId, onLadderId]);

    const [unitPickerOpen, setUnitPickerOpen] = useState(false);
    const scaleHudRef = useRef(null);
    const hud = hudBundle?.reading ?? null;
    const scaleLabel = hud ? formatScaleLabel(hud) : zoomLabel(zoom);

    return (
        <>
            <div className="bl-editor-overlay bl-editor-bottom-right bl-scale-controls">
                {scaleDef && (
                    <Button variant="ghost" size="sm" className="bl-text-muted" onClick={onClear} disabled={readOnly}>Clear</Button>
                )}
                <Button variant="outline" size="sm" className="bl-shadow-panel bl-flex bl-gap-2"
                    onClick={onSetScale} title="Define scale by dragging" disabled={readOnly}>
                    <Ruler size={14} /> Set scale
                </Button>
                <div className="bl-scale-hud" ref={scaleHudRef}>
                    <div className="bl-scale-bar" style={{ width: hud ? hud.barPx : BAR_PX_TARGET }} />
                    {scaleDef ? (
                        <button
                            type="button"
                            className="bl-text-xs bl-scale-label bl-scale-label-btn"
                            onClick={() => setUnitPickerOpen((v) => !v)}
                            title="Change unit"
                        >
                            <SciText text={scaleLabel} />
                        </button>
                    ) : (
                        <span className="bl-text-xs bl-scale-label"><SciText text={scaleLabel} /></span>
                    )}
                </div>
            </div>

            {scaleDef && hud && (
                <ScaleUnitPicker
                    open={unitPickerOpen}
                    onOpenChange={setUnitPickerOpen}
                    anchorRef={scaleHudRef}
                    currentUnit={hud.unit}
                    ladderId={scaleSession?.ladderId ?? hud.ladderId}
                    mpp={hud.metersPerPx}
                    session={scaleSession}
                    onPickUnit={(unit) => {
                        // L5–L7 / L12: preferred picks switch ladders; other
                        // picks install a user preferred range — no pins.
                        // Functional update so a pending write-back cannot
                        // supply a stale pre-pick session to applyUnitPick.
                        const mpp = hud.metersPerPx;
                        setScaleSession((s) => {
                            if (!s || !(mpp > 0)) return s;
                            const { session: next, reading } = applyUnitPick(
                                unit,
                                mpp,
                                s,
                            );
                            return reading
                                ? { ...next, lastReading: reading }
                                : next;
                        });
                        setUnitPickerOpen(false);
                    }}
                />
            )}
        </>
    );
}
