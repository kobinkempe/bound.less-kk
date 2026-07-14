/**
 * jumpTo must reach NEGATIVE levels: their own crossing record never exists
 * (a level below zero is defined by the records of the levels above it), so
 * guarding on lm.get(level) wrongly rejected them — the "can't click scene
 * Everything" bug (2026-07-13).
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

test("jumpTo reaches a negative level created by zooming out", () => {
    const E = mk();
    draw(E, [[100, 100], [200, 150], [150, 220]]);
    // Zoom OUT far enough to cross below level 0 (exit = 0.05).
    E.zoomFactorAt(400, 300, 0.01);
    expect(E.activeLevel).toBeLessThan(0);
    const negLevel = E.activeLevel;
    const win = E._frameWindow(0);
    const rect = { x: win.left, y: win.top, w: win.right - win.left, h: win.bottom - win.top };
    // Draw here too, then return to level 0 territory…
    draw(E, [[300, 300], [380, 340]]);
    E.zoomFactorAt(400, 300, 200);
    expect(E.activeLevel).toBeGreaterThanOrEqual(0);
    // …and jump back to the negative-level frame.
    expect(E.jumpTo(negLevel, rect)).toBe(true);
    expect(E.activeLevel).toBe(negLevel);
    E.destroy();
});

test("jumpTo still rejects unreachable levels", () => {
    const E = mk();
    draw(E, [[100, 100], [200, 150]]);
    expect(E.jumpTo(5, { x: 0, y: 0, w: 100, h: 100 })).toBe(false);
    expect(E.jumpTo(-3, { x: 0, y: 0, w: 100, h: 100 })).toBe(false);
    E.destroy();
});
