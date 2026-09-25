/**
 * raster.plates.test.js — L1–L9 of RASTERISER-PLAN §9.2: the plate cache. Keys, LRU with
 * the visible set pinned, the byte cap, the five invalidation rules of §5.4, the settle's
 * own quantum drop (§6.3, D83), the invalidation epoch (D25), the in-flight map and the
 * `visibilitychange` release.
 *
 * Every plate here carries a FAKE bitmap that records its own `close()`, because the one
 * thing this store must never do is drop a bitmap without closing it: a bitmap holds
 * memory outside the JS heap and GC frees it too late on a phone (§3.7). `made` and
 * `closed` are the file's own counters and the crossing probe compares them.
 */

import PlateStore, { PLATE_BYTES, DESKTOP_CACHE_BYTES, PHONE_CACHE_BYTES, defaultCacheBytes, isPhoneBudget, FB_Q_LO, FB_Q_HI, FB_MAX } from "./PlateStore";
import { PLATE_PX, plateKey, quantumFor, zqOf } from "./plate";
import { mkEngine, drawStroke, drag, useEngines } from "../__testkit__/harness";

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
/** Cache one plate, at the key's current epoch unless the caller says otherwise. */
function putPlate(store, v, i, j, opts = {}) {
    const key = plateKey(v.frameId, v.q, i, j);
    const bitmap = mkBitmap();
    const status = store.put({
        frameId: v.frameId, q: v.q, Zq: v.Zq, i, j,
        epoch: opts.epoch !== undefined ? opts.epoch : store.epochOf(key),
        bitmap, ids: opts.ids || null, bytes: opts.bytes,
    });
    return { key, bitmap, status };
}
/** Is the record at this key behind the document? The store's own derivation, spelled out. */
const isStale = (store, key) => { const e = store.get(key); return !!e && e.epoch !== store.epochOf(key); };

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
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 6 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
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
        const phone = new PlateStore({ env: { deviceMemory: 4, screenW: 1079, screenH: 1969 }, doc: null });
        expect(phone.report().phone).toBe(true);
        expect(phone.report().maxBytes).toBe(PHONE_CACHE_BYTES);
    });
});

describe("L4 — invalidation by painted id (rule 1)", () => {
    /**
     * Under PAPER-PLAN R1 a drop KEEPS the pixels: the record stays, its bitmap stays open, the
     * byte count does not fall and the epoch moves, which is what makes it a stale hit and a
     * miss at once. What "and only those" means is unchanged and is still the point.
     */
    test("every plate whose id set holds the id goes stale, and only those", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0, { ids: Int32Array.from([1, 2, 3]) });
        const b = putPlate(store, v, 1, 0, { ids: Int32Array.from([4, 5]) });
        const c = putPlate(store, v, 2, 0, { ids: Int32Array.from([2, 9, 40, 41]) });
        expect(store.dropById(2)).toBe(2);
        expect(isStale(store, a.key)).toBe(true);
        expect(isStale(store, b.key)).toBe(false);
        expect(isStale(store, c.key)).toBe(true);
        expect(a.bitmap.closed || c.bitmap.closed).toBe(false);   // the ink stands until it is replaced
        expect(b.bitmap.closed).toBe(false);
        expect(store.epochOf(a.key)).toBe(1);
        expect(store.epochOf(b.key)).toBe(0);
        expect(store.size()).toBe(3);
        expect(store.plateBytes()).toBe(3 * PLATE_BYTES);         // stale pixels are real memory
        expect(store.report().stale).toBe(2);
        expect(store.report().staleBytes).toBe(2 * PLATE_BYTES);
        expect(store.report().staleKept).toBe(2);
        expect(store.dropById(7)).toBe(0);            // an id nothing painted drops nothing
    });

    /**
     * The drag's collapsed invalidation names every moved id at once (PAPER-PLAN R3) and must
     * walk the cache ONCE, not once an id — so the one method takes an id or a `Set`.
     */
    test("a Set of ids is one walk, and it drops the union", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0, { ids: Int32Array.from([1, 2, 3]) });
        const b = putPlate(store, v, 1, 0, { ids: Int32Array.from([4, 5]) });
        const c = putPlate(store, v, 2, 0, { ids: Int32Array.from([9, 40]) });
        expect(store.dropById(new Set([2, 40]))).toBe(2);
        expect([a, b, c].map((p) => isStale(store, p.key))).toEqual([true, false, true]);
        expect(store.report().dropsById).toBe(2);
        expect(store.dropById(new Set())).toBe(0);    // an empty set is not "drop everything"
        // the walk is the SHORTER of the two, and both directions must agree: a set larger than
        // the plate's id array is walked the other way round and must find the same three
        expect(store.dropById(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 40]))).toBe(3);
    });

    test("an id set that is not ascending is sorted and counted, because rule 1 binary-searches it", () => {
        const store = new PlateStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const p = putPlate(store, v, 0, 0, { ids: Int32Array.from([40, 2, 9]) });
        expect(store.report().badIds).toBe(1);
        expect(Array.from(store.get(p.key).ids)).toEqual([2, 9, 40]);
        // Without the sort this reads 0: the search starts at 2, goes left of it and stops.
        expect(store.dropById(40)).toBe(1);
        expect(isStale(store, p.key)).toBe(true);
        expect(p.bitmap.closed).toBe(false);

        const good = Int32Array.from([2, 9, 40]);
        const q = putPlate(store, v, 1, 0, { ids: good });
        expect(store.get(q.key).ids).toBe(good);      // an ascending set is kept as it came
        expect(store.report().badIds).toBe(1);
    });

    test("a plate with no id set cannot be tested, so it is dropped and counted", () => {
        const store = new PlateStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        putPlate(store, v, 0, 0);                     // no ids
        expect(store.dropById(123)).toBe(1);
        expect(store.report().noIds).toBe(1);
    });
});

