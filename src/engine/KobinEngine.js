/**
 * KobinEngine — the public facade. Wires LevelMap + Document + Camera +
 * TileStore + Renderer into the same external API the old KobinEngineV0
 * exposed, so CanvasV2 and the test suite keep working. It holds NO geometry or
 * z-order logic of its own — it routes input to the right collaborator and
 * merges the render list (tile pieces + the active level's live natives) in
 * global id order.
 *
 * Compat surface (locked by KobinEngine.contract.test.js): pointer/zoom/pinch/
 * pan, tool + style setters, undo/redo/clear, snapshot/loadSnapshot, resize,
 * destroy, onStatus, perfLog — plus the quasi-privates CanvasV2 and the tests
 * read: nativesByLevel, crossings, levelObjects, tiles, _drawing, _drawStartT,
 * cancelStroke, _hasFat, _effectiveZoom, opacityGroups, outlineMode, camera
 * fields, _fatOnScreen/_outlinePad (the ported BUG-02/05 invariants).
 */
import LevelMap from "./LevelMap";
import Document from "./Document";
import Camera from "./Camera";
import TileStore from "./TileStore";
import Renderer from "./Renderer";
import { strokeOutline, clipRingsToRect, clipPolylineToRect, flattenCurve } from "./geometry/clipperOutline";
import { distToPolyline, windingOfPoint } from "./geometry/hittest";
import { cutPolylineWithDisc } from "./geometry/cut";
import { bboxOf, levelFactor } from "./geometry/derive";
import { encodeDrawing, decodeDrawing } from "./persist";
import { validateScaleDef } from "./scaleBar";
import {
    computeSceneProposals, matchScenes, splitMembers, resolveCapture, levelHash,
    JOIN_WINDOWS, WINDOW_WIDTHS,
} from "./scenes";

const DEFAULTS = {
    enter: 300, base: 0.1, exit: 0.05, bufferScreens: 1, scale: 1000, arcTolerancePx: 0.25,
    polygonizeWidthFrac: 1 / 3, // tile-bake stroke↔fill gate (screen-relative, as before)
    // Sub-pixel policy for minified (finer-level) content, measured at the
    // level's deepest in-level zoom (`enter`): below cullPx it can never be
    // seen; content in [fadeLoPx, cullPx) is baked and fades continuously with
    // zoom (BUG-04). fadeLoPx is ALSO the bake-inclusion/invalidation bound.
    cullPx: 0.3, fadeLoPx: 0.15,
    // Fat display gate + curve-outline constants: a stroke that could EVER paint
    // wider than fatWidthPx within its level (lwFrame × enter) renders as a
    // curve-capsule outline (geometry/curveOutline.js) — built once, exact at
    // every in-level zoom. The gate is FIDELITY-NEUTRAL: raw browser stroking
    // is exact and the outline tracks it to ≤ arcTolerancePx, so the value only
    // trades Skia mis-stroke safety (measured failure ~25k device px → 4000
    // keeps a ~6× margin) against outline-fitting work. At 4000 the default
    // 13 px pen (13 × enter = 3900) never needs an outline at its own level.
    // lineTolPx: a centerline curve whose deviation from its chord would paint
    // under this many device px at the level's DEEPEST zoom is "basically a
    // line" and is polygonized (exact line capsule).
    fatWidthPx: 4000, lineTolPx: 0.25,
    // lineModeLevel is GONE: curvature is per-origin now (natives spline; derived
    // pieces are pre-flattened polylines). Kept absent on purpose.
};

export default class KobinEngine {
    constructor(container, { width, height, onStatus } = {}) {
        this.cfg = { ...DEFAULTS };
        this.onStatus = onStatus || (() => {});
        this.width = width || window.innerWidth;
        this.height = height || window.innerHeight;

        this.lm = new LevelMap(this.cfg, this.width, this.height);
        this.doc = new Document();
        this.cam = new Camera(this.lm, this.cfg, {
            finalizeLiveStroke: () => { if (this._drawing) this.pointerUp(); },
            onCross: () => { /* re-render happens after the settle in the caller */ },
        });
        this.store = new TileStore(this.lm, this.doc, this.cfg);
        this.renderer = new Renderer(container, this.cam, this.cfg, { width: this.width, height: this.height });
        this.renderer.setTileDebug(false, () => this._debugTileRects());

        this.tool = "pen"; this.penType = "freehand"; this.color = "rgb(0,0,0)"; this.penWidth = 13; this.opacity = 1;
        this.opacityGroups = true; this.outlineMode = false; this.debug = false; this.kdebug = false; this.tileDebug = false;
        this.preBake = true;       // define + bake the next level's tiles EARLY (near a crossing, in idle)
        this.lazyOutlines = true;  // fat strokes stay raw until they approach the gate (fit in idle/on approach)
        this.retainScenes = true;  // keep each level's SVG subtree so a flip swaps it in instead of rebuilding
        this._idleFitScheduled = false;
        this._drawing = null; this._panLast = null; this._erasing = false; this._drawStartT = 0;
        this._lastList = []; this._lastRange = null;
        this.perfLog = [];
        this.geom = { strokeOutline, clipRingsToRect, clipPolylineToRect, flattenCurve };

        // selection / edit state (US-10)
        this.selection = null;        // { id, level, obj } — obj is the LIVE native
        this._dragSel = null;         // { last:[sx,sy], dx, dy, moved } during a select-drag
        this._activeRestyle = null;   // { id, op } — coalesces a slider/color gesture into one undo op
        this.docMeta = { name: null, createdAt: new Date().toISOString(), scaleDef: null, scenes: [], hiddenScenes: [], sceneSeq: 1 };
        this.renderer.setSelection(() => this._selectionRect());
        // The selected object can vanish under us (eraser, cut, undo, wipe, load).
        this.doc.subscribe((ev) => {
            if (!this.selection) return;
            if (ev.kind === "reset" || (ev.kind === "remove" && ev.id === this.selection.id)) {
                this.selection = null; this._activeRestyle = null; this._dragSel = null;
            }
        });

        this._render();
    }

