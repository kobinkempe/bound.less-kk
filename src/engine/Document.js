/**
 * Document — the source of truth. Owns every native object, the global id
 * sequence (id = creation order = global z-order), the undo/redo stacks, and
 * the dev-0 snapshot (de)serialization of the natives. No Two.js, no camera,
 * no tiles.
 *
 * Objects are stored per HOME level (the level they were drawn at). Everything
 * shown at another level is a DERIVED copy carrying the source id, which is why
 * removeById() is enough to erase an object "everywhere".
 *
 * Geometry is immutable BETWEEN EDITS, not forever — the original wording here
 * said "immutable once finalized" and three things break that: `moveById` /
 * `setGeometryById` (a drag), `bakeShapeById` (a stroke becoming its resolved
 * perimeter, in place, keeping its id) and `fillToShapeById` (a legacy polygon
 * promoted at the moment something is about to cut it). Every one of them goes
 * through `_afterEdit`, which is what the invariant actually is:
 * bust the caches attached to the object (`_bbox`/`_dispFlat`/`_flat`/`_outline`),
 * bump `_ver` so anything keyed on its state is stale, reindex, and emit a
 * `change` carrying the OLD footprint so the TileStore can invalidate both where
 * the object was and where it now is.
 *
 * WHAT IS NOT HERE, AND WHY. There is no `restyleById` and no `cutById`.
 * Colour/width/opacity editing of a selection went when the selection style box
 * did (Kobin, 2026-08-03, with multi-select: a lasso can hold objects drawn at
 * wildly different levels and one width slider has no meaning across them), and
 * `select.lasso.test.js` asserts that no path on the engine can reach a restyle.
 * `cutById` was the pre-arc centerline cut, superseded by `eraseReplaceById` —
 * an erase replaces a native with the REGIONS its boolean left, not with pieces
 * of a polyline. Their undo cases went with them.
 *
 * Change events: every mutation (add/remove/insert/clear/load — including the
 * ones replayed by undo/redo) notifies subscribers with the object and its
 * home level, so the TileStore can invalidate BOTH directions (deeper tiles
 * inherit it magnified, coarser tiles inherit it minified). Routing undo/redo
 * through the same add/remove primitives is what guarantees no stale-tile
 * ghosts — a bug class the tile-less old engine could not have.
 *
 * Spatial index (ISSUE-17): per-level uniform grid hash over lw-inflated
 * bboxes, with an overflow list for objects larger than a cell. The live
 * in-progress stroke stays unindexed (its geometry still grows) and is
 * reported by every query until finalize()d.
 */
import {
    loopsBBox, translateLoops, transformLoopsAbout, encodeLoops, decodeLoops, shapeFromRings, normalizeLoops,
    repairLoops, validEncodedLoops,
} from "./geometry/arcShape";
import { tilePhase, childTilePhase } from "./frameLattice";
import { cloneBelow, shiftDown, shiftUp, hasOffsets, decodeBelow, composeShift, pictureTable, ownTableOf } from "./geometry/offsets";
import { unsettle } from "./legacy/modelV1";
import { objectHeader, extraFields } from "./format2";
import { inheritErase, withId } from "./eraseRule";
import { cede } from "./cede";
import { Loop } from "./geometry/loop";

// Stored loops are Loops (geometry/loop.js): a piece read is a transient view, a piece
// kept is eight doubles. Every way a shape enters the document or changes goes through
// here; builders hand over plain piece arrays and never see them again.
function flattenLoops(o) {
    if (o && o.type === "shape" && o.loops) {
        for (let i = 0; i < o.loops.length; i++) if (!(o.loops[i] instanceof Loop)) o.loops[i] = Loop.from(o.loops[i]);
    }
    return o;
}

const CELL = 2048;          // frame units; typical strokes span 10-1000
const BIG = CELL * 4;       // larger than this goes to the per-level overflow list
const WALK_MAX = 2 ** 40;   // |coordinate| past which a query scans flat: a cell walk there could step by nothing
const OFF_LOG_MAX = 100000;   // `_offLog` entries kept (a drag of 17k objects is 17k)

class LevelIndex {
    // ext: the union of every added box grown by its full linewidth; maxSize: the largest hypot(w,h)+lw.
    // Both only grow (a removal leaves them wide), so they bound what the frame holds for a bake's
    // whole-frame skip.
    // maxZ: the highest z ever added (a removal leaves it), so a subtree's bound is a walk of its frames.
    constructor() { this.cells = new Map(); this.big = new Set(); this.boxes = new Map(); this.objs = new Map(); this.ext = null; this.maxSize = 0; this.maxZ = -Infinity; }
    _key(cx, cy) { return cx + "," + cy; }
    _cellsOf(b, fn) {
        const x0 = Math.floor(b.x0 / CELL), x1 = Math.floor(b.x1 / CELL);
        const y0 = Math.floor(b.y0 / CELL), y1 = Math.floor(b.y1 / CELL);
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) fn(this._key(cx, cy));
    }
    add(o) {
        // Round caps/joins never reach past half the linewidth from the centerline,
        // so a half-width margin is the exact painted extent (broad-phase safe).
        // A resolved shape needs no margin at all: its bbox already IS the ink.
        const m = (o.type === "fill" || o.type === "shape") ? 0 : (o.lwFrame || 0) / 2;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const scan = (pts) => { for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } };
        if (o.type === "shape") {
            const bb = loopsBBox(o.loops);
            if (bb) { x0 = bb.x0; y0 = bb.y0; x1 = bb.x1; y1 = bb.y1; }
        } else if (o.type === "fill") { for (const poly of o.polys) scan(poly); } else scan(o.pts);
        const b = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
        const lw = o.lwFrame || 0;
        if (!this.ext) this.ext = { x0: x0 - lw, y0: y0 - lw, x1: x1 + lw, y1: y1 + lw };
        else { const e = this.ext; if (x0 - lw < e.x0) e.x0 = x0 - lw; if (y0 - lw < e.y0) e.y0 = y0 - lw; if (x1 + lw > e.x1) e.x1 = x1 + lw; if (y1 + lw > e.y1) e.y1 = y1 + lw; }
        const size = Math.hypot(x1 - x0, y1 - y0) + lw;
        if (size > this.maxSize) this.maxSize = size;
        const z = o.z != null ? o.z : o.id;
        if (z > this.maxZ) this.maxZ = z;
        this.boxes.set(o.id, b);
        this.objs.set(o.id, o);
        if (b.x1 - b.x0 > BIG || b.y1 - b.y0 > BIG) { this.big.add(o); return; }
        this._cellsOf(b, (k) => {
            let s = this.cells.get(k);
            if (!s) { s = new Set(); this.cells.set(k, s); }
            s.add(o);
        });
    }
    remove(o) {
        const b = this.boxes.get(o.id);
        if (!b) return;
        this.boxes.delete(o.id);
        this.objs.delete(o.id);
        if (this.big.delete(o)) return;
        this._cellsOf(b, (k) => {
            const s = this.cells.get(k);
            if (s) { s.delete(o); if (!s.size) this.cells.delete(k); }
        });
    }
    query(rect, out) {
        const seen = new Set();
        const q = { x0: rect.left, y0: rect.top, x1: rect.right, y1: rect.bottom };
        // Nothing here can meet a rect off the union box. A mark's box mapped six levels up and
        // across came in at x = 1.15e21, where the cell walk's `cx++` is a no-op: the tab froze
        // (REVIEWER-3 ERASE-3, F127).
        const e = this.ext;
        if (!e || !(q.x1 >= e.x0 && q.x0 <= e.x1 && q.y1 >= e.y0 && q.y0 <= e.y1)) return out;
        // A query rect spanning more cells than we have objects (or absurdly many)
        // makes the cell walk pathological — a magnified region can cover billions
        // of cells. Fall back to a flat scan, which is bounded by the object count.
        const nx = Math.floor(q.x1 / CELL) - Math.floor(q.x0 / CELL) + 1;
        const ny = Math.floor(q.y1 / CELL) - Math.floor(q.y0 / CELL) + 1;
        const far = !(Math.abs(q.x0) < WALK_MAX && Math.abs(q.x1) < WALK_MAX && Math.abs(q.y0) < WALK_MAX && Math.abs(q.y1) < WALK_MAX);
        if (far || nx * ny > 4096 || nx * ny > this.objs.size) {
            for (const [, o] of this.objs) {
                const b = this.boxes.get(o.id);
                if (b.x1 >= q.x0 && b.x0 <= q.x1 && b.y1 >= q.y0 && b.y0 <= q.y1) out.push(o);
            }
            return out;
        }
        this._cellsOf(q, (k) => {
            const s = this.cells.get(k);
            if (s) for (const o of s) {
                if (seen.has(o.id)) continue;
                seen.add(o.id);
                const b = this.boxes.get(o.id);
                if (b.x1 >= q.x0 && b.x0 <= q.x1 && b.y1 >= q.y0 && b.y0 <= q.y1) out.push(o);
            }
        });
        for (const o of this.big) {
            const b = this.boxes.get(o.id);
            if (b.x1 >= q.x0 && b.x0 <= q.x1 && b.y1 >= q.y0 && b.y0 <= q.y1) out.push(o);
        }
        return out;
    }
}

/**
 * A stored record (kobin-1 JSON or a kobin-2 span) as a live native. Also the
 * log replay's way in (format2.decodeEntry hands back records).
 *
 * RETIRED FIELDS: drawings saved before 2026-08-06 recorded a deep erase as a
 * `windows` rect and a `srcId` back-pointer, and every object carried the
 * pre-Two.js renderer's `paths` (retired 2026-09-14); all three are stripped at
 * the door (no migration owed, Kobin). The offsets table arrives in its file form (F41); a
 * malformed one is dropped, not refused: persist validates a real file first,
 * and a dev snapshot is worth more opened than exact. A shape's loops are
 * repaired on the way in so a drawing damaged by an older build opens and saves.
 * A `fill` stays a fill: converting one to arcs is the one expensive thing a load
 * could do (a recorded 1.8-million-vertex fill), and `fillToShapeById` converts
 * it when something needs to cut it. Header fields this build does not know are
 * kept and written back (`_extra`).
 */
