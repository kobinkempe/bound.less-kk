/**
 * Document — id sequence, undo/redo op-inversion, dev-0 natives byte-compat,
 * change-event contract (the TileStore's invalidation input), and the spatial
 * index. Pure model: no engine, no Two.js.
 */
import fs from "fs";
import path from "path";
import Document from "./Document";
import LevelMap from "./LevelMap";
import { addOffset, encodeBelow, decodeBelow } from "./geometry/offsets";
import { BASE, ENTER, EXIT, W, HALF_W } from "./frameLattice";

const mkStroke = (doc, level, pts, lw = 2, extra = {}) => {
    const o = { type: "stroke", origin: "native", id: doc.allocId(), pts, lwFrame: lw, color: "#123456", opacity: 1, ...extra };
    doc.add(o, level);
    return o;
};

describe("ids and z-order", () => {
    test("allocId is monotonic and never collides across levels/loads", () => {
        const d = new Document();
        const a = mkStroke(d, 0, [[0, 0], [1, 1]]);
        const b = mkStroke(d, 3, [[2, 2], [3, 3]]);
        expect(b.id).toBe(a.id + 1);
        // load bumps _nextId past the max loaded id
        d.loadNatives({ 0: [{ type: "stroke", id: 50, pts: [[0, 0]], lwFrame: 1, color: "#000", opacity: 1 }] });
        expect(d.allocId()).toBe(51);
    });
});

describe("undo / redo / erase / clear (ported semantics)", () => {
    test("add/undo/redo round-trips the document", () => {
        const d = new Document();
        const a = mkStroke(d, 0, [[100, 100], [180, 120]]); d.pushUndo({ op: "add", id: a.id });
        const b = mkStroke(d, 0, [[300, 300], [340, 300]]); d.pushUndo({ op: "add", id: b.id });
        expect(d.at(0).length).toBe(2);
        d.undo(); expect(d.at(0).length).toBe(1);
        d.redo(); expect(d.at(0).length).toBe(2);
    });
    test("erase remembers index; undo restores it in place", () => {
        const d = new Document();
        const a = mkStroke(d, 0, [[0, 0], [1, 0]]); d.pushUndo({ op: "add", id: a.id });
        const b = mkStroke(d, 0, [[2, 0], [3, 0]]); d.pushUndo({ op: "add", id: b.id });
        const c = mkStroke(d, 0, [[4, 0], [5, 0]]); d.pushUndo({ op: "add", id: c.id });
        const rec = d.removeById(b.id);
        d.pushUndo({ op: "erase", obj: rec.obj, level: rec.level, index: rec.index });
        expect(d.at(0).map((o) => o.id)).toEqual([a.id, c.id]);
        d.undo();
        expect(d.at(0).map((o) => o.id)).toEqual([a.id, b.id, c.id]); // back at index 1
    });
    test("clear is one undoable op and round-trips external state", () => {
        const d = new Document();
        mkStroke(d, 0, [[0, 0], [1, 1]]); mkStroke(d, 1, [[2, 2], [3, 3]]);
        let external = { camera: "A", crossings: { 1: {} } };
        // clear captures external via onExternal at invert time; restoreExternal reinstates it
        d.clear(external, () => external, (e) => { external = e; });
        expect(d.at(0).length).toBe(0);
        expect(d.levels().filter((l) => d.at(l).length).length).toBe(0);
        d.undo();
        expect(d.at(0).length).toBe(1);
        expect(d.at(1).length).toBe(1);
        expect(external).toEqual({ camera: "A", crossings: { 1: {} } }); // external restored
        d.redo();
        expect(d.at(0).length).toBe(0);
    });
});

describe("change events (TileStore invalidation input)", () => {
    test("every mutation emits with id + home level, including undo/redo replays", () => {
        const d = new Document();
        const events = [];
        d.subscribe((e) => events.push(e.kind + ":" + (e.id ?? "") + "@" + (e.level ?? "")));
        const a = mkStroke(d, 2, [[0, 0], [1, 1]]); d.pushUndo({ op: "add", id: a.id });
        d.undo(); // remove a
        d.redo(); // re-add a
        expect(events).toEqual(["add:" + a.id + "@2", "remove:" + a.id + "@2", "add:" + a.id + "@2"]);
    });
    test("finalize re-announces so the FINAL bbox is what invalidates", () => {
        const d = new Document();
        const events = [];
        d.subscribe((e) => events.push(e.kind));
        const o = { type: "stroke", origin: "native", id: d.allocId(), pts: [[0, 0]], lwFrame: 2, color: "#000", opacity: 1 };
        d.add(o, 0, { live: true });
        o.pts.push([500, 500]); // grew while live
        d.finalize(o);
        expect(events).toEqual(["add", "finalize"]);
        // live stroke is unindexed until finalize, then found by its full extent
        expect(d.queryRect(0, { left: 400, top: 400, right: 600, bottom: 600 }).some((q) => q.id === o.id)).toBe(true);
    });
});

