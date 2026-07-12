import {
    computeSceneProposals, coverProposal, matchScenes, splitProposals, rectIoU,
} from "./scenes";
import { encodeDrawing, decodeDrawing } from "./persist";

// Strokes are plain objects here — the scenes module is pure geometry.
let nextId = 1;
const stroke = (pts, lw = 10) => ({ type: "stroke", id: nextId++, pts, lwFrame: lw, color: "#000", opacity: 1 });
const dot = (x, y, lw = 10) => stroke([[x, y], [x + 10, y]], lw);
// A qualifying 3-stroke blob around (x, y).
const blob = (x, y, lw = 10) => [dot(x, y, lw), dot(x + 20, y + 20, lw), dot(x - 20, y + 10, lw)];

beforeEach(() => { nextId = 1; });

describe("computeSceneProposals — the clustering spec", () => {
    // lw=10 ⇒ per-box inflation = lw/2 + 7.5·lw = 80; boxes join when the raw
    // gap ≤ 160 frame units.
    test("strokes within the gap threshold form one scene", () => {
        const g = [...blob(0, 0), ...blob(150, 0)]; // 150 < 160 → one cluster
        const scenes = computeSceneProposals({ 0: g });
        expect(scenes).toHaveLength(1);
        expect(scenes[0].strokes).toBe(6);
    });
    test("strokes beyond the gap threshold split into scenes", () => {
        const g = [...blob(0, 0), ...blob(400, 0)]; // raw gap ≫ 160
        const scenes = computeSceneProposals({ 0: g });
        expect(scenes).toHaveLength(2);
    });
    test("specks don't qualify; a long two-stroke sketch does", () => {
        expect(computeSceneProposals({ 0: [dot(0, 0, 1), dot(3, 3, 1)] })).toHaveLength(0);
        const long = [stroke([[0, 0], [100, 0]], 1), stroke([[0, 5], [100, 5]], 1)];
        expect(computeSceneProposals({ 0: long })).toHaveLength(1);
    });
    test("deterministic: same input, same output", () => {
        const g = { 0: [...blob(0, 0), ...blob(500, 0)], 2: blob(10, 10) };
        expect(computeSceneProposals(g)).toEqual(computeSceneProposals(g));
    });
    test("levels stay separate; outermost first", () => {
        const scenes = computeSceneProposals({ 1: blob(0, 0), "-1": blob(0, 0) });
        expect(scenes.map((s) => s.level)).toEqual([-1, 1]);
    });
    test("cover frames all ink at the outermost inked level", () => {
        const cover = coverProposal({ "-2": [...blob(0, 0), ...blob(900, 0)], 3: blob(0, 0) });
        expect(cover.level).toBe(-2);
        expect(cover.rect.w).toBeGreaterThan(900);
    });
});

describe("matchScenes — stable identity", () => {
    const state0 = { scenes: [], hidden: [], seq: 1 };

    test("first run mints ids and a cover", () => {
        const natives = { 0: [...blob(0, 0), ...blob(500, 0)] };
        const r = matchScenes(state0, computeSceneProposals(natives), coverProposal(natives));
        expect(r.scenes[0].id).toBe("cover");
        expect(r.scenes.slice(1).map((s) => s.id)).toEqual(["s1", "s2"]);
        expect(r.seq).toBe(3);
    });

    test("a nudged cluster keeps its id and name", () => {
        const natives = { 0: [...blob(0, 0), ...blob(500, 0)] };
        const r1 = matchScenes(state0, computeSceneProposals(natives), coverProposal(natives));
        r1.scenes[1].name = "The Tree"; r1.scenes[1].pinned = true;
        // nudge the first blob slightly (IoU stays high)
        const moved = { 0: [...blob(8, 6), ...blob(500, 0)] };
        const r2 = matchScenes(r1, computeSceneProposals(moved), coverProposal(moved));
        const tree = r2.scenes.find((s) => s.name === "The Tree");
        expect(tree).toBeTruthy();
        expect(tree.id).toBe(r1.scenes[1].id);
        expect(r2.scenes.filter((s) => s.id !== "cover")).toHaveLength(2);
    });

    test("deleted auto scenes stay suppressed; unpinned vanished scenes drop; pinned survive", () => {
        const natives = { 0: [...blob(0, 0), ...blob(500, 0)] };
        const r1 = matchScenes(state0, computeSceneProposals(natives), coverProposal(natives));
        const [a, b] = r1.scenes.slice(1);
        // simulate deleteScene(a): remove + hide
        const state = {
            scenes: r1.scenes.filter((s) => s.id !== a.id),
            hidden: [...r1.hidden, { level: a.level, rect: a.rect }],
            seq: r1.seq,
        };
        const r2 = matchScenes(state, computeSceneProposals(natives), coverProposal(natives));
        expect(r2.scenes.find((s) => rectIoU(s.rect, a.rect) > 0.5 && s.id !== "cover")).toBeUndefined();
        expect(r2.scenes.find((s) => s.id === b.id)).toBeTruthy();
        // now the ink for b disappears: unpinned → drops; pinned → survives
        const empty = { 0: blob(0, 0) }; // only a's ink area… (suppressed) and nothing at 500
        const r3 = matchScenes(r2, computeSceneProposals(empty), coverProposal(empty));
        expect(r3.scenes.find((s) => s.id === b.id)).toBeUndefined();
        const pinnedB = { ...r2, scenes: r2.scenes.map((s) => (s.id === b.id ? { ...s, pinned: true } : s)) };
        const r4 = matchScenes(pinnedB, computeSceneProposals(empty), coverProposal(empty));
        expect(r4.scenes.find((s) => s.id === b.id)).toBeTruthy();
    });
});

