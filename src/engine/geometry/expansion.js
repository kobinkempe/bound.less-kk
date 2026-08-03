/*
 * Small floating-point expansion toolkit.
 *
 * Local frames keep ordinary drawing coordinates bounded, but an object that
 * is MOVED in a frame far from its geometry's home can require cancellation of
 * 50+ decimal orders before it lands back near the camera. A single Number
 * loses the local residue during that cancellation. Expansions retain the
 * round-off terms until the final, camera-local result is estimated.
 *
 * Components are stored least-significant first, following Shewchuk's robust
 * predicate representation. We only need addition and multiplication by a
 * scalar (frame edges are affine); division uses the exact floating reciprocal
 * selected by JS, then scales the expansion without throwing away product
 * error. This preserves the application's existing per-edge Number semantics
 * while preventing catastrophic cancellation across the complete path.
 */

const SPLITTER = 134217729; // 2^27 + 1

function twoSum(a, b) {
    const x = a + b;
    const bv = x - a;
    const av = x - bv;
    const br = b - bv;
    const ar = a - av;
    return [ar + br, x];
}

function twoProduct(a, b) {
    const x = a * b;
    const ca = SPLITTER * a;
    const ahi = ca - (ca - a);
    const alo = a - ahi;
    const cb = SPLITTER * b;
    const bhi = cb - (cb - b);
    const blo = b - bhi;
    const err = alo * blo - (((x - ahi * bhi) - alo * bhi) - ahi * blo);
    return [err, x];
}

export function expansionOf(n) {
    return n ? [n] : [0];
}

export function growExpansion(e, b) {
    let q = b;
    const out = [];
    for (const enow of e) {
        const [hh, next] = twoSum(q, enow);
        if (hh) out.push(hh);
        q = next;
    }
    if (q || !out.length) out.push(q);
    return out;
}

export function sumExpansions(a, b) {
    let out = a;
    for (const n of b) out = growExpansion(out, n);
    return compressExpansion(out);
}

export function scaleExpansion(e, b) {
    if (!b) return [0];
    let out = [0];
    for (const enow of e) {
        const [lo, hi] = twoProduct(enow, b);
        if (lo) out = growExpansion(out, lo);
        if (hi) out = growExpansion(out, hi);
    }
    return compressExpansion(out);
}

// Expansion division by a scalar. Multiplying by a rounded reciprocal loses a
// systematic ~1 ulp factor error; after a 15-level down/up trip that error is
// magnified by 3000^15. Residual refinement stores the quotient's low terms so
// multiplying it back by the divisor reconstructs the original expansion.
export function divideExpansion(e, b) {
    if (!b || !Number.isFinite(b)) return [NaN];
    let quotient = [0];
    let remainder = compressExpansion(e);
    for (let i = 0; i < 12; i++) {
        const correction = estimateExpansion(remainder) / b;
        if (!correction || !Number.isFinite(correction)) break;
        quotient = growExpansion(quotient, correction);
        remainder = sumExpansions(
            remainder,
            scaleExpansion(expansionOf(correction), -b),
        );
        if (remainder.length === 1 && remainder[0] === 0) break;
    }
    return compressExpansion(quotient);
}

export function compressExpansion(e) {
    if (!e.length) return [0];
    // Re-grow in increasing-magnitude order. The generated expansions already
    // have this order; sorting also makes the helper resilient to callers that
    // combine independently generated terms.
    const src = e.filter(Number.isFinite).sort((a, b) => Math.abs(a) - Math.abs(b));
    if (!src.length) return [0];
    let out = [0];
    for (const n of src) out = growExpansion(out, n);
    // Keep the low components: they are exactly the local residue that survives
    // when a moved deep branch cancels against a coarse placement. The former
    // "largest 64" cap discarded that residue after roughly a dozen up/down
    // edges. Ordinary 20-level paths stay far below this wider safety bound.
    if (out.length > 512) {
        const low = out.slice(0, 256);
        const high = out.slice(out.length - 256);
        out = low.concat(high);
    }
    return out;
}

export function estimateExpansion(e) {
    let out = 0;
    for (const n of e) out += n;
    return out;
}

export function affineExpansion(e, scale, translate = 0) {
    let out = scaleExpansion(e, scale);
    if (translate) out = growExpansion(out, translate);
    return out;
}
