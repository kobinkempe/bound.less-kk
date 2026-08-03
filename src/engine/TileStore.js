/**
 * TileStore — the universal, bidirectional tile cache, keyed by FRAME (see
 * docs/local-frames-design-bible.md). Each level index is now a frame id; the
 * old L-1 / L+1 arithmetic is replaced by tree walks (parent / descendants /
 * cross-branch), which for a one-frame-per-depth "spine" reduces EXACTLY to the
 * previous per-level behaviour.
 *
 * Two content classes per tile, kept strictly separate (the XOR invariant):
 *
 *   upContent(F)   — ANCESTOR frames' objects, MAGNIFIED into F. Built by
 *                    CHAINING one ×(s/base)≈3000 edge at a time through the
 *                    parent's tiles (magnify must chain: a composed long jump
 *                    cancels catastrophically). empty/solid/edge classification;
 *                    SOLID replaces a tile-covering band with a 4-vertex quad so
 *                    geometry can never outgrow a tile (BUG-05 fix).
 *
 *   downContent(F) — every NON-ANCESTOR frame G with depth(G) ≥ depth(F),
 *                    projected DIRECTLY into F (net factor ≤ ~1: descendants
 *                    minify; same/deeper siblings go up-to-common-ancestor then
 *                    down, still bounded). Read from the Document's natives; a
 *                    view-independent cull drops sub-pixel content and a fade
 *                    band tags size (BUG-04). This is what makes a stroke drawn
 *                    in a far sibling frame appear when viewing its neighbour.
 *
 * Coarser off-branch content (an "uncle": depth(G) < depth(F), different branch)
 * would need to MAGNIFY into F from another branch — the up-chain's lateral
 * pickup, deferred (Stage 3 remainder). It cannot arise in a spine.
 *
 * Ordinary own natives(F) are NOT baked into F's own tiles — they render live
 * (curved) at the active frame. The narrow exception is a native with ownership
 * windows: ownContent clips that parent through visible tiles so its re-homed
 * descendants can remain visible across the outward boundary.
 */
import { deriveStep, classifyUp, solidQuad, projectedSizePx, bboxOf, displayChords, splitWindows, seamPad, padRect } from "./geometry/derive";
import { flattenCurve, clipPolylineToRect, clipRingsToRect } from "./geometry/clipperOutline";

const GLOBAL_CAP = 512;   // total cached tiles before LRU eviction
const PER_LEVEL_CAP = 64; // cached tiles per frame
const DOWN_MAX_SIZE = 5e5; // generous upper bound on a native's frame extent (px);
                           // used only to skip a frame whose content is guaranteed
                           // sub-cull at F.

function logicalMeta(src, dst) {
    if (src.editId != null) dst.editId = src.editId;
    if (src.srcId != null) dst.srcId = src.srcId;
    if (src.attachRect) dst.attachRect = { ...src.attachRect };
    if (src.eraseCell) dst.eraseCell = { ...src.eraseCell };
    if (src._rev != null) dst._rev = src._rev;
    return dst;
}

export default class TileStore {
    constructor(levelMap, doc, cfg) {
        this.lm = levelMap;
        this.doc = doc;
        this.cfg = cfg;
        this.cullPx = cfg.cullPx != null ? cfg.cullPx : 0.3;       // below this at the frame's deepest zoom -> not baked plain
        this.fadeLoPx = cfg.fadeLoPx != null ? cfg.fadeLoPx : 0.15; // below this -> culled entirely; [fadeLo, cull) -> fade band
        this.opacityGroups = true;
        this.live = null;    // the in-progress stroke, exempt from bbox/flatten caches
        this.cache = new Map(); // "F|dir|i,j" -> { level, dir, i, j, objs, epoch, lru }
        // Placed ancestors need the same bounded, one-edge-at-a-time derivation
        // as ordinary upContent.  Keeping it separate avoids polluting the
        // shared cache with per-object placement state.
        this.placedCache = new Map();
        this._clock = 0;
        this._epoch = 0;
        this._pins = new Set(); // keys protected from eviction during a bake/render
        this._unsub = doc.subscribe((ev) => this._onDoc(ev));
    }
    destroy() {
        if (this._unsub) this._unsub();
        this.cache.clear();
        this.placedCache.clear();
    }

