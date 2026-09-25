/**
 * raster.bench.probe.js — the node microbenchmarks of RASTERISER-PLAN §8.6: measurements 1,
 * 2, 3, 9, 12 and 15, on SYNTHETIC geometry at a stated density (measurement 4 needs a real
 * render list and is stage 2's, §9.3). Not a test: it prints tables and asserts nothing
 * about time. Its numbers go into §8.6 of the plan with the machine they were taken on.
 *
 * Run (the suite skips *.probe.js):
 *   npx react-scripts test --watchAll=false --testMatch "**\/raster.bench.probe.js"
 *
 * Measurement 2 needs several rasterisers running at once, which jsdom cannot do: the probe
 * bundles `rasterCore.js` with esbuild (already a dev dependency) into the OS temp directory
 * and runs it under `worker_threads` in a child node process. One core, one measurement —
 * nothing here re-implements the loop. Measurement 15's refill half runs in the same child for
 * a different reason: jest's transform costs the chunked walk's repeated loads about 14× what
 * the bundled core costs.
 */

import * as core from "./raster/rasterCore";
import * as pack from "./raster/rasterPack";
import { jobBytes, BufferPool } from "./raster/rasterJob";
import { stripSizeFor } from "./raster/rasterWorkerClient";
import { quantumFor, plateRange } from "./raster/plate";
import { mkEngine, useEngines } from "./__testkit__/harness";
import { strokeStripNear } from "./geometry/polyline";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const TW = core.TW, TH = core.TH;
const REPEATS = 5;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The best of `REPEATS` runs of `fn`, in ms — the least disturbed one, not the mean. */
function best(fn, repeats = REPEATS) {
    let b = Infinity;
    for (let i = 0; i < repeats; i++) { const t = now(); fn(); const d = now() - t; if (d < b) b = d; }
    return b;
}
const f = (x, n = 3) => (x == null || !isFinite(x) ? "—" : x.toFixed(n));
function table(rows) {
    const keys = Object.keys(rows[0]);
    const w = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
    const line = (cells) => "  " + cells.map((c, i) => String(c).padStart(w[i])).join("  ");
    console.log(line(keys));
    console.log("  " + w.map((n) => "-".repeat(n)).join("  "));
    for (const r of rows) console.log(line(keys.map((k) => r[k])));
}

// ---------------------------------------------------------------------------
// Scene builders. Everything is in device pixels (Zq = 1) unless a row says otherwise.
// ---------------------------------------------------------------------------

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** A job of one item per family, each item a list of rings, in §3.3's layout. */
function jobOf(items, Zq = 1) {
    const n = items.length;
    const meta = new Uint32Array(8 * n), attr = new Float64Array(9 * n), rgb = new Uint8Array(3 * n);
    const geom = [], subs = [];
    items.forEach((item, k) => {
        const gs = geom.length, ss = subs.length;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const ring of item.rings) {
            subs.push((geom.length - gs) / 2);
            for (const p of ring) {
                geom.push(p[0], p[1]);
                if (p[0] < x0) x0 = p[0];
                if (p[0] > x1) x1 = p[0];
                if (p[1] < y0) y0 = p[1];
                if (p[1] > y1) y1 = p[1];
            }
        }
        meta[k * 8] = 1; meta[k * 8 + 1] = item.fam == null ? k : item.fam;
        meta[k * 8 + 2] = gs; meta[k * 8 + 3] = geom.length - gs;
        meta[k * 8 + 4] = ss; meta[k * 8 + 5] = item.rings.length;
        meta[k * 8 + 6] = item.union ? 4 : 0;
        attr[k * 9] = x0; attr[k * 9 + 1] = y0; attr[k * 9 + 2] = x1; attr[k * 9 + 3] = y1; attr[k * 9 + 7] = 1;
        rgb[k * 3] = 255; rgb[k * 3 + 1] = 255; rgb[k * 3 + 2] = 255;
    });
    return {
        Zq, plates: Int32Array.from([0, 0]), paper: Uint8Array.from([0, 0, 0]), nItems: n,
        meta, attr, rgb, subs: Uint32Array.from(subs), geom: Float64Array.from(geom),
    };
}

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/** The same shape as the core's accumulation buffer, so the unbounded clear can be priced. */
const SCRATCH = new Float32Array((TW + 2) * TH);

// ---------------------------------------------------------------------------

