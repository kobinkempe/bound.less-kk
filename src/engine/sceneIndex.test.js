/**
 * The scene index against its oracle (SCENES-PLAN §7.6): random drawings over three frames with
 * mixed widths, long lines, erasures (pieces), moves (partial and whole), a frame re-filed, renames
 * and a save/load round trip — the same scenes (members, ids, names, parents, rows) after every batch.
 * Plus the focused cases the plan lists.
 */
import { SceneIndex, CHUNK, REACH, encodeIds, decodeIds } from "./sceneIndex";
import { SceneOracle } from "./__oracles__/sceneOracle";

function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A polyline as chunk records: boxes of at most CHUNK widths, each with its length. */
function chunks(pts, w) {
    const max = CHUNK * w, out = [];
    let c = null, px = null, py = null;
    const push = () => { if (c) out.push(c[0], c[1], c[2], c[3], Math.max(c[4], w)); c = null; };
    for (const [x, y] of pts) {
        if (c && (Math.max(c[2], x) - Math.min(c[0], x) > max || Math.max(c[3], y) - Math.min(c[1], y) > max)) push();
        if (!c) c = [x, y, x, y, 0];
        else { c[0] = Math.min(c[0], x); c[1] = Math.min(c[1], y); c[2] = Math.max(c[2], x); c[3] = Math.max(c[3], y); }
        if (px != null) c[4] += Math.hypot(x - px, y - py);
        px = x; py = y;
    }
    push();
    return new Float64Array(out);
}
/** Chunk records re-cut so no box is wider than CHUNK widths of `w` (sceneGeom's rule; the grids rely on it). */
function rechunk(raw, w) {
    const max = CHUNK * w, out = [];
    for (let i = 0; i < raw.length; i += 5) {
        const [x0, y0, x1, y1, len] = raw.subarray(i, i + 5);
        const m = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / max));
        for (let k = 0; k < m; k++) out.push(x0 + ((x1 - x0) * k) / m, y0 + ((y1 - y0) * k) / m, x0 + ((x1 - x0) * (k + 1)) / m, y0 + ((y1 - y0) * (k + 1)) / m, Math.max(len / m, w));
    }
    return new Float64Array(out);
}
const line = (x0, y0, x1, y1, n) => { const p = []; for (let i = 0; i <= n; i++) p.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]); return p; };

const FRAMES = [
    { id: "0", parent: null, depth: 0 },
    { id: "1", parent: "0", depth: 1, cx: 0, cy: 0 },
    { id: "0/3,1", parent: "0", depth: 1, cx: 96, cy: 32 },
];

/** The index's scenes in the oracle's shape (`row`: the panel row it is listed under; `parts`: how many). */
function stateOf(ix) {
    const out = {};
    for (const S of ix.scenes) {
        const P = S.parent && ix.scenes.has(S.parent) ? S.parent : null, R = ix.rowOf.get(S);
        out[S.idn.id] = { name: S.idn.name, named: S.idn.named, members: [...S.members].map((m) => m.id).sort((a, b) => a - b), parent: P ? P.idn.id : null, row: R ? R.S.idn.id : S.idn.id, parts: (S.parts || []).length };
    }
    return out;
}

// `extra` (the review of 2026-09-22): a shadow twin of "0/3,1" that merges into it (the frame goes, its
// items re-homed in place), items carried between neighbouring cells, and closed-loop items.
const TWIN = { id: "0/3,1#2", parent: "0", depth: 1, cx: 96, cy: 32 };
const NEXT = { id: "0/1,0", parent: "0", depth: 1, cx: 32, cy: 0 };
export function randomRun(seed, batches, hook, seedsMax, extra = false) {
    const rand = rng(seed);
    const ix = new SceneIndex(), or = new SceneOracle();
    if (seedsMax != null) ix.seedsMax = seedsMax;
    const live = new Map();   // id -> record
    let nextId = 1;
    const FR0 = extra ? FRAMES.concat([TWIN, NEXT]) : FRAMES;
    const frames = FR0.map((f) => ({ ...f }));
    let twinOn = true;
    const apply = (batch) => {
        const a = ix.apply(batch), b = or.apply(batch);
        return { a, b };
    };
    const mk = (near) => {
        let home = rand() < 0.6 ? "0" : rand() < 0.5 ? "1" : "0/3,1";
        if (extra && home !== "0" && rand() < 0.4) home = twinOn && rand() < 0.5 ? TWIN.id : NEXT.id;
        const depth = home === "0" ? 0 : 1;
        // widths: L spread across 10 octaves so some pairs are peers and some nest
        const L = -2 + Math.floor(rand() * 10) - (rand() < 0.3 ? 4 : 0);
        const w = 2 ** (L + 12 * depth);
        const reach = REACH * w;
        let x, y;
        if (near && live.size && rand() < 0.7) {
            const ids = [...live.keys()];
            const o = live.get(ids[Math.floor(rand() * ids.length)]);
            const f = o.raw;
            // somewhere around another item, in this item's home units (roughly)
            const s = o.home === home ? 1 : (o.home === "0" ? 4096 : 1 / 4096);
            x = (f[0] - (o.home === "0" && home === "1" ? 0 : 0)) * s + (rand() - 0.5) * reach * 3;
            y = f[1] * s + (rand() - 0.5) * reach * 3;
            if (!Number.isFinite(x) || Math.abs(x) > 60000) { x = (rand() - 0.5) * 20000; y = (rand() - 0.5) * 20000; }
        } else { x = (rand() - 0.5) * 30000; y = (rand() - 0.5) * 30000; }
        const long = rand() < 0.25;
        const len = long ? CHUNK * w * (2 + rand() * 6) : w * (1 + rand() * 50);
        const ang = rand() * Math.PI * 2;
        const pts = line(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, long ? 40 : 3);
        const r = { id: nextId++, home, w, raw: chunks(pts, w), t: null };
        const n = r.raw.length / 5;
        if (extra && n >= 2 && rand() < 0.35) r.loops = n >= 4 && rand() < 0.4 ? [0, n >> 1] : [0];
        return r;
    };
    const results = [];
    for (let b = 0; b < batches; b++) {
        const items = [], fr = [];
        const renames = [];
        const ops = Math.floor(rand() * 4) + 1;
        for (let o = 0; o < ops; o++) {
            if (extra && rand() < 0.2) {
                if (rand() < 0.5) {
                    // the twin merges into its resident (both at one cell), or comes back empty
                    const res = frames[2];
                    if (twinOn && res.cx === TWIN.cx && res.cy === TWIN.cy) {
                        fr.push({ id: TWIN.id, gone: true }); twinOn = false;
                        for (const [id, r] of live) if (r.home === TWIN.id) { live.set(id, { ...r, home: res.id }); items.push({ id, home: res.id, w: r.w, t: r.t }); }
                    } else if (!twinOn) { fr.push({ ...TWIN }); twinOn = true; }
                } else {
                    // a carry: one frame over, the table taking the difference (the same place)
                    const ids = [...live.keys()].filter((i) => live.get(i).home === "1" || live.get(i).home === NEXT.id);
                    if (!ids.length) continue;
                    const id = ids[Math.floor(rand() * ids.length)], r = live.get(id);
                    const to = r.home === "1" ? NEXT.id : "1", dx = to === NEXT.id ? -131072 : 131072;
                    const t = [(r.t ? r.t[0] : 0) + dx, r.t ? r.t[1] : 0];
                    live.set(id, { ...r, home: to, t });
                    items.push({ id, home: to, w: r.w, t });
                }
                continue;
            }
            const p = rand();
            if (p < 0.45 || live.size < 3) {
                const n = 1 + Math.floor(rand() * 4);
                for (let i = 0; i < n; i++) { const r = mk(true); live.set(r.id, r); items.push(r); }
            } else if (p < 0.55) {
                const ids = [...live.keys()];
                const id = ids[Math.floor(rand() * ids.length)];
                live.delete(id); items.push({ id, gone: true });
            } else if (p < 0.65) {
                // an erase: one item replaced by two pieces
                const ids = [...live.keys()].filter((i) => live.get(i).raw.length >= 10);
                if (!ids.length) continue;
                const id = ids[Math.floor(rand() * ids.length)];
                const o0 = live.get(id);
                live.delete(id); items.push({ id, gone: true });
                const n = o0.raw.length / 5, cut = 1 + Math.floor(rand() * (n - 1));
                let aw = o0.w * (rand() < 0.2 ? 1 / 64 : 1), araw = rechunk(o0.raw.slice(0, 5 * cut), aw);
                if (araw.length > 5 * 64) { aw = o0.w; araw = o0.raw.slice(0, 5 * cut); }   // thin only while short
                const a = { id: nextId++, home: o0.home, w: aw, raw: araw, t: o0.t, hint: id };
                const bb = { id: nextId++, home: o0.home, w: o0.w, raw: o0.raw.slice(5 * Math.min(n - 1, cut + (rand() < 0.5 ? 1 : 0))), t: o0.t, hint: id };
                for (const r of [a, bb]) { if (!r.raw.length) continue; live.set(r.id, r); items.push(r); }
            } else if (p < 0.75) {
                // move a random subset by one displacement
                const ids = [...live.keys()].filter(() => rand() < 0.3);
                const dx = (rand() - 0.5) * 20000, dy = (rand() - 0.5) * 20000;
                for (const id of ids) {
                    const r = live.get(id);
                    const s = r.home === "0" ? 1 : 4096;
                    const t = [(r.t ? r.t[0] : 0) + dx * s, (r.t ? r.t[1] : 0) + dy * s];
                    const nr = { ...r, t, raw: undefined };
                    live.set(id, { ...r, t });
                    items.push({ id, home: r.home, w: r.w, t });
                    void nr;
                }
            } else if (p < 0.83) {
                // move one whole scene (every member) — the rigid path
                const st = stateOf(ix);
                const keys = Object.keys(st);
                if (!keys.length) continue;
                const mem = st[keys[Math.floor(rand() * keys.length)]].members;
                const dx = (rand() - 0.5) * 40000, dy = (rand() - 0.5) * 40000;
                for (const id of mem) {
                    const r = live.get(id);
                    if (!r) continue;
                    const s = r.home === "0" ? 1 : 4096;
                    const t = [(r.t ? r.t[0] : 0) + dx * s, (r.t ? r.t[1] : 0) + dy * s];
                    live.set(id, { ...r, t });
                    items.push({ id, home: r.home, w: r.w, t });
                }
            } else if (p < 0.9) {
                // re-shaped in place: a chunk dropped from the end
                const ids = [...live.keys()].filter((i) => live.get(i).raw.length >= 10);
                if (!ids.length) continue;
                const id = ids[Math.floor(rand() * ids.length)];
                const r = live.get(id);
                const nr = { ...r, raw: r.raw.slice(0, r.raw.length - 5) };
                live.set(id, nr);
                items.push({ id, home: nr.home, w: nr.w, raw: nr.raw, t: nr.t });
            } else if (p < 0.95) {
                // the frame "0/3,1" re-filed a little (a subtree move): its items move with it
                const f = frames[2];
                f.cx += Math.round((rand() - 0.5) * 8); f.cy += Math.round((rand() - 0.5) * 8);
                fr.push({ ...f });
            } else {
                const keys = Object.keys(stateOf(ix));
                if (keys.length) renames.push([keys[Math.floor(rand() * keys.length)], "name " + b]);
            }
        }
        // one record per id, last wins (the client's dirty set is a set)
        const seen = new Map();
        for (const r of items) {
            const had = seen.get(r.id);
            // a record for an id added in this batch keeps its geometry (the client sends it until the index has it)
            seen.set(r.id, had && !r.gone ? { ...had, ...r, raw: r.raw || had.raw, hint: had.hint } : r);
        }
        // one record per frame, the last (the client's frame diff sends the frame as it is: gone and back is an update)
        const fseen = new Map();
        for (const f of b === 0 ? FR0.map((q) => ({ ...q })).concat(fr) : fr) { fseen.delete(f.id); fseen.set(f.id, f); }
        const batch = { frames: [...fseen.values()], items: [...seen.values()], renames };
        if (hook) hook(b, batch, ix, or);
        const { b: ob } = apply(batch);
        results.push({ batch: b, idx: stateOf(ix), orc: ob });
    }
    return { ix, or, results, live, frames };
}

