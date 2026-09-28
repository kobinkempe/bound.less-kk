/**
 * raster.plates.test.js — the plate cache (RASTERISER-PLAN §9.2's L-series, under A2 §3's
 * freshness by generation): keys, LRU with the visible set pinned, the byte cap, the hard drops
 * (the settle's own quantum, §6.3, D83; a frame; everything), the in-flight map, rule 1 (a result
 * replaces the stored plate iff its G is newer) and rule 2 (exact iff G ≥ dirtySince), and the
 * `visibilitychange` release. The freshness source is `freshStub`: `dirty()` is a change.
 *
 * Every plate here carries a FAKE bitmap that records its own `close()`, because the one
 * thing this store must never do is drop a bitmap without closing it: a bitmap holds
 * memory outside the JS heap and GC frees it too late on a phone (§3.7). `made` and
 * `closed` are the file's own counters and the crossing probe compares them.
 */

import PlateStore, { PLATE_BYTES, DESKTOP_CACHE_BYTES, PHONE_CACHE_BYTES, defaultCacheBytes, isPhoneBudget, FB_Q_LO, FB_Q_HI, FB_MAX } from "./PlateStore";
import { PLATE_PX, plateKey, quantumFor, zqOf } from "./plate";
import { freshStub } from "../__testkit__/freshStub";

let made = 0, closed = 0;
function mkBitmap() {
    made++;
    return { width: PLATE_PX, height: PLATE_PX, closed: false, close() { this.closed = true; closed++; } };
}
beforeEach(() => { made = 0; closed = 0; });

/** A view in `want`'s own shape: `plateRange`'s output plus the frame, the quantum and Zq. */
function view(frameId, q, i0, i1, j0, j1) {
    return { frameId: String(frameId), q, Zq: zqOf(q), i0, i1, j0, j1 };
}
/** A store whose freshness source a test can change (`store.fresh.dirty(pred)`). */
const mkStore = (opts) => new PlateStore({ fresh: freshStub(), ...opts });
/** Cache one plate, packed at the current G unless the caller says otherwise. */
function putPlate(store, v, i, j, opts = {}) {
    const key = plateKey(v.frameId, v.q, i, j);
    const bitmap = mkBitmap();
    const status = store.put({
        frameId: v.frameId, q: v.q, Zq: v.Zq, i, j,
        G: opts.G !== undefined ? opts.G : store.fresh.generation,
        bitmap, bytes: opts.bytes,
    });
    return { key, bitmap, status };
}
/** Is the record at this key behind the document? Rule 2, spelled out. */
const isStale = (store, key) => { const e = store.get(key); return !!e && !store.isExact(e); };
/** A change that meets exactly these keys. */
const change = (store, ...keys) => store.fresh.dirty((c) => keys.includes(c.key));

describe("L1 — the key carries frame, quantum and indices, and not dpr", () => {
    test("the key is frame|q|i,j and every part of it separates", () => {
        expect(plateKey("0", 3, 1, 2)).toBe("0|3|1,2");
        const all = new Set([plateKey("0", 3, 1, 2), plateKey("6", 3, 1, 2), plateKey("0", 4, 1, 2),
            plateKey("0", 3, 2, 2), plateKey("0", 3, 1, 3)]);
        expect(all.size).toBe(5);
        expect(plateKey("0", "e", 1, 2)).toBe("0|e|1,2");   // the settle's exact key (D24)
    });

    test("two dprs that give the same quantum give the same key and the same plate", () => {
        // Z = inScale × dpr is what the quantum is computed from, so these four cameras are
        // one quantum and one set of plates (D27).
        const cams = [[4, 1], [2, 2], [8 / 3, 1.5], [4 / 2.625, 2.625]];
        const qs = cams.map(([inScale, dpr]) => quantumFor(inScale, dpr).q);
        expect(new Set(qs).size).toBe(1);
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", qs[0], 0, 1, 0, 0);
        store.want(v);
        putPlate(store, v, 0, 0); putPlate(store, v, 1, 0);
        for (const q of qs) {
            const hit = store.want(view("0", q, 0, 1, 0, 0));
            expect(hit.hits.length).toBe(2);
            expect(hit.misses.length).toBe(0);
        }
        expect(store.report().plates).toBe(2);
    });
});