describe("raster bench", () => {
    useEngines();                                 // measurements 4, 6 and 13 build one

    test("measurement 1 — the per-edge cost, split into setup and per-row", () => {
        const E = 4000;
        const rows = [];
        const fit = [];
        for (const R of [1, 4, 16, 64]) {
            const xs = new Float64Array(E * 4);
            for (let i = 0; i < E; i++) {
                const y = rnd() * (TH - R), x = rnd() * (TW - 40);
                xs[i * 4] = x; xs[i * 4 + 1] = y; xs[i * 4 + 2] = x + rnd() * 30 - 15; xs[i * 4 + 3] = y + R;
            }
            // the deposit alone: the family is reset once and cleared after the clock stops, so
            // this is addEdge → addStep → depositRun and nothing else
            core.beginFamily(0, TH);
            const ms = best(() => {
                for (let i = 0; i < E; i++) core.addEdge(xs[i * 4], xs[i * 4 + 1], xs[i * 4 + 2], xs[i * 4 + 3]);
            });
            const msWhole = best(() => {
                core.beginFamily(0, TH);
                for (let i = 0; i < E; i++) core.addEdge(xs[i * 4], xs[i * 4 + 1], xs[i * 4 + 2], xs[i * 4 + 3]);
                core.clearFamily(0, TH);
            });
            core.clearFamily(0, TH);
            const nsPerEdge = (ms * 1e6) / E;
            rows.push({
                "rows/edge": R, edges: E, "ms deposit": f(ms), "ns/edge": f(nsPerEdge, 1),
                "ns/row": f(nsPerEdge / R, 1), "ms +reset +clear": f(msWhole),
            });
            fit.push([R, nsPerEdge]);
        }
        // least squares over the four points: ns/edge = setup + perRow × rows
        const n = fit.length;
        const sx = fit.reduce((a, p) => a + p[0], 0), sy = fit.reduce((a, p) => a + p[1], 0);
        const sxx = fit.reduce((a, p) => a + p[0] * p[0], 0), sxy = fit.reduce((a, p) => a + p[0] * p[1], 0);
        const perRow = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        const setup = (sy - perRow * sx) / n;
        console.log("\nM1  per-edge cost (" + core.accumPrecision() + " accumulation), " + E
            + " edges scattered over one plate, each up to 30 px wide in x");
        table(rows);
        console.log("  fitted: setup " + f(setup, 1) + " ns/edge + " + f(perRow, 1) + " ns/row\n");
        expect(setup).toBeGreaterThan(0);
    });

    test("measurement 3 — the clear, bounded against unbounded, over the family sweep", () => {
        const rows = [];
        const pts = [], bare = [];
        for (const N of [100, 800, 3000, 11497]) {
            const items = [], empty = [];
            for (let k = 0; k < N; k++) {
                const x = rnd() * (TW - 12), y = rnd() * (TH - 12);
                items.push({ fam: k, rings: [rect(x, y, x + 8 + rnd() * 4, y + 8 + rnd() * 4)] });
                // the same family with no ink at all: one pixel of box, a zero-area ring — the
                // box, the two range resets, the resolve entry and the clear, and nothing else
                empty.push({ fam: k, rings: [[[x, y], [x + 1, y], [x, y]]] });
            }
            const job = jobOf(items), jobEmpty = jobOf(empty);
            const out = new Uint8ClampedArray(TW * TH * 4);
            const counts = new Uint32Array(8);
            const ms = best(() => core.renderPlate(job, 0, out, counts));
            const msEmpty = best(() => core.renderPlate(jobEmpty, 0, out));
            // the unbounded clear, priced on its own: one whole-buffer fill per family, on a
            // buffer the same shape as the core's, so this needs no hook inside the core
            const fillMs = best(() => { for (let i = 0; i < 100; i++) SCRATCH.fill(0); }) / 100;
            rows.push({
                families: N, "ms bounded": f(ms), "ms no ink": f(msEmpty), "ms unbounded clear": f(fillMs * N, 1),
                "µs/family bounded": f((ms * 1000) / N), "edges": counts[4], "covered px": counts[7],
            });
            pts.push([N, ms]);
            bare.push([N, msEmpty]);
        }
        const fitSlope = (ps) => {
            const n = ps.length;
            const sx = ps.reduce((a, p) => a + p[0], 0), sy = ps.reduce((a, p) => a + p[1], 0);
            const sxx = ps.reduce((a, p) => a + p[0] * p[0], 0), sxy = ps.reduce((a, p) => a + p[0] * p[1], 0);
            return (n * sxy - sx * sy) / (n * sxx - sx * sx);
        };
        const slope = fitSlope(pts), slopeBare = fitSlope(bare);
        console.log("\nM3  families in one plate: an 8-12 px box of ink each (" + core.accumPrecision() + ")");
        table(rows);
        console.log("  fitted cost per family, with its ink: " + f(slope * 1000, 2) + " µs");
        console.log("  fitted FIXED cost per family, no ink at all: " + f(slopeBare * 1000, 2) + " µs");
        console.log("  where the fade cull bounds this on the recorded canvas, CITED not measured here:");
        console.log("  882 pieces at the F59 camera and 2,545 at the measured crossing (docs/OPEN-FLAGS.md F59)\n");
        expect(slope).toBeGreaterThan(0);
    });

    test("measurement 9 — the 48-unit seam pad's extra edge work, on an opaque dense screen", () => {
        // One opaque object cut into a grid of pieces, as deriveStep cuts it: the pad makes
        // adjacent pieces overlap by SEAM_PX/exit = 48 frame units rather than abut.
        const rows = [];
        const cell = 2048;                                   // frame units per derived piece
        const pad = 48;                                      // seamPadFor(cfg) = SEAM_PX / exit
        // The grid's phase matters as much as the pad: at phase 0 the unpadded cut lines land
        // exactly on the plate's own edges at all three zooms (2,048 × 1/32 = 64 px, 512/64 = 8),
        // which is the worst case for the pad — the row of pieces whose top edge is dropped at
        // y = TH comes back when the pad moves it 1.5 px up. A drawing sits at some other phase.
        for (const phase of [0, 0.37]) {
            for (const Zq of [1 / 32, 1 / 8, 1 / 2]) {
                for (const padded of [false, true]) {
                    const items = [];
                    const off = -cell * phase;
                    const span = Math.ceil((TW / Zq) / cell) + 2;
                    for (let gy = 0; gy < span; gy++) for (let gx = 0; gx < span; gx++) {
                        const x0 = gx * cell + off - (padded ? pad : 0), y0 = gy * cell + off - (padded ? pad : 0);
                        const x1 = (gx + 1) * cell + off + (padded ? pad : 0), y1 = (gy + 1) * cell + off + (padded ? pad : 0);
                        items.push({ fam: 0, rings: [rect(x0, y0, x1, y1)] });
                    }
                    const job = jobOf(items, Zq);
                    const out = new Uint8ClampedArray(TW * TH * 4);
                    const counts = new Uint32Array(8);
                    const ms = best(() => core.renderPlate(job, 0, out, counts));
                    rows.push({
                        phase: f(phase, 2), Zq: f(Zq, 5), "piece px": f(cell * Zq, 1), "pad px": padded ? f(pad * Zq, 2) : "0",
                        "pieces on plate": counts[1], edges: counts[4], "covered px": counts[7], ms: f(ms),
                    });
                }
            }
        }
        console.log("\nM9  the 48-unit seam pad: one OPAQUE object cut into " + cell + "-unit pieces, one plate");
        table(rows);
        console.log("  a row pair is the same object with and without the pad, which is 48 × Zq device px");
        console.log("  and 2.34 % of a piece at every zoom; the object covers the plate in all twelve rows.");
        console.log("  phase is the grid's offset in cells: 0 puts the cut lines on the plate's edges,");
        console.log("  0.37 is a drawing's own phase — the pad's cost is the difference between them\n");
        expect(rows.length).toBe(12);
    });

    test("measurement 12 — the union pass against the fast path", () => {
        const rows = [];
        const lines = [
            { name: "straight", pts: [[20, 60], [480, 60]] },
            { name: "corner", pts: [[40, 120], [300, 120], [300, 400]] },
            { name: "scribble", pts: Array.from({ length: 60 }, (_, i) => [20 + i * 7.6, 250 + Math.sin(i * 0.7) * 60]) },
        ];
        for (const line of lines) for (const w of [0.55, 4, 40]) {
            const rings = strokeStripNear(line.pts, w, { left: 0, top: 0, right: TW, bottom: TH }, { startCap: true, endCap: true });
            const job = jobOf([{ rings, union: true }]);
            const jobFast = jobOf([{ rings, union: false }]);
            const out = new Uint8ClampedArray(TW * TH * 4);
            const counts = new Uint32Array(8), countsFast = new Uint32Array(8);
            const msU = best(() => core.renderPlate(job, 0, out, counts));
            const msF = best(() => core.renderPlate(jobFast, 0, out, countsFast));
            const edges = countsFast[4] || 1, px = countsFast[7] || 1;
            rows.push({
                shape: line.name, "width px": w, rings: rings.length, edges,
                "covered px": px, "ms union": f(msU), "ms fast": f(msF), "×": f(msU / msF, 2),
                "µs/1k edges union": f((msU * 1000 * 1000) / edges), "µs/1k px union": f((msU * 1000 * 1000) / px),
                "µs/1k edges fast": f((msF * 1000 * 1000) / edges),
            });
        }
        console.log("\nM12  the union pass (K = " + core.UNION_K + ") against plain accumulation, on bands the engine's own strokeStripNear built");
        table(rows);
        const share = rows.length;
        console.log("  share of items that are union items: 9 of 9 here, because every fixture is a stroke;");
        console.log("  the share on a REAL screen needs rasterPack's routing and is stage 2's (§9.3)\n");
        expect(share).toBe(9);
    });

    test("measurement 15 — the second walk on a row whose union edges do not fit (F75)", () => {
        const stats = () => ({ splits: core.coreStats.unionSplits, refills: core.coreStats.unionRefills });
        const reset = () => { for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0; };
        /** One run: the counters and the picture from a clean run, the ms from the best of three. */
        function priceOf(rings, probeX) {
            const job = jobOf([{ rings, union: true }]);
            const out = new Uint8ClampedArray(TW * TH * 4);
            const counts = new Uint32Array(8);
            reset();
            core.renderPlate(job, 0, out, counts);
            const s = stats();
            const ms = best(() => core.renderPlate(job, 0, out, counts), 3);
            return { ms, splits: s.splits, refills: s.refills, byte: out[(200 * TW + probeX) * 4], covered: counts[7] };
        }

        // (a) F75's own fixture: ribbons 0.2 px wide and one 40 px block at x 460–500, all inside
        // pixel row 200. The item's box is rows 199–201, so the band splits once and the single
        // row 200 then overflows; before the second walk the block read byte 0. "Covered px" is
        // counts[7] — every pixel the resolve blended inside the row's touched range, so it fell
        // 491 → 401 with the block's span, while the ink lost was the block's own 40 pixels.
        const rowsA = [];
        for (const n of [100, 8000, 8500]) {
            const rings = [];
            for (let i = 0; i < n; i++) { const x = 10 + (i % 800) * 0.5; rings.push(rect(x, 200, x + 0.2, 200.75)); }
            rings.push(rect(460, 200, 500, 200.75));            // the block, loaded last
            const p = priceOf(rings, 470);
            rowsA.push({
                ribbons: n, "union edges": n * 2 + 2, splits: p.splits, refills: p.refills,
                "block byte": p.byte, "covered px": p.covered, "ms": f(p.ms, 1),
            });
        }
        console.log("\nM15a  F75's fixture: the block's byte is 191 whether or not the row needs a second walk");
        console.log("      (covered px is counts[7]: every pixel the resolve blended inside the row's touched");
        console.log("      range, so it is a span with gaps in it and not a count of inked pixels — §8.3)");
        table(rowsA);

        // (b) the refill priced on its own, OUTSIDE jest: the same ribbons one apart, in a box
        // one row deep so no band splits, at 8,192 (16,384 edges — exactly what the buffer
        // holds) and 8,193 (16,386 — one refill, so that row's geometry is read UNION_K times
        // more). Jest's transformed module costs that call-heavy path about 14× what the same
        // core costs bundled and run in node, so this half runs in a child process, as
        // measurement 2's worker sweep does.
        let child = null;
        try {
            child = runRefillCliff();
        } catch (e) {
            console.log("  the refill cliff was NOT measured outside jest: " + e.message + "\n");
        }
        if (child) {
            console.log("\nM15b  the cliff, node " + child.node + ": one ribbon more than the buffer holds, in a");
            console.log("      one-row box, each built in the x order that gives ITS walk an ascending run to");
            console.log("      sort — a row that fits is walked from a per-row list that reverses the push");
            console.log("      order, the chunked walk keeps it, and built the same way the two differ by 7×,");
            console.log("      which swamps what is being priced");
            table(child.rows);
            console.log("  refill cost " + f(child.delta, 2) + " ms over " + f(child.base, 2) + " ms for the row that fits,");
            console.log("  = " + f((child.delta * 1e6) / (16386 * core.UNION_K), 1) + " ns an edge for each of the "
                + core.UNION_K + " extra passes over the row's geometry\n");
            console.log("  and F75's own 8,500-ribbon fixture in the same child: " + f(child.f75, 1) + " ms\n");
        }
        expect(rowsA[2]["block byte"]).toBe(rowsA[0]["block byte"]);
    });

    test("measurement 2 — the full-plate resolve, f32 against f64, at 1, 2 and 4 concurrent workers", () => {
        // in-process first, so there is a number even if the child process cannot be built
        const inproc = [];
        for (const kind of ["f32", "f64"]) {
            core.useAccumPrecision(kind);
            const out = new Uint8ClampedArray(TW * TH * 4);
            const job = jobOf([{ rings: [rect(-10, -10, TW + 10, TH + 10)] }]);
            const ms = best(() => core.renderPlate(job, 0, out));
            inproc.push({ where: "jsdom, 1 thread", accumulation: kind, "ms/plate": f(ms) });
        }
        core.useAccumPrecision(core.ACC_F32 ? "f32" : "f64");
        console.log("\nM2  one full-plate resolve (a plate-covering shape, every pixel blended)");
        table(inproc);

        let out = null;
        try {
            out = runWorkerSweep();
        } catch (e) {
            console.log("  worker sweep NOT measured: " + e.message + "\n");
        }
        if (out) {
            table(out.rows);
            console.log("  " + out.note + "\n");
        }
        expect(inproc.length).toBe(2);
    });

    // -----------------------------------------------------------------------
    // Measurements 4, 6 and 13 (stage 2): a REAL render list, packed. They need a report's
    // document, which `.kobin-reports/` is not in git for — `tools/extract-fixture.js dense`
    // writes the camera and the snapshot alone and this reads that. Without it they print why
    // and pass, the way measurement 2 does when the child process cannot be built.
    // -----------------------------------------------------------------------
    test("measurement 4 — a real screen: plates, items, pieces, chords, edges, rows, ms", () => {
        const screen = loadScreen();
        if (!screen) return;
        const { E, list, dpr, listMs } = screen;
        const { q, Zq } = quantumFor(E.cam.inScale, dpr);
        const win = E.cam.frameWindow(0);
        const r = plateRange(win, Zq);
        const plates = [];
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) plates.push(i, j);
        const nPlates = plates.length / 2;
        const strips = stripsOf(plates, 3);

        pack.clearPackCaches();
        pack.resetPackStats();
        const out = new Uint8ClampedArray(TW * TH * 4);
        const counts = new Uint32Array(8);
        const timings = new Float64Array(7);
        const rows = [];
        let packMs = 0, drawMs = 0, bytes = 0, unionDrawn = 0, drawn = 0;
        const phase = [0, 0, 0, 0];                    // prune, edges, union, resolve+clear
        for (const strip of strips) {
            let t = now();
            const job = pack.packJob(list, { plates: Int32Array.from(strip), q, Zq, dpr, cfg: E.cfg, paper: [255, 255, 255] });
            packMs += now() - t;
            bytes += jobBytes(job);
            for (let p = 0; p * 2 < strip.length; p++) {
                t = now();
                core.renderPlate(job, p, out, counts, timings);
                const ms = now() - t;
                drawMs += ms;
                drawn += counts[1]; unionDrawn += counts[3];
                phase[0] += timings[2]; phase[1] += timings[4]; phase[2] += timings[5]; phase[3] += timings[6];
                rows.push({
                    plate: strip[p * 2] + "," + strip[p * 2 + 1], items: counts[0], drawn: counts[1], families: counts[2],
                    union: counts[3], edges: counts[4], chords: counts[5], rows: counts[6], "covered px": counts[7],
                    "union ms": f(timings[5], 1), ms: f(ms, 2),
                });
            }
        }
        rows.sort((a, b) => +b.ms - +a.ms);
        console.log("\nM4  a real screen — " + screen.report + ", camera level " + E.cam.activeLevel
            + ", inScale " + f(E.cam.inScale, 4) + ", dpr " + dpr + ", screen " + screen.screen.w + "×" + screen.screen.h + " CSS px");
        console.log("  the render list is " + list.length + " items / " + piecesOf(list) + " pieces, built in "
            + f(listMs, 0) + " ms (the SVG renderer is stubbed out, so this is `_buildList` alone);"
            + " the screen is " + nPlates + " plates at quantum " + q + " (Zq " + f(Zq, 5) + ") in " + strips.length + " strips");
        table(rows.slice(0, 12));
        const msAll = drawMs;
        console.log("  packing " + f(packMs, 1) + " ms for " + (bytes / (1 << 20)).toFixed(2) + " MB of job,"
            + " rastering " + f(msAll, 1) + " ms for " + nPlates + " plates = " + f(msAll / nPlates, 2) + " ms a plate"
            + " (worst " + rows[0].ms + ", median " + rows[Math.floor(rows.length / 2)].ms + ")");
        console.log("  the raster time splits: prune " + f(phase[0], 0) + " ms, edges " + f(phase[1], 0)
            + " ms, UNION PASS " + f(phase[2], 0) + " ms, resolve + clear " + f(phase[3], 0) + " ms");
        console.log("  union items are " + f((100 * unionDrawn) / Math.max(1, drawn), 1) + " % of the items drawn"
            + " (measurement 12's missing half)");
        console.log("  packer: " + pack.packStats.packed + " packed, " + pack.packStats.culled + " culled, "
            + pack.packStats.bandsBuilt + " bands built, " + (pack.packMemoBytes() / (1 << 20)).toFixed(2) + " MB memoised\n");
        expect(nPlates).toBeGreaterThan(0);
    });

    test("measurement 6 — packet bytes per second through a simulated three-octave zoom", () => {
        const screen = loadScreen();
        if (!screen) return;
        const { E, list, dpr } = screen;
        const q0 = quantumFor(E.cam.inScale, dpr).q;
        const win = E.cam.frameWindow(0);
        const rows = [];
        for (const pooled of [false, true]) {
            const pool = pooled ? new BufferPool(16 << 20) : null;
            pack.clearPackCaches();
            pack.resetPackStats();
            let bytes = 0, jobs = 0, alloc = 0;
            const t = now();
            for (let k = 0; k <= 12; k++) {                 // three octaves, a quarter-octave a step
                const Zq = Math.pow(2, (q0 - k) / 4);
                const r = plateRange(win, Zq);
                const plates = [];
                for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) plates.push(i, j);
                for (const strip of stripsOf(plates, 3)) {
                    const job = pack.packJob(list, { plates: Int32Array.from(strip), q: q0 - k, Zq, dpr, cfg: E.cfg, paper: [255, 255, 255], pool });
                    bytes += jobBytes(job);
                    jobs++;
                    if (pool) for (const a of [job.geom, job.meta, job.attr, job.subs, job.rgb, job.ids]) pool.give(a);
                    else alloc += jobBytes(job);
                }
            }
            const ms = now() - t;
            if (pool) alloc = pool.allocBytes;
            rows.push({
                pool: pooled ? "yes" : "no", jobs, "MB packed": (bytes / (1 << 20)).toFixed(2),
                "MB allocated": (alloc / (1 << 20)).toFixed(2), ms: f(ms, 0),
                "MB/s": ((bytes / (1 << 20)) / (ms / 1000)).toFixed(1),
            });
        }
        console.log("\nM6  a simulated three-octave zoom (13 quanta), the visible plates re-packed at each");
        table(rows);
        console.log("  the pool changes what is ALLOCATED, not what crosses: the same bytes are packed either way,");
        console.log("  and it is the allocated column the phone's GC pays for\n");
        expect(rows.length).toBe(2);
    });

    test("measurement 13 — the stroke band on the main thread", () => {
        const recorded = [require("./__fixtures__/arc-stroke.json"), require("./__fixtures__/arc-stroke2.json")];
        const cfg = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25 };
        const rows = [];
        for (const rec of recorded) {
            for (const w of [rec.width / 10, rec.width, rec.width * 10]) {
                const item = { type: "stroke", id: 1, pts: rec.pts, lwFrame: w, color: "#000000", opacity: 1 };
                let band = null;
                const ms = best(() => { pack.clearPackCaches(); band = pack.bandFor(item, 0, 1, cfg); }, 3);
                const edges = band.geom.length / 2;             // one edge per point, the rings closed
                // the same stroke through the DEFAULT miter path, which is what the SVG side
                // builds an outline from: the ratio is §4.8's edge multiplier
                const strip = strokeStripNear(rec.pts, w, { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }, { startCap: true, endCap: true });
                const stripEdges = strip.reduce((n, r) => n + r.length, 0);
                rows.push({
                    points: rec.pts.length, "width (frame)": f(w, 1), rings: band.subs.length, edges,
                    "edges/point": f(edges / rec.pts.length, 2), "× the miter strip": f(edges / stripEdges, 2),
                    ms: f(ms, 2), "ms/1000 pts": f((ms * 1000) / rec.pts.length, 2),
                });
            }
        }
        console.log("\nM13  the stroke band (§4.8), built once per item per zoom quantum on the MAIN thread");
        table(rows);

        const screen = loadScreen();
        if (screen) {
            const { E, list, dpr } = screen;
            const strokes = list.filter((o) => o.type === "stroke");
            const q0 = quantumFor(E.cam.inScale, dpr);
            pack.clearPackCaches();
            pack.resetPackStats();
            let t = now();
            for (const o of strokes) pack.bandFor(o, q0.q, q0.Zq, E.cfg);
            const first = now() - t;
            t = now();
            for (const o of strokes) pack.bandFor(o, q0.q, q0.Zq, E.cfg);
            const memo = now() - t;
            t = now();
            for (const o of strokes) pack.bandFor(o, q0.q - 1, q0.Zq * Math.pow(2, -0.25), E.cfg);
            const flip = now() - t;
            console.log("  on the real screen: " + strokes.length + " stroke items of " + list.length + " — "
                + f(first, 1) + " ms to band them all, " + f(memo, 2) + " ms when the memo answers,"
                + " and " + f(flip, 1) + " ms for one quantum change (" + pack.packStats.bandsBuilt + " bands built)\n");
        }
        expect(rows.length).toBe(6);
    });

    // -----------------------------------------------------------------------
    // Measurement 11 (stage 3): the same real screen through 1, 2 and 4 worker THREADS, one
    // queue and strips of `ceil(plates / (workers × 2))` — the shipped rule, imported rather
    // than restated. The packing is jest's (it needs the engine); the rastering is a plain node
    // child on an esbuild bundle of the shipped core, as measurements 2 and 15 are.
    // -----------------------------------------------------------------------
    test("measurement 11 — N workers against 1, and the imbalance ratio", () => {
        const screen = loadScreen();
        if (!screen) return;
        const { E, list, dpr } = screen;
        const { q, Zq } = quantumFor(E.cam.inScale, dpr);
        const r = plateRange(E.cam.frameWindow(0), Zq);
        const plates = [];
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) plates.push(i, j);
        const nPlates = plates.length / 2;

        // The phases, in the order they are run. The last two are controls: one plate a strip,
        // which is the lever if the imbalance ever misses its bar, and a repeat of the single
        // worker, which says whether the machine drifted under the sweep.
        const phases = [
            { n: 1, label: "1", per: stripSizeFor(nPlates, 1) },
            { n: 2, label: "2", per: stripSizeFor(nPlates, 2) },
            { n: 4, label: "4", per: stripSizeFor(nPlates, 4) },
            { n: 4, label: "4 (1 a strip)", per: 1 },
            { n: 1, label: "1 (again)", per: stripSizeFor(nPlates, 1) },
        ];
        for (const ph of phases) {
            pack.clearPackCaches();
            pack.resetPackStats();
            ph.jobs = [];
            ph.packMs = 0;
            for (const strip of stripsOf(plates, ph.per)) {
                const t = now();
                ph.jobs.push(pack.packJob(list, { plates: Int32Array.from(strip), q, Zq, dpr, cfg: E.cfg, paper: [255, 255, 255] }));
                ph.packMs += now() - t;
            }
        }
        // The same strips at 4 workers, heaviest first, ordered by the strip's ITEM count — the
        // only cost proxy a packed job carries, since edges are counted at render time (counts[4]).
        // A weak proxy on this screen, where one plate is 15–20× the median in edge cost (§8.6 row 11).
        const heavy = phases[2].jobs.slice().sort((a, b) => b.nItems - a.nItems);
        phases.push({ n: 4, label: "4 (heaviest first)", per: phases[2].per, jobs: heavy, packMs: phases[2].packMs });
        // The machine's own ceiling, which is not this build's: every thread draws the SAME
        // strip, so the work is fixed and only the sharing changes. Without it a flat scaling
        // curve cannot be told from a laptop part that cannot feed four threads.
        for (const n of [1, 2, 4]) phases.push({ n, dup: true, label: "dup" + n, per: phases[0].per, jobs: [phases[0].jobs[0]] });

        let out = null;
        try {
            out = runWorkerScale(phases);
        } catch (e) {
            console.log("\nM11  NOT measured: " + e.message + "\n");
            return;
        }
        const rows = [];
        const one = out.sweep[0].totalMs;
        for (let k = 0; k < out.sweep.length; k++) {
            const e = out.sweep[k], ph = phases[k];
            if (ph.dup) continue;
            const mean = e.busy.reduce((a, b) => a + b, 0) / e.busy.length;
            rows.push({
                workers: ph.label, "plates/strip": ph.per, strips: ph.jobs.length, plates: e.plates,
                "total ms": f(e.totalMs, 1), "×1 worker": f(one / e.totalMs, 2),
                "ms/plate": f(e.totalMs / e.plates, 2),
                "busy ms (slowest)": f(Math.max(...e.busy), 1), "imbalance": f(Math.max(...e.busy) / mean, 2),
                "Medges/s": f(e.edges / e.totalMs / 1000, 2), "Mpx/s": f((e.plates * 262144) / e.totalMs / 1000, 2),
            });
        }
        console.log("\nM11  a real screen (measurement 4's) through worker_threads — " + nPlates
            + " plates, one queue, strips of ceil(plates / (workers × 2))");
        table(rows);
        console.log("  packing stays on the main thread and is not divided by any of this: "
            + phases.filter((ph) => !ph.dup).map((ph) => ph.label + " " + f(ph.packMs, 0) + " ms").join(", ")
            + " (the strips differ, so the boundary duplication does)");
        const dup = out.sweep.filter((e, k) => phases[k].dup);
        console.log("  this machine's own ceiling — the SAME " + phases[0].per + "-plate strip in every thread at once: "
            + dup.map((e) => e.n + "×" + f(Math.max(...e.busy), 0)).join(", ") + " ms a thread, so "
            + dup[dup.length - 1].n + " threads do " + dup[dup.length - 1].n + "× the work in "
            + f(Math.max(...dup[dup.length - 1].busy) / Math.max(...dup[0].busy), 2) + "× the time");
        console.log("  the bar is an imbalance ratio (slowest worker ÷ mean) at or under 1.5; node " + out.node);
        // A cold thread pays the JIT on its first plates, which reads exactly like a scaling
        // wall: spawning the pool early is not the same as warming it (§8.5).
        console.log("  a COLD thread over the same " + (phases[0].jobs[0].plates.length / 2) + "-plate strip, four passes: "
            + out.warm.map((s) => s.map((m) => f(m, 0)).join(" → ")).join("  |  ") + " ms\n");

        // The table above is CORE-ONLY: each thread calls `renderPlate`, as measurements 2 and 15
        // do, so what it isolates is the scaling. The shipped worker entry pays three things more
        // per job — `unwireJob`'s validate, the painted-id set, and a 1.05 MB `copyPlate` a plate
        // on the fallback path — and a row called "N workers against 1" that left them out would
        // overstate the shipped path (§15.3 Q2). One thread, the same strips, both ways.
        let ov = null;
        try {
            ov = runEntryOverhead(phases[0].jobs);
        } catch (e) {
            console.log("  the worker entry's own overhead NOT measured: " + e.message);
        }
        if (ov) {
            console.log("  the same " + ov.plates + " plates on ONE thread, core-only against the shipped"
                + " `runJob` entry (the copy path, which is what a browser without createImageBitmap takes):"
                + " core " + f(ov.coreMs, 1) + " ms, entry " + f(ov.entryMs, 1) + " ms — "
                + f((ov.entryMs - ov.coreMs) / ov.plates, 2) + " ms a plate of unwire + id set + 1.05 MB copy, "
                + f((ov.entryMs / ov.coreMs - 1) * 100, 1) + " % over the core, best of " + ov.repeats + "\n");
        }
        expect(rows.length).toBe(phases.filter((ph) => !ph.dup).length);
    });

    // -----------------------------------------------------------------------
    // Measurement 8 (stage 3): what the raster worker's bundle costs to load, with the erase
    // worker's beside it — the two files `npm run build:worker` writes into `public/`.
    // -----------------------------------------------------------------------
    test("measurement 8 — the worker bundle's size, with the erase worker's beside it", () => {
        let out = null;
        try {
            out = bundleSizes();
        } catch (e) {
            console.log("\nM8  NOT measured: " + e.message + "\n");
            return;
        }
        console.log("\nM8  the two worker bundles (esbuild, --format=iife --target=es2019, as `build:worker` writes them)");
        table(out.rows);
        console.log("  the raster bundle by input, `esbuild --analyze`:");
        for (const line of out.analyze) console.log("  " + line);
        console.log("  a worker parses its bundle on the way up, which is why the pool is spawned"
            + " from the engine's constructor and not from the first render (§8.5)\n");
        expect(out.rows.length).toBe(2);
        // The one assertion this measurement makes: `public/` holds what this source builds.
        // `prestart`/`prebuild` rebuild both bundles, so a stale one here means nothing rebuilt
        // the bundle since its source changed — the row names which worker it is.
        expect(out.rows.filter((r) => r["same as source"] === "NO").map((r) => r.worker)).toEqual([]);
    });
});

