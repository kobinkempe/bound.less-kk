/**
 * raster.dropdirt.test.js — a drop's dirt (OPEN-FLAGS F153). Sound: after a drop every plate the store calls exact draws
 * what the document now holds — each record checked against its cell rendered again from a snapshot of its frame
 * through the shipped pack and core, right after the drop and once every job has landed; with the plane, without it,
 * and with plates re-rendered mid-drag without the dragged ink (pixels near a cache square's seam masked, where the two
 * routes differ by a pixel); and a plate the drop left exact shows its cell's truth from before it, one route both sides,
 * nothing masked. Tight: a cell the move leaves unchanged keeps its plate.
 */
import KobinEngine from "../KobinEngine";
import { resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { resetPlaneStats } from "./MovePlane";
import { packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import { PLATE_PX } from "./plate";
import { rectLoop, normalizeLoops } from "../geometry/arcShape";
import { seamPadFor } from "../geometry/derive";
import { TILE } from "../frameLattice";

jest.setTimeout(180000);

const engines = [];
function mkEngine() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); resetPlaneStats(); });
afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = (E) => { const r = E.renderer.queue.report(); return !r.queued.some((n) => n) && !r.inFlight.some((n) => n); };
async function flush(E, rounds = 80) { for (let k = 0; k < rounds && !(k > 0 && idle(E)); k++) await sleep(0); }
/** Until nothing is queued or in flight across a few quiet steps (the prefetch runs on a timer). */
async function settle(E) { for (let k = 0; k < 4; k++) { await flush(E); await sleep(40); E.renderer.syncCameraOnly(); } await flush(E); }

/** mulberry32 */
function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function addShape(E, frame, loops, color) {
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), color, opacity: 1, loops };
    E.doc.add(o, frame);
    return o;
}
function addFill(E, frame, ring, color) {
    const o = { type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1, polys: [ring] };
    E.doc.add(o, frame);
    return o;
}
const box = (r) => rectLoop(r);
function disc(cx, cy, r) {
    return normalizeLoops([[
        { line: false, C: [cx, cy], r, a0: 0, sweep: Math.PI, A: [cx + r, cy], B: [cx - r, cy] },
        { line: false, C: [cx, cy], r, a0: Math.PI, sweep: Math.PI, A: [cx - r, cy], B: [cx + r, cy] },
    ]]);
}
/** A rect given in the camera frame's units, in frame `to`'s. */
const rectIn = (E, F, r, to) => E.lm.mapRectF(r, F, to);

/** The camera at depth 1, 1 px a unit, its frame's origin at the screen's centre. */
function camera(E) {
    E.lm.ensureSpine(3);
    const F = E.lm.spineAt(1);
    E.cam.set({ activeLevel: 1, frame: F, inScale: 1, inPanX: 400, inPanY: 300 });
    return { F, P: E.lm.frame(F).parent };
}

// ---- the truth ----

const cellRect = (r) => { const u = PLATE_PX / r.Z; return { left: r.i * u, top: r.j * u, right: (r.i + 1) * u, bottom: (r.j + 1) * u }; };
const descr = (r) => ({ key: r.key, kind: r.kind, frame: r.frame, level: r.level, Z: r.Z, i: r.i, j: r.j });
function paper(E) {
    const c = E.renderer._paperRgb, out = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    for (let p = 0; p < out.length; p += 4) { out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255; }
    return out;
}
/** Cell `r` rendered from a fresh snapshot of its frame over `rect` (default the cell), the prefetch's off-camera path: RGBA, or null. */
function truth(E, r, rect = cellRect(r)) {
    const snap = E.stage.snapshot(r.frame, rect);
    if (!snap) return null;
    const R0 = E.renderer, list = snap.items().filter((it) => !it.pending);
    const packed = packJob(list, { plates: Int32Array.of(r.i, r.j), Zq: r.Z, dpr: R0.pyramid.dpr, cfg: R0.cfg, paper: R0._paperRgb, G: snap.generation });
    if (!(packed.nItems > 0)) return paper(E);
    const out = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    renderPlate(packed, 0, out, new Uint32Array(8));
    return out;
}
const same = (a, b, k) => a[k] === b[k] && a[k + 1] === b[k + 1] && a[k + 2] === b[k + 2];
/**
 * Plate pixels of cell `r` within the seam pad of a cache square's edge, where two squares' pieces overlap: a table that
 * reads both squares (a window touching the edge) and one that reads one draw a pixel there differently.
 */
