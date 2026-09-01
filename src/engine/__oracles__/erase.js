/**
 * erase.js — TEST-ONLY RESIDUE of the superseded "a cut is a recipe" model.
 *
 * NOT PRODUCTION. Nothing in `src/engine` imports this file; the only consumer is
 * `erase.contract.slow.test.js`, which uses the two helpers below as fixtures.
 * Delete it once that suite stops needing them.
 *
 * WHAT IT USED TO BE. An erase made below an object's home level could not be
 * baked into the object — Clipper's integer grid is fixed in the object's own
 * units, and a hole thousands of times finer than the object rounds away. So the
 * cut was stored as a RECIPE the object carried, and every tile bake re-ran it at
 * its own fidelity. `subtractCuts`, `cutRecord`, `narrowCut`, `cutsResolveIn`,
 * `splitByBoundary` and `removedFraction` were that machinery; they are deleted.
 *
 * WHAT REPLACED IT (F22, 2026-08-14). Both operands of an erase are resolved arc
 * perimeters now, so a cut is ONE exact boolean — `arcShape.subtractShape` — with
 * no polygonization, no flatten fidelity to choose and no lattice at any depth. An
 * erase below an object's home CEDES a tile instead: `Document.cedeTileById` cuts
 * the tile out of the parent exactly and hands its ink to the level below, one
 * crossing at a time (`KobinEngine._bakeRehome`). See OPEN-FLAGS X1.
 */
import { strokeLoops, loopsBbox } from "../geometry/curveOutline";

// A cut is only worth applying where it can be SEEN. Same gate the window
// machinery uses: resolvable means it would paint at least fadeLoPx across at
// the frame's deepest in-level zoom. Coarser than that and the ink around it is
// equally sub-pixel, so cut and uncut agree — which is exactly what makes
// zooming out across a crossing continuous with no re-baking (bible §2.3).
export function cutVisible(extent, cfg) {
    const lo = cfg.fadeLoPx != null ? cfg.fadeLoPx : 0.15;
    return extent * cfg.enter >= lo;
}

/**
 * The eraser gesture's painted footprint, as CURVE LOOPS in coordinates local to
 * its own centre — built once and thereafter only mapped and flattened.
 *
 * An eraser is a stroke, so it is polygonized by exactly the rule ink strokes
 * are (`strokeLoops`): above the fat gate the outline is CURVES, not points.
 * That is what lets the same cut be re-flattened at whatever fidelity the level
 * consuming it needs — smooth at any zoom, instead of exact at the one zoom it
 * happened to be cut at. A polygon frozen at the erase level grows visible
 * facets the moment you zoom past it; a cubic does not.
 *
 * Local coordinates are not a detail either: Clipper caps its integer scale by
 * the largest coordinate present, so building a 32-unit eraser's geometry at
 * frame coordinate 1e5 would quantize it to ~0.0025 units. Centred, it resolves
 * to ~1e-6.
 */
export function eraserFootprint(E, cfg) {
    if (E._clip) return E._clip;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of E.pts) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (!(x0 <= x1)) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const local = {
        type: "stroke", origin: E.origin, id: E.id, lwFrame: E.lwFrame,
        pts: E.pts.map(([x, y]) => [x - cx, y - cy]),
    };
    const loops = strokeLoops(local, cfg, { curved: E.origin === "native" });
    if (!loops.length) return null;
    const b = loopsBbox(loops);
    E._clip = {
        origin: [cx, cy], loops,
        // Extent of the footprint itself — what decides whether a level can
        // resolve this cut, and how big a neighbourhood the boolean needs.
        w: b.x1 - b.x0, h: b.y1 - b.y0,
    };
    return E._clip;
}
