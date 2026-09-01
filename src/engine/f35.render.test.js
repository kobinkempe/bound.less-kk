/**
 * F35 — render each captured report exactly as Kobin saw it.
 *
 * A report's `snapshot` is `{v:"dev-0", camera, natives, crossings}`, which
 * `decodeDrawing` accepts through its legacy branch — so a report IS a loadable
 * drawing, camera and all. Nothing had to be converted; there was simply no
 * reader. This is that reader, and it is what makes a reported state
 * reproducible offline instead of merely described.
 *
 * Writes one SVG per report at Kobin's own viewport (1504x868), so the framing
 * is his and two reports can be compared side by side.
 */
import fs from "fs";
import path from "path";
import { useEngines, mkEngine } from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

// Snapshots live outside the repo tree — they are ~2 MB each. The rendered
// SVGs are small enough to keep beside the page that compares them.
const DIR = path.join(__dirname, "..", "..", ".kobin-reports", "f35");
const OUT = process.env.F35_OUT || path.join(__dirname, "..", "..", "public", "__f35");
const SHOTS = ["18-46-45-626", "18-49-23-450", "18-49-30-072", "18-50-01-308", "18-51-20-099"];

test("every captured report renders", () => {
    const summary = [];
    for (const name of SHOTS) {
        const snap = JSON.parse(fs.readFileSync(path.join(DIR, name + ".json"), "utf8"));
        const E = mkEngine(1504, 868);
        expect(E.loadSnapshot(snap)).toBe(true);
        E.flushBakes();
        E._render();

        const svg = E.renderer.host ? E.renderer.host.querySelector("svg") : document.querySelector("svg");
        expect(svg).toBeTruthy();
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        // A white ground, because the page's own background is not in the SVG
        // and every stroke here is light on dark or dark on light.
        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", "#ffffff");
        svg.insertBefore(bg, svg.firstChild);
        fs.writeFileSync(path.join(OUT, name + ".svg"), svg.outerHTML);

        summary.push({
            report: name,
            level: E.cam.activeLevel,
            inScale: +E.cam.inScale.toFixed(4),
            frame: E.cam.frame,
            painted: E._objs().filter((o) => !o.erase).length,
            nodes: svg.querySelectorAll("path").length,
        });
    }
    // eslint-disable-next-line no-console
    console.log("F35 RENDER " + JSON.stringify(summary, null, 1));
    expect(summary.length).toBe(SHOTS.length);
});
