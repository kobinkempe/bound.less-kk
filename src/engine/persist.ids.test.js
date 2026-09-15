/**
 * The file format's frame-id grammar. A "#n" suffix marks a frame minted in a cell its
 * birth chain no longer names (a subtree move, 2026-09-14) and must survive a round trip.
 */
import { encodeDrawing, decodeDrawing } from "./persist";

const mk = (key) => encodeDrawing({
    camera: { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 },
    crossings: {},
    natives: { [key]: [] },
});

describe("frame ids in a saved drawing", () => {
    test("a suffixed id is accepted; a bare '#' or a non-id is still refused", () => {
        expect(() => decodeDrawing(mk("0/1,2#2"))).not.toThrow();
        expect(() => decodeDrawing(mk("2#2"))).not.toThrow();
        expect(() => decodeDrawing(mk("0/1,2#"))).toThrow(/valid frame id/);
        expect(() => decodeDrawing(mk("abc"))).toThrow(/valid frame id/);
    });
});
