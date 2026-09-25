/**
 * The live stroke is the same curve whether it is one path or frozen chunks and a short tail
 * (REVIEWER-2 D-1: one path's whole `d` was re-serialised on every pointer event — 1.2 ms at
 * 500 samples, 27 ms at 3,000 — and the ink trailed the pen on long scribbles).
 */
import Two from "two.js";
import { useEngines, mkEngine } from "./__testkit__/harness";

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
const anchors = (R) => {
    const paths = R._liveRoot.children.filter((c) => c !== R._live).concat([R._live]);
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

test("LC-1 a long stroke's tail stays short, and its chunks and tail are the one path's curve", () => {
    const pts = scribble(1500);
    const A = mkEngine();
    A.renderer.liveChunk = Infinity;
    drawLive(A, pts);
    const B = mkEngine();
    drawLive(B, pts);
    const chunks = B.renderer._liveRoot.children.length - 1;
    expect(chunks).toBeGreaterThan(3);
    expect(B.renderer._live.vertices.length).toBeLessThan(B.renderer.liveChunk + 40);   // red: every anchor in one path
    expect(A.renderer._liveRoot.children.length).toBe(1);
    const sa = anchors(A.renderer), sb = anchors(B.renderer);
    expect(sb.length).toBe(sa.length);
    expect(JSON.stringify(sb) === JSON.stringify(sa)).toBe(true);
    A.pointerUp(); B.pointerUp();
    expect(B.renderer._liveRoot).toBeNull();
});

test("LC-2 a translucent stroke's opacity is on the group, once, and each path is opaque inside it", () => {
    const E = mkEngine();
    drawLive(E, scribble(600), 0.4);
    const R = E.renderer;
    expect(R._liveRoot.opacity).toBeCloseTo(0.4, 9);
    for (const c of R._liveRoot.children) expect(c.opacity).toBe(1);
    E.pointerUp();
});
