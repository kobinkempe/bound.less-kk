import { useEffect, useRef, useState, useCallback } from "react";
import KobinEngine from "../engine/KobinEngine";
import { formatScaleNumber } from "../engine/scaleBar";
import { OpLog } from "../engine/oplog";
import { encodeObjects, decodeObjects } from "../engine/format2";
import {
    loadCanvasStore, writeCanvas2, backupCanvasDoc, statsFromNatives, cloudPushSource, replaceCanvasStore,
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
};

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

export default function useKobinEngine({ canvasId = null, onAutosave } = {}) {
    const hostRef = useRef(null);
    const engineRef = useRef(null);
    const errsRef = useRef([]);
    const onAutosaveRef = useRef(null);
    onAutosaveRef.current = onAutosave;
    // Deleting a canvas flips this off so the unmount autosave can't quietly
    // recreate the document that was just moved to the recycle bin.
    const persistRef = useRef(true);
    // The autosaver's controls, set up by the mount effect: what an explicit
    // save, an undo, and a meta edit have to tell it.
    const saverRef = useRef(null);
    const replaceStoreRef = useRef(null);
    const [engineReady, setEngineReady] = useState(false);
    const [tool, setTool] = useState("pen");
    const [penType, setPenType] = useState("freehand");
    const [color, setColor] = useState("#000000");
    const [width, setWidth] = useState(12);
    const [opacity, setOpacity] = useState(1);
    const [eraserSize, setEraserSize] = useState(16);
    const [opGroups, setOpGroups] = useState(true);
    const [outline, setOutline] = useState(false);
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
    const [kdebug, setKdebug] = useState(false);      // dev: inert, see KobinEngine.setKDebug
    const [tiledebug, setTiledebug] = useState(false);// dev: cache-tile rectangles
    const [erasedebug, setErasedebug] = useState(false); // dev: the erase/severance overlay
    const [status, setStatus] = useState(DEFAULT_STATUS);
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
        const th = { last: 0, timer: null, latest: null, lastZoom: null };
        const onStatus = (s) => {
            th.latest = s;
            // Flush zoom changes immediately so the scale HUD cannot skip rungs
            // when wheel/trackpad bursts are coalesced by the 50ms throttle.
            if (s.effectiveZoom !== th.lastZoom) {
                th.lastZoom = s.effectiveZoom;
                th.last = performance.now();
                if (th.timer) { clearTimeout(th.timer); th.timer = null; }
                setStatus(s);
                return;
            }
            const now = performance.now();
            const due = 50 - (now - th.last);
            if (due <= 0) { th.last = now; setStatus(th.latest); }
            else if (!th.timer) th.timer = setTimeout(() => { th.timer = null; th.last = performance.now(); setStatus(th.latest); }, due);
        };
        const engine = new KobinEngine(host, { width: w, height: h, onStatus });
        engineRef.current = engine;
        // The console handle — `window.__kobinEngine.renderer.thinScale = false`
        // and the like — is a dev tool, and until 2026-09-07 every production
        // visitor had it. It is there in a dev build, and in production only
        // behind the same `?dev` that unlocks the panel (the hash router keeps
        // the query in the hash: /#/canvas/:id?dev).
        if (process.env.NODE_ENV !== "production" || /[?&]dev(?:[=&]|$)/.test(window.location.hash + window.location.search)) {
            window.__kobinEngine = engine;
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
        let frameSeq = {};
        const logBytes = new Map(), snapBytes = new Map(), markSeq = new Map();
        let carried = [];
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
            if (!LOCAL_AUTOSAVE || !persistRef.current || !restored) return Promise.resolve(false);
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
            const full = fullDirty || !hasBase || d.full || !!opts.full;
            const resetLog = d.full || !hasBase;
            const entries = d.full ? [] : carried.concat(d.entries);
            carried = [];
            const takenFull = fullDirty;
            const takenSeq = docSeq;
            fullDirty = false;
            noteEntries(entries, frameSeq);
            const frameIds = Object.keys(engine.nativesByLevel);
            const want = new Set(full ? frameIds : d.forced.filter((L) => engine.nativesByLevel[L]));
            for (const L of frameIds) if (!want.has(L) && outgrown(L)) want.add(L);
            const snapshots = {};
            let env;
            try {
                for (const L of want) snapshots[L] = { ...encodeObjects(engine.doc.at(L)), seq: log.seq };
                env = engine.serializeDrawing({}, { frames: [] });
            } catch (err) {
                console.warn("kobin autosave: serialize failed", err);
                carried = entries; fullDirty = fullDirty || takenFull;
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
            const putBack = () => { carried = entries.concat(carried); fullDirty = fullDirty || takenFull; };
            saving = true;
            inflight = writeCanvas2(canvasId, {
                header: { ...header, name: header.meta.name, ...stats, seq: log.seq },
                snapshots, frameIds, entries, full, resetLog, dropBelow: Math.max(0, floor),
            })
                .then((ok) => {
                    if (ok === null) throw new Error("no local database");
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
                    failCount = 0; skipUntil = 0; failedSeq = -1;
                    if (docSeq === savedSeq && !log.queue.length) firstDirtyAt = 0;
                    engine.notePerf?.("autosave", t0, {
                        ok: 1, why, full: full ? 1 : 0, frames: Object.keys(snapshots).length, entries: entries.length,
                        serMs: +(tSer - t0).toFixed(1), putMs: +(now() - tSer).toFixed(1),
                    });
                    if (!disposed) {
                        setSaveError(null);
                        onAutosaveRef.current?.({ name: header.meta.name, stats });
                    }
                    return true;
                })
                .catch((err) => {
                    putBack();
                    const quota = isQuota(err);
                    failedSeq = takenSeq;
                    failCount = Math.min(failCount + 1, 6);
                    skipUntil = now() + 4000 * Math.pow(2, failCount);   // 8s -> 256s
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
            // An explicit Save: every frame snapshotted, the log kept (it is the
            // undo history). Waits for a write in flight first.
            saveNow: async () => {
                if (inflight) await inflight.catch(() => false);
                return save("explicit", true, { full: true });
            },
        };

        if (window.__kobinEngine === engine) window.__kobinSaver = saverRef.current;
        // RESTORE. The document comes back asynchronously; `engineReady` waits
        // for it, so nothing in the shell (the cloud pull most of all) compares
        // an empty engine against anything. A canvas still in the v1 store loads
        // the old way and its first save writes it to the kobin-2 store whole.
        // The store into the engine: snapshots through `loadDrawing`, then the log
        // replayed onto them (undo stacks and pending erasers included). Used at
        // mount and after a cloud pull has replaced the store.
        const restoreFrom = (res) => {
            if (res.legacy) {
                engine.loadDrawing(res.legacy);
                hasBase = false; fullDirty = true;
                return true;
            }
            const natives = {};
            for (const [fid, f] of Object.entries(res.frames)) natives[fid] = decodeObjects(f.objects, f.geo);
            const { store, frameIds, frameSeq: storedSeq, seq, id, name, savedAt, ...envelope } = res.header;
            engine.loadDrawing({ ...envelope, natives });
            frameSeq = { ...(storedSeq || {}) };
            log.seq = seq || 0;
            logBytes.clear(); snapBytes.clear(); markSeq.clear(); carried = [];
            for (const [fid, f] of Object.entries(res.frames)) snapBytes.set(fid, f.geo.byteLength);
            log.replaying = true;
            try { log.replay(res.entries, frameSeq); } finally { log.replaying = false; }
            noteEntries(res.entries, frameSeq);
            for (const mid of [...markSeq.keys()]) if (!engine.doc.getById(mid)) markSeq.delete(mid);
            engine._render();
            engine._scheduleBake();   // a pending eraser resumes where its log left it
            hasBase = true;
            return true;
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
        restoreP.then((res) => {
            if (disposed || !res) return false;
            try { return restoreFrom(res); } catch (err) {
                // The stored copy will not decode. Keep it for a week rather
                // than let the first autosave write an empty drawing over it.
                console.warn("kobin autosave restore failed", err);
                backupCanvasDoc(canvasId);
                return false;
            }
        }, (err) => { console.warn("kobin autosave restore failed", err); return false; })
        .then((loaded) => {
            if (disposed) return;
            restored = true;
            settleAfterLoad(loaded);
            setEngineReady(true);
        });
        // A cloud pull: the pulled store written whole over the local one (the
        // caller has backed the local one up), then restored like a fresh open.
        replaceStoreRef.current = async (pulled) => {
            if (inflight) await inflight.catch(() => false);
            const ok = await replaceCanvasStore(canvasId, pulled);
            if (!ok) return false;
            const res = await loadCanvasStore(canvasId);
            if (!res || disposed) return false;
            restoreFrom(res);
            settleAfterLoad(true);
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
                if ((e.key === "Delete" || e.key === "Backspace") && engine.selection) {
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
    }, [canvasId]);

    useEffect(() => { engineRef.current && engineRef.current.setTool(tool); }, [tool]);
    useEffect(() => { engineRef.current && engineRef.current.setPenType(penType); }, [penType]);
    useEffect(() => { engineRef.current && engineRef.current.setColor(color); }, [color]);
    useEffect(() => { engineRef.current && engineRef.current.setWidth(width); }, [width]);
    useEffect(() => { engineRef.current && engineRef.current.setOpacity(opacity); }, [opacity]);
    useEffect(() => { engineRef.current && engineRef.current.setEraserSize(eraserSize); }, [eraserSize]);
    useEffect(() => { engineRef.current && engineRef.current.setOpacityGroups(opGroups); }, [opGroups]);
    useEffect(() => { engineRef.current && engineRef.current.setOutlineMode(outline); }, [outline]);
    useEffect(() => { engineRef.current && engineRef.current.setPreBake(preBake); }, [preBake]);
    useEffect(() => { engineRef.current && engineRef.current.setTrace(trace); }, [trace]);
    useEffect(() => { engineRef.current && engineRef.current.setLazyOutlines(lazyFat); }, [lazyFat]);
    useEffect(() => { engineRef.current && engineRef.current.setRetainScenes(retainScenes); }, [retainScenes]);
    useEffect(() => { engineRef.current && engineRef.current.setDebug(debug); }, [debug]);
    useEffect(() => { engineRef.current && engineRef.current.setKDebug(kdebug); }, [kdebug]);
    useEffect(() => { engineRef.current && engineRef.current.setTileDebug(tiledebug); }, [tiledebug]);
    useEffect(() => { engineRef.current && engineRef.current.setEraseDebug(erasedebug); }, [erasedebug]);

    const pickPen = (type) => { setPenType(type); setTool("pen"); };
    const E = () => engineRef.current;

    // DEV: POST the whole diagnostic bundle to tools/report-server.js on :3001,
    // which writes `.kobin-reports/`. Reachable only from the dev panel (?dev).
    // The payload's `snapshot` is a loadable drawing — see OPEN-FLAGS F35.
    const sendReport = async () => {
        const eng = E();
        if (!eng) return;
        setReportLabel("…");
        try {
            const payload = {
                v: 1,
                when: new Date().toISOString(),
                ua: navigator.userAgent,
                screen: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
                camera: { level: eng.activeLevel, inScale: eng.inScale, effectiveZoom: eng._effectiveZoom() },
                counts: {
                    natives: Object.fromEntries(Object.entries(eng.nativesByLevel).map(([l, a]) => [l, a.length])),
                    tiles: Object.fromEntries(Object.entries(eng.tiles).map(([l, m]) => [l, m.size])),
                    rendered: (eng.levelObjects[eng.activeLevel] || []).length,
                },
                flags: { opacityGroups: eng.opacityGroups, outlineMode: eng.outlineMode, hasFat: eng._hasFat, retainScenes: !!eng.retainScenes, preBake: !!eng.preBake, trace: !!eng.trace },
                perf: eng.perfLog,
                // What no JS timer can see: the gap between animation frames, which is
                // the number the user actually feels. Buckets plus the worst few frames,
                // wall-clock stamped so a bad frame lines up against `perf` and `journal`.
                frames: eng.frameMeter ? eng.frameMeter.report() : null,
                // Chrome's own account of every slow frame: script vs style-and-layout
                // vs everything left over (paint/raster/composite), with the slowest
                // scripts named. This is what the frame meter could never tell us.
                longFrames: eng.longFrames ? eng.longFrames.report() : null,
                // Does the SESSION accumulate? A refresh cures the slowness, so the
                // suspect is heap/cache growth rather than the drawing or the machine.
                growth: eng.growth ? eng.growth.report() : null,
                // input -> pixels, in three phases. The third (presentMs) is the only
                // measure that reaches past the main thread to the compositor.
                eventLatency: eng.eventLatency ? eng.eventLatency.report() : null,
                // Zoom and pan steps are far too frequent to log one by one (300-entry
                // cap); this is their distribution instead, including how many crossed
                // 8, 16 and 50 ms. Two reports came back with no zoom entries at all
                // because every step sat under the log threshold.
                fast: eng.fastStats ? eng.fastStats() : null,
                errors: errsRef.current,
                // WHAT WAS DONE, not just what is left.
                journal: eng.journal,
                families: eng.reportFamilies(),
                counters: {
                    dustCulled: eng._dustCulled || 0,
                    boolSeals: eng._boolFailures || 0,
                    bakeRepairs: eng._bakeRepairs || 0,
                    lastSeal: eng._lastBoolFailure || null,
                    lastBakeRepair: eng._lastBakeRepair || null,
                },
                snapshot: eng.snapshot(),
            };
            const r = await fetch(`http://${window.location.hostname}:3001/report`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            setReportLabel(r.ok ? "Sent ✓" : "Failed");
        } catch (err) {
            setReportLabel("Failed");
        }
        setTimeout(() => setReportLabel("Report"), 2500);
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
        const raw = JSON.parse(await file.text());
        eng.loadDrawing(raw);
        await saveLocal();
    };

    const exportSvg = () => {
        const svg = hostRef.current?.querySelector("svg");
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
        outline, setOutline,
        preBake, setPreBake,
        trace, setTrace,
        lazyFat, setLazyFat,
        retainScenes, setRetainScenes,
        debug, setDebug,
        kdebug, setKdebug,
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
        undo: () => { E()?.undo(); saverRef.current?.markAllDirty(); },
        redo: () => { E()?.redo(); saverRef.current?.markAllDirty(); },
        clear: () => E()?.clear(),
        deleteSelection: () => E()?.deleteSelection(),
        deselect: () => E()?.deselect(),
        docMeta: () => E()?.docMeta ?? { name: null },
        stats: () => (E() ? statsFromNatives(E().nativesByLevel) : { strokes: 0, levels: 0 }),
        // The cloud push reads the local store, never the live document: what it
        // mirrors is what is on disk. Null until the first local write.
        cloudPushSource: async () => {
            if (!canvasId) return null;
            const src = await cloudPushSource(canvasId);
            return src ? { ...src, dropBelow: saverRef.current ? saverRef.current.lastFloor() : 0 } : null;
        },
        replaceStore: (pulled) => (replaceStoreRef.current ? replaceStoreRef.current(pulled) : Promise.resolve(false)),
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
