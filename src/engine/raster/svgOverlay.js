/**
 * svgOverlay.js — the SVG overlays both renderers draw, one implementation each (A3 §7.2, DESIGN.md §9): the
 * lasso, the tile and erase debug outlines (`SvgOverlays`, into `SvgLayer`'s groups), and the selection
 * indicator's SVG — its layers, its stylesheet, the chevrons, and the SVG renderer's own ants (the raster
 * path paints its ants into `OverlayLayer`'s canvas).
 */
import Two from "two.js";
import { mkPath } from "./svgAnchors";

// ---- the selection indicator's look, from the Claude Design spec ------------
// Ants: a band centred ON the silhouette ("Ants sit: on the edge"), in the
// product's own terracotta.
//
// 2.5 px, not 5. The design file strokes a mark at `w + 2.5` against a mask
// eroded to `w - 2.5`, which leaves TWO ribbons — one down each edge of the
// stroke — each 2.5 px wide and centred on its edge. The 5 is the total across
// both. Tracing the outline as a loop covers both edges in one pass, so the
// stroke width here is one ribbon: 2.5.
const SVG_NS = "http://www.w3.org/2000/svg";
// The ant painter paints in the same terracotta (`antPaint.SEL_INK_RGB`).
export const SEL_INK = "oklch(0.6 0.17 35)";
// The speck: a mark down at the size of a pixel. It BLINKS rather than crawls —
// its outline is shorter than one dash cycle, so as the pattern slides the whole
// mark passes in and out of a gap. That is the file's behaviour and it is what
// makes a sub-pixel mark read as an indicator instead of a stray pixel.
const SEL_FINE_W = 1.75, SEL_FINE_ON = 3.5, SEL_FINE_OFF = 2.8;
// The DASH LENGTH is 7, not the file's 5, and that is deliberate. The file
// measures its dash along the middle of a stroke and then shows you the edge —
// so on a bend the outer edge, which is a longer arc, stretches the dash and the
// inner edge squashes it. Measured on the file's own scenes: the half-covering
// stroke reads 3.2 px on its inner edge and 6.8 px on its outer one, a 2:1
// spread across a single mark. Tracing the outline gives one honest length
// everywhere, so it has to be chosen — and Kobin picked the outer-edge size,
// which rounds to 7 with the gap kept at the file's 5:4 ratio.
const SEL_ANT_W = 2.5, SEL_ANT_ON = 7, SEL_ANT_OFF = 5.6;
// THIN MARKS SHRINK, which the file does not do — its 2.5 px ribbon on a 3 px
// stroke buries the mark under its own indicator. Below this ink width the whole
// pattern scales down together, so the ants stay in proportion to what they are
// pointing at rather than replacing it.
// The floor is the SPECK's own band, so the pattern never gets thinner than the
// thing it collapses into. At 0.4 the ants went down to a 1 px hairline and
// marks between about 1 and 5 px — the splotchy ones especially — stopped
// reading as selected at all. Tying it to SEL_FINE_W also removes a
// discontinuity: as a mark shrinks past the point of being traceable, the band
// it had is the band its speck gets.
const SEL_THIN_REF = 10;
const SEL_THIN_MIN = SEL_FINE_W / SEL_ANT_W;   // 1.75 / 2.5 = 0.7
export const selAntScale = (inkPx) => (inkPx == null || !isFinite(inkPx) ? 1
    : Math.max(SEL_THIN_MIN, Math.min(1, inkPx / SEL_THIN_REF)));
// The arrow that marks where a selection carries on past the side of the
// screen: an open terracotta chevron, breathing gently.
//
// Parameterised by SPAN (tip to tip) and DEPTH (how far the vertex stands
// proud), because that is what decides how open it looks. The angle AT THE
// VERTEX is `2 * atan(span / 2 / depth)` — about 110 degrees here, a wide V.
//
// Getting this wrong twice is what makes it worth spelling out: written as a
// length and a "rise" it was 13 long by 2.6, which reads as a spike, and
// measuring the arm against the horizontal made it look like 157 degrees when
// the vertex angle was 22.6.
export const SEL_ARROW_SPAN = 17, SEL_ARROW_DEPTH = 6, SEL_ARROW_GAP = 24;
// How many runs shorter than a dash cycle share one path (see `renderSelAnts`).
const SEL_BATCH_RUNS = 100;
// How long after the last camera step the crawl stays frozen; the raster overlay freezes on the same rule.
export const SEL_CRAWL_RESUME_MS = 150;

