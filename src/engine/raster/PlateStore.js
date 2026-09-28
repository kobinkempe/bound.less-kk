/**
 * PlateStore.js — the plate cache (RASTERISER-PLAN §3.7 and §5.4): keys, LRU with the
 * visible set pinned, a byte cap, the five invalidation rules, the settle's own quantum
 * drop (§6.3), the invalidation epoch (D25), the in-flight map and the
 * `visibilitychange` release.
 *
 * Four facts a reader needs not to break it:
 *
 *   - **Only `_remove` closes a bitmap**, and it is reached from `put`'s replace, `_evict`,
 *     `dropQuantum`, `dropAll` and `release`. An `ImageBitmap` holds memory outside the JS
 *     heap, often a GPU texture; dropping the reference frees it only when GC decides, which
 *     on a phone under pressure is too late (§3.7). `_remove` marks the entry `dead` first,
 *     so a compose still holding it draws nothing rather than throwing on a closed bitmap.
 *   - **An invalidating drop KEEPS the pixels** (PAPER-PLAN R1): `_drop` bumps the epoch and
 *     leaves the record, and a record is STALE when `e.epoch !== epochOf(e.key)` — derived,
 *     never flagged, because the epoch map already owns that fact (D25). `want` returns a
 *     stale record as a hit AND as a miss, so the screen keeps old ink until the replacement
 *     lands. A stale plate in the visible range is pinned by `want`'s own range loop.
 *   - **The epoch is what catches a plate that was in flight when the document changed.**
 *     The five drop rules can only see plates that are already cached; a plate posted
 *     before the change and cached after it is stale for ever without the epoch (D25).
 *   - **It holds no camera, no document and no lattice.** `KobinEngine` is the only place
 *     that maps a document event into a rectangle in a frame's own units and hands it here
 *     (§2.6, and the eslint zones enforce it).
 */

import { PLATE_PX, QUANTA_PER_OCTAVE, plateKey } from "./plate";

/** Bytes one 512² RGBA plate costs, whether it is a bitmap or a raw buffer. */
export const PLATE_BYTES = PLATE_PX * PLATE_PX * 4;
/**
 * The cache's byte cap: exactly 96 plates (≈ 4 desktop screens) and 48 (≈ 2 phone ones), §6.6.
 * The phone's 24 became 48 when `PictureLayer` began HOLDING the last quantum's plates while the
 * next quantum is rastered (§6.3): a worst-case phone screen between quanta is 24 plates (§3.2),
 * so 24 held plus 24 incoming need 48 — at 24 the held set is evicted while the new one fills,
 * which is the paper the hold exists to remove. Stage 7's measurement 5 decides the final number
 * (D170, amending D80).
 */
export const DESKTOP_CACHE_BYTES = 96 * 1024 * 1024;
export const PHONE_CACHE_BYTES = 56 * 1024 * 1024;   // 24 held + 24 incoming + a 2–6 plate preview (PAPER-PLAN §7.1)
/** Device pixels a plate's box is grown by before a footprint is tested against it. */
const EDGE_PAD_PX = 1;
/** How long a desktop tab stays hidden before its plates are released (a phone releases at once). */
export const HIDDEN_RELEASE_MS = 5 * 60 * 1000;
/** Epoch entries kept before the ones no plate and no job needs are pruned. */
const EPOCH_MAX = 4096;

/**
 * The cross-quantum window `fallbackCover` will stand a cached plate in at, in quanta of the
 * plate's EFFECTIVE zoom in the view's frame (PAPER-PLAN §7.1, §7.5, §10 S8): `r = Zq_view / Zq_plate`
 * in [1/4, 65536] — sixteen octaves of magnification: blurred colour beats paper. Measured in Kobin's
 * Chrome: at −20 a fast zoom-in (a quantum a wheel tick, no plate landing between ticks) put every
 * cached plate outside the window after five octaves and the whole screen was paper for ~0.9 s, and
 * the ladder's first rung (12 quanta under its own zoom, 8 under the camera's) sat on the edge; at
 * −40 a ten-octave zoom-in into a cold level showed paper through its 2.5 s bake.
 * Two octaves of minification, so a hold ended at s 0.5 leaves its plates in (R5c). **Never the
 * hold's `S_MAX_HOLD`** (analysis C §1.3). Exported for stage 7.
 */
export const FB_Q_LO = -64;
export const FB_Q_HI = 8;
/** Fallback plates one compose may draw. Coarsest-first, so the cap costs sharpness, never coverage. */
export const FB_MAX = 48;

/**
 * The phone budget. A budget, not a capability test — it is on the perf record so a phone
 * report can be read against a desktop one (§6.6).
 *
 * @param {{deviceMemory?:number, screenW?:number, screenH?:number}} [env] overrides for a test
 */
