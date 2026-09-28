/**
 * MovePlane.js — the drag plane (PAPER-PLAN §10 S4, S4z and §10.14; B-drag-bitmap folded with Kobin's
 * 2026-09-22 rule: "recalculate the part of the tile under the object being moved, as soon as the
 * object is selected, so it is ready when you start moving it").
 *
 * The picture on screen is split BY Z into layers of plates, kept while a selection exists: BELOW
 * (everything under the selection, opaque, with the paper), then in paint order each run of selected
 * families (SEL, transparent, drawn translated by the pointer) and each run of unselected families
 * above one (OVER, transparent, drawn in place). The compose draws them in that order over the
 * ordinary plates, so a dragged object passes under what is above it at every frame.
 *
 * Nothing is refused. Past MOVE_PLANE_LAYERS the smallest run sandwiched between two selected ones
 * is drawn under the selection (`merged`); past the plate cap the layers are cut an octave coarser,
 * up to PLANE_COARSEN_MAX (`coarse`), and drawn magnified — the coarsest is taken whatever it costs
 * (`overCap`). Layers are named by their members, so a re-cut that changes a run is a new layer. A
 * QUICK level, PLANE_QUICK_OCTAVES coarser again and inside the same cap, is asked for first: it is
 * drawn until the plane's own level is whole. Until either is, the
 * selection's own layers are drawn alone where they are in (the ink also shows where it was), and a
 * small selection's are rastered on the spot (`RasterRenderer._planeStopgap`).
 *
 * Where each layer is needed: SEL at the selection's own cells, OVER at its families' cells, BELOW
 * at the union of all of them. The layers are cut on `rasterPack.paintFamilies`, the pack's own
 * family order, from the list the selection was made in: the drag does not rebuild the list. The
 * plates live in the `PlateStore` under their own tags, pinned (`setPlanePins`).
 */

import { PLATE_PX, PREVIEW_QUANTA, QUANTA_PER_OCTAVE, plateKey, zqOf } from "./plate";
import { paintFamilies } from "./rasterPack";

/** Layers a plane may split the picture into (below, sel, between, sel, above); past it runs are merged. */
export const MOVE_PLANE_LAYERS = 5;
/** Plates a plane may pin, its quick level included (an empty plate costs no bytes); past it the layers are coarser. */
// The same share of each cache: 40 of the desktop's 96, 24 of the phone's 56. The rest holds the visible
// set and the ladder, which a 64-plate plane pushed out (review minor 5). At 12 a phone refused an object
// under one other (16 plates) and its drag tore a plate at a time (Kobin's report 2026-09-23 08-11-20).
export const MOVE_PLANE_PLATES = 40;
export const MOVE_PLANE_PLATES_PHONE = 24;
/** Octaves a plane may be cut coarser than the view to fit its cap. */
export const PLANE_COARSEN_MAX = 3;
/** The quick level: this many octaves under the plane's own, asked for first (a sixteenth of the plates). */
export const PLANE_QUICK_OCTAVES = 2;
/** A plane of at most this many plates has no quick level: it is as quick. */
const PLANE_QUICK_MIN = 4;
/**
 * A level drawn magnified (coarser than the view) draws scaled images: past 33 of those a frame
 * costs ~100 ms in Chrome (PictureLayer.COMPOSE_IMAGES), so such a level stays under this.
 */
const PLANE_SCALED_MAX = 16;
/**
 * The longest a landing plane waits for the fresh plates — a safety limit, counted in `landTimeouts`;
 * a view change ends it sooner. At B's 600 ms a busy main thread ended it on the stale picture and
 * the object jumped back until its plates landed (review minor 6).
 */
export const MOVE_HOLD_MS = 3000;

export const planeStats = {
    builds: 0, merged: 0, coarse: 0, overCap: 0, requests: 0, drags: 0, notReady: 0, lost: 0,
    quickSteps: 0, partialSteps: 0, stopgaps: 0, stopgapMsMax: 0,
    lands: 0, landTimeouts: 0, landMsMax: 0,
    composes: 0, underBlits: 0, inkBlits: 0, overBlits: 0, clipComposes: 0, maxLayers: 0,
    farListFallbacks: 0,   // a far level that never got its own list and packs from the camera's (F122's paper risk)
};

export function resetPlaneStats() { for (const k of Object.keys(planeStats)) planeStats[k] = 0; }

/** An order-free name for an id set: a sum and a xor of each id's mix, and the count (no strings, no sort). */
function idsHash(ids) {
    let a = 0, b = 0;
    for (const id of ids) {
        let h = Math.imul(Number(id) ^ 0x9e3779b9, 0x85ebca6b);
        h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
        a = (a + h) | 0; b ^= h;
    }
    return (a >>> 0).toString(36) + "." + (b >>> 0).toString(36) + "." + ids.size;
}