describe("packed memory (2026-09-23): the pools and grids moved and compacted between every batch change nothing", () => {
    // every batch starts from pools and grids rebuilt (each region moved, each grid's segments re-laid)
    const every = (b, batch, ix) => { ix._compact(true); };
    for (const seed of [1, 3, 9, 31, 35]) {
        test(`seed ${seed}${seed > 30 ? " (frames merging away, carries, loops)" : ""}`, () => {
            const { results } = randomRun(seed, 24, every, null, seed > 30);
            for (const r of results) expect(Object.entries(r.idx).sort()).toEqual(Object.entries(r.orc).sort());
        });
    }
    test("a removal keeps the order of what is left in each cell; an emptied cell stays until its grid is compacted", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60), stroke(0, 120, 300, 120), stroke(1000, 120, 1300, 120)];   // the last alone in cells past x 1,024
        ix.apply({ items: a });
        const S = sceneOf(ix, a[0].id), G = S.grid;
        const cellsOf = () => { const out = new Map(); for (const t of G.all.values()) for (let i = 0; i < t.keys.length; i++) if (t.keys[i] >= 0) out.set(t.keys[i], Array.from(G.P.subarray(t.segs[i] + 2, t.segs[i] + 2 + G.P[t.segs[i] + 1]))); return out; };
        const before = cellsOf(), s3 = ix.items.get(a[3].id).slot;
        ix.apply({ items: [{ id: a[3].id, gone: true }] });                 // the last: one scene still, no split
        expect(sceneOf(ix, a[0].id).grid).toBe(G);
        const after = cellsOf();
        expect([...after.keys()].sort()).toEqual([...before.keys()].sort());  // no cell dropped
        let emptied = 0;
        for (const [k, es] of after) {
            expect(es).toEqual(before.get(k).filter((e) => Math.floor(e / 2048) !== s3));   // the rest, in the same order
            if (!es.length) emptied++;
        }
        expect(emptied).toBeGreaterThan(0);
        const kept = new Map([...after].filter(([, es]) => es.length));
        ix._compact(true);
        expect(cellsOf()).toEqual(kept);                                     // compacted: the empties gone, the rest as they were
    });
    test("a single member out (a restore's too-wide member) keeps the order of what is left", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60), stroke(0, 120, 300, 120), stroke(0, 180, 300, 180)];
        ix.apply({ items: a });
        const S = sceneOf(ix, a[0].id), G = S.grid;
        const cellsOf = () => { const out = new Map(); for (const t of G.all.values()) for (let i = 0; i < t.keys.length; i++) if (t.keys[i] >= 0) out.set(t.keys[i], Array.from(G.P.subarray(t.segs[i] + 2, t.segs[i] + 2 + G.P[t.segs[i] + 1]))); return out; };
        const before = cellsOf(), x = ix.items.get(a[1].id);
        ix._unfile(S, x);
        for (const [k, es] of cellsOf()) expect(es).toEqual(before.get(k).filter((e) => Math.floor(e / 2048) !== x.slot));
    });
});

