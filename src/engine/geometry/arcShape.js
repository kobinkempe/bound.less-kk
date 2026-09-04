/**
 * arcShape.js — a resolved perimeter of circular arcs, and the exact boolean
 * that erasing it needs.
 *
 * `arcPerimeter.js` turns a stroke into loops of arcs. This module is what the
 * rest of the app does with them: measure, transform, flatten, and — the whole
 * point — subtract one shape from another without a polygon library.
 *
 * WHY THIS EXISTS. Erasing has always gone through Clipper, which rounds every
 * coordinate onto an integer lattice whose step is set by the largest magnitude
 * in play. In an app that zooms x3000 per level that is the defect, not a
 * detail: a hole three crossings below its object is finer than one lattice
 * step and rounds away entirely. Kobin's call (2026-08-13) was a curve-native
 * boolean producing a RESOLVED perimeter — resolved, because severance and
 * hit-testing read connectivity off regions, and unresolved overlapping loops
 * would have to rebuild that answer from scratch.
 *
 * WHY ARCS MAKE IT EXACT. Two arcs cross where two circles cross: one square
 * root, closed form, no subdivision bracket and no Newton polish. Splitting an
 * arc at a crossing is arithmetic on an angle, so both halves share the crossing
 * POINT rather than two roundings of it. There is no lattice anywhere, so the
 * result is as precise as the doubles it is written in, at any depth.
 *
 * WHAT IS APPROXIMATE. One thing: deciding whether a fragment is inside the
 * other shape, which is a ray cast and can be ambiguous when the ray grazes a
 * tangency or a vertex. That is detected, not ignored — the query retries on a
 * fresh direction — and it degrades LOCALLY, costing one fragment rather than
 * everything downstream of it (the lesson F20 was built out of).
 *
 * CONVENTIONS. A loop is a closed chain of pieces; a piece is
 * `{ line:true, A, B }` or `{ line:false, C, r, a0, sweep, A, B }` with `A`/`B`
 * carried explicitly so consecutive pieces share endpoints bit for bit.
 * Orientation is normalized before any boolean: whichever way a producer wound
 * its loops, the set is flipped as a whole so solid area comes out positive.
 * Relative orientation between an outer loop and its holes is preserved, which
 * is what a global flip cannot disturb.
 */
import { ptAt, paramOf, pieceBBox, subPiece, pieceIntersections, Grid } from "./arcPerimeter";

const TAU = Math.PI * 2;
const wrap = (d) => d - TAU * Math.floor(d / TAU);

// ---------------------------------------------------------------------------
// piece primitives
// ---------------------------------------------------------------------------

export { ptAt, pieceBBox };

/** Unit tangent at parameter `s`, pointing the way the piece is travelled. */
export function pieceTangent(p, s) {
    if (p.line) {
        const dx = p.B[0] - p.A[0], dy = p.B[1] - p.A[1], L = Math.hypot(dx, dy);
        return L > 0 ? [dx / L, dy / L] : [1, 0];
    }
    const th = p.a0 + p.sweep * s, g = p.sweep > 0 ? 1 : -1;
    return [-Math.sin(th) * g, Math.cos(th) * g];
}

/** The same piece travelled the other way. Never mutates the original. */
export function reversePiece(p) {
    if (p.line) return { line: true, A: p.B, B: p.A, src: p.src };
    const q = { line: false, C: p.C, r: p.r, a0: p.a0 + p.sweep, sweep: -p.sweep, A: p.B, B: p.A, src: p.src };
    // The marks name ENDS, so they travel with the ends they name.
    if (p.seamB) q.seamA = true;
    if (p.seamA) q.seamB = true;
    return q;
}

export function reverseLoop(loop) {
    const out = new Array(loop.length);
    for (let i = 0; i < loop.length; i++) out[i] = reversePiece(loop[loop.length - 1 - i]);
    return out;
}

