/**
 * eraseJob.js — one cut as a pure job: grazed, removed or cut, with the regions as
 * Loops; and the wire round trip that carries it to a worker and back bit for bit.
 */
import { cutJob, wireJob, unwireJob, wireResult, unwireResult } from "./eraseJob";
import { rectLoop, loopsArea } from "./geometry/arcShape";
import { Loop } from "./geometry/loop";
import { bakeArcPerimeter } from "./geometry/arcPerimeter";
import { repairLoops } from "./geometry/arcShape";

const rect = (x0, y0, x1, y1) => rectLoop({ left: x0, top: y0, right: x1, bottom: y1 });

describe("cutJob", () => {
    test("a cut through the middle leaves two regions of the right area", () => {
        const subject = rect(0, 0, 100, 20), clip = rect(45, -10, 55, 30);
        const r = cutJob({ subject, clip, w: 4, freezeR: 1e9, graze: "cut" });
        expect(r.kind).toBe("cut");
        expect(r.regions).toHaveLength(2);
        for (const g of r.regions) for (const l of g) expect(Loop.is(l)).toBe(true);
        const areas = r.regions.map((g) => Math.abs(loopsArea(g))).sort((a, b) => a - b);
        expect(areas[0]).toBeCloseTo(45 * 20, 6);
        expect(areas[1]).toBeCloseTo(45 * 20, 6);
        expect(r.removed).toBeCloseTo(10 * 20, 6);
    });

    test("an eraser that covers the subject removes it; one that barely touches it grazes", () => {
        const subject = rect(0, 0, 100, 20);
        expect(cutJob({ subject, clip: rect(-5, -5, 105, 25), w: 4, freezeR: 1e9, graze: "cut" }).kind).toBe("removed");
        const g = cutJob({ subject, clip: rect(99.99999, 0, 100.00001, 20), w: 4, freezeR: 1e9, graze: "cut" });
        expect(g.kind).toBe("grazed");
        expect(cutJob({ subject, clip: rect(200, 0, 300, 20), w: 4, freezeR: 1e9, graze: "cut" }).kind).toBe("grazed");
    });

    test("the wire round trip keeps every number, and a result's regions come back as Loops", () => {
        const subject = rect(0, 0, 100, 20), clip = rect(45, -10, 55, 30);
        const job = { subject: subject.map((l) => Loop.from(l)), clip, w: 4, freezeR: 1e9, graze: "cut" };
        const { msg, transfer } = wireJob(job);
        expect(transfer.length).toBe(4);
        expect(msg.subject[0].buf).not.toBe(job.subject[0].buf);   // a copy: the document keeps its own
        const back = unwireJob(JSON.parse(JSON.stringify(msg, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)), (k, v) => (k === "buf" ? Float64Array.from(v) : k === "idx" ? Uint32Array.from(v) : v)));
        expect(Array.from(back.subject[0].buf)).toEqual(Array.from(job.subject[0].buf));
        const r = cutJob(back);
        const w = wireResult(r);
        expect(w.transfer.length).toBe(2 * r.regions.reduce((n, g) => n + g.length, 0));
        const r2 = unwireResult(w.msg);
        expect(r2.kind).toBe("cut");
        expect(r2.regions.map((g) => g.map((l) => Array.from(l.buf)))).toEqual(r.regions.map((g) => g.map((l) => Array.from(l.buf))));
    });
});

describe("a ring eraser that retraces its own start exactly (OPEN-FLAGS F89)", () => {
    // A computed ring swept past one turn, sealed as the app seals a bake (`_sealed`), cut through a
    // square: nothing of the band may be left. Before the fix the twice-covered sector subtracted
    // twice and survived as ink (winding -1): 2,019 units² at 1.10 turns, the whole ring at 2.
    const R = 110, w = 32, r = w / 2;
    const ring = (turns) => {
        const n = Math.max(2, Math.round((2 * Math.PI * R * turns) / 3));
        const p = [];
        for (let k = 0; k <= n; k++) { const t = (2 * Math.PI * turns * k) / n; p.push([R * Math.cos(t), R * Math.sin(t)]); }
        return p;
    };
    test.each([1.1, 1.5, 2])("%p turns: the square minus the ring is the square minus the annulus", (turns) => {
        const res = bakeArcPerimeter(ring(turns), w, { tol: 0.125 });
        const clip = res.stats.openChains ? repairLoops(res.loops, w, {}) : res.loops;
        const j = cutJob({ subject: rect(-300, -250, 300, 250), clip, w: 13, freezeR: undefined, graze: "cut" });
        expect(j.kind).toBe("cut");
        expect(j.regions).toHaveLength(2);                  // the disc, and the square round it
        const left = j.regions.reduce((a, g) => a + Math.abs(loopsArea(g)), 0);
        const want = 600 * 500 - Math.PI * ((R + r) ** 2 - (R - r) ** 2);
        expect(Math.abs(left - want)).toBeLessThan(1);      // units²: nothing of the band survives
    });
});
