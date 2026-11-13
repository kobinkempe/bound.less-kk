/**
 * RUN — runs of empty levels (docs/reference/compact-lattice-design-2026-11-12.md). A frame may stand for the empty
 * levels above it (`run`), and a lattice with runs answers every question as the same lattice with a frame at every
 * level, bit for bit: B below is A loaded again and folded; every query on B's frames is compared with A's.
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT, R, W } from "./frameLattice";
import { addOffset } from "./geometry/offsets";
import { encodeDrawing, decodeDrawing } from "./persist";
import { mapCell, coarser, ownFloor } from "./raster/level";
import { FrameTable, SceneIndex, CHUNK, frameRecord, sameFrameRecord } from "./sceneIndex";

const CFG = { base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 };
/** A lattice; `runs`: its bulk mints make runs (stage 3's setting). */
const mk = (runs = false) => { const M = new LevelMap(CFG, 800, 600); M.bulkRuns = runs; return M; };

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Numbers as text, -0 and NaN included: equal text is equal bits (a shortest round-trip form).
const bits = (v) => JSON.stringify(v, (k, x) => (typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : x));
const expectSame = (b, a) => expect(bits(b)).toBe(bits(a));

/** Mint a chain below `from`: `cells` = [[i, j, n], …], n levels of cell (i, j) each. The bottom frame's id. */
function chain(M, from, cells) {
    let id = from;
    for (const [i, j, n] of cells) for (let k = 0; k < n; k++) id = M.cellChild(id, i, j).id;
    return id;
}
/** Fold every frame that can be, until none can. */
function foldAll(M, inked) {
    let n = 0, more = true;
    while (more) {
        more = false;
        for (const id of [...M.frames.keys()]) if (M.frames.has(id) && M.fold(id, (x) => !inked.has(x))) { n++; more = true; }
    }
    return n;
}
/** A path's levels: each entry is its frame's own level and its run's, less the cuts. */
function levels(M, p) {
    let up = 0, down = 0;
    p.up.forEach((id, k) => { const f = M.frame(id); up += 1 + (f.run ? f.run.n : 0) - (k === p.up.length - 1 ? p.upCut || 0 : 0); });
    p.down.forEach((id, k) => { const f = M.frame(id); down += 1 + (f.run ? f.run.n : 0) - (k === 0 ? p.downCut || 0 : 0); });
    return [up, down];
}

/**
 * A lattice with stretches of one cell, a cell change inside one, a branch off another, a long spine stretch, a
 * co-resident above a stretch, and ink (`inked`) at the ends and at a few levels between.
 */
function build(long = 400) {
    const A = mk(), inked = new Set();
    const s3 = A.ensureSpine(3);
    const a = chain(A, s3, [[5, -7, 1], [100, 3, 1], [1638, 0, long]]);
    const a2 = chain(A, a, [[-3, 9, 1], [1638, 0, Math.floor(long / 2)]]);
    inked.add(a2);
    // A branch off the middle of the first stretch: the stretch stays a frame there.
    const mid = chain(A, s3, [[5, -7, 1], [100, 3, 1], [1638, 0, Math.floor(long / 3)]]);
    const b = chain(A, mid, [[17, 17, 1], [-40, 2, long]]);
    inked.add(b);
    // Ink inside a stretch: the frame holding it stays.
    const c0 = chain(A, s3, [[-900, 44, 1], [7, 7, 60]]);
    inked.add(c0);
    const c = chain(A, c0, [[7, 7, long]]);
    inked.add(c);
    // The spine itself, deep.
    const sp = A.ensureSpine(3 + long);
    inked.add(sp);
    // An edge cell stretch: never folded (its pre-image leaves the parent's square).
    const e = chain(A, s3, [[2047, 0, 1], [2047, 0, 30]]);
    inked.add(e);
    // A co-resident above a stretch: a frame moved into a cell another holds.
    const q = chain(A, s3, [[300, 300, 1], [1, 1, 1]]);
    const q2 = chain(A, s3, [[301, 300, 1]]);
    const moved = A.cellChild(q2, 5, 5).id;
    A.readdress(moved, chain(A, s3, [[300, 300, 1]]), 1, 1);   // `moved` joins q's cell as a co-resident
    const qd = chain(A, q, [[9, 9, long]]);
    inked.add(qd);
    inked.add(moved);
    // As saved and loaded: a load enters a frame's kids in the save's order, and B is a load (walks follow that order).
    const L = mk();
    L.load(A.serialize());
    return { A: L, inked, ends: [a2, b, c, sp, e, qd, moved, c0, mid] };
}

function folded(A, inked) {
    const B = mk(true);
    B.load(A.serialize());
    const n = foldAll(B, inked);
    return { B, n };
}

