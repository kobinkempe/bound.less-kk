/**
 * picture.bench.probe.js — §8.6 row 14: what the SETTLE costs (§6.3, D24). Not a test: it
 * prints a table and asserts nothing about time. Its numbers go into §8.6 with the machine
 * they were taken on.
 *
 * Run (the suite skips *.probe.js):
 *   npx react-scripts test --watchAll=false --testMatch "**\/picture.bench.probe.js"
 *
 * **Measured in jsdom, in this process, exactly as §8.6 measurement 4 is** — not in a node
 * child on an esbuild bundle like measurements 2 and 15. The settle is a whole screenful
 * through `packJob` + `renderPlate`, and the only number worth having is the one that can be
 * put beside row 4's for the SAME fixture, the same machine and the same transform; a bundled
 * child runs that loop faster than jest does and the two would not be comparable.
 *
 * **What is NOT measured here, and cannot be**: the blit. The settled plates are handed to
 * `drawImage` by the browser's compositor, and jsdom has no canvas — the compose below is a
 * recording stub, so what it yields is a CALL COUNT and the layer's own bookkeeping, not a
 * painted pixel. The blit is Chrome's, and it is stage 7's (§9.4).
 *
 * The fixture is measurement 4's own dense screen, written by
 * `node tools/extract-fixture.js dense <report.json>`; `.kobin-reports/` is not in git, so
 * without it the probe prints why and passes, as the stage-2 probe does.
 */

import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import { jobBytes } from "./rasterJob";
import { quantumFor, plateRange, PLATE_PX, plateKey } from "./plate";
import PlateStore, { PLATE_BYTES } from "./PlateStore";
import PictureLayer, { pictureStats, resetPictureStats } from "./PictureLayer";
import { mkEngine, useEngines } from "../__testkit__/harness";

const fs = require("fs");
const path = require("path");

const TW = core.TW, TH = core.TH;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const f = (x, n = 2) => (x == null || !isFinite(x) ? "—" : x.toFixed(n));

function table(rows) {
    const keys = Object.keys(rows[0]);
    const w = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
    const line = (cells) => "  " + cells.map((c, i) => String(c).padStart(w[i])).join("  ");
    console.log(line(keys));
    console.log("  " + w.map((n) => "-".repeat(n)).join("  "));
    for (const r of rows) console.log(line(keys.map((k) => r[k])));
}

/** The document of a report, loaded into an engine, and its real render list (row 4's own loader). */
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
    return { E, list: E._buildList(), screen: scr, dpr: scr.dpr || 1, report: j.report };
}

function stripsOf(plates, per) {
    const out = [];
    for (let i = 0; i < plates.length; i += per * 2) out.push(plates.slice(i, i + per * 2));
    return out;
}

/** Every plate of a range, as `packJob` wants them. */
function platesOf(r) {
    const out = [];
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) out.push(i, j);
    return out;
}

/** One screenful rastered at one zoom, through the shipped packer and core. */
function screenful(list, r, q, Zq, dpr, cfg) {
    const plates = platesOf(r);
    const n = plates.length / 2;
    const out = new Uint8ClampedArray(TW * TH * 4);
    const counts = new Uint32Array(8), timings = new Float64Array(7);
    let packMs = 0, drawMs = 0, bytes = 0;
    const ms = [];
    for (const strip of stripsOf(plates, 3)) {
        let t = now();
        const job = pack.packJob(list, { plates: Int32Array.from(strip), q, Zq, dpr, cfg, paper: [255, 255, 255] });
        packMs += now() - t;
        bytes += jobBytes(job);
        for (let p = 0; p * 2 < strip.length; p++) {
            t = now();
            core.renderPlate(job, p, out, counts, timings);
            const d = now() - t;
            drawMs += d; ms.push(d);
        }
    }
    ms.sort((a, b) => a - b);
    return { n, packMs, drawMs, bytes, best: ms[0], mid: ms[ms.length >> 1], worst: ms[ms.length - 1] };
}

