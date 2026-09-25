/**
 * The review of the sync build (2026-09-22), reproduced: one device's tabs with REAL engines and
 * savers over one IndexedDB and the fake Firestore; another device is simulated through
 * canvasSync directly. Each test failed on the build the review read.
 */
import React, { useEffect, useRef } from "react";
import { render, act, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import { CanvasSession, editorFromHook } from "../cloud/canvasSession";
import { makeLocks, makeChannelBus } from "../engine/__testkit__/fakeTabs";
import { fake, client } from "../engine/__testkit__/fakeFirestore";
import { _resetDbForTests } from "../storage/db";
import * as local from "../storage/localCanvases";
import { cloudTakeLease, cloudPullCanvas2, cloudPushCanvas2, cloudReleaseLease, cloudSaveCanvas, cloudAskLease } from "../cloud/canvasSync";
import { encodeEntry } from "../engine/format2";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));
jest.setTimeout(60000);

const UID = "u1", ID = "c1";
const MANIFEST = `users/${UID}/dev-canvases/${ID}`;
const OPTS = { beatMs: 60, syncMs: 100000, stealAfterMs: 250, askMaxMs: 20000, followMinMs: 20, followCostFactor: 0, openTimeoutMs: 800, openRetryMs: 100, ttlMs: 600, skewMs: 600 };
const tabs = {};
const notices = [];
let env;

