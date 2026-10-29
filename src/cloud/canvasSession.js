/**
 * canvasSession.js — one open editor's part in "one editor at a time" (SYNC-PLAN R2–R9).
 *
 * WHO HAS THE PEN. On the device, the tab holding the Web Lock `boundless:canvas:<id>` (or, with
 * no Web Locks, the localStorage lock of storageLocks.js); in the cloud, the device whose `lease`
 * is on the manifest (canvasSync.js). A tab without the lock, or a device without the lease, is
 * READ-ONLY: the engine pans only, the saver writes nothing, and the view follows the holder
 * while visible (a same-device tab reloads the store when the holder says "saved" on the
 * BroadcastChannel; another device pulls the cloud head when the manifest changes). "Edit here"
 * asks the holder to save and let go — over the channel, or with the lease's `want` — and takes
 * the pen after a wait.
 *
 * THE FENCE. The lock alone does not stop a tab that has lost it but is still inside an `await`
 * (an open-time pull, a frozen tab thawing). So: every grant bumps a generation and claims the
 * store with a token (`claimStore`), every store write carries the token and is refused inside
 * its transaction when another tab has claimed since, every flow checks its generation after each
 * `await`, and a lost lock is handled synchronously. The saver is off (`setSaving(false)`) from
 * the grant until `_edit`, so nothing but the session writes while it replaces the store.
 *
 * WHAT IT DECIDES. At open and whenever the pen or the cloud head changes hands, `decideOpen`
 * (syncCore.js) compares the local base with the cloud head: fast-forward push, fast-forward
 * pull, or — both moved — this device's copy becomes a new canvas and the cloud copy stays this
 * one (R5). A local copy that cannot be kept blocks the pull. Work that cannot be written is
 * kept as a new canvas (`keepUnsaved`). Nothing is overwritten and nothing is discarded.
 *
 * `editor` is the hook's side (editorFromHook); `env` carries `locks`, `Channel`, `now` and
 * `visible` so tests can run two tabs and two devices in one jsdom.
 */
import {
    CANVAS_COLLECTION, cloudGetCanvasMeta, cloudPushCanvas2, cloudPullCanvas2, cloudLoadCanvas,
    cloudTakeLease, cloudRenewLease, cloudReleaseLease, cloudAskLease, cloudWatchManifest, cloudSaveViews, cloudListCanvases,
} from "./canvasSync";
import { limitedAccount, accountBytes, limitMessage } from "./cloudLimits";
import {
    getStoreHeader, setSyncState, applyPulledStore, forkCanvas, saveCanvasDoc, stashCanvasStore, claimStore,
    saveThumbs, upsertIndexEntry, readIndex, statsFromDoc, newCanvasId,
} from "../storage/localCanvases";
import { decideOpen, headOf, sameHead, leaseState, newEpoch, conflictName, LEASE_BEAT_MS, LEASE_TTL_MS, LEASE_SKEW_MS } from "./syncCore";
import { makeStorageLocks } from "./storageLocks";

export const SESSION_DEFAULTS = {
    beatMs: LEASE_BEAT_MS,          // lease renewal while visible
    ttlMs: LEASE_TTL_MS,            // lease lifetime; a follower takes a lease unchanged this long
    skewMs: LEASE_SKEW_MS,          // how far past a live lease's `until` it is free to anyone
    syncMs: 30000,                  // background push while dirty
    askMaxMs: 6 * 60000,            // "Edit here" on another device: forced after this even if the holder renews
    stealAfterMs: 5000,             // "Edit here" in another tab: the lock stolen after this silence
    openTimeoutMs: 4000,            // the manifest read at open; slower counts as offline
    openRetryMs: 20000,             // an open that failed is retried after this, doubling to 10 min
    pushDeadlineMs: 5 * 60000,      // the push's reported failure; busy holds until the SDK settles
    followMinMs: 2000,              // a follow reload at most this often...
    followCostFactor: 10,           // ...or ten times what the last reload cost, whichever is longer
    viewsMinMs: 2 * 60000,          // the first-view pictures after a background sync push at most this often
};

/** The session's `editor` from the hook's API (`get()` returns the latest; it is a new object each render). */
export function editorFromHook(get) {
    const h = () => get() || {};
    return {
        setReadOnly: (on) => { if (h().setReadOnly) h().setReadOnly(on); },
        setSaving: (on) => { if (h().setSaving) h().setSaving(on); },
        setWriter: (t) => { if (h().setWriter) h().setWriter(t); },
        flush: () => (h().flushSave ? h().flushSave() : Promise.resolve(true)),
        idle: () => (h().idle ? h().idle() : Promise.resolve(true)),
        reload: (o) => (h().reloadFromStore ? h().reloadFromStore(o) : Promise.resolve(null)),
        refreshMeta: () => (h().refreshMetaFromStore ? h().refreshMetaFromStore() : Promise.resolve(false)),
        hasUnsaved: () => !!(h().hasUnsaved && h().hasUnsaved()),
        keepUnsaved: (name) => (h().keepUnsaved ? h().keepUnsaved(name) : Promise.resolve(null)),
        firstView: () => (h().firstViewSet ? h().firstViewSet() : null),
        knownSeq: () => (h().knownSeq ? h().knownSeq() : null),
        pushSource: () => (h().cloudPushSource ? h().cloudPushSource() : Promise.resolve(null)),
        stats: () => (h().stats ? h().stats() : {}),
    };
}

const withTimeout = (p, ms, why) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error(why), { name: "Timeout" })), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});
const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const who = (s) => ({ device: s.deviceId, tab: s.tabId, name: s.deviceName });
// The gallery's name first; the engine's default "untitled" is never shown.
const shownName = (entry, local) => {
    const n = (entry && entry.name) || (local && local.name);
    return n && n !== "untitled" ? n : "Untitled canvas";
};
// An error that means "the cloud is out of reach" rather than "something is wrong".
const isNetwork = (err) => !!err && (err.name === "Timeout" || /unavailable|deadline|offline|network|failed to fetch/i.test(`${err.code || ""} ${err.message || ""}`));

