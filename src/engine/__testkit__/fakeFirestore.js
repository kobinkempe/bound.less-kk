/**
 * fakeFirestore.js — an in-memory stand-in for the parts of `firebase/firestore` (v9 modular)
 * the app uses, for jsdom tests of the cloud sync. Never imported by product code.
 *
 *   jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
 *   jest.mock("./firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));
 *
 * One backend per test process (`fake`), shared by every simulated device: a device is a
 * deviceId/tab passed to the code under test, and at most a second copy of the modules. Documents are deep-copied on
 * the way in and out. Transactions are optimistic like the real one: reads must come before
 * writes, and a document read that changed before the commit re-runs the function (5 tries).
 * `fake.writes` records every write path (the R7 check); `fake.faults` injects failures.
 */

/* global globalThis */
class Bytes {
    constructor(u8) { this._u8 = new Uint8Array(u8); }
    static fromUint8Array(u8) { return new Bytes(u8); }
    toUint8Array() { return new Uint8Array(this._u8); }
}

// By shape, not `instanceof`: a second device's copy of this module has its own Bytes class.
const isBytes = (v) => !!v && v._u8 instanceof Uint8Array && typeof v.toUint8Array === "function";
const clone = (v) => {
    if (isBytes(v)) return new Bytes(v._u8);
    if (Array.isArray(v)) return v.map(clone);
    if (v && typeof v === "object") {
        const o = {};
        for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = clone(v[k]);
        return o;
    }
    return v;
};

function makeError(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
}

class Backend {
    constructor() { this.reset(); }
    reset() {
        // What a gate still holds fails rather than writing into the next test's cloud (a push the
        // test left held would otherwise block the page's push lane for good).
        this.generation = (this.generation || 0) + 1;
        for (const g of this.gates || []) g.release();
        this.docs = new Map();          // path -> { data, version }
        this.version = 0;
        this.writes = [];               // { kind, path } in commit order
        this.reads = 0;
        this.offline = false;
        this.faults = [];               // { when(kind, paths) -> bool, error, once }
        this.afterFaults = [];          // the same, thrown after the commit applied
        this.listeners = new Map();     // path -> Set(cb)
        this.gates = [];                // { when(kind, path), promise }: reads and commits wait on them
        this.beforeTransactionCommit = null;
        this.commits = 0;
        this.db = { _fake: this };
    }
    _check(kind, paths) {
        if (this.offline) throw makeError("unavailable", "fake firestore: offline");
        for (let i = 0; i < this.faults.length; i++) {
            const f = this.faults[i];
            if (f.when(kind, paths)) {
                if (f.once !== false) this.faults.splice(i, 1);
                throw typeof f.error === "function" ? f.error() : (f.error || makeError("aborted", "fake firestore: injected fault"));
            }
        }
    }
    /** Fail the next operation `when(kind, paths)` accepts; kind is "get", "commit" or "transaction". */
    failNext(when, error) { this.faults.push({ when, error, once: true }); }
    /**
     * Hold the reads ("get") and commits ("commit") `when(kind, path)` accepts until the returned
     * function is called; `count` of them at most (the rest pass).
     */
    gate(when, count = Infinity) {
        let release;
        const promise = new Promise((r) => { release = r; });
        const g = { when, promise, left: count, release };
        this.gates.push(g);
        return () => { this.gates = this.gates.filter((x) => x !== g); release(); };
    }
    async _wait(kind, paths) {
        const gen = this.generation;
        for (const g of [...this.gates]) {
            if (g.left > 0 && paths.some((p) => g.when(kind, p))) { g.left -= 1; await g.promise; }
        }
        if (this.generation !== gen) throw makeError("cancelled", "fake firestore: reset while held");
    }
    /** The next commit `when` accepts LANDS and then throws, as a commit whose reply was lost. */
    failAfterNext(when, error) { this.afterFaults.push({ when, error }); }
    _checkAfter(paths) {
        for (let i = 0; i < this.afterFaults.length; i++) {
            const f = this.afterFaults[i];
            if (f.when("commit", paths)) { this.afterFaults.splice(i, 1); throw f.error || makeError("unavailable", "fake firestore: the reply was lost"); }
        }
    }
    get(path) {
        this.reads += 1;
        const d = this.docs.get(path);
        return d ? { data: clone(d.data), version: d.version } : { data: null, version: 0 };
    }
    // Applies a list of { kind: set|update|delete, path, data, merge } atomically.
    apply(ops) {
        const touched = new Set();
        for (const op of ops) {
            const cur = this.docs.get(op.path);
            if (op.kind === "delete") this.docs.delete(op.path);
            else if (op.kind === "update") {
                if (!cur) throw makeError("not-found", `fake firestore: no document to update: ${op.path}`);
                this.docs.set(op.path, { data: { ...cur.data, ...clone(op.data) }, version: ++this.version });
            } else if (op.merge && cur) this.docs.set(op.path, { data: mergeDeep(cur.data, clone(op.data)), version: ++this.version });
            else this.docs.set(op.path, { data: clone(op.data), version: ++this.version });
            this.writes.push({ kind: op.kind, path: op.path });
            touched.add(op.path);
        }
        this.commits += 1;
        for (const p of touched) this._notify(p);
    }
    _notify(path) {
        const set = this.listeners.get(path);
        if (!set) return;
        for (const cb of [...set]) setTimeout(() => { if (set.has(cb)) cb(); }, 0);
    }
    /** Every document path under `prefix` (a collection path), for assertions. */
    paths(prefix = "") { return [...this.docs.keys()].filter((p) => p.startsWith(prefix)).sort(); }
    data(path) { const d = this.docs.get(path); return d ? clone(d.data) : null; }
}

