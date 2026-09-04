/*
 * bound.less — lz-string off the main thread.
 *
 * The cloud copy of a drawing is lz-string compressed before it goes to
 * Firestore. On the phone that compression was 97% of a 6.8 s freeze (F33),
 * and the 30 s background sync ran it on the main thread every time. This
 * worker does the same work where it cannot block a frame. Loaded by
 * src/cloud/lzWorker.js; lz-string.min.js beside it is lz-string 1.5.0 as
 * shipped by the npm package, vendored here because a worker cannot import
 * from the bundle.
 */
/* global LZString */
importScripts("lz-string.min.js");

self.onmessage = (e) => {
    const { id, op, data } = e.data || {};
    try {
        let out;
        if (op === "compress") out = LZString.compressToUint8Array(data);
        else if (op === "decompress") out = LZString.decompressFromUint8Array(data);
        else throw new Error("unknown op " + op);
        self.postMessage({ id, ok: true, out }, out instanceof Uint8Array ? [out.buffer] : []);
    } catch (err) {
        self.postMessage({ id, ok: false, err: String((err && err.message) || err) });
    }
};
