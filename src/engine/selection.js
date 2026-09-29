/**
 * Selecting, hit-testing, and dragging what is selected.
 *
 * Selection is a set of ids plus the edit key that binds a re-homed family
 * together, so picking any member picks the whole logical object even when it
 * is stored as several natives at different levels. A drag moves them as one
 * and records ONE undo op, in the object's own home-frame units.
 *
 * `_normalizeHome` is the enforcement of lattice invariant 2: an object homed
 * in a frame stays within its own cell plus one neighbour (REACH). A drag that
 * would carry it further re-homes it instead of letting the address drift.
 *
 * Mixed into `KobinEngine.prototype` - see `mixin.js`. Split out of
 * `KobinEngine.js` on 2026-08-31.
 */
import { R as CROSS_RATIO, W as FRAME_W } from "./frameLattice";
import { reachBox } from "./placementModel";
import { bboxOf } from "./geometry/derive";
import { distToPolyline, windingOfPoint } from "./geometry/hittest";
import { flattenCurve } from "./geometry/polyline";
import { insideTester } from "./geometry/arcShape";
import { rectInsidePolygon, loopTester } from "./geometry/lasso";
import { addOffset, sameBelow, snapDisplacement, cloneBelow, sameShift } from "./geometry/offsets";
import { underMask } from "./eraseRule";

// How close to a selected frame's mark a press counts as pressing the frame.
const SEL_FRAME_HIT_PX = 8;

// How far a press has to travel before it is a drag rather than a tap. Screen
// pixels; a finger wobbles a few, a mouse none.
export const SELECT_DRAG_PX = 8;

// The ink test behind the lasso is a hand-gesture question, so it is asked
// at a hand-gesture precision: the outline flattened to LASSO_INK_TOL_PX,
// never more than LASSO_INK_MAX_PTS points of it (twelve borderline shapes cost
// 985 ms at a quarter pixel on Kobin's 2026-09-03 drawing), against the loop as
// drawn: `loopTester`'s grid carries its edges, and every 7th point of a slow
// loop cut inside or outside the line by a finger's wiggle (REPORTS 2026-09-24:
// a family 0.6 px inside dropped; the same cost undecimated).
const LASSO_INK_TOL_PX = 3;
const LASSO_INK_MAX_PTS = 3000;
/** Walks a lasso may make: a torn family re-reads its path's frames once; a third pass finds none (LASSO-1). */
const LASSO_PASSES = 3;

const everyNth = (pts, max) => {
    if (pts.length <= max) return pts;
    const k = Math.ceil(pts.length / max);
    const out = [];
    for (let i = 0; i < pts.length; i += k) out.push(pts[i]);
    return out;
};

class Selection {

    // ---- a press, resolved (KobinEngine._pointerDown records it) ----
    // The select tool changes nothing on the way down — see the note there.
    // These three are the outcomes: a tap, a drag, and a pinch that cancels.

