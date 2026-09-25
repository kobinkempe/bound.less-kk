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
 * ORDER. Entries take their seq when the event happens, in event order; an `add`, a `mark`
 * and a `put` encode at drain time but keep the array index they had when the op landed; a
 * bake step encodes the moment it lands. Replay is idempotent and skips what the snapshots
 * hold (`snapshotRule`; a frame the header does not list holds everything, F98) — an undo
 * or redo's inverse is then built from the entry's own data.
 *
 * THE LATTICE IS THE HEADER'S (the subtree move, DESIGN.md §8). Every write carries
 * `lm.serialize()` with its entries, so the stored addresses, shifts and shadows are never
 * older than any stored entry: a replayed `moveFrames`, `mergeFrame` or their undo never
 * re-addresses, only rebuilds the op. The natives' tables are another matter — a frame's
 * shift settles into them at a later read, under no op — so a settle is its own entry,
 * carrying the RESULT table of every native it touched (idempotent, address-free), and a
 * snapshot is forced only where a native changed frames.
 */
import { encodeEntry, decodeEntry } from "./format2";
import { encodeBelow, decodeBelow } from "./geometry/offsets";
import { nativeFromRecord, UNDO_CAP } from "./Document";

const lvl = (v) => (v == null ? null : String(v));
const EMPTY = new Float64Array(0);

/**
 * Whether the stored snapshots already hold an entry at `seq` touching `levels`: every such frame's
 * snapshot is at or past it. A frame the header does not list (`listed`, its frameIds) was empty at
 * that write, so it holds every entry (F98: a container a later drop emptied had lost its seq, and its
 * entries replayed over newer snapshots). Replay and foldStore's log tail share this rule.
 */
