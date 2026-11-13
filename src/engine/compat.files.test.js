/**
 * The compatibility promise (v1.0, Kobin 2026-11-13: the app keeps reading older files). `__testkit__/compat/` holds
 * frozen drawing files: 1.0's five (whole-number versions 1–5, each a format 1.0 wrote; they read as "1.0") and one
 * per release since, saved under its version (`persist.FILE_VERSION`). Every later build opens each with every object
 * at its level. Never regenerate them; a release adds its own file.
 */
import fs from "fs";
import path from "path";
import { useEngines, mkEngine, natives } from "./__testkit__/harness";
import { decodeDrawing, FILE_VERSION, fileVersionOf, compareFileVersions } from "./persist";

useEngines();
const DIR = path.join(__dirname, "__testkit__", "compat");
const EXPECTED = JSON.parse(fs.readFileSync(path.join(DIR, "expected.json"), "utf8"));
const ids = (E) => natives(E).map((n) => n.obj.id).sort((a, b) => a - b);
/** Every release that saved files, oldest first; the newest is this app's. */
const RELEASES = ["1.0", "1.1"];

test("there is a file for every release's version, the newest this app's", () => {
    expect(RELEASES[RELEASES.length - 1]).toBe(FILE_VERSION);
    const have = [...new Set(Object.values(EXPECTED).map((e) => fileVersionOf(e.version)))].sort(compareFileVersions);
    expect(have).toEqual(RELEASES);
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