function seamMask(E, r) {
    const m = new Uint8Array(PLATE_PX * PLATE_PX), g = seamPadFor(E.renderer.cfg) + 2 / r.Z, ox = r.i * PLATE_PX, oy = r.j * PLATE_PX;
    const near = (v) => { const s = (Math.round(v / TILE - 0.5) + 0.5) * TILE; return Math.abs(v - s) <= g; };
    const cols = new Uint8Array(PLATE_PX), rows = new Uint8Array(PLATE_PX);
    for (let p = 0; p < PLATE_PX; p++) { cols[p] = near((ox + p + 0.5) / r.Z) ? 1 : 0; rows[p] = near((oy + p + 0.5) / r.Z) ? 1 : 0; }
    let any = false;
    for (let y = 0; y < PLATE_PX; y++) for (let x = 0; x < PLATE_PX; x++) if (cols[x] || rows[y]) { m[y * PLATE_PX + x] = 1; any = true; }
    return any ? m : null;
}
/** Pixels of `a` not `b`'s, outside `mask`. */
function differs(a, b, mask = null) {
    let n = 0;
    for (let k = 0; k < a.length; k += 4) if (!same(a, b, k) && !(mask && mask[k >> 2])) n++;
    return n;
}
function firstDiff(a, b, mask = null) {
    for (let k = 0; k < a.length; k += 4) {
        if (!same(a, b, k) && !(mask && mask[k >> 2])) { const q = k / 4; return `(${q % PLATE_PX},${Math.floor(q / PLATE_PX)}) ${Array.from(a.subarray(k, k + 3))} vs ${Array.from(b.subarray(k, k + 3))}`; }
    }
    return "";
}
/** Every record the store calls exact whose pixels are not its cell's truth, away from the cache squares' seams (the plane's own are the plane's). */
function falseExact(E) {
    const bad = [];
    let n = 0;
    for (const r of [...E.plates.records()]) {
        if (r.kind === "plane" || !E.plates.exact(r)) continue;
        const t = truth(E, r);
        if (!t) continue;
        n++;
        const px = r.pixels || paper(E), mask = seamMask(E, r), d = differs(px, t, mask);
        if (d) bad.push(`${r.kind} ${r.frame} l${r.level} Z${+r.Z.toFixed(3)} (${r.i},${r.j}) G${r.G}/${E.stage.generation}: ${d} px, ${firstDiff(px, t, mask)}`);
    }
    return { bad, checked: n };
}

/** Every exact plate's cell truth now, by key. */
function truths(E) {
    const m = new Map();
    for (const r of [...E.plates.records()]) if (r.kind !== "plane" && E.plates.exact(r)) { const t = truth(E, r); if (t) m.set(r.key, t); }
    return m;
}
/**
 * The plates exact from before G — a gesture after G left them — whose cells' truth differs from `was`: the same route both
 * sides, so nothing is masked, seams included. A difference is a change the dirt missed, drawn stale.
 */
function staleLeft(E, was, G) {
    const bad = [];
    let left = 0;
    for (const r of [...E.plates.records()]) {
        if (r.kind === "plane" || !E.plates.exact(r) || r.G > G || !was.has(r.key)) continue;
        const t = truth(E, r);
        if (!t) continue;
        left++;
        const d = differs(was.get(r.key), t);
        if (d) bad.push(`${r.kind} ${r.frame} l${r.level} Z${+r.Z.toFixed(3)} (${r.i},${r.j}) G${r.G}: ${d} px, ${firstDiff(was.get(r.key), t)}`);
    }
    return { bad, left };
}

// ---- the gesture ----

/** The selection made and its plane aimed (it waits for a quiet view, PLANE_QUIET_MS). */
async function select(E, ids) {
    E.setTool("select");
    E._setSelection(ids, []);
    E._render();
    const R0 = E.renderer;
    await sleep(200);
    for (let t = 0; t < 3000 && !R0.forcePerStepDrag && (R0._planeTimer != null || !R0._plane.tags.length); t += 10) await sleep(10);
    await settle(E);
}
/** A drag of (dx, dy) screen px from the centre in `steps`, `mid()` awaited halfway, then the drop. Returns G before the drop. */
async function dragDrop(E, dx, dy, { steps = 8, mid = null } = {}) {
    const sx = 400, sy = 300;
    E._dragSel = { start: [sx, sy], moved: false };
    E._beginHold();
    await flush(E);                                        // the plane's plates land: the drag is drawn whole
    for (let k = 1; k <= steps; k++) {
        E._dragSelection(sx + (dx * k) / steps, sy + (dy * k) / steps);
        if (mid && k === steps >> 1) await mid();
    }
    const G0 = E.stage.generation;
    E._pointerUp();
    return G0;
}
/** Mid-drag, every plate of the camera's frame re-rendered — a crossing's render, a cut landing: packed without the held ink. */
const rerenderAll = (E) => async () => {
    const F = String(E.cam.frame);
    E.plates.dropFrames((f) => String(f) === F);
    E._render();
    await settle(E);
};