export function snapshotRule(frameSeq = {}, listed = null) {
    const has = listed ? new Set([...listed].map(String)) : null;
    const at = (x) => (has && !has.has(String(x)) ? Infinity : (frameSeq[x] || 0));
    return (seq, levels) => { const L = [...levels].filter((x) => x != null); return L.length > 0 && L.every((x) => seq <= at(x)); };
}

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
            if (ev.obj.erase && !this.doc._inUndo && !ev.rehome) {
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
    // The seq of the move op whose frame entry `owner` is, when that op is on a stack (or among
    // a replay's rebuilt ops); a settle mid-drag has none yet.
    _ownerSeq(owner) {
        if (!owner) return null;
        for (const stack of [this.doc._undo, this.doc._redo]) {
            for (const op of stack) if (op.op === "moveFrames" && op._seq != null && op.frames.includes(owner)) return op._seq;
        }
        if (this._replayOps) for (const r of this._replayOps.values()) if (r.op.op === "moveFrames" && r.op.frames.includes(owner)) return r.op._seq;
        return null;
    }
    // A frame's shift settled into its natives' tables, or a cancelled drag's tables restored:
    // an entry of the result tables, coalesced with a settle of the same frame and the same move
    // op queued just before it (a drag unsettles and settles a visible frame every event; another
    // op's settle merged in hung on the wrong op in replay, REVIEWER-3 SAVE-2). A carry changed
    // homes, so both frames snapshot.
    _onSettle(ev) {
        const rec = ev.rec;
        const of = this._ownerSeq(ev.owner);
        const touches = [...new Set([lvl(ev.frame), ...rec.carries.map((c) => lvl(c[1]))])];
        const last = this.queue[this.queue.length - 1];
        if (last && last.k === "settle" && last.frame === lvl(ev.frame) && (last.of ?? null) === (of ?? null)) { last.rec = rec; last.touches = touches; }
        else this.queue.push({ seq: this._next(), k: "settle", frame: lvl(ev.frame), of, rec, touches });
        if (rec.carries.length) for (const L of touches) this.forced.add(L);
    }
    // A shadow merged into its resident: the resident's snapshot now holds the natives (forced),
    // the shadow's row goes with the write; the entry hangs the record on the move op for undo.
    _onMerge(ev) {
        const rec = ev.rec;
        this.queue.push({ seq: this._next(), k: "mergeFrame", rec, of: this._ownerSeq(ev.owner), touches: [lvl(rec.id), lvl(rec.into)] });
        this.forced.add(lvl(rec.into));
    }
    _onOp(ev) {
        if (this.replaying) {
            // A settle the replay itself triggers (the header's pending shift met a rehome) is new
            // information, queued once the replayed seqs are known.
            if (ev.kind === "settle") this._replaySettles.push(ev);
            return;
        }
        if (ev.kind === "settle") { this._onSettle(ev); return; }
        if (ev.kind === "mergeFrame") { this._onMerge(ev); return; }
        // Frames frame GC forgot: a record; the header's lattice already lacks them, so replay skips it.
        if (ev.kind === "forget") {
            const frames = ev.frames.map(lvl);
            this.queue.push({ seq: this._next(), k: "forget", touches: frames, encoded: { op: { k: "forget", frames }, geo: EMPTY } });
            return;
        }
        const op = ev.op;
        if (ev.kind === "bake") {
            const st = ev.step;
            const mark = op.strokeId;
            if (st.rekey) {
                this.queue.push({ seq: this._next(), k: "rekey", touches: [], encoded: { op: { k: "rekey", mark, rekeys: st.rekey }, geo: EMPTY } });
                return;
            }
            // A frame the mark covered whole: the natives with their geometry, as a delete's (the rows go).
            if (st.frames) {
                const frames = st.frames.map((r) => lvl(r.frame));
                this.queue.push({ seq: this._next(), k: "bakeFrames", touches: frames,
                    encoded: encodeEntry({ k: "bakeFrames", mark, frames: st.frames.map((r) => ({ frame: lvl(r.frame), objects: r.natives })) }) });
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
            for (const L of this._forcedFor(op, touches)) this.forced.add(L);
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
            case "moveFrames": {
                op._seq = this._next();
                const touches = new Set();
                for (const e of op.frames) {
                    touches.add(lvl(e.id));
                    if (e.from && e.from.parent != null) touches.add(lvl(e.from.parent));
                    if (e.to && e.to.parent != null) touches.add(lvl(e.to.parent));
                }
                for (const m of op.moves || []) { if (m.from != null) touches.add(lvl(m.from)); if (m.to != null) touches.add(lvl(m.to)); }
                // Only the per-object members' frames snapshot: a frame moved as a frame keeps its
                // natives' bytes, and the header carries its address.
                for (const L of this._forcedFor(op, [...touches])) this.forced.add(L);
                this.queue.push({ seq: op._seq, k: "moveFrames", frames: op.frames, moves: op.moves || [], touches: [...touches] });
                return;
            }
            case "eraseMany": {
                op._seq = this._next();
                const entry = { k: "removeMany", records: op.records.map((r) => ({ level: lvl(r.level), index: r.index, obj: r.obj })) };
                this.queue.push({ seq: op._seq, k: "removeMany", touches: [...new Set(op.records.map((r) => lvl(r.level)))], encoded: encodeEntry(entry) });
                return;
            }
            // A deleted frame subtree: its rows go with the next write (the frames left
            // `nativesByLevel`), so the entry carries the natives' geometry, encoded at the drain.
            case "removeFrames": case "eraseFrames": {
                op._seq = this._next();
                this.queue.push({ seq: op._seq, k: "removeFrames", records: op.records, touches: op.records.map((r) => lvl(r.frame)) });
                return;
            }
            case "deleteMany": {
                op._seq = this._next();
                this.queue.push({ seq: op._seq, k: "deleteMany", parts: op.parts, touches: this._opLevels(op) });
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
            // An undone add is already gone when this runs: its frame is where this tick removed it from
            // (REVIEWER-2 U-1: it named none, forced no snapshot, and the stroke came back at a reload).
            case "add": { at(op.id); const r = this.removed.get(op.id); if (r && r.level != null) out.add(r.level); break; }
            case "absent": if (op.level != null) out.add(lvl(op.level)); break;
            case "move": if (op.from != null) out.add(lvl(op.from)); if (op.to != null) out.add(lvl(op.to)); at(op.id); break;
            case "moveMany": for (const m of op.moves) { if (m.from != null) out.add(lvl(m.from)); if (m.to != null) out.add(lvl(m.to)); at(m.id); } break;
            case "eraseMany": case "removeMany": for (const r of op.records) out.add(lvl(r.level)); break;
            case "removeFrames": case "eraseFrames": for (const r of op.records) out.add(lvl(r.frame)); break;
            case "deleteMany": for (const p of op.parts) for (const L of this._opLevels(p)) out.add(L); break;
            case "moveFrames":
                for (const e of op.frames) { out.add(lvl(e.id)); if (e.from && e.from.parent != null) out.add(lvl(e.from.parent)); if (e.to && e.to.parent != null) out.add(lvl(e.to.parent)); }
                for (const m of op.moves || []) { if (m.from != null) out.add(lvl(m.from)); if (m.to != null) out.add(lvl(m.to)); at(m.id); }
                break;
            case "eraseCommit": case "eraseRevert":
                at(op.strokeId); if (op.strokeRec) out.add(lvl(op.strokeRec.level));
                for (const st of op.baked || []) {
                    if (st.removed) out.add(lvl(st.removed.level));
                    for (const p of st.pieces || []) out.add(lvl(p.level));
                    for (const r of st.frames || []) out.add(lvl(r.frame));
                }
                break;
            default: break;
        }
        return [...out];
    }
    // What an undo, redo or fresh op must snapshot: every frame it touches, except that a
    // subtree move's re-addressed frames need nothing (the header carries the address, the
    // tables are entries) unless a merge or a carry changed which frame holds a native.
    _forcedFor(op, touches) {
        if (op.op !== "moveFrames") return touches;
        const out = new Set();
        for (const m of op.moves || []) { if (m.from != null) out.add(lvl(m.from)); if (m.to != null) out.add(lvl(m.to)); }
        for (const e of op.frames) {
            for (const m of e.merged || []) { out.add(lvl(m.id)); out.add(lvl(m.into)); }
            if (e.settled && e.settled.carries.length) { out.add(lvl(e.id)); for (const c of e.settled.carries) out.add(lvl(c[1])); }
        }
        return [...out];
    }
    // One move member in file form: the tables, and the geometry snapshots of a member the
    // pen-up walked back into its cell. `obj` is the object as it now is.
    _moveFile(m) {
        const cur = this.doc.getById(m.id);
        const out = { id: m.id, from: lvl(m.from), to: lvl(m.to), dx: m.dx, dy: m.dy,
            obj: cur ? cur.obj : null, level: cur ? lvl(cur.level) : null, index: this._indexOf(m.id) };
        if ("belowBefore" in m) { out.belowBefore = encodeBelow(m.belowBefore) || null; out.belowAfter = encodeBelow(m.belowAfter) || null; }
        if (m.base || m.after) { out.base = m.base || null; out.after = m.after || null; }
        return out;
    }
    /**
     * The tick's entries, encoded and in order, with the frames each touches, the
     * frames that must snapshot, and whether nothing short of a full snapshot will
     * do. Resets the tick.
     */
    drain() {
        const entries = [];
        const frameRecs = (records) => records.map((r) => ({ frame: lvl(r.frame), objects: r.natives }));
        for (const it of this.queue) {
            let enc = it.encoded;
            if (it.k === "add" || it.k === "mark" || it.k === "put") {
                const cur = this.doc.getById(it.id);
                // Set aside with its frame in the same tick: neither live nor removed, still its own record (SAVE-4).
                const aside = !cur && !this.removed.has(it.id) ? this.doc._byId.get(it.id) : null;
                const src = cur ? { obj: cur.obj, level: lvl(cur.level) }
                    : this.removed.get(it.id) || (aside ? { obj: aside, level: lvl(aside._home) } : null);
                if (!src) continue;                                   // came and went inside the tick, recorded elsewhere
                it.touches = [src.level];
                enc = encodeEntry({ k: it.k, level: src.level, index: it.index, obj: src.obj });
            } else if (it.k === "move") {
                enc = encodeEntry({ k: "move", many: it.many, moves: it.moves.map((m) => this._moveFile(m)) });
            } else if (it.k === "moveFrames") {
                enc = encodeEntry({ k: "moveFrames", frames: it.frames.map(frameFile), moves: it.moves.map((m) => this._moveFile(m)) });
            } else if (it.k === "removeFrames") {
                enc = encodeEntry({ k: "removeFrames", records: frameRecs(it.records) });
            } else if (it.k === "deleteMany") {
                const records = [], frames = [];
                for (const p of it.parts) {
                    if (p.op === "eraseMany" || p.op === "removeMany") for (const r of p.records) records.push({ level: lvl(r.level), index: r.index, obj: r.obj });
                    else if (p.op === "removeFrames" || p.op === "eraseFrames") frames.push(...frameRecs(p.records));
                }
                enc = encodeEntry({ k: "deleteMany", records, frames });
            } else if (it.k === "settle") {
                enc = { op: { k: "settle", frame: it.frame, of: it.of, ...settleFile(it.rec) }, geo: EMPTY };
            } else if (it.k === "mergeFrame") {
                enc = { op: { k: "mergeFrame", of: it.of, rec: mergeFile(it.rec) }, geo: EMPTY };
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
     * Apply stored entries onto the loaded document: an entry is skipped when the snapshots
     * already hold it (`snapshotRule`), and every apply is idempotent. Rebuilds the undo/redo
     * stacks from the ops among them and re-registers pending erasers with the done sets their
     * bake entries name. `entries` ascend by seq; `frameSeq` maps a frame id to the seq of its
     * stored snapshot; `listed` is the header's frameIds (without it, every frame counts as listed).
     */
    replay(entries, frameSeq = {}, listed = null) {
        const wasReplaying = this.replaying;
        this.replaying = true;
        this._replaySettles = [];
        try { return this._replay(entries, frameSeq, listed); } finally {
            this.replaying = wasReplaying;
            for (const ev of this._replaySettles) this._onSettle(ev);   // `_replayOps` still names the ops for `of`
            this._replaySettles = [];
            this._replayOps = null;
        }
    }
    _replay(entries, frameSeq, listed) {
        const doc = this.doc, E = this.E;
        const ops = new Map();          // seq -> { op, entry, levels, spent }
        this._replayOps = ops;
        const marks = new Map();        // strokeId -> the same record
        let undo = [], redo = [];
        const stale = snapshotRule(frameSeq, listed);
        // ONE OBJECT PER ID across every record (F70). In a live session the ops and the
        // document share identity, so an undo that resets a moved piece resets the object
        // every later record holds; a replay that decoded each record on its own broke
        // that, and a redo then removed one copy while its op kept another. A record seen
        // later carries the object's later state, and the shared object takes it.
        const made = new Map();
        const adopt = (dst, src) => {
            for (const k of Object.keys(dst)) if (k !== "id" && k[0] !== "_" && !(k in src)) delete dst[k];
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
        // The table and home a stale undo or redo of a move leaves an object at while it is out of the
        // document (REVIEWER-2 U-2: its add entry encodes it at drain time, moved; a redo brought it back moved).
        const rewound = new Map();
        const rewind = (obj, id) => {
            const r = rewound.get(id);
            if (!r || doc.getById(id)) return obj;
            if ("below" in r) { if (r.below) obj.below = r.below; else delete obj.below; }
            return obj;
        };
        // Capped as `Document.pushUndo` caps it, op by op: history never names more than it did live (F94).
        const fresh = (seq, op, entry, levels) => {
            op._seq = seq; const rec = { op, entry, levels: new Set(levels.map(lvl)), spent: false }; ops.set(seq, rec);
            undo.push(op); if (undo.length > UNDO_CAP) undo.shift();
            redo = []; return rec;
        };
        // The inverse of an op whose effect the snapshot already holds, from the entry's data.
        const inverseFromData = (rec) => {
            const op = rec.op, e = rec.entry;
            switch (op.op) {
                case "add": {
                    const r = rewound.get(e.obj.id), out = !doc.getById(e.obj.id);
                    return { op: "absent", obj: rewind(liveOrDoc(e.obj), e.obj.id), level: r && r.level != null && out ? r.level : e.level, index: at(e.index) };
                }
                case "absent": return { op: "add", id: op.obj.id };
                case "eraseCommit":
                    // A spent mark has nothing to restore (U-3: an older record re-inserted it and it baked again).
                    op.strokeRec = rec.spent ? null : (op.strokeRec || { obj: liveOrDoc(e.obj), level: e.level, index: at(e.index) });
                    op.op = "eraseRevert"; return op;
                case "eraseRevert": op.op = "eraseCommit"; return op;
                case "move": return { op: "move", ...doc._invertMove(op) };
                case "moveMany": return { op: "moveMany", moves: op.moves.map((m) => doc._invertMove(m)) };
                case "eraseMany": return { op: "removeMany", records: op.records };
                case "removeMany": return { op: "eraseMany", records: op.records };
                case "removeFrames": return { op: "eraseFrames", records: op.records };
                case "eraseFrames": return { op: "removeFrames", records: op.records };
                case "deleteMany": return { op: "deleteMany", parts: op.parts.map((p) => inverseFromData({ op: p, entry: e })) };
                default: return op;
            }
        };
        // A subtree move's undo or redo. The lattice is the header's, so nothing is re-addressed:
        // per frame, a merge is split and a settle subtracted where the frame's snapshot predates
        // this entry (both from records, idempotent); the members undo as a move's.
        const undoFrames = (op, seq) => {
            for (const f of op.frames) {
                if (f.merged) for (let i = f.merged.length - 1; i >= 0; i--) { const m = f.merged[i]; if (!stale(seq, [m.id, m.into])) doc.unmergeReplay(m); }
                if (f.settled && !stale(seq, [f.id, ...f.settled.carries.map((c) => c[1])])) doc.unsettle(f.id, f.settled);
            }
            const ml = [];
            for (const m of op.moves || []) { if (m.from != null) ml.push(m.from); if (m.to != null) ml.push(m.to); }
            if (ml.length && !stale(seq, ml)) doc._undoMove(op.moves);
            const inv = {
                op: "moveFrames",
                frames: op.frames.map((f) => ({ ...f, from: f.to, to: f.from, shiftBefore: f.shiftAfter, shiftAfter: f.shiftBefore, settled: null, merged: null })),
                moves: (op.moves || []).map((m) => doc._invertMove(m)),
            };
            for (const f of inv.frames) doc.noteFrameOwner(f.id, f);
            return inv;
        };
        // A move's members, applied where their frames' snapshots predate the entry. Each pair is
        // independent, as Document._undoMove reads them: the geometry snapshots of a normalised
        // member, the tables, or the pre-F41 translation.
        const applyMoves = (fileMoves, seq) => {
            const moves = fileMoves.map((m) => {
                const out = { id: m.id, dx: m.dx, dy: m.dy, from: m.from, to: m.to };
                if ("belowBefore" in m) { out.belowBefore = decodeBelow(m.belowBefore); out.belowAfter = decodeBelow(m.belowAfter); }
                if (m.base || m.after) { out.base = geomLive(m.base); out.after = geomLive(m.after); }
                return out;
            });
            const levels = [];
            fileMoves.forEach((m, i) => {
                const mine = [m.from, m.to].filter((x) => x != null);
                levels.push(...mine);
                if (stale(seq, mine)) return;
                const cur = doc.getById(m.id);
                if (cur && m.to != null && cur.level !== lvl(m.to)) doc.rehomeById(m.id, m.to);
                if (!doc.getById(m.id)) { if (m.obj) doc.insertAt(live(m.obj), m.level || m.to, at(m.index)); }
                else {
                    if (moves[i].after) doc.setGeometryById(m.id, moves[i].after);
                    if ("belowAfter" in moves[i]) doc.setOffsetsById(m.id, moves[i].belowAfter);
                    else if (!moves[i].after && cur) doc.moveById(m.id, m.dx, m.dy);
                }
            });
            return { moves, levels };
        };
        const frameRecs = (list) => (list || []).map((r) => ({ frame: r.frame, natives: r.objects.map(liveOrDoc), index: null }));
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
                    // Per frame: a piece whose frame's snapshot is newer is there already, or was cut again since.
                    const step = { removed: { obj: liveOrDoc(e.removed.obj), level: e.level, index: at(e.removed.index) }, pieces: [], _seq: seq };
                    if (seq > (doc._stepSeq || 0)) doc._stepSeq = seq;   // steps after the reload land after these
                    if (!stale(seq, [e.level])) doc.removeById(e.removed.obj.id);
                    e.pieces.forEach((pr, i) => {
                        const L = (e.levels && e.levels[i]) || e.level;
                        const obj = liveOrDoc(pr);
                        if (!stale(seq, [L]) && !doc.getById(pr.id)) doc.insertAt(obj, L, 1e9);
                        step.pieces.push({ obj, level: L });
                    });
                    if (rec) rec.op.baked.push(step);
                    break;
                }
                case "bakeFrames": {
                    const rec = marks.get(e.mark);
                    const records = frameRecs(e.frames);
                    for (const r of records) { if (rec) rec.levels.add(lvl(r.frame)); if (!stale(seq, [r.frame])) doc.detachFrame(r.frame, r); }
                    if (rec) rec.op.baked.push({ frames: records, _seq: seq });   // in the steps' order: undo reverts newest first (F128)
                    if (seq > (doc._stepSeq || 0)) doc._stepSeq = seq;
                    break;
                }
                case "rekey": {
                    const rec = marks.get(e.mark);
                    for (const r of e.rekeys) { const cur = doc.getById(r.id); if (cur) Object.assign(cur.obj, r.after); }
                    doc.keysChanged();
                    if (rec) rec.op.baked.push({ rekey: e.rekeys, _seq: seq });
                    if (seq > (doc._stepSeq || 0)) doc._stepSeq = seq;
                    break;
                }
                case "removeMany": {
                    const records = e.records.map((r) => ({ obj: liveOrDoc(r.obj), level: r.level, index: at(r.index) }));
                    for (const r of records) if (!stale(seq, [r.level])) doc.removeById(r.obj.id);
                    fresh(seq, { op: "eraseMany", records }, e, records.map((r) => r.level));
                    break;
                }
                case "move": {
                    const { moves, levels } = applyMoves(e.moves, seq);
                    fresh(seq, e.many ? { op: "moveMany", moves } : { op: "move", ...moves[0] }, e, levels);
                    break;
                }
                case "moveFrames": {
                    // The addresses and shifts are the header's already; the op is rebuilt for undo
                    // and its entries own their frames, so a later settle or merge lands on them.
                    const { moves, levels } = applyMoves(e.moves || [], seq);
                    const frames = e.frames.map((f) => ({ id: f.id, depth: f.depth, from: f.from, to: f.to, shiftBefore: f.shiftBefore, shiftAfter: f.shiftAfter,
                        settled: settleLive(f.settled), merged: f.merged ? f.merged.map(mergeLive) : null }));
                    for (const f of frames) doc.noteFrameOwner(f.id, f);
                    fresh(seq, { op: "moveFrames", frames, moves }, e, [...levels, ...(raw.touches || [])]);
                    break;
                }
                case "settle": {
                    const s = settleLive(e);
                    const rec = e.of != null ? ops.get(e.of) : null;
                    if (rec && rec.op.op === "moveFrames") { const fe = rec.op.frames.find((f) => f.id === e.frame); if (fe) fe.settled = s; }
                    if (!stale(seq, raw.touches || [e.frame])) doc.applySettle(e.frame, s);
                    break;
                }
                case "mergeFrame": {
                    const m = mergeLive(e.rec);
                    const rec = e.of != null ? ops.get(e.of) : null;
                    if (rec && rec.op.op === "moveFrames") {
                        const fe = rec.op.frames.find((f) => f.id === m.id) || rec.op.frames.find((f) => f.id === m.into);
                        if (fe && !(fe.merged || []).some((r) => r.id === m.id && r.into === m.into)) (fe.merged || (fe.merged = [])).push(m);
                    }
                    if (!stale(seq, raw.touches || [m.id, m.into])) doc.mergeReplay(m);
                    break;
                }
                case "removeFrames": {
                    const records = frameRecs(e.records);
                    for (const r of records) if (!stale(seq, [r.frame])) doc.detachFrame(r.frame, r);
                    fresh(seq, { op: "removeFrames", records }, e, records.map((r) => r.frame));
                    break;
                }
                case "deleteMany": {
                    const records = (e.records || []).map((r) => ({ obj: liveOrDoc(r.obj), level: r.level, index: at(r.index) }));
                    for (const r of records) if (!stale(seq, [r.level])) doc.removeById(r.obj.id);
                    const frames = frameRecs(e.frames);
                    for (const r of frames) if (!stale(seq, [r.frame])) doc.detachFrame(r.frame, r);
                    fresh(seq, { op: "deleteMany", parts: [{ op: "eraseMany", records }, { op: "removeFrames", records: frames }] }, e,
                        [...records.map((r) => r.level), ...frames.map((r) => r.frame)]);
                    break;
                }
                case "undo": case "redo": {
                    const rec = ops.get(e.of);
                    if (!rec) break;
                    const op = rec.op;
                    const old = stale(seq, rec.levels);
                    if (old && (op.op === "move" || op.op === "moveMany")) {
                        // `op` is the op to invert next (after an undo, already the inverse): either way
                        // the member ends at its `from` and `belowBefore` (REVIEWER-3 SAVE-1).
                        for (const m of (op.op === "move" ? [op] : op.moves)) {
                            rewound.set(m.id, "belowBefore" in m ? { below: m.belowBefore, level: m.from } : { level: m.from });
                            const o = made.get(m.id);
                            if (o) rewind(o, m.id);
                        }
                    }
                    // The document's stacks are the replay's so far: an erase gesture's undo or redo asks which other
                    // gestures' steps consumed or minted its pieces (Document._stepIndex), and they live in these.
                    doc._undo = undo; doc._redo = redo;
                    const inv = op.op === "moveFrames" ? undoFrames(op, seq) : old ? inverseFromData(rec) : doc._invert(op);
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
                case "forget": break;                              // the lattice is the header's
                default: break;
            }
        }
        doc._undo = undo.slice(-UNDO_CAP); doc._redo = redo;
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

// A settle record, to and from the file: `[[id, table], ...]` with the tables in `encodeBelow`'s form.
const settleFile = (rec) => (rec ? { dx: rec.dx, dy: rec.dy, tables: rec.tables.map(([id, t]) => [id, encodeBelow(t) || null]), carries: rec.carries.map(([id, L]) => [id, lvl(L)]) } : null);
const settleLive = (s) => (s ? { dx: s.dx, dy: s.dy, tables: s.tables.map(([id, t]) => [id, decodeBelow(t)]), carries: (s.carries || []).map(([id, L]) => [id, L]) } : null);
// A merge record is plain data both ways; copied so the op and the entry never share it.
const mergeFile = (rec) => JSON.parse(JSON.stringify({ id: rec.id, into: rec.into, parent: rec.parent, i: rec.i, j: rec.j, depth: rec.depth, addrSeq: rec.addrSeq || 0,
    shift: rec.shift || null, shadows: rec.shadows || [], kids: rec.kids || [], ids: rec.ids || [] }));
const mergeLive = mergeFile;
// A frame entry in file form. A settle is inline (one mid-drag has no op to be an entry of); a
// merge never is — it happens after the op is on the stack, so its own entry names the op.
const frameFile = (e) => ({ id: lvl(e.id), depth: e.depth, from: e.from, to: e.to, shiftBefore: e.shiftBefore || null, shiftAfter: e.shiftAfter || null,
    settled: settleFile(e.settled), merged: null });

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
