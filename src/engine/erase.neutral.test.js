/**
 * OPEN-FLAGS F109 — a mark's step past a target whose ink it never covered is picture-neutral.
 *
 * A target the erase leaves whole (refused, grazed) stays masked by the pending mark until the mark
 * steps below it, and that step is untagged (F90) because it can uncover ink. But a descent refused
 * because "the tile holds none of its ink", or a cut that removed nothing (a graze), had no ink
 * under the mark: the step changes no pixel. On the Magnum Opus ~90 such steps a bake each staled
 * the plates under the mark (F106's stream) and cost a re-raster each.
 */
import KobinEngine from "./KobinEngine";
import { resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { descentJob } from "./eraseDescent";
import { rectLoop, loopsBBox } from "./geometry/arcShape";

jest.setTimeout(60000);

const engines = [];
function mkEngine() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); });
afterEach(() => { while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); } });

const stroke = (E, pts, width, tool = "pen") => {
    E.setTool(tool);
    if (tool === "pen") E.setWidth(width); else E.setEraserSize(width);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const circle = (cx, cy, r, n = 72) => { const out = []; for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };

const marks = (E) => { let n = 0; for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.erase) n++; return n; };
/** The tick's own path, which steps the mark down (`flushErases` does not); the zoom's idle wait skipped. */
function bakeByTicks(E) {
    let g = 0;
    while (marks(E) && g++ < 2000) { E._lastCamMove = null; E._bakeTick(); }
    expect(marks(E)).toBe(0);
}
/** The mark's own z steps as the Stage's classifier sees them, with their neutral tags. */
function watchSteps(E) {
    const steps = [], cls = E.stage._isNeutral;
    E.stage._isNeutral = (ev) => {
        const n = cls(ev);
        if (ev && ev.kind === "change" && ev.attrOnly && ev.obj && ev.obj.erase) steps.push(!!n);
        return n;
    };
    return steps;
}

describe("F109 — a step past ink the mark never covered stales no plate", () => {
    test("in place: an eraser inside a ring's hole grazes the ring, and the step past it is neutral", () => {
        const E = mkEngine();
        stroke(E, circle(400, 300, 150), 30);
        E.flushBakes();
        const ring = E.doc.list("0")[0];
        const steps = watchSteps(E);
        stroke(E, [[390, 300], [410, 302], [420, 296]], 10, "erasePartial");
        bakeByTicks(E);
        expect(E.doc.getById(ring.id)).toBeTruthy();                     // the ring is untouched
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.every((n) => n)).toBe(true);
    });

    test("a descent: an eraser one crossing down in the ring's hole is refused (no ink in its tile), and the step past it is neutral", () => {
        const E = mkEngine();
        stroke(E, circle(400, 300, 150), 30);
        E.flushBakes();
        const ring = E.doc.list("0")[0];
        let g = 0; while (E.activeLevel < 1 && g++ < 400) E.zoomAt(400, 300, -1000);
        expect(E.activeLevel).toBe(1);
        const steps = watchSteps(E);
        stroke(E, [[380, 300], [420, 304], [440, 296]], 12, "erasePartial");
        bakeByTicks(E);
        const note = E.journal.filter((j) => j.kind === "erase").slice(-1)[0];
        expect(note.refused.map((r) => r.why)).toEqual(["no tile ceded: tile holds none of its ink"]);
        expect(E.doc.getById(ring.id)).toBeTruthy();
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.every((n) => n)).toBe(true);
    });

    test("control: a target the mark really cuts is not affected — its step stays as it was", () => {
        const E = mkEngine();
        stroke(E, [[200, 300], [600, 300]], 30);
        E.flushBakes();
        const steps = watchSteps(E);
        stroke(E, [[400, 250], [402, 300], [398, 350]], 12, "erasePartial");
        bakeByTicks(E);
        expect(E.doc.list("0").length).toBe(2);                         // cut in two
        expect(steps.every((n) => n)).toBe(true);                        // a cut the mark hides was always neutral
    });
});

describe("F109 — a refused descent is inkless only when it read every tile and found no ink", () => {
    /** The ring at d0 and a baked mark in its hole at d1, not yet handled: the descent's own input. */
    function setup() {
        const E = mkEngine();
        stroke(E, circle(400, 300, 150), 30);
        E.flushBakes();
        const ring = E.doc.list("0")[0];
        let g = 0; while (E.activeLevel < 1 && g++ < 400) E.zoomAt(400, 300, -1000);
        stroke(E, [[380, 300], [420, 304], [440, 296]], 12, "erasePartial");
        for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (o.erase) E._forceBake(o);
        const Erec = E._eraseStrokes()[0];
        const M = Erec.obj;
        const input = { freezeR: E._boolOpts().freezeR, HE: Erec.level, target: { obj: ring, level: "0" }, E: { id: M.id, w: M.w, bakePx: M.bakePx, loops: M.loops } };
        return { E, M, input };
    }
    test("no ink in the tile: inkless", () => {
        const { E, input } = setup();
        const r = descentJob(E._descentWorld(), input);
        expect(r.refused).toBe("no tile ceded: tile holds none of its ink");
        expect(r.inkless).toBe(true);
    });
    test("ink under the eraser that the descent then cannot cede: not inkless", () => {
        const { E, M, input } = setup();
        const b = loopsBBox(M.loops);
        const pad = 40;
        // Every tile's ink is a square over the whole eraser, and its tile rect maps to nothing in the parent.
        const world = { ...E._descentWorld(), squareInk: () => ({ loops: rectLoop({ left: b.x0 - pad, top: b.y0 - pad, right: b.x1 + pad, bottom: b.y1 + pad }), clip: { left: 5, right: 5, top: 5, bottom: 5 } }) };
        const r = descentJob(world, input);
        expect(r.refused).toMatch(/^no tile ceded: /);                 // the reason is the last tile's
        expect(r.inkless).toBe(false);
    });
});
