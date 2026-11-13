/**
 * OPEN-FLAGS F85: an item whose chunks are longer than CHUNK widths (`sceneGeom` past MAX_CHUNKS of them) is filed
 * from the band where each chunk's box covers at most 64 cells, so its grid entries grow with its length, not the
 * square of it (a random test's 64×-long chunks once took a 4 GB heap). Items that touch still share a scene.
 */
import { SceneIndex, CHUNK } from "./sceneIndex";

const F0 = [{ id: "0", parent: null, depth: 0 }];
let uid = 7000;
/** An item down a diagonal from (x, y) (`dir` -1 runs up): `n` chunks, each `g` CHUNK widths long, pen 1. */
const diag = (x, y, n, g, dir = 1) => {
    const raw = new Float64Array(5 * n), L = g * CHUNK, d = L / Math.SQRT2;
    for (let k = 0; k < n; k++) {
        const ax = x + k * d, ay = y + dir * k * d, by = ay + dir * d;
        raw.set([ax, Math.min(ay, by), ax + d, Math.max(ay, by), L], 5 * k);
    }
    return { id: ++uid, home: "0", w: 1, raw, t: null };
};
const entries = (ix) => { let n = 0; for (const S of ix.scenes) n += S.grid.live + S.mgrid.live; return n; };
const fresh = () => { const ix = new SceneIndex(); ix.apply({ frames: F0 }); return ix; };

describe("F85 — chunks longer than CHUNK widths", () => {
    test("LC-1 an item of 64×-long chunks is filed in about a hundred cells a chunk, not a few thousand", () => {
        const ix = fresh();
        ix.apply({ items: [diag(0, 0, 200, 64)] });
        expect(ix.scenes.size).toBe(1);
        expect(entries(ix)).toBeLessThan(200 * 2 * 7 * 70);           // unbounded it was ~1,860 a chunk a grid
        const one = fresh();
        one.apply({ items: [diag(0, 0, 200, 1)] });
        expect(entries(one)).toBeLessThan(200 * 2 * 7 * 6);           // a chunk CHUNK widths long: at most 4 cells a band
    });

    test("LC-2 two such items that cross share a scene; one that ends 50 chunk lengths away does not", () => {
        const ix = fresh();
        const A = diag(0, 0, 40, 64), B = diag(0, 40 * 64 * CHUNK / Math.SQRT2, 40, 64, -1);
        ix.apply({ items: [A, B] });
        expect(ix.items.get(A.id).scene).toBe(ix.items.get(B.id).scene);
        const C = diag(-60 * 64 * CHUNK, 0, 10, 64);
        ix.apply({ items: [C] });
        expect(ix.items.get(C.id).scene).not.toBe(ix.items.get(A.id).scene);
    });

    test("LC-3 chunks too long for any band are filed nowhere, and the item still joins the ink it touches", () => {
        const ix = fresh();
        const N = diag(0, 0, 4, 1);
        ix.apply({ items: [N] });
        const before = entries(ix);
        const H = diag(0, 0, 50, 4000);
        ix.apply({ items: [H] });
        expect(ix.items.get(H.id).scene).toBe(ix.items.get(N.id).scene);
        expect(entries(ix)).toBeLessThan(before + 1000);
    });
});
