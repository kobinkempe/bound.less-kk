/**
 * offsets.js — an object's DISPLACEMENT TABLE: where its picture is, at every
 * level, without its stored geometry ever changing (F41, then F55).
 *
 * THE PROBLEM THIS SOLVES, TWICE. A drag made from a camera three or more
 * crossings below an object's home used to add the displacement straight into
 * the home coordinates. Three crossings down a screen pixel is a hundredth of
 * one float64 step of a coordinate 60,000 units from its origin, so the object
 * either did not move or moved a whole step: 127 px jumps at 254x, measured on
 * Kobin's phone (report 14-45-44, 2026-09-04). That was F41, and this table
 * fixed it: the displacement is kept in the units of the level it was made at.
 *
 * F41 applied the table INSIDE THE HOP into that level, one addition, rounding
 * by half an ulp of that level's coordinates. Invisible there; not four levels
 * down, where the chain magnifies that rounding by 4096 per level while a
 * native drawn there moves by exact address digits. Kobin's star in the corner
 * (2026-09-05, F55, `move.registration.test.js`): a small stroke drawn against
 * a coarse edge four crossings below a move parted from it by 3.25 units of
 * that level after a home-level move and by 1,229 after a level-1 move. So the
 * table is now applied at PAINT and inverted on inputs, at every level, and
 * nothing a move does ever reaches a stored coordinate or the tile chain.
 *
 * KOBIN'S DESIGN, in his words (2026-09-04, 2026-09-05). "The move is only
 * handled locally." "A move at level 5 just re-assigns which level 5 frame the
 * level 6 frame with the object is in." "Each move should just move
 * grandchild/descendant tiles to a new frame, arithmetically." "If it's precise
 * to the quarter pixel, that's good enough, and cheapens addressing." And:
 * "keep the extra cost from adding up too much."
 *
 * THE REPRESENTATION. Beside its home coordinates an object may carry `below`:
 * a sparse array indexed by DEPTH BELOW THE HOME, `below[k] = [ox, oy]` for
 * k >= 0 — depth 0 is the home level itself — in the units of the frame k
 * levels below the home, each component in [-W/2, W/2). Absent means zero
 * everywhere. Keyed by depth rather than by frame id so a change of address —
 * a re-home, a carry — disturbs none of it.
 *
 * THE SNAP. A displacement made at depth k is snapped to 2^-10 of that level's
 * units before it enters the table (`snapDisplacement`): a quarter of a pixel
 * at the level's deepest zoom, far finer at any shallower one, and fixed per
 * level rather than per zoom so the same move gives the same digits every
 * time. It buys a lot: an entry is then whole cells from THREE levels below it
 * (x4096 -> multiples of 4 units, x4096^2 -> of 16,384, x4096^3 -> of 2^26,
 * which is whole frames), instead of five for a raw 53-bit float. So the
 * paint-time remainder exists on two levels below a move and from the third
 * level down a move is pure cell arithmetic.
 *
 * WHAT THE TABLE MEANS AT A LEVEL. The picture's translation at depth k0
 * below the home is  T(k0) = sum over k of below[k] * R^(k0 - k). `shiftAt`
 * splits it into whole FRAMES of the levels between the home and k0 — integer
 * cell digits, exact — and a sub-frame REMAINDER at k0, which is what paint
 * applies (`piece.res`) and inputs subtract. Levels above the home (k0 < 0)
 * see only a remainder, the residual F41 always drew. Entries deeper than k0
 * contribute sub-cell amounts, exact divisions by powers of two.
 *
 * THE CARRY. |below[k]| is kept under W/2 by carrying whole frames upward: one
 * frame at level k is exactly G = 32 units at level k-1, so
 * `below[k] -= n*W; below[k-1] += n*G` — integers, exact. A carry out of the
 * home level (depth 0) is whole home frames: a change of ADDRESS, the native
 * re-homed to the neighbour cell with its coordinates untouched. Nothing is
 * ever added to a coordinate, not even a whole cell: adding an integer to a
 * float loses its low bits whenever the sum crosses a power of two, and four
 * levels down that lost bit is a screen.
 *
 * A CEDED KID k levels below its parent is homed in the frame the parent's
 * PICTURE occupies at that level (the moved frame), holds the parent's stored
 * bits for that square, and carries the parent's table from that level down:
 * below[0] = the parent's remainder at that level, below[m] = the parent's
 * below[k + m]. A promoted object (moved one level UP by `scaleGeometry`)
 * shifts the other way.
 */
import { W, G, R, HALF_W } from "../frameLattice";
import { displacementDigits } from "../frameLattice";

