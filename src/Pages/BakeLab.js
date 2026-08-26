/**
 * BakeLab — a stripped-down engine for feeling the three bake schedules.
 *
 * Not the real editor: no levels, no tiles, no persistence. One stroke, one
 * width, one camera. The point is to answer questions the unit tests cannot:
 * does the pen feel laggy while B works, does the pen-up pause in A and C read
 * as a hitch, and does the swap from Chrome's stroke to the baked shape show.
 *
 * The colour flip is the whole instrument. While a stroke is raw it draws in
 * BLUE, using the browser's own stroking. The instant the perimeter lands it is
 * replaced by a GREEN filled shape built from the baked cubics. If the bake is
 * faithful the shape does not move when the colour changes; if it is not, you
 * see it jump, and you can zoom in first to make a small error visible.
 *
 * Accuracy is measured the same way you would judge it by eye, but counted:
 * both versions are rasterised into offscreen canvases, XORed, and the
 * mismatched pixels are reported as a distance in SCREEN pixels via a chamfer
 * distance transform from the truth's edge. That number is what "within a
 * quarter pixel" has to mean in practice.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BAKERS, BAKER_NAMES } from "../engine/geometry/bakeStrategies";
import { cubicAt } from "../engine/geometry/curveOutline";
import { flattenCurve } from "../engine/geometry/clipperOutline";

const PRESETS = {
    "pen line": () => {
        const p = [];
        for (let i = 0; i <= 400; i++) {
            const t = i / 400;
            p.push([100 + t * 900, 380 + 160 * Math.sin(t * 5) + 30 * Math.cos(t * 17)]);
        }
        return { pts: p, width: 24 };
    },
    "tight wiggle": () => {
        const p = [];
        for (let i = 0; i <= 24; i++) { const t = i / 24; p.push([120 + t * 820, 400 + 150 * Math.sin(t * 9)]); }
        return { pts: p, width: 90 };
    },
    "self-crossing": () => ({
        pts: [[200, 400], [450, 180], [700, 400], [450, 620], [340, 400], [600, 280]], width: 90,
    }),
    "hand-drawn ring (dense)": () => {
        // Samples ~3 units apart against a 90-unit pen — the spacing a real pen
        // produces, and the case an index-based adjacency window cannot handle.
        const p = [], n = 520;
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            const wob = 1 + 0.05 * Math.sin(a * 3) + 0.03 * Math.cos(a * 7);
            p.push([560 + 250 * wob * Math.cos(a), 400 + 250 * wob * Math.sin(a)]);
        }
        return { pts: p, width: 90 };
    },
    "the scribble (3,775 pts)": () => {
        const W = 521, H = 465, rows = 151, cols = 24, p = [];
        for (let row = 0; row < rows; row++) {
            const y = 140 + (row / (rows - 1)) * H;
            for (let k = 0; k <= cols; k++) {
                const f = row % 2 === 0 ? k / cols : 1 - k / cols;
                p.push([260 + f * W, y]);
            }
        }
        return { pts: p, width: 90 };
    },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export default function BakeLab() {
    const canvasRef = useRef(null);
    const [algo, setAlgo] = useState("A");
    const [width, setWidth] = useState(90);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const [status, setStatus] = useState(null);
    const [accuracy, setAccuracy] = useState(null);
    const [baking, setBaking] = useState(false);
    const [showRaw, setShowRaw] = useState(false);

    // stroke state lives in refs: pointer events must not wait on React
    const ptsRef = useRef([]);
    const bakerRef = useRef(null);
    const loopsRef = useRef(null);
    const drawingRef = useRef(false);
    const viewRef = useRef(view);
    viewRef.current = view;
    const replayRef = useRef(null);
    const widthRef = useRef(width);
    widthRef.current = width;
    const showRawRef = useRef(showRaw);
    showRawRef.current = showRaw;

    const tolFor = useCallback((w) => {
        // A quarter pixel at the zoom the swap happens at — Kobin's rule for the
        // pen-up swap. In frame units that is 0.25 / scale.
        const t = 0.25 / viewRef.current.scale;
        return { fitTol: Math.min(t, w * 0.02), lineTol: Math.min(t, w * 0.02), enterScale: viewRef.current.scale };
    }, []);

    // ---- rendering ---------------------------------------------------------
    const paint = useCallback(() => {
        const cv = canvasRef.current;
        if (!cv) return;
        const ctx = cv.getContext("2d");
        const { scale, x, y } = viewRef.current;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = "#12141a";
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.setTransform(scale, 0, 0, scale, x, y);

        const pts = ptsRef.current;
        // SHOW RAW is a view switch, not an undo: the bake stays in `loopsRef` so
        // flipping back and forth compares the same two things without re-running
        // anything. Comparing by redrawing the stroke would compare two different
        // strokes, which is not a comparison.
        const loops = showRawRef.current ? null : loopsRef.current;
        if (loops) {
            ctx.beginPath();
            for (const loop of loops) {
                ctx.moveTo(loop[0][0][0], loop[0][0][1]);
                for (const c of loop) ctx.bezierCurveTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]);
                ctx.closePath();
            }
            ctx.fillStyle = "#3ddc97";              // BAKED
            ctx.fill("nonzero");
            // THE PERIMETER ITSELF, as a hairline. The fill shows what the shape
            // covers; this shows the curves the bake actually produced, which is
            // the thing being judged. A fabricated closing edge, a doubled-back
            // chain or a crease is invisible under a solid fill and obvious here.
            // Hairline means one DEVICE pixel at any zoom, hence dividing by the
            // scale — a fixed width would swamp the shape when zoomed in.
            ctx.lineWidth = 1 / scale;
            ctx.strokeStyle = "#ff2d55";
            ctx.lineJoin = "round";
            ctx.stroke();
        } else if (pts.length) {
            strokeRaw(ctx, pts, widthRef.current, "#4d8bf0");   // RAW
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }, []);

    useEffect(() => { paint(); }, [paint, view, showRaw]);

    useEffect(() => {
        const cv = canvasRef.current;
        const fit = () => {
            const r = cv.getBoundingClientRect();
            cv.width = Math.floor(r.width * (window.devicePixelRatio || 1));
            cv.height = Math.floor(r.height * (window.devicePixelRatio || 1));
            paint();
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [paint]);

    // ---- the bake ----------------------------------------------------------
    const bake = useCallback(() => {
        const baker = bakerRef.current;
        if (!baker) return;
        setBaking(true);
        // Yield so the "baking" state paints before a long finish() blocks the
        // thread — otherwise the freeze is invisible, which is exactly the thing
        // being measured. A timeout rather than requestAnimationFrame: rAF does
        // not fire when the page is not compositing (a background tab, or a
        // hidden pane), and the bake would simply never start.
        setTimeout(() => {
            const t0 = performance.now();
            const { loops, stats } = baker.finish();
            const finishWall = performance.now() - t0;
            loopsRef.current = loops;
            bakerRef.current = null;
            // dev handle for inspecting the result from the console
            window.__lab = { pts: ptsRef.current, width: widthRef.current, loops, stats };
            setBaking(false);
            setStatus({
                algo, samples: stats.samples, drawMs: stats.drawMs,
                finishMs: +finishWall.toFixed(1), perPoint: stats.perPoint,
                pieces: loops.reduce((n, l) => n + l.length, 0), loops: loops.length,
                inner: stats.inner ? stats.inner.ms : null,
                replayMs: replayRef.current,
            });
            paint();
            setAccuracy(measureAccuracy(ptsRef.current, widthRef.current, loops, viewRef.current));
        }, 20);
    }, [algo, paint]);

    // ---- pointer -----------------------------------------------------------
    const toWorld = (e) => {
        const cv = canvasRef.current, r = cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const { scale, x, y } = viewRef.current;
        return [((e.clientX - r.left) * dpr - x) / scale, ((e.clientY - r.top) * dpr - y) / scale];
    };
    const onWheel = (e) => {
        const cv = canvasRef.current, r = cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
        setView((v) => {
            const s = clamp(v.scale * Math.pow(1.0015, -e.deltaY), 0.02, 20000);
            return { scale: s, x: px - (px - v.x) * (s / v.scale), y: py - (py - v.y) * (s / v.scale) };
        });
    };
    const panRef = useRef(null);
    const onDown = (e) => {
        if (e.button === 1 || e.shiftKey || e.button === 2) {
            e.currentTarget.setPointerCapture(e.pointerId);
            panRef.current = { x: e.clientX, y: e.clientY };
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        ptsRef.current = [];
        loopsRef.current = null;
        setStatus(null); setAccuracy(null);
        bakerRef.current = new BAKERS[algo](width, tolFor(width));
        const p = toWorld(e);
        ptsRef.current.push(p);
        bakerRef.current.addSample(p);
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
        // Coalesced events matter here: at 120 Hz the browser batches, and a
        // baker that keeps up with getCoalescedEvents keeps up with the pen.
        // getCoalescedEvents() exists in Chrome but can return an EMPTY list, and
        // then a loop over it silently drops the sample — the whole stroke
        // vanishes except its first point. Always fall back to the event itself.
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
            bakerRef.current.addSample(p);
        }
        paint();
    };
    const onUp = () => {
        if (panRef.current) { panRef.current = null; return; }
        if (!drawingRef.current) return;
        drawingRef.current = false;
        bake();
    };

    /** Re-run the current stroke at a new width or schedule, without redrawing it. */
    const rebake = useCallback((w) => {
        const pts = ptsRef.current;
        if (!pts.length || drawingRef.current) return;
        const baker = new BAKERS[algo](w, tolFor(w));
        const t0 = performance.now();
        for (const p of pts) baker.addSample(p);
        replayRef.current = +(performance.now() - t0).toFixed(1);
        bakerRef.current = baker;
        loopsRef.current = null;
        paint();
        bake();
    }, [algo, bake, paint, tolFor]);

    // Changing the schedule re-runs the SAME stroke through the new one. Without
    // this the radio changed the label and nothing else, so comparing A, B and C
    // meant redrawing the stroke by hand each time and comparing two different
    // strokes — which is not a comparison.
    const firstAlgo = useRef(true);
    useEffect(() => {
        if (firstAlgo.current) { firstAlgo.current = false; return; }
        rebake(widthRef.current);
    }, [algo, rebake]);

    const loadPreset = (name) => {
        const { pts, width: w } = PRESETS[name]();
        setWidth(w); widthRef.current = w;
        ptsRef.current = pts;
        loopsRef.current = null;
        setStatus(null); setAccuracy(null);
        const baker = new BAKERS[algo](w, tolFor(w));
        const t0 = performance.now();
        for (const p of pts) baker.addSample(p);
        const drawWall = performance.now() - t0;
        bakerRef.current = baker;
        paint();
        replayRef.current = +drawWall.toFixed(1);
        setTimeout(bake, 30);
    };

    const zoomBy = (f) => setView((v) => {
        const cv = canvasRef.current;
        const cx = cv.width / 2, cy = cv.height / 2;
        const s = clamp(v.scale * f, 0.05, 4000);
        return { scale: s, x: cx - (cx - v.x) * (s / v.scale), y: cy - (cy - v.y) * (s / v.scale) };
    });

    const B = "#1b1e26", FG = "#e7e9ee", MUT = "#8b93a7";
    return (
        <div style={{ position: "fixed", inset: 0, background: "#0d0f14", color: FG,
            font: "13px/1.5 ui-sans-serif, system-ui, sans-serif", display: "flex" }}>
            <div style={{ width: 300, flex: "0 0 300px", padding: 16, background: B, overflowY: "auto", overflowX: "hidden", borderRight: "1px solid #262b36", boxSizing: "border-box" }}>
                <div style={{ fontSize: 15, marginBottom: 4 }}>Bake Lab</div>
                <div style={{ color: MUT, marginBottom: 14 }}>
                    Blue = raw stroke (Chrome). Green = baked fill.
                    <span style={{ color: "#ff2d55" }}> Red hairline = the baked perimeter itself.</span>
                </div>

                <Label>Schedule</Label>
                {Object.keys(BAKERS).map((k) => (
                    <label key={k} style={{ display: "block", marginBottom: 4, cursor: "pointer" }}>
                        <input type="radio" checked={algo === k} onChange={() => setAlgo(k)} /> {BAKER_NAMES[k]}
                    </label>
                ))}

                {/* A/B against the bake. Nothing is recomputed and nothing is
                    thrown away — the baked shape is still there behind it. */}
                <Label>Compare</Label>
                <button
                    style={{ ...btn, width: "100%", marginBottom: 2,
                        background: showRaw ? "#1d3a63" : btn.background,
                        borderColor: showRaw ? "#4d8bf0" : btn.borderColor,
                        color: showRaw ? "#9dc2ff" : btn.color }}
                    onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? "showing ORIGINAL — click for baked" : "show original stroke"}
                </button>
                <div style={{ color: MUT, fontSize: 12, marginBottom: 4 }}>
                    the bake is kept either way, so you can flip back and forth
                </div>

                <Label>Width — {width}</Label>
                <input type="range" min="6" max="200" value={width} style={{ width: "100%" }}
                    onChange={(e) => { const w = +e.target.value; setWidth(w); widthRef.current = w; rebake(w); }} />

                <Label>Presets</Label>
                {Object.keys(PRESETS).map((n) => (
                    <button key={n} onClick={() => loadPreset(n)} style={btn}>{n}</button>
                ))}

                <Label>Zoom — {view.scale < 10 ? view.scale.toFixed(2) : Math.round(view.scale)}x</Label>
                <div style={{ display: "flex", gap: 6 }}>
                    <button style={btn} onClick={() => zoomBy(1 / 4)}>÷4</button>
                    <button style={btn} onClick={() => zoomBy(4)}>×4</button>
                    <button style={btn} onClick={() => zoomBy(30)}>×30</button>
                    <button style={btn} onClick={() => setView({ scale: 1, x: 0, y: 0 })}>reset</button>
                </div>
                <div style={{ color: "#8b93a7", marginTop: 6, fontSize: 11 }}>
                    scroll to zoom · shift-drag or right-drag to pan · re-bake after zooming to
                    fit the tolerance to the new zoom
                </div>
                <button style={{ ...btn, marginTop: 8 }} onClick={() => rebake(widthRef.current)}>re-bake at this zoom</button>

                {baking && <div style={{ marginTop: 16, color: "#ffc857" }}>baking…</div>}

                {status && (
                    <div style={{ marginTop: 18, borderTop: "1px solid #262b36", paddingTop: 12 }}>
                        <Row k="schedule" v={status.algo} />
                        <Row k="samples" v={status.samples} />
                        <Row k="while drawing" v={`${status.drawMs} ms`} />
                        {status.replayMs != null && <Row k="replay wall-clock" v={`${status.replayMs} ms`} />}
                        <Row k="at pen-up" v={`${status.finishMs} ms`} hot={status.finishMs > 100} />
                        {status.perPoint && <Row k="per point" v={`mean ${status.perPoint.mean} · p99 ${status.perPoint.p99} · max ${status.perPoint.max}`}
                            hot={status.perPoint.max > 8} />}
                        <Row k="result" v={`${status.pieces} pieces / ${status.loops} loops`} />
                        {status.inner && <div style={{ color: MUT, marginTop: 6, fontSize: 11 }}>
                            {Object.entries(status.inner).map(([k, v]) => `${k} ${v}`).join(" · ")}
                        </div>}
                    </div>
                )}

                {accuracy && (
                    <div style={{ marginTop: 14, borderTop: "1px solid #262b36", paddingTop: 12 }}>
                        <div style={{ color: MUT, marginBottom: 6 }}>vs Chrome's own stroke, at this zoom</div>
                        <Row k="worst edge error" v={`${accuracy.maxPx.toFixed(2)} px`} hot={accuracy.maxPx > 0.25} />
                        <Row k="mismatched pixels" v={`${accuracy.wrong} of ${accuracy.inked}`} />
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

/** Chrome's own fat stroke, through the exact spline, at display fidelity. */
function strokeRaw(ctx, pts, width, color) {
    const flat = pts.length > 2 ? flattenCurve(pts, 0.05) : pts;
    ctx.beginPath();
    ctx.moveTo(flat[0][0], flat[0][1]);
    for (let i = 1; i < flat.length; i++) ctx.lineTo(flat[i][0], flat[i][1]);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.stroke();
}

/**
 * Rasterise both versions and compare, in screen pixels.
 *
 * The number that matters is not how many pixels differ — a half-pixel offset
 * along a long edge differs everywhere — but how FAR the disagreement reaches.
 * So a chamfer distance transform runs out from the truth's edge and the worst
 * mismatch distance is reported. That is the quantity "within a quarter pixel"
 * is about.
 */
function measureAccuracy(pts, width, loops, view) {
    if (pts.length < 2 || !loops) return null;
    const S = 420;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    const pad = width;
    const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    const k = Math.min(S / w, S / h) * Math.min(view.scale, 40) / Math.min(view.scale, 40);
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
    const truth = mk((c) => strokeRaw(c, pts, width, "#fff"));
    const baked = mk((c) => {
        c.beginPath();
        for (const loop of loops) {
            c.moveTo(loop[0][0][0], loop[0][0][1]);
            for (const q of loop) c.bezierCurveTo(q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]);
            c.closePath();
        }
        c.fill("nonzero");
    });
    const W = truth.width, H = truth.height;
    const on = (img, i) => img.data[i * 4] > 127;
    // distance transform (two-pass chamfer) from the truth's edge
    const dist = new Float32Array(W * H).fill(1e9);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x, a = on(truth, i);
            let edge = false;
            if (x > 0 && on(truth, i - 1) !== a) edge = true;
            if (!edge && x < W - 1 && on(truth, i + 1) !== a) edge = true;
            if (!edge && y > 0 && on(truth, i - W) !== a) edge = true;
            if (!edge && y < H - 1 && on(truth, i + W) !== a) edge = true;
            if (edge) dist[i] = 0;
        }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
        if (y > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1);
        if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.414);
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (x < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
        if (y < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1);
        if (x < W - 1 && y < H - 1) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.414);
    }
    let wrong = 0, inked = 0, worst = 0;
    for (let i = 0; i < W * H; i++) {
        if (on(truth, i)) inked++;
        if (on(truth, i) !== on(baked, i)) { wrong++; if (dist[i] > worst) worst = dist[i]; }
    }
    // raster px -> screen px at the current zoom
    return { wrong, inked, maxPx: (worst / sc) * view.scale, k };
}
