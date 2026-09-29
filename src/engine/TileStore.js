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
 *                    CHAINING one ×R (4096) edge at a time through the
 *                    parent's tiles (magnify must chain: a composed long jump
 *                    cancels catastrophically). empty/solid/edge classification;
 *                    SOLID replaces a tile-covering band with a 4-vertex quad so
 *                    geometry can never outgrow a tile (BUG-05 fix).
 *
 *   downContent(F) — every NON-ANCESTOR frame G with depth(G) ≥ depth(F),
 *                    projected DIRECTLY into F (net factor ≤ ~1: descendants
 *                    minify; same/deeper siblings go up-to-common-ancestor then
 *                    down, still bounded). Found by walking the frame tree from
 *                    F, a subtree pruned whole when its cell grown by one misses
 *                    the tile (invariant 2), and read from the Document's natives; a
 *                    view-independent cull drops sub-pixel content and a fade
 *                    band tags size (BUG-04). This is what makes a stroke drawn
 *                    in a far sibling frame appear when viewing its neighbour.
 *
 * Coarser off-branch content (an "uncle": depth(G) < depth(F), different branch)
 * is NO LONGER deferred, and it stopped being exotic the moment a frame became a
 * lattice cell: a cell is about three screens across, so zooming in slightly
 * off-centre puts ink that is ON SCREEN into a sibling of your ancestor. The
 * magnify chain skipped it, the down path skipped it, and it vanished.
 * `_ringNatives` picks up the eight neighbouring cells at every step of the
 * up-chain; invariant 2 is what makes that complete, since an object never
 * reaches past its own frame's neighbours (frame-lattice bible 10.5).
 *
 * Own natives(F) are NOT baked into F's own tiles — they render live (curved) at
 * the active frame. There is no exception: since an erase below an object's home
 * CUTS the ceded tile out of the parent's own geometry (see geometry/cede.js),
 * every native's stored rings are already the rings to paint, and nothing has to
 * be re-derived per view.
 */
import { Loop } from "./geometry/loop";
import {
    deriveStep, classifyUp, solidQuad, projectedSizePx, bboxOf, seamPad, seamPadFor, padRect, shapeRingsInRect,
    shapeTol, freezeR,
} from "./geometry/derive";
import { flattenCurve, clipPolylineToRect, clipRingsToRect } from "./geometry/polyline";
import { R, G, REACH } from "./frameLattice";
import { perfNow } from "./now";

const GLOBAL_CAP = 512;   // total cached tiles before LRU eviction
// A tile's derived objects keep their loops as Loops (geometry/loop.js), like the
// document's natives: the freeze and the chop hand over piece arrays, which are
// transient; what the cache holds is eight doubles a piece.
function flattenAll(objs) {
    for (const o of objs) if (o && o.loops) for (let i = 0; i < o.loops.length; i++) if (!(o.loops[i] instanceof Loop)) o.loops[i] = Loop.from(o.loops[i]);
    return objs;
}
const PER_LEVEL_CAP = 64; // cached tiles per frame
const OVER_BUDGET = { overBudget: true };   // thrown by a tile miss past `_deadline`
const DOWN_MAX_SIZE = 5e5; // generous upper bound on a native's frame extent (px);
                           // used only to skip a frame whose content is guaranteed
                           // sub-cull at F.

export default class TileStore {
    constructor(levelMap, doc, cfg) {
        this.lm = levelMap;
        this.doc = doc;
        this.cfg = cfg;
        this._deadline = null;   // `contentOffCamera`'s budget (ms clock), the tiles its read has baked, the bake depth
        this._readBakes = 0;
        this._nest = 0;
        this.cullPx = cfg.cullPx != null ? cfg.cullPx : 0.3;       // below this at the frame's deepest zoom -> not baked plain
        this.fadeLoPx = cfg.fadeLoPx != null ? cfg.fadeLoPx : 0.15; // below this -> culled entirely; [fadeLo, cull) -> fade band
        this.opacityGroups = true;
        this.live = null;    // the in-progress stroke, exempt from bbox/flatten caches
        this.cache = new Map(); // "F|dir|i,j" -> { level, dir, i, j, objs, epoch, lru }
        this._clock = 0;
        this._epoch = 0;
        this._pins = new Set(); // keys protected from eviction during a bake/render
        this._holdEvict = false; // `contentOffCamera` runs the eviction itself, once
        // Tiles the zoom-out ladder and the crossing prebake read ahead (`warmReads` on): `framesLeft`
        // keeps them, so the zoom they were read for finds them warm (F83). Cleared per ladder.
        this._warm = new Set();
        this.warmReads = false;
        this._chainSeq = new Map();       // frame -> chainSeq(frame), valid for one lattice addrEpoch
        this._chainSeqEpoch = -1;
        this._batch = false;    // a drag: many changes to the same objects, per frame
        this._idTiles = new Map();        // native id -> keys of the cached tiles holding its pieces
        this._tileSubs = null;            // `onTile` listeners
        this._unsub = doc.subscribe((ev) => this._onDoc(ev));
    }
    destroy() { if (this._unsub) this._unsub(); this.cache.clear(); this._idTiles.clear(); this._tileSubs = null; }

