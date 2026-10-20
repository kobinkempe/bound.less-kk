/**
 * A 2D context that composites for real, lazily, for jsdom (which has no canvas): it records the
 * last compose's fills and 1:1 blits of raw-pixel plates (un-premultiplied RGBA, as the raster
 * core writes them), with their rectangle clips (a clip inside a clip is their intersection, as on a canvas), and
 * `at(x, y)` replays them source-over for that one pixel. A scaled blit is counted in `scaled` and not drawn: the tests stay at s = 1 — unless
 * `opts.scaled`, where the 5- and 9-argument `drawImage` are drawn by nearest sampling of the source
 * rectangle at each pixel's centre (the pyramid's plan tests). A `softCanvas` drawn as an image is sampled the same way,
 * through its own context's ops with their alpha — with `opts.bilinear`, bilinearly between texel centres, clamped at
 * its edges, as Chrome magnifies an image (a seam where a magnified surface meets its transparent texels shows);
 * `clearRect` makes its rectangle transparent.
 *
 * NOT collected by jest (the directory is `__testkit__`). Used by the drag's z-order tests
 * (`raster/raster.move.test.js`), the translucent-move tests and `PicturePyramid.plan.test.js`.
 */
export function softCtx(w, h, platePx, opts = {}) {
    let clip = null, path = [], ops = [];
    const stack = [];
    const inClip = (c, x, y) => !c || c.some(([cx, cy, cw, ch]) => x >= cx && x < cx + cw && y >= cy && y < cy + ch);
    const rgb = (s) => (s[0] === "#" ? [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16)) : s.match(/\d+/g).map(Number));
    const ctx = {
        w, h, fillStyle: "#ffffff", imageSmoothingEnabled: false, scaled: 0,
        setTransform() {},
        clearRect(x, y, rw, rh) {
            if (x <= 0 && y <= 0 && x + rw >= w && y + rh >= h && !clip) ops = [];
            else ops.push({ clear: [x, y, rw, rh], clip });
        },
        save() { stack.push(clip); }, restore() { clip = stack.pop() || null; },
        beginPath() { path = []; }, rect(x, y, rw, rh) { path.push([x, y, rw, rh]); },
        clip() {
            const meet = ([ax, ay, aw, ah], [bx, by, bw, bh]) => {
                const x = Math.max(ax, bx), y = Math.max(ay, by), w = Math.min(ax + aw, bx + bw) - x, h = Math.min(ay + ah, by + bh) - y;
                return w > 0 && h > 0 ? [x, y, w, h] : null;
            };
            clip = clip ? clip.flatMap((a) => path.map((b) => meet(a, b)).filter(Boolean)) : path.slice();
        },
        fillRect(x, y, rw, rh) {
            if (x <= 0 && y <= 0 && x + rw >= w && y + rh >= h && !clip) ops = [];   // a compose begins: the paper
            ops.push({ fill: rgb(ctx.fillStyle), r: [x, y, rw, rh], clip });
        },
        drawImage(bm, x, y, dw, ...rest) {
            if (bm && bm._soft) {
                const S = bm._soft, a = rest.length === 5 ? [x, y, dw, ...rest] : [0, 0, S.w, S.h, x, y, dw != null ? dw : S.w, dw != null ? rest[0] : S.h];
                if (a[6] !== a[2] || a[7] !== a[3]) ctx.scaled++;
                ops.push({ surf: S, sx: a[0], sy: a[1], sw: a[2], sh: a[3], x: a[4], y: a[5], dw: a[6], dh: a[7], clip });
                return;
            }
            if (opts.scaled && (rest.length === 1 || rest.length === 5)) {
                const a = rest.length === 5 ? [x, y, dw, ...rest] : [0, 0, platePx, platePx, x, y, dw, rest[0]];
                ctx.scaled++;
                ops.push({ src: bm.pixels, sx: a[0], sy: a[1], sw: a[2], sh: a[3], x: a[4], y: a[5], dw: a[6], dh: a[7], clip, scaled: true });
                return;
            }
            if (dw != null && dw !== platePx) { ctx.scaled++; return; }
            ops.push({ src: bm.pixels, x: Math.round(x), y: Math.round(y), clip });
        },
        /** The composed RGB at a device pixel. */
        at(x, y) { return ctx.rgba(Math.round(x), Math.round(y)).slice(0, 3).map(Math.round); },
        /** The composed premultiplied RGBA at whole device pixel (x, y), from transparent. */
        rgba(x, y) {
            const out = [0, 0, 0, 0];
            const inR = ([rx, ry, rw, rh]) => x >= Math.round(rx) && x < Math.round(rx + rw) && y >= Math.round(ry) && y < Math.round(ry + rh);
            for (const op of ops) {
                if (!inClip(op.clip, x, y)) continue;
                if (op.fill) { if (inR(op.r)) out.splice(0, 4, ...op.fill.slice(0, 3), 1); continue; }
                if (op.clear) { if (inR(op.clear)) out.fill(0); continue; }
                let sx = x - op.x, sy = y - op.y;
                if (op.surf) {
                    if (sx < 0 || sy < 0 || sx >= op.dw || sy >= op.dh) continue;
                    const S = op.surf, u = op.sx + ((sx + 0.5) * op.sw) / op.dw, v = op.sy + ((sy + 0.5) * op.sh) / op.dh;
                    const t = (px, py) => S.rgba(Math.min(S.w - 1, Math.max(0, px)), Math.min(S.h - 1, Math.max(0, py)));
                    let q;
                    if (opts.bilinear) {
                        const x0 = Math.floor(u - 0.5), y0 = Math.floor(v - 0.5), fx = u - 0.5 - x0, fy = v - 0.5 - y0;
                        const a = t(x0, y0), b = t(x0 + 1, y0), c = t(x0, y0 + 1), d = t(x0 + 1, y0 + 1);
                        q = a.map((_, k) => (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy);
                    } else q = t(Math.floor(u), Math.floor(v));
                    for (let c = 0; c < 4; c++) out[c] = q[c] + out[c] * (1 - q[3]);
                    continue;
                }
                if (op.scaled) {
                    if (sx < 0 || sy < 0 || sx >= op.dw || sy >= op.dh) continue;
                    sx = Math.min(platePx - 1, Math.max(0, Math.floor(op.sx + ((sx + 0.5) * op.sw) / op.dw)));
                    sy = Math.min(platePx - 1, Math.max(0, Math.floor(op.sy + ((sy + 0.5) * op.sh) / op.dh)));
                }
                if (sx < 0 || sy < 0 || sx >= platePx || sy >= platePx) continue;
                const s = (sy * platePx + sx) * 4, a = op.src[s + 3] / 255;
                for (let c = 0; c < 3; c++) out[c] = op.src[s + c] * a + out[c] * (1 - a);
                out[3] = a + out[3] * (1 - a);
            }
            return out;
        },
    };
    return ctx;
}

/** A canvas holding one soft context (a `makeCanvas` for the pyramid): drawn into another soft context as an image. */
export function softCanvas(c) {
    return { width: c.w, height: c.h, getContext: () => c, _soft: c };
}

/** Flat colours composited source-over, in order, over `paper`: the picture z order and opacity define. */
export function over(paper, layers) {
    const out = paper.slice();
    for (const [rgb, a] of layers) for (let c = 0; c < 3; c++) out[c] = rgb[c] * a + out[c] * (1 - a);
    return out.map(Math.round);
}