export function isPhoneBudget(env) {
    const nav = (env && "deviceMemory" in env) ? env : (typeof navigator !== "undefined" ? navigator : {});
    const scr = (env && env.screenW != null) ? { width: env.screenW, height: env.screenH || 0 }
        : (typeof window !== "undefined" && window.screen ? window.screen : null);
    if (nav && typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return true;
    if (scr && Math.max(scr.width || 0, scr.height || 0) < 1200) return true;
    return false;
}

/** The byte cap this device gets. */
export function defaultCacheBytes(env) {
    return isPhoneBudget(env) ? PHONE_CACHE_BYTES : DESKTOP_CACHE_BYTES;
}

/** Is the painted-id set ascending? Rule 1 binary-searches it, so an unsorted set loses drops. */
function ascending(ids) {
    for (let k = 1; k < ids.length; k++) if (ids[k] <= ids[k - 1]) return false;
    return true;
}

/** Does a plate's painted-id set hold any of `want`? Walks the SHORTER of the two. */
function anyId(ids, want) {
    if (want.size <= ids.length) { for (const id of want) if (holdsId(ids, id)) return true; return false; }
    for (let k = 0; k < ids.length; k++) if (want.has(ids[k])) return true;
    return false;
}

/** Is `id` in a plate's sorted painted-id set? */
export function holdsId(ids, id) {
    let lo = 0, hi = ids.length - 1;
    while (lo <= hi) {
        const m = (lo + hi) >> 1, v = ids[m];
        if (v === id) return true;
        if (v < id) lo = m + 1; else hi = m - 1;
    }
    return false;
}

/**
 * A plate RANGE's box in its frame's own units, grown by `pad` device pixels; null when `Zq` is
 * unusable. `i1`/`j1` are inclusive, as `plateRange`'s are.
 */
function boxOf(i0, i1, j0, j1, Zq, pad) {
    if (!(Zq > 0) || !isFinite(Zq)) return null;
    const s = PLATE_PX / Zq, p = pad / Zq;
    return { left: i0 * s - p, top: j0 * s - p, right: (i1 + 1) * s + p, bottom: (j1 + 1) * s + p };
}

/** One plate's box, grown by EDGE_PAD_PX: `boxOf`'s one-cell call. */
function rectOf(p) { return boxOf(p.i, p.i, p.j, p.j, p.Zq, EDGE_PAD_PX); }

/** A plate with no usable Zq meets every footprint (`meets(null, …)`'s rule, for a tracked cell). */
const EVERYWHERE_BOX = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

/** Coarsest first, then by plate index, so a cover set is drawn bottom-up and deterministically. */

/** Touching counts as meeting, as `TileStore._onFrameEvent` does: invalidation is conservative. */
function meets(r, b) {
    if (!r) return true;                 // no usable Zq: drop rather than keep a stale plate
    if (!b) return false;
    return !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom);
}

export default class PlateStore {
    /**
     * @param {object} [opts]
     * @param {number} [opts.maxBytes] the byte cap; defaults to the device budget of §6.6
     * @param {object} [opts.env] `{ deviceMemory, screenW, screenH }`, for the budget in a test
     * @param {Document|null} [opts.doc] where the `visibilitychange` listener goes
     * @param {(reason:string)=>void} [opts.onRelease] called after a whole-cache drop, so the
     *        picture layer can drop its own canvas on the same event (§6.6)
     */
    constructor(opts = {}) {
        /**
         * The freshness source (the engine's Stage, A2 §3.1): with it a plate carries the `G` its job was
         * packed at and is exact iff `G >= fresh.dirtySince(key)`; the cells stored or in flight are
         * tracked there. Without it, the per-key epochs of D25 (the engine's drain), until the switch.
         */
        this.fresh = opts.fresh || null;
        this.maxBytes = opts.maxBytes != null ? opts.maxBytes : defaultCacheBytes(opts.env);
        this.phone = this.maxBytes === PHONE_CACHE_BYTES;
        this.cache = new Map();      // key -> entry
        this.epochs = new Map();     // key -> integer, bumped by every invalidating drop (D25)
        this.inflight = new Map();   // key -> { jobId, key, frameId, q, i, j, Zq, epoch }
        this.jobs = new Map();       // jobId -> key[]
        this.bytes = 0;
        this._pins = new Set();      // the visible set: never evicted (TileStore.js:50-58)
        // The ADDED set, pinned beside the visible one: a "replace" want rebuilds `_pins` alone,
        // so a second view's pins merged into it would be discarded by the renderer's own
        // `want(view)` later in the same frame (D178). `unpinAdded()` empties it; an `"add"` want
        // REBUILDS it from its own range (D184), and a drop removes the keys it drops.
        this._held = new Set();
        this._ladder = new Set();          // PAPER-PLAN R5b: evicted after everything else unpinned
        this._plane = new Set();           // PAPER-PLAN §10 S4: the drag plane's plates, never evicted
        this._base = new Set();            // §10.13: the ladder's first rung, never evicted, kept through a release
        this._addTag = "";           // the `view.mode` of the caller that pinned the added set
        this._clock = 0;
        this.onRelease = opts.onRelease || null;
        this.s = {
            wants: 0, hits: 0, misses: 0, inFlightSkips: 0,
            puts: 0, stalePuts: 0, replaced: 0,
            evictions: 0, overCapPinned: 0,
            dropsById: 0, dropsByRect: 0, dropsByQ: 0, dropsAll: 0, dropsFrames: 0, ladderEvictions: 0,
            noIds: 0, noZq: 0, noEpoch: 0, badIds: 0,
            epochBumps: 0, epochPrunes: 0,
            // A second `{pin:"add"}` caller over a live added set: the one-caller rule D184's
            // rebuild rests on, observed and never enforced (§15.3, 5a's fourth review Q1).
            addCallerMismatch: 0,
            // PAPER-PLAN R1: a drop keeps the pixels, so these say how much of the cache is
            // behind the document and how often the screen was saved by it.
            staleKept: 0, staleHits: 0, staleReplaced: 0, staleEvictions: 0, staleNewer: 0,
            // the cross-quantum cover walk (§7.1): scans, candidates written, entries the cap cut
            fallbackScans: 0, fallbackCandidates: 0, fallbackDropped: 0,
            abandons: 0,
            bitmapsOpen: 0, bitmapsClosed: 0,
            drains: 0, drainedEvents: 0, releases: 0,
            neutralEvents: 0,               // bake steps under their mark, drained without a drop (F90)
            dpr: 0,
        };
        this._doc = opts.doc !== undefined ? opts.doc : (typeof document !== "undefined" ? document : null);
        this._onVis = null;
        // A hidden tab frees its plates: a phone at once, a desktop only once it has stayed hidden this
        // long — a glance at another window released everything and the return rebuilt the view and
        // every ladder rung (report 2026-09-24T04-06-17). Back from a release, the owner rebuilds (§10.13).
        this.hiddenReleaseMs = HIDDEN_RELEASE_MS;
        this._hideTimer = null;
        this._releasedHidden = false;
        if (this._doc && this._doc.addEventListener) {
            this._onVis = () => {
                if (this._doc.visibilityState === "hidden") {
                    if (this.phone) { this.release("hidden"); this._releasedHidden = true; }
                    else if (this._hideTimer == null) {
                        this._hideTimer = setTimeout(() => { this._hideTimer = null; this.release("hidden"); this._releasedHidden = true; }, this.hiddenReleaseMs);
                    }
                    return;
                }
                if (this._hideTimer != null) { clearTimeout(this._hideTimer); this._hideTimer = null; }
                if (this._releasedHidden) { this._releasedHidden = false; if (this.onShow) this.onShow(); }
            };
            this._doc.addEventListener("visibilitychange", this._onVis);
        }
    }