describe("L2 — LRU, with the visible set pinned", () => {
    test("the visible plates survive; the oldest unpinned ones go", () => {
        const store = mkStore({ maxBytes: 6 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 1, 0, 1);              // four visible plates
        store.want(v);                                   // pins them
        const vis = [putPlate(store, v, 0, 0), putPlate(store, v, 1, 0), putPlate(store, v, 0, 1), putPlate(store, v, 1, 1)];
        const off = [];
        for (let i = 10; i < 16; i++) off.push(putPlate(store, v, i, 0));   // six unpinned
        expect(store.size()).toBe(6);
        expect(store.plateBytes()).toBeLessThanOrEqual(6 * PLATE_BYTES);
        for (const p of vis) { expect(store.get(p.key)).toBeTruthy(); expect(p.bitmap.closed).toBe(false); }
        expect(off.slice(0, 4).map((p) => p.bitmap.closed)).toEqual([true, true, true, true]);
        expect(off.slice(4).map((p) => !!store.get(p.key))).toEqual([true, true]);
        expect(store.report().evictions).toBe(4);
    });

    test("a hit moves a plate to the front of the queue", () => {
        const store = mkStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0), b = putPlate(store, v, 1, 0), c = putPlate(store, v, 2, 0);
        store.want(view("0", 0, 0, 0, 0, 0), { pin: "none" });   // touches a, pins nothing
        putPlate(store, v, 3, 0);
        expect(!!store.get(a.key)).toBe(true);
        expect(!!store.get(b.key)).toBe(false);     // b is now the oldest
        expect(b.bitmap.closed).toBe(true);
        expect(!!store.get(c.key)).toBe(true);
    });

    /**
     * §6.3's two live sets. The renderer calls `want(view)` — a "replace" — once a frame, after
     * the layer has asked for the incoming quantum with `{pin:"add"}`, so an added pin merged
     * into the visible set would be discarded every frame and the incoming plates evictable
     * while they raster (D178). `unpinAdded` is the only thing that EMPTIES the second set; an
     * `"add"` want rebuilds it (D184) and a drop removes the keys it drops.
     */
    test("an 'add' pin survives the next 'replace' want, and only unpinAdded clears it", () => {
        const store = mkStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
        const held = view("0", 0, 0, 1, 0, 0);               // the published (held) quantum
        const inc = view("0", 1, 0, 1, 0, 0);                // the incoming one, two plates
        store.want(held);
        const a = [putPlate(store, held, 0, 0), putPlate(store, held, 1, 0)];
        store.want(inc, { pin: "add" });
        const b = [putPlate(store, inc, 0, 0), putPlate(store, inc, 1, 0)];
        store.want(held);                                    // the renderer's own next frame
        expect(store.report().pinned).toBe(2);
        expect(store.report().pinnedAdded).toBe(2);

        // two fresh plates over a four-plate cap: neither set can evict the other, so the only
        // evictable plate is each newcomer itself
        const fresh = view("0", 7, 0, 3, 0, 0);
        const f0 = [putPlate(store, fresh, 0, 0), putPlate(store, fresh, 1, 0)];
        expect(a.every((p) => !!store.get(p.key))).toBe(true);
        expect(b.every((p) => !!store.get(p.key))).toBe(true);
        expect(f0.some((p) => !!store.get(p.key))).toBe(false);
        expect(store.report().evictions).toBe(2);
        expect(store.size()).toBe(4);

        expect(store.unpinAdded()).toBe(2);                  // the switch, or the end of the hold
        expect(store.report().pinnedAdded).toBe(0);
        putPlate(store, fresh, 2, 0); putPlate(store, fresh, 3, 0);
        expect(b.filter((p) => !!store.get(p.key)).length).toBe(0);   // now they are ordinary plates
        expect(b.every((p) => p.bitmap.closed)).toBe(true);
        expect(a.every((p) => !!store.get(p.key))).toBe(true);
    });

    /**
     * An `"add"` want REBUILDS the added set from its own range, exactly as a `"replace"`
     * rebuilds the visible one (D184). `PictureLayer._askQuantum` re-asks once a camera step, so
     * a set that accumulated pinned the union of every incoming range a pan passed through — 20
     * plates of the phone's 48-plate cap after 20 panned frames of one hold, beside the 12 of the
     * visible set, where §6.6 prices that cap at one held screenful plus one incoming one.
     */
    test("a second 'add' want rebuilds the added set: one range, not the union of the pan", () => {
        const store = mkStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
        const first = view("0", 1, 0, 1, 0, 0);              // two plates of the incoming quantum
        store.want(first, { pin: "add" });
        const a = [putPlate(store, first, 0, 0), putPlate(store, first, 1, 0)];
        expect(store.report().pinnedAdded).toBe(2);

        const second = view("0", 1, 2, 3, 0, 0);             // the pan moved on: two other plates
        store.want(second, { pin: "add" });
        expect(store.report().pinnedAdded).toBe(2);          // the current range, not four
        const b = [putPlate(store, second, 2, 0), putPlate(store, second, 3, 0)];

        // one fresh plate over a four-plate cap, with nothing in the visible set: what the pan
        // left behind is what goes, and the incoming range is untouched
        putPlate(store, view("0", 7, 0, 0, 0, 0), 0, 0);
        expect(b.every((p) => !!store.get(p.key))).toBe(true);
        expect(a.filter((p) => !!store.get(p.key)).length).toBe(1);
        expect(store.report().evictions).toBe(1);
        expect(store.report().overCapPinned).toBe(0);
    });

    /**
     * The rebuild is safe because ONE `"add"` caller is live at a time (D179) and nothing in the
     * store enforces that, so the caller is tagged by its request's own `mode` — `"settle"` or
     * `"quantum"`, the two `PictureLayer` uses — and a second tag over a live added set is
     * counted, never refused: nothing on the render path throws (D187). A rebuild by the SAME
     * caller is the ordinary case (`_askQuantum` re-asks once a camera step) and counts nothing.
     */
    test("a second 'add' caller over a live added set is counted, and the same caller is not", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const inc = { ...view("0", 1, 0, 1, 0, 0), mode: "quantum" };
        store.want(inc, { pin: "add" });
        store.want({ ...inc, i0: 2, i1: 3 }, { pin: "add" });    // the same caller, a panned range
        expect(store.report().addCallerMismatch).toBe(0);
        expect(store.report().pinnedAdded).toBe(2);

        // Three cells, so the count alone tells the two ranges apart, and the keys say which.
        const settle = { frameId: "0", q: "e", Zq: 1, i0: 0, i1: 2, j0: 0, j1: 0, mode: "settle" };
        store.want(settle, { pin: "add" });                      // a second caller over a live set
        expect(store.report().addCallerMismatch).toBe(1);
        expect(store.report().pinnedAdded).toBe(3);              // and it is the second caller's range
        expect([...store._held].sort()).toEqual(["0|e|0,0", "0|e|1,0", "0|e|2,0"]);

        store.unpinAdded();                                      // the end of the hold, or the drop
        store.want(inc, { pin: "add" });                         // no live set: no mismatch
        expect(store.report().addCallerMismatch).toBe(1);
    });

    test("the prebake's want does not steal the visible pins (§5.6)", () => {
        const store = mkStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
        const vis = view("0", 0, 0, 1, 0, 0);
        store.want(vis);
        const held = [putPlate(store, vis, 0, 0), putPlate(store, vis, 1, 0)];
        const child = view("6", 0, 0, 1, 0, 0);
        store.want(child, { pin: "none" });                 // the child frame, lowest priority
        const pre = [putPlate(store, child, 0, 0), putPlate(store, child, 1, 0)];
        for (const p of held) expect(!!store.get(p.key)).toBe(true);   // the visible pair survived
        expect([...store._pins].sort()).toEqual(held.map((p) => p.key).sort());
        // The prebaked plates stay evictable, which is what `TileStore` restores its pins by
        // hand to get (`TileStore.js:557-561`).
        expect(pre.filter((p) => !!store.get(p.key)).length).toBe(1);
        expect(store.report().evictions).toBe(1);
    });
});

