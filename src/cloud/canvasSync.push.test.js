/**
 * SYNC-PLAN R1–R3 against the fake Firestore: the lease transactions, the push that never
 * overwrites (head and lease checked in the manifest's transaction, parts named by epoch, a torn
 * push swept), and the fast-forward pull. Each simulated device keeps its store in memory here;
 * the IndexedDB side has its own suite (storage/localCanvases.sync.test.js).
 */
import zlib from "zlib";
import { fake, client } from "../engine/__testkit__/fakeFirestore";
import { setCompression } from "./gzip";
import { encodeRecords, encodeEntry } from "../engine/format2";
import {
    cloudPushCanvas2, cloudPullCanvas2, cloudTakeLease, cloudRenewLease, cloudReleaseLease, cloudAskLease,
    cloudGetCanvasMeta, cloudSaveCanvas, SyncConflict, LeaseLost,
} from "./canvasSync";
import { headOf } from "./syncCore";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("./firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));

const nodeGzip = { name: "gz1", gzip: async (u8) => new Uint8Array(zlib.gzipSync(Buffer.from(u8))), gunzip: async (u8) => new Uint8Array(zlib.gunzipSync(Buffer.from(u8))) };
beforeAll(() => setCompression(nodeGzip));
afterAll(() => setCompression(null));
beforeEach(() => fake.reset());

const UID = "u1", ID = "c1";
const COL = "dev-canvases";
const MANIFEST = `users/${UID}/${COL}/${ID}`;
const shape = (id, x = 0) => ({ type: "shape", origin: "native", id, loops: [[x, 0, 1, x + 10, 0, 1, x + 10, 10, 1, x, 10, 1, x, 0]], color: "#123456", opacity: 1, w: 3 });
const stroke = (id) => ({ type: "stroke", origin: "native", id, pts: [[0, 0], [1, 2], [3, 3]], lwFrame: 2, color: "#000", opacity: 1 });

// One device's store, in memory: what localCanvases.cloudPushSource / applyPulledStore do on IndexedDB.
class Mem {
    constructor(name) { this.name = name; this.header = null; this.frames = {}; this.log = []; }
    init(seq = 3) {
        const f = encodeRecords([shape(1), shape(2, 20)]);
        this.frames = { 0: { objects: f.objects, geo: f.geo, seq } };
        this.log = [];
        this.header = { format: "boundless-drawing", version: 1, meta: { name: "A" }, camera: null, crossings: {}, name: "A", strokes: 2, levels: 1, seq, frameSeq: { 0: seq }, frameIds: ["0"] };
        return this;
    }
    draw(n = 1) {
        for (let i = 0; i < n; i++) {
            const seq = this.header.seq + 1;
            const e = encodeEntry({ k: "add", level: "0", index: 0, obj: stroke(1000 + seq) });
            this.log.push({ seq, t: seq, op: e.op, geo: e.geo, touches: ["0"] });
            this.header.seq = seq;
        }
        return this;
    }
    resnapshot(fid = "0") {
        const f = encodeRecords([shape(1), shape(2, 20), shape(3, 40)]);
        this.frames[fid] = { objects: f.objects, geo: f.geo, seq: this.header.seq };
        this.header.frameSeq = { ...this.header.frameSeq, [fid]: this.header.seq };
        return this;
    }
    source() {
        return {
            header: JSON.parse(JSON.stringify(this.header)),
            readFrames: async (ids) => ids.map((fid) => ({ frameId: fid, ...this.frames[fid] })),
            readLog: async (from) => this.log.filter((e) => e.seq > from),
            setSync: async (patch) => {
                const { addPending, dropPending, ...rest } = JSON.parse(JSON.stringify(patch));
                Object.assign(this.header, rest);
                let list = this.header.pending || [];
                if (dropPending) list = list.filter((c) => !dropPending.includes(c.chunk));
                for (const c of addPending || []) if (!list.some((x) => x.chunk === c.chunk)) list = [...list, c];
                this.header.pending = list;
                return true;
            },
        };
    }
    apply(pulled) {
        const base = { ...pulled.head, col: COL };
        if (pulled.full) { this.frames = {}; this.log = []; }
        for (const [fid, f] of Object.entries(pulled.frames)) this.frames[fid] = f;
        for (const fid of Object.keys(this.frames)) if (!pulled.header.frameIds.includes(fid)) delete this.frames[fid];
        this.log = this.log.concat(pulled.entries.filter((e) => !this.log.some((x) => x.seq === e.seq)));
        this.header = { ...pulled.header, base, intent: null, pending: this.header ? this.header.pending : [] };
    }
}
const entryOf = (m) => ({ id: ID, name: m.header.name, strokes: m.header.strokes, levels: 1 });
const who = (device) => ({ device, tab: "t-" + device, name: device === "laptop" ? "Chrome on Windows" : "Safari on iPhone" });
const partPaths = () => fake.paths(`${MANIFEST}/parts/`);
const namedParts = () => {
    const m = fake.data(MANIFEST);
    const out = [];
    for (const f of Object.values(m.frames)) for (let i = 0; i < f.parts; i++) out.push(`${MANIFEST}/parts/${f.chunk}~${i}`);
    for (const c of m.log) for (let i = 0; i < c.parts; i++) out.push(`${MANIFEST}/parts/${c.chunk}~${i}`);
    return out.sort();
};
// The laptop creates the copy and holds the pen.
async function created(seq = 3) {
    const A = new Mem("laptop").init(seq);
    const lease = { ...who("laptop"), epoch: "eA", until: Date.now() + 90000 };
    await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", lease });
    return { A, epochA: "eA" };
}

describe("the lease (R2)", () => {
    test("taken, refused to another device, renewed, asked for, let go, taken", async () => {
        await created();
        const now = Date.now();
        const a = await cloudTakeLease(UID, ID, who("laptop"), { now });
        expect(a.ok).toBe(true);
        const b = await cloudTakeLease(UID, ID, who("phone"), { now });
        expect(b).toMatchObject({ ok: false, holder: { device: "laptop", name: "Chrome on Windows" } });
        expect((await cloudRenewLease(UID, ID, a.lease.epoch, { now })).ok).toBe(true);
        expect(await cloudRenewLease(UID, ID, "not-mine", { now })).toMatchObject({ ok: false, lost: true });
        const ask = await cloudAskLease(UID, ID, who("phone"), { now });
        expect(ask).toMatchObject({ ok: false, asked: true });
        const renew = await cloudRenewLease(UID, ID, a.lease.epoch, { now });
        expect(renew.want).toMatchObject({ device: "phone", name: "Safari on iPhone" });
        expect(await cloudReleaseLease(UID, ID, a.lease.epoch)).toBe(true);
        const c = await cloudTakeLease(UID, ID, who("phone"), { now });
        expect(c.ok).toBe(true);
        expect(c.lease.epoch).not.toBe(a.lease.epoch);
        expect(await cloudRenewLease(UID, ID, a.lease.epoch, { now })).toMatchObject({ ok: false, lost: true });
    });

    test("an expired lease is free; a watched stale lease is taken only while it is still that lease", async () => {
        await created();
        const now = Date.now();
        const a = await cloudTakeLease(UID, ID, who("laptop"), { now });
        expect((await cloudTakeLease(UID, ID, who("phone"), { now: now + 91000, force: true })).ok).toBe(true);
        const L = fake.data(MANIFEST).lease;
        expect(L.device).toBe("phone");
        await cloudRenewLease(UID, ID, L.epoch, { now: now + 92000 });            // renewed after the watcher looked
        const stale = { epoch: L.epoch, until: L.until };
        expect((await cloudTakeLease(UID, ID, who("laptop"), { now, ifLease: stale })).ok).toBe(false);
        const fresh = fake.data(MANIFEST).lease;
        expect((await cloudTakeLease(UID, ID, who("laptop"), { now, ifLease: { epoch: fresh.epoch, until: fresh.until } })).ok).toBe(true);
        expect(a.ok).toBe(true);
    });

    test("a lease live by the holder's clock is not taken at open by a device whose clock runs ahead (review minor 11)", async () => {
        await created();
        const now = Date.now();
        await cloudTakeLease(UID, ID, who("laptop"), { now });
        expect((await cloudTakeLease(UID, ID, who("phone"), { now: now + 100000 })).ok).toBe(false);
        expect((await cloudAskLease(UID, ID, who("phone"), { now: now + 100000 })).ok).toBe(false);
        expect((await cloudTakeLease(UID, ID, who("phone"), { now: now + 10 * 60000 })).ok).toBe(true);   // dead for minutes
    });

    test("a lease let go to the asker is the asker's (review minor 10)", async () => {
        await created();
        const a = await cloudTakeLease(UID, ID, who("laptop"));
        await cloudAskLease(UID, ID, who("phone"));
        await cloudReleaseLease(UID, ID, a.lease.epoch, { to: "phone" });
        expect((await cloudTakeLease(UID, ID, who("tablet"))).ok).toBe(false);
        expect((await cloudTakeLease(UID, ID, who("phone"))).ok).toBe(true);
    });

    test("a lease let go to an asker who never takes it falls to a watcher naming it (the fallback, SYNC-PLAN §6)", async () => {
        await created();
        const a = await cloudTakeLease(UID, ID, who("laptop"));
        await cloudAskLease(UID, ID, who("phone"));
        await cloudReleaseLease(UID, ID, a.lease.epoch, { to: "phone" });
        const L = fake.data(MANIFEST).lease;
        expect((await cloudTakeLease(UID, ID, who("laptop"))).ok).toBe(false);          // reserved, even from the releaser
        expect((await cloudTakeLease(UID, ID, who("laptop"), { ifLease: { epoch: L.epoch, until: L.until } })).ok).toBe(true);
    });

    test("pushes from one page run one at a time, each part its own commit (memory firestore-write-stream)", async () => {
        const { A, epochA } = await created();
        const S = client.stream.reset({ latencyMs: 5, limit: 1 });
        A.draw(2).resnapshot();
        const B = new Mem("other").init(3);
        await Promise.all([
            cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: epochA }),
            cloudPushCanvas2(UID, { id: "c2", name: "B", strokes: 2, levels: 1 }, B.source(), { deviceId: "laptop", lease: { ...who("laptop"), epoch: "eB", until: Date.now() + 90000 } }),
            cloudSaveCanvas(UID, { id: "c3", name: "C" }, JSON.stringify({ format: "boundless-drawing", version: 1, natives: {} })),
        ]);
        expect(S.commits).toBeGreaterThan(4);
        expect(S.maxInFlight).toBe(1);
        expect(S.exhausted).toBe(0);
        expect(S.maxBytes).toBeLessThanOrEqual(700 * 1024);
        expect(fake.data(MANIFEST).head.seq).toBe(5);
    });

    test("a push whose tab lost the store stops at its next part, leaving the manifest alone", async () => {
        const { A, epochA } = await created();
        A.draw(2).resnapshot();                                   // a frame chunk and a log chunk: two parts
        const before = fake.data(MANIFEST);
        let alive = true;
        const src = { ...A.source(), alive: async () => alive };
        const partWrites = () => fake.writes.filter((w) => w.path.includes("/parts/") && w.kind === "set").length;
        const n0 = partWrites();
        const release = fake.gate((kind, path) => kind === "commit" && path.includes("/parts/"), 1);
        const p = cloudPushCanvas2(UID, entryOf(A), src, { deviceId: "laptop", epoch: epochA });
        await new Promise((r) => setTimeout(r, 20));
        alive = false;                                            // another tab of this page claimed the store
        release();
        await expect(p).rejects.toBeInstanceOf(LeaseLost);
        expect(partWrites() - n0).toBe(1);
        expect(fake.data(MANIFEST).head).toEqual(before.head);
    });

    test("a push whose commit never settles lets the lane go at its deadline, and writes nothing more (review minor 8)", async () => {
        const { A, epochA } = await created();
        A.draw(1);
        const partWrites = () => fake.writes.filter((w) => w.path.includes("/parts/") && w.kind === "set").length;
        const hold = fake.gate((kind, path) => kind === "commit" && path.includes(`${ID}/parts/`), 1);
        const stuck = cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: epochA, laneMs: 150 });
        stuck.catch(() => null);
        const B = new Mem("other").init(3);
        const other = await cloudPushCanvas2(UID, { id: "c2", name: "B", strokes: 2, levels: 1 }, B.source(), { deviceId: "laptop", lease: { ...who("laptop"), epoch: "eB", until: Date.now() + 90000 } });
        expect(other.head).toBeTruthy();                                   // not queued behind the stuck one for good
        const before = fake.data(MANIFEST).head;
        const n0 = partWrites();
        hold();                                                            // the stuck commit answers at last
        await expect(stuck).rejects.toThrow();
        expect(partWrites() - n0).toBe(1);                                 // the part on the wire lands; nothing after it
        expect(fake.data(MANIFEST).head).toEqual(before);
    });

    test("the lz1 writer marks progress per part, so the lane is not let go while it commits (review follow-up)", async () => {
        // 150 ms a part against a 400 ms stall deadline: each part well within it, the save longer than it.
        const S = client.stream.reset({ latencyMs: 150, limit: 1 });
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed; };
        let noise = "";
        while (noise.length < 1600000) noise += rnd().toString(36);   // compresses poorly: two parts
        const json = JSON.stringify({ format: "boundless-drawing", version: 1, natives: {}, noise });
        const B = new Mem("other").init(3);
        const old = cloudSaveCanvas(UID, { id: "c7", name: "Old" }, json, null, { laneMs: 400 });
        const next = cloudPushCanvas2(UID, { id: "c2", name: "B", strokes: 2, levels: 1 }, B.source(), { deviceId: "laptop", lease: { ...who("laptop"), epoch: "eB", until: Date.now() + 90000 } });
        const r = await old;
        await next;
        expect(r.parts).toBeGreaterThan(1);                                // longer than the deadline in all, each part well within it
        expect(S.maxInFlight).toBe(1);
        expect(S.exhausted).toBe(0);
    }, 30000);   // compressing 1.6 MB of noise takes seconds on a busy machine

    test("two devices taking at once: exactly one gets the pen", async () => {
        await created();
        await cloudReleaseLease(UID, ID, "eA");
        const now = Date.now();
        const [x, y] = await Promise.all([cloudTakeLease(UID, ID, who("laptop"), { now }), cloudTakeLease(UID, ID, who("phone"), { now })]);
        expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
        expect(fake.data(MANIFEST).lease.device).toBe(x.ok ? "laptop" : "phone");
    });

    test("no cloud copy and an lz1 copy have no lease", async () => {
        expect(await cloudTakeLease(UID, ID, who("laptop"))).toMatchObject({ ok: true, absent: true });
        fake.apply([{ kind: "set", path: MANIFEST, data: { codec: "lz1", parts: 1, name: "old" } }]);
        expect(await cloudTakeLease(UID, ID, who("laptop"))).toMatchObject({ ok: true, legacy: true });
    });
});

