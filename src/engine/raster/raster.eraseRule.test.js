/**
 * raster.eraseRule.test.js — PLAN §3 row 3, A2 §6.4: a pending mark hides exactly its targets, and a
 * masked target looks like its cut pieces. Real pixels: the Stage's items packed (`packJob`) and
 * rendered (`rasterCore.renderPlate`) at one device pixel a frame unit.
 *  (a) at every step of a bake the pack's mask bits equal an oracle kept from the op history alone
 *      (targets at registration; a step maps what it removed to its pieces; a refusal or a graze
 *      hands a target to its mark), never from the fields under test;
 *  (b) plates kept through the bake — re-rendered only where the scene's dirt says, as a partial
 *      re-render does (PLAN §5.3 A2-Q2) — equal a fresh raster except on the outlines of cut arcs,
 *      flattened again from their new ends (≤ 16/255, the arc tolerance), inside the cut objects'
 *      boxes; exactly for axis-aligned fills (K4);
 *  (c) an object dragged across a mark after its registration — or begun while it was unlanded —
 *      draws as with no mark at all at every step, and is never cut;
 *  (d) two marks over one object, the lower cutting first (A2 §5.6); a refusal over ink (§5.7).
 */
import { useEngines, mkEngine, drawStroke, eraseGesture } from "../__testkit__/harness";
import { lcg } from "../__testkit__/rasterLists";
import { packJob, clearPackCaches } from "./rasterPack";
import * as core from "./rasterCore";
import { PLATE_PX } from "./plate";
import { FLAG_MASK } from "./rasterJob";
import { loopsBBox } from "../geometry/arcShape";
import { underMask } from "../eraseRule";

useEngines();
jest.setTimeout(120000);

const N = PLATE_PX * PLATE_PX * 4;
const PLATES = [[0, 0], [1, 0], [0, 1], [1, 1]];
const zOf = (o) => (o.z != null ? o.z : o.id);

/** The Stage's items packed for `plates`: `drop` leaves items out (the marks, to draw "no mark"), `only` a selection's job. */
function job(E, { drop = null, only = null } = {}) {
    E._render();
    let items = E.stage.items().filter((it) => !it.pending);
    if (drop) items = items.filter((it) => !drop(it));
    clearPackCaches();
    return packJob(items, { plates: Int32Array.from(PLATES.flat()), q: 0, Zq: 1, dpr: 1, cfg: E.cfg, paper: [255, 255, 255], only });
}
function pixels(j) {
    return PLATES.map((_, k) => { const out = new Uint8ClampedArray(N); core.renderPlate(j, k, out); return out; });
}
/** Re-render `rects` (frame units) of the kept plates from job `j`, each rounded outward to whole pixels. */
function patch(kept, j, rects) {
    PLATES.forEach(([i, jj], k) => {
        for (const r of rects) {
            const x0 = Math.max(0, Math.floor(r.left) - i * PLATE_PX), y0 = Math.max(0, Math.floor(r.top) - jj * PLATE_PX);
            const x1 = Math.min(PLATE_PX, Math.ceil(r.right) - i * PLATE_PX), y1 = Math.min(PLATE_PX, Math.ceil(r.bottom) - jj * PLATE_PX);
            if (x1 > x0 && y1 > y0) core.renderPlate(j, k, kept[k], null, null, [x0, y0, x1, y1]);
        }
    });
}
/** Where two sets of plates differ: the count, the largest channel difference, and how many differing pixels `ok(x, y)` does not accept. */
function diff(a, b, ok = () => false) {
    let n = 0, max = 0, outside = 0;
    PLATES.forEach(([i, j], k) => {
        const p = a[k], q = b[k];
        for (let o = 0; o < N; o += 4) {
            const d = Math.max(Math.abs(p[o] - q[o]), Math.abs(p[o + 1] - q[o + 1]), Math.abs(p[o + 2] - q[o + 2]));
            if (!d) continue;
            n++; if (d > max) max = d;
            const px = (o >> 2) % PLATE_PX, py = (o >> 2) / PLATE_PX | 0;
            if (!ok(i * PLATE_PX + px + 0.5, j * PLATE_PX + py + 0.5)) outside++;
        }
    });
    return { n, max, outside };
}
const inAny = (boxes, grow = 1) => (x, y) => boxes.some((b) => x >= b.left - grow && x <= b.right + grow && y >= b.top - grow && y <= b.bottom + grow);
const at = (px, x, y) => { const k = PLATES.findIndex(([i, j]) => x >= i * PLATE_PX && x < (i + 1) * PLATE_PX && y >= j * PLATE_PX && y < (j + 1) * PLATE_PX); const o = (((y | 0) % PLATE_PX) * PLATE_PX + ((x | 0) % PLATE_PX)) * 4; return [px[k][o], px[k][o + 1], px[k][o + 2]]; };