    // ---- read path ----

    /**
     * The plates a view wants. `view` is `plateRange`'s output plus the frame, the quantum
     * and Zq: `{ frameId, q, Zq, i0, i1, j0, j1 }`. Hits are touched and pinned; misses are
     * what the renderer packs and posts (§5.1 steps 4–6), and a plate already in flight is
     * not a miss, so a strip is never posted twice.
     *
     * `opts.pin` is "replace" (the visible set, the default), "add" (a second view's plates —
     * the settle's exact ones and the incoming quantum's, §6.3) or "none" (§5.6's prebake,
     * which must not steal the pins the way `TileStore` had to restore them by hand).
     *
     * **"add" pins into a SECOND set and never unions into the visible one.** The renderer
     * calls `want(view)` — a "replace" — once a frame, after the layer has added its own, and a
     * "replace" rebuilds `_pins` from its own range: a merged pin is therefore discarded every
     * frame, which is not "neither set can evict the other" (D178). `unpinAdded()` is what
     * empties the added set, at the quantum switch and at every other end of a hold.
     *
     * **Either pin REBUILDS its own set from its own range**; the two differ only in which set
     * they write (D184). `"add"` accumulated until the third review of stage 5a, and `_askQuantum`
     * re-asks once a camera step, so a pan during one hold pinned the union of every incoming
     * range it passed through — 20 plates of a 48-plate phone cap after 20 panned frames, where
     * §6.6 prices that cap at one incoming screenful. One `"add"` caller is live at a time
     * (D179), which is what makes a rebuild safe — and nothing enforces it, so the caller is
     * tagged by its request's own `mode` and a second tag over a live added set is counted in
     * `addCallerMismatch` rather than refused: nothing on the render path throws (D187).
     *
     * **A STALE record is returned as a hit AND as a miss** (PAPER-PLAN R1): the compose keeps
     * drawing its pixels while the re-post goes out, and the miss carries the BUMPED epoch, which
     * is what `_stillWanted` and `put`'s guard judge the replacement by (D25). `hits.length +
     * misses.length` can therefore exceed the cell count; the completeness tests in
     * `PictureLayer` are `!misses.length && !inFlight`, which a stale plate correctly holds open.
     *
     * @returns {{hits: object[], misses: {key:string,i:number,j:number,epoch:number}[], inFlight:number}}
     */
    want(view, opts = {}) {
        const pin = opts.pin || "replace";
        const { frameId, q } = view;
        const hits = [], misses = [];
        const add = pin === "add";
        const pins = new Set();
        let inFlight = 0;
        for (let j = view.j0; j <= view.j1; j++) {
            for (let i = view.i0; i <= view.i1; i++) {
                const key = plateKey(frameId, q, i, j);
                if (pin !== "none") pins.add(key);
                const e = this.cache.get(key);
                if (e) {
                    e.lru = ++this._clock; hits.push(e);
                    if (!this._isStale(e)) continue;
                    this.s.staleHits++;                 // and on, so the re-post goes out (R1)
                }
                if (this.inflight.has(key)) { inFlight++; continue; }
                misses.push(this.fresh ? { key, i, j } : { key, i, j, epoch: this.epochOf(key) });
            }
        }
        if (add) {
            const tag = view.mode || "";            // the request's own mode is the caller tag
            if (this._held.size && tag !== this._addTag) this.s.addCallerMismatch++;
            this._addTag = tag;
            this._held = pins;                      // the incoming range, rebuilt (D184)
        } else if (pin !== "none") this._pins = pins;
        this.s.wants++;
        this.s.hits += hits.length;
        this.s.misses += misses.length;
        this.s.inFlightSkips += inFlight;
        this._evict();
        return { hits, misses, inFlight };
    }

    /**
     * Empty the added pin set (`want`'s `{ pin: "add" }`). The caller that added it owns the
     * moment it ends: for `PictureLayer` that is every end of a hold — the quantum switch
     * included — and the settle's own drop, where what is left to clear is the keys of settled
     * plates that were never cached, because `dropQuantum("e")` has just unpinned the rest
     * (§6.3, D178). It is the only thing that empties the SET; `dropAll` and `dropQuantum`
     * remove the keys of the plates they drop, and an `"add"` want rebuilds it (D184).
     *
     * @returns {number} keys unpinned
     */
    unpinAdded() { const n = this._held.size; this._held.clear(); return n; }

    /**
     * PAPER-PLAN R5b: the current zoom-out ladder's keys, which `_evict` takes last. A new ladder
     * (the camera moved and was still again) replaces the set; `add` is one rung's keys, cached or
     * still to come.
     */
    markLadder(keys, fresh = false) {
        if (fresh) {
            this._ladder.clear();
            // The FIRST rung — the screen zoomed out 4×, 2.5 of those wide — is the base: a pan or a
            // short zoom-out always has it under the carried picture (PAPER-PLAN §10.13).
            this._base = new Set(keys);
        }
        for (const k of keys) this._ladder.add(k);
        return this._ladder.size;
    }

