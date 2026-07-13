/**
 * Auto-scenes v2 — see docs/auto-scenes-design-bible.md for the full spec.
 *
 * Everything here is one of three primitive shapes: rectangle overlap,
 * one-record projection (injected — this module never touches LevelMap),
 * and a weighted sort. All distances are relative to STROKE WIDTH, which
 * encodes the zoom the ink was drawn at:
 *
 *   window(w)       = WINDOW_WIDTHS × w      ("the screen it was drawn on")
 *   join distance   = JOIN_WINDOWS × window(w_coarser)
 *
 * Clustering runs per adjacent level pair, projecting the finer level's
 * geometry through that single crossing record; union-find is keyed by
 * global stroke id, so membership chains across pairs and levels are
 * bookkeeping, not boundaries. There is NO minimum: every cluster is a
 * scene, and pockets (much-finer ink inside a scene) become nested scenes
 * regardless of stroke count — the tiniest dot 3000× deep is a scene.
 *
 * The injected projector `proj`:
 *   proj.mapRect(rect{x0,y0,x1,y1}, fromLevel, toLevel) -> rect | null
 *   proj.widthFactor(fromLevel, toLevel)                -> number | null
 */
import { bboxOf } from "./geometry/derive";

export const WINDOW_WIDTHS = 600;   // window side = 600 × stroke width
export const JOIN_WINDOWS = 1.5;    // join across gaps ≤ 1.5 windows (coarser stroke)
export const CHUNK_WINDOWS = 1;     // long strokes chunked into ≤ 1-window pieces
export const CHUNK_PAIR_RATIO = 4;  // chunk-vs-chunk only within 4× width
export const DETAIL_RATIO = 16;     // pocket members ≥ 16× finer than scene median
export const POCKET_EXTENT_FRAC = 1 / 50; // pocket extent ≤ parent extent / 50
export const POCKET_RECURSION = 6;
export const FRAME_QUANTILE = 0.05; // frame = per-axis [5%,95%] ink-mass core
export const FRAME_PAD_FRAC = 0.10;
export const MATCH_IOU = 0.5;
export const RETARGET_IOU = 0.4;
export const RETARGET_ZOOM = 4;
export const SPLIT_FACTOR = 0.5;

const joinDist = (w) => JOIN_WINDOWS * WINDOW_WIDTHS * w;

// ---------------------------------------------------------------- geometry

const rectGapX = (a, b) => Math.max(0, Math.max(b.x0 - a.x1, a.x0 - b.x1));
const rectGapY = (a, b) => Math.max(0, Math.max(b.y0 - a.y1, a.y0 - b.y1));
const withinGap = (a, b, T) => rectGapX(a, b) <= T && rectGapY(a, b) <= T;

/** Effective width of an object in its own frame (fills get a synthetic one). */
function widthOf(o) {
    if (o.type === "stroke") return o.lwFrame || 1e-9;
    const b = bboxOf(o);
    return Math.max(b.x1 - b.x0, b.y1 - b.y0, 1e-9) / WINDOW_WIDTHS;
}

/**
 * Chunk an object's ink into rectangles ≤ 1 window of its own width, each
 * carrying its polyline length (`len`) for ink-mass math. Cached on the
 * object, invalidated by point-array identity (moves replace/mutate pts via
 * Document, which also drops _bbox).
 */
