/**
 * PyramidStore.js — the picture pyramid's plate cache (A3 §1.1, §4.5; A2 §3.1–§3.3): level, rest and plane
 * records under `level.js`'s keys, each carrying the G its job was packed at; LRU by bytes with the drawn set
 * and the plane pinned and the protected classes evicted last; the in-flight map; the hidden-tab release.
 *
 *   - Rule 1 (`put`): a record is kept iff none is stored or its G is newer. An older or equal arrival is
 *     closed. A newer one still behind the dirt is kept and counts as stale (F106).
 *   - Rule 2 (`exact`): `r.G ≥ fresh.dirtySince(r.key)`, read at every call — a commit can land between two
 *     composes — and kept on the record as `dirtyG`.
 *   - Every key stored or in flight is tracked by the freshness source (the Stage) from `beginJob` or `put`
 *     until neither holds it; a hard drop refuses the jobs it finds in flight, so they land nothing.
 *   - Only `_remove` closes a bitmap, and it marks the record `dead` first: a compose holding it draws nothing.
 *   - Pinned ≤ `pinnedBound` by construction (PLAN §5.6 M2): the drawn set is `PicturePyramid`'s plan — one
 *     own-grid record per view cell and at most COMPOSE_IMAGES stand-ins — and the plane pins at most its cap.
 *     The byte budget never goes under that bound.
 *   - The RAM tier (F161, `plateRam.js`): an evicted or released level plate that is exact goes there packed. Its key
 *     stays tracked, so `restorable` judges it as rule 2 judges a record. A newer plate or a hard drop takes it out; a
 *     patched plate never goes (its words are the old pixels).
 *
 * It holds no camera, no document and no lattice: `setView` hands it the view's level, ring, rest set, path
 * and the prefetch's far set, which is all the eviction order reads.
 */
import { PLATE_PX } from "./plate";
import { COMPOSE_IMAGES, LEVEL_HYST, MOVE_PLANE_PLATES, MOVE_PLANE_PLATES_PHONE, levelKey, planeKey, restKey, sigmaMinFor, viewPlates, zOf } from "./level";
import PlateRam from "./plateRam";

/** Bytes one 512² RGBA plate costs, as a bitmap or as raw pixels: exactly 1 MiB. */
export const PLATE_BYTES = PLATE_PX * PLATE_PX * 4;
const MiB = 1024 * 1024;
/** Device pixels a cell's box is grown by before a footprint is tested against it. */
const EDGE_PAD_PX = 1;
/** How long a desktop tab stays hidden before its plates are released (a phone releases at once). */
export const HIDDEN_RELEASE_MS = 5 * 60 * 1000;
/** Eviction ranks, evicted lowest first: the unprotected classes, then the protected in A3 §4.5's order. */
export const RANK = Object.freeze({ STALE: 0, OFF_PATH: 1, FINER: 2, LEVELS: 3, FAR: 4, LEFT: 5, NEAR: 6, REST: 7, RING: 8 });

/** No freshness source: every record is exact (a suite with no document). */
const ALWAYS_EXACT = { track() {}, untrack() {}, dirtySince: () => 0, stats: { tracked: 0 } };

/**
 * The phone budget: a budget, not a capability test (a phone report reads against a desktop one).
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

/** One view in plates (= MiB): `viewPlates` at the band's floor σmin·2^−h for a wDev × hDev screen (A3 §1.3, §4.5). */
export function viewUnit(wDev, hDev) {
    return viewPlates(sigmaMinFor(wDev, hDev) * 2 ** -LEVEL_HYST, Math.max(1, wDev), Math.max(1, hDev));
}

/** The plane's pin cap on this device. */
export const planeCap = (phone) => (phone ? MOVE_PLANE_PLATES_PHONE : MOVE_PLANE_PLATES);

/**
 * The most own-grid records a plan draws, one per view cell: the level view at the band's floor σmin·2^−h, or
 * the rest set at σ = 1 (77 on a 2560×1440@2 screen, where one view is 54).
 */
