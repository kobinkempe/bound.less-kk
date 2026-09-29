/**
 * The export barrier (PLAN §5.8 item 2): `withSvgEngine` — the SVG export and the `?svg` thumbnails — bakes every
 * pending mark in its copy before anything is serialised, so an export with a pending mark equals the export after
 * the bake, and the tab's own document is left as it was.
 */
import { withSvgEngine } from "./thumbnails";
import { useEngines, mkEngine, eraseGesture } from "../engine/__testkit__/harness";

useEngines();
jest.setTimeout(60000);

const fill = (E, x0, y0, x1, y1, color = "rgb(40,40,200)") => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] }, "0");
/** The one-off engine's `<svg>`, its Two.js ids (a counter across instances) left out. */
const exported = (doc) => withSvgEngine(doc, 800, 600, (E, host) => host.querySelector("svg").outerHTML.replace(/ id="two-\d+"/g, ""));

test("X-1 an export with a pending mark equals the export after the bake; the tab's document keeps its mark", async () => {
    const E = mkEngine(800, 600);
    E._scheduleBake = () => {};
    const T = fill(E, 300, 250, 500, 350);
    fill(E, 80, 420, 180, 500, "rgb(30,160,30)");
    E._render();
    eraseGesture(E, [[400, 200], [400, 400]], 20);
    const M = E._eraseStrokes()[0].obj;
    expect(M.targets).toEqual([T.id]);                                    // landed, not cut
    const pending = await exported(E.serializeDrawing());
    expect(E.doc.getById(M.id)).not.toBeNull();                          // the export baked a copy
    expect(E.doc.getById(T.id)).not.toBeNull();
    E.flushErases();
    expect(E.doc.getById(M.id)).toBeNull();
    const baked = await exported(E.serializeDrawing());
    expect(pending).not.toMatch(/<mask/);                                 // red without the barrier: the copy masks T
    expect(pending.length).toBeGreaterThan(200);
    expect(pending).toBe(baked);
});
