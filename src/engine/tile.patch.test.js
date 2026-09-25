/**
 * TB-1: a native added above a cached chained up tile is patched into it from its parent squares'
 * pieces, not dropped with it. Every cached tile must equal the same tile baked cold by a fresh
 * store over the same document, after adds at an ancestor, at a ring neighbour of one, below the
 * view, and after cuts and removals.
 */
import LevelMap from "./LevelMap";
import Document from "./Document";
import TileStore from "./TileStore";
import { BASE, ENTER, EXIT, HALF_W } from "./frameLattice";
import { rectLoop, normalizeLoops } from "./geometry/arcShape";
import { circleLoop } from "./geometry/antRuns";

const CFG = { enter: ENTER, base: BASE, exit: EXIT, bufferScreens: 1, scale: 1000,
    arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, lineModeLevel: 2 };
const win = () => ({ left: -HALF_W, top: -HALF_W, right: HALF_W, bottom: HALF_W });

let stores = [];
const mkStore = (M, d) => { const s = new TileStore(M, d, CFG); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop().destroy(); });

// A piece as comparable text: Loops by their numbers, memos (`_bbox`) left out.
const norm = (objs) => objs.map((p) => JSON.stringify(p, (k, v) => (k[0] === "_" ? undefined : v && v.buf && v.idx ? Array.from(v.buf) : v))).sort();

function world() {
    const M = new LevelMap(CFG, 800, 600);
    M.ensureSpine(-3); M.ensureSpine(0);
    const d = new Document();
    const at = (from, to) => M.mapPointF([0, 0], "0", to);   // the view's centre in frame `to`
    const box = (H, c, r, extra = {}) => {
        const o = { type: "shape", origin: "native", id: d.allocId(), loops: rectLoop({ left: c[0] - r, top: c[1] - r * 0.6, right: c[0] + r, bottom: c[1] + r * 0.6 }),
            color: "#224466", opacity: 1, ...extra };
        d.add(o, H);
        return o;
    };
    const curve = (H, c, r) => {
        const loops = normalizeLoops([circleLoop(c[0], c[1], r)]);
        const o = { type: "shape", origin: "native", id: d.allocId(), loops, color: "#aa3300", opacity: 1 };
        d.add(o, H);
        return o;
    };
    const stroke = (H, c, r) => {
        const o = { type: "stroke", origin: "native", id: d.allocId(), pts: [[c[0] - r, c[1] + r / 5], [c[0] + r, c[1] - r / 5]], lwFrame: r / 10, color: "#123456", opacity: 1 };
        d.add(o, H);
        return o;
    };
    return { M, d, at, box, curve, stroke };
}

// Every cached tile of `ts` against a fresh store's cold bake of the same square.
function expectCold(ts, M, d) {
    const fresh = mkStore(M, d);
    let n = 0;
    for (const [, tile] of ts.cache) {
        const cold = tile.dir === "up" ? fresh._ensureUp(tile.level, tile.i, tile.j) : fresh._ensureDown(tile.level, tile.i, tile.j);
        expect({ key: tile.level + tile.dir + tile.i + "," + tile.j, objs: norm(tile.objs) })
            .toEqual({ key: tile.level + tile.dir + tile.i + "," + tile.j, objs: norm(cold.objs) });
        n++;
    }
    return n;
}
const warm = (ts) => { for (const F of ["0", "-1", "-2", "-3"]) ts.content(F, win()); };
const upKeys = (ts, F) => ts._tileKeys().filter((k) => k.startsWith(F + "|up|")).sort();