describe("L3 — the byte cap, and close() on the evicted bitmap", () => {
    test("five plates into a three-plate cap leave three, and the two that went are closed", () => {
        const store = mkStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const p = [];
        for (let i = 0; i < 5; i++) p.push(putPlate(store, v, i, 0));
        expect(store.size()).toBe(3);
        expect(store.plateBytes()).toBe(3 * PLATE_BYTES);
        expect(p.map((x) => x.bitmap.closed)).toEqual([true, true, false, false, false]);
        expect(closed).toBe(2);
        expect(made - closed).toBe(store.size());
    });

    test("the device budget is §6.6's two numbers, and it is on the record", () => {
        expect(PLATE_BYTES).toBe(512 * 512 * 4);
        // A 512² RGBA plate is exactly 1 MiB, so the cap is a plate count (D80).
        expect(DESKTOP_CACHE_BYTES / PLATE_BYTES).toBe(96);
        // 48 and not 24 since §6.3's hold: 24 held plates plus 24 incoming is a worst-case
        // phone screen between quanta twice over, and at 24 the held set is evicted as the new
        // one fills (D170, amending D80).
        expect(PHONE_CACHE_BYTES / PLATE_BYTES).toBe(56);   // 24 held + 24 incoming + a preview (R2)
        expect(defaultCacheBytes({ deviceMemory: 8, screenW: 2256, screenH: 1302 })).toBe(DESKTOP_CACHE_BYTES);
        expect(defaultCacheBytes({ deviceMemory: 4, screenW: 2256, screenH: 1302 })).toBe(PHONE_CACHE_BYTES);
        expect(defaultCacheBytes({ deviceMemory: 8, screenW: 1079, screenH: 1969 })).toBe(DESKTOP_CACHE_BYTES);
        expect(isPhoneBudget({ deviceMemory: 8, screenW: 411, screenH: 750 })).toBe(true);
        expect(isPhoneBudget()).toBe(true);            // read from window.screen, which jsdom puts at 1024 × 768
        const phone = mkStore({ env: { deviceMemory: 4, screenW: 1079, screenH: 1969 }, doc: null });
        expect(phone.report().phone).toBe(true);
        expect(phone.report().maxBytes).toBe(PHONE_CACHE_BYTES);
    });
});

describe("L7 — a dpr change keeps every plate (D27)", () => {
    test("nothing is dropped, nothing is closed, and the quantum's plates still hit", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const q = quantumFor(1, 2).q;
        const v = view("0", q, 0, 1, 0, 0);
        store.want(v);
        putPlate(store, v, 0, 0); putPlate(store, v, 1, 0);
        expect(store.noteDpr(1.5)).toBe(2);              // the canvas resizes; the cache does not
        expect(store.size()).toBe(2);
        expect(closed).toBe(0);
        expect(store.report().dpr).toBe(1.5);
        // The camera that lands on the same quantum at the new dpr hits both plates.
        expect(quantumFor(2 / 1.5, 1.5).q).toBe(q);
        const again = store.want(view("0", quantumFor(2 / 1.5, 1.5).q, 0, 1, 0, 0));
        expect(again.hits.length).toBe(2);
        expect(again.misses.length).toBe(0);
    });
});

describe("L8 — visibilitychange releases and closes every bitmap", () => {
    test("hidden drops the cache, closes every bitmap and tells the layer", () => {
        const released = [];
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, onRelease: (why) => released.push(why) });
        store.phone = true;                               // a desktop releases after HIDDEN_RELEASE_MS (raster.nopaper N11)
        const v = view("0", 0, 0, 2, 0, 0);
        store.want(v);
        const p = [0, 1, 2].map((i) => putPlate(store, v, i, 0));
        store.beginJob(7, v, [{ i: 5, j: 5 }], 0);

        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(store.size()).toBe(3);                    // still visible: nothing happens

        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(store.size()).toBe(0);
        expect(store.plateBytes()).toBe(0);
        expect(p.every((x) => x.bitmap.closed)).toBe(true);
        expect(closed).toBe(made);
        expect(released).toEqual(["hidden"]);
        // The job that was in flight when the tab went away is refused.
        expect(store.inflight.get(plateKey("0", 0, 5, 5)).refused).toBe(true);

        store.destroy();
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));   // the listener is gone
        expect(store.report().releases).toBe(1);
    });
});

