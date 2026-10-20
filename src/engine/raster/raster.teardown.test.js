/**
 * raster.teardown.test.js — a closed canvas leaves nothing in the raster module state the next canvas shares (the heap
 * snapshots of 2026-10-13: the pack memo held ~560 MB of a closed Magnum Opus's pieces, and the worker client's
 * slot-freed pump held its renderer and engine).
 */
import KobinEngine from "../KobinEngine";
import { resetRasterWorkerClient, setRasterWorkerCount, _slotFreedForTests } from "./rasterWorkerClient";
import { itemBox, packStats, resetPackStats } from "./rasterPack";

function open() {
    resetRasterWorkerClient(); setRasterWorkerCount(1);
    const host = document.createElement("div");
    document.body.appendChild(host);
    return { E: new KobinEngine(host, { width: 400, height: 300, raster: true, scenes: false }), host };
}
afterEach(() => setRasterWorkerCount(null));

test("closing a canvas empties the pack memo, which held its pieces and, through its records, its Stage", () => {
    const { E, host } = open();
    const fill = { type: "fill", origin: "native", id: E.doc.allocId(), color: "#123456", opacity: 1,
        polys: [[[0, 0], [50, 0], [50, 40], [0, 40]]] };
    E.doc.add(fill, "0");
    expect(itemBox(fill, E.cfg)).toBeTruthy();
    resetPackStats();
    expect(packStats.memoEntries).toBeGreaterThan(0);
    E.destroy();
    host.remove();
    resetPackStats();
    expect(packStats.memoEntries).toBe(0);       // red before: the memo kept the closed canvas's entries
});

test("closing a canvas lets go of the worker client's slot-freed pump, and only its own", () => {
    const a = open();
    expect(typeof _slotFreedForTests()).toBe("function");
    a.E.destroy(); a.host.remove();
    expect(_slotFreedForTests()).toBe(null);      // red before: the pump's closure held the renderer and its engine
    const b = open(), mine = _slotFreedForTests();
    const c = open();                              // the newer canvas's pump replaces it...
    b.E.destroy(); b.host.remove();
    expect(_slotFreedForTests()).not.toBe(null);   // ...and the older one's teardown leaves the newer one's
    expect(_slotFreedForTests()).not.toBe(mine);
    c.E.destroy(); c.host.remove();
    expect(_slotFreedForTests()).toBe(null);
});
