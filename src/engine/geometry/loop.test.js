/**
 * loop.js — a Loop reads back exactly the piece objects it was built from, shares a
 * snapshot span without copying, translates every point, and its numbers are the
 * grammar kobin-1 and kobin-2 write.
 */
import { Loop, indexLoop, encodeLoopInto, shiftLoopNumbers } from "./loop";
import { decodeLoops, encodeLoops, loopsBBox } from "./arcShape";

const pieces = () => [
    { line: false, C: [10, 20], r: 5, a0: 0.25, sweep: 1.5, A: [3, 4], B: [7.5, -2.25] },
    { line: true, A: [7.5, -2.25], B: [9, 9] },
    { line: true, A: [9, 9], B: [0, 12], P: [1e6, 2e6], Q: [-3, -4], sa: 0.1, sb: 0.9 },
    { line: false, C: [1, 1], r: 12.5, a0: -0.3, sweep: 3.1, A: [0, 12], B: [3, 4], K: { a0: -0.5, sweep: 3.3, A: [-1, -1], B: [2, 2] }, ua: 0.05, ub: 0.95 },
];
const strip = (p) => JSON.parse(JSON.stringify(p));

describe("Loop", () => {
    test("from pieces and back: every field, every number", () => {
        const L = Loop.from(pieces());
        expect(L.length).toBe(4);
        expect(L.toPieces().map(strip)).toEqual(pieces().map(strip));
        for (let i = 0; i < 4; i++) expect(strip(L.at(i))).toEqual(strip(pieces()[i]));
        expect(L.at(-1).line).toBe(false); expect(L.at(4)).toBeUndefined(); expect(L.at(-5)).toBeUndefined();
        expect(strip([...L])).toEqual(pieces().map(strip));
        expect(L.map((p) => p.B[0])).toEqual([7.5, 9, 0, 3]);
        expect(L.filter((p) => p.line).length).toBe(2);
        expect(L.some((p) => p.K != null)).toBe(true);
        expect(L.every((p) => p.A.length === 2)).toBe(true);
        expect(L.reduce((n, p) => n + (p.line ? 0 : 1), 0)).toBe(2);
        expect(L.slice(1, 3).map((p) => p.line)).toEqual([true, true]);
    });

    test("its numbers are the kobin-1 grammar, and the index finds every record", () => {
        const L = Loop.from(pieces());
        const text = encodeLoops([pieces()])[0];
        expect(L.toArray()).toEqual(text);
        expect(Array.from(L.idx)).toEqual([2, 10, 13, 22]);
        expect(Array.from(indexLoop(Float64Array.from(text)))).toEqual([2, 10, 13, 22]);
        // encodeLoopInto copies a Loop's numbers straight through
        expect(encodeLoopInto(L, [])).toEqual(text);
        expect(encodeLoops([L])[0]).toEqual(text);
        // decodeLoops on the same numbers gives the same pieces
        expect(decodeLoops([text]).map(strip)).toEqual([pieces().map(strip)]);
    });

    test("wrap shares a snapshot span; consecutive pieces share their endpoint", () => {
        const text = encodeLoops([pieces()])[0];
        const geo = new Float64Array(text.length + 4);
        geo.set(text, 2);
        const view = geo.subarray(2, 2 + text.length);
        const L = Loop.wrap(view);
        expect(L.buf).toBe(view);
        expect(L.at(1).A).toEqual(L.at(0).B);
        geo[2 + 1] = 99;            // a change in the span is a change in the loop
        expect(L.at(0).A[1]).toBe(99);
        expect(Loop.from(L)).toBe(L);
        expect(Loop.is(L)).toBe(true); expect(Loop.is(pieces())).toBe(false);
    });

    test("translate moves every point of every record kind, and nothing else", () => {
        const L = Loop.from(pieces());
        const T = L.translate(100, -50);
        expect(T).not.toBe(L);
        expect(T.idx).toBe(L.idx);
        const a = L.toPieces(), b = T.toPieces();
        for (let i = 0; i < a.length; i++) {
            expect(b[i].A).toEqual([a[i].A[0] + 100, a[i].A[1] - 50]);
            expect(b[i].B).toEqual([a[i].B[0] + 100, a[i].B[1] - 50]);
            if (a[i].C) expect(b[i].C).toEqual([a[i].C[0] + 100, a[i].C[1] - 50]);
            if (a[i].P) { expect(b[i].P).toEqual([a[i].P[0] + 100, a[i].P[1] - 50]); expect(b[i].Q).toEqual([a[i].Q[0] + 100, a[i].Q[1] - 50]); expect(b[i].sa).toBe(a[i].sa); }
            if (a[i].K) { expect(b[i].K.A).toEqual([a[i].K.A[0] + 100, a[i].K.A[1] - 50]); expect(b[i].K.B).toEqual([a[i].K.B[0] + 100, a[i].K.B[1] - 50]); expect(b[i].K.a0).toBe(a[i].K.a0); expect(b[i].ua).toBe(a[i].ua); }
            expect(b[i].r).toBe(a[i].r); expect(b[i].a0).toBe(a[i].a0); expect(b[i].sweep).toBe(a[i].sweep);
        }
        const nums = Float64Array.from(encodeLoops([pieces()])[0]);
        shiftLoopNumbers(nums, 1, 1);
        expect(Array.from(nums)).toEqual(T.translate(-99, 51).toArray());
        const bb = loopsBBox([L]), tb = loopsBBox([T]);
        expect(tb.x0).toBe(bb.x0 + 100); expect(tb.y1).toBe(bb.y1 - 50);
    });
});