describe("L9 — freshness by G: a job's cells are tracked from beginJob; rule 1 and rule 2 (A2 §3.1)", () => {
    test("posted, changed, arrived behind and stored as a stand-in, re-posted, exact", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        const miss = store.want(v).misses;
        expect(miss.map((m) => m.key)).toEqual([key]);
        store.beginJob(1, v, miss, 0);
        expect(store.fresh.cells.has(key)).toBe(true);    // tracked while in flight, before anything is stored

        // The document changes while the plate is in flight: the cell's dirtySince moves past the job's G.
        expect(change(store, key)).toBe(1);
        expect(store.fresh.dirtySince(key)).toBe(1);

        const late = mkBitmap();
        expect(store.put({ jobId: 1, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G: 0, bitmap: late })).toBe("newer");
        expect(late.closed).toBe(false);                  // rule 1: nothing stored, so it is (stale before paper)
        expect(isStale(store, key)).toBe(true);
        expect(store.report().staleNewer).toBe(1);

        // And it is a hit and a miss, so the renderer re-posts it at the current G.
        const again = store.want(v);
        expect(again.hits.length).toBe(1);
        expect(again.misses.map((m) => m.key)).toEqual([key]);
        store.beginJob(2, v, again.misses, 1);
        const fresh = mkBitmap();
        expect(store.put({ jobId: 2, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G: 1, bitmap: fresh })).toBe("cached");
        expect(late.closed).toBe(true);
        expect(fresh.closed).toBe(false);
        expect(store.size()).toBe(1);
        expect(store.inflight.size).toBe(0);
        expect(store.jobs.size).toBe(0);
    });

    test("a plate already in flight is not posted twice", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 1, 0, 0);
        const first = store.want(v);
        expect(first.misses.length).toBe(2);
        store.beginJob(1, v, first.misses, 0);
        const second = store.want(v);
        expect(second.misses.length).toBe(0);
        expect(second.inFlight).toBe(2);
        store.endJob(1);
        expect(store.want(v).misses.length).toBe(2);     // abandoned, so they are wanted again
        expect(store.fresh.cells.size).toBe(0);          // and neither stored nor in flight: untracked
    });

    test("a late result from a superseded job does not cancel the re-post", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        store.beginJob(1, v, [{ i: 0, j: 0 }], 0);
        change(store, key);
        store.beginJob(2, v, [{ i: 0, j: 0 }], 1);       // the re-post, at the new G
        const late = mkBitmap();
        expect(store.put({ jobId: 1, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G: 0, bitmap: late })).toBe("newer");
        expect(store.inflight.has(key)).toBe(true);      // job 2 is still running for it
        expect(store.want(v).misses.length).toBe(0);
        expect(store.put({ jobId: 2, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G: 1, bitmap: mkBitmap() })).toBe("cached");
        expect(late.closed).toBe(true);
        expect(store.inflight.size).toBe(0);
    });

    test("a result with NO G is discarded, closed and counted", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        store.beginJob(1, v, [{ i: 0, j: 0 }], 0);
        const bm = mkBitmap();
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, bitmap: bm })).toBe("stale");
        expect(bm.closed).toBe(true);
        expect(store.report().noG).toBe(1);
        expect(store.size()).toBe(0);
    });

    test("an eviction is not a change, so a result in flight for it is still exact", () => {
        const store = mkStore({ maxBytes: 1 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        store.beginJob(1, v, [{ i: 0, j: 0 }], 0);
        putPlate(store, v, 1, 0);                        // fills the cap; nothing to evict yet
        putPlate(store, v, 2, 0);                        // evicts (1,0)
        expect(store.report().evictions).toBe(1);
        const bm = mkBitmap();
        expect(store.put({ jobId: 1, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G: 0, bitmap: bm })).toBe("cached");
    });

    test("equal G: the stored plate stays and the arrival is closed (the pack and the core are deterministic)", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0);
        const b = putPlate(store, v, 0, 0);
        expect(b.status).toBe("cached");
        expect(store.get(a.key).bitmap).toBe(a.bitmap);
        expect(b.bitmap.closed).toBe(true);
        expect(store.report().replaced).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// L10 — PAPER-PLAN R1: stale before paper, and the cross-quantum cover set.
//
// A change KEEPS the record and its bitmap; a record is stale when `e.G < dirtySince(e.key)`,
// which is derived and never flagged (rule 2). The screen therefore shows old ink until the
// replacement lands instead of paper. Nothing here is a picture: what is asserted is the record,
// its G, the pins and the order.
// ---------------------------------------------------------------------------

describe("L10 — R1: stale before paper", () => {
    test("a changed plate is kept as a stale hit, and want returns it twice", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 1, 0, 0);
        store.want(v);
        const a = putPlate(store, v, 0, 0);
        const b = putPlate(store, v, 1, 0);
        const bytes0 = store.plateBytes();
        expect(change(store, a.key)).toBe(1);

        expect(store.size()).toBe(2);
        expect(!!store.get(a.key)).toBe(true);
        expect(a.bitmap.closed).toBe(false);
        expect(store.plateBytes()).toBe(bytes0);           // stale pixels stay inside §6.6's cap
        expect(isStale(store, a.key)).toBe(true);

        const got = store.want(v);
        expect(got.hits.map((h) => h.key)).toEqual([a.key, b.key]);   // BOTH are hits…
        expect(got.misses.map((m) => m.key)).toEqual([a.key]);        // …and the stale one is a miss
        expect(store.report().staleHits).toBe(1);
        // the screen's own stale picture is pinned, so nothing can evict it
        expect(store._pins.has(a.key)).toBe(true);
    });

    test("the replacement closes the stale bitmap exactly once, and the record is fresh again", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0);
        change(store, a.key);
        const b = putPlate(store, v, 0, 0);
        expect(b.status).toBe("cached");
        expect(a.bitmap.closed).toBe(true);
        expect(b.bitmap.closed).toBe(false);
        expect(closed).toBe(1);
        expect(store.report().replaced).toBe(1);
        expect(store.report().staleReplaced).toBe(1);
        expect(isStale(store, b.key)).toBe(false);
        expect(store.want(v).misses.length).toBe(0);
        expect(made - closed).toBe(store.size());
    });

    test("a stale plate's re-post is packed at the current G and lands exact", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0);
        change(store, a.key);
        const miss = store.want(v).misses;
        store.beginJob(1, v, miss, store.fresh.generation);
        expect(store.inflight.get(a.key).G).toBe(1);
        expect(store.put({ jobId: 1, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G: 1, bitmap: mkBitmap() })).toBe("cached");
        expect(store.inflight.size).toBe(0);
    });

    test("a stale plate in flight is not re-posted twice", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0);
        change(store, a.key);
        store.beginJob(1, v, store.want(v).misses, 1);
        const again = store.want(v);
        expect(again.hits.length).toBe(1);               // the stale pixels are still composed
        expect(again.misses.length).toBe(0);             // and not asked for a second time
        expect(again.inFlight).toBe(1);
    });

    test("eviction takes the stale plates first; a stale plate in the visible range is pinned and stays", () => {
        const store = mkStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);              // only (0,0) is visible
        store.want(v);                                   // pins (0,0) alone, before anything is cached
        const onScreen = putPlate(store, v, 0, 0);
        const fresh = putPlate(store, v, 7, 0);
        const stale = putPlate(store, v, 8, 0);
        expect(change(store, onScreen.key, stale.key)).toBe(2);   // (0,0) and (8,0) go stale
        expect(store.report().stale).toBe(2);

        putPlate(store, v, 9, 0);                        // a fourth plate over a three-plate cap
        // `fresh` is OLDER than `stale` by LRU, and it survives: staleness outranks age
        expect(!!store.get(stale.key)).toBe(false);
        expect(stale.bitmap.closed).toBe(true);
        expect(!!store.get(fresh.key)).toBe(true);
        expect(!!store.get(onScreen.key)).toBe(true);    // pinned, though it is the oldest stale one
        expect(store.report().staleEvictions).toBe(1);
        expect(store.report().evictions).toBe(1);
    });

    test("a second change while the re-post is out: the re-post replaces the older pixels and stays stale (F106)", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0);
        change(store, a.key);
        store.beginJob(1, v, store.want(v).misses, 1);
        change(store, a.key);                            // the cell is tracked: the stale record and the job
        expect(store.fresh.dirtySince(a.key)).toBe(2);
        const late = mkBitmap();
        expect(store.put({ jobId: 1, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G: 1, bitmap: late })).toBe("newer");
        expect(store.get(a.key).bitmap).toBe(late);
        expect(isStale(store, a.key)).toBe(true);
    });

    test("dropAll and release still remove and close every plate, stale ones included", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 2, 0, 0);
        [0, 1, 2].map((i) => putPlate(store, v, i, 0));
        store.fresh.dirty();
        expect(store.report().stale).toBe(3);
        expect(store.dropAll()).toBe(3);
        expect(store.size()).toBe(0);
        expect(store.plateBytes()).toBe(0);
        expect(closed).toBe(made);
        expect(made - closed).toBe(store.size());
    });

    test("dropQuantum('e') still removes the settled plates: a settled plate is never kept as stale", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const ev = { frameId: "0", q: "e", Zq: 3.1, i0: 0, i1: 1, j0: 0, j1: 0 };
        const p = [putPlate(store, ev, 0, 0), putPlate(store, ev, 1, 0)];
        // and while they are cached they are not a fallback either: `"e"` carries no zoom of its
        // own, so nothing can say what stretch to draw it at (D83)
        expect(store.fallbackCover({ frameId: "0", q: 0, Zq: 1, i0: -9, i1: 9, j0: -9, j1: 9 }, [])).toBe(0);
        expect(store.dropQuantum("e")).toBe(2);
        expect(store.size()).toBe(0);                    // D83: a hard remove, not a stale hit
        expect(p.every((x) => x.bitmap.closed)).toBe(true);
    });

    test("abandonQuantum refuses the in-flight keys and keeps the cached ones exact and unpinned", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const inc = { ...view("0", 4, 0, 1, 0, 0), mode: "quantum" };
        store.want(inc, { pin: "add" });
        const cached = putPlate(store, inc, 0, 0);
        store.beginJob(1, inc, [{ i: 1, j: 0 }], 0);
        const flightKey = plateKey("0", 4, 1, 0);
        expect(store.report().pinnedAdded).toBe(2);

        expect(store.abandonQuantum(4)).toBe(2);
        expect(isStale(store, cached.key)).toBe(false);  // the document did not change
        expect(!!store.get(cached.key)).toBe(true);      // its pixels are the screen's best fallback
        expect(cached.bitmap.closed).toBe(false);
        expect(store.report().pinnedAdded).toBe(0);
        const late = mkBitmap();
        expect(store.put({ jobId: 1, frameId: "0", q: 4, Zq: zqOf(4), i: 1, j: 0, G: 0, bitmap: late })).toBe("stale");   // the straggler is refused
        expect(late.closed).toBe(true);
        expect(store.get(flightKey)).toBeUndefined();
        expect(store.report().refused).toBe(1);
        expect(store.report().abandons).toBe(1);
    });
});