describe("the push never overwrites (R3)", () => {
    test("a first push creates the copy with the lease; the next sends only what the cloud lacks", async () => {
        const { A } = await created(3);
        const m = fake.data(MANIFEST);
        expect(m.head).toEqual({ epoch: "eA", seq: 3 });
        expect(m.lease.epoch).toBe("eA");
        expect(A.header.base).toEqual({ epoch: "eA", seq: 3, col: COL });
        expect(A.header.pending).toEqual([]);
        expect(A.header.intent).toBe(null);
        expect(partPaths().every((p) => /_eA_[a-z0-9]+~\d+$/.test(p))).toBe(true);   // every chunk carries the epoch and a nonce
        fake.writes = [];
        A.draw(2);
        const r = await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" });
        expect(r).toMatchObject({ frames: 0, entries: 2 });
        expect(fake.data(MANIFEST).head).toEqual({ epoch: "eA", seq: 5 });
        expect(fake.writes.filter((w) => w.path.includes("/parts/")).length).toBe(1);
        expect(partPaths()).toEqual(namedParts());
    });

    test("refused when the cloud moved past this device's base, before any part is written", async () => {
        const { A } = await created(3);
        const m = fake.data(MANIFEST);
        fake.apply([{ kind: "set", path: MANIFEST, data: { ...m, head: { epoch: "eB", seq: 9 }, seq: 9 } }]);
        fake.writes = [];
        A.draw(1);
        await expect(cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" })).rejects.toBeInstanceOf(SyncConflict);
        expect(fake.writes).toEqual([]);
        expect(fake.data(MANIFEST).head).toEqual({ epoch: "eB", seq: 9 });
    });

    test("refused when another device holds the lease", async () => {
        const { A } = await created(3);
        await cloudTakeLease(UID, ID, who("phone"), { force: true });
        fake.writes = [];
        A.draw(1);
        await expect(cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" })).rejects.toBeInstanceOf(LeaseLost);
        expect(fake.writes).toEqual([]);
    });

    test("the head moves between the plan and the manifest: refused in the transaction, its parts swept", async () => {
        const { A } = await created(3);
        A.draw(2);
        const m = fake.data(MANIFEST);
        fake.beforeTransactionCommit = async () => {
            fake.beforeTransactionCommit = null;
            fake.apply([{ kind: "set", path: MANIFEST, data: { ...fake.data(MANIFEST), head: { epoch: "eB", seq: 7 }, seq: 7 } }]);
        };
        await expect(cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" })).rejects.toBeInstanceOf(SyncConflict);
        expect(fake.data(MANIFEST).frames).toEqual(m.frames);
        expect(partPaths()).toEqual(namedParts());      // the refused push's log chunk is gone
        expect(A.header.pending).toEqual([]);
        expect(A.header.base).toEqual({ epoch: "eA", seq: 3, col: COL });
    });

    test("a push torn between its parts is swept by the next one", async () => {
        const { A } = await created(3);
        A.draw(2).resnapshot();                     // a frame chunk and a log chunk
        let n = 0;
        fake.failNext((kind, paths) => kind === "commit" && paths.some((p) => p.includes("/parts/")) && ++n === 2);
        await expect(cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" })).rejects.toThrow(/injected/);
        expect(A.header.pending.length).toBe(2);    // this push's frame chunk and log chunk
        expect(fake.data(MANIFEST).head.seq).toBe(3);
        const orphans = partPaths().filter((p) => !namedParts().includes(p));
        expect(orphans.length).toBe(1);
        A.draw(1);
        await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" });
        expect(partPaths()).toEqual(namedParts());
        expect(A.header.pending).toEqual([]);
        expect(fake.data(MANIFEST).head).toEqual({ epoch: "eA", seq: 6 });
    });

    test("a manifest commit whose reply is lost counts as landed (the head says so)", async () => {
        const { A } = await created(3);
        A.draw(1);
        fake.failAfterNext((kind, paths) => paths.includes(MANIFEST));
        const r = await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" });
        expect(r.head).toMatchObject({ epoch: "eA", seq: 4 });
        expect(A.header.base).toEqual({ epoch: "eA", seq: 4, col: COL });
        expect(partPaths()).toEqual(namedParts());
    });

    test("a torn push whose manifest landed before the tab closed: its intent is the next push's base", async () => {
        const { A } = await created(3);
        A.draw(1);
        const src = A.source();
        const orig = src.setSync;
        let calls = 0;
        src.setSync = async (patch) => { calls += 1; if (calls >= 2) throw new Error("tab closed"); return orig(patch); };
        await expect(cloudPushCanvas2(UID, entryOf(A), src, { deviceId: "laptop", epoch: "eA" })).rejects.toThrow(/tab closed/);
        expect(fake.data(MANIFEST).head).toEqual({ epoch: "eA", seq: 4 });
        expect(A.header.base).toEqual({ epoch: "eA", seq: 3, col: COL });  // never recorded
        A.draw(1);
        await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" });
        expect(fake.data(MANIFEST).head).toEqual({ epoch: "eA", seq: 5 });
        expect(partPaths()).toEqual(namedParts());
    });

    test("a push with no new ops keeps the head (a rename is not a new history)", async () => {
        const { A } = await created(3);
        await cloudReleaseLease(UID, ID, "eA");
        const t = await cloudTakeLease(UID, ID, who("laptop"));          // a new epoch, no new ops
        A.header.meta = { name: "B" };
        await cloudPushCanvas2(UID, { ...entryOf(A), name: "B" }, A.source(), { deviceId: "laptop", epoch: t.lease.epoch });
        const m = fake.data(MANIFEST);
        expect(m.head).toEqual({ epoch: "eA", seq: 3 });
        expect(m.name).toBe("B");
    });

    test("two devices in turn: a fast-forward pull fetches only what changed, and nobody's named parts are deleted", async () => {
        const { A } = await created(3);
        A.draw(2);
        await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" });
        // The phone has no copy: a whole pull.
        const B = new Mem("phone");
        const whole = await cloudPullCanvas2(UID, ID);
        expect(whole.full).toBe(true);
        B.header = { pending: [] };
        B.apply(whole);
        expect(B.header.seq).toBe(5);
        // The laptop lets go; the phone takes the pen, draws and pushes.
        await cloudReleaseLease(UID, ID, "eA");
        const t = await cloudTakeLease(UID, ID, who("phone"));
        B.draw(3);
        await cloudPushCanvas2(UID, entryOf(B), B.source(), { deviceId: "phone", epoch: t.lease.epoch });
        expect(headOf(fake.data(MANIFEST))).toEqual({ epoch: t.lease.epoch, seq: 8 });
        expect(partPaths()).toEqual(namedParts());
        expect(partPaths().some((p) => /_eA_[a-z0-9]+~/.test(p))).toBe(true);     // the laptop's frame chunk, still named
        // The laptop fast-forwards: no frame is fetched, only the phone's entries.
        const reads0 = fake.reads;
        const ff = await cloudPullCanvas2(UID, ID, { have: { frameSeq: A.header.frameSeq, seq: A.header.seq } });
        expect(ff.full).toBe(false);
        expect(Object.keys(ff.frames)).toEqual([]);
        expect(ff.entries.map((e) => e.seq)).toEqual([6, 7, 8]);
        expect(fake.reads - reads0).toBe(1 + 1);        // the manifest and one log part
        const all = await cloudPullCanvas2(UID, ID);
        expect(ff.logFloor).toBe(all.entries[0].seq);   // what a whole pull starts at: below it, a fast-forward drops (SAVE-3)
        A.apply(ff);
        expect(A.header.base).toEqual({ epoch: t.lease.epoch, seq: 8, col: COL });
        expect(A.log.map((e) => e.seq)).toEqual([4, 5, 6, 7, 8]);
        expect((await cloudGetCanvasMeta(UID, ID)).lease.device).toBe("phone");
    });

    test("the old lz1 writer refuses to write over a kobin-2 copy", async () => {
        await created(3);
        fake.writes = [];
        await expect(cloudSaveCanvas(UID, { id: ID, name: "A" }, "{}")).rejects.toBeInstanceOf(SyncConflict);
        expect(fake.writes).toEqual([]);
    });

    test("a retried push never reuses a failed push's part names (review major 3)", async () => {
        const { A } = await created(3);
        A.draw(1);
        fake.failNext((kind, paths) => kind === "commit" && paths.includes(MANIFEST));
        fake.writes = [];
        await expect(cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" })).rejects.toThrow(/injected/);
        const first = fake.writes.filter((w) => w.kind === "set" && w.path.includes("/parts/")).map((w) => w.path);
        expect(first.length).toBe(1);
        fake.writes = [];
        await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" });
        const second = fake.writes.filter((w) => w.kind === "set" && w.path.includes("/parts/")).map((w) => w.path);
        expect(second.length).toBe(1);
        expect(second[0]).not.toBe(first[0]);
        expect(partPaths()).toEqual(namedParts());
    });

    test("a push that uploads anything moves the head, even at the same seq (review minor 7)", async () => {
        const { A } = await created(3);
        const f = encodeRecords([shape(9, 90)]);
        A.frames[1] = { objects: f.objects, geo: f.geo, seq: 3 };
        A.header.frameIds = ["0", "1"];
        A.header.frameSeq = { ...A.header.frameSeq, 1: 3 };
        await cloudPushCanvas2(UID, entryOf(A), A.source(), { deviceId: "laptop", epoch: "eA" });
        const h = headOf(fake.data(MANIFEST));
        expect(h.seq).toBe(3);
        expect(h.epoch).not.toBe("eA");
        expect(A.header.base).toEqual({ ...h, col: COL });
    });

    test("a push never sends entries past the head it names", async () => {
        const { A } = await created(3);
        A.draw(2);
        const src = A.source();
        const legacy = { header: src.header, setSync: src.setSync,
            readFrames: async (ids) => ids.map((fid) => ({ frameId: fid, ...A.frames[fid] })),
            readLog: async (from) => A.log.filter((e) => e.seq > from) };
        A.draw(1);                                    // written after the header was read
        await cloudPushCanvas2(UID, entryOf(A), legacy, { deviceId: "laptop", epoch: "eA" });
        const m = fake.data(MANIFEST);
        expect(m.head.seq).toBe(5);
        expect(Math.max(...m.log.map((c) => c.seqTo))).toBe(5);
    });

    test("the old lz1 writer re-checks inside its transaction", async () => {
        let created2 = false;
        // Another device's kobin-2 copy lands meanwhile (written directly: that device has its own push lane).
        fake.beforeTransactionCommit = async () => {
            if (created2) return;
            created2 = true;
            fake.apply([{ kind: "set", path: MANIFEST, data: { format: "kobin-2", seq: 2, head: { epoch: "eP", seq: 2 }, frames: {}, log: [] } }]);
        };
        await expect(cloudSaveCanvas(UID, { id: ID, name: "A" }, "{}")).rejects.toBeInstanceOf(SyncConflict);
        fake.beforeTransactionCommit = null;
        expect(fake.data(MANIFEST).format).toBe("kobin-2");
    });

    test("a push whose tab lost the store before its parts stops, writing nothing", async () => {
        const { A } = await created(3);
        A.draw(1);
        const src = A.source();
        src.setSync = async () => "fenced";
        fake.writes = [];
        await expect(cloudPushCanvas2(UID, entryOf(A), src, { deviceId: "laptop", epoch: "eA" })).rejects.toBeInstanceOf(LeaseLost);
        expect(fake.writes).toEqual([]);
    });

    test("a gallery push refuses to write over a copy it does not know", async () => {
        const { A } = await created(3);
        const B = new Mem("phone").init(9);
        await expect(cloudPushCanvas2(UID, entryOf(B), B.source(), { deviceId: "phone" })).rejects.toBeInstanceOf(SyncConflict);
        expect(headOf(fake.data(MANIFEST))).toEqual({ epoch: "eA", seq: 3 });
        expect(A.header.base.seq).toBe(3);
    });
});
