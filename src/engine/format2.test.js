/**
 * format2.js — the kobin-2 container agrees with kobin-1 number for number: a
 * frame encoded as headers plus one Float64Array decodes to the same records
 * `Document.serializeNatives` writes, loads into an identical document, and a log
 * entry and a chunk round-trip bit for bit. Built on a drawing with cut pieces
 * (codes 2 and 3), a moved object (an offsets table) and a pending eraser mark.
 */
import { mkEngine, useEngines, drawStroke, eraseGesture, descend, drag, click } from "./__testkit__/harness";
import {
    encodeObjects, decodeObjects, encodeEntry, decodeEntry, packChunk, unpackChunk,
    objectHeader, extraFields, F64Builder, utf8Encode, utf8Decode, CHUNK_FRAME, CHUNK_LOG,
} from "./format2";
import { nativeFromRecord } from "./Document";

useEngines();

// A drawing with every kind of record in it.
function build() {
    const E = mkEngine(800, 600);
    for (let i = 0; i < 6; i++) drawStroke(E, [[100 + i * 90, 120], [180 + i * 90, 300], [120 + i * 90, 460]], 9 + i);
    eraseGesture(E, [[80, 300], [640, 310]], 20); E.flushErases();   // cut pieces, codes 2/3 in the chops below
    descend(E, 2);
    drawStroke(E, [[300, 200], [420, 330], [350, 420]], 6);           // a native two levels down
    eraseGesture(E, [[280, 300], [460, 300]], 10);                    // left PENDING: a mark to carry
    E.setTool("select"); click(E, 300, 200); drag(E, [300, 200], [340, 230]);   // an offsets table
    return E;
}
const plain = (loops) => loops.map((l) => Array.from(l));
const sameRecord = (a, b) => {
    const { loops: la, ...ra } = a, { loops: lb, ...rb } = b;
    expect(ra).toEqual(rb);
    if (la || lb) expect(plain(la)).toEqual(plain(lb));
};

