/**
 * Spec tests for auto-scenes v2 — docs/auto-scenes-design-bible.md.
 * Distances are width-relative: for width w, window = 600w and the join
 * distance is 900w (1.5 windows of the coarser stroke).
 */
import {
    computeSceneProposals, matchScenes, splitMembers, resolveCapture,
    chunksOf, levelHash, rectIoU,
    WINDOW_WIDTHS, JOIN_WINDOWS,
} from "./scenes";
import { encodeDrawing, decodeDrawing } from "./persist";

let nextId = 1;
const stroke = (pts, lw = 1) => ({ type: "stroke", id: nextId++, pts, lwFrame: lw });
const dot = (x, y, lw = 1) => stroke([[x, y], [x + lw, y]], lw);
const blob = (x, y, lw = 1) => [dot(x, y, lw), dot(x + 20 * lw, y + 20 * lw, lw), dot(x - 20 * lw, y + 10 * lw, lw)];

beforeEach(() => { nextId = 1; });

// Identity projector: adjacent levels related by pure scale `f` per step
// (t = 0) — enough to exercise stitching without a LevelMap.
const projScale = (f) => ({
    widthFactor: (from, to) => Math.pow(f, from - to),
    mapRect: (r, from, to) => {
        const k = Math.pow(f, from - to);
        return { left: r.left * k, top: r.top * k, right: r.right * k, bottom: r.bottom * k };
    },
});
const proj = projScale(1 / 3000); // one level deeper = ×3000 finer
const JOIN = JOIN_WINDOWS * WINDOW_WIDTHS; // 900 × w

describe("join rule — width-relative distances", () => {
    test("ink within 1.5 windows of the coarser stroke is one scene", () => {
        const g = { 0: [...blob(0, 0), ...blob(JOIN - 100, 0)] };
        expect(computeSceneProposals(g, proj)).toHaveLength(1);
    });
    test("ink beyond the join distance splits", () => {
        const g = { 0: [...blob(0, 0), ...blob(3 * JOIN, 0)] };
        expect(computeSceneProposals(g, proj)).toHaveLength(2);
    });
    test("fine detail near coarse ink joins the coarse composition (and pockets)", () => {
        // coarse picture (w=10) + a tiny w=0.01 doodle 500 units away:
        // 500 ≪ 900×10, so it joins via the coarser stroke's window — AND,
        // being ≥16× finer and tiny, it also surfaces as a nested pocket.
        const tiny = dot(500, 0, 0.01);
        const g = { 0: [...blob(0, 0, 10), tiny] };
        const scenes = computeSceneProposals(g, proj);
        const top = scenes.filter((s) => s.depth === 0);
        expect(top).toHaveLength(1);
        expect(top[0].memberIds).toContain(tiny.id);
        const pocket = scenes.find((s) => s.depth === 1);
        expect(pocket && pocket.memberIds).toEqual([tiny.id]);
    });
    test("no minimum: a lone dot is a scene", () => {
        expect(computeSceneProposals({ 0: [dot(0, 0, 0.5)] }, proj)).toHaveLength(1);
    });
});

describe("chunking — long strokes can't capture corner bystanders", () => {
    test("a long diagonal is chunked into ≤1-window pieces", () => {
        const pts = [];
        for (let i = 0; i <= 100; i++) pts.push([i * 50, i * 50]); // 5000 long, w=1 → window 600
        const chunks = chunksOf(stroke(pts, 1));
        expect(chunks.length).toBeGreaterThan(5);
        for (const c of chunks) {
            expect(c.x1 - c.x0).toBeLessThanOrEqual(WINDOW_WIDTHS + 100);
            expect(c.y1 - c.y0).toBeLessThanOrEqual(WINDOW_WIDTHS + 100);
        }
    });
    test("a small blob in the diagonal's empty bbox corner stays separate", () => {
        const pts = [];
        for (let i = 0; i <= 100; i++) pts.push([i * 100, i * 100]); // 10000-long diagonal
        const diag = stroke(pts, 1);
        // corner (9000, 1000): far from the diagonal's INK (~5600 away) but
        // well inside its whole bbox.
        const g = { 0: [diag, ...blob(9000, 1000, 1)] };
        expect(computeSceneProposals(g, proj)).toHaveLength(2);
    });
});