export function loopBBox(loop) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of loop) {
        const b = pieceBBox(p);
        if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1];
        if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3];
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
export function loopsBBox(loops) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const loop of loops) {
        const b = loopBBox(loop);
        if (!b) continue;
        if (b.x0 < x0) x0 = b.x0; if (b.y0 < y0) y0 = b.y0;
        if (b.x1 > x1) x1 = b.x1; if (b.y1 > y1) y1 = b.y1;
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/**
 * Signed area, EXACTLY. The chord polygon by the shoelace rule, plus each arc's
 * circular segment — `r²(θ − sin θ)/2`, signed by the sweep so an arc bulging
 * left of travel adds. A unit circle drawn as two half-turns comes out π, which
 * is the check worth remembering: the chord polygon there is degenerate and
 * every bit of the answer is in the segment terms.
 */
export function loopArea(loop) {
    if (!loop.length) return 0;
    // Shoelace LOCAL to the loop's own start. The sum is origin-independent in
    // exact arithmetic and nowhere near it in floating point: a 250-unit area
    // measured from coordinates of 1e7 cancels to about 0.02 of error, which is
    // the whole answer for anything small. It also makes the number meaningful
    // for a chain that did not close — the shoelace closes it with a chord,
    // which is exactly what a hairline test wants to measure.
    const ox = loop[0].A[0], oy = loop[0].A[1];
    let a = 0;
    for (const p of loop) {
        a += (p.A[0] - ox) * (p.B[1] - oy) - (p.B[0] - ox) * (p.A[1] - oy);
    }
    a /= 2;
    for (const p of loop) {
        if (p.line || !isFinite(p.r)) continue;
        a += (p.r * p.r * (p.sweep - Math.sin(p.sweep))) / 2;
    }
    return a;
}

/** Length of a loop's boundary, arcs measured along the arc. */
export function loopPerimeter(loop) {
    let n = 0;
    for (const p of loop) {
        n += (p.line || !isFinite(p.r))
            ? Math.hypot(p.B[0] - p.A[0], p.B[1] - p.A[1])
            : Math.abs(p.r * p.sweep);
    }
    return n;
}

/**
 * Drop loops that are hairlines: strips so thin that their two sides are the
 * same curve traversed both ways.
 *
 * MEAN WIDTH — `2·area / perimeter` — is the measure, because it is about
 * degeneracy rather than size: a genuinely small piece of ink left by an erase
 * has the pen's width and survives, while a strip that goes out and comes back
 * has essentially none however long it is.
 *
 * They paint NOTHING — a doubled-back strip's winding cancels — so removing them
 * changes no pixel. What they do is get stored, tiled, erased against, and
 * counted as separate connected components, which is how a ring that was cut
 * once came apart into two objects. Where they come from: a stroke whose two
 * ends coincide (a closed ring) has its two half-turn caps at the same point but
 * built on the two ends' own tangents, which the spline gives one-sided and
 * therefore slightly different — leaving a lens a few thousandths of a unit wide
 * between them. That lens is real, sub-resolution, and not worth keeping.
 */
export function dropHairlines(loops, eps) {
    if (!(eps > 0)) return loops;
    return loops.filter((l) => {
        const per = loopPerimeter(l);
        if (!(per > 0)) return false;
        return (2 * Math.abs(loopArea(l))) / per > eps;
    });
}
export function loopsArea(loops) {
    let a = 0;
    for (const loop of loops) a += loopArea(loop);
    return a;
}
/**
 * Mean width of a whole component: 2·area / perimeter, holes and all.
 *
 * The one measure that says how THICK a piece is without caring how long it is,
 * which is what separates a fragment worth keeping from the dust a cut leaves
 * where it runs tangent to an edge. Measured against the PEN that drew the
 * shape it is also scale-free, so it means the same thing at every level.
 */
export function meanWidth(loops) {
    let per = 0;
    for (const l of loops) per += loopPerimeter(l);
    if (!(per > 0)) return 0;
    return (2 * Math.abs(loopsArea(loops))) / per;
}

/**
 * Drop the DUST a cut leaves behind: components far thinner than the pen that
 * drew the shape.
 *
 * Where a cut runs nearly tangent to an edge it leaves a sliver — real
 * geometry, correctly computed, and thinner than anything the pen could have
 * made. Kept, each becomes a native of its own: indexed, tiled, erased against,
 * selectable, and painted as a speck that becomes a visible dot as soon as you
 * zoom to it. The test is MEAN WIDTH against the pen, which is scale-free and
 * so means the same thing at every level; under a hundredth of the pen's width
 * the piece cannot be ink the user put there, because the pen cannot draw a
 * mark that thin. A shape with no pen recorded (a legacy fill) is left alone,
 * and so is a set that is dust ALL THE WAY THROUGH — deciding that an object
 * has ceased to exist belongs to the caller, not to a filter.
 */
export const DUST_FRACTION = 0.01;
export function dropDust(groups, pen) {
    if (!(pen > 0) || !groups.length) return groups;
    const keep = groups.filter((g) => meanWidth(g) >= pen * DUST_FRACTION);
    return keep.length ? keep : groups;
}

/**
 * Flip the whole set if it winds the wrong way. A producer may hand back either
 * handedness — it depends on which rail it walked first — but the RELATIVE
 * orientation of an outer loop and its holes is a property of the shape, so
 * flipping everything together is the only correction that is ever needed.
 */
export function normalizeLoops(loops) {
    if (!loops || !loops.length) return loops || [];
    return loopsArea(loops) < 0 ? loops.map(reverseLoop) : loops;
}

// ---------------------------------------------------------------------------
// inside / outside
// ---------------------------------------------------------------------------

// A ray cast is ambiguous when it grazes: through a vertex, along a tangent, or
// out of a point sitting on the boundary. Those cases are DETECTED and the query
// retried on a fresh direction rather than being resolved by a rule that would
// silently be wrong half the time.
//
// The band that counts as "grazing" is a ROUNDING distance, and rounding is
// relative to the coordinates in play — so it is measured per piece, off that
// piece's own magnitude, and never off the scene.
//
// Taking it from the scene was a real defect, not a tidiness point. An eraser
// projected three crossings down is 2.7e10 times its own size, so the pair's
// span runs to 1e13 while the object being cut is 1e4 across. A band of
// span·1e-9 is then 10,000 units — wider than the target — every query grazed,
// every fragment read as outside, and an erase that should have removed the
// object left it untouched.
//
// And it is a FEW ULPS, not a comfortable margin. A coincidence that matters
// here — the probe standing on the boundary, the ray through a vertex — is
// EXACT: the coordinates are literally equal, so the quantity that should be
// zero comes out zero, and a band of a few rounding steps is all that is needed
// to catch the cases where it does not. Anything wider is a liability at depth:
// four crossings up, a detail's own coordinates run to 8e15 where one ulp is
// about a unit, and a band of 4,500 ulps is 80x the whole object.
const GRAZE = 1e-15;

/** Winding contribution of every piece in `flat`, or null if the ray grazed. */
function rayCross(flat, p, dx, dy) {
    let w = 0;
    const pm = Math.abs(p[0]) + Math.abs(p[1]);
    for (const q of flat) {
        if (q.line) {
            const ex = q.B[0] - q.A[0], ey = q.B[1] - q.A[1];
            const elen = Math.hypot(ex, ey);
            if (!(elen > 0)) continue;
            const eps = (pm + Math.abs(q.A[0]) + Math.abs(q.A[1]) + elen) * GRAZE;
            const den = dx * ey - dy * ex;
            const rx = q.A[0] - p[0], ry = q.A[1] - p[1];
            if (Math.abs(den) <= GRAZE * elen) {
                // Parallel. Harmless unless the ray runs ALONG the edge, in
                // which case there is no honest answer and a retry is owed.
                if (Math.abs(rx * dy - ry * dx) <= eps) return null;
                continue;
            }
            const t = (rx * ey - ry * ex) / den;
            const u = (rx * dy - ry * dx) / den;
            if (u * elen < -eps || (u - 1) * elen > eps) continue;
            if (t < -eps) continue;
            if (Math.abs(t) <= eps) return null;                       // standing on the edge
            if (u * elen <= eps || (1 - u) * elen <= eps) return null;  // through a vertex
            w += den > 0 ? 1 : -1;
        } else {
            const fx = p[0] - q.C[0], fy = p[1] - q.C[1];
            const fd = fx * dx + fy * dy;
            const disc = fd * fd - (fx * fx + fy * fy - q.r * q.r);
            if (disc < 0) continue;
            const sq = Math.sqrt(disc);
            const arcLen = Math.abs(q.r * q.sweep);
            const eps = (pm + Math.abs(q.C[0]) + Math.abs(q.C[1]) + q.r) * GRAZE;
            for (const t of [-fd - sq, -fd + sq]) {
                if (t < -eps) continue;
                const qx = p[0] + t * dx, qy = p[1] + t * dy;
                const th = Math.atan2(qy - q.C[1], qx - q.C[0]);
                const d = wrap(th - q.a0);
                const along = q.sweep > 0 ? d : d - TAU;
                const s = q.sweep === 0 ? 0 : along / q.sweep;
                if (s < 0 || s > 1) {
                    // Off the end — but only decisively so if it is off by more
                    // than the graze band measured along the arc.
                    if ((s < 0 ? -s : s - 1) * arcLen <= eps) return null;
                    continue;
                }
                if (Math.abs(t) <= eps) return null;                 // standing on the circle
                if (sq <= eps) return null;                          // ray tangent to it
                if (s * arcLen <= eps || (1 - s) * arcLen <= eps) return null;
                const g = q.sweep > 0 ? 1 : -1;
                const tx = -Math.sin(th) * g, ty = Math.cos(th) * g;
                const cross = -tx * dy + ty * dx;                    // T · perp(d)
                if (Math.abs(cross) <= 1e-12) return null;
                w += cross > 0 ? 1 : -1;
            }
        }
    }
    return w;
}

// Directions tried in order: irrational multiples of a turn, so a shape built on
// a grid lines up with none of them.
const DIRS = [];
for (let i = 0; i < 8; i++) {
    const a = i * 2.39996322972865332;      // golden angle
    DIRS.push([Math.cos(a), Math.sin(a)]);
}

export function flatPieces(loops) {
    const flat = [];
    for (const loop of loops) for (const q of loop) flat.push(q);
    return flat;
}

/** Winding number about `p`, or null if every direction grazed. */
export function windingOfFlat(flat, p) {
    for (const [dx, dy] of DIRS) {
        const w = rayCross(flat, p, dx, dy);
        if (w !== null) return w;
    }
    return null;
}
export function windingAt(loops, p) {
    return windingOfFlat(flatPieces(loops), p);
}
/**
 * Null means "genuinely on the boundary" far more often than it means bad luck,
 * and it reads as OUTSIDE — the conservative direction for an erase, which then
 * removes slightly less rather than slightly more.
 */
export function insideShape(loops, p) {
    const w = windingAt(loops, p);
    return w != null && w !== 0;
}
export function spanOf(loops) {
    const b = loopsBBox(loops);
    return b ? Math.max(b.x1 - b.x0, b.y1 - b.y0, 1e-12) : 1;
}

// ---------------------------------------------------------------------------
// transforms — a similarity maps an arc to an arc, exactly
// ---------------------------------------------------------------------------

/**
 * `x -> x*f + t`. Every frame hop in this engine is of that form (uniform
 * scale, no rotation, no reflection, f > 0), so a circle stays a circle, the
 * radius scales and the ANGLES DO NOT CHANGE. That is why a resolved perimeter
 * can be carried across a crossing without ever being re-resolved.
 */
export function transformLoops(loops, f, tx, ty) {
    const pt = (q) => [q[0] * f + tx, q[1] * f + ty];
    return loops.map((loop) => loop.map((p) => (p.line
        ? { line: true, A: pt(p.A), B: pt(p.B), src: p.src }
        : seam(p, { line: false, C: pt(p.C), r: p.r * f, a0: p.a0, sweep: p.sweep, A: pt(p.A), B: pt(p.B), src: p.src }))));
}

/**
 * Carry the SEAM-OVERHANG marks (freeze.js) across a transform. They say "this
 * end is where the overlap band was cut, not where the object ends", which is a
 * fact about the piece and not about which frame it is being read in — so it has
 * to survive every hop, or the level below will freeze a chord the neighbouring
 * tile does not agree with.
 */
function seam(p, q) {
    if (p.seamA) q.seamA = true;
    if (p.seamB) q.seamB = true;
    return q;
}
export function translateLoops(loops, dx, dy) { return transformLoops(loops, 1, dx, dy); }

/**
 * The same similarity, written so MAGNIFICATION IS EXACT: subtract the cell
 * centre first, then scale.
 *
 * `p*f + t` and `(p - c)*f` are the same number in exact arithmetic and are not
 * the same computation. The first forms `p*f`, which for a magnifying step is a
 * large number, and then adds a large offset of the opposite sign — the low bits
 * of the answer are gone before the addition can recover them. The second does
 * the cancellation FIRST, at the parent's own scale where the two operands are
 * commensurate, and then applies a power of two, which cannot round at all.
 *
 * For a point inside the cell (the only case that matters, since that is what a
 * tile holds) the subtraction is exact — the difference is a multiple of the
 * larger operand's ulp and needs far fewer than 53 bits — so the whole step is
 * exact, and a descent of any depth is a chain of exact steps.
 */
export function transformLoopsAbout(loops, cx, cy, f) {
    const pt = (q) => [(q[0] - cx) * f, (q[1] - cy) * f];
    return loops.map((loop) => loop.map((p) => (p.line
        ? { line: true, A: pt(p.A), B: pt(p.B), src: p.src }
        : seam(p, { line: false, C: pt(p.C), r: p.r * f, a0: p.a0, sweep: p.sweep, A: pt(p.A), B: pt(p.B), src: p.src }))));
}

// ---------------------------------------------------------------------------
// flattening — the one place a tolerance enters, and it is a DISPLAY tolerance
// ---------------------------------------------------------------------------

const MAX_STEPS = 4096;

/** How many equal steps keep an arc within `tol` of its own chords. */
export function arcSteps(p, tol) {
    if (p.line || !isFinite(p.r) || !(p.r > 0)) return 1;
    if (!(tol > 0)) return MAX_STEPS;
    const c = 1 - tol / p.r;
    if (c <= -1) return 1;
    const half = Math.acos(Math.max(-1, Math.min(1, c)));
    if (!(half > 0)) return MAX_STEPS;
    return Math.max(1, Math.min(MAX_STEPS, Math.ceil(Math.abs(p.sweep) / (2 * half))));
}

/**
 * Loops as polygon rings. Every consumer that still speaks polygons — tiles,
 * hit-testing, the winding fill test — comes through here, and the tolerance is
 * always a DISPLAY one: how far the drawn edge may sit from the true edge on
 * screen. The stored geometry is never flattened.
 *
 * Determinism matters as much as accuracy: two tiles that clip the same shape
 * must flatten it to the SAME vertices or their pieces disagree along the seam.
 * Steps are a function of the piece and the tolerance alone — never of the tile,
 * the window or the camera — so they always do.
 */
export function flattenShape(loops, tol) {
    const out = [];
    for (const loop of loops) {
        if (!loop.length) continue;
        const ring = [[loop[0].A[0], loop[0].A[1]]];
        for (const p of loop) {
            const n = arcSteps(p, tol);
            for (let i = 1; i < n; i++) {
                const q = ptAt(p, i / n);
                ring.push([q[0], q[1]]);
            }
            ring.push([p.B[0], p.B[1]]);
        }
        // The chain closes on its own start; drop the duplicate so the ring is
        // the plain polygon every consumer here expects.
        if (ring.length > 1) {
            const a = ring[0], b = ring[ring.length - 1];
            if (a[0] === b[0] && a[1] === b[1]) ring.pop();
        }
        if (ring.length >= 3) out.push(ring);
    }
    return out;
}

/** Polygon rings as loops of line pieces — legacy fills coming in the door. */
export function shapeFromRings(rings) {
    const out = [];
    for (const ring of rings || []) {
        if (!ring || ring.length < 3) continue;
        const loop = [];
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            if (a[0] === b[0] && a[1] === b[1]) continue;
            loop.push({ line: true, A: [a[0], a[1]], B: [b[0], b[1]] });
        }
        if (loop.length >= 3) out.push(loop);
    }
    return out;
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/**
 * Loops as flat number arrays, one per loop.
 *
 * Consecutive pieces share an endpoint EXACTLY — that is the invariant the
 * whole representation rests on — so only the loop's start point and each
 * piece's far end are written. Writing both ends would double the file and
 * invite a round-trip where they no longer match bit for bit.
 *
 *   loop := ax, ay, piece*
 *   piece := 0, bx, by                            (line)
 *          | 1, cx, cy, r, a0, sweep, bx, by      (arc)
 *
 * A resolved perimeter is far smaller than the chain it came from — a captured
 * 4,962-sample stroke resolves to 2,195 pieces, and a dense scribble shrinks by
 * an order of magnitude — so this is comparable to storing the samples, and on
 * scribbles it is much less.
 */
export function encodeLoops(loops) {
    return (loops || []).map((loop) => {
        const a = [loop[0].A[0], loop[0].A[1]];
        for (const p of loop) {
            if (p.line || !isFinite(p.r)) a.push(0, p.B[0], p.B[1]);
            else a.push(1, p.C[0], p.C[1], p.r, p.a0, p.sweep, p.B[0], p.B[1]);
        }
        return a;
    });
}

export function decodeLoops(enc) {
    const out = [];
    for (const a of enc || []) {
        if (!Array.isArray(a) || a.length < 5) continue;
        const loop = [];
        let A = [a[0], a[1]];
        let i = 2;
        while (i < a.length) {
            if (a[i] === 0) {
                const B = [a[i + 1], a[i + 2]];
                loop.push({ line: true, A, B });
                A = B; i += 3;
            } else {
                const B = [a[i + 6], a[i + 7]];
                loop.push({ line: false, C: [a[i + 1], a[i + 2]], r: a[i + 3], a0: a[i + 4], sweep: a[i + 5], A, B });
                A = B; i += 8;
            }
        }
        if (loop.length) out.push(loop);
    }
    return out;
}

/** Every number in an encoded loop set is finite and the shape is closed. */
export function validEncodedLoops(enc) {
    if (!encodedLoopsWellFormed(enc)) return false;
    const loops = decodeLoops(enc);
    if (!loops.length) return false;
    for (const loop of loops) {
        const last = loop[loop.length - 1];
        if (last.B[0] !== loop[0].A[0] || last.B[1] !== loop[0].A[1]) return false;
    }
    return true;
}
/**
 * The structural half of the check: finite numbers in well-shaped arrays.
 *
 * Kept separate from closure because the two failures deserve different
 * answers. Numbers that are not numbers mean the file is not ours and there is
 * nothing to do but refuse it; a chain that does not close is damage a build of
 * ours once did (see `repairLoops`), and refusing THAT means refusing to open a
 * drawing over an object that can be mended.
 */
export function encodedLoopsWellFormed(enc) {
    if (!Array.isArray(enc) || !enc.length) return false;
    for (const a of enc) {
        if (!Array.isArray(a) || a.length < 5) return false;
        for (const v of a) if (typeof v !== "number" || !Number.isFinite(v)) return false;
    }
    return true;
}

/**
 * REPAIR a loop set that does not close.
 *
 * Nothing should ever produce one — `shapeBoolean` seals what its walk could not
 * close, and `KobinEngine._noteSeal` counts it — but one build did, and a document that
 * carries the damage cannot be saved at all: the file format validates closure
 * and refuses the whole drawing over a single bad object. Rather than lose the
 * drawing, close the chains with straight lines and drop what is then dust.
 * The result is honest — it is a closed shape, not a pretence that the geometry
 * was right — and everything downstream can rely on closure again.
 *
 * STITCH BEFORE SEALING. What arrives here is rarely several broken boundaries;
 * it is usually ONE boundary broken once, handed over as the fragments the walk
 * gave up on. Measured on the two phone strokes of 2026-08-26: three fragments
 * whose joins ran 0.000, 0.000 and 1.008 against a 12-unit pen. Sealing each
 * where it lay drew chords of 45 to 83 units — up to 45% of the loop's own
 * perimeter — and invented a hole out of the third fragment. Joining them first
 * leaves ONE chord of 1.008, a fifth of the ink's width, which nobody can see.
 * The severity of a failed bake should not be an artefact of where the walk
 * happened to give up.
 *
 * Pass `stats` to find out how much edge was fabricated — that number is the
 * only way to tell a repair nobody will notice from one that ate the shape, and
 * it travels in a phone report.
 *
 * Returns the same array when there was nothing to repair, so the common path
 * costs one comparison per loop.
 */
export function repairLoops(loops, pen, stats) {
    if (!Array.isArray(loops) || !loops.length) return loops;
    let broken = false;
    for (const l of loops) {
        if (!l.length) { broken = true; break; }
        const last = l[l.length - 1];
        if (last.B[0] !== l[0].A[0] || last.B[1] !== l[0].A[1]) { broken = true; break; }
    }
    if (!broken) return loops;
    const out = [], open = [];
    for (const l of loops) {
        if (!l.length) continue;
        const last = l[l.length - 1];
        // A loop that closes is a finished boundary — an outer or a hole — and
        // has no business being stitched to anything.
        if (last.B[0] === l[0].A[0] && last.B[1] === l[0].A[1]) out.push(l);
        else open.push(l);
    }
    const used = new Array(open.length).fill(false);
    let chords = 0, worst = 0, total = 0;
    for (let i = 0; i < open.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        let chain = open[i];
        // Take the cheapest join available at every step, and stop the moment
        // closing on the spot costs less than going on. Greedy, and that is the
        // right shape for it: this runs on geometry that is ALREADY damaged, so
        // the goal is the least fabricated edge, not a claim about which
        // fragment truly followed which.
        for (;;) {
            const head = chain[0].A, tail = chain[chain.length - 1].B;
            let best = -1, bestD = Math.hypot(tail[0] - head[0], tail[1] - head[1]);
            for (let j = 0; j < open.length; j++) {
                if (used[j]) continue;
                const a = open[j][0].A;
                const d = Math.hypot(tail[0] - a[0], tail[1] - a[1]);
                if (d < bestD) { bestD = d; best = j; }
            }
            if (best < 0) break;
            used[best] = true;
            // BRIDGE the join explicitly. Consecutive pieces are required to
            // share endpoint coordinates bit for bit — the encoding stores each
            // piece's B and hands it to the next piece as its A — so a join left
            // implicit does not vanish, it silently moves an arc's endpoint off
            // its own arc. That is the exact corruption this whole flag is
            // about. A join that already coincides needs nothing.
            const a = open[best][0].A;
            if (tail[0] !== a[0] || tail[1] !== a[1]) {
                chords++; total += bestD; if (bestD > worst) worst = bestD;
                chain = chain.concat([{ line: true, A: tail, B: a }]);
            }
            chain = chain.concat(open[best]);
        }
        const h = chain[0].A, t = chain[chain.length - 1].B;
        if (t[0] !== h[0] || t[1] !== h[1]) {
            const d = Math.hypot(t[0] - h[0], t[1] - h[1]);
            chords++; total += d; if (d > worst) worst = d;
            chain = chain.concat([{ line: true, A: t, B: h }]);
        }
        out.push(chain);
    }
    const kept = pen > 0 ? out.filter((l) => meanWidth([l]) >= pen * DUST_FRACTION) : out;
    if (stats) {
        stats.fragments = open.length;
        stats.chords = chords;
        stats.worstChord = +worst.toFixed(4);
        stats.fabricated = +total.toFixed(4);
        stats.dropped = out.length - kept.length;
    }
    return kept;
}

/** An axis-aligned rectangle as one normalized loop set. */
export function rectLoop(rect) {
    const c = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]];
    return normalizeLoops(shapeFromRings([c]));
}

