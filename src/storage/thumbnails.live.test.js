/**
 * The live thumbnail path (SCENES-PLAN S2) against a fake engine: the hash gate, the in-flight
 * cap, the abort, and the fallback contract when a snapshot cannot be made. jsdom has no canvas
 * context, so every snapshot here ends in `missed` — which is exactly the fallback the old path
 * takes; the scaling itself is a browser fact.
 */
import { renderThumbsLive } from "./thumbnails";

const scene = (id, hash) => ({ id, hash, level: "0", rect: { x: 0, y: 0, w: 10, h: 10 } });

function fakeEngine(opts = {}) {
    let inFlight = 0, peak = 0;
    const calls = [];
    return {
        raster: opts.raster !== false,
        peak: () => peak,
        calls,
        snapshotView(req) {
            calls.push(req.frame);
            inFlight++; peak = Math.max(peak, inFlight);
            return new Promise((r) => setTimeout(() => { inFlight--; r(opts.bitmap === undefined ? { width: 512, height: 512, close() {} } : opts.bitmap); }, 5));
        },
    };
}

test("only scenes whose hash changed are snapshotted, at most four at a time", async () => {
    const E = fakeEngine();
    const scenes = [scene("a", "h1"), scene("b", "h2"), scene("c", "h3"), scene("d", "h4"), scene("e", "h5"), scene("f", "h6")];
    const existing = { a: { hash: "h1", data: "x" }, b: { hash: "old", data: "y" } };
    const r = await renderThumbsLive(E, scenes, existing);
    expect(E.calls.length).toBe(5);                              // a's hash matched; b's did not
    expect(E.peak()).toBeLessThanOrEqual(4);
    // jsdom: no canvas context, so each is missed for the old path — never a wrong data URL
    expect(r.missed.map((s) => s.id).sort()).toEqual(["b", "c", "d", "e", "f"]);
    expect(Object.keys(r.out)).toEqual([]);
});

test("raster off, or a snapshot that resolves null, hands every scene to the old path", async () => {
    const r1 = await renderThumbsLive(fakeEngine({ raster: false }), [scene("a", "h")], {});
    expect(r1.missed.length).toBe(1);
    const E = fakeEngine({ bitmap: null });
    const r2 = await renderThumbsLive(E, [scene("a", "h"), scene("b", "h")], {});
    expect(E.calls.length).toBe(2);
    expect(r2.missed.length).toBe(2);
});

test("an aborted signal stops the queue", async () => {
    const E = fakeEngine();
    const ctl = new AbortController();
    ctl.abort();
    const r = await renderThumbsLive(E, [scene("a", "h"), scene("b", "h")], {}, { signal: ctl.signal });
    expect(E.calls.length).toBe(0);
    expect(r.missed.length).toBe(0);                             // nothing tried, nothing to fall back on
});
