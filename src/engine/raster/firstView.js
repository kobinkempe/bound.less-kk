/**
 * firstView.js — the first-view pictures (OPEN-FLAGS F166): a canvas's last view as level plates, packed
 * (`plateCodec.js`), saved beside its cloud copy so the next open restores them from the RAM tier instead of packing and
 * rastering them. A set holds the view's own cells, the far zoom-out levels nearest first, then the near levels and the
 * rest of the path, up to a byte cap. It stands for fresh plates only where it draws exactly what they would: the
 * document at the cloud head it was made at (the stamp, which the caller checks), the same build, and the same render
 * inputs (the print: the pixel ratio for the fade, the paper and the derivation's levers).
 */
import { RANK, levelCell } from "./PyramidStore";
import { levelKey } from "./level";

export const FIRST_VIEW_VERSION = 1;
/** A part's bytes at most: one Firestore document of the cloud copy's size (`canvasSync.js`, 700 KiB). */
export const PART_BYTES = 700 * 1024;
const MAGIC = 0x56464c42;   // "BLFV"
/** The words travel between machines: every browser this runs on is little-endian, and a set is refused elsewhere. */
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** The cfg a plate's pixels read beside the document (the derivation's and the fade's). */
const PRINT_CFG = ["enter", "base", "exit", "scale", "arcTolerancePx", "polygonizeWidthFrac", "cullPx", "fadeLoPx", "fatWidthPx", "lineTolPx"];
/** The classes a set keeps, in its order (`PyramidStore.rankOf`). */
const CLASS = new Map([[RANK.RING, 0], [RANK.FAR, 1], [RANK.NEAR, 2], [RANK.LEVELS, 3]]);

/** A level plate's key read back (`levelKey`): `{ F, l, S, i, j }`, or null. */
export function parseLevelKey(key) {
    const b2 = typeof key === "string" ? key.lastIndexOf("|") : -1, b1 = b2 > 0 ? key.lastIndexOf("|", b2 - 1) : -1;
    if (b1 <= 0) return null;
    const m = /^L(-?\d+)s(\d+)$/.exec(key.slice(b1 + 1, b2)), ij = /^(-?\d+),(-?\d+)$/.exec(key.slice(b2 + 1));
    if (!m || !ij) return null;
    const F = key.slice(0, b1), l = +m[1], S = +m[2], i = +ij[1], j = +ij[2];
    return levelKey(F, l, S, i, j) === key ? { F, l, S, i, j } : null;
}

/** The render inputs beside the document (`R` a RasterRenderer): the pixel ratio, the paper and the derivation's levers. */
export function renderPrint(R) {
    const c = R.cfg || {};
    return JSON.stringify({ v: FIRST_VIEW_VERSION, dpr: R.pyramid.dpr, paper: Array.from(R._paperRgb || []), cfg: PRINT_CFG.map((k) => (c[k] == null ? null : c[k])) });
}

/** A print's short name (FNV-1a), for the set's document id: a phone and a desktop each keep their own set. */
export function printTag(print) {
    let h = 0x811c9dc5;
    for (let k = 0; k < print.length; k++) { h ^= print.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; }
    return "p" + h.toString(16).padStart(8, "0");
}

/** A set's contents in a word, whatever its order: its keys and their sizes (a key's words are fixed for one document and one print). */
export function captureSig(cells) {
    const k = cells.map((c) => { const w = c.words || c.packed; return c.key + ":" + (w ? w.byteLength : 0); }).sort();
    return printTag(k.join(";"));
}

let buildOverride = null;
/** A suite's build id (a test has neither a dev server's hash nor a hashed chunk); null restores the page's. */
export function setBuildId(id) { buildOverride = id; }

/** This build: the dev server's hash, else the hashed main chunk's name; "" when neither is known (a set made then is never used). */
export function buildId() {
    if (buildOverride != null) return buildOverride;
    // eslint-disable-next-line no-undef
    if (typeof __webpack_hash__ !== "undefined") return String(__webpack_hash__);
    const scripts = typeof document !== "undefined" && document.scripts ? Array.from(document.scripts) : [];
    for (const s of scripts) { const m = /\/static\/js\/(main\.[0-9a-f]+\.[a-z.]*js)/.exec(s.src || ""); if (m) return m[1]; }
    return "";
}

/**
 * The set to save from `store` (its view as `setView` last set it): every exact level plate whose words are known — a
 * whole plate packed at its job, an empty one, a RAM-tier entry — the view's cells first, then the far levels and the
 * near ones nearest first, then the rest of the path, up to `maxBytes`. `{ cells: [{ key, words }], bytes }`, or null.
 */