/**
 * Measurement 11: the packed jobs written out once, then rastered by N threads pulling from one
 * queue. The child requires an esbuild bundle of the shipped core, so nothing here re-implements
 * the loop, and the file is read before the clock starts.
 */
function runWorkerScale(phases) {
    const { dir, bundle } = bundleCore();
    const file = path.join(dir, "m11-jobs.bin");
    const all = [], seen = new Map();
    const plan = phases.map((ph) => ({
        n: ph.n, dup: !!ph.dup,
        jobs: ph.jobs.map((j) => {
            if (!seen.has(j)) { all.push(j); seen.set(j, all.length - 1); }
            return seen.get(j);
        }),
    }));
    writeJobsFile(file, all);
    const driver = path.join(dir, "driver11.js");
    fs.writeFileSync(driver, DRIVER11_SRC.replace("__BUNDLE__", JSON.stringify(bundle)), "utf8");
    const json = execFileSync(process.execPath, [driver, file, JSON.stringify(plan)],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 << 20 });
    return JSON.parse(json);
}

/**
 * The jobs as bytes: a JSON header of the scalars and each array's type, offset and length, then
 * the arrays themselves 8-aligned so a Float64Array view over them is legal.
 */
function writeJobsFile(file, jobs) {
    const keys = ["plates", "epochs", "paper", "meta", "attr", "rgb", "subs", "geom", "ids"];
    const head = [], parts = [];
    let off = 0;
    for (const j of jobs) {
        const rec = { q: j.q, Zq: j.Zq, plateW: j.plateW, nItems: j.nItems, a: {} };
        for (const k of keys) {
            const a = j[k];
            const pad = (8 - (off % 8)) % 8;
            if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
            rec.a[k] = { t: a.constructor.name, o: off, n: a.length };
            parts.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
            off += a.byteLength;
        }
        head.push(rec);
    }
    const json = Buffer.from(JSON.stringify(head), "utf8");
    const lead = Buffer.alloc(8 + Math.ceil(json.length / 8) * 8);
    lead.writeUInt32LE(json.length, 0);
    json.copy(lead, 8);
    fs.writeFileSync(file, Buffer.concat([lead].concat(parts)));
}

