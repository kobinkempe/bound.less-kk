/**
 * LevelMap — the frame TREE (K-groups / local frames; see
 * docs/local-frames-design-bible.md). Owns the frames, their edges and grids,
 * and the pure transforms between them. No camera, no objects, no Two.js.
 *
 * A FRAME is a bounded, locally-anchored coordinate system:
 *   { id, parent, edge: {s, t} | null, depth, grid }
 * `edge` maps parent → this frame: child = (parent·s + t)/base. The frames form
 * one connected tree; the "spine" is the historical one-frame-per-depth chain
 * (spine ids are the depth as a string — "0", "1", "-2" — so legacy per-level
 * storage keys ARE spine frame ids and kobin-1/dev-0 data loads unchanged).
 * Sibling frames (spawned when a crossing lands far from every existing child;
 * see ensureChild) get ids like "2~1" that can never collide with a depth.
 *
 * WHY a tree: a single frame per depth has a finite float64 sharp radius. A pan
 * of D units at a coarse depth becomes D×3000^k a depth k deeper — one measured
 * dance put the view at 2.1e17 units, where float64 resolves 32 units = 42 px
 * and pen input visibly snapped to a grid (see the design bible's motivation
 * table). Frames keep every stored coordinate within ~REUSE_RADIUS of its
 * frame's origin BY CONSTRUCTION; only edges (all bounded) relate frames.
 *
 * An edge {s, t} is established the FIRST time its frame is crossed into and
 * reused forever. Two frames can legitimately lack an edge — the root, and
 * depth 0 before the first cross-down — so grid() derives a grid on demand from
 * the same camera-independent formula. We never fabricate an edge just to hold
 * a grid.
 */

// A crossing reuses an existing child frame only when the projected entry
// view-centre lands within this radius of the child's origin (child units).
// Big enough that hand-scale work never spawns siblings (1e9 units ≈ 1.25M
// screens at entry zoom); 4 decimal orders under float64's ~1e13 ink-sharp
// radius. Only cross-depth pan amplification (the zoom-out→pan→zoom-in dance)
// ever exceeds it — exactly when a new local anchor is needed.
export const REUSE_RADIUS = 1e9;

export default class LevelMap {
    constructor(cfg, width, height) {
        this.cfg = cfg;
        this.width = width; this.height = height;
        this.frames = new Map();   // id -> { id, parent, edge, depth, grid }
        this._spine = new Map();   // depth -> spine frame id (String(depth))
        this._seq = 0;             // sibling id sequence
        this._addFrame("0", null, null, 0, null); // depth 0 exists from birth (no grid until needed)
    }

    // ---- frame primitives ----
    _addFrame(id, parent, edge, depth, grid) {
        const f = { id, parent, edge, depth, grid };
        this.frames.set(id, f);
        if (!this._spine.has(depth) && id === String(depth)) this._spine.set(depth, id);
        return f;
    }
    frame(id) { return this.frames.get(id); }
    depthOf(key) { const f = this._frameFor(key); return f ? f.depth : null; }
    parentOf(key) { const f = this._frameFor(key); return f ? f.parent : null; }
    childrenOf(id) {
        const out = [];
        for (const f of this.frames.values()) if (f.parent === id) out.push(f);
        return out;
    }
    spineAt(depth) { return this._spine.get(depth) || null; }
    // The frame for `depth` as seen from `fromId`: the ancestor at that depth if
    // one exists, else the spine frame. (Scenes/UI still speak depth ints until
    // Stage 4; along one path depths are unique, so this is well-defined.)
    pathFrameAt(fromId, depth) {
        let f = this.frames.get(fromId);
        while (f && f.depth > depth) f = this.frames.get(f.parent);
        if (f && f.depth === depth) return f.id;
        return this.spineAt(depth);
    }
    // All frames, for iteration (TileStore's down-walk filters by depth).
    allFrames() { return this.frames.values(); }