    // ---- camera compat (fields live on Camera) ----
    get activeLevel() { return this.cam.activeLevel; } set activeLevel(v) { this.cam.activeLevel = v; }
    get inScale() { return this.cam.inScale; } set inScale(v) { this.cam.inScale = v; }
    get inPanX() { return this.cam.inPanX; } set inPanX(v) { this.cam.inPanX = v; }
    get inPanY() { return this.cam.inPanY; } set inPanY(v) { this.cam.inPanY = v; }
    // Document + level-map compat (same shapes as the old engine).
    get nativesByLevel() { return this.doc.nativesByLevel; }
    get crossings() { return this.lm.records; }
    get levelObjects() { return { [this.cam.activeLevel]: this._lastList }; }
    get tiles() {
        const out = {};
        for (const key of this.store._tileKeys()) { const L = +key.split("|")[0]; (out[L] = out[L] || { size: 0 }).size++; }
        return out;
    }
    get _hasFat() { return this.renderer._hasFat; }

    setTool(t) { this.tool = t; }
    setPenType(t) { this.penType = t; }
    setColor(c) { this.color = c; }
    setWidth(w) { this.penWidth = w; }
    setOpacity(o) { this.opacity = o; }
    setOutlineMode(b) { this.outlineMode = !!b; this.renderer.setOutlineMode(this.outlineMode); this._render(); }
    setOpacityGroups(b) {
        this.opacityGroups = !!b;
        this.renderer.setOpacityGroups(this.opacityGroups);
        this.store.setOpacityGroups(this.opacityGroups); // bumps bake epoch -> tiles rebake
        this.renderer.clear();                            // fill seam pad differs -> rebuild groups
        this._render();
    }
    setDebug(b) { this.debug = !!b; this.renderer.setDebug(this.debug); this._render(); }
    setPreBake(b) { this.preBake = !!b; }
    setRetainScenes(b) { this.retainScenes = !!b; this.renderer.setRetainScenes(this.retainScenes); this._render(); }
    setScaleDef(def) {
        this.docMeta.scaleDef = def ? validateScaleDef(def) : null;
    }

    setLazyOutlines(b) {
        this.lazyOutlines = !!b;
        this.renderer.setLazyOutlines(this.lazyOutlines);
        this._render(); // representation choice may change for pending strokes
        if (this.lazyOutlines) this._queueIdleFits();
    }
    setKDebug(b) { this.kdebug = !!b; }
    setTileDebug(b) { this.tileDebug = !!b; this.renderer.setTileDebug(this.tileDebug, () => this._debugTileRects()); this.renderer.update(); }

    resize(w, h) {
        if (w === this.width && h === this.height) return;
        const t0 = perfNow();
        this.width = w; this.height = h;
        this.lm.resize(w, h); this.renderer.setSize(w, h);
        this._render();
        this._perf("resize", t0, true, { w, h });
    }
    destroy() { this._destroyed = true; this.store.destroy(); this.renderer.destroy(); }

    // ---- perf log ----
    _perf(op, t0, always, extra) {
        const ms = perfNow() - t0;
        if (ms < 8 && !always) return;
        const e = { op, ms: +ms.toFixed(1), level: this.cam.activeLevel, inScale: +this.cam.inScale.toFixed(3), t: Date.now() };
        if (extra) Object.assign(e, extra);
        this.perfLog.push(e);
        if (this.perfLog.length > 300) this.perfLog.shift();
    }