export function chunksOf(o) {
    if (o._sceneChunks && o._sceneChunksPts === o.pts && o._sceneChunksN === (o.pts ? o.pts.length : -1)) {
        return o._sceneChunks;
    }
    const w = widthOf(o);
    const maxSide = CHUNK_WINDOWS * WINDOW_WIDTHS * w;
    const out = [];
    if (o.type !== "stroke" || !o.pts || o.pts.length === 0) {
        const b = bboxOf(o);
        out.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, len: 2 * ((b.x1 - b.x0) + (b.y1 - b.y0)) || w });
    } else {
        let c = null;
        let px = null, py = null;
        const feed = (x, y) => {
            if (c) {
                const nx0 = Math.min(c.x0, x), ny0 = Math.min(c.y0, y);
                const nx1 = Math.max(c.x1, x), ny1 = Math.max(c.y1, y);
                if (nx1 - nx0 > maxSide || ny1 - ny0 > maxSide) {
                    out.push(c);
                    c = null;
                }
            }
            if (!c) c = { x0: x, y0: y, x1: x, y1: y, len: 0 };
            else {
                c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y);
                c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y);
            }
            if (px != null) c.len += Math.hypot(x - px, y - py);
            px = x; py = y;
        };
        for (const [x, y] of o.pts) {
            // Long segments (straight-line tool: 2-point strokes) are
            // interpolated so chunk boxes actually cover the ink between
            // sparse points — otherwise all mass lands on the endpoints.
            if (px != null) {
                const sx = px, sy = py;
                const seg = Math.hypot(x - sx, y - sy);
                const steps = Math.floor(seg / (maxSide / 2));
                for (let k = 1; k <= steps; k++) {
                    feed(sx + ((x - sx) * k) / (steps + 1), sy + ((y - sy) * k) / (steps + 1));
                }
            }
            feed(x, y);
        }
        if (c) out.push(c);
        if (out.length === 1 && out[0].len === 0) out[0].len = w; // a dot still has mass
    }
    o._sceneChunks = out;
    o._sceneChunksPts = o.pts;
    o._sceneChunksN = o.pts ? o.pts.length : -1;
    return out;
}

const outerBox = (chunks) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of chunks) {
        if (c.x0 < x0) x0 = c.x0; if (c.y0 < y0) y0 = c.y0;
        if (c.x1 > x1) x1 = c.x1; if (c.y1 > y1) y1 = c.y1;
    }
    return { x0, y0, x1, y1 };
};

function mapChunks(chunks, from, to, proj) {
    const out = [];
    const f = proj.widthFactor(from, to);
    if (f == null) return null;
    for (const c of chunks) {
        const r = proj.mapRect({ left: c.x0, top: c.y0, right: c.x1, bottom: c.y1 }, from, to);
        if (!r) return null;
        out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, len: c.len * f });
    }
    return out;
}

// ------------------------------------------------------------- clustering

/** One item = one object viewed in some working frame. */
function itemsAtLevel(nativesByLevel, L) {
    return (nativesByLevel[L] || [])
        .filter((o) => o.type === "stroke" || o.type === "fill")
        .map((o) => ({ id: o.id, level: L, w: widthOf(o), chunks: chunksOf(o) }))
        .map((it) => ({ ...it, box: outerBox(it.chunks) }));
}

/** Join test between two items in a shared frame, per the bible. */
function itemsJoin(a, b) {
    const wc = Math.max(a.w, b.w);
    const T = joinDist(wc);
    if (!withinGap(a.box, b.box, T)) return false;
    const ratio = wc / Math.max(Math.min(a.w, b.w), 1e-12);
    const [coarse, fine] = a.w >= b.w ? [a, b] : [b, a];
    if (ratio <= CHUNK_PAIR_RATIO) {
        for (const ca of coarse.chunks) {
            for (const cb of fine.chunks) if (withinGap(ca, cb, T)) return true;
        }
        return false;
    }
    for (const ca of coarse.chunks) if (withinGap(ca, fine.box, T)) return true;
    return false;
}

function clusterItems(items, scale = 1) {
    // scale < 1 tightens the join distance (manual split uses 0.5).
    const parent = new Map();
    const find = (i) => { let r = i; while (parent.get(r) !== r) r = parent.get(r); let c = i; while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
    const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent.set(ri, rj); };
    for (const it of items) if (!parent.has(it.id)) parent.set(it.id, it.id);
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            if (scale === 1 ? itemsJoin(a, b) : itemsJoinScaled(a, b, scale)) union(a.id, b.id);
        }
    }
    const groups = new Map();
    for (const it of items) {
        const r = find(it.id);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(it);
    }
    return [...groups.values()];
}

