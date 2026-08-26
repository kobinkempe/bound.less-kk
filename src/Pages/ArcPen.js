/**
 * ArcPen — a pen that draws in circular arcs, for feeling whether it is right.
 *
 * Nothing bakes here. This is the CENTERLINE question only: if a stroke were
 * two arcs per sample gap instead of one cubic per sample gap, would it still
 * feel like the same pen? Everything downstream (exact offsets, closed-form
 * crossings) only pays off if the answer is yes, so the answer is worth having
 * before any of it is built.
 *
 * Three views, because the difference is far too small to see in one:
 *
 *   ink          the arc pen, drawn fat by the browser's own arc rasteriser
 *                (`ctx.arc`, not a polyline) — this is the "does it feel right"
 *                view, and the only one that matters for the verdict
 *   centerlines  the two curves as hairlines, today's in blue over the arcs in
 *                orange, with the arc joints marked
 *   difference   both strokes rasterised fat and XORed, so ONLY disagreement is
 *                visible — a black screen means the two are the same shape
 *
 * The tolerance slider is the "split where the pen turns hard" control. At
 * "never" every gap gets exactly two arcs whatever the pen did; at a finite
 * value a gap that cannot follow the old curve that closely is halved and each
 * half gets its own biarc. Watch the arcs-per-gap readout: on ordinary writing
 * it barely moves off 2.00, which is the whole claim.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BiarcPen, chainFor, tracePath, arcPoint } from "../engine/geometry/biarc";
import { flattenCurve } from "../engine/geometry/clipperOutline";

const PRESETS = {
    "hairpin (sharp reversal)": () => {
        const p = [];
        for (let i = 0; i <= 20; i++) p.push([300 + i * 14, 620 - i * 20]);
        for (let i = 1; i <= 20; i++) p.push([580 - i * 12, 220 + i * 21]);
        return { pts: p, width: 70 };
    },
    "hesitation (bunched samples)": () => {
        const p = [];
        for (let i = 0; i <= 40; i++) p.push([160 + i * 12, 400 + 60 * Math.sin(i / 9)]);
        // the pen slows to a crawl: forty samples inside twelve units
        for (let i = 1; i <= 40; i++) p.push([640 + i * 0.3, 400 + 60 * Math.sin((40 + i / 20) / 9)]);
        for (let i = 1; i <= 40; i++) p.push([652 + i * 12, 380 + 70 * Math.cos(i / 7)]);
        return { pts: p, width: 70 };
    },
    "fast sweep (sparse)": () => ({
        pts: [[160, 640], [280, 380], [470, 220], [700, 200], [880, 330], [930, 560], [790, 690]],
        width: 70,
    }),
    "near-straight jitter": () => {
        const p = [];
        for (let i = 0; i <= 120; i++) {
            const t = i / 120;
            p.push([140 + t * 840, 420 + Math.sin(i * 2.7) * 0.6 + Math.cos(i * 5.1) * 0.4]);
        }
        return { pts: p, width: 70 };
    },
    "slow circle (dense)": () => {
        const p = [], n = 400;
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            p.push([560 + 240 * Math.cos(a), 430 + 240 * Math.sin(a)]);
        }
        return { pts: p, width: 90 };
    },
    "tight wiggle": () => {
        const p = [];
        for (let i = 0; i <= 24; i++) { const t = i / 24; p.push([120 + t * 820, 430 + 150 * Math.sin(t * 9)]); }
        return { pts: p, width: 90 };
    },
    "self-crossing": () => ({
        pts: [[200, 430], [450, 210], [700, 430], [450, 650], [340, 430], [600, 310]], width: 90,
    }),
};

const TOLS = [
    { label: "never split", v: 0 },
    { label: "1 unit", v: 1 },
    { label: "0.25 units", v: 0.25 },
    { label: "0.05 units", v: 0.05 },
    { label: "0.01 units", v: 0.01 },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const INK = "#e9873a", OLD = "#4d8bf0";
const DIFF_RGB = [255, 45, 85];   // written per-channel into the XOR bitmap

export default function ArcPen() {
    const canvasRef = useRef(null);
    const [mode, setMode] = useState("ink");
    const [width, setWidth] = useState(70);
    const [tol, setTol] = useState(0.25);
    const [showSamples, setShowSamples] = useState(false);
    const [showJoints, setShowJoints] = useState(false);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const [stats, setStats] = useState(null);
    const [diffPx, setDiffPx] = useState(null);
    const diffRef = useRef(null);
    const [showCubic, setShowCubic] = useState(false);

    const ptsRef = useRef([]);
    const penRef = useRef(null);
    const drawingRef = useRef(false);
    const panRef = useRef(null);
    const viewRef = useRef(view); viewRef.current = view;
    const widthRef = useRef(width); widthRef.current = width;
    const tolRef = useRef(tol); tolRef.current = tol;
    const modeRef = useRef(mode); modeRef.current = mode;
    const sampRef = useRef(showSamples); sampRef.current = showSamples;
    const jointRef = useRef(showJoints); jointRef.current = showJoints;
    const cubicRef = useRef(showCubic); cubicRef.current = showCubic;
    const [editPts, setEditPts] = useState(false);
    const editRef = useRef(editPts); editRef.current = editPts;
    const dragRef = useRef(null);      // index of the sample being dragged
    const hoverRef = useRef(-1);       // index under the cursor, for the highlight

    /** Nearest sample within `px` screen pixels, or -1. */
    const nearestSample = useCallback((p, px = 10) => {
        const pts = ptsRef.current;
        const lim = px / viewRef.current.scale;
        let best = -1, bd = lim;
        for (let i = 0; i < pts.length; i++) {
            const d = Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]);
            if (d <= bd) { bd = d; best = i; }
        }
        return best;
    }, []);

    // ---- painting ----------------------------------------------------------

    /** Today's stroke: the cardinal spline, flattened at display fidelity. */
    const traceSpline = (ctx, pts) => {
        const flat = pts.length > 2 ? flattenCurve(pts, 0.02 / viewRef.current.scale) : pts;
        ctx.moveTo(flat[0][0], flat[0][1]);
        for (let i = 1; i < flat.length; i++) ctx.lineTo(flat[i][0], flat[i][1]);
    };

    const paint = useCallback(() => {
        const cv = canvasRef.current;
        if (!cv) return;
        const ctx = cv.getContext("2d");
        const { scale, x, y } = viewRef.current;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#0d0f14";
        ctx.fillRect(0, 0, cv.width, cv.height);

        const pts = ptsRef.current;
        const pen = penRef.current;
        if (!pts.length || !pen) return;
        const gaps = pen.gaps;
        const w = widthRef.current;
        // An arc bowing less than a twentieth of a screen pixel is a line on
        // screen, and drawing it as one keeps huge radii away from the float32
        // rasteriser. Tied to the zoom, so zooming in re-promotes it to an arc.
        const flatTol = 0.05 / scale;
        const setT = () => ctx.setTransform(scale, 0, 0, scale, x, y);
        setT();

        if (modeRef.current === "difference" && pts.length > 1) {
            // The two fat strokes XORed. Anything that survives is a place the
            // two curves disagree by more than a pixel at this zoom — so the
            // honest way to look for trouble is to zoom in until something
            // appears, and read off how far in you had to go.
            const off = document.createElement("canvas");
            off.width = cv.width; off.height = cv.height;
            const oc = off.getContext("2d");
            oc.setTransform(scale, 0, 0, scale, x, y);
            oc.lineWidth = w; oc.lineCap = "round"; oc.lineJoin = "round"; oc.strokeStyle = "#fff";
            oc.beginPath(); traceSpline(oc, pts); oc.stroke();
            oc.globalCompositeOperation = "xor";
            oc.beginPath(); if (tracePath(oc, gaps, flatTol)) oc.stroke();

            // faint context, so you can see WHERE on the stroke you are
            ctx.globalAlpha = 0.16;
            ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = OLD;
            ctx.beginPath(); traceSpline(ctx, pts); ctx.stroke();
            ctx.globalAlpha = 1;

            // THRESHOLD, and this is the whole difficulty with the view. Along
            // every edge both strokes cover the same pixel about half — and XOR
            // of two half-covered pixels is a half-covered pixel. Taken raw the
            // outline lights up everywhere and the view reports disagreement on
            // two curves that are identical. Only near-full coverage is a real
            // miss, so anything under 3/4 is dropped: sub-pixel differences read
            // as agreement, which is exactly what "at this zoom" has to mean.
            const img = oc.getImageData(0, 0, off.width, off.height);
            const src = img.data;
            let n = 0;
            for (let i = 0; i < src.length; i += 4) {
                if (src[i + 3] > 190) {
                    src[i] = DIFF_RGB[0]; src[i + 1] = DIFF_RGB[1]; src[i + 2] = DIFF_RGB[2];
                    src[i + 3] = 255; n++;
                } else src[i + 3] = 0;
            }
            oc.putImageData(img, 0, 0);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(off, 0, 0);
            diffRef.current = n;
            setT();
        } else if (modeRef.current === "centerlines") {
            ctx.lineWidth = 1.6 / scale; ctx.lineCap = "round"; ctx.lineJoin = "round";
            ctx.strokeStyle = OLD;
            ctx.beginPath(); traceSpline(ctx, pts); ctx.stroke();
            ctx.strokeStyle = INK;
            ctx.setLineDash([7 / scale, 5 / scale]);
            ctx.beginPath(); if (tracePath(ctx, gaps, flatTol)) ctx.stroke();
            ctx.setLineDash([]);
        } else {
            // THE PEN. `ctx.arc` per piece — the browser rasterises true arcs,
            // so what is on screen is the arc representation itself and not a
            // polyline standing in for it.
            //
            // The A/B flip draws the SAME colour for both. Colouring them
            // differently would make every flip obviously "change" and tell you
            // nothing: the only thing worth seeing here is whether the SHAPE
            // moves, and a colour swap drowns that out. Which one is showing is
            // on the badge and on the button.
            ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
            ctx.strokeStyle = INK;
            ctx.beginPath();
            let drew = false;
            if (cubicRef.current) {
                if (pts.length > 1) { traceSpline(ctx, pts); drew = true; }
            } else drew = tracePath(ctx, gaps, flatTol);
            if (drew) ctx.stroke();
            else if (pts.length === 1) {
                ctx.fillStyle = INK;
                ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], w / 2, 0, Math.PI * 2); ctx.fill();
            }
        }

        if (jointRef.current) {
            ctx.fillStyle = "#3ddc97";
            const r = 2.2 / scale;
            for (const g of gaps) {
                for (let i = 0; i < g.length - 1; i++) {
                    const p = arcPoint(g[i], 1);
                    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
        if (sampRef.current && !editRef.current) {
            ctx.fillStyle = "#ffffff";
            const r = 2.4 / scale;
            for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); }
        }
        if (editRef.current) {
            // Grabbable handles: rings, so you can see the curve through them,
            // and a fixed SCREEN size so they stay grabbable at every zoom.
            const r = 5 / scale;
            ctx.lineWidth = 1.5 / scale;
            for (let i = 0; i < pts.length; i++) {
                const on = i === hoverRef.current || i === dragRef.current;
                ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], on ? r * 1.5 : r, 0, Math.PI * 2);
                ctx.fillStyle = on ? "#3ddc97" : "#0d0f14";
                ctx.strokeStyle = on ? "#3ddc97" : "#ffffff";
                ctx.fill(); ctx.stroke();
            }
        }

        // Which one is on screen, on the screen. Flipping fast is the only way
        // to see a sub-pixel difference, and looking away at the sidebar to
        // check is exactly what breaks that.
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (modeRef.current === "ink") {
            ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = cubicRef.current ? "#4d8bf0" : "#e9873a";
            ctx.fillText(cubicRef.current ? "cubic — today" : "arcs", 14, 24);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }, []);

    useEffect(() => { paint(); }, [paint, view, mode, width, showSamples, showJoints, showCubic]);

    // Space (or F) flips. A keyboard flip is the point: the difference is
    // sub-pixel on ordinary writing, and the only way to see one is to switch
    // between the two fast with your eye already on the stroke.
    useEffect(() => {
        const onKey = (e) => {
            if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
            if (e.key === " " || e.key === "f" || e.key === "F") {
                e.preventDefault();
                setShowCubic((v) => !v);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // `paint` runs first (effects fire in declaration order) and leaves its count
    // in a ref. Returning `prev` unchanged makes React bail out rather than
    // re-render, so this cannot loop back into paint.
    //
    // Deliberately dependency-free: the count changes whenever paint runs — a
    // zoom, a pan, a width nudge — and none of that is expressible as a
    // dependency list, because the value being read lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const n = mode === "difference" ? diffRef.current : null;
        setDiffPx((prev) => (prev === n ? prev : n));
    });

    // A window `resize` listener is not enough: this page can mount while its
    // container still measures zero (a hidden pane, a tab that is sized after
    // load), and then the backing store stays 0x0 while the element itself lays
    // out fine — a canvas that is present, correct and completely blank.
    // ResizeObserver fires once on observe, so that case recovers by itself.
    useEffect(() => {
        const cv = canvasRef.current;
        if (!cv) return undefined;
        const fit = () => {
            const r = cv.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.floor(r.width * dpr));
            const h = Math.max(1, Math.floor(r.height * dpr));
            if (cv.width === w && cv.height === h) return;
            cv.width = w; cv.height = h;
            paint();
        };
        fit();
        const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
        if (ro) ro.observe(cv);
        window.addEventListener("resize", fit);
        return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", fit); };
    }, [paint]);

    // ---- measuring ---------------------------------------------------------

    const measure = useCallback((ms) => {
        const pts = ptsRef.current;
        if (pts.length < 2) { setStats(null); return; }
        const { stats: s } = chainFor(pts, { tol: tolRef.current });
        setStats({ ...s, ms });
    }, []);

    /**
     * Rebuild the whole stroke — used when a control changes, not while drawing.
     * `withStats` is off during a drag: the readouts run a second full pass, and
     * paying for it on every pointermove is what would make dragging feel heavy.
     */
    const rebuild = useCallback((withStats = true) => {
        const pts = ptsRef.current;
        if (!pts.length) return;
        const t0 = performance.now();
        const pen = new BiarcPen({ tol: tolRef.current });
        for (const p of pts) pen.addSample(p);
        const ms = +(performance.now() - t0).toFixed(1);
        penRef.current = pen;
        paint();
        if (withStats) measure(ms);
    }, [paint, measure]);

    useEffect(() => { rebuild(); }, [tol, rebuild]);

    // ---- pointer -----------------------------------------------------------

    const toWorld = (e) => {
        const cv = canvasRef.current, r = cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const { scale, x, y } = viewRef.current;
        return [((e.clientX - r.left) * dpr - x) / scale, ((e.clientY - r.top) * dpr - y) / scale];
    };

    const onDown = (e) => {
        if (e.button === 1 || e.button === 2 || e.shiftKey) {
            e.currentTarget.setPointerCapture(e.pointerId);
            panRef.current = { x: e.clientX, y: e.clientY };
            return;
        }
        const p = toWorld(e);

        // EDIT MODE. Grabbing a sample must not also start a new stroke, and
        // missing one must not either — losing the stroke you were adjusting
        // because you clicked slightly wide of a handle is the worst thing this
        // mode could do.
        if (editRef.current) {
            const i = nearestSample(p);
            if (i < 0) return;
            if (e.altKey && ptsRef.current.length > 2) {
                ptsRef.current.splice(i, 1);
                hoverRef.current = -1;
                rebuild();
                return;
            }
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = i;
            paint();
            return;
        }

        e.currentTarget.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        ptsRef.current = [];
        penRef.current = new BiarcPen({ tol: tolRef.current });
        setStats(null);
        ptsRef.current.push(p);
        penRef.current.addSample(p);
        paint();
    };

    /** Double-click near the curve inserts a sample there. */
    const onDoubleClick = (e) => {
        if (!editRef.current) return;
        const pts = ptsRef.current;
        if (pts.length < 2) return;
        const p = toWorld(e);
        let best = -1, bd = Infinity;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
            let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
            t = clamp(t, 0, 1);
            const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
            if (d < bd) { bd = d; best = i; }
        }
        if (best < 0 || bd > 40 / viewRef.current.scale) return;
        pts.splice(best, 0, p);
        rebuild();
    };

    const onMove = (e) => {
        if (panRef.current) {
            const dpr = window.devicePixelRatio || 1;
            const dx = (e.clientX - panRef.current.x) * dpr, dy = (e.clientY - panRef.current.y) * dpr;
            panRef.current = { x: e.clientX, y: e.clientY };
            setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
            return;
        }
        if (dragRef.current != null) {
            ptsRef.current[dragRef.current] = toWorld(e);
            rebuild(false);
            return;
        }
        if (editRef.current && !drawingRef.current) {
            const i = nearestSample(toWorld(e));
            if (i !== hoverRef.current) { hoverRef.current = i; paint(); }
            return;
        }
        if (!drawingRef.current) return;
        let evs = [e.nativeEvent];
        if (typeof e.nativeEvent.getCoalescedEvents === "function") {
            const c = e.nativeEvent.getCoalescedEvents();
            if (c && c.length) evs = c;
        }
        for (const ev of evs) {
            const p = toWorld(ev.clientX != null ? ev : e);
            const last = ptsRef.current[ptsRef.current.length - 1];
            // Drop sub-pixel repeats the way the real pen does. Keeping them is
            // not harmless: two samples a thousandth of a unit apart give a
            // tangent estimate made entirely of rounding.
            if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.6 / viewRef.current.scale) continue;
            ptsRef.current.push(p);
            penRef.current.addSample(p);
        }
        paint();
    };

    const onUp = () => {
        if (panRef.current) { panRef.current = null; return; }
        if (dragRef.current != null) { dragRef.current = null; rebuild(); return; }
        if (!drawingRef.current) return;
        drawingRef.current = false;
        measure(null);
    };

    const loadPreset = (name) => {
        const { pts, width: w } = PRESETS[name]();
        setWidth(w); widthRef.current = w;
        ptsRef.current = pts;
        rebuild();
    };

    const zoomBy = (f) => setView((v) => {
        const cv = canvasRef.current;
        const cx = cv.width / 2, cy = cv.height / 2;
        const s = clamp(v.scale * f, 0.05, 6000);
        return { scale: s, x: cx - (cx - v.x) * (s / v.scale), y: cy - (cy - v.y) * (s / v.scale) };
    });

    const onWheel = (e) => {
        const cv = canvasRef.current, r = cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
        setView((v) => {
            const s = clamp(v.scale * Math.pow(1.0015, -e.deltaY), 0.05, 6000);
            return { scale: s, x: px - (px - v.x) * (s / v.scale), y: py - (py - v.y) * (s / v.scale) };
        });
    };

    const perGap = stats && stats.gaps ? (stats.arcs / stats.gaps) : null;
    const MUT = "#8b93a7";

    return (
        <div style={{ position: "fixed", inset: 0, background: "#0d0f14", color: "#e7e9ee",
            font: "13px/1.5 ui-sans-serif, system-ui, sans-serif", display: "flex" }}>
            <div style={{ width: 300, flex: "0 0 300px", padding: 16, background: "#1b1e26",
                overflowY: "auto", overflowX: "hidden", borderRight: "1px solid #262b36", boxSizing: "border-box" }}>
                <div style={{ fontSize: 15, marginBottom: 4 }}>Arc Pen</div>
                <div style={{ color: MUT, marginBottom: 14 }}>
                    Two circular arcs per sample gap instead of one cubic. Draw on the right.
                    Nothing bakes — this is the centerline only.
                </div>

                <Label>View</Label>
                {[["ink", "ink — the arc pen"],
                  ["centerlines", "centerlines — both curves"],
                  ["difference", "difference — only disagreement"]].map(([k, t]) => (
                    <label key={k} style={{ display: "block", marginBottom: 4, cursor: "pointer" }}>
                        <input type="radio" checked={mode === k} onChange={() => setMode(k)} /> {t}
                    </label>
                ))}
                {mode === "difference" && (
                    <div style={{ color: MUT, fontSize: 12 }}>
                        black means the two shapes agree to within a pixel at this zoom — zoom in
                        until something shows
                    </div>
                )}

                {/* A view switch, not a rebuild: the arc chain is still there
                    behind it, so flipping compares the same two things instead
                    of comparing two different strokes. */}
                <Label>Flip the ink</Label>
                <button
                    style={{ ...btn, width: "100%", marginBottom: 2,
                        background: showCubic ? "#1d3a63" : btn.background,
                        borderColor: showCubic ? "#4d8bf0" : btn.borderColor,
                        color: showCubic ? "#9dc2ff" : btn.color }}
                    onClick={() => setShowCubic((v) => !v)}>
                    {showCubic ? "showing CUBIC — click for arcs" : "showing ARCS — click for cubic"}
                </button>
                <div style={{ color: MUT, fontSize: 12, marginBottom: 4 }}>
                    space or F flips it · nothing is recomputed, so the two are the same stroke
                    {mode !== "ink" && <span style={{ color: "#ffc857" }}> · applies to the ink view</span>}
                </div>

                <Label>Split where the pen turns hard</Label>
                {TOLS.map((t) => (
                    <label key={t.label} style={{ display: "block", marginBottom: 4, cursor: "pointer" }}>
                        <input type="radio" checked={tol === t.v} onChange={() => setTol(t.v)} /> {t.label}
                    </label>
                ))}
                <div style={{ color: MUT, fontSize: 12 }}>
                    a gap that cannot follow today's curve this closely is halved, and each half
                    gets its own pair of arcs
                </div>

                <Label>Width — {width}</Label>
                <input type="range" min="2" max="220" value={width} style={{ width: "100%" }}
                    onChange={(e) => { const w = +e.target.value; setWidth(w); widthRef.current = w; paint(); }} />

                <Label>Overlays</Label>
                <label style={{ display: "block", cursor: "pointer" }}>
                    <input type="checkbox" checked={showSamples} onChange={() => setShowSamples((v) => !v)} /> pen samples
                </label>
                <label style={{ display: "block", cursor: "pointer" }}>
                    <input type="checkbox" checked={showJoints} onChange={() => setShowJoints((v) => !v)} /> arc joints
                </label>
                <label style={{ display: "block", cursor: "pointer", marginTop: 6 }}>
                    <input type="checkbox" checked={editPts} onChange={() => { setEditPts((v) => !v); hoverRef.current = -1; }} />
                    {" "}drag the centerline
                </label>
                {editPts && (
                    <div style={{ color: MUT, fontSize: 12 }}>
                        drag a handle to move that sample · alt-click removes one · double-click on the
                        curve adds one · drawing is off while this is on
                    </div>
                )}

                <Label>Presets</Label>
                {Object.keys(PRESETS).map((n) => (
                    <button key={n} onClick={() => loadPreset(n)} style={btn}>{n}</button>
                ))}

                <Label>Zoom — {view.scale < 10 ? view.scale.toFixed(2) : Math.round(view.scale)}x</Label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={btn} onClick={() => zoomBy(1 / 4)}>÷4</button>
                    <button style={btn} onClick={() => zoomBy(4)}>×4</button>
                    <button style={btn} onClick={() => zoomBy(30)}>×30</button>
                    <button style={btn} onClick={() => setView({ scale: 1, x: 0, y: 0 })}>reset</button>
                </div>
                <div style={{ color: MUT, marginTop: 6, fontSize: 11 }}>
                    scroll to zoom · shift-drag or right-drag to pan
                </div>

                {stats && (
                    <div style={{ marginTop: 18, borderTop: "1px solid #262b36", paddingTop: 12 }}>
                        <Row k="samples" v={stats.samples} />
                        <Row k="gaps" v={stats.gaps} />
                        <Row k="arcs" v={stats.arcs} />
                        <Row k="arcs per gap" v={perGap ? perGap.toFixed(2) : "—"} hot={perGap > 3} />
                        <Row k="gaps split" v={`${stats.splitGaps} of ${stats.gaps}`} />
                        <Row k="worst shift vs today" v={`${stats.worstDev.toFixed(3)} units`}
                            hot={stats.worstDev > Math.max(tol * 1.6, 0.001) && tol > 0} />
                        <Row k="smallest arc radius" v={stats.minRadius == null ? "—" : stats.minRadius.toFixed(2)}
                            hot={stats.minRadius != null && stats.minRadius < width / 2} />
                        {stats.ms != null && <Row k="rebuild" v={`${stats.ms} ms`} />}
                        {mode === "difference" && diffPx != null &&
                            <Row k="pixels that disagree" v={diffPx} hot={diffPx > 0} />}
                        <div style={{ color: MUT, fontSize: 11, marginTop: 8 }}>
                            "worst shift" is the furthest the arc curve strays from the curve the
                            app draws today, anywhere in the stroke.
                        </div>
                    </div>
                )}
            </div>

            <canvas ref={canvasRef}
                style={{ flex: "1 1 0", minWidth: 0, touchAction: "none",
                    cursor: editPts ? "grab" : "crosshair" }}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                onDoubleClick={onDoubleClick}
                onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
        </div>
    );
}

const btn = { background: "#232833", color: "#e7e9ee", border: "1px solid #333a49",
    borderRadius: 5, padding: "5px 9px", marginRight: 6, marginBottom: 6, cursor: "pointer", font: "inherit" };
const Label = ({ children }) => <div style={{ marginTop: 16, marginBottom: 6, color: "#8b93a7" }}>{children}</div>;
const Row = ({ k, v, hot }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "#8b93a7" }}>{k}</span>
        <span style={{ color: hot ? "#ff6b6b" : "#e7e9ee", textAlign: "right" }}>{v}</span>
    </div>
);