    /** PAPER-PLAN §10 S4: the drag plane's keys (`MovePlane`), pinned while it lives; empty to release. */
    setPlanePins(keys) {
        if (!keys && !this._plane.size) return 0;
        this._plane = new Set(keys || []);
        return this._plane.size;
    }

    /**
     * The cross-quantum cover set for a view, coarsest first (PAPER-PLAN R1) — the plates that
     * stand in, stretched, where this view's own quantum has none.
     *
     * Three things a reader needs. `req` is `want`'s shape but it is the FULL SCREEN range, not
     * the published one: during a hold the published range is clipped to the held set and the
     * ring outside it is exactly what this covers. It touches **no pin and no LRU**, so a
     * fallback stays the first thing evicted after a stale plate. And it refuses a non-numeric
     * `q`, which is what keeps a settled `"e"` plate out (D83) — that key carries no zoom of its
     * own, so it can never say what stretch it should be drawn at.
     *
     * @param {{frameId:*, q:*, Zq:number, i0:number, i1:number, j0:number, j1:number}} req
     * @param {object[]} out written in place, so a per-frame caller allocates nothing (FC5)
     * @param {(frameId:*)=>({a:number, bx:number, by:number}|null)} [mapFrame] another frame's
     *        affine into `req.frameId` (PAPER-PLAN R5a); without it only `req`'s own frame stands in
     * @returns {number} entries written into `out`
     */
    fallbackCover(req, out, mapFrame = null) {
        this.s.fallbackScans++;
        const box = boxOf(req.i0, req.i1, req.j0, req.j1, req.Zq, 0);
        if (!box) return 0;
        const qs = String(req.q), qn = Number(req.q), num = Number.isFinite(qn);
        const qe = this._fbQe || (this._fbQe = []);
        let n = 0;
        // Scalars, not `rectOf`: this runs over the whole cache on every uncovered frame, and one
        // object per entry measured 36 µs a call against `want`'s 3.1 on a 96-plate cache.
        for (const e of this.cache.values()) {
            // An EMPTY plate (no ink: no bitmap and 0 bytes) is cover with nothing to draw; raw pixels are unusable.
            if (e.dead || (!e.bitmap && (e.pixels || e.bytes !== 0))) continue;
            if (!Number.isFinite(e.q)) continue;            // "e" and "s" carry no zoom (D83)
            const Zq = e.Zq;
            if (!(Zq > 0) || !isFinite(Zq)) continue;       // no usable Zq: no stretch to draw it at
            // R5a: another frame's plate is this frame's through one similarity, p·a + b, at the
            // effective zoom Zq / a. `mapFrame` is the caller's (the layer's, memoised).
            let a = 1, bx = 0, by = 0, qk = e.q;
            if (e.frameId !== req.frameId) {
                const m = mapFrame ? mapFrame(e.frameId) : null;
                if (!m) continue;
                a = m.a; bx = m.bx; by = m.by;
                qk = Math.log2(Zq / a) * QUANTA_PER_OCTAVE;
            } else if (num ? e.q === qn : String(e.q) === qs) continue;   // that is a hit, not a fallback
            if (num && (qk < qn + FB_Q_LO || qk > qn + FB_Q_HI)) continue;
            const t = (PLATE_PX / Zq) * a, pad = (EDGE_PAD_PX / Zq) * a;
            const x0 = e.i * t + bx, y0 = e.j * t + by;
            if (x0 + t + pad < box.left || x0 - pad > box.right
                || y0 + t + pad < box.top || y0 - pad > box.bottom) continue;
            qe[n] = qk;
            out[n++] = e;
        }
        this.s.fallbackCandidates += n;
        out.length = n;
        if (n > 1) {
            // Coarsest first by the effective quantum, then row, then column.
            const ord = this._fbOrd || (this._fbOrd = []), tmp = this._fbTmp || (this._fbTmp = []);
            ord.length = n;
            for (let k = 0; k < n; k++) ord[k] = k;
            ord.sort((x, y) => (qe[x] - qe[y]) || (out[x].j - out[y].j) || (out[x].i - out[y].i));
            for (let k = 0; k < n; k++) tmp[k] = out[ord[k]];
            for (let k = 0; k < n; k++) out[k] = tmp[k];
            tmp.length = 0;                                 // never hold a dropped plate's bitmap
        }
        if (n > FB_MAX) { this.s.fallbackDropped += n - FB_MAX; out.length = n = FB_MAX; }
        return n;
    }

    /** One plate, or undefined. Does not touch the LRU clock — `want` is the read path. */
    get(key) { return this.cache.get(key); }
    /** How many plates are cached. */
    size() { return this.cache.size; }
    /** The cache's own byte count: no browser API reports what a bitmap costs (§6.6). */
    plateBytes() { return this.bytes; }

    // ---- write path ----

