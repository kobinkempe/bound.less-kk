/**
 * devLevers.js — the Dev panel's renderer levers (A3 §8; PLAN §1.2, §5.1 Q8): their ranges and per-device
 * defaults, the one validator, and their persistence — localStorage per device, with a URL override that
 * wins (`?levelStep=2&plateViews=3`, in the hash or the search), never the canvas record. The caller hands
 * in the URL and the storage, so nothing here reads the page.
 */
import { LEVEL_STEPS } from "./raster/level";

/** Each lever: its allowed values (or its integer range) and its default on a desktop and on a phone. */
export const LEVERS = Object.freeze({
    levelStep: { values: LEVEL_STEPS, desktop: 1, phone: 1 },
    plateViews: { min: 1, max: 8, desktop: 3, phone: 2 },
    plateCeilingMiB: { min: 64, max: 512, desktop: 256, phone: 96 },
    plateRamMiB: { min: 0, max: 512, desktop: 64, phone: 24 },   // the plate store's RAM tier (F161); 0 turns it off
    plateFarMiB: { min: 0, max: 512, desktop: 96, phone: 64 },   // the far zoom-out levels' own plate share (F166); 0 shares the one budget
    restQuietMs: { min: 0, max: 2000, desktop: 100, phone: 100 },
    restInline: { values: ["auto", "never"], desktop: "auto", phone: "auto" },
    netMs: { min: 0, max: 1000, desktop: 0, phone: 0 },          // the inline net over paper (F166): its budget, 0 off
    prefetchReadMs: { min: 0, max: 200, desktop: 30, phone: 16 }, // the far prefetch's tile reads a plan (F166; 8 before)
    tileRamMiB: { min: 0, max: 512, desktop: 48, phone: 24 },    // the tile store's RAM tier (F166); 0 turns it off
    firstViewKiB: { min: 0, max: 8192, desktop: 2048, phone: 2048 }, // the first-view pictures saved with the cloud copy (F166); 0 turns them off
    holdMs: { min: 0, max: 5000, desktop: 1000, phone: 1000 },   // a moved view waits this long for its plates before paper (Kobin 2026-10-29); 0 paints paper at once
    compose: { values: ["auto", "direct", "surface"], desktop: "auto", phone: "auto" },
});
/** The localStorage key this device's levers live under. */
export const LEVERS_KEY = "bl.devLevers";

/** The levers' defaults for a desktop, or a phone (`PyramidStore.isPhoneBudget`). */
export function leverDefaults(phone = false) {
    const out = {};
    for (const [name, L] of Object.entries(LEVERS)) out[name] = phone ? L.phone : L.desktop;
    return out;
}

/** The valid levers in `o`, parsed (a URL's strings become numbers where the lever is numeric); anything else is dropped. */
export function cleanLevers(o) {
    const out = {};
    if (!o || typeof o !== "object") return out;
    for (const [name, L] of Object.entries(LEVERS)) {
        if (!(name in o) || o[name] == null) continue;
        let v = o[name];
        if (L.values) {
            if (typeof L.values[0] === "number") v = Number(v);
            if (L.values.includes(v)) out[name] = v;
        } else {
            v = Number(v);
            if (Number.isInteger(v) && v >= L.min && v <= L.max) out[name] = v;
        }
    }
    return out;
}

/**
 * The levers a URL names: `[?&]name=value` wherever its query lives (a hash route keeps it in the hash). A value
 * that does not decode (`%` alone) is dropped: this runs while the page builds its engine, where a throw is a blank page.
 */
export function leversFromUrl(href) {
    const s = String(href || ""), out = {};
    for (const name of Object.keys(LEVERS)) {
        const m = new RegExp("[?&]" + name + "=([^&#]*)").exec(s);
        if (!m) continue;
        try { out[name] = decodeURIComponent(m[1]); } catch (err) { /* URIError: not a value */ }
    }
    return cleanLevers(out);
}

/** What this device stored, or {} when there is nothing, it does not parse, or the storage refuses (a private window). */
export function storedLevers(storage) {
    try {
        const raw = storage && storage.getItem(LEVERS_KEY);
        return raw ? cleanLevers(JSON.parse(raw)) : {};
    } catch (err) {
        return {};
    }
}

/** The session's lever overrides: this device's stored ones, then the URL's, which win. Defaults are the engine's. */
export function readLevers({ href = "", storage = null } = {}) {
    return { ...storedLevers(storage), ...leversFromUrl(href) };
}

/** Store `patch` over this device's levers; false when the storage refuses. The canvas record is never touched. */
export function saveLevers(patch, storage) {
    try {
        if (!storage) return false;
        storage.setItem(LEVERS_KEY, JSON.stringify({ ...storedLevers(storage), ...cleanLevers(patch) }));
        return true;
    } catch (err) {
        return false;
    }
}
