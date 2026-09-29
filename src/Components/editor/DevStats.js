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
    const Q = E.renderer && E.renderer.queue ? E.renderer.queue.report() : null;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const Z = E.cam.inScale * dpr, S = E.cfg.levelStep;
    const lv = L ? L.level : levelFor(Z, S);                            // the SVG path: the level the camera would read
    const since = Date.now() - 10000;
    const long = LF ? (LF.recent || []).filter((r) => r.t >= since) : [];
    return {
        S, lv, sigma: L ? L.s : Z / zOf(lv, S),
        mode: L ? L.mode : "svg", stretch: L ? L.s : null,
        paper: L ? [L.paperMs, L.blurMs, L.olderPatchMs, L.olderOtherMs] : null,
        rest: L ? [L.restInline, L.restWorker, L.restMs] : null,
        composes: L ? L.composes : null, maxImages: L ? L.imagesMax10s : null, composeMs: L ? L.composeMs : null,
        plates: P ? P.plates : null, mib: P ? P.plateBytes / MIB : null, capMib: P ? P.maxBytes / MIB : null,
        pinned: P ? P.pinned : null, stale: P && P.stale != null ? P.stale : null, inFlight: P ? P.inFlight : null,
        jobs: Q ? [Q.queued, Q.inFlight] : null,
        longN: long.length, longWorst: long.reduce((m, r) => Math.max(m, r.ms), 0),
        hist: F ? F.hist : null,
    };
}

const f1 = (v) => (v == null ? "–" : (+v).toFixed(1));

/**
 * The Dev panel's counters on a timer of their own (500 ms), so a zoom or an arrival never re-renders the
 * editor for them: the pyramid's view level and σ, paper/blur/older (older split: waiting for a worker patch, and
 * any other, which must stay 0), the rest executor, the images over 10 s, and the queue's jobs by priority.
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
            {s.paper && <div><b>paper</b> {f1(s.paper[0])} · blur {f1(s.paper[1])} · older {f1(s.paper[2])} patch / {f1(s.paper[3])} other ms</div>}
            {s.rest && <div><b>rest</b> inline {s.rest[0]} · workers {s.rest[1]} · last {f1(s.rest[2])} ms</div>}
            <div><b>plates</b> {s.plates ?? "–"} · {f1(s.mib)}/{f1(s.capMib)} MiB · pinned {s.pinned ?? "–"}{s.stale != null ? " · stale " + s.stale : ""} · in flight {s.inFlight ?? "–"}</div>
            {s.jobs && <div><b>jobs</b> queued {s.jobs[0].join("/")} · in flight {s.jobs[1].join("/")} (prio 0–5)</div>}
            <div><b>compose</b> {s.composes ?? "–"} · max {s.maxImages ?? "–"}/30 images (10 s) · {f1(s.composeMs)} ms total</div>
            <div><b>long frames</b> (10 s) {s.longN}{s.longN ? ", worst " + f1(s.longWorst) + " ms" : ""}</div>
            {s.hist && <div><b>frames</b> {Object.entries(s.hist).map(([k, v]) => k + ":" + v).join(" ")}</div>}
        </div>
    );
}
