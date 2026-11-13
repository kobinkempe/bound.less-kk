/**
 * A deep erase's landing without the work it did not need (Kobin, 2026-11-12: "remove any unnecessary calculations").
 * OPEN-FLAGS F198: a mark's candidates came from every level holding ink, each through a lattice path; now from the
 * frames whose reach meets the mark (`LevelMap.nearWalk`), asked the same way. F196: a descent's apply patched every
 * kid into the tiles and out again a step later, and each add walked every tile's chain; now the tiles take the net
 * change (`TileStore.holdAdds`) and a chain is walked once. The family check walks no chain past the family's top.
 */
import { useEngines, mkEngine, drawStroke, erase, topAt } from "./__testkit__/harness";
import { zOf } from "./eraseRule";
import { grown } from "./placementModel";
import { loopsBBox, loopsArea } from "./geometry/arcShape";

useEngines();
jest.setTimeout(300000);

/** The scan as it was before F198: every inked level. */
function oldCandidates(E, Erec, exclude) {
    const M = Erec.obj, HE = Erec.level, zE = zOf(M), box = loopsBBox(M.loops);
    if (!box) return [];
    const rectE = { left: box.x0, top: box.y0, right: box.x1, bottom: box.y1 }, out = new Set();
    const keep = (o) => !o.erase && !out.has(o.id) && !(exclude && exclude.has(o.id)) && zOf(o) < zE;
    for (const k of E.doc.levels()) {
        if (E.lm.frameFactor(k, HE) == null) continue;
        const r0 = E.lm.mapRectF(rectE, HE, k);
        if (!r0) continue;
        const r = grown(r0, E.stage.model.slack(k, HE));
        for (const o of E.doc.queryRect(k, r)) if (!E.doc.tableOf(o, k) && keep(o) && E._rectMayTouch(r, o)) out.add(o.id);
    }
    return [...out].sort((a, b) => a - b);
}
/** Each registration's candidates, new and old, and the paths each built from an empty cache. */
function watchCandidates(E) {
    const calls = [], orig = E._candidatesUnder, bp = E.lm._buildPath;
    let builds = 0;
    E.lm._buildPath = function (a, b) { builds++; return bp.call(this, a, b); };
    E._candidatesUnder = function (Erec, exclude = null) {
        E.lm._paths.clear();
        const b0 = builds, now = orig.call(this, Erec, exclude), b1 = builds;
        E.lm._paths.clear();
        const old = oldCandidates(this, Erec, exclude);
        calls.push({ now, old, newBuilds: b1 - b0, oldBuilds: builds - b1 });
        return now;
    };
    return calls;
}
const descendTo = (E, n, x, y) => { let g = 0; while (E.activeLevel < n && g++ < 4 * Math.abs(n) + 40) E.cam.zoomFactorAt(x, y, 16); };
const ascendTo = (E, n, x, y) => { let g = 0; while (E.activeLevel > n && g++ < 4 * Math.abs(E.activeLevel - n) + 40) E.cam.zoomFactorAt(x, y, 1 / 16); };

test("F198 a mark's candidates are the scan of every inked level's, from the frames near it alone", () => {
    const E = mkEngine(800, 600, { raster: true });
    drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");         // a bar at level 0, its top edge at y = 270
    for (let l = 1; l <= 60; l++) { descendTo(E, l, 437.3, 270); drawStroke(E, [[420, 250], [460, 250]], 4, "#3333aa"); }
    E._render();
    const calls = watchCandidates(E);
    erase(E, [[430, 230], [430, 290]], 20);                          // at level 60, across a stroke there and the bar's edge
    ascendTo(E, 0, 437.3, 270);
    E.cam.panBy(-6400 * E.cam.inScale, -6400 * E.cam.inScale);
    descendTo(E, 80, 400, 300);
    E._render();
    drawStroke(E, [[300, 300], [500, 300]], 10, "#aa0000");
    erase(E, [[400, 250], [400, 350]], 20);                          // a cut at level 80, the ink of 61 levels above it
    expect([...E.doc.displacedNatives()].length).toBe(0);            // the scans differ only in the level loop
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c.now).toEqual(c.old);
    expect(calls[0].now.length).toBeGreaterThan(1);                   // the bar and a stroke at least
    const last = calls[calls.length - 1];
    expect(last.oldBuilds).toBeGreaterThan(60);                       // a path an inked level (242 measured)
    expect(last.newBuilds).toBeLessThan(10);
});

