/**
 * The first-view pictures in the cloud (OPEN-FLAGS F166) against the fake Firestore: a set saved and read back whole,
 * a set read mid-write refused, a smaller set leaving no stale parts, a canvas deleted with its sets; and the session's
 * upload after a push: stamped with the head its document is, never for another seq, once per set, the background
 * sync's at most every viewsMinMs, and only by the editor holding the pen.
 */
import { fake } from "../engine/__testkit__/fakeFirestore";
import { cloudSaveViews, cloudLoadViews, cloudDeleteCanvas } from "./canvasSync";
import { CanvasSession } from "./canvasSession";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("./firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));
beforeEach(() => fake.reset());

const UID = "u1", ID = "c1", TAG = "p0badf00d";
const VIEWS = `users/${UID}/dev-canvases/${ID}/views/`;
const part = (n, fill) => new Uint8Array(n).fill(fill);
const stamp = { v: 1, build: "b", print: "{}", head: { epoch: "e1", seq: 7 } };

describe("CV — the sets in Firestore", () => {
    test("CV-1 a set saved reads back whole; a part from another write refuses it", async () => {
        await cloudSaveViews(UID, ID, TAG, { stamp, parts: [part(100, 1), part(60, 2)] });
        const got = await cloudLoadViews(UID, ID, TAG);
        expect(got.stamp).toEqual(stamp);
        expect(got.parts.map((p) => [p.length, p[0]])).toEqual([[100, 1], [60, 2]]);
        expect(await cloudLoadViews(UID, ID, "pother")).toBeNull();
        fake.docs.get(VIEWS + TAG + "~1").data.nonce = "torn";     // a reader between a part and its head
        expect(await cloudLoadViews(UID, ID, TAG)).toBeNull();
    });

    test("CV-2 a smaller set leaves no stale parts; a canvas deleted takes its sets", async () => {
        await cloudSaveViews(UID, ID, TAG, { stamp, parts: [part(10, 1), part(10, 2), part(10, 3)] });
        await cloudSaveViews(UID, ID, TAG, { stamp, parts: [part(10, 4)] });
        expect(fake.paths(VIEWS)).toEqual([VIEWS + TAG, VIEWS + TAG + "~0"]);
        expect((await cloudLoadViews(UID, ID, TAG)).parts[0][0]).toBe(4);
        await cloudSaveViews(UID, ID, "pdesk", { stamp, parts: [part(10, 5)] });
        await cloudDeleteCanvas(UID, ID);
        expect(fake.paths(VIEWS)).toEqual([]);
    });
});

/** A session holding the pen, its editor's set `set()` (or null). */
const session = (now, set) => {
    const s = Object.create(CanvasSession.prototype);
    Object.assign(s, {
        stopped: false, hasLock: true, uid: UID, id: ID, gen: 1, epoch: "e", discarded: false,
        state: { mode: "editing", cloud: "saved" }, o: { viewsMinMs: 120000, pushDeadlineMs: 60000 },
        env: { visible: () => true, now: () => now.t }, editor: { firstView: () => set() }, onPerf: () => {},
    });
    s._set = () => {};
    cur = s;
    return s;
};
/** Until the session's upload, if one started, has settled. */
let cur = null;
const settle = async () => { for (let k = 0; k < 200 && (k < 2 || (cur && cur._viewsBusy)); k++) await new Promise((r) => setTimeout(r, 0)); };

describe("CV — the session's upload", () => {
    test("CV-3 stamped with the head of the push that sent its document; never for another seq; once per set", async () => {
        const now = { t: 1000 };
        let set = { seq: 7, tag: TAG, stamp: { v: 1, build: "b", print: "{}" }, parts: [part(8, 9)], sig: "s1", cells: 1 };
        const s = session(now, () => set);
        s._pushViews(s._viewsNow(), { epoch: "e2", seq: 8, col: "dev-canvases" }, "save");   // the push sent seq 8: not this set's
        await settle();
        expect(fake.paths(VIEWS)).toEqual([]);
        s._pushViews(s._viewsNow(), { epoch: "e2", seq: 7, col: "dev-canvases" }, "save");
        await settle();
        expect((await cloudLoadViews(UID, ID, TAG)).stamp).toEqual({ v: 1, build: "b", print: "{}", head: { epoch: "e2", seq: 7 } });
        const writes = fake.paths(VIEWS).map((p) => fake.docs.get(p).data.nonce).join();
        s._pushViews(s._viewsNow(), { epoch: "e2", seq: 7 }, "hide");                         // the same set: nothing goes up
        await settle();
        expect(fake.paths(VIEWS).map((p) => fake.docs.get(p).data.nonce).join()).toBe(writes);
        set = { ...set, sig: "s2" };                                                           // the camera moved
        s._pushViews(s._viewsNow(), { epoch: "e2", seq: 7 }, "hide");
        await settle();
        expect(fake.paths(VIEWS).map((p) => fake.docs.get(p).data.nonce).join()).not.toBe(writes);
    });

    test("CV-4 after a background sync at most every viewsMinMs; never by a read-only editor", async () => {
        const now = { t: 1000 };
        let n = 0;
        const s = session(now, () => ({ seq: 3, tag: TAG, stamp: { v: 1 }, parts: [part(4, 1)], sig: "s" + ++n, cells: 1 }));
        const head = { epoch: "e", seq: 3 };
        const saves = () => fake.paths(VIEWS).length ? fake.docs.get(VIEWS + TAG).data.nonce : null;
        s._pushViews(s._viewsNow(), head, "sync");
        await settle();
        const first = saves();
        expect(first).not.toBeNull();
        now.t += 60000;
        s._pushViews(s._viewsNow(), head, "sync");
        await settle();
        expect(saves()).toBe(first);
        now.t += 61000;
        s._pushViews(s._viewsNow(), head, "sync");
        await settle();
        const second = saves();
        expect(second).not.toBe(first);
        s.state = { mode: "readonly", why: "device" };
        s._pushViews(s._viewsNow(), head, "hide");
        await settle();
        expect(saves()).toBe(second);
    });
});
