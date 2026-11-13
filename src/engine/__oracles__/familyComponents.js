/**
 * ORACLE: is an edit family still one object? Every pair of members from their two whole outlines, flattened afresh,
 * with nothing kept between calls: `erasePipeline._familyComponents` as it stood before OPEN-FLAGS F190. The engine's
 * check reads only the pieces near each window and keeps a pair's answer while both members are unchanged; it must
 * give these classes (erase.family.test.js).
 */
import { Groups, arcsTouch, innerRuns, asRect } from "../geometry/connect";
import { bboxOf } from "../geometry/derive";
import { rectSpan, rectTol } from "../rectMath";

// `contactArcs` and `axisAbut` as they stood, over whole rings (geometry/connect.js has the reasons).
function sidesOf(R, x, y, tol) {
    const out = [];
    const inX = x >= R.x0 - tol && x <= R.x1 + tol;
    const inY = y >= R.y0 - tol && y <= R.y1 + tol;
    if (inX && Math.abs(y - R.y0) <= tol) out.push(0);
    if (inY && Math.abs(x - R.x1) <= tol) out.push(1);
    if (inX && Math.abs(y - R.y1) <= tol) out.push(2);
    if (inY && Math.abs(x - R.x0) <= tol) out.push(3);
    return out;
}
function tOn(R, side, x, y) {
    const w = R.x1 - R.x0 || 1, h = R.y1 - R.y0 || 1;
    const u = Math.min(1, Math.max(0, (x - R.x0) / w));
    const v = Math.min(1, Math.max(0, (y - R.y0) / h));
    if (side === 0) return u;
    if (side === 1) return 1 + v;
    if (side === 2) return 2 + (1 - u);
    return 3 + (1 - v);
}
function merge(arcs, eps) {
    if (arcs.length < 2) return arcs;
    arcs.sort((a, b) => a[0] - b[0]);
    const out = [arcs[0]];
    for (let i = 1; i < arcs.length; i++) {
        const last = out[out.length - 1], a = arcs[i];
        if (a[0] <= last[1] + eps) { if (a[1] > last[1]) last[1] = a[1]; } else out.push(a);
    }
    return out;
}
export function contactArcsRef(rings, rect, tol = 0) {
    const R = asRect(rect);
    if (!R || !rings) return [];
    const span = Math.max(R.x1 - R.x0, R.y1 - R.y0, 1e-12);
    const eps = Math.max(tol, span * 1e-9);
    const arcs = [];
    for (const ring of rings) {
        const n = ring.length;
        if (!n) continue;
        const on = ring.map((p) => sidesOf(R, p[0], p[1], eps));
        for (let i = 0; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            const sa = on[i], sb = on[(i + 1) % n];
            if (!sa.length) continue;
            let shared = -1;
            for (const s of sa) if (sb.indexOf(s) >= 0) { shared = s; break; }
            if (shared >= 0) {
                const t0 = tOn(R, shared, a[0], a[1]), t1 = tOn(R, shared, b[0], b[1]);
                arcs.push(t0 <= t1 ? [t0, t1] : [t1, t0]);
            } else {
                for (const s of sa) { const t = tOn(R, s, a[0], a[1]); arcs.push([t, t]); }
            }
        }
    }
    return merge(arcs, span > 0 ? eps / span : 1e-9);
}
export function axisAbutRef(A, B, tol) {
    const runs = (rings) => {
        const out = [[], []];
        for (const ring of rings || []) {
            for (let i = 0, n = ring.length; i < n; i++) {
                const a = ring[i], b = ring[(i + 1) % n];
                for (let ax = 0; ax < 2; ax++) {
                    const o = 1 - ax;
                    if (Math.abs(a[ax] - b[ax]) <= tol) out[ax].push([(a[ax] + b[ax]) / 2, Math.min(a[o], b[o]), Math.max(a[o], b[o])]);
                }
            }
        }
        return out;
    };
    const ra = runs(A), rb = runs(B);
    for (let ax = 0; ax < 2; ax++) {
        for (const [c, lo, hi] of ra[ax]) {
            for (const [c2, lo2, hi2] of rb[ax]) if (Math.abs(c - c2) <= tol && Math.min(hi, hi2) - Math.max(lo, lo2) > tol) return true;
        }
    }
    return false;
}
const contactArcs = contactArcsRef, axisAbut = axisAbutRef;

