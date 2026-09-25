/**
 * An erase baking while a second DEVICE follows through the cloud (SYNC-PLAN R2–R8; Kobin, 2026-09-23:
 * the bake runs only where the pen is). The two-device harness of sync.devices.test.js — REAL engines
 * and savers, an IndexedDB and a module copy each, one fake Firestore: the laptop bakes a ring through
 * a stack and pushes mid-bake; the phone pulls and follows read-only and must not bake; "Edit here"
 * mid-bake moves the bake to the phone, and the end is an uninterrupted bake's.
 */
/* global globalThis */
import { IDBFactory } from "fake-indexeddb";
import { waitFor } from "@testing-library/react";
import { makeLocks, makeChannelBus } from "../engine/__testkit__/fakeTabs";
import KobinEngine from "../engine/KobinEngine";
import { encodeLoops } from "../engine/geometry/arcShape";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
// `getDb` reads the shared backend without a require: a require at call time would load the fake into
// the main registry, and every later isolated copy would then share it (Jest 26).
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => globalThis.__fakeFirestoreBackend.db }));
jest.setTimeout(120000);

const OPTS = { beatMs: 60, syncMs: 100000, stealAfterMs: 250, askMaxMs: 20000, followMinMs: 20, followCostFactor: 0, openTimeoutMs: 800, openRetryMs: 100, ttlMs: 600 };
const UID = "u1";
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


const later = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const C = [400, 320];
const marks = (e) => e._eraseStrokes().length;
const ink = (e) => { const out = []; for (const L of e.doc.levels()) for (const o of e.doc.list(L)) if (!o.erase) out.push(o); return out; };
function sig(e) {
    const m = {};
    for (const o of ink(e)) { const z = e._zOf(o); (m[z] || (m[z] = [])).push(JSON.stringify(encodeLoops(o.loops))); }
    for (const z of Object.keys(m)) m[z].sort();
    return m;
}
function reference(snap) {
    const R = new KobinEngine(document.createElement("div"), { width: 1024, height: 768 });
    R._scheduleBake = () => {};
    R.loadDrawing(JSON.parse(JSON.stringify(snap)));
    R.flushErases();
    const s = sig(R);
    R.destroy();
    return s;
}
function stackAndRing(M, n) {
    const e = E(M);
    M.rtl.act(() => {
        for (let k = 0; k < n; k++) {
            e.setTool("pen"); e.setWidth(260); e.setColor("#" + ((0x204060 + k * 0x0a0604) & 0xffffff).toString(16).padStart(6, "0"));
            e.pointerDown(C[0] - 150, C[1]);
            for (let i = 1; i <= 30; i++) { const x = C[0] - 150 + 10 * i; e.pointerMove(x, C[1] + 25 * Math.sin(x / 14 + k)); }
            e.pointerUp();
        }
        e.flushBakes();
        e._scheduleBake = () => {};                             // the laptop's bake is stepped by hand
        if (e._bakeTimer != null) { clearTimeout(e._bakeTimer); e._bakeTimer = null; }
        e.setTool("erasePartial"); e.setEraserSize(12);
        const ring = [];
        for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; ring.push([C[0] + 60 * Math.cos(a), C[1] + 60 * Math.sin(a)]); }
        e.pointerDown(ring[0][0], ring[0][1]);
        for (const p of ring.slice(1)) e.pointerMove(p[0], p[1]);
        e.pointerUp();
        e.flushBakes();
    });
}
function bakeSteps(M, k) {
    const e = E(M);
    M.rtl.act(() => {
        const Erec = e._eraseStrokes()[0];
        for (let i = 0; i < k && Erec; i++) {
            const t = e._nextEraseTarget(Erec);
            if (!t) break;
            e._bakeOne(Erec, t, { sync: true });
            e._lowerMark(Erec, t);
        }
        if (Erec && !e._nextEraseTarget(Erec)) e._bakeTick();   // nothing left: the tick spends the mark
        e._render();
    });
}
function countBakes(e) {
    const c = { n: 0 };
    const orig = e._bakeOne.bind(e);
    e._bakeOne = (...a) => { c.n++; return orig(...a); };
    return c;
}

test("the phone pulls mid-bake and follows read-only without baking; it ends with the laptop's result", async () => {
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    stackAndRing(laptop, 6);
    const ref = reference(E(laptop).serializeDrawing());
    bakeSteps(laptop, 2);
    expect((await push(laptop)).ok).toBe(true);
    await mount(phone);
    await waitFor(() => expect(mode(phone)).toBe("readonly"));
    await waitFor(() => expect(marks(E(phone))).toBe(1));        // pulled mid-bake: the mark pending
    const phoneBakes = countBakes(E(phone));
    await phone.rtl.act(async () => { await later(700); });      // the phone's own timers run
    expect(phoneBakes.n).toBe(0);
    bakeSteps(laptop, 2);
    await push(laptop);
    await phone.rtl.act(async () => { await later(700); });
    expect(phoneBakes.n).toBe(0);
    bakeSteps(laptop, 10);
    expect(marks(E(laptop))).toBe(0);
    await push(laptop);
    await waitFor(() => expect(marks(E(phone))).toBe(0), { timeout: 10000 });
    expect(sig(E(laptop))).toEqual(ref);
    expect(sig(E(phone))).toEqual(ref);
    expect(phoneBakes.n).toBe(0);
    unmount(phone); unmount(laptop);
});

test("Edit here on the phone mid-bake: the phone finishes the bake, the laptop bakes no more, nothing cut twice", async () => {
    await mount(laptop);
    await waitFor(() => expect(mode(laptop)).toBe("editing"));
    stackAndRing(laptop, 6);
    const ref = reference(E(laptop).serializeDrawing());
    bakeSteps(laptop, 2);
    await push(laptop);
    await mount(phone);
    await waitFor(() => expect(mode(phone)).toBe("readonly"));
    await waitFor(() => expect(marks(E(phone))).toBe(1));
    const laptopBakes = countBakes(E(laptop));
    await phone.rtl.act(async () => { await phone.tab.session.takeOver(); });
    await waitFor(() => expect(mode(phone)).toBe("editing"), { timeout: 30000 });
    await waitFor(() => expect(mode(laptop)).toBe("readonly"), { timeout: 10000 });
    const t0 = Date.now();
    while (marks(E(phone)) && Date.now() - t0 < 60000) await phone.rtl.act(async () => { await later(20); });
    expect(marks(E(phone))).toBe(0);
    expect(sig(E(phone))).toEqual(ref);
    expect((await push(phone)).ok).toBe(true);
    await waitFor(() => expect(marks(E(laptop))).toBe(0), { timeout: 10000 });
    expect(sig(E(laptop))).toEqual(ref);
    expect(laptopBakes.n).toBe(0);
    unmount(phone); unmount(laptop);
});
