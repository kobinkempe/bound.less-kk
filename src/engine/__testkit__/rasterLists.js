/**
 * rasterLists.js — seeded random render lists for the rasteriser's property tests: fills, arc
 * circles, stroke bands, families of pieces and pending eraser marks, in device pixels at Zq = 1
 * around plate (0, 0) and reaching past it on every side. The generator of A3's experiment E1
 * (review/rebuild/A3-pyramid.md §3.1), shared by `raster/rasterCore.clip.test.js`.
 *
 * NOT collected by jest (the directory is `__testkit__`); nothing in the app imports it.
 */
import { createHash } from "crypto";
import { Loop } from "../geometry/loop";
import { circleLoop } from "../geometry/antRuns";

/** A 31-bit LCG: the same numbers on every platform (Math.imul keeps the product exact). */
export function lcg(seed) {
    let s = (seed >>> 0) & 0x7fffffff;
    return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** The packer's lattice constants for a list drawn at Zq = 1 (the values E1 used). */
export const LIST_CFG = { enter: 256, base: 1 / 16, exit: 1 / 32, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25 };

/**
 * `n` random items, sorted in paint order. `cover` puts a plate-covering opaque backdrop first,
 * so the occlusion cull has a candidate; `maxWalk` caps a stroke's samples (a band's union pass
 * costs by its rows, so the suites keep it short). Ids start at `firstId`.
 */
export function randomList(rnd, n, { cover = false, maxWalk = 30, firstId = 1 } = {}) {
    const rr = (a, b) => a + rnd() * (b - a);
    const ri = (a, b) => Math.floor(rr(a, b + 1));
    const col = () => "rgb(" + ri(0, 255) + "," + ri(0, 255) + "," + ri(0, 255) + ")";
    const list = [];
    let id = firstId;
    if (cover) {
        list.push({ type: "fill", origin: "native", id: id++, color: "rgb(230,230,230)", opacity: 1,
            polys: [[[-50, -50], [600, -50], [600, 600], [-50, 600]]] });
    }
    for (let k = 0; k < n; k++) {
        const kind = rnd();
        const cx = rr(-80, 592), cy = rr(-80, 592);
        const op = rnd() < 0.2 ? rr(0.3, 0.8) : 1;
        const fam = rnd() < 0.15 && list.length ? list[list.length - 1] : null;   // a piece of the last object
        let o;
        if (kind < 0.45) {
            const m = ri(3, 12), R = rnd() < 0.1 ? rr(150, 400) : rr(2, 80), pts = [];
            for (let v = 0; v < m; v++) {
                const a = (v / m) * Math.PI * 2 + rr(-0.2, 0.2), r = R * rr(0.5, 1);
                pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
            o = { type: "fill", origin: "native", polys: [pts] };
        } else if (kind < 0.7) {
            const R = rnd() < 0.1 ? rr(100, 300) : rr(1, 60);
            o = { type: "shape", origin: "native", loops: [Loop.from(circleLoop(cx, cy, R))] };
        } else if (kind < 0.97) {
            const m = ri(2, maxWalk), pts = [[cx, cy]];
            for (let v = 1; v < m; v++) pts.push([pts[v - 1][0] + rr(-40, 40), pts[v - 1][1] + rr(-40, 40)]);
            o = { type: "stroke", origin: "native", pts, lwFrame: rr(1, 30) };
        } else {
            const m = ri(3, 20), pts = [[cx, cy]];
            for (let v = 1; v < m; v++) pts.push([pts[v - 1][0] + rr(-30, 30), pts[v - 1][1] + rr(-30, 30)]);
            o = { type: "stroke", origin: "native", pts, lwFrame: rr(8, 40), erase: true };
        }
        o.id = id++;
        o.color = o.erase ? "#ffffff" : col();
        o.opacity = o.erase ? 1 : op;
        if (fam && !o.erase && !fam.erase) {
            o.editId = fam.editId != null ? fam.editId : fam.id; fam.editId = o.editId;
            o.color = fam.color; o.opacity = fam.opacity; o.z = fam.z != null ? fam.z : fam.id;
        }
        list.push(o);
    }
    return landMarks(sortList(list));
}

/**
 * Each mark landed as the erase rule reads it (A2 §4.1): its `targets` every native below it, which
 * name it in `targetOf` — what a mark masked before the rule was data; an unlanded one masks nothing.
 */
function landMarks(list) {
    const zOf = (o) => (o.z != null ? o.z : o.id);
    for (const M of list) {
        if (!M.erase) continue;
        M.targets = [];
        for (const o of list) if (!o.erase && zOf(o) < zOf(M)) { M.targets.push(o.id); (o.targetOf || (o.targetOf = [])).push(M.id); }
        M.targets.sort((a, b) => a - b);
    }
    for (const o of list) if (o.targetOf) o.targetOf.sort((a, b) => a - b);
    return list;
}

/** Paint order: z (the id when unset), then id. */
export function sortList(list) {
    return list.sort((a, b) => ((a.z != null ? a.z : a.id) - (b.z != null ? b.z : b.id)) || (a.id - b.id));
}

/** A plate's fingerprint for a golden: the first 16 hex digits of the SHA-1 of its bytes (native, ~1 ms a plate under jest). */
export function plateHash(bytes) {
    return createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}

/** Do two byte arrays hold the same bytes? A native compare, for the plate-sized ones. */
export function sameBytes(a, b) {
    return a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}