/**
 * The oracle of (a): what each landed mark still hides, kept from the document's events and the
 * gestures' bake steps only — a registration names the targets, a step moves a removed id to its
 * pieces (except for the mark that made them), a refusal or a graze hands one over, a spend ends it.
 */
function oracle(E) {
    const pend = new Map();
    E.doc.subscribe((ev) => {
        if (ev.kind === "change" && ev.attrOnly && ev.attr && ev.attr.targets) pend.set(ev.id, new Set(ev.attr.targets));
        else if (ev.kind === "change" && ev.attrOnly && ev.attr && ev.attr.handledBy && ev.by != null) { const s = pend.get(ev.by); if (s) s.delete(ev.id); }
        else if (ev.kind === "remove" && ev.obj && ev.obj.erase && !ev.rehome) pend.delete(ev.id);
    });
    E.doc.subscribeOps((ev) => {
        if (ev.kind !== "bake" || !ev.step.removed) return;
        const M = ev.op.strokeId, rid = ev.step.removed.obj.id;
        for (const [K, s] of pend) if (s.delete(rid) && K !== M) for (const pc of ev.step.pieces) s.add(pc.obj.id);
    });
    return pend;
}
/** Every item's mask bits in `j` against the oracle: bit k set iff some mark in slot k hides it (oracle) and their boxes meet. */
function checkBits(E, j, pend) {
    const meta = j.meta, attr = j.attr, n = j.nItems, marks = [];
    for (let k = 0; k < n; k++) {
        if (!(meta[k * 8 + 6] & FLAG_MASK)) continue;
        const id = j.ids[k], a = k * 9;
        let m = marks.find((x) => x.id === id);
        if (!m) marks.push((m = { id, slot: meta[k * 8 + 7], z: zOf(E.doc.getById(id).obj), box: [Infinity, Infinity, -Infinity, -Infinity] }));
        m.box = [Math.min(m.box[0], attr[a]), Math.min(m.box[1], attr[a + 1]), Math.max(m.box[2], attr[a + 2]), Math.max(m.box[3], attr[a + 3])];
    }
    let checked = 0, masked = 0;
    for (let k = 0; k < n; k++) {
        if (meta[k * 8 + 6] & FLAG_MASK) continue;
        const id = j.ids[k], rec = E.doc.getById(id), a = k * 9;
        let want = 0;
        for (const m of marks) {
            const s = pend.get(m.id);
            const meets = attr[a] <= m.box[2] && attr[a + 2] >= m.box[0] && attr[a + 1] <= m.box[3] && attr[a + 3] >= m.box[1];
            if (s && s.has(id) && rec && zOf(rec.obj) < m.z && meets) want |= 1 << m.slot;
        }
        expect({ id, bits: meta[k * 8 + 7] }).toEqual({ id, bits: want });
        checked++; if (want) masked++;
    }
    return { checked, masked };
}