/**
 * One arc as cubics — for Two.js, which speaks nothing else. Quarter-circle
 * pieces keep the standard 4/3·tan(θ/4) handle error under 2e-4·r, far inside
 * display tolerance. This is a RENDERING conversion; the arc stays the truth.
 */
export function pieceToCubics(p) {
    if (p.line || !isFinite(p.r)) return [[p.A, p.A, p.B, p.B]];
    const n = Math.max(1, Math.ceil(Math.abs(p.sweep) / (Math.PI / 2)));
    const step = p.sweep / n, k = (4 / 3) * Math.tan(step / 4);
    const out = [];
    for (let i = 0; i < n; i++) {
        const s0 = p.a0 + step * i, s1 = s0 + step;
        const q0 = i === 0 ? p.A : [p.C[0] + p.r * Math.cos(s0), p.C[1] + p.r * Math.sin(s0)];
        const q1 = i === n - 1 ? p.B : [p.C[0] + p.r * Math.cos(s1), p.C[1] + p.r * Math.sin(s1)];
        out.push([q0,
            [q0[0] - k * p.r * Math.sin(s0), q0[1] + k * p.r * Math.cos(s0)],
            [q1[0] + k * p.r * Math.sin(s1), q1[1] - k * p.r * Math.cos(s1)],
            q1]);
    }
    return out;
}
/** Loops as closed chains of cubics — the shape `curveOutline` also speaks. */
export function shapeToCubics(loops) {
    return loops.map((loop) => {
        const out = [];
        for (const p of loop) for (const c of pieceToCubics(p)) out.push(c);
        return out;
    });
}