/** The move grid: 2^-10 of a level's unit, a quarter pixel at its deepest zoom. */
export const SNAP = 1 / 1024;
/** A displacement, on the grid. Exact: a multiply and a divide by a power of two round a float to it. */
export function snapDisplacement(v) { return Math.round(v * 1024) / 1024; }

/** The offset at depth `k` below the home (k >= 0), or null. */
export function offsetAt(below, k) {
    if (!below || !(k >= 0)) return null;
    const e = below[k];
    return e && (e[0] !== 0 || e[1] !== 0) ? e : null;
}

/** Does this table hold any offset at all? */
export function hasOffsets(below) {
    if (!below) return false;
    for (let k = 0; k < below.length; k++) if (offsetAt(below, k)) return true;
    return false;
}

/** A detached copy, or undefined when there is nothing to copy. */
export function cloneBelow(below) {
    if (!hasOffsets(below)) return undefined;
    const out = [];
    for (let k = 0; k < below.length; k++) { const e = offsetAt(below, k); if (e) out[k] = [e[0], e[1]]; }
    return out;
}

/** Drop zero entries; undefined when nothing is left. */
function tidy(out) {
    let any = false;
    for (let k = 0; k < out.length; k++) {
        const e = out[k];
        if (!e) continue;
        if (e[0] === 0 && e[1] === 0) delete out[k]; else any = true;
    }
    return any ? out : undefined;
}

/** Whole frames to carry so the remainder lands in [-W/2, W/2). Exact. */
const carryOf = (v) => Math.floor((v + HALF_W) / W);

/**
 * `below` with (dx, dy) added at depth `k` (k >= 0), carries applied down to
 * the home level. Returns the new table (the input is not touched) and the
 * whole-frame carry that left the HOME level, in home FRAMES — a change of
 * address for the native, integers, usually 0.
 */
export function addOffset(below, k, dx, dy) {
    const out = cloneBelow(below) || [];
    if (!(k >= 0)) return { below: tidy(out), cellX: 0, cellY: 0 };
    const e = out[k] || (out[k] = [0, 0]);
    e[0] += dx; e[1] += dy;
    let cellX = 0, cellY = 0;
    for (let m = k; m >= 0; m--) {
        const q = out[m];
        if (!q) break;
        const nx = carryOf(q[0]), ny = carryOf(q[1]);
        if (!nx && !ny) break;
        q[0] -= nx * W; q[1] -= ny * W;
        if (m > 0) {
            const p = out[m - 1] || (out[m - 1] = [0, 0]);
            p[0] += nx * G; p[1] += ny * G;
        } else {
            cellX += nx; cellY += ny;
        }
    }
    return { below: tidy(out), cellX, cellY };
}

/**
 * THE TRANSLATION AT DEPTH `k0` BELOW THE HOME, decomposed:
 *
 *   digits   [[gx, gy], ...] for depths 1..k0 — whole cells of each level,
 *            integers; `digits[m]` is the cell count at depth m (index 0 unused)
 *   carry    [cx, cy] whole HOME frames that overflowed out of depth 1
 *   rem      [rx, ry] the sub-frame remainder at depth k0, in its units, in
 *            [-W/2, W/2) — what paint applies and inputs subtract
 *
 * For k0 < 0 (a level above the home) everything is sub-cell and only `rem`
 * is set. Every digit is an integer and every remainder from an entry at or
 * above k0 is a multiple of 2^-10 (the snap), so the sums here are exact;
 * entries deeper than k0 add exact power-of-two fractions and only their sum
 * can round, in the paint's own precision, which nothing inherits.
 */
export function shiftAt(below, k0) {
    const out = { digits: [], carry: [0, 0], rem: [0, 0] };
    if (!below) return out;
    const n = Math.max(0, k0);
    const dx = new Array(n + 1).fill(0), dy = new Array(n + 1).fill(0);
    let rx = 0, ry = 0, any = false;
    for (let k = 0; k < below.length; k++) {
        const e = offsetAt(below, k);
        if (!e) continue;
        any = true;
        if (k > k0) {
            const f = Math.pow(R, k0 - k);          // a power of two: exact
            rx += e[0] * f; ry += e[1] * f;
            continue;
        }
        const X = displacementDigits(e[0], k0 - k), Y = displacementDigits(e[1], k0 - k);
        for (let i = 0; i < X.digits.length; i++) { dx[k + 1 + i] += X.digits[i]; dy[k + 1 + i] += Y.digits[i]; }
        rx += X.rest; ry += Y.rest;
    }
    if (!any) return out;
    if (k0 < 0) { out.rem = [rx, ry]; return out; }
    // The remainder into [-W/2, W/2); what it carries goes into the digit at
    // k0 (or, at the home level, into the home-frame carry).
    const cx = carryOf(rx), cy = carryOf(ry);
    rx -= cx * W; ry -= cy * W;
    if (k0 > 0) { dx[k0] += cx; dy[k0] += cy; } else { out.carry = [cx, cy]; }
    // Digits into the balanced range, carrying upward; out of depth 1 is home frames.
    for (let m = n; m >= 1; m--) {
        const ax = Math.floor((dx[m] + R / 2) / R), ay = Math.floor((dy[m] + R / 2) / R);
        if (!ax && !ay) continue;
        dx[m] -= ax * R; dy[m] -= ay * R;
        if (m > 1) { dx[m - 1] += ax; dy[m - 1] += ay; } else { out.carry[0] += ax; out.carry[1] += ay; }
    }
    for (let m = 1; m <= n; m++) out.digits[m] = [dx[m], dy[m]];
    out.rem = [rx, ry];
    return out;
}