/** A group's children dropped. */
const clearGroup = (g) => g.remove(g.children);

/**
 * The lasso and the two debug overlays, in `SvgLayer`'s groups; the engine's functions give what they show.
 * Both renderers own one and call it from their overlay tail.
 */
export class SvgOverlays {
    /** @param {object} layer the renderer's `SvgLayer` @param {object} cam the engine's `Camera` */
    constructor(layer, cam) {
        this.layer = layer; this.cam = cam;
        this.lassoFn = null;         // () -> [[sx,sy], ...] | null (screen space)
        this.tileDebug = false;
        this.tileRectsFn = null;     // () -> [{level,i,j,rect}]
        this.eraseDebug = false;
        this.eraseModelFn = null;    // () -> { marks, outlines, contacts } | null
    }
    setLasso(fn) { this.lassoFn = fn; }
    setTileDebug(v, fn) { this.tileDebug = v; this.tileRectsFn = fn || this.tileRectsFn; if (!v) clearGroup(this.layer.tileDebugGroup); }
    setEraseDebug(v, fn) { this.eraseDebug = !!v; this.eraseModelFn = fn || this.eraseModelFn; if (!v) clearGroup(this.layer.eraseDebugGroup); }
    /** All three, in paint order. */
    render() { this.tiles(); this.erase(); this.lasso(); }

    /**
     * The in-progress selection lasso, in SCREEN coordinates (it is a gesture, not geometry — it never becomes
     * part of the drawing). Terracotta, the same gesture as the ants. The lasso is all this group draws: the
     * indicator is the ants on the object's own edge (OPEN-FLAGS F39).
     */
    lasso() {
        const g = this.layer.selGroup;
        clearGroup(g);
        const loop = this.lassoFn && this.lassoFn();
        if (!loop || loop.length < 2) return;
        const lp = new Two.Path(loop.map(([x, y]) => new Two.Anchor(x, y)), true, false);
        lp.noFill(); lp.stroke = SEL_INK; lp.linewidth = 1.5; lp.opacity = 0.9;
        if (lp.dashes) { lp.dashes.length = 0; lp.dashes.push(4, 4); }
        g.add(lp);
    }

    /** The cached tiles' rectangles, red, in screen space. */
    tiles() {
        if (!this.tileDebug || !this.tileRectsFn) return;
        const g = this.layer.tileDebugGroup;
        clearGroup(g);
        for (const { level, rect } of this.tileRectsFn()) {
            const c = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
                .map(([x, y]) => this.cam.levelPointToScreen(level, x, y));
            if (c.some((p) => !p)) continue;
            const path = new Two.Path(c.map(([x, y]) => new Two.Anchor(x, y)), true, false);
            path.noFill(); path.stroke = "red"; path.linewidth = 1.5; path.opacity = 0.9;
            g.add(path);
        }
    }

