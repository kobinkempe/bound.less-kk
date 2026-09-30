/**
 * PicturePyramid.js — the ink canvas composed from the plate pyramid (A3 §1.3–§1.5, §2, §3.2–§3.5, §9.1;
 * PLAN §1.2). It publishes FC2's view, plans every screen cell freshness-first (§1.4), draws the plan directly
 * or through one surface (§1.5), runs the rest render (§2) and partial re-renders (§3), holds a pen-up's
 * results for one group commit (§3.6) and keeps the paper, blur and older integrals (§9.1).
 *
 *   - One affine per view (FC2): every source is placed by X = (g − o)·σ + d, g = p·Zq the view grid's
 *     pixels; destination edges are rounded to device px, so adjacent cells share an edge exactly.
 *   - Base plates are opaque: a later draw replaces an earlier one, so every pixel ends with one source.
 *     Rest mode draws the level plan under the rest cells that have no rest plate, then every rest cell
 *     that has one (the rest grid at an arbitrary Z never aligns with a level grid).
 *   - The plan draws every own-grid record it finds (1:1 in the surface) and at most COMPOSE_IMAGES − the plane's
 *     images stand-ins (scaled: another level, children, and at rest the level plan's plates), PLAN §5.6 M1.
 *     Past COMPOSE_IMAGES distinct images it composes through the surface. Hence the store's pinned bound (M2).
 *   - Stillness is seen only on a frame: the caller runs one more `frameFor` after the camera stops.
 *   - A zoom keeps the rest set's records at their own Z as a stand-in source (decision 2: fresh at Z_rest beats a
 *     stale level plate); any other discard, or the next zoom's, removes them (A3 §2.4).
 *   - It posts nothing: requests leave through `onRequest(jobs)` and results come back through `onResult`
 *     (the renderer is the one poster, FC3). `pack(job)`, `measure(job)` and the calibration samples are the renderer's.
 */
import { PLATE_PX, plateRange } from "./plate";
import { COMPOSE_IMAGES, LEVEL_STEP, coarser, levelFor, levelKey, mapCell, ownFloor, restKey, planeKey, sigmaMinFor, zOf } from "./level";
import { levelCell, restCell, cellBox, budgetBytes, pinnedBound, PLATE_BYTES } from "./PyramidStore";
import { renderPlate } from "./rasterCore";
import { copyPlate, pastePatch, COUNTS_PER_PLATE, TIMINGS_PER_PLATE } from "./rasterJob";
import { perfNow } from "../now";

/** The patch rule (e) draws the fresh coarser picture over the dirty rectangles while they are at most this share of the cell. */
export const PATCH_MAX = 0.5;
/** A group older than this commits what it has (A3 §3.6). */
export const LIVE_HOLD_MS = 3000;
/** A user's action (an undo, a redo, a drop) may show its change coarse-first within this many frames of `patchUserMs` (PLAN §5.20 item 2): one action, not a per-frame cost. */
export const USER_COARSE_FRAMES = 3;
/** The surface is freed after this long unused. */
export const SURFACE_IDLE_MS = 10000;
/** The estimate's constants (A3 §2.2, §3.3), each overridable in cfg and calibrated online. */
export const EST_DEFAULTS = Object.freeze({
    restEdgeUs: 0.73, restPxNs: 34, restCellMs: 0.15, patchUnionUs: 73, patchMergeMs: 0.3, packItemUs: 20, packListUs: 1,
    restInlineMs: 8, patchInlineMs: 6, patchUserMs: 16, restQuietMs: 100,
});
const EWMA = 0.2;
const WHOLE = Object.freeze([0, 0, PLATE_PX, PLATE_PX]);

const cfgOr = (cfg, k) => (cfg && cfg[k] != null ? cfg[k] : EST_DEFAULTS[k]);
const inter = (a, b) => {
    const l = Math.max(a.left, b.left), t = Math.max(a.top, b.top), r = Math.min(a.right, b.right), bt = Math.min(a.bottom, b.bottom);
    return r > l && bt > t ? { left: l, top: t, right: r, bottom: bt } : null;
};
const meets = (a, b) => !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
/** A cell's box in its frame's units, unpadded. */
const boxOf = (Z, i, j) => ({ left: i * PLATE_PX / Z, top: j * PLATE_PX / Z, right: (i + 1) * PLATE_PX / Z, bottom: (j + 1) * PLATE_PX / Z });

function mkCanvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
}
const hasOffscreen = () => typeof OffscreenCanvas !== "undefined" && typeof ImageData !== "undefined";

/**
 * One compose's image budget (A3 §1.5, PLAN §5.6 M1): own-grid records are drawn 1:1 in the surface and always
 * taken; scaled ones (another level, a mapped frame's cover, children) at most `scaledCap` distinct. `levelScaled`:
 * at rest the level plan's own-level plates are drawn scaled onto the rest grid, so `base` takes them as stand-ins.
 */
class PlanBudget {
    constructor(scaledCap, levelScaled = false) {
        this.scaledCap = scaledCap; this.levelScaled = levelScaled; this.own = new Set(); this.scaled = new Set(); this.refused = false;
    }
    keep(r) { this.own.add(r); }
    /** A level plate of the view's own level (or its mapped twin): own-grid, or a stand-in at rest. */
    base(r) { if (this.levelScaled) return this.take([r]); this.own.add(r); return true; }
    take(recs) {
        let add = 0;
        for (const r of recs) if (!this.own.has(r) && !this.scaled.has(r)) add++;
        if (this.scaled.size + add > this.scaledCap) { this.refused = true; return false; }
        for (const r of recs) if (!this.own.has(r)) this.scaled.add(r);
        return true;
    }
    room() { return this.scaledCap - this.scaled.size; }
    /** A trial copy: plan into it, then `adopt` it or drop it. */
    fork() { const b = new PlanBudget(this.scaledCap, this.levelScaled); b.own = new Set(this.own); b.scaled = new Set(this.scaled); return b; }
    adopt(b) { this.own = b.own; this.scaled = b.scaled; }
}

