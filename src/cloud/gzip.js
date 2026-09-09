/**
 * gzip.js — bytes in, compressed bytes out, for the cloud's kobin-2 chunks.
 *
 * The browser's own streaming compressor (`CompressionStream("gzip")`): off the page's
 * thread by construction, no dictionary limit, no library. Where it is missing the
 * chunks go up raw (codec "raw") rather than through lz-string, whose JS-object
 * dictionary fails on a 100 MB drawing (OPEN-FLAGS F64). Tests inject Node's zlib.
 */
/* global CompressionStream, DecompressionStream */
let codec = null;

async function pipe(u8, stream) {
    const rs = new Blob([u8]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(rs).arrayBuffer());
}

/** The codec in use: `{ name, gzip(u8) -> Promise<Uint8Array>, gunzip(u8) -> Promise<Uint8Array> }`. */
export function compression() {
    if (codec) return codec;
    if (typeof CompressionStream !== "undefined" && typeof Blob !== "undefined" && typeof Response !== "undefined") {
        codec = {
            name: "gz1",
            gzip: (u8) => pipe(u8, new CompressionStream("gzip")),
            gunzip: (u8) => pipe(u8, new DecompressionStream("gzip")),
        };
    } else {
        codec = { name: "raw", gzip: async (u8) => u8, gunzip: async (u8) => u8 };
    }
    return codec;
}
/** Tests (Node's zlib) and a future worker. `null` restores the default. */
export function setCompression(c) { codec = c; }
/** Decompress by the codec NAME a stored chunk was written with. */
export async function gunzipAs(name, u8) {
    if (name === "raw" || name == null) return u8;
    const c = compression();
    if (c.name !== name) throw new Error(`this drawing's chunks are ${name}-compressed and this browser cannot read them`);
    return c.gunzip(u8);
}
