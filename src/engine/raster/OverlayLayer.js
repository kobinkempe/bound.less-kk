/**
 * OverlayLayer.js — the selection indicator's own screen-space canvas (RASTERISER-PLAN §10
 * stage 5d, §2.7 FC1/FC2/FC4/FC5/FC6/FC7/FC8, §15.3 "Stage 5d").
 *
 * It owns `<canvas class="bl-overlay">` at z-index 2, one `OverlayBuffer` the size of the
 * screen, the four edge strips, and the crawl clock. It paints through `antPaint.paintPhase`
 * and touches no ink pixel: the picture is a different canvas and this module never reads it
 * (G1). Nothing here is measured in jsdom — `getContext` returns null in this tree and there is
 * no `ImageData` global, so the suite injects both and what the compositor costs is stage 7's.
 *
 * Five things a reader needs in order not to break it:
 *
 *   - **The painted geometry is in FRAME units and the painter's view is the PUBLISHED one.**
 *     The raster fork of `_selDecide` keeps the run's pieces instead of building a path string,
 *     and those pieces are the render list's own frame coordinates — `(p − O)·sc` lived inside
 *     `runPathData`, which the fork drops. So the painter's view is `{k: view.k, tx: view.tx +
 *     off·dpr, ty: …}` and no origin enters it at all, which is what makes G12 true by
 *     construction (FC6).
 *   - **The plane is painted at the view of the MOMENT and the element carries the DELTA.**
 *     `S = k/k0`, `T = (t − t0·S)/dpr` in CSS px with `transform-origin: 0 0`, so paint-time view
 *     ∘ CSS transform is the published `k, tx, ty` to the bit (G2, §15.3 Q1). At a repaint the
 *     delta is identity; at a quantum boundary it is exactly FC2's `(s, dx, dy)`.
 *   - **A drag is the transform, not a repaint** (G5): the offset enters the paint-time view once
 *     and is ROUNDED to whole device pixels, so the translate between repaints cannot resample.
 *   - **The plane is exactly the screen, so a pan uncovers ants.** Today's SVG paths extend half
 *     a screen past every edge (`SEL_KEEP_FRACTION`); a screen-sized plane holds only what was on
 *     screen when it was painted. While any part of the screen is uncovered the layer repaints at
 *     the FROZEN phase at most once per `OVERLAY_UNCOVERED_MS` (§15.3 Q2 (b)+(d): the constant is
 *     Kobin's at stage 7, with `uncoveredPx` / `uncoveredFrames` / `uncoveredWorst` /
 *     `repaintsDuringGesture` on `report()` so he decides with the numbers).
 *   - **The screen-edge runs are four thin strip canvases**, untransformed, painted by the same
 *     `paintPhase` at the same phase index (§15.3 Q3). They are screen-anchored and recomputed
 *     every camera step, so in the body plane they would slide off the edge with the transform.
 *
 * The look constants and `SEL_CRAWL_RESUME_MS` are transcribed from `Renderer.js:349-394` the way
 * `antPaint.js` transcribes the band's: that module is the DOM renderer and this one is a leaf.
 * If one changes there it must change here.
 */

import { OverlayBuffer, paintPhase, ANT_PHASES, ANT_STEP_MS, ANT_LOOK, selAntScale } from "./antPaint";

/** How long after the last camera step the crawl stays frozen (`Renderer.js:394`). */
export const SEL_CRAWL_RESUME_MS = 150;

/**
 * The floor on the interval between two bounded repaints while a pan holds part of the screen
 * uncovered (§15.3 Q2). It starts at `SEL_CRAWL_RESUME_MS` and is the fourth ant fork Kobin
 * takes at stage 7: it bounds the gap at this much travel and the cost at one phase per this
 * much time (14–34 ms per 150 ms at the report camera, 46–133 at 4× in).
 */
export const OVERLAY_UNCOVERED_MS = 150;

