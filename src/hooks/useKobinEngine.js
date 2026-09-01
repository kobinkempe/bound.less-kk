import { useEffect, useRef, useState, useCallback } from "react";
import KobinEngine from "../engine/KobinEngine";
import { formatScaleNumber } from "../engine/scaleBar";
import { packSlot, unpackSlot } from "../storage/localCanvases";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const AUTOSAVE_KEY = "kobinAutosave";

/**
 * LOCAL AUTOSAVE — OFF DELIBERATELY (2026-08-26, Kobin's call), until F33 is fixed.
 *
 * WHY. When localStorage is full, every attempt does the whole job before it is
 * allowed to fail: serialize the document, stringify it, compress it, and only
 * then does the write throw. Measured on a 4.1 MB document that is ~960 ms of
 * blocked main thread, for nothing. The backoff added 2026-08-25 stops the hot
 * loop but not the cost — it still fires on a schedule, and the unload save
 * ignores the backoff entirely, so every reload pays a full second.
 *
 * WHAT STILL SAVES with this off:
 *   - the Save button (`saveToLocalStorage`), an explicit user action; and
 *   - cloud sync while signed in — which is why `cloudDirtyRef` in CanvasEditor
 *     is now driven off DOCUMENT CHANGES rather than off a successful local
 *     write. It used to be set only by `onAutosave`, so turning autosave off
 *     would have taken the cloud down with it.
 *
 * The standing "autosave is off" notice rides `saveError`, which CanvasEditor
 * renders. Without that this is the same silent-data-loss trap wearing a
 * different hat.
 *
 * TO RESTORE: flip this to true. Nothing else has to change.
 */
export const LOCAL_AUTOSAVE = false;

const AUTOSAVE_OFF_NOTICE = {
    off: true, quota: false, at: Date.now(),
    message: "Autosave is off — use Save to keep your work.",
};

const DEFAULT_STATUS = {
    level: 0, inScale: 1, effectiveZoom: 1, nearCross: false, objects: 0,
    canUndo: false, canRedo: false,
};

