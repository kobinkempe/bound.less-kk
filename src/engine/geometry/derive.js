/**
 * derive.js — pure one-step bake math for the universal-tile engine.
 *
 * A "step" maps geometry between NEIGHBOURING levels through a crossing record
 * {s, t}: child = (parent*s + t)/base (magnify, ×~3000), parent = (child*base - t)/s
 * (minify). Everything here is a pure function of its inputs — no Two.js, no
 * camera, no cache ownership (callers pass `live` to exempt the in-progress
 * stroke from the object-attached caches).
 *
 * deriveStep() is the exact port of KobinEngineV0._deriveInto (golden-compared
 * by derive.test.js): transform parent objects into the child frame, clip to a
 * tile rect, size-gate fat strokes into outline fills. It is the "edge" tier's
 * workhorse.
 *
 * classifyUp() is the NEW symmetric size policy for magnification (the mirror
 * of the minify cull): each object is EMPTY (band can't reach the tile), SOLID
 * (one anchor disc covers the whole tile → a tile quad stands in for the whole
 * band, so geometry can never outgrow a tile and chains are bounded by
 * construction), or EDGE (the band edge crosses the tile → deriveStep does the
 * real work). Solid is an optimization tier; edge is the exactness backstop.
 *
 * projectNative() is the exact port of KobinEngineV0._projectNative: chain a
 * native's points/width through crossing records to another level's frame.
 * Minify (H > L) is precision-safe at any distance (coordinates shrink);
 * magnify (H < L) is only used step-by-step through tiles (coordinates grow —
 * composed long jumps cancel catastrophically, which is WHY the chain exists).
 */
import { strokeOutline, strokeStripNear, clipRingsToRect, clipPolylineToRect, flattenCurve, flattenCurveNear } from "./clipperOutline";

// Object bbox in its own frame. Cached on the object: geometry is immutable once
// the stroke is finished (only the live in-progress stroke still grows).
export function bboxOf(o, live) {
    if (o._bbox) return o._bbox;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const scan = (pts) => { for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } };
    if (o.type === "fill") { for (const poly of o.polys) scan(poly); } else scan(o.pts);
    const b = { x0, y0, x1, y1 };
    if (o !== live) o._bbox = b;
    return b;
}

// Chords of an object's displayed spline at in-level display fidelity
// (arcTolerancePx on screen at the deepest in-level zoom, `enter`). Cached on
// the object — reused by every fat-stroke/outline re-bake at any zoom in the level.
export function displayChords(o, cfg, live) {
    if (o._dispFlat) return o._dispFlat;
    const pts = flattenCurve(o.pts, (cfg.arcTolerancePx * 0.5) / cfg.enter);
    if (o !== live) o._dispFlat = pts;
    return pts;
}

// Flattened chords of a curved stroke, in the CHILD level's frame, cached per child
// level. The tolerance is view-independent (entry fidelity: arcTolerancePx on screen
// at inScale = base), so every tile of that level — whenever it happens to bake —
// cuts the SAME chord vertices at the shared grid lines and fill seams stay exact.
export function flatChords(o, level, tpts, cfg, live) {
    if (o._flat && o._flat.level === level) return o._flat.pts;
    const pts = flattenCurve(tpts, (cfg.arcTolerancePx * 0.5) / cfg.base);
    if (o !== live) o._flat = { level, pts };
    return pts;
}

// ---- symmetric size policy: the magnify mirror of the minify cull ----
// Classify one parent object against one child tile. `s, t` map parent→child.
export function classifyUp(o, s, t, rect, cfg, live) {
    const base = cfg.base;
    const f = s / base;
    const b = bboxOf(o, live);
    const half = o.type === "fill" ? 0 : (o.lwFrame * f) / 2;
    const bx0 = (b.x0 * s + t.x) / base, bx1 = (b.x1 * s + t.x) / base;
    const by0 = (b.y0 * s + t.y) / base, by1 = (b.y1 * s + t.y) / base;
    // EMPTY: the band cannot reach the tile.
    if (bx1 + half < rect.left || bx0 - half > rect.right || by1 + half < rect.top || by0 - half > rect.bottom) return "empty";
    if (o.type === "fill") {
        // A covering fill that still covers the whole child tile stays SOLID.
        if (o.covers && bx0 <= rect.left && bx1 >= rect.right && by0 <= rect.top && by1 >= rect.bottom) return "solid";
        return "edge";
    }
    // SOLID: one anchor disc covers the whole tile (a raw anchor lies ON the
    // displayed spline, so this needs no flatten — same test as the engine's
    // fat-fill covered check, but against the tile instead of the view window).
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    const hw = (rect.right - rect.left) / 2, hh = (rect.bottom - rect.top) / 2;
    for (const p of o.pts) {
        const px = (p[0] * s + t.x) / base, py = (p[1] * s + t.y) / base;
        if (Math.hypot(Math.abs(px - cx) + hw, Math.abs(py - cy) + hh) < half) return "solid";
    }
    return "edge";
}

