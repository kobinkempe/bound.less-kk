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
import { R as CROSS_RATIO, W as FRAME_W, REACH } from "./frameLattice";
import { bboxOf } from "./geometry/derive";
import { distToPolyline, windingOfPoint } from "./geometry/hittest";
import { flattenCurve } from "./geometry/polyline";
import { insideShape } from "./geometry/arcShape";
import { rectInsidePolygon, loopTester } from "./geometry/lasso";
import { addOffset, sameBelow, snapDisplacement, cloneBelow, sameShift } from "./geometry/offsets";

// How close to a selected frame's mark a press counts as pressing the frame.
const SEL_FRAME_HIT_PX = 8;

// How far a press has to travel before it is a drag rather than a tap. Screen
// pixels; a finger wobbles a few, a mouse none.
export const SELECT_DRAG_PX = 8;

// The ink test behind the lasso is a hand-gesture question, so it is asked
// at a hand-gesture precision: the outline flattened to LASSO_INK_TOL_PX,
// never more than LASSO_INK_MAX_PTS points of it, against a loop decimated to
// LASSO_LOOP_MAX_PTS. Measured on Kobin's 2026-09-03 drawing at a quarter
// pixel and against the loop as drawn: twelve borderline shapes cost 985 ms,
// eighty each, with the largest of them tens of thousands of points against a
// few hundred loop edges.
const LASSO_INK_TOL_PX = 3;
const LASSO_INK_MAX_PTS = 3000;
const LASSO_LOOP_MAX_PTS = 160;

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
     * selected a drag is always a lasso; a ctrl drag always is; otherwise a
     * drag from ink moves — the selection if the ink is part of it, that one
     * object if not — and a drag from paper lassoes.
     */
    _beginSelectDrag(P, sx, sy) {
        const startLasso = () => {
            this._lasso = { pts: [[P.sx, P.sy], [sx, sy]], ctrl: P.ctrl, moved: true };
            this.renderer.refreshSelection();
        };
        // A press on a selected frame's mark drags the selection as a press on selected ink does.
        const frameHit = P.hit == null && this.selection && this.selection.frames.length ? this._frameUnderPoint(P.sx, P.sy) : null;
        if ((P.hit == null && !frameHit) || P.ctrl || !this.selection) { startLasso(); return; }
        // Pressing an object that is ALREADY selected keeps the whole selection
        // and drags it; pressing a different one selects it alone.
        if (frameHit) { /* the frame's mark: the selection stands */ }
        else if (!this._isSelected(P.hit)) this.select(P.sx, P.sy);
        else this._flushErasesFor(P.hit);
        // The erase barrier has to cover EVERYTHING that is about to move, not
        // just the piece under the finger. A mark is a native sitting at fixed
        // coordinates; ink dragged out from under one that has not been applied
        // yet takes its un-erased shape with it, and the mark stays behind and
        // cuts whatever has arrived there instead. With several objects
        // selected, or one object whose family has a re-homed piece at another
        // level, the single-object flush left exactly that. It also left the
        // white mark itself on screen, hanging over the object being dragged.
        this._settleSelectionErases();
        if (!this.selection) { startLasso(); return; }   // the flush took the object away
        this._dragSel = { start: [P.sx, P.sy], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        // A drag rewrites the same objects on every pointer event; tiles the
        // camera cannot see are not worth patching that often.
        this.store.setBatch(true);
        this._dragSelection(sx, sy);
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
        if (this._lasso) {
            this._lasso = null;
            this.renderer.refreshSelection();
            this._emit();
        }
        const d = this._dragSel;
        if (!d) return;
        if (d.moved && commitIfMoved) { this._pointerUp(); return; }
        this._dragSel = null;
        this.store.setBatch(false);
        if (d.moved) {
            // Back to the frame and the table the drag started from; a move touches nothing else (F55).
            for (const [id, st] of d.moves) {
                if (!this.doc.getById(id)) continue;
                if (st.to !== st.from) this.doc.rehomeById(id, st.from);
                this.doc.setOffsetsById(id, st.baseBelow);
            }
            if (d.frames && d.frames.size) this._restoreFrames(d);
        }
        this._render();
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
    _underFrames(level, frames) {
        for (const f of frames) if (this.lm.isUnder(f, level)) return true;
        return false;
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
                const rect = this._rectInActive(o, k);
                if (rect) out.push({ o, level: k, rect });
            }
        }
        return out;
    }
    // One native's bbox, in the ACTIVE frame's units. Hop by hop through
    // `mapRectF` rather than through a composed factor: going DOWN to the active
    // frame a composed jump cancels catastrophically, which is the whole reason
    // the chain exists (bible section 4.1).
    _rectInActive(o, level) {
        const b = bboxOf(o, this.store.live);
        const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        const rect = { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m };
        if (!o.below) return this.lm.mapRectF(rect, level, this.cam.frame);
        // An object with a displacement table (F41/F55) is drawn where its
        // picture is; `mapRectObj` answers exactly that.
        return this.lm.mapRectObj(rect, level, this.cam.frame, o.below, level);
    }
    /** A point of native `o` (homed at `level`), in the active frame's units, where its picture is. */
    _objPointInActive(o, level, p) {
        const F = this.cam.frame;
        if (!o.below) return level === F ? p : this.lm.mapPointF(p, level, F);
        return this.lm.mapPointObj(p, level, F, o.below, level);
    }

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
        const ink = loopTester(everyNth(poly, LASSO_LOOP_MAX_PTS));
        // An enclosed frame is ONE entry of the selection. Its natives and its whole
        // subtree are inside the loop by invariant 2, tables included, so nothing under
        // it is read: O(1) per enclosed frame.
        const takeAll = (id) => { frames.push(id); };
        // `s`/`tx`/`ty` carry the frame's coordinates into the active frame's.
        // Used only for the two FRAME-level decisions, which are coarse; every
        // per-object rect still goes through `mapRectF` hop by hop.
        const visit = (id, s, tx, ty, skip) => {
            const own = { left: -REACH * s + tx, top: -REACH * s + ty,
                right: REACH * s + tx, bottom: REACH * s + ty };
            if (own.right < box.left || own.left > box.right
                || own.bottom < box.top || own.top > box.bottom) return;      // out of reach
            if (rectInsidePolygon(poly, own)) { takeAll(id); return; }        // enclosed
            for (const o of this.doc.queryRect(id, { left: (box.left - tx) / s, top: (box.top - ty) / s,
                right: (box.right - tx) / s, bottom: (box.bottom - ty) / s })) {
                if (o.erase) continue;
                const r = this._rectInActive(o, id);
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
        // The active frame and everything under it...
        visit(this.cam.frame, 1, 0, 0, null);
        // ...then out through each ancestor, skipping the branch already done.
        let child = this.lm.frame(this.cam.frame), s = 1, tx = 0, ty = 0;
        while (child && child.parent != null) {
            const c = child.centre;
            if (!c) break;
            s *= CROSS_RATIO; tx -= c.x * s; ty -= c.y * s;
            visit(child.parent, s, tx, ty, child.id);
            child = this.lm.frame(child.parent);
        }
        // A MOVED OBJECT OR A CEDED KID IS INDEXED AT ITS STORED BITS and drawn elsewhere
        // (F41/F55), so the frames' indexes above never see its picture — a loop around
        // moved ink selected nothing (F69, Kobin's report 21-23-56). Every object with a
        // table, judged where it is drawn.
        if (this.doc.hasOffsets()) {
            const have = new Set(found);
            const F = this.cam.frame;
            for (const id of this.doc.offsetIds()) {
                if (have.has(id)) continue;
                const rec = this.doc.getById(id);
                if (!rec || rec.obj.erase || this.lm.frameFactor(rec.level, F) == null) continue;
                if (frames.length && this._underFrames(rec.level, frames)) continue;   // its frame is already one entry
                const r = this._rectInActive(rec.obj, rec.level);
                if (!r) continue;
                if (rectInsidePolygon(poly, r)) { found.push(id); continue; }
                if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
                if (this._inkInsidePolygon(rec.obj, rec.level, ink)) found.push(id);
            }
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
                ok = this.doc.editGroup(rec.obj).every((m) => m.obj.erase || set.has(m.obj.id));
                whole.set(key, ok);
            }
            if (ok) out.push(id);
        }
        return { ids: out, frames };
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
        const toActive = (p) => this._objPointInActive(o, level, p);
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
        this.renderer.syncCameraOnly(); this.renderer.update();
        this._emit();
        return this.selection;
    }
    _toggleSelected(id) {
        const cur = this.selection ? [...this.selection.ids] : [];
        const i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1); else cur.push(id);
        return this._setSelection(cur);
    }
    // Close the loop and apply it.
    //   plain     replace the selection with everything the loop bounds
    //   ctrl      ADD everything it bounds — unless the loop was drawn purely
    //             inside the current selection, which REMOVES instead
    _applyLasso(L) {
        const poly = L.pts.map(([x, y]) => this.cam.screenToFrame(x, y));
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
    // edits apply at its home level and re-derive everywhere.
    select(sx, sy) {
        for (let guard = 0; guard < 8; guard++) {
            const id = this._hitTest(sx, sy);
            if (id == null) { this.deselect(); return null; }
            // Erase barrier: anything still pending over this object bakes
            // NOW — the flush may split it or delete it, so re-hit after.
            if (this._flushErasesFor(id)) { this._render(); continue; }
            const rec = this.doc.getById(id);
            if (!rec) { this.deselect(); return null; }
            this._setSelection([id]);
            return id;
        }
        this.deselect();
        return null;
    }
    deselect() {
        if (!this.selection) return;
        this.selection = null; this._dragSel = null;
        this.renderer.syncCameraOnly(); this.renderer.update();
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
        for (const o of this._lastList) {
            const rec = this.doc.getById(o.id);
            if (!rec || !keys.has(this.doc.editKey(rec.obj))) continue;
            const b = bboxOf(o, this.store.live);
            const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
            const rx = o.res ? o.res[0] : 0, ry = o.res ? o.res[1] : 0;   // drawn shifted by its residual (F41)
            left = Math.min(left, b.x0 - m + rx); top = Math.min(top, b.y0 - m + ry);
            right = Math.max(right, b.x1 + m + rx); bottom = Math.max(bottom, b.y1 + m + ry);
        }
        if (left !== Infinity) return { level: this.cam.frame, rect: { left, top, right, bottom } };
        // Not drawn (culled from the list): where its picture is, through its table (F68).
        const r = this._rectInActive(s.obj, s.level);
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
        for (const rec of this._selectionMembers()) {
            const id = rec.obj.id;
            let st = d.moves.get(id);
            if (!st) {
                st = { from: rec.level, to: rec.level, dx: 0, dy: 0, baseBelow: cloneBelow(rec.obj.below) };
                st.below = st.baseBelow;
                d.moves.set(id, st);
            }
            const key = st.from + "|" + JSON.stringify(st.baseBelow || null);
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
        for (const [frame, ids] of rehomes) this.doc.rehomeManyById(ids, frame);
        for (const [id, table] of offsets) this.doc.setOffsetsById(id, table);
        if (this.selection.frames.length) {
            if (!d.frameStart) this._dragFramesStart(d, camDepth);
            if (d.frameStart.size && this._dragFrames(d, camDepth, tx, ty)) moved = true;
        }
        d.moved = d.moved || moved;
        this._render();
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
        const targets = this.lm.moveSubtreeTargets(null, camDepth, tx, ty, d.frameStart);
        const apply = [];
        for (const t of targets) {
            const e = d.frames.get(t.id);
            if (t.why) { (d.skipped || (d.skipped = [])).push({ id: t.id, level: t.id, why: t.why }); continue; }
            const sx = (e.shiftBefore ? e.shiftBefore[0] : 0) + t.rest[0];
            const sy = (e.shiftBefore ? e.shiftBefore[1] : 0) + t.rest[1];
            e.shiftAfter = (sx || sy) ? [sx, sy] : null;
            if (e.settled && !sameShift(e.shiftAfter, [e.settled.dx, e.settled.dy])) { this.doc.unsettle(e.id, e.settled); e.settled = null; }
            apply.push(t);
        }
        const was = new Map(apply.map((t) => { const f = this.lm.frame(t.id); return [t.id, { parent: f.parent, i: f.cell.i, j: f.cell.j }]; }));
        const r = this.lm.readdressMany(apply, { empty: (id) => this.doc.count(id) === 0 });
        let moved = false;
        for (const t of apply) {
            const e = d.frames.get(t.id);
            const f = this.lm.frame(t.id);
            const to = { parent: f.parent, i: f.cell.i, j: f.cell.j };
            const w = was.get(t.id);
            const addrChanged = to.parent !== w.parent || to.i !== w.i || to.j !== w.j;
            const shiftChanged = !e.settled && !sameShift(f.shift, e.shiftAfter);
            if (addrChanged) this.doc.noteRefile(t.id, w, to);
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
            was.set(e.id, { parent: f.parent, i: f.cell.i, j: f.cell.j });
            back.push({ id: e.id, depth: e.depth, parent: e.from.parent, i: e.from.i, j: e.from.j });
        }
        this.lm.readdressMany(back, { empty: (id) => this.doc.count(id) === 0 });
        for (const t of back) { const f = this.lm.frame(t.id); this.doc.noteRefile(t.id, was.get(t.id), { parent: f.parent, i: f.cell.i, j: f.cell.j }); }
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
                seen.add(m.obj.id); out.push(m);
            }
        }
        // Selected frames are not expanded: the drag moves them as frames (`_dragFrames`) and
        // the delete sets them aside as containers; nothing reads their natives here.
        return out;
    }
    /**
     * Delete everything selected, families included, as ONE undoable action.
     *
     * This used to call `_eraseWhole` once per selected id, and each call
     * pushed its own undo op — so a lasso of three strokes and Delete needed
     * three Ctrl+Z to come back, one object at a time (measured 2026-09-05).
     * The user did one thing; the history records one thing.
     */
    deleteSelection() {
        const s = this.selection; if (!s) return false;
        const records = [];
        const seen = new Set();
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
        const frames = s.frames || [];
        const frameRecords = [];
        for (const f of frames) {
            if (this._underFrames(f, frames.filter((x) => x !== f))) continue;   // an ancestor of it is going anyway
            const recs = this.doc.removeFrameSubtree(f);
            if (recs) frameRecords.push(...recs);
        }
        if (!records.length && !frameRecords.length) return false;
        // One gesture, one op: objects only, frames only, or both as one `deleteMany`.
        if (!frameRecords.length) this.doc.pushUndo({ op: "eraseMany", records });
        else if (!records.length) this.doc.pushUndo({ op: "removeFrames", records: frameRecords });
        else this.doc.pushUndo({ op: "deleteMany", parts: [{ op: "eraseMany", records }, { op: "removeFrames", records: frameRecords }] });
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
            count: s.ids.length + s.frames.reduce((n, f) => n + this._subtreeCount(f), 0),
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
    _shapeHit(loops, p, slack) {
        if (insideShape(loops, p)) return true;
        if (!(slack > 0)) return false;
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            if (insideShape(loops, [p[0] + slack * Math.cos(a), p[1] + slack * Math.sin(a)])) return true;
        }
        return false;
    }
    /**
     * What is under this screen point, or null. Public because the cursor has
     * to answer the same question the click will: ctrl over a selected object
     * REMOVES it, ctrl anywhere else ADDS, and the sign shown has to match.
     */
    hitTestAt(sx, sy) { return this._hitTest(sx, sy); }
    // `slackPx`: how far past the ink a pick still counts, in screen pixels.
    // Six for every real pick; tests that ask "is this point INSIDE the ink"
    // (a hole a few pixels wide, seen from far above) pass 0.
    _hitTest(sx, sy, slackPx = 6) {
        const p0 = this.cam.screenToFrame(sx, sy);
        const list = this._lastList;
        const slack = slackPx / this.cam.inScale;
        for (let i = list.length - 1; i >= 0; i--) { // topmost first
            const o = list[i];
            // A piece drawn shifted by its residual (F41) is hit where it is drawn.
            const p = o.res ? [p0[0] - o.res[0], p0[1] - o.res[1]] : p0;
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
                hit = this._shapeHit(o.loops, p, slack);
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
                hit = windingOfPoint(o.polys, p) !== 0;
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
            // Pending eraser ink is invisible to picking — the click falls
            // through to whatever it covers (select() then flushes its bake).
            const nat = this.doc.getById(o.id);
            if (nat && nat.obj.erase) continue;
            return o.id;
        }
        return null;
    }
}

export const selection = Selection.prototype;
