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
    shapeTol, freezeR, ringNative, tilePhaseOf,
} from "./geometry/derive";
import { flattenCurve, clipPolylineToRect, clipRingsToRect } from "./geometry/polyline";
import { clipShapeToRect, rectLoop } from "./geometry/arcShape";
import { R, G, W, REACH, TileGrid, carryDigit, cellEdge, cellCentre, childTilePhase } from "./frameLattice";
import { perfNow } from "./now";

const GLOBAL_CAP = 512;   // total cached tiles before LRU eviction
// A tile's derived objects keep their loops as Loops (geometry/loop.js), like the
// document's natives: the freeze and the chop hand over piece arrays, which are
// transient; what the cache holds is eight doubles a piece.
function flattenAll(objs) {
    for (const o of objs) if (o && o.loops) for (let i = 0; i < o.loops.length; i++) if (!(o.loops[i] instanceof Loop)) o.loops[i] = Loop.from(o.loops[i]);
    return objs;
}
/** Two tiles' pieces, number for number (-0 kept; a key starting `_` is a cache, left out). */
function samePieces(a, b) {
    if (a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) if (pieceText(a[k]) !== pieceText(b[k])) return false;
    return true;
}
const pieceText = (p) => JSON.stringify(p, (k, v) => (k.charCodeAt(0) === 95 ? undefined : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : v));
const PER_LEVEL_CAP = 64; // cached tiles per frame
// The tile RAM tier: evicted tiles still current, kept whole up to `cfg.tileRamMiB` (an estimate, `tileBytes`) and
// restored on a miss instead of derived again — what the far prefetch read ahead survives to the crossing (F166).
const TILE_RAM_MIB = 48;
function tileBytes(tile) {
    let b = 200;
    for (const o of tile.objs) {
        b += 240;
        if (o.loops) for (const l of o.loops) b += 72 * (l.length || 0);
        if (o.polys) for (const r of o.polys) b += 48 * r.length;
        if (o.pts) b += 48 * o.pts.length;
    }
    return b;
}
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
        this._holdEvict = false; // a read (`readTiles`) runs the eviction itself, once
        // Tiles read while `warmReads` is on — the prefetch's reads (`RasterRenderer._pyrPrefetch`): `framesLeft` keeps
        // them across a change of the camera's frame (F83; PLAN §5.14 item 5); the LRU cap still evicts them, and a
        // dropped tile leaves the set (`_dropTile`).
        this._warm = new Set();
        this.warmReads = false;
        this._chainSeq = new Map();       // frame -> chainSeq(frame), valid for one lattice addrEpoch
        this._chainSeqEpoch = -1;
        this._batch = false;    // a drag: many changes to the same objects, per frame
        this._idTiles = new Map();        // native id -> keys of the cached tiles holding its pieces
        this._ram = new Map();            // the RAM tier: key -> [tile, bytes], oldest first (`_spill`, `_ramTake`)
        this._ramBytes = 0;
        this.ramBytes = null;             // a probe's override of the tier's budget (bytes); else `cfg.tileRamMiB`
        this.ramStats = { puts: 0, restores: 0, stale: 0, flushes: 0, evicted: 0 };
        this._tileSubs = null;            // `onTile` listeners
        this._vf = new Map();             // virtual owners: key -> the frame a cell no frame holds would be (`_nb`)
        // Run levels (compact lattice): "K^k" is the level k above frame K inside K's run, a virtual frame here.
        this._rl = new Map();             // "K^k" -> its record (`_runLevel`)
        this._rc = new WeakMap();         // a frame with a run -> its record here, whose parent is the run level above it
        this._fix = new Map();            // a run's frame id -> the level its tiles (0, 0) repeat from (`_runTile`)
        this._inRun = null;               // the run `_runTile` is baking down level by level
        this._parts = new WeakMap();      // an owner's piece -> its part (`_ownPart`)
        this._unsub = doc.subscribe((ev) => this._onDoc(ev));
    }
    destroy() { if (this._unsub) this._unsub(); this.cache.clear(); this._idTiles.clear(); this._vf.clear(); this._rl.clear(); this._fix.clear(); this._ramClear(); this._tileSubs = null; }

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
        this._ramDrop(key);
        this.cache.set(key, tile);
        this._indexTile(key, tile);
        this._tileEv({ kind: "bake", key, tile });
    }
    /** The one way a tile leaves it. */
    _dropTile(key) {
        const tile = this.cache.get(key);
        if (!tile) return false;
        this.cache.delete(key);
        this._warm.delete(key);
        this._unindexTile(key, tile);
        this._tileEv({ kind: "drop", key, tile });
        return true;
    }
    _clearTiles() { this.cache.clear(); this._warm.clear(); this._idTiles.clear(); this._vf.clear(); this._rl.clear(); this._fix.clear(); this._ramClear(); this._tileEv({ kind: "clear" }); }
    /** An evicted tile still current goes to the RAM tier, then out of the cache (a drop for every listener). */
    _spill(key) {
        const tile = this.cache.get(key);
        if (tile && tile.virtual) return this._dropTile(key);
        const cap = this.ramBytes != null ? this.ramBytes : (this.cfg.tileRamMiB != null ? this.cfg.tileRamMiB : TILE_RAM_MIB) * 1048576;
        if (tile && cap > 0 && tile.epoch === this._epoch && tile.seq === this.chainSeq(tile.level)) {
            const n = tileBytes(tile);
            if (n <= cap / 8) {
                this._ramDrop(key);
                this._ram.set(key, [tile, n]);
                this._ramBytes += n;
                this.ramStats.puts++;
                for (const [k, e] of this._ram) {
                    if (this._ramBytes <= cap) break;
                    this._ram.delete(k); this._ramBytes -= e[1]; this.ramStats.evicted++;
                }
            }
        }
        return this._dropTile(key);
    }
    /** The tier's tile for `key` if it is still current (taken out either way), else null. */
    _ramTake(key, seq) {
        const e = this._ram.get(key);
        if (!e) return null;
        this._ram.delete(key); this._ramBytes -= e[1];
        const tile = e[0];
        if (tile.epoch !== this._epoch || tile.seq !== seq || !this.lm.frame(tile.level)) { this.ramStats.stale++; return null; }
        this.ramStats.restores++;
        return tile;
    }
    _ramDrop(key) { const e = this._ram.get(key); if (e) { this._ram.delete(key); this._ramBytes -= e[1]; } }
    /** A change to what tiles are made of: the tier's tiles would miss it, so all go. */
    _ramClear() { if (this._ram.size) { this._ram.clear(); this.ramStats.flushes++; } this._ramBytes = 0; }
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
    _depth(frameId) {
        const d = this.lm.depthOf(frameId);
        if (d != null) return d;
        const v = this._vf.get(String(frameId)) || this._runLevel(frameId);
        return v ? v.depth : 0;
    }

    // ---- document content bounds (by depth) ----
    _minContentDepth() {
        if (this._minDepthMemo !== undefined) return this._minDepthMemo;   // `_warmUp`'s: one read, one document
        let m = Infinity;
        for (const k of this.doc.levels()) if (this.doc.count(k)) { const d = this._depth(k); if (d < m) m = d; }
        return m;
    }

    /**
     * The tiles over `rect` in frame F, cached or baked while the budget lasts; a miss past it is
     * listed, never thrown (A3 §4.2, PLAN §5.1 Q12). `budgetMs`: Infinity reads everything, 0 the
     * cache alone, anything else bakes until the deadline and at least one tile (with its parent
     * chain: a read stops between tiles, never inside a chain). It leaves the pins and the eviction as
     * they were (`setCameraPins` is the camera's).
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
    /** The camera's pin set, replaced, then the eviction a read holds (`readTiles`). */
    setCameraPins(keys) { this._pins = new Set(keys); this._evict(); }
    /**
     * Every native drawn away from its stored bits as seen from F, GROUPED by the frame and remainder
     * its pieces are read from (`{F0, rem, ids}`), so each tile is scanned once a group: the natives
     * with a table of their own, one placement each, and a shifted frame's natives without one, one
     * placement for the frame (membership by home). A native of F itself whose picture has not left F
     * is drawn live and in no group. Memoised on F, the document's `offRev` (tables, shifts, homes in
     * shifted frames), the lattice's `addrEpoch` and `latticeSeq`: the walk over every object with
     * a table was 70 of a 113–140 ms list build on the Magnum Opus (16,889 tables, PAPER-PLAN §10). A
     * key that moved during the walk is not kept. One entry a frame, the last four: the Stage's
     * snapshots of other frames (the prefetch's reads among them) come between two camera renders
     * (review minor 7). A read never mints (PLAN §3 row 8): a native whose source frame the lattice
     * lacks is in `miss`, and `prepare` (`mint`) makes the frames at an action's end.
     */
    _rerouteGroups(F, mint = false) {
        const memo = this._rrMemo || (this._rrMemo = new Map());
        const m = memo.get(F);
        const lat = () => this.lm.addrEpoch + "|" + this.lm.latticeSeq;
        const key = () => F + "|" + this.doc.offRev + "|" + lat();
        const k0 = key();
        if (m && m.key === k0 && !(mint && m.miss.size)) { this._rrHits = (this._rrHits || 0) + 1; return m; }
        // `live`: natives of another frame whose picture carried into F, drawn live here (F0 is their home).
        const put = (out, id, home, s) => {
            if (s && s.missing) { out.miss.add(id); out.moved.add(id); return; }   // drawn nowhere until its frame is minted
            if (!s || (s.F0 === home && this.lm.sameCell(home, F))) return;   // drawn live in F's cell
            out.moved.add(id);
            if (s.F0 === home) out.live.add(id);
            const k = s.F0 + "|" + s.rem[0] + "|" + s.rem[1];
            let g = out.groups.get(k);
            if (!g) out.groups.set(k, (g = { F0: s.F0, rem: s.rem, ids: new Set() }));
            g.ids.add(id);
            out.gk.set(id, k);
        };
        const unput = (out, id) => {
            out.miss.delete(id); out.moved.delete(id); out.live.delete(id);
            const k = out.gk.get(id);
            if (k === undefined) return;
            const g = out.groups.get(k);
            g.ids.delete(id);
            if (!g.ids.size) out.groups.delete(k);
            out.gk.delete(id);
        };
        const place = (out, id) => {
            const rec = this.doc.getById(id);
            if (!rec) return;
            const T = this.doc.tableOf(rec.obj, rec.level);
            if (T) put(out, id, rec.level, this.lm.objShift(T, rec.level, F, mint));
        };
        // The lattice as it was: only the objects whose tables or homes moved since are placed again.
        const since = m && m.lat === lat() ? this.doc.offTouchedSince(m.rev) : null;
        let out;
        if (since && !mint && since.size < this.doc.offsetIds().size / 2) {
            out = m;
            for (const id of since) { unput(out, id); place(out, id); }
            this._rrPatches = (this._rrPatches || 0) + 1;
        } else {
            out = { moved: new Set(), groups: new Map(), gk: new Map(), live: new Set(), miss: new Set() };
            const shared = new Map();                      // a shifted frame's table -> its one placement
            for (const [o, home, T] of this.doc.displacedNatives()) {
                let sh = shared.get(T);
                if (sh === undefined) { sh = this.lm.objShift(T, home, F, mint); if (!this.doc.hasOwnTable(o)) shared.set(T, sh); }
                put(out, o.id, home, sh);
            }
        }
        out.key = k0; out.rev = this.doc.offRev; out.lat = lat();
        memo.delete(F);
        if (key() === k0) { memo.set(F, out); if (memo.size > 4) memo.delete(memo.keys().next().value); }
        return out;
    }
    /**
     * The frames F's displaced pictures are read from, minted where the lattice lacks them: at the end of the
     * action that moved them or the camera, and for the views a read found wanting (`want`), never in a read
     * (A1 C3, PLAN §3 row 8). Returns how many frames were minted.
     */
    prepare(F) {
        const n0 = this.lm.frames.size;
        if (this.lm.frame(String(F)) && this.doc.hasOffsets()) this._rerouteGroups(String(F), true);
        return this.lm.frames.size - n0;
    }
    /** A view a read found wanting: a picture's source frame is missing (`_rerouteGroups`' `miss`). */
    want(F) { (this._wanted || (this._wanted = new Set())).add(String(F)); }
    wanted() { return this._wanted ? this._wanted.size : 0; }
    /** `prepare` every view a read found wanting. Returns how many frames were minted. */
    prepareWanted() {
        if (!this._wanted || !this._wanted.size) return 0;
        const views = [...this._wanted];
        this._wanted.clear();
        let n = 0;
        for (const V of views) n += this.prepare(V);
        return n;
    }

    // ---- magnify chain (upContent): chain through the PARENT frame ----
    _ensureUp(F, i, j) {
        const cf = this._fr(F); if (!cf) return { level: F, dir: "up", i, j, objs: [], epoch: this._epoch, lru: this._clock };
        F = cf.id;
        const key = F + "|up|" + i + "," + j;
        const hit = this.cache.get(key);
        const seq = this.chainSeq(F);
        if (hit && hit.epoch === this._epoch && hit.seq === seq) { hit.lru = ++this._clock; return hit; }
        // A run level's tile (0, 0) is baked with its run, not from every level above it.
        if (cf.runOf != null && !i && !j && cf.runOf !== this._inRun) { const K = this.lm.frame(cf.runOf); return this._runTile(K, K.depth - cf.depth); }
        this._pins.add(key); // protect this tile (and its parents) during recursion
        const kept = cf.virtual ? null : this._ramTake(key, seq);
        if (kept) { kept.lru = ++this._clock; this._setTile(key, kept); return kept; }
        if (!this._warming) this._warmUp(F, i, j);
        const src = [];
        const objs = this._bakeUp(F, i, j, src);   // a tile's parents are baked with it
        const tile = { level: F, dir: "up", i, j, objs, epoch: this._epoch, seq: this.chainSeq(F), lru: ++this._clock };
        if (src.length) tile.src = src;            // the tiles it was read from (`framesLeft` keeps them)
        if (cf.virtual) tile.virtual = true;
        this._setTile(key, tile);
        return tile;
    }
    /**
     * The up tiles `(F, i, j)`'s bake reads that would bake, baked first — parents before children, from an explicit
     * stack — so the bake's recursion through `_upPiecesOver` meets them current: a chain of any length costs no stack
     * (F194: a read 900 levels below the nearest current tile overflowed it). The reads are `_bakeUp`'s own.
     */
    _warmUp(F, i, j) {
        this._warming = true;
        this._minDepthMemo = this._minContentDepth();
        try {
            const reads = (G, a, b) => {
                let f = this._fr(G);
                // A level of another run is baked with its run (`_runTile`), which reads what the run's top reads.
                if (f && f.runOf != null && f.runOf !== this._inRun) { const K = this.lm.frame(f.runOf); G = K.id + "^" + K.run.n; f = this._fr(G); a = 0; b = 0; }
                const p = f && f.parent;
                if (p == null || !f.edge || this._depth(p) < this._minDepthMemo) return [];
                return this._owners(p, this._rectToParent(this.lm.tileRect(G, a, b), G));
            };
            const stack = [[F, i, j, false]], seen = new Set();
            while (stack.length) {
                const top = stack[stack.length - 1];
                if (!top[3]) {
                    top[3] = true;
                    for (const s of reads(top[0], top[1], top[2])) {
                        const f = s.N != null ? this._fr(s.N) : null;
                        if (!f || seen.has(f.id) || this._upReady(f)) continue;
                        seen.add(f.id);
                        stack.push([f.id, 0, 0, false]);
                    }
                    continue;
                }
                stack.pop();
                if (stack.length) this._ensureUp(top[0], top[1], top[2]);   // the first is the caller's own bake
            }
        } finally { this._warming = false; this._minDepthMemo = undefined; }
    }
    /** Whether frame `f`'s tile (0, 0) is current in the cache or the RAM tier: `_ensureUp` would not bake it. */
    _upReady(f) {
        const key = f.id + "|up|0,0";
        if (this.peek(key)) return true;
        const e = f.virtual ? null : this._ram.get(key);
        return !!e && e[0].epoch === this._epoch && e[0].seq === this.chainSeq(f.id) && !!this.lm.frame(e[0].level);
    }
    /** `over`: owner key -> the pieces to read for it instead of its tile (a run level below its run's fixed level). */
    _bakeUp(F, i, j, src = null, over = null) {
        const frame = this._fr(F);
        const parentId = frame && frame.parent;
        const rec = frame && frame.edge;         // maps parent -> F
        if (parentId == null || !rec) return [];  // root / no coarser neighbour -> nothing to magnify
        const rect = this.lm.tileRect(F, i, j);
        // Nothing coarser-or-equal to the parent has content -> up is empty.
        if (this._depth(parentId) < this._minContentDepth()) return [];
        // Parent objects = upContent(parent) over this tile's pre-image + natives(parent).
        const pr = this._rectToParent(rect, F);
        const parentObjs = this._upPiecesOver(parentId, pr, null, src, over);
        // No offsets enter here (F55). A tile is a pure function of stored bits
        // and the object's own grid; where a moved object's picture is read
        // from is decided at read time, from its table (`_rerouteGroups`). The parent's cell is every
        // frame sharing it (A1 C3).
        for (const o of this._cellNatives(parentId, pr, rec)) parentObjs.push(o);
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
     * The parent's up-pieces over rect `pr` (parent units) — every object's, or one object's when `only` is an id —
     * read from the tile (0, 0) of the frame owning each parent square `pr` touches, in that frame's coordinates
     * (its origin in the parent's units as `cellOff`, like a ring native). No tile reads a tile other than (0, 0),
     * so a frame's view of its neighbour is never inherited (OPEN-FLAGS F180). `src` collects the tiles read.
     *
     * Where `pr` touches more than one square (a frame on its parent's edge), a shape on its frame's grid is read
     * from each owner cut to the owner's square, as the descent cedes it (F178), so every point comes from one
     * owner's numbers and the twin of a cede is the cede (F181 part 2); the pieces abut on the line between the
     * squares, whose `clip` keeps it a seam. Anything else takes the square holding the centre, whose window holds
     * the whole pre-image (the pad is wider than half a cell), the others only past a bare window: both squares'
     * pieces made a doubled edge 4096x apart a level (F42).
     */
    _upPiecesOver(parentId, pr, only, src = null, over = null) {
        const out = [];
        const sq = this._owners(parentId, pr);
        for (const s of sq) {
            s.objs = s.N == null ? [] : over && over.has(s.N) ? over.get(s.N) : this._ensureUp(s.N, 0, 0).objs;
            if (src && s.N != null) src.push(s.N + "|up|0,0");
        }
        if (sq.length === 1) {
            for (const o of sq[0].objs) if (only == null || o.id === only) out.push(ringNative(o, sq[0].off));
            return out;
        }
        const owned = new Map(), parts = new Map();   // id -> on its frame's grid; id -> its owners' pieces, null if a cut needs a seal
        const isOwned = (id) => {
            let v = owned.get(id);
            if (v === undefined) {
                const rec = this.doc.getById(id);
                owned.set(id, (v = !!rec && rec.obj.type === "shape" && this._onGridAt(rec, parentId)));
            }
            return v;
        };
        // Past the pre-image and twice the seam pad (as `_cellNatives`), deriveStep culls a piece: it is not cut.
        const m = (2 * seamPadFor(this.cfg)) / R + 1e-9 * (1 + Math.abs(pr.left) + Math.abs(pr.right) + Math.abs(pr.top) + Math.abs(pr.bottom));
        const near = new Map();   // id -> [piece, square] reaching the pre-image
        for (const s of sq) {
            const x0 = pr.left - s.off[0] - m, x1 = pr.right - s.off[0] + m, y0 = pr.top - s.off[1] - m, y1 = pr.bottom - s.off[1] + m;
            for (const o of s.objs) {
                if ((only != null && o.id !== only) || !isOwned(o.id)) continue;
                const b = bboxOf(o, null);
                if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
                let l = near.get(o.id);
                if (!l) near.set(o.id, (l = []));
                l.push([o, s]);
            }
        }
        for (const [id, l] of near) {
            // Covering every square it reaches, it has no edge here: one covering piece is the same ink, and far cheaper.
            if (l.every(([o]) => o.type === "fill" && o.covers)) continue;
            let list = [];
            for (const [o, s] of l) {
                const p = this._ownPart(o);
                if (p === false) { list = null; break; }
                if (p) list.push(ringNative(p, s.off));
            }
            parts.set(id, list);
        }
        for (const list of parts.values()) if (list) out.push(...list);
        const cx = (pr.left + pr.right) / 2, cy = (pr.top + pr.bottom) / 2;
        const pc = this.lm.tileRange(parentId, { left: cx, right: cx, top: cy, bottom: cy });
        const c = sq.find((s) => s.i === pc.i0 && s.j === pc.j0);
        const covered = new Set();
        const rest = (o) => (only == null || o.id === only) && !parts.get(o.id);
        if (c) {
            const r = { left: pr.left - c.off[0], right: pr.right - c.off[0], top: pr.top - c.off[1], bottom: pr.bottom - c.off[1] };
            for (const o of c.objs) {
                if (!rest(o)) continue;
                out.push(ringNative(o, c.off));
                const k = o.clip;
                if (k && k.left <= r.left && k.right >= r.right && k.top <= r.top && k.bottom >= r.bottom) covered.add(o.id);
            }
        }
        for (const s of sq) if (s !== c) for (const o of s.objs) if (rest(o) && !covered.has(o.id)) out.push(ringNative(o, s.off));
        return out;
    }
    /**
     * The parent squares `pr` touches, each `{i, j, off, N}`: its origin in the parent's units and the key of the
     * frame owning it (real or virtual, `_nb`), null where nothing can be.
     */
    _owners(parentId, pr) {
        const r = this.lm.tileRange(parentId, pr), out = [];
        for (let i = r.i0; i <= r.i1; i++) {
            for (let j = r.j0; j <= r.j1; j++) out.push({ i, j, off: [i * W, j * W], N: (i || j) ? this._nb(parentId, i, j) : String(parentId) });
        }
        return out;
    }
    /**
     * Whether native `rec`'s grid at frame `F`'s depth is the frames' own (deriveStep's phase there is 0), so the descent
     * cuts its kids there on the bare square (`squareInkOf`). A phase of whole cells, as a promoted native has, is 0 a
     * level down.
     */
    _onGridAt(rec, F) {
        let t = tilePhaseOf(rec.obj);
        for (let k = this._depth(F) - this.lm.depthOf(rec.level); k > 0 && (t[0] || t[1]); k--) t = [childTilePhase(t[0], 0, R), childTilePhase(t[1], 0, R)];
        return !t[0] && !t[1];
    }
    /**
     * Piece `o` of an owner's tile (0, 0) cut to the owner's square, as `eraseDescent` cuts a kid: a shape's loops,
     * or a covering fill as the square itself. Null when nothing is left, false when the cut needs a seal. Kept per
     * piece: every tile along a frame's edge reads the same owners' pieces.
     */
    _ownPart(o) {
        let p = this._parts.get(o);
        if (p !== undefined) return p;
        p = false;
        const sq = TileGrid.CACHE.rect(0, 0);
        let loops = null;
        if (o.type === "shape") loops = o.loops.map((l) => (l instanceof Loop ? l.toPieces() : l));   // the numbers the descent cuts
        else if (o.type === "fill" && o.covers) loops = rectLoop(sq);
        const res = loops && clipShapeToRect(loops, sq, { freezeR: freezeR(this.cfg), endsOnSides: true });
        if (res && !(res.stats && res.stats.openChains)) {
            p = null;
            if (res.loops.length) {
                const k = o.clip;
                const clip = k ? { left: Math.max(k.left, sq.left), top: Math.max(k.top, sq.top), right: Math.min(k.right, sq.right), bottom: Math.min(k.bottom, sq.bottom) } : sq;
                p = { type: "shape", origin: o.origin, id: o.id, z: o.z, color: o.color, opacity: o.opacity, loops: res.loops, tile: o.tile || [0, 0], clip };
                if (o.editId != null) p.editId = o.editId;
            }
        }
        this._parts.set(o, p);
        return p;
    }

    // ---- frames the lattice lacks (OPEN-FLAGS F181) ----
    // A square's owner may be a cell no frame holds. Its tiles are a function of its address, so it is derived as a
    // frame would be and never minted (a read never mints, F94): a VIRTUAL frame, kept here, keyed
    // "<parent key>/<i>,<j>~", or "<root>@<i>,<j>~" beside a lattice root, where nothing is coarser.
    /** Frame `key`: the lattice's (a frame with a run as `_runChild`), a virtual one, or a run level. */
    _fr(key) {
        const f = this.lm.frameFor(key);
        if (f) return f.run ? this._runChild(f) : f;
        return this._vf.get(String(key)) || this._runLevel(key);
    }

    // ---- run levels (compact-lattice design, "Pictures through a run") ----
    // A run level holds nothing and has nothing beside it, so it is derived as a virtual frame is, keyed "K^k": the level
    // k above frame K, inside K's run. Here a frame with a run has the level above it as its parent.
    /** Frame `K` (with a run) as the tiles read it: itself, its parent the run level above it. */
    _runChild(K) {
        let v = this._rc.get(K);
        if (!v) this._rc.set(K, (v = Object.create(K, { parent: { value: K.id + "^1", enumerable: true } })));
        return v;
    }
    /** Run level `key` ("K^k"), or null when K's run does not hold it. */
    _runLevel(key) {
        const s = String(key), at = s.lastIndexOf("^");
        if (at < 0) return null;
        const K = this.lm.frame(s.slice(0, at)), k = +s.slice(at + 1);
        if (!K || !K.run || !Number.isInteger(k) || k < 1 || k > K.run.n) return null;
        let v = this._rl.get(s);
        if (v && v.runRef === K.run && v.top === K.parent) return v;
        const r = K.run;
        v = { id: s, parent: k < r.n ? K.id + "^" + (k + 1) : K.parent, depth: K.depth - k, cell: { i: r.i, j: r.j },
            edge: cellEdge(r.i, r.j), centre: r.c, addrSeq: 0, virtual: true, runOf: K.id, runRef: r, top: K.parent };
        this._rl.set(s, v);
        return v;
    }
    /** The frame whose run `key`'s levels are part of, or which has one (`key` a frame with a run, or a run level), else null. */
    _runFrame(key) {
        const f = this._fr(key);
        if (!f) return null;
        if (f.runOf != null) return this.lm.frame(f.runOf) || null;
        return !f.virtual && f.run ? this.lm.frame(f.id) : null;
    }
    /** The next frame up from `key` past any run levels (they add no address and hold nothing): chain walks. */
    _seqUp(key) {
        const K = this._runFrame(key);
        if (K) return K.parent;
        const f = this._fr(key);
        return f ? f.parent : null;
    }
    /** Run level at depth `d` of the run `key` is part of or below, as its key, or null. */
    _runKeyAt(key, d) {
        const K = this._runFrame(key);
        return K && d >= K.depth - K.run.n && d < this._depth(key) ? K.id + "^" + (K.depth - d) : null;
    }
    /** The first frame up `F`'s chain at or above depth `d`, a run level as its key. */
    _upAt(F, d) {
        let A = F == null ? null : String(F);
        while (A != null && this._depth(A) > d) {
            const r = this._runKeyAt(A, d);
            if (r) return r;
            A = this._seqUp(A);
        }
        return A;
    }
    /**
     * Level k of K's run, its tile (0, 0). Each run level's is the level above's derived through the run's cell, so they
     * are baked from the run's top until two levels' pieces are equal number for number; every level below has those
     * pieces, and is baked in one step from them.
     */
    _runTile(K, k) {
        const was = this._inRun;
        this._inRun = K.id;
        try {
            const at = (m) => K.id + "^" + m;
            let fix = this._fixOf(K);
            if (!fix) {
                let prev = null;
                for (let m = K.run.n; m >= 1; m--) {
                    const t = this._ensureUp(at(m), 0, 0);
                    if (m === k) return t;
                    if (prev && samePieces(prev.objs, t.objs)) { fix = this._setFix(K, m, t, prev); break; }
                    prev = t;
                }
            }
            if (k >= fix.m) return this._ensureUp(at(k), 0, 0);
            const objs = this._bakeUp(at(k), 0, 0, null, new Map([[at(k + 1), fix.t.objs]]));
            const tile = { level: at(k), dir: "up", i: 0, j: 0, objs, epoch: this._epoch, seq: this.chainSeq(at(k)), lru: ++this._clock,
                virtual: true, src: [at(fix.m) + "|up|0,0"] };
            this._setTile(at(k) + "|up|0,0", tile);
            return tile;
        } finally { this._inRun = was; }
    }
    /** K's run's fixed level `{ m, t }` while the tiles at m and m + 1 it was found from stand unchanged, else null. */
    _fixOf(K) {
        const f = this._fix.get(K.id);
        if (!f || f.runRef !== K.run) return null;
        const a = this.peek(K.id + "^" + (f.m + 1) + "|up|0,0"), t = this.peek(K.id + "^" + f.m + "|up|0,0");
        return a === f.a && t === f.t && a.objs === f.ao && t.objs === f.to && a.objs.length === f.al && t.objs.length === f.tl ? f : null;
    }
    _setFix(K, m, t, a) {
        const f = { runRef: K.run, m, t, a, to: t.objs, tl: t.objs.length, ao: a.objs, al: a.objs.length };
        this._fix.set(K.id, f);
        return f;
    }
    _parentOf(key) { const f = this._fr(key); return f ? f.parent : null; }
    _rectToParent(rect, key) {
        const f = this._fr(key);
        if (!f || !f.virtual) return this.lm.rectToParent(rect, key);
        const c = f.centre;
        return { left: rect.left / R + c.x, top: rect.top / R + c.y, right: rect.right / R + c.x, bottom: rect.bottom / R + c.y };
    }
    /**
     * The frame `di, dj` cells from `key` at its depth: a lattice frame's id, else a virtual frame's key (`make`),
     * else null. The same carry as `LevelMap.neighbour`, which mints.
     */
    _nb(key, di, dj, make = true) {
        if (!di && !dj) return String(key);
        const f = this._fr(key);
        if (!f) return null;
        if (f.parent == null) {
            const b = f.beside || { A: f.id, i: 0, j: 0 }, i = b.i + di, j = b.j + dj;
            if (!i && !j) return b.A;
            if (!make) return null;
            const k = b.A + "@" + i + "," + j + "~";
            if (!this._vf.has(k)) this._vf.set(k, { id: k, parent: null, depth: f.depth, cell: null, edge: null, centre: null, addrSeq: 0, virtual: true, beside: { A: b.A, i, j } });
            return k;
        }
        const ci = carryDigit(f.cell.i + di), cj = carryDigit(f.cell.j + dj);
        const p = ci.carry || cj.carry ? this._nb(f.parent, ci.carry, cj.carry, make) : String(f.parent);
        if (p == null) return null;
        if (this.lm.frame(p)) { const c = this.lm.findCellChild(p, ci.digit, cj.digit); if (c) return c.id; }
        if (!make) return null;
        const k = p + "/" + ci.digit + "," + cj.digit + "~";
        if (!this._vf.has(k)) {
            this._vf.set(k, { id: k, parent: p, depth: this._depth(p) + 1, cell: { i: ci.digit, j: cj.digit }, edge: cellEdge(ci.digit, cj.digit),
                centre: cellCentre(ci.digit, cj.digit), addrSeq: 0, virtual: true });
        }
        return k;
    }
    /** The lattice frame `di, dj` cells from `key` (which may be virtual), or null. */
    _peekReal(key, di, dj) { const k = this._nb(key, di, dj, false); return k != null ? this.lm.frame(k) || null : null; }
    /** A virtual frame a frame has since been minted at (or under whose address one was), or whose root grew a parent. */
    _vStale(v) {
        if (v.runOf != null) return !this._runLevel(v.id);   // its run no longer holds that level
        if (v.beside) { const a = this.lm.frame(v.beside.A); return !a || a.parent != null; }
        if (this.lm.frame(v.parent)) return !!this.lm.findCellChild(v.parent, v.cell.i, v.cell.j);
        const p = this._vf.get(v.parent) || this._runLevel(v.parent);
        return !p || this._vStale(p);
    }
    /** Virtual frames and their tiles: every one, or those whose key starts at lattice frame `F`. */
    _dropVirtual(F = null) {
        const hit = (k) => F == null || k.startsWith(F + "/") || k.startsWith(F + "@") || k.startsWith(F + "^");
        for (const [key, tile] of [...this.cache]) if (tile.virtual && hit(String(tile.level))) this._dropTile(key);
        for (const k of [...this._vf.keys()]) if (hit(k)) this._vf.delete(k);
        for (const k of [...this._rl.keys()]) if (hit(k)) this._rl.delete(k);
        if (F == null) this._fix.clear(); else this._fix.delete(String(F));
    }
    /** `rect` in virtual frame `from`'s units, mapped to lattice frame `to`: up its chain exactly, then `mapRectF`. */
    _mapRect(rect, from, to) {
        let f = this._fr(from), r = rect;
        while (f && f.virtual) {
            if (f.beside) {
                const dx = f.beside.i * W, dy = f.beside.j * W;
                r = { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy };
                f = this.lm.frame(f.beside.A);
                break;
            }
            if (f.runOf != null) {
                // Up the run's levels by its cell, each `_rectToParent`'s step, until the numbers repeat.
                const K = this.lm.frame(f.runOf), c = f.centre;
                for (let s = K.run.n - (K.depth - f.depth) + 1; s > 0; s--) {
                    const q = { left: r.left / R + c.x, top: r.top / R + c.y, right: r.right / R + c.x, bottom: r.bottom / R + c.y };
                    const same = Object.is(q.left, r.left) && Object.is(q.top, r.top) && Object.is(q.right, r.right) && Object.is(q.bottom, r.bottom);
                    r = q;
                    if (same) break;
                }
                f = this._fr(K.parent);
                continue;
            }
            r = this._rectToParent(r, f.id);
            f = this._fr(f.parent);
        }
        return f ? this.lm.mapRectF(r, f.id, to) : null;
    }

    /**
     * The natives of the parent's cell (every frame sharing it, A1 C3) whose boxes meet pre-image `pr`, padded past the
     * seam pad: a superset of what `classifyUp` keeps, which still decides (OPEN-FLAGS F156). The spatial index's boxes
     * carry a stroke's half width, as `classifyUp`'s band does.
     */
    _cellNatives(parentId, pr, rec) {
        const pad = (2 * seamPadFor(this.cfg) * this.cfg.base) / rec.s
            + 1e-9 * (1 + Math.abs(pr.left) + Math.abs(pr.right) + Math.abs(pr.top) + Math.abs(pr.bottom));
        const q = padRect(pr, pad);
        const fs = this.lm.cellFrames(String(parentId));
        if (!fs || fs.length < 2) return this.doc.queryRect(parentId, q);
        const out = [];
        for (const g of fs) for (const o of this.doc.queryRect(g.id, q)) out.push(o);
        return out;
    }

    /**
     * Natives of the eight cells around `parentId` whose boxes meet `rect` (the uncle: ink on screen homed in a
     * sibling of an ancestor; invariant 2 makes the ring of eight complete). Each comes in its own cell's
     * coordinates with that cell's origin in the parent's units, `cellOff` (whole frames, `LevelMap.cellOffset`),
     * which `deriveStep` folds into the edge: one exact subtraction, as the home side's chain does. Taking it through
     * the common parent rounded it and moved its deep picture 4096x a level (OPEN-FLAGS F174).
     */
    _ringNatives(parentId, rect) {
        const out = [];
        const virt = !this.lm.frame(String(parentId));
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const C = (di || dj) ? (virt ? this._peekReal(parentId, di, dj) : this.lm.peekNeighbour(parentId, di, dj)) : null;
                if (!C) continue;
                // C's origin in the parent's units, and the pre-image in C's: whole frames, exact.
                const off = [di * W, dj * W];
                const inG = { left: rect.left - off[0], right: rect.right - off[0], top: rect.top - off[1], bottom: rect.bottom - off[1] };
                for (const G of this.lm.cellFrames(C.id)) {      // every frame sharing the neighbour's cell (A1 C3)
                    if (!this.doc.list(G.id).length) continue;
                    // The neighbour's own spatial index, in its coordinates: this runs on every up-bake, for eight cells.
                    for (const o of this.doc.queryRect(G.id, inG)) out.push(ringNative(o, off));
                }
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
        const kept = this._ramTake(key, seq);
        if (kept) { kept.lru = ++this._clock; this._setTile(key, kept); return kept; }
        const objs = this._bakeDown(F, i, j);
        const tile = { level: F, dir: "down", i, j, objs, epoch: this._epoch, seq: this.chainSeq(F), lru: ++this._clock };
        this._setTile(key, tile);
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

    /** Non-ancestor frames at or below F whose reach meets `rect`, coarse first (`LevelMap.nearWalk`: F172, F179). */
    _downSources(F, rect) {
        const Fd = this._depth(F);
        const out = [], rects = [rect], up = this.lm.rectsUp(rect, F);   // `rect` in the units of F's resident k levels up
        this.lm.nearWalk(F, (f, k, s, x, y, a) => {
            const r = rects[k] !== undefined ? rects[k] : (rects[k] = up(a));
            const reach = REACH * s * (1 + 1e-9);
            if (!r || x + reach < r.left || x - reach > r.right || y + reach < r.top || y - reach > r.bottom) return false;
            if (this._depth(f.id) >= Fd && this.doc.count(f.id) && !this.lm.sameCell(f.id, F)) out.push(f.id);
            return true;
        });
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
        // Up to the nearest ancestor already summed, then each sum down from it: a cold chain is linear, not quadratic.
        const path = [];
        let n = 0;
        for (let id = F; id != null; id = this._seqUp(id)) {
            const h = this._chainSeq.get(id);
            if (h !== undefined) { n = h; break; }
            path.push(id);
        }
        for (let k = path.length - 1; k >= 0; k--) {
            const f = this.lm.frame(path[k]);
            if (f && f.addrSeq) n += f.addrSeq;
            this._chainSeq.set(path[k], n);
        }
        return n;
    }
    // A frame moved, was set aside or came back (a subtree move or delete): every cached tile
    // whose rect meets the frame's footprint - its cell grown by the reach a subtree may have
    // (invariant 2), at the old address and the new - is dropped. Tiles OF the moved subtree
    // go stale through `chainSeq`. F55 stands: a table change drops nothing.
    _onFrameEvent(ev) {
        this._dropVirtual();   // where the lattice holds a frame, and what it holds, is what a virtual frame is keyed on
        const foot = [];
        // An address as [parent, i, j]; below a run, the run's cell at its top holds the frame (a footprint at the parent).
        const at = (a) => (a.run ? [a.parent, a.run.i, a.run.j] : [a.parent, a.i, a.j]);
        const cur = this.lm.frame(ev.frame);
        if (cur && cur.parent != null) foot.push(cur.run ? [cur.parent, cur.run.i, cur.run.j] : [cur.parent, cur.cell.i, cur.cell.j]);
        else if (ev.at && ev.at.parent != null) foot.push(at(ev.at));   // a deleted frame is gone from the lattice
        if (ev.kind === "refile" && ev.from && ev.from.parent != null) foot.push(at(ev.from));
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
    /**
     * `fn` with the document's adds and removes held, patched in net when it returns, removes first (OPEN-FLAGS F196). A
     * descent's apply adds a kid a level and removes it the next, and each add walked every cached tile's chain afresh: at
     * level 10,000 a 300-level cede spent 142 s of a 193 s apply in `_reaches`, a lattice path each. Held, an add removed
     * again is never patched in, and the adds that stay share one walk up each tile's chain (`_memo`). Any other event
     * sees them first.
     */
    holdAdds(fn) {
        if (this._held) return fn();
        this._held = new Map();   // id -> [obj, level], in add order
        this._gone = [];          // ids removed while held: their pieces go at the release, before the adds
        this._cont = new Map();   // kid id -> the removed id it continues (`continues`)
        try { return fn(); } finally { this._releaseHeld(); this._held = this._gone = this._cont = null; }
    }
    /**
     * While adds are held: held native `kid` continues removed native `from` below its own level, a capped descent's last
     * kid (F196). Deep inside the kid's window the tiles hold its pieces already, as `from`'s: they are renamed, not derived
     * again. Each renamed piece goes with the kid, at the next job or the last, which names no kid; so every tile ends as a
     * patch would leave it, and until then shows what it showed.
     */
    continues(kid, from) { if (this._cont) this._cont.set(kid, from); }
    _releaseHeld() {
        const held = this._held, gone = this._gone, cont = this._cont;
        if (!held || (!held.size && !gone.length)) return;
        this._held = new Map(); this._gone = []; this._cont = new Map();
        let top = Infinity;
        for (const [, H] of held.values()) top = Math.min(top, this._depth(H));
        this._memo = { top, chains: new Map(), at: new Map(), rects: new Map(), owners: new Map(), renamed: new Map() };
        try {
            // The tiles' frames lie on the camera's chain almost all: walked once from its deepest, the others join it.
            let deep = null, dd = -Infinity;
            for (const tile of this.cache.values()) { const d = tile.dir === "up" ? this._depth(tile.level) : -Infinity; if (d > dd) { dd = d; deep = tile.level; } }
            if (deep != null && dd >= top) this._chainMemo(deep);
            const kidsOf = new Map();   // removed id -> [[kid, level]] that continue it
            for (const [k, from] of cont) { const h = held.get(k); if (h) (kidsOf.get(from) || kidsOf.set(from, []).get(from)).push(h); }
            for (const id of gone) { const kids = kidsOf.get(id); if (kids) this._renameDeep(id, kids); else this._removeObject(id); }
            for (const [o, H] of held.values()) this._addObject(o, H);
        } finally { this._memo = null; }
    }
    /**
     * `_removeObject(id)`, but an up tile two or more levels under a kid that continues `id` takes its pieces of `id` as
     * the kid's where the tile's ancestor one level under the kid, its reach (invariant 2) and one object tile more (the
     * chop's grid there), lies inside the kid's window: the kid is that ink there, and the levels below derive the same
     * bits from it (the cede: "the kid IS that piece").
     */
    _renameDeep(id, kids) {
        const keys = this._idTiles.get(id);
        if (!keys) return;
        const m = (REACH + W) / R;
        for (const key of [...keys]) {
            const tile = this.cache.get(key);
            if (!tile || !this._tileLive(key, tile)) continue;
            let to = null;
            if (tile.dir === "up" && this.lm.frame(tile.level)) {
                const dT = this._depth(tile.level);
                for (const [k, K] of kids) {
                    const A = k.attachRect, dK = this._depth(K), kf = this.lm.frame(K);
                    if (!A || !kf || kf.shift || dT < dK + 2 || this.doc.tableOf(k, K)) continue;   // a moved kid's picture is elsewhere
                    const a = this.lm.frame(this._upTo(tile.level, dK + 1));
                    if (!a || !a.centre || a.shift || this._depth(a.id) !== dK + 1 || a.parent == null || !this.lm.sameCell(a.parent, K)) continue;
                    const c = a.centre;
                    if (c.x - m >= A.x0 && c.x + m <= A.x1 && c.y - m >= A.y0 && c.y + m <= A.y1) { to = k; break; }
                }
            }
            const kept = [], out = [];
            for (const p of tile.objs) (p.id === id ? out : kept).push(p);
            keys.delete(key);
            if (!out.length) continue;
            tile.objs = kept;
            this._tileEv({ kind: "remove", key, tile, pieces: out });
            if (!to) continue;
            const n0 = tile.objs.length;
            for (const p of out) {
                const q = { ...p, id: to.id, z: to.z };   // what `deriveStep` would tag a piece of the kid with
                if (to.editId != null) q.editId = to.editId; else delete q.editId;
                tile.objs.push(q);
            }
            this._appended(tile, n0);
            let s = this._memo.renamed.get(to.id);
            if (!s) this._memo.renamed.set(to.id, (s = new Set()));
            s.add(key);
        }
        if (!keys.size) this._idTiles.delete(id);
    }
    /** Held adds: up tile `tile`'s padded rect up its chain to the shallowest held add, once (`rectUpChain`: `mapRectF`'s numbers). */
    _upRects(tile) {
        const key = tile.level + "|" + tile.i + "," + tile.j;
        let up = this._memo.rects.get(key);
        if (!up) this._memo.rects.set(key, up = this.lm.rectUpChain(padRect(this.lm.tileRect(tile.level, tile.i, tile.j), seamPadFor(this.cfg)), tile.level, this._memo.top));
        return up;
    }
    /**
     * Up from F while a held add can be shallower: `{ids, depths, next}`, depths falling, a run's levels left out (`_upTo`
     * reads them off its frame). A frame an earlier walk met ends this one there (`next`: [that walk, its index]), so the
     * frames of one chain are walked once.
     */
    _chainMemo(F) {
        let m = this._memo.chains.get(F);
        if (m) return m;
        const at = this._memo.at, ids = [], depths = [];
        let next = null;
        for (let A = F; A != null; A = this._seqUp(A)) {
            const hit = at.get(String(A));
            if (hit) { next = hit; break; }
            const d = this._depth(A);
            ids.push(String(A)); depths.push(d);
            if (d <= this._memo.top) break;
        }
        m = { ids, depths, next };
        for (let k = 0; k < ids.length; k++) at.set(ids[k], [m, k]);
        this._memo.chains.set(F, m);
        return m;
    }
    /** The first frame up F's chain at or above depth `d` (`_chainMemo`), or null. */
    _upTo(F, d) {
        let m = this._chainMemo(F), k = 0, under = null;   // `under`: the walk's last entry before `m`'s part of it
        for (;;) {
            const { ids, depths } = m;
            let lo = k, hi = depths.length;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (depths[mid] > d) lo = mid + 1; else hi = mid; }
            if (lo < ids.length) {
                const below = lo > k ? ids[lo - 1] : under;   // past d: d is a level of its run, if it has one
                return (depths[lo] !== d && below != null && this._runKeyAt(below, d)) || ids[lo];
            }
            if (ids.length > k) under = ids[ids.length - 1];
            if (!m.next) return null;
            [m, k] = m.next;
        }
    }
    _onDoc(ev) {
        if (this._held) {
            if (ev.obj && (ev.kind === "finalize" || (ev.kind === "add" && !ev.live))) { this._ramClear(); this._held.set(ev.obj.id, [ev.obj, ev.level]); return; }
            if (ev.kind === "remove" && this._held.delete(ev.id)) { this._ramClear(); this._cont.delete(ev.id); return; }   // added and removed while held
            if (ev.kind === "remove" && ev.obj) { this._ramClear(); this._gone.push(ev.id); return; }
            if (ev.kind !== "remove" && ev.kind !== "add") this._releaseHeld();
        }
        if (ev.kind === "reset") { this._clearTiles(); return; }
        if (ev.kind === "refile" || ev.kind === "removeFrame" || ev.kind === "addFrame") { this._ramClear(); this._onFrameEvent(ev); return; }
        if (!ev.obj) return;
        if (ev.kind === "remove") { this._ramClear(); this._removeObject(ev.id); return; }
        if (ev.kind === "add" && ev.live) return; // still growing; finalize announces
        if (ev.kind === "add" || ev.kind === "finalize") { this._ramClear(); this._addObject(ev.obj, ev.level); return; }
        // A move changes the displacement table and nothing a tile is made of
        // (F55): every tile stays exactly right, and the next render reads the
        // picture from its new address.
        if (ev.kind === "change" && (ev.offsetsOnly || ev.attrOnly)) return;
        if (ev.kind === "change") { this._ramClear(); this._removeObject(ev.id); this._addObject(ev.obj, ev.level); }
    }
    /**
     * A frame the lattice forgot (frame GC): its tiles, its chain sum and every reroute memo that names
     * it go — its own, and each whose group reads its tiles: the memo's key counts frames, so a later
     * mint restores the key and the group would read a frame that is gone (the native not drawn;
     * R-MODEL-C1, 6 of 8,000 fuzz renders). A later read can mint the same id again, and its old tiles
     * would be served without what changed since (REVIEWER-3 RENDER-1). Its camera pins stay: they are the
     * Stage's, which sends them only when its keys change, so a frame minted again would lose them for good
     * and a drop's batch write would drop its tiles (OPEN-FLAGS F151).
     */
    forgetFrame(frame) {
        const F = String(frame);
        for (const [key, tile] of this.cache) {
            if (String(tile.level) !== F) continue;
            this._dropTile(key);
        }
        for (const [key, e] of this._ram) if (String(e[0].level) === F) { this._ram.delete(key); this._ramBytes -= e[1]; }
        if (this._rrMemo) for (const [k, m] of this._rrMemo) if (k === F || [...m.groups.values()].some((g) => g.F0 === F)) this._rrMemo.delete(k);
        this._chainSeq.delete(F);
        this._dropVirtual(F);   // the virtual frames keyed under it
    }
    /** Whether a tile still stands: dropped in a drag's batch mode unless on screen, or when its frame is gone (RENDER-1). */
    _tileLive(key, tile) {
        if (this._batch && !this._pins.has(key)) { this._dropTile(key); return false; }
        const v = tile.virtual ? this._vf.get(String(tile.level)) || this._runLevel(tile.level) : null;
        if (tile.virtual ? !v || this._vStale(v) : !this.lm.frame(tile.level)) { this._dropTile(key); return false; }
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
        const via = new Map(), dH = this._depth(H);
        const renamed = this._memo ? this._memo.renamed.get(o.id) : null;   // tiles holding its pieces already (`_renameDeep`)
        let ob = null;
        for (const [key, tile] of this.cache) {
            if (!this._tileLive(key, tile) || (renamed && renamed.has(key))) continue;
            const F = tile.level;
            if (this.lm.sameCell(F, H)) continue;            // a frame's cell's own natives are drawn live, never in its tiles
            if (tile.dir === "down") {
                // H is a down source for F iff non-ancestor and depth(H) ≥ depth(F); an ancestor is shallower, so the
                // depth decides (asking `isAncestor` first walked F's chain to the root for every tile: F196).
                if (dH >= this._depth(F)) this._appendDown(tile, o, H);
                continue;
            }
            let A = via.get(F);
            if (A === undefined) { A = this._upVia(H, F); via.set(F, A); }
            if (A == null) continue;
            if (this.lm.sameCell(this._parentOf(F), A)) {
                const d = A === H ? o : this._ringCopy(o, H, A, this._rectToParent(this.lm.tileRect(F, tile.i, tile.j), F));
                if (d) this._appendUp(tile, [d]);
            } else if (this._memo || this._reaches(o, H, tile, ob || (ob = bboxOf(o, this.live)))) chained.push([key, tile]);
        }
        chained.sort((a, b) => this._depth(a[1].level) - this._depth(b[1].level));
        for (const [key, tile] of chained) {
            if (this.cache.get(key) !== tile) continue;
            // Held adds: a tile none of whose owners holds a piece of `o` takes nothing, and is asked no box. A piece with a
            // hole has every deeper tile of the chain in its box: 46,000 such pairs a 300-level cede (F196).
            if (this._memo && (this._takesNothing(key, tile, o.id) || !this._reaches(o, H, tile, ob || (ob = bboxOf(o, this.live))))) continue;
            this._appendChained(key, tile, o);
        }
    }
    /**
     * Whether chained tile `key` would take no piece of native `id` (`_appendChained`): its owners are all current and
     * none holds one. Its owners' keys are kept for the held adds' release.
     */
    _takesNothing(key, tile, id) {
        let keys = this._memo.owners.get(key);
        if (keys === undefined) {
            const frame = this._fr(tile.level), P = frame && frame.parent != null ? this._fr(frame.parent) : null;
            keys = P && frame.edge ? this._owners(P.id, this._rectToParent(this.lm.tileRect(tile.level, tile.i, tile.j), tile.level))
                .filter((s) => s.N != null).map((s) => s.N + "|up|0,0") : null;
            this._memo.owners.set(key, keys);
        }
        if (!keys) return true;   // no parent or no edge record: `_appendChained` returns at once
        const has = this._idTiles.get(id);
        for (const k of keys) if (!this.peek(k) || (has && has.has(k))) return false;
        return true;
    }
    /**
     * The frame whose child chain carries `H`'s natives up into `F`: F's ancestor at H's depth when that
     * is H, or when H is in its ring (`_ringNatives`); null when H's natives never reach F's up tiles.
     */
    _upVia(H, F) {
        const dH = this._depth(H);
        if (dH >= this._depth(F)) return null;
        let A = F;
        if (this._memo && dH >= this._memo.top) A = this._upTo(F, dH);   // the same walk, read off the held adds' shared walks
        else A = this._upAt(F, dH);
        if (A == null) return null;
        A = String(A);
        if (this.lm.sameCell(A, H)) return H;
        if (this.lm.frame(A)) { for (const G of this.lm.peekRing(A)) if (this.lm.sameCell(G.id, H)) return A; return null; }
        return this._cellOff(H, A) ? A : null;
    }
    /** Where cell `H`'s origin sits in `A`'s units when it is one of the eight around `A` (`LevelMap.cellOffset`; `A` may be virtual). */
    _cellOff(H, A) {
        if (this.lm.frame(String(A))) return this.lm.cellOffset(H, A);
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const n = (di || dj) ? this._peekReal(A, di, dj) : null;
                if (n && this.lm.sameCell(n.id, H)) return [di * W, dj * W];
            }
        }
        return null;
    }
    /** `o` (a native of `H`, in `A`'s ring) as `_ringNatives(A, pr)` hands it over, or null when it does not. */
    _ringCopy(o, H, A, pr) {
        const off = this._cellOff(H, A);
        if (!off) return null;
        const inH = { left: pr.left - off[0], right: pr.right - off[0], top: pr.top - off[1], bottom: pr.bottom - off[1] };
        return this.doc.queryRect(H, inH).includes(o) ? ringNative(o, off) : null;
    }
    /** Whether `o`'s box, at `H`, meets the up tile's rect grown by the seam pad (classifyUp's cull). */
    _reaches(o, H, tile, ob = null) {
        const pr = padRect(this.lm.tileRect(tile.level, tile.i, tile.j), seamPadFor(this.cfg));
        let r;
        if (this._memo && this.lm.frame(tile.level)) {
            const dH = this._depth(H);
            if (this._depth(tile.level) >= dH + 2) {
                // Two or more levels under H: the reach of the tile's ancestor one level under H (invariant 2) holds the tile,
                // read off the shared chain walk. A walk from each tile to H was 640 ms of a 1,000-level cede's first job (F196).
                const a = this.lm.frame(this._upTo(tile.level, dH + 1));
                if (a && a.centre && !a.shift && a.parent != null && this._depth(a.id) === dH + 1 && this.lm.sameCell(a.parent, H)) {
                    const e = REACH / R;
                    r = { left: a.centre.x - e, top: a.centre.y - e, right: a.centre.x + e, bottom: a.centre.y + e };
                }
            }
            if (r === undefined) {
                // Held adds: the tile's rect up its chain once, read at H's cell.
                const A = this.lm.residentOf(H);
                r = A ? this._upRects(tile).get(A.id) : undefined;
            }
        }
        if (r === undefined) r = this._mapRect(pr, tile.level, H);
        const half = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        return !r || this._overlaps(r, ob || bboxOf(o, this.live), half);
    }
    _appendChained(key, tile, o) {
        const F = tile.level;
        const frame = this._fr(F);
        const P = frame && frame.parent != null ? this._fr(frame.parent) : null;
        if (!P || !frame.edge) return;
        const pr = this._rectToParent(this.lm.tileRect(F, tile.i, tile.j), F);
        for (const s of this._owners(P.id, pr)) {
            if (s.N == null || this.peek(s.N + "|up|0,0")) continue;
            // An owner across the parent's edge that the cache no longer holds (frame GC, eviction, a virtual frame
            // dropped) is baked again from its parents when they are here: the chain below it is not. Not while held
            // adds are patched in: the document already holds the later ones, which a bake would take twice (F196).
            if (!(s.i || s.j) || this._memo || !this._rebake(s.N)) { this._dropTile(key); return; }
        }
        const from = this._upPiecesOver(P.id, pr, o.id);
        if (from.length) this._appendUp(tile, from);
    }
    /** Frame `N`'s tile (0, 0) baked when every tile it is read from is current (the document already has the change). */
    _rebake(N) {
        const f = this._fr(N);
        if (!f) return false;
        if (f.parent != null) {
            const pr = this._rectToParent(this.lm.tileRect(N, 0, 0), N);
            for (const s of this._owners(f.parent, pr)) if (s.N != null && !this.peek(s.N + "|up|0,0")) return false;
        }
        const pins = this._pins;
        this._pins = new Set(pins);
        try { this._ensureUp(N, 0, 0); } finally { this._pins = pins; }
        return true;
    }
    /** `_bakeUp`'s derivation of `objs` (the parent's pieces or natives) into `tile`, appended. */
    _appendUp(tile, objs) {
        const F = tile.level;
        const frame = this._fr(F);
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
     * camera's own read of F has just pinned, and the tiles the prefetch read ahead (`_warm`)
     * (WORKLIST memory step 3a). Called by the engine AFTER that read, so a moved object's tiles
     * the reroute reads from another frame survive: deleting them re-baked them cold on the zoom
     * that followed — 440 → 64 ms for the first list in jsdom, and a 929 ms reroute two ticks
     * before a crossing in Kobin's Chrome with the ladder's tiles not kept (OPEN-FLAGS F83).
     */
    framesLeft(F) {
        const keep = new Set();
        for (let id = F; id != null; id = this.lm.parentOf(id)) keep.add(String(id));
        // ...and the tiles those were read from, theirs too: a square's owner across a parent's edge (F181).
        const from = new Set(), stack = [];
        for (const tile of this.cache.values()) if (keep.has(String(tile.level)) && tile.src) stack.push(...tile.src);
        while (stack.length) {
            const k = stack.pop();
            if (from.has(k)) continue;
            from.add(k);
            const t = this.cache.get(k);
            if (t && t.src) stack.push(...t.src);
        }
        let n = 0;
        for (const [key, tile] of [...this.cache]) {
            if (keep.has(String(tile.level)) || from.has(key) || this._pins.has(key) || this._warm.has(key)) continue;
            this._spill(key); n++;
        }
        for (const k of [...this._vf.keys()]) if (!this.cache.has(k + "|up|0,0")) this._vf.delete(k);
        for (const k of [...this._rl.keys()]) if (!this.cache.has(k + "|up|0,0")) this._rl.delete(k);
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
        for (const [key] of evictable) { if (n-- <= 0) break; this._spill(key); }
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
            for (const [key] of arr) { if (n-- <= 0) break; if (!this._pins.has(key)) this._spill(key); }
        }
    }

    // Test/inspection helpers.
    size() { return this.cache.size; }
    _tileKeys() { return [...this.cache.keys()]; }
}
