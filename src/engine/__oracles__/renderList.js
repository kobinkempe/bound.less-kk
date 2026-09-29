/**
 * renderList.js — the render list over a rect by brute force: every tile of the rect, both directions, read from
 * the tile store as it stands, the moved natives read back from where their picture is, and the frame's live
 * natives, stamped and sorted `(z ?? id, id)`. It is the SVG path's list as `KobinEngine.listFor` built it until
 * B-PYRAMID-3 (2026-09-29), when both renderers came to draw the Stage's items: the Stage's incremental table is
 * checked against it (PLAN §3 row 2, `stage.equiv`), and plates against a pack of it (`stage.cover`).
 *
 * An off-camera read: the camera's pins are put back by value and the eviction held until the end, so a read
 * never unpins or evicts the camera's tiles. It stamps what the old list did — `editId`, a pending mark's piece
 * as `erase` at the mark's z, the residual as `res` — onto the pieces it returns, which are the store's own.
 *
 * Test-only: production never imports `__oracles__`.
 */

/** The list for `rect` in frame `frameKey` (a frame id or a depth), or `[]` for an unreachable frame. */
export function renderList(E, frameKey, rect) {
    const store = E.store, lm = E.lm;
    const cf = lm.frameFor(frameKey);
    if (!cf) return [];
    const F = cf.id;
    const pins = new Set(store._pins), hold = store._holdEvict;
    store._holdEvict = true;
    let derived = [];
    try {
        const range = lm.tileRange(F, rect);
        for (let i = range.i0; i <= range.i1; i++) {
            for (let j = range.j0; j <= range.j1; j++) {
                for (const dir of ["up", "down"]) {
                    const tile = dir === "up" ? store._ensureUp(F, i, j) : store._ensureDown(F, i, j);
                    for (const o of tile.objs) derived.push(o);
                }
            }
        }
        if (E.doc.hasOffsets()) derived = reroute(store, lm, F, rect, derived);
    } finally {
        store._pins = pins; store._holdEvict = hold;
        store._evict();
    }
    const model = E.stage.model;
    const list = derived.concat(model.nativesIn(F));
    const hasOff = E.doc.hasOffsets(), resById = new Map();
    for (const o of list) {
        const rec = E.doc.getById(o.id);
        if (rec && rec.obj.editId != null) o.editId = rec.obj.editId;
        if (rec && rec.obj.erase && o !== rec.obj) { o.erase = true; if (rec.obj.z != null) o.z = rec.obj.z; }
        let res = null;
        if (hasOff && rec) {
            res = resById.get(o.id);
            if (res === undefined) { const pl = model.placement(rec.obj, F); res = pl && (pl.rem[0] || pl.rem[1]) ? pl.rem : null; resById.set(o.id, res); }
        }
        if (res) o.res = res; else if (o.res) delete o.res;
    }
    list.sort((a, b) => ((a.z != null ? a.z : a.id) - (b.z != null ? b.z : b.id)) || (a.id - b.id));
    return list;
}

/**
 * The tiles are in unmoved space; a moved native is read from where its picture is (F55, A1 C1): its pieces in
 * F's own tiles are dropped, and each reroute group's are read from the tiles of its frame F0 over the window
 * shifted back by the group's remainder.
 */
function reroute(store, lm, F, win, out) {
    const { moved, groups } = store._rerouteGroups(F);
    if (!moved.size) return out;
    const kept = out.filter((p) => !moved.has(p.id));
    for (const g of groups.values()) {
        const w = { left: win.left - g.rem[0], right: win.right - g.rem[0], top: win.top - g.rem[1], bottom: win.bottom - g.rem[1] };
        const range = lm.tileRange(g.F0, w);
        for (let i = range.i0; i <= range.i1; i++) {
            for (let j = range.j0; j <= range.j1; j++) {
                for (const dir of ["up", "down"]) {
                    const tile = dir === "up" ? store._ensureUp(g.F0, i, j) : store._ensureDown(g.F0, i, j);
                    for (const p of tile.objs) if (g.ids.has(p.id)) kept.push(p);
                }
            }
        }
    }
    return kept;
}