export function nativeFromRecord(o) {
    const { windows, srcId, paths, ...keep } = o;
    if (keep.below != null) {
        try { keep.below = decodeBelow(keep.below); } catch (err) { delete keep.below; }
        if (!keep.below) delete keep.below;
    }
    const extra = extraFields(o);
    let out;
    if (keep.type === "shape" && keep.loops) {
        // A closed, well-formed encoding is wrapped as it is — a snapshot's span with
        // no copy; only damage takes the decode-repair-encode road.
        out = { ...keep };
        out.loops = validEncodedLoops(keep.loops)
            ? keep.loops.map((l) => (l instanceof Loop ? l : Loop.wrap(l)))
            : repairLoops(decodeLoops(keep.loops), keep.w).map(Loop.from);
    } else out = { ...keep };
    if (extra) out._extra = extra;
    return out;
}

/** How many ops history keeps; replay caps the rebuilt stack the same way (oplog `fresh`). */
export const UNDO_CAP = 200;

/**
 * The frames `op` names — where its undo or redo puts something back by frame id: homes, sources
 * and targets, a moved frame and its parents, a merge's cell, a settle's carries — into `out`.
 * `add` and `present` name a live native, whose home holds it. Frame GC keeps these (F94).
 */
export function opFrames(op, out = new Set()) {
    const add = (k) => { if (k != null) out.add(String(k)); };
    if (!op) return out;
    switch (op.op) {
        case "absent": case "erase": add(op.level); break;
        case "move": add(op.from); add(op.to); break;
        case "moveMany": for (const m of op.moves) { add(m.from); add(m.to); } break;
        case "eraseMany": case "removeMany": for (const r of op.records) add(r.level); break;
        case "removeFrames": case "eraseFrames": for (const r of op.records) add(r.frame); break;
        case "deleteMany": for (const p of op.parts) opFrames(p, out); break;
        case "moveFrames":
            for (const e of op.frames) {
                add(e.id); if (e.from) add(e.from.parent); if (e.to) add(e.to.parent);
                for (const m of e.merged || []) { add(m.id); add(m.into); add(m.parent); for (const kd of m.kids || []) add(kd.shadowOf); }
                if (e.settled) for (const c of e.settled.carries || []) add(c[1]);
            }
            for (const m of op.moves || []) { add(m.from); add(m.to); }
            break;
        case "eraseCommit": case "eraseRevert":
            if (op.strokeRec) add(op.strokeRec.level);
            for (const st of op.baked || []) {
                if (st.removed) add(st.removed.level);
                for (const p of st.pieces || []) add(p.level);
                for (const r of st.frames || []) add(r.frame);
            }
            break;
        default: break;
    }
    return out;
}

export default class Document {
    constructor() {
        this.nativesByLevel = { 0: [] }; // level -> [objects] (numeric keys as strings, like dev-0)
        this._nextId = 1;
        this._stepSeq = 0;               // bake steps in the order they landed (`recordBake`, replay)
        this._undo = []; this._redo = [];
        this._subs = new Set(); this._opSubs = new Set(); this._inUndo = false;
        this._index = {};                // level -> LevelIndex
        this._pending = new Set();       // live strokes: in natives, not yet indexed
        // id -> object, kept in step by add / insertAt / removeById / _replace.
        // `getById` was a scan of every frame's array, and `editGroup` a scan
        // of every object: on Kobin's 2026-09-03 drawing (5,526 natives, a
        // loop that took 5,429 of them at once) the selection overlay called
        // them once per selected object and cost 600 ms per render — every
        // zoom with the selection up paid it.
        this._byId = new Map();
        // editKey -> [{obj, level}], rebuilt lazily after any change (every
        // change goes through _emit) and after a re-key, which does not.
        this._groups = null;
        // Bumped on every change, so anything derived from the document can
        // tell whether it is still current without subscribing. The selection
        // indicator keys its member table on it.
        this.rev = 0;
        this.offRev = 0;                   // moves on any event that can change an offset object's table or home (E-3)
        this._offLog = [];                 // [offRev, id] per bump about one object, in order (`offTouchedSince`)
        this._offWide = 0;                 // the last offRev an event not about one object moved
        // The ids of every native carrying OFFSETS BELOW ITS HOME (F41,
        // geometry/offsets.js). Kept as a set so the tile store can ask "does
        // anything in this drawing have one?" in O(1) on every bake, and walk
        // only those few objects when it does.
        this._offsetIds = new Set();
        // The lattice, attached by the engine; a frame's shift (its natives' placement, A1 C1) is read from it.
        this.lm = null;
        // Frames whose list and index a subtree removal has set aside. Their natives stay
        // in `_byId` by reference, and `getById` answers null while the frame is here.
        this._detached = new Set();
        this._detachedLists = new Map();   // frame -> its set-aside list: `forgetFrame` drops them from `_byId`
        this._reused = new Set();          // set-aside frames written again: their old natives are `_gone` (DOC-1)
        this._keyedIn = new Map();         // frame -> Set of its natives with a family key: the lasso's family test under an enclosed frame (LASSO-1)
        this._detachedKeyed = new Map();   // frame -> that Set while its list is set aside
    }
    /** Keep `_offsetIds` in step with one object's `below`. */
    _noteBelow(o) {
        if (hasOffsets(o.below)) this._offsetIds.add(o.id);
        else { if (o.below !== undefined) delete o.below; this._offsetIds.delete(o.id); }
    }
    /** Is any native drawn away from its stored bits: a table of its own, or a frame with a shift (A1 C1)? */
    hasOffsets() {
        if (this._offsetIds.size > 0) return true;
        if (!this.lm) return false;
        const key = this.offRev + "|" + this.lm.addrEpoch + "|" + this.lm.frames.size;
        if (this._shiftKey !== key) {
            this._shiftKey = key;
            this._anyShift = false;
            for (const f of this.lm.frames.values()) if (f.shift && this.nativesByLevel[f.id]) { this._anyShift = true; break; }
        }
        return this._anyShift;
    }
    /**
     * Native `o`'s picture table (A1 C1): its own table with its home frame's shift added at k = 0,
     * no carry (`composeShift`). Every reader of where a native is drawn composes here; `home`
     * defaults to its own.
     */
    tableOf(o, home = o._home) {
        const f = this.lm && home != null ? this.lm.frame(String(home)) : null;
        return pictureTable(o, f ? f.shift : null);
    }
    /**
     * Every live native drawn away from its stored bits, as `[obj, home, table]` (its picture table):
     * the ones with a table of their own, then each shifted frame's others, which share one table
     * array per frame (a reader may key a placement on it).
     */
    *displacedNatives() {
        for (const id of this._offsetIds) {
            const rec = this.getById(id);
            if (!rec) continue;
            const T = this.tableOf(rec.obj, rec.level);
            if (T) yield [rec.obj, rec.level, T];
        }
        if (!this.lm) return;
        for (const f of this.lm.frames.values()) {
            const list = f.shift && !this._detached.has(f.id) ? this.nativesByLevel[f.id] : null;
            if (!list) continue;
            const T = [f.shift];
            for (const o of list) if (!this._offsetIds.has(o.id) && !o._gone) yield [o, f.id, T];
        }
    }
    /** Does native `o` carry a table of its own (not only its frame's shift)? */
    hasOwnTable(o) { return this._offsetIds.has(o.id); }
    /** A copy of native `o`'s own table, as an undo entry records it (undefined when it has none). */
    ownTable(o) { return ownTableOf(o); }
    /** The own table of native `o` promoted from `from` to its parent `to`: its picture table one level down there (A1 C1). */
    promotedTable(o, from, to) { return this.ownFor(shiftUp(this.tableOf(o, from)), to); }
    /** Does frame `k` carry a shift (its natives are drawn displaced by it)? */
    _shifted(k) { const f = this.lm && k != null ? this.lm.frame(String(k)) : null; return !!(f && f.shift); }
    /** The ids that do. */
    offsetIds() { return this._offsetIds; }

    // ---- events ----
    subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
    // A table change keeps every object in its family and its frame, so the family index stands:
    // rebuilding it over every native on each drag step was 20–90 ms a step on the Magnum Opus.
    _emit(ev) {
        if (!(ev && ev.offsetsOnly)) this._groups = null;
        this.rev++;
        // An event about an object with no table (added, edited, re-homed, its z) outside a shifted
        // frame leaves every picture table and every displaced native's home as it was; anything
        // else may not (a shifted frame's natives are displaced by the frame, A1 C1). `oldBelow` on
        // a geometry change: the edit took its table away (`setGeometryById`).
        if (!(ev && ev.obj && !ev.offsetsOnly && ev.oldBelow === undefined && ev.obj.below === undefined
            && !this._offsetIds.has(ev.id) && !this._shifted(ev.level) && !this._shifted(ev.rehome))) {
            this.offRev++;
            if (ev && ev.obj && ev.id != null) {
                this._offLog.push(this.offRev, ev.id);
                if (this._offLog.length > OFF_LOG_MAX * 2) { this._offLog.splice(0, OFF_LOG_MAX); }
            } else this._offWide = this.offRev;
        }
        for (const fn of this._subs) fn(ev);
    }
    /**
     * The ids whose table or home may have changed since `offRev` was `rev`, or null when that cannot be
     * told (an event about no one object since, or the log no longer reaches back): a reader memoised
     * at `rev` re-reads only these (TileStore `_rerouteGroups`: re-walking 19.7k moved natives was 166 ms
     * of a drop on the Magnum Opus, TESTER-3).
     */
    offTouchedSince(rev) {
        if (this._offWide > rev) return null;
        const L = this._offLog;
        if (L.length && L[0] > rev + 1) return null;
        const out = new Set();
        for (let i = L.length - 2; i >= 0 && L[i] > rev; i -= 2) out.add(L[i + 1]);
        return out;
    }
    // The OP channel (engine/oplog.js): every fresh undo op, every bake step
    // appended to one, and every undo/redo, in order. Separate from the change
    // events above, which say what moved on screen, not what the user did.
    subscribeOps(fn) { this._opSubs.add(fn); return () => this._opSubs.delete(fn); }
    _notifyOps(ev) { for (const fn of this._opSubs) fn(ev); }
    /** A bake step onto its gesture's eraseCommit op; the one way steps are appended. */
    recordBake(op, step) { step._seq = ++this._stepSeq; op.baked.push(step); this._notifyOps({ kind: "bake", op, step }); }
    /** Ids a replayed entry brought in: the counter must stay above them. */
    noteId(id) { if (Number.isInteger(id) && id >= this._nextId) this._nextId = id + 1; }
    /**
     * A frame was re-addressed or its shift changed (a subtree move): `from`/`to` are `{parent, i, j, shift}`,
     * the shift being placement (A1 C1: its natives are drawn where it says). The tile cache and the Stage listen.
     */
    noteRefile(frameId, from, to) { this._emit({ kind: "refile", frame: String(frameId), from, to }); }
    /**
     * Family keys (or other attributes) changed in place on these natives: the family index is
     * rebuilt and subscribers get `{kind: "rekey", ids}`. Not through `_emit`: a key moves no table
     * or home, and an `offRev` bump would rebuild the whole reroute memo.
     */
    keysChanged(ids) {
        this._groups = null; this.rev++;
        if (ids && ids.length) { const ev = { kind: "rekey", ids }; for (const fn of this._subs) fn(ev); }
    }

