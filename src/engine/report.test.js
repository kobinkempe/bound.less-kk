/**
 * report.test.js — the dev report's assembly and its extract (OPEN-FLAGS F58, `report.js`).
 * The yields are microtasks here, so no bake timer runs mid-build and the document the extract
 * reads is the one the test compares against.
 */
import KobinEngine from "./KobinEngine";
import { buildReport, buildExtract, drawingPlan, drawingChunk, extractToSnapshot, loadReport, numbersOf } from "./report";
import { normalizeLoops, shapeFromRings, rectLoop } from "./geometry/arcShape";
import { mkEngine, useEngines, drawStroke, eraseGesture, drag, descend, picture, rasterZ } from "./__testkit__/harness";
import { engineFromReport } from "./__testkit__/reportReplay";
import { LongFrames } from "./instruments";

useEngines();
const micro = () => Promise.resolve();
const build = (E, opts = {}) => buildReport(E, { yieldFn: micro, ...opts });

function ngon(cx, cy, r, n) {
    const ring = [];
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return normalizeLoops(shapeFromRings([ring]));
}
function addShape(E, frame, loops, extra = {}) {
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops, color: "#123", opacity: 1, w: 8, ...extra };
    E.doc.add(o, frame);
    return o;
}
/** A small drawing over two levels with a moved object and a pending eraser mark. */
function smallDrawing() {
    const E = mkEngine();
    drawStroke(E, [[100, 100], [200, 160], [300, 120]]);
    drawStroke(E, [[420, 300], [520, 380], [600, 330]], 20, "#c00");
    drawStroke(E, [[150, 400], [260, 450]], 9, "#0a0");
    drag(E, [200, 160], [240, 190]);
    descend(E, 1);
    drawStroke(E, [[380, 280], [420, 320], [460, 300]], 6, "#00c");
    E.setTool("pen");
    eraseGesture(E, [[410, 290], [430, 310]], 12);
    E._render();
    return E;
}