const DRIVER11_SRC = `
// generated by src/engine/raster.bench.probe.js — measurement 11's worker scaling
const { Worker, isMainThread, workerData, parentPort } = require("worker_threads");
const fs = require("fs");
const core = require(__BUNDLE__);
const CTOR = { Int32Array, Uint32Array, Float64Array, Uint8Array, Uint8ClampedArray };

function loadJobs(file) {
    const data = fs.readFileSync(file);
    const headLen = data.readUInt32LE(0);
    const head = JSON.parse(data.slice(8, 8 + headLen).toString("utf8"));
    const base = 8 + Math.ceil(headLen / 8) * 8;
    const ab = new ArrayBuffer(data.length - base);
    new Uint8Array(ab).set(data.slice(base));
    return head.map((rec) => {
        const job = { q: rec.q, Zq: rec.Zq, plateW: rec.plateW, nItems: rec.nItems };
        for (const k of Object.keys(rec.a)) {
            const d = rec.a[k];
            job[k] = new CTOR[d.t](ab, d.o, d.n);
        }
        return job;
    });
}

// One WARM pool for the whole sweep. A freshly spawned thread pays JIT on its first plates —
// 275 ms against 96 for the same 15 plates, measured — and a sweep that respawns per phase pays
// it once per worker, which reads exactly like a scaling wall and is not one.
if (!isMainThread) {
    const jobs = loadJobs(workerData.file);
    const out = new Uint8ClampedArray(core.TW * core.TH * 4);
    const counts = new Uint32Array(8);
    let busy = 0, edges = 0, covered = 0, plates = 0;
    const draw = (job, count) => {
        const t = process.hrtime.bigint();
        for (let p = 0; p * 2 < job.plates.length; p++) {
            core.renderPlate(job, p, out, counts);
            if (count) { edges += counts[4]; covered += counts[7]; plates++; }
        }
        if (count) busy += Number(process.hrtime.bigint() - t) / 1e6;
    };
    parentPort.on("message", (m) => {
        if (m.k === "warm") {
            const t = process.hrtime.bigint();
            for (const g of m.jobs) draw(jobs[g], false);
            parentPort.postMessage({ k: "done", ms: Number(process.hrtime.bigint() - t) / 1e6 });
            return;
        }
        if (m.k === "reset") { busy = 0; edges = 0; covered = 0; plates = 0; parentPort.postMessage({ k: "done" }); return; }
        if (m.k === "stats") { parentPort.postMessage({ k: "stats", busy, edges, covered, plates }); return; }
        draw(jobs[m.job], true);
        parentPort.postMessage({ k: "done" });
    });
    parentPort.postMessage({ k: "boot" });
} else {
    const file = process.argv[2];
    const plan = JSON.parse(process.argv[3]);
    const res = { node: process.version, sweep: [] };
    const top = Math.max.apply(null, plan.map((p) => p.n));
    const once = (w, want) => new Promise((ok, no) => {
        const clean = () => { w.removeListener("message", onMsg); w.removeListener("error", onErr); };
        const onMsg = (m) => { clean(); if (m.k === want) ok(m); else no(new Error("expected " + want + ", got " + m.k)); };
        const onErr = (e) => { clean(); no(e); };
        w.on("message", onMsg);
        w.on("error", onErr);
    });
    (async () => {
        const workers = [];
        for (let k = 0; k < top; k++) {
            const w = new Worker(__filename, { workerData: { file } });
            workers.push(w);
            await once(w, "boot");
        }
        // Warm each thread on the same strip four times, and keep the four durations: a cold
        // thread's first pass over a strip is the JIT's, and it is worth a number of its own.
        res.warm = [];
        for (const w of workers) {
            const seq = [];
            for (let k = 0; k < 4; k++) { w.postMessage({ k: "warm", jobs: [0] }); seq.push((await once(w, "done")).ms); }
            w.postMessage({ k: "warm", jobs: [1, 1] });
            await once(w, "done");
            res.warm.push(seq);
        }

        for (const phase of plan) {
            const n = phase.n;
            const use = workers.slice(0, n);
            for (const w of use) { w.postMessage({ k: "reset" }); await once(w, "done"); }
            const queue = phase.dup ? [] : phase.jobs.slice();
            const t0 = process.hrtime.bigint();
            await new Promise((done, no) => {
                let live = use.length;
                for (const w of use) {
                    w.removeAllListeners("message");
                    w.removeAllListeners("error");
                    w.on("error", no);
                    w.on("message", () => {
                        if (queue.length) w.postMessage({ k: "job", job: queue.shift() });
                        else if (--live === 0) done();
                    });
                    // dup: every thread draws the SAME strip, so the work is fixed per thread
                    if (phase.dup) w.postMessage({ k: "job", job: phase.jobs[0] });
                    else if (queue.length) w.postMessage({ k: "job", job: queue.shift() });
                    else if (--live === 0) done();
                }
            });
            const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
            const busy = [], totals = { edges: 0, covered: 0, plates: 0 };
            for (const w of use) {
                w.removeAllListeners("message");
                w.postMessage({ k: "stats" });
                const m = await once(w, "stats");
                busy.push(m.busy);
                totals.edges += m.edges; totals.covered += m.covered; totals.plates += m.plates;
            }
            res.sweep.push({ n, totalMs, busy, edges: totals.edges, covered: totals.covered, plates: totals.plates });
        }
        for (const w of workers) w.terminate();
        process.stdout.write(JSON.stringify(res));
    })();
}
`;

