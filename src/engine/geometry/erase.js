/**
 * erase.js — the geometry of a cut.
 *
 * THE RULE (bible §2): an erase cuts the representation at the level it was made
 * in. At the target's own home level that representation IS the object, so it is
 * cut in place. Anywhere else the representation is a tile, so the cut is a
 * RECIPE the object carries and every bake re-runs at its own fidelity (§4.1).
 *
 * WHY A RECIPE AND NOT A POLYGON. ×3000 per crossing makes "the object is far
 * bigger than the eraser" the normal case. Freezing the cut as polygons in the
 * object's own frame is impossible a few crossings down — at four crossings the
 * eraser's radius is 3e-17 of the object's own extent, an order of magnitude
 * below float64's relative resolution — and freezing it at the erase level's
 * fidelity makes the edge grow visible facets as soon as you zoom past it.
 * Carrying the footprint and re-subtracting keeps the edge as smooth as the
 * level can show, at every level, forever.
 *
 * WHERE THE ARITHMETIC HAPPENS, and this is the constraint everything else bends
 * around: tiles OVERLAP (see derive.js, seams), so two tiles both hold a copy of
 * the ink in the band along their shared edge. If each computed its own cut in
 * its own tile-local coordinates, the two copies of the hole would disagree by a
 * lattice cell and leave a sliver of ink inside it. So every cut is computed in
 * coordinates anchored to the CUT — never to the tile — and merely clipped per
 * tile. Every tile then does identical arithmetic and gets bit-identical rings.
 *
 * The same anchoring is what buys the precision: Clipper is integer-based with a
 * magnitude-capped scale, so a tile-sized subject and a screen-sized clip cannot
 * share one useful lattice. The subject is therefore guillotined into "near the
 * cut" (a small box, where the boolean runs on a lattice set by the cut) and
 * "everywhere else" (pure float ring clipping, exact), and the two are unioned
 * back with the same kind of overlap tiles use.
 */
import { clipRingsToRect, subtractPolys, netRingsArea } from "./clipperOutline";
import { strokeLoops, flattenLoops, loopsBbox } from "./curveOutline";
import { rectSubtract } from "./derive";

// A cut is only worth applying where it can be SEEN. Same gate the window
// machinery uses: resolvable means it would paint at least fadeLoPx across at
// the frame's deepest in-level zoom. Coarser than that and the ink around it is
// equally sub-pixel, so cut and uncut agree — which is exactly what makes
// zooming out across a crossing continuous with no re-baking (bible §2.3).
export function cutVisible(extent, cfg) {
    const lo = cfg.fadeLoPx != null ? cfg.fadeLoPx : 0.15;
    return extent * cfg.enter >= lo;
}

function ringsBbox(rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (const [x, y] of r) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
}

/**
 * The eraser gesture's painted footprint, as CURVE LOOPS in coordinates local to
 * its own centre — built once and thereafter only mapped and flattened.
 *
 * An eraser is a stroke, so it is polygonized by exactly the rule ink strokes
 * are (`strokeLoops`): above the fat gate the outline is CURVES, not points.
 * That is what lets the same cut be re-flattened at whatever fidelity the level
 * consuming it needs — smooth at any zoom, instead of exact at the one zoom it
 * happened to be cut at. A polygon frozen at the erase level grows visible
 * facets the moment you zoom past it; a cubic does not.
 *
 * Local coordinates are not a detail either: Clipper caps its integer scale by
 * the largest coordinate present, so building a 32-unit eraser's geometry at
 * frame coordinate 1e5 would quantize it to ~0.0025 units. Centred, it resolves
 * to ~1e-6.
 */
export function eraserFootprint(E, cfg) {
    if (E._clip) return E._clip;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of E.pts) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (!(x0 <= x1)) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const local = {
        type: "stroke", origin: E.origin, id: E.id, lwFrame: E.lwFrame,
        pts: E.pts.map(([x, y]) => [x - cx, y - cy]),
    };
    const loops = strokeLoops(local, cfg, { curved: E.origin === "native" });
    if (!loops.length) return null;
    const b = loopsBbox(loops);
    E._clip = {
        origin: [cx, cy], loops,
        // Extent of the footprint itself — what decides whether a level can
        // resolve this cut, and how big a neighbourhood the boolean needs.
        w: b.x1 - b.x0, h: b.y1 - b.y0,
    };
    return E._clip;
}