function mergeDeep(a, b) {
    const out = { ...a };
    for (const k of Object.keys(b)) {
        const v = b[k];
        out[k] = v && typeof v === "object" && !Array.isArray(v) && !isBytes(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])
            ? mergeDeep(a[k], v) : v;
    }
    return out;
}

// On the global object, so a second copy of the modules (a second simulated device, loaded with
// jest.isolateModules) talks to the same cloud.
export const fake = globalThis.__fakeFirestoreBackend || (globalThis.__fakeFirestoreBackend = new Backend());

// This module instance's connection: a second device (a jest.isolateModules copy) has its own,
// so one device can be offline while the other is not.
export const client = { offline: false };
const offline = () => makeError("unavailable", "fake firestore: this client is offline");

/**
 * The client's write stream (memory firestore-write-stream): batches, sets, updates and deletes
 * queue on it; transactions go by RPC and do not. `latencyMs` holds each commit on the stream,
 * `limit` is how many may queue before the real backend answers "Write stream exhausted maximum
 * allowed queued writes" — here each one past it is counted in `exhausted`, never thrown (the SDK
 * backs off and retries). `maxInFlight`, `maxBytes` (the largest commit's Bytes) and `rpcDuring`
 * (transaction commits while the stream was busy) are for assertions.
 */
client.stream = {
    reset({ latencyMs = 0, limit = Infinity } = {}) {
        Object.assign(this, { latencyMs, limit, inFlight: 0, maxInFlight: 0, exhausted: 0, maxBytes: 0, commits: 0, rpcDuring: 0 });
        return this;
    },
};
client.stream.reset();
const bytesOf = (v) => {
    if (isBytes(v)) return v._u8.length;
    if (Array.isArray(v)) return v.reduce((n, x) => n + bytesOf(x), 0);
    if (v && typeof v === "object") return Object.values(v).reduce((n, x) => n + bytesOf(x), 0);
    return 0;
};
async function onStream(ops, commit) {
    const S = client.stream;
    S.inFlight += 1; S.commits += 1;
    S.maxInFlight = Math.max(S.maxInFlight, S.inFlight);
    if (S.inFlight > S.limit) S.exhausted += 1;
    S.maxBytes = Math.max(S.maxBytes, ops.reduce((n, o) => n + bytesOf(o.data), 0));
    try {
        if (S.latencyMs) await new Promise((r) => setTimeout(r, S.latencyMs));
        return await commit();
    } finally { S.inFlight -= 1; }
}

const joinPath = (parts) => parts.map(String).join("/");
const backendOf = (x) => (x && x._fake) || (x && x.db && x.db._fake) || fake;

class DocSnap {
    constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; }
    exists() { return this._data != null; }
    data() { return this._data == null ? undefined : clone(this._data); }
    get(k) { return this._data ? clone(this._data[k]) : undefined; }
}