/**
 * Measurement 11's other half (§15.3 Q2): the same strips on ONE thread through the shipped
 * `runJob` entry against `renderPlate` alone, so the row can say what the entry costs a plate.
 * The same node child and the same bundle rule as the sweep above; the jobs are read from the
 * file once and wired outside the clock, because `wireJob` is the MAIN thread's cost.
 */
function runEntryOverhead(jobs) {
    const { dir, bundle } = bundleEntry();
    const file = path.join(dir, "m11e-jobs.bin");
    writeJobsFile(file, jobs);
    const driver = path.join(dir, "driver11e.js");
    fs.writeFileSync(driver, DRIVER11E_SRC.replace("__BUNDLE__", JSON.stringify(bundle)), "utf8");
    const json = execFileSync(process.execPath, [driver, file],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 << 20 });
    return JSON.parse(json);
}

const DRIVER11E_SRC = `
// generated by src/engine/raster.bench.probe.js — measurement 11's worker-entry overhead
const fs = require("fs");
const m = require(__BUNDLE__);
const CTOR = { Int32Array, Uint32Array, Float64Array, Uint8Array, Uint8ClampedArray };

function loadJobs(file) {
    const data = fs.readFileSync(file);
    const headLen = data.readUInt32LE(0);
    const head = JSON.parse(data.slice(8, 8 + headLen).toString("utf8"));
    const base = 8 + Math.ceil(headLen / 8) * 8;
    const ab = new ArrayBuffer(data.length - base);
    new Uint8Array(ab).set(data.slice(base));
    return head.map((rec) => {
        const job = { q: rec.q, Zq: rec.Zq, plateW: rec.plateW, nItems: rec.nItems };
        for (const k of Object.keys(rec.a)) { const d = rec.a[k]; job[k] = new CTOR[d.t](ab, d.o, d.n); }
        return job;
    });
}

(async () => {
    const jobs = loadJobs(process.argv[2]);
    const msgs = jobs.map((j) => m.wireJob(j).msg);          // the main thread's own work, outside the clock
    const out = new Uint8ClampedArray(m.TW * m.TH * 4);
    const counts = new Uint32Array(8);
    let plates = 0;
    for (const j of jobs) plates += j.plates.length / 2;
    const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
    const core = async () => { const t = process.hrtime.bigint();
        for (const j of jobs) for (let p = 0; p * 2 < j.plates.length; p++) m.renderPlate(j, p, out, counts);
        return ms(t); };
    const entry = async () => { const t = process.hrtime.bigint();
        for (const g of msgs) await m.runJob(g, { bitmaps: false });
        return ms(t); };
    const repeats = 4;
    let coreMs = Infinity, entryMs = Infinity;
    for (let k = 0; k < repeats; k++) {                       // the first pass is the JIT's
        coreMs = Math.min(coreMs, await core());
        entryMs = Math.min(entryMs, await entry());
    }
    process.stdout.write(JSON.stringify({ plates, coreMs, entryMs, repeats, node: process.version }));
})();
`;

