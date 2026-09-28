/**
 * Scenes: the index's client, jumping to a scene, and a scene's picture.
 *
 * The scenes themselves are the scene index's (sceneIndex.js, SCENES-PLAN §6/§7): saved in the
 * file and kept current at idle by `sceneClient.js`. Jumping to a scene is a camera move, never a
 * document change.
 *
 * Mixed into `KobinEngine.prototype` - see `mixin.js`.
 */
import { PLATE_PX } from "./raster/plate";
import { SceneClient } from "./sceneClient";

/**
 * The camera that frames `rect` inside a `w × h` viewport: `jumpTo`'s own fit, and
 * `snapshotView`'s. ONE implementation, so a thumbnail frames a scene exactly as jumping to it
 * would and the two can never drift apart.
 *
 * @param {{x:number, y:number, w:number, h:number}} rect in some frame's units
 * @param {number} w viewport width  @param {number} h viewport height (CSS px for `jumpTo`,
 *        DEVICE px for `snapshotView`, where the scale IS the job's `Zq`)
 * @returns {{inScale:number, inPanX:number, inPanY:number}|null} null where the fit is not a
 *        positive finite number
 */
export function fitView(rect, w, h) {
    const s = Math.min(w / rect.w, h / rect.h);
    if (!(s > 0) || !Number.isFinite(s)) return null;
    return {
        inScale: s,
        inPanX: (w - rect.w * s) / 2 - rect.x * s,
        inPanY: (h - rect.h * s) / 2 - rect.y * s,
    };
}

class SceneOps {
    /** The index client (made at construction; `scenes: false` for an engine that never lists scenes). */
    _initScenes(on) { this._sceneClient = on ? new SceneClient(this) : null; }
    // Frame a rect (in `frameKey`'s coords) in the viewport. `frameKey` is a
    // frame id or a legacy depth int; it must exist in the frame tree. The
    // computed inScale may land outside [exit, enter]; _maybeCross normalizes it
    // through the ordinary crossing machinery.
    jumpTo(frameKey, rect) {
        if (!rect || !(rect.w > 0) || !(rect.h > 0)) return false;
        const f = this.lm.frameFor(frameKey);
        if (!f) return false; // unreachable frame / depth
        if (this._drawing) this.pointerUp();
        const fit = fitView(rect, this.width, this.height);
        if (!fit) return false;
        this.cam.set({ frame: f.id, activeLevel: f.depth, ...fit });
        this.cam._maybeCross();
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }
    /**
     * A picture of `rect` in frame `frame`, at a camera that is never set (SCENES-PLAN S1; the
     * crossing prebake of PAPER-PLAN R4 shares the Stage's snapshot underneath, A2 §2.13).
     *
     * The scale is `jumpTo`'s own — `fitView(rect, w, h)` — so a thumbnail frames a scene
     * exactly as jumping to it would. It differs from `jumpTo` in three ways, all deliberate:
     * the camera is not touched, `cam._maybeCross()` is NOT called (a crossing would change the
     * frame the caller asked for), and the plate grid is not moved to the rect — the WORLD is,
     * through `packJob`'s pack-time `offset`, so the rect lands on one plate and one job of one
     * plate answers the whole request.
     *
     * The picture occupies the TOP-LEFT `w × h` device pixels of the returned plate; the caller
     * crops it with a 1:1 `drawImage`.
     *
     * A frame the camera has never visited pays its tile bake inside this call, synchronously,
     * and on a busy frame that is seconds (F59). There is no idle warm-up yet — the caller's
     * own scheduling is what keeps it off a click until one lands.
     *
     * @param {object} req
     * @param {string|number} req.frame a frame id or a legacy depth int
     * @param {{x:number, y:number, w:number, h:number}} req.rect the region, in that frame's units
     * @param {number} [req.w=320] the picture's width in DEVICE px; `w` and `h` are capped at 512
     * @param {number} [req.h=240]
     * @param {AbortSignal} [req.signal] the panel closing; a job already dispatched still
     *        completes, its result is dropped, and the promise rejects with "aborted"
     * @returns {Promise<ImageBitmap|{pixels:Uint8ClampedArray,width:number,height:number}|null>}
     *        null off the raster path, for an unreachable frame or an unfittable rect, and for
     *        an empty plate; the raw record where the scope has no `createImageBitmap` (jsdom)
     */
    snapshotView(req) {
        const { frame, rect, signal } = req || {};
        const w = Math.min(req && req.w > 0 ? req.w : 320, PLATE_PX);
        const h = Math.min(req && req.h > 0 ? req.h : 240, PLATE_PX);
        if (!this.raster || !this.renderer.snapshotJob) return Promise.resolve(null);
        if (!rect || !(rect.w > 0) || !(rect.h > 0)) return Promise.resolve(null);
        const f = this.lm.frameFor(frame);
        if (!f) return Promise.resolve(null);
        const fit = fitView(rect, w, h);
        if (!fit) return Promise.resolve(null);
        // `fitView`'s pans already carry the `− rect.x · s` term, so dividing them by the scale
        // is the whole translation: it puts the rect's top-left at the letterbox margin inside
        // plate (0, 0), which is where `jumpTo` puts it on the screen.
        const Zq = fit.inScale;
        const offset = [fit.inPanX / Zq, fit.inPanY / Zq];
        const win = {
            left: -offset[0], top: -offset[1],
            right: w / Zq - offset[0], bottom: h / Zq - offset[1],
        };
        const snap = this.stage.snapshot(f.id, win, Infinity);
        if (!snap) return Promise.resolve(null);
        return this.renderer.snapshotJob({ list: snap.items(), frameId: f.id, Zq, offset, signal });
    }
    /**
     * The scene list, brought up to date: inline, now (a first index of a loaded drawing included);
     * with the scene worker, the next batch is started and the list as it stands comes back.
     */
    refreshScenes() {
        if (this._sceneClient) this._sceneClient.flushNow();
        return this.docMeta.scenes || [];
    }
    /** A user's name for a scene; it keeps its id and name through merges (SCENES-PLAN §6). */
    renameScene(id, name) {
        if (this._sceneClient) return this._sceneClient.rename(id, name);
        const s = (this.docMeta.scenes || []).find((x) => x.id === id);
        if (!s || !name || !name.trim()) return false;
        s.name = name.trim().slice(0, 120); s.pinned = true; s.auto = false;
        return true;
    }
    /** The index client's account for a report: where it runs, what it has done, what waits. */
    sceneReport() {
        const c = this._sceneClient;
        if (!c) return { on: false };
        return { on: true, mode: c.remote ? "worker" : c.core ? "inline" : "none", dirty: c.dirty.size,
            restoring: !!c.resync, inflight: !!c.inflight, ...c.stats };
    }
    // The effective zoom a scene's frame is viewed at (for "at 240×" labels) — read off the one
    // fit, so the label and the jump can never disagree. A degenerate rect reads 0, not Infinity.
    sceneZoom(s) {
        const fit = fitView(s.rect, this.width, this.height);
        return this.lm.effectiveZoom(s.level, fit ? fit.inScale : 0);
    }
}

export const sceneOps = SceneOps.prototype;
