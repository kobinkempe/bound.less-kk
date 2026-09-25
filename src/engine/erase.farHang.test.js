/**
 * F127 (REVIEWER-3 ERASE-3, lane seed 4133): an eraser used far from the other ink froze the tab.
 * `_candidatesUnder` maps the mark's box into every frame with a path; frame "0", six levels up and
 * six across, received it at x = 1.15e21 with no width, and the spatial index's cell walk from
 * floor(1.15e21 / 2048) stepped `cx++` on a float past 2^53, which is a no-op: it never ended.
 */
import Document from "./Document";
import KobinEngine from "./KobinEngine";

jest.setTimeout(20000);

const hosts = [];
afterEach(() => { while (hosts.length) { const h = hosts.pop(); try { h.E.destroy(); } catch (e) { /* torn down */ } h.host.remove(); } });

const stroke = (d, x) => d.add({ type: "stroke", origin: "native", id: d.allocId(), pts: [[x, 0], [x + 20, 10]], lwFrame: 4, color: "#000", opacity: 1 }, "0");

describe("F127 an eraser far from the ink returns", () => {
    test("FH-1 a query at astronomical coordinates returns at once, empty", () => {
        const d = new Document();
        stroke(d, 0); stroke(d, 40); stroke(d, 80);
        const t0 = Date.now();
        expect(d.queryRect("0", { left: 1.15e21, right: 1.15e21, top: 0, bottom: 1 })).toEqual([]);
        expect(d.queryRect("0", { left: -1e30, right: 1e30, top: -1, bottom: 1 }).length).toBe(3);   // a flat scan, not a walk
        expect(Date.now() - t0).toBeLessThan(1000);                                                    // red before: never returns
    });

    test("FH-2 the gesture: three strokes at level 0, five levels out, a pan, six levels in, an erase", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const E = new KobinEngine(host, { width: 800, height: 600, scenes: false });
        hosts.push({ E, host });
        E.setTool("pen"); E.setWidth(6);
        for (const y of [250, 300, 350]) { E.pointerDown(380, y); E.pointerMove(420, y + 5); E.pointerUp(); }
        E.flushBakes();
        for (let i = 0; i < 15; i++) E.zoomFactorAt(400, 300, 1 / 16);
        E.setTool("pan"); E.panBy(-1000, 0);
        for (let i = 0; i < 18; i++) E.zoomFactorAt(400, 300, 16);
        E.setEraserSize(12); E.setTool("erasePartial");
        E.pointerDown(380, 290); E.pointerMove(400, 300); E.pointerMove(420, 310); E.pointerUp();
        const t0 = Date.now();
        E.flushBakes(); E.flushErases();                                                              // red before: hangs
        expect(Date.now() - t0).toBeLessThan(10000);
        expect(E._eraseStrokes().length).toBe(0);                                                     // the mark is spent
    });
});