/** A seeded scene in the camera's frame: fills, resolved strokes, one translucent; marks over it; some objects moved under a mark after it landed. */
function scene(seed, { fillsOnly = false } = {}) {
    const rnd = lcg(seed), E = mkEngine(800, 600);
    E._scheduleBake = () => {};
    const rr = (a, b) => a + rnd() * (b - a);
    const colour = () => "rgb(" + [0, 0, 0].map(() => 20 + Math.floor(rnd() * 180)).join(",") + ")";
    const objs = [], nObj = 3 + Math.floor(rnd() * 10);
    for (let k = 0; k < nObj; k++) {
        const x = rr(120, 560), y = rr(120, 400), w = rr(40, 220), h = rr(30, 160);
        const kind = fillsOnly ? 0 : Math.floor(rnd() * 3);
        const opacity = k === 1 && !fillsOnly ? 0.5 : 1;
        if (kind === 0) objs.push(E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: colour(), opacity,
            polys: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]] }, "0"));
        else { E.setOpacity(opacity); objs.push(drawStroke(E, [[x, y], [x + w * 0.5, y + h], [x + w, y + h * 0.3]], 6 + Math.floor(rnd() * 30), colour())); E.setOpacity(1); }
    }
    E._render();
    const marks = [], nMark = 1 + Math.floor(rnd() * 3);
    for (let m = 0; m < nMark; m++) {
        const x = rr(150, 550), y = rr(150, 420);
        eraseGesture(E, rnd() < 0.5 ? [[x - 120, y], [x + 120, y + rr(-60, 60)]] : [[x, y - 110], [x + rr(-50, 50), y + 110]], 8 + Math.floor(rnd() * 30));
        marks.push(E._eraseStrokes().slice(-1)[0].obj);
    }
    // Moved under a mark after its registration: never its target (Kobin's drag-across, PLAN §0 decision 3).
    for (const o of objs) {
        if (rnd() < 0.7 || !E.doc.getById(o.id) || marks.some((M) => (M.targets || []).includes(o.id))) continue;
        const M = marks[Math.floor(rnd() * marks.length)], mb = loopsBBox(M.loops), ob = loopsBBox(E.doc.getById(o.id).obj.loops || [[]]) || null;
        if (!mb || !ob) continue;
        E.doc.moveById(o.id, (mb.x0 + mb.x1) / 2 - (ob.x0 + ob.x1) / 2, (mb.y0 + mb.y1) / 2 - (ob.y0 + ob.y1) / 2);
    }
    return { E, objs, marks };
}

describe("row 3 (a) the pack's mask bits are the op history's, at every step of a bake", () => {
    for (const seed of [11, 23, 37, 43, 59, 61, 67, 71, 79, 83]) {
        test("seed " + seed, () => {
            const { E, marks } = scene(seed);
            const pend = oracle(E);
            for (const M of marks) pend.set(M.id, new Set(M.targets));        // registered before the oracle listened
            let steps = 0, masked = 0;
            for (let guard = 0; guard < 400; guard++) {
                masked += checkBits(E, job(E), pend).masked;
                if (!E._bakeNext()) break;
                steps++;
            }
            expect(E._eraseStrokes()).toHaveLength(0);
            expect(steps).toBeGreaterThan(0);
            expect(masked).toBeGreaterThan(0);                                  // the path under test ran
        });
    }
});

describe("row 3 (b) plates kept through a bake, re-rendered where the scene's dirt says, are the fresh raster", () => {
    const run = (seed, fillsOnly) => {
        const { E } = scene(seed, { fillsOnly });
        const cut = [];                                                          // the removed objects' drawn boxes: where arcs are flattened again
        E.doc.subscribeOps((ev) => { if (ev.kind === "bake" && ev.step.removed) cut.push(E.stage.placeNative(ev.step.removed.obj, "0").box()); });
        let kept = pixels(job(E)), G = E.stage.generation, worst = 0, steps = 0;
        for (let guard = 0; guard < 400; guard++) {
            const more = E._bakeNext();
            const j = job(E);
            const rects = E.stage.dirtyRects("0", G);
            expect(rects).not.toBeNull();
            patch(kept, j, rects);
            G = E.stage.generation;
            const d = diff(kept, pixels(j), inAny(cut));
            expect(d.outside).toBe(0);                                          // nothing differs outside the cut objects' boxes
            if (d.max > worst) worst = d.max;
            steps++;
            if (!more) break;
        }
        expect(E._eraseStrokes()).toHaveLength(0);
        return { worst, steps };
    };
    test("K4 axis-aligned fills: 0 differing bytes at every step", () => {
        for (const seed of [5, 17, 29]) expect(run(seed, true).worst).toBe(0);
    });
    for (const seed of [11, 23, 37, 67, 59]) {
        test("seed " + seed + ": only cut arcs' outlines, by at most 16/255", () => {
            const r = run(seed, false);
            expect(r.steps).toBeGreaterThan(0);
            expect(r.worst).toBeLessThanOrEqual(16);
        });
    }
});

