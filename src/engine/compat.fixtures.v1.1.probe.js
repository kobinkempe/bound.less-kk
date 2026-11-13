/**
 * compat.fixtures.v1.1.probe.js — writes the frozen file of release 1.1 (a file says the version of the app that saved
 * it, persist.FILE_VERSION) beside 1.0's five and adds its line to `expected.json`, leaving the others as they are
 * (`compat.fixtures.probe.js` wrote those, once). It holds what 1.1 added: depths past 2^53 (depth.js). Run once:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/compat.fixtures.v1.1.probe.js"
 */
import fs from "fs";
import path from "path";
import { useEngines, mkEngine, drawStroke, natives } from "./__testkit__/harness";
import { addOffset, internBelow } from "./geometry/offsets";
import { FILE_VERSION } from "./persist";
import { add, sub, parse } from "./depth";

useEngines();
const DIR = path.join(__dirname, "__testkit__", "compat");
const WHEN = "2026-11-13T00:00:00.000Z";
const VIEW = { x: -2000, y: -1500, w: 4000, h: 3000 };

test("write release 1.1's compatibility file", () => {
    expect(FILE_VERSION).toBe("1.1");
    const key = "v" + FILE_VERSION, file = path.join(DIR, key + ".svgi"), exp = path.join(DIR, "expected.json");
    if (fs.existsSync(file)) throw new Error(key + ".svgi exists: the file is frozen");
    const E = mkEngine();
    const D1 = add(parse("9007199254740992"), 1), D2 = parse("18446744073709551616");   // 2^53 + 1, 2^64
    E.jumpTo(E.lm.ensureSpine(D1), VIEW);
    const a = drawStroke(E, [[300, 300], [500, 300]], 16, "#cc6600");
    // a move table entry 2^64 − 2^53 − 1 levels below its home, as a drag made that far down writes it
    a.below = internBelow(addOffset([], sub(D2, D1), 0.5, -0.25).below);
    E.jumpTo(E.lm.ensureSpine(D2), VIEW);
    drawStroke(E, [[300, 320], [500, 280]], 12, "#0066cc");
    E.refreshScenes();
    const d = JSON.parse(JSON.stringify(E.serializeDrawing({ name: key, createdAt: WHEN })));
    d.meta.modifiedAt = WHEN;
    expect(d.version).toBe("1.1");
    expect(d.camera.activeLevel).toBe(String(D2));
    expect(typeof d.meta.sceneIndex.base).toBe("string");   // the first depth the index met, past 2^53
    fs.writeFileSync(file, JSON.stringify(d));
    const out = JSON.parse(fs.readFileSync(exp, "utf8"));
    out[key] = { version: d.version, ids: natives(E).map((n) => n.obj.id).sort((x, y) => x - y), level: String(E.activeLevel),
        note: "ink 2^53 + 1 and 2^64 levels down (depths as digits), a move table entry 2^64 − 2^53 − 1 levels below its home" };
    fs.writeFileSync(exp, JSON.stringify(out, null, 1) + "\n");
});
