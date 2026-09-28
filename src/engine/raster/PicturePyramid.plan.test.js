/**
 * PicturePyramid.plan.test.js — A3 §1.4's plan and §1.5's budget, on `__testkit__/softCanvas` (scaled draws on):
 * every source painted a flat colour of its own, random mixes of fresh, stale, coarser, finer, other-frame and
 * missing plates; every sampled screen pixel carries its planned source's colour and the source a rule oracle
 * chooses for its cell; a translucent family rendered by the core at ℓ and ℓ − 1 never composes darker than
 * either source; the image budget and the one-view record cap hold; the patch rule (e) puts the coarser picture
 * inside the dirty rectangles only.
 */
import LevelMap from "../LevelMap";
import { ENTER, BASE, EXIT } from "../frameLattice";
import PyramidStore, { levelCell, restCell, PLATE_BYTES } from "./PyramidStore";
import PicturePyramid, { COMPOSE_IMAGES, PATCH_MAX } from "./PicturePyramid";
import { zOf, levelKey, mapCell, coarser } from "./level";
import { packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import { fakeStage, meets } from "../__testkit__/fakeStage";
import { softCtx } from "../__testkit__/softCanvas";
import { lcg, LIST_CFG } from "../__testkit__/rasterLists";

const P = 512, S = 1;
let hue = 0;
/** A flat opaque plate of a colour nobody else has (never paper white). */
function flat() {
    const id = ++hue, c = [id % 241, Math.floor(id / 241) % 241, 60 + (id % 7) * 20];
    const px = new Uint8ClampedArray(P * P * 4);
    for (let k = 0; k < px.length; k += 4) { px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255; }
    return { px, c };
}
const cam = (frame, inScale, panX, panY, w, h) => ({
    frame, inScale, inPanX: panX, inPanY: panY,
    frameWindow: () => ({ left: -panX / inScale, top: -panY / inScale, right: (w - panX) / inScale, bottom: (h - panY) / inScale }),
});

function setup(W, H) {
    const lm = new LevelMap({ enter: ENTER, base: BASE, exit: EXIT }, W, H);
    lm.ensureSpine(0);
    const A = lm.cellChild("0", 1, 2).id;
    const stage = fakeStage();
    const store = new PyramidStore({ fresh: stage, maxBytes: 4000 * PLATE_BYTES, phone: false, doc: null });
    const ctx = softCtx(W, H, P, { scaled: true });
    const pyr = new PicturePyramid(null, { store, stage, lm, cfg: { levelStep: S }, width: W, height: H, dpr: 1, pixels: true, context: ctx });
    const colour = new Map();
    const put = (c, G) => {
        const f = flat(), res = store.put({ ...c, G, pixels: f.px, bytes: PLATE_BYTES, jobId: null });
        if (res === "cached" || res === "newer") colour.set(c.key, f.c);
        return res;
    };
    return { lm, A, stage, store, ctx, pyr, colour, put };
}

/** The device rect a draw paints, from the published affine, edges to the nearest pixel. */
const devRect = (d, v) => [
    Math.round((d.x0 - v.ox) * v.s + v.dx), Math.round((d.y0 - v.oy) * v.s + v.dy),
    Math.round((d.x1 - v.ox) * v.s + v.dx), Math.round((d.y1 - v.oy) * v.s + v.dy),
];

/** Every pixel on a stride and on both sides of every draw edge: the colour is the last draw's over it. */
function checkPixels(t, P0, fail, stride = 7) {
    const v = P0.v, W = t.pyr.wDev, H = t.pyr.hDev;
    const rects = P0.draws.map((d) => devRect(d, v));
    const want = (x, y) => {
        for (let k = P0.draws.length - 1; k >= 0; k--) {
            const r = rects[k];
            if (x < r[0] || x >= r[2] || y < r[1] || y >= r[3]) continue;
            const d = P0.draws[k];
            return d.rec ? t.colour.get(d.rec.key) : [255, 255, 255];
        }
        return [255, 255, 255];
    };
    const xs = new Set(), ys = new Set();
    for (let x = 0; x < W; x += stride) xs.add(x);
    for (let y = 0; y < H; y += stride) ys.add(y);
    for (const r of rects) for (const e of [r[0] - 1, r[0], r[2] - 1, r[2]]) if (e >= 0 && e < W) xs.add(e);
    for (const r of rects) for (const e of [r[1] - 1, r[1], r[3] - 1, r[3]]) if (e >= 0 && e < H) ys.add(e);
    let n = 0;
    for (const x of xs) {
        for (const y of ys) {
            const got = t.ctx.at(x, y), exp = want(x, y);
            n++;
            if (got[0] !== exp[0] || got[1] !== exp[1] || got[2] !== exp[2]) { fail(`pixel ${x},${y}: ${got} but the plan says ${exp}`); return n; }
        }
    }
    return n;
}

/** §1.4's rules, independently: the source a level cell should show (the budget never binds in these trials). */
function oracle(t, v, i, j) {
    const st = t.store, F = v.frameId, l = v.level;
    const ex = (r) => r && st.exact(r);
    const own = st.get(levelKey(F, l, S, i, j));
    if (ex(own)) return { src: own };
    for (const H of ["0"]) {
        const m = mapCell(t.lm, S, F, l, i, j, H);
        const r = m && st.get(levelKey(H, m.level, S, m.i, m.j));
        if (ex(r)) return { src: r };
    }
    const kids = [];
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) kids.push(st.get(levelKey(F, l + 1, S, 2 * i + a, 2 * j + b)));
    if (kids.every(ex)) return { kids };
    for (let k = 1; k <= 8; k++) {
        const c = coarser(t.lm, S, F, l, i, j, k);
        const r = c && st.get(levelKey(c.frame, c.level, S, c.i, c.j));
        if (!ex(r)) continue;
        if (own) {
            const Z = zOf(l, S), cb = { left: i * P / Z, top: j * P / Z, right: (i + 1) * P / Z, bottom: (j + 1) * P / Z };
            const pad = { left: cb.left - 1 / Z, top: cb.top - 1 / Z, right: cb.right + 1 / Z, bottom: cb.bottom + 1 / Z };
            let bb = null;
            for (const x of t.stage.dirtyRects(F, own.G) || []) {
                if (!meets(x, pad) || Math.min(x.right, cb.right) <= Math.max(x.left, cb.left) || Math.min(x.bottom, cb.bottom) <= Math.max(x.top, cb.top)) continue;
                bb = bb ? { left: Math.min(bb.left, x.left), top: Math.min(bb.top, x.top), right: Math.max(bb.right, x.right), bottom: Math.max(bb.bottom, x.bottom) } : { ...x };
            }
            // Grown by a pixel of the screen or the plate, clipped to the cell (A3 §3.2's "grown by one pixel").
            const g = 1 / Math.min(v.Z, Z);
            if (bb) bb = { left: Math.max(cb.left, bb.left - g), top: Math.max(cb.top, bb.top - g), right: Math.min(cb.right, bb.right + g), bottom: Math.min(cb.bottom, bb.bottom + g) };
            if (bb && (bb.right - bb.left) * (bb.bottom - bb.top) <= (P / Z) * (P / Z) * PATCH_MAX) return { src: own, patch: r, bb };
        }
        return { src: r };
    }
    if (own) return { src: own };
    for (let k = 1; k <= 8; k++) {
        const c = coarser(t.lm, S, F, l, i, j, k);
        const r = c && st.get(levelKey(c.frame, c.level, S, c.i, c.j));
        if (r) return { src: r };
    }
    return { src: null };
}