/**
 * The footprint as polygon RINGS at a requested tolerance (cut-local units).
 *
 * This is the whole point of storing curves: every consumer asks for the
 * fidelity IT needs. A coarse level gets a cheap ring set; a level 3000× deeper
 * asks for a 3000× finer one off the very same cubics, and the edge is as smooth
 * there as it was here. Memoized in quarter-octave buckets so a pan or an
 * in-level zoom re-uses the last answer.
 */
export function cutRings(cut, tol) {
    const t = tol > 0 ? tol : 1e-9;
    const key = Math.round(Math.log2(t) * 4);
    if (!cut._rings) cut._rings = new Map();
    let rings = cut._rings.get(key);
    if (!rings) {
        rings = flattenLoops(cut.loops, Math.pow(2, key / 4));
        if (cut._rings.size > 8) cut._rings.clear();
        cut._rings.set(key, rings);
    }
    return rings;
}

// The record an object carries. `frame` anchors it; `origin` is where the
// footprint sits in that frame; `loops` are cubics local to that origin and
// never change. Clipped to the object's own neighbourhood at bake time (bible
// §4.2), so a wild gesture that splits one object into hundreds of pieces costs
// about one object's worth in total rather than a copy of the whole gesture per
// piece.
export function cutRecord(clip, frame, keepLoops) {
    const loops = keepLoops || clip.loops;
    const b = loopsBbox(loops);
    return {
        frame, origin: [clip.origin[0], clip.origin[1]], loops,
        w: b.x1 - b.x0, h: b.y1 - b.y0,
    };
}

// Restrict a cut to the loops that can matter to `box` (cut-local coordinates).
// Whole loops are kept or dropped — `strokeOutlineCurves` already emits one loop
// per capsule run, so this narrows along the gesture without ever cutting a
// cubic in half and losing its exactness.
export function narrowCut(cut, box) {
    const kept = cut.loops.filter((loop) => {
        const b = loopsBbox([loop]);
        return b.x1 >= box.left && b.x0 <= box.right && b.y1 >= box.top && b.y0 <= box.bottom;
    });
    if (!kept.length) return null;
    return cutRecord({ origin: cut.origin, loops: kept }, cut.frame, kept);
}

/**
 * Subtract every cut of an object from one tile's worth of its rings.
 *
 * `ctx`:
 *   place(cut) -> { x, y, f } | null   the cut's origin and scale in THESE
 *                                      coordinates (one bounded frame hop per
 *                                      step, never a composed long jump)
 *   rect                               the window `rings` are exact in
 *   cfg
 */