// ---------------------------------------------------------------------------
// the boolean
// ---------------------------------------------------------------------------

/**
 * Shared vertex identity by position, with the neighbouring cells searched as
 * well as the point's own — a pair of coordinates either side of a cell
 * boundary is not a pair of different places. Endpoints are registered BEFORE
 * any crossing so a crossing landing on one adopts its identity instead of
 * inventing a vertex a millionth of a unit away from it.
 */
class VertexSet {
    constructor(q) { this.q = Math.max(q, 1e-300); this.map = new Map(); this.pts = []; }
    id(p) {
        const cx = Math.round(p[0] / this.q), cy = Math.round(p[1] / this.q);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const v = this.map.get((cx + dx) + "," + (cy + dy));
                if (v !== undefined) return v;
            }
        }
        const v = this.pts.length;
        this.map.set(cx + "," + cy, v);
        this.pts.push([p[0], p[1]]);
        return v;
    }
}

const bbHit = (a, b) => !!a && !!b && a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;
const magOf = (b) => Math.max(Math.abs(b.x0), Math.abs(b.y0), Math.abs(b.x1), Math.abs(b.y1));

/**
 * An arc whose bulge is finer than its own coordinates can express IS a line.
 *
 * A biarc pen fitting a nearly-straight stretch emits radii like 4.99e17. On an
 * object spanning 3.5e4 that arc's sagitta — how far it departs from its own
 * chord — is 2.5e-17, thousands of times below one ulp of the numbers it is
 * written in. It is a line that has been written down as a circle, and every
 * piece of arithmetic that treats it as a circle is then computing with a
 * radius five thousand billion times the object:
 *
 *   - `|m - C| - r` cancels completely. At r = 4.99e17 one ulp is 64 units, so
 *     every point within 64 units of the arc reports a distance of exactly 0.
 *   - its sweep is 2e-17 radians, so `paramOf` divides by a number that carries
 *     no significant digits at all.
 *   - `circleCircle` against it is a subtraction of two ~2.5e35 squares.
 *
 * Straightening it changes the geometry by less than one ulp and makes all
 * three exact. Done on the boolean's own working copy, at the scale of the
 * coordinates actually in play.
 */