/** `E._familyComponents(key)` by the whole-outline rule: { members, classes, unresolved }. */
export function familyComponentsRef(E, key) {
    const members = E._familyMembers(key);
    const G = new Groups(members.length);
    for (let i = 0; i < members.length; i++) {
        const kid = members[i], R = kid.obj.attachRect;
        if (!R) continue;
        const kidDepth = E.lm.depthOf(kid.level);
        if (kidDepth == null) continue;
        const kidRings = E._inkOutline(kid.obj, rectTol(R));
        const kidArcs = contactArcs(kidRings, R, rectTol(R));
        const inner = innerRuns(kidRings, R, rectTol(R));
        for (let j = 0; j < members.length; j++) {
            const up = members[j];
            if (j === i) continue;
            if (up.obj.type !== "shape" && up.obj.type !== "fill") continue;
            const upDepth = E.lm.depthOf(up.level);
            if (upDepth === kidDepth) {
                if (!up.obj.attachRect) continue;
                const d = E._cellOffset(kid.level, up.level);
                if (!d) continue;
                const r = up.obj.attachRect, Rj = { x0: r.x0 + d[0], y0: r.y0 + d[1], x1: r.x1 + d[0], y1: r.y1 + d[1] };
                if (Rj.x1 < R.x0 - rectTol(R) || Rj.x0 > R.x1 + rectTol(R) || Rj.y1 < R.y0 - rectTol(R) || Rj.y0 > R.y1 + rectTol(R)) continue;
                let rings = E._inkOutline(up.obj, rectTol(R));
                if (d[0] || d[1]) rings = rings.map((ring) => ring.map((p) => [p[0] + d[0], p[1] + d[1]]));
                if (kidArcs.length && arcsTouch(kidArcs, contactArcs(rings, R, rectTol(R)), rectTol(R) / rectSpan(R))) G.union(i, j);
                else if (!d[0] && !d[1] && axisAbut(kidRings, rings, rectTol(R))) G.union(i, j);
                continue;
            }
            if (upDepth == null || upDepth >= kidDepth) continue;
            const near = upDepth === kidDepth - 1;
            if (!(near && kidArcs.length) && !inner.length) continue;
            const Rk = { left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 };
            const upT = E.doc.tableOf(up.obj, up.level);
            const upF0 = upT ? E.lm.objShift(upT, up.level, kid.level) : null;
            const from = upF0 ? upF0.F0 : kid.level;
            const Rp = E.lm.mapRectF(Rk, from, up.level);
            if (!Rp) continue;
            const ub = bboxOf(up.obj, null), pt = rectTol(Rp);
            if (ub.x1 < Rp.left - pt || ub.x0 > Rp.right + pt || ub.y1 < Rp.top - pt || ub.y0 > Rp.bottom + pt) continue;
            const upRings = E._inkOutline(up.obj, pt);
            const at = Math.max(rectTol(R) / rectSpan(R), pt / rectSpan(Rp));
            const mag = Math.max(1, Math.abs(Rp.left), Math.abs(Rp.right), Math.abs(Rp.top), Math.abs(Rp.bottom));
            const tk = Math.max(rectTol(R) * rectSpan(Rp) / rectSpan(R), 8 * Number.EPSILON * mag);
            // At the member's step, or both sides read at the kid's (F183).
            const door = () => arcsTouch(kidArcs, contactArcs(upRings, Rp, pt), at)
                || arcsTouch(kidArcs, contactArcs(E._inkOutline(up.obj, tk), Rp, tk), Math.max(rectTol(R) / rectSpan(R), tk / rectSpan(Rp)));
            if (near && kidArcs.length && door()) G.union(i, j);
            else if (inner.length) {
                const runs = inner.map(([a, b]) => [E.lm.mapPointF(a, from, up.level), E.lm.mapPointF(b, from, up.level)]).filter(([a, b]) => a && b);
                if (axisAbut(runs, upRings, pt) || axisAbut(runs, upRings, tk)) G.union(i, j);
            }
        }
    }
    const ids = members.map((_, i) => i);
    const unresolved = ids.filter((i) => E.lm.depthOf(members[i].level) == null);
    return { members, classes: G.classes(ids), unresolved };
}
