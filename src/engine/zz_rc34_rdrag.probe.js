/* Scratch probe (R-MODEL-C34; deleted before hand-back): R-DRAG's skipped timings — the 5,000-native delete and its undo
 * (B-DRAG's fixture: N shapes on screen in "0", all selected), and the drop's TileStore.setBatch wrap with and without. */
import KobinEngine from "./KobinEngine";
import { rectLoop } from "./geometry/arcShape";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";

jest.setTimeout(1800000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const mk = (raster) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: 800, height: 600, raster, scenes: false });
};
const shapes = (E, frame, n, spread = 700, size = 6) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const x = -spread / 2 + ((i * 37) % spread), y = -spread / 2.6 + ((i * 53) % Math.round(spread / 1.3));
        const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: x, top: y, right: x + size, bottom: y + size }), color: "#246", opacity: 1, w: 2 };
        E.doc.add(o, frame); ids.push(o.id);
    }
    return ids;
};
beforeAll(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); setRasterTransport(() => new Promise(() => {})); });
afterAll(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test("delete 5,000 and undo", () => {
    const out = {};
    for (const raster of [false, true]) {
        const rows = [];
        for (let k = 0; k < 2; k++) {
            const E = mk(raster);
            E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 400, inPanY: 300 });
            const ids = shapes(E, "0", 5000);
            E._render();
            E._setSelection(ids, []);
            const a = now(); E.deleteSelection(); const del = now() - a;
            const b = now(); E.undo(); const und = now() - b;
            rows.push([Math.round(del), Math.round(und), E.doc.count("0")]);
            E.destroy();
        }
        out[raster ? "raster" : "svg"] = rows;
    }
    log("RDRAG-DELETE " + JSON.stringify(out));
});

test("the drop's setBatch wrap, with and without", () => {
    const run = (wrap) => {
        const E = mk(true);
        E.lm.ensureSpine(3);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const K = E.lm.cellChild("1", 3, 2);
        const ids = shapes(E, K.id, 2000, 60000, 400);
        for (let i = 0; i < 6; i++) { const f = E.lm.cellChild("1", 3 + (i % 3) * 40, 2 + Math.floor(i / 3) * 40); shapes(E, f.id, 200, 60000, 400); }
        E._render();
        // Cache tiles off screen: views of other cells, then back.
        for (const [x, y] of [[-4000, -2000], [5000, 3000], [-300, 4000]]) { E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400 + x, inPanY: 300 + y }); E._render(); }
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        E._render();
        const tiles0 = E.store.cache.size;
        if (!wrap) E.store.setBatch = () => {};
        E._setSelection(ids, []);
        const p = E._levelPointToScreen(K.id, 0, 0);
        E.setTool("select");
        E.pointerDown(p[0], p[1]); E.pointerMove(p[0] + 20, p[1]); E.pointerMove(p[0] + 40, p[1]);
        const a = now(); E.pointerUp(); const ms = now() - a;
        const rehomed = ids.filter((id) => E.doc.getById(id).level !== K.id).length;
        const res = { ms: Math.round(ms), rehomed, tiles0, tiles1: E.store.cache.size };
        E.destroy();
        return res;
    };
    const rows = [];
    for (let k = 0; k < 3; k++) rows.push({ wrap: run(true), none: run(false) });
    log("RDRAG-SETBATCH " + JSON.stringify(rows));
});
