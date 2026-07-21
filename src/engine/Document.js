/**
 * Document — the source of truth. Owns every native object, the global id
 * sequence (id = creation order = global z-order), the undo/redo stacks, and
 * the dev-0 snapshot (de)serialization of the natives. No Two.js, no camera,
 * no tiles.
 *
 * Objects are stored per HOME level (the level they were drawn at) and their
 * geometry is immutable once finalized — everything shown at other levels is a
 * derived copy carrying the source id, which is why removeById() is enough to
 * erase an object "everywhere".
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
        const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const scan = (pts) => { for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } };
        if (o.type === "fill") { for (const poly of o.polys) scan(poly); } else scan(o.pts);
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
        if (o.type === "fill") { for (const poly of o.polys) shift(poly); } else shift(o.pts);
        this._afterEdit(o, rec.level, oldBbox, o.lwFrame);
        return rec;
    }
    // patch ⊂ { color, opacity, lwFrame }. Returns { obj, level, before, after }
    // (before/after hold only the touched keys — the undo op's payload).
    restyleById(id, patch) {
        const rec = this.getById(id);
        if (!rec) return null;
        const o = rec.obj;
        const before = {}, after = {};
        const oldLw = o.lwFrame;
        for (const k of ["color", "opacity", "lwFrame"]) {
            if (patch[k] === undefined || patch[k] === o[k]) continue;
            before[k] = o[k]; after[k] = patch[k];
            o[k] = patch[k];
        }
        if (Object.keys(after).length) this._afterEdit(o, rec.level, this._bboxNow(o), oldLw);
        return { ...rec, before, after };
    }
    // Replace a stroke with the pieces a boolean erase left of it (true erase).
    // The pieces are NEW natives (fresh ids) that inherit the source's z, so
    // they keep drawing at the original's depth. Emits remove + adds — the
    // TileStore invalidates the old footprint and each piece's new one.
    cutById(id, runs) {
        const rec = this.removeById(id);
        if (!rec) return null;
        const src = rec.obj;
        const z = src.z != null ? src.z : src.id;
        const pieces = runs.map((pts) => this.add({
            type: "stroke", origin: src.origin, id: this.allocId(), z, pts,
            lwFrame: src.lwFrame, color: src.color, opacity: src.opacity, paths: [],
        }, rec.level));
        return { removed: rec, pieces };
    }
    // Replace a native with the region(s) an AREA erase left of its ink. Each
    // region (rings: outer + holes) becomes its own fill native with a fresh
    // id inheriting the source's z/color/opacity — disjoint leftovers select
    // and re-erase independently, with tight bboxes. Same event/undo shape
    // as cutById.
    eraseReplaceById(id, regions) {
        const rec = this.removeById(id);
        if (!rec) return null;
        const src = rec.obj;
        const z = src.z != null ? src.z : src.id;
        const pieces = regions.map((polys) => this.add({
            type: "fill", origin: src.origin, id: this.allocId(), z, polys,
            color: src.color, opacity: src.opacity, paths: [],
        }, rec.level));
        return { removed: rec, pieces };
    }
    _bboxNow(o) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const scan = (pts) => { for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } };
        if (o.type === "fill") { for (const poly of o.polys) scan(poly); } else scan(o.pts);
        return { x0, y0, x1, y1 };
    }
    _afterEdit(o, level, oldBbox, oldLw) {
        delete o._bbox; delete o._dispFlat; delete o._flat; delete o._outline; // geometry caches are stale
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

    // ---- undo / redo (exact port of the old op-inversion semantics) ----
    pushUndo(op) {
        this._undo.push(op);
        if (this._undo.length > 200) this._undo.shift();
        this._redo = []; // a fresh action forks history; the redo branch dies
    }
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
            case "move": {
                this.moveById(op.id, -op.dx, -op.dy);
                return { op: "move", id: op.id, dx: -op.dx, dy: -op.dy };
            }
            case "restyle": {
                this.restyleById(op.id, op.before);
                return { op: "restyle", id: op.id, before: op.after, after: op.before };
            }
            // "cut" = the boolean erase HAS been applied (original out, pieces
            // in). Undoing removes the pieces (reverse replay needs reverse
            // insertion, so record them in order and re-insert reversed) and
            // restores the original at its remembered index.
            case "cut": {
                const pcs = op.pieces.map(({ obj }) => this.removeById(obj.id)).filter(Boolean);
                this.insertAt(op.removed.obj, op.removed.level, op.removed.index);
                return { op: "uncut", removed: op.removed, pieces: pcs };
            }
            case "uncut": {
                const r = this.removeById(op.removed.obj.id);
                const pcs = [...op.pieces].reverse();
                for (const pc of pcs) this.insertAt(pc.obj, pc.level, pc.index);
                return { op: "cut", removed: r || op.removed, pieces: op.pieces };
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
                const rec = o.type === "fill"
                    ? { type: o.type, origin: o.origin, id: o.id, polys: o.polys, color: o.color, opacity: o.opacity }
                    : { type: o.type, origin: o.origin, id: o.id, pts: o.pts, lwFrame: o.lwFrame, color: o.color, opacity: o.opacity };
                if (o.type === "fill" && o.covers) rec.covers = true;
                if (o.z != null && o.z !== o.id) rec.z = o.z;
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
            natives[l] = snapNatives[l].map((o) => ({ ...o, paths: [] }));
            for (const o of natives[l]) if (o.id >= maxId) maxId = o.id;
        }
        this._nextId = Math.max(this._nextId, maxId + 1); // never reuse an id
        this._undo = []; this._redo = [];
        this._replace(natives);
        return true;
    }
}
