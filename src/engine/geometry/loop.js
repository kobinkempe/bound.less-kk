/**
 * loop.js — a loop of arc and line pieces as ONE Float64Array (WORKLIST memory step 2,
 * 2026-09-08; DESIGN.md §3). The numbers are the snapshot grammar, kobin-1's text and
 * kobin-2's span alike:
 *
 *   loop  := ax, ay, piece*
 *   piece := 0, bx, by                                                    line
 *          | 1, cx, cy, r, a0, sweep, bx, by                              arc
 *          | 2, px, py, qx, qy, sa, sb, bx, by                            cut line (F43)
 *          | 3, cx, cy, r, a0, sweep, Ka0, Ksweep, KAx, KAy, KBx, KBy, ua, ub, bx, by
 *                                                                         cut arc (F43)
 *
 * Consecutive pieces share an endpoint exactly, so a piece's A is the record before
 * it (the loop's start for the first) and is stored once. `at(i)` and iteration hand
 * back TRANSIENT views shaped exactly like the piece objects the geometry code has
 * always read (`A`, `B`, `C` as plain arrays, `r`, `a0`, `sweep`, `line`, the cut
 * fields); nothing retains a view, and nothing writes through one — a move is
 * `translate`, a new Loop. Measured before this on the 12,844-object canvas: an arc
 * piece as an object cost 344 B for 56 B of numbers; here it is 64 B and a 4 B index.
 *
 * Builders (the boolean, the freeze, strokeLoops, the transforms) keep producing plain
 * piece arrays, which are transient; the storage boundaries (Document, TileStore) turn
 * them into Loops with `Loop.from`. A loop read from a snapshot is wrapped over the
 * span with no copy. Layering: this file imports nothing.
 */

const WIDTH = { 0: 3, 1: 8, 2: 9, 3: 16 };
const widthOf = (code) => WIDTH[code] || 8;   // an unknown code reads as an arc, as decodeLoops always did

/** The record offsets of a loop's pieces. Throws on a loop that does not end on a record boundary. */
export function indexLoop(buf) {
    const n = buf.length;
    if (n < 5) return new Uint32Array(0);
    let count = 0;
    for (let i = 2; i < n; i += widthOf(buf[i])) count++;
    const idx = new Uint32Array(count);
    let k = 0;
    for (let i = 2; i < n; i += widthOf(buf[i])) idx[k++] = i;
    return idx;
}
/** One piece as the geometry code reads it, from the record at `o`; `A` is its start point. */
export function decodePiece(a, o, A) {
    const code = a[o];
    if (code === 0) return { line: true, A, B: [a[o + 1], a[o + 2]] };
    if (code === 2) return { line: true, A, B: [a[o + 7], a[o + 8]], P: [a[o + 1], a[o + 2]], Q: [a[o + 3], a[o + 4]], sa: a[o + 5], sb: a[o + 6] };
    if (code === 3) {
        return { line: false, C: [a[o + 1], a[o + 2]], r: a[o + 3], a0: a[o + 4], sweep: a[o + 5], A, B: [a[o + 14], a[o + 15]],
            K: { a0: a[o + 6], sweep: a[o + 7], A: [a[o + 8], a[o + 9]], B: [a[o + 10], a[o + 11]] }, ua: a[o + 12], ub: a[o + 13] };
    }
    return { line: false, C: [a[o + 1], a[o + 2]], r: a[o + 3], a0: a[o + 4], sweep: a[o + 5], A, B: [a[o + 6], a[o + 7]] };
}
/**
 * One loop's numbers appended to `out` — anything with a variadic `push`: a plain array
 * for kobin-1 JSON, `format2.F64Builder` for a kobin-2 span. A Loop copies its numbers;
 * piece objects are encoded. One grammar, one implementation.
 */
export function encodeLoopInto(loop, out) {
    if (loop instanceof Loop) { const b = loop.buf; for (let i = 0; i < b.length; i++) out.push(b[i]); return out; }
    out.push(loop[0].A[0], loop[0].A[1]);
    for (const p of loop) {
        // A CUT line (F43) is code 2: the line it was cut from and the positions of
        // its ends on it, then its end; a CUT arc is code 3: the piece's own arc, the
        // arc it was cut from and its positions on it, then its end. Files carrying
        // either are format version 2 (persist.js).
        if (p.line && p.P) out.push(2, p.P[0], p.P[1], p.Q[0], p.Q[1], p.sa, p.sb, p.B[0], p.B[1]);
        else if (p.line || !isFinite(p.r)) out.push(0, p.B[0], p.B[1]);
        else if (p.K) out.push(3, p.C[0], p.C[1], p.r, p.a0, p.sweep, p.K.a0, p.K.sweep, p.K.A[0], p.K.A[1], p.K.B[0], p.K.B[1], p.ua, p.ub, p.B[0], p.B[1]);
        else out.push(1, p.C[0], p.C[1], p.r, p.a0, p.sweep, p.B[0], p.B[1]);
    }
    return out;
}
/** Every point in a loop's numbers moved by (dx, dy), in place. */
export function shiftLoopNumbers(a, dx, dy) {
    a[0] += dx; a[1] += dy;
    for (let o = 2; o < a.length; o += widthOf(a[o])) {
        const code = a[o];
        if (code === 0) { a[o + 1] += dx; a[o + 2] += dy; }
        else if (code === 2) { a[o + 1] += dx; a[o + 2] += dy; a[o + 3] += dx; a[o + 4] += dy; a[o + 7] += dx; a[o + 8] += dy; }
        else if (code === 3) { a[o + 1] += dx; a[o + 2] += dy; a[o + 8] += dx; a[o + 9] += dy; a[o + 10] += dx; a[o + 11] += dy; a[o + 14] += dx; a[o + 15] += dy; }
        else { a[o + 1] += dx; a[o + 2] += dy; a[o + 6] += dx; a[o + 7] += dy; }
    }
    return a;
}