/** The strips one screen's plates are dispatched in (§3.6): `ceil(plates / (workers × 2))`. */
function stripsOf(plates, per) {
    const out = [];
    for (let i = 0; i < plates.length; i += per * 2) out.push(plates.slice(i, i + per * 2));
    return out;
}
const piecesOf = (list) => list.reduce((n, o) => n + (o.loops ? o.loops.reduce((m, L) => m + (L.idx ? L.idx.length : 1), 0)
    : o.polys ? o.polys.reduce((m, r) => m + r.length, 0) : (o.pts ? o.pts.length : 0)), 0);

/**
 * The document of a report, loaded into an engine, and its real render list. The SVG renderer is
 * stubbed out: F59's 7,987 ms is Two.js building a path per piece, which §2.4 freezes and this
 * build replaces, and leaving it in would measure it instead of the raster path.
 */
function loadScreen() {
    const file = process.env.RASTER_DENSE || path.join(process.cwd(), ".kobin-reports", "dense-screen.json");
    if (!fs.existsSync(file)) {
        console.log("\n  no dense screen at " + file + " — run `node tools/extract-fixture.js dense <report.json>`"
            + " (§9.3: the reports are not in git)\n");
        return null;
    }
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const scr = j.screen || { w: 1504, h: 868, dpr: 1.5 };
    const E = mkEngine(scr.w, scr.h);
    E.renderer.render = () => {}; E.renderer.update = () => {}; E.renderer.clear = () => {};
    E._scheduleBake = () => {};
    E.loadSnapshot(j.snapshot);
    const t = now();
    const list = E._buildList();
    return { E, list, screen: scr, dpr: scr.dpr || 1, report: j.report, listMs: now() - t };
}

