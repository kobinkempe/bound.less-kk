/**
 * The sync UI's stacking and touch sizes (review of 2026-09-23, minor 4 and the nits), read from the
 * stylesheet: jsdom lays nothing out, so the rules themselves are checked; Chrome measured them.
 */
import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.join(__dirname, "boundless-ui.css"), "utf8");
const rule = (sel) => { const i = css.indexOf(sel + " {"); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
const z = (sel) => { const m = /z-index:\s*(\d+)/.exec(rule(sel)); return m ? +m[1] : null; };

test("the banner stack sits under the overlays, so an open details card or Scenes panel covers it (review minor 4)", () => {
    expect(z(".bl-top-notices")).toBeLessThan(z(".bl-editor-overlay"));
});

test("while a banner shares the rail's columns, the rail starts under it, sized to the visible height (Kobin 2026-09-23)", () => {
    const below = rule(".bl-editor-left.bl-editor-left--below");
    expect(below).toContain("top: var(--bl-rail-top)");
    expect(below).toContain("transform: none");
    expect(rule(".bl-editor-left--below .bl-tool-rail")).toContain("100dvh");       // a phone's 100vh counts the hidden URL bar
    expect(rule(".bl-top-notices")).toContain("var(--bl-notices-top");
    expect(css).not.toMatch(/:has\(\.bl-sync-banner\)/);
});

test("touch sizes follow a coarse pointer as well as a phone's width (review nit)", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(css.indexOf("@media (pointer: coarse)")).toBeGreaterThan(-1);
    for (const sel of [".bl-sync-banner-action", ".bl-sync-banner-dismiss", ".bl-remote-banner button"]) {
        expect(coarse).toContain(sel);
    }
});
