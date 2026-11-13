/**
 * placementModel.js — the document model as the Stage reads it (A1 §6's `PlacementModel`, plus
 * `frameFootprint`, PLAN §5.3): which natives a frame draws live, where a native's picture is seen
 * from a frame, which natives are drawn away from their stored bits, and a frame's footprint.
 * The Stage reads membership and placement through this object and nothing else.
 *
 * One composition (A1 C1): a native's picture table is its own table with its home frame's shift at
 * k = 0 (`Document.tableOf`); `LevelMap.objShift` turns it into the frame F0 its pieces are read from
 * and the remainder they are painted with, honouring a whole-frame carry at the home depth. The
 * grouping is `TileStore._rerouteGroups`' memo, so the Stage and the oracle's list read one answer. No read
 * settles, merges, mints or changes a table (PLAN §3 row 8): a picture's source frame is minted at the end
 * of the action that moved it or the camera (`TileStore.prepare`, A1 C3).
 */
import { REACH, R, cellCentre } from "./frameLattice";
import { hasOffsets, shiftAt } from "./geometry/offsets";
import { bboxOf, freezeTol } from "./geometry/derive";
import * as dm from "./depth";

const ZERO = Object.freeze([0, 0]);
/** A rect grown by `m` on every side. */
export const grown = (r, m) => (m ? { left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m } : r);
const EVERYWHERE = Object.freeze({ left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
const NO_GROUPS = new Map();
const NONE = Object.freeze({ rev: "none", groups: NO_GROUPS, groupOf: () => undefined, missing: 0 });

/**
 * A box united with its copy moved by `(sx, sy)`: where a shifted frame's own natives can be drawn (A1 C1: the
 * frame's shift is their placement; its kids are not shifted).
 */
export function withShifted(b, sx, sy) {
    return { left: b.left + Math.min(0, sx), top: b.top + Math.min(0, sy), right: b.right + Math.max(0, sx), bottom: b.bottom + Math.max(0, sy) };
}

/**
 * A frame's reach box in the active frame's units (`s`, `tx`, `ty` carry its coordinates there): its cell
 * ± REACH (invariant 2) with its shifted copy (`withShifted`).
 */
export function reachBox(f, s, tx, ty, pad = 0) {
    const sx = f && f.shift ? f.shift[0] * s : 0, sy = f && f.shift ? f.shift[1] * s : 0;
    return withShifted({ left: -REACH * s + tx - pad, top: -REACH * s + ty - pad, right: REACH * s + tx + pad, bottom: REACH * s + ty + pad }, sx, sy);
}

/** A native's drawn box in its home's units: its bbox, grown by half its pen for a stroke. */
export function drawnBox(o, live = null) {
    const b = bboxOf(o, live);
    const m = o.type === "fill" || o.type === "shape" ? 0 : (o.lwFrame || 0) / 2;
    return { left: b.x0 - m, top: b.y0 - m, right: b.x1 + m, bottom: b.y1 + m };
}

/**
 * @param {{doc: object, lm: object, store: object}} deps the engine's Document, LevelMap and TileStore
 */
export function createPlacementModel({ doc, lm, store }) {
    const groupsAt = (F) => (doc.hasOffsets() ? store._rerouteGroups(F) : null);
    const tol = freezeTol(lm.cfg || {});
    const SLACK = 2 * (tol > 0 ? tol : 1 / 2048);
    const model = {
        /**
         * How far a native's picture in frame F may sit from its stored geometry, in its home's units (OPEN-FLAGS F184,
         * F185). Below the home the picture is derived: each level re-solves a cut's corners by up to the level above's
         * tolerance (F173's cap), which sums to about one home-level tolerance however deep; doubled. Mapped twelve levels
         * that is ~1e40 units, where the stored box alone lands ~1e31 off. 0 at or above the home: the stored geometry.
         * A test that must not miss the picture grows the stored side by it where that costs no rendering (an erase's
         * candidates, `covers`); dirt takes the drawn pieces where it has them (`Stage._drawnSweep`) and this elsewhere.
         */
        slack(home, F) {
            const hd = home != null ? lm.depthOf(String(home)) : null, d = lm.depthOf(String(F));
            return hd != null && d != null && dm.gt(d, hd) ? SLACK : 0;
        },

        /** `slack` for native `o` seen from F. */
        slackOf(o, F) {
            const rec = o ? doc.getById(o.id) : null;
            return model.slack(rec ? rec.level : o && o._home, F);
        },

        /**
         * The natives drawn live when the camera is in frame F, as stored: those of F's cell (F and its
         * co-residents, A1 C3), less those whose picture carried out of it (their group reads another
         * frame), plus those of other frames whose picture carried into F (a group whose F0 is their home).
         */
        nativesIn(F) {
            F = String(F);
            const own = doc.cellList(F);
            const m = groupsAt(F);
            if (!m || !m.moved.size) return own;
            const out = own.filter((o) => !m.moved.has(o.id));
            for (const id of m.live) { const rec = doc.getById(id); if (rec) out.push(rec.obj); }
            return out;
        },

        /**
         * Where native `o`'s picture is, seen from frame F: `F0` the frame whose unmoved tiles hold
         * the pieces drawn in F (`o`'s home: `o` itself, drawn live), `rem` the translation in F's
         * units the pieces are painted with and inputs are shifted back by. Null when `o` is not in
         * the document. `rerouted`: the pieces are read from F0's tiles over the window shifted back
         * by `rem`.
         */
        placement(o, F) {
            const rec = o ? doc.getById(o.id) : null;
            if (!rec) return null;
            F = String(F);
            const home = rec.level;
            const m = groupsAt(F);
            const gk = m ? m.gk.get(o.id) : undefined;
            if (gk !== undefined) { const g = m.groups.get(gk); return { F0: g.F0, rem: g.rem, rerouted: g.F0 !== home }; }
            if (!lm.sameCell(home, F)) return { F0: F, rem: ZERO, rerouted: false };
            const T = doc.tableOf(rec.obj, home);
            if (!hasOffsets(T)) return { F0: home, rem: ZERO, rerouted: false };
            const r = shiftAt(T, 0).rem;
            return { F0: home, rem: r[0] || r[1] ? r : ZERO, rerouted: false };
        },

        /** The frame native `o` is homed in: its address in the document, never its picture's. */
        homeOf(o) { return o ? o._home : null; },

        /** Whether native `o` is drawn live in frame F (`nativesIn(F)` lists it). */
        drawnLive(o, F) {
            const rec = o ? doc.getById(o.id) : null;
            if (!rec) return false;
            const m = groupsAt(String(F));
            return m && m.moved.has(o.id) ? m.live.has(o.id) : lm.sameCell(rec.level, F);
        },

        /**
         * Every group of natives drawn away from their stored bits as seen from F, keyed by the
         * (F0, rem) they share; `groupOf(id)` a native's key. `rev` moves whenever a placement can
         * have changed. The groups are the memo's own: read them, never keep them. `missing`: how many
         * pictures' source frames the lattice lacks (a read mints none; `TileStore.prepare` does).
         */
        displaced(F) {
            const m = groupsAt(String(F));
            if (!m) return NONE;
            return { rev: m.key, groups: m.groups, groupOf: (id) => m.gk.get(id), missing: m.miss.size };
        },

        /** Native `o`'s picture table at `home` (its own with the home frame's shift), for a footprint state. */
        table(o, home) { return doc.tableOf(o, home); },

        /** The picture table an `offsetsOnly` change event's native had before it (its old own table, `oldBelow`). */
        tableBefore(ev) { return doc.tableOf({ below: ev.oldBelow }, ev.level); },

        /**
         * The rectangle every native under a frame lies in — its cell grown by REACH (invariant 2),
         * united with that box translated by the frame's shift, where the frame's own natives are drawn
         * (A1 C1; its kids are not shifted) — as `{frame, rect}` in `frame`'s units: the parent's for a
         * frame or an address `{parent, i, j, shift}`, the frame's own (everywhere) for a root. Null for
         * an unknown frame.
         */
        frameFootprint(ref) {
            let parent, i, j, shift, run;
            if (ref != null && typeof ref === "object") { parent = ref.parent; i = ref.i; j = ref.j; shift = ref.shift; run = ref.run; }
            else {
                const f = lm.frame(String(ref));
                if (!f) return null;
                if (f.parent == null || !f.cell) return { frame: f.id, rect: EVERYWHERE };
                parent = f.parent; i = f.cell.i; j = f.cell.j; shift = f.shift; run = f.run;
            }
            // Below a run, the parent is the run's top: the run's cell there holds the frame and everything under it.
            if (run) { i = run.i; j = run.j; shift = null; }
            if (parent == null || !lm.frame(String(parent))) return null;
            const c = cellCentre(i, j), h = REACH / R;
            const sx = shift ? shift[0] / R : 0, sy = shift ? shift[1] / R : 0;
            return { frame: String(parent), rect: withShifted({ left: c.x - h, top: c.y - h, right: c.x + h, bottom: c.y + h }, sx, sy) };
        },

        /** An input made in frame F — a point, a rect or loops — in native `o`'s stored coordinates. */
        toStored(o, F, x) {
            const rec = doc.getById(o.id);
            const home = rec ? rec.level : o._home;
            return mapObj(x, String(F), home, doc.tableOf(o, home), home, true);
        },

        /** Native `o`'s stored point, rect or loops as drawn in frame F. */
        fromStored(o, F, x) {
            const rec = doc.getById(o.id);
            const home = rec ? rec.level : o._home;
            return mapObj(x, home, String(F), doc.tableOf(o, home), home, false);
        },

        /**
         * A native's drawn rectangle at a given state — `{home, table, rect}`, `table` its picture table
         * then (`table`, `tableBefore`), `rect` in the home's units — as seen from frame G: the footprint a
         * change dirties (A2 §2.5), before or after; grown by `slack` below the home (F185).
         */
        footprint(state, G) {
            return lm.mapRectObj(grown(state.rect, model.slack(state.home, G)), state.home, String(G), state.table, state.home, false);
        },

        /**
         * `footprint` for many rects of one state (F153): `fn(left, top, right, bottom, out)` is its answer for that rect
         * grown by `grow` (the caller's slack: `footprint`'s, bit for bit), written into `out` (a new object without one);
         * null where it is null. Below the home a drop sweeps its drawn pieces where it can (`Stage._sweepMap`, F185).
         */
        footprintMapper(state, G, grow = 0) {
            const m = lm.mapperObj(state.home, String(G), state.table, state.home, false);
            if (!m) return null;
            const a = [0, 0], b = [0, 0];
            return (left, top, right, bottom, out = {}) => {
                if (grow) { left -= grow; top -= grow; right += grow; bottom += grow; }
                m(left, top, a); m(right, bottom, b);
                out.left = Math.min(a[0], b[0]); out.top = Math.min(a[1], b[1]); out.right = Math.max(a[0], b[0]); out.bottom = Math.max(a[1], b[1]);
                return out;
            };
        },
    };
    function mapObj(x, from, to, below, home, toHome) {
        if (Array.isArray(x)) {
            return typeof x[0] === "number" ? lm.mapPointObj(x, from, to, below, home, toHome) : lm.projectLoopsObj(x, from, to, below, home, toHome);
        }
        return lm.mapRectObj(x, from, to, below, home, toHome);
    }
    return model;
}

export { ZERO };