    /**
     * A rastered plate arrives. `rec` is `{ frameId, q, Zq, i, j, epoch, bitmap|pixels,
     * bytes?, ids? }`. Two things the caller must get right, both counted here because
     * neither can be seen in the picture afterwards:
     *
     *   - **Every result must carry the `epoch` its job was begun with.** A result with no
     *     `epoch` is cached however far the key's epoch has moved, which is the stale plate
     *     D25 exists to catch; it is counted in `noEpoch`.
     *   - **`ids` must be ascending** — it is the plate's painted-id set and rule 1
     *     binary-searches it. One that is not is counted in `badIds` and sorted here, so a
     *     packing mistake costs a sort rather than stale ink nothing explains (D84).
     *
     * A result whose epoch is behind is discarded and its bitmap closed — the plate was
     * invalidated while it was in flight (D25) — and the caller re-posts it. Unless the plate's
     * cached pixels are stale and OLDER than the result: then the result replaces them and stays
     * stale (`"newer"`), still re-posted. A stream of invalidations (a bake's steps, one every
     * ~170 ms on the Magnum Opus) otherwise refused every arrival and kept the pixels from before
     * the first of them on screen — the ink under an eraser mark, back for seconds (F106).
     *
     * @returns {"cached"|"stale"|"newer"}
     */
    put(rec) {
        if (this.fresh) return this._putG(rec);
        const key = rec.key || plateKey(rec.frameId, rec.q, rec.i, rec.j);
        this._endKey(key, rec.jobId);
        this.s.puts++;
        // Counted on arrival, not on caching, so `bitmapsOpen − bitmapsClosed` is what the
        // store still holds even when a result is discarded here.
        if (rec.bitmap && typeof rec.bitmap.close === "function") this.s.bitmapsOpen++;
        let newer = false;
        if (rec.epoch == null) this.s.noEpoch++;
        else if (rec.epoch !== this.epochOf(key)) {
            const cur = this.cache.get(key);
            if (!cur || cur.dead || !this._isStale(cur) || !(rec.epoch > cur.epoch)) {
                this.s.stalePuts++;
                closeOf(rec, this.s);
                return "stale";
            }
            this.s.staleNewer++;
            newer = true;
        }
        const old = this.cache.get(key);
        // The replace is where a stale record's bitmap is closed (R1): `_drop` keeps it, so this
        // is the one place old ink is freed on the good path. The key stays the base or a rung.
        const inBase = this._base.has(key), inLadder = this._ladder.has(key);
        if (old) { if (this._isStale(old)) this.s.staleReplaced++; this._remove(key); this.s.replaced++; }
        const bytes = rec.bytes != null ? rec.bytes : PLATE_BYTES;
        let ids = rec.ids || null;
        if (ids && ids.length > 1 && !ascending(ids)) { this.s.badIds++; ids = Int32Array.from(ids).sort(); }
        const entry = {
            key, frameId: rec.frameId, q: rec.q, Zq: rec.Zq, i: rec.i, j: rec.j,
            bitmap: rec.bitmap || null, pixels: rec.pixels || null,
            bytes, ids, epoch: newer ? rec.epoch : this.epochOf(key), lru: ++this._clock,
        };
        if (!rectOf(entry)) this.s.noZq++;
        this.cache.set(key, entry);
        if (inBase) this._base.add(key);
        if (inLadder) this._ladder.add(key);
        this.bytes += bytes;
        this._evict();
        return newer ? "newer" : "cached";
    }

    /**
     * `put` by generation (A2 §3.1, PLAN §3 row 1). Rule 1: a result replaces the stored plate iff there
     * is none or its `G` is newer — a newer result that is itself behind still replaces older stale
     * pixels (F106) and is re-posted; at equal G the pixels are equal and the stored plate stays. A
     * result of a job a hard drop refused (`dropFrames`, `dropQuantum`, `dropAll`, `abandonQuantum`)
     * is discarded. Rule 2 is `isExact`.
     *
     * @returns {"cached"|"stale"|"newer"}
     */
    _putG(rec) {
        const key = rec.key || plateKey(rec.frameId, rec.q, rec.i, rec.j);
        const f = this.inflight.get(key);
        const refused = !!f && f.refused && (rec.jobId == null || f.jobId === rec.jobId);
        this._endKey(key, rec.jobId);
        this.s.puts++;
        if (rec.bitmap && typeof rec.bitmap.close === "function") this.s.bitmapsOpen++;
        const cur = this.cache.get(key);
        if (refused || rec.G == null || (cur && !cur.dead && !(rec.G > cur.G))) {
            if (rec.G == null) this.s.noEpoch++;
            closeOf(rec, this.s);
            this._untrackIfIdle(key);
            if (!refused && cur && !cur.dead && this.isExact(cur)) return "cached";
            this.s.stalePuts++;
            return "stale";
        }
        const inBase = this._base.has(key), inLadder = this._ladder.has(key);
        if (cur) { if (!this.isExact(cur)) this.s.staleReplaced++; this._remove(key, true); this.s.replaced++; }
        const bytes = rec.bytes != null ? rec.bytes : PLATE_BYTES;
        const entry = {
            key, frameId: rec.frameId, q: rec.q, Zq: rec.Zq, i: rec.i, j: rec.j,
            bitmap: rec.bitmap || null, pixels: rec.pixels || null,
            bytes, G: rec.G, lru: ++this._clock,
        };
        const box = rectOf(entry);
        if (!box) this.s.noZq++;
        this.cache.set(key, entry);
        this.fresh.track(key, entry.frameId, box || EVERYWHERE_BOX, rec.G);
        if (inBase) this._base.add(key);
        if (inLadder) this._ladder.add(key);
        this.bytes += bytes;
        const exact = this.isExact(entry);
        if (!exact) this.s.staleNewer++;
        this._evict();
        return exact ? "cached" : "newer";
    }

    /** Rule 2 (A2 §3.1): the plate reflects every commit that could change its pixels. */
    isExact(e) {
        if (!this.fresh) return e.epoch === this.epochOf(e.key);
        return e.G >= this.fresh.dirtySince(e.key);
    }

    /** A key neither stored nor in flight leaves the freshness source's tracked set. */
    _untrackIfIdle(key) {
        if (this.fresh && !this.cache.has(key) && !this.inflight.has(key)) this.fresh.untrack(key);
    }

    /** A hard drop's jobs still in flight deliver nothing for their keys. */
    _refuse(f) { f.refused = true; }

    // ---- the invalidation epoch and the in-flight map (D25, §8.4 rule 4) ----

    /** The epoch a job must carry for this key; 0 for a key nothing has ever dropped. */
    epochOf(key) { const e = this.epochs.get(key); return e === undefined ? 0 : e; }
    /** Is a job's epoch for this key still the current one? Checked before dispatch and on arrival. */
    isCurrent(key, epoch) { return epoch === this.epochOf(key); }

