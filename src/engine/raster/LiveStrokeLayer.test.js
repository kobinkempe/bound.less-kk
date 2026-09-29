/**
 * LiveStrokeLayer — the stroke under the pen (A3 §7.2). LS-1/LS-2 are the frozen chunks of REVIEWER-2 D-1 (one
 * path's whole `d` was re-serialised on every pointer event — 1.2 ms at 500 samples, 27 ms at 3,000 — and the ink
 * trailed the pen); LS-3/LS-4 the origin's one writer (FC6) and a held path re-anchored by its move (F131);
 * LS-5 hold, release and cancel.
 */
import Two from "two.js";
import { useEngines, mkEngine } from "../__testkit__/harness";
import LiveStrokeLayer from "./LiveStrokeLayer";

useEngines();

const scribble = (n) => {
    const pts = [];
    for (let k = 0; k < n; k++) { const t = k / n; pts.push([100 + 600 * t + 30 * Math.sin(t * 80), 300 + 120 * Math.sin(t * 13) + 20 * Math.cos(t * 97)]); }
    return pts;
};
const drawLive = (E, pts, opacity = 1) => {
    E.setTool("pen"); E.setWidth(6); E.setOpacity(opacity);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
};
/** The anchors in drawing order: the frozen chunks, then the tail; a junction's handle is the tail's move's. */
const anchors = (L) => {
    const paths = L.root.children.filter((c) => c !== L.tail).concat([L.tail]);
    const out = [];
    for (const p of paths) {
        p.vertices.forEach((a, i) => {
            // a missing handle is a zero one (Two's own reading; a new Path gives its anchors zero handles)
            const rec = { x: a.x, y: a.y, c: a.command, l: a.controls ? [a.controls.left.x, a.controls.left.y] : [0, 0], r: a.controls ? [a.controls.right.x, a.controls.right.y] : [0, 0] };
            if (i === 0 && out.length && a.command === Two.Commands.move) { out[out.length - 1].r = rec.r; return; }
            out.push(rec);
        });
    }
    return out;
};
const PLAN = { enter: 256, tol: 0.25, segMax: 0 };
const dot = (id, x, y) => ({ id, color: "#000", lwFrame: 4, opacity: 1, pts: [[x, y]] });
/** Where a root's first anchor lands in the parent's units: its own position plus the root's translation. */
const placed = (root) => { const a = root.children[0].vertices[0]; return [a.x + root.translation.x, a.y + root.translation.y]; };

test("LS-1 a long stroke's tail stays short, and its chunks and tail are the one path's curve", () => {
    const pts = scribble(1500);
    const A = mkEngine();
    A.renderer.live.chunk = Infinity;
    drawLive(A, pts);
    const B = mkEngine();
    drawLive(B, pts);
    const LA = A.renderer.live, LB = B.renderer.live;
    expect(LB.root.children.length - 1).toBeGreaterThan(3);
    expect(LB.tail.vertices.length).toBeLessThan(LB.chunk + 40);   // red: every anchor in one path
    expect(LA.root.children.length).toBe(1);
    const sa = anchors(LA), sb = anchors(LB);
    expect(sb.length).toBe(sa.length);
    expect(JSON.stringify(sb) === JSON.stringify(sa)).toBe(true);
    A.pointerUp(); B.pointerUp();
    expect(LB.root).toBeNull();
    expect(LB.group.children.length).toBe(0);                      // the SVG path holds nothing past pen-up
});

test("LS-2 a translucent stroke's opacity is on the root, once, and each path is opaque inside it", () => {
    const E = mkEngine();
    drawLive(E, scribble(600), 0.4);
    const L = E.renderer.live;
    expect(L.root.opacity).toBeCloseTo(0.4, 9);
    for (const c of L.root.children) expect(c.opacity).toBe(1);
    E.pointerUp();
});

test("LS-3 the origin is one object: an equal value keeps it, a moved one replaces it", () => {
    const L = new LiveStrokeLayer(new Two.Group(), PLAN);
    const a = { x: 100, y: 50 };
    L.begin(dot(1, 110, 60), a); L.arcs([]);
    expect(L.origin).toBe(a);
    L.begin(dot(2, 120, 70), { x: 100, y: 50 });                   // a fresh literal of the same value
    expect(L.origin).toBe(a);                                       // FC6: a decision cached on it survives
    const b = { x: 900, y: -40 };
    L.begin(dot(3, 910, -30), b);
    expect(L.origin).toBe(b);
    L.arcs([]);
    expect(L.tail.vertices[0].x).toBe(10);                         // anchors relative to the origin it began at
    expect(L.tail.vertices[0].y).toBe(10);
});

test("LS-4 a held path stays put when the next stroke moves the origin (F131)", () => {
    const L = new LiveStrokeLayer(new Two.Group(), PLAN);
    L.begin(dot(1, 130, 70), { x: 100, y: 50 }); L.arcs([]);
    const h = L.hold();
    // In the parent's units, relative to the world's origin — the layer's current one.
    const before = placed(h.root).map((v, k) => v + [100, 50][k]);
    expect(before).toEqual([130, 70]);
    L.begin(dot(2, 1000, 1000), { x: 4000, y: -2000 }); L.arcs([]);
    const after = placed(h.root).map((v, k) => v + [4000, -2000][k]);
    expect(after).toEqual([130, 70]);                               // red without the re-anchor: thousands of units off
    expect(placed(L.root).map((v, k) => v + [4000, -2000][k])).toEqual([1000, 1000]);
});

test("LS-5 hold keeps the root until release(id); cancel and a new begin leave no orphan; an empty layer is not drawn", () => {
    const parent = new Two.Group();
    const L = new LiveStrokeLayer(parent, PLAN);
    const attached = () => parent.children.includes(L.group);
    expect(attached()).toBe(false);                                // empty: not in the drawing's <svg>
    L.begin(dot(7, 0, 0), { x: 0, y: 0 }); L.arcs([]);
    expect(attached()).toBe(true);
    const h = L.hold();
    expect(attached()).toBe(true);                                 // a held path is still drawn
    expect([h.id, L.root, L.tail, L.model]).toEqual([7, null, null, null]);
    expect(L.group.children.includes(h.root)).toBe(true);
    expect(L.release(8)).toBe(false);
    expect(L.release(7)).toBe(true);
    expect(L.group.children.includes(h.root)).toBe(false);
    expect(L.held.length).toBe(0);
    expect(attached()).toBe(false);
    L.begin(dot(9, 0, 0), { x: 0, y: 0 });
    const first = L.root;
    L.begin(dot(10, 0, 0), { x: 0, y: 0 });                        // a press while a stroke is open
    expect(L.group.children.includes(first)).toBe(false);
    L.cancel();
    expect(L.group.children.length).toBe(0);
    expect(attached()).toBe(false);
    L.begin(dot(11, 0, 0), { x: 0, y: 0 }); L.hold();
    L.destroy();
    expect([attached(), L.held.length]).toEqual([false, 0]);
});