test("F196 a 40-level cede lands the net change with no path a tile, and draws the same ink", () => {
    const D = 40;
    const run = (hold) => {
        const E = mkEngine(800, 600, { raster: true });
        E.lm.bulkRuns = false;   // F196's costs are a frame a level's
        if (!hold) E.store.holdAdds = (fn) => fn();
        drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");      // its top edge is y = 270
        descendTo(E, D, 437.3, 270);
        E._render();
        let maps = 0, adds = 0;
        const m = E.store._mapRect, a = E.store._addObject;
        E.store._mapRect = function (...x) { maps++; return m.apply(this, x); };
        E.store._addObject = function (...x) { adds++; return a.apply(this, x); };
        erase(E, [[600, 270], [700, 270]], 30);                      // a notch in the bar's edge, D levels below it
        E.store._mapRect = m; E.store._addObject = a;
        E._render();
        const ink = [];
        for (const x of [560, 590, 600, 615, 650, 685, 700, 710, 740]) {
            for (const y of [240, 255, 262, 270, 278, 285, 300]) { const t = topAt(E, x, y); ink.push(t ? t.color : null); }
        }
        let n = 0;
        for (const k of E.doc.levels()) n += E.doc.at(k).length;
        return { maps, adds, ink, n };
    };
    const held = run(true), each = run(false);
    expect(held.n).toBe(each.n);
    expect(held.ink).toEqual(each.ink);
    expect(held.ink.filter((c) => c === "#000000").length).toBeGreaterThan(5);
    expect(held.ink.filter((c) => c === null).length).toBeGreaterThan(5);   // the notch
    expect(held.adds).toBeLessThan(each.adds * 0.7);                        // the kids are never patched in
    expect(held.maps).toBeLessThan(each.maps / 4);
});

test("F196 the family check walks no chain past the family's shallowest member", () => {
    const E = mkEngine(800, 600);
    descendTo(E, 5, 437.3, 270);
    drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");          // a bar at level 5, its top edge at y = 270
    descendTo(E, 105, 437.3, 270);
    E._render();
    erase(E, [[600, 270], [700, 270]], 30);                            // a family from level 5 to 105
    const sizes = new Map();
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) { const key = E.doc.editKey(o); sizes.set(key, (sizes.get(key) || 0) + 1); }
    const [key, n] = [...sizes].sort((a, b) => b[1] - a[1])[0];
    expect(n).toBeGreaterThan(90);
    const pu = E.lm.pointsUpChain.bind(E.lm);
    let top = Infinity, calls = 0;
    E.lm.pointsUpChain = (pts, from, minDepth) => { calls++; const m = pu(pts, from, minDepth); for (const id of m.keys()) top = Math.min(top, E.lm.depthOf(id)); return m; };
    E._door = null;
    expect(E._familyComponents(key).classes.length).toBe(1);
    expect(calls).toBeGreaterThan(0);
    expect(top).toBe(5);                                               // the bar's level, not the root's
});

/** A tile piece's signature without its id: what it paints. */
const pieceSig = (p) => {
    const b = p.loops ? loopsBBox(p.loops) : null;
    return [p.type, p.z, p.color, p.opacity, p.editId, b ? [b.x0, b.y0, b.x1, b.y1].join(":") : JSON.stringify(p.polys || p.pts || null),
        p.loops ? loopsArea(p.loops) : 0].join(",");
};

