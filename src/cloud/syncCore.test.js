/**
 * syncCore — the pure rules of SYNC-PLAN R1–R5: heads, lease freshness, the open decision.
 */
import { headOf, sameHead, leaseState, decideOpen, conflictName, defaultDeviceName, newEpoch } from "./syncCore";

const COL = "dev-canvases";
const local = (over = {}) => ({ store: "kobin-2", seq: 10, strokes: 3, frameSeq: { 0: 10 }, frameIds: ["0"], savedAt: "2026-09-22T10:00:00Z", base: { epoch: "e1", seq: 10, col: COL }, ...over });
const cloud = (over = {}) => ({ format: "kobin-2", seq: 10, head: { epoch: "e1", seq: 10 }, frames: { 0: { seq: 10 } }, savedAt: "2026-09-22T10:00:00Z", ...over });
const decide = (l, c, deviceId = "me") => decideOpen({ local: l, cloud: c, deviceId, col: COL });

describe("heads", () => {
    test("a manifest from before versions is epoch 0 at its seq", () => {
        expect(headOf({ seq: 7 })).toEqual({ epoch: 0, seq: 7 });
        expect(headOf({ seq: 7, head: { epoch: "x", seq: 9 } })).toEqual({ epoch: "x", seq: 9 });
        expect(headOf(null)).toBe(null);
    });
    test("equal heads need the same epoch and seq", () => {
        expect(sameHead({ epoch: "a", seq: 3 }, { epoch: "a", seq: 3, col: COL })).toBe(true);
        expect(sameHead({ epoch: "a", seq: 3 }, { epoch: "b", seq: 3 })).toBe(false);
        expect(sameHead({ epoch: 0, seq: 3 }, { epoch: "0", seq: 3 })).toBe(true);
        expect(sameHead(null, { epoch: 0, seq: 0 })).toBe(false);
    });
    test("epochs are distinct", () => {
        const s = new Set(Array.from({ length: 200 }, newEpoch));
        expect(s.size).toBe(200);
    });
});

describe("lease", () => {
    const now = 1000000;
    test("free when absent, let go or long past its time; ours whatever the tab", () => {
        expect(leaseState(null, { device: "me", now }).free).toBe(true);
        expect(leaseState({ device: "you", until: 0 }, { device: "me", now }).free).toBe(true);
        // Just past the holder's `until` is not enough: the holder's clock may run behind (review minor 11).
        expect(leaseState({ device: "you", until: now - 1 }, { device: "me", now }).free).toBe(false);
        expect(leaseState({ device: "you", until: now - 6 * 60000 }, { device: "me", now }).free).toBe(true);
        // Let go to an asker: that asker's alone.
        expect(leaseState({ device: "you", until: 0, to: "her" }, { device: "me", now }).free).toBe(false);
        expect(leaseState({ device: "you", until: 0, to: "me" }, { device: "me", now }).free).toBe(true);
        const live = leaseState({ device: "you", until: now + 5000, name: "Phone" }, { device: "me", now });
        expect(live.free).toBe(false);
        expect(live.holder.name).toBe("Phone");
        expect(leaseState({ device: "me", tab: "other", until: now + 5000 }, { device: "me", now })).toMatchObject({ free: true, mine: true });
    });
});