describe("PicturePyramid — the plan per cell (A3 §1.4, §1.5)", () => {
    test("random mixes: every pixel shows its planned source, and the plan's source is the rules' choice", () => {
        const errors = [];
        const fail = (m) => { if (errors.length < 8) errors.push(m); };
        let checked = 0, cells = 0;
        const seen = { own: 0, mapped: 0, kids: 0, coarser: 0, patch: 0, stale: 0, staleCoarse: 0, paper: 0 };
        for (let trial = 0; trial < 24; trial++) {
            const rnd = lcg(900 + trial), W = 900, H = 700;
            const t = setup(W, H);
            const l = 3 + Math.floor(rnd() * 3), Z = zOf(l, S) * (0.75 + rnd() * 0.6);
            const panX = -rnd() * 1500, panY = -rnd() * 1500;
            const c0 = cam(t.A, Z, panX, panY, W, H);
            t.pyr.frameFor(c0);
            const v = t.pyr._v;
            const F = String(t.A), fa = t.lm.frame(t.A);
            // Old plates everywhere at random, then dirt, then fresh ones: coarser, children, the root's twins.
            for (let j = v.j0 - 1; j <= v.j1 + 1; j++) for (let i = v.i0 - 1; i <= v.i1 + 1; i++) if (rnd() < 0.55) t.put(levelCell(F, l, S, i, j), 0);
            for (let k = 1; k <= 3; k++) {
                for (let j = (v.j0 - 1) >> k; j <= (v.j1 + 1) >> k; j++) for (let i = (v.i0 - 1) >> k; i <= (v.i1 + 1) >> k; i++) if (rnd() < 0.3) t.put(levelCell(F, l - k, S, i, j), 0);
            }
            for (let n = 0; n < 4; n++) {
                const x = v.i0 * P / zOf(l, S) + rnd() * 3000 / zOf(l, S), y = v.j0 * P / zOf(l, S) + rnd() * 2400 / zOf(l, S);
                const w = (rnd() < 0.5 ? 20 : 400) / zOf(l, S);
                t.stage.commit({ [F]: [{ left: x, top: y, right: x + w, bottom: y + w * 0.6 }] });
            }
            const G = t.stage.generation;
            for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) {
                const r = rnd();
                if (r < 0.12) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) t.put(levelCell(F, l + 1, S, 2 * i + a, 2 * j + b), G);
                else if (r < 0.3) t.put(levelCell(F, l - 1 - Math.floor(rnd() * 3), S, i >> 1, j >> 1), G);
                else if (r < 0.38) { const off = 2 ** (8 + l * S); t.put(levelCell("0", l + 12, S, i + fa.cell.i * off, j + fa.cell.j * off), G); }
            }
            const P0 = t.pyr.compose();
            checked += checkPixels(t, P0, fail);
            expect(P0.images).toBeLessThanOrEqual(COMPOSE_IMAGES);
            for (const cell of P0.cells) {
                cells++;
                const o = oracle(t, v, cell.i, cell.j), ds = cell.draws;
                const got = ds.map((d) => d.rec);
                let ok;
                if (o.kids) { ok = ds.length === 4 && o.kids.every((k) => got.includes(k)); seen.kids++; }
                else if (o.patch) { ok = ds.length === 2 && got[0] === o.src && got[1] === o.patch; seen.patch++; }
                else { ok = ds.length === 1 && got[0] === o.src; seen[!o.src ? "paper" : o.src.frame !== F ? "mapped" : o.src.level === l ? (t.store.exact(o.src) ? "own" : "stale") : (t.store.exact(o.src) ? "coarser" : "staleCoarse")]++; }
                if (!ok) fail(`trial ${trial} cell ${cell.i},${cell.j}: the plan drew ${got.map((r) => (r ? r.key : "paper"))}, the rules say ${o.kids ? "children" : (o.src ? o.src.key : "paper") + (o.patch ? " + " + o.patch.key : "")}`);
            }
        }
        expect(errors).toEqual([]);
        for (const k of Object.keys(seen)) expect([k, seen[k] > 0]).toEqual([k, true]);
        expect(checked).toBeGreaterThan(100000);
        expect(cells).toBeGreaterThan(150);
    });

    test("rest mode: rest plates over the level plan of the cells the rest set lacks; stale ones patched, covered or older", () => {
        const errors = [];
        const fail = (m) => { if (errors.length < 8) errors.push(m); };
        let checked = 0;
        const kinds = { exact: 0, patch: 0, cover: 0, older: 0, bare: 0 };
        for (let trial = 0; trial < 12; trial++) {
            const rnd = lcg(4400 + trial), W = 900, H = 700;
            const t = setup(W, H);
            const l = 4, Z = zOf(l, S) * (0.8 + rnd() * 0.5);
            const c0 = cam(t.A, Z, -rnd() * 900, -rnd() * 900, W, H);
            t.pyr.frameFor(c0);
            const F = String(t.A);
            t.pyr._rest = { frame: F, Z, shown: true, gen: 1 };           // the rest set, shown (its executors are the rest test's)
            t.pyr.frameFor(cam(t.A, Z, c0.inPanX + 1, c0.inPanY, W, H));
            const v = t.pyr._v;
            expect(v.mode).toBe("rest");
            for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) if (rnd() < 0.7) t.put(restCell(F, Z, i, j), 0);
            const lr = { i0: Math.floor(v.i0 * zOf(l, S) / Z) - 1, i1: Math.ceil((v.i1 + 1) * zOf(l, S) / Z) + 1, j0: Math.floor(v.j0 * zOf(l, S) / Z) - 1, j1: Math.ceil((v.j1 + 1) * zOf(l, S) / Z) + 1 };
            for (let j = lr.j0; j <= lr.j1; j++) for (let i = lr.i0; i <= lr.i1; i++) if (rnd() < 0.5) t.put(levelCell(F, l, S, i, j), 0);
            for (let n = 0; n < 3; n++) {
                const x = (v.i0 * P + rnd() * W) / Z, y = (v.j0 * P + rnd() * H) / Z, w = (rnd() < 0.6 ? 30 : 300) / Z;
                t.stage.commit({ [F]: [{ left: x, top: y, right: x + w, bottom: y + w }] });
            }
            const G = t.stage.generation;
            for (let j = lr.j0; j <= lr.j1; j++) for (let i = lr.i0; i <= lr.i1; i++) {
                if (rnd() < 0.4) t.put(levelCell(F, l, S, i, j), G);
                if (rnd() < 0.3) t.put(levelCell(F, l - 1, S, i >> 1, j >> 1), G);
            }
            const P0 = t.pyr.compose();
            checked += checkPixels(t, P0, fail);
            // Inside a rest cell with a plate, every pixel is one of that cell's own draws, never the level plan under it.
            for (const c of P0.cells.filter((x) => x.rest)) {
                const [x0, y0, x1, y1] = devRect({ x0: c.box[0], y0: c.box[1], x1: c.box[2], y1: c.box[3] }, v);
                const mine = new Set(c.draws.map((d) => (d.rec ? String(t.colour.get(d.rec.key)) : "255,255,255")));
                for (let y = Math.max(0, y0 + 2); y < Math.min(H, y1 - 2); y += 11) for (let x = Math.max(0, x0 + 2); x < Math.min(W, x1 - 2); x += 11) {
                    if (!mine.has(String(t.ctx.at(x, y)))) { fail(`trial ${trial}: pixel ${x},${y} in rest cell ${c.i},${c.j} is not the cell's own`); break; }
                }
            }
            for (const c of P0.cells) {
                if (c.base) continue;
                const d = c.draws;
                if (d.length === 1 && d[0].cls === "sharp") kinds.exact++;
                else if (d[0] && d[0].under) kinds.patch++;
                else if (d.length === 1 && d[0].cls === "older") kinds.older++;
                else kinds.cover++;
            }
            kinds.bare += P0.cells.filter((c) => c.base).length;
            // No rest pixel is older than it must be: a stale rest plate is drawn whole only where no fresh level covers it.
            for (const c of P0.cells.filter((x) => x.rest && x.draws.length === 1 && x.draws[0].cls === "older")) {
                for (let ll = l; ll >= l - 8; ll--) {
                    const Zl = zOf(ll, S), box = { left: c.i * P / Z, top: c.j * P / Z, right: (c.i + 1) * P / Z, bottom: (c.j + 1) * P / Z };
                    let all = true;
                    for (let j = Math.floor(box.top * Zl / P); j < Math.ceil(box.bottom * Zl / P); j++) for (let i = Math.floor(box.left * Zl / P); i < Math.ceil(box.right * Zl / P); i++) {
                        const r = t.store.get(levelKey(F, ll, S, i, j));
                        if (!r || !t.store.exact(r)) all = false;
                    }
                    if (all) fail(`trial ${trial}: rest cell ${c.i},${c.j} drawn older while level ${ll} covers it fresh`);
                }
            }
        }
        expect(errors).toEqual([]);
        for (const k of Object.keys(kinds)) expect([k, kinds[k] > 0]).toEqual([k, true]);
        expect(checked).toBeGreaterThan(40000);
    });

    test("the patch rule (e): the fresh coarser picture inside the dirty rectangles only, the sharp stale plate elsewhere", () => {
        const W = 1024, H = 1024, t = setup(W, H), F = String(t.A);
        t.pyr.frameFor(cam(t.A, 16, 0, 0, W, H));                              // ℓ 4, σ = 1: cells (0..1, 0..1)
        const own = levelCell(F, 4, S, 0, 0);
        t.put(own, 0);
        t.stage.commit({ [F]: [{ left: 5, top: 6, right: 9, bottom: 8 }] });   // 64 × 32 device px of the cell, grown a pixel
        t.put(levelCell(F, 3, S, 0, 0), t.stage.generation);
        const P0 = t.pyr.compose();
        const cell = P0.cells.find((c) => c.i === 0 && c.j === 0);
        expect(cell.draws.map((d) => d.rec.key)).toEqual([own.key, levelKey(F, 3, S, 0, 0)]);
        const cOwn = t.colour.get(own.key), cCo = t.colour.get(levelKey(F, 3, S, 0, 0));
        for (let y = 0; y < 512; y += 3) for (let x = 0; x < 512; x += 3) {
            const inside = x >= 79 && x < 145 && y >= 95 && y < 129;
            expect([x, y, t.ctx.at(x, y)]).toEqual([x, y, inside ? cCo : cOwn]);
        }
        // Past PATCH_MAX the whole cell is the coarser picture.
        t.stage.commit({ [F]: [{ left: 0, top: 0, right: 30, bottom: 30 }] });
        t.put(levelCell(F, 3, S, 0, 0), t.stage.generation);
        const P1 = t.pyr.compose();
        expect(P1.cells.find((c) => c.i === 0 && c.j === 0).draws.map((d) => [d.rec.key, d.cls])).toEqual([[levelKey(F, 3, S, 0, 0), "blur"]]);
    });

    test("children only when all are exact; a stale child sends the cell to the coarser plate", () => {
        const W = 1024, H = 1024, t = setup(W, H), F = String(t.A);
        t.pyr.frameFor(cam(t.A, 16, 0, 0, W, H));
        for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) t.put(levelCell(F, 5, S, a, b), 0);
        t.put(levelCell(F, 3, S, 0, 0), 0);
        expect(t.pyr.compose().cells.find((c) => c.i === 0 && c.j === 0).draws).toHaveLength(4);
        t.stage.commit({ [F]: [{ left: 10, top: 10, right: 11, bottom: 11 }] });   // stales the child (1, 1) and the coarser plate
        t.put(levelCell(F, 3, S, 0, 0), t.stage.generation);
        const d = t.pyr.compose().cells.find((c) => c.i === 0 && c.j === 0).draws;
        expect(d.map((x) => x.rec.key)).toEqual([levelKey(F, 3, S, 0, 0)]);
    });

    test("the record cap: a plan takes at most one view of distinct records, however many children are ready", () => {
        const W = 1024, H = 768, t = setup(W, H), F = String(t.A);
        t.pyr.frameFor(cam(t.A, 16 * 0.72, -200, -200, W, H));               // ℓ 4 at σ 0.72: 4 × 3 cells
        const v = t.pyr._v;
        expect(v.level).toBe(4);
        let n = 0;
        for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) {
            if (n++ % 2) t.put(levelCell(F, 4, S, i, j), 0);
            else for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) t.put(levelCell(F, 5, S, 2 * i + a, 2 * j + b), 0);
        }
        const P0 = t.pyr.compose();
        expect(n).toBeGreaterThanOrEqual(12);
        expect(P0.keys.size).toBeLessThanOrEqual(t.pyr.viewUnit);
        expect(P0.images).toBeLessThanOrEqual(COMPOSE_IMAGES);
        expect(P0.draws.filter((d) => d.rec && d.rec.level === 5).length).toBeGreaterThan(0);
    });

    test("the image budget: direct under COMPOSE_IMAGES distinct images, else the surface with scaled ≤ 30 − own", () => {
        const W = 3000, H = 2000, t = setup(W, H), F = String(t.A);
        const drawn = new Set();
        const inner = t.ctx.drawImage;
        t.ctx.drawImage = function (bm, ...a) { drawn.add(bm); return inner.call(this, bm, ...a); };
        t.pyr._mk = () => ({ width: 0, height: 0, getContext: () => softCtx(4096, 4096, P, { scaled: true }) });
        t.pyr.frameFor(cam(t.A, 8, -100, -100, W, H));                      // this screen's σmin is 1: ℓ 3 at σ 1
        const v = t.pyr._v, l = v.level;
        expect([l, v.s]).toEqual([3, 1]);
        const cells = [];
        for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) cells.push([i, j]);
        expect(cells.length).toBeGreaterThan(COMPOSE_IMAGES + 3);
        cells.slice(3).forEach(([i, j]) => t.put(levelCell(F, l, S, i, j), 0));
        for (const [i, j] of cells) t.put(levelCell(F, l - 2, S, i >> 2, j >> 2), 0);
        const P0 = t.pyr.compose();                                       // own > 30: the surface, and no scaled stand-in
        expect(P0.own).toBeGreaterThan(COMPOSE_IMAGES);
        expect(P0.scaled).toBe(0);
        expect(t.pyr.s.surface).toBe(1);
        expect(drawn.size).toBe(1);                                       // the ink canvas took the surface alone
        drawn.clear();
        cells.slice(3, 16).forEach(([i, j]) => t.store.dropWhere((x) => x.key === levelKey(F, l, S, i, j)));
        const P1 = t.pyr.compose();                                       // own ≤ 30: stand-ins up to 30 − own, drawn directly
        expect(P1.scaled).toBeGreaterThan(0);
        expect(P1.scaled).toBeLessThanOrEqual(COMPOSE_IMAGES - P1.own);
        expect(P1.images).toBeLessThanOrEqual(COMPOSE_IMAGES);
        expect(drawn.size).toBe(P1.images);
        expect(t.pyr.s.direct).toBe(1);
    });

    test("a translucent family split across ℓ and ℓ − 1 never composes darker than either source", () => {
        const W = 1024, H = 1024, t = setup(W, H), F = String(t.A);
        const list = [{ type: "fill", origin: "native", id: 1, color: "rgb(20,60,220)", opacity: 0.45,
            polys: [[[4, 4], [60, 4], [60, 60], [4, 60]]] }];
        const render = (l, i, j) => {
            const job = packJob(list, { plates: Int32Array.of(i, j), q: 0, Zq: zOf(l, S), dpr: 1, cfg: LIST_CFG, paper: [255, 255, 255], G: 0 });
            const out = new Uint8ClampedArray(P * P * 4);
            renderPlate(job, 0, out, null, null);
            const c = levelCell(F, l, S, i, j);
            t.store.put({ ...c, G: 0, pixels: out, bytes: PLATE_BYTES, jobId: null });
            return out;
        };
        t.pyr.frameFor(cam(t.A, 16, 0, 0, W, H));
        const own = render(4, 0, 0), co = render(3, 0, 0);
        render(4, 1, 1);                                                       // cells (1, 0) and (0, 1) take ℓ 3, scaled
        const P0 = t.pyr.compose();
        expect(P0.draws.filter((d) => d.rec && d.rec.level === 3).length).toBe(2);
        const px = (buf, x, y) => [0, 1, 2].map((c) => buf[(y * P + x) * 4 + c]);
        const inside = px(own, 200, 200), insideCo = px(co, 100, 100);
        const floor = [0, 1, 2].map((c) => Math.min(inside[c], insideCo[c]));
        let n = 0;
        for (let y = 80; y < 950; y += 5) for (let x = 80; x < 950; x += 5) {
            const got = t.ctx.at(x, y);
            n++;
            for (let c = 0; c < 3; c++) if (got[c] < floor[c] - 1) throw new Error(`pixel ${x},${y} ${got} darker than ${floor}`);
        }
        expect(n).toBeGreaterThan(20000);
        expect(inside[2]).toBeGreaterThan(200);                               // blended once: light blue, not the doubled 0.7
    });
});
