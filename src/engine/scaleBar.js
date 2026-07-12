/**
 * Façade for the ruling scale-bar engine.
 *
 * The implementation lives in ./scaleBar/ (catalog, membership, preference,
 * nice, resolve, pick, session, rungs, logMath, format, validate — see
 * scale-bar-ruling-implementation.md §B.2). This file only preserves the
 * historical import path `engine/scaleBar` for app modules (KobinEngine,
 * persist, CanvasEditor, ScaleUnitPicker).
 *
 * The legacy walk API (computeScale(zoom, def, minUnitRank, displayOpts),
 * previousHud bridging, near/far pins, minUnit locks, classifyUnitPick) is
 * GONE — replaced by the absolute resolver + ScaleSession + applyUnitPick
 * per locked decisions L1 / L2 / L12 and bible Q4.
 */

export * from "./scaleBar/index";
