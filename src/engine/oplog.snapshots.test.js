/**
 * What replay takes from the snapshots (F98): a bake step applies per frame, so a piece whose frame
 * was snapshotted after it was cut again is not put back; and the rebuilt undo stack is capped op by
 * op, as history was live, so it never names a frame frame GC was free to forget (F94).
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { OpLog, snapshotRule } from "./oplog";
import { encodeEntry } from "./format2";
import { UNDO_CAP } from "./Document";

const stroke = (id) => ({ type: "stroke", origin: "native", id, pts: [[0, 0], [30, 20], [60, 10]], lwFrame: 2, color: "#000", opacity: 1 });
const raw = (seq, op, touches) => { const e = encodeEntry(op); return { seq, t: seq, op: e.op, geo: e.geo, touches }; };
const H = "0/1,0";
const load = (natives) => {
    const E = mkEngine(400, 300);
    E.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: null, crossings: {}, natives });
    return E;
};

describe("replay takes what the snapshots hold (F98)", () => {
    useEngines();

    test("R1 a frame the header does not list holds every entry", () => {
        const held = snapshotRule({ 0: 3 }, ["0"]);
        expect(held(5, ["0", "gone"])).toBe(false);          // "0" predates the entry
        expect(held(2, ["0", "gone"])).toBe(true);           // red without `listed`: "gone" read as seq 0
        expect(snapshotRule({ 0: 3 })(2, ["0", "gone"])).toBe(false);
    });

    test("R2 a bake step's piece is not put back into a frame snapshotted after it was cut again", () => {
        // "0" holds X as of seq 1; H was snapshotted at seq 10, after the piece P cut from X at 5 was cut away at 6.
        const E = load({ 0: [stroke(1)], [H]: [] });
        const entries = [
            raw(5, { k: "bake", mark: 99, level: "0", removed: { index: 0, obj: stroke(1) }, pieces: [{ obj: stroke(2) }], levels: [H] }, ["0", H]),
            raw(6, { k: "bake", mark: 99, level: H, removed: { index: 0, obj: stroke(2) }, pieces: [], levels: [] }, [H]),
        ];
        new OpLog(E).replay(entries, { 0: 1, [H]: 10 }, ["0", H]);
        expect(E.doc.getById(1)).toBeNull();                 // cut at 5: "0" predates it
        expect(E.doc.getById(2)).toBeNull();                 // red: the piece came back into H
    });

    test("R3 the rebuilt undo stack is capped op by op, as history was live", () => {
        const E = load({ 0: [] });
        const entries = [];
        for (let s = 1; s <= UNDO_CAP + 5; s++) entries.push(raw(s, { k: "add", level: "0", index: 0, obj: stroke(100 + s) }, ["0"]));
        for (let k = 0; k < 5; k++) { const s = UNDO_CAP + 6 + k; entries.push({ seq: s, t: s, op: { k: "undo", of: UNDO_CAP + 5 - k }, geo: new Float64Array(0), touches: ["0"] }); }
        new OpLog(E).replay(entries, {}, ["0"]);
        // Live: the first 5 adds fell off the cap, the last 5 were undone.
        expect(E.doc._undo.length).toBe(UNDO_CAP - 5);        // red: 200, the capped-off adds back in history
        expect(E.doc._undo[0]._seq).toBe(6);
        expect(E.doc._redo.length).toBe(5);
    });
});
