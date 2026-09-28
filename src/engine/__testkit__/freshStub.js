/**
 * A freshness source for suites with no document (the four calls `PlateStore` makes of the Stage,
 * A2 §3.4): `dirty(pred)` is one commit whose footprint meets every tracked cell `pred` names (every
 * one when it is omitted), so a plate stored or in flight at an older G is no longer exact.
 */
export function freshStub() {
    const cells = new Map();
    const f = {
        generation: 0,
        stats: { tracked: 0 },
        cells,
        track(key, frameId, box) {
            if (!cells.has(key)) cells.set(key, { key, frame: String(frameId), box, dirty: 0 });
            f.stats.tracked = cells.size;
        },
        untrack(key) { cells.delete(key); f.stats.tracked = cells.size; },
        dirtySince(key) { const c = cells.get(key); return c ? c.dirty : 0; },
        /** @returns {number} cells dirtied */
        dirty(pred = null) {
            const G = ++f.generation;
            let n = 0;
            for (const c of cells.values()) if (!pred || pred(c)) { c.dirty = G; n++; }
            return n;
        },
    };
    return f;
}
