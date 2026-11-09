// detMath (OPEN-FLAGS F176): fdlibm's bits from + − × ÷ and sqrt. On V8 8.4 (node 14) it is checked against Math
// itself; on any engine, against a digest of its results recorded on node 14. `__review__/detmath.probe.js` is the
// large run (1.2–1.6 million inputs a function).
import * as D from "./detMath";

const f = new Float64Array(1), u = new Uint32Array(f.buffer);
const fromWords = (hi, lo) => { u[1] = hi >>> 0; u[0] = lo >>> 0; return f[0]; };
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Object.is(a, b);
function inputs(seed) {
    let s = seed >>> 0;
    const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
    const out = [0, -0, 1, -1, 0.5, -0.5, Math.PI, -Math.PI / 2, Math.PI / 4, Infinity, -Infinity, NaN, Number.MIN_VALUE, 1e300];
    for (let i = 0; i < 4000; i++) out.push(-10 + 20 * (r() / 4294967296));                                  // chain angles
    for (let i = 0; i < 4000; i++) { const e = r() % 80 - 60; const x = fromWords(((e + 1023) << 20) | (r() & 0xfffff), r()); out.push(r() & 1 ? -x : x); }
    for (let i = 0; i < 2000; i++) out.push(-1 + 2 * (r() / 4294967296));
    for (const h of [0x3fe921fb, 0x4002d97c, 0x413921fb, 0x3e400000, 0x3e300000, 0x3fd33333, 0x3fe90000, 0x3fe59428,
        0x3fdc0000, 0x3fe60000, 0x3ff30000, 0x40038000, 0x44100000, 0x3fe00000, 0x3fef3333, 0x3c600000, 0x3ff921fb]) {
        for (let i = 0; i < 120; i++) { const x = fromWords(h + (r() % 3) - 1, r()); out.push(r() & 1 ? -x : x); }
    }
    return out;
}
const ONE = ["sin", "cos", "tan", "atan", "acos", "asin"];
const X = inputs(0x9e3779b9), Y = inputs(0x7f4a7c15);
/** FNV-1a over every result's bits. */
function digest(fn, two) {
    let h = 0x811c9dc5;
    for (let i = 0; i < X.length; i++) {
        f[0] = two ? fn(X[i], Y[i]) : fn(X[i]);
        if (Number.isNaN(f[0])) f[0] = NaN;
        for (const w of [u[0], u[1]]) for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((w >>> (8 * k)) & 0xff), 16777619);
    }
    return (h >>> 0).toString(16);
}

const onV84 = process.versions.v8.startsWith("8.4.");
(onV84 ? test : test.skip)("the same bits as V8 8.4's Math, below 2^19·π/2", () => {
    const bad = [];
    for (const n of ONE) for (const x of X) if (!same(D[n](x), Math[n](x))) bad.push([n, x]);
    for (let i = 0; i < X.length; i++) {
        if (!same(D.atan2(X[i], Y[i]), Math.atan2(X[i], Y[i]))) bad.push(["atan2", X[i], Y[i]]);
        if (!same(D.hypot(X[i], Y[i]), Math.hypot(X[i], Y[i]))) bad.push(["hypot", X[i], Y[i]]);
    }
    expect(bad.slice(0, 5)).toEqual([]);
});

test("the same bits on every engine: a digest recorded on node 14", () => {
    const got = Object.fromEntries([...ONE.map((n) => [n, digest(D[n])]), ["atan2", digest(D.atan2, true)], ["hypot", digest(D.hypot, true)]]);
    expect(got).toEqual(DIGESTS);
});

test("past 2^19·π/2 (an exact BigInt reduction): within one last bit of the engine's own", () => {
    let s = 12345;
    const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s; };
    for (let i = 0; i < 300; i++) {
        const e = 20 + (r() % 1000), x = fromWords(((e + 1023) << 20) | (r() & 0xfffff), r());
        for (const n of ["sin", "cos", "tan"]) {
            const a = D[n](x), b = Math[n](x);
            f[0] = b;
            const ulp = Math.pow(2, ((u[1] >>> 20) & 0x7ff) - 1075);
            expect([n, x, Math.abs(a - b) <= ulp]).toEqual([n, x, true]);
        }
    }
    expect(D.sin(1e22)).toBe(-0.8522008497671888);   // the classic hard case: 1e22 is 4e21 whole turns plus a hair
});

// Recorded 2026-11-03 on node 14.18.0 (V8 8.4), where the first test also holds.
const DIGESTS = { sin: "9112b7e", cos: "93716996", tan: "1bdf6a07", atan: "2cc4a57c", acos: "379ed7df", asin: "db00584c",
    atan2: "d5195831", hypot: "146bb55c" };