describe("L10 — the cross-quantum cover set", () => {
    /** Cache one plate at an arbitrary quantum and frame; `q` need not be the view's. */
    function at(store, frameId, q, i, j) {
        return putPlate(store, view(frameId, q, i, i, j, j), i, j);
    }

    test("the cover set is coarsest first, same frame only, never 'e', inside the window and inside the cap", () => {
        const store = mkStore({ maxBytes: 64 * PLATE_BYTES, doc: null });
        const req = { frameId: "0", q: 0, Zq: 1, i0: 0, i1: 3, j0: 0, j1: 1 };
        // the four that qualify, coarsest first: q −8, q −4, q −1, q +2
        at(store, "0", -1, 0, 0); at(store, "0", 2, 0, 0); at(store, "0", -8, 0, 0); at(store, "0", -4, 0, 0);
        at(store, "0", FB_Q_LO - 1, 0, 0);               // too coarse: outside the window
        at(store, "0", FB_Q_HI + 1, 0, 0);               // too fine: outside the window
        at(store, "0", -4, 40, 40);                      // same quantum, nowhere near the range
        at(store, "6", -4, 0, 0);                        // another frame: another coordinate system
        putPlate(store, { frameId: "0", q: "e", Zq: 1.7, i0: 0, i1: 0, j0: 0, j1: 0 }, 0, 0);
        at(store, "0", 0, 0, 0);                         // the view's own quantum: a hit, not a fallback

        const out = [];
        expect(store.fallbackCover(req, out)).toBe(4);
        expect(out.map((e) => e.q)).toEqual([-8, -4, -1, 2]);
        expect(out.every((e) => e.frameId === "0")).toBe(true);
        expect(store.report().fallbackScans).toBe(1);
        expect(store.report().fallbackCandidates).toBe(4);
    });

    test("the cap bites at FB_MAX and the COARSEST survive it, which is why a cap cannot cost coverage", () => {
        const store = mkStore({ maxBytes: (FB_MAX + 16) * PLATE_BYTES, doc: null });
        const req = { frameId: "0", q: 0, Zq: 1, i0: 0, i1: 80, j0: 0, j1: 80 };
        for (let i = 0; i < FB_MAX + 6; i++) at(store, "0", -1, i, 0);   // FB_MAX + 6 fine ones
        at(store, "0", -8, 0, 0); at(store, "0", -8, 1, 0);              // two coarse ones
        const out = [];
        expect(store.fallbackCover(req, out)).toBe(FB_MAX);
        expect(out.length).toBe(FB_MAX);
        expect(out.map((e) => e.q).slice(0, 2)).toEqual([-8, -8]);       // the coarse pair is kept
        expect(store.report().fallbackCandidates).toBe(FB_MAX + 8);
        expect(store.report().fallbackDropped).toBe(8);
    });

    test("the cover walk touches no pin and no LRU: a fallback stays the first unpinned eviction", () => {
        const store = mkStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const fb = at(store, "0", -4, 0, 0);             // the oldest, and a fallback
        const other = putPlate(store, v, 7, 0);
        store.want(v);                                   // pins (0,0) at q 0 — nothing cached there
        const pins0 = [...store._pins].sort(), clock0 = store._clock;

        const out = [];
        expect(store.fallbackCover({ frameId: "0", q: 0, Zq: 1, i0: 0, i1: 1, j0: 0, j1: 1 }, out)).toBe(1);
        expect([...store._pins].sort()).toEqual(pins0);
        expect(store._clock).toBe(clock0);               // no LRU touch
        expect(store.get(fb.key).lru).toBeLessThan(store.get(other.key).lru);

        putPlate(store, v, 8, 0); putPlate(store, v, 9, 0);
        expect(!!store.get(fb.key)).toBe(false);         // taken first, as §6.6 wants
        expect(!!store.get(other.key)).toBe(true);
    });

    test("an EMPTY plate is cover (nothing to draw); raw pixels and an unusable Zq are never a fallback", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        store.put({ frameId: "0", q: -4, Zq: zqOf(-4), i: 0, j: 0, G: 0, bitmap: null, bytes: 0 });
        store.put({ frameId: "0", q: -3, Zq: zqOf(-3), i: 0, j: 0, G: 0, bitmap: null, pixels: new Uint8ClampedArray(4), bytes: 4 });
        store.put({ frameId: "0", q: -5, Zq: 0, i: 0, j: 0, G: 0, bitmap: mkBitmap() });
        const out = [];
        expect(store.fallbackCover({ frameId: "0", q: 0, Zq: 1, i0: -9, i1: 9, j0: -9, j1: 9 }, out)).toBe(1);
        expect(out[0].q).toBe(-4);
        expect(out[0].bitmap).toBe(null);
    });

    test("R5b: the ladder's plates are evicted LAST, after stale ones and the gesture's own", () => {
        const store = mkStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
        const lad = putPlate(store, view("0", -20, 0, 0, 0, 0), 0, 0);
        store.markLadder([lad.key], true);
        const a = putPlate(store, view("0", 0, 0, 0, 0, 0), 0, 0);
        const b = putPlate(store, view("0", 0, 1, 1, 0, 0), 1, 0);
        const c = putPlate(store, view("0", 0, 2, 2, 0, 0), 2, 0);
        expect(store.cache.size).toBe(4);
        putPlate(store, view("0", 0, 3, 3, 0, 0), 3, 0);           // over the cap by one
        expect(!!store.get(lad.key)).toBe(true);                    // the oldest, but the ladder's
        expect(!!store.get(a.key)).toBe(false);                     // the oldest ordinary plate goes
        expect(!!store.get(b.key) && !!store.get(c.key)).toBe(true);
        store.markLadder([], true);                                 // a new ladder: the old rung is ordinary again
        putPlate(store, view("0", 0, 4, 4, 0, 0), 4, 0);
        expect(!!store.get(lad.key)).toBe(false);
    });

    test("a STALE plate at another quantum is still a fallback: stale beats paper twice over", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const p = at(store, "0", -4, 0, 0);
        change(store, p.key);
        expect(isStale(store, p.key)).toBe(true);
        const out = [];
        expect(store.fallbackCover({ frameId: "0", q: 0, Zq: 1, i0: 0, i1: 1, j0: 0, j1: 1 }, out)).toBe(1);
        expect(out[0].key).toBe(p.key);
    });
});

