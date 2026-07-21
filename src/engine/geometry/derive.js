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

// ---- seams ----
// Adjacent tiles' pieces of the SAME object are clipped slightly PAST the tile
// so they OVERLAP instead of abutting — abutting edges each half-cover the seam
// pixel and antialiasing leaves a hairline. Overlap is safe whenever the pieces
// composite as a union rather than stacking: always for OPAQUE ink, and for
// translucent ink once per-object opacity groups union it before opacity
// applies. 5e-4 of a tile is ~1 px at a level's SHALLOWEST in-level zoom, which
// is where the pad has to earn its keep (deeper in, it only grows).
const SEAM_FRAC = 5e-4;
export function seamPad(o, rect, opacityGroups) {
    const opaque = o.opacity == null || o.opacity >= 1;
    if (!opaque && !opacityGroups) return 0;
    return (rect.right - rect.left) * SEAM_FRAC;
}
export function padRect(rect, p) {
    return p ? { left: rect.left - p, top: rect.top - p, right: rect.right + p, bottom: rect.bottom + p } : rect;
}

// ---- windows: regions a parent has ceded to re-homed children ----
// An erase made at a level DEEPER than an object's home cannot be baked into
// that object: Clipper's integer grid is fixed in the object's OWN units, so a
// hole thousands of times finer than the object's own scale rounds away (that
// was the blocky-erase failure). Instead the erase RE-HOMES — the surviving ink
// becomes natives of the level the erase was made at, and the parent records
// the rect it gave up. Rendering subtracts that rect wherever the parent is
// magnified enough to resolve it.
//
// A window is always sub-pixel at the parent's own level (it is at most
// eraser/~3000 there), so ONLY the magnify chain ever applies one — and when it
// is too small to resolve, the re-homed children are equally sub-pixel and the
// existing cull drops them, so parent-whole and parent-with-hole agree.
export function mapWindows(wins, s, t, base) {
    if (!wins || !wins.length) return null;
    return wins.map((w) => ({
        x0: (w.x0 * s + t.x) / base, y0: (w.y0 * s + t.y) / base,
        x1: (w.x1 * s + t.x) / base, y1: (w.y1 * s + t.y) / base,
    }));
}
// Split an object's windows, mapped into the child frame, into the ones big
// enough to punch here and the ones to carry forward to a deeper step.
export function splitWindows(o, s, t, cfg) {
    const wins = mapWindows(o.windows, s, t, cfg.base);
    if (!wins) return null;
    const lo = cfg.fadeLoPx != null ? cfg.fadeLoPx : 0.15;
    const apply = [], carry = [];
    for (const w of wins) {
        (Math.max(w.x1 - w.x0, w.y1 - w.y0) * cfg.enter >= lo ? apply : carry).push(w);
    }
    return { apply, carry: carry.length ? carry : null };
}
// rect minus axis-aligned holes -> disjoint rects (guillotine, ≤4 per hole).
// Pure float, deliberately: a Clipper difference would quantize the hole back
// onto the integer grid, which is the whole thing re-homing exists to avoid.
export function rectSubtract(rect, holes) {
    let regions = [{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
    for (const h of holes) {
        const next = [];
        for (const r of regions) {
            if (h.x1 <= r.left || h.x0 >= r.right || h.y1 <= r.top || h.y0 >= r.bottom) { next.push(r); continue; }
            const cx0 = Math.max(r.left, h.x0), cx1 = Math.min(r.right, h.x1);
            const cy0 = Math.max(r.top, h.y0), cy1 = Math.min(r.bottom, h.y1);
            if (r.top < cy0) next.push({ left: r.left, top: r.top, right: r.right, bottom: cy0 });
            if (cy1 < r.bottom) next.push({ left: r.left, top: cy1, right: r.right, bottom: r.bottom });
            if (r.left < cx0) next.push({ left: r.left, top: cy0, right: cx0, bottom: cy1 });
            if (cx1 < r.right) next.push({ left: cx1, top: cy0, right: r.right, bottom: cy1 });
        }
        regions = next;
        if (!regions.length) break;
    }
    return regions;
}
function insetWindows(windows, wanted) {
    if (!wanted) return windows;
    return windows.map((w) => {
        // Never consume a tiny window entirely: at most one quarter of its
        // short side, leaving a real hole while still overlapping its boundary.
        const p = Math.min(wanted, Math.max(0, (w.x1 - w.x0) / 4), Math.max(0, (w.y1 - w.y0) / 4));
        return { x0: w.x0 + p, y0: w.y0 + p, x1: w.x1 - p, y1: w.y1 - p, _seam: p };
    });
}
function clipRingsToRegions(rings, regions) {
    if (regions.length === 1) return clipRingsToRect(rings, regions[0]);
    const out = [];
    for (const rg of regions) for (const p of clipRingsToRect(rings, rg)) out.push(p);
    return out;
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
    // A resolvable window over this tile means real geometry has to be cut —
    // a tile-covering quad could not express the hole.
    const sw = splitWindows(o, s, t, cfg);
    if (sw) {
        for (const w of sw.apply) {
            if (w.x1 >= rect.left && w.x0 <= rect.right && w.y1 >= rect.top && w.y0 <= rect.bottom) return "edge";
        }
    }
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
// this is what bounds the magnify chain. `opts.pad` overlaps the quad into its
// neighbours (seam hairline); `opts.windows` are windows too small to punch
// here, handed on so a deeper step can punch them once they resolve.
export function solidQuad(o, rect, opts = {}) {
    const r = padRect(rect, opts.pad || 0);
    const q = { type: "fill", origin: "inherited", covers: true, id: o.id, z: o.z, color: o.color,
        opacity: o.opacity, polys: [[[r.left, r.top], [r.right, r.top],
            [r.right, r.bottom], [r.left, r.bottom]]], paths: [] };
    if (opts.windows && opts.windows.length) q.windows = opts.windows;
    return q;
}

// ---- exact port of KobinEngineV0._deriveInto (the "edge" tier) ----
// Transform parent objects into this level's frame ((p*s+t)/base) and clip to `rect`,
// applying the size gate (large strokes -> filled outline, small -> clipped stroke).
// opts: { cfg, width, opacityGroups, live, parentCurved, childCurved } — the curved
// flags accept a boolean or a per-object predicate (new engine: per-origin).
export function deriveStep(parentObjs, s, t, rect, level, opts, out) {
    const { cfg, width: W, opacityGroups, live } = opts;
    const base = cfg.base;
    const curvedP = typeof opts.parentCurved === "function" ? opts.parentCurved : () => opts.parentCurved;
    const curvedC = typeof opts.childCurved === "function" ? opts.childCurved : () => opts.childCurved;
    for (const o of parentObjs) {
        // Seam pad (see seamPad): per-object, because whether overlap is safe
        // depends on the object's own opacity.
        const pad = seamPad(o, rect, opacityGroups);
        const crect = padRect(rect, pad);
        // Cull on the transformed bbox before any geometry work (the clip operates
        // on raw points, so the point bbox plus the stroke-width margin is safe).
        const b = bboxOf(o, live);
        const m = o.type === "fill" ? pad : o.lwFrame * (s / base);
        if ((b.x1 * s + t.x) / base < rect.left - m || (b.x0 * s + t.x) / base > rect.right + m ||
            (b.y1 * s + t.y) / base < rect.top - m || (b.y0 * s + t.y) / base > rect.bottom + m) continue;
        // Windows this object has ceded to re-homed children: clip to the tile
        // MINUS the resolvable ones. With none, `regions` is the plain tile and
        // every path below is byte-identical to the pre-window behaviour.
        const sw = splitWindows(o, s, t, cfg);
        const holes = sw && sw.apply.length ? sw.apply : null;
        const carry = sw && sw.carry;
        // Shrink the ceded rect by the seam pad so the parent overlaps its
        // attached re-home patches. Renderer groups the family by editId, so
        // this is safe for transparent as well as opaque ink.
        const cutHoles = holes ? insetWindows(holes, pad) : null;
        const fillRegions = cutHoles ? rectSubtract(crect, cutHoles) : [crect];
        if (!fillRegions.length) continue; // wholly ceded to children
        const tag = (piece) => { if (carry) piece.windows = carry; out.push(piece); };
        if (o.type === "fill") {
            // Float clip (Sutherland-Hodgman), NOT Clipper: runs once per crossing
            // forever, and Clipper's magnitude-capped integer scale quantized
            // giant/deep geometry by whole frame-units.
            const tp = clipRingsToRegions(
                o.polys.map((poly) => poly.map(([x, y]) => [(x * s + t.x) / base, (y * s + t.y) / base])), fillRegions);
            if (tp.length) tag({ type: "fill", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, polys: tp, paths: [] });
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
                const fp = holes ? clipRingsToRegions(polys, fillRegions) : polys;
                if (fp.length) tag({ type: "fill", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, polys: fp, paths: [] });
            } else {
                // Small stroke: stays a stroke. If the child renders straight but the
                // parent displayed a spline, hand the child the flattened spline.
                const spts = (curvedP(o) && !curvedC(o) && o.pts.length > 2) ? flatChords(o, level, tpts, cfg, live) : tpts;
                // Extend the centerline clip by lw so clip-end caps fall beyond the
                // tile; fills clip to the exact rect -> adjacent tiles abut cleanly.
                const ew = { left: rect.left - lw, top: rect.top - lw, right: rect.right + lw, bottom: rect.bottom + lw };
                // Holes are subtracted from the EXTENDED rect (so tile seams keep
                // their overhang) and grown by half a linewidth, so the round cap
                // the clip leaves behind stops at the window edge instead of
                // bulging into ground the children own.
                const runRegions = cutHoles
                    ? rectSubtract(ew, cutHoles.map((h) => {
                        const grow = Math.max(0, lw / 2 - (h._seam || 0));
                        return { x0: h.x0 - grow, y0: h.y0 - grow, x1: h.x1 + grow, y1: h.y1 + grow };
                    }))
                    : [ew];
                for (const rg of runRegions) {
                    for (const run of clipPolylineToRect(spts, rg)) {
                        if (run.length) tag({ type: "stroke", origin: "inherited", id: o.id, z: o.z, color: o.color, opacity: o.opacity, pts: run, lwFrame: lw, paths: [] });
                    }
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
    return (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) + (o.lwFrame || 0)) * f * cfg.enter;
}