describe("RUN-1 — folding", () => {
    test("a stretch of empty levels becomes one frame's run; ink, branches, edges and co-residents stay frames", () => {
        const { A, inked, ends } = build(400);
        const { B, n } = folded(A, inked);
        expect(n).toBeGreaterThan(1000);
        expect(B.frames.size).toBeLessThan(80);
        for (const id of ends) expect(B.frame(id)).toBeTruthy();
        for (const f of B.frames.values()) {
            const af = A.frame(f.id);
            expect(f.depth).toBe(af.depth);
            expect(f.cell).toEqual(af.cell);
            if (!f.run) continue;
            expect(f.depth).toBe(B.frame(f.parent).depth + f.run.n + 1);
            expect(Math.abs(f.run.i)).toBeLessThan(R / 2 - 1);
            expect(Math.abs(f.run.j)).toBeLessThan(R / 2 - 1);
        }
    });

    test("serialize and load keep the runs; an older save of the same lattice loads with a frame a level", () => {
        const { A, inked } = build(200);
        const { B } = folded(A, inked);
        const data = B.serialize();
        expect(data.frames.some((f) => Array.isArray(f.run))).toBe(true);
        const C = mk();
        C.load(data);
        expect(bits(C.serialize())).toBe(bits(data));
        const D = mk();
        D.load(A.serialize());
        expect(D.frames.size).toBe(A.frames.size);
    });
});

describe("RUN-2 — every walk through a run is the walk through its frames, bit for bit", () => {
    const { A, inked } = build(400);
    const { B } = folded(A, inked);
    const rnd = rng(7);
    const ids = [...B.frames.keys()];
    const pick = [];
    for (let k = 0; k < 40; k++) pick.push(ids[Math.floor(rnd() * ids.length)]);
    const pts = [[0, 0], [12345.678, -999.5], [-65000, 64000.25], [W / 3, -W / 7]];

    test("paths: the same levels, through the same frames", () => {
        for (const X of pick) for (const Y of pick) {
            const pa = A.framePath(X, Y), pb = B.framePath(X, Y);
            expect(levels(B, pb)).toEqual([pa.up.length, pa.down.length]);
            const onA = new Set([...pa.up, ...pa.down]);
            for (const id of [...pb.up, ...pb.down]) expect(onA.has(id)).toBe(true);
        }
    });

    test("points and rects map to the same numbers, and the frame factor is the same", () => {
        for (const X of pick) for (const Y of pick) {
            for (const p of pts) expectSame(B.mapPointF(p, X, Y), A.mapPointF(p, X, Y));
            const r = { left: -1000.5, top: -77, right: 4096.25, bottom: 9000 };
            expectSame(B.mapRectF(r, X, Y), A.mapRectF(r, X, Y));
            expectSame(B.frameFactor(X, Y), A.frameFactor(X, Y));
        }
    });

    test("a mapper for many points is mapPointF's numbers", () => {
        for (const X of pick.slice(0, 12)) for (const Y of pick.slice(0, 12)) {
            const fa = A.mapperObj(X, Y, null, X, false), fb = B.mapperObj(X, Y, null, X, false);
            for (const p of pts) expectSame(fb(p[0], p[1], [0, 0]), fa(p[0], p[1], [0, 0]));
        }
    });

    test("a chain mapped up in one walk gives each frame the same points", () => {
        for (const X of pick) {
            const a = A.pointsUpChain(pts, X), b = B.pointsUpChain(pts, X);
            for (const [id, v] of b) expectSame(v, a.get(id));
        }
    });

    test("a chain's cells, as runs, are its cells", () => {
        for (const X of pick) {
            const up = A._ancestors(X).filter((id) => B.frame(id));
            for (const T of up) {
                const segs = B.chainSegs(T, X), cells = [];
                for (const s of segs) for (let k = 0; k < s.n; k++) cells.push({ i: s.i, j: s.j });
                expect(cells).toEqual(A.chainFrom(T, X));
            }
        }
    });

    test("the walk of the frames near a view asks the same of every frame both hold, in the same order", () => {
        // `reach`: descend into a frame whose square meets a box around F (a kid's square is in its parent's, so a
        // run level the per-level walk refuses would refuse what is below it).
        const rec = (M, F, reach) => {
            const out = [];
            M.nearWalk(F, (f, k, s, x, y, a) => {
                const go = !reach || (Math.abs(x) - s * W / 2 < 4 * W && Math.abs(y) - s * W / 2 < 4 * W && s > 1e-30);
                if (B.frame(f.id)) out.push(bits([f.id, k, s, x, y, a.depth, go]));
                return go;
            });
            return out;
        };
        for (const F of pick.slice(0, 20)) {
            expect(rec(B, F, false)).toEqual(rec(A, F, false));
            const a = rec(A, F, true).filter((s) => s.endsWith("true]")), b = rec(B, F, true).filter((s) => s.endsWith("true]"));
            expect(b).toEqual(a);
        }
    });

    test("a moved object's picture is read from the same frame, and minted there under the same id", () => {
        const tables = [addOffset(null, 2, 70000.5, -3), addOffset(null, 5, -W * 1.5, 1024), addOffset(addOffset(null, 1, 33, 44).below, 40, 9e4, -9e4)];
        for (const t of tables) {
            for (const home of pick.slice(0, 8)) for (const F of pick.slice(0, 16)) {
                if (B.frame(F).depth < B.frame(home).depth) continue;
                const sa = A.objShift(t.below, home, F, false), sb = B.objShift(t.below, home, F, false);
                if (!sa) { expect(sb).toBeNull(); continue; }
                expectSame(sb.rem, sa.rem);
                if (sa.F0 && B.frame(sa.F0)) expect(sb.F0).toBe(sa.F0);
                else expect(sb.missing || sb.F0 === sa.F0).toBeTruthy();
            }
        }
    });
});

