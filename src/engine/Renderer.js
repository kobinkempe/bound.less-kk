/**
 * Renderer — the ONLY class that touches Two.js. Owns the SVG scene, one
 * persistent Two.Group per object id (kept sorted by id = global z-order), the
 * per-frame diff (camera-only frames sync transforms + fade opacity without
 * rebuilding any path), and the fat-stroke display bake.
 *
 * Fixes vs the old engine:
 *  - Global z-order (BUG-03): groups live in a flat array sorted by id and are
 *    spliced into `world` at their sorted position, so a newer object always
 *    draws over an older one regardless of which representation bucket it came
 *    from. Two.js 0.7.1 fires one reorder pass per update no matter how many
 *    splices, and the pen hot path only ever appends (the live stroke has the
 *    max id).
 *  - Incremental render (ISSUE-11 / BUG-01): a group is rebuilt only when its
 *    piece signature changes; a pure camera move touches nothing but the world
 *    transform and faded groups' opacity.
 *  - Fat display (BUG-02): the bake window pad is max(half screen, 1.2 × widest
 *    visible fat half-width), so the window can never be outrun by a stroke —
 *    and projection giants no longer arrive as strokes (they're tile fills), so
 *    the only fat cases are the active level's own bounded natives.
 *  - Continuous fade (BUG-04): a down-piece carries fadeTag (its size at the
 *    level's deepest zoom); its group opacity ramps to 0 across the sub-pixel
 *    cull instead of popping.
 */
import Two from "two.js";
import { strokeOutline, strokeStripNear, clipPolylineToRect, flattenCurve, flattenCurveNear, decimatePolyline } from "./geometry/clipperOutline";
import { strokeOutlineCurves } from "./geometry/curveOutline";

const perfRendererNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Re-anchor budget: browsers rasterize SVG paths in FLOAT32 (Skia stores path
// points as float32, and Two.js matrices are Float32Array), so a vertex at
// frame coordinate c carries an absolute error of ~c/2^23 frame units, i.e.
// (c·inScale)/2^23 on-screen px. Zoom-out → pan → zoom-in manufactures huge
// coordinates (a pan of N screens at a coarse level is N×3000 frame units one
// crossing deeper), and strokes drawn out there keep them forever — they
// rendered visibly "pixelly" (~8 px vertex snapping at |c|≈8e6, inScale 15).
// The engine's own math is float64 and exact; only what's HANDED TO THE
// BROWSER must stay small. So every anchor is built relative to a per-scene
// origin (chosen at the view center) and the origin is folded back into the
// world transform in float64 JS. When the view drifts so far from the origin
// that c·inScale approaches this budget (~0.18 px of float32 error), the scene
// re-anchors: rebuild paths against a fresh origin. That's a ~1.9e6-screen-px
// drift — a rare, full-rebuild-priced event, like a level flip.
const REORIGIN_PX = 1.5e6;

// Absolute device-px fat gate (replaces polygonizeWidthFrac = 1/3 screen): a
// screen-fraction gate flips representation per device (a phone would fatten
// strokes a desktop draws normally). Skia's extreme-width mis-stroke was
// measured from ~25k device px, so 500 px keeps a ~50× safety margin.
// (Default; overridable as cfg.fatWidthPx.)
const FAT_WIDTH_PX = 500;

export default class Renderer {
    constructor(container, camera, cfg, opts = {}) {
        this.cam = camera; this.cfg = cfg;
        this.width = opts.width; this.height = opts.height;
        this.opacityGroups = true; this.outlineMode = false; this.debug = false;
        this.two = new Two({ width: this.width, height: this.height, autostart: true });
        this.two.appendTo(container);
        this.world = this.two.makeGroup();
        this.tileDebugGroup = this.two.makeGroup();
        this.selGroup = this.two.makeGroup(); // selection highlight (screen space, above everything)
        this._selRectFn = null;               // () -> { level, rect } | null
        this._groups = new Map();   // id -> { group, sig, z, pieces, fadeTag }
        this._order = [];           // ids sorted by (z, id) — z defaults to id;
                                    // cut pieces inherit their source's z so they
                                    // keep drawing at the original stroke's depth
        // --- per-level scene retention (perf) --------------------------------
        // A level flip used to tear down every group and rebuild it, so
        // `two.update()` recreated ~50 SVG <path> nodes (and reconstructed the
        // giant `d` strings of the fat curve-capsule outlines) EVERY crossing —
        // 1–3 s that never got cheaper on repeat because there was one `world`
        // group holding one level's paths at a time. Now each level keeps its
        // own subtree (a Two.Group under `world` + its own id→group map): a
        // crossing detaches one subtree and attaches another, so bouncing across
        // a boundary reuses the cached paths (their `d` is preserved — Two.js
        // only rebuilds `d` when a path's vertices change) and only moves DOM.
        // Correctness is still the render diff's job (sigs are value-based, so a
        // genuinely changed object rebuilds); the cache is a pure DOM reuse.
        // Off => one shared scene => the original rebuild-on-crossing behavior.
        this.retainScenes = true;   // dev-toggleable (setRetainScenes)
        this._scenes = new Map();   // levelKey -> { root, groups, order, seq }
        this._level = null;         // active scene key
        this._activeRoot = null;    // active scene's Two.Group (child of world)
        this._activateSeq = 0;      // recency counter for the scene LRU
        this._lastRebuilds = 0;     // groups (re)built in the last render()
        this._hasFat = false;
        this._bakedWindow = null;
        this._lastBakeScale = 0;
        this._liveModel = null;     // the growing stroke: never outline-cached
        this.lazyOutlines = true;   // fat strokes render RAW until they approach the
                                    // gate on screen (fit cost moves off pen-up and
                                    // onto idle/approach) — dev-toggleable
        this._pendingFatLw = 0;     // widest fat-gated stroke still rendering raw
        this.tileDebug = false;
        this._tileRectsFn = null;   // () -> [{level,i,j,rect}] for debug overlay
    }
    destroy() {
        try { this.two.pause(); } catch (e) { /* ignore */ }
        const el = this.two.renderer && this.two.renderer.domElement;
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    setSize(w, h) { this.width = w; this.height = h; this.two.renderer.setSize(w, h); }
    update() { this.two.update(); }

    // ---- fat-gate helpers ----
    _gatePx() { return this.cfg.fatWidthPx != null ? this.cfg.fatWidthPx : FAT_WIDTH_PX; }
    _fatOnScreen(o) { return o.type === "stroke" && o.lwFrame * this.cam.inScale > this._gatePx(); }
    // The representation gate: could this stroke EVER paint wider than the fat
    // gate anywhere in its level's zoom range (deepest zoom = enter)? Evaluated
    // per OBJECT, not per view — so the switch to the outline representation
    // happens when the object enters the render list (finalize/load/edit/tile
    // bake), never mid-gesture, and a raw SVG stroke can never reach the Skia
    // mis-stroke widths by in-level zooming (closes ISSUE-21 by construction).
    _fatEver(o) { return o.type === "stroke" && o.lwFrame * this.cfg.enter > this._gatePx(); }
    // Which representation does this stroke render with RIGHT NOW?
    //   raw     — a plain stroked path (thin strokes; live stroke; lazy-pending)
    //   outline — the curve-capsule fill (cached, or eager mode fits on demand)
    //   pending — fat-gated, lazily unfitted. Renders raw (pixel-exact browser
    //             stroking) until its outline is fitted in idle, or — past the
    //             gate — within the per-render fit budget. Fitting NEVER runs
    //             unbudgeted inside a render: loading a deep-zoom snapshot with
    //             dozens of fat strokes must not stall for minutes.
    // The mode is part of the group signature, so a flip rebuilds the group.
    _strokeMode(o) {
        if (o.type !== "stroke" || this.outlineMode || o === this._liveModel || !this._fatEver(o)) return "raw";
        if (!this.lazyOutlines || o._outline) return "outline";
        return "pending";
    }
    // Force a flip render once a pending stroke's RAW width actually crosses
    // the gate (the render then fits it within the budget — Skia safety).
    needsFatFlip() {
        return !this.outlineMode && this.lazyOutlines && this._pendingFatLw > 0 &&
            this._pendingFatLw * this.cam.inScale > this._gatePx();
    }
    // Are pending strokes APPROACHING the gate? The engine starts idle fits.
    hasPendingNearFat() {
        return this.lazyOutlines && this._pendingFatLw > 0 &&
            this._pendingFatLw * this.cam.inScale > this._gatePx() * 0.5;
    }
    // Pad the bake window by half a screen OR 1.2× the widest visible fat stroke's
    // half-width, whichever is larger — so the window can never be outrun.
    // (outlineMode debug only — normal rendering no longer bakes to a window.)
    outlinePad(list) {
        let pad = (0.5 * this.width) / this.cam.inScale;
        if (list) for (const o of list) if (this._fatOnScreen(o)) pad = Math.max(pad, 1.2 * o.lwFrame / 2);
        return pad;
    }
    _windowCovered() {
        const b = this._bakedWindow; if (!b) return false;
        const w = this.cam.frameWindow(0);
        return w.left >= b.left && w.right <= b.right && w.top >= b.top && w.bottom <= b.bottom;
    }
    // Does a zoom/pan need a re-bake? Only the outlineMode DEBUG view is baked
    // per-window/scale now — fat strokes render as curve-capsule outlines that
    // are exact at every in-level zoom (see geometry/curveOutline.js), so
    // ordinary zooming never re-tessellates anything (the old 25%-band fat
    // re-bake — ISSUE-12's display half — is gone).
    needsRebake() {
        if (!this.outlineMode) return false;
        const last = this._lastBakeScale || 0;
        return this.cam.inScale > last * 1.25 || this.cam.inScale < last * 0.8 || !this._windowCovered();
    }

    // ---- full render of an object-piece list ----
    // The list may hold SEVERAL pieces with the same id (tile fragments of one
    // object) — they all belong in that id's single group, at full opacity, with
    // the object's opacity applied once on the group. Groups are diffed by a
    // combined signature (unchanged id => paths reused), inserted at their
    // id-sorted position (global z-order), and dropped when their id vanishes.
    render(list, level) {
        const sc = this._activateLevel(level); // swaps to this level's retained subtree (or the shared one)
        this._maybeReorigin(sc);
        const pad = this.outlinePad(list);
        const vw = this.cam.frameWindow(pad);
        this._pendingFatLw = 0; // recounted below
        this._fitSpentMs = 0;   // per-render outline-fitting budget
        const byId = new Map();
        for (const o of list) { let a = byId.get(o.id); if (!a) { a = []; byId.set(o.id, a); } a.push(o); }
        let reorder = false;
        let rebuilt = 0;        // groups (re)built this pass — 0 => a fully cached crossing
        for (const [id, pieces] of byId) {
            // count lazy-pending fat strokes across the WHOLE list (also the
            // unchanged groups below), so needsFatFlip() sees them
            for (const o of pieces) if (this._strokeMode(o) === "pending") this._pendingFatLw = Math.max(this._pendingFatLw, o.lwFrame);
            const sig = pieces.map((o) => this._sig(o, vw)).join("|");
            const rep = pieces[0];
            const existing = this._groups.get(id);
            if (existing && existing.sig === sig) { existing.pieces = pieces; this._applyOpacity(existing, rep); continue; }
            rebuilt++;
            let entry = existing;
            if (!entry) {
                entry = { group: new Two.Group(), sig: null, z: rep.z != null ? rep.z : id, pieces, fadeTag: rep.fadeTag };
                this._groups.set(id, entry);
                this._insertSorted(id);
                reorder = true;
            } else {
                entry.group.remove(entry.group.children);
            }
            entry.pieces = pieces; entry.sig = sig; entry.fadeTag = rep.fadeTag;
            for (const o of pieces) this._buildInto(entry.group, o, vw);
            this._applyOpacity(entry, rep);
        }
        for (const [id, entry] of this._groups) {
            if (byId.has(id)) continue;
            if (entry.group.parent) entry.group.parent.remove(entry.group);
            this._groups.delete(id);
            const k = this._order.indexOf(id);
            if (k >= 0) this._order.splice(k, 1);
        }
        this.syncWorld();
        this._lastBakeScale = this.cam.inScale;
        this._lastRebuilds = rebuilt;
        this._hasFat = list.some((o) => o.type === "stroke" && o.lwFrame * this.cam.inScale > this._gatePx() * 0.5);
        this._bakedWindow = this.outlineMode ? this.cam.frameWindow(pad) : null;
        return reorder;
    }

    // Camera-only frame: no geometry rebuild. Sync the world transform, and
    // refresh opacity for faded groups (fade depends on inScale).
    syncCameraOnly() {
        this.syncWorld();
        for (const entry of this._groups.values()) if (entry.fadeTag != null) this._applyOpacity(entry, entry.pieces[0]);
    }
    syncWorld() {
        // Fold the active scene's origin into the world transform IN FLOAT64
        // (screen = inScale·(p − O) + [inPan + inScale·O]): anchors are stored
        // origin-relative (small), and the bracketed translation is ~screen-
        // sized whenever the view is near the content, so nothing large ever
        // reaches Two.js' Float32Array matrices or the browser's float32
        // rasterizer. The cancellation between inPan (~ −inScale·viewCenter)
        // and inScale·O happens here, in JS doubles, where it's exact.
        const o = this._origin();
        this.world.scale = this.cam.inScale;
        this.world.translation.x = this.cam.inPanX + this.cam.inScale * o.x;
        this.world.translation.y = this.cam.inPanY + this.cam.inScale * o.y;
        this._renderTileDebug();
        this._renderSelection();
    }

    // ---- per-scene local origin (float32-safe path coordinates) ----
    _origin() {
        const sc = this._scenes.get(this._level);
        return (sc && sc.origin) || Renderer._ZERO;
    }
    _viewCenter() {
        const w = this.cam.frameWindow(0);
        return { x: Math.round((w.left + w.right) / 2), y: Math.round((w.top + w.bottom) / 2) };
    }
    // Screen-px distance between the view center and the scene's origin — the
    // quantity that bounds the browser-side float32 error of on-screen vertices.
    _driftPx(sc) {
        if (!sc || !sc.origin) return 0;
        const c = this._viewCenter();
        return Math.max(Math.abs(c.x - sc.origin.x), Math.abs(c.y - sc.origin.y)) * this.cam.inScale;
    }
    // True when a camera-only move has drifted past the budget: the engine must
    // promote it to a full render so _maybeReorigin can rebuild. Never mid-
    // stroke — the live path's anchors are origin-relative and a swap under the
    // pen would desync them (a real pan can't cover 1.5e6 px in one gesture;
    // this only fires on programmatic jumps).
    needsReorigin() {
        if (this._live) return false;
        return this._driftPx(this._scenes.get(this._level)) > REORIGIN_PX;
    }
    // Re-anchor the scene on a fresh origin: wipe its groups (keeping the Map /
    // array IDENTITY — _groups and _order alias them) so the diff pass in
    // render() rebuilds every path origin-relative. Costs one level-flip-sized
    // rebuild, at a once-per-1.9e6-screen-px cadence.
    _maybeReorigin(sc) {
        if (!sc || this._live) return;
        if (this._driftPx(sc) <= REORIGIN_PX) return;
        sc.origin = this._viewCenter();
        for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
        sc.groups.clear();
        sc.order.length = 0;
    }

    // Make `level` the active scene: point `_groups`/`_order`/`_activeRoot` at
    // its retained subtree, swapping the attached root under `world` (the whole
    // point — one detach + one attach instead of rebuilding paths). With
    // retention off, every level shares one scene ("_"), so a crossing lands on
    // the same groups map and the diff rebuilds exactly as before.
    _activateLevel(level) {
        const key = !this.retainScenes ? "_" : (level == null ? (this._level == null ? 0 : this._level) : level);
        let sc = this._scenes.get(key);
        if (this._level === key && sc) { sc.seq = ++this._activateSeq; return sc; }
        if (this._activeRoot && this._activeRoot.parent) this.world.remove(this._activeRoot);
        if (!sc) { sc = { root: new Two.Group(), groups: new Map(), order: [], seq: 0, origin: this._viewCenter() }; this._scenes.set(key, sc); }
        this.world.add(sc.root);
        this._level = key; this._activeRoot = sc.root;
        this._groups = sc.groups; this._order = sc.order;
        sc.seq = ++this._activateSeq;
        this._evictScenes();
        return sc;
    }
    // Bound retained DOM: keep the few most-recently-active levels; a very deep
    // zoom session would otherwise stockpile orphaned subtrees. The active scene
    // is never evicted. Evicted roots are detached already (only the active root
    // is attached), so dropping the reference frees the orphaned <g>.
    _evictScenes() {
        const CAP = 8;
        if (this._scenes.size <= CAP) return;
        const victims = [...this._scenes.entries()]
            .filter(([k]) => k !== this._level)
            .sort((a, b) => a[1].seq - b[1].seq);
        while (this._scenes.size > CAP && victims.length) {
            const [k, sc] = victims.shift();
            for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
            if (sc.root.parent) sc.root.parent.remove(sc.root);
            this._scenes.delete(k);
        }
    }

    _insertSorted(id) {
        // binary search for the insertion index — (z, id) ascending. The pen hot
        // path still appends (a fresh stroke has max id AND z = id); only cut
        // pieces (z < id) land mid-array, and that's a one-off reorder pass.
        const z = this._groups.get(id).z;
        const before = (oid) => { const oz = this._groups.get(oid).z; return oz < z || (oz === z && oid < id); };
        let lo = 0, hi = this._order.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (before(this._order[mid])) lo = mid + 1; else hi = mid; }
        this._order.splice(lo, 0, id);
        const group = this._groups.get(id).group;
        const root = this._activeRoot || this.world; // groups live under the active level's subtree
        if (lo === root.children.length) root.add(group);
        else root.children.splice(lo, 0, group); // one reorder pass per update
    }

    // Opacity: object opacity × fade alpha (down-pieces) × tint. In group mode the
    // opacity lives once on the group; pieces stay fully opaque inside.
    _applyOpacity(entry, o) {
        let a = o.opacity == null ? 1 : o.opacity;
        if (o.fadeTag != null) {
            const px = o.fadeTag * this.cam.inScale / this.cfg.enter; // actual on-screen size now
            const lo = this.cfg.fadeLoPx != null ? this.cfg.fadeLoPx : 0.15;
            const hi = this.cfg.cullPx != null ? this.cfg.cullPx : 0.3;
            a *= Math.max(0, Math.min(1, (px - lo) / (hi - lo)));
        }
        entry.group.opacity = a;
    }

    // A piece signature: same signature => identical geometry => reuse the paths.
    // MUST include coordinates, not just counts: a straight stroke crossing N
    // tiles yields N pieces of identical shape (1 run, 2 pts), and a solid flood
    // yields a 4-vertex quad per tile — scrolling the tile set by one swaps
    // pieces without changing any count, and a count-only signature would leave
    // stale paths on screen. First+last vertex anchor the signature cheaply.
    _sig(o, vw) {
        // opacity is in the signature because in non-group mode it's painted on
        // the PATH — a restyle would otherwise leave stale paths behind.
        if (o.type === "fill") {
            const f0 = o.polys[0][0], ln = o.polys[o.polys.length - 1], l0 = ln[ln.length - 1];
            return "f" + o.id + ":" + o.polys.length + ":" + o.polys.reduce((s, p) => s + p.length, 0)
                + ":" + f0[0].toFixed(2) + "," + f0[1].toFixed(2) + ":" + l0[0].toFixed(2) + "," + l0[1].toFixed(2) + ":" + o.color + ":" + o.opacity;
        }
        const a = o.pts[0], z = o.pts[o.pts.length - 1];
        const ends = a[0].toFixed(2) + "," + a[1].toFixed(2) + ":" + z[0].toFixed(2) + "," + z[1].toFixed(2);
        // Outline-represented (fat) strokes are geometry-only like thin ones:
        // the curve-capsule outline is view-independent, so their groups survive
        // every camera move. The mode marker makes a lazy raw→outline flip
        // rebuild the group. Only the outlineMode DEBUG bake is window-keyed.
        const fat = this.outlineMode;
        if (!fat) {
            // "O" outline · "F" pending past the gate (forces a rebuild so the
            // budgeted fit in _buildInto actually runs — a sig match would skip
            // it) · "s" plain raw
            const sm = this._strokeMode(o);
            const m = sm === "outline" ? "O"
                : (sm === "pending" && o.lwFrame * this.cam.inScale > this._gatePx() ? "F" : "s");
            return m + o.id + ":" + o.pts.length + ":" + o.lwFrame.toFixed(3) + ":" + ends + ":" + o.color + ":" + o.opacity;
        }
        // window-dependent bake: quantize the window so small pans inside the pad reuse
        const q = (v) => Math.round(v / (Math.max(1, (vw.right - vw.left)) * 0.1));
        return "F" + o.id + ":" + o.lwFrame.toFixed(3) + ":" + ends + ":" + q(vw.left) + "," + q(vw.top) + "," + q(vw.right) + "," + q(vw.bottom) + ":" + o.color + ":" + o.opacity;
    }

    _buildInto(group, o, vw) {
        const curved = o.origin === "native"; // per-origin curvature (derived pieces are pre-flattened)
        // Fat strokes (could ever exceed the gate in this level) render as
        // filled curve-capsule outlines — built once, exact at every zoom. In
        // lazy mode they stay RAW until they approach the gate on screen
        // ("pending"); the LIVE stroke always stays raw. outlineMode keeps the
        // legacy windowed polygon bake as a DEBUG view.
        if (o.type === "stroke" && !this.outlineMode) {
            const mode = this._strokeMode(o);
            if (mode === "outline") { this._buildOutlineInto(group, o, curved); return; }
            if (mode === "pending" && o.lwFrame * this.cam.inScale > this._gatePx() && this._fitSpentMs < 12) {
                // past the gate: convert NOW, but within a 12 ms/render budget —
                // strokes over budget stay raw one more frame (pixel-exact; the
                // Skia hazard only starts far above the gate) and the idle
                // fitter + follow-up render pick them up
                const t0 = perfRendererNow();
                this._buildOutlineInto(group, o, curved);
                this._fitSpentMs += perfRendererNow() - t0;
                return;
            }
        }
        let polys = null;
        if (o.type === "fill") polys = o.polys;
        else if (this.outlineMode) polys = this._fatPolys(o, vw, curved);
        if (polys) {
            const og = this._origin();
            const verts = [];
            for (const poly of polys) {
                if (poly.length < 2) continue;
                for (let i = 0; i < poly.length; i++) {
                    const a = new Two.Anchor(poly[i][0] - og.x, poly[i][1] - og.y);
                    a.command = i === 0 ? Two.Commands.move : Two.Commands.line;
                    verts.push(a);
                }
            }
            if (verts.length) {
                const pOp = this.opacityGroups ? 1 : (o.opacity == null ? 1 : o.opacity);
                const path = new Two.Path(verts, true, false, true);
                path.fill = o.color; path.noStroke(); path.opacity = pOp;
                if (this.debug) { path.stroke = "red"; path.linewidth = 1 / this.cam.inScale; }
                group.add(path);
            }
        } else if (o.type !== "fill") {
            const og = this._origin();
            const pOp = this.opacityGroups ? 1 : (o.opacity == null ? 1 : o.opacity);
            const path = new Two.Path(o.pts.map(([x, y]) => new Two.Anchor(x - og.x, y - og.y)), false, curved);
            path.noFill(); path.stroke = o.color; path.linewidth = o.lwFrame; path.cap = "round"; path.join = "round"; path.opacity = pOp;
            group.add(path);
        }
    }

    // Fat strokes as filled curve-capsule outlines (geometry/curveOutline.js):
    // built ONCE per object in frame coordinates (cached on the object — the
    // Document busts `_outline` on move/restyle, tiles rebuild their pieces),
    // then rendered as manual Two.js bezier anchors. SVG rasterizes the curves,
    // so the same path is exact at every in-level zoom — no re-bake, ever.
    // Build (or fetch) the cached outline for a stroke. Public: the engine's
    // idle prefitter calls this so a later lazy flip costs nothing.
    ensureOutline(o, curved) {
        if (o._outline) return o._outline;
        let pts = o.pts;
        const useCurved = curved && pts.length > 2;
        // Pre-flattened (inherited) centerlines carry entry-fidelity chords —
        // decimate at that SAME fidelity ((arcTol·0.5)/base, the tolerance the
        // chords were cut to) before building capsules: the outline is then
        // exactly as accurate as the geometry it outlines, and dense chord
        // runs shrink 10-100× instead of turning into one capsule per chord
        // (the earlier /enter tolerance removed nothing and OOM'd).
        if (!useCurved && pts.length > 2) pts = decimatePolyline(pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.base);
        const loops = strokeOutlineCurves(pts, o.lwFrame, {
            curved: useCurved,
            fitTol: (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter,
            lineTol: (this.cfg.lineTolPx != null ? this.cfg.lineTolPx : 0.25) / this.cfg.enter,
            enterScale: this.cfg.enter,
        });
        o._outline = loops;
        return loops;
    }
    _buildOutlineInto(group, o, curved) {
        const loops = this.ensureOutline(o, curved);
        // loops -> anchors: segment k ends at anchor k+1; a curve-command anchor
        // consumes prev.controls.right (its segment's C1) and its own
        // controls.left (C2). Controls are stored RELATIVE (Two.js default).
        // Each loop ends exactly at its start point and the path stays open —
        // fill auto-closes subpaths, and Two's `closed` flag would draw a stray
        // closing segment across loops. Anchor positions are ORIGIN-RELATIVE
        // (controls are already relative offsets, so only x/y shift).
        const og = this._origin();
        const verts = [];
        for (const loop of loops) {
            const n = loop.length;
            if (!n) continue;
            for (let k = 0; k <= n; k++) {
                let x, y, lx = 0, ly = 0, rx = 0, ry = 0, cmd;
                if (k === 0) {
                    const s = loop[0];
                    x = s[0][0]; y = s[0][1];
                    rx = s[1][0] - x; ry = s[1][1] - y;
                    cmd = Two.Commands.move;
                } else {
                    const s = loop[k - 1];
                    x = s[3][0]; y = s[3][1];
                    lx = s[2][0] - x; ly = s[2][1] - y;
                    if (k < n) { const t = loop[k]; rx = t[1][0] - x; ry = t[1][1] - y; }
                    cmd = Two.Commands.curve;
                }
                verts.push(new Two.Anchor(x - og.x, y - og.y, lx, ly, rx, ry, cmd));
            }
        }
        if (!verts.length) return;
        const pOp = this.opacityGroups ? 1 : (o.opacity == null ? 1 : o.opacity);
        const path = new Two.Path(verts, false, false, true);
        path.fill = o.color; path.noStroke(); path.opacity = pOp;
        if (this.debug) { path.stroke = "red"; path.linewidth = 1 / this.cam.inScale; }
        group.add(path);
    }

    // The fat display bake — a verbatim port of KobinEngineV0._buildPaths' fat
    // branch (window-clipped outline fill with the covered/mega short-circuits),
    // reading pad from outlinePad() so BUG-02 cannot recur.
    // KEPT ONLY for the outlineMode DEBUG view (normal rendering uses
    // _buildOutlineInto's zoom-invariant curve capsules).
    _fatPolys(o, vw, curved) {
        const cx = (vw.left + vw.right) / 2, cy = (vw.top + vw.bottom) / 2;
        const hw = (vw.right - vw.left) / 2, hh = (vw.bottom - vw.top) / 2;
        const half = o.lwFrame / 2;
        const polys = [];
        // bbox
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of o.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
        if (x1 + half < vw.left || x0 - half > vw.right || y1 + half < vw.top || y0 - half > vw.bottom) return polys;
        let covered = false;
        for (const p of o.pts) if (Math.hypot(Math.abs(p[0] - cx) + hw, Math.abs(p[1] - cy) + hh) < half) { covered = true; break; }
        const diagW = Math.hypot(vw.right - vw.left, vw.bottom - vw.top);
        // span OR radius keyed (ISSUE-14): a wide-but-short giant must also take
        // the analytic strip, not Clipper's offset at astronomic radius.
        const mega = Math.hypot(x1 - x0, y1 - y0) > 20 * diagW || half > 4 * diagW;
        let cpts = [];
        if (!covered) {
            if (curved && o.pts.length > 2 && mega) {
                cpts = flattenCurveNear(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter, vw, Math.max(0, half - diagW), half + diagW);
            } else {
                cpts = (curved && o.pts.length > 2) ? flattenCurve(o.pts, (this.cfg.arcTolerancePx * 0.5) / this.cfg.enter) : o.pts;
            }
        }
        const pieces = []; let cur = null;
        for (let i = 0; i < cpts.length; i++) {
            const px = Math.abs(cpts[i][0] - cx), py = Math.abs(cpts[i][1] - cy);
            if (Math.hypot(px + hw, py + hh) < half) { covered = true; break; }
            const near = Math.hypot(Math.max(px - hw, 0), Math.max(py - hh, 0));
            const gap = i + 1 < cpts.length ? Math.hypot(cpts[i + 1][0] - cpts[i][0], cpts[i + 1][1] - cpts[i][1]) : 0;
            const prevGap = i > 0 ? Math.hypot(cpts[i][0] - cpts[i - 1][0], cpts[i][1] - cpts[i - 1][1]) : 0;
            if (near <= half + Math.max(gap, prevGap)) {
                if (!cur) { cur = []; pieces.push(cur); if (i > 0) cur.push(cpts[i - 1]); }
                cur.push(cpts[i]);
            } else { if (cur) cur.push(cpts[i]); cur = null; }
        }
        if (covered) {
            const m = 2 / this.cam.inScale;
            polys.push([[vw.left - m, vw.top - m], [vw.right + m, vw.top - m], [vw.right + m, vw.bottom + m], [vw.left - m, vw.bottom + m]]);
            return polys;
        }
        const eq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
        const lvw = { left: vw.left - cx, top: vw.top - cy, right: vw.right - cx, bottom: vw.bottom - cy };
        for (const run of pieces) {
            if (!run.length) continue;
            const drun = decimatePolyline(run, (this.cfg.arcTolerancePx * 0.5) / this.cam.inScale);
            let op;
            if (mega) {
                op = strokeStripNear(drun.map(([x, y]) => [x - cx, y - cy]), o.lwFrame, lvw,
                    { startCap: eq(drun[0], cpts[0]), endCap: eq(drun[drun.length - 1], cpts[cpts.length - 1]) });
            } else {
                op = strokeOutline(drun.map(([x, y]) => [x - cx, y - cy]), o.lwFrame, { arcTolerancePx: this.cfg.arcTolerancePx, curved: false, displayScale: this.cam.inScale });
            }
            for (const p of op) polys.push(p.map(([x, y]) => [x + cx, y + cy]));
        }
        return polys;
    }

    // ---- live in-progress stroke (immediate feedback, outside the diff) ----
    // Origin-relative like every other path, and parented under the ACTIVE
    // SCENE ROOT (not `world`): the scene origin folds into the world transform
    // in float64, so live ink lands pixel-identical to its finalized rendering.
    // _maybeReorigin/needsReorigin never fire while _live exists, so the origin
    // is stable for the whole gesture.
    addLive(o, straight) {
        const og = this._origin();
        const live = new Two.Path([new Two.Anchor(o.pts[0][0] - og.x, o.pts[0][1] - og.y)], false, !straight);
        live.noFill(); live.stroke = o.color; live.linewidth = o.lwFrame; live.cap = "round"; live.join = "round"; live.opacity = o.opacity == null ? 1 : o.opacity;
        (this._activeRoot || this.world).add(live); this._live = live; this._liveModel = o; return live;
    }
    extendLive(p) { if (this._live) { const og = this._origin(); this._live.vertices.push(new Two.Anchor(p[0] - og.x, p[1] - og.y)); } }
    setLiveEnd(p) { if (this._live) { const v = this._live.vertices[1]; if (v) { const og = this._origin(); v.x = p[0] - og.x; v.y = p[1] - og.y; } } }
    endLive() { if (this._live && this._live.parent) this._live.parent.remove(this._live); this._live = null; this._liveModel = null; }

    // Selection highlight: fn returns { level, rect } (the selected object's
    // lw-padded bbox in ITS OWN level's frame) or null. Drawn in screen space —
    // corners walk the record chain like the tile-debug overlay — and refreshed
    // on every world sync, so it tracks pans/zooms and drag-moves for free.
    setSelection(fn) { this._selRectFn = fn; this._renderSelection(); }
    _renderSelection() {
        this.selGroup.remove(this.selGroup.children);
        const sel = this._selRectFn && this._selRectFn();
        if (!sel) return;
        const { level, rect } = sel;
        const c = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
            .map(([x, y]) => this.cam.levelPointToScreen(level, x, y));
        if (c.some((p) => !p)) return;
        const path = new Two.Path(c.map(([x, y]) => new Two.Anchor(x, y)), true, false);
        path.noFill(); path.stroke = "#4f46e5"; path.linewidth = 1.5; path.opacity = 0.9;
        if (path.dashes) { path.dashes.length = 0; path.dashes.push(6, 4); }
        this.selGroup.add(path);
    }

    setOpacityGroups(v) { this.opacityGroups = v; }
    setOutlineMode(v) { this.outlineMode = v; }
    setLazyOutlines(v) { this.lazyOutlines = !!v; }
    // Toggle per-level scene retention. Switching modes changes what a scene key
    // means, so wipe the cache and let the next render rebuild once.
    setRetainScenes(v) { v = !!v; if (v === this.retainScenes) return; this.retainScenes = v; this.clear(); }
    setDebug(v) { this.debug = v; }
    setTileDebug(v, fn) { this.tileDebug = v; this._tileRectsFn = fn || this._tileRectsFn; if (!v) this.tileDebugGroup.remove(this.tileDebugGroup.children); }
    clear() {
        for (const sc of this._scenes.values()) {
            for (const entry of sc.groups.values()) if (entry.group.parent) entry.group.parent.remove(entry.group);
            if (sc.root.parent) sc.root.parent.remove(sc.root);
        }
        this._scenes.clear();
        this._level = null; this._activeRoot = null;
        this._groups = new Map(); this._order = [];
    }

    _renderTileDebug() {
        if (!this.tileDebug || !this._tileRectsFn) return;
        this.tileDebugGroup.remove(this.tileDebugGroup.children);
        for (const { level, rect } of this._tileRectsFn()) {
            const c = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
                .map(([x, y]) => this.cam.levelPointToScreen(level, x, y));
            if (c.some((p) => !p)) continue;
            const path = new Two.Path(c.map(([x, y]) => new Two.Anchor(x, y)), true, false);
            path.noFill(); path.stroke = "red"; path.linewidth = 1.5; path.opacity = 0.9;
            this.tileDebugGroup.add(path);
        }
    }
}

// Shared fallback origin for the pre-first-render window (no scene yet).
Renderer._ZERO = { x: 0, y: 0 };