    /** A press that never moved: a tap. Selects, toggles, or clears. */
    _selectTap(P) {
        if (P.hit == null) {
            if (!P.ctrl) this.deselect();
            this.renderer.refreshSelection();
            this._emit();
            return;
        }
        if (P.ctrl) { this._toggleSelected(P.hit); return; }
        // Tapping a member of the selection keeps the whole selection.
        if (!this._isSelected(P.hit)) this.select(P.sx, P.sy);
    }
    /**
     * A press that has travelled: a lasso or a move, decided here. With nothing
     * selected, or with ctrl, a drag is a lasso; from paper it lassoes; from ink
     * it moves the whole selection when selected ink is anywhere under the press,
     * covered or not (Kobin, 2026-09-23), else it selects the topmost object there
     * alone and moves that. A tap still takes the topmost (`_selectTap`).
     */
    _beginSelectDrag(P, sx, sy) {
        const startLasso = () => {
            this._lasso = { pts: [[P.sx, P.sy], [sx, sy]], ctrl: P.ctrl, moved: true };
            this.renderer.refreshSelection();
        };
        const sel = this.selection;
        let hit = P.hit, hitSel = hit != null && !!sel && this._isSelected(hit);
        if (hit != null && !hitSel && sel && !P.ctrl) {
            const under = this._hitTest(P.sx, P.sy, undefined, (id) => this._isSelected(id));
            if (under != null) { hit = under; hitSel = true; }
        }
        // A press on a selected frame's mark drags the selection as a press on selected ink does.
        const frameHit = !hitSel && sel && sel.frames.length ? this._frameUnderPoint(P.sx, P.sy) : null;
        if ((hit == null && !frameHit) || P.ctrl || !sel) { startLasso(); return; }
        // The erase barriers first (A2 §4.11): the hit object's when it is not selected, then every
        // pending pair among what is about to move — ink dragged out from under a mark would carry
        // its masked shape with it, and a mark moved with its frame its mask off its targets. Parked
        // while their cuts are in workers: the drag then starts from the press and jumps to the
        // finger, or applies whole if the pointer was released meanwhile.
        const press = this._pressWait = { last: null, released: false };
        const start = () => {
            if (this._pressWait !== press) return;             // a new press or a pinch cancelled it
            this._pressWait = null;
            if (!this.selection) { if (!press.last && !press.released) startLasso(); return; }   // the cuts took the object away
            this._dragSel = { start: [P.sx, P.sy], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
            // A drag rewrites the same objects on every pointer event; tiles the
            // camera cannot see are not worth patching that often.
            this.store.setBatch(true);
            this._beginHold();                   // PAPER-PLAN R3: the members' plate events wait for `_endMove`
            const at = press.last || [sx, sy];
            this._dragSelection(at[0], at[1]);
            if (press.released) this._pointerUp();
        };
        const members = () => this._dragBarrier(start);
        if (!frameHit && !hitSel) this.select(P.sx, P.sy, members); else members();
    }
    /**
     * The second finger of a pinch has landed: forget the select gesture in
     * progress. A press that had not moved is simply dropped, so a pinch that
     * begins over ink selects nothing and a pinch that begins over paper keeps
     * whatever was selected (Kobin, 2026-09-03: "it should still keep the
     * selection that was there before I zoomed"). A lasso in progress is
     * dropped. A drag that had already moved things is put back where it
     * started — unless `commitIfMoved`, which the shell passes once the press
     * is old enough to have been a deliberate drag, in which case it ends as a
     * normal pen-up would.
     */
    cancelSelectGesture(commitIfMoved = false) {
        this._selPress = null;
        this._cancelBarrier(); this._pressWait = null;   // a parked select or drag goes with the gesture
        if (this._lasso) {
            this._lasso = null;
            this.renderer.refreshSelection();
            this._emit();
        }
        const d = this._dragSel;
        if (!d) return;
        if (d.moved && commitIfMoved) { this._pointerUp(); return; }
        if (d.moved) {
            // Back to the frame and the table the drag started from; a move touches nothing else (F55).
            for (const [id, st] of d.moves) {
                if (!this.doc.getById(id)) continue;
                if (st.to !== st.from) this.doc.rehomeById(id, st.from);
                this.doc.setOffsetsById(id, st.baseBelow);
            }
            if (d.frames && d.frames.size) this._restoreFrames(d);
        }
        this._endMove("cancel");
    }

    // ---- multi-selection (bible §5.3) ----
    // `selection` keeps the single-object shape it has always had — id, editId,
    // level, obj — describing the PRIMARY member, and gains `ids`, every member
    // of the selection. Everything that acts on a selection (drag, delete, the
    // overlay) walks `ids`; everything that reads one object keeps working.
    _isSelected(id) {
        if (!this.selection) return false;
        const rec = this.doc.getById(id);
        if (rec && this.selection.frames.length && this._underFrames(rec.level, this.selection.frames)) return true;
        const key = this.doc.editKey(rec ? rec.obj : null);
        return this.selection.ids.includes(id) || (key != null && this.selection.ids.some((x) => {
            const r = this.doc.getById(x);
            return r && this.doc.editKey(r.obj) === key;
        }));
    }
    // Is the frame `level` one of `frames`, or under one?
    /**
     * Whether frame `level` is under any of `frames`. Answered once per level for a frames array while
     * the lattice and the array stand: the O(ids) walks over a lasso's 29k ids asked it per id, 0.55 s
     * of `isUnder` on the Magnum Opus (REVIEWER-4). An array refilled in place to the same length must
     * drop its entry (`_ufMemo.delete`), as `_lassoFind`'s passes do (REVIEWER-5).
     */
    _underFrames(level, frames) {
        if (!frames.length) return false;
        const lk = this.lm.addrEpoch + "|" + this.lm.frames.size;
        const memo = this._ufMemo || (this._ufMemo = new WeakMap());
        let c = memo.get(frames);
        if (!c || c.lk !== lk || c.n !== frames.length) memo.set(frames, (c = { lk, n: frames.length, m: new Map() }));
        const k = String(level);
        let v = c.m.get(k);
        if (v === undefined) {
            v = false;
            for (const f of frames) if (this.lm.isUnder(f, level)) { v = true; break; }
            c.m.set(k, v);
        }
        return v;
    }
    /**
     * Every frame with a native in its subtree: each frame that holds one, and its ancestors —
     * O(frames with natives × depth). A visited cell with nothing under it stands for nothing, and a
     * selection that held one drew a dot on blank paper (Kobin's report 2026-09-23 08-16-23: 50 of them).
     */
    _inkedFrames() {
        const out = new Set();
        for (const k of this.doc.levels()) {
            if (!this.doc.count(k)) continue;
            for (let f = this.lm.frame(k); f && !out.has(f.id); f = f.parent != null ? this.lm.frame(f.parent) : null) out.add(f.id);
        }
        return out;
    }
    /**
     * A settle carried natives out of `frame` (or back into it, an unsettle). During a drag and its
     * drop's render they wait for `_endMove`: a step can unsettle them again, and a frame the drag
     * moved out of the selection is not selected until the drop is over. Otherwise they wait for the
     * end of the render whose list build settled them (`_flushCarried`): changed inside it, the
     * selection ran a camera step on the old list and cut the render's perf row short.
     */
    _followCarries(frame, carries) {
        const s = this.selection, d = this._dragSel || (this._dropping && this._dropping.d);
        if (!s || !s.frames.length) return;
        if (d) {
            if ((d.frames && d.frames.has(frame)) || this._underFrames(frame, s.frames)) {
                const bag = this._dragSel ? (this._carried || (this._carried = new Set())) : this._dropping.ids;
                for (const c of carries) bag.add(c[0]);
            }
            return;
        }
        if (!this._underFrames(frame, s.frames)) return;
        const q = this._carriedLater || (this._carriedLater = new Map());
        for (const c of carries) q.set(c[0], String(frame));
        // A list built outside a render (a ladder rung, a prebake) has no end to flush at.
        if (!this._carriedFlush) { this._carriedFlush = true; Promise.resolve().then(() => this._flushCarried()); }
    }
    /** The carries queued outside a drag, for the selection they were carried out of: at a render's end, or a microtask later. */
    _flushCarried() {
        this._carriedFlush = false;
        const q = this._carriedLater;
        this._carriedLater = null;
        const s = this.selection;
        if (!q || !q.size || !s) return;
        const ids = [];
        for (const [id, frame] of q) if (this.lm.frame(frame) && this._underFrames(frame, s.frames)) ids.push(id);
        if (!ids.length) return;
        if (this._dragSel) { for (const id of ids) (this._carried || (this._carried = new Set())).add(id); return; }
        this._reselect(ids, []);
    }
    /** Of `ids`, the frames no selected frame holds (a sub-cell rest re-homed them next door), coarsest first, none under another. */
    _outsideSelection(ids) {
        const s = this.selection, out = [];
        if (!s) return out;
        const fr = [];
        for (const id of ids) { const f = this.lm.frame(id); if (f) fr.push(f); }
        for (const f of fr.sort((p, q) => p.depth - q.depth)) {
            if (this._underFrames(f.id, s.frames) || this._underFrames(f.id, out)) continue;
            out.push(f.id);
        }
        return out;
    }
    /** An undo or a redo: the natives it re-homes and the frames it re-addresses out of the selection stay selected. */
    _keepingSelection(fn) {
        if (!this.selection || !this.selection.frames.length) return fn();
        this._moving = { ids: new Set(), frames: new Set() };
        try { return fn(); } finally {
            const m = this._moving;
            this._moving = null;
            if (this.selection && (m.ids.size || m.frames.size)) this._reselect([...m.ids], this._outsideSelection(m.frames));
        }
    }
    /**
     * The selection keeps standing for the ink it stood for (DESIGN.md §10). A subtree drag's rest
     * and its settles move ink across cell edges (§8): a frame no selected frame holds any more joins
     * as a frame, a carried native as an id (and leaves the ids when a selected frame holds it
     * again), and a frame left with no ink leaves.
     */
    _reselect(ids, torn) {
        const s = this.selection;
        if (!s) return;
        const frames = s.frames.concat(torn);
        const add = [], back = new Set();
        for (const id of ids) {
            const rec = this.doc.getById(id);
            if (!rec) continue;
            const under = this._underFrames(rec.level, frames), listed = s.ids.includes(id);
            if (!under && !listed) add.push(id);
            else if (under && listed) back.add(id);
        }
        const inked = this._inkedFrames();
        const keep = frames.filter((f) => inked.has(f));
        if (!add.length && !back.size && keep.length === s.frames.length && keep.every((f, k) => f === s.frames[k])) return;
        this._setSelection(s.ids.filter((id) => !back.has(id)).concat(add), keep);
    }
    // Every native, with its bbox in the ACTIVE frame's units. Nothing in the
    // engine uses this any more — `_lassoFind` walks the frame tree instead —
    // but it is the ground truth the tree walk is checked against, so it stays
    // as the probe the suites read.
    _selectableRects() {
        const out = [];
        for (const k of this.doc.levels()) {
            for (const o of this.doc.at(k)) {
                if (o.erase) continue;
                const rect = this._rectInActive(o);
                if (rect) out.push({ o, level: k, rect });
            }
        }
        return out;
    }
    /** One native's drawn box in the ACTIVE frame's units, where its picture is (the scene's `placeNative`, A2 §2.6). */
    _rectInActive(o) { return this.stage.placeNative(o, this.cam.frame).box(); }
    /** A point of native `o`, in the active frame's units, where its picture is. */
    _objPointInActive(o, p) { return this.stage.placeNative(o, this.cam.frame).fromStored(p); }

    /**
     * EVERYTHING THE LASSO ENCLOSES, FOUND BY WALKING THE FRAME TREE (bible 6.4).
     *
     * Kobin: *"the frame tree should tell you which objects you need to look at
     * when selecting and zooming... since we're only worrying about objects
     * fully enclosed in the lasso, it can't be fully enclosed if it extends to a
     * neighbouring frame that is not included in the lasso."*
     *
     * That is the whole rule and it is exact rather than heuristic. Three
     * answers per frame:
     *
     *   OUT OF REACH   the frame's neighbourhood does not meet the lasso's box.
     *                  Skip the frame AND its subtree — a descendant lives
     *                  inside its parent's cell, so it cannot reach further.
     *   ENCLOSED       the lasso contains the whole neighbourhood. Every object
     *                  in the frame and below is inside, with no per-object test
     *                  at all.
     *   STRADDLING     only these ask about individual objects, and only the
     *                  ones the frame's own spatial index hands back.
     *
     * WHAT MAKES THE PRUNE SOUND is invariant 2: an object never extends past
     * its frame's immediate neighbours, so everything a frame's subtree holds is
     * inside its own cell grown by one — REACH below. D9's promotion and
     * `_normalizeHome` are what keep that true; break either and this starts
     * missing things rather than merely being slow.
     *
     * The walk goes OUTWARD from the active frame, one hop at a time, because
     * that is the only direction in which the scale factor stays a number: from
     * the root it would be R^depth before the first useful comparison.
     *
     * Returns `{ ids, frames }`: the object ids found one by one, and the ids of
     * the ENCLOSED frames, each standing for its whole subtree.
     */
    _lassoFind(poly) {
        const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        for (const p of poly) {
            if (p[0] < box.left) box.left = p[0];
            if (p[0] > box.right) box.right = p[0];
            if (p[1] < box.top) box.top = p[1];
            if (p[1] > box.bottom) box.bottom = p[1];
        }
        const found = [];
        const frames = [];
        const ink = loopTester(poly);
        // An enclosed frame is ONE entry of the selection. Its natives and its whole
        // subtree are inside the loop by invariant 2, tables included, so nothing under
        // it is read: O(1) per enclosed frame.
        const takeAll = (id) => { frames.push(id); };
        const inked = this._inkedFrames();
        // Enclosed frames holding part of a family the loop does not bound: read as straddling (LASSO-1).
        const noWhole = new Set();
        // `s`/`tx`/`ty` carry the frame's coordinates into the active frame's.
        // Used only for the two FRAME-level decisions, which are coarse; every
        // per-object rect still goes through `mapRectF` hop by hop.
        const visit = (id, s, tx, ty, skip) => {
            if (!inked.has(id)) return;                                       // nothing under it to select
            const own = reachBox(this.lm.frame(id), s, tx, ty);
            if (own.right < box.left || own.left > box.right
                || own.bottom < box.top || own.top > box.bottom) return;      // out of reach
            if (!noWhole.has(id) && rectInsidePolygon(poly, own)) { takeAll(id); return; }   // enclosed
            for (const o of this.doc.queryRect(id, { left: (box.left - tx) / s, top: (box.top - ty) / s,
                right: (box.right - tx) / s, bottom: (box.bottom - ty) / s })) {
                if (o.erase) continue;
                const r = this._rectInActive(o);
                if (!r) continue;
                if (rectInsidePolygon(poly, r)) { found.push(o.id); continue; }
                // The box failed. A box is a generous stand-in for the ink: a
                // slanted stroke's box reaches into corners its ink never
                // visits, and a loop passing through such a corner dropped an
                // object whose ink was wholly inside — the crossbar of a "t"
                // in Kobin's 2026-09-03 screenshot, F32. So where the box at
                // least meets the loop's own box, the ink itself is asked.
                if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
                if (this._inkInsidePolygon(o, id, ink)) found.push(o.id);
            }
            for (const c of this.lm.childrenOf(id)) {
                if (c.id === skip || !c.centre) continue;
                visit(c.id, s / CROSS_RATIO, c.centre.x * s + tx, c.centre.y * s + ty, null);
            }
        };
        for (let pass = 0; pass < LASSO_PASSES; pass++) {
            found.length = 0; frames.length = 0;
            if (this._ufMemo) this._ufMemo.delete(frames);   // refilled in place: `_underFrames`' memo keys on the array
            this._lassoWalk(visit);
            const away = this._lassoMoved(poly, box, ink, found, frames);
            const torn = frames.length ? this._tornUnder(frames, found) : null;
            if ((!torn || !torn.size) && !away.size) break;
            for (const f of torn || []) noWhole.add(f);
            for (const f of away) noWhole.add(f);
        }
        // A RE-HOMED FAMILY IS ONE OBJECT, and "fully bounded by the loop" is
        // asked of the whole of it: a loop around a ceded tile alone has not
        // bounded the object the tile is part of, and must not take it.
        // (Kobin, 2026-09-03: "if I lasso a child tile, it is selecting the
        // parent now.") Every piece of the family has to be in `found`.
        const set = new Set(found);
        const whole = new Map();
        const out = [];
        for (const id of set) {
            const rec = this.doc.getById(id);
            if (!rec) continue;
            // A keyless native is a family of one: a family key is the id of an object its pieces
            // replaced, never of one still in the document, so nothing else can share it.
            if (rec.obj.editId == null) { out.push(id); continue; }
            const key = this.doc.editKey(rec.obj);
            let ok = whole.get(key);
            if (ok === undefined) {
                ok = this._familyBounded(rec.obj, set, frames);
                whole.set(key, ok);
            }
            if (ok) out.push(id);
        }
        return { ids: out, frames };
    }
    /** The lasso's frame walk: the active frame and everything under it, then out through each ancestor. */
    _lassoWalk(visit) {
        visit(this.cam.frame, 1, 0, 0, null);
        let child = this.lm.frame(this.cam.frame), s = 1, tx = 0, ty = 0;
        while (child && child.parent != null) {
            const c = child.centre;
            if (!c) break;
            s *= CROSS_RATIO; tx -= c.x * s; ty -= c.y * s;
            visit(child.parent, s, tx, ty, child.id);                        // skipping the branch already done
            child = this.lm.frame(child.parent);
        }
    }
    /**
     * Is the family of `o` bounded by the loop: every piece found, a pending mark, or under an
     * enclosed frame (a piece homed there is taken through it, report 2026-09-24T04-25-10)?
     */
    _familyBounded(o, found, frames) {
        return this.doc.editGroup(o).every((m) => m.obj.erase || found.has(m.obj.id)
            || (frames.length > 0 && this._underFrames(m.level, frames)));
    }
    /**
     * The frames an enclosed frame may not stand for whole: the path from each keyed native under
     * it whose family the loop does not bound (a ceded kid of a stroke outside it) up to the frame.
     * Reads only the keyed natives under enclosed frames (`Document.keyedIn`), never their other
     * ink (REVIEWER-3 LASSO-1: a drag then tore the kid out of the stroke).
     */
    _tornUnder(frames, found) {
        const keyed = new Set();
        for (const k of this.doc.keyedFrames()) {
            for (let f = this.lm.frame(k); f && !keyed.has(f.id); f = f.parent != null ? this.lm.frame(f.parent) : null) keyed.add(f.id);
        }
        const set = new Set(found), whole = new Map(), torn = new Set();
        const check = (fid, top) => {
            for (const o of this.doc.keyedIn(fid) || []) {
                const key = this.doc.editKey(o);
                let ok = whole.get(key);
                if (ok === undefined) { ok = this._familyBounded(o, set, frames); whole.set(key, ok); }
                if (ok) continue;
                for (let f = this.lm.frame(fid); f; f = f.parent != null ? this.lm.frame(f.parent) : null) {
                    torn.add(f.id);
                    if (f.id === top) break;
                }
            }
        };
        const down = (fid, top) => {
            check(fid, top);
            for (const c of this.lm.childrenOf(fid)) if (keyed.has(c.id)) down(c.id, top);
        };
        for (const X of frames) if (keyed.has(X)) down(X, X);
        return torn;
    }
    /**
     * A MOVED NATIVE IS INDEXED AT ITS STORED BITS and drawn elsewhere (F41/F55, A1 C1), so the
     * frames' indexes never see its picture — a loop around moved ink selected nothing (F69). Every
     * displaced native judged where it is drawn. Under an enclosed frame the union box covers what its
     * frame's shift displaces; one with a table of its own drawn outside the loop makes the frames
     * from its home up to the enclosed one not whole (H6), returned for the next pass.
     */
    _lassoMoved(poly, box, ink, found, frames) {
        const away = new Set();
        if (!this.doc.hasOffsets()) return away;
        const have = new Set(found);
        const F = this.cam.frame;
        const inside = (o, home) => {
            const r = this._rectInActive(o);
            if (!r) return null;
            if (rectInsidePolygon(poly, r)) return true;
            if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) return false;
            return this._inkInsidePolygon(o, home, ink);
        };
        for (const [o, home] of this.doc.displacedNatives()) {
            if (have.has(o.id) || o.erase || this.lm.frameFactor(home, F) == null) continue;
            if (frames.length && this._underFrames(home, frames)) {
                if (!this.doc.hasOwnTable(o) || inside(o, home) !== false) continue;   // its frame is one entry
                for (let f = this.lm.frame(home); f; f = f.parent != null ? this.lm.frame(f.parent) : null) {
                    away.add(f.id);
                    if (frames.includes(f.id)) break;
                }
                continue;
            }
            if (inside(o, home)) found.push(o.id);
        }
        return away;
    }
    /**
     * Is this object's INK wholly inside the loop? The outline is flattened at
     * a few pixels in its own frame and mapped into the active frame hop by
     * hop; `ink` is the loop prepared by `loopTester`. Only reached for objects
     * whose box straddles the loop, so the cost is per object that could go
     * either way, never per object on the page.
     */
    _inkInsidePolygon(o, level, ink) {
        const f = this.lm.frameFactor(level, this.cam.frame);
        if (f == null) return false;
        const pxPerUnit = this.cam.inScale * f;
        if (!(pxPerUnit > 0)) return false;
        const toActive = (p) => this._objPointInActive(o, p);
        // BEFORE FLATTENING ANYTHING: the points the object already has. A
        // shape's arc endpoints, a fill's vertices, a stroke's samples — a
        // few hundred of them, mapped and asked one by one. Any of them
        // outside the loop and the answer is no, with nothing resolved. This
        // is where the objects a loop CROSSES leave, and they are the
        // expensive ones: a scribble of twenty thousand arcs costs 14 ms to
        // flatten even coarsely, and Kobin's loop crossed twenty-one of them.
        const raw = o.type === "shape" ? null : o.type === "fill" ? o.polys : [o.pts];
        if (raw) {
            for (const ring of raw) for (const p of everyNth(ring, 200)) {
                const q = toActive(p);
                if (!q || !ink.inside(q)) return false;
            }
        } else if (o.loops) {
            const ends = [];
            for (const loop of o.loops) for (const piece of loop) ends.push(piece.A);
            for (const p of everyNth(ends, 400)) {
                const q = toActive(p);
                if (!q || !ink.inside(q)) return false;
            }
        }
        const tol = LASSO_INK_TOL_PX / pxPerUnit;
        let rings;
        try { rings = this._inkOutline(o, tol); } catch (err) { return false; }
        if (!rings || !rings.length) return false;
        for (const ring0 of rings) {
            if (!ring0 || ring0.length < 2) continue;
            const ring = everyNth(ring0, LASSO_INK_MAX_PTS);
            const mapped = [];
            for (const p of ring) {
                const q = toActive(p);
                if (!q) return false;
                mapped.push(q);
            }
            if (!ink.ringInside(mapped)) return false;
        }
        return true;
    }
    // A selection is ids PLUS frames: a frame entry means that frame and its whole
    // subtree (§2.7). The primary member is the first live id, or the first frame
    // when the selection is frames only.
    _setSelection(ids, frames = []) {
        const live = ids.filter((id) => this.doc.getById(id));
        const fr = [...new Set(frames)].filter((f) => this.lm.frame(f));
        if (!live.length && !fr.length) { this.deselect(); return null; }
        const rec = live.length ? this.doc.getById(live[0]) : null;
        this.selection = {
            ids: live, frames: fr, id: rec ? rec.obj.id : null, editId: rec ? this.doc.editKey(rec.obj) : null,
            level: rec ? rec.level : fr[0], obj: rec ? rec.obj : null,
        };
        this._syncStep(); this.renderer.update();
        this._emit();
        return this.selection;
    }
    // A ctrl-tap adds or removes ONE object and keeps every selected frame (OPEN-FLAGS F82: the
    // frames were dropped, and a drag then left their content behind). An object inside a
    // selected frame is already selected through it, so the tap changes nothing.
    _toggleSelected(id) {
        const frames = this.selection ? [...(this.selection.frames || [])] : [];
        const rec = this.doc.getById(id);
        if (rec && frames.length && this._underFrames(rec.level, frames)) return this.selection;
        const cur = this.selection ? [...this.selection.ids] : [];
        const i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1); else cur.push(id);
        return this._setSelection(cur, frames);
    }
    // Close the loop and apply it.
    //   plain     replace the selection with everything the loop bounds
    //   ctrl      ADD everything it bounds — unless the loop was drawn purely
    //             inside the current selection, which REMOVES instead
    _applyLasso(L) {
        const poly = L.pts.map(([x, y]) => this.cam.screenToFrame(x, y));
        // The erase barrier first (A2 §4.11, H5): the loop judges the cut-outs, not what was under a mark.
        const judge = () => {
            if (this._lassoParked === L) { this._lassoParked = null; this._judgeLasso(L, poly); this.renderer.refreshSelection(); this._emit(); }
            else this._judgeLasso(L, poly);
        };
        if (!this._lassoBarrier(poly, judge)) { this._lassoParked = L; this._barrier.lasso = true; }
    }
    _judgeLasso(L, poly) {
        const { ids: found, frames } = this._lassoFind(poly);
        if (!L.ctrl) {
            if (found.length || frames.length) this._setSelection(found, frames); else this.deselect();
            return;
        }
        const cur = this.selection ? [...this.selection.ids] : [];
        const curFr = this.selection ? [...(this.selection.frames || [])] : [];
        if (!found.length && !frames.length) return;
        // A ctrl loop that catches nothing new is a loop drawn PURELY INSIDE the
        // current selection, and that gesture subtracts. Catch anything new and
        // it is an overlapping loop, which adds. One rule, and it reads the same
        // way round as a group-level toggle.
        if (found.every((id) => cur.includes(id)) && frames.every((f) => curFr.includes(f))) {
            this._setSelection(cur.filter((id) => !found.includes(id)), curFr.filter((f) => !frames.includes(f)));
            return;
        }
        for (const id of found) if (!cur.includes(id)) cur.push(id);
        for (const f of frames) if (!curFr.includes(f)) curFr.push(f);
        this._setSelection(cur, curFr);
    }

    // ---- selection / edit (US-10) ----
    // Tap-select the topmost object under the point (same hit policy as the
    // object eraser). Selecting through a derived piece selects the NATIVE —
    // edits apply at its home level and re-derive everywhere. The erase barrier
    // (A2 §4.11): what is pending over the object's family is cut first — parked
    // while the cuts are in workers — and then the point is picked again, so the
    // selection is the piece under the finger (SM-5: the half not pressed stays).
    // `after`: run once the tap has settled.
    select(sx, sy, after = null, guard = 0) {
        const id = this._hitTest(sx, sy);
        if (id == null) { this.deselect(); if (after) after(); return null; }
        const done = this._tapBarrier(id, (ids, b) => {
            if (!b.rounds && ids.length) { this._setSelection(ids); if (after) after(); return; }
            this._render();
            if (guard < 8) { this.select(sx, sy, after, guard + 1); return; }   // what shows there now
            this.deselect();
            if (after) after();
        });
        return done && this.selection ? this.selection.id : null;
    }
    deselect() {
        this._cancelBarrier();              // a gesture parked on its erase barrier goes with the selection
        if (!this.selection) return;
        if (this._dragSel) this._endMove("deselect");   // the one exit: batch, hold and merges released
        this.selection = null;
        this._syncStep(); this.renderer.update();
        this._emit();
    }
    // The VISIBLE union of a logical edit family in the active frame — tight
    // around a re-homed patch instead of the astronomical bbox of its coarse
    // source. No production caller since the bounding-box indicator's last
    // plumbing went (S8, 2026-09-14); the suites read it to assert what a
    // selection projects to.
    _selectionRect() {
        const s = this.selection; if (!s) return null;
        const keys = new Set();
        for (const id of s.ids) {
            const rec = this.doc.getById(id);
            if (rec) keys.add(this.doc.editKey(rec.obj));
        }
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const item of this.stage.items()) {
            const rec = this.doc.getById(item.id);
            if (!rec || !keys.has(this.doc.editKey(rec.obj))) continue;
            const { geom: o, off } = this.stage.placed(item);   // drawn shifted by its offset (F41)
            const b = bboxOf(o, this.store.live);
            const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
            left = Math.min(left, b.x0 - m + off[0]); top = Math.min(top, b.y0 - m + off[1]);
            right = Math.max(right, b.x1 + m + off[0]); bottom = Math.max(bottom, b.y1 + m + off[1]);
        }
        if (left !== Infinity) return { level: this.cam.frame, rect: { left, top, right, bottom } };
        // Not drawn (culled from the list): where its picture is, through its table (F68).
        const r = this._rectInActive(s.obj);
        if (r) return { level: this.cam.frame, rect: r };
        const b = bboxOf(s.obj, this.store.live);
        const m = s.obj.type === "fill" ? 0 : (s.obj.lwFrame || 0) / 2;
        return { level: s.level, rect: { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m } };
    }
    /**
     * One drag step. The displacement, snapped to the camera level's grid (F55), is expanded per
     * member into whole frames (a change of address) and a table entry at the camera's depth below
     * the member's home; no stored coordinate is touched (DESIGN.md §8). Two facts: the arithmetic
     * runs ONCE per (home frame, starting table) and every member of that frame takes the same
     * answer, which is what registration rests on; and the step is recomputed from where the drag
     * STARTED, so a slow drag and a fast one apply the same arithmetic to the same numbers (M-4).
     */
    _dragSelection(sx, sy) {
        const d = this._dragSel;
        d.last = [sx, sy];                   // where the pointer is now; the indicator rides on it
        // THE DISPLACEMENT, ON THE LEVEL'S GRID (F55). Snapped to 2^-10 of the
        // camera level's unit — a quarter pixel at that level's deepest zoom,
        // far finer at any shallower one (Kobin: "if it's precise to the
        // quarter pixel, that's good enough, and cheapens addressing"). A
        // snapped displacement is whole cells from three levels below the
        // move; a raw float takes five. Fixed per level, not per zoom, so the
        // same move gives the same digits every time.
        const tx = snapDisplacement((sx - d.start[0]) / this.cam.inScale);
        const ty = snapDisplacement((sy - d.start[1]) / this.cam.inScale);
        const camDepth = this.cam.activeLevel;
        let moved = false;
        // A member the drag could not move, and why. Nothing used to record
        // these (F35): a selection that moves "together" with one member left
        // behind is precisely the reported symptom, and the report carried no
        // trace of the decision. Journaled with the move at pen-up.
        const skip = (id, level, why) => { (d.skipped || (d.skipped = [])).push({ id, level, why }); };
        const seen = new Map();                          // (frame, table) -> the answer
        const rehomes = new Map();                       // target frame -> ids, in member order
        const offsets = [];                              // [id, table] whose table changed
        // The members once a drag: a step re-homes them, and every re-home rebuilt the family index
        // over the whole document (36–80 ms a step on the Earth, REVIEWER A1-4).
        if (!d.members) d.members = this._selectionMembers().map((m) => m.obj);
        for (const o of d.members) {
            const id = o.id;
            if (this.doc._byId.get(id) !== o || o._gone) continue;       // gone meanwhile
            let st = d.moves.get(id);
            if (!st) {
                st = { from: o._home, to: o._home, dx: 0, dy: 0, baseBelow: cloneBelow(o.below) };
                st.below = st.baseBelow;
                st.key = st.from + "|" + JSON.stringify(st.baseBelow || null);
                d.moves.set(id, st);
            }
            const key = st.key;
            let put = seen.get(key);
            if (!put) { put = this._displaceMember(st.from, st.baseBelow, camDepth, tx, ty); seen.set(key, put); }
            if (put.why) { skip(id, st.from, put.why); continue; }
            if (put.frame !== st.to) {
                let ids = rehomes.get(put.frame);
                if (!ids) rehomes.set(put.frame, ids = []);
                ids.push(id); st.to = put.frame; moved = true;
            }
            if (!sameBelow(put.table, st.below)) { offsets.push([id, put.table]); st.below = put.table; moved = true; }
            st.dx = tx; st.dy = ty;              // for the journal: the snapped displacement, camera units
        }
        const write = () => {
            for (const [frame, ids] of rehomes) this.doc.rehomeManyById(ids, frame);
            for (const [id, table] of offsets) this.doc.setOffsetsById(id, table);
        };
        // One commit a step (PLAN §5.7); none while the Stage holds the move, as a batch ends in a commit.
        if (this.stage.holding) write(); else this.stage.batch(write);
        if (this.selection.frames.length) {
            if (!d.frameStart) this._dragFramesStart(d, camDepth);
            if (d.frameStart.size && this._dragFrames(d, camDepth, tx, ty)) moved = true;
        }
        d.moved = d.moved || moved;
        // With the hold on, the drag plane draws the move (PAPER-PLAN §10 S4): no list is built per
        // step — 120–240 ms each on the Magnum Opus — and the plates stay as they were until the drop.
        if (this._holdMove && this.renderer.dragLight && this.renderer.dragLight()) {
            if (!d.listAt) d.listAt = d.start;           // the list the ants decide on is the pre-drag one
            // The table stays as the drag began (the Stage holds it); the drop's render reads what moved.
            this.renderer.syncCameraOnly(); this.renderer.update(); this._emit();
        } else { d.listAt = null; this._render(); }
    }
    /**
     * The frames a drag moves AS FRAMES: each selected root's subtree within three levels of
     * the camera (deeper frames follow their parent pointer), recorded once at its start
     * address so every event computes the whole step from the start (DESIGN.md §8). An empty
     * leaf container is left out: it has nothing to move and would only accrete.
     */
    _dragFramesStart(d, camDepth) {
        d.frameStart = new Map();
        this.doc.holdMerges = true;          // a shadow the drag makes is merged only once the op is pushed
        const all = this.selection.frames;
        for (const f of all) {
            if (this._underFrames(f, all.filter((x) => x !== f))) continue;
            for (const [id, e] of this.lm.subtreeStart(f, camDepth)) {
                if (id !== f && !this.lm.childrenOf(id).length && this.doc.count(id) === 0) continue;
                d.frameStart.set(id, e);
                const fr = this.lm.frame(id);
                d.frames.set(id, { id, depth: e.depth, from: { parent: e.parent, i: e.i, j: e.j }, to: null,
                    shiftBefore: fr && fr.shift ? [fr.shift[0], fr.shift[1]] : null, shiftAfter: null, settled: null, merged: null });
            }
        }
    }
    /**
     * One drag step for the frames: targets from the start state (the same arithmetic the
     * per-object path uses, frame for frame), applied in one pass; a frame's shift is what
     * it carried plus this step's rest, settled into its natives' tables at their next read
     * (a carry re-homes them then, exactly as the per-object path does). A frame a render
     * settled mid-drag is unsettled before it takes the new shift, so the tables never hold
     * two steps at once (O(its natives): the cost of drawing it). Never per object otherwise.
     */
    _dragFrames(d, camDepth, tx, ty) {
        const targets = this.lm.moveSubtreeTargets(null, camDepth, tx, ty, d.frameStart, (id) => { const e = d.frames.get(id); return e ? e.shiftBefore : null; });
        const apply = [];
        for (const t of targets) {
            const e = d.frames.get(t.id);
            if (t.why) { (d.skipped || (d.skipped = [])).push({ id: t.id, level: t.id, why: t.why }); continue; }
            e.shiftAfter = t.shift;                        // within ±W/2, its whole cells in the address (§2.2)
            if (e.settled && !sameShift(e.shiftAfter, [e.settled.dx, e.settled.dy])) { this.doc.unsettle(e.id, e.settled); e.settled = null; }
            apply.push(t);
        }
        const was = new Map(apply.map((t) => { const f = this.lm.frame(t.id); return [t.id, { parent: f.parent, i: f.cell.i, j: f.cell.j, shift: f.shift }]; }));
        const r = this.lm.readdressMany(apply, { empty: (id) => this.doc.count(id) === 0 });
        let moved = false;
        for (const t of apply) {
            const e = d.frames.get(t.id);
            const f = this.lm.frame(t.id);
            const to = { parent: f.parent, i: f.cell.i, j: f.cell.j };
            const w = was.get(t.id);
            const addrChanged = to.parent !== w.parent || to.i !== w.i || to.j !== w.j;
            const shiftChanged = !e.settled && !sameShift(f.shift, e.shiftAfter);
            // A shift alone moves the frame's picture too: the caches drop its footprint as for a re-address.
            if (addrChanged || shiftChanged) this.doc.noteRefile(t.id, w, { ...to, shift: shiftChanged ? e.shiftAfter : f.shift });
            if (shiftChanged) this.doc.setFrameShift(t.id, e.shiftAfter);
            this.doc.noteFrameOwner(t.id, e);
            e.to = to;
            if (addrChanged || shiftChanged) moved = true;
        }
        for (const c of r.shadowed) (d.frameShadowed || (d.frameShadowed = [])).push(c);
        return moved;
    }
    /** A cancelled drag: the frames back to their start addresses and shifts, any settle undone. */
    _restoreFrames(d) {
        for (const e of d.frames.values()) if (e.settled) { this.doc.unsettle(e.id, e.settled); e.settled = null; }
        const back = [], was = new Map();
        for (const e of d.frames.values()) {
            const f = this.lm.frame(e.id);
            if (!f) continue;
            if (f.parent === e.from.parent && f.cell.i === e.from.i && f.cell.j === e.from.j) continue;
            was.set(e.id, { parent: f.parent, i: f.cell.i, j: f.cell.j, shift: f.shift });
            back.push({ id: e.id, depth: e.depth, parent: e.from.parent, i: e.from.i, j: e.from.j });
        }
        this.lm.readdressMany(back, { empty: (id) => this.doc.count(id) === 0 });
        for (const t of back) { const f = this.lm.frame(t.id); this.doc.noteRefile(t.id, was.get(t.id), { parent: f.parent, i: f.cell.i, j: f.cell.j, shift: d.frames.get(t.id).shiftBefore }); }
        for (const e of d.frames.values()) { this.doc.setFrameShift(e.id, e.shiftBefore); this.doc.noteFrameOwner(e.id, null); }
        this.doc.holdMerges = false;
    }
    /** The selected frame whose mark is under the screen point, or null. */
    _frameUnderPoint(sx, sy) {
        const s = this.selection; if (!s || !s.frames.length) return null;
        for (const f of s.frames) {
            const p = this.cam.levelPointToScreen(f, 0, 0);
            if (p && Math.hypot(p[0] - sx, p[1] - sy) <= SEL_FRAME_HIT_PX) return f;
        }
        return null;
    }
    /**
     * Where a member homed in `from` with starting table `below` goes for the displacement (tx, ty)
     * made at `camDepth`: its frame and its table, or `why` it cannot move (F35, journaled at pen-up).
     * At or below the camera the displacement enters the table at the camera's depth and carries
     * out of the home level as a change of address; deeper, the cell digits re-address the member
     * and the rest enters its home-level entry. Pure in the lattice's state, so every member with
     * the same inputs shares one answer.
     */
    _displaceMember(from, below, camDepth, tx, ty) {
        const depth = this.lm.depthOf(from);
        if (depth == null) return { why: "home frame has no depth" };
        let frame = from, r;
        if (depth <= camDepth) r = addOffset(below, camDepth - depth, tx, ty);
        else {
            const put = this.lm.displaceFrame(from, camDepth, tx, ty);
            if (!put) return { why: "displaceFrame refused: no frame at the camera's depth on this member's ancestry" };
            frame = put.frame.id;
            r = addOffset(below, 0, put.rest[0], put.rest[1]);
        }
        if (r.cellX || r.cellY) {
            const n = this.lm.neighbour(frame, r.cellX, r.cellY);
            if (!n) return { why: "no neighbour cell for the carry" };
            frame = n.id;
        }
        return { frame, table: r.below };
    }
    /** The cell an object's bbox centre sits in, as the re-home that would put it there, or null when it is in its own cell. */
    _homeShift(id) {
        const rec = this.doc.getById(id);
        if (!rec) return null;
        const b = bboxOf(rec.obj, this.store.live);
        if (!b) return null;
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        const di = Math.round(cx / FRAME_W), dj = Math.round(cy / FRAME_W);
        if (!di && !dj) return null;
        const to = this.lm.neighbour(rec.level, di, dj);
        if (!to || to.id === rec.level) return null;
        return { level: to.id, dx: -di * FRAME_W, dy: -dj * FRAME_W };
    }
    /**
     * Put an object back inside its own cell, if a move pushed it out.
     *
     * Invariant 2 wants an object within a cell of its frame. A drag at or above
     * an object's own level puts the whole displacement into its coordinates, so
     * enough of them walk it out of its cell; and a deep move leaves a remainder
     * that can be almost a whole frame. Re-homing to the containing cell costs
     * nothing in accuracy — neighbouring origins differ by exactly W, a power of
     * two, so subtracting whole frames is exact.
     */
    _normalizeHome(id) {
        const n = this._homeShift(id);
        if (!n) return null;
        this.doc.rehomeById(id, n.level);
        this.doc.moveById(id, n.dx, n.dy);
        return n;
    }
    // Every native the selection covers: each selected id, plus the rest of its
    // logical edit family (a re-homed patch still moves with its source).
    _selectionMembers() {
        const s = this.selection; if (!s) return [];
        const seen = new Set(), out = [];
        for (const id of s.ids) {
            const rec = this.doc.getById(id);
            if (!rec) continue;
            for (const m of this.doc.editGroup(this.doc.editKey(rec.obj))) {
                if (seen.has(m.obj.id)) continue;
                seen.add(m.obj.id);
                if (s.frames.length && this._underFrames(m.level, s.frames)) continue;   // its frame moves it: once
                out.push(m);
            }
        }
        // Selected frames are not expanded: the drag moves them as frames (`_dragFrames`) and
        // the delete sets them aside as containers; nothing reads their natives here.
        return out;
    }
    /**
     * Delete what the selection stands for as ONE undoable action: its ids with their families and
     * its frames as containers. First the carries not yet applied and, mid-drag, the ink the drag has
     * moved out of its frames join it; otherwise they would join only at the drop (F93).
     */
    deleteSelection() {
        if (this._carriedLater) this._flushCarried();
        const dr = this._dragSel;
        if (dr && this.selection) {
            const carried = this._carried ? [...this._carried] : [];
            this._carried = null;
            this._reselect(carried, dr.frames ? this._outsideSelection(dr.frames.keys()) : []);
        }
        const s = this.selection; if (!s) return false;
        const records = [];
        const seen = new Set();
        const frames = s.frames || [];
        const frameRecords = [];
        // One commit for the whole delete: a commit an event cost 487–558 ms for 5,000 natives (PLAN §5.7).
        this.stage.batch(() => {
            // The individually selected ids and their families, object by object — NOT through
            // `_selectionMembers`, whose bridge would expand a selected frame to its natives.
            for (const id of s.ids) {
                const hit = this.doc.getById(id);
                if (!hit) continue;
                for (const m of this.doc.editGroup(this.doc.editKey(hit.obj))) {
                    if (seen.has(m.obj.id)) continue;
                    seen.add(m.obj.id);
                    const rec = this.doc.removeById(m.obj.id);
                    if (rec) records.push(rec);
                }
            }
            // A selected frame goes as CONTAINERS: each frame's list detached by reference,
            // O(frames) and no per-object work (SUBTREE-O1-PLAN §2.3).
            for (const f of frames) {
                if (this._underFrames(f, frames.filter((x) => x !== f))) continue;   // an ancestor of it is going anyway
                const recs = this.doc.removeFrameSubtree(f);
                if (recs) frameRecords.push(...recs);
            }
        });
        if (!records.length && !frameRecords.length) return false;
        // One gesture, one op: objects only, frames only, or both as one `deleteMany`.
        if (!frameRecords.length) this.doc.pushUndo({ op: "eraseMany", records });
        else if (!records.length) this.doc.pushUndo({ op: "removeFrames", records: frameRecords });
        else this.doc.pushUndo({ op: "deleteMany", parts: [{ op: "eraseMany", records }, { op: "removeFrames", records: frameRecords }] });
        if (this._dragSel || this._holdMove) this._endMove("delete");   // the members' removals were held
        this.deselect();
        this._render();
        return true;
    }
    // Style is deliberately NOT reported: colour, width and opacity editing of a
    // selection were removed along with the selection style box, so nothing
    // downstream should be able to reach for them.
    _selectionStatus() {
        const s = this.selection; if (!s) return null;
        return {
            id: s.id, ids: [...s.ids], frames: [...s.frames],
            // A frame under another selected one is counted by it (an undo re-nests a frame a drag tore off).
            count: s.ids.length + s.frames.reduce((n, f) => n + (this._underFrames(f, s.frames.filter((x) => x !== f)) ? 0 : this._subtreeCount(f)), 0),
            type: s.obj ? s.obj.type : "frame", level: s.level,
        };
    }
    // How many natives a frame stands for: its own list plus its subtree's and its shadows' (O(frames)).
    _subtreeCount(f) {
        let n = 0;
        this.lm.walk(f, (fr) => { n += this.doc.count(fr.id); });
        return n;
    }
    // Is the point in the shape, or within `slack` of it? A resolved perimeter
    // answers "inside" exactly, but picking wants a little reach, so a miss is
    // retried on a ring of probes at the slack radius. Eight is enough: the ink
    // is a pen stroke, never a needle.
    _shapeHit(loops, p, slack, o = null) {
        // The nine probes share one index of the pieces, kept per object while its loops stand
        // (195 ms a pick over 14,119 pieces with a scan a probe, REVIEWER-3 EFF-2). A WeakMap: a
        // native is wired to the erase worker, and a field holding a function would not clone.
        let inside = null;
        if (o) {
            const m = this._hitIx || (this._hitIx = new WeakMap());
            const c = m.get(o);
            if (c && c.loops === loops && c.ver === o._ver) inside = c.inside;
            else { inside = insideTester(loops); m.set(o, { loops, ver: o._ver, inside }); }
        } else inside = insideTester(loops);
        if (inside(p)) return true;
        if (!(slack > 0)) return false;
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            if (inside([p[0] + slack * Math.cos(a), p[1] + slack * Math.sin(a)])) return true;
        }
        return false;
    }
    /**
     * A mark smaller than the reach is picked anywhere its box is within reach: the eight probes
     * sit on the reach's ring, and a sub-pixel dot between them was picked only by a press exactly
     * on it (TESTER-2, 2026-09-24: a press on a lassoed dot took the ink under it).
     */
    _tinyHit(b, slack) { return slack > 0 && b.x1 - b.x0 < slack && b.y1 - b.y0 < slack; }
    /**
     * What is under this screen point, or null. Public because the cursor has
     * to answer the same question the click will: ctrl over a selected object
     * REMOVES it, ctrl anywhere else ADDS, and the sign shown has to match.
     */
    hitTestAt(sx, sy) { return this._hitTest(sx, sy); }
    /** The landed marks whose ink covers frame point `p0`, or null: a pick skips their masked targets there. */
    _marksAt(items, p0) {
        if (!this._marks || !this._marks.size) return null;
        let out = null;
        for (const it of items) {
            if (!it.erase || it.pending || !it.nat || it.nat.targets === undefined) continue;
            const { geom: g, off } = this.stage.placed(it);
            const p = off[0] || off[1] ? [p0[0] - off[0], p0[1] - off[1]] : p0;
            const b = bboxOf(g, this.store.live);
            if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) continue;
            const inside = g.type === "shape" ? this._shapeHit(g.loops, p, 0, g) : g.type === "fill" ? windingOfPoint(g.polys, p) !== 0 : false;
            if (inside && !(out || (out = [])).includes(it.nat)) out.push(it.nat);
        }
        return out;
    }
    // `slackPx`: how far past the ink a pick still counts, in screen pixels.
    // Six for every real pick; tests that ask "is this point INSIDE the ink"
    // (a hole a few pixels wide, seen from far above) pass 0.
    // `only(id)`: when given, the topmost hit it accepts (a pick among the selection).
    _hitTest(sx, sy, slackPx = 6, only = null) {
        const p0 = this.cam.screenToFrame(sx, sy);
        const items = this.stage.items();
        const slack = slackPx / this.cam.inScale;
        const over = this._marksAt(items, p0);
        for (let i = items.length - 1; i >= 0; i--) { // topmost first
            // What the scene draws, and where: a piece shifted by its offset (F41) is hit where it is drawn.
            const { geom: o, off } = this.stage.placed(items[i]);
            const p = off[0] || off[1] ? [p0[0] - off[0], p0[1] - off[1]] : p0;
            let hit = false;
            if (o.type === "shape") {
                // Bounding box first. A resolved perimeter answers "inside"
                // exactly, but it does so by walking every piece, and the ring of
                // slack probes multiplies that by nine — on a scribble with
                // thousands of pieces that is real work per object per click, and
                // almost every object is nowhere near the point.
                const b = bboxOf(o, this.store.live);
                if (p[0] < b.x0 - slack || p[0] > b.x1 + slack
                    || p[1] < b.y0 - slack || p[1] > b.y1 + slack) continue;
                hit = this._tinyHit(b, slack) || this._shapeHit(o.loops, p, slack, o);
            }
            else if (o.type === "fill") {
                // The same reach as a shape gets. A fill here is almost always
                // a TILE PIECE — ink seen from a level other than its home —
                // and until 2026-09-05 it was tested bare, so the same stroke
                // that picked at 13 px off-centre at home missed at 9 px when
                // shown as a down piece. Bounding box first, for the reason
                // given above: a piece can carry thousands of vertices.
                const b = bboxOf(o, this.store.live);
                if (p[0] < b.x0 - slack || p[0] > b.x1 + slack
                    || p[1] < b.y0 - slack || p[1] > b.y1 + slack) continue;
                hit = this._tinyHit(b, slack) || windingOfPoint(o.polys, p) !== 0;
                for (let k = 0; k < 8 && !hit && slack > 0; k++) {
                    const a = (k * Math.PI) / 4;
                    hit = windingOfPoint(o.polys, [p[0] + slack * Math.cos(a), p[1] + slack * Math.sin(a)]) !== 0;
                }
            }
            else {
                const pts = (o.origin === "native" && o.pts.length > 2) ? flattenCurve(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter) : o.pts;
                hit = distToPolyline(pts, p) <= o.lwFrame / 2 + slack;
            }
            if (!hit) continue;
            // Pending eraser ink is invisible to picking, and so is a target where its mark hides
            // it: the click falls through to what shows there (A2 §4.12).
            const nat = this.doc.getById(o.id);
            if (nat && nat.obj.erase) continue;
            if (over && nat && over.some((M) => underMask(nat.obj, M))) continue;
            if (only && !only(o.id)) continue;
            return o.id;
        }
        return null;
    }
}

export const selection = Selection.prototype;