    // ---- crossing support (Camera calls these) ----
    // Cross UP (deeper) out of `parentId`: reuse the child whose frame the entry
    // view-centre lands within REUSE_RADIUS of, else spawn a sibling anchored at
    // the entry point (the fresh-edge formula lands the new frame with pan = 0).
    // Returns the child frame.
    // The child frame a crossing at this camera position would REUSE (within
    // REUSE_RADIUS), or null. No side effects — the prebaker peeks with this.
    findChild(parentId, inScale, inPanX, inPanY) {
        const base = this.cfg.base;
        const cx = (this.width / 2 - inPanX) / inScale, cy = (this.height / 2 - inPanY) / inScale;
        let best = null, bestD = Infinity;
        for (const f of this.frames.values()) {
            if (f.parent !== parentId || !f.edge) continue;
            const px = (cx * f.edge.s + f.edge.t.x) / base, py = (cy * f.edge.s + f.edge.t.y) / base;
            const d = Math.max(Math.abs(px), Math.abs(py));
            if (d < bestD) { bestD = d; best = f; }
        }
        return best && bestD <= REUSE_RADIUS ? best : null;
    }
    ensureChild(parentId, inScale, inPanX, inPanY) {
        const parent = this.frames.get(parentId);
        const depth = parent.depth + 1;
        const best = this.findChild(parentId, inScale, inPanX, inPanY);
        if (best) return best;
        const k = this.cfg.enter / inScale;
        const edge = { s: this.cfg.enter, t: { x: inPanX * k, y: inPanY * k } };
        const spineId = String(depth);
        const id = (!this.frames.has(spineId)) ? spineId : depth + "~" + (++this._seq);
        return this._addFrame(id, parentId, edge, depth, this.makeGrid());
    }
    // Cross DOWN (coarser) out of `childId` when it has no parent yet: create a
    // new root anchored at the current view (pan' = 0 by the ensureDown formula)
    // and hang the old root off it. Returns the child's (possibly new) edge.
    ensureParentEdge(childId, inScale, inPanX, inPanY) {
        const child = this.frames.get(childId);
        if (child.parent && child.edge) return child.edge;
        const depth = child.depth - 1;
        const spineId = String(depth);
        const id = (!this.frames.has(spineId)) ? spineId : depth + "~" + (++this._seq);
        const parent = this._addFrame(id, null, null, depth, this.makeGrid());
        child.parent = parent.id;
        child.edge = {
            s: this.cfg.enter,
            t: { x: -inPanX * this.cfg.base / inScale, y: -inPanY * this.cfg.base / inScale },
        };
        if (!child.grid) child.grid = this.makeGrid();
        return child.edge;
    }

    // ---- legacy record view (spine only; scenes/persist/dev speak this) ----
    // A frame's {s,t,grid} record, memoized so re-entry returns the SAME object
    // (the old "first crossing defines the record forever" identity contract).
    _recOf(f) {
        if (!f || !f.edge) return undefined;
        if (!f._rec) f._rec = { s: f.edge.s, t: f.edge.t, grid: f.grid };
        return f._rec;
    }
    get records() {
        const out = {};
        for (const [depth, id] of this._spine) {
            const r = this._recOf(this.frames.get(id));
            if (r) out[depth] = r;
        }
        return out;
    }
    get(level) { const id = this.spineAt(level); return this._recOf(id && this.frames.get(id)); }
    has(level) { return !!this.get(level); }

    // Legacy creators (tests / V0 parity): spine-only versions of the frame ops.
    ensureUp(N, inScale, inPanX, inPanY) {
        const parentId = this.spineAt(N - 1);
        const child = this.ensureChild(parentId, inScale, inPanX, inPanY);
        return this._recOf(child);
    }
    ensureDown(level, inScale, inPanX, inPanY) {
        const childId = this.spineAt(level);
        this.ensureParentEdge(childId, inScale, inPanX, inPanY);
        return this._recOf(this.frames.get(childId));
    }

