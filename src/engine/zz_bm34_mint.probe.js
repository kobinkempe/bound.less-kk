// B-MODEL-C34 scratch probe (deleted before hand-back): which callers of `objShift` mint a frame, over the pair fuzz.
import LevelMap from "./LevelMap";
import { runPairFuzz, framesToCompare, comparePictures } from "./__testkit__/modelFuzz";

jest.setTimeout(3600000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const SEEDS = Number(process.env.MINT_SEEDS || 20);

test("objShift's minting callers", () => {
    const counts = {};
    const orig = LevelMap.prototype.objShift;
    LevelMap.prototype.objShift = function (below, home, F, mint = true) {
        if (!mint) return orig.call(this, below, home, F, false);
        const n0 = this.frames.size;
        const r = orig.call(this, below, home, F, true);
        if (this.frames.size > n0) {
            const st = new Error().stack.split("\n").slice(2, 7).map((s) => s.trim().replace(/^at /, "").replace(/ \(.*$/, "")).join(" < ");
            counts[st] = (counts[st] || 0) + (this.frames.size - n0);
        }
        return r;
    };
    try {
        for (const c34 of [false, true]) {
            for (let seed = 1; seed <= SEEDS; seed++) {
                const st = { tainted: new Map() };
                runPairFuzz(seed, 40, (O, N) => { for (const V of framesToCompare(O, N)) comparePictures(O, N, V, st, c34 ? 2 : 1); return true; }, { c34 });
            }
        }
    } finally { LevelMap.prototype.objShift = orig; }
    log("MINT " + JSON.stringify(counts, null, 1));
});
