/**
 * A lasso that encloses a frame does not take a ceded kid under it whose family (the stroke it was
 * cut from) the loop does not bound (REVIEWER-3 LASSO-1: the frame was one entry with no family
 * test, and a drag tore the patch out of the stroke — a rectangular hole where you erased).
 */
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";

useEngines();

const at = [400, 301];
const lasso = (E, pts) => {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
};
const circle = (r) => { const out = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; out.push([at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)]); } return out; };

/**
 * A wide stroke at depth 0, nicked at depth 2 (a kid ceded there), a small keyless stroke beside the
 * nick, the camera back at depth 0 at inScale 16 (the stroke runs off screen) or, `whole`, at 1.
 */
function scene(whole = false) {
    const E = mkEngine();
    drawStroke(E, [[50, 300], [300, 305], [550, 298], [750, 302]], 30);
    for (let i = 0; i < 6; i++) E.zoomFactorAt(at[0], at[1], 16);
    const deep = E.cam.frame;
    erase(E, [[380, 250], [400, 300], [420, 350]], 12);
    const dot = drawStroke(E, [[450, 330], [460, 335]], 4);
    while (E.cam.activeLevel > 0) E.zoomFactorAt(at[0], at[1], 1 / 16);
    E.zoomFactorAt(at[0], at[1], 1);
    if (whole) while (E.cam.inScale > 1.5) E.zoomFactorAt(at[0], at[1], 1 / 16);
    const fam = [];
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (!o.erase && o.editId != null) fam.push({ id: o.id, key: o.editId, frame: k });
    return { E, deep, dot, fam };
}

describe("LF — a lasso's enclosed frame and the families under it", () => {
    test("LF-1 a small loop round the nick takes none of the stroke's family, and the keyless stroke beside it", () => {
        const { E, deep, dot, fam } = scene();
        expect(new Set(fam.map((m) => m.key)).size).toBe(1);
        expect(fam.some((m) => m.frame === deep)).toBe(true);           // a kid under the frame the loop encloses
        E.deselect();
        lasso(E, circle(20));
        for (const m of fam) expect(E._isSelected(m.id)).toBe(false);  // red before: the kid, through its frame
        expect(E._isSelected(dot.id)).toBe(true);
    });

    test("LF-2 a loop round the whole stroke takes all of it; round the screen with the stroke running off it, none", () => {
        const { E: F, fam: famF } = scene();
        F.deselect();
        lasso(F, [[10, 10], [790, 10], [790, 590], [10, 590], [10, 12]]);
        for (const m of famF) expect(F._isSelected(m.id)).toBe(false);   // red before: the kids, through frame 0/13,9
        const { E, dot, fam } = scene(true);
        E.deselect();
        lasso(E, [[10, 10], [790, 10], [790, 590], [10, 590], [10, 12]]);
        for (const m of fam) expect(E._isSelected(m.id)).toBe(true);
        expect(E._isSelected(dot.id)).toBe(true);
    });

    test("LF-4 a kid a frame below the enclosed one, which holds no ink of its own, is left out with its family", () => {
        const E = mkEngine();
        const X = E.lm.cellChild("0", 13, 9), Y = E.lm.cellChild(X.id, -2048, 1664);
        const K = E.doc.allocId();
        const piece = (frame, box) => E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), editId: K,
            loops: rectLoop(box), color: "#123", opacity: 1, w: 8 }, frame);
        const kid = piece(Y.id, { left: -10, top: -10, right: 10, bottom: 10 });
        const far = E.cam.screenToFrame(100, 100);
        const out = piece("0", { left: far[0] - 5, top: far[1] - 5, right: far[0] + 5, bottom: far[1] + 5 });
        E._render();
        const c = E.cam.levelPointToScreen(X.id, 0, 0);
        const loop = []; for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI * 2; loop.push([c[0] + 150 * Math.cos(a), c[1] + 150 * Math.sin(a)]); }
        const found = E._lassoFind(loop.map(([x, y]) => E.cam.screenToFrame(x, y)));
        expect(found.frames).not.toContain(X.id);                        // red before: X, one entry
        expect(found.ids).not.toContain(kid.id);
        E.deselect();
        lasso(E, loop);
        expect(E._isSelected(kid.id)).toBe(false);
        expect(E._isSelected(out.id)).toBe(false);
    });

    test("LF-3 the family is not torn: a drag after the small loop moves all of it or none of it", () => {
        const { E, fam } = scene();
        const drawnAt = () => new Map(fam.map((m) => {
            const r = E.doc.getById(m.id), q = E._rectInActive(r.obj, r.level);
            return [m.id, [(q.left + q.right) / 2, (q.top + q.bottom) / 2]];
        }));
        const a = drawnAt();
        E.deselect();
        lasso(E, circle(20));
        const s = E.selection;
        expect(s && (s.ids.length + s.frames.length)).toBeGreaterThan(0);
        // press where the selection is drawn: a frame's mark, or the nick
        const p = s.frames.length ? E.cam.levelPointToScreen(s.frames[0], 0, 0) : at;
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 4; k++) E.pointerMove(p[0] + 25 * k, p[1]);
        E.pointerUp();
        const b = drawnAt();
        const d = fam.map((m) => [b.get(m.id)[0] - a.get(m.id)[0], b.get(m.id)[1] - a.get(m.id)[1]]);
        for (const x of d) {                                             // red before: the kid 6.25 units, the rest 0
            expect(Math.abs(x[0] - d[0][0])).toBeLessThan(0.05);
            expect(Math.abs(x[1] - d[0][1])).toBeLessThan(0.05);
        }
    });
});