describe("the settle's exact plates: dropQuantum (§6.3, D83)", () => {
    /** The settle's view: the exact zoom, keyed "e", which carries no zoom of its own (D24). */
    const exact = (Z, i1 = 1) => ({ frameId: "0", q: "e", Zq: Z, i0: 0, i1, j0: 0, j1: 0 });

    test("the settled plates go on the next camera move; the quantum's plates do not", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const qv = view("0", 12, 0, 1, 0, 0);
        store.want(qv);
        const held = [putPlate(store, qv, 0, 0), putPlate(store, qv, 1, 0)];

        const ev = exact(3.1);
        store.want(ev, { pin: "add" });                    // the settle's second view (D75)
        const settled = [putPlate(store, ev, 0, 0), putPlate(store, ev, 1, 0)];
        expect(store.size()).toBe(4);

        // Until they are dropped they are hits at ANY exact zoom — the picture layer would
        // blit 3.1-scale pixels into a 7.9-scale screen and post no job.
        const wrong = store.want(exact(7.9), { pin: "none" });
        expect(wrong.hits.length).toBe(2);
        expect(wrong.hits[0].Zq).toBe(3.1);

        expect(store.dropQuantum("e")).toBe(2);
        expect(settled.map((p) => p.bitmap.closed)).toEqual([true, true]);
        const after = store.want(exact(7.9), { pin: "none" });
        expect(after.hits.length).toBe(0);
        expect(after.misses.length).toBe(2);

        for (const p of held) { expect(!!store.get(p.key)).toBe(true); expect(p.bitmap.closed).toBe(false); }
        expect(held.every((p) => !isStale(store, p.key))).toBe(true);
        expect([...store._pins].sort()).toEqual(held.map((p) => p.key).sort());
        expect(store.report().dropsByQ).toBe(2);
        expect(made - closed).toBe(store.size());
    });

    test("a settle job still in flight is refused on arrival", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const ev = exact(3.1, 0);
        store.beginJob(7, ev, store.want(ev, { pin: "add" }).misses, 0);
        expect(store.dropQuantum("e")).toBe(1);
        const late = mkBitmap();
        expect(store.put({ jobId: 7, frameId: "0", q: "e", Zq: 3.1, i: 0, j: 0, G: 0, bitmap: late })).toBe("stale");
        expect(late.closed).toBe(true);
        expect(store.size()).toBe(0);
        expect(store.dropQuantum("e")).toBe(0);
    });

    test("a quantum given as a number and as a string are one quantum, because the key is one string", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 12, 0, 0, 0, 0);
        putPlate(store, v, 0, 0);
        expect(store.dropQuantum("12")).toBe(1);
        expect(store.size()).toBe(0);
    });
});