describe("the index equals the brute-force oracle on random drawings", () => {
    test.each([[1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [12], [13]])("seed %i: members, ids, names and parents after every batch", (seed) => {
        const { results } = randomRun(seed, 28);
        for (const r of results) {
            expect({ batch: r.batch, scenes: r.idx }).toEqual({ batch: r.batch, scenes: r.orc });
        }
    });
    test.each([[21], [22], [23]])("seed %i with every split check a full labelling (the dense path)", (seed) => {
        const { results } = randomRun(seed, 24, null, 1);
        for (const r of results) expect({ batch: r.batch, scenes: r.idx }).toEqual({ batch: r.batch, scenes: r.orc });
    });
    test.each([[31], [32], [33], [34], [35], [36], [37], [38]])("seed %i with frames merging away, carries and closed loops", (seed) => {
        const { results } = randomRun(seed, 28, null, null, true);
        for (const r of results) expect({ batch: r.batch, scenes: r.idx }).toEqual({ batch: r.batch, scenes: r.orc });
    });
    test("a save/load round trip restores the same scenes, and they go on agreeing", () => {
        const { ix, or, live, frames } = randomRun(11, 20);
        const saved = JSON.parse(JSON.stringify(ix.exportState()));
        const ix2 = new SceneIndex();
        ix2.apply({ restore: { state: saved }, frames: frames.map((f) => ({ ...f })), items: [...live.values()].map((r) => ({ ...r })) });
        expect(stateOf(ix2)).toEqual(stateOf(ix));
        // the next batch lands the same in the restored index and the oracle
        const r = { id: 100000, home: "0", w: 1, raw: chunks(line(0, 0, 300, 0, 3), 1), t: null };
        ix2.apply({ items: [r] }); const o = or.apply({ items: [r] });
        expect(stateOf(ix2)).toEqual(o);
    });
});

describe("member strings", () => {
    test("encode/decode round-trips sorted ids with runs", () => {
        const ids = [5, 6, 7, 10, 11, 40, 1000, 1001, 1002, 1003, 99999];
        const s = encodeIds(ids.slice().reverse());
        expect(decodeIds(s)).toEqual(ids);
        expect(s.length).toBeLessThan(40);
    });
});

// ---- focused cases (SCENES-PLAN §6 edge cases, §7.6) ----
const F0 = [{ id: "0", parent: null, depth: 0 }, { id: "1", parent: "0", depth: 1, cx: 0, cy: 0 }];
let uid = 1000;
const dot = (x, y, w = 1, home = "0") => ({ id: ++uid, home, w, raw: chunks([[x, y], [x + w, y]], w), t: null });
const stroke = (x0, y0, x1, y1, w = 1, home = "0", n = 20) => ({ id: ++uid, home, w, raw: chunks(line(x0, y0, x1, y1, n), w), t: null });
const byMembers = (ix) => [...ix.scenes].map((S) => [...S.members].map((m) => m.id).sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
const sceneOf = (ix, id) => ix.items.get(id).scene;
const fresh = () => { const ix = new SceneIndex(); ix.apply({ frames: F0 }); return ix; };

describe("focused: joining, bridging, splitting", () => {
    test("two drawings 3,000 widths apart are two scenes; ink between that closes every gap merges them", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 50, 300, 50), stroke(0, 100, 300, 100)];
        const b = [stroke(3300, 0, 3600, 0)];
        ix.apply({ items: [...a, ...b] });
        expect(ix.scenes.size).toBe(2);
        const A = sceneOf(ix, a[0].id), B = sceneOf(ix, b[0].id);
        const aId = A.idn.id, bName = B.idn.name;
        ix.apply({ items: [stroke(700, 0, 2600, 0, 1, "0", 30)] });   // gaps 400 and 700, under 900 widths
        expect(ix.scenes.size).toBe(1);
        const S = sceneOf(ix, b[0].id);
        expect(S.idn.id).toBe(aId);                                   // more ink keeps the id
        expect(ix.tombs.some((t) => t.name === bName)).toBe(true);   // the other name is kept aside
    });
    test("one long line alone between two drawings does not merge them (a stray run)", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60)];
        const b = [stroke(5000, 0, 5300, 0)];
        ix.apply({ items: [...a, ...b] });
        ix.apply({ items: [stroke(300, 30, 5000, 30, 1, "0", 80)] });   // 3,800 widths of empty paper in between
        expect(ix.scenes.size).toBe(2);
        // ...and a drawing started later at the far end of the line does not join through it either
        const ix2 = fresh();
        const line1 = stroke(300, 30, 5000, 30, 1, "0", 80);
        ix2.apply({ items: [...a.map((r) => ({ ...r, id: r.id + 50000 })), line1] });
        expect(ix2.scenes.size).toBe(1);
        ix2.apply({ items: [stroke(5100, 30, 5300, 30)] });
        expect(ix2.scenes.size).toBe(2);
    });
    test("erasing the bridge splits: the heavier part keeps id and name, the other is a new scene", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 40, 300, 40), stroke(0, 80, 300, 80)];
        const b = [stroke(2200, 0, 2400, 0)];
        const bridge = stroke(300, 0, 2200, 0, 1, "0", 30);
        ix.apply({ items: [...a, ...b, bridge] });
        expect(ix.scenes.size).toBe(1);
        const S = sceneOf(ix, a[0].id);
        ix.rename(S.idn.id, "Tree");
        ix.apply({ items: [{ id: bridge.id, gone: true }] });
        expect(ix.scenes.size).toBe(2);
        expect(sceneOf(ix, a[0].id).idn.name).toBe("Tree");
        expect(sceneOf(ix, b[0].id).idn.name).toMatch(/^Scene \d+$/);
    });
    test("a single dot far from everything is its own scene, framed on itself: the dot and 10 % (Kobin 2026-09-23: no minimum)", () => {
        const ix = fresh();
        ix.apply({ items: [stroke(0, 0, 300, 0)] });
        const d = dot(900000, 900000, 1);                        // a box one width long, no height
        const out = ix.apply({ items: [d] });
        expect(ix.scenes.size).toBe(2);
        const rec = out.scenes.find((r) => r.id === sceneOf(ix, d.id).idn.id);
        expect(rec.rect.w).toBeCloseTo(1.2, 9);                  // the ink, at least one width each way, and 10 %
        expect(rec.rect.h).toBeCloseTo(1.2, 9);
        expect(rec.rect.x + rec.rect.w / 2).toBeCloseTo(900000.5, 6);
        expect(rec.rect.y + rec.rect.h / 2).toBeCloseTo(900000, 6);
    });
});

describe("focused: 16× nesting both ways", () => {
    test("fine detail more than 16× thinner on a coarse drawing is a child scene", () => {
        const ix = fresh();
        const coarse = stroke(0, 0, 20000, 0, 32, "0", 10);
        ix.apply({ items: [coarse] });
        const fine = [stroke(10000, 10, 10100, 10, 1), stroke(10000, 30, 10100, 30, 1)];   // 32× thinner
        const out = ix.apply({ items: fine });
        expect(ix.scenes.size).toBe(2);
        const kid = out.scenes.find((r) => r.id === sceneOf(ix, fine[0].id).idn.id);
        expect(kid.parent).toBe(sceneOf(ix, coarse.id).idn.id);
        expect(kid.depth).toBe(1);
    });
    test("a big picture drawn later around a small one makes it a child, id and name kept", () => {
        const ix = fresh();
        const small = [stroke(0, 0, 100, 0, 1), stroke(0, 20, 100, 20, 1)];
        ix.apply({ items: small });
        const s = sceneOf(ix, small[0].id);
        ix.rename(s.idn.id, "Ladybird");
        const daisy = [stroke(-30000, -30000, 30000, -30000, 64, "0", 20), stroke(-30000, 30000, 30000, 30000, 64, "0", 20),
            stroke(-30000, -30000, -30000, 30000, 64, "0", 20), stroke(30000, -30000, 30000, 30000, 64, "0", 20)];
        const out = ix.apply({ items: daisy });
        const rec = out.scenes.find((r) => r.name === "Ladybird");
        expect(rec).toBeTruthy();
        expect(rec.id).toBe(s.idn.id);
        expect(rec.parent).toBe(sceneOf(ix, daisy[0].id).idn.id);
    });
    test("pieces of an erased stroke 16× thinner than its scene leave it for a child scene", () => {
        const ix = fresh();
        const s = stroke(0, 0, 3000, 0, 16, "0", 30);
        const t = stroke(0, 400, 3000, 400, 16, "0", 30);
        ix.apply({ items: [s, t] });
        expect(ix.scenes.size).toBe(1);
        const crumb = { id: ++uid, home: "0", w: 0.5, raw: chunks([[1500, 0], [1500.5, 0]], 0.5), t: null, hint: s.id };
        const rest = { id: ++uid, home: "0", w: 16, raw: s.raw.slice(0, 10), t: null, hint: s.id };
        ix.apply({ items: [{ id: s.id, gone: true }, crumb, rest] });
        expect(sceneOf(ix, rest.id)).toBe(sceneOf(ix, t.id));            // storage keeps its scene
        expect(sceneOf(ix, crumb.id)).not.toBe(sceneOf(ix, t.id));       // a 32× thinner crumb is detail
    });
});

