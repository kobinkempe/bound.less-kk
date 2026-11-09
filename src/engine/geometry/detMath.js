/**
 * The derivation chain's own sin, cos, tan, atan, atan2, acos, asin and hypot (OPEN-FLAGS F176). ECMAScript leaves
 * these to each engine, and a deep tile inherits their last bits 4096× a level, so the chain does not call Math's: a
 * port of fdlibm (V8's src/base/ieee754.cc as V8 8.4 ran it) and of V8's two-argument Math.hypot, built from + − × ÷
 * and sqrt only, so every browser gets the same bits. It matches node 14's Math bit for bit (detMath.test.js); Chrome
 * 155's Math differs from it on a few per cent of inputs. Arguments past 2^19·π/2 are reduced exactly with BigInt.
 */
/* global BigInt */
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
// The high word's index: 1 on a little-endian machine, 0 on a big-endian one.
const H = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 1 : 0, L = 1 - H;
const HI = (x) => { f64[0] = x; return u32[H] | 0; };
const LO = (x) => { f64[0] = x; return u32[L]; };
const withLo0 = (x) => { f64[0] = x; u32[L] = 0; return f64[0]; };
const words = (hi, lo) => { u32[H] = hi >>> 0; u32[L] = lo >>> 0; return f64[0]; };

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
    S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
function kSin(x, y, iy) {
    const ix = HI(x) & 0x7fffffff;
    if (ix < 0x3e400000 && (x | 0) === 0) return x;
    const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
    C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kCos(x, y) {
    const ix = HI(x) & 0x7fffffff;
    if (ix < 0x3e400000 && (x | 0) === 0) return 1;
    const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
    const qx = ix > 0x3fe90000 ? 0.28125 : words(ix - 0x00200000, 0);
    return (1 - qx) - ((0.5 * z - qx) - (z * r - x * y));
}
const T0 = 3.33333333333334091986e-01, T1 = 1.33333333333201242699e-01, T2 = 5.39682539762260521377e-02,
    T3 = 2.18694882948595424599e-02, T4 = 8.86323982359930005737e-03, T5 = 3.59207910759131235356e-03,
    T6 = 1.45620945432529025516e-03, T7 = 5.88041240820264096874e-04, T8 = 2.46463134818469906812e-04,
    T9 = 7.81794442939557092300e-05, T10 = 7.14072491382608190305e-05, T11 = -1.85586374855275456654e-05,
    T12 = 2.59073051863633712884e-05, pio4 = 7.85398163397448278999e-01, pio4lo = 3.06161699786838301793e-17;
/** tan(x + y) on [-π/4, π/4] for iy = 1, −1 / tan(x + y) for iy = −1. */
function kTan(x, y, iy) {
    const hx = HI(x), ix = hx & 0x7fffffff;
    if (ix < 0x3e300000 && (x | 0) === 0) {
        if ((ix | LO(x) | (iy + 1)) === 0) return 1 / Math.abs(x);
        if (iy === 1) return x;
        const w = x + y, z = withLo0(w), v = y - (z - x), a = -1 / w, t = withLo0(a), s = 1 + t * z;
        return t + a * (s + t * v);
    }
    if (ix >= 0x3fe59428) {
        if (hx < 0) { x = -x; y = -y; }
        x = (pio4 - x) + (pio4lo - y);
        y = 0;
    }
    const z = x * x, w = z * z;
    let r = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))));
    const v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12))))), s = z * x;
    r = y + z * (s * (r + v) + y);
    r += T0 * s;
    const ww = x + r;
    if (ix >= 0x3fe59428) return (1 - ((hx >> 30) & 2)) * (iy - 2 * (x - (ww * ww / (ww + iy) - r)));
    if (iy === 1) return ww;
    const z2 = withLo0(ww), v2 = r - (z2 - x), a = -1 / ww, t = withLo0(a), s2 = 1 + t * z2;
    return t + a * (s2 + t * v2);
}

const invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
    pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21,
    pio2_3t = 8.47842766036889956997e-32;
const npio2_hw = [0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A,
    0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A,
    0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB,
    0x40478FDB, 0x404858EB, 0x404921FB];
