/**
 * synth-drawing.js — the dense synthetic drawing of A3 §9.3, deterministic from a seed: a `dev-0` snapshot
 * (`files.js` `loadSnapshot`) for the browser harness's `--dense` runs. Records are `format2.objectHeader`'s
 * shapes: strokes `{type, origin, id, pts, lwFrame, color, opacity}`, fills `{… polys}`, a pending eraser
 * `{… erase: true, bakePx}`. Frame ids are minted by `LevelMap.ensureId` at load: "0", "1", "2" are the
 * spine; "1/1,0" and "1/-1,1" are off-spine children of "1" (two levels down, beside "2").
 *
 *   const { synth } = require("./synth-drawing");  synth({ seed: 1, w: 1280, h: 800 })
 *
 * Content lies around each frame's origin, a few screens wide at inScale 1, so the camera the harness
 * puts at a frame's origin sees it dense; the backdrop covers depth 0's whole cell.
 */

/** A 31-bit LCG (the rasteriser suites' generator), so a seed is the same drawing on every machine. */
function lcg(seed) {
    let s = (seed >>> 0) & 0x7fffffff;
    return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const HALF_W = 65536;                                    // frameLattice.HALF_W: a frame's own half-width
const INKS = ["#2b2620", "#8a3324", "#a06b2c", "#3d5a45", "#33506e", "#6e4a72", "#1f1a17", "#5a4632"];
const HIGHLIGHTS = ["rgb(250,214,60)", "rgb(120,200,255)", "rgb(255,140,180)", "rgb(140,230,120)"];

/**
 * @param {object} [o]
 * @param {number} [o.seed=1]
 * @param {number} [o.w=1280] @param {number} [o.h=800] the camera's CSS size, for the resting camera
 * @returns {{ v: "dev-0", camera: object, natives: object, crossings: object, stats: object }}
 */
function synth({ seed = 1, w = 1280, h = 800 } = {}) {
    const rnd = lcg(seed);
    const rr = (a, b) => a + rnd() * (b - a);
    const ri = (a, b) => Math.floor(rr(a, b + 1));
    const pick = (arr) => arr[ri(0, arr.length - 1)];
    let id = 1;
    const natives = {};
    const put = (frame, rec) => { (natives[frame] || (natives[frame] = [])).push(rec); return rec; };
    const round = (v) => Math.round(v * 1000) / 1000;

    /** A random walk of 8–60 samples, 2–40 units wide; one in ten a highlighter (×2.5 wide, opacity ≤ 0.45). */
    function stroke(frame, cx, cy) {
        const n = ri(8, 60), pts = [];
        let x = cx, y = cy, a = rr(0, Math.PI * 2);
        for (let k = 0; k < n; k++) {
            pts.push([round(x), round(y)]);
            a += rr(-0.6, 0.6);
            const step = rr(4, 22);
            x += Math.cos(a) * step; y += Math.sin(a) * step;
        }
        const hl = rnd() < 0.1;
        const lw = rr(2, 40) * (hl ? 2.5 : 1);
        return put(frame, { type: "stroke", origin: "native", id: id++, pts, lwFrame: round(lw),
            color: hl ? pick(HIGHLIGHTS) : pick(INKS), opacity: hl ? round(rr(0.35, 0.45)) : 1 });
    }
    /** A blob of 5–16 vertices, 5–400 units across; one in ten translucent (0.35–0.6). */
    function fill(frame, cx, cy) {
        const n = ri(5, 16), R = rr(5, 400) / 2, ring = [];
        for (let k = 0; k < n; k++) {
            const t = (k / n) * Math.PI * 2 + rr(-0.15, 0.15), r = R * rr(0.55, 1);
            ring.push([round(cx + r * Math.cos(t)), round(cy + r * Math.sin(t))]);
        }
        const tr = rnd() < 0.1;
        return put(frame, { type: "fill", origin: "native", id: id++, polys: [ring],
            color: tr ? pick(HIGHLIGHTS) : pick(INKS), opacity: tr ? round(rr(0.35, 0.6)) : 1 });
    }
    const around = (sx, sy) => [rr(-sx, sx), rr(-sy, sy)];

    // Depth 0: the backdrop over the whole cell, then 1,500 strokes and 300 fills over ±1,600 × ±1,000.
    put("0", { type: "fill", origin: "native", id: id++, color: "rgb(236,233,226)", opacity: 1,
        polys: [[[-HALF_W, -HALF_W], [HALF_W, -HALF_W], [HALF_W, HALF_W], [-HALF_W, HALF_W]]] });
    for (let k = 0; k < 1500; k++) stroke("0", ...around(1600, 1000));
    for (let k = 0; k < 300; k++) fill("0", ...around(1600, 1000));
    // Depth 1: 800 strokes and 200 fills near the spine child's own origin.
    for (let k = 0; k < 800; k++) stroke("1", ...around(1600, 1000));
    for (let k = 0; k < 200; k++) fill("1", ...around(1600, 1000));
    // Two off-spine children of "1", 100 strokes each; and depth 2's spine frame, 400.
    for (const f of ["1/1,0", "1/-1,1"]) for (let k = 0; k < 100; k++) stroke(f, ...around(1200, 800));
    for (let k = 0; k < 400; k++) stroke("2", ...around(1600, 1000));

    // A stack under a pending mark at depth 0 around (−300, 200): twelve overlapping fills and strokes,
    // then an eraser 40 units wide across them, drawn at inScale 1 and left for its bake to resume on load.
    const stack = [];
    for (let k = 0; k < 12; k++) stack.push((k % 2 ? stroke : fill)("0", -300 + rr(-60, 60), 200 + rr(-40, 40)).id);
    const eraser = put("0", { type: "stroke", origin: "native", id: id++, color: "#ffffff", opacity: 1, erase: true, bakePx: 1,
        lwFrame: 40, pts: [[-420, 150], [-360, 185], [-300, 205], [-240, 220], [-180, 250]] });

    const count = (f) => (natives[f] || []).length;
    return {
        v: "dev-0",
        camera: { frame: "0", activeLevel: 0, inScale: 1, inPanX: w / 2, inPanY: h / 2 },
        natives,
        crossings: {},
        stats: { objects: id - 1, frames: Object.fromEntries(Object.keys(natives).map((f) => [f, count(f)])), stack, eraser: eraser.id },
    };
}

module.exports = { synth, lcg };