describe("L5 — by drawn footprint, in every frame the cache holds (rules 2 and 3)", () => {
    test("an object drawn at level 6 drops the level-0 plates covering it", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const deep = view("6", 24, 0, 0, 0, 0);       // Zq = 64: plate (0,0) is 0…8 frame units
        const top = view("0", 0, 0, 1, 0, 0);        // Zq = 1: plate (0,0) is 0…512, (1,0) is 512…1024
        putPlate(store, deep, 0, 0, { ids: Int32Array.from([77]) });
        const t0 = putPlate(store, top, 0, 0, { ids: Int32Array.from([5]) });
        const t1 = putPlate(store, top, 1, 0, { ids: Int32Array.from([5]) });
        // Rule 1 cannot see a NEW object: nothing has painted id 77 into the level-0 plates.
        expect(store.dropById(77)).toBe(1);
        expect(!!store.get(t0.key)).toBe(true);
        putPlate(store, deep, 0, 0, { ids: Int32Array.from([77]) });

        const asked = [];
        const foot = (frameId) => {
            asked.push(frameId);
            if (frameId === "6") return { left: 1, top: 1, right: 2, bottom: 2 };
            return { left: 100, top: 100, right: 140, bottom: 140 };   // the same ink, mapped into level 0
        };
        expect(store.dropRectPerFrame(foot)).toBe(2);
        expect(asked.sort()).toEqual(["0", "6"]);      // once per FRAME, not once per plate
        expect(isStale(store, t0.key)).toBe(true);
        expect(isStale(store, t1.key)).toBe(false);    // 512…1024 does not meet 100…140
        expect(t0.bitmap.closed).toBe(false);          // R1: the pixels stand until the replacement
        expect(store.epochOf(t0.key)).toBe(1);
        expect(store.epochOf(t1.key)).toBe(0);
    });

    test("mapping into the ACTIVE frame only is the failure this rule exists to stop", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const top = view("0", 0, 0, 0, 0, 0);
        const t = putPlate(store, top, 0, 0, { ids: Int32Array.from([5]) });
        const activeOnly = (frameId) => (frameId === "6" ? { left: 1, top: 1, right: 2, bottom: 2 } : null);
        expect(store.dropRectPerFrame(activeOnly)).toBe(0);
        expect(isStale(store, t.key)).toBe(false);     // never invalidated: the failure L5's first test fixes
    });

    test("the one-device-pixel pad drops the plate a footprint stops half a pixel short of (D77)", () => {
        // An antialiased edge paints up to a pixel past the geometry's own box, so the plate
        // box is grown by one device pixel before the test. Plate (1,0) at Zq 1 is 512…1024
        // frame units, padded to 511…1025, and the pair below pins the pad at exactly one
        // device pixel: the 511.5 reading flips at EDGE_PAD_PX 0 (1 drop becomes 0) and the
        // 510 reading flips at EDGE_PAD_PX 2 (0 becomes 1).
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 1, 1, 0, 0);
        const near = putPlate(store, v, 1, 0);
        expect(store.dropRectPerFrame(() => ({ left: 100, top: 0, right: 510, bottom: 10 }))).toBe(0);
        expect(isStale(store, near.key)).toBe(false);
        expect(store.epochOf(near.key)).toBe(0);
        expect(store.dropRectPerFrame(() => ({ left: 100, top: 0, right: 511.5, bottom: 10 }))).toBe(1);
        expect(isStale(store, near.key)).toBe(true);   // the epoch moved: R1 keeps the pixels
        expect(store.epochOf(near.key)).toBe(1);
        expect(near.bitmap.closed).toBe(false);
    });

    test("a plate whose Zq is unusable has no box, so any footprint drops it", () => {
        // `rectOf` returns null for a Zq that is not a positive finite number and `meets`
        // reads null as a meet: a plate that cannot be tested is invalidated rather than kept
        // current, and its arrival is counted in `noZq` so a report shows the packing bug.
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const bad = mkBitmap();
        store.put({ frameId: "0", q: 0, Zq: 0, i: 0, j: 0, epoch: 0, bitmap: bad });
        const badKey = plateKey("0", 0, 0, 0);
        const good = putPlate(store, view("0", 0, 1, 1, 0, 0), 1, 0);   // 512…1024 frame units
        expect(store.report().noZq).toBe(1);
        const farAway = () => ({ left: 1e6, top: 1e6, right: 1e6 + 1, bottom: 1e6 + 1 });
        expect(store.dropRectPerFrame(farAway)).toBe(1);
        expect(isStale(store, badKey)).toBe(true);
        expect(isStale(store, good.key)).toBe(false);     // a usable box is tested and misses
        expect(good.bitmap.closed).toBe(false);
    });

    test("a footprint list carries the old address and the new", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 3, 0, 0);
        const p = [0, 1, 2, 3].map((i) => putPlate(store, v, i, 0));
        const foot = () => [{ left: 10, top: 10, right: 20, bottom: 20 }, { left: 1600, top: 10, right: 1620, bottom: 20 }];
        expect(store.dropRectPerFrame(foot)).toBe(2);
        expect([0, 1, 2, 3].map((i) => isStale(store, p[i].key))).toEqual([true, false, false, true]);
        expect(store.size()).toBe(4);                     // R1: four records, two of them stale
    });
});