const yy = [0, 0];
/** x − n·π/2 into yy[0] + yy[1], |yy[0]| ≤ π/4; returns n (mod 8 past 2^19·π/2). x is finite. */
function remPio2(x) {
    const hx = HI(x), ix = hx & 0x7fffffff;
    if (ix <= 0x3fe921fb) { yy[0] = x; yy[1] = 0; return 0; }
    if (ix < 0x4002d97c) {
        let z;
        if (hx > 0) {
            z = x - pio2_1;
            if (ix !== 0x3ff921fb) { yy[0] = z - pio2_1t; yy[1] = (z - yy[0]) - pio2_1t; } else { z -= pio2_2; yy[0] = z - pio2_2t; yy[1] = (z - yy[0]) - pio2_2t; }
            return 1;
        }
        z = x + pio2_1;
        if (ix !== 0x3ff921fb) { yy[0] = z + pio2_1t; yy[1] = (z - yy[0]) + pio2_1t; } else { z += pio2_2; yy[0] = z + pio2_2t; yy[1] = (z - yy[0]) + pio2_2t; }
        return -1;
    }
    if (ix > 0x413921fb) return remPio2Big(x, hx, ix);
    let t = Math.abs(x);
    const n = (t * invpio2 + 0.5) | 0, fn = n;
    let r = t - fn * pio2_1, w = fn * pio2_1t;
    if (n < 32 && ix !== npio2_hw[n - 1]) yy[0] = r - w;
    else {
        const j = ix >> 20;
        yy[0] = r - w;
        let i = j - ((HI(yy[0]) >> 20) & 0x7ff);
        if (i > 16) {
            t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); yy[0] = r - w;
            i = j - ((HI(yy[0]) >> 20) & 0x7ff);
            if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); yy[0] = r - w; }
        }
    }
    yy[1] = (r - yy[0]) - w;
    if (hx < 0) { yy[0] = -yy[0]; yy[1] = -yy[1]; return -n; }
    return n;
}

// The huge-argument reduction (fdlibm's __kernel_rem_pio2 does it with a table of 2/π): exact BigInt arithmetic on
// π and 2/π to PREC bits, made from Machin's formula on first use. No chain angle comes near; it keeps them exact.
const PREC = 1400;
let piFix = null, twoOverPiFix = null;
const big = (v) => BigInt(v);
function machin() {
    const one = big(1) << big(PREC + 32);
    const atanInv = (k) => {   // atan(1/k) · 2^(PREC+32)
        const kk = big(k * k);
        let term = one / big(k), sum = term;
        for (let n = 1; ; n++) {
            term /= kk;
            const t = term / big(2 * n + 1);
            if (t === big(0)) return sum;
            sum = n & 1 ? sum - t : sum + t;
        }
    };
    piFix = (big(16) * atanInv(5) - big(4) * atanInv(239)) >> big(32);
    twoOverPiFix = (big(1) << big(2 * PREC + 1)) / piFix;
}
/** 2^e for −1022 ≤ e ≤ 1023, exactly. */
const pow2 = (e) => words((e + 1023) << 20, 0);
function remPio2Big(x, hx, ix) {
    if (piFix === null) machin();
    const m = (big((ix & 0xfffff) | 0x100000) << big(32)) | big(LO(x));   // |x| = m · 2^e
    const sh = PREC - ((ix >> 20) - 1075);                                 // |x| · 2/π = m · twoOverPiFix / 2^sh
    const prod = m * twoOverPiFix, unit = big(1) << big(sh);
    let n = prod >> big(sh), f = prod - (n << big(sh));
    if (f >= unit >> big(1)) { n += big(1); f -= unit; }
    let r = f * piFix;                                                      // (|x| − n·π/2) · 2^(sh + PREC + 1)
    const neg = (r < big(0)) !== (hx < 0);
    if (r < big(0)) r = -r;
    const k = Math.max(0, r.toString(2).length - 120), top = r >> big(k);
    const hi = Number(top), lo = Number(top - big(hi)), scale = pow2(k - sh - PREC - 1);
    yy[0] = neg ? -hi * scale : hi * scale;
    yy[1] = neg ? -lo * scale : lo * scale;
    const n8 = Number(n & big(7));
    return hx < 0 ? -n8 : n8;
}

export function sin(x) {
    const ix = HI(x) & 0x7fffffff;
    if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
    if (ix >= 0x7ff00000) return x - x;
    const n = remPio2(x);
    switch (n & 3) {
        case 0: return kSin(yy[0], yy[1], 1);
        case 1: return kCos(yy[0], yy[1]);
        case 2: return -kSin(yy[0], yy[1], 1);
        default: return -kCos(yy[0], yy[1]);
    }
}
export function cos(x) {
    const ix = HI(x) & 0x7fffffff;
    if (ix <= 0x3fe921fb) return kCos(x, 0);
    if (ix >= 0x7ff00000) return x - x;
    const n = remPio2(x);
    switch (n & 3) {
        case 0: return kCos(yy[0], yy[1]);
        case 1: return -kSin(yy[0], yy[1], 1);
        case 2: return -kCos(yy[0], yy[1]);
        default: return kSin(yy[0], yy[1], 1);
    }
}
export function tan(x) {
    const ix = HI(x) & 0x7fffffff;
    if (ix <= 0x3fe921fb) return kTan(x, 0, 1);
    if (ix >= 0x7ff00000) return x - x;
    const n = remPio2(x);
    return kTan(yy[0], yy[1], 1 - ((n & 1) << 1));
}

const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
    9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
    4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
