/**
 * KobinEngineV0 — RETIRED from the app (replaced by KobinEngine.js, the
 * symmetric-tile engine). Kept ONLY as the golden-test oracle: derive.test.js /
 * LevelMap.test.js diff the extracted geometry against this implementation, and
 * fidelity/perf harnesses used it to validate the replacement. Do not import
 * from app code. Delete once the golden comparisons are captured as fixtures.
 *
 * ---- original header ----
 *
 * DESIGN (per review):
 *   - Level 0 holds the ORIGINAL objects (user strokes). They are never mutated.
 *   - When in-level zoom crosses 300x, the active level goes "stale": a window
 *     (bufferScreens beyond the screen) is taken, every object in it is RECREATED
 *     as a kobinized copy that exactly matches the larger view, and those copies
 *     become the source for the deeper level. inScale resets to base.
 *   - Zooming back out DISCARDS the deeper level's kobinized copies and restores
 *     the untouched originals -> zoom-out is drift-free by construction.
 *
 * EXACT-MATCH: a stroke is rendered with curved=false (straight segments through
 * the dense sample points) and its kobinized outline (Clipper offset, round
 * caps/joins) is computed from the SAME polyline -> the swap is seamless.
 *
 * Document ops: strokes (freehand/highlight/straight pen) are natives of the
 * level they were drawn at; the eraser removes a native everywhere via its id
 * (inherited/projected copies carry the source id); undo/redo swap inverse ops
 * between two stacks; snapshot()/loadSnapshot() round-trip the whole document +
 * camera as plain JSON (dev persistence -- NOT the durable save format).
 */

import Two from "two.js";
import { strokeOutline, strokeStripNear, clipRingsToRect, clipPolylineToRect, flattenCurve, flattenCurveNear, decimatePolyline } from "./geometry/clipperOutline";

const DEFAULTS = {
    enter: 300, base: 0.1, exit: 0.05, bufferScreens: 1, scale: 1000, arcTolerancePx: 0.25,
    // At a crossing, a stroke whose ON-SCREEN width exceeds this fraction of the page
    // width is "large": its centerline runs far off-window and is brittle to carry as a
    // stroke, so it is reduced to a filled OUTLINE clipped to the window. Smaller strokes
    // (detail drawn around the 250-300x range) are just clipped and kept as strokes.
    polygonizeWidthFrac: 1 / 3,
    // At/after this level, render strokes as straight polylines instead of curved
    // splines: at such tight zoom the curvature is sub-pixel and only a point or
    // two of the centerline survives the window clip, so a spline is meaningless
    // (and fragile). Tunable. (Caps/joins are still round, browser-rendered.)
    lineModeLevel: 2,
};
let _id = 1;

export default class KobinEngineV0 {
    constructor(container, { width, height, onStatus } = {}) {
        this.cfg = { ...DEFAULTS };
        this.onStatus = onStatus || (() => {});
        this.width = width || window.innerWidth;
        this.height = height || window.innerHeight;

        this.two = new Two({ width: this.width, height: this.height, autostart: true });
        this.two.appendTo(container);
        this.debugGroup = this.two.makeGroup(); // K-debug: parent originals (drawn UNDER)
        this.world = this.two.makeGroup();      // current level (drawn ON TOP)
        this.tileDebugGroup = this.two.makeGroup(); // tile-edge squares (screen space, topmost)

        this.inScale = 1; this.inPanX = 0; this.inPanY = 0;
        this.activeLevel = 0;
        // Persistent objects drawn AT each level ("natives"). Level 0 natives are
        // the user's originals. These survive zoom-out (not discarded) so a drawing
        // made on a kobinized level reappears when you return to that level.
        this.nativesByLevel = { 0: [] };
        // The live render list per level = inherited kobinized copies + that level's
        // natives. Inherited parts are rebuilt each zoom-in; natives are reused.
        this.levelObjects = [this.nativesByLevel[0]];
        this.crossings = {};        // level -> { s, t } for continuity / restore
        // Tile grid per level: level -> Map("i,j" -> { i, j, objs }). Each level's
        // inherited geometry is baked per fixed-grid tile, on demand, from the parent.
        // Tiles let you pan along a deep line (new tiles fault in) and re-enter a level
        // anywhere (tiles bake at the new spot). Tile coords stay bounded per level, so
        // wide panning is precision-safe; only crossings rebase (x~3000).
        this.tiles = {};

        this.tool = "pen"; this.penType = "freehand"; this.color = "rgb(0,0,0)"; this.penWidth = 13; this.opacity = 1;
        this.outlineMode = false; this.debug = false; this.kdebug = false; this.tileDebug = false;
        this.opacityGroups = true; this._objGroups = new Map();
        this._drawing = null; this._panLast = null;
        this._erasing = false; this._drawStartT = 0;
        this._undoStack = []; this._redoStack = [];
        // Perf ring buffer: ops slower than 8ms (plus every crossing/bake) with
        // camera context. Shipped in debug reports so a laggy device can tell
        // the dev box WHICH operation was slow, not just "it lagged".
        this.perfLog = [];
        // Projected-native display copies, keyed "id:H>L". Records and native
        // geometry are immutable, so a projection never changes — and reusing
        // the object keeps its flatten caches across render-list rebuilds
        // (fresh copies re-paid a full display flatten on EVERY rebuild).
        this._projCache = new Map();
        this._lastVisKeys = null; this._lastOutlineBakeScale = 0; this._bakedWindow = null;
        // Geometry helpers, reachable from window.__kobinEngine for scripted testing.
        this.geom = { strokeOutline, clipRingsToRect, clipPolylineToRect, flattenCurve };

        this._syncWorld(); this._emit();
    }

    setTool(t) { this.tool = t; }
    setPenType(t) { this.penType = t; } // freehand | highlight | straight
    _perf(op, t0, always, extra) {
        const ms = performance.now() - t0;
        if (ms < 8 && !always) return;
        const e = { op, ms: +ms.toFixed(1), level: this.activeLevel, inScale: +this.inScale.toFixed(3), t: Date.now() };
        if (extra) Object.assign(e, extra);
        this.perfLog.push(e);
        if (this.perfLog.length > 300) this.perfLog.shift();
    }
    setColor(c) { this.color = c; }
    setWidth(w) { this.penWidth = w; }
    setOpacity(o) { this.opacity = o; }
    setOutlineMode(b) { this.outlineMode = !!b; this._renderActive(); this.two.update(); this._emit(); }
    // Toggle per-object opacity groups (tile-edge Option B). Fills are baked with or
    // without the seam-overlap pad, so cached tiles must rebake to match the mode.
    setOpacityGroups(b) {
        this.opacityGroups = !!b;
        for (const k of Object.keys(this.tiles)) this.tiles[k] = new Map();
        this._lastVisKeys = null;
        if (this.activeLevel >= 1) this._ensureTiles(); else this._rebuildLevelObjects(this.activeLevel);
        this._renderActive(); this.two.update(); this._emit();
    }
    setDebug(b) { this.debug = !!b; this._renderActive(); this.two.update(); }
    setKDebug(b) { this.kdebug = !!b; this._renderActive(); this.two.update(); this._emit(); }
    setTileDebug(b) { this.tileDebug = !!b; this._renderTileDebug(); this.two.update(); }
    resize(w, h) {
        if (w === this.width && h === this.height) return; // mobile fires resize on URL-bar show/hide
        const t0 = performance.now();
        this.width = w; this.height = h; this.two.renderer.setSize(w, h);
        // The visible-tile set changes with the window: fault in whatever the new view
        // needs and re-render. (Tile GRIDS don't move -- each level's grid is fixed in
        // its crossing record, so the cached tiles stay valid across resizes.)
        this._lastVisKeys = null;
        if (this.activeLevel >= 1) this._ensureTiles();
        this._renderActive(); this.two.update(); this._emit();
        this._perf("resize", t0, true, { w, h });
    }