export function captureFirstView(store, maxBytes) {
    const v = store.view;
    if (!LE || !v || !(maxBytes > 0)) return null;
    const shift = (f) => (v.path && v.path.get(f)) || 0;
    const all = [];
    const take = (c, words) => {
        const cls = CLASS.get(store.rankOf(c));
        if (cls == null || !ascii(c.key)) return;
        all.push({ cls, l: c.level - shift(c.frame), key: c.key, words });
    };
    for (const r of store.records()) {
        if (r.kind !== "level" || r.dead || r.patched || r.omitHeld) continue;
        if (!r.packed && (r.bitmap || r.pixels)) continue;           // a whole plate whose words were not kept
        take(r, r.packed || null);
    }
    for (const e of store.ram.entries()) if (!store.cache.has(e.key)) take({ ...e }, e.packed || null);
    all.sort((a, b) => (a.cls - b.cls) || (b.l - a.l));
    const cells = [];
    let bytes = 0;
    for (const c of all) {
        const b = costOf(c);
        if (b > PART_BYTES - 64) continue;                              // one plate past a part: never sent
        if (bytes + b > maxBytes) break;
        cells.push({ key: c.key, words: c.words });
        bytes += b;
    }
    return { cells, bytes };
}

/** `cells` (`captureFirstView`'s) as parts of at most `partBytes`: `[MAGIC, version, head bytes]`, the keys and word counts as JSON, then the words. */
export function encodeFirstView(cells, partBytes = PART_BYTES) {
    const parts = [];
    let cur = [], size = 0;
    for (const c of cells) {
        const b = costOf(c);
        if (cur.length && size + b > partBytes - 64) { parts.push(packPart(cur)); cur = []; size = 0; }
        cur.push(c); size += b;
    }
    if (cur.length) parts.push(packPart(cur));
    return parts;
}

/**
 * The cells of `parts` (`encodeFirstView`'s): `levelCell` descriptors with `packed` (null: an empty plate), in the set's
 * order. Null when any part does not read whole.
 */
export function decodeFirstView(parts) {
    if (!LE || !Array.isArray(parts)) return null;
    const out = [];
    for (const p of parts) {
        if (!p || !(p.byteLength >= 12) || p.byteLength % 4) return null;
        const u8 = new Uint8Array(p.byteLength);
        u8.set(p);
        const w = new Uint32Array(u8.buffer), hb = w[2];
        if (w[0] !== MAGIC || w[1] !== FIRST_VIEW_VERSION || 12 + hb > u8.length) return null;
        let head;
        try { head = JSON.parse(fromAscii(u8.subarray(12, 12 + hb))); } catch (err) { return null; }
        if (!head || !Array.isArray(head.k) || !Array.isArray(head.n) || head.k.length !== head.n.length) return null;
        let o = 3 + ((hb + 3) >> 2);
        for (let x = 0; x < head.k.length; x++) {
            const k = parseLevelKey(head.k[x]), n = head.n[x];
            if (!k || !Number.isInteger(n) || n < 0 || o + n > w.length) return null;
            out.push({ ...levelCell(k.F, k.l, k.S, k.i, k.j), packed: n ? u8.buffer.slice(o * 4, (o + n) * 4) : null });
            o += n;
        }
        if (o !== w.length) return null;
    }
    return out;
}

function costOf(c) { return (c.words ? c.words.byteLength : 0) + c.key.length + 16; }
function ascii(s) { for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) > 126) return false; return true; }
function fromAscii(u8) { let s = ""; for (let k = 0; k < u8.length; k += 8192) s += String.fromCharCode.apply(null, u8.subarray(k, k + 8192)); return s; }

function packPart(cells) {
    const json = JSON.stringify({ k: cells.map((c) => c.key), n: cells.map((c) => (c.words ? c.words.byteLength >> 2 : 0)) });
    const hw = (json.length + 3) >> 2;
    let words = 0;
    for (const c of cells) if (c.words) words += c.words.byteLength >> 2;
    const out = new Uint32Array(3 + hw + words), u8 = new Uint8Array(out.buffer);
    out[0] = MAGIC; out[1] = FIRST_VIEW_VERSION; out[2] = json.length;
    for (let k = 0; k < json.length; k++) u8[12 + k] = json.charCodeAt(k);
    let o = 3 + hw;
    for (const c of cells) if (c.words) { out.set(new Uint32Array(c.words), o); o += c.words.byteLength >> 2; }
    return u8;
}
