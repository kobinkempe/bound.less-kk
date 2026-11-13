/**
 * OPEN-FLAGS F201: a frame re-addressed (`readdressMany`) into a cell another chain holds joins their kids' groups cell by cell
 * (`LevelMap._linkKids`), and one leaving splits them (`_splitKids`), each by a recursion a level. In Chrome, undoing a
 * move of a mark's frame whose chain ran 9,500 levels down beside another overflowed the stack. Both keep their own
 * stack now; these check a 20,000-level join and split, and the same groups as the recursion on branching trees.
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT } from "./frameLattice";

const mk = () => new LevelMap({ base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 }, 800, 600);

// The two walks as they were before F201: the reference for the groups.
function linkKidsRec(r, empty) {
    const at = new Map();
    for (const g of this.cellFrames(r.id)) {
        if (!g._kids) continue;
        for (const [key, cid] of g._kids) {
            const c = this.residentOf(cid), had = at.get(key);
            if (!c || had === c) continue;
            if (!had) { at.set(key, c); continue; }
            const j = this._joinGroups(c, had, empty);
            at.set(key, j);
            this._linkKids(j, empty);
        }
    }
}
function splitKidsRec(A, B) {
    if (!A.length || !B.length) return;
    const inA = new Set(A.map((g) => g.id)), seen = new Set();
    for (const a of A) {
        if (!a._kids) continue;
        for (const cid of a._kids.values()) {
            const r = this.residentOf(cid);
            if (!r || seen.has(r.id)) continue;
            seen.add(r.id);
            const G = this.cellFrames(r.id), A2 = G.filter((g) => inA.has(g.parent)), B2 = G.filter((g) => !inA.has(g.parent));
            if (!B2.length) continue;
            this._regroup(A2); this._regroup(B2);
            this._splitKids(A2, B2);
        }
    }
}

test("F201 a chain 20,000 levels deep joins another cell for cell and leaves it again", () => {
    const M = mk();
    const N = 20000;
    const a = [M.cellChild("0", 5, 5).id], b = [M.cellChild("0", 9, 9).id];
    for (let d = 1; d < N; d++) { a.push(M.cellChild(a[d - 1], 0, 0).id); b.push(M.cellChild(b[d - 1], 0, 0).id); }
    expect(() => M.readdressMany([{ id: b[0], parent: "0", i: 5, j: 5, depth: 1 }])).not.toThrow();
    for (const d of [0, 1, 7000, N - 1]) expect([d, M.sameCell(a[d], b[d])]).toEqual([d, true]);
    expect(() => M.readdressMany([{ id: b[0], parent: "0", i: 9, j: 9, depth: 1 }])).not.toThrow();
    for (const d of [0, 1, 7000, N - 1]) expect([d, M.sameCell(a[d], b[d])]).toEqual([d, false]);
});

test("F201 the joins and splits make the recursion's groups on branching trees", () => {
    const build = (patch) => {
        const M = mk();
        if (patch) { M._linkKids = linkKidsRec; M._splitKids = splitKidsRec; }
        const t1 = M.cellChild("0", 3, 3).id, t2 = M.cellChild("0", 8, 8).id;
        const grow = (top, seed, n, ids) => {
            const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
            for (let s = 0; s < n; s++) { const f = M.cellChild(ids[rnd(ids.length)], rnd(3) - 1, rnd(3) - 1); if (f && !ids.includes(f.id)) ids.push(f.id); }
        };
        const A = [t1], B = [t2];
        // The same shape under both tops first (so the join reaches far down), then each its own.
        const mirror = [];
        let seed = 11;
        const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
        for (let s = 0; s < 250; s++) {
            const n = rnd(A.length), i = rnd(3) - 1, j = rnd(3) - 1;
            const fa = M.cellChild(A[n], i, j), fb = M.cellChild(B[n], i, j);
            if (fa && fb && !A.includes(fa.id)) { A.push(fa.id); B.push(fb.id); mirror.push(s); }
        }
        grow(t1, 23, 120, A); grow(t2, 37, 120, B);
        const groups = (ids) => ids.map((id) => { const r = M.residentOf(id); return [id, r ? r.id : null, r && r._shadows ? [...r._shadows].sort() : []]; });
        M.readdressMany([{ id: t2, parent: "0", i: 3, j: 3, depth: 1 }]);
        const joined = groups(A.concat(B));
        M.readdressMany([{ id: t2, parent: "0", i: 8, j: 8, depth: 1 }]);
        return { joined, after: groups(A.concat(B)), mirrored: mirror.length };
    };
    const ref = build(true), now = build(false);
    expect(ref.mirrored).toBeGreaterThan(100);
    expect(ref.joined.filter(([id, r]) => r !== id).length).toBeGreaterThan(100);   // the join reached far down
    expect(now.joined).toEqual(ref.joined);
    expect(now.after).toEqual(ref.after);
});