export function atan(x) {
    const hx = HI(x), ix = hx & 0x7fffffff;
    let id;
    if (ix >= 0x44100000) {
        if (ix > 0x7ff00000 || (ix === 0x7ff00000 && LO(x) !== 0)) return x + x;
        return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
    }
    if (ix < 0x3fdc0000) {
        if (ix < 0x3e400000) return x;
        id = -1;
    } else {
        x = Math.abs(x);
        if (ix < 0x3ff30000) {
            if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
        } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
    }
    const z = x * x, w = z * z;
    const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
    const s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
    if (id < 0) return x - x * (s1 + s2);
    const r = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
    return hx < 0 ? -r : r;
}
const pi = 3.1415926535897931160E+00, pi_o_2 = 1.5707963267948965580E+00, pi_o_4 = 7.8539816339744827900E-01,
    pi_lo = 1.2246467991473531772E-16;
const atan2InfInf = [pi_o_4, -pi_o_4, 3 * pi_o_4, -3 * pi_o_4], atan2XInf = [0, -0, pi, -pi];
export function atan2(y, x) {
    if (Number.isNaN(x) || Number.isNaN(y)) return x + y;
    const hx = HI(x), lx = LO(x), ix = hx & 0x7fffffff, hy = HI(y), ly = LO(y), iy = hy & 0x7fffffff;
    if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
    let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
    if ((iy | ly) === 0) { if (m < 2) return y; return m === 2 ? pi : -pi; }
    if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 : pi_o_2;
    if (ix === 0x7ff00000) return iy === 0x7ff00000 ? atan2InfInf[m] : atan2XInf[m];
    if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 : pi_o_2;
    const k = (iy - ix) >> 20;
    let z;
    if (k > 60) { z = pi_o_2 + 0.5 * pi_lo; m &= 1; } else if (hx < 0 && k < -60) z = 0; else z = atan(Math.abs(y / x));
    switch (m) {
        case 0: return z;
        case 1: return -z;
        case 2: return pi - (z - pi_lo);
        default: return (z - pi_lo) - pi;
    }
}

const pio2_hi = 1.57079632679489655800e+00, pio2_lo = 6.12323399573676603587e-17, pio4_hi = 7.85398163397448278999e-01,
    pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01,
    pS3 = -4.00555345006794114027e-02, pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05,
    qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00, qS3 = -6.88283971605453293030e-01,
    qS4 = 7.70381505559019352791e-02;
const pOf = (z) => z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
const qOf = (z) => 1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
export function acos(x) {
    const hx = HI(x), ix = hx & 0x7fffffff;
    if (ix >= 0x3ff00000) {
        if (((ix - 0x3ff00000) | LO(x)) === 0) return hx > 0 ? 0 : pi + 2 * pio2_lo;
        return NaN;
    }
    if (ix < 0x3fe00000) {
        if (ix <= 0x3c600000) return pio2_hi + pio2_lo;
        const z = x * x;
        return pio2_hi - (x - (pio2_lo - x * (pOf(z) / qOf(z))));
    }
    if (hx < 0) {
        const z = (1 + x) * 0.5, s = Math.sqrt(z), w = (pOf(z) / qOf(z)) * s - pio2_lo;
        return pi - 2 * (s + w);
    }
    const z = (1 - x) * 0.5, s = Math.sqrt(z), df = withLo0(s), c = (z - df * df) / (s + df);
    return 2 * (df + ((pOf(z) / qOf(z)) * s + c));
}
export function asin(x) {
    const hx = HI(x), ix = hx & 0x7fffffff;
    if (ix >= 0x3ff00000) {
        if (((ix - 0x3ff00000) | LO(x)) === 0) return x * pio2_hi + x * pio2_lo;
        return NaN;
    }
    if (ix < 0x3fe00000) {
        if (ix < 0x3e400000) return x;
        const t = x * x;
        return x + x * (pOf(t) / qOf(t));
    }
    const t = (1 - Math.abs(x)) * 0.5, p = pOf(t), q = qOf(t), s = Math.sqrt(t);
    let r;
    if (ix >= 0x3fef3333) r = pio2_hi - (2 * (s + s * (p / q)) - pio2_lo);
    else {
        const w = withLo0(s), c = (t - w * w) / (s + w);
        r = pio4_hi - ((2 * s * (p / q) - (pio2_lo - 2 * c)) - (pio4_hi - 2 * w));
    }
    return hx > 0 ? r : -r;
}

/** V8's Math.hypot for two arguments: each over the larger, the sum of squares, sqrt, times the larger. */
export function hypot(a, b) {
    const x = Math.abs(a), y = Math.abs(b);
    if (x === Infinity || y === Infinity) return Infinity;
    if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
    const max = x > y ? x : y;
    if (max === 0) return 0;
    const n0 = x / max, n1 = y / max;
    return Math.sqrt(n0 * n0 + n1 * n1) * max;
}