describe("focused: moves", () => {
    test("moving a whole scene changes its origin and frame, not its hash, and touches no grid cell", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 50, 300, 50)];
        const b = [stroke(90000, 0, 90300, 0)];
        const out0 = ix.apply({ items: [...a, ...b] });
        const S = sceneOf(ix, a[0].id);
        const r0 = out0.scenes.find((r) => r.id === S.idn.id);
        const spy = jest.spyOn(ix, "_cells");
        const out = ix.apply({ items: a.map((r) => ({ id: r.id, home: "0", w: r.w, t: [20000, 5000] })) });
        expect(spy).not.toHaveBeenCalled();
        const r1 = out.scenes.find((r) => r.id === S.idn.id);
        expect(r1.hash).toBe(r0.hash);
        expect(r1.rect.x - r0.rect.x).toBeCloseTo(20000, 6);
        expect(r1.rect.y - r0.rect.y).toBeCloseTo(5000, 6);
        spy.mockRestore();
    });
    test("a moved scene landing within reach of another merges with it", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0)], b = [stroke(90000, 0, 90300, 0), stroke(90000, 50, 90300, 50)];
        ix.apply({ items: [...a, ...b] });
        expect(ix.scenes.size).toBe(2);
        ix.apply({ items: a.map((r) => ({ id: r.id, home: "0", w: r.w, t: [89000, 0] })) });
        expect(ix.scenes.size).toBe(1);
    });
    test("part of a scene dragged far away leaves it; the rest stays", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 50, 300, 50), stroke(0, 100, 300, 100)];
        ix.apply({ items: a });
        const id = sceneOf(ix, a[0].id).idn.id;
        ix.apply({ items: [{ id: a[2].id, home: "0", w: 1, t: [500000, 0] }] });
        expect(ix.scenes.size).toBe(2);
        expect(sceneOf(ix, a[0].id).idn.id).toBe(id);
    });
    test("a frame re-filed (the O(1) subtree move) carries its scene whole: same hash, re-joins where it lands", () => {
        const ix = fresh();
        const fr = { id: "0/5,0", parent: "0", depth: 1, cx: 160, cy: 0 };
        ix.apply({ frames: [fr] });
        const deep = [stroke(0, 0, 3000, 0, 4096, "0/5,0", 10), stroke(0, 800, 3000, 800, 4096, "0/5,0", 10)];
        const top = [stroke(3000, 0, 3300, 0, 1, "0")];
        const out0 = ix.apply({ items: [...deep, ...top] });
        expect(ix.scenes.size).toBe(2);
        const S = sceneOf(ix, deep[0].id);
        const h0 = out0.scenes.find((r) => r.id === S.idn.id).hash;
        const out1 = ix.apply({ frames: [{ ...fr, cx: 192 }] });   // one cell over: 32 units at depth 0
        expect(out1.scenes.find((r) => r.id === S.idn.id).hash).toBe(h0);
        expect(ix.scenes.size).toBe(2);
        ix.apply({ frames: [{ ...fr, cx: 2600 }] });              // lands within reach of the top-level stroke
        expect(ix.scenes.size).toBe(1);
    });
    test("a settle is a no-op: the frame shift moves into the tables and nothing changes", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0, 1, "1"), stroke(0, 50, 300, 50, 1, "1")];
        ix.apply({ items: a });
        // the pending shift is set (a subtree move remainder): the items move with it, whole
        const o1 = ix.apply({ frames: [{ ...F0[1], sx: 700, sy: 0 }] });
        const h1 = o1.scenes[0].hash, x1 = o1.scenes[0].rect.x;
        // ...and settled: the shift cleared, each table takes it
        const o2 = ix.apply({ frames: [{ ...F0[1], sx: 0, sy: 0 }], items: a.map((r) => ({ id: r.id, home: "1", w: r.w, t: [700, 0] })) });
        expect(o2.scenes[0].hash).toBe(h1);
        expect(o2.scenes[0].rect.x).toBeCloseTo(x1, 9);
        expect(o2.changed).toEqual([]);
    });
});

describe("focused: names", () => {
    test("a renamed scene merging with a heavier unnamed one keeps its id and name (Kobin, 2026-09-22)", () => {
        const ix = fresh();
        const small = [stroke(0, 0, 100, 0)];
        const big = [stroke(1200, 0, 2200, 0), stroke(1200, 40, 2200, 40), stroke(1200, 80, 2200, 80)];
        ix.apply({ items: [...small, ...big] });
        expect(ix.scenes.size).toBe(2);
        const s = sceneOf(ix, small[0].id);
        ix.rename(s.idn.id, "Mine");
        ix.apply({ items: [stroke(100, 0, 1200, 0)] });
        expect(ix.scenes.size).toBe(1);
        expect(sceneOf(ix, big[0].id).idn.name).toBe("Mine");
        expect(sceneOf(ix, big[0].id).idn.id).toBe(s.idn.id);
    });
    test("erasing a whole named scene keeps its name aside; undo brings it back with its id", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 50, 300, 50)];
        ix.apply({ items: a });
        const S = sceneOf(ix, a[0].id);
        ix.rename(S.idn.id, "Boat");
        const id = S.idn.id;
        ix.apply({ items: a.map((r) => ({ id: r.id, gone: true })) });
        expect(ix.scenes.size).toBe(0);
        ix.apply({ items: a.map((r) => ({ ...r })) });
        expect(ix.scenes.size).toBe(1);
        expect(sceneOf(ix, a[0].id).idn.id).toBe(id);
        expect(sceneOf(ix, a[0].id).idn.name).toBe("Boat");
    });
    test("a rename survives a save and load", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 50, 300, 50)], b = [stroke(90000, 0, 90300, 0)];
        ix.apply({ items: [...a, ...b] });
        ix.rename(sceneOf(ix, a[0].id).idn.id, "Harbour");
        const st = JSON.parse(JSON.stringify(ix.exportState()));
        const ix2 = new SceneIndex();
        const out = ix2.apply({ restore: { state: st }, frames: F0, items: [...a, ...b] });
        expect(out.scenes.map((r) => r.name).sort()).toEqual(ix.records().map((r) => r.name).sort());
        expect(out.scenes.find((r) => r.name === "Harbour").id).toBe(sceneOf(ix, a[0].id).idn.id);
        expect(byMembers(ix2)).toEqual(byMembers(ix));
    });
    test("a restore files saved members straight in, and inserts what the saved index never saw", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 50, 300, 50)];
        ix.apply({ items: a });
        const st = { ...ix.exportState(), dirty: [] };
        const extra = stroke(0, 100, 300, 100);
        const ix2 = new SceneIndex();
        const spy = jest.spyOn(ix2, "_insert");
        ix2.apply({ restore: { state: st }, frames: F0, items: [...a, extra] });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(byMembers(ix2)).toEqual([[a[0].id, a[1].id, extra.id]]);
        spy.mockRestore();
    });
    test("a first build over an old file carries the old scenes' ids and names by frame overlap", () => {
        const a = [stroke(0, 0, 300, 0), stroke(0, 50, 300, 50)], b = [stroke(90000, 0, 90300, 0)];
        const legacy = [
            { id: "s7", seq: 7, name: "Old A", named: true, anchor: "0", rect: { x: -20, y: -20, w: 340, h: 100 } },
            { id: "s9", seq: 9, name: "Scene 9", named: false, anchor: "0", rect: { x: 200000, y: 0, w: 10, h: 10 } },
        ];
        const ix = new SceneIndex();
        const out = ix.apply({ restore: { legacy, seq: 10 }, frames: F0, items: [...a, ...b] });
        const A = out.scenes.find((r) => r.name === "Old A");
        expect(A && A.id).toBe("s7");
        expect(A.pinned).toBe(true);
        expect(out.scenes.some((r) => r.id === "s9")).toBe(false);          // pointing at empty paper: dropped
        expect(out.scenes.find((r) => r.id !== "s7").id).toBe("s11");       // new ids continue past the old ones (s10 became s7)
    });
});

