/**
 * frameLattice.js — the address arithmetic the frame tree is built on.
 *
 * See docs/frame-lattice-design-bible.md. This module is pure: integers, powers
 * of two, and no engine state. Everything the lattice promises rests on the
 * numbers here being EXACT, so every constant is a power of two and every
 * operation on them is a multiply by a power of two, an integer add, or a
 * truncation. None of those round.
 *
 * THE PICTURE. Space is divided, at every depth, into square CELLS. A cell at
 * depth d is W units across IN ITS OWN COORDINATES and contains R x R child
 * cells, each therefore G = W/R of the parent's units across. A frame IS a
 * cell; which one you are in is a function of where you are (P4), so re-entry
 * is a division rather than a nearest-neighbour search and F-B has nothing
 * left to fail at.
 *
 * A cell is CENTRED on its index: cell `i` sits at parent coordinate i*G and
 * covers [i*G - G/2, i*G + G/2), so its own extent is [-W/2, W/2) and its digit
 * runs over [-R/2, R/2) — balanced, per D7. "Which cell" is therefore a ROUND,
 * not a floor, and an object re-homes to the NEAREST cell rather than the
 * containing one: it sits near its frame's origin and straddles fewer
 * neighbours.
 *
 * Centring also makes the origin a fixed point of the whole descent. With cells
 * running [i*G, (i+1)*G) the world origin lands on a cell CORNER, and zooming
 * into it walks to the corner of every frame at every depth for ever — every
 * object drawn there straddles four cells. Centred, the origin maps to the
 * origin at every level and the spine is a chain of concentric cells.
 *
 * THE ONE FORMULA. The edge that maps parent -> child is the engine's usual
 * {s, t}:
 *
 *     child = (parent * s + t) / base,    s = ENTER,   t = -i * G * ENTER
 *
 * G*ENTER = 8192 = 2^13, so `t` is an exact integer for every digit and the
 * magnification s/base is exactly R. Nothing here spends a mantissa bit on the
 * constants, only on the index — the whole reason W is 2^17 and not 96,000
 * (bible section 0).
 */

// ---- the constants (bible section 0) --------------------------------------
export const BASE = 1 / 16;        // 2^-4
export const ENTER = 256;          // 2^8
export const EXIT = 1 / 32;        // 2^-5, keeps the 2x hysteresis
export const R = ENTER / BASE;     // 4096 = 2^12 — the crossing ratio
export const W = 131072;           // 2^17 — a frame, and a tile, in its own units
export const G = W / R;            // 32 = 2^5 — a child cell, in PARENT units
export const HALF_W = W / 2;       // 65536
export const HALF_R = R / 2;       // 2048 — digits run [-HALF_R, HALF_R)
export const T_UNIT = G * ENTER;   // 8192 = 2^13 — one digit's worth of edge `t`

// The widest canvas for which invariant 1 (a screen is never wider than a
// frame) holds unaided: width/EXIT <= W. 4096 px covers every real display
// including 4K. Past it the invariant is soft, and D9's promotion is what
// actually keeps an object inside its own neighbourhood.
export const MAX_CANVAS_PX = W * EXIT;   // 4096

/** The edge {s, t} mapping a parent's coordinates into its child cell (i, j). */
export function cellEdge(i, j) {
    return { s: ENTER, t: { x: -i * T_UNIT, y: -j * T_UNIT } };
}

/** The centre of child cell (i, j), in the PARENT's units. An exact integer. */
export function cellCentre(i, j) { return { x: i * G, y: j * G }; }

/**
 * Which child cell the point (x, y) of a frame belongs to — the NEAREST one.
 * A point exactly on a boundary rounds up, which is arbitrary but consistent,
 * and consistency is the whole requirement (P4).
 */
export function cellOf(x, y) {
    return { i: Math.round(x / G), j: Math.round(y / G) };
}

/** Is a digit inside the balanced range one cell may hold? */
export const inDigit = (i) => i >= -HALF_R && i < HALF_R;

/**
 * Split an over- or under-flowing digit into (carry, digit), with `digit` back
 * inside [-HALF_R, HALF_R). Exact — both operands are integers far inside 2^53.
 */