/**
 * Zoom to `ns` holding the screen CENTRE — `Camera.zoomFactorAt`'s own arithmetic. Scaling
 * `inScale` alone zooms about the frame ORIGIN, which on this report's camera moves the window
 * off the drawing: 10 items packed of 5,343 and a screenful that rasters in 44 ms.
 */
function zoomTo(cam, w, h, ns) {
    const sx = w / 2, sy = h / 2;
    cam.inPanX = sx - ((sx - cam.inPanX) / cam.inScale) * ns;
    cam.inPanY = sy - ((sy - cam.inPanY) / cam.inScale) * ns;
    cam.inScale = ns;
}

/** A canvas whose context records its calls: jsdom's own `getContext` is null (setupTests.js:27). */
function mkRec(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = { calls: 0, fillStyle: null, imageSmoothingEnabled: false,
        setTransform() {}, fillRect() { ctx.calls++; }, drawImage() { ctx.calls++; } };
    c.getContext = () => ctx;
    c.rec = ctx;
    return c;
}

describe("§8.6 row 14 — the settle and the quantum change, on measurement 4's own dense screen", () => {
    useEngines();

    test("measurement 14: ms for the screenful and per plate, and the layer's own bookkeeping", () => {
        const screen = loadScreen();
        if (!screen) return;
        const { E, list, dpr } = screen;
        const cfg = E.cfg;

        // The control: the same screen at the camera's OWN zoom and quantum, which is §8.6
        // measurement 4's own case — it is what ties this row's milliseconds to that one.
        pack.clearPackCaches(); pack.resetPackStats();
        const own = quantumFor(E.cam.inScale, dpr);
        const control = screenful(list, plateRange(E.cam.frameWindow(0), own.Zq), own.q, own.Zq, dpr, cfg);
        const controlPacked = pack.packStats.packed, controlCulled = pack.packStats.culled;

        // The camera is put at the WORST off-quantum zoom: **at its own quantum first**, then an
        // eighth of an octave up, which is the 9.05 % stretch §6.3 names. Stepping from the
        // camera's raw zoom, as this probe did until the review, lands an eighth of an octave
        // from a zoom already 2 % off its quantum and re-quantises to the NEXT quantum — a 7.0 %
        // stretch one step away, not the stated condition. The quantum is held by `prev`, which
        // is the layer's own hysteresis (§3.2) and what a real gesture does.
        // The pan is moved with the zoom, holding the screen CENTRE, which is
        // `Camera.zoomFactorAt`'s own arithmetic: scaling `inScale` alone zooms about the frame
        // ORIGIN, and on this report's camera that moved the window off the drawing — 10 items
        // packed of 5,343, and a screen that rasters in 44 ms because there is nothing on it.
        // The layer is built and stepped BEFORE the move, so its own hysteresis holds the
        // quantum the gesture holds; one shown only the moved camera re-quantises to the next.
        resetPictureStats();
        const store = new PlateStore({ maxBytes: 256 * PLATE_BYTES, doc: null });
        const layer = new PictureLayer(document.createElement("div"), E.cam, {
            store, makeCanvas: mkRec, width: screen.screen.w, height: screen.screen.h, dpr,
            onPlates: () => {}, setTimer: () => 1, clearTimer: () => {},     // the settle is driven by hand here
        });
        const zoom = (ns) => zoomTo(E.cam, screen.screen.w, screen.screen.h, ns);
        zoom(own.Zq / dpr);                                        // at the quantum, as a gesture starts
        layer.frameFor(E.cam, null);
        zoom((own.Zq / dpr) * Math.pow(2, 1 / 8));                 // and an eighth of an octave up
        const Z = E.cam.inScale * dpr;
        const qf = quantumFor(E.cam.inScale, dpr, own.q);          // the quantum the gesture holds
        const stretch = Z / qf.Zq;
        const win = E.cam.frameWindow(0);
        const rq = plateRange(win, qf.Zq);            // the quantum's plates (the gesture's own)
        const re = plateRange(win, Z);                // the settle's, at the exact zoom

        pack.clearPackCaches(); pack.resetPackStats();
        const settle = screenful(list, re, "e", Z, dpr, cfg);
        const settlePacked = pack.packStats.packed, settleCulled = pack.packStats.culled;
        pack.clearPackCaches(); pack.resetPackStats();
        const quantum = screenful(list, rq, qf.q, qf.Zq, dpr, cfg);
        const quantumPacked = pack.packStats.packed, quantumCulled = pack.packStats.culled;

        // The layer's own work on the same screen: the mapping, the store round trip, the
        // compose's call sequence, and the drop the next camera move owes (D83).
        const v = layer.frameFor(E.cam, null);
        const REP = 200;
        let t = now();
        for (let i = 0; i < REP; i++) { E.cam.inPanX += 1e-9; layer.frameFor(E.cam, null); }
        const frameUs = ((now() - t) / REP) * 1000;

        const hits = [];
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                const key = plateKey(v.frameId, v.q, i, j);
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, G: 0,
                    bitmap: { width: PLATE_PX, height: PLATE_PX, close() {} } });
                hits.push(key);
            }
        }
        t = now();
        for (let i = 0; i < REP; i++) store.want({ frameId: v.frameId, q: v.q, Zq: v.Zq, i0: v.i0, i1: v.i1, j0: v.j0, j1: v.j1 });
        const wantUs = ((now() - t) / REP) * 1000;
        const composed = store.want({ frameId: v.frameId, q: v.q, Zq: v.Zq, i0: v.i0, i1: v.i1, j0: v.j0, j1: v.j1 }).hits;
        layer.compose(composed);
        const callsPerCompose = layer._canvas.rec.calls;
        t = now();
        for (let i = 0; i < REP; i++) layer.compose(composed);
        const composeUs = ((now() - t) / REP) * 1000;

        // the settle's own two store calls
        const req = { frameId: v.frameId, q: "e", Zq: Z, i0: re.i0, i1: re.i1, j0: re.j0, j1: re.j1 };
        for (let j = re.j0; j <= re.j1; j++) {
            for (let i = re.i0; i <= re.i1; i++) {
                store.put({ frameId: v.frameId, q: "e", Zq: Z, i, j, G: 0,
                    bitmap: { width: PLATE_PX, height: PLATE_PX, close() {} } });
            }
        }
        t = now(); store.want(req, { pin: "add" }); const settleWantUs = (now() - t) * 1000;
        t = now(); const dropped = store.dropQuantum("e"); const dropUs = (now() - t) * 1000;

        console.log("\n  §8.6 row 14 — the settle, on " + screen.report + ": " + screen.screen.w + " × "
            + screen.screen.h + " CSS px at dpr " + dpr + ", level " + E.cam.activeLevel + ", inScale "
            + f(E.cam.inScale, 4) + " (its own QUANTUM × 2^(1/8): s = Z/Zq = " + f(stretch, 4)
            + ", the worst stretch §6.3 names), " + list.length + " items");
        const row = (name, r, packed, culled) => ({
            "": name, plates: r.n, "raster ms": f(r.drawMs, 1), "ms a plate": f(r.drawMs / r.n),
            best: f(r.best), median: f(r.mid), worst: f(r.worst),
            "pack ms": f(r.packMs, 1), "MB packed": f(r.bytes / (1 << 20)),
            packed, culled,
        });
        table([
            row("CONTROL: the camera's own zoom, at its quantum Zq = " + f(own.Zq, 4), control, controlPacked, controlCulled),
            row("the gesture: off-quantum, composed at Zq = " + f(qf.Zq, 4), quantum, quantumPacked, quantumCulled),
            row("the SETTLE: the same screen at the exact Zq = Z = " + f(Z, 4), settle, settlePacked, settleCulled),
        ]);
        console.log("  the settle is one COLD screenful: the exact-zoom plates are keyed \"e\" and nothing is"
            + " cached at that key (D24), so its cost is a whole re-raster, not a delta.");
        console.log("  the layer agrees with the row above: mode " + v.mode + ", q " + v.q + ", Zq "
            + f(v.Zq, 4) + ", s " + f(v.s, 4) + " over " + (v.i1 - v.i0 + 1) + " × " + (v.j1 - v.j0 + 1)
            + " plates; the layer canvas is " + (layer._layer ? layer._layer.width + " × " + layer._layer.height
            + " (" + f((layer._layer.width * layer._layer.height * 4) / 1e6, 1) + " MB)" : "not allocated")
            + ", layerOverflow " + pictureStats.layerOverflow);
        console.log("  the layer's own bookkeeping, mean over " + REP + " calls: frameFor " + f(frameUs, 1)
            + " µs, store.want " + f(wantUs, 1) + " µs, compose " + f(composeUs, 1) + " µs ("
            + callsPerCompose + " context calls: 1 fillRect + " + (callsPerCompose - 1) + " drawImage)");
        console.log("  the settle's own store calls: want({pin:\"add\"}) " + f(settleWantUs, 1)
            + " µs, dropQuantum(\"e\") " + f(dropUs, 1) + " µs for " + dropped + " plates");
        console.log("  NOT measured here: the blit. jsdom has no canvas, so the compose above is a recorded"
            + " call sequence; what Chrome's compositor costs for " + settle.n + " drawImages is stage 7's (§9.4).");
        console.log("  pictureStats: composes " + pictureStats.composes + ", blits " + pictureStats.blits
            + ", layerRecomposes " + pictureStats.layerRecomposes + ", paperFills " + pictureStats.paperFills + "\n");
        expect(settle.n).toBeGreaterThan(0);
    }, 600000);

    /**
     * The hold (§6.3, §15.3's checkpoint ruling). What it REPLACES is priced by the test above:
     * the incoming quantum is a cold screenful, so the paper a switch-at-once would show lasts
     * that screenful's raster plus its packing. What the hold ADDS is only what is measured
     * here — the layer's own bookkeeping on the crossing and on the frames composed held.
     */
    test("measurement 14b: the quantum change — what holding the old picture costs", () => {
        const screen = loadScreen();
        if (!screen) return;
        const { E, dpr } = screen;
        const W = screen.screen.w, H = screen.screen.h;
        resetPictureStats();
        const store = new PlateStore({ maxBytes: 256 * PLATE_BYTES, doc: null });
        const asked = [];
        const layer = new PictureLayer(document.createElement("div"), E.cam, {
            store, makeCanvas: mkRec, width: W, height: H, dpr,
            onPlates: (req, misses) => asked.push({ q: req.q, Zq: req.Zq, n: misses.length }),
            setTimer: () => 1, clearTimer: () => {},
        });
        const own = quantumFor(E.cam.inScale, dpr);
        zoomTo(E.cam, W, H, own.Zq / dpr);                         // at a quantum, as a gesture starts
        const v = layer.frameFor(E.cam, null);
        const reqOf = (x) => ({ frameId: x.frameId, q: x.q, Zq: x.Zq, i0: x.i0, i1: x.i1, j0: x.j0, j1: x.j1 });
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, G: 0,
                    bitmap: { width: PLATE_PX, height: PLATE_PX, close() {} } });
            }
        }
        const heldSet = store.want(reqOf(v)).hits.length;
        layer.compose(store.want(reqOf(v)).hits);
        const coveredAtQuantum = layer.report().covered;

        // The crossing: 0.8 of a quantum step, which is past the 0.75 of hysteresis (§3.2).
        const REP = 200;
        zoomTo(E.cam, W, H, (own.Zq / dpr) * Math.pow(2, 0.8 / 4));
        let t = now();
        layer.frameFor(E.cam, null);                               // ONE call: a crossing happens once
        const crossUs = (now() - t) * 1000;
        // The view is ONE object mutated in place (FC2), so every number read off it is read
        // NOW and not at print time.
        const vh = layer.view();
        const held1 = { q: vh.q, s: vh.s, why: layer.report().heldQ };
        const heldHits = store.want(reqOf(vh)).hits;
        held1.plates = heldHits.length;
        t = now();
        for (let i = 0; i < REP; i++) layer.compose(heldHits);
        const heldComposeUs = ((now() - t) / REP) * 1000;
        t = now();
        for (let i = 0; i < REP; i++) store.want(layer.quantumRequest(), { pin: "add" });
        const pendWantUs = ((now() - t) / REP) * 1000;

        // A second crossing before anything arrives: the first request is abandoned, which is
        // `dropQuantum` on plates that are in flight and not cached (their jobs refused).
        const pend = layer.quantumRequest();
        const flight = [];
        for (let j = pend.j0; j <= pend.j1; j++) for (let i = pend.i0; i <= pend.i1; i++) flight.push({ i, j });
        store.beginJob("probe", pend, flight);                     // the renderer's own in-flight map
        zoomTo(E.cam, W, H, (own.Zq / dpr) * Math.pow(2, 1.8 / 4));
        t = now();
        layer.frameFor(E.cam, null);
        const cross2Us = (now() - t) * 1000;
        const vh2 = layer.view();
        const held2 = { q: vh2.q, s: vh2.s, plates: store.want(reqOf(vh2)).hits.length };
        layer.compose(store.want(reqOf(vh2)).hits);
        const heldComposes = pictureStats.heldComposes;

        console.log("\n  §8.6 row 14b — the quantum change on " + screen.report + ": " + W + " × " + H
            + " CSS px at dpr " + dpr + ", level " + E.cam.activeLevel + ", the camera taken 0.8 of a"
            + " quantum step up (past the 0.75 of hysteresis) and then 1.0 more");
        table([{
            "": "held at q " + held1.q + " (crossing 1)", "plates held": held1.plates,
            "s": f(held1.s, 4), "incoming plates": asked.length ? asked[0].n : 0,
            "frameFor µs": f(crossUs, 1), "compose µs": f(heldComposeUs, 1), "want µs": f(pendWantUs, 1),
        }, {
            "": "held at q " + held2.q + " (crossing 2)", "plates held": held2.plates,
            "s": f(held2.s, 4), "incoming plates": asked.length > 1 ? asked[1].n : 0,
            "frameFor µs": f(cross2Us, 1), "compose µs": "—", "want µs": "—",
        }]);
        console.log("  the held set at the quantum was " + heldSet + " plates, covered " + coveredAtQuantum
            + "; every compose on a held view is 1 fillRect + 1 scaled drawImage, and layerOverflow is "
            + pictureStats.layerOverflow + " — the published range is clipped to the held set, so the"
            + " stretched layer can never outgrow the layer canvas (D158).");
        console.log("  the requests that went out, newest quantum only: "
            + asked.map((a) => "q " + a.q + " × " + a.n).join(", ") + "; abandons "
            + pictureStats.quantumAbandons + ", holds " + pictureStats.holds + ", holdSkips "
            + pictureStats.holdSkips + ", heldComposes " + heldComposes + " (" + REP
            + " of them this probe's own repeat loop), holdMaxS " + f(pictureStats.holdMaxS, 4)
            // the three observables of the close-out: nothing arrives on this path, so a switch
            // is never attempted and one caller owns the added set (D187, D188)
            + "; switchRefused " + pictureStats.switchRefusedLow + " low / "
            + pictureStats.switchRefusedHigh + " high, addCallerMismatch "
            + store.report().addCallerMismatch);
        console.log("  the two frameFor readings are ONE call each — a crossing happens once — and the"
            + " first carries the layer's cold path; the compose and want columns are means over "
            + REP + ".");
        console.log("  WHAT IT REPLACES is not measured again here: the incoming quantum is a COLD"
            + " screenful, so without the hold the screen is paper for the raster plus the packing of"
            + " the table above (0.3–0.5 s of raster on one thread on this fixture). What the hold ADDS"
            + " is the bookkeeping in this table and a bilinear stretch of s, which jsdom cannot see"
            + " and stage 7 judges (§9.4).\n");
        expect(pictureStats.holds).toBe(1);
    }, 600000);
});