    // ---- the tile hook (A2 §2.9) ----
    /**
     * Every write to the cache or to a tile's `objs`, reported synchronously as it happens:
     * `{kind: "bake", key, tile}` (a new tile object), `{kind: "append"|"remove", key, tile, pieces}`,
     * `{kind: "drop", key, tile}`, `{kind: "clear"}`. Nothing else writes either.
     */
    onTile(fn) {
        (this._tileSubs || (this._tileSubs = new Set())).add(fn);
        return () => { if (this._tileSubs) this._tileSubs.delete(fn); };
    }
    _tileEv(ev) { if (this._tileSubs) for (const fn of this._tileSubs) fn(ev); }
    _indexTile(key, tile) {
        for (const p of tile.objs) {
            let s = this._idTiles.get(p.id);
            if (!s) this._idTiles.set(p.id, (s = new Set()));
            s.add(key);
        }
    }
    _unindexTile(key, tile) {
        for (const p of tile.objs) {
            const s = this._idTiles.get(p.id);
            if (s && s.delete(key) && !s.size) this._idTiles.delete(p.id);
        }
    }
    /** The one way a tile enters the cache. */
    _setTile(key, tile) {
        const old = this.cache.get(key);
        if (old) this._unindexTile(key, old);
        this.cache.set(key, tile);
        this._indexTile(key, tile);
        this._tileEv({ kind: "bake", key, tile });
    }
    /** The one way a tile leaves it. */
    _dropTile(key) {
        const tile = this.cache.get(key);
        if (!tile) return false;
        this.cache.delete(key);
        this._unindexTile(key, tile);
        this._tileEv({ kind: "drop", key, tile });
        return true;
    }
    _clearTiles() { this.cache.clear(); this._idTiles.clear(); this._tileEv({ kind: "clear" }); }
    /** Pieces pushed onto `tile.objs` from index `n0` on: indexed and reported. */
    _appended(tile, n0) {
        if (tile.objs.length <= n0) return;
        const key = this._keyOf(tile);
        if (this.cache.get(key) !== tile) return;
        const pieces = tile.objs.slice(n0);
        for (const p of pieces) {
            let s = this._idTiles.get(p.id);
            if (!s) this._idTiles.set(p.id, (s = new Set()));
            s.add(key);
        }
        this._tileEv({ kind: "append", key, tile, pieces });
    }
    _keyOf(tile) { return tile.level + "|" + tile.dir + "|" + tile.i + "," + tile.j; }
    /** The keys of the cached tiles holding pieces of native `id` (read-only), or null. */
    tilesOf(id) { return this._idTiles.get(id) || null; }
    /** A cached tile that is current (no bake, no LRU touch), or null. */
    peek(key) {
        const tile = this.cache.get(key);
        if (!tile || tile.epoch !== this._epoch || tile.seq !== this.chainSeq(tile.level)) return null;
        return tile;
    }

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
    bumpEpoch() { this._epoch++; this._clearTiles(); }

    // ---- helpers ----
    _depth(frameId) { const d = this.lm.depthOf(frameId); return d == null ? 0 : d; }

    // ---- document content bounds (by depth) ----
    _minContentDepth() {
        let m = Infinity;
        for (const k of this.doc.levels()) if (this.doc.count(k)) { const d = this._depth(k); if (d < m) m = d; }
        return m;
    }

