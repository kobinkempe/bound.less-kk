/**
 * SYNC-PLAN R2–R8 across two devices: REAL engines and savers, each device with its own
 * IndexedDB and its own copy of the modules (jest.isolateModules), one fake Firestore between
 * them, each with its own network switch. A second device opens read-only and follows; "Edit
 * here" moves the pen with a stroke in progress; offline edits on both devices are both kept.
 */
/* global globalThis */
import { IDBFactory } from "fake-indexeddb";
import { waitFor } from "@testing-library/react";
import { makeLocks, makeChannelBus } from "../engine/__testkit__/fakeTabs";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
// `getDb` reads the shared backend without a require: a require at call time would load the fake into
// the main registry, and every later isolated copy would then share it (Jest 26).
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => globalThis.__fakeFirestoreBackend.db }));
jest.setTimeout(60000);

const OPTS = { beatMs: 60, syncMs: 100000, stealAfterMs: 250, askMaxMs: 20000, followMinMs: 20, followCostFactor: 0, openTimeoutMs: 800, openRetryMs: 100, ttlMs: 600 };
const UID = "u1";
const MANIFEST = `users/${UID}/dev-canvases/c1`;
// The shared cloud. Not imported: a module the test file imports is reused by every isolated copy
// (Jest 26), which would give both devices one network switch.
const fake = { get backend() { return globalThis.__fakeFirestoreBackend; }, data: (p) => globalThis.__fakeFirestoreBackend.data(p) };