describe("L6 — edge case 4.11: a table-only change, which TileStore correctly ignores", () => {
    useEngines();

    test("a drag drops no tile and drops the plates at both positions", () => {
        const E = mkEngine(800, 600);
        drawStroke(E, [[120, 120], [220, 160], [320, 140]], 13);
        E._render();
        const tilesBefore = E.store._tileKeys().slice().sort();
        expect(tilesBefore.length).toBeGreaterThan(0);

        const evs = [];
        const unsub = E.doc.subscribe((ev) => evs.push(ev));
        drag(E, [220, 160], [420, 260]);
        unsub();
        E._render();

        // F55: a move changes the displacement table and nothing a tile is made of, so
        // every tile that was cached is still cached.
        const tilesAfter = new Set(E.store._tileKeys());
        for (const k of tilesBefore) expect(tilesAfter.has(k)).toBe(true);
        const moves = evs.filter((e) => e.kind === "change" && e.offsetsOnly);
        expect(moves.length).toBeGreaterThan(0);

        // The plate store must not ignore it: a plate is where the picture IS. Zq = 16, so a
        // plate is 32 frame units across and the two positions land on different ones.
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view(E.cam.frame, 16, 0, 0, 0, 0);
        const moved = moves[0].id, other = Int32Array.from([moved + 1000]);
        const box = (sx0, sy0, sx1, sy1) => {
            const [x0, y0] = E.cam.screenToFrame(sx0, sy0), [x1, y1] = E.cam.screenToFrame(sx1, sy1);
            return { left: x0, top: y0, right: x1, bottom: y1 };
        };
        const oldRect = box(100, 100, 340, 180), newRect = box(300, 200, 540, 280);
        const at = putPlate(store, v, 4, 4, { ids: Int32Array.from([moved]) });   // where it was: 128…160
        const to = putPlate(store, v, 15, 7, { ids: other });                     // where it lands: 480…512
        const far = putPlate(store, v, 40, 40, { ids: other });                   // 1280…1312, untouched
        const foot = (frameId) => (String(frameId) === String(E.cam.frame) ? [oldRect, newRect] : null);
        let dropped = 0;
        for (const ev of evs) dropped += store.onDocEvent(ev, foot);
        expect(dropped).toBeGreaterThan(0);
        expect(isStale(store, at.key)).toBe(true);
        // Nothing has ever painted the object's id into the plate it moved INTO, so the
        // footprint rule is the only thing that can drop it — F68/F69 in a new form.
        expect(isStale(store, to.key)).toBe(true);
        expect(isStale(store, far.key)).toBe(false);
        expect(store.epochOf(at.key)).toBeGreaterThan(0);
        expect(store.epochOf(to.key)).toBeGreaterThan(0);
        expect(store.epochOf(far.key)).toBe(0);
    });
});

describe("L7 — a dpr change keeps every plate (D27)", () => {
    test("nothing is dropped, nothing is closed, and the quantum's plates still hit", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, onRelease: (why) => released.push(why) });
        store.phone = true;                               // a desktop releases after HIDDEN_RELEASE_MS (raster.nopaper N11)
        const v = view("0", 0, 0, 2, 0, 0);
        store.want(v);
        const p = [0, 1, 2].map((i) => putPlate(store, v, i, 0));
        const flight = store.beginJob(7, v, [{ i: 5, j: 5 }]);
        expect(flight[0]).toBe(0);

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
        // The job that was in flight when the tab went away is now stale.
        expect(store.isCurrent(plateKey("0", 0, 5, 5), 0)).toBe(false);

        store.destroy();
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));   // the listener is gone
        expect(store.report().releases).toBe(1);
    });
});