    /**
     * The erase-debug overlay: outlines in screen space, over the ink.
     *
     * ORANGE is a real shape's own boundary; GREEN is the stretch where it is
     * in CONTACT with a parent or child across their shared tile edge — which is
     * precisely the relation severance is decided on, so green is "these two are
     * one object". YELLOW is an eraser mark, including one already consumed.
     * Drawn last and on top, because the whole point is to see it against ink
     * that has been dimmed to make room for it.
     */
    erase() {
        if (!this.eraseDebug || !this.eraseModelFn) return;
        const g = this.layer.eraseDebugGroup;
        clearGroup(g);
        const model = this.eraseModelFn();
        if (!model) return;
        const add = (pts, { stroke, fill, width, opacity, closed }) => {
            if (!pts || pts.length < 2) return;
            // A boundary can arrive with a hundred thousand points: `mkPath` pushes them in bounded chunks.
            const path = mkPath(pts.map((p) => new Two.Anchor(p[0], p[1])), !!closed, false);
            if (fill) { path.fill = fill; } else { path.noFill(); }
            if (stroke) { path.stroke = stroke; path.linewidth = width; } else { path.noStroke(); }
            path.opacity = opacity;
            g.add(path);
        };
        for (const m of model.marks || []) add(m.pts, { fill: "#ffd400", opacity: 0.2, closed: true });
        // One pixel each, always: these are meant to show you where a boundary
        // is, not to cover what is beside it. Neither list overlaps the other —
        // the engine splits each boundary into runs and hands every stretch to
        // exactly one of them — so nothing here is drawn twice.
        for (const o of model.outlines || []) add(o.pts, { stroke: "#ff8c00", width: 1, opacity: 0.95 });
        for (const c of model.contacts || []) add(c.pts, { stroke: "#00c000", width: 1, opacity: 1 });
    }
}

// ---- the selection indicator's SVG --------------------------------------------

/**
 * One indicator layer element, sat exactly over the drawing's own `<svg>` wherever the host put it
 * (RASTERISER-PLAN §2.5 seam 6): the SVG renderer builds two, the raster renderer one (`bl-sel-edges`).
 *
 * The layers are built ONCE and thereafter only updated. This is not an
 * optimisation, it is the difference between the indicator animating and not:
 * a CSS animation restarts whenever its element is replaced, so rebuilding
 * these nodes on each camera step left the ants frozen for exactly as long as
 * the camera was moving.
 */
export function mkSelLayer(svg, host, cls) {
    const l = document.createElementNS(SVG_NS, "svg");
    l.setAttribute("class", cls);
    l.setAttribute("aria-hidden", "true");
    l.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;overflow:visible;will-change:transform;transform-origin:0 0;";
    try {
        const a = svg.getBoundingClientRect(), b = host.getBoundingClientRect();
        if (a.left - b.left || a.top - b.top) { l.style.left = (a.left - b.left) + "px"; l.style.top = (a.top - b.top) + "px"; }
    } catch (e) { /* no layout here */ }
    return l;
}

/**
 * The SVG renderer's two layers over `svg`: the retained ants, moved by a CSS transform and repainted
 * only when the decision changes or the crawl steps; and the screen-edge runs, which change every step
 * and are a handful of paths. In one layer the edge runs would have repainted every ant on every step.
 */
export function buildSelOverlay(svg) {
    const host = svg.parentNode || document.body;
    const layer = mkSelLayer(svg, host, "bl-sel-layer");
    const world = document.createElementNS(SVG_NS, "g");
    world.setAttribute("class", "bl-sel-world");
    // An anchor the ant paths are inserted before, so the dots always paint
    // over the ants and the pools never fight over order.
    const markAnchor = document.createElementNS(SVG_NS, "g");
    world.appendChild(markAnchor);
    layer.appendChild(world);
    const edgeLayer = mkSelLayer(svg, host, "bl-sel-edges");
    const screen = document.createElementNS(SVG_NS, "g");
    edgeLayer.appendChild(screen);
    host.appendChild(layer);
    host.appendChild(edgeLayer);
    return { layer, edgeLayer, world, markAnchor, screen, layers: [layer, edgeLayer], key: null, kt: null, w: 0, h: 0,
        antPool: [], markPool: [], edgePool: [], arrowPool: [] };
}

/** The indicator's layers out of the host, and its crawl timer stopped. */
export function dropSelOverlay(els, layers) {
    if (els && els.resume) { clearTimeout(els.resume); els.resume = null; }
    for (const g of layers || []) if (g && g.parentNode) g.parentNode.removeChild(g);
}