describe("TB-1 chained up tiles are patched, and equal a cold bake", () => {
    test("TP-1 an add two and three levels above keeps the view's chained tiles, which equal a cold bake", () => {
        const { M, d, at, box, curve, stroke } = world();
        const c3 = at(0, "-3"), c2 = at(0, "-2"), c1 = at(0, "-1");
        box("-3", c3, 1e-3);
        stroke("-2", c2, 0.5);
        curve("-1", c1, 20);
        const ts = mkStore(M, d);
        warm(ts);
        const before = upKeys(ts, "0");
        expect(before.length).toBeGreaterThan(0);
        const o = curve("-3", [c3[0] + 1e-4, c3[1]], 5e-4);
        box("-2", [c2[0] - 0.2, c2[1] + 0.1], 0.3, { opacity: 0.5 });
        expect(upKeys(ts, "0")).toEqual(before);   // kept, not dropped
        expect(ts.content("0", win()).some((p) => p.id === o.id)).toBe(true);
        expect(expectCold(ts, M, d)).toBeGreaterThan(before.length);
    });

    test("TP-2 a cut, a bite and a removal of a backdrop above the view", () => {
        const { M, d, at, box, curve } = world();
        const c3 = at(0, "-3"), c1 = at(0, "-1");
        const back = box("-3", c3, 2e-3);
        curve("-1", c1, 20);
        const ts = mkStore(M, d);
        warm(ts);
        const before = upKeys(ts, "0");
        // Split in two, the view's side intact; then bite the piece the view sees; then remove the other.
        const L = { left: c3[0] - 2e-3, right: c3[0] + 2e-3, top: c3[1] - 1.2e-3, bottom: c3[1] + 1.2e-3 };
        const cut = d.eraseReplaceById(back.id, [
            rectLoop({ ...L, right: c3[0] - 1.5e-3 }),
            rectLoop({ ...L, left: c3[0] - 1.4e-3 }),
        ]);
        expect(upKeys(ts, "0")).toEqual(before);
        expectCold(ts, M, d);
        const bite = d.eraseReplaceById(cut.pieces[1].id, [rectLoop({ ...L, left: c3[0] - 1.4e-3, top: c3[1] - 1e-9 })]);
        expectCold(ts, M, d);
        d.removeById(cut.pieces[0].id);
        d.removeById(bite.pieces[0].id);
        expectCold(ts, M, d);
        expect(ts.content("0", win()).some((p) => p.id === back.id || p.id === bite.pieces[0].id)).toBe(false);
    });

    test("TP-3 a native of a ring neighbour of the view's ancestor reaches the chained tiles", () => {
        const { M, d, at, curve, box } = world();
        const c1 = at(0, "-1");
        curve("-1", c1, 20);
        const N = M.neighbour("-2", 1, 0);
        const cN = at(0, N.id);   // the view's centre in the neighbour's units: about a frame to its left
        const ts = mkStore(M, d);
        warm(ts);
        const before = upKeys(ts, "0");
        const o = box(N.id, cN, 0.4);
        expect(upKeys(ts, "0")).toEqual(before);
        expect(ts.content("0", win()).some((p) => p.id === o.id)).toBe(true);
        expectCold(ts, M, d);
        d.eraseReplaceById(o.id, [rectLoop({ left: cN[0] - 0.4, right: cN[0] + 0.1, top: cN[1] - 0.24, bottom: cN[1] + 0.24 })]);
        expectCold(ts, M, d);
    });

    test("TP-4 a parent square not cached: the chained tile goes and is rebuilt right", () => {
        const { M, d, at, box, curve } = world();
        const c3 = at(0, "-3"), c1 = at(0, "-1");
        box("-3", c3, 1e-3);
        curve("-1", c1, 20);
        const ts = mkStore(M, d);
        warm(ts);
        for (const k of upKeys(ts, "-1")) ts.cache.delete(k);
        const o = box("-3", [c3[0], c3[1] + 1e-4], 5e-4, { color: "#00ff00" });
        expect(upKeys(ts, "0")).toEqual([]);
        expect(ts.content("0", win()).some((p) => p.id === o.id)).toBe(true);
        expectCold(ts, M, d);
    });

    test("TP-5 an add below the view and at the view's own frame: down tiles and natives as before", () => {
        const { M, d, at, box, curve } = world();
        const c3 = at(0, "-3");
        box("-3", c3, 1e-3);
        const ts = mkStore(M, d);
        warm(ts);
        box("0", [0, 0], 2000);
        curve("-1", at(0, "-1"), 10);
        expectCold(ts, M, d);
    });
});
