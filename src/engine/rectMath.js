/**
 * Rectangle tolerance at a lattice step, shared by the erase pipeline and the
 * overlays.
 *
 * "This point sits ON the window's edge" has to be judged at the step of the
 * lattice the rectangle lives on, never at float epsilon: at a parent's own
 * scale one step is ~1e-3 units, which is three whole units - hundreds of
 * screen pixels - down among its children.
 */
import { asRect } from "./geometry/connect";


// Clipper rounds every coordinate onto an integer lattice whose step is chosen
// from the largest magnitude in play (subtractPolys's capScale), so "this vertex
// sits ON the window's edge" has to be judged at that step and not at float
// epsilon: at the parent's own scale one lattice step is ~1e-3 units, which is
// three whole units — hundreds of screen pixels — down among its children.
export function latticeStep(rect) {
    const R = asRect(rect);
    const m = Math.max(Math.abs(R.x0), Math.abs(R.y0), Math.abs(R.x1), Math.abs(R.y1), 1);
    return Math.max(1 / 1000, m / 4.0e7);
}
export const rectTol = (r) => 2 * latticeStep(r);

export const rectSpan = (r) => { const R = asRect(r); return Math.max(R.x1 - R.x0, R.y1 - R.y0, 1e-12); };