/** Bounding plate range of a cell list, or null. */
function rangeOf(cells) {
    if (!cells.length) return null;
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const [i, j] of cells) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    return { i0, i1, j0, j1 };
}

export default class MovePlane {
    constructor() {
        this.stats = planeStats;      // the layer counts into it without importing this module
        this.gen = 0;                 // bumped by every reset: the caller frees the old plates when it moves
        this._reset();
    }

    _reset() {
        this.sel = null;          // the engine's selection identity the plane was built for
        this.ids = null;          // the selection's ids in that list
        this.list = null;
        this.vr = "";             // the view's plate range the layers were cut over
        this.frameId = null; this.q = null; this.Zq = 1;   // the VIEW the plane was cut for
        this.main = null;         // the plane's own level: { k, pq, pZq, layers, keys, tags, r, selR, below: Set of "i,j" }
        this.quick = null;        // the quick level, coarser, or null
        this.cur = null;          // the level drawn this compose
        this.partial = false;     // `cur` drawn by its selected layers alone (not whole yet)
        this.stop = null;         // a stopgap: { pZq, layers } of selected layers rastered on the main thread
        this.layers = [];         // the main level's layers: [{ kind: "below"|"sel"|"over", tag, cells, ids?, omit? }]
        this.selIds = null;       // every selected id the layers carry: what other packs omit during the drag
        this.max = 0;
        this.tags = [];           // every level's tags
        this.r = null;            // the main level's cells, bounded
        this.selR = null;         // the main level's selected cells, bounded
        this.keys = [];           // every level's keys, pinned in the store
        this.state = "idle";      // idle | drag | land
        this.ready = false;       // the main level cached
        this.off = [0, 0];        // device px, whole
        this.landUntil = 0;
        this.landAt = 0;
        this.refused = false;
        this.gen = (this.gen || 0) + 1;
    }

    /** Is a plane drawn this compose? */
    get showing() { return this.state === "drag" || this.state === "land"; }

    /** Plates the plane pins. */
    cellCount() { return this.keys.length; }

    /**
     * (Re)aim the plane at a selection, a list and a view. Returns true when the plane is (still)
     * valid for them; a change of selection, frame or zoom resets it (the caller frees the old tags,
     * `gen`). A new list, or a view over other plates, with the same selection re-cuts the layers,
     * so a pan keeps what is cached (the Stage's items keep their array while the table does).
     */
    aim(st, list, view, cfg, max, dpr = 1, live = null) {
        if (this.state === "drag" || this.state === "land") return true;
        // Zq as well as q: a settled view is q "e" at whatever exact zoom the camera stopped at.
        const same = st && this.sel === st.key && this.frameId === view.frameId && this.q === view.q && this.Zq === view.Zq;
        if (!same) {
            this._reset();
            if (!st || !st.ids || !st.ids.size) return false;
            this.sel = st.key; this.frameId = view.frameId; this.q = view.q; this.Zq = view.Zq;
            planeStats.builds++;
        }
        const vr = view.i0 + "," + view.i1 + "," + view.j0 + "," + view.j1;
        if (this.list !== list || this.ids !== st.ids || this.max !== max || this.vr !== vr) {
            this.list = list; this.ids = st.ids; this.max = max; this.vr = vr;
            this._cut(list, st.ids, view, cfg, max, dpr, live);
        }
        return !this.refused;
    }