    // ---- read path: everything to render at frame `F` inside `windowRect` ----
    // `F` may be a frame id or a legacy depth int — normalize to the canonical
    // frame id so tile keys and `frame()` lookups are exact.
    content(F, windowRect) {
        const cf = this.lm.frameFor(F);
        if (!cf) return [];
        F = cf.id;
        let out = [];
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
        if (this.doc.hasOffsets()) out = this._reroute(F, windowRect, out, nowVisible);
        this._pins = nowVisible; // only currently-visible tiles are pinned
        this._evict();
        return out;
    }
    /**
     * `content(F, rect)` for a frame the camera is NOT at — the crossing prebake (PAPER-PLAN R4)
     * and `snapshotView` (SCENES-PLAN S1). The visible pin set is saved BY VALUE and restored,
     * so neither the read nor the bake it forces can unpin or evict the camera's own tiles.
     *
     * By value, because `content` mutates `_pins` IN PLACE (`:128`, `_reroute`, `_ensureUp`)
     * before replacing the field: saving the reference, which `KobinEngine._maybePrebake` did,
     * puts back a set that now holds the read frame's keys and pins them until the next
     * `content` call. The tiles this bakes stay cached and stay evictable, which is what makes
     * a prebake free to throw away.
     *
     * The pins are not enough on their own: `content` evicts at its end, with only its own
     * range pinned, and PER_LEVEL_CAP is 64 tiles within ONE frame — so a run of thumbnail
     * reads at the frame the camera is at took the visible tiles (S9). The eviction is held for
     * the read and run once here, with the camera's pins back.
     */
    contentOffCamera(F, rect, budgetMs = 0) {
        const pins = new Set(this._pins);
        this._holdEvict = true;
        // With a budget, the first tile missed past it ends the read with null (one tile, with its parent
        // chain, at least); the tiles baked so far stay cached, so a later read goes further. A ladder rung
        // was one 3.6 s task on the Magnum Opus; a chain is still 0.3–0.8 s a level there (REVIEWER-4).
        this._deadline = budgetMs > 0 ? perfNow() + budgetMs : null;
        this._readBakes = 0;
        try {
            const out = this.content(F, rect);
            if (this.warmReads) for (const k of this._pins) this._warm.add(k);   // the read's own keys, reroute's included
            return out;
        } catch (e) {
            if (e === OVER_BUDGET) { this.overBudget = (this.overBudget || 0) + 1; return null; }
            throw e;
        } finally { this._deadline = null; this._pins = pins; this._holdEvict = false; this._evict(); }
    }
    /**
     * The tiles over `rect` in frame F, cached or baked while the budget lasts; a miss past it is
     * listed, never thrown (A3 §4.2, PLAN §5.1 Q12). `budgetMs`: Infinity reads everything, 0 the
     * cache alone, anything else bakes until the deadline and at least one tile (with its parent
     * chain: a read stops between tiles, never inside a chain). The pins and the eviction are
     * `contentOffCamera`'s: this read leaves both as they were (`setCameraPins` is the camera's).
     *
     * @returns {{tiles: Array<[string, object]>, missing: string[], complete: boolean}}
     */
    read(F, rect, budgetMs = Infinity) {
        const cf = this.lm.frameFor(F);
        if (!cf) return { tiles: [], missing: [], complete: true };
        const range = this.lm.tileRange(cf.id, rect), cells = [];
        for (let i = range.i0; i <= range.i1; i++) for (let j = range.j0; j <= range.j1; j++) for (const dir of ["up", "down"]) cells.push([cf.id, dir, i, j]);
        return this.readTiles(cells, budgetMs);
    }
    /** `read` for a list of tiles, `[frame, dir, i, j]` each (a frame id as `read` would name it). */
    readTiles(cells, budgetMs = Infinity) {
        const tiles = [], missing = [];
        const bounded = budgetMs !== Infinity;
        const deadline = bounded ? perfNow() + budgetMs : 0;
        const pins = new Set(this._pins), holdEvict = this._holdEvict;
        this._holdEvict = true;
        let baked = 0, over = false;
        try {
            for (const [F, dir, i, j] of cells) {
                const key = F + "|" + dir + "|" + i + "," + j;
                let tile = this.peek(key);
                if (!tile) {
                    if (!this.lm.frame(F)) { missing.push(key); continue; }
                    if (bounded && (budgetMs <= 0 || (baked > 0 && perfNow() > deadline))) { missing.push(key); over = true; continue; }
                    tile = dir === "up" ? this._ensureUp(F, i, j) : this._ensureDown(F, i, j);
                    baked++;
                } else tile.lru = ++this._clock;
                tiles.push([key, tile]);
                if (this.warmReads) this._warm.add(key);
            }
        } finally { this._pins = pins; this._holdEvict = holdEvict; }
        if (over && budgetMs > 0) this.overBudget = (this.overBudget || 0) + 1;   // a read its budget stopped
        return { tiles, missing, complete: !missing.length };
    }
    /** The camera's pin set, replaced (what `content` does at its end), then the eviction it held. */
    setCameraPins(keys) { this._pins = new Set(keys); this._evict(); }
    /** A new ladder is being read: the last one's warm tiles go back to the ordinary rules. */
    clearWarm() { this._warm.clear(); }
    /**
     * THE TILES ARE IN UNMOVED SPACE; A MOVED OBJECT IS READ FROM WHERE ITS PICTURE IS (F55, A1 C1).
     * Every tile is a pure function of stored bits and the object's own grid, and a move touches
     * neither. What a move changes is WHICH tiles hold the pieces drawn in frame F: a native whose
     * picture table (`Document.tableOf`: its own table with its frame's shift) is not zero is read
     * from the tiles of the frame its whole frames point back to (`LevelMap.objShift`), over the
     * window shifted back by the remainder, and painted translated by it — above its home too, where
     * the remainder can reach a cell. A group whose F0 is its members' home draws them live
     * (`placementModel.nativesIn`): none of their pieces are read.
     */
    _reroute(F, win, out, pins) {
        const { moved, groups } = this._rerouteGroups(F);
        if (!moved.size) return out;
        const kept = out.filter((p) => !moved.has(p.id));
        for (const g of groups.values()) {
            const w = { left: win.left - g.rem[0], right: win.right - g.rem[0], top: win.top - g.rem[1], bottom: win.bottom - g.rem[1] };
            const range = this.lm.tileRange(g.F0, w);
            for (let i = range.i0; i <= range.i1; i++) {
                for (let j = range.j0; j <= range.j1; j++) {
                    for (const dir of ["up", "down"]) {
                        const key = g.F0 + "|" + dir + "|" + i + "," + j;
                        pins.add(key);
                        this._pins.add(key);
                        const tile = dir === "up" ? this._ensureUp(g.F0, i, j) : this._ensureDown(g.F0, i, j);
                        for (const p of tile.objs) if (g.ids.has(p.id)) kept.push(p);
                    }
                }
            }
        }
        return kept;
    }