describe("spatial index (ISSUE-17)", () => {
    test("queryRect returns only bbox-intersecting objects (+ lw margin)", () => {
        const d = new Document();
        const near = mkStroke(d, 0, [[0, 0], [10, 10]], 4);
        const far = mkStroke(d, 0, [[100000, 100000], [100010, 100010]], 4);
        const hit = d.queryRect(0, { left: -5, top: -5, right: 20, bottom: 20 });
        expect(hit.map((o) => o.id)).toContain(near.id);
        expect(hit.map((o) => o.id)).not.toContain(far.id);
    });
    test("a stroke just outside a rect is caught via its linewidth margin", () => {
        const d = new Document();
        const o = mkStroke(d, 0, [[0, 100], [50, 100]], 40); // half-width 20 reaches up to y=80
        expect(d.queryRect(0, { left: 0, top: 0, right: 50, bottom: 85 }).some((q) => q.id === o.id)).toBe(true);
        expect(d.queryRect(0, { left: 0, top: 0, right: 50, bottom: 70 }).some((q) => q.id === o.id)).toBe(false);
    });
    test("giant objects (bigger than a cell) still answer queries via the overflow list", () => {
        const d = new Document();
        const big = mkStroke(d, 0, [[-50000, 0], [50000, 0]], 2);
        expect(d.queryRect(0, { left: 40000, top: -5, right: 40010, bottom: 5 }).some((q) => q.id === big.id)).toBe(true);
    });
    test("removeById drops the object from the index", () => {
        const d = new Document();
        const o = mkStroke(d, 0, [[0, 0], [10, 10]], 2);
        d.removeById(o.id);
        expect(d.queryRect(0, { left: -5, top: -5, right: 20, bottom: 20 })).toHaveLength(0);
    });
});

describe("dev-0 natives byte-compat over real reports", () => {
    const dir = path.join(__dirname, "..", "..", ".kobin-reports");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
    // Gitignored device recordings: skip on fresh clones, fail loudly with
    // KOBIN_REQUIRE_REPORTS=1 (guards against fixtures silently going missing).
    (files.length || process.env.KOBIN_REQUIRE_REPORTS ? test : test.skip)(
        "there are report snapshots to check",
        () => { expect(files.length).toBeGreaterThan(0); },
    );
    // `windows` and `srcId` are RETIRED (2026-08-06): a deep erase cuts the ceded
    // tile out of the parent now, so there is no rect to record and no
    // back-pointer to keep. Recordings made before then still carry them, and a
    // load is expected to DROP them — that is the one and only permitted
    // difference. Everything else, down to the last coordinate, must survive.
    const RETIRED = ["windows", "srcId"];
    const stripRetired = (natives) => {
        const out = {};
        for (const l of Object.keys(natives)) {
            out[l] = natives[l].map((o) => { const c = { ...o }; for (const k of RETIRED) delete c[k]; return c; });
        }
        return out;
    };
    // eslint-disable-next-line jest/valid-title -- the title IS a string; the rule cannot see through the conditional table
    (files.length ? test.each(files) : test.skip.each(["(no reports)"]))("%s natives survive loadNatives -> serializeNatives unchanged", (file) => {
        const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        const snapNatives = report.snapshot && report.snapshot.natives;
        if (!snapNatives) return; // some reports may predate the snapshot field
        const d = new Document();
        d.loadNatives(snapNatives);
        // A load also REPAIRS geometry that does not close (arcShape.repairLoops)
        // — one build of ours could store an unclosed chain, and a drawing
        // carrying one used to be unopenable. A repaired object legitimately
        // differs from what was recorded, so the invariant is stated as
        // IDEMPOTENCE: whatever the first load makes of a file, a second load
        // of that leaves alone. Everything untouched still has to match byte
        // for byte, which is what `unrepaired` checks.
        const once = d.serializeNatives();
        const d2 = new Document();
        d2.loadNatives(JSON.parse(JSON.stringify(once)));
        expect(d2.serializeNatives()).toEqual(once);
        const expected = stripRetired(snapNatives);
        const unrepaired = {};
        for (const l of Object.keys(once)) {
            unrepaired[l] = once[l].filter((o, i) => {
                const src = expected[l] && expected[l][i];
                return src && (o.type !== "shape" || JSON.stringify(o.loops) === JSON.stringify(src.loops));
            });
        }
        for (const l of Object.keys(unrepaired)) {
            for (const o of unrepaired[l]) {
                const src = expected[l].find((x) => x.id === o.id);
                expect(o).toEqual(src);
            }
        }
        // maxId bump: a fresh id must exceed every loaded id
        const maxId = Math.max(0, ...Object.values(snapNatives).flat().map((o) => o.id));
        expect(d.allocId()).toBeGreaterThan(maxId);
    });
});

