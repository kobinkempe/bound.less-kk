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
 * Own natives(F) are NOT baked into F's own tiles — they render live (curved) at
 * the active frame. There is no exception: since an erase below an object's home
 * CUTS the ceded tile out of the parent's own geometry (see geometry/cede.js),
 * every native's stored rings are already the rings to paint, and nothing has to
 * be re-derived per view.
 */
import { deriveStep, classifyUp, solidQuad, projectedSizePx, bboxOf, seamPad, padRect, shapeRingsInRect, shapeTol } from "./geometry/derive";
import { flattenCurve, clipPolylineToRect, clipRingsToRect } from "./geometry/clipperOutline";

const GLOBAL_CAP = 512;   // total cached tiles before LRU eviction
const PER_LEVEL_CAP = 64; // cached tiles per frame
const DOWN_MAX_SIZE = 5e5; // generous upper bound on a native's frame extent (px);
                           // used only to skip a frame whose content is guaranteed
                           // sub-cull at F.

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
        this._clock = 0;
        this._epoch = 0;
        this._pins = new Set(); // keys protected from eviction during a bake/render
        this._batch = false;    // a drag: many changes to the same objects, per frame
        this._unsub = doc.subscribe((ev) => this._onDoc(ev));
    }
    destroy() { if (this._unsub) this._unsub(); this.cache.clear(); }

    setOpacityGroups(v) { if (v !== this.opacityGroups) { this.opacityGroups = v; this.bumpEpoch(); } }
    /**
     * BATCH mode — on for the length of a drag.
     *
     * A change normally updates every cached tile that could hold the object,
     * because one edit is cheaper to patch in than to re-derive. A drag is not
     * one edit: it is one per pointer event per member, and patching a tile the
     * camera cannot see is work thrown away sixty times a second. Measured on
     * Kobin's own document — a nine-member family, 5,810 arc pieces, 45 cached
     * tiles — that was 105 ms of the 130 ms each pointermove cost, i.e. seven
     * frames a second on a drag that should be free.
     *
     * In batch mode a tile that is not currently on screen is DROPPED instead
     * of patched: it is stale either way, and rebuilding it later, once, only
     * happens if the camera ever goes back to it. Visible tiles are still
     * patched, so what the user is looking at stays exact.
     */
    setBatch(on) { this._batch = !!on; }
    bumpEpoch() { this._epoch++; this.cache.clear(); }

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

    // The active frame's own natives, which render live (curved) outside the tile
    // cache. This is a plain read now, and that is the whole point of cutting the
    // ceded tile out of the parent instead of recording a window over it.
    //
    // It used to re-derive: a parent that had ceded a window still held whole
    // geometry, so its hole existed only as a rect and had to be subtracted per
    // view, every render, by polygonizing the band and clipping it to the tile
    // minus the window. Two defects came straight out of that. The result was
    // cached against the view, and the fast zoom path skips `_render`, so an
    // in-level zoom left the cache describing a window 15.8x13.1 px wide while
    // the object on screen was 3018x1608 px — a stale picture until something
    // forced a redraw. And when it did rebuild, it cost 232–386 ms per render
    // with six to nine objects on screen. Neither can recur: a cut parent's
    // stored rings ARE the rings to paint, at every view.
    ownContent(F) {
        const cf = this.lm.frameFor(F);
        if (!cf) return [];
        return this.doc.at(cf.id);
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
        for (const o of this.doc.at(parentId)) parentObjs.push(o);
        for (const o of this._ringNatives(parentId, pr)) parentObjs.push(o);
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

    /**
     * Natives of the cells AROUND `parentId`, translated into its coordinates.
     *
     * THE UNCLE, and why it stopped being a corner case. A frame used to be a
     * region anchored wherever you first crossed into it, so coarse content that
     * mattered was almost always on your own branch and "coarser, off-branch"
     * was a curiosity the design deferred. A cell is about three screens wide:
     * zoom in a little off-centre and the camera shifts to the next cell along,
     * and ink that is right there on screen is suddenly in a SIBLING of your
     * ancestor — coarser than you, not an ancestor, so the magnify chain skipped
     * it and the down path skipped it too, and it simply vanished.
     *
     * Invariant 2 is what makes this cheap and complete: an object never extends
     * past its frame's immediate neighbours, so the ring of eight is the whole
     * of it. Applied at every step of the chain, it covers uncles at any depth.
     * Neighbouring cells' origins differ by whole frames, so the translation is
     * exact, and nothing is minted just because a tile was looked at.
     */
    _ringNatives(parentId, rect) {
        const out = [];
        for (const G of this.lm.peekRing(parentId)) {
            if (!this.doc.at(G.id).length) continue;
            // Ask the neighbour's own spatial index, in ITS coordinates, rather
            // than scanning every native it holds: this runs on every up-bake,
            // for eight cells, and a linear scan there is what a drag over a
            // crowded document feels.
            const inG = this.lm.mapRectF(rect, parentId, G.id);
            if (!inG) continue;
            for (const o of this.doc.queryRect(G.id, inG)) {
                const d = this.lm.projectF(o, G.id, parentId);
                if (!d) continue;
                // Keep the ORIGIN: a native translated into the cell next door is
                // still a native, and the magnify step treats natives as curved.
                d.origin = o.origin;
                out.push(d);
            }
        }
        return out;
    }

    // A solid tile quad, overlapped into its neighbours (seam hairline).
    _solid(o, rec, rect) {
        return solidQuad(o, rect, { pad: seamPad(o, this.cfg, this.opacityGroups) });
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
                const tag = projectedSizePx(o, f, this.cfg, this.live); // size at F's deepest zoom
                if (tag < this.fadeLoPx) continue;                     // cull (invisible by construction)
                const b = bboxOf(o, this.live);
                const bAtF = this.lm.mapRectF({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, G, F);
                const lwF = (o.lwFrame || 0) * f;
                if (!bAtF || bAtF.right + lwF < rect.left || bAtF.left - lwF > rect.right ||
                    bAtF.bottom + lwF < rect.top || bAtF.top - lwF > rect.bottom) continue;
                const d = this.lm.projectF(o, G, F);
                if (!d) continue;
                this._downPieces(o, d, rect, tag, objs);
            }
        }
        return objs;
    }

    // One minified piece of `o` (already projected into F as `d`) clipped to one
    // tile. Shared by the full bake and the incremental append so the two can
    // never drift apart — they did once already (the fill branch was fixed in
    // _bakeDown and the same bug survived in _appendDown until a regression test
    // caught it). Both directions overlap their tile by the same seam pad the
    // magnify path uses, strokes included.
    _downPieces(o, d, rect, tag, out) {
        const pad = seamPad(o, this.cfg, this.opacityGroups);
        if (d.type === "shape") {
            // A resolved perimeter minifies exactly (arcs are closed under a
            // similarity), so all that happens here is a clip to the padded tile
            // and a flatten at the level's own display fidelity.
            const { rings, covered } = shapeRingsInRect(d.loops, padRect(rect, pad), shapeTol(this.cfg));
            if (rings.length) {
                const piece = { type: "fill", origin: "derived", id: o.id, z: o.z, color: o.color,
                    opacity: o.opacity, polys: rings, fadeTag: tag, paths: [] };
                if (covered) piece.covers = true;
                out.push(piece);
            }
            return out;
        }
        if (d.type === "fill") {
            // Area-erase bakes travel as fills — clip their rings like
            // deriveStep does (winding preserved, holes stay holes), with
            // the same seam overlap so tile edges leave no AA hairline.
            const tp = clipRingsToRect(d.polys, padRect(rect, pad));
            if (tp.length) out.push({ type: "fill", origin: "derived", id: o.id, z: o.z, color: o.color,
                opacity: o.opacity, polys: tp, fadeTag: tag, paths: [] });
            return out;
        }
        const pts = (o.origin === "native" && d.pts.length > 2)
            ? flattenCurve(d.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base) : d.pts;
        const lw = d.lwFrame;
        const ew = padRect(rect, pad + lw);
        for (const run of clipPolylineToRect(pts, ew)) {
            if (run.length) out.push({ type: "stroke", origin: "derived", id: o.id, z: o.z, color: o.color,
                opacity: o.opacity, pts: run, lwFrame: lw, fadeTag: tag, paths: [] });
        }
        return out;
    }

    // ---- document changes: INCREMENTAL tile updates ----
    _onDoc(ev) {
        if (ev.kind === "reset") { this.cache.clear(); return; }
        if (!ev.obj) return;
        if (ev.kind === "remove") { this._removeObject(ev.id); return; }
        if (ev.kind === "add" && ev.live) return; // still growing; finalize announces
        if (ev.kind === "add" || ev.kind === "finalize") { this._addObject(ev.obj, ev.level); return; }
        if (ev.kind === "change") { this._removeObject(ev.id); this._addObject(ev.obj, ev.level); }
    }
    _removeObject(id) {
        for (const [key, tile] of this.cache) {
            if (this._batch && !this._pins.has(key)) { this.cache.delete(key); continue; }
            if (!tile.objs.length) continue;
            let has = false;
            for (const p of tile.objs) if (p.id === id) { has = true; break; }
            if (has) tile.objs = tile.objs.filter((p) => p.id !== id);
        }
    }
    _addObject(o, H) {
        for (const [key, tile] of this.cache) {
            if (this._batch && !this._pins.has(key)) { this.cache.delete(key); continue; }
            const F = tile.level;
            if (F === H) continue;
            if (tile.dir === "up") {
                // F inherits H magnified if H is a coarser ancestor — or a cell
                // beside one, which `_ringNatives` pulls in. The ring case is
                // rarer and harder to patch precisely, so it invalidates.
                if (!this.lm.isAncestor(H, F)) {
                    if (this._depth(H) < this._depth(F)) this.cache.delete(key);
                    continue;
                }
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
        this._downPieces(o, d, rect, tag, tile.objs);
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
