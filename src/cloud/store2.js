/**
 * store2.js — the kobin-2 store as cloud chunks, and back. Pure: no Firestore, no
 * engine (DESIGN.md §13; .claude/SAVE-FORMAT-PLAN.md).
 *
 * A frame snapshot is one chunk (`format2.packChunk`, kind FRAME: the header carries
 * the frame id, its seq and the object headers; the doubles follow). A run of log
 * entries is one chunk (kind LOG: the header lists the entries with a span each into
 * one concatenated array). A chunk is gzipped by `gzip.js` and split into parts of
 * at most PART_BYTES for Firestore's 1 MiB document cap. Nothing here is lossy: the
 * doubles that come back are the doubles that went in.
 */
import { packChunk, unpackChunk, CHUNK_FRAME, CHUNK_LOG } from "../engine/format2";

export const PART_BYTES = 700 * 1024;

export function packFrameChunk({ frameId, seq, objects, geo }) {
    return packChunk(CHUNK_FRAME, { frame: String(frameId), seq: seq || 0, objects }, geo);
}
export function unpackFrameChunk(u8) {
    const { kind, header, geo } = unpackChunk(u8);
    if (kind !== CHUNK_FRAME) throw new Error("not a frame chunk");
    return { frameId: header.frame, seq: header.seq || 0, objects: header.objects || [], geo };
}
/** Entries `[{ seq, t, op, geo, touches }]` as one chunk; the spans index one shared array. */
export function packLogChunk(entries) {
    let total = 0;
    for (const e of entries) total += e.geo ? e.geo.length : 0;
    const geo = new Float64Array(total);
    let off = 0;
    const list = entries.map((e) => {
        const n = e.geo ? e.geo.length : 0;
        if (n) geo.set(e.geo, off);
        const h = { seq: e.seq, t: e.t, op: e.op, touches: e.touches || [], g: [off, n] };
        off += n;
        return h;
    });
    return packChunk(CHUNK_LOG, { entries: list }, geo);
}
export function unpackLogChunk(u8) {
    const { kind, header, geo } = unpackChunk(u8);
    if (kind !== CHUNK_LOG) throw new Error("not a log chunk");
    return (header.entries || []).map((h) => {
        const [off, n] = h.g || [0, 0];
        if (off < 0 || off + n > geo.length) throw new Error(`bad log chunk: entry ${h.seq} outside its array`);
        return { seq: h.seq, t: h.t, op: h.op, touches: h.touches || [], geo: geo.subarray(off, off + n) };
    });
}
/** Bytes -> parts of at most `size` (always at least one). */
export function splitParts(u8, size = PART_BYTES) {
    const parts = [];
    for (let i = 0; i < u8.length; i += size) parts.push(u8.subarray(i, i + size));
    if (!parts.length) parts.push(new Uint8Array(0));
    return parts;
}
export function joinParts(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}