    // Tear down: stop the render loop and detach the SVG from the DOM. Must be
    // called on unmount, or React StrictMode/HMR re-runs leak a stacked SVG each
    // time (old dead instances bleed through behind the live one).
    destroy() {
        try { this.two.pause(); } catch (e) { /* ignore */ }
        const el = this.two.renderer && this.two.renderer.domElement;
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    clear() {
        this._pushUndo({ op: "clear", state: this._captureState() });
        this._applyState({ nativesByLevel: { 0: [] }, crossings: {},
            camera: { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 } });
    }
    // Document + camera as one unit (undo of clear, snapshot restore).
    _captureState() {
        return { nativesByLevel: this.nativesByLevel, crossings: this.crossings,
            camera: { activeLevel: this.activeLevel, inScale: this.inScale, inPanX: this.inPanX, inPanY: this.inPanY } };
    }
    _applyState(s) {
        this.world.remove(this.world.children);
        this.debugGroup.remove(this.debugGroup.children);
        this.tileDebugGroup.remove(this.tileDebugGroup.children);
        this.nativesByLevel = s.nativesByLevel;
        this.crossings = s.crossings;
        this.levelObjects = [];
        this.tiles = {}; // kobinizations rebake lazily from the restored natives
        this.activeLevel = s.camera.activeLevel;
        this.inScale = s.camera.inScale; this.inPanX = s.camera.inPanX; this.inPanY = s.camera.inPanY;
        this._drawing = null; this._panLast = null; this._erasing = false;
        this._lastVisKeys = null; this._lastOutlineBakeScale = 0; this._bakedWindow = null;
        this._objGroups = new Map();
        this._projCache = new Map();
        this._refresh();
    }

    // ---- dev snapshot (NOT the durable save format) ----
    // The whole document + camera as plain JSON, so a reload / hot reload can
    // restore the session. The real format comes with the Document refactor;
    // this exists so no drawing is ever lost to a reload again.
    snapshot() {
        const natives = {};
        for (const l of Object.keys(this.nativesByLevel)) {
            natives[l] = (this.nativesByLevel[l] || []).map((o) => ({
                type: o.type, origin: o.origin, id: o.id, pts: o.pts,
                lwFrame: o.lwFrame, color: o.color, opacity: o.opacity,
            }));
        }
        const crossings = {};
        for (const l of Object.keys(this.crossings)) {
            const r = this.crossings[l];
            crossings[l] = { s: r.s, t: { x: r.t.x, y: r.t.y }, grid: { ...r.grid } };
        }
        return {
            v: "dev-0",
            camera: { activeLevel: this.activeLevel, inScale: this.inScale, inPanX: this.inPanX, inPanY: this.inPanY },
            natives, crossings,
        };
    }
    loadSnapshot(snap) {
        if (!snap || !snap.natives) return false;
        const natives = {};
        let maxId = 0;
        for (const l of Object.keys(snap.natives)) {
            natives[l] = snap.natives[l].map((o) => ({ ...o, paths: [] }));
            for (const o of natives[l]) if (o.id >= maxId) maxId = o.id;
        }
        _id = Math.max(_id, maxId + 1); // never reuse an id: groups + lineage key on it
        this._undoStack = []; this._redoStack = [];
        this._applyState({
            nativesByLevel: natives,
            crossings: snap.crossings || {},
            camera: snap.camera || { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 },
        });
        return true;
    }

    screenToFrame(sx, sy) { return [(sx - this.inPanX) / this.inScale, (sy - this.inPanY) / this.inScale]; }
    _objs() { return this.levelObjects[this.activeLevel]; }
    // Record a newly drawn object as a persistent native of the active level.
    _addNative(o) {
        const L = this.activeLevel;
        if (!this.nativesByLevel[L]) this.nativesByLevel[L] = [];
        this.nativesByLevel[L].push(o);
        const list = this.levelObjects[L];
        if (!list) this.levelObjects[L] = [o];
        else if (list !== this.nativesByLevel[L]) list.push(o);
    }

    // ---- pointer ----
    pointerDown(sx, sy) {
        if (this.tool === "pan") { this._panLast = [sx, sy]; return; }
        if (this.tool === "erase") { this._erasing = true; this.eraseAt(sx, sy); return; }
        const p = this.screenToFrame(sx, sy);
        // Pen variants: highlighter = wide translucent band; straight = 2-point line.
        const highlight = this.penType === "highlight";
        const straight = this.penType === "straight";
        const lw = (highlight ? this.penWidth * 2.5 : this.penWidth) / this.inScale;
        const op = highlight ? Math.min(this.opacity, 0.45) : this.opacity;
        const o = { type: "stroke", origin: "native", id: _id++, pts: [p], lwFrame: lw, color: this.color, opacity: op, paths: [] };
        const live = new Two.Path([new Two.Anchor(p[0], p[1])], false, !straight); // curved unless straight-line pen
        live.noFill(); live.stroke = o.color; live.linewidth = o.lwFrame; live.cap = "round"; live.join = "round"; live.opacity = o.opacity;
        this.world.add(live); o.paths = [live]; o._live = live;
        this._addNative(o); this._drawing = o; this._drawStartT = Date.now();
        this.two.update(); this._emit();
    }
    pointerMove(sx, sy) {
        if (this.tool === "pan" && this._panLast) {
            const dx = sx - this._panLast[0], dy = sy - this._panLast[1];
            this._panLast = [sx, sy];
            this.panBy(dx, dy);
            return;
        }
        if (this.tool === "erase") { if (this._erasing) this.eraseAt(sx, sy); return; }
        if (this._drawing) {
            const p = this.screenToFrame(sx, sy);
            const o = this._drawing;
            if (this.penType === "straight" && o.pts.length >= 2) {
                // Straight pen: anchor -> cursor; the cursor replaces the endpoint.
                o.pts[1] = p;
                const v = o._live.vertices[1]; v.x = p[0]; v.y = p[1];
            } else {
                o.pts.push(p);
                o._live.vertices.push(new Two.Anchor(p[0], p[1]));
            }
            this.two.update();
        }
    }
    pointerUp() {
        if (this._drawing) {
            const o = this._drawing; o._live = null;
            this._renderObject(o); this.two.update();
            // A new stroke is the ONLY thing that may change kobinized tiles: invalidate
            // cached tiles DEEPER than this level so they re-bake (with this stroke
            // included) next visit. This level + shallower + all natives are untouched, so
            // existing details stay anchored to stable shapes.
            this._invalidateDeeper(this.activeLevel);
            this._pushUndo({ op: "add", id: o.id });
            this._emit();
        }
        this._drawing = null; this._panLast = null; this._erasing = false;
    }
    // Abort the live stroke with no history entry (a second touch means the
    // gesture is a pinch, not a mark).
    cancelStroke() {
        const o = this._drawing; if (!o) return;
        this._drawing = null;
        this._removeById(o.id);
        this._refresh();
    }

    // ---- eraser (true erase via per-object lineage) ----
    // Erase the topmost object under the cursor. Inherited/projected copies carry
    // their source object's id, so hitting a kobinized copy at ANY level erases
    // the one real object everywhere.
    eraseAt(sx, sy) {
        const id = this._hitTest(sx, sy);
        if (id == null) return false;
        const rec = this._removeById(id);
        if (!rec) return false;
        this._pushUndo({ op: "erase", obj: rec.obj, level: rec.level, index: rec.index });
        this._refresh();
        return true;
    }
    _hitTest(sx, sy) {
        const p = this.screenToFrame(sx, sy);
        const list = this._objs() || [];
        const slack = 6 / this.inScale; // finger-friendly margin, constant on screen
        const curvedLevel = this.activeLevel < this.cfg.lineModeLevel;
        for (let i = list.length - 1; i >= 0; i--) { // topmost first
            const o = list[i];
            if (o.type === "fill") {
                if (windingOfPoint(o.polys, p) !== 0) return o.id;
            } else {
                const pts = (curvedLevel && o.pts.length > 2) ? this._displayChords(o) : o.pts;
                if (distToPolyline(pts, p) <= o.lwFrame / 2 + slack) return o.id;
            }
        }
        return null;
    }
    // Remove a native by id from whichever level holds it. Kobinizations DEEPER
    // than its home level contain baked copies -> invalidate them; shallower
    // levels only see it through live projection, which the rebuild recomputes.
    _removeById(id) {
        for (const Ls of Object.keys(this.nativesByLevel)) {
            const arr = this.nativesByLevel[Ls];
            const i = arr ? arr.findIndex((o) => o.id === id) : -1;
            if (i < 0) continue;
            const [obj] = arr.splice(i, 1);
            (obj.paths || []).forEach((pp) => { if (pp.parent) pp.parent.remove(pp); });
            obj.paths = [];
            const L = +Ls;
            this._invalidateDeeper(L);
            this.levelObjects[L] = null;
            for (const k of [...this._projCache.keys()]) if (k.startsWith(id + ":")) this._projCache.delete(k);
            return { obj, level: L, index: i };
        }
        return null;
    }
    _insertObject(obj, level, index) {
        if (!this.nativesByLevel[level]) this.nativesByLevel[level] = [];
        const arr = this.nativesByLevel[level];
        arr.splice(Math.min(index, arr.length), 0, obj);
        this._invalidateDeeper(level);
        this.levelObjects[level] = null;
    }
    // Rebuild + re-render the active level after a document mutation.
    _refresh() {
        this._lastVisKeys = null;
        if (this.activeLevel >= 1) this._ensureTiles();
        else this._rebuildLevelObjects(this.activeLevel);
        this._renderActive();
        this.two.update();
        this._emit();
    }

    // ---- undo / redo ----
    // Each user action pushes one op; undo/redo swap ops between the two stacks,
    // converting each op into its inverse as it crosses.
    _pushUndo(op) {
        this._undoStack.push(op);
        if (this._undoStack.length > 200) this._undoStack.shift();
        this._redoStack = []; // a fresh action forks history; the redo branch dies
    }
    undo() {
        const op = this._undoStack.pop();
        if (!op) return false;
        this._redoStack.push(this._invert(op));
        this._refresh();
        return true;
    }
    redo() {
        const op = this._redoStack.pop();
        if (!op) return false;
        this._undoStack.push(this._invert(op));
        this._refresh();
        return true;
    }
    // Apply the inverse of `op` and return the op that re-applies it.
    _invert(op) {
        switch (op.op) {
            case "add": { // undo an add = remove the object
                const rec = this._removeById(op.id);
                return rec ? { op: "absent", obj: rec.obj, level: rec.level, index: rec.index } : op;
            }
            case "erase": { // undo an erase = put the object back
                this._insertObject(op.obj, op.level, op.index);
                return { op: "present", id: op.obj.id };
            }
            case "absent": { // redo of an add
                this._insertObject(op.obj, op.level, op.index);
                return { op: "add", id: op.obj.id };
            }
            case "present": { // redo of an erase
                const rec = this._removeById(op.id);
                return rec ? { op: "erase", obj: rec.obj, level: rec.level, index: rec.index } : op;
            }
            case "clear": {
                const cur = this._captureState();
                this._applyState(op.state);
                return { op: "clear", state: cur };
            }
            default: return op;
        }
    }

    // ---- pan / zoom ----
    // Translate the camera by screen-px deltas (pan tool, pinch midpoint drag).
    panBy(dx, dy) {
        const t0 = performance.now();
        this.inPanX += dx; this.inPanY += dy;
        let needRender = false;
        if (this.activeLevel >= 1 && this._ensureTiles()) needRender = true; // fault in tiles entering view
        // Window-clipped outlines: re-bake only when the view leaves the padded
        // window they were baked for (a re-bake per mouse move froze the pan).
        if ((this.outlineMode || this._hasFat) && !this._windowCovered()) needRender = true;
        if (needRender) this._renderActive();
        this._syncWorld(); this.two.update(); this._emit();
        this._perf("pan", t0);
    }
    zoomAt(sx, sy, deltaY) { this.zoomFactorAt(sx, sy, Math.pow(2, -deltaY / 1000)); }
    // Two-finger pinch: translate by the midpoint drag, scale about the midpoint.
    pinchUpdate(mx, my, factor, dx, dy) {
        this.inPanX += dx; this.inPanY += dy;
        this.zoomFactorAt(mx, my, factor);
    }
    zoomFactorAt(sx, sy, factor) {
        const t0 = performance.now();
        // A zoom mid-stroke can cross a level (changing the frame under the
        // stroke's coordinates) or re-render and orphan the live path: finalize first.
        if (this._drawing) this.pointerUp();
        const ns = this.inScale * factor;
        this.inPanX = sx - ((sx - this.inPanX) / this.inScale) * ns;
        this.inPanY = sy - ((sy - this.inPanY) / this.inScale) * ns;
        this.inScale = ns;
        this._maybeCross();
        let needRender = false;
        // Fault in any tiles newly brought into view by the zoom.
        if (this.activeLevel >= 1 && this._ensureTiles()) needRender = true;
        // Outline polygons are baked once at a given scale; re-bake on zoom so the round
        // caps/joins stay smooth instead of faceting as the baked polygon is magnified.
        // But only when scale has moved enough (>~25%) since the last bake -- not every
        // wheel tick -- so we don't re-run Clipper continuously during a zoom. Between
        // bakes the world transform magnifies the last polygon (sub-perceptible facet).
        // Same machinery drives gate-wide strokes rendered as fills (_fatOnScreen).
        if (this.outlineMode || this._hasFat) {
            const last = this._lastOutlineBakeScale || 0;
            if (this.inScale > last * 1.25 || this.inScale < last * 0.8 || !this._windowCovered()) needRender = true;
        }
        if (needRender) this._renderActive();
        this._syncWorld(); this.two.update(); this._emit();
        this._perf("zoom", t0);
    }
    _maybeCross() {
        const t0 = performance.now(), from = this.activeLevel;
        let crossed = false;
        while (this.inScale > this.cfg.enter) { this._crossUp(); crossed = true; }
        // No floor: zooming out past level 0 creates coarser levels (negative
        // indices) the same way zooming in creates deeper ones.
        while (this.inScale < this.cfg.exit) { this._crossDown(); crossed = true; }
        if (!crossed) return;
        // Bake + render ONCE after the level settles: a fast zoom step may cross
        // several levels in sequence (each frame is still defined, never skipped),
        // and baking the intermediate levels' views would be wasted work.
        this._lastVisKeys = null;
        if (this.activeLevel >= 1) this._ensureTiles();
        else this._rebuildLevelObjects(this.activeLevel);
        this._renderActive();
        this._perf("cross", t0, true, { from, to: this.activeLevel });
    }

    // ---- crossings: fixed frame per level + cached tiles ----
    // A level's frame is established the FIRST time it's entered (current view becomes the
    // centre of tile (0,0)) and then reused forever. Re-entering anywhere maps the current
    // view into that same fixed grid. Each level is exactly one crossing-step from its
    // neighbour, so there is no "ground level" -- levels extend up and down indefinitely
    // and per-level coordinates stay bounded (no chain compounding).
    _crossUp() {
        const N = this.activeLevel + 1, base = this.cfg.base;
        if (!this.crossings[N]) {
            // First entry defines the frame FOREVER (re-entries reuse it). Define it as
            // if the crossing happened at exactly `enter`: any (s, t) with
            // t = pan * (s / inScale) keeps the current screen at the grid centre, and
            // pinning s = enter (instead of capturing a possibly-overshot inScale) keeps
            // every re-entry at inScale * base / s ~= base. If a big zoom step captured
            // s > enter * base / exit (600 at the defaults), each later gentle pass
            // through 300x would land BELOW `exit` and instantly bounce back down --
            // the hysteresis band inverts and the threshold churns for many ticks.
            const k = this.cfg.enter / this.inScale;
            this.crossings[N] = {
                s: this.cfg.enter,
                t: { x: this.inPanX * k, y: this.inPanY * k },
                grid: this._makeGrid(),
            };
            if (!this.tiles[N]) this.tiles[N] = new Map();
        }
        const { s, t } = this.crossings[N];
        const nis = this.inScale * base / s;            // -> ~base
        this.inPanX = this.inPanX - t.x * nis / base;   // place current view in the fixed grid
        this.inPanY = this.inPanY - t.y * nis / base;
        this.inScale = nis;
        this.activeLevel = N;
    }
    _crossDown() {
        if (!this.crossings[this.activeLevel]) {
            // First exit below this level -- the coarser neighbour doesn't exist yet.
            // Define the map exactly like _crossUp's first entry: s = enter keeps the
            // hysteresis band symmetric, t places the current view at the coarser
            // grid's centre (pan' = 0). Levels extend down indefinitely; level 0 is
            // not a floor.
            this.crossings[this.activeLevel] = {
                s: this.cfg.enter,
                t: { x: -this.inPanX * this.cfg.base / this.inScale, y: -this.inPanY * this.cfg.base / this.inScale },
                grid: this._makeGrid(),
            };
        }
        const rec = this.crossings[this.activeLevel];
        const { s, t } = rec, base = this.cfg.base;
        const cur = this.inScale, px = this.inPanX, py = this.inPanY;
        // Remove only the RENDERED paths; KEEP the cached tiles AND the level frame so a
        // return re-uses them (stable, no re-bake/no drift). Natives persist too.
        this._clearLevel(this.activeLevel);
        this.levelObjects[this.activeLevel] = null;
        this.activeLevel -= 1;
        this.inScale = (s / base) * cur;
        this.inPanX = (t.x / base) * cur + px;
        this.inPanY = (t.y / base) * cur + py;
    }
    // A new stroke at `level` may change kobinizations DEEPER (they inherit it), so drop
    // those cached tiles; they re-bake on next visit. This level + shallower + all natives
    // are untouched, so existing detail stays anchored to stable shapes.
    _invalidateDeeper(level) {
        for (const k of Object.keys(this.tiles)) {
            if (+k > level) { this.tiles[k] = new Map(); this.levelObjects[+k] = null; }
        }
    }

    // ---- tile grid (fixed per level, defined at first entry) ----
    // A tile spans the buffered window: k = 1 + 2*bufferScreens screens. The grid origin is
    // chosen so the first-crossing screen sits in the MIDDLE of tile (0,0). Normally the
    // view is inside one tile; only straddling an edge/corner touches 2-4 tiles.
    // The grid is CAPTURED in the level's crossing record: tiles are cached by (i,j) key
    // only, so deriving the grid from the live window size would let a window resize
    // silently re-map every cached tile onto a rect it was never baked for.
    _makeGrid() {
        const k = 1 + 2 * this.cfg.bufferScreens, base = this.cfg.base;
        const w = k * this.width / base, h = k * this.height / base;
        return { w, h, ox: this.width / (2 * base) - w / 2, oy: this.height / (2 * base) - h / 2 };
    }
    _grid(level) { const rec = this.crossings[level]; return (rec && rec.grid) || this._makeGrid(); }
    _tileRect(level, i, j) {
        const g = this._grid(level);
        return { left: g.ox + i * g.w, top: g.oy + j * g.h, right: g.ox + (i + 1) * g.w, bottom: g.oy + (j + 1) * g.h };
    }
    _tileRange(level, rect) {
        const g = this._grid(level);
        return { i0: Math.floor((rect.left - g.ox) / g.w), i1: Math.floor((rect.right - g.ox) / g.w),
            j0: Math.floor((rect.top - g.oy) / g.h), j1: Math.floor((rect.bottom - g.oy) / g.h) };
    }
    _visibleTiles(level) {
        const r = this._tileRange(level, this._frameWindow(0)); const list = [];
        for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) list.push([i, j]);
        return list;
    }
    // Bake tiles overlapping `rect` (level coords) for `level`, recursing into the parent.
    _ensureTilesForRegion(level, rect) {
        if (level < 1 || !this.crossings[level]) return;
        if (!this.tiles[level]) this.tiles[level] = new Map();
        const r = this._tileRange(level, rect);
        for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) {
            if (!this.tiles[level].has(i + "," + j)) this._bakeTile(level, i, j);
        }
    }
    _bakeTile(level, i, j) {
        const tp0 = performance.now();
        const rec = this.crossings[level]; if (!rec) return;
        const { s, t } = rec, base = this.cfg.base;
        const rect = this._tileRect(level, i, j);
        // Source = the immediate PARENT level (neighbour, single step). Level 1's parent is
        // the complete originals; deeper levels fault in the parent tiles covering this
        // tile's pre-image, then gather their objects + the parent's natives.
        let parentObjs;
        if (level - 1 === 0) {
            parentObjs = this.nativesByLevel[0] || [];
            // Level 0 has no tiles, so natives drawn at NEGATIVE levels enter the
            // zoom-in bake chain here, magnified into frame 0; deeper levels then
            // inherit them tile-by-tile like any other level-0 content.
            const ups = this._projectedNatives(0, "up");
            if (ups.length) parentObjs = parentObjs.concat(ups);
        } else {
            const pr = { left: (rect.left * base - t.x) / s, top: (rect.top * base - t.y) / s,
                right: (rect.right * base - t.x) / s, bottom: (rect.bottom * base - t.y) / s };
            this._ensureTilesForRegion(level - 1, pr);
            parentObjs = [];
            const r = this._tileRange(level - 1, pr);
            for (let pi = r.i0; pi <= r.i1; pi++) for (let pj = r.j0; pj <= r.j1; pj++) {
                const pt = this.tiles[level - 1].get(pi + "," + pj);
                if (pt) for (const o of pt.objs) parentObjs.push(o);
            }
            for (const o of (this.nativesByLevel[level - 1] || [])) parentObjs.push(o);
        }
        const out = [];
        this._deriveInto(parentObjs, s, t, rect, level, out);
        this.tiles[level].set(i + "," + j, { i, j, objs: out });
        this._perf("bake", tp0, true, { tile: level + ":" + i + "," + j, in: parentObjs.length, out: out.length });
    }
    // Object bbox in its own frame. Cached on the object: geometry is immutable once
    // the stroke is finished (only the live in-progress stroke still grows).
    _bbox(o) {
        if (o._bbox) return o._bbox;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const scan = (pts) => { for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } };
        if (o.type === "fill") { for (const poly of o.polys) scan(poly); } else scan(o.pts);
        const b = { x0, y0, x1, y1 };
        if (o !== this._drawing) o._bbox = b;
        return b;
    }
    // Chords of an object's displayed spline at in-level display fidelity
    // (arcTolerancePx on screen at the deepest in-level zoom, `enter`). Cached on the
    // object -- reused by every fat-stroke/outline re-bake at any zoom in the level.
    _displayChords(o) {
        if (o._dispFlat) return o._dispFlat;
        const pts = flattenCurve(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter);
        if (o !== this._drawing) o._dispFlat = pts;
        return pts;
    }
    // Flattened chords of a curved stroke, in the CHILD level's frame, cached per child
    // level. The tolerance is view-independent (entry fidelity: arcTolerancePx on screen
    // at inScale = base), so every tile of that level -- whenever it happens to bake --
    // cuts the SAME chord vertices at the shared grid lines and fill seams stay exact.
    _flatChords(o, level, tpts) {
        if (o._flat && o._flat.level === level) return o._flat.pts;
        const pts = flattenCurve(tpts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base);
        if (o !== this._drawing) o._flat = { level, pts };
        return pts;
    }
    // Transform parent objects into this level's frame ((p*s+t)/base) and clip to `rect`,
    // applying the size gate (large strokes -> filled outline, small -> clipped stroke).
    _deriveInto(parentObjs, s, t, rect, level, out) {
        const base = this.cfg.base, W = this.width;
        // Seam pad: with per-object opacity groups, adjacent tiles' fill pieces may
        // safely OVERLAP a little (the group unions them before opacity applies), so
        // instead of abutting exactly -- which leaves an AA hairline where each edge
        // half-covers the seam pixel -- fills are clipped slightly PAST the tile.
        // ~1px at the shallowest zoom a tile is displayed at; harmless when deep.
        const pad = this.opacityGroups ? (rect.right - rect.left) * 5e-4 : 0;
        const crect = pad ? { left: rect.left - pad, top: rect.top - pad, right: rect.right + pad, bottom: rect.bottom + pad } : rect;
        // What matters for fidelity is what the PARENT level DISPLAYED: a stroke at a
        // level below lineModeLevel is painted as a Catmull-Rom spline, so any child
        // representation must reproduce the SPLINE, not the raw chords between the
        // anchors -- at ~3000x magnification a chord can cut a curve's corner by
        // ~1e6 frame units, which is the whole screen.
        const childCurved = level < this.cfg.lineModeLevel;
        const parentCurved = (level - 1) < this.cfg.lineModeLevel;
        for (const o of parentObjs) {
            // Cull on the transformed bbox before any geometry work. The bake used to
            // visit (transform + attempt to clip) every parent object and throw away
            // the ones outside the tile -- with many objects that visiting WAS the
            // whole crossing cost. The clip operates on the raw points, so the point
            // bbox plus the stroke-width margin (matching `ew` below) is a safe bound.
            const b = this._bbox(o);
            const m = o.type === "fill" ? pad : o.lwFrame * (s / base);
            if ((b.x1 * s + t.x) / base < rect.left - m || (b.x0 * s + t.x) / base > rect.right + m ||
                (b.y1 * s + t.y) / base < rect.top - m || (b.y0 * s + t.y) / base > rect.bottom + m) continue;
            if (o.type === "fill") {
                // Float clip (Sutherland-Hodgman), NOT Clipper: the fill->fill re-derive
                // runs once per crossing forever, and Clipper's magnitude-capped integer
                // scale quantized giant/deep geometry by whole frame-units (visible once
                // magnified) while falling into emulated Int128 past its fast range.
                const tp = clipRingsToRect(
                    o.polys.map((poly) => poly.map(([x, y]) => [(x * s + t.x) / base, (y * s + t.y) / base])), crect);
                if (tp.length) out.push({ type: "fill", origin: "inherited", id: o.id, color: o.color, opacity: o.opacity, polys: tp, paths: [] });
            } else {
                const lw = o.lwFrame * (s / base);
                const tpts = o.pts.map(([x, y]) => [(x * s + t.x) / base, (y * s + t.y) / base]);
                if (o.lwFrame * s > W * this.cfg.polygonizeWidthFrac) {
                    const half = lw / 2;
                    const ew = { left: rect.left - half, top: rect.top - half, right: rect.right + half, bottom: rect.bottom + half };
                    // Flatten the displayed spline BEFORE clipping (shared chords, see
                    // _flatChords) -- the outline must trace the spline the parent
                    // painted; raw chords are NOT sub-pixel here, since the width gate
                    // selects exactly the fat strokes whose few centerline points get
                    // magnified ~3000x (a view outside the displayed band but inside
                    // the chord band flips to solid ink at the crossing).
                    // A parent projected up several levels is magnified 3000^N and a
                    // full display-fidelity flatten explodes -- for those, flatten only
                    // the annulus that can shape this tile's band edge (subdivision is
                    // dyadic, so tiles refine to the SAME vertices where they overlap).
                    // The flatten window MUST be the tile (crect), NOT ew: ew is the tile
                    // grown by half the linewidth, and for a giant that half is ~1e26, so
                    // an ew-sized window collapses the annulus prune and the recursion
                    // runs away (measured: one level -6 stroke -> 6M+ nodes -> OOM crash).
                    // A centerline point shapes the tile's band edge iff its distance to
                    // the TILE lies in [half - tdiag, half + tdiag]; ew only bounds the
                    // separate centerline clip below.
                    const tdiag = Math.hypot(rect.right - rect.left, rect.bottom - rect.top);
                    const mega = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * (s / base) > 20 * tdiag;
                    let cpts;
                    if (parentCurved && o.pts.length > 2 && mega) {
                        cpts = flattenCurveNear(tpts, (this.cfg.arcTolerancePx * 0.5) / base,
                            crect, Math.max(0, half - tdiag), half + tdiag);
                    } else {
                        cpts = (parentCurved && o.pts.length > 2) ? this._flatChords(o, level, tpts) : tpts;
                    }
                    // Keep only the centerline the tile can SEE. A segment whose capsule
                    // (segment +- lw/2) misses the tile paints nothing inside it, and a
                    // clip-end round cap is a disc centred ON the centerline -- always
                    // inside the true band -- so cutting at rect +- lw/2 is lossless for
                    // this tile while keeping the Clipper offset input to a handful of
                    // points instead of the thousands a flattened giant stroke can span.
                    // Clipper quantizes on an integer grid capped by coordinate magnitude:
                    // offset in TILE-LOCAL coords so precision is set by the tile size,
                    // not by how far this tile sits from the level origin.
                    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
                    const lrect = { left: crect.left - cx, top: crect.top - cy, right: crect.right - cx, bottom: crect.bottom - cy };
                    const polys = [];
                    const eq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
                    for (const run of clipPolylineToRect(cpts, ew)) {
                        if (!run.length) continue;
                        let op;
                        if (mega) {
                            // Oversized band: analytic strip (see strokeStripNear) --
                            // Clipper's offset at this radius is both wrong-grained
                            // (quantized) and explosively slow (Int128 + full arcs).
                            op = strokeStripNear(run.map(([x, y]) => [x - cx, y - cy]), lw,
                                { left: lrect.left, top: lrect.top, right: lrect.right, bottom: lrect.bottom },
                                { startCap: eq(run[0], cpts[0]), endCap: eq(run[run.length - 1], cpts[cpts.length - 1]) });
                        } else {
                            // displayScale: the arc-step count follows the on-screen cap radius
                            // at ENTRY (base), view-independently -- deep fault-ins then produce
                            // the same tessellation as entry bakes (seam-deterministic), and
                            // never `enter`-grade over-tessellation (the ae6e2f7 freeze).
                            op = strokeOutline(run.map(([x, y]) => [x - cx, y - cy]), lw,
                                { arcTolerancePx: this.cfg.arcTolerancePx, curved: false, displayScale: base, scale: this.cfg.scale });
                        }
                        op = clipRingsToRect(op, lrect);
                        for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
                    }
                    if (polys.length) out.push({ type: "fill", origin: "inherited", id: o.id, color: o.color, opacity: o.opacity, polys, paths: [] });
                } else {
                    // Small stroke: stays a stroke. If the child renders straight
                    // (>= lineModeLevel) but the parent displayed a spline, hand the
                    // child the flattened spline -- straight rendering of the raw
                    // anchors would jump off the displayed curve at the crossing.
                    const spts = (parentCurved && !childCurved && o.pts.length > 2) ? this._flatChords(o, level, tpts) : tpts;
                    // Extend the centerline clip by lw so clip-end caps fall beyond the
                    // tile; fills clip to the exact rect -> adjacent tiles abut cleanly.
                    const ew = { left: rect.left - lw, top: rect.top - lw, right: rect.right + lw, bottom: rect.bottom + lw };
                    for (const run of clipPolylineToRect(spts, ew)) {
                        if (run.length) out.push({ type: "stroke", origin: "inherited", id: o.id, color: o.color, opacity: o.opacity, pts: run, lwFrame: lw, paths: [] });
                    }
                }
            }
        }
    }
    // Bake the visible tile(s) if not cached, and rebuild the render list when the visible
    // set changes. Returns true when a re-render is needed. (Off-screen cached tiles are
    // kept but not rendered -> render cost stays bounded as you pan.)
    _ensureTiles() {
        const level = this.activeLevel;
        if (level < 1 || !this.crossings[level]) return false;
        if (!this.tiles[level]) this.tiles[level] = new Map();
        const vis = this._visibleTiles(level);
        let baked = false;
        for (const [i, j] of vis) if (!this.tiles[level].has(i + "," + j)) { this._bakeTile(level, i, j); baked = true; }
        const keyStr = vis.map(([i, j]) => i + "," + j).join("|");
        if (baked || keyStr !== this._lastVisKeys) { this._lastVisKeys = keyStr; this._rebuildLevelObjects(level); return true; }
        return false;
    }
    // Project a native from its home level H into level L's frame: a display copy
    // for cross-level rendering. Natives are stored only in their home level's
    // frame; without projection a shape drawn at a deeper level blinks out at the
    // crossing on the way out (still 2-3x visible size -- the hysteresis span is
    // much narrower than a level) and pops back in on the way in.
    _projectNative(o, H, L) {
        const key = o.id + ":" + H + ">" + L;
        const hit = this._projCache.get(key);
        if (hit) return hit;
        const base = this.cfg.base;
        let pts = o.pts, lw = o.lwFrame;
        if (H > L) {
            for (let K = H; K > L; K--) {
                const r = this.crossings[K]; if (!r) return null;
                pts = pts.map(([x, y]) => [(x * base - r.t.x) / r.s, (y * base - r.t.y) / r.s]);
                lw = lw * (base / r.s);
            }
        } else {
            for (let K = H + 1; K <= L; K++) {
                const r = this.crossings[K]; if (!r) return null;
                pts = pts.map(([x, y]) => [(x * r.s + r.t.x) / base, (y * r.s + r.t.y) / base]);
                lw = lw * (r.s / base);
            }
        }
        const d = { type: "stroke", origin: "derived", id: o.id, pts, lwFrame: lw, color: o.color, opacity: o.opacity, paths: [] };
        if (this._projCache.size > 500) this._projCache.clear();
        this._projCache.set(key, d);
        return d;
    }
    // Display copies of other levels' natives for level L. "down" = finer natives
    // shrunk into L (kept only if they could ever exceed ~0.3px within L's zoom
    // range -- beyond that they are invisible by construction, not popped).
    // "up" = coarser natives magnified into L (chain capped: past ~6 steps the
    // x3000-per-level factors exhaust float64 headroom, and a band that wide
    // either misses the window or is handled by the fat-fill coverage test).
    _projectedNatives(level, dir) {
        const out = [], base = this.cfg.base;
        for (const Hs of Object.keys(this.nativesByLevel)) {
            const H = +Hs;
            const arr = this.nativesByLevel[H];
            if (!arr || !arr.length) continue;
            if (dir === "down" ? H <= level : H >= level) continue;
            if (Math.abs(H - level) > 6) continue;
            let f = 1, ok = true;
            if (dir === "down") { for (let K = H; K > level; K--) { const r = this.crossings[K]; if (!r) { ok = false; break; } f *= base / r.s; } }
            else { for (let K = H + 1; K <= level; K++) { const r = this.crossings[K]; if (!r) { ok = false; break; } f *= r.s / base; } }
            if (!ok) continue;
            for (const o of arr) {
                if (dir === "down") {
                    const b = this._bbox(o);
                    if ((Math.hypot(b.x1 - b.x0, b.y1 - b.y0) + o.lwFrame) * f * this.cfg.enter < 0.3) continue;
                }
                const d = this._projectNative(o, H, level);
                if (d) out.push(d);
            }
        }
        return out;
    }
    // Render list = objects of the VISIBLE tiles + this level's natives + display
    // copies of other levels' natives. Coarser content reaches levels >= 1 through
    // the tile bake chain, so "up" projection is only for the tile-less levels <= 0.
    _rebuildLevelObjects(level) {
        const objs = [];
        if (level >= 1 && this.tiles[level]) for (const [i, j] of this._visibleTiles(level)) {
            const tile = this.tiles[level].get(i + "," + j);
            if (tile) for (const o of tile.objs) objs.push(o);
        }
        if (level <= 0) for (const d of this._projectedNatives(level, "up")) objs.push(d);
        for (const o of (this.nativesByLevel[level] || [])) objs.push(o);
        for (const d of this._projectedNatives(level, "down")) objs.push(d);
        this.levelObjects[level] = objs;
    }

    // ---- rendering ----
    _clearLevel(l) { const a = this.levelObjects[l]; if (a) a.forEach((o) => { (o.paths || []).forEach((p) => { if (p.parent) p.parent.remove(p); }); o.paths = []; }); }
    // Visible window in frame coords (the screen rect mapped back through the current
    // transform), expanded by `margin` frame units.
    _frameWindow(margin = 0) {
        const inv = 1 / this.inScale;
        return {
            left: (0 - this.inPanX) * inv - margin, top: (0 - this.inPanY) * inv - margin,
            right: (this.width - this.inPanX) * inv + margin, bottom: (this.height - this.inPanY) * inv + margin,
        };
    }
    _tint() { return this.kdebug && this.activeLevel > 0; } // red overlay only on kobinized levels
    // Padding (frame units) for outline/fat-fill bakes: half a screen on every side.
    _outlinePad() { return (0.5 * this.width) / this.inScale; }
    // True while the current view still fits inside the window the last outline/fat
    // bake was made for -- panning within the pad needs no re-bake.
    _windowCovered() {
        const b = this._bakedWindow; if (!b) return false;
        const w = this._frameWindow(0);
        return w.left >= b.left && w.right <= b.right && w.top >= b.top && w.bottom <= b.bottom;
    }
    // One Two.Group per object id (tile-edge Option B): every PIECE of the object
    // -- tile-clipped fills, overlapping stroke runs -- renders at FULL opacity
    // inside the group, and the object's opacity is applied ONCE on the group.
    // SVG isolates a <g opacity> into its own buffer, so overlapping pieces of a
    // translucent stroke union instead of double-darkening, and the deliberate
    // fill overlap at tile seams (see _deriveInto) erases the abutment hairline.
    _pieceGroup(map, parent, o, tintOpacity) {
        if (!this.opacityGroups) return parent; // legacy: per-piece opacity
        let g = map.get(o.id);
        if (!g) {
            g = new Two.Group();
            g.opacity = (o.opacity == null ? 1 : o.opacity) * tintOpacity;
            parent.add(g);
            map.set(o.id, g);
        }
        return g;
    }
    _renderActive() {
        const tr0 = performance.now();
        this.world.remove(this.world.children);
        this.debugGroup.remove(this.debugGroup.children);
        this._objGroups = new Map();
        // K-debug: draw the parent level's originals UNDER, in their real color, with
        // the continued (non-reset) transform so they sit exactly where the kobinized
        // copies should land. Kobinized copies go on top in translucent red, so any
        // mismatch shows up as black/original peeking through the red.
        if (this._tint() && this.crossings[this.activeLevel] && this.levelObjects[this.activeLevel - 1]) {
            const pc = (this.activeLevel - 1) < this.cfg.lineModeLevel;
            const dbg = new Map();
            for (const o of this.levelObjects[this.activeLevel - 1]) this._buildPaths(o, this._pieceGroup(dbg, this.debugGroup, o, 1), o.color, 1, pc);
        }
        const curved = this.activeLevel < this.cfg.lineModeLevel;
        for (const o of this._objs()) {
            o.paths = this._buildPaths(o, this._pieceGroup(this._objGroups, this.world, o, this._tint() ? 0.5 : 1), this._tint() ? "red" : o.color, this._tint() ? 0.5 : 1, curved);
        }
        this._syncWorld();
        this._lastOutlineBakeScale = this.inScale; // remember the scale we baked outlines at
        // Any stroke near the on-screen width gate? Then zoom/pan must keep re-baking
        // (its window-clipped fill has to track the camera). The 0.5 margin starts the
        // re-bakes a little before the stroke->fill flip so the flip lands on a fresh
        // bake at the current scale.
        const gate = this.width * this.cfg.polygonizeWidthFrac * 0.5;
        this._hasFat = this._objs().some((o) => o.type === "stroke" && o.lwFrame * this.inScale > gate);
        this._bakedWindow = (this.outlineMode || this._hasFat) ? this._frameWindow(this._outlinePad()) : null;
        this._perf("render", tr0, false, { n: this._objs().length, fat: this._hasFat });
    }
    _renderObject(o) {
        if (o.paths) o.paths.forEach((p) => { if (p.parent) p.parent.remove(p); });
        const curved = this.activeLevel < this.cfg.lineModeLevel;
        o.paths = this._buildPaths(o, this._pieceGroup(this._objGroups, this.world, o, this._tint() ? 0.5 : 1), this._tint() ? "red" : o.color, this._tint() ? 0.5 : 1, curved);
    }
    // A stroke wider on screen than the polygonize gate is rendered as OUR outline
    // fill instead of a browser stroke. Beyond that width the browser's own
    // rasterization goes wrong: its float32 stroker mis-places the band edge by
    // hundreds of px once device coordinates reach ~1e7 (measured 220px at 284x
    // in-level zoom vs float64 ground truth) -- and since the next crossing bakes
    // OUR band, the crossing would visibly snap. Rendering the accurate fill from
    // the moment the stroke is gate-wide keeps display and bake identical, so the
    // swap at the crossing is seamless by construction.
    _fatOnScreen(o) { return o.type === "stroke" && o.lwFrame * this.inScale > this.width * this.cfg.polygonizeWidthFrac; }
    _buildPaths(o, group, color, opacity, curved) {
        const paths = [];
        let polys = null;
        if (o.type === "fill") polys = o.polys;
        else if (this.outlineMode || this._fatOnScreen(o)) {
            // Render the band's VISIBLE piece as an accurate fill.
            // - FLATTEN the whole displayed spline first (cached per object): clipping
            //   the anchors and re-splining the run bends the curve near every window
            //   edge by ~0.33x the anchor spacing -- at deep zoom the window is smaller
            //   than one anchor gap, so the entire visible piece bends off the band.
            // - Classify each chord by its band's reach into the window: a disc that
            //   covers the WHOLE window short-circuits to a window quad (no Clipper);
            //   only chords whose band EDGE can cross the window (an annulus around
            //   half-width reach) go to the offset. Discs of dropped chords cannot
            //   touch the window, so the visible coverage is exact -- and the offset
            //   input shrinks from the full +-half-width clip (thousands of chords on
            //   a fat stroke: ~0.9s per wheel tick) to the few hundred that matter.
            // - Offset in window-local coords: Clipper's integer scale is capped by
            //   coordinate magnitude, so a window far from the level origin would
            //   otherwise cost visible precision.
            // Bake for a window padded by half a screen: panning inside the pad costs
            // nothing (see _windowCovered); only leaving it re-bakes.
            const vw = this._frameWindow(this._outlinePad());
            const cx = (vw.left + vw.right) / 2, cy = (vw.top + vw.bottom) / 2;
            const hw = (vw.right - vw.left) / 2, hh = (vw.bottom - vw.top) / 2;
            const half = o.lwFrame / 2;
            polys = [];
            let covered = false;
            // Cheap outs BEFORE the flatten -- a native projected up from a much
            // coarser level is magnified 3000^N, and a display-fidelity flatten of
            // such a stroke explodes (measured: seconds per render on a phone,
            // tens of millions of points). (1) Band entirely off-window: nothing
            // to build. (2) A raw anchor lies ON the displayed spline, so a
            // single anchor disc covering the window makes the window solid ink
            // with no geometry work at all.
            const bb = this._bbox(o);
            if (bb.x1 + half < vw.left || bb.x0 - half > vw.right || bb.y1 + half < vw.top || bb.y0 - half > vw.bottom) {
                return paths; // off-window: no pieces this bake; re-bakes on window exit
            }
            for (const p of o.pts) {
                if (Math.hypot(Math.abs(p[0] - cx) + hw, Math.abs(p[1] - cy) + hh) < half) { covered = true; break; }
            }
            const diagW = Math.hypot(vw.right - vw.left, vw.bottom - vw.top);
            const mega = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) > 20 * diagW;
            let cpts = [];
            if (!covered) {
                if (curved && o.pts.length > 2 && mega) {
                    // Oversized stroke: flatten only the annulus that can shape the
                    // band edge inside the window (full fidelity there, coarse
                    // chords elsewhere). Window-dependent, so not cached -- but the
                    // relevant sliver is window-sized, so it's cheap every time.
                    cpts = flattenCurveNear(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter,
                        vw, Math.max(0, half - diagW), half + diagW);
                } else {
                    cpts = (curved && o.pts.length > 2) ? this._displayChords(o) : o.pts;
                }
            }
            const pieces = [];
            let cur = null;
            for (let i = 0; i < cpts.length; i++) {
                const px = Math.abs(cpts[i][0] - cx), py = Math.abs(cpts[i][1] - cy);
                if (Math.hypot(px + hw, py + hh) < half) { covered = true; break; } // disc covers the whole window
                const near = Math.hypot(Math.max(px - hw, 0), Math.max(py - hh, 0));
                const gap = i + 1 < cpts.length ? Math.hypot(cpts[i + 1][0] - cpts[i][0], cpts[i + 1][1] - cpts[i][1]) : 0;
                const prevGap = i > 0 ? Math.hypot(cpts[i][0] - cpts[i - 1][0], cpts[i][1] - cpts[i - 1][1]) : 0;
                if (near <= half + Math.max(gap, prevGap)) {
                    if (!cur) { cur = []; pieces.push(cur); if (i > 0) cur.push(cpts[i - 1]); }
                    cur.push(cpts[i]);
                } else {
                    if (cur) cur.push(cpts[i]); // one extra vertex keeps the chord across the boundary
                    cur = null;
                }
            }
            if (covered) {
                const m = 2 / this.inScale; // a couple of px past the viewport, against AA fringes
                polys.push([[vw.left - m, vw.top - m], [vw.right + m, vw.top - m], [vw.right + m, vw.bottom + m], [vw.left - m, vw.bottom + m]]);
            } else {
                const eq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
                const lvw = { left: vw.left - cx, top: vw.top - cy, right: vw.right - cx, bottom: vw.bottom - cy };
                for (const run of pieces) {
                    if (!run.length) continue;
                    // The chord cache is flattened for the DEEPEST in-level zoom; at a
                    // shallow view that is ~1000x finer than a pixel can show, and the
                    // offset pays per input point (measured 2.7s per pan move zoomed
                    // out over a fat stroke). Decimate to the current view's budget --
                    // still sub-pixel on screen, and the 25% re-bake band keeps it so.
                    const drun = decimatePolyline(run, (this.cfg.arcTolerancePx * 0.5) / this.inScale);
                    let op;
                    if (mega) {
                        // Oversized band: Clipper's offset explodes (Int128 + full-arc
                        // caps at astronomic radius); the analytic strip is exact
                        // inside the padded window, which is all this bake serves.
                        op = strokeStripNear(drun.map(([x, y]) => [x - cx, y - cy]), o.lwFrame, lvw,
                            { startCap: eq(drun[0], cpts[0]), endCap: eq(drun[drun.length - 1], cpts[cpts.length - 1]) });
                    } else {
                        op = strokeOutline(drun.map(([x, y]) => [x - cx, y - cy]), o.lwFrame, { arcTolerancePx: this.cfg.arcTolerancePx, curved: false, displayScale: this.inScale });
                    }
                    for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
                }
            }
        }
        if (polys) {
            // One manual COMPOUND path: each ring is a sub-path (first vertex = move, rest
            // = line). Clipper emits holes with opposite winding, so the default nonzero
            // fill rule cuts them out -- a loop's enclosed area stays empty instead of
            // filling in. (Two.js 0.7.1 has no fill-rule/holes API; this is the way.)
            const verts = [];
            for (const poly of polys) {
                if (poly.length < 2) continue;
                for (let i = 0; i < poly.length; i++) {
                    const a = new Two.Anchor(poly[i][0], poly[i][1]);
                    a.command = i === 0 ? Two.Commands.move : Two.Commands.line;
                    verts.push(a);
                }
            }
            if (verts.length) {
                // In group mode the object's opacity lives on its group (applied once
                // over the union of pieces); each piece stays fully opaque inside.
                const pOp = this.opacityGroups ? 1 : (o.opacity == null ? 1 : o.opacity) * opacity;
                const path = new Two.Path(verts, true, false, true); // closed, straight, manual
                path.fill = color; path.noStroke(); path.opacity = pOp;
                if (this.debug) { path.stroke = "red"; path.linewidth = 1 / this.inScale; }
                group.add(path); paths.push(path);
            }
        } else {
            const pOp = this.opacityGroups ? 1 : (o.opacity == null ? 1 : o.opacity) * opacity;
            const path = new Two.Path(o.pts.map(([x, y]) => new Two.Anchor(x, y)), false, curved);
            path.noFill(); path.stroke = color; path.linewidth = o.lwFrame; path.cap = "round"; path.join = "round"; path.opacity = pOp;
            group.add(path); paths.push(path);
        }
        return paths;
    }

    _syncWorld() {
        this.world.scale = this.inScale; this.world.translation.x = this.inPanX; this.world.translation.y = this.inPanY;
        this._syncDebug();
        this._renderTileDebug();
    }
    // Map a point in `level` coords to current screen px (walk the crossing chain to the
    // active level, then apply the camera). Used for the tile-edge debug squares.
    _levelPointToScreen(level, x, y) {
        const base = this.cfg.base; let px = x, py = y, L = level;
        while (L > this.activeLevel) { const r = this.crossings[L]; if (!r) return null; px = (px * base - r.t.x) / r.s; py = (py * base - r.t.y) / r.s; L--; }
        while (L < this.activeLevel) { const r = this.crossings[L + 1]; if (!r) return null; px = (px * r.s + r.t.x) / base; py = (py * r.s + r.t.y) / base; L++; }
        return [px * this.inScale + this.inPanX, py * this.inScale + this.inPanY];
    }
    // Red squares at the edges of every cached KGroup tile at the active level and DEEPER
    // (deeper tiles persist -- they shrink into the parent view as you zoom back out).
    _renderTileDebug() {
        this.tileDebugGroup.remove(this.tileDebugGroup.children);
        if (!this.tileDebug) return;
        for (const k of Object.keys(this.tiles)) {
            const L = +k; if (L < this.activeLevel) continue;
            const map = this.tiles[L]; if (!map) continue;
            for (const tile of map.values()) {
                const r = this._tileRect(L, tile.i, tile.j);
                const c = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]]
                    .map(([x, y]) => this._levelPointToScreen(L, x, y));
                if (c.some((p) => !p)) continue;
                const path = new Two.Path(c.map(([x, y]) => new Two.Anchor(x, y)), true, false);
                path.noFill(); path.stroke = "red"; path.linewidth = 1.5; path.opacity = 0.9;
                this.tileDebugGroup.add(path);
            }
        }
    }
    // K-debug: keep the parent-originals overlay glued to the live transform. It uses
    // the CONTINUED (non-reset) parent transform so each original lands exactly where
    // its kobinized copy lands. Must update on every zoom/pan, not just at crossings,
    // or the overlay drifts away from the copies as you zoom within a level.
    _syncDebug() {
        const rec = this.crossings[this.activeLevel];
        if (!this._tint() || !rec) return;
        const base = this.cfg.base;
        this.debugGroup.scale = (rec.s / base) * this.inScale;
        this.debugGroup.translation.x = (rec.t.x / base) * this.inScale + this.inPanX;
        this.debugGroup.translation.y = (rec.t.y / base) * this.inScale + this.inPanY;
    }
    _emit() {
        this.onStatus({
            level: this.activeLevel, inScale: this.inScale, effectiveZoom: this._effectiveZoom(),
            nearCross: this.inScale > this.cfg.enter * 0.8, objects: this._objs() ? this._objs().length : 0,
            outline: this.outlineMode,
            lines: this.activeLevel >= this.cfg.lineModeLevel,
        });
    }
    _effectiveZoom() {
        let z = this.inScale;
        for (let l = this.activeLevel; l >= 1; l--) { const r = this.crossings[l]; if (r) z *= (r.s / this.cfg.base); }
        for (let l = this.activeLevel + 1; l <= 0; l++) { const r = this.crossings[l]; if (r) z *= (this.cfg.base / r.s); }
        return z;
    }
}

// ---- hit-test helpers (plain geometry) ----
function distToPolyline(pts, p) {
    if (pts.length === 1) return Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]);
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
        if (d < best) best = d;
    }
    return best;
}
// Nonzero winding of p across rings (a compound fill's holes cancel out).
function windingOfPoint(rings, p) {
    let w = 0;
    for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
            const a = r[i], b = r[(i + 1) % n];
            if (a[1] <= p[1]) { if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++; }
            else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
        }
    }
    return w;
}
