// TEMPORARY (B-ERASE debugging; deleted before the checkpoint).
import { useEngines, mkEngine, drawStroke, eraseGesture } from "./__testkit__/harness";

useEngines();

const dragSteps = (E, from, to, steps) => {
    E.setTool("select");
    E.pointerDown(from[0], from[1]); E.pointerUp();
    E.pointerDown(from[0], from[1]);
    for (let i = 1; i <= steps; i++) E.pointerMove(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    E.pointerUp();
};
const natObj = (E) => { const n = E.doc.serializeNatives(); for (const k of Object.keys(n)) if (!n[k].length) delete n[k]; return n; };

test("debug EP-1", () => {
    const E = mkEngine();
    E.setColor("#aa3311"); drawStroke(E, [[567,496],[742.5,541.25],[731.75,455],[665,263.25],[761.25,420]], 60);
    E.setColor("#11aa55"); drawStroke(E, [[708,234],[633,145],[677,90],[651,161]], 16);
    eraseGesture(E, [[641,86],[670.5,125.5],[693.25,164.75],[728.5,197.5],[764.25,224.75],[763.25,237.5],[714.75,242.75],[672.75,237.5],[676.25,199.25],[670.5,154.5],[679.5,114.5],[685.5,65.25],[705.75,20.75],[728.25,48.75],[705.5,86.5],[671,83.75]], 6);
    for (let i = 0; i < 7; i++) E.zoomFactorAt(668, 340, 1.3);
    dragSteps(E, [621, 505], [768, 599], 5);
    eraseGesture(E, [[641,12],[665.25,84.75],[734.5,207.5]], 48);
    dragSteps(E, [650, 70], [467, -92], 3);
    E.flushErases(); E.flushBakes();
    const fwd = natObj(E);
    let n = 0;
    while (E.doc.canUndo()) { E.undo(); n++; }
    for (let k = 0; k < n; k++) E.redo();
    const back = natObj(E);
    const brief = (m) => { const out = {}; for (const k of Object.keys(m)) out[k] = m[k].map((o) => ({ id: o.id, z: o.z, t: o.targetOf, h: o.handledBy, e: o.erase, g: JSON.stringify(o.loops || o.pts).length })); return out; };
    console.log(JSON.stringify(brief(fwd)), "\n----\n", JSON.stringify(brief(back)));
});
