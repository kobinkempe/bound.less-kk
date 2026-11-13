/**
 * cede.js — CEDE A TILE (bible §2.1): the one body behind `Document.cedeTileById` and the
 * descent's virtual document (R25 D4, PLAN §5.3). The parent's hole `holeInParent` is cut
 * exactly, in the parent's own coordinates (a round trip through a local origin moved every
 * vertex an ulp, F42); what was inside becomes kids at `level`; the remnants and the kids stay
 * in one edit family, sharing one tile grid (D4). The remnants keep the parent's own table; a
 * kid's, `kidBelow`, is the caller's: the parent's picture table from `level` down less the kid
 * frame's shift (F41, F55, A1 C1).
 *
 * `doc` is the receiver: `getById`, `removeById(id, opts)`, `add(obj, level, opts)`, `allocId`,
 * `editKey`, and `fillToShapeById` where a fill can be promoted. `by` is the mark whose bake this
 * is: every piece inherits the source's `targetOf`, and `handledBy` plus `by` (A2 §4.3). The
 * remnant's dust (F66, the mark's `dustBar`) goes whole, and its boxes, in the parent's stored
 * coordinates, ride the parent's removal (A2 §4.5).
 *
 * A hole cut that needs a seal returns `{ unresolved: stats }` and changes nothing: a rectangle cut from
 * a sound shape never does, so the shape disagrees with itself at a corner, and storing the seal's chords
 * would make them permanent diagonals (F173).
 */
import { subtractShape, rectLoop, shapeComponents, dropDust, onRectSides } from "./geometry/arcShape";
import { cloneBelow, ownTableOf } from "./geometry/offsets";
import { inheritErase } from "./eraseRule";
import { dustBoxes } from "./eraseJob";
import { powR } from "./frameLattice";

// `kidLevels`: how many levels below the parent's home the kids are homed; a kid's pen `w` is in its own units, the
// parent's times R per level (OPEN-FLAGS F84).
export function cede(doc, id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts, dustBar, by = null, kidLevels = 1) {
    const rec = doc.getById(id);
    if (!rec) return null;
    const src = rec.obj;
    if (src.type === "fill" && doc.fillToShapeById) doc.fillToShapeById(id);
    if (src.type !== "shape") return null;     // callers resolve strokes first
    const R = { left: holeInParent.x0, top: holeInParent.y0, right: holeInParent.x1, bottom: holeInParent.y1 };
    const cut = subtractShape(src.loops, rectLoop(R), { ...boolOpts, endsOnSides: true });   // a square ceded beside an earlier one
    if (cut.stats && cut.stats.openChains) return { unresolved: cut.stats };
    const groups = shapeComponents(cut.loops);
    const keep = dropDust(groups, src.w, dustBar);
    const dust = dustBoxes(groups, keep);
    const removed = doc.removeById(id, { by, dust });
    if (!removed) return null;
    const z = src.z != null ? src.z : src.id;
    const editKey = doc.editKey(src);
    const mk = (loops, lvl, attach, tile, below, w) => {
        const obj = {
            type: "shape", origin: src.origin, id: doc.allocId(), z, loops,
            color: src.color, opacity: src.opacity, editId: editKey, ...(below ? { below } : {}),
        };
        if (w > 0) obj.w = w;
        if (attach) obj.attachRect = { ...attach };
        if (tile) obj.tile = [tile[0], tile[1]];
        inheritErase(obj, src, by);
        return { obj: doc.add(obj, lvl, { by }), level: String(lvl) };
    };
    // The remnant's border lines become cut lines on the hole's exact sides, so the level below re-solves a corner
    // the hole cut against the side itself. A kid's border meets its ink at the chop's own vertices, which the chain
    // carries as they are, so its lines stay plain (F178).
    const parents = keep.map((loops) => mk(onRectSides(loops, holeInParent), removed.level, src.attachRect, src.tile, ownTableOf(src), src.w));
    const kidW = src.w > 0 ? src.w * powR(kidLevels) : 0;
    const kids = regions.map((r) => mk(r.loops || r, level, attachRect, kidTile, cloneBelow(kidBelow), kidW));
    return { removed, parents, kids, pieces: parents.concat(kids), dust };
}