test("F196 a descent capped at 8 crossings a job lands what one job lands, no apply deeper than 8", () => {
    const D = 40;
    const run = (links, rename = true) => {
        const E = mkEngine(800, 600, { raster: true });
        E.lm.bulkRuns = false;
        E._descentLinks = links;
        if (!rename) E.store.continues = () => {};
        const au = E.store._appendUp;
        let ups = 0;
        E.store._appendUp = function (...a) { ups++; return au.apply(this, a); };
        drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");      // its top edge is y = 270
        descendTo(E, D, 437.3, 270);
        E._render();
        const spans = [], ad = E._applyDescent;
        E._applyDescent = function (Erec, target, r) {
            const d0 = this.lm.depthOf(target.level), done = ad.call(this, Erec, target, r);
            let d1 = d0;
            for (const st of r.steps || []) for (const sp of st.kids) d1 = Math.max(d1, this.lm.depthOf(sp.level));
            spans.push(d1 - d0);
            return done;
        };
        ups = 0;
        erase(E, [[600, 270], [700, 270]], 30);
        delete E._applyDescent;
        const tiles = new Map();
        for (const [key, t] of E.store.cache) tiles.set(key, t.objs.map(pieceSig).sort());
        E._render();
        const ink = [];
        for (const x of [560, 590, 600, 615, 650, 685, 700, 710, 740]) {
            for (const y of [240, 255, 262, 270, 278, 285, 300]) { const t = topAt(E, x, y); ink.push(t ? t.color : null); }
        }
        const natives = [];
        for (const k of E.doc.levels()) {
            for (const o of E.doc.at(k)) {
                if (o.erase) continue;
                const b = loopsBBox(o.loops);
                natives.push([E.lm.depthOf(k), zOf(o), o.color, b.x0, b.y0, b.x1, b.y1, loopsArea(o.loops)].join(","));
            }
        }
        return { spans, ink, natives: natives.sort(), marks: E._eraseStrokes().length, tiles, ups };
    };
    const one = run(Infinity), capped = run(8), plain = run(8, false);
    expect(one.spans).toEqual([D]);
    expect(capped.spans.length).toBeGreaterThanOrEqual(D / 8);         // a kid on two squares continues as two jobs
    expect(Math.max(...capped.spans)).toBe(8);
    expect(capped.marks).toBe(0);                                      // spent: every continuation ran
    expect(capped.natives).toEqual(one.natives);                       // the same pieces, bit for bit
    expect(capped.ink).toEqual(one.ink);
    expect(capped.ink.filter((c) => c === null).length).toBeGreaterThan(5);   // the notch
    // The tiles end as one job's patch leaves them: no renamed piece outlives its kid.
    let common = 0;
    for (const [key, sigs] of one.tiles) { const c = capped.tiles.get(key); if (!c) continue; common++; expect(c).toEqual(sigs); }
    expect(common).toBeGreaterThan(D / 2);
    // Each job's last kid is renamed into the tiles deep in its window, not derived into each again.
    expect(capped.ups).toBeLessThan(0.6 * plain.ups);
    expect(plain.natives).toEqual(one.natives);
});

test("F196 the family check asks no pair already joined: a kid's parent on a chain, a cut-off island's coarser members", () => {
    const E = mkEngine(800, 600);
    drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");          // its top edge is y = 270
    descendTo(E, 60, 437.3, 270);
    E._render();
    /** An erase's landing with no answer kept: the pairs its family checks asked, and what each check found. */
    const landing = (pts, w) => {
        const ja = E._joinedAbove, fc = E._familyComponents, checks = [];
        let n = 0;
        E._joinedAbove = function (...a) { n++; return ja.apply(this, a); };
        E._familyComponents = function (key) { const c = fc.call(this, key); checks.push([c.members.length, c.classes.length]); return c; };
        E._doors = null;
        erase(E, pts, w);
        delete E._joinedAbove; delete E._familyComponents;
        return { n, members: checks.reduce((s, c) => s + c[0], 0), classes: Math.max(0, ...checks.map((c) => c[1])) };
    };
    const chain = landing([[600, 270], [700, 270]], 30);              // a notch: a family from level 0 to 60
    expect(chain.members).toBeGreaterThan(55);
    expect(chain.classes).toBe(1);
    expect(chain.n).toBeLessThan(2 * chain.members);                  // a kid's parent alone, not every coarser member
    const island = landing([[550, 350], [650, 350], [650, 450], [550, 450], [550, 350]], 16);   // a ring below the edge
    expect(island.classes).toBeGreaterThan(1);                         // cut off; the classes are the rule's (the harness checks)
    expect(island.n).toBeLessThan(4 * island.members);                // the island meets each coarser member once
});
