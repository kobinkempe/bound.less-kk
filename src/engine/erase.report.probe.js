/**
 * PROBE, not a test (see tools/harnesses/README.md): replay the eraser gestures of a
 * report's journal on a report's snapshot, in jsdom, with the bake instrumented.
 *
 *   REPORT_SNAP=<report.json> REPORT_JOURNAL=<report.json> ERASE_IDS=695,697 [RAY_INDEX=0] \
 *   npx react-scripts test --watchAll=false --runInBand --testMatch "**\/erase.report.probe.js"
 *
 * The snapshot is the document as it was BEFORE the gestures; each gesture is rebuilt from
 * its journal note (frame, pts, lwFrame, inScale) the way `KobinEngine.eraseAt` builds a
 * mark, resolved, then baked to completion with `flushErases`. Printed per bake: the
 * target, the path (cut / rehome), the job's verdict and the regions' areas, every refusal
 * with the square asked and what the tile held. `RAY_INDEX=0` runs the boolean's classifier
 * as the flat scan.
 */
import fs from "fs";
import { mkEngine, useEngines } from "./__testkit__/harness";
import { loopsArea } from "./geometry/arcShape";
import { _setRayIndex } from "./geometry/arcShape";

const sum = (a) => a.reduce((n, x) => n + x, 0);