    setOpacityGroups(v) { if (v !== this.opacityGroups) { this.opacityGroups = v; this.bumpEpoch(); } }
    bumpEpoch() {
        this._epoch++;
        this.cache.clear();
        this.placedCache.clear();
    }

    // ---- helpers ----
    _depth(frameId) { const d = this.lm.depthOf(frameId); return d == null ? 0 : d; }

    // ---- document content bounds (by depth) ----
    _minContentDepth() {
        let m = Infinity;
        for (const k of this.doc.levels()) if (this.doc.at(k).length) { const d = this._depth(k); if (d < m) m = d; }
        return m;
    }
    _maxContentDepth() {
        let m = -Infinity;
        for (const k of this.doc.levels()) if (this.doc.at(k).length) { const d = this._depth(k); if (d > m) m = d; }
        return m;
    }

    // ---- read path: everything to render at frame `F` inside `windowRect` ----
    // `F` may be a frame id or a legacy depth int — normalize to the canonical
    // frame id so tile keys and `frame()` lookups are exact.
    content(F, windowRect) {
        const cf = this.lm.frameFor(F);
        if (!cf) return [];
        F = cf.id;
        const out = [];
        const range = this.lm.tileRange(F, windowRect);
        const nowVisible = new Set();
        for (let i = range.i0; i <= range.i1; i++) {
            for (let j = range.j0; j <= range.j1; j++) {
                for (const dir of ["up", "down"]) {
                    const key = F + "|" + dir + "|" + i + "," + j;
                    nowVisible.add(key);
                    this._pins.add(key);
                    const tile = dir === "up" ? this._ensureUp(F, i, j) : this._ensureDown(F, i, j);
                    for (const o of tile.objs) out.push(o);
                }
            }
        }
        this._pins = nowVisible; // only currently-visible tiles are pinned
        this._evict();
        return out;
    }

    // Own natives ordinarily render live, outside the tile cache. A native that
    // has ceded ownership windows is the exception: its parent representation
    // must be visibly cut even while ITS OWN frame is active, with descendant
    // re-home patches arriving through downContent to fill the surviving ink.
    //
    // Clip these few window-owning natives through the visible tiles. Fills use
    // the float ring clip; strokes are first represented as their display-faithful
    // outline so a window can cut a hole inside a very wide band without relying
    // on the centerline. Geometry remains tile-bounded and is grouped by logical
    // id in Renderer, exactly like ordinary Kobinized pieces.
    ownContent(F, windowRect) {
        const cf = this.lm.frameFor(F);
        if (!cf) return [];
        F = cf.id;
        const plain = [], cut = [];
        const range = this.lm.tileRange(F, windowRect);
        const zero = { x: 0, y: 0 };
        for (const o of this.doc.at(F)) {
            if (o.placements && o.placements.length) continue; // rendered by placedContent
            const sw = splitWindows(o, this.cfg.base, zero, this.cfg);
            if (!sw || !sw.apply.length) { plain.push(o); continue; }

            // Native splines need the same sub-pixel-at-deepest-zoom chords as
            // their displayed curve before the analytic outline is tiled.
            const source = o.type === "stroke" && o.origin === "native" && o.pts.length > 2
                ? { type: "stroke", origin: "derived", id: o.id, z: o.z,
                    pts: displayChords(o, this.cfg, this.live), lwFrame: o.lwFrame,
                    color: o.color, opacity: o.opacity, windows: o.windows, paths: [] }
                : o;
            for (let i = range.i0; i <= range.i1; i++) {
                for (let j = range.j0; j <= range.j1; j++) {
                    deriveStep([source], this.cfg.base, zero, this.lm.tileRect(F, i, j), F, {
                        cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups,
                        live: this.live, parentCurved: false, childCurved: false,
                        forceOutline: source.type === "stroke", windowPad: 0,
                    }, cut);
                }
            }
        }
        return plain.concat(cut);
    }

