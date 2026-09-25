/**
 * The file format's frame-id grammar. A "#n" marks a frame minted in a cell its birth
 * chain no longer names (a subtree move, 2026-09-14); the children of such a frame carry
 * it INSIDE their ids ("0/1,2#2/3,4"), and every one must survive a round trip (F80).
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
    // F80: Kobin's Local Magnum Opus (2026-09-22) had its natives under "…/-149,-746#2/-1809,550"
    // after a subtree move and undo; the old grammar refused the frame on reload and dropped
    // every scene under it on save.
    test("a '#n' on an inner segment — a child of a twin — is accepted, and a scene there is kept", () => {
        expect(() => decodeDrawing(mk("0/1,2#2/3,4"))).not.toThrow();
        expect(() => decodeDrawing(mk("2#2/3,4/5,6#3"))).not.toThrow();
        expect(() => decodeDrawing(mk("0/1,2#2#3"))).toThrow(/valid frame id/);
        expect(() => decodeDrawing(mk("0/1,2#/3,4"))).toThrow(/valid frame id/);
        const level = "0/1,2#2/3,4";
        const d = decodeDrawing(encodeDrawing({
            camera: { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 },
            crossings: {},
            natives: { [level]: [] },
            meta: { scenes: [{ id: "s1", name: "Scene 1", level, rect: { x: 0, y: 0, w: 1, h: 1 }, pinned: true }] },
        }));
        expect(d.meta.scenes.map((s) => s.level)).toEqual([level]);
    });
});