    /**
     * Record a strip as in flight and return its epochs, in the job's own plate order
     * (§3.3's `epochs`). `plates` is `want`'s miss list, or any `[{ key, i, j }]`.
     */
    beginJob(jobId, view, plates, G) {
        const out = this.fresh ? null : new Int32Array(plates.length);
        const keys = [];
        for (let n = 0; n < plates.length; n++) {
            const p = plates[n];
            const key = p.key || plateKey(view.frameId, view.q, p.i, p.j);
            keys.push(key);
            if (this.fresh) {
                const f = { jobId, key, frameId: view.frameId, q: view.q, Zq: view.Zq, i: p.i, j: p.j, G, refused: false };
                this.inflight.set(key, f);
                this.fresh.track(key, view.frameId, rectOf(f) || EVERYWHERE_BOX, G);
                continue;
            }
            const epoch = this.epochOf(key);
            out[n] = epoch;
            this.inflight.set(key, { jobId, key, frameId: view.frameId, q: view.q, Zq: view.Zq, i: p.i, j: p.j, epoch });
        }
        this.jobs.set(jobId, keys);
        return out;
    }

    /** The job came back, failed, or was abandoned before dispatch. */
    endJob(jobId) {
        const keys = this.jobs.get(jobId);
        if (!keys) return 0;
        this.jobs.delete(jobId);
        let n = 0;
        for (const key of keys) { const f = this.inflight.get(key); if (f && f.jobId === jobId) { this.inflight.delete(key); n++; this._untrackIfIdle(key); } }
        return n;
    }

    /** Plates in flight whose epoch is already behind: the work §8.4 rule 4 drops before dispatch. */
    staleInFlight() {
        let n = 0;
        for (const f of this.inflight.values()) if (this.fresh ? f.G < this.fresh.dirtySince(f.key) : f.epoch !== this.epochOf(f.key)) n++;
        return n;
    }

    // ---- the five invalidation rules (§5.4) ----

    /**
     * Rule 1 — every plate whose painted-id set holds `id`, which is **one id or a `Set` of
     * them**: a drag's collapsed invalidation names every moved id at once and must walk the
     * cache once, not once an id (PAPER-PLAN R3). A plate with no id set cannot be tested and is
     * dropped (counted in `noIds`); nothing in the shipped path leaves one out.
     *
     * @param {number|Set<number>} id
     */
    dropById(id) {
        const many = id instanceof Set;
        if (many && !id.size) return 0;
        let n = 0;
        for (const e of [...this.cache.values()]) {
            if (e.ids) {
                if (many) { if (!anyId(e.ids, id)) continue; } else if (!holdsId(e.ids, id)) continue;
            } else this.s.noIds++;
            this._drop(e.key); n++;
        }
        this.s.dropsById += n;
        return n;
    }

    /**
     * Rules 2 and 3 — the drawn footprint, mapped into **every frame the cache holds** and
     * not only the active one, and into every frame a job is in flight for. `foot` is
     * `(frameId) => rect | rect[] | null`, called once per distinct frame (`TileStore`'s own
     * per-level memo, `TileStore.js:482-500`).
     *
     * The rect is the object's **drawn** box — its bbox plus `lwFrame / 2` for a stroke, in
     * that frame's own units, with `res` applied, at the old address and the new — as
     * `TileStore._addObject`'s own overlap test builds it. A bare bbox leaves the plates
     * holding a fat stroke's outer edge undropped, which D77's one device pixel does not
     * cover.
     */
    dropRectPerFrame(foot) {
        if (!foot) return 0;
        const memo = new Map(), bumped = new Set();
        const rectsFor = (frameId) => {
            if (memo.has(frameId)) return memo.get(frameId);
            const r = foot(frameId);
            const arr = !r ? [] : (Array.isArray(r) ? r : [r]);
            memo.set(frameId, arr);
            return arr;
        };
        const hit = (p) => {
            const rects = rectsFor(p.frameId);
            if (!rects.length) return false;
            const box = rectOf(p);
            for (const r of rects) if (meets(box, r)) return true;
            return false;
        };
        let n = 0;
        for (const e of [...this.cache.values()]) {
            if (!hit(e)) continue;
            this._drop(e.key); bumped.add(e.key); n++;
        }
        // A plate in flight is in no id set and in no cache, so this is the only rule that
        // can reach it — which is what the epoch is for (D25).
        for (const f of [...this.inflight.values()]) {
            if (bumped.has(f.key) || !hit(f)) continue;
            this._bump(f.key); bumped.add(f.key); n++;
        }
        this.s.dropsByRect += n;
        return n;
    }

    /**
     * Every plate at one quantum, cached and in flight — the settle's own drop (§6.3, D83).
     * The settled plates are keyed `q = "e"` so the cache is not polluted with one quantum
     * per zoom the user stopped at, and that key carries **no zoom of its own**: a plate
     * settled at one exact zoom is a hit at any other until this drops it, so
     * `dropQuantum("e")` on the next camera move is a correctness rule and not housekeeping.
     * The epoch is bumped like any invalidating drop, which is what refuses a settle job
     * still in flight when the camera moved.
     */
    dropQuantum(q) {
        const qs = String(q);              // the key concatenates q, so 3 and "3" are one quantum
        const bumped = new Set();
        let n = 0;
        for (const e of [...this.cache.values()]) {
            if (String(e.q) !== qs) continue;
            // A HARD remove, not `_drop`: a settled plate must never survive as a stale hit and
            // must never be a fallback, because `"e"` carries no zoom of its own (D83).
            this._remove(e.key); this._bump(e.key);
            this._pins.delete(e.key); this._held.delete(e.key); bumped.add(e.key); n++;
        }
        for (const f of [...this.inflight.values()]) {
            if (String(f.q) !== qs) continue;
            if (this.fresh) { this._refuse(f); if (!bumped.has(f.key)) n++; continue; }
            if (bumped.has(f.key)) continue;
            this._bump(f.key); bumped.add(f.key); n++;
        }
        this.s.dropsByQ += n;
        return n;
    }

