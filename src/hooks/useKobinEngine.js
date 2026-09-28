import { useEffect, useRef, useState, useCallback } from "react";
import KobinEngine from "../engine/KobinEngine";
import { formatScaleNumber } from "../engine/scaleBar";
import { OpLog } from "../engine/oplog";
import * as rasterPerf from "../engine/raster/rasterPerf";
import { withSvgEngine } from "../storage/thumbnails";
import { encodeObjects, decodeObjects } from "../engine/format2";
import * as reportApi from "../engine/report";
import { macroYield } from "../engine/report";
import { sendDevReport, installConsoleTap, replayReport, scrubIdentity } from "./reportSend";
import { LEVERS, readLevers, saveLevers } from "../engine/devLevers";
import {
    loadCanvasStore, writeCanvas2, backupCanvasDoc, statsFromNatives, cloudPushSource,
    newCanvasId, saveCanvasDoc, upsertIndexEntry, statsFromDoc, getStoreHeader,
} from "../storage/localCanvases";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * LOCAL AUTOSAVE (F33).
 *
 * OFF from 2026-08-26 to 2026-09-02, at Kobin's request, because every save
 * did the whole job on the main thread — serialize, JSON.stringify, lz-string,
 * one localStorage write — and on the phone that was 5-7 s of frozen UI every
 * ten seconds on a 16-million-character drawing, 97% of it inside the
 * compressor. Against a ~5 MB origin cap it also failed silently for eleven
 * minutes once, and the drawing had to be rescued out of the live page.
 *
 * ON again since 2026-09-02, rebuilt: the document lives in IndexedDB, one
 * record per frame (`storage/db.js` says why). A save serializes only the
 * frames that changed — every document event carries its frame id — and hands
 * structured data to an asynchronous write. No stringify, no compression, no
 * quota shared with thumbnails. A pan or zoom with no edit is written once it
 * has settled, so "pick up where you left off" still means the same view.
 *
 * This constant is the kill switch, kept because it was needed once. With it
 * false the Save button (`saveLocal`) and cloud sync still work, and the
 * standing notice below rides `saveError`, which CanvasEditor renders.
 */
export const LOCAL_AUTOSAVE = true;

/**
 * THE RENDERER FLAG (RASTERISER-PLAN §5.1, §5.7). The raster renderer — ink in 512 px plates on
 * a canvas — is the DEFAULT (Kobin, 2026-09-22); `?svg`, in the hash where the router keeps the
 * query or in the search, is the URL gate to the SVG renderer, one keystroke away. `?raster=0`
 * (`false`, `off`) is read the same way, so an old dev URL still works; a bare `?raster` is a
 * no-op. CONSTRUCTION-time: the renderer owns a canvas, a plate cache and a worker pool, so the
 * dev toggle rewrites the parameter and reloads rather than swapping renderers in a live tab.
 */