    // ---- render pipeline ----
    // The full render list at the active level: tile pieces (up + down) + the
    // level's own live natives, merged in id order (global z-order).
    _buildList() {
        const win = this.cam.frameWindow(0);
        const derived = this.store.content(this.cam.activeLevel, win);
        const own = this.doc.at(this.cam.activeLevel);
        const list = derived.concat(own);
        // z defaults to id (creation order); cut pieces carry their source's z
        // so a stroke stays at its depth after a boolean erase splits it.
        list.sort((a, b) => ((a.z != null ? a.z : a.id) - (b.z != null ? b.z : b.id)) || (a.id - b.id));
        this._lastRange = this.lm.tileRange(this.cam.activeLevel, win);
        return list;
    }
    _render() {
        const t0 = perfNow();
        this._lastList = this._buildList();
        this.renderer.render(this._lastList, this.cam.activeLevel);
        this.renderer.update();
        this._emit();
        this._perf("render", t0, false, { n: this._lastList.length, fat: this.renderer._hasFat });
    }
    // True if the visible tile set changed since the last full render.
    _visibleChanged() {
        const r = this.lm.tileRange(this.cam.activeLevel, this.cam.frameWindow(0));
        const p = this._lastRange;
        return !p || r.i0 !== p.i0 || r.i1 !== p.i1 || r.j0 !== p.j0 || r.j1 !== p.j1;
    }

