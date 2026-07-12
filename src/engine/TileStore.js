/**
 * TileStore — the universal, bidirectional tile cache. This is where the
 * zoom-in/zoom-out ASYMMETRY of the old engine is dissolved: every level gets
 * tiles, and a tile carries content inherited from BOTH neighbours.
 *
 * Two content classes per tile, kept strictly separate (the XOR invariant):
 *
 *   upContent(L)   — coarser objects (home level < L), MAGNIFIED into L. Built
 *                    by CHAINING one ×(s/base)≈3000 step at a time through the
 *                    tiles of L-1 (magnify must chain: a composed long jump
 *                    cancels catastrophically at ~1e20). Each step classifies
 *                    every object empty / solid / edge — the SOLID tier replaces
 *                    a band that covers the whole tile with a 4-vertex quad, so
 *                    geometry can never outgrow a tile and the chain is bounded
 *                    by construction. This is the BUG-05 fix.
 *
 *   downContent(L) — finer objects (home level > L), MINIFIED into L. Read
 *                    DIRECTLY from the Document's natives (minify is precision-
 *                    safe at any distance — coordinates only shrink — and one
 *                    coarse tile's pre-image spans ~9e6 finer tiles, so chaining
 *                    down is neither needed nor affordable). A view-independent
 *                    cull at the level's deepest zoom drops sub-pixel content;
 *                    a fade band just above the cull tags size for the Renderer's
 *                    continuous opacity ramp (BUG-04).
 *
 * Own natives(L) are NOT baked into L's own tiles — they render live (curved) at
 * the active level, so finishing a stroke never invalidates an on-screen tile.
 *
 * Document changes update tiles INCREMENTALLY (tiles are per-object piece
 * lists): removals strip pieces by id, additions derive just the new object
 * into affected cached tiles — an edit never throws whole tiles away except
 * for chained up-content ≥ 2 levels deeper. An erase can never leave ghost ink
 * in a coarser tile (a bug class the tile-less old engine could not have).
 * LRU keeps the cache bounded.
 */
import { deriveStep, classifyUp, solidQuad, projectNative, levelFactor, projectedSizePx, bboxOf } from "./geometry/derive";
import { flattenCurve, clipPolylineToRect } from "./geometry/clipperOutline";

const GLOBAL_CAP = 512;   // total cached tiles before LRU eviction
const PER_LEVEL_CAP = 64; // cached tiles per level
const DOWN_MAX_SIZE = 5e5; // generous upper bound on a native's frame extent (px);
                           // used only to stop the minify walk once a whole level
                           // is guaranteed sub-cull.

export default class TileStore {
    constructor(levelMap, doc, cfg) {
        this.lm = levelMap;
        this.doc = doc;
        this.cfg = cfg;
        this.cullPx = cfg.cullPx != null ? cfg.cullPx : 0.3;       // below this at the level's deepest zoom -> not baked plain
        this.fadeLoPx = cfg.fadeLoPx != null ? cfg.fadeLoPx : 0.15; // below this -> culled entirely; [fadeLo, cull) -> fade band
        this.opacityGroups = true;
        this.live = null;    // the in-progress stroke, exempt from bbox/flatten caches
        this.cache = new Map(); // "L|dir|i,j" -> { level, dir, i, j, objs, epoch, lru }
        this._clock = 0;
        this._epoch = 0;
        this._pins = new Set(); // keys protected from eviction during a bake/render
        this._unsub = doc.subscribe((ev) => this._onDoc(ev));
    }
    destroy() { if (this._unsub) this._unsub(); this.cache.clear(); }

    // A config change (opacity-group seam pad, constant tuning) makes every bake
    // stale — bump the epoch so no generation can mix, and drop the cache.
    setOpacityGroups(v) { if (v !== this.opacityGroups) { this.opacityGroups = v; this.bumpEpoch(); } }
    bumpEpoch() { this._epoch++; this.cache.clear(); }