describe("report replay", () => {
    useEngines();
    test("replay the erases", () => {
        const snapPath = process.env.REPORT_SNAP, jPath = process.env.REPORT_JOURNAL || snapPath;
        if (!(snapPath && fs.existsSync(snapPath))) { console.log("REPLAY: no REPORT_SNAP"); return; }
        if (process.env.RAY_INDEX === "0") _setRayIndex(false);
        const snapReport = JSON.parse(fs.readFileSync(snapPath, "utf8"));
        const jReport = JSON.parse(fs.readFileSync(jPath, "utf8"));
        const ids = (process.env.ERASE_IDS || "").split(",").map((x) => +x).filter((x) => x > 0);
        const notes = jReport.journal.filter((e) => e.kind === "erase" && ids.includes(e.id));
        const E = mkEngine(1504, 812);
        // The frames of a later report (REPORT_FRAMES): a gesture made in a frame minted
        // after the snapshot needs that frame in the lattice.
        const snap = { ...snapReport.snapshot };
        if (process.env.REPORT_FRAMES && fs.existsSync(process.env.REPORT_FRAMES)) snap.crossings = JSON.parse(fs.readFileSync(process.env.REPORT_FRAMES, "utf8")).snapshot.crossings;
        E.loadSnapshot(snap);
        E._scheduleBake = () => {};
        const out = { snapshot: snapPath.replace(/^.*[\\/]/, ""), rayIndex: process.env.RAY_INDEX !== "0", erases: [] };
        // instruments
        const bakes = [];
        const origApply = E._applyCut.bind(E);
        E._applyCut = (Erec, target, r, ctx) => {
            const before = target.obj.loops ? Math.abs(loopsArea(target.obj.loops)) : null;
            const areas = r.kind === "cut" ? r.regions.map((g) => +Math.abs(loopsArea(g)).toFixed(3)) : null;
            const ok = origApply(Erec, target, r, ctx);
            bakes.push({ path: "cut", mark: Erec.obj.id, target: target.obj.id, level: String(target.level).slice(-16), pieces: target.obj.loops ? target.obj.loops.reduce((n, L) => n + L.length, 0) : 0,
                kind: r.kind, removed: +r.removed.toFixed(4), before: before == null ? null : +before.toFixed(3), regions: areas ? areas.length : 0, areaAfter: areas ? +sum(areas).toFixed(3) : null, smallest: areas ? Math.min(...areas) : null, stats: r.stats && { sealed: r.stats.sealed, crossings: r.stats.crossings, weld: r.stats.weld }, ok });
            return ok;
        };
        const origDescent = E._applyDescent.bind(E);
        E._applyDescent = (Erec, target, r, ctx) => {
            const ok = origDescent(Erec, target, r, ctx);
            bakes.push({ path: "rehome", mark: Erec.obj.id, target: target.obj.id, level: String(target.level).slice(-16), ok, refused: r.refused || null, steps: r.steps ? r.steps.map((st) => ({ removed: st.removedId, parents: st.parents.length, kids: st.kids.length, levels: [...new Set(st.kids.map((k) => String(k.level).slice(-12)))] })) : null, dust: r.stats && r.stats.dust });
            return ok;
        };
        for (const note of notes) {
            const frame = note.frame;
            const o = { type: "stroke", origin: "native", erase: true, bakePx: note.inScale, id: E.doc.allocId(), pts: note.pts.map((p) => [p[0], p[1]]),
                lwFrame: note.lwFrame, color: "#ffffff", opacity: 1, paths: [] };
            o._tol = (E.cfg.arcTolerancePx * 0.5) / note.inScale;
            E.doc.add(o, frame);
            E._note({ kind: "erase", id: o.id, frame, px: note.px, lwFrame: note.lwFrame, pts: o.pts.slice(0, 4), cuts: [] });
            E.flushBakes();
            const mark = E.doc.getById(o.id);
            const cands = mark ? E._candidatesUnder({ obj: mark.obj, level: mark.level }).list.length : null;
            let candDump = null;
            if (process.env.CAND_DUMP && mark) {
                const { loopsBBox } = require("./geometry/arcShape");
                const Erec = { obj: mark.obj, level: mark.level };
                const eb = loopsBBox(mark.obj.loops);
                candDump = { markBox: eb && [eb.x0, eb.y0, eb.x1, eb.y1].map((v) => +v.toFixed(1)), frameFactorToHO: null, cands: [] };
                const list = E._candidatesUnder(Erec).list.slice(0, +process.env.CAND_DUMP || 6);
                for (const c of list) {
                    const rec = E.doc.getById(c.id); if (!rec) continue;
                    const ob = rec.obj;
                    const rectE = { left: eb.x0, top: eb.y0, right: eb.x1, bottom: eb.y1 };
                    const into = E._eraserRectInto(rectE, mark.level, ob, rec.level);
                    const lb = ob.loops ? loopsBBox(ob.loops) : null;
                    let pic = null;
                    try { const d = E.lm.projectF(ob, rec.level, mark.level); const pb = d && d.loops ? loopsBBox(d.loops) : null; pic = pb && [pb.x0, pb.y0, pb.x1, pb.y1].map((v) => +v.toFixed(1)); } catch (e) { pic = "err " + e.message; }
                    candDump.cands.push({ id: c.id, z: c.z, level: String(rec.level).slice(-14), below: ob.below || null, mayTouch: E._eraseMayTouch(mark.obj, mark.level, ob, rec.level),
                        eraserInto: into && [into.left, into.top, into.right, into.bottom].map((v) => +v.toFixed(2)), stored: lb && [lb.x0, lb.y0, lb.x1, lb.y1].map((v) => +v.toFixed(1)), pictureAtHE: pic });
                }
            }
            const n0 = bakes.length;
            const t0 = Date.now();
            E.flushErases();
            const mine = bakes.slice(n0);
            const jn = E.journal.find((j) => j.kind === "erase" && j.id === o.id);
            out.erases.push({ noteId: note.id, frame, markId: o.id, markPieces: mark && mark.obj.loops ? mark.obj.loops.reduce((n, L) => n + L.length, 0) : null, candidates: cands, ms: Date.now() - t0,
                bakes: mine, refused: jn && jn.refused, spent: jn && jn.spent, cuts: jn && jn.cuts && jn.cuts.length, candDump });
        }
        console.log("REPLAY " + JSON.stringify(out, null, 1));
        expect(true).toBe(true);
    });
});