export function subtractCuts(rings, cuts, ctx) {
    if (!rings || !rings.length || !cuts || !cuts.length) return rings;
    const { cfg } = ctx;
    // Place every cut that this window can both reach and resolve.
    const live = [];
    for (const cut of cuts) {
        const at = ctx.place(cut);
        if (!at) continue;
        const w = cut.w * at.f, h = cut.h * at.f;
        if (!cutVisible(Math.max(w, h), cfg)) continue; // sub-pixel: cut and uncut agree
        // Fidelity this frame actually needs, expressed back in cut-local units:
        // arcTolerancePx at the frame's deepest zoom, divided by how much the
        // cut is magnified getting here. Deeper frames therefore ask the SAME
        // cubics for a finer polygon, which is what keeps the edge smooth.
        const tol = (cfg.arcTolerancePx * 0.5) / (cfg.enter * at.f);
        const rings = cutRings(cut, tol);
        const b = ringsBbox(rings);
        const mx = w / 4 + 1e-12, my = h / 4 + 1e-12;
        const box = {
            left: at.x + b.x0 * at.f - mx, top: at.y + b.y0 * at.f - my,
            right: at.x + b.x1 * at.f + mx, bottom: at.y + b.y1 * at.f + my,
        };
        if (box.right < ctx.rect.left || box.left > ctx.rect.right ||
            box.bottom < ctx.rect.top || box.top > ctx.rect.bottom) continue; // nowhere near
        live.push({ cut, at, box, w, h, rings });
    }
    if (!live.length) return rings;

    // GROUP THE CUTS THAT SHARE A NEIGHBOURHOOD, and guillotine ONCE per group.
    //
    // The guillotine splits the subject into "near the cut" and "everywhere
    // else", and "everywhere else" is up to four strips. Doing that once per cut
    // meant the strips of one cut were re-split by the next, so the ring count
    // COMPOUNDED: measured on a real drawing, one object went from 1 ring to 162
    // after 12 erases, and a fat stroke from 8,940 to 79,954 after 14 — past the
    // ~65k arguments `Array.prototype.push.apply` accepts, which is where the
    // renderer's "Maximum call stack size exceeded" came from. Grouping makes
    // the split happen once per CLUSTER of erases rather than once per erase, so
    // repeated erasing in one place costs a constant, not a product.
    const groups = [];
    for (const item of live) {
        const near = (g) => g.box.right >= item.box.left && g.box.left <= item.box.right &&
            g.box.bottom >= item.box.top && g.box.top <= item.box.bottom;
        let g = groups.find(near);
        if (!g) { g = { box: { ...item.box }, items: [] }; groups.push(g); }
        g.items.push(item);
        g.box.left = Math.min(g.box.left, item.box.left);
        g.box.top = Math.min(g.box.top, item.box.top);
        g.box.right = Math.max(g.box.right, item.box.right);
        g.box.bottom = Math.max(g.box.bottom, item.box.bottom);
    }
    // Merge groups that grew into each other, so the boxes stay disjoint.
    for (let again = true; again;) {
        again = false;
        outer:
        for (let a = 0; a < groups.length; a++) {
            for (let b = a + 1; b < groups.length; b++) {
                const A = groups[a].box, B = groups[b].box;
                if (A.right < B.left || B.right < A.left || A.bottom < B.top || B.bottom < A.top) continue;
                A.left = Math.min(A.left, B.left); A.top = Math.min(A.top, B.top);
                A.right = Math.max(A.right, B.right); A.bottom = Math.max(A.bottom, B.bottom);
                groups[a].items.push(...groups[b].items);
                groups.splice(b, 1);
                again = true;
                break outer;
            }
        }
    }

    let cur = rings;
    for (const g of groups) {
        if (!cur.length) break;
        // Outside the group's neighbourhood: untouched, carried across by pure
        // float ring clipping. The two halves ABUT exactly rather than
        // overlapping — they are subpaths of ONE path filled once, so a shared
        // float edge rasterizes with no seam, while overlapping them made the
        // nonzero fill rule sum +1 and −1 to ZERO and punch a spurious hole.
        const hole = { x0: g.box.left, y0: g.box.top, x1: g.box.right, y1: g.box.bottom };
        const out = [];
        for (const rg of rectSubtract(ctx.rect, [hole])) {
            for (const p of clipRingsToRect(cur, rg)) out.push(p);
        }
        const inner = clipRingsToRect(cur, g.box);
        if (inner.length) {
            // WHERE THE ORIGIN GOES. Clipper is integer-based and caps its scale
            // by the largest coordinate present, so the anchor decides how fine
            // the lattice is — and, because tiles overlap, whether two tiles
            // compute the SAME hole.
            //
            //  - Cuts smaller than the region (every ordinary erase, and the only
            //    case where two tiles hold the same hole edge): anchor on the
            //    CUTS. Every tile then does identical arithmetic on identical
            //    numbers and the two copies of the hole agree bit for bit.
            //  - Cuts larger than the region (erasing at a level coarser than the
            //    ink): anchoring on them would put the region far from the origin
            //    and coarsen the lattice by that ratio. Anchor on the region.
            //    Adjacent tiles can then disagree by at most one lattice cell
            //    along the eraser's boundary — but a cut that large is whole
            //    tiles across, so only the few tiles its boundary crosses are
            //    involved at all.
            const region = {
                left: Math.max(ctx.rect.left, g.box.left), top: Math.max(ctx.rect.top, g.box.top),
                right: Math.min(ctx.rect.right, g.box.right), bottom: Math.min(ctx.rect.bottom, g.box.bottom),
            };
            const span = Math.max(region.right - region.left, region.bottom - region.top);
            const biggest = Math.max(...g.items.map((it) => Math.max(it.w, it.h)));
            const onCut = biggest <= span;
            const ax = onCut ? (g.box.left + g.box.right) / 2 : (region.left + region.right) / 2;
            const ay = onCut ? (g.box.top + g.box.bottom) / 2 : (region.top + region.bottom) / 2;
            const subj = inner.map((r) => r.map(([x, y]) => [x - ax, y - ay]));
            const pad = span * 0.5 + 1e-9;
            const win = { left: region.left - ax - pad, top: region.top - ay - pad,
                right: region.right - ax + pad, bottom: region.bottom - ay + pad };
            // Every clip in this group goes into ONE difference.
            let clip = [];
            for (const it of g.items) {
                for (const r of it.rings) {
                    clip.push(r.map(([x, y]) => [it.at.x + x * it.at.f - ax, it.at.y + y * it.at.f - ay]));
                }
            }
            clip = clipRingsToRect(clip, win);
            const kept = clip.length ? subtractPolys(subj, clip, { scale: 1e7 }) : [subj];
            for (const rg of kept) for (const r of rg) out.push(r.map(([x, y]) => [x + ax, y + ay]));
        }
        cur = out;
    }
    return cur;
}

