/**
 * Auto-scenes — deterministic discovery of "the drawings hidden inside a
 * canvas", per the agreed spec:
 *
 *   CLUSTER   Within each level, strokes whose bounding boxes — each inflated
 *             by GAP_LW_HALF × its own lwFrame — touch belong to one cluster.
 *             lwFrame is the stroke's width in its home frame, so the gap
 *             threshold scales with the zoom the ink was drawn at and is
 *             device-independent (same drawing ⇒ same scenes everywhere).
 *   QUALIFY   ≥ MIN_STROKES strokes, or a bbox diagonal ≥ MIN_DIAG_LW × the
 *             cluster's median stroke width (kills specks and pen tests).
 *   FRAME     Cluster bbox (with lw/2 ink margins) padded PAD_FRAC per side,
 *             stored as {x, y, w, h} in the level's frame. The frame is both
 *             the camera target and the thumbnail crop. Aspect correction is
 *             the consumer's job (it depends on the viewport).
 *   COVER     One synthetic scene (id "cover") frames all ink at the
 *             outermost inked level — it names the gallery thumbnail.
 *   STABLE    matchScenes() carries ids/names across recomputes by frame
 *             overlap (IoU > MATCH_IOU at the same level). Pinned scenes
 *             (renamed, or manual bookmarks) never auto-drop; deleting an
 *             auto scene records its frame in `hidden` so it cannot
 *             resurrect. Cross-level dedup is unnecessary by construction:
 *             adjacent levels differ by ×3,000, far past any "same view"
 *             ambiguity.
 *   SPLIT     splitProposals() re-clusters one scene's strokes at half the
 *             gap; ≥ 2 resulting clusters (any size) replace the original.
 */
import { bboxOf } from "./geometry/derive";

export const GAP_LW_HALF = 7.5;   // per-stroke bbox inflation, × lwFrame
export const PAD_FRAC = 0.12;     // frame padding per side
export const MIN_STROKES = 3;
export const MIN_DIAG_LW = 60;    // … or diagonal ≥ this many median widths
export const MATCH_IOU = 0.5;

const round3 = (v) => Math.round(v * 1000) / 1000;

function strokeBox(o, inflate) {
    const b = bboxOf(o);
    const m = (o.lwFrame || 0) / 2 + inflate * (o.lwFrame || 0);
    return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
}

const boxesTouch = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[(s.length - 1) >> 1] : 0;
}

/** FNV-1a over a stable per-stroke summary — cheap change detector. */
export function clusterHash(strokes) {
    const parts = strokes
        .map((o) => {
            const b = bboxOf(o);
            return `${o.id}:${o.pts ? o.pts.length : 0}:${round3(b.x0)}:${round3(b.y0)}:${round3(b.x1)}:${round3(b.y1)}:${round3(o.lwFrame || 0)}:${o.color || ""}:${o.opacity == null ? 1 : o.opacity}`;
        })
        .sort()
        .join("|");
    let h = 0x811c9dc5;
    for (let i = 0; i < parts.length; i++) {
        h ^= parts.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h.toString(36);
}

function clusterStrokes(strokes, inflate) {
    const boxes = strokes.map((o) => strokeBox(o, inflate));
    const parent = strokes.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            if (boxesTouch(boxes[i], boxes[j])) union(i, j);
        }
    }
    const groups = new Map();
    strokes.forEach((o, i) => {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(o);
    });
    return [...groups.values()];
}

function frameOf(strokes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of strokes) {
        const m = (o.lwFrame || 0) / 2;
        const b = bboxOf(o);
        if (b.x0 - m < x0) x0 = b.x0 - m;
        if (b.y0 - m < y0) y0 = b.y0 - m;
        if (b.x1 + m > x1) x1 = b.x1 + m;
        if (b.y1 + m > y1) y1 = b.y1 + m;
    }
    const w = Math.max(x1 - x0, 1e-9), h = Math.max(y1 - y0, 1e-9);
    const pad = PAD_FRAC * Math.max(w, h);
    return { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
}

function qualifies(strokes) {
    if (strokes.length >= MIN_STROKES) return true;
    const f = frameOf(strokes);
    const med = median(strokes.map((o) => o.lwFrame || 0));
    return med > 0 && Math.hypot(f.w, f.h) >= MIN_DIAG_LW * med;
}

