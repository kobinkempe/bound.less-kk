/**
 * compat.fixtures.probe.js — writes the frozen drawing files `compat.files.test.js` opens: one per file version (1–5),
 * as v1.0 writes them (2026-11-13). Run once, then never again: the files are the compatibility promise, and a later
 * build must open them as they are. A new file version adds its own file. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/compat.fixtures.probe.js"
 */
import fs from "fs";
import path from "path";
import { useEngines, mkEngine, drawStroke, erase, descend, natives } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import { G } from "./frameLattice";

useEngines();
const DIR = path.join(__dirname, "__testkit__", "compat");
const WHEN = "2026-11-13T00:00:00.000Z";

function write(key, E, note) {
    const d = JSON.parse(JSON.stringify(E.serializeDrawing({ name: key, createdAt: WHEN })));
    d.meta.modifiedAt = WHEN;
    fs.writeFileSync(path.join(DIR, key + ".svgi"), JSON.stringify(d));
    const ids = natives(E).map((n) => n.obj.id).sort((a, b) => a - b);
    return { version: d.version, ids, level: String(E.activeLevel), note };
}

test("write the compatibility files", () => {
    fs.mkdirSync(DIR, { recursive: true });
    const out = {};
    {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [400, 280], [600, 320]], 20);
        drawStroke(E, [[250, 400], [550, 380]], 8, "#aa3333");
        out.v1 = write("v1", E, "two strokes at the top level");
    }
    {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [400, 300], [650, 300]], 30, "#1133cc");
        erase(E, [[400, 230], [402, 300], [404, 370]], 14);
        out.v2 = write("v2", E, "a stroke cut in two by the eraser (cut pieces)");
    }
    {
        // path-named frames, as builds before F192 named them, and one moved by a fraction of a cell (a shift)
        const E = mkEngine();
        E.lm.ensureSpine(2);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const A = E.lm.ensureId("1/200,0").id;
        const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: -2000, top: -2000, right: 2000, bottom: 2000 }), color: "#33aa33", opacity: 1, w: 8 };
        E.doc.add(o, A);
        drawStroke(E, [[300, 300], [500, 300]], 12);
        E._render();
        const px = E._levelPointToScreen("1", G, 0)[0] - E._levelPointToScreen("1", 0, 0)[0];
        E.setTool("select");
        E._setSelection([], [A]);
        E._dragSel = { start: [400, 300], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        E.store.setBatch(true);
        E._dragSelection(400 + 0.3 * px, 300);
        E.pointerUp();
        out.v3 = write("v3", E, "a frame moved by 0.3 of a cell: the lattice carries a shift");
    }
    {
        const E = mkEngine();
        descend(E, 2, 640, 450);
        drawStroke(E, [[300, 300], [500, 340]], 16, "#7733aa");
        out.v4 = write("v4", E, "ink two levels down in an off-centre cell: a frame named by its parent's code");
    }
    {
        const E = mkEngine();
        E.jumpTo(E.lm.ensureSpine(100), { x: -2000, y: -1500, w: 4000, h: 3000 });
        drawStroke(E, [[300, 300], [500, 300]], 16);
        out.v5 = write("v5", E, "ink 100 levels down, reached by a jump: one frame and a run of empty levels");
    }
    fs.writeFileSync(path.join(DIR, "expected.json"), JSON.stringify(out, null, 1) + "\n");
    expect(Object.values(out).map((e) => e.version)).toEqual([1, 2, 3, 4, 5]);
    for (const e of Object.values(out)) expect(e.ids.length).toBeGreaterThan(0);
});