    // ---- ids ----
    allocId() { return this._nextId++; }

    // ---- storage primitives ----
    // Keys are FRAME ids (strings). Spine frame ids are the depth as a string
    // ("0", "1", "-2"), so legacy per-level data and integer-level callers keep
    // working through plain object-key coercion; sibling frames ("2~1") slot in
    // with no special cases. All entry points normalize to String.
    levels() { return Object.keys(this.nativesByLevel); }
    /**
     * Forget a frame that has just lost its last native.
     *
     * WHY THIS IS NOT HOUSEKEEPING. `levels()` is walked per tile bake
     * (`TileStore._minContentDepth`) and scanned per lookup (`getById`,
     * `removeById`), so an empty bucket costs on every render for the rest of
     * the session. They accumulate fast: a drag re-homes on every pointer event
     * and each destination allocates one, and every erase cedes down a chain and
     * allocates one per link. Measured on a reported session — 391 objects, half
     * an hour of drawing — **4,343 of 4,369 buckets were empty**, and dropping
     * them took a render from 195 ms to 23 ms with nothing else changed.
     */
    _forgetIfEmpty(k) {
        const arr = this.nativesByLevel[k];
        if (!arr || arr.length) return false;
        delete this.nativesByLevel[k];
        delete this._index[k];
        return true;
    }
    /** A frame's natives: `list` under its older name, kept for its callers. */
    at(level) { return this.list(level); }
    /** The frame's native count. */
    count(level) { const arr = this.nativesByLevel[level]; return arr ? arr.length : 0; }
    /**
     * A frame's natives as stored. No read merges, settles or mints (A1 C1): where they are drawn is
     * their tables with the frame's shift composed (`tableOf`), never written into them.
     */
    list(level) { return this.nativesByLevel[String(level)] || []; }
    /** The natives of every frame sharing `frame`'s cell, its resident's first (A1 C3); its own list when alone. */
    cellList(frame) {
        const fs = this.lm ? this.lm.cellFrames(String(frame)) : null;
        if (!fs || fs.length < 2) return this.list(frame);
        const out = [];
        for (const g of fs) for (const o of this.list(g.id)) out.push(o);
        return out;
    }
    /**
     * Set a frame's shift, the k = 0 displacement its natives are drawn with (DESIGN.md §8, A1 C1); a zero
     * shift clears. Every placement memo keyed on `offRev` is stale from here, whether or not a refile follows.
     */
    setFrameShift(frameId, shift) {
        const f = this.lm && this.lm.frame(String(frameId));
        if (!f) return false;
        f.shift = shift && (shift[0] || shift[1]) ? [shift[0], shift[1]] : null;
        this._shiftKey = null;
        this.offRev++; this._offWide = this.offRev;
        return true;
    }
    /**
     * The own table a native homed in `home` carries to be drawn with picture table `T`: `T` less the
     * frame's shift (A1 C1). New ink in a shifted frame takes −shift, so the shift does not move it.
     */
    ownFor(T, home) {
        const f = this.lm && home != null ? this.lm.frame(String(home)) : null;
        return f && f.shift ? composeShift(T, [-f.shift[0], -f.shift[1]]) : cloneBelow(T);
    }
    /**
     * Merge every shadow into the resident of its cell (SUBTREE-O1-PLAN §2.5) at the end of the user
     * action that made them — a drop, an undo, a redo, a load — never at a read (A1 C1); a merge's kids
     * can shadow in turn, so it repeats until none is left. `op`: the action's `moveFrames` op, whose
     * entry for the shadow (or the resident) records each merge for `unmerge`.
     */
    mergePending(op = null) {
        if (!this.lm) return 0;
        let n = 0;
        for (let pass = 0; pass < 16; pass++) {
            const res = [];
            for (const f of this.lm.frames.values()) if (f._shadows && f._shadows.size && !this._detached.has(f.id)) res.push(f);
            let merged = 0;
            for (const E of res) merged += this._mergeShadows(E, op);
            n += merged;
            if (!merged) break;
        }
        return n;
    }
    /**
     * Merge the shadows of resident `E` into it: each shadow's natives appended to E's list (home E,
     * indexed) with the difference of the two frames' shifts folded into their own tables, so their
     * pictures stay; its kids re-parented by `LevelMap.adoptShadow`; the shadow gone. O(the shadow's
     * natives). The record (tables before and after) goes on `op`'s entry, for `unmerge`, and to the log.
     */
    _mergeShadows(E, op) {
        let n = 0;
        for (const mid of [...E._shadows]) {
            const M = this.lm.frame(mid);
            if (!M || this._detached.has(mid)) continue;   // set aside by a delete: it waits
            if (!this.count(mid) && !(M._kids && M._kids.size) && !(M._shadows && M._shadows.size)) continue;   // holds nothing: frame GC's (F94)
            const d = [(M.shift ? M.shift[0] : 0) - (E.shift ? E.shift[0] : 0), (M.shift ? M.shift[1] : 0) - (E.shift ? E.shift[1] : 0)];
            const src = this.nativesByLevel[mid] || [];
            const ids = src.map((o) => o.id), tables = [];
            if (src.length) {
                this._reuseDetached(E.id);
                const dst = this.nativesByLevel[E.id] || (this.nativesByLevel[E.id] = []);
                for (const o of src) {
                    dst.push(o); this._keyOut(mid, o); this._keyIn(E.id, o); o._home = E.id;
                    if (!this._pending.has(o)) this._idx(E.id).add(o);
                    o._ver = (o._ver || 0) + 1;
                    if (d[0] || d[1]) {
                        const before = cloneBelow(o.below);
                        o.below = composeShift(o.below, d);
                        this._noteBelow(o);
                        tables.push([o.id, before || null, cloneBelow(o.below) || null]);
                    }
                }
            }
            delete this.nativesByLevel[mid]; delete this._index[mid];
            const rec = this.lm.adoptShadow(M, E);
            rec.ids = ids;
            if (tables.length) rec.tables = tables;
            const entry = op && op.frames ? (op.frames.find((e) => e.id === mid) || op.frames.find((e) => e.id === E.id)) : null;
            if (entry) (entry.merged || (entry.merged = [])).push(rec);
            this._emit({ kind: "mergeFrame", frame: mid, into: E.id, at: { parent: E.parent, i: E.cell.i, j: E.cell.j }, ids, kids: rec.kids.map((kd) => kd.id) });
            this._notifyOps({ kind: "mergeFrame", rec, of: op && op._seq != null ? op._seq : null });
            n++;
        }
        return n;
    }
    _setKeyedAside(k) {
        const set = this._keyedIn.get(k);
        this._keyedIn.delete(k);
        if (set) this._detachedKeyed.set(k, set); else this._detachedKeyed.delete(k);
    }
    /**
     * A frame's list set aside (the redo of a subtree delete, and replay): its natives stay in `_byId`,
     * unreadable. The record, when given, is refreshed to what was set aside: an undo put its list
     * back by reference and later ops changed or replaced it (REVIEWER-3 DOC-2). Ink the record
     * `kept` — placed while the frame was set aside, merged back by the undo — stays listed (DOC-1).
     */
    detachFrame(frame, rec = null) {
        const k = String(frame);
        const arr = this.nativesByLevel[k];
        if (arr && rec && rec.kept && arr.some((o) => rec.kept.has(o))) {
            const aside = [];
            let w = 0;
            for (let r = 0; r < arr.length; r++) {
                const o = arr[r];
                if (rec.kept.has(o)) { arr[w++] = o; continue; }
                aside.push(o);
                o._gone = true;
                if (!this._pending.has(o)) this._idx(k).remove(o);
                this._keyOut(k, o);
            }
            arr.length = w;
            this._reused.add(k);
            this._detachedLists.set(k, aside);
            this._detachedKeyed.delete(k);                   // a restore keys them one by one
            rec.natives = aside; rec.index = null;
            this._emit({ kind: "removeFrame", frame: k, count: aside.length, partial: true });
            return;
        }
        const index = this._index[k] || null;
        delete this.nativesByLevel[k]; delete this._index[k];
        this._setKeyedAside(k);
        this._detached.add(k);
        if (arr) {
            this._detachedLists.set(k, arr);
            if (rec) { rec.natives = arr; rec.index = index; }
        }
        this._emit({ kind: "removeFrame", frame: k, count: arr ? arr.length : 0 });
    }
    /**
     * Ink is placed in a frame whose list a delete set aside (drawn where the frame was, re-homed or
     * ceded there): the set-aside natives become unreadable one by one (`_gone`, O(that list), only
     * here) and the frame is live again, so the new ink reads (REVIEWER-3 DOC-1).
     */
    _reuseDetached(k) {
        if (!this._detached.has(k)) return;
        for (const o of this._detachedLists.get(k) || []) if (o._home === k) o._gone = true;
        this._detached.delete(k);
        this._reused.add(k);
    }
    /** A replayed merge or split: the record's natives into the list they belong in, their tables as recorded (idempotent). */
    mergeReplay(rec) { this.rehomeManyById(rec.ids, rec.into); this._setTables(rec.tables, 2); this._forgetIfEmpty(rec.id); }
    unmergeReplay(rec) { this.rehomeManyById(rec.ids, rec.id); this._setTables(rec.tables, 1); this._forgetIfEmpty(rec.into); }
    _setTables(tables, which) { for (const t of tables || []) if (this.getById(t[0])) this.setOffsetsById(t[0], t[which] || undefined); }
    /** The inverse of one `_mergeShadows` record: the frame back as a shadow, its natives back in its own list. */
    unmerge(rec) {
        const M = this.lm.unadoptShadow(rec);
        const set = new Set(rec.ids);
        const src = this.nativesByLevel[rec.into] || [];
        const mine = [];
        let w = 0;
        for (let r = 0; r < src.length; r++) { const o = src[r]; if (set.has(o.id)) mine.push(o); else src[w++] = o; }
        src.length = w;
        if (mine.length) {
            this.nativesByLevel[M.id] = mine;
            for (const o of mine) {
                if (!this._pending.has(o)) { this._idx(rec.into).remove(o); this._idx(M.id).add(o); }
                this._keyOut(rec.into, o); this._keyIn(M.id, o);
                o._home = M.id; o._ver = (o._ver || 0) + 1;
            }
        }
        for (const [id, before] of rec.tables || []) { const o = this._byId.get(id); if (o) { o.below = cloneBelow(before); this._noteBelow(o); } }
        this._forgetIfEmpty(rec.into);
        this._emit({ kind: "splitFrame", frame: M.id, from: rec.into, at: { parent: M.parent, i: M.cell.i, j: M.cell.j }, ids: rec.ids, kids: rec.kids.map((kd) => kd.id) });
        return M;
    }
    _idx(level) { const k = String(level); return this._index[k] || (this._index[k] = new LevelIndex()); }
    _keyIn(k, o) {
        if (o.editId == null) return;
        let set = this._keyedIn.get(k);
        if (!set) this._keyedIn.set(k, (set = new Set()));
        set.add(o);
    }
    _keyOut(k, o) { const set = this._keyedIn.get(k); if (set && set.delete(o) && !set.size) this._keyedIn.delete(k); }
    /** The natives of `frame` with a family key (ceded kids, erase pieces), or null. */
    keyedIn(frame) { return this._keyedIn.get(String(frame)) || null; }
    /** Every frame holding a native with a family key. */
    keyedFrames() { return this._keyedIn.keys(); }

