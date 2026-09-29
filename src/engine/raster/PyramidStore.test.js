/**
 * PyramidStore.test.js — the store's L-series, ported from `raster.plates` (RASTERISER-PLAN §9.2 under A3 §4.5):
 * L2 LRU with the drawn set and the plane pinned, L3 the byte cap with `close()` on every evicted bitmap, L7 a dpr
 * change keeping every record (no dpr in a key, D27), L8 the `visibilitychange` release. The rest of the old suite —
 * epochs, the cover set, quanta — went with its mechanisms; rule 1 and rule 2 are `PyramidStore.property.test.js`'s.
 *
 * Every record carries a FAKE bitmap that records its own `close()`: the one thing this store must never do is drop a
 * bitmap without closing it (a bitmap holds memory outside the JS heap, §3.7). `made` and `closed` count them.
 */
import PyramidStore, { PLATE_BYTES, HIDDEN_RELEASE_MS, isPhoneBudget, levelCell, planeCell } from "./PyramidStore";
import { levelKey } from "./level";
import { freshStub } from "../__testkit__/freshStub";

let made = 0, closed = 0;
function mkBitmap() {
    made++;
    return { width: 512, height: 512, closed: false, close() { this.closed = true; closed++; } };
}
beforeEach(() => { made = 0; closed = 0; });

const mkStore = (opts) => new PyramidStore({ fresh: freshStub(), doc: null, ...opts });
/** Store one level-0 plate of frame 0 at (i, j), packed at the current G. */
function putPlate(store, i, j, cell = levelCell("0", 0, 1, i, j)) {
    const bitmap = mkBitmap();
    const status = store.put({ ...cell, G: store.fresh.generation, bitmap, jobId: null });
    return { key: cell.key, bitmap, status };
}

describe("L2 — LRU, with the drawn set and the plane pinned", () => {
    test("the drawn plates survive; the oldest unpinned ones go", () => {
        const store = mkStore({ maxBytes: 6 * PLATE_BYTES });
        const vis = [putPlate(store, 0, 0), putPlate(store, 1, 0), putPlate(store, 0, 1), putPlate(store, 1, 1)];
        store.setDrawn(vis.map((p) => p.key));
        const off = [];
        for (let i = 10; i < 16; i++) off.push(putPlate(store, i, 0));
        expect(store.cache.size).toBe(6);
        expect(store.bytes).toBeLessThanOrEqual(6 * PLATE_BYTES);
        for (const p of vis) { expect(store.get(p.key)).toBeTruthy(); expect(p.bitmap.closed).toBe(false); }
        expect(off.slice(0, 4).map((p) => p.bitmap.closed)).toEqual([true, true, true, true]);
        expect(off.slice(4).map((p) => !!store.get(p.key))).toEqual([true, true]);
        expect(store.s.evictions).toBe(4);
    });

    test("a re-put moves a plate to the front of the queue; the plane's pins survive as the drawn set's do", () => {
        const store = mkStore({ maxBytes: 3 * PLATE_BYTES });
        const a = putPlate(store, 0, 0), b = putPlate(store, 1, 0), c = putPlate(store, 2, 0);
        store.fresh.dirty((x) => x.key === a.key);                   // a changes: its re-render lands newer
        const a2 = putPlate(store, 0, 0);
        expect([a2.status, a.bitmap.closed]).toEqual(["cached", true]);
        putPlate(store, 3, 0);
        expect([!!store.get(a.key), !!store.get(b.key), !!store.get(c.key)]).toEqual([true, false, true]);   // b is the oldest
        const p = putPlate(store, 0, 0, planeCell("0", 1, "z1_0_x", 0, 0));
        store.setPlanePins([p.key]);
        for (let i = 4; i < 8; i++) putPlate(store, i, 0);
        expect(store.get(p.key)).toBeTruthy();
        expect(p.bitmap.closed).toBe(false);
    });
});