/**
 * The edge strips' thickness in CSS px: the band's own width plus a pixel for the coverage ramp.
 * An edge run sits inset by half the band, so its ink reaches `SEL_ANT_W` CSS px from the side —
 * a fixed device-pixel thickness would clip it at a high dpr.
 */
const EDGE_STRIP_CSS = ANT_LOOK.W + 1;

const SIDES = ["left", "right", "top", "bottom"];

/** §6.1's backing store, the rule the pyramid's canvas uses, so the two canvases are the same size. */
function snapPx(x) { return Math.round(x); }

/** A canvas from the document, when the caller injects no factory. */
function mkCanvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
}

/**
 * The plane as one `ImageData` over the buffer's own array, built per RESIZE and never per blit
 * (FC5). jsdom has no `ImageData` global at all, so an unguarded constructor would make every
 * suite that mounts the layer red.
 */
function mkImageData(data, w, h) {
    if (typeof ImageData !== "function" || !(w > 0) || !(h > 0)) return null;
    try { return new ImageData(data, w, h); } catch (e) { return null; }
}

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

/** Does the OS ask for reduced motion? Absent (jsdom) reads as no. */
function prefersReducedMotion() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try { return !!window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
}

export default class OverlayLayer {
    /**
     * @param {Element|null} host the editor host; the canvas and the four strips are appended to
     *        it and nothing else in it is touched (FC1)
     * @param {object} [opts]
     * @param {number} [opts.width] CSS px @param {number} [opts.height] CSS px
     * @param {number} [opts.dpr] devicePixelRatio
     * @param {number[]|number} [opts.ink] the indicator's colour, `antPaint`'s own `css.ink`
     * @param {boolean} [opts.reducedMotion] overrides the media query, which jsdom does not have
     * @param {object} [opts.perf] stage 6's `rasterPerf`; `noteCrawl(report())` per tick (FC7)
     * @param {(w:number,h:number)=>object} [opts.makeCanvas] a canvas factory, for the suite
     * @param {(d:Uint8ClampedArray,w:number,h:number)=>object} [opts.makeImageData] likewise
     * @param {()=>number} [opts.now] the clock, for the suite
     * @param {(fn:Function,ms:number)=>*} [opts.setTimer]
     * @param {(t:*)=>void} [opts.clearTimer]
     */
    constructor(host, opts = {}) {
        this.host = host || null;
        this._mk = opts.makeCanvas || mkCanvas;
        this._mkImg = opts.makeImageData || mkImageData;
        this._now = opts.now || now;
        this._setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
        this._clearTimer = opts.clearTimer || ((t) => clearTimeout(t));
        this.perf = opts.perf || null;

        this.dpr = opts.dpr > 0 ? opts.dpr
            : (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
        this.cssW = opts.width > 0 ? opts.width : 0;
        this.cssH = opts.height > 0 ? opts.height : 0;
        this._reduced = opts.reducedMotion != null ? !!opts.reducedMotion : prefersReducedMotion();

        this._canvas = null; this._ctx = null;
        this.buf = null; this._img = null;
        /** The four strips, in `SIDES` order; each `{canvas, ctx, buf, img, w, h}`. */
        this._strips = [null, null, null, null];

        this._dec = null;                    // the decision last shown; a tick paints THIS one
        this._key = null; this._kt = 1;
        this._shown = false;                 // attached to the host
        this._planeDirty = true;             // the plane does not hold the decision at the view

        /** The painter's view, one object mutated in place (FC5): device px = p·k + t. */
        this._view = { k: 1, tx: 0, ty: 0 };
        /** The view the plane was painted at; the element carries the delta from it to `_view`. */
        this._paintAt = { k: 1, tx: 0, ty: 0 };
        /** `paintPhase`'s `css`, one object. */
        this._css = { dpr: this.dpr, ink: opts.ink || null };
        /** The last CSS transform written, and the only writer of the style string. */
        this._t = { s: 1, dx: 0, dy: 0 };
        this._q = null; this._Zq = null; this._mode = null;

        this._phase = 0;
        this._timer = null; this._resume = null;
        this._frozen = false;
        this._lastRepaintAt = -Infinity;

        // The edge strips' pseudo-runs: one run object a span, grown and reused, never built per
        // step (FC5) — they change every step, which is exactly why they cannot be literals.
        this._edgeRuns = [];
        this._edgeDec = { runs: [], marks: [], inkPx: null };
        this._edgeView = { k: 1, tx: 0, ty: 0 };

        /** `report()`'s one object (FC5). Per tick: the ms, the dashes, the stamps, the pixels. */
        this._rep = {
            phases: 0, lastPhaseMs: 0, pixels: 0, bytes: 0, repaints: 0,
            decideMs: 0, paintMs: 0, blitMs: 0, blitPx: 0, dashes: 0, stamps: 0,
            refused: 0, nonFinite: 0,
            uncoveredPx: 0, uncoveredFrames: 0, uncoveredWorst: 0, repaintsDuringGesture: 0,
            transforms: 0, blits: 0, allocs: 0, noImageData: 0, stripBytes: 0, edgeDashes: 0,
        };
    }

    // ---- the elements (FC1, FC8) ----

    /** The plane's device size; the strips take their thickness from the same dpr. */
    get planeW() { return snapPx(this.cssW * this.dpr); }
    get planeH() { return snapPx(this.cssH * this.dpr); }

    _style(c, cssW, cssH, z) {
        if (!c.style) return;
        c.style.position = "absolute";
        c.style.left = "0"; c.style.top = "0";
        c.style.transformOrigin = "0 0";
        c.style.pointerEvents = "none";
        c.style.zIndex = String(z);
        c.style.width = cssW + "px";
        c.style.height = cssH + "px";
    }

    _mount() {
        if (this._canvas) return this._canvas;
        const w = this.planeW, h = this.planeH;
        const c = this._mk(w, h);
        if (!c) return null;
        c.width = w; c.height = h;
        this._style(c, this.cssW, this.cssH, 2);
        // The compositing claim is the one jsdom cannot check (§10 stage 5d's first risk): the
        // A/B that says whether this holds is stage 7's, in Kobin's Chrome.
        if (c.style) c.style.willChange = "transform";
        if (c.setAttribute) { c.setAttribute("class", "bl-overlay"); c.setAttribute("aria-hidden", "true"); }
        this._ctx = c.getContext ? c.getContext("2d") : null;
        this._canvas = c;
        return c;
    }

    /** The four screen-edge strips: untransformed, above the plane, appended after it. */
    _mountStrips() {
        const dpr = this.dpr, t = Math.max(2, Math.ceil(EDGE_STRIP_CSS * dpr));
        const W = this.planeW, H = this.planeH;
        let bytes = 0;
        for (let i = 0; i < 4; i++) {
            const side = SIDES[i];
            const w = (side === "top" || side === "bottom") ? W : t;
            const h = (side === "top" || side === "bottom") ? t : H;
            let s = this._strips[i];
            if (s && s.w === w && s.h === h && s.buf) { bytes += s.buf.bytes; continue; }
            if (!s) {
                const c = this._mk(w, h);
                if (!c) continue;
                if (c.setAttribute) { c.setAttribute("class", "bl-overlay-edge"); c.setAttribute("aria-hidden", "true"); }
                s = { side, canvas: c, ctx: c.getContext ? c.getContext("2d") : null, buf: null, img: null, w: 0, h: 0 };
                this._strips[i] = s;
            }
            s.w = w; s.h = h;
            s.canvas.width = w; s.canvas.height = h;
            this._style(s.canvas, w / dpr, h / dpr, 2);
            if (s.canvas.style) {
                if (side === "right") s.canvas.style.left = (W - w) / dpr + "px";
                if (side === "bottom") s.canvas.style.top = (H - h) / dpr + "px";
            }
            if (s.buf) s.buf.resize(w, h); else s.buf = new OverlayBuffer(w, h);
            s.img = this._mkImg(s.buf.data, w, h);
            if (!s.img) this._rep.noImageData++;
            this._rep.allocs++;
            bytes += s.buf.bytes;
        }
        this._rep.stripBytes = bytes;
    }

    /** The plane, allocated on the first `show()` and never across `hide()`/`show()` (FC1). */
    _ensurePlane() {
        const w = this.planeW, h = this.planeH;
        if (!this.buf) {
            this.buf = new OverlayBuffer(w, h);
            this._img = this._mkImg(this.buf.data, w, h);
            if (!this._img) this._rep.noImageData++;
            this._rep.allocs++;
            this._planeDirty = true;
        } else if (this.buf.resize(w, h)) {
            this._img = this._mkImg(this.buf.data, w, h);
            if (!this._img) this._rep.noImageData++;
            this._rep.allocs++;
            this._planeDirty = true;
        }
        this._mountStrips();
        return this.buf;
    }

    _attach() {
        if (this._shown || !this.host || !this.host.appendChild) return;
        if (this._canvas) this.host.appendChild(this._canvas);
        for (const s of this._strips) if (s && s.canvas) this.host.appendChild(s.canvas);
        this._shown = true;
    }

    _detach() {
        const els = [this._canvas].concat(this._strips.map((s) => s && s.canvas));
        for (const c of els) if (c && c.parentNode && c.parentNode.removeChild) c.parentNode.removeChild(c);
        this._shown = false;
    }

    // ---- the mapping (FC2) ----

    /**
     * The one writer of the element's transform. `s` is a scale about the element's own origin
     * and `dx`/`dy` are CSS px, which is what `transform-origin: 0 0` on a canvas whose CSS size
     * is its backing store ÷ dpr makes into the delta of §15.3 Q1.
     */
    setTransform(s, dx, dy) {
        const t = this._t;
        t.s = s; t.dx = dx; t.dy = dy;
        this._rep.transforms++;
        const c = this._canvas;
        if (c && c.style) c.style.transform = "matrix(" + s + ", 0, 0, " + s + ", " + dx + ", " + dy + ")";
    }

    /** The delta from the view the plane was painted at to the view of this step. */
    _applyTransform() {
        const p = this._paintAt, v = this._view;
        const s = p.k > 0 && isFinite(p.k) ? v.k / p.k : 1;
        this.setTransform(s, (v.tx - p.tx * s) / this.dpr, (v.ty - p.ty * s) / this.dpr);
    }

    /** The painter's view for this step: the published mapping plus the drag, in device px. */
    _readView(view, dec) {
        const v = this._view;
        v.k = view.k; v.tx = view.tx; v.ty = view.ty;
        const off = dec && dec.off;
        if (off && off.length === 2) {
            // Whole device pixels, so a drag between repaints is a pure integer translate and
            // cannot resample (§10 stage 5d, G5).
            v.tx += Math.round(off[0] * this.dpr);
            v.ty += Math.round(off[1] * this.dpr);
        }
        return v;
    }

    // ---- the paint and the blit (FC4) ----

    /**
     * One phase of the held decision into the plane, at the view of the moment, followed by one
     * blit. Every paint leaves the element's transform at identity, because the plane now holds
     * the ants where the published view puts them.
     */
    _paint(phase, repaint) {
        const buf = this._ensurePlane();
        if (!buf || !this._dec) return;
        const t0 = this._now();
        const r = paintPhase(buf, this._dec, this._view, phase, this._css);
        const t1 = this._now();
        const p = this._paintAt, v = this._view;
        p.k = v.k; p.tx = v.tx; p.ty = v.ty;
        this.setTransform(1, 0, 0);
        this.blit();
        const rep = this._rep;
        rep.paintMs = t1 - t0; rep.lastPhaseMs = t1 - t0;
        rep.dashes = r.dashes; rep.stamps = r.stamps; rep.pixels = r.pixels;
        rep.refused += r.refused; rep.nonFinite += r.nonFinite;
        rep.phases++;
        this._planeDirty = false;
        this._lastRepaintAt = this._now();
        if (repaint) {
            rep.repaints++;
            if (this._frozen) rep.repaintsDuringGesture++;
        }
        rep.uncoveredPx = 0;
    }

    /**
     * The only path from the buffer to the canvas (FC4). `rect` is a `screenRect` — integers,
     * half-open, device px, the ink canvas's top-left — and defaults to what the last paint
     * changed; an empty one is nothing to push, so a caller wanting the whole plane passes it.
     * @returns {number} device pixels written
     */
    blit(rect) {
        const buf = this.buf, ctx = this._ctx, img = this._img;
        this._rep.blitMs = 0; this._rep.blitPx = 0;
        if (!buf || !ctx || !img) return 0;
        const r = rect || buf.dirty;
        const x0 = Math.max(0, r.x0 | 0), y0 = Math.max(0, r.y0 | 0);
        const x1 = Math.min(buf.width, r.x1 | 0), y1 = Math.min(buf.height, r.y1 | 0);
        if (x1 <= x0 || y1 <= y0) return 0;
        const t0 = this._now();
        ctx.putImageData(img, 0, 0, x0, y0, x1 - x0, y1 - y0);
        this._rep.blitMs = this._now() - t0;
        this._rep.blitPx = (x1 - x0) * (y1 - y0);
        this._rep.blits++;
        return this._rep.blitPx;
    }

    // ---- the screen-edge runs (§15.3 Q3) ----

    /**
     * The four strips, painted at the SAME phase index as the body (G7). The spans are camera
     * screen CSS px; `shift` is the CSS-px translation from the camera's screen to the published
     * view's — `view.tx/dpr − cam.inPanX` — which the renderer computes because this module holds
     * no camera. It reads no origin, so G12 is untouched: the ink leaves the screen where the
     * PUBLISHED mapping puts it, and the inset is a screen quantity and is not shifted (FC2).
     */
    _paintEdges(dec, shift) {
        const edges = (dec && dec.edges) || [];
        const dpr = this.dpr, kt = this._kt;
        const inset = (ANT_LOOK.W * kt / 2) * dpr;
        const sx = shift ? shift[0] * dpr : 0, sy = shift ? shift[1] * dpr : 0;
        this._edgeDec.inkPx = dec ? dec.inkPx : null;
        let painted = 0;
        for (let i = 0; i < 4; i++) {
            const s = this._strips[i];
            if (!s || !s.buf) continue;
            const side = SIDES[i];
            const runs = this._edgeDec.runs;
            runs.length = 0;
            for (let j = 0; j < edges.length; j++) {
                const e = edges[j];
                if (e.side !== side) continue;
                const run = this._edgeRun(runs.length);
                const p = run.pieces[0];
                if (side === "left" || side === "right") {
                    const x = side === "left" ? inset : s.w - inset;
                    p.A[0] = x; p.B[0] = x;
                    p.A[1] = e.from * dpr + sy; p.B[1] = e.to * dpr + sy;
                } else {
                    const y = side === "top" ? inset : s.h - inset;
                    p.A[1] = y; p.B[1] = y;
                    p.A[0] = e.from * dpr + sx; p.B[0] = e.to * dpr + sx;
                }
                runs.push(run);
            }
            const r = paintPhase(s.buf, this._edgeDec, this._edgeView, this._phase, this._css);
            painted += r.dashes;
            const d = s.buf.dirty;
            if (s.ctx && s.img && d.x1 > d.x0 && d.y1 > d.y0) {
                s.ctx.putImageData(s.img, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
            }
        }
        this._rep.edgeDashes = painted;
    }

    /** One pseudo-run per span, grown and reused (FC5). */
    _edgeRun(i) {
        let r = this._edgeRuns[i];
        if (!r) {
            r = { pieces: [{ line: true, A: [0, 0], B: [0, 0] }], closed: false, len: 0 };
            this._edgeRuns[i] = r;
            this._rep.allocs++;
        }
        return r;
    }

    // ---- the crawl clock (§10, `Renderer.js:1500-1515`) ----

    _arm() {
        if (this._timer != null || !this._shown || this._reduced || !this._dec) return;
        this._timer = this._setTimer(() => { this._timer = null; this.step(); this._arm(); }, ANT_STEP_MS);
    }

    _disarm() {
        if (this._timer != null) { this._clearTimer(this._timer); this._timer = null; }
        if (this._resume != null) { this._clearTimer(this._resume); this._resume = null; }
    }

    /**
     * The crawl holds its phase while the camera moves and picks up `SEL_CRAWL_RESUME_MS` after
     * the last step. The timer is re-armed on EVERY `show()`, camera step or not, which is what
     * `Renderer.js:1500-1515` does on every `syncWorld`.
     */
    freeze() {
        this._frozen = true;
        if (this._resume != null) { this._clearTimer(this._resume); this._resume = null; }
        this._resume = this._setTimer(() => { this._resume = null; this.resume(); }, SEL_CRAWL_RESUME_MS);
    }

    resume() { this._frozen = false; }

    /**
     * One crawl tick. Frozen, it advances no phase — it only looks for an uncovered screen.
     * Under reduced motion it does nothing: G9 is a property of the tick, not only of the timer.
     */
    step() {
        if (!this._dec || !this._shown || this._reduced) return;
        if (this._frozen) { this._maybeUncovered(); this._note(); return; }
        this._phase = (this._phase + 1) % ANT_PHASES;
        this._paint(this._phase, this._planeDirty);
        this._note();
    }

    /** FC7: a crawl tick is a frame of its own, with its own negative `frameSeq` in the ring. */
    _note() {
        if (this.perf && this.perf.noteCrawl) this.perf.noteCrawl(this.report());
    }

    // ---- the uncovered screen (§15.3 Q2) ----

    /** Device pixels of the screen the transformed plane does not cover. */
    _uncoveredPx() {
        const W = this.planeW, H = this.planeH;
        if (!(W > 0) || !(H > 0)) return 0;
        const t = this._t, dpr = this.dpr;
        const x0 = t.dx * dpr, y0 = t.dy * dpr;
        const x1 = x0 + W * t.s, y1 = y0 + H * t.s;
        const w = Math.min(W, x1) - Math.max(0, x0), h = Math.min(H, y1) - Math.max(0, y0);
        const cov = (w > 0 ? w : 0) * (h > 0 ? h : 0);
        const un = W * H - cov;
        return un > 0 ? Math.round(un) : 0;
    }

    /**
     * A pan reveals a strip the plane never held (the ants are retained half a screen past every
     * edge today), so while any part of the screen is uncovered the layer repaints at the frozen
     * phase, at most once per `OVERLAY_UNCOVERED_MS`.
     */
    _maybeUncovered() {
        const un = this._uncoveredPx();
        const rep = this._rep;
        rep.uncoveredPx = un;
        if (un <= 0) return;
        rep.uncoveredFrames++;
        const f = un / (this.planeW * this.planeH);
        if (f > rep.uncoveredWorst) rep.uncoveredWorst = f;
        if (this._now() - this._lastRepaintAt >= OVERLAY_UNCOVERED_MS) this._paint(this._phase, true);
    }

    // ---- the entry points ----

    /**
     * One camera step or one decision change. Repaints in the SAME TURN when the decision, the
     * ants' scale or the quantum moved (G3, G4) and otherwise writes the delta transform alone.
     *
     * @param {object|null} dec `_selectionAnts`' object in raster form — `{key, runs, marks,
     *        edges, inkPx, off}` with the runs' pieces in FRAME units (§10 stage 5d's one
     *        additive fork in `overlays.js`)
     * @param {object} view the pyramid's published view (`PicturePyramid.frameFor`) — FC2's mapping, read and not derived
     * @param {number[]} [shift] the CSS-px translation from the camera's screen to the published
     *        view's, for the edge spans alone (`_paintEdges`)
     */
    show(dec, view, shift) {
        const runs = (dec && dec.runs) || [], marks = (dec && dec.marks) || [], edges = (dec && dec.edges) || [];
        if (!dec || !view || !(runs.length || marks.length || edges.length)) { this.hide(); return; }
        if (!this._mount()) return;
        this._ensurePlane();
        this._attach();
        this._dec = dec;
        const kt = selAntScale(dec.inkPx);
        this._readView(view, dec);

        const moved = view.q !== this._q || view.Zq !== this._Zq || view.mode !== this._mode;
        const changed = dec.key !== this._key || kt !== this._kt;
        const repaint = moved || changed || this._planeDirty;
        this._key = dec.key; this._kt = kt;
        this._q = view.q; this._Zq = view.Zq; this._mode = view.mode;

        if (repaint) this._paint(this._phase, true);
        else this._applyTransform();

        this.freeze();
        this._arm();
        this._paintEdges(dec, shift);
        if (!repaint) this._maybeUncovered();
    }

    /** The selection went away, or the tool changed: detach and stop, and KEEP the plane (FC1). */
    hide() {
        if (!this._shown && !this._dec) return;
        this._disarm();
        this._detach();
        this._dec = null; this._key = null;
        this._frozen = false;
        this._rep.uncoveredPx = 0;
    }

    /** A resize or a dpr change: one reallocation and one repaint (G10). */
    setSize(cssW, cssH, dpr) {
        const d = dpr > 0 ? dpr : this.dpr;
        if (cssW === this.cssW && cssH === this.cssH && d === this.dpr) return false;
        this.cssW = cssW; this.cssH = cssH; this.dpr = d; this._css.dpr = d;
        const c = this._canvas;
        if (c) {
            c.width = this.planeW; c.height = this.planeH;
            this._style(c, cssW, cssH, 2);
            if (c.style) c.style.willChange = "transform";
        }
        this._ensurePlane();
        if (this._dec && this._shown) this._paint(this._phase, true);
        return true;
    }

    /**
     * §6.6's `visibilitychange` release, reaching this layer through the renderer's one list: the
     * plane and the strips go back, and the next `show()` or tick reallocates and repaints once.
     * `hide()` is a tool change and keeps them (FC1 as amended, §15.3 Q6).
     */
    onStoreRelease(reason) {
        this.buf = null; this._img = null;
        for (const s of this._strips) if (s) { s.buf = null; s.img = null; s.w = 0; s.h = 0; }
        this._rep.stripBytes = 0;
        this._planeDirty = true;
        return reason;
    }

    destroy() {
        this._disarm();
        this._detach();
        this._canvas = null; this._ctx = null;
        this.buf = null; this._img = null;
        this._strips = [null, null, null, null];
        this._dec = null; this._key = null;
        this._rep.stripBytes = 0;
        this._planeDirty = true;
    }

    /** Reduced motion paints once at phase 0 and arms no clock (G9). The renderer owns the listener. */
    setReducedMotion(v) {
        const was = this._reduced;
        this._reduced = !!v;
        if (this._reduced) { this._disarm(); this._phase = 0; if (this._dec && this._shown) this._paint(0, true); }
        else if (was) this._arm();
    }

    /** The decision's own cost, which the renderer times (FC7's `ovl.decide`). */
    noteDecide(ms) { this._rep.decideMs = ms > 0 ? ms : 0; }

    /**
     * FC7's fifth bucket, as `rasterPerf.noteCrawl` reads it. One object, mutated (FC5).
     * Per tick: `lastPhaseMs`, `paintMs`, `blitMs`, `blitPx`, `dashes`, `stamps`, `pixels`,
     * `decideMs`. Cumulative: `phases`, `repaints`, `blits`, `transforms`, `allocs`, the four
     * uncovered counters and the two refusal counters. `bytes` is the PLANE (G10); the strips are
     * `stripBytes`, because §6.6 wants them named apart.
     */
    report() {
        const r = this._rep;
        r.bytes = this.buf ? this.buf.bytes : 0;
        return r;
    }
}
