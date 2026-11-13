/**
 * OPEN-FLAGS F193: `_mapped` (the same picture from another frame's level, the plan's rule b and the coarser
 * search's twin) skips a frame whose level records do not span the level the cell maps to there, known from the
 * depths, before `mapCell` walks the path to it. Its answers are the walk over every frame's, and it walks to no
 * frame more than a crossing away when the far frames hold only their own levels.
 */
import LevelMap from "../LevelMap";
import { ENTER, BASE, EXIT } from "../frameLattice";
import PyramidStore, { levelCell, PLATE_BYTES } from "./PyramidStore";
import PicturePyramid from "./PicturePyramid";
import { levelKey, mapCell, ownFloor } from "./level";
import { fakeStage } from "../__testkit__/fakeStage";
import { lcg } from "../__testkit__/rasterLists";

const S = 1, DEPTH = 60, PX = new Uint8ClampedArray(16);

function world() {
    const lm = new LevelMap({ enter: ENTER, base: BASE, exit: EXIT }, 1024, 768);
    lm.ensureSpine(0);
    const chain = ["0"];
    for (let d = 1; d <= DEPTH; d++) chain.push(lm.cellChild(chain[d - 1], (d * 7) % 11 - 5, (d * 3) % 13 - 6).id);
    const stage = fakeStage();
    const store = new PyramidStore({ fresh: stage, maxBytes: 100000 * PLATE_BYTES, phone: false, doc: null });
    const pyr = new PicturePyramid(null, { store, stage, lm, cfg: { levelStep: S }, width: 1024, height: 768, dpr: 1, pixels: false,
        setTimer: () => null, clearTimer: () => {} });
    const put = (F, l, i, j) => store.put({ ...levelCell(F, l, S, i, j), G: 1, pixels: PX, bytes: PLATE_BYTES, jobId: null });
    return { lm, chain, store, pyr, put };
}

/** The rule as it stood: every frame holding level records, each through `mapCell`. */
function walkAll(t, F, l, i, j) {
    for (const H of t.store.framesWithLevels()) {
        if (H === F) continue;
        const m = mapCell(t.lm, S, F, l, i, j, H);
        if (!m || typeof m.i !== "number" || typeof m.j !== "number") continue;
        const r = t.store.get(levelKey(H, m.level, S, m.i, m.j));
        if (r && t.store.exact(r)) return r;
    }
    return null;
}

test("F193 the same answers as the walk over every frame, on random plates down a 60-level chain", () => {
    const t = world(), rnd = lcg(193), floor = ownFloor(S);
    const pick = (n) => Math.floor(rnd() * n);
    // Each frame holds plates at its own levels (the floor to 13); some are a twin of a nearby frame's cell.
    const twins = [];
    for (let d = 0; d <= DEPTH; d++) {
        for (let k = 0; k < 6; k++) t.put(t.chain[d], floor + pick(22), pick(64) - 32, pick(64) - 32);
        if (d > 0) {
            const F = t.chain[d], l = pick(2), i = pick(8), j = pick(8);
            const m = mapCell(t.lm, S, F, l, i, j, t.chain[d - 1]);      // the parent's twin of F's cell
            if (m && typeof m.i === "number") { t.put(t.chain[d - 1], m.level, m.i, m.j); twins.push([F, l, i, j]); }
        }
    }
    expect(twins.length).toBeGreaterThan(40);
    let hits = 0, n = 0;
    const queries = [...twins, ...Array.from({ length: 300 }, () => [t.chain[pick(DEPTH + 1)], floor + pick(22), pick(16) - 8, pick(16) - 8])];
    for (const [F, l, i, j] of queries) {
        const want = walkAll(t, F, l, i, j), got = t.pyr._mapped(F, l, S, i, j);
        expect([F, l, i, j, got && got.key]).toEqual([F, l, i, j, want && want.key]);
        if (want) hits++;
        n++;
    }
    expect(hits).toBeGreaterThanOrEqual(twins.length);              // every twin is found
    expect(n).toBe(queries.length);
});

test("F193 no path is walked to a frame more than one crossing away", () => {
    const t = world();
    for (let d = 0; d <= DEPTH; d++) for (let l = -8; l <= 13; l += 3) t.put(t.chain[d], l, 0, 0);
    const walked = [];
    const framePath = t.lm.framePath.bind(t.lm);
    t.lm.framePath = (a, b) => { walked.push(Math.abs(t.lm.depthOf(a) - t.lm.depthOf(b))); return framePath(a, b); };
    for (let l = -8; l <= 13; l++) t.pyr._mapped(t.chain[DEPTH], l, S, 1, 1);
    expect(walked.length).toBeGreaterThan(0);
    expect(Math.max(...walked)).toBeLessThanOrEqual(1);
});
