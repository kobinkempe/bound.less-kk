/**
 * plate.js — the pixel grid the rasteriser writes into. A PLATE is a 512 device-pixel
 * square of the screen (RASTERISER-PLAN §3.2). A plate is measured in PIXELS; a frame
 * cell, an object's grid square and a cache square are measured in frame units, and
 * confusing two things both called a tile froze one arc to two different chords (F36),
 * which is why this one has a name of its own. The pyramid's keys and levels are `level.js`'s.
 *
 * No state, and it imports nothing.
 */

/** Device pixels on a side of one plate. */
export const PLATE_PX = 512;

/**
 * The plates a viewport touches, inclusive. `win` is the viewport in frame units.
 * The grid is anchored at the frame origin and the pan offset is arbitrary, so a screen
 * W device px wide touches floor(W/512) + 1 or + 2 columns, not ceil(W/512) (§3.2).
 *
 * @param {{left:number, top:number, right:number, bottom:number}} win
 * @param {number} Zq device px per frame unit
 * @returns {{ i0: number, i1: number, j0: number, j1: number }}
 */
export function plateRange(win, Zq) {
    const s = Zq / PLATE_PX;
    return {
        i0: Math.floor(win.left * s),
        i1: Math.ceil(win.right * s) - 1,
        j0: Math.floor(win.top * s),
        j1: Math.ceil(win.bottom * s) - 1,
    };
}