    // Add an object as a native of `level`. `live` = still growing (a stroke between pointerDown and
    // pointerUp): kept out of the spatial index until finalize(). `fresh`: ink placed where it was drawn
    // in this frame, so it takes −shift in its own k = 0 entry and the frame's shift does not move it (A1 C1).
    add(o, level, { live = false, by = null, fresh = false } = {}) {
        const k = String(level);
        if (fresh) { const b = this.ownFor(o.below, k); if (b) o.below = b; else delete o.below; }
        this._reuseDetached(k);
        flattenLoops(o);
        if (!this.nativesByLevel[k]) this.nativesByLevel[k] = [];
        this.nativesByLevel[k].push(o);
        o._home = k; delete o._gone;
        this._keyIn(k, o);
        this._byId.set(o.id, o);
        this._noteBelow(o);
        if (live) this._pending.add(o);
        else this._idx(k).add(o);
        const ev = { kind: "add", id: o.id, level: k, obj: o, live };
        if (by != null) ev.by = by;          // an erase step's piece (A2 §4.5)
        this._emit(ev);
        return o;
    }
    // The stroke is done: geometry is immutable from here on -> index it and
    // re-announce (subscribers invalidate against the FINAL bbox).
    finalize(o) {
        if (!this._pending.delete(o)) return;
        this._idx(o._home).add(o);
        this._emit({ kind: "finalize", id: o.id, level: o._home, obj: o });
    }

    // Find a native by id. `level` in the returned record is the FRAME id
    // (string) the object homes in — `_home`, which every path that places an
    // object sets.
    getById(id) {
        const o = this._byId.get(id);
        if (o && (o._gone || this._detached.has(o._home))) return null;   // set aside by a subtree removal
        return o ? { obj: o, level: o._home } : null;
    }

    // Re-homed boundary patches share one logical editing identity even though
    // their geometry lives in several frames. Fully enclosed leftovers have no
    // editId and therefore remain ordinary, independently editable natives.
    editKey(o) { return o && o.editId != null ? o.editId : o && o.id; }
    editGroup(idOrObj) {
        const rec = typeof idOrObj === "object" ? { obj: idOrObj } : this.getById(idOrObj);
        const key = rec ? this.editKey(rec.obj) : idOrObj;
        if (key == null) return [];
        if (!this._groups) {
            const g = new Map();
            for (const level of Object.keys(this.nativesByLevel)) {
                for (const obj of this.nativesByLevel[level] || []) {
                    const k = this.editKey(obj);
                    let a = g.get(k);
                    if (!a) { a = []; g.set(k, a); }
                    a.push({ obj, level });
                }
            }
            this._groups = g;
        }
        const a = this._groups.get(key);
        return a ? a.slice() : [];
    }

    // Remove a native by id from whichever frame holds it (derived copies carry
    // the source id, so this is "erase everywhere"). `by`, `dust`: an erase step's
    // mark and the boxes of the dust it dropped, for the scene's dirt (A2 §4.5).
    removeById(id, { by = null, dust = null } = {}) {
        const obj = this._byId.get(id);
        if (!obj) return null;
        const Ls = obj._home;
        const arr = this.nativesByLevel[Ls];
        const i = arr ? arr.indexOf(obj) : -1;
        if (i < 0) return null;
        arr.splice(i, 1);
        this._keyOut(Ls, obj);
        this._byId.delete(id);
        this._offsetIds.delete(id);
        this._pending.delete(obj);
        this._idx(Ls).remove(obj);
        this._forgetIfEmpty(Ls);
        const ev = { kind: "remove", id, level: Ls, obj };
        if (by != null) { ev.by = by; if (dust) ev.dust = dust; }
        this._emit(ev);
        return { obj, level: Ls, index: i };
    }
    // Re-insert at a remembered position (undo of an erase). Position only
    // affects the array; z-order is by id, which the object kept.
    insertAt(obj, level, index) {
        const k = String(level);
        this._reuseDetached(k);
        flattenLoops(obj);
        if (!this.nativesByLevel[k]) this.nativesByLevel[k] = [];
        const arr = this.nativesByLevel[k];
        arr.splice(Math.min(index, arr.length), 0, obj);
        obj._home = k; delete obj._gone;
        this._keyIn(k, obj);
        this._byId.set(obj.id, obj);
        this._noteBelow(obj);
        this._idx(k).add(obj);
        this._emit({ kind: "add", id: obj.id, level: k, obj });
    }