export const sdk = {
    Bytes,
    getFirestore: () => fake.db,
    collection: (db, ...parts) => ({ type: "collection", db, path: joinPath(parts), id: String(parts[parts.length - 1]) }),
    doc: (db, ...parts) => {
        const base = db && db.type === "collection" ? [db.path, ...parts] : parts;
        const path = joinPath(base);
        return { type: "document", db: db && db.type === "collection" ? db.db : db, path, id: path.split("/").pop() };
    },
    async getDoc(ref) {
        if (client.offline) throw offline();
        const B = backendOf(ref.db);
        await B._wait("get", [ref.path]);
        B._check("get", [ref.path]);
        return new DocSnap(ref, B.get(ref.path).data);
    },
    async getDocs(col) {
        if (client.offline) throw offline();
        const B = backendOf(col.db);
        B._check("get", [col.path]);
        const depth = col.path.split("/").length + 1;
        const docs = [];
        for (const p of B.paths(col.path + "/")) {
            if (p.split("/").length !== depth) continue;
            const ref = sdk.doc(col.db, p);
            docs.push(new DocSnap(ref, B.get(p).data));
        }
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
    },
    async setDoc(ref, data, opts = {}) {
        if (client.offline) throw offline();
        const B = backendOf(ref.db);
        const ops = [{ kind: "set", path: ref.path, data, merge: !!opts.merge }];
        return onStream(ops, () => { B._check("commit", [ref.path]); B.apply(ops); });
    },
    async updateDoc(ref, data) {
        if (client.offline) throw offline();
        const B = backendOf(ref.db);
        const ops = [{ kind: "update", path: ref.path, data }];
        return onStream(ops, () => { B._check("commit", [ref.path]); B.apply(ops); });
    },
    async deleteDoc(ref) {
        if (client.offline) throw offline();
        const B = backendOf(ref.db);
        const ops = [{ kind: "delete", path: ref.path }];
        return onStream(ops, () => { B._check("commit", [ref.path]); B.apply(ops); });
    },
    writeBatch(db) {
        const ops = [];
        const B = backendOf(db);
        return {
            set(ref, data, opts = {}) { ops.push({ kind: "set", path: ref.path, data: clone(data), merge: !!opts.merge }); return this; },
            update(ref, data) { ops.push({ kind: "update", path: ref.path, data: clone(data) }); return this; },
            delete(ref) { ops.push({ kind: "delete", path: ref.path }); return this; },
            async commit() {
                await null;
                return onStream(ops, async () => {
                    await B._wait("commit", ops.map((o) => o.path));
                    if (client.offline) throw offline();
                    B._check("commit", ops.map((o) => o.path));
                    B.apply(ops);
                    B._checkAfter(ops.map((o) => o.path));
                });
            },
        };
    },
    async runTransaction(db, fn) {
        const B = backendOf(db);
        for (let attempt = 0; attempt < 5; attempt++) {
            if (client.offline) throw offline();
            B._check("transaction", []);
            const seen = new Map();
            const ops = [];
            const t = {
                async get(ref) {
                    if (ops.length) throw makeError("invalid-argument", "fake firestore: a transaction must read before it writes");
                    const r = B.get(ref.path);
                    seen.set(ref.path, r.version);
                    return new DocSnap(ref, r.data);
                },
                set(ref, data, opts = {}) { ops.push({ kind: "set", path: ref.path, data: clone(data), merge: !!opts.merge }); return t; },
                update(ref, data) { ops.push({ kind: "update", path: ref.path, data: clone(data) }); return t; },
                delete(ref) { ops.push({ kind: "delete", path: ref.path }); return t; },
            };
            const out = await fn(t);
            await null;   // another client may commit between the function and this one's commit
            await B._wait("commit", ops.map((o) => o.path));
            if (B.beforeTransactionCommit) await B.beforeTransactionCommit();
            let stale = false;
            for (const [p, v] of seen) { const d = B.docs.get(p); if ((d ? d.version : 0) !== v) stale = true; }
            if (stale) continue;
            B._check("commit", ops.map((o) => o.path));
            if (ops.length && client.stream.inFlight > 0) client.stream.rpcDuring += 1;
            if (ops.length) { B.apply(ops); B._checkAfter(ops.map((o) => o.path)); }
            return out;
        }
        throw makeError("aborted", "fake firestore: transaction contention");
    },
    onSnapshot(ref, onNext, onError) {
        const B = backendOf(ref.db);
        let set = B.listeners.get(ref.path);
        if (!set) { set = new Set(); B.listeners.set(ref.path, set); }
        const cb = () => {
            if (B.offline || client.offline) return;   // an offline client hears nothing until it is back
            const d = B.docs.get(ref.path);
            onNext(new DocSnap(ref, d ? clone(d.data) : null));
        };
        set.add(cb);
        setTimeout(() => { if (set.has(cb)) cb(); }, 0);
        return () => set.delete(cb);
    },
};