    // ---- grids (fixed per frame; derived deterministically when absent) ----
    makeGrid() {
        const k = 1 + 2 * this.cfg.bufferScreens, base = this.cfg.base;
        const w = k * this.width / base, h = k * this.height / base;
        return { w, h, ox: this.width / (2 * base) - w / 2, oy: this.height / (2 * base) - h / 2 };
    }
    // `key` is a frame id (string) or a legacy depth int (spine).
    _frameFor(key) {
        if (this.frames.has(key)) return this.frames.get(key);
        const id = this.spineAt(typeof key === "number" ? key : +key);
        return id ? this.frames.get(id) : null;
    }
    frameFor(key) { return this._frameFor(key); } // public alias
    grid(key) {
        const f = this._frameFor(key);
        if (f && f.grid) return f.grid;
        if (!this._derivedGrids) this._derivedGrids = {};
        const k = f ? f.id : String(key);
        if (!this._derivedGrids[k]) this._derivedGrids[k] = this.makeGrid();
        return this._derivedGrids[k];
    }
    tileRect(key, i, j) {
        const g = this.grid(key);
        return { left: g.ox + i * g.w, top: g.oy + j * g.h, right: g.ox + (i + 1) * g.w, bottom: g.oy + (j + 1) * g.h };
    }
    tileRange(key, rect) {
        const g = this.grid(key);
        return { i0: Math.floor((rect.left - g.ox) / g.w), i1: Math.floor((rect.right - g.ox) / g.w),
            j0: Math.floor((rect.top - g.oy) / g.h), j1: Math.floor((rect.bottom - g.oy) / g.h) };
    }

    // ---- single-edge point transforms ----
    // Edge of `key`'s frame maps parent → frame.
    _edge(key) { const f = this._frameFor(key); return f ? f.edge : null; }
    toChild(p, key) { const r = this._edge(key), b = this.cfg.base; return [(p[0] * r.s + r.t.x) / b, (p[1] * r.s + r.t.y) / b]; }
    toParent(p, key) { const r = this._edge(key), b = this.cfg.base; return [(p[0] * b - r.t.x) / r.s, (p[1] * b - r.t.y) / r.s]; }
    rectToParent(rect, key) {
        const r = this._edge(key), b = this.cfg.base;
        return { left: (rect.left * b - r.t.x) / r.s, top: (rect.top * b - r.t.y) / r.s,
            right: (rect.right * b - r.t.x) / r.s, bottom: (rect.bottom * b - r.t.y) / r.s };
    }

