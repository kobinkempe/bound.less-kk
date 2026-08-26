/**
 * ArcBake — the perimeter lab, rebuilt on arcs.
 *
 * Same instrument as BakeLab and the same question: draw a stroke, watch it
 * become one resolved outline at pen-up, and see whether the shape moves when
 * it does. What changed underneath is the representation — the pen lays down
 * biarcs, so both offsets are exact concentric arcs and every crossing is a
 * circle-circle root rather than a Newton polish on a fitted curve.
 *
 * The colour flip is the whole instrument. While raw the stroke is ORANGE,
 * stroked by Chrome from the arc chain. The instant the perimeter lands it is
 * replaced by a GREEN fill built from the resolved arcs, with the perimeter
 * itself drawn over it as a RED HAIRLINE. A solid fill hides a fabricated edge
 * and hides a crease; the hairline does not.
 *
 * Two readouts decide whether it worked, and both were the difficulty on the
 * cubic version:
 *
 *   open chains  a boundary that failed to close. Every one of these becomes a
 *                straight line painted across the shape by the fill rule — the
 *                wedges. This has to be zero.
 *   unbalanced   junctions entered more often than they are left. This is the
 *                upstream cause; F20 had 121 of them on a heavy fill-in stroke.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BiarcPen, tracePath } from "../engine/geometry/biarc";
import { bakeArcPerimeter, traceLoops } from "../engine/geometry/arcPerimeter";
import { BAKERS } from "../engine/geometry/bakeStrategies";
import { flattenCurve } from "../engine/geometry/clipperOutline";

const PRESETS = {
    "tight wiggle": () => {
        const p = [];
        for (let i = 0; i <= 24; i++) { const t = i / 24; p.push([120 + t * 820, 430 + 150 * Math.sin(t * 9)]); }
        return { pts: p, width: 90 };
    },
    "self-crossing": () => ({
        pts: [[200, 430], [450, 210], [700, 430], [450, 650], [340, 430], [600, 310]], width: 90,
    }),
    "hand-drawn ring (dense)": () => {
        const p = [], n = 520;
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            const wob = 1 + 0.05 * Math.sin(a * 3) + 0.03 * Math.cos(a * 7);
            p.push([560 + 250 * wob * Math.cos(a), 430 + 250 * wob * Math.sin(a)]);
        }
        return { pts: p, width: 90 };
    },
    "the scribble (3,775 pts)": () => {
        const W = 521, H = 465, rows = 151, cols = 24, p = [];
        for (let row = 0; row < rows; row++) {
            const y = 140 + (row / (rows - 1)) * H;
            for (let k = 0; k <= cols; k++) p.push([260 + (row % 2 === 0 ? k / cols : 1 - k / cols) * W, y]);
        }
        return { pts: p, width: 90 };
    },
};

// The two strokes captured from the real pen, served from /public so the lab
// can bake the same geometry the measurements were taken on.
const CAPTURED = {
    "captured stroke (4,962 pts)": "arcbake-stroke.json",
    "captured fill-in (6,791 pts)": "arcbake-stroke2.json",
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RAW = "#e9873a", FILL = "#3ddc97", HAIR = "#ff2d55";

export default function ArcBake() {
    const canvasRef = useRef(null);
    const [width, setWidth] = useState(90);
    const [tol, setTol] = useState(0.25);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const [stats, setStats] = useState(null);
    const [accuracy, setAccuracy] = useState(null);
    const [showRaw, setShowRaw] = useState(false);
    const [busy, setBusy] = useState(false);
    const [versus, setVersus] = useState(null);

    const ptsRef = useRef([]);
    const penRef = useRef(null);
    const loopsRef = useRef(null);
    const drawingRef = useRef(false);
    const panRef = useRef(null);
    const viewRef = useRef(view); viewRef.current = view;
    const widthRef = useRef(width); widthRef.current = width;
    const tolRef = useRef(tol); tolRef.current = tol;
    const rawRef = useRef(showRaw); rawRef.current = showRaw;

    // ---- painting ----------------------------------------------------------
    const paint = useCallback(() => {
        const cv = canvasRef.current;
        if (!cv) return;
        const ctx = cv.getContext("2d");
        const { scale, x, y } = viewRef.current;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#0d0f14";
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.setTransform(scale, 0, 0, scale, x, y);

        const flatTol = 0.05 / scale;
        // A view switch, not an undo: the bake stays in `loopsRef`, so flipping
        // compares the same two things rather than two different strokes.
        const loops = rawRef.current ? null : loopsRef.current;
        if (loops) {
            ctx.beginPath();
            traceLoops(ctx, loops, flatTol);
            ctx.fillStyle = FILL;
            ctx.fill("nonzero");
            ctx.lineWidth = 1 / scale;
            ctx.strokeStyle = HAIR;
            ctx.lineJoin = "round";
            ctx.stroke();
        } else if (penRef.current && ptsRef.current.length) {
            ctx.lineWidth = widthRef.current;
            ctx.lineCap = "round"; ctx.lineJoin = "round";
            ctx.strokeStyle = RAW;
            ctx.beginPath();
            if (!tracePath(ctx, penRef.current.gaps, flatTol) && ptsRef.current.length === 1) {
                const p = ptsRef.current[0];
                ctx.beginPath(); ctx.arc(p[0], p[1], widthRef.current / 2, 0, Math.PI * 2);
                ctx.fillStyle = RAW; ctx.fill();
            } else ctx.stroke();
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }, []);

    useEffect(() => { paint(); }, [paint, view, showRaw]);

    useEffect(() => {
        const cv = canvasRef.current;
        if (!cv) return undefined;
        const fit = () => {
            const r = cv.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.floor(r.width * dpr)), h = Math.max(1, Math.floor(r.height * dpr));
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

    // ---- the bake ----------------------------------------------------------
    const bake = useCallback(() => {
        const pts = ptsRef.current;
        if (pts.length < 1) return;
        setBusy(true);
        // Yield first, so the freeze is visible rather than hidden behind a
        // paint that never happened — the pause IS one of the measurements.
        setTimeout(() => {
            const t0 = performance.now();
            const { loops, stats: st } = bakeArcPerimeter(pts, widthRef.current, { tol: tolRef.current });
            const wall = performance.now() - t0;
            loopsRef.current = loops;
            window.__arclab = { pts, width: widthRef.current, loops, stats: st };
            setBusy(false);
            setStats({ ...st, wall: +wall.toFixed(1) });
            paint();
            setAccuracy(measureAccuracy(pts, widthRef.current, loops, viewRef.current));
        }, 20);
    }, [paint]);

    /**
     * The same stroke through the cubic pipeline, timed here rather than in a
     * test runner. Comparing a browser number against a jsdom number is not a
     * comparison — the two JITs are not the same machine — so the only honest
     * A/B is both of them on this thread, back to back.
     */
    const compareCubic = useCallback(() => {
        const pts = ptsRef.current;
        if (!pts.length) return;
        setBusy(true);
        setTimeout(() => {
            const w = widthRef.current;
            let arc = Infinity, cub = Infinity, arcLoops = 0, cubLoops = 0, cubPieces = 0;
            for (let k = 0; k < 3; k++) {          // best of three: JIT warm-up is not the result
                let t0 = performance.now();
                const a = bakeArcPerimeter(pts, w, { tol: tolRef.current });
                arc = Math.min(arc, performance.now() - t0);
                arcLoops = a.loops.length;
                t0 = performance.now();
                const b = new BAKERS.A(w, { fitTol: 0.1, lineTol: 0.1, enterScale: 1 });
                for (const p of pts) b.addSample(p);
                const o = b.finish();
                cub = Math.min(cub, performance.now() - t0);
                cubLoops = o.loops.length;
                cubPieces = o.loops.reduce((n, l) => n + l.length, 0);
            }
            setBusy(false);
            setVersus({ arc: +arc.toFixed(1), cub: +cub.toFixed(1), arcLoops, cubLoops, cubPieces });
        }, 20);
    }, []);

    const rebake = useCallback(() => {
        const pts = ptsRef.current;
        if (!pts.length || drawingRef.current) return;
        const pen = new BiarcPen({ tol: tolRef.current });
        for (const p of pts) pen.addSample(p);
        penRef.current = pen;
        loopsRef.current = null;
        paint();
        bake();
    }, [bake, paint]);

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
        e.currentTarget.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        ptsRef.current = [];
        loopsRef.current = null;
        penRef.current = new BiarcPen({ tol: tolRef.current });
        setStats(null); setAccuracy(null); setVersus(null);
        const p = toWorld(e);
        ptsRef.current.push(p);
        penRef.current.addSample(p);
        paint();
    };
    const onMove = (e) => {
        if (panRef.current) {
            const dpr = window.devicePixelRatio || 1;
            const dx = (e.clientX - panRef.current.x) * dpr, dy = (e.clientY - panRef.current.y) * dpr;
            panRef.current = { x: e.clientX, y: e.clientY };
            setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
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
            if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.6 / viewRef.current.scale) continue;
            ptsRef.current.push(p);
            penRef.current.addSample(p);
        }
        paint();
    };
    const onUp = () => {
        if (panRef.current) { panRef.current = null; return; }
        if (!drawingRef.current) return;
        drawingRef.current = false;
        bake();
    };

    const loadPreset = (name) => {
        const { pts, width: w } = PRESETS[name]();
        setWidth(w); widthRef.current = w;
        ptsRef.current = pts;
        rebake();
    };
    const loadCaptured = (name) => {
        setBusy(true);
        fetch(`${process.env.PUBLIC_URL || ""}/${CAPTURED[name]}`)
            .then((r) => r.json())
            .then((s) => {
                setWidth(s.width); widthRef.current = s.width;
                ptsRef.current = s.pts;
                rebake();
            })
            .catch(() => { setBusy(false); setStats(null); });
    };

    const zoomBy = (f) => setView((v) => {
        const cv = canvasRef.current;
        const cx = cv.width / 2, cy = cv.height / 2;
        const s = clamp(v.scale * f, 0.02, 6000);
        return { scale: s, x: cx - (cx - v.x) * (s / v.scale), y: cy - (cy - v.y) * (s / v.scale) };
    });
    const onWheel = (e) => {
        const cv = canvasRef.current, r = cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
        setView((v) => {
            const s = clamp(v.scale * Math.pow(1.0015, -e.deltaY), 0.02, 6000);
            return { scale: s, x: px - (px - v.x) * (s / v.scale), y: py - (py - v.y) * (s / v.scale) };
        });
    };

    const MUT = "#8b93a7";
    return (
        <div style={{ position: "fixed", inset: 0, background: "#0d0f14", color: "#e7e9ee",
            font: "13px/1.5 ui-sans-serif, system-ui, sans-serif", display: "flex" }}>
            <div style={{ width: 310, flex: "0 0 310px", padding: 16, background: "#1b1e26",
                overflowY: "auto", overflowX: "hidden", borderRight: "1px solid #262b36", boxSizing: "border-box" }}>
                <div style={{ fontSize: 15, marginBottom: 4 }}>Arc Bake</div>
                <div style={{ color: MUT, marginBottom: 14 }}>
                    Biarc pen, schedule A, exact offsets.
                    <span style={{ color: RAW }}> Orange = raw.</span>
                    <span style={{ color: FILL }}> Green = baked.</span>
                    <span style={{ color: HAIR }}> Red hairline = the perimeter itself.</span>
                </div>

                <Label>Compare</Label>
                <button style={{ ...btn, width: "100%",
                    background: showRaw ? "#4a2d18" : btn.background,
                    borderColor: showRaw ? RAW : btn.borderColor,
                    color: showRaw ? "#ffcf9d" : btn.color }}
                    onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? "showing RAW — click for baked" : "show the raw stroke"}
                </button>
                <div style={{ color: MUT, fontSize: 12 }}>the bake is kept either way</div>

                <Label>Centerline tolerance — {tol}</Label>
                {[0, 1, 0.25, 0.05].map((v) => (
                    <label key={v} style={{ display: "block", cursor: "pointer" }}>
                        <input type="radio" checked={tol === v} onChange={() => { setTol(v); tolRef.current = v; rebake(); }} />
                        {" "}{v === 0 ? "never split" : `${v} units`}
                    </label>
                ))}

                <Label>Width — {width}</Label>
                <input type="range" min="6" max="220" value={width} style={{ width: "100%" }}
                    onChange={(e) => { const w = +e.target.value; setWidth(w); widthRef.current = w; rebake(); }} />

                <Label>Presets</Label>
                {Object.keys(PRESETS).map((n) => <button key={n} onClick={() => loadPreset(n)} style={btn}>{n}</button>)}
                <Label>Captured from the real pen</Label>
                {Object.keys(CAPTURED).map((n) => <button key={n} onClick={() => loadCaptured(n)} style={btn}>{n}</button>)}

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

                {busy && <div style={{ marginTop: 16, color: "#ffc857" }}>baking…</div>}

                {stats && (
                    <>
                    <Label>Against the cubic pipeline</Label>
                    <button style={{ ...btn, width: "100%" }} onClick={compareCubic}>
                        time both, best of three
                    </button>
                    {versus && (
                        <div style={{ marginBottom: 6 }}>
                            <Row k="arcs" v={`${versus.arc} ms · ${versus.arcLoops} loops`} />
                            <Row k="cubics (schedule A)" v={`${versus.cub} ms · ${versus.cubLoops} loops · ${versus.cubPieces} pieces`} />
                            <Row k="speedup" v={`${(versus.cub / versus.arc).toFixed(2)}x`} />
                        </div>
                    )}
                    <div style={{ marginTop: 18, borderTop: "1px solid #262b36", paddingTop: 12 }}>
                        <Row k="samples" v={stats.samples} />
                        <Row k="centerline arcs" v={`${stats.centreArcs} (${stats.arcsPerGap}/gap)`} />
                        <Row k="at pen-up" v={`${stats.wall} ms`} hot={stats.wall > 400} />
                        <Row k="crossings" v={stats.crossings} />
                        <Row k="result" v={`${stats.kept} pieces / ${stats.loops} loops`} />
                        <Row k="open chains" v={stats.openChains} hot={stats.openChains > 0} />
                        <Row k="unbalanced junctions" v={stats.unbalanced} hot={stats.unbalanced > 0} />
                        <div style={{ color: MUT, marginTop: 6, fontSize: 11 }}>
                            {Object.entries(stats.phases).map(([k, v]) => `${k} ${v}`).join(" · ")}
                        </div>
                    </div>
                    </>
                )}

                {accuracy && accuracy.worstUnits != null && (
                    <div style={{ marginTop: 14, borderTop: "1px solid #262b36", paddingTop: 12 }}>
                        <div style={{ color: MUT, marginBottom: 6 }}>vs Chrome&apos;s own stroke</div>
                        <Row k="wrong INSIDE the shape" v={accuracy.interiorWrong}
                            hot={accuracy.interiorWrong > 0} />
                        <Row k="wrong on the outline" v={`${accuracy.edgeWrong} of ${accuracy.edgePixels}`} />
                        <Row k="worst error reaches" v={`${accuracy.worstUnits.toFixed(2)} units`}
                            hot={accuracy.worstUnits > width * 0.02} />
                        <div style={{ color: MUT, fontSize: 11 }}>
                            only the first line is a defect. Outline pixels flip because both
                            images are antialiased and thresholded at half coverage, and because
                            a fat stroke and a filled polygon do not rasterise identically —
                            expect a fraction of them to disagree on any correct shape.
                        </div>
                        <div style={{ color: MUT, fontSize: 11, marginTop: 4 }}>
                            measured at {accuracy.resolution.toFixed(2)} units per pixel, against
                            Chrome stroking the OLD spline — so the {tol} unit centerline
                            tolerance shows up here too
                        </div>
                    </div>
                )}
            </div>

            <canvas ref={canvasRef} style={{ flex: "1 1 0", minWidth: 0, touchAction: "none", cursor: "crosshair" }}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
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

