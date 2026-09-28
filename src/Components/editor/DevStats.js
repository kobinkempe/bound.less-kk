import React, { useEffect, useState } from "react";
import { levelFor, zOf } from "../../engine/raster/level";

const MIB = 1024 * 1024;

/** One reading of the renderer's own counters, the fields `report()` carries (A3 §8, §9.1). Null without an engine. */
function readStats(E) {
    if (!E || !E.cam) return null;
    const L = E.renderer && E.renderer.layer && E.renderer.layer.report ? E.renderer.layer.report() : null;
    const P = E.plates && E.plates.report ? E.plates.report() : null;
    const F = E.frameMeter ? E.frameMeter.report() : null;
    const LF = E.longFrames ? E.longFrames.report() : null;
    const dpr = L && L.dpr > 0 ? L.dpr : (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const Z = E.cam.inScale * dpr, S = E.cfg.levelStep;
    const lv = levelFor(Z, S);
    const since = Date.now() - 10000;
    const long = LF ? (LF.recent || []).filter((r) => r.t >= since) : [];
    return {
        S, lv, sigma: Z / zOf(lv, S),
        mode: L ? L.mode : "svg", stretch: L ? L.s : null,
        paper: L && L.paperMs != null ? [L.paperMs, L.blurMs, L.olderMs] : null,
        composes: L ? L.composes : null, maxImages: L ? L.maxImagesPerCompose : null, composeMs: L ? L.composeMs : null,
        plates: P ? P.plates : null, mib: P ? P.plateBytes / MIB : null, capMib: P ? P.maxBytes / MIB : null,
        pinned: P ? P.pinned : null, inFlight: P ? P.inFlight : null,
        longN: long.length, longWorst: long.reduce((m, r) => Math.max(m, r.ms), 0),
        hist: F ? F.hist : null,
    };
}

const f1 = (v) => (v == null ? "–" : (+v).toFixed(1));

/**
 * The Dev panel's counters on a timer of their own (500 ms), so a zoom or an arrival never re-renders the
 * editor for them. What the pyramid will carry (`paperMs`, `blurMs`, `olderMs`) shows once a layer has it.
 */
export default function DevStats({ engineRef, intervalMs = 500 }) {
    const [s, setS] = useState(null);
    useEffect(() => {
        const tick = () => setS(readStats(engineRef.current));
        tick();
        const id = setInterval(tick, intervalMs);
        return () => clearInterval(id);
    }, [engineRef, intervalMs]);
    if (!s) return null;
    return (
        <div className="bl-dev-stats" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.35 }}>
            <div><b>level</b> ℓ{s.lv} at S={s.S}, σ {f1(s.sigma)} · <b>view</b> {s.mode} s {f1(s.stretch)}</div>
            {s.paper && <div><b>paper</b> {f1(s.paper[0])} · blur {f1(s.paper[1])} · older {f1(s.paper[2])} ms</div>}
            <div><b>plates</b> {s.plates ?? "–"} · {f1(s.mib)}/{f1(s.capMib)} MiB · pinned {s.pinned ?? "–"} · in flight {s.inFlight ?? "–"}</div>
            <div><b>compose</b> {s.composes ?? "–"} · max {s.maxImages ?? "–"}/30 images · {f1(s.composeMs)} ms total</div>
            <div><b>long frames</b> (10 s) {s.longN}{s.longN ? ", worst " + f1(s.longWorst) + " ms" : ""}</div>
            {s.hist && <div><b>frames</b> {Object.entries(s.hist).map(([k, v]) => k + ":" + v).join(" ")}</div>}
        </div>
    );
}