// Does any cut of `o` resolve inside `rect`? Used to force the area (outline)
// representation — a centerline cannot express a hole through a band — and to
// stop the solid tier standing in for a tile it cannot describe.
export function cutsResolveIn(o, rect, ctx) {
    if (!o.cuts || !o.cuts.length) return false;
    for (const cut of o.cuts) {
        const at = ctx.place(cut);
        if (!at) continue;
        const w = cut.w * at.f, h = cut.h * at.f;
        if (!cutVisible(Math.max(w, h), ctx.cfg)) continue;
        const b = loopsBbox(cut.loops);
        const l = at.x + b.x0 * at.f, r = at.x + b.x1 * at.f;
        const t = at.y + b.y0 * at.f, bt = at.y + b.y1 * at.f;
        if (r >= rect.left && l <= rect.right && bt >= rect.top && t <= rect.bottom) return true;
    }
    return false;
}

/**
 * Which of `regions` touch the boundary of `W` (within `eps`), and which are
 * fully enclosed by it.
 *
 * An enclosed fragment is severed with NO relay at all — it touches nothing, so
 * no amount of ink outside the window can reconnect it (bible §3.1). Everything
 * that reaches the boundary is still an open question, and that question is the
 * relay's.
 */
export function splitByBoundary(regions, W, eps) {
    const enclosed = [], open = [];
    for (const rings of regions) {
        let touches = false;
        for (const [x, y] of rings[0]) {
            if (Math.abs(x - W.left) <= eps || Math.abs(x - W.right) <= eps ||
                Math.abs(y - W.top) <= eps || Math.abs(y - W.bottom) <= eps) { touches = true; break; }
        }
        (touches ? open : enclosed).push(rings);
    }
    return { enclosed, open };
}

// How much ink a clip actually removes from a subject, as a fraction of the
// subject. The engine uses it to skip grazing passes: a gesture that goes near
// ink without covering it must not churn a stroke into fills for no reason
// (regression R-7).
export function removedFraction(subject, clip) {
    const before = netRingsArea(subject);
    if (!(before > 0)) return 0;
    const after = subtractPolys(subject, clip).reduce((s, rg) => s + netRingsArea(rg), 0);
    return (before - after) / before;
}

export { ringsBbox };