function itemsJoinScaled(a, b, scale) {
    const wc = Math.max(a.w, b.w);
    const T = joinDist(wc) * scale;
    if (!withinGap(a.box, b.box, T)) return false;
    const ratio = wc / Math.max(Math.min(a.w, b.w), 1e-12);
    const [coarse, fine] = a.w >= b.w ? [a, b] : [b, a];
    if (ratio <= CHUNK_PAIR_RATIO) {
        for (const ca of coarse.chunks) for (const cb of fine.chunks) if (withinGap(ca, cb, T)) return true;
        return false;
    }
    for (const ca of coarse.chunks) if (withinGap(ca, fine.box, T)) return true;
    return false;
}

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : 0; };

/** FNV-1a over stable member summaries — the change detector. */
export function membersHash(items) {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const parts = items
        .map((it) => `${it.id}:${it.level}:${r3(it.box.x0)}:${r3(it.box.y0)}:${r3(it.box.x1)}:${r3(it.box.y1)}:${r3(it.w)}`)
        .sort().join("|");
    let h = 0x811c9dc5;
    for (let i = 0; i < parts.length; i++) { h ^= parts.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
}

export const levelHash = (nativesByLevel, L) => membersHash(itemsAtLevel(nativesByLevel, L));

/** 90% ink-core frame over items (already in one frame), padded. */
function frameOfItems(items) {
    const chunks = [];
    for (const it of items) for (const c of it.chunks) chunks.push({ ...c, mass: Math.max(c.len, 1e-12) * it.w });
    const total = chunks.reduce((s, c) => s + c.mass, 0);
    const band = (key0, key1) => {
        const mids = chunks.map((c) => ({ m: (c[key0] + c[key1]) / 2, mass: c.mass })).sort((a, b) => a.m - b.m);
        let acc = 0, lo = mids[0].m, hi = mids[mids.length - 1].m, seenLo = false;
        for (const p of mids) {
            acc += p.mass;
            if (!seenLo && acc >= FRAME_QUANTILE * total) { lo = p.m; seenLo = true; }
            if (acc >= (1 - FRAME_QUANTILE) * total) { hi = p.m; break; }
        }
        return [Math.min(lo, hi), Math.max(lo, hi)];
    };
    const [qx0, qx1] = band("x0", "x1");
    const [qy0, qy1] = band("y0", "y1");
    // Cover the FULL boxes of chunks whose midpoints made the core.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of chunks) {
        const mx = (c.x0 + c.x1) / 2, my = (c.y0 + c.y1) / 2;
        if (mx < qx0 || mx > qx1 || my < qy0 || my > qy1) continue;
        if (c.x0 < x0) x0 = c.x0; if (c.y0 < y0) y0 = c.y0;
        if (c.x1 > x1) x1 = c.x1; if (c.y1 > y1) y1 = c.y1;
    }
    if (!Number.isFinite(x0)) { const b = outerBox(chunks); x0 = b.x0; y0 = b.y0; x1 = b.x1; y1 = b.y1; }
    const w = Math.max(x1 - x0, 1e-9), h = Math.max(y1 - y0, 1e-9);
    const pad = FRAME_PAD_FRAC * Math.max(w, h);
    return { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
}

// ------------------------------------------------------ scene computation

/**
 * Compute the full scene tree.
 * Returns proposals: [{ level, rect, hash, size, memberIds, parentIndex }]
 * ordered primary-first, parents before pockets. `proj` per module header.
 */
export function computeSceneProposals(nativesByLevel, proj) {
    const levels = Object.keys(nativesByLevel).map(Number)
        .filter((L) => (nativesByLevel[L] || []).length).sort((a, b) => a - b);
    if (!levels.length) return [];

    // 1) Union across adjacent level-pair windows, keyed by stroke id.
    const parent = new Map();
    const find = (i) => { let r = i; while (parent.get(r) !== r) r = parent.get(r); let c = i; while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
    const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent.set(ri, rj); };
    const byLevel = new Map(levels.map((L) => [L, itemsAtLevel(nativesByLevel, L)]));
    for (const items of byLevel.values()) for (const it of items) parent.set(it.id, it.id);

    for (const L of levels) {
        const own = byLevel.get(L);
        const finer = byLevel.has(L + 1) ? byLevel.get(L + 1) : [];
        const projected = [];
        for (const it of finer) {
            const chunks = mapChunks(it.chunks, L + 1, L, proj);
            const f = proj.widthFactor(L + 1, L);
            if (!chunks || f == null) continue;
            projected.push({ id: it.id, level: L + 1, w: it.w * f, chunks, box: outerBox(chunks) });
        }
        const window = own.concat(projected);
        for (let i = 0; i < window.length; i++) {
            for (let j = i + 1; j < window.length; j++) {
                if (itemsJoin(window[i], window[j])) union(window[i].id, window[j].id);
            }
        }
    }

    // 2) Components → top-level scenes, geometry in each anchor frame.
    const groups = new Map();
    for (const [L, items] of byLevel) {
        for (const it of items) {
            const r = find(it.id);
            if (!groups.has(r)) groups.set(r, []);
            groups.get(r).push(it);
        }
    }

    const out = [];
    for (const members of groups.values()) {
        const anchor = Math.min(...members.map((m) => m.level));
        buildScene(members, anchor, proj, out, -1, 0);
    }
    // Primary-first among top-level scenes; pockets already follow parents.
    const order = topoOrder(out);
    return order;
}

// Geometry reaches this many levels below a scene's anchor. Finer projection
// only UNDERFLOWS floats (harmless), but keep a sane cap; pockets re-anchor
// at their own coarsest level, so recursion regains reach at every step.
const GEOMETRY_CHAIN = 4;

/** Members (any levels) → one scene + its pockets, appended to `out`. */
function buildScene(members, anchor, proj, out, parentIndex, depth) {
    const inFrame = [];
    for (const m of members) {
        if (m.level === anchor) { inFrame.push(m); continue; }
        if (m.level - anchor > GEOMETRY_CHAIN) continue;
        const chunks = mapChunks(m.chunks, m.level, anchor, proj);
        const f = proj.widthFactor(m.level, anchor);
        if (!chunks || f == null) continue;
        inFrame.push({ id: m.id, level: m.level, w: m.w * f, chunks, box: outerBox(chunks) });
    }
    if (!inFrame.length) return;
    const rect = frameOfItems(inFrame);
    const wMed = median(inFrame.map((m) => m.w));
    const size = inFrame.reduce((s, m) => s + m.chunks.reduce((t, c) => t + Math.max(c.len, m.w) * m.w, 0), 0)
        / Math.max(wMed * wMed, 1e-24);
    const index = out.length;
    out.push({
        level: anchor, rect, hash: membersHash(members), size,
        memberIds: members.map((m) => m.id), parentIndex, depth,
    });

    // 3) Pockets: much-finer members, re-clustered at their own scale,
    // qualifying purely by extent ratio. Connectivity to parent ink is
    // ignored by construction (we only cluster the fine subset).
    //
    // The detail reference is the COARSEST member — the composition's
    // structural scale — NOT the median: when outer zoomed-out ink merges
    // whole compositions (the "Star" regression), fine strokes dominate the
    // population and a median reference sees no detail at all, silently
    // erasing every interior scene.
    if (depth >= POCKET_RECURSION) return;
    const wCoarse = Math.max(...inFrame.map((m) => m.w));
    const detail = inFrame.filter((m) => m.w <= wCoarse / DETAIL_RATIO);
    if (!detail.length) return;
    const parentExtent = Math.max(rect.w, rect.h);
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const cluster of clusterItems(detail)) {
        const box = outerBox(cluster.map((c) => c.box));
        const extent = Math.max(box.x1 - box.x0, box.y1 - box.y0);
        if (extent > parentExtent * POCKET_EXTENT_FRAC) continue;
        const pocketMembers = cluster.map((c) => byId.get(c.id)).filter(Boolean);
        const pocketAnchor = Math.min(...pocketMembers.map((m) => m.level));
        buildScene(pocketMembers, pocketAnchor, proj, out, index, depth + 1);
    }
}