/**
 * Rasterise the baked shape against Chrome's own fat stroke and report how FAR
 * the disagreement reaches, in screen pixels. Counting mismatched pixels alone
 * is misleading — a half-pixel offset along a long edge differs everywhere —
 * so a chamfer transform runs out from the truth's edge and the worst mismatch
 * distance is what gets reported. That is what "within a quarter pixel" means.
 */
function measureAccuracy(pts, width, loops, view) {
    if (pts.length < 2 || !loops || !loops.length) return null;
    const S = 900;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    const pad = width;
    const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    const sc = Math.min(S / w, S / h);
    const mk = (draw) => {
        const cv = document.createElement("canvas");
        cv.width = Math.max(4, Math.ceil(w * sc)); cv.height = Math.max(4, Math.ceil(h * sc));
        const c = cv.getContext("2d");
        c.fillStyle = "#000"; c.fillRect(0, 0, cv.width, cv.height);
        c.setTransform(sc, 0, 0, sc, -(x0 - pad) * sc, -(y0 - pad) * sc);
        c.fillStyle = "#fff"; c.strokeStyle = "#fff";
        draw(c);
        return c.getImageData(0, 0, cv.width, cv.height);
    };
    const truth = mk((c) => {
        const flat = pts.length > 2 ? flattenCurve(pts, 0.02 / sc) : pts;
        c.beginPath();
        c.moveTo(flat[0][0], flat[0][1]);
        for (let i = 1; i < flat.length; i++) c.lineTo(flat[i][0], flat[i][1]);
        c.lineWidth = width; c.lineCap = "round"; c.lineJoin = "round";
        c.stroke();
    });
    const baked = mk((c) => { c.beginPath(); traceLoops(c, loops, 0.02 / sc); c.fill("nonzero"); });

    const W = Math.ceil(w * sc), H = Math.ceil(h * sc);
    const on = (d, i) => d.data[i * 4] > 127;
    const dist = new Float32Array(W * H).fill(1e9);
    for (let i = 0; i < W * H; i++) {
        const a = on(truth, i);
        const nx = i % W, ny = (i / W) | 0;
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const mx = nx + dx, my = ny + dy;
            if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
            if (on(truth, my * W + mx) !== a) { edge = true; break; }
        }
        if (edge) dist[i] = 0;
    }
    for (let p = 0; p < 2; p++) {
        const fwd = p === 0;
        for (let k = 0; k < W * H; k++) {
            const i = fwd ? k : W * H - 1 - k;
            const nx = i % W, ny = (i / W) | 0;
            for (const [dx, dy] of fwd ? [[-1, 0], [0, -1]] : [[1, 0], [0, 1]]) {
                const mx = nx + dx, my = ny + dy;
                if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
                const cand = dist[my * W + mx] + 1;
                if (cand < dist[i]) dist[i] = cand;
            }
        }
    }
    // Split the disagreement by WHERE it is, because the two kinds mean
    // opposite things. A pixel on the outline can flip for reasons that are not
    // defects: both images are antialiased and thresholded at half coverage, and
    // they are drawn by different Skia paths (a fat stroke against a filled
    // polygon), which flips edge pixels even for identical geometry. A pixel in
    // the INTERIOR cannot flip for any of those reasons — that is a fabricated
    // edge, a missing lobe, a hole that should not be there. Reporting one total
    // buried the second number inside the first.
    let wrong = 0, inked = 0, worst = 0, edgeWrong = 0, interiorWrong = 0, edgePixels = 0;
    for (let i = 0; i < W * H; i++) {
        const a = on(truth, i), b = on(baked, i);
        if (a) inked++;
        if (dist[i] === 0) edgePixels++;
        if (a !== b) {
            wrong++;
            if (dist[i] > worst) worst = dist[i];
            if (dist[i] === 0) edgeWrong++; else interiorWrong++;
        }
    }
    // `worst` is a chamfer distance in COMPARISON-RASTER pixels, so it converts
    // to world units by dividing by the raster scale. Reporting it as-is was
    // reporting a number in units of "however big a raster pixel happened to
    // be", which on a 2,000-unit stroke was five world units per pixel — a
    // metric that cannot see the thing it is supposed to be checking. The
    // resolution goes out with it so the number can be read honestly.
    return { wrong, inked, worstUnits: worst / sc, resolution: 1 / sc,
        edgeWrong, interiorWrong, edgePixels };
}

