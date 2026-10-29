/**
 * plateCodec.test.js — the RAM tier's packing (F161) is lossless on every kind of plate, never longer than the plate
 * plus a word, and refuses words that do not make one plate.
 */
import { encodePlate, decodePlate, PLATE_PIXELS } from "./plateCodec";
import { lcg } from "../__testkit__/rasterLists";

const plate = () => new Uint8ClampedArray(PLATE_PIXELS * 4);
const roundTrip = (px) => decodePlate(encodePlate(px), plate());

/** Paper with anti-aliased strokes: long runs broken by short stretches of mixed pixels, as a real plate is. */
function strokes(seed) {
    const r = lcg(seed), px = plate(), u = new Uint32Array(px.buffer);
    u.fill(0xffffffff);
    for (let s = 0; s < 40; s++) {
        const y = Math.floor(r() * 512), x0 = Math.floor(r() * 400), n = 20 + Math.floor(r() * 100), c = 0xff000000 | Math.floor(r() * 0xffffff);
        for (let x = x0; x < Math.min(512, x0 + n); x++) {
            u[y * 512 + x] = c;
            if (y + 1 < 512) u[(y + 1) * 512 + x] = 0xff000000 | Math.floor(r() * 0xffffff);   // the edge's mixed pixels
        }
    }
    return px;
}

describe("plateCodec (F161)", () => {
    test("a uniform plate, an empty one, anti-aliased strokes and noise all come back bit for bit", () => {
        const one = plate(); new Uint32Array(one.buffer).fill(0xff336699);
        const noise = plate(); const r = lcg(7); for (let k = 0; k < noise.length; k++) noise[k] = Math.floor(r() * 256);
        for (const px of [one, plate(), strokes(1), strokes(2), noise]) expect(roundTrip(px)).toEqual(px);
    });

    test("a run is two words, a stretch a word more than its pixels: never longer than the plate and a word", () => {
        const one = plate(); new Uint32Array(one.buffer).fill(0xff336699);
        expect(encodePlate(one).byteLength).toBe(8);                         // one run of 262,144
        const noise = plate(); const r = lcg(3); for (let k = 0; k < noise.length; k++) noise[k] = Math.floor(r() * 256);
        expect(encodePlate(noise).byteLength).toBe((PLATE_PIXELS + 1) * 4);  // one stretch
        // Runs of 2 alternating with single pixels: the worst a stretch-and-run mix can do is still a stretch.
        const alt = plate(), u = new Uint32Array(alt.buffer);
        for (let k = 0; k < PLATE_PIXELS; k++) u[k] = k % 3 === 2 ? 7 : 5;
        expect(encodePlate(alt).byteLength).toBeLessThanOrEqual((PLATE_PIXELS + 1) * 4);
        expect(roundTrip(alt)).toEqual(alt);
        const s = encodePlate(strokes(4)).byteLength;
        expect(s).toBeLessThan(PLATE_PIXELS * 4 / 20);                       // a drawing's plate packs small
    });

    test("words that do not make exactly one plate throw instead of drawing a wrong picture", () => {
        const w = new Uint32Array(encodePlate(strokes(5)));
        expect(() => decodePlate(w.slice(0, w.length - 1).buffer, plate())).toThrow(/plateCodec/);
        const long = new Uint32Array(w.length + 2); long.set(w); long[w.length] = 3; long[w.length + 1] = 9;
        expect(() => decodePlate(long.buffer, plate())).toThrow(/plateCodec/);
        expect(() => decodePlate(new Uint32Array([PLATE_PIXELS * 2 + 3, 1]).buffer, plate())).toThrow(/plateCodec/);
    });
});
