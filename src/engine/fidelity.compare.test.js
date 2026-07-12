/**
 * Fidelity — the NEW engine vs GROUND TRUTH on the real phone snapshots.
 *
 * Ground truth is computed directly from the document: for a sample point, is it
 * inside ANY native's TRUE band, where each native is projected to the active
 * level as a stroke (exact band membership = distance to the projected
 * centerline <= half its projected width)? This is what the drawing ACTUALLY
 * contains at that camera — independent of any engine's representation.
 *
 * We deliberately do NOT compare to the old engine: at these deep cameras its
 * render list carries the exploded up-projection strokes (half-widths of 1e7+),
 * which geometrically "cover" the whole window in a list scan yet render blank
 * on screen (that IS BUG-05). So the old list is not a valid fidelity baseline.
 *
 * The gate: the new engine's rendered coverage must TRACK ground truth — it may
 * legitimately show slightly less at the sub-pixel fade edge, but it must not
 * blank out content that is genuinely there (the BUG-05 symptom). We require the
 * new engine to reproduce at least most of the true ink.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { windingOfPoint, distToPolyline, } from "./geometry/hittest";
import { projectNative } from "./geometry/derive";
import { flattenCurve } from "./geometry/clipperOutline";

jest.setTimeout(120000);

const dir = path.join(__dirname, "..", "..", ".kobin-reports");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

const engines = [];
const mk = (w, h) => { const host = document.createElement("div"); document.body.appendChild(host); const e = new KobinEngine(host, { width: w, height: h }); engines.push(e); return e; };
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } } });

function inked(list, p) {
    for (const o of list) {
        if (o.type === "fill") { if (windingOfPoint(o.polys, p) !== 0) return true; }
        else if (o.pts && distToPolyline(o.pts, p) <= o.lwFrame / 2) return true;
    }
    return false;
}
// Ground truth: every native projected to `level`, its centerline flattened to
// the SAME displayed spline the engine bands around (so the comparison is fair —
// straight chords vs the Catmull-Rom spline disagree right at a band edge).
function groundTruth(E, level) {
    const gt = [];
    for (const Hs of Object.keys(E.nativesByLevel)) {
        const H = +Hs;
        for (const o of E.nativesByLevel[Hs]) {
            // Flatten the spline at HOME (bounded coords — flattening a projected
            // giant would explode), then project the polyline.
            const flat = o.pts.length > 2
                ? { ...o, pts: flattenCurve(o.pts, (E.cfg.arcTolerancePx * 0.5) / E.cfg.enter) } : o;
            const d = projectNative(flat, H, level, E.crossings, E.cfg.base);
            if (d) gt.push(d);
        }
    }
    return gt;
}

describe("fidelity: the new engine reproduces the drawing's true ink (per real snapshot)", () => {
    if (!files.length) { test("no snapshots", () => expect(files.length).toBeGreaterThan(0)); return; }
    test.each(files)("%s", (file) => {
        const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        const snap = report.snapshot;
        if (!snap || !snap.natives) return;
        const w = (report.screen && report.screen.w) || 800, h = (report.screen && report.screen.h) || 600;
        const E = mk(w, h); E.loadSnapshot(JSON.parse(JSON.stringify(snap)));

        const win = E._frameWindow(0);
        const rendered = E._objs() || [];
        const gt = groundTruth(E, E.activeLevel);

        const N = 24, M = 16;
        let truthInk = 0, matched = 0, extra = 0;
        for (let a = 0; a < N; a++) for (let b = 0; b < M; b++) {
            const p = [win.left + (a + 0.5) / N * (win.right - win.left), win.top + (b + 0.5) / M * (win.bottom - win.top)];
            const t = inked(gt, p), r = inked(rendered, p);
            if (t) { truthInk++; if (r) matched++; } else if (r) extra++;
        }
        // No BUG-05 explosion: the old engine's up-projection produced strokes
        // 8.3e7 px wide (which then rendered blank); here coarse content arrives as
        // bounded tile fills, so nothing in the list is a monster stroke. Legitimate
        // fat strokes (a few thousand px) are fine — they render as fills. (Bounded
        // piece geometry is unit-tested in TileStore.test.js.)
        for (const o of rendered) if (o.type === "stroke") expect(o.lwFrame * E.inScale).toBeLessThan(1e6);
        // Where the drawing has ink, the new engine reproduces most of it. (No hard
        // 100%: sub-pixel fade at the cull edge legitimately drops a little.)
        if (truthInk >= 8) expect(matched / truthInk).toBeGreaterThanOrEqual(0.6);
    });
});