describe("L9 — the epoch: a drop of a key that is not cached invalidates the job in flight", () => {
    test("the D25 sequence: posted, changed, arrived, discarded, re-posted", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        const miss = store.want(v).misses;
        expect(miss.map((m) => m.key)).toEqual([key]);
        const epochs = store.beginJob(1, v, miss);
        expect(Array.from(epochs)).toEqual([0]);

        // The document changes while the plate is in flight. Rule 1 cannot see it — there is
        // no id set — and rule 2 finds nothing in the cache. The epoch is the only record.
        expect(store.dropById(5)).toBe(0);
        expect(store.dropRectPerFrame(() => ({ left: 10, top: 10, right: 20, bottom: 20 }))).toBe(1);
        expect(store.epochOf(key)).toBe(1);
        expect(store.staleInFlight()).toBe(1);
        expect(store.isCurrent(key, epochs[0])).toBe(false);

        const late = mkBitmap();
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch: epochs[0], bitmap: late })).toBe("stale");
        expect(late.closed).toBe(true);
        expect(store.size()).toBe(0);
        expect(store.report().stalePuts).toBe(1);

        // And it is a miss again, so the renderer re-posts it at the new epoch.
        const again = store.want(v).misses;
        expect(again.map((m) => m.epoch)).toEqual([1]);
        const fresh = mkBitmap();
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch: 1, bitmap: fresh })).toBe("cached");
        expect(store.size()).toBe(1);
        expect(fresh.closed).toBe(false);
        expect(store.inflight.size).toBe(0);
        expect(store.jobs.size).toBe(0);
    });

    test("a plate already in flight is not posted twice", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 1, 0, 0);
        const first = store.want(v);
        expect(first.misses.length).toBe(2);
        store.beginJob(1, v, first.misses);
        const second = store.want(v);
        expect(second.misses.length).toBe(0);
        expect(second.inFlight).toBe(2);
        store.endJob(1);
        expect(store.want(v).misses.length).toBe(2);     // abandoned, so they are wanted again
    });

    test("a late result from a superseded job does not cancel the re-post", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        const first = store.beginJob(1, v, [{ i: 0, j: 0 }]);
        store.dropRectPerFrame(() => ({ left: 10, top: 10, right: 20, bottom: 20 }));
        store.endJob(1);
        store.beginJob(2, v, [{ i: 0, j: 0 }]);          // the re-post, at the new epoch
        const late = mkBitmap();
        expect(store.put({ jobId: 1, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch: first[0], bitmap: late })).toBe("stale");
        expect(late.closed).toBe(true);
        expect(store.inflight.has(key)).toBe(true);      // job 2 is still running for it
        expect(store.want(v).misses.length).toBe(0);
        expect(store.put({ jobId: 2, frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch: store.epochOf(key), bitmap: mkBitmap() })).toBe("cached");
        expect(store.inflight.size).toBe(0);
    });

    test("a result with NO epoch is cached however far the key has moved, and is counted", () => {
        // The guard can only compare an epoch the result carries, so a result that forgot one
        // bypasses D25 entirely. `noEpoch` is what makes that show in a report (stage 3 is the
        // caller that has to remember the field).
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        store.beginJob(1, v, [{ i: 0, j: 0 }]);
        store.dropRectPerFrame(() => ({ left: 10, top: 10, right: 20, bottom: 20 }));
        expect(store.epochOf(key)).toBe(1);
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, bitmap: mkBitmap() })).toBe("cached");
        expect(store.report().noEpoch).toBe(1);
        expect(store.report().stalePuts).toBe(0);
    });

    test("an eviction does not bump the epoch, so a result in flight for it is still good", () => {
        const store = new PlateStore({ maxBytes: 1 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        const epochs = store.beginJob(1, v, [{ i: 0, j: 0 }]);
        putPlate(store, v, 1, 0);                        // fills the cap; nothing to evict yet
        putPlate(store, v, 2, 0);                        // evicts (1,0)
        expect(store.report().evictions).toBe(1);
        expect(store.epochOf(key)).toBe(0);
        const bm = mkBitmap();
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch: epochs[0], bitmap: bm })).toBe("cached");
    });
});

// ---------------------------------------------------------------------------
// L10 — PAPER-PLAN R1: stale before paper, and the cross-quantum cover set.
//
// An invalidating drop KEEPS the record and its bitmap and moves the epoch; a record is stale
// when `e.epoch !== epochOf(e.key)`, which is derived and never flagged. The screen therefore
// shows old ink until the replacement lands instead of paper. Nothing here is a picture: what
// is asserted is the record, the epoch, the pins and the order.
// ---------------------------------------------------------------------------

