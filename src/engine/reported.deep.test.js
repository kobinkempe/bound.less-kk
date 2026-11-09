/**
 * Kobin's phone reports of 2026-11-04 (OPEN-FLAGS F184, F185): native 67 is homed at depth 4 with a home-level move in
 * its table, and seen from depth 16, magnifying a corner a cut made. Below its home its picture is derived, not its
 * stored loops magnified (F173 re-solves the corner each level): the stored corner and the drawn one differ by less
 * than a rounding at the home, ~6e31 units at depth 16. F184: an erase there missed 67. F185: a move there was not
 * dirtied, and the plates kept the old picture. F186: the ants stayed where it had been. Fixtures in `.kobin-reports`
 * (gitignored): absent, nothing runs.
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { useEngines } from "./__testkit__/harness";
import { engineFromReport, readReportFile, drawingPartsOf } from "./__testkit__/reportReplay";
import { resetRasterWorkerClient, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import { resetPlaneStats } from "./raster/MovePlane";
import { packJob } from "./raster/rasterPack";
import { renderPlate } from "./raster/rasterCore";
import { PLATE_PX } from "./raster/plate";

jest.setTimeout(600000);
useEngines();
const R1 = path.join(process.cwd(), ".kobin-reports/report-2026-11-04T16-49-38-982Z.json");
const have = fs.existsSync(R1);

test("F184: an erase twelve levels below a moved native's home finds it and cuts it", () => {
    if (!have) return;
    const rep = readReportFile(R1), E = engineFromReport(rep, { parts: drawingPartsOf(R1) });
    // Erase 74's mark again, as `eraseAt` built it: its box covers 67's picture at depth 16.
    const note = rep.history.journal.find((j) => j.kind === "erase" && j.id === 74);
    const mark = { type: "stroke", origin: "native", erase: true, bakePx: note.inScale, id: E.doc.allocId(), pts: note.pts.map((p) => [p[0], p[1]]),
        lwFrame: note.lwFrame, color: "#ffffff", opacity: 1 };
    mark._tol = (E.cfg.arcTolerancePx * 0.5) / note.inScale;
    const key67 = E.doc.editKey(E.doc.getById(67).obj);
    E.doc.add(mark, note.frame);
    E.flushBakes();
    const Erec = E.doc.getById(mark.id);
    expect(Erec.obj.type).toBe("shape");
    // The defect: without the slack the mark's box, mapped up twelve levels, is a point that misses 67's box by rounding.
    const slack = E.stage.model.slack;
    E.stage.model.slack = () => 0;
    const without = E._candidatesUnder(Erec);
    E.stage.model.slack = slack;
    expect(without).not.toContain(67);
    const now = E._candidatesUnder(Erec);
    expect(now).toContain(67);
    expect(now.filter((id) => !without.includes(id))).toEqual([67]);      // the slack added 67 and nothing else
    expect(Erec.obj.targets).toContain(67);
    for (let n = 0; n < 400 && E._bakeNext(); n++);
    expect(E.doc.getById(67)).toBeFalsy();                                // cut: replaced by its family's pieces
    expect(E.doc.editGroup(key67).length).toBeGreaterThan(1);
    expect((E._eraseRefused || []).length).toBe(0);
});

test("F186: after a drop twelve levels below 67's home the ants are where its ink is drawn", () => {
    if (!have) return;
    const rep = readReportFile(R1), E = engineFromReport(rep, { parts: drawingPartsOf(R1) });
    const sc = E.cam.state().inScale;
    const union = (a, r) => (a ? [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])] : r);
    const drawn = () => {
        let b = null;
        for (const it of E.stage.itemsOf(67)) { const { off } = E.stage.placed(it), q = it.box; b = union(b, [q.left + off[0], q.top + off[1], q.right + off[0], q.bottom + off[1]]); }
        return b;
    };
    const ants = () => {
        const a = E._selectionAnts(), dec = E._selDec;
        let b = null;
        for (const p of dec.pieces) b = union(b, [p.bounds.x0, p.bounds.y0, p.bounds.x1, p.bounds.y1]);
        return b.map((v, k) => v + a.off[k % 2] / sc);
    };
    const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-6);
    E._render();
    E.setTool("select");
    E._setSelection([67]);
    E._render();
    expect(near(ants(), drawn())).toBe(true);
    const at = [225, 245], before = drawn();
    E.pointerDown(at[0], at[1]); E.pointerMove(at[0] - 10, at[1] + 15); E.pointerMove(at[0] - 20, at[1] + 30); E.pointerUp();
    E._render();
    const after = drawn();
    expect(Math.abs(after[0] - before[0])).toBeGreaterThan(1);               // the ink moved
    expect(near(ants(), after)).toBe(true);                                  // and the ants with it
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = (E) => { const r = E.renderer.queue.report(); return !r.queued.some((n) => n) && !r.inFlight.some((n) => n); };
async function flush(E, rounds = 80) { for (let k = 0; k < rounds && !(k > 0 && idle(E)); k++) await sleep(0); }
async function settle(E) { for (let k = 0; k < 4; k++) { await flush(E); await sleep(40); E.renderer.syncCameraOnly(); } await flush(E); }
const cellRect = (r) => { const u = PLATE_PX / r.Z; return { left: r.i * u, top: r.j * u, right: (r.i + 1) * u, bottom: (r.j + 1) * u }; };
/** Plates the store calls exact whose pixels are not their cell's truth (raster.dropdirt's check, F153): `[checked, bad]`. */
function falseExact(E) {
    const R0 = E.renderer, bad = [];
    let n = 0;
    for (const r of [...E.plates.records()]) {
        if (r.kind === "plane" || !E.plates.exact(r) || !r.pixels) continue;
        const snap = E.stage.snapshot(r.frame, cellRect(r));
        if (!snap) continue;
        const packed = packJob(snap.items().filter((it) => !it.pending), { plates: Int32Array.of(r.i, r.j), Zq: r.Z, dpr: R0.pyramid.dpr, cfg: R0.cfg, paper: R0._paperRgb, G: snap.generation });
        const t = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
        if (packed.nItems > 0) renderPlate(packed, 0, t, new Uint32Array(8));
        else { const c = R0._paperRgb; for (let p = 0; p < t.length; p += 4) { t[p] = c[0]; t[p + 1] = c[1]; t[p + 2] = c[2]; t[p + 3] = 255; } }
        n++;
        let d = 0;
        for (let k = 0; k < t.length; k += 4) if (t[k] !== r.pixels[k] || t[k + 1] !== r.pixels[k + 1] || t[k + 2] !== r.pixels[k + 2]) d++;
        if (d > 64) bad.push([String(r.frame).slice(-12), r.i, r.j, d]);
    }
    return [n, bad];
}