export function ownBound(wDev, hDev) {
    return Math.max(viewUnit(wDev, hDev), viewPlates(1, Math.max(1, wDev), Math.max(1, hDev)));
}

/** The pinned bound in plates (= MiB), PLAN §5.6 M2: own-grid records + COMPOSE_IMAGES stand-ins + the plane cap. */
export function pinnedBound(wDev, hDev, phone) {
    return ownBound(wDev, hDev) + COMPOSE_IMAGES + planeCap(phone);
}

/**
 * The cache budget in bytes: `views` views, never under the pinned bound (the floor) nor over the ceiling,
 * which is itself never under the floor (99 MiB on a 390×844@3 phone against the lever's 96). `cfg` carries
 * `plateViews` and `plateCeilingMiB` (`devLevers.js`).
 */
export function budgetBytes(cfg, wDev, hDev, phone) {
    const floor = pinnedBound(wDev, hDev, phone);
    const views = cfg && cfg.plateViews > 0 ? cfg.plateViews : (phone ? 2 : 3);
    const ceiling = Math.max(floor, cfg && cfg.plateCeilingMiB > 0 ? cfg.plateCeilingMiB : (phone ? 96 : 256));
    return Math.min(ceiling, Math.max(floor, views * viewUnit(wDev, hDev))) * MiB;
}

/** The RAM tier's budget in bytes (F161): `cfg.plateRamMiB` (0 turns it off), else 64 MiB on a desktop and 24 on a phone. */
export function ramBudgetBytes(cfg, phone) {
    const v = cfg && cfg.plateRamMiB != null ? cfg.plateRamMiB : (phone ? 24 : 64);
    return Math.max(0, v) * MiB;
}

/** The far zoom-out levels' own share (F166): `cfg.plateFarMiB` (0 shares the one budget), else 96 MiB on a desktop and 64 on a phone. */
export function farBudgetBytes(cfg, phone) {
    const v = cfg && cfg.plateFarMiB != null ? cfg.plateFarMiB : (phone ? 64 : 96);
    return Math.max(0, v) * MiB;
}

/** A level plate's cell: frame F at Z(ℓ) for step S. The descriptor `beginJob`, `put` and the plan share. */
export function levelCell(F, l, S, i, j) {
    return { key: levelKey(F, l, S, i, j), frame: String(F), kind: "level", level: l, S, Z: zOf(l, S), tag: null, i, j };
}
/** A rest plate's cell: frame F at the exact zoom Z. */
export function restCell(F, Z, i, j) {
    return { key: restKey(F, Z, i, j), frame: String(F), kind: "rest", level: null, S: null, Z, tag: null, i, j };
}
/** A plane plate's cell: layer `tag` at the plane's zoom Zp. */
export function planeCell(F, Zp, tag, i, j) {
    return { key: planeKey(F, Zp, tag, i, j), frame: String(F), kind: "plane", level: null, S: null, Z: Zp, tag, i, j };
}

/** A cell's box in its frame's units, grown by `pad` device px of its own grid; null when the zoom is unusable. */
export function cellBox(c, pad = EDGE_PAD_PX) {
    const Z = c.Z;
    if (!(Z > 0) || !isFinite(Z) || typeof c.i !== "number" || typeof c.j !== "number") return null;
    const s = PLATE_PX / Z, p = pad / Z;
    return { left: c.i * s - p, top: c.j * s - p, right: (c.i + 1) * s + p, bottom: (c.j + 1) * s + p };
}
const EVERYWHERE = Object.freeze({ left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });

