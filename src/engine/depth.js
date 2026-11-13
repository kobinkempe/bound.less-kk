/* global WeakRef, FinalizationRegistry */
/**
 * depth.js — depths and level counts of any size (docs/reference/depth-overflow-design-2026-11-13.md).
 *
 * A depth is a Number while it is a safe integer and a `Deep` outside ±(2^53 − 1): a sign and base-10^15 limbs, as
 * many as the value needs, so no depth is too deep but for the computer's memory and time. One value has one form, and
 * a Deep is interned (one object per value while any is held), so `===`, Map keys and ids agree. Every sum, difference
 * and comparison of depths goes through this module, two Numbers included: two safe depths can sum past 2^53 and round.
 * A Deep throws on `<`, `+`, `-` and the like, so a site that was missed fails loudly past 2^53; `String(d)`, a template
 * literal and `JSON.stringify` give its digits. A structured clone (postMessage, IndexedDB) drops its class: write
 * `toJSON(d)` there and `parse` it on arrival.
 */

const BASE = 1e15, LIMB = 15, SAFE = Number.MAX_SAFE_INTEGER, PAD = "000000000000000";

class Deep {
    constructor(sign, limbs) { this.sign = sign; this.limbs = limbs; this._s = null; }
    /** Its decimal digits, built once. */
    toString() {
        if (this._s === null) {
            const L = this.limbs, parts = new Array(L.length);
            parts[0] = (this.sign < 0 ? "-" : "") + L[L.length - 1];
            for (let i = L.length - 2, k = 1; i >= 0; i--, k++) { const s = String(L[i]); parts[k] = PAD.slice(s.length) + s; }
            this._s = parts.join("");
        }
        return this._s;
    }
    toJSON() { return this.toString(); }
    [Symbol.toPrimitive](hint) {
        if (hint === "string") return this.toString();
        throw new TypeError("a depth past 2^53 is not a Number: compare and add it with depth.js");
    }
}

// Interning: limbs hashed by their ends (nearby depths differ in the low limbs), a bucket per hash, weakly held.
const WEAK = typeof WeakRef === "function" && typeof FinalizationRegistry === "function";
const table = new Map();
const sweep = WEAK ? new FinalizationRegistry((h) => {
    const b = table.get(h);
    if (!b) return;
    const live = b.filter((r) => r.deref());
    if (live.length) table.set(h, live); else table.delete(h);
}) : null;
function hashOf(sign, L) {
    let h = (sign < 0 ? 0x3c6ef372 : 0x811c9dc5) ^ L.length;
    const mix = (v) => { h = Math.imul(h ^ (v % 4294967296 | 0), 16777619); h = Math.imul(h ^ ((v / 4294967296) | 0), 16777619); };
    const n = L.length, ends = Math.min(n, 4);
    for (let i = 0; i < ends; i++) mix(L[i]);
    for (let i = Math.max(ends, n - 4); i < n; i++) mix(L[i]);
    return h;
}
function sameLimbs(A, B) {
    if (A.length !== B.length) return false;
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
    return true;
}
function intern(sign, L) {
    const h = hashOf(sign, L), b = table.get(h);
    if (b) for (const r of b) { const d = WEAK ? r.deref() : r; if (d && d.sign === sign && sameLimbs(d.limbs, L)) return d; }
    const d = new Deep(sign, Object.freeze(L));
    const ref = WEAK ? new WeakRef(d) : d;
    if (b) b.push(ref); else table.set(h, [ref]);
    if (sweep) sweep.register(d, h);
    return d;
}

/** The value of `sign` × limbs `L` (little-endian, ours to trim) in its one form. */
function make(sign, L) {
    let n = L.length;
    while (n > 0 && L[n - 1] === 0) n--;
    L.length = n;
    if (n === 0) return 0;
    if (n <= 2) { const v = n === 1 ? L[0] : L[1] * BASE + L[0]; if (v <= SAFE) return sign < 0 ? -v : v; }
    return intern(sign, L);
}
function limbsOf(x) {
    if (x instanceof Deep) return x.limbs;
    if (!Number.isSafeInteger(x)) throw new TypeError(`not a depth: ${String(x)}`);
    const L = [];
    for (let a = Math.abs(x); a > 0;) { const r = a % BASE; L.push(r); a = (a - r) / BASE; }
    return L;
}
const signOf = (x) => (x instanceof Deep ? x.sign : x < 0 ? -1 : 1);
function cmpMag(A, B) {
    if (A.length !== B.length) return A.length < B.length ? -1 : 1;
    for (let i = A.length - 1; i >= 0; i--) if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
    return 0;
}
function addMag(A, B) {
    if (A.length < B.length) { const t = A; A = B; B = t; }
    const out = new Array(A.length + 1);
    let c = 0;
    for (let i = 0; i < A.length; i++) {
        const s = A[i] + (i < B.length ? B[i] : 0) + c;
        if (s >= BASE) { out[i] = s - BASE; c = 1; } else { out[i] = s; c = 0; }
    }
    out[A.length] = c;
    return out;
}
/** |A| − |B| for |A| ≥ |B|. */
function subMag(A, B) {
    const out = new Array(A.length);
    let w = 0;
    for (let i = 0; i < A.length; i++) {
        let s = A[i] - (i < B.length ? B[i] : 0) - w;
        if (s < 0) { s += BASE; w = 1; } else w = 0;
        out[i] = s;
    }
    return out;
}
function signedSum(sa, A, sb, B) {
    if (sa === sb) return make(sa, addMag(A, B));
    const c = cmpMag(A, B);
    if (c === 0) return 0;
    return c > 0 ? make(sa, subMag(A, B)) : make(sb, subMag(B, A));
}

