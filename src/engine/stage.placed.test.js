/* global BigInt */
/**
 * PLAN §3 row 5: the placed read equals the numeric table (A2-scene.md §6.4). Random natives at random
 * homes with random snapped tables (entries at depths 0–4), seen from a camera frame one to three
 * crossings above or below the home. Every vertex of every item the Stage holds for the native, drawn
 * (`placed`: geometry plus offset), lies within 1e-9 of the frame's units of a stored corner carried
 * exactly — the lattice chain plus the table's translation Σ below[k]·R^(D−hd−k), in BigInt dyadic
 * arithmetic, rounded once; `placeNative`'s `fromStored` lands on the same points, and its `toStored`
 * takes each back to within 1e-9 of the exact inverse of that (rounded) point, in the home's units.
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import { snapDisplacement } from "./geometry/offsets";
import { R, W, G } from "./frameLattice";

useEngines();

const TWO = BigInt(2);
const SCALE = 400;                                   // fixed point: value = n / 2^SCALE
/** A double as an exact fixed-point BigInt. */
function big(x) {
    if (x === 0) return BigInt(0);
    let m = x, e = 0;
    while (!Number.isInteger(m)) { m *= 2; e++; }
    return BigInt(m) * TWO ** BigInt(SCALE - e);
}
/** Rounded once, to the nearest double. */
const num = (n) => Number(n) / 2 ** SCALE;
const BR = BigInt(R);

/** A home point carried exactly through the lattice chain from `from` to `to`. */
function exactMap(lm, p, from, to) {
    const path = lm.framePath(from, to);
    let x = p[0], y = p[1];
    for (const id of path.up) { const c = lm.frame(id).centre; x = x / BR + big(c.x); y = y / BR + big(c.y); }
    for (const id of path.down) { const c = lm.frame(id).centre; x = (x - big(c.x)) * BR; y = (y - big(c.y)) * BR; }
    return [x, y];
}