/** All qualifying clusters, ordered outermost level first then area desc. */
export function computeSceneProposals(nativesByLevel) {
    const out = [];
    const levels = Object.keys(nativesByLevel).map(Number).filter((L) => (nativesByLevel[L] || []).length).sort((a, b) => a - b);
    for (const L of levels) {
        const strokes = nativesByLevel[L].filter((o) => o.type === "stroke" || o.type === "fill");
        if (!strokes.length) continue;
        for (const cluster of clusterStrokes(strokes, GAP_LW_HALF)) {
            if (!qualifies(cluster)) continue;
            out.push({ level: L, rect: frameOf(cluster), hash: clusterHash(cluster), strokes: cluster.length });
        }
    }
    out.sort((a, b) => a.level - b.level || (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
    return out;
}

/** The whole-drawing frame at the outermost inked level (gallery thumbnail). */
export function coverProposal(nativesByLevel) {
    const levels = Object.keys(nativesByLevel).map(Number).filter((L) => (nativesByLevel[L] || []).length).sort((a, b) => a - b);
    if (!levels.length) return null;
    const L = levels[0];
    const strokes = nativesByLevel[L];
    return { level: L, rect: frameOf(strokes), hash: clusterHash(strokes), strokes: strokes.length };
}

export function rectIoU(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    const uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
}

/**
 * Reconcile persisted scenes with fresh proposals.
 * `state`: { scenes, hidden, seq } from docMeta (all optional).
 * Returns the same shape, ready to persist.
 */
export function matchScenes(state, proposals, cover) {
    const prev = (state && state.scenes) || [];
    const hidden = ((state && state.hidden) || []).slice();
    let seq = (state && state.seq) || 1;

    const prevCover = prev.find((s) => s.id === "cover");
    const rest = prev.filter((s) => s.id !== "cover");
    const out = [];

    if (cover) {
        out.push({
            id: "cover",
            name: (prevCover && prevCover.name) || "Overview",
            level: cover.level, rect: cover.rect, hash: cover.hash,
            pinned: !!(prevCover && prevCover.pinned), auto: true,
        });
    }

    // Greedy best-IoU matching per level.
    const unmatched = new Set(rest.map((s) => s.id));
    const claimed = new Set();
    const pairs = [];
    proposals.forEach((p, pi) => {
        for (const s of rest) {
            if (s.level !== p.level) continue;
            const iou = rectIoU(s.rect, p.rect);
            if (iou > MATCH_IOU) pairs.push({ pi, sid: s.id, iou });
        }
    });
    pairs.sort((a, b) => b.iou - a.iou);
    const matchFor = new Map(); // pi -> scene
    for (const { pi, sid } of pairs) {
        if (matchFor.has(pi) || claimed.has(sid)) continue;
        matchFor.set(pi, rest.find((s) => s.id === sid));
        claimed.add(sid);
        unmatched.delete(sid);
    }

    proposals.forEach((p, pi) => {
        const m = matchFor.get(pi);
        if (m) {
            out.push({ ...m, level: p.level, rect: p.rect, hash: p.hash });
            return;
        }
        // Suppressed? (an auto scene the user deleted, matched by frame)
        if (hidden.some((h) => h.level === p.level && rectIoU(h.rect, p.rect) > MATCH_IOU)) return;
        out.push({
            id: `s${seq}`, name: `Scene ${seq}`,
            level: p.level, rect: p.rect, hash: p.hash,
            pinned: false, auto: true,
        });
        seq += 1;
    });

    // Pinned scenes with no matching cluster survive untouched (manual
    // bookmarks, renamed scenes whose ink was erased); plain auto scenes drop.
    for (const s of rest) {
        if (unmatched.has(s.id) && s.pinned) out.push(s);
    }

    out.sort((a, b) => (a.id === "cover" ? -1 : b.id === "cover" ? 1 : a.level - b.level || (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h)));
    return { scenes: out, hidden, seq };
}

/** Half-gap re-cluster of one scene's strokes; ≥2 clusters means splittable. */
export function splitProposals(scene, nativesByLevel) {
    const strokes = (nativesByLevel[scene.level] || []).filter((o) => {
        const b = bboxOf(o);
        const r = scene.rect;
        return b.x0 <= r.x + r.w && b.x1 >= r.x && b.y0 <= r.y + r.h && b.y1 >= r.y;
    });
    if (strokes.length < 2) return null;
    let inflate = GAP_LW_HALF / 2;
    // Halve until it splits (or gets pointlessly tight).
    for (let attempt = 0; attempt < 4; attempt++, inflate /= 2) {
        const clusters = clusterStrokes(strokes, inflate);
        if (clusters.length >= 2) {
            return clusters.map((c) => ({ level: scene.level, rect: frameOf(c), hash: clusterHash(c), strokes: c.length }));
        }
    }
    return null;
}
