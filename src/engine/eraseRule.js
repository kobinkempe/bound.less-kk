/**
 * eraseRule.js — which natives a pending eraser mark hides, as data on the objects (A2-scene.md
 * §4.1, PLAN §1.3). Pure: the pack, the bake, the barriers, the pick and the Stage's step
 * classification read it; nothing here writes a document.
 *
 *   `targets`   on a mark: the ids under it when its shape landed; never changed after.
 *   `targetOf`  on any native: the marks whose `targets` named it or an object it was cut from.
 *   `handledBy` on any native: the marks whose bake has dealt with it or with an object it was cut from.
 *
 * All three are ascending id arrays without duplicates, written to a header as they are.
 */

/** Paint order's key: creation order, inherited by every piece a cut mints. */
export const zOf = (o) => (o.z != null ? o.z : o.id);

/** Whether the ascending id array `a` (or nothing) holds `id`. */
export function has(a, id) {
    if (!a || !a.length) return false;
    let lo = 0, hi = a.length - 1;
    while (lo <= hi) {
        const m = (lo + hi) >> 1, v = a[m];
        if (v === id) return true;
        if (v < id) lo = m + 1; else hi = m - 1;
    }
    return false;
}

/** `a` with `id`, ascending: a new array, or `a` itself when it already holds it. */
export function withId(a, id) {
    if (!a || !a.length) return [id];
    if (has(a, id)) return a;
    const out = a.slice();
    let k = out.length;
    while (k > 0 && out[k - 1] > id) k--;
    out.splice(k, 0, id);
    return out;
}

/** `a` without `id`: a new array, or `a` itself when it does not hold it. */
export function withoutId(a, id) {
    return has(a, id) ? a.filter((x) => x !== id) : a;
}

/** Is native `o` under mark `M`'s mask, before any box test? A mark whose shape has not landed masks nothing. */
export function underMask(o, M) {
    if (M.targets === undefined || o.erase || !(zOf(o) < zOf(M))) return false;
    return has(o.targetOf, M.id) && !has(o.handledBy, M.id);
}

/**
 * Is `o` in mark `M`'s lineage below it — a target or a piece of one, masked or already handled?
 * An erase step by M on such an object changes pixels only where M's mask was (A2 §4.5).
 */
export function inLineage(o, M) {
    return M.targets !== undefined && !o.erase && zOf(o) < zOf(M) && has(o.targetOf, M.id);
}

/**
 * A piece minted from `src` by mark `by`'s bake (A2 §4.3): the source's lineage copied, `by` added
 * to what has handled it. `by` null (a cede outside a bake) copies both as they are.
 */
export function inheritErase(obj, src, by = null) {
    if (src.targetOf && src.targetOf.length) obj.targetOf = src.targetOf.slice();
    else delete obj.targetOf;
    const h = by != null ? withId(src.handledBy, by) : src.handledBy;
    if (h && h.length) obj.handledBy = h === src.handledBy ? h.slice() : h;
    else delete obj.handledBy;
    return obj;
}