    _translatePlacedPiece(o, dx, dy) {
        if (!dx && !dy) return o;
        const shift = (ring) => ring.map(([x, y]) => [x + dx, y + dy]);
        const common = {
            type: o.type, origin: o.origin, id: o.id, z: o.z,
            color: o.color, opacity: o.opacity, paths: [],
        };
        const out = o.type === "fill"
            ? { ...common, polys: o.polys.map(shift) }
            : { ...common, pts: shift(o.pts), lwFrame: o.lwFrame };
        if (o.covers) out.covers = true;
        if (o.windows && o.windows.length) {
            out.windows = o.windows.map((w) => ({
                ...w,
                x0: w.x0 + dx, x1: w.x1 + dx,
                y0: w.y0 + dy, y1: w.y1 + dy,
            }));
        }
        if (o.attachRect) {
            out.attachRect = {
                ...o.attachRect,
                x0: o.attachRect.x0 + dx, x1: o.attachRect.x1 + dx,
                y0: o.attachRect.y0 + dy, y1: o.attachRect.y1 + dy,
            };
        }
        if (o.editId != null) out.editId = o.editId;
        if (o.srcId != null) out.srcId = o.srcId;
        if (o.eraseCell) out.eraseCell = { ...o.eraseCell };
        if (o.fadeTag != null) out.fadeTag = o.fadeTag;
        if (o.curved != null) out.curved = o.curved;
        if (o._rev != null) out._rev = o._rev;
        return out;
    }

    // Assign every movement to the earliest frame on the home->view chain in
    // which its vector is representable.  A move made at level 15 is far below
    // a root Number's ULP, so applying it at root would silently lose it; after
    // a few bounded crossings it becomes an ordinary local translation.
    _placedUpPlan(o, H, F) {
        const path = this.lm.framePath(H, F);
        if (!path || path.up.length) return null;
        const frames = [String(H), ...path.down.map(String)];
        const deltas = new Map();
        const deferred = [];
        const minLocal = 1e-7;
        for (const move of o.placements || []) {
            let chosen = null;
            let chosenDelta = { x: 0, y: 0 };
            for (const frame of frames) {
                const factor = this.lm.frameFactor(move.frame, frame);
                if (factor == null) continue;
                const dx = (move.dx || 0) * factor;
                const dy = (move.dy || 0) * factor;
                if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
                if (Math.max(Math.abs(dx), Math.abs(dy)) < minLocal) continue;
                chosen = frame;
                chosenDelta = { x: dx, y: dy };
                break;
            }
            // A movement that is still below this frame's numeric/display
            // resolution must not be rounded into geometry. Re-home callers
            // carry it to their child, where later 3000x crossings make it an
            // ordinary local translation.
            if (chosen == null) { deferred.push(move); continue; }
            const prior = deltas.get(chosen) || { x: 0, y: 0 };
            deltas.set(chosen, {
                x: prior.x + chosenDelta.x,
                y: prior.y + chosenDelta.y,
            });
        }
        const signature = (o.placements || []).map((p) =>
            `${p.id || ""}@${p.frame}:${p.dx || 0},${p.dy || 0}`).join("|");
        return { deltas, deferred, signature };
    }