// One device: its modules (React included), its IndexedDB, its locks and channel.
function loadDevice(name, idb) {
    let M;
    window.indexedDB = idb;
    jest.isolateModules(() => {
        M = {
            name,
            React: require("react"),
            rtl: require("@testing-library/react"),
            useKobinEngine: require("./useKobinEngine").default,
            session: require("../cloud/canvasSession"),
            local: require("../storage/localCanvases"),
            db: require("../storage/db"),
            net: require("../engine/__testkit__/fakeFirestore").client,
        };
    });
    M.locks = makeLocks();
    M.Channel = makeChannelBus();
    M.tab = {};
    const { React } = M;
    M.Tab = function Tab() {
        const apiRef = React.useRef(null);
        const sessRef = React.useRef(null);
        const api = M.useKobinEngine({ canvasId: "c1", onAutosave: (a) => { if (sessRef.current) sessRef.current.onLocalSaved(a.seq); } });
        apiRef.current = api;
        M.tab.api = api;
        React.useEffect(() => {
            if (!api.engineReady) return undefined;
            const s = new M.session.CanvasSession({
                canvasId: "c1", uid: UID, deviceId: name, deviceName: name, tabId: name + "-tab",
                editor: M.session.editorFromHook(() => apiRef.current),
                env: { locks: M.locks, Channel: M.Channel, visible: () => true }, opts: OPTS,
                onNotice: (n) => { (M.notices = M.notices || []).push(n); },
                onState: (st) => { (M.states = M.states || []).push(st.mode); },
            });
            sessRef.current = s;
            M.tab.session = s;
            s.start();
            return () => { s.stop(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [api.engineReady]);
        return React.createElement("div", { ref: api.hostRef });
    };
    return M;
}
async function mount(M) {
    window.indexedDB = M.idb;
    M.tab = {};
    M.rtl.act(() => { M.view = M.rtl.render(M.React.createElement(M.Tab)); });
    await waitFor(() => expect(M.tab.session).toBeTruthy());
    await M.local.getStoreHeader("c1");      // this copy's database is opened on its own factory
}
function unmount(M) { if (!M.view) return; M.rtl.act(() => { M.view.unmount(); }); M.view = null; M.tab.session = null; }
const mode = (M) => M.tab.session && M.tab.session.state.mode;
const E = (M) => M.tab.api.engineRef.current;
const strokes = (M) => M.tab.api.stats().strokes;
function draw(M, x = 100, done = true) {
    const e = E(M);
    M.rtl.act(() => {
        e.pointerDown(x, 100);
        for (let i = 1; i <= 6; i++) e.pointerMove(x + i * 12, 100 + i * 7);
        if (done) e.pointerUp();
    });
}
async function save(M) {
    await M.rtl.act(async () => { await M.tab.api.flushSave(); });
}
async function push(M) {
    let r;
    await M.rtl.act(async () => { await M.tab.api.flushSave(); r = await M.tab.session.pushNow(); });
    return r;
}

let laptop, phone;
beforeEach(() => {
    localStorage.clear();
    laptop = loadDevice("laptop", new IDBFactory());
    phone = loadDevice("phone", new IDBFactory());
    fake.backend.reset();
    laptop.idb = new IDBFactory(); phone.idb = new IDBFactory();   // each copy opens its database on its own at mount
    laptop.local.upsertIndexEntry({ id: "c1", name: "A" });   // one localStorage for both: the index is shared here
});
afterEach(async () => {
    // A failed test must not leave its sessions pushing into the next test's cloud.
    for (const M of [phone, laptop]) {
        const s = M.tab && M.tab.session;
        if (s) { await s.stop(); if (s.busy) await s.busy.catch(() => null); }
        unmount(M);
    }
    laptop.net.offline = false; phone.net.offline = false;
});

test("each simulated device has its own network switch", () => {
    expect(laptop.net).not.toBe(phone.net);
});
afterEach(() => expect(laptop.net).not.toBe(phone.net));

test("a second device opens read-only and follows; Edit here moves the pen with a stroke in progress", async () => {
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    draw(laptop, 100);
    expect((await push(laptop)).ok).toBe(true);
    expect(fake.data(MANIFEST).lease.device).toBe("laptop");

    await mount(phone);
    await waitFor(() => expect(mode(phone)).toBe("readonly"), { timeout: 5000 });
    expect(phone.tab.session.state).toMatchObject({ why: "device", holder: { name: "laptop" } });
    await waitFor(() => expect(strokes(phone)).toBe(1), { timeout: 5000 });
    expect(E(phone).readOnly).toBe(true);

    draw(laptop, 200);
    await push(laptop);
    await waitFor(() => expect(strokes(phone)).toBe(2), { timeout: 5000 });   // followed, fast-forward

    draw(laptop, 300, false);                                      // mid-stroke on the laptop
    await phone.rtl.act(async () => { await phone.tab.session.takeOver(); });
    await waitFor(() => expect(mode(phone)).toBe("editing"), { timeout: 5000 });
    await waitFor(() => expect(mode(laptop)).toBe("readonly"), { timeout: 5000 });
    expect(strokes(phone)).toBe(3);                                // the laptop's stroke in progress came over
    expect(fake.data(MANIFEST).lease.device).toBe("phone");
    expect(E(laptop).readOnly).toBe(true);

    draw(phone, 400);
    expect((await push(phone)).ok).toBe(true);
    await waitFor(() => expect(strokes(laptop)).toBe(4), { timeout: 5000 });
    unmount(phone); unmount(laptop);
});

test("Edit here takes the lease once: its own take's echo is not taken again, one promote", async () => {
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    draw(laptop, 100);
    await push(laptop);
    await mount(phone);
    await waitFor(() => expect(strokes(phone)).toBe(1));
    draw(laptop, 200);
    await save(laptop);                                        // the hand-over pushes it; the promote pulls it
    const hold = fake.backend.gate((kind, path) => kind === "get" && path.includes("/parts/"));
    phone.states = [];
    await phone.rtl.act(async () => { await phone.tab.session.takeOver(); });
    await waitFor(() => expect(phone.tab.session.epoch).toBeTruthy(), { timeout: 5000 });   // taken; the promote waits on its pull
    const epoch = phone.tab.session.epoch;
    await new Promise((r) => setTimeout(r, 300));             // the take's own manifest echo arrives meanwhile
    expect(fake.data(MANIFEST).lease.epoch).toBe(epoch);
    hold();
    await waitFor(() => expect(mode(phone)).toBe("editing"), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(phone.states.filter((m) => m === "editing").length).toBe(1);
    expect(phone.tab.session.epoch).toBe(epoch);
    expect(strokes(phone)).toBe(2);
    draw(phone, 400);
    expect(strokes(phone)).toBe(3);                            // never flipped read-only by a second promote
    unmount(phone); unmount(laptop);
});

test("Edit here waits for a holder whose hand-over push is slow; nothing is forced, no copy is made (review minor 10)", async () => {
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    draw(laptop, 100);
    await push(laptop);
    await mount(phone);
    await waitFor(() => expect(strokes(phone)).toBe(1));
    draw(laptop, 200); draw(laptop, 260);
    await save(laptop);                                        // on disk, not yet pushed
    const release = fake.backend.gate((kind, path) => kind === "commit" && path.includes("/parts/"));
    await phone.rtl.act(async () => { await phone.tab.session.takeOver(); });
    await new Promise((r) => setTimeout(r, 2500));             // longer than a TTL (600 ms) and the old 1.5 s ask
    expect(mode(laptop)).toBe("handing");
    expect(mode(phone)).toBe("taking");
    release();
    await waitFor(() => expect(mode(phone)).toBe("editing"), { timeout: 5000 });
    expect(strokes(phone)).toBe(3);
    expect(mode(laptop)).toBe("readonly");
    expect((laptop.notices || []).some((n) => n.kind === "conflict")).toBe(false);
    unmount(phone); unmount(laptop);
});

test("offline edits on both devices: the canvas keeps one device's, the other's become a new canvas; nothing is lost", async () => {
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    draw(laptop, 100);
    await push(laptop);
    await mount(phone);
    await waitFor(() => expect(strokes(phone)).toBe(1));
    await waitFor(() => expect(mode(phone)).toBe("readonly"));   // the open's reload renders a task after the stroke lands

    // The laptop drops off the network and keeps drawing; its lease stops being renewed.
    laptop.net.offline = true;
    draw(laptop, 200); draw(laptop, 260);
    await save(laptop);
    // The phone watches the lease sit unchanged for a whole TTL of its own clock, then takes the pen.
    await waitFor(() => expect(mode(phone)).toBe("editing"), { timeout: 5000 });
    draw(phone, 320);
    expect((await push(phone)).ok).toBe(true);
    // Now the phone drops off too, and draws on.
    phone.net.offline = true;
    draw(phone, 380);
    await save(phone);

    // The laptop comes back first: it has lost the pen and the cloud moved, so its edits become a new canvas.
    laptop.net.offline = false;
    await waitFor(() => expect(mode(laptop)).toBe("readonly"), { timeout: 5000 });
    await waitFor(() => expect(strokes(laptop)).toBe(2), { timeout: 5000 });       // the cloud's: 1 + the phone's first
    const fork = (laptop.notices || []).find((n) => n.kind === "conflict");
    expect(fork).toBeTruthy();
    expect(fork.name).toMatch(/^A — edits from laptop, /);
    const forked = await laptop.local.loadCanvasStore(fork.id);
    expect(forked.header.strokes).toBe(3);                                          // 1 + the laptop's two offline strokes
    expect(forked.header.base).toBeUndefined();

    // The phone comes back: still its pen, so its offline stroke goes up as a fast-forward.
    phone.net.offline = false;
    await phone.rtl.act(async () => { await phone.tab.session._beat(); });
    expect((await push(phone)).ok).toBe(true);
    await waitFor(() => expect(strokes(laptop)).toBe(3), { timeout: 5000 });
    expect(fake.data(MANIFEST).strokes).toBe(3);
    unmount(phone); unmount(laptop);
});

test("a device that opens with unpushed edits after the cloud moved keeps both", async () => {
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    draw(laptop, 100);
    await push(laptop);
    await mount(phone);
    await waitFor(() => expect(strokes(phone)).toBe(1));
    unmount(laptop);                                                  // lets go of the lease
    await waitFor(() => expect(mode(phone)).toBe("editing"), { timeout: 5000 });
    draw(phone, 200);
    await push(phone);
    unmount(phone);
    // The laptop's copy predates the phone's stroke; offline, it draws, then opens online.
    laptop.net.offline = true;
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    expect(laptop.tab.session.state.cloud).toBe("offline");
    draw(laptop, 300);
    await save(laptop);
    laptop.net.offline = false;
    await waitFor(() => expect((laptop.notices || []).some((n) => n.kind === "conflict")).toBe(true), { timeout: 5000 });
    await waitFor(() => expect(strokes(laptop)).toBe(2));
    const fork = laptop.notices.find((n) => n.kind === "conflict");
    expect((await laptop.local.loadCanvasStore(fork.id)).header.strokes).toBe(2);   // 1 + the laptop's offline stroke
    expect(mode(laptop)).toBe("editing");
    unmount(laptop);
});
