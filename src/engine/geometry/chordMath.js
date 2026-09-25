/**
 * chordMath.js — the arc identities the rasteriser works from, as scalars.
 *
 * An arc here is its two ends and its signed sweep, never a centre and a radius
 * (RASTERISER-PLAN §4.4, build decision 2): a centre 1e16 units away quantises every
 * point computed through it, which is F40. These are the same expressions
 * `arcShape.chordArcMid` and `freeze.pieceSagitta` already carried, lifted out so that
 * `raster/rasterCore.js` — which may import this leaf and nothing else — and the two
 * piece-object callers share one implementation. `chordMath.test.js` M1/M2 assert the
 * two forms are bit-identical.
 *
 * Scalars and a caller-owned `out`, because the flattener calls the midpoint once per
 * chord inside the worker's inner loop and must allocate nothing there.
 *
 * Layering: this file imports nothing.
 */

/**
 * The bulge coefficient of a sweep, `tan(sweep/4)/2`. Two uses, and both are why it is
 * separate: the sagitta of a chord is `|chord| × this`, and each bisection halves the
 * sweep exactly, so all the pairs at one depth share one `tan` (§4.4).
 *
 * `tan(sweep/2)/2` is the same shape and twice the bulge — the error M1 exists to catch.
 *
 * @param {number} sweep signed, radians
 * @returns {number}
 */
export function bulgeK(sweep) {
    return Math.tan(sweep / 4) / 2;
}

/**
 * The arc's midpoint from its two ends and the bulge coefficient of the sweep being
 * split: the chord's midpoint, offset along the chord's normal by the sagitta. The
 * rotated chord vector already has the chord's length, so `k` carries the whole of it.
 *
 * Sign convention (`freeze.chordFrame`, `arcShape.chordArcMid`): a positive sweep is
 * anticlockwise, the centre is on the left, and the arc bulges to the RIGHT of the
 * chord — n̂ = (u_y, −u_x). Reversed, every arc bulges the wrong way.
 *
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @param {number} k the bulge coefficient of this node's own sweep, from `bulgeK`
 * @param {number[]|Float64Array} out written at [0] and [1], and returned
 * @returns {number[]|Float64Array}
 */
export function chordMidK(ax, ay, bx, by, k, out) {
    out[0] = (ax + bx) / 2 + (by - ay) * k;
    out[1] = (ay + by) / 2 - (bx - ax) * k;
    return out;
}

/**
 * The arc's midpoint from its two ends and its sweep — `chordMidK` at `bulgeK(sweep)`.
 *
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @param {number} sweep @param {number[]|Float64Array} out
 * @returns {number[]|Float64Array}
 */
export function chordMidXY(ax, ay, bx, by, sweep, out) {
    return chordMidK(ax, ay, bx, by, bulgeK(sweep), out);
}

/**
 * How far an arc bulges from its own chord, in the arc's own units: `(|chord|/2)·|tan(sweep/4)|`.
 * A sweep over half a turn is reported as infinitely bulged rather than run through a
 * tangent about to change sign — the flattener's `FORCED` splits before it asks (§4.4).
 *
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @param {number} sweep
 * @returns {number}
 */
export function sagittaOf(ax, ay, bx, by, sweep) {
    const a = Math.abs(sweep);
    if (!(a > 0)) return 0;
    if (a > Math.PI) return Infinity;
    const dx = bx - ax, dy = by - ay;
    return (Math.hypot(dx, dy) / 2) * Math.abs(Math.tan(a / 4));
}

/**
 * `(θ − sin θ) / (1 − cos θ)`, the circular-segment factor written from the chord rather
 * than the radius, WITHOUT either cancellation — there are two, at the two ends of the range.
 * Below 1e-2 rad both halves of the ratio cancel to noise, so the series runs instead (the
 * next term is 1e-16 of the first there). And `1 − cos θ` loses its digits as θ approaches a
 * WHOLE TURN — at 2π − 1e-8 it is 5e-17, which rounds to exactly 0, and the ratio came back
 * Infinity — so the denominator is written as the identity `2 sin²(θ/2)`, which is accurate at
 * every sweep because it never subtracts. Measured against the radius form at r = 40: 5.4e-16
 * relative at worst for 2π − |θ| from 0.1 down to 1e-15, where the literal form is 0.08 % out
 * at 1e-7 and Infinity below 1.5e-8 (M3).
 *
 * `arcShape.segmentTerm` is the same quantity in the radius form, which needs the radius this
 * file does not have.
 *
 * @param {number} theta
 * @returns {number}
 */
function segRatio(theta) {
    if (Math.abs(theta) <= 1e-2) {
        const t2 = theta * theta;
        return (theta / 3) * (1 + t2 / 30 + (t2 * t2) / 840);
    }
    const s = Math.sin(theta / 2);
    return (theta - Math.sin(theta)) / (2 * s * s);
}

/**
 * What one arc adds to the shoelace sum `Σ(ax·by − bx·ay)` over and above its chord's
 * own term: `r²(θ − sin θ)`, with `r²` replaced by `|chord|²/(4 sin²(θ/2))`, which is
 * `(|chord|²/2) · segRatio(θ)`. Exact, and radius-free.
 *
 * A whole turn returns 0: its two ends coincide, so its chord carries no radius and the area
 * is not a function of `(A, B, sweep)` at all (§4.4, the antipode split). A caller summing a
 * ring's area must take that one case from the record's centre — `2π r²`, signed by the sweep
 * — or the ring comes out with no area and no winding sign (`rasterCore.itemShoelace`, D60).
 * JUST SHORT of a whole turn there is no such gap: the chord is tiny and `segRatio` large, and
 * the product is the true `r²(θ − sin θ)` to 5.4e-16 relative down to 2π − |θ| = 1e-15.
 *
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @param {number} sweep
 * @returns {number}
 */
export function arcAreaTerm(ax, ay, bx, by, sweep) {
    if (!(Math.abs(sweep) > 0)) return 0;
    const dx = bx - ax, dy = by - ay;
    const c2 = dx * dx + dy * dy;
    if (!(c2 > 0)) return 0;
    return (c2 / 2) * segRatio(sweep);
}