    // Derive one placed ancestor into one destination tile.  Placement is
    // injected as a local translation at the planned frame; the requested tile
    // is inverse-shifted before looking up its parent.  Consequently every
    // polygonization and SOLID decision sees tile-sized numbers, just like
    // ordinary Kobinization, instead of a level-0 polygon spanning 3000^15.
    _placedUpTile(o, H, F, i, j, plan) {
        const key = `${this._epoch}|${o.id}|${o._rev || 0}|${H}>${F}|${i},${j}|${plan.signature}`;
        const hit = this.placedCache.get(key);
        if (hit) return hit;
        const frame = this.lm.frame(F);
        const parentId = frame && frame.parent;
        const rec = frame && frame.edge;
        if (!parentId || !rec) return [];
        const rect = this.lm.tileRect(F, i, j);
        const delta = plan.deltas.get(String(F)) || { x: 0, y: 0 };
        const sourceRect = {
            left: rect.left - delta.x, top: rect.top - delta.y,
            right: rect.right - delta.x, bottom: rect.bottom - delta.y,
        };
        const parentObjs = [];
        if (String(parentId) === String(H)) {
            const homeDelta = plan.deltas.get(String(H)) || { x: 0, y: 0 };
            parentObjs.push(this._translatePlacedPiece(o, homeDelta.x, homeDelta.y));
        } else {
            const pr = this.lm.rectToParent(sourceRect, F);
            const range = this.lm.tileRange(parentId, pr);
            for (let pi = range.i0; pi <= range.i1; pi++) {
                for (let pj = range.j0; pj <= range.j1; pj++) {
                    for (const p of this._placedUpTile(o, H, parentId, pi, pj, plan)) {
                        parentObjs.push(p);
                    }
                }
            }
        }
        const raw = [];
        const edges = [];
        for (const p of parentObjs) {
            const tier = classifyUp(p, rec.s, rec.t, sourceRect, this.cfg, this.live);
            if (tier === "empty") continue;
            if (tier === "solid") raw.push(this._solid(p, rec, sourceRect));
            else edges.push(p);
        }
        deriveStep(edges, rec.s, rec.t, sourceRect, F, {
            cfg: this.cfg, width: this.lm.width,
            opacityGroups: this.opacityGroups, live: this.live,
            parentCurved: (p) => p.origin === "native",
            childCurved: () => false,
        }, raw);
        const out = (delta.x || delta.y)
            ? raw.map((p) => this._translatePlacedPiece(p, delta.x, delta.y))
            : raw;
        this.placedCache.set(key, out);
        return out;
    }

    // Placed ancestors magnify through the same bounded chain as ordinary
    // upContent.  Same-frame and minifying/cross-branch objects remain safe to
    // project directly with floating expansions.
    placedContent(F, windowRect) {
        const cf = this.lm.frameFor(F);
        if (!cf) return [];
        F = cf.id;
        const out = [];
        const zero = { x: 0, y: 0 };
        for (const H of this.doc.levels()) {
            const factor = this.lm.frameFactor(H, F);
            if (factor == null) continue;
            for (const o of this.doc.at(H)) {
                if (!o.placements || !o.placements.length) continue;
                if (String(H) !== String(F) && this.lm.isAncestor(H, F)) {
                    const plan = this._placedUpPlan(o, H, F);
                    if (!plan) continue;
                    const range = this.lm.tileRange(F, windowRect);
                    for (let i = range.i0; i <= range.i1; i++) {
                        for (let j = range.j0; j <= range.j1; j++) {
                            for (const p of this._placedUpTile(o, H, F, i, j, plan)) out.push(p);
                        }
                    }
                    continue;
                }
                const d = this.lm.projectPlacedF(o, H, F);
                if (!d) continue;
                let fadeTag = null;
                if (!this.lm.isAncestor(H, F) && H !== F) {
                    fadeTag = projectedSizePx(o, factor, this.cfg, this.live);
                    if (fadeTag < this.fadeLoPx) continue;
                }
                const b = bboxOf(d, this.live);
                const half = d.type === "fill" ? 0 : (d.lwFrame || 0) / 2;
                const clippedWindow = {
                    left: Math.max(windowRect.left, b.x0 - half),
                    top: Math.max(windowRect.top, b.y0 - half),
                    right: Math.min(windowRect.right, b.x1 + half),
                    bottom: Math.min(windowRect.bottom, b.y1 + half),
                };
                if (clippedWindow.left > clippedWindow.right || clippedWindow.top > clippedWindow.bottom) continue;
                const range = this.lm.tileRange(F, clippedWindow);
                const start = out.length;
                for (let i = range.i0; i <= range.i1; i++) {
                    for (let j = range.j0; j <= range.j1; j++) {
                        deriveStep([d], this.cfg.base, zero, this.lm.tileRect(F, i, j), F, {
                            cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups,
                            live: this.live, parentCurved: d.origin === "native", childCurved: false,
                            forceOutline: d.type === "stroke" &&
                                d.lwFrame * this.cfg.enter > this.lm.width * this.cfg.polygonizeWidthFrac,
                        }, out);
                    }
                }
                if (fadeTag != null) for (let i = start; i < out.length; i++) out[i].fadeTag = fadeTag;
            }
        }
        return out;
    }