    /**
     * Every native drawn away from its stored bits as seen from F, GROUPED by the frame and remainder
     * its pieces are read from (`{F0, rem, ids}`), so each tile is scanned once a group: the natives
     * with a table of their own, one placement each, and a shifted frame's natives without one, one
     * placement for the frame (membership by home). A native of F itself whose picture has not left F
     * is drawn live and in no group. Memoised on F, the document's `offRev` (tables, shifts, homes in
     * shifted frames), the lattice's `addrEpoch` and its frame count: the walk over every object with
     * a table was 70 of a 113–140 ms list build on the Magnum Opus (16,889 tables, PAPER-PLAN §10). A
     * key that moved during the walk is not kept. One entry a frame, the last four: the ladder and the
     * crossing prebake read other frames between two camera renders (review minor 7).
     */
    _rerouteGroups(F) {
        const memo = this._rrMemo || (this._rrMemo = new Map());
        const m = memo.get(F);
        const lat = () => this.lm.addrEpoch + "|" + this.lm.frames.size;
        const key = () => F + "|" + this.doc.offRev + "|" + lat();
        const k0 = key();
        if (m && m.key === k0) { this._rrHits = (this._rrHits || 0) + 1; return m; }
        // `live`: natives of another frame whose picture carried into F, drawn live here (F0 is their home).
        const put = (out, id, home, s) => {
            if (!s || (home === F && s.F0 === F)) return;
            out.moved.add(id);
            if (s.F0 === home) out.live.add(id);
            const k = s.F0 + "|" + s.rem[0] + "|" + s.rem[1];
            let g = out.groups.get(k);
            if (!g) out.groups.set(k, (g = { F0: s.F0, rem: s.rem, ids: new Set() }));
            g.ids.add(id);
            out.gk.set(id, k);
        };
        const unput = (out, id) => {
            const k = out.gk.get(id);
            if (k === undefined) return;
            const g = out.groups.get(k);
            g.ids.delete(id);
            if (!g.ids.size) out.groups.delete(k);
            out.moved.delete(id); out.gk.delete(id); out.live.delete(id);
        };
        const place = (out, id) => {
            const rec = this.doc.getById(id);
            if (!rec) return;
            const T = this.doc.tableOf(rec.obj, rec.level);
            if (T) put(out, id, rec.level, this.lm.objShift(T, rec.level, F));
        };
        // The lattice as it was: only the objects whose tables or homes moved since are placed again.
        const since = m && m.lat === lat() ? this.doc.offTouchedSince(m.rev) : null;
        let out;
        if (since && since.size < this.doc.offsetIds().size / 2) {
            out = m;
            for (const id of since) { unput(out, id); place(out, id); }
            this._rrPatches = (this._rrPatches || 0) + 1;
        } else {
            out = { moved: new Set(), groups: new Map(), gk: new Map(), live: new Set() };
            const shared = new Map();                      // a shifted frame's table -> its one placement
            for (const [o, home, T] of this.doc.displacedNatives()) {
                let sh = shared.get(T);
                if (sh === undefined) { sh = this.lm.objShift(T, home, F); if (!this.doc.hasOwnTable(o)) shared.set(T, sh); }
                put(out, o.id, home, sh);
            }
        }
        out.key = k0; out.rev = this.doc.offRev; out.lat = lat();
        memo.delete(F);
        if (key() === k0) { memo.set(F, out); if (memo.size > 4) memo.delete(memo.keys().next().value); }
        return out;
    }