    // ---- tree walks (frame keys) ----
    // Ancestor path ids from `id` up to the root, inclusive.
    _ancestors(id) {
        const out = [];
        let f = this.frames.get(id);
        while (f) { out.push(f.id); f = f.parent ? this.frames.get(f.parent) : null; }
        return out;
    }
    // Is `aId` a proper ancestor (coarser, same branch) of `bId`?
    isAncestor(aId, bId) {
        if (aId === bId) return false;
        let f = this.frames.get(bId);
        f = f && f.parent ? this.frames.get(f.parent) : null;
        while (f) { if (f.id === aId) return true; f = f.parent ? this.frames.get(f.parent) : null; }
        return false;
    }
    // The frame path from -> to via the common ancestor, or null if disconnected.
    // Accepts frame ids OR legacy depth ints/numeric strings (resolved to spine).
    framePath(fromKey, toKey) {
        const from = this._frameFor(fromKey), to = this._frameFor(toKey);
        if (!from || !to) return null;
        const fromId = from.id, toId = to.id;
        if (fromId === toId) return { up: [], down: [] };
        const fa = this._ancestors(fromId), ta = new Map();
        let f = this.frames.get(toId);
        while (f) { ta.set(f.id, f); f = f.parent ? this.frames.get(f.parent) : null; }
        const upIds = [];
        let common = null;
        for (const a of fa) { if (ta.has(a)) { common = a; break; } upIds.push(a); }
        if (!common) return null;
        const downIds = [];
        f = this.frames.get(toId);
        while (f && f.id !== common) { downIds.push(f.id); f = this.frames.get(f.parent); }
        downIds.reverse();
        return { up: upIds, down: downIds }; // up: frames to EXIT (use their edges toParent); down: frames to ENTER (toChild)
    }
    // Cumulative scale factor from -> to (like levelFactor). Null if no path or
    // a needed edge is missing.
    frameFactor(fromId, toId) {
        const path = this.framePath(fromId, toId);
        if (!path) return null;
        const base = this.cfg.base;
        let f = 1;
        for (const id of path.up) { const e = this.frames.get(id).edge; if (!e) return null; f *= base / e.s; }
        for (const id of path.down) { const e = this.frames.get(id).edge; if (!e) return null; f *= e.s / base; }
        return f;
    }
    // Point transform across frames (walks the path, one bounded edge per step).
    mapPointF(p, fromId, toId) {
        const path = this.framePath(fromId, toId);
        if (!path) return null;
        const base = this.cfg.base;
        let x = p[0], y = p[1];
        for (const id of path.up) { const e = this.frames.get(id).edge; if (!e) return null; x = (x * base - e.t.x) / e.s; y = (y * base - e.t.y) / e.s; }
        for (const id of path.down) { const e = this.frames.get(id).edge; if (!e) return null; x = (x * e.s + e.t.x) / base; y = (y * e.s + e.t.y) / base; }
        return [x, y];
    }
    mapRectF(rect, fromId, toId) {
        const a = this.mapPointF([rect.left, rect.top], fromId, toId);
        const b = this.mapPointF([rect.right, rect.bottom], fromId, toId);
        if (!a || !b) return null;
        return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
    }
    // Chain a native's geometry + width from its home frame into another frame.
    // Handles both strokes (pts) and fills (polys — e.g. area-erase bakes).
    projectF(o, homeId, toId) {
        const f = this.frameFactor(homeId, toId);
        if (f == null) return null;
        const path = this.framePath(homeId, toId);
        const base = this.cfg.base;
        const mapAll = (src) => {
            let pts = src;
            for (const id of path.up) { const e = this.frames.get(id).edge; pts = pts.map(([x, y]) => [(x * base - e.t.x) / e.s, (y * base - e.t.y) / e.s]); }
            for (const id of path.down) { const e = this.frames.get(id).edge; pts = pts.map(([x, y]) => [(x * e.s + e.t.x) / base, (y * e.s + e.t.y) / base]); }
            return pts;
        };
        if (o.type === "fill") {
            return { type: "fill", origin: "derived", id: o.id, z: o.z, polys: o.polys.map(mapAll),
                color: o.color, opacity: o.opacity, paths: [] };
        }
        return { type: "stroke", origin: "derived", id: o.id, z: o.z, pts: mapAll(o.pts),
            lwFrame: o.lwFrame * f, color: o.color, opacity: o.opacity, paths: [] };
    }

    // ---- legacy depth-int walks (spine; scenes/persist/dev UIs) ----
    mapPoint(p, from, to) { return this.mapPointF(p, this.spineAt(from), this.spineAt(to)); }
    mapRect(rect, from, to) {
        const a = this.mapPoint([rect.left, rect.top], from, to);
        const b = this.mapPoint([rect.right, rect.bottom], from, to);
        if (!a || !b) return null;
        return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
    }
    // Map a `fromKey`-frame point to screen px given the active frame + camera.
    framePointToScreen(fromKey, x, y, activeKey, inScale, inPanX, inPanY) {
        const from = this._frameFor(fromKey), active = this._frameFor(activeKey);
        if (!from || !active) return null;
        const p = this.mapPointF([x, y], from.id, active.id);
        if (!p) return null;
        return [p[0] * inScale + inPanX, p[1] * inScale + inPanY];
    }
    levelPointToScreen(level, x, y, activeLevel, inScale, inPanX, inPanY) {
        return this.framePointToScreen(level, x, y, activeLevel, inScale, inPanX, inPanY);
    }
    effectiveZoom(activeKey, inScale) {
        // Product of edge ratios from the depth-0 spine frame to the active
        // frame (display only; same float range caveat as before).
        const anchor = this.spineAt(0);
        const active = this._frameFor(activeKey);
        if (!anchor || !active) return inScale;
        const f = this.frameFactor(anchor, active.id);
        return f == null ? inScale : inScale * f;
    }

