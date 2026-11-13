/**
 * RUN-E — the engine through runs of empty levels (compact-lattice design, stage 2): a scene whose empty levels are
 * folded gives what the same scene with a frame a level gives, bit for bit.
 */
import { mkEngine, useEngines, drawStroke, eraseGesture } from "./__testkit__/harness";
import { setRasterTransport, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import { cutJob, unwireJob, wireResult } from "./eraseJob";
import { descentJob, unwireDescent, wireDescentResult } from "./eraseDescent";

const later = (ms = 2) => new Promise((r) => setTimeout(r, ms));
// The worker, in-process: the same job functions, a tick later, the lattice rebuilt from the message.
const transport = (msg, transfer, kind) => later().then(() => {
    if (kind === "descent") { const { world, input } = unwireDescent(msg); return wireDescentResult(descentJob(world, input)).msg; }
    return wireResult(cutJob(unwireJob(msg))).msg;
});
async function settle(E, max = 80) {
    for (let i = 0; i < max && (E._eraseStrokes().length || E._eraseBusy()); i++) { E._bakeTick(); await later(4); }
    return E._eraseStrokes().length === 0 && !E._eraseBusy();
}
const natives = (E) => JSON.stringify(E.serializeDrawing().natives);
const frames = (E) => [...E.lm.frames.values()].map((f) => [f.id, f.parent, f.depth, f.cell.i, f.cell.j, f.run ? f.run.n : 0, f.private].join(" ")).sort();
const VIEW = { x: -400, y: -300, w: 800, h: 600 };   // a frame's origin at the screen's centre, 1:1

/** A fat stroke through level 0's origin; the camera at the spine frame `n` levels below, inside the stroke. */
function deep(n) {
    const E = mkEngine(800, 600);
    E.lm.bulkRuns = false;   // a frame a level, folded only where a test folds it
    E.jumpTo("0", VIEW);
    drawStroke(E, [[100, 300], [700, 300]], 60);
    expect(E.jumpTo(E.lm.ensureSpine(n), VIEW)).toBe(true);
    return E;
}
/** The empty spine frames between level 0 and `n` folded into the run of the frame at `n`; how many. */
function foldSpine(E, n) {
    let k = 0;
    for (let d = n - 1; d >= 1; d--) {
        const id = E.lm.spineAt(d);
        if (id != null && E.lm.fold(id, (x) => !(E.doc.at(x) || []).length)) k++;
    }
    return k;
}

/** The depth of the deepest ink. */
const deepest = (E) => Math.max(...E.doc.levels().filter((k) => E.doc.at(k).some((o) => !o.erase)).map((k) => E.lm.depthOf(k)));

describe("RUN-E1 — an erase far below the stroke it cuts", () => {
    useEngines();
    afterEach(() => { setRasterTransport(null); setRasterWorkerCount(null); });
    const N = 20;   // three jobs of DESCENT_LINKS crossings
    const erased = (fold) => {
        const E = deep(N);
        if (fold) expect(foldSpine(E, N)).toBe(N - 1);
        eraseGesture(E, [[400, 250], [400, 350]], 30);
        return E;
    };

    test("cedes through a run as through a frame a level: the same pieces, ids and frames", () => {
        const A = erased(false);
        A.flushErases();
        const B = erased(true);
        B.flushErases();
        expect(deepest(A)).toBe(N);   // the cut reached the mark's level
        expect(natives(B)).toBe(natives(A));
        expect(frames(B)).toEqual(frames(A));
    });

    // A job's copy is a fresh load, whose spine is rebuilt, so a later job names its private frames as the copy's spine
    // reads (not as the inline path's): the worker is compared with the worker.
    test("in the worker: the job's copy unfolds the levels it crosses, and they merge back under their ids", async () => {
        setRasterWorkerCount(3);
        setRasterTransport(transport);
        const out = [];
        for (const fold of [false, true]) {
            const E = erased(fold);
            E._scheduleBake = () => {};
            await later(150);   // the tick stays out of a moving camera's way
            expect(await settle(E)).toBe(true);
            out.push(E);
        }
        const [A, B] = out;
        expect(deepest(A)).toBe(N);
        expect(natives(B)).toBe(natives(A));
        expect(frames(B)).toEqual(frames(A));
    });
});

/** Fold every frame that can be (no natives in it), until none can. */
function foldAll(E) {
    const inked = new Set(E.doc.levels().filter((k) => E.doc.count(k)));
    let n = 0, more = true;
    while (more) {
        more = false;
        for (const id of [...E.lm.frames.keys()]) if (E.lm.frames.has(id) && E.lm.fold(id, (x) => !inked.has(x))) { n++; more = true; }
    }
    return n;
}
// Pieces as text, number for number (-0 kept; caches, keyed `_`, left out).
const piecesText = (objs) => JSON.stringify(objs, (k, v) => (k.charCodeAt(0) === 95 ? undefined : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : v));

describe("RUN-E2 — tiles through a run are the tiles through a frame a level", () => {
    useEngines();
    const L = 1500;
    /** Ink at level 0, the camera at the bottom of a chain L + 1 levels down; `fold`: its empty levels folded first. */
    function scene(fold, chainOf, strokes) {
        const E = mkEngine(800, 600);
        E.lm.bulkRuns = false;
        E.jumpTo("0", VIEW);
        for (const [pts, w] of strokes) drawStroke(E, pts, w);
        const X = chainOf(E);
        if (fold) { expect(foldAll(E)).toBeGreaterThan(L / 2); E.store.bumpEpoch(); }
        expect(E.jumpTo(X, VIEW)).toBe(true);
        return { E, X };
    }
    /** The bottom frame's tiles around it, and its chain's tiles (0, 0) at levels k above it (a run level's key in B), as text. */
    function tiles(E, X, A) {
        const out = [];
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(piecesText(E.store._ensureUp(X, i, j).objs));
        for (const k of [1, 2, 3, 7, 40, L - 1, L]) {
            const d = E.lm.frame(X).depth - k, key = A ? E.lm.pathFrameAt(X, d) : E.store._upAt(X, d);
            expect(E.store._depth(key)).toBe(d);
            out.push(piecesText(E.store._ensureUp(key, 0, 0).objs));
        }
        return out;
    }
    const check = (chainOf, strokes, more) => {
        const a = scene(false, chainOf, strokes), b = scene(true, chainOf, strokes);
        expect(b.E.lm.frames.size).toBeLessThan(40);
        const ta = tiles(a.E, a.X, true), tb = tiles(b.E, b.X, false);
        expect(tb).toEqual(ta);
        expect(ta.some((t) => t !== "[]")).toBe(true);                      // ink reaches the view
        const deepRun = [...b.E.store.cache.keys()].filter((k) => k.startsWith(b.X + "^")).length;
        expect(deepRun).toBeLessThan(120);                                   // not a tile a level
        // A stroke drawn at the top afterwards: the tiles patched or baked again are the per-level lattice's.
        for (const { E, X } of [a, b]) { E.jumpTo("0", VIEW); drawStroke(E, more[0], more[1]); E.jumpTo(X, VIEW); }
        expect(tiles(b.E, b.X, false)).toEqual(tiles(a.E, a.X, true));
        return b;
    };

    test("down the spine, an edge through its fixed point: the half-plane repeats, and so do the tiles", () => {
        const b = check((E) => E.lm.ensureSpine(L + 1), [[[[100, 270], [700, 270]], 60]], [[[300, 330], [300, 250]], 12]);
        expect(b.E.store._fix.has(b.X)).toBe(true);
    });

    test("down a run of a non-zero cell: an edge near its fixed point drifts off the view, as through the frames", () => {
        const chainOf = (E) => {
            let id = E.lm.cellChild("0", 7, 7).id;
            for (let k = 0; k < L; k++) id = E.lm.cellChild(id, 1638, 0).id;
            return id;
        };
        check(chainOf, [[[[646.8, 400], [646.8, 590]], 20], [[[500, 524.2], [700, 524.2]], 8]], [[[630, 500], [660, 540]], 10]);
    });
});
