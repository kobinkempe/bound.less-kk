/**
 * PI — the report can see the things that were slow.
 *
 * Two stalls reported 2026-08-21, one from a phone and one from a desktop, both
 * felt as seconds of lag. The desktop report covered 62.3 s of session and
 * accounted for 157 ms of work — 0.25% of it. Crossings ran 2.4-4.1 ms, renders
 * never passed 19.6 ms, and the perf log held not one `zoom` entry, because
 * `_perf` drops anything under 8 ms unless forced and `zoomFactorAt` only forces
 * on a crossing. Every measured thing was fast and the slow thing was invisible,
 * so both diagnoses had to be made by reasoning about what was ABSENT.
 *
 * Three holes, closed here:
 *   - zoom and pan steps under the log floor left no trace at all -> aggregated
 *     into a distribution instead (`fastStats`), which cannot flood the log;
 *   - `_bakeTick`, the largest piece of untimed main-thread work in the engine,
 *     was never recorded -> now timed like everything else;
 *   - paint is not reachable from JS at all -> `frameMeter` samples the gap
 *     between animation frames, which includes layout, raster and compositing.
 *
 * These tests pin that the instruments RECORD, and — the part that matters for
 * trusting them — that switching them on does not change what the engine draws.
 */
import { useEngines, mkEngine, drawStroke, descend, eraseGesture, pan } from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

describe("PI-1 — a zoom that never trips the log floor is still counted", () => {
    test("cheap zoom steps show up as a distribution, not as nothing", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        const before = E.perfLog.length;

        for (let i = 0; i < 60; i++) E.zoomAt(400, 300, 6);

        const stats = E.fastStats();
        expect(stats.zoomStep).toBeTruthy();
        expect(stats.zoomStep.n).toBeGreaterThanOrEqual(50);
        // every one of these is far under the 8 ms floor, which is the point:
        // the old instrumentation recorded nothing whatsoever for them.
        expect(E.perfLog.length - before).toBeLessThan(stats.zoomStep.n);
        for (const k of ["meanMs", "maxMs", "medianMs", "p90Ms", "over8", "over16", "over50"]) {
            expect([k, typeof stats.zoomStep[k]]).toEqual([k, "number"]);
        }
    });

    test("panning is counted separately from zooming", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        for (let i = 0; i < 20; i++) pan(E, 3, 2);
        for (let i = 0; i < 20; i++) E.zoomAt(400, 300, 6);
        const s = E.fastStats();
        expect(s.panStep.n).toBeGreaterThanOrEqual(15);
        expect(s.zoomStep.n).toBeGreaterThanOrEqual(15);
    });

    test("the sample window is bounded, so a long session cannot grow without limit", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        for (let i = 0; i < 700; i++) E.zoomAt(400, 300, 2);
        expect(E._zoomStat.zoomStep.recent.length).toBeLessThanOrEqual(200);
        expect(E.fastStats().zoomStep.n).toBeGreaterThan(600);   // the COUNT still totals
    });
});

describe("PI-2 — the erase bake is timed", () => {
    test("a bake tick that does real work lands in the perf log", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40, "#1133cc");
        drawStroke(E, [[150, 340], [650, 340]], 40, "#cc3311");
        descend(E, 2, 400, 300);
        E.setEraserSize(30);
        eraseGesture(E, [[400, 220], [400, 420]]);

        E._lastCamMove = null;
        E._bakeHeldSince = null;
        E.perfLog.length = 0;
        // force the floor down so the assertion does not depend on the machine
        const realPerf = E._perf.bind(E);
        E._perf = (op, t0, always, extra) => realPerf(op, t0, op === "bake" ? true : always, extra);
        for (let i = 0; i < 300 && E._eraseStrokes().length; i++) E._bakeTick();

        const bakes = E.perfLog.filter((e) => e.op === "bake");
        expect(bakes.length).toBeGreaterThan(0);
        expect(typeof bakes[0].ms).toBe("number");
        expect(typeof bakes[0].jobs).toBe("number");
    });
});

describe("PI-3 — the frame meter records what it is given", () => {
    test("samples land in the right buckets and the worst are kept", () => {
        const E = mkEngine();
        const m = E.frameMeter;
        for (const ms of [8, 12, 16, 20, 40, 80, 300, 1200]) m.record(ms);
        const r = m.report();
        expect(r.frames).toBe(8);
        expect(r.hist["<=17"]).toBe(3);          // 8, 12, 16
        expect(r.hist["<=33"]).toBe(1);          // 20
        expect(r.hist[">1000"]).toBe(1);         // 1200
        // anything past the second bucket is worth keeping in full
        expect(r.worst[0].ms).toBe(1200);
        expect(r.worst.every((w) => w.ms > 33)).toBe(true);
        expect(typeof r.worst[0].t).toBe("number");
    });

    test("nonsense samples are ignored rather than poisoning the mean", () => {
        const E = mkEngine();
        const m = E.frameMeter;
        m.record(16); m.record(NaN); m.record(Infinity); m.record(-5);
        expect(m.report().frames).toBe(1);
    });
});

