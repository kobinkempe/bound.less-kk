/**
 * plateRam.js — the plate store's second tier (OPEN-FLAGS F161, Kobin's tiered plate cache): level plates evicted from
 * the GPU tier, kept packed (`plateCodec.js`) in RAM, LRU by bytes under an entry cap, so a return to a place restores
 * them (a few ms off the main thread) instead of packing and rastering them again. An entry is the cell descriptor, the
 * G its pixels were packed at and its words (null: an empty plate). Whether an entry is still exact is the store's
 * question: its key stays tracked by the Stage while it is here (`PyramidStore._untrackIfIdle`).
 */

/** The most entries kept: every one is a tracked cell each commit's dirt is tested against. */
export const RAM_ENTRIES_MAX = 4096;
/** Bytes an entry costs beside its words (the descriptor and the map). */
export const RAM_ENTRY_BYTES = 192;

export default class PlateRam {
    /** @param {number} maxBytes 0: the tier is off @param {number} [maxEntries] */
    constructor(maxBytes = 0, maxEntries = RAM_ENTRIES_MAX) {
        this.maxBytes = Math.max(0, maxBytes || 0);
        this.maxEntries = maxEntries;
        this.map = new Map();         // key -> entry, oldest first
        this.bytes = 0;
        this.s = { puts: 0, empties: 0, takes: 0, stale: 0, evicted: 0, dropped: 0, largest: 0 };
    }

    get size() { return this.map.size; }
    has(key) { return this.map.has(key); }
    get(key) { return this.map.get(key); }
    /** Every entry, oldest first. */
    entries() { return this.map.values(); }

    /**
     * Keep entry `e` ({ key, frame, kind, level, S, Z, tag, i, j, G, packed }), newest. Returns the entries evicted to
     * make room — `e` itself when it alone is over the budget — so the caller can untrack their keys.
     */
    put(e) {
        if (!this.maxBytes) return [e];
        const old = this.map.get(e.key);
        if (old) { this.map.delete(e.key); this.bytes -= old.bytes; }
        e.bytes = (e.packed ? e.packed.byteLength : 0) + RAM_ENTRY_BYTES;
        this.map.set(e.key, e);
        this.bytes += e.bytes;
        this.s.puts++;
        if (!e.packed) this.s.empties++;
        if (e.bytes > this.s.largest) this.s.largest = e.bytes;
        return this._fit();
    }

    /** Take `key`'s entry out (a restore, a newer plate, a stale one): the entry, or undefined. */
    delete(key) {
        const e = this.map.get(key);
        if (!e) return undefined;
        this.map.delete(key);
        this.bytes -= e.bytes;
        return e;
    }

    /** Remove every entry `pred(e)` names that `spare(e)` does not (a hard drop: their frame means another place). */
    dropWhere(pred, spare = null) {
        const out = [];
        for (const e of [...this.map.values()]) {
            if ((spare && spare(e)) || !pred(e)) continue;
            this.delete(e.key);
            out.push(e);
        }
        this.s.dropped += out.length;
        return out;
    }

    /** A new byte budget (0: off): the entries evicted. */
    setBudget(bytes) { this.maxBytes = Math.max(0, bytes || 0); return this._fit(); }

    /** Every entry out: the entries. */
    clear() { const out = [...this.map.values()]; this.map.clear(); this.bytes = 0; return out; }

    report() {
        return { entries: this.map.size, bytes: this.bytes, maxBytes: this.maxBytes, maxEntries: this.maxEntries, ...this.s };
    }

    _fit() {
        const out = [];
        while (this.map.size && (this.bytes > this.maxBytes || this.map.size > this.maxEntries)) {
            const e = this.delete(this.map.keys().next().value);
            out.push(e);
            this.s.evicted++;
        }
        return out;
    }
}
