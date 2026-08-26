/**
 * LevelMap — the frame LATTICE (see docs/frame-lattice-design-bible.md). Owns
 * the frames, their edges and grids, and the pure transforms between them. No
 * camera, no objects, no Two.js.
 *
 * A FRAME IS A LATTICE CELL. It used to be "a region anchored wherever you
 * first crossed into it", which made re-entry a nearest-neighbour DECISION and
 * gave F-B: a 1 px aim error at the top minted brand new frames from depth 3
 * downward, and the only reason anyone got back to the same place was that
 * people steer by what they can see. A cell is a division instead:
 *
 *   { id, parent, depth, cell: {i, j}, edge }
 *
 * `edge` maps parent -> this frame and is a pure function of `cell` — the whole
 * of `frameLattice.cellEdge`. Four things fall out that the old model could not
 * have (bible section 5.1):
 *
 *   - re-entry is a LOOKUP: same place, same cell, same frame, always;
 *   - neighbours are (i +/- 1, j +/- 1), so "what else could overlap this?" is
 *     answerable without a search;
 *   - frames cannot overlap, so an object is never ambiguously in two of them;
 *   - REUSE_RADIUS, findChild-by-distance and sibling spawning are DELETED
 *     rather than tuned.
 *
 * IDS. A frame's id is built from its parent's, so it never changes once
 * minted — which matters because ids are Document keys and tile-cache keys.
 * The origin cell of an origin chain is the "spine" and keeps the historical
 * id: the depth as a string ("0", "1", "-2"). Everything else is
 * `<parentId>/<i>,<j>`. Crossing DOWN mints the coarser cell containing the
 * current one, so the spine stays the spine and existing ids are untouched.
 *
 * WHY a tree at all: a single frame per depth has a finite float64 sharp
 * radius. A pan of D units at a coarse depth becomes D x R^k a depth k deeper —
 * one measured dance put the view at 2.1e17 units, where float64 resolves 32
 * units = 42 px and pen input visibly snapped to a grid. Cells keep every
 * stored coordinate inside [-W/2, W/2) BY CONSTRUCTION.
 */
import { transformLoops, transformLoopsAbout } from "./geometry/arcShape";
import {
    BASE, ENTER, R, W, G, HALF_W, cellEdge, cellCentre, cellOf, carryDigit, inDigit,
    displacementDigits, applyDigits, tilePhase, childTilePhase,
} from "./frameLattice";

// A CACHE tile is the same size as a frame — D4, and Kobin was explicit about
// it: "I thought you said it was best to have frames and tiles be the same
// size, and at least they should be a similar size."
//
// It is not the same GRID. Where an object is chopped, and therefore where a
// curve may freeze to a line, is the object's own tile grid (freeze.js): same
// step, its own phase, welded to the object so a move cannot slide the cuts.
// This partition only decides how much work one cached bake covers, and since
// clipping an exact arc to it yields an exact sub-arc — and any end it makes is
// marked so the level below will not freeze on it — it cannot influence
// geometry at all. Aligned to the lattice and a power of two, so tile corners
// are exact.
export const TILE_DIV = 1;
export const TILE = W / TILE_DIV;   // 131,072 units — 3.2 screens on a 1280 px canvas

const cellKey = (i, j) => i + "," + j;

/**
 * An object's tile phase, carried along a frame path. Up a level the grid
 * coarsens by R and the cell centre comes back; down a level it is
 * `childTilePhase`. A sideways hop is a whole number of frames and leaves the
 * phase alone, which is exactly why two numbers are enough (bible 6.6).
 */
function phaseThrough(tile, path, frames) {
    let px = tile[0], py = tile[1];
    for (const id of path.up) {
        const c = frames.get(id).centre;
        px = tilePhase(px / R + c.x); py = tilePhase(py / R + c.y);
    }
    for (const id of path.down) {
        const c = frames.get(id).centre;
        px = childTilePhase(px, c.x, R); py = childTilePhase(py, c.y, R);
    }
    return [px, py];
}
const EMPTY_PATH = { up: [], down: [] };