describe("phase 2: parts and regions", () => {
    // a panorama: strokes side by side along 20,000 widths, each within reach of the next
    const panorama = (x0 = 0, n = 40, gap = 500) => { const out = []; for (let i = 0; i < n; i++) out.push(stroke(x0 + i * gap, 0, x0 + i * gap + 300, 200, 1, "0", 6)); return out; };
    test("a panorama is one scene with part records, each no wider than MAX_SPAN_PX, cut at the emptiest places", () => {
        const ix = fresh();
        const out = ix.apply({ items: panorama(0, 24) });        // under the 12-part cap
        const scenesOnly = out.scenes.filter((r) => !r.kind);
        expect(scenesOnly.length).toBe(1);
        const parts = out.scenes.filter((r) => r.kind === "part");
        expect(parts.length).toBeGreaterThanOrEqual(6);
        expect(parts.length).toBeLessThanOrEqual(12);
        for (const p of parts) { expect(p.parent).toBe(scenesOnly[0].id); expect(Math.max(p.rect.w, p.rect.h)).toBeLessThanOrEqual(1800 * 1.25); }
        expect(out.scenes.indexOf(parts[0])).toBe(1);            // listed right under their scene
    });
    test("the cut falls in the emptiest place between two dense halves", () => {
        const ix = fresh();
        const left = [], right = [];
        for (let i = 0; i < 30; i++) left.push(stroke(i * 40, 0, i * 40 + 30, 30, 1, "0", 3));
        for (let i = 0; i < 30; i++) right.push(stroke(2000 + i * 40, 0, 2000 + i * 40 + 30, 30, 1, "0", 3));
        const bridge = [stroke(1200, 0, 1500, 0, 1, "0", 3), stroke(1600, 0, 1900, 0, 1, "0", 3)];
        const out = ix.apply({ items: [...left, ...right, ...bridge] });
        const parts = out.scenes.filter((r) => r.kind === "part");
        expect(parts.length).toBe(2);
        const [a, b] = parts.sort((p, q) => p.rect.x - q.rect.x);
        expect(a.rect.x + a.rect.w).toBeGreaterThan(1150);       // the left half keeps its own ink and the near bridge
        expect(b.rect.x).toBeLessThan(2000);
    });
    test("a scene moved whole keeps its parts' ids; a renamed part keeps its name through a save and load", () => {
        const ix = fresh();
        const items = panorama();
        const out0 = ix.apply({ items });
        const p0 = out0.scenes.filter((r) => r.kind === "part");
        ix.rename(p0[2].id, "Bridge");
        const out1 = ix.apply({ items: items.map((r) => ({ id: r.id, home: "0", w: 1, t: [5000, 3000] })) });
        const p1 = out1.scenes.filter((r) => r.kind === "part");
        expect(p1.map((p) => p.id)).toEqual(p0.map((p) => p.id));
        expect(p1[2].name).toBe("Bridge");
        const ix2 = new SceneIndex();
        const moved = items.map((r) => ({ ...r, t: [5000, 3000] }));
        const out2 = ix2.apply({ restore: { state: JSON.parse(JSON.stringify(ix.exportState())) }, frames: F0, items: moved });
        const p2 = out2.scenes.filter((r) => r.kind === "part");
        expect(p2.map((p) => p.id)).toEqual(p0.map((p) => p.id));
        expect(p2.find((p) => p.name === "Bridge")).toBeTruthy();
    });
    test("more than MAX_SIBLINGS scenes side by side are grouped into regions, each scene listed under one", () => {
        const ix = fresh();
        const dots = [];
        for (let i = 0; i < 45; i++) dots.push(stroke(i * 5000, (i % 3) * 5000, i * 5000 + 50, (i % 3) * 5000, 1, "0", 2));
        const out = ix.apply({ items: dots });
        const regions = out.scenes.filter((r) => r.kind === "region");
        const scenesOnly = out.scenes.filter((r) => !r.kind);
        expect(scenesOnly.length).toBe(45);
        expect(regions.length).toBeGreaterThanOrEqual(3);
        for (const r of regions) expect(scenesOnly.filter((s) => s.region === r.id).length).toBeLessThanOrEqual(20);
        for (const s of scenesOnly) { expect(s.region).toBeTruthy(); expect(s.depth).toBe(1); }
        // a change elsewhere keeps the regions' ids
        const again = ix.apply({ items: [stroke(0, 90000, 50, 90000, 1, "0", 2)] });
        const ids = again.scenes.filter((r) => r.kind === "region").map((r) => r.id);
        for (const r of regions) expect(ids).toContain(r.id);
    });
});

describe("focused: storage and landing", () => {
    test("a moved scene merges only with what its own ink lands on, not through ink it merged", () => {
        const ix = fresh();
        // T1: a drawing and a long line out of it, whose far end is stray; T2 at that far end, apart
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60)];
        const lineOut = stroke(300, 30, 5000, 30, 1, "0", 80);
        const t2 = [stroke(5100, 30, 5300, 30)];
        ix.apply({ items: [...a, lineOut, ...t2] });
        expect(ix.scenes.size).toBe(2);
        // S: a diagonal far away, moved whole so it lands touching the drawing, its box reaching T2's
        const s = stroke(-500, 100000, 4300, 102000, 1, "0", 80);
        ix.apply({ items: [s] });
        expect(ix.scenes.size).toBe(3);
        ix.apply({ items: [{ id: s.id, home: "0", w: 1, t: [0, -100000] }] });
        expect(sceneOf(ix, s.id)).toBe(sceneOf(ix, a[0].id));      // landed on the drawing
        expect(sceneOf(ix, t2[0].id)).not.toBe(sceneOf(ix, a[0].id)); // and nothing through the stray line
    });
});