export function add(a, b) {
    if (typeof a === "number" && typeof b === "number") { const s = a + b; if (Number.isSafeInteger(s)) return s; }
    return signedSum(signOf(a), limbsOf(a), signOf(b), limbsOf(b));
}
export function sub(a, b) {
    if (typeof a === "number" && typeof b === "number") { const s = a - b; if (Number.isSafeInteger(s)) return s; }
    return signedSum(signOf(a), limbsOf(a), 0 - signOf(b), limbsOf(b));
}

/** A double past 2^53 (an integer), exactly: its 53-bit significand doubled back up. */
function fromDouble(x) {
    let m = Math.abs(x), e = 0;
    while (m > SAFE) { m /= 2; e++; }
    const L = limbsOf(m);
    for (; e > 0; e -= 3) {
        const f = e >= 3 ? 8 : 1 << e;
        let c = 0;
        for (let i = 0; i < L.length; i++) { const v = L[i] * f + c, r = v % BASE; L[i] = r; c = (v - r) / BASE; }
        if (c) L.push(c);
    }
    return make(x < 0 ? -1 : 1, L);
}
/** A Number (a safe depth, ±Infinity as a bound, or any double) against a Deep, which lies past ±(2^53 − 1). */
function cmpNum(x, d) {
    if (Number.isNaN(x)) return 0;   // unordered, as `<` has it
    if (Math.abs(x) <= SAFE) return d.sign > 0 ? -1 : 1;
    if (x === Infinity || x === -Infinity) return x > 0 ? 1 : -1;
    return cmp(fromDouble(x), d);
}
/** −1, 0 or 1: for sorts, and the order of any two depths. */
export function cmp(a, b) {
    const A = a instanceof Deep, B = b instanceof Deep;
    if (!A && !B) return a < b ? -1 : a > b ? 1 : 0;
    if (A && B) {
        if (a === b) return 0;
        if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
        const m = cmpMag(a.limbs, b.limbs);
        return a.sign > 0 ? m : 0 - m;
    }
    return A ? 0 - cmpNum(b, a) : cmpNum(a, b);
}
const nums = (a, b) => typeof a === "number" && typeof b === "number";
export const lt = (a, b) => (nums(a, b) ? a < b : cmp(a, b) < 0);
export const le = (a, b) => (nums(a, b) ? a <= b : cmp(a, b) <= 0);
export const gt = (a, b) => (nums(a, b) ? a > b : cmp(a, b) > 0);
export const ge = (a, b) => (nums(a, b) ? a >= b : cmp(a, b) >= 0);
export const min = (a, b) => (lt(b, a) ? b : a);
export const max = (a, b) => (gt(b, a) ? b : a);
export const neg = (a) => (a instanceof Deep ? intern(0 - a.sign, a.limbs) : 0 - a);
export const abs = (a) => (a instanceof Deep ? (a.sign < 0 ? neg(a) : a) : Math.abs(a));
/** A Deep: a depth past ±(2^53 − 1). */
export const isBig = (d) => d instanceof Deep;
/** A depth in its one form. */
export const isDepth = (d) => Number.isSafeInteger(d) || d instanceof Deep;

/** The nearest double, for float maths that saturates anyway (a zoom's log, `powR`): ±Infinity past 1.8 × 10^308. */
export function toNumber(d) {
    if (!(d instanceof Deep)) return d;
    return d.limbs.length <= 21 ? Number(d.toString()) : d.sign * Infinity;
}
/** For a file or a structured clone: a Deep as its decimal string, a Number as it is. */
export const toJSON = (d) => (d instanceof Deep ? d.toString() : d);

const CANON = /^-?(?:0|[1-9][0-9]*)$/;
/** A depth from a file or an id: a safe-integer Number, a Deep, or a canonical decimal string of any length; else null. */
export function parse(v) {
    if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
    if (v instanceof Deep) return v;
    if (typeof v !== "string" || v === "-0" || !CANON.test(v)) return null;
    const lead = v[0] === "-" ? 1 : 0;
    if (v.length - lead <= LIMB) return Number(v);
    const L = new Array(Math.ceil((v.length - lead) / LIMB));
    for (let i = 0, end = v.length; i < L.length; i++, end -= LIMB) L[i] = Number(v.slice(Math.max(lead, end - LIMB), end));
    const d = make(lead ? -1 : 1, L);
    if (d instanceof Deep && d._s === null) d._s = v;
    return d;
}

/** log10 |d| as a double, at any size: a long Deep by its top limbs and its length. */
export function log10Abs(d) {
    if (!(d instanceof Deep) || d.limbs.length <= 20) return Math.log10(Math.abs(toNumber(d)));
    const L = d.limbs, n = L.length;
    return Math.log10(L[n - 1] * 1e30 + L[n - 2] * BASE + L[n - 3]) + LIMB * (n - 3);
}