export default class LevelMap {
    constructor(cfg, width, height) {
        this.cfg = cfg;
        this.width = width; this.height = height;
        this.frames = new Map();   // id -> { id, parent, depth, cell, edge, _kids }
        this._spine = new Map();   // depth -> spine frame id (String(depth))
        // framePath is O(depth) and is called for every object, every tile, every
        // render. On a document seventeen levels deep — Kobin has one — that walk
        // dominated a pan. The tree only changes when a frame is minted, so the
        // answers are cached and the whole cache is dropped when it does.
        this._paths = new Map();
        this._addFrame("0", null, { i: 0, j: 0 }, 0);
    }

    // ---- frame primitives ----
    _addFrame(id, parent, cell, depth) {
        this._paths.clear();
        const f = {
            id, parent, depth, cell, _kids: null,
            edge: parent == null ? null : cellEdge(cell.i, cell.j),
            // The cell's centre in its PARENT's units — the exact integer i*G.
            // Transforms use this rather than the edge's `t`, because
            // subtracting it BEFORE scaling makes magnification exact (see
            // arcShape.transformLoopsAbout).
            centre: parent == null ? null : cellCentre(cell.i, cell.j),
        };
        this.frames.set(id, f);
        if (!this._spine.has(depth) && id === String(depth)) this._spine.set(depth, id);
        if (parent != null) {
            const p = this.frames.get(parent);
            if (p) { if (!p._kids) p._kids = new Map(); p._kids.set(cellKey(cell.i, cell.j), id); }
        }
        return f;
    }
    frame(id) { return this.frames.get(id); }
    depthOf(key) { const f = this._frameFor(key); return f ? f.depth : null; }
    parentOf(key) { const f = this._frameFor(key); return f ? f.parent : null; }
    childrenOf(id) {
        const p = this.frames.get(id);
        const out = [];
        if (p && p._kids) for (const cid of p._kids.values()) out.push(this.frames.get(cid));
        return out;
    }
    spineAt(depth) { return this._spine.get(depth) || null; }
    pathFrameAt(fromId, depth) {
        let f = this.frames.get(fromId);
        while (f && f.depth > depth) f = this.frames.get(f.parent);
        if (f && f.depth === depth) return f.id;
        return this.spineAt(depth);
    }
    allFrames() { return this.frames.values(); }

    // ---- the lattice ----
    // Is this frame the origin cell of an origin chain? Spine frames keep the
    // legacy id (the depth as a string) so per-level storage keys, scenes and
    // snapshots read exactly as they always did.
    _isSpine(parentId, i, j) {
        if (i !== 0 || j !== 0) return false;
        if (parentId == null) return true;
        const p = this.frames.get(parentId);
        return !!p && p.id === String(p.depth);
    }
    _childId(parentId, i, j) {
        const p = this.frames.get(parentId);
        const depth = p.depth + 1;
        if (this._isSpine(parentId, i, j) && !this.frames.has(String(depth))) return String(depth);
        if (this._isSpine(parentId, i, j)) return String(depth);
        return parentId + "/" + i + "," + j;
    }
    /** The child cell (i, j) of `parentId`, minting it if this is its first visit. */
    cellChild(parentId, i, j) {
        const p = this.frames.get(parentId);
        if (!p) return null;
        // A digit outside the balanced range names a cell this parent does not
        // own, so it CARRIES — the same arithmetic `neighbour` uses when a
        // lateral step leaves the cell. Every mint funnels through here, which
        // is what makes "no frame ever has an illegal address" an invariant
        // rather than a hope.
        //
        // It was a hope until 2026-08-21. `cellOf` is a bare Math.round with no
        // range check, and `_viewCell` feeds it the view centre — so a camera
        // that crossed while its centre sat just outside the parent's own square
        // minted a frame at cell 2059, where the range is [-2048, 2048). The
        // overshoot was 352 units out of 65,536, about half a percent. The
        // session itself carried on fine; the damage only showed on RELOAD,
        // where `decodeCrossings` refused the file outright and the drawing
        // could not be opened at all.
        if (!inDigit(i) || !inDigit(j)) {
            const ci = carryDigit(i), cj = carryDigit(j);
            const sib = this.neighbour(parentId, ci.carry, cj.carry);
            if (!sib) return null;
            return this.cellChild(sib.id, ci.digit, cj.digit);
        }
        if (p._kids) { const hit = p._kids.get(cellKey(i, j)); if (hit) return this.frames.get(hit); }
        return this._addFrame(this._childId(parentId, i, j), parentId, { i, j }, p.depth + 1);
    }
    /** The child cell that already exists, or null. No side effects. */
    findCellChild(parentId, i, j) {
        // No existing child can hold an out-of-range digit (see `cellChild`),
        // and resolving the carry would have to CREATE frames — which this is
        // required not to do. A miss sends the caller to `cellChild`, which
        // carries properly.
        if (!inDigit(i) || !inDigit(j)) return null;
        const p = this.frames.get(parentId);
        const hit = p && p._kids && p._kids.get(cellKey(i, j));
        return hit ? this.frames.get(hit) : null;
    }