describe("adjacent-level stitch — levels are not boundaries", () => {
    test("ink straddling a crossing is one scene", () => {
        // Coarse mark at level 0 (w=1 at origin); level-1 marks that project
        // to the same spot with comparable width (w=3000 in level-1 units →
        // w=1 in level-0 units).
        const g = { 0: [dot(0, 0, 1)], 1: [dot(100 * 3000, 0, 3000), dot(200 * 3000, 0, 3000)] };
        const scenes = computeSceneProposals(g, proj);
        expect(scenes).toHaveLength(1);
        expect(scenes[0].memberIds).toHaveLength(3);
        expect(scenes[0].level).toBe(0); // anchored at the coarsest level
    });
    test("deep unrelated ink does not stitch", () => {
        // Level-1 ink drawn at normal level-1 widths (w≈1) far from any
        // level-0 ink footprint.
        const g = { 0: [...blob(0, 0, 1)], 1: [...blob(5e6, 5e6, 1)] };
        expect(computeSceneProposals(g, proj)).toHaveLength(2);
    });
});

describe("pockets — nested scenes with no minimum", () => {
    test("a tiny one-stroke picture inside a big drawing becomes a nested scene", () => {
        const parent = [...blob(0, 0, 10), ...blob(2000, 0, 10)];
        const tiny = dot(1000, 0, 0.05); // 200× finer, extent ≪ parent/50
        const scenes = computeSceneProposals({ 0: [...parent, tiny] }, proj);
        expect(scenes).toHaveLength(2);
        const pocket = scenes.find((s) => s.depth === 1);
        expect(pocket).toBeTruthy();
        expect(pocket.memberIds).toEqual([tiny.id]);
        expect(pocket.parentIndex).toBe(scenes.indexOf(scenes.find((s) => s.depth === 0)));
    });
    test("cascading intermediate marks cannot hide a deep pocket", () => {
        const parent = [...blob(0, 0, 10)];
        const cascade = [dot(300, 0, 2), dot(600, 0, 0.9)]; // 5×, 11× finer: neither chunk-fine nor pocket-fine
        const deep = [dot(650, 0, 0.02), dot(651, 0, 0.02)]; // 500× finer
        const scenes = computeSceneProposals({ 0: [...parent, ...cascade, ...deep] }, proj);
        const pocket = scenes.find((s) => s.depth === 1);
        expect(pocket).toBeTruthy();
        expect(pocket.memberIds.sort()).toEqual(deep.map((d) => d.id).sort());
    });
    test("detail too large relative to its parent is not a pocket", () => {
        const parent = [...blob(0, 0, 10), ...blob(3000, 0, 10)];
        // 20× finer, mutually joined (gap 400 < 900×0.5), but their cluster
        // spans ~400 units > parentExtent/50 → stays merged, no pocket.
        const wide = [dot(500, 0, 0.5), dot(900, 0, 0.5)];
        const scenes = computeSceneProposals({ 0: [...parent, ...wide] }, proj);
        expect(scenes.filter((s) => s.depth > 0)).toHaveLength(0);
    });
});

describe("frames and primary", () => {
    test("wispy outliers don't blow up the frame (90% ink core)", () => {
        const dense = [];
        for (let i = 0; i < 60; i++) dense.push(stroke([[i * 5, 0], [i * 5 + 8, 8]], 1));
        const wisp = stroke([[300, 0], [1290, 0]], 0.05); // long but LIGHT wisp (low ink mass)
        const scenes = computeSceneProposals({ 0: [...dense, wisp] }, proj);
        expect(scenes.filter((s) => s.depth === 0)).toHaveLength(1);
        // frame stays near the dense mass, not the wisp's far end
        expect(scenes[0].rect.x + scenes[0].rect.w).toBeLessThan(1100);
    });
    test("primary (largest size) sorts first", () => {
        const big = [];
        for (let i = 0; i < 12; i++) big.push(stroke([[i * 30, 0], [i * 30 + 25, 25]], 1));
        const small = blob(3 * JOIN, 3 * JOIN, 1);
        const scenes = computeSceneProposals({ 0: [...big, ...small] }, proj);
        expect(scenes[0].memberIds.length).toBe(12);
        expect(scenes[0].size).toBeGreaterThan(scenes[1].size);
    });
});