function straighten(loops, tol) {
    let hit = 0;
    const out = loops.map((loop) => loop.map((p) => {
        if (p.line) return p;
        const sag = Math.abs(p.r) * (1 - Math.cos(Math.abs(p.sweep) / 2));
        if (!(sag <= tol)) return p;
        hit++;
        return { line: true, A: p.A, B: p.B, src: p.src, ci: p.ci, rl: p.rl };
    }));
    return { loops: out, straightened: hit };
}

/**
 * Is `m` on the CURVE piece `q` runs along — its whole line, its whole circle?
 * Range is a separate question, answered by `paramOf`.
 */
function onCurveOf(q, m, tol) {
    if (q.line) {
        const dx = q.B[0] - q.A[0], dy = q.B[1] - q.A[1], L = Math.hypot(dx, dy);
        if (!(L > 0)) return false;
        return Math.abs((m[0] - q.A[0]) * (-dy / L) + (m[1] - q.A[1]) * (dx / L)) <= tol;
    }
    // `|m - C| - r` CANCELS when the radius is huge, and a biarc pen emits
    // radii like 4.99e17 for the nearly-straight stretch of a long stroke. One
    // ulp there is 64 units, so every point within 64 units of that arc came
    // back at a distance of exactly 0 — and 45 fragments of a 146-unit eraser
    // were declared to be lying on the ink's boundary. Refuse to answer rather
    // than answer wrongly: the caller then asks the winding query, which is
    // what it did before coincidence was handled at all.
    if (Math.abs(q.r) * Number.EPSILON > tol * 0.5) return false;
    return Math.abs(Math.hypot(m[0] - q.C[0], m[1] - q.C[1]) - q.r) <= tol;
}

/**
 * Where two pieces lie ON TOP OF each other, as a parameter interval on `p`.
 *
 * THE CASE THE INTERSECTORS CANNOT SEE. `circleCircle` returns nothing when the
 * centres coincide (it divides by the distance between them) and `segSeg`
 * returns nothing when the directions are parallel (it divides by the cross
 * product). Both are correct — coincident curves have no isolated crossing —
 * but the boolean was reading "no crossings" as "nothing to do here", and then
 * classifying the piece by a winding query at a midpoint sitting exactly ON the
 * other boundary, where the answer is a coin flip.
 *
 * That is not a corner case in a drawing app. It is what finishing a cut you
 * already started looks like: the first eraser leaves a boundary offset from
 * its path by the pen radius, and a second gesture down the same path with the
 * same pen generates exactly that curve again. Measured at level 0 with no zoom
 * at all: 13% of a stroke destroyed and a third piece invented, where the same
 * cut with the pen one unit wider came out clean.
 *
 * Returns `{ s: [s0, s1], same }` — the overlapping parameter range on `p`, and
 * whether the two pieces travel it the same way round — or null.
 */
