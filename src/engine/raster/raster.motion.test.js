/**
 * The queue's motion from the renderer's published affine (`RasterRenderer._pyrMotion`, A3 §4.4): `vel.px` is the pan
 * alone. A zoom about the attention point moves the translation too; that part is the zoom's, which the velocity rule
 * applies from `vel.zoom` (counted twice, a 2 octave/s zoom-out aimed every view strip a screen away and dropped it).
 */
import { mkEngine, useEngines } from "../__testkit__/harness";
import { perfNow } from "../now";

useEngines();

const view = (k, tx, ty) => ({ frameId: "F", level: 3, S: 1, Z: 8, k, tx, ty });

test("a pure zoom about the attention point has no pan; a pan is its own px", () => {
    const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
    R._attn = [500, 260];
    R._pyrMot = { t: perfNow() - 16, k: 2, tx: 100, ty: 50, frame: "F", moving: false };
    const f = 0.9, a = R._attn;
    const z = R._pyrMotion(view(2 * f, a[0] - (a[0] - 100) * f, a[1] - (a[1] - 50) * f));
    expect(z.moving).toBe(true);
    expect(z.vel.zoom).toBeLessThan(0);
    expect(Math.abs(z.vel.px[0])).toBeLessThan(1e-9);           // red before: ~2.5 px/ms, the zoom's own translation
    expect(Math.abs(z.vel.px[1])).toBeLessThan(1e-9);
    R._pyrMot = { t: perfNow() - 10, k: 2, tx: 100, ty: 50, frame: "F", moving: false };
    const p = R._pyrMotion(view(2, 160, 50));
    expect(p.vel.zoom).toBe(0);
    expect(p.vel.px[0]).toBeGreaterThan(4);                       // 60 px in ~10 ms
    expect(p.vel.px[1]).toBe(0);
});
