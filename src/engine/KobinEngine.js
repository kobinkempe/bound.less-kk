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
import {
    strokeOutline, clipRingsToRect, clipPolylineToRect, flattenCurve, flattenCurveNear,
    strokeStripNear, subtractPolys, netRingsArea, decimatePolyline,
} from "./geometry/clipperOutline";
import {
    distToPolyline, windingOfPoint, capsuleTouchesRings,
    ringsFullyInsideLasso, ringsTouchRings,
} from "./geometry/hittest";
import { bboxOf, rectSubtract, polygonizeStrokeInTile } from "./geometry/derive";
import { encodeDrawing, decodeDrawing } from "./persist";
import { validateScaleDef } from "./scaleBar";
import {
    computeSceneProposals, matchScenes, splitMembers, resolveCapture, levelHash,
    chunksOf, JOIN_WINDOWS, WINDOW_WIDTHS,
} from "./scenes";

// Eraser strokes paint in the canvas background color — visually "erased"
// the instant they're drawn, before any geometry work happens.
const ERASE_COLOR = "#ffffff";
const ERASE_PENDING = Symbol("erase-connectivity-pending");

export function regionTouchesWindow(polys, W, tolerance = 0) {
    const span = Math.max(W.right - W.left, W.bottom - W.top, 1);
    const eps = Math.max(1e-9, span * 1e-9, tolerance);
    for (const ring of polys || []) for (const [x, y] of ring) {
        if ((Math.abs(x - W.left) <= eps || Math.abs(x - W.right) <= eps) &&
            y >= W.top - eps && y <= W.bottom + eps) return true;
        if ((Math.abs(y - W.top) <= eps || Math.abs(y - W.bottom) <= eps) &&
            x >= W.left - eps && x <= W.right + eps) return true;
    }
    return false;
}

function ringsReachRectBoundary(polys, rect, tolerance = 0) {
    const eps = Math.max(1e-9, tolerance);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of polys || []) for (const [x, y] of ring) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x0 === Infinity) return false;
    return (x0 <= rect.left + eps && x1 >= rect.left - eps && y1 >= rect.top - eps && y0 <= rect.bottom + eps) ||
        (x0 <= rect.right + eps && x1 >= rect.right - eps && y1 >= rect.top - eps && y0 <= rect.bottom + eps) ||
        (y0 <= rect.top + eps && y1 >= rect.top - eps && x1 >= rect.left - eps && x0 <= rect.right + eps) ||
        (y0 <= rect.bottom + eps && y1 >= rect.bottom - eps && x1 >= rect.left - eps && x0 <= rect.right + eps);
}

function ringsBox(rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of rings || []) for (const [x, y] of ring) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
}

function boxesMeet(a, b, tolerance = 0) {
    return a && b && a.x0 !== Infinity && b.x0 !== Infinity &&
        a.x1 >= b.x0 - tolerance && b.x1 >= a.x0 - tolerance &&
        a.y1 >= b.y0 - tolerance && b.y1 >= a.y0 - tolerance;
}

function rectAsBox(rect) {
    return {
        x0: rect.left != null ? rect.left : rect.x0,
        y0: rect.top != null ? rect.top : rect.y0,
        x1: rect.right != null ? rect.right : rect.x1,
        y1: rect.bottom != null ? rect.bottom : rect.y1,
    };
}

// Exact-ish boundary summaries for the local topology gate. A single boolean
// "touches right" loses information when two strands use different intervals
// of the same edge. Sampling the nonzero fill between every polygon/edge
// intersection preserves those intervals, so removing one strand cannot be
// hidden by another strand that still touches the edge.
function edgeIntervals(rings, rect, side, tolerance = 0) {
    const vertical = side === "left" || side === "right";
    const span = vertical ? rect.right - rect.left : rect.bottom - rect.top;
    const inset = Math.min(Math.max(1e-9, tolerance * 0.25), Math.max(1e-9, span * 1e-6));
    const fixed = side === "left" ? rect.left + inset
        : side === "right" ? rect.right - inset
            : side === "top" ? rect.top + inset : rect.bottom - inset;
    const lo = vertical ? rect.top : rect.left;
    const hi = vertical ? rect.bottom : rect.right;
    const cuts = [lo, hi];
    for (const ring of rings || []) {
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            const av = vertical ? a[0] : a[1], bv = vertical ? b[0] : b[1];
            const at = vertical ? a[1] : a[0], bt = vertical ? b[1] : b[0];
            if (av === bv) {
                if (Math.abs(av - fixed) <= inset) {
                    cuts.push(Math.max(lo, Math.min(hi, at)), Math.max(lo, Math.min(hi, bt)));
                }
                continue;
            }
            const u = (fixed - av) / (bv - av);
            if (u >= 0 && u <= 1) cuts.push(Math.max(lo, Math.min(hi, at + u * (bt - at))));
        }
    }
    cuts.sort((a, b) => a - b);
    const unique = cuts.filter((v, i) => i === 0 || v - cuts[i - 1] > Math.max(1e-9, tolerance * 1e-3));
    const out = [];
    for (let i = 0; i + 1 < unique.length; i++) {
        const a = unique[i], b = unique[i + 1];
        if (b - a <= 1e-12) continue;
        const t = (a + b) / 2;
        const p = vertical ? [fixed, t] : [t, fixed];
        if (windingOfPoint(rings, p) !== 0) out.push([a, b]);
    }
    return out;
}

function intervalsCover(before, after, tolerance = 0) {
    const eps = Math.max(1e-9, tolerance);
    for (const [a0, a1] of before) {
        let cursor = a0;
        for (const [b0, b1] of after) {
            if (b1 < cursor - eps) continue;
            if (b0 > cursor + eps) break;
            cursor = Math.max(cursor, b1);
            if (cursor >= a1 - eps) break;
        }
        if (cursor < a1 - eps) return false;
    }
    return true;
}

