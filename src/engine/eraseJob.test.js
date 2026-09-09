/**
 * eraseJob.js — one cut as a pure job: grazed, removed or cut, with the regions as
 * Loops; and the wire round trip that carries it to a worker and back bit for bit.
 */
import { cutJob, wireJob, unwireJob, wireResult, unwireResult } from "./eraseJob";
import { rectLoop, loopsArea } from "./geometry/arcShape";
import { Loop } from "./geometry/loop";

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
