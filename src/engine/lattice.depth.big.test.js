/**
 * BIG — depths past 2^53 (docs/reference/depth-overflow-design-2026-11-13.md). A depth is a Deep there (depth.js), and
 * nothing below a frame's record knows its depth: a lattice D0 levels down answers every question as the same lattice at
 * the top, its depths D0 more, bit for bit. A run straddling 2^53, stretch names, move tables and the file keep their
 * depths exact.
 */
import LevelMap, { frameCode } from "./LevelMap";
import { BASE, ENTER, EXIT } from "./frameLattice";
import { add, sub, gt, ge, neg, isDepth, isBig, parse } from "./depth";
import { addOffset, shiftAt, encodeBelow, decodeBelow, shiftDown, shiftUp, eachDigit } from "./geometry/offsets";

const CFG = { base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 };
const mk = (runs = true) => { const M = new LevelMap(CFG, 800, 600); M.bulkRuns = runs; return M; };
const deep = (s) => parse(s);
const P53 = deep("9007199254740992"), P60 = deep("1152921504606846976"), P64 = deep("18446744073709551616");
const GOOGOL = deep(`1${"0".repeat(100)}`);
// Numbers as text (-0 kept); a Deep is its digits (toJSON): equal text is equal bits.
const bits = (v) => JSON.stringify(v, (k, x) => (typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : x));
const expectSame = (b, a) => expect(bits(b)).toBe(bits(a));
/** Every frame's depth in its one form, and exactly its parent's plus its run plus one. */
const depthsExact = (M) => {
    for (const f of M.frames.values()) {
        if (!isDepth(f.depth)) return `frame ${f.id}: depth ${String(f.depth)} not in its one form`;
        const p = f.parent != null ? M.frames.get(f.parent) : null;
        if (p && f.depth !== add(add(p.depth, f.run ? f.run.n : 0), 1)) return `frame ${f.id}: depth ${f.depth} under ${p.id} at ${p.depth}`;
        if (f.run && (!isDepth(f.run.n) || !ge(f.run.n, 1))) return `frame ${f.id}: run ${String(f.run.n)}`;
    }
    return null;
};
/** The frame `cells` ([[i, j, n], …]) below `top`, minted as runs where it can be. */
const grow = (M, top, cells) => M.frameAtChain(top, cells.map(([i, j, n]) => ({ i, j, n }))).id;

// Stretches, a branch off the middle of one, a spine stretch, an edge cell and a short side chain.
const SHAPE = [
    [[12, -5, 1], [1638, 0, 3000]],
    [[12, -5, 1], [1638, 0, 1500], [-2, 3, 1], [44, 44, 50]],
    [[0, 0, 70]],
    [[2047, -2048, 3]],
    [[-100, 7, 2], [3, 3, 1]],
];

describe.each([[2 ** 53 - 40], [add(P53, 7)], [P64], [GOOGOL], [neg(GOOGOL)]])("BIG-1 — a lattice %s levels down", (D0) => {
    test("answers as the same lattice at the top: depths D0 more, every map and factor to the bit, the file too", () => {
        const A = mk(), B = mk();
        const sa = A.ensureSpine(0), sb = B.ensureSpine(D0);
        expect(B.depthOf(sb)).toBe(D0);
        const ea = [sa, ...SHAPE.map((c) => grow(A, sa, c))], eb = [sb, ...SHAPE.map((c) => grow(B, sb, c))];
        expect(depthsExact(B)).toBeNull();
        expect(B.frames.size).toBeLessThan(40);
        for (let x = 0; x < ea.length; x++) {
            expect(B.depthOf(eb[x])).toBe(add(A.depthOf(ea[x]), D0));
            expectSame(B.chainSegs(sb, eb[x]), A.chainSegs(sa, ea[x]));
            for (let y = 0; y < ea.length; y++) {
                for (const p of [[0, 0], [65535.5, -65536], [1, 1], [-3.25, 1e-9]]) expectSame(B.mapPointF(p, eb[x], eb[y]), A.mapPointF(p, ea[x], ea[y]));
                expectSame(B.frameFactor(eb[x], eb[y]), A.frameFactor(ea[x], ea[y]));
            }
        }
        // the file: a big depth is its digits, and a load reads back the same lattice
        const data = JSON.parse(JSON.stringify(B.serialize()));
        const big = [...B.frames.values()].some((f) => isBig(f.depth));
        expect(big).toBe(isBig(D0) || gt(D0, 2 ** 53 - 3100));   // 2^53 − 40: its stretches run past 2^53
        expect(data.frames.some((f) => typeof f.depth === "string")).toBe(big);
        const C = mk();
        C.load(data);
        expect(depthsExact(C)).toBeNull();
        for (let x = 0; x < eb.length; x++) {
            expect(C.depthOf(eb[x])).toBe(B.depthOf(eb[x]));
            for (const p of [[0, 0], [65535.5, -65536]]) expectSame(C.mapPointF(p, eb[x], sb), B.mapPointF(p, eb[x], sb));
        }
    });
});

