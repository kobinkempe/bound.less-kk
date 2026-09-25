/**
 * A 2D context that composites for real, lazily, for jsdom (which has no canvas): it records the
 * last compose's fills and 1:1 blits of raw-pixel plates (un-premultiplied RGBA, as the raster
 * core writes them), with their rectangle clips, and `at(x, y)` replays them source-over for that
 * one pixel. A scaled blit is counted in `scaled` and not drawn: the tests stay at s = 1.
 *
 * NOT collected by jest (the directory is `__testkit__`). Used by the drag's z-order tests
 * (`raster/raster.move.test.js`) and the translucent-move tests.
 */
export function softCtx(w, h, platePx) {
    let clip = null, path = [], ops = [];
    const stack = [];
    const inClip = (c, x, y) => !c || c.some(([cx, cy, cw, ch]) => x >= cx && x < cx + cw && y >= cy && y < cy + ch);
    const rgb = (s) => (s[0] === "#" ? [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16)) : s.match(/\d+/g).map(Number));
    const ctx = {
        w, h, fillStyle: "#ffffff", imageSmoothingEnabled: false, scaled: 0,
        setTransform() {}, clearRect() {},
        save() { stack.push(clip); }, restore() { clip = stack.pop() || null; },
        beginPath() { path = []; }, rect(x, y, rw, rh) { path.push([x, y, rw, rh]); }, clip() { clip = path.slice(); },
        fillRect(x, y, rw, rh) {
            if (x <= 0 && y <= 0 && x + rw >= w && y + rh >= h && !clip) ops = [];   // a compose begins: the paper
            ops.push({ fill: rgb(ctx.fillStyle), r: [x, y, rw, rh], clip });
        },
        drawImage(bm, x, y, dw) {
            if (dw != null && dw !== platePx) { ctx.scaled++; return; }
            ops.push({ src: bm.pixels, x: Math.round(x), y: Math.round(y), clip });
        },
        /** The composed RGB at a device pixel, and how many layers painted it. */
        at(x, y) {
            x = Math.round(x); y = Math.round(y);
            const out = [0, 0, 0];
            for (const op of ops) {
                if (!inClip(op.clip, x, y)) continue;
                if (op.fill) {
                    const [rx, ry, rw, rh] = op.r;
                    if (x >= Math.round(rx) && x < Math.round(rx + rw) && y >= Math.round(ry) && y < Math.round(ry + rh)) out.splice(0, 3, ...op.fill);
                    continue;
                }
                const sx = x - op.x, sy = y - op.y;
                if (sx < 0 || sy < 0 || sx >= platePx || sy >= platePx) continue;
                const s = (sy * platePx + sx) * 4, a = op.src[s + 3] / 255;
                for (let c = 0; c < 3; c++) out[c] = op.src[s + c] * a + out[c] * (1 - a);
            }
            return out.map(Math.round);
        },
    };
    return ctx;
}

/** Flat colours composited source-over, in order, over `paper`: the picture z order and opacity define. */
export function over(paper, layers) {
    const out = paper.slice();
    for (const [rgb, a] of layers) for (let c = 0; c < 3; c++) out[c] = rgb[c] * a + out[c] * (1 - a);
    return out.map(Math.round);
}