describe("review 2026-09-22: frames that go, re-joins, identity, outlines", () => {
    const RES = { id: "0/5,0", parent: "0", depth: 1, cx: 160, cy: 0 };
    const SHADOW = { id: "0/5,0#2", parent: "0", depth: 1, cx: 160, cy: 0 };
    const deep = (x0, y0, x1, y1, home) => stroke(x0, y0, x1, y1, 4096, home, 10);   // L 0 at depth 1
    const rehome = (r, home) => ({ id: r.id, home, w: r.w, t: r.t });
    test("a shadow frame merged into its resident keeps its scene's id and name (and a member already there)", () => {
        const ix = fresh();
        ix.apply({ frames: [RES, SHADOW] });
        const moth = [deep(0, 0, 3000, 0, SHADOW.id), deep(0, 800, 3000, 800, SHADOW.id), deep(0, 1600, 3000, 1600, SHADOW.id)];
        const already = deep(0, 2400, 3000, 2400, RES.id);
        ix.apply({ items: [...moth, already] });
        expect(ix.scenes.size).toBe(1);
        const S = sceneOf(ix, moth[0].id);
        ix.rename(S.idn.id, "Moth");
        ix.apply({ frames: [{ id: SHADOW.id, gone: true }], items: moth.map((r) => rehome(r, RES.id)) });
        expect(ix.scenes.size).toBe(1);
        expect(sceneOf(ix, moth[0].id).idn.name).toBe("Moth");
        expect(sceneOf(ix, already.id)).toBe(sceneOf(ix, moth[0].id));
    });
    test("a name kept aside in a frame that later merges away still comes back", () => {
        const ix = fresh();
        ix.apply({ frames: [RES, SHADOW] });
        const kite = [deep(0, 0, 3000, 0, SHADOW.id), deep(0, 800, 3000, 800, SHADOW.id)];
        ix.apply({ items: kite });
        ix.rename(sceneOf(ix, kite[0].id).idn.id, "Kite");
        ix.apply({ items: kite.map((r) => ({ id: r.id, gone: true })) });   // erased: the name is kept aside
        ix.apply({ frames: [{ id: SHADOW.id, gone: true }] });             // its frame merges away
        ix.apply({ items: kite.map((r) => ({ ...r, home: RES.id })) });     // undone, now homed in the resident
        expect(sceneOf(ix, kite[0].id).idn.name).toBe("Kite");
    });
    test("a whole scene nudged against a stray line does not merge through it (SCENES-PLAN §6 rows 3–4)", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60)];
        const lineOut = stroke(300, 30, 5000, 30, 1, "0", 80);
        const b = [stroke(5100, 30, 5300, 30), stroke(5100, 90, 5300, 90)];
        ix.apply({ items: [...a, lineOut, ...b] });
        expect(ix.scenes.size).toBe(2);
        ix.apply({ items: b.map((r) => ({ id: r.id, home: "0", w: r.w, t: [-10, 0] })) });   // ten widths closer
        expect(ix.scenes.size).toBe(2);
    });
    test("a scene moved and partly erased in one batch moves whole: it keeps its id and name", () => {
        const ix = fresh();
        const s = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60), stroke(0, 120, 300, 120)];
        ix.apply({ items: s });
        ix.rename(sceneOf(ix, s[0].id).idn.id, "Boat");
        ix.apply({ items: [{ id: s[0].id, gone: true }, ...s.slice(1).map((r) => ({ id: r.id, home: "0", w: 1, t: [90000, 0] }))] });
        expect(ix.scenes.size).toBe(1);
        expect(sceneOf(ix, s[1].id).idn.name).toBe("Boat");
    });
    test("a scene whose members all moved apart-then-together keeps its id and name in the scene that holds most of them", () => {
        const ix = fresh();
        const s = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60)];
        ix.apply({ items: s });
        ix.rename(sceneOf(ix, s[0].id).idn.id, "Kite");
        ix.apply({ items: [{ id: s[0].id, home: "0", w: 1, t: [90000, 0] }, { id: s[1].id, home: "0", w: 1, t: [90100, 40] }] });
        expect(ix.scenes.size).toBe(1);
        expect(sceneOf(ix, s[0].id).idn.name).toBe("Kite");
    });
    test("after the anchor frame moved and the scene went into another, its name comes back to its old place", () => {
        const ix = fresh();
        ix.apply({ frames: [RES] });
        const kite = [deep(0, 0, 3000, 0, RES.id), deep(0, 800, 3000, 800, RES.id)];
        const other = [stroke(90000, 0, 90300, 0), stroke(90000, 60, 90300, 60), stroke(90000, 120, 90300, 120)];
        ix.apply({ items: [...kite, ...other] });
        ix.rename(sceneOf(ix, kite[0].id).idn.id, "Kite");
        // the frame is re-filed (+32 at depth 0) and the members' tables differ: not a whole move; they land in `other`
        ix.apply({ frames: [{ ...RES, cx: 160 + 89800 }], items: [{ id: kite[0].id, home: RES.id, w: 4096, t: [0, 0] }, { id: kite[1].id, home: RES.id, w: 4096, t: [4096 * 50, 0] }] });
        expect(sceneOf(ix, kite[0].id)).toBe(sceneOf(ix, other[0].id));
        // moved back where they were: they leave `other` and the name returns
        ix.apply({ frames: [RES], items: kite.map((r) => ({ id: r.id, home: RES.id, w: 4096, t: [0, 0] })) });
        expect(sceneOf(ix, kite[0].id).idn.name).toBe("Kite");
    });
    test("an outline's stray runs and contact groups do not depend on where its loop starts", () => {
        // a line A→B drawn as a closed outline (out along one side, back along the other), its loop started
        // part-way along the side near A: A's contacts sit at both ends of the chunk list
        const outline = (x0, x1, y, w, rot) => {
            const side = (xa, xb, yy) => { const p = []; const n = Math.ceil(Math.abs(xb - xa) / (CHUNK * w)); for (let i = 0; i < n; i++) { const u0 = xa + ((xb - xa) * i) / n, u1 = xa + ((xb - xa) * (i + 1)) / n; p.push(Math.min(u0, u1), yy - w / 2, Math.max(u0, u1), yy + w / 2, Math.abs(u1 - u0)); } return p; };
            const cap = [x1, y - w, x1 + 1, y + w, 2 * w];   // the far cap: one chunk, so B's contact is odd
            const all = side(x0, x1, y + w).concat(cap, side(x1, x0, y - w));
            const n = all.length / 5, k = rot % n;
            const rolled = all.slice(5 * k).concat(all.slice(0, 5 * k));
            return { id: ++uid, home: "0", w, raw: new Float64Array(rolled), t: null, loops: [0] };
        };
        const run = (rot) => {
            const ix = fresh();
            const a = [stroke(-400, 0, -100, 0), stroke(-400, 60, -100, 60)];
            const b = [stroke(6450, 0, 6750, 0), stroke(6450, 60, 6750, 60), stroke(6450, 120, 6750, 120), stroke(6450, 180, 6750, 180)];
            ix.apply({ items: [...a, ...b] });
            const line = outline(0, 6000, 30, 1, rot);
            ix.apply({ items: [line] });
            return sceneOf(ix, line.id) === sceneOf(ix, a[0].id) ? "A" : sceneOf(ix, line.id) === sceneOf(ix, b[0].id) ? "B" : "own";
        };
        const got = [0, 1, 2, 3, 5, 8, 11, 17, 19, 20].map(run);
        expect(got).toEqual(got.map(() => "A"));   // A touches four chunks across the loop's start, B three
    });
    test("a scene moved whole and merged by a new stroke re-joins through its moved ink only, not the ink it merged with", () => {
        // U = u (1 wide) + big (16 wide); c (0.5 wide) touches u but is five octaves from big: its own scene.
        // In one batch big goes (U's range shrinks, nothing re-clusters), R lands 1,600 below u, and n bridges u and R.
        const u = stroke(0, 0, 300, 0), big = stroke(0, 200, 300, 200, 16), c = stroke(0, -500, 300, -500, 0.5);
        const r = stroke(20000, 0, 20300, 0);
        const n = stroke(0, 800, 300, 800);
        const batches = [{ items: [u, big, c, r] }, { items: [{ id: big.id, gone: true }, { id: r.id, home: "0", w: 1, t: [-20000, 1600] }, n] }];
        const ix = fresh(), or = new SceneOracle();
        or.apply({ frames: F0 });
        for (const b of batches) { ix.apply(b); or.apply(b); }
        expect(sceneOf(ix, r.id)).toBe(sceneOf(ix, u.id));
        expect(sceneOf(ix, c.id)).not.toBe(sceneOf(ix, u.id));
        expect(byMembers(ix)).toEqual([[u.id, r.id, n.id].sort((a, b) => a - b), [c.id]].sort((a, b) => a[0] - b[0]));
        expect(byMembers(ix)).toEqual([...or.scenes.values()].map((S) => [...S.members].map((m) => m.id).sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]));
    });
});