describe("format2", () => {
    test("a frame's headers + one Float64Array decode to kobin-1's records", () => {
        const E = build();
        const k1 = E.doc.serializeNatives();
        let frames = 0, objects = 0, cutRecords = 0;
        for (const level of Object.keys(k1)) {
            frames++;
            const live = E.doc.at(level);
            const { objects: headers, geo } = encodeObjects(live);
            expect(geo).toBeInstanceOf(Float64Array);
            const back = decodeObjects(headers, geo);
            expect(back.length).toBe(k1[level].length);
            for (let i = 0; i < back.length; i++) { sameRecord(back[i], k1[level][i]); objects++; }
            for (const r of k1[level]) for (const l of (r.loops || [])) for (let i = 2; i < l.length;) { if (l[i] === 2 || l[i] === 3) cutRecords++; i += l[i] === 0 ? 3 : l[i] === 2 ? 9 : l[i] === 3 ? 16 : 8; }
        }
        expect(frames).toBeGreaterThan(1);
        expect(objects).toBeGreaterThan(6);
        expect(cutRecords).toBeGreaterThan(0);          // the erase at depth left canonical-cut pieces
    });

    test("loading the decoded records gives an identical document", () => {
        const E = build();
        const k1 = E.doc.serializeNatives();
        const natives = {};
        for (const level of Object.keys(k1)) { const { objects, geo } = encodeObjects(E.doc.at(level)); natives[level] = decodeObjects(objects, geo); }
        const F = mkEngine(800, 600);
        F.lm.load(E.lm.serialize());
        F.doc.loadNatives(natives);
        expect(JSON.stringify(F.doc.serializeNatives())).toBe(JSON.stringify(k1));
        // and the views were not copied: a loaded shape's loops came from the spans
        expect(F.doc._nextId).toBe(E.doc._nextId);
    });

    test("a header keeps fields it does not know, and writes them back", () => {
        const E = build();
        const level = Object.keys(E.doc.nativesByLevel)[0];
        const o = E.doc.at(level)[0];
        const h = objectHeader(o);
        h.zBand = 7; h.futureFlag = { on: true };
        expect(extraFields(h)).toEqual(["zBand", "futureFlag"]);
        const { geo } = encodeObjects([o]);
        h.g = encodeObjects([o]).objects[0].g;
        const live = nativeFromRecord(decodeObjects([h], geo)[0]);
        expect(live._extra).toEqual(["zBand", "futureFlag"]);
        const again = objectHeader(live);
        expect(again.zBand).toBe(7); expect(again.futureFlag).toEqual({ on: true });
        expect(objectHeader(o).zBand).toBeUndefined();
    });

    test("a span that does not fit is refused, not read", () => {
        const E = build();
        const level = Object.keys(E.doc.nativesByLevel)[0];
        const { objects, geo } = encodeObjects(E.doc.at(level));
        const bad = { ...objects[0], g: [objects[0].g[0], objects[0].g[1] + 3] };
        expect(() => decodeObjects([bad], geo.subarray(0, objects[0].g[0] + objects[0].g[1]))).toThrow(/span/);
        const short = { ...objects[0], g: [objects[0].g[0], objects[0].g[1] - 1] };
        expect(() => decodeObjects([short], geo)).toThrow(/span|loop/);
    });

    test("log entries round-trip: add, bake, removeMany, move", () => {
        const E = build();
        const level = Object.keys(E.doc.nativesByLevel)[0];
        const objs = E.doc.at(level);
        const add = { k: "add", level, index: 0, obj: objs[0] };
        const e1 = encodeEntry(add);
        expect(e1.geo).toBeInstanceOf(Float64Array);
        const d1 = decodeEntry(e1);
        expect(d1.k).toBe("add"); expect(d1.level).toBe(level); expect(d1.index).toBe(0);
        sameRecord(d1.obj, objectHeader(objs[0], { loops: E.doc.serializeNatives([level])[level][0].loops }));
        // a bake step: the object removed and the pieces made
        const bake = { k: "bake", mark: 99, level, removed: { index: 2, obj: objs[1] }, pieces: [{ obj: objs[2] }, { obj: objs[3] }] };
        const d2 = decodeEntry(encodeEntry(bake));
        expect(d2.mark).toBe(99); expect(d2.removed.index).toBe(2);
        expect(d2.removed.obj.id).toBe(objs[1].id); expect(d2.pieces.map((p) => p.id)).toEqual([objs[2].id, objs[3].id]);
        // many removals
        const rm = { k: "removeMany", records: [{ level, index: 1, obj: objs[1] }, { level, index: 4, obj: objs[4] }] };
        const d3 = decodeEntry(encodeEntry(rm));
        expect(d3.records.map((r) => [r.level, r.index, r.obj.id])).toEqual([[level, 1, objs[1].id], [level, 4, objs[4].id]]);
        // a move with before/after geometry, and a null base
        const g = { loops: objs[0].loops, attachRect: null, tile: [1, 2], below: objs[0].below || [[0, 1.5, -2]] };
        const mv = { k: "move", moves: [{ id: objs[0].id, from: level, to: level, dx: 1, dy: 2, base: g, after: null }] };
        const d4 = decodeEntry(encodeEntry(mv));
        expect(d4.moves[0]).toMatchObject({ id: objs[0].id, dx: 1, dy: 2, after: null });
        expect(plain(d4.moves[0].base.loops)).toEqual(plain(encodeObjects([objs[0]]).objects.length ? decodeObjects(encodeObjects([objs[0]]).objects, encodeObjects([objs[0]]).geo)[0].loops : []));
        expect(d4.moves[0].base.attachRect).toBeNull(); expect(d4.moves[0].base.tile).toEqual([1, 2]);
        // no-geometry kinds pass through untouched
        expect(decodeEntry(encodeEntry({ k: "undo", of: 12 }))).toEqual({ k: "undo", of: 12 });
        expect(decodeEntry(encodeEntry({ k: "attr", id: 3, set: { z: 9 } }))).toEqual({ k: "attr", id: 3, set: { z: 9 } });
    });

    test("a chunk packs and unpacks bit for bit, aligned or not", () => {
        const E = build();
        const level = Object.keys(E.doc.nativesByLevel)[0];
        const { objects, geo } = encodeObjects(E.doc.at(level));
        const header = { frame: level, seq: 12, objects, name: "naïve — ünïcode ✓ 𝄞" };
        const bytes = packChunk(CHUNK_FRAME, header, geo);
        expect(bytes.length % 8).toBe(0);
        const back = unpackChunk(bytes);
        expect(back.kind).toBe(CHUNK_FRAME);
        expect(back.header).toEqual(header);
        expect(back.geo.length).toBe(geo.length);
        expect(new Uint8Array(back.geo.buffer, back.geo.byteOffset, back.geo.byteLength)).toEqual(new Uint8Array(geo.buffer));
        // the same bytes at an odd offset in a bigger buffer (a part boundary) still read
        const shifted = new Uint8Array(bytes.length + 3); shifted.set(bytes, 3);
        const again = unpackChunk(shifted.subarray(3));
        expect(again.header).toEqual(header);
        expect(Array.from(again.geo)).toEqual(Array.from(geo));
        expect(() => unpackChunk(bytes.subarray(1))).toThrow(/magic/);
        const log = packChunk(CHUNK_LOG, { k: "undo", of: 1 }, new Float64Array(0));
        expect(unpackChunk(log)).toMatchObject({ kind: CHUNK_LOG, header: { k: "undo", of: 1 } });
        expect(unpackChunk(log).geo.length).toBe(0);
    });

    test("the builder and the UTF-8 helpers", () => {
        const b = new F64Builder(4);
        for (let i = 0; i < 100; i++) b.push(i, i / 3);
        expect(b.length).toBe(200);
        const s = b.slice();
        expect(s.length).toBe(200); expect(s[199]).toBe(99 / 3); expect(s[0]).toBe(0);
        for (const str of ["", "plain", "naïve", "✓ 𝄞 emoji 😀", JSON.stringify({ a: "é", b: [1, 2] })]) {
            expect(utf8Decode(utf8Encode(str))).toBe(str);
            expect(Array.from(utf8Encode(str))).toEqual(Array.from(Buffer.from(str, "utf8")));
        }
    });
});