export function carryDigit(i) {
    const carry = Math.floor((i + HALF_R) / R);
    return { carry, digit: i - carry * R };
}

/**
 * A displacement, as lattice DIGITS.
 *
 * `d` is measured in the units of a frame at some depth D. `digits[k]` is the
 * displacement's digit at depth D+1+k, and `rest` is everything the digits
 * could not express, measured in the units of a frame at depth D+n — so
 * |rest| < W, i.e. less than one cell at the level where the expansion stopped.
 *
 * A digit counts CELLS, not units (Kobin: "if you accumulate 3000 points of
 * move at level 5, level 4 accumulates 1 point, and level 5 resets"). That is
 * what makes the base exactly the crossing ratio and the carry clean.
 *
 * EVERY STEP IS EXACT, which is the point of the whole exercise: d/G is a
 * division by 2^5, Math.trunc of a float is exact, (m - trunc(m)) is exact
 * because the two share an exponent range, and *R is a multiply by 2^12. So
 * digits + rest reconstruct `d` to the last bit, and a slow drag therefore adds
 * up to exactly what a fast one does (the M-4 property, now by construction
 * rather than by residue bookkeeping).
 */
export function displacementDigits(d, n) {
    const digits = [];
    let m = d / G;
    for (let k = 0; k < n; k++) {
        const a = Math.trunc(m);
        digits.push(a);
        m = (m - a) * R;
    }
    return { digits, rest: m * G };
}

/**
 * How far one digit at `digitDepth` moves something, measured in the units of a
 * frame at `inDepth`. A digit at the object's own depth is worth a whole frame
 * (W); one level below that, exactly G.
 */
export function digitValue(digitDepth, inDepth) {
    return G * Math.pow(R, inDepth - digitDepth + 1);
}

/**
 * Add a displacement's digits to an address CHAIN.
 *
 * `chain[k]` is a cell digit at depth (rootDepth + 1 + k); `digits[0]` applies
 * at chain position `firstIndex`. Returns the new chain, plus:
 *
 *   `carry`   — a digit that ran off the COARSE end. It is real: the move
 *               crossed a cell boundary at or above the level it was made at,
 *               and the caller has to extend the address upward to hold it.
 *   `residue` — digits that ran off the FINE end, folded into one number in the
 *               units of the chain's last level. Those become an ordinary
 *               sub-cell translation of the geometry (section 6.8: an address
 *               may extend below the object's home, and a float local
 *               coordinate holds about three levels of it before its own ulp
 *               gives out).
 */
export function applyDigits(chain, firstIndex, digits) {
    const out = chain.slice();
    const len = out.length;
    let residue = 0;
    for (let k = digits.length - 1; k >= 0; k--) {
        const pos = firstIndex + k;
        if (pos < len) break;
        residue += digits[k] * G * Math.pow(R, len - pos);
    }
    let carry = 0;
    for (let pos = len - 1; pos >= 0; pos--) {
        const k = pos - firstIndex;
        const add = (k >= 0 && k < digits.length) ? digits[k] : 0;
        if (!add && !carry) continue;
        const c = carryDigit(out[pos] + add + carry);
        out[pos] = c.digit; carry = c.carry;
    }
    return { chain: out, residue, carry };
}

// ---------------------------------------------------------------------------
// THE OBJECT'S TILE GRID (bible D4 and section 6.6)
// ---------------------------------------------------------------------------
/**
 * A FRAME belongs to space; a TILE belongs to the object.
 *
 * Kobin, 2026-08-18: *"tiles have to follow their objects, but that's ok -
 * that's only two numbers which say where chops and culls are made"*, and
 * *"The object subdivides on the same tiles, even if it is moved."*
 *
 * WHY IT CANNOT BE THE FRAME GRID. A tile boundary is where an arc is chopped,
 * and a chopped arc is where the freeze (D2) decides whether a curve becomes
 * the chord between its own endpoints. Chop the same arc a quarter-pixel
 * further along and you get a different chord: invisible at the level it
 * happens, 4096 times that one level down, and 4096 times that again below.
 * Anchor the chop to the frame lattice and a MOVE slides every cut along the
 * object, so two arcs that crossed at a point now cross somewhere else, and a
 * star drawn at their intersection is no longer at it. Anchor it to the object
 * and the cuts land in the same place on it wherever it goes.
 *
 * THE TWO NUMBERS. A phase (px, py) in [0, W), and that is the whole of it.
 * Tile (i, j) of the grid covers [px + i*W - W/2, px + i*W + W/2) — centred on
 * its index like a cell, for the same reason (section 10.3).
 *
 * WHY A PHASE IS ENOUGH, AND WHY IT SURVIVES A MOVE. Re-homing an object one
 * cell along changes its local coordinates by exactly one frame, W — cells are
 * W apart in their own units — so `origin mod W` is UNCHANGED by any whole-cell
 * part of a displacement. Only the sub-cell remainder ever moves the phase, and
 * it moves it by exactly the amount it moves the ink. So the grid is welded to
 * the object through re-homing, carries, and drags alike, and it costs two
 * numbers and no bookkeeping.
 */