/**
 * The selection indicator on the SVG path: marching ants on the object's own
 * edge, and — where it carries on past the side of the screen — ants along that
 * side with an arrow pointing the way it goes.
 *
 * There is no shimmer. A breathing wash over the ink was tried against the
 * design file's four candidates and dropped (Kobin, 2026-08-25): on a real
 * drawing it reads as the picture flickering rather than as a selection.
 *
 * WHY THIS IS RAW SVG AND NOT TWO.JS. The animation is CSS: the dash offset
 * crawls without touching the main thread's JavaScript.
 *
 * WHY IT IS ITS OWN <svg>, NOT A GROUP IN THE DRAWING'S. Measured in
 * Kobin's Chrome on 2026-09-03 with 5,343 objects drawn and 13,600 px of
 * ants: with the ants in the drawing's <svg>, every frame of the crawl was
 * 50 ms; with the drawing hidden and the same ants crawling, 16.7 ms. The
 * ants cost nothing measurable — what cost was that a paint invalidation
 * in a layer re-rasterises everything in that layer's tiles, drawing
 * included. A separate <svg> with `will-change: transform` is its own
 * compositing layer, so the crawl re-rasterises the ants and only the ants.
 *
 * WHAT IT RECEIVES (see `_selectionAnts`): runs and marks as path data in
 * a RETAINED space under one transform, changed rarely (`key`); the
 * transform, changed every step; and the screen-edge runs, per step. The
 * paths carry `vector-effect: non-scaling-stroke`, so the band and the
 * dashes stay in screen pixels whatever the transform — measured on the
 * same day: a 20 px dash period under `scale(2)` is still 20 px.
 *
 * @param {object} els `buildSelOverlay`'s @param {object} data the decision (`overlays._selectionAnts`)
 * @param {number} W @param {number} H screen CSS px
 */
