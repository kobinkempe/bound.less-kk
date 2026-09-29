/**
 * placementModel.js — the document model as the Stage reads it (A1 §6's `PlacementModel`, plus
 * `frameFootprint`, PLAN §5.3): which natives a frame draws live, where a native's picture is seen
 * from a frame, which natives are drawn away from their stored bits, and a frame's footprint.
 * The Stage reads membership and placement through this object and nothing else.
 *
 * One composition (A1 C1): a native's picture table is its own table with its home frame's shift at
 * k = 0 (`Document.tableOf`); `LevelMap.objShift` turns it into the frame F0 its pieces are read from
 * and the remainder they are painted with, honouring a whole-frame carry at the home depth. The
 * grouping is `TileStore._rerouteGroups`' memo, so the Stage and the list read one answer. No read
 * settles, merges or changes a table; `displaced` mints a frame its pieces are read from when the
 * lattice lacks it (`objShift`, A1 §1.2 row 19).
 */
import { REACH, R, cellCentre } from "./frameLattice";
import { hasOffsets, shiftAt } from "./geometry/offsets";
import { bboxOf } from "./geometry/derive";

const ZERO = Object.freeze([0, 0]);
const EVERYWHERE = Object.freeze({ left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
const NO_GROUPS = new Map();
const NONE = Object.freeze({ rev: "none", groups: NO_GROUPS, groupOf: () => undefined });

/**
 * A frame's reach box in the active frame's units (`s`, `tx`, `ty` carry its coordinates there):
 * its cell ± REACH (invariant 2) united with that box moved by the frame's shift, where its own
 * natives are drawn (A1 C1; its kids are not shifted).
 */
export function reachBox(f, s, tx, ty, pad = 0) {
    const sx = f && f.shift ? f.shift[0] * s : 0, sy = f && f.shift ? f.shift[1] * s : 0;
    return { left: -REACH * s + tx + Math.min(0, sx) - pad, top: -REACH * s + ty + Math.min(0, sy) - pad,
        right: REACH * s + tx + Math.max(0, sx) + pad, bottom: REACH * s + ty + Math.max(0, sy) + pad };
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
    const model = {
        /**
         * The natives drawn live when the camera is in frame F, as stored: F's own, less those whose
         * picture carried out of F (their group reads another frame), plus those of other frames
         * whose picture carried into F (a group whose F0 is their home).
         */
        nativesIn(F) {
            F = String(F);
            const own = doc.at(F);   // M1: the settle and the merge still run at this read; B-MODEL-C1 M2 makes it `list`
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
            if (home !== F) return { F0: F, rem: ZERO, rerouted: false };
            const T = doc.tableOf(rec.obj, home);
            if (!hasOffsets(T)) return { F0: F, rem: ZERO, rerouted: false };
            const r = shiftAt(T, 0).rem;
            return { F0: F, rem: r[0] || r[1] ? r : ZERO, rerouted: false };
        },

        /** Whether native `o` is drawn live in frame F (`nativesIn(F)` lists it). */
        drawnLive(o, F) {
            const rec = o ? doc.getById(o.id) : null;
            if (!rec) return false;
            const m = groupsAt(String(F));
            return m && m.moved.has(o.id) ? m.live.has(o.id) : rec.level === String(F);
        },

        /**
         * Every group of natives drawn away from their stored bits as seen from F, keyed by the
         * (F0, rem) they share; `groupOf(id)` a native's key. `rev` moves whenever a placement can
         * have changed. The groups are the memo's own: read them, never keep them.
         */
        displaced(F) {
            const m = groupsAt(String(F));
            if (!m) return NONE;
            return { rev: m.key, groups: m.groups, groupOf: (id) => m.gk.get(id) };
        },

        /** Native `o`'s picture table (its own with its home frame's shift), for a footprint state. */
        table(below, home) { return doc.tableOf({ below }, home); },

        /**
         * The rectangle every native under a frame lies in — its cell grown by REACH (invariant 2),
         * united with that box translated by the frame's shift, where the frame's own natives are drawn
         * (A1 C1; its kids are not shifted) — as `{frame, rect}` in `frame`'s units: the parent's for a
         * frame or an address `{parent, i, j, shift}`, the frame's own (everywhere) for a root. Null for
         * an unknown frame.
         */
        frameFootprint(ref) {
            let parent, i, j, shift;
            if (ref != null && typeof ref === "object") { parent = ref.parent; i = ref.i; j = ref.j; shift = ref.shift; }
            else {
                const f = lm.frame(String(ref));
                if (!f) return null;
                if (f.parent == null || !f.cell) return { frame: f.id, rect: EVERYWHERE };
                parent = f.parent; i = f.cell.i; j = f.cell.j; shift = f.shift;
            }
            if (parent == null || !lm.frame(String(parent))) return null;
            const c = cellCentre(i, j), h = REACH / R;
            const sx = shift ? shift[0] / R : 0, sy = shift ? shift[1] / R : 0;
            return { frame: String(parent), rect: {
                left: c.x - h + Math.min(0, sx), top: c.y - h + Math.min(0, sy), right: c.x + h + Math.max(0, sx), bottom: c.y + h + Math.max(0, sy),
            } };
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
         * A native's drawn rectangle at a given state — `{home, below, rect}`, `below` its picture table
         * then (`table`), `rect` in the home's units — as seen from frame G: the footprint a change
         * dirties (A2 §2.5), before or after.
         */
        footprint(state, G) {
            return lm.mapRectObj(state.rect, state.home, String(G), state.below, state.home, false);
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
