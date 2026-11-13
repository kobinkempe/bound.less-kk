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
 * IDS. A frame's id never changes once minted: ids are Document keys and
 * tile-cache keys. The origin cell of an origin chain is the "spine" and keeps
 * the historical id, the depth as a string ("0", "1", "-2"). Any other frame is
 * `h<parent's code>:<i>,<j>` (`childName`), the same length at every depth;
 * frames minted before 2026-11-11 keep their birth paths `<parentId>/<i>,<j>`,
 * which grew with depth (OPEN-FLAGS F192). Crossing DOWN mints the coarser cell
 * containing the current one, so the spine stays the spine and existing ids are
 * untouched.
 *
 * WHY a tree at all: a single frame per depth has a finite float64 sharp
 * radius. A pan of D units at a coarse depth becomes D x R^k a depth k deeper —
 * one measured dance put the view at 2.1e17 units, where float64 resolves 32
 * units = 42 px and pen input visibly snapped to a grid. Cells keep every
 * stored coordinate inside [-W/2, W/2) BY CONSTRUCTION.
 */
import { transformLoops, transformLoopsAbout } from "./geometry/arcShape";
import { hasOffsets, shiftAt, hasDigits, eachDigit, addOffset } from "./geometry/offsets";
import * as dm from "./depth";
import {
    R, W, TILE, TileGrid, cellEdge, cellCentre, cellOf, carryDigit, inDigit,
    displacementDigits, displacementDigitsSparse, applyDigits, tilePhase, childTilePhase,
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
 * A frame id's code: 14 base-36 characters, two 32-bit lanes of cyrb53's mix. A child's name is its parent's code
 * and its cell, so two lattice copies name a cell alike (a worker's minted frames merge by id, F67).
 */
export function frameCode(id) {
    const s = String(id);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let k = 0; k < s.length; k++) {
        const c = s.charCodeAt(k);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(36).padStart(7, "0") + (h2 >>> 0).toString(36).padStart(7, "0");
}
/** The name a child of `parentId` at cell (i, j) is born with; `_childId` adds `#n` when it is taken. */
export const childName = (parentId, i, j) => "h" + frameCode(parentId) + ":" + i + "," + j;
const HASHED_ID = /^h([0-9a-z]{14}):(-?\d+),(-?\d+)(#\d+)?$/;
/**
 * A STRETCH: frames each in its parent's own cell (i, j), below the frame coded T. The k-th is `h<T>:i,j` for k = 1 and
 * `s<T>:i,j*k` below, so a level of a run is named in O(1) at any depth (compact-lattice design, "Ids").
 */
const STRETCH_ID = /^s([0-9a-z]{14}):(-?\d+),(-?\d+)\*(\d+)(#\d+)?$/;
const stretchName = (T, i, j, k) => (k === 1 ? `h${T}:${i},${j}` : `s${T}:${i},${j}*${k}`);
/** A cell a run's levels may hold: never on its parent's edge, so a run level's ring is its parent's kids (|i|, |j| ≤ R/2 − 2). */
const RUN_EDGE = R / 2 - 2;
const runCell = (i, j) => Math.abs(i) <= RUN_EDGE && Math.abs(j) <= RUN_EDGE;
// A path's steps (`_pathOps`): [kind, cx, cy, n]… — up `x/R + c`, a whole-frame side hop, down `(x − c)·R`.
const UP = 0, SIDE = 1, DOWN = 2;
/** Bitwise equality of two numbers, NaN and −0 included: a run's step that gives back its input gives it back for ever. */
const same = Object.is;
/** A chain of cells as runs of one cell, coarse first. */
/** A chain as runs of one cell: its items are cells ({ i, j }) or runs already ({ i, j, n }, `chainSegs`). */
const segsOf = (chain) => {
    const out = [];
    for (const c of chain) {
        const n = c.n || 1, l = out[out.length - 1];
        if (l && l.i === c.i && l.j === c.j) l.n = dm.add(l.n, n); else out.push({ i: c.i, j: c.j, n });
    }
    return out;
};
/**
 * `applyDigits` on a chain of runs (`chainSegs`): `addX`, `addY` map a level's index (0 the coarsest) to a digit, carried
 * fine to coarse with the same arithmetic. Levels no digit or carry reaches are copied as runs. { segs, carry: [cx, cy] }.
 */
function addDigitsSegs(segs, addX, addY) {
    const starts = [];
    let total = 0;
    for (const s of segs) { starts.push(total); total = dm.add(total, s.n); }
    const segAt = (pos) => {
        let lo = 0, hi = segs.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (dm.le(starts[mid], pos)) lo = mid; else hi = mid - 1; }
        return segs[lo];
    };
    const set = new Map();   // level index -> its new [i, j]
    const carryAlong = (adds, axis) => {
        const keys = [...adds.keys()].filter((q) => adds.get(q) && dm.ge(q, 0) && dm.lt(q, total)).sort((a, b) => dm.cmp(b, a));
        let carry = 0, q = 0, pos = keys.length ? keys[0] : -1;
        while (dm.ge(pos, 0)) {
            const add = adds.get(pos) || 0;
            if (!add && !carry) {
                while (q < keys.length && dm.ge(keys[q], pos)) q++;
                pos = q < keys.length ? keys[q] : -1;
                continue;
            }
            let e = set.get(pos);
            if (!e) { const s = segAt(pos); set.set(pos, e = [s.i, s.j]); }
            const c = carryDigit(e[axis] + add + carry);
            e[axis] = c.digit; carry = c.carry;
            pos = dm.sub(pos, 1);
        }
        return carry;
    };
    const cx = carryAlong(addX, 0), cy = carryAlong(addY, 1);
    const at = [...set.keys()].sort(dm.cmp), out = [];
    const put = (i, j, n) => { if (dm.le(n, 0)) return; const l = out[out.length - 1]; if (l && l.i === i && l.j === j) l.n = dm.add(l.n, n); else out.push({ i, j, n }); };
    let q = 0;
    segs.forEach((s, k) => {
        let from = starts[k];
        const end = dm.add(from, s.n);
        for (; q < at.length && dm.lt(at[q], end); q++) {
            put(s.i, s.j, dm.sub(at[q], from));
            const e = set.get(at[q]);
            put(e[0], e[1], 1);
            from = dm.add(at[q], 1);
        }
        put(s.i, s.j, dm.sub(end, from));
    });
    return { segs: out, carry: [cx, cy] };
}
/** (x, y) through a path's steps (`_pathOps`) into `out`, a level a step; a run's steps stop once the point repeats. */
function applyOps(ops, x, y, out) {
    for (let k = 0; k < ops.length; k += 4) {
        const t = ops[k], cx = ops[k + 1], cy = ops[k + 2];
        let n = dm.toNumber(ops[k + 3]);   // a run's steps stop once the point repeats, within ~100
        if (t === SIDE) { x += cx; y += cy; continue; }
        if (t === UP) {
            while (n-- > 0) { const nx = x / R + cx, ny = y / R + cy; if (same(nx, x) && same(ny, y)) break; x = nx; y = ny; }
        } else {
            while (n-- > 0) { const nx = (x - cx) * R, ny = (y - cy) * R; if (same(nx, x) && same(ny, y)) break; x = nx; y = ny; }
        }
    }
    out[0] = x; out[1] = y;
    return out;
}
/** Two values of plain data equal number for number (NaN and −0 by bits). */
function sameData(a, b) {
    if (typeof a === "number") return typeof b === "number" && same(a, b);
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const key of ka) if (!sameData(a[key], b[key])) return false;
    return true;
}
/** `step` applied n times, stopping once its result is its input (`sameData`): the levels of a run. */
function repeat(v, n, step) {
    if (n === 1) return step(v);
    while (n-- > 0) { const w = step(v); if (sameData(w, v)) break; v = w; }
    return v;
}
/** Loops through a path's steps: a level up `transformLoops` by 1/R about the cell centre, down `transformLoopsAbout` (exact). */
function loopsThrough(loops, ops) {
    for (let k = 0; k < ops.length; k += 4) {
        const t = ops[k], cx = ops[k + 1], cy = ops[k + 2];
        loops = repeat(loops, ops[k + 3], t === UP ? (l) => transformLoops(l, 1 / R, cx, cy)
            : t === SIDE ? (l) => transformLoops(l, 1, cx, cy) : (l) => transformLoopsAbout(l, cx, cy, R));
    }
    return loops;
}

/**
 * An object's tile phase, carried along a frame path. Up a level the grid
 * coarsens by R and the cell centre comes back; down a level it is
 * `childTilePhase`. A sideways hop is a whole number of frames and leaves the
 * phase alone, which is exactly why two numbers are enough (bible 6.6).
 */
function phaseThrough(tile, ops) {
    let px = tile[0], py = tile[1];
    for (let k = 0; k < ops.length; k += 4) {
        const t = ops[k], cx = ops[k + 1], cy = ops[k + 2];
        if (t === SIDE) continue;
        for (let n = ops[k + 3]; n-- > 0;) {
            const nx = t === UP ? tilePhase(px / R + cx) : childTilePhase(px, cx, R);
            const ny = t === UP ? tilePhase(py / R + cy) : childTilePhase(py, cy, R);
            if (same(nx, px) && same(ny, py)) break;
            px = nx; py = ny;
        }
    }
    return [px, py];
}
const EMPTY_PATH = { up: [], down: [] };
const NEVER = () => false;
/** A serialized frame (a file's, a worker's) with its depth and run length read (`depth.parse`: a big one is a string); null when bad. */
function parsedFrame(f) {
    if (!f) return null;
    const run = Array.isArray(f.run), depth = dm.parse(f.depth), n = run ? dm.parse(f.run[0]) : null;
    if (depth == null || (run && n == null)) return null;
    return depth === f.depth && (!run || n === f.run[0]) ? f : { ...f, depth, ...(run ? { run: [n, f.run[1], f.run[2]] } : {}) };
}
// eslint-disable-next-line no-restricted-properties -- display only: the zoom's log for labels and the scale bar (F167)
const LOG10_R = Math.log10(R);

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
        this._codes = null;        // frameCode -> ids, built when a hashed id is re-minted (`ensureId`)
        // Runs (compact-lattice design): `latticeSeq` counts every mint, forget, fold and unfold (`frames.size` no longer
        // counts levels); `_anyRuns` stays false until a run exists, so a lattice without one pays nothing for them.
        this.latticeSeq = 0;
        this._anyRuns = false;
        this._loading = false;
        // Runs kept: a bulk mint (`ensureSpine` past the bottom, a stretch `_walkSegs` mints) of at least this many levels
        // is one frame and a run (`true`: 2), and frame GC folds; false: a frame a level. The engine sets 64 (F202).
        this.bulkRuns = false;
        this._addFrame("0", null, { i: 0, j: 0 }, 0);
    }

    // ---- frame primitives ----
    // A frame: { id, parent, depth, cell, _kids, shift, addrSeq, shadowOf, _shadows, private, edge, centre, run }.
    // `centre` is the cell's centre in its parent's units, the exact integer i·G: transforms subtract it BEFORE scaling,
    // which makes magnification exact (arcShape.transformLoopsAbout). `run` { n, i, j, c }: n empty levels of cell (i, j)
    // lie between the frame and its `parent`, so depth = parent.depth + n + 1 (compact-lattice design, "Representation").
    _newFrame(id, parent, depth, cell, run) {
        return {
            id, parent, depth, cell, _kids: null,
            shift: null, addrSeq: 0,
            shadowOf: null, _shadows: null,   // co-residency: the resident of a shared cell, its co-residents (A1 C3)
            private: null,                    // a family's private frame: the id its chain hangs from (A1 C4)
            edge: parent == null ? null : cellEdge(cell.i, cell.j),
            centre: parent == null ? null : cellCentre(cell.i, cell.j),
            run: run ? { n: run.n, i: run.i, j: run.j, c: cellCentre(run.i, run.j) } : null,
        };
    }
    _addFrame(id, parent, cell, depth, run = null) {
        this._paths.clear();
        this.latticeSeq++;
        if (this.minted) this.minted.add(id);
        const p = parent != null ? this.frames.get(parent) : null;
        const ki = run ? run.i : cell.i, kj = run ? run.j : cell.j;
        // A frame where a run is, or beside one, unfolds it there first (a run level is empty with nothing beside it).
        if (p && this._anyRuns && !this._loading) this._clearAround(p, ki, kj);
        const f = this._newFrame(id, parent, depth, cell, run);
        this.frames.set(id, f);
        if (run) this._anyRuns = true;
        if (this._codes) this._codeAdd(id);
        if (parent == null && (this._rootId == null || dm.lt(depth, this.frames.get(this._rootId).depth))) this._rootId = id;
        if ((!run || (ki === 0 && kj === 0)) && this._isSpine(parent, cell.i, cell.j)) this._spine.set(depth, id);
        if (p) {
            const key = cellKey(ki, kj), E = run ? null : this._kidAt(p, key);
            if (!p._kids) p._kids = new Map();
            if (!p._kids.has(key)) p._kids.set(key, id);
            if (E && E !== f) this._joinGroups(f, E, NEVER);   // added where a frame is: its co-resident
        }
        return f;
    }
    /** The key `f` is entered under in its container's kids: its run's cell, else its own. */
    _entryKey(f) { return f.run ? cellKey(f.run.i, f.run.j) : cellKey(f.cell.i, f.cell.j); }
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
        if (a === b) return true;
        const fa = this.frames.get(String(a));
        if (!fa || (fa.shadowOf == null && !fa._shadows)) return String(a) === String(b);   // alone in its cell: the common case
        return (fa.shadowOf != null ? this.frames.get(fa.shadowOf) : fa) === this.residentOf(b);
    }
    /** The resident of child cell `key` of `p`'s cell, looked up through every frame sharing that cell; null where it is a run level. */
    _kidAt(p, key) { const E = this._entryAt(p, key); return E && !E.run ? E : null; }
    /** What child cell `key` of `p`'s cell enters: its resident, or the frame of the run whose top level it is. */
    _entryAt(p, key) {
        let v = null;
        for (const g of this.cellFrames(p.id)) if (g._kids && (v = g._kids.get(key))) break;
        return v ? this.residentOf(v) : null;
    }

    // ---- runs (compact-lattice design) ----
    // A run's levels hold nothing, have one kid and nothing beside them, and are not on an edge. Since a run cell's ring
    // is inside its parent, that is "the parent's group has no other kid at the run cell or around it": `_clearAround`
    // keeps it at every frame a cell gains, and `fold` checks it.

    /** [T, k]: a child of `P` at cell (i, j) is the (k + 1)-th level of the stretch below the frame coded T (k = 0: P is T). */
    _stretchOf(P, i, j) {
        if (runCell(i, j) && P.cell.i === i && P.cell.j === j) {
            const c = P.id.charCodeAt(0);
            const m = c === 115 ? STRETCH_ID.exec(P.id) : c === 104 ? HASHED_ID.exec(P.id) : null;
            const k = m && c === 115 ? dm.parse(m[4]) : 1;
            if (m && +m[2] === i && +m[3] === j && k != null) return [m[1], k];
        }
        return [frameCode(P.id), 0];
    }
    /** The id the per-level lattice gives the frame m levels below `P` in a stretch of cell (i, j), before `#n`. */
    _levelId(P, i, j, m) {
        if (i === 0 && j === 0 && this._spine.get(P.depth) === P.id) return String(dm.add(P.depth, m));
        const [T, k] = this._stretchOf(P, i, j);
        return stretchName(T, i, j, dm.add(k, m));
    }
    /** `id`, or `id#n` for the first n it is free at (a frame's or a retired id is never taken again). */
    _untaken(id) {
        const taken = (x) => this.frames.has(x) || (this._retired != null && this._retired.has(x));
        if (!taken(id)) return id;
        let n = 2;
        while (taken(id + "#" + n)) n++;
        return id + "#" + n;
    }
    /**
     * Level m (1 = the top) of `K`'s run made a frame, under `want` when free, else the per-level lattice's id; the run
     * splits around it. Not `_addFrame`, which would make it K's co-resident.
     */
    _unfold(K, m, want = null) {
        const r = K.run, P = this.frames.get(K.parent), key = cellKey(r.i, r.j);
        const id = want != null && !this.frames.has(want) ? want : this._untaken(this._levelId(P, r.i, r.j, m));
        const M = this._newFrame(id, P.id, dm.add(P.depth, m), { i: r.i, j: r.j }, dm.gt(m, 1) ? { n: dm.sub(m, 1), i: r.i, j: r.j } : null);
        M._kids = new Map([[dm.lt(m, r.n) ? key : cellKey(K.cell.i, K.cell.j), K.id]]);
        this.frames.set(id, M);
        P._kids.set(key, id);
        K.parent = id;
        K.run = dm.lt(m, r.n) ? { n: dm.sub(r.n, m), i: r.i, j: r.j, c: r.c } : null;
        if (r.i === 0 && r.j === 0 && this._spine.get(P.depth) === P.id) this._spine.set(M.depth, id);
        if (this.minted) this.minted.add(id);
        if (this._codes) this._codeAdd(id);
        this._paths.clear();
        this.latticeSeq++;
        return M;
    }
    /** Child cell `key` of `p`'s cell as a frame: a run's top level there is unfolded (under `want` when free). Null for none. */
    _unfoldAt(p, key, want = null) {
        const E = this._entryAt(p, key);
        return E && E.run ? this._unfold(E, 1, want) : E;
    }
    /** A frame is about to hold child cell (i, j) of `p`'s cell: a run whose top level is that cell or beside it unfolds there. */
    _clearAround(p, i, j) {
        for (const g of this.cellFrames(p.id)) {
            if (!g._kids) continue;
            for (let di = -1; di <= 1; di++) {
                for (let dj = -1; dj <= 1; dj++) {
                    if (!runCell(i + di, j + dj)) continue;
                    const v = g._kids.get(cellKey(i + di, j + dj)), K = v != null ? this.frames.get(v) : null;
                    if (K && K.run) this._unfold(K, 1);
                }
            }
        }
    }
    /** Whether `p`'s cell holds a kid in one of the eight cells around (i, j). */
    _occupiedAround(p, i, j) {
        for (const g of this.cellFrames(p.id)) {
            if (!g._kids) continue;
            for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if ((di || dj) && g._kids.has(cellKey(i + di, j + dj))) return true;
        }
        return false;
    }
    /**
     * Frame `id` becomes a level of the run of the one frame it contains (compact-lattice design, "Folding"): it holds
     * nothing (`empty`), shares its cell with no frame, has no shift, was never moved, is not private, is not on its
     * parent's edge, has no frame beside it, and its own run and its kid's are of its cell. False if refused.
     */
    fold(id, empty = NEVER) {
        const f = this.frames.get(String(id));
        if (!f || f.parent == null || f.shadowOf != null || (f._shadows && f._shadows.size) || f.private != null || f.addrSeq
            || (f.shift && (f.shift[0] || f.shift[1])) || !f._kids || f._kids.size !== 1) return false;
        const { i, j } = f.cell;
        if (!runCell(i, j) || (f.run && (f.run.i !== i || f.run.j !== j))) return false;
        const K = this.frames.get(f._kids.values().next().value), P = this.frames.get(f.parent);
        if (!K || !P || K.parent !== f.id || K.shadowOf != null || (K._shadows && K._shadows.size) || K.private != null) return false;
        if (K.run && (K.run.i !== i || K.run.j !== j)) return false;
        if (!f.run && this._occupiedAround(P, i, j)) return false;   // a run frame's level has nothing beside it already
        if (!empty(f.id)) return false;
        const key = cellKey(i, j);
        if (P._kids.get(key) !== f.id) return false;
        P._kids.set(key, K.id);
        K.parent = P.id;
        K.run = { n: dm.add(dm.add(f.run ? f.run.n : 0, 1), K.run ? K.run.n : 0), i, j, c: f.centre };
        this.frames.delete(f.id);
        if (this._spine.get(f.depth) === f.id) this._spine.delete(f.depth);
        if (this.minted) this.minted.delete(f.id);
        this._codes = null;
        this._paths.clear();
        this.latticeSeq++;
        this._anyRuns = true;
        return true;
    }
    /** `_addFrame` under `p`, with the run it had (`run`) where its cells are free still, else under the lattice's levels there. */
    _addBelow(id, p, cell, depth, run) {
        if (run && (this._entryAt(p, cellKey(run.i, run.j)) || this._occupiedAround(p, run.i, run.j))) {
            const q = this._walkSegs(p, [{ i: run.i, j: run.j, n: run.n }], true);
            return q ? this._remint(id, q, cell.i, cell.j) : null;
        }
        return this._addFrame(id, p.id, cell, depth, run);
    }
    /** The shortest stretch a bulk mint makes a run of (`bulkRuns`). */
    _runMin() { return this.bulkRuns === true ? 2 : this.bulkRuns; }
    /** A frame n levels below `p` with cell (i, j) at every level between, as one frame and a run; the per-level lattice's id. */
    _mintRun(p, i, j, n) {
        return this._addFrame(this._untaken(this._levelId(p, i, j, n)), p.id, { i, j }, dm.add(p.depth, n), dm.gt(n, 1) ? { n: dm.sub(n, 1), i, j } : null);
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
    /**
     * The frames near F, each once, co-residents together (F172): `fn(f, k, s, x, y, a)` is asked of each and returns true
     * to descend into its kids. `a` is F's resident k levels up, and f's units map into a's as p·s + (x, y). A frame at or
     * above F's depth is placed by whole cells from `a` (s = 1, exact). Summed as floats in F's units, a place k levels up
     * cancels ~2^(16+12k): from about five levels up a neighbour's subtree was lost (F179), and a co-resident chain parting
     * 20 levels up from F's was never reached (F170). Below F the float place is small (k = 0). F's ancestors and their
     * co-residents are asked at (k, 1, 0, 0); their kids on F's side are not. The walk keeps its own stack, kids pushed
     * last first, so the order is a recursion's at any depth (a recursion overflowed under a chain 9,500 levels deep: F200).
     *
     * Runs: `fn` is asked of frames only. A kid's run is stepped a level at a time by the same recurrences, and skipped
     * once its numbers repeat and the steps ahead are the same; `a` at a run level of F's chain is a handle
     * `{ id: null, depth, runLevel: true, below }` (`below` the chain frame under it). A run level holds nothing and a
     * kid's square lies in its parent's, so a callback that refuses a run level would refuse what is below it.
     */
    nearWalk(F, fn) {
        // F's chain: its frames, and the level each is at (levels above F's).
        const anc = [], ks = [];
        for (let f = this.residentOf(F), k = 0; f; f = f.parent != null ? this.residentOf(f.parent) : null) {
            anc.push(f); ks.push(k);
            if (!f.centre) break;
            k = dm.add(k, f.run ? dm.add(f.run.n, 1) : 1);
        }
        const at = (k) => {   // the chain frame at or below level k
            let lo = 0, hi = ks.length - 1;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (dm.le(ks[mid], k)) lo = mid; else hi = mid - 1; }
            return lo;
        };
        const cellAt = (k) => { const x = at(k); return ks[x] === k ? anc[x].cell : anc[x].run; };
        const handles = new Map();
        const chainAt = (k) => {
            const x = at(k);
            if (ks[x] === k) return anc[x];
            let h = handles.get(k);
            if (!h) handles.set(k, h = { id: null, depth: dm.sub(anc[0].depth, k), runLevel: true, below: anc[x] });
            return h;
        };
        // A step into a kid at cell (ci, cj), centre (cx, cy), from state st = [j, s, x, y] (in place): j levels above F's,
        // j > 0 whole cells from F's chain at that level, j = 0 scale and place in F's units.
        const step = (st, ci, cj, cx, cy) => {
            const j = st[0];
            if (dm.gt(j, 1)) { const j1 = dm.sub(j, 1), a = cellAt(j1); st[0] = j1; st[1] = 0; st[2] = st[2] * R + ci - a.i; st[3] = st[3] * R + cj - a.j; }
            else if (j === 1) { const a = anc[0].cell; st[0] = 0; st[1] = 1; st[2] = (st[2] * R + ci - a.i) * W; st[3] = (st[3] * R + cj - a.j) * W; }
            else { const s = st[1]; st[1] = s / R; st[2] = cx * s + st[2]; st[3] = cy * s + st[3]; }
        };
        // Levels a repeated state stays the same through: below F all of them; above it, while every finite number (a 0:
        // that cell digit equals the chain's) meets the same digit on F's chain, down to level 1.
        const skip = (st, r, left) => {
            if (st[0] === 0) return left;
            const L = dm.sub(st[0], 1);
            if (dm.lt(L, 1)) return 0;
            const fx = Number.isFinite(st[2]), fy = Number.isFinite(st[3]);
            if (!fx && !fy) return dm.min(left, L);
            const x = at(L), lo = ks[x] === L ? L : dm.add(ks[x], 1), c = ks[x] === L ? anc[x].cell : anc[x].run;
            if ((fx && c.i !== r.i) || (fy && c.j !== r.j)) return 0;
            return dm.min(left, dm.add(dm.sub(L, dm.max(lo, 1)), 1));
        };
        const place = (j, s, x, y, c) => {
            const st = [j, s, x, y];
            const r = c.run;
            for (let left = r ? r.n : 0; dm.gt(left, 0);) {
                const s0 = st[1], x0 = st[2], y0 = st[3];
                step(st, r.i, r.j, r.c.x, r.c.y);
                left = dm.sub(left, 1);
                if (dm.gt(left, 0) && same(st[1], s0) && same(st[2], x0) && same(st[3], y0)) {
                    const n = skip(st, r, left);
                    left = dm.sub(left, n);
                    if (dm.gt(st[0], 0)) st[0] = dm.sub(st[0], n);
                }
            }
            step(st, c.cell.i, c.cell.j, c.centre.x, c.centre.y);
            return st;
        };
        const seen = new Set(), stack = [];
        // An entry [f, j, s, x, y]: below F (j = 0) f's scale and place, above it whole cells (x = nx, y = ny).
        const flat = (f, j, s, x, y) => {
            stack.push([f, j, s, x, y]);
            while (stack.length) {
                const [g, j, s, x, y] = stack.pop();
                if (seen.has(g.id)) continue;
                seen.add(g.id);
                const kids = (j === 0 ? fn(g, 0, s, x, y, anc[0]) : fn(g, j, 1, x * W, y * W, chainAt(j))) ? this.childrenOf(g.id) : null;
                if (!kids) continue;
                for (let n = kids.length - 1; n >= 0; n--) {
                    const c = kids[n];
                    if (!c.centre) continue;
                    const st = place(j, s, x, y, c);
                    stack.push([c, st[0], st[1], st[2], st[3]]);
                }
            }
        };
        for (const f of this.cellFrames(F)) flat(f, 0, 1, 0, 0);
        for (let x = 1; x < anc.length; x++) {
            const child = anc[x - 1], k = ks[x];
            for (const p of this.cellFrames(anc[x].id)) {
                if (seen.has(p.id)) continue;
                seen.add(p.id);
                if (!fn(p, k, 1, 0, 0, anc[x])) continue;
                for (const sib of this.childrenOf(p.id)) {
                    if (this.sameCell(sib.id, child.id) || !sib.centre) continue;
                    const st = place(k, 0, 0, 0, sib);
                    flat(sib, st[0], st[1], st[2], st[3]);
                }
            }
        }
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
    /** Group `list` (frames at one cell) as one: `r`, else its present resident unless a private one, else a non-private frame, is the resident. */
    _regroup(list, r = null) {
        if (!list.length) return null;
        this._paths.clear();
        r = r || list.find((g) => g.shadowOf == null && g.private == null) || list.find((g) => g.private == null) || list.find((g) => g.shadowOf == null) || list[0];
        r.shadowOf = null; r._shadows = null;
        for (const g of list) {
            if (g === r) continue;
            g.shadowOf = r.id; g._shadows = null;
            (r._shadows || (r._shadows = new Set())).add(g.id);
        }
        return r;
    }
    /**
     * Residents `a` and `b` of one cell become one group; an empty childless `b` yields the cell to `a`, and a private frame
     * never keeps it from a public one nor takes it from one (a mover's empty public frame is childless mid-move; F138).
     * Returns the resident.
     */
    _joinGroups(a, b, empty) {
        this._paths.clear();
        const yieldB = (a.private == null) !== (b.private == null) ? a.private == null : !(b._kids && b._kids.size) && empty(b.id);
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
    /**
     * The kids of the frames sharing resident `r`'s cell, one group per child cell (after a join), all the way down.
     * Its own stack, an entry a cell's loop part-way, so the joins come in a recursion's order at any depth (a recursion
     * overflowed undoing a move of a chain 9,500 levels deep: OPEN-FLAGS F201).
     */
    _linkKids(r, empty) {
        const group = (id) => { const gs = this.cellFrames(id); this._clearGroupRuns(gs); return { gs, gi: 0, it: null, at: new Map() }; };
        const stack = [group(r.id)];
        while (stack.length) {
            const t = stack[stack.length - 1];
            if (!t.it) {
                if (t.gi >= t.gs.length) { stack.pop(); continue; }
                const g = t.gs[t.gi++];
                if (g._kids) t.it = g._kids[Symbol.iterator]();
                continue;
            }
            const nx = t.it.next();
            if (nx.done) { t.it = null; continue; }
            const [key, cid] = nx.value;
            const c = this.residentOf(cid), had = t.at.get(key);
            if (!c || had === c) continue;
            if (!had) { t.at.set(key, c); continue; }
            const j = this._joinGroups(c, had, empty);
            t.at.set(key, j);
            stack.push(group(j.id));
        }
    }
    /** Frames just sharing a cell: a run of one's kids whose top level another's kid is at or beside unfolds there. */
    _clearGroupRuns(gs) {
        if (!this._anyRuns || gs.length < 2) return;
        for (const g of gs) {
            if (!g._kids) continue;
            const runs = [];
            for (const cid of g._kids.values()) { const K = this.frames.get(cid); if (K && K.run) runs.push(K); }
            for (const K of runs) {
                const { i, j } = K.run;
                const near = (h) => { for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (h._kids.has(cellKey(i + di, j + dj))) return true; return false; };
                if (gs.some((h) => h !== g && h._kids && near(h))) this._unfold(K, 1);
            }
        }
    }
    /** Frames `A` leave a cell that frames `B` keep: no child cell's group holds both sides' kids, all the way down (its own stack, as `_linkKids`). */
    _splitKids(A, B) {
        const call = (A2, B2) => (A2.length && B2.length ? { A: A2, inA: new Set(A2.map((g) => g.id)), seen: new Set(), ai: 0, it: null } : null);
        const first = call(A, B);
        const stack = first ? [first] : [];
        while (stack.length) {
            const t = stack[stack.length - 1];
            if (!t.it) {
                if (t.ai >= t.A.length) { stack.pop(); continue; }
                const a = t.A[t.ai++];
                if (a._kids) t.it = a._kids.values();
                continue;
            }
            const nx = t.it.next();
            if (nx.done) { t.it = null; continue; }
            const r = this.residentOf(nx.value);
            if (!r || t.seen.has(r.id)) continue;
            t.seen.add(r.id);
            const G = this.cellFrames(r.id), A2 = G.filter((g) => t.inA.has(g.parent)), B2 = G.filter((g) => !t.inA.has(g.parent));
            if (!B2.length) continue;
            this._regroup(A2); this._regroup(B2);
            const c = call(A2, B2);
            if (c) stack.push(c);
        }
    }
    spineAt(depth) { return this._spine.get(depth) || null; }
    /** The resident of `f`'s container's cell: the lattice parent every geometric walk reads. */
    _cellParent(f) { return f && f.parent != null ? this.residentOf(f.parent) : null; }
    /** The resident at `depth` on `fromId`'s cell chain, else the spine frame there; null where the chain is a run level there. */
    pathFrameAt(fromId, depth) {
        let f = this.residentOf(fromId);
        while (f && dm.gt(f.depth, depth)) {
            if (f.run && dm.le(dm.sub(f.depth, f.run.n), depth)) return null;
            f = this._cellParent(f);
        }
        if (f && f.depth === depth) return f.id;
        return this.spineAt(depth);
    }
    /** The frame at or above `depth` on `id`'s cell chain nearest it (a run level at `depth` gives the frame above the run). */
    _frameAbove(id, depth) {
        let f = this.residentOf(id);
        while (f && dm.gt(f.depth, depth)) f = this._cellParent(f);
        return f;
    }
    /** The frame at `depth` on `id`'s cell chain, a run level there unfolded; null when the chain does not reach it. */
    _frameAt(id, depth) {
        let f = this.residentOf(id);
        while (f && dm.gt(f.depth, depth)) {
            const top = f.run ? dm.sub(f.depth, f.run.n) : null;   // the run's top level
            if (top != null && dm.le(top, depth)) return this._unfold(f, dm.add(dm.sub(depth, top), 1));
            f = this._cellParent(f);
        }
        return f && f.depth === depth ? f : null;
    }
    /** Every level from d0 to d1 on `id`'s cell chain a frame (a job that cedes a piece a level needs one), bottom up. */
    unfoldLevels(id, d0, d1) {
        if (!this._anyRuns) return;
        for (let d = d1, f = this.residentOf(id); f && dm.ge(d, d0); d = dm.sub(d, 1)) f = this._frameAt(f.id, d);
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
    // A child continuing its parent's stretch is named down the stretch (`STRETCH_ID`), else `childName`. A name that is
    // already taken (its frame moved away) gets a `#n` suffix; an id is never reused.
    _childId(parentId, i, j) { return this._untaken(this._levelId(this.frames.get(parentId), i, j, 1)); }
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
        this._codes = null;
        this._paths.clear();
        this.latticeSeq++;
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
        const hit = this._anyRuns ? this._unfoldAt(p, cellKey(i, j)) : this._kidAt(p, cellKey(i, j));
        if (hit && hit.private == null) return hit;
        // A cell of private frames alone (A1 C4) gets a frame of its own, its resident: the camera and new ink go there.
        const f = this._addFrame(this._childId(parentId, i, j), parentId, { i, j }, dm.add(p.depth, 1));
        if (hit) this._regroup(this.cellFrames(f.id), f);
        return f;
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
        const hit = p._kids && p._kids.get(cellKey(i, j)), f = hit ? this.frames.get(hit) : null;
        return f && !f.run ? f : null;
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
        if (f.run) this._unfold(f, f.run.n);   // the level above a run frame becomes its parent: its neighbours are that level's kids
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
        const depth = dm.sub(f.depth, 1);
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
        this.latticeSeq++;
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
        if (!f || !p || p.depth !== dm.sub(f.depth, 1) || !inDigit(i) || !inDigit(j)) return null;
        if (f.parent === parentId && f.cell.i === i && f.cell.j === j) return f;
        const taken = this._anyRuns ? this._unfoldAt(p, cellKey(i, j)) : this._kidAt(p, cellKey(i, j));
        if (taken && taken !== f) return { occupied: taken.id };
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
        const key = this._entryKey(f);
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
    // Frame `f`, just left its cell (`_leave`), takes cell (i, j) of `p`. A free cell is taken; an occupied
    // one makes `f` a permanent co-resident of its frames (A1 C3: no merge) — or its resident when the
    // resident there holds nothing (`empty`) and contains no frame — and its kids join the groups of the
    // cells they now share, all the way down. Returns `[coresident, resident]` when the cell was occupied.
    _take(f, p, i, j, empty) {
        if (this._anyRuns) this._clearAround(p, i, j);
        f.parent = p.id; f.cell = { i, j }; f.edge = cellEdge(i, j); f.centre = cellCentre(i, j);
        f.addrSeq = (f.addrSeq || 0) + 1; f._rec = undefined;
        f.run = null;   // the empty levels it hung below stay behind, and are gone
        this.latticeSeq++;
        const key = cellKey(i, j);
        const E = this._kidAt(p, key);
        if (!p._kids) p._kids = new Map();
        if (!p._kids.has(key)) p._kids.set(key, f.id);
        if (!E || E === f) return null;
        const r = this._joinGroups(f, E, empty);
        this._linkKids(r, empty);
        return r === f ? [E.id, f.id] : [f.id, r.id];
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
        // A spine run's levels are no frames: the spine's next frame is the run's frame when that is in cell (0,0) too.
        while (f) {
            this._spine.set(f.depth, f.id);
            const E = this._entryAt(f, "0,0");
            f = E && (!E.run || (E.cell.i === 0 && E.cell.j === 0)) ? E : null;
        }
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
        const last = dm.add(atDepth, 3);
        if (this._anyRuns && this.frames.has(rootId)) this._frameAt(rootId, dm.min(atDepth, this.frames.get(rootId).depth));   // the level the move is measured at
        const stack = [this.frames.get(rootId)];
        while (stack.length) {
            const f = stack.pop();
            if (!f) continue;
            out.set(f.id, { parent: f.parent, i: f.cell.i, j: f.cell.j, depth: f.depth, ...(f.run ? { run: { n: f.run.n, i: f.run.i, j: f.run.j } } : {}) });
            if (dm.ge(f.depth, last)) continue;
            // Its own kids (a co-resident is its own subtree, A1 C3); a run level a displacement re-addresses becomes a frame.
            for (const c of this.childrenOf(f.id)) stack.push(c.run ? this._unfold(c, 1) : c);
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
        const ids = [...start.keys()].sort((a, b) => dm.cmp(start.get(a).depth, start.get(b).depth));
        const at = new Map();
        const out = [];
        for (const id of ids) {
            const e = start.get(id);
            // The start chain, fine end first: the subtree's own recorded cells, then the
            // live ancestors above it — they are outside the subtree and do not move.
            const chain = [];
            const put = (i, j, run) => {
                chain.push({ i, j });
                if (run) for (let n = 0; dm.lt(n, run.n); n++) chain.push({ i: run.i, j: run.j });
            };
            let s = e;
            for (;;) {
                put(s.i, s.j, s.run);
                const up = s.parent != null ? start.get(s.parent) : null;
                if (!up) break;
                s = up;
            }
            let a = s.parent != null ? this.frames.get(s.parent) : null;
            while (a && dm.gt(a.depth, atDepth)) {
                put(a.cell.i, a.cell.j, a.run);
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
                // Under a mover only its own kids go with it; elsewhere a cell's resident.
                const f = this.findCellChild(parent, c.i, c.j, start.has(parent)) || this.cellChild(parent, c.i, c.j);
                if (!f) { ok = false; break; }
                parent = f.id;
            }
            if (!ok) { out.push({ id, why: "the target chain cannot be reached" }); continue; }
            const cell = cells[cells.length - 1];
            at.set(parent + "|" + cell.i + "," + cell.j, id);
            out.push({ id, depth: e.depth, parent, i: cell.i, j: cell.j, rest: [X.rest, Y.rest], shift });
        }
        out.sort((p, q) => dm.cmp(start.get(q.id).depth, start.get(p.id).depth));
        return out;
    }
    /**
     * Apply a `moveSubtreeTargets` array in two phases, so the movers never collide with
     * each other: every mover leaves its old cell first, then each takes its target. A
     * target cell another frame holds makes a co-resident (`_take`): the resident's when
     * `opts.empty(id)` says it holds nothing and it contains no frame, else the newcomer.
     * Returns `{ moved, shadowed: [{ id, of }] }`, `of` the resident. (`readdress` stays for a single move.)
     */
    readdressMany(targets, opts = {}) {
        const empty = opts.empty || (() => false);
        const list = (targets || []).filter((t) => t && t.parent != null && this.frames.has(t.id) && this.frames.has(t.parent));
        for (const t of list) this._leave(this.frames.get(t.id));
        // Coarsest first, so a parent that is itself moving holds its new `_kids` entry
        // before its children ask who holds their cell.
        const order = list.slice().sort((p, q) => dm.cmp(dm.parse(p.depth) || 0, dm.parse(q.depth) || 0));
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
     * The private frame of family `key` at child cell (i, j) of `parentId`'s cell, contained by `parentId` (A1 C4): a
     * co-resident there flagged `private` with `key` — the id of the non-private frame the family's chain hangs from —
     * made on first use. A cede's kids live in it, so the lasso can take every other frame whole.
     */
    privateFrame(parentId, i, j, key) {
        const p = this.frames.get(String(parentId));
        if (!p || !inDigit(i) || !inDigit(j)) return null;
        const r = this._anyRuns ? this._unfoldAt(p, cellKey(i, j)) : this._kidAt(p, cellKey(i, j));
        if (r) for (const g of this.cellFrames(r.id)) if (g.private === String(key) && g.parent === p.id) return g;
        const f = this._addFrame(this._childId(p.id, i, j), p.id, { i, j }, dm.add(p.depth, 1));
        f.private = String(key);
        if (r) this._regroup(this.cellFrames(f.id));
        return f;
    }
    /**
     * A frame put back at its address (an undo): a co-resident where a frame holds the cell, its resident
     * when that one holds nothing (`empty`) and contains no frame. Its kids come back after it, each
     * joining the group of its cell as it is added (`_addFrame`).
     */
    restoreFrame(rec, empty = NEVER) {
        let f = this.frames.get(rec.id);
        if (f) return f;
        if (rec.parent != null && !this.frames.has(rec.parent)) return null;
        const depth = dm.parse(rec.depth), run = rec.run ? { n: dm.parse(rec.run.n), i: rec.run.i, j: rec.run.j } : null;
        if (depth == null || (run && run.n == null)) return null;
        f = rec.parent != null ? this._addBelow(rec.id, this.frames.get(rec.parent), { i: rec.i, j: rec.j }, depth, run)
            : this._addFrame(rec.id, null, { i: rec.i, j: rec.j }, depth);
        if (!f) return null;
        if (rec.shift) f.shift = [rec.shift[0], rec.shift[1]];
        f.addrSeq = (rec.addrSeq || 0) + 1;                    // caches keyed on its chain read it afresh
        if (rec.private != null) { f.private = rec.private; this._regroup(this.cellFrames(f.id)); }
        const r = this.residentOf(f.id);
        if (r !== f && f.private == null && !(r._kids && r._kids.size) && empty(r.id)) this._regroup(this.cellFrames(f.id), f);
        this.addrEpoch++;
        this._rebuildSpine();
        return f;
    }
    /**
     * A deleted subtree leaves the lattice (A1 C3): `rootId` and every frame it contains, out of every group they share,
     * their ids retired for the session (history names them). Returns each frame's address, parents first, for
     * `restoreFrame`; null for no frame. A parentless root is given its parent first (`_growRoot`).
     */
    removeSubtree(rootId) {
        const root = this.frames.get(String(rootId));
        if (!root) return null;
        if (root.parent == null) this._growRoot(root);
        const out = [];
        this.walk(root.id, (f) => out.push({ id: f.id, parent: f.parent, i: f.cell.i, j: f.cell.j, depth: f.depth,
            shift: f.shift ? [f.shift[0], f.shift[1]] : null, addrSeq: f.addrSeq || 0, ...(f.private != null ? { private: f.private } : {}),
            ...(f.run ? { run: { n: f.run.n, i: f.run.i, j: f.run.j } } : {}) }));
        out.sort((a, b) => dm.cmp(a.depth, b.depth));
        this._leave(root);
        for (const r of out) { this.frames.delete(r.id); this.retire(r.id); }
        this._codes = null;
        this._paths.clear();
        this.latticeSeq++;
        this.addrEpoch++;
        if (out.some((r) => this._spine.get(r.depth) === r.id)) this._rebuildSpine();
        return out;
    }
    /** Frame `id` contained by `parentId` at its own cell (a legacy unmerge): its container changes, its cell does not. */
    reparent(id, parentId) {
        const f = this.frames.get(id), p = this.frames.get(parentId);
        if (!f || !p) return null;
        this._leave(f);
        this._take(f, p, f.cell.i, f.cell.j, NEVER);
        this._paths.clear(); this.addrEpoch++; this._rebuildSpine();
        return f;
    }
    /**
     * Frames another lattice minted, added here (F67): a worker's descent runs on a
     * copy, and a kid it homes a cell over from the camera's frame names a frame this
     * lattice never saw. `data` is `serialize()`'s shape; parents come first; a frame
     * already here is left alone unless it was a root that gained a parent.
     */
    merge(data) {
        const list = ((data && data.frames) || []).map(parsedFrame).filter(Boolean)
            .sort((a, b) => dm.cmp(a.depth, b.depth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        let added = 0;
        for (const f of list) {
            const cur = this.frames.get(f.id);
            let p = f.parent != null ? this.frames.get(f.parent) : null;
            if (cur) { if (cur.parent == null && p) this._adopt(cur, p, { i: f.i, j: f.j }); continue; }
            if (f.parent != null && !p) p = this.ensureId(f.parent);   // a parent main lost since: re-minted, not skipped (F99)
            if (f.parent != null && !p) continue;
            const run = Array.isArray(f.run) ? { n: f.run[0], i: f.run[1], j: f.run[2] } : null;
            if (p && !run && this._anyRuns) {
                this._unfoldAt(p, cellKey(f.i, f.j), f.id);   // a level folded here and unfolded in the copy: the same level
                if (this.frames.has(f.id)) { added++; continue; }
            }
            const g = p ? this._addBelow(f.id, p, { i: f.i, j: f.j }, f.depth, run) : this._addFrame(f.id, null, { i: f.i, j: f.j }, f.depth);
            if (!g) continue;
            if (f.private != null) g.private = String(f.private);
            added++;
        }
        return added;
    }
    /**
     * The frame an id names, re-minted with its EXACT id in its birth cell when the lattice lacks it (F67, F99), a
     * co-resident when a frame holds the cell (`_addFrame`). A path id ("<spine depth>[#n]/i,j[#n]/…") re-mints the
     * spine frame, then every missing frame below the deepest prefix the lattice has; a hashed id (F192) only under
     * the one frame its parent's code names. Null, with nothing minted, for an id no frame can have.
     */
    ensureId(id) {
        const hit = this.frames.get(id);
        if (hit) return hit;
        const h = HASHED_ID.exec(String(id));
        if (h) return this._ensureHashed(String(id), h);
        const st = STRETCH_ID.exec(String(id));
        if (st) return this._ensureStretch(String(id), st);
        const segs = String(id).split("/");
        const top = /^(-?\d+)(#\d+)?$/.exec(segs[0]);
        const depth = top ? dm.parse(top[1]) : null;   // canonical digits only, as `String(depth)` mints them
        if (depth == null) return null;
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
            cur = this._remint(exact, cur, i, j);
        }
        return cur && cur.id === id ? cur : null;
    }
    /** Frame `id` at child cell (i, j) of `p`: a run level there unfolded under it, else added (a co-resident where a frame is). */
    _remint(id, p, i, j) {
        if (this._anyRuns) { this._unfoldAt(p, cellKey(i, j), id); const g = this.frames.get(id); if (g) return g; }
        return this._addFrame(id, p.id, { i, j }, dm.add(p.depth, 1));
    }
    _ensureHashed(id, m) {
        const i = +m[2], j = +m[3];
        if (!inDigit(i) || !inDigit(j)) return null;
        const ids = this._codesReady().get(m[1]);
        if (!ids || ids.length !== 1) return null;   // none, or a 64-bit collision: no guess
        return this._remint(id, this.frames.get(ids[0]), i, j);
    }
    /**
     * A stretch id `s<T>:i,j*k`: down the stretch from its top `h<T>:i,j` or from T, minting what is missing; with both
     * folded away, the run whose levels the stretch's are. Null when no frame names its start.
     */
    _ensureStretch(id, m) {
        const T = m[1], i = +m[2], j = +m[3], k = dm.parse(m[4]);
        if (!runCell(i, j) || k == null || dm.lt(k, 2)) return null;
        let from = this.frames.get(stretchName(T, i, j, 1)), left = dm.sub(k, 1);
        if (!from) {
            const ids = this._codesReady().get(T);
            if (ids && ids.length === 1) { from = this.frames.get(ids[0]); left = k; }
        }
        if (!from) {
            for (const K of this.frames.values()) {
                if (!K.run || K.run.i !== i || K.run.j !== j) continue;
                const [T2, k0] = this._stretchOf(this.frames.get(K.parent), i, j);
                if (T2 === T && dm.lt(k0, k) && dm.le(k, dm.add(k0, K.run.n))) return this._unfold(K, dm.sub(k, k0), id);
            }
            return null;
        }
        const q = dm.gt(left, 1) ? this._walkSegs(from, [{ i, j, n: dm.sub(left, 1) }], true) : from;
        return q ? this._remint(id, q, i, j) : null;
    }
    _codesReady() {
        if (!this._codes) { this._codes = new Map(); for (const k of this.frames.keys()) this._codeAdd(k); }
        return this._codes;
    }
    _codeAdd(id) { const c = frameCode(id), a = this._codes.get(c); if (a) a.push(id); else this._codes.set(c, [id]); }
    /** A spine id ("2", or a moved spine frame's twin "2#3") minted in the spine cell: itself, or the resident's co-resident. */
    _ensureSpineId(sid, depth) {
        this.ensureSpine(depth);
        let f = this.frames.get(sid);
        if (f) return f;
        const resident = this.frames.get(this.spineAt(depth));
        const p = resident && resident.parent != null ? this.frames.get(resident.parent) : null;
        if (!p) return null;
        f = this._addFrame(sid, p.id, { i: 0, j: 0 }, depth);
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
        if (f.run) return null;   // the level above it is a run level: f is its one kid, and nothing is beside it
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

    /** Force `id` to have a parent one level up (crossing down needs one; a run's last level is unfolded). Returns the parent id. */
    ensureParent(id) {
        const f = this.frames.get(id);
        if (!f) return null;
        if (f.run) return this._unfold(f, f.run.n).id;
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
        else if (child.run) this._unfold(child, child.run.n);
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
        const id = this.spineAt(dm.parse(typeof key === "number" || dm.isBig(key) ? key : s));
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
    /** Is `bId` what `aId` stands for: itself or a frame it contains, at any depth? (The selection's rule; tiles use `isAncestor`.) */
    isUnder(aId, bId) {
        for (let f = this.frames.get(bId); f; f = f.parent != null ? this.frames.get(f.parent) : null) if (f.id === aId) return true;
        return false;
    }
    /**
     * The address of `id` relative to `rootId`: the digits, coarsest first.
     * Null if `rootId` is not an ancestor (or the frame itself).
     */
    chainFrom(rootId, id) {
        const segs = this.chainSegs(rootId, id);
        if (!segs) return null;
        const out = [];
        for (const s of segs) for (let n = 0; dm.lt(n, s.n); n++) out.push({ i: s.i, j: s.j });
        return out;
    }
    /** `chainFrom` as runs of one cell, coarse first: [{ i, j, n }], O(frames) at any depth. Null as `chainFrom`. */
    chainSegs(rootId, id) {
        const root = this.residentOf(rootId), out = [];
        const put = (i, j, n) => { const l = out[out.length - 1]; if (l && l.i === i && l.j === j) l.n = dm.add(l.n, n); else out.push({ i, j, n }); };
        let f = this.residentOf(id);
        while (f && f !== root) {
            put(f.cell.i, f.cell.j, 1);
            if (f.run) put(f.run.i, f.run.j, f.run.n);
            f = this._cellParent(f);
        }
        if (!f) return null;
        out.reverse();
        return out;
    }
    /** The frame at `chain` (cells coarse first, or `chainSegs`' runs) below `rootId` if the lattice has it; never mints. */
    peekAtChain(rootId, chain) {
        const root = this.frames.get(rootId);
        return root ? this._walkSegs(root, segsOf(chain), false) : null;
    }
    /** Walk (and mint) the frame at `chain` (cells coarse first, or `chainSegs`' runs) below `rootId`. */
    frameAtChain(rootId, chain) {
        const root = this.frames.get(rootId);
        return root ? this._walkSegs(root, segsOf(chain), true) : null;
    }
    /**
     * The frame at `segs` (runs of one cell, coarse first) below frame `T`, through frames and runs. With `mint` what is
     * missing is minted (a stretch as one frame and a run with `bulkRuns`), and a run level it ends at or leaves from is
     * unfolded; without, null where the lattice holds no frame. Null where a cell cannot be reached.
     */
    _walkSegs(T, segs, mint) {
        let cur = T, run = null, m = 0;   // inside a run: at its level m (cur null)
        for (const s of segs) {
            let left = s.n;
            while (dm.gt(left, 0)) {
                if (run) {
                    const r = run.run;
                    if (dm.lt(m, r.n) && r.i === s.i && r.j === s.j) { const n = dm.min(left, dm.sub(r.n, m)); m = dm.add(m, n); left = dm.sub(left, n); continue; }
                    if (m === r.n && run.cell.i === s.i && run.cell.j === s.j) { cur = run; run = null; left = dm.sub(left, 1); continue; }
                    if (!mint) return null;
                    cur = this._unfold(run, m); run = null;   // the chain leaves the run below level m
                    continue;
                }
                const E = this._entryAt(cur, cellKey(s.i, s.j));
                if (E && E.run) { run = E; m = 1; cur = null; left = dm.sub(left, 1); continue; }
                if (!mint) { if (!E) return null; cur = E; left = dm.sub(left, 1); continue; }
                if (!E && this.bulkRuns && dm.ge(left, this._runMin()) && runCell(s.i, s.j) && !this._occupiedAround(cur, s.i, s.j)) {
                    cur = this._mintRun(cur, s.i, s.j, left); left = 0; continue;
                }
                cur = this.cellChild(cur.id, s.i, s.j);
                if (!cur) return null;
                left = dm.sub(left, 1);
            }
        }
        if (run) { if (!mint) return null; cur = this._unfold(run, m); }
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
        if (!f || dm.gt(atDepth, f.depth)) return null;
        const k = dm.sub(f.depth, atDepth);
        const X = displacementDigitsSparse(dx, k), Y = displacementDigitsSparse(dy, k);
        if (!k) return { frame: f, rest: [X.rest, Y.rest] };
        // The chain from the frame at or above `atDepth` (p levels above it when that depth is a run level), as runs.
        const T = this._frameAbove(id, atDepth), segs = T && this.chainSegs(T.id, id);
        if (!segs) return null;
        const p = dm.sub(atDepth, T.depth), addX = new Map(), addY = new Map();
        X.digits.forEach((v, m) => { if (v) addX.set(dm.add(p, m), v); });
        Y.digits.forEach((v, m) => { if (v) addY.set(dm.add(p, m), v); });
        const r = addDigitsSegs(segs, addX, addY);
        const root = r.carry[0] || r.carry[1] ? this.neighbour(T.id, r.carry[0], r.carry[1]) : T;
        const frame = root ? this._walkSegs(root, r.segs, true) : null;
        return frame ? { frame, rest: [X.rest, Y.rest] } : null;
    }
    /**
     * The frame F's chain names with `sh`'s whole frames added (sign 1) or taken off (−1) from the home depth `hd` down:
     * its digits on F's chain below `hd`, its home-frame carry a step at `hd` (`objShift`, `frameShifted`). Undefined when
     * F's chain does not reach `hd`; null where the lattice holds no frame there (`mint` false) or none can be made.
     */
    _shiftChain(F, hd, sh, sign, mint) {
        const T = this._frameAbove(F, hd), segs = T && this.chainSegs(T.id, F);
        if (!segs) return undefined;
        const p = dm.sub(hd, T.depth), p1 = dm.sub(p, 1), addX = new Map(), addY = new Map();
        eachDigit(sh, (m, d) => { const q = dm.add(p1, m); if (d[0]) addX.set(q, sign * d[0]); if (d[1]) addY.set(q, sign * d[1]); });
        let lx = sign * sh.carry[0], ly = sign * sh.carry[1];
        if (dm.gt(p, 0)) {   // the home depth is a run level: its step is a digit there
            if (lx) addX.set(p1, (addX.get(p1) || 0) + lx);
            if (ly) addY.set(p1, (addY.get(p1) || 0) + ly);
            lx = ly = 0;
        }
        const r = addDigitsSegs(segs, addX, addY), cx = r.carry[0] + lx, cy = r.carry[1] + ly;
        const A0 = cx || cy ? (mint ? this.neighbour(T.id, cx, cy) : this.peekNeighbour(T.id, cx, cy)) : T;
        return A0 ? this._walkSegs(A0, r.segs, mint) : null;
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
    /**
     * Up from `fromId`'s cell to the common one and down to `toId`'s, as resident ids; empty between co-residents.
     * The deeper end climbs to the other's depth, then both climb until they meet: the levels between, not the depth
     * (a walk of both to the root was three quarters of a deep erase's task at 10,000 levels; OPEN-FLAGS F196).
     */
    _buildPath(fromId, toId) {
        let a = this.residentOf(fromId), b = this.residentOf(toId);
        const upIds = [], downIds = [];
        // An entry stands for its frame's level and its run's; a run level never branches, so they meet at a frame.
        while (a && b && a !== b) {
            const da = a.depth, db = b.depth;
            if (dm.ge(da, db)) { upIds.push(a.id); a = this._cellParent(a); }
            if (dm.ge(db, da)) { downIds.push(b.id); b = this._cellParent(b); }
        }
        if (!a || !b) return null;
        downIds.reverse();
        return { up: upIds, down: downIds };
    }
    /**
     * A path's steps, in order: [kind, cx, cy, n]… — an entry's own level, then its run's levels less a cut (the last up
     * entry's `upCut`, the first down entry's `downCut`), and the `side` hop. Null when an entry has no centre (a root).
     */
    _pathOps(path) {
        if (path._ops !== undefined) return path._ops;
        const ops = [];
        let ok = true;
        const last = path.up.length - 1;
        for (let k = 0; k <= last && ok; k++) {
            const f = this.frames.get(path.up[k]);
            if (!f || !f.centre) { ok = false; break; }
            ops.push(UP, f.centre.x, f.centre.y, 1);
            const n = f.run ? dm.sub(f.run.n, k === last ? path.upCut || 0 : 0) : 0;
            if (dm.gt(n, 0)) ops.push(UP, f.run.c.x, f.run.c.y, n);
        }
        if (ok && path.side) ops.push(SIDE, path.side[0], path.side[1], 1);
        for (let k = 0; k < path.down.length && ok; k++) {
            const f = this.frames.get(path.down[k]);
            if (!f || !f.centre) { ok = false; break; }
            const n = f.run ? dm.sub(f.run.n, k === 0 ? path.downCut || 0 : 0) : 0;
            if (dm.gt(n, 0)) ops.push(DOWN, f.run.c.x, f.run.c.y, n);
            ops.push(DOWN, f.centre.x, f.centre.y, 1);
        }
        return (path._ops = ok ? ops : null);
    }
    /**
     * `framePath` for the float maps: up only to the shallower end's depth, then `side` (whole frames, that depth's
     * units), then down. Through the common cell, a map between two nearby frames rounds at that cell's scale, 4096x
     * coarser a level up: 4.8 px three levels up and the ink gone at six (OPEN-FLAGS F179). `side` is the two cells'
     * digit differences folded from the top, exact while the cells are near; past 2^35 frames apart it falls back to
     * `framePath`'s route. Through runs: the last up entry's run levels at or above that depth are `upCut`, the first down
     * entry's `downCut` (a run's cell is not on an edge, so the difference leaves 2^35 within a few levels of one).
     */
    floatPath(fromKey, toKey) {
        const p = this.framePath(fromKey, toKey);
        if (!p || !p.up.length || !p.down.length) return p;
        const ck = "f|" + p.up[0] + "|" + p.down[p.down.length - 1];
        const hit = this._paths.get(ck);
        if (hit !== undefined) return hit;
        const up = p.up.map((id) => this.frames.get(id)), down = p.down.map((id) => this.frames.get(id));
        const dF = up[0].depth, dC = this._cellParent(up[up.length - 1]).depth;
        const dS = dm.min(dF, down[down.length - 1].depth);
        // Each chain's cells from the top down: a frame's run levels, then its own.
        const cells = (list) => { let x = 0, k = 0; return () => { const f = list[x]; if (f.run && dm.lt(k, f.run.n)) { k++; return f.run; } x++; k = 0; return f.cell; }; };
        const na = cells(up.slice().reverse()), nb = cells(down);
        let nx = 0, ny = 0, far = false;
        for (let l = dm.add(dC, 1); dm.le(l, dS) && !far; l = dm.add(l, 1)) {
            const a = na(), b = nb();
            nx = nx * R + (a.i - b.i); ny = ny * R + (a.j - b.j);
            far = Math.abs(nx) > 0x800000000 || Math.abs(ny) > 0x800000000;   // and so for every level below
        }
        let built = p;
        if (!far) {
            let u = 0, w = 0;
            while (u < up.length && dm.gt(up[u].depth, dS)) u++;
            while (w < down.length && dm.le(down[w].depth, dS)) w++;
            const cut = (f) => (f && f.run ? dm.max(0, dm.add(dm.sub(dS, dm.sub(f.depth, f.run.n)), 1)) : 0);
            const upCut = cut(up[u - 1]), downCut = cut(down[w]);
            built = { up: p.up.slice(0, u), side: [nx * W, ny * W], down: p.down.slice(w), ...(upCut ? { upCut } : {}), ...(downCut ? { downCut } : {}) };
        }
        this._paths.set(ck, built);
        return built;
    }
    frameFactor(fromId, toId) {
        const path = this.framePath(fromId, toId);
        if (!path) return null;
        const base = this.cfg.base;
        let f = 1;
        // A level's factor, `n` times: a run's levels stop changing it at 0 or ∞.
        const times = (q, n) => { for (n = dm.toNumber(n); n > 0; n--) { const g = f * q; if (same(g, f)) break; f = g; } };
        for (const id of path.up) {
            const g = this.frames.get(id), e = g.edge;
            if (!e) return null;
            f *= base / e.s;
            if (g.run) times(base / e.s, g.run.n);
        }
        for (const id of path.down) {
            const g = this.frames.get(id), e = g.edge;
            if (!e) return null;
            if (g.run) times(e.s / base, g.run.n);
            f *= e.s / base;
        }
        return f;
    }
    mapPointF(p, fromId, toId) {
        const path = this.floatPath(fromId, toId);
        const ops = path && this._pathOps(path);
        return ops ? applyOps(ops, p[0], p[1], [0, 0]) : null;
    }
    mapRectF(rect, fromId, toId) {
        const a = this.mapPointF([rect.left, rect.top], fromId, toId);
        const b = this.mapPointF([rect.right, rect.bottom], fromId, toId);
        if (!a || !b) return null;
        return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
    }
    /**
     * `mapPointF(p, fromId, A)` for each point of `pts` and every A on `fromId`'s chain, in one walk up: (resident)
     * id -> the points there, the same numbers (the same steps in the same order) without a path for each A (F195).
     * The walk stops at depth `minDepth` (the shallowest a caller asks for), not the root.
     */
    pointsUpChain(pts, fromId, minDepth = -Infinity) {
        const out = new Map(), f0 = this._frameFor(fromId);
        if (!f0) return out;
        let cur = pts.map((p) => [p[0], p[1]]);
        for (let f = this.residentOf(f0.id); f; f = this._cellParent(f)) {
            out.set(f.id, cur);
            const c = f.centre;
            if (!c || dm.le(f.depth, minDepth)) break;
            if (!f.run) { cur = cur.map(([x, y]) => [x / R + c.x, y / R + c.y]); continue; }
            const ops = [UP, c.x, c.y, 1, UP, f.run.c.x, f.run.c.y, f.run.n];
            cur = cur.map(([x, y]) => applyOps(ops, x, y, [0, 0]));   // through a run: to the frame above it, past `minDepth` at most
        }
        return out;
    }
    /** `mapRectF(rect, fromId, A)` for every A on `fromId`'s chain down to `minDepth`: `pointsUpChain` of its two corners. */
    rectUpChain(rect, fromId, minDepth = -Infinity) {
        const out = new Map();
        for (const [id, [a, b]] of this.pointsUpChain([[rect.left, rect.top], [rect.right, rect.bottom]], fromId, minDepth)) {
            out.set(id, { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) });
        }
        return out;
    }
    /**
     * For a `nearWalk` callback: `up(a)` is `mapRectF(rect, fromId, a.id)` for `a` on `fromId`'s chain, the whole
     * chain mapped in one walk on first use (`rectUpChain`). A map a level built a path a level, O(depth²): a down-tile
     * bake at level 10,000 took 50 s and cached 2 GB of paths (OPEN-FLAGS F197).
     */
    rectsUp(rect, fromId) {
        let chain = null;
        return (a) => {
            if (!chain) chain = this.rectUpChain(rect, fromId);
            if (a.runLevel) {   // a run level of the chain (`nearWalk`'s handle): up from the frame below it
                const f = a.below, r = chain.get(f.id);
                if (!r) return null;
                const n = dm.sub(dm.sub(f.depth, 1), a.depth), ops = dm.gt(n, 0) ? [UP, f.centre.x, f.centre.y, 1, UP, f.run.c.x, f.run.c.y, n] : [UP, f.centre.x, f.centre.y, 1];
                const p = applyOps(ops, r.left, r.top, [0, 0]), q = applyOps(ops, r.right, r.bottom, [0, 0]);
                return { left: p[0], top: p[1], right: q[0], bottom: q[1] };
            }
            const r = chain.get(a.id);
            return r !== undefined ? r : this.mapRectF(rect, fromId, a.id);
        };
    }
    /**
     * Where cell `fromId`'s origin sits in `toId`'s units when it is `toId`'s cell or one of the eight around it:
     * whole frames, found by digits (exact however far up the two cells meet); null past that. Cells, not frames: a
     * private frame is its cell's (F124). A ring native is derived through this, never through the parent (F174).
     */
    cellOffset(fromId, toId) {
        if (this.sameCell(fromId, toId)) return [0, 0];
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const n = (di || dj) ? this.peekNeighbour(toId, di, dj) : null;
                if (n && this.sameCell(n.id, fromId)) return [di * W, dj * W];
            }
        }
        return null;
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
     *         exact integers with borrows; minted if it was never visited, or,
     *         with `mint` false (a read, PLAN §3 row 8), `{ missing: true }`;
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
    objShift(below, homeId, F, mint = true) {
        const hd = this.depthOf(homeId), D = this.depthOf(F);
        if (hd == null || D == null) return null;
        const k0 = dm.sub(D, hd);
        const sh = shiftAt(below, k0);
        if (dm.lt(k0, 0) || !hasDigits(sh)) return { F0: k0 === 0 && this.sameCell(F, homeId) ? String(homeId) : F, rem: sh.rem, sh };
        const nb = (id, di, dj) => (mint ? this.neighbour(id, di, dj) : this.peekNeighbour(id, di, dj));
        const missing = () => (mint ? null : { F0: null, rem: sh.rem, sh, missing: true });
        if (k0 === 0) {
            const n = nb(F, -sh.carry[0], -sh.carry[1]);
            return n ? { F0: this.sameCell(n.id, homeId) ? String(homeId) : n.id, rem: sh.rem, sh } : missing();
        }
        const F0 = this._shiftChain(F, hd, sh, -1, mint);
        if (F0 === undefined) return null;
        return F0 ? { F0: F0.id, rem: sh.rem, sh } : missing();
    }
    /**
     * The other way: the frame at F0's depth that the object's picture occupies,
     * given `sh` = `shiftAt(below, depth(F0) - hd)`. Where a ceded kid is homed:
     * it holds the unmoved square's bits and lives where the picture is.
     */
    frameShifted(F0, hd, sh) {
        const D = this.depthOf(F0);
        if (D == null) return null;
        const k0 = dm.sub(D, hd);
        if (dm.lt(k0, 0) || !hasDigits(sh)) return F0;
        if (k0 === 0) { const n = this.neighbour(F0, sh.carry[0], sh.carry[1]); return n ? n.id : null; }
        const F = this._shiftChain(F0, hd, sh, 1, true);
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
    /**
     * `mapPointObj` for many points (OPEN-FLAGS F153): the shift and the frame path resolved once, then each point taken
     * through the same steps, bit for bit. `fn(x, y, out)` writes `out` and returns it; null where `mapPointObj` is null.
     */
    mapperObj(fromId, toId, below, homeId, toHome) {
        let a = fromId, b = toId, pre = null, post = null;
        if (hasOffsets(below)) {
            if (this._homeToX(fromId, toId, homeId, toHome)) {
                const s = this.objShift(below, fromId, toId);
                if (!s) return null;
                b = s.F0; post = s.rem;
            } else {
                const s = this.objShift(below, toId, fromId);
                if (!s) return null;
                a = s.F0; pre = s.rem;
            }
        }
        const path = this.floatPath(a, b);
        const ops = path && this._pathOps(path);
        if (!ops) return null;
        return (x, y, out) => {
            if (pre) { x = x - pre[0]; y = y - pre[1]; }
            applyOps(ops, x, y, out);
            if (post) { out[0] = out[0] + post[0]; out[1] = out[1] + post[1]; }
            return out;
        };
    }
    /** Loops through the exact chain from one frame to another — what `projectF` does to a shape's loops. */
    projectLoops(loops, fromId, toId) {
        const path = this.floatPath(fromId, toId);
        const ops = path && this._pathOps(path);
        return ops ? loopsThrough(loops, ops) : null;
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
        const path = this.floatPath(homeId, toId), ops = path && this._pathOps(path);
        if (!ops) return null;
        // A point a level a step, each point as `mapPointF` takes it (a run's steps stop once it repeats).
        const mapAll = (src) => src.map(([x, y]) => applyOps(ops, x, y, [0, 0]));
        if (o.type === "shape") {
            // Every edge is a uniform scale plus a translation, so an arc stays an arc: the endpoints move, the bulge does
            // not change. The perimeter crosses a level without being re-resolved, which is the property the whole
            // representation is for. Hops are applied ONE EDGE AT A TIME: a composed long jump cancels catastrophically
            // going up. The tile phase rides along (a sideways hop is whole frames and leaves it, bible 6.6).
            const out = { type: "shape", origin: "derived", id: o.id, z: o.z, loops: loopsThrough(o.loops, ops),
                color: o.color, opacity: o.opacity };
            if (o.tile) out.tile = phaseThrough(o.tile, ops);
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
    /**
     * log10 of `effectiveZoom`, which overflows a double from 86 levels down (OPEN-FLAGS F167). Every edge is ×R,
     * so the zoom is exactly inScale·R^depth (spine 0 is depth 0): its log never overflows.
     */
    zoomLog10(activeKey, inScale) {
        const active = this._frameFor(activeKey);
        // eslint-disable-next-line no-restricted-properties -- display only, as LOG10_R
        return Math.log10(inScale) + dm.toNumber(active ? active.depth : 0) * LOG10_R;
    }
    /** log10 |zoomLog10| from the exact depth, for a label past a double's range (about 5 × 10^307 levels either way). */
    zoomLogLog10(activeKey) {
        const active = this._frameFor(activeKey), d = active ? active.depth : 0;
        // eslint-disable-next-line no-restricted-properties -- display only, as LOG10_R
        return d === 0 ? -Infinity : dm.log10Abs(d) + Math.log10(LOG10_R);
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
            frames: [...this.frames.values()].sort((a, b) => dm.cmp(a.depth, b.depth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((f) => ({
                id: f.id, parent: f.parent, depth: dm.toJSON(f.depth), i: f.cell.i, j: f.cell.j,
                ...(f.shift ? { shift: [f.shift[0], f.shift[1]] } : {}),
                ...(f.shadowOf != null ? { shadowOf: f.shadowOf } : {}),
                ...(f.private != null ? { private: f.private } : {}),
                ...(f.run ? { run: [dm.toJSON(f.run.n), f.run.i, f.run.j] } : {}),
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
        this._codes = null;
        this._anyRuns = false;
        this.latticeSeq++;
        // A load's frames are not frame-GC candidates: the host sweeps once the store's state is in (F94).
        const minted = this.minted;
        this.minted = null;
        this._loading = true;
        try { this._loadFrames(data); } finally { this.minted = minted; this._loading = false; }
    }
    _loadFrames(data) {
        const list = ((data && data.frames) || []).map((f) => parsedFrame(f) || f);
        // Parents before children, so _kids is wired as we go.
        const byId = new Map(list.map((f) => [f.id, f]));
        const done = new Set();
        const put = (f) => {
            if (!f || done.has(f.id)) return;
            done.add(f.id);
            if (f.parent != null && byId.has(f.parent)) put(byId.get(f.parent));
            else if (f.parent != null && !this.frames.has(f.parent)) this.ensureId(f.parent);   // not an unreachable orphan (F99)
            const run = Array.isArray(f.run) ? { n: f.run[0], i: f.run[1], j: f.run[2] } : null;
            const g = this._addFrame(f.id, f.parent, { i: f.i, j: f.j }, f.depth, run);
            if (f.shift) g.shift = [f.shift[0], f.shift[1]];
            if (f.private != null) g.private = String(f.private);
        };
        for (const f of list) put(f);
        // An empty lattice gets its root; a "0" a subtree delete took is not minted parentless beside the tree (F138).
        if (!this.frames.size) this._addFrame("0", null, { i: 0, j: 0 }, 0);
        // Frames sharing a cell were grouped as they were added (`_addFrame`); the saved resident keeps the cell.
        for (const f of list) {
            if (f.shadowOf == null) continue;
            const r = this.frames.get(f.shadowOf);
            if (r && r.shadowOf != null && this.sameCell(f.id, r.id)) this._regroup(this.cellFrames(r.id), r);
        }
        this._rebuildSpine();
    }
    /** The spine frame at `depth`, minted (or a spine run's level unfolded) when there is none; null where none can be. */
    ensureSpine(depth) {
        depth = dm.parse(depth);
        if (depth == null) return null;
        if (this.spineAt(depth) != null) return this.spineAt(depth);
        let [lo, hi] = [Infinity, -Infinity];
        for (const d of this._spine.keys()) { if (dm.lt(d, lo)) lo = d; if (dm.gt(d, hi)) hi = d; }
        if (lo === Infinity) { this._addFrame("0", null, { i: 0, j: 0 }, 0); lo = hi = 0; }
        while (dm.lt(depth, lo)) {
            const top = this.frames.get(this._spine.get(lo));
            if (this.bulkRuns && top && top.parent == null && dm.ge(dm.sub(lo, depth), this._runMin()) && !this.frames.has(String(depth))) {
                this._growRootRun(top, depth);   // a jump far up: one root and a run down to the old one
                break;
            }
            lo = dm.sub(lo, 1);
            const f = this.frames.get(String(lo)) || this._addFrame(String(lo), null, { i: 0, j: 0 }, lo);
            const child = this.frames.get(this._spine.get(dm.add(lo, 1)));
            if (child && child.parent == null) this._adopt(child, f, { i: 0, j: 0 });
        }
        if (this.spineAt(depth) != null) return this.spineAt(depth);
        if (dm.lt(depth, hi)) {   // between two spine frames: a level of the lower one's run
            let below = Infinity;
            for (const d of this._spine.keys()) if (dm.gt(d, depth) && dm.lt(d, below)) below = d;
            const K = this.frames.get(this._spine.get(below)), top = K && K.run ? dm.sub(below, K.run.n) : null;
            return top != null && dm.le(top, depth) ? this._unfold(K, dm.add(dm.sub(depth, top), 1)).id : this.spineAt(depth);
        }
        while (dm.gt(depth, hi)) {
            const p = this.frames.get(this._spine.get(hi)), E = this._entryAt(p, "0,0");
            if (E && E.run) {   // a spine run: its levels are the spine's, and its frame too when that is in cell (0,0)
                if (dm.lt(depth, E.depth)) return this._unfold(E, dm.sub(depth, p.depth)).id;
                if (E.cell.i === 0 && E.cell.j === 0) { this._spine.set(E.depth, E.id); hi = E.depth; continue; }
                this._unfold(E, E.run.n);
                hi = dm.sub(E.depth, 1);
                continue;
            }
            const gap = dm.sub(depth, hi);
            if (this.bulkRuns && !E && dm.ge(gap, this._runMin()) && !this._occupiedAround(p, 0, 0)) { this._mintRun(p, 0, 0, gap); break; }
            hi = dm.add(hi, 1);
            this.cellChild(p.id, 0, 0);
        }
        return this.spineAt(depth);
    }
    /** A new root at `depth`, far above the root `top`, which hangs below it as its cell (0,0) with a run of the levels between. */
    _growRootRun(top, depth) {
        const f = this._addFrame(String(depth), null, { i: 0, j: 0 }, depth);
        const n = dm.sub(dm.sub(top.depth, depth), 1);
        this._adopt(top, f, { i: 0, j: 0 });
        top.run = { n, i: 0, j: 0, c: cellCentre(0, 0) };
        this._anyRuns = true;
        this._rebuildSpine();
        return f;
    }
    reset() {
        this._paths.clear();
        this._retired = null;
        this.frames = new Map();
        this._spine = new Map();
        this._rootId = null;
        this._codes = null;
        this._anyRuns = false;
        this.latticeSeq++;
        this._addFrame("0", null, { i: 0, j: 0 }, 0);
    }
    resize(width, height) {
        // Grids are lattice constants now, so a resize changes nothing about
        // geometry — only which cell a given screen point falls in.
        this.width = width; this.height = height;
    }
}

