/**
 * format2.js — the kobin-2 container (DESIGN.md §13; .claude/SAVE-FORMAT-PLAN.md).
 *
 * A drawing is stored as small JSON HEADERS plus ONE Float64Array of GEOMETRY per unit:
 * a frame snapshot holds every native of that frame, a log entry holds the objects one
 * edit removed and made. Each object header carries `g: [offset, length]`, its span in
 * the array. Inside a span (GEO_VERSION 1):
 *
 *   shape  := nLoops, ( len, loop )*       loop per arcShape.encodeLoopInto (codes 0..3)
 *   stroke := nPts, ( x, y )*
 *   fill   := nRings, ( len, ( x, y )* )*
 *
 * The numbers are the same bits kobin-1 JSON carries (a double survives both), so a
 * kobin-1 record and a kobin-2 span decode to identical objects; the tests hold both to
 * that. A decoded shape's `loops` are Float64Array VIEWS of the frame's array (no copy),
 * which `arcShape.decodeLoops` reads like arrays. A chunk is the same two parts as bytes
 * for the cloud: magic, kind, header length, header UTF-8, padding to 8, doubles.
 *
 * Pure: no engine, no storage, no DOM. Unknown header fields ride through decode and
 * encode (`_extra` on the object), so a field a newer build writes (z-order's, say) is
 * not lost by an older one.
 */
import { encodeLoopInto } from "./geometry/arcShape";
import { encodeBelow } from "./geometry/offsets";

export const FORMAT2 = "kobin-2";
export const GEO_VERSION = 1;

// ---- a growable double buffer ----
export class F64Builder {
    constructor(cap = 1024) { this.buf = new Float64Array(Math.max(16, cap)); this.n = 0; }
    get length() { return this.n; }
    _grow(need) {
        let cap = this.buf.length;
        while (cap < need) cap *= 2;
        const next = new Float64Array(cap);
        next.set(this.buf.subarray(0, this.n));
        this.buf = next;
    }
    push(...vs) {
        if (this.n + vs.length > this.buf.length) this._grow(this.n + vs.length);
        for (let i = 0; i < vs.length; i++) this.buf[this.n++] = vs[i];
    }
    /** The numbers so far, as a Float64Array of exactly that length (a copy). */
    slice() { return this.buf.slice(0, this.n); }
}

// ---- object headers ----
// The serialisable fields of a native, geometry aside: the whitelist kobin-1's
// `Document.serializeNatives` writes, in its order, so the two forms agree field for
// field. `geo` (kobin-1) puts the geometry right after `id`, where the JSON has it.
const KNOWN = new Set(["type", "origin", "id", "loops", "polys", "pts", "lwFrame", "color", "opacity",
    "covers", "w", "z", "editId", "attachRect", "tile", "below", "erase", "bakePx", "g",
    "windows", "srcId"]);   // the last two retired 2026-08-06, stripped on load
export function objectHeader(o, geo = null) {
    const h = { type: o.type, origin: o.origin, id: o.id };
    if (geo) Object.assign(h, geo);
    if (o.type === "stroke") h.lwFrame = o.lwFrame;
    h.color = o.color; h.opacity = o.opacity;
    if (o.type === "fill" && o.covers) h.covers = true;
    if (o.type === "shape" && o.w > 0) h.w = o.w;
    if (o.z != null && o.z !== o.id) h.z = o.z;
    if (o.editId != null) h.editId = o.editId;
    if (o.attachRect) h.attachRect = { ...o.attachRect };
    if (o.tile && (o.tile[0] || o.tile[1])) h.tile = [o.tile[0], o.tile[1]];
    const below = encodeBelow(o.below);
    if (below) h.below = below;
    if (o.erase) { h.erase = true; if (o.bakePx != null) h.bakePx = o.bakePx; }
    if (o._extra) for (const k of o._extra) if (o[k] !== undefined && !(k in h)) h[k] = o[k];
    return h;
}
/** Header field names a reader does not know, to keep on the object for the next write. */
export function extraFields(h) {
    const out = [];
    for (const k of Object.keys(h)) if (!KNOWN.has(k)) out.push(k);
    return out.length ? out : null;
}