    /**
     * A request the camera moved PAST (PAPER-PLAN R1): its stragglers are refused and its cached
     * plates are kept, unpinned, as the best fallbacks on the screen. The document did not
     * change, so a cached plate at this quantum is **not** stale and its epoch does not move —
     * which is the whole difference from `dropQuantum`, whose hard remove is D83's correctness
     * rule for the settle's `"e"` and must stay one.
     *
     * @returns {number} keys touched: the in-flight ones bumped, the cached ones unpinned
     */
    abandonQuantum(q) {
        const qs = String(q);
        let n = 0;
        for (const e of this.cache.values()) {
            if (String(e.q) !== qs) continue;
            this._pins.delete(e.key); this._held.delete(e.key); n++;
        }
        for (const f of [...this.inflight.values()]) {
            if (String(f.q) !== qs) continue;
            // the pin of a key nothing ever cached is the half `dropQuantum` cannot reach either
            this._pins.delete(f.key); this._held.delete(f.key);
            if (this.fresh) this._refuse(f); else this._bump(f.key);
            n++;
        }
        this.s.abandons++;
        return n;
    }

    /**
     * Rule 4 — a frame event, and `reset`: everything goes, cached and in flight alike, with
     * every bitmap closed. It does NOT stale (R1's exception): a frame event changes what a
     * `frameId` MEANS, so a kept plate is not old ink at the right place but possibly ink at the
     * wrong one, which is worse than paper; and `release` must free memory on a hidden tab.
     */
    dropAll(keepStandIns = true) {
        const bumped = new Set();
        let n = 0;
        // A landing drag plane and the base keep their plates, staled: the moved picture's own (S4)
        // and the last cover a zoom-out or a pan has (§10.13). A reset is another document: nothing stays.
        if (!keepStandIns) { this._plane = new Set(); this._base = new Set(); }
        for (const e of [...this.cache.values()]) {
            if (!this._plane.has(e.key) && !this._base.has(e.key)) this._remove(e.key);
            this._bump(e.key); bumped.add(e.key); n++;
        }
        for (const f of [...this.inflight.values()]) {
            if (this.fresh) { this._refuse(f); if (!bumped.has(f.key)) n++; continue; }
            if (bumped.has(f.key)) continue;
            this._bump(f.key); bumped.add(f.key); n++;
        }
        this._pins = new Set();
        this._held.clear();
        this.s.dropsAll++;
        return n;
    }

    /**
     * Rule 4, narrowed for a subtree move (PAPER-PLAN §10, review major 3): REMOVE every plate of a
     * frame `pred` names — a moved frame or one under it, whose surroundings changed — and nothing
     * else; the caller stales what the move uncovered or covered elsewhere with `dropRectPerFrame`.
     * `dropAll` at a frame drop blanked the whole screen, fallbacks and ladder included.
     *
     * @param {(frameId:*)=>boolean} pred
     */
    dropFrames(pred) {
        const bumped = new Set();
        let n = 0;
        for (const e of [...this.cache.values()]) {
            if (this._plane.has(e.key) || !pred(e.frameId)) continue;
            this._remove(e.key); this._bump(e.key);
            this._pins.delete(e.key); this._held.delete(e.key); bumped.add(e.key); n++;
        }
        for (const f of [...this.inflight.values()]) {
            if (!pred(f.frameId)) continue;
            if (this.fresh) { this._refuse(f); if (!bumped.has(f.key)) n++; continue; }
            if (bumped.has(f.key)) continue;
            this._bump(f.key); n++;
        }
        this.s.dropsFrames += n;
        return n;
    }

    // Rule 5 is that a frame CROSSING drops nothing, so it has no method here: the key
    // carries the frame, an inactive frame's plates are retained and fall out by the byte
    // cap like anything else, and that is what lets §5.6 pre-raster the child frame before
    // the crossing and makes crossing back a hit.

    /**
     * The `visibilitychange` release: the whole cache, every bitmap closed, and the picture
     * layer told so it can drop its canvas on the same event (§6.6). Installed by the
     * constructor; public so a test and the engine can call it directly.
     */
    release(reason = "hidden") {
        this._plane = new Set();                     // a hidden tab frees everything
        const n = this.dropAll();
        this.s.releases++;
        if (this.onRelease) this.onRelease(reason);
        return n;
    }

    /**
     * §5.4's mapping from one document event to the rules, with `KobinEngine` supplying the
     * footprint because it is the only thing that knows the lattice. Events are DRAINED at
     * the top of a render and never handled where they arrive: `Document.at` settles a moved
     * frame inside `_buildList`, so a handler on the event would drop plates the compose two
     * steps later is about to use.
     *
     * @param {{kind:string, id?:number, obj?:object, live?:boolean}} ev
     * @param {((frameId:string|number)=>object|object[]|null)|null} foot
     */
    onDocEvent(ev, foot) {
        if (!ev) return 0;
        const k = ev.kind;
        if (k === "reset") return this.dropAll(false);
        if (k === "refile" || k === "removeFrame" || k === "addFrame" || k === "mergeFrame" || k === "splitFrame") {
            return this.dropAll();
        }
        // A growing stroke is drawn by the SVG overlay, not into a plate (decision 4), and
        // `finalize` announces it — `TileStore._onDoc`'s own rule.
        if (k === "add" && ev.live) return 0;
        if (!ev.obj && k !== "remove") return 0;
        let n = 0;
        if (ev.id != null) n += this.dropById(ev.id);
        n += this.dropRectPerFrame(foot);
        return n;
    }

    // ---- the perf record (§8.5) ----

    /** How many document events one render drained, and how often. */
    noteDrain(n) { this.s.drains++; this.s.drainedEvents += n; }
    /** A dpr change resizes the canvas and leaves every plate valid: dpr is not in the key (D27). */
    noteDpr(dpr) { this.s.dpr = dpr; return this.cache.size; }

