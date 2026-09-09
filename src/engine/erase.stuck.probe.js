/**
 * PROBE, not a test (the suite does not run *.probe.js; see tools/harnesses/README.md):
 *
 *   MEM_EXPORT=<kobin-1 export.json> node --max-old-space-size=6144 node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --testMatch "**\/erase.stuck.probe.js"
 *
 * Loads a drawing that carries pending eraser marks and ticks the bake by hand,
 * reporting what each tick did, which target each mark is on, and the journal's
 * refusals — for a mark that is retried tick after tick with nothing to do
 * (seen 2026-09-08: three marks, 100-256 ticks a minute, 9-600 ms each).
 */
import fs from "fs";
import { mkEngine, useEngines } from "./__testkit__/harness";

describe("stuck marks", () => {
    useEngines();
    test("tick the bake by hand and report", () => {
        const exportPath = process.env.MEM_EXPORT;
        if (!(exportPath && fs.existsSync(exportPath))) { console.log("STUCK MARKS: no MEM_EXPORT"); return; }
        const E = mkEngine(1504, 812);
        let raw = JSON.parse(fs.readFileSync(exportPath, "utf8"));
        E.loadDrawing(raw); raw = null;
        E._scheduleBake = () => {};   // ticked by hand below
        const describeMarks = () => E._eraseStrokes().map((r) => {
            const t = E._nextEraseTarget(r);
            return { id: r.obj.id, level: String(r.level).slice(-14), z: r.obj.z, type: r.obj.type,
                done: (E._bakeDone.get(r.obj.id) || new Set()).size,
                next: t ? `${t.obj.id}@${String(t.level).slice(-14)} z=${t.obj.z != null ? t.obj.z : t.obj.id}` : null };
        });
        // PROFILE: the parts of one cut on the biggest targets under the oldest mark.
        const profile = [];
        if (process.env.STUCK_PROFILE) {
            const { subtractShape, intersectShape, shapeComponents, dropDust, loopsArea, loopsBBox } = require("./geometry/arcShape");
            const Erec = E._eraseStrokes()[0];
            const scan = E._candidatesUnder(Erec);
            let n = 0;
            for (const c of scan.list) {
                if (n >= 3) break;
                const rec = E.doc.getById(c.id); if (!rec) continue;
                const o = rec.obj; if (!o.loops) continue;
                const pieces = o.loops.reduce((k, L) => k + L.length, 0);
                if (pieces < 500) continue;
                if (!E._eraseMayTouch(Erec.obj, Erec.level, o, rec.level)) continue;
                n++;
                const t = {}; let t0 = Date.now();
                const Ep = E._eraserLoopsInto(Erec.obj.loops, Erec.level, o, rec.level); t.projectMs = Date.now() - t0;
                const epPieces = Ep ? Ep.reduce((k, L) => k + L.length, 0) : 0;
                const opts = E._boolOpts();
                t0 = Date.now(); const res = subtractShape(o.loops, Ep, opts); t.subtractMs = Date.now() - t0;
                t0 = Date.now(); const cut = intersectShape(o.loops, Ep, opts); t.intersectMs = Date.now() - t0;
                t0 = Date.now(); const groups = shapeComponents(res.loops); t.componentsMs = Date.now() - t0;
                t0 = Date.now(); dropDust(groups, o.w); t.dustMs = Date.now() - t0;
                t0 = Date.now(); loopsArea(o.loops); loopsArea(cut.loops); loopsBBox(Ep); t.areasMs = Date.now() - t0;
                const bb = loopsBBox(o.loops), eb = loopsBBox(Ep);
                profile.push({ id: o.id, level: String(rec.level).slice(-14), pieces, loops: o.loops.length, arcs: o.loops.reduce((k, L) => k + L.filter((p) => !p.line).length, 0),
                    subjectBox: bb && [Math.round(bb.x1 - bb.x0), Math.round(bb.y1 - bb.y0)], eraserBox: eb && [Math.round(eb.x1 - eb.x0), Math.round(eb.y1 - eb.y0)],
                    epPieces, resLoops: res.loops.length, resPieces: res.loops.reduce((k, L) => k + L.length, 0), stats: res.stats && { sealed: res.stats.sealed, weld: res.stats.weld, retriedAt: res.stats.retriedAt, crossings: res.stats.crossings }, ...t });
            }
        }
        const marks0 = describeMarks();
        const candidates = E._eraseStrokes().map((r) => ({ id: r.obj.id, under: E._candidatesUnder(r).list.length }));
        const log = [];
        let ticks = 0, totalMs = 0;
        const seenTargets = new Map();
        const bakes = [];   // every single-object bake: ms, the target's size, the path taken
        const origBake = E._bakeOne.bind(E);
        E._bakeOne = (Erec, target, opts) => {
            const o = target.obj;
            const pieces = o.loops ? o.loops.reduce((n, L) => n + L.length, 0) : (o.pts ? o.pts.length : 0);
            const deeper = E.lm.depthOf(target.level) < E.lm.depthOf(Erec.level);
            const t0 = Date.now();
            const out = origBake(Erec, target, opts);
            bakes.push({ id: o.id, pieces, loops: o.loops ? o.loops.length : 0, rehome: deeper, ms: Date.now() - t0, out: String(out) });
            return out;
        };
        const maxTicks = +(process.env.STUCK_TICKS || 400);
        for (; ticks < maxTicks; ticks++) {
            const marks = E._eraseStrokes();
            if (!marks.length) break;
            for (const r of marks) { const t = E._nextEraseTarget(r); if (t) { const k = r.obj.id + "->" + t.obj.id; seenTargets.set(k, (seenTargets.get(k) || 0) + 1); } }
            const t0 = Date.now();
            E._bakeTick();
            const ms = Date.now() - t0; totalMs += ms;
            if (ticks % 20 === 0 || ms > 800) log.push({ tick: ticks, ms, marks: describeMarks() });
        }
        const repeats = [...seenTargets.entries()].filter(([, n]) => n > 2).slice(0, 10);
        const slowest = [...bakes].sort((a, b) => b.ms - a.ms).slice(0, 12);
        const byPath = { cut: { n: 0, ms: 0 }, rehome: { n: 0, ms: 0 } };
        for (const b of bakes) { const k = b.rehome ? "rehome" : "cut"; byPath[k].n++; byPath[k].ms += b.ms; }
        const pieceBuckets = {};
        for (const b of bakes) { const k = b.pieces < 100 ? "<100" : b.pieces < 1000 ? "<1k" : b.pieces < 10000 ? "<10k" : "10k+"; const e = pieceBuckets[k] || (pieceBuckets[k] = { n: 0, ms: 0 }); e.n++; e.ms += b.ms; }
        const notes = (E.journal || []).filter((j) => j.kind === "erase").map((j) => ({
            id: j.id, cuts: (j.cuts || []).length, refused: (j.refused || []).slice(0, 8), spent: j.spent || null,
        }));
        console.log("STUCK MARKS " + JSON.stringify({ profile, marks0, candidates, ticks, totalMs, bakes: bakes.length, byPath, pieceBuckets, slowest, remaining: describeMarks(), repeats, log: log.slice(-4), notes }, null, 1));
        expect(true).toBe(true);
    });
});