    // ---- magnify chain (upContent): chain through the PARENT frame ----
    _ensureUp(F, i, j) {
        const cf = this.lm.frameFor(F); if (!cf) return { level: F, dir: "up", i, j, objs: [], epoch: this._epoch, lru: this._clock };
        F = cf.id;
        const key = F + "|up|" + i + "," + j;
        const hit = this.cache.get(key);
        if (hit && hit.epoch === this._epoch) { hit.lru = ++this._clock; return hit; }
        this._pins.add(key); // protect this tile (and its parents) during recursion
        const objs = this._bakeUp(F, i, j);
        const tile = { level: F, dir: "up", i, j, objs, epoch: this._epoch, lru: ++this._clock };
        this.cache.set(key, tile);
        return tile;
    }
    _bakeUp(F, i, j) {
        const frame = this.lm.frame(F);
        const parentId = frame && frame.parent;
        const rec = frame && frame.edge;         // maps parent -> F
        if (!parentId || !rec) return [];        // root / no coarser neighbour -> nothing to magnify
        const rect = this.lm.tileRect(F, i, j);
        // Nothing coarser-or-equal to the parent has content -> up is empty.
        if (this._depth(parentId) < this._minContentDepth()) return [];
        // Parent objects = upContent(parent) over this tile's pre-image + natives(parent).
        const parentObjs = [];
        const pr = this.lm.rectToParent(rect, F);
        const prange = this.lm.tileRange(parentId, pr);
        for (let pi = prange.i0; pi <= prange.i1; pi++) {
            for (let pj = prange.j0; pj <= prange.j1; pj++) {
                const pt = this._ensureUp(parentId, pi, pj);
                for (const o of pt.objs) parentObjs.push(o);
            }
        }
        for (const o of this.doc.at(parentId)) if (!o.placements || !o.placements.length) parentObjs.push(o);
        const objs = [];
        const edges = [];
        for (const o of parentObjs) {
            const tier = classifyUp(o, rec.s, rec.t, rect, this.cfg, this.live);
            if (tier === "empty") continue;
            if (tier === "solid") objs.push(this._solid(o, rec, rect));
            else edges.push(o);
        }
        deriveStep(edges, rec.s, rec.t, rect, F, {
            cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups, live: this.live,
            parentCurved: (o) => o.origin === "native",
            childCurved: () => false,
        }, objs);
        return objs;
    }

    // A solid tile quad, overlapped into its neighbours (seam hairline) and
    // carrying any window still too small to punch at this step.
    _solid(o, rec, rect) {
        const sw = splitWindows(o, rec.s, rec.t, this.cfg);
        return solidQuad(o, rect, {
            pad: seamPad(o, rect, this.opacityGroups),
            windows: sw && sw.carry,
        });
    }