describe("the hard drops, a crossing, the report and the replace", () => {
    test("the hard drops: dropFrames and dropAll remove, close, and refuse what is in flight", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const a = view("0", 0, 0, 1, 0, 0), b = view("6", 0, 0, 0, 0, 0);
        putPlate(store, a, 0, 0); putPlate(store, a, 1, 0); putPlate(store, b, 0, 0);
        store.beginJob(3, a, [{ i: 9, j: 9 }], 0);
        expect(store.dropFrames((f) => f === "6")).toBe(1);   // a merge: the merged-away frame's keys
        expect(store.size()).toBe(2);
        expect(store.dropAll(false)).toBe(3);                  // a reset: two cached, one in flight
        expect(store.size()).toBe(0);
        expect(closed).toBe(made);
        const late = mkBitmap();
        expect(store.put({ jobId: 3, frameId: "0", q: 0, Zq: 1, i: 9, j: 9, G: 0, bitmap: late })).toBe("stale");
        expect(late.closed).toBe(true);
        expect(store.report().refused).toBe(1);
    });

    test("a refused job stays refused when a newer job for its key begins before it lands", () => {
        // Two strips for one key queued in one frameSeq (a frame step's post and an arrival's re-post)
        // dispatch apart; a hard drop between them refuses the first, and the second's record replaces it.
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const e1 = { frameId: "0", q: "e", Zq: 3.1, i0: 0, i1: 0, j0: 0, j1: 0 };
        const e2 = { ...e1, Zq: 3.3 };
        store.beginJob(11, e1, [{ i: 0, j: 0 }], 0);
        expect(store.dropQuantum("e")).toBe(1);
        store.beginJob(12, e2, [{ i: 0, j: 0 }], 0);
        const late = mkBitmap();
        expect(store.put({ jobId: 11, frameId: "0", q: "e", Zq: 3.1, i: 0, j: 0, G: 0, bitmap: late })).toBe("stale");
        expect(late.closed).toBe(true);
        expect(store.put({ jobId: 12, frameId: "0", q: "e", Zq: 3.3, i: 0, j: 0, G: 0, bitmap: mkBitmap() })).toBe("cached");
        expect(store.get(plateKey("0", "e", 0, 0)).Zq).toBe(3.3);
        // Another document: the old one's job lands after the new one's began, and is discarded.
        const v = view("0", 0, 0, 0, 0, 0);
        store.beginJob(13, v, [{ i: 5, j: 5 }], 0);
        store.dropAll(false);
        store.beginJob(14, v, [{ i: 5, j: 5 }], 1);
        expect(store.put({ jobId: 13, frameId: "0", q: 0, Zq: 1, i: 5, j: 5, G: 0, bitmap: mkBitmap() })).toBe("stale");
        expect(store.get(plateKey("0", 0, 5, 5))).toBeUndefined();
        store.endJob(13);
        expect(store.put({ jobId: 14, frameId: "0", q: 0, Zq: 1, i: 5, j: 5, G: 1, bitmap: mkBitmap() })).toBe("cached");
        expect(store.report().refused).toBe(2);
    });

    test("rule 5 — a frame crossing drops nothing, so crossing back is a hit", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const home = view("0", 0, 0, 1, 0, 0), child = view("6", 12, 0, 1, 0, 0);
        store.want(home);
        putPlate(store, home, 0, 0); putPlate(store, home, 1, 0);
        const there = store.want(child);                 // the crossing: a new frame, all misses
        expect(there.hits.length).toBe(0);
        expect(there.misses.length).toBe(2);
        putPlate(store, child, 0, 0); putPlate(store, child, 1, 0);
        expect(store.size()).toBe(4);
        expect(closed).toBe(0);
        const back = store.want(home);
        expect(back.hits.length).toBe(2);
        expect(back.misses.length).toBe(0);
    });

    test("the report is what §8.5 asks for, and bounded", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        store.want(v);
        putPlate(store, v, 0, 0);
        const r = store.report();
        expect(r.trackedKeys).toBe(1);
        expect(r.plates).toBe(1);
        expect(r.plateBytes).toBe(PLATE_BYTES);
        expect(r.hits + r.misses).toBe(1);
        expect(Object.values(r).every((x) => typeof x === "number" || typeof x === "boolean")).toBe(true);
        // Bounded and flat is the rule (F58), not a particular width; R1's eight counters,
        // `stale`/`staleBytes` and F106's `staleNewer` put it at 50.
        expect(Object.keys(r).length).toBeLessThan(56);
    });

    test("a replaced plate closes the bitmap it replaces", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const first = putPlate(store, v, 0, 0);
        const second = putPlate(store, v, 0, 0, { G: 1 });   // rule 1: a newer G
        expect(first.bitmap.closed).toBe(true);
        expect(second.bitmap.closed).toBe(false);
        expect(store.size()).toBe(1);
        expect(store.plateBytes()).toBe(PLATE_BYTES);
        expect(store.report().replaced).toBe(1);
    });
});

describe("the crossing probe — no per-crossing growth, and closes equal to allocations", () => {
    test("20 crossings, 24 plates each: the cache saturates at its cap and nothing leaks", () => {
        const store = mkStore({ maxBytes: DESKTOP_CACHE_BYTES, doc: null });
        const cap = Math.floor(DESKTOP_CACHE_BYTES / PLATE_BYTES);      // 96 plates
        const sizes = [], byteCounts = [];
        for (let c = 0; c < 20; c++) {
            const v = view(String(100 + c), 8, 0, 5, 0, 3);             // a fresh frame: 6 × 4 = 24 plates
            const { misses } = store.want(v);
            expect(misses.length).toBe(24);
            store.beginJob(c, v, misses, 0);
            for (const m of misses) {
                store.put({ jobId: c, frameId: v.frameId, q: v.q, Zq: v.Zq, i: m.i, j: m.j, G: 0, bitmap: mkBitmap() });
            }
            expect(store.inflight.size).toBe(0);
            expect(made - closed).toBe(store.size());                   // every dropped bitmap was closed
            // The store's OWN instrument, beside the fixture's counters: §3.7 puts the leak
            // on the report, so the two report fields are asserted at every step as well.
            const r = store.report();
            expect(r.bitmapsOpen).toBe(made);
            expect(r.bitmapsClosed).toBe(closed);
            expect(r.bitmapsOpen - r.bitmapsClosed).toBe(store.size());
            expect(store.plateBytes()).toBeLessThanOrEqual(DESKTOP_CACHE_BYTES);
            sizes.push(store.size());
            byteCounts.push(store.plateBytes());
        }
        expect(made).toBe(480);
        expect(sizes[3]).toBe(cap);                                      // saturated on the fourth crossing
        expect(new Set(sizes.slice(3)).size).toBe(1);                    // and flat over the last 17
        expect(new Set(byteCounts.slice(3)).size).toBe(1);
        expect(store.fresh.cells.size).toBe(store.size());              // tracked: exactly what is stored
        expect(store.jobs.size).toBe(0);
        store.release("hidden");
        expect(closed).toBe(made);
        expect(store.report().bitmapsClosed).toBe(store.report().bitmapsOpen);
        expect(store.size()).toBe(0);
        expect(store.plateBytes()).toBe(0);
    });

});