// The tile-covering quad a SOLID object stands in for. 4 vertices forever —
// this is what bounds the magnify chain.
export function solidQuad(o, rect) {
    return { type: "fill", origin: "inherited", covers: true, id: o.id, z: o.z, color: o.color,
        opacity: o.opacity, polys: [[[rect.left, rect.top], [rect.right, rect.top],
            [rect.right, rect.bottom], [rect.left, rect.bottom]]], paths: [] };
}

// ---- exact port of KobinEngineV0._deriveInto (the "edge" tier) ----
// Transform parent objects into this level's frame ((p*s+t)/base) and clip to `rect`,
// applying the size gate (large strokes -> filled outline, small -> clipped stroke).
// opts: { cfg, width, opacityGroups, live, parentCurved, childCurved } — the curved
// flags accept a boolean or a per-object predicate (new engine: per-origin).
export function deriveStep(parentObjs, s, t, rect, level, opts, out) {
    const { cfg, width: W, opacityGroups, live } = opts;
    const base = cfg.base;
    // Seam pad: with per-object opacity groups, adjacent tiles' fill pieces may
    // safely OVERLAP a little (the group unions them before opacity applies), so
    // instead of abutting exactly — which leaves an AA hairline where each edge
    // half-covers the seam pixel — fills are clipped slightly PAST the tile.
    const pad = opacityGroups ? (rect.right - rect.left) * 5e-4 : 0;
    const crect = pad ? { left: rect.left - pad, top: rect.top - pad, right: rect.right + pad, bottom: rect.bottom + pad } : rect;
    const curvedP = typeof opts.parentCurved === "function" ? opts.parentCurved : () => opts.parentCurved;
    const curvedC = typeof opts.childCurved === "function" ? opts.childCurved : () => opts.childCurved;
    for (const o of parentObjs) {
        // Cull on the transformed bbox before any geometry work (the clip operates
        // on raw points, so the point bbox plus the stroke-width margin is safe).
        const b = bboxOf(o, live);
        const m = o.type === "fill" ? pad : o.lwFrame * (s / base);
        if ((b.x1 * s + t.x) / base < rect.left - m || (b.x0 * s + t.x) / base > rect.right + m ||
            (b.y1 * s + t.y) / base < rect.top - m || (b.y0 * s + t.y) / base > rect.bottom + m) continue;
        if (o.type === "fill") {
            // Float clip (Sutherland-Hodgman), NOT Clipper: runs once per crossing
            // forever, and Clipper's magnitude-capped integer scale quantized
            // giant/deep geometry by whole frame-units.
            const tp = clipRingsToRect(
                o.polys.map((poly) => poly.map(([x, y]) => [(x * s + t.x) / base, (y * s + t.y) / base])), crect);
            if (tp.length) out.push({ type: "fill", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, polys: tp, paths: [] });
        } else {
            const lw = o.lwFrame * (s / base);
            const tpts = o.pts.map(([x, y]) => [(x * s + t.x) / base, (y * s + t.y) / base]);
            // Fill gate: only genuinely gate-wide strokes polygonize at the bake.
            // (A short-lived 2026-07-07 variant also filled anything that could
            // EVER exceed fatWidthPx in the child level — that routed nearly
            // every stroke through flatten+Clipper per tile and made a first
            // crossing over a 425-stroke drawing take 167 SECONDS. Moderately
            // wide inherited pieces render as strokes and, if they approach the
            // display gate in-level, get cached curve-capsule outlines instead.)
            if (o.lwFrame * s > W * cfg.polygonizeWidthFrac) {
                const half = lw / 2;
                const ew = { left: rect.left - half, top: rect.top - half, right: rect.right + half, bottom: rect.bottom + half };
                // Flatten the displayed spline BEFORE clipping (shared chords, see
                // flatChords) — the outline must trace the spline the parent painted.
                // A parent magnified several levels explodes under a full display-
                // fidelity flatten — for those, flatten only the annulus that can
                // shape this tile's band edge. The flatten window MUST be the tile
                // (crect), NOT ew (see the OOM fix, commit 6863fe6).
                const tdiag = Math.hypot(rect.right - rect.left, rect.bottom - rect.top);
                // "mega" = Clipper's offset would explode or crawl: EITHER the span is
                // enormous (astronomic centerline) OR the offset RADIUS dwarfs the tile
                // (ISSUE-14: a wide-but-short giant used to slip past a span-only key
                // into a hundreds-of-ms Clipper offset). Both route to the analytic
                // strip, which is exact inside the tile window.
                const mega = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * (s / base) > 20 * tdiag || half > 4 * tdiag;
                let cpts;
                if (curvedP(o) && o.pts.length > 2 && mega) {
                    cpts = flattenCurveNear(tpts, (cfg.arcTolerancePx * 0.5) / base,
                        crect, Math.max(0, half - tdiag), half + tdiag);
                } else {
                    cpts = (curvedP(o) && o.pts.length > 2) ? flatChords(o, level, tpts, cfg, live) : tpts;
                }
                // Offset in TILE-LOCAL coords so precision is set by the tile size.
                const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
                const lrect = { left: crect.left - cx, top: crect.top - cy, right: crect.right - cx, bottom: crect.bottom - cy };
                const polys = [];
                const eq = (a, b2) => a && b2 && a[0] === b2[0] && a[1] === b2[1];
                // Clipper's offset UNIONS the band with itself — for a dense
                // freehand centerline magnified ×3000 the band self-overlaps
                // everywhere and the union goes quadratic in intersections: ONE
                // 1,321-point stroke took 583 s to bake (the user's 167 s level
                // flip). With per-id opacity groups + nonzero fill, self-overlap
                // needs NO union, so the engine (cfg.fatWidthPx present) routes
                // ALL fat bakes through the O(n) analytic strip; the legacy
                // Clipper branch survives only for the V0 golden comparisons.
                if (!mega && cfg.fatWidthPx == null) {
                    // Non-mega band (bounded centerline): offset the WHOLE centerline and
                    // clip the resulting RINGS to the tile. Clipping the CENTERLINE first
                    // (to `ew`) truncates the band, dropping coverage of tile-interior
                    // points whose nearest centerline lies just outside the tile — the
                    // deep-zoom "inside a coarse stroke's edge" flood was lost this way.
                    // displayScale=base: arc steps follow the on-screen cap radius at
                    // ENTRY, view-independently (seam-deterministic).
                    const op = clipRingsToRect(
                        strokeOutline(cpts.map(([x, y]) => [x - cx, y - cy]), lw,
                            { arcTolerancePx: cfg.arcTolerancePx, curved: false, displayScale: base, scale: cfg.scale }),
                        lrect);
                    for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
                } else {
                    // Oversized (mega) band: the centerline is astronomically long, so it
                    // MUST be windowed (a full offset explodes — the OOM regime). The
                    // analytic strip reproduces the band exactly INSIDE the tile window,
                    // which is all this bake serves.
                    for (const run of clipPolylineToRect(cpts, ew)) {
                        if (!run.length) continue;
                        let op = strokeStripNear(run.map(([x, y]) => [x - cx, y - cy]), lw,
                            { left: lrect.left, top: lrect.top, right: lrect.right, bottom: lrect.bottom },
                            { startCap: eq(run[0], cpts[0]), endCap: eq(run[run.length - 1], cpts[cpts.length - 1]) });
                        op = clipRingsToRect(op, lrect);
                        for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
                    }
                }
                if (polys.length) out.push({ type: "fill", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, polys, paths: [] });
            } else {
                // Small stroke: stays a stroke. If the child renders straight but the
                // parent displayed a spline, hand the child the flattened spline.
                const spts = (curvedP(o) && !curvedC(o) && o.pts.length > 2) ? flatChords(o, level, tpts, cfg, live) : tpts;
                // Extend the centerline clip by lw so clip-end caps fall beyond the
                // tile; fills clip to the exact rect -> adjacent tiles abut cleanly.
                const ew = { left: rect.left - lw, top: rect.top - lw, right: rect.right + lw, bottom: rect.bottom + lw };
                for (const run of clipPolylineToRect(spts, ew)) {
                    if (run.length) out.push({ type: "stroke", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, pts: run, lwFrame: lw, paths: [] });
                }
            }
        }
    }
    return out;
}