export default class PyramidStore {
    /**
     * @param {object} [opts]
     * @param {object} [opts.fresh] the Stage: `track`, `untrack`, `dirtySince` (none: every record exact)
     * @param {number} [opts.maxBytes] the byte cap (else `budgetBytes(opts.cfg, …)` for the screen)
     * @param {object} [opts.cfg] `plateViews`, `plateCeilingMiB` @param {number} [opts.wDev] @param {number} [opts.hDev]
     * @param {object} [opts.env] `{ deviceMemory, screenW, screenH }`, for the phone budget in a test
     * @param {boolean} [opts.phone] the phone budget, overriding `env`
     * @param {Document|null} [opts.doc] where the `visibilitychange` listener goes
     * @param {(reason:string)=>void} [opts.onRelease] after a release, so the picture drops its surface too
     * @param {number} [opts.ramBytes] the RAM tier's budget (F161); none or 0: no RAM tier
     */
    constructor(opts = {}) {
        this.fresh = opts.fresh || ALWAYS_EXACT;
        this.phone = opts.phone != null ? !!opts.phone : isPhoneBudget(opts.env);
        this.maxBytes = opts.maxBytes != null ? opts.maxBytes : budgetBytes(opts.cfg, opts.wDev || 1280, opts.hDev || 800, this.phone);
        this.ram = new PlateRam(opts.ramBytes || 0);
        this._ramSeq = 0;
        // The far levels' own share (F166): counted apart from `maxBytes`, so the screen's records and the zoom-out's
        // levels never evict each other; 0 keeps the one budget (`setFarBudget`).
        this.farMaxBytes = opts.farBytes != null ? opts.farBytes : 0;
        this.zoomDir = 0;             // the last zoom's direction, −1 out, +1 in, 0 none (the renderer's): the eviction's order
        this._evicted = new Map();    // the last evictions, key -> rank (the paper log's "evicted")
        this.cache = new Map();       // key -> record
        this.inflight = new Map();    // key -> { jobId, key, cell, G, refused }
        this.jobs = new Map();        // jobId -> cell descriptors
        this._refusedJobs = new Set();
        this.heldEra = 1;             // the drag whose held ink packs leave out (`omitHeld`); a drag's end moves it (F153)
        this._levelFrames = new Map(); // frame -> level records held there
        this.bytes = 0;
        this.heldBytes = 0;           // results a group holds aside: counted against the cap (A3 §3.6)
        this._drawn = new Set();
        this._plane = new Set();
        this._view = null;
        this._clock = 0;
        this.onRelease = opts.onRelease || null;
        this.onShow = null;           // (released) => …, at every return to visible: `released` after a hidden release
        this.s = {
            puts: 0, kept: 0, newer: 0, older: 0, refused: 0, noG: 0, replaced: 0, patches: 0,
            evictions: 0, evictedByRank: new Array(9).fill(0), overCapPinned: 0,
            drops: 0, dropsAll: 0, dropsFrames: 0, releases: 0,
            bitmapsOpen: 0, bitmapsClosed: 0,
        };
        this._doc = opts.doc !== undefined ? opts.doc : (typeof document !== "undefined" ? document : null);
        this._onVis = null;
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
                const released = this._releasedHidden;
                this._releasedHidden = false;
                if (this.onShow) this.onShow(released);
            };
            this._doc.addEventListener("visibilitychange", this._onVis);
        }
    }

    // ---- reads ----

    /** The tab is hidden (`visibilityState`): a commit's patch step waits for the return (PLAN §5.22 item 3). */
    get hidden() { return !!this._doc && this._doc.visibilityState === "hidden"; }

    /** The live record under `key`, or undefined. */
    get(key) { return this.cache.get(key); }

    /** Rule 2: the record reflects every commit that could change its pixels. */
    exact(r) {
        const d = this.fresh.dirtySince(r.key);
        r.dirtyG = d;
        return r.G >= d;
    }

    /** A job for `key` is in flight, not refused, and packed at or after its dirt: posting it again adds nothing. */
    inFlightExact(key) {
        const f = this.inflight.get(key);
        return !!f && !f.refused && f.G >= this.fresh.dirtySince(key);
    }

    /** Does the cell still need a job: nothing exact stored and nothing exact in flight? */
    wants(key) {
        const r = this.cache.get(key);
        return !(r && this.exact(r)) && !this.inFlightExact(key);
    }

    /** The frames that hold level records. */
    framesWithLevels() { return this._levelFrames.keys(); }

    /** A result packed without a drag's held ink (`omitHeld`, that drag's era) after that drag ended: never stored (F153). */
    heldStale(rec) { return !!rec.omitHeld && rec.omitHeld !== this.heldEra; }

    /** Every live record. */
    records() { return this.cache.values(); }

    // ---- arrivals ----

    /**
     * Rule 1. `rec` is a cell descriptor (`levelCell`, `restCell`, `planeCell`) with `G`, `bitmap` or
     * `pixels` (null for an empty, paper, plate), `bytes` and the `jobId` that brought it.
     * @returns {"cached"|"newer"|"stale"|"refused"}
     */
    put(rec) {
        const key = rec.key;
        const f = this.inflight.get(key);
        const refused = (rec.jobId != null && this._refusedJobs.has(rec.jobId)) || (!!f && f.refused && (rec.jobId == null || f.jobId === rec.jobId))
            || this.heldStale(rec);
        this._endKey(key, rec.jobId);
        this.s.puts++;
        if (rec.bitmap && typeof rec.bitmap.close === "function") this.s.bitmapsOpen++;
        const cur = this.cache.get(key);
        if (refused || rec.G == null || (cur && !(rec.G > cur.G))) {
            if (refused) this.s.refused++; else if (rec.G == null) this.s.noG++; else this.s.older++;
            closeOf(rec, this.s);
            this._untrackIfIdle(key);
            return refused ? "refused" : "stale";
        }
        if (cur) { this._remove(key, true); this.s.replaced++; }
        this.ram.delete(key);                           // this plate supersedes the RAM tier's (its key is tracked below)
        const bytes = rec.bytes != null ? rec.bytes : (rec.bitmap || rec.pixels ? PLATE_BYTES : 0);
        const r = {
            key, frame: String(rec.frame), kind: rec.kind, level: rec.level, S: rec.S, Z: rec.Z, tag: rec.tag, i: rec.i, j: rec.j,
            G: rec.G, dirtyG: 0, bitmap: rec.bitmap || null, pixels: rec.pixels || null, bytes, lru: ++this._clock, dead: false,
            packed: rec.packed || null, patched: false, omitHeld: rec.omitHeld || 0,
        };
        this.cache.set(key, r);
        this.bytes += bytes;
        if (r.kind === "level") this._levelFrames.set(r.frame, (this._levelFrames.get(r.frame) || 0) + 1);
        this.fresh.track(key, r.frame, cellBox(r) || EVERYWHERE, r.G);
        const exact = this.exact(r);
        if (exact) this.s.kept++; else this.s.newer++;
        this._evict();
        return exact ? "cached" : "newer";
    }

    /**
     * A patch landed in record `key` (A3 §3.2): its new pixels, and its G raised to `G` when `covers` (the
     * patch's clip holds every dirty rect since the record's G). The old bitmap is closed unless it is the new one.
     * @returns {boolean} whether the record was there to patch
     */
    patch(key, { bitmap = null, pixels = null, G, covers = true, omitHeld = 0 }) {
        const r = this.cache.get(key);
        if (!r) return false;
        if (omitHeld) r.omitHeld = omitHeld;
        if (bitmap && r.bitmap !== bitmap) {
            if (typeof bitmap.close === "function") this.s.bitmapsOpen++;
            closeOf(r, this.s);
            r.bitmap = bitmap;
        }
        if (pixels) r.pixels = pixels;
        r.packed = null; r.patched = true;              // its words are the old pixels (F161)
        if (r.bytes === 0) { r.bytes = PLATE_BYTES; this.bytes += PLATE_BYTES; }
        if (covers && G > r.G) {
            r.G = G;
            this.fresh.track(key, r.frame, cellBox(r) || EVERYWHERE, G);
        }
        r.lru = ++this._clock;
        this.s.patches++;
        this._evict();
        return true;
    }

    /** Results a group holds aside count against the cap (A3 §3.6); `n` bytes more (or fewer, negative). */
    holdBytes(n) { this.heldBytes = Math.max(0, this.heldBytes + n); if (n > 0) this._evict(); }

    /** Close a result that will never be put (a group dropped, a discarded rest cell). */
    discard(rec) {
        if (rec && rec.bitmap && typeof rec.bitmap.close === "function") this.s.bitmapsOpen++;
        closeOf(rec, this.s);
    }

    // ---- the RAM tier (F161) ----

    /** The RAM tier holds a plate for `key` (exact or not: `restorable` decides). */
    ramHas(key) { return this.ram.has(key); }

    /**
     * The RAM tier's entry for `key` when it can stand for the cell now — still exact (no commit since its G met the
     * cell: its key stayed tracked), nothing stored or in flight for the key — else null. A stale entry is dropped.
     */
    restorable(key) {
        const e = this.ram.get(key);
        if (!e || this.cache.has(key) || this.inflight.has(key)) return null;
        if (e.G < this.fresh.dirtySince(key)) {
            this.ram.delete(key); this.ram.s.stale++;
            this._untrackIfIdle(key);
            return null;
        }
        return e;
    }

    /** Entry `e` (from `restorable`) leaves the RAM tier and is in flight as job `id`, under its own G, until its `put` or `endJob`. */
    beginRestore(e) {
        const id = "ram" + (++this._ramSeq);
        this.ram.delete(e.key);
        this.ram.s.takes++;
        this.beginJob(id, [{ key: e.key, frame: e.frame, kind: e.kind, level: e.level, S: e.S, Z: e.Z, tag: e.tag, i: e.i, j: e.j }], e.G);
        return id;
    }

    /**
     * First-view pictures (F166, `firstView.js`): level cells another session packed from this document, into the RAM tier
     * as entries exact at `G` — their keys tracked from `G`, so a commit after it outdates them. Least wanted first: the
     * tier keeps the newest. A key stored, in flight or already in the tier is left alone. Returns how many went in.
     */
    seedRam(cells, G) {
        if (!this.ram.maxBytes) return 0;
        let n = 0;
        for (const c of cells) {
            if (c.kind !== "level" || this.cache.has(c.key) || this.inflight.has(c.key) || this.ram.has(c.key)) continue;
            const e = { key: c.key, frame: String(c.frame), kind: "level", level: c.level, S: c.S, Z: c.Z, tag: null, i: c.i, j: c.j, G, packed: c.packed || null };
            this.fresh.track(e.key, e.frame, cellBox(e) || EVERYWHERE, G);
            for (const x of this.ram.put(e)) this._untrackIfIdle(x.key);
            n++;
        }
        return n;
    }

    /** A new budget for the RAM tier (0: off). */
    setRamBudget(bytes) { for (const e of this.ram.setBudget(bytes)) this._untrackIfIdle(e.key); }

    /** The far share's cap (F166; 0: one budget), and one eviction pass. */
    setFarBudget(bytes) { this.farMaxBytes = Math.max(0, bytes || 0); this._evict(); }

    /** `key` was evicted lately (the paper log, F166). */
    wasEvicted(key) { return this._evicted.has(key); }

    /**
     * Plates a plan may add to the far share (`far`) or to the general budget, beside what is pinned or protected there;
     * with no far share, one room for both.
     */
    roomFor(far) {
        const split = this.farMaxBytes > 0;
        let used = 0;
        for (const r of this.cache.values()) {
            const rank = this.rankOf(r);
            if (split && (rank === RANK.FAR) !== !!far) continue;
            if (this.isPinned(r.key) || rank >= RANK.FAR) used += r.bytes;
        }
        const cap = split && far ? this.farMaxBytes : this.maxBytes - this.heldBytes;
        return Math.max(0, Math.floor((cap - used) / PLATE_BYTES));
    }

    // ---- the in-flight map (A2 §3.2) ----

    /** A job packed at `G` for these cells (descriptors): each is in flight and tracked from now. */
    beginJob(jobId, cells, G) {
        for (const c of cells) {
            this.inflight.set(c.key, { jobId, key: c.key, cell: c, G, refused: false });
            this.fresh.track(c.key, c.frame, cellBox(c) || EVERYWHERE, G);
        }
        this.jobs.set(jobId, cells.slice());
    }

    /** The job came back, failed or was abandoned: its keys leave the in-flight map. */
    endJob(jobId) {
        const cells = this.jobs.get(jobId);
        this._refusedJobs.delete(jobId);
        if (!cells) return 0;
        this.jobs.delete(jobId);
        let n = 0;
        for (const { key } of cells) {
            const f = this.inflight.get(key);
            if (f && f.jobId === jobId) { this.inflight.delete(key); n++; this._untrackIfIdle(key); }
        }
        return n;
    }

    // ---- pins, the view, the budget ----

    /** The records the current plan draws: never evicted until the next plan replaces the set. */
    setDrawn(keys) { this._drawn = keys instanceof Set ? keys : new Set(keys); }
    /** The plane's plates (MovePlane's layers): never evicted while the plane lives. */
    setPlanePins(keys) { this._plane = keys instanceof Set ? keys : new Set(keys); }
    /** Pinned records: the drawn set and the plane's, counted once. */
    pinnedCount() {
        let n = 0;
        for (const k of this._drawn) if (this.cache.has(k)) n++;
        for (const k of this._plane) if (this.cache.has(k) && !this._drawn.has(k)) n++;
        return n;
    }
    isPinned(key) { return this._drawn.has(key) || this._plane.has(key); }

    /**
     * What the eviction order reads (A3 §4.5): `{ frame, level, S, ring: {i0, i1, j0, j1}, rest: {frame, Z} | null,
     * path: Map<frameId, shift>, left: frameId | null, far: Set<key> }`. `path` holds the view's frame (shift 0)
     * and its ancestors: a record at level ℓ in frame H is the view frame's level ℓ − shift(H).
     */
    setView(v) { this._view = v || null; }
    /** The context `setView` last set, or null. */
    get view() { return this._view; }

    /** A new byte cap, and one eviction pass (pins respected; `overCapPinned` counts a cap the pins exceed). */
    setBudget(bytes) { this.maxBytes = bytes; this._evict(); }

    // ---- the hard drops: the records go, their jobs in flight land nothing ----

    /**
     * A drag ended: every plate packed without its held ink goes, and what is still in flight of them is refused when it
     * lands (`heldStale`). A drop dirties only its moved boundaries' sweep, so such a plate would keep a hole (F153).
     * Returns the records gone: their cells must be asked for again.
     */
    endHeld() {
        this.heldEra++;
        const gone = [];
        for (const r of this.cache.values()) if (r.omitHeld) gone.push(r);
        if (gone.length) this.dropWhere((r) => !!r.omitHeld);
        return gone;
    }

    /**
     * Remove every record `pred` names and refuse its jobs in flight. `pred(r)` sees a record or a cell descriptor. The
     * RAM tier's entries it names go too — unless `toRam` (a release, not a hard drop), when the records go into it.
     */
    dropWhere(pred, spare = null, toRam = false) {
        let n = 0;
        for (const r of [...this.cache.values()]) {
            if (spare && spare(r)) continue;
            if (!pred(r)) continue;
            this._remove(r.key, false, toRam); n++;
        }
        if (!toRam) for (const e of this.ram.dropWhere(pred, spare)) this._untrackIfIdle(e.key);
        // By job, not through the in-flight map: a job that a newer one for the same key overtook is no longer in it.
        for (const [jobId, cells] of this.jobs) {
            if (this._refusedJobs.has(jobId)) continue;
            let hit = 0;
            for (const c of cells) if (!(spare && spare(c)) && pred(c)) hit++;
            if (!hit) continue;
            this._refusedJobs.add(jobId);
            for (const c of cells) { const f = this.inflight.get(c.key); if (f && f.jobId === jobId) f.refused = true; }
            n += hit;
        }
        this.s.drops += n;
        return n;
    }

    /** Every record of the frames `pred` names (their id now means another place); the plane's stay. */
    dropFrames(pred) {
        const n = this.dropWhere((r) => pred(r.frame), (r) => this._plane.has(r.key));
        this.s.dropsFrames += n;
        return n;
    }

    /** Everything: another document. */
    dropAll() {
        const n = this.dropWhere(() => true);
        this._drawn = new Set(); this._plane = new Set();
        this.s.dropsAll++;
        return n;
    }

    /**
     * The hidden-tab release: every record but the view frame's ℓv − 2 (PP §10.13's base, a few plates), so the
     * return is never paper; the picture is told so it drops its surface on the same event. The released plates go
     * into the RAM tier, which stays (F161).
     */
    release(reason = "hidden") {
        const v = this._view;
        const keep = v ? (r) => r.kind === "level" && r.frame === String(v.frame) && r.S === v.S && r.level === v.level - 2 : null;
        const n = this.dropWhere(() => true, keep, true);
        this._drawn = new Set(); this._plane = new Set();
        this.s.releases++;
        if (this.onRelease) this.onRelease(reason);
        return n;
    }

    // ---- the report ----

    report() {
        let stale = 0, staleBytes = 0;
        for (const r of this.cache.values()) if (!this.exact(r)) { stale++; staleBytes += r.bytes; }
        let farBytes = 0;
        for (const r of this.cache.values()) if (this.rankOf(r) === RANK.FAR) farBytes += r.bytes;
        return {
            plates: this.cache.size, plateBytes: this.bytes, heldBytes: this.heldBytes, maxBytes: this.maxBytes, phone: this.phone,
            farBytes, farMaxBytes: this.farMaxBytes, zoomDir: this.zoomDir,
            pinned: this.pinnedCount(), pinnedPlane: this._plane.size, stale, staleBytes,
            inFlight: this.inflight.size, trackedKeys: this.fresh.stats ? this.fresh.stats.tracked : 0,
            ...this.s, evictedByRank: this.s.evictedByRank.slice(), ram: this.ram.report(),
        };
    }

    destroy() {
        this.dropAll();
        this.ram.clear();
        if (this._onVis && this._doc) this._doc.removeEventListener("visibilitychange", this._onVis);
        this._onVis = null;
        if (this._hideTimer != null) { clearTimeout(this._hideTimer); this._hideTimer = null; }
        this.inflight.clear();
        this.jobs.clear();
        this._refusedJobs.clear();
    }

    // ---- internals ----

    /** The eviction rank of an unpinned record (A3 §4.5): lower is evicted first. */
    rankOf(r) {
        if (!this.exact(r)) return RANK.STALE;
        const v = this._view;
        if (!v) return RANK.LEVELS;
        if (r.kind === "plane") return RANK.OFF_PATH;
        if (r.kind === "rest") return v.rest && r.frame === String(v.rest.frame) && r.Z === v.rest.Z ? RANK.REST : RANK.OFF_PATH;
        if (v.far && v.far.has(r.key)) return RANK.FAR;
        if (v.left != null && r.frame === String(v.left)) {
            // The frame a crossing left stands in at the view's level and coarser; finer, it is what the zoom passed (F166).
            if (v.leftShift != null && r.S === v.S && r.level - v.leftShift > v.level) return RANK.FINER;
            return RANK.LEFT;
        }
        const shift = v.path ? v.path.get(r.frame) : (r.frame === String(v.frame) ? 0 : undefined);
        if (shift === undefined || r.S !== v.S) return RANK.OFF_PATH;
        const l = r.level - shift;
        if (l > v.level) return RANK.FINER;
        if (r.frame === String(v.frame)) {
            const g = v.ring;
            if (l === v.level && g && r.i >= g.i0 && r.i <= g.i1 && r.j >= g.j0 && r.j <= g.j1) return RANK.RING;
            if (l === v.level - 1 || l === v.level - 2) return RANK.NEAR;
        }
        return RANK.LEVELS;
    }

    /**
     * Evict until the caps hold. The general budget: by rank, then (among other levels) the farthest from ℓv, then LRU —
     * zooming in, finer levels after the other levels. The far share, apart (F166): its own records, oldest first. Never a
     * pinned record.
     */
    _evict() {
        if (this.bytes + this.heldBytes <= this.maxBytes) return;
        const v = this._view, split = this.farMaxBytes > 0, gen = [], far = [];
        let farBytes = 0;
        for (const r of this.cache.values()) {
            r._rank = this.rankOf(r);
            const inFar = split && r._rank === RANK.FAR;
            if (inFar) farBytes += r.bytes;
            if (this.isPinned(r.key)) continue;
            const shift = v && v.path ? v.path.get(r.frame) : 0;
            r._dist = r._rank === RANK.LEVELS && v && r.kind === "level" && shift !== undefined ? -Math.abs(r.level - shift - v.level) : 0;
            (inFar ? far : gen).push(r);
        }
        const pos = (r) => (r._rank === RANK.FINER && this.zoomDir > 0 ? RANK.LEVELS + 0.5 : r._rank);
        gen.sort((a, b) => (pos(a) - pos(b)) || (a._dist - b._dist) || (a.lru - b.lru));
        for (const r of gen) {
            if (this.bytes - farBytes + this.heldBytes <= this.maxBytes) break;
            this._evictOne(r);
        }
        if (this.bytes - farBytes + this.heldBytes > this.maxBytes) this.s.overCapPinned++;
        if (!split) return;
        far.sort((a, b) => a.lru - b.lru);
        for (const r of far) {
            if (farBytes <= this.farMaxBytes) break;
            farBytes -= r.bytes;
            this._evictOne(r);
        }
    }

    _evictOne(r) {
        this.s.evictedByRank[r._rank]++;
        this._remove(r.key, false, true);
        this.s.evictions++;
        this._evicted.delete(r.key);
        this._evicted.set(r.key, r._rank);
        if (this._evicted.size > 4096) this._evicted.delete(this._evicted.keys().next().value);
    }

    /** Take a record out and close its bitmap — the only path that closes a stored one; `toRam`: an eviction or a release (F161). */
    _remove(key, replacing = false, toRam = false) {
        const r = this.cache.get(key);
        if (!r) return false;
        this.cache.delete(key);
        this.bytes -= r.bytes;
        if (r.kind === "level") {
            const n = (this._levelFrames.get(r.frame) || 1) - 1;
            if (n > 0) this._levelFrames.set(r.frame, n); else this._levelFrames.delete(r.frame);
        }
        if (toRam) this._toRam(r);
        r.dead = true;
        closeOf(r, this.s);
        if (!replacing) this._untrackIfIdle(key);
        return true;
    }

    /** A key neither stored, in flight nor in the RAM tier leaves the freshness source's tracked set. */
    _untrackIfIdle(key) {
        if (!this.cache.has(key) && !this.inflight.has(key) && !this.ram.has(key)) this.fresh.untrack(key);
    }

    /**
     * An evicted or released record into the RAM tier (F161): a level plate, exact, with its packed words or empty (an
     * empty plate needs none). A patched plate's words are not its pixels any more, so it never goes.
     */
    _toRam(r) {
        if (!this.ram.maxBytes || r.kind !== "level" || r.omitHeld || !this.exact(r)) return;
        if (!r.packed && (r.bitmap || r.pixels || r.patched)) return;
        const out = this.ram.put({ key: r.key, frame: r.frame, kind: r.kind, level: r.level, S: r.S, Z: r.Z, tag: r.tag, i: r.i, j: r.j, G: r.G, packed: r.packed || null });
        for (const e of out) this._untrackIfIdle(e.key);
    }

    /** A result for `key` arrived: it is no longer in flight (only for the job that holds it, when the caller says which). */
    _endKey(key, jobId) {
        const f = this.inflight.get(key);
        if (!f || (jobId != null && f.jobId !== jobId)) return;
        this.inflight.delete(key);
        const cells = this.jobs.get(f.jobId);
        if (cells) {
            const at = cells.findIndex((c) => c.key === key);
            if (at >= 0) cells.splice(at, 1);
            if (!cells.length) this.jobs.delete(f.jobId);
        }
    }
}

/** Close a record's bitmap, wherever it is dropped from. */
function closeOf(holder, s) {
    const b = holder && holder.bitmap;
    if (b && typeof b.close === "function") { b.close(); s.bitmapsClosed++; }
}
