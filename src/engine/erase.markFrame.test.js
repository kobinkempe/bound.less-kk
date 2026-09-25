/**
 * A pending eraser mark seen from another frame is still a mask at the mark's current z
 * (REVIEWER E-5: a tile's copy of the mark lost `erase` — white ink — and kept the z it was
 * derived at while the mark's own z stepped down, so ink drawn after it could go under it).
 */
import { useEngines, mkEngine, drawStroke, eraseGesture } from "./__testkit__/harness";

useEngines();

test("EM-1 a mark magnified into a deeper frame is a mask, at its z now", () => {
    const E = mkEngine();
    drawStroke(E, [[250, 300], [550, 300]], 30);
    E._scheduleBake = () => {};                                        // the mark stays pending
    eraseGesture(E, [[300, 260], [500, 340]], 40);
    const mark = E._eraseStrokes()[0].obj;
    for (let i = 0; i < 3; i++) E.zoomFactorAt(400, 300, 16);
    expect(E.cam.frame).not.toBe(mark._home);                         // seen from another frame
    E._render();
    let pieces = E._lastList.filter((p) => p.id === mark.id);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p !== mark)).toBe(true);               // tile copies, not the native
    expect(pieces.every((p) => p.erase)).toBe(true);                 // red: white ink
    const z1 = E._zOf(mark) - 0.5;
    E.doc.setZById(mark.id, z1);                                       // the bake's step down
    E._render();
    pieces = E._lastList.filter((p) => p.id === mark.id);
    expect(pieces.every((p) => p.z === z1)).toBe(true);               // red: the z it was derived at
});
