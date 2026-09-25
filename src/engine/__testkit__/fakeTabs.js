/**
 * fakeTabs.js — Web Locks and BroadcastChannel for jsdom, which has neither (SYNC-PLAN R2 tests).
 * One `makeLocks()` is one device's lock manager (share it between that device's tabs); one
 * `makeChannelBus()` is one device's channel namespace. Never imported by product code.
 */

const abortError = () => Object.assign(new Error("The lock request was aborted"), { name: "AbortError" });

/** `navigator.locks`, exclusive mode only: `request(name, { ifAvailable, steal, signal }, cb)`. */
export function makeLocks() {
    const held = new Map();       // name -> { stolen, reject }
    const queues = new Map();     // name -> [waiter]
    const queueOf = (name) => { if (!queues.has(name)) queues.set(name, []); return queues.get(name); };
    function release(name, entry) {
        if (held.get(name) !== entry) return;
        held.delete(name);
        const next = queueOf(name).shift();
        if (next) grant(name, next);
    }
    function grant(name, w) {
        const entry = { stolen: false, reject: w.reject };
        held.set(name, entry);
        // The callback runs as a later TASK, as in Chrome: an abort after the grant changes nothing.
        new Promise((r) => setTimeout(r, 0))
            .then(() => w.cb({ name, mode: "exclusive" }))
            .then((v) => { if (!entry.stolen) { release(name, entry); w.resolve(v); } },
                (e) => { if (!entry.stolen) { release(name, entry); w.reject(e); } });
    }
    return {
        request(name, opts, cb) {
            if (typeof opts === "function") { cb = opts; opts = {}; }
            opts = opts || {};
            return new Promise((resolve, reject) => {
                const w = { cb, resolve, reject };
                const q = queueOf(name);
                if (opts.steal) {
                    const cur = held.get(name);
                    if (cur) { cur.stolen = true; held.delete(name); cur.reject(abortError()); }
                    grant(name, w);
                    return;
                }
                if (held.has(name) || q.length) {
                    if (opts.ifAvailable) { Promise.resolve().then(() => cb(null)).then(resolve, reject); return; }
                    if (opts.signal) {
                        if (opts.signal.aborted) { reject(abortError()); return; }
                        opts.signal.addEventListener("abort", () => {
                            const i = q.indexOf(w);
                            if (i >= 0) { q.splice(i, 1); reject(abortError()); }
                        });
                    }
                    q.push(w);
                    return;
                }
                grant(name, w);
            });
        },
        isHeld: (name) => held.has(name),
        queued: (name) => queueOf(name).length,
    };
}

/** A BroadcastChannel class whose instances of one name hear each other (not themselves), asynchronously. */
export function makeChannelBus() {
    const members = new Map();
    return class FakeChannel {
        constructor(name) {
            this.name = name;
            this.onmessage = null;
            this.closed = false;
            if (!members.has(name)) members.set(name, new Set());
            members.get(name).add(this);
        }
        postMessage(data) {
            if (this.closed) throw new Error("channel closed");
            const copy = JSON.parse(JSON.stringify(data));
            for (const m of members.get(this.name) || []) {
                if (m === this) continue;
                setTimeout(() => { if (!m.closed && m.onmessage) m.onmessage({ data: copy }); }, 0);
            }
        }
        close() {
            this.closed = true;
            const s = members.get(this.name);
            if (s) s.delete(this);
        }
    };
}