describe("L3 — the byte cap, and close() on the evicted bitmap", () => {
    test("five plates into a three-plate cap leave three, and the two that went are closed", () => {
        const store = mkStore({ maxBytes: 3 * PLATE_BYTES });
        const p = [];
        for (let i = 0; i < 5; i++) p.push(putPlate(store, i, 0));
        expect(store.cache.size).toBe(3);
        expect(store.bytes).toBe(3 * PLATE_BYTES);
        expect(p.map((x) => x.bitmap.closed)).toEqual([true, true, false, false, false]);
        expect(closed).toBe(2);
        expect(made - closed).toBe(store.cache.size);
    });

    test("a plate is exactly 1 MiB, so the cap is a plate count; the phone budget is a budget, not a capability", () => {
        expect(PLATE_BYTES).toBe(512 * 512 * 4);
        expect(isPhoneBudget({ deviceMemory: 8, screenW: 2256, screenH: 1302 })).toBe(false);
        expect(isPhoneBudget({ deviceMemory: 4, screenW: 2256, screenH: 1302 })).toBe(true);
        expect(isPhoneBudget({ deviceMemory: 8, screenW: 411, screenH: 750 })).toBe(true);
        expect(isPhoneBudget()).toBe(true);                         // read from window.screen, which jsdom puts at 1024 × 768
        const phone = mkStore({ env: { deviceMemory: 4, screenW: 1079, screenH: 1969 } });
        expect(phone.phone).toBe(true);
    });
});

describe("L7 — a dpr change keeps every record (D27)", () => {
    test("no key carries the dpr, and a resize's new budget evicts only past the new cap", () => {
        expect(levelKey("0", 2, 1, 3, 4)).not.toMatch(/dpr/);
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES });
        const p = [0, 1, 2].map((i) => putPlate(store, i, 0));
        store.setBudget(6 * PLATE_BYTES);                             // the screen changed: the budget follows (A3 §4.5)
        expect(store.cache.size).toBe(3);
        expect(closed).toBe(0);
        expect(p.every((x) => store.get(x.key) && !x.bitmap.closed)).toBe(true);
    });
});

describe("L8 — visibilitychange releases and closes every bitmap", () => {
    test("hidden drops the cache, closes every bitmap, refuses the jobs in flight and tells the renderer", () => {
        const released = [];
        const store = new PyramidStore({ fresh: freshStub(), maxBytes: 8 * PLATE_BYTES, phone: true, onRelease: (why) => released.push(why) });
        const p = [0, 1, 2].map((i) => putPlate(store, i, 0));
        const flying = levelCell("0", 0, 1, 5, 5);
        store.beginJob(7, [flying], 0);

        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(store.cache.size).toBe(3);                             // still visible: nothing happens

        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(store.cache.size).toBe(0);
        expect(store.bytes).toBe(0);
        expect(p.every((x) => x.bitmap.closed)).toBe(true);
        expect(closed).toBe(made);
        expect(released).toEqual(["hidden"]);
        expect(store.inflight.get(flying.key).refused).toBe(true);    // what was in flight lands nothing

        store.destroy();
        document.dispatchEvent(new Event("visibilitychange"));        // the listener is gone
        expect(store.s.releases).toBe(1);
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    });

    test("a desktop releases only after HIDDEN_RELEASE_MS hidden, and a return before then keeps everything", () => {
        jest.useFakeTimers();
        try {
            const store = new PyramidStore({ fresh: freshStub(), maxBytes: 8 * PLATE_BYTES, phone: false });
            putPlate(store, 0, 0);
            Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
            document.dispatchEvent(new Event("visibilitychange"));
            jest.advanceTimersByTime(HIDDEN_RELEASE_MS - 1);
            expect(store.cache.size).toBe(1);
            Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
            document.dispatchEvent(new Event("visibilitychange"));
            jest.advanceTimersByTime(HIDDEN_RELEASE_MS);
            expect([store.cache.size, store.s.releases]).toEqual([1, 0]);
            Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
            document.dispatchEvent(new Event("visibilitychange"));
            jest.advanceTimersByTime(HIDDEN_RELEASE_MS);
            expect([store.cache.size, store.s.releases]).toEqual([0, 1]);
            store.destroy();
        } finally {
            Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
            jest.useRealTimers();
        }
    });
});