describe("decideOpen (R4)", () => {
    test("in step, push, pull, conflict", () => {
        expect(decide(local(), cloud()).action).toBe("sync");
        expect(decide(local({ seq: 12 }), cloud()).action).toBe("push");
        const pull = decide(local(), cloud({ seq: 14, head: { epoch: "e2", seq: 14 } }));
        expect(pull).toMatchObject({ action: "pull", full: false });
        expect(decide(local({ seq: 12 }), cloud({ seq: 14, head: { epoch: "e2", seq: 14 } })).action).toBe("conflict");
    });
    test("the same seq under another epoch is a different history", () => {
        expect(decide(local({ seq: 12 }), cloud({ seq: 12, head: { epoch: "e2", seq: 12 } })).action).toBe("conflict");
    });
    test("no cloud copy, no local copy, an lz1 copy", () => {
        expect(decide(local(), null).action).toBe("none");
        expect(decide(null, cloud())).toMatchObject({ action: "pull", full: true });
        expect(decide(local(), { parts: 3, codec: "lz1", savedAt: "x" }).action).toBe("legacy");
    });
    test("a base from another collection is no base", () => {
        const l = local({ base: { epoch: "e1", seq: 10, col: "canvases" }, savedAt: "2026-09-22T11:00:00Z" });
        expect(decide(l, cloud()).action).toBe("sync");            // recovered by the fingerprint (same seqs)
        expect(decide({ ...l, seq: 11 }, cloud()).action).toBe("conflict");
    });
    test("a landed intent is recognised by its chunks after another device pushed on top (review minor 13)", () => {
        const l = local({ seq: 12, intent: { epoch: "e9", seq: 12, col: COL, chunks: ["l_11_12_e9_ab"] } });
        const c = cloud({ seq: 15, head: { epoch: "eP", seq: 15 }, frames: { 0: { seq: 10, chunk: "f_0_10_e1_x" } },
            log: [{ chunk: "l_11_12_e9_ab", seqFrom: 11, seqTo: 12 }, { chunk: "l_13_15_eP_cd", seqFrom: 13, seqTo: 15 }] });
        const d = decide(l, c);
        expect(d.action).toBe("pull");
        expect(d.base).toMatchObject({ epoch: "e9", seq: 12 });
        // Not landed (its chunks named nowhere): both moved.
        expect(decide(local({ seq: 12, intent: { epoch: "e9", seq: 12, col: COL, chunks: ["l_11_12_e9_zz"] } }), c).action).toBe("conflict");
    });

    test("a torn push whose manifest landed: the intent is the base", () => {
        const l = local({ seq: 12, intent: { epoch: "e9", seq: 12, col: COL } });
        const d = decide(l, cloud({ seq: 12, head: { epoch: "e9", seq: 12 } }));
        expect(d.action).toBe("sync");
        expect(d.base).toMatchObject({ epoch: "e9", seq: 12 });
    });
    describe("unknown ancestry (a pair from before versions)", () => {
        const old = (over) => local({ base: undefined, ...over });
        test("an empty local copy pulls", () => {
            expect(decide(old({ strokes: 0 }), cloud()).action).toBe("pull");
        });
        test("a legacy copy this device pushed is its base", () => {
            const c = { format: "kobin-2", seq: 10, device: "me", frames: { 0: { seq: 10 } } };
            expect(decide(old({ seq: 12 }), c)).toMatchObject({ action: "push", base: { epoch: 0, seq: 10 } });
            expect(decide(old(), c).action).toBe("sync");
        });
        test("the same frames at the same seqs: pulled from this copy", () => {
            const c = { format: "kobin-2", seq: 10, device: "other", frames: { 0: { seq: 10 } } };
            expect(decide(old(), c).action).toBe("sync");
        });
        test("otherwise the newer by the clock decides, and both answers keep both copies", () => {
            const c = { format: "kobin-2", seq: 30, device: "other", frames: { 0: { seq: 30 } }, savedAt: "2026-09-22T12:00:00Z" };
            expect(decide(old(), c).action).toBe("stash");
            expect(decide(old({ savedAt: "2026-09-22T13:00:00Z" }), c).action).toBe("conflict");
            expect(decide(old({ store: undefined, savedAt: "2026-09-22T13:00:00Z" }), c).action).toBe("stash");   // a v1 store
        });
    });
});

test("names", () => {
    expect(conflictName("Magnum Opus", "Chrome on Windows", new Date(2026, 8, 22))).toMatch(/^Magnum Opus — edits from Chrome on Windows, /);
    expect(defaultDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(defaultDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(defaultDeviceName("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")).toBe("Chrome on Android");
});
