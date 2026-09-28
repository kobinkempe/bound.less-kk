/**
 * placementModel.js — the document model as the Stage reads it (A1 §6's `PlacementModel`, plus
 * `frameFootprint`, PLAN §5.3): which natives a frame holds, where a native's picture is seen
 * from a frame, which natives are drawn away from their stored bits, and a frame's footprint.
 * The Stage reads membership and placement through this object and nothing else.
 *
 * The bodies are today's calls (`Document.at`, `LevelMap.objShift`/`residual`,
 * `TileStore._rerouteGroups`, a cell ± REACH); B-MODEL replaces them (A1 §4.4) and the Stage does
 * not change. Two facts a reader needs: `nativesIn` settles a pending frame shift and merges
 * shadows (A1 C1 makes it pure), and `displaced` can mint the frame a moved picture is read from
 * (`objShift`), exactly as `listFor` does.
 */
import { REACH, R, cellCentre } from "./frameLattice";
import { hasOffsets, residual } from "./geometry/offsets";
import { bboxOf } from "./geometry/derive";

const ZERO = Object.freeze([0, 0]);
const EVERYWHERE = Object.freeze({ left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
const NO_GROUPS = new Map();
const NONE = Object.freeze({ rev: "none", groups: NO_GROUPS, groupOf: () => undefined });

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
    const depth = (F) => lm.depthOf(F);
    const model = {
        /** The natives drawn live when the camera is in frame F, as stored. Today `doc.at(F)`. */
        nativesIn(F) { return doc.at(String(F)); },

        /**
         * Where native `o`'s picture is, seen from frame F: `F0` the frame whose unmoved tiles hold the
         * pieces drawn in F (`o`'s home: `o` itself, drawn live), `rem` the translation in F's units
         * the pieces are painted with and inputs are shifted back by. Null when `o` is not in the
         * document. `rerouted`: the pieces are read from F0's tiles over the window shifted back by
         * `rem` (today only at or below the home, `TileStore._rerouteGroups`; A1 C1 widens it).
         */
        placement(o, F) {
            const rec = o ? doc.getById(o.id) : null;
            if (!rec) return null;
            F = String(F);
            const home = rec.level, below = rec.obj.below;
            if (home === F) return { F0: F, rem: residual(below, 0) || ZERO, rerouted: false };
            if (!hasOffsets(below)) return { F0: F, rem: ZERO, rerouted: false };
            const d = model.displaced(F), gk = d.groupOf(o.id);
            if (gk !== undefined) { const g = d.groups.get(gk); return { F0: g.F0, rem: g.rem, rerouted: true }; }
            const hd = depth(home), D = depth(F);
            return { F0: F, rem: (hd != null && D != null && residual(below, D - hd)) || ZERO, rerouted: false };
        },

        /**
         * Every group of natives drawn away from their stored bits as seen from F, keyed by the
         * (F0, rem) they share; `groupOf(id)` a native's key. `rev` moves whenever a placement can
         * have changed. The groups are the memo's own: read them, never keep them.
         */
        displaced(F) {
            if (!doc.hasOffsets()) return NONE;
            const m = store._rerouteGroups(String(F));
            return { rev: m.key, groups: m.groups, groupOf: (id) => m.gk.get(id) };
        },

        /**
         * The rectangle every native under a frame lies in — its cell grown by REACH (invariant 2) —
         * as `{frame, rect}` in `frame`'s units: the parent's for a frame or an address
         * `{parent, i, j}`, the frame's own (everywhere) for a root. Null for an unknown frame.
         */
        frameFootprint(ref) {
            let parent, i, j;
            if (ref != null && typeof ref === "object") { parent = ref.parent; i = ref.i; j = ref.j; }
            else {
                const f = lm.frame(String(ref));
                if (!f) return null;
                if (f.parent == null || !f.cell) return { frame: f.id, rect: EVERYWHERE };
                parent = f.parent; i = f.cell.i; j = f.cell.j;
            }
            if (parent == null || !lm.frame(String(parent))) return null;
            const c = cellCentre(i, j), h = REACH / R;
            return { frame: String(parent), rect: { left: c.x - h, top: c.y - h, right: c.x + h, bottom: c.y + h } };
        },

        /** An input made in frame F — a point, a rect or loops — in native `o`'s stored coordinates. */
        toStored(o, F, x) {
            const rec = doc.getById(o.id);
            const home = rec ? rec.level : o._home;
            return mapObj(x, String(F), home, o.below, home, true);
        },

        /** Native `o`'s stored point, rect or loops as drawn in frame F. */
        fromStored(o, F, x) {
            const rec = doc.getById(o.id);
            const home = rec ? rec.level : o._home;
            return mapObj(x, home, String(F), o.below, home, false);
        },

        /**
         * A native's drawn rectangle at a given state — `{home, below, rect}`, `rect` in the home's
         * units — as seen from frame G: the footprint a change dirties (A2 §2.5), before or after.
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