// ---- geometry spans ----
/** Append one object's geometry to `b`; returns its span. */
export function pushGeometry(b, o) {
    const off = b.n;
    if (o.type === "shape") {
        b.push(o.loops.length);
        for (const loop of o.loops) {
            const at = b.n;
            b.push(0);
            encodeLoopInto(loop, b);
            b.buf[at] = b.n - at - 1;
        }
    } else if (o.type === "fill") {
        b.push(o.polys.length);
        for (const ring of o.polys) { b.push(ring.length * 2); for (const p of ring) b.push(p[0], p[1]); }
    } else {
        b.push(o.pts.length);
        for (const p of o.pts) b.push(p[0], p[1]);
    }
    return [off, b.n - off];
}
/** The geometry fields of a header's span: `{loops}` (views), `{polys}` or `{pts}`. Throws on a span that does not fit. */
export function readGeometry(h, geo) {
    if (!Array.isArray(h.g) || h.g.length !== 2) throw new Error(`bad object ${h.id}: no geometry span`);
    const [off, len] = h.g;
    const end = off + len;
    if (!(off >= 0 && len >= 0 && end <= geo.length)) throw new Error(`bad object ${h.id}: geometry span outside the frame`);
    let i = off;
    const count = () => { const n = geo[i++]; if (!(n >= 0 && Number.isInteger(n))) throw new Error(`bad object ${h.id}: geometry count`); return n; };
    if (h.type === "shape") {
        const n = count();
        const loops = [];
        for (let k = 0; k < n; k++) {
            const L = count();
            if (i + L > end) throw new Error(`bad object ${h.id}: loop past its span`);
            loops.push(geo.subarray(i, i + L)); i += L;
        }
        if (i !== end) throw new Error(`bad object ${h.id}: span length`);
        return { loops };
    }
    if (h.type === "fill") {
        const n = count();
        const polys = [];
        for (let k = 0; k < n; k++) {
            const L = count();
            if (i + L > end || L % 2) throw new Error(`bad object ${h.id}: ring past its span`);
            const ring = [];
            for (let j = 0; j < L; j += 2) ring.push([geo[i + j], geo[i + j + 1]]);
            i += L; polys.push(ring);
        }
        if (i !== end) throw new Error(`bad object ${h.id}: span length`);
        return { polys };
    }
    const n = count();
    if (i + 2 * n !== end) throw new Error(`bad object ${h.id}: span length`);
    const pts = [];
    for (let k = 0; k < n; k++) pts.push([geo[i + 2 * k], geo[i + 2 * k + 1]]);
    return { pts };
}
/** A header plus its span as the kobin-1 record shape (`loops` as views). */
export function recordOf(h, geo) {
    const { g, ...rest } = h;
    return Object.assign(rest, readGeometry(h, geo));
}

// ---- a frame ----
/** Live natives of one frame -> `{ objects: headers, geo }`. */
export function encodeObjects(objs) {
    const b = new F64Builder(Math.max(64, objs.length * 128));
    const objects = objs.map((o) => { const h = objectHeader(o); h.g = pushGeometry(b, o); return h; });
    return { objects, geo: b.slice() };
}
/** kobin-1 RECORDS (loops as flat arrays, from a file or the old store) -> the same frame form, without decoding a piece. */
export function encodeRecords(records) {
    const b = new F64Builder(Math.max(64, records.length * 128));
    const objects = records.map((rec) => {
        const { loops, pts, polys, ...h } = rec;
        const off = b.n;
        if (rec.type === "shape") { b.push(loops.length); for (const l of loops) { b.push(l.length); for (let i = 0; i < l.length; i++) b.push(l[i]); } }
        else if (rec.type === "fill") { b.push(polys.length); for (const ring of polys) { b.push(ring.length * 2); for (const p of ring) b.push(p[0], p[1]); } }
        else { b.push(pts.length); for (const p of pts) b.push(p[0], p[1]); }
        h.g = [off, b.n - off];
        return h;
    });
    return { objects, geo: b.slice() };
}
/** Back to kobin-1 records, geometry as views of `geo`. */
export function decodeObjects(objects, geo) {
    if (!Array.isArray(objects)) throw new Error("bad frame: objects must be an array");
    if (!(geo instanceof Float64Array)) throw new Error("bad frame: geometry must be a Float64Array");
    return objects.map((h) => recordOf(h, geo));
}

