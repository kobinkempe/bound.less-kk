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
import { HALF_W, W } from "./frameLattice";

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

test("a long pan cannot manufacture huge coordinates any more", () => {
    // THIS IS THE FIX, not the symptom. A pan of millions of frame units used
    // to leave the ink out there for ever, and the Renderer's per-scene origin
    // was what kept float32 from tearing it into a grid. A frame is a lattice
    // CELL now and the camera SHIFTS into the cell it walks into, so the
    // coordinates come back by construction: a 2.5e6-unit pan lands about 19
    // cells along and the view sits a few thousand units from that cell's
    // origin. Nothing anywhere is ever far from an origin again.
    const E = mk();
    const from = E.cam.frame;
    E.panBy(-2.5e6, 0);
    expect(E.cam.frame).not.toBe(from);                    // it shifted cells
    expect(E.lm.depthOf(E.cam.frame)).toBe(E.lm.depthOf(from));   // ...sideways, not deeper
    draw(E, [[300, 250], [420, 300], [380, 380], [280, 330]]);
    const natives = E.doc.at(E.cam.frame);
    const o = natives[natives.length - 1];
    const nativeMag = Math.max(...o.pts.flat().map(Math.abs));
    expect(nativeMag).toBeLessThan(HALF_W + W);            // inside its own cell
    // ...and what reaches Two.js is smaller still.
    const entry = E.renderer._groups.get(o.id);
    expect(entry).toBeTruthy();
    const m = maxAnchorMag(entry.group);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1e4);
    expect(Math.abs(E.renderer.world.translation.x)).toBeLessThan(1e5);
    expect(Math.abs(E.renderer.world.translation.y)).toBeLessThan(1e5);
    E.destroy();
});

test("the per-scene origin still earns its keep inside one cell", () => {
    // The lattice bounds a coordinate by the frame, not by float32. A cell is
    // 131,072 units and float32 carries 24 bits of mantissa, so an anchor at the
    // far edge of a cell resolves to 0.0078 units — two whole pixels at the
    // deepest in-level zoom. The Renderer's origin-relative anchors are what
    // close that gap, and they still have to.
    const E = mk();
    E.panBy(-(HALF_W - 4096), 0);                     // hard against the cell edge
    expect(E.cam.frame).toBe("0");                    // ...without leaving it
    draw(E, [[300, 250], [420, 300], [380, 380]]);
    const natives = E.doc.at(E.cam.frame);
    const o = natives[natives.length - 1];
    expect(Math.max(...o.pts.flat().map(Math.abs))).toBeGreaterThan(5e4);
    // At this zoom the budget is not close: 6e4 frame units of drift is 0.007 px
    // of float32 error, so nothing has to happen and nothing does.
    expect(E.renderer.needsReorigin()).toBe(false);
    const drifted = maxAnchorMag(E.renderer._groups.get(o.id).group);
    expect(drifted).toBeGreaterThan(5e4);             // large, and harmlessly so
    // Zoom in within the level and the same drift becomes millions of screen px,
    // which IS the budget. The engine promotes the zoom to a full render, the
    // scene re-anchors, and the anchors come back down — so the check is the
    // outcome, not the flag, which by then has already done its job.
    E.zoomFactorAt(400, 300, 100);
    expect(E.activeLevel).toBe(0);                    // still in the level
    expect(E.renderer.needsReorigin()).toBe(false);   // ...because it just fired
    const entry = E.renderer._groups.get(o.id);
    expect(maxAnchorMag(entry.group)).toBeLessThan(1e4);
    E.destroy();
});

test("the live stroke shares the scene origin (no mid-gesture reorigin)", () => {
    const E = mk();
    E.panBy(-2.5e6, 0);   // shifts cells; the pen must not notice
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
