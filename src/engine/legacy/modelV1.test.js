/**
 * The legacy module (PLAN §5.2 Q6): only the op log's replay (`oplog.js`) and `Document`'s undo of a
 * `moveFrames` op carrying a store's `settled` record import it; no other module does, so it goes
 * with its deletion date. Its two inverses are idempotent: a settle replayed twice, or undone twice,
 * leaves the tables and homes as once.
 */
import fs from "fs";
import path from "path";
import { mkEngine, useEngines } from "../__testkit__/harness";
import { rectLoop } from "../geometry/arcShape";
import { applySettle, unsettle } from "./modelV1";
import { W } from "../frameLattice";

useEngines();
const SRC = path.join(__dirname, "..", "..");
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

test("only the op log's replay and Document's legacy undo import it", () => {
    const users = [];
    for (const p of sources(SRC)) {
        if (isTestCode(p) || p === path.join(__dirname, "modelV1.js")) continue;
        if (importsOf(fs.readFileSync(p, "utf8")).some((s) => /legacy\/modelV1$/.test(s))) users.push(path.relative(SRC, p).split(path.sep).join("/"));
    }
    expect(users.sort()).toEqual(["engine/Document.js", "engine/oplog.js"]);
});

test("a settle replayed twice, and undone twice, is as once", () => {
    const E = mkEngine(800, 600);
    E.lm.ensureSpine(3);
    const A = E.lm.cellChild("1", 3, 2).id, B = E.lm.cellChild("1", 4, 2).id;
    const add = (below) => { const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: 0, top: 0, right: 900, bottom: 700 }), color: "#135", opacity: 1, w: 8, below }; E.doc.add(o, A); return o.id; };
    const a = add(undefined), b = add([[0.375 * W, 0]]);
    const dx = 0.375 * W;
    // What the model before C1 logged for a shift of 0.375 W settled into A: `a` took it, `b` was carried to B.
    const rec = { dx, dy: 0, tables: [[a, [[dx, 0]]], [b, [[-0.25 * W, 0]]]], carries: [[b, B]] };
    const snap = () => JSON.stringify([a, b].map((id) => { const r = E.doc.getById(id); return [r.level, r.obj.below]; }));
    applySettle(E.doc, A, rec);
    const once = snap();
    expect(JSON.parse(once)).toEqual([[A, [[dx, 0]]], [B, [[-0.25 * W, 0]]]]);
    applySettle(E.doc, A, rec);
    expect(snap()).toBe(once);
    unsettle(E.doc, A, rec);
    const back = snap();
    expect(E.doc.getById(a).obj.below).toBeUndefined();
    expect(JSON.parse(back)[1][0]).toBe(A);
    unsettle(E.doc, A, rec);
    expect(snap()).toBe(back);
});