export class CanvasSession {
    constructor({ canvasId, uid = null, deviceId, deviceName, tabId = newEpoch(), editor, getEntry = null, env = {}, opts = {}, onState = null, onNotice = null, onPerf = null }) {
        this.id = canvasId;
        this.uid = uid;
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.tabId = tabId;
        this.editor = editor;
        this.getEntry = getEntry || (() => readIndex().find((e) => e.id === canvasId) || null);
        const webLocks = env.locks !== undefined ? env.locks : (typeof navigator !== "undefined" && navigator.locks) || null;
        this.env = {
            locks: webLocks || makeStorageLocks(),
            Channel: env.Channel !== undefined ? env.Channel : (typeof BroadcastChannel !== "undefined" ? BroadcastChannel : null),
            now: env.now || (() => Date.now()),
            visible: env.visible || (() => typeof document === "undefined" || document.visibilityState !== "hidden"),
        };
        this.o = { ...SESSION_DEFAULTS, ...opts };
        this.onState = onState || (() => {});
        this.onNotice = onNotice || (() => {});
        this.onPerf = onPerf || (() => {});
        this.col = CANVAS_COLLECTION;
        this.lockName = `boundless:canvas:${canvasId}`;
        this.state = { mode: "starting", why: null, holder: null, cloud: uid ? "checking" : "off", error: null };
        this.gen = 0;                   // bumped at every grant and loss of the device lock
        this.token = null;              // the store's writer token while this tab holds the lock
        this.hasLock = false;
        this.epoch = null;              // the cloud lease this tab holds
        this.createLease = null;        // the lease the first push writes, when there is no cloud copy
        this.dirty = false;
        this.busy = null;               // settles when the push in flight settles, deadline or not
        this.fail = { count: 0, until: 0 };
        this.needOpen = false;          // the cloud open has to be (re)done: offline, or it failed
        this.openFails = 0;
        this.openRetryAt = 0;
        this.lastHead = null;
        this.lastReloadMs = 0;
        this.followAt = 0;
        this._followData = false;       // a same-device write moved data since the last follow reload
        this._following = false;        // a follow is running; one asked for meanwhile waits in _followNext
        this._followNext = null;
        this.stopped = false;
        this._timers = new Set();
        this._unwatch = null;
        this._channel = null;
        this._release = null;           // resolves the held lock
        this._held = null;              // the id of the request holding it
        this._queued = null;            // { id, ac, done } of a waiting request
        this._reqSeq = 0;
        this._chain = Promise.resolve();
    }

    // ---- lifecycle ----

    async start() {
        this._openChannel();
        const got = await this._requestLock({ wait: false });
        if (this.stopped) return;
        if (got) await this._holdDevice({ fromTab: false });
        else this._tabFollower();
    }

    /**
     * Leaving the editor: what was drawn in the last seconds goes to disk while this tab still
     * holds the store, then the last push, the lease let go, and the device lock released after
     * the whole write chain has landed.
     */
    async stop() {
        if (this.stopped || this._stopping) return;
        this._stopping = true;
        if (this.hasLock && (this.state.mode === "editing" || this.state.mode === "handing")) {
            try {
                const ok = await withTimeout(this.editor.flush(), 10000, "flush");
                if (!ok) await this._keepUnsaved();
            } catch (err) { /* released anyway */ }
        }
        this.stopped = true;
        for (const t of this._timers) { clearTimeout(t); clearInterval(t); }
        this._timers.clear();
        if (this._unwatch) { this._unwatch(); this._unwatch = null; }
        if (this._queued) { this._queued.ac.abort(); this._queued = null; }
        const epoch = this.epoch;
        const last = this.hasLock && this.state.mode === "editing" && this.dirty && !this.discarded ? this._push({ why: "leave", force: true }) : Promise.resolve();
        if (this.hasLock && !this.dirty) this._pushViews(this._viewsNow(), this.lastHead, "leave");
        if (this.uid && epoch) last.then(() => cloudReleaseLease(this.uid, this.id, epoch)).catch(() => {});
        try { await withTimeout(this.editor.idle(), 10000, "idle"); } catch (err) { /* released anyway */ }
        this._letGoOfLock();
        if (this._channel) { try { this._channel.close(); } catch (err) { /* closed */ } this._channel = null; }
    }

    // ---- what the editor tells the session ----