    /**
     * The frame `di, dj` cells away from `id` AT THE SAME DEPTH.
     *
     * A digit that leaves [-R/2, R/2) means the neighbour lives under a
     * different parent, so the carry walks up — creating coarser cells if the
     * tree does not reach that far yet. This is the same arithmetic a move
     * uses; panning laterally and dragging something sideways are the same
     * operation seen from two ends.
     */
    neighbour(id, di, dj) {
        const f = this.frames.get(id);
        if (!f) return null;
        if (!di && !dj) return f;
        const ci = carryDigit(f.cell.i + di), cj = carryDigit(f.cell.j + dj);
        let parentId = f.parent;
        if (ci.carry || cj.carry) {
            if (parentId == null) parentId = this._growRoot(f);
            const pn = this.neighbour(parentId, ci.carry, cj.carry);
            if (!pn) return null;
            parentId = pn.id;
        } else if (parentId == null) {
            // The root has no siblings until something needs one — and something
            // does, right now. Growing a coarser cell above it is exact and
            // leaves every existing id untouched.
            parentId = this._growRoot(f);
            const ci2 = carryDigit(f.cell.i + di), cj2 = carryDigit(f.cell.j + dj);
            if (ci2.carry || cj2.carry) {
                const pn = this.neighbour(parentId, ci2.carry, cj2.carry);
                if (!pn) return null;
                parentId = pn.id;
            }
            return this.cellChild(parentId, ci2.digit, cj2.digit);
        }
        return this.cellChild(parentId, ci.digit, cj.digit);
    }
    // Give a parentless frame a parent, so it can have siblings. The new coarser
    // cell is BY DEFINITION the one containing it, so the digit is (0,0) and the
    // spine stays the spine.
    _growRoot(f) {
        const depth = f.depth - 1;
        const id = String(depth);
        const p = this.frames.get(id) || this._addFrame(id, null, { i: 0, j: 0 }, depth);
        f.parent = p.id;
        f.cell = { i: 0, j: 0 };
        f.edge = cellEdge(0, 0);
        f.centre = cellCentre(0, 0);
        this._paths.clear();   // an existing frame just gained a parent
        if (!p._kids) p._kids = new Map();
        p._kids.set(cellKey(0, 0), f.id);
        return p.id;
    }
    /**
     * `neighbour`, but it never mints. Returns null when that cell has never
     * been visited — which is the common case and exactly what a bake wants to
     * know, since creating frames while reading tiles would grow the tree from
     * looking at it.
     */
    peekNeighbour(id, di, dj) {
        const f = this.frames.get(id);
        if (!f) return null;
        if (!di && !dj) return f;
        const ci = carryDigit(f.cell.i + di), cj = carryDigit(f.cell.j + dj);
        // A parentless frame has no siblings YET, and peeking must not invent
        // any: returning `f` here would make every direction resolve to the
        // frame itself, and a caller ringing the eight neighbours would get the
        // same cell eight times. (`neighbour` grows a parent instead, because it
        // is allowed to mint.)
        if (f.parent == null) return null;
        let parentId = f.parent;
        if (ci.carry || cj.carry) {
            const pn = this.peekNeighbour(parentId, ci.carry, cj.carry);
            if (!pn) return null;
            parentId = pn.id;
        }
        return this.findCellChild(parentId, ci.digit, cj.digit);
    }
    /** The (up to 8) existing cells around `id` at its own depth. */
    peekRing(id) {
        const out = [];
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                if (!di && !dj) continue;
                const n = this.peekNeighbour(id, di, dj);
                if (n) out.push(n);
            }
        }
        return out;
    }

    /** Force `id` to have a parent (crossing down needs one). Returns the parent id. */
    ensureParent(id) {
        const f = this.frames.get(id);
        if (!f) return null;
        if (f.parent != null) return f.parent;
        return this._growRoot(f);
    }

    // ---- crossing support (Camera calls these) ----
    // Which child cell a crossing at this camera position lands in. A pure
    // function of WHERE the view centre is (P4) — no history, no reuse test.
    _viewCell(inScale, inPanX, inPanY) {
        const cx = (this.width / 2 - inPanX) / inScale, cy = (this.height / 2 - inPanY) / inScale;
        return cellOf(cx, cy);
    }
    findChild(parentId, inScale, inPanX, inPanY) {
        const c = this._viewCell(inScale, inPanX, inPanY);
        return this.findCellChild(parentId, c.i, c.j);
    }
    ensureChild(parentId, inScale, inPanX, inPanY) {
        const c = this._viewCell(inScale, inPanX, inPanY);
        return this.cellChild(parentId, c.i, c.j);
    }
    // Crossing DOWN: the parent is the cell that CONTAINS this one, so there is
    // nothing to fit to the camera. Returns the (canonical) edge.
    ensureParentEdge(childId) {
        const child = this.frames.get(childId);
        if (!child) return null;
        if (child.parent == null) this._growRoot(child);
        return child.edge;
    }

    // ---- legacy record view (spine only; scenes/persist/dev speak this) ----
    _recOf(f) {
        if (!f || !f.edge) return undefined;
        if (!f._rec) f._rec = { s: f.edge.s, t: f.edge.t, grid: this.makeGrid() };
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

    ensureUp(N, inScale, inPanX, inPanY) {
        const parentId = this.spineAt(N - 1);
        const child = this.ensureChild(parentId, inScale, inPanX, inPanY);
        return this._recOf(child);
    }
    ensureDown(level) {
        const childId = this.spineAt(level);
        this.ensureParentEdge(childId);
        return this._recOf(this.frames.get(childId));
    }

    // ---- grids ----
    // Constant, lattice-aligned, canvas-independent (P6). The cache partition is
    // the frame divided TILE_DIV ways, and — like the cells themselves — each
    // tile is CENTRED on its index: tile i spans [i*TILE - TILE/2, i*TILE +
    // TILE/2). Cornering them on the frame origin instead is a trap, because the
    // origin is exactly where a centred zoom leaves the view: every crossing
    // would then land on a tile corner, every cede would split four ways, and a
    // hole cut at the view centre would straddle four tiles at every depth. The
    // old canvas-derived grid dodged this by construction (its `ox` centred the
    // grid on the screen), and the fix is to make that deliberate.
    makeGrid() { return { w: TILE, h: TILE, ox: -TILE / 2, oy: -TILE / 2 }; }
    _frameFor(key) {
        if (this.frames.has(key)) return this.frames.get(key);
        const id = this.spineAt(typeof key === "number" ? key : +key);
        return id ? this.frames.get(id) : null;
    }
    frameFor(key) { return this._frameFor(key); }
    grid() { return this.makeGrid(); }
    tileRect(key, i, j) {
        const h = TILE / 2;
        return { left: i * TILE - h, top: j * TILE - h, right: i * TILE + h, bottom: j * TILE + h };
    }
    tileRange(key, rect) {
        const h = TILE / 2;
        return { i0: Math.floor((rect.left + h) / TILE), i1: Math.floor((rect.right + h) / TILE),
            j0: Math.floor((rect.top + h) / TILE), j1: Math.floor((rect.bottom + h) / TILE) };
    }
    /** A frame's own extent — the cell, in its own coordinates. */
    frameRect() { return { left: -HALF_W, top: -HALF_W, right: HALF_W, bottom: HALF_W }; }

    // ---- single-edge point transforms ----
    _edge(key) { const f = this._frameFor(key); return f ? f.edge : null; }
    _centre(key) { const f = this._frameFor(key); return f ? f.centre : null; }
    // Magnify: cancel against the cell centre FIRST, then apply a power of two.
    // For a point inside the cell both steps are exact, so a descent of any
    // depth is a chain of exact steps — which is what makes a tile at depth
    // trustworthy at all (F-A).
    toChild(p, key) { const c = this._centre(key); return [(p[0] - c.x) * R, (p[1] - c.y) * R]; }
    toParent(p, key) { const c = this._centre(key); return [p[0] / R + c.x, p[1] / R + c.y]; }
    rectToParent(rect, key) {
        const c = this._centre(key);
        return { left: rect.left / R + c.x, top: rect.top / R + c.y,
            right: rect.right / R + c.x, bottom: rect.bottom / R + c.y };
    }

    // ---- tree walks (frame keys) ----
    _ancestors(id) {
        const out = [];
        let f = this.frames.get(id);
        while (f) { out.push(f.id); f = f.parent ? this.frames.get(f.parent) : null; }
        return out;
    }
    isAncestor(aId, bId) {
        if (aId === bId) return false;
        let f = this.frames.get(bId);
        f = f && f.parent ? this.frames.get(f.parent) : null;
        while (f) { if (f.id === aId) return true; f = f.parent ? this.frames.get(f.parent) : null; }
        return false;
    }
    /**
     * The address of `id` relative to `rootId`: the digits, coarsest first.
     * Null if `rootId` is not an ancestor (or the frame itself).
     */
    chainFrom(rootId, id) {
        const out = [];
        let f = this.frames.get(id);
        while (f && f.id !== rootId) { out.push(f.cell); f = f.parent ? this.frames.get(f.parent) : null; }
        if (!f) return null;
        out.reverse();
        return out;
    }
    /** Walk (and mint) the frame at `chain` below `rootId`. */
    frameAtChain(rootId, chain) {
        let cur = this.frames.get(rootId);
        for (const c of chain) {
            if (!cur) return null;
            cur = this.cellChild(cur.id, c.i, c.j);
        }
        return cur;
    }
    /** The nearest common ancestor of two frames, or null. */
    commonAncestor(aId, bId) {
        const seen = new Set(this._ancestors(aId));
        let f = this.frames.get(bId);
        while (f) { if (seen.has(f.id)) return f.id; f = f.parent ? this.frames.get(f.parent) : null; }
        return null;
    }
    /**
     * Where a frame ENDS UP when its contents are displaced by (dx, dy),
     * measured in the units of a frame at `atDepth` (coarser than, or equal to,
     * `id`'s own depth).
     *
     * This is the whole of a move at depth, and it is integer arithmetic:
     *
     *   - the displacement becomes base-R DIGITS, one per level between
     *     `atDepth` and the frame's own depth (frameLattice.displacementDigits);
     *   - the digits are added to the frame's ADDRESS, with carries
     *     (frameLattice.applyDigits);
     *   - a carry off the coarse end means the move crossed a cell boundary at
     *     or above the level it was made at, which is real, so the ancestor
     *     steps sideways to absorb it;
     *   - what the digits could not express comes back as `rest`, in the
     *     frame's OWN units and smaller than one frame — the only part that ever
     *     touches geometry.
     *
     * Returns { frame, rest: [rx, ry] }, or null if `atDepth` is not on this
     * frame's ancestry.
     */
    displaceFrame(id, atDepth, dx, dy) {
        const f = this.frames.get(id);
        if (!f || atDepth > f.depth) return null;
        const anchor = this.pathFrameAt(id, atDepth);
        if (anchor == null) return null;
        const chain = this.chainFrom(anchor, id);
        if (!chain) return null;
        const k = chain.length;                      // = f.depth - atDepth
        const X = displacementDigits(dx, k), Y = displacementDigits(dy, k);
        if (!k) return { frame: f, rest: [X.rest, Y.rest] };
        const ax = applyDigits(chain.map((c) => c.i), 0, X.digits);
        const ay = applyDigits(chain.map((c) => c.j), 0, Y.digits);
        let root = anchor;
        if (ax.carry || ay.carry) {
            const n = this.neighbour(anchor, ax.carry, ay.carry);
            if (!n) return null;
            root = n.id;
        }
        const cells = ax.chain.map((i, n) => ({ i, j: ay.chain[n] }));
        const frame = this.frameAtChain(root, cells);
        return frame ? { frame, rest: [X.rest, Y.rest] } : null;
    }

    framePath(fromKey, toKey) {
        const from = this._frameFor(fromKey), to = this._frameFor(toKey);
        if (!from || !to) return null;
        const fromId = from.id, toId = to.id;
        if (fromId === toId) return EMPTY_PATH;
        const ck = fromId + "|" + toId;
        const hit = this._paths.get(ck);
        if (hit !== undefined) return hit;
        const built = this._buildPath(fromId, toId);
        this._paths.set(ck, built);
        return built;
    }
    _buildPath(fromId, toId) {
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
        return { up: upIds, down: downIds };
    }
    frameFactor(fromId, toId) {
        const path = this.framePath(fromId, toId);
        if (!path) return null;
        const base = this.cfg.base;
        let f = 1;
        for (const id of path.up) { const e = this.frames.get(id).edge; if (!e) return null; f *= base / e.s; }
        for (const id of path.down) { const e = this.frames.get(id).edge; if (!e) return null; f *= e.s / base; }
        return f;
    }
    mapPointF(p, fromId, toId) {
        const path = this.framePath(fromId, toId);
        if (!path) return null;
        let x = p[0], y = p[1];
        for (const id of path.up) { const c = this.frames.get(id).centre; if (!c) return null; x = x / R + c.x; y = y / R + c.y; }
        for (const id of path.down) { const c = this.frames.get(id).centre; if (!c) return null; x = (x - c.x) * R; y = (y - c.y) * R; }
        return [x, y];
    }
    mapRectF(rect, fromId, toId) {
        const a = this.mapPointF([rect.left, rect.top], fromId, toId);
        const b = this.mapPointF([rect.right, rect.bottom], fromId, toId);
        if (!a || !b) return null;
        return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
    }
    projectF(o, homeId, toId) {
        const f = this.frameFactor(homeId, toId);
        if (f == null) return null;
        const path = this.framePath(homeId, toId);
        const mapAll = (src) => {
            let pts = src;
            for (const id of path.up) { const c = this.frames.get(id).centre; pts = pts.map(([x, y]) => [x / R + c.x, y / R + c.y]); }
            for (const id of path.down) { const c = this.frames.get(id).centre; pts = pts.map(([x, y]) => [(x - c.x) * R, (y - c.y) * R]); }
            return pts;
        };
        if (o.type === "shape") {
            // Every edge is a uniform scale plus a translation, so an arc stays
            // an arc: the endpoints move, the bulge does not change at all. The
            // perimeter crosses a level without being re-resolved, which is the
            // property the whole representation is for. Hops are applied ONE
            // EDGE AT A TIME — a composed long jump cancels catastrophically
            // going up.
            let loops = o.loops;
            for (const id of path.up) {
                const c = this.frames.get(id).centre;
                loops = transformLoops(loops, 1 / R, c.x, c.y);
            }
            for (const id of path.down) {
                const c = this.frames.get(id).centre;
                loops = transformLoopsAbout(loops, c.x, c.y, R);
            }
            // The tile phase rides along. Every hop here is either a whole
            // number of frames (a neighbour) or a level crossing, and the
            // phase for a crossing is childTilePhase; for the sideways case it
            // does not move at all, because neighbouring cells' origins differ
            // by exactly W (bible 6.6).
            const out = { type: "shape", origin: "derived", id: o.id, z: o.z, loops,
                color: o.color, opacity: o.opacity, paths: [] };
            if (o.tile) out.tile = phaseThrough(o.tile, path, this.frames);
            return out;
        }
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
        const anchor = this.spineAt(0);
        const active = this._frameFor(activeKey);
        if (!anchor || !active) return inScale;
        const f = this.frameFactor(anchor, active.id);
        return f == null ? inScale : inScale * f;
    }

    // ---- (de)serialization ----
    // A frame IS its cell, so the whole tree is (id, parent, depth, cell) — the
    // edge is derived and the grid is a constant. There is no legacy path: a
    // pre-lattice file carries free-floating {s, t} records whose frames have no
    // cell at all, and converting them would mean rewriting stored coordinates,
    // which is the one operation this design exists to avoid (D8).
    serialize() {
        return {
            __lattice: 1,
            frames: [...this.frames.values()].sort((a, b) => (a.depth - b.depth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((f) => ({
                id: f.id, parent: f.parent, depth: f.depth, i: f.cell.i, j: f.cell.j,
            })),
        };
    }
    load(data) {
        this._paths.clear();
        if (data && !data.__lattice && Object.keys(data).length) {
            const e = new Error("This drawing was saved in the pre-lattice format and cannot be opened.");
            e.code = "LEGACY_FORMAT";
            throw e;
        }
        this.frames = new Map();
        this._spine = new Map();
        const list = (data && data.frames) || [];
        // Parents before children, so _kids is wired as we go.
        const byId = new Map(list.map((f) => [f.id, f]));
        const done = new Set();
        const put = (f) => {
            if (!f || done.has(f.id)) return;
            done.add(f.id);
            if (f.parent != null && byId.has(f.parent)) put(byId.get(f.parent));
            this._addFrame(f.id, f.parent, { i: f.i, j: f.j }, f.depth);
        };
        for (const f of list) put(f);
        if (!this.frames.has("0")) this._addFrame("0", null, { i: 0, j: 0 }, 0);
    }
    ensureSpine(depth) {
        if (this.spineAt(depth) != null) return this.spineAt(depth);
        let [lo, hi] = [Infinity, -Infinity];
        for (const d of this._spine.keys()) { if (d < lo) lo = d; if (d > hi) hi = d; }
        if (lo === Infinity) { this._addFrame("0", null, { i: 0, j: 0 }, 0); lo = hi = 0; }
        while (depth < lo) {
            lo--;
            const f = this._addFrame(String(lo), null, { i: 0, j: 0 }, lo);
            const child = this.frames.get(String(lo + 1));
            if (child && child.parent == null) {
                child.parent = f.id; child.cell = { i: 0, j: 0 }; child.edge = cellEdge(0, 0);
                child.centre = cellCentre(0, 0);
                this._paths.clear();
                if (!f._kids) f._kids = new Map();
                f._kids.set(cellKey(0, 0), child.id);
            }
        }
        while (depth > hi) { hi++; this.cellChild(String(hi - 1), 0, 0); }
        return this.spineAt(depth);
    }
    reset() {
        this._paths.clear();
        this.frames = new Map();
        this._spine = new Map();
        this._addFrame("0", null, { i: 0, j: 0 }, 0);
    }
    resize(width, height) {
        // Grids are lattice constants now, so a resize changes nothing about
        // geometry — only which cell a given screen point falls in.
        this.width = width; this.height = height;
    }
}

export { BASE, ENTER, R, W, G };