export default class PicturePyramid {
    /**
     * @param {Element|null} host where the ink canvas goes
     * @param {object} opts
     * @param {object} opts.store the `PyramidStore` @param {object} opts.stage the Stage (`generation`, `dirtyRects`)
     * @param {object} opts.lm the lattice (`framePath`, `frame`) @param {object} [opts.cfg] the engine cfg
     * @param {(jobs:object[])=>void} [opts.onRequest] typed jobs out (`jobQueue.js`)
     * @param {(job:object)=>object|null} [opts.pack] a typed job packed at the Stage's G (`rasterPack.packJob`'s job)
     * @param {(job:object)=>{E:number,A:number,U?:number,P:number}} [opts.measure] the estimate's inputs for a job
     * @param {(sample:object)=>void} [opts.onSample] an inline job's core timings (`calibrate`'s shape): the renderer
     *        feeds them, with the workers' (`sampleOf`), to `calibrate`
     * @param {boolean} [opts.pixels] keep raw pixels (jsdom) instead of bitmaps
     */
    constructor(host, opts = {}) {
        this.host = host || null;
        this.store = opts.store;
        this.stage = opts.stage || null;
        this.lm = opts.lm || null;
        this.cfg = opts.cfg || {};
        this.paper = opts.paper || "#ffffff";
        this._paperRGB = parseHex(this.paper);
        this._onRequest = opts.onRequest || null;
        this._pack = opts.pack || null;
        this._measure = opts.measure || null;
        this._onSample = opts.onSample || null;
        this._mk = opts.makeCanvas || mkCanvas;
        this._makeOffscreen = opts.makeOffscreen || ((w, h) => new OffscreenCanvas(w, h));
        this._now = opts.now || perfNow;
        this._setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
        this._clearTimer = opts.clearTimer || ((t) => clearTimeout(t));
        this._pixels = opts.pixels != null ? !!opts.pixels : !hasOffscreen();
        this.dpr = opts.dpr > 0 ? opts.dpr : (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
        this.cssW = opts.width > 0 ? opts.width : 0;
        this.cssH = opts.height > 0 ? opts.height : 0;
        /** FC2's view: one object, mutated in place, `rev` monotone. */
        this._v = {
            rev: 0, mode: "level", frameId: null, level: 0, S: LEVEL_STEP, Zq: 1, Z: 1, s: 1,
            ox: 0, oy: 0, dx: 0, dy: 0, dpr: this.dpr, cssW: this.cssW, cssH: this.cssH,
            k: 1, tx: 0, ty: 0, i0: 0, i1: -1, j0: 0, j1: -1,
        };
        this._cam0 = { frame: null, inScale: NaN, panX: NaN, panY: NaN, sized: true };
        this._win = null;
        this._lv = null; this._lvFrame = null; this._S = null;
        this._sized();
        /** Purpose generations (A3 §4.4): a queued job whose purpose moved on is dropped at dispatch. */
        this.gens = { view: 1, rest: 1, patch: 1, prefetch: 1 };
        this._asked = new Map();       // key -> the G a job for it was requested at
        this._rest = null;             // { frame, Z, shown, gen }
        this._standIn = null;          // { frame, Z }: the rest set a zoom left, drawn as a stand-in at its own Z
        this._restTimer = null;
        this._heavyAt = 0;             // D272's backstop: an inline rest that ran over marks this estimate heavy
        this._userG = 0;               // the commit of the user's last undo or redo (`noteUserEdit`)
        this._patchDue = false;        // a commit's patch step not yet run (`noteCommit`)
        this._groups = new Map();      // id -> { id, need, held, bytes, at, G, onCommit, purpose; a pen-up group: G0, members }
        this._groupOf = new Map();     // key -> group id
        this._seqGroup = 0;
        this._plane = null;
        this._attn = null;
        this._surface = null;
        this._surfaceTimer = null;
        this._scratch = null;
        this._oc = null;
        this._counts = new Float64Array(COUNTS_PER_PLATE);
        this._timings = new Float64Array(TIMINGS_PER_PLATE);
        this._k = {
            edge: cfgOr(this.cfg, "restEdgeUs") / 1000, px: cfgOr(this.cfg, "restPxNs") / 1e6, cell: cfgOr(this.cfg, "restCellMs"),
            union: cfgOr(this.cfg, "patchUnionUs") / 1000, merge: cfgOr(this.cfg, "patchMergeMs"),
            pack: cfgOr(this.cfg, "packItemUs") / 1000, list: cfgOr(this.cfg, "packListUs") / 1000,
        };
        this._lastCompose = null;
        this._share = { paper: 0, blur: 0, olderPatch: 0, olderUnread: 0, olderOther: 0 };
        this._images = [];             // [t, images] of the last 10 s of composes (A3 §8's panel)
        this.lastPlan = null;
        this.lastPatch = null;         // the last patch decision: cells, T against the budget, inline or coarse (`patchPlan`)
        this.s = {
            composes: 0, direct: 0, surface: 0, surfaceRecomposes: 0, surfaceAllocs: 0, surfaceFrees: 0,
            composeMs: 0, composeMsMax: 0, maxImagesPerCompose: 0, lastImages: 0,
            paperMs: 0, blurMs: 0, olderPatchMs: 0, olderUnreadMs: 0, olderOtherMs: 0,
            restInline: 0, restWorker: 0, restMs: 0, restDiscards: 0, restHeavy: 0, standInCells: 0,
            patchInline: 0, patchCoarse: 0, patchWorker: 0, patchMs: 0, merges: 0, mergeMisses: 0,
            groupsCommitted: 0, groupsTimedOut: 0, requests: 0, requestedCells: 0, discarded: 0, calibrations: 0,
        };
        this._canvas = null; this._ctx = null;
        if (opts.context) { this._ctx = opts.context; } else if (this.host) this._mount();
    }

    // ---- the canvas ----

    _mount() {
        const w = Math.round(this.cssW * this.dpr), h = Math.round(this.cssH * this.dpr);
        const c = this._mk(w, h);
        if (!c) return;
        this._canvas = c;
        if (c.style) {
            c.style.position = "absolute"; c.style.left = "0"; c.style.top = "0"; c.style.zIndex = "0";
            c.style.width = this.cssW + "px"; c.style.height = this.cssH + "px";
        }
        if (c.setAttribute) { c.setAttribute("class", "bl-ink"); c.setAttribute("aria-hidden", "true"); }
        this._ctx = c.getContext ? c.getContext("2d", { alpha: false }) : null;
        if (this.host && this.host.appendChild) this.host.appendChild(c);
    }

    /** A resize or a dpr change: the rest set goes (A3 §2.4), the surface and the budget follow the screen. */
    setSize(cssW, cssH, dpr) {
        const d = dpr > 0 ? dpr : this.dpr;
        if (cssW === this.cssW && cssH === this.cssH && d === this.dpr) return false;
        this.cssW = cssW; this.cssH = cssH; this.dpr = d;
        if (this._canvas) {
            this._canvas.width = Math.round(cssW * d); this._canvas.height = Math.round(cssH * d);
            if (this._canvas.style) { this._canvas.style.width = cssW + "px"; this._canvas.style.height = cssH + "px"; }
        }
        this._discardRest("resize");
        this._freeSurface();
        this._sized();
        this._cam0.sized = true;
        return true;
    }

    _sized() {
        this.wDev = Math.max(1, Math.round(this.cssW * this.dpr));
        this.hDev = Math.max(1, Math.round(this.cssH * this.dpr));
        this.sigmaMin = sigmaMinFor(this.wDev, this.hDev);
        /** The store's pinned bound on this screen (PLAN §5.6 M2), in plates: the budget's floor. */
        this.pinBound = pinnedBound(this.wDev, this.hDev, !!(this.store && this.store.phone));
    }

    /** The store's budget for this screen (A3 §4.5): the renderer's to apply at construction and on a resize. */
    budgetBytes() { return budgetBytes(this.cfg, this.wDev, this.hDev, this.store ? this.store.phone : false); }

    /** The drag plane to draw over the base (MovePlane's layers keyed `planeKey`), or null. */
    setPlane(p) { this._plane = p || null; }
    /** The attention point in device px (the wheel or pinch focus, the pointer); null for the screen centre. */
    setAttention(x, y) { this._attn = x == null ? null : [x, y]; }
    /** The commit a user's own action just made (an undo, a redo, a drop): its patch has the user's budget (`patchPlan`). */
    noteUserEdit() { this._userG = this.stage ? this.stage.generation : 0; }
    /** The prefetch's far zoom-out keys (`prefetch.js`): protected in the store, evicted first among the protected. */
    setFar(keys) { const v = this.store && this.store.view; if (v) v.far = new Set(keys); }

    // ---- the view (FC2, A3 §1.3) ----

    /**
     * The view for this camera step: its level (the bounded band with hysteresis), the rest set's grid when the
     * camera rests on it, one snap. Then the still frame's rest render, the patch step and the view's requests.
     * `cam`: `{ frame, inScale, inPanX, inPanY, frameWindow(0) }`.
     */
    frameFor(cam) {
        const v = this._v;
        if (!cam) return v;
        const rev0 = v.rev;
        const F = String(cam.frame);
        let Z = cam.inScale * this.dpr;
        if (!(Z > 0) || !isFinite(Z)) Z = 1;
        const S = this._step();
        if (this._S != null && S !== this._S) this._onStep(S);
        this._S = S;
        const c0 = this._cam0;
        const still = !c0.sized && c0.frame === F && c0.inScale === cam.inScale && c0.panX === cam.inPanX && c0.panY === cam.inPanY;
        c0.sized = false; c0.frame = F; c0.inScale = cam.inScale; c0.panX = cam.inPanX; c0.panY = cam.inPanY;
        if (this._rest && (this._rest.frame !== F || this._rest.Z !== Z)) this._discardRest(this._rest.frame !== F ? "frame" : "zoom");
        else if (this._standIn && this._standIn.frame !== F) this._discardRest("frame");
        const prev = this._lvFrame === F ? this._lv : null;
        const lv = levelFor(Z, S, prev, this.sigmaMin);
        if (lv !== this._lv || F !== this._lvFrame) { this.gens.view++; this._asked.clear(); }
        this._lv = lv; this._lvFrame = F;
        this._win = cam.frameWindow(0);
        this._panDev = [cam.inPanX * this.dpr, cam.inPanY * this.dpr];
        this._map(F, Z, S, lv);
        this._checkGroups();
        if (still) { if (this._onStill()) this._map(F, Z, S, lv); } else this._onMove();
        if (v.rev !== rev0 && this._groups.size) this._retarget();
        if (this._groups.size) this._reaskGroups();
        this._patchStep();
        this._requestView();
        return v;
    }

    /** The published view, mapped once (FC2): rest mode at σ = 1 on the rest grid, else the level's grid stretched by σ. */
    _map(F, Z, S, lv) {
        const v = this._v, rest = this._rest && this._rest.shown ? this._rest : null;
        const mode = rest ? "rest" : "level";
        const Zq = rest ? Z : zOf(lv, S), s = rest ? 1 : Z / Zq;
        const r = plateRange(this._win, Zq);
        const ox = r.i0 * PLATE_PX, oy = r.j0 * PLATE_PX;
        const dx = Math.round(this._panDev[0] + ox * s), dy = Math.round(this._panDev[1] + oy * s);
        const same = v.mode === mode && v.frameId === F && v.level === lv && v.S === S && v.Zq === Zq && v.Z === Z && v.s === s
            && v.ox === ox && v.oy === oy && v.dx === dx && v.dy === dy && v.i0 === r.i0 && v.i1 === r.i1 && v.j0 === r.j0 && v.j1 === r.j1
            && v.dpr === this.dpr && v.cssW === this.cssW && v.cssH === this.cssH;
        if (same) return v;
        v.mode = mode; v.frameId = F; v.level = lv; v.S = S; v.Zq = Zq; v.Z = Z; v.s = s;
        v.ox = ox; v.oy = oy; v.dx = dx; v.dy = dy; v.dpr = this.dpr; v.cssW = this.cssW; v.cssH = this.cssH;
        v.i0 = r.i0; v.i1 = r.i1; v.j0 = r.j0; v.j1 = r.j1;
        v.k = Zq * s; v.tx = dx - ox * s; v.ty = dy - oy * s;
        v.rev++;
        this._publishView(v);
        return v;
    }

    /** The eviction order's context (A3 §4.5): the view, its ring, the rest set, the path of frames. */
    _publishView(v) {
        if (!this.store || !this.store.setView) return;
        const lz = zOf(v.level, v.S), r = plateRange(this._win, lz);
        const path = new Map();
        let id = v.frameId, shift = 0;
        for (let n = 0; id != null && n < 64; n++) {
            path.set(String(id), shift);
            const f = this.lm && this.lm.frame ? this.lm.frame(id) : null;
            id = f ? f.parent : null;
            shift += 12 / v.S;
        }
        const prevView = this.store.view;
        const left = prevView && prevView.frame !== v.frameId ? prevView.frame : (prevView ? prevView.left : null);
        this.store.setView({
            frame: v.frameId, level: v.level, S: v.S, ring: { i0: r.i0 - 1, i1: r.i1 + 1, j0: r.j0 - 1, j1: r.j1 + 1 },
            rest: this._rest ? { frame: this._rest.frame, Z: this._rest.Z } : null, path, left,
            far: prevView && prevView.far ? prevView.far : new Set(),
        });
    }

    _step() { const S = this.cfg.levelStep; return S === 1 || S === 2 || S === 3 ? S : LEVEL_STEP; }

    /** A lever change of the step: every level record carries the old S and goes; the view's and the prefetch's jobs are dropped. */
    _onStep(S) {
        this.store.dropWhere((r) => r.kind === "level" && r.S !== S);
        this.gens.view++; this.gens.prefetch++;
        this._asked.clear();
        this._lv = null;
    }

    // ---- the plan (A3 §1.4) ----

    /**
     * The plan for view `v`: `{ draws, keys, images, own, scaled, planeImages, cells }`. A draw is `{ rec | null
     * (paper), sx, sy, sw, sh, x0, y0, x1, y1 (view-grid px), cls: "sharp"|"blur"|"older"|"held"|"paper", exact }`;
     * `exact` marks the steps (a)–(e) sources, which the invariant of PLAN §3 row 1 is about.
     */
    plan(v = this._v) {
        const plane = this._planePlan(v);
        const B = new PlanBudget(Math.max(0, COMPOSE_IMAGES - plane.images), v.mode === "rest" && zOf(v.level, v.S) !== v.Z);
        const P = { v, draws: [], base: [], cells: [], budget: B, plane, keys: new Set(), images: 0 };
        if (v.mode === "rest") this._planRest(v, P, B); else this._planLevel(v, P, B);
        if (this._groups.size) this._markHeld(P);
        // What is drawn: own-grid records 1:1 (a destination as wide as its source), the rest scaled.
        const own1 = new Set(), all = new Set();
        for (const d of P.draws) {
            if (!d.rec) continue;
            P.keys.add(d.rec.key); all.add(d.rec);
            if (d.x1 - d.x0 === d.sw && d.y1 - d.y0 === d.sh) own1.add(d.rec);
        }
        P.own = own1.size; P.scaled = all.size - own1.size;
        P.images = all.size + plane.images;
        return P;
    }

    _planLevel(v, P, B) {
        const skip = P.plane.skip, list = [];
        for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) if (!skip || !skip.has(i + "," + j)) list.push({ i, j });
        for (const cell of this._planCells(v, v.frameId, v.level, list, B)) { P.cells.push(cell); for (const d of cell.draws) P.draws.push(d); }
    }

    /**
     * Level ℓ's cells of frame F, so the budget moves excess cells to coarser, shared sources (A3 §1.5): every cell's
     * plan without children; if that refused a stand-in (the budget binds), each cell not drawn sharp from its own grid
     * reserves its coarsest exact source first and the cells are planned again nearest the attention point first, so
     * the far ones fall to the shared coarse plates, not paper. Then (c) — all 2^S × 2^S children exact — upgrades the
     * cells not already sharp while the budget takes them: paper first, then older, then blurred, each nearest first.
     */
    _planCells(v, F, l, list, B) {
        const a = this._attn || [this.wDev / 2, this.hDev / 2];
        const gx = (a[0] - v.dx) / v.s + v.ox, gy = (a[1] - v.dy) / v.s + v.oy, f = PLATE_PX * (v.Zq / zOf(l, v.S));
        const dist = (c) => ((c.i + 0.5) * f - gx) ** 2 + ((c.j + 0.5) * f - gy) ** 2;
        const planAll = (L, b) => L.map(({ i, j }) => { const c = { i, j, draws: [] }; this._planCell(v, F, l, i, j, b, c.draws); return c; });
        const T = B.fork();
        let cells = planAll(list, T);
        if (!T.refused) B.adopt(T);
        else {
            const near = list.slice().sort((p, q) => dist(p) - dist(q));
            for (const c of near) { const r = this._coarsest(v, F, l, c.i, c.j, B); if (r) B.take([r]); }
            cells = planAll(near, B);
        }
        const need = (c) => (c.draws.some((d) => !d.rec) ? 0 : c.draws.some((d) => d.cls === "older") ? 1 : 2);
        const up = cells.filter((c) => !(c.draws.length === 1 && c.draws[0].cls === "sharp"))
            .map((c) => ({ c, r: need(c), d: dist(c) })).sort((p, q) => p.r - q.r || p.d - q.d);
        const n = 1 << v.S, Zk = zOf(l + 1, v.S);
        for (const { c } of up) {
            if (n * n > B.room()) break;
            const kids = this._kids(F, l, v.S, c.i, c.j);
            if (kids && B.take(kids)) c.draws = kids.map((k) => draw(k, WHOLE, gBox(Zk, k.i, k.j, v.Zq), "sharp", true));
        }
        return cells;
    }

