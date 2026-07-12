/**
 * Document — id sequence, undo/redo op-inversion, dev-0 natives byte-compat,
 * change-event contract (the TileStore's invalidation input), and the spatial
 * index. Pure model: no engine, no Two.js.
 */
import fs from "fs";
import path from "path";
import Document from "./Document";

const mkStroke = (doc, level, pts, lw = 2, extra = {}) => {
    const o = { type: "stroke", origin: "native", id: doc.allocId(), pts, lwFrame: lw, color: "#123456", opacity: 1, paths: [], ...extra };
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
        const o = { type: "stroke", origin: "native", id: d.allocId(), pts: [[0, 0]], lwFrame: 2, color: "#000", opacity: 1, paths: [] };
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
    test("there are report snapshots to check", () => { expect(files.length).toBeGreaterThan(0); });
    test.each(files)("%s natives survive loadNatives -> serializeNatives unchanged", (file) => {
        const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        const snapNatives = report.snapshot && report.snapshot.natives;
        if (!snapNatives) return; // some reports may predate the snapshot field
        const d = new Document();
        d.loadNatives(snapNatives);
        expect(d.serializeNatives()).toEqual(snapNatives);
        // maxId bump: a fresh id must exceed every loaded id
        const maxId = Math.max(0, ...Object.values(snapNatives).flat().map((o) => o.id));
        expect(d.allocId()).toBeGreaterThan(maxId);
    });
});