    // ---- (de)serialization ----
    // Spine-only trees serialize as the legacy dev-0 `crossings` dict (existing
    // saves stay byte-identical). Trees with siblings emit { __frames: [...] }.
    serialize() {
        let hasSibling = false;
        for (const f of this.frames.values()) if (f.id !== String(f.depth)) { hasSibling = true; break; }
        if (!hasSibling) {
            const out = {};
            for (const [depth, id] of this._spine) {
                const f = this.frames.get(id);
                if (f && f.edge) out[depth] = { s: f.edge.s, t: { x: f.edge.t.x, y: f.edge.t.y }, grid: f.grid ? { ...f.grid } : this.makeGrid() };
            }
            return out;
        }
        return {
            __frames: [...this.frames.values()].map((f) => ({
                id: f.id, parent: f.parent, depth: f.depth,
                edge: f.edge ? { s: f.edge.s, t: { x: f.edge.t.x, y: f.edge.t.y } } : null,
                grid: f.grid ? { ...f.grid } : null,
            })),
        };
    }
    load(crossings) {
        this.frames = new Map();
        this._spine = new Map();
        this._derivedGrids = null;
        this._seq = 0;
        if (crossings && crossings.__frames) {
            for (const f of crossings.__frames) {
                this._addFrame(f.id, f.parent, f.edge ? { s: f.edge.s, t: { x: f.edge.t.x, y: f.edge.t.y } } : null, f.depth, f.grid ? { ...f.grid } : null);
                const m = /^(-?\d+)~(\d+)$/.exec(f.id);
                if (m) this._seq = Math.max(this._seq, +m[2]);
            }
            if (!this.frames.has("0")) this._addFrame("0", null, null, 0, null);
            return;
        }
        // Legacy dict: records[K] = edge INTO spine depth K from K-1. Build the
        // contiguous spine chain covering every recorded depth plus depth 0.
        const depths = Object.keys(crossings || {}).map(Number);
        let lo = 0, hi = 0;
        for (const d of depths) { if (d - 1 < lo) lo = d - 1; if (d > hi) hi = d; }
        for (let d = lo; d <= hi; d++) {
            const r = (crossings || {})[d];
            this._addFrame(String(d), d === lo ? null : String(d - 1),
                r ? { s: r.s, t: { x: r.t.x, y: r.t.y } } : null, d,
                r && r.grid ? { ...r.grid } : null);
        }
    }
    // Ensure a spine frame exists at `depth` (used when loading natives at
    // depths outside the recorded chain — e.g. content at depth 0 only).
    ensureSpine(depth) {
        if (this.spineAt(depth) != null) return this.spineAt(depth);
        // extend the chain toward `depth` with edge-less frames (transforms
        // through them return null, exactly like a missing record before)
        let [lo, hi] = [Infinity, -Infinity];
        for (const d of this._spine.keys()) { if (d < lo) lo = d; if (d > hi) hi = d; }
        if (lo === Infinity) { this._addFrame("0", null, null, 0, null); lo = hi = 0; }
        while (depth < lo) { lo--; const f = this._addFrame(String(lo), null, null, lo, null); const child = this.frames.get(String(lo + 1)); if (child && !child.parent) child.parent = f.id; }
        while (depth > hi) { hi++; this._addFrame(String(hi), String(hi - 1), null, hi, null); }
        return this.spineAt(depth);
    }
    // Wipe back to a single depth-0 frame (undo-of-clear / new canvas).
    reset() {
        this.frames = new Map();
        this._spine = new Map();
        this._derivedGrids = null;
        this._seq = 0;
        this._addFrame("0", null, null, 0, null);
    }
    resize(width, height) {
        // Captured grids stay valid (fixed per frame); only the derivation
        // baseline for future frames/grids changes.
        this.width = width; this.height = height;
        this._derivedGrids = null;
    }
}