export function renderSelAnts(els, data, W, H) {
    const runs = data.runs || [], marks = data.marks || [], edges = data.edges || [];
    if (els.w !== W || els.h !== H) {
        for (const l of els.layers) {
            l.setAttribute("width", String(W));
            l.setAttribute("height", String(H));
        }
        els.w = W; els.h = H;
    }
    const kt = selAntScale(data.inkPx);
    // THE STEP IS A CSS TRANSFORM ON THE LAYER, applied by the compositor
    // with no repaint. As an SVG transform on a group inside the layer it
    // repainted every ant on every step of a pinch — measured at 35 to 50
    // ms a frame on top of the drawing's own 50 to 66 — because a
    // non-scaling stroke has to be re-stroked whenever its transform
    // changes. On the layer, a pinch costs the overlay nothing until the
    // next decision.
    const t = data.transform || { k: 1, tx: 0, ty: 0 };
    els.layer.style.transform = "matrix(" + t.k + ", 0, 0, " + t.k + ", " + t.tx + ", " + t.ty + ")";
    // THE CRAWL FREEZES WHILE THE CAMERA MOVES. This runs on every camera
    // step; a crawl repaint landing on a pinch frame added 17 ms to it
    // (measured: pinch with the crawl 83 ms a frame, paused 67, the
    // drawing alone 50), for motion nobody can see under a pinch. The
    // ants hold their phase and pick up SEL_CRAWL_RESUME_MS after the
    // last step.
    if (typeof setTimeout === "function") {
        if (!els.frozen) { els.layer.classList.add("bl-sel-still"); els.edgeLayer.classList.add("bl-sel-still"); els.frozen = true; }
        if (els.resume) clearTimeout(els.resume);
        els.resume = setTimeout(() => {
            els.resume = null;
            els.layer.classList.remove("bl-sel-still"); els.edgeLayer.classList.remove("bl-sel-still");
            els.frozen = false;
        }, SEL_CRAWL_RESUME_MS);
    }

    // ---- the retained ants: rebuilt only when the decision changed ----
    if (data.key !== els.key || kt !== els.kt) {
        els.key = data.key; els.kt = kt;
        // ONE PATH PER RUN, because each run needs its own dash length. A
        // single shared pattern leaves a RUNT DASH wherever a loop closes:
        // the perimeter is never an exact multiple of the cycle, so the last
        // dash before the join is whatever is left over, and you see one
        // short ant. Fitting a whole number of cycles to each run removes
        // it. The runs SHORTER than a cycle are never fitted (see `fitDash`)
        // and all carry the same pattern, so they share one path — on a
        // dense selection they are most of the runs.
        const cycle = (SEL_ANT_ON + SEL_ANT_OFF) * kt;
        const fitted = [], short = [];
        for (const run of runs) (run.len < cycle ? short : fitted).push(run);
        // ...in batches of at most SEL_BATCH_RUNS. Batching does not make
        // the paint cheaper (measured: 566 short runs in one path and one
        // path each came to the same frame), but ONE path holding every run
        // was 183 ms a frame against 33 for the same ink in 234 paths —
        // the dasher has a cliff somewhere above a few hundred contours,
        // and the batch stays well under it.
        const batches = [];
        for (let i = 0; i < short.length; i += SEL_BATCH_RUNS) batches.push(short.slice(i, i + SEL_BATCH_RUNS));
        poolTo(els.world, els.antPool, fitted.length + batches.length, els.markAnchor, () => antPath(SEL_ANT_W));
        for (let i = 0; i < fitted.length; i++) {
            const q = els.antPool[i];
            q.setAttribute("d", fitted[i].d);
            q.setAttribute("stroke-width", (SEL_ANT_W * kt).toFixed(2));
            fitDash(q, fitted[i].len, SEL_ANT_ON * kt, SEL_ANT_OFF * kt);
        }
        for (let b = 0; b < batches.length; b++) {
            const q = els.antPool[fitted.length + b];
            let d = "";
            for (const run of batches[b]) d += run.d + " ";
            q.setAttribute("d", d.trim());
            q.setAttribute("stroke-width", (SEL_ANT_W * kt).toFixed(2));
            fitDash(q, 1, SEL_ANT_ON * kt, SEL_ANT_OFF * kt);   // under a cycle: the sliding pattern
        }
        // ---- the dots ----
        // One path for all of them: they share every attribute and the dash
        // pattern restarts at each subpath. NOT fitted: the whole point of a
        // speck is that its outline is shorter than a cycle, so the pattern
        // slides across it and the mark blinks.
        poolTo(els.world, els.markPool, marks.length ? 1 : 0, null, () => antPath(SEL_FINE_W));
        if (marks.length) {
            const q = els.markPool[0];
            let d = "";
            for (const m of marks) d += m.d + " ";
            q.setAttribute("d", d.trim());
            q.setAttribute("stroke-dasharray", SEL_FINE_ON + " " + SEL_FINE_OFF);
            q.style.setProperty("--ao", (-(SEL_FINE_ON + SEL_FINE_OFF) * 2).toFixed(2) + "px");
        }
    }

    // ---- the frame edge, where the selection carries on past it ----
    // Screen space, every step. The ants sit so their OUTER side touches
    // the window edge — inset by half the band — rather than centred on
    // it, which would hang half the band off the screen.
    const inset = (SEL_ANT_W * kt) / 2;
    const edgeRuns = edges.map((e) => {
        if (e.side === "left") return [[inset, e.from], [inset, e.to]];
        if (e.side === "right") return [[W - inset, e.from], [W - inset, e.to]];
        if (e.side === "top") return [[e.from, inset], [e.to, inset]];
        return [[e.from, H - inset], [e.to, H - inset]];
    });
    poolTo(els.screen, els.edgePool, edgeRuns.length, null, () => antPath(SEL_ANT_W, false));
    for (let i = 0; i < edgeRuns.length; i++) {
        const run = edgeRuns[i], q = els.edgePool[i];
        q.setAttribute("d", pathD(run, false));
        q.setAttribute("stroke-width", (SEL_ANT_W * kt).toFixed(2));
        fitDash(q, polyLen(run), SEL_ANT_ON * kt, SEL_ANT_OFF * kt);
    }
    renderSelChevrons(els, edges, kt, W, H);

    // Last in the host, so they paint over the drawing.
    const host = els.layer.parentNode;
    if (host && host.lastChild !== els.edgeLayer) { host.appendChild(els.layer); host.appendChild(els.edgeLayer); }
}

