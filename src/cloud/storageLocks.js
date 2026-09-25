/**
 * storageLocks.js — the part of `navigator.locks` the session uses (exclusive; `ifAvailable`,
 * `steal`, `signal`), over localStorage, for a browser without Web Locks: the dev server reached
 * by LAN IP over http is not a secure context, and Safari before 15.4 has none (SYNC-PLAN R2).
 *
 * A lock is a key `boundless.lock.<name>` holding `{ owner, at }`, renewed every heartbeat while
 * held; a key not renewed for `staleMs` is free (a crashed tab). A page going away (`pagehide`: a
 * reload, a close) removes its keys at once, so its reload takes the lock straight back (Kobin
 * 2026-09-23: 10 s read-only after every reload on the phone). localStorage has no compare-and-set,
 * so a taker writes its owner, waits `settleMs` and reads it back: the last writer holds it, the
 * others wait. A holder that finds another owner in its key was stolen from.
 */
const abortError = () => Object.assign(new Error("The lock request was aborted"), { name: "AbortError" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeStorageLocks({ storage = typeof localStorage !== "undefined" ? localStorage : null, heartbeatMs = 1000, staleMs = 10000, pollMs = 250, settleMs = 60, now = () => Date.now(), target = typeof window !== "undefined" ? window : null } = {}) {
    const key = (name) => `boundless.lock.${name}`;
    const read = (name) => { try { return JSON.parse(storage.getItem(key(name)) || "null"); } catch (err) { return null; } };
    const write = (name, owner) => { try { storage.setItem(key(name), JSON.stringify({ owner, at: now() })); } catch (err) { /* quota */ } };
    const isFree = (v) => !v || !(now() - v.at <= staleMs);
    const held = new Map();   // owner -> name, while this page holds it
    if (target && target.addEventListener) {
        target.addEventListener("pagehide", () => {
            for (const [owner, name] of held) { const v = read(name); if (v && v.owner === owner) { try { storage.removeItem(key(name)); } catch (err) { /* gone */ } } }
        });
    }
    return {
        request(name, opts, cb) {
            if (typeof opts === "function") { cb = opts; opts = {}; }
            opts = opts || {};
            const owner = Math.random().toString(36).slice(2) + now().toString(36);
            return new Promise((resolve, reject) => {
                let beat = null;
                let over = false;
                const end = (fn, v) => { if (over) return; over = true; clearInterval(beat); held.delete(owner); fn(v); };
                const letGo = () => { const v = read(name); if (v && v.owner === owner) { try { storage.removeItem(key(name)); } catch (err) { /* gone */ } } };
                const granted = () => {
                    held.set(owner, name);
                    beat = setInterval(() => {
                        const v = read(name);
                        if (!v || v.owner !== owner) { end(reject, abortError()); return; }   // stolen
                        write(name, owner);
                    }, heartbeatMs);
                    Promise.resolve()
                        .then(() => cb({ name, mode: "exclusive" }))
                        .then((v) => { if (!over) letGo(); end(resolve, v); }, (e) => { if (!over) letGo(); end(reject, e); });
                };
                const attempt = async () => {
                    if (over) return;
                    if (opts.signal && opts.signal.aborted) { end(reject, abortError()); return; }
                    if (opts.steal || isFree(read(name))) {
                        write(name, owner);
                        await sleep(settleMs);
                        if (opts.signal && opts.signal.aborted) { letGo(); end(reject, abortError()); return; }
                        const v = read(name);
                        if (v && v.owner === owner) { granted(); return; }
                    }
                    if (opts.ifAvailable) {
                        over = true;
                        Promise.resolve().then(() => cb(null)).then(resolve, reject);
                        return;
                    }
                    setTimeout(attempt, pollMs);
                };
                if (opts.signal) opts.signal.addEventListener("abort", () => { if (!beat) end(reject, abortError()); });
                attempt();
            });
        },
    };
}
