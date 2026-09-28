/**
 * Input coalescing (A3 §5; PLAN §5.1 Q10, Q11): the page's engine moves the camera at every event and steps
 * the picture once an animation frame — one compose, one status emit and one page `setStatus` for ten wheel
 * events inside a frame, with the camera ten synchronous calls give, to the bit. The scale HUD's own zoom
 * subscription fires once a frame. Every sample of a stroke still reaches the pen; a drag's document write is
 * made once a frame at the last pointer, and a release takes the pending step first, so the drop lands where
 * the synchronous drag lands. An arrival asks the frame for its compose instead of composing.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import useKobinEngine from "./useKobinEngine";
import KobinEngine from "../engine/KobinEngine";
import PictureLayer, { pictureStats } from "../engine/raster/PictureLayer";
import PlateStore from "../engine/raster/PlateStore";
import Camera from "../engine/Camera";
import { PLATE_PX } from "../engine/raster/plate";

/** A requestAnimationFrame the test steps: `run()` takes the callbacks queued so far, once. */
function fakeFrames() {
    const q = new Map();
    let next = 1;
    const was = { raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame };
    window.requestAnimationFrame = (cb) => { q.set(next, cb); return next++; };
    window.cancelAnimationFrame = (id) => { q.delete(id); };
    return {
        run() { const now = [...q.values()]; q.clear(); for (const cb of now) cb(performance.now()); return now.length; },
        restore() { window.requestAnimationFrame = was.raf; window.cancelAnimationFrame = was.caf; },
    };
}

const hosts = [];
function mkEngine(opts) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1024, height: 768, ...opts });
    hosts.push(E);
    return E;
}
afterEach(() => { while (hosts.length) hosts.pop().destroy(); });

const camOf = (E) => { const c = E.cam; return [c.frame, c.inScale, c.inPanX, c.inPanY]; };

describe("the page's engine through the hook", () => {
    let api = null, renders = 0;
    function Harness() {
        renders++;
        api = useKobinEngine({});
        return <div ref={api.hostRef} />;
    }

    test("ten wheel events inside a frame: one compose, one emit, one setStatus, and the camera of ten synchronous zooms", async () => {
        const frames = fakeFrames();
        let view = null;
        try {
            act(() => { view = render(<Harness />); });
            const E = api.engineRef.current;
            expect(E.cfg.frames).toBe("raf");
            let emits = 0;
            const onStatus = E.onStatus;
            E.onStatus = (s) => { emits++; onStatus(s); };
            let zooms = 0;
            E.onZoom(() => { zooms++; });
            await act(async () => { await new Promise((r) => setTimeout(r, 150)); });   // past the status throttle
            emits = 0; zooms = 0;
            const composes0 = pictureStats.composes, renders0 = renders;

            const host = view.container.firstChild;
            act(() => {
                for (let k = 0; k < 10; k++) host.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, clientX: 300, clientY: 200, bubbles: true, cancelable: true }));
            });
            expect(pictureStats.composes - composes0).toBe(0);            // nothing drawn per event
            expect(emits).toBe(0);
            expect(E._fr).not.toBe(null);                                  // one step waits for the frame

            act(() => { frames.run(); });
            expect(pictureStats.composes - composes0).toBe(1);
            expect(emits).toBe(1);
            expect(zooms).toBe(1);
            await act(async () => { await new Promise((r) => setTimeout(r, 150)); });  // any trailing throttle timer
            expect(renders - renders0).toBe(1);                           // one page setStatus

            const S = mkEngine({ raster: true });
            for (let k = 0; k < 10; k++) S.zoomAt(300, 200, 120);
            expect(camOf(E)).toEqual(camOf(S));
            for (let k = 0; k < 4; k++) expect(Object.is(camOf(E)[k], camOf(S)[k])).toBe(true);
            expect(E.cam.inScale).not.toBe(1);
        } finally {
            if (view) act(() => view.unmount());
            frames.restore();
        }
    });
});