describe("BIG-2 — a run that straddles 2^53", () => {
    test("each level unfolds at its exact depth, named by it, and the file keeps them", () => {
        const M = mk(), D = add(P53, 10);
        const K = M.frame(M.ensureSpine(D));
        expect(K.depth).toBe(D);
        expect(K.run.n).toBe(sub(D, 1));
        for (const d of [2 ** 53 - 1, P53, add(P53, 1), 5, add(P53, 9), 2 ** 53 - 2]) {
            const id = M.ensureSpine(d);
            expect(id).toBe(String(d));
            expect(M.depthOf(id)).toBe(d);
            expect(M.pathFrameAt(K.id, d)).toBe(id);
        }
        expect(depthsExact(M)).toBeNull();
        expect(M.frame(String(2 ** 53 - 1)).depth).toBe(2 ** 53 - 1);   // a Number below 2^53, a Deep from it
        expect(isBig(M.frame(String(P53)).depth)).toBe(true);
        const data = JSON.parse(JSON.stringify(M.serialize()));
        expect(data.frames.find((f) => f.id === String(P53)).depth).toBe("9007199254740992");
        expect(data.frames.find((f) => f.id === String(2 ** 53 - 1)).depth).toBe(2 ** 53 - 1);
        const C = mk();
        C.load(data);
        expect(depthsExact(C)).toBeNull();
        expect(C.depthOf(String(add(P53, 1)))).toBe(add(P53, 1));
        expect(C.spineAt(add(P53, 9))).toBe(String(add(P53, 9)));
    });

    test("a stretch of 2^60 levels is one frame; its levels are named and found by their digits", () => {
        const M = mk();
        const T = M.cellChild("0", 5, 7);
        const X = M.frame(grow(M, T.id, [[5, 7, P60]]));
        const code = frameCode("0");
        expect(X.depth).toBe(add(T.depth, P60));
        expect(X.id).toBe(`s${code}:5,7*${add(P60, 1)}`);
        expect(M.frames.size).toBeLessThan(5);
        const mid = M.ensureId(`s${code}:5,7*${deep("36028797018963968")}`);   // level 2^55 of the stretch below "0"
        expect(mid.depth).toBe(deep("36028797018963968"));
        expect(M.depthOf(X.id)).toBe(add(P60, 1));
        expect(depthsExact(M)).toBeNull();
        expect(M.chainSegs("0", X.id)).toEqual([{ i: 5, j: 7, n: add(P60, 1) }]);
    });
});

describe("BIG-3 — a move table keyed past 2^53", () => {
    // The same displacement 2^60 levels below the home and 5 levels below: the same table, its depths 2^60 − 5 apart.
    const K = P60, k = 5, gap = sub(P60, 5);
    const dump = (T, off = 0) => {
        const out = [];
        eachDigit({ digits: T }, (m, d) => out.push([String(sub(m, off)), d[0], d[1]]));
        return out;
    };
    test("add, carry, read at a level, shift down and up, and the file", () => {
        const big = addOffset([], K, 70000.5, -2.25), small = addOffset([], k, 70000.5, -2.25);
        expect([big.cellX, big.cellY]).toEqual([small.cellX, small.cellY]);
        expect(encodeBelow(big.below)).toEqual(encodeBelow(small.below).map(([d, x, y]) => [String(add(d, gap)), x, y]));
        expect(encodeBelow(big.below).every(([d]) => typeof d === "string")).toBe(true);
        for (const at of [K, add(K, 1), add(K, 3), sub(K, 2)]) {
            const a = shiftAt(big.below, at), b = shiftAt(small.below, sub(at, gap));
            expectSame([a.carry, a.rem], [b.carry, b.rem]);
            expect(dump(a.digits, gap)).toEqual(dump(b.digits));
        }
        const back = decodeBelow(JSON.parse(JSON.stringify(encodeBelow(big.below))));
        expect(encodeBelow(back)).toEqual(encodeBelow(big.below));
        expect(encodeBelow(shiftDown(big.below, sub(K, 1)))).toEqual(encodeBelow(shiftDown(small.below, 4)));
        expect(encodeBelow(shiftUp(big.below))).toEqual(encodeBelow(small.below).map(([d, x, y]) => [String(add(d, sub(K, 4))), x, y]));
    });

    test("a picture seen 2^60 levels below its home is placed as one 5 levels below it", () => {
        const at = (D) => {
            const M = mk(), home = M.ensureSpine(0), F = M.ensureSpine(add(D, 3));
            const T = addOffset([], D, 70000.5, -2.25).below;
            const s = M.objShift(T, home, F);
            return { M, s, F };
        };
        const a = at(K), b = at(k);
        expectSame(a.s.rem, b.s.rem);
        expect(a.M.depthOf(a.s.F0)).toBe(add(b.M.depthOf(b.s.F0), gap));
        // from the level above the table's entries: the cells it moves the picture by, the same
        const ca = a.M.chainSegs(a.M.ensureSpine(sub(K, 2)), a.s.F0), cb = b.M.chainSegs(b.M.ensureSpine(3), b.s.F0);
        expect(ca).toEqual(cb);
        expect(ca.some((g) => g.i || g.j)).toBe(true);
        expect(depthsExact(a.M)).toBeNull();
    });
});