    /** The coarsest exact source within N levels of a cell not drawn sharp from its own grid (the most shared), or null. */
    _coarsest(v, F, l, i, j, B) {
        const st = this.store, S = v.S, N = Math.ceil(8 / S);
        if (!B.levelScaled) {
            const own = st.get(levelKey(F, l, S, i, j));
            if ((own && st.exact(own)) || this._mapped(F, l, S, i, j)) return null;
        }
        let best = null;
        for (let k = 1; k <= N; k++) {
            const c = coarser(this.lm, S, F, l, i, j, k);
            if (!c) break;
            if (typeof c.i !== "number") continue;
            const r = st.get(levelKey(c.frame, c.level, S, c.i, c.j));
            if (r && st.exact(r) && this._sub(F, l, i, j, c, S)) best = r;
        }
        return best;
    }

    /**
     * A stale draw under an open pen-up group's rectangle, older than its stroke, shows the current picture with the
     * held path over it (A3 §3.6): class "held", which the integrals do not charge as older.
     */
    _markHeld(P) {
        const v = P.v, gs = [];
        for (const g of this._groups.values()) {
            if (g.purpose !== "live") continue;
            for (const m of g.members) gs.push({ G: m.G, x0: m.rect.left * v.Zq, y0: m.rect.top * v.Zq, x1: m.rect.right * v.Zq, y1: m.rect.bottom * v.Zq });
        }
        if (!gs.length) return;
        for (const c of P.cells) {
            for (const d of c.draws) {
                if (d.cls !== "older" || !d.rec) continue;
                if (gs.some((g) => d.rec.G < g.G && d.x0 < g.x1 && d.x1 > g.x0 && d.y0 < g.y1 && d.y1 > g.y0)) d.cls = "held";
            }
        }
    }

    /** (c): all 2^S × 2^S children of the cell, one level finer, exact; or null. */
    _kids(F, l, S, i, j) {
        const st = this.store, n = 1 << S, kids = [];
        for (let b = 0; b < n; b++) {
            for (let a = 0; a < n; a++) {
                const k = st.get(levelKey(F, l + 1, S, i * n + a, j * n + b));
                if (!k || !st.exact(k)) return null;
                kids.push(k);
            }
        }
        return kids;
    }

    /** §1.4's lookup for frame F's cell (i, j) at level ℓ, draws in the view's grid; (c) is `_planCells`'s upgrade. */
    _planCell(v, F, l, i, j, B, out) {
        const st = this.store, S = v.S, Zl = zOf(l, S), N = Math.ceil(8 / S);
        const dst = gBox(Zl, i, j, v.Zq);
        const own = st.get(levelKey(F, l, S, i, j));
        if (own && st.exact(own) && B.base(own)) { out.push(draw(own, WHOLE, dst, "sharp", true)); return; }     // (a)
        const m = this._mapped(F, l, S, i, j);
        if (m && B.base(m)) { out.push(draw(m, WHOLE, dst, "sharp", true)); return; }                            // (b)
        const cb = boxOf(Zl, i, j);
        // The rest set a zoom left: exact at its own Z, tried before the first coarser level it is finer than.
        let restTried = !(this._standIn && this._standIn.frame === F);
        for (let k = 1; k <= N; k++) {                                                                              // (d)
            if (!restTried && this._standIn.Z > zOf(l - k, S)) { restTried = true; if (this._standInCell(v, F, own, cb, dst, Zl, B, out)) return; }
            const c = coarser(this.lm, S, F, l, i, j, k);
            if (!c) break;
            if (typeof c.i !== "number") continue;
            const r = st.get(levelKey(c.frame, c.level, S, c.i, c.j));
            if (!r || !st.exact(r)) continue;
            const sub = this._sub(F, l, i, j, c, S);
            if (!sub || !B.take([r])) continue;
            if (own) {                                                                                              // (e)
                const D = this._dirtyIn(F, own, cellBox(own), cb);
                if (D && D.area <= (cb.right - cb.left) * (cb.bottom - cb.top) * PATCH_MAX && B.base(own)) {
                    out.push(draw(own, WHOLE, dst, "sharp", false, true));
                    out.push(draw(r, subIn(sub, cb, D.bbox), gRect(D.bbox, v.Zq), "blur", true));
                    return;
                }
            }
            out.push(draw(r, sub, dst, "blur", true));
            return;
        }
        if (!restTried && this._standInCell(v, F, own, cb, dst, Zl, B, out)) return;
        if (own && B.base(own)) { out.push(this._older(own, dst)); return; }                                        // (f)
        for (let k = 1; k <= N; k++) {
            const c = coarser(this.lm, S, F, l, i, j, k);
            if (!c) break;
            if (typeof c.i !== "number") continue;
            const r = st.get(levelKey(c.frame, c.level, S, c.i, c.j));
            const sub = r && this._sub(F, l, i, j, c, S);
            if (sub && B.take([r])) { out.push(this._lastResort(r, sub, dst, levelCell(F, l, S, i, j))); return; }       // (f')
        }
        out.push(draw(null, WHOLE, dst, "paper", false));                                                           // (g)
    }

    /**
     * A stale own plate drawn whole: `unread` while the camera's table lacks its tiles (the patch step cannot pack it
     * until they are read: `olderUnreadMs`), `wait` when a worker patch that makes it exact is asked or in flight — A3
     * §3.4's one allowed case, no level patching it inline (`olderPatchMs`); anything else is `olderOtherMs`, which must stay 0.
     */
    _older(own, dst) {
        const d = draw(own, WHOLE, dst, "older", false), g = this._asked.get(own.key), st = this.store;
        d.own = true;
        d.unread = !this.covered(own);
        d.wait = !d.unread && ((g != null && g >= st.fresh.dirtySince(own.key)) || st.inFlightExact(own.key));
        return d;
    }

    /**
     * (f′), a stale coarser stand-in for a cell with nothing fresh at any level: `unread` while the camera's table lacks
     * the cell's tiles (a crossing's step reads the cache alone, A3 §4.2: `olderUnreadMs`), `wait` while its own job is
     * asked or in flight (`olderPatchMs`); anything else is `olderOtherMs`, which must stay 0.
     */
    _lastResort(r, sub, dst, c) {
        const d = draw(r, sub, dst, "older", false), g = this._asked.get(c.key), st = this.store;
        d.unread = !this.covered(c);
        d.wait = !d.unread && ((g != null && g >= st.fresh.dirtySince(c.key)) || st.inFlightExact(c.key));
        return d;
    }

    /**
     * The kept rest set as a cell's source, only where its plates are exact: over a stale own plate's dirty rectangles
     * (the patch rule, e), else over the cell — the part on screen, which is all the rest set was rendered for; scaled,
     * so its plates count against the stand-in cap.
     */
    _standInCell(v, F, own, cb, dst, Zl, B, out) {
        const cls = this._standIn.Z >= Zl ? "sharp" : "blur", win = this._win;
        let c = null;
        if (own) {
            const D = this._dirtyIn(F, own, cellBox(own), cb);
            const Dv = D && D.area <= (cb.right - cb.left) * (cb.bottom - cb.top) * PATCH_MAX ? (win && inter(D.bbox, win)) || D.bbox : null;
            c = Dv ? this._restCover(F, Dv) : null;
            if (c && B.take(c.recs) && B.base(own)) {
                out.push(draw(own, WHOLE, dst, "sharp", false, true));
                for (const d of c.draws(v.Zq, cls)) out.push(d);
                this.s.standInCells++;
                return true;
            }
        }
        c = this._restCover(F, (win && inter(cb, win)) || cb);
        if (!c || !B.take(c.recs)) return false;
        for (const d of c.draws(v.Zq, cls)) out.push(d);
        this.s.standInCells++;
        return true;
    }

    /** The kept rest set's plates over `rect` (frame units), every one exact: `_coverOf`'s answer, or null. */
    _restCover(F, rect) {
        const st = this.store, Z = this._standIn.Z;
        return this._coverOf(Z, rect, (i, j) => { const r = st.get(restKey(F, Z, i, j)); return r && st.exact(r) ? r : null; });
    }

    /** (b): the same picture from another frame's level, exact. */
    _mapped(F, l, S, i, j) {
        const st = this.store;
        for (const H of st.framesWithLevels()) {
            if (H === F) continue;
            const m = mapCell(this.lm, S, F, l, i, j, H);
            if (!m || typeof m.i !== "number" || typeof m.j !== "number") continue;
            const r = st.get(levelKey(H, m.level, S, m.i, m.j));
            if (r && st.exact(r)) return r;
        }
        return null;
    }

    /** Where frame F's cell (i, j) at ℓ lies inside the coarser plate `c` (`level.coarser`'s answer): `[sx, sy, sw, sw]`. */
    _sub(F, l, i, j, c, S) {
        let hi = i, hj = j, hl = l;
        if (c.frame !== F) {
            const m = mapCell(this.lm, S, F, l, i, j, c.frame);
            if (!m || typeof m.i !== "number" || typeof m.j !== "number") return null;
            hi = m.i; hj = m.j; hl = m.level;
        }
        const e = (hl - c.level) * S, n = 2 ** e, w = PLATE_PX / n;
        return [(hi - c.i * n) * w, (hj - c.j * n) * w, w, w];
    }

    /**
     * The dirty rectangles since `rec.G` meeting `padded` (the tracked box): their bounding box grown by a pixel (of
     * the screen or the plate, the larger) and clipped to `cb`, `{ bbox, area }`; null when the log does not reach.
     */
    _dirtyIn(F, rec, padded, cb) {
        const rs = this.stage && this.stage.dirtyRects ? this.stage.dirtyRects(F, rec.G) : null;
        if (!rs) return null;
        let bb = null;
        for (const r of rs) {
            if (!meets(r, padded) || !inter(r, cb)) continue;
            bb = bb ? { left: Math.min(bb.left, r.left), top: Math.min(bb.top, r.top), right: Math.max(bb.right, r.right), bottom: Math.max(bb.bottom, r.bottom) } : { ...r };
        }
        if (!bb) return null;
        const g = 1 / Math.min(this._v.Z, rec.Z);
        bb = inter({ left: bb.left - g, top: bb.top - g, right: bb.right + g, bottom: bb.bottom + g }, cb);
        return bb ? { bbox: bb, area: (bb.right - bb.left) * (bb.bottom - bb.top) } : null;
    }