function localCutNeedsGlobalScan(actions, tolerance) {
    const nodes = [];
    const actionCells = new Set(actions.map((a) => `${a.tile.i},${a.tile.j}`));
    const neighbour = (tile, side) => {
        if (tile.i == null || tile.j == null) return false;
        const di = side === "left" ? -1 : side === "right" ? 1 : 0;
        const dj = side === "top" ? -1 : side === "bottom" ? 1 : 0;
        return actionCells.has(`${tile.i + di},${tile.j + dj}`);
    };
    for (const action of actions) {
        for (const spec of action.specs) nodes.push({ action, polys: spec.polys });
        const after = action.specs.flatMap((s) => s.polys);
        for (const side of ["left", "right", "top", "bottom"]) {
            // A port removed on an edge between two edited tiles is accounted
            // for by the region graph below. Only a lost OUTER port can hide
            // an untouched component beyond the local action set.
            if (neighbour(action.tile, side)) continue;
            const beforePorts = edgeIntervals(action.subject, action.tile.core, side, tolerance);
            if (beforePorts.length &&
                !intervalsCover(beforePorts, edgeIntervals(after, action.tile.core, side, tolerance), tolerance)) {
                return true;
            }
        }
    }
    if (!nodes.length) return true;
    const parent = nodes.map((_, i) => i);
    const find = (i) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            if (ringsTouchRings(nodes[i].polys, nodes[j].polys, tolerance)) {
                const a = find(i), b = find(j);
                if (a !== b) parent[b] = a;
            }
        }
    }
    return new Set(nodes.map((_, i) => find(i))).size > 1;
}

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
        this._eraserPx = 16;
        // Deferred area erase: committed eraser strokes bake into the ink
        // beneath them one object per idle slice (see "deferred erase baking").
        this._eraseCommits = new Map(); // eraser stroke id -> its eraseCommit undo op
        this._bakeDone = new Map();     // eraser stroke id -> Set of object ids handled
        this._eraseTileMasks = new Map(); // eraser id -> tile-key -> shared outline rings
        this._eraseSplitScans = new Map(); // eraser id -> logical id -> incremental home-cell hierarchy
        this._syncEraseFlush = false;
        this._bakeTimer = null;
        this._lastList = []; this._lastRange = null;
        this.perfLog = [];
        this.geom = { strokeOutline, clipRingsToRect, clipPolylineToRect, flattenCurve };

        // Selection is a set of LOGICAL edit ids. `selection` remains a
        // backwards-compatible primary record and carries count/keys for a
        // lasso selection.
        this.selection = null;
        this._selected = new Map();   // editId -> { id, editId, level, obj }
        this._selectionPrimary = null;
        this._dragSel = null;         // pending click, lasso, or selected-family drag
        this._placementSeq = 1;
        this._activeRestyle = null;   // { id, op } — coalesces a slider/color gesture into one undo op
        this.docMeta = { name: null, createdAt: new Date().toISOString(), scaleDef: null, scenes: [], hiddenScenes: [], sceneSeq: 1 };
        this.renderer.setSelection(() => this._selectionOverlay());
        // The selected object can vanish under us (eraser, cut, undo, wipe, load).
        this.doc.subscribe((ev) => {
            if (ev.kind === "reset") {
                this._selected.clear(); this.selection = null; this._selectionPrimary = null;
                this._activeRestyle = null; this._dragSel = null;
                this._eraseCommits.clear(); this._bakeDone.clear();
                this._eraseTileMasks.clear(); this._eraseSplitScans.clear();
            } else if (ev.kind === "remove") {
                for (const [key, selected] of [...this._selected]) {
                    const family = this.doc.editGroup(key);
                    if (!family.length) {
                        this._selected.delete(key);
                        if (this._selectionPrimary === key) this._selectionPrimary = null;
                    } else if (ev.id === selected.id) {
                        const next = family[0];
                        this._selected.set(key, { id: next.obj.id, editId: key, level: next.level, obj: next.obj });
                    }
                }
                this._syncSelection();
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
        for (const key of this.store._tileKeys()) { const L = key.split("|")[0]; (out[L] = out[L] || { size: 0 }).size++; }
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
    destroy() {
        this._destroyed = true;
        if (this._bakeTimer != null) { clearTimeout(this._bakeTimer); this._bakeTimer = null; }
        this.store.destroy(); this.renderer.destroy();
    }

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
        const F = this.cam.frame;
        const derived = this.store.content(F, win);
        const own = this.store.ownContent(F, win);
        const placed = this.store.placedContent(F, win);
        const list = derived.concat(own, placed);
        // Renderer grouping follows logical edit ownership for re-homed
        // boundary patches. That lets parent/patch overlap close AA seams while
        // applying transparent opacity only once to the family.
        for (const o of list) {
            const rec = this.doc.getById(o.id);
            if (rec && rec.obj.editId != null) o.editId = rec.obj.editId;
        }
        // z defaults to id (creation order); cut pieces carry their source's z
        // so a stroke stays at its depth after a boolean erase splits it.
        list.sort((a, b) => ((a.z != null ? a.z : a.id) - (b.z != null ? b.z : b.id)) || (a.id - b.id));
        this._lastRange = this.lm.tileRange(F, win);
        return list;
    }
    _render() {
        const t0 = perfNow();
        this._lastList = this._buildList();
        this.renderer.render(this._lastList, this.cam.frame);
        this.renderer.update();
        this._emit();
        this._perf("render", t0, false, { n: this._lastList.length, fat: this.renderer._hasFat });
    }
    // True if the visible tile set changed since the last full render.
    _visibleChanged() {
        const r = this.lm.tileRange(this.cam.frame, this.cam.frameWindow(0));
        const p = this._lastRange;
        return !p || r.i0 !== p.i0 || r.i1 !== p.i1 || r.j0 !== p.j0 || r.j1 !== p.j1;
    }

    // ---- pan / zoom ----
    panBy(dx, dy) {
        const t0 = perfNow();
        this.cam.panBy(dx, dy);
        if (this._visibleChanged() || this.renderer.needsRebake() || this.renderer.needsReorigin()) this._render();
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
        if (crossed || this._visibleChanged() || this.renderer.needsRebake() || this.renderer.needsFatFlip() || this.renderer.needsReorigin()) this._render();
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
        const parent = this.cam.frame;
        // Find (or, if allowed, define early) the child FRAME this upward
        // approach will cross into — reusing a nearby sibling or spawning one.
        let child = this.lm.findChild(parent, this.cam.inScale, this.cam.inPanX, this.cam.inPanY);
        if (!child) {
            if (!this.preBake) return;
            child = this.lm.ensureChild(parent, this.cam.inScale, this.cam.inPanX, this.cam.inPanY);
        }
        const childId = child.id;
        this._prebakeQueued = true;
        const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 30);
        idle(() => {
            this._prebakeQueued = false;
            if (this._destroyed) return;
            if (this.cam.inScale <= this.cfg.enter * 0.8 || !this.lm.frame(childId)) return;
            const childWin = this.lm.mapRectF(this.cam.frameWindow(0), parent, childId);
            if (!childWin) return;
            const pins = this.store._pins;          // keep the VISIBLE tiles pinned —
            this.store.content(childId, childWin);  // bakes + caches; render untouched
            this.store._pins = pins;                // prebaked tiles stay evictable
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
            for (const o of this.doc.at(this.cam.frame)) {
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
    pointerDown(sx, sy, modifiers = {}) {
        if (this.tool === "pan") { this._panLast = [sx, sy]; return; }
        if (this.tool === "erase") { this._erasing = true; this.eraseAt(sx, sy); return; }
        if (this.tool === "erasePartial") {
            // The eraser IS a stroke: background-colored ink through the pen
            // pipeline, so the gesture costs nothing no matter how complex
            // the drawing is. Baking into the ink beneath happens later.
            this._erasing = true;
            const p = this.cam.screenToFrame(sx, sy);
            const o = {
                type: "stroke", origin: "native", erase: true, bakePx: this.cam.inScale,
                id: this.doc.allocId(), pts: [p],
                lwFrame: (2 * this._eraserPx) / this.cam.inScale,
                color: ERASE_COLOR, opacity: 1, paths: [],
            };
            this.store.live = o;
            this.doc.add(o, this.cam.frame, { live: true });
            this.renderer.addLive(o, false);
            this.renderer.update();
            this._drawing = o; this._drawStartT = Date.now();
            return;
        }
        if (this.tool === "select") {
            const id = this._resolvedHit(sx, sy);
            const rec = id == null ? null : this.doc.getById(id);
            const hitKey = rec ? this.doc.editKey(rec.obj) : null;
            const ctrl = !!(modifiers.ctrlKey || modifiers.metaKey);
            // Preserve today's direct-drag affordance: a press on ink selects
            // it immediately, so dragging that selected ink moves it. A drag
            // beginning on empty canvas is the lasso.
            if (!ctrl && (hitKey == null || !this._selected.has(hitKey))) {
                this._selected.clear();
                if (rec) this._selectRecord(rec);
                this._syncSelection();
                this.renderer.syncCameraOnly(); this.renderer.update(); this._emit();
            }
            this._dragSel = {
                mode: "pending", start: [sx, sy], last: [sx, sy], points: [[sx, sy]],
                ctrl,
                hitId: id, hitKey, moved: false, moves: new Map(), placement: null, ids: [],
                records: null, usePlacement: null, dx: 0, dy: 0,
            };
            return;
        }
        const p = this.cam.screenToFrame(sx, sy);
        const highlight = this.penType === "highlight";
        const straight = this.penType === "straight";
        const lw = (highlight ? this.penWidth * 2.5 : this.penWidth) / this.cam.inScale;
        const op = highlight ? Math.min(this.opacity, 0.45) : this.opacity;
        const o = { type: "stroke", origin: "native", id: this.doc.allocId(), pts: [p], lwFrame: lw, color: this.color, opacity: op, paths: [] };
        this.store.live = o; // exempt from bbox/flatten caches until it stops growing
        this.doc.add(o, this.cam.frame, { live: true });
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
        // "erasePartial" falls through: the eraser trail is this._drawing.
        if (this.tool === "select") {
            const d = this._dragSel;
            if (!d) return;
            if (d.mode === "pending" && Math.hypot(sx - d.start[0], sy - d.start[1]) >= 4) {
                // Dragging an ALREADY selected object moves the selection.
                // Everywhere else starts the freeform lasso.
                if (!d.ctrl && d.hitKey != null && this._selected.has(d.hitKey)) {
                    d.mode = "move";
                } else {
                    d.mode = "lasso";
                }
            }
            if (d.mode === "move") this._dragSelection(sx, sy);
            else if (d.mode === "lasso") {
                if (Math.hypot(sx - d.last[0], sy - d.last[1]) >= 1.5) {
                    d.points.push([sx, sy]); d.last = [sx, sy];
                    this.renderer.syncCameraOnly(); this.renderer.update();
                }
            }
            return;
        }
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
            let committedMove = false;
            if (d.mode === "pending") {
                this.select(d.start[0], d.start[1], { toggle: d.ctrl });
            } else if (d.mode === "lasso") {
                this._finishLasso(d);
            } else if (d.mode === "move" && d.moved && this.selection) {
                const t0 = perfNow();
                this.renderer.clearDragPreview();
                if (d.usePlacement) {
                    d.placement = {
                        id: `mv-${Date.now().toString(36)}-${this._placementSeq++}`,
                        frame: String(this.cam.frame), dx: d.dx, dy: d.dy,
                    };
                    const ids = this.doc.addPlacementMany(d.ids, d.placement);
                    if (ids.length) {
                        this.doc.pushUndo({ op: "placeMany", ids, placement: d.placement });
                    }
                } else {
                    // one undo op for a precision-safe direct drag in each
                    // object's own home-frame units
                    const moves = [];
                    for (const rec of d.records || []) {
                        const f = this.lm.frameFactor(this.cam.frame, rec.level);
                        if (f == null) continue;
                        const move = { id: rec.obj.id, dx: d.dx * f, dy: d.dy * f };
                        if (this.doc.moveById(move.id, move.dx, move.dy)) moves.push(move);
                    }
                    if (moves.length) {
                        this.doc.pushUndo(moves.length === 1
                            ? { op: "move", ...moves[0] }
                            : { op: "moveMany", moves });
                    }
                }
                this._render();
                this._perf("moveCommit", t0, true, { n: d.ids.length || 1 });
                committedMove = true;
            } else if (d.mode === "move") {
                this.renderer.clearDragPreview();
            }
            if (!committedMove) {
                this.renderer.syncCameraOnly(); this.renderer.update(); this._emit();
            }
        }
        if (this._drawing) {
            const o = this._drawing; this._drawing = null;
            this.renderer.endLive();
            this.store.live = null;               // stroke is final: bbox/flatten may cache now
            this.doc.finalize(o);                 // index + update finer tiles (off-screen)
            if (o.erase) {
                // ONE undo op for the whole eraser gesture; background baking
                // appends its per-object replacements to op.baked later.
                const op = { op: "eraseCommit", strokeId: o.id, strokeRec: null, baked: [] };
                this.doc.pushUndo(op);
                this._eraseCommits.set(o.id, op);
                this._scheduleBake();
            } else {
                this.doc.pushUndo({ op: "add", id: o.id });
                this._noteInkAdded(o);            // provisional scene assignment
            }
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
        const family = this.doc.editGroup(id);
        if (!family.length) return false;
        if (family.length === 1 && family[0].obj.editId == null) {
            const rec = this.doc.removeById(id);
            if (!rec) return false;
            this.doc.pushUndo({ op: "erase", obj: rec.obj, level: rec.level, index: rec.index });
            return true;
        }
        const records = [];
        for (const member of family) {
            const rec = this.doc.removeById(member.obj.id);
            if (rec) records.push(rec);
        }
        if (!records.length) return false;
        this.doc.pushUndo({ op: "eraseMany", records });
        return true;
    }
    // ---- deferred erase baking ----
    // An eraser stroke commits instantly as background-colored ink; z-order
    // alone makes the picture correct everywhere (it covers only what was
    // below it when drawn). Baking then folds it into each object beneath —
    // boolean-subtracting its painted footprint from theirs, in that object's
    // home frame — ONE object per idle slice, so the UI never stalls. Baking
    // only has to beat the next SELECTION of an affected object: select()
    // flushes that one object's pending erasures synchronously first.
    _eraserRadiusPx() { return this._eraserPx; }
    setEraserSize(px) { this._eraserPx = Math.min(200, Math.max(2, +px || 16)); }
    _zOf(o) { return o.z != null ? o.z : o.id; }
    _eraseStrokes() {
        const out = [];
        for (const k of this.doc.levels()) {
            for (const o of this.doc.at(k)) if (o.erase) out.push({ obj: o, level: k });
        }
        out.sort((a, b) => this._zOf(a.obj) - this._zOf(b.obj)); // oldest first
        return out;
    }
    _doneSet(eid) {
        let s = this._bakeDone.get(eid);
        if (!s) { s = new Set(); this._bakeDone.set(eid, s); }
        return s;
    }
    _scheduleBake(delay = 400) {
        if (this._bakeTimer != null) return;
        this._bakeTimer = setTimeout(() => { this._bakeTimer = null; this._bakeTick(); }, delay);
    }
    _bakeTick() {
        // Stay out of the user's way — retry when the pointer is idle.
        if (this._drawing || this._erasing || this._dragSel || this._panLast) { this._scheduleBake(400); return; }
        for (const Erec of this._eraseStrokes()) {
            const scanT = perfNow();
            const target = this._nextEraseTarget(Erec);
            this._perf("eraseScan", scanT, false, {
                gesture: Erec.obj.id, ...(this._lastEraseScan || {}),
            });
            if (target) {
                const bakeT = perfNow();
                if (this._bakeOne(Erec, target) === true) this._render();
                this._perf("eraseBake", bakeT, false, {
                    gesture: Erec.obj.id, target: target.obj.id,
                    targetFrame: String(target.level),
                });
                this._scheduleBake(80); // one object per slice
                return;
            }
            // Every object beneath is handled — the white stroke has served
            // its purpose; consume it silently (undo goes via its commit op).
            this._consumeErase(Erec);
            this._render();
            this._scheduleBake(80);
            return;
        }
    }
    // First not-yet-handled object beneath eraser stroke E (cheap filters:
    // z-below, frame chain within the precision guard, ink proximity).
    _nextEraseTarget(Erec) {
        const E = Erec.obj, HE = Erec.level;
        const done = this._doneSet(E.id);
        const stats = { checked: 0, bboxPassed: 0, exactChecked: 0 };
        // Existing descendants own the finest canonical ink. Process them
        // before their parents so a coarse gesture cannot replace a family
        // summary and accidentally mark still-unerased child cells as done.
        const levels = this.doc.levels()
            .filter((k) => this.lm.frameFactor(k, HE) != null)
            .sort((a, b) => this.lm.depthOf(b) - this.lm.depthOf(a));
        for (const k of levels) {
            if (this.lm.frameFactor(k, HE) == null) continue;
            for (const o of this.doc.at(k)) {
                if (o.erase || done.has(o.id)) continue;
                if (this._zOf(o) >= this._zOf(E)) continue;
                stats.checked++;
                if (!this._eraseBoundsMayTouch(E, HE, o, k)) { done.add(o.id); continue; }
                stats.bboxPassed++;
                stats.exactChecked++;
                if (!this._eraseMayTouch(E, HE, o, k)) { done.add(o.id); continue; }
                this._lastEraseScan = stats;
                return { obj: o, level: k };
            }
        }
        this._lastEraseScan = stats;
        return null;
    }
    _eraseBoundsMayTouch(E, HE, o, HO) {
        let eb = E._eraseBounds;
        if (!eb) {
            const b = bboxOf(E, this.store.live), half = (E.lwFrame || 0) / 2;
            eb = E._eraseBounds = {
                left: b.x0 - half, top: b.y0 - half,
                right: b.x1 + half, bottom: b.y1 + half,
            };
        }
        const b = bboxOf(o, this.store.live), half = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        const source = {
            left: b.x0 - half, top: b.y0 - half,
            right: b.x1 + half, bottom: b.y1 + half,
        };
        const mapped = o.placements && o.placements.length
            ? this.lm.mapRectPlacedF(source, HO, HE, o.placements)
            : this.lm.mapRectF(source, HO, HE);
        if (!mapped) return true; // the exact path remains the safe arbiter
        return mapped.right >= eb.left && mapped.left <= eb.right &&
            mapped.bottom >= eb.top && mapped.top <= eb.bottom;
    }
    // Proximity prefilter in the target's home frame (coarse control points —
    // the subtract itself is the arbiter, its no-op guard eats false hits).
    _eraseTiles(E, HE, target = null) {
        const r = E.lwFrame / 2;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const [x, y] of E.pts) {
            left = Math.min(left, x - r); top = Math.min(top, y - r);
            right = Math.max(right, x + r); bottom = Math.max(bottom, y + r);
        }
        if (left === Infinity) return [];
        let range = this.lm.tileRange(HE, { left, top, right, bottom });
        if (target) {
            const { obj, level } = target;
            const d = obj.placements && obj.placements.length
                ? this.lm.projectPlacedF(obj, level, HE)
                : this.lm.projectF(obj, level, HE);
            if (!d) return [];
            const b = bboxOf(d, this.store.live);
            const half = d.type === "fill" ? 0 : (d.lwFrame || 0) / 2;
            const tr = this.lm.tileRange(HE, {
                left: b.x0 - half, top: b.y0 - half,
                right: b.x1 + half, bottom: b.y1 + half,
            });
            range = {
                i0: Math.max(range.i0, tr.i0), i1: Math.min(range.i1, tr.i1),
                j0: Math.max(range.j0, tr.j0), j1: Math.min(range.j1, tr.j1),
            };
            if (range.i0 > range.i1 || range.j0 > range.j1) return [];
        }
        const out = [];
        for (let i = range.i0; i <= range.i1; i++) {
            for (let j = range.j0; j <= range.j1; j++) {
                out.push({ i, j, core: this.lm.tileRect(HE, i, j) });
            }
        }
        return out;
    }
    // Two pixels at frame entry is persistent overscan for opaque and
    // transparent logical groups. Canonical ownership remains the tile core.
    _eraseTileGuard() { return 2 / this.cfg.base; }
    _eraseBooleanOpts(E) {
        const display = Math.max(1e-9, E.bakePx || this.cfg.base);
        return {
            scale: Math.max(1, Math.round(4 * display)),
            simplify: 0.25 / display,
        };
    }
    _strokeRingsInRect(o, rect, displayScale, preferStrip = false) {
        return polygonizeStrokeInTile(o, rect, {
            cfg: this.cfg,
            displayScale,
            curved: (o.origin === "native" || o.curved === true) && o.pts.length > 2,
            forceStrip: preferStrip,
        });
    }
    _tileSourcePieces(o, HO, HE, tile) {
        if ((!o.placements || !o.placements.length) && HO !== HE && this.lm.isAncestor(HO, HE)) {
            return this.store._ensureUp(HE, tile.i, tile.j).objs.filter((p) => p.id === o.id);
        }
        if (o.placements && o.placements.length && HO !== HE && this.lm.isAncestor(HO, HE)) {
            const plan = this.store._placedUpPlan(o, HO, HE);
            return plan
                ? this.store._placedUpTile(o, HO, HE, tile.i, tile.j, plan)
                    .filter((p) => p.id === o.id)
                : [];
        }
        if ((!o.placements || !o.placements.length) && HO === HE) {
            if (o.windows && o.windows.length) {
                return this.store.ownContent(HE, tile.core).filter((p) => p.id === o.id);
            }
            return [o];
        }
        const projected = o.placements && o.placements.length
            ? this.lm.projectPlacedF(o, HO, HE)
            : this.lm.projectF(o, HO, HE);
        return projected ? [projected] : [];
    }
    _tileSubjectRings(o, HO, HE, tile, E) {
        const guard = this._eraseTileGuard();
        const rect = {
            left: tile.core.left - guard, top: tile.core.top - guard,
            right: tile.core.right + guard, bottom: tile.core.bottom + guard,
        };
        const out = [];
        for (const p of this._tileSourcePieces(o, HO, HE, tile)) {
            if (p.type === "fill") {
                for (const ring of clipRingsToRect(p.polys, rect)) out.push(ring);
            } else {
                for (const ring of this._strokeRingsInRect(
                    p, rect, E.bakePx || this.cfg.base,
                )) out.push(ring);
            }
        }
        if (!out.length || !o.windows || !o.windows.length) return out;
        // Render derivation deliberately overlaps a ceded boundary to hide AA
        // seams. That overlap is not canonical ownership and must not be baked
        // again on a later erase.
        const holes = [];
        for (const w of o.windows) {
            const mapped = this.lm.mapRectPlacedF(
                { left: w.x0, top: w.y0, right: w.x1, bottom: w.y1 },
                HO, HE, o.placements || [],
            );
            if (mapped && mapped.right > rect.left && mapped.left < rect.right &&
                mapped.bottom > rect.top && mapped.top < rect.bottom) {
                holes.push({ x0: mapped.left, y0: mapped.top, x1: mapped.right, y1: mapped.bottom });
            }
        }
        if (!holes.length) return out;
        const ownership = rectSubtract(rect, holes);
        const exact = [];
        for (const region of ownership) {
            for (const ring of clipRingsToRect(out, region)) exact.push(ring);
        }
        return exact;
    }
    _eraseTileMask(E, HE, tile) {
        let byTile = this._eraseTileMasks.get(E.id);
        if (!byTile) { byTile = new Map(); this._eraseTileMasks.set(E.id, byTile); }
        const key = `${HE}|${tile.i},${tile.j}`;
        if (byTile.has(key)) return byTile.get(key);
        const guard = this._eraseTileGuard();
        const rect = {
            left: tile.core.left - guard, top: tile.core.top - guard,
            right: tile.core.right + guard, bottom: tile.core.bottom + guard,
        };
        const mask = this._strokeRingsInRect(E, rect, E.bakePx || this.cfg.base);
        byTile.set(key, mask);
        return mask;
    }
    // Precision-safe prefilter in the eraser frame. Ancestor geometry comes
    // from the same chained Kobin tiles used for rendering.
    _eraseMayTouch(E, HE, o, HO) {
        const hitPts = E._eraseHitFlat || (E._eraseHitFlat = (
            E.pts.length > 2
                ? flattenCurve(E.pts, (this.cfg.arcTolerancePx * 0.5) / Math.max(E.bakePx || 1, 1e-9))
                : E.pts
        ));
        const r = E.lwFrame / 2;
        const segs = hitPts.length > 1 ? hitPts.length - 1 : 1;
        for (const tile of this._eraseTiles(E, HE)) {
            const rings = this._tileSubjectRings(o, HO, HE, tile, E);
            if (!rings.length) continue;
            for (let i = 0; i < segs; i++) {
                const a = hitPts[i], b = hitPts[Math.min(i + 1, hitPts.length - 1)];
                if (capsuleTouchesRings(a, b, r, rings)) return true;
            }
        }
        return false;
    }
    _subtractTile(subject, mask, tile, E) {
        if (!subject.length || !mask.length) return null;
        const cx = (tile.core.left + tile.core.right) / 2;
        const cy = (tile.core.top + tile.core.bottom) / 2;
        const off = (rings) => rings.map((ring) => ring.map(([x, y]) => [x - cx, y - cy]));
        const backRegion = (region) => region.map((ring) => ring.map(([x, y]) => [x + cx, y + cy]));
        const opts = this._eraseBooleanOpts(E);
        // First normalize the overlapping overscan/analytic-strip rings. The
        // boolean then sees one canonical nonzero subject, and the explicit
        // pixel tolerance bounds retained vertices independently of grid scale.
        const normalizedRegions = subtractPolys(off(subject), [], opts);
        const normalized = normalizedRegions.flat();
        if (!normalized.length) return null;
        const before = normalizedRegions.reduce((sum, rg) => sum + netRingsArea(rg), 0);
        const regions = subtractPolys(normalized, off(mask), opts);
        const kept = regions.reduce((sum, rg) => sum + netRingsArea(rg), 0);
        const r = E.lwFrame / 2;
        if (before - kept < Math.max(1e-12, 1e-4 * r * r)) return null;
        return regions.map(backRegion);
    }
    _normalizeTile(subject, tile, E) {
        if (!subject.length) return [];
        const cx = (tile.core.left + tile.core.right) / 2;
        const cy = (tile.core.top + tile.core.bottom) / 2;
        const local = subject.map((ring) => ring.map(([x, y]) => [x - cx, y - cy]));
        return subtractPolys(local, [], this._eraseBooleanOpts(E))
            .map((region) => region.map((ring) => ring.map(([x, y]) => [x + cx, y + cy])));
    }
    _halfOpenTileRange(frame, rect) {
        const g = this.lm.grid(frame);
        const ex = Math.max(g.w * 1e-12, Math.abs(rect.right) * Number.EPSILON * 4);
        const ey = Math.max(g.h * 1e-12, Math.abs(rect.bottom) * Number.EPSILON * 4);
        return this.lm.tileRange(frame, {
            left: rect.left, top: rect.top,
            right: rect.right > rect.left ? rect.right - ex : rect.right,
            bottom: rect.bottom > rect.top ? rect.bottom - ey : rect.bottom,
        });
    }
    _eraseCellOwnership(o, H) {
        if (!o.eraseCell) return null;
        const cellFrame = String(o.eraseCell.frame);
        const core = this.lm.tileRect(cellFrame, o.eraseCell.i, o.eraseCell.j);
        return o.placements && o.placements.length
            ? this.lm.mapRectPlacedF(core, cellFrame, H, o.placements)
            : this.lm.mapRectF(core, cellFrame, H);
    }
    _hierarchyTileTask(rec, actionsByCell) {
        const o = rec.obj, H = rec.level;
        const d = o.placements && o.placements.length
            ? this.lm.projectPlacedF(o, H, H) : o;
        const b = bboxOf(d || o, this.store.live);
        const half = (d || o).type === "fill" ? 0 : ((d || o).lwFrame || 0) / 2;
        // eraseCell geometry deliberately extends past its tile for rendering.
        // That guard is duplicate paint, not canonical ownership. Scanning its
        // bbox used to turn one cell into a 3x3 family of real rectangles during
        // connectivity materialization (the reported boxed erase fragments).
        const ownership = this._eraseCellOwnership(o, H);
        let range = ownership
            ? this._halfOpenTileRange(H, ownership)
            : this.lm.tileRange(H, {
                left: b.x0 - half, top: b.y0 - half,
                right: b.x1 + half, bottom: b.y1 + half,
            });
        if (!ownership && actionsByCell && actionsByCell.size) {
            for (const action of actionsByCell.values()) {
                range = {
                    i0: Math.min(range.i0, action.tile.i), i1: Math.max(range.i1, action.tile.i),
                    j0: Math.min(range.j0, action.tile.j), j1: Math.max(range.j1, action.tile.j),
                };
            }
        }
        return { rec, range, ownership, i: range.i0, j: range.j0, done: false };
    }
    _startHierarchicalSplitScan(Erec, target, family, actions, signature) {
        const actionsByCell = new Map();
        for (const action of actions || []) {
            if (action.tile.i == null || action.tile.j == null) continue;
            actionsByCell.set(`${action.tile.i},${action.tile.j}`, action);
        }
        const tasks = family.map((rec) => this._hierarchyTileTask(
            rec, rec.obj.id === target.obj.id ? actionsByCell : null,
        ));
        return {
            kind: "hierarchy", signature, family,
            targetId: target.obj.id, actionsByCell, tasks, taskIndex: 0,
            own: new Map(), draftSeq: 1,
        };
    }
    _collectHierarchicalSplit(scan, E) {
        const budget = this._syncEraseFlush ? Infinity : 64;
        const localE = { bakePx: this.cfg.base, lwFrame: E.lwFrame };
        let processed = 0;
        while (scan.taskIndex < scan.tasks.length && processed++ < budget) {
            const task = scan.tasks[scan.taskIndex];
            if (task.done) { scan.taskIndex++; processed--; continue; }
            const { rec } = task;
            const tile = {
                i: task.i, j: task.j,
                core: this.lm.tileRect(rec.level, task.i, task.j),
            };
            const cellKey = `${task.i},${task.j}`;
            const action = rec.obj.id === scan.targetId ? scan.actionsByCell.get(cellKey) : null;
            const regions = action
                ? action.specs.map((spec) => spec.polys)
                : this._normalizeTile(
                    this._tileSubjectRings(rec.obj, rec.level, rec.level, tile, localE),
                    tile, localE,
                );
            const ownedRect = task.ownership ? {
                left: Math.max(tile.core.left, task.ownership.left),
                top: Math.max(tile.core.top, task.ownership.top),
                right: Math.min(tile.core.right, task.ownership.right),
                bottom: Math.min(tile.core.bottom, task.ownership.bottom),
            } : tile.core;
            let regionIndex = 0;
            for (const region of regions) {
                if (ownedRect.left >= ownedRect.right || ownedRect.top >= ownedRect.bottom) {
                    regionIndex++;
                    continue;
                }
                // Topology uses only canonical ownership. renderPolys keeps the
                // validated overlap guard that hides antialiasing seams.
                const clipped = clipRingsToRect(region, ownedRect);
                if (!clipped.length) { regionIndex++; continue; }
                const coreRegions = this._normalizeTile(clipped, tile, localE);
                let part = 0;
                for (const corePolys of coreRegions) {
                    if (netRingsArea(corePolys) <= 1e-12) { part++; continue; }
                    let list = scan.own.get(rec.obj.id);
                    if (!list) { list = []; scan.own.set(rec.obj.id, list); }
                    list.push({
                        oldId: rec.obj.id, level: rec.level,
                        i: tile.i, j: tile.j, core: tile.core,
                        polys: corePolys, renderPolys: region,
                        sourceKey: `${rec.obj.id}|${cellKey}|${regionIndex}`,
                        part,
                    });
                    part++;
                }
                regionIndex++;
            }
            task.i++;
            if (task.i > task.range.i1) { task.i = task.range.i0; task.j++; }
            if (task.j > task.range.j1) task.done = true;
        }
        return scan.taskIndex >= scan.tasks.length ||
            scan.tasks.slice(scan.taskIndex).every((task) => task.done);
    }
    _hierarchyWindowForChild(parentRec, childRec) {
        if (!childRec.obj.attachRect) return null;
        const ar = childRec.obj.attachRect;
        const mappedAttach = this.lm.mapRectF({
            left: ar.x0, top: ar.y0, right: ar.x1, bottom: ar.y1,
        }, childRec.level, parentRec.level);
        if (!mappedAttach) return null;
        let best = null, bestScore = Infinity;
        for (const w of parentRec.obj.windows || []) {
            const wr = this.lm.mapRectPlacedF({
                left: w.x0, top: w.y0, right: w.x1, bottom: w.y1,
            }, parentRec.level, parentRec.level, parentRec.obj.placements || []);
            if (!wr) continue;
            const score = Math.abs(wr.left - mappedAttach.left) +
                Math.abs(wr.top - mappedAttach.top) +
                Math.abs(wr.right - mappedAttach.right) +
                Math.abs(wr.bottom - mappedAttach.bottom);
            if (score < bestScore) {
                bestScore = score;
                best = {
                    x0: wr.left, y0: wr.top, x1: wr.right, y1: wr.bottom,
                    ...(w.seam != null ? { seam: w.seam } : {}),
                };
            }
        }
        return best || {
            x0: mappedAttach.left, y0: mappedAttach.top,
            x1: mappedAttach.right, y1: mappedAttach.bottom,
        };
    }
    _mapHierarchyProxy(summary, fromLevel, toLevel, localE) {
        const out = [];
        for (const geom of summary.proxyGeoms || []) {
            const d = this.lm.projectF({
                type: "fill", origin: "derived", id: -1,
                polys: geom.polys, color: "#000", opacity: 1, paths: [],
            }, fromLevel, toLevel);
            if (!d || !d.polys.length) continue;
            const b = ringsBox(d.polys);
            const range = this.lm.tileRange(toLevel, {
                left: b.x0, top: b.y0, right: b.x1, bottom: b.y1,
            });
            for (let i = range.i0; i <= range.i1; i++) {
                for (let j = range.j0; j <= range.j1; j++) {
                    const core = this.lm.tileRect(toLevel, i, j);
                    const renderRect = {
                        left: core.left - this._eraseTileGuard(),
                        top: core.top - this._eraseTileGuard(),
                        right: core.right + this._eraseTileGuard(),
                        bottom: core.bottom + this._eraseTileGuard(),
                    };
                    const renderPolys = clipRingsToRect(d.polys, renderRect);
                    const corePolys = clipRingsToRect(d.polys, core);
                    if (!corePolys.length || netRingsArea(corePolys) <= 1e-12) continue;
                    out.push({
                        i, j, core, polys: corePolys, renderPolys,
                        box: ringsBox(corePolys), localE,
                    });
                }
            }
        }
        return out;
    }
    _summarizeHierarchyObject(rec, childrenById, recById, scan, memo, visiting, localE) {
        if (memo.has(rec.obj.id)) return memo.get(rec.obj.id);
        if (visiting.has(rec.obj.id)) return [];
        visiting.add(rec.obj.id);
        const items = [];
        for (const node of scan.own.get(rec.obj.id) || []) {
            items.push({
                kind: "own", sourceKey: node.sourceKey,
                geoms: [{
                    i: node.i, j: node.j, core: node.core,
                    polys: node.polys, renderPolys: node.renderPolys,
                    box: ringsBox(node.polys),
                }],
            });
        }
        for (const childRec of childrenById.get(rec.obj.id) || []) {
            const childSummaries = this._summarizeHierarchyObject(
                childRec, childrenById, recById, scan, memo, visiting, localE,
            );
            const window = this._hierarchyWindowForChild(rec, childRec);
            for (const summary of childSummaries) {
                items.push({
                    kind: "child", childRec, summary, window,
                    geoms: this._mapHierarchyProxy(summary, childRec.level, rec.level, localE),
                });
            }
        }
        visiting.delete(rec.obj.id);
        if (!items.length) { memo.set(rec.obj.id, []); return []; }

        const parent = items.map((_, i) => i);
        const find = (i) => {
            let r = i;
            while (parent[r] !== r) r = parent[r];
            while (parent[i] !== i) { const n = parent[i]; parent[i] = r; i = n; }
            return r;
        };
        const union = (a, b) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent[rb] = ra;
        };
        const sourceOwners = new Map();
        items.forEach((item, index) => {
            if (!item.sourceKey) return;
            if (sourceOwners.has(item.sourceKey)) union(index, sourceOwners.get(item.sourceKey));
            else sourceOwners.set(item.sourceKey, index);
        });
        const buckets = new Map();
        items.forEach((item, itemIndex) => {
            for (const geom of item.geoms) {
                const key = `${geom.i},${geom.j}`;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push({ itemIndex, geom });
            }
        });
        // Parent/child proxy vertices have each been simplified to a
        // quarter-pixel grid at this frame. Use that same fidelity envelope
        // when matching the two sides of an ownership boundary; a tiny exact
        // epsilon would strand one side after legitimate simplification.
        const tol = Math.max(1e-7, 0.3 / Math.max(this.cfg.base, 1e-9));
        const directions = [[0, 0], [1, -1], [1, 0], [1, 1], [0, 1]];
        for (const [key, refs] of buckets) {
            const [i, j] = key.split(",").map(Number);
            for (const [di, dj] of directions) {
                const others = buckets.get(`${i + di},${j + dj}`);
                if (!others) continue;
                for (let ai = 0; ai < refs.length; ai++) {
                    const a = refs[ai];
                    for (let bi = 0; bi < others.length; bi++) {
                        const b = others[bi];
                        if (a.itemIndex === b.itemIndex) continue;
                        if (di === 0 && dj === 0 && bi <= ai) continue;
                        const aiItem = items[a.itemIndex], biItem = items[b.itemIndex];
                        // Two components already proved separate inside the
                        // SAME child must not be rejoined merely because their
                        // coarse parent proxies overlap after simplification.
                        // They may still join through a real parent-remainder
                        // item, which is the only globally meaningful route.
                        if (aiItem.kind === "child" && biItem.kind === "child" &&
                            aiItem.childRec.obj.id === biItem.childRec.obj.id) continue;
                        if (!boxesMeet(a.geom.box, b.geom.box, tol)) continue;
                        if (ringsTouchRings(a.geom.polys, b.geom.polys, tol)) {
                            union(a.itemIndex, b.itemIndex);
                        }
                    }
                }
            }
        }

        const groups = new Map();
        items.forEach((item, index) => {
            const root = find(index);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(item);
        });
        const outputs = [];
        for (const group of groups.values()) {
            const byCell = new Map();
            for (const item of group) for (const geom of item.geoms) {
                const key = `${geom.i},${geom.j}`;
                if (!byCell.has(key)) byCell.set(key, { core: geom.core, rings: [] });
                for (const ring of geom.renderPolys || geom.polys) byCell.get(key).rings.push(ring);
            }
            const currentDrafts = [];
            const proxyGeoms = [];
            for (const [key, cell] of byCell) {
                const [i, j] = key.split(",").map(Number);
                const renderRect = {
                    left: cell.core.left - this._eraseTileGuard(),
                    top: cell.core.top - this._eraseTileGuard(),
                    right: cell.core.right + this._eraseTileGuard(),
                    bottom: cell.core.bottom + this._eraseTileGuard(),
                };
                const clipped = clipRingsToRect(cell.rings, renderRect);
                const regions = this._normalizeTile(clipped, { core: cell.core }, localE);
                for (const polys of regions) {
                    const canonical = clipRingsToRect(polys, cell.core);
                    if (!canonical.length || netRingsArea(canonical) <= 1e-12) continue;
                    const draft = {
                        token: `eh-${scan.draftSeq++}`,
                        oldId: rec.obj.id, level: rec.level, polys,
                        cell: { frame: String(rec.level), i, j },
                        attachRect: {
                            x0: cell.core.left, y0: cell.core.top,
                            x1: cell.core.right, y1: cell.core.bottom,
                        },
                        windows: [],
                        style: rec.obj,
                    };
                    currentDrafts.push(draft);
                    proxyGeoms.push({
                        i, j, core: cell.core, polys,
                        renderPolys: polys, box: ringsBox(canonical),
                    });
                }
            }
            // Preserve a topology-only proxy even when parent-level
            // simplification legitimately makes a sub-pixel child invisible.
            if (!proxyGeoms.length) {
                for (const item of group) for (const geom of item.geoms) proxyGeoms.push(geom);
            }

            const childItems = group.filter((item) => item.kind === "child");
            for (const child of childItems) {
                if (!child.window) continue;
                const wb = rectAsBox(child.window);
                const candidates = currentDrafts.filter((draft) => {
                    const core = this.lm.tileRect(
                        draft.level, draft.cell.i, draft.cell.j,
                    );
                    return boxesMeet(rectAsBox(core), wb, this._eraseTileGuard());
                });
                for (const draft of candidates) {
                    if (!draft.windows.some((w) =>
                        w.x0 === child.window.x0 && w.y0 === child.window.y0 &&
                        w.x1 === child.window.x1 && w.y1 === child.window.y1)) {
                        draft.windows.push({ ...child.window });
                    }
                }
                const owner = candidates[0] || currentDrafts[0];
                if (owner) {
                    for (const childDraft of child.summary.topDrafts || []) {
                        childDraft.parentToken = owner.token;
                    }
                }
            }
            const drafts = new Set(currentDrafts);
            for (const item of childItems) {
                for (const draft of item.summary.drafts || []) drafts.add(draft);
            }
            outputs.push({
                level: rec.level, ownerOldId: rec.obj.id,
                proxyGeoms, topDrafts: currentDrafts, drafts,
            });
        }
        memo.set(rec.obj.id, outputs);
        return outputs;
    }
    _finishHierarchicalSplit(scan, Erec, target, op, done) {
        const family = scan.family;
        const recById = new Map(family.map((rec) => [rec.obj.id, rec]));
        const childrenById = new Map();
        const roots = [];
        for (const rec of family) {
            if (rec.obj.srcId != null && recById.has(rec.obj.srcId)) {
                if (!childrenById.has(rec.obj.srcId)) childrenById.set(rec.obj.srcId, []);
                childrenById.get(rec.obj.srcId).push(rec);
            } else {
                roots.push(rec);
            }
        }
        const localE = { bakePx: this.cfg.base, lwFrame: Erec.obj.lwFrame };
        const memo = new Map(), visiting = new Set();
        const rootOutputs = [];
        for (const root of roots) {
            for (const output of this._summarizeHierarchyObject(
                root, childrenById, recById, scan, memo, visiting, localE,
            )) rootOutputs.push(output);
        }
        if (!rootOutputs.length) {
            const step = this.doc.eraseMaterializeFamily(
                family.map((rec) => rec.obj.id), Erec.level, [], target.obj,
            );
            if (!step) return false;
            for (const rec of step.removedMany) done.add(rec.obj.id);
            op.baked.push(step);
            return true;
        }

        // Multiple historical roots can still represent one logical family.
        // Merge only when their compact root proxies actually touch; tiles and
        // storage ancestry never manufacture user-visible object identity.
        const parent = rootOutputs.map((_, i) => i);
        const find = (i) => {
            while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        };
        const union = (a, b) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent[rb] = ra;
        };
        const tol = Math.max(1e-7, 0.3 / Math.max(this.cfg.base, 1e-9));
        for (let i = 0; i < rootOutputs.length; i++) {
            for (let j = i + 1; j < rootOutputs.length; j++) {
                // Outputs from one physical root were separated by the complete
                // recursive summary above. A coarse proxy overlap cannot
                // overrule that result.
                if (rootOutputs[i].ownerOldId === rootOutputs[j].ownerOldId) continue;
                if (String(rootOutputs[i].level) !== String(rootOutputs[j].level)) continue;
                let touches = false;
                for (const a of rootOutputs[i].proxyGeoms) {
                    for (const b of rootOutputs[j].proxyGeoms) {
                        if (!boxesMeet(a.box || ringsBox(a.polys), b.box || ringsBox(b.polys), tol)) continue;
                        if (ringsTouchRings(a.polys, b.polys, tol)) { touches = true; break; }
                    }
                    if (touches) break;
                }
                if (touches) union(i, j);
            }
        }
        const components = new Map();
        rootOutputs.forEach((output, index) => {
            const root = find(index);
            if (!components.has(root)) components.set(root, new Set());
            for (const draft of output.drafts) components.get(root).add(draft);
        });
        if (components.size <= 1) return false;

        const specs = [];
        for (const drafts of components.values()) {
            const logicalId = this.doc.allocId();
            for (const draft of drafts) {
                specs.push({
                    token: draft.token, parentToken: draft.parentToken,
                    level: draft.level, polys: draft.polys,
                    logicalId, cell: draft.cell, attachRect: draft.attachRect,
                    windows: draft.windows, style: draft.style,
                });
            }
        }
        const step = this.doc.eraseMaterializeFamily(
            family.map((rec) => rec.obj.id), Erec.level, specs, target.obj,
        );
        if (!step) return false;
        for (const rec of step.removedMany) done.add(rec.obj.id);
        // The materialization rebuilt the WHOLE hierarchy, while `actions`
        // may have erased only one covered physical cell. Do not blanket-mark
        // every rebuilt piece as net of this gesture: the scheduler must visit
        // the remaining child cells that the same eraser footprint covers.
        op.baked.push(step);
        return true;
    }
    _materializeHierarchicalSplit(op, Erec, target, done, actions) {
        const E = Erec.obj;
        const logicalKey = this.doc.editKey(target.obj);
        const family = this.doc.editGroup(logicalKey);
        if (!family.length) return false;
        let byFamily = this._eraseSplitScans.get(E.id);
        if (!byFamily) {
            byFamily = new Map();
            this._eraseSplitScans.set(E.id, byFamily);
        }
        const scanKey = `hier:${logicalKey}`;
        const actionSig = (actions || []).map((a) =>
            `${a.tile.i},${a.tile.j}:${a.specs.length}`).sort().join("|");
        const signature = `${family.map((r) => r.obj.id).sort((a, b) => a - b).join(",")};${actionSig}`;
        let scan = byFamily.get(scanKey);
        if (!scan || scan.signature !== signature) {
            scan = this._startHierarchicalSplitScan(Erec, target, family, actions, signature);
            byFamily.set(scanKey, scan);
        }
        if (!this._collectHierarchicalSplit(scan, E)) return ERASE_PENDING;
        byFamily.delete(scanKey);
        if (!byFamily.size) this._eraseSplitScans.delete(E.id);
        return this._finishHierarchicalSplit(scan, Erec, target, op, done);
    }
    _windowForSource(core, o, HO, HE, E) {
        let baseCore = core;
        if (o.placements && o.placements.length) {
            const plain = this.lm.mapPointPlacedF([0, 0], HO, HE, []);
            const placed = this.lm.mapPointPlacedF([0, 0], HO, HE, o.placements);
            if (!plain || !placed) return null;
            const dx = placed[0] - plain[0], dy = placed[1] - plain[1];
            baseCore = {
                left: core.left - dx, top: core.top - dy,
                right: core.right - dx, bottom: core.bottom - dy,
            };
        }
        const r = this.lm.mapRectPlacedF(baseCore, HE, HO, []);
        if (!r) return null;
        return {
            x0: r.left, y0: r.top, x1: r.right, y1: r.bottom,
        };
    }
    // Persist one ordinary Kobin edge of ownership on the way to a much deeper
    // erase. A root-to-level-15 window would be too tiny to summarize in the
    // root's Number coordinates and would make final connectivity scan
    // 3000^15 render cells. Relaying one edge at a time keeps every window and
    // every topology decision tile-local. These child pieces are NOT net of
    // the eraser yet, so the scheduler intentionally processes them next.
    _rehomeTowardErase(op, Erec, target) {
        const E = Erec.obj, HE = Erec.level;
        const { obj: o, level: HO } = target;
        const path = this.lm.framePath(HO, HE);
        if (!path || path.down.length <= 1) return null;
        const childFrame = path.down[0];
        const placementPlan = o.placements && o.placements.length
            ? this.store._placedUpPlan(o, HO, childFrame) : null;
        const deferredPlacements = placementPlan ? placementPlan.deferred : [];
        const localEraser = this.lm.projectF(E, HE, childFrame);
        if (!localEraser) return false;
        localEraser.bakePx = this.cfg.base;
        const actions = [];
        for (const tile of this._eraseTiles(localEraser, childFrame)) {
            const subject = this._tileSubjectRings(o, HO, childFrame, tile, localEraser);
            if (!subject.length) continue;
            const regions = this._normalizeTile(subject, tile, localEraser);
            if (!regions.length) continue;
            const window = this._windowForSource(tile.core, o, HO, childFrame, localEraser);
            if (!window) continue;
            actions.push({
                window,
                attachRect: {
                    x0: tile.core.left, y0: tile.core.top,
                    x1: tile.core.right, y1: tile.core.bottom,
                },
                specs: regions.map((polys) => ({
                    polys,
                    attached: true, // a storage relay never changes identity
                    cell: { frame: String(childFrame), i: tile.i, j: tile.j },
                })),
            });
        }
        let changed = false;
        for (const action of actions) {
            const step = this.doc.eraseRehomeById(
                o.id, childFrame, action.specs, action.window, action.attachRect,
                { inheritPlacement: false, placements: deferredPlacements },
            );
            if (!step) continue;
            op.baked.push(step);
            changed = true;
        }
        return changed;
    }
    _bakeTiled(op, Erec, target, done) {
        const E = Erec.obj, HE = Erec.level;
        const { obj: o, level: HO } = target;
        const actions = [];
        for (const tile of this._eraseTiles(E, HE, target)) {
            const subject = this._tileSubjectRings(o, HO, HE, tile, E);
            if (!subject.length) continue;
            const regions = this._subtractTile(subject, this._eraseTileMask(E, HE, tile), tile, E);
            if (!regions) continue;
            const window = this._windowForSource(tile.core, o, HO, HE, E);
            if (!window) continue;
            const tol = Math.max(1 / Math.max(E.bakePx || 1, 1e-9), 1e-9);
            const specs = [];
            const subjectReachesBoundary = ringsReachRectBoundary(subject, tile.core, tol);
            for (const polys of regions) {
                // Overscan-only remnants are derivation guards, not owned ink.
                if (netRingsArea(clipRingsToRect(polys, tile.core)) <= 1e-12) continue;
                specs.push({
                    polys,
                    attached: ringsReachRectBoundary(polys, tile.core, tol),
                    cell: { frame: String(HE), i: tile.i, j: tile.j },
                });
            }
            actions.push({
                tile, window, specs, subject, subjectReachesBoundary,
                attachRect: {
                    x0: tile.core.left, y0: tile.core.top,
                    x1: tile.core.right, y1: tile.core.bottom,
                },
            });
        }
        const surviving = actions.flatMap((a) => a.specs);
        // A source wholly enclosed by the edited cell and still connected after
        // subtraction remains the same logical object. If several enclosed
        // regions survive, the erase is a true global split and each keeps the
        // fresh physical/logical id assigned by Document.
        if (surviving.length === 1 && !actions.some((a) => a.subjectReachesBoundary)) {
            surviving[0].attached = true;
        }
        // More than one touched tile, zero survivors, or several local regions
        // can all split ink outside the edited cell. Resolve the complete
        // family graph before committing any windows. This is also what
        // prevents an entirely ceded source from lingering as a selectable
        // phantom object.
        const topologyTolerance = Math.max(0.5 / Math.max(E.bakePx || 1, 1e-9), 1e-9);
        const needsConnectivity = localCutNeedsGlobalScan(actions, topologyTolerance);
        if (needsConnectivity) {
            const topology = this._materializeHierarchicalSplit(
                op, Erec, target, done, actions,
            );
            if (topology === ERASE_PENDING || topology === true) return topology;
        }
        let changed = false;
        // Calculate all adjacent cells against the same pre-mutation source,
        // then commit. A window added for tile A must not clip tile B's guard
        // while the same gesture is still deriving it.
        for (const action of actions) {
            const step = this.doc.eraseRehomeById(
                o.id, HE, action.specs, action.window, action.attachRect,
                { inheritPlacement: false },
            );
            if (!step) continue;
            for (const pc of step.pieces) done.add(pc.obj.id);
            op.baked.push(step);
            changed = true;
        }
        return changed;
    }
    _bakeCell(op, Erec, target, done, checkTopology = false) {
        const E = Erec.obj, o = target.obj;
        const source = o.placements && o.placements.length
            ? this.lm.projectPlacedF(o, target.level, target.level) : o;
        if (!source) return false;
        const b = bboxOf(source, null);
        const pad = E.lwFrame + this._eraseTileGuard();
        const rect = {
            left: b.x0 - pad, top: b.y0 - pad,
            right: b.x1 + pad, bottom: b.y1 + pad,
        };
        const subject = source.type === "fill"
            ? source.polys
            : this._strokeRingsInRect(source, rect, E.bakePx || this.cfg.base);
        const mask = this._strokeRingsInRect(E, rect, E.bakePx || this.cfg.base);
        const tile = { core: rect };
        const regions = this._subtractTile(subject, mask, tile, E);
        if (!regions) return false;
        if (checkTopology && localCutNeedsGlobalScan([{
            tile, subject, specs: regions.map((polys) => ({ polys })),
        }], Math.max(0.5 / Math.max(E.bakePx || 1, 1e-9), 1e-9))) {
            const range = this.lm.tileRange(target.level, {
                left: b.x0, top: b.y0, right: b.x1, bottom: b.y1,
            });
            const actions = [];
            for (let i = range.i0; i <= range.i1; i++) {
                for (let j = range.j0; j <= range.j1; j++) {
                    const core = this.lm.tileRect(target.level, i, j);
                    const guardRect = {
                        left: core.left - this._eraseTileGuard(),
                        top: core.top - this._eraseTileGuard(),
                        right: core.right + this._eraseTileGuard(),
                        bottom: core.bottom + this._eraseTileGuard(),
                    };
                    const cellSubject = clipRingsToRect(subject, guardRect);
                    if (!cellSubject.length) continue;
                    const specs = [];
                    for (const region of regions) {
                        const polys = clipRingsToRect(region, guardRect);
                        if (polys.length && netRingsArea(clipRingsToRect(polys, core)) > 1e-12) {
                            specs.push({ polys });
                        }
                    }
                    actions.push({ tile: { i, j, core }, subject: cellSubject, specs });
                }
            }
            const topology = this._materializeHierarchicalSplit(
                op, Erec, target, done, actions,
            );
            if (topology === ERASE_PENDING || topology === true) return topology;
        }
        let bakedStep;
        if (regions.length) {
            let storedRegions = regions;
            if (o.placements && o.placements.length) {
                const inverse = o.placements.map((p) => ({
                    ...p, dx: -(p.dx || 0), dy: -(p.dy || 0),
                }));
                storedRegions = regions.map((region) => region.map((ring) => ring.map((p) =>
                    this.lm.mapPointPlacedF(p, target.level, target.level, inverse),
                )));
                if (storedRegions.some((region) =>
                    region.some((ring) => ring.some((p) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))))) {
                    return false;
                }
            }
            const cut = this.doc.eraseReplaceById(o.id, storedRegions);
            if (!cut) return false;
            bakedStep = {
                removed: cut.removed,
                pieces: cut.pieces.map((obj) => ({ obj, level: cut.removed.level })),
            };
            for (const pc of bakedStep.pieces) done.add(pc.obj.id);
        } else {
            const rec = this.doc.removeById(o.id);
            if (!rec) return false;
            bakedStep = { removed: rec, pieces: [] };
        }
        op.baked.push(bakedStep);
        return true;
    }
    _fitsOneEraseTile(o, HE) {
        const b = bboxOf(o, null);
        const half = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        const range = this.lm.tileRange(HE, {
            left: b.x0 - half, top: b.y0 - half,
            right: b.x1 + half, bottom: b.y1 + half,
        });
        return range.i0 === range.i1 && range.j0 === range.j1;
    }
    _eraserInFrame(E, HE, targetFrame) {
        if (String(HE) === String(targetFrame)) return E;
        const f = this.lm.frameFactor(HE, targetFrame);
        if (!(f > 0)) return null;
        const projected = this.lm.projectF(E, HE, targetFrame);
        if (!projected) return null;
        // Affine projection preserves the original spline. `projectF` normally
        // labels projected render pieces as derived polylines, but an eraser
        // projected into an existing child cell must retain curve semantics.
        projected.origin = "native";
        projected.curved = true;
        projected.erase = true;
        // A coarse-view gesture can project to less than one pixel per whole
        // child cell unit. Using that coarse display scale as the boolean
        // simplifier would legally clean away fine canonical child ink before
        // the user zoomed back in. Every persistent cell gets at least the
        // ordinary Kobin tile-entry fidelity; a genuinely finer erase keeps
        // its higher erase-time fidelity.
        projected.bakePx = Math.max(
            this.cfg.base,
            (E.bakePx || this.cfg.base) / f,
        );
        return projected;
    }
    // Subtract eraser stroke E's painted footprint from one object, silently
    // (the doc changes ride E's eraseCommit undo op, not ops of their own).
    _bakeOne(Erec, target) {
        const gesture = Erec.obj, gestureFrame = Erec.level;
        const { obj: o, level: HO } = target;
        const done = this._doneSet(gesture.id);
        if (!this.doc.getById(o.id)) { done.add(o.id); return false; }
        // Resolve the gesture's undo op BEFORE touching the document — a bake
        // that cannot record itself must not mutate anything (unrecorded
        // bakes were how duplicated, stacked geometry formed). After a reload
        // the commit map is empty, so resumed baking re-registers a fresh op,
        // which also makes a resumed erase undoable again.
        let op = this._eraseCommits.get(gesture.id);
        if (!op || op.op !== "eraseCommit") {
            op = { op: "eraseCommit", strokeId: gesture.id, strokeRec: null, baked: [] };
            this.doc.pushUndo(op);
            this._eraseCommits.set(gesture.id, op);
        }
        // If this gesture covers an already-existing child/sibling cell, bake
        // in that cell's own bounded frame. Re-homing it back upward would
        // invert the ownership hierarchy and leave the real child ink uncut.
        let workRec = Erec;
        if (String(HO) !== String(gestureFrame) &&
            !this.lm.isAncestor(HO, gestureFrame)) {
            const projected = this._eraserInFrame(gesture, gestureFrame, HO);
            if (!projected) { done.add(o.id); return false; }
            workRec = { obj: projected, level: HO };
        }
        const E = workRec.obj, HE = workRec.level;
        // A target homed SHALLOWER than the erase re-homes instead of baking:
        // projecting the eraser down into its frame shrinks the footprint by
        // ~3000 per level, far below anything the boolean's integer grid can
        // hold, which is what made small erases on magnified objects blocky.
        let result;
        const relay = this._rehomeTowardErase(op, workRec, target);
        if (relay != null) {
            result = relay;
        } else if (HO === HE && o.eraseCell && String(o.eraseCell.frame) === String(HE)) {
            // This is already the canonical cell for this tile. Rewrite it;
            // nesting another same-frame ownership window would grow one layer
            // per gesture and eventually recreate the old box/seam failures.
            result = this._bakeCell(op, workRec, target, done, true);
        } else if (HO === HE && this._fitsOneEraseTile(o, HE) &&
            (!o.placements || !o.placements.length) &&
            (!o.windows || !o.windows.length)) {
            result = this._bakeCell(op, workRec, target, done);
        } else {
            result = this._bakeTiled(op, workRec, target, done);
        }
        if (result !== ERASE_PENDING) done.add(o.id);
        return result;
        /*
        const Ep = this.lm.projectF(E, HE, HO);
        if (!Ep) return false;
        // Outline fidelity anchors to the ERASE-TIME zoom, capped so a giant
        // magnified stroke can't explode the flatten (the "few seconds per
        // bite" failure of the synchronous eraser).
        const fScr = (E.bakePx || 1) * (this.lm.frameFactor(HO, HE) || 1); // erase-time px per HO unit
        const spanOf = (obj) => { const b = bboxOf(obj, null); return Math.hypot(b.x1 - b.x0, b.y1 - b.y0) || 1; };
        const dsClip = Math.max(1e-9, Math.min(fScr, 25000 / spanOf(Ep)));
        const dsSubj = Math.max(1e-9, Math.min(fScr, 25000 / spanOf(o)));
        const clip = strokeOutline(Ep.pts, Ep.lwFrame, { curved: Ep.pts.length > 2, displayScale: dsClip });
        if (!clip.length) return false;
        const subject = o.type === "fill"
            ? o.polys
            : strokeOutline(o.pts, o.lwFrame, { curved: o.origin === "native" && o.pts.length > 2, displayScale: dsSubj });
        if (!subject.length) return false;
        const regions = subtractPolys(subject, clip);
        let bakedStep;
        if (regions.length) {
            // Grazing pass: (practically) no ink removed — leave it alone.
            const kept = regions.reduce((s, rings) => s + netRingsArea(rings), 0);
            const rE = Ep.lwFrame / 2;
            if (netRingsArea(subject) - kept < 1e-4 * rE * rE) return false;
            const cut = this.doc.eraseReplaceById(o.id, regions);
            if (!cut) return false;
            bakedStep = { removed: cut.removed, pieces: cut.pieces.map((obj) => ({ obj, level: cut.removed.level })) };
            for (const pc of bakedStep.pieces) done.add(pc.obj.id); // results are already net of E
        } else {
            const rec = this.doc.removeById(o.id); // nothing survives
            if (!rec) return false;
            bakedStep = { removed: rec, pieces: [] };
        }
        op.baked.push(bakedStep); // op resolved above — every bake is recorded
        return true;
        */
    }
    // Re-homing bake: cut the hole at the level the user drew it at.
    //
    // Everything happens in the ERASER's frame, where the eraser is a few dozen
    // pixels and the window around it is screen-sized, so the boolean's integer
    // grid is thousands of times finer than a pixel no matter how astronomically
    // magnified the target is. The target itself is not modified — it only
    // records the rect it has ceded (see derive.js "windows"), and the ink that
    // survives inside that rect becomes natives of the eraser's level.
    _bakeRehome(op, Erec, target, done) {
        const E = Erec.obj, HE = Erec.level;
        const { obj: o, level: HO } = target;
        const rE = E.lwFrame / 2;
        // Window = the eraser's painted footprint, with a radius of margin so
        // the children keep a little context around the cut.
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of E.pts) {
            if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        }
        if (!(x0 <= x1)) return false;
        const W = { left: x0 - 2 * rE, top: y0 - 2 * rE, right: x1 + 2 * rE, bottom: y1 + 2 * rE };
        const d = this.lm.projectF(o, HO, HE);
        if (!d) return false;
        // The target's ink inside the window, in eraser-frame coords. The clip
        // is float Sutherland-Hodgman, so pulling a screen-sized piece out of a
        // giant costs nothing in precision.
        const cx = (W.left + W.right) / 2, cy = (W.top + W.bottom) / 2;
        // Ink this object has ALREADY ceded to deeper children is not ours to
        // re-home — re-cutting it here would resurrect ink a finer erase had
        // removed. (Reachable by erasing deep, zooming out a level, erasing the
        // same object again.) Same guillotine the derive path uses.
        const prior = [];
        for (const w of o.windows || []) {
            const r = this.lm.mapRectF({ left: w.x0, top: w.y0, right: w.x1, bottom: w.y1 }, HO, HE);
            if (r && r.right > W.left && r.left < W.right && r.bottom > W.top && r.top < W.bottom) {
                prior.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
            }
        }
        const parts = prior.length ? rectSubtract(W, prior) : [W];
        if (!parts.length) return false; // wholly owned by deeper children already
        let subject;
        if (d.type === "fill") {
            subject = clipRingsToRect(d.polys, W);
        } else {
            // A stroke magnified this far has an astronomically long centerline;
            // window it and use the analytic strip, exactly as deriveStep's
            // "mega" tier does — exact inside the window, which is all we need.
            const lw = d.lwFrame, half = lw / 2;
            const diag = Math.hypot(W.right - W.left, W.bottom - W.top);
            const ew = { left: W.left - half, top: W.top - half, right: W.right + half, bottom: W.bottom + half };
            const lrect = { left: W.left - cx, top: W.top - cy, right: W.right - cx, bottom: W.bottom - cy };
            const curved = o.origin === "native" && d.pts.length > 2;
            const cpts = curved
                ? flattenCurveNear(d.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base, W, Math.max(0, half - diag), half + diag)
                : d.pts;
            const eq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
            subject = [];
            for (const run of clipPolylineToRect(cpts, ew)) {
                if (!run.length) continue;
                const strip = clipRingsToRect(
                    strokeStripNear(run.map(([x, y]) => [x - cx, y - cy]), lw, lrect,
                        { startCap: eq(run[0], cpts[0]), endCap: eq(run[run.length - 1], cpts[cpts.length - 1]) }),
                    lrect);
                for (const p of strip) subject.push(p.map(([x, y]) => [x + cx, y + cy]));
            }
        }
        if (prior.length) {
            const kept = [];
            for (const rg of parts) for (const p of clipRingsToRect(subject, rg)) kept.push(p);
            subject = kept;
        }
        if (!subject.length) return false; // window holds none of this object's ink
        // Translate BEFORE outlining the eraser as well as before the boolean.
        // strokeOutline uses the same magnitude-limited integer backend: at a
        // far local-frame coordinate it can otherwise round a screen-sized
        // eraser below one integer unit and return no polygon at all. Keeping
        // every operation local also makes the grazing area test numerically
        // stable (shoelace areas at 1e9 coordinates lose small differences).
        const off = (rings) => rings.map((r) => r.map(([x, y]) => [x - cx, y - cy]));
        const back = (rings) => rings.map(([x, y]) => [x + cx, y + cy]);
        const subjectLocal = off(subject);
        const eraseLocal = E.pts.map(([x, y]) => [x - cx, y - cy]);
        const clipLocal = strokeOutline(eraseLocal, E.lwFrame,
            { curved: E.pts.length > 2, displayScale: E.bakePx || 1 });
        if (!clipLocal.length) return false;
        const localRegions = subtractPolys(subjectLocal, clipLocal);
        // Grazing pass: (practically) no ink removed — leave the object alone.
        const kept = localRegions.reduce((s, rings) => s + netRingsArea(rings), 0);
        if (netRingsArea(subjectLocal) - kept < 1e-4 * rE * rE) return false;
        const regions = localRegions.map((rg) => rg.map(back));
        const wHO = this.lm.mapRectF(W, HE, HO);
        if (!wHO) return false;
        // subtractPolys rounds to a 0.001-unit grid. Treat contact within that
        // grid — or a quarter erase-time pixel, whichever is larger — as real
        // boundary contact. Otherwise a quantized corner can land microscopically
        // outside W on both axes and an attached patch becomes a loose offshoot.
        const attachTol = Math.max(1.1e-3, 0.25 / (E.bakePx || 1));
        const specs = regions.map((polys) => ({ polys, attached: regionTouchesWindow(polys, W, attachTol) }));
        const step = this.doc.eraseRehomeById(o.id, HE, specs,
            { x0: wHO.left, y0: wHO.top, x1: wHO.right, y1: wHO.bottom },
            { x0: W.left, y0: W.top, x1: W.right, y1: W.bottom });
        if (!step) return false;
        for (const pc of step.pieces) done.add(pc.obj.id); // already net of E
        op.baked.push(step);
        return true;
    }
    _consumeErase(Erec) {
        const id = Erec && Erec.obj && Erec.obj.id;
        if (id == null) return;
        this.doc.removeById(id);
        this._eraseCommits.delete(id);
        this._bakeDone.delete(id);
        this._eraseTileMasks.delete(id);
        this._eraseSplitScans.delete(id);
    }
    _flushEraseGesture(Erec) {
        const t0 = perfNow();
        let changed = false;
        let steps = 0;
        const priorSync = this._syncEraseFlush;
        this._syncEraseFlush = true;
        try {
            for (let guard = 0; guard < 10000; guard++) {
                const live = this.doc.getById(Erec.obj.id);
                if (!live) break;
                const target = this._nextEraseTarget({ obj: live.obj, level: live.level });
                if (!target) {
                    this._consumeErase({ obj: live.obj, level: live.level });
                    break;
                }
                steps++;
                changed = this._bakeOne({ obj: live.obj, level: live.level }, target) === true || changed;
            }
        } finally {
            this._syncEraseFlush = priorSync;
        }
        this._perf("eraseFlush", t0, true, {
            gesture: Erec.obj.id, steps,
        });
        return changed;
    }
    _gestureMayTouchKeys(Erec, keys) {
        for (const key of keys) {
            for (const rec of this.doc.editGroup(key)) {
                if (this._zOf(Erec.obj) <= this._zOf(rec.obj)) continue;
                if (this._doneSet(Erec.obj.id).has(rec.obj.id)) continue;
                if (this._eraseMayTouch(Erec.obj, Erec.level, rec.obj, rec.level)) return true;
            }
        }
        return false;
    }
    // Selection is the synchronous barrier promised by the deferred eraser.
    // If a pending gesture affects a logical object, finish that WHOLE gesture
    // (all objects under it), not merely the physical fragment that was hit.
    // Earlier gestures complete first so a later gesture cannot skip their
    // replacement pieces.
    _flushErasesForKeys(keys) {
        const wanted = new Set((keys || []).filter((k) => k != null));
        if (!wanted.size) return false;
        const strokes = this._eraseStrokes();
        let last = -1;
        for (let i = 0; i < strokes.length; i++) {
            if (this._gestureMayTouchKeys(strokes[i], wanted)) last = i;
        }
        if (last < 0) return false;
        let changed = false;
        for (let i = 0; i <= last; i++) changed = this._flushEraseGesture(strokes[i]) || changed;
        return changed;
    }
    _flushErasesFor(id) {
        const rec = this.doc.getById(id);
        if (!rec || rec.obj.erase) return false;
        return this._flushErasesForKeys([this.doc.editKey(rec.obj)]);
    }
    /** Bake every pending eraser stroke to completion (tests, power tools). */
    flushErases() {
        const t0 = perfNow();
        let guard = 0;
        let steps = 0;
        while (guard++ < 10000) {
            const strokes = this._eraseStrokes();
            if (!strokes.length) break;
            const Erec = strokes[0];
            const target = this._nextEraseTarget(Erec);
            if (target) { steps++; this._bakeOne(Erec, target); continue; }
            this._consumeErase(Erec);
        }
        this._render();
        this._perf("eraseFlushAll", t0, true, { steps, iterations: guard - 1 });
    }

    // ---- selection / edit ----
    _syncSelection() {
        if (!this._selected.size) {
            this.selection = null; this._selectionPrimary = null; this._activeRestyle = null;
            return;
        }
        if (!this._selected.has(this._selectionPrimary)) {
            this._selectionPrimary = [...this._selected.keys()].pop();
        }
        const rec = this._selected.get(this._selectionPrimary);
        this.selection = {
            ...rec, count: this._selected.size, keys: [...this._selected.keys()],
        };
    }
    _selectRecord(rec) {
        if (!rec) return null;
        const editId = this.doc.editKey(rec.obj);
        const selected = { id: rec.obj.id, editId, level: rec.level, obj: rec.obj };
        this._selected.set(editId, selected);
        this._selectionPrimary = editId;
        return selected;
    }
    // Resolve pending erase work before a click is allowed to choose its final
    // object. Baking can split/delete the hit, hence the re-hit loop.
    _resolvedHit(sx, sy) {
        for (let guard = 0; guard < 16; guard++) {
            const id = this._hitTest(sx, sy);
            if (id == null) return null;
            if (this._flushErasesFor(id)) { this._render(); continue; }
            return this.doc.getById(id) ? id : null;
        }
        return null;
    }
    select(sx, sy, { toggle = false } = {}) {
        const id = this._resolvedHit(sx, sy);
        if (id == null) {
            if (!toggle) this.deselect();
            return null;
        }
        const rec = this.doc.getById(id);
        if (!rec) { if (!toggle) this.deselect(); return null; }
        const key = this.doc.editKey(rec.obj);
        this._activeRestyle = null;
        if (toggle && this._selected.has(key)) {
            this._selected.delete(key);
            if (this._selectionPrimary === key) this._selectionPrimary = null;
        } else {
            if (!toggle) this._selected.clear();
            this._selectRecord(rec);
        }
        this._syncSelection();
        this.renderer.syncCameraOnly(); this.renderer.update(); this._emit();
        return id;
    }
    deselect() {
        if (!this.selection && !this._selected.size) return;
        this._selected.clear(); this.selection = null; this._selectionPrimary = null;
        this._activeRestyle = null; this._dragSel = null;
        this.renderer.syncCameraOnly(); this.renderer.update(); this._emit();
    }
    _selectionRectForKey(key) {
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const o of this._lastList) {
            const rec = this.doc.getById(o.id);
            if (!rec || this.doc.editKey(rec.obj) !== key) continue;
            const b = bboxOf(o, this.store.live);
            const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
            left = Math.min(left, b.x0 - m); top = Math.min(top, b.y0 - m);
            right = Math.max(right, b.x1 + m); bottom = Math.max(bottom, b.y1 + m);
        }
        if (left !== Infinity) return { level: this.cam.frame, rect: { left, top, right, bottom } };
        const selected = this._selected.get(key);
        if (!selected) return null;
        const o = selected.obj;
        const d = o.placements && o.placements.length
            ? this.lm.projectPlacedF(o, selected.level, this.cam.frame)
            : this.lm.projectF(o, selected.level, this.cam.frame);
        if (!d) return null;
        const b = bboxOf(d, this.store.live), m = d.type === "fill" ? 0 : (d.lwFrame || 0) / 2;
        return { level: this.cam.frame, rect: { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m } };
    }
    _selectionOverlay() {
        const d = this._dragSel;
        let rects = [...this._selected.keys()].map((key) => this._selectionRectForKey(key)).filter(Boolean);
        if (d && d.mode === "move" && (d.dx || d.dy)) {
            rects = rects.map(({ level, rect }) => ({
                level,
                rect: {
                    left: rect.left + d.dx, top: rect.top + d.dy,
                    right: rect.right + d.dx, bottom: rect.bottom + d.dy,
                },
            }));
        }
        const lasso = d && d.mode === "lasso" ? { points: d.points, closed: false } : null;
        if (!rects.length && !lasso) return null;
        return { rects, lasso };
    }
    _selectedRecords() {
        const out = [], seen = new Set();
        for (const key of this._selected.keys()) {
            for (const rec of this.doc.editGroup(key)) {
                if (seen.has(rec.obj.id)) continue;
                seen.add(rec.obj.id); out.push(rec);
            }
        }
        return out;
    }
    _dragSelection(sx, sy) {
        const t0 = perfNow();
        const d = this._dragSel;
        const ddx = (sx - d.last[0]) / this.cam.inScale;
        const ddy = (sy - d.last[1]) / this.cam.inScale;
        d.last = [sx, sy];
        if (!ddx && !ddy) return;
        const records = d.records || (d.records = this._selectedRecords());
        if (!records.length) return;
        if (d.usePlacement == null) {
            const activeDepth = this.lm.depthOf(this.cam.frame);
            d.usePlacement = records.length > 1 || this._selected.size > 1 ||
                records.some((r) => r.obj.placements && r.obj.placements.length) ||
                records.some((r) => Math.abs(this.lm.depthOf(r.level) - activeDepth) > 3);
            d.ids = records.map((r) => r.obj.id);
        }
        d.dx += ddx; d.dy += ddy; d.moved = true;
        // Pointer-rate work is now just one transform per visible logical
        // group. Canonical geometry, indexes, tiles, and placement records are
        // touched once on pointer-up.
        this.renderer.setDragPreview([...this._selected.keys()], d.dx, d.dy);
        this.renderer.update();
        this._emit();
        this._perf("movePreview", t0, false, { n: records.length });
    }
    _logicalKeys() {
        const out = [], seen = new Set();
        for (const level of this.doc.levels()) for (const o of this.doc.at(level)) {
            if (o.erase) continue;
            const key = this.doc.editKey(o);
            if (!seen.has(key)) { seen.add(key); out.push(key); }
        }
        return out;
    }
    _lassoCandidates(screenPoints) {
        if (!screenPoints || screenPoints.length < 3) return [];
        const activeLasso = screenPoints.map(([x, y]) => this.cam.screenToFrame(x, y));
        const out = [];
        for (const key of this._logicalKeys()) {
            let rejected = false, sawInk = false;
            for (const rec of this.doc.editGroup(key)) {
                const o = rec.obj;
                // Bring the lasso to the object's bounded home frame instead
                // of minifying a level-15 detail into a sub-ULP root polygon.
                // Inverse placement makes this a test against canonical ink.
                const inverse = (o.placements || []).map((p) => ({
                    ...p, dx: -(p.dx || 0), dy: -(p.dy || 0),
                }));
                const lasso = activeLasso.map((p) =>
                    this.lm.mapPointPlacedF(p, this.cam.frame, rec.level, inverse));
                if (lasso.some((p) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
                    rejected = true; break;
                }
                const xs = lasso.map((p) => p[0]), ys = lasso.map((p) => p[1]);
                const lb = {
                    x0: Math.min(...xs), y0: Math.min(...ys),
                    x1: Math.max(...xs), y1: Math.max(...ys),
                };
                const b = bboxOf(o, this.store.live);
                const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
                if (b.x0 - m < lb.x0 || b.x1 + m > lb.x1 ||
                    b.y0 - m < lb.y0 || b.y1 + m > lb.y1) {
                    rejected = true; break;
                }
                const rings = o.type === "fill"
                    ? o.polys
                    : polygonizeStrokeInTile(o, {
                        left: b.x0 - m, top: b.y0 - m,
                        right: b.x1 + m, bottom: b.y1 + m,
                    }, {
                        cfg: this.cfg,
                        displayScale: this.cfg.enter,
                        curved: o.origin === "native" && o.pts.length > 2,
                    });
                if (!rings.length) { rejected = true; break; }
                const f = Math.abs(this.lm.frameFactor(rec.level, this.cam.frame) || 0);
                const eps = 0.5 / Math.max(1e-300, this.cam.inScale * f);
                if (!ringsFullyInsideLasso(rings, lasso, eps)) {
                    rejected = true; break;
                }
                sawInk = true;
            }
            if (!rejected && sawInk) out.push(key);
        }
        return out;
    }
    _finishLasso(d) {
        const points = decimatePolyline(d.points, 1.25);
        if (points.length < 3) {
            if (!d.ctrl) this.deselect();
            return;
        }
        // Lasso candidates cannot be known safely before baking: an object that
        // currently extends outside the lasso can be split by pending erase ink
        // into a newly bounded component inside it. Lasso release is therefore
        // the same synchronous interaction barrier as a click. Finish pending
        // gestures first, then evaluate final logical objects exactly once.
        if (this._eraseStrokes().length) this.flushErases();
        const keys = this._lassoCandidates(points);
        if (!d.ctrl) {
            this._selected.clear();
            for (const key of keys) {
                const family = this.doc.editGroup(key);
                if (family.length) this._selectRecord(family[0]);
            }
        } else {
            const addsSomething = keys.some((key) => !this._selected.has(key));
            if (addsSomething) {
                for (const key of keys) {
                    const family = this.doc.editGroup(key);
                    if (family.length) this._selectRecord(family[0]);
                }
            } else {
                for (const key of keys) this._selected.delete(key);
            }
        }
        this._syncSelection();
        this.renderer.syncCameraOnly(); this.renderer.update(); this._emit();
    }
    // Restyle the selection. patch: { color?, opacity?, widthPx? } — widthPx is
    // the width ON SCREEN at the current view; it converts through the level
    // chain to the native's frame. A continuous gesture (slider/color drag)
    // coalesces into ONE undo op per selection session.
    restyleSelection(patch) {
        const s = this.selection; if (!s) return false;
        const selectionKey = [...this._selected.keys()].sort().join("|");
        const top = this.doc._undo[this.doc._undo.length - 1];
        const open = this._activeRestyle &&
            this._activeRestyle.selectionKey === selectionKey &&
            top === this._activeRestyle.op;
        const changes = [];
        for (const rec of this._selectedRecords()) {
            const p = { ...patch };
            if (p.widthPx != null) {
                const f = this.lm.frameFactor(rec.level, this.cam.frame);
                if (f != null && f > 0 && rec.obj.type === "stroke") p.lwFrame = Math.max(1e-12, p.widthPx / (f * this.cam.inScale));
                delete p.widthPx;
            }
            const r = this.doc.restyleById(rec.obj.id, p);
            if (r && Object.keys(r.after).length) changes.push({ id: rec.obj.id, before: r.before, after: r.after });
        }
        if (!changes.length) return false;
        if (open) {
            const op = this._activeRestyle.op;
            for (const ch of changes) {
                let dst = op.changes.find((x) => x.id === ch.id);
                if (!dst) { dst = { id: ch.id, before: {}, after: {} }; op.changes.push(dst); }
                for (const k of Object.keys(ch.after)) {
                    if (!(k in dst.before)) dst.before[k] = ch.before[k];
                    dst.after[k] = ch.after[k];
                }
            }
        } else {
            const op = { op: "restyleMany", changes };
            this.doc.pushUndo(op);
            this._activeRestyle = { selectionKey, op };
        }
        this._render();
        return true;
    }
    deleteSelection() {
        if (!this.selection) return false;
        const keys = [...this._selected.keys()];
        if (this._flushErasesForKeys(keys)) this._render();
        const records = [];
        for (const rec of this._selectedRecords()) {
            const removed = this.doc.removeById(rec.obj.id);
            if (removed) records.push(removed);
        }
        if (!records.length) return false;
        this.doc.pushUndo({ op: "eraseMany", records });
        this._selected.clear(); this._syncSelection();
        this._render();
        return true;
    }
    _selectionStatus() {
        const s = this.selection; if (!s) return null;
        const f = this.lm.frameFactor(s.level, this.cam.frame);
        return {
            id: s.id, type: s.obj.type, level: s.level,
            count: this._selected.size,
            keys: [...this._selected.keys()],
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
            let hit = false;
            if (o.type === "fill") hit = windingOfPoint(o.polys, p) !== 0;
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

    // ---- undo / redo / clear ----
    undo() { this._activeRestyle = null; if (!this.doc.undo()) return false; this._scheduleBake(); this._render(); return true; }
    redo() { this._activeRestyle = null; if (!this.doc.redo()) return false; this._scheduleBake(); this._render(); return true; }
    clear() {
        const capture = () => ({ crossings: this.lm.serialize(), camera: this.cam.state() });
        const restore = (ext) => { this.lm.load(ext.crossings); this.cam.set(ext.camera); };
        this.doc.clear(capture(), capture, restore); // reset event clears the tile cache
        this.lm.reset();
        this.cam.set({ frame: "0", activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 });
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
        this._eraseCommits.clear();
        this._bakeDone.clear();
        this._eraseTileMasks.clear();
        this._eraseSplitScans.clear();
        this._scheduleBake(); // resume baking any eraser strokes the file carried
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
    // Scenes speak FRAME KEYS (see scenes.js). Provide the transforms plus the
    // tree adjacency (depthOf / childrenOf) so clustering stitches across frame
    // edges — parent ← each child — instead of depth±1, and sibling frames (far
    // apart by construction) never merge.
    // Canonical scene key for the active frame: the depth int on the spine, the
    // frame id for a local sibling — matching scenes.js `normKey` so provisional
    // and captured scenes reconcile with computed proposals.
    _sceneKey() {
        const f = this.cam.frame;
        const d = this.lm.depthOf(f);
        return String(d) === f ? d : f;
    }
    _sceneProj() {
        return {
            mapRect: (rect, from, to) => this.lm.mapRectF(rect, from, to),
            widthFactor: (from, to) => this.lm.frameFactor(from, to),
            depthOf: (k) => { const d = this.lm.depthOf(k); return d == null ? Number(k) : d; },
            childrenOf: (k, keys) => { const f = this.lm.frameFor(k); const id = f && f.id; return id == null ? [] : keys.filter((x) => this.lm.parentOf(x) === id); },
        };
    }
    // Scenes operate on logical objects, never persistent erase cells. A
    // re-home family normally has one canonical root plus local descendants;
    // that root is sufficient for its global extent. A globally materialized
    // component has several root cells, so combine their projected chunks into
    // one synthetic item carrying the logical id. Placement is resolved by the
    // same expansion-aware projector used by rendering and selection.
    _sceneLogicalState() {
        const natives = {};
        const byId = new Map();
        for (const key of this._logicalKeys()) {
            const family = this.doc.editGroup(key).filter((r) => !r.obj.erase);
            if (!family.length) continue;
            const familyIds = new Set(family.map((r) => r.obj.id));
            let roots = family.filter((r) => r.obj.srcId == null || !familyIds.has(r.obj.srcId));
            if (!roots.length) roots = [family[0]];
            roots.sort((a, b) => this.lm.depthOf(a.level) - this.lm.depthOf(b.level));
            const anchor = roots[0].level;
            const projected = roots.map((r) => {
                const o = r.obj;
                const d = o.placements && o.placements.length
                    ? this.lm.projectPlacedF(o, r.level, anchor)
                    : this.lm.projectF(o, r.level, anchor);
                return d && { o: d, source: o };
            }).filter(Boolean);
            if (!projected.length) continue;

            let synthetic;
            if (projected.length === 1) {
                synthetic = { ...projected[0].o, id: key, paths: [] };
            } else {
                const polys = [];
                for (const { o } of projected) {
                    if (o.type === "fill") {
                        for (const ring of o.polys) polys.push(ring);
                    } else {
                        const b = bboxOf(o, this.store.live);
                        const m = (o.lwFrame || 0) / 2;
                        polys.push([[b.x0 - m, b.y0 - m], [b.x1 + m, b.y0 - m],
                            [b.x1 + m, b.y1 + m], [b.x0 - m, b.y1 + m]]);
                    }
                }
                synthetic = {
                    type: "fill", origin: "native", id: key, polys,
                    color: projected[0].o.color, opacity: projected[0].o.opacity,
                    paths: [],
                };
            }

            const sceneChunks = [];
            const widths = [];
            for (const { o } of projected) {
                const b = bboxOf(o, this.store.live);
                const w = o.type === "stroke"
                    ? Math.max(o.lwFrame || 0, 1e-9)
                    : Math.max(b.x1 - b.x0, b.y1 - b.y0, 1e-9) / WINDOW_WIDTHS;
                widths.push(w);
                if (o.type === "stroke") {
                    for (const c of chunksOf(o)) sceneChunks.push({ ...c });
                } else {
                    sceneChunks.push({
                        x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1,
                        len: 2 * ((b.x1 - b.x0) + (b.y1 - b.y0)) || w,
                    });
                }
            }
            synthetic.sceneWidth = Math.max(...widths);
            synthetic._sceneChunks = sceneChunks;
            synthetic._sceneChunksPts = synthetic.pts;
            synthetic._sceneChunksN = synthetic.pts ? synthetic.pts.length : -1;
            if (!natives[anchor]) natives[anchor] = [];
            natives[anchor].push(synthetic);
            byId.set(key, { o: synthetic, level: anchor });
        }
        return { natives, byId };
    }
    // Frame a rect (in `frameKey`'s coords) in the viewport. `frameKey` is a
    // frame id or a legacy depth int; it must exist in the frame tree. The
    // computed inScale may land outside [exit, enter]; _maybeCross normalizes it
    // through the ordinary crossing machinery.
    jumpTo(frameKey, rect) {
        if (!rect || !(rect.w > 0) || !(rect.h > 0)) return false;
        const f = this.lm.frameFor(frameKey);
        if (!f) return false; // unreachable frame / depth
        if (this._drawing) this.pointerUp();
        const s = Math.min(this.width / rect.w, this.height / rect.h);
        if (!(s > 0) || !Number.isFinite(s)) return false;
        this.cam.set({
            frame: f.id, activeLevel: f.depth, inScale: s,
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
        const logical = this._sceneLogicalState();
        const hashes = {};
        let changed = false;
        for (const Ls of Object.keys(logical.natives)) {
            if (!(logical.natives[Ls] || []).length) continue;
            hashes[Ls] = levelHash(logical.natives, Ls);
            if (!this._levelHashes || this._levelHashes[Ls] !== hashes[Ls]) changed = true;
        }
        if (this._levelHashes) {
            for (const L of Object.keys(this._levelHashes)) if (!(L in hashes)) changed = true;
        }
        if (!changed && this._sceneMembers && !this._scenesProvisional) {
            return this.docMeta.scenes || [];
        }
        const proj = this._sceneProj();
        const proposals = computeSceneProposals(logical.natives, proj);
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
        const F = this._sceneKey();
        const b = bboxOf(o);
        const w = o.lwFrame || 1e-9;
        const rect = { x: b.x0, y: b.y0, w: Math.max(b.x1 - b.x0, w), h: Math.max(b.y1 - b.y0, w) };
        const T = JOIN_WINDOWS * WINDOW_WIDTHS * w;
        for (const s of this.docMeta.scenes || []) {
            if (s.level !== F || s.captured) continue;
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
            id: `s${seq}`, name: `Scene ${seq}`, level: F,
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
        const logical = this._sceneLogicalState();
        const memberObjs = ids && ids.length
            ? ids.map((i) => logical.byId.get(i)).filter(Boolean)
            : [...logical.byId.values()].filter(({ o, level }) => {
                const b = bboxOf(o, this.store.live);
                const r = level === s.level
                    ? { left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }
                    : this.lm.mapRectF({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, level, s.level);
                return r && r.right >= s.rect.x && r.left <= s.rect.x + s.rect.w &&
                    r.bottom >= s.rect.y && r.top <= s.rect.y + s.rect.h;
            });
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
            level: this._sceneKey(),
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
            out.push({ level: Ls, i, j, rect: this.lm.tileRect(Ls, i, j) });
        }
        return out;
    }
}

function perfNow() { return (typeof performance !== "undefined" ? performance.now() : Date.now()); }
