/**
 * PyramidStore.ram.test.js — the store's RAM tier (F161, Kobin's tiered plate cache). An evicted exact level plate goes
 * there packed and its key stays tracked, so a commit after the eviction stales it exactly as it stales a stored record;
 * a newer plate supersedes it; a patched or stale plate, a rest or plane plate never goes; a hard drop takes entries out,
 * a hidden release puts plates in; a restore is in flight under the entry's own G until its put.
 */
import PyramidStore, { PLATE_BYTES, levelCell, restCell, ramBudgetBytes } from "./PyramidStore";
import { RAM_ENTRY_BYTES } from "./plateRam";
import { freshStub } from "../__testkit__/freshStub";

const bitmap = () => ({ width: 512, height: 512, closed: false, close() { this.closed = true; } });
const words = (n = 100) => new Uint32Array(n).buffer;
const mk = (opts) => new PyramidStore({ fresh: freshStub(), doc: null, maxBytes: 2 * PLATE_BYTES, ramBytes: 1 << 20, ...opts });
/** A level plate of frame `F` at (i, 0), packed at the current G, with words unless `packed` is null. */
function put(st, i, { F = "0", packed = words(), empty = false } = {}) {
    const c = levelCell(F, 0, 1, i, 0);
    st.put({ ...c, G: st.fresh.generation, bitmap: empty ? null : bitmap(), packed: empty ? null : packed, jobId: null });
    return c;
}