export function pieceOverlap(p, q, tol) {
    if (!p.line !== !q.line) return null;              // a line never lies on an arc
    if (p.line) {
        const dx = p.B[0] - p.A[0], dy = p.B[1] - p.A[1], L = Math.hypot(dx, dy);
        if (!(L > 0)) return null;
        const ux = dx / L, uy = dy / L;
        // Both of q's ends on p's line, or they are not the same line.
        for (const e of [q.A, q.B]) {
            if (Math.abs((e[0] - p.A[0]) * -uy + (e[1] - p.A[1]) * ux) > tol) return null;
        }
        const sA = ((q.A[0] - p.A[0]) * ux + (q.A[1] - p.A[1]) * uy) / L;
        const sB = ((q.B[0] - p.A[0]) * ux + (q.B[1] - p.A[1]) * uy) / L;
        const lo = Math.max(0, Math.min(sA, sB)), hi = Math.min(1, Math.max(sA, sB));
        if ((hi - lo) * L <= tol) return null;
        return { s: [lo, hi], same: sB > sA };
    }
    if (Math.hypot(p.C[0] - q.C[0], p.C[1] - q.C[1]) > tol) return null;
    if (Math.abs(p.r - q.r) > tol) return null;
    // Both arcs live on one circle, so the overlap is an intersection of angular
    // intervals — taken relative to p's low end, with the wrapped copy tried too,
    // because an interval on a circle has two representations.
    const pl = p.sweep > 0 ? p.a0 : p.a0 + p.sweep, pLen = Math.abs(p.sweep);
    const ql = q.sweep > 0 ? q.a0 : q.a0 + q.sweep, qLen = Math.abs(q.sweep);
    const rel = wrap(ql - pl);
    let best = null;
    for (const base of [rel, rel - TAU]) {
        const lo = Math.max(0, base), hi = Math.min(pLen, base + qLen);
        if (hi > lo && (!best || hi - lo > best[1] - best[0])) best = [lo, hi];
    }
    if (!best || (best[1] - best[0]) * p.r <= tol) return null;
    const sOf = (x) => (p.sweep > 0 ? x / pLen : 1 - x / pLen);
    const s0 = sOf(best[0]), s1 = sOf(best[1]);
    return { s: [Math.min(s0, s1), Math.max(s0, s1)], same: (p.sweep > 0) === (q.sweep > 0) };
}

/**
 * A − B, or A ∩ B, as resolved loops.
 *
 * Both inputs must be SIMPLE — no loop crossing itself or another loop of the
 * same shape. A resolved perimeter is, and so is this function's own output, so
 * booleans compose.
 *
 * @param {piece[][]} A
 * @param {piece[][]} B
 * @param {"difference"|"intersection"} op
 * @param {object} opts  { weld } vertex identity radius (default span·1e-8)
 */
/**
 * The boolean, with ONE retry at a different vertex-identity radius.
 *
 * The pairing at a vertex is a discrete decision made from continuous
 * coordinates: which ends are the same point, and in what angular order. A
 * configuration that lands exactly on that boundary — an eraser whose ring runs
 * tangent to the edge it is cutting, three arcs meeting at one point — can pair
 * ends into chains that do not close, and then a real stretch of boundary is
 * simply lost. Measured on a plain Y-stroke cut by a ring eraser: two chains
 * open, carrying 1,135 of the 5,521 units of area, i.e. the island in the
 * middle of the ring, gone.
 *
 * Perturbing the radius moves that decision off the boundary, and a tenth and
 * ten times are both still tiny against every feature in play. The retry only
 * runs when the first attempt LOST something, so nothing normal pays for it.
 */