/**
 * The chevrons that mark the sides a selection carries on past, in SCREEN pixels, drawn into
 * `els.screen` of `bl-sel-edges` (both renderers). `kt` is the ant scale; the inset is half the
 * band, so a chevron sits where the edge run does.
 *
 * @param {object} els the indicator's elements (`screen`, `arrowPool`)
 * @param {{side:string, from:number, to:number, chevron?:boolean}[]} edges
 * @param {number} kt @param {number} W @param {number} H screen CSS px
 * @returns {number} chevrons drawn
 */
export function renderSelChevrons(els, edges, kt, W, H) {
    if (!els || typeof document === "undefined") return 0;
    const inset = (SEL_ANT_W * kt) / 2;
    const DIR = { left: 180, right: 0, top: -90, bottom: 90 };
    const withChevron = edges.filter((e) => e.chevron);
    poolTo(els.screen, els.arrowPool, withChevron.length, null, () => {
        const q = document.createElementNS(SVG_NS, "path");
        const half = SEL_ARROW_SPAN / 2, d = SEL_ARROW_DEPTH / 2;
        // Drawn pointing along +x and rotated into place.
        q.setAttribute("d", "M" + (-d) + "," + (-half)
            + " L" + d + ",0 L" + (-d) + "," + half);
        q.setAttribute("fill", "none");
        q.setAttribute("stroke", SEL_INK);
        q.setAttribute("stroke-width", "2.2");
        q.setAttribute("stroke-linecap", "round");
        q.setAttribute("stroke-linejoin", "round");
        q.setAttribute("class", "bl-sel-arrow");
        return q;
    });
    for (let i = 0; i < withChevron.length; i++) {
        const e = withChevron[i];
        const mid = (e.from + e.to) / 2;
        const x = e.side === "left" ? inset + SEL_ARROW_GAP
            : e.side === "right" ? W - inset - SEL_ARROW_GAP
                : mid;
        const y = e.side === "top" ? inset + SEL_ARROW_GAP
            : e.side === "bottom" ? H - inset - SEL_ARROW_GAP
                : mid;
        els.arrowPool[i].setAttribute("transform",
            "translate(" + x.toFixed(2) + "," + y.toFixed(2) + ") rotate(" + DIR[e.side] + ")");
    }
    return withChevron.length;
}

/** One ant path: no fill, the terracotta, butt caps, and screen-pixel strokes under any transform. */
function antPath(width, nonScaling = true) {
    const q = document.createElementNS(SVG_NS, "path");
    q.setAttribute("fill", "none");
    q.setAttribute("stroke", SEL_INK);
    q.setAttribute("stroke-width", String(width));
    q.setAttribute("stroke-linecap", "butt");
    q.setAttribute("class", "bl-sel-ants");
    if (nonScaling) q.setAttribute("vector-effect", "non-scaling-stroke");
    return q;
}

/** `M x y L x y ...` for one polyline, optionally closed. */
function pathD(pts, close) {
    let d = "";
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = (p[0] != null ? p[0] : p.x), y = (p[1] != null ? p[1] : p.y);
        d += (i ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2) + " ";
    }
    return close ? d + "Z" : d.trim();
}

/** Total length of a polyline, in screen pixels. */
function polyLen(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
        d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return d;
}

/**
 * Fit a whole number of dash cycles onto a run of length `len`.
 *
 * Two problems solved at once. A run that is not a multiple of the cycle
 * ends in a RUNT — one short ant where the loop closes. And a run SHORTER
 * than a cycle would have a whole cycle crushed onto it, which is where the
 * stub dots on tight inside curves come from; those are drawn solid
 * instead, because a mark too small to carry a pattern should look like a
 * mark rather than like dirt.
 */
