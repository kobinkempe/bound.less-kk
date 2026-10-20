/**
 * Stage.js — the scene (A2-scene.md §2–§3, PLAN §1.1): the camera frame's items in paint order,
 * kept from the document's and the tile cache's own events so it is never behind the document;
 * the generation G every commit bumps; and the freshness of every plate cell the plate store holds
 * or has in flight (`track`, `dirtySince`). It owns no camera and no plates: the engine hands it
 * the camera's frame and window (`sync`), the plate store registers its cells.
 *
 * Four facts a reader needs not to break it:
 *   - a handler never bakes a tile: a tile the table needs and the cache does not hold current is
 *     listed missing and read at the next `sync`; `covers` says which rectangles are complete;
 *   - no read raises a document event (A1 C1); the tile events `sync`'s reads raise are queued
 *     and applied at its end, and every handler is idempotent against the document as it is — a
 *     piece is in the table once, keyed by its object;
 *   - dirt is the changed native's drawn footprint before and after, taken from the event itself
 *     (`oldBbox`, `oldBelow`, the removed object) — a dropped shape's or fill's its boundary pieces'
 *     sweep, asked per cell or rectangle (`_sweepIn`, OPEN-FLAGS F153) — mapped into every frame with
 *     tracked cells: a plate is exact iff `plate.G >= dirtySince(key)` (A2 §3.1, PLAN §3 row 1);
 *   - membership and placement come from the `PlacementModel` (placementModel.js) and nothing
 *     else: never `o.below`, a frame's shift or the lattice's `*Obj` functions;
 *   - a drag writes nothing until its drop (A1 C2): `hold` and `setDragDelta` draw, hit and lasso
 *     the held natives at their placement plus the pointer's delta.
 */
import { perfNow } from "./now";
import { drawnBox, ZERO } from "./placementModel";
import { translateLoops, pieceBBox } from "./geometry/arcShape";
import { familyTraits } from "./raster/rasterPack";
import { inLineage } from "./eraseRule";

/** Items a chunk holds before it splits in two (A2 §2.2: 24–26 µs to replace one item by three at 45k items). */
const CHUNK_MAX = 512;
/** `touchedSince`'s reach: the natives whose last touch is remembered. */
const TOUCHED_MAX = 256;
/** `changesSince`'s reach: deltas kept before the log is cut (A2 §2.4). */
const LOG_MAX = 4096;
/** `dirtyRects`' reach: commits whose footprints are kept (A2 §3.4). */
const DIRT_LOG_MAX = 2048;
/** Past this many rectangles in one frame a commit's footprint is one union box (today's MOVE_RECTS_MAX rule). */
const RECTS_MAX = 256;
/** `landedAt` answers for the most recent shape landings only. */
const LANDED_MAX = 256;
const DIRS = ["up", "down"];
const EVERYWHERE = Object.freeze({ left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
/** An erase step that changes no pixel (`_stepOf`). */
const NO_DIRT = Object.freeze({ none: true });
/** Bytes of boundary boxes the dirt log keeps for drops' sweeps (F153); past it the oldest sweeps become their two boxes. */
const SWEEP_BYTES_MAX = 32 << 20;
/** Frames a sweep keeps its placement mappers and mapped hulls for. */
const SWEEP_MAPS = 8;
/** (commit, frame) pairs whose mapped footprints are kept for the queries after the commit. */
const RECTS_KEPT = 256;

let uidSeq = 0;

/**
 * One drawn piece: a tile piece or a native of the camera's frame, with its paint-order key and
 * the offset paint applies. z, the family key and the erase flag are read from the live native
 * (R25 H8); the geometry from the piece. The getters give the fields a render-list item has, so
 * `_lastList` and `_objs()` keep their shape; nothing is written onto a piece or a native.
 */
export class Item {
    constructor(stage, piece) {
        this.stage = stage;
        this.piece = piece;
        this.id = piece.id;
        this.nat = null;
        this.key = "own";    // the tile key it came from, or "own"
        this.grp = null;     // the reroute group it was read for, or null
        this.off = ZERO;     // [dx, dy] paint adds: `placement(nat, F).rem`
        this.zk = 0; this.si = 0; this.sj = 0; this.sd = 0; this.seq = 0;
        this.fk = 0;         // the family key it is filed under
        this.uid = ++uidSeq;
        this.live = false;   // in the table
    }
    get type() { return this.piece.type; }
    get z() { const n = this.nat; return n ? n.z : this.piece.z; }
    get editId() { const n = this.nat; return n ? n.editId : this.piece.editId; }
    get erase() { const n = this.nat; return n ? n.erase : this.piece.erase; }
    get targets() { const n = this.nat; return n ? n.targets : this.piece.targets; }
    get targetOf() { const n = this.nat; return n ? n.targetOf : this.piece.targetOf; }
    get handledBy() { const n = this.nat; return n ? n.handledBy : this.piece.handledBy; }
    get fam() { const k = this.editId; return k != null ? k : this.id; }
    get res() { const o = this.stage._hold ? this.stage._paintOff(this) : this.off; return o[0] || o[1] ? o : undefined; }
    get clip() { return this.piece.clip; }
    get loops() { return this.piece.loops; }
    get polys() { return this.piece.polys; }
    get pts() { return this.piece.pts; }
    get lwFrame() { return this.piece.lwFrame; }
    get color() { return this.piece.color; }
    get opacity() { return this.piece.opacity; }
    get covers() { return this.piece.covers; }
    get fadeTag() { return this.piece.fadeTag; }
    get origin() { return this.piece.origin; }
    get w() { return this.piece.w; }
    get tile() { return this.piece.tile; }
    get attachRect() { return this.piece.attachRect; }
    get _home() { return this.piece._home; }
    get _ver() { return this.piece._ver; }
    get _outline() { return this.piece._outline; }
    get _pen() { return this.piece._pen; }
    /** `bboxOf`'s memo, kept on the piece — never on a stroke still being drawn. */
    get _bbox() { return this.piece._bbox; }
    set _bbox(b) { if (this.piece !== this.stage.store.live) this.piece._bbox = b; }
    /** Hit-testable, and skipped by every pack: from pen-down until its shape lands (PLAN §1.5). */
    get pending() { return this.stage._pending.has(this.id); }
    /** The drawn box without the offset, in the camera frame's units. */
    get box() { return drawnBox(this.piece, this.stage.store.live); }
}

/** Paint order: `(z ?? id, id)` as the oracle's `renderList` sorts (`__oracles__/renderList.js`), then the order it concatenates one native's pieces in. */
function cmp(a, b) {
    return (a.zk - b.zk) || (a.id - b.id) || (a.si - b.si) || (a.sj - b.sj) || (a.sd - b.sd) || (a.seq - b.seq) || (a.uid - b.uid);
}

/** A sorted list in chunks of at most CHUNK_MAX: binary search over the chunks' last items, then within one. */
class ChunkList {
    constructor() { this.chunks = []; this.size = 0; this.ver = 0; this._arr = null; this._arrVer = -1; }
    clear() { this.chunks = []; this.size = 0; this.ver++; }
    /** Replace everything with `items`, sorted here. */
    fill(items) {
        items.sort(cmp);
        this.chunks = [];
        for (let k = 0; k < items.length; k += CHUNK_MAX / 2) this.chunks.push(items.slice(k, k + CHUNK_MAX / 2));
        this.size = items.length;
        this.ver++;
    }
    _chunkFor(it) {
        const cs = this.chunks;
        let lo = 0, hi = cs.length - 1;
        while (lo < hi) {
            const m = (lo + hi) >> 1, c = cs[m];
            if (cmp(c[c.length - 1], it) < 0) lo = m + 1; else hi = m;
        }
        return lo;
    }
    insert(it) {
        const cs = this.chunks;
        if (!cs.length) { cs.push([it]); this.size++; this.ver++; return; }
        const ci = this._chunkFor(it), c = cs[ci];
        let lo = 0, hi = c.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(c[m], it) < 0) lo = m + 1; else hi = m; }
        c.splice(lo, 0, it);
        if (c.length > CHUNK_MAX) cs.splice(ci, 1, c.slice(0, c.length >> 1), c.slice(c.length >> 1));
        this.size++; this.ver++;
    }
    remove(it) {
        const cs = this.chunks;
        if (!cs.length) return false;
        const ci = this._chunkFor(it), c = cs[ci];
        let lo = 0, hi = c.length - 1;
        while (lo <= hi) {
            const m = (lo + hi) >> 1, d = cmp(c[m], it);
            if (d === 0) {
                if (c[m] !== it) return false;
                c.splice(m, 1);
                if (!c.length) cs.splice(ci, 1);
                this.size--; this.ver++;
                return true;
            }
            if (d < 0) lo = m + 1; else hi = m - 1;
        }
        return false;
    }
    /** The items in paint order, one array per version. */
    toArray() {
        if (this._arrVer !== this.ver) {
            const out = new Array(this.size);
            let n = 0;
            for (const c of this.chunks) for (const it of c) out[n++] = it;
            this._arr = out; this._arrVer = this.ver;
        }
        return this._arr;
    }
}

const sameOff = (a, b) => a === b || (a[0] === b[0] && a[1] === b[1]);
const shifted = (r, off) => (off[0] || off[1]
    ? { left: r.left - off[0], top: r.top - off[1], right: r.right - off[0], bottom: r.bottom - off[1] } : r);
const sameRange = (a, b) => !!a && !!b && a.i0 === b.i0 && a.i1 === b.i1 && a.j0 === b.j0 && a.j1 === b.j1;
const RANGE_MEMO_MAX = 512;   // `_rangeKeys`' arrays kept: the window's, each group's, the plates' `covers` asks about
/** Touching counts as meeting: invalidation is conservative (the plate store's own rule). */
const meets = (a, b) => !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
const inside = (a, b) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
const unionOf = (a, b) => (a ? { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) } : { ...b });
const sameTraits = (a, b) => !!a && !!b && a.union === b.union && a.sign === b.sign && a.colour === b.colour && a.alpha === b.alpha;
const tableKey = (b) => (b ? b.map((e) => (e ? e[0] + "," + e[1] : "")).join(";") : "");
/** The array a shape's or fill's boundary is read from (replaced, never changed in place, when it changes); null for a stroke. */
const geomOf = (o) => (o.type === "shape" ? o.loops : o.type === "fill" ? o.polys : null);
/** What a native is drawn with besides its geometry and placement: a sweep needs it unchanged (F153). */
const lookOf = (o) => o.color + "|" + o.opacity + "|" + o.z + "|" + o.editId + "|" + !!o.erase;