// ---- log entries ----
// An entry is an op with its RESULTS: the objects it removed and made, so replay never
// recomputes anything. Kinds: add/put/remove/mark carry `obj`; bake carries
// `removed.obj` and `pieces[].obj`; removeMany carries `records[].obj`; move carries
// each move's `base`/`after` geometry; undo/redo/rekey/attr/meta carry no geometry.
const geomSlot = (b, geom) => {
    if (!geom) return geom === undefined ? undefined : null;
    const type = geom.loops ? "shape" : geom.polys ? "fill" : "stroke";
    const out = { type, g: pushGeometry(b, { type, loops: geom.loops, polys: geom.polys, pts: geom.pts }) };
    if ("attachRect" in geom) out.attachRect = geom.attachRect ? { ...geom.attachRect } : null;
    if ("tile" in geom) out.tile = geom.tile ? [geom.tile[0], geom.tile[1]] : null;
    if ("below" in geom) out.below = encodeBelow(geom.below) || null;
    return out;
};
const readGeomSlot = (s, geo) => {
    if (!s) return s;
    const out = readGeometry(s, geo);
    if ("attachRect" in s) out.attachRect = s.attachRect;
    if ("tile" in s) out.tile = s.tile;
    if ("below" in s) out.below = s.below;
    return out;
};
export function encodeEntry(op) {
    const b = new F64Builder(256);
    const slot = (o) => { const h = objectHeader(o); h.g = pushGeometry(b, o); return h; };
    const out = { ...op };
    switch (op.k) {
        case "add": case "put": case "remove": case "mark":
            out.obj = slot(op.obj); break;
        case "bake":
            out.removed = { index: op.removed.index, obj: slot(op.removed.obj) };
            out.pieces = op.pieces.map((p) => slot(p.obj));
            break;
        case "removeMany":
            out.records = op.records.map((r) => ({ level: r.level, index: r.index, obj: slot(r.obj) }));
            break;
        case "move":
            // `obj` is the moved object as it now is, so a frame whose snapshot never
            // held it can still be given it on replay.
            out.moves = op.moves.map((m) => ({ ...m, obj: m.obj ? slot(m.obj) : null, base: geomSlot(b, m.base), after: geomSlot(b, m.after) }));
            break;
        default: break;
    }
    return { op: out, geo: b.slice() };
}
/** The entry with its objects as kobin-1 records (geometry as views of the entry's array). */
export function decodeEntry(entry) {
    const { op, geo } = entry;
    if (!op || typeof op.k !== "string") throw new Error("bad log entry: no kind");
    const out = { ...op };
    switch (op.k) {
        case "add": case "put": case "remove": case "mark":
            out.obj = recordOf(op.obj, geo); break;
        case "bake":
            out.removed = { index: op.removed.index, obj: recordOf(op.removed.obj, geo) };
            out.pieces = op.pieces.map((h) => recordOf(h, geo));
            break;
        case "removeMany":
            out.records = op.records.map((r) => ({ level: r.level, index: r.index, obj: recordOf(r.obj, geo) }));
            break;
        case "move":
            out.moves = op.moves.map((m) => ({ ...m, obj: m.obj ? recordOf(m.obj, geo) : null, base: readGeomSlot(m.base, geo), after: readGeomSlot(m.after, geo) }));
            break;
        default: break;
    }
    return out;
}

// ---- chunks: the two parts as bytes ----
// magic "KB2\0" | kind u8 | geo version u8 | 0 u16 | header length u32 LE | header UTF-8 |
// zero padding to a multiple of 8 | doubles, little-endian.
export const CHUNK_FRAME = 1;
export const CHUNK_LOG = 2;
const MAGIC = [0x4b, 0x42, 0x32, 0x00];
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
if (!LITTLE_ENDIAN) throw new Error("kobin-2 chunks need a little-endian platform");

export function packChunk(kind, header, geo) {
    const hj = utf8Encode(JSON.stringify(header));
    const headEnd = 12 + hj.length;
    const geoStart = headEnd + ((8 - (headEnd % 8)) % 8);
    const out = new Uint8Array(geoStart + geo.length * 8);
    out.set(MAGIC, 0);
    out[4] = kind; out[5] = GEO_VERSION;
    new DataView(out.buffer).setUint32(8, hj.length, true);
    out.set(hj, 12);
    new Uint8Array(out.buffer, geoStart, geo.length * 8).set(new Uint8Array(geo.buffer, geo.byteOffset, geo.length * 8));
    return out;
}
export function unpackChunk(u8) {
    if (!(u8 instanceof Uint8Array) || u8.length < 12) throw new Error("not a kobin-2 chunk: too short");
    for (let i = 0; i < 4; i++) if (u8[i] !== MAGIC[i]) throw new Error("not a kobin-2 chunk: bad magic");
    const kind = u8[4], geoVersion = u8[5];
    if (geoVersion > GEO_VERSION) throw new Error(`this chunk was written by a newer bound.less (geometry v${geoVersion}, app reads up to v${GEO_VERSION})`);
    const hl = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(8, true);
    const headEnd = 12 + hl;
    if (headEnd > u8.length) throw new Error("not a kobin-2 chunk: header runs past the end");
    const header = JSON.parse(utf8Decode(u8.subarray(12, headEnd)));
    const geoStart = headEnd + ((8 - (headEnd % 8)) % 8);
    const bytes = u8.length - geoStart;
    if (bytes < 0 || bytes % 8) throw new Error("not a kobin-2 chunk: geometry length");
    const n = bytes / 8;
    const abs = u8.byteOffset + geoStart;
    const geo = abs % 8 === 0
        ? new Float64Array(u8.buffer, abs, n)
        : new Float64Array(u8.buffer.slice(abs, abs + bytes));   // realign by copying
    return { kind, geoVersion, header, geo };
}

// ---- UTF-8, dependency-free (TextEncoder is not on every test global) ----
export function utf8Encode(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
            const d = str.charCodeAt(i + 1);
            if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
}
export function utf8Decode(u8) {
    let s = "";
    for (let i = 0; i < u8.length;) {
        const b = u8[i++];
        let c;
        if (b < 0x80) c = b;
        else if (b < 0xe0) c = ((b & 31) << 6) | (u8[i++] & 63);
        else if (b < 0xf0) c = ((b & 15) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63);
        else { c = ((b & 7) << 18) | ((u8[i++] & 63) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63); }
        if (c >= 0x10000) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
        else s += String.fromCharCode(c);
    }
    return s;
}