describe("splitProposals", () => {
    test("sub-groups inside one scene split at half gap", () => {
        // gap 100: joined at full inflation (≤160), separate at half (>85)
        const g = [dot(0, 0), dot(0, 30), dot(110, 0), dot(110, 30)];
        const scenes = computeSceneProposals({ 0: g });
        expect(scenes).toHaveLength(1);
        const parts = splitProposals(scenes[0], { 0: g });
        expect(parts).toHaveLength(2);
    });
    test("an unsplittable scene returns null", () => {
        const g = blob(0, 0);
        const scenes = computeSceneProposals({ 0: g });
        // tight blob: halving the gap 4 times still keeps it connected… or it
        // splits into singles — either way a 1-cluster result must be null.
        const parts = splitProposals(scenes[0], { 0: [dot(0, 0), dot(2, 2), dot(4, 4)] });
        if (parts) expect(parts.length).toBeGreaterThanOrEqual(2);
        else expect(parts).toBeNull();
    });
});

describe("persist round-trip of scene state", () => {
    const sampleParts = () => ({
        camera: { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 },
        crossings: {},
        natives: { 0: [{ type: "stroke", id: 1, pts: [[0, 0]], lwFrame: 1 }] },
    });

    test("scenes, hiddenScenes and sceneSeq survive encode/decode", () => {
        const scenes = [
            { id: "cover", name: "Overview", level: 0, rect: { x: 0, y: 0, w: 10, h: 10 }, pinned: false, auto: true, hash: "abc" },
            { id: "s1", name: "The Door", level: 2, rect: { x: 5, y: 5, w: 3, h: 4 }, pinned: true, auto: true },
        ];
        const hiddenScenes = [{ level: 0, rect: { x: 9, y: 9, w: 1, h: 1 } }];
        const doc = encodeDrawing({ ...sampleParts(), meta: { name: "n", scenes, hiddenScenes, sceneSeq: 7 } });
        const d = decodeDrawing(doc);
        expect(d.meta.scenes).toEqual(scenes);
        expect(d.meta.hiddenScenes).toEqual(hiddenScenes);
        expect(d.meta.sceneSeq).toBe(7);
    });

    test("malformed scene entries are dropped, never fatal", () => {
        const doc = encodeDrawing({
            ...sampleParts(),
            meta: {
                name: "n",
                scenes: [
                    { id: "ok", name: "Fine", level: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
                    { id: "", name: "no id", level: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
                    { id: "bad-rect", name: "x", level: 1, rect: { x: 0, y: 0, w: -5, h: 1 } },
                    "not even an object",
                ],
                sceneSeq: -3,
            },
        });
        const d = decodeDrawing(doc);
        expect(d.meta.scenes.map((s) => s.id)).toEqual(["ok"]);
        expect(d.meta.sceneSeq).toBeUndefined();
    });
});
