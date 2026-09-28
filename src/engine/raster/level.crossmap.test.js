/* global BigInt */
/**
 * level.crossmap.test.js — PLAN §3's row "the pyramid's crossing mapping is exact", A3 §1.6's seven steps:
 * (1) a seeded random lattice minted with `cellChild` (digits at both extremes of [−2048, 2047]) and its
 * lateral neighbours, a subtree re-addressed half way; (2) random frame pairs with `framePath` of at most
 * three steps, S ∈ {1, 2, 3}, a level of the first frame's own pyramid, a plate within 2^20 of the origin;
 * (3) the mapped level; (4) the plate's box through the lattice's own affine (`LevelMap.mapRectF`) lands on
 * the mapped plate to the bit wherever that float arithmetic is exact, and through the same affine in exact
 * BigInt arithmetic everywhere; (5) the round trip; (6) the refusals, where the affine is indeed not a
 * plate; (7) after `readdress` the map follows the new address. Then the rest of `level.js`.
 */
import LevelMap from "../LevelMap";
import { ENTER, BASE, EXIT } from "../frameLattice";
import {
    LEVEL_STEPS, LEVEL_HYST, SIGMA_MIN, VIEW_PLATES_MAX, zOf, levelFor, stretchBand, viewPlates, sigmaMinFor,
    levelKey, restKey, planeKey, mapCell, coarser, ownFloor, stepMapsFrames,
} from "./level";
import { lcg } from "../__testkit__/rasterLists";

const P = 512;
const big = (v) => BigInt(v);
const eq = (a, b) => String(a) === String(b);                     // an index may be a Number or a BigInt
const newLattice = () => new LevelMap({ enter: ENTER, base: BASE, exit: EXIT }, 1504, 812);

