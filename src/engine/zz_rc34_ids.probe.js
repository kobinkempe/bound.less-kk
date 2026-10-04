/* Scratch probe (R-MODEL-C34; deleted before hand-back): private frame ids across a cede, its undo, GC and a later cede. */
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";
import { collectFrames } from "./frameGc";

useEngines();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const at = [400, 301];
const priv = (E) => [...E.lm.frames.values()].filter((f) => f.private != null).map((f) => f.id + ":" + E.doc.count(f.id));
test("ids", () => {
    const E = mkEngine();
    drawStroke(E, [[50, 300], [300, 305], [550, 298], [750, 302]], 30);
    for (let i = 0; i < 6; i++) E.zoomFactorAt(at[0], at[1], 16);
    log("deep " + E.cam.frame + " level " + E.cam.activeLevel);
    erase(E, [[380, 250], [400, 300], [420, 350]], 12);
    log("after cede " + priv(E).join(" "));
    E.undo(); E.flushBakes();
    log("after undo " + priv(E).join(" "));
    drawStroke(E, [[100, 100], [140, 120]], 4);
    E.sweepFrames(); collectFrames(E); E._render();
    log("after gc " + priv(E).join(" "));
    for (let i = 0; i < 4; i++) E.zoomFactorAt(at[0], at[1], 1 / 16);
    log("shallow " + E.cam.frame + " level " + E.cam.activeLevel);
    erase(E, [[396, 280], [400, 300], [404, 320]], 3);
    log("after cede 2 " + priv(E).join(" "));
});