describe("the engine with \"raf\" frames and a stepped requestAnimationFrame", () => {
    let frames = null;
    beforeEach(() => { frames = fakeFrames(); });
    afterEach(() => { frames.restore(); });

    test("pans and zooms coalesce into one step with today's camera; flush() takes it now; \"sync\" is the default", () => {
        const R = mkEngine({ frames: "raf" }), S = mkEngine({});
        expect(S.cfg.frames).toBe("sync");
        let emitsR = 0, emitsS = 0;
        R.onStatus = () => { emitsR++; }; S.onStatus = () => { emitsS++; };
        const steps = [(E) => E.panBy(13.25, -7.5), (E) => E.zoomAt(412, 300, -140), (E) => E.pinchUpdate(500, 400, 1.07, 3, 2),
            (E) => E.zoomFactorAt(100, 90, 0.93), (E) => E.panBy(-40, 22.125)];
        for (const f of steps) { f(R); f(S); }
        expect(emitsR).toBe(0);
        expect(emitsS).toBe(steps.length);
        R.flush();
        expect(emitsR).toBe(1);
        expect(R._fr).toBe(null);                                         // flush took the frame
        for (let k = 0; k < 4; k++) expect(Object.is(camOf(R)[k], camOf(S)[k])).toBe(true);
        R.flush();                                                        // nothing pending: nothing happens
        expect(emitsR).toBe(1);
    });

    test("a crossing inside a frame renders once in the new frame", () => {
        const R = mkEngine({ frames: "raf" }), S = mkEngine({});
        let rendersR = 0;
        const render = R._render.bind(R);
        R._render = () => { rendersR++; render(); };
        for (let k = 0; k < 40; k++) { R.zoomAt(512, 384, -250); S.zoomAt(512, 384, -250); }
        expect(R.cam.frame).not.toBe("0");                                // crossed during the burst
        expect(rendersR).toBe(0);
        frames.run();
        expect(rendersR).toBe(1);
        expect(camOf(R)).toEqual(camOf(S));
        expect(R._lastList).toEqual(S._lastList);
    });

    test("every sample reaches the pen, the SVG updates once a frame, and the release takes the pending step", () => {
        const R = mkEngine({ frames: "raf" }), S = mkEngine({});
        let updates = 0;
        const update = R.renderer.update.bind(R.renderer);
        R.renderer.update = () => { updates++; update(); };
        const pts = [[100, 100], [120, 110], [140, 125], [165, 130], [190, 150], [220, 160]];
        for (const E of [R, S]) { E.pointerDown(...pts[0]); for (const p of pts.slice(1)) E.pointerMove(...p); }
        expect(R._drawing.pts.length).toBe(pts.length);
        const u0 = updates;
        frames.run();
        expect(updates - u0).toBe(1);
        R.pointerUp(); S.pointerUp();
        expect(R.doc.serializeNatives()).toEqual(S.doc.serializeNatives());
    });

    test("a drag writes the document once a frame, at the last pointer; the drop lands where the synchronous drag does", () => {
        const drawn = (E) => {
            E.setTool("pen");
            E.pointerDown(200, 200); E.pointerMove(260, 230); E.pointerMove(320, 210); E.pointerUp();
            E.flushBakes();
            E.setTool("select");
            E.pointerDown(260, 230); E.pointerUp();                        // tap-select
            E.flush();
        };
        const R = mkEngine({ frames: "raf" }), S = mkEngine({});
        drawn(R); drawn(S);
        expect(R.selection && R.selection.ids.length).toBe(1);
        let steps = 0;
        const drag = R._dragSelection.bind(R);
        R._dragSelection = (x, y) => { steps++; drag(x, y); };
        const before = JSON.stringify(R.doc.serializeNatives());
        const path = [[262, 231], [270, 236], [285, 244], [301, 250], [322, 263], [340, 270]];
        for (const E of [R, S]) { E.pointerDown(260, 230); for (const p of path) E.pointerMove(...p); }
        const s0 = steps;                                                 // the drag's start step runs at once
        frames.run();
        expect(steps - s0).toBe(1);
        R.pointerMove(345, 272); S.pointerMove(345, 272);
        R.pointerUp(); S.pointerUp();                                     // the pending step first, then the drop
        expect(steps - s0).toBe(2);
        expect(JSON.stringify(R.doc.serializeNatives())).not.toBe(before);   // it moved
        expect(R.doc.serializeNatives()).toEqual(S.doc.serializeNatives());
    });

    test("an arrival asks the frame for its compose; two arrivals in a frame are one compose", () => {
        const R = mkEngine({ frames: "raf", raster: true });
        expect(typeof R.renderer.layer.deferCompose).toBe("function");
        const c0 = pictureStats.composes, a0 = pictureStats.arrivalComposes;
        R.renderer.layer.deferCompose();
        R.renderer.layer.deferCompose();
        expect(pictureStats.composes - c0).toBe(0);
        frames.run();
        expect(pictureStats.composes - c0).toBe(1);
        expect(pictureStats.arrivalComposes - a0).toBe(1);
        expect(mkEngine({ raster: true }).renderer.layer.deferCompose).toBeUndefined();   // "sync" composes on arrival
    });
});

describe("PictureLayer._flush under deferCompose", () => {
    test("a batch that would compose calls deferCompose instead, and composes nothing itself", () => {
        const lm = { width: 1504, height: 812, depthOf: () => 0, frame: () => true, ensureSpine: () => "0" };
        const cam = new Camera(lm, {});
        cam.inScale = 1; cam.inPanX = 0; cam.inPanY = 0;
        const store = new PlateStore({ maxBytes: 64 * PLATE_PX * PLATE_PX * 4, doc: null });
        const layer = new PictureLayer(document.createElement("div"), cam, {
            store, width: 1504, height: 812, dpr: 1, onPlates: () => {}, onRepost: () => {}, now: () => 1000,
            setTimer: () => 0, clearTimer: () => {},
        });
        const v = layer.frameFor(cam, null);
        const misses = store.want({ frameId: v.frameId, q: v.q, Zq: v.Zq, i0: v.i0, i1: v.i1, j0: v.j0, j1: v.j1 }).misses;
        let deferred = 0;
        layer.deferCompose = () => { deferred++; };
        const c0 = pictureStats.composes;
        const bm = () => ({ width: PLATE_PX, height: PLATE_PX, close() {} });
        layer.onPlateBatch(misses.slice(0, 3).map((m) => ({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: m.i, j: m.j, bitmap: bm(), epoch: m.epoch })));
        expect(deferred).toBe(1);
        expect(pictureStats.composes - c0).toBe(0);
        layer.deferCompose = null;
        layer.onPlateBatch(misses.slice(3, 4).map((m) => ({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: m.i, j: m.j, bitmap: bm(), epoch: m.epoch })));
        expect(pictureStats.composes - c0).toBe(1);                       // without it, as before
        layer.destroy();
    });
});