/** Step 1: a lattice minted at random, digits at both ends of the range, and lateral neighbours. */
function mint(seed) {
    const rnd = lcg(seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const lm = newLattice();
    const frames = ["0"];
    const digit = () => { const r = rnd(); return r < 0.1 ? -2048 : r < 0.2 ? 2047 : r < 0.4 ? ri(-3, 3) : ri(-2048, 2047); };
    for (let n = 0; n < 400; n++) {
        const p = lm.frame(frames[ri(0, frames.length - 1)]);
        if (!p || p.depth >= 6) continue;
        const c = lm.cellChild(p.id, digit(), digit());
        if (c && !frames.includes(c.id)) frames.push(c.id);
    }
    for (let n = 0; n < 80; n++) {
        const nb = lm.neighbour(frames[ri(1, frames.length - 1)], ri(-1, 1), ri(-1, 1));
        if (nb && !frames.includes(nb.id)) frames.push(nb.id);
    }
    return { lm, frames, ri };
}

/**
 * The lattice's affine in exact arithmetic: a plate corner i·512/2^(ℓS) of A as a BigInt times 2^−D,
 * taken up (x/R + ci·G) and down ((x − ci·G)·R) through the frame path as `LevelMap.mapPointF` takes it.
 */
const D = 160;
function exactCorner(lm, A, B, i, l, S) {
    const path = lm.framePath(A, B);
    let x = big(i) << big(9 - l * S + D);
    for (const id of path.up) x = (x >> big(12)) + (big(lm.frame(id).cell.i) << big(5 + D));
    for (const id of path.down) x = (x - (big(lm.frame(id).cell.i) << big(5 + D))) << big(12);
    return x;
}
/** The same for the j axis. */
function exactCornerJ(lm, A, B, j, l, S) {
    const path = lm.framePath(A, B);
    let y = big(j) << big(9 - l * S + D);
    for (const id of path.up) y = (y >> big(12)) + (big(lm.frame(id).cell.j) << big(5 + D));
    for (const id of path.down) y = (y - (big(lm.frame(id).cell.j) << big(5 + D))) << big(12);
    return y;
}
/** A point (times 2^−D, in B's units) as a plate coordinate of B's grid at level lB; null if not an integer. */
function plateOf(x, lB, S) {
    const e = big(D + 9 - lB * S);
    const q = x >> e;
    return (q << e) === x ? q : null;
}

/** Steps 2–6 over `pairs` random pairs: the counts, and the first failures. */
function checkPairs(lm, frames, ri, pairs) {
    const out = { checked: 0, floatExact: 0, floatRounded: 0, roundedUnpredicted: 0, bigIndices: 0, refusedCoarse: 0, failures: [] };
    const fail = (what) => { if (out.failures.length < 5) out.failures.push(what); };
    // B within three crossings of A: up to three steps up, then down through random kids.
    const near = (A) => {
        let B = A, left = 3;
        for (let u = ri(0, 3); u > 0 && lm.frame(B).parent != null; u--, left--) B = lm.frame(B).parent;
        for (let d = ri(0, left); d > 0; d--) { const kids = lm.childrenOf(B); if (!kids.length) break; B = kids[ri(0, kids.length - 1)].id; }
        return B;
    };
    for (let n = 0; n < pairs; n++) {
        const A = frames[ri(0, frames.length - 1)], B = near(A);
        const path = lm.framePath(A, B);
        if (!path || path.up.length + path.down.length > 3) continue;
        const S = LEVEL_STEPS[ri(0, LEVEL_STEPS.length - 1)];
        const lA = ri(ownFloor(S), Math.floor(12 / S));             // ℓA·S ≥ −8 and Z(ℓA) ≤ 2^12
        const i = ri(-(2 ** 20), 2 ** 20), j = ri(-(2 ** 20), 2 ** 20);
        const lB = lA + (12 * (lm.depthOf(A) - lm.depthOf(B))) / S;
        const m = mapCell(lm, S, A, lA, i, j, B);
        if (lB * S < -8) {                                        // step 6: coarser than B's own levels
            if (m !== null) fail({ step: 6, A, B, S, lA, m });
            out.refusedCoarse++;
            continue;
        }
        if (!m) { fail({ step: 2, A, B, S, lA, i, j }); continue; }
        out.checked++;
        if (m.level !== lB) fail({ step: 3, A, B, S, lA, got: m.level, want: lB });
        // Step 4, exactly: both corners land on B's grid at (m.i, m.j) and (m.i + 1, m.j + 1).
        const want = [plateOf(exactCorner(lm, A, B, i, lA, S), lB, S), plateOf(exactCornerJ(lm, A, B, j, lA, S), lB, S),
            plateOf(exactCorner(lm, A, B, i + 1, lA, S), lB, S), plateOf(exactCornerJ(lm, A, B, j + 1, lA, S), lB, S)];
        const got = [m.i, m.j, big(m.i) + big(1), big(m.j) + big(1)];
        if (!want.every((w, k) => w !== null && eq(w, got[k]))) fail({ step: 4, A, B, S, lA, i, j, got: got.map(String), want: want.map(String) });
        // Step 4 in the lattice's own floats, to the bit wherever they are exact. They may round only where
        // the path's top level passes ℓS = 45 (a plate's lowest bit 2^(9 − ℓS) under a digit's 2^16 is then
        // past 53 bits) or where an index passes 2^53.
        const ZA = zOf(lA, S), ZB = zOf(lB, S);
        const r = lm.mapRectF({ left: (i * P) / ZA, top: (j * P) / ZA, right: ((i + 1) * P) / ZA, bottom: ((j + 1) * P) / ZA }, A, B);
        const f = [(r.left * ZB) / P, (r.top * ZB) / P, (r.right * ZB) / P, (r.bottom * ZB) / P];
        const safe = typeof m.i === "number" && typeof m.j === "number";
        if (!safe) out.bigIndices++;
        if (safe && f[0] === m.i && f[1] === m.j && f[2] === m.i + 1 && f[3] === m.j + 1 && (lm.frameFactor(A, B) * ZB) / ZA === 1) out.floatExact++;
        else {
            out.floatRounded++;
            if (safe && (lA + (12 * path.up.length) / S) * S <= 45) { out.roundedUnpredicted++; fail({ step: "4f", A, B, S, lA, i, j, f, m }); }
        }
        // Step 5: the round trip.
        const back = mapCell(lm, S, B, m.level, m.i, m.j, A);
        if (!back || back.level !== lA || !eq(back.i, i) || !eq(back.j, j)) fail({ step: 5, A, B, S, lA, i, j, back });
    }
    return out;
}

describe("the pyramid's crossing map is exact (PLAN §3; A3 §1.6)", () => {
    test("steps 1–5 on a random lattice, and step 7: a subtree re-addressed half way, which the map follows", () => {
        const { lm, frames, ri } = mint(12345);
        expect(frames.length).toBeGreaterThan(300);
        const first = checkPairs(lm, frames, ri, 1500);

        // Step 7: a frame with kids moves to an empty cell of its parent.
        const X = frames.find((id) => { const f = lm.frame(id); return f.depth >= 2 && lm.childrenOf(id).length > 0; });
        const fx = lm.frame(X), Pid = fx.parent, was = { ...fx.cell };
        expect(mapCell(lm, 1, X, 3, 7, -9, Pid)).toEqual({ level: 15, i: 7 + was.i * 2 ** 11, j: -9 + was.j * 2 ** 11 });
        let to = null;
        for (let k = 1; k < 100 && !to; k++) {
            const c = { i: ((was.i + 2048 + 37 * k) % 4096) - 2048, j: was.j };
            if (!lm.findCellChild(Pid, c.i, c.j)) to = c;
        }
        expect(lm.readdress(X, Pid, to.i, to.j)).toBe(fx);
        const after = mapCell(lm, 1, X, 3, 7, -9, Pid);
        expect(after).toEqual({ level: 15, i: 7 + to.i * 2 ** 11, j: -9 + to.j * 2 ** 11 });
        const r = lm.mapRectF({ left: (7 * P) / 8, top: (-9 * P) / 8, right: (8 * P) / 8, bottom: (-8 * P) / 8 }, X, Pid);
        expect([(r.left * 2 ** 15) / P, (r.top * 2 ** 15) / P, (r.right * 2 ** 15) / P]).toEqual([after.i, after.j, after.i + 1]);
        // What is under X follows it: a kid's plate reaches the parent through X's new address.
        const kid = lm.childrenOf(X)[0].id;
        const viaX = mapCell(lm, 1, kid, -2, 3, 4, X);
        expect(mapCell(lm, 1, kid, -2, 3, 4, Pid)).toEqual(mapCell(lm, 1, X, viaX.level, viaX.i, viaX.j, Pid));

        const second = checkPairs(lm, frames, ri, 1500);
        for (const o of [first, second]) {
            expect(o.failures).toEqual([]);
            expect(o.roundedUnpredicted).toBe(0);
        }
        expect(first.checked + second.checked).toBeGreaterThan(1000);
        expect(first.floatExact + second.floatExact).toBeGreaterThan(700);
        expect(first.refusedCoarse + second.refusedCoarse).toBeGreaterThan(20);
    });

    test("step 6: refused for a step that does not divide 12, and for a level coarser than a frame keeps, where the affine is not a plate", () => {
        const lm = newLattice();
        const C = lm.cellChild("0", 3, -5).id;                      // odd digits: a half-plate offset at ℓS = −9
        const Gc = lm.cellChild(C, 1, 2).id;
        for (const [A, B, up] of [[C, "0", 1], [Gc, "0", 2], ["0", Gc, -2], [C, C, 0]]) {
            expect(mapCell(lm, 5, A, 2, 0, 0, B)).toBeNull();
            if (up) expect(Number.isInteger((2 * 5 + 12 * up) / 5)).toBe(false);   // no level of B's S = 5 pyramid
        }
        expect(stepMapsFrames(5)).toBe(false);
        expect([4, 6, 12].map(stepMapsFrames)).toEqual([true, true, true]);      // the arithmetic allows them; the lever offers 1, 2, 3
        expect(mapCell(lm, 4, C, 0, 0, 0, "0")).toEqual({ level: 3, i: 3 * 2 ** 8, j: -5 * 2 ** 8 });
        // ℓS = −9: C's plate is half a plate off the parent's grid.
        expect(mapCell(lm, 1, C, -9, 10, 10, "0")).toBeNull();
        const r = lm.mapRectF({ left: 10 * P * 2 ** 9, top: 10 * P * 2 ** 9, right: 11 * P * 2 ** 9, bottom: 11 * P * 2 ** 9 }, C, "0");
        expect([(r.left * 2 ** 3) / P, (r.top * 2 ** 3) / P]).toEqual([11.5, 7.5]);
        // Down into C at a level that would land at ℓS = −9 in C.
        expect(mapCell(lm, 1, "0", 3, 0, 0, C)).toBeNull();
        expect(mapCell(lm, 2, C, -5, 0, 0, "0")).toBeNull();          // S = 2: ℓS = −10
        expect(mapCell(lm, 2, C, -4, 0, 0, "0")).toEqual({ level: 2, i: 3, j: -5 });
    });

    test("an index past 2^53 comes back as a BigInt, exact, and maps back", () => {
        const lm = newLattice();
        const C = lm.cellChild("0", 2047, -2048).id, Gc = lm.cellChild(C, 2047, 5).id;
        const m = mapCell(lm, 3, Gc, 4, 1, 2, "0");                  // up two crossings from ℓS = 12: offsets 2^20 and 2^32 plates a digit
        expect(m.level).toBe(12);
        expect(typeof m.i).toBe("number");
        const deep = mapCell(lm, 1, Gc, 30, 1, 2, "0");               // ℓS 30 → 42: offsets 2^38 and 2^50 plates a digit
        expect(deep.level).toBe(54);
        expect(typeof deep.i).toBe("bigint");
        expect(deep.i).toBe(big(1) + big(2047) * (big(1) << big(38)) + big(2047) * (big(1) << big(50)));
        expect(deep.j).toBe(big(2) + big(5) * (big(1) << big(38)) - big(2048) * (big(1) << big(50)));
        expect(mapCell(lm, 1, "0", deep.level, deep.i, deep.j, Gc)).toEqual({ level: 30, i: 1, j: 2 });
    });
});

describe("the rest of level.js: the view's level, its stretch, plates a screen needs, keys, coarser", () => {
    test("levelFor puts σ = Z / Z(ℓ) in [σmin, σmin·2^S), and at S = 1 that is the nearest level", () => {
        const rnd = lcg(7);
        for (let n = 0; n < 2000; n++) {
            const S = LEVEL_STEPS[n % 3], Z = 2 ** (rnd() * 40 - 20);
            const l = levelFor(Z, S), s = Z / zOf(l, S);
            expect(s >= SIGMA_MIN * (1 - 1e-12) && s < SIGMA_MIN * 2 ** S * (1 + 1e-12)).toBe(true);
            if (S === 1) expect(l).toBe(Math.round(Math.log2(Z)) + 0);   // + 0: Math.round gives −0 just below 0
        }
        expect(stretchBand(2)).toEqual([SIGMA_MIN, SIGMA_MIN * 4]);
        expect(levelFor(0, 1)).toBe(0);
        expect(levelFor(NaN, 2, 5)).toBe(5);
    });

    test("the level is kept while σ stays within 1/8 octave past the band, and changes past it", () => {
        for (const S of LEVEL_STEPS) {
            const l = 3, lo = zOf(l, S) * SIGMA_MIN, hi = lo * 2 ** S;   // the band's edges in Z
            expect(levelFor(hi * 2 ** (LEVEL_HYST * 0.9), S, l)).toBe(l);
            expect(levelFor(hi * 2 ** (LEVEL_HYST * 1.1), S, l)).toBe(l + 1);
            expect(levelFor(lo * 2 ** (-LEVEL_HYST * 0.9), S, l)).toBe(l);
            expect(levelFor(lo * 2 ** (-LEVEL_HYST * 1.1), S, l)).toBe(l - 1);
            expect(levelFor(hi * 2 ** (LEVEL_HYST * 0.9), S)).toBe(l + 1);          // without a level in force, no hysteresis
        }
    });

    test("plates a screen needs (A3 E3): Kobin's desktop 40 and the phone 35 at the band's edge, today's quanta 24; σmin per screen", () => {
        const edge = SIGMA_MIN * 2 ** -LEVEL_HYST;
        expect(viewPlates(edge, 2256, 1218)).toBe(40);
        expect(viewPlates(edge, 1079, 1969)).toBe(35);
        expect(viewPlates(1, 2256, 1218)).toBe(24);
        expect(viewPlates(2 ** 0.5, 5120, 2880)).toBe(45);
        expect(sigmaMinFor(2256, 1218)).toBe(SIGMA_MIN);
        expect(sigmaMinFor(1079, 1969)).toBe(SIGMA_MIN);
        expect(sigmaMinFor(2560, 1440)).toBe(1);
        expect(viewPlates(2 ** -LEVEL_HYST, 2560, 1440)).toBeLessThanOrEqual(VIEW_PLATES_MAX);
        expect(sigmaMinFor(5120, 2880)).toBe(2 ** 0.5);
    });

    test("the keys carry the frame, the level and its step (or the exact zoom), the layer and the cell", () => {
        expect(levelKey("1/3,-2", -4, 2, 5, -7)).toBe("1/3,-2|L-4s2|5,-7");
        expect(levelKey("0", 3, 1, 0, 0)).not.toBe(levelKey("0", 3, 2, 0, 0));
        expect(restKey("0", 3.37, 1, 2)).toBe("0|R3.37|1,2");
        const Z = 3.37, Z2 = 3.37 + 2 ** -51;                          // one ulp apart: two rest sets
        expect(restKey("0", Z, 0, 0)).not.toBe(restKey("0", Z2, 0, 0));
        expect(planeKey("2", 1.5, "SEL0", 0, -1)).toBe("2|P1.5|SEL0|0,-1");
    });

    test("coarser: the plate k levels up that holds the plate, in the frame's own levels and then its parent's", () => {
        const { lm, frames, ri } = mint(4242);
        expect(coarser(lm, 1, "0", 3, 13, -5, 2)).toEqual({ frame: "0", level: 1, i: 3, j: -2 });
        expect(coarser(lm, 1, "0", 3, 13, -5, 0)).toEqual({ frame: "0", level: 3, i: 13, j: -5 });
        expect(coarser(lm, 1, "0", -9, 0, 0, 1)).toBeNull();          // not a level of "0"
        const hasAncestors = (F, u) => { let f = lm.frame(F); for (let n = 0; n < u && f; n++) f = f.parent != null ? lm.frame(f.parent) : null; return !!f; };
        let crossed = 0, checked = 0;
        for (let n = 0; n < 1500; n++) {
            const F = frames[ri(1, frames.length - 1)], S = LEVEL_STEPS[ri(0, 2)];
            const l = ri(ownFloor(S), Math.floor(8 / S)), k = ri(1, Math.ceil(16 / S));
            const i = ri(-5000, 5000), j = ri(-5000, 5000);
            const c = coarser(lm, S, F, l, i, j, k);
            const ups = l - k < ownFloor(S) ? Math.ceil((ownFloor(S) - (l - k)) / (12 / S)) : 0;
            if (!c) { expect(hasAncestors(F, ups)).toBe(false); continue; }   // the lattice's root has no parent
            let up = F;
            for (let n2 = 0; n2 < ups; n2++) up = lm.frame(up).parent;
            expect(c.frame).toBe(up);                                   // as few crossings up as the level needs
            if (c.frame !== F) crossed++;
            // The coarser plate holds the plate: its box, mapped into c.frame, lies inside c's cell.
            const ZA = zOf(l, S), ZC = zOf(c.level, S);
            const r = lm.mapRectF({ left: (i * P) / ZA, top: (j * P) / ZA, right: ((i + 1) * P) / ZA, bottom: ((j + 1) * P) / ZA }, F, c.frame);
            const box = [(r.left * ZC) / P, (r.top * ZC) / P, (r.right * ZC) / P, (r.bottom * ZC) / P];
            const ci = Number(c.i), cj = Number(c.j);
            expect(box[0] >= ci && box[2] <= ci + 1 && box[1] >= cj && box[3] <= cj + 1).toBe(true);
            expect(c.level).toBe(l - k + (12 / S) * (lm.depthOf(F) - lm.depthOf(c.frame)));
            checked++;
        }
        expect(checked).toBeGreaterThan(1000);
        expect(crossed).toBeGreaterThan(200);
    });
});