    // ---- edit primitives (selection / US-10) ----
    // Geometry and style edits mutate the object IN PLACE (its id — and so its
    // z-order — is part of its identity), bust the derive caches attached to it
    // (_bbox / _dispFlat / _flat: "immutable once finalized" becomes "immutable
    // between edits"), reindex, and emit a "change" event that carries the OLD
    // footprint so the TileStore can invalidate both where the object WAS and
    // where it IS now. Callers push the undo op (drags coalesce many steps
    // into one).
    moveById(id, dx, dy) {
        const rec = this.getById(id);
        if (!rec || (dx === 0 && dy === 0)) return rec;
        const o = rec.obj;
        const oldBbox = this._bboxNow(o);
        const shift = (pts) => { for (const p of pts) { p[0] += dx; p[1] += dy; } };
        if (o.type === "shape") {
            // REPLACED, never shifted in place. Consecutive pieces of a loop
            // share their endpoint ARRAY — that is what makes the perimeter
            // watertight — so mutating coordinates would move every shared point
            // twice and tear the shape apart along its own seams.
            o.loops = translateLoops(o.loops, dx, dy); flattenLoops(o);
        } else if (o.type === "fill") { for (const poly of o.polys) shift(poly); } else shift(o.pts);
        const shiftRect = (r) => { r.x0 += dx; r.x1 += dx; r.y0 += dy; r.y1 += dy; };
        if (o.attachRect) shiftRect(o.attachRect);
        this._afterEdit(o, rec.level, oldBbox, o.lwFrame);
        return rec;
    }
    /**
     * Replace a native's geometry outright.
     *
     * A drag needs this rather than a chain of translations. Applying each
     * pointer event's increment to the result of the last makes the final
     * position depend on HOW MANY events there were — forty 1-unit steps and one
     * 40-unit step accumulate different rounding — which is the M-4 property
     * failing in a new place after the lattice removed the old cause. Recomputing
     * from the geometry the drag STARTED with makes a slow drag and a fast one
     * literally the same arithmetic on the same numbers, and makes a
     * there-and-back drag return bit-exactly.
     */
    setGeometryById(id, geom) {
        const rec = this.getById(id);
        if (!rec) return null;
        const o = rec.obj;
        const oldBbox = this._bboxNow(o);
        if (o.type === "shape") { o.loops = geom.loops.slice(); flattenLoops(o); }
        else if (o.type === "fill") o.polys = geom.polys;
        else o.pts = geom.pts;
        // A snapshot that HAS the key with nothing in it means "no rect, no
        // phase" — and that has to be written back too. Until 2026-09-05 a
        // null phase was skipped: `translateGeometry` mints `tile` for a drag,
        // undo restored the snapshot's coordinates but left the DRAG's phase
        // on the object, and the chop grid no longer rode with the ink — after
        // drag + undo the only serialized field that differed was `tile`, and
        // the deep picture was not the one from before the drag. The pinch
        // cancel (`cancelSelectGesture`) took the same path.
        if (geom.attachRect) o.attachRect = { ...geom.attachRect };
        else if ("attachRect" in geom) delete o.attachRect;
        if (geom.tile) o.tile = [geom.tile[0], geom.tile[1]];
        else if ("tile" in geom) delete o.tile;
        // The offsets below the home are geometry too (F41): a snapshot carries
        // them, a drag writes them, undo restores them. Only a snapshot that
        // KNOWS about them (has the key) may change them.
        const had = o.below;
        if ("below" in geom) { o.below = cloneBelow(geom.below); this._noteBelow(o); }
        this._afterEdit(o, rec.level, oldBbox, o.lwFrame, had !== undefined && o.below === undefined ? had : undefined);
        return rec;
    }
    /**
     * A z change alone: the eraser mark's z steps down as its bake proceeds
     * (DESIGN.md §7). Nothing geometric moves — the tile store ignores the event
     * (`attrOnly`), the log takes a `put` of the object, the next render re-sorts.
     * Returns the previous z.
     */
    /**
     * An upper bound on the z of everything under a frame subtree: the indexes' bounds (they
     * only grow) and the pending strokes. `maxZUnder(F) < z` means nothing under F is drawn
     * above z — the erase's test for taking a frame whole (DESIGN.md §7).
     */
    maxZUnder(rootId) {
        let m = -Infinity;
        const frames = new Set();
        this.lm.walk(rootId, (f) => { frames.add(f.id); const ix = this._index[f.id]; if (ix && ix.maxZ > m) m = ix.maxZ; });
        for (const o of this._pending) if (frames.has(o._home)) { const z = o.z != null ? o.z : o.id; if (z > m) m = z; }
        return m;
    }
    /**
     * Mark `markId`'s bake has dealt with native `id` without cutting it — a refusal or a graze
     * (A2 §4.1): `handledBy` gains it. `inkless`: no ink of it lay under the mark, so no pixel
     * changes. Logged as an `attr` entry (A2 §4.9).
     */
    setHandledById(id, markId, { inkless = false } = {}) {
        const rec = this.getById(id);
        if (!rec) return null;
        const o = rec.obj, h = withId(o.handledBy, markId);
        if (h === o.handledBy) return rec;
        o.handledBy = h;
        this._emit({ kind: "change", id, level: rec.level, obj: o, attrOnly: true, attr: { handledBy: h.slice() }, by: markId, inkless });
        return rec;
    }
    /** A mark's `targets`, recorded once when its shape lands (A2 §4.2); an `attr` entry in the log. */
    setTargetsById(id, targets) {
        const rec = this.getById(id);
        if (!rec) return null;
        rec.obj.targets = targets;
        this._emit({ kind: "change", id, level: rec.level, obj: rec.obj, attrOnly: true, attr: { targets: targets.slice() } });
        return rec;
    }
    /** The reserved `attr` z op's hook (DESIGN.md §13): no production caller since a mark's z stopped stepping (A2 §4.13). */
    setZById(id, z) {
        const rec = this.getById(id);
        if (!rec) return null;
        const o = rec.obj, before = o.z;
        o.z = z;
        const ix = this._index[rec.level];
        if (ix && z > ix.maxZ) ix.maxZ = z;
        this._emit({ kind: "change", id: o.id, level: rec.level, obj: o, attrOnly: true });
        return before;
    }
    /**
     * A move (F55). The object's coordinates are left exactly as they are;
     * only its displacement table changes. No cache is stale — the bbox, the
     * flattenings and the tiles all describe stored bits a move never touches
     * — so nothing is busted or re-indexed, and the change event says
     * `offsetsOnly` so the tile store does not patch anything: the picture is
     * re-read from the unmoved tiles at its new address on the next render.
     */
    setOffsetsById(id, below) {
        const rec = this.getById(id);
        if (!rec) return null;
        const o = rec.obj;
        const oldBelow = o.below;
        o.below = cloneBelow(below);
        this._noteBelow(o);
        o._ver = (o._ver || 0) + 1;
        this._emit({ kind: "change", id: o.id, level: rec.level, obj: o, offsetsOnly: true, oldBelow });
        return rec;
    }
    /** A detached copy of a native's geometry, safe to translate from later. */
    static snapGeometry(o) {
        // The tile phase is GEOMETRY, not decoration: it is where the object
        // gets chopped, and a chop is where a curve may become a line (D2/D4).
        // Snapshot it with the coordinates and translate it with them, or a
        // drag would slide the object out from under its own grid — which is
        // the very failure the object-anchored grid exists to prevent.
        const tile = o.tile ? [o.tile[0], o.tile[1]] : null;
        // ...and so are the offsets below the home (F41): where the object's
        // picture sits at every level below its own is part of where it is.
        const below = cloneBelow(o.below);
        if (o.type === "shape") return { loops: o.loops, tile, attachRect: o.attachRect ? { ...o.attachRect } : null, below };
        if (o.type === "fill") return { polys: o.polys.map((p) => p.map((q) => [q[0], q[1]])), tile, attachRect: o.attachRect ? { ...o.attachRect } : null, below };
        return { pts: o.pts.map((q) => [q[0], q[1]]), tile, attachRect: o.attachRect ? { ...o.attachRect } : null, below };
    }
    /**
     * `snapGeometry` under a similarity: `(p - c) * f`. Used to change an
     * object's UNITS — promoting an over-wide native to its parent level, where
     * the same ink is described by numbers R times smaller. Dividing every
     * coordinate by a power of two is a change of units and not a loss of
     * relative precision: the mantissa is untouched and only the exponent moves.
     */
    static scaleGeometry(g, f, cx, cy) {
        const pt = ([x, y]) => [(x - cx) * f, (y - cy) * f];
        const out = {};
        // Same similarity, same grid: the phase is a coordinate too.
        out.tile = [childTilePhase(g.tile ? g.tile[0] : 0, cx, f),
            childTilePhase(g.tile ? g.tile[1] : 0, cy, f)];
        if (g.loops) out.loops = transformLoopsAbout(g.loops, cx, cy, f);
        if (g.polys) out.polys = g.polys.map((poly) => poly.map(pt));
        if (g.pts) out.pts = g.pts.map(pt);
        if (g.attachRect) {
            const a = pt([g.attachRect.x0, g.attachRect.y0]), b = pt([g.attachRect.x1, g.attachRect.y1]);
            out.attachRect = { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
        }
        // A change of units is a change of HOME LEVEL, and the offsets below
        // the home are keyed by depth below it: promoted one level up (f < 1)
        // they all sit one level deeper than they did.
        out.below = f < 1 ? shiftUp(g.below) : f > 1 ? shiftDown(g.below, 1) : cloneBelow(g.below);
        return out;
    }
    /** `snapGeometry`, translated. Never mutates the snapshot. */
    static translateGeometry(g, dx, dy) {
        const out = {};
        out.tile = [tilePhase((g.tile ? g.tile[0] : 0) + dx), tilePhase((g.tile ? g.tile[1] : 0) + dy)];
        if (g.loops) out.loops = translateLoops(g.loops, dx, dy);
        if (g.polys) out.polys = g.polys.map((p) => p.map((q) => [q[0] + dx, q[1] + dy]));
        if (g.pts) out.pts = g.pts.map((q) => [q[0] + dx, q[1] + dy]);
        if (g.attachRect) out.attachRect = { x0: g.attachRect.x0 + dx, x1: g.attachRect.x1 + dx, y0: g.attachRect.y0 + dy, y1: g.attachRect.y1 + dy };
        out.below = cloneBelow(g.below);   // a move at the home leaves the levels below it alone
        return out;
    }

    /**
     * Move a native to a DIFFERENT FRAME without touching a single coordinate.
     *
     * This is what makes a move at depth survive. A drag used to translate every
     * member's geometry by `displacement x R^k`, which for a member five levels
     * below the camera meant rewriting its coordinates to 7.3e18 and destroying
     * 82.9% of its area (F-C / F25). Under the lattice the whole-cell part of
     * any displacement is a change of ADDRESS: the object lands in the cell that
     * many steps along, and since neighbouring cells' origins differ by exactly
     * one frame, the SAME local coordinates describe the moved object exactly.
     * Only the sub-cell remainder is ever added to geometry, and it is smaller
     * than one frame by construction.
     *
     * Emits remove + add so the tile cache invalidates both where the object was
     * and where it now is.
     */
    rehomeById(id, toLevel) {
        const k = String(toLevel);
        const rec = this.getById(id);
        if (!rec || rec.level === k) return rec;
        const o = rec.obj;
        const wasPending = this._pending.has(o);
        const arr = this.nativesByLevel[rec.level];
        arr.splice(arr.indexOf(o), 1);
        this._idx(rec.level).remove(o);
        this._keyOut(rec.level, o);
        this._forgetIfEmpty(rec.level);
        // Tagged `rehome` because it is NOT a deletion followed by a creation.
        // Caches want the remove/add pair (the object's footprint really did
        // change frames); anything tracking IDENTITY — a selection being
        // dragged, most of all — must not read it as the object going away, or
        // a drag drops every member the moment it re-homes and the rest of the
        // gesture moves only what happened to stay put.
        this._emit({ kind: "remove", id, level: rec.level, obj: o, rehome: k });
        this._reuseDetached(k);
        if (!this.nativesByLevel[k]) this.nativesByLevel[k] = [];
        this.nativesByLevel[k].push(o);
        o._home = k;
        this._keyIn(k, o);
        if (!wasPending) this._idx(k).add(o);
        o._ver = (o._ver || 0) + 1;
        this._emit({ kind: "add", id, level: k, obj: o, live: wasPending, rehome: rec.level });
        return { obj: o, level: k };
    }

    /**
     * `rehomeById` for many natives at once: each source frame's list is compacted in one pass
     * instead of spliced per object, which is what made a drag of a whole frame quadratic in its
     * length (row 11: 52 us a re-home at 2,000 objects, 184 at 8,000). Ends in the same lists,
     * indexes and events as one `rehomeById` per id in this order; only the events' interleaving
     * differs. Returns how many moved.
     */
    rehomeManyById(ids, toLevel) {
        const k = String(toLevel);
        const groups = new Map();                       // source frame -> [obj], in `ids` order
        for (const id of ids) {
            const rec = this.getById(id);
            if (!rec || rec.level === k) continue;
            let g = groups.get(rec.level);
            if (!g) { g = []; groups.set(rec.level, g); }
            g.push(rec.obj);
        }
        let n = 0;
        for (const [from, objs] of groups) {
            const set = new Set(objs);
            const arr = this.nativesByLevel[from];
            let w = 0;
            for (let r = 0; r < arr.length; r++) if (!set.has(arr[r])) arr[w++] = arr[r];
            arr.length = w;
            for (const o of objs) { if (!this._pending.has(o)) this._idx(from).remove(o); this._keyOut(from, o); }
            this._forgetIfEmpty(from);
            for (const o of objs) this._emit({ kind: "remove", id: o.id, level: from, obj: o, rehome: k });
            this._reuseDetached(k);
            if (!this.nativesByLevel[k]) this.nativesByLevel[k] = [];
            for (const o of objs) {
                const wasPending = this._pending.has(o);
                this.nativesByLevel[k].push(o);
                o._home = k;
                this._keyIn(k, o);
                if (!wasPending) this._idx(k).add(o);
                o._ver = (o._ver || 0) + 1;
                this._emit({ kind: "add", id: o.id, level: k, obj: o, live: wasPending, rehome: from });
                n++;
            }
        }
        return n;
    }

    /**
     * Set a frame subtree aside (the delete of a selected frame): each frame's list and index
     * detached by reference, no per-object work. Returns the records the op holds; null when the
     * root has no list and no descendants with one.
     */
    removeFrameSubtree(rootId, { by = null } = {}) {
        const frames = [];
        this.lm.walk(rootId, (f) => frames.push(f.id));
        const records = [];
        for (const k of frames) {
            const arr = this.nativesByLevel[k];
            if (!arr) continue;
            records.push({ frame: k, natives: arr, index: this._index[k] || null });
            delete this.nativesByLevel[k]; delete this._index[k];
            this._setKeyedAside(k);
            this._detached.add(k);
            this._detachedLists.set(k, arr);
            const ev = { kind: "removeFrame", frame: k, count: arr.length };
            if (by != null) ev.by = by;      // a frame a mark covers whole, set aside at its landing (A2 §4.2)
            this._emit(ev);
        }
        return records.length ? records : null;
    }
    /**
     * The inverse of removeFrameSubtree: the same lists and indexes back, by reference. A record
     * without an index (rebuilt from the op log) has its natives registered here. A frame holding
     * ink placed there since the delete keeps it, the record's natives listed first (DOC-1).
     */
    insertFrameSubtree(records) {
        for (const r of records) {
            const k = r.frame, cur = this.nativesByLevel[k];
            if (this._reused.delete(k)) for (const o of r.natives) delete o._gone;
            if (cur && cur !== r.natives && cur.length) {
                r.kept = new Set(cur);                        // placed while it was set aside: a redo leaves them
                const all = r.natives.slice();
                for (const o of r.natives) {
                    flattenLoops(o); o._home = k; this._byId.set(o.id, o); this._noteBelow(o); this._keyIn(k, o);
                    if (!this._pending.has(o)) this._idx(k).add(o);
                }
                for (const o of cur) all.push(o);
                this.nativesByLevel[k] = all;
            } else {
                r.kept = null;
                this.nativesByLevel[k] = r.natives;
                const aside = this._detachedKeyed.get(k);
                if (r.index) {
                    this._index[k] = r.index;
                    for (const o of aside || r.natives) this._keyIn(k, o);
                } else {
                    delete this._index[k];
                    for (const o of r.natives) { flattenLoops(o); o._home = k; this._byId.set(o.id, o); this._noteBelow(o); this._idx(k).add(o); this._keyIn(k, o); }
                }
            }
            this._detachedKeyed.delete(k);
            this._detached.delete(k);
            this._detachedLists.delete(k);
            this._emit({ kind: "addFrame", frame: k, count: r.natives.length });
        }
    }

    // Replace a native with the region(s) an AREA erase left of its ink. Each
    // region (outer ring plus its holes) becomes its own native with a fresh id
    // inheriting the source's z/colour/opacity — disjoint leftovers select and
    // re-erase independently, with tight bboxes. This is what replaced the old
    // centerline cut: an erase now yields REGIONS, not pieces of a polyline.
    // `by`: the mark whose bake this is — every piece inherits the source's
    // lineage with `by` handled (A2 §4.3); `dust`: the boxes the cut dropped.
    eraseReplaceById(id, regions, by = null, dust = null) {
        const rec = this.removeById(id, { by, dust });
        if (!rec) return null;
        const src = rec.obj;
        const z = src.z != null ? src.z : src.id;
        const editKey = this.editKey(src);
        const pieces = regions.map((loops) => {
            const obj = {
                type: "shape", origin: src.origin, id: this.allocId(), z, loops,
                color: src.color, opacity: src.opacity,
            };
            // Cutting an object up does not move it, so every piece keeps the
            // grid the whole was chopped on. That is D4's "a logical object and
            // its ceded children share one tile grid", applied to the other way
            // an object comes apart.
            if (src.tile) obj.tile = [src.tile[0], src.tile[1]];
            // The pen that drew it travels with every piece, so a stroke cut in
            // two still clusters as the stroke it was rather than as two blobs
            // the size of their own bounding boxes.
            if (src.w > 0) obj.w = src.w;
            // Cutting an object up does not move its picture at any level
            // either: every piece keeps the offsets below the home (F41).
            const below = cloneBelow(src.below);
            if (below) obj.below = below;
            // Pieces of something that was already part of a multi-level object
            // stay in its family; whether the family is still ONE object is a
            // question about the whole family, answered separately.
            //
            // For a PLAIN object it depends on how many pieces there are, and
            // the rule is simply what happened to it. Several regions is a
            // split: each piece becomes its own object, keyless, as it should.
            // ONE region is the same object with less ink — a bite that did not
            // sever, or the stroke→fill outline a deep erase does before it
            // cedes anything — and it has to keep its identity. It did not, and
            // that cost two debugging rounds: outlining minted the new fill's
            // own id as the family key, so every reference taken beforehand
            // (a selection, a caller's cached key) silently named nothing.
            if (regions.length === 1 || src.editId != null) {
                obj.editId = editKey;
                if (src.attachRect) obj.attachRect = { ...src.attachRect };
            }
            inheritErase(obj, src, by);
            return this.add(obj, rec.level, { by });
        });
        return { removed: rec, pieces };
    }
    /** CEDE A TILE (bible §2.1): `cede.js`, with this document as the receiver. */
    cedeTileById(id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts, dustBar, by = null) {
        const src = this._byId.get(id);
        // The kid's own table: its source's picture table one level down, less its frame's shift (A1 C1).
        if (kidBelow === undefined && src) kidBelow = this.ownFor(shiftDown(this.tableOf(src), 1), level) || null;
        return cede(this, id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts, dustBar, by);
    }
    /**
     * A drawn stroke BECOMES its resolved perimeter.
     *
     * In place, keeping the id — and so the z-order, the selection pointing at
     * it, and every undo record that names it. The centerline is dropped: it
     * has done its job, nothing downstream reads it again, and keeping both
     * would mean keeping them in agreement forever. `w` survives as the pen that
     * drew the shape, which scene clustering needs and a perimeter cannot
     * otherwise report.
     *
     * No undo op is pushed. Baking is a system action — the user drew a stroke
     * and Ctrl+Z must undo THAT, not the machine's decision about how to store
     * it.
     */
    bakeShapeById(id, loops, w) {
        const rec = this.getById(id);
        if (!rec || rec.obj.type !== "stroke") return null;
        const o = rec.obj;
        const oldBbox = this._bboxNow(o);
        const oldLw = o.lwFrame;
        o.type = "shape";
        o.loops = loops; flattenLoops(o);
        if (w > 0) o.w = w;
        delete o.pts; delete o.lwFrame; delete o._pen; delete o._tol;
        this._afterEdit(o, rec.level, oldBbox, oldLw);
        return rec;
    }

    /**
     * A legacy polygon fill becomes a shape, in place.
     *
     * Only ever called when something is about to CUT the object — an erase, or
     * a tile cede. Everything else reads a fill perfectly well as it is, so this
     * is not a migration, it is a promotion at the moment it pays for itself.
     */
    fillToShapeById(id) {
        const rec = this.getById(id);
        if (!rec || rec.obj.type !== "fill") return null;
        const o = rec.obj;
        const loops = normalizeLoops(shapeFromRings(o.polys));
        if (!loops.length) return null;
        const oldBbox = this._bboxNow(o);
        o.type = "shape";
        o.loops = loops; flattenLoops(o);
        delete o.polys; delete o.covers;
        this._afterEdit(o, rec.level, oldBbox, 0);
        return rec;
    }

    _bboxNow(o) {
        if (o.type === "shape") return loopsBBox(o.loops) || { x0: 0, y0: 0, x1: 0, y1: 0 };
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const scan = (pts) => { for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } };
        if (o.type === "fill") { for (const poly of o.polys) scan(poly); } else scan(o.pts);
        return { x0, y0, x1, y1 };
    }
    _afterEdit(o, level, oldBbox, oldLw, oldBelow = undefined) {
        delete o._bbox; delete o._dispFlat; delete o._flat; delete o._outline; // geometry caches are stale
        o._ver = (o._ver || 0) + 1; // anything keyed on this object's state is stale too
        if (!this._pending.has(o)) { this._idx(level).remove(o); this._idx(level).add(o); }
        this._emit({ kind: "change", id: o.id, level, obj: o, oldBbox, oldLw, ...(oldBelow !== undefined ? { oldBelow } : {}) });
    }

