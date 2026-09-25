/**
 * plate.js — the pixel grid the rasteriser writes into. A PLATE is a 512 device-pixel
 * square of the screen (RASTERISER-PLAN §3.2). A plate is measured in PIXELS; a frame
 * cell, an object's grid square and a cache square are measured in frame units, and
 * confusing two things both called a tile froze one arc to two different chords (F36),
 * which is why this one has a name of its own.
 *
 * No state, and it imports nothing.
 */

/** Device pixels on a side of one plate. */
export const PLATE_PX = 512;
/** Zoom steps per doubling: quarter-octave quanta (D10). */
export const QUANTA_PER_OCTAVE = 4;
/** WHOLE quantum steps of drift kept before re-quantising: 0.75 is a 13.9 % stretch. */
export const QUANTUM_HYSTERESIS = 0.75;
/**
 * The preview's quantum offset (PAPER-PLAN R2): two octaves coarser, 1/16 of the pixels, 2–6
 * plates a desktop screen, and the same plates the zoom-out reaches eight steps later.
 */
export const PREVIEW_QUANTA = 8;

/**
 * The quantised zoom in device pixels per frame unit. `prev` is the quantum in force, or
 * null; it is kept while the camera has drifted less than QUANTUM_HYSTERESIS steps from
 * it, so the quantum cannot flap across a boundary. A zoom that is zero or not finite
 * reads as quantum 0 rather than throwing on the render path.
 *
 * @param {number} inScale device-independent zoom (CSS px per frame unit)
 * @param {number} dpr devicePixelRatio; this is the one place it enters the geometry (D2)
 * @param {number} [prev] the quantum index in force, if any
 * @returns {{ q: number, Zq: number }}
 */
export function quantumFor(inScale, dpr, prev) {
    const Z = inScale * dpr;
    if (!(Z > 0) || !isFinite(Z)) return { q: 0, Zq: 1 };
    const t = Math.log2(Z) * QUANTA_PER_OCTAVE;
    let q = Math.round(t);
    if (prev != null && Math.abs(t - prev) <= QUANTUM_HYSTERESIS) q = prev;
    return { q, Zq: zqOf(q) };
}

/** Device pixels per frame unit at quantum index `q`. */
export function zqOf(q) {
    return Math.pow(2, q / QUANTA_PER_OCTAVE);
}

/** A plate's origin in device pixels: an exact integer, which is what makes a seam exact (§4.6). */
export const plateOriginPx = (i) => i * PLATE_PX;

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

/**
 * The plate cache key. `q` is the quantum index, or the string "e" for a settled exact
 * render (D24). `dpr` is deliberately NOT in it: a plate's pixels are a function of
 * (frame, q, i, j) alone, so a dpr change resizes the canvas and leaves every plate valid (D27).
 */
export const plateKey = (frameId, q, i, j) => frameId + "|" + q + "|" + i + "," + j;