    // ---- document content bounds ----
    _minContentLevel() {
        let m = Infinity;
        for (const l of this.doc.levels()) if (this.doc.at(l).length && l < m) m = l;
        return m;
    }
    _maxContentLevel() {
        let m = -Infinity;
        for (const l of this.doc.levels()) if (this.doc.at(l).length && l > m) m = l;
        return m;
    }

    // ---- read path: everything to render at `level` inside `windowRect` ----
    // Returns derived pieces (up + down). The facade adds the active level's own
    // live natives and sorts the union by id (global z-order).
    content(level, windowRect) {
        const out = [];
        const range = this.lm.tileRange(level, windowRect);
        const nowVisible = new Set();
        for (let i = range.i0; i <= range.i1; i++) {
            for (let j = range.j0; j <= range.j1; j++) {
                for (const dir of ["up", "down"]) {
                    const key = level + "|" + dir + "|" + i + "," + j;
                    nowVisible.add(key);
                    this._pins.add(key);
                    const tile = dir === "up" ? this._ensureUp(level, i, j) : this._ensureDown(level, i, j);
                    for (const o of tile.objs) out.push(o);
                }
            }
        }
        this._pins = nowVisible; // only currently-visible tiles are pinned
        this._evict();
        return out;
    }

    // ---- magnify chain (upContent) ----
    _ensureUp(L, i, j) {
        const key = L + "|up|" + i + "," + j;
        const hit = this.cache.get(key);
        if (hit && hit.epoch === this._epoch) { hit.lru = ++this._clock; return hit; }
        this._pins.add(key); // protect this tile (and its parents) during recursion
        const objs = this._bakeUp(L, i, j);
        const tile = { level: L, dir: "up", i, j, objs, epoch: this._epoch, lru: ++this._clock };
        this.cache.set(key, tile);
        return tile;
    }
    _bakeUp(L, i, j) {
        const rec = this.lm.get(L); // maps L-1 -> L
        if (!rec) return [];        // no defined coarser neighbour -> nothing to magnify
        const rect = this.lm.tileRect(L, i, j);
        const minC = this._minContentLevel();
        if (L - 1 < minC) return []; // nothing coarser than the coarsest native exists
        // Parent objects = upContent(L-1) over this tile's pre-image + natives(L-1).
        const parentObjs = [];
        const pr = this.lm.rectToParent(rect, L);
        const prange = this.lm.tileRange(L - 1, pr);
        for (let pi = prange.i0; pi <= prange.i1; pi++) {
            for (let pj = prange.j0; pj <= prange.j1; pj++) {
                const pt = this._ensureUp(L - 1, pi, pj);
                for (const o of pt.objs) parentObjs.push(o);
            }
        }
        for (const o of this.doc.at(L - 1)) parentObjs.push(o);
        // Classify each against this tile: skip empty, quad the solids, derive the edges.
        const objs = [];
        const edges = [];
        for (const o of parentObjs) {
            const tier = classifyUp(o, rec.s, rec.t, rect, this.cfg, this.live);
            if (tier === "empty") continue;
            if (tier === "solid") objs.push(solidQuad(o, rect));
            else edges.push(o);
        }
        deriveStep(edges, rec.s, rec.t, rect, L, {
            cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups, live: this.live,
            // Per-origin curvature (replaces lineModeLevel): a native still displays
            // its spline, so flatten it before baking; already-baked pieces are
            // pre-flattened polylines and render straight.
            parentCurved: (o) => o.origin === "native",
            childCurved: () => false,
        }, objs);
        return objs;
    }