describe("a move's undo entry is the frame and the table (row 11, 2026-09-14)", () => {
    // Keyed by id, not array position: `rehomeById` re-appends, so an object that leaves a level
    // and comes back is last in it. What a move must not touch is the stored coordinates.
    const bytes = (d) => JSON.stringify(Object.fromEntries(Object.entries(d.serializeNatives())
        .map(([lvl, arr]) => [lvl, [...arr].sort((x, y) => x.id - y.id)])));
    test("undo and redo round-trip the stored bytes from the tables alone", () => {
        const d = new Document();
        const a = mkStroke(d, "1", [[0, 0], [10, 5]], 2), b = mkStroke(d, "1", [[3, 3], [8, 9]], 2);
        const before = bytes(d);
        const tb = []; tb[1] = [5, 6];
        d.rehomeById(a.id, "1/1,0"); d.setOffsetsById(a.id, [[3, 4]]); d.setOffsetsById(b.id, tb);
        const after = bytes(d);
        d.pushUndo({ op: "moveMany", moves: [
            { id: a.id, dx: 1, dy: 1, from: "1", to: "1/1,0", belowBefore: undefined, belowAfter: [[3, 4]] },
            { id: b.id, dx: 1, dy: 1, from: "1", to: "1", belowBefore: undefined, belowAfter: tb }] });
        expect(d.undo()).toBe(true);
        expect(bytes(d)).toBe(before); expect(a.below).toBeUndefined(); expect(d.getById(a.id).level).toBe("1");
        expect(d._redo[0].moves[0]).not.toHaveProperty("base");
        expect(d.redo()).toBe(true);
        expect(bytes(d)).toBe(after); expect(d.getById(a.id).level).toBe("1/1,0");
        expect(d.undo()).toBe(true); expect(bytes(d)).toBe(before);
    });
    test("a member with geometry snapshots (the pen-up normalisation) is restored from them", () => {
        const d = new Document();
        const a = mkStroke(d, "1", [[0, 0], [10, 5]], 2);
        const base = Document.snapGeometry(a);
        const before = bytes(d);
        d.rehomeById(a.id, "1/1,0"); d.moveById(a.id, -131072, 0);
        const after = bytes(d);
        d.pushUndo({ op: "move", id: a.id, dx: -131072, dy: 0, from: "1", to: "1/1,0", base, after: Document.snapGeometry(a) });
        d.undo(); expect(bytes(d)).toBe(before);
        d.redo(); expect(bytes(d)).toBe(after);
    });
});

describe("rehomeManyById ends where one rehomeById per id ends (row 11)", () => {
    const fill = (d) => {
        const objs = [];
        for (const L of ["1", "1/1,0", "2"]) for (let i = 0; i < 40; i++) objs.push(mkStroke(d, L, [[i * 7, i * 3], [i * 7 + 20, i * 3 + 9]], 1 + (i % 5)));
        const live = { type: "stroke", origin: "native", id: d.allocId(), pts: [[1, 1], [2, 2]], lwFrame: 3, color: "#000", opacity: 1 };
        d.add(live, "2", { live: true }); objs.push(live);
        return objs;
    };
    const evKey = (e) => e.kind + ":" + e.id + "@" + e.level + ">" + (e.rehome || "");
    test("lists, order, indexes, versions and the multiset of events agree", () => {
        const A = new Document(), B = new Document();
        const oa = fill(A), ob = fill(B);
        const ea = [], eb = [];
        A.subscribe((e) => ea.push(evKey(e))); B.subscribe((e) => eb.push(evKey(e)));
        const pick = oa.map((o, i) => i).filter((i) => i % 3 === 1 || i === oa.length - 1).reverse();
        for (const i of pick) A.rehomeById(oa[i].id, "1/0,1");
        const n = B.rehomeManyById(pick.map((i) => ob[i].id), "1/0,1");
        expect(n).toBe(pick.length);
        expect(JSON.stringify(B.serializeNatives())).toBe(JSON.stringify(A.serializeNatives()));
        expect(B.levels().sort()).toEqual(A.levels().sort());
        for (let i = 0; i < oa.length; i++) { expect(ob[i]._home).toBe(oa[i]._home); expect(ob[i]._ver).toBe(oa[i]._ver); }
        const big = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
        for (const L of A.levels()) expect(B.queryRect(L, big).map((o) => o.id).sort()).toEqual(A.queryRect(L, big).map((o) => o.id).sort());
        expect(eb.slice().sort()).toEqual(ea.slice().sort());
        expect(B._pending.has(ob[ob.length - 1])).toBe(true);
    });
});