function fitDash(el, len, on, off) {
    const cyc = on + off;
    if (!(len > 0)) {
        el.removeAttribute("stroke-dasharray");
        el.style.removeProperty("--ao");
        return;
    }
    if (len < cyc) {
        // SHORTER THAN ONE CYCLE — carry the pattern at full size and let it
        // slide across, exactly as a speck does. Fitting here would crush a
        // whole cycle onto a few pixels and give the stub dots that show up
        // on tight inside curves; drawing it solid, which is what this did
        // before, is worse still — it stops the ants moving at all, and a
        // zoomed-out selection went completely static.
        el.setAttribute("stroke-dasharray", on.toFixed(3) + " " + off.toFixed(3));
        el.style.setProperty("--ao", (-cyc * 2).toFixed(3) + "px");
        return;
    }
    const n = Math.max(1, Math.round(len / cyc));
    const k = len / (n * cyc);
    // Three decimals, not two: the whole point is that the cycles divide the
    // run exactly, and rounding the dash to 1/100 px puts a visible fraction
    // of a cycle back over a long perimeter.
    el.setAttribute("stroke-dasharray", (on * k).toFixed(3) + " " + (off * k).toFixed(3));
    el.style.setProperty("--ao", (-(cyc * k) * 2).toFixed(3) + "px");
}

/** Grow or shrink a pool of elements to `n`, keeping the survivors alive. */
function poolTo(parent, pool, n, before, make) {
    while (pool.length < n) {
        const el = make();
        if (before) parent.insertBefore(el, before); else parent.appendChild(el);
        pool.push(el);
    }
    while (pool.length > n) {
        const el = pool.pop();
        if (el.parentNode) el.parentNode.removeChild(el);
    }
}

/**
 * The keyframes, injected once per document.
 *
 * Timings come straight from the design file: the pale pass peaks at 30%
 * and the dark one at 80% of a 3 s breath, so the two never coincide and
 * whichever contrasts with the paint gets its turn. `prefers-reduced-motion`
 * holds both at a steady value rather than stopping the indicator outright,
 * because it is the only thing marking the selection.
 */
export function ensureSelStyle() {
    if (typeof document === "undefined") return;
    const css = selCss();
    let st = document.getElementById("bl-sel-style");
    if (st) {
        // REPLACE IT IF IT HAS CHANGED. Bailing out on "the element exists"
        // meant the stylesheet was whatever the first render of the session
        // installed: across a hot reload the geometry updated (it is written
        // as attributes) while every animation stayed on the old rules, so
        // changes to timing or opacity silently did nothing and the overlay
        // looked untouched.
        if (st.textContent !== css) st.textContent = css;
        return;
    }
    st = document.createElement("style");
    st.id = "bl-sel-style";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
}

function selCss() {
    return [
        // The shift is per element: the dash cycle scales with the ink, and
        // an offset that is not a whole number of cycles makes the ants jump
        // every time the animation loops.
        "@keyframes bl-sel-ants{to{stroke-dashoffset:var(--ao,-18px)}}",
        // Very faint, and slow: the arrow should read as live without
        // pulling attention off the ants.
        "@keyframes bl-sel-faint{0%,100%{opacity:.5}50%{opacity:.8}}",
        // THE CRAWL IS STEPPED, 20 times a second, not continuous. Every
        // step of the offset repaints every ant on screen, and that paint
        // is the crawl's whole cost: measured in Kobin's Chrome on
        // 2026-09-03 with the 24,000 px budget full, a continuous crawl
        // held every frame at 33 ms (two vsyncs), and neither one shared
        // animation nor 799 separate paths nor one path per eight runs
        // changed it — the raster of the dashed length is the cost. At
        // sixteen steps a cycle the repaint lands on one frame in three and
        // the median frame is back at 16.7 ms, with the pinch's own work
        // fitting in the frames between. Each step moves the pattern
        // 1.6 px, which is how marching ants have always marched. One
        // number to put back if the stepping reads wrong: `linear`.
        ".bl-sel-ants{animation:bl-sel-ants .8s steps(16,end) infinite}",
        // Held while the camera moves (see `renderSelAnts`).
        ".bl-sel-still .bl-sel-ants{animation-play-state:paused}",
        ".bl-sel-arrow{animation:bl-sel-faint 2.4s ease-in-out infinite}",
        "@media (prefers-reduced-motion:reduce){",
        ".bl-sel-ants{animation:none}",
        ".bl-sel-arrow{animation:none;opacity:.65}}",
    ].join("");
}