    // Spatial query: indexed objects intersecting rect (lw-inflated bboxes),
    // plus every still-growing live stroke at that level (unindexable).
    queryRect(level, rect) {
        const k = String(level);
        const out = [];
        if (this._index[k]) this._index[k].query(rect, out);
        for (const o of this._pending) if (o._home === k) out.push(o);
        return out;
    }

    /**
     * What a frame holds, for a bake's whole-frame skip: the union box (linewidth included) and the
     * largest hypot(w,h)+lw, the pending strokes folded in. Null when the frame is empty.
     */
    frameExtent(level) {
        const k = String(level);
        const ix = this._index[k];
        let e = ix && ix.ext ? { ...ix.ext } : null, size = ix ? ix.maxSize : 0;
        for (const o of this._pending) {
            if (o._home !== k) continue;
            const b = this._bboxNow(o), lw = o.lwFrame || 0;
            if (!e) e = { x0: b.x0 - lw, y0: b.y0 - lw, x1: b.x1 + lw, y1: b.y1 + lw };
            else { e.x0 = Math.min(e.x0, b.x0 - lw); e.y0 = Math.min(e.y0, b.y0 - lw); e.x1 = Math.max(e.x1, b.x1 + lw); e.y1 = Math.max(e.y1, b.y1 + lw); }
            size = Math.max(size, Math.hypot(b.x1 - b.x0, b.y1 - b.y0) + lw);
        }
        return e ? { box: e, maxSize: size } : null;
    }

