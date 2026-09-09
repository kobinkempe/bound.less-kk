/**
 * WC — the winding query in the chord frame (2026-09-07, roadmap item 5).
 *
 * `arcShape.rayCross` asks an arc whose radius is at least its chord in its
 * CHORD FRAME (freeze.js `chordFrame`, `chordLineRoots`, `chordHit`) instead
 * of through its centre: through the centre, a ray's crossing with a circle
 * of radius 5e12 cancels |p - C|^2 against r^2 and is wrong by the centre's
 * float64 step (0.9 px at the deepest zoom on the jsdom instrument, F44's
 * tests read the edge off the pieces to get round it). The chord frame never
 * touches the centre. These tests hold the new form against the old one
 * where the old one is still an oracle, and against geometry where it is
 * not, on seeded random arcs across the radii the engine sees (10 to 1e15).
 *
 * WC-4 is the case that was wrong on the first build: a ray that MISSES the
 * arc still gets roots from the first-order quadratic, and without a residual
 * check three Newton steps left a fictional crossing inside the piece (chord
 * fraction 0.22, line equation off by 64 units) and CX-4 lost a tile to it.
 */
import { windingOfFlat } from "./arcShape";

const TAU = Math.PI * 2;
const wrap = (d) => d - TAU * Math.floor(d / TAU);
const GRAZE = 1e-15;
const DIRS = [];
for (let i = 0; i < 8; i++) { const a = i * 2.39996322972865332; DIRS.push([Math.cos(a), Math.sin(a)]); }

// The centre form, verbatim from arcShape.rayCross before 2026-09-07.
function centreCross(q, p, dx, dy) {
    let w = 0;
    const pm = Math.abs(p[0]) + Math.abs(p[1]);
    const fx = p[0] - q.C[0], fy = p[1] - q.C[1];
    const fd = fx * dx + fy * dy;
    const disc = fd * fd - (fx * fx + fy * fy - q.r * q.r);
    if (disc < 0) return 0;
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
        if (s < 0 || s > 1) { if ((s < 0 ? -s : s - 1) * arcLen <= eps) return null; continue; }
        if (Math.abs(t) <= eps) return null;
        if (sq <= eps) return null;
        if (s * arcLen <= eps || (1 - s) * arcLen <= eps) return null;
        const g = q.sweep > 0 ? 1 : -1;
        const tx = -Math.sin(th) * g, ty = Math.cos(th) * g;
        const cross = -tx * dy + ty * dx;
        if (Math.abs(cross) <= 1e-12) return null;
        w += cross > 0 ? 1 : -1;
    }
    return w;
}
function centreWinding(q, p) {
    for (const [dx, dy] of DIRS) { const w = centreCross(q, p, dx, dy); if (w !== null) return w; }
    return null;
}

const mulberry = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const arcOf = (C, r, a0, sweep) => ({ line: false, C, r, a0, sweep,
    A: [C[0] + r * Math.cos(a0), C[1] + r * Math.sin(a0)],
    B: [C[0] + r * Math.cos(a0 + sweep), C[1] + r * Math.sin(a0 + sweep)] });

test("WC-1 chord-frame winding agrees with the centre form on random arcs", () => {
    const rnd = mulberry(7);
    let n = 0, bad = 0, nulls = 0;
    const worst = [];
    for (let i = 0; i < 20000; i++) {
        const r = Math.pow(10, 1 + rnd() * 6);
        const sweep = (rnd() - 0.5) * 1.8 * Math.PI;         // minor arcs, both ways
        const a0 = rnd() * TAU;
        const C = [(rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000];
        const q = arcOf(C, r, a0, sweep);
        const L = Math.hypot(q.B[0] - q.A[0], q.B[1] - q.A[1]);
        if (!(r >= L)) continue;                              // the chord frame's regime only
        // a point near the arc's chord, within a few chords of it
        const mx = (q.A[0] + q.B[0]) / 2, my = (q.A[1] + q.B[1]) / 2;
        const p = [mx + (rnd() - 0.5) * 4 * L, my + (rnd() - 0.5) * 4 * L];
        const a = windingOfFlat([q], p), b = centreWinding(q, p);
        n++;
        if (a === null || b === null) { nulls++; continue; }
        if (a !== b) { bad++; if (worst.length < 8) worst.push({ r, L, sweep, p, a, b }); }
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ n, bad, nulls, worst }));
    expect(bad).toBe(0);
});