describe("L10 — R1: stale before paper", () => {
    test("a dropped plate is kept as a stale hit, and want returns it twice", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 1, 0, 0);
        store.want(v);
        const a = putPlate(store, v, 0, 0, { ids: Int32Array.from([5]) });
        const b = putPlate(store, v, 1, 0, { ids: Int32Array.from([6]) });
        const bytes0 = store.plateBytes();
        expect(store.dropById(5)).toBe(1);

        expect(store.size()).toBe(2);
        expect(!!store.get(a.key)).toBe(true);
        expect(a.bitmap.closed).toBe(false);
        expect(store.plateBytes()).toBe(bytes0);           // stale pixels stay inside §6.6's cap
        expect(store.epochOf(a.key)).toBe(1);

        const got = store.want(v);
        expect(got.hits.map((h) => h.key)).toEqual([a.key, b.key]);   // BOTH are hits…
        expect(got.misses.map((m) => m.key)).toEqual([a.key]);        // …and the stale one is a miss
        expect(got.misses[0].epoch).toBe(1);                          // the BUMPED epoch (D25)
        expect(store.report().staleHits).toBe(1);
        expect(store.report().staleKept).toBe(1);
        // the screen's own stale picture is pinned, so nothing can evict it
        expect(store._pins.has(a.key)).toBe(true);
    });

    test("the replacement closes the stale bitmap exactly once, and the record is fresh again", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0, { ids: Int32Array.from([5]) });
        store.dropById(5);
        const b = putPlate(store, v, 0, 0, { ids: Int32Array.from([5]) });
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

    test("a stale plate's re-post is dispatched: beginJob carries the bumped epoch", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0, { ids: Int32Array.from([5]) });
        store.dropById(5);
        const miss = store.want(v).misses;
        const epochs = store.beginJob(1, v, miss);
        expect(Array.from(epochs)).toEqual([1]);
        expect(store.isCurrent(a.key, epochs[0])).toBe(true);
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch: epochs[0], bitmap: mkBitmap() })).toBe("cached");
        expect(store.inflight.size).toBe(0);
    });

    test("a stale plate in flight is not re-posted twice", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        putPlate(store, v, 0, 0, { ids: Int32Array.from([5]) });
        store.dropById(5);
        store.beginJob(1, v, store.want(v).misses);
        const again = store.want(v);
        expect(again.hits.length).toBe(1);               // the stale pixels are still composed
        expect(again.misses.length).toBe(0);             // and not asked for a second time
        expect(again.inFlight).toBe(1);
    });

    test("eviction takes the stale plates first; a stale plate in the visible range is pinned and stays", () => {
        const store = new PlateStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);              // only (0,0) is visible
        store.want(v);                                   // pins (0,0) alone, before anything is cached
        const onScreen = putPlate(store, v, 0, 0, { ids: Int32Array.from([5]) });
        const fresh = putPlate(store, v, 7, 0, { ids: Int32Array.from([6]) });
        const stale = putPlate(store, v, 8, 0, { ids: Int32Array.from([5]) });
        expect(store.dropById(5)).toBe(2);               // (0,0) and (8,0) go stale
        expect(store.report().staleKept).toBe(2);

        putPlate(store, v, 9, 0);                        // a fourth plate over a three-plate cap
        // `fresh` is OLDER than `stale` by LRU, and it survives: staleness outranks age
        expect(!!store.get(stale.key)).toBe(false);
        expect(stale.bitmap.closed).toBe(true);
        expect(!!store.get(fresh.key)).toBe(true);
        expect(!!store.get(onScreen.key)).toBe(true);    // pinned, though it is the oldest stale one
        expect(store.report().staleEvictions).toBe(1);
        expect(store.report().evictions).toBe(1);
    });

    test("rule 1 still tests a stale plate's id set, and bumps it again", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const a = putPlate(store, v, 0, 0, { ids: Int32Array.from([5, 7]) });
        expect(store.dropById(5)).toBe(1);
        const epochs = store.beginJob(1, v, store.want(v).misses);
        expect(store.dropById(7)).toBe(1);               // the STALE record is still the id record
        expect(store.epochOf(a.key)).toBe(2);
        // the first replacement is not current, which is the point of bumping a stale record: it is
        // newer than the cached pixels, so it replaces them and stays stale (F106)
        const late = mkBitmap();
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch: epochs[0], bitmap: late })).toBe("newer");
        expect(store.get(a.key).bitmap).toBe(late);
        expect(isStale(store, a.key)).toBe(true);
    });

    test("dropAll and release still remove and close every plate, stale ones included", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 2, 0, 0);
        [0, 1, 2].map((i) => putPlate(store, v, i, 0, { ids: Int32Array.from([5]) }));
        store.dropById(5);
        expect(store.report().stale).toBe(3);
        expect(store.dropAll()).toBe(3);
        expect(store.size()).toBe(0);
        expect(store.plateBytes()).toBe(0);
        expect(closed).toBe(made);
        expect(made - closed).toBe(store.size());
    });

    test("dropQuantum('e') still removes the settled plates: a settled plate is never kept as stale", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const ev = { frameId: "0", q: "e", Zq: 3.1, i0: 0, i1: 1, j0: 0, j1: 0 };
        const p = [putPlate(store, ev, 0, 0), putPlate(store, ev, 1, 0)];
        // and while they are cached they are not a fallback either: `"e"` carries no zoom of its
        // own, so nothing can say what stretch to draw it at (D83)
        expect(store.fallbackCover({ frameId: "0", q: 0, Zq: 1, i0: -9, i1: 9, j0: -9, j1: 9 }, [])).toBe(0);
        expect(store.dropQuantum("e")).toBe(2);
        expect(store.size()).toBe(0);                    // D83: a hard remove, not a stale hit
        expect(p.every((x) => x.bitmap.closed)).toBe(true);
    });

    test("abandonQuantum bumps the in-flight keys and keeps the cached ones fresh and unpinned", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const inc = { ...view("0", 4, 0, 1, 0, 0), mode: "quantum" };
        store.want(inc, { pin: "add" });
        const cached = putPlate(store, inc, 0, 0);
        const flight = store.beginJob(1, inc, [{ i: 1, j: 0 }]);
        const flightKey = plateKey("0", 4, 1, 0);
        expect(store.report().pinnedAdded).toBe(2);

        expect(store.abandonQuantum(4)).toBe(2);
        expect(store.epochOf(cached.key)).toBe(0);       // the document did not change
        expect(isStale(store, cached.key)).toBe(false);
        expect(!!store.get(cached.key)).toBe(true);      // its pixels are the screen's best fallback
        expect(cached.bitmap.closed).toBe(false);
        expect(store.report().pinnedAdded).toBe(0);
        expect(store.isCurrent(flightKey, flight[0])).toBe(false);   // the straggler is refused
        expect(store.report().abandons).toBe(1);
    });
});