describe("review 2026-09-22: nits", () => {
    test("a member string's ids are bounded in all, not per run", () => {
        const s = Array(5).fill("1.go").join(",");   // five runs of 601
        expect(decodeIds(s).length).toBe(3005);
        expect(decodeIds(s, 1000).length).toBeLessThanOrEqual(1000);
    });
    test("a picture key never repeats in a session restored from the same save; one restored untouched keeps its key", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60)], b = [stroke(90000, 0, 90300, 0)];
        ix.apply({ items: [...a, ...b] });
        const saved = JSON.parse(JSON.stringify(ix.exportState()));
        const keyOf = (x, id) => x.records().find((r) => r.id === sceneOf(x, id).idn.id).hash;
        const kb = keyOf(ix, b[0].id);
        ix.apply({ items: [stroke(0, 120, 300, 120)] });            // an edit never saved
        const edits = (y0) => { const keys = []; for (let i = 0; i < 6; i++) { ix.apply({ items: [stroke(0, y0 + 60 * i, 300, y0 + 60 * i)] }); keys.push(keyOf(ix, a[0].id)); } return keys; };
        const lost = edits(120);                                   // edits never saved
        ix.apply({ restore: { state: saved }, frames: F0, items: [...a, ...b] });   // the same index (a worker lives across loads)
        expect(keyOf(ix, b[0].id)).toBe(kb);
        const again = edits(-400);                                 // as many edits again from the saved counter
        expect(again.filter((k) => lost.includes(k))).toEqual([]);
    });
    test("a closed outline's lonely chunks on both sides of its loop's start are one stray run", () => {
        // a line 1,800 widths long drawn as a closed outline (out along one side, back along the other, three
        // chunks each); a drawing at its near end; its two far chunks are lonely — a run of two, stray
        const outline = (rot) => {
            const side = (xa, xb, y) => { const p = []; for (let i = 0; i < 3; i++) { const u0 = xa + ((xb - xa) * i) / 3, u1 = xa + ((xb - xa) * (i + 1)) / 3; p.push(Math.min(u0, u1), y - 0.5, Math.max(u0, u1), y + 0.5, 600); } return p; };
            const all = side(0, 1800, 0.5).concat(side(1800, 0, -0.5));
            const rolled = all.slice(5 * rot).concat(all.slice(0, 5 * rot));
            return { id: ++uid, home: "0", w: 1, raw: new Float64Array(rolled), t: null, loops: [0] };
        };
        const run = (rot) => {
            const ix = fresh(), or = new SceneOracle();
            or.apply({ frames: F0 });
            const a = [stroke(-400, 0, -100, 0), stroke(-400, 60, -100, 60)];
            const L = outline(rot);
            const b = [stroke(2300, 0, 2600, 0), stroke(2300, 60, 2600, 60)];   // within reach of the far chunks only
            // a width-only change re-files it with the loops it had; a translated re-send carries its own
            const moved = new Float64Array(L.raw.length);
            for (let i = 0; i < moved.length; i += 5) { moved[i] = L.raw[i] - 5; moved[i + 1] = L.raw[i + 1]; moved[i + 2] = L.raw[i + 2] - 5; moved[i + 3] = L.raw[i + 3]; moved[i + 4] = L.raw[i + 4]; }
            const later = [{ items: [{ id: L.id, home: "0", w: 1.01, t: null }] }, { items: [{ id: L.id, home: "0", w: 1.01, raw: moved, t: null, loops: [0] }] }];
            let size = 0;
            for (const batch of [{ items: [...a, L] }, { items: b }, ...later]) {
                ix.apply(batch); or.apply(batch);
                expect(ix.items.get(L.id).loops).toEqual([0]);
                expect(byMembers(ix)).toEqual([...or.scenes.values()].map((S) => [...S.members].map((m) => m.id).sort((p, q) => p - q)).sort((p, q) => p[0] - q[0]));
                if (batch.items[0].id === b[0].id) size = ix.scenes.size;
            }
            return size;
        };
        expect([0, 1, 2, 3, 4, 5].map(run)).toEqual([2, 2, 2, 2, 2, 2]);   // rot 3 splits the far pair across the start
    });
    test("a z-only record moves its scene's picture key on and changes nothing else", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60)];
        ix.apply({ items: a });
        const before = byMembers(ix), key = ix.records()[0].hash;
        ix.apply({ items: [{ id: a[1].id, attr: true }] });
        expect(byMembers(ix)).toEqual(before);
        expect(ix.records()[0].hash).not.toBe(key);
    });
});

describe("echo rows (Kobin 2026-09-23: \"why are there two scenes for Saturn?\")", () => {
    // Saturn: a body of two fat strokes (frame 960 × 260) and its rings, 64× thinner (a child
    // scene), around it (frame 960 for rings(400), 720 for rings(300)): the same subject
    const body = () => [stroke(-300, 0, 500, 0, 64), stroke(-300, 100, 500, 100, 64)];
    const rings = (r) => [stroke(100 - r, 50, 100 + r, 50), stroke(100, 50 - r, 100, 50 + r), stroke(100 - r, 50 - r, 100 + r, 50 + r)];
    const rows = (ix) => ix.records().filter((r) => !r.kind);
    test("a scene and its detail whose frames hold each other's centres within 3× are one row, framed on the tighter", () => {
        const ix = fresh();
        const b = body(), g = rings(300);
        ix.apply({ items: [...b, ...g] });
        expect(ix.scenes.size).toBe(2);                          // still two scenes (16× apart in width)
        const S = sceneOf(ix, b[0].id), T = sceneOf(ix, g[0].id);
        expect(T.parent).toBe(S);
        const list = rows(ix);
        expect(list.length).toBe(1);
        expect(list[0].id).toBe(S.idn.id);                       // the coarser, first scene's id
        expect(list[0].rect).toEqual(T.frame);                   // the tighter picture
        expect(list[0].count).toBe(5);
    });
    test("detail more than 3× smaller than its parent's frame keeps its own row", () => {
        const ix = fresh();
        ix.apply({ items: [...body(), ...rings(100)] });         // frame 240 in a frame of 960
        expect(rows(ix).length).toBe(2);
    });
    test("a renamed scene gives the row its id and name; two renamed scenes keep two rows", () => {
        const ix = fresh();
        const b = body(), g = rings(400);
        ix.apply({ items: [...b, ...g] });
        const T = sceneOf(ix, g[0].id);
        ix.apply({ renames: [[T.idn.id, "Saturn"]] });
        let list = rows(ix);
        expect(list.map((r) => [r.id, r.name])).toEqual([[T.idn.id, "Saturn"]]);
        ix.apply({ renames: [[sceneOf(ix, b[0].id).idn.id, "Body"]] });
        list = rows(ix);
        expect(list.map((r) => r.name).sort()).toEqual(["Body", "Saturn"]);
    });
    test("a chain of echoes is one row while its frames span 16×; the next link starts a row", () => {
        // five nested strokes on one centre, each 2.5× shorter and 20× thinner than the last (one member
        // each, so no stray run): frames 1,200, 480, 192, 77, 31
        const ix = fresh(), or = new SceneOracle();
        or.apply({ frames: F0 });
        const levels = [0, 1, 2, 3, 4].map((k) => { const l = 1000 / 2.5 ** k, w = 1000 / 24 / 20 ** k; return [stroke(-l / 2, 0, l / 2, 0, w)]; });
        const batch = { items: levels.flat() };
        ix.apply(batch);
        const orc = or.apply(batch);
        expect(ix.scenes.size).toBe(5);
        expect(rows(ix).length).toBe(2);                          // 2.5⁴ = 39 > 16: the fifth starts its own row
        expect(Object.entries(stateOf(ix)).sort()).toEqual(Object.entries(orc).sort());
    });
    test("a renamed region keeps its id and name when its parent row shows another scene, and through a save and load", () => {
        const ix = fresh();
        const b = body(), g = rings(400);
        // 25 marks 32× thinner than the rings, 100 apart: 25 child scenes of the Saturn row, so regions
        const crowd = [];
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) crowd.push(stroke(-100 + i * 100, -150 + j * 100, -98 + i * 100, -150 + j * 100, 1 / 32));
        ix.apply({ items: [...b, ...g, ...crowd] });
        const reg = ix.records().find((r) => r.kind === "region");
        expect(reg).toBeTruthy();
        ix.apply({ renames: [[reg.id, "Moons"]] });
        ix.apply({ renames: [[sceneOf(ix, g[0].id).idn.id, "Rings"]] });   // the parent row now shows (and is) the rings
        expect(rows(ix).find((r) => r.name === "Rings")).toBeTruthy();
        const find = (x) => x.records().find((r) => r.kind === "region" && r.id === reg.id);
        expect(find(ix) && find(ix).name).toBe("Moons");
        const iy = new SceneIndex();
        iy.apply({ restore: { state: JSON.parse(JSON.stringify(ix.exportState())) }, frames: F0, items: [...b, ...g, ...crowd] });
        expect(find(iy) && find(iy).name).toBe("Moons");
    });
    test("a renamed region keeps its id and name when a coarser scene drawn round its parent folds into the parent's row", () => {
        const ix = fresh();
        const g = rings(400);
        const crowd = [];
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) crowd.push(stroke(-100 + i * 100, -150 + j * 100, -98 + i * 100, -150 + j * 100, 1 / 32));
        ix.apply({ items: [...g, ...crowd] });
        const reg = ix.records().find((r) => r.kind === "region");
        ix.apply({ renames: [[reg.id, "Moons"]] });
        const b = body();
        ix.apply({ items: b });                                   // the body: its row now starts at the body
        expect(ix.rowOf.get(sceneOf(ix, g[0].id)).founder).toBe(sceneOf(ix, b[0].id));
        const got = ix.records().find((r) => r.kind === "region" && r.id === reg.id);
        expect(got && got.name).toBe("Moons");
    });
    test("an echo's rows agree with the oracle, and the stored list keeps their ids through a save and load", () => {
        const ix = fresh(), or = new SceneOracle();
        or.apply({ frames: F0 });
        const b = body(), g = rings(400), far = [stroke(90000, 0, 90300, 0), stroke(90000, 60, 90300, 60)];
        const batch = { items: [...b, ...g, ...far] };
        ix.apply(batch);
        const orc = or.apply(batch);
        expect(Object.entries(stateOf(ix)).sort()).toEqual(Object.entries(orc).sort());
        const iy = new SceneIndex();
        const out = iy.apply({ restore: { state: JSON.parse(JSON.stringify(ix.exportState())) }, frames: F0, items: [...b, ...g, ...far] });
        expect(out.scenes.filter((r) => !r.kind).map((r) => r.id).sort()).toEqual(rows(ix).map((r) => r.id).sort());
    });
});

