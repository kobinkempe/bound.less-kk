/**
 * raster.job.test.js — J1–J6 of RASTERISER-PLAN §9.2, and the stage-2 acceptance that goes with
 * them: the packer's `subs` table (D36), the cull that copies no coordinate for an item it
 * rejects (edge case 4.4), the routing to the union pass (§4.2), the family key and its alpha
 * (`Renderer.js:579`/`:904`), and the bit-identity of `strokeStripNear`'s DEFAULT output, which
 * the bake's footprint depends on (§4.8).
 *
 * The bit-identity test carries the pre-change implementation literally, the way
 * `chordMath.test.js` carries the pre-delegation expressions (D66): comparing the helper with
 * itself would pass whatever it holds.
 */

import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import {
    wireJob, unwireJob, wireResult, unwireResult, validateJob, copyPlate,
    BufferPool, jobBytes, META_WORDS, ATTR_DOUBLES, KIND_RINGS, FLAG_UNION, FLAG_ERASE,
} from "./rasterJob";
import { PLATE_PX, zqOf } from "./plate";
import KobinEngine from "../KobinEngine";
import { coverRings, ringsArea } from "../__oracles__/coverageOracle";
import { Loop } from "../geometry/loop";
import { strokeStripNear } from "../geometry/polyline";
import { strokeLoops } from "../geometry/curveOutline";

const TW = core.TW, TH = core.TH;
const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25, fatWidthPx: 4000 };
const PLATES = Int32Array.from([0, 0]);

/** A shape item whose loops are straight-line loops in the `geometry/loop.js` grammar. */
function shapeItem(id, rings, extra) {
    const loops = rings.map((ring) => {
        const nums = [ring[0][0], ring[0][1]];
        for (let i = 1; i < ring.length; i++) nums.push(0, ring[i][0], ring[i][1]);
        return new Loop(Float64Array.from(nums));
    });
    // White ink on black paper, as every raster suite does, so a stored byte is 255 × coverage.
    return Object.assign({ type: "shape", id, loops, color: "#ffffff", opacity: 1 }, extra);
}
const fillItem = (id, polys, extra) => Object.assign({ type: "fill", id, polys, color: "#ffffff", opacity: 1 }, extra);
const strokeItem = (id, pts, lwFrame, extra) => Object.assign({ type: "stroke", id, pts, lwFrame, color: "#ffffff", opacity: 1 }, extra);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function packOne(list, opts) {
    return pack.packJob(list, Object.assign({ plates: PLATES, q: 0, Zq: 1, dpr: 1, cfg: CFG, paper: [0, 0, 0] }, opts));
}
function paint(job) {
    const out = new Uint8ClampedArray(TW * TH * 4);
    const counts = new Uint32Array(8);
    core.renderPlate(job, 0, out, counts);
    return { out, counts };
}
const same = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
};
/** The same ring wound POSITIVE, so the oracle over a set of them is their UNION (D105). */
const wound = (r) => (ringsArea([r]) < 0 ? r.slice().reverse() : r);
/** The rings one PACKED item ships, as point arrays — `subs` is in points for a flat kind (D36). */
function ringsOfItem(job, k) {
    const m = k * META_WORDS;
    const at = job.meta[m + 2], pts = job.meta[m + 3] / 2, s = job.meta[m + 4], n = job.meta[m + 5];
    const rings = [];
    for (let i = 0; i < n; i++) {
        const from = job.subs[s + i], to = i + 1 < n ? job.subs[s + i + 1] : pts;
        const ring = [];
        for (let p = from; p < to; p++) ring.push([job.geom[at + p * 2], job.geom[at + p * 2 + 1]]);
        rings.push(ring);
    }
    return rings;
}

beforeEach(() => {
    pack.clearPackCaches();
    pack.resetPackStats();
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
});