function Tab({ name, gated = true, uid = UID, hooks = {}, opts = {} }) {
    const apiRef = useRef(null);
    const sessRef = useRef(null);
    const api = useKobinEngine({
        canvasId: ID, gated,
        onAutosave: (a) => { if (sessRef.current) sessRef.current.onLocalSaved(a.seq); },
        onRefused: (k) => { if (sessRef.current && sessRef.current.onRefused) sessRef.current.onRefused(k); },
    });
    apiRef.current = api;
    tabs[name] = tabs[name] || {};
    tabs[name].api = api;
    useEffect(() => {
        if (!api.engineReady) return undefined;
        const base = editorFromHook(() => apiRef.current);
        const editor = { ...base, reload: async (o) => { if (hooks.beforeReload) await hooks.beforeReload(name); return base.reload(o); } };
        const make = () => new CanvasSession({
            canvasId: ID, uid, deviceId: "laptop", deviceName: "laptop", tabId: name, editor,
            env: { locks: env.locks, Channel: env.Channel, visible: () => true }, opts: { ...OPTS, ...opts },
            onNotice: (n) => notices.push({ tab: name, ...n }),
        });
        const s = make();
        sessRef.current = s;
        tabs[name].session = s;
        tabs[name].restart = () => { const old = sessRef.current; old.stop(); const s2 = make(); sessRef.current = s2; tabs[name].session = s2; s2.start(); return s2; };
        s.start();
        return () => { if (sessRef.current) sessRef.current.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api.engineReady]);
    return <div ref={api.hostRef} />;
}
async function mount(name, props = {}) {
    let view;
    act(() => { view = render(<Tab name={name} {...props} />); });
    await waitFor(() => expect(tabs[name].session).toBeTruthy());
    tabs[name].view = view;
    return view;
}
function unmount(name) { if (tabs[name] && tabs[name].view) { act(() => tabs[name].view.unmount()); tabs[name].view = null; } }
const mode = (n) => tabs[n].session && tabs[n].session.state.mode;
const E = (n) => tabs[n].api.engineRef.current;
const strokes = (n) => tabs[n].api.stats().strokes;
function draw(n, x = 100, done = true) {
    act(() => {
        const e = E(n);
        e.pointerDown(x, 100);
        for (let i = 1; i <= 6; i++) e.pointerMove(x + i * 12, 100 + i * 7);
        if (done) e.pointerUp();
    });
}
const flush = async (n) => { let ok; await act(async () => { ok = await tabs[n].api.flushSave(); }); return ok; };
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

// The phone: take the pen, pull the cloud copy, draw `n` strokes into it, push, let go.
async function phoneDraws(n) {
    const t = await cloudTakeLease(UID, ID, { device: "phone", tab: "p", name: "phone" }, { force: true });
    const whole = await cloudPullCanvas2(UID, ID);
    const header = JSON.parse(JSON.stringify(whole.header));
    header.base = { ...whole.head, col: "dev-canvases" };
    const log = [...whole.entries];
    for (let i = 0; i < n; i++) {
        const seq = header.seq + 1;
        const e = encodeEntry({ k: "add", level: "0", index: 0, obj: { type: "stroke", origin: "native", id: 5000 + seq, pts: [[0, 0], [30, 20], [60, 10]], lwFrame: 2, color: "#000", opacity: 1 } });
        log.push({ seq, t: seq, op: e.op, geo: e.geo, touches: ["0"] });
        header.seq = seq;
    }
    const source = {
        header,
        readFrames: async (ids) => ids.map((fid) => ({ frameId: fid, ...whole.frames[fid] })),
        readLog: async (from) => log.filter((e) => e.seq > from),
        setSync: async () => true,
    };
    await cloudPushCanvas2(UID, { id: ID, name: "A", strokes: (whole.header.strokes || 0) + n, levels: 1 }, source, { deviceId: "phone", epoch: t.lease.epoch });
    await cloudReleaseLease(UID, ID, t.lease.epoch);
}
// The laptop's first copy: one stroke, pushed; the tab closed.
async function laptopCreates() {
    await mount("A0");
    await waitFor(() => expect(mode("A0")).toBe("editing"));
    draw("A0");
    await act(async () => { await tabs.A0.api.flushSave(); await tabs.A0.session.pushNow(); });
    unmount("A0");
    await wait(50);
}

beforeEach(() => {
    fake.reset();
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
    for (const k of Object.keys(tabs)) delete tabs[k];
    notices.length = 0;
    env = { locks: makeLocks(), Channel: makeChannelBus() };
    local.upsertIndexEntry({ id: ID, name: "A" });
});
afterEach(async () => {
    for (const n of Object.keys(tabs)) { if (tabs[n].session) await tabs[n].session.stop(); unmount(n); }
    jest.restoreAllMocks();
});

test("major 1: an open-time pull cannot write over the store after another tab took the pen", async () => {
    await laptopCreates();
    await phoneDraws(2);
    const release = fake.gate((kind, path) => kind === "get" && path.includes("/parts/"), 1);   // the first pull stalls
    await mount("A");
    await waitFor(() => expect(fake.gates.length && fake.gates[0].left).toBe(0));
    await mount("B");
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    await act(async () => { await tabs.B.session.takeOver(); });
    await waitFor(() => expect(mode("B")).toBe("editing"), { timeout: 5000 });
    draw("B", 300);
    await flush("B");
    release();
    await wait(400);
    expect(mode("A")).not.toBe("editing");
    expect(mode("B")).toBe("editing");
    const s = await local.loadCanvasStore(ID);
    expect(s.header.strokes).toBe(4);
    expect(String(s.header.writer)).toMatch(/^B\./);
});

test("major 1: a stolen tab whose work queue is busy stops writing at once", async () => {
    await mount("A", { uid: null });
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");
    await flush("A");
    await mount("B", { uid: null });
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    tabs.A.session._serial(() => new Promise(() => {}));      // a long task holds its queue
    tabs.A.session._channel.onmessage = null;                  // and it does not answer
    draw("A", 200);                                            // unsaved when the pen is stolen
    await act(async () => { await tabs.B.session.takeOver(); });
    await waitFor(() => expect(mode("B")).toBe("editing"), { timeout: 5000 });
    expect(E("A").readOnly).toBe(true);
    draw("B", 300);
    await flush("B");
    await flush("A");
    const s = await local.loadCanvasStore(ID);
    expect(s.header.strokes).toBe(2);                          // A's first + B's
    expect(String(s.header.writer)).toMatch(/^B\./);
    await waitFor(() => expect(local.readIndex().some((e) => /unsaved/.test(e.name))).toBe(true));
    const kept = local.readIndex().find((e) => /unsaved/.test(e.name));
    expect((await local.loadCanvasStore(kept.id)).header.strokes).toBe(2);   // A's two, kept
});

test("major 2: a camera save between the pull and the reload cannot damage the store", async () => {
    await laptopCreates();
    await phoneDraws(2);
    let once = false;
    // The camera is saved on hide even with no edit (the hook's hide flush): hide the tab between
    // the pull's write and the reload's read.
    const hide = async () => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        await new Promise((r) => setTimeout(r, 50));
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    };
    const hooks = { beforeReload: async (name) => {
        if (name !== "A" || once) return;
        once = true;
        E("A").panBy(30, 0);
        await hide();
    } };
    await mount("A", { gated: false, hooks });
    await waitFor(() => expect(mode("A")).toBe("editing"), { timeout: 5000 });
    expect(once).toBe(true);
    const s = await local.loadCanvasStore(ID);
    expect(s.header.strokes).toBe(3);
    expect(s.header.seq).toBe(fake.data(MANIFEST).head.seq);
    expect(strokes("A")).toBe(3);
    expect(local.readIndex().length).toBe(1);                 // nothing kept as a copy: nothing was refused
});