describe("PI-4 — measuring does not change the drawing", () => {
    test("same document with the instruments hot as without", () => {
        const shot = (instrumented) => {
            const E = mkEngine();
            if (!instrumented) {
                E.frameMeter.poke = () => {};
                E._noteFast = () => {};
            }
            drawStroke(E, [[150, 300], [650, 300]], 40, "#1133cc");
            descend(E, 2, 400, 300);
            E.setEraserSize(30);
            eraseGesture(E, [[400, 220], [400, 380]]);
            E._lastCamMove = null;
            for (let i = 0; i < 400 && E._eraseStrokes().length; i++) E._bakeTick();
            for (let i = 0; i < 30; i++) E.zoomAt(400, 300, 8);
            return E.doc.levels().sort().map((k) => [k, E.doc.at(k)
                .map((o) => [o.id, o.type, o.color, Math.round((o.lwFrame || 0) * 1e6)])
                .sort((a, b) => a[0] - b[0])]);
        };
        expect(shot(true)).toEqual(shot(false));
    });
});

describe("PI-5 — long animation frames are captured when the browser offers them", () => {
    test("degrades quietly where the API is absent (jsdom), and reports so", () => {
        const E = mkEngine();
        const r = E.longFrames.report();
        // jsdom has no long-animation-frame; the point is that it says so rather
        // than throwing or pretending it measured something.
        expect(typeof r.supported).toBe("boolean");
        expect(r.count).toBe(0);
        expect(r.worst).toEqual([]);
    });

    test("an entry is split into script / style-and-layout / everything else", () => {
        const E = mkEngine();
        // A frame the browser would describe like this: 900 ms total, rendering
        // begins at 600 ms in, style-and-layout at 700 ms in, one slow script.
        E.longFrames._take({
            startTime: 1000, duration: 900, renderStart: 1600, styleAndLayoutStart: 1700,
            blockingDuration: 850,
            scripts: [
                { duration: 500, forcedStyleAndLayoutDuration: 40, sourceFunctionName: "_render", sourceURL: "http://x/KobinEngine.js", invoker: "FrameRequestCallback" },
                { duration: 60, sourceFunctionName: "tick", sourceURL: "http://x/two.js", invoker: "TimerHandler" },
            ],
        });
        const w = E.longFrames.report().worst[0];
        expect(w.ms).toBe(900);
        expect(w.preRenderMs).toBe(600);      // before rendering began
        expect(w.renderMs).toBe(300);         // renderStart -> end
        expect(w.styleLayoutMs).toBe(200);    // styleAndLayoutStart -> end
        expect(w.paintMs).toBe(100);          // rendering that is NOT style/layout
        expect(w.scriptMs).toBe(560);
        expect(w.scripts[0].fn).toBe("_render");
        expect(w.scripts[0].src).toBe("KobinEngine.js");
    });

    test("only the worst are kept, so a long session cannot grow without bound", () => {
        const E = mkEngine();
        for (let i = 1; i <= 80; i++) {
            E.longFrames._take({ startTime: i * 10, duration: i, renderStart: 0, styleAndLayoutStart: 0, scripts: [] });
        }
        const r = E.longFrames.report();
        expect(r.count).toBe(80);
        expect(r.worst.length).toBeLessThanOrEqual(25);
        expect(r.worst[0].ms).toBe(80);        // the worst really is the worst
    });
});

describe("PI-6 — trace mode is a switch, not a default", () => {
    test("off: cheap operations stay out of the log", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.perfLog.length = 0;
        for (let i = 0; i < 40; i++) E.zoomAt(400, 300, 6);
        expect(E.perfLog.filter((e) => e.op === "zoom").length).toBe(0);
    });

    test("on: every operation is logged, and the log is deeper", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.setTrace(true);
        for (let i = 0; i < 40; i++) E.zoomAt(400, 300, 6);
        const zooms = E.perfLog.filter((e) => e.op === "zoom");
        expect(zooms.length).toBeGreaterThanOrEqual(35);
        expect(zooms.every((e) => typeof e.ms === "number")).toBe(true);
        // and it cannot grow without bound even so
        for (let i = 0; i < 5000; i++) E.zoomAt(400, 300, 1);
        expect(E.perfLog.length).toBeLessThanOrEqual(4000);
    });

    test("turning it back off restores the floor", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.setTrace(true);
        for (let i = 0; i < 10; i++) E.zoomAt(400, 300, 6);
        E.setTrace(false);
        E.perfLog.length = 0;
        for (let i = 0; i < 40; i++) E.zoomAt(400, 300, 6);
        expect(E.perfLog.filter((e) => e.op === "zoom").length).toBe(0);
    });

    test("tracing does not change the drawing", () => {
        const shot = (traced) => {
            const E = mkEngine();
            if (traced) E.setTrace(true);
            drawStroke(E, [[150, 300], [650, 300]], 40, "#1133cc");
            descend(E, 2, 400, 300);
            E.setEraserSize(30);
            eraseGesture(E, [[400, 220], [400, 380]]);
            E._lastCamMove = null;
            for (let i = 0; i < 400 && E._eraseStrokes().length; i++) E._bakeTick();
            return E.doc.levels().sort().map((k) => [k, E.doc.at(k)
                .map((o) => [o.id, o.type, o.color]).sort((a, b) => a[0] - b[0])]);
        };
        expect(shot(true)).toEqual(shot(false));
    });
});

