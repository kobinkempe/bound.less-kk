/**
 * The model-v1 oracle (README.md): nothing outside the tests imports it, and it is the model it
 * froze — a subtree move's shift is settled into the frame's natives at the first read (DESIGN §8
 * as of 5e9b1dd), which is what the live model no longer does (A1 C1).
 */
import fs from "fs";
import path from "path";
import OracleEngine from "./KobinEngine";
import { rectLoop } from "../../geometry/arcShape";

const SRC = path.join(__dirname, "..", "..", "..");

function sources(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules") sources(p, out); continue; }
        if (/\.js$/.test(e.name)) out.push(p);
    }
    return out;
}
const isTestCode = (p) => /\.(test|probe)\.js$/.test(p) || /[\\/]__(oracles|testkit)__[\\/]/.test(p);
const importsOf = (text) => [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);

test("no production module imports __oracles__ (model-v1 included)", () => {
    const bad = [];
    for (const p of sources(SRC)) {
        if (isTestCode(p)) continue;
        for (const spec of importsOf(fs.readFileSync(p, "utf8"))) if (spec.includes("__oracles__")) bad.push(path.relative(SRC, p) + " -> " + spec);
    }
    expect(bad).toEqual([]);
});

test("the oracle settles a subtree move's shift into the frame's natives at the first read", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new OracleEngine(host, { width: 800, height: 600 });
    try {
        E.lm.ensureSpine(3);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const R = E.lm.cellChild("1", 5, 5), K = E.lm.cellChild(R.id, 7, -7);
        const ids = [];
        for (const F of [R.id, K.id]) {
            for (let n = 0; n < 5; n++) {
                const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: n * 900, top: 0, right: n * 900 + 400, bottom: 300 }),
                    color: "#123", opacity: 1, w: 8 };
                E.doc.add(o, F); ids.push(o.id);
            }
        }
        E._render();
        E._setSelection([], [R.id]);
        const p = E._levelPointToScreen(R.id, 0, 0);
        E._dragSel = { start: [p[0], p[1]], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        E.store.setBatch(true);
        E._dragSelection(p[0] + 37, p[1] + 11);
        E.pointerUp();
        const f = E.lm.frame(K.id);
        expect(f.shift).toBeFalsy();                                  // K's shift was read: settled
        const tabled = ids.filter((id) => { const r = E.doc.getById(id); return r && r.obj.below && r.obj.below[0]; });
        expect(tabled.length).toBeGreaterThan(0);                     // into its natives' own tables
    } finally { E.destroy(); }
});
