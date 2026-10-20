/**
 * memory.layout.test.js — the memory-layout step (memory-chrome-2026-10-20.md). Lever 1: equal offset tables share
 * one frozen array — a load, a drop's members and its undo record hold one table a value, a write to one throws, and
 * undo and redo still restore every member's table exactly. A drop's journal entry keeps the journal's bound.
 * Lever 2: a loop's record index is built at its first random access, to the same offsets. Lever 3: the family map
 * keeps families only, and every group reads as it did. Lever 4: the spatial index shares a shape's and a fill's
 * cached box. Lever 5: a load shares its natives' type, origin and colour strings (identity of a string cannot be
 * seen from JS: its memory is measured in mem.tables.probe.js; here the values and absent fields).
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import { internBelow, sameBelow, decodeBelow } from "./geometry/offsets";
import { nativeFromRecord } from "./Document";
import { Loop, indexLoop } from "./geometry/loop";
import { bboxOf } from "./geometry/derive";

useEngines();

describe("internBelow", () => {
    test("equal values share one frozen table; empty ones are none", () => {
        const a = internBelow([[0.5, 0.25], , [3, -1]]);
        expect(internBelow([[0.5, 0.25], [0, 0], [3, -1]])).toBe(a);
        expect(internBelow(a)).toBe(a);
        expect(internBelow([[0.5, 0.25]])).not.toBe(a);
        expect(Object.isFrozen(a) && Object.isFrozen(a[0]) && Object.isFrozen(a[2])).toBe(true);
        expect(() => { a[0][0] = 1; }).toThrow(TypeError);
        expect(() => { a[1] = [1, 1]; }).toThrow(TypeError);
        expect(internBelow([[0, 0]])).toBeUndefined();
        expect(internBelow(undefined)).toBeUndefined();
    });
    test("a load gives natives with equal tables one table", () => {
        const rec = (id) => ({ type: "stroke", origin: "native", id, color: "#000", opacity: 1, w: 2, pts: [[0, 0], [5, 5]], below: [[1, 0.5, -0.25]] });
        const p = nativeFromRecord(rec(1)), q = nativeFromRecord(rec(2));
        expect(p.below).toBe(q.below);
        expect(sameBelow(p.below, decodeBelow([[1, 0.5, -0.25]]))).toBe(true);
    });
    test("an added native keeps the shared table, not the caller's array", () => {
        const E = mkEngine(800, 600);
        const mk = () => ({ type: "stroke", origin: "native", id: E.doc.allocId(), color: "#000", opacity: 1, w: 2,
            pts: [[0, 0], [5, 5]], below: [, [2, -3]] });
        const a = mk(), b = mk(), mine = b.below;
        E.doc.add(a, "1"); E.doc.add(b, "1");
        // The stored field itself: `ownTable` shares on the way out as well.
        expect(a.below).toBe(b.below);
        expect(b.below).not.toBe(mine);
        expect(Object.isFrozen(a.below)).toBe(true);
    });
});

describe("a drop shares its members' tables", () => {
    const shapeAt = (E, frame, x, y, w, h) => {
        const o = { type: "shape", origin: "native", id: E.doc.allocId(), color: "#123", opacity: 1, w: 8,
            loops: rectLoop({ left: x, top: y, right: x + w, bottom: y + h }) };
        E.doc.add(o, frame);
        return o;
    };
    const dragBy = (E, p, dx, dy) => {
        E.pointerDown(p[0], p[1]);
        for (let s = 1; s <= 4; s++) E.pointerMove(p[0] + (dx * s) / 4, p[1] + (dy * s) / 4);
        E.pointerUp();
    };
    test("one table a (frame, table) key; undo and redo exact", () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const objs = [0, 1, 2].map((i) => shapeAt(E, "1", -200 + 60 * i, -100, 40, 40));
        E._render();
        const ids = objs.map((o) => o.id), table = (id) => E.doc.ownTable(E.doc.getById(id).obj);
        E.setTool("select");
        E._setSelection(ids, []);
        dragBy(E, E._levelPointToScreen("1", -180, -80), 27.3, 12.1);
        const op = E.doc._undo[E.doc._undo.length - 1];
        expect(op.moves.length).toBe(3);
        const T = table(ids[0]);
        expect(T).toBeTruthy();
        expect(Object.isFrozen(T)).toBe(true);
        for (const m of op.moves) { expect(m.belowAfter).toBe(T); expect(table(m.id)).toBe(T); }
        // A second drag: its record's before is the first one's after, the same array.
        dragBy(E, E._levelPointToScreen("1", -180 + 27.3, -80 + 12.1), 23.2, -11.1);
        const op2 = E.doc._undo[E.doc._undo.length - 1];
        for (const m of op2.moves) expect(m.belowBefore).toBe(T);
        const T2 = table(ids[0]);
        expect(sameBelow(T2, T)).toBe(false);
        E.undo();
        for (const id of ids) expect(table(id)).toBe(T);
        E.undo();
        for (const id of ids) expect(table(id)).toBeUndefined();
        E.redo(); E.redo();
        for (const id of ids) expect(table(id)).toBe(T2);
    });
    test("the journal keeps 120 of a drop's members and their count", () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const ids = [];
        for (let i = 0; i < 130; i++) ids.push(shapeAt(E, "1", -200 + (i % 13) * 45, -100 + Math.floor(i / 13) * 45, 40, 40).id);
        E._render();
        E.setTool("select");
        const last = () => E.journal.filter((e) => e.kind === "move").pop();
        E._setSelection(ids.slice(0, 3), []);
        dragBy(E, E._levelPointToScreen("1", -180, -80), 27.3, 12.1);
        expect(last().moves.length).toBe(3);
        expect(last().members).toBeUndefined();
        E._setSelection(ids, []);
        dragBy(E, E._levelPointToScreen("1", -180 + 27.3, -80 + 12.1), 23.2, -11.1);
        expect(last().moves.length).toBe(120);
        expect(last().members).toBe(130);
        expect(E.doc._undo[E.doc._undo.length - 1].moves.length).toBe(130);
    });
});

describe("lever 2: a loop's index is built at its first random access", () => {
    // ax, ay; a line, an arc, a cut line, a cut arc, a line: every record kind.
    const enc = [0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 2, 0, 2, 2, 0, 3, 0, 0, 1, 3, 0,
        3, 3, 1, 1, 0, 1, 0, 1, 3, 0, 4, 0, 0, 1, 4, 0, 0, 0, 0];
    test("the count, walking and the first piece leave it unbuilt; at(i) builds the same offsets", () => {
        for (const L of [Loop.wrap(enc), Loop.from(Loop.wrap(enc).toPieces())]) {
            expect(L.length).toBe(5);
            const walked = L.toPieces();
            L.map((p) => p); L.some(() => false); L.at(0);
            expect(L._idx).toBeNull();
            expect(L.byteLength).toBe(L.buf.byteLength);
            for (let i = 0; i < L.length; i++) expect(L.at(i)).toEqual(walked[i]);
            expect(L._idx).toEqual(indexLoop(L.buf));
            expect(L.at(-1)).toEqual(walked[4]);
            expect(Array.from(L.buf)).toEqual(enc);
        }
    });
});

describe("lever 3: the family map holds families only", () => {
    // editGroup as it was: the argument's key (a native's, or the argument itself), every native grouped by its key
    // in level then list order.
    const oldGroup = (doc, idOrObj) => {
        const rec = typeof idOrObj === "object" ? { obj: idOrObj } : doc.getById(idOrObj);
        const key = rec ? doc.editKey(rec.obj) : idOrObj;
        const out = [];
        for (const level of Object.keys(doc.nativesByLevel)) for (const obj of doc.nativesByLevel[level] || []) if (doc.editKey(obj) === key) out.push({ obj, level });
        return out;
    };
    const same = (a, b) => a.length === b.length && a.every((r, i) => r.obj === b[i].obj && r.level === b[i].level);
    test("every group as before, in the same order; a native alone is not stored", () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(3);
        const K = E.lm.cellChild("1", 2, 3).id, L = E.lm.cellChild(K, 1, 1).id;
        const mk = (extra) => ({ type: "stroke", origin: "native", id: E.doc.allocId(), color: "#000", opacity: 1, w: 2,
            pts: [[0, 0], [5, 5]], ...extra });
        const lone = [mk(), mk(), mk()], fam = E.doc.allocId();
        const members = [mk({ editId: fam }), mk({ editId: fam }), mk({ editId: fam })];
        const x = mk();                                       // keyless, its id a family's key (an erase's rekey can leave this)
        const mixed = [mk({ editId: x.id }), mk({ editId: x.id })];
        const dupA = mk(), dupB = { ...mk(), id: dupA.id };  // two natives with one id
        const order = [[lone[0], "1"], [members[0], L], [mixed[0], K], [x, "1"], [members[1], K], [lone[1], K],
            [dupA, L], [mixed[1], "1"], [members[2], "1"], [dupB, K], [lone[2], L]];
        for (const [o, f] of order) E.doc.add(o, f);
        const keys = [...order.map(([o]) => o.id), fam, x.id, 987654];
        for (const k of keys) expect(same(E.doc.editGroup(k), oldGroup(E.doc, k))).toBe(true);
        for (const [o] of order) expect(same(E.doc.editGroup(o), oldGroup(E.doc, o))).toBe(true);
        expect([...E.doc._groups.keys()].sort()).toEqual([fam, x.id, dupA.id].sort());
        expect(E.doc.editGroup(lone[1].id)).toEqual([{ obj: lone[1], level: K }]);
    });
});

describe("lever 4: the spatial index shares a shape's cached box", () => {
    test("a shape's and a fill's index box is its cached box; a stroke's and an empty shape's are their own", () => {
        const E = mkEngine(800, 600), doc = E.doc;
        const base = { origin: "native", color: "#123", opacity: 1 };
        const sh = { ...base, type: "shape", id: doc.allocId(), w: 8, loops: rectLoop({ left: 10, top: 20, right: 50, bottom: 60 }) };
        const fi = { ...base, type: "fill", id: doc.allocId(), polys: [[[0, 0], [30, 0], [30, 30]]] };
        const st = { ...base, type: "stroke", id: doc.allocId(), w: 2, lwFrame: 4, pts: [[100, 100], [140, 120]] };
        const empty = { ...base, type: "shape", id: doc.allocId(), w: 8, loops: [] };
        for (const o of [sh, fi, st, empty]) doc.add(o, "1");
        const ix = doc._index["1"];
        expect(ix.boxes.get(sh.id)).toBe(bboxOf(sh));
        expect(ix.boxes.get(fi.id)).toBe(bboxOf(fi));
        expect(ix.boxes.get(st.id)).toEqual({ x0: 98, y0: 98, x1: 142, y1: 122 });
        expect(ix.boxes.get(empty.id)).toEqual({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        expect(() => { bboxOf(sh).x0 = 0; }).toThrow(TypeError);
        const ids = (r) => doc.queryRect("1", r).map((o) => o.id).sort((a, b) => a - b);
        expect(ids({ left: 45, top: 55, right: 46, bottom: 56 })).toEqual([sh.id]);
        expect(ids({ left: -1, top: -1, right: 1, bottom: 1 })).toEqual([fi.id]);   // the empty shape is in no cell
        const before = bboxOf(sh);
        doc.moveById(sh.id, 100, 0);
        expect(bboxOf(sh)).not.toBe(before);
        expect(ix.boxes.get(sh.id)).toBe(bboxOf(sh));
        expect(ids({ left: 145, top: 55, right: 146, bottom: 56 })).toEqual([sh.id]);
        expect(ids({ left: 45, top: 55, right: 46, bottom: 56 })).toEqual([]);
    });
});

describe("lever 5: header strings shared at load", () => {
    test("a record's type, origin and colour read as they were; a field it lacks stays absent", () => {
        const v8 = require("v8");
        const recs = v8.deserialize(v8.serialize([
            { type: "stroke", origin: "native", id: 1, color: "#1d3557", opacity: 1, w: 2, pts: [[0, 0], [1, 1]] },
            { type: "fill", id: 2, polys: [] },
        ]));
        const [a, b] = recs.map(nativeFromRecord);
        expect([a.type, a.origin, a.color]).toEqual(["stroke", "native", "#1d3557"]);
        expect(b.type).toBe("fill");
        expect("origin" in b).toBe(false);
        expect("color" in b).toBe(false);
    });
});
