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
import { rectInsidePolygon } from "./geometry/lasso";

const REACH = (3 * FRAME_W) / 2;

class Selection {

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
        return this.lm.mapRectF(
            { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m }, level, this.cam.frame);
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
        const takeAll = (id) => {
            for (const o of this.doc.at(id)) if (!o.erase) found.push(o.id);
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
                if (r && rectInsidePolygon(poly, r)) found.push(o.id);
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
        return found;
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
            left = Math.min(left, b.x0 - m); top = Math.min(top, b.y0 - m);
            right = Math.max(right, b.x1 + m); bottom = Math.max(bottom, b.y1 + m);
        }
        if (left !== Infinity) return { level: this.cam.frame, rect: { left, top, right, bottom } };
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
        const tx = (sx - d.start[0]) / this.cam.inScale;
        const ty = (sy - d.start[1]) / this.cam.inScale;
        const camDepth = this.cam.activeLevel;
        let moved = false;
        for (const rec of this._selectionMembers()) {
            const id = rec.obj.id;
            let st = d.moves.get(id);
            if (!st) {
                st = { from: rec.level, to: rec.level, dx: 0, dy: 0, base: Document.snapGeometry(rec.obj) };
                d.moves.set(id, st);
            }
            const depth = this.lm.depthOf(st.from);
            if (depth == null) continue;

            let frame = st.from, wantX, wantY;
            if (depth <= camDepth) {
                // Coarser than (or level with) the camera: the displacement in
                // this object's units is bounded by the drag itself — it shrinks
                // by R per level of separation — so plain translation is exact
                // and re-homing waits for pen-up (_normalizeHome).
                const f = this.lm.frameFactor(this.cam.frame, st.from);
                if (f == null) continue;
                wantX = tx * f; wantY = ty * f;
            } else {
                // Deeper than the camera: address arithmetic. Everything a whole
                // cell or more becomes a change of frame; only the remainder,
                // which is under one frame at any depth, reaches geometry.
                const put = this.lm.displaceFrame(st.from, camDepth, tx, ty);
                if (!put) continue;
                frame = put.frame.id;
                wantX = put.rest[0]; wantY = put.rest[1];
            }

            if (frame !== st.to) { this.doc.rehomeById(id, frame); st.to = frame; moved = true; }
            if (wantX !== st.dx || wantY !== st.dy) {
                // From the drag's START, never from the last event: that is what
                // makes a slow drag land exactly where a fast one does.
                this.doc.setGeometryById(id, Document.translateGeometry(st.base, wantX, wantY));
                st.dx = wantX; st.dy = wantY;
                moved = true;
            }
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
    deleteSelection() {
        const s = this.selection; if (!s) return false;
        const ids = [...s.ids];
        let any = false;
        for (const id of ids) { if (this.doc.getById(id) && this._eraseWhole(id)) any = true; }
        if (!any) return false;
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
    _hitTest(sx, sy) {
        const p = this.cam.screenToFrame(sx, sy);
        const list = this._lastList;
        const slack = 6 / this.cam.inScale;
        for (let i = list.length - 1; i >= 0; i--) { // topmost first
            const o = list[i];
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
            else if (o.type === "fill") hit = windingOfPoint(o.polys, p) !== 0;
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
