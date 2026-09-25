/**
 * The engine's read-only switch (SYNC-PLAN R2): while another tab or device has the pen, every
 * press pans, whatever the tool, and undo, redo and clear refuse. The document does not change.
 */
import KobinEngine from "./KobinEngine";

const engines = [];
const mkEngine = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: 800, height: 600, onStatus: () => {} });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });
const count = (e) => Object.values(e.nativesByLevel).reduce((n, a) => n + a.length, 0);
function stroke(e, x = 100) {
    e.pointerDown(x, 100);
    for (let i = 1; i <= 6; i++) e.pointerMove(x + i * 12, 100 + i * 7);
    e.pointerUp();
}

test("read-only: a press pans with any tool, and undo, redo and clear refuse", () => {
    const e = mkEngine();
    stroke(e);
    expect(count(e)).toBe(1);
    e.readOnly = true;
    for (const tool of ["pen", "erasePartial", "erase", "select"]) {
        e.setTool(tool);
        const before = JSON.stringify(e.cam.state());
        stroke(e, 300);
        expect(count(e)).toBe(1);
        expect(JSON.stringify(e.cam.state())).not.toBe(before);   // it panned
    }
    expect(e.undo()).toBe(false);
    expect(e.redo()).toBe(false);
    e.clear();
    expect(count(e)).toBe(1);
    e.readOnly = false;
    e.setTool("pen");
    expect(e.undo()).toBe(true);
    expect(count(e)).toBe(0);
});