export function shapeBoolean(A, B, op, opts = {}) {
    const first = shapeBooleanOnce(A, B, op, opts);
    if (!first.stats || !first.stats.openChains || opts.weld > 0) return first;
    for (const k of [0.1, 10, 0.01]) {
        const retry = shapeBooleanOnce(A, B, op, { ...opts, weld: first.stats.weld * k });
        if (retry.stats && !retry.stats.openChains) {
            retry.stats.retriedAt = k;
            return retry;
        }
    }
    return first;
}
export function shapeBooleanOnce(A, B, op, opts = {}) {
    const wantIn = op === "intersection";
    A = normalizeLoops(A || []);
    B = normalizeLoops(B || []);
    if (!A.length) return { loops: [], stats: { trivial: "empty subject" } };
    if (!B.length) return { loops: wantIn ? [] : A, stats: { trivial: "empty clip" } };

    const bbA = loopsBBox(A), bbB = loopsBBox(B);
    if (!bbA || !bbB) return { loops: wantIn ? [] : A, stats: { trivial: "no extent" } };
    const span = Math.max(bbA.x1 - bbA.x0, bbA.y1 - bbA.y0, bbB.x1 - bbB.x0, bbB.y1 - bbB.y0, 1e-12);
    // A few ulps of the coordinates in play: below this an arc and its chord are
    // the same curve, and only one of the two can be computed with.
    const flat = Math.max(magOf(bbA), magOf(bbB), 1) * Number.EPSILON * 8;
    const sA = straighten(A, flat), sB = straighten(B, flat);
    A = sA.loops; B = sB.loops;

    // ---- pass the untouched loops straight through -------------------------
    // A loop whose bbox misses the other shape's bbox cannot cross it and cannot
    // be inside it, so its fate is settled without any geometry at all. On a
    // real drawing that is nearly every loop: an eraser touches one part of one
    // stroke, and this is what keeps the cost proportional to the GESTURE rather
    // than to the drawing.
    const out = [];
    const hotA = [], hotB = [];
    for (const loop of A) {
        if (bbHit(loopBBox(loop), bbB)) hotA.push(loop);
        else if (!wantIn) out.push(loop);
    }
    for (const loop of B) if (bbHit(loopBBox(loop), bbA)) hotB.push(loop);
    if (!hotA.length) return { loops: out, stats: { untouched: A.length } };
    if (!hotB.length) return { loops: wantIn ? out : out.concat(hotA), stats: { untouched: A.length } };

    // ---- cut ---------------------------------------------------------------
    const items = [];
    for (const loop of hotA) for (const p of loop) items.push({ p, set: 0 });
    for (const loop of hotB) for (const p of loop) items.push({ p, set: 1 });
    const N = items.length;
    const bbs = new Array(N);
    let cell = 0;
    for (let i = 0; i < N; i++) {
        bbs[i] = pieceBBox(items[i].p);
        cell += Math.max(bbs[i][2] - bbs[i][0], bbs[i][3] - bbs[i][1]);
    }
    const grid = new Grid(Math.max(cell / N, span * 1e-6, 1e-9));
    for (let i = 0; i < N; i++) grid.insert(bbs[i], i);

    // Vertex identity has to be scaled off the SMALLER shape, not the bigger
    // one. An eraser a millionth of its target's size is the normal case here —
    // that is what erasing at depth means — and a radius taken from the target
    // swallows the eraser whole: all four corners of a 2e-6 clip inside a 2000
    // unit object land in one cell, the clip's loop collapses, and the hole
    // never appears. Floored at a few dozen ulps of the coordinates in play, so
    // a crossing that lands on an endpoint still adopts it.
    // ...and off the coordinates where the two shapes actually MEET, not off
    // the largest number in the room.
    //
    // Every vertex that has to be recognised as shared lies in the overlap: a
    // crossing, or an endpoint one shape puts on the other. Outside it, A's own
    // vertices are carried through untouched and have nothing to be welded to.
    // The magnitudes involved differ by any amount you like in this app — a
    // level-0 object clipped into a tile five crossings down arrives 2.4e17
    // times its own size against a 12,330-unit rect — and a fuzz taken from the
    // larger came to 1e5 units, so every vertex of the rect-sized result welded
    // into a handful of points, no chain could close, and what got stored was
    // 871 pieces in 68 open chains: an object that painted nothing and made the
    // whole drawing unsaveable. That object is in Kobin's document; this line
    // is where it was made.
    const ovMag = Math.max(
        Math.abs(Math.max(bbA.x0, bbB.x0)), Math.abs(Math.min(bbA.x1, bbB.x1)),
        Math.abs(Math.max(bbA.y0, bbB.y0)), Math.abs(Math.min(bbA.y1, bbB.y1)));
    const fuzz = Math.max(Math.min(ovMag, magOf(bbA)), 1) * 1e-12;
    const smallest = Math.min(
        Math.max(bbA.x1 - bbA.x0, bbA.y1 - bbA.y0),
        Math.max(bbB.x1 - bbB.x0, bbB.y1 - bbB.y0));
    const weld = opts.weld > 0 ? opts.weld : Math.max(smallest * 1e-9, fuzz);
    const vs = new VertexSet(weld);
    const endV = new Array(N * 2);
    for (let i = 0; i < N; i++) {
        endV[i * 2] = vs.id(items[i].p.A);
        endV[i * 2 + 1] = vs.id(items[i].p.B);
    }

    const cuts = Array.from({ length: N }, () => []);
    // Slack for "did this crossing land on the piece". It has to be the SAME
    // radius that decides vertex identity: a crossing within welding distance
    // of a piece is on that piece, and saying otherwise drops the crossing for
    // BOTH sides. That is not a rounding curiosity — it is one entry without
    // its exit, so the fragments cannot pair, and the walk hands back chains
    // that never close. Measured on a Y-stroke cut by a ring eraser: 17
    // crossings where a closed pair of shapes must produce an even number, two
    // unbalanced vertices, and the island inside the ring — 1,135 of the
    // shape's 5,521 units of area — simply lost.
    const eps = weld;
    let nX = 0, nOv = 0, nCo = 0;
    for (let i = 0; i < N; i++) {
        if (items[i].set !== 0) continue;                 // A against B only
        // eslint-disable-next-line no-loop-func -- the callback runs synchronously inside this iteration
        grid.near(bbs[i], (j) => {
            if (items[j].set !== 1) return;
            const bj = bbs[j], bi = bbs[i];
            if (bj[0] > bi[2] || bj[2] < bi[0] || bj[1] > bi[3] || bj[3] < bi[1]) return;
            for (const q of pieceIntersections(items[i].p, items[j].p)) {
                const si = paramOf(items[i].p, q, eps);
                if (si == null) continue;
                const sj = paramOf(items[j].p, q, eps);
                if (sj == null) continue;
                // ONE vertex id for the crossing, so both pieces are cut at the
                // very same point rather than at two roundings of it.
                const v = vs.id(q);
                cuts[i].push([si, v]);
                cuts[j].push([sj, v]);
                nX++;
            }
            // ...and cut where the two pieces lie ON each other. Coincident
            // curves have no crossing to find, but their overlap still has to
            // start and end somewhere, and a fragment that is half on the other
            // boundary and half off it cannot be classified either way.
            const ov = pieceOverlap(items[i].p, items[j].p, eps);
            if (ov) {
                nOv++;
                for (const sp of ov.s) {
                    const P = ptAt(items[i].p, sp);
                    const v = vs.id(P);
                    cuts[i].push([sp, v]);
                    const sq = paramOf(items[j].p, P, eps);
                    if (sq != null) cuts[j].push([sq, v]);
                }
            }
        });
    }
    /**
     * Does this fragment lie ON the other shape's boundary, and if so which way
     * is that boundary going: +1 the same way, -1 the other way, 0 not on it.
     *
     * Asked at the fragment's midpoint, which is decisive because the overlap
     * ENDS are cuts now: a fragment is wholly coincident or wholly not.
     */
    const coincidence = (seg, set) => {
        const m = ptAt(seg, 0.5);
        const t = pieceTangent(seg, 0.5);
        let dir = 0;
        grid.near([m[0] - eps, m[1] - eps, m[0] + eps, m[1] + eps], (j) => {
            if (dir || items[j].set === set) return;
            const q = items[j].p;
            if (!onCurveOf(q, m, eps)) return;
            const sq = paramOf(q, m, eps);
            if (sq == null) return;
            const tq = pieceTangent(q, sq);
            dir = tq[0] * t[0] + tq[1] * t[1] >= 0 ? 1 : -1;
        });
        return dir;
    };

    // ---- split + classify --------------------------------------------------
    const flatA = flatPieces(A), flatB = flatPieces(B);
    const kept = [];
    let ambiguous = 0;
    for (let i = 0; i < N; i++) {
        const p = items[i].p, set = items[i].set;
        const va = endV[i * 2], vb = endV[i * 2 + 1];
        const seen = new Set();
        const cl = [];
        for (const c of cuts[i]) {
            // A crossing that resolved to one of this piece's own ends is not a
            // cut, and dropping it BY VERTEX drops it on the other piece too.
            if (c[1] === va || c[1] === vb || seen.has(c[1])) continue;
            seen.add(c[1]);
            cl.push(c);
        }
        let segs;
        if (!cl.length) segs = [p];
        else {
            cl.sort((a, b) => a[0] - b[0]);
            segs = [];
            let s0 = 0, S = p.A;
            for (const [s, v] of cl) {
                const P = vs.pts[v];
                segs.push(subPiece(p, s0, s, S, P));
                s0 = s; S = P;
            }
            segs.push(subPiece(p, s0, 1, S, p.B));
        }
        const other = set === 0 ? flatB : flatA;
        for (const s of segs) {
            // SHARED BOUNDARY, decided by orientation. Interiors lie to the
            // left of travel (normalizeLoops guarantees it), so two coincident
            // stretches running the same way have both interiors on the same
            // side, and running opposite ways have them on opposite sides:
            //
            //   difference   same way -> B covers A here, the edge is gone
            //                other way -> B is outside A here, A keeps its edge
            //   intersection same way -> the shared edge bounds A n B
            //                other way -> nothing is in both, drop it
            //
            // Either way the CLIP's copy is dropped: where the edge survives,
            // A's copy already carries it, and admitting both would put two
            // fragments on one stretch and leave the walk a junction it cannot
            // balance. No winding query is asked, because on the other shape's
            // own boundary a winding query has no answer to give.
            const co = coincidence(s, set);
            if (co) {
                nCo++;
                if (set === 0 && (wantIn ? co > 0 : co < 0)) kept.push(s);
                continue;
            }
            const m = ptAt(s, 0.5);
            const w = windingOfFlat(other, m);
            if (w == null) ambiguous++;
            const inside = w != null && w !== 0;
            if (set === 0) {
                if (inside === wantIn) kept.push(s);
            } else if (inside) {
                // B's boundary becomes part of the answer where it runs through
                // A. For a difference it runs the OTHER way — that reversal is
                // what turns the clip's outside into the result's hole.
                kept.push(wantIn ? s : reversePiece(s));
            }
        }
    }

    // ---- stitch ------------------------------------------------------------
    const st = stitch(kept, vs);
    // Same filter the bake applies, for the same reason: a boolean whose clip
    // runs along an existing edge can leave a strip with no width, which paints
    // nothing and then counts as its own connected component.
    //
    // At the ROUNDING scale, though, not at a feature scale. The bake can afford
    // to measure a hairline against the pen, because it knows what made the
    // shape; a boolean does not, and a perfectly legitimate hole can be a
    // billionth of the object it is cut in — that is the whole reason this is
    // not a polygon library. `fuzz` is the same radius vertex identity uses: a
    // strip narrower than the distance at which two points are the same point
    // is not a strip.
    // EVERY loop that leaves here CLOSES. That is the invariant the rest of the
    // app is entitled to: an unclosed chain is painted shut with a straight
    // line across the object, its winding stops meaning anything, and the file
    // format refuses the whole drawing over one of them.
    //
    // The walk can still fail to close one — a configuration that lands exactly
    // on a discrete decision (an eraser running tangent to the edge it cuts,
    // three arcs meeting at a point) pairs ends into a chain with no way home.
    // Most such chains enclose nothing and are dropped with the hairlines. One
    // that carries AREA is a real stretch of boundary, and the choice is
    // between losing it and closing it with a chord: measured on a plain
    // Y-stroke cut by a ring eraser, that is the island inside the ring, 1,135
    // of the shape's 5,521 units. Losing it means the erase visibly does the
    // wrong thing; closing it means an edge that is straight where it should
    // curve, in a place the arithmetic had already given up on. The chord wins,
    // and `sealed` says how often it was needed so the honesty is measurable.
    let sealedArea = 0, sealed = 0;
    for (const l of dropHairlines(st.loops, fuzz)) {
        if (l.closed === false) {
            const last = l[l.length - 1];
            if (last.B[0] !== l[0].A[0] || last.B[1] !== l[0].A[1]) {
                l.push({ line: true, A: last.B, B: l[0].A });
            }
            sealed++; sealedArea += Math.abs(loopArea(l));
        }
        out.push(l);
    }
    const solid = Math.abs(loopsArea(out));
    // "Substantial" is a millionth of the shape's own area: below that the
    // chord cannot have moved a pixel, above it the caller deserves to know.
    const lost = sealed > 0 && sealedArea > Math.max(solid, 1) * 1e-6;
    return { loops: out, stats: {
        crossings: nX, overlaps: nOv, coincident: nCo, straightened: sA.straightened + sB.straightened,
        pieces: N, kept: kept.length,
        loops: out.length, sealed, sealedArea, openChains: lost ? sealed : 0,
        weld, unbalanced: st.unbalanced, ambiguous,
    } };
}