describe("row 3 (c) an object moved under a mark after its registration draws as with no mark, and is never cut", () => {
    const setup = (landed) => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(200,30,30)", opacity: 1, polys: [[[300, 250], [500, 250], [500, 350], [300, 350]]] }, "0");
        const Y = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(30,160,30)", opacity: 1, polys: [[[80, 420], [180, 420], [180, 500], [80, 500]]] }, "0");
        E._render();
        E.setEraserSize(30); E.setTool("erasePartial");                        // a ring through T, far from Y
        E.pointerDown(400, 220);
        for (let a = 1; a <= 36; a++) E.pointerMove(400 + 90 * Math.sin((a / 36) * 2 * Math.PI), 310 - 90 * Math.cos((a / 36) * 2 * Math.PI));
        E.pointerUp();
        if (landed) E.flushBakes();
        return { E, T, Y };
    };
    for (const landed of [true, false]) {
        test(`${landed ? "dragged after the landing" : "the drag begun while the mark was unlanded: the press lands it first"}`, () => {
            const { E, Y } = setup(landed);
            const cutIds = new Set();
            E.doc.subscribeOps((ev) => { if (ev.kind === "bake" && ev.step.removed) cutIds.add(ev.step.removed.obj.id); });
            E.setTool("select");
            E.pointerDown(130, 460); E.pointerUp();                             // tap Y
            const M = E._eraseStrokes()[0].obj;
            expect(M.targets).not.toContain(Y.id);
            expect(E.selection.ids).toEqual([Y.id]);
            E.pointerDown(130, 460);
            let sameEvery = true, steps = 0;
            for (let k = 1; k <= 12; k++) {
                E.pointerMove(130 + 22 * k, 460 - 16 * k);                         // across the ring's band
                const sel = new Set([Y.id]);
                const withMark = pixels(job(E, { only: sel })), noMark = pixels(job(E, { only: sel, drop: (it) => it.erase }));
                if (diff(withMark, noMark).n) sameEvery = false;
                steps++;
            }
            E.pointerUp();
            expect(steps).toBe(12);
            expect(sameEvery).toBe(true);                                        // the SEL layer: Y over the mark at every step
            const sel = new Set([Y.id]);
            expect(diff(pixels(job(E, { only: sel })), pixels(job(E, { only: sel, drop: (it) => it.erase }))).n).toBe(0);
            E.flushErases();
            expect(cutIds.has(Y.id)).toBe(false);                                // never cut
            expect(E.doc.getById(Y.id)).not.toBeNull();
        });
    }
});

describe("the scene reads the erase fields from the natives (was erase.markFrame, REVIEWER E-5)", () => {
    test("a mark magnified into a deeper frame: its tile items and its target's carry the natives' fields, and the pack masks the target there", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = drawStroke(E, [[250, 300], [550, 300]], 30);
        eraseGesture(E, [[300, 260], [500, 340]], 40);
        const M = E._eraseStrokes()[0].obj;
        for (let i = 0; i < 3; i++) E.zoomFactorAt(400, 300, 16);
        expect(E.cam.frame).not.toBe(M._home);                                 // seen from another frame
        E._render();
        const items = E.stage.items(), mi = items.filter((it) => it.id === M.id), ti = items.filter((it) => it.id === T.id);
        expect(mi.length).toBeGreaterThan(0);
        expect(mi.every((it) => it.piece !== M && it.erase && it.targets === M.targets)).toBe(true);   // tile copies, read through the native
        expect(ti.length).toBeGreaterThan(0);
        expect(ti.every((it) => it.targetOf === T.targetOf && underMask(it, mi[0]))).toBe(true);
        const b = ti[0].box, i0 = Math.floor(b.left / PLATE_PX), j0 = Math.floor(b.top / PLATE_PX);
        clearPackCaches();
        const j = packJob(items.filter((it) => !it.pending), { plates: Int32Array.of(i0, j0), q: 0, Zq: 1, dpr: 1, cfg: E.cfg, paper: [255, 255, 255] });
        let masked = 0;
        for (let k = 0; k < j.nItems; k++) if (j.ids[k] === T.id && j.meta[k * 8 + 7]) masked++;
        expect(masked).toBeGreaterThan(0);
    });
});

