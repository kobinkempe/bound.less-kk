/**
 * storageLocks — the `navigator.locks` subset the session uses, over localStorage, for a browser
 * without Web Locks (the review's nit: the phone on the dev server by LAN IP is not a secure
 * context, and old Safari has none). Two managers over one storage are two tabs.
 */
import { makeStorageLocks } from "./storageLocks";

const OPTS = { heartbeatMs: 20, staleMs: 120, pollMs: 15, settleMs: 5 };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
// Waits for `fn` (up to 3 s): a loaded machine runs 15 ms polls late, so fixed sleeps flake.
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await tick(10); };
let storage;
beforeEach(() => {
    const m = new Map();
    storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
});
const hold = (locks, opts, log, name) => {
    let release;
    const p = locks.request("L", opts, (lock) => {
        log.push(`${name}:${lock ? "got" : "none"}`);
        if (!lock) return undefined;
        return new Promise((r) => { release = r; });
    });
    return { p, release: () => release && release() };
};

test("exclusive; ifAvailable answers null; a waiter gets it when the holder lets go", async () => {
    // staleMs long: a starved event loop must not make the live holder look stale here
    const a = makeStorageLocks({ storage, ...OPTS, staleMs: 2000 }), b = makeStorageLocks({ storage, ...OPTS, staleMs: 2000 });
    const log = [];
    const A = hold(a, {}, log, "A");
    await tick(30);
    hold(b, { ifAvailable: true }, log, "B1");
    const B2 = hold(b, {}, log, "B2");
    await until(() => log.length >= 2);
    await tick(60);
    expect(log).toEqual(["A:got", "B1:none"]);
    A.release();
    await A.p;
    await until(() => log.includes("B2:got"));
    expect(log).toEqual(["A:got", "B1:none", "B2:got"]);
    B2.release();
});

test("a holder that stops beating (a closed tab) is free after staleMs", async () => {
    const a = makeStorageLocks({ storage, ...OPTS }), b = makeStorageLocks({ storage, ...OPTS });
    const log = [];
    storage.setItem("boundless.lock.L", JSON.stringify({ owner: "gone", at: Date.now() }));
    hold(b, {}, log, "B");
    await tick(60);
    expect(log).toEqual([]);
    await tick(150);
    expect(log).toEqual(["B:got"]);
    expect(a).toBeTruthy();
});

test("steal: the new holder gets it at once and the old one's request rejects with AbortError", async () => {
    const a = makeStorageLocks({ storage, ...OPTS }), b = makeStorageLocks({ storage, ...OPTS });
    const log = [];
    const A = hold(a, {}, log, "A");
    await tick(30);
    let err = null;
    A.p.catch((e) => { err = e; });
    hold(b, { steal: true }, log, "B");
    await tick(80);
    expect(log).toEqual(["A:got", "B:got"]);
    expect(err && err.name).toBe("AbortError");
});

test("an aborted waiter never gets the lock", async () => {
    const a = makeStorageLocks({ storage, ...OPTS }), b = makeStorageLocks({ storage, ...OPTS });
    const log = [];
    const A = hold(a, {}, log, "A");
    await tick(30);
    const ac = new AbortController();
    const B = hold(b, { signal: ac.signal }, log, "B");
    let err = null;
    B.p.catch((e) => { err = e; });
    ac.abort();
    A.release();
    await tick(80);
    expect(log).toEqual(["A:got"]);
    expect(err && err.name).toBe("AbortError");
});

// A page's window: `pagehide` fires on a reload, a close, a navigation away.
const page = () => { const t = new EventTarget(); t.hide = () => t.dispatchEvent(new Event("pagehide")); return t; };

test("a page that goes away lets its lock go at once, so its reload takes the pen back (Kobin 2026-09-23)", async () => {
    const before = page();
    const a = makeStorageLocks({ storage, ...OPTS, staleMs: 10000, target: before });
    const log = [];
    hold(a, {}, log, "A").p.catch(() => null);             // jsdom keeps the old page running: its next beat finds the key gone
    await tick(30);
    before.hide();                                          // reload: the old page cannot run its own release
    const b = makeStorageLocks({ storage, ...OPTS, staleMs: 10000, target: page() });
    hold(b, { ifAvailable: true }, log, "reloaded");
    await tick(30);
    expect(log).toEqual(["A:got", "reloaded:got"]);        // not "none" for the 10 s the record stays fresh
});

test("a second live tab still waits: nothing is let go while its holder's page is shown", async () => {
    const a = makeStorageLocks({ storage, ...OPTS, staleMs: 10000, target: page() });
    const b = makeStorageLocks({ storage, ...OPTS, staleMs: 10000, target: page() });
    const log = [];
    const A = hold(a, {}, log, "A");
    await tick(30);
    hold(b, { ifAvailable: true }, log, "second tab");
    await tick(30);
    expect(log).toEqual(["A:got", "second tab:none"]);
    A.release();
    await A.p;
});