export const TILE = W;             // D4: a tile and a frame are the same size

/** A phase, normalised into [0, TILE). */
export function tilePhase(v) {
    let m = v % TILE;
    if (m < 0) {
        m += TILE;
        // A remainder a hair below zero rounds to EXACTLY TILE when TILE is
        // added: 131072 needs six significant digits, so anything under about
        // 1e-11 simply vanishes against it. TILE is the same grid as 0, but it
        // sits outside the half-open range every other check assumes, and
        // `persist` refused the whole drawing over it. Seen live 2026-08-21 —
        // four objects saved with a phase of [~1e-25, 131072], which made that
        // drawing unloadable.
        if (!(m < TILE)) return 0;
    }
    // `-0 % W` is `-0`, which is the same NUMBER as 0 and not the same VALUE.
    // A phase is compared for equality everywhere it is used — across a save,
    // across a move, between a parent and the child that inherits its grid — so
    // handing back the negative zero would make one of those compare false for
    // no reason at all.
    return m === 0 ? 0 : m;
}

/**
 * The same grid, one level down.
 *
 * The child's coordinates are `(p - c) * f`, so the grid's origin lands at
 * `(phi - c) * f` and the grid step is still TILE — the grids NEST, which is
 * what makes the decomposition a fixed property of the object's geometry at
 * every level rather than a per-level decision.
 *
 * For a lattice edge `c` is a multiple of G and `f` is R, so
 * `((phi - c)*R) mod W` reduces to `R * (phi mod G)`: exact, an exponent shift
 * and an integer subtraction. The general form is written out because the V0
 * golden comparisons still feed arbitrary crossing records through it.
 */
export function childTilePhase(phi, c, f) { return tilePhase((phi - c) * f); }

/**
 * ONE TYPE FOR THE THREE THINGS CALLED A TILE (S1, 2026-09-07).
 *
 * Three partitions of a frame share one size, W, and used to have three
 * near-identical APIs with two phase conventions, in three modules:
 *
 *   - the FRAME CELL: a frame is [-W/2, W/2) in its own units, and its
 *     children are the cells of `cellOf` / `cellEdge` above — G units apart
 *     in the parent. Belongs to space.
 *   - the OBJECT's TILE GRID: the same squares, shifted by the object's phase
 *     `o.tile` (a point of [0, W)^2), so that the grid rides with the object
 *     and nests level to level (`childTilePhase`). Belongs to the object; the
 *     freeze happens on its lines, and every cut in the engine lands on one.
 *   - the render CACHE SQUARE: the phase-0 grid, `TileGrid.CACHE`. Only a
 *     unit of work, and it decides nothing about geometry.
 *
 * They cannot be merged — the design is explicit about why — but "which grid
 * is this rect on" is now answered by the VALUE, not by which module the
 * function came out of. The two range conventions are both here, named:
 * `range` is HALF-OPEN (a rect ending exactly on a boundary belongs below —
 * the object grid's rule, and the one the chop and the cede cut on) and
 * `touching` is closed (boundaries included — the cache's read rule, so a
 * window on a boundary reads both squares). Each keeps the arithmetic its
 * callers always had, to the bit: which squares a cache reads and where an
 * object's tiles fall are both things a saved drawing's deep picture depends
 * on. The first version of the chop clipped to the cache square, which is not
 * a tile boundary, so two neighbouring squares froze one arc to two different
 * chords (OPEN-FLAGS F36); a rect that carries no grid is how that happens.
 */