/** Order: top scenes by size desc, each followed by its subtree. */
function topoOrder(flat) {
    const children = new Map();
    const roots = [];
    flat.forEach((s, i) => {
        if (s.parentIndex < 0) roots.push(i);
        else {
            if (!children.has(s.parentIndex)) children.set(s.parentIndex, []);
            children.get(s.parentIndex).push(i);
        }
    });
    roots.sort((a, b) => flat[b].size - flat[a].size);
    const out = [];
    const visit = (i) => {
        out.push(flat[i]);
        const kids = (children.get(i) || []).sort((a, b) => flat[b].size - flat[a].size);
        kids.forEach(visit);
    };
    roots.forEach(visit);
    // reindex parent pointers to the new order
    const newIndex = new Map(out.map((s, i) => [s, i]));
    return out.map((s) => ({
        ...s,
        parentIndex: s.parentIndex < 0 ? -1 : newIndex.get(flat[s.parentIndex]),
    }));
}

// ------------------------------------------------------------ reconciling

export function rectIoU(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    const uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
}

/** Compare two {level, rect} frames, projecting through ≤2 records if needed. */
export function framesIoU(a, b, proj) {
    if (a.level === b.level) return rectIoU(a.rect, b.rect);
    if (Math.abs(a.level - b.level) > 2) return 0;
    const [fine, coarse] = a.level > b.level ? [a, b] : [b, a];
    const m = proj.mapRect(
        { left: fine.rect.x, top: fine.rect.y, right: fine.rect.x + fine.rect.w, bottom: fine.rect.y + fine.rect.h },
        fine.level, coarse.level,
    );
    if (!m) return 0;
    return rectIoU({ x: m.left, y: m.top, w: m.right - m.left, h: m.bottom - m.top }, coarse.rect);
}

