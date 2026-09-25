/**
 * coverageOracle.js — the independent reference the rasteriser is checked against
 * (RASTERISER-PLAN §9.1). Exact-winding coverage by K sub-scanlines per pixel row: exact
 * in x, quantised to 1/K in y. It walks integer winding numbers, so it is exact for ANY
 * winding and any amount of overlap, which signed-area accumulation is not.
 *
 * It shares an idea with `raster/rasterCore.js`'s union pass and not a line of code: the
 * core deposits a run's two ends and lets the running sum carry the interior, this walks
 * every pixel of every run. Production never imports this folder.
 *
 * Tolerances it supports, each derived rather than asserted:
 *  - per pixel: 1/K of coverage, which is this file's own y quantisation;
 *  - total coverage: ≈ P/K² for a boundary of P pixels — a sub-scanline oracle does NOT
 *    integrate a shape's area exactly, so 1e-9 is not available and was never the bar.
 */

/** A ring is a closed list of [x, y]; the closing segment is implied. */

/**
 * Coverage per pixel of a set of rings under the nonzero winding rule.
 * @param {number[][][]} rings
 * @param {number} TW plate width in pixels
 * @param {number} TH plate height in pixels
 * @param {number} [K] sub-scanlines per pixel row
 * @returns {Float64Array} TW × TH coverage in [0, 1], row-major
 */
export function coverRings(rings, TW, TH, K = 16) {
    const cov = new Float64Array(TW * TH);
    const y0s = [], y1s = [], x0s = [], ms = [], dirs = [];
    let top = Infinity, bot = -Infinity;
    for (const ring of rings) {
        const m = ring.length;
        for (let i = 0; i < m; i++) {
            const a = ring[i], b = ring[(i + 1) % m];
            let ax = a[0], ay = a[1], bx = b[0], by = b[1], dir = 1;
            if (ay === by) continue;
            if (!(isFinite(ax) && isFinite(ay) && isFinite(bx) && isFinite(by))) continue;
            if (ay > by) { const tx = ax; ax = bx; bx = tx; const ty = ay; ay = by; by = ty; dir = -1; }
            y0s.push(ay); y1s.push(by); x0s.push(ax); ms.push((bx - ax) / (by - ay)); dirs.push(dir);
            if (ay < top) top = ay;
            if (by > bot) bot = by;
        }
    }
    const n = y0s.length;
    if (!n) return cov;
    const yStart = Math.max(0, Math.floor(top)), yEnd = Math.min(TH, Math.ceil(bot));
    const w = 1 / K;
    const xs = [];
    for (let y = yStart; y < yEnd; y++) {
        for (let k = 0; k < K; k++) {
            const ys = y + (k + 0.5) / K;
            xs.length = 0;
            for (let e = 0; e < n; e++) {
                if (y0s[e] > ys || y1s[e] <= ys) continue;
                xs.push([x0s[e] + (ys - y0s[e]) * ms[e], dirs[e]]);
            }
            if (xs.length < 2) continue;
            xs.sort((p, q) => p[0] - q[0]);
            let wind = 0, xa = 0;
            for (let c = 0; c < xs.length; c++) {
                const was = wind;
                wind += xs[c][1];
                if (was === 0 && wind !== 0) xa = xs[c][0];
                else if (was !== 0 && wind === 0) addRun(cov, y * TW, xa, xs[c][0], w, TW);
            }
        }
    }
    return cov;
}

/** A covered run of one sub-scanline, added pixel by pixel — the naive form, on purpose. */
function addRun(cov, base, xa, xb, w, TW) {
    if (xa < 0) xa = 0;
    if (xb > TW) xb = TW;
    if (!(xb > xa)) return;
    for (let px = Math.floor(xa); px < xb && px < TW; px++) {
        const lo = xa > px ? xa : px, hi = xb < px + 1 ? xb : px + 1;
        if (hi > lo) cov[base + px] += (hi - lo) * w;
    }
}

/**
 * The exact signed area of a set of rings, by the shoelace formula. Positive is clockwise
 * on a screen whose y runs down; a ring the engine's `strokeStripNear` emits is negative.
 * @param {number[][][]} rings
 * @returns {number}
 */
export function ringsArea(rings) {
    let sum = 0;
    for (const ring of rings) {
        const m = ring.length;
        for (let i = 0; i < m; i++) {
            const a = ring[i], b = ring[(i + 1) % m];
            sum += a[0] * b[1] - b[0] * a[1];
        }
    }
    return sum / 2;
}

const WIDTH = { 0: 3, 1: 8, 2: 9, 3: 16 };

/**
 * Rings from loops in the grammar of `geometry/loop.js`, flattened at `tol`, for feeding the
 * two above. Arcs are sampled from the record's own centre and angles — this is a reference
 * implementation and is allowed the centre the rasteriser is forbidden, but that also means
 * it is NOT the reference for a far-centre arc (the arc suite compares those against the
 * exact contour instead).
 *
 * @param {Array<Float64Array|number[]>} loops
 * @param {number} tol
 * @returns {number[][][]}
 */
export function ringsFromLoops(loops, tol) {
    const rings = [];
    for (const loop of loops) {
        const a = loop;
        if (!a || a.length < 5) continue;
        const ring = [[a[0], a[1]]];
        let px = a[0], py = a[1];
        for (let o = 2; o < a.length; o += WIDTH[a[o]] || 8) {
            const code = a[o];
            if (code === 0) { px = a[o + 1]; py = a[o + 2]; ring.push([px, py]); continue; }
            if (code === 2) { px = a[o + 7]; py = a[o + 8]; ring.push([px, py]); continue; }
            const cx = a[o + 1], cy = a[o + 2], r = a[o + 3], a0 = a[o + 4], sweep = a[o + 5];
            const bx = code === 3 ? a[o + 14] : a[o + 6], by = code === 3 ? a[o + 15] : a[o + 7];
            let steps = 1;
            if (isFinite(r) && r > tol) {
                const u = 1 - tol / r;
                steps = u <= -1 ? 1 : Math.max(1, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.min(1, u)))));
            }
            for (let s = 1; s < steps; s++) {
                const t = a0 + (sweep * s) / steps;
                ring.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
            }
            px = bx; py = by;
            ring.push([px, py]);
        }
        if (ring.length > 2) {
            const f = ring[0], l = ring[ring.length - 1];
            if (f[0] === l[0] && f[1] === l[1]) ring.pop();
            rings.push(ring);
        }
    }
    return rings;
}