export class Loop {
    /** @param {Float64Array} buf the numbers @param {Uint32Array} [idx] the record offsets (built when absent) */
    constructor(buf, idx) { this.buf = buf; this.idx = idx || indexLoop(buf); }
    static is(x) { return x instanceof Loop; }
    /** A Loop over a loop's numbers: a Float64Array is used as it is (a snapshot span), anything else copied. */
    static wrap(enc) { return new Loop(enc instanceof Float64Array ? enc : Float64Array.from(enc)); }
    /**
     * A Loop from piece objects (a builder's output); a Loop passes through. One pass
     * counts, one fills a Float64Array and the index together — every bake and every
     * derived tile comes through here, and the push-then-copy form cost the fuzz
     * suite's cede path a third of its render time.
     */
    static from(pieces) {
        if (pieces instanceof Loop) return pieces;
        const n = pieces.length;
        if (!n) return new Loop(new Float64Array(0), new Uint32Array(0));
        let len = 2;
        for (let i = 0; i < n; i++) { const p = pieces[i]; len += p.line ? (p.P ? 9 : 3) : !isFinite(p.r) ? 3 : p.K ? 16 : 8; }
        const buf = new Float64Array(len), idx = new Uint32Array(n);
        buf[0] = pieces[0].A[0]; buf[1] = pieces[0].A[1];
        let o = 2;
        for (let i = 0; i < n; i++) {
            const p = pieces[i];
            idx[i] = o;
            if (p.line && p.P) { buf[o] = 2; buf[o + 1] = p.P[0]; buf[o + 2] = p.P[1]; buf[o + 3] = p.Q[0]; buf[o + 4] = p.Q[1]; buf[o + 5] = p.sa; buf[o + 6] = p.sb; buf[o + 7] = p.B[0]; buf[o + 8] = p.B[1]; o += 9; }
            else if (p.line || !isFinite(p.r)) { buf[o] = 0; buf[o + 1] = p.B[0]; buf[o + 2] = p.B[1]; o += 3; }
            else if (p.K) {
                buf[o] = 3; buf[o + 1] = p.C[0]; buf[o + 2] = p.C[1]; buf[o + 3] = p.r; buf[o + 4] = p.a0; buf[o + 5] = p.sweep;
                buf[o + 6] = p.K.a0; buf[o + 7] = p.K.sweep; buf[o + 8] = p.K.A[0]; buf[o + 9] = p.K.A[1]; buf[o + 10] = p.K.B[0]; buf[o + 11] = p.K.B[1];
                buf[o + 12] = p.ua; buf[o + 13] = p.ub; buf[o + 14] = p.B[0]; buf[o + 15] = p.B[1]; o += 16;
            } else { buf[o] = 1; buf[o + 1] = p.C[0]; buf[o + 2] = p.C[1]; buf[o + 3] = p.r; buf[o + 4] = p.a0; buf[o + 5] = p.sweep; buf[o + 6] = p.B[0]; buf[o + 7] = p.B[1]; o += 8; }
        }
        return new Loop(buf, idx);
    }
    /** The number of pieces. */
    get length() { return this.idx.length; }
    /** Piece `i` as a fresh view (negative from the end), or undefined. */
    at(i) {
        const n = this.idx.length;
        if (i < 0) i += n;
        if (!(i >= 0 && i < n)) return undefined;
        const o = this.idx[i], b = this.buf;
        return decodePiece(b, o, i === 0 ? [b[0], b[1]] : [b[o - 2], b[o - 1]]);
    }
    *[Symbol.iterator]() {
        const b = this.buf, idx = this.idx;
        let A = [b[0], b[1]];
        for (let i = 0; i < idx.length; i++) { const p = decodePiece(b, idx[i], A); A = p.B; yield p; }
    }
    toPieces() { return [...this]; }
    map(fn) { const out = new Array(this.idx.length); let i = 0; for (const p of this) { out[i] = fn(p, i, this); i++; } return out; }
    forEach(fn) { let i = 0; for (const p of this) fn(p, i++, this); }
    some(fn) { let i = 0; for (const p of this) if (fn(p, i++, this)) return true; return false; }
    every(fn) { let i = 0; for (const p of this) if (!fn(p, i++, this)) return false; return true; }
    filter(fn) { const out = []; let i = 0; for (const p of this) if (fn(p, i++, this)) out.push(p); return out; }
    reduce(fn, init) { let acc = init, i = 0; for (const p of this) acc = fn(acc, p, i++, this); return acc; }
    slice(a = 0, b = this.idx.length) { return this.toPieces().slice(a, b); }
    /** The same loop with every point moved by (dx, dy): a new Loop over a copy; the index is shared. */
    translate(dx, dy) { return new Loop(shiftLoopNumbers(this.buf.slice(), dx, dy), this.idx); }
    /** The numbers as a plain array (kobin-1 JSON). */
    toArray() { return Array.from(this.buf); }
    /** Bytes held, for the memory instruments. */
    get byteLength() { return this.buf.byteLength + this.idx.byteLength; }
}