    /** The runs: the pack's families in paint order, cut into selected and unselected ones on screen. */
    _cut(list, ids, view, cfg, max, dpr, live) {
        this.main = null; this.quick = null; this.cur = null; this.stop = null; this.ready = false; this.partial = false;
        this.layers = []; this.keys = []; this.tags = []; this.r = null; this.selR = null; this.selIds = null; this.refused = true;
        const s = view.Zq / PLATE_PX;
        const runs = [];
        for (const f of paintFamilies(list, view.q, view.Zq, dpr, cfg, live)) {
            if (f.all.length && f.all.every((d) => d.o.erase)) continue;   // a pending mark paints nothing: every layer's pack masks with it
            let sel = false, on = false;
            for (const d of f.all) {
                if (ids.has(d.o.id)) sel = true;
                const b = d.box;
                if (Math.floor(b[2] * s) >= view.i0 && Math.floor(b[0] * s) <= view.i1 && Math.floor(b[3] * s) >= view.j0 && Math.floor(b[1] * s) <= view.j1) on = true;
            }
            if (!on) continue;                             // nothing on screen: it can neither cover nor be covered here
            let run = runs[runs.length - 1];
            if (!run || run.sel !== sel) runs.push(run = { sel, ids: new Set(), boxes: [] });
            for (const d of f.all) { run.ids.add(d.o.id); run.boxes.push(d.box); }
        }
        if (!runs.some((r) => r.sel)) { this.refused = true; return; }   // nothing selected on screen
        if (!runs[0].sel) runs.shift();                    // BELOW is everything else, by `omit`
        const nLayers = runs.length + 1;
        if (nLayers > planeStats.maxLayers) planeStats.maxLayers = nLayers;
        // Past the layer cap, the smallest run sandwiched between two selected ones goes under the
        // selection (it leaves `omit`, so BELOW draws it) and the two selected runs become one.
        while (runs.length + 1 > MOVE_PLANE_LAYERS) {
            let m = -1;
            for (let k = 1; k < runs.length - 1; k++) if (!runs[k].sel && (m < 0 || runs[k].boxes.length < runs[m].boxes.length)) m = k;
            if (m < 0) break;
            const a = runs[m - 1], b = runs[m + 1];
            for (const id of b.ids) a.ids.add(id);
            for (const x of b.boxes) a.boxes.push(x);
            runs.splice(m, 2);
            planeStats.merged++;
        }
        this.selIds = new Set();
        for (const r of runs) if (r.sel) for (const id of r.ids) this.selIds.add(id);
        // Between quanta every level is drawn magnified, so each counts against the scaled cap.
        const capAt = (k) => (k || view.s !== 1 ? Math.min(max, PLANE_SCALED_MAX) : max);
        let main = null;
        for (let k = 0; k <= PLANE_COARSEN_MAX && !main; k++) {
            const L = this._level(runs, view, k);
            if (L.plates <= capAt(k)) main = L;
            else if (k === PLANE_COARSEN_MAX) { main = L; planeStats.overCap++; }   // the coarsest whatever it costs: a drag always moves
        }
        if (main.k) planeStats.coarse++;
        if (main.plates > PLANE_QUICK_MIN) {
            // Pinned with the main level: both inside the one cap.
            const Q = this._level(runs, view, main.k + PLANE_QUICK_OCTAVES);
            if (Q.plates < main.plates && main.plates + Q.plates <= max && Q.plates <= PLANE_SCALED_MAX) this.quick = Q;
        }
        this.main = main;
        this.layers = main.layers;
        this.r = main.r; this.selR = main.selR;
        for (const L of [main, this.quick]) if (L) { for (const t of L.tags) this.tags.push(t); for (const key of L.keys) this.keys.push(key); }
        this.refused = false;
    }

    /** The layers at `k` octaves coarser than the view: cells, tags and keys; `plates` is their count. */
    _level(runs, view, k) {
        let pq = view.q, pZq = view.Zq;
        if (k) {
            const q0 = typeof view.q === "number" ? view.q : Math.floor(Math.log2(view.Zq) * QUANTA_PER_OCTAVE + 1e-9);
            pq = q0 - k * QUANTA_PER_OCTAVE; pZq = zqOf(pq);
        }
        const f = pZq / view.Zq, s = pZq / PLATE_PX;
        const vi0 = Math.floor(view.i0 * f), vi1 = Math.floor((view.i1 + 1) * f - 1e-9);
        const vj0 = Math.floor(view.j0 * f), vj1 = Math.floor((view.j1 + 1) * f - 1e-9);
        const cellsOf = (boxes) => {
            const out = new Set();
            for (const b of boxes) {
                const i0 = Math.max(Math.floor(b[0] * s), vi0), i1 = Math.min(Math.floor(b[2] * s), vi1);
                const j0 = Math.max(Math.floor(b[1] * s), vj0), j1 = Math.min(Math.floor(b[3] * s), vj1);
                for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.add(i + "," + j);
            }
            return out;
        };
        const toList = (set) => [...set].map((c) => c.split(",").map(Number));
        const below = new Set(), omit = new Set(), per = [];
        for (const r of runs) {
            const c = cellsOf(r.boxes);
            per.push(c);
            for (const x of c) below.add(x);
            for (const id of r.ids) omit.add(id);
        }
        const layers = [{ kind: "below", cells: toList(below), omit }];
        runs.forEach((r, n) => layers.push({ kind: r.sel ? "sel" : "over", cells: toList(per[n]), ids: r.ids }));
        const tags = [], keys = [];
        let plates = 0;
        layers.forEach((L, n) => {
            // Named by what the layer holds: a re-cut that changes a run's members is a new layer, not the old plates.
            L.tag = "z" + n + "_" + pq + "_" + idsHash(L.kind === "below" ? L.omit : L.ids);
            tags.push(L.tag);
            plates += L.cells.length;
            for (const [i, j] of L.cells) keys.push(plateKey(this.frameId, L.tag, i, j));
        });
        const selCells = [].concat(...layers.filter((L) => L.kind === "sel").map((L) => L.cells));
        return { k, pq, pZq, layers, tags, keys, plates, r: rangeOf(layers[0].cells), selR: rangeOf(selCells), below };
    }