test("F185: a move twelve levels below a moved native's home is dirtied where it is drawn", async () => {
    if (!have) return;
    resetRasterWorkerClient(); setRasterWorkerCount(1); resetPlaneStats();
    const mk = (w, h) => { const host = document.createElement("div"); document.body.appendChild(host); return new KobinEngine(host, { width: w, height: h, raster: true }); };
    const rep = readReportFile(R1), E = engineFromReport(rep, { parts: drawingPartsOf(R1), mk });
    E._render();
    await settle(E);
    expect(falseExact(E)[1]).toEqual([]);
    E.setTool("select");
    E._setSelection([67], []);
    E._render();
    await sleep(200);
    const R0 = E.renderer;
    for (let t = 0; t < 3000 && !R0.forcePerStepDrag && (R0._planeTimer != null || !R0._plane.tags.length); t += 10) await sleep(10);
    await settle(E);
    // Kobin's drag: from 67's ink by (-20, +30) px.
    const at = [225, 245];
    E._dragSel = { start: at, moved: false };
    E._beginHold();
    await flush(E);
    for (let k = 1; k <= 8; k++) E._dragSelection(at[0] - (20 * k) / 8, at[1] + (30 * k) / 8);
    const G0 = E.stage.generation, F = String(E.cam.frame);
    E._pointerUp();
    const sweeps = E.stage._dirtLog.filter((e) => e.G > G0).flatMap((e) => e.states.filter((s) => s.kind === "sweep"));
    expect(sweeps.length).toBe(1);
    const s = sweeps[0], D = s.drawn;
    expect(D && D.F).toBe(F);                                             // swept as drawn, in the camera frame
    // The stored corner, mapped down twelve levels, lands nowhere near the drawn one (the defect, F185).
    const stored = E.stage.model.footprintMapper(s.s0, F)(s.s0.rect.left, s.s0.rect.bottom, s.s0.rect.left, s.s0.rect.bottom);
    expect(Math.abs(stored.left - D.A.left)).toBeGreaterThan(1e20);
    const cells = [...(E.stage._cellsByFrame.get(F) || [])];
    const dirtied = cells.filter((c) => c.dirty > G0).length;
    expect(dirtied).toBeGreaterThan(0);
    expect(dirtied).toBeLessThan(cells.length);                           // the drawn edges' band, not the whole view
    await settle(E);
    expect(falseExact(E)[1]).toEqual([]);                                 // every exact plate is the document's
    E.destroy();
});