    /**
     * Rest mode: every rest cell with a plate is planned against its own plate — exact 1:1; stale, the patch rule
     * or a fresh level cover or the stale plate — and drawn over the level plan of the cells the rest set lacks. A
     * cell a whole dragged plane's BELOW covers is not drawn at all (A3 §6's `_planeBelow`).
     */
    _planRest(v, P, B) {
        const st = this.store, F = v.frameId, S = v.S, Z = v.Z, N = Math.ceil(8 / S), floor = ownFloor(S), skip = P.plane.skip;
        const top = [], bare = [];
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                if (skip && skip.has(i + "," + j)) continue;
                const own = st.get(restKey(F, Z, i, j));
                const cb = boxOf(Z, i, j);
                if (!own) { bare.push(cb); continue; }
                const dst = gBox(Z, i, j, v.Zq);
                const cell = { i, j, draws: [], rest: true, box: dst };
                P.cells.push(cell);
                if (st.exact(own)) { B.keep(own); cell.draws.push(draw(own, WHOLE, dst, "sharp", true)); top.push(...cell.draws); continue; }
                const D = this._dirtyIn(F, own, cellBox(own), cb);
                const small = D && D.area <= (cb.right - cb.left) * (cb.bottom - cb.top) * PATCH_MAX;
                let done = false;
                for (let l = v.level; l >= Math.max(v.level - N, floor) && !done; l--) {
                    const cov = this._cover(F, l, S, small ? D.bbox : cb);
                    if (!cov || !B.take(cov.recs)) continue;
                    if (small) { B.keep(own); cell.draws.push(draw(own, WHOLE, dst, "sharp", false, true)); }
                    for (const d of cov.draws(v.Zq)) cell.draws.push(d);
                    done = true;
                }
                if (!done) { B.keep(own); cell.draws.push(this._older(own, dst)); }
                top.push(...cell.draws);
            }
        }
        const Zl = zOf(v.level, S), seen = new Set(), list = [];
        for (const cb of bare) {
            const box = inter(cb, this._win);
            if (!box) continue;
            const r = plateRange(box, Zl);
            for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) if (!seen.has(i + "," + j)) { seen.add(i + "," + j); list.push({ i, j }); }
        }
        for (const cell of this._planCells(v, F, v.level, list, B)) { cell.base = true; P.cells.push(cell); for (const d of cell.draws) P.draws.push(d); }
        for (const d of top) P.draws.push(d);
    }

    /** Frame F's level-ℓ plates over `rect` (frame units), each exact or (b)'s exact mapped cell: `_coverOf`'s answer, or null. */
    _cover(F, l, S, rect) {
        const st = this.store;
        // After a crossing the frame just left may hold the fresh picture: (b)'s mapped cell (PLAN §5.6 item 7).
        return this._coverOf(zOf(l, S), rect, (i, j) => { const own = st.get(levelKey(F, l, S, i, j)); return own && st.exact(own) ? own : this._mapped(F, l, S, i, j); });
    }

    /** The grid-Zg records `get(i, j)` gives over `rect` (frame units), all present: `{ recs, draws(Zq, cls) }` clipped to `rect`, or null. */
    _coverOf(Zg, rect, get) {
        const r = plateRange(rect, Zg), recs = [], at = [];
        if ((r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1) > COMPOSE_IMAGES) return null;
        for (let j = r.j0; j <= r.j1; j++) {
            for (let i = r.i0; i <= r.i1; i++) {
                const c = get(i, j);
                if (!c) return null;
                recs.push(c); at.push(i, j);
            }
        }
        return {
            recs,
            draws: (Zq, cls = "blur") => {
                const out = [];
                for (let k = 0; k < recs.length; k++) {
                    const i = at[2 * k], j = at[2 * k + 1], I = inter(boxOf(Zg, i, j), rect);
                    if (!I) continue;
                    out.push(draw(recs[k], [I.left * Zg - i * PLATE_PX, I.top * Zg - j * PLATE_PX, (I.right - I.left) * Zg, (I.bottom - I.top) * Zg], gRect(I, Zq), cls, true));
                }
                return out;
            },
        };
    }

    // ---- the plane (A3 §6's paint order) ----

    /**
     * The plane's layers for this view: records to draw after the base, and the base cells BELOW replaces. Partial
     * (the SEL layers whole, the rest not): H4, never both — the selection is drawn moved only when BELOW covers its
     * start footprint (with OVER there), which hides it where it was; else nothing is drawn and it stays in place.
     */
    _planePlan(v) {
        const p = this._plane, st = this.store;
        const out = { images: 0, layers: [], skip: null };
        if (!p || !p.showing || String(p.frameId) !== v.frameId || !p.layers || !p.layers.length) return out;
        const get = (L, i, j) => { const r = st.get(planeKey(p.frameId, p.Zp, L.tag, i, j)); return r && !r.dead ? r : null; };
        let foot = null;
        if (p.partial) {
            foot = new Set();
            for (const L of p.layers) if (L.kind === "sel") for (const [i, j] of L.cells) foot.add(i + "," + j);
            for (const L of p.layers) {
                if (L.kind === "sel") continue;
                for (const [i, j] of L.cells) if (foot.has(i + "," + j) && !get(L, i, j)) return out;   // the selection stays in place
            }
            if (!p.layers.some((L) => L.kind === "below")) return out;
        }
        const seen = new Set();
        for (const L of p.layers) {
            const recs = [];
            for (const [i, j] of L.cells) {
                if (foot && L.kind !== "sel" && !foot.has(i + "," + j)) continue;
                const r = get(L, i, j);
                if (!r) continue;
                recs.push(r);
                if (r.bitmap || r.pixels) seen.add(r);
            }
            out.layers.push({ L, recs });
        }
        out.images = seen.size;
        const below = p.layers.find((L) => L.kind === "below");
        if (p.state === "drag" && !p.partial && below) {
            const ratio = v.Zq / p.Zp, e = Math.log2(ratio);
            if (ratio >= 1 && Number.isInteger(e)) {
                out.skip = new Set();
                for (const [bi, bj] of below.cells) {
                    for (let b = 0; b < ratio; b++) for (let a = 0; a < ratio; a++) out.skip.add((bi * ratio + a) + "," + (bj * ratio + b));
                }
            }
        }
        return out;
    }

    /** The view cells a landing plane still covers: those whose own source is not exact yet. */
    _landClip(v) {
        const out = [];
        for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) if (!this.cellFresh(v, i, j)) out.push(gBox(v.Zq, i, j, v.Zq));
        return out;
    }

    /** Is view cell (i, j)'s own source exact? The landing's per-cell test (A3 §6: `landCells` × `exact`). */
    cellFresh(v, i, j) {
        const r = this.store.get(v.mode === "rest" ? restKey(v.frameId, v.Z, i, j) : levelKey(v.frameId, v.level, v.S, i, j));
        return !!r && this.store.exact(r);
    }

    // ---- the compose (A3 §1.5, §9.1) ----

    /** A commit's patch step if due, then plan, pin, draw — directly under COMPOSE_IMAGES, else through the surface — and charge the integrals. */
    compose() {
        this.patchIfDue();
        const t0 = this._now(), v = this._v;
        this._checkGroups();
        const P = this.plan(v);
        this.lastPlan = P;
        this.store.setDrawn(P.keys);
        const force = this.cfg.compose;
        const direct = force === "direct" || (force !== "surface" && P.images <= COMPOSE_IMAGES);
        const ctx = this._ctx;
        if (ctx) {
            if (ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingEnabled = true;            // a 1:1 draw at whole pixels is exact either way; a stand-in is magnified
            ctx.fillStyle = this.paper;
            ctx.fillRect(0, 0, this.wDev, this.hDev);
            if (direct) for (const d of P.draws) this._paint(ctx, d, v, false);
            else this._blitSurface(ctx, P, v);
            this._paintPlane(ctx, P, v);
        }
        if (direct) { this.s.direct++; this._idleSurface(); } else this.s.surface++;
        this._charge(P, v);
        const ms = this._now() - t0;
        this.s.composes++; this.s.composeMs += ms; if (ms > this.s.composeMsMax) this.s.composeMsMax = ms;
        this.s.lastImages = P.images; if (P.images > this.s.maxImagesPerCompose) this.s.maxImagesPerCompose = P.images;
        this._images.push(t0, P.images);
        while (this._images.length && this._images[0] < t0 - 10000) this._images.splice(0, 2);
        return P;
    }

    /**
     * One draw into the ink canvas (`toSurface` false) or the surface, destination edges rounded to the nearest
     * device px: neighbours share an edge; a patch's box is grown by a pixel first (`_dirtyIn`), so it still covers.
     */
    _paint(ctx, d, v, toSurface) {
        const X = (g, o, dd) => (toSurface ? Math.round(g - o) : Math.round((g - o) * v.s + dd));
        const x0 = X(d.x0, v.ox, v.dx), y0 = X(d.y0, v.oy, v.dy), x1 = X(d.x1, v.ox, v.dx), y1 = X(d.y1, v.oy, v.dy);
        if (x1 <= x0 || y1 <= y0) return;
        const r = d.rec;
        if (!r || (!r.bitmap && !r.pixels)) { ctx.fillStyle = this.paper; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); return; }
        if (r.dead) return;
        ctx.drawImage(r.bitmap || r, d.sx, d.sy, d.sw, d.sh, x0, y0, x1 - x0, y1 - y0);
    }

    /** The plane after the base, in paint order: BELOW, the selection translated by the drag, OVER; landing, only where the base is not exact. */
    _paintPlane(ctx, P, v) {
        const p = this._plane, pl = P.plane;
        if (!pl.layers.length) return;
        let clipped = false;
        if (p.state === "land") {
            const cells = this._landClip(v);
            if (!cells.length) return;
            ctx.save(); ctx.beginPath();
            for (const g of cells) {
                const x0 = Math.round((g[0] - v.ox) * v.s + v.dx), y0 = Math.round((g[1] - v.oy) * v.s + v.dy);
                const x1 = Math.round((g[2] - v.ox) * v.s + v.dx), y1 = Math.round((g[3] - v.oy) * v.s + v.dy);
                ctx.rect(x0, y0, x1 - x0, y1 - y0);
            }
            ctx.clip();
            clipped = true;
        }
        for (const { L, recs } of pl.layers) {
            const off = L.kind === "sel" && p.off ? p.off : [0, 0];
            for (const r of recs) {
                const g = gBox(p.Zp, r.i, r.j, v.Zq);
                const x0 = Math.round((g[0] - v.ox) * v.s + v.dx) + off[0], y0 = Math.round((g[1] - v.oy) * v.s + v.dy) + off[1];
                const x1 = Math.round((g[2] - v.ox) * v.s + v.dx) + off[0], y1 = Math.round((g[3] - v.oy) * v.s + v.dy) + off[1];
                if (r.bitmap || r.pixels) ctx.drawImage(r.bitmap || r, 0, 0, PLATE_PX, PLATE_PX, x0, y0, x1 - x0, y1 - y0);
                else if (L.kind === "below") { ctx.fillStyle = this.paper; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
            }
        }
        if (clipped) ctx.restore();
    }

    /** The surface path: the plan drawn once at the view's grid 1:1 whenever it changes, blitted scaled by σ each frame. */
    _blitSurface(ctx, P, v) {
        const w = (v.i1 - v.i0 + 1) * PLATE_PX, h = (v.j1 - v.j0 + 1) * PLATE_PX;
        let sf = this._surface;
        if (!sf || sf.w !== w || sf.h !== h) {
            this._freeSurface();
            const c = this._mk(w, h);
            const cx = c && c.getContext ? c.getContext("2d") : null;
            if (!cx) { for (const d of P.draws) this._paint(ctx, d, v, false); return; }
            sf = this._surface = { canvas: c, ctx: cx, w, h, sig: null, usedAt: 0 };
            this.s.surfaceAllocs++;
        }
        const sig = planSig(P);
        if (sf.sig !== sig) {
            sf.ctx.clearRect(0, 0, w, h);
            sf.ctx.imageSmoothingEnabled = true;
            for (const d of P.draws) this._paint(sf.ctx, d, v, true);
            sf.sig = sig;
            this.s.surfaceRecomposes++;
        }
        sf.usedAt = this._now();
        ctx.drawImage(sf.canvas, 0, 0, w, h, v.dx, v.dy, w * v.s, h * v.s);
        if (this._surfaceTimer != null) { this._clearTimer(this._surfaceTimer); this._surfaceTimer = null; }
    }

    /** A direct compose: the surface is freed after SURFACE_IDLE_MS unused. */
    _idleSurface() {
        if (!this._surface || this._surfaceTimer != null) return;
        this._surfaceTimer = this._setTimer(() => { this._surfaceTimer = null; this._freeSurface(); }, SURFACE_IDLE_MS);
    }

    _freeSurface() {
        if (this._surfaceTimer != null) { this._clearTimer(this._surfaceTimer); this._surfaceTimer = null; }
        if (!this._surface) return;
        const c = this._surface.canvas;
        if (c) { c.width = 0; c.height = 0; }
        this._surface = null;
        this.s.surfaceFrees++;
    }

    /**
     * §9.1's integrals, charged forward: the last compose's paper, blur and older shares of the screen × the time it
     * stayed up; then this compose's shares. Blur is a coarser source or a patch; older a stale one — `olderPatch` while
     * the worker job that makes the cell exact is pending (A3 §3.4), `olderUnread` while its tiles are unread (f′),
     * `olderOther` else; paper nothing.
     */
    _charge(P, v) {
        const t = this._now();
        if (this._lastCompose != null) {
            const dt = t - this._lastCompose;
            const sh = this._share;
            this.s.paperMs += sh.paper * dt; this.s.blurMs += sh.blur * dt;
            this.s.olderPatchMs += sh.olderPatch * dt; this.s.olderUnreadMs += sh.olderUnread * dt; this.s.olderOtherMs += sh.olderOther * dt;
        }
        this._lastCompose = t;
        const area = { paper: 0, blur: 0, olderPatch: 0, olderUnread: 0, olderOther: 0 };
        const W = this.wDev, H = this.hDev;
        const devArea = (d) => {
            const x0 = Math.max(0, (d.x0 - v.ox) * v.s + v.dx), y0 = Math.max(0, (d.y0 - v.oy) * v.s + v.dy);
            const x1 = Math.min(W, (d.x1 - v.ox) * v.s + v.dx), y1 = Math.min(H, (d.y1 - v.oy) * v.s + v.dy);
            return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
        };
        // The level plan under a rest cell is drawn over there: a base draw is charged only outside the rest cells.
        const restBoxes = P.cells.filter((c) => c.rest).map((c) => c.box);
        const hidden = (d) => {
            let a = 0;
            for (const b of restBoxes) a += devArea({ x0: Math.max(d.x0, b[0]), y0: Math.max(d.y0, b[1]), x1: Math.min(d.x1, b[2]), y1: Math.min(d.y1, b[3]) });
            return a;
        };
        for (const c of P.cells) {
            for (const d of c.draws) {
                if (d.cls === "sharp") continue;
                const a = devArea(d) - (c.base ? hidden(d) : 0);
                if (a > 0) area[d.cls === "older" ? (d.wait ? "olderPatch" : d.unread ? "olderUnread" : "olderOther") : d.cls] += a;
            }
        }
        const scr = W * H;
        this._share = { paper: area.paper / scr, blur: area.blur / scr, olderPatch: area.olderPatch / scr, olderUnread: area.olderUnread / scr, olderOther: area.olderOther / scr };
    }

    // ---- the rest render (A3 §2) ----

    /** The first still frame: the visible rest cells inline when the estimate fits, else in the workers after the quiet. */
    _onStill() {
        const v = this._v, K = this._standIn;
        // Back at the kept set's own Z, bit for bit: its records are the rest set again, shown once it lacks nothing.
        const back = !this._rest && !!K && K.frame === v.frameId && K.Z === v.Z;
        if (back) { this._standIn = null; this._rest = { frame: v.frameId, Z: v.Z, shown: false, gen: ++this.gens.rest }; }
        const want = this._restWant(v.frameId, v.Z);
        if (!want.length) {
            if (!back) return false;
            this._rest.shown = true;
            this._publishView(v);
            return true;
        }
        if (!this._rest) this._rest = { frame: v.frameId, Z: v.Z, shown: false, gen: ++this.gens.rest };
        const job = this._job("rest", 0, { frame: v.frameId, Z: v.Z, cells: want, purpose: "rest", gen: this._rest.gen });
        const T = this.estimate(job);
        const heavy = this._heavyAt > 0 && T > this._heavyAt / 2;
        if (!heavy) this._heavyAt = 0;
        if (this.cfg.restInline !== "never" && !heavy && T <= cfgOr(this.cfg, "restInlineMs")) {
            const t0 = this._now();
            const recs = this._renderInline(job);
            for (const r of recs) this._take(r);
            const ms = this._now() - t0;
            this.s.restInline++; this.s.restMs = ms;
            if (ms > cfgOr(this.cfg, "restInlineMs")) { this._heavyAt = T; this.s.restHeavy++; }
            this._rest.shown = true;
            this._publishView(v);
            return true;
        }
        if (this._restTimer == null) {
            const quiet = this.cfg.restQuietMs != null ? this.cfg.restQuietMs : EST_DEFAULTS.restQuietMs;
            this._restTimer = this._setTimer(() => { this._restTimer = null; this._postRest(); }, quiet);
        }
        return false;
    }

    /** The quiet ran out with the camera still: the rest cells go to the workers as one group, shown when all are in. */
    _postRest() {
        const v = this._v, R = this._rest;
        if (!R || R.frame !== v.frameId || R.Z !== v.Z) return;
        const want = this._restWant(R.frame, R.Z);
        if (!want.length) return;
        const job = this._job("rest", 0, { frame: R.frame, Z: R.Z, cells: want, purpose: "rest", gen: R.gen });
        const g = this._openGroup("rest:" + R.gen + ":" + (++this._seqGroup), want.map((c) => c.key), () => {
            if (this._rest !== R) return;
            R.shown = true;
            this._map(R.frame, R.Z, this._S, this._lv);
            this._publishView(this._v);
        }, "rest");
        job.group = g.id;
        this.s.restWorker++;
        this._request([job]);
    }

    /** Rest cells on screen at (F, Z) with no plate (a stale one is the patch step's), not held for a group, not asked for. */
    _restWant(F, Z) {
        const r = plateRange(this._win, Z), out = [];
        for (let j = r.j0; j <= r.j1; j++) {
            for (let i = r.i0; i <= r.i1; i++) {
                const c = restCell(F, Z, i, j);
                if (this.store.get(c.key) || !this._wanted(c)) continue;
                out.push(c);
            }
        }
        return out;
    }

    _wanted(c) {
        if (this._groupOf.has(c.key)) return false;
        if (!this.store.wants(c.key)) return false;
        const g = this._asked.get(c.key);
        return !(g != null && g >= this.store.fresh.dirtySince(c.key)) && this.covered(c);
    }

    /**
     * Whether the camera's table holds every tile under a camera-frame cell (A3 §4.2): one it does not is drawn from
     * stand-ins and never asked for, until the idle read brings its tiles in (a commit, and the next step asks).
     */
    covered(c) {
        const st = this.stage;
        return !st || !st.covers || String(c.frame) !== String(this._v.frameId) || st.covers(c.frame, boxOf(c.Z, c.i, c.j));
    }

    /**
     * Cells the pack refused (their tiles not in the table when it ran): asked for again once covered — by the plan, or
     * by their pen-up group (`_reaskGroups`), which keeps its path up meanwhile.
     */
    unask(cells) {
        for (const c of cells) {
            this._asked.delete(c.key);
            const g = this._groups.get(this._groupOf.get(c.key));
            if (g) (g.refused || (g.refused = new Map())).set(c.key, c);
        }
    }

    _onMove() {
        if (this._restTimer != null) { this._clearTimer(this._restTimer); this._restTimer = null; }
    }

    /**
     * A zoom, a frame change, a resize or a dpr change ends the rest set; its queued jobs are dropped by generation. A
     * zoom keeps its records as the stand-in (`_standInCell`), in place of the one an earlier zoom kept — unless it was
     * never shown (a worker set holds its results aside until all are in), when the earlier one stays; anything else
     * removes them all at once (not staled: they are wrong at another frame or grid, and removing closes their bitmaps).
     */
    _discardRest(why) {
        if (this._restTimer != null) { this._clearTimer(this._restTimer); this._restTimer = null; }
        const R = this._rest;
        if (R) {
            for (const g of [...this._groups.values()]) if (g.purpose === "rest") this._dropGroup(g.id);
            this._rest = null;
            this.gens.rest++;
            this.s.restDiscards++;
            this._lastDiscard = why;
        }
        const K = this._standIn = why !== "zoom" ? null : R && R.shown ? { frame: R.frame, Z: R.Z } : this._standIn;
        this.store.dropWhere((r) => r.kind === "rest" && !(K && r.frame === K.frame && r.Z === K.Z));
    }

    // ---- the estimate (A3 §2.2, §3.3) ----

    /**
     * T = 0.73 µs·E + 34 ns·A + 0.15 ms·P (+ K_u·U + 0.3 ms a merged plate for patches) + the pack — a packed item's cost
     * a kept item and a prepass's a list item (an inline render follows a commit, whose new list misses the prepass) —
     * with the calibrated constants (PLAN §5.15 item 1: the undo's inline pack was 45–64 ms and priced at 0).
     */
    estimate(job) {
        const m = this._measure ? this._measure(job) : null;
        if (!m) return Infinity;
        const k = this._k;
        let T = k.edge * (m.E || 0) + k.px * (m.A || 0) + k.pack * (m.K || 0) + k.list * (m.N || 0);
        if (job.kind === "patch") T += k.union * (m.U || 0) + k.merge * job.cells.length;
        else T += k.cell * (m.P || 0);
        job.est = m;
        return T;
    }

    /**
     * Online calibration (A3 §2.2): `{ edges, edgesMs, px, accumMs, unionRows, unionMs }` from a job's `ras.*`
     * timings and counts, `{ packMs, packItems, prepassMs, listItems }` from a pack (`RasterRenderer._pyrPack`); each
     * constant moves by an EWMA when its sample is large enough to mean something.
     */
    calibrate(t) {
        const k = this._k;
        if (t.edges > 1000 && t.edgesMs >= 0) k.edge += EWMA * (t.edgesMs / t.edges - k.edge);
        if (t.px > 10000 && t.accumMs >= 0) k.px += EWMA * (t.accumMs / t.px - k.px);
        if (t.unionRows > 16 && t.unionMs >= 0) k.union += EWMA * (t.unionMs / t.unionRows - k.union);
        if (t.packItems > 20 && t.packMs >= 0) k.pack += EWMA * (t.packMs / t.packItems - k.pack);
        if (t.listItems > 500 && t.prepassMs >= 0) k.list += EWMA * (t.prepassMs / t.listItems - k.list);
        this.s.calibrations++;
        return { ...k };
    }

    // ---- the inline executor (A3 §2.3, §3.2) ----

    /**
     * Render a typed job's cells on this thread: `pack(job)` at the Stage's G, `renderPlate` per cell (its clip when
     * the job has clips) into the one RGBA scratch, then a bitmap (`OffscreenCanvas` + `transferToImageBitmap`) or,
     * in jsdom, raw pixels. Returns the records: whole plates, or `{ ..., clip, patch }` for a clipped cell.
     */
    _renderInline(job) {
        const packed = this._pack ? this._pack(job) : null;
        if (this._pack && !packed) return [];            // every cell refused: none is rendered from a table lacking its tiles
        const G = packed && packed.G != null ? packed.G : (this.stage ? this.stage.generation : 0);
        const out = [];
        if (!this._scratch) this._scratch = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
        const sc = this._scratch, counts = this._counts, tm = this._timings;
        const sum = { edges: 0, edgesMs: 0, px: 0, accumMs: 0, unionMs: 0, clipMs: 0, unionRows: job.est && job.est.U ? job.est.U : 0 };
        // The pack may keep fewer cells than the job asked (the table's cover): plate p is `packedCells[p]`.
        const cells = job.packedCells || job.cells, clips = job.packedCells ? job.packedClips : job.clips;
        for (let p = 0; p < cells.length; p++) {
            const c = cells[p], clip = clips && !isWhole(clips[p]) ? clips[p] : null;
            const rec = { ...c, G, jobId: null, bitmap: null, pixels: null, bytes: 0 };
            if (packed && packed.nItems > 0) {
                counts.fill(0); tm.fill(0);
                renderPlate(packed, p, sc, counts, tm, clip);
                sum.edges += counts[4]; sum.px += counts[7]; sum.clipMs += tm[2]; sum.edgesMs += tm[4]; sum.unionMs += tm[5]; sum.accumMs += tm[6];
                if (!clip && counts[1] === 0) { out.push(rec); continue; }
            } else if (!clip) { out.push(rec); continue; }
            else fillPaper(sc, this._paperRGB, clip);
            // The scratch is the next cell's: a patch leaves as its own clip-sized copy.
            if (clip) { rec.clip = clip; rec.patch = copyPlate(sc, clip); out.push(rec); continue; }
            if (this._pixels) rec.pixels = copyPlate(sc);
            else rec.bitmap = this._bitmapOf(sc);
            rec.bytes = PLATE_BYTES;
            out.push(rec);
        }
        this.lastSample = sum;
        if (this._onSample && (sum.edges || sum.px)) this._onSample(sum);
        return out;
    }

    /** A typed job rendered on this thread now and landed as any result (the drag plane's stopgap, A3 §6). Returns the records. */
    renderNow(job) {
        const recs = this._renderInline(job);
        for (const r of recs) this.onResult(r);
        return recs;
    }

    /** The one scratch `OffscreenCanvas` (+1 MiB in all, A3 §3.2). */
    _offscreen() {
        if (!this._oc) this._oc = this._makeOffscreen(PLATE_PX, PLATE_PX);
        return this._oc;
    }

    _bitmapOf(rgba) {
        const oc = this._offscreen(), c = oc.getContext("2d");
        c.putImageData(new ImageData(rgba, PLATE_PX, PLATE_PX), 0, 0);
        return oc.transferToImageBitmap();
    }

    /**
     * Land a patch in record `old` (A3 §3.2): the GPU merge through the scratch — draw the old plate, the patch's
     * rectangle over it, `transferToImageBitmap` — or in jsdom `pastePatch` into its pixels. A paper plate is
     * filled first. `patch` is the clip's RGBA (`copyPlate(rgba, clip)`) or, from a worker, the clip's bitmap.
     */
    merge(old, patch, clip) {
        const [x0, y0, x1, y1] = clip, w = x1 - x0, h = y1 - y0;
        this.s.merges++;
        if (this._pixels) return { pixels: pastePatch(old.pixels || paperPlate(this._paperRGB), patch, clip) };
        const oc = this._offscreen(), c = oc.getContext("2d");
        if (old.bitmap) c.drawImage(old.bitmap, 0, 0);
        else { c.fillStyle = this.paper; c.fillRect(0, 0, PLATE_PX, PLATE_PX); }
        if (patch instanceof Uint8ClampedArray) c.putImageData(new ImageData(patch, w, h), x0, y0);
        else c.drawImage(patch, x0, y0);
        return { bitmap: oc.transferToImageBitmap() };
    }

    // ---- results ----

    /**
     * A result from the workers or the inline executor: a rest cell of a discarded set is closed; one a group waits
     * for is held aside — packed at or after the group's G, or exact at landing (rule 2: then no commit since touched
     * the cell, the group's strokes included); a patch (`clip`) is merged into its record; anything else is put (rule 1).
     * @returns {string} what happened
     */
    onResult(rec) {
        const ofSet = (R) => !!R && rec.frame === R.frame && rec.Z === R.Z;
        if (rec.kind === "rest" && !ofSet(this._rest) && !ofSet(this._standIn)) {
            this.s.discarded++;
            this.store.discard(rec);
            return "discarded";
        }
        const g = this._groups.get(this._groupOf.get(rec.key));
        if (g && g.need.has(rec.key)) {
            if (rec.G >= g.G || rec.G >= this.store.fresh.dirtySince(rec.key)) {
                g.need.delete(rec.key);
                this._hold(g, rec);
                if (!g.need.size) this._commitGroup(g);
                return "held";
            }
            if (g.purpose === "live") return this._notForGroup(g, rec);
        } else if (g && g.purpose === "live") {
            // A second result for a cell the group holds: the newer is kept aside, nothing is put before the commit.
            const n = g.held.findIndex((r) => r.key === rec.key);
            if (n >= 0) {
                if (rec.G > g.held[n].G) { this._unhold(g, g.held[n]); g.held.splice(n, 1); this._hold(g, rec); } else this.store.discard(rec);
                return "held";
            }
        }
        return this._take(rec);
    }

    /**
     * A pen-up group's cell landed without what the group waits for (packed before its G and staled since): put only when
     * it shows none of the group's strokes — one that does would draw a stroke twice beside its path, which stays up
     * until the commit (never both, A3 §3.6) — and asked again inside the group unless a job asked since the group's G,
     * or another in flight, is coming for it (F135).
     */
    _notForGroup(g, rec) {
        const a = this._asked.get(rec.key), f = this.store.inflight.get(rec.key);
        const coming = (a != null && a >= g.G) || (!!f && !f.refused && f.jobId !== rec.jobId);
        let out = "dropped";
        if (rec.G >= g.G0) { this.s.discarded++; this.store.discard(rec); } else out = this._take(rec);
        if (coming) return out;
        const cur = this.store.get(rec.key);
        if (cur) this._askGroup(g, [cur], []); else this._askGroup(g, [], [cellOf(rec)]);
        return out;
    }

    _hold(g, rec) {
        g.held.push(rec);
        const b = heldBytes(rec);
        g.bytes += b; this.store.holdBytes(b);
    }

    _unhold(g, rec) {
        const b = heldBytes(rec);
        g.bytes -= b; this.store.holdBytes(-b);
        this.store.discard(rec);
    }

    /** Put a whole plate, or merge a patch into its record: `G` is raised only when the clip covers the dirt since the record's G. */
    _take(rec) {
        this._asked.delete(rec.key);
        if (rec.clip && isWhole(rec.clip)) {
            const px = rec.patch || rec.pixels;
            rec = { ...rec, clip: null, patch: null, pixels: this._pixels ? px || null : null, bitmap: rec.bitmap || (px && !this._pixels ? this._bitmapOf(px) : null), bytes: PLATE_BYTES };
        }
        if (!rec.clip) return this.store.put(rec);
        const old = this.store.get(rec.key);
        const patch = rec.patch || rec.pixels || rec.bitmap;
        if (!old || !patch || !(rec.G > old.G)) {
            this.s.mergeMisses++;
            if (rec.bitmap) this.store.discard(rec);
            return "stale";
        }
        const covers = this._covers(old, rec.clip);
        const m = this.merge(old, patch, rec.clip);
        if (rec.bitmap && rec.bitmap.close) rec.bitmap.close();
        this.store.patch(rec.key, { bitmap: m.bitmap || null, pixels: m.pixels || null, G: rec.G, covers });
        return covers ? "patched" : "patched-stale";
    }

    /** Does plate-local `clip` hold every dirty rectangle since the record's G, over the plate grown by a pixel (A3 §3.2)? */
    _covers(rec, clip) {
        const rs = this.stage && this.stage.dirtyRects ? this.stage.dirtyRects(rec.frame, rec.G) : null;
        if (!rs) return clip[0] === 0 && clip[1] === 0 && clip[2] === PLATE_PX && clip[3] === PLATE_PX;
        const Z = rec.Z, pad = cellBox(rec), cb = boxOf(Z, rec.i, rec.j);
        const cx = { left: (rec.i * PLATE_PX + clip[0]) / Z, top: (rec.j * PLATE_PX + clip[1]) / Z, right: (rec.i * PLATE_PX + clip[2]) / Z, bottom: (rec.j * PLATE_PX + clip[3]) / Z };
        for (const r of rs) {
            if (!meets(r, pad)) continue;
            const x = inter(r, cb);
            if (!x) continue;
            if (x.left < cx.left || x.top < cx.top || x.right > cx.right || x.bottom > cx.bottom) return false;
        }
        return true;
    }

    // ---- partial re-render (A3 §3.3–§3.5) ----

    /**
     * A Stage commit staled what it dirtied (the renderer's hook, after its pen-up groups open): its patch step is due in
     * this task — the next compose or `frameFor` runs it, else the renderer's microtask (`patchIfDue`) — so no compose
     * draws a plate a commit staled with no patch asked (PLAN §5.15 item 1). Not run in the hook itself: an undo's
     * `noteUserEdit` follows its commit and sets the patch's budget. Returns whether it was not due already.
     */
    noteCommit() {
        if (this._patchDue) return false;
        this._patchDue = true;
        return true;
    }

    /** A commit's patch step, unless a compose or a camera step has run it. */
    patchIfDue() { if (this._patchDue) this._patchStep(); }
    get patchDue() { return this._patchDue; }

    /** The stale cells the view draws from its own grid: patched now or asked for, never left older than they must be. */
    _patchStep() {
        const v = this._v, st = this.store;
        this._patchDue = false;
        if (v.frameId == null || !this.stage) return;
        const cells = [];
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                const r = st.get(v.mode === "rest" ? restKey(v.frameId, v.Z, i, j) : levelKey(v.frameId, v.level, v.S, i, j));
                if (!r || st.exact(r) || this._groupOf.has(r.key) || !this.covered(r)) continue;
                const g = this._asked.get(r.key);
                if (g != null && g >= st.fresh.dirtySince(r.key)) continue;
                cells.push(r);
            }
        }
        if (!cells.length) return;
        this.applyPatchPlan(this.patchPlan(cells));
    }

    /**
     * Per stale cell, the clip of the dirty rectangles since its G (grown a pixel; null, the whole cell, where the
     * log no longer reaches), and the decision: inline at full resolution when T_patch fits the budget; else the
     * finest coarser level whose patches fit, drawn over the dirty rectangles by the plan's rule (e), with the full
     * patches asked for at priority 0; else everything to the workers. The budget is `patchUserMs` (one frame) for a
     * user's action — an undo, a redo or a drop (`noteUserEdit`), a pen-up's group — which is paid once, and its
     * coarse level USER_COARSE_FRAMES of them; `patchInlineMs` for the patches the bake issues at every step. A pen-up's
     * group waits for full resolution (A3 §3.6): it searches no coarser level.
     * @param {object[]} cells records @param {(F, G)=>object[]|null} [dirtyRects] the Stage's, by default
     * @param {boolean} [user] a pen-up's group
     */
    patchPlan(cells, dirtyRects = null, user = false) {
        const dr = dirtyRects || ((F, G) => (this.stage && this.stage.dirtyRects ? this.stage.dirtyRects(F, G) : null));
        const v = this._v, S = v.S, N = Math.ceil(8 / S), floor = ownFloor(S);
        const items = [], rects = [];
        for (const r of cells) {
            const rs = dr(r.frame, r.G), pad = cellBox(r), cb = boxOf(r.Z, r.i, r.j);
            let clip = null;
            if (rs) {
                let bb = null;
                for (const x0 of rs) {
                    if (!meets(x0, pad)) continue;
                    const x = inter(x0, cb);
                    if (!x) continue;
                    rects.push(x);
                    bb = bb ? { left: Math.min(bb.left, x.left), top: Math.min(bb.top, x.top), right: Math.max(bb.right, x.right), bottom: Math.max(bb.bottom, x.bottom) } : x;
                }
                if (bb) clip = clipOf(bb, r);
            } else rects.push(cb);
            items.push({ rec: r, clip });
        }
        const job = this._job("patch", 0, { frame: cells[0].frame, Z: cells[0].Z, cells: items.map((x) => descr(x.rec)), clips: items.map((x) => x.clip || [0, 0, PLATE_PX, PLATE_PX]), purpose: "patch", gen: this.gens.patch });
        if (cells[0].kind === "level") { job.level = cells[0].level; job.S = cells[0].S; }
        const mine = user || (this._userG > 0 && cells.some((r) => this.store.fresh.dirtySince(r.key) === this._userG));
        const T = this.estimate(job), budget = cfgOr(this.cfg, mine ? "patchUserMs" : "patchInlineMs");
        const out = { items, job, T, inline: T <= budget, coarse: null };
        // The last decision, for the report and the harness (the undo's path, PLAN §5.11 Q3).
        this.lastPatch = { cells: cells.length, T: +T.toFixed(2), budget, user: mine, inline: out.inline, coarse: null, est: job.est || null };
        if (out.inline || user) return out;
        // Each coarser level costs a measure, a walk of the whole list. The pack's terms do not shrink with the level
        // (the same items meet the same rectangles): over the budget alone, no level fits. The search stops at the first
        // level with no records, whose patch is a whole render of its cells (PLAN §5.20 item 2).
        const cb = mine ? USER_COARSE_FRAMES * budget : budget;
        const m = job.est, packT = m ? this._k.pack * (m.K || 0) + this._k.list * (m.N || 0) : 0;
        this.lastPatch.levels = 0;
        for (let k = 1; k <= N && packT < cb; k++) {
            const l = v.level - k;
            if (l < floor) break;
            const cj = this._coarseJob(v.frameId, l, S, rects);
            if (!cj) break;
            const Tc = this.estimate(cj);
            this.lastPatch.levels++;
            if (Tc <= cb) { out.coarse = { level: l, job: cj, T: Tc }; this.lastPatch.coarse = { level: l, T: +Tc.toFixed(2) }; break; }
        }
        return out;
    }

    /** Level ℓ's cells over `rects`: a patch where the record exists (clip = the rects inside it), a whole render where not; null where no record exists. */
    _coarseJob(F, l, S, rects) {
        const Zl = zOf(l, S), per = new Map();
        for (const x of rects) {
            const r = plateRange(x, Zl);
            for (let j = r.j0; j <= r.j1; j++) {
                for (let i = r.i0; i <= r.i1; i++) {
                    const cb = boxOf(Zl, i, j), I = inter(x, cb);
                    if (!I) continue;
                    const key = i + "," + j, e = per.get(key);
                    if (e) e.bb = { left: Math.min(e.bb.left, I.left), top: Math.min(e.bb.top, I.top), right: Math.max(e.bb.right, I.right), bottom: Math.max(e.bb.bottom, I.bottom) };
                    else per.set(key, { i, j, bb: I });
                }
            }
        }
        if (!per.size) return null;
        const cells = [], clips = [];
        let kept = 0;
        for (const e of per.values()) {
            const c = levelCell(F, l, S, e.i, e.j), old = this.store.get(c.key), has = !!old && !!(old.bitmap || old.pixels);
            cells.push(c);
            clips.push(has ? clipOf(e.bb, c) : [0, 0, PLATE_PX, PLATE_PX]);
            if (has) kept++;
        }
        if (!kept) return null;
        const job = this._job("patch", 0, { frame: F, level: l, S, Z: Zl, cells, clips, purpose: "coarse", gen: this.gens.patch });
        return job;
    }

    /** Carry out `patchPlan`'s decision. Returns the records rendered inline. */
    applyPatchPlan(plan, group = null) {
        const t0 = this._now();
        const G = this.stage ? this.stage.generation : 0;
        if (plan.inline) {
            const recs = this._renderInline(plan.job);
            if (group) for (const r of recs) this.onResult(r); else for (const r of recs) this._take(r);
            this.s.patchInline++; this.s.patchMs = this._now() - t0;
            return recs;
        }
        let recs = [];
        if (plan.coarse) {
            recs = this._renderInline(plan.coarse.job);
            for (const r of recs) this._take(r);
            this.s.patchCoarse++;
        } else this.s.patchWorker++;
        for (const x of plan.items) this._asked.set(x.rec.key, G);
        if (group) plan.job.group = group;
        this._request([plan.job]);
        this.s.patchMs = this._now() - t0;
        return recs;
    }

    // ---- the group commit (A3 §3.6) ----

    /**
     * Pen-up: the drawn cells meeting `rect` (the view frame's units) are re-rendered — inline when the patch fits,
     * the swap in this task, else one priority-0 group whose results are held aside — and `onCommit(info)` runs in
     * the task that publishes them (the renderer releases the live path there). A pen-up over cells an open pen-up
     * group waits for or holds joins it (`_join`). A group older than LIVE_HOLD_MS commits what it has.
     */
    groupCommit(id, rect, onCommit) {
        const { stale, missing } = this._under(rect);
        const keys = stale.map((x) => x.key).concat(missing.map((c) => c.key));
        const m = { id, rect, G: this.stage ? this.stage.generation : 0, onCommit };
        const into = this._liveOver(keys);
        if (into) { this._join(into, m, stale, missing); return id; }
        const g = this._openGroup(id, keys, (info) => { for (const x of g.members) if (x.onCommit) x.onCommit({ ...info, id: x.id }); }, "live");
        g.members = [m]; g.G0 = g.G;
        if (!keys.length) { this._commitGroup(g); return id; }
        this._askGroup(g, stale, missing);
        return id;
    }

    /** The open pen-up group that waits for or holds any of `keys`, or null. */
    _liveOver(keys) {
        for (const k of keys) {
            const g = this._groups.get(this._groupOf.get(k));
            if (g && g.purpose === "live") return g;
        }
        return null;
    }

    /**
     * F135: pen-up groups over the same cells are one group, and both paths go at its commit — a plate that shows the
     * later stroke shows the earlier one too (two groups over one cell each took the other's results, and the first path
     * stayed LIVE_HOLD_MS over plates showing its stroke). Held results the new stroke staled go back to need; only cells
     * nothing is asked for are asked. The limit stays the first stroke's.
     */
    _join(g, m, stale, missing) {
        for (const k of stale.map((x) => x.key).concat(missing.map((c) => c.key))) {
            const o = this._groups.get(this._groupOf.get(k));
            if (o && o !== g && o.purpose === "live") this._absorb(g, o);
        }
        g.members.push(m);
        g.G = Math.max(g.G, m.G);
        const s1 = [], m1 = [], ask = (c) => { const r = this.store.get(c.key); if (r) s1.push(r); else m1.push(c); };
        for (let n = g.held.length - 1; n >= 0; n--) {
            const r = g.held[n];
            if (r.G >= g.G || r.G >= this.store.fresh.dirtySince(r.key)) continue;
            g.held.splice(n, 1); this._unhold(g, r);
            g.need.add(r.key); ask(cellOf(r));
        }
        const held = new Set(g.held.map((r) => r.key));
        for (const c of [...stale, ...missing]) {
            if (g.need.has(c.key) || held.has(c.key)) continue;
            g.need.add(c.key); this._groupOf.set(c.key, g.id); ask(c);
        }
        if (s1.length || m1.length) this._askGroup(g, s1, m1);
    }

    /** Group `o` into `g`: its members, cells and held results. */
    _absorb(g, o) {
        this._groups.delete(o.id);
        g.members.push(...o.members);
        g.G = Math.max(g.G, o.G); g.G0 = Math.min(g.G0, o.G0); g.at = Math.min(g.at, o.at);
        for (const k of o.need) g.need.add(k);
        g.held.push(...o.held); g.bytes += o.bytes;
        if (o.refused) for (const [k, c] of o.refused) (g.refused || (g.refused = new Map())).set(k, c);
        for (const [k, id] of this._groupOf) if (id === o.id) this._groupOf.set(k, g.id);
    }

    /** A crossing carried a held path's rectangle into the view's new frame (`RasterRenderer._liveCross`). */
    moveGroup(id, rect) {
        for (const g of this._groups.values()) {
            const m = g.purpose === "live" ? g.members.find((x) => x.id === id) : null;
            if (m) { m.rect = rect; return; }
        }
    }

    /** The view's own drawn cells meeting `rect` that are not exact: `{ stale: records, missing: descriptors }`. */
    _under(rect) {
        const v = this._v, st = this.store;
        const Zg = v.mode === "rest" ? v.Z : zOf(v.level, v.S);
        const r = plateRange(rect, Zg), stale = [], missing = [];
        for (let j = Math.max(r.j0, v.j0); j <= Math.min(r.j1, v.j1); j++) {
            for (let i = Math.max(r.i0, v.i0); i <= Math.min(r.i1, v.i1); i++) {
                const c = v.mode === "rest" ? restCell(v.frameId, v.Z, i, j) : levelCell(v.frameId, v.level, v.S, i, j);
                const rec = st.get(c.key);
                if (rec && st.exact(rec)) continue;
                if (rec) stale.push(rec); else missing.push(c);
            }
        }
        return { stale, missing };
    }

    /** `_under` over several rectangles, each cell once. */
    _underAll(rects) {
        const seen = new Set(), stale = [], missing = [];
        for (const rect of rects) {
            const u = this._under(rect);
            for (const x of u.stale) if (!seen.has(x.key)) { seen.add(x.key); stale.push(x); }
            for (const c of u.missing) if (!seen.has(c.key)) { seen.add(c.key); missing.push(c); }
        }
        return { stale, missing };
    }

    /** A group's cells asked for: the stale ones patched (inline when it fits), the missing ones whole, at priority 0. */
    _askGroup(g, stale, missing) {
        const v = this._v;
        if (stale.length) {
            this.applyPatchPlan(this.patchPlan(stale, null, true), g.id);
        }
        if (missing.length && this._groups.has(g.id)) {
            const Zg = v.mode === "rest" ? v.Z : zOf(v.level, v.S);
            const job = this._job(v.mode === "rest" ? "rest" : "view", 0, { frame: v.frameId, Z: Zg, cells: missing, purpose: "live", gen: this.gens.view });
            if (v.mode !== "rest") { job.level = v.level; job.S = v.S; }
            job.group = g.id;
            const G = this.stage ? this.stage.generation : 0;
            for (const c of missing) this._asked.set(c.key, G);
            this._request([job]);
        }
    }

    /**
     * The view's drawn set moved (a zoom, a pan, a crossing) while a pen-up's group waits: it waits for the new drawn
     * cells under its rectangle instead (A3 §3.6 item 5); what it held stays held, what is no longer drawn is let go.
     */
    _retarget() {
        for (const g of [...this._groups.values()]) {
            if (g.purpose !== "live" || !this._groups.has(g.id)) continue;
            const { stale, missing } = this._underAll(g.members.map((m) => m.rect));
            const now = new Set(stale.map((x) => x.key).concat(missing.map((c) => c.key)));
            const held = new Set(g.held.map((r) => r.key));
            for (const k of [...g.need]) if (!now.has(k)) { g.need.delete(k); this._groupOf.delete(k); }
            const s1 = stale.filter((x) => !g.need.has(x.key) && !held.has(x.key)), m1 = missing.filter((c) => !g.need.has(c.key) && !held.has(c.key));
            for (const k of s1.map((x) => x.key).concat(m1.map((c) => c.key))) { g.need.add(k); this._groupOf.set(k, g.id); }
            if (!g.need.size) { this._commitGroup(g); continue; }
            this._askGroup(g, s1, m1);
        }
    }

    /** A group's cells the pack refused, asked for again inside the group once the table covers them. */
    _reaskGroups() {
        for (const g of [...this._groups.values()]) {
            if (!g.refused || !g.refused.size) continue;
            const stale = [], missing = [];
            for (const [k, c] of [...g.refused]) {
                if (g.need.has(k) && !this.covered(c)) continue;
                g.refused.delete(k);
                if (!g.need.has(k)) continue;
                const rec = this.store.get(k);
                if (rec) stale.push(rec); else missing.push(c);
            }
            if (stale.length || missing.length) this._askGroup(g, stale, missing);
        }
    }

    _openGroup(id, keys, onCommit, purpose) {
        const g = { id, need: new Set(keys), held: [], bytes: 0, at: this._now(), onCommit, purpose, G: this.stage ? this.stage.generation : 0 };
        this._groups.set(id, g);
        for (const k of keys) this._groupOf.set(k, id);
        this._lastGroup = id;
        return g;
    }

    /** Every held result put (or merged) at once, one compose, then `onCommit` — one task, so no frame shows both or neither. */
    _commitGroup(g, timedOut = false) {
        this._groups.delete(g.id);
        for (const [k, id] of [...this._groupOf]) if (id === g.id) this._groupOf.delete(k);
        this.store.holdBytes(-g.bytes);
        for (const r of g.held) this._take(r);
        if (timedOut) this.s.groupsTimedOut++; else this.s.groupsCommitted++;
        if (g.onCommit) g.onCommit({ id: g.id, committed: g.held.length, missing: g.need.size, timedOut });
        this.compose();
    }

    _dropGroup(id) {
        const g = this._groups.get(id);
        if (!g) return;
        this._groups.delete(id);
        for (const [k, gid] of [...this._groupOf]) if (gid === id) this._groupOf.delete(k);
        this.store.holdBytes(-g.bytes);
        for (const r of g.held) this.store.discard(r);
    }

    /** Groups older than LIVE_HOLD_MS commit what they have. */
    _checkGroups() {
        if (!this._groups.size) return;
        const t = this._now();
        for (const g of [...this._groups.values()]) if (t - g.at > LIVE_HOLD_MS) this._commitGroup(g, true);
    }

    // ---- requests ----

    /** The view's missing cells at its level (level mode), or under the rest cells the rest set lacks: priority 1, centre-out. */
    _requestView() {
        const v = this._v, st = this.store;
        if (v.frameId == null) return;
        const Zl = zOf(v.level, v.S), cells = [];
        const range = v.mode === "rest" ? this._bareRange(v) : { i0: v.i0, i1: v.i1, j0: v.j0, j1: v.j1 };
        if (!range) return;
        for (let j = range.j0; j <= range.j1; j++) {
            for (let i = range.i0; i <= range.i1; i++) {
                const c = levelCell(v.frameId, v.level, v.S, i, j);
                if (st.get(c.key) || !this._wanted(c)) continue;
                cells.push(c);
            }
        }
        if (!cells.length) return;
        const job = this._job("view", 1, { frame: v.frameId, level: v.level, S: v.S, Z: Zl, cells, purpose: "view", gen: this.gens.view });
        const G = this.stage ? this.stage.generation : 0;
        for (const c of cells) this._asked.set(c.key, G);
        this._request([job]);
    }

    /** The level range under the rest cells with no rest plate, or null. */
    _bareRange(v) {
        const st = this.store, Zl = zOf(v.level, v.S);
        let bb = null;
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                if (st.get(restKey(v.frameId, v.Z, i, j))) continue;
                const b = inter(boxOf(v.Z, i, j), this._win);
                if (!b) continue;
                bb = bb ? { left: Math.min(bb.left, b.left), top: Math.min(bb.top, b.top), right: Math.max(bb.right, b.right), bottom: Math.max(bb.bottom, b.bottom) } : b;
            }
        }
        return bb ? plateRange(bb, Zl) : null;
    }

    /** A typed job (`jobQueue.js`) with the attention point in the job's own grid px. */
    _job(kind, prio, o) {
        const job = { kind, prio, frame: o.frame, level: o.level != null ? o.level : null, S: o.S != null ? o.S : null, Z: o.Z,
            cells: o.cells, clips: o.clips || null, purpose: o.purpose, gen: o.gen, attention: null, group: null };
        const v = this._v, a = this._attn || [this.wDev / 2, this.hDev / 2];
        if (v.k > 0 && String(o.frame) === v.frameId) job.attention = [((a[0] - v.tx) / v.k) * o.Z, ((a[1] - v.ty) / v.k) * o.Z];
        return job;
    }

    _request(jobs) {
        if (!jobs.length) return;
        for (const j of jobs) { this.s.requests++; this.s.requestedCells += j.cells.length; }
        if (this._onRequest) this._onRequest(jobs);
    }

    // ---- teardown and the report ----

    /** The store released everything (a hidden tab): the surface and the rest set go with it. */
    onStoreRelease() {
        this._freeSurface();
        this._rest = null;
        this._standIn = null;
        this._asked.clear();
    }

    report() {
        const v = this._v;
        return {
            mode: v.mode, level: v.level, S: v.S, s: v.s, Z: v.Z, sigmaMin: this.sigmaMin, pinBound: this.pinBound,
            rest: this._rest ? { Z: this._rest.Z, shown: this._rest.shown } : null, standIn: this._standIn ? { Z: this._standIn.Z } : null,
            groups: this._groups.size,
            est: { ...this._k }, surfaceLive: !!this._surface, imagesMax10s: this._images.reduce((m, x, k) => (k % 2 ? Math.max(m, x) : m), 0), ...this.s,
        };
    }

    destroy() {
        this._patchDue = false;
        this._onMove();
        this._freeSurface();
        for (const id of [...this._groups.keys()]) this._dropGroup(id);
        const c = this._canvas;
        if (c && c.parentNode && c.parentNode.removeChild) c.parentNode.removeChild(c);
        this._canvas = null; this._ctx = null;
    }
}