describe("R5a — another frame's plate stands in through the lattice's affine", () => {
    function at(store, frameId, q, i, j) { return putPlate(store, view(frameId, q, i, i, j, j), i, j); }
    test("mapped: a lateral neighbour at a = 1 is judged at its own quantum and placed by b", () => {
        const store = mkStore({ maxBytes: 16 * PLATE_BYTES, doc: null });
        const req = { frameId: "0", q: 0, Zq: 1, i0: 0, i1: 3, j0: 0, j1: 1 };
        at(store, "6", -4, 0, 0);                        // Zq 1/2: its plate is 1024 units wide
        const m6 = { a: 1, bx: 512, by: 0 };             // …and sits 512 units right of frame 0's origin
        const out = [];
        expect(store.fallbackCover(req, out)).toBe(0);                         // no mapping: refused, as before
        expect(store.fallbackCover(req, out, (f) => (f === "6" ? m6 : null))).toBe(1);
        expect(out[0].frameId).toBe("6");
        // placed off the range by b, it is refused
        expect(store.fallbackCover(req, out, (f) => (f === "6" ? { a: 1, bx: 1e6, by: 0 } : null))).toBe(0);
    });
    test("a child frame's plate is judged at its EFFECTIVE zoom, Zq / a", () => {
        const store = mkStore({ maxBytes: 16 * PLATE_BYTES, doc: null });
        const req = { frameId: "0", q: 0, Zq: 1, i0: -2, i1: 2, j0: -2, j1: 2 };
        at(store, "0/1,1", -48, 0, 0);                   // 48 quanta coarser in the child = the view's own zoom here
        at(store, "0/1,1", 0, 0, 0);                     // the child's q 0 is 48 quanta FINER here: outside the window
        const out = [];
        const n = store.fallbackCover(req, out, (f) => (f === "0/1,1" ? { a: 1 / 4096, bx: 0, by: 0 } : null));
        expect(n).toBe(1);
        expect(out[0].q).toBe(-48);
    });
});

// ---------------------------------------------------------------------------
// OPEN-FLAGS F106 — a stream of invalidations starved a plate of every arrival. A bake that
// steps its mark past targets it left whole stales the plates under the mark each step, about
// every 170 ms on the Magnum Opus against a 200–650 ms raster, so every re-raster arrived behind
// and was refused, and the screen kept the plate from before the mark: the erased ink, back.
// Rule 1 is the fix with nothing added: a result replaces the stored plate iff its G is newer.
// ---------------------------------------------------------------------------

describe("F106 — a newer stale raster replaces older stale pixels", () => {
    const arrive = (store, jobId, G, bitmap) => store.put({ jobId, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, G, bitmap });

    test("invalidated faster than it rasters, the plate still moves forward: each arrival newer than the pixels shown replaces them", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const before = putPlate(store, v, 0, 0);                    // the ink before the mark
        store.fresh.dirty();                                        // the mark is added
        let shown = before.bitmap;
        for (let step = 1; step <= 5; step++) {
            const miss = store.want(v).misses;
            expect(miss.length).toBe(1);                            // still wanted: it is stale
            const G = store.fresh.generation;
            store.beginJob(step, v, miss, G);
            store.fresh.dirty();                                    // the next bake step lands first
            const bm = mkBitmap();
            expect(arrive(store, step, G, bm)).toBe("newer");
            expect(shown.closed).toBe(true);                        // the older pixels are freed
            expect(store.get(before.key).bitmap).toBe(bm);          // and these are what composes
            expect(isStale(store, before.key)).toBe(true);          // still behind: re-posted
            shown = bm;
        }
        expect(store.report().staleNewer).toBe(5);
        expect(store.report().stalePuts).toBe(0);
        // once the stream stops, a current arrival is cached as ever
        const G = store.fresh.generation;
        store.beginJob(9, v, store.want(v).misses, G);
        expect(arrive(store, 9, G, mkBitmap())).toBe("cached");
        expect(isStale(store, before.key)).toBe(false);
        expect(made - closed).toBe(store.size());
    });

    test("an arrival OLDER than the pixels shown, or at the same G, is refused and closed", () => {
        const store = mkStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        putPlate(store, v, 0, 0);                                   // G 0
        store.fresh.dirty();                                        // 1
        store.beginJob(1, v, store.want(v).misses, 1);              // posted at 1
        store.fresh.dirty();                                        // 2
        const b1 = mkBitmap();
        expect(arrive(store, 1, 1, b1)).toBe("newer");             // cached pixels now G 1
        const old = mkBitmap();
        expect(arrive(store, null, 0, old)).toBe("stale");         // G 0 is older than what shows
        expect(old.closed).toBe(true);
        expect(store.get(key).bitmap).toBe(b1);
        const same = mkBitmap();
        expect(arrive(store, null, 1, same)).toBe("stale");        // and so is the same G again
        expect(same.closed).toBe(true);
        // a plate not cached is stored behind (stale before paper, A2 §3.1), unless a hard drop refused its job
        const other = view("0", 0, 3, 3, 0, 0);
        store.beginJob(2, other, [{ i: 3, j: 0 }], 2);
        store.fresh.dirty();
        const lone = mkBitmap();
        expect(store.put({ jobId: 2, frameId: "0", q: 0, Zq: 1, i: 3, j: 0, G: 2, bitmap: lone })).toBe("newer");
        expect(lone.closed).toBe(false);
        store.beginJob(3, other, [{ i: 4, j: 0 }], 3);
        store.dropFrames((f) => f === "0");
        const refused = mkBitmap();
        expect(store.put({ jobId: 3, frameId: "0", q: 0, Zq: 1, i: 4, j: 0, G: 3, bitmap: refused })).toBe("stale");
        expect(refused.closed).toBe(true);
        expect(store.get(plateKey("0", 0, 4, 0))).toBeUndefined();
    });
});