/** Sound after the drop, right after it and once every job landed. Returns how many plates the gesture left exact. */
async function soundAfterDrop(E, dx, dy, opts) {
    const pre = falseExact(E);
    expect(pre.bad).toEqual([]);                           // the stored plates are their cells' truth to begin with
    expect(pre.checked).toBeGreaterThanOrEqual(4);
    const was = truths(E), G = E.stage.generation;
    await dragDrop(E, dx, dy, opts);
    expect(falseExact(E).bad).toEqual([]);                 // right after the drop, before any job lands
    expect(staleLeft(E, was, G).bad).toEqual([]);          // what it left exact is unchanged, unmasked
    await settle(E);
    const post = falseExact(E);
    expect(post.bad).toEqual([]);                          // every job landed
    expect(post.checked).toBeGreaterThanOrEqual(4);
    const left = staleLeft(E, was, G);
    expect(left.bad).toEqual([]);
    return left.left;
}

// ---- the scenes ----

/**
 * One frame up, a huge opaque square whose left edge crosses the screen at x = −300 (camera units), the rest of the
 * screen inside it; near that edge a disc, a fill and a square in the camera's frame and a square homed a level down;
 * further right a square no test moves.
 */
function bigEdgeScene(E) {
    const { F, P } = camera(E);
    const big = addShape(E, P, box(rectIn(E, F, { left: -300, top: -60000, right: 60000, bottom: 60000 }, P)), "rgb(40,90,160)");
    const d = addShape(E, F, disc(-320, -60, 60), "rgb(200,40,40)");
    const f = addFill(E, F, [[-380, 120], [-270, 100], [-280, 220], [-370, 200]], "rgb(40,160,60)");
    const q = addShape(E, F, box({ left: 120, top: -200, right: 260, bottom: -80 }), "rgb(220,200,30)");
    const K = E.lm.cellChild(F, -11, 3);
    const c = E.lm.mapPointF([0, 0], K.id, F);
    const kid = addShape(E, K.id, box(rectIn(E, F, { left: c[0] - 12, top: c[1] - 12, right: c[0] + 12, bottom: c[1] + 12 }, K.id)), "rgb(120,40,160)");
    return { F, P, big, d, f, q, kid };
}

/** A seeded scene: squares and discs in the camera's frame, huge ones a frame up, small ones a level down. */
function randomScene(E, seed) {
    const rnd = rng(seed), { F, P } = camera(E);
    const col = () => `rgb(${(rnd() * 220) | 0},${(rnd() * 220) | 0},${(rnd() * 220) | 0})`;
    const out = [];
    const at = (w) => { const x = (rnd() - 0.5) * 900, y = (rnd() - 0.5) * 700; return { left: x, top: y, right: x + w * (0.5 + rnd()), bottom: y + w * (0.5 + rnd()) }; };
    for (let k = 0; k < 2; k++) {                          // huge, from the parent: an edge or a corner on screen
        const x = (rnd() - 0.5) * 700, y = (rnd() - 0.5) * 500, s = rnd() < 0.5 ? 1 : -1;
        const r = s > 0 ? { left: x, top: y, right: x + 80000, bottom: y + 80000 } : { left: x - 80000, top: y - 80000, right: x, bottom: y };
        out.push(addShape(E, P, box(rectIn(E, F, r, P)), col()));
    }
    for (let k = 0; k < 7; k++) {
        const r = at(40 + rnd() * 300);
        if (rnd() < 0.4) out.push(addShape(E, F, disc((r.left + r.right) / 2, (r.top + r.bottom) / 2, (r.right - r.left) / 2), col()));
        else if (rnd() < 0.5) out.push(addFill(E, F, [[r.left, r.top], [r.right, r.top + 10], [r.right - 15, r.bottom], [r.left + 5, r.bottom - 20]], col()));
        else out.push(addShape(E, F, box(r), col()));
    }
    for (let k = 0; k < 2; k++) {
        const K = E.lm.cellChild(F, Math.round((rnd() - 0.5) * 20), Math.round((rnd() - 0.5) * 16));
        const c = E.lm.mapPointF([0, 0], K.id, F);
        out.push(addShape(E, K.id, box(rectIn(E, F, { left: c[0] - 12, top: c[1] - 12, right: c[0] + 12, bottom: c[1] + 12 }, K.id)), col()));
    }
    return { rnd, natives: out, F };
}