/**
 * Shared KobinEngine lifecycle: mount, pointer input, autosave, tool sync.
 * Used by CanvasEditor (product shell); CanvasV2 (dev harness) has its own copy.
 *
 * `storageKey` picks the localStorage autosave slot — CanvasEditor passes a
 * per-canvas key; the default is the legacy single-slot key.
 * `onAutosave(doc)` fires after each successful local autosave — CanvasEditor
 * uses it to mark the canvas cloud-dirty and freshen the gallery index.
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

export default function useKobinEngine({ storageKey = AUTOSAVE_KEY, onAutosave } = {}) {
    const hostRef = useRef(null);
    const engineRef = useRef(null);
    const errsRef = useRef([]);
    const onAutosaveRef = useRef(null);
    onAutosaveRef.current = onAutosave;
    // Deleting a canvas flips this off so the unmount/beforeunload autosave
    // can't quietly recreate the slot that was just moved to the recycle bin.
    const persistRef = useRef(true);
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
        window.__kobinEngine = engine;

        try {
            const saved = unpackSlot(
                localStorage.getItem(storageKey)
                || (storageKey === AUTOSAVE_KEY ? localStorage.getItem("kobinSnapshot") : null),
            );
            if (saved) engine.loadDrawing(JSON.parse(saved));
        } catch (err) { console.warn("kobin autosave restore failed", err); }

        setEngineReady(true);

        let dirty = false;
        // A monotonic counter over document changes. `dirty` alone cannot tell
        // "there is work to do" from "the same work that just failed".
        let docSeq = 0;
        const unsubDirty = engine.doc.subscribe(() => { dirty = true; docSeq += 1; });

        // AUTOSAVE FAILURE HANDLING (2026-08-25).
        //
        // `dirty = false` used to sit AFTER the localStorage write, so a throw
        // left it set and the 4 s interval re-ran the identical doomed work for
        // ever. Measured on a 4.1 MB document: ~960 ms of main-thread JS every
        // 4 s, 249 long frames, 69 s blocked out of a 118 s session, and the
        // heap climbing 151 -> 529 MB. It read as "zooming is laggy" because
        // zooming keeps dirtying the document, so the interval always found
        // work -- the interval was the only thing that was actually periodic.
        //
        // It was also INVISIBLE: notePerf sat after the write too, so a failing
        // save left no entry at all, and reports showed an anonymous
        // requestIdleCallback burning a second. Both paths are timed now.
        let failedSeq = -1;      // docSeq at the last failure
        let failCount = 0;
        let skipUntil = 0;
        const isQuota = (err) => !!err && (
            err.name === "QuotaExceededError"
            || err.name === "NS_ERROR_DOM_QUOTA_REACHED"
            || err.code === 22 || err.code === 1014);

        const save = (force = false) => {
            if (!persistRef.current) return;
            if (!force) {
                // The document has not changed since the attempt that failed,
                // so the same bytes would fail the same way -- and finding that
                // out costs a second of main thread. Skip without serializing.
                if (failedSeq === docSeq) return;
                // Still backing off from a recent failure.
                if (now() < skipUntil) return;
            }
            let json = null, packed = null;
            let tStr = 0, tPack = 0, tPut = 0;
            const tSer = now();
            try {
                // TIMED in three parts, because "the save is slow" is not
                // actionable and these three have wildly different costs:
                // serializing walks every object, lz-string compression is
                // CPU-bound (~100 ms measured on a 195 KB document), and the
                // localStorage write is a synchronous disk hit.
                const doc = engine.serializeDrawing();
                tStr = now();
                json = JSON.stringify(doc);
                tPack = now();
                packed = packSlot(json);
                tPut = now();
                localStorage.setItem(storageKey, packed);
                const tEnd = now();
                engine.notePerf?.("autosave", tSer, {
                    ok: 1, chars: json.length, packed: packed.length,
                    serMs: +(tStr - tSer).toFixed(1),
                    jsonMs: +(tPack - tStr).toFixed(1),
                    packMs: +(tPut - tPack).toFixed(1),
                    putMs: +(tEnd - tPut).toFixed(1),
                });
                failedSeq = -1; failCount = 0; skipUntil = 0;
                dirty = false;
                setSaveError(null);
                onAutosaveRef.current?.(doc);
            } catch (err) {
                const quota = isQuota(err);
                // `dirty` deliberately stays set: the work really is unsaved,
                // and a later change (or an unload) should still try. What must
                // not happen is retrying THIS state on the next tick.
                failedSeq = docSeq;
                failCount = Math.min(failCount + 1, 6);
                skipUntil = now() + 4000 * Math.pow(2, failCount);   // 8s -> 256s
                engine.notePerf?.("autosaveFail", tSer, {
                    ok: 0, quota: quota ? 1 : 0,
                    err: String((err && err.name) || err).slice(0, 60),
                    chars: json ? json.length : 0,
                    packed: packed ? packed.length : 0,
                    serMs: +((tStr || now()) - tSer).toFixed(1),
                    jsonMs: tPack ? +(tPack - tStr).toFixed(1) : 0,
                    packMs: tPut ? +(tPut - tPack).toFixed(1) : 0,
                    backoffS: Math.round((skipUntil - now()) / 1000),
                });
                // Reports carry `errors`, and a save that never lands is
                // exactly the kind of thing a report should be showing.
                errsRef.current.push({ t: Date.now(),
                    msg: "autosave failed" + (quota ? " (storage full)" : "")
                        + ": " + String((err && err.message) || err).slice(0, 120) });
                if (errsRef.current.length > 50) errsRef.current.shift();
                setSaveError({ quota, at: Date.now(),
                    message: quota
                        ? "Storage is full - changes are not being saved."
                        : "Autosave failed - changes are not being saved." });
                console.warn("kobin autosave failed" + (quota ? " (storage full)" : ""), err);
            }
        };
        const idleSave = () => {
            if (!dirty) return;
            const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
            idle(() => { if (dirty) save(); });
        };
        // Both the timer and the unload save are skipped while LOCAL_AUTOSAVE is
        // off — the unload one especially, because it forces past the backoff
        // and would put a full serialize-and-fail on every reload.
        const saveTimer = LOCAL_AUTOSAVE ? setInterval(idleSave, 4000) : null;
        // Last chance on the way out: ignore the backoff. It may be the only
        // attempt left, and a tab close is not a hot loop.
        const saveOnUnload = () => save(true);
        if (LOCAL_AUTOSAVE) window.addEventListener("beforeunload", saveOnUnload);

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
        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

        const down = (e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const p = rel(e);
            pointers.set(e.pointerId, p);
            if (pointers.size === 1) {
                ignoreId = null;
                // Ctrl reaches the engine, which has always implemented
                // add/remove on it — `_pointerDown` toggles the object under
                // the pointer, and a ctrl lasso adds (or subtracts, when drawn
                // wholly inside the selection). The flag was simply never
                // passed, so none of that was reachable from the UI.
                engine.pointerDown(p[0], p[1], e.ctrlKey || e.metaKey);
            } else if (pointers.size === 2) {
                if (engine._drawing && Date.now() - engine._drawStartT < 400) engine.cancelStroke();
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
        const wheel = (e) => { e.preventDefault(); const [x, y] = rel(e); engine.zoomAt(x, y, e.deltaY); };
        let resizeT = null;
        const onResize = () => {
            clearTimeout(resizeT);
            resizeT = setTimeout(() => engine.resize(window.innerWidth, window.innerHeight), 150);
        };
        const gesturePrevent = (e) => e.preventDefault();
        const onKey = (e) => {
            if (!(e.ctrlKey || e.metaKey)) {
                if ((e.key === "Delete" || e.key === "Backspace") && engine.selection) {
                    e.preventDefault(); engine.deleteSelection();
                }
                return;
            }
            const k = e.key.toLowerCase();
            if (k === "z") { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); }
            else if (k === "y") { e.preventDefault(); engine.redo(); }
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
        return () => {
            clearInterval(saveTimer);
            clearTimeout(resizeT);
            clearTimeout(th.timer);
            unsubDirty();
            if (LOCAL_AUTOSAVE) save(true);   // last chance before this engine goes away — no backoff
            window.removeEventListener("beforeunload", saveOnUnload);
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
            engine.destroy();
            if (window.__kobinEngine === engine) window.__kobinEngine = null;
            setEngineReady(false);
        };
    }, []);

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
                // WHAT WAS DONE, not just what is left — see CanvasV2's copy.
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

    const saveToLocalStorage = async (name) => {
        const eng = E();
        if (!eng || !persistRef.current) return null;
        if (name) patchDocMeta({ name });
        try {
            const doc = eng.serializeDrawing();
            localStorage.setItem(storageKey, packSlot(JSON.stringify(doc)));
            return doc;
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
        try { localStorage.setItem(storageKey, packSlot(JSON.stringify(eng.serializeDrawing()))); } catch (err) { /* quota */ }
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
        saveToLocalStorage,
        saveDrawing,
        loadDrawingFile,
        exportSvg,
        undo: () => E()?.undo(),
        redo: () => E()?.redo(),
        clear: () => E()?.clear(),
        deleteSelection: () => E()?.deleteSelection(),
        deselect: () => E()?.deselect(),
        docMeta: () => E()?.docMeta ?? { name: null },
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
