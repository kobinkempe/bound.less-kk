/**
 * raster.badruns.test.js — a job the pool's check refuses is never left neither posted nor dropped (Kobin's Magnum
 * Opus report, 2026-10-20 15:54: "item N sub 1's run 11 does not tile its loop", thrown out of the dispatch, and the
 * strip's cells stayed paper). Row runs that do not tile a loop (F154) are dropped and the job posted without them —
 * the core walks every piece, the same pixels — with the item named in the worker report; any other refusal drops
 * the strip, so its cells are asked for again. And the cause: `rowRuns` sized its runs from the item's length alone, one
 * short for the Magnum Opus's item 47060 (three rings of 276, 182 and 4 points: 18 + 12 runs in room for 29).
 */
import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import * as client from "./rasterWorkerClient";
import { Loop } from "../geometry/loop";

const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25, fatWidthPx: 4000 };

/** A shape whose one loop is a 40-sided polygon: 40 line pieces, so three row runs. */
function polygonShape(id) {
    const nums = [];
    for (let k = 0; k <= 40; k++) {
        const a = (2 * Math.PI * k) / 40;
        if (k === 0) nums.push(100 + 60 * Math.cos(a), 100 + 60 * Math.sin(a));
        else nums.push(0, 100 + 60 * Math.cos(a), 100 + 60 * Math.sin(a));
    }
    return { type: "shape", id, loops: [new Loop(Float64Array.from(nums))], color: "#ffffff", opacity: 1 };
}
function entry(item, spoil, drops) {
    return {
        plates: Int32Array.from([0, 0]),
        req: {
            prio: 0,
            pack: (plates, jobId, pool) => {
                const job = pack.packJob([item], { plates, q: 0, Zq: 1, dpr: 1, cfg: CFG, paper: [0, 0, 0], pool });
                spoil(job);
                return job;
            },
            onResult: () => {},
            onDrop: (d) => drops.push(d),
        },
    };
}

beforeEach(() => {
    pack.clearPackCaches();
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
    client.resetRasterWorkerClient();
});
afterEach(() => { client.resetRasterWorkerClient(); client.setRasterTransport(null); });

test("a job whose row runs do not tile a loop is posted without them, and the report names the item", () => {
    const sent = [], drops = [];
    client.setRasterTransport((msg) => { sent.push(msg); return new Promise(() => {}); });
    let carried = null;
    const ok = client.rasterPool.submit(entry(polygonShape(7), (job) => {
        expect(job.runs.length / 3).toBe(3);
        carried = job.runs[5];
        job.runs[5] = job.runs[2];                       // the second run starts where the first does
    }, drops));
    expect(ok).toBe(true);
    expect(drops).toEqual([]);
    expect(sent.length).toBe(1);
    expect(sent[0].runs == null && sent[0].subRun == null).toBe(true);
    const rep = client.rasterWorkerReport();
    expect(rep.badRuns).toBe(1);
    expect(rep.badRunsFirst.item.id).toBe(7);
    expect(rep.badRunsFirst.item.own[1]).toBe(carried);
    expect(rep.badRunsFirst.item.carried[1]).not.toBe(carried);
});

test("a job the check refuses for anything else is dropped, so its cells are asked for again", () => {
    const sent = [], drops = [];
    client.setRasterTransport((msg) => { sent.push(msg); return new Promise(() => {}); });
    const ok = client.rasterPool.submit(entry(polygonShape(8), (job) => { job.meta = job.meta.subarray(0, job.meta.length - 1); }, drops));
    expect(ok).toBe(false);
    expect(sent.length).toBe(0);
    expect(drops.map((d) => d.why)).toEqual(["invalid"]);
    expect(client.rasterWorkerReport().failed).toBe(1);
});

describe("rowRuns counts its runs before it writes them", () => {
    const ring = (n, r) => { const out = []; for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; out.push(r * Math.cos(a), r * Math.sin(a)); } return out; };
    const check = (kind, geom, subs) => {
        const { runs, subRun } = core.rowRuns(kind, geom, subs);
        const nR = runs.length / 3, scale = kind === 0 ? 1 : 2;
        let need = 0;
        for (let k = 0; k < subs.length; k++) {
            const r0 = subRun[k], r1 = k + 1 < subs.length ? subRun[k + 1] : nR;
            const len = (k + 1 < subs.length ? subs[k + 1] * scale : geom.length) - subs[k] * scale;
            let prev = 0;
            for (let r = r0; r < r1; r++) { const off = runs[3 * r + 2]; expect(r === r0 ? off === 2 : off > prev && off < len).toBe(true); prev = off; }
            need += r1 - r0;
        }
        return need;
    };
    test("item 47060's three rings: 30 runs, each ring's own", () => {
        const pts = [...ring(276, 100), ...ring(182, 50), ...ring(4, 10)];
        expect(check(1, Float64Array.from(pts), Uint32Array.from([0, 276, 458]))).toBe(18 + 12);
    });
    test("two loops of 17 line pieces: 4 runs (the length alone has room for 3)", () => {
        const loop = (r) => { const p = ring(17, r), nums = [p[0], p[1]]; for (let k = 1; k <= 17; k++) nums.push(0, p[(2 * k) % 34], p[(2 * k + 1) % 34]); return nums; };
        const a = loop(100), b = loop(50);
        expect(check(0, Float64Array.from([...a, ...b]), Uint32Array.from([0, a.length]))).toBe(4);
    });
});