describe("L10 — the cross-quantum cover set", () => {
    /** Cache one plate at an arbitrary quantum and frame; `q` need not be the view's. */
    function at(store, frameId, q, i, j) {
        return putPlate(store, view(frameId, q, i, i, j, j), i, j);
    }

    test("the cover set is coarsest first, same frame only, never 'e', inside the window and inside the cap", () => {
        const store = new PlateStore({ maxBytes: 64 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: (FB_MAX + 16) * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 3 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        store.put({ frameId: "0", q: -4, Zq: zqOf(-4), i: 0, j: 0, epoch: 0, bitmap: null, bytes: 0 });
        store.put({ frameId: "0", q: -3, Zq: zqOf(-3), i: 0, j: 0, epoch: 0, bitmap: null, pixels: new Uint8ClampedArray(4), bytes: 4 });
        store.put({ frameId: "0", q: -5, Zq: 0, i: 0, j: 0, epoch: 0, bitmap: mkBitmap() });
        const out = [];
        expect(store.fallbackCover({ frameId: "0", q: 0, Zq: 1, i0: -9, i1: 9, j0: -9, j1: 9 }, out)).toBe(1);
        expect(out[0].q).toBe(-4);
        expect(out[0].bitmap).toBe(null);
    });

    test("R5b: the ladder's plates are evicted LAST, after stale ones and the gesture's own", () => {
        const store = new PlateStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const p = at(store, "0", -4, 0, 0);
        store.dropById(-1);                              // no ids: invalidates it
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
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
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
        expect(settled.map((p) => store.epochOf(p.key))).toEqual([1, 1]);
        const after = store.want(exact(7.9), { pin: "none" });
        expect(after.hits.length).toBe(0);
        expect(after.misses.length).toBe(2);

        for (const p of held) { expect(!!store.get(p.key)).toBe(true); expect(p.bitmap.closed).toBe(false); }
        expect(held.map((p) => store.epochOf(p.key))).toEqual([0, 0]);
        expect([...store._pins].sort()).toEqual(held.map((p) => p.key).sort());
        expect(store.report().dropsByQ).toBe(2);
        expect(made - closed).toBe(store.size());
    });

    test("a settle job still in flight is refused on arrival", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const ev = exact(3.1, 0);
        const epochs = store.beginJob(7, ev, store.want(ev, { pin: "add" }).misses);
        expect(store.dropQuantum("e")).toBe(1);
        const late = mkBitmap();
        expect(store.put({ frameId: "0", q: "e", Zq: 3.1, i: 0, j: 0, epoch: epochs[0], bitmap: late })).toBe("stale");
        expect(late.closed).toBe(true);
        expect(store.size()).toBe(0);
        expect(store.dropQuantum("e")).toBe(0);
    });

    test("a quantum given as a number and as a string are one quantum, because the key is one string", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 12, 0, 0, 0, 0);
        putPlate(store, v, 0, 0);
        expect(store.dropQuantum("12")).toBe(1);
        expect(store.size()).toBe(0);
    });
});

