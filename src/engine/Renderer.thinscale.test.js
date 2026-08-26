/**
 * Thin-object coordinate rescale (F-Z).
 *
 * Chrome drops a filled path whose features are too small in the coordinates it
 * is handed, however much the transform then enlarges them — measured at
 * ~0.065 path units on the real geometry. The renderer's answer is a change of
 * units for that object alone: anchors x S, the object's own group transform
 * / S, S a power of two.
 *
 * These pin the three things that make it safe: the result is pixel-identical,
 * S never exceeds what Two.js can serialise, and ordinary objects are untouched.
 */
import Two from "two.js";
import Renderer from "./Renderer";

const CFG = { enter: 300, base: 0.1, exit: 0.05, bufferScreens: 1, scale: 1000,
    arcTolerancePx: 0.25, fatWidthPx: 4000, lineTolPx: 0.25, cullPx: 0.3, fadeLoPx: 0.15 };

const mkCam = () => ({
    inScale: 1, inPanX: 0, inPanY: 0, activeLevel: 0,
    frameWindow: () => ({ left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 }),
    levelPointToScreen: () => null,
});

const renderers = [];
const mkRenderer = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new Renderer(host, mkCam(), CFG, { width: 800, height: 600 });
    renderers.push(r);
    return r;
};
afterEach(() => { while (renderers.length) { const r = renderers.pop(); try { r.destroy(); } catch (e) {} } });

// A closed sliver `len` long and `w` wide, as a fill piece, starting at x0.
// `_sig` anchors a fill on its first and last vertex, so a variant meant to
// force a REBUILD has to move one of those — changing only `len` leaves both
// untouched and is (correctly) served from the cache.
const sliverAt = (id, x0, len, w) => ({
    type: "fill", origin: "derived", id, z: id, color: "#000", opacity: 1,
    polys: [[[x0, 0], [x0 + len, 0], [x0 + len, w], [x0, w]]],
});
const sliver = (id, len, w) => sliverAt(id, 0, len, w);

const groupOf = (r, id) => r._groups.get(id);

// Walk a group's anchors back through its own transform: what the browser
// actually paints, in the units the caller supplied.
const painted = (entry) => {
    const S = entry.group.scale;
    const out = [];
    for (const path of entry.group.children) {
        for (const a of path.vertices) out.push([a.x * S, a.y * S]);
    }
    return out;
};

describe("thin-object rescale", () => {
    test("an ordinary object is left completely alone", () => {
        const r = mkRenderer();
        r.render([sliver(1, 100, 40)]);
        const e = groupOf(r, 1);
        expect(e.thinScale).toBe(1);
        expect(e.group.scale).toBe(1);
    });

    test("a thin object is scaled up, by a power of two", () => {
        const r = mkRenderer();
        r.render([sliver(2, 20, 0.004)]);      // F-Z's order of magnitude
        const e = groupOf(r, 2);
        expect(e.thinScale).toBeGreaterThan(1);
        expect(Math.log2(e.thinScale) % 1).toBe(0);
        expect(e.group.scale).toBeCloseTo(1 / e.thinScale, 12);
    });

    test("the scale actually lifts the feature over the threshold", () => {
        const r = mkRenderer();
        const w = 0.004;
        r.render([sliver(3, 20, w)]);
        const e = groupOf(r, 3);
        // 0.065 is where Chrome starts dropping features; we target 0.25.
        expect(w * e.thinScale).toBeGreaterThan(0.065);
    });

    test("the painted result is unchanged — this is a change of UNITS", () => {
        const r = mkRenderer();
        r.render([sliver(4, 20, 0.004)]);
        const e = groupOf(r, 4);
        expect(e.thinScale).toBeGreaterThan(1);   // guard: the test is vacuous at S=1
        const pts = painted(e);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        expect(Math.min(...xs)).toBeCloseTo(0, 9);
        expect(Math.max(...xs)).toBeCloseTo(20, 9);
        expect(Math.min(...ys)).toBeCloseTo(0, 9);
        expect(Math.max(...ys)).toBeCloseTo(0.004, 9);
    });

    test("1/S stays exact through Two.js' six-decimal FLOORING serialiser", () => {
        // two.js:12902 writes a group's matrix via Matrix.toString, which maps
        // every element through Math.floor(v * 1e6) / 1e6. Any S whose inverse
        // needs a seventh decimal would be silently mis-serialised.
        const r = mkRenderer();
        r.render([sliver(5, 20, 1e-6)]);         // asks for as much scale as possible
        const e = groupOf(r, 5);
        const inv = 1 / e.thinScale;
        expect(Math.floor(inv * 1e6) / 1e6).toBe(inv);
        expect(e.thinScale).toBeLessThanOrEqual(64);
    });

    test("the coordinate ceiling caps the scale", () => {
        const r = mkRenderer();
        // thin AND enormous: scaling to the target would blow past 2^22
        r.render([sliver(6, 3e6, 0.004)]);
        const e = groupOf(r, 6);
        const maxCoord = Math.max(...painted(e).map((p) => Math.abs(p[0]))) * e.thinScale;
        expect(maxCoord).toBeLessThanOrEqual(4194304);
    });

    test("a rebuild recomputes rather than compounding the scale", () => {
        const r = mkRenderer();
        r.render([sliver(7, 20, 0.004)]);
        const first = groupOf(r, 7).thinScale;
        r.render([sliver(7, 20, 0.004)]);        // same sig -> cached, untouched
        expect(groupOf(r, 7).thinScale).toBe(first);
        r.render([sliverAt(7, 1, 20, 0.004)]);    // moved -> genuinely rebuilt
        const e = groupOf(r, 7);
        expect(e.thinScale).toBe(first);
        // 21, not 20*S or 21*S: the fresh anchors were scaled once, not twice
        expect(Math.max(...painted(e).map((p) => p[0]))).toBeCloseTo(21, 9);
        expect(Math.min(...painted(e).map((p) => p[0]))).toBeCloseTo(1, 9);
    });
});
