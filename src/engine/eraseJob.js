/**
 * eraseJob.js — the geometry of one cut, the same on the main thread and in the erase
 * worker (public/erase-worker.js, built from worker/eraseWorker.js): the boolean, the
 * removal measured LOCALLY (F46: subject ∩ eraser, never before − after), the graze rule,
 * the components and the dust cull. Imports geometry only; touches no document. The
 * result says what happened; for a cut it carries the surviving regions as Loops.
 * `wireJob`/`unwireJob` and `wireResult`/`unwireResult` move a job and its result
 * between threads as transferable buffers, bit for bit.
 */
import { subtractShape, intersectShape, shapeComponents, dropDust, loopsArea, loopsBBox } from "./geometry/arcShape";
import { Loop } from "./geometry/loop";

/**
 * Dust is what the user could not see (Kobin, 2026-09-08): a fragment narrower than a
 * quarter of a pixel at the zoom the mark was drawn at. `bakePx` is that zoom (pixels
 * per unit of the mark's frame); `f` maps the mark's units into the subject's. Undefined
 * without a recorded zoom, and the pen rule stands.
 */
export const DUST_PX = 0.25;
export function dustBarFor(bakePx, f = 1) {
    return bakePx > 0 && f > 0 ? (DUST_PX / bakePx) * f : undefined;
}

/**
 * @param {{subject: any[], clip: any[], w: number, dustBar?: number, freezeR: number, graze: "cut"|"cede"}} j
 *   `graze` picks the rule: "cut" (in place) refuses a removal under 1e-4·rE² AND under
 *   1e-6 of the subject's area; "cede" (the rehome's last link) refuses under 1e-4·rE²
 *   alone, rE being half the eraser's box. Both rules as they were measured in (F46).
 *   `dustBar`: what is basically invisible at the zoom the mark was made in, in the
 *   subject's units (`dustBarFor`); dust is judged by it, not by the pen (F66).
 * @returns {{kind: "grazed"|"removed"|"cut", regions?: any[][], stats: any, removed: number, dust: number}}
 */
export function cutJob(j) {
    const opts = { freezeR: j.freezeR };
    const eb = loopsBBox(j.clip);
    const rE = eb ? Math.max(eb.x1 - eb.x0, eb.y1 - eb.y0) / 2 : 0;
    const res = subtractShape(j.subject, j.clip, opts);
    const stats = res.stats || null;
    const removed = Math.abs(loopsArea(intersectShape(j.subject, j.clip, opts).loops));
    let graze = 1e-4 * rE * rE, grazed;
    if (j.graze === "cede") grazed = removed < graze;
    else { graze = Math.min(graze, 1e-6 * Math.max(loopsArea(j.subject), 0)); grazed = removed <= graze; }
    if (grazed) return { kind: "grazed", stats, removed, dust: 0 };
    // Dust — a fragment far thinner than the pen that drew it — is not made into ink
    // (measured: nine "small pixel dots" in one document, the smallest 0.05 units
    // against a pen of 39). Culled here, after the arithmetic, which is right.
    const groups = shapeComponents(res.loops);
    const keep = dropDust(groups, j.w, j.dustBar);
    const dust = groups.length - keep.length;
    if (!keep.length) return { kind: "removed", stats, removed, dust };
    return { kind: "cut", regions: keep.map((g) => g.map((l) => Loop.from(l))), stats, removed, dust };
}

const own = (l) => { const x = Loop.from(l); return { buf: x.buf.slice(), idx: x.idx.slice() }; };
const wrap = (x) => new Loop(x.buf, x.idx);

/** A job as a message plus the buffers to transfer (copies: the document keeps its own). */
export function wireJob(j) {
    const subject = j.subject.map(own), clip = j.clip.map(own);
    const transfer = [];
    for (const x of subject) transfer.push(x.buf.buffer, x.idx.buffer);
    for (const x of clip) transfer.push(x.buf.buffer, x.idx.buffer);
    return { msg: { subject, clip, w: j.w, dustBar: j.dustBar, freezeR: j.freezeR, graze: j.graze }, transfer };
}
export function unwireJob(m) {
    return { subject: m.subject.map(wrap), clip: m.clip.map(wrap), w: m.w, dustBar: m.dustBar, freezeR: m.freezeR, graze: m.graze };
}
/** A result as a message plus the buffers to transfer (the job's own regions; nothing else holds them). */
export function wireResult(r) {
    if (r.kind !== "cut") return { msg: r, transfer: [] };
    const regions = r.regions.map((g) => g.map((l) => ({ buf: l.buf, idx: l.idx })));
    const transfer = [];
    for (const g of regions) for (const x of g) transfer.push(x.buf.buffer, x.idx.buffer);
    return { msg: { ...r, regions }, transfer };
}
export function unwireResult(m) {
    if (m.kind !== "cut") return m;
    return { ...m, regions: m.regions.map((g) => g.map(wrap)) };
}