describe("RUN-3 — unfolding", () => {
    test("an id inside a run is made a frame again, at its address, under the id the per-level lattice gave it", () => {
        const { A, inked } = build(300);
        const { B } = folded(A, inked);
        const gone = [...A.frames.keys()].filter((id) => !B.frame(id));
        const rnd = rng(3);
        for (let k = 0; k < 40; k++) {
            const id = gone[Math.floor(rnd() * gone.length)];
            const f = B.ensureId(id);
            expect(f && f.id).toBe(id);
            expect(f.depth).toBe(A.frame(id).depth);
            expect(B.chainSegs(B._ancestors(id).pop(), id).reduce((a, s) => a + s.n, 0)).toBe(A.chainFrom(A._ancestors(id).pop(), id).length);
            for (const p of [[5, 5], [-30000.5, 12]]) expectSame(B.mapPointF(p, id, "0"), A.mapPointF(p, id, "0"));
        }
    });

    test("a mint beside a run level unfolds it; the new frame is the per-level lattice's", () => {
        const { A, inked } = build(300);
        const { B } = folded(A, inked);
        const gone = [...A.frames.keys()].filter((id) => !B.frame(id) && A.frame(id).depth > 20);
        for (const id of gone.slice(0, 15)) {
            const na = A.cellChild(id, -100, 1), nb = B.cellChild(B.ensureId(id).id, -100, 1);
            expect(nb.id).toBe(na.id);
            expectSame(B.mapPointF([1, 2], nb.id, "0"), A.mapPointF([1, 2], na.id, "0"));
            const ra = A.neighbour(na.id, 1, 0), rb = B.neighbour(nb.id, 1, 0);
            expect(rb.id).toBe(ra.id);
        }
    });

    test("the spine to a depth is one frame and a run; a depth inside it unfolds", () => {
        const M = mk(true);
        const deep = M.ensureSpine(1e6);
        expect(M.frame(deep).depth).toBe(1e6);
        expect(M.frames.size).toBeLessThan(5);
        const mid = M.ensureSpine(500000);
        expect(mid).toBe("500000");
        expect(M.frame(mid).depth).toBe(500000);
        expect(M.frames.size).toBeLessThan(6);
        expect(M.mapPointF([W / 4, 0], deep, "0")).toEqual([0, 0]);
    });
});

/** Nothing is at or beside any run's top level but the run (compact-lattice design, "Representation"). */
function ringsClear(M) {
    for (const K of M.frames.values()) {
        if (!K.run) continue;
        for (const g of M.cellFrames(K.parent)) {
            for (const [key, id] of g._kids || []) {
                const [i, j] = key.split(",").map(Number);
                if (id !== K.id && Math.abs(i - K.run.i) <= 1 && Math.abs(j - K.run.j) <= 1) return false;
            }
        }
    }
    return true;
}

