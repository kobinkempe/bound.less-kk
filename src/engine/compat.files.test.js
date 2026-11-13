/**
 * The compatibility promise (v1.0, Kobin 2026-11-13: the app keeps reading older file versions). `__testkit__/compat/`
 * holds one drawing file per file version, written by v1.0 (`compat.fixtures.probe.js`) and frozen: every later build
 * opens each with every object at its level. Never regenerate them; a new file version adds its own file.
 */
import fs from "fs";
import path from "path";
import { useEngines, mkEngine, natives } from "./__testkit__/harness";
import { decodeDrawing, VERSION } from "./persist";

useEngines();
const DIR = path.join(__dirname, "__testkit__", "compat");
const EXPECTED = JSON.parse(fs.readFileSync(path.join(DIR, "expected.json"), "utf8"));
const ids = (E) => natives(E).map((n) => n.obj.id).sort((a, b) => a - b);

test("there is a file for every version this build writes", () => {
    expect(Object.values(EXPECTED).map((e) => e.version).sort()).toEqual(Array.from({ length: VERSION }, (_, i) => i + 1));
});

describe.each(Object.keys(EXPECTED))("the %s file", (key) => {
    const exp = EXPECTED[key];
    test("decodes, opens with every object at its level, and opens again once saved", () => {
        const file = JSON.parse(fs.readFileSync(path.join(DIR, key + ".svgi"), "utf8"));
        expect(file.version).toBe(exp.version);
        expect(() => decodeDrawing(file)).not.toThrow();
        const E = mkEngine();
        E.loadDrawing(file);
        expect(ids(E)).toEqual(exp.ids);
        expect(String(E.activeLevel)).toBe(exp.level);
        const C = mkEngine();
        C.loadDrawing(JSON.parse(JSON.stringify(E.serializeDrawing())));
        expect(ids(C)).toEqual(exp.ids);
        expect(String(C.activeLevel)).toBe(exp.level);
    });
});