    // A move is a change of address plus a change of table (F55): undo puts the frame back, then the
    // table. `base`/`after` geometry is on ops from before A1 C2 only (the pen-up's walk into the cell,
    // `_normalizeHome`, deleted 2026-09-29), kept for their replay and inverses; `dx`/`dy` alone is a
    // pre-F41 entry, restored by an inverse translation.
    _undoMove(moves) {
        for (const m of moves) {
            if (m.from != null) this.rehomeById(m.id, m.from);
            if (m.base) this.setGeometryById(m.id, m.base);
            if ("belowBefore" in m) this.setOffsetsById(m.id, m.belowBefore);
            else if (!m.base) this.moveById(m.id, -m.dx, -m.dy);
        }
        return true;
    }
    _invertMove(m) {
        const inv = { id: m.id, dx: -m.dx, dy: -m.dy, from: m.to, to: m.from };
        if ("belowBefore" in m) { inv.belowBefore = m.belowAfter; inv.belowAfter = m.belowBefore; }
        if (m.base || m.after) { inv.base = m.after || null; inv.after = m.base || null; }
        return inv;
    }

    // ---- undo / redo (exact port of the old op-inversion semantics) ----
    pushUndo(op) {
        this._undo.push(op);
        const gone = this._undo.length > UNDO_CAP ? [this._undo.shift()] : [];
        for (const r of this._redo) gone.push(r);
        this._redo = []; // a fresh action forks history; the redo branch dies
        if (gone.length && this.onOpsDropped) this.onOpsDropped(gone);   // what they named may be collected (F94)
        this._notifyOps({ kind: "op", op });
    }
    /** Every frame an op in the undo or redo history names (`opFrames`): frame GC keeps them (F94). */
    namedFrames() {
        const out = new Set();
        for (const op of this._undo) opFrames(op, out);
        for (const op of this._redo) opFrames(op, out);
        return out;
    }
    /**
     * A frame the lattice forgot (frame GC, F94): its empty list, index and marks go. A set-aside
     * list goes with it: no op can bring it back, and its natives would read again as ghosts.
     */
    forgetFrame(frame) {
        const k = String(frame);
        const arr = this.nativesByLevel[k];
        if (arr && arr.length) return false;
        delete this.nativesByLevel[k]; delete this._index[k];
        for (const o of this._detachedLists.get(k) || []) {
            if (o._home !== k || this._byId.get(o.id) !== o) continue;
            this._byId.delete(o.id); this._offsetIds.delete(o.id); this._pending.delete(o);
        }
        this._detachedLists.delete(k);
        this._detached.delete(k); this._reused.delete(k);
        this._keyedIn.delete(k); this._detachedKeyed.delete(k);
        return true;
    }
    /** One collection's forgotten frames, for the op log's record (F94). */
    noteForgotten(frames) { if (frames.length) this._notifyOps({ kind: "forget", frames }); }
    // Whether there is anything to undo / redo. Rides the status payload out
    // to the toolbar, which greys its Undo and Redo buttons accordingly, so a
    // button that would do nothing does not look like one that would.
    canUndo() { return this._undo.length > 0; }
    canRedo() { return this._redo.length > 0; }
    undo() {
        const op = this._undo.pop();
        if (!op) return false;
        this._inUndo = true;
        let inv;
        try { inv = this._carrySeq(op, this._invert(op)); this._redo.push(inv); } finally { this._inUndo = false; }
        this._notifyOps({ kind: "undo", op });
        this.mergePending(inv);
        return true;
    }
    redo() {
        const op = this._redo.pop();
        if (!op) return false;
        this._inUndo = true;
        let inv;
        try { inv = this._carrySeq(op, this._invert(op)); this._undo.push(inv); } finally { this._inUndo = false; }
        this._notifyOps({ kind: "redo", op });
        this.mergePending(inv);
        return true;
    }
    // The log's seq rides an op's inverse (F71): a redo of an inverse without it read as
    // an op from before the log, and the saver reset the whole log for it.
    _carrySeq(op, inv) { if (inv !== op && op._seq != null && inv._seq == null) inv._seq = op._seq; return inv; }
    // Apply the inverse of `op` and return the op that re-applies it. The
    // "clear" op carries opaque `external` state (camera + crossings) that the
    // engine restores via the restoreExternal callback.
    _invert(op) {
        switch (op.op) {
            case "add": {
                const rec = this.removeById(op.id);
                return rec ? { op: "absent", obj: rec.obj, level: rec.level, index: rec.index } : op;
            }
            case "erase": {
                this.insertAt(op.obj, op.level, op.index);
                return { op: "present", id: op.obj.id };
            }
            case "absent": {
                this.insertAt(op.obj, op.level, op.index);
                return { op: "add", id: op.obj.id };
            }
            case "present": {
                const rec = this.removeById(op.id);
                return rec ? { op: "erase", obj: rec.obj, level: rec.level, index: rec.index } : op;
            }
            // A move is a change of address plus a change of table; undo puts the frame back first,
            // then the table (a pre-C2 op's geometry snapshots too). See _undoMove.
            case "move": return this._undoMove([op]) && { op: "move", ...this._invertMove(op) };
            case "moveMany": {
                this._undoMove(op.moves);
                return { op: "moveMany", moves: op.moves.map((m) => this._invertMove(m)) };
            }
            case "eraseMany": {
                for (let i = op.records.length - 1; i >= 0; i--) {
                    const rec = op.records[i];
                    if (!this.getById(rec.obj.id)) this.insertAt(rec.obj, rec.level, rec.index);
                }
                return { op: "removeMany", records: op.records };
            }
            case "removeMany": {
                for (const rec of op.records) this.removeById(rec.obj.id);
                return { op: "eraseMany", records: op.records };
            }
            // A deleted frame subtree, held as whole lists (SUBTREE-O1-PLAN §2.3): undo and redo
            // are the same records re-attached and re-detached by reference, O(frames).
            case "moveFrames": {
                // Frames first: a merge since the move is split back, then the start address and shift
                // come back, the shift being its natives' placement (A1 C1); the per-object moves follow
                // (DESIGN.md §8). An op from a store written before C1 subtracts its settle (legacy).
                for (const e of op.frames) {
                    if (e.merged) { for (let i = e.merged.length - 1; i >= 0; i--) this.unmerge(e.merged[i]); e.merged = null; }
                    if (e.settled) { unsettle(this, e.id, e.settled); delete e.settled; }
                }
                const was = new Map(op.frames.map((e) => { const f = this.lm.frame(e.id); return [e.id, f ? { parent: f.parent, i: f.cell.i, j: f.cell.j, shift: f.shift } : null]; }));
                this.lm.readdressMany(op.frames.map((e) => ({ id: e.id, depth: e.depth, parent: e.from.parent, i: e.from.i, j: e.from.j })),
                    { empty: (id) => this.count(id) === 0 });
                const inv = {
                    op: "moveFrames",
                    frames: op.frames.map((e) => ({ ...e, from: e.to, to: e.from, shiftBefore: e.shiftAfter, shiftAfter: e.shiftBefore, merged: null })),
                    moves: (op.moves || []).map((m) => this._invertMove(m)),
                };
                for (const e of inv.frames) {
                    this.setFrameShift(e.id, e.shiftAfter);
                    const w = was.get(e.id), f = this.lm.frame(e.id);
                    if (w && f) this.noteRefile(e.id, w, { parent: f.parent, i: f.cell.i, j: f.cell.j, shift: f.shift });
                }
                if (op.moves && op.moves.length) this._undoMove(op.moves);
                return inv;
            }
            case "removeFrames": {
                this.insertFrameSubtree(op.records);
                return { op: "eraseFrames", records: op.records };
            }
            case "eraseFrames": {
                for (const r of op.records) this.detachFrame(r.frame, r);
                return { op: "removeFrames", records: op.records };
            }
            // One gesture that deleted ids AND frames: the parts invert in reverse order, and the
            // op returned re-applies them in the original one.
            case "deleteMany": {
                const inverted = [];
                for (let i = op.parts.length - 1; i >= 0; i--) inverted.push(this._invert(op.parts[i]));
                return { op: "deleteMany", parts: inverted.reverse() };
            }
            // Deferred area erase. "eraseCommit" is pushed ONCE per eraser
            // gesture; background baking APPENDS to op.baked afterwards (no
            // ops of its own — Ctrl+Z must never undo a system-initiated
            // bake). The op object is MUTATED and reused across undo/redo so
            // the engine's append target stays valid.
            case "eraseCommit": {
                // Undo the whole gesture: its bake steps, and every step of any gesture that cut
                // what they made, newest first; then the eraser stroke itself (`_stepsUndo`).
                this._stepsUndo(op);
                op.strokeRec = this.removeById(op.strokeId); // null if baking consumed it
                op.op = "eraseRevert";
                return op;
            }
            case "eraseRevert": {
                // Redo: the eraser stroke (unless baking had consumed it), its steps in order, then
                // the suspended steps of applied gestures whose sources are back (`_stepsRedo`).
                if (op.strokeRec && !this.getById(op.strokeRec.obj.id)) {
                    this.insertAt(op.strokeRec.obj, op.strokeRec.level, op.strokeRec.index);
                }
                this._stepsRedo(op);
                op.op = "eraseCommit";
                return op;
            }
            case "clear": {
                const curNatives = this.nativesByLevel;
                const curExternal = op.onExternal ? op.onExternal() : undefined;
                this._replace(op.natives);
                if (op.restoreExternal) op.restoreExternal(op.external);
                return { ...op, natives: curNatives, external: curExternal };
            }
            default: return op;
        }
    }
    /**
     * The bake steps of every erase gesture in history, in the order they landed (`_seq`), with the
     * step that consumed each object and each step's gesture. Two marks pending at once bake out of
     * stack order: one's step can cut the other's piece, and then cut it again (REVIEWER-3 ERASE-2,
     * F118), so undo and redo follow what each step consumed, not the stack. A step carries `_on`
     * (applied); one rebuilt by a reload has none and is applied when its gesture is, its source is
     * gone, and the step that minted its source is applied.
     */
    _stepIndex(extra) {
        const consumed = new Map(), minted = new Map(), opOf = new Map(), steps = [], applied = new Set();
        const add = (op, on) => {
            if (op.op !== "eraseCommit" && op.op !== "eraseRevert") return;
            if (on) applied.add(op);
            for (const st of op.baked || []) {
                if (st._seq == null) st._seq = ++this._stepSeq;
                opOf.set(st, op); steps.push(st);
                if (!st.removed || !st.pieces) continue;
                consumed.set(st.removed.obj.id, st);
                for (const pc of st.pieces) minted.set(pc.obj.id, st);
            }
        };
        for (const op of this._undo) add(op, true);
        for (const op of this._redo) add(op, false);
        if (extra && !opOf.has((extra.baked || [])[0])) add(extra, extra.op === "eraseCommit");
        for (const st of steps.filter((x) => x._on === undefined).sort((x, y) => x._seq - y._seq)) {
            if (!applied.has(opOf.get(st))) { st._on = false; continue; }
            if (!st.removed || !st.pieces) { st._on = true; continue; }
            const m = minted.get(st.removed.obj.id);
            st._on = !this.getById(st.removed.obj.id) && (!m || m._on !== false);
        }
        return { consumed, opOf, steps, applied };
    }
    _revertStep(st) {
        st._on = false;
        // A frame the mark covered whole went as containers: its lists come back by reference.
        if (st.frames) { this.insertFrameSubtree(st.frames); return; }
        // A severance's re-key: nothing geometric moved, so it just runs backwards.
        if (st.rekey) { for (const r of st.rekey) { const o = this.getById(r.id); if (o) Object.assign(o.obj, r.before); } this.keysChanged(st.rekey.map((r) => r.id)); return; }
        // The source comes back only for pieces this step still owns: ones something unrecorded took (a
        // stale replay) are that thing's ink now, and the source over them stacked ink twice.
        let took = st.pieces.length === 0;
        for (const pc of st.pieces) if (this.removeById(pc.obj.id)) took = true;
        if (took && !this.getById(st.removed.obj.id)) this.insertAt(st.removed.obj, st.removed.level, st.removed.index);
    }
    /** Re-applies a step whose source is in the document; false (still suspended) when it is not. */
    _applyStep(st) {
        if (st.frames) { for (const r of st.frames) this.detachFrame(r.frame, r); st._on = true; return true; }
        if (st.rekey) { for (const r of st.rekey) { const o = this.getById(r.id); if (o) Object.assign(o.obj, r.after); } this.keysChanged(st.rekey.map((r) => r.id)); st._on = true; return true; }
        const r = this.removeById(st.removed.obj.id);
        if (!r) return false;
        st.removed = r;   // what this redo took out is what its undo puts back (F70)
        for (const pc of st.pieces) if (!this.getById(pc.obj.id)) this.insertAt(pc.obj, pc.level, 1e9);
        st._on = true;
        return true;
    }
    /** Undo of an erase gesture: its applied steps and every applied step that consumed what they made, newest first. */
    _stepsUndo(op) {
        const ix = this._stepIndex(op);
        const S = new Set(op.baked.filter((st) => st._on !== false));
        const stack = [...S];
        while (stack.length) {
            const t = stack.pop();
            for (const pc of t.pieces || []) {
                const c = ix.consumed.get(pc.obj.id);
                if (c && c._on !== false && !S.has(c)) { S.add(c); stack.push(c); }
            }
        }
        for (const st of [...S].sort((a, b) => b._seq - a._seq)) this._revertStep(st);
    }
    /** Redo: its steps in order where their sources are back, then any suspended step of an applied gesture whose source is. */
    _stepsRedo(op) {
        const ix = this._stepIndex(op);
        for (const st of [...op.baked].sort((a, b) => a._seq - b._seq)) this._applyStep(st);
        const waiting = ix.steps.filter((st) => st._on === false && ix.opOf.get(st) !== op && ix.applied.has(ix.opOf.get(st))).sort((x, y) => x._seq - y._seq);
        for (let changed = true; changed;) {
            changed = false;
            for (const st of waiting) if (st._on === false && this._applyStep(st)) changed = true;
        }
    }
    // Wipe the document. `external` is whatever engine state must round-trip
    // with it (old engine restored camera + crossings on undo-of-clear).
    // onExternal captures the CURRENT external state when the op inverts;
    // restoreExternal reinstates a captured one.
    clear(external, onExternal, restoreExternal) {
        this.pushUndo({ op: "clear", natives: this.nativesByLevel, external, onExternal, restoreExternal });
        this._replace({ 0: [] });
    }
    // `load`: the reset comes from a file (loadNatives), not from an edit — the
    // cloud sync must not treat what it just pulled as new work.
    _replace(natives, load = false) {
        this.nativesByLevel = natives;
        this._index = {};
        this._pending = new Set();
        this._byId = new Map();
        this._offsetIds = new Set();
        this._detached = new Set();
        this._detachedLists = new Map();
        this._reused = new Set();
        this._keyedIn = new Map();
        this._detachedKeyed = new Map();
        for (const Ls of Object.keys(natives)) {
            for (const o of natives[Ls] || []) { o._home = Ls; this._byId.set(o.id, o); this._noteBelow(o); this._idx(Ls).add(o); this._keyIn(Ls, o); }
        }
        this._emit(load ? { kind: "reset", load: true } : { kind: "reset" });
    }