describe("RUN-5 — edits through and beside runs", () => {
    test("a frame displaced through a run lands where the per-level lattice puts it, under the same id", () => {
        const { A, inked } = build(300);
        const { B } = folded(A, inked);
        const rnd = rng(11), ids = [...B.frames.keys()].filter((id) => B.frame(id).depth > 10);
        let moved = 0;
        for (let n = 0; n < 40; n++) {
            const X = ids[Math.floor(rnd() * ids.length)], d = B.frame(X).depth;
            const at = d - 1 - Math.floor(rnd() * Math.min(d - 1, 350));
            const dx = Math.round((rnd() - 0.5) * W * 3 * 1024) / 1024, dy = Math.round((rnd() - 0.5) * W * 1024) / 1024;
            const ra = A.displaceFrame(X, at, dx, dy), rb = B.displaceFrame(X, at, dx, dy);
            if (!ra) { expect(rb).toBeNull(); continue; }
            expectSame(rb.rest, ra.rest);
            expect([rb.frame.id, rb.frame.depth]).toEqual([ra.frame.id, ra.frame.depth]);
            if (ra.frame.id !== X) moved++;
        }
        expect(moved).toBeGreaterThan(20);
        expect(ringsClear(B)).toBe(true);
    });

    test("a frame minted beside a run's top level unfolds it, and is the per-level lattice's frame", () => {
        const { A, inked } = build(200);
        const { B } = folded(A, inked);
        const runs = [...B.frames.values()].filter((f) => f.run && Math.abs(f.run.i) < 2040);
        for (const K of runs) {
            const P = K.parent, { i, j } = K.run;
            const nb = B.cellChild(P, i + 1, j - 1), na = A.cellChild(P, i + 1, j - 1);
            expect(nb.id).toBe(na.id);
            expect(B.frame(K.id).parent).not.toBe(P);                      // its top level is a frame now
            expectSame(B.mapPointF([77.5, -3], nb.id, K.id), A.mapPointF([77.5, -3], na.id, K.id));
        }
        expect(runs.length).toBeGreaterThan(5);
        expect(ringsClear(B)).toBe(true);
    });

    test("a deleted run frame comes back with its run; where a frame has come since, under the lattice's levels", () => {
        const { A, inked } = build(200);
        const { B } = folded(A, inked);
        const K = [...B.frames.values()].find((f) => f.run && f.run.n > 50 && !B.childrenOf(f.id).length);
        const P = K.parent, { n, i, j } = K.run, depth = K.depth;
        const recs = B.removeSubtree(K.id);
        expect(B.frame(K.id)).toBeUndefined();
        expect(B.restoreFrame(recs[0]).run.n).toBe(n);
        expect(B.frame(K.id).parent).toBe(P);
        const recs2 = B.removeSubtree(K.id);
        B.cellChild(P, i, j);                                              // a frame at its run's top level since
        const g = B.restoreFrame(recs2[0]);
        expect([g.depth, B.frame(g.parent).depth]).toEqual([depth, depth - 1 - (g.run ? g.run.n : 0)]);
        expectSame(B.mapPointF([5, 5], K.id, P), A.mapPointF([5, 5], K.id, P));
        expect(ringsClear(B)).toBe(true);
    });

    test("a copy's unfolded levels and the frames it minted under them merge back under their ids", () => {
        const { A, inked } = build(200);
        const { B } = folded(A, inked);
        const C = mk(true);
        C.load(B.serialize());
        const gone = [...A.frames.keys()].filter((id) => !B.frame(id) && A.frame(id).depth > 8);
        const rnd = rng(5), made = [];
        for (let k = 0; k < 12; k++) {
            const m = C.ensureId(gone[Math.floor(rnd() * gone.length)]);
            made.push(C.cellChild(m.id, -9, 9).id);
        }
        const known = new Set(B.frames.keys());
        const fresh = C.serialize().frames.filter((f) => !known.has(f.id));
        B.merge({ frames: fresh });
        for (const f of fresh) expect([f.id, B.frame(f.id) && B.frame(f.id).depth]).toEqual([f.id, f.depth]);
        for (const id of made) expectSame(B.mapPointF([1, 1], id, "0"), C.mapPointF([1, 1], id, "0"));
        expect(ringsClear(B)).toBe(true);
    });

    test("a drag's start unfolds the levels it re-addresses; the targets are the per-level lattice's", () => {
        const { A, inked } = build(200);
        const { B } = folded(A, inked);
        const roots = [...B.frames.values()].filter((f) => f.run && f.run.n > 5).map((f) => f.id);
        for (const X of roots) {
            const at = B.frame(X).depth - 3;
            const sa = A.subtreeStart(X, at), sb = B.subtreeStart(X, at);
            expect([...sb.keys()].sort()).toEqual([...sa.keys()].sort());
            for (const [id, e] of sb) if (id !== X) expect([e.parent, e.i, e.j, e.depth]).toEqual([sa.get(id).parent, sa.get(id).i, sa.get(id).j, sa.get(id).depth]);
            const ta = A.moveSubtreeTargets(null, at, 70000.25, -1234.5, sa), tb = B.moveSubtreeTargets(null, at, 70000.25, -1234.5, sb);
            expect(tb.map((t) => [t.id, t.depth, t.parent, t.i, t.j])).toEqual(ta.map((t) => [t.id, t.depth, t.parent, t.i, t.j]));
            expectSame(tb.map((t) => t.rest), ta.map((t) => t.rest));
        }
        expect(roots.length).toBeGreaterThan(5);
    });

    test("a save with runs is version 5 and opens with them; a run that does not fit its depth is refused", () => {
        const { A, inked } = build(100);
        const { B } = folded(A, inked);
        const file = JSON.parse(JSON.stringify(encodeDrawing({ camera: { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 }, crossings: B.serialize(), natives: { 0: [] } })));
        expect(file.version).toBe(5);
        const C = mk();
        C.load(decodeDrawing(file).crossings);
        expect(bits(C.serialize())).toBe(bits(B.serialize()));
        const bad = JSON.parse(JSON.stringify(file)), f = bad.crossings.frames.find((r) => r.run);
        f.run[0] += 1;
        expect(() => decodeDrawing(bad)).toThrow(/run does not fit/);
    });
});