    /** The document changed: the cloud copy is behind. */
    markDirty() { this.dirty = true; }
    /**
     * The saver wrote the store (`seq` its last entry): same-device followers reload, or only read
     * the header when `data` is false (a camera, a name); the cloud is behind.
     */
    onLocalSaved(seq, { data = true } = {}) {
        this.dirty = true;
        this._post({ type: "saved", seq, data: data !== false });
    }
    /**
     * The saver's write was refused: another tab holds the store ("fenced") or it is ahead of this
     * document ("stale"). The work in memory is kept as a new canvas; then this tab follows.
     */
    onRefused(kind) {
        const g = this.gen;
        (async () => {
            await this._keepUnsaved();
            if (this.stopped || this.gen !== g) return;
            if (kind === "fenced") { if (this.hasLock) this._lockLost("fenced"); return; }
            this.editor.setSaving(false);
            this.lastReloadMs = (await this.editor.reload({ keepCamera: true })) || 0;
            if (this._live(g) && this.state.mode === "editing") this.editor.setSaving(true);
        })();
    }
    /** The tab was hidden or shown: a push on hide, a beat and any follow it owes on show. */
    onVisibility(visible) {
        if (visible) {
            const owed = this._followOwed;
            this._followOwed = null;
            if (owed) this._scheduleFollow(owed);
            this._beat();
            return;
        }
        if (this.state.mode === "editing" && this.dirty) this._push({ why: "hide" });
        else this._pushViews(this._viewsNow(), this.lastHead, "hide");
    }
    /** An explicit Save: push now. `{ ok, busy, err }`. */
    async pushNow({ thumbs = null } = {}) {
        if (!this.uid) return { ok: false, local: true };
        if (this.state.mode !== "editing") return { ok: false, readOnly: true };
        if (this.busy) return { ok: false, busy: true };
        this.dirty = true;
        return this._push({ why: "save", thumbs, force: true });
    }
    /** "Edit here" (R2): ask whoever has the pen to save and let go, then take it. */
    async takeOver() {
        if (this.stopped || this.state.mode === "editing" || this.state.mode === "taking" || this.state.mode === "starting") return;
        const why = this.state.why;
        this._set({ mode: "taking", error: null });
        if (why === "tab") {
            this._post({ type: "want", tab: this.tabId });
            this._after(this.o.stealAfterMs, () => { if (!this.hasLock && !this.stopped) this._stealLock(); });
            return;
        }
        this.asking = true;
        try {
            const r = await cloudAskLease(this.uid, this.id, who(this), { now: this.env.now(), ttl: this.o.ttlMs, skewMs: this.o.skewMs });
            if (r.ok) { this.asking = false; this.epoch = r.lease ? r.lease.epoch : null; this._serial(() => this._promote()); return; }
            // The holder saves, pushes and lets go while it keeps renewing; forced only if it goes
            // silent for a TTL (_maybeTake) or after askMaxMs.
            this._after(this.o.askMaxMs, () => { if (this.asking) this._takeLease(true); });
            this._watch();
        } catch (err) {
            this.asking = false;
            this._set({ mode: "readonly", error: "Couldn't reach the cloud to take over" });
        }
    }

    // ---- the device lock and the channel ----

    _openChannel() {
        const C = this.env.Channel;
        if (!C) return;
        try {
            this._channel = new C(this.lockName);
            this._channel.onmessage = (ev) => this._onMessage(ev && ev.data);
        } catch (err) { this._channel = null; }
    }
    _post(msg) {
        if (!this._channel) return;
        try { this._channel.postMessage({ ...msg, from: this.tabId }); } catch (err) { /* closed */ }
    }
    _onMessage(msg) {
        if (!msg || msg.from === this.tabId || this.stopped) return;
        if (msg.type === "want" && this.hasLock) this._handToTab();
        else if (msg.type === "saved" && !this.hasLock) {
            if (msg.data !== false) this._followData = true;   // owed until a reload runs, whatever comes after
            this._scheduleFollow(() => this._reloadFollow());
        }
    }
    // `wait` false: now or not at all; true: queued until the holder lets go; `steal`: now, whatever.
    _requestLock({ wait = false, steal = false }) {
        const locks = this.env.locks;
        const id = ++this._reqSeq;
        return new Promise((resolve) => {
            let granted = false;
            const opts = steal ? { steal: true } : wait ? {} : { ifAvailable: true };
            let q = null;
            if (wait) {
                if (this._queued) this._queued.ac.abort();
                let settle;
                q = { id, ac: new AbortController(), done: new Promise((r) => { settle = r; }) };
                q.settle = settle;
                opts.signal = q.ac.signal;
                this._queued = q;
            }
            const p = locks.request(this.lockName, opts, (lock) => {
                if (q) q.settle(lock ? "granted" : "none");
                // A grant is a later task: one that lands after stop(), or while this tab already
                // holds the lock by another request, is let go at once.
                if (!lock || this.stopped || this.hasLock) { resolve(false); return undefined; }
                granted = true;
                this._held = id;
                this.hasLock = true;
                if (this._queued === q) this._queued = null;
                resolve(true);
                return new Promise((release) => { this._release = release; });
            });
            p.catch(() => {
                if (q) q.settle("aborted");
                if (!granted) { resolve(false); return; }
                // Stolen: handled now, not behind the work queue (the review's major 1).
                if (this._held === id && this.hasLock && !this.stopped) this._lockLost("stolen");
            });
        });
    }
    // The lock and everything that rode on it, dropped at once: saving off, read-only, flows stale.
    _drop() {
        this.gen += 1;
        this.hasLock = false;
        this.token = null;
        this._held = null;
        this.editor.setSaving(false);
        this.editor.setReadOnly(true);
        this._stopCloud();
    }
    _letGoOfLock() {
        const r = this._release;
        this._release = null;
        if (this.hasLock) this._drop();
        if (r) r();
    }
    _lockLost(why) {
        const unsaved = this.editor.hasUnsaved();
        this._drop();
        this._release = null;
        this.epoch = null;
        this.onNotice({ kind: "stolen", message: "Editing moved to another tab" });
        (async () => {
            if (unsaved) await this._keepUnsaved();
            if (!this.stopped) this._tabFollower();
        })();
    }
    async _stealLock() {
        if (this.hasLock || this.stopped) return;
        const q = this._queued;
        if (q) {
            q.ac.abort();
            if ((await q.done) === "granted") return;       // this tab's own queued request won
        }
        if (this.hasLock || this.stopped) return;
        const got = await this._requestLock({ steal: true });
        if (got && !this.stopped) this._serial(() => this._holdDevice({ fromTab: true }));
    }