/**
 * A shape's or fill's boundary pieces boxed in loop order, home units (F153): `[level0, level1, …]`, level 0 one box a
 * piece, each next level the pairs of the one before merged, the last one box — the tree `_sweepIn` descends. Null when
 * it has no piece.
 */
function sweepBoxes(o) {
    const geom = geomOf(o);
    if (!geom) return null;
    const pb = [];
    if (o.type === "shape") {
        for (const loop of geom) for (const p of loop) { const b = pieceBBox(p); pb.push(b[0], b[1], b[2], b[3]); }
    } else {
        for (const ring of geom) {
            for (let k = 0; k < ring.length; k++) {
                const a = ring[k], b = ring[(k + 1) % ring.length];
                pb.push(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
            }
        }
    }
    if (!pb.length) return null;
    let L = Float64Array.from(pb);
    const v = [L];
    while (L.length > 4) {
        const h = Math.ceil(L.length / 8), N = new Float64Array(h * 4);
        for (let c = 0; c < h; c++) {
            const p = c * 8, q = p + 4 < L.length ? p + 4 : p;
            N[c * 4] = Math.min(L[p], L[q]); N[c * 4 + 1] = Math.min(L[p + 1], L[q + 1]);
            N[c * 4 + 2] = Math.max(L[p + 2], L[q + 2]); N[c * 4 + 3] = Math.max(L[p + 3], L[q + 3]);
        }
        v.push(N);
        L = N;
    }
    return v;
}

/** The bytes of a commit's sweeps' piece trees. */
const sweepBytesOf = (states) => { let n = 0; for (const s of states) if (s.kind === "sweep") n += s.bytes; return n; };

export default class Stage {
    /**
     * @param {object} deps
     * @param {object} deps.doc the Document @param {object} deps.lm the LevelMap
     * @param {object} deps.store the TileStore (the Stage subscribes after it, so it sees tiles patched)
     * @param {object} deps.model the PlacementModel (`createPlacementModel`)
     * @param {object} [deps.cfg] the engine cfg, for the pack's family traits
     */
    constructor({ doc, lm, store, model, cfg = null }) {
        this.doc = doc; this.lm = lm; this.store = store; this.model = model; this.cfg = cfg;
        /** Monotone; one bump a commit (A2 §2.4). */
        this.generation = 0;
        /** The camera frame the table is for, and the window it covers (the frame's units). */
        this.frame = null;
        this.window = null;
        this._list = new ChunkList();
        this._byId = new Map();       // native id -> Set<Item>
        this._byKey = new Map();      // tile key -> Set<Item>
        this._byPiece = new Map();    // piece -> Item
        this._byHome = new Map();     // home frame -> Set<native id> of the natives with items
        this._homeOf = new Map();     // native id -> the home `_byHome` files it under
        this._byFam = new Map();      // family key -> Set<Item>
        this._own = new Map();        // native id -> its own item (homed in the camera's frame)
        this._itemOf = new WeakMap(); // piece -> the Item it last was: one object a piece, so the pack's memo hits
        this._keys = new Map();       // watched tile key -> { key, frame, i, j, d, tile, win, groups, next }
        this._keysVer = 0;            // bumped when a key is watched or retired: the tile store's camera pins follow it
        this._pinnedVer = -1;
        this._winKeys = new Set();
        this._winRange = null;        // the tile range `_winKeys` were made from
        this._rangeMemo = new Map();  // "F|i0,i1,j0,j1" -> that range's tile keys (`_rangeKeys`)
        this._groups = new Map();     // group key -> { gk, F0, rem, ids, keys, range }
        this._gOf = new Map();        // native id -> its group key
        this._missing = new Set();    // watched keys to read at the next sync
        this._pending = new Set();    // native ids from pen-down until their shape lands
        this._need = true;            // a full rebuild at the next sync
        this._lat = "";               // the lattice's addrEpoch|size, last seen
        this._dRev = null;            // `model.displaced(frame).rev`, last diffed
        // The commit in progress.
        this._touched = new Set();
        this._wide = false;
        this._batch = 0;
        this._sync = 0;
        this._queue = [];
        this._commitFns = new Set();
        this._foot = [];              // this commit's footprint states
        this._batchFoot = new Map();  // native id -> { before, after } inside a batch
        this._info = { frames: new Set(), drop: [], reset: false };
        this._events = 0;             // this commit's document events, and how many were erase steps (`_stepOf`)
        this._neutralEvents = 0;
        this._quiet = 0;              // events applied without footprints (a hold's release)
        this._landing = [];           // pending natives whose shape landed in this commit
        this._landed = new Map();     // native id -> the G its shape landed at
        // Freshness (A2 §2.5, §3.1): the cells the plate store holds, has in flight or keeps in its RAM tier.
        this._cells = new Map();      // key -> { key, frame, box, dirty, from }: `dirty` is complete for commits after `from`
        this._cellsByFrame = new Map();
        this._dirtLog = [];           // { G, states }, oldest first
        this._sweepBytes = 0;         // its sweeps' piece trees and mapped hulls (SWEEP_BYTES_MAX)
        this._rectsMemo = new Map();  // "G|frame" -> a commit's mapped footprints there (`_entryRects`)
        this._touchLog = new Map();   // native id -> the G its last `touch` commits at, oldest first (TOUCHED_MAX)
        this._dirtFloor = 0;          // the log holds every commit after this G
        // The family rule (PLAN §5.1 Q15).
        this._famTraits = new Map();  // family key -> the traits plates were packed with
        this._famBefore = new Map();  // family key -> { traits, box } before this commit touched it
        // The drag's hold (A2 §2.7) and its delta.
        this._hold = null;
        this.sweepOff = false;        // a measurement lever (F153): every drop dirties its natives' boxes
        this._atRest = 0;             // `atRest`: reads ignore the drag's delta
        this._dragVer = 0;            // one per `setDragDelta`: the key of an item's cached paint offset
        // `changesSince` (A2 §2.4).
        this._log = [];
        this._logFloor = 0;
        this._logCur = null;
        this.stats = { commits: 0, rebuilds: 0, syncs: 0, reads: 0, missed: 0, queued: 0, items: 0, rerouteDiffs: 0,
            dirtied: 0, familyFlips: 0, neutral: 0, held: 0, swept: 0, tracked: 0 };
        this._unsubDoc = doc.subscribe((ev) => this._onDoc(ev));
        this._unsubTile = store.onTile((ev) => this._onTile(ev));
    }

    destroy() {
        if (this._unsubDoc) this._unsubDoc();
        if (this._unsubTile) this._unsubTile();
        this._unsubDoc = this._unsubTile = null;
        this._commitFns.clear();
    }

    // ---- reading the table ----

    /** The items in paint order, bottom-up: one array per table version (never mutate it). */
    items() { return this._list.toArray(); }
    /** The items top-down. */
    *itemsTopDown() { const a = this._list.toArray(); for (let k = a.length - 1; k >= 0; k--) yield a[k]; }
    /** A native's items, in no order. */
    itemsOf(id) { const s = this._byId.get(id); return s ? [...s] : []; }
    /** The geometry an item draws and the offset it is drawn at (a held item's with the drag's delta); an input at p reaches it at p − off. */
    placed(item) {
        const h = this._hold;
        return { geom: item.piece, off: h && h.d && !this._atRest ? this._drawnOff(item) : item.off };
    }
    /**
     * Any native as seen from any frame (A2 §2.6): its drawn box there, and an input made there in
     * its stored coordinates and back — a point `[x, y]`, a rect or loops. A held native is where the
     * drag draws it.
     */
    placeNative(nat, frameId) {
        const F = String(frameId), h = this._hold;
        return new Placement(this, nat, F, h && h.d && !this._atRest && this._heldNat(nat) ? this._deltaIn(F) : null);
    }
    /** `fn`'s reads with every native where it rests: the drag's delta ignored (the ants decide on the picture the drag began from). */
    atRest(fn) {
        this._atRest++;
        try { return fn(); } finally { this._atRest--; }
    }

    /**
     * Whether every tile under `rect` (the frame's units) is read into the table: the camera frame's own, and each
     * reroute group's whose natives are drawn there (a group drawing nothing in `rect` holds no piece of it; 49 of a
     * crossing's 50 unread keys were such groups', every cell refused for them); every group's during a drag's hold.
     */
    covers(frameId, rect) {
        if (!this.frame || String(frameId) !== this.frame || this._need) return false;
        for (const key of this._tileKeys(this.frame, rect)) {
            const k = this._keys.get(key);
            if (!k || !k.tile || this._missing.has(key)) return false;
        }
        for (const g of this._groups.values()) {
            const b = this._hold ? undefined : this._groupBox(g);       // a drag places held natives at its delta: no skip
            if (b !== undefined && (!b || !meets(b, rect))) continue;
            for (const key of this._tileKeys(g.F0, shifted(rect, g.rem))) {
                const k = this._keys.get(key);
                if (!k || !k.tile || this._missing.has(key)) return false;
            }
        }
        return true;
    }

    /**
     * After each commit: `fn(G, info)`, `info.frames` the frames whose tracked cells it dirtied,
     * `info.drop` predicates over frame ids whose plates must go (their id now means another place),
     * `info.reset` every plate must go (another document). Returns the unsubscribe.
     */
    onCommit(fn) { this._commitFns.add(fn); return () => this._commitFns.delete(fn); }

    /**
     * The item deltas since generation G0 — `{added, removed, changed}` with each changed item's
     * previous offset — or null when the log does not reach back that far (rebuild derived state).
     */
    changesSince(G0) {
        if (G0 < this._logFloor) return null;
        const added = new Set(), removed = new Set(), changed = new Map();
        for (const e of this._log) {
            if (e.G <= G0) continue;
            for (const it of e.added) { if (removed.delete(it)) changed.set(it, changed.get(it) || { off: it.off }); else added.add(it); }
            for (const it of e.removed) { if (!added.delete(it)) removed.add(it); changed.delete(it); }
            for (const [it, prev] of e.changed) if (!added.has(it) && !changed.has(it)) changed.set(it, prev);
        }
        return { added: [...added], removed: [...removed], changed: [...changed].map(([item, prev]) => ({ item, off: prev.off })) };
    }

    /** Natives touched (`touch`) at a G after G0, or null when the record does not reach back that far. */
    touchedSince(G0) {
        const out = [];
        let oldest = Infinity;
        for (const [id, G] of this._touchLog) { if (G < oldest) oldest = G; if (G > G0) out.push(id); }
        return this._touchLog.size >= TOUCHED_MAX && oldest > G0 ? null : out;
    }

    /** The G at which native `id`'s shape landed (a plate at or past it paints the shape), or undefined. */
    landedAt(id) { return this._landed.get(id); }

    /**
     * A read-only table for another frame or rectangle, built as a rebuild builds the live one and
     * stamped with the G it was read at; null when a tile was not read inside the budget (the tiles
     * read stay cached, so the next try goes further), or a displaced picture's source frame is not in
     * the lattice yet (the engine mints it at idle, `prepareWanted`). `fresh()`: no commit since has a
     * footprint meeting its rectangle.
     */
    snapshot(frameId, rect, budgetMs = Infinity) {
        const cf = this.lm.frameFor(frameId);
        if (!cf) return null;
        const F = cf.id, G = this.generation;
        const items = [];
        const seen = new Set();
        const offs = new Map();
        // A positive budget reads at least one tile a call (a cold rung goes further every try); 0 is the cache alone.
        const offOf = (nat) => {
            let o = offs.get(nat.id);
            if (o === undefined) { const pl = this.model.placement(nat, F); o = pl ? pl.rem : ZERO; offs.set(nat.id, o); }
            return o;
        };
        const t0 = perfNow();
        const left = () => (budgetMs === Infinity ? Infinity : budgetMs <= 0 ? 0 : Math.max(1e-9, budgetMs - (perfNow() - t0)));
        const d = this.model.displaced(F);
        if (d.missing) { this.store.want(F); return null; }   // a picture's source frame not minted yet: the next action's end, or idle
        const read = this.store.read(F, rect, left());
        if (!read.complete) return null;
        const groups = new Map();
        for (const [gk, g] of d.groups) groups.set(gk, { F0: g.F0, rem: g.rem });
        const reads = [];
        for (const g of groups.values()) {
            const r = this.store.read(g.F0, shifted(rect, g.rem), left());
            if (!r.complete) return null;
            reads.push([g, r]);
        }
        const take = (p, key, grp, off, seq) => {
            if (seen.has(p)) return;
            seen.add(p);
            const it = new Item(this, p);
            const rec = this.doc.getById(p.id);
            it.nat = rec ? rec.obj : null;
            it.key = key; it.grp = grp; it.off = off;
            const t = this._parseKey(key);
            it.si = t.i; it.sj = t.j; it.sd = t.d; it.seq = seq;
            it.zk = zkOf(it);
            items.push(it);
        };
        for (const [key, tile] of read.tiles) {
            tile.objs.forEach((p, k) => {
                if (d.groupOf(p.id) !== undefined) return;
                const rec = this.doc.getById(p.id);
                take(p, key, null, rec ? offOf(rec.obj) : ZERO, k);
            });
        }
        for (const [g, r] of reads) {
            for (const [key, tile] of r.tiles) {
                tile.objs.forEach((p, k) => {
                    const gk = d.groupOf(p.id);
                    if (gk === undefined || groups.get(gk) !== g) return;
                    take(p, key, gk, g.rem, k);
                });
            }
        }
        for (const nat of this.model.nativesIn(F)) {
            const it = new Item(this, nat);
            it.nat = nat; it.off = offOf(nat); it.zk = zkOf(it);
            items.push(it);
        }
        items.sort(cmp);
        const stage = this;
        return {
            frame: F, rect, generation: G,
            items() { return items; },
            placed(item) { return stage.placed(item); },
            covers(fid, r) {
                return String(fid) === F && r.left >= rect.left && r.right <= rect.right && r.top >= rect.top && r.bottom <= rect.bottom;
            },
            fresh() { return stage._dirtIn(F, G, rect) === 0; },
        };
    }

    // ---- freshness (A2 §2.5, §3.1–§3.3) ----

    /**
     * A plate stored, or a job begun, for this cell: from now every commit whose footprint meets `box`
     * (the cell in `frameId`'s units, grown by a device pixel) moves its `dirtySince`. `sinceG`, when
     * older than the current G, is the G the plate's picture was read at: the commits after it are
     * looked up in the dirt log (a snapshot read before a change, A2 §3.3).
     */
    track(key, frameId, box, sinceG) {
        const F = String(frameId);
        let c = this._cells.get(key);
        if (!c) {
            c = { key, frame: F, box, dirty: 0, from: this.generation };
            this._cells.set(key, c);
            let s = this._cellsByFrame.get(F);
            if (!s) this._cellsByFrame.set(F, (s = new Set()));
            s.add(c);
            this.stats.tracked = this._cells.size;
        }
        // `dirty` holds every commit after `from`: only an older `sinceG` reads the log (a RAM-tier key, F161, is re-tracked often).
        if (sinceG != null && sinceG < c.from) {
            const d = this._dirtIn(F, sinceG, box);
            if (d > c.dirty) c.dirty = d;
            c.from = sinceG;
        }
    }

    /** The cell is neither stored nor in flight any more. */
    untrack(key) {
        const c = this._cells.get(key);
        if (!c) return;
        this._cells.delete(key);
        const s = this._cellsByFrame.get(c.frame);
        if (s && s.delete(c) && !s.size) this._cellsByFrame.delete(c.frame);
        this.stats.tracked = this._cells.size;
    }

    /** The largest G of a commit since `track(key)` whose footprint met the cell; 0 if none. */
    dirtySince(key) { const c = this._cells.get(key); return c ? c.dirty : 0; }

    /**
     * The footprints, in `frameId`'s units, of the commits after `sinceG` that meet `box` (everywhere by default): what
     * a partial re-render clips to. A drop's sweep comes cut to `box`, so ask with the cell (F153). Null when the log no
     * longer reaches `sinceG` (re-render the whole cell).
     */
    dirtyRects(frameId, sinceG, box = EVERYWHERE) {
        if (sinceG < this._dirtFloor) return null;
        const F = String(frameId), out = [];
        for (const e of this._dirtLog) {
            if (e.G <= sinceG) continue;
            for (const r of this._entryRects(e, F)) if (meets(r, box)) out.push(r);
            for (const s of e.states) if (s.kind === "sweep") { const r = this._sweepIn(s, F, box); if (r) out.push(r); }
        }
        return out;
    }

    /** The newest commit after `sinceG` whose footprint meets `box` in frame F: its G, 0 if none, the current G if the log does not reach. */
    _dirtIn(F, sinceG, box) {
        if (sinceG < this._dirtFloor) return this.generation;
        let g = 0;
        for (const e of this._dirtLog) if (e.G > sinceG && e.G > g && this._meetsIn(e, F, box)) g = e.G;
        return g;
    }

    /** Native `id` changed what it draws with no document event (the idle fitter's outline): its footprint is dirt. */
    touch(id) {
        const rec = this.doc.getById(id);
        if (!rec) return;
        this._touchLog.delete(id);
        this._touchLog.set(id, this.generation + 1);
        if (this._touchLog.size > TOUCHED_MAX) this._touchLog.delete(this._touchLog.keys().next().value);
        this._after(id, this._stateOf(rec.obj, rec.level));
        this._events++;
        if (!this._batch && !this._sync) this._commit();
    }

    // ---- the drag's hold (A2 §2.7; A1 C2: nothing is written until the drop) ----

    /**
     * A drag begins: the selection's natives and the natives under its frames are held. They are drawn,
     * hit and lassoed at their placement plus the drag's delta (`setDragDelta`); the events about them
     * — the drop's one write — are queued, not applied, until `release`, which applies them and commits
     * once, dirtying where the selection started and where it ends.
     */
    hold({ ids, frames = [] }) {
        if (this._hold) this.release();
        const h = { ids: new Set(ids), frames: frames.map(String), start: [], nat: new Map(), queue: [],
            d: null, dFrame: null, view: false, dVer: 0, dIn: new Map(), homes: new Map() };
        for (const id of h.ids) {
            const rec = this.doc.getById(id);
            if (rec) h.nat.set(id, { s: this._stateOf(rec.obj, rec.level), geom: geomOf(rec.obj), look: lookOf(rec.obj) });
        }
        for (const f of h.frames) { const s = this._frameState(f, null); if (s) h.start.push(s); }
        this._hold = h;
        return h.ids.size + h.frames.length;
    }

    /** Whether a drag's hold stands. */
    get holding() { return !!this._hold; }

    /**
     * The drag's pointer delta `d`, `[dx, dy]` in `frame`'s units (the camera's): the held natives are
     * drawn at their placement plus it. `viewDraws` false: the drag plane draws them, and nothing is
     * committed; true (no plane, or it was lost): the view's plates draw them (`Item.res`), and a change
     * commits, dirtying their boxes where they were drawn and where they are now.
     */
    setDragDelta(d, { frame = this.frame, viewDraws = false } = {}) {
        const h = this._hold;
        if (!h || frame == null) return;
        const F = this.frame, was = h.view ? this._deltaIn(F) : null, wasView = h.view;
        h.d = d && (d[0] || d[1]) ? [d[0], d[1]] : null;
        h.dFrame = String(frame); h.view = !!viewDraws; h.dIn.clear(); h.dVer = ++this._dragVer;
        if (!h.view && !wasView) return;
        const now = h.view ? this._deltaIn(F) : null;
        if (wasView && h.view && sameOff(was || ZERO, now || ZERO)) return;
        for (const s of this._heldStates(was)) this._foot.push(s);
        for (const s of this._heldStates(now)) this._foot.push(s);
        this._events++;
        if (!this._batch && !this._sync) this._commit();
    }

    /**
     * The hold's end (a drop, a cancel, a delete): one commit — where it started, where it ends, and where the view drew
     * it. A held native the view did not draw at a delta, moved by its offsets alone with the geometry it was held with,
     * dirties its boundary pieces' sweep (`_sweepIn`, F153); the rest their boxes before and after.
     */
    release() {
        const h = this._hold;
        if (!h) return 0;
        const drawn = h.view && h.d ? this._heldStates(this._deltaIn(this.frame)) : [];
        this._hold = null;
        this.stats.held += h.queue.length;
        // Past RECTS_MAX natives `_grouped` boxes every sweep, so none is made. A native the drop only moved — its offsets or
        // its home — sweeps; one another event changed keeps its boxes.
        const sweeps = !this.sweepOff && !drawn.length && h.ids.size <= RECTS_MAX, moved = new Map();
        for (const { ev } of h.queue) {
            if (h.ids.has(ev.id)) moved.set(ev.id, moved.get(ev.id) !== false && (ev.kind === "change" ? !!ev.offsetsOnly : ev.kind === "remove" || ev.kind === "add"));
        }
        this.batch(() => {
            for (const s of drawn) this._foot.push(s);
            this._quiet++;
            try { for (const q of h.queue) this._applyDoc(q.ev, q.step); } finally { this._quiet--; }
            for (const s of h.start) this._foot.push(s);
            for (const id of h.ids) {
                this._touched.add(id);
                const rec = this.doc.getById(id), was = h.nat.get(id);
                const now = rec ? this._stateOf(rec.obj, rec.level) : null;
                const boxes = sweeps && was && now && moved.get(id) !== false && was.geom && geomOf(rec.obj) === was.geom && lookOf(rec.obj) === was.look
                    ? sweepBoxes(rec.obj) : null;
                if (boxes) {
                    this._foot.push({ kind: "sweep", s0: was.s, s1: now, boxes, bytes: boxes.reduce((n, L) => n + L.byteLength, 0), maps: null });
                    this.stats.swept++;
                } else {
                    if (was) this._foot.push(was.s);
                    if (now) this._foot.push(now);
                }
                // The held pieces are the drag's start; the tiles hold its end.
                for (const it of this.itemsOf(id)) if (it.key !== "own") this._removeItem(it);
                const tiles = this.store.tilesOf(id);
                if (tiles) for (const key of tiles) if (this._keys.has(key)) this._touched.add("k:" + key);
            }
            for (const f of h.frames) {
                const s = this._frameState(f, null);
                if (s) this._foot.push(s);
                this._info.drop.push((G) => this.lm.frame(f) != null && this.lm.isUnder(f, G));
            }
            this._events++;
        });
        return h.queue.length;
    }

    /** The drag's delta in frame F's units, or null. */
    _deltaIn(F) {
        const h = this._hold;
        if (!h || !h.d || F == null) return null;
        if (String(F) === h.dFrame) return h.d;
        let v = h.dIn.get(String(F));
        if (v === undefined) {
            const a = this.lm.mapPointF([0, 0], h.dFrame, String(F)), b = this.lm.mapPointF(h.d, h.dFrame, String(F));
            v = a && b ? [b[0] - a[0], b[1] - a[1]] : null;
            h.dIn.set(String(F), v);
        }
        return v;
    }

    /** Whether frame `home` is a held frame or under one (memoised for the hold: the lattice stands still until the drop). */
    _underHeld(home) {
        const h = this._hold;
        if (home == null || !h.frames.length) return false;
        const k = String(home);
        let v = h.homes.get(k);
        if (v === undefined) {
            v = false;
            for (const root of h.frames) if (k === root || this.lm.isUnder(root, k)) { v = true; break; }
            h.homes.set(k, v);
        }
        return v;
    }

    /** Whether a native is held: selected by id, or homed under a held frame. */
    _heldNat(nat) {
        const h = this._hold;
        return !!nat && (h.ids.has(nat.id) || this._underHeld(this.model.homeOf(nat)));
    }

    /** Whether a table item is held (a snapshot's items are other frames' and never are). */
    _heldItem(it) {
        const h = this._hold;
        return it.live && (h.ids.has(it.id) || this._underHeld(this._homeOf.get(it.id)));
    }

    /** An item's offset as drawn: a held item's with the drag's delta. */
    _drawnOff(it) {
        const d = this._heldItem(it) ? this._deltaIn(this.frame) : null;
        return d ? [it.off[0] + d[0], it.off[1] + d[1]] : it.off;
    }

    /** The offset paint applies (`Item.res`): the drawn one while the view draws the hold, one array per delta. */
    _paintOff(it) {
        const h = this._hold;
        if (!h.view || !h.d || !this._heldItem(it)) return it.off;
        const c = it._drag;
        if (c && c.ver === h.dVer && c.base === it.off) return c.off;
        const off = this._drawnOff(it);
        it._drag = { ver: h.dVer, base: it.off, off };
        return off;
    }

    /** The held items' boxes in the camera frame, drawn at their offset plus `d` (null: at rest), as footprint states. */
    _heldStates(d) {
        const h = this._hold, F = this.frame, out = [];
        if (!h || F == null) return out;
        const dx = d ? d[0] : 0, dy = d ? d[1] : 0;
        const add = (id) => {
            const s = this._byId.get(id);
            if (!s) return;
            for (const it of s) {
                const b = this._itemBox(it);
                out.push({ home: F, table: undefined, rect: { left: b.left + dx, top: b.top + dy, right: b.right + dx, bottom: b.bottom + dy } });
            }
        };
        for (const id of h.ids) add(id);
        if (h.frames.length) for (const [home, ids] of this._byHome) if (this._underHeld(home)) for (const id of ids) if (!h.ids.has(id)) add(id);
        return out;
    }

    /** An event the hold answers for: a held native's, or one about a frame under a held frame. */
    _held(ev) {
        const h = this._hold;
        if (ev.id != null && h.ids.has(ev.id)) return true;
        if (!h.frames.length) return false;
        const at = ev.kind === "refile" ? ev.frame : ev.level;
        if (at == null) return false;
        for (const root of h.frames) if (String(at) === root || this.lm.isUnder(root, String(at))) return true;
        return false;
    }

    // ---- the camera's table ----

    /**
     * Make the table the camera frame's over `window` (A2 §2.11, §2.12): a crossing rebuilds, a
     * window change adds and drops tiles, what an event dropped is read again. Tiles are read until
     * `budgetMs` is spent; what is not read yet is not covered. The tiles it watches are the tile
     * store's camera pins. A sync that changed nothing commits nothing: G moves only with the table.
     */
    sync(frameId, window, budgetMs = Infinity) {
        const cf = this.lm.frameFor(frameId);
        if (!cf || !window) return;
        const F = cf.id;
        this.stats.syncs++;
        const t0 = perfNow();
        const left = () => (budgetMs === Infinity ? Infinity : Math.max(0, budgetMs - (perfNow() - t0)));
        let rebuilt = false;
        this._sync++;
        try {
            if (this._need || F !== this.frame) { this._rebuild(F, window, left()); rebuilt = true; }
            else if (!sameRect(window, this.window)) this._setWindow(window);
            this._drainQueue();
            this._settle();
            this._readMissing(left());
        } finally { this._sync--; }
        this._drainQueue();
        if (this._pinnedVer !== this._keysVer) { this._pinnedVer = this._keysVer; this.store.setCameraPins(this._keys.keys()); }
        if (!this._batch && (rebuilt || this._owed())) this._commit();
    }

    /** An event applied or the table changed since the last commit. */
    _owed() {
        return !!(this._logCur || this._events || this._foot.length || this._batchFoot.size || this._landing.length
            || this._info.drop.length || this._info.reset);
    }

    /** Every event of `fn` is one commit (a drop, an undo, a delete, a load: A2 §2.5). */
    batch(fn) {
        this._batch++;
        try { return fn(); } finally { if (--this._batch === 0 && !this._sync) this._commit(); }
    }

    /** Where group `g`'s natives are drawn in the camera frame, their boxes' union (null: none is); kept until a member changes (`_reconcile`). */
    _groupBox(g) {
        if (g.box !== undefined) return g.box;
        let b = null;
        for (const id of g.ids) {
            const rec = this.doc.getById(id);
            const r = rec && this.placeNative(rec.obj, this.frame).box();
            if (!r) continue;
            b = b ? { left: Math.min(b.left, r.left), top: Math.min(b.top, r.top), right: Math.max(b.right, r.right), bottom: Math.max(b.bottom, r.bottom) }
                : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
        g.box = b;
        return b;
    }

    /** The frames the table's reroute groups read moved natives' pictures from: frame GC keeps them (OPEN-FLAGS F139). */
    sourceFrames() {
        const out = new Set();
        for (const g of this._groups.values()) out.add(String(g.F0));
        return out;
    }

    /** Frame GC forgot a frame (A2 §2.8): its tracked cells go; its tiles went with events; the reroute is re-diffed at the next commit. */
    forgetFrame(id) {
        const s = this._cellsByFrame.get(String(id));
        if (s) for (const c of [...s]) this.untrack(c.key);
        this._wide = true;
    }

    // ---- events ----

    _onDoc(ev) {
        const step = this._stepOf(ev);
        if (this._hold && ev.kind !== "reset" && this._held(ev)) { this._hold.queue.push({ ev, step }); return; }
        if (this._sync) { this._queue.push({ ev, step }); this.stats.queued++; return; }
        this._applyDoc(ev, step);
        if (!this._batch) this._commit();
    }

    /**
     * An erase step's class, taken as its event arrives (A2 §4.5, PLAN §5.3 A2-Q2): the event names
     * the mark whose bake it is (`by`) and the rule says whether that mark hid the object. A cut or a
     * descent on an object of the mark's lineage dirties the object's box inside the mark's box, and
     * its dust boxes whole; a refusal over ink the same; a graze or an inkless refusal nothing, and so
     * a frame the mark covers whole, set aside inside its landing's box. Null: an ordinary event.
     */
    _stepOf(ev) {
        if (ev.by == null) return null;
        const rec = this.doc.getById(ev.by);
        if (!rec || !rec.obj.erase) return null;
        const M = rec.obj, k = ev.kind;
        if (k === "removeFrame" || k === "addFrame") return NO_DIRT;
        if (k === "change" && ev.attrOnly) return ev.inkless ? NO_DIRT : { clip: this._stateOf(M, rec.level), dust: null };
        if ((k === "add" || k === "remove") && ev.obj && inLineage(ev.obj, M)) return { clip: this._stateOf(M, rec.level), dust: ev.dust || null };
        return null;
    }

    _onTile(ev) {
        if (this._sync) { this._queue.push({ tile: ev }); this.stats.queued++; return; }
        this._applyTile(ev);
    }

    /** Apply what `sync` queued, in order. Returns how many. */
    _drainQueue() {
        const q = this._queue;
        if (!q.length) return 0;
        let n = 0;
        for (let k = 0; k < q.length; k++, n++) {
            const e = q[k];
            if (e.tile) this._applyTile(e.tile); else this._applyDoc(e.ev, e.step);
        }
        q.length = 0;
        return n;
    }

    _applyDoc(ev, step) {
        const k = ev.kind;
        if (!this._quiet) this._footOf(ev, step);
        if (k === "reset") { this._reset(); return; }
        if (ev.id != null) {
            if (k === "add" && ev.live && !ev.rehome) this._pending.add(ev.id);
            else if (k === "remove" && !ev.rehome) { this._pending.delete(ev.id); this._landed.delete(ev.id); }
            else if (k === "change" && !ev.offsetsOnly && !ev.attrOnly && ev.obj && ev.obj.type !== "stroke" && this._pending.delete(ev.id)) this._landing.push(ev.id);
        }
        if (this.frame == null) return;
        if (k === "refile" || k === "removeFrame" || k === "addFrame") {
            const X = String(ev.frame);
            if (k === "refile" && this.lm.isUnder(X, this.frame)) { this._need = true; return; }
            if (k !== "refile" && (this.lm.sameCell(X, this.frame) || this.lm.isUnder(X, this.frame))) this._ownDiff();
            if (k === "refile") this._staleUnder(X);
            this._wide = true;
            return;
        }
        if (k === "rekey") { for (const id of ev.ids || []) this._touched.add(id); return; }
        if (ev.id != null) this._touched.add(ev.id);
    }

    _applyTile(ev) {
        if (ev.kind === "clear") {
            for (const key of [...this._byKey.keys()]) this._dropKeyItems(key);
            for (const ks of this._keys.values()) { ks.tile = null; this._missing.add(ks.key); }
            return;
        }
        const ks = this._keys.get(ev.key);
        if (!ks) return;
        if (ev.kind === "bake") { if (ks.tile !== ev.tile) this._install(ks, ev.tile); this._missing.delete(ks.key); return; }
        if (ev.kind === "drop") {
            if (ks.tile !== ev.tile) return;
            this._dropKeyItems(ks.key);
            ks.tile = null;
            this._missing.add(ks.key);
            return;
        }
        if (ks.tile !== ev.tile) return;
        const h = this._hold;
        if (ev.kind === "remove") {
            for (const p of ev.pieces) { if (h && h.ids.has(p.id)) continue; const it = this._byPiece.get(p); if (it) this._removeItem(it); }
        } else if (ev.kind === "append") {
            for (const p of ev.pieces) { const seq = ks.next++; if (!(h && h.ids.has(p.id))) this._place(ks, p, seq); }
        }
    }

    // ---- footprints (A2 §2.5, §2.8) ----

    /** A native's state as a footprint: its home, its picture table (`model.table`), its drawn box in its home's units. */
    _stateOf(o, home, rect = null) {
        return { home: String(home), table: this.model.table(o, home), rect: rect || drawnBox(o, this.store.live) };
    }

    /** A frame's reach at an address (or its own, `addr` null), and optionally everything under `under`. */
    _frameState(f, addr, under = null) {
        const fp = this.model.frameFootprint(addr || f);
        return fp ? { kind: "frame", fp, under } : (under != null ? { kind: "frame", fp: null, under } : null);
    }

    _before(id, s) {
        if (!this._batch) { this._foot.push(s); return; }
        let m = this._batchFoot.get(id);
        if (!m) this._batchFoot.set(id, (m = { before: null, after: null }));
        if (!m.before) m.before = s;
    }

    _after(id, s) {
        if (!this._batch) { this._foot.push(s); return; }
        let m = this._batchFoot.get(id);
        if (!m) this._batchFoot.set(id, (m = { before: null, after: null }));
        m.after = s;
    }

    /** One event's footprint states, before and after (A2 §2.8's table); an erase step's per `_stepOf`. */
    _footOf(ev, step) {
        const k = ev.kind;
        this._events++;
        if (k === "reset") { this._info.reset = true; return; }
        if (step) { this.stats.neutral++; this._neutralEvents++; }
        if (step === NO_DIRT) return;
        const clip = step ? step.clip : null;
        const with_ = (s) => (clip ? { ...s, clip } : s);
        if (step && step.dust && ev.obj) {
            for (const d of step.dust) this._foot.push({ home: String(ev.level), table: this.model.table(ev.obj, ev.level), rect: { left: d[0], top: d[1], right: d[2], bottom: d[3] } });
        }
        if (k === "refile") {
            for (const a of [ev.from, ev.to]) { if (!a || a.parent == null) continue; const s = this._frameState(ev.frame, a); if (s) this._foot.push(s); }
            const X = String(ev.frame);
            this._info.drop.push((G) => this.lm.isUnder(X, G));
            return;
        }
        if (k === "removeFrame" || k === "addFrame") {
            if (!ev.count) return;
            const s = this._frameState(String(ev.frame), ev.at || null, String(ev.frame));   // a deleted frame's address rides the event
            if (s) this._foot.push(s);
            return;
        }
        if (k === "rekey") {
            for (const id of ev.ids || []) { const rec = this.doc.getById(id); if (rec) this._after(id, this._stateOf(rec.obj, rec.level)); }
            return;
        }
        const o = ev.obj;
        if (!o || ev.id == null) return;
        const pending = this._pending.has(ev.id);
        if (k === "add") {
            if ((ev.live && !ev.rehome) || pending) return;
            this._after(ev.id, with_(this._stateOf(o, ev.level)));
        } else if (k === "remove") {
            if (pending) return;
            this._before(ev.id, with_(this._stateOf(o, ev.level)));
        } else if (k === "change") {
            const now = this._stateOf(o, ev.level);
            if (ev.offsetsOnly) { this._before(ev.id, { ...now, table: this.model.tableBefore(ev) }); this._after(ev.id, now); return; }
            if (ev.attrOnly) { this._after(ev.id, with_(now)); return; }
            if (ev.oldBbox) {
                const b = ev.oldBbox, h = o.type === "fill" ? 0 : Math.max(ev.oldLw || 0, o.lwFrame || 0) / 2;
                this._before(ev.id, with_({ ...now, rect: { left: b.x0 - h, top: b.y0 - h, right: b.x1 + h, bottom: b.y1 + h } }));
            }
            this._after(ev.id, with_(now));
        }
    }

    /** Past RECTS_MAX states, one union state per (home, table): natives moved together map as one box; a sweep is its two boxes. */
    _grouped(states) {
        if (states.length <= RECTS_MAX) return states;
        const out = [], groups = new Map();
        const add = (s) => {
            const k = s.home + "|" + tableKey(s.table);
            const g = groups.get(k);
            if (!g) groups.set(k, { home: s.home, table: s.table, rect: { ...s.rect } });
            else g.rect = unionOf(g.rect, s.rect);
        };
        for (const s of states) {
            if (s.kind === "sweep") { add(s.s0); add(s.s1); continue; }
            if (s.kind === "frame" || s.clip) { out.push(s); continue; }
            add(s);
        }
        for (const g of groups.values()) out.push(g);
        return out;
    }

    /** A commit's footprint states but its sweeps (asked per box, `_sweepIn`) in frame G's units; past RECTS_MAX, their one union box. */
    _rectsIn(states, G) {
        const out = [];
        for (const s of states) { if (s.kind === "sweep") continue; const r = this._mapState(s, G); if (r) out.push(r); }
        if (out.length <= RECTS_MAX) return out;
        let u = null;
        for (const r of out) u = unionOf(u, r);
        return [u];
    }

    /** Logged commit `e`'s footprints but its sweeps in frame F (`_rectsIn`), kept for the lattice they were mapped in. */
    _entryRects(e, F) {
        const k = e.G + "|" + F, lat = this._latKey(), memo = this._rectsMemo;
        let v = memo.get(k);
        if (v && v.lat === lat && v.states === e.states) { memo.delete(k); memo.set(k, v); return v.rects; }
        v = { lat, states: e.states, rects: this._rectsIn(e.states, F) };
        memo.delete(k);
        memo.set(k, v);
        if (memo.size > RECTS_KEPT) memo.delete(memo.keys().next().value);
        return v.rects;
    }

    /** Whether logged commit `e`'s footprint meets `box` in frame F. */
    _meetsIn(e, F, box) {
        for (const r of this._entryRects(e, F)) if (meets(r, box)) return true;
        for (const s of e.states) if (s.kind === "sweep" && this._sweepIn(s, F, box, true)) return true;
        return false;
    }

    /**
     * Sweep `s`'s placement mappers into frame G, before and after, its whole boxes there, and its tree's hulls there as
     * queries map them (`H`, a level each); kept for the lattice they were made in, for SWEEP_MAPS frames.
     */
    _sweepMap(s, G) {
        const lat = this._latKey(), maps = s.maps || (s.maps = new Map());
        let m = maps.get(G);
        if (m && m.lat === lat) return m;
        if (m) this._unmap(s, m);
        const m0 = this.model.footprintMapper(s.s0, G), m1 = this.model.footprintMapper(s.s1, G), a = s.s0.rect, b = s.s1.rect;
        m = { lat, m0, m1, A: m0 && m0(a.left, a.top, a.right, a.bottom), B: m1 && m1(b.left, b.top, b.right, b.bottom), H: [], P: {}, Q: {} };
        maps.delete(G);
        maps.set(G, m);
        if (maps.size > SWEEP_MAPS) { const k0 = maps.keys().next().value; this._unmap(s, maps.get(k0)); maps.delete(k0); }
        return m;
    }

    /** A sweep's mapping into one frame let go: its hulls' bytes. */
    _unmap(s, m) {
        let n = 0;
        for (const Hk of m.H) if (Hk) n += Hk.byteLength;
        s.bytes -= n; this._sweepBytes -= n;
    }

    /** Node (k, i) of sweep `s`'s tree in the frame `m` maps into, where it was and where it is, the two united: into `out` (kept in `m.H`). */
    _hull(s, m, k, i, out) {
        const L = s.boxes[k], o = i * 4;
        let Hk = m.H[k];
        if (!Hk && this._sweepBytes + L.byteLength <= SWEEP_BYTES_MAX) {
            Hk = m.H[k] = new Float64Array(L.length).fill(NaN);
            s.bytes += L.byteLength; this._sweepBytes += L.byteLength;
        }
        if (Hk && !Number.isNaN(Hk[o])) { out.left = Hk[o]; out.top = Hk[o + 1]; out.right = Hk[o + 2]; out.bottom = Hk[o + 3]; return out; }
        const P = m.m0(L[o], L[o + 1], L[o + 2], L[o + 3], m.P), Q = m.m1(L[o], L[o + 1], L[o + 2], L[o + 3], m.Q);
        out.left = Math.min(P.left, Q.left); out.top = Math.min(P.top, Q.top); out.right = Math.max(P.right, Q.right); out.bottom = Math.max(P.bottom, Q.bottom);
        if (Hk) { Hk[o] = out.left; Hk[o + 1] = out.top; Hk[o + 2] = out.right; Hk[o + 3] = out.bottom; }
        return out;
    }

    /**
     * A dropped native's dirt in frame G that meets `box` (F153): each boundary piece boxed where it was and where it is,
     * the two united — between two scale-and-translate placements every changed pixel lies in the boundary's sweep — and
     * cut to the native's whole box before or after (a far move: those boxes). The piece tree is descended from its root,
     * so only the pieces near `box` are mapped. Returns the union of what meets `box`, cut to it, or null — a node inside
     * `box` taken whole, its pieces' cuts lying in its own (more, never less) — and with `any`, exactly whether anything
     * does. A side that does not map into G is its whole box.
     */
    _sweepIn(s, G, box, any = false) {
        const m = this._sweepMap(s, G), { m0, m1, A, B } = m;
        const inA = !!A && meets(A, box), inB = !!B && meets(B, box);
        if (!inA && !inB) return any ? false : null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const take = (h, X) => {
            const u0 = Math.max(h.left, X.left, box.left), v0 = Math.max(h.top, X.top, box.top);
            const u1 = Math.min(h.right, X.right, box.right), v1 = Math.min(h.bottom, X.bottom, box.bottom);
            if (u0 > u1 || v0 > v1) return false;
            if (u0 < x0) x0 = u0;
            if (v0 < y0) y0 = v0;
            if (u1 > x1) x1 = u1;
            if (v1 > y1) y1 = v1;
            return true;
        };
        let hit = false;
        if (!m0 || !m1) hit = !!((inA && take(EVERYWHERE, A)) | (inB && take(EVERYWHERE, B)));
        else {
            const lv = s.boxes, h = {}, stack = [lv.length - 1, 0];
            while (stack.length) {
                const i = stack.pop(), k = stack.pop();
                if (!meets(this._hull(s, m, k, i, h), box)) continue;
                if (k > 0 && (any || !inside(h, box))) {
                    if (i * 2 + 1 < lv[k - 1].length / 4) stack.push(k - 1, i * 2 + 1);
                    stack.push(k - 1, i * 2);
                    continue;
                }
                if ((inA && take(h, A)) | (inB && take(h, B))) {
                    if (any) return true;
                    hit = true;
                }
            }
        }
        if (any) return hit;
        return hit ? { left: x0, top: y0, right: x1, bottom: y1 } : null;
    }

    /** `_sweepIn(s, G, c.box, true)` for each cell of `cells` not hit yet, in one descent of the tree (a commit's dirt): sets `hit[k]`. */
    _sweepCells(s, G, cells, hit) {
        const m = this._sweepMap(s, G), { m0, m1, A, B } = m, near = [];
        for (let k = 0; k < cells.length; k++) if (!hit[k] && ((A && meets(A, cells[k].box)) || (B && meets(B, cells[k].box)))) near.push(k);
        if (!near.length) return;
        if (!m0 || !m1) { for (const k of near) hit[k] = 1; return; }
        const lv = s.boxes, h = {}, stack = [[lv.length - 1, 0, near]];
        const cut = (X, b) => !!X && Math.max(h.left, X.left, b.left) <= Math.min(h.right, X.right, b.right)
            && Math.max(h.top, X.top, b.top) <= Math.min(h.bottom, X.bottom, b.bottom);
        while (stack.length) {
            const [k, i, ks] = stack.pop();
            this._hull(s, m, k, i, h);
            const on = ks.filter((c) => !hit[c] && meets(h, cells[c].box));
            if (!on.length) continue;
            if (k > 0) {
                if (i * 2 + 1 < lv[k - 1].length / 4) stack.push([k - 1, i * 2 + 1, on]);
                stack.push([k - 1, i * 2, on]);
                continue;
            }
            for (const c of on) if (cut(A, cells[c].box) || cut(B, cells[c].box)) hit[c] = 1;
        }
    }

    _mapState(s, G) {
        if (s.kind === "frame") {
            if (s.under != null && this.lm.frame(s.under) && this.lm.isUnder(s.under, G)) return EVERYWHERE;
            return s.fp ? this.model.footprint({ home: s.fp.frame, table: undefined, rect: s.fp.rect }, G) : null;
        }
        const r = this.model.footprint(s, G);
        if (!r || !s.clip) return r;
        const c = this.model.footprint(s.clip, G);
        if (!c || !meets(r, c)) return null;
        return { left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) };
    }

    // ---- commits ----

    /** The end of one commit: what it named placed again, the family rule, its dirt, then G and the listeners. */
    _commit() {
        this._settle();
        const G = this.generation + 1;
        this._families();
        const states = this._foot;
        for (const m of this._batchFoot.values()) { if (m.before) states.push(m.before); if (m.after) states.push(m.after); }
        const info = this._info;
        if (states.length) this._dirt(G, states, info.frames);
        this._foot = [];
        this._batchFoot.clear();
        this._info = { frames: new Set(), drop: [], reset: false };
        this._events = this._neutralEvents = 0;
        this.generation = G;
        for (const id of this._landing) {
            this._landed.set(id, G);
            if (this._landed.size > LANDED_MAX) this._landed.delete(this._landed.keys().next().value);
        }
        this._landing.length = 0;
        if (info.reset) { this._cells.clear(); this._cellsByFrame.clear(); this._famTraits.clear(); this.stats.tracked = 0; }
        this.stats.commits++;
        this.stats.items = this._list.size;
        this._closeLog();
        for (const fn of this._commitFns) fn(G, info);
    }

    /** The named natives placed again and, after a frame event or a lattice change, the reroute re-diffed. */
    _settle() {
        if (this.frame == null || this._need) { this._touched.clear(); this._wide = false; return; }
        const lat = this._latKey();
        if (lat !== this._lat) { this._lat = lat; this._wide = true; }
        if (this._wide) this._rerouteDiff();
        if (!this._touched.size) return;
        const ids = [...this._touched];
        this._touched.clear();
        const d = this.doc.hasOffsets() || this._gOf.size ? this.model.displaced(this.frame) : null;
        const refresh = new Set();
        for (const id of ids) {
            if (typeof id === "string" && id.startsWith("k:")) refresh.add(id.slice(2));
            else this._reconcile(id, d, refresh);
        }
        for (const key of refresh) this._refreshKey(key);
    }

    /** Set `dirtySince` on every tracked cell the commit's footprints meet (a sweep's asked for each cell), and log them. */
    _dirt(G, states, frames) {
        states = this._grouped(states);
        const entry = { G, states };
        this._dirtLog.push(entry);
        this._sweepBytes += sweepBytesOf(states);
        while (this._dirtLog.length > DIRT_LOG_MAX) { const e = this._dirtLog.shift(); this._dirtFloor = e.G; this._sweepBytes -= sweepBytesOf(e.states); }
        if (this._sweepBytes > SWEEP_BYTES_MAX) this._trimSweeps();
        const sweeps = states.filter((s) => s.kind === "sweep");
        for (const [F, cells] of this._cellsByFrame) {
            const rects = this._entryRects(entry, F);
            if (!rects.length && !sweeps.length) continue;
            const cs = [...cells], hit = new Uint8Array(cs.length);
            for (let k = 0; k < cs.length; k++) if (rects.some((r) => meets(r, cs[k].box))) hit[k] = 1;
            for (const s of sweeps) this._sweepCells(s, F, cs, hit);
            for (let k = 0; k < cs.length; k++) {
                if (!hit[k]) continue;
                if (cs[k].dirty < G) { cs[k].dirty = G; this.stats.dirtied++; }
                frames.add(F);
            }
        }
    }

    /** Past SWEEP_BYTES_MAX the oldest commits' sweeps become their boxes before and after: more dirt for questions about them, never less. */
    _trimSweeps() {
        for (const e of this._dirtLog) {
            if (this._sweepBytes <= SWEEP_BYTES_MAX) return;
            const n = sweepBytesOf(e.states);
            if (!n) continue;
            this._sweepBytes -= n;
            e.states = e.states.flatMap((s) => (s.kind === "sweep" ? [s.s0, s.s1] : [s]));
        }
    }

    /**
     * PLAN §5.1 Q15: a family whose items changed and whose union routing, sign, colour or alpha the
     * change flipped repaints every item — its whole box is dirt (measured: 462 px median, 771 max,
     * up to 38/255, on the untouched pieces of a flipped family). A stroke family counts as flipped
     * whenever its items change; an erase step under its mark is exempt (its mask hides the family).
     */
    _families() {
        const before = this._famBefore;
        if (!before.size) return;
        this._famBefore = new Map();
        if (!this._cells.size) { this._famTraits.clear(); return; }
        for (const [fk, b] of before) {
            const s = this._byFam.get(fk), n = s ? s.size : 0;
            if (n < 2) this._famTraits.delete(fk);
            if (n === 0 || b.n === 0 || n + b.n < 3) continue;       // gone, new, or one item either side
            const t = this._traitsOf(s);
            if (n >= 2) this._famTraits.set(fk, t);
            if (this._events && this._events === this._neutralEvents) continue;
            const was = b.n >= 2 ? b.traits : this._traitsOf([b.single]);
            if (t && was && sameTraits(t, was)) continue;
            this.stats.familyFlips++;
            let box = b.box;
            for (const it of s) box = unionOf(box, this._itemBox(it));
            if (box) this._foot.push({ home: this.frame, table: undefined, rect: box });
        }
    }

    /** The family's traits as the pack decides them, over its items in paint order; null for a stroke family. */
    _traitsOf(items) {
        return this.cfg ? familyTraits([...items].sort(cmp), this.cfg) : null;
    }

    _itemBox(it) {
        const b = it.box, o = it.off;
        return { left: b.left + o[0], top: b.top + o[1], right: b.right + o[0], bottom: b.bottom + o[1] };
    }

    /**
     * The first time a commit touches a family: its traits and box as they were, for `_families`. A
     * family of one item keeps that item instead (routing needs two; its traits are taken only if the
     * family grows).
     */
    _famTouch(fk) {
        if (this._famBefore.has(fk) || !this._cells.size || this._fillTo) return;
        const s = this._byFam.get(fk), n = s ? s.size : 0;
        const single = n === 1 ? s.values().next().value : null;
        let box = null;
        if (n >= 2) for (const it of s) box = unionOf(box, this._itemBox(it));
        const traits = n >= 2 ? (this._famTraits.has(fk) ? this._famTraits.get(fk) : this._traitsOf(s)) : undefined;
        this._famBefore.set(fk, { traits, single, box: single ? this._itemBox(single) : box, n });
    }

    // ---- building ----

    _reset() {
        this._need = true;
        this._pending.clear();
        this._landed.clear();
        this._touched.clear();
        this._wide = false;
        if (this._hold) this._hold = null;
        this._clearTable();
        this._logFloor = this.generation + 1;
        this._log.length = 0;
    }

    _clearTable() {
        for (const it of this._list.toArray()) it.live = false;
        this._list.clear();
        this._byId.clear(); this._byKey.clear(); this._byPiece.clear(); this._byHome.clear(); this._homeOf.clear();
        this._byFam.clear(); this._famTraits.clear(); this._famBefore.clear();
        this._own.clear(); this._keys.clear(); this._keysVer++; this._winKeys.clear(); this._groups.clear(); this._gOf.clear();
        this._winRange = null;
        this._missing.clear();
    }

    /** The table for frame F from scratch: its own natives, its window tiles, its reroute groups. */
    _rebuild(F, window, budgetMs) {
        this.stats.rebuilds++;
        this._clearTable();
        this._logFloor = this.generation + 1;
        this._log.length = 0;
        this.frame = F; this.window = { ...window };
        this._need = false;
        this._lat = this._latKey();
        const d = this.model.displaced(F);
        this._dRev = d.rev;
        for (const [gk, g] of d.groups) {
            const grp = { gk, F0: String(g.F0), rem: g.rem, ids: new Set(), keys: new Set() };
            this._groups.set(gk, grp);
        }
        for (const [gk, g] of d.groups) for (const id of g.ids) { this._gOf.set(id, gk); this._groups.get(gk).ids.add(id); }
        const batch = [];
        this._fillTo = batch;
        try {
            this._winRange = this.lm.tileRange(F, window);
            for (const key of this._rangeKeys(F, this._winRange)) { this._watch(key).win = true; this._winKeys.add(key); this._missing.add(key); }
            for (const g of this._groups.values()) this._watchGroup(g);
            this._readMissing(budgetMs);
            for (const nat of this.model.nativesIn(F)) if (!this._byPiece.has(nat)) this._setOwn(nat);
        } finally { this._fillTo = null; }
        const keep = [], seen = new Set();
        for (const it of batch) if (it.live && !seen.has(it)) { seen.add(it); keep.push(it); }
        this._list.fill(keep);
        // The families as the plates packed from here will see them.
        if (this._cells.size) for (const [fk, s] of this._byFam) this._famTraits.set(fk, this._traitsOf(s));
    }

    /**
     * A window change: tiles that left go, tiles that entered are read (A2 §2.12). A tile range that did not change has
     * the same keys, so it is skipped: a step changes none of them unless it crosses a tile line (OPEN-FLAGS F150).
     */
    _setWindow(window) {
        this.window = { ...window };
        const r = this.lm.tileRange(this.frame, window);
        if (!sameRange(r, this._winRange)) {
            this._winRange = r;
            const next = new Set(this._rangeKeys(this.frame, r));
            for (const key of this._winKeys) {
                if (next.has(key)) continue;
                const ks = this._keys.get(key);
                if (ks) { ks.win = false; this._retire(ks); }
            }
            for (const key of next) {
                if (this._winKeys.has(key)) continue;
                const ks = this._watch(key);
                ks.win = true;
                if (ks.tile) this._refreshKey(key); else this._missing.add(key);
            }
            this._winKeys = next;
        }
        for (const g of this._groups.values()) this._watchGroup(g);
    }

    /** A group's tiles over the window shifted back by its remainder; the ones it no longer needs are let go. */
    _watchGroup(g) {
        const r = this.lm.tileRange(g.F0, shifted(this.window, g.rem));
        if (sameRange(r, g.range)) return;
        g.range = r;
        const next = new Set(this._rangeKeys(g.F0, r));
        for (const key of g.keys) {
            if (next.has(key)) continue;
            const ks = this._keys.get(key);
            if (ks) { ks.groups.delete(g.gk); this._retire(ks); }
        }
        for (const key of next) {
            if (g.keys.has(key)) continue;
            const ks = this._watch(key);
            ks.groups.add(g.gk);
            if (ks.tile) this._refreshKey(key); else this._missing.add(key);
        }
        g.keys = next;
    }

    /** Read every watched tile listed missing, within the budget. */
    _readMissing(budgetMs) {
        if (!this._missing.size) return;
        const cells = [];
        for (const key of this._missing) {
            const ks = this._keys.get(key);
            if (ks) cells.push([ks.frame, ks.d ? "down" : "up", ks.i, ks.j]);
            else this._missing.delete(key);
        }
        if (!cells.length) return;
        this.stats.reads++;
        const got = this.store.readTiles(cells, budgetMs);
        this.stats.missed += got.missing.length;
        for (const [key, tile] of got.tiles) {
            const ks = this._keys.get(key);
            if (!ks) continue;
            this._missing.delete(key);
            if (ks.tile !== tile) this._install(ks, tile);
        }
    }

    _latKey() { return this.lm.addrEpoch + "|" + this.lm.frames.size; }

    // ---- the reroute (A2 §2.10) ----

    /** Every native whose group moved since the last diff, placed again; groups made and let go. */
    _rerouteDiff() {
        this._wide = false;
        this._lat = this._latKey();
        const d = this.model.displaced(this.frame);
        if (d.rev === this._dRev) return;
        this._dRev = d.rev;
        this.stats.rerouteDiffs++;
        const refresh = new Set();
        const ids = new Set(this._gOf.keys());
        for (const g of d.groups.values()) for (const id of g.ids) ids.add(id);
        for (const id of ids) if (this._gOf.get(id) !== d.groupOf(id)) this._reconcile(id, d, refresh);
        for (const key of refresh) this._refreshKey(key);
    }

    /**
     * One native, placed again against the document as it is: its own item, its reroute group, its
     * offset, its paint key and its family. The tiles whose items must follow are added to `refresh`.
     */
    _reconcile(id, d, refresh) {
        if (this._hold && this._hold.ids.has(id)) return;
        const rec = this.doc.getById(id);
        const nat = rec ? rec.obj : null;
        // Its own item: a native the model draws live in the camera's frame (A1 C1: its home, or where its picture carried).
        const own = this._own.get(id);
        if (nat && this.model.drawnLive(nat, this.frame)) {
            if (!own || own.piece !== nat) { if (own) this._removeItem(own); this._setOwn(nat); }
        } else if (own) this._removeItem(own);
        // Its group (whose box it is part of).
        const was = this._gOf.get(id);
        const now = nat && d ? d.groupOf(id) : undefined;
        for (const gk of [was, now]) { const g = gk !== undefined && this._groups.get(gk); if (g) g.box = undefined; }
        if (was !== now) {
            if (was !== undefined) {
                this._gOf.delete(id);
                const g = this._groups.get(was);
                if (g) {
                    g.ids.delete(id);
                    for (const key of g.keys) refresh.add(key);
                    if (!g.ids.size) this._dropGroup(g);
                }
            }
            if (now !== undefined) {
                this._gOf.set(id, now);
                let g = this._groups.get(now);
                if (!g) {
                    const src = d.groups.get(now);
                    g = { gk: now, F0: String(src.F0), rem: src.rem, ids: new Set(), keys: new Set(), box: undefined };
                    this._groups.set(now, g);
                    g.ids.add(id);
                    this._watchGroup(g);
                } else g.ids.add(id);
                for (const key of g.keys) refresh.add(key);
            }
            const tiles = this.store.tilesOf(id);
            if (tiles) for (const key of tiles) if (this._winKeys.has(key)) refresh.add(key);
        }
        // Its offset, its paint key and its family, on every item it has.
        const items = this._byId.get(id);
        if (!items || !items.size) return;
        const off = nat ? this._offOf(nat) : ZERO;
        const zk = nat ? (nat.z != null ? nat.z : nat.id) : null;
        const fk = nat ? (nat.editId != null ? nat.editId : nat.id) : null;
        for (const it of [...items]) {
            const want = it.grp != null ? this._groups.get(it.grp) : null;
            const o = want ? want.rem : off;
            // A new family or paint key is a change `changesSince` reports (the pack's family table keys on both).
            if (fk != null && fk !== it.fk) { this._logChange(it); this._unfile(it); it.fk = fk; this._file(it); }
            if (zk != null && zk !== it.zk) { this._logChange(it); this._list.remove(it); it.zk = zk; if (!sameOff(o, it.off)) this._setOff(it, o); this._list.insert(it); continue; }
            if (!sameOff(o, it.off)) this._setOff(it, o);
        }
    }

    _dropGroup(g) {
        this._groups.delete(g.gk);
        for (const key of g.keys) {
            const ks = this._keys.get(key);
            if (!ks) continue;
            ks.groups.delete(g.gk);
            for (const it of [...(this._byKey.get(key) || [])]) if (it.grp === g.gk) this._removeItem(it);
            this._retire(ks);
        }
        g.keys = new Set();
        g.range = null;
    }

    /** Frames under a re-addressed frame: their watched tiles are stale by `chainSeq`, read again. */
    _staleUnder(X) {
        for (const ks of this._keys.values()) if (this.lm.isUnder(X, ks.frame)) this._missing.add(ks.key);
    }

    /** The camera cell's own natives against the document's lists for it (a frame set aside or put back). */
    _ownDiff() {
        const ids = new Set(this._own.keys());
        for (const o of this.doc.cellList(this.frame)) ids.add(o.id);
        for (const id of ids) this._touched.add(id);
    }

    // ---- tiles ----

    _tileKeys(F, rect) { return this._rangeKeys(F, this.lm.tileRange(F, rect)); }

    /** The tile keys of range `r` of frame F, both directions: one array per (F, r), never to be changed by a caller. */
    _rangeKeys(F, r) {
        const mk = F + "|" + r.i0 + "," + r.i1 + "," + r.j0 + "," + r.j1;
        let out = this._rangeMemo.get(mk);
        if (out) return out;
        out = [];
        for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) for (const dir of DIRS) out.push(F + "|" + dir + "|" + i + "," + j);
        if (this._rangeMemo.size >= RANGE_MEMO_MAX) this._rangeMemo.delete(this._rangeMemo.keys().next().value);
        this._rangeMemo.set(mk, out);
        return out;
    }

    _parseKey(key) {
        const a = key.lastIndexOf("|"), b = key.lastIndexOf("|", a - 1), c = key.indexOf(",", a);
        return { frame: key.slice(0, b), d: key.slice(b + 1, a) === "up" ? 0 : 1, i: +key.slice(a + 1, c), j: +key.slice(c + 1) };
    }

    _watch(key) {
        let ks = this._keys.get(key);
        if (!ks) {
            const t = this._parseKey(key);
            ks = { key, frame: t.frame, i: t.i, j: t.j, d: t.d, tile: null, win: false, groups: new Set(), next: 0 };
            this._keys.set(key, ks);
            this._keysVer++;
        }
        return ks;
    }

    /** A key no role needs any more: its items go, it is no longer watched. */
    _retire(ks) {
        if (ks.win || ks.groups.size) { if (ks.tile) this._refreshKey(ks.key); return; }
        this._dropKeyItems(ks.key);
        this._keys.delete(ks.key);
        this._keysVer++;
        this._missing.delete(ks.key);
    }

    /** A tile read or re-baked: its items are the tile's pieces, in its order (a held native's stay as they were). */
    _install(ks, tile) {
        const h = this._hold;
        const s = this._byKey.get(ks.key);
        if (s) for (const it of [...s]) if (!(h && h.ids.has(it.id))) this._removeItem(it);
        this._missing.delete(ks.key);
        ks.tile = tile;
        ks.next = tile.objs.length;
        const objs = tile.objs;
        for (let k = 0; k < objs.length; k++) if (!(h && h.ids.has(objs[k].id))) this._place(ks, objs[k], k);
    }

    /** The key's items against its tile's pieces and the roles they have now; only differences move. */
    _refreshKey(key) {
        const ks = this._keys.get(key);
        if (!ks || !ks.tile) return;
        const h = this._hold;
        const objs = ks.tile.objs, want = new Set();
        for (let k = 0; k < objs.length; k++) {
            const p = objs[k];
            if (h && h.ids.has(p.id)) continue;
            const role = this._roleOf(ks, p);
            if (role === undefined) continue;
            want.add(p);
            const it = this._byPiece.get(p);
            if (it && it.key === key && it.grp === role) continue;
            if (it) this._removeItem(it);
            this._place(ks, p, k);
        }
        const have = this._byKey.get(key);
        if (have) for (const it of [...have]) if (!want.has(it.piece) && !(h && h.ids.has(it.id))) this._removeItem(it);
    }

    /** Which role a piece of this key is drawn in: null a window piece, a group key, or undefined (not drawn). */
    _roleOf(ks, p) {
        const gk = this._gOf.get(p.id);
        if (gk !== undefined) return ks.groups.has(gk) ? gk : undefined;
        return ks.win ? null : undefined;
    }

    /** One piece of a watched tile into the table, if a role draws it. */
    _place(ks, p, seq) {
        if (this._byPiece.has(p)) return;
        const role = this._roleOf(ks, p);
        if (role === undefined) return;
        const it = this._itemFor(p);
        const rec = this.doc.getById(p.id);
        it.nat = rec ? rec.obj : null;
        it.key = ks.key; it.grp = role;
        it.si = ks.i; it.sj = ks.j; it.sd = ks.d; it.seq = seq;
        it.off = role != null ? this._groups.get(role).rem : (it.nat ? this._offOf(it.nat) : ZERO);
        it.zk = zkOf(it);
        this._addItem(it);
    }

    _dropKeyItems(key) {
        const s = this._byKey.get(key);
        if (!s) return;
        for (const it of [...s]) this._removeItem(it);
    }

    // ---- items ----

    _itemFor(piece) {
        let it = this._itemOf.get(piece);
        if (!it || it.live) { it = new Item(this, piece); this._itemOf.set(piece, it); }
        return it;
    }

    _setOwn(nat) {
        const it = this._itemFor(nat);
        it.nat = nat; it.key = "own"; it.grp = null;
        it.si = it.sj = it.sd = it.seq = 0;
        it.off = this._offOf(nat);
        it.zk = zkOf(it);
        this._own.set(nat.id, it);
        this._addItem(it);
    }

    /** A native's offset: `placement(nat, F).rem`, one array while it does not change. */
    _offOf(nat) {
        const pl = this.model.placement(nat, this.frame);
        const rem = pl ? pl.rem : ZERO;
        const s = this._byId.get(nat.id);
        if (s) for (const it of s) if (it.grp == null && sameOff(it.off, rem)) return it.off;
        return rem[0] || rem[1] ? [rem[0], rem[1]] : ZERO;
    }

    _setOff(it, off) {
        this._famTouch(it.fk);
        this._logChange(it);
        it.off = off;
    }

    _file(it) {
        let f = this._byFam.get(it.fk);
        if (!f) this._byFam.set(it.fk, (f = new Set()));
        f.add(it);
    }

    _unfile(it) {
        this._famTouch(it.fk);
        const f = this._byFam.get(it.fk);
        if (f && f.delete(it) && !f.size) this._byFam.delete(it.fk);
    }

    _addItem(it) {
        it.live = true;
        it.fk = it.fam;
        this._famTouch(it.fk);
        this._file(it);
        this._byPiece.set(it.piece, it);
        let s = this._byId.get(it.id);
        if (!s) this._byId.set(it.id, (s = new Set()));
        s.add(it);
        if (it.key !== "own") {
            let k = this._byKey.get(it.key);
            if (!k) this._byKey.set(it.key, (k = new Set()));
            k.add(it);
        }
        if (s.size === 1) {
            const home = it.nat ? this.model.homeOf(it.nat) : null;
            this._homeOf.set(it.id, home);
            let h = this._byHome.get(home);
            if (!h) this._byHome.set(home, (h = new Set()));
            h.add(it.id);
        }
        if (this._fillTo) this._fillTo.push(it);
        else { this._list.insert(it); this._logAdd(it); }
    }

    _removeItem(it) {
        if (!it.live) return;
        it.live = false;
        if (!this._fillTo) this._list.remove(it);
        this._unfile(it);
        this._byPiece.delete(it.piece);
        const s = this._byId.get(it.id);
        if (s) {
            s.delete(it);
            if (!s.size) {
                this._byId.delete(it.id);
                const home = this._homeOf.get(it.id);
                this._homeOf.delete(it.id);
                const h = this._byHome.get(home);
                if (h && h.delete(it.id) && !h.size) this._byHome.delete(home);
            }
        }
        if (it.key === "own") { if (this._own.get(it.id) === it) this._own.delete(it.id); }
        else { const k = this._byKey.get(it.key); if (k && k.delete(it) && !k.size) this._byKey.delete(it.key); }
        this._logRemove(it);
    }

    // ---- the delta log ----

    _cur() {
        if (!this._logCur) this._logCur = { G: this.generation + 1, added: [], removed: [], changed: new Map() };
        return this._logCur;
    }
    _logAdd(it) { if (!this._fillTo) this._cur().added.push(it); }
    _logRemove(it) { if (!this._fillTo) this._cur().removed.push(it); }
    _logChange(it) { const c = this._cur(); if (!c.changed.has(it)) c.changed.set(it, { off: it.off }); }
    _closeLog() {
        const c = this._logCur;
        this._logCur = null;
        if (!c) return;
        c.G = this.generation;
        this._log.push(c);
        let n = 0;
        for (const e of this._log) n += e.added.length + e.removed.length + e.changed.size;
        while (n > LOG_MAX && this._log.length > 1) {
            const e = this._log.shift();
            n -= e.added.length + e.removed.length + e.changed.size;
            this._logFloor = e.G;
        }
    }
}

