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
 */
import { subtractShape, rectLoop, shapeComponents, dropDust } from "./geometry/arcShape";
import { cloneBelow, ownTableOf } from "./geometry/offsets";
import { inheritErase } from "./eraseRule";
import { dustBoxes } from "./eraseJob";

export function cede(doc, id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts, dustBar, by = null) {
    const rec = doc.getById(id);
    if (!rec) return null;
    const src = rec.obj;
    if (src.type === "fill" && doc.fillToShapeById) doc.fillToShapeById(id);
    if (src.type !== "shape") return null;     // callers resolve strokes first
    const R = { left: holeInParent.x0, top: holeInParent.y0, right: holeInParent.x1, bottom: holeInParent.y1 };
    const groups = shapeComponents(subtractShape(src.loops, rectLoop(R), boolOpts).loops);
    const keep = dropDust(groups, src.w, dustBar);
    const dust = dustBoxes(groups, keep);
    const removed = doc.removeById(id, { by, dust });
    if (!removed) return null;
    const z = src.z != null ? src.z : src.id;
    const editKey = doc.editKey(src);
    const mk = (loops, lvl, attach, tile, below) => {
        const obj = {
            type: "shape", origin: src.origin, id: doc.allocId(), z, loops,
            color: src.color, opacity: src.opacity, editId: editKey, ...(below ? { below } : {}),
        };
        if (src.w > 0) obj.w = src.w;
        if (attach) obj.attachRect = { ...attach };
        if (tile) obj.tile = [tile[0], tile[1]];
        inheritErase(obj, src, by);
        return { obj: doc.add(obj, lvl, { by }), level: String(lvl) };
    };
    const parents = keep.map((loops) => mk(loops, removed.level, src.attachRect, src.tile, ownTableOf(src)));
    const kids = regions.map((r) => mk(r.loops || r, level, attachRect, kidTile, cloneBelow(kidBelow)));
    return { removed, parents, kids, pieces: parents.concat(kids), dust };
}
