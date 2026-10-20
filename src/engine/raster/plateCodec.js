/**
 * plateCodec.js — one plate's RGBA packed losslessly for the store's RAM tier (OPEN-FLAGS F161): 32-bit words, a
 * run `[n·2 + 1, pixel]` for n ≥ 3 equal pixels, a stretch `[n·2, n pixels]` for the rest. The output is never longer
 * than the plate plus one word. Kobin's plates measured 82–117× smaller (median), 0.3–0.7 ms a scan
 * (`.claude/PERF-DEEP-2026-10-12/plate-cache.md`). Both ends read the pixels as `Uint32Array`s of one machine, so the
 * byte order needs no care.
 */
import { PLATE_PX } from "./plate";

/** Pixels in one plate. */
export const PLATE_PIXELS = PLATE_PX * PLATE_PX;

let scratch = null;   // the encoder's worst case, one per thread

/**
 * Pack one plate (`Uint8ClampedArray` of PLATE_PX² × 4, 4-byte aligned).
 * @returns {ArrayBuffer} the words, exactly as long as they are (transferable)
 */
export function encodePlate(rgba) {
    const px = new Uint32Array(rgba.buffer, rgba.byteOffset, PLATE_PIXELS);
    if (!scratch) scratch = new Uint32Array(PLATE_PIXELS + 2);
    const out = scratch, N = PLATE_PIXELS;
    let o = 0, i = 0, lit = -1;      // lit: the open stretch's header word, or -1
    while (i < N) {
        const v = px[i];
        let j = i + 1;
        while (j < N && px[j] === v) j++;
        if (j - i >= 3) {
            if (lit >= 0) { out[lit] = (o - lit - 1) * 2; lit = -1; }
            out[o++] = (j - i) * 2 + 1;
            out[o++] = v;
        } else {
            if (lit < 0) lit = o++;
            for (let k = i; k < j; k++) out[o++] = px[k];
        }
        i = j;
    }
    if (lit >= 0) out[lit] = (o - lit - 1) * 2;
    return out.slice(0, o).buffer;
}

/**
 * Unpack `buf` into `rgba` (a whole plate, 4-byte aligned). Throws when the words do not make exactly one plate:
 * a short or long plate would draw a wrong picture, not a slow one.
 * @returns {Uint8ClampedArray} `rgba`
 */
export function decodePlate(buf, rgba) {
    const w = new Uint32Array(buf), out = new Uint32Array(rgba.buffer, rgba.byteOffset, PLATE_PIXELS);
    let o = 0, k = 0;
    while (k < w.length) {
        const h = w[k++], n = h >>> 1;
        if (o + n > PLATE_PIXELS || (!(h & 1) && k + n > w.length) || ((h & 1) && k >= w.length)) break;
        if (h & 1) out.fill(w[k++], o, o + n);
        else { out.set(w.subarray(k, k + n), o); k += n; }
        o += n;
    }
    if (o !== PLATE_PIXELS || k !== w.length) throw new Error("plateCodec: the words make " + o + " of " + PLATE_PIXELS + " pixels");
    return rgba;
}