describe("the RAM tier (F161)", () => {
    test("an evicted exact plate goes there with its words; its key stays tracked; a newer plate supersedes it", () => {
        const st = mk();
        const a = put(st, 0); put(st, 1); put(st, 2);                     // a is the oldest: evicted
        expect(st.get(a.key)).toBeUndefined();
        expect(st.ramHas(a.key)).toBe(true);
        expect(st.fresh.cells.has(a.key)).toBe(true);                       // still tracked
        const e = st.restorable(a.key);
        expect(e).toMatchObject({ key: a.key, G: 0, kind: "level", i: 0, j: 0 });
        expect(e.packed.byteLength).toBe(400);
        expect(st.report().ram).toMatchObject({ entries: 1, bytes: 400 + RAM_ENTRY_BYTES, puts: 1 });
        put(st, 0);                                                         // a re-made plate: the entry goes
        expect(st.ramHas(a.key)).toBe(false);
        expect(st.get(a.key)).toBeTruthy();
    });

    test("a commit that meets the cell after the eviction stales the entry: not restorable, dropped, untracked", () => {
        const st = mk();
        const a = put(st, 0), b = put(st, 1); put(st, 2); put(st, 3);       // a and b evicted
        st.fresh.dirty((c) => c.key === a.key);
        expect(st.restorable(a.key)).toBeNull();
        expect(st.ramHas(a.key)).toBe(false);
        expect(st.fresh.cells.has(a.key)).toBe(false);
        expect(st.restorable(b.key)).toBeTruthy();                          // the other cell is untouched
        expect(st.report().ram.stale).toBe(1);
    });

    test("a stale plate, a patched plate, a plate without words, a rest plate never go; an empty plate goes with none", () => {
        const st = mk({ maxBytes: 0 });                                     // every put evicts at once
        const first = levelCell("0", 0, 1, 0, 0);
        st.put({ ...first, G: 0, bitmap: bitmap(), packed: words(), jobId: null });   // evicted at once, exact: goes
        expect(st.ramHas(first.key)).toBe(true);
        const st2 = mk();
        const p = put(st2, 0);
        st2.patch(p.key, { bitmap: bitmap(), G: 0 });                       // its words are the old pixels now
        const s = put(st2, 1);
        st2.fresh.dirty((c) => c.key === s.key);                            // stale while stored
        const n = put(st2, 2, { packed: null });                            // no words (an inline render)
        const r = restCell("0", 3, 0, 0);
        st2.put({ ...r, G: 0, bitmap: bitmap(), packed: words(), jobId: null });
        const e = put(st2, 3, { empty: true });
        put(st2, 4); put(st2, 5); put(st2, 6);                               // evict all of the above
        expect([p, s, n, r].map((c) => st2.ramHas(c.key))).toEqual([false, false, false, false]);
        expect(st2.ramHas(e.key)).toBe(true);
        expect(st2.restorable(e.key).packed).toBeNull();
    });

    test("a hard drop takes the entries it names out; a hidden release puts the plates in and keeps the tier", () => {
        const st = mk({ maxBytes: 8 * PLATE_BYTES });
        const a = put(st, 0, { F: "A" }), b = put(st, 1, { F: "B" });
        st.setBudget(0);                                                    // both evicted into the tier
        expect([st.ramHas(a.key), st.ramHas(b.key)]).toEqual([true, true]);
        st.dropFrames((F) => F === "A");                                    // A's id now means another place
        expect([st.ramHas(a.key), st.ramHas(b.key)]).toEqual([false, true]);
        expect(st.fresh.cells.has(a.key)).toBe(false);
        st.setBudget(8 * PLATE_BYTES);
        const c = put(st, 2, { F: "B" });
        st.release("hidden");
        expect(st.get(c.key)).toBeUndefined();
        expect([st.ramHas(b.key), st.ramHas(c.key)]).toEqual([true, true]);
        st.dropAll();                                                       // another document
        expect(st.report().ram.entries).toBe(0);
        expect(st.fresh.stats.tracked).toBe(0);
    });

    test("a restore is in flight under the entry's own G; its put is exact; a commit meanwhile makes the cell wanted", () => {
        const st = mk();
        const a = put(st, 0); put(st, 1); put(st, 2);
        st.fresh.dirty((c) => c.key !== a.key);                             // G moves on; a's cell is untouched
        const e = st.restorable(a.key), id = st.beginRestore(e);
        expect(st.ramHas(a.key)).toBe(false);
        expect(st.wants(a.key)).toBe(false);                                // in flight, exact
        expect(st.put({ ...a, G: e.G, bitmap: bitmap(), packed: e.packed, jobId: id })).toBe("cached");
        expect(st.inflight.has(a.key)).toBe(false);
        expect(st.endJob(id)).toBe(0);
        // A commit while a second restore is in flight: the cell is wanted again, and the late plate lands stale.
        put(st, 3); put(st, 4);                                             // a evicted again
        const e2 = st.restorable(a.key), id2 = st.beginRestore(e2);
        st.fresh.dirty((c) => c.key === a.key);
        expect(st.wants(a.key)).toBe(true);
        expect(st.put({ ...a, G: e2.G, bitmap: bitmap(), packed: e2.packed, jobId: id2 })).toBe("newer");
    });

    test("LRU by bytes under the budget, the entry cap, and a budget of 0 empties the tier and untracks its keys", () => {
        const st = mk({ maxBytes: 0, ramBytes: 3 * (400 + RAM_ENTRY_BYTES) });
        const cs = [0, 1, 2, 3].map((i) => put(st, i));
        expect(cs.map((c) => st.ramHas(c.key))).toEqual([false, true, true, true]);
        expect(st.fresh.cells.has(cs[0].key)).toBe(false);
        st.ram.maxEntries = 2;
        put(st, 4);
        expect(st.report().ram.entries).toBe(2);
        st.setRamBudget(0);
        expect(st.report().ram).toMatchObject({ entries: 0, bytes: 0 });
        expect(st.fresh.stats.tracked).toBe(0);
        put(st, 5);
        expect(st.report().ram.entries).toBe(0);                            // off: nothing goes
    });

    test("a plate packed without a drag's held ink never goes, evicted or released; the drag's end drops it and refuses a late one (F153)", () => {
        const a = levelCell("0", 0, 1, 0, 0), b = levelCell("0", 0, 1, 1, 0), c = levelCell("0", 0, 1, 2, 0);
        const st = mk({ maxBytes: 0 });                                     // every put evicts at once
        st.put({ ...a, G: 0, bitmap: bitmap(), packed: words(), jobId: null, omitHeld: st.heldEra });
        expect(st.get(a.key)).toBeUndefined();
        expect(st.ramHas(a.key)).toBe(false);                               // red: an evicted hole restored after the drop
        const st1 = mk();
        st1.put({ ...a, G: 0, bitmap: null, packed: null, jobId: null, omitHeld: st1.heldEra });   // an empty one, exact
        expect(st1.exact(st1.get(a.key))).toBe(true);
        st1.release("hidden");
        expect(st1.ramHas(a.key)).toBe(false);                              // red: an empty hole released into the tier
        const st2 = mk();
        st2.put({ ...b, G: 0, bitmap: bitmap(), packed: words(), jobId: null, omitHeld: st2.heldEra });
        st2.put({ ...c, G: 0, bitmap: bitmap(), packed: words(), jobId: null });
        const late = { ...c, G: 1, bitmap: bitmap(), packed: words(), jobId: null, omitHeld: st2.heldEra };
        st2.endHeld();
        expect(st2.get(b.key)).toBeUndefined();                             // red: the drop's sweep never reaches its hole
        expect(st2.get(c.key)).toBeTruthy();                                // a plate with the held ink stays
        expect(st2.put(late)).toBe("refused");                              // red: packed mid-drag, landing after it
        expect(st2.put({ ...b, G: 1, bitmap: bitmap(), packed: words(), jobId: null, omitHeld: st2.heldEra })).toBe("cached");   // the next drag's
    });

    test("the budget: 64 MiB on a desktop, 24 on a phone, the lever's value, 0 off; no budget, no tier", () => {
        expect(ramBudgetBytes({}, false)).toBe(64 << 20);
        expect(ramBudgetBytes({}, true)).toBe(24 << 20);
        expect(ramBudgetBytes({ plateRamMiB: 8 }, false)).toBe(8 << 20);
        expect(ramBudgetBytes({ plateRamMiB: 0 }, true)).toBe(0);
        const st = new PyramidStore({ fresh: freshStub(), doc: null, maxBytes: 0 });
        put(st, 0);
        expect(st.report().ram.entries).toBe(0);
    });
});
