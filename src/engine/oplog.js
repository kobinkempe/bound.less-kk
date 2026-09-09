/**
 * oplog.js — the kobin-2 op log on the engine side (DESIGN.md §13; the design and its
 * stages in .claude/SAVE-FORMAT-PLAN.md).
 *
 * WHAT IT RECORDS. Every fresh undo op, every bake step a pending eraser appends to
 * its gesture, a mark consumed, every undo and redo, and every object whose geometry
 * changed under no op of its own (a stroke resolving into its perimeter, a fill
 * converting), as ENTRIES carrying results: the objects removed and made, never a
 * gesture to recompute. A replayed bake would differ across code versions; a stored
 * result cannot.
 *
 * WHAT IT IS FOR. The saver appends the tick's entries to the store and rewrites a
 * frame's snapshot only when its entries have outgrown it, so a small edit is a small
 * write; on load the entries after each frame's snapshot are replayed onto it, the
 * undo/redo stacks come back from the same entries, and a pending eraser's done set
 * is the ids its bake entries name, so it picks up where it left off.
 *
 * ORDER. Entries take their seq when the event happens, in event order; an `add`, a
 * `mark` and a `put` encode at drain time (a stroke has resolved by then) but keep the
 * array index they had when the op landed; a bake step encodes the moment it lands
 * (its pieces may be cut again before the tick). Every apply on replay is idempotent,
 * and an entry whose frames all hold a newer snapshot is skipped — an undo or redo
 * included, whose inverse is then built from the entry's own data.
 */
import { encodeEntry, decodeEntry } from "./format2";
import { nativeFromRecord } from "./Document";

const lvl = (v) => (v == null ? null : String(v));
const EMPTY = new Float64Array(0);

export class OpLog {
    constructor(engine) {
        this.E = engine;
        this.doc = engine.doc;
        this.seq = 0;                 // the last seq handed out; the store's on attach
        this.queue = [];              // this tick's items, in event order
        this.queued = new Map();      // id -> queue item of its pending add/mark/put (coalescing)
        this.removed = new Map();     // id -> { obj, level } removed this tick
        this.forced = new Set();      // frames that must snapshot this tick (undo, redo, moves)
        this.needFull = false;        // something no entry can say (a clear, a reset)
        this._unsub = [
            this.doc.subscribe((ev) => this._onEvent(ev)),
            this.doc.subscribeOps((ev) => this._onOp(ev)),
        ];
    }
    detach() { for (const u of this._unsub) u(); this._unsub = []; }