describe("a drop's dirt is sound (F153)", () => {
    test("D1 the plane's drag: a huge square's edge, a disc, a fill and a deeper square dropped together", async () => {
        const E = mkEngine();
        const s = bigEdgeScene(E);
        E._render(); await settle(E);
        await select(E, [s.big.id, s.d.id, s.f.id, s.kid.id]);
        expect(await soundAfterDrop(E, 60, 40)).toBeGreaterThan(0);   // the unmasked check saw plates the drop left
    });

    test("D2 no plane: the view draws the held drag a render a step, then the drop", async () => {
        const E = mkEngine();
        E.renderer.forcePerStepDrag = true;
        const s = bigEdgeScene(E);
        E._render(); await settle(E);
        await select(E, [s.big.id, s.d.id, s.kid.id]);
        await soundAfterDrop(E, -50, 70);
    });

    test("D3 plates re-rendered mid-drag without the held ink do not outlive the drag", async () => {
        const E = mkEngine();
        const s = bigEdgeScene(E);
        E._render(); await settle(E);
        await select(E, [s.big.id, s.d.id]);
        await soundAfterDrop(E, 60, 40, { mid: rerenderAll(E) });
    });

    test("D4 a cancel after plates were re-rendered without the held ink: they go too", async () => {
        const E = mkEngine();
        const s = bigEdgeScene(E);
        E._render(); await settle(E);
        await select(E, [s.big.id]);
        const sx = 400, sy = 300;
        E._dragSel = { start: [sx, sy], moved: false };
        E._beginHold();
        await flush(E);
        for (let k = 1; k <= 4; k++) E._dragSelection(sx + 15 * k, sy);
        await rerenderAll(E)();
        E.cancelSelectGesture(false);
        expect(falseExact(E).bad).toEqual([]);
        await settle(E);
        expect(falseExact(E).bad).toEqual([]);
    });

    for (const seed of [11, 23, 37, 41, 53, 67]) {
        test(`D5 seed ${seed}: random natives, a random selection, delta and drag kind`, async () => {
            const E = mkEngine();
            const probe = rng(seed * 7919);
            const kind = ["plane", "plane+mid", "view"][Math.floor(probe() * 3)];
            if (kind === "view") E.renderer.forcePerStepDrag = true;
            const { rnd, natives } = randomScene(E, seed);
            E._render(); await settle(E);
            const ids = natives.filter(() => rnd() < 0.35).map((o) => o.id);
            if (!ids.length) ids.push(natives[0].id);
            await select(E, ids);
            const big = rnd() < 0.3, dx = (rnd() - 0.5) * (big ? 900 : 160), dy = (rnd() - 0.5) * (big ? 700 : 120);
            await soundAfterDrop(E, dx, dy, { mid: kind === "plane+mid" ? rerenderAll(E) : null });
        });
    }
});

describe("a drop's dirt is tight (F153)", () => {
    test("T1 a huge square's edge moved: the cells it covered before and after, away from its edges, keep their plates", async () => {
        const E = mkEngine();
        const s = bigEdgeScene(E);
        E._render(); await settle(E);
        await select(E, [s.big.id, s.d.id, s.f.id, s.kid.id]);
        const F = String(s.F), cells = [];
        for (const r of E.plates.records()) if (r.kind !== "plane" && String(r.frame) === F && E.plates.exact(r)) cells.push({ c: descr(r), px: truth(E, r) });
        const G0 = await dragDrop(E, 60, 40);
        // Everything moved lies left of x = −200 before and after: no cell from x = −150 on changes.
        const kept = [], dirtied = [];
        for (const { c, px } of cells) {
            if (cellRect(c).left < -150) continue;
            expect(differs(px, truth(E, c))).toBe(0);
            (E.stage.dirtySince(c.key) > G0 ? dirtied : kept).push(`${c.kind} l${c.level} (${c.i},${c.j})`);
        }
        expect(kept.length + dirtied.length).toBeGreaterThan(0);
        expect(dirtied).toEqual([]);                       // red with native boxes: the huge square's box dirties every cell
    });
});