    // ---- magnify chain (upContent): chain through the PARENT frame ----
    _ensureUp(F, i, j) {
        const cf = this.lm.frameFor(F); if (!cf) return { level: F, dir: "up", i, j, objs: [], epoch: this._epoch, lru: this._clock };
        F = cf.id;
        const key = F + "|up|" + i + "," + j;
        const hit = this.cache.get(key);
        const seq = this.chainSeq(F);
        if (hit && hit.epoch === this._epoch && hit.seq === seq) { hit.lru = ++this._clock; return hit; }
        if (this._deadline != null && !this._nest && this._readBakes > 0 && perfNow() > this._deadline) throw OVER_BUDGET;
        this._pins.add(key); // protect this tile (and its parents) during recursion
        let objs;
        this._nest++;   // a tile's parents are baked with it: a read stops between tiles, never inside a chain
        try { objs = this._bakeUp(F, i, j); } finally { this._nest--; }
        const tile = { level: F, dir: "up", i, j, objs, epoch: this._epoch, seq: this.chainSeq(F), lru: ++this._clock };
        this._setTile(key, tile);
        this._readBakes++;
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
        const pr = this.lm.rectToParent(rect, F);
        const parentObjs = this._upPiecesOver(parentId, pr, null);
        // No offsets enter here (F55). A tile is a pure function of stored bits
        // and the object's own grid; where a moved object's picture is read
        // from is decided in `_reroute`, at render time, from its table.
        for (const o of this.doc.list(parentId)) parentObjs.push(o);
        for (const o of this._ringNatives(parentId, pr)) parentObjs.push(o);
        const objs = [];
        const edges = [];
        for (const o of parentObjs) {
            const tier = classifyUp(o, rec.s, rec.t, rect, this.cfg, this.live, null);
            if (tier === "empty") continue;
            if (tier === "solid") objs.push(this._solid(o, rec, rect));
            else edges.push(o);
        }
        deriveStep(edges, rec.s, rec.t, rect, F, {
            cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups, live: this.live,
            addrSeq: frame.addrSeq || 0,
            parentCurved: (o) => o.origin === "native",
            childCurved: () => false,
        }, objs);
        return flattenAll(objs);
    }
    /**
     * The parent's up-pieces over rect `pr` (parent units) — every object's, or
     * one object's when `only` is an id.
     */
    _upPiecesOver(parentId, pr, only) {
        const parentObjs = [];
        const take = (o) => { if (only == null || o.id === only) parentObjs.push(o); };
        const prange = this.lm.tileRange(parentId, pr);
        if (prange.i0 === prange.i1 && prange.j0 === prange.j1) {
            for (const o of this._ensureUp(parentId, prange.i0, prange.j0).objs) take(o);
        } else {
            // THE PRE-IMAGE STRADDLES TWO PARENT SQUARES — a child cell at the
            // extreme digit is centred on its parent's edge, which is exactly
            // where a square boundary falls. Each square holds its own piece of
            // an object, clipped to its own padded window, and the two windows
            // overlap by the pad on either side of the boundary; the pad (48
            // units) is wider than half a cell (16), so the square that holds
            // the pre-image's CENTRE holds the whole pre-image on its own.
            // Until 2026-09-04 both squares' pieces went in, and the child
            // derived two copies of the same ink. Same ink, not the same bits:
            // each copy's clip vertices were rounded on a different rectangle,
            // and 4,096x per crossing later the two copies were thousands of
            // units apart — a doubled, diverging edge, and no single answer to
            // "where is the ink" for the erase to agree with (F42). So one
            // square per object: the centre square's piece whenever its window
            // covers the pre-image, the others' only when it does not (a bare
            // window, whose pieces abut instead of overlapping). The erase's
            // descent cedes the same square by the same rule, so the kid it
            // mints is the piece this derivation was already reading.
            const cx = (pr.left + pr.right) / 2, cy = (pr.top + pr.bottom) / 2;
            const pc = this.lm.tileRange(parentId, { left: cx, right: cx, top: cy, bottom: cy });
            const covered = new Set();
            for (const o of this._ensureUp(parentId, pc.i0, pc.j0).objs) {
                if (only != null && o.id !== only) continue;
                parentObjs.push(o);
                const c = o.clip;
                if (c && c.left <= pr.left && c.right >= pr.right && c.top <= pr.top && c.bottom >= pr.bottom) covered.add(o.id);
            }
            for (let pi = prange.i0; pi <= prange.i1; pi++) {
                for (let pj = prange.j0; pj <= prange.j1; pj++) {
                    if (pi === pc.i0 && pj === pc.j0) continue;
                    for (const o of this._ensureUp(parentId, pi, pj).objs) if (!covered.has(o.id)) take(o);
                }
            }
        }
        return parentObjs;
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
            if (!this.doc.list(G.id).length) continue;
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
        const seq = this.chainSeq(F);
        if (hit && hit.epoch === this._epoch && hit.seq === seq) { hit.lru = ++this._clock; return hit; }
        if (this._deadline != null && !this._nest && this._readBakes > 0 && perfNow() > this._deadline) throw OVER_BUDGET;
        const objs = this._bakeDown(F, i, j);
        const tile = { level: F, dir: "down", i, j, objs, epoch: this._epoch, seq: this.chainSeq(F), lru: ++this._clock };
        this._setTile(key, tile);
        this._readBakes++;
        return tile;
    }
    _bakeDown(F, i, j) {
        const rect = this.lm.tileRect(F, i, j);
        const objs = [];
        const enter = this.cfg.enter;
        const cands = this._downSources(F, rect);
        for (const G of cands) {
            const f = this.lm.frameFactor(G, F); // ≤ ~1 (minify or bounded sibling hop)
            if (f == null) continue;
            if (DOWN_MAX_SIZE * f * enter < this.fadeLoPx) continue; // this frame is sub-cull
            // The frame's own bound, from its index: every object under the cull, or every box off the
            // tile, and the object loop is skipped whole. Each test is the per-object one below on a box
            // that contains every object's, so nothing the loop would keep is lost (row 11).
            const ext = this.doc.frameExtent(G);
            if (!ext || ext.maxSize * f * enter < this.fadeLoPx) continue;
            const eAtF = this.lm.mapRectF({ left: ext.box.x0, top: ext.box.y0, right: ext.box.x1, bottom: ext.box.y1 }, G, F);
            if (eAtF) {
                const tol = 1e-9 * (rect.right - rect.left);   // the hop-by-hop rounding, dwarfed
                if (eAtF.right + tol < rect.left || eAtF.left - tol > rect.right ||
                    eAtF.bottom + tol < rect.top || eAtF.top - tol > rect.bottom) continue;
            }
            for (const o of this.doc.list(G)) {
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
        return flattenAll(objs);
    }

    /**
     * The frames a down tile of F can read: every non-ancestor at depth >= F whose cell, grown by
     * one (invariant 2 bounds a whole subtree to that, as `_ringNatives` and the lasso rely on),
     * meets `rect` in F's units — F's subtree, then outward through each ancestor the other
     * children's subtrees, a subtree whose cell misses the tile skipped whole. Ascending depth.
     */
    _downSources(F, rect) {
        const Fd = this._depth(F);
        const out = [];
        const visit = (id, s, tx, ty) => {
            const reach = REACH * s * (1 + 1e-9);
            if (tx + reach < rect.left || tx - reach > rect.right || ty + reach < rect.top || ty - reach > rect.bottom) return;
            const f = this.lm.frame(id);
            if (id !== F && f.depth >= Fd && this.doc.count(id)) out.push(id);   // a count must not settle a frame the extent test then skips
            for (const c of this.lm.childrenOf(id)) if (c.centre) visit(c.id, s / R, c.centre.x * s + tx, c.centre.y * s + ty);
        };
        visit(F, 1, 0, 0);
        let child = this.lm.frame(F), s = 1, tx = 0, ty = 0;
        while (child && child.parent != null) {
            const c = child.centre;
            if (!c) break;
            s *= R; tx -= c.x * s; ty -= c.y * s;
            for (const sib of this.lm.childrenOf(child.parent)) if (sib.id !== child.id && sib.centre) visit(sib.id, s / R, sib.centre.x * s + tx, sib.centre.y * s + ty);
            child = this.lm.frame(child.parent);
        }
        out.sort((a, b) => this._depth(a) - this._depth(b));
        return out;
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
            const crect = padRect(rect, pad);
            const { rings, covered } = shapeRingsInRect(d.loops, crect, shapeTol(this.cfg), { freezeR: freezeR(this.cfg) });
            if (rings.length) {
                // `clip`: the rectangle this piece was cut on, for the selection
                // indicator's seam test (F39).
                const piece = { type: "fill", origin: "derived", id: o.id, z: o.z, color: o.color,
                    opacity: o.opacity, polys: rings, fadeTag: tag, clip: crect };
                if (covered) piece.covers = true;
                out.push(piece);
            }
            return out;
        }
        if (d.type === "fill") {
            // Area-erase bakes travel as fills — clip their rings like
            // deriveStep does (winding preserved, holes stay holes), with
            // the same seam overlap so tile edges leave no AA hairline.
            const crect = padRect(rect, pad);
            const tp = clipRingsToRect(d.polys, crect);
            if (tp.length) out.push({ type: "fill", origin: "derived", id: o.id, z: o.z, color: o.color,
                opacity: o.opacity, polys: tp, fadeTag: tag, clip: crect });
            return out;
        }
        const pts = (o.origin === "native" && d.pts.length > 2)
            ? flattenCurve(d.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base) : d.pts;
        const lw = d.lwFrame;
        const ew = padRect(rect, pad + lw);
        for (const run of clipPolylineToRect(pts, ew)) {
            if (run.length) out.push({ type: "stroke", origin: "derived", id: o.id, z: o.z, color: o.color,
                opacity: o.opacity, pts: run, lwFrame: lw, fadeTag: tag });
        }
        return out;
    }

    // ---- document changes: INCREMENTAL tile updates ----
    // The address sequence of F and its ancestors, summed. A tile built under an older sum
    // read its content through an address that has since changed (a subtree move) and is
    // rebuilt on its next lookup; no walk over the moved subtree is ever needed.
    chainSeq(F) {
        if (this._chainSeqEpoch !== this.lm.addrEpoch) { this._chainSeq.clear(); this._chainSeqEpoch = this.lm.addrEpoch; }
        const hit = this._chainSeq.get(F);
        if (hit !== undefined) return hit;
        let n = 0;
        for (let id = F; id != null; id = this.lm.parentOf(id)) { const f = this.lm.frame(id); if (f && f.addrSeq) n += f.addrSeq; }
        this._chainSeq.set(F, n);
        return n;
    }
    // A frame moved, was set aside or came back (a subtree move or delete): every cached tile
    // whose rect meets the frame's footprint - its cell grown by the reach a subtree may have
    // (invariant 2), at the old address and the new - is dropped. Tiles OF the moved subtree
    // go stale through `chainSeq`. F55 stands: a table change drops nothing.
    _onFrameEvent(ev) {
        const foot = [];
        const cur = this.lm.frame(ev.frame);
        if (cur && cur.parent != null) foot.push([cur.parent, cur.cell.i, cur.cell.j]);
        else if (ev.at && ev.at.parent != null) foot.push([ev.at.parent, ev.at.i, ev.at.j]);   // a merged frame is gone from the lattice
        if (ev.kind === "refile" && ev.from && ev.from.parent != null) foot.push([ev.from.parent, ev.from.i, ev.from.j]);
        if (ev.kind === "mergeFrame") for (const [key, tile] of this.cache) if (tile.level === ev.frame) this._dropTile(key);
        if (!foot.length) return;
        const reach = REACH / R;    // in the parent's units
        const pad = seamPadFor(this.cfg);
        const memo = new Map();     // tile frame -> the footprints mapped into it
        for (const [key, tile] of this.cache) {
            let rects = memo.get(tile.level);
            if (rects === undefined) {
                rects = [];
                for (const [parent, i, j] of foot) {
                    const r = this.lm.mapRectF({ left: i * G - reach, top: j * G - reach, right: i * G + reach, bottom: j * G + reach }, parent, tile.level);
                    if (r) rects.push(r);
                }
                memo.set(tile.level, rects);
            }
            if (!rects.length) continue;
            const t = padRect(this.lm.tileRect(tile.level, tile.i, tile.j), pad);
            for (const r of rects) {
                if (r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom) continue;
                this._dropTile(key);
                break;
            }
        }
    }
    _onDoc(ev) {
        if (ev.kind === "reset") { this._clearTiles(); return; }
        if (ev.kind === "refile" || ev.kind === "removeFrame" || ev.kind === "addFrame" || ev.kind === "mergeFrame" || ev.kind === "splitFrame") { this._onFrameEvent(ev); return; }
        if (!ev.obj) return;
        if (ev.kind === "remove") { this._removeObject(ev.id); return; }
        if (ev.kind === "add" && ev.live) return; // still growing; finalize announces
        if (ev.kind === "add" || ev.kind === "finalize") { this._addObject(ev.obj, ev.level); return; }
        // A move changes the displacement table and nothing a tile is made of
        // (F55): every tile stays exactly right, and the next render reads the
        // picture from its new address.
        if (ev.kind === "change" && (ev.offsetsOnly || ev.attrOnly)) return;
        if (ev.kind === "change") { this._removeObject(ev.id); this._addObject(ev.obj, ev.level); }
    }
    /**
     * A frame the lattice forgot (frame GC): its tiles, its chain sum and every reroute memo that names
     * it go — its own, and each whose group reads its tiles: the memo's key counts frames, so a later
     * mint restores the key and the group would read a frame that is gone (the native not drawn;
     * R-MODEL-C1, 6 of 8,000 fuzz renders). A later read can mint the same id again, and its old tiles
     * would be served without what changed since (REVIEWER-3 RENDER-1).
     */
    forgetFrame(frame) {
        const F = String(frame);
        for (const [key, tile] of this.cache) {
            if (String(tile.level) !== F) continue;
            this._dropTile(key); this._pins.delete(key); this._warm.delete(key);
        }
        if (this._rrMemo) for (const [k, m] of this._rrMemo) if (k === F || [...m.groups.values()].some((g) => g.F0 === F)) this._rrMemo.delete(k);
        this._chainSeq.delete(F);
    }
    /** Whether a tile still stands: dropped in a drag's batch mode unless on screen, or when its frame is gone (RENDER-1). */
    _tileLive(key, tile) {
        if (this._batch && !this._pins.has(key)) { this._dropTile(key); return false; }
        if (!this.lm.frame(tile.level)) { this._dropTile(key); return false; }
        return true;
    }
    /** Native `id`'s pieces out of the tiles that hold them (the id → tiles index, not a scan of the cache). */
    _removeObject(id) {
        const keys = this._idTiles.get(id);
        if (!keys) return;
        for (const key of [...keys]) {
            const tile = this.cache.get(key);
            if (!tile || !this._tileLive(key, tile)) continue;
            const kept = [], gone = [];
            for (const p of tile.objs) (p.id === id ? gone : kept).push(p);
            keys.delete(key);
            if (!gone.length) continue;
            tile.objs = kept;
            this._tileEv({ kind: "remove", key, tile, pieces: gone });
        }
        if (!keys.size) this._idTiles.delete(id);
    }
    /**
     * A native `o` added at `H`, patched into every cached tile that `_bakeUp`/`_bakeDown` would put it
     * in. A chained up tile takes it from its parent squares' pieces, coarsest first so each parent
     * has it already; one whose parents are not all cached goes, and is rebuilt when read. Dropping
     * every chained tile instead rebuilt the whole view cold after a cut through a backdrop: 1.9 s
     * at depth 9 on the Magnum Opus (TB-1).
     */
    _addObject(o, H) {
        H = String(H);
        const chained = [];
        const via = new Map();
        for (const [key, tile] of this.cache) {
            if (!this._tileLive(key, tile)) continue;
            const F = tile.level;
            if (F === H) continue;
            if (tile.dir === "down") {
                // H is a down source for F iff non-ancestor and depth(H) ≥ depth(F).
                if (!this.lm.isAncestor(H, F) && this._depth(H) >= this._depth(F)) this._appendDown(tile, o, H);
                continue;
            }
            let A = via.get(F);
            if (A === undefined) { A = this._upVia(H, F); via.set(F, A); }
            if (A == null) continue;
            if (this.lm.parentOf(F) === A) {
                const d = A === H ? o : this._ringCopy(o, H, A, this.lm.rectToParent(this.lm.tileRect(F, tile.i, tile.j), F));
                if (d) this._appendUp(tile, [d]);
            } else if (this._reaches(o, H, tile)) chained.push([key, tile]);
        }
        chained.sort((a, b) => this._depth(a[1].level) - this._depth(b[1].level));
        for (const [key, tile] of chained) if (this.cache.get(key) === tile) this._appendChained(key, tile, o);
    }
    /**
     * The frame whose child chain carries `H`'s natives up into `F`: F's ancestor at H's depth when that
     * is H, or when H is in its ring (`_ringNatives`); null when H's natives never reach F's up tiles.
     */
    _upVia(H, F) {
        const dH = this._depth(H);
        if (dH >= this._depth(F)) return null;
        let A = F;
        while (A != null && this._depth(A) > dH) A = this.lm.parentOf(A);
        if (A == null) return null;
        A = String(A);
        if (A === H) return H;
        for (const G of this.lm.peekRing(A)) if (String(G.id) === H) return A;
        return null;
    }
    /** `o` (a native of `H`, in `A`'s ring) as `_ringNatives(A, pr)` hands it over, or null when it does not. */
    _ringCopy(o, H, A, pr) {
        const inH = this.lm.mapRectF(pr, A, H);
        if (!inH || !this.doc.queryRect(H, inH).includes(o)) return null;
        const d = this.lm.projectF(o, H, A);
        if (!d) return null;
        d.origin = o.origin;
        return d;
    }
    /** Whether `o`'s box, at `H`, meets the up tile's rect grown by the seam pad (classifyUp's cull). */
    _reaches(o, H, tile) {
        const r = this.lm.mapRectF(padRect(this.lm.tileRect(tile.level, tile.i, tile.j), seamPadFor(this.cfg)), tile.level, H);
        const half = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        return !r || this._overlaps(r, bboxOf(o, this.live), half);
    }
    _appendChained(key, tile, o) {
        const F = tile.level;
        const frame = this.lm.frame(F);
        const P = frame && frame.parent != null ? this.lm.frameFor(frame.parent) : null;
        if (!P || !frame.edge) return;
        const pr = this.lm.rectToParent(this.lm.tileRect(F, tile.i, tile.j), F);
        const r = this.lm.tileRange(P.id, pr);
        const seq = this.chainSeq(P.id);
        for (let i = r.i0; i <= r.i1; i++) {
            for (let j = r.j0; j <= r.j1; j++) {
                const p = this.cache.get(P.id + "|up|" + i + "," + j);
                if (!p || p.epoch !== this._epoch || p.seq !== seq) { this._dropTile(key); return; }
            }
        }
        const from = this._upPiecesOver(P.id, pr, o.id);
        if (from.length) this._appendUp(tile, from);
    }
    /** `_bakeUp`'s derivation of `objs` (the parent's pieces or natives) into `tile`, appended. */
    _appendUp(tile, objs) {
        const F = tile.level;
        const frame = this.lm.frame(F);
        const rec = frame && frame.edge;
        if (!rec) return;
        const rect = this.lm.tileRect(F, tile.i, tile.j);
        const n0 = tile.objs.length;
        const edges = [];
        for (const o of objs) {
            const tier = classifyUp(o, rec.s, rec.t, rect, this.cfg, this.live, null);
            if (tier === "empty") continue;
            if (tier === "solid") tile.objs.push(this._solid(o, rec, rect));
            else edges.push(o);
        }
        if (edges.length) {
            deriveStep(edges, rec.s, rec.t, rect, F, {
                cfg: this.cfg, width: this.lm.width, opacityGroups: this.opacityGroups, live: this.live,
                addrSeq: frame.addrSeq || 0,
                parentCurved: (p) => p.origin === "native",
                childCurved: () => false,
            }, tile.objs);
            flattenAll(tile.objs);
        }
        this._appended(tile, n0);
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
        const n0 = tile.objs.length;
        this._downPieces(o, d, rect, tag, tile.objs);
        flattenAll(tile.objs);
        this._appended(tile, n0);
    }
    // rect is {left,top,right,bottom}; b is a bbox {x0,y0,x1,y1}.
    _overlaps(rect, b, margin) {
        return b.x1 + margin >= rect.left && b.x0 - margin <= rect.right &&
               b.y1 + margin >= rect.top && b.y0 - margin <= rect.bottom;
    }

    /**
     * The camera has moved to frame F: every cached tile goes except F's ancestors', the tiles the
     * camera's own read of F has just pinned, and the tiles the ladder read ahead (`_warm`)
     * (WORKLIST memory step 3a). Called by the engine AFTER that read, so a moved object's tiles
     * `_reroute` reads from another frame survive: deleting them re-baked them cold on the zoom
     * that followed — 440 → 64 ms for the first list in jsdom, and a 929 ms reroute two ticks
     * before a crossing in Kobin's Chrome with the ladder's tiles not kept (OPEN-FLAGS F83).
     */
    framesLeft(F) {
        const keep = new Set();
        for (let id = F; id != null; id = this.lm.parentOf(id)) keep.add(String(id));
        let n = 0;
        for (const [key, tile] of this.cache) {
            if (keep.has(String(tile.level)) || this._pins.has(key) || this._warm.has(key)) continue;
            this._dropTile(key); n++;
        }
        return n;
    }

    // ---- LRU ----
    _evict() {
        // Held across an off-camera read, which runs it itself once the camera's pins are back.
        if (this._holdEvict) return;
        if (this.cache.size <= GLOBAL_CAP) { this._evictPerLevel(); return; }
        const evictable = [];
        for (const [key, tile] of this.cache) if (!this._pins.has(key)) evictable.push([key, tile.lru]);
        evictable.sort((a, b) => a[1] - b[1]);
        let n = this.cache.size - GLOBAL_CAP;
        for (const [key] of evictable) { if (n-- <= 0) break; this._dropTile(key); }
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
            for (const [key] of arr) { if (n-- <= 0) break; if (!this._pins.has(key)) this._dropTile(key); }
        }
    }

    // Test/inspection helpers.
    size() { return this.cache.size; }
    _tileKeys() { return [...this.cache.keys()]; }
}