    // ---- pan / zoom ----
    panBy(dx, dy) {
        const t0 = perfNow();
        this.cam.panBy(dx, dy);
        if (this._visibleChanged() || this.renderer.needsRebake()) this._render();
        else { this.renderer.syncCameraOnly(); this.renderer.update(); this._emit(); }
        this._perf("pan", t0);
    }
    zoomAt(sx, sy, deltaY) { this.zoomFactorAt(sx, sy, Math.pow(2, -deltaY / 1000)); }
    pinchUpdate(mx, my, factor, dx, dy) { this.cam.panBy(dx, dy); this.zoomFactorAt(mx, my, factor); }
    zoomFactorAt(sx, sy, factor) {
        const t0 = perfNow();
        const crossed = this.cam.zoomFactorAt(sx, sy, factor);
        // needsFatFlip: lazy-pending fat strokes approaching the gate must flip
        // to their outline representation BEFORE raw stroking becomes unsafe.
        if (crossed || this._visibleChanged() || this.renderer.needsRebake() || this.renderer.needsFatFlip()) this._render();
        else { this.renderer.syncCameraOnly(); this.renderer.update(); this._emit(); }
        this._perf(crossed ? "cross" : "zoom", t0, crossed);
        this._maybePrebake();
        // prefit outlines when strokes approach the gate or a new level activates
        if (crossed || this.renderer.hasPendingNearFat()) this._queueIdleFits();
    }
    // Idle pre-bake: nearing an UPWARD crossing, warm the child tiles under the
    // view during idle time so the crossing lands on a hot cache. With preBake
    // enabled (dev toggle), a FIRST entry is prebakeable too: the child's
    // crossing record is defined EARLY — {s,t} pinning is "first defined,
    // forever", and any frame captured on the way up is as valid as the one at
    // the crossing moment; capturing it at 0.8×enter just moves the definition
    // a few frames earlier. Fire-and-forget; the bake is idempotent.
    _maybePrebake() {
        if (this._prebakeQueued) return;
        if (this.cam.inScale <= this.cfg.enter * 0.8) return;
        const child = this.cam.activeLevel + 1;
        if (!this.lm.get(child)) {
            if (!this.preBake) return;
            this.lm.ensureUp(child, this.cam.inScale, this.cam.inPanX, this.cam.inPanY);
        }
        this._prebakeQueued = true;
        const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 30);
        idle(() => {
            this._prebakeQueued = false;
            if (this._destroyed) return;
            if (this.cam.inScale <= this.cfg.enter * 0.8 || !this.lm.get(child)) return;
            const childWin = this.lm.mapRect(this.cam.frameWindow(0), this.cam.activeLevel, child);
            if (!childWin) return;
            const pins = this.store._pins;         // keep the VISIBLE tiles pinned —
            this.store.content(child, childWin);   // bakes + caches; render untouched
            this.store._pins = pins;               // prebaked tiles stay evictable
        });
    }

    // Idle outline pre-fitting (lazy mode): fat-gated strokes render raw until
    // needed; fit their curve outlines in idle slices (~8 ms) so the eventual
    // representation flip — and the next crossing's bake — never stalls a
    // gesture. Re-queues itself while work remains.
    _queueIdleFits() {
        if (!this.lazyOutlines || this._idleFitScheduled || this._destroyed) return;
        const gate = this.cfg.fatWidthPx != null ? this.cfg.fatWidthPx : 500;
        this._idleFitScheduled = true;
        const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 50);
        idle(() => {
            this._idleFitScheduled = false;
            if (this._destroyed) return;
            const t0 = perfNow();
            let more = false, fitted = 0;
            for (const o of this.doc.at(this.cam.activeLevel)) {
                if (o.type !== "stroke" || o._outline || o === this._drawing) continue;
                if (o.lwFrame * this.cfg.enter <= gate) continue;
                if (perfNow() - t0 > 8) { more = true; break; }
                this.renderer.ensureOutline(o, o.origin === "native");
                fitted++;
            }
            if (more) this._queueIdleFits();
            else if (fitted) this._render(); // flip the now-cached outlines in one pass
        });
    }

    // ---- pointer / drawing ----
    screenToFrame(sx, sy) { return this.cam.screenToFrame(sx, sy); }
    pointerDown(sx, sy) {
        if (this.tool === "pan") { this._panLast = [sx, sy]; return; }
        if (this.tool === "erase") { this._erasing = true; this.eraseAt(sx, sy); return; }
        if (this.tool === "erasePartial") { this._erasing = true; this.erasePartialAt(sx, sy); return; }
        if (this.tool === "select") {
            const id = this.select(sx, sy);
            this._dragSel = id != null ? { last: [sx, sy], dx: 0, dy: 0, moved: false } : null;
            return;
        }
        const p = this.cam.screenToFrame(sx, sy);
        const highlight = this.penType === "highlight";
        const straight = this.penType === "straight";
        const lw = (highlight ? this.penWidth * 2.5 : this.penWidth) / this.cam.inScale;
        const op = highlight ? Math.min(this.opacity, 0.45) : this.opacity;
        const o = { type: "stroke", origin: "native", id: this.doc.allocId(), pts: [p], lwFrame: lw, color: this.color, opacity: op, paths: [] };
        this.store.live = o; // exempt from bbox/flatten caches until it stops growing
        this.doc.add(o, this.cam.activeLevel, { live: true });
        this.renderer.addLive(o, straight);
        this.renderer.update();
        this._drawing = o; this._drawStartT = Date.now();
        this._emit();
    }
    pointerMove(sx, sy) {
        if (this.tool === "pan" && this._panLast) {
            const dx = sx - this._panLast[0], dy = sy - this._panLast[1];
            this._panLast = [sx, sy]; this.panBy(dx, dy); return;
        }
        if (this.tool === "erase") { if (this._erasing) this.eraseAt(sx, sy); return; }
        if (this.tool === "erasePartial") { if (this._erasing) this.erasePartialAt(sx, sy); return; }
        if (this.tool === "select") { if (this._dragSel && this.selection) this._dragSelection(sx, sy); return; }
        if (this._drawing) {
            const p = this.cam.screenToFrame(sx, sy);
            const o = this._drawing;
            if (this.penType === "straight" && o.pts.length >= 2) { o.pts[1] = p; this.renderer.setLiveEnd(p); }
            else { o.pts.push(p); this.renderer.extendLive(p); }
            this.renderer.update();
        }
    }
    pointerUp() {
        if (this._dragSel) {
            const d = this._dragSel; this._dragSel = null;
            // one undo op for the whole drag, in the object's home-frame units
            if (d.moved && this.selection) this.doc.pushUndo({ op: "move", id: this.selection.id, dx: d.dx, dy: d.dy });
        }
        if (this._drawing) {
            const o = this._drawing; this._drawing = null;
            this.renderer.endLive();
            this.store.live = null;               // stroke is final: bbox/flatten may cache now
            this.doc.finalize(o);                 // index + update finer tiles (off-screen)
            this.doc.pushUndo({ op: "add", id: o.id });
            this._noteInkAdded(o);                // provisional scene assignment
            this._render();
            this._queueIdleFits();                // prefit the outline off the pen-up frame
        }
        this._panLast = null; this._erasing = false;
    }
    cancelStroke() {
        const o = this._drawing; if (!o) return;
        this._drawing = null; this.renderer.endLive(); this.store.live = null;
        this.doc.removeById(o.id);
        this._render();
    }

    // ---- erasers ----
    // Whole-object eraser (tool "erase"): removes the topmost object the point hits.
    eraseAt(sx, sy) {
        const id = this._hitTest(sx, sy);
        if (id == null) return false;
        if (!this._eraseWhole(id)) return false;
        this._render();
        return true;
    }
    _eraseWhole(id) {
        const rec = this.doc.removeById(id);
        if (!rec) return false;
        this.doc.pushUndo({ op: "erase", obj: rec.obj, level: rec.level, index: rec.index });
        return true;
    }
    // Boolean/true eraser (tool "erasePartial"): a disc of _eraserRadiusPx()
    // device px that CUTS stroke geometry instead of removing objects. Unlike
    // the object eraser it takes EVERY stroke whose ink the disc touches (that
    // is how rubbing feels), not just the topmost point-hit.
    _eraserRadiusPx() { return Math.max(6, this.penWidth); }
    erasePartialAt(sx, sy) {
        const p = this.cam.screenToFrame(sx, sy);
        const Re = this._eraserRadiusPx() / this.cam.inScale; // active-frame units
        const ids = new Set();
        for (const o of this._lastList) {
            if (o.type === "fill") { if (windingOfPoint(o.polys, p) !== 0) ids.add(o.id); }
            else {
                const pts = (o.origin === "native" && o.pts.length > 2) ? flattenCurve(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter) : o.pts;
                if (distToPolyline(pts, p) <= o.lwFrame / 2 + Re) ids.add(o.id);
            }
        }
        let changed = false;
        for (const id of ids) if (this._cutNative(id, p, Re)) changed = true;
        if (changed) this._render();
        return changed;
    }
    // Cut one native with the eraser disc, in the native's own home frame.
    _cutNative(id, pActive, Re) {
        const rec = this.doc.getById(id);
        if (!rec) return false;
        const { obj: o, level: H } = rec;
        const L = this.cam.activeLevel;
        // no centerline to cut -> the object eraser's semantics
        if (o.type !== "stroke") return this._eraseWhole(id);
        const f = levelFactor(H, L, this.lm.records, this.cfg.base); // home -> active scale
        if (f == null || Math.abs(H - L) > 4) return false; // no record chain / magnify precision
        // An eraser that can't span the painted band would gouge a hole ~lw wide
        // from a single touch (the cut clears the FULL width over the cut span).
        // Skip those — a magnified coarse stroke is thousands of px wide, and
        // deleting it outright would be worse; the object eraser covers that.
        if (o.lwFrame * f * this.cam.inScale > 6 * this._eraserRadiusPx()) return false;
        const c = this.lm.mapPoint(pActive, L, H);
        if (!c) return false;
        // r = eraser radius + half the stroke width: every centerline point whose
        // painted disc the eraser touches is removed, and the surviving pieces'
        // round caps land exactly tangent to the eraser disc.
        const r = Re / f + o.lwFrame / 2;
        const runs = cutPolylineWithDisc(o.pts, c, r);
        if (runs == null) return false;                    // disc missed the centerline
        if (!runs.length) return this._eraseWhole(id);     // nothing survives
        const cut = this.doc.cutById(id, runs);
        if (!cut) return false;
        this.doc.pushUndo({ op: "cut", removed: cut.removed, pieces: cut.pieces.map((obj) => ({ obj, level: cut.removed.level })) });
        return true;
    }

    // ---- selection / edit (US-10) ----
    // Tap-select the topmost object under the point (same hit policy as the
    // object eraser). Selecting through a derived piece selects the NATIVE —
    // edits apply at its home level and re-derive everywhere.
    select(sx, sy) {
        const id = this._hitTest(sx, sy);
        if (id == null) { this.deselect(); return null; }
        const rec = this.doc.getById(id);
        if (!rec) { this.deselect(); return null; }
        if (!this.selection || this.selection.id !== id) this._activeRestyle = null;
        this.selection = { id, level: rec.level, obj: rec.obj };
        this.renderer.syncCameraOnly(); this.renderer.update();
        this._emit();
        return id;
    }
    deselect() {
        if (!this.selection) return;
        this.selection = null; this._activeRestyle = null; this._dragSel = null;
        this.renderer.syncCameraOnly(); this.renderer.update();
        this._emit();
    }
    // The overlay rect: lw-padded bbox in the object's home frame.
    _selectionRect() {
        const s = this.selection; if (!s) return null;
        const b = bboxOf(s.obj, this.store.live);
        const m = s.obj.type === "fill" ? 0 : (s.obj.lwFrame || 0) / 2;
        return { level: s.level, rect: { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m } };
    }
    // One drag step: screen delta -> active-frame delta -> home-frame delta
    // (transforms are scale+translate, so a delta only scales).
    _dragSelection(sx, sy) {
        const d = this._dragSel, s = this.selection;
        const ddx = (sx - d.last[0]) / this.cam.inScale;
        const ddy = (sy - d.last[1]) / this.cam.inScale;
        d.last = [sx, sy];
        if (!ddx && !ddy) return;
        const f = levelFactor(this.cam.activeLevel, s.level, this.lm.records, this.cfg.base);
        if (f == null) return;
        const hx = ddx * f, hy = ddy * f;
        this.doc.moveById(s.id, hx, hy); // change event invalidates old+new tiles
        d.dx += hx; d.dy += hy; d.moved = true;
        this._render();
    }
    // Restyle the selection. patch: { color?, opacity?, widthPx? } — widthPx is
    // the width ON SCREEN at the current view; it converts through the level
    // chain to the native's frame. A continuous gesture (slider/color drag)
    // coalesces into ONE undo op per selection session.
    restyleSelection(patch) {
        const s = this.selection; if (!s) return false;
        const p = { ...patch };
        if (p.widthPx != null) {
            const f = levelFactor(s.level, this.cam.activeLevel, this.lm.records, this.cfg.base);
            if (f != null && f > 0 && s.obj.type === "stroke") p.lwFrame = Math.max(1e-12, p.widthPx / (f * this.cam.inScale));
            delete p.widthPx;
        }
        const top = this.doc._undo[this.doc._undo.length - 1];
        const open = this._activeRestyle && this._activeRestyle.id === s.id && top === this._activeRestyle.op;
        const r = this.doc.restyleById(s.id, p);
        if (!r || !Object.keys(r.after).length) return false;
        if (open) {
            const op = this._activeRestyle.op;
            for (const k of Object.keys(r.after)) {
                if (!(k in op.before)) op.before[k] = r.before[k]; // undo returns to session start
                op.after[k] = r.after[k];
            }
        } else {
            const op = { op: "restyle", id: s.id, before: r.before, after: r.after };
            this.doc.pushUndo(op);
            this._activeRestyle = { id: s.id, op };
        }
        this._render();
        return true;
    }
    deleteSelection() {
        const s = this.selection; if (!s) return false;
        if (!this._eraseWhole(s.id)) return false; // doc event drops the selection
        this._render();
        return true;
    }
    _selectionStatus() {
        const s = this.selection; if (!s) return null;
        const f = levelFactor(s.level, this.cam.activeLevel, this.lm.records, this.cfg.base);
        return {
            id: s.id, type: s.obj.type, level: s.level,
            color: s.obj.color,
            opacity: s.obj.opacity == null ? 1 : s.obj.opacity,
            widthPx: s.obj.type === "stroke" && f != null ? s.obj.lwFrame * f * this.cam.inScale : null,
        };
    }
    _hitTest(sx, sy) {
        const p = this.cam.screenToFrame(sx, sy);
        const list = this._lastList;
        const slack = 6 / this.cam.inScale;
        for (let i = list.length - 1; i >= 0; i--) { // topmost first
            const o = list[i];
            if (o.type === "fill") { if (windingOfPoint(o.polys, p) !== 0) return o.id; }
            else {
                const pts = (o.origin === "native" && o.pts.length > 2) ? flattenCurve(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter) : o.pts;
                if (distToPolyline(pts, p) <= o.lwFrame / 2 + slack) return o.id;
            }
        }
        return null;
    }

    // ---- undo / redo / clear ----
    undo() { this._activeRestyle = null; if (!this.doc.undo()) return false; this._render(); return true; }
    redo() { this._activeRestyle = null; if (!this.doc.redo()) return false; this._render(); return true; }
    clear() {
        const capture = () => ({ crossings: this.lm.serialize(), camera: this.cam.state() });
        const restore = (ext) => { this.lm.load(ext.crossings); this.cam.set(ext.camera); };
        this.doc.clear(capture(), capture, restore); // reset event clears the tile cache
        this.lm.records = {}; this.lm._derivedGrids = null;
        this.cam.set({ activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 });
        this.renderer.clear();
        this._render();
    }

    // ---- snapshot (dev-0, kept verbatim for tests/tools) ----
    snapshot() {
        return { v: "dev-0", camera: this.cam.state(), natives: this.doc.serializeNatives(), crossings: this.lm.serialize() };
    }
    loadSnapshot(snap) {
        if (!snap || !snap.natives) return false;
        this.lm.load(snap.crossings || {});
        this.doc.loadNatives(snap.natives); // reset event clears the tile cache
        this.cam.set(snap.camera || { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 });
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }

    // ---- drawing files (the real save format — persist.js, kobin-1) ----
    // serializeDrawing() -> a validated, versioned JSON document; meta.name /
    // createdAt persist on the engine across saves. loadDrawing() accepts a
    // kobin-1 file OR a legacy dev-0 snapshot and THROWS a readable Error on
    // anything malformed (callers surface it; nothing is half-loaded because
    // decode fully validates before any state is touched).
    serializeDrawing(meta = {}) {
        const doc = encodeDrawing({
            camera: this.cam.state(), crossings: this.lm.serialize(),
            natives: this.doc.serializeNatives(),
            meta: { ...this.docMeta, ...meta },
        });
        this.docMeta = {
            name: doc.meta.name,
            createdAt: doc.meta.createdAt,
            scaleDef: doc.meta.scaleDef ?? null,
            scenes: doc.meta.scenes ?? [],
            hiddenScenes: doc.meta.hiddenScenes ?? [],
            sceneSeq: doc.meta.sceneSeq ?? 1,
        };
        return doc;
    }
    loadDrawing(raw) {
        const d = decodeDrawing(raw); // throws before any engine state changes
        this.lm.load(d.crossings);
        this.doc.loadNatives(d.natives); // reset event clears tiles + selection
        this.cam.set(d.camera);
        this.docMeta = {
            name: d.meta.name,
            createdAt: d.meta.createdAt,
            scaleDef: d.meta.scaleDef ?? null,
            scenes: d.meta.scenes ?? [],
            hiddenScenes: d.meta.hiddenScenes ?? [],
            sceneSeq: d.meta.sceneSeq ?? 1,
        };
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }

    // ---- scenes (auto-scenes v2: docs/auto-scenes-design-bible.md) ----
    _sceneProj() {
        return {
            mapRect: (rect, from, to) => this.lm.mapRect(rect, from, to),
            widthFactor: (from, to) => levelFactor(from, to, this.lm.records, this.cfg.base),
        };
    }
    // Frame a rect (in `level`'s frame coords) in the viewport. The computed
    // inScale may land outside [exit, enter]; _maybeCross normalizes it through
    // the ordinary crossing machinery, creating level records as needed.
    jumpTo(level, rect) {
        if (!rect || !(rect.w > 0) || !(rect.h > 0)) return false;
        // A level is reachable when a record chain connects it to level 0.
        // Its OWN record may not exist — negative levels are defined by the
        // records of the levels above them (lm.get(-2) is legitimately empty).
        if (level !== 0 && levelFactor(level, 0, this.lm.records, this.cfg.base) == null) return false;
        if (this._drawing) this.pointerUp();
        const s = Math.min(this.width / rect.w, this.height / rect.h);
        if (!(s > 0) || !Number.isFinite(s)) return false;
        this.cam.set({
            activeLevel: level, inScale: s,
            inPanX: (this.width - rect.w * s) / 2 - rect.x * s,
            inPanY: (this.height - rect.h * s) / 2 - rect.y * s,
        });
        this.cam._maybeCross();
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }
    // The real recompute — gated on per-level ink hashes, so it's free when
    // nothing changed since the last resolve (bible: evaluation schedule).
    refreshScenes() {
        const hashes = {};
        let changed = false;
        for (const Ls of Object.keys(this.doc.nativesByLevel)) {
            const L = +Ls;
            if (!(this.doc.nativesByLevel[L] || []).length) continue;
            hashes[L] = levelHash(this.doc.nativesByLevel, L);
            if (!this._levelHashes || this._levelHashes[L] !== hashes[L]) changed = true;
        }
        if (this._levelHashes) {
            for (const L of Object.keys(this._levelHashes)) if (!(L in hashes)) changed = true;
        }
        if (!changed && this._sceneMembers && !this._scenesProvisional) {
            return this.docMeta.scenes || [];
        }
        const proj = this._sceneProj();
        const proposals = computeSceneProposals(this.doc.nativesByLevel, proj);
        // Provisional scenes participate in matching so their ids/numbers
        // survive the resolve; unmatched (unpinned) ones drop naturally.
        const state = {
            scenes: this.docMeta.scenes || [],
            hidden: this.docMeta.hiddenScenes || [],
            seq: this.docMeta.sceneSeq || 1,
        };
        const merged = matchScenes(state, proposals, proj);
        for (const s of merged.scenes) delete s.provisional;
        this.docMeta = { ...this.docMeta, scenes: merged.scenes, hiddenScenes: merged.hidden, sceneSeq: merged.seq };
        this._sceneMembers = merged.members;
        this._levelHashes = hashes;
        this._scenesProvisional = false;
        return merged.scenes;
    }
    // Pen-up freshness: assign the new stroke to an existing scene at its
    // level or open a provisional one. No clustering runs here; the next
    // refreshScenes() (Scenes panel / Save) resolves everything properly.
    _noteInkAdded(o) {
        this._scenesProvisional = true;
        const L = this.cam.activeLevel;
        const b = bboxOf(o);
        const w = o.lwFrame || 1e-9;
        const rect = { x: b.x0, y: b.y0, w: Math.max(b.x1 - b.x0, w), h: Math.max(b.y1 - b.y0, w) };
        const T = JOIN_WINDOWS * WINDOW_WIDTHS * w;
        for (const s of this.docMeta.scenes || []) {
            if (s.level !== L || s.captured) continue;
            const gx = Math.max(0, Math.max(s.rect.x - (rect.x + rect.w), rect.x - (s.rect.x + s.rect.w)));
            const gy = Math.max(0, Math.max(s.rect.y - (rect.y + rect.h), rect.y - (s.rect.y + s.rect.h)));
            if (gx <= T && gy <= T) {
                s.rect = {
                    x: Math.min(s.rect.x, rect.x), y: Math.min(s.rect.y, rect.y),
                    w: Math.max(s.rect.x + s.rect.w, rect.x + rect.w) - Math.min(s.rect.x, rect.x),
                    h: Math.max(s.rect.y + s.rect.h, rect.y + rect.h) - Math.min(s.rect.y, rect.y),
                };
                s.hash = ""; // thumbnail refresh at next resolve
                return;
            }
        }
        let seq = this.docMeta.sceneSeq || 1;
        const pad = 0.1 * Math.max(rect.w, rect.h);
        const s = {
            id: `s${seq}`, name: `Scene ${seq}`, level: L,
            rect: { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad },
            pinned: false, auto: true, provisional: true, depth: 0,
        };
        seq += 1;
        this.docMeta = { ...this.docMeta, scenes: [...(this.docMeta.scenes || []), s], sceneSeq: seq };
    }
    renameScene(id, name) {
        const s = (this.docMeta.scenes || []).find((x) => x.id === id);
        if (!s || !name || !name.trim()) return false;
        s.name = name.trim().slice(0, 120);
        s.pinned = true; // a named scene never auto-drops
        delete s.provisional;
        return true;
    }
    // Deleting also suppresses the frame so the same cluster can't resurrect.
    deleteScene(id) {
        const scenes = this.docMeta.scenes || [];
        const s = scenes.find((x) => x.id === id);
        if (!s) return false;
        this.docMeta.scenes = scenes.filter((x) => x.id !== id);
        this.docMeta.hiddenScenes = [...(this.docMeta.hiddenScenes || []), { level: s.level, rect: s.rect }];
        return true;
    }
    // Split: half-gap re-cluster of the scene's members. Children are pinned
    // (they survive the next full-gap recompute) and the parent frame is
    // suppressed (it can't come back as a fresh scene).
    splitScene(id) {
        const scenes = this.docMeta.scenes || [];
        const s = scenes.find((x) => x.id === id);
        if (!s) return null;
        const ids = this._sceneMembers && this._sceneMembers[id];
        const memberObjs = ids && ids.length
            ? ids.map((i) => this.doc.getById(i)).filter(Boolean).map((r) => ({ o: r.obj, level: r.level }))
            : this.doc.queryRect(s.level, { left: s.rect.x, top: s.rect.y, right: s.rect.x + s.rect.w, bottom: s.rect.y + s.rect.h })
                .map((o) => ({ o, level: s.level }));
        const parts = splitMembers(memberObjs, s.level, this._sceneProj());
        if (!parts || parts.length < 2) return null;
        let seq = this.docMeta.sceneSeq || 1;
        const children = parts.map((p) => ({
            id: `s${seq}`, name: `Scene ${seq++}`,
            level: p.level, rect: p.rect, hash: p.hash,
            pinned: true, auto: true, depth: s.depth || 0,
        }));
        const idx = scenes.findIndex((x) => x.id === id);
        const next = scenes.slice();
        next.splice(idx, 1, ...children);
        this.docMeta = {
            ...this.docMeta,
            scenes: next,
            hiddenScenes: [...(this.docMeta.hiddenScenes || []), { level: s.level, rect: s.rect }],
            sceneSeq: seq,
        };
        if (this._sceneMembers) {
            delete this._sceneMembers[id];
            parts.forEach((p, i) => { this._sceneMembers[children[i].id] = p.memberIds; });
        }
        return children;
    }
    // The effective zoom a scene's frame is viewed at (for "at 240×" labels).
    sceneZoom(s) {
        const inScale = Math.min(this.width / s.rect.w, this.height / s.rect.h);
        return this.lm.effectiveZoom(s.level, inScale);
    }
    // Capture this view (bible §4): retarget the matching scene or create a
    // new pinned one. Captured frames are never auto-reframed by recomputes.
    captureView(name) {
        const win = this.cam.frameWindow(0);
        const view = {
            level: this.cam.activeLevel,
            rect: { x: win.left, y: win.top, w: win.right - win.left, h: win.bottom - win.top },
        };
        const target = resolveCapture(view, this.docMeta.scenes || [], this._sceneProj());
        if (target) {
            target.level = view.level;
            target.rect = view.rect;
            target.pinned = true;
            target.captured = true;
            target.hash = `cap${Date.now().toString(36)}`;
            delete target.provisional;
            if (name && name.trim()) target.name = name.trim().slice(0, 120);
            this.docMeta = { ...this.docMeta };
            return { scene: target, retargeted: true };
        }
        let seq = this.docMeta.sceneSeq || 1;
        const s = {
            id: `s${seq}`, name: (name && name.trim()) || `Scene ${seq}`,
            level: view.level, rect: view.rect,
            pinned: true, auto: false, captured: true, depth: 0,
            hash: `cap${Date.now().toString(36)}`,
        };
        seq += 1;
        this.docMeta = { ...this.docMeta, scenes: [...(this.docMeta.scenes || []), s], sceneSeq: seq };
        return { scene: s, retargeted: false };
    }

    // ---- status + ported BUG invariants ----
    _emit() {
        this.onStatus({
            level: this.cam.activeLevel, inScale: this.cam.inScale, effectiveZoom: this.cam.effectiveZoom(),
            nearCross: this.cam.inScale > this.cfg.enter * 0.8, objects: this._lastList.length,
            outline: this.outlineMode,
            lines: false, // per-origin curvature now; no global "line mode" level
            selection: this._selectionStatus(),
        });
    }
    _effectiveZoom() { return this.cam.effectiveZoom(); }
    _levelPointToScreen(level, x, y) { return this.cam.levelPointToScreen(level, x, y); }
    _objs() { return this._lastList; }
    // The fat-display invariants the ported BUG-02/05 tests assert.
    _fatOnScreen(o) { return this.renderer._fatOnScreen(o); }
    _outlinePad() { return this.renderer.outlinePad(this._lastList); }
    _frameWindow(margin) { return this.cam.frameWindow(margin); }

    _debugTileRects() {
        const out = [];
        for (const key of this.store._tileKeys()) {
            const [Ls, , ij] = key.split("|");
            const [i, j] = ij.split(",").map(Number);
            out.push({ level: +Ls, i, j, rect: this.lm.tileRect(+Ls, i, j) });
        }
        return out;
    }
}

function perfNow() { return (typeof performance !== "undefined" ? performance.now() : Date.now()); }