test("major 3: busy holds until the push settles, past its deadline", async () => {
    await mount("A");
    await waitFor(() => expect(mode("A")).toBe("editing"));
    tabs.A.session.o.pushDeadlineMs = 150;
    draw("A");
    await flush("A");
    const release = fake.gate((kind, path) => kind === "commit" && path.includes("/parts/"));
    let r1;
    await act(async () => { r1 = await tabs.A.session.pushNow(); });
    expect(r1.ok).toBe(false);                                 // the deadline
    expect(tabs.A.session.busy).toBeTruthy();
    let r2;
    await act(async () => { r2 = await tabs.A.session.pushNow(); });
    expect(r2.busy).toBe(true);
    release();
    await waitFor(() => expect(tabs.A.session.busy).toBe(null));
    // Landed, or let go at the lane's stall deadline (review 2026-09-23, minor 8): either way the next push lands.
    let r3;
    await act(async () => { r3 = await tabs.A.session.pushNow(); });
    expect(r3.ok).toBe(true);                                  // a first push that landed late made the lease this tab's
    expect(fake.data(MANIFEST).head.seq).toBeGreaterThan(0);
});

test("minor 4: a failed flush before losing the pen keeps the work as a new canvas", async () => {
    await mount("A");
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); await tabs.A.session.pushNow(); });
    jest.spyOn(local, "writeCanvas2").mockImplementation(() => Promise.reject(Object.assign(new Error("full"), { name: "QuotaExceededError" })));
    draw("A", 250);                                            // cannot be saved
    await phoneDraws(1);                                       // the phone took the pen meanwhile
    await waitFor(() => expect(mode("A")).toBe("readonly"), { timeout: 5000 });
    await waitFor(() => expect(local.readIndex().some((e) => /unsaved/.test(e.name))).toBe(true));
    const kept = local.readIndex().find((e) => /unsaved/.test(e.name));
    expect((await local.loadCanvasStore(kept.id)).header.strokes).toBe(2);
});

test("minor 5: restarting the session keeps what was drawn in the last seconds", async () => {
    await mount("A", { uid: null });
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");                                                 // not saved yet (the debounce)
    act(() => { tabs.A.restart(); });
    await waitFor(() => expect(mode("A")).toBe("editing"), { timeout: 5000 });
    await wait(100);
    expect(strokes("A")).toBe(1);
    expect((await local.loadCanvasStore(ID)).header.strokes).toBe(1);
});

test("minor 8: when the local copy cannot be stashed, the cloud copy does not replace it", async () => {
    // A local copy from before versions (no base), older than the phone's cloud copy.
    await mount("A0", { uid: null });
    await waitFor(() => expect(mode("A0")).toBe("editing"));
    draw("A0");
    await flush("A0");
    unmount("A0");
    await wait(50);
    await local.setSyncState(ID, { savedAt: "2020-01-01T00:00:00Z" });
    const t = await cloudTakeLease(UID, ID, { device: "phone", tab: "p", name: "phone" });
    expect(t.absent).toBe(true);
    const src = await local.cloudPushSource(ID);
    const fakeSrc = { ...src, setSync: async () => true };
    await cloudPushCanvas2(UID, { id: ID, name: "A", strokes: 1 }, fakeSrc, { deviceId: "phone", lease: { device: "phone", tab: "p", name: "phone", epoch: "eP", until: 0 } });
    await local.setSyncState(ID, { savedAt: "2020-01-01T00:00:00Z", base: null, intent: null, pending: [] });
    await mount("A1", { uid: null });                          // the local copy is made to differ from the phone's
    await waitFor(() => expect(mode("A1")).toBe("editing"));
    draw("A1", 300);
    await flush("A1");
    unmount("A1");
    await wait(50);
    await local.setSyncState(ID, { savedAt: "2020-01-01T00:00:00Z" });
    jest.spyOn(local, "stashOverwrittenVersion").mockResolvedValue(null);
    if (local.stashCanvasStore) jest.spyOn(local, "stashCanvasStore").mockResolvedValue(null);
    await mount("A");
    await wait(600);
    expect((await local.loadCanvasStore(ID)).header.strokes).toBe(2);     // not replaced by the cloud's one stroke
    expect(mode("A")).not.toBe("editing");
    expect(tabs.A.session.state.error).toBeTruthy();
});