export class TileGrid {
    constructor(px, py) { this.px = px; this.py = py; }
    /** The grid with phase `[px, py]` — an object's own (`o.tile`); no phase, or [0, 0], is the cache's. */
    static at(phase) { return phase && (phase[0] || phase[1]) ? new TileGrid(phase[0], phase[1]) : TileGrid.CACHE; }
    /** Square (i, j): [p + iW − W/2, p + iW + W/2) on each axis, centred on its index. */
    rect(i, j) {
        const h = TILE / 2, px = this.px, py = this.py;
        return { left: px + i * TILE - h, top: py + j * TILE - h,
            right: px + i * TILE + h, bottom: py + j * TILE + h };
    }
    /**
     * Every square `rect` reaches, as a HALF-OPEN range.
     *
     * The upper end matters more than it looks. A tile is [p + iW - W/2, p + iW +
     * W/2), so a rect that ENDS exactly on a boundary — which is what a cache square
     * does whenever the object has not been moved — belongs to the tile below, not
     * the one above. Rounding both ends the same way turns "this square is exactly
     * one tile" into three of them, and since geometry is clipped to whatever this
     * returns, that is nine times the area stored per square. Measured: it took a
     * level-1 render from 49 ms to 258 ms.
     */
    range(rect) {
        const px = this.px, py = this.py;
        const lo = (v, p) => Math.floor((v - p) / TILE + 0.5);
        const hi = (v, p, l) => Math.max(l, Math.ceil((v - p) / TILE + 0.5) - 1);
        const i0 = lo(rect.left, px), j0 = lo(rect.top, py);
        return { i0, i1: hi(rect.right, px, i0), j0, j1: hi(rect.bottom, py, j0) };
    }
    /**
     * Every square `rect` TOUCHES, boundaries included: a rect ending exactly
     * on a boundary reaches the square above it too. The cache reads with
     * this (`TileStore.content`, the pre-image of a child square, the erase's
     * choice of squares to cede), and a point query agrees with `range` on
     * which square a point is in, boundaries included.
     */
    touching(rect) {
        const h = TILE / 2, px = this.px, py = this.py;
        return { i0: Math.floor((rect.left - px + h) / TILE), i1: Math.floor((rect.right - px + h) / TILE),
            j0: Math.floor((rect.top - py + h) / TILE), j1: Math.floor((rect.bottom - py + h) / TILE) };
    }
    /**
     * The rect a window of squares spans — WHOLE squares, so its boundary is
     * made of grid lines and nothing else.
     *
     * This is what geometry gets clipped to. A frame decides which objects are
     * looked at and never cuts one; every cut in the engine lands on a line of the
     * object's own grid, which is what makes two tiles that hold the same stretch of
     * curve hold bit-identical pieces of it.
     */
    span(cells) {
        const h = TILE / 2, px = this.px, py = this.py;
        return { left: px + cells.i0 * TILE - h, top: py + cells.j0 * TILE - h,
            right: px + cells.i1 * TILE + h, bottom: py + cells.j1 * TILE + h };
    }
    /** The same grid one level down, through the edge with centre `c` and factor `f` (`childTilePhase`). */
    child(c, f) { return TileGrid.at([childTilePhase(this.px, c.x, f), childTilePhase(this.py, c.y, f)]); }
}
/** The render cache's grid — and a frame's own square is its (0, 0). Phase 0, shared. */
TileGrid.CACHE = new TileGrid(0, 0);

/** Tile (i, j) of the grid with phase (px, py). */
export function objTileRect(px, py, i, j) { return new TileGrid(px, py).rect(i, j); }
/** Every tile of the grid that `rect` reaches, HALF-OPEN — `TileGrid.range`. */
export function objTileRange(px, py, rect) { return new TileGrid(px, py).range(rect); }
/** The rect a window of tiles spans — `TileGrid.span`. */
export function objTilesRect(px, py, cells) { return new TileGrid(px, py).span(cells); }
