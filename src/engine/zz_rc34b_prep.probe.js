/* Scratch probe (R-MODEL-C34b; deleted before hand-back): does frame GC forget the picture sources `_prepareView` minted,
 * so the next render mints them again? Frames counted after each render and GC over stroke/undo/redo cycles. */
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";
import { W } from "./frameLattice";
import TileStore from "./TileStore";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";
const C = { bake: 0, forget: 0, drop: 0 };
for (const n of ["_bakeUp", "_bakeDown"]) { const f = TileStore.prototype[n]; TileStore.prototype[n] = function (...a) { C.bake++; return f.apply(this, a); }; }
{ const f = TileStore.prototype.forgetFrame; TileStore.prototype.forgetFrame = function (...a) { C.forget++; return f.apply(this, a); }; }
beforeAll(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); setRasterTransport(() => new Promise(() => {})); });
afterAll(() => { setRasterTransport(null); resetRasterWorkerClient(); });

useEngines();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };

test("prepare's mints and frame GC", () => {
    const rows = [];
    for (const raster of [false, true]) for (const [sx, sy] of [[1.3, 0], [2.3, -1.2]]) {
        const E = mkEngine(800, 600, { raster, scenes: false });
        if (E.plates) { const f = E.plates.dropFrames.bind(E.plates); E.plates.dropFrames = (...a) => { C.drop++; return f(...a); }; }
        E.lm.ensureSpine(2);
        E.cam.set({ frame: "2", activeLevel: 2, inScale: 1, inPanX: 400, inPanY: 300 });
        E._render();
        drawStroke(E, [[300, 300], [500, 320]]);
        E.doc.setFrameShift("2", [Math.round(sx * W), Math.round(sy * W)]);
        const ids = () => [...E.lm.frames.keys()].sort().join(" ");
        const prep = E.store.prepare.bind(E.store);
        let mints = 0;
        E.store.prepare = (F) => { const n = prep(F); mints += n; return n; };
        E._render();
        const r = { raster, shift: [sx, sy], afterShift: E.lm.frames.size, mints0: mints, seq: [] };
        C.bake = 0; C.forget = 0; C.drop = 0;
        for (let k = 0; k < 3; k++) {
            drawStroke(E, [[100 + 40 * k, 100], [140 + 40 * k, 160]]);
            const a = E.lm.frames.size;
            E.undo();
            const b = E.lm.frames.size;
            E._render();
            const c = E.lm.frames.size;
            E.redo();
            const d = E.lm.frames.size;
            E._render();
            r.seq.push([a, b, c, d, E.lm.frames.size, mints, C.bake, C.forget, C.drop]);
        }
        r.frames = ids();
        rows.push(r);
    }
    log("PREP-GC " + JSON.stringify(rows));
});