/**
 * Reconcile persisted scene state with fresh proposals (bible: identity).
 * state: { scenes, hidden, seq }; returns the same shape plus `members`
 * (sceneId -> memberIds, session-only).
 */
export function matchScenes(state, proposals, proj) {
    const prev = ((state && state.scenes) || []).filter((s) => s.id !== "cover"); // v1 relic
    const hidden = ((state && state.hidden) || []).slice();
    let seq = (state && state.seq) || 1;

    const pairs = [];
    proposals.forEach((p, pi) => {
        for (const s of prev) {
            const iou = framesIoU({ level: p.level, rect: p.rect }, { level: s.level, rect: s.rect }, proj);
            if (iou > MATCH_IOU) pairs.push({ pi, sid: s.id, iou });
        }
    });
    pairs.sort((a, b) => b.iou - a.iou);
    const matchFor = new Map();
    const claimed = new Set();
    for (const { pi, sid } of pairs) {
        if (matchFor.has(pi) || claimed.has(sid)) continue;
        matchFor.set(pi, prev.find((s) => s.id === sid));
        claimed.add(sid);
    }

    const out = [];
    const members = {};
    const idAt = [];
    proposals.forEach((p, pi) => {
        const m = matchFor.get(pi);
        let scene;
        if (m) {
            scene = { ...m, level: p.level, rect: m.pinned && m.captured ? m.rect : p.rect, hash: p.hash, depth: p.depth };
        } else if (hidden.some((h) => framesIoU({ level: p.level, rect: p.rect }, { level: h.level, rect: h.rect }, proj) > MATCH_IOU)) {
            idAt[pi] = null;
            return;
        } else {
            scene = { id: `s${seq}`, name: `Scene ${seq}`, level: p.level, rect: p.rect, hash: p.hash, pinned: false, auto: true, depth: p.depth };
            seq += 1;
        }
        scene.parent = p.parentIndex >= 0 ? idAt[p.parentIndex] || undefined : undefined;
        idAt[pi] = scene.id;
        members[scene.id] = p.memberIds;
        out.push(scene);
    });

    // Pinned scenes with no matching cluster survive (manual captures,
    // renamed scenes whose ink was erased); plain auto scenes drop.
    for (const s of prev) {
        if (!claimed.has(s.id) && s.pinned) out.push({ ...s, depth: s.depth || 0 });
    }
    return { scenes: out, hidden, seq, members };
}