describe("PI-7 — the growth log shows accumulation, which a snapshot cannot", () => {
    test("it samples, rate-limits, and stays bounded", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.growth.samples.length = 0;
        // -Infinity, not 0: the sampler asks how long since the LAST sample, so
        // zero only cleared the 2 s interval while performance.now() happened to
        // be past 2 s already. True when this file runs alone, false when a
        // parallel worker reaches it sooner — the sampler then quietly did
        // nothing and three tests failed on an empty list.
        E.growth._last = -Infinity;
        E.growth.maybeSample();
        expect(E.growth.samples.length).toBe(1);
        E.growth.maybeSample();                    // immediately again: rate-limited
        expect(E.growth.samples.length).toBe(1);
        for (let i = 0; i < 400; i++) { E.growth._last = -Infinity; E.growth.maybeSample(); }
        expect(E.growth.samples.length).toBeLessThanOrEqual(150);
    });

    test("a sample carries every cache that could grow", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.growth._last = -Infinity;
        E.growth.maybeSample();
        const s = E.growth.samples[E.growth.samples.length - 1];
        for (const k of ["t", "frames", "buckets", "objects", "undo", "redo", "groups", "bakeJobs"]) {
            expect([k, s[k] == null]).toEqual([k, false]);
        }
    });

    test("the report states the CHANGE, not just the latest values", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.growth.samples.length = 0;
        E.growth._last = -Infinity; E.growth.maybeSample();
        const before = E.growth.samples[0].objects;
        for (let i = 0; i < 5; i++) drawStroke(E, [[100 + i * 40, 200], [140 + i * 40, 260]], 10);
        E.growth._last = -Infinity; E.growth.maybeSample();
        const r = E.growth.report();
        expect(r.delta.objects).toBe(r.last.objects - before);
        expect(r.delta.objects).toBeGreaterThan(0);
        expect(typeof r.spanS).toBe("number");
    });

    test("sampling does not change the drawing", () => {
        const shot = (sampled) => {
            const E = mkEngine();
            if (!sampled) E.growth.maybeSample = () => {};
            drawStroke(E, [[150, 300], [650, 300]], 40, "#1133cc");
            descend(E, 2, 400, 300);
            E.setEraserSize(30);
            eraseGesture(E, [[400, 220], [400, 380]]);
            E._lastCamMove = null;
            for (let i = 0; i < 400 && E._eraseStrokes().length; i++) E._bakeTick();
            return E.doc.levels().sort().map((k) => [k, E.doc.at(k)
                .map((o) => [o.id, o.type, o.color]).sort((a, b) => a[0] - b[0])]);
        };
        expect(shot(true)).toEqual(shot(false));
    });
});

describe("PI-8 — input-to-pixels is split into wait / handle / present", () => {
    test("the present phase is measured, because nothing else can see it", () => {
        const E = mkEngine();
        // A wheel event as the browser would describe a compositor stall: the
        // handler ran in 5 ms and the pixels arrived 1.1 s later.
        E.eventLatency._take({
            name: "wheel", startTime: 1000, duration: 1120,
            processingStart: 1010, processingEnd: 1015,
        });
        const w = E.eventLatency.report().worst[0];
        expect(w.name).toBe("wheel");
        expect(w.ms).toBe(1120);
        expect(w.waitMs).toBe(10);      // queued before the handler
        expect(w.handleMs).toBe(5);     // our JavaScript
        expect(w.presentMs).toBe(1105); // handler done -> on screen
    });

    test("a genuinely slow handler reads the other way round", () => {
        const E = mkEngine();
        E.eventLatency._take({
            name: "pointermove", startTime: 0, duration: 300,
            processingStart: 2, processingEnd: 290,
        });
        const w = E.eventLatency.report().worst[0];
        expect(w.handleMs).toBe(288);
        expect(w.presentMs).toBe(10);
    });

    test("degrades quietly and stays bounded", () => {
        const E = mkEngine();
        expect(typeof E.eventLatency.report().supported).toBe("boolean");
        for (let i = 1; i <= 60; i++) {
            E.eventLatency._take({ name: "wheel", startTime: i, duration: i, processingStart: i, processingEnd: i });
        }
        const r = E.eventLatency.report();
        expect(r.count).toBe(60);
        expect(r.worst.length).toBeLessThanOrEqual(25);
        expect(r.worst[0].ms).toBe(60);
    });
});