describe("a frame's shift settles into its natives at the first read (subtree O(1), 2026-09-14)", () => {
    const mkMap = () => {
        const M = new LevelMap({ base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 }, 800, 600);
        M.ensureSpine(2);
        return M;
    };
    const mkDoc = () => { const d = new Document(); d.lm = mkMap(); return d; };
    const table = (o) => encodeBelow(o.below) || null;
    // The expectation, computed from a recorded table: exactly one addOffset at k=0.
    const shifted = (enc, dx, dy) => encodeBelow(addOffset(decodeBelow(enc), 0, dx, dy).below) || null;

    test("settles once; every table takes exactly the shift, and count() does not settle", () => {
        const d = mkDoc();
        const a = mkStroke(d, "1", [[0, 0], [10, 5]]);
        const b = mkStroke(d, "1", [[20, 0], [30, 5]]);
        const c = mkStroke(d, "1", [[40, 0], [50, 5]]);
        d.setOffsetsById(b.id, [[100, 200]]);
        const before = [a, b, c].map(table);
        d.lm.frame("1").shift = [12288, -4096];
        const owner = {};
        d.noteFrameOwner("1", owner);
        expect(d.count("1")).toBe(3);
        expect(d.lm.frame("1").shift).toEqual([12288, -4096]);
        const arr = d.at("1");
        expect(d.lm.frame("1").shift).toBe(null);
        expect(arr.map(table)).toEqual(before.map((e) => shifted(e, 12288, -4096)));
        // The record on the owning entry: the shift, every native's result table, no carries.
        expect([owner.settled.dx, owner.settled.dy]).toEqual([12288, -4096]);
        expect(owner.settled.tables.map((t) => t[0])).toEqual([a.id, b.id, c.id]);
        expect(owner.settled.tables.map((t) => encodeBelow(t[1]) || null)).toEqual(arr.map(table));
        expect(owner.settled.carries).toEqual([]);
        const vers = arr.map((o) => o._ver), tables = arr.map(table);
        d.at("1");
        expect(arr.map((o) => o._ver)).toEqual(vers);
        expect(arr.map(table)).toEqual(tables);
    });

    test("a carry re-homes the native to the neighbour cell", () => {
        const d = mkDoc();
        const a = mkStroke(d, "1", [[0, 0], [10, 5]]);
        d.setOffsetsById(a.id, [[HALF_W - 100, 0]]);
        d.lm.frame("1").shift = [200, 0];
        const owner = {};
        d.noteFrameOwner("1", owner);
        d.at("1");
        expect(a._home).toBe(d.lm.neighbour("1", 1, 0).id);
        expect(table(a)).toEqual([[0, HALF_W - 100 + 200 - W, 0]]);
        expect(owner.settled.carries).toEqual([[a.id, a._home]]);
        // unsettle is the exact inverse, and brings the carried native home by id
        d.unsettle("1", owner.settled);
        expect(a._home).toBe("1");
        expect(table(a)).toEqual([[0, HALF_W - 100, 0]]);
        d.unsettle("1", owner.settled);                        // idempotent: from the record, not the current table
        expect(a._home).toBe("1");
        expect(table(a)).toEqual([[0, HALF_W - 100, 0]]);
    });

    test("a write settles the frame first, and the newcomer owes nothing", () => {
        const d = mkDoc();
        const a = mkStroke(d, "1", [[0, 0], [10, 5]]);
        const b = mkStroke(d, "1", [[20, 0], [30, 5]]);
        d.lm.frame("1").shift = [512, 0];
        const n = mkStroke(d, "1", [[60, 0], [70, 5]]);      // a plain add settles before it lands
        expect(d.lm.frame("1").shift).toBe(null);
        expect([a, b, n].map(table)).toEqual([[[0, 512, 0]], [[0, 512, 0]], null]);
        const vers = [a, b].map((o) => o._ver);
        d.rehomeById(n.id, "2"); d.rehomeById(n.id, "1");
        expect([a, b].map((o) => o._ver)).toEqual(vers);
        expect([a, b, n].map(table)).toEqual([[[0, 512, 0]], [[0, 512, 0]], null]);
    });

    test("a Document with no lattice behaves exactly as before", () => {
        const d2 = new Document();
        const a = mkStroke(d2, "1", [[0, 0], [10, 5]]);
        d2.setOffsetsById(a.id, [[100, 200]]);
        expect(d2.at("1")).toBe(d2.nativesByLevel["1"]);
        expect(table(a)).toEqual([[0, 100, 200]]);
        expect(d2._frameOwner.size).toBe(0);
    });
});

