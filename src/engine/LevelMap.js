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
import { hasOffsets, shiftAt, hasDigits, addOffset } from "./geometry/offsets";
import {
    R, TILE, TileGrid, cellEdge, cellCentre, cellOf, carryDigit, inDigit,
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
// ONE definition, re-exported rather than re-derived. `TILE_DIV` and `TILE` used
// to be computed here (`W / TILE_DIV`, with TILE_DIV = 1) — the same number
// `frameLattice` already exports, under a second name free to drift from it.
// The names stay because the tile suites read them.
export const TILE_DIV = 1;   // D4: a cache tile IS a frame. Kept for the suites.
export { TILE };

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
        this._rootId = null;
        this.addrEpoch = 0;        // bumped by every re-address; the tile cache keys its stamps on it
        this.minted = null;        // a Set every frame added joins, when the engine collects frames (F94)
        this._retired = null;      // ids of forgotten MOVED frames: never minted again this session
        this._addFrame("0", null, { i: 0, j: 0 }, 0);
    }

    // ---- frame primitives ----
    _addFrame(id, parent, cell, depth) {
        this._paths.clear();
        if (this.minted) this.minted.add(id);
        const f = {
            id, parent, depth, cell, _kids: null,
            shift: null, addrSeq: 0,
            shadowOf: null, _shadows: null,   // a shadow shares a resident's cell (SUBTREE-O1-PLAN §2.5)
            edge: parent == null ? null : cellEdge(cell.i, cell.j),
            // The cell's centre in its PARENT's units — the exact integer i*G.
            // Transforms use this rather than the edge's `t`, because
            // subtracting it BEFORE scaling makes magnification exact (see
            // arcShape.transformLoopsAbout).
            centre: parent == null ? null : cellCentre(cell.i, cell.j),
        };
        this.frames.set(id, f);
        if (parent == null && (this._rootId == null || depth < this.frames.get(this._rootId).depth)) this._rootId = id;
        if (this._isSpine(parent, cell.i, cell.j)) this._spine.set(depth, id);
        if (parent != null) {
            const p = this.frames.get(parent);
            if (p) { if (!p._kids) p._kids = new Map(); p._kids.set(cellKey(cell.i, cell.j), id); }
        }
        return f;
    }
    frame(id) { return this.frames.get(id); }
    depthOf(key) { const f = this._frameFor(key); return f ? f.depth : null; }
    parentOf(key) { const f = this._frameFor(key); return f ? f.parent : null; }

    // ---- co-residents (A1 C3, DESIGN.md §8) ----
    // Frames sharing a lattice cell are one group: a resident (`shadowOf` null) and its co-residents
    // (`shadowOf` its id, in its `_shadows`). A frame's `parent` is its container, so a co-resident keeps
    // its own subtree. Lookups return residents; geometry reads a frame through its resident, so the
    // group is one cell to the bit. Invariant: the frames at one cell are one group, and their parents
    // are one group. `p._kids` maps a cell to one of p's own kids there; p's others there are in its group.

    /** The resident of `id`'s cell: what lookups return for it. */
    residentOf(id) {
        const f = this.frames.get(String(id));
        return f && f.shadowOf != null ? this.frames.get(f.shadowOf) || f : f || null;
    }
    /** The frames sharing `id`'s cell, its resident first. */
    cellFrames(id) {
        const r = this.residentOf(id);
        if (!r) return [];
        if (!r._shadows || !r._shadows.size) return [r];
        const out = [r];
        for (const s of r._shadows) { const g = this.frames.get(s); if (g) out.push(g); }
        return out;
    }
    /** Whether frames `a` and `b` are one cell: the same frame, or co-residents. */
    sameCell(a, b) {
        if (String(a) === String(b)) return true;
        const x = this.residentOf(a);
        return !!x && x === this.residentOf(b);
    }
    /** The resident of child cell `key` of `p`'s cell, looked up through every frame sharing that cell. */
    _kidAt(p, key) {
        let v = null;
        for (const g of this.cellFrames(p.id)) if (g._kids && (v = g._kids.get(key))) break;
        return v ? this.residentOf(v) : null;
    }
    /** The frames `id` contains: its own kids, each once (a co-resident's kids are its own). */
    childrenOf(id) {
        const p = this.frames.get(String(id));
        const out = [];
        if (!p || !p._kids) return out;
        for (const cid of p._kids.values()) {
            const c = this.frames.get(cid);
            if (!c) continue;
            out.push(c);
            for (const g of this.cellFrames(c.id)) if (g !== c && g.parent === p.id) out.push(g);
        }
        return out;
    }
    /** `fn(frame)` over the subtree `rootId` stands for: the root, its kids and theirs. */
    walk(rootId, fn) {
        const stack = [this.frames.get(rootId)];
        while (stack.length) {
            const f = stack.pop();
            if (!f) continue;
            fn(f);
            if (f._kids) for (const c of this.childrenOf(f.id)) stack.push(c);
        }
    }
    /** Group `list` (frames at one cell) as one: its present resident stays one, else its first. Returns the resident. */
    _regroup(list) {
        if (!list.length) return null;
        this._paths.clear();
        const r = list.find((g) => g.shadowOf == null) || list[0];
        r.shadowOf = null; r._shadows = null;
        for (const g of list) {
            if (g === r) continue;
            g.shadowOf = r.id; g._shadows = null;
            (r._shadows || (r._shadows = new Set())).add(g.id);
        }
        return r;
    }
    /** Residents `a` and `b` of one cell become one group; an empty childless `b` yields the cell to `a`. Returns the resident. */
    _joinGroups(a, b, empty) {
        this._paths.clear();
        const yieldB = !(b._kids && b._kids.size) && empty(b.id);
        const [r, s] = yieldB ? [a, b] : [b, a];
        const add = [s.id, ...(s._shadows || [])];
        s._shadows = null;
        for (const id of add) {
            const g = this.frames.get(id);
            if (!g) continue;
            g.shadowOf = r.id;
            (r._shadows || (r._shadows = new Set())).add(id);
        }
        return r;
    }
    /** The kids of the frames sharing resident `r`'s cell, one group per child cell (after a join), all the way down. */
    _linkKids(r, empty) {
        const at = new Map();
        for (const g of this.cellFrames(r.id)) {
            if (!g._kids) continue;
            for (const [key, cid] of g._kids) {
                const c = this.residentOf(cid), had = at.get(key);
                if (!c || had === c) continue;
                if (!had) { at.set(key, c); continue; }
                const j = this._joinGroups(c, had, empty);
                at.set(key, j);
                this._linkKids(j, empty);
            }
        }
    }
    /** Frames `A` leave a cell that frames `B` keep: no child cell's group holds both sides' kids, all the way down. */
    _splitKids(A, B) {
        if (!A.length || !B.length) return;
        const inA = new Set(A.map((g) => g.id)), seen = new Set();
        for (const a of A) {
            if (!a._kids) continue;
            for (const cid of a._kids.values()) {
                const r = this.residentOf(cid);
                if (!r || seen.has(r.id)) continue;
                seen.add(r.id);
                const G = this.cellFrames(r.id), A2 = G.filter((g) => inA.has(g.parent)), B2 = G.filter((g) => !inA.has(g.parent));
                if (!B2.length) continue;
                this._regroup(A2); this._regroup(B2);
                this._splitKids(A2, B2);
            }
        }
    }
    spineAt(depth) { return this._spine.get(depth) || null; }
    /** The resident of `f`'s container's cell: the lattice parent every geometric walk reads. */
    _cellParent(f) { return f && f.parent != null ? this.residentOf(f.parent) : null; }
    /** The resident at `depth` on `fromId`'s cell chain, else the spine frame there. */
    pathFrameAt(fromId, depth) {
        let f = this.residentOf(fromId);
        while (f && f.depth > depth) f = this._cellParent(f);
        if (f && f.depth === depth) return f.id;
        return this.spineAt(depth);
    }

    // ---- the lattice ----
    // The spine is the chain of (0,0) cells from the root, so this cell is on it
    // when its parent is the spine frame AT ITS DEPTH. A spine frame that is
    // re-addressed leaves the chain while keeping its old id string, so `_spine`
    // — not the id — is the authority on which frame is the origin at a depth.
    _isSpine(parentId, i, j) {
        if (i !== 0 || j !== 0) return false;
        if (parentId == null) return true;
        const p = this.frames.get(parentId);
        return !!p && this._spine.get(p.depth) === p.id;
    }
    // A birth chain that is already taken (its frame moved away) gets a `#n`
    // suffix; an id is never reused.
    _childId(parentId, i, j) {
        const p = this.frames.get(parentId);
        const depth = p.depth + 1;
        let id = this._isSpine(parentId, i, j) ? String(depth) : parentId + "/" + i + "," + j;
        const taken = (x) => this.frames.has(x) || (this._retired != null && this._retired.has(x));
        if (taken(id)) {
            let n = 2;
            while (taken(id + "#" + n)) n++;
            id = id + "#" + n;
        }
        return id;
    }
    /**
     * Remove a frame that contains no frames; the caller checks its natives and its keepers (frame GC,
     * OPEN-FLAGS F94). A resident with co-residents hands its cell to one (A1 C3: GC promotes). A MOVED
     * frame's id is retired for the session: caches keyed by it picture its last address, which a new
     * mint at its birth cell would not be. False if refused.
     */
    forget(id) {
        const f = this.frames.get(id);
        if (!f || f.parent == null || (f._kids && f._kids.size)) return false;
        this._leave(f);
        if (f.addrSeq) this.retire(id);
        this.frames.delete(id);
        this._paths.clear();
        if (this._spine.get(f.depth) === id) this._rebuildSpine();
        return true;
    }
    /** Ids no new frame may take this session: a moved frame's, a deleted one's (caches and history name them). */
    retire(id) { (this._retired || (this._retired = new Set())).add(String(id)); }
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
        const hit = this._kidAt(p, cellKey(i, j));
        if (hit) return hit;
        return this._addFrame(this._childId(parentId, i, j), parentId, { i, j }, p.depth + 1);
    }
    /**
     * The resident of the child cell that already exists, or null. No side effects. `own`: only a kid
     * `parentId` itself contains (a mover's kids go with it; its co-residents' stay).
     */
    findCellChild(parentId, i, j, own = false) {
        // No existing child can hold an out-of-range digit (see `cellChild`),
        // and resolving the carry would have to CREATE frames — which this is
        // required not to do. A miss sends the caller to `cellChild`, which
        // carries properly.
        if (!inDigit(i) || !inDigit(j)) return null;
        const p = this.frames.get(parentId);
        if (!p) return null;
        if (!own) return this._kidAt(p, cellKey(i, j));
        const hit = p._kids && p._kids.get(cellKey(i, j));
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
        this._adopt(f, p, { i: 0, j: 0 });
        return p.id;
    }
    // An existing parentless frame becomes cell `cell` of `p`.
    _adopt(f, p, cell) {
        f.parent = p.id;
        f.cell = { i: cell.i, j: cell.j };
        f.edge = cellEdge(cell.i, cell.j);
        f.centre = cellCentre(cell.i, cell.j);
        this._paths.clear();
        if (!p._kids) p._kids = new Map();
        p._kids.set(cellKey(cell.i, cell.j), f.id);
    }
    /**
     * Move frame `id` to cell (i, j) of `parentId`, one depth up: the address changes, the id and
     * every descendant's id do not (the subtree follows its parent pointer). Returns the frame, or
     * `{ occupied }` when another frame holds that cell, or null for a bad request.
     */
    readdress(id, parentId, i, j) {
        const f = this.frames.get(id), p = this.frames.get(parentId);
        if (!f || !p || p.depth !== f.depth - 1 || !inDigit(i) || !inDigit(j)) return null;
        if (f.parent === parentId && f.cell.i === i && f.cell.j === j) return f;
        const taken = p._kids && p._kids.get(cellKey(i, j));
        if (taken && taken !== id) return { occupied: taken };
        this._leave(f);
        this._take(f, p, i, j, () => false);
        this._paths.clear();
        this.addrEpoch++;
        this._rebuildSpine();
        return f;
    }
    // A frame leaves its cell: out of its group (a resident hands the cell to a co-resident), out of its
    // container's kids, and its subtree out of every group it shares with frames that stay.
    _leave(f) {
        const old = f.parent != null ? this.frames.get(f.parent) : null;
        const key = cellKey(f.cell.i, f.cell.j);
        const mates = this.cellFrames(f.id).filter((g) => g !== f);
        if (mates.length) {
            this._regroup(mates);
            f.shadowOf = null; f._shadows = null;
            this._splitKids([f], mates);
        }
        if (old && old._kids && old._kids.get(key) === f.id) {
            const next = mates.find((g) => g.parent === old.id);
            if (next) old._kids.set(key, next.id); else old._kids.delete(key);
        }
    }
    // A frame takes cell (i, j) of `p`. A free cell is taken; a resident that `empty` says holds
    // nothing and that has no kids becomes the newcomer's shadow; any other resident keeps the
    // cell and the newcomer shadows it, merged into it when the user action that made it ends
    // (`Document.mergePending`). Returns `[shadow, resident]` when a shadow was made.
    _take(f, p, i, j, empty) {
        f.parent = p.id; f.cell = { i, j }; f.edge = cellEdge(i, j); f.centre = cellCentre(i, j);
        f.addrSeq = (f.addrSeq || 0) + 1; f._rec = undefined;
        if (!p._kids) p._kids = new Map();
        const key = cellKey(i, j);
        const taken = p._kids.get(key);
        if (!taken || taken === f.id) { p._kids.set(key, f.id); return null; }
        const E = this.frames.get(taken);
        if (!(E._kids && E._kids.size) && empty(E.id)) {
            E.shadowOf = f.id;
            if (!f._shadows) f._shadows = new Set();
            f._shadows.add(E.id);
            if (E._shadows) { for (const sid of E._shadows) { this.frames.get(sid).shadowOf = f.id; f._shadows.add(sid); } E._shadows = null; }
            p._kids.set(key, f.id);
            return [E.id, f.id];
        }
        f.shadowOf = E.id;
        (E._shadows || (E._shadows = new Set())).add(f.id);
        return [f.id, E.id];
    }
    /**
     * The structural half of merging shadow `M` into its resident `E` (the Document has moved
     * the natives): each kid of M takes its cell under E, or shadows the child E has there; M
     * leaves the lattice. Returns the record `unadoptShadow` reverses.
     */
    adoptShadow(M, E) {
        const rec = { id: M.id, into: E.id, parent: M.parent, i: M.cell.i, j: M.cell.j, depth: M.depth, addrSeq: M.addrSeq || 0,
            shift: M.shift ? [M.shift[0], M.shift[1]] : null, shadows: [], kids: [] };
        if (E._shadows) E._shadows.delete(M.id);
        if (M._shadows) {
            for (const sid of M._shadows) { this.frames.get(sid).shadowOf = E.id; (E._shadows || (E._shadows = new Set())).add(sid); rec.shadows.push(sid); }
            M._shadows = null;
        }
        if (!E._kids) E._kids = new Map();
        if (M._kids) for (const cid of M._kids.values()) {
            const c = this.frames.get(cid);
            const key = cellKey(c.cell.i, c.cell.j);
            const taken = E._kids.get(key);
            const kd = { id: c.id, shadowOf: null, shadows: [] };
            c.parent = E.id; c.addrSeq = (c.addrSeq || 0) + 1; c._rec = undefined;
            if (!taken) {
                E._kids.set(key, c.id);
                if (c._shadows) for (const sid of c._shadows) { const s = this.frames.get(sid); s.parent = E.id; s.addrSeq = (s.addrSeq || 0) + 1; s._rec = undefined; }
            } else {
                const d = this.frames.get(taken);
                c.shadowOf = d.id; (d._shadows || (d._shadows = new Set())).add(c.id); kd.shadowOf = d.id;
                if (c._shadows) {
                    for (const sid of c._shadows) { const s = this.frames.get(sid); s.shadowOf = d.id; s.parent = E.id; s.addrSeq = (s.addrSeq || 0) + 1; s._rec = undefined; d._shadows.add(sid); kd.shadows.push(sid); }
                    c._shadows = null;
                }
            }
            rec.kids.push(kd);
        }
        M._kids = null;
        this.frames.delete(M.id);
        this._paths.clear(); this.addrEpoch++; this._rebuildSpine();
        return rec;
    }
    /** The inverse of `adoptShadow`: the frame back as E's shadow, its kids and shadows back under it. */
    unadoptShadow(rec) {
        const E = this.frames.get(rec.into);
        const M = { id: rec.id, parent: rec.parent, depth: rec.depth, cell: { i: rec.i, j: rec.j }, _kids: null,
            shift: rec.shift ? [rec.shift[0], rec.shift[1]] : null, addrSeq: (rec.addrSeq || 0) + 1,
            edge: cellEdge(rec.i, rec.j), centre: cellCentre(rec.i, rec.j), shadowOf: rec.into, _shadows: null };
        this.frames.set(M.id, M);
        (E._shadows || (E._shadows = new Set())).add(M.id);
        for (const sid of rec.shadows) {
            const s = this.frames.get(sid);
            if (!s) continue;
            E._shadows.delete(sid); s.shadowOf = M.id; (M._shadows || (M._shadows = new Set())).add(sid);
        }
        for (let n = rec.kids.length - 1; n >= 0; n--) {
            const kd = rec.kids[n];
            const c = this.frames.get(kd.id);
            if (!c) continue;
            const key = cellKey(c.cell.i, c.cell.j);
            if (kd.shadowOf != null) {
                const d = this.frames.get(kd.shadowOf);
                if (d && d._shadows) { d._shadows.delete(c.id); for (const sid of kd.shadows) d._shadows.delete(sid); }
                c.shadowOf = null;
                for (const sid of kd.shadows) {
                    const s = this.frames.get(sid);
                    if (!s) continue;
                    s.shadowOf = c.id; s.parent = M.id; s.addrSeq = (s.addrSeq || 0) + 1; s._rec = undefined;
                    (c._shadows || (c._shadows = new Set())).add(sid);
                }
            } else {
                if (E._kids && E._kids.get(key) === c.id) E._kids.delete(key);
                if (c._shadows) for (const sid of c._shadows) { const s = this.frames.get(sid); if (s) { s.parent = M.id; s.addrSeq = (s.addrSeq || 0) + 1; s._rec = undefined; } }
            }
            c.parent = M.id; c.addrSeq = (c.addrSeq || 0) + 1; c._rec = undefined;
            if (!M._kids) M._kids = new Map();
            M._kids.set(key, c.id);
        }
        this._paths.clear(); this.addrEpoch++; this._rebuildSpine();
        return M;
    }
    /**
     * The spine is the (0,0) chain from the root; recomputed after any re-address. It climbs
     * from `_rootId` before walking down, because `merge` can adopt the former root under a
     * parent without updating it.
     */
    _rebuildSpine() {
        let f = this._rootId != null ? this.frames.get(this._rootId) : null;
        while (f && f.parent != null) f = this.frames.get(f.parent);
        if (f) this._rootId = f.id;
        this._spine = new Map();
        while (f) { this._spine.set(f.depth, f.id); f = this.findCellChild(f.id, 0, 0); }
    }
    /**
     * The addresses a subtree had when a drag started: id -> { parent, i, j, depth } for
     * `rootId` and every descendant down to `atDepth + 3`. Deeper frames are untouched by
     * a displacement (their digits are zero), so the walk stops there. Every target is
     * computed from this one record, which is what makes a slow drag land where a fast
     * one does (SUBTREE-O1-PLAN §1).
     */
    subtreeStart(rootId, atDepth) {
        const out = new Map();
        const last = atDepth + 3;
        const stack = [this.frames.get(rootId)];
        while (stack.length) {
            const f = stack.pop();
            if (!f) continue;
            out.set(f.id, { parent: f.parent, i: f.cell.i, j: f.cell.j, depth: f.depth });
            if (f._shadows) for (const sid of f._shadows) stack.push(this.frames.get(sid));   // a shadow moves with the cell it shares
            if (f.depth >= last) continue;
            if (f._kids) for (const cid of f._kids.values()) stack.push(this.frames.get(cid));
        }
        return out;
    }
    /**
     * Where every frame of a subtree ends up when its contents are displaced by (dx, dy) in
     * the units of a frame at `atDepth`, read off the START addresses in `start`
     * (`subtreeStart`) — `displaceFrame`'s arithmetic frame for frame, which is what makes a
     * native land where the per-object path puts it. Chains resolve from the anchor down in
     * ascending depth; `at` holds the cells the movers are headed for, so a kid follows a
     * moving parent, and a step no mover claims is the live lattice's (minted if new).
     *
     * With `shiftOf(id)` (the frame's shift at the start, or null) the frame's shift — that
     * plus the rest — is kept within ±W/2: its whole cells join the frame's own digit before
     * the chain resolves (SUBTREE-O1-PLAN §2.2, `addOffset`'s carry), so a kid's chain meets
     * the frame where it is and only a native whose own table adds to it is drawn past a cell edge.
     *
     * One entry per frame, `{ id, depth, parent, i, j, rest, shift }` or `{ id, why }`, in
     * DESCENDING depth order: `rest` is `displaceFrame`'s (non-zero at `atDepth` + 1 and + 2),
     * `shift` the frame's shift after the move (with `shiftOf`; null when zero).
     */
    moveSubtreeTargets(rootId, atDepth, dx, dy, start, shiftOf = null) {
        const ids = [...start.keys()].sort((a, b) => start.get(a).depth - start.get(b).depth);
        const at = new Map();
        const out = [];
        for (const id of ids) {
            const e = start.get(id);
            // The start chain, fine end first: the subtree's own recorded cells, then the
            // live ancestors above it — they are outside the subtree and do not move.
            const chain = [];
            let s = e;
            for (;;) {
                chain.push({ i: s.i, j: s.j });
                const up = s.parent != null ? start.get(s.parent) : null;
                if (!up) break;
                s = up;
            }
            let a = s.parent != null ? this.frames.get(s.parent) : null;
            while (a && a.depth > atDepth) {
                chain.push({ i: a.cell.i, j: a.cell.j });
                a = a.parent != null ? this.frames.get(a.parent) : null;
            }
            if (!a || a.depth !== atDepth) { out.push({ id, why: "no frame at the camera depth above the start chain" }); continue; }
            chain.reverse();
            const k = chain.length;
            const X = displacementDigits(dx, k), Y = displacementDigits(dy, k);
            let shift = null;
            if (shiftOf) {
                const had = shiftOf(id);
                const s = addOffset(had ? [[had[0], had[1]]] : null, 0, X.rest, Y.rest);
                X.digits[k - 1] += s.cellX; Y.digits[k - 1] += s.cellY;
                shift = s.below && s.below[0] ? [s.below[0][0], s.below[0][1]] : null;
            }
            const ax = applyDigits(chain.map((c) => c.i), 0, X.digits);
            const ay = applyDigits(chain.map((c) => c.j), 0, Y.digits);
            let from = a.id;
            if (ax.carry || ay.carry) {
                const n = this.neighbour(a.id, ax.carry, ay.carry);
                if (!n) { out.push({ id, why: "no neighbour cell for the carry" }); continue; }
                from = n.id;
            }
            const cells = ax.chain.map((i, n) => ({ i, j: ay.chain[n] }));
            let parent = from, ok = true;
            for (let n = 0; n < cells.length - 1; n++) {
                const c = cells[n];
                const mover = at.get(parent + "|" + c.i + "," + c.j);
                if (mover) { parent = mover; continue; }
                const f = this.findCellChild(parent, c.i, c.j) || this.cellChild(parent, c.i, c.j);
                if (!f) { ok = false; break; }
                parent = f.id;
            }
            if (!ok) { out.push({ id, why: "the target chain cannot be reached" }); continue; }
            const cell = cells[cells.length - 1];
            at.set(parent + "|" + cell.i + "," + cell.j, id);
            out.push({ id, depth: e.depth, parent, i: cell.i, j: cell.j, rest: [X.rest, Y.rest], shift });
        }
        out.sort((p, q) => start.get(q.id).depth - start.get(p.id).depth);
        return out;
    }
    /**
     * Apply a `moveSubtreeTargets` array in two phases, so the movers never collide with
     * each other: every mover leaves its old cell first, then each takes its target. A
     * target cell another frame holds makes a shadow (`_take`): the newcomer's when
     * `opts.empty(id)` says the resident holds nothing, else the resident's. Returns
     * `{ moved, shadowed: [{ id, of }] }`. (`readdress` stays for a single move.)
     */
    readdressMany(targets, opts = {}) {
        const empty = opts.empty || (() => false);
        const list = (targets || []).filter((t) => t && t.parent != null && this.frames.has(t.id) && this.frames.has(t.parent));
        for (const t of list) this._leave(this.frames.get(t.id));
        // Coarsest first, so a parent that is itself moving holds its new `_kids` entry
        // before its children ask who holds their cell.
        const order = list.slice().sort((p, q) => (p.depth || 0) - (q.depth || 0));
        const moved = [], shadowed = [];
        for (const t of order) {
            const sh = this._take(this.frames.get(t.id), this.frames.get(t.parent), t.i, t.j, empty);
            if (sh) shadowed.push({ id: sh[0], of: sh[1] });
            moved.push(t.id);
        }
        this._paths.clear();
        this.addrEpoch++;
        this._rebuildSpine();
        return { moved, shadowed };
    }
    /**
     * Frames another lattice minted, added here (F67): a worker's descent runs on a
     * copy, and a kid it homes a cell over from the camera's frame names a frame this
     * lattice never saw. `data` is `serialize()`'s shape; parents come first; a frame
     * already here is left alone unless it was a root that gained a parent.
     */
    merge(data) {
        const list = ((data && data.frames) || []).slice().sort((a, b) => (a.depth - b.depth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        let added = 0;
        for (const f of list) {
            const cur = this.frames.get(f.id);
            let p = f.parent != null ? this.frames.get(f.parent) : null;
            if (cur) { if (cur.parent == null && p) this._adopt(cur, p, { i: f.i, j: f.j }); continue; }
            if (f.parent != null && !p) p = this.ensureId(f.parent);   // a parent main lost since: re-minted, not skipped (F99)
            if (f.parent != null && !p) continue;
            this._addFrame(f.id, f.parent, { i: f.i, j: f.j }, f.depth);
            added++;
        }
        return added;
    }
    /**
     * The frame an id names, re-minted when the lattice lacks it (F67; F99: natives under a `#2`
     * twin's child were never drawn). Ids are "<spine depth>[#n]/i,j[#n]/…": the spine frame first
     * (a bare "2" on a lattice without it was null, so its natives loaded undrawn), then below the
     * deepest prefix that exists each missing frame is added with its EXACT id in its birth cell, or
     * as a shadow of the cell's resident (merged at the load's end). Null, with nothing minted, for
     * an id no frame can have.
     */
    ensureId(id) {
        const hit = this.frames.get(id);
        if (hit) return hit;
        const segs = String(id).split("/");
        const top = /^(-?\d+)(#\d+)?$/.exec(segs[0]);
        const depth = top ? Number(top[1]) : NaN;
        if (!Number.isInteger(depth) || top[1] !== String(depth)) return null;
        const cells = [];
        for (let n = 1; n < segs.length; n++) {
            const m = /^(-?\d+),(-?\d+)(#\d+)?$/.exec(segs[n]);
            if (!m || !inDigit(+m[1]) || !inDigit(+m[2])) return null;
            cells.push({ i: +m[1], j: +m[2] });
        }
        if (!this.frames.has(segs[0]) && !this._ensureSpineId(segs[0], depth)) return null;
        if (segs.length === 1) return this.frames.get(id) || null;
        let k = segs.length - 1;
        while (k > 1 && !this.frames.has(segs.slice(0, k).join("/"))) k--;
        let cur = this.frames.get(segs.slice(0, k).join("/"));
        for (let n = k; n < segs.length && cur; n++) {
            const exact = segs.slice(0, n + 1).join("/"), { i, j } = cells[n - 1];
            const resident = this.findCellChild(cur.id, i, j);
            const f = this._addFrame(exact, cur.id, { i, j }, cur.depth + 1);
            if (resident) {
                cur._kids.set(cellKey(i, j), resident.id);
                f.shadowOf = resident.id;
                (resident._shadows || (resident._shadows = new Set())).add(f.id);
            }
            cur = f;
        }
        return cur && cur.id === id ? cur : null;
    }
    /** A spine id ("2", or a moved spine frame's twin "2#3") minted in the spine cell: itself, or the resident's shadow. */
    _ensureSpineId(sid, depth) {
        this.ensureSpine(depth);
        let f = this.frames.get(sid);
        if (f) return f;
        const resident = this.frames.get(this.spineAt(depth));
        const p = resident && resident.parent != null ? this.frames.get(resident.parent) : null;
        if (!p) return null;
        f = this._addFrame(sid, p.id, { i: 0, j: 0 }, depth);
        p._kids.set(cellKey(0, 0), resident.id);
        f.shadowOf = resident.id;
        (resident._shadows || (resident._shadows = new Set())).add(f.id);
        this._rebuildSpine();
        return f;
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
    // ---- grids ----
    // Constant, lattice-aligned, canvas-independent (P6). The cache partition is
    // exactly one frame (D4) and — like the cells themselves — each
    // tile is CENTRED on its index: tile i spans [i*TILE - TILE/2, i*TILE +
    // TILE/2). Cornering them on the frame origin instead is a trap, because the
    // origin is exactly where a centred zoom leaves the view: every crossing
    // would then land on a tile corner, every cede would split four ways, and a
    // hole cut at the view centre would straddle four tiles at every depth. The
    // old canvas-derived grid dodged this by construction (its `ox` centred the
    // grid on the screen), and the fix is to make that deliberate.
    makeGrid() { return { w: TILE, h: TILE, ox: -TILE / 2, oy: -TILE / 2 }; }
    /**
     * The cache grid. It is a CONSTANT — the argument is ignored, and that is the
     * point (P6): the grid used to be derived from canvas size and serialized, so
     * the same document baked a different partition on a phone than on a desktop.
     * Read by the seam and cede suites, which assert exactly that invariance.
     */
    grid() { return this.makeGrid(); }
    /**
     * The frame a key names: the frame whose id is that key when one exists (numbers included,
     * by identity), else the spine frame at that depth. So an integer level persisted for a
     * spine frame goes on naming that frame after it is re-addressed — bookmarks follow.
     */
    _frameFor(key) {
        const s = String(key);
        if (this.frames.has(s)) return this.frames.get(s);
        const id = this.spineAt(typeof key === "number" ? key : +key);
        return id ? this.frames.get(id) : null;
    }
    frameFor(key) { return this._frameFor(key); }
    // The cache square is `TileGrid.CACHE` (frameLattice.js) — the phase-0
    // grid; `key` is accepted and ignored because the grid is a constant (P6).
    // The cache READS by `touching`: a window ending on a boundary reads the
    // square above it too, which is the convention every caller here had.
    tileRect(key, i, j) { return TileGrid.CACHE.rect(i, j); }
    tileRange(key, rect) { return TileGrid.CACHE.touching(rect); }
    // ---- single-edge point transforms ----
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
    // Geometry walks cells (each frame read as its resident, `_cellParent`): co-residents are one cell
    // to the bit, and a path between them is empty (A1 C3). `isUnder` walks containers.
    _ancestors(id) {
        const out = [];
        for (let f = this.residentOf(id); f; f = this._cellParent(f)) out.push(f.id);
        return out;
    }
    /** Whether `aId`'s cell is a strict ancestor of `bId`'s. */
    isAncestor(aId, bId) {
        const a = this.residentOf(aId);
        if (!a) return false;
        for (let f = this._cellParent(this.residentOf(bId)); f; f = this._cellParent(f)) if (f === a) return true;
        return false;
    }
    /** Is `bId` what `aId` stands for: itself, a descendant, or a shadow of either? (The selection's rule; tiles use `isAncestor`.) */
    isUnder(aId, bId) {
        let f = this.frames.get(bId);
        while (f) {
            if (f.id === aId || f.shadowOf === aId) return true;
            f = f.parent != null ? this.frames.get(f.parent) : null;
        }
        return false;
    }
    /**
     * The address of `id` relative to `rootId`: the digits, coarsest first.
     * Null if `rootId` is not an ancestor (or the frame itself).
     */
    chainFrom(rootId, id) {
        const root = this.residentOf(rootId), out = [];
        let f = this.residentOf(id);
        while (f && f !== root) { out.push(f.cell); f = this._cellParent(f); }
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
        for (let f = this.residentOf(bId); f; f = this._cellParent(f)) if (seen.has(f.id)) return f.id;
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
    /** Up from `fromId`'s cell to the common one and down to `toId`'s, as resident ids; empty between co-residents. */
    _buildPath(fromId, toId) {
        const fa = this._ancestors(fromId), ta = new Set(this._ancestors(toId));
        const upIds = [];
        let common = null;
        for (const a of fa) { if (ta.has(a)) { common = a; break; } upIds.push(a); }
        if (!common) return null;
        const downIds = [];
        for (let f = this.residentOf(toId); f && f.id !== common; f = this._cellParent(f)) downIds.push(f.id);
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
    /**
     * WHERE AN OBJECT'S PICTURE IS at frame `F` (F55, geometry/offsets.js).
     *
     * The object's stored geometry never moves; its displacement table says
     * where the picture is. At depth k0 below the home the translation is
     * whole frames of every level between plus a sub-frame remainder, and this
     * turns that into the two things a reader of frame F needs:
     *
     *   F0    the frame whose UNMOVED tiles hold the pieces that are drawn in
     *         F — F walked back by the table's cell digits, level by level,
     *         exact integers with borrows; minted if it was never visited;
     *   rem   the remainder at F's depth, in F's units, which the pieces are
     *         drawn translated by (`piece.res`) and inputs are translated back
     *         by before they reach the geometry.
     *
     * Neighbouring frames' coordinates differ by whole frames, so a piece of
     * F0's tile is a piece of F's picture with the same numbers. Above the home
     * (k0 < 0) everything is sub-cell: F0 is F and only `rem` applies. At the
     * home depth a composed table (A1 C1) can carry whole frames: F0 is F's
     * neighbour the carry points back to — the home itself when that is the
     * home's cell (a co-resident's native is drawn live, A1 C3). `sh` is the raw
     * decomposition.
     */
    objShift(below, homeId, F) {
        const hd = this.depthOf(homeId), D = this.depthOf(F);
        if (hd == null || D == null) return null;
        const k0 = D - hd;
        const sh = shiftAt(below, k0);
        const at = (id) => (k0 === 0 && this.sameCell(id, homeId) ? String(homeId) : id);
        if (k0 < 0 || !hasDigits(sh)) return { F0: at(F), rem: sh.rem, sh };
        if (k0 === 0) {
            const n = this.neighbour(F, -sh.carry[0], -sh.carry[1]);
            return n ? { F0: at(n.id), rem: sh.rem, sh } : null;
        }
        const A = this.pathFrameAt(F, hd);
        const chain = A != null ? this.chainFrom(A, F) : null;
        if (!chain || chain.length !== k0) return null;
        const negX = [], negY = [];
        for (let m = 1; m <= k0; m++) { const d = sh.digits[m] || [0, 0]; negX.push(-d[0]); negY.push(-d[1]); }
        const ax = applyDigits(chain.map((c) => c.i), 0, negX);
        const ay = applyDigits(chain.map((c) => c.j), 0, negY);
        const A0 = this.neighbour(A, ax.carry - sh.carry[0], ay.carry - sh.carry[1]);
        if (!A0) return null;
        const F0 = this.frameAtChain(A0.id, ax.chain.map((i, n) => ({ i, j: ay.chain[n] })));
        return F0 ? { F0: F0.id, rem: sh.rem, sh } : null;
    }
    /**
     * The other way: the frame at F0's depth that the object's picture occupies,
     * given `sh` = `shiftAt(below, depth(F0) - hd)`. Where a ceded kid is homed:
     * it holds the unmoved square's bits and lives where the picture is.
     */
    frameShifted(F0, hd, sh) {
        const D = this.depthOf(F0);
        if (D == null) return null;
        const k0 = D - hd;
        if (k0 < 0 || !hasDigits(sh)) return F0;
        if (k0 === 0) { const n = this.neighbour(F0, sh.carry[0], sh.carry[1]); return n ? n.id : null; }
        const A0 = this.pathFrameAt(F0, hd);
        const chain = A0 != null ? this.chainFrom(A0, F0) : null;
        if (!chain || chain.length !== k0) return null;
        const dX = [], dY = [];
        for (let m = 1; m <= k0; m++) { const d = sh.digits[m] || [0, 0]; dX.push(d[0]); dY.push(d[1]); }
        const ax = applyDigits(chain.map((c) => c.i), 0, dX);
        const ay = applyDigits(chain.map((c) => c.j), 0, dY);
        const A = this.neighbour(A0, ax.carry + sh.carry[0], ay.carry + sh.carry[1]);
        if (!A) return null;
        const F = this.frameAtChain(A.id, ax.chain.map((i, n) => ({ i, j: ay.chain[n] })));
        return F ? F.id : null;
    }
    /**
     * `mapPointF` between an object's HOME and a frame where its picture is
     * seen (F55). The home is the end `homeId` names. Home to X: the exact
     * chain to X's unmoved frame, then the remainder — the point of the
     * picture as drawn in X. X to home: the remainder off first, then the
     * exact chain back from the unmoved frame — what an input made in X means
     * in the coordinates the object is stored in. When both ends are the home
     * (an input made in the object's own frame) the caller says which way,
     * `toHome` (F72). With no table this is `mapPointF`, bit for bit.
     */
    _homeToX(fromId, toId, homeId, toHome) {
        const f = String(fromId) === String(homeId), t = String(toId) === String(homeId);
        return f && !(t && toHome);
    }
    mapPointObj(p, fromId, toId, below, homeId, toHome) {
        if (!hasOffsets(below)) return this.mapPointF(p, fromId, toId);
        if (this._homeToX(fromId, toId, homeId, toHome)) {
            const s = this.objShift(below, fromId, toId);
            if (!s) return null;
            const q = this.mapPointF(p, fromId, s.F0);
            return q ? [q[0] + s.rem[0], q[1] + s.rem[1]] : null;
        }
        const s = this.objShift(below, toId, fromId);
        if (!s) return null;
        return this.mapPointF([p[0] - s.rem[0], p[1] - s.rem[1]], s.F0, toId);
    }
    mapRectObj(rect, fromId, toId, below, homeId, toHome) {
        const a = this.mapPointObj([rect.left, rect.top], fromId, toId, below, homeId, toHome);
        const b = this.mapPointObj([rect.right, rect.bottom], fromId, toId, below, homeId, toHome);
        if (!a || !b) return null;
        return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
    }
    /** Loops through the exact chain from one frame to another — what `projectF` does to a shape's loops. */
    projectLoops(loops, fromId, toId) {
        const path = this.framePath(fromId, toId);
        if (!path) return null;
        for (const id of path.up) {
            const c = this.frames.get(id).centre;
            loops = transformLoops(loops, 1 / R, c.x, c.y);
        }
        for (const id of path.down) {
            const c = this.frames.get(id).centre;
            loops = transformLoopsAbout(loops, c.x, c.y, R);
        }
        return loops;
    }
    /**
     * Loops between an object's home and a frame where its picture is seen
     * (F55) — `mapPointObj` for whole loops. Used to bring an ERASER made in
     * the active frame into the coordinates an object is stored in, and back.
     */
    projectLoopsObj(loops, fromId, toId, below, homeId, toHome) {
        if (!hasOffsets(below)) return this.projectLoops(loops, fromId, toId);
        if (this._homeToX(fromId, toId, homeId, toHome)) {
            const s = this.objShift(below, fromId, toId);
            if (!s) return null;
            const out = this.projectLoops(loops, fromId, s.F0);
            return out && (s.rem[0] || s.rem[1]) ? transformLoops(out, 1, s.rem[0], s.rem[1]) : out;
        }
        const s = this.objShift(below, toId, fromId);
        if (!s) return null;
        const moved = (s.rem[0] || s.rem[1]) ? transformLoops(loops, 1, -s.rem[0], -s.rem[1]) : loops;
        return this.projectLoops(moved, s.F0, toId);
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
                color: o.color, opacity: o.opacity };
            if (o.tile) out.tile = phaseThrough(o.tile, path, this.frames);
            return out;
        }
        if (o.type === "fill") {
            return { type: "fill", origin: "derived", id: o.id, z: o.z, polys: o.polys.map(mapAll),
                color: o.color, opacity: o.opacity };
        }
        return { type: "stroke", origin: "derived", id: o.id, z: o.z, pts: mapAll(o.pts),
            lwFrame: o.lwFrame * f, color: o.color, opacity: o.opacity };
    }

    framePointToScreen(fromKey, x, y, activeKey, inScale, inPanX, inPanY) {
        const from = this._frameFor(fromKey), active = this._frameFor(activeKey);
        if (!from || !active) return null;
        const p = this.mapPointF([x, y], from.id, active.id);
        if (!p) return null;
        return [p[0] * inScale + inPanX, p[1] * inScale + inPanY];
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
                ...(f.shift ? { shift: [f.shift[0], f.shift[1]] } : {}),
                ...(f.shadowOf != null ? { shadowOf: f.shadowOf } : {}),
            })),
        };
    }
    load(data) {
        this._paths.clear();
        this._retired = null;
        if (data && !data.__lattice && Object.keys(data).length) {
            const e = new Error("This drawing was saved in the pre-lattice format and cannot be opened.");
            e.code = "LEGACY_FORMAT";
            throw e;
        }
        this.frames = new Map();
        this._spine = new Map();
        this._rootId = null;
        // A load's frames are not frame-GC candidates: the host sweeps once the store's state is in (F94).
        const minted = this.minted;
        this.minted = null;
        try { this._loadFrames(data); } finally { this.minted = minted; }
    }
    _loadFrames(data) {
        const list = (data && data.frames) || [];
        // Parents before children, so _kids is wired as we go.
        const byId = new Map(list.map((f) => [f.id, f]));
        const done = new Set();
        const put = (f) => {
            if (!f || done.has(f.id)) return;
            done.add(f.id);
            if (f.parent != null && byId.has(f.parent)) put(byId.get(f.parent));
            else if (f.parent != null && !this.frames.has(f.parent)) this.ensureId(f.parent);   // not an unreachable orphan (F99)
            this._addFrame(f.id, f.parent, { i: f.i, j: f.j }, f.depth);
            if (f.shift) this.frames.get(f.id).shift = [f.shift[0], f.shift[1]];
        };
        for (const f of list) put(f);
        if (!this.frames.has("0")) this._addFrame("0", null, { i: 0, j: 0 }, 0);
        // Shadows: the resident keeps the cell whatever order the two were added in.
        for (const f of list) {
            if (f.shadowOf == null) continue;
            const s = this.frames.get(f.id), r = this.frames.get(f.shadowOf);
            if (!s || !r || r.parent !== s.parent || r.cell.i !== s.cell.i || r.cell.j !== s.cell.j) continue;
            s.shadowOf = r.id;
            (r._shadows || (r._shadows = new Set())).add(s.id);
            const p = this.frames.get(s.parent);
            if (p && p._kids) p._kids.set(cellKey(s.cell.i, s.cell.j), r.id);
        }
        this._rebuildSpine();
    }
    ensureSpine(depth) {
        if (this.spineAt(depth) != null) return this.spineAt(depth);
        let [lo, hi] = [Infinity, -Infinity];
        for (const d of this._spine.keys()) { if (d < lo) lo = d; if (d > hi) hi = d; }
        if (lo === Infinity) { this._addFrame("0", null, { i: 0, j: 0 }, 0); lo = hi = 0; }
        while (depth < lo) {
            lo--;
            const f = this.frames.get(String(lo)) || this._addFrame(String(lo), null, { i: 0, j: 0 }, lo);
            const child = this.frames.get(this._spine.get(lo + 1));
            if (child && child.parent == null) this._adopt(child, f, { i: 0, j: 0 });
        }
        while (depth > hi) { hi++; this.cellChild(this._spine.get(hi - 1), 0, 0); }
        return this.spineAt(depth);
    }
    reset() {
        this._paths.clear();
        this._retired = null;
        this.frames = new Map();
        this._spine = new Map();
        this._rootId = null;
        this._addFrame("0", null, { i: 0, j: 0 }, 0);
    }
    resize(width, height) {
        // Grids are lattice constants now, so a resize changes nothing about
        // geometry — only which cell a given screen point falls in.
        this.width = width; this.height = height;
    }
}