function lcg(seed) {
    let s = (seed >>> 0) & 0x7fffffff;
    return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** The vertices a piece draws, in its own numbers. */
function verticesOf(g) {
    const out = [];
    if (g.loops) for (const l of g.loops) for (let k = 0; k < l.length; k++) { const pc = l.at(k); out.push(pc.A, pc.B); }
    if (g.polys) for (const r of g.polys) for (const p of r) out.push(p);
    if (g.pts) for (const p of g.pts) out.push(p);
    return out;
}

/**
 * One case: a native at home `hd` with a random table, the camera `dd` levels below (dd > 0) or
 * above (dd < 0) it on the frame that holds its picture. Returns the counts it checked.
 */
function runCase(rnd, hd, dd) {
    const E = mkEngine(800, 600);
    const lm = E.lm;
    lm.ensureSpine(hd);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    // The home: the spine frame or one a cell or two off it, digits well inside the balanced range.
    let home = lm.spineAt(hd);
    if (rnd() < 0.5 && hd > 0) home = lm.cellChild(lm.frame(home).parent, ri(-1200, 1200), ri(-1200, 1200)).id;
    // The table: entries at depths 0–4, snapped; its home-level translation stays under W/4 (no home carry).
    const below = [];
    for (let k = 0; k <= 4; k++) {
        if (rnd() < 0.45) continue;
        const lim = k === 0 ? W / 8 : W / 2 - 1;
        below[k] = [snapDisplacement((rnd() * 2 - 1) * lim), snapDisplacement((rnd() * 2 - 1) * lim)];
    }
    // The picture's size at the camera: a few hundred units below the home, a stroke's worth above it.
    const size = dd >= 0 ? 400 / Math.pow(R, dd) : W / 4;
    const x0 = (rnd() * 2 - 1) * W / 8, y0 = (rnd() * 2 - 1) * W / 8;
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), color: "#123", opacity: 1, w: 1,
        loops: rectLoop({ left: x0, top: y0, right: x0 + size, bottom: y0 + size * 0.75 }) };
    E.doc.add(o, home);
    if (below.length) E.doc.setOffsetsById(o.id, below);
    // The picture's corners in home units, exactly: stored + T(0), T(0) = Σ below[k] · R^-k.
    let tx = BigInt(0), ty = BigInt(0);
    below.forEach((e, k) => { if (e) { tx += big(e[0]) / BR ** BigInt(k); ty += big(e[1]) / BR ** BigInt(k); } });
    const corners = [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size * 0.75], [x0, y0 + size * 0.75]].map((p) => [big(p[0]) + tx, big(p[1]) + ty]);
    // The camera frame: an ancestor above, the home, or the chain of cells holding the picture below.
    let F = home;
    if (dd < 0) for (let k = 0; k < -dd; k++) F = lm.frame(F).parent || lm.ensureParent(F);
    const c0 = [(corners[0][0] + corners[2][0]) / TWO, (corners[0][1] + corners[2][1]) / TWO];
    let at = c0;
    for (let k = 0; k < dd; k++) {
        const i = Math.round(num(at[0]) / G), j = Math.round(num(at[1]) / G);
        F = lm.cellChild(F, i, j).id;
        at = exactMap(lm, at, lm.frame(F).parent, F);
    }
    const D = lm.depthOf(F);
    const ref = corners.map((p) => exactMap(lm, p, home, F));
    const refN = ref.map((p) => [num(p[0]), num(p[1])]);
    const cx = (refN[0][0] + refN[2][0]) / 2, cy = (refN[0][1] + refN[2][1]) / 2;
    const span = Math.max(1e-12, refN[2][0] - refN[0][0]);
    const s = Math.min(200, Math.max(1, 300 / span));
    E.cam.set({ frame: F, activeLevel: D, inScale: s, inPanX: 400 - cx * s, inPanY: 300 - cy * s });
    E._render();
    const S = E.stage;
    const items = S.itemsOf(o.id);
    let vertices = 0, onClip = 0, worst = 0, rerouted = 0;
    for (const it of items) {
        const { geom, off } = S.placed(it);
        if (it.grp != null) rerouted++;
        const c = geom.clip;
        for (const v of verticesOf(geom)) {
            // A vertex the tile's clip made lies on the clip's edge, in the piece's own numbers.
            if (c && (Math.abs(v[0] - c.left) < 1e-9 || Math.abs(v[0] - c.right) < 1e-9 || Math.abs(v[1] - c.top) < 1e-9 || Math.abs(v[1] - c.bottom) < 1e-9)) { onClip++; continue; }
            const x = v[0] + off[0], y = v[1] + off[1];
            let best = Infinity;
            for (const r of refN) best = Math.min(best, Math.hypot(x - r[0], y - r[1]));
            worst = Math.max(worst, best);
            vertices++;
        }
    }
    // placeNative both ways: `fromStored` onto the frame's exact points; `toStored` of those points (as
    // doubles) onto their exact inverse, in the units of the coarser of the two frames (the finer one's
    // numbers cannot resolve more than the coarser one holds).
    const pl = S.placeNative(o, F);
    let back = 0;
    corners.forEach((c, k) => {
        const stored = [x0 + (k === 1 || k === 2 ? size : 0), y0 + (k >= 2 ? size * 0.75 : 0)];
        const f = pl.fromStored(stored);
        worst = Math.max(worst, Math.hypot(f[0] - refN[k][0], f[1] - refN[k][1]));
        const t = pl.toStored(refN[k]);
        const inv = exactMap(lm, [big(refN[k][0]), big(refN[k][1])], F, home);
        const coarse = D < lm.depthOf(home) ? Math.pow(R, D - lm.depthOf(home)) : 1;
        back = Math.max(back, Math.hypot(t[0] - num(inv[0] - tx), t[1] - num(inv[1] - ty)) * coarse);
    });
    return { items: items.length, vertices, onClip, worst, back, rerouted, D, hd };
}

describe("placed() equals the numeric table (PLAN §3 row 5)", () => {
    for (const seed of [1, 2, 3, 4]) {
        test("seed " + seed + ": 30 natives, one to three crossings either side of the home", () => {
            const rnd = lcg(seed * 104729 + 3);
            let cases = 0, withItems = 0, vertices = 0, onClip = 0, rerouted = 0, worst = 0, back = 0;
            for (let n = 0; n < 30; n++) {
                const hd = 1 + Math.floor(rnd() * 2);
                const dd = [-2, -1, 0, 1, 2, 3][Math.floor(rnd() * 6)];
                const r = runCase(rnd, hd, dd);
                cases++;
                if (r.items) withItems++;
                vertices += r.vertices; onClip += r.onClip; rerouted += r.rerouted;
                worst = Math.max(worst, r.worst); back = Math.max(back, r.back);
            }
            expect(worst).toBeLessThan(1e-9);
            expect(back).toBeLessThan(1e-9);
            // Not vacuous: most natives are in the table, and some are drawn from moved tiles.
            expect(withItems).toBeGreaterThanOrEqual(cases * 0.8);
            expect(vertices).toBeGreaterThan(cases * 4);
            expect(onClip).toBeLessThan(vertices / 10);
            expect(rerouted).toBeGreaterThan(0);
        });
    }
});