test("WC-2 a lens of two arcs at r = 1e6: inside iff inside both circles", () => {
    const r = 1e6, d = 1.2e6;                                // two circles 2*d apart... overlapping lens
    const C1 = [-d / 2, 0], C2 = [d / 2, 0];
    // Intersections of the two circles
    const x = 0, y = Math.sqrt(r * r - (d / 2) * (d / 2));
    const P = [x, y], Q = [x, -y];
    // Lens boundary: arc of circle 1 from Q up to P on the right side... build both arcs from angles.
    const ang = (C, p) => Math.atan2(p[1] - C[1], p[0] - C[0]);
    const a1 = ang(C1, Q), b1 = ang(C1, P);                  // on C1, the lens side is towards +x: from Q (-th) to P (+th)
    const arc1 = { line: false, C: C1, r, a0: a1, sweep: wrap(b1 - a1), A: Q, B: P };
    const a2 = ang(C2, P), b2 = ang(C2, Q);
    const arc2 = { line: false, C: C2, r, a0: a2, sweep: wrap(b2 - a2), A: P, B: Q };
    const rnd = mulberry(11);
    let bad = 0, n = 0, nulls = 0;
    for (let i = 0; i < 5000; i++) {
        const p = [(rnd() - 0.5) * 1e6, (rnd() - 0.5) * 2e6];
        const inside = Math.hypot(p[0] - C1[0], p[1] - C1[1]) < r && Math.hypot(p[0] - C2[0], p[1] - C2[1]) < r;
        const w = windingOfFlat([arc1, arc2], p);
        n++;
        if (w === null) { nulls++; continue; }
        if ((w !== 0) !== inside) bad++;
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ n, bad, nulls, sweep1: arc1.sweep, sweep2: arc2.sweep }));
    expect(bad).toBe(0);
});

test("WC-3 huge radii, tile-sized pieces, points clear of the arc", () => {
    const rnd = mulberry(23);
    let n = 0, bad = 0, nulls = 0;
    const worst = [];
    for (let i = 0; i < 20000; i++) {
        const r = Math.pow(10, 8 + rnd() * 7);
        const L = Math.pow(10, 3 + rnd() * 2.2);            // 1e3 .. 1.6e5
        const sweep = (rnd() < 0.5 ? -1 : 1) * (L / r);       // a tile-sized piece of a huge circle
        const a0 = rnd() * TAU;
        const C = [r * Math.cos(a0 + Math.PI) + (rnd() - 0.5) * 1e5, r * Math.sin(a0 + Math.PI) + (rnd() - 0.5) * 1e5];
        const q = arcOf(C, r, a0, sweep);
        const Lr = Math.hypot(q.B[0] - q.A[0], q.B[1] - q.A[1]);
        if (!(r >= Lr)) continue;
        const mx = (q.A[0] + q.B[0]) / 2, my = (q.A[1] + q.B[1]) / 2;
        const p = [mx + (rnd() - 0.5) * 4 * Lr, my + (rnd() - 0.5) * 4 * Lr];
        // distance from p to the chord line, in units of L: skip the band where the centre form is not an oracle
        const ux = (q.B[0] - q.A[0]) / Lr, uy = (q.B[1] - q.A[1]) / Lr;
        const off = Math.abs((p[0] - mx) * uy - (p[1] - my) * ux);
        if (off < 1e-2 * Lr) continue;
        const a = windingOfFlat([q], p), b = centreWinding(q, p);
        n++;
        if (a === null || b === null) { nulls++; continue; }
        if (a !== b) { bad++; if (worst.length < 6) worst.push({ r, L: Lr, sweep, p, a, b, A: q.A, B: q.B }); }
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ n, bad, nulls, worst }));
    expect(bad).toBe(0);
});

test("WC-4 points far from the arc, rays that mostly miss it", () => {
    const rnd = mulberry(99);
    let n = 0, bad = 0, nulls = 0;
    const worst = [];
    for (let i = 0; i < 40000; i++) {
        const r = Math.pow(10, 1 + rnd() * 13);
        const L = Math.min(r, Math.pow(10, rnd() * 5));
        const sweep = (rnd() < 0.5 ? -1 : 1) * 2 * Math.asin(Math.min(1, L / (2 * r)));
        const a0 = rnd() * TAU;
        const C = [(rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000];
        const q = arcOf(C, r, a0, sweep);
        const Lr = Math.hypot(q.B[0] - q.A[0], q.B[1] - q.A[1]);
        if (!(r >= Lr) || !(Lr > 0)) continue;
        const mx = (q.A[0] + q.B[0]) / 2, my = (q.A[1] + q.B[1]) / 2;
        const far = Math.pow(10, rnd() * 2.5);                 // 1 .. 300 chords away
        const p = [mx + (rnd() - 0.5) * 2 * far * Lr, my + (rnd() - 0.5) * 2 * far * Lr];
        const ux = (q.B[0] - q.A[0]) / Lr, uy = (q.B[1] - q.A[1]) / Lr;
        const off = Math.abs((p[0] - mx) * uy - (p[1] - my) * ux);
        if (off < 1e-2 * Lr + r * 1e-13) continue;            // the band where the centre form stops being an oracle
        const a = windingOfFlat([q], p), b = centreWinding(q, p);
        n++;
        if (a === null || b === null) { nulls++; continue; }
        if (a !== b) { bad++; if (worst.length < 6) worst.push({ r, L: Lr, sweep, p, a, b, A: q.A, B: q.B, C }); }
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ n, bad, nulls, worst }));
    expect(bad).toBe(0);
});
