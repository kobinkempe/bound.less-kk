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
    subtractShape, rectLoop, shapeComponents, dropDust, repairLoops,
} from "./geometry/arcShape";
import { tilePhase, childTilePhase } from "./frameLattice";

const CELL = 2048;          // frame units; typical strokes span 10-1000
const BIG = CELL * 4;       // larger than this goes to the per-level overflow list

class LevelIndex {
    constructor() { this.cells = new Map(); this.big = new Set(); this.boxes = new Map(); this.objs = new Map(); }
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
        // A query rect spanning more cells than we have objects (or absurdly many)
        // makes the cell walk pathological — a magnified region can cover billions
        // of cells. Fall back to a flat scan, which is bounded by the object count.
        const nx = Math.floor(q.x1 / CELL) - Math.floor(q.x0 / CELL) + 1;
        const ny = Math.floor(q.y1 / CELL) - Math.floor(q.y0 / CELL) + 1;
        if (nx * ny > 4096 || nx * ny > this.objs.size) {
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

export default class Document {
    constructor() {
        this.nativesByLevel = { 0: [] }; // level -> [objects] (numeric keys as strings, like dev-0)
        this._nextId = 1;
        this._undo = []; this._redo = [];
        this._subs = new Set();
        this._index = {};                // level -> LevelIndex
        this._pending = new Set();       // live strokes: in natives, not yet indexed
    }

    // ---- events ----
    subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
    _emit(ev) { for (const fn of this._subs) fn(ev); }

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
    at(level) { return this.nativesByLevel[level] || []; }
    _idx(level) { const k = String(level); return this._index[k] || (this._index[k] = new LevelIndex()); }

    // Add a newly drawn object as a native of `level`. `live` = still growing
    // (a stroke between pointerDown and pointerUp): kept out of the spatial
    // index until finalize().
    add(o, level, { live = false } = {}) {
        const k = String(level);
        if (!this.nativesByLevel[k]) this.nativesByLevel[k] = [];
        this.nativesByLevel[k].push(o);
        o._home = k;
        if (live) this._pending.add(o);
        else this._idx(k).add(o);
        this._emit({ kind: "add", id: o.id, level: k, obj: o, live });
        return o;
    }
    // The stroke is done: geometry is immutable from here on -> index it and
    // re-announce (subscribers invalidate against the FINAL bbox).
    finalize(o) {
        if (!this._pending.delete(o)) return;
        this._idx(o._home).add(o);
        this._emit({ kind: "finalize", id: o.id, level: o._home, obj: o });
    }

    // Find a native by id (same scan removeById does, without the splice).
    // `level` in the returned record is the FRAME id (string) the object homes in.
    getById(id) {
        for (const Ls of Object.keys(this.nativesByLevel)) {
            const arr = this.nativesByLevel[Ls];
            const o = arr && arr.find((x) => x.id === id);
            if (o) return { obj: o, level: Ls };
        }
        return null;
    }

    // Re-homed boundary patches share one logical editing identity even though
    // their geometry lives in several frames. Fully enclosed leftovers have no
    // editId and therefore remain ordinary, independently editable natives.
    editKey(o) { return o && o.editId != null ? o.editId : o && o.id; }
    editGroup(idOrObj) {
        const rec = typeof idOrObj === "object" ? { obj: idOrObj } : this.getById(idOrObj);
        const key = rec ? this.editKey(rec.obj) : idOrObj;
        if (key == null) return [];
        const out = [];
        for (const level of Object.keys(this.nativesByLevel)) {
            for (const obj of this.nativesByLevel[level] || []) {
                if (this.editKey(obj) === key) out.push({ obj, level });
            }
        }
        return out;
    }

    // Remove a native by id from whichever frame holds it (derived copies carry
    // the source id, so this is "erase everywhere").
    removeById(id) {
        for (const Ls of Object.keys(this.nativesByLevel)) {
            const arr = this.nativesByLevel[Ls];
            const i = arr ? arr.findIndex((o) => o.id === id) : -1;
            if (i < 0) continue;
            const [obj] = arr.splice(i, 1);
            this._pending.delete(obj);
            this._idx(Ls).remove(obj);
            this._forgetIfEmpty(Ls);
            this._emit({ kind: "remove", id, level: Ls, obj });
            return { obj, level: Ls, index: i };
        }
        return null;
    }
    // Re-insert at a remembered position (undo of an erase). Position only
    // affects the array; z-order is by id, which the object kept.
    insertAt(obj, level, index) {
        const k = String(level);
        if (!this.nativesByLevel[k]) this.nativesByLevel[k] = [];
        const arr = this.nativesByLevel[k];
        arr.splice(Math.min(index, arr.length), 0, obj);
        obj._home = k;
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
            o.loops = translateLoops(o.loops, dx, dy);
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
        if (o.type === "shape") o.loops = geom.loops;
        else if (o.type === "fill") o.polys = geom.polys;
        else o.pts = geom.pts;
        if (geom.attachRect) o.attachRect = { ...geom.attachRect };
        if (geom.tile) o.tile = [geom.tile[0], geom.tile[1]];
        this._afterEdit(o, rec.level, oldBbox, o.lwFrame);
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
        if (o.type === "shape") return { loops: o.loops, tile, attachRect: o.attachRect ? { ...o.attachRect } : null };
        if (o.type === "fill") return { polys: o.polys.map((p) => p.map((q) => [q[0], q[1]])), tile, attachRect: o.attachRect ? { ...o.attachRect } : null };
        return { pts: o.pts.map((q) => [q[0], q[1]]), tile, attachRect: o.attachRect ? { ...o.attachRect } : null };
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
        this._forgetIfEmpty(rec.level);
        // Tagged `rehome` because it is NOT a deletion followed by a creation.
        // Caches want the remove/add pair (the object's footprint really did
        // change frames); anything tracking IDENTITY — a selection being
        // dragged, most of all — must not read it as the object going away, or
        // a drag drops every member the moment it re-homes and the rest of the
        // gesture moves only what happened to stay put.
        this._emit({ kind: "remove", id, level: rec.level, obj: o, rehome: k });
        if (!this.nativesByLevel[k]) this.nativesByLevel[k] = [];
        this.nativesByLevel[k].push(o);
        o._home = k;
        if (!wasPending) this._idx(k).add(o);
        o._ver = (o._ver || 0) + 1;
        this._emit({ kind: "add", id, level: k, obj: o, live: wasPending, rehome: rec.level });
        return { obj: o, level: k };
    }

    // Replace a native with the region(s) an AREA erase left of its ink. Each
    // region (outer ring plus its holes) becomes its own native with a fresh id
    // inheriting the source's z/colour/opacity — disjoint leftovers select and
    // re-erase independently, with tight bboxes. This is what replaced the old
    // centerline cut: an erase now yields REGIONS, not pieces of a polyline.
    eraseReplaceById(id, regions) {
        const rec = this.removeById(id);
        if (!rec) return null;
        const src = rec.obj;
        const z = src.z != null ? src.z : src.id;
        const editKey = this.editKey(src);
        const pieces = regions.map((loops) => {
            const obj = {
                type: "shape", origin: src.origin, id: this.allocId(), z, loops,
                color: src.color, opacity: src.opacity, paths: [],
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
            return this.add(obj, rec.level);
        });
        return { removed: rec, pieces };
    }
    /**
     * CEDE A TILE (bible §2.1). The parent's ink is CUT: `holeInParent` is
     * removed from it exactly, and the ink that was inside becomes new natives
     * at `level` — the level the erase was made at, where everything is
     * screen-scale.
     *
     * The parent is genuinely cut rather than merely recording a rect it has
     * given away, and the difference matters twice over. Underneath a ceded
     * rect the old model left the parent whole, so two lumps that the child had
     * separated were still one polygon up here and severance had to re-cut them
     * later, from bounding boxes, badly. And a parent that is whole has to have
     * its hole subtracted at RENDER time, per view, which is what `ownContent`
     * was and what made zooming slow and stale.
     *
     * The cut is precision-safe in a way that baking the ERASE into the parent
     * never was: a tile is 12.8 parent units, 1/3000 of the parent's own frame.
     * cedeRect is float-only, so the surviving edge IS the rect's coordinates.
     *
     * The parent may fall into several connected pieces; they all stay in one
     * edit family, and so do the children. Whether that family is still one
     * OBJECT is a separate question, answered over the whole family at once.
     */
    cedeTileById(id, level, regions, holeInParent, attachRect, kidTile) {
        const rec = this.getById(id);
        if (!rec) return null;
        const src = rec.obj;
        if (src.type === "fill") this.fillToShapeById(id);
        if (src.type !== "shape") return null;     // callers resolve strokes first
        // The parent's hole is cut EXACTLY: subtracting an axis-aligned rect from
        // a resolved perimeter is the same closed-form boolean everything else
        // here uses. `cedeRect`'s float guillotine existed to avoid Clipper's
        // lattice on this one operation; with no lattice anywhere there is
        // nothing left for a special case to protect against, and the surviving
        // edge IS the rect's coordinates either way.
        const R = { left: holeInParent.x0, top: holeInParent.y0, right: holeInParent.x1, bottom: holeInParent.y1 };
        // Local to the rect: at depth the parent's coordinates run to 1e13 while
        // the ceded tile is a few units across.
        const cx = (R.left + R.right) / 2, cy = (R.top + R.bottom) / 2;
        const local = translateLoops(src.loops, -cx, -cy);
        const lrect = { left: R.left - cx, top: R.top - cy, right: R.right - cx, bottom: R.bottom - cy };
        const cut = subtractShape(local, rectLoop(lrect)).loops;
        // Cutting a rect out can leave a sliver along one of its edges, where
        // the parent's boundary all but grazed it. That sliver is dust, and a
        // dust native is a speck the user later finds and cannot get rid of.
        const groups = dropDust(shapeComponents(cut), src.w).map((g) => translateLoops(g, cx, cy));
        const removed = this.removeById(id);
        if (!removed) return null;
        const z = src.z != null ? src.z : src.id;
        const editKey = this.editKey(src);
        const mk = (loops, lvl, attach, tile) => {
            const obj = {
                type: "shape", origin: src.origin, id: this.allocId(), z, loops,
                color: src.color, opacity: src.opacity, paths: [], editId: editKey,
            };
            if (src.w > 0) obj.w = src.w;
            if (attach) obj.attachRect = { ...attach };
            // D4: "The object is a logical object - if it's been erased and
            // that created child-ceded zones, the child objects go with it and
            // have the same tile/clip-boundary structure." What is left of the
            // parent keeps the parent's grid; what moved a level down gets that
            // same grid expressed in the child's units, so a family clips on
            // ONE partition at every level and a doorway still lands on the cut
            // that made it.
            if (tile) obj.tile = [tile[0], tile[1]];
            return { obj: this.add(obj, lvl), level: String(lvl) };
        };
        // What is left of the parent, one native per connected piece...
        const parents = groups.map((loops) => mk(loops, removed.level, src.attachRect, src.tile));
        // ...and what now lives in the tile.
        const kids = regions.map((r) => mk(r.loops || r, level, attachRect, kidTile));
        return { removed, parents, kids, pieces: parents.concat(kids) };
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
        o.loops = loops;
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
        o.loops = loops;
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
    _afterEdit(o, level, oldBbox, oldLw) {
        delete o._bbox; delete o._dispFlat; delete o._flat; delete o._outline; // geometry caches are stale
        o._ver = (o._ver || 0) + 1; // anything keyed on this object's state is stale too
        if (!this._pending.has(o)) { this._idx(level).remove(o); this._idx(level).add(o); }
        this._emit({ kind: "change", id: o.id, level, obj: o, oldBbox, oldLw });
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

    _undoMove(moves) {
        for (const m of moves) {
            if (m.from != null) this.rehomeById(m.id, m.from);
            if (m.base) this.setGeometryById(m.id, m.base);
            else this.moveById(m.id, -m.dx, -m.dy);
        }
        return true;
    }
    _invertMove(m) {
        return { id: m.id, dx: -m.dx, dy: -m.dy, from: m.to, to: m.from, base: m.after || null, after: m.base || null };
    }

    // ---- undo / redo (exact port of the old op-inversion semantics) ----
    pushUndo(op) {
        this._undo.push(op);
        if (this._undo.length > 200) this._undo.shift();
        this._redo = []; // a fresh action forks history; the redo branch dies
    }
    // Whether there is anything to undo / redo. Rides the status payload out
    // to the toolbar, which greys its Undo and Redo buttons accordingly, so a
    // button that would do nothing does not look like one that would.
    canUndo() { return this._undo.length > 0; }
    canRedo() { return this._redo.length > 0; }
    undo() {
        const op = this._undo.pop();
        if (!op) return false;
        this._redo.push(this._invert(op));
        return true;
    }
    redo() {
        const op = this._redo.pop();
        if (!op) return false;
        this._undo.push(this._invert(op));
        return true;
    }
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
            // A move is an ADDRESS change plus a sub-cell translation, so undo is
            // both, in that order — the frame first, because the translation is
            // expressed in the frame it belongs to and the two frames' units are
            // the same only because they are at the same depth.
            // A move is an ADDRESS change plus a sub-cell translation. Undo puts
            // both back — and it restores the geometry the drag started from
            // rather than translating by the negative, so the round trip is
            // bit-exact instead of a float's width away.
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
            // Deferred area erase. "eraseCommit" is pushed ONCE per eraser
            // gesture; background baking APPENDS to op.baked afterwards (no
            // ops of its own — Ctrl+Z must never undo a system-initiated
            // bake). The op object is MUTATED and reused across undo/redo so
            // the engine's append target stays valid.
            case "eraseCommit": {
                // Undo the whole gesture: reverse its bakes newest-first,
                // then take the white eraser stroke itself out of the doc.
                // Replay is RESILIENT: deferred baking means a step's objects
                // can have been consumed by a LATER erase in the meantime, so
                // never insert an object whose ink is already represented —
                // stale replays were how duplicated, stacked geometry formed.
                for (let i = op.baked.length - 1; i >= 0; i--) {
                    const st = op.baked[i];
                    // Identity-only step: a severance re-pointed part of the
                    // family at a new parent and gave it a new edit key. Nothing
                    // geometric moved, so this just runs backwards.
                    if (st.rekey) {
                        for (const r of st.rekey) {
                            const o = this.getById(r.id);
                            if (o) Object.assign(o.obj, r.before);
                        }
                        continue;
                    }
                    let took = st.pieces.length === 0; // whole-removal bake: nothing to take out
                    for (const pc of st.pieces) if (this.removeById(pc.obj.id)) took = true;
                    if (took && !this.getById(st.removed.obj.id)) {
                        this.insertAt(st.removed.obj, st.removed.level, st.removed.index);
                    }
                }
                op.strokeRec = this.removeById(op.strokeId); // null if baking consumed it
                op.op = "eraseRevert";
                return op;
            }
            case "eraseRevert": {
                // Redo: restore the eraser stroke (unless it had been fully
                // consumed) and re-apply every bake in order — skipping any
                // step whose source has since been consumed elsewhere (its
                // ink lives in that later bake's pieces now).
                if (op.strokeRec && !this.getById(op.strokeRec.obj.id)) {
                    this.insertAt(op.strokeRec.obj, op.strokeRec.level, op.strokeRec.index);
                }
                for (const st of op.baked) {
                    if (st.rekey) {
                        for (const r of st.rekey) {
                            const o = this.getById(r.id);
                            if (o) Object.assign(o.obj, r.after);
                        }
                        continue;
                    }
                    const r = this.removeById(st.removed.obj.id);
                    if (!r && st.pieces.length) continue;
                    for (const pc of st.pieces) {
                        if (!this.getById(pc.obj.id)) this.insertAt(pc.obj, pc.level, 1e9);
                    }
                }
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
    // Wipe the document. `external` is whatever engine state must round-trip
    // with it (old engine restored camera + crossings on undo-of-clear).
    // onExternal captures the CURRENT external state when the op inverts;
    // restoreExternal reinstates a captured one.
    clear(external, onExternal, restoreExternal) {
        this.pushUndo({ op: "clear", natives: this.nativesByLevel, external, onExternal, restoreExternal });
        this._replace({ 0: [] });
    }
    _replace(natives) {
        this.nativesByLevel = natives;
        this._index = {};
        this._pending = new Set();
        for (const Ls of Object.keys(natives)) {
            for (const o of natives[Ls] || []) { o._home = Ls; this._idx(Ls).add(o); }
        }
        this._emit({ kind: "reset" });
    }

    // ---- natives (de)serialization (dev-0 payload shape, reused by kobin-1) ----
    // Whitelist per type so runtime-only fields (_home, _bbox, paths, caches)
    // never leak into a file. `z` is written only when it differs from the id
    // (cut pieces inheriting their source's depth) — dev-0 snapshots round-trip
    // byte-identical.
    serializeNatives() {
        const natives = {};
        for (const l of Object.keys(this.nativesByLevel)) {
            natives[l] = (this.nativesByLevel[l] || []).map((o) => {
                let rec;
                if (o.type === "shape") {
                    // The resolved perimeter IS the object, so it is what gets
                    // written. It is also SMALLER than the samples it came from
                    // on anything dense — burial culling throws most of the
                    // chain away — so this costs nothing on the files that would
                    // have hurt.
                    rec = { type: "shape", origin: o.origin, id: o.id, loops: encodeLoops(o.loops), color: o.color, opacity: o.opacity };
                } else if (o.type === "fill") {
                    rec = { type: o.type, origin: o.origin, id: o.id, polys: o.polys, color: o.color, opacity: o.opacity };
                } else {
                    rec = { type: o.type, origin: o.origin, id: o.id, pts: o.pts, lwFrame: o.lwFrame, color: o.color, opacity: o.opacity };
                }
                if (o.type === "fill" && o.covers) rec.covers = true;
                if (o.type === "shape" && o.w > 0) rec.w = o.w;
                if (o.z != null && o.z !== o.id) rec.z = o.z;
                // A re-homed piece records the tile it fills, in its OWN frame.
                // That rect is where it meets the rest of its object, and is all
                // the connectivity check needs.
                if (o.editId != null) rec.editId = o.editId;
                if (o.attachRect) rec.attachRect = { ...o.attachRect };
                // Where the object gets CHOPPED (bible D4/6.6). Two numbers, and
                // they are geometry: drop them and a reloaded drawing subdivides
                // somewhere else, which moves every frozen chord in it.
                if (o.tile && (o.tile[0] || o.tile[1])) rec.tile = [o.tile[0], o.tile[1]];
                // Pending eraser strokes (deferred area erase) must survive a
                // save so baking can resume after a reload.
                if (o.erase) { rec.erase = true; if (o.bakePx != null) rec.bakePx = o.bakePx; }
                return rec;
            });
        }
        return natives;
    }
    loadNatives(snapNatives) {
        if (!snapNatives) return false;
        const natives = {};
        let maxId = 0;
        for (const l of Object.keys(snapNatives)) {
            natives[l] = snapNatives[l].map((o) => {
                // RETIRED FIELDS. Drawings saved before 2026-08-06 recorded a
                // deep erase as a `windows` rect on a parent that kept its whole
                // geometry, plus a `srcId` back-pointer on each re-homed child.
                // Both are gone — the parent's rings are cut now — and nothing
                // reads them. Strip them at the door rather than carry inert
                // state that still looks meaningful: such a file renders as
                // though nothing had ever been erased, and a field recording
                // where the hole SHOULD have been is worse than no field at all.
                // Kobin's call was that no migration is owed; the affected
                // drawings were throwaway.
                const { windows, srcId, ...keep } = o;
                if (keep.type === "shape" && Array.isArray(keep.loops)) {
                    // Repair on the way IN, so a drawing damaged by an older
                    // build opens, renders and — the part that matters — saves.
                    return { ...keep, loops: repairLoops(decodeLoops(keep.loops), keep.w), paths: [] };
                }
                // A `fill` native is a drawing from before the arc pipeline. It
                // stays a fill: rendering and tiles already speak polygons, and
                // converting at the door would be the one expensive thing a load
                // does — one recorded drawing carries a 1.8-million-vertex fill,
                // and turning that into arc pieces costs more than everything
                // else on the way in put together. `fillToShapeById` converts one
                // when something actually needs to cut it, which is the only time
                // the arc form buys anything.
                return { ...keep, paths: [] };
            });
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
        this._replace(natives);
        return true;
    }
}