describe("a frame subtree is removed and restored as containers (subtree O(1), 2026-09-14)", () => {
    const mkDoc = () => {
        const M = new LevelMap({ base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 }, 800, 600);
        M.ensureSpine(2);
        M.cellChild("1", 5, 5); M.cellChild("1/5,5", 3, 3);
        const d = new Document(); d.lm = M;
        return d;
    };
    const table = (o) => encodeBelow(o.below) || null;

    test("the lists go by reference, the natives read as gone, and insert puts them back", () => {
        const d = mkDoc();
        const top = mkStroke(d, "1", [[0, 0], [10, 5]]);
        const kid = mkStroke(d, "1/5,5", [[1, 1], [4, 4]]);
        const deep = mkStroke(d, "1/5,5/3,3", [[2, 2], [6, 6]]);
        const other = mkStroke(d, "2", [[7, 7], [9, 9]]);
        const kidList = d.nativesByLevel["1/5,5"], deepList = d.nativesByLevel["1/5,5/3,3"];
        // No read of any frame's natives: the removal is frames, not objects.
        const realAt = d.at.bind(d);
        let reads = 0;
        d.at = (lv) => { reads++; return realAt(lv); };
        const recs = d.removeFrameSubtree("1/5,5");
        d.at = realAt;
        expect(reads).toBe(0);
        expect(recs.map((r) => r.frame)).toEqual(["1/5,5", "1/5,5/3,3"]);
        expect(recs[0].natives).toBe(kidList);              // the list itself, not a copy
        expect(recs[1].natives).toBe(deepList);
        expect(d.levels()).not.toContain("1/5,5");
        expect(d.levels()).not.toContain("1/5,5/3,3");
        expect(d.getById(kid.id)).toBeNull();
        expect(d.getById(deep.id)).toBeNull();
        expect(d.count("1/5,5")).toBe(0);
        expect(d.count("1/5,5/3,3")).toBe(0);
        expect(d.getById(top.id).level).toBe("1");
        expect(d.getById(other.id).level).toBe("2");
        expect(d.at("1")).toEqual([top]);
        expect(d.at("2")).toEqual([other]);

        d.insertFrameSubtree(recs);
        expect(d.levels()).toContain("1/5,5");
        expect(d.levels()).toContain("1/5,5/3,3");
        expect(d.getById(kid.id).level).toBe("1/5,5");
        expect(d.getById(deep.id).level).toBe("1/5,5/3,3");
        expect(d.at("1/5,5")).toBe(kidList);
        expect(d.count("1/5,5")).toBe(1);
        expect(d.queryRect("1/5,5", { left: -100, top: -100, right: 100, bottom: 100 })).toEqual([kid]);
    });

    test("a pending shift waits out the removal and settles at the first read after it", () => {
        const d = mkDoc();
        const a = mkStroke(d, "1/5,5", [[0, 0], [10, 5]]);
        const b = mkStroke(d, "1/5,5", [[20, 0], [30, 5]]);
        d.lm.frame("1/5,5").shift = [512, 0];
        const recs = d.removeFrameSubtree("1/5,5");
        expect(d.at("1/5,5")).toEqual([]);                  // detached: nothing to settle
        expect(d.lm.frame("1/5,5").shift).toEqual([512, 0]);
        expect([a, b].map(table)).toEqual([null, null]);
        d.insertFrameSubtree(recs);
        const arr = d.at("1/5,5");
        expect(d.lm.frame("1/5,5").shift).toBe(null);
        expect(arr.map(table)).toEqual([[[0, 512, 0]], [[0, 512, 0]]]);
    });
});