/** The bytes a result held aside for a group counts against the cap. */
const heldBytes = (rec) => rec.bytes || (rec.bitmap || rec.pixels || rec.patch ? PLATE_BYTES : 0);
/** A record's cell descriptor (`levelCell`, `restCell`). */
const cellOf = (r) => (r.kind === "rest" ? restCell(r.frame, r.Z, r.i, r.j) : levelCell(r.frame, r.level, r.S, r.i, r.j));

/**
 * A worker result's core timings and counts (`rasterJob`'s per-plate arrays) as `calibrate`'s sample; `U` is the
 * union family-rows the estimate priced the job with (the result counts none of its own).
 */
export function sampleOf(res, U = 0) {
    const s = { edges: 0, edgesMs: 0, px: 0, accumMs: 0, unionMs: 0, unionRows: U };
    const n = res.plates ? res.plates.length / 2 : 0;
    for (let p = 0; p < n; p++) {
        const c = p * COUNTS_PER_PLATE, t = p * TIMINGS_PER_PLATE;
        if (res.counts) { s.edges += res.counts[c + 4]; s.px += res.counts[c + 7]; }
        if (res.timings) { s.edgesMs += res.timings[t + 4]; s.unionMs += res.timings[t + 5]; s.accumMs += res.timings[t + 6]; }
    }
    return s;
}

