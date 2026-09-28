/**
 * An erase's bake takes its targets from one candidate scan per mark — its registration, when its
 * shape lands (A2 §4.2) — and does not repaint after every slice (REVIEWER E-1: the scan was rebuilt
 * twice per target, 85 ms of overhead a target on the Magnum Opus; E-2: a full render after every
 * slice and every landed cut, though a pending mark's cuts change no pixel until it is spent).
 */
import { useEngines, mkEngine, eraseGesture, drawStroke } from "./__testkit__/harness";


jest.setTimeout(120000);
useEngines();

// Organic strokes: wiggly paths of many samples, so each cut costs more than a slice.
const wiggles = (E, n) => {
    for (let i = 0; i < n; i++) {
        const pts = [];
        for (let k = 0; k <= 80; k++) {
            const t = k / 80;
            pts.push([200 + t * 400, 150 + i * (300 / n) + 18 * Math.sin(t * 40 + i) + 7 * Math.sin(t * 91 + 2 * i)]);
        }
        drawStroke(E, pts, 9);
    }
};
const setup = () => {
    const E = mkEngine();
    wiggles(E, 24);
    E._render();
    eraseGesture(E, [[250, 150], [550, 450]], 30);    // a diagonal band across the grid
    E.flushBakes();
    return E;
};
const bytes = (E) => {
    const n = E.doc.serializeNatives();
    return JSON.stringify(Object.keys(n).sort().map((k) => [k, n[k].map((o) => JSON.stringify(o.loops || o.polys)).sort()]));
};

describe("EC — the cost of an erase's bake", () => {
    test("EC-1 one candidate scan per mark over a bake of many targets", () => {
        const E = setup();
        const before = E._scanBuilds || 0;
        E.flushErases();
        expect((E._scanBuilds || 0) - before).toBe(0);                     // red: two per target
    });
    test("EC-3 the idle bake scans no more than a flush: the scan is the registration's", () => {
        const E = setup();
        expect(E._eraseStrokes()[0].obj.targets.length).toBeGreaterThan(10);   // registered at the landing
        const before = E._scanBuilds || 0;
        let slices = 0;
        for (let k = 0; k < 500 && E._eraseStrokes().length; k++) { E._bakeTickInner(); slices++; }
        expect(slices).toBeGreaterThan(1);                                  // the path under test ran, in slices
        expect((E._scanBuilds || 0) - before).toBe(0);                     // red: a scan a slice or a target
    });
    test("EC-2 the idle bake repaints a handful of times, not once per slice, and ends where a flush ends", async () => {
        const E = setup();
        const F = setup();
        F.flushErases();
        const renders = jest.spyOn(E, "_render");
        for (let k = 0; k < 500 && E._eraseStrokes().length; k++) E._bakeTickInner();
        await new Promise((r) => setTimeout(r, 200));
        expect(E._eraseStrokes().length).toBe(0);
        expect(renders.mock.calls.length).toBeLessThanOrEqual(4);          // red: one per slice
        expect(bytes(E)).toBe(bytes(F));
    });
});