/** Does this translation move the picture by any whole frame at depth k0? */
export function hasDigits(sh) {
    if (!sh) return false;
    if (sh.carry[0] || sh.carry[1]) return true;
    for (let m = 1; m < sh.digits.length; m++) { const d = sh.digits[m]; if (d && (d[0] || d[1])) return true; }
    return false;
}

/**
 * The translation the picture at depth `k0` carries, as paint applies it —
 * `shiftAt(...).rem`, null when zero. The whole-frame part is the object's
 * address at that level (`LevelMap.objShift`), not a translation of anything.
 */
export function residual(below, k0) {
    if (!hasOffsets(below)) return null;
    const r = shiftAt(below, k0).rem;
    return r[0] !== 0 || r[1] !== 0 ? r : null;
}

/**
 * A kid `k` levels below its parent: its table from its own level down.
 * below[0] is the parent's remainder at that level (its whole frames are the
 * kid's address, see `LevelMap.frameShifted`); below[m] = parent.below[m + k].
 */
export function shiftDown(below, k) {
    if (!hasOffsets(below)) return undefined;
    const out = [];
    // The entries AT OR ABOVE the kid's level are what its own level absorbs
    // (their whole frames into its address, their remainder into below[0]);
    // the deeper entries stay deeper entries, shifted. Folding the deeper ones
    // into below[0] as well counted the displacement twice — measured as an
    // erase at the drag's level missing the moved ink by exactly the remainder.
    const above = [];
    for (let m = 0; m <= k && m < below.length; m++) { const e = offsetAt(below, m); if (e) above[m] = e; }
    const sh = shiftAt(above, k);
    if (sh.rem[0] !== 0 || sh.rem[1] !== 0) out[0] = [sh.rem[0], sh.rem[1]];
    for (let m = k + 1; m < below.length; m++) { const e = offsetAt(below, m); if (e) out[m - k] = [e[0], e[1]]; }
    return tidy(out);
}

/** The same object one level UP (promotion): below[m + 1] = old.below[m], the home level included. */
export function shiftUp(below) {
    if (!hasOffsets(below)) return undefined;
    const out = [];
    for (let m = 0; m < below.length; m++) { const e = offsetAt(below, m); if (e) out[m + 1] = [e[0], e[1]]; }
    return tidy(out);
}

/** Are two tables the same offsets? */
export function sameBelow(a, b) {
    const n = Math.max(a ? a.length : 0, b ? b.length : 0);
    for (let k = 0; k < n; k++) {
        const p = offsetAt(a, k), q = offsetAt(b, k);
        if (!p && !q) continue;
        if (!p || !q || p[0] !== q[0] || p[1] !== q[1]) return false;
    }
    return true;
}

/** The file form: `[[k, ox, oy], ...]`, or undefined when empty. */
export function encodeBelow(below) {
    if (!hasOffsets(below)) return undefined;
    const out = [];
    for (let k = 0; k < below.length; k++) { const e = offsetAt(below, k); if (e) out.push([k, e[0], e[1]]); }
    return out;
}

/** Back from the file form. Malformed input throws — persist validates first. */
export function decodeBelow(raw) {
    if (raw == null) return undefined;
    if (!Array.isArray(raw)) throw new Error("below: expected an array");
    const out = [];
    for (const t of raw) {
        if (!Array.isArray(t) || t.length !== 3 || !Number.isInteger(t[0]) || t[0] < 0
            || !Number.isFinite(t[1]) || !Number.isFinite(t[2])) throw new Error("below: each entry must be [k, ox, oy]");
        out[t[0]] = [t[1], t[2]];
    }
    return tidy(out);
}