test("minor 9: an lz1 cloud copy is kept as a new canvas before the first push replaces it", async () => {
    const lz1Doc = { format: "boundless-drawing", version: 1, meta: { name: "A" }, camera: null, crossings: {},
        natives: { 0: [1, 2, 3].map((id) => ({ type: "stroke", origin: "native", id, pts: [[0, 0], [10, id]], lwFrame: 2, color: "#000", opacity: 1 })) } };
    await cloudSaveCanvas(UID, { id: ID, name: "A", savedAt: "2020-01-01T00:00:00Z", strokes: 3, levels: 1 }, JSON.stringify(lz1Doc));
    await mount("A0", { uid: null });
    await waitFor(() => expect(mode("A0")).toBe("editing"));
    draw("A0");
    await flush("A0");
    unmount("A0");
    await wait(50);
    local.upsertIndexEntry({ id: ID, name: "A", savedAt: new Date().toISOString() });
    await mount("A");
    await waitFor(() => expect(mode("A")).toBe("editing"), { timeout: 5000 });
    await act(async () => { await tabs.A.session.pushNow(); });
    expect(fake.data(MANIFEST).format).toBe("kobin-2");
    const kept = local.readIndex().find((e) => e.id !== ID);
    expect(kept).toBeTruthy();
    expect((await local.loadCanvasStore(kept.id)).header.strokes).toBe(3);
});

test("minor 12: an error at open is shown and retried, not stuck", async () => {
    await laptopCreates();
    await phoneDraws(2);
    fake.failNext((kind, paths) => kind === "get" && paths.some((p) => p.includes("/parts/")), Object.assign(new Error("cloud copy is missing part"), { code: "not-found" }));
    await mount("A");
    await waitFor(() => expect(mode("A")).toBe("editing"), { timeout: 8000 });
    expect(strokes("A")).toBe(3);
});

test("nit: a steal racing the tab's own queued grant leaves one lock, released on stop", async () => {
    await mount("A", { uid: null });
    await waitFor(() => expect(mode("A")).toBe("editing"));
    await mount("B", { uid: null });
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    const lock = "boundless:canvas:c1";
    await act(async () => {
        await tabs.A.session.stop();
        for (let i = 0; i < 20 && env.locks.queued(lock); i++) await Promise.resolve();
        tabs.B.session._stealLock();                           // the steal timer fires as the grant lands
    });
    await waitFor(() => expect(mode("B")).toBe("editing"), { timeout: 5000 });
    await act(async () => { await tabs.B.session.stop(); });
    await wait(50);
    expect(env.locks.isHeld(lock)).toBe(false);
});

test("a lease let go to an asker who never takes it comes back after one TTL unchanged, not before", async () => {
    await mount("A");
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); await tabs.A.session.pushNow(); });
    await cloudAskLease(UID, ID, { device: "phone", tab: "p", name: "phone" });   // then the phone goes away
    await waitFor(() => expect(fake.data(MANIFEST).lease.until).toBe(0));
    expect(fake.data(MANIFEST).lease.to).toBe("phone");
    expect(mode("A")).toBe("readonly");
    await wait(OPTS.ttlMs / 2);
    expect(fake.data(MANIFEST).lease.until).toBe(0);                             // still reserved for the phone
    await waitFor(() => expect(mode("A")).toBe("editing"), { timeout: 5000 });
    expect(fake.data(MANIFEST).lease.device).toBe("laptop");
});