    // ---- recording ----
    _next() { return ++this.seq; }
    _indexOf(id) {
        const cur = this.doc.getById(id);
        return cur ? this.doc.at(cur.level).indexOf(cur.obj) : null;
    }
    _onEvent(ev) {
        if (this.replaying) return;      // the replay's own inserts and removals are not new work
        if (ev.kind === "reset") { if (!ev.load) this.needFull = true; return; }
        if (ev.kind === "remove" && ev.obj) {
            this.removed.set(ev.id, { obj: ev.obj, level: lvl(ev.level), index: null });
            // A mark the bake consumed: no op of its own, so the log says so.
            if (ev.obj.erase && !this.doc._inUndo) {
                this.queue.push({ seq: this._next(), k: "spent", touches: [lvl(ev.level)], encoded: { op: { k: "spent", id: ev.id, level: lvl(ev.level) }, geo: EMPTY } });
            }
            return;
        }
        if (ev.kind !== "change" || ev.offsetsOnly || this.doc._inUndo) return;
        // Geometry changed under no op of its own: a `put` of the whole object, once per
        // tick, unless its `add` is still pending (that encodes the current state anyway).
        if (this.queued.has(ev.id)) return;
        const item = { seq: this._next(), k: "put", id: ev.id, index: null, touches: [] };
        this.queue.push(item); this.queued.set(ev.id, item);
    }
    _onOp(ev) {
        const op = ev.op;
        if (ev.kind === "bake") {
            const st = ev.step;
            const mark = op.strokeId;
            if (st.rekey) {
                this.queue.push({ seq: this._next(), k: "rekey", touches: [], encoded: { op: { k: "rekey", mark, rekeys: st.rekey }, geo: EMPTY } });
                return;
            }
            const removed = st.removed;
            const entry = {
                k: "bake", mark, level: lvl(removed.level),
                removed: { index: removed.index, obj: removed.obj },
                pieces: st.pieces.map((p) => ({ obj: p.obj })),
                levels: st.pieces.map((p) => lvl(p.level)),
            };
            const touches = new Set([lvl(removed.level), ...entry.levels]);
            this.queue.push({ seq: this._next(), k: "bake", touches: [...touches], encoded: encodeEntry(entry) });
            return;
        }
        if (ev.kind === "undo" || ev.kind === "redo") {
            if (op._seq == null) { this.needFull = true; return; }   // an op from before the log (a clear)
            const touches = this._opLevels(op);
            for (const L of touches) this.forced.add(L);
            this.queue.push({ seq: this._next(), k: ev.kind, touches, encoded: { op: { k: ev.kind, of: op._seq }, geo: EMPTY } });
            return;
        }
        // a fresh op
        switch (op.op) {
            case "add": case "eraseCommit": {
                op._seq = this._next();
                const id = op.op === "add" ? op.id : op.strokeId;
                const item = { seq: op._seq, k: op.op === "add" ? "add" : "mark", id, index: this._indexOf(id), touches: [] };
                this.queue.push(item); this.queued.set(id, item);
                return;
            }
            case "move": case "moveMany": {
                op._seq = this._next();
                const moves = op.op === "move" ? [op] : op.moves;
                const touches = new Set();
                for (const m of moves) { if (m.from != null) touches.add(lvl(m.from)); if (m.to != null) touches.add(lvl(m.to)); }
                for (const L of touches) this.forced.add(L);
                this.queue.push({ seq: op._seq, k: "move", moves, many: op.op === "moveMany", touches: [...touches] });
                return;
            }
            case "eraseMany": {
                op._seq = this._next();
                const entry = { k: "removeMany", records: op.records.map((r) => ({ level: lvl(r.level), index: r.index, obj: r.obj })) };
                this.queue.push({ seq: op._seq, k: "removeMany", touches: [...new Set(op.records.map((r) => lvl(r.level)))], encoded: encodeEntry(entry) });
                return;
            }
            case "clear": this.needFull = true; return;
            default: return;
        }
    }
    // The frames an op touches NOW (for forcing their snapshot with an undo/redo).
    _opLevels(op) {
        const out = new Set();
        const at = (id) => { const r = this.doc.getById(id); if (r) out.add(lvl(r.level)); };
        switch (op.op) {
            case "add": at(op.id); break;
            case "absent": if (op.level != null) out.add(lvl(op.level)); break;
            case "move": if (op.from != null) out.add(lvl(op.from)); if (op.to != null) out.add(lvl(op.to)); at(op.id); break;
            case "moveMany": for (const m of op.moves) { if (m.from != null) out.add(lvl(m.from)); if (m.to != null) out.add(lvl(m.to)); at(m.id); } break;
            case "eraseMany": case "removeMany": for (const r of op.records) out.add(lvl(r.level)); break;
            case "eraseCommit": case "eraseRevert":
                at(op.strokeId); if (op.strokeRec) out.add(lvl(op.strokeRec.level));
                for (const st of op.baked || []) { if (st.removed) out.add(lvl(st.removed.level)); for (const p of st.pieces || []) out.add(lvl(p.level)); }
                break;
            default: break;
        }
        return [...out];
    }
    /**
     * The tick's entries, encoded and in order, with the frames each touches, the
     * frames that must snapshot, and whether nothing short of a full snapshot will
     * do. Resets the tick.
     */
    drain() {
        const entries = [];
        for (const it of this.queue) {
            let enc = it.encoded;
            if (it.k === "add" || it.k === "mark" || it.k === "put") {
                const cur = this.doc.getById(it.id);
                const src = cur ? { obj: cur.obj, level: lvl(cur.level) } : this.removed.get(it.id);
                if (!src) continue;                                   // came and went inside the tick, recorded elsewhere
                it.touches = [src.level];
                enc = encodeEntry({ k: it.k, level: src.level, index: it.index, obj: src.obj });
            } else if (it.k === "move") {
                enc = encodeEntry({
                    k: "move", many: it.many,
                    moves: it.moves.map((m) => {
                        const cur = this.doc.getById(m.id);
                        return { id: m.id, from: lvl(m.from), to: lvl(m.to), dx: m.dx, dy: m.dy, base: m.base || null, after: m.after || null,
                            obj: cur ? cur.obj : null, level: cur ? lvl(cur.level) : null, index: this._indexOf(m.id) };
                    }),
                });
            }
            if (!enc) continue;
            entries.push({ seq: it.seq, t: Date.now(), op: enc.op, geo: enc.geo, touches: it.touches });
        }
        const out = { entries, forced: [...this.forced], full: this.needFull };
        this.queue = []; this.queued = new Map(); this.removed = new Map(); this.forced = new Set(); this.needFull = false;
        return out;
    }

