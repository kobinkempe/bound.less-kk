import React, { useEffect, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import { ClickAwayListener, Slider, Typography, Fab } from "@material-ui/core";
import {
    Apps, Close, Undo, Redo, History, PanTool, Create, BorderColorRounded,
    Remove, Backspace, Gesture, Palette, Height, DeleteForever, GetApp,
    NearMe, HighlightOff, Save, FolderOpen, SaveAlt,
} from "@material-ui/icons";
import { HexColorPicker } from "react-colorful";
import KobinEngine from "../engine/KobinEngine";
import ToolButton from "../Components/toolButton";
import LogoSmallIcon from "../Images/toolbarIcons/logoSmall";
import "../Stylesheets/CanvasToolBar.css";

/**
 * CanvasV2 — harness for the v2 engine (KobinEngine, the symmetric-tile
 * engine). Routes: /#/v2 (also the Home "Start Creating!" target; the old v1
 * /canvas routes redirect here).
 * Toolbar follows the v1 expandable-FAB format (CanvasToolBar): tool rows expand
 * from the Apps button; option columns slide out per group; popups for color and
 * size. Input is pointer-events based: mouse, touch and pen all work, and a
 * two-finger pinch zooms/pans (a young stroke under the first finger is
 * cancelled when the second finger lands).
 */

const AUTOSAVE_KEY = "kobinAutosave";

export default function CanvasV2() {
    const hostRef = useRef(null);
    const engineRef = useRef(null);
    const history = useHistory();
    const [tool, setTool] = useState("pen");
    const [penType, setPenType] = useState("freehand");
    const [color, setColor] = useState("#000000");
    const [width, setWidth] = useState(13);
    const [opacity, setOpacity] = useState(1);
    const [toolDisplay, setToolDisplay] = useState("open");
    const [optionDisplay, setOptionDisplay] = useState("none");
    const [opGroups, setOpGroups] = useState(true);
    const [outline, setOutline] = useState(false);
    const [preBake, setPreBake] = useState(true);   // define+bake next level's tiles early (idle)
    const [lazyFat, setLazyFat] = useState(true);   // fat strokes flip to outlines on approach, not at birth
    const [retainScenes, setRetainScenes] = useState(true); // keep each level's SVG subtree; a flip swaps it in
    const [debug, setDebug] = useState(false);
    const [kdebug, setKdebug] = useState(false);
    const [tiledebug, setTiledebug] = useState(false);
    const [status, setStatus] = useState({ level: 0, inScale: 1, effectiveZoom: 1, nearCross: false, objects: 0 });
    const [reportLabel, setReportLabel] = useState("Report");
    const [devOpen, setDevOpen] = useState(false);
    const errsRef = useRef([]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const w = window.innerWidth, h = window.innerHeight;
        // The engine emits status on every pan/zoom event; a React re-render of
        // the whole toolbar per pinch frame costs ~12 ms. Throttle to 50 ms
        // (trailing edge, so the final state always lands) — readouts and the
        // selection panel update at 20 fps, gestures keep their frame budget.
        const th = { last: 0, timer: null, latest: null };
        const onStatus = (s) => {
            th.latest = s;
            const now = performance.now();
            const due = 50 - (now - th.last);
            if (due <= 0) { th.last = now; setStatus(th.latest); }
            else if (!th.timer) th.timer = setTimeout(() => { th.timer = null; th.last = performance.now(); setStatus(th.latest); }, due);
        };
        const engine = new KobinEngine(host, { width: w, height: h, onStatus });
        engineRef.current = engine;
        window.__kobinEngine = engine; // exposed for scripted testing

        // Restore the last session. loadDrawing reads the kobin-1 format AND the
        // legacy dev-0 autosaves, so nothing is lost across the format switch.
        try {
            const saved = localStorage.getItem(AUTOSAVE_KEY) || localStorage.getItem("kobinSnapshot");
            if (saved) engine.loadDrawing(JSON.parse(saved));
        } catch (err) { console.warn("kobin autosave restore failed", err); }
        // Autosave: serializing a large drawing is a main-thread stringify of
        // megabytes — doing it blindly every 4 s made pure BROWSING hitch
        // periodically. Only save when the document actually changed, and do
        // the work in an idle slice.
        let dirty = false;
        const unsubDirty = engine.doc.subscribe(() => { dirty = true; });
        const save = () => {
            try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(engine.serializeDrawing())); dirty = false; } catch (err) { /* quota */ }
        };
        const idleSave = () => {
            if (!dirty) return;
            const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
            idle(() => { if (dirty) save(); });
        };
        const saveTimer = setInterval(idleSave, 4000);
        window.addEventListener("beforeunload", save);

        // Capture JS errors for debug reports (phones have no visible console).
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

        // ---- pointer input (mouse + touch + pen) ----
        const pointers = new Map(); // pointerId -> [x, y] of pointers that started on the canvas
        let pinch = null;           // { mid: [x,y], dist } of the last two-finger frame
        let ignoreId = null;        // finger left over after a pinch: never draws
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
                // The gesture is a pinch. A stroke that JUST started was the first
                // finger landing, not a mark: cancel it. An older stroke is real work:
                // finalize it.
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
        // Debounced: mobile browsers fire resize on every URL-bar show/hide, and
        // each engine resize is a full re-render.
        let resizeT = null;
        const onResize = () => {
            clearTimeout(resizeT);
            resizeT = setTimeout(() => engine.resize(window.innerWidth, window.innerHeight), 150);
        };
        const gesturePrevent = (e) => e.preventDefault(); // iOS Safari page pinch
        const onKey = (e) => {
            if (!(e.ctrlKey || e.metaKey)) {
                // Delete/Backspace removes the current selection (no text inputs live on the canvas)
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
            save(); // hot reload / unmount keeps the drawing
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
            engine.destroy(); // detach the SVG + stop the loop (avoid stacked dead instances)
            if (window.__kobinEngine === engine) window.__kobinEngine = null;
        };
    }, []);

    // keep engine tool/color/width in sync
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

    const pickPen = (type) => { setPenType(type); setTool("pen"); setOptionDisplay("none"); };
    const toggleOption = (name) => setOptionDisplay(optionDisplay === name ? "none" : name);

    const getTransform = (toolNum = 0, option = 0) =>
        "translate3d(" + 65 * option + "px," + 65 * toolNum + "px,0)";

    // POST a debug report (drawing snapshot + perf log + device info + errors)
    // to the report server on the dev machine (tools/report-server.js, :3001).
    // Lets a phone on the LAN hand its exact state to the dev box.
    const sendReport = async () => {
        const E = engineRef.current;
        if (!E) return;
        setReportLabel("…");
        try {
            const payload = {
                v: 1,
                when: new Date().toISOString(),
                ua: navigator.userAgent,
                screen: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
                camera: { level: E.activeLevel, inScale: E.inScale, effectiveZoom: E._effectiveZoom() },
                counts: {
                    natives: Object.fromEntries(Object.entries(E.nativesByLevel).map(([l, a]) => [l, a.length])),
                    tiles: Object.fromEntries(Object.entries(E.tiles).map(([l, m]) => [l, m.size])),
                    rendered: (E.levelObjects[E.activeLevel] || []).length,
                },
                flags: { opacityGroups: E.opacityGroups, outlineMode: E.outlineMode, hasFat: E._hasFat },
                perf: E.perfLog,
                errors: errsRef.current,
                snapshot: E.snapshot(),
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

    // ---- drawing files (kobin-1 format, engine.serializeDrawing/loadDrawing) ----
    const fileRef = useRef(null);
    const saveDrawing = () => {
        const E = engineRef.current; if (!E) return;
        const name = window.prompt("Save drawing as:", E.docMeta.name || "my drawing");
        if (name == null) return; // cancelled
        const doc = E.serializeDrawing({ name });
        const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = doc.meta.name + ".boundless.json";
        a.click();
        URL.revokeObjectURL(a.href);
        setOptionDisplay("none");
    };
    const openDrawing = () => { if (fileRef.current) fileRef.current.click(); };
    const onDrawingFile = async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = ""; // allow re-picking the same file later
        if (!f) return;
        const E = engineRef.current; if (!E) return;
        try {
            const raw = JSON.parse(await f.text());
            if (!window.confirm(`Load "${f.name}"? Your current drawing will be replaced (a backup stays in this browser).`)) return;
            // belt-and-braces: keep the pre-load autosave recoverable
            try { const cur = localStorage.getItem(AUTOSAVE_KEY); if (cur) localStorage.setItem(AUTOSAVE_KEY + ".backup", cur); } catch (err) { /* quota */ }
            E.loadDrawing(raw); // throws a readable Error on anything malformed
        } catch (err) {
            window.alert("Couldn't load that file: " + (err && err.message ? err.message : err));
        }
        setOptionDisplay("none");
    };

    const downloadSVG = () => {
        const svg = hostRef.current && hostRef.current.querySelector("svg");
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

    const colorPicker = (
        <ClickAwayListener onClickAway={() => setOptionDisplay("none")}>
            <div className="colorPickerWrapperC" style={{ transform: getTransform(5, 1) }}>
                <HexColorPicker className="small" color={color} onChange={setColor} />
            </div>
        </ClickAwayListener>
    );

    const sizePicker = (
        <ClickAwayListener onClickAway={() => setOptionDisplay("none")}>
            <div className="hSlider" style={{ transform: getTransform(6, 1), background: "rgba(255,255,255,.95)",
                padding: "10px 16px", borderRadius: 8, boxShadow: "0 1px 4px rgba(0,0,0,.2)", width: 150 }}>
                <Typography align="center" style={{ fontSize: 13 }}>width {width}px</Typography>
                <Slider min={1} max={90} value={width} onChange={(e, v) => setWidth(v)} />
                <Typography align="center" style={{ fontSize: 13 }}>opacity {Math.round(opacity * 100)}%</Typography>
                <Slider min={0.1} max={1} step={0.05} value={opacity} onChange={(e, v) => setOpacity(v)} />
            </div>
        </ClickAwayListener>
    );

    const dbgBtn = (active) => ({
        padding: "4px 8px", marginLeft: 4, borderRadius: 6, cursor: "pointer", fontSize: 11,
        border: "1px solid #c7d2fe", background: active ? "#4f46e5" : "#fff", color: active ? "#fff" : "#1f2937",
    });

    return (
        <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
            <div ref={hostRef} style={{ position: "absolute", inset: 0, background: "#fff", touchAction: "none",
                cursor: tool === "pan" ? "grab" : (tool === "erase" || tool === "erasePartial") ? "cell"
                    : tool === "select" ? "default" : "crosshair" }} />
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onDrawingFile} />

            {/* toolbar — v1 expandable FAB format */}
            <div style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
                <Fab className="logoTool" onClick={() => history.push("/")}> <LogoSmallIcon /> </Fab>
                <div className="toolBarTools">
                    <ToolButton toolDisplay={toolDisplay} toolNum={0}
                        icon={toolDisplay === "open" ? <Close /> : <Apps />} title="Open/Close Toolbar"
                        onClick={() => setToolDisplay(toolDisplay === "open" ? "closed" : "open")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={1} option={1} optionDisplay={optionDisplay === "history"}
                        icon={<Undo />} title="Undo (Ctrl+Z)"
                        onClick={() => engineRef.current && engineRef.current.undo()} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={1} option={2} optionDisplay={optionDisplay === "history"}
                        icon={<Redo />} title="Redo (Ctrl+Y)"
                        onClick={() => engineRef.current && engineRef.current.redo()} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={1}
                        icon={<History />} title="Undo/Redo"
                        onClick={() => toggleOption("history")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={2} active={tool === "pan"}
                        icon={<PanTool />} title="Pan"
                        onClick={() => setTool("pan")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={3} active={tool === "select"}
                        icon={<NearMe />} title="Select / Edit (tap an object, drag to move)"
                        onClick={() => setTool("select")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={4} option={1} optionDisplay={optionDisplay === "pen"}
                        active={tool === "pen" && penType === "freehand"} icon={<Create />} title="Pen"
                        onClick={() => pickPen("freehand")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={4} option={2} optionDisplay={optionDisplay === "pen"}
                        active={tool === "pen" && penType === "highlight"} icon={<BorderColorRounded />} title="Highlighter"
                        onClick={() => pickPen("highlight")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={4} option={3} optionDisplay={optionDisplay === "pen"}
                        active={tool === "pen" && penType === "straight"} icon={<Remove />} title="Line"
                        onClick={() => pickPen("straight")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={4} option={4} optionDisplay={optionDisplay === "pen"}
                        active={tool === "erasePartial"} icon={<Backspace />} title="Eraser (rubs ink out; size follows pen width)"
                        onClick={() => { setTool("erasePartial"); setOptionDisplay("none"); }} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={4} option={5} optionDisplay={optionDisplay === "pen"}
                        active={tool === "erase"} icon={<HighlightOff />} title="Erase Object (removes the whole object)"
                        onClick={() => { setTool("erase"); setOptionDisplay("none"); }} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={4}
                        icon={<Gesture />} title="Drawing Tools"
                        onClick={() => toggleOption("pen")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={5}
                        icon={<Palette />} title="Color Picker"
                        onClick={() => toggleOption("palette")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={6}
                        icon={<Height />} title="Width & Opacity"
                        onClick={() => toggleOption("sizePicker")} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={7}
                        icon={<DeleteForever />} title="Wipe (undoable)"
                        onClick={() => engineRef.current && engineRef.current.clear()} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={8} option={1} optionDisplay={optionDisplay === "file"}
                        icon={<Save />} title="Save drawing to a file"
                        onClick={saveDrawing} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={8} option={2} optionDisplay={optionDisplay === "file"}
                        icon={<FolderOpen />} title="Open a saved drawing"
                        onClick={openDrawing} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={8} option={3} optionDisplay={optionDisplay === "file"}
                        icon={<GetApp />} title="Download the view as SVG"
                        onClick={downloadSVG} />
                    <ToolButton toolDisplay={toolDisplay} toolNum={8}
                        icon={<SaveAlt />} title="Save / Open / Export"
                        onClick={() => toggleOption("file")} />
                    {optionDisplay === "palette" ? colorPicker : null}
                    {optionDisplay === "sizePicker" ? sizePicker : null}
                </div>
            </div>

            {/* selection edit panel (select tool): restyle / delete the selected object */}
            {status.selection && (
                <div style={{ position: "absolute", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 10,
                    background: "rgba(255,255,255,.97)", borderRadius: 10, boxShadow: "0 2px 10px rgba(0,0,0,.25)",
                    padding: "10px 14px", width: 190 }}>
                    <Typography align="center" style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                        edit {status.selection.type === "fill" ? "fill" : "stroke"} · level {status.selection.level}
                    </Typography>
                    <HexColorPicker className="small" color={toHex(status.selection.color)}
                        onChange={(c) => engineRef.current && engineRef.current.restyleSelection({ color: c })} />
                    {status.selection.widthPx != null && <>
                        <Typography align="center" style={{ fontSize: 13, marginTop: 6 }}>width {Math.round(status.selection.widthPx)}px</Typography>
                        <Slider min={1} max={90} value={Math.min(90, Math.max(1, Math.round(status.selection.widthPx)))}
                            onChange={(e, v) => engineRef.current && engineRef.current.restyleSelection({ widthPx: v })} />
                    </>}
                    <Typography align="center" style={{ fontSize: 13 }}>opacity {Math.round(status.selection.opacity * 100)}%</Typography>
                    <Slider min={0.1} max={1} step={0.05} value={status.selection.opacity}
                        onChange={(e, v) => engineRef.current && engineRef.current.restyleSelection({ opacity: v })} />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                        <button style={{ padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                            border: "1px solid #fecaca", background: "#fff", color: "#b91c1c" }}
                            onClick={() => engineRef.current && engineRef.current.deleteSelection()}>Delete</button>
                        <button style={{ padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                            border: "1px solid #c7d2fe", background: "#fff", color: "#1f2937" }}
                            onClick={() => engineRef.current && engineRef.current.deselect()}>Done</button>
                    </div>
                </div>
            )}

            {/* dev menu: status overlay + debug toggles, collapsed behind one button
                so the everyday canvas stays clean (backlog: dev-tools cleanup) */}
            <div style={{ position: "absolute", top: 10, right: 10, zIndex: 10, textAlign: "right" }}>
                <button style={dbgBtn(devOpen)} onClick={() => setDevOpen(!devOpen)} title="developer tools">Dev</button>
                {devOpen && <>
                    <div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 6, textAlign: "left",
                        background: status.nearCross ? "#fef3c7" : "rgba(255,255,255,.9)", color: "#1f2937",
                        padding: "8px 12px", borderRadius: 8, border: status.nearCross ? "2px solid #f59e0b" : "1px solid #c7d2fe", minWidth: 180 }}>
                        <div><b>LEVEL:</b> {status.level}</div>
                        <div><b>zoom:</b> {fmt(status.effectiveZoom)}x</div>
                        <div><b>inScale:</b> {status.inScale.toFixed(3)}</div>
                        <div><b>objects:</b> {status.objects}</div>
                        <div><b>repr:</b> {status.outline ? "outline" : (status.lines ? "stroke·lines" : "stroke·curves")}</div>
                        <div style={{ marginTop: 4, color: status.nearCross ? "#92400e" : "#94a3b8" }}>
                            {status.nearCross ? "approaching 300x crossing" : "in-level"}
                        </div>
                    </div>
                    <div style={{ marginTop: 6 }}>
                        <button style={dbgBtn(opGroups)} onClick={() => setOpGroups(!opGroups)} title="per-object opacity groups (seamless translucent tile edges)">αSeam</button>
                        <button style={dbgBtn(preBake)} onClick={() => setPreBake(!preBake)} title="define + bake the next level's tiles early (idle), so first crossings land hot">PreBake</button>
                        <button style={dbgBtn(lazyFat)} onClick={() => setLazyFat(!lazyFat)} title="fat strokes flip to cached outlines as they approach the gate (off = at pen-up)">LazyFat</button>
                        <button style={dbgBtn(retainScenes)} onClick={() => setRetainScenes(!retainScenes)} title="keep each level's SVG subtree so a crossing swaps it in instead of rebuilding every path (off = rebuild each flip)">Retain</button>
                        <button style={dbgBtn(outline)} onClick={() => setOutline(!outline)}>Outline</button>
                        <button style={dbgBtn(debug)} onClick={() => setDebug(!debug)}>Edges</button>
                        <button style={dbgBtn(kdebug)} onClick={() => setKdebug(!kdebug)}>K-Debug</button>
                        <button style={dbgBtn(tiledebug)} onClick={() => setTiledebug(!tiledebug)}>Tiles</button>
                        <button style={dbgBtn(false)} onClick={sendReport} title="send drawing state + perf log to the dev machine">{reportLabel}</button>
                    </div>
                </>}
            </div>
        </div>
    );
}

function fmt(z) {
    if (z >= 1e6) return (z / 1e6).toFixed(2) + "M";
    if (z >= 1e3) return (z / 1e3).toFixed(2) + "k";
    return z.toFixed(2);
}

// HexColorPicker wants hex; engine strokes may carry rgb() from the default pen.
function toHex(c) {
    if (!c) return "#000000";
    if (c[0] === "#") return c;
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return "#000000";
    const h = (v) => (+v).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]);
}