test("one push at a time per page: a session restarted mid-push never uploads beside the old one (memory firestore-write-stream)", async () => {
    const S = client.stream.reset({ limit: 1 });
    await mount("A");
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); await tabs.A.session.pushNow(); });
    draw("A", 200);
    await flush("A");
    const release = fake.gate((kind, path) => kind === "commit" && path.includes("/parts/"), 1);
    act(() => { tabs.A.session.pushNow(); });                   // its first part hangs on the wire
    await waitFor(() => expect(S.inFlight).toBe(1));
    act(() => { tabs.A.restart(); });                           // Fast Refresh: the session stops and another starts
    await waitFor(() => expect(mode("A")).toBe("editing"), { timeout: 5000 });
    draw("A", 300);
    await flush("A");
    let second;
    act(() => { second = tabs.A.session.pushNow(); });
    await wait(200);
    expect(S.maxInFlight).toBe(1);
    release();
    await act(async () => { await second; });
    await waitFor(() => expect(S.inFlight).toBe(0));
    expect(S.exhausted).toBe(0);
    expect(S.maxInFlight).toBe(1);
    await act(async () => { await tabs.A.session.pushNow(); });
    const s = await local.loadCanvasStore(ID);
    expect(fake.data(MANIFEST).head.seq).toBe(s.header.seq);
    expect(fake.data(MANIFEST).strokes).toBe(3);
});

test("nit: without Web Locks a second tab is still read-only", async () => {
    env.locks = null;
    await mount("A", { uid: null });
    await waitFor(() => expect(mode("A")).toBe("editing"));
    await mount("B", { uid: null });
    await waitFor(() => expect(mode("B")).toBe("readonly"), { timeout: 5000 });
    unmount("A");
    await waitFor(() => expect(mode("B")).toBe("editing"), { timeout: 8000 });
});

// A session not started: its follow scheduling and reload bookkeeping alone.
function bareSession(opts = {}, editor = {}) {
    return new CanvasSession({
        canvasId: "u", uid: null, deviceId: "laptop", deviceName: "laptop", tabId: "U",
        editor: { reload: async () => 1, refreshMeta: async () => true, ...editor },
        env: { locks: makeLocks(), Channel: makeChannelBus(), visible: () => true }, opts: { ...OPTS, ...opts },
    });
}

test("a follow waiting its gap does not stop every later one when the tab loses the lock (review major 2)", async () => {
    const s = bareSession({ followMinMs: 60000 });
    const ran = [];
    s.followAt = Date.now();
    s._scheduleFollow(async () => { ran.push("old"); });   // waits its gap
    s._stopCloud();                                          // another tab took the pen: every timer cleared
    s.followAt = 0;
    s._scheduleFollow(async () => { ran.push("new"); });
    await wait(60);
    expect(ran).toEqual(["new"]);
});

test("a follow reload that fails is owed again (review minor 5)", async () => {
    const s = bareSession({}, { reload: async () => { throw new Error("will not replay"); } });
    s._followData = true;
    await s._reloadFollow().catch(() => null);
    expect(s._followData).toBe(true);
});

test("a push's deadline starts when it leaves the page's push lane, not while it queues (review minor 8)", async () => {
    await mount("A", { opts: { pushDeadlineMs: 400 } });
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");
    await flush("A");
    // Another canvas's push holds the lane for 800 ms.
    await local.writeCanvas2("c9", { header: { format: "boundless-drawing", version: 1, meta: { name: "B" }, camera: null, crossings: {}, name: "B", strokes: 0, levels: 1, seq: 1 }, snapshots: {}, frameIds: [], entries: [], full: true, resetLog: true });
    const release = fake.gate((kind, path) => kind === "commit" && path.includes("/c9"));
    const other = cloudPushCanvas2(UID, { id: "c9", name: "B" }, await local.cloudPushSource("c9"), { deviceId: "laptop", lease: { device: "laptop", tab: "x", name: "laptop", epoch: "e9", until: Date.now() + 60000 } });
    setTimeout(release, 800);
    let r;
    await act(async () => { r = await tabs.A.session.pushNow(); });
    expect(r.ok).toBe(true);
    await other.catch(() => null);
});