describe("the other two invalidation rules, and the event mapping of §5.4", () => {
    test("rule 4 — a frame event drops everything, cached and in flight alike", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const a = view("0", 0, 0, 1, 0, 0), b = view("6", 0, 0, 0, 0, 0);
        putPlate(store, a, 0, 0); putPlate(store, a, 1, 0); putPlate(store, b, 0, 0);
        const inFlight = store.beginJob(3, a, [{ i: 9, j: 9 }]);
        expect(store.onDocEvent({ kind: "mergeFrame", frame: "6" }, null)).toBe(4);
        expect(store.size()).toBe(0);
        expect(closed).toBe(made);
        expect(store.isCurrent(plateKey("0", 0, 9, 9), inFlight[0])).toBe(false);
        expect(store.onDocEvent({ kind: "reset" }, null)).toBe(1);   // the job is still in flight
    });

    test("rule 5 — a frame crossing drops nothing, so crossing back is a hit", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
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

    test("a growing stroke invalidates nothing; finalize and remove do", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        const foot = () => ({ left: 0, top: 0, right: 100, bottom: 100 });
        putPlate(store, v, 0, 0, { ids: Int32Array.from([11]) });
        expect(store.onDocEvent({ kind: "add", id: 11, obj: {}, live: true }, foot)).toBe(0);
        expect(isStale(store, key)).toBe(false);
        // 2, not 1: under R1 the plate is still cached after rule 1 has invalidated it, so rule 2
        // finds it as well. The count is invalidations, and the record is one.
        expect(store.onDocEvent({ kind: "finalize", id: 11, obj: {} }, foot)).toBe(2);
        expect(isStale(store, key)).toBe(true);

        // A colour or z change carries `attrOnly`, which `TileStore` ignores because its
        // tiles hold the object itself; a plate holds baked pixels and must be re-rastered.
        putPlate(store, v, 0, 0, { ids: Int32Array.from([11]) });   // the replacement lands: fresh again
        expect(isStale(store, key)).toBe(false);
        expect(store.onDocEvent({ kind: "change", id: 11, obj: {}, attrOnly: true }, foot)).toBe(2);
        expect(isStale(store, key)).toBe(true);

        putPlate(store, v, 0, 0, { ids: Int32Array.from([11]) });
        expect(store.onDocEvent({ kind: "remove", id: 11 }, foot)).toBe(2);
        expect(store.onDocEvent({ kind: "change", id: 11 }, foot)).toBe(0);   // no obj, not a remove
        expect(store.onDocEvent(null, foot)).toBe(0);
        expect(store.size()).toBe(1);                   // one record throughout: R1 never removes here
    });

    test("the drain count and the report are what §8.5 asks for, and bounded", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        store.want(v);
        putPlate(store, v, 0, 0);
        store.noteDrain(3); store.noteDrain(700);
        const r = store.report();
        expect(r.drains).toBe(2);
        expect(r.drainedEvents).toBe(703);
        expect(r.plates).toBe(1);
        expect(r.plateBytes).toBe(PLATE_BYTES);
        expect(r.hits + r.misses).toBe(1);
        expect(Object.values(r).every((x) => typeof x === "number" || typeof x === "boolean")).toBe(true);
        // Bounded and flat is the rule (F58), not a particular width; R1's eight counters,
        // `stale`/`staleBytes` and F106's `staleNewer` put it at 50.
        expect(Object.keys(r).length).toBeLessThan(56);
    });

    test("a replaced plate closes the bitmap it replaces", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const first = putPlate(store, v, 0, 0);
        const second = putPlate(store, v, 0, 0);
        expect(first.bitmap.closed).toBe(true);
        expect(second.bitmap.closed).toBe(false);
        expect(store.size()).toBe(1);
        expect(store.plateBytes()).toBe(PLATE_BYTES);
        expect(store.report().replaced).toBe(1);
    });
});