/** A cell (i, j) at grid zoom Zc as view-grid pixels at Zq: `[x0, y0, x1, y1]`. Exact when Zq/Zc is a power of two. */
function gBox(Zc, i, j, Zq) {
    const f = PLATE_PX * (Zq / Zc);
    return [i * f, j * f, (i + 1) * f, (j + 1) * f];
}
/** A frame-unit rectangle as view-grid pixels. */
const gRect = (b, Zq) => [b.left * Zq, b.top * Zq, b.right * Zq, b.bottom * Zq];

/** The part of `sub` (the cell's rectangle in its source plate) that `bb` covers inside cell box `cb`. */
function subIn(sub, cb, bb) {
    const w = cb.right - cb.left, h = cb.bottom - cb.top;
    const fx0 = (bb.left - cb.left) / w, fy0 = (bb.top - cb.top) / h, fx1 = (bb.right - cb.left) / w, fy1 = (bb.bottom - cb.top) / h;
    return [sub[0] + fx0 * sub[2], sub[1] + fy0 * sub[3], (fx1 - fx0) * sub[2], (fy1 - fy0) * sub[3]];
}

function draw(rec, src, g, cls, exact, under = false) {
    return { rec, sx: src[0], sy: src[1], sw: src[2], sh: src[3], x0: g[0], y0: g[1], x1: g[2], y1: g[3], cls, exact, under };
}