    /** A bounded object for the report's `raster` section: scalars only (F58). */
    report() {
        return {
            plates: this.cache.size, plateBytes: this.bytes, maxBytes: this.maxBytes,
            phone: this.phone, pinned: this._pins.size, pinnedAdded: this._held.size, base: this._base.size,
            inFlight: this.inflight.size, staleInFlight: this.staleInFlight(),
            epochKeys: this.epochs.size, trackedKeys: this.fresh ? this.fresh.stats.tracked : 0,
            // `plateBytes` no longer falls when the document changes (R1), so a reader of a phone
            // report needs to see how much of the cap is spent on ink the document has left.
            ...this._staleBytes(),
            ...this.s,
        };
    }

    /** Drop everything and unhook the listener. */
    destroy() {
        this.dropAll(false);                        // the plane's and the base's too: every bitmap closed
        if (this._onVis && this._doc) this._doc.removeEventListener("visibilitychange", this._onVis);
        this._onVis = null;
        if (this._hideTimer != null) { clearTimeout(this._hideTimer); this._hideTimer = null; }
        this.inflight.clear();
        this.jobs.clear();
        this.epochs.clear();
    }

    // ---- internals ----

    /**
     * Evict until the byte cap is met: stale first, then by LRU, the ladder's rungs last. Never a
     * pinned plate (the visible set and the added one: a held quantum and an incoming one live at
     * once, D178), the drag plane's or the base. A stale plate on screen is pinned by `want`, so
     * R1's protection of the screen needs no rule here.
     */
    _evict() {
        if (this.bytes <= this.maxBytes) return;
        const evictable = [];
        for (const e of this.cache.values()) {
            if (this._pins.has(e.key) || this._held.has(e.key) || this._plane.has(e.key) || this._base.has(e.key)) continue;
            // Stale first, then by LRU, and the zoom-out ladder's plates LAST (PAPER-PLAN R5b): a
            // fast zoom-out's own plates are worthless a tick later and pushed the ladder out
            // oldest-first — 182 evictions measured over one gesture on the Magnum Opus.
            e.st = this._isStale(e) ? 0 : this._ladder.has(e.key) ? 2 : 1;   // computed once, so the comparator does no lookups
            evictable.push(e);
        }
        evictable.sort((a, b) => (a.st - b.st) || (a.lru - b.lru));
        for (const e of evictable) {
            if (this.bytes <= this.maxBytes) break;
            // An eviction is not an invalidation: a FRESH plate's pixels are still right, so the
            // epoch is NOT bumped and a result in flight for that key is still worth caching.
            if (e.st === 0) this.s.staleEvictions++;
            else if (e.st === 2) this.s.ladderEvictions++;
            this._remove(e.key);
            this.s.evictions++;
        }
        if (this.bytes > this.maxBytes) this.s.overCapPinned++;
    }

    /**
     * Take a plate out of the cache and close its bitmap — the ONLY path that closes one.
     * `dead` is set before the close because `PictureLayer._hits` and a fallback list hold store
     * entries between composes, and `drawImage` on a closed `ImageBitmap` throws in Chrome; the
     * drawable test refuses a dead entry (PAPER-PLAN §7.1, A's risk 1).
     */
    _remove(key, replacing = false) {
        const e = this.cache.get(key);
        if (!e) return false;
        this.cache.delete(key);
        this._ladder.delete(key);
        this._base.delete(key);
        this.bytes -= e.bytes;
        e.dead = true;
        closeOf(e, this.s);
        if (!replacing) this._untrackIfIdle(key);
        return true;
    }

    /**
     * An invalidating drop: the epoch moves and **the pixels stay**, as a stale hit, until the
     * replacement `put`s or an eviction takes it (PAPER-PLAN R1). `this.bytes` is not decremented
     * — a stale plate is real memory and must be inside §6.6's cap.
     */
    _drop(key) {
        this._bump(key);                            // ALWAYS, cached or not — D25 is unchanged
        if (this.cache.has(key)) this.s.staleKept++;
    }

    /** Is this record's ink behind the document? Derived from the epoch map, never flagged (D25). */
    _isStale(e) { return !this.isExact(e); }

    /** Stale records and the bytes they hold: §6.6's cap is now partly spent on old ink. */
    _staleBytes() {
        let n = 0, bytes = 0;
        for (const e of this.cache.values()) if (this._isStale(e)) { n++; bytes += e.bytes; }
        return { stale: n, staleBytes: bytes };
    }

    /** Bump a key's epoch — including a key that is not cached, which is the whole point (D25). */
    _bump(key) {
        if (this.fresh) return;
        this.epochs.set(key, this.epochOf(key) + 1);
        this.s.epochBumps++;
        if (this.epochs.size > EPOCH_MAX) this._pruneEpochs();
    }

    /** Keep the epochs of what is cached or in flight; nothing else can carry a stale one. */
    _pruneEpochs() {
        for (const key of [...this.epochs.keys()]) {
            if (this.cache.has(key) || this.inflight.has(key)) continue;
            this.epochs.delete(key);
            this.s.epochPrunes++;
        }
    }

    /**
     * A result arrived for this key: it is no longer in flight. `jobId`, when the caller has
     * it, keeps a LATE result from job A from cancelling the re-post job B is running for the
     * same plate — `endJob` matches on the same field.
     */
    _endKey(key, jobId) {
        const f = this.inflight.get(key);
        if (!f || (jobId != null && f.jobId !== jobId)) return;
        this.inflight.delete(key);
        const keys = this.jobs.get(f.jobId);
        if (keys) {
            const at = keys.indexOf(key);
            if (at >= 0) keys.splice(at, 1);
            if (!keys.length) this.jobs.delete(f.jobId);
        }
    }
}

/** Close a plate's bitmap, wherever it is dropped from. */
function closeOf(holder, s) {
    const b = holder && holder.bitmap;
    if (b && typeof b.close === "function") { b.close(); s.bitmapsClosed++; }
}
