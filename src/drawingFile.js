/**
 * The drawing file's name (v1.0, Kobin 2026-11-13): `.svgi`. Files named `.boundless` or the older `.boundless.json`
 * open the same way: the loader reads the content (persist.decodeDrawing), never the name.
 */
export const DRAWING_EXT = ".svgi";
export const drawingFileName = (name) => (name || "untitled") + DRAWING_EXT;
