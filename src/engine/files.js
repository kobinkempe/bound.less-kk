/**
 * Saving and loading.
 *
 * TWO FORMATS, deliberately:
 *   snapshot / loadSnapshot   "dev-0" - the whole engine state, including the
 *                             crossing records. Diagnostics and tests only; it
 *                             is what the report payload carries so a bug can
 *                             be reopened exactly as it was seen.
 *   serializeDrawing / loadDrawing   "kobin-1" (`persist.js`) - the real save
 *                             format, which is what the app writes to local
 *                             storage and to the cloud.
 *
 * Mixed into `KobinEngine.prototype` - see `mixin.js`. Split out of
 * `KobinEngine.js` on 2026-08-31.
 */
import { decodeDrawing, encodeDrawing } from "./persist";

class Files {

    // ---- snapshot (dev-0) — DEV + TESTS ONLY ----
    // NOT the save format; `serializeDrawing`/`loadDrawing` (kobin-1, persist.js)
    // is. This shape is what the Report button ships and what the recorded
    // `.kobin-reports` fixtures are, and `decodeDrawing` still accepts it through
    // its legacy branch — which is what makes every captured report a loadable
    // drawing (see OPEN-FLAGS F35).
    snapshot() {
        return { v: "dev-0", camera: this.cam.state(), natives: this.doc.serializeNatives(), crossings: this.lm.serialize() };
    }
    // Every frame the natives name exists (F67): the autosave of 2026-09-08 wrote kids
    // under a frame only the worker's lattice copy had minted.
    _mintNamedFrames(natives) { for (const k of Object.keys(natives || {})) this.lm.ensureId(k); }
    loadSnapshot(snap) {
        if (!snap || !snap.natives) return false;
        this.lm.load(snap.crossings || {});
        this._mintNamedFrames(snap.natives);
        this._bakeJobs = []; this._bakeQueued.clear();
        this.doc.loadNatives(snap.natives); // reset event clears the tile cache
        this.cam.set(snap.camera || { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 });
        this.cam.settle();                  // a file may record an illegal zoom
        this.renderer.clear();
        this._render();
        this._scheduleBake(0);   // resolve any stroke the file carried unbaked
        this._queueIdleFits();
        return true;
    }

    // ---- drawing files (the real save format — persist.js, kobin-1) ----
    // serializeDrawing() -> a validated, versioned JSON document; meta.name /
    // createdAt persist on the engine across saves. loadDrawing() accepts a
    // kobin-1 file OR a legacy dev-0 snapshot and THROWS a readable Error on
    // anything malformed (callers surface it; nothing is half-loaded because
    // decode fully validates before any state is touched).
    //
    // `frames`: null for the whole drawing (a file, the cloud, an explicit
    // Save); a list of frame ids for the autosave's incremental write, which
    // stores the envelope and only the frames that changed; [] for the
    // envelope alone. The document is the same shape in every case, so
    // nothing downstream has to know which it got.
    serializeDrawing(meta = {}, { frames = null } = {}) {
        const doc = encodeDrawing({
            camera: this.cam.state(), crossings: this.lm.serialize(),
            natives: this.doc.serializeNatives(frames),
            meta: { ...this.docMeta, ...meta },
        });
        this.docMeta = {
            name: doc.meta.name,
            createdAt: doc.meta.createdAt,
            scaleDef: doc.meta.scaleDef ?? null,
            scenes: doc.meta.scenes ?? [],
            hiddenScenes: doc.meta.hiddenScenes ?? [],
            sceneSeq: doc.meta.sceneSeq ?? 1,
        };
        return doc;
    }
    loadDrawing(raw) {
        const d = decodeDrawing(raw); // throws before any engine state changes
        this.lm.load(d.crossings);
        this._mintNamedFrames(d.natives);
        this._bakeJobs = []; this._bakeQueued.clear();
        this.doc.loadNatives(d.natives); // reset event clears tiles + selection
        this.cam.set(d.camera);
        this.cam.settle();                  // a file may record an illegal zoom
        this._eraseCommits.clear();
        this._bakeDone.clear();
        this._cutInflight = null;   // a worker result for the old document is dropped on arrival
        this._scheduleBake(); // resume baking any eraser strokes the file carried
        this.docMeta = {
            name: d.meta.name,
            createdAt: d.meta.createdAt,
            scaleDef: d.meta.scaleDef ?? null,
            scenes: d.meta.scenes ?? [],
            hiddenScenes: d.meta.hiddenScenes ?? [],
            sceneSeq: d.meta.sceneSeq ?? 1,
        };
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }
}

export const files = Files.prototype;