    // ---- replay ----
    /**
     * Apply stored entries onto the loaded document: an entry is skipped when every frame
     * it touches already holds a newer snapshot, and every apply is idempotent. Rebuilds
     * the undo/redo stacks from the ops among them and re-registers pending erasers with
     * the done sets their bake entries name. `entries` ascend by seq; `frameSeq` maps a
     * frame id to the seq of its stored snapshot.
     */
    replay(entries, frameSeq = {}) {
        const doc = this.doc, E = this.E;
        const ops = new Map();          // seq -> { op, entry, levels, spent }
        const marks = new Map();        // strokeId -> the same record
        let undo = [], redo = [];
        const stale = (seq, levels) => { const L = [...levels].filter((x) => x != null); return L.length > 0 && L.every((x) => seq <= (frameSeq[x] || 0)); };
        // ONE OBJECT PER ID across every record (F70). In a live session the ops and the
        // document share identity, so an undo that resets a moved piece resets the object
        // every later record holds; a replay that decoded each record on its own broke
        // that, and a redo then removed one copy while its op kept another. A record seen
        // later carries the object's later state, and the shared object takes it.
        const made = new Map();
        const adopt = (dst, src) => {
            for (const k of Object.keys(dst)) if (k !== "id" && k !== "paths" && k[0] !== "_" && !(k in src)) delete dst[k];
            for (const k of Object.keys(src)) if (k !== "id") dst[k] = src[k];
            delete dst._bbox; dst._ver = (dst._ver || 0) + 1;
            return dst;
        };
        const live = (rec) => {
            const n = nativeFromRecord(rec); doc.noteId(n.id); if (n.editId != null) doc.noteId(n.editId);
            const prev = made.get(n.id);
            if (prev) return adopt(prev, n);
            made.set(n.id, n);
            return n;
        };
        const liveOrDoc = (rec) => { const cur = doc.getById(rec.id); if (cur) { made.set(rec.id, cur.obj); return cur.obj; } return live(rec); };
        const at = (index) => (index == null || index < 0 ? 1e9 : index);
        const fresh = (seq, op, entry, levels) => { op._seq = seq; const rec = { op, entry, levels: new Set(levels.map(lvl)), spent: false }; ops.set(seq, rec); undo.push(op); redo = []; return rec; };
        // The inverse of an op whose effect the snapshot already holds, from the entry's data.
        const inverseFromData = (rec) => {
            const op = rec.op, e = rec.entry;
            switch (op.op) {
                case "add": return { op: "absent", obj: liveOrDoc(e.obj), level: e.level, index: at(e.index) };
                case "absent": return { op: "add", id: op.obj.id };
                case "eraseCommit":
                    if (!op.strokeRec && !rec.spent) op.strokeRec = { obj: liveOrDoc(e.obj), level: e.level, index: at(e.index) };
                    op.op = "eraseRevert"; return op;
                case "eraseRevert": op.op = "eraseCommit"; return op;
                case "move": return { op: "move", ...doc._invertMove(op) };
                case "moveMany": return { op: "moveMany", moves: op.moves.map((m) => doc._invertMove(m)) };
                case "eraseMany": return { op: "removeMany", records: op.records };
                case "removeMany": return { op: "eraseMany", records: op.records };
                default: return op;
            }
        };
        for (const raw of entries) {
            const e = decodeEntry(raw);
            const seq = raw.seq;
            if (seq > this.seq) this.seq = seq;
            switch (e.k) {
                case "add": case "mark": {
                    const op = e.k === "add" ? { op: "add", id: e.obj.id } : { op: "eraseCommit", strokeId: e.obj.id, strokeRec: null, baked: [] };
                    const rec = fresh(seq, op, e, [e.level]);
                    if (e.k === "mark") marks.set(e.obj.id, rec);
                    if (stale(seq, [e.level])) break;
                    if (!doc.getById(e.obj.id)) doc.insertAt(live(e.obj), e.level, at(e.index));
                    break;
                }
                case "put": {
                    if (stale(seq, [e.level])) break;
                    const cur = doc.removeById(e.obj.id);
                    if (cur) made.set(cur.obj.id, cur.obj);
                    doc.insertAt(live(e.obj), e.level, cur ? cur.index : at(e.index));
                    break;
                }
                case "spent": {
                    const rec = marks.get(e.id);
                    if (rec) rec.spent = true;
                    if (!stale(seq, [e.level])) doc.removeById(e.id);
                    break;
                }
                case "bake": {
                    const rec = marks.get(e.mark);
                    const levels = [e.level, ...(e.levels || [])];
                    if (rec) for (const L of levels) rec.levels.add(lvl(L));
                    const apply = !stale(seq, levels);
                    const step = { removed: { obj: liveOrDoc(e.removed.obj), level: e.level, index: at(e.removed.index) }, pieces: [] };
                    if (apply) doc.removeById(e.removed.obj.id);
                    e.pieces.forEach((pr, i) => {
                        const L = (e.levels && e.levels[i]) || e.level;
                        const obj = liveOrDoc(pr);
                        if (apply && !doc.getById(pr.id)) doc.insertAt(obj, L, 1e9);
                        step.pieces.push({ obj, level: L });
                    });
                    if (rec) rec.op.baked.push(step);
                    break;
                }
                case "rekey": {
                    const rec = marks.get(e.mark);
                    for (const r of e.rekeys) { const cur = doc.getById(r.id); if (cur) Object.assign(cur.obj, r.after); }
                    doc.keysChanged();
                    if (rec) rec.op.baked.push({ rekey: e.rekeys });
                    break;
                }
                case "removeMany": {
                    const records = e.records.map((r) => ({ obj: liveOrDoc(r.obj), level: r.level, index: at(r.index) }));
                    for (const r of records) if (!stale(seq, [r.level])) doc.removeById(r.obj.id);
                    fresh(seq, { op: "eraseMany", records }, e, records.map((r) => r.level));
                    break;
                }
                case "move": {
                    const moves = e.moves.map((m) => ({ id: m.id, dx: m.dx, dy: m.dy, from: m.from, to: m.to, base: geomLive(m.base), after: geomLive(m.after) }));
                    const levels = [];
                    for (const m of e.moves) {
                        const mine = [m.from, m.to].filter((x) => x != null);
                        levels.push(...mine);
                        if (stale(seq, mine)) continue;
                        const cur = doc.getById(m.id);
                        if (cur && m.to != null && cur.level !== lvl(m.to)) doc.rehomeById(m.id, m.to);
                        if (!doc.getById(m.id)) { if (m.obj) doc.insertAt(live(m.obj), m.level || m.to, at(m.index)); }
                        else if (m.after) doc.setGeometryById(m.id, geomLive(m.after));
                        else if (cur) doc.moveById(m.id, m.dx, m.dy);
                    }
                    fresh(seq, e.many ? { op: "moveMany", moves } : { op: "move", ...moves[0] }, e, levels);
                    break;
                }
                case "undo": case "redo": {
                    const rec = ops.get(e.of);
                    if (!rec) break;
                    const op = rec.op;
                    const inv = stale(seq, rec.levels) ? inverseFromData(rec) : doc._invert(op);
                    inv._seq = op._seq; rec.op = inv;
                    if (e.k === "undo") { undo = undo.filter((x) => x !== op); redo.push(inv); }
                    else { redo = redo.filter((x) => x !== op); undo.push(inv); }
                    break;
                }
                case "attr": {
                    const cur = doc.getById(e.id);
                    if (cur && !stale(seq, [cur.level])) { Object.assign(cur.obj, e.set); doc.keysChanged(); }
                    break;
                }
                default: break;
            }
        }
        doc._undo = undo.slice(-200); doc._redo = redo;
        // Pending erasers: the gesture's op and its done set, so the bake resumes.
        E._eraseCommits.clear(); E._bakeDone.clear(); E._cutInflight = null;
        for (const [strokeId, rec] of marks) {
            if (!doc.getById(strokeId) || rec.op.op !== "eraseCommit") continue;
            E._eraseCommits.set(strokeId, rec.op);
            const done = new Set();
            for (const st of rec.op.baked) { if (st.removed) done.add(st.removed.obj.id); for (const p of st.pieces || []) done.add(p.obj.id); }
            E._bakeDone.set(strokeId, done);
        }
        return { undo: doc._undo.length, redo: doc._redo.length, marks: E._eraseCommits.size };
    }
}

// A move's before/after geometry, as `setGeometryById` takes it: loops as pieces.
function geomLive(g) {
    if (!g) return g;
    const n = nativeFromRecord({ type: g.loops ? "shape" : g.polys ? "fill" : "stroke", id: 0, ...g });
    const out = {};
    if (n.loops) out.loops = n.loops; if (n.polys) out.polys = n.polys; if (n.pts) out.pts = n.pts;
    if ("attachRect" in g) out.attachRect = g.attachRect;
    if ("tile" in g) out.tile = g.tile;
    if ("below" in g) out.below = n.below;
    return out;
}