export function rasterFromUrl(href) {
    const s = String(href || "");
    // Both names are delimited at BOTH ends — `(?=[&#]|$)` — or a longer parameter would read
    // as one of them: `?svgExport=1` or `?rasterWorkers=4` (§6.6, shipped) must decide nothing.
    const svg = /[?&]svg(?:=([^&#]*))?(?=[&#]|$)/.exec(s);
    if (svg && !(svg[1] === "0" || svg[1] === "false" || svg[1] === "off")) return false;
    const r = /[?&]raster(?:=([^&#]*))?(?=[&#]|$)/.exec(s);
    if (r && (r[1] === "0" || r[1] === "false" || r[1] === "off")) return false;
    return true;
}
/** The same URL with the SVG gate set (`on` false) or cleared (`on` true), where the query already lives. */
export function hrefWithRaster(href, on) {
    const s = String(href || "");
    const cut = s.replace(/([?&])(svg|raster)(=[^&#]*)?(&|(?=#)|$)/g, "$1").replace(/([?&])(?=#|$)/g, "");
    if (on) return cut;
    // The hash owns the query when there is a hash route, and it is the tail of the string, so
    // appending at the end lands inside it; with no hash it lands in the search.
    const h = cut.indexOf("#");
    const tail = h >= 0 ? cut.slice(h) : cut;
    return cut + (tail.indexOf("?") >= 0 ? "&" : "?") + "svg";
}
/**
 * The picture pyramid's gate (A3 §7.4): `?pyramid=1` draws the raster path through it, anything else the old
 * plates path, until the comparison is done and that path is deleted. Delimited like `raster`, construction-time.
 */
export function pyramidFromUrl(href) {
    const m = /[?&]pyramid(?:=([^&#]*))?(?=[&#]|$)/.exec(String(href || ""));
    return !!m && (m[1] === undefined || m[1] === "1" || m[1] === "true" || m[1] === "on");
}
/** The same URL with the pyramid's gate set to `on`, where the query already lives. */
export function hrefWithPyramid(href, on) {
    const cut = String(href || "").replace(/([?&])pyramid(=[^&#]*)?(&|(?=#)|$)/g, "$1").replace(/([?&])(?=#|$)/g, "");
    const h = cut.indexOf("#");
    const tail = h >= 0 ? cut.slice(h) : cut;
    return cut + (tail.indexOf("?") >= 0 ? "&" : "?") + "pyramid=" + (on ? "1" : "0");
}

const AUTOSAVE_OFF_NOTICE = {
    off: true, quota: false, at: Date.now(),
    message: "Autosave is off — use Save to keep your work.",
};

// A save waits for a short quiet spell after the last change, but never longer
// than the ceiling from the first unsaved change — a long continuous scribble
// must not defer its own save forever. The slow check is what retries after a
// failure's backoff and what writes a settled camera.
const SAVE_DEBOUNCE_MS = 1500;
const SAVE_MAX_WAIT_MS = 8000;
const SAVE_CHECK_MS = 5000;
// A frame's snapshot is rewritten once the log entries since it pass this many
// bytes, or a quarter of the snapshot, whichever is more (engine/oplog.js).
const SNAPSHOT_MIN_BYTES = 64 * 1024;

const DEFAULT_STATUS = {
    level: 0, inScale: 1, effectiveZoom: 1, nearCross: false, objects: 0,
    canUndo: false, canRedo: false,
    erase: { marks: 0, finishing: false },   // pending marks; a gesture waiting on their cuts (the title's chip)
};

/** The page's status updates at most this often; the scale HUD follows the zoom on its own (`engine.onZoom`). */
const STATUS_THROTTLE_MS = 100;

/** This device's localStorage, or null where the page may not use it (a private window, a sandbox). */
function leverStorage() {
    try { return typeof window !== "undefined" ? window.localStorage : null; } catch (err) { return null; }
}
/** The levers in force on an engine, for the Dev panel. */
const leversOf = (E) => (E ? Object.fromEntries(Object.keys(LEVERS).map((k) => [k, E.cfg[k]])) : null);

/**
 * Shared KobinEngine lifecycle: mount, pointer input, autosave, tool sync.
 * CanvasEditor (the product shell) is its only consumer since CanvasV2, which
 * carried its own copy of all of this, was deleted on 2026-08-31.
 *
 * `canvasId` names the stored document; without one nothing is persisted.
 * `onAutosave({ name, stats })` fires after each successful local autosave —
 * CanvasEditor uses it to mark the canvas cloud-dirty and freshen the gallery
 * index. It carries stats rather than the document because an incremental
 * save never serializes the whole drawing.
 */
// The ctrl cursor: the normal arrow with a badge saying what the click will do.
// Drawn rather than borrowed because no standard cursor keyword means "add to
// selection", and `copy` (the closest) shows a plus that means duplicate.
// #c8603f is the terracotta the selection indicator uses, taken from the design
// file so the badge and the ants are visibly the same colour.
const signCursor = (plus) => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'>"
        + "<path d='M4,2 L4,20 L9,15.5 L12.5,23 L15.5,21.6 L12.2,14.5 L18.5,14.2 Z' "
        + "fill='#fff' stroke='#2b2320' stroke-width='1.4' stroke-linejoin='round'/>"
        + "<circle cx='20' cy='20' r='7' fill='#c8603f' stroke='#fff' stroke-width='1.5'/>"
        + "<path d='" + (plus ? "M20,16.7 L20,23.3 M16.7,20 L23.3,20" : "M16.7,20 L23.3,20")
        + "' stroke='#fff' stroke-width='1.9' stroke-linecap='round'/></svg>";
    return "url(\"data:image/svg+xml," + encodeURIComponent(svg) + "\") 4 2, default";
};
const SIGN_CURSOR = { "+": signCursor(true), "-": signCursor(false) };

export default function useKobinEngine({ canvasId = null, onAutosave, gated = false, onRefused = null } = {}) {
    const hostRef = useRef(null);
    const engineRef = useRef(null);
    const errsRef = useRef([]);
    const onAutosaveRef = useRef(null);
    onAutosaveRef.current = onAutosave;
    const onRefusedRef = useRef(null);
    onRefusedRef.current = onRefused;
    // Deleting a canvas flips this off so the unmount autosave can't quietly
    // recreate the document that was just moved to the recycle bin.
    const persistRef = useRef(true);
    // The autosaver's controls, set up by the mount effect: what an explicit
    // save, an undo, and a meta edit have to tell it.
    const saverRef = useRef(null);
    // SYNC-PLAN R2: false while another tab or device has the pen; the saver writes nothing then.
    // `gated` (the editor) starts closed: the session opens it once it holds the pen.
    const writableRef = useRef(!gated);
    const writerRef = useRef(null);      // the tab's token on every store write (the fence)
    const refusedRef = useRef(false);    // a write was refused: the work is in memory only
    const endGestureRef = useRef(null);
    const lastWriteRef = useRef(null);   // the write in flight, which outlives an unmount
    const [engineReady, setEngineReady] = useState(false);
    const [tool, setTool] = useState("pen");
    const [penType, setPenType] = useState("freehand");
    const [color, setColor] = useState("#000000");
    const [width, setWidth] = useState(12);
    const [opacity, setOpacity] = useState(1);
    const [eraserSize, setEraserSize] = useState(16);
    const [opGroups, setOpGroups] = useState(true);
    const [preBake, setPreBake] = useState(true);
    // ---- DEV PANEL STATE (CanvasEditor renders these only behind ?dev) ----
    const [trace, setTrace] = useState(false);   // dev: log every op (see KobinEngine.setTrace)
    // "+" or "-" while ctrl is held with the select tool, or null. It says what
    // the next ctrl-click will DO, so it has to be answered by hit-testing the
    // point rather than by the modifier alone.
    const [ctrlSign, setCtrlSign] = useState(null);
    const [lazyFat, setLazyFat] = useState(true);
    const [retainScenes, setRetainScenes] = useState(true);
    const [debug, setDebug] = useState(false);        // dev: red path outlines
    const [tiledebug, setTiledebug] = useState(false);// dev: cache-tile rectangles
    const [erasedebug, setErasedebug] = useState(false); // dev: the erase/severance overlay
    const [status, setStatus] = useState(DEFAULT_STATUS);
    const [levers, setLeverState] = useState(null);   // the Dev levers in force (A3 §8)
    const [reportLabel, setReportLabel] = useState("Report");
    // Set when an autosave throws. The work is not being persisted, and that
    // has to be visible somewhere other than the console.
    const [saveError, setSaveError] = useState(LOCAL_AUTOSAVE ? null : AUTOSAVE_OFF_NOTICE);

    const patchDocMeta = useCallback((patch) => {
        const E = engineRef.current;
        if (!E) return;
        E.docMeta = { ...E.docMeta, ...patch };
        if (patch.scaleDef !== undefined) E.setScaleDef(patch.scaleDef);
        // Meta rides the header, which every save writes.
        saverRef.current?.markHeaderDirty();
    }, []);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const w = window.innerWidth, h = window.innerHeight;
        const th = { last: 0, timer: null, latest: null };
        const onStatus = (s) => {
            th.latest = s;
            const now = performance.now();
            const due = STATUS_THROTTLE_MS - (now - th.last);
            if (due <= 0) { th.last = now; setStatus(th.latest); }
            else if (!th.timer) th.timer = setTimeout(() => { th.timer = null; th.last = performance.now(); setStatus(th.latest); }, due);
        };
        // "raf": input steps the picture once an animation frame (A3 §5). The levers: the URL's over this
        // device's stored ones, over the engine's per-device defaults (A3 §8).
        const engine = new KobinEngine(host, {
            width: w, height: h, onStatus, raster: rasterFromUrl(window.location.href), frames: "raf", pyramid: pyramidFromUrl(window.location.href),
            levers: readLevers({ href: window.location.href, storage: leverStorage() }),
        });
        setLeverState(leversOf(engine));
        engineRef.current = engine;
        if (gated) engine.readOnly = true;
        // The raster report's BROWSER bucket is `rafDelta − mainMs` and it has no other producer:
        // the frame meter's own rAF loop is the one this rides, because a second loop would keep
        // a phone's display pipeline awake (RASTERISER-PLAN §8.1, D28, D214). Assigned whatever
        // the renderer is — `onFrame` returns immediately until the ring is allocated, so an
        // SVG-only session pays one property read a frame.
        if (engine.frameMeter) engine.frameMeter.onFrame = rasterPerf.onFrame;
        // The console handle — `window.__kobinEngine.renderer.thinScale = false`
        // and the like — is a dev tool, and until 2026-09-07 every production
        // visitor had it. It is there in a dev build, and in production only
        // behind the same `?dev` that unlocks the panel (the hash router keeps
        // the query in the hash: /#/canvas/:id?dev).
        if (process.env.NODE_ENV !== "production" || /[?&]dev(?:[=&]|$)/.test(window.location.hash + window.location.search)) {
            window.__kobinEngine = engine;
            // The dev report's API, for the console and the second-engine harness (OPEN-FLAGS F58).
            window.__kobinReport = { ...reportApi, send: sendDevReport, replayReport, scrubIdentity };
            installConsoleTap();
        }
        if (!canvasId) persistRef.current = false;

        // ---- LOCAL AUTOSAVE (see the note on LOCAL_AUTOSAVE) ----
        //
        // The kobin-2 store (DESIGN.md §13, engine/oplog.js). The document's op
        // log records what happened as entries carrying results; a tick appends
        // them and rewrites a frame's snapshot only when its entries have
        // outgrown it, or an undo, redo or move touched it (those need the frame
        // whole). State the saver keeps:
        //   docSeq / savedSeq   a change counter and its value at the last
        //                       successful write, so "is there work" is a
        //                       comparison and not a flag a failure can leave
        //                       stuck (the 2026-08-25 hot loop);
        //   hasBase             a record exists on disk; until it does every
        //                       write is a full one;
        //   frameSeq            frame id -> the seq its stored snapshot holds;
        //   logBytes/snapBytes  how far a frame's entries have outgrown it;
        //   markSeq             pending erasers' mark entries, a floor under
        //                       compaction so an interrupted bake can resume;
        //   carried             entries drained but not yet written: a failed
        //                       write keeps them for the next;
        //   lastSavedCam        a pan-or-zoom-only session is still saved once
        //                       it settles, for a canvas already on disk.
        // FAILURE HANDLING. A failed write backs off exponentially (8 s ->
        // 256 s) and is not retried for the same document state until the
        // backoff lapses; a later change retries at once. Nothing is dropped.
        // The failure is shown (`saveError`) and reported (`errors`), because
        // silence was the whole of the original defect.
        let disposed = false;
        let restored = false;
        let hasBase = false;
        let fullDirty = false;
        let docSeq = 0;
        let savedSeq = 0;
        let firstDirtyAt = 0;
        let debounceT = null;
        let saving = false;
        let inflight = null;
        let again = false;
        let lastSavedCam = null;
        let lastSeenCam = null;
        let failCount = 0;
        let skipUntil = 0;
        let failedSeq = -1;
        let lastOkAt = 0, lastFail = null;   // the report's save section
        let frameSeq = {};
        const logBytes = new Map(), snapBytes = new Map(), markSeq = new Map();
        let carried = [];
        let resetPending = false;
        let lastFloor = 0;
        const log = new OpLog(engine);
        const camKey = () => {
            const c = engine.cam.state();
            return `${c.frame}|${c.activeLevel}|${c.inScale}|${c.inPanX}|${c.inPanY}`;
        };
        const isQuota = (err) => !!err && (
            err.name === "QuotaExceededError"
            || err.name === "NS_ERROR_DOM_QUOTA_REACHED"
            || err.code === 22 || err.code === 1014);
        const schedule = () => {
            if (!LOCAL_AUTOSAVE || disposed) return;
            clearTimeout(debounceT);
            const waited = firstDirtyAt ? now() - firstDirtyAt : 0;
            const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS - waited));
            debounceT = setTimeout(() => save("timer"), delay);
        };
        const markDirty = (full) => {
            docSeq += 1;
            if (full) fullDirty = true;
            if (!firstDirtyAt) firstDirtyAt = now();
            schedule();
        };
        const unsubDirty = engine.doc.subscribe((ev) => {
            if (ev.kind === "reset") { if (!ev.load) markDirty(true); return; }   // a load is not a change
            markDirty(false);
        });
        const unsubOps = engine.doc.subscribeOps(() => markDirty(false));   // an op that moved nothing on screen
        // Frames whose entries since their snapshot pass this are snapshotted again.
        const outgrown = (L) => (logBytes.get(L) || 0) > Math.max(SNAPSHOT_MIN_BYTES, (snapBytes.get(L) || 0) / 4);
        const noteEntries = (entries, fs) => {
            for (const e of entries) {
                const bytes = (e.geo ? e.geo.byteLength : 0) + 200;
                for (const L of e.touches || []) if (e.seq > (fs[L] || 0)) logBytes.set(L, (logBytes.get(L) || 0) + bytes);
                if (e.op.k === "mark" && e.op.obj) markSeq.set(e.op.obj.id, e.seq);
                if (e.op.k === "spent") markSeq.delete(e.op.id);
            }
        };
        const save = (why, force = false, opts = {}) => {
            if (!LOCAL_AUTOSAVE || !persistRef.current || !restored || !writableRef.current) return Promise.resolve(false);
            const dirty = docSeq !== savedSeq || log.queue.length > 0 || carried.length > 0;
            const cam = camKey();
            if (!dirty && !opts.full) {
                if (!hasBase || cam === lastSavedCam) return Promise.resolve(false);
                if (!force) {
                    // A view change with no edit: written from the slow check,
                    // and only once it has stopped moving.
                    if (why !== "check") return Promise.resolve(false);
                    if (cam !== lastSeenCam) { lastSeenCam = cam; return Promise.resolve(false); }
                }
            } else if (!force && failedSeq === docSeq && now() < skipUntil) {
                return Promise.resolve(false);
            }
            if (saving) { again = true; return Promise.resolve(false); }
            const t0 = now();
            const d = log.drain();
            // A document replaced whole (a clear, a file load) is a new history: it takes a seq of its
            // own, so every frame is written anew and the cloud sees the head move (SYNC-PLAN).
            const reset = d.full || resetPending;
            resetPending = false;
            if (reset && hasBase) log.seq += 1;
            const full = fullDirty || !hasBase || reset || !!opts.full;
            const resetLog = reset || !hasBase;
            const entries = reset ? [] : carried.concat(d.entries);
            carried = [];
            const takenFull = fullDirty;
            let takenSeq = docSeq;
            fullDirty = false;
            noteEntries(entries, frameSeq);
            const forced = new Set(d.forced);
            // Listed: the frames with a list. An unlisted one is empty as of this write, and replay
            // counts it as holding every entry (F98).
            const holding = () => Object.keys(engine.nativesByLevel);
            const want = new Set(full ? holding() : d.forced);
            for (const L of holding()) if (outgrown(L)) want.add(L);
            const snapshots = {};
            let env, frameIds;
            try {
                // Reading a frame for its snapshot settles a pending shift (DESIGN.md §8): the settle's entry
                // belongs to this write, beside the snapshot that already holds it. A frame listed without a
                // stored snapshot is snapshotted too, so no listed frame's seq predates its content (F98).
                for (let guard = 0; guard < 5; guard++) {
                    for (const L of holding()) if (!(L in frameSeq)) want.add(L);
                    for (const L of want) if (!(L in snapshots) && engine.nativesByLevel[L]) snapshots[L] = { ...encodeObjects(engine.doc.at(L)), seq: log.seq };
                    if (!log.queue.length) break;
                    const d2 = log.drain();
                    noteEntries(d2.entries, frameSeq);
                    entries.push(...d2.entries);
                    for (const L of d2.forced) { forced.add(L); want.add(L); }
                }
                frameIds = holding();
                const listed = new Set(frameIds);
                for (const L of Object.keys(snapshots)) if (!listed.has(L)) delete snapshots[L];
                takenSeq = docSeq;
                env = engine.serializeDrawing({}, { frames: [] });
            } catch (err) {
                console.warn("kobin autosave: serialize failed", err);
                carried = entries; fullDirty = fullDirty || takenFull;
                for (const L of forced) log.forced.add(L);
                return Promise.resolve(false);
            }
            const { natives: none, ...header } = env;
            const stats = statsFromNatives(engine.nativesByLevel);
            const nextFrameSeq = {};
            for (const L of frameIds) nextFrameSeq[L] = L in snapshots ? log.seq : (frameSeq[L] || 0);
            // The compaction floor: nothing under every snapshot, the undo window
            // and every pending mark goes.
            let floor = log.seq + 1;
            for (const L of frameIds) floor = Math.min(floor, nextFrameSeq[L]);
            for (const op of engine.doc._undo) if (op._seq != null) floor = Math.min(floor, op._seq);
            for (const op of engine.doc._redo) if (op._seq != null) floor = Math.min(floor, op._seq);
            for (const sq of markSeq.values()) floor = Math.min(floor, sq);
            const tSer = now();
            // False for a write of the header alone (a camera, a name): a follower need not reload for it.
            const data = full || resetLog || entries.length > 0 || Object.keys(snapshots).length > 0;
            // A failed write keeps its entries AND the frames it had to snapshot (a later tick must snapshot them too).
            const putBack = () => { carried = entries.concat(carried); fullDirty = fullDirty || takenFull; resetPending = resetPending || reset; for (const L of forced) log.forced.add(L); };
            saving = true;
            inflight = writeCanvas2(canvasId, {
                header: { ...header, name: header.meta.name, ...stats, seq: log.seq },
                snapshots, frameIds, entries, full, resetLog, dropBelow: Math.max(0, floor), writer: writerRef.current,
            })
                .then((ok) => {
                    if (ok === null) throw new Error("no local database");
                    if (ok === "fenced" || ok === "stale") {
                        // Another tab holds the store, or it is ahead of this document: nothing more is
                        // written; the work stays in memory for the session to keep (SYNC-PLAN R2).
                        putBack(); writableRef.current = false; refusedRef.current = true;
                        engine.notePerf?.("autosaveRefused", t0, { why, refused: ok });
                        if (!disposed && onRefusedRef.current) onRefusedRef.current(ok);
                        return false;
                    }
                    if (ok === false) {
                        // No base record after all (the store was cleared
                        // under us): the next write is a full one.
                        hasBase = false; putBack(); fullDirty = true; again = true;
                        return false;
                    }
                    hasBase = true;
                    savedSeq = takenSeq;
                    frameSeq = nextFrameSeq;
                    lastFloor = Math.max(0, floor);
                    for (const L of Object.keys(snapshots)) { snapBytes.set(L, snapshots[L].geo.byteLength); logBytes.delete(L); }
                    for (const L of [...logBytes.keys()]) if (!engine.nativesByLevel[L]) logBytes.delete(L);
                    lastSavedCam = cam; lastSeenCam = cam;
                    failCount = 0; skipUntil = 0; failedSeq = -1; lastOkAt = Date.now();
                    if (docSeq === savedSeq && !log.queue.length) firstDirtyAt = 0;
                    engine.notePerf?.("autosave", t0, {
                        ok: 1, why, full: full ? 1 : 0, frames: Object.keys(snapshots).length, entries: entries.length,
                        serMs: +(tSer - t0).toFixed(1), putMs: +(now() - tSer).toFixed(1),
                    });
                    if (!disposed) {
                        setSaveError(null);
                        onAutosaveRef.current?.({ name: header.meta.name, stats, seq: header.seq, data });
                    }
                    return true;
                })
                .catch((err) => {
                    putBack();
                    const quota = isQuota(err);
                    failedSeq = takenSeq;
                    failCount = Math.min(failCount + 1, 6);
                    skipUntil = now() + 4000 * Math.pow(2, failCount);   // 8s -> 256s
                    lastFail = { at: Date.now(), quota, err: String((err && (err.message || err.name)) || err).slice(0, 120) };
                    engine.notePerf?.("autosaveFail", t0, {
                        ok: 0, why, quota: quota ? 1 : 0, full: full ? 1 : 0,
                        err: String((err && err.name) || err).slice(0, 60),
                        serMs: +(tSer - t0).toFixed(1),
                        backoffS: Math.round((skipUntil - now()) / 1000),
                    });
                    // Reports carry `errors`, and a save that never lands is
                    // exactly the kind of thing a report should be showing.
                    errsRef.current.push({ t: Date.now(),
                        msg: "autosave failed" + (quota ? " (storage full)" : "")
                            + ": " + String((err && err.message) || err).slice(0, 120) });
                    if (errsRef.current.length > 50) errsRef.current.shift();
                    if (!disposed) {
                        setSaveError({ quota, at: Date.now(),
                            message: quota
                                ? "Storage is full - changes are not being saved."
                                : "Autosave failed - changes are not being saved." });
                    }
                    console.warn("kobin autosave failed" + (quota ? " (storage full)" : ""), err);
                    return false;
                })
                .then((r) => {
                    saving = false; inflight = null;
                    if (again || docSeq !== savedSeq || log.queue.length || carried.length) {
                        again = false;
                        // Past unmount the timers are gone; write the tail now.
                        // destroy() leaves the document readable, so this is safe.
                        if (disposed) save("dispose", true); else schedule();
                    }
                    return r;
                });
            lastWriteRef.current = inflight;
            return inflight;
        };
        const flush = () => save("flush", true);
        const onHide = () => { if (document.visibilityState === "hidden") flush(); };
        const checkTimer = LOCAL_AUTOSAVE ? setInterval(() => save("check"), SAVE_CHECK_MS) : null;
        // Phones background a tab long before anyone thinks to press Save, and
        // `beforeunload` is the wrong hook for an asynchronous write.
        document.addEventListener("visibilitychange", onHide);
        window.addEventListener("pagehide", flush);

        saverRef.current = {
            markHeaderDirty: () => markDirty(false),
            markAllDirty: () => markDirty(false),
            // The floor the last write compacted the log to; the cloud mirror keeps parity.
            lastFloor: () => lastFloor,
            // Dev: the saver's view, for the console (`__kobinSaver.debug()`).
            debug: () => ({ lastFloor, frameSeq: { ...frameSeq }, logSeq: log.seq, queued: log.queue.length, carried: carried.length,
                undoSeqs: engine.doc._undo.map((o) => o._seq), redoSeqs: engine.doc._redo.map((o) => o._seq), marks: [...markSeq.entries()], hasBase, docSeq, savedSeq }),
            // The dev report's save section: the state above in scalars, and when it last wrote and failed.
            report: () => ({ autosave: LOCAL_AUTOSAVE, persist: persistRef.current, restored, hasBase, saving, dirty: docSeq !== savedSeq,
                docSeq, savedSeq, logSeq: log.seq, queued: log.queue.length, carried: carried.length, lastFloor,
                frames: Object.keys(frameSeq).length, marks: markSeq.size, failCount, backoffMs: Math.max(0, Math.round(skipUntil - now())),
                lastOkAt, lastFail, undoSeqs: engine.doc._undo.slice(-10).map((o) => o._seq) }),
            // An explicit Save: every frame snapshotted, the log kept (it is the
            // undo history). Waits for a write in flight first.
            saveNow: async () => {
                if (inflight) await inflight.catch(() => false);
                return save("explicit", true, { full: true });
            },
            // Everything drawn so far on disk before the pen is handed over (SYNC-PLAN R2): true when clean.
            // With the saver off nothing is owed (a read-only tab's pending bakes are recomputed from the
            // store), unless a write was refused: then the work is in memory only.
            flush: async () => {
                if (!writableRef.current) return !refusedRef.current;
                for (let i = 0; i < 4; i++) {
                    if (inflight) await inflight.catch(() => false);
                    if (docSeq === savedSeq && !log.queue.length && !carried.length && !fullDirty) return true;
                    await save("handover", true);
                }
                return docSeq === savedSeq && !log.queue.length && !carried.length;
            },
            hasUnsaved: () => refusedRef.current || docSeq !== savedSeq || log.queue.length > 0 || carried.length > 0 || fullDirty || resetPending,
            // A file load: a new history, written whole with a seq of its own.
            markReset: () => { resetPending = true; markDirty(true); },
            // The work in memory was kept elsewhere (keepUnsaved): nothing is owed to this store now.
            markKept: () => { log.drain(); carried = []; savedSeq = docSeq; fullDirty = false; resetPending = false; refusedRef.current = false; },
            // The seq of the last entry this document holds, to compare with the store's.
            knownSeq: () => log.seq,
        };

        if (window.__kobinEngine === engine) window.__kobinSaver = saverRef.current;
        // RESTORE. The document comes back asynchronously; `engineReady` waits
        // for it, so nothing in the shell (the cloud pull most of all) compares
        // an empty engine against anything. A canvas still in the v1 store loads
        // the old way and its first save writes it to the kobin-2 store whole.
        // The store into the engine: snapshots through `loadDrawing`, then the log
        // replayed onto them (undo stacks and pending erasers included). Used at
        // mount and after a cloud pull has replaced the store.
        // `camera`: the viewer's own, kept across a reload that follows another tab or device.
        // No render here: the caller renders once, after the replay, a task later (`renderLoaded`;
        // on the Magnum Opus the load and a cold render were one 5-7 s task, STALL 2026-09-23).
        const restoreFrom = (res, camera = null) => {
            if (res.legacy) {
                engine.loadDrawing(camera ? { ...res.legacy, camera } : res.legacy, { render: false });
                engine._eraseLoaded();   // a mark from before `targets` registers, logged once (A2 §4.9)
                hasBase = false; fullDirty = true;
                return true;
            }
            const natives = {};
            for (const [fid, f] of Object.entries(res.frames)) natives[fid] = decodeObjects(f.objects, f.geo);
            const { store, frameIds, frameSeq: storedSeq, seq, id, name, savedAt, base, intent, pending, writer, ...envelope } = res.header;
            engine.loadDrawing({ ...envelope, ...(camera ? { camera } : {}), natives }, { render: false });
            frameSeq = { ...(storedSeq || {}) };
            log.seq = seq || 0;
            logBytes.clear(); snapBytes.clear(); markSeq.clear(); carried = [];
            for (const [fid, f] of Object.entries(res.frames)) snapBytes.set(fid, f.geo.byteLength);
            log.replaying = true;
            try { engine.stage.batch(() => log.replay(res.entries, frameSeq, frameIds)); } finally { log.replaying = false; }   // one commit (PLAN §5.7)
            engine._eraseLoaded();   // after the replay, so a mark from before `targets` registers once and is logged (A2 §4.9)
            noteEntries(res.entries, frameSeq);
            for (const mid of [...markSeq.keys()]) if (!engine.doc.getById(mid)) markSeq.delete(mid);
            engine._scheduleBake();   // a pending eraser resumes where its log left it
            hasBase = true;
            return true;
        };
        const renderLoaded = async () => {
            await macroYield();
            if (!disposed) engine._render();
        };
        const settleAfterLoad = (loaded) => {
            if (loaded && hasBase) {
                // What is in memory is what is on disk: the reset the load
                // emitted is not a change.
                fullDirty = false; savedSeq = docSeq; firstDirtyAt = 0;
                clearTimeout(debounceT);
            }
            lastSavedCam = lastSeenCam = camKey();
            if (docSeq !== savedSeq || fullDirty) schedule();
        };
        const restoreP = canvasId ? loadCanvasStore(canvasId) : Promise.resolve(null);
        restoreP.then(async (res) => {
            if (disposed || !res) return false;
            try { return restoreFrom(res); } catch (err) {
                // The stored copy will not decode. It is copied into the bin before `restored` lets the
                // first autosave write over it (awaited: the copy must not read the overwritten store).
                console.warn("kobin autosave restore failed", err);
                await backupCanvasDoc(canvasId);
                return false;
            }
        }, (err) => { console.warn("kobin autosave restore failed", err); return false; })
        .then(async (loaded) => {
            if (disposed) return;
            await renderLoaded();   // loaded or not: what did load shows, and an empty canvas is cheap
            if (disposed) return;
            restored = true;
            settleAfterLoad(loaded);
            if (loaded) engine.sweepFrames();   // the empty frames the store held: gone with the next write (F94)
            setEngineReady(true);
        });
        // The store, which another tab or a pull wrote, into this engine (SYNC-PLAN R2, R4, R6):
        // this tick's unsaved log is dropped, since what is on disk is the truth. Returns the ms it took.
        saverRef.current.reload = async ({ keepCamera = false } = {}) => {
            if (inflight) await inflight.catch(() => false);
            const t0 = now();
            const res = await loadCanvasStore(canvasId);
            if (!res || disposed) return null;
            const cam = keepCamera ? engine.cam.state() : null;
            log.drain();
            try {
                restoreFrom(res, cam);
                settleAfterLoad(true);
                engine.sweepFrames();
                refusedRef.current = false; resetPending = false;
            } finally { await renderLoaded(); }   // a store that will not replay still shows what loaded
            return now() - t0;
        };
        // A follow for a write that moved no data: the stored name, scale and scene names, without a
        // reload. A scene name goes through renameScene, so this tab's own next save keeps it too.
        saverRef.current.refreshMeta = async () => {
            const h = await getStoreHeader(canvasId);
            if (!h || !h.meta || disposed) return false;
            if (typeof h.meta.name === "string") engine.docMeta = { ...engine.docMeta, name: h.meta.name };
            engine.setScaleDef(h.meta.scaleDef || null);
            const mine = new Map((engine.docMeta.scenes || []).map((s) => [s.id, s]));
            for (const s of Array.isArray(h.meta.scenes) ? h.meta.scenes : []) {
                const m = s && mine.get(s.id);
                if (m && typeof s.name === "string" && s.name && s.name !== m.name) engine.renameScene(s.id, s.name);
            }
            return true;
        };

        const onErr = (e) => {
            errsRef.current.push({ t: Date.now(), msg: String((e && (e.message || e.reason)) || e) });
            if (errsRef.current.length > 50) errsRef.current.shift();
        };
        window.addEventListener("error", onErr);
        window.addEventListener("unhandledrejection", onErr);

        const rel = (e) => {
            const r = host.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        };

        const pointers = new Map();
        let pinch = null;
        let ignoreId = null;
        let downT = 0;
        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        // A second finger within this long of the first is a pinch whose first
        // finger simply landed early: whatever that finger began is undone. The
        // same 400 ms the pen has always used to decide a stroke was really a
        // pinch. Past it, a select drag that has moved things is a deliberate
        // drag and is committed before the pinch starts; a press that has not
        // moved is dropped whatever its age. Kobin's call, 2026-09-03: "use
        // your judgement call and I'll tell you how it feels."
        const PINCH_GRACE_MS = 400;

        const down = (e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const p = rel(e);
            pointers.set(e.pointerId, p);
            if (pointers.size === 1) {
                ignoreId = null;
                downT = Date.now();
                // Ctrl reaches the engine, which has always implemented
                // add/remove on it — `_pointerDown` toggles the object under
                // the pointer, and a ctrl lasso adds (or subtracts, when drawn
                // wholly inside the selection). The flag was simply never
                // passed, so none of that was reachable from the UI.
                engine.pointerDown(p[0], p[1], e.ctrlKey || e.metaKey);
            } else if (pointers.size === 2) {
                if (engine._drawing && Date.now() - engine._drawStartT < PINCH_GRACE_MS) engine.cancelStroke();
                else if (engine.tool === "select") engine.cancelSelectGesture(Date.now() - downT > PINCH_GRACE_MS);
                else engine.pointerUp();
                const [a, b] = [...pointers.values()];
                pinch = { mid: mid(a, b), dist: dist(a, b) };
            }
            if (e.cancelable) e.preventDefault();
        };
        const move = (e) => {
            if (!pointers.has(e.pointerId)) return;
            const p = rel(e);
            pointers.set(e.pointerId, p);
            if (pinch && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const m = mid(a, b), d = dist(a, b);
                const factor = pinch.dist > 0 && d > 0 ? d / pinch.dist : 1;
                engine.pinchUpdate(m[0], m[1], factor, m[0] - pinch.mid[0], m[1] - pinch.mid[1]);
                pinch = { mid: m, dist: d };
            } else if (!pinch && e.pointerId !== ignoreId) {
                engine.pointerMove(p[0], p[1]);
            }
        };
        const up = (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            if (pinch) {
                if (pointers.size < 2) {
                    pinch = null;
                    ignoreId = pointers.size === 1 ? [...pointers.keys()][0] : null;
                }
            } else if (e.pointerId !== ignoreId) {
                engine.pointerUp();
            }
            if (pointers.size === 0) ignoreId = null;
        };
        // A GESTURE CAN END WITHOUT A POINTERUP: the button released over
        // another window after an alt-tab or the Windows key, a touch the OS
        // took over without a pointercancel. Left alone, a mouse stroke stayed
        // open until the next press (which abandoned it — see
        // KobinEngine._pointerDown), and a touch left its id in `pointers`, so
        // every later single finger counted as the SECOND finger of a pinch
        // and drawing was impossible until a reload. Blur and hiding are the
        // moments we learn the pointer is gone: end what was in progress the
        // way a pen-up would (a moved select drag commits, a mere press is
        // dropped) and forget every pointer.
        const resetGesture = () => {
            const busy = pointers.size || engine._drawing || engine._dragSel || engine._lasso || engine._selPress || engine._panLast;
            pointers.clear(); pinch = null; ignoreId = null;
            if (!busy) return;
            if (engine.tool === "select") engine.cancelSelectGesture(true);
            else engine.pointerUp();
        };
        const onBlur = () => resetGesture();
        endGestureRef.current = resetGesture;
        const onVisReset = () => { if (document.visibilityState === "hidden") resetGesture(); };
        const wheel = (e) => { e.preventDefault(); const [x, y] = rel(e); engine.zoomAt(x, y, e.deltaY); };
        let resizeT = null;
        const onResize = () => {
            clearTimeout(resizeT);
            resizeT = setTimeout(() => engine.resize(window.innerWidth, window.innerHeight), 150);
        };
        const gesturePrevent = (e) => e.preventDefault();
        const onKey = (e) => {
            // Typing in a field must not reach the engine. With the select
            // tool active and an object selected, Backspace in the canvas-title
            // or scene-name input deleted the SELECTION instead of a character,
            // and Ctrl+Z undid a stroke instead of the edit.
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (!(e.ctrlKey || e.metaKey)) {
                if ((e.key === "Delete" || e.key === "Backspace") && engine.selection && !engine.readOnly) {
                    e.preventDefault(); engine.deleteSelection();
                }
                return;
            }
            const k = e.key.toLowerCase();
            if (k === "z") { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); markDirty(null, true); }
            else if (k === "y") { e.preventDefault(); engine.redo(); markDirty(null, true); }
        };

        host.addEventListener("pointerdown", down);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        host.addEventListener("wheel", wheel, { passive: false });
        host.addEventListener("gesturestart", gesturePrevent);
        host.addEventListener("gesturechange", gesturePrevent);
        window.addEventListener("resize", onResize);
        window.addEventListener("keydown", onKey);
        window.addEventListener("blur", onBlur);
        document.addEventListener("visibilitychange", onVisReset);
        return () => {
            if (checkTimer) clearInterval(checkTimer);
            clearTimeout(debounceT);
            clearTimeout(resizeT);
            clearTimeout(th.timer);
            unsubDirty(); unsubOps(); log.detach();
            document.removeEventListener("visibilitychange", onHide);
            window.removeEventListener("pagehide", flush);
            if (LOCAL_AUTOSAVE) flush();   // last chance before this engine goes away; the write outlives the component
            disposed = true;
            saverRef.current = null;
            window.removeEventListener("error", onErr);
            window.removeEventListener("unhandledrejection", onErr);
            host.removeEventListener("pointerdown", down);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            host.removeEventListener("wheel", wheel);
            host.removeEventListener("gesturestart", gesturePrevent);
            host.removeEventListener("gesturechange", gesturePrevent);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("blur", onBlur);
            document.removeEventListener("visibilitychange", onVisReset);
            engine.destroy();
            if (window.__kobinEngine === engine) window.__kobinEngine = null;
            setEngineReady(false);
        };
    // `gated` is read once, when the engine is built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasId]);

    useEffect(() => { engineRef.current && engineRef.current.setTool(tool); }, [tool]);
    useEffect(() => { engineRef.current && engineRef.current.setPenType(penType); }, [penType]);
    useEffect(() => { engineRef.current && engineRef.current.setColor(color); }, [color]);
    useEffect(() => { engineRef.current && engineRef.current.setWidth(width); }, [width]);
    useEffect(() => { engineRef.current && engineRef.current.setOpacity(opacity); }, [opacity]);
    useEffect(() => { engineRef.current && engineRef.current.setEraserSize(eraserSize); }, [eraserSize]);
    useEffect(() => { engineRef.current && engineRef.current.setOpacityGroups(opGroups); }, [opGroups]);
    useEffect(() => { engineRef.current && engineRef.current.setPreBake(preBake); }, [preBake]);
    useEffect(() => { engineRef.current && engineRef.current.setTrace(trace); }, [trace]);
    useEffect(() => { engineRef.current && engineRef.current.setLazyOutlines(lazyFat); }, [lazyFat]);
    useEffect(() => { engineRef.current && engineRef.current.setRetainScenes(retainScenes); }, [retainScenes]);
    useEffect(() => { engineRef.current && engineRef.current.setDebug(debug); }, [debug]);
    useEffect(() => { engineRef.current && engineRef.current.setTileDebug(tiledebug); }, [tiledebug]);
    useEffect(() => { engineRef.current && engineRef.current.setEraseDebug(erasedebug); }, [erasedebug]);

    const pickPen = (type) => { setPenType(type); setTool("pen"); };
    const E = () => engineRef.current;
    // The Dev levers (A3 §8): a change goes into the engine and is stored for this device, never in the
    // canvas record; a URL override still wins at the next load.
    const leverSetter = (apply, patchOf) => (v) => {
        const eng = E();
        if (!eng) return;
        apply(eng, v);
        saveLevers(patchOf(v), leverStorage());
        setLeverState(leversOf(eng));
    };

    // DEV: the Report button (?dev panel). `hooks/reportSend.js` builds it from
    // `engine/report.js` (instruments, history, the drawing on and around the
    // screen), gzips it and POSTs it in parts to tools/report-server.js on :3001;
    // `drawing: true` sends the whole drawing after it. OPEN-FLAGS F58.
    const sendReport = async (opts) => {
        const eng = E();
        if (!eng) return null;
        const o = opts && typeof opts === "object" && !opts.nativeEvent ? opts : {};
        setReportLabel("…");
        const r = await sendDevReport(eng, {
            why: o.drawing ? "button+drawing" : "button",
            ...o,
            errors: errsRef.current.slice(),
            save: saverRef.current && saverRef.current.report ? saverRef.current.report() : null,
            onStage: setReportLabel,
        });
        if (window.__kobinEngine === eng) window.__kobinLastReport = r;
        const mb = (b) => (b / 1048576).toFixed(1) + " MB";
        const drawn = r.drawing ? (r.drawing.ok ? ` + ${r.drawing.parts} parts` : " (drawing failed)") : "";
        setReportLabel(r.ok ? `Sent ✓ ${mb(r.gzBytes)}${drawn}` : `Failed${r.saved ? " — saved as a file" : ""}`);
        if (!r.ok || (r.drawing && !r.drawing.ok)) console.warn("kobin report:", r.why || (r.drawing && r.drawing.why), r);
        setTimeout(() => setReportLabel("Report"), r.ok ? 4000 : 10000);
        return r;
    };

    // An explicit save: the whole document, written in full. Returns the
    // serialized document (the caller lists it and pushes it to the cloud),
    // or null when nothing could be stored.
    const saveLocal = async (name) => {
        const eng = E();
        if (!eng || !persistRef.current || !canvasId) return null;
        if (name) patchDocMeta({ name });
        try {
            const ok = saverRef.current ? await saverRef.current.saveNow() : false;
            if (!ok) return null;
            return eng.serializeDrawing();
        } catch (err) {
            return null;
        }
    };

    const saveDrawing = (name) => {
        const eng = E();
        if (!eng) return;
        const doc = eng.serializeDrawing({ name });
        const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (doc.meta.name || "untitled") + ".boundless.json";
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const loadDrawingFile = async (file) => {
        const eng = E();
        if (!eng || !file) return;
        if (eng.readOnly) throw new Error("another tab or device has the pen");
        const raw = JSON.parse(await file.text());
        eng.loadDrawing(raw);
        if (saverRef.current && saverRef.current.markReset) saverRef.current.markReset();
        await saveLocal();
    };

    const exportSvg = async () => {
        const eng = E();
        if (!eng) return;
        // §5.7: in raster mode the ink is on the canvas and this host's `<svg>` holds only the
        // live stroke and the selection, so it is serialised from a ONE-OFF SVG engine at the
        // same document and camera (`withSvgEngine`, the thumbnails' own helper) — seconds on a
        // big drawing, once, on a click. Fork 4's export from the render list replaces this.
        const svg = eng.raster
            ? await withSvgEngine(eng.serializeDrawing(), eng.width, eng.height, (svgEngine, host) => host.querySelector("svg"))
            : hostRef.current?.querySelector("svg");
        if (!svg) return;
        const clone = svg.cloneNode(true);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", "#ffffff");
        clone.insertBefore(bg, clone.firstChild);
        const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "boundless.svg";
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // Ctrl's meaning, shown on the cursor. Only wired while the select tool is
    // active: the modifier does nothing for the other tools, and hit-testing on
    // every pointer move for a cursor nobody will see is pure cost.
    useEffect(() => {
        if (tool !== "select") { setCtrlSign(null); return undefined; }
        const host = hostRef.current;
        if (!host) return undefined;
        let pt = null;
        const signAt = () => {
            const E = engineRef.current;
            if (!E || !pt) return "+";
            const id = E.hitTestAt(pt[0], pt[1]);
            const sel = E.selection;
            return id != null && sel && sel.ids.indexOf(id) >= 0 ? "-" : "+";
        };
        const onMove = (e) => {
            const r = host.getBoundingClientRect();
            pt = [e.clientX - r.left, e.clientY - r.top];
            setCtrlSign((e.ctrlKey || e.metaKey) ? signAt() : null);
        };
        const onDown = (e) => { if (e.ctrlKey || e.metaKey) setCtrlSign(signAt()); };
        const onUp = (e) => { if (!(e.ctrlKey || e.metaKey)) setCtrlSign(null); };
        // Blur matters: alt-tabbing away with ctrl down never delivers the
        // keyup, and the cursor would stay wrong until the next press.
        const clear = () => setCtrlSign(null);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("keydown", onDown);
        window.addEventListener("keyup", onUp);
        window.addEventListener("blur", clear);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("keydown", onDown);
            window.removeEventListener("keyup", onUp);
            window.removeEventListener("blur", clear);
        };
    }, [tool, hostRef, engineRef]);

    const cursor = tool === "pan" ? "grab"
        : (tool === "erase" || tool === "erasePartial") ? "cell"
        : tool === "select" ? (ctrlSign ? SIGN_CURSOR[ctrlSign] : "default")
        : "crosshair";

    return {
        hostRef,
        engineRef,
        engineReady,
        tool, setTool,
        penType, setPenType,
        color, setColor,
        width, setWidth,
        opacity, setOpacity,
        eraserSize, setEraserSize,
        opGroups, setOpGroups,
        preBake, setPreBake,
        trace, setTrace,
        lazyFat, setLazyFat,
        retainScenes, setRetainScenes,
        debug, setDebug,
        tiledebug, setTiledebug,
        erasedebug, setErasedebug,
        status,
        saveError,
        reportLabel,
        pickPen,
        sendReport,
        cursor,
        patchDocMeta,
        disablePersist: () => { persistRef.current = false; },
        saveLocal,
        saveDrawing,
        loadDrawingFile,
        exportSvg,
        levers,
        setLevers: leverSetter((eng, patch) => eng.setLevers(patch), (patch) => patch),
        setLevelStep: leverSetter((eng, step) => eng.setLevelStep(step), (step) => ({ levelStep: step })),
        setPlateBudget: leverSetter((eng, b) => eng.setPlateBudget(b), (b) => ({ plateViews: b && b.views, plateCeilingMiB: b && b.ceilingMiB })),
        // The dev panel's renderer control: the flag is construction-time, so flipping it rewrites
        // the `?svg` gate and reloads.
        raster: rasterFromUrl(typeof window !== "undefined" ? window.location.href : ""),
        setRaster: (on) => {
            if (typeof window === "undefined") return;
            window.location.href = hrefWithRaster(window.location.href, !!on);
            window.location.reload();
        },
        // The same for the picture pyramid's gate (A3 §7.4), until the old path is deleted.
        pyramid: pyramidFromUrl(typeof window !== "undefined" ? window.location.href : ""),
        setPyramid: (on) => {
            if (typeof window === "undefined") return;
            window.location.href = hrefWithPyramid(window.location.href, !!on);
            window.location.reload();
        },
        undo: () => { E()?.undo(); saverRef.current?.markAllDirty(); },
        redo: () => { E()?.redo(); saverRef.current?.markAllDirty(); },
        clear: () => E()?.clear(),
        deleteSelection: () => { const e = E(); if (e && !e.readOnly) e.deleteSelection(); },
        deselect: () => E()?.deselect(),
        docMeta: () => E()?.docMeta ?? { name: null },
        stats: () => (E() ? statsFromNatives(E().nativesByLevel) : { strokes: 0, levels: 0 }),
        // The cloud push reads the local store, never the live document: what it
        // mirrors is what is on disk. Null until the first local write.
        cloudPushSource: async () => {
            if (!canvasId) return null;
            const src = await cloudPushSource(canvasId, writerRef.current);
            return src ? { ...src, dropBelow: saverRef.current ? saverRef.current.lastFloor() : 0 } : null;
        },
        // SYNC-PLAN R2: `setReadOnly` stops edits (a gesture in progress ends as a pen-up would),
        // `setSaving` gates the saver; `flush` writes what is pending; `reload` reads the store back.
        setReadOnly: (on) => {
            const eng = E();
            if (!eng) return;
            if (on && !eng.readOnly) { if (endGestureRef.current) endGestureRef.current(); if (eng.deselect) eng.deselect(); }
            eng.readOnly = !!on;
        },
        setSaving: (on) => { writableRef.current = !!on; },
        setWriter: (token) => { writerRef.current = token || null; },
        hasUnsaved: () => !!(saverRef.current && saverRef.current.hasUnsaved()),
        // The document in memory kept as a new canvas `name` (a refused or failed write, a lost pen):
        // nothing drawn is discarded. Resolves the new index entry, or null.
        keepUnsaved: async (name) => {
            const eng = E();
            if (!eng || !canvasId) return null;
            let doc;
            const meta = eng.docMeta;
            try { doc = eng.serializeDrawing({ name }); } catch (err) { return null; } finally { eng.docMeta = meta; }
            const id = newCanvasId();
            if (!(await saveCanvasDoc(id, doc))) return null;
            const entry = { id, name, savedAt: new Date().toISOString(), ...statsFromDoc(doc) };
            upsertIndexEntry(entry);
            if (saverRef.current && saverRef.current.markKept) saverRef.current.markKept();
            return entry;
        },
        knownSeq: () => (saverRef.current && saverRef.current.knownSeq ? saverRef.current.knownSeq() : null),
        // Every write this hook started, the tail included, on disk: before the lock goes to another tab.
        idle: async () => {
            if (saverRef.current && saverRef.current.flush) return saverRef.current.flush();
            const t0 = Date.now();
            for (let p = lastWriteRef.current; p && Date.now() - t0 < 10000; p = lastWriteRef.current) {
                await Promise.resolve(p).catch(() => null);
                if (lastWriteRef.current === p) break;
            }
            return true;
        },
        flushSave: () => (saverRef.current && saverRef.current.flush ? saverRef.current.flush() : Promise.resolve(true)),
        reloadFromStore: (opts) => (saverRef.current && saverRef.current.reload ? saverRef.current.reload(opts) : Promise.resolve(null)),
        refreshMetaFromStore: () => (saverRef.current && saverRef.current.refreshMeta ? saverRef.current.refreshMeta() : Promise.resolve(false)),
        lastWrite: () => lastWriteRef.current,
    };
}

export function fmtZoom(z) {
    if (!(z > 0) || !Number.isFinite(z)) return "1";
    // Human-friendly k / M only in the range where the quotient stays short;
    // beyond that (and below .001) fall to the scale bar's automatic scientific
    // notation, so extreme zooms never render as giant plain decimals like
    // "1500646128030403.00M" (the divide-by-1e6 quotient was still ~1e15).
    if (z >= 1e9 || z < 1e-3) return formatScaleNumber(z);
    if (z >= 1e6) return (z / 1e6).toFixed(2) + "M";
    if (z >= 1e3) return (z / 1e3).toFixed(2) + "k";
    return z.toFixed(2);
}

export function zoomLabel(zoom) {
    if (zoom >= 1) return `${fmtZoom(zoom)}×`;
    return `1/${fmtZoom(1 / zoom)}×`;
}