describe("the crossing probe — no per-crossing growth, and closes equal to allocations", () => {
    test("20 crossings, 24 plates each: the cache saturates at its cap and nothing leaks", () => {
        const store = new PlateStore({ maxBytes: DESKTOP_CACHE_BYTES, doc: null });
        const cap = Math.floor(DESKTOP_CACHE_BYTES / PLATE_BYTES);      // 96 plates
        const sizes = [], byteCounts = [];
        for (let c = 0; c < 20; c++) {
            const v = view(String(100 + c), 8, 0, 5, 0, 3);             // a fresh frame: 6 × 4 = 24 plates
            const { misses } = store.want(v);
            expect(misses.length).toBe(24);
            store.beginJob(c, v, misses);
            for (const m of misses) {
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: m.i, j: m.j, epoch: m.epoch,
                    bitmap: mkBitmap(), ids: Int32Array.from([c]) });
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
        expect(store.epochs.size).toBeLessThanOrEqual(480);
        expect(store.jobs.size).toBe(0);
        store.release("hidden");
        expect(closed).toBe(made);
        expect(store.report().bitmapsClosed).toBe(store.report().bitmapsOpen);
        expect(store.size()).toBe(0);
        expect(store.plateBytes()).toBe(0);
    });

    test("the epoch map is pruned to what is cached or in flight", () => {
        const store = new PlateStore({ maxBytes: 2 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        store.beginJob(1, v, [{ i: -1, j: -1 }]);
        for (let i = 0; i < 5000; i++) {
            const p = putPlate(store, view("0", 0, i, i, 0, 0), i, 0);
            store.dropById(0);                                          // no ids: invalidates and bumps
            expect(isStale(store, p.key)).toBe(true);                   // R1: stale, not gone
        }
        store.dropRectPerFrame(() => ({ left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }));
        expect(store.report().epochPrunes).toBeGreaterThan(0);
        expect(store.epochs.size).toBeLessThanOrEqual(4096);
        expect(store.epochOf(plateKey("0", 0, -1, -1))).toBeGreaterThan(0);   // the in-flight key kept its epoch
        expect(made - closed).toBe(store.size());
    });
});

describe("R5a — another frame's plate stands in through the lattice's affine", () => {
    function at(store, frameId, q, i, j) { return putPlate(store, view(frameId, q, i, i, j, j), i, j); }
    test("mapped: a lateral neighbour at a = 1 is judged at its own quantum and placed by b", () => {
        const store = new PlateStore({ maxBytes: 16 * PLATE_BYTES, doc: null });
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
        const store = new PlateStore({ maxBytes: 16 * PLATE_BYTES, doc: null });
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
// ---------------------------------------------------------------------------

describe("F106 — a newer stale raster replaces older stale pixels", () => {
    const rect = () => ({ left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 });
    const arrive = (store, epoch, bitmap) => store.put({ frameId: "0", q: 0, Zq: 1, i: 0, j: 0, epoch, bitmap });

    test("invalidated faster than it rasters, the plate still moves forward: each arrival newer than the pixels shown replaces them", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const before = putPlate(store, v, 0, 0);                    // the ink before the mark
        store.dropRectPerFrame(rect);                               // the mark is added
        let shown = before.bitmap;
        for (let step = 1; step <= 5; step++) {
            const miss = store.want(v).misses;
            expect(miss.length).toBe(1);                            // still wanted: it is stale
            const epochs = store.beginJob(step, v, miss);
            store.dropRectPerFrame(rect);                           // the next bake step lands first
            const bm = mkBitmap();
            expect(arrive(store, epochs[0], bm)).toBe("newer");
            expect(shown.closed).toBe(true);                        // the older pixels are freed
            expect(store.get(before.key).bitmap).toBe(bm);          // and these are what composes
            expect(isStale(store, before.key)).toBe(true);          // still behind: re-posted
            shown = bm;
        }
        expect(store.report().staleNewer).toBe(5);
        expect(store.report().stalePuts).toBe(0);
        // once the stream stops, a current arrival is cached as ever
        const epochs = store.beginJob(9, v, store.want(v).misses);
        expect(arrive(store, epochs[0], mkBitmap())).toBe("cached");
        expect(isStale(store, before.key)).toBe(false);
        expect(made - closed).toBe(store.size());
    });

    test("an arrival OLDER than the stale pixels shown is refused and closed; nothing cached refuses too", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const v = view("0", 0, 0, 0, 0, 0);
        const key = plateKey("0", 0, 0, 0);
        putPlate(store, v, 0, 0);                                   // epoch 0
        store.dropRectPerFrame(rect);                               // 1
        const e1 = store.beginJob(1, v, store.want(v).misses)[0];  // posted at 1
        store.dropRectPerFrame(rect);                               // 2
        const b1 = mkBitmap();
        expect(arrive(store, e1, b1)).toBe("newer");               // cached pixels now epoch 1
        const old = mkBitmap();
        expect(arrive(store, 0, old)).toBe("stale");               // epoch 0 is older than what shows
        expect(old.closed).toBe(true);
        expect(store.get(key).bitmap).toBe(b1);
        const same = mkBitmap();
        expect(arrive(store, e1, same)).toBe("stale");             // and so is the same epoch again
        expect(same.closed).toBe(true);
        // a plate not cached (removed, or never put) is refused: no stale pixels to improve on
        const other = view("0", 0, 3, 3, 0, 0);
        const e3 = store.beginJob(2, other, [{ i: 3, j: 0 }])[0];
        store.dropRectPerFrame(rect);
        const lone = mkBitmap();
        expect(store.put({ frameId: "0", q: 0, Zq: 1, i: 3, j: 0, epoch: e3, bitmap: lone })).toBe("stale");
        expect(lone.closed).toBe(true);
        expect(store.get(plateKey("0", 0, 3, 0))).toBeUndefined();
    });
});