describe("RB — the report's assembly", () => {
    test("RB-1 every section is there, none threw, and the headline leads", async () => {
        const E = smallDrawing();
        const rep = await build(E, { why: "test", save: { failCount: 0, lastOkAt: 1 }, cloud: { signedIn: false }, errors: [{ t: 1, msg: "x" }], console: [] });
        for (const k of ["meta", "camera", "counts", "instruments", "memory", "moves", "erase", "scenes", "save", "cloud", "errors", "history", "extract", "families", "build", "headline"]) {
            expect([k, rep[k] !== undefined]).toEqual([k, true]);
        }
        expect(Object.keys(rep).slice(0, 3)).toEqual(["v", "kind", "headline"]);
        expect(rep.build.errors).toEqual({});
        expect(rep.counts.natives).toBe(Object.values(E.nativesByLevel).reduce((n, a) => n + a.length, 0));
        expect(rep.erase.pending).toBe(1);
        expect(rep.camera.path[0].id).toBe(E.cam.frame);
        expect(rep.history.journal.length).toBeGreaterThan(0);
        expect(rep.history.undo.length).toBe(E.doc._undo.length);
        expect(rep.moves.recent.length).toBeGreaterThan(0);
        expect(rep.headline.natives).toBe(rep.counts.natives);
        expect(rep.build.longestTask.name).toBeTruthy();
        JSON.parse(JSON.stringify(rep));   // serialisable
    });

    test("RB-2 bounded: 300 visible 200-gons, 3.5 MB of JSON, a 400 KB cap — the cap holds, the largest go first, the estimate is not an undercount", async () => {
        const E = mkEngine();
        const radii = [];
        for (let i = 0; i < 300; i++) {
            const r = 5 + ((i * 37) % 56);
            radii.push(r);
            addShape(E, "0", ngon(40 + ((i * 53) % 720), 40 + ((i * 71) % 520), r, 200));
        }
        E._render();
        const ex = await buildExtract(E, { maxBytes: 400 << 10, scoreSlice: 64, encodeSlice: 16 << 10 });
        const bytes = JSON.stringify(ex.frames).length;
        expect(bytes).toBeLessThanOrEqual(400 << 10);
        expect(bytes).toBeGreaterThan(200 << 10);
        expect(ex.stats.estBytes).toBeGreaterThanOrEqual(bytes);
        expect(ex.stats.visible).toBe(300);
        expect(ex.stats.dropped).toBeGreaterThan(200);
        expect(ex.stats.visibleDropped).toBe(ex.stats.dropped);
        // The ten largest on screen are in.
        const ids = new Set(ex.frames["0"].objects.map((h) => h.id));
        const bySize = E.doc.list("0").map((o, i) => [o.id, radii[i]]).sort((a, b) => b[1] - a[1]);
        for (const [id] of bySize.slice(0, 10)) expect(ids.has(id)).toBe(true);
    });

    test("RB-3 the extract round-trips: loaded into a second engine, the picture at the camera is the same bits", async () => {
        const E = smallDrawing();
        const rep = JSON.parse(JSON.stringify(await build(E, { extract: { scoreSlice: 2, encodeSlice: 2000 } })));
        expect(rep.extract.stats.visibleDropped).toBe(0);
        expect(rep.build.byTask.filter((t) => t[0] === "extract.encode").length).toBeGreaterThan(2);
        const E2 = engineFromReport(rep);
        expect(E2.cam.state()).toEqual(E.cam.state());
        expect(picture(E2)).toBe(picture(E));
        expect(rasterZ(E2)).toBe(rasterZ(E));
        expect(E2.doc.offsetIds().size).toBe(E.doc.offsetIds().size);
    });

    test("RB-4 the build only reads: no document event, the lattice and a pending frame shift untouched", async () => {
        const E = smallDrawing();
        E.lm.ensureSpine(2); E.lm.cellChild("1", 3, 0);
        const off = addShape(E, "1/3,0", rectLoop({ left: 0, top: 0, right: 40, bottom: 40 }));
        E.doc.setFrameShift("1/3,0", [64, 0]);
        let events = 0;
        const un = E.doc.subscribe(() => { events++; });
        const lat = JSON.stringify(E.lm.serialize()), rev = E.doc.rev;
        const rep = await build(E, { extract: { zoomOut: 1e9, minPx: 0 } });
        un();
        expect(events).toBe(0);
        expect(E.doc.rev).toBe(rev);
        expect(JSON.stringify(E.lm.serialize())).toBe(lat);
        expect(E.lm.frame("1/3,0").shift).toEqual([64, 0]);
        expect(rep.moves.shifts.map((s) => s.id)).toContain("1/3,0");
        expect(rep.extract.frames["1/3,0"].objects.map((h) => h.id)).toContain(off.id);
    });

    test("RB-5 a moved native is judged where its picture is, not where its bits are", async () => {
        const E = mkEngine();
        drawStroke(E, [[380, 290], [420, 310]]);
        descend(E, 1);
        const F = E.cam.frame, f = E.lm.frame(F);
        const v = E.cam.frameWindow(0), hw = (v.right - v.left) / 2, cx = (v.left + v.right) / 2, cy = (v.top + v.bottom) / 2;
        // Three cells right of the camera's frame: no ring, no tile window; its table moves the picture back 60,000.
        const S = E.lm.cellChild(f.parent, f.cell.i + 3, f.cell.j).id;
        const t = E.lm.mapPointF([0, 0], S, F);
        const far = addShape(E, S, rectLoop({ left: 0, top: cy - t[1] - 500, right: 1000, bottom: cy - t[1] + 500 }));
        E.doc.setOffsetsById(far.id, [[-60000, 0]]);
        E._render();
        expect(E._lastList.some((o) => o.id === far.id)).toBe(false);
        const zOf = (x0, x1) => Math.max(1, Math.abs(Math.min(Math.max(cx, x0), x1) - cx) / hw);
        const zStored = zOf(t[0], t[0] + 1000), zPicture = zOf(t[0] - 60000, t[0] - 59000);
        expect(zPicture).toBeLessThan(zStored);
        const ex = await buildExtract(E, { zoomOut: (zPicture + zStored) / 2, minPx: 0 });
        expect((ex.frames[S] || { objects: [] }).objects.map((h) => h.id)).toEqual([far.id]);
    });

    test("RB-6 a section that throws is named and the rest of the report stands", async () => {
        const E = smallDrawing();
        E.fastStats = () => { throw new Error("boom"); };
        const rep = await build(E);
        expect(rep.build.errors["instruments.fast"]).toBe("boom");
        expect(rep.instruments.frameMeter).toBeTruthy();
        expect(rep.extract.stats.chosen).toBeGreaterThan(0);
    });

    test("RB-7 a raster engine's report carries paper, plates, the renderer's counters and the ring", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
        try {
            drawStroke(E, [[100, 100], [300, 200]]);
            const rep = await build(E);
            expect(rep.meta.renderer).toBe("raster");
            expect(rep.raster.perf.v).toBe(1);
            expect(rep.raster.perf.picture).toBeTruthy();
            expect(rep.raster.perf.plates).toBeTruthy();
            expect(typeof rep.raster.renderer.frames).toBe("number");
            expect(typeof rep.raster.layer.uncoveredCells).toBe("number");
            expect(rep.raster.plane).toBeTruthy();
            expect(rep.headline.paper).toBeTruthy();
            expect(rep.build.errors).toEqual({});
            expect(JSON.stringify(rep)).toContain("\"reportBytes\":null");   // the hole the sender fills
        } finally { E.destroy(); }
    });

    test("RB-8 the whole drawing in parts: every native once, each part under its cap, and it loads back whole", async () => {
        const E = smallDrawing();
        for (let i = 0; i < 40; i++) addShape(E, "0", ngon(50 + i * 15, 500, 6, 60));
        const cap = 8 << 10;
        const plan = drawingPlan(E, cap);
        expect(plan.length).toBeGreaterThan(4);
        const seen = [];
        for (const p of plan) {
            if (p.objs.length > 1) expect(p.numbers * 8).toBeLessThanOrEqual(cap);
            for (const o of p.objs) seen.push(o.id);
            expect(p.numbers).toBe(p.objs.reduce((n, o) => n + numbersOf(o), 0));
        }
        const all = Object.values(E.nativesByLevel).flat().map((o) => o.id);
        expect(seen.sort((a, b) => a - b)).toEqual(all.sort((a, b) => a - b));
        const parts = plan.map((p, i) => drawingChunk(p, i));
        const snap = extractToSnapshot({ camera: E.cam.state(), crossings: E.lm.serialize() }, parts);
        const E2 = mkEngine();
        E2.loadSnapshot(snap);
        expect(JSON.stringify(E2.doc.serializeNatives())).toBe(JSON.stringify(E.doc.serializeNatives()));
    });

    test("RB-10 a native in the render list's tile window, off screen, outranks a larger one further out", async () => {
        const E = mkEngine();
        drawStroke(E, [[380, 290], [420, 310]]);
        descend(E, 1);
        const F = E.cam.frame, v = E.cam.frameWindow(0), hw = (v.right - v.left) / 2;
        const cx = (v.left + v.right) / 2, cy = (v.top + v.bottom) / 2;
        // In the camera's own frame, two view-widths right of the centre: listed, off screen, small.
        const near = addShape(E, F, rectLoop({ left: cx + 4 * hw, top: cy, right: cx + 4 * hw + hw / 50, bottom: cy + hw / 50 }));
        // In the root, 40 root units right of the centre (a tile and more away), 8 units wide: larger on screen.
        const c0 = E.lm.mapPointF([cx, cy], F, "0");
        const far = addShape(E, "0", rectLoop({ left: c0[0] + 40, top: c0[1], right: c0[0] + 48, bottom: c0[1] + 8 }));
        E._render();
        expect(E._lastList.some((o) => o.id === near.id)).toBe(true);
        expect(E._lastList.some((o) => o.id === far.id)).toBe(false);
        const ex = await buildExtract(E, { zoomOut: 1e6, minPx: 0, maxBytes: 600 });
        const ids = Object.values(ex.frames).flatMap((f) => f.objects.map((h) => h.id));
        expect(ids).toContain(near.id);
        expect(ids).not.toContain(far.id);
        expect(ex.stats.listedIncluded).toBeGreaterThanOrEqual(1);
    });

    test("RB-11 the long-frame instrument keeps the most recent frames beside the worst", () => {
        const lf = new LongFrames();
        for (let i = 0; i < 30; i++) lf._take({ startTime: i * 100, duration: i === 3 ? 900 : 60 + i, renderStart: 0, styleAndLayoutStart: 0, scripts: [] });
        const r = lf.report();
        expect(r.worst[0].ms).toBe(900);
        expect(r.recent.length).toBe(25);
        expect(r.recent[24].ms).toBe(89);
        expect(r.recent.some((x) => x.ms === 900)).toBe(false);
    });

    test("RB-12 a ceded family in the extract is reported with its members and components", async () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 40);
        descend(E, 1);
        eraseGesture(E, [[380, 300], [420, 300]], 12);
        E.flushErases();
        const multi = [...new Set(E.doc.levels().flatMap((L) => E.doc.list(L).map((o) => E.doc.editKey(o))))].filter((k) => E.doc.editGroup(k).length > 1);
        expect(multi.length).toBeGreaterThan(0);
        const rep = await build(E);
        expect(rep.build.errors).toEqual({});
        const fam = rep.families.find((x) => x.key === multi[0]);
        expect(fam.n).toBe(E.doc.editGroup(multi[0]).length);
        expect(fam.moved).toBe(false);
        expect(fam.components.flat().sort()).toEqual(fam.members.map((m) => m.id).sort());
    });

    test("RB-9 loadReport refuses a v1 report with a reason, and a selection rides the extract even off screen", async () => {
        const E = smallDrawing();
        expect(() => loadReport(E, { v: 1, snapshot: {} })).toThrow(/v1 report/);
        const off = addShape(E, E.cam.frame, rectLoop({ left: 1e5, top: 0, right: 1e5 + 10, bottom: 10 }));
        E._setSelection([off.id]);
        const ex = await buildExtract(E, { zoomOut: 1 });
        expect(ex.stats.selectedIncluded).toBeGreaterThanOrEqual(1);
        expect(ex.frames[E.cam.frame].objects.map((h) => h.id)).toContain(off.id);
    });
});