/** `placeNative`'s answer: one native, seen from one frame; `d` the drag's delta in F's units when the native is held. */
class Placement {
    constructor(stage, nat, F, d = null) { this.stage = stage; this.nat = nat; this.F = F; this.d = d; }
    /** Its drawn box (bbox, and half its pen for a stroke) in F's units, where its picture is. */
    box() { return shiftBy(this.stage.model.fromStored(this.nat, this.F, drawnBox(this.nat, this.stage.store.live)), this.d, 1); }
    /** An input made in F — a point, a rect or loops — in the native's stored coordinates. */
    toStored(x) { return this.stage.model.toStored(this.nat, this.F, shiftBy(x, this.d, -1)); }
    /** The native's stored point, rect or loops as drawn in F. */
    fromStored(x) { return shiftBy(this.stage.model.fromStored(this.nat, this.F, x), this.d, 1); }
}

/** A point, a rect or loops translated by `k`·d (x unchanged when there is no d). */
function shiftBy(x, d, k) {
    if (!x || !d) return x;
    const dx = k * d[0], dy = k * d[1];
    if (Array.isArray(x)) return typeof x[0] === "number" ? [x[0] + dx, x[1] + dy] : translateLoops(x, dx, dy);
    return { left: x.left + dx, top: x.top + dy, right: x.right + dx, bottom: x.bottom + dy };
}

function zkOf(it) { const z = it.z; return z != null ? z : it.id; }
function sameRect(a, b) { return !!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom; }
