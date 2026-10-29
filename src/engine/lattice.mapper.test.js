/**
 * lattice.mapper.test.js — `LevelMap.mapperObj` (OPEN-FLAGS F153), the drop footprint's many-point map: for every pair
 * of frames, picture table and direction it gives `mapPointObj`'s answer bit for bit, null where that is null.
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT, W } from "./frameLattice";
import { addOffset } from "./geometry/offsets";

function lattice() {
    const lm = new LevelMap({ enter: ENTER, base: BASE, exit: EXIT }, 1600, 1000);
    lm.ensureSpine(3);
    const ids = ["0", lm.spineAt(1), lm.spineAt(2), lm.spineAt(3)].map(String);
    const k1 = lm.cellChild(lm.spineAt(1), 7, -3), k2 = lm.cellChild(k1.id, -2, 5), n1 = lm.neighbour(lm.spineAt(2), 1, 0);
    ids.push(String(k1.id), String(k2.id), String(n1.id));
    return { lm, ids };
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test("mapperObj is mapPointObj, bit for bit, over frames, tables and both directions", () => {
    const { lm, ids } = lattice(), rnd = rng(7);
    const tables = [undefined, addOffset(undefined, 0, 37.5, -12.25).below, addOffset(undefined, 1, 9000.125, 51.5).below,
        addOffset(addOffset(undefined, 2, -70000, 3e4).below, 0, 0.5, 0.25).below];
    let n = 0, nulls = 0;
    for (const home of ids) {
        for (const to of ids) {
            for (const below of tables) {
                for (const toHome of [false, true]) {
                    for (const [from, dst] of [[home, to], [to, home]]) {
                        const m = lm.mapperObj(from, dst, below, home, toHome);
                        for (let k = 0; k < 6; k++) {
                            const p = [(rnd() - 0.5) * W * 1.4, (rnd() - 0.5) * W * 1.4];
                            const want = lm.mapPointObj(p, from, dst, below, home, toHome);
                            if (!want) { expect(m).toBeNull(); nulls++; break; }
                            expect(m(p[0], p[1], [0, 0])).toEqual(want);
                            n++;
                        }
                    }
                }
            }
        }
    }
    expect(n).toBeGreaterThan(1000);
    expect(nulls).toBeLessThan(n);
});
