import { useEffect, useRef, useState, useCallback } from "react";
import KobinEngine from "../engine/KobinEngine";

export const AUTOSAVE_KEY = "kobinAutosave";

const DEFAULT_STATUS = { level: 0, inScale: 1, effectiveZoom: 1, nearCross: false, objects: 0 };

/**
 * Shared KobinEngine lifecycle: mount, pointer input, autosave, tool sync.
 * Used by CanvasEditor (product shell); CanvasV2 (dev harness) has its own copy.
 *
 * `storageKey` picks the localStorage autosave slot — CanvasEditor passes a
 * per-canvas key; the default is the legacy single-slot key.
 */
export default function useKobinEngine({ storageKey = AUTOSAVE_KEY } = {}) {
    const hostRef = useRef(null);
    const engineRef = useRef(null);
    const errsRef = useRef([]);
    const [engineReady, setEngineReady] = useState(false);
    const [tool, setTool] = useState("pen");
    const [penType, setPenType] = useState("freehand");
    const [color, setColor] = useState("#000000");
    const [width, setWidth] = useState(12);
    const [opacity, setOpacity] = useState(1);
    const [opGroups, setOpGroups] = useState(true);
    const [outline, setOutline] = useState(false);
    const [preBake, setPreBake] = useState(true);
    const [lazyFat, setLazyFat] = useState(true);
    const [retainScenes, setRetainScenes] = useState(true);
    const [debug, setDebug] = useState(false);
    const [kdebug, setKdebug] = useState(false);
    const [tiledebug, setTiledebug] = useState(false);
    const [status, setStatus] = useState(DEFAULT_STATUS);
    const [reportLabel, setReportLabel] = useState("Report");

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
            const saved = localStorage.getItem(storageKey)
                || (storageKey === AUTOSAVE_KEY ? localStorage.getItem("kobinSnapshot") : null);
            if (saved) engine.loadDrawing(JSON.parse(saved));
        } catch (err) { console.warn("kobin autosave restore failed", err); }

        setEngineReady(true);

        let dirty = false;
        const unsubDirty = engine.doc.subscribe(() => { dirty = true; });
        const save = () => {
            try { localStorage.setItem(storageKey, JSON.stringify(engine.serializeDrawing())); dirty = false; } catch (err) { /* quota */ }
        };
        const idleSave = () => {
            if (!dirty) return;
            const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
            idle(() => { if (dirty) save(); });
        };
        const saveTimer = setInterval(idleSave, 4000);
        window.addEventListener("beforeunload", save);

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
                engine.pointerDown(p[0], p[1]);
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
            save();
            window.removeEventListener("beforeunload", save);
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
    useEffect(() => { engineRef.current && engineRef.current.setOpacityGroups(opGroups); }, [opGroups]);
    useEffect(() => { engineRef.current && engineRef.current.setOutlineMode(outline); }, [outline]);
    useEffect(() => { engineRef.current && engineRef.current.setPreBake(preBake); }, [preBake]);
    useEffect(() => { engineRef.current && engineRef.current.setLazyOutlines(lazyFat); }, [lazyFat]);
    useEffect(() => { engineRef.current && engineRef.current.setRetainScenes(retainScenes); }, [retainScenes]);
    useEffect(() => { engineRef.current && engineRef.current.setDebug(debug); }, [debug]);
    useEffect(() => { engineRef.current && engineRef.current.setKDebug(kdebug); }, [kdebug]);
    useEffect(() => { engineRef.current && engineRef.current.setTileDebug(tiledebug); }, [tiledebug]);

    const pickPen = (type) => { setPenType(type); setTool("pen"); };
    const E = () => engineRef.current;

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
                flags: { opacityGroups: eng.opacityGroups, outlineMode: eng.outlineMode, hasFat: eng._hasFat },
                perf: eng.perfLog,
                errors: errsRef.current,
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
        if (!eng) return null;
        if (name) patchDocMeta({ name });
        try {
            const doc = eng.serializeDrawing();
            localStorage.setItem(storageKey, JSON.stringify(doc));
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
        try { localStorage.setItem(storageKey, JSON.stringify(eng.serializeDrawing())); } catch (err) { /* quota */ }
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

    const cursor = tool === "pan" ? "grab"
        : (tool === "erase" || tool === "erasePartial") ? "cell"
        : tool === "select" ? "default" : "crosshair";

    return {
        hostRef,
        engineRef,
        engineReady,
        tool, setTool,
        penType, setPenType,
        color, setColor,
        width, setWidth,
        opacity, setOpacity,
        opGroups, setOpGroups,
        outline, setOutline,
        preBake, setPreBake,
        lazyFat, setLazyFat,
        retainScenes, setRetainScenes,
        debug, setDebug,
        kdebug, setKdebug,
        tiledebug, setTiledebug,
        status,
        reportLabel,
        pickPen,
        sendReport,
        cursor,
        patchDocMeta,
        saveToLocalStorage,
        saveDrawing,
        loadDrawingFile,
        exportSvg,
        undo: () => E()?.undo(),
        redo: () => E()?.redo(),
        clear: () => E()?.clear(),
        restyleSelection: (patch) => E()?.restyleSelection(patch),
        deleteSelection: () => E()?.deleteSelection(),
        deselect: () => E()?.deselect(),
        docMeta: () => E()?.docMeta ?? { name: null },
    };
}

export function fmtZoom(z) {
    if (z >= 1e6) return (z / 1e6).toFixed(2) + "M";
    if (z >= 1e3) return (z / 1e3).toFixed(2) + "k";
    return z.toFixed(2);
}

export function zoomLabel(zoom) {
    if (zoom >= 1) return `${fmtZoom(zoom)}×`;
    return `1/${fmtZoom(1 / zoom)}×`;
}