describe("row 3 (d) deterministic cases", () => {
    test("two marks over one object, the lower cutting first (A2 §5.6): its ink under the upper never shows", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(30,30,200)", opacity: 1, polys: [[[200, 250], [600, 250], [600, 350], [200, 350]]] }, "0");
        E._render();
        eraseGesture(E, [[330, 200], [330, 400]], 40);                           // M1: x 290..370 (a size is half the pen)
        eraseGesture(E, [[470, 200], [470, 400]], 40);                           // M2: x 430..510
        const [M1, M2] = E._eraseStrokes().map((m) => m.obj);
        expect(M1.targets).toEqual([T.id]); expect(M2.targets).toEqual([T.id]);
        const look = () => { const px = pixels(job(E)); return [at(px, 330, 300), at(px, 470, 300), at(px, 400, 300)]; };
        const PAPER = [255, 255, 255], BLUE = [30, 30, 200];
        expect(look()).toEqual([PAPER, PAPER, BLUE]);                            // both landed: hidden under E1 ∪ E2
        const seen = [];
        while (E._bakeNext()) seen.push(look());
        for (const s of seen) expect(s).toEqual([PAPER, PAPER, BLUE]);           // at no moment does T's ink under E2 show
        expect(E._eraseStrokes()).toHaveLength(0);
        expect(look()).toEqual([PAPER, PAPER, BLUE]);
    });

    test("a fill drawn over one pending mark and under a second shows over the first: the two marks do not share a slot (A2 §5.2)", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(30,30,200)", opacity: 1, polys: [[[200, 250], [600, 250], [600, 350], [200, 350]]] }, "0");
        E._render();
        eraseGesture(E, [[330, 200], [330, 400]], 40);                           // M1: x 290..370
        const Y = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(200,30,30)", opacity: 1, polys: [[[300, 280], [500, 280], [500, 320], [300, 320]]] }, "0");
        eraseGesture(E, [[470, 200], [470, 400]], 40);                           // M2: x 430..510, over T and Y
        const [M1, M2] = E._eraseStrokes().map((m) => m.obj);
        expect(M1.targets).toEqual([T.id]); expect(M2.targets).toEqual([T.id, Y.id]);
        const px = pixels(job(E));
        expect(at(px, 330, 300)).toEqual([200, 30, 30]);                         // Y over M1: shown
        expect(at(px, 330, 265)).toEqual([255, 255, 255]);                       // T under M1: hidden
        expect(at(px, 470, 300)).toEqual([255, 255, 255]);                       // both under M2: hidden
        expect(at(px, 400, 300)).toEqual([200, 30, 30]);
    });

    test("a refusal over ink shows the target's ink under the mark again; an inkless one dirties nothing (A2 §5.7)", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(30,30,200)", opacity: 1, polys: [[[200, 250], [600, 250], [600, 350], [200, 350]]] }, "0");
        const U = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(200,30,30)", opacity: 1, polys: [[[200, 450], [600, 450], [600, 520], [200, 520]]] }, "0");
        E._render();
        eraseGesture(E, [[400, 200], [400, 560]], 40);
        const Erec = E._eraseStrokes()[0], M = Erec.obj;
        expect(M.targets).toEqual([T.id, U.id]);
        let px = pixels(job(E));
        expect(at(px, 400, 300)).toEqual([255, 255, 255]);
        const G = E.stage.generation;
        const refused = { refused: "no tile ceded", stats: { seals: [], dust: 0 }, inkless: false };
        expect(E._applyDescent(Erec, E.doc.getById(T.id), refused)).toBe(false);
        expect(E.doc.getById(T.id).obj.handledBy).toEqual([M.id]);
        const rects = E.stage.dirtyRects("0", G);
        expect(rects.length).toBe(1);                                            // box(T) ∩ box(M)
        expect([rects[0].left, rects[0].top, rects[0].right, rects[0].bottom]).toEqual([360, 250, 440, 350]);
        px = pixels(job(E));
        expect(at(px, 400, 300)).toEqual([30, 30, 200]);                         // the erase did not happen on T, and shows so
        expect(at(px, 400, 480)).toEqual([255, 255, 255]);                       // U still hidden
        const G2 = E.stage.generation;
        E._applyDescent(Erec, E.doc.getById(U.id), { ...refused, inkless: true });
        expect(E.stage.dirtyRects("0", G2)).toEqual([]);                        // inkless: no dirt
    });
});
