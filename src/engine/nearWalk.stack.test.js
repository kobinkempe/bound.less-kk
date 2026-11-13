/**
 * OPEN-FLAGS F200: `LevelMap.nearWalk` recursed a call a level into the frames below the view, and in Chrome a drawing at
 * level 500 over a mark drawn at 10,000 overflowed the stack (`RangeError` in `childrenOf ← deep`). The walk now keeps its
 * own stack; these check it reaches the bottom of a chain 20,000 levels deep and asks exactly what the recursion asked,
 * in the same order.
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT, R, W } from "./frameLattice";

const mk = () => new LevelMap({ base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 }, 800, 600);

/** The walk as it was before F200, recursive: the reference for the order. */
function recursiveWalk(M, F, fn) {
    const anc = [];
    for (let f = M.residentOf(F); f; f = f.parent != null ? M.residentOf(f.parent) : null) { anc.push(f); if (!f.centre) break; }
    const seen = new Set();
    const deep = (f, s, x, y) => {
        if (seen.has(f.id)) return;
        seen.add(f.id);
        if (!fn(f, 0, s, x, y, anc[0])) return;
        for (const c of M.childrenOf(f.id)) if (c.centre) deep(c, s / R, c.centre.x * s + x, c.centre.y * s + y);
    };
    const flat = (f, k, nx, ny) => {
        if (k === 0) { deep(f, 1, nx * W, ny * W); return; }
        if (seen.has(f.id)) return;
        seen.add(f.id);
        if (!fn(f, k, 1, nx * W, ny * W, anc[k])) return;
        for (const c of M.childrenOf(f.id)) if (c.centre) flat(c, k - 1, nx * R + c.cell.i - anc[k - 1].cell.i, ny * R + c.cell.j - anc[k - 1].cell.j);
    };
    for (const f of M.cellFrames(F)) flat(f, 0, 0, 0);
    for (let k = 0; k + 1 < anc.length; k++) {
        const child = anc[k];
        for (const p of M.cellFrames(anc[k + 1].id)) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            if (!fn(p, k + 1, 1, 0, 0, anc[k + 1])) continue;
            for (const sib of M.childrenOf(p.id)) if (!M.sameCell(sib.id, child.id) && sib.centre) flat(sib, k, sib.cell.i - child.cell.i, sib.cell.j - child.cell.j);
        }
    }
}

test("F200 the walk reaches the bottom of a chain 20,000 levels below the view", () => {
    const M = mk();
    const top = M.cellChild("0", 7, -3).id;
    let id = top;
    for (let d = 1; d < 20000; d++) id = M.cellChild(id, 0, 0).id;
    let deepest = 0;
    expect(() => M.nearWalk(top, (f) => { deepest = Math.max(deepest, f.depth); return true; })).not.toThrow();
    expect(deepest).toBe(20000);
});

test("F200 the walk asks what the recursion asked, in its order, on a branching lattice", () => {
    const M = mk();
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const ids = ["0"];
    for (let n = 0; n < 600; n++) {
        const p = ids[rnd(ids.length)];
        const f = M.cellChild(p, rnd(5) - 2, rnd(5) - 2);
        if (f && !ids.includes(f.id)) ids.push(f.id);
    }
    // A decision from the frame and k alone, so both walks are asked the same questions and prune the same.
    const decide = (f, k) => { let h = k * 31; for (const ch of f.id) h = (h * 33 + ch.charCodeAt(0)) | 0; return (h & 7) !== 0; };
    let views = 0;
    for (const F of ids.filter((x, n) => n % 7 === 0)) {
        const a = [], b = [];
        recursiveWalk(M, F, (f, k, s, x, y, anc) => { a.push([f.id, k, s, x, y, anc.id]); return decide(f, k); });
        M.nearWalk(F, (f, k, s, x, y, anc) => { b.push([f.id, k, s, x, y, anc.id]); return decide(f, k); });
        expect(b).toEqual(a);
        if (a.length > 3) views++;
    }
    expect(views).toBeGreaterThan(20);
});
