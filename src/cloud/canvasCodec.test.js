/**
 * Pure payload codec for cloud canvas storage (canvasSync.js) — compression,
 * chunking, and the legacy plain-string read path. No Firestore involved.
 */
import { encodeCanvasPayload, decodeCanvasPayload, CANVAS_CODEC } from "./canvasSync";

const doc = (strokes) => JSON.stringify({
    format: "boundless-drawing",
    version: 1,
    meta: { name: "Solar System" },
    natives: { 0: Array.from({ length: strokes }, (_, i) => ({
        type: "stroke", id: i, pts: [[i * 1.234, i * 5.678], [i + 0.1, i + 0.2]], lwFrame: 1,
    })) },
});

describe("cloud/canvasCodec", () => {
    test("round-trip: small doc, one chunk", () => {
        const json = doc(10);
        const { codec, chunks } = encodeCanvasPayload(json);
        expect(codec).toBe(CANVAS_CODEC);
        expect(chunks.length).toBe(1);
        expect(decodeCanvasPayload(chunks, codec)).toBe(json);
    });

    test("round-trip: empty string still yields one part", () => {
        const { codec, chunks } = encodeCanvasPayload("");
        expect(chunks.length).toBe(1);
        expect(decodeCanvasPayload(chunks, codec)).toBe("");
    });

    test("round-trip across multiple chunks (incompressible payload)", () => {
        // Random digits barely compress, forcing the encoder past one 700 KiB
        // chunk; chunk boundaries must reassemble byte-exact.
        let blob = "";
        while (blob.length < 3.2e6) blob += Math.random().toString(36).slice(2);
        const json = JSON.stringify({ meta: { name: "big" }, blob });
        const { codec, chunks } = encodeCanvasPayload(json);
        expect(chunks.length).toBeGreaterThan(1);
        expect(decodeCanvasPayload(chunks, codec)).toBe(json);
    });

    test("compression pulls stroke JSON well under half size", () => {
        const json = doc(5000);
        const { chunks } = encodeCanvasPayload(json);
        const bytes = chunks.reduce((n, c) => n + c.length, 0);
        expect(bytes).toBeLessThan(json.length / 2);
    });

    test("legacy plain-string parts (no codec) join verbatim", () => {
        const json = doc(50);
        const parts = [json.slice(0, 100), json.slice(100)];
        expect(decodeCanvasPayload(parts, undefined)).toBe(json);
        expect(decodeCanvasPayload(parts, null)).toBe(json);
    });
});