describe("Kobin's decisions of 2026-09-23 evening: no minimum frame, 12 parts, a named row shows its own frame", () => {
    const rows = (ix) => ix.records().filter((r) => !r.kind);
    const parts = (ix, id) => ix.records().filter((r) => r.kind === "part" && r.parent === id);
    test("a zero-size ink box (one point) is framed on one width of ink and 10 %; a fat stroke on its ink", () => {
        const ix = fresh();
        const pt = { id: ++uid, home: "0", w: 2, raw: new Float64Array([50, 70, 50, 70, 2]), t: null };
        const fat = stroke(10000, 0, 10400, 0, 64);
        ix.apply({ items: [pt, fat] });
        const f = sceneOf(ix, pt.id).frame;
        expect(f.w).toBeCloseTo(2.4, 9); expect(f.h).toBeCloseTo(2.4, 9);
        expect(f.x + f.w / 2).toBeCloseTo(50, 9); expect(f.y + f.h / 2).toBeCloseTo(70, 9);
        const g = sceneOf(ix, fat.id).frame;
        expect(g.w).toBeCloseTo(480, 6);                          // 400 of ink and 10 % each side, not 24 widths (1,536)
        expect(g.h).toBeCloseTo(64 + 80, 6);                      // one width of ink high, padded by 10 % of 400
    });
    // a line 39,000 wide of 60 one-chunk strokes (no stray run): its long side is ~22 times MAX_SPAN_PX
    const band = () => { const a = []; for (let i = 0; i < 60; i++) a.push(stroke(i * 650, 0, i * 650 + 600, 0)); return a; };
    test("a scene that would cut into more than 12 parts gets 12, the widest piece cut first; together they hold its ink", () => {
        const ix = fresh(), or = new SceneOracle();
        or.apply({ frames: F0 });
        const b = band();
        ix.apply({ items: b });
        const orc = or.apply({ items: b });
        const S = sceneOf(ix, b[0].id), ps = parts(ix, S.idn.id);
        expect(ps.length).toBe(12);
        const w = ps.map((p) => p.rect.w).sort((x, y) => x - y);
        expect(w[11] / w[0]).toBeLessThan(2.5);                   // even: no piece left twice the size of another's split
        expect(ps.map((p) => p.rect.x)).toEqual(ps.map((p) => p.rect.x).sort((x, y) => x - y));   // listed along the cut tree, left to right
        const x0 = Math.min(...ps.map((p) => p.rect.x)), x1 = Math.max(...ps.map((p) => p.rect.x + p.rect.w));
        expect(x0).toBeLessThanOrEqual(0); expect(x1).toBeGreaterThanOrEqual(59 * 650 + 600);
        expect(Object.entries(stateOf(ix)).sort()).toEqual(Object.entries(orc).sort());
    });
    test("parts keep their ids when a small stroke is added inside one away from the first cut", () => {
        // (at the first cut, x ≈ 20,000, the cut moves and 4 of the 12 change: measured, SCENES-PLAN §7.7)
        const ix = fresh();
        const b = band();
        ix.apply({ items: b });
        const S = sceneOf(ix, b[0].id), before = parts(ix, S.idn.id).map((p) => p.id);
        ix.apply({ items: [stroke(5000, 30, 5100, 30)] });
        expect(parts(ix, S.idn.id).map((p) => p.id)).toEqual(before);
    });
    // Saturn: a body of two fat strokes and its rings 64× thinner, 1.33× apart: the rings the tighter
    const body = () => [stroke(-300, 0, 500, 0, 64), stroke(-300, 100, 500, 100, 64)];
    const rings = () => [stroke(-200, 50, 400, 50), stroke(100, -250, 100, 350), stroke(-200, -250, 400, 350)];
    test("a folded row with a renamed member shows that member's frame; unnamed, the tightest", () => {
        const ix = fresh();
        const b = body(), g = rings();
        ix.apply({ items: [...b, ...g] });
        const B = sceneOf(ix, b[0].id), G = sceneOf(ix, g[0].id);
        expect(rows(ix).length).toBe(1);
        expect(rows(ix)[0].rect).toEqual(G.frame);                // the tighter
        const key = rows(ix)[0].hash;
        ix.apply({ renames: [[B.idn.id, "Saturn"]] });
        const [r] = rows(ix);
        expect(r.hash).not.toBe(key);                             // another picture
        expect([r.id, r.name]).toEqual([B.idn.id, "Saturn"]);
        expect(r.rect).toEqual(B.frame);                          // the renamed member's own frame
        expect(r.level).toBe(B.anchor);
    });
    test("a restored scene whose saved frame differs from the rule's gets a new picture key; one that matches keeps its key", () => {
        const ix = fresh();
        const a = [stroke(0, 0, 300, 0), stroke(0, 60, 300, 60)], c = [stroke(90000, 0, 90300, 0)];
        ix.apply({ items: [...a, ...c] });
        const key = (x, id) => x.records().find((r) => r.id === sceneOf(x, id).idn.id).hash;
        const st = JSON.parse(JSON.stringify(ix.exportState()));
        const A = st.scenes.find((s) => s.id === sceneOf(ix, a[0].id).idn.id);
        A.rect = { ...A.rect, w: A.rect.w * 4, h: A.rect.h * 4 };   // as a save under the old floor would hold it
        const iy = new SceneIndex();
        iy.apply({ restore: { state: st }, frames: F0, items: [...a, ...c] });
        expect(key(iy, a[0].id)).not.toBe(key(ix, a[0].id));
        expect(key(iy, c[0].id)).toBe(key(ix, c[0].id));
    });
});
