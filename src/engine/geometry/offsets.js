/* global WeakRef, FinalizationRegistry */
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
 * levels down that lost bit is a screen. A PICTURE table (A1 C1: the own table
 * with the home frame's shift, `composeShift`) is never carried: its k = 0
 * entry may reach a frame and a half, read as the neighbour the picture is
 * drawn in (`LevelMap.objShift`).
 *
 * A CEDED KID k levels below its parent is homed in the frame the parent's
 * PICTURE occupies at that level (the moved frame), holds the parent's stored
 * bits for that square, and carries the parent's picture table from that level
 * down, less its own frame's shift (`Document.cedeTileById`, `ownFor`). A
 * promoted object (moved one level UP by `scaleGeometry`) shifts the other way.
 */
import { W, G, R, HALF_W } from "../frameLattice";
import { displacementDigitsSparse, powR } from "../frameLattice";
import * as dm from "../depth";

/** The move grid: 2^-10 of a level's unit, a quarter pixel at its deepest zoom. */
export const SNAP = 1 / 1024;
/** A displacement, on the grid. Exact: a multiply and a divide by a power of two round a float to it. */
export function snapDisplacement(v) { return Math.round(v * 1024) / 1024; }

/** The offset at depth `k` below the home (k >= 0), or null. */
export function offsetAt(below, k) {
    if (!below || !dm.isDepth(k) || dm.lt(k, 0)) return null;
    const e = below[k];
    return e && (e[0] !== 0 || e[1] !== 0) ? e : null;
}

/** Does this table hold any offset at all? */
export function hasOffsets(below) {
    return !!below && eachIndex(below, (k) => !!offsetAt(below, k));
}

/** A detached copy, or undefined when there is nothing to copy. */
export function cloneBelow(below) {
    if (!hasOffsets(below)) return undefined;
    const out = [];
    eachIndex(below, (k) => { const e = offsetAt(below, k); if (e) put(out, k, [e[0], e[1]]); });
    return out;
}

// Equal tables share one frozen array (memory-chrome-2026-10-20.md: 24,901 tables of ~95 values on the Magnum
// Opus, two copies a member in a drag's undo record). Nothing writes a table in place — `addOffset` and the rest
// copy first — and the freeze makes a write throw. Weak: a value nothing holds is collected.
const SHARED = new WeakSet();
const POOL = typeof WeakRef === "function" && typeof FinalizationRegistry === "function" ? new Map() : null;
const REAP = POOL && new FinalizationRegistry((key) => { const r = POOL.get(key); if (r && r.deref() === undefined) POOL.delete(key); });

/** The shared, frozen table equal to `below` (zero entries dropped), or undefined when it has no offset. */
export function internBelow(below) {
    if (!below) return undefined;
    if (SHARED.has(below)) return below;
    let key = "";
    eachIndex(below, (k) => { const e = offsetAt(below, k); if (e) key += `${k}:${e[0]},${e[1]};`; });
    if (!key) return undefined;
    const ref = POOL && POOL.get(key), hit = ref && ref.deref();
    if (hit) return hit;
    const out = cloneBelow(below);
    eachIndex(out, (k) => { Object.freeze(out[k]); });
    Object.freeze(out);
    SHARED.add(out);
    if (POOL) { POOL.set(key, new WeakRef(out)); REAP.register(out, key); }
    return out;
}

/** Drop zero entries; undefined when nothing is left. */
function tidy(out) {
    let any = false;
    eachIndex(out, (k) => {
        const e = out[k];
        if (!e) return;
        if (e[0] === 0 && e[1] === 0) delete out[k]; else any = true;
    });
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
    if (!dm.isDepth(k) || dm.lt(k, 0)) return { below: tidy(out), cellX: 0, cellY: 0 };
    const e = out[k] || put(out, k, [0, 0]);
    e[0] += dx; e[1] += dy;
    let cellX = 0, cellY = 0;
    for (let m = k; dm.ge(m, 0); m = dm.sub(m, 1)) {
        const q = out[m];
        if (!q) break;
        const nx = carryOf(q[0]), ny = carryOf(q[1]);
        if (!nx && !ny) break;
        q[0] -= nx * W; q[1] -= ny * W;
        if (dm.gt(m, 0)) {
            const m1 = dm.sub(m, 1), p = out[m1] || put(out, m1, [0, 0]);
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
    // Whole cells by level, sparse: an entry's digits stop a few levels below it (the snap), at any depth.
    const dx = new Map(), dy = new Map();
    const add = (map, m, v) => { if (v) map.set(m, (map.get(m) || 0) + v); };
    let rx = 0, ry = 0, any = false;
    eachIndex(below, (k) => {
        const e = offsetAt(below, k);
        if (!e) return;
        any = true;
        if (dm.gt(k, k0)) {
            const f = powR(dm.toNumber(dm.sub(k0, k)));
            rx += e[0] * f; ry += e[1] * f;
            return;
        }
        const n = dm.sub(k0, k), X = displacementDigitsSparse(e[0], n), Y = displacementDigitsSparse(e[1], n);
        X.digits.forEach((v, i) => add(dx, dm.add(k, 1 + i), v));
        Y.digits.forEach((v, i) => add(dy, dm.add(k, 1 + i), v));
        rx += X.rest; ry += Y.rest;
    });
    if (!any) return out;
    if (dm.lt(k0, 0)) { out.rem = [rx, ry]; return out; }
    // The remainder into [-W/2, W/2); what it carries goes into the digit at
    // k0 (or, at the home level, into the home-frame carry).
    const cx = carryOf(rx), cy = carryOf(ry);
    rx -= cx * W; ry -= cy * W;
    if (dm.gt(k0, 0)) { add(dx, k0, cx); add(dy, k0, cy); } else { out.carry = [cx, cy]; }
    // Digits into the balanced range, carrying upward, finest first; out of depth 1 is home frames.
    const keys = [...new Set([...dx.keys(), ...dy.keys()])].sort((a, b) => dm.cmp(b, a));
    let q = 0, m = keys.length ? keys[0] : 0;
    while (dm.ge(m, 1)) {
        const vx = dx.get(m) || 0, vy = dy.get(m) || 0;
        const ax = Math.floor((vx + R / 2) / R), ay = Math.floor((vy + R / 2) / R);
        if (ax || ay) {
            dx.set(m, vx - ax * R); dy.set(m, vy - ay * R);
            if (dm.gt(m, 1)) { m = dm.sub(m, 1); add(dx, m, ax); add(dy, m, ay); continue; }
            out.carry[0] += ax; out.carry[1] += ay;
        }
        while (q < keys.length && dm.ge(keys[q], m)) q++;
        m = q < keys.length ? keys[q] : 0;
    }
    for (const lv of [...new Set([...dx.keys(), ...dy.keys()])].sort(dm.cmp)) {
        const gx = dx.get(lv) || 0, gy = dy.get(lv) || 0;
        if (gx || gy) put(out.digits, lv, [gx, gy]);
    }
    out.rem = [rx, ry];
    return out;
}

// A table is a sparse array by depth, and a depth past an array's last index (2^32 − 2) is a plain key that `length`
// does not count: `put` keeps such a table's length at 64 or more, so `eachIndex` reads its keys.
const LAST_INDEX = 4294967294;
/** out[k] = v, returned. */
function put(out, k, v) {
    out[k] = v;
    if (dm.gt(k, LAST_INDEX) && out.length < 64) out.length = 64;
    return v;
}
/**
 * The defined depths of a table (or `shiftAt`'s digits), ascending: a plain loop when it is short, its keys when long
 * (a deep entry). Stops, returning true, when `fn` returns true.
 */
function eachIndex(a, fn) {
    if (a.length < 64) {
        for (let k = 0; k < a.length; k++) if (a[k] !== undefined && fn(k) === true) return true;
        return false;
    }
    let ks = [], deep = false;
    for (const key of Object.keys(a)) {
        const k = dm.parse(key);   // past 2^53 a key is a Deep's digits
        if (k != null && dm.ge(k, 0)) { ks.push(k); if (dm.gt(k, LAST_INDEX)) deep = true; }
    }
    if (deep) ks = ks.sort(dm.cmp);   // keys list indices first, then plain keys as they were added
    for (const k of ks) if (fn(k) === true) return true;
    return false;
}

/** `fn(m, [gx, gy])` for each level m ≥ 1 where `shiftAt`'s translation has whole cells (its digits are sparse). */
export function eachDigit(sh, fn) { eachIndex(sh.digits, (m) => { if (dm.ge(m, 1)) fn(m, sh.digits[m]); }); }

/** Does this translation move the picture by any whole frame at depth k0? */
export function hasDigits(sh) {
    if (!sh) return false;
    if (sh.carry[0] || sh.carry[1]) return true;
    let any = false;
    eachDigit(sh, (m, d) => { if (d[0] || d[1]) any = true; });
    return any;
}

/**
 * The picture's translation at depth `k0`: `{ carry, rem }` — `shiftAt`'s whole home frames beside
 * the sub-frame remainder paint applies — or null when both are zero. A composed table (A1 C1) can
 * carry at the home depth: 0.75 W is one frame and −0.25 W, never −0.25 W alone. The frames are an
 * address (`LevelMap.objShift`), not a translation of anything.
 */
export function residual(below, k0) {
    if (!hasOffsets(below)) return null;
    const { carry: c, rem: r } = shiftAt(below, k0);
    return c[0] || c[1] || r[0] || r[1] ? { carry: [c[0], c[1]], rem: [r[0], r[1]] } : null;
}

/** A table's whole translation at the home depth in home units — its whole frames and remainder — or null. */
export function homeTranslation(below) {
    const r = residual(below, 0);
    return r ? [r.carry[0] * W + r.rem[0], r.carry[1] * W + r.rem[1]] : null;
}

/** Native `o`'s own table's translation at its home (k = 0), without its frame's shift; null when it has none. */
export function ownTranslation(o) { return homeTranslation(o.below); }

/** Native `o`'s picture table given its home frame's shift: `composeShift` of its own (A1 C1). */
export function pictureTable(o, shift) { return composeShift(o.below, shift); }

/** Native `o`'s own table as a piece cut from it or an undo entry keeps it: the shared value (undefined when none). */
export function ownTableOf(o) { return internBelow(o.below); }

/**
 * The own table a native homed in a frame with `shift` carries to be drawn with picture table `T`: `T` less the
 * shift (A1 C1: new ink and a ceded kid are drawn where they were put). A copy; undefined when none. The one
 * helper of `Document.ownFor` and the descent's kids (PLAN §5.14 item 4).
 */
export function ownTableFor(T, shift) {
    return shift && (shift[0] || shift[1]) ? cloneBelow(composeShift(T, [-shift[0], -shift[1]])) : cloneBelow(T);
}

/**
 * A native's PICTURE table (A1 C1): its own table with its home frame's shift added at k = 0, without
 * a carry, so the sum may reach a frame and a half. `below` itself when the frame has no shift.
 * Exact: both terms are multiples of 2^-10 under 2^18.
 */
export function composeShift(below, shift) {
    if (!shift || (shift[0] === 0 && shift[1] === 0)) return below;
    const out = cloneBelow(below) || [];
    const e = out[0] || (out[0] = [0, 0]);
    e[0] += shift[0]; e[1] += shift[1];
    return tidy(out);
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
    eachIndex(below, (m) => {
        const e = offsetAt(below, m);
        if (e && dm.le(m, k)) put(above, m, e);
        else if (e) put(out, dm.sub(m, k), [e[0], e[1]]);
    });
    const sh = shiftAt(above, k);
    if (sh.rem[0] !== 0 || sh.rem[1] !== 0) out[0] = [sh.rem[0], sh.rem[1]];
    return tidy(out);
}

/** The same object one level UP (promotion): below[m + 1] = old.below[m], the home level included. */
export function shiftUp(below) {
    if (!hasOffsets(below)) return undefined;
    const out = [];
    eachIndex(below, (m) => { const e = offsetAt(below, m); if (e) put(out, dm.add(m, 1), [e[0], e[1]]); });
    return tidy(out);
}

/** Two frame shifts (or nulls) equal. */
export function sameShift(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a[0] === b[0] && a[1] === b[1];
}
/** Are two tables the same offsets? */
export function sameBelow(a, b) {
    const differs = (k) => {
        const p = offsetAt(a, k), q = offsetAt(b, k);
        return (!!p || !!q) && (!p || !q || p[0] !== q[0] || p[1] !== q[1]);
    };
    return !(a && eachIndex(a, differs)) && !(b && eachIndex(b, differs));
}

/** The file form: `[[k, ox, oy], ...]`, or undefined when empty. */
export function encodeBelow(below) {
    if (!hasOffsets(below)) return undefined;
    const out = [];
    eachIndex(below, (k) => { const e = offsetAt(below, k); if (e) out.push([dm.toJSON(k), e[0], e[1]]); });
    return out;
}

/** Back from the file form. Malformed input throws — persist validates first. */
export function decodeBelow(raw) {
    if (raw == null) return undefined;
    if (!Array.isArray(raw)) throw new Error("below: expected an array");
    const out = [];
    for (const t of raw) {
        const k = Array.isArray(t) ? dm.parse(t[0]) : null;   // a depth past 2^53 is its digits (from 1.1)
        if (!Array.isArray(t) || t.length !== 3 || k == null || dm.lt(k, 0)
            || !Number.isFinite(t[1]) || !Number.isFinite(t[2])) throw new Error("below: each entry must be [k, ox, oy]");
        put(out, k, [t[1], t[2]]);
    }
    return tidy(out);
}