    // A tab without the lock: read-only, following the holder through the store, queued for the lock.
    _tabFollower() {
        this.editor.setReadOnly(true);
        this.editor.setSaving(false);
        this._set({ mode: "readonly", why: "tab", holder: null, cloud: this.uid ? "follow" : "off" });
        this._requestLock({ wait: true }).then((got) => {
            if (got && !this.stopped) this._serial(() => this._holdDevice({ fromTab: true }));
        });
    }
    _live(g) { return !this.stopped && this.hasLock && this.gen === g; }
    // This tab holds the device lock: it claims the store, catches up with it, and the cloud
    // decides whether it edits. The saver stays off until `_edit`.
    async _holdDevice({ fromTab }) {
        this.gen += 1;
        const g = this.gen;
        this.token = `${this.tabId}.${g}`;
        this.editor.setSaving(false);
        this.editor.setReadOnly(true);
        this.editor.setWriter(this.token);
        await claimStore(this.id, this.token);
        if (!this._live(g)) return;
        const stored = await getStoreHeader(this.id);
        if (!this._live(g)) return;
        if (fromTab || (stored && stored.store === "kobin-2" && (stored.seq || 0) !== this.editor.knownSeq())) {
            this.lastReloadMs = (await this.editor.reload({ keepCamera: true })) || 0;
            if (!this._live(g)) return;
            this.onNotice({ kind: "reloaded" });
        }
        if (!this.uid) { this._edit(g); return; }
        this._set({ mode: "starting", why: null, holder: null, cloud: "checking", error: null });
        this._every(this.o.beatMs, () => this._beat());
        this._every(this.o.syncMs, () => { if (this.dirty && this.state.mode === "editing") this._push({ why: "sync" }); });
        this._watch();
        await this._openCloud(g);
    }
    // Asked over the channel: save, let go of the lock, follow. Runs at once, not behind the queue.
    async _handToTab() {
        if (!this.hasLock || this._handingTab) return;
        this._handingTab = true;
        const g = this.gen;
        this._set({ mode: "handing" });
        this.editor.setReadOnly(true);
        try {
            const ok = await this.editor.flush();
            if (!ok) await this._keepUnsaved();
        } finally { this._handingTab = false; }
        if (this.gen !== g || this.stopped) return;         // lost meanwhile
        this.epoch = null;
        this._letGoOfLock();
        this._post({ type: "released" });
        this._tabFollower();
    }
    _stopCloud() {
        for (const t of this._timers) { clearTimeout(t); clearInterval(t); }
        this._timers.clear();
        this._followPending = false;    // its timer went with the rest: a later follow must be able to schedule
        if (this._unwatch) { this._unwatch(); this._unwatch = null; }
    }

    // ---- the cloud: open, lease, push, follow ----

