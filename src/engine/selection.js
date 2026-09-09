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
import Document from "./Document";
import { bboxOf } from "./geometry/derive";
import { distToPolyline, windingOfPoint } from "./geometry/hittest";
import { flattenCurve } from "./geometry/polyline";
import { insideShape } from "./geometry/arcShape";
import { rectInsidePolygon, loopTester } from "./geometry/lasso";
import { addOffset, sameBelow, snapDisplacement, hasOffsets } from "./geometry/offsets";

const REACH = (3 * FRAME_W) / 2;

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
        if (P.hit == null || P.ctrl || !this.selection) { startLasso(); return; }
        // Pressing an object that is ALREADY selected keeps the whole selection
        // and drags it; pressing a different one selects it alone.
        if (!this._isSelected(P.hit)) this.select(P.sx, P.sy);
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
        this._dragSel = { start: [P.sx, P.sy], moves: new Map(), moved: false };
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
            // Back to the frame and the geometry the drag started from. `base`
            // is a detached snapshot the drag only ever read, so it is intact.
            for (const [id, st] of d.moves) {
                if (!this.doc.getById(id)) continue;
                if (st.to !== st.from) this.doc.rehomeById(id, st.from);
                this.doc.setGeometryById(id, st.base);
            }
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
        const key = this.doc.editKey(this.doc.getById(id) ? this.doc.getById(id).obj : null);
        return this.selection.ids.includes(id) || (key != null && this.selection.ids.some((x) => {
            const r = this.doc.getById(x);
            return r && this.doc.editKey(r.obj) === key;
        }));
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
        const ink = loopTester(everyNth(poly, LASSO_LOOP_MAX_PTS));
        // An object with a displacement table is judged where its picture is, below (F69).
        const takeAll = (id) => {
            for (const o of this.doc.at(id)) if (!o.erase && !hasOffsets(o.below)) found.push(o.id);
            for (const c of this.lm.childrenOf(id)) takeAll(c.id);
        };
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
            const key = this.doc.editKey(rec.obj);
            let ok = whole.get(key);
            if (ok === undefined) {
                ok = this.doc.editGroup(rec.obj).every((m) => m.obj.erase || set.has(m.obj.id));
                whole.set(key, ok);
            }
            if (ok) out.push(id);
        }
        return out;
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
    _setSelection(ids) {
        const live = ids.filter((id) => this.doc.getById(id));
        if (!live.length) { this.deselect(); return null; }
        const rec = this.doc.getById(live[0]);
        this.selection = {
            ids: live, id: rec.obj.id, editId: this.doc.editKey(rec.obj),
            level: rec.level, obj: rec.obj,
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
        const found = this._lassoFind(poly);
        if (!L.ctrl) { if (found.length) this._setSelection(found); else this.deselect(); return; }
        const cur = this.selection ? [...this.selection.ids] : [];
        if (!found.length) return;
        // A ctrl loop that catches nothing new is a loop drawn PURELY INSIDE the
        // current selection, and that gesture subtracts. Catch anything new and
        // it is an overlapping loop, which adds. One rule, and it reads the same
        // way round as a group-level toggle.
        if (found.every((id) => cur.includes(id))) {
            this._setSelection(cur.filter((id) => !found.includes(id)));
            return;
        }
        for (const id of found) if (!cur.includes(id)) cur.push(id);
        this._setSelection(cur);
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
    // The overlay is the VISIBLE union of a logical edit family in the active
    // frame. This stays tight around a re-homed patch instead of exposing the
    // astronomical bbox of its coarse source, while a drag still moves every
    // boundary-attached member as one object.
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
     * One drag step — and the reason a drag at depth is now safe.
     *
     * WHAT IT USED TO DO. Translate every member's geometry by
     * `displacement x frameFactor`, which for a member k levels below the camera
     * is `displacement x R^k`. At k = 5 a 30 px drag rewrote that member's
     * coordinates to 7.3e18 and destroyed 82.9% of its area, while the pieces
     * stayed perfectly registered with each other — so the object did not move
     * wrong, it came apart (F-C, and F25/F28 in OPEN-FLAGS).
     *
     * WHAT IT DOES NOW. The displacement is expanded into lattice DIGITS, and
     * everything a whole cell or larger is applied to the member's ADDRESS: it
     * is re-homed into the cell that many steps along, its geometry untouched,
     * because neighbouring cells' origins differ by exactly one frame and the
     * same local coordinates therefore describe the moved object exactly. Only
     * the sub-cell remainder — smaller than one frame, whatever the depth —
     * reaches geometry. A member COARSER than the camera still translates
     * directly, which is safe in the other direction: the displacement in its
     * units is `displacement / R^k`, and shrinking cannot explode.
     *
     * Every member expands the SAME displacement, so members that share an
     * ancestor take bit-identical digits there and their relative positions
     * cannot move. That is registration by construction rather than by luck.
     *
     * The whole step is also recomputed from where the drag STARTED, not from
     * the previous event, so a slow drag and a fast one apply the same
     * arithmetic to the same numbers and land in the same place (M-4). The old
     * residue bookkeeping that bought this — `erase-tile-window-design-bible.md`
     * section 5.4 — is deleted; exactness makes it unnecessary.
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
        for (const rec of this._selectionMembers()) {
            const id = rec.obj.id;
            let st = d.moves.get(id);
            if (!st) {
                st = { from: rec.level, to: rec.level, dx: 0, dy: 0, base: Document.snapGeometry(rec.obj) };
                st.below = st.base.below;
                d.moves.set(id, st);
            }
            const depth = this.lm.depthOf(st.from);
            if (depth == null) { skip(id, st.from, "home frame has no depth"); continue; }

            // NOTHING A MOVE DOES REACHES A STORED COORDINATE (F55). Every
            // member takes the same displacement into its own table, at the
            // camera's depth below its home: whole frames carry upward as
            // integers, a carry out of the home level is a change of ADDRESS
            // (the member re-homed to the neighbour cell, coordinates
            // untouched), and the sub-frame remainders are applied at paint.
            // Before this, the displacement was added into the coordinates at
            // the home level, or into the hop at the move level (F41), and that
            // one rounding — half an ulp, invisible there — was magnified 4096x
            // per level below, parting a coarse object from detail drawn three
            // or more levels down (Kobin's star in the corner; F35). A member
            // DEEPER than the camera is re-addressed by the displacement's cell
            // digits and takes the rest, under one frame, into its own table at
            // its home level — zero when it is three or more levels down, since
            // the snap leaves nothing for the digits not to express.
            let frame = st.from, table, cellX, cellY;
            if (depth <= camDepth) {
                const r = addOffset(st.base.below, camDepth - depth, tx, ty);
                table = r.below; cellX = r.cellX; cellY = r.cellY;
            } else {
                const put = this.lm.displaceFrame(st.from, camDepth, tx, ty);
                if (!put) { skip(id, st.from, "displaceFrame refused: no frame at the camera's depth on this member's ancestry"); continue; }
                frame = put.frame.id;
                const r = addOffset(st.base.below, 0, put.rest[0], put.rest[1]);
                table = r.below; cellX = r.cellX; cellY = r.cellY;
            }
            if (cellX || cellY) {
                const n = this.lm.neighbour(frame, cellX, cellY);
                if (!n) { skip(id, st.from, "no neighbour cell for the carry"); continue; }
                frame = n.id;
            }
            // From the drag's START, never from the last event: that is what
            // makes a slow drag land exactly where a fast one does.
            if (frame !== st.to) { this.doc.rehomeById(id, frame); st.to = frame; moved = true; }
            if (!sameBelow(table, st.below)) {
                this.doc.setOffsetsById(id, table);
                st.below = table;
                moved = true;
            }
            st.dx = tx; st.dy = ty;              // for the journal: the snapped displacement, camera units
        }
        d.moved = d.moved || moved;
        this._render();
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
        const rec = this.doc.getById(id);
        if (!rec) return null;
        const b = bboxOf(rec.obj, this.store.live);
        if (!b) return null;
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        const di = Math.round(cx / FRAME_W), dj = Math.round(cy / FRAME_W);
        if (!di && !dj) return null;
        const to = this.lm.neighbour(rec.level, di, dj);
        if (!to || to.id === rec.level) return null;
        this.doc.rehomeById(id, to.id);
        this.doc.moveById(id, -di * FRAME_W, -dj * FRAME_W);
        return { level: to.id, dx: -di * FRAME_W, dy: -dj * FRAME_W };
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
        for (const id of [...s.ids]) {
            for (const m of this.doc.editGroup(id)) {
                if (seen.has(m.obj.id)) continue;
                seen.add(m.obj.id);
                const rec = this.doc.removeById(m.obj.id);
                if (rec) records.push(rec);
            }
        }
        if (!records.length) return false;
        this.doc.pushUndo({ op: "eraseMany", records });
        this.deselect();
        this._render();
        return true;
    }
    // Style is deliberately NOT reported: colour, width and opacity editing of a
    // selection were removed along with the selection style box, so nothing
    // downstream should be able to reach for them.
    _selectionStatus() {
        const s = this.selection; if (!s) return null;
        return { id: s.id, ids: [...s.ids], count: s.ids.length, type: s.obj.type, level: s.level };
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