    // ---- direct projection (downContent): every non-ancestor frame, depth ≥ F ----
    _ensureDown(F, i, j) {
        const cf = this.lm.frameFor(F); if (!cf) return { level: F, dir: "down", i, j, objs: [], epoch: this._epoch, lru: this._clock };
        F = cf.id;
        const key = F + "|down|" + i + "," + j;
        const hit = this.cache.get(key);
        if (hit && hit.epoch === this._epoch) { hit.lru = ++this._clock; return hit; }
        const objs = this._bakeDown(F, i, j);
        const tile = { level: F, dir: "down", i, j, objs, epoch: this._epoch, lru: ++this._clock };
        this.cache.set(key, tile);
        return tile;
    }
    _bakeDown(F, i, j) {
        const rect = this.lm.tileRect(F, i, j);
        const objs = [];
        const enter = this.cfg.enter;
        const Fdepth = this._depth(F);
        // Candidate source frames: content-bearing, non-ancestor, depth ≥ F,
        // sorted by depth so the "whole frame is sub-cull" break is monotone.
        const cands = [];
        for (const k of this.doc.levels()) {
            if (!this.doc.at(k).length) continue;
            if (k === F) continue;
            if (this.lm.isAncestor(k, F)) continue; // ancestors ride up, not down
            if (this._depth(k) < Fdepth) continue;  // uncle (Stage 3) — not via down
            cands.push(k);
        }
        cands.sort((a, b) => this._depth(a) - this._depth(b));
        for (const G of cands) {
            const f = this.lm.frameFactor(G, F); // ≤ ~1 (minify or bounded sibling hop)
            if (f == null) continue;
            if (DOWN_MAX_SIZE * f * enter < this.fadeLoPx) continue; // this frame is sub-cull
            for (const o of this.doc.at(G)) {
                if (o.placements && o.placements.length) continue;
                const tag = projectedSizePx(o, f, this.cfg, this.live); // size at F's deepest zoom
                if (tag < this.fadeLoPx) continue;                     // cull (invisible by construction)
                const b = bboxOf(o, this.live);
                const bAtF = this.lm.mapRectF({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, G, F);
                const lwF = (o.lwFrame || 0) * f;
                if (!bAtF || bAtF.right + lwF < rect.left || bAtF.left - lwF > rect.right ||
                    bAtF.bottom + lwF < rect.top || bAtF.top - lwF > rect.bottom) continue;
                const d = this.lm.projectF(o, G, F);
                if (!d) continue;
                if (d.type === "fill") {
                    // Area-erase bakes travel as fills — clip their rings like
                    // deriveStep does (winding preserved, holes stay holes), with
                    // the same seam overlap so tile edges leave no AA hairline.
                    const tp = clipRingsToRect(d.polys, padRect(rect, seamPad(o, rect, this.opacityGroups)));
                    if (tp.length) objs.push(logicalMeta(o, { type: "fill", origin: "derived", id: o.id, z: o.z, color: o.color,
                        opacity: o.opacity, polys: tp, fadeTag: tag, paths: [] }));
                    continue;
                }
                const pts = (o.origin === "native" && d.pts.length > 2)
                    ? flattenCurve(d.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base) : d.pts;
                const lw = d.lwFrame;
                const ew = { left: rect.left - lw, top: rect.top - lw, right: rect.right + lw, bottom: rect.bottom + lw };
                for (const run of clipPolylineToRect(pts, ew)) {
                    if (run.length) objs.push(logicalMeta(o, { type: "stroke", origin: "derived", id: o.id, z: o.z, color: o.color,
                        opacity: o.opacity, pts: run, lwFrame: lw, fadeTag: tag, paths: [] }));
                }
            }
        }
        return objs;
    }

    // ---- document changes: INCREMENTAL tile updates ----
    _onDoc(ev) {
        this.placedCache.clear();
        if (ev.kind === "reset") { this.cache.clear(); return; }
        if (ev.kind === "placementBatch") { this.cache.clear(); return; }
        if (!ev.obj) return;
        if (ev.kind === "remove") { this._removeObject(ev.id); return; }
        if (ev.kind === "add" && ev.live) return; // still growing; finalize announces
        if (ev.kind === "add" || ev.kind === "finalize") { this._addObject(ev.obj, ev.level); return; }
        if (ev.kind === "change") { this._removeObject(ev.id); this._addObject(ev.obj, ev.level); }
    }
    _removeObject(id) {
        for (const [, tile] of this.cache) {
            if (!tile.objs.length) continue;
            let has = false;
            for (const p of tile.objs) if (p.id === id) { has = true; break; }
            if (has) tile.objs = tile.objs.filter((p) => p.id !== id);
        }
    }
    _addObject(o, H) {
        if (o.placements && o.placements.length) return; // uncached placedContent path
        for (const [key, tile] of this.cache) {
            const F = tile.level;
            if (F === H) continue;
            if (tile.dir === "up") {
                // F inherits H magnified only if H is a coarser ancestor of F.
                if (!this.lm.isAncestor(H, F)) continue;
                if (this.lm.parentOf(F) === H) { this._appendUp(tile, o); continue; }
                // chained content: correctness needs the intermediate tiles'
                // pieces — invalidate (footprint test at H is exact and cheap)
                const rectAtH = this.lm.mapRectF(this.lm.tileRect(F, tile.i, tile.j), F, H);
                const half = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
                if (rectAtH && this._overlaps(rectAtH, bboxOf(o, this.live), half)) this.cache.delete(key);
            } else {
                // H is a down source for F iff non-ancestor and depth(H) ≥ depth(F).
                if (this.lm.isAncestor(H, F)) continue;
                if (this._depth(H) < this._depth(F)) continue;
                this._appendDown(tile, o, H);
            }
        }
    }
    _appendUp(tile, o) {
        const F = tile.level;
        const frame = this.lm.frame(F);
        const rec = frame && frame.edge;
        if (!rec) return;
        const rect = this.lm.tileRect(F, tile.i, tile.j);
        const tier = classifyUp(o, rec.s, rec.t, rect, this.cfg, this.live);
        if (tier === "empty") return;
        if (tier === "solid") { tile.objs.push(this._solid(o, rec, rect)); return; }
        deriveStep([o], rec.s, rec.t, rect, F, {
            cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups, live: this.live,
            parentCurved: (p) => p.origin === "native",
            childCurved: () => false,
        }, tile.objs);
    }
    _appendDown(tile, o, H) {
        const F = tile.level;
        const f = this.lm.frameFactor(H, F);
        if (f == null) return;
        const tag = projectedSizePx(o, f, this.cfg, this.live);
        if (tag < this.fadeLoPx) return;
        const rect = this.lm.tileRect(F, tile.i, tile.j);
        const b = bboxOf(o, this.live);
        const bAtF = this.lm.mapRectF({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, H, F);
        const lwF = (o.lwFrame || 0) * f;
        if (!bAtF || bAtF.right + lwF < rect.left || bAtF.left - lwF > rect.right ||
            bAtF.bottom + lwF < rect.top || bAtF.top - lwF > rect.bottom) return;
        const d = this.lm.projectF(o, H, F);
        if (!d) return;
        if (d.type === "fill") {
            // Area-erase bakes travel as fills (same handling as _bakeDown).
            const tp = clipRingsToRect(d.polys, padRect(rect, seamPad(o, rect, this.opacityGroups)));
            if (tp.length) tile.objs.push(logicalMeta(o, { type: "fill", origin: "derived", id: o.id, z: o.z, color: o.color,
                opacity: o.opacity, polys: tp, fadeTag: tag, paths: [] }));
            return;
        }
        const pts = (o.origin === "native" && d.pts.length > 2)
            ? flattenCurve(d.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base) : d.pts;
        const lw = d.lwFrame;
        const ew = { left: rect.left - lw, top: rect.top - lw, right: rect.right + lw, bottom: rect.bottom + lw };
        for (const run of clipPolylineToRect(pts, ew)) {
            if (run.length) tile.objs.push(logicalMeta(o, { type: "stroke", origin: "derived", id: o.id, z: o.z, color: o.color,
                opacity: o.opacity, pts: run, lwFrame: lw, fadeTag: tag, paths: [] }));
        }
    }
    // rect is {left,top,right,bottom}; b is a bbox {x0,y0,x1,y1}.
    _overlaps(rect, b, margin) {
        return b.x1 + margin >= rect.left && b.x0 - margin <= rect.right &&
               b.y1 + margin >= rect.top && b.y0 - margin <= rect.bottom;
    }

    // ---- LRU ----
    _evict() {
        if (this.cache.size <= GLOBAL_CAP) { this._evictPerLevel(); return; }
        const evictable = [];
        for (const [key, tile] of this.cache) if (!this._pins.has(key)) evictable.push([key, tile.lru]);
        evictable.sort((a, b) => a[1] - b[1]);
        let n = this.cache.size - GLOBAL_CAP;
        for (const [key] of evictable) { if (n-- <= 0) break; this.cache.delete(key); }
        this._evictPerLevel();
    }
    _evictPerLevel() {
        const byLevel = new Map();
        for (const [key, tile] of this.cache) {
            if (!byLevel.has(tile.level)) byLevel.set(tile.level, []);
            byLevel.get(tile.level).push([key, tile.lru]);
        }
        for (const arr of byLevel.values()) {
            if (arr.length <= PER_LEVEL_CAP) continue;
            arr.sort((a, b) => a[1] - b[1]);
            let n = arr.length - PER_LEVEL_CAP;
            for (const [key] of arr) { if (n-- <= 0) break; if (!this._pins.has(key)) this.cache.delete(key); }
        }
    }

    // Test/inspection helpers.
    size() { return this.cache.size; }
    _tileKeys() { return [...this.cache.keys()]; }
}