    // ---- natives (de)serialization (dev-0 payload shape, reused by kobin-1) ----
    // Whitelist per type so runtime-only fields (_home, _bbox, caches)
    // never leak into a file. `z` is written only when it differs from the id
    // (cut pieces inheriting their source's depth) — dev-0 snapshots round-trip
    // byte-identical.
    //
    // `only`: a list of frame ids to serialize, or null for every frame. The
    // autosave writes one record per frame and knows which frames changed
    // (every event this class emits carries its frame), so it asks for those
    // alone rather than walking a drawing that is mostly untouched.
    serializeNatives(only = null) {
        const natives = {};
        const keys = only == null
            ? Object.keys(this.nativesByLevel)
            : only.map(String).filter((l) => this.nativesByLevel[l]);
        for (const l of keys) {
            // The header fields are format2.objectHeader, shared with the kobin-2
            // store so the two forms agree field for field. The resolved perimeter
            // IS the object, so it is what gets written; tile, below and attachRect
            // are geometry (drop them and a reloaded drawing chops or sits somewhere
            // else); a pending eraser stroke rides erase so baking resumes after a
            // reload.
            natives[l] = (this.nativesByLevel[l] || []).map((o) => objectHeader(o,
                o.type === "shape" ? { loops: encodeLoops(o.loops) }
                    : o.type === "fill" ? { polys: o.polys } : { pts: o.pts }));
        }
        return natives;
    }
    loadNatives(snapNatives) {
        if (!snapNatives) return false;
        const natives = {};
        let maxId = 0;
        for (const l of Object.keys(snapNatives)) {
            natives[l] = snapNatives[l].map(nativeFromRecord);
            // editId is drawn from the SAME counter as ids (a severance mints a
            // fresh family key), and a key belonging to no object still must
            // never be handed out as an id later — an object whose id happened to
            // equal a live family key would silently join that family.
            for (const o of natives[l]) {
                if (o.id >= maxId) maxId = o.id;
                if (o.editId != null && o.editId >= maxId) maxId = o.editId;
            }
        }
        this._nextId = Math.max(this._nextId, maxId + 1); // never reuse an id
        // A drawing saved by a build that stranded empty buckets (`_forgetIfEmpty`)
        // would bring them straight back, and they cost on every render for the
        // rest of the session. Dropping them here is what repairs the drawings
        // that already carry thousands.
        for (const l of Object.keys(natives)) if (!natives[l].length) delete natives[l];
        this._undo = []; this._redo = [];
        this._replace(natives, true);
        return true;
    }
}