describe("RUN-4 — depth", () => {
    test("a stretch 20,000 levels deep folds to a handful of frames, and maps as the per-level lattice does", () => {
        const A = mk();
        const s = A.ensureSpine(1);
        const top = chain(A, s, [[12, -5, 1], [1638, 0, 20000]]);
        const side = chain(A, top, [[-2, 3, 1], [44, 44, 50]]);
        const inked = new Set([top, side]);
        const { B } = folded(A, inked);
        expect(B.frames.size).toBeLessThan(10);
        for (const p of [[0, 0], [65535.5, -65536], [1, 1]]) {
            expectSame(B.mapPointF(p, top, "0"), A.mapPointF(p, top, "0"));
            expectSame(B.mapPointF(p, "0", top), A.mapPointF(p, "0", top));
            expectSame(B.mapPointF(p, side, top), A.mapPointF(p, side, top));
        }
        expectSame(B.frameFactor(top, "0"), A.frameFactor(top, "0"));
    });
});

describe("RUN-6 — chains kept as runs (stage 2)", () => {
    test("a chain kept as runs finds and re-mints the frame a chain of cells does, as one frame and a run", () => {
        const A = mk();
        const s = A.ensureSpine(2);
        const X = chain(A, s, [[9, -4, 1], [1638, 0, 3000], [-7, 7, 1]]);
        const segs = A.chainSegs("0", X);
        expect(segs.reduce((n, g) => n + g.n, 0)).toBe(A.chainFrom("0", X).length);
        expect(A.frameAtChain("0", segs).id).toBe(X);
        expect(A.peekAtChain("0", segs).id).toBe(X);
        // Gone (a delete took it): the chain kept as runs mints it again, the stretch as one frame and a run.
        const B = mk(true);
        B.load(A.serialize());
        foldAll(B, new Set([X]));
        const top = B.frame(X).parent;
        B.removeSubtree(top);
        expect(B.frame(X)).toBeUndefined();
        const n0 = B.frames.size, Y = B.frameAtChain("0", segs);
        expect(Y.depth).toBe(A.frame(X).depth);
        expect(B.chainFrom("0", Y.id)).toEqual(A.chainFrom("0", X));
        expect(B.frames.size - n0).toBeLessThan(5);
    });
});

describe("RUN-7 — a plate mapped through a run is the plate mapped through its frames (stage 2)", () => {
    // Numbers and BigInts as text, -0 kept: equal text is the same plate to the bit.
    const show = (m) => (m ? [m.level, m.i, m.j].map((v) => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v))).join(" ") : m);

    test("every pair, every level step: the same level and plate, as Numbers or as BigInts", () => {
        const { A, inked } = build(120);
        const { B } = folded(A, inked);
        const rnd = rng(11);
        const ids = [...B.frames.keys()];
        const pick = [];
        for (let k = 0; k < 16; k++) pick.push(ids[Math.floor(rnd() * ids.length)]);
        let numbers = 0, bigs = 0;
        for (const S of [1, 2, 3]) {
            for (const X of pick) for (const Y of pick) for (const l of [ownFloor(S), 0, 2]) {
                for (const [i, j] of [[0, 0], [5, -3], [-77, 1234]]) {
                    const a = mapCell(A, S, X, l, i, j, Y);
                    expect(show(mapCell(B, S, X, l, i, j, Y))).toBe(show(a));
                    if (a && typeof a.i === "number") numbers++;
                    else if (a) bigs++;
                }
            }
        }
        expect(numbers).toBeGreaterThan(100);
        expect(bigs).toBeGreaterThan(100);
    });

    test("a coarser plate above a run frame's floor is the per-level lattice's plate, in the frame above the run", () => {
        const { A, inked } = build(120);
        const { B } = folded(A, inked);
        let n = 0;
        for (const f of B.frames.values()) {
            if (!f.run || f.run.n < 3) continue;
            for (const S of [1, 2, 3]) for (const k of [1, 12 / S]) for (const [i, j] of [[0, 0], [9, -4]]) {
                const fl = ownFloor(S);
                const a = coarser(A, S, f.id, fl, i, j, k), b = coarser(B, S, f.id, fl, i, j, k);
                expect(b.frame).toBe(f.parent);                    // the per-level lattice's answer is a run level here
                expect(show(mapCell(A, S, a.frame, a.level, a.i, a.j, b.frame))).toBe(show(b));
                n++;
            }
        }
        expect(n).toBeGreaterThan(20);
    });

    test("a run of 10^13 levels: a zero cell maps at once; a non-zero one is refused, not a BigInt past V8's", () => {
        const M = mk(true);
        const sp = M.ensureSpine(1e13);
        expect(M.frames.size).toBeLessThan(4);
        expect(mapCell(M, 1, sp, 0, 3, -4, "0")).toEqual({ level: 12e13, i: 3, j: -4 });
        const K = M._mintRun(M.frame("0"), 5, -6, 1e13);
        expect(K.run.n).toBe(1e13 - 1);
        expect(mapCell(M, 1, K.id, ownFloor(1), 0, 0, "0")).toBeNull();
        expect(coarser(M, 1, K.id, ownFloor(1), 0, 0, 1)).toBeNull();
        // A short one still maps, as the per-level sum.
        const Q = M._mintRun(M.frame("0"), 7, 7, 4);
        const m = mapCell(M, 1, Q.id, 0, 1, 2, "0");
        let x = 1, y = 2;
        for (let d = 0; d < 4; d++) { x += 7 * 2 ** (8 + 12 * d); y += 7 * 2 ** (8 + 12 * d); }
        expect(m).toEqual({ level: 48, i: x, j: y });
    });
});