/**
 * Capture-view resolution (bible §4): retarget the best matching scene or
 * report that a new one is needed. view: { level, rect }.
 */
export function resolveCapture(view, scenes, proj) {
    let best = null, bestIoU = 0;
    for (const s of scenes) {
        if (Math.abs(s.level - view.level) > 2) continue;
        const zoomRatio = ratioOfExtents(view, s, proj);
        if (zoomRatio == null || zoomRatio > RETARGET_ZOOM || zoomRatio < 1 / RETARGET_ZOOM) continue;
        const iou = framesIoU(view, { level: s.level, rect: s.rect }, proj);
        if (iou < RETARGET_IOU) continue;
        if (!centerInside(s, view, proj)) continue;
        if (iou > bestIoU) { best = s; bestIoU = iou; }
    }
    return best; // null → create new
}

function ratioOfExtents(view, s, proj) {
    const f = view.level === s.level ? 1 : proj.widthFactor(Math.max(view.level, s.level), Math.min(view.level, s.level));
    if (f == null) return null;
    const ev = Math.max(view.rect.w, view.rect.h) * (view.level >= s.level ? f : 1);
    const es = Math.max(s.rect.w, s.rect.h) * (s.level > view.level ? f : 1);
    return ev > es ? ev / es : es / ev;
}

function centerInside(s, view, proj) {
    const c = { x: s.rect.x + s.rect.w / 2, y: s.rect.y + s.rect.h / 2 };
    let p = c;
    if (s.level !== view.level) {
        const m = proj.mapRect({ left: c.x, top: c.y, right: c.x, bottom: c.y }, s.level, view.level);
        if (!m) return false;
        p = { x: m.left, y: m.top };
    }
    return p.x >= view.rect.x && p.x <= view.rect.x + view.rect.w
        && p.y >= view.rect.y && p.y <= view.rect.y + view.rect.h;
}

/** Manual split: re-cluster one scene's members at half the join distance. */
export function splitMembers(memberObjs, anchor, proj) {
    const items = [];
    for (const { o, level } of memberObjs) {
        const base = { id: o.id, level, w: widthOf(o), chunks: chunksOf(o) };
        if (level === anchor) items.push({ ...base, box: outerBox(base.chunks) });
        else {
            const chunks = mapChunks(base.chunks, level, anchor, proj);
            const f = proj.widthFactor(level, anchor);
            if (!chunks || f == null) continue;
            items.push({ id: o.id, level, w: base.w * f, chunks, box: outerBox(chunks) });
        }
    }
    if (items.length < 2) return null;
    const clusters = clusterItems(items, SPLIT_FACTOR);
    if (clusters.length < 2) return null;
    return clusters.map((c) => ({
        level: anchor,
        rect: frameOfItems(c),
        hash: membersHash(c),
        memberIds: c.map((m) => m.id),
    }));
}