describe("the job wire (§3.3, §3.4)", () => {
    test("J1 wireJob/unwireJob round trip, every array bit for bit and the same pixels", () => {
        const job = packOne([
            shapeItem(1, [rect(20, 20, 200, 200)]),
            fillItem(2, [rect(100.25, 250.5, 300, 400)]),
            strokeItem(3, [[60, 420], [400, 460]], 8),
        ], { G: 41 });
        expect(job.nItems).toBe(3);
        const before = {};
        for (const k of ["meta", "attr", "rgb", "subs", "geom", "ids", "plates", "paper"]) before[k] = job[k].slice();

        const { msg, transfer } = wireJob(job);
        expect(transfer.length).toBe(7);                       // one buffer per array, nothing shared
        expect(msg.ids).toBeUndefined();                       // the ids stay on this thread (PLAN §5.4)
        expect(same(job.ids, before.ids)).toBe(true);
        const back = unwireJob(msg);
        for (const k of Object.keys(before)) if (k !== "ids") expect(same(back[k], before[k])).toBe(true);
        expect(back.G).toBe(41);
        expect(back.Zq).toBe(job.Zq);
        expect(back.nItems).toBe(job.nItems);
        expect(back.plateW).toBe(PLATE_PX);

        const a = paint(job).out, b = paint(back).out;
        expect(same(a, b)).toBe(true);
    });

    test("J2 the transfer list is honoured — the sender's buffers detach, and they come back for the pool", () => {
        const pool = new BufferPool();
        const posted = wireJob(packOne([shapeItem(1, [rect(10, 10, 300, 300)])], { pool }));
        expect(jobBytes(posted.msg)).toBeGreaterThan(0);

        // The one place jsdom can prove a transfer list is real: node's own MessageChannel
        // detaches exactly what the list names. An ImageBitmap is serializable AS WELL AS
        // transferable, so an entry left out of the list is silently COPIED (§3.4).
        const { MessageChannel } = require("worker_threads");
        const ch = new MessageChannel();
        ch.port1.postMessage(posted.msg, posted.transfer);
        for (const b of posted.transfer) expect(b.byteLength).toBe(0);
        expect(posted.msg.geom.length).toBe(0);                // the sender's view is detached with it
        ch.port1.close(); ch.port2.close();

        // and the worker's side hands the buffers back for the pool (§3.6)
        const { msg } = wireJob(packOne([shapeItem(1, [rect(10, 10, 300, 300)])], { pool }));
        const worker = unwireJob(msg);
        const bitmap = { width: PLATE_PX, height: PLATE_PX, close() { this.width = 0; } };
        const res = {
            jobId: worker.jobId, frameSeq: worker.frameSeq, plates: worker.plates, G: worker.G,
            bitmaps: [bitmap],
            timings: new Float64Array(7), counts: new Uint32Array(8), guards: new Uint32Array(7),
            recycled: [worker.geom.buffer, worker.meta.buffer, worker.attr.buffer, worker.subs.buffer],
        };
        const wired = wireResult(res);
        expect(wired.transfer).toContain(bitmap);              // or it is structured-cloned, 1.05 MB a plate
        for (const r of res.recycled) expect(wired.transfer).toContain(r);
        const arrived = unwireResult(wired.msg);
        for (const r of arrived.recycled) pool.give(r);
        expect(pool.bytes).toBeGreaterThan(0);
        const hits0 = pool.hits;
        packOne([shapeItem(1, [rect(10, 10, 300, 300)])], { pool });
        expect(pool.hits).toBeGreaterThan(hits0);
    });

    test("J3 packed rings are the nested originals, and paint the same plate", () => {
        const rings = [rect(30.5, 40.25, 210.75, 180.5), rect(250, 60, 400, 300)];
        const job = packOne([fillItem(7, rings)]);
        expect(job.meta[0]).toBe(KIND_RINGS);
        expect(job.meta[5]).toBe(2);
        let at = 0;
        for (let k = 0; k < rings.length; k++) {
            expect(job.subs[k]).toBe(at);
            for (const p of rings[k]) {
                expect(job.geom[at * 2]).toBe(p[0]);
                expect(job.geom[at * 2 + 1]).toBe(p[1]);
                at++;
            }
        }
        expect(job.geom.length).toBe(at * 2);
        const { counts } = paint(job);
        expect(counts[4]).toBe(4);                             // two rectangles: a horizontal edge deposits nothing
    });

    test("J4 the box memo is one buffer per item, and a move with no _ver bump still moves the box (F55)", () => {
        const item = shapeItem(11, [rect(100, 100, 300, 260)]);
        const b1 = pack.itemBox(item, CFG);
        const b2 = pack.itemBox(item, CFG);
        expect(b2).toBe(b1);                                   // the same buffer, not a copy
        expect(Array.from(b1)).toEqual([100, 100, 300, 260]);
        expect(pack.packStats.boxWalks).toBe(1);

        item.res = [1000, -40];                                // `_buildList` writes this with no _ver bump
        const job = packOne([item], { plates: Int32Array.from([2, 0]) });
        expect(job.nItems).toBe(1);                            // the moved object is NOT culled out of its new plate
        expect(job.attr[0]).toBe(1100);
        expect(job.attr[1]).toBe(60);
        expect(job.attr[4]).toBe(1000);
        expect(job.attr[5]).toBe(-40);
        expect(Array.from(pack.itemBox(item, CFG))).toEqual([100, 100, 300, 260]);   // memoised WITHOUT res
    });

    test("J4b an EDIT rebuilds the entry, so a re-rastered plate is not painted from the old numbers", () => {
        const item = shapeItem(12, [rect(100, 100, 200, 200)]);
        const j1 = packOne([item]);
        expect(j1.attr[2]).toBe(200);
        expect(pack.packStats.boxWalks).toBe(1);

        // what `Document._afterEdit` does to a native at the active frame: the object stays, its
        // geometry changes under it, `_ver` is bumped (`Document.js:1012-1017`)
        const edited = shapeItem(12, [rect(100, 100, 400, 300)]);
        item.loops[0] = edited.loops[0];
        item._ver = (item._ver || 0) + 1;

        const j2 = packOne([item]);
        expect(pack.packStats.rebuilt).toBe(1);
        expect(pack.packStats.boxWalks).toBe(2);
        expect(Array.from(pack.itemBox(item, CFG))).toEqual([100, 100, 400, 300]);
        expect(j2.attr[2]).toBe(400);
        expect(Array.from(j2.geom)).toEqual(Array.from(edited.loops[0].buf));
        expect(same(j1.geom, j2.geom)).toBe(false);

        // the geometry ARRAY replaced with no `_ver` bump is caught by the same check
        item.loops = shapeItem(12, [rect(0, 0, 50, 50)]).loops;
        expect(packOne([item]).attr[2]).toBe(50);
        expect(pack.packStats.rebuilt).toBe(2);

        // and a MOVE still does not rebuild: `_buildList` writes `res` with no `_ver` bump (F55)
        item.res = [7, 9];
        expect(packOne([item]).attr[2]).toBe(57);
        expect(pack.packStats.rebuilt).toBe(2);
        expect(pack.packStats.boxWalks).toBe(3);
    });

    test("J4f one list's strips share one pre-pass, and an edit or a new res between strips refills the family (S3)", () => {
        const a = shapeItem(21, [rect(100, 100, 300, 260)]);
        const b = shapeItem(22, [rect(600, 100, 700, 200)]);
        const list = [a, b];
        const two = Int32Array.from([0, 0, 1, 0]);
        const whole = packOne(list, { plates: two });
        const left = packOne(list, { plates: Int32Array.from([0, 0]) });
        expect(pack.packStats.prepasses).toBe(1);
        expect(pack.packStats.prepassHits).toBe(1);
        expect(left.nItems).toBe(1);
        // an edit in place between two strips of the SAME list: the family is refilled
        a.loops = shapeItem(21, [rect(100, 100, 480, 260)]).loops;
        a._ver = 1;
        const edited = packOne(list, { plates: Int32Array.from([0, 0]) });
        expect(edited.attr[2]).toBe(480);
        expect(pack.packStats.famRefills).toBeGreaterThanOrEqual(1);
        // and a `res` re-stamped on the same list moves the box, as J4 requires of a cold pack
        b.res = [-500, 0];
        const moved = packOne(list, { plates: Int32Array.from([0, 0]) });
        expect(moved.nItems).toBe(2);
        expect(moved.attr[9]).toBe(100);
        // the reused pass packs what a cold one does, to the byte
        const warm = packOne(list, { plates: two });
        pack.clearPackCaches();
        const cold = packOne(list.slice(), { plates: two });
        expect(same(cold.geom, warm.geom) && same(cold.attr, warm.attr) && same(cold.meta, warm.meta)).toBe(true);
        expect(whole.nItems).toBe(2);
    });

    test("J4c an edited stroke drops its band with its entry, so the next plate bands the new stroke", () => {
        const item = strokeItem(13, [[40, 100], [240, 100]], 12);
        const b1 = pack.bandFor(item, 0, 1, CFG);
        expect(pack.packStats.bandsBuilt).toBe(1);
        item.pts = [[40, 100], [240, 100], [240, 300]];
        item._ver = 1;
        const b2 = pack.bandFor(item, 0, 1, CFG);
        expect(pack.packStats.bandsBuilt).toBe(2);
        expect(pack.packStats.bandHits).toBe(0);
        expect(b2).not.toBe(b1);
        expect(b2.box[3]).toBeGreaterThan(b1.box[3]);          // the new leg reaches down to y 300
    });

    test("J4d a stroke FITTED mid-session re-bands: `_outline` is in the entry's identity too", () => {
        const item = strokeItem(14, [[40, 100], [240, 100]], 12);
        const b1 = pack.bandFor(item, 0, 1, CFG);
        expect(pack.packStats.bandsBuilt).toBe(1);
        // the round cap reaches half the pen, less its own chords' sagitta (§4.4's tolerance)
        expect(b1.box[0]).toBeGreaterThanOrEqual(34);
        expect(b1.box[0]).toBeLessThan(34 + pack.ARC_TOL);

        // what the idle fitter does on a crossing: `renderer.ensureOutline` → `strokeLoops`
        // caches the outline on the object and bumps no `_ver` (`KobinEngine.js:588-596`,
        // `curveOutline.js:406`). §4.8 bands a fitted stroke from `_outline` instead, and for a
        // fat one the two are a miter corner apart, not a sub-pixel.
        item._outline = [[
            [[40, 94], [110, 94], [170, 94], [240, 94]],
            [[240, 94], [240, 100], [240, 100], [240, 106]],
            [[240, 106], [170, 106], [110, 106], [40, 106]],
            [[40, 106], [40, 100], [40, 100], [40, 94]],
        ]];
        const b2 = pack.bandFor(item, 0, 1, CFG);
        expect(pack.packStats.rebuilt).toBe(1);
        expect(pack.packStats.bandsBuilt).toBe(2);
        expect(pack.packStats.bandHits).toBe(0);
        expect(b2.box[0]).toBeCloseTo(40, 9);                  // the outline's own box, cap and all
    });

    test("J4e the cull box contains a FITTED band, miter and curved — the centreline box does not (D100)", () => {
        const fit = CFG.arcTolerancePx / CFG.enter;
        /** How far the band reaches OUTSIDE the box, per side; ≤ 0 on all four is contained. */
        const outside = (band, box) => [box[0] - band[0], box[1] - band[1], band[2] - box[2], band[3] - box[3]];

        // A decimated scribble corner at a 100-unit pen, fitted the way the idle fitter fits a
        // DERIVED stroke (`KobinEngine.js:591` passes `curved` only for a native one). The miter
        // ribbon puts its vertex `half / max(0.5, dot)` from the centreline vertex — up to 2·half
        // (`polyline.js:364`), so the centreline box inflated by `half` loses the spike.
        const scribble = strokeItem(30, [[0, 0], [200, 0], [0, 6]], 100);
        strokeLoops(scribble, CFG, { curved: false });
        const bandA = pack.bandFor(scribble, 0, 1, CFG).box;
        const cullA = pack.itemBox(scribble, CFG);
        expect(Math.max(...outside(bandA, cullA))).toBeLessThanOrEqual(0);
        expect(bandA[2] - (200 + 50 + fit)).toBeCloseTo(49.988, 3);     // what `half + fit` would lose

        // A NATIVE stroke's outline is a curve through its points, which bulges outside the point
        // polygon by a fraction of the SEGMENT length: no multiple of the pen bounds it, which is
        // why the box is unioned with the outline's own control points and not padded further.
        const corner = strokeItem(31, [[100, 100], [300, 100], [300, 300]], 4);
        strokeLoops(corner, CFG, { curved: true });
        const bandB = pack.bandFor(corner, 0, 1, CFG).box;
        const cullB = pack.itemBox(corner, CFG);
        expect(Math.max(...outside(bandB, cullB))).toBeLessThanOrEqual(0);
        expect(100 - 2 - fit - bandB[1]).toBeCloseTo(20.737, 3);        // what `half + fit` would lose
        expect(100 - 4 - fit - bandB[1]).toBeCloseTo(18.737, 3);        // and what `2·half + fit` still would
    });

    test("J5 the job's one G crosses the wire and comes back on its result unchanged (A2 §3.1)", () => {
        const plates = Int32Array.from([0, 0, 1, 0]);
        const job = unwireJob(wireJob(packOne([shapeItem(1, [rect(10, 10, 900, 300)])], { plates, G: 7 })).msg);
        expect(job.G).toBe(7);
        expect(job.epochs).toBeUndefined();                    // one scalar a job, no per-plate array
        const res = unwireResult(wireResult({ jobId: 1, frameSeq: 1, G: job.G, plates: job.plates }).msg);
        expect(res.G).toBe(7);                                 // the store judges the arrival by it (rule 1, rule 2)
        expect(res.idSet).toBeUndefined();                     // no painted-id sets: nothing drops by id
    });

    test("J6 the RGBA scratch is copied out before the next plate, or a strip delivers one picture twice", () => {
        const job = packOne([shapeItem(1, [rect(20, 20, 200, 200)])], { plates: Int32Array.from([0, 0, 1, 0]) });
        const rgba = new Uint8ClampedArray(TW * TH * 4);
        const delivered = [], aliased = [];
        for (let p = 0; p < 2; p++) {
            core.renderPlate(job, p, rgba);
            delivered.push(copyPlate(rgba));                   // §3.5's rule
            aliased.push(rgba);                                // what `new ImageData(RGBA, …)` does
        }
        expect(same(delivered[0], delivered[1])).toBe(false);  // plate 0 has the ink, plate 1 is paper
        expect(delivered[0][(100 * TW + 100) * 4]).toBe(255);
        expect(delivered[1][(100 * TW + 100) * 4]).toBe(0);
        expect(same(aliased[0], aliased[1])).toBe(true);       // the bug, recorded: both are plate 1
    });
});