const isWhole = (c) => !c || (c[0] === 0 && c[1] === 0 && c[2] === PLATE_PX && c[3] === PLATE_PX);

/** A frame-unit box as a plate-local clip of cell `c`: rounded outward, grown a pixel, inside the plate. */
function clipOf(bb, c) {
    const Z = c.Z, ox = c.i * PLATE_PX, oy = c.j * PLATE_PX;
    const x0 = Math.max(0, Math.floor(bb.left * Z - ox) - 1), y0 = Math.max(0, Math.floor(bb.top * Z - oy) - 1);
    const x1 = Math.min(PLATE_PX, Math.ceil(bb.right * Z - ox) + 1), y1 = Math.min(PLATE_PX, Math.ceil(bb.bottom * Z - oy) + 1);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [0, 0, PLATE_PX, PLATE_PX];
}

/** A record's cell descriptor (no pixels). */
function descr(r) {
    return { key: r.key, frame: r.frame, kind: r.kind, level: r.level, S: r.S, Z: r.Z, tag: r.tag, i: r.i, j: r.j };
}

/** A plan's identity for the surface: which record, at which G, where. */
function planSig(P) {
    let s = P.v.i0 + "," + P.v.j0 + "," + P.v.i1 + "," + P.v.j1 + "|";
    for (const d of P.draws) s += (d.rec ? d.rec.key + "@" + d.rec.G : "-") + ":" + d.x0 + "," + d.y0 + "," + d.x1 + "," + d.y1 + ";";
    return s;
}

function parseHex(css) {
    const m = /^#([0-9a-f]{6})$/i.exec(css || "");
    return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [255, 255, 255];
}

/** An opaque plate of paper. */
function paperPlate(rgb) {
    const px = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    for (let k = 0; k < px.length; k += 4) { px[k] = rgb[0]; px[k + 1] = rgb[1]; px[k + 2] = rgb[2]; px[k + 3] = 255; }
    return px;
}

/** Paper over a clip of the scratch (an empty patch: nothing drawn there any more). */
function fillPaper(px, rgb, clip) {
    for (let y = clip[1]; y < clip[3]; y++) {
        for (let x = clip[0]; x < clip[2]; x++) {
            const k = (y * PLATE_PX + x) * 4;
            px[k] = rgb[0]; px[k + 1] = rgb[1]; px[k + 2] = rgb[2]; px[k + 3] = 255;
        }
    }
}
