/**
 * Far-from-origin rendering must stay float32-safe (the "pixelly strokes"
 * bug, 2026-07-13): browsers rasterize SVG path data in float32, so a vertex
 * at frame coordinate ~8e6 snapped to a ~0.5-unit grid (~8 px on screen at
 * inScale 15). Zoom-out → pan → zoom-in manufactures such coordinates, and
 * strokes drawn out there keep them forever. The Renderer therefore stores
 * every anchor relative to a per-scene origin and folds the origin back into
 * the world transform in float64 — nothing large may ever reach Two.js.
 */
import KobinEngine from "./KobinEngine";

const hosts = [];
const mk = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    return new KobinEngine(host, { width: 800, height: 600 });
};
afterEach(() => { while (hosts.length) hosts.pop().remove(); });

const draw = (E, pts) => {
    E.pointerDown(...pts[0]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(...pts[i]);
    E.pointerUp();
};

const maxAnchorMag = (group) => {
    let m = 0;
    const scan = (node) => {
        if (node.vertices) for (const v of node.vertices) m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
        if (node.children) for (const c of node.children) scan(c);
    };
    scan(group);
    return m;
};

test("strokes drawn far from the level origin render with small path coordinates", () => {
    const E = mk();
    // Pan the view millions of frame units away (the zoom-out→pan→zoom-in
    // aftermath, minus the crossings — what matters is coordinate magnitude).
    E.panBy(-2.5e6, 0);
    // The pan itself must have re-anchored the scene near the new view center.
    const sc = E.renderer._scenes.get(E.activeLevel);
    expect(Math.abs(sc.origin.x)).toBeGreaterThan(1.5e6);
    expect(E.renderer.needsReorigin()).toBe(false);
    // Draw here: native coordinates are genuinely huge…
    draw(E, [[300, 250], [420, 300], [380, 380], [280, 330]]);
    const natives = E.doc.at(E.activeLevel);
    const o = natives[natives.length - 1];
    const nativeMag = Math.max(...o.pts.flat().map(Math.abs));
    expect(nativeMag).toBeGreaterThan(1.5e6);
    // …but everything handed to Two.js is origin-relative and float32-safe.
    const entry = E.renderer._groups.get(o.id);
    expect(entry).toBeTruthy();
    const m = maxAnchorMag(entry.group);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1e4);
    // The folded world translation is ~screen-sized, not ~inPan-sized (float64
    // cancellation of inPan against inScale·origin happens in the Renderer).
    expect(Math.abs(E.renderer.world.translation.x)).toBeLessThan(1e5);
    expect(Math.abs(E.renderer.world.translation.y)).toBeLessThan(1e5);
    E.destroy();
});

test("the live stroke shares the scene origin (no mid-gesture reorigin)", () => {
    const E = mk();
    E.panBy(-2.5e6, 0);
    E.pointerDown(300, 250);
    E.pointerMove(420, 300);
    // Live path anchors must be origin-relative like finalized ones…
    const live = E.renderer._live;
    expect(live).toBeTruthy();
    let m = 0;
    for (const v of live.vertices) m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
    expect(m).toBeLessThan(1e4);
    // …and a reorigin can never fire under the pen.
    expect(E.renderer.needsReorigin()).toBe(false);
    E.pointerUp();
    E.destroy();
});

test("near the origin nothing changes: anchors stay in plain frame coordinates", () => {
    const E = mk();
    draw(E, [[100, 100], [200, 150], [150, 220]]);
    const natives = E.doc.at(E.activeLevel);
    const o = natives[natives.length - 1];
    const entry = E.renderer._groups.get(o.id);
    // Origin is the initial view center (~(400,300) in frame units): anchors
    // sit within one screen of it.
    expect(maxAnchorMag(entry.group)).toBeLessThan(2e3);
    E.destroy();
});
