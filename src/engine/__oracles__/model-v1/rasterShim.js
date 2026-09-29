/**
 * rasterShim.js — the raster symbols the frozen `KobinEngine.js` imports, without the raster path
 * (B-PYRAMID-2 rewrites and deletes those modules). model-v1 runs the SVG path only: its two raster
 * classes refuse construction. `isPhoneBudget` and `EST_DEFAULTS` are copies as of 5e9b1dd.
 */
export { PREVIEW_QUANTA } from "../../raster/plate";

export const LADDER_DQ = 12;

export const EST_DEFAULTS = Object.freeze({
    restEdgeUs: 0.73, restPxNs: 34, restCellMs: 0.15, patchUnionUs: 73, patchMergeMs: 0.3,
    restInlineMs: 8, patchInlineMs: 6, restQuietMs: 100,
});

export const pictureStats = { composes: 0, layerRecomposes: 0, blits: 0, paperFills: 0, plateBlits: 0, arrivalComposes: 0 };

export function isPhoneBudget(env) {
    const nav = (env && "deviceMemory" in env) ? env : (typeof navigator !== "undefined" ? navigator : {});
    const scr = (env && env.screenW != null) ? { width: env.screenW, height: env.screenH || 0 }
        : (typeof window !== "undefined" && window.screen ? window.screen : null);
    if (nav && typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return true;
    if (scr && Math.max(scr.width || 0, scr.height || 0) < 1200) return true;
    return false;
}

export class RasterRenderer {
    constructor() { throw new Error("model-v1 oracle: the raster path is not frozen; construct it with raster: false"); }
}

export class PlateStore {
    constructor() { throw new Error("model-v1 oracle: the raster path is not frozen; construct it with raster: false"); }
}