describe("matchScenes — identity, suppression, v1 cover relic", () => {
    const state0 = { scenes: [], hidden: [], seq: 1 };
    test("ids persist across a nudge; v1 'cover' entries are dropped", () => {
        const g = { 0: [...blob(0, 0), ...blob(3 * JOIN, 0)] };
        const r1 = matchScenes(state0, computeSceneProposals(g, proj), proj);
        expect(r1.scenes.some((s) => s.id === "cover")).toBe(false);
        r1.scenes[0].name = "Main"; r1.scenes[0].pinned = true;
        const g2 = { 0: [...blob(15, 10), ...blob(3 * JOIN, 0)] };
        nextId = 1; // same ids for the nudged drawing
        const r2 = matchScenes(
            { ...r1, scenes: [{ id: "cover", name: "Overview", level: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }, ...r1.scenes] },
            computeSceneProposals(g2, proj), proj,
        );
        expect(r2.scenes.some((s) => s.id === "cover")).toBe(false);
        expect(r2.scenes.find((s) => s.name === "Main")).toBeTruthy();
    });
    test("deleted scenes stay suppressed; pinned survive ink loss", () => {
        const g = { 0: [...blob(0, 0), ...blob(3 * JOIN, 0)] };
        const r1 = matchScenes(state0, computeSceneProposals(g, proj), proj);
        const [a, b] = r1.scenes;
        const afterDelete = {
            scenes: r1.scenes.filter((s) => s.id !== a.id),
            hidden: [{ level: a.level, rect: a.rect }],
            seq: r1.seq,
        };
        const r2 = matchScenes(afterDelete, computeSceneProposals(g, proj), proj);
        expect(r2.scenes.find((s) => rectIoU(s.rect, a.rect) > 0.5)).toBeUndefined();
        expect(r2.scenes.find((s) => s.id === b.id)).toBeTruthy();
        const pinnedB = { ...r2, scenes: r2.scenes.map((s) => ({ ...s, pinned: true })) };
        const r3 = matchScenes(pinnedB, [], proj);
        expect(r3.scenes.find((s) => s.id === b.id)).toBeTruthy();
    });
});

describe("capture resolution", () => {
    const scene = { id: "s1", name: "Pic", level: 0, rect: { x: 0, y: 0, w: 100, h: 100 } };
    test("a zoomed-out reframe of the same picture retargets it", () => {
        const view = { level: 0, rect: { x: -25, y: -25, w: 150, h: 150 } };
        expect(resolveCapture(view, [scene], proj)).toBe(scene);
    });
    test("a view elsewhere creates a new scene", () => {
        const view = { level: 0, rect: { x: 500, y: 500, w: 100, h: 100 } };
        expect(resolveCapture(view, [scene], proj)).toBeNull();
    });
    test("a much deeper zoom does not retarget", () => {
        const view = { level: 0, rect: { x: 40, y: 40, w: 10, h: 10 } };
        expect(resolveCapture(view, [scene], proj)).toBeNull();
    });
});

describe("manual split", () => {
    test("two sub-groups joined only by the full gap split at half gap", () => {
        // gap 800 (< 900 joins; > 450 splits)
        const g = [...blob(0, 0), ...blob(800, 0)];
        const scenes = computeSceneProposals({ 0: g }, proj);
        expect(scenes).toHaveLength(1);
        const parts = splitMembers(g.map((o) => ({ o, level: 0 })), 0, proj);
        expect(parts).toHaveLength(2);
    });
});

describe("level hash — the incremental gate", () => {
    test("hash changes only when a level's ink changes", () => {
        const g = { 0: blob(0, 0), 1: blob(0, 0) };
        const h0 = levelHash(g, 0);
        g[1].push(dot(50, 50));
        expect(levelHash(g, 0)).toBe(h0);
        g[0][0].pts.push([9, 9]);
        delete g[0][0]._sceneChunks; delete g[0][0]._bbox;
        expect(levelHash(g, 0)).not.toBe(h0);
    });
});

describe("persist round-trip (v2 fields)", () => {
    const sampleParts = () => ({
        camera: { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 },
        crossings: {},
        natives: { 0: [{ type: "stroke", id: 1, pts: [[0, 0]], lwFrame: 1 }] },
    });
    test("depth, parent and captured survive encode/decode", () => {
        const scenes = [
            { id: "s1", name: "Pic", level: 0, rect: { x: 0, y: 0, w: 10, h: 10 }, pinned: true, auto: false, captured: true, depth: 0 },
            { id: "s2", name: "Detail", level: 2, rect: { x: 1, y: 1, w: 2, h: 2 }, pinned: false, auto: true, depth: 1, parent: "s1", hash: "h" },
        ];
        const doc = encodeDrawing({ ...sampleParts(), meta: { name: "n", scenes, sceneSeq: 3 } });
        const d = decodeDrawing(doc);
        expect(d.meta.scenes).toEqual(scenes);
        expect(d.meta.sceneSeq).toBe(3);
    });
});