    // ---- direct minify (downContent) ----
    _ensureDown(L, i, j) {
        const key = L + "|down|" + i + "," + j;
        const hit = this.cache.get(key);
        if (hit && hit.epoch === this._epoch) { hit.lru = ++this._clock; return hit; }
        const objs = this._bakeDown(L, i, j);
        const tile = { level: L, dir: "down", i, j, objs, epoch: this._epoch, lru: ++this._clock };
        this.cache.set(key, tile);
        return tile;
    }
    _bakeDown(L, i, j) {
        const rect = this.lm.tileRect(L, i, j);
        const maxC = this._maxContentLevel();
        const objs = [];
        const base = this.cfg.base, enter = this.cfg.enter;
        for (let M = L + 1; M <= maxC; M++) {
            const f = levelFactor(M, L, this.lm.records, base); // < 1 (minify)
            if (f == null) continue;
            if (DOWN_MAX_SIZE * f * enter < this.fadeLoPx) break; // this and every deeper level is sub-cull
            const natives = this.doc.at(M);
            if (!natives.length) continue;
            // Iterate natives DIRECTLY (not the spatial index): a coarse tile's
            // pre-image at M is magnified ×3000/level, so any region query there
            // spans an enormous area — the index can't prune it. Instead minify
            // each native's bbox DOWN to L (cheap, coordinates shrink) and skip
            // those that miss this tile.
            for (const o of natives) {
                const tag = projectedSizePx(o, f, this.cfg, this.live); // size at L's deepest zoom
                if (tag < this.fadeLoPx) continue;                      // cull (invisible by construction)
                // bbox pruning (mapRect wants a RECT — feeding it the bbox made
                // every comparison NaN and the prune silently never fired)
                const b = bboxOf(o, this.live);
                const bAtL = this.lm.mapRect({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, M, L);
                const lwL = (o.lwFrame || 0) * f;
                if (!bAtL || bAtL.right + lwL < rect.left || bAtL.left - lwL > rect.right ||
                    bAtL.bottom + lwL < rect.top || bAtL.top - lwL > rect.bottom) continue;
                const d = projectNative(o, M, L, this.lm.records, base);
                if (!d) continue;
                // Minified strokes only get THINNER — never fat — so this direction
                // never touches the fat-fill machinery. Flatten (native spline ->
                // chords, sub-pixel here) and clip the centerline to the tile.
                const pts = (o.origin === "native" && d.pts.length > 2)
                    ? flattenCurve(d.pts, (this.cfg.arcTolerancePx * 0.5) / base) : d.pts;
                const lw = d.lwFrame;
                const ew = { left: rect.left - lw, top: rect.top - lw, right: rect.right + lw, bottom: rect.bottom + lw };
                for (const run of clipPolylineToRect(pts, ew)) {
                    if (run.length) objs.push({ type: "stroke", origin: "derived", id: o.id, z: o.z, color: o.color,
                        opacity: o.opacity, pts: run, lwFrame: lw, fadeTag: tag, paths: [] });
                }
            }
        }
        return objs;
    }

    // ---- document changes: INCREMENTAL tile updates ----
    // Tiles are per-object piece lists, so a single edit never has to throw a
    // whole tile away ("one added stroke invalidated the entire cache" was the
    // symptom): a removal strips the object's pieces by id everywhere; an add
    // derives JUST that object into the affected cached tiles (direct child
    // up-tiles + all down-tiles — both read the native directly). Only up-tiles
    // ≥ 2 levels deeper (whose content chains through intermediate tiles) fall
    // back to invalidation, and only where the object's footprint overlaps.
    _onDoc(ev) {
        if (ev.kind === "reset") { this.cache.clear(); return; }
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
        const half = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        for (const [key, tile] of this.cache) {
            const L = tile.level;
            if (tile.dir === "up") {
                if (L <= H) continue;
                if (L === H + 1) { this._appendUp(tile, o); continue; }
                // chained content: correctness needs the intermediate tiles'
                // pieces — invalidate (footprint test at H is exact and cheap)
                const rectAtH = this.lm.mapRect(this.lm.tileRect(L, tile.i, tile.j), L, H);
                if (rectAtH && this._overlaps(rectAtH, bboxOf(o, this.live), half)) this.cache.delete(key);
            } else {
                if (L >= H) continue;
                this._appendDown(tile, o, H); // direct minify works at any distance
            }
        }
    }
    // Derive one new native into one cached direct-child tile (same policy as
    // _bakeUp, restricted to a single object).
    _appendUp(tile, o) {
        const rec = this.lm.get(tile.level);
        if (!rec) return;
        const rect = this.lm.tileRect(tile.level, tile.i, tile.j);
        const tier = classifyUp(o, rec.s, rec.t, rect, this.cfg, this.live);
        if (tier === "empty") return;
        if (tier === "solid") { tile.objs.push(solidQuad(o, rect)); return; }
        deriveStep([o], rec.s, rec.t, rect, tile.level, {
            cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups, live: this.live,
            parentCurved: (p) => p.origin === "native",
            childCurved: () => false,
        }, tile.objs);
    }
    // Minify one new native into one cached coarser tile (same policy as
    // _bakeDown's per-native body).
    _appendDown(tile, o, M) {
        const L = tile.level;
        const f = levelFactor(M, L, this.lm.records, this.cfg.base);
        if (f == null) return;
        const tag = projectedSizePx(o, f, this.cfg, this.live);
        if (tag < this.fadeLoPx) return;
        const rect = this.lm.tileRect(L, tile.i, tile.j);
        const b = bboxOf(o, this.live);
        const bAtL = this.lm.mapRect({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, M, L);
        const lwL = (o.lwFrame || 0) * f;
        if (!bAtL || bAtL.right + lwL < rect.left || bAtL.left - lwL > rect.right ||
            bAtL.bottom + lwL < rect.top || bAtL.top - lwL > rect.bottom) return;
        const d = projectNative(o, M, L, this.lm.records, this.cfg.base);
        if (!d) return;
        const pts = (o.origin === "native" && d.pts.length > 2)
            ? flattenCurve(d.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base) : d.pts;
        const lw = d.lwFrame;
        const ew = { left: rect.left - lw, top: rect.top - lw, right: rect.right + lw, bottom: rect.bottom + lw };
        for (const run of clipPolylineToRect(pts, ew)) {
            if (run.length) tile.objs.push({ type: "stroke", origin: "derived", id: o.id, z: o.z, color: o.color,
                opacity: o.opacity, pts: run, lwFrame: lw, fadeTag: tag, paths: [] });
        }
    }
    _invalidateObject(obj, H, bboxOverride, lwOverride) {
        const b = bboxOverride || bboxOf(obj, this.live);
        const lw = lwOverride != null ? lwOverride : (obj.lwFrame || 0);
        const half = obj.type === "fill" ? 0 : lw / 2;
        const base = this.cfg.base, enter = this.cfg.enter;
        for (const [key, tile] of this.cache) {
            const L = tile.level;
            if (tile.dir === "up") {
                // Finer tiles inherit `obj` magnified. Drop the tile if its rect's
                // pre-image at H intersects the object (its footprint only grows
                // finer, so testing at H is exact and cheap).
                if (L <= H) continue;
                const rectAtH = this.lm.mapRect(this.lm.tileRect(L, tile.i, tile.j), L, H);
                if (rectAtH && this._overlaps(rectAtH, b, half)) this.cache.delete(key);
            } else {
                // Coarser tiles inherit `obj` minified — only while it survives the
                // cull at L (2-3 levels; then it's invisible and absent from the bake).
                if (L >= H) continue;
                const f = levelFactor(H, L, this.lm.records, base);
                if (f == null) continue;
                if ((Math.hypot(b.x1 - b.x0, b.y1 - b.y0) + lw) * f * enter < this.fadeLoPx) continue;
                const rectAtL = this.lm.tileRect(L, tile.i, tile.j);
                const r = this.lm.mapRect({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, H, L);
                if (r && this._overlaps(rectAtL, { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }, half * f)) this.cache.delete(key);
            }
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