    async _openCloud(g) {
        let manifest;
        try { manifest = await withTimeout(cloudGetCanvasMeta(this.uid, this.id), this.o.openTimeoutMs, "the cloud did not answer"); }
        catch (err) {
            if (!this._live(g)) return;
            this._offline(err); this.needOpen = true; this._edit(g);
            return;
        }
        if (!this._live(g)) return;
        let holder = null;
        try {
            if (manifest && manifest.format === "kobin-2") {
                const r = await cloudTakeLease(this.uid, this.id, who(this), { now: this.env.now(), ttl: this.o.ttlMs, skewMs: this.o.skewMs });
                if (!this._live(g)) { if (r.ok && r.lease) cloudReleaseLease(this.uid, this.id, r.lease.epoch).catch(() => {}); return; }
                if (r.ok && r.lease) { this.epoch = r.lease.epoch; this.createLease = null; }
                else if (!r.ok) holder = r.holder;
            } else {
                this.epoch = null;
                this.createLease = { ...who(this), epoch: newEpoch(), until: this.env.now() + this.o.ttlMs };
            }
            const res = await this._reconcile(g, { manifest, opening: true });
            if (!this._live(g) || res === "gone" || res === "blocked") return;
        } catch (err) {
            if (!this._live(g)) return;
            if (isNetwork(err)) { this._offline(err); this.needOpen = true; this._edit(g); return; }
            this._blocked(`Couldn't open the cloud copy: ${String((err && err.message) || err).slice(0, 80)}`);
            return;
        }
        this.needOpen = false;
        this.openFails = 0;
        if (holder) this._readOnlyDevice(holder);
        else this._edit(g);
    }
    // The cloud open cannot finish (an error, or a copy that could not be kept): read-only, shown, retried.
    _blocked(message) {
        this.needOpen = true;
        this.openFails += 1;
        const wait = Math.min(10 * 60000, this.o.openRetryMs * Math.pow(2, this.openFails - 1));
        this.openRetryAt = this.env.now() + wait;
        this.editor.setSaving(false);
        this.editor.setReadOnly(true);
        this._set({ mode: this.state.why === "device" ? "readonly" : "starting", cloud: "error", error: `${message}. Retrying.` });
    }
    // Compare the local base with the cloud head and act (R4, R5); "ok", "blocked" or "gone".
    async _reconcile(g, { manifest, opening = false } = {}) {
        const m = manifest !== undefined ? manifest : await cloudGetCanvasMeta(this.uid, this.id);
        if (!this._live(g)) return "gone";
        const local = await getStoreHeader(this.id);
        if (!this._live(g)) return "gone";
        const d = decideOpen({ local, cloud: m, deviceId: this.deviceId, col: this.col });
        if (d.base && local && local.store === "kobin-2" && !sameHead(d.base, local.base || null)) {
            await setSyncState(this.id, { base: d.base, intent: null }, this.token);
            if (!this._live(g)) return "gone";
        }
        this.lastHead = headOf(m);
        this.onPerf("syncDecide", perfNow(), { action: d.action, why: d.why });
        switch (d.action) {
            case "push": this.dirty = true; return "ok";
            case "pull": return this._pull(g, { full: d.full, local, keepCamera: !opening });
            case "stash": case "conflict": {
                const kept = await this._keepStore(g, d.action, local);
                if (kept !== true) return kept === "gone" ? "gone" : "blocked";
                return this._pull(g, { full: true, local: null, keepCamera: !opening });
            }
            case "legacy": return this._pullLz1(g, local, m);
            default: return "ok";
        }
    }
    async _pull(g, { full, local, keepCamera }) {
        const t0 = perfNow();
        const have = full || !local ? null : { frameSeq: local.frameSeq || {}, seq: local.seq || 0 };
        const pulled = await cloudPullCanvas2(this.uid, this.id, { have });
        if (!this._live(g)) return "gone";
        if (!pulled) return "ok";
        const base = { ...pulled.head, col: this.col };
        const ok = await applyPulledStore(this.id, pulled, base, this.token);
        if (!this._live(g)) return "gone";
        if (ok !== true) {
            if (!full && ok !== "fenced") return this._pull(g, { full: true, local: null, keepCamera });
            this._blocked("Couldn't write the cloud copy into this browser");
            return "blocked";
        }
        if (pulled.thumbs) await saveThumbs(this.id, pulled.thumbs);
        const nm = pulled.meta && pulled.meta.name;
        const prevEntry = this.getEntry();
        upsertIndexEntry({
            ...(prevEntry || {}), id: this.id,
            name: (nm && nm !== "untitled" ? nm : null) || (prevEntry && prevEntry.name) || "Untitled canvas",
            savedAt: pulled.meta.savedAt || new Date().toISOString(),
            strokes: pulled.header.strokes || 0, levels: pulled.header.levels || 0,
        });
        this.lastHead = pulled.head;
        this.lastReloadMs = (await this.editor.reload({ keepCamera })) || 0;
        if (!this._live(g)) return "gone";
        this._post({ type: "saved", seq: pulled.header.seq });
        this.onPerf("cloudPull", t0, { full: pulled.full ? 1 : 0, frames: Object.keys(pulled.frames).length, entries: pulled.entries.length, reloadMs: Math.round(this.lastReloadMs) });
        this.onNotice({ kind: "pulled", name: nm || null });
        return "ok";
    }
    // Before a pull replaces the local store: the store kept whole — in the recycle bin ("stash",
    // unknown ancestry) or as a new canvas ("conflict", R5). True, false (nothing landed: the pull
    // must not happen) or "gone".
    async _keepStore(g, kind, local) {
        const flushed = await this.editor.flush();
        if (!this._live(g)) return "gone";
        if (!flushed) await this._keepUnsaved();
        const name = shownName(this.getEntry(), local);
        if (kind === "stash") {
            const t = await stashCanvasStore(this.id, name);
            if (!this._live(g)) return "gone";
            if (!t) { this._blocked("Couldn't keep this browser's copy (is the storage full?), so the newer cloud copy was not loaded"); return false; }
            this.onNotice({ kind: "stash", message: "The cloud copy was newer; this browser's copy is in “Restore deleted canvases”" });
            return true;
        }
        const cname = conflictName(name, this.deviceName);
        const entry = await forkCanvas(this.id, cname);
        if (!this._live(g)) return "gone";
        if (!entry) { this._blocked("Couldn't keep this device's changes as a new canvas (is the storage full?), so the cloud copy was not loaded"); return false; }
        this.onNotice({ kind: "conflict", name: cname, id: entry.id, message: `This device's changes were kept as a new canvas, “${cname}”` });
        return true;
    }
    // An lz1 cloud copy (before 2026-09-08). Newer than this copy: pulled, this copy stashed first.
    // Older: kept as a new canvas before the first push replaces it (the review's minor 9).
    async _pullLz1(g, local, m) {
        const entry = this.getEntry();
        const localNewer = !!local && String(m.savedAt || "") <= String((entry && entry.savedAt) || local.savedAt || "");
        const res = await cloudLoadCanvas(this.uid, this.id);
        if (!this._live(g)) return "gone";
        if (!res || !res.json) { if (localNewer) this.dirty = true; return "ok"; }
        const parsed = JSON.parse(res.json);
        const nm = res.meta && res.meta.name;
        if (localNewer) {
            if (statsFromDoc(parsed).strokes > 0) {
                let day = "";
                try { day = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (err) { day = ""; }
                const name = `${shownName(entry, local)} — the older cloud copy, ${day}`;
                const id = newCanvasId();
                if (!(await saveCanvasDoc(id, { ...parsed, meta: { ...(parsed.meta || {}), name } }))) {
                    this._blocked("Couldn't keep the older cloud copy (is the storage full?)");
                    return "blocked";
                }
                if (!this._live(g)) return "gone";
                upsertIndexEntry({ id, name, savedAt: m.savedAt || new Date().toISOString(), ...statsFromDoc(parsed) });
                this.onNotice({ kind: "kept", id, name, message: `The older cloud copy was kept as “${name}”` });
            }
            this.dirty = true;
            return "ok";
        }
        if (local && statsFromDoc(parsed).strokes === 0) return "ok";
        if (local) {
            const kept = await this._keepStore(g, "stash", local);
            if (kept !== true) return kept === "gone" ? "gone" : "blocked";
        }
        await saveCanvasDoc(this.id, nm && nm !== "untitled" ? { ...parsed, meta: { ...(parsed.meta || {}), name: nm } } : parsed);
        if (!this._live(g)) return "gone";
        if (res.thumbs) await saveThumbs(this.id, res.thumbs);
        this.lastReloadMs = (await this.editor.reload({ keepCamera: false })) || 0;
        return this._live(g) ? "ok" : "gone";
    }
    // The document in memory as a new canvas, when it could not be written here.
    async _keepUnsaved() {
        if (!this.editor.hasUnsaved()) return null;
        const name = conflictName(shownName(this.getEntry(), null), this.deviceName).replace(" — edits from ", " — unsaved edits from ");
        const entry = await this.editor.keepUnsaved(name);
        this.onNotice(entry
            ? { kind: "kept", id: entry.id, name, message: `Changes that could not be saved here were kept as “${name}”` }
            : { kind: "unsaved", message: "Changes here could not be saved or copied (is the storage full?) — download them from the ⋮ menu" });
        return entry;
    }

    _edit(g) {
        if (g !== undefined && !this._live(g)) return;
        this.editor.setSaving(true);
        this.editor.setReadOnly(false);
        const cloud = !this.uid ? "off" : this.needOpen ? "offline" : !this.getEntry() ? "local" : this.dirty ? "saving" : "saved";
        this._set({ mode: "editing", why: null, holder: null, cloud, error: this.needOpen ? this.state.error : null });
    }
    /** A deleted canvas: nothing more goes up, not even the last push on leaving. */
    discard() { this.dirty = false; this.discarded = true; }
    _readOnlyDevice(holder) {
        this.editor.setReadOnly(true);
        this.editor.setSaving(false);
        this.epoch = null;
        this._set({ mode: "readonly", why: "device", holder: holder ? { device: holder.device, name: holder.name || "another device" } : { name: "another device" }, cloud: "follow" });
    }
    _offline(err) {
        this._set({ cloud: "offline", error: String((err && err.message) || err).slice(0, 120) });
    }

    async _beat() {
        if (this.stopped || !this.hasLock || !this.uid || !this.env.visible()) return;
        const g = this.gen;
        const mode = this.state.mode;
        if (mode === "taking") {
            // Asking another device: its lease is watched here too, so a holder gone silent (no
            // renewal, so no manifest change to hear) is taken once it has sat unchanged for a TTL.
            if (this.asking) {
                try { const m = await cloudGetCanvasMeta(this.uid, this.id); if (m && this._live(g)) this._maybeTake(m.lease || null); } catch (err) { /* offline: asked again next beat */ }
            }
            return;
        }
        if (this.needOpen) {
            if (this.env.now() < this.openRetryAt || this._reopening) return;
            this._reopening = true;
            try {
                if (mode === "editing") {
                    const ok = await this.editor.flush();
                    if (!this._live(g)) return;
                    if (!ok) await this._keepUnsaved();
                }
                this.editor.setSaving(false);
                this.editor.setReadOnly(true);
                await this._openCloud(g);
            } finally { this._reopening = false; }
            return;
        }
        if (mode === "starting") return;                    // an open in progress
        if (mode === "readonly") { this._scheduleFollow(() => this._followCloud()); return; }
        if (!this.epoch) return;                            // no cloud copy yet: the first push writes the lease
        // Under a push the renewal would race its manifest transaction (the recurring failed-precondition
        // retries, REVIEWER S-1): skipped while the lease has more than half its life left.
        if (this.busy && this._renewedAt != null && this.env.now() - this._renewedAt < this.o.ttlMs / 2) return;
        let r;
        try { r = await cloudRenewLease(this.uid, this.id, this.epoch, { now: this.env.now(), ttl: this.o.ttlMs }); }
        catch (err) { this._offline(err); return; }
        if (!this._live(g)) return;
        if (r.ok) this._renewedAt = this.env.now();
        if (!r.ok) {
            if (r.absent) { this.epoch = null; this.createLease = { ...who(this), epoch: newEpoch(), until: this.env.now() + this.o.ttlMs }; return; }
            this._serial(() => this._lose(r.holder));
            return;
        }
        if (this.state.cloud === "offline") this._set({ cloud: this.dirty ? "saving" : "saved", error: null });
        if (r.want && r.want.device !== this.deviceId && this.state.mode === "editing") this._handToDevice(r.want);
    }
    _watch() {
        if (this._unwatch || !this.uid) return;
        try {
            this._unwatch = cloudWatchManifest(this.uid, this.id, (m) => this._onManifest(m), () => {});
        } catch (err) { this._unwatch = null; }
    }
    _onManifest(m) {
        if (!m || this.stopped || !this.hasLock) return;
        const L = m.lease || null;
        if (this.state.mode === "editing" && this.epoch) {
            if (L && String(L.epoch) !== String(this.epoch)) this._serial(() => this._lose(L));
            else if (L && L.want && L.want.device !== this.deviceId && L.until > 0) this._handToDevice(L.want);
            return;
        }
        if (this.state.why !== "device" || this.state.mode === "handing") return;
        if (this._maybeTake(L)) return;
        if (L && L.device && L.device !== this.deviceId && L.until > 0 && (!this.state.holder || this.state.holder.device !== L.device)) {
            this._set({ holder: { device: L.device, name: L.name || "another device" } });
        }
        if (!sameHead(headOf(m), this.lastHead)) this._scheduleFollow(() => this._followCloud());
    }
    // A read-only device takes the pen unasked only when it was let go (to it, or to nobody) or has
    // sat unchanged for a whole TTL of THIS device's clock, so a skewed clock elsewhere cannot make
    // a live lease look dead; and only while visible. Once taken (`epoch` set, its promote on the
    // way) never again: each take mints an epoch and a promote, which flips the engine read-only.
    _maybeTake(L) {
        if (this.stopped || !this.hasLock || this.epoch || (this.state.mode !== "readonly" && this.state.mode !== "taking") || this.state.why !== "device" || !this.env.visible()) return false;
        const now = this.env.now();
        let free = leaseState(L, { device: this.deviceId, now, skewMs: this.o.skewMs }).free;
        if (!free) {
            const key = `${L.epoch}|${L.until}|${L.to || ""}`;
            if (!this._seen || this._seen.key !== key) this._seen = { key, at: now };
            else free = now - this._seen.at >= this.o.ttlMs;
        }
        if (!free) return false;
        this._takeLease(false, L ? { epoch: L.epoch, until: L.until } : null);
        return true;
    }

    // The pen was taken (a push refused, a beat or the manifest said so): stop, save here, follow.
    async _lose(holder) {
        if (this.state.mode !== "editing" && this.state.mode !== "handing") return;
        const g = this.gen;
        this.editor.setReadOnly(true);
        const ok = await this.editor.flush();
        if (!this._live(g)) return;
        if (!ok) await this._keepUnsaved();
        this._readOnlyDevice(holder);
        this.onNotice({ kind: "lost", message: `Editing moved to ${(holder && holder.name) || "another device"}` });
        await this._followCloud();
    }
    // Another device asked (`want`): save, push what is left (the beat keeps renewing, so the asker
    // waits), let go to the asker, follow.
    async _handToDevice(want) {
        if (this.state.mode !== "editing" || !this.epoch || this._handingDev) return;
        this._handingDev = true;
        const g = this.gen, epoch = this.epoch;
        try {
            this._set({ mode: "handing" });
            this.editor.setReadOnly(true);
            const ok = await this.editor.flush();
            if (!this._live(g)) return;
            if (!ok) await this._keepUnsaved();
            this.editor.setSaving(false);
            if (this.busy) await this.busy;
            if (this.dirty && this._live(g)) await this._push({ why: "handover", force: true });
            if (this.busy) await this.busy;
            if (!this._live(g)) return;
            try { await cloudReleaseLease(this.uid, this.id, epoch, { to: want.device }); } catch (err) { /* it expires */ }
            this._readOnlyDevice({ device: want.device, name: want.name });
            this.onNotice({ kind: "handed", message: `Handed over to ${want.name || "another device"}` });
        } finally { this._handingDev = false; }
    }
    async _takeLease(force, ifLease = null) {
        if (this._takingLease || this.stopped) return;
        this._takingLease = true;
        try {
            const r = await cloudTakeLease(this.uid, this.id, who(this), { force, ifLease, now: this.env.now(), ttl: this.o.ttlMs, skewMs: this.o.skewMs });
            if (r.ok) {
                this.asking = false;
                this.epoch = r.lease ? r.lease.epoch : null;
                this._serial(() => this._promote());
            }
        } catch (err) { this._offline(err); }
        finally { this._takingLease = false; }
    }
    // The pen taken from another device: catch up with what it left, then edit.
    async _promote() {
        const g = this.gen;
        if (!this._live(g)) return;
        this.editor.setSaving(false);
        this.editor.setReadOnly(true);
        let res;
        try { res = await this._reconcile(g, { opening: false }); }
        catch (err) {
            if (!this._live(g)) return;
            if (isNetwork(err)) { this._offline(err); this.needOpen = true; this._edit(g); }
            else this._blocked(`Couldn't catch up with the cloud copy: ${String((err && err.message) || err).slice(0, 80)}`);
            return;
        }
        if (!this._live(g) || res !== "ok") return;
        this._edit(g);
        this._watch();
    }
    // A read-only device: bring the store and the view up to the cloud head.
    async _followCloud() {
        const g = this.gen;
        if (!this._live(g) || this.state.why !== "device" || this.state.mode !== "readonly") return;
        try {
            const m = await cloudGetCanvasMeta(this.uid, this.id);
            if (!this._live(g)) return;
            const res = await this._reconcile(g, { manifest: m, opening: false });
            if (m && res === "ok") this._maybeTake(m.lease || null);
        } catch (err) { if (this._live(g)) this._offline(err); }
    }
    // A whole reload is 5-7 s of main thread on the Magnum Opus (STALL, 2026-09-23): a write that
    // moved no data is followed by its header alone. False when nothing was reloaded.
    async _reloadFollow() {
        if (this.stopped || this.hasLock) return false;
        if (!this._followData) {
            await this.editor.refreshMeta();
            if (!this.stopped && !this.hasLock) this.onNotice({ kind: "reloaded" });
            return false;
        }
        this._followData = false;
        try { this.lastReloadMs = (await this.editor.reload({ keepCamera: true })) || 0; }
        catch (err) { this._followData = true; throw err; }   // still owed: the next follow retries it
        if (!this.stopped && !this.hasLock) this.onNotice({ kind: "reloaded" });
        return true;
    }
    // A follow runs while visible (R6; a hidden tab owes it until it is shown), at most every
    // followMinMs, or ten times the last reload's cost on a big drawing. One asked for while a
    // follow runs is scheduled when that one ends, gap included (it ran back to back before).
    _scheduleFollow(fn) {
        if (!this.env.visible()) { this._followOwed = fn; return; }
        if (this._following) { this._followNext = fn; return; }
        if (this._followPending) return;
        const gap = Math.max(this.o.followMinMs, this.lastReloadMs * this.o.followCostFactor);
        const wait = Math.max(0, this.followAt + gap - this.env.now());
        this._followPending = true;
        this._after(wait, () => {
            this._followPending = false;
            this._following = true;
            this._serial(async () => {
                try { if ((await fn()) !== false) this.followAt = this.env.now(); } finally {
                    this._following = false;
                    const next = this._followNext;
                    this._followNext = null;
                    if (next && !this.stopped) this._scheduleFollow(next);
                }
            });
        });
    }

    // One push at a time (memory: firestore-write-stream): `busy` settles when the SDK settles the
    // push, deadline or not, so a timed-out push is never doubled (the review's major 3).
    _push({ why = "sync", thumbs = null, force = false } = {}) {
        if (!this.uid || this.busy) return Promise.resolve({ ok: false, busy: !!this.busy });
        if (this.state.mode !== "editing" && this.state.mode !== "handing") return Promise.resolve({ ok: false, readOnly: true });
        if (!force && this.env.now() < this.fail.until) return Promise.resolve({ ok: false, backoff: true });
        let settle;
        const busy = new Promise((r) => { settle = r; });
        this.busy = busy;
        const done = () => { if (this.busy === busy) this.busy = null; settle(); };
        const run = (async () => {
            let raw = null;
            try {
                const entry0 = this.discarded ? null : this.getEntry();
                if (!entry0) { this._set({ cloud: "local" }); return { ok: false, skipped: "never saved" }; }   // an unsaved scratch canvas stays local
                const source = await this.editor.pushSource();
                if (!source) return { ok: false, skipped: "nothing on disk" };
                const views = this._viewsNow();     // the document as it is now: what this push sends, if nothing comes meanwhile
                const t0 = perfNow();
                this.dirty = false;
                this._set({ cloud: "saving" });
                const entry = { ...entry0, savedAt: new Date().toISOString(), ...(this.editor.stats ? this.editor.stats() : {}) };
                // The deadline runs from when the push leaves the page's push lane, not while it queues;
                // the lane lets the next push go at the same deadline if this one never settles.
                let started;
                const began = new Promise((r) => { started = r; });
                const creating = this.epoch ? null : this.createLease;
                const limit = await this._limit();
                raw = cloudPushCanvas2(this.uid, entry, source, {
                    deviceId: this.deviceId, epoch: this.epoch, lease: creating, limit,
                    thumbs, dropBelow: source.dropBelow || 0, laneMs: this.o.pushDeadlineMs, onStart: started,
                });
                raw.then(done, done);
                // A push that lands, even after its deadline was reported, made the copy's lease this
                // tab's: without it the next push would read its own lease as another's (LeaseLost).
                const landed = (r) => {
                    if (creating && !this.epoch && this.createLease === creating) { this.epoch = creating.epoch; this.createLease = null; this._watch(); }
                    if (r && r.head) this.lastHead = r.head;
                };
                raw.then(landed, () => {});
                try {
                    const r = await Promise.race([raw, began.then(() => withTimeout(raw, this.o.pushDeadlineMs, "the push did not finish in 5 min"))]);
                    landed(r);
                    this.fail = { count: 0, until: 0 };
                    this._set({ cloud: this.dirty ? "saving" : "saved", error: null });
                    this.onPerf("cloudSave", t0, { where: why, ...r, head: undefined });
                    this._pushViews(views, r && r.head, why);
                    return { ok: true, r };
                } catch (err) {
                    this.dirty = true;
                    if (err && err.name === "CloudLimit") {
                        this.fail = { count: this.fail.count + 1, until: this.env.now() + 10 * 60000 };
                        this._others = null;                 // listed again at the next try: space may have been freed
                        this._set({ cloud: "error", error: limitMessage(err) });
                        this.onPerf("cloudSaveLimit", t0, { where: why, bytes: err.bytes });
                        return { ok: false, err };
                    }
                    if (err && (err.name === "SyncConflict" || err.name === "LeaseLost")) {
                        this.onPerf("cloudSaveRefused", t0, { where: why, err: err.name });
                        this._serial(() => this._lose(err.holder || null));
                        return { ok: false, err };
                    }
                    const f = this.fail;
                    f.count += 1;
                    const waitMs = Math.min(30 * 60000, 60000 * Math.pow(2, f.count - 1));
                    f.until = this.env.now() + waitMs;
                    const wait = waitMs >= 60000 ? `${Math.round(waitMs / 60000)} min` : `${Math.round(waitMs / 1000)} s`;
                    const msg = String((err && err.message) || err).slice(0, 80);
                    this._set({ cloud: "error", error: `Cloud sync failed: ${msg}. Saved in this browser only; next try in ${wait}.` });
                    this.onPerf("cloudSaveFail", t0, { where: why, tries: f.count, waitMs });
                    return { ok: false, err };
                }
            } finally {
                if (!raw) done();
            }
        })();
        return run;
    }

    /** The account limit's input for a push, `{ others }` (the other canvases' stored bytes, listed every 10 min), or null: the owner's, or no listing. */
    async _limit() {
        if (!limitedAccount(this.uid)) return null;
        const now = this.env.now();
        if (!this._others || now - this._others.at > 10 * 60000) {
            try { this._others = { at: now, bytes: accountBytes(await cloudListCanvases(this.uid), this.id) }; }
            catch (err) { return null; }
        }
        return { others: this._others.bytes };
    }

    // ---- the first-view pictures (OPEN-FLAGS F166): the view's plates for the next open ----

    /** The editor's set now, `{ seq, tag, stamp, parts, sig }` (engine/raster/firstView.js), or null. */
    _viewsNow() {
        if (!this.uid || this.discarded) return null;
        try { return this.editor.firstView(); } catch (err) { return null; }
    }
    /**
     * Upload `set` stamped with `head` when that cloud head is its document (`head.seq` its seq) and it is not the set
     * that went up last. One at a time, in the push lane; after the background sync at most every viewsMinMs.
     */
    _pushViews(set, head, why) {
        if (!set || !head || (head.seq || 0) !== set.seq || this._viewsBusy || !this.uid || this.discarded) return;
        if (this.state.mode !== "editing" && this.state.mode !== "handing") return;
        const sig = `${head.epoch}|${head.seq || 0}|${set.tag}|${set.sig}`;
        if (sig === this._viewsSig) return;
        if (why === "sync" && this._viewsAt != null && this.env.now() - this._viewsAt < this.o.viewsMinMs) return;
        this._viewsBusy = true;
        const t0 = perfNow();
        const stamp = { ...set.stamp, head: { epoch: head.epoch, seq: head.seq || 0 } };
        cloudSaveViews(this.uid, this.id, set.tag, { stamp, parts: set.parts }, { laneMs: this.o.pushDeadlineMs })
            .then((r) => { this._viewsSig = sig; this._viewsAt = this.env.now(); this.onPerf("cloudViews", t0, { where: why, cells: set.cells, ...r }); },
                (err) => this.onPerf("cloudViewsFail", t0, { where: why, err: String((err && (err.code || err.name)) || err).slice(0, 60) }))
            .then(() => { this._viewsBusy = false; });
    }

    // ---- plumbing ----

    _set(patch) {
        this.state = { ...this.state, ...patch };
        try { this.onState(this.state); } catch (err) { /* the UI's problem */ }
    }
    // Losses, promotions and follows one at a time. Hand-overs and a stolen lock do not wait here.
    _serial(fn) {
        const p = this._chain.then(() => (this.stopped ? null : fn()));
        this._chain = p.catch(() => null);
        return p;
    }
    _after(ms, fn) {
        const t = setTimeout(() => { this._timers.delete(t); if (!this.stopped) fn(); }, ms);
        this._timers.add(t);
        return t;
    }
    _every(ms, fn) {
        const t = setInterval(() => { if (!this.stopped) fn(); }, ms);
        this._timers.add(t);
        return t;
    }
}