describe("RUN-8 — the scene worker's frame table through runs (stage 2)", () => {
    /** sceneClient's diff: records of M's frames changed since `keys`, and the ids gone. */
    const frameDiff = (M, keys) => {
        const out = [];
        for (const f of M.frames.values()) {
            if (sameFrameRecord(keys.get(f.id), f)) continue;
            const r = frameRecord(f);
            out.push(r); keys.set(f.id, { ...r });
        }
        for (const id of [...keys.keys()]) if (!M.frames.has(id)) { out.push({ id, gone: true }); keys.delete(id); }
        return out;
    };
    const tableOf = (M) => { const T = new FrameTable(), keys = new Map(); T.update(frameDiff(M, keys)); T.settle(); return { T, keys }; };
    const staticRef = (T, id, moved) => SceneIndex.prototype._staticRef.call({ frames: T }, id, moved);

    test("a map between two frames is the frame-a-level map, bit for bit; null past 4,097 levels as there", () => {
        const { A, inked, ends } = build(4500);
        const { B } = folded(A, inked);
        const TA = tableOf(A).T, TB = tableOf(B).T;
        const ids = [...B.frames.keys()], rnd = rng(11), pairs = [];
        for (const a of ends) for (const b of ends) pairs.push([a, b]);
        for (let k = 0; k < 300; k++) pairs.push([ids[Math.floor(rnd() * ids.length)], ids[Math.floor(rnd() * ids.length)]]);
        const spy = jest.spyOn(TB, "_across");
        const bad = [];
        let nulls = 0, finite = 0;
        for (const [a, b] of pairs) {
            const ma = TA.map(a, b), mb = TB.map(a, b);
            if (bits(mb) !== bits(ma)) bad.push([a, b, bits(ma), bits(mb)]);
            if (!ma) nulls++; else if (ma.s < 2 ** -1000 && Number.isFinite(ma.ox)) finite++;
        }
        expect(bad).toEqual([]);
        expect(nulls).toBeGreaterThan(0);          // a common frame more than 4,097 levels up
        expect(finite).toBeGreaterThan(0);         // across a run of more than 90 levels: the scale underflows
        expect(spy.mock.calls.some(([P]) => P.m > 0)).toBe(true);   // a position inside a run
        spy.mockRestore();
    });

    test("an unfold or a fold re-parents without moving; a move below a run measures from the level above, as a frame a level", () => {
        const { A, inked } = build(400);
        const { B } = folded(A, inked);
        const a = tableOf(A), b = tableOf(B), TA = a.T, TB = b.T;
        // `c`: 399 levels of (7, 7) above it in B; X the level just above it
        const c = [...B.frames.values()].find((f) => f.run && f.run.n === 399 && f.run.i === 7).id;
        const X = A.frame(c).parent, c0 = B.frame(c).parent;
        const same = (pairs, old) => { for (const [p, q] of pairs) expect(bits(TB.map(p, q, old))).toBe(bits(TA.map(p, q, old))); };

        B.ensureId(X);
        let r = TB.update(frameDiff(B, b.keys));
        expect([r.moved.size, r.shifted.size, r.gone.size]).toEqual([0, 0, 0]);
        expect(TB.parentOf(c, true)).toBe(X);                      // the old tree has the unfolded level too
        same([[c, X], [c, c0], [X, c0], [c0, c]], true);
        same([[c, X], [c, c0], [X, c0]], false);
        TB.settle();

        foldAll(B, inked);
        r = TB.update(frameDiff(B, b.keys));
        expect([r.moved.size, r.shifted.size, r.gone.has(X)]).toEqual([0, 0, true]);
        for (const id of r.gone) expect(A.frame(id).depth).toBeLessThan(B.frame(c).depth);   // unfolded levels only
        same([[c, c0], [c0, c]], false);
        same([[c, X], [c, c0]], true);
        TB.settle();

        // c one cell over, under X: B unfolds X first, as LevelMap does for a move
        B.ensureId(X);
        B.readdress(c, X, 8, 7);
        A.readdress(c, X, 8, 7);
        const rA = TA.update(frameDiff(A, a.keys));
        r = TB.update(frameDiff(B, b.keys));
        expect([...r.moved]).toEqual([...rA.moved]);
        expect([...r.moved]).toEqual([c]);
        expect(staticRef(TB, c, r.moved)).toBe(X);
        expect(staticRef(TA, c, rA.moved)).toBe(X);
        same([[c, X], [c, c0], [X, c0]], true);
        same([[c, X], [c, c0], [X, c0]], false);
    });

    test("the scene index over a lattice with runs keeps the scenes of the same lattice a frame a level, through a move and a fold", () => {
        const line = (x0, y0, x1, y1, n) => { const p = []; for (let i = 0; i <= n; i++) p.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]); return p; };
        const chunks = (pts, w) => {
            const max = CHUNK * w, out = [];
            let q = null, px = null, py = null;
            const push = () => { if (q) out.push(q[0], q[1], q[2], q[3], Math.max(q[4], w)); q = null; };
            for (const [x, y] of pts) {
                if (q && (Math.max(q[2], x) - Math.min(q[0], x) > max || Math.max(q[3], y) - Math.min(q[1], y) > max)) push();
                if (!q) q = [x, y, x, y, 0];
                else { q[0] = Math.min(q[0], x); q[1] = Math.min(q[1], y); q[2] = Math.max(q[2], x); q[3] = Math.max(q[3], y); }
                if (px != null) q[4] += Math.hypot(x - px, y - py);
                px = x; py = y;
            }
            push();
            return new Float64Array(out);
        };
        let uid = 1;
        const stroke = (x0, y0, x1, y1, w, home) => ({ id: uid++, home, w, raw: chunks(line(x0, y0, x1, y1, 20), w), t: null });

        const A0 = mk(), inked = new Set();
        const top = chain(A0, A0.ensureSpine(3), [[5, -7, 1]]);
        const K = chain(A0, top, [[1638, 0, 600]]);
        const K1 = chain(A0, K, [[2, 2, 1]]);
        const Q = chain(A0, top, [[-50, 9, 1], [3, 3, 598]]);   // elsewhere, one level above K
        [top, K, K1].forEach((id) => inked.add(id));
        const A = mk();
        A.load(A0.serialize());
        const { B } = folded(A, inked);
        expect(B.frame(K).run.n).toBe(599);
        const X = A.frame(K).parent;

        const IA = new SceneIndex(), IB = new SceneIndex();
        IA.vtag = IB.vtag = "t";
        const kA = new Map(), kB = new Map();
        const run = (items, editA, editB) => {
            if (editA) editA();
            if (editB) editB();
            const copy = () => items.map((x) => ({ ...x, raw: x.raw.slice() }));
            const oa = IA.apply({ frames: frameDiff(A, kA), items: copy() }), ob = IB.apply({ frames: frameDiff(B, kB), items: copy() });
            const view = (o) => bits({ scenes: o.scenes, changed: o.changed, export: o.export });
            expect(view(ob)).toBe(view(oa));
            return oa;
        };
        const items = [stroke(0, 0, 300, 0, 1, K), stroke(0, 60, 300, 60, 1, K), stroke(-900, 20, -700, 20, 1, K),
            stroke(0, 0, 9000, 0, 4096, K1), stroke(100, 100, 400, 500, 1, top)];
        const o1 = run(items);
        expect(o1.scenes.length).toBeGreaterThan(1);
        // K one cell over under X; B unfolds X first, in the same batch
        run([], () => A.readdress(K, X, 1639, 0), () => { B.ensureId(X); B.readdress(K, X, 1639, 0); });
        expect(B.frame(X).depth).toBe(B.frame(K).depth - 1);
        // B folds X back into K's run; A is unchanged
        run([], null, () => foldAll(B, inked));
        expect(B.frame(X)).toBeUndefined();
        expect(B.frame(K).run.n).toBe(599);
        run([stroke(320, 0, 600, 30, 1, K)]);
        // K far away, under Q: no static frame this side of its run in B; carried whole, as a frame a level moves it
        expect(B.frame(Q).run.n).toBeGreaterThan(500);
        run([], () => A.readdress(K, Q, 4, 4), () => B.readdress(K, Q, 4, 4));
        run([stroke(0, 200, 300, 200, 1, K)]);
    });

    test("a scene anchored in a frame that goes with a run above it, and no fold, goes to its ink's home, not past the run", () => {
        const G = 32, rec = (id, parent, depth, i, j, run) => ({ id, parent, depth, cx: i * G, cy: j * G, sx: 0, sy: 0,
            rn: run ? run[0] : 0, rx: run ? run[1] * G : 0, ry: run ? run[2] * G : 0 });
        const ix = new SceneIndex();
        ix.vtag = "t";
        const box = (x0, y0, x1, y1) => new Float64Array([x0, y0, x1, y1, Math.hypot(x1 - x0, y1 - y0)]);
        ix.apply({ frames: [rec("0", null, 0, 0, 0), rec("P", "0", 1, 5, 0), rec("K", "P", 601, 7, 7, [599, 1638, 0]), rec("J", "K", 602, 1, 0)],
            items: [{ id: 1, home: "J", w: 1, raw: box(0, 0, 300, 0), t: null }, { id: 2, home: "J", w: 1, raw: box(0, 60, 300, 60), t: null }] });
        const S = ix.items.get(1).scene;
        ix._reanchor(S, "K");
        const r1 = ix.apply({ frames: [] }).scenes.find((r) => r.id === S.idn.id);
        expect(r1.level).toBe("K");
        // K goes; J is filed under N, a frame at K's depth beside it
        const out = ix.apply({ frames: [{ id: "K", gone: true }, rec("N", "P", 601, 8, 7, [599, 1638, 0]), rec("J", "N", 602, 1, 0)] });
        const r2 = out.scenes.find((r) => r.id === S.idn.id);
        expect(r2.level).toBe("J");
        expect(r2.rect.w / r1.rect.w).toBeCloseTo(4096, 6);
        expect(ix.items.get(2).scene).toBe(S);
    });

    test("a scene anchored in a frame that folds away is re-anchored in the frame whose run took its level, in place", () => {
        const A0 = mk(), inked = new Set();
        const top = chain(A0, A0.ensureSpine(3), [[5, -7, 1]]);
        const Y = chain(A0, top, [[1, 1, 300]]);
        const K = chain(A0, Y, [[1, 1, 1]]);
        const K1 = chain(A0, K, [[2, 2, 1]]);
        [top, K, K1].forEach((id) => inked.add(id));
        const B = mk(true);
        B.load(A0.serialize());
        foldAll(B, new Set([...inked, Y]));
        expect([B.frame(Y).run.n, B.frame(K).run]).toEqual([299, null]);
        const ix = new SceneIndex(), keys = new Map();
        ix.vtag = "t";
        const box = (x0, y0, x1, y1, w) => new Float64Array([x0, y0, x1, y1, Math.max(Math.hypot(x1 - x0, y1 - y0), w)]);
        ix.apply({ frames: frameDiff(B, keys), items: [{ id: 1, home: K1, w: 1, raw: box(0, 0, 300, 0, 1), t: null },
            { id: 2, home: K1, w: 1, raw: box(0, 60, 300, 60, 1), t: null }] });
        const S = ix.items.get(1).scene;
        ix._reanchor(S, Y);                       // as a move's re-anchor leaves it: in a frame with no ink of its own
        const o1 = ix.apply({ frames: [] }), r1 = o1.scenes.find((r) => r.id === S.idn.id);
        expect(r1.level).toBe(Y);
        const M = ix.frames.map(Y, K);
        foldAll(B, inked);
        expect(B.frame(Y)).toBeUndefined();
        expect(B.frame(K).run.n).toBe(300);
        const o2 = ix.apply({ frames: frameDiff(B, keys) }), r2 = o2.scenes.find((r) => r.id === S.idn.id);
        expect(r2.level).toBe(K);
        for (const [a, b] of [[r2.rect.x, r1.rect.x * M.s + M.ox], [r2.rect.y, r1.rect.y * M.s + M.oy], [r2.rect.w, r1.rect.w * M.s], [r2.rect.h, r1.rect.h * M.s]]) {
            expect(Math.abs(a - b)).toBeLessThan(1e-9 * (Math.abs(b) + r2.rect.w));
        }
    });
});
