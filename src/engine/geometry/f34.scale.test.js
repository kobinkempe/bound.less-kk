/**
 * F34 — what the boolean does as an arc's RADIUS runs away from its coordinates.
 *
 * Kobin's failing erase cut ink that had been carried two frame levels down.
 * Measured on his own drawing: object 27's ink arrives in the cutting frame
 * spanning 5.6e10 x 6.3e10 while the tile it is cut in is 1.31e5 across — the
 * ink is 430,000x the working region — and the surviving pieces carry arcs of
 * radius up to 6.49e10 against a 1.31e5 span. Every other object in that drawing
 * has a radius/span ratio between 4 and 510.
 *
 * So the question is not "what did his pointer do", it is: at what radius does an
 * exact arc boolean stop working? Everything below is held constant except |r|.
 * The subject is a slab the size of one tile whose edges are arcs; the clip is a
 * small circular eraser near a corner of it, which is the reported gesture.
 */
import { subtractShape, loopsArea } from "./arcShape";
import { bakeArcPerimeter } from "./arcPerimeter";

const H = 65536;          // half a frame — the coordinates actually in play
const ERASER = 21.6;      // his 43.2-unit `lwFrame`, as a radius

/** A square slab of half-width h whose four edges are arcs of radius r. */
function slab(h, r) {
    const P = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const loop = [];
    for (let i = 0; i < 4; i++) {
        const A = P[i], B = P[(i + 1) % 4];
        const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
        // Outward normal of this edge, so the centre sits INSIDE and the arc
        // bulges out — a convex slab, like a fat stroke's flank.
        const ex = B[0] - A[0], ey = B[1] - A[1];
        const L = Math.hypot(ex, ey);
        const nx = ey / L, ny = -ex / L;          // outward for CCW P
        const d = Math.sqrt(Math.max(r * r - (L / 2) * (L / 2), 0));
        const C = [mx - nx * d, my - ny * d];
        const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
        const a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
        let sweep = a1 - a0;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep < -Math.PI) sweep += 2 * Math.PI;
        loop.push({ line: false, C, r, a0, sweep, A, B, src: i });
    }
    return [loop];
}

/** A circle, as two half-arcs — the eraser. */
function disc(cx, cy, r) {
    return [[
        { line: false, C: [cx, cy], r, a0: 0, sweep: Math.PI, A: [cx + r, cy], B: [cx - r, cy], src: -1 },
        { line: false, C: [cx, cy], r, a0: Math.PI, sweep: Math.PI, A: [cx - r, cy], B: [cx + r, cy], src: -1 },
    ]];
}

test("the slab is built correctly at an ordinary radius", () => {
    const s = slab(H, H * 4);
    const area = Math.abs(loopsArea(s));
    // Bulged edges, so a little over the square — but the same order, which is
    // what says the construction is a slab and not nonsense.
    expect(area).toBeGreaterThan((2 * H) ** 2);
    expect(area).toBeLessThan((2 * H) ** 2 * 1.6);
});

test("radius sweep — where an exact arc boolean stops working", () => {
    const rows = [];
    for (const mag of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        const r = Math.pow(10, mag);
        if (r < H) continue;                       // an edge arc cannot be shorter than its chord
        const A = slab(H, r);
        // Near a corner, which is where he was erasing.
        const B = disc(H - 400, H - 400, ERASER);
        const before = Math.abs(loopsArea(A));
        const res = subtractShape(A, B);
        const after = Math.abs(loopsArea(res.loops));
        const st = res.stats || {};
        rows.push({
            r: r.toExponential(0),
            rOverSpan: (r / (2 * H)).toExponential(1),
            loops: res.loops.length,
            open: st.openChains || 0,
            sealed: st.sealed || 0,
            straightened: st.straightened || 0,
            removed: +(before - after).toFixed(2),
            wantRemoved: +(Math.PI * ERASER * ERASER).toFixed(2),
        });
    }
    // eslint-disable-next-line no-console
    console.log("F34 RADIUS SWEEP\n" + rows.map((x) => JSON.stringify(x)).join("\n"));
    expect(rows.length).toBeGreaterThan(4);
});

/**
 * THE ERASER IS A RING, not a disc.
 *
 * "The eraser was essentially a circle around the corner" — a pen driven round a
 * circle sweeps an ANNULUS, and the island inside it is a separate boundary that
 * the difference has to keep. `shapeBooleanOnce`'s own seal comment names this
 * exact shape as where the walk gives up: "an eraser whose ring runs tangent to
 * the edge it is cutting". The disc sweep above is clean at every radius, so if
 * scale matters at all it can only matter for THIS shape.
 */
function ring(cx, cy, R, pen) {
    const pts = [];
    for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    return bakeArcPerimeter(pts, pen, { tol: 0.125 }).loops;
}

test("ring eraser — the same sweep, with the gesture he actually drew", () => {
    const rows = [];
    for (const mag of [5, 6, 7, 8, 9, 10, 11, 12]) {
        const r = Math.pow(10, mag);
        const A = slab(H, r);
        const B = ring(H - 400, H - 400, 120, 2 * ERASER);
        const before = Math.abs(loopsArea(A));
        const res = subtractShape(A, B);
        const st = res.stats || {};
        rows.push({
            r: r.toExponential(0),
            eraserLoops: B.length,
            loops: res.loops.length,
            open: st.openChains || 0,
            sealed: st.sealed || 0,
            sealedArea: +(st.sealedArea || 0).toFixed(2),
            removed: +(before - Math.abs(loopsArea(res.loops))).toFixed(2),
        });
    }
    // eslint-disable-next-line no-console
    console.log("F34 RING SWEEP\n" + rows.map((x) => JSON.stringify(x)).join("\n"));
    expect(rows.length).toBeGreaterThan(4);
});

/**
 * THE CONFIGURATION BOTH SWEEPS ABOVE MISSED: the eraser STRADDLING the edge.
 *
 * With the eraser wholly inside, no intersection ever has to be computed — the
 * classification is a winding query and the arithmetic never touches the huge
 * arc. Kobin's ring straddles the ink's boundary (measured: 30 of its 192 pieces
 * lie outside the subject), so every crossing has to be found by intersecting a
 * radius-6.5e10 arc against a radius-21 one.
 *
 * A closed curve crossing another closed curve crosses it an EVEN number of
 * times. His failing case reports 3.
 */
test("straddling sweep — crossings must come in pairs", () => {
    const rows = [];
    for (const mag of [5, 6, 7, 8, 9, 10, 11, 12]) {
        const r = Math.pow(10, mag);
        const A = slab(H, r);
        // Centred ON the top edge, so the ring is cut by it.
        const B = ring(0, -H, 120, 2 * ERASER);
        const res = subtractShape(A, B);
        const st = res.stats || {};
        rows.push({
            r: r.toExponential(0),
            crossings: st.crossings,
            odd: (st.crossings % 2) !== 0,
            loops: res.loops.length,
            open: st.openChains || 0,
            sealed: st.sealed || 0,
            unbalanced: st.unbalanced,
        });
    }
    // eslint-disable-next-line no-console
    console.log("F34 STRADDLE SWEEP\n" + rows.map((x) => JSON.stringify(x)).join("\n"));
    expect(rows.length).toBeGreaterThan(4);
});