/**
 * Fragments into closed loops.
 *
 * Ends are PAIRED at each vertex before any walking: sweep the ends by angle and
 * match every departure to the most recent arrival, going round twice so a
 * departure that precedes every arrival still finds the one behind it. That
 * makes `next` a bijection on fragments, so its cycles ARE the loops — every
 * fragment used once, every cycle closed, and no dependence on where the walk
 * started. The greedy alternative (take the first unused departure) lets an
 * earlier loop consume the fragment a later one needed, which is F15's fifth
 * defect and cost a week.
 */
function stitch(kept, vs) {
    const n = kept.length;
    const ends = new Map();
    const at = (v) => { let e = ends.get(v); if (!e) { e = { in: [], out: [] }; ends.set(v, e); } return e; };
    for (let i = 0; i < n; i++) {
        const t0 = pieceTangent(kept[i], 0), t1 = pieceTangent(kept[i], 1);
        at(vs.id(kept[i].A)).out.push({ i, ang: Math.atan2(t0[1], t0[0]) });
        at(vs.id(kept[i].B)).in.push({ i, ang: Math.atan2(-t1[1], -t1[0]) });
    }
    const next = new Int32Array(n).fill(-1);
    let unbalanced = 0;
    for (const e of ends.values()) {
        if (e.in.length !== e.out.length) unbalanced++;
        const all = [];
        for (const a of e.in) all.push({ i: a.i, ang: a.ang, arrival: true });
        for (const d of e.out) all.push({ i: d.i, ang: d.ang, arrival: false });
        all.sort((x, y) => x.ang - y.ang || (x.arrival ? 0 : 1) - (y.arrival ? 0 : 1));
        // Two passes over the SAME stack, deliberately not reset between them:
        // the ends live on a circle, so a departure that sorts before every
        // arrival still has one behind it — the last one, coming round. Clearing
        // the stack between passes is what leaves those departures unmatched,
        // and a vertex with an unmatched end is an open chain.
        const stack = [];
        const usedDep = new Set();
        for (let pass = 0; pass < 2; pass++) {
            for (const x of all) {
                if (x.arrival) { if (next[x.i] < 0) stack.push(x.i); continue; }
                if (usedDep.has(x.i)) continue;
                let a = -1;
                while (stack.length) { const c = stack.pop(); if (next[c] < 0) { a = c; break; } }
                if (a < 0) continue;
                next[a] = x.i;
                usedDep.add(x.i);
            }
        }
    }
    const used = new Uint8Array(n);
    const loops = [];
    let open = 0;
    for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        const loop = [];
        let cur = i;
        for (;;) {
            used[cur] = 1;
            loop.push(kept[cur]);
            const nx = next[cur];
            if (nx < 0) { open++; loop.closed = false; break; }
            if (nx === i) { loop.closed = true; break; }
            if (used[nx]) { open++; loop.closed = false; break; }
            cur = nx;
        }
        if (loop.length) loops.push(loop);
    }
    return { loops, open, unbalanced };
}

/** A − B. */
export function subtractShape(A, B, opts) { return shapeBoolean(A, B, "difference", opts); }
/** A ∩ B. */
export function intersectShape(A, B, opts) { return shapeBoolean(A, B, "intersection", opts); }
/** The part of a shape inside an axis-aligned rect. */
export function clipShapeToRect(loops, rect, opts) {
    return shapeBoolean(loops, rectLoop(rect), "intersection", opts);
}

/**
 * Connected components of a shape, as groups of loops.
 *
 * A hole belongs to the smallest outer loop that contains it, decided by the
 * winding of a point ON the hole against that outer loop — exact here, and
 * needing none of the area heuristics the polygon path used. Disjoint outer
 * loops are different components, which is precisely the question severance
 * asks after an erase.
 */
export function shapeComponents(loops) {
    const set = normalizeLoops(loops);
    const outers = [], holes = [];
    for (const l of set) (loopArea(l) >= 0 ? outers : holes).push(l);
    const groups = outers.map((l) => [l]);
    for (const h of holes) {
        const p = ptAt(h[0], 0.5);
        let best = -1, bestArea = Infinity;
        for (let i = 0; i < outers.length; i++) {
            if (!insideShape([outers[i]], p)) continue;
            const a = Math.abs(loopArea(outers[i]));
            if (a < bestArea) { bestArea = a; best = i; }
        }
        if (best >= 0) groups[best].push(h);
        else groups.push([h]);          // an orphan hole: keep it rather than lose ink
    }
    return groups.filter((g) => g.length);
}