    /**
     * The levels whose plates overhang the camera's list: it reads one plate of the preview's
     * quantum past the view (P-1), and a level more octaves coarse reaches further, so packed from
     * it the plates held paper where ink is (REVIEWER-4 P-2). Each gets its own list over `coverOf`,
     * built at idle (`listPending` until then; `requests` leaves the level out meanwhile).
     */
    farLevels() {
        return [this.quick, this.main].filter((lvl) => lvl && lvl.list === undefined && !lvl.listPending && lvl.k * QUANTA_PER_OCTAVE > PREVIEW_QUANTA);
    }
    /** The rect, in frame units, a level's plates cover. */
    coverOf(lvl) {
        const r = lvl.r, u = PLATE_PX / lvl.pZq;
        return r ? { left: r.i0 * u, top: r.j0 * u, right: (r.i1 + 1) * u, bottom: (r.j1 + 1) * u } : null;
    }

    /** One store request per layer, the quick level's first (`want`'s fields plus what the pack needs); null when refused. */
    requests(list) {
        if (this.refused || !this.main || this.state === "land") return null;
        const out = [];
        for (const lvl of [this.quick, this.main]) {
            if (!lvl || lvl.listPending) continue;
            for (const L of lvl.layers) {
                const base = { frameId: this.frameId, Zq: lvl.pZq, q: L.tag, list: lvl.list || list, G: lvl.list ? lvl.G : null, offCam: true, prio: 2, mode: "plane", cells: L.cells };
                out.push(L.kind === "below" ? { ...base, omit: L.omit } : { ...base, only: L.ids, paper: [0, 0, 0, 0] });
            }
        }
        return out;
    }

    /** Is every plate of a level (its selected layers only, with `selOnly`) cached? */
    _whole(lvl, store, selOnly = false) {
        if (!lvl) return false;
        for (const L of lvl.layers) {
            if (selOnly && L.kind !== "sel") continue;
            for (const [i, j] of L.cells) { const e = store.get(plateKey(this.frameId, L.tag, i, j)); if (!e || e.dead) return false; }
        }
        return true;
    }

    /** Is the main level cached? */
    checkReady(store) {
        if (!this.ready && this._whole(this.main, store)) this.ready = true;
        return this.ready;
    }

    /**
     * The level to draw: the main one whole, else the quick one whole, else the selected layers of
     * whichever has them in (the ink also shows where it was: `partial`). Null when none has.
     */
    pick(store) {
        this.partial = false;
        if (this.checkReady(store)) return (this.cur = this.main);
        if (this._whole(this.quick, store)) return (this.cur = this.quick);
        for (const lvl of [this.main, this.quick]) if (this._whole(lvl, store, true)) { this.partial = true; return (this.cur = lvl); }
        this.cur = null;
        return null;
    }

    /** The drag moved: the pointer's displacement since the drag's start, in device px. */
    dragTo(dxCss, dyCss, dpr) {
        if (this.state !== "drag") planeStats.drags++;
        this.state = "drag";
        this.off[0] = Math.round(dxCss * dpr);
        this.off[1] = Math.round(dyCss * dpr);
    }

    /** The drop: stay up until the cells are fresh, or `MOVE_HOLD_MS`. */
    land(now) {
        if (this.state !== "drag") return false;
        this.state = "land";
        this.landAt = now;
        this.landUntil = now + MOVE_HOLD_MS;
        planeStats.lands++;
        return true;
    }

    /** The view cells a landing plane still covers: the drawn level's cells and the selection's destination, bounded, in `v`'s grid. */
    landCells(v) {
        const lvl = this.cur || this.main;
        const r = lvl && lvl.r, sr = lvl && lvl.selR;
        if (!r || !sr) return null;
        const f = v.Zq / lvl.pZq;                             // plane plate index → view plate index
        const ex = this.off[0] / (PLATE_PX * v.s), ey = this.off[1] / (PLATE_PX * v.s);   // the offset, in view plates
        const i0 = Math.min(Math.floor(r.i0 * f), Math.floor(sr.i0 * f + ex));
        const i1 = Math.max(Math.ceil((r.i1 + 1) * f) - 1, Math.ceil((sr.i1 + 1) * f + ex) - 1);
        const j0 = Math.min(Math.floor(r.j0 * f), Math.floor(sr.j0 * f + ey));
        const j1 = Math.max(Math.ceil((r.j1 + 1) * f) - 1, Math.ceil((sr.j1 + 1) * f + ey) - 1);
        return { i0: Math.max(i0, v.i0), i1: Math.min(i1, v.i1), j0: Math.max(j0, v.j0), j1: Math.min(j1, v.j1) };
    }
}