/**
 * Measurement 2's other half: the same full-plate resolve in 1, 2 and 4 worker threads at
 * once, which is what decides ACC_F32 — the f32 case is a cache argument and four workers
 * share the last-level cache. Bundles the real core; nothing here re-implements it.
 */
function runWorkerSweep() {
    const { dir, bundle } = bundleCore();
    const driver = path.join(dir, "driver.js");
    fs.writeFileSync(driver, DRIVER_SRC.replace("__BUNDLE__", JSON.stringify(bundle)), "utf8");
    const json = execFileSync(process.execPath, [driver], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const r = JSON.parse(json);
    const rows = [];
    for (const kind of ["f32", "f64"]) {
        for (const n of [1, 2, 4]) {
            const e = r[kind + n];
            rows.push({
                where: "node, " + n + " worker" + (n > 1 ? "s" : ""), accumulation: kind,
                "ms/plate": f(e.per), "slowest worker ms": f(e.slowest), "×1 worker": f(e.per / r[kind + "1"].per, 2),
            });
        }
    }
    return { rows, note: "each worker resolves " + r.iters + " full plates; ms/plate is the mean over workers, node " + r.node };
}

const benchDir = () => {
    const dir = path.join(os.tmpdir(), "boundless-raster-bench");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};
const esbuildBin = () => path.join(process.cwd(), "node_modules", ".bin",
    process.platform === "win32" ? "esbuild.cmd" : "esbuild");

/** The shipped core, bundled into the OS temp directory so a child node process can require it. */
function bundleCore() {
    const dir = benchDir();
    const bundle = path.join(dir, "rasterCore.cjs");
    execFileSync(esbuildBin(), [
        path.join("src", "engine", "raster", "rasterCore.js"),
        "--bundle", "--format=cjs", "--target=es2019", "--outfile=" + bundle,
    ], { cwd: process.cwd(), stdio: "pipe" });
    return { dir, bundle };
}

/**
 * The shipped worker ENTRY — `runJob` and what it calls — bundled the same way, with `wireJob`
 * and `renderPlate` beside it so one child can time both paths over one set of jobs.
 */
function bundleEntry() {
    const dir = benchDir();
    const bundle = path.join(dir, "rasterEntry.cjs");
    const src = path.join(dir, "entrySrc.js");
    const abs = (p) => JSON.stringify(path.join(process.cwd(), p).replace(/\\/g, "/"));
    fs.writeFileSync(src, [
        "export { runJob } from " + abs("src/engine/worker/rasterWorker.js") + ";",
        "export { wireJob } from " + abs("src/engine/raster/rasterJob.js") + ";",
        "export { renderPlate, TW, TH } from " + abs("src/engine/raster/rasterCore.js") + ";",
    ].join("\n"), "utf8");
    execFileSync(esbuildBin(), [src, "--bundle", "--format=cjs", "--target=es2019", "--outfile=" + bundle],
        { cwd: process.cwd(), stdio: "pipe" });
    return { dir, bundle };
}

/**
 * Measurement 8: both worker bundles built the way `npm run build:worker` builds them, with
 * `--analyze`'s breakdown of the raster one and the md5 of what is in `public/` today, so a row
 * can say whether the shipped file is the one this source produces.
 */
function bundleSizes() {
    const dir = benchDir();
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const build = (entry, out, minify) => {
        const args = [entry, "--bundle", "--format=iife", "--target=es2019", "--outfile=" + out];
        if (minify) args.push("--minify");
        else args.push("--analyze");
        const r = spawnSync(esbuildBin(), args, { cwd: process.cwd(), encoding: "utf8" });
        if (r.status !== 0) throw new Error("esbuild: " + (r.stderr || r.error || "").toString().slice(0, 200));
        return { bytes: fs.statSync(out).size, analyze: (r.stderr || "").split(/\r?\n/).filter((s) => s.trim()) };
    };
    const rows = [];
    let analyze = [];
    for (const w of [
        { name: "raster", entry: "src/engine/worker/rasterWorker.js", shipped: "public/raster-worker.js" },
        { name: "erase", entry: "src/engine/worker/eraseWorker.js", shipped: "public/erase-worker.js" },
    ]) {
        const plainFile = path.join(dir, w.name + "-plain.js");
        const plain = build(w.entry, plainFile, false);
        const min = build(w.entry, path.join(dir, w.name + "-min.js"), true);
        if (w.name === "raster") analyze = plain.analyze.slice(0, 10);
        const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
        // The freshness check is the MD5 of the fresh build against the shipped file, not their
        // byte lengths: a renamed identifier or a constant of equal width ships a stale bundle at
        // the same size, and stage 7 would then measure code this tree no longer holds.
        const fresh = md5(fs.readFileSync(plainFile));
        const shipped = fs.existsSync(w.shipped) ? fs.readFileSync(w.shipped) : null;
        rows.push({
            worker: w.name, "bytes (as shipped)": plain.bytes, "bytes minified": min.bytes,
            "public/ bytes": shipped ? shipped.length : "—",
            "public/ md5": shipped ? md5(shipped).slice(0, 8) : "—",
            "fresh md5": fresh.slice(0, 8),
            "same as source": shipped ? (md5(shipped) === fresh ? "md5" : "NO") : "—",
        });
    }
    return { rows, analyze };
}

/**
 * Measurement 15's other half: the refill cliff and F75's own fixture in a plain node child,
 * because jest's transform costs the chunked walk's repeated loads about 14× what the bundled
 * core costs (the row that fits reads the same either way, so the inflation is the loads).
 */
function runRefillCliff() {
    const { dir, bundle } = bundleCore();
    const driver = path.join(dir, "driver15.js");
    fs.writeFileSync(driver, DRIVER15_SRC.replace("__BUNDLE__", JSON.stringify(bundle)), "utf8");
    const json = execFileSync(process.execPath, [driver], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const r = JSON.parse(json);
    const rows = r.cliff.map((e) => ({
        ribbons: e.n, "union edges": e.n * 2, built: e.built, refills: e.refills,
        "band byte": e.byte, "covered px": e.covered, ms: f(e.ms, 2),
    }));
    return { rows, base: r.cliff[0].ms, delta: r.cliff[1].ms - r.cliff[0].ms, f75: r.f75, node: r.node };
}

const DRIVER15_SRC = `
// generated by src/engine/raster.bench.probe.js — measurement 15's refill cliff
const core = require(__BUNDLE__);
const TW = core.TW, TH = core.TH;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** One union item of many rings, in §3.3's layout. */
function jobOf(rings) {
    const meta = new Uint32Array(8), attr = new Float64Array(9), rgb = new Uint8Array(3);
    const geom = [], subs = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of rings) {
        subs.push(geom.length / 2);
        for (const p of ring) {
            geom.push(p[0], p[1]);
            if (p[0] < x0) x0 = p[0];
            if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1];
            if (p[1] > y1) y1 = p[1];
        }
    }
    meta[0] = 1; meta[3] = geom.length; meta[5] = rings.length; meta[6] = 4;
    attr[0] = x0; attr[1] = y0; attr[2] = x1; attr[3] = y1; attr[7] = 1;
    rgb[0] = 255; rgb[1] = 255; rgb[2] = 255;
    return {
        Zq: 1, plates: Int32Array.from([0, 0]), paper: Uint8Array.from([0, 0, 0]), nItems: 1,
        meta, attr, rgb, subs: Uint32Array.from(subs), geom: Float64Array.from(geom),
    };
}

function price(rings, probeX) {
    const job = jobOf(rings);
    const out = new Uint8ClampedArray(TW * TH * 4);
    const counts = new Uint32Array(8);
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
    core.renderPlate(job, 0, out, counts);
    const refills = core.coreStats.unionRefills;
    let ms = Infinity;
    for (let r = 0; r < 3; r++) {
        const t = process.hrtime.bigint();
        core.renderPlate(job, 0, out, counts);
        const d = Number(process.hrtime.bigint() - t) / 1e6;
        if (d < ms) ms = d;
    }
    return { ms, refills, byte: out[(200 * TW + probeX) * 4], covered: counts[7] };
}

const cliff = [];
for (const n of [8192, 8193]) {
    const asc = n > 8192;                              // each order is the one ITS walk sorts fastest
    const rings = [];
    for (let k = 0; k < n; k++) { const x = 1 + (asc ? k : n - 1 - k) * 0.0615; rings.push(rect(x, 200.1, x + 0.2, 200.75)); }
    cliff.push(Object.assign({ n, built: asc ? "ascending" : "descending" }, price(rings, 300)));
}
const f75 = [];
for (let i = 0; i < 8500; i++) { const x = 10 + (i % 800) * 0.5; f75.push(rect(x, 200, x + 0.2, 200.75)); }
f75.push(rect(460, 200, 500, 200.75));
process.stdout.write(JSON.stringify({ cliff, f75: price(f75, 470).ms, node: process.version }));
`;

const DRIVER_SRC = `
// generated by src/engine/raster.bench.probe.js — measurement 2's worker sweep
const { Worker, isMainThread, workerData, parentPort } = require("worker_threads");
const core = require(__BUNDLE__);
const ITERS = 40;

function run(kind, iters) {
    core.useAccumPrecision(kind);
    const TW = core.TW, TH = core.TH;
    const out = new Uint8ClampedArray(TW * TH * 4);
    const t0 = Date.now();
    for (let i = 0; i < iters; i++) {
        core.beginFamily(0, TH);
        core.addEdge(-10, -10, -10, TH + 10);
        core.addEdge(-10, TH + 10, TW + 10, TH + 10);
        core.addEdge(TW + 10, TH + 10, TW + 10, -10);
        core.addEdge(TW + 10, -10, -10, -10);
        core.resolveFamily(out, 255, 255, 255, 1, 0, TH);
        core.clearFamily(0, TH);
    }
    return Date.now() - t0;
}

if (!isMainThread) {
    run(workerData.kind, 3);                       // warm
    parentPort.postMessage(run(workerData.kind, workerData.iters));
} else {
    (async () => {
        const res = { iters: ITERS, node: process.version };
        for (const kind of ["f32", "f64"]) {
            for (const n of [1, 2, 4]) {
                const ms = await Promise.all(Array.from({ length: n }, () => new Promise((ok, no) => {
                    const w = new Worker(__filename, { workerData: { kind, iters: ITERS } });
                    w.on("message", (m) => { ok(m); w.terminate(); });
                    w.on("error", no);
                })));
                res[kind + n] = { per: ms.reduce((a, b) => a + b, 0) / ms.length / ITERS, slowest: Math.max(...ms) };
            }
        }
        process.stdout.write(JSON.stringify(res));
    })();
}
`;
