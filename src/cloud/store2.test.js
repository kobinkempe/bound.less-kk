/**
 * store2.js — frame and log chunks round-trip bit for bit through gzip and the part
 * split, with Node's zlib standing in for the browser's CompressionStream.
 */
import zlib from "zlib";
import { packFrameChunk, unpackFrameChunk, packLogChunk, unpackLogChunk, splitParts, joinParts } from "./store2";
import { compression, setCompression, gunzipAs } from "./gzip";
import { encodeRecords, encodeEntry } from "../engine/format2";

const nodeGzip = { name: "gz1", gzip: async (u8) => new Uint8Array(zlib.gzipSync(Buffer.from(u8))), gunzip: async (u8) => new Uint8Array(zlib.gunzipSync(Buffer.from(u8))) };
beforeAll(() => setCompression(nodeGzip));
afterAll(() => setCompression(null));

const records = (n) => Array.from({ length: n }, (_, i) => ({
    type: "shape", origin: "native", id: i + 1,
    loops: [[i * 1.234, i * 5.678, 1, i + 0.5, i - 0.25, 12.5 + i, -0.1 * i, 1.7, i + 3.3, i + 4.4, 0, i * 1.234, i * 5.678]],
    color: "#123456", opacity: 1, w: 7,
}));

describe("cloud/store2", () => {
    test("a frame chunk survives gzip and the part split byte for byte", async () => {
        const { objects, geo } = encodeRecords(records(400));
        const bytes = packFrameChunk({ frameId: "0/12,-3", seq: 42, objects, geo });
        const zipped = await compression().gzip(bytes);
        expect(zipped.length).toBeLessThan(bytes.length);
        const parts = splitParts(zipped, 4096);
        expect(parts.length).toBeGreaterThan(1);
        const back = unpackFrameChunk(await gunzipAs("gz1", joinParts(parts)));
        expect(back.frameId).toBe("0/12,-3"); expect(back.seq).toBe(42);
        expect(back.objects).toEqual(objects);
        expect(Array.from(back.geo)).toEqual(Array.from(geo));
    });

    test("a log chunk carries every entry's own geometry in one array", async () => {
        // a live object as the log sees one: a raw stroke, its points as pairs
        const e1 = encodeEntry({ k: "add", level: "0", index: 0, obj: { type: "stroke", origin: "native", id: 1, pts: [[0, 0], [1.5, 2.5], [3, 3]], lwFrame: 2, color: "#000", opacity: 1 } });
        const e2 = { op: { k: "undo", of: 1 }, geo: new Float64Array(0) };
        const entries = [
            { seq: 1, t: 10, op: e1.op, geo: e1.geo, touches: ["0"] },
            { seq: 2, t: 11, op: e2.op, geo: e2.geo, touches: [] },
            { seq: 3, t: 12, op: { k: "attr", id: 2, set: { z: 9 } }, geo: new Float64Array([7.25, -8]), touches: ["0"] },
        ];
        const bytes = packLogChunk(entries);
        const back = unpackLogChunk(await gunzipAs("gz1", await compression().gzip(bytes)));
        expect(back.map((e) => [e.seq, e.t, e.touches])).toEqual(entries.map((e) => [e.seq, e.t, e.touches]));
        expect(back[0].op).toEqual(e1.op);
        expect(Array.from(back[0].geo)).toEqual(Array.from(e1.geo));
        expect(back[1].geo.length).toBe(0);
        expect(Array.from(back[2].geo)).toEqual([7.25, -8]);
    });

    test("raw is a codec too, and a foreign codec name is refused", async () => {
        const u8 = new Uint8Array([1, 2, 3]);
        expect(await gunzipAs("raw", u8)).toBe(u8);
        await expect(gunzipAs("br9", u8)).rejects.toThrow(/cannot read/);
        expect(splitParts(new Uint8Array(0)).length).toBe(1);
    });
});