// ---- exact port of KobinEngineV0._projectNative (uncached; callers cache) ----
// Chain a native's geometry from its home level H into level L's frame through
// crossing `records` (records[K] maps level K-1 → K).
export function projectNative(o, H, L, records, base) {
    let pts = o.pts, lw = o.lwFrame;
    if (H > L) {
        for (let K = H; K > L; K--) {
            const r = records[K]; if (!r) return null;
            pts = pts.map(([x, y]) => [(x * base - r.t.x) / r.s, (y * base - r.t.y) / r.s]);
            lw = lw * (base / r.s);
        }
    } else {
        for (let K = H + 1; K <= L; K++) {
            const r = records[K]; if (!r) return null;
            pts = pts.map(([x, y]) => [(x * r.s + r.t.x) / base, (y * r.s + r.t.y) / base]);
            lw = lw * (r.s / base);
        }
    }
    return { type: "stroke", origin: "derived", id: o.id, z: o.z, pts, lwFrame: lw, color: o.color, opacity: o.opacity, paths: [] };
}

// Cumulative scale factor from level H to level L through `records` (null if a
// record is missing). f < 1 shrinks (minify), f > 1 magnifies.
export function levelFactor(H, L, records, base) {
    let f = 1;
    if (H > L) { for (let K = H; K > L; K--) { const r = records[K]; if (!r) return null; f *= base / r.s; } }
    else { for (let K = H + 1; K <= L; K++) { const r = records[K]; if (!r) return null; f *= r.s / base; } }
    return f;
}

// On-screen size (px) an object would have at level L's DEEPEST in-level zoom
// (`enter`) — the view-independent minify cull/fade measure (BUG-04's fade tag).
export function projectedSizePx(o, f, cfg, live) {
    const b = bboxOf(o, live);
    return (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) + o.lwFrame) * f * cfg.enter;
}
