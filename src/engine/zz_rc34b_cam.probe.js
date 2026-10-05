/* Scratch probe (R-MODEL-C34b; deleted before hand-back): a load whose camera names a frame the file lacks, into an engine
 * that rendered elsewhere: where `_camToLattice` puts the camera. */
import { useEngines, mkEngine } from "./__testkit__/harness";

useEngines();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };

test("a load's missing camera frame", () => {
    const out = {};
    for (const prior of [false, true]) {
        const src = mkEngine(800, 600);
        src.lm.ensureSpine(2);
        const Y = src.lm.cellChild("1", 5, 5);
        src.cam.set({ frame: Y.id, activeLevel: 2, inScale: 1, inPanX: 400, inPanY: 300 });
        src._render();
        const snap = src.snapshot();
        snap.crossings = { ...snap.crossings, frames: snap.crossings.frames.filter((f) => f.id !== Y.id) };
        const E = mkEngine(800, 600);
        if (prior) {
            E.lm.ensureSpine(3);
            const X = E.lm.cellChild("2", -7, 3);
            E.cam.set({ frame: X.id, activeLevel: 3, inScale: 1, inPanX: 400, inPanY: 300 });
            E._render();
        }
        E.loadSnapshot(JSON.parse(JSON.stringify(snap)));
        const f = E.lm.frame(E.cam.frame);
        out[prior ? "afterRender" : "fresh"] = { asked: Y.id, frame: E.cam.frame, exists: !!f, depth: f ? f.depth : null,
            activeLevel: E.cam.activeLevel, cell: f && f.cell, parent: f && f.parent, frames: E.lm.frames.size, fileFrames: snap.crossings.frames.length };
    }
    log("CAM-LOAD " + JSON.stringify(out));
});