describe("the packer (§3.3, §4.2, §5.2)", () => {
    test("outsideWin is conservative: an item it rules out has a pack box that misses the window (seeded shapes, fills, strokes, offsets)", () => {
        let s = 12345;
        const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
        let ruledOut = 0, n = 0;
        for (let k = 0; k < 600; k++) {
            const x = rnd() * 2000 - 1000, y = rnd() * 2000 - 1000, w = 1 + rnd() * 300, h = 1 + rnd() * 300, kind = k % 4;
            const pts = Array.from({ length: 3 + (k % 5) }, () => [x + rnd() * w, y + rnd() * h]);
            const item = kind === 0 ? shapeItem(k + 1, [rect(x, y, x + w, y + h)])
                : kind === 1 ? fillItem(k + 1, [rect(x, y, x + w, y + h)])
                    : strokeItem(k + 1, pts, 1 + rnd() * 40, kind === 2 ? { origin: "native" } : {});
            if (k % 3 === 0) item.res = [rnd() * 200 - 100, rnd() * 200 - 100];
            const cx = rnd() * 2000 - 1000, cy = rnd() * 2000 - 1000, ww = 10 + rnd() * 400, wh = 10 + rnd() * 400;
            const win = { left: cx, top: cy, right: cx + ww, bottom: cy + wh };
            const b = pack.itemBox(item, CFG), r = item.res || [0, 0];
            const meets = b[2] + r[0] >= win.left && b[0] + r[0] <= win.right && b[3] + r[1] >= win.top && b[1] + r[1] <= win.bottom;
            n++;
            if (pack.outsideWin(item, win)) { ruledOut++; expect([k, meets]).toEqual([k, false]); }
        }
        expect(ruledOut).toBeGreaterThan(n / 2);                         // and it rules most of a scattered list out
    });

    test("subs is one entry per loop, ascending, and a two-words-a-loop table is refused (D36)", () => {
        const job = packOne([shapeItem(1, [rect(10, 10, 100, 100), rect(120, 10, 200, 100), rect(220, 10, 300, 100)])]);
        expect(job.meta[5]).toBe(3);
        expect(job.subs.length).toBe(3);
        expect(job.subs[0]).toBeLessThan(job.subs[1]);
        expect(job.subs[1]).toBeLessThan(job.subs[2]);
        const { counts } = paint(job);
        expect(counts[4]).toBe(6);                             // three rectangles, two deposited edges each; a
        //                                                        mis-packed table loses this ink with no error

        const bad = { ...job, subs: Uint32Array.from([job.subs[0], job.subs[1], job.subs[1], job.subs[2]]), meta: job.meta.slice() };
        bad.meta[5] = 4;
        expect(() => validateJob(bad)).toThrow(/ascend/);
    });

    test("edge case 4.4: an item that misses the plate copies no coordinate, on a COLD memo", () => {
        const near = shapeItem(1, [rect(10, 10, 100, 100)]);
        const far = shapeItem(2, [rect(9000, 9000, 9100, 9100)]);
        const job = packOne([near, far]);
        expect(job.nItems).toBe(1);
        expect(pack.packStats.culled).toBe(1);
        // Both boxes are WALKED — four comparisons need a box — and only the kept item's
        // coordinates are copied. The box walk reads the item's numbers in place; the copy is
        // `flattenGeom`, which runs on the first plate that keeps the item and never before it.
        expect(pack.packStats.boxWalks).toBe(2);
        expect(pack.packStats.coordsCopied).toBe(near.loops[0].buf.length);
        expect(pack.entryFor(far, CFG).geom).toBe(null);
        expect(pack.entryFor(near, CFG).geom.length).toBe(near.loops[0].buf.length);
        // and a second pack of the same two copies nothing at all: the memo holds both
        pack.resetPackStats();
        packOne([near, far]);
        expect(pack.packStats.coordsCopied).toBe(0);
        expect(pack.packStats.boxWalks).toBe(0);
    });

    test("the union flag: a band takes the union pass, a nested hole does not, and a partial overlap does", () => {
        const band = strokeItem(1, [[40, 100], [240, 100], [240, 300]], 6);
        const plain = shapeItem(2, [rect(10, 10, 100, 100)]);
        const j1 = packOne([band, plain]);
        expect(j1.meta[6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(j1.meta[META_WORDS + 6] & FLAG_UNION).toBe(0);

        // two same-wound rings of one item that overlap: accumulation would double-count them
        const twin = fillItem(3, [rect(10, 10, 100, 100), rect(50, 50, 140, 140)]);
        expect(packOne([twin]).meta[6] & FLAG_UNION).toBe(FLAG_UNION);

        // one object, two items: the parent and the counter-wound hole its child cedes, NESTED.
        // That is the case accumulation gets right by construction, so it stays on the fast path
        // (D91) — and the picture is the oracle's, which is the whole reason the routing may
        // leave it there. 61 % of a real screen's raster time was this shape on the union pass.
        const body = shapeItem(5, [rect(50, 50, 250, 250)], { editId: 9 });
        const hole = shapeItem(6, [rect(100, 100, 200, 200).reverse()], { editId: 9 });
        const j2 = packOne([body, hole]);
        expect(j2.meta[1]).toBe(0);
        expect(j2.meta[META_WORDS + 1]).toBe(0);               // one family
        expect(j2.meta[6] & FLAG_UNION).toBe(0);
        expect(j2.meta[META_WORDS + 6] & FLAG_UNION).toBe(0);
        const { out } = paint(j2);
        expect(out[(150 * TW + 150) * 4]).toBe(0);             // the hole is a hole
        expect(out[(60 * TW + 60) * 4]).toBe(255);             // and the body around it is solid
        const cov = coverRings([rect(50, 50, 250, 250), rect(100, 100, 200, 200).reverse()], TW, TH, 16);
        let worst = 0;
        for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
            worst = Math.max(worst, Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]));
        }
        expect(worst).toBeLessThan(1 / 16 + 0.5 / 255);

        // and the case that is NOT nested: two counter-wound loops that overlap only in part
        // cancel to blank under accumulation, so they take the union pass
        const a = shapeItem(7, [rect(50, 50, 250, 250)], { editId: 11 });
        const b = shapeItem(8, [rect(150, 150, 350, 350).reverse()], { editId: 11 });
        const j3 = packOne([a, b]);
        expect(j3.meta[6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(j3.meta[META_WORDS + 6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(paint(j3).out[(200 * TW + 200) * 4]).toBe(0);   // the overlap is cut out, not doubled
        expect(paint(j3).out[(100 * TW + 100) * 4]).toBe(255);
        // the answer the fast path gives there, recorded: the two windings cancel and the ink
        // of BOTH is gone from the overlap either way — but the union pass reads it as covered
        // where a partial cancellation would blank a pixel that has ink in it
        const flat = { ...j3, meta: j3.meta.slice() };
        flat.meta[6] &= ~FLAG_UNION; flat.meta[META_WORDS + 6] &= ~FLAG_UNION;
        expect(paint(flat).counts[3]).toBe(0);
    });

    test("the 20,000-pair cap counts the pairs the family walks, and a same-wound family walks none", () => {
        /** `n` disjoint 20-unit squares on a 24-unit grid, wound the way `wind` says. */
        const grid = (n, x0, wind) => {
            const rings = [];
            for (let k = 0; k < n; k++) {
                const x = x0 + (k % 10) * 24, y = 10 + Math.floor(k / 10) * 24;
                const r = rect(x, y, x + 20, y + 20);
                rings.push(wind > 0 ? r : r.slice().reverse());
            }
            return rings;
        };
        // 300 rings of one winding over two items of one family: no pair can need the pass, so
        // none is walked and the cap is not reached. Counting only the pairs past a sign test
        // inside the loop walks all 44,850 of them; counting every i<j pair caps at 20,000 and
        // sends a family that needs nothing to the union pass (D101).
        const same = [fillItem(1, grid(150, 10, +1), { editId: 5 }), fillItem(2, grid(150, 260, +1), { editId: 5 })];
        const j1 = packOne(same);
        expect(j1.nItems).toBe(2);
        expect(pack.packStats.overlapCapped).toBe(0);
        expect(j1.meta[6] & FLAG_UNION).toBe(0);
        expect(j1.meta[META_WORDS + 6] & FLAG_UNION).toBe(0);

        // 150 against 150 the other way round is 22,500 cross-wound pairs: the cap IS reached,
        // it is counted, and the family goes to the union pass, which is the safe side.
        pack.clearPackCaches();
        pack.resetPackStats();
        const cross = [fillItem(3, grid(150, 10, +1), { editId: 6 }), fillItem(4, grid(150, 260, -1), { editId: 6 })];
        const j2 = packOne(cross);
        expect(pack.packStats.overlapCapped).toBe(1);
        expect(j2.meta[6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(j2.meta[META_WORDS + 6] & FLAG_UNION).toBe(FLAG_UNION);

        // And the pairs the family rule never has to walk: 22,500 of them inside ONE item. Its own
        // rings cap it into the union pass (that is `ringsNeedUnion`, 44,850 pairs), but the family
        // rule skips a same-owner pair before counting it, so the cap is not reached a second time
        // and the SIBLING stays on the fast path. Counting before the owner test drags it along.
        pack.clearPackCaches();
        pack.resetPackStats();
        const many = fillItem(7, grid(150, 10, +1).concat(grid(150, 260, -1)), { editId: 7 });
        const sibling = fillItem(8, [rect(10, 400, 60, 460)], { editId: 7 });
        const j3 = packOne([many, sibling]);
        expect(pack.packStats.overlapCapped).toBe(1);
        expect(j3.meta[6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(j3.meta[META_WORDS + 6] & FLAG_UNION).toBe(0);
    });

    test("a zero-signed-area ring is still paired by the family rule, on the safe side (D101)", () => {
        // A bowtie: two equal counter-wound lobes, so its shoelace is exactly 0 while it covers
        // 5,000 units of area. Splitting the rings by winding has to put it on BOTH sides or the
        // family rule stops testing it at all, which is the opposite of what `pairNeedsUnion` says.
        const bowtie = [[100, 100], [200, 200], [100, 200], [200, 100]];
        expect(ringsArea([bowtie])).toBe(0);
        const zero = fillItem(1, [bowtie], { editId: 4 });
        const over = fillItem(2, [rect(150, 120, 260, 260)], { editId: 4 });
        const job = packOne([zero, over]);
        expect(job.nItems).toBe(2);
        expect(job.meta[6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(job.meta[META_WORDS + 6] & FLAG_UNION).toBe(FLAG_UNION);

        // and the same ring where nothing overlaps it: no pair needs the pass, both stay fast path
        pack.clearPackCaches();
        pack.resetPackStats();
        const apart = packOne([zero, fillItem(3, [rect(300, 300, 400, 400)], { editId: 4 })]);
        expect(apart.meta[6] & FLAG_UNION).toBe(0);
        expect(apart.meta[META_WORDS + 6] & FLAG_UNION).toBe(0);
    });

    test("the family's union sign weighs a fill and a shape alike, or the picture inverts (D90, D97)", () => {
        // One family, three items: a fast-path sibling, a POSITIVE union item written as a
        // `shape` and a smaller NEGATIVE one written as a `fill`. The sign of their total is what
        // the union pass deposits with, so counting a `fill`'s area twice a `shape`'s flips it
        // wherever the smaller item is between half the larger and all of it — 60,000 of true
        // area against 92,000 here, which doubled reads −28,000 where the truth is +32,000.
        const sibling = fillItem(1, [rect(40, 40, 200, 470)], { editId: 9 });
        const pos = shapeItem(2, [rect(150, 60, 400, 260), rect(250, 100, 460, 300)], { editId: 9 });
        const neg = fillItem(3, [rect(280, 330, 480, 480).reverse(), rect(300, 350, 500, 500).reverse()], { editId: 9 });
        const job = packOne([sibling, pos, neg]);
        expect(job.nItems).toBe(3);
        expect([job.meta[1], job.meta[META_WORDS + 1], job.meta[2 * META_WORDS + 1]]).toEqual([0, 0, 0]);
        expect(job.meta[6] & FLAG_UNION).toBe(0);                          // the sibling is fast path
        expect(job.meta[META_WORDS + 6] & FLAG_UNION).toBe(FLAG_UNION);    // each of the other two is
        expect(job.meta[2 * META_WORDS + 6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(job.attr[8]).toBe(0);                                       // no sign for a fast-path item
        expect(job.attr[ATTR_DOUBLES + 8]).toBe(1);                        // sign(92,000 − 60,000)
        expect(job.attr[2 * ATTR_DOUBLES + 8]).toBe(1);

        const { out } = paint(job);
        const cov = coverRings([
            rect(40, 40, 200, 470), rect(150, 60, 400, 260), rect(250, 100, 460, 300),
            rect(280, 330, 480, 480).reverse(), rect(300, 350, 500, 500).reverse(),
        ], TW, TH, 16);
        let worst = 0;
        for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
            worst = Math.max(worst, Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]));
        }
        expect(worst).toBeLessThan(1 / 16 + 0.5 / 255);
        expect(out[(150 * TW + 170) * 4]).toBe(255);   // where the sibling and the union ink meet

        // and what the other sign gives, recorded: the deposit cancels the sibling instead of
        // adding to it and the overlap goes blank — the inverse picture of D64
        const flipped = { ...job, attr: job.attr.slice() };
        flipped.attr[ATTR_DOUBLES + 8] = -1;
        flipped.attr[2 * ATTR_DOUBLES + 8] = -1;
        expect(paint(flipped).out[(150 * TW + 170) * 4]).toBe(0);
    });

    test("a fitted dot declares the sign of the band it SHIPS, so a fast-path sibling keeps its ink (D102)", () => {
        // One family: a fast-path fill and a fitted dot. `curveOutline.circleLoop` — what a
        // one-point stroke fits to — is wound POSITIVE, where every other band this packer ships
        // is negative. A declared sign taken from the pen's length and width instead of from the
        // band therefore cuts a hole exactly where the dot's ink belongs.
        const sibling = fillItem(1, [rect(100, 100, 300, 300)], { editId: 9 });
        const dot = strokeItem(2, [[200, 200]], 60, { editId: 9 });
        strokeLoops(dot, CFG);                                  // what the idle fitter does
        const job = packOne([sibling, dot]);
        expect(job.nItems).toBe(2);
        expect(job.meta[6] & FLAG_UNION).toBe(0);               // the fill is fast path
        expect(job.meta[META_WORDS + 6] & FLAG_UNION).toBe(FLAG_UNION);
        const band = ringsOfItem(job, 1);
        expect(ringsArea(band)).toBeGreaterThan(0);             // the band's own winding, measured
        expect(job.attr[ATTR_DOUBLES + 8]).toBe(1);

        const { out } = paint(job);
        const cov = coverRings([rect(100, 100, 300, 300), ...band], TW, TH, 16);
        let worst = 0;
        for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
            worst = Math.max(worst, Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]));
        }
        expect(worst).toBeLessThan(1 / 16 + 0.5 / 255);
        expect(out[(200 * TW + 200) * 4]).toBe(255);            // the dot's centre

        // and what the estimate declared, recorded: the deposit cancels the sibling under the dot
        const flipped = { ...job, attr: job.attr.slice() };
        flipped.attr[ATTR_DOUBLES + 8] = -1;
        expect(paint(flipped).out[(200 * TW + 200) * 4]).toBe(0);
    });

    test("the declared sign is the band's own, over fitted and unfitted strokes of both windings", () => {
        // Every band this packer can ship: the round one it builds itself, a miter fit, a curved
        // fit, a dot, and a fitted outline handed to it wound the other way — at five pens from a
        // twentieth of a frame unit to the fat threshold. The measurement is the oracle's own
        // shoelace over the rings the JOB carries, not the packer's.
        const shapes = {
            dot: [[200, 200]],
            twoPoints: [[120, 200], [360, 200]],
            coincident: [[200, 200], [200, 200], [200, 200]],
            corner: [[80, 120], [300, 120], [300, 380]],
            scribble: Array.from({ length: 24 }, (v, i) => [60 + i * 16, 200 + 90 * Math.sin(i / 2)]),
        };
        const reverseLoop = (loop) => loop.map((seg) => seg.slice().reverse()).reverse();
        let checked = 0, positive = 0;
        for (const pts of Object.values(shapes)) {
            for (const pen of [0.05, 1, 12, 300, 4000]) {
                for (const kind of ["round", "miter", "curved", "reversed"]) {
                    pack.clearPackCaches();
                    const item = strokeItem(1, pts, pen, { editId: 1 });
                    if (kind !== "round") {
                        strokeLoops(item, CFG, { curved: kind === "curved" });
                        if (kind === "reversed") item._outline = item._outline.map(reverseLoop);
                    }
                    const job = packOne([item]);
                    if (!job.nItems) continue;
                    const measured = ringsArea(ringsOfItem(job, 0));
                    expect(job.attr[8]).toBe(measured > 0 ? 1 : -1);
                    if (measured > 0) positive++;
                    checked++;
                }
            }
        }
        expect(checked).toBe(100);
        expect(positive).toBe(checked);                         // every band ships wound positive (D105)
    });

    test("the same dot paints the same picture before and after the idle fitter (D105)", () => {
        // The dot of the test above, one line earlier. An unfitted dot is `strokeStripRound`'s
        // disc and a fitted one is `curveOutline.circleLoop`; while the two were wound against
        // each other the same dot in the same family read a HOLE before the fitter ran and ink
        // after it — no edit, no camera move, a background pass changing the picture.
        const plates = [];
        for (const fitted of [false, true]) {
            pack.clearPackCaches();
            pack.resetPackStats();
            const sibling = fillItem(1, [rect(100, 100, 400, 400)], { editId: 9 });
            const dot = strokeItem(2, [[250, 250]], 60, { editId: 9 });
            if (fitted) strokeLoops(dot, CFG);                  // what the idle fitter does
            const job = packOne([sibling, dot]);
            expect(job.nItems).toBe(2);
            expect(ringsArea(ringsOfItem(job, 1))).toBeGreaterThan(0);
            expect(job.attr[ATTR_DOUBLES + 8]).toBe(1);
            const { out } = paint(job);
            expect(out[(250 * TW + 250) * 4]).toBe(255);        // the dot's centre
            plates.push(out);
        }
        // The dot lies wholly inside its sibling, so its ink is invisible against solid ink and
        // the two plates are the same bytes — which is the statement, that the fit cannot be seen.
        expect(same(plates[0], plates[1])).toBe(true);

        // and what the other winding gave, recorded: the unfitted band wound against its family,
        // declaring the sign it then had — the deposit cancels the sibling under the dot
        pack.clearPackCaches();
        const job = packOne([fillItem(1, [rect(100, 100, 400, 400)], { editId: 9 }),
            strokeItem(2, [[250, 250]], 60, { editId: 9 })]);
        const flipped = { ...job, geom: job.geom.slice(), attr: job.attr.slice() };
        const m = META_WORDS, at0 = flipped.meta[m + 2], pts = flipped.meta[m + 3] / 2;
        const s = flipped.meta[m + 4], nr = flipped.meta[m + 5];
        for (let i = 0; i < nr; i++) {                          // every ring of the band, reversed
            const from = flipped.subs[s + i], to = i + 1 < nr ? flipped.subs[s + i + 1] : pts;
            for (let a = from, b = to - 1; a < b; a++, b--) {
                const x = flipped.geom[at0 + a * 2], y = flipped.geom[at0 + a * 2 + 1];
                flipped.geom[at0 + a * 2] = flipped.geom[at0 + b * 2];
                flipped.geom[at0 + a * 2 + 1] = flipped.geom[at0 + b * 2 + 1];
                flipped.geom[at0 + b * 2] = x; flipped.geom[at0 + b * 2 + 1] = y;
            }
        }
        flipped.attr[ATTR_DOUBLES + 8] = -1;
        expect(paint(flipped).out[(250 * TW + 250) * 4]).toBe(0);
    });

    test("two strokes of one family paint the UNION of their bands, not their difference (D105)", () => {
        // A family accumulates as one nonzero-winding path (§4.5), so the union pass counts the
        // two bands' joint winding BEFORE `attr[8]`'s sign is applied: two items wound against
        // each other cancel where they overlap and no declared sign can put the ink back.
        const dot = strokeItem(1, [[250, 250]], 60, { editId: 9 });
        const line = strokeItem(2, [[40, 250], [460, 250]], 40, { editId: 9 });
        strokeLoops(dot, CFG);
        strokeLoops(line, CFG);
        const job = packOne([dot, line]);
        expect(job.nItems).toBe(2);
        const rings = [...ringsOfItem(job, 0), ...ringsOfItem(job, 1)];
        for (const r of rings) expect(ringsArea([r])).toBeGreaterThan(0);   // one winding, every ring

        // the reference is the UNION of the two bands: the same rings, each wound positive by the
        // test itself, so the oracle's answer does not depend on what the packer shipped
        const cov = coverRings(rings.map(wound), TW, TH, 16);
        const { out } = paint(job);
        let worst = 0, ink = 0, ideal = 0;
        for (let i = 0; i < TW * TH; i++) {
            worst = Math.max(worst, Math.abs(out[i * 4] / 255 - cov[i]));
            ink += out[i * 4] / 255; ideal += cov[i];
        }
        expect(worst).toBeLessThan(1 / 16 + 0.5 / 255);
        expect(Math.abs(ink - ideal)).toBeLessThan(ideal / 1000);
        expect(out[(250 * TW + 250) * 4]).toBe(255);            // the dot's centre, inside the line
    });

    test("a family wound against itself is counted, and the union pass does not save it (D106)", () => {
        // The shape of the configuration the bake DOES build (§4.2, OPEN-FLAGS F76), in one
        // family: a POSITIVE fill and, nested inside it, the NEGATIVE rings a derived fat stroke
        // ships —
        // `strokeStripNear`'s default tail normalises every ring to non-positive and
        // `derive.bandRings:434` is that call, so this is the geometry of every fat bake.
        const win = { left: 0, top: 0, right: 512, bottom: 512 };
        const band = strokeStripNear([[240, 120], [240, 400]], 60, win, { startCap: true, endCap: true });
        expect(band.length).toBe(4);                            // ribbon, one segment rectangle, two caps
        for (const r of band) expect(ringsArea([r])).toBeLessThan(0);
        const body = fillItem(1, [rect(80, 60, 460, 460)], { editId: 9 });
        const job = packOne([body, fillItem(2, band, { editId: 9 })]);
        expect(pack.packStats.mixedWinding).toBe(1);
        // and nothing routes it out of trouble: the nested-hole exemption leaves the body on the
        // fast path (D91) and the band's deposit carries the family's sign, which is the band's own
        expect(job.meta[6] & FLAG_UNION).toBe(0);
        expect(job.meta[META_WORDS + 6] & FLAG_UNION).toBe(FLAG_UNION);
        expect(job.attr[ATTR_DOUBLES + 8]).toBe(-1);

        const cov = coverRings([...ringsOfItem(job, 0), ...ringsOfItem(job, 1)].map(wound), TW, TH, 16);
        const { out } = paint(job);
        let ink = 0, ideal = 0, worst = 0;
        for (let i = 0; i < TW * TH; i++) {
            worst = Math.max(worst, Math.abs(out[i * 4] / 255 - cov[i]));
            ink += out[i * 4] / 255; ideal += cov[i];
        }
        expect(out[(260 * TW + 240) * 4]).toBe(0);              // the middle of the band, blank
        expect(worst).toBeGreaterThan(0.99);
        expect(ideal - ink).toBeGreaterThan(19000);             // measured: 19,625.5 of 152,000 — the whole band
        expect(ideal - ink).toBeLessThan(20000);

        // and the answer to the question the routing invites: putting BOTH items on the union pass
        // does not resolve it. That pass walks the family's union items together and emits where
        // their JOINT winding is non-zero, so the body's +1 and a cap's −1 still cancel — the
        // band's body comes back, the two caps outside the segment rectangle do not.
        const forced = { ...job, meta: job.meta.slice() };
        forced.meta[6] |= FLAG_UNION;
        const f = paint(forced);
        let fink = 0, fworst = 0;
        for (let i = 0; i < TW * TH; i++) {
            fworst = Math.max(fworst, Math.abs(f.out[i * 4] / 255 - cov[i]));
            fink += f.out[i * 4] / 255;
        }
        expect(f.out[(260 * TW + 240) * 4]).toBe(255);
        expect(fworst).toBeGreaterThan(0.99);
        expect(ideal - fink).toBeGreaterThan(2500);             // measured: 2,825.5 — the two cap discs
        expect(ideal - fink).toBeLessThan(3200);

        // the same family wound one way: nothing is counted, and nothing is lost
        pack.clearPackCaches();
        pack.resetPackStats();
        const ok = packOne([body, fillItem(3, band.map(wound), { editId: 9 })]);
        expect(pack.packStats.mixedWinding).toBe(0);
        const okCov = coverRings([...ringsOfItem(ok, 0), ...ringsOfItem(ok, 1)].map(wound), TW, TH, 16);
        const okOut = paint(ok).out;
        let okWorst = 0;
        for (let i = 0; i < TW * TH; i++) okWorst = Math.max(okWorst, Math.abs(okOut[i * 4] / 255 - okCov[i]));
        expect(okWorst).toBeLessThan(1 / 16 + 0.5 / 255);
    });

    test("the family key is Renderer.js:579 on the QUANTISED fade, and the alpha is :904's", () => {
        const parent = shapeItem(20, [rect(10, 10, 400, 400)], { editId: 20 });
        const member = shapeItem(21, [rect(20, 20, 60, 60)], { editId: 20, fadeTag: 4000 });
        // fadeTag 4000 at Zq 1, dpr 1, enter 256 is 15.6 px: fully present, so it JOINS the family
        expect(pack.fadeQ(member, 1, 1, CFG)).toBe(1);
        const j1 = packOne([parent, member]);
        expect(j1.meta[1]).toBe(j1.meta[META_WORDS + 1]);
        expect(j1.attr[7]).toBe(1);
        expect(j1.attr[ATTR_DOUBLES + 7]).toBe(1);             // a family member is painted at full presence

        // the same member at a zoom where it is 0.2 px: its own group, at its own fade
        const Zq = (0.2 * CFG.enter) / 4000;
        const f = pack.fadeQ(member, Zq, 1, CFG);
        expect(f).toBeCloseTo(1 / 3, 12);
        const j2 = pack.packJob([parent, member], { plates: PLATES, q: -8, Zq, dpr: 1, cfg: CFG, paper: [0, 0, 0] });
        expect(j2.meta[1]).not.toBe(j2.meta[META_WORDS + 1]);  // two families now
        expect(j2.attr[ATTR_DOUBLES + 7]).toBeCloseTo(f, 12);
        expect(j2.attr[7]).toBe(1);                            // and the parent is NOT dimmed with it

        // under the fade floor it paints nothing at all, which is what bounds the family count (§4.3)
        const j3 = pack.packJob([parent, member], { plates: PLATES, q: -20, Zq: (0.1 * CFG.enter) / 4000, dpr: 1, cfg: CFG, paper: [0, 0, 0] });
        expect(j3.nItems).toBe(1);
        expect(pack.packStats.faded).toBe(1);
    });

    test("families are stacked by (z, renderId) and the indices ascend in paint order", () => {
        const list = [
            shapeItem(3, [rect(10, 10, 50, 50)], { z: 1 }),
            shapeItem(1, [rect(20, 20, 60, 60)], { z: 2 }),
            shapeItem(2, [rect(30, 30, 70, 70)], { z: 2 }),
        ];
        const job = packOne(list);
        expect(Array.from(job.ids)).toEqual([3, 1, 2]);
        expect([job.meta[1], job.meta[META_WORDS + 1], job.meta[2 * META_WORDS + 1]]).toEqual([0, 1, 2]);
    });

    test("colour is parsed once per string, an eraser mark is white ink at its own z, and flags carry", () => {
        expect(pack.parseColour("#ffffff")).toEqual([255, 255, 255]);
        expect(pack.parseColour("#f00")).toEqual([255, 0, 0]);
        expect(pack.parseColour("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
        expect(pack.parseColour("rgba(10,20,30,0.5)")).toEqual([10, 20, 30]);
        const mark = strokeItem(4, [[20, 20], [200, 200]], 10, { erase: true, color: "#ffffff" });
        const job = packOne([mark]);
        expect(job.meta[6] & FLAG_ERASE).toBe(FLAG_ERASE);
        expect(Array.from(job.rgb)).toEqual([255, 255, 255]);
    });

    test("a non-finite coordinate is refused at the gate, counted, and never reaches the buffer (§3.5)", () => {
        const bad = shapeItem(1, [[[10, 10], [NaN, 20], [30, 40]]]);
        const good = shapeItem(2, [rect(10, 10, 100, 100)]);
        const job = packOne([bad, good]);
        expect(job.nItems).toBe(1);
        expect(pack.packStats.nonFinite).toBe(1);
        expect(pack.packStats.rejected).toBe(1);
        for (let i = 0; i < job.geom.length; i++) expect(isFinite(job.geom[i])).toBe(true);
        paint(job);
        expect(core.coreStats.nonFinite).toBe(0);
        expect(core.coreStats.fullClears).toBe(0);
    });

    test("the plate binner files an item into every plate it touches, and nothing else", () => {
        const b = new pack.PlateBinner(Int32Array.from([0, 0, 1, 0, 0, 1, 1, 1]), 1);
        expect(b.add(7, Float64Array.from([10, 10, 20, 20]))).toBe(true);
        expect(b.add(8, Float64Array.from([500, 10, 600, 20]))).toBe(true);
        expect(b.add(9, Float64Array.from([5000, 10, 6000, 20]))).toBe(false);
        expect(b.itemsFor(0, 0)).toEqual([7, 8]);
        expect(b.itemsFor(1, 0)).toEqual([8]);
        expect(b.itemsFor(0, 1)).toEqual([]);
    });

    test("the memo is bounded by its byte budget and evicts the least recently used", () => {
        pack.setPackBudget(4096);
        for (let i = 0; i < 200; i++) pack.itemBox(shapeItem(i, [rect(i, i, i + 10, i + 10)]), CFG);
        expect(pack.packMemoBytes()).toBeLessThanOrEqual(4096);
        expect(pack.packStats.evictions).toBeGreaterThan(100);

        // and the half of the policy that makes it LRU rather than FIFO: a HIT moves the entry to
        // the back of the map, so the next eviction takes the neighbour that was not read. With
        // 200 distinct items touched once each, insertion order and access order are the same and
        // this cannot be seen at all.
        pack.clearPackCaches();
        pack.resetPackStats();
        const items = [];
        for (let i = 0; i < 5; i++) {
            items.push(shapeItem(i, [rect(i, i, i + 10, i + 10)]));
            pack.itemBox(items[i], CFG);
        }
        pack.setPackBudget(pack.packMemoBytes());              // exactly these five fit
        expect(pack.packStats.evictions).toBe(0);
        const box0 = pack.itemBox(items[0], CFG);              // a hit on the OLDEST entry
        const walks = pack.packStats.boxWalks;
        pack.itemBox(shapeItem(99, [rect(0, 0, 5, 5)]), CFG);  // the sixth evicts one
        expect(pack.packStats.evictions).toBe(1);
        expect(pack.itemBox(items[0], CFG)).toBe(box0);        // still there: it was touched
        expect(pack.packStats.boxWalks).toBe(walks + 1);
        pack.itemBox(items[1], CFG);                           // the untouched neighbour went
        expect(pack.packStats.boxWalks).toBe(walks + 2);
        pack.setPackBudget(pack.PACK_BUDGET);
    });

    test("a dense table's entries survive from one prepass to the next at PACK_BUDGET (at 10 MiB each prepass rebuilt them all)", () => {
        pack.clearPackCaches();
        pack.resetPackStats();
        pack.setPackBudget(pack.PACK_BUDGET);
        const ring = (cx, cy, n) => Array.from({ length: n }, (_, k) => [cx + 20 * Math.cos((2 * Math.PI * k) / n), cy + 20 * Math.sin((2 * Math.PI * k) / n)]);
        const items = Array.from({ length: 3000 }, (_, k) => shapeItem(k + 1, [ring((k % 60) * 8, Math.floor(k / 60) * 8, 180)]));
        packOne(items.slice());                                        // the first list: every entry built
        const walks = pack.packStats.boxWalks;
        expect(pack.packMemoBytes()).toBeGreaterThan(10 << 20);         // the table outgrows the old budget
        packOne(items.slice());                                        // a new list (a commit): the same items
        expect(pack.packStats.boxWalks).toBe(walks);                    // red at 10 MiB: 3,000 rebuilt
    });

    test("the memo is keyed by the geometry: two wrappers of one piece (a Stage item and a snapshot's) share its entry", () => {
        pack.clearPackCaches();
        pack.resetPackStats();
        const p = shapeItem(7, [rect(0, 0, 50, 50)]);
        const wrap = () => ({ piece: p, id: p.id, type: p.type, get loops() { return p.loops; }, get _ver() { return p._ver; }, get _outline() { return p._outline; } });
        const a = pack.itemBox(wrap(), CFG);
        const walks = pack.packStats.boxWalks;
        expect(pack.itemBox(wrap(), CFG)).toBe(a);                 // red before: one build a wrapper
        expect(pack.packStats.boxWalks).toBe(walks);
    });
});

// ---------------------------------------------------------------------------
// `strokeStripNear`'s default path, bit for bit. This is the only edit in the build to a helper
// the bake's footprint depends on (§4.8, the DEPLOY GATE): `strokeLoops` calls it, and the hole
// the eraser cuts is that outline.
// ---------------------------------------------------------------------------

/** The implementation as it stood before the opt-in parameter, transcribed (D66's rule). */
function strokeStripNearV0(pts, width, rect, opts = {}) {
    const half = width / 2;
    const out = [];
    const diagR = Math.hypot(rect.right - rect.left, rect.bottom - rect.top);
    const rcx = (rect.left + rect.right) / 2, rcy = (rect.top + rect.bottom) / 2;
    const capPiece = (p) => {
        const dx = rcx - p[0], dy = rcy - p[1];
        const dist = Math.hypot(dx, dy);
        if (dist - diagR > half) return;
        const phi = Math.atan2(dy, dx);
        const delta = Math.min(Math.PI, 4 * Math.asin(Math.min(1, diagR / Math.max(dist, diagR))));
        const K = 96, ring = [[p[0], p[1]]];
        for (let k = 0; k <= K; k++) {
            const a = phi - delta + (2 * delta * k) / K;
            ring.push([p[0] + Math.cos(a) * half, p[1] + Math.sin(a) * half]);
        }
        out.push(ring);
    };
    if (pts.length === 1) { capPiece(pts[0]); } else {
        const n = pts.length, nx = [], ny = [];
        for (let i = 0; i < n - 1; i++) {
            const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
            const len = Math.hypot(dx, dy) || 1;
            nx.push(-dy / len); ny.push(dx / len);
        }
        const L = [], R = [];
        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 1), b = Math.min(n - 2, i);
            let mx = (nx[a] + nx[b]) / 2, my = (ny[a] + ny[b]) / 2;
            const ml = Math.hypot(mx, my);
            if (ml < 1e-12) { mx = nx[b]; my = ny[b]; } else { mx /= ml; my /= ml; }
            const dot = mx * nx[b] + my * ny[b];
            const sc = half / Math.max(0.5, dot);
            L.push([pts[i][0] + mx * sc, pts[i][1] + my * sc]);
            R.push([pts[i][0] - mx * sc, pts[i][1] - my * sc]);
        }
        out.push(L.concat(R.reverse()));
        for (let i = 0; i < n - 1; i++) {
            const ox = nx[i] * half, oy = ny[i] * half;
            out.push([
                [pts[i][0] + ox, pts[i][1] + oy], [pts[i + 1][0] + ox, pts[i + 1][1] + oy],
                [pts[i + 1][0] - ox, pts[i + 1][1] - oy], [pts[i][0] - ox, pts[i][1] - oy],
            ]);
        }
        if (opts.startCap) capPiece(pts[0]);
        if (opts.endCap) capPiece(pts[n - 1]);
    }
    for (const ring of out) {
        let area = 0;
        for (let i = 0, m = ring.length; i < m; i++) { const a = ring[i], b = ring[(i + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
        if (area > 0) ring.reverse();
    }
    return out;
}

/** The first place two ring lists differ, bit for bit, or null. `Object.is` so a signed zero shows. */
function firstMismatch(a, b) {
    if (a.length !== b.length) return "ring count " + a.length + " vs " + b.length;
    for (let i = 0; i < a.length; i++) {
        if (a[i].length !== b[i].length) return "ring " + i + " length " + a[i].length + " vs " + b[i].length;
        for (let k = 0; k < a[i].length; k++) {
            if (!Object.is(a[i][k][0], b[i][k][0]) || !Object.is(a[i][k][1], b[i][k][1])) {
                return "ring " + i + " point " + k + ": " + a[i][k] + " vs " + b[i][k];
            }
        }
    }
    return null;
}

describe("the band builder (§4.8)", () => {
    const recorded = [
        require("../__fixtures__/arc-stroke.json"),
        require("../__fixtures__/arc-stroke2.json"),
        require("../__fixtures__/arc-stroke-pause.json"),
        require("../__fixtures__/arc-stroke-pause2.json"),
    ];

    test("the DEFAULT output is bit-identical on recorded inputs, at four windows and both cap flags", () => {
        let rings = 0, points = 0, first = null;
        // One assertion at the end, not one per number: 96 calls over four recorded strokes are
        // ~200,000 coordinates, and `expect` per coordinate costs minutes.
        for (const rec of recorded) {
            const pts = rec.pts;
            for (const w of [rec.width, rec.width / 100, rec.width * 10]) {
                for (const r of [
                    { left: -1000, top: -1000, right: 1000, bottom: 1000 },
                    { left: 0, top: 0, right: 512, bottom: 512 },
                    { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 },
                    { left: 200, top: 300, right: 260, bottom: 340 },
                ]) {
                    for (const caps of [{}, { startCap: true, endCap: true }]) {
                        const a = strokeStripNear(pts, w, r, caps);
                        const b = strokeStripNearV0(pts, w, r, caps);
                        const what = firstMismatch(a, b);
                        if (what && !first) first = { w, r, caps: !!caps.startCap, what };
                        for (let i = 0; i < a.length; i++) points += a[i].length;
                        rings += a.length;
                    }
                }
            }
        }
        expect(first).toBe(null);
        expect(rings).toBeGreaterThan(20000);
        expect(points).toBeGreaterThan(100000);
    });

    test("the opt-in path is rectangles plus round fans, with no miter ribbon and no window in it", () => {
        const pts = [[40, 100], [240, 100], [240, 300]];
        const a = strokeStripNear(pts, 40, { left: 0, top: 0, right: 512, bottom: 512 }, { joins: "round", tol: 1 / 16 });
        const b = strokeStripNear(pts, 40, { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 }, { joins: "round", tol: 1 / 16 });
        expect(a.rings).toBe(b.rings);
        expect(same(a.xy.slice(0, a.pts * 2), b.xy.slice(0, b.pts * 2))).toBe(true);
        expect(a.rings).toBe(5);                               // two segment rectangles, one join fan, two caps
    });

    test("a fan costs one chord when the stroke is thin and what it needs when it is fat (§4.4's rule)", () => {
        const pts = [[100, 100], [300, 100]];
        const counts = [];
        for (const w of [0.1, 4, 400, 40000]) {
            const r = strokeStripNear(pts, w, null, { joins: "round", tol: 1 / 16 });
            counts.push(r.pts);
        }
        expect(counts[0]).toBe(4 + 3 + 3);                     // one rectangle, two caps of one chord each
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
        // the chord count follows the rule: delta / (2·acos(1 − tol/half))
        const half = 20000, tol = 1 / 16;
        const k = Math.ceil(Math.PI / (2 * Math.acos(1 - tol / half)));
        expect(counts[3]).toBe(4 + 2 * (k + 2));
    });

    test("the band is memoised on (item, zoom) and rebuilt when the zoom changes", () => {
        const item = strokeItem(1, [[40, 100], [240, 100], [240, 300]], 12);
        const b1 = pack.bandFor(item, 0, 1, CFG);
        const b2 = pack.bandFor(item, 0, 1, CFG);
        expect(b2).toBe(b1);
        expect(pack.packStats.bandsBuilt).toBe(1);
        expect(pack.packStats.bandHits).toBe(1);
        const b3 = pack.bandFor(item, 4, 2, CFG);
        expect(b3).not.toBe(b1);
        expect(pack.packStats.bandsBuilt).toBe(2);
        expect(b3.geom.length).toBeGreaterThan(b1.geom.length); // twice the zoom, twice the chord budget
    });

    /**
     * F77, fixed 2026-09-22. The memo was keyed on the job's `q`, and `"s"` (every sync frame)
     * and `"e"` (every settle) carry the camera's EXACT zoom under one constant key — so a band
     * flattened at the first such frame's zoom was returned at every later one. A band flattened
     * at `Zq1` and drawn at `Zq2` is `0.25 · Zq2/Zq1` device px off: 1.0 px at a 4x sync zoom,
     * against Kobin's quarter-pixel bar. This test is RED on the shipped memo.
     */
    test("F77 — two sync packs at different zooms build two bands, and the finer one is finer", () => {
        const item = strokeItem(1, [[40, 100], [240, 100], [240, 300]], 12);
        const near = pack.bandFor(item, "s", 1, CFG);
        const far = pack.bandFor(item, "s", 4, CFG);          // the same `q`, four times the zoom
        expect(far).not.toBe(near);
        expect(pack.packStats.bandsBuilt).toBe(2);
        expect(far.geom.length).toBeGreaterThan(near.geom.length);
        // the settle's own key is the same story, and the two keys do not collide either
        expect(pack.bandFor(item, "e", 4, CFG)).toBe(far);
        expect(pack.packStats.bandsBuilt).toBe(2);
    });

    /**
     * The other half of the re-key, and what PAPER-PLAN §7.2 rests on: a COARSER request reuses a
     * cached FINER band rather than building one. A finer flattening is a superset of chords and
     * is inside the tolerance at every coarser zoom, so the preview at `q - 8` pays no band
     * building. The reverse is never done — that is F77.
     */
    test("a coarser pack reuses a finer cached band, and counts it as a hit", () => {
        const item = strokeItem(1, [[40, 100], [240, 100], [240, 300]], 12);
        const fine = pack.bandFor(item, 0, 4, CFG);
        expect(pack.packStats.bandsBuilt).toBe(1);
        const hits = pack.packStats.bandHits;
        expect(pack.bandFor(item, -8, 1, CFG)).toBe(fine);    // two octaves coarser: the same band
        expect(pack.packStats.bandsBuilt).toBe(1);
        expect(pack.packStats.bandHits).toBe(hits + 1);
    });

    /**
     * The pack-time `offset` (SCENES-PLAN S1): a translation folded into each item's own `res`, so
     * a caller that wants an arbitrary rectangle on ONE plate moves the world instead of the grid.
     * It must be exactly a translated render list, because the core applies `res` and nothing else
     * knows the offset exists.
     */
    test("a pack offset equals a translated list, bit for bit", () => {
        const list = [
            strokeItem(1, [[40, 100], [240, 100], [240, 300]], 12),
            shapeItem(2, [rect(300, 60, 460, 220)]),
        ];
        const off = [-37.5, 21.25];
        const withOff = packOne(list, { offset: off });
        pack.clearPackCaches();
        const moved = [
            strokeItem(1, [[40, 100], [240, 100], [240, 300]], 12, { res: off }),
            shapeItem(2, [rect(300, 60, 460, 220)], { res: off }),
        ];
        const twin = packOne(moved);
        expect(withOff.nItems).toBe(twin.nItems);
        expect(same(withOff.geom, twin.geom)).toBe(true);
        expect(same(withOff.attr, twin.attr)).toBe(true);
        expect(same(withOff.subs, twin.subs)).toBe(true);
        // and an item's OWN res is added to it, never replaced
        pack.clearPackCaches();
        const both = packOne([strokeItem(1, [[40, 100], [240, 100], [240, 300]], 12, { res: [10, -4] })], { offset: off });
        expect(both.attr[4]).toBeCloseTo(10 + off[0], 12);
        expect(both.attr[5]).toBeCloseTo(-4 + off[1], 12);
    });

    test("a fitted stroke uses its own _outline, and no fit is ever run on the render path", () => {
        const item = strokeItem(1, [[40, 100], [240, 100]], 12);
        // a fitted outline is cubic loops: [[p0, c0, c1, p1], …]
        item._outline = [[
            [[40, 94], [110, 94], [170, 94], [240, 94]],
            [[240, 94], [240, 100], [240, 100], [240, 106]],
            [[240, 106], [170, 106], [110, 106], [40, 106]],
            [[40, 106], [40, 100], [40, 100], [40, 94]],
        ]];
        const band = pack.bandFor(item, 0, 1, CFG);
        expect(band.geom.length / 2).toBeGreaterThan(4);
        expect(band.box[1]).toBeCloseTo(94, 9);
        expect(band.box[3]).toBeCloseTo(106, 9);
    });
});

describe("the chord estimate of a raw native stroke (F92 bands it along its curve)", () => {
    test("CH1 it is priced by its flattened curve: within 1.5x of the band's own edges at 1x and 16x the zoom, times its pen's height past 32 px (F130)", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
        try {
            E.setTool("pen"); E.setWidth(13);
            E.pointerDown(100, 300);
            for (let x = 108; x <= 700; x += 8) E.pointerMove(x, 300 + 80 * Math.sin(x / 40) + 20 * Math.cos(x / 9));
            E.pointerUp();                                     // raw: the perimeter not resolved yet
            E._render();
            const item = E._lastList.find((o) => o.type === "stroke" && !o._outline);
            expect(item).toBeTruthy();
            const win = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 };
            for (const zf of [1, 16]) {
                const q = Math.round(Math.log2(E.cam.inScale * zf) * 4), Zq = zqOf(q);
                const edges = pack.bandFor(item, q, Zq, E.cfg).geom.length / 2;
                const tall = Math.max(1, (item.lwFrame * Zq) / 32);   // a band's rings cross as many sub-scanlines as the pen is tall
                const priced = pack.visibleChords([item], win, Zq, E.cfg, 1e9) / tall;
                expect(priced / edges).toBeGreaterThan(0.9);   // red before: 12 a sample, a fifth of the curved band at 1x, a sixteenth at 16x
                expect(priced / edges).toBeLessThan(1.5);
            }
        } finally { E.destroy(); host.remove(); }
    });
});
