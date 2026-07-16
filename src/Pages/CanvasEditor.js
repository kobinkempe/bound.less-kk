import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useParams, useLocation, useHistory } from "react-router-dom";
import {
    Home, Layers, Pen, Pencil, Eraser, Highlighter,
    ChevronLeft, ChevronRight, X, Ruler, Hand, MousePointer2, Slash,
    CircleOff, Undo2, Redo2, Palette, Save, MoreVertical,
    Bookmark, Scissors,
} from "lucide-react";
import Button from "../Components/ui/Button";
import Input from "../Components/ui/Input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../Components/ui/Dialog";
import useKobinEngine, { zoomLabel } from "../hooks/useKobinEngine";
import {
    newCanvasId, slotKey, upsertIndexEntry, statsFromDoc, loadCanvasRaw,
    loadThumbs, saveThumbs, readIndex, backupCanvasSlot, trashCanvas, removeCanvas,
    duplicateCanvas, stashOverwrittenVersion, getDeviceId,
} from "../storage/localCanvases";
import useUser from "../cloud/useUser";
import {
    cloudSaveCanvas, cloudLoadCanvas, cloudGetCanvasMeta, cloudTrashCanvas,
    cloudSetEditing, cloudClearEditing,
} from "../cloud/canvasSync";
import {
    computeScale, formatScaleLabel, applyUnitPick, clearDisplayPrefs,
    validateScaleDef, setScaleUnits, BAR_PX_TARGET, MIN_DRAG_PX,
    shouldApplyScaleSessionWriteBack,
} from "../engine/scaleBar";
import ScaleUnitPicker, { ScaleUnitButtonGrid } from "../Components/editor/ScaleUnitPicker";
import SciText from "../Components/ui/SciText";
import ColorPickerPopover from "../Components/editor/ColorPickerPopover";
import WidthOpacityPanel from "../Components/editor/WidthOpacityPanel";
import SelectionEditPanel from "../Components/editor/SelectionEditPanel";
import FileActionsMenu from "../Components/editor/FileActionsMenu";
import SaveDrawingDialog from "../Components/editor/SaveDrawingDialog";
import ScaleDragBar from "../Components/editor/ScaleDragBar";
import "../Stylesheets/boundless-ui.css";
import { renderThumbs } from "../storage/thumbnails";

const SWATCHES = ["#2b2620", "#8a3324", "#a06b2c", "#3d5a45", "#33506e", "#6e4a72"];

/** Pen width presets — highlighter renders at width × 2.5 in the engine. */
const PEN_WIDTH = 12;
const HIGHLIGHTER_WIDTH = 26;
const PENCIL_WIDTH = 5;
const LINE_WIDTH = 12;

const DRAW_TOOL_IDS = new Set(["pen", "pencil", "highlighter", "line"]);

const TOOL_SECTIONS = [
    {
        id: "history",
        items: [
            { id: "undo", icon: Undo2, label: "Undo (Ctrl+Z)", action: (e) => e.undo() },
            { id: "redo", icon: Redo2, label: "Redo (Ctrl+Y)", action: (e) => e.redo() },
        ],
    },
    {
        id: "draw",
        items: [
            { id: "pen", icon: Pen, label: "Pen", penType: "freehand", width: PEN_WIDTH },
            { id: "pencil", icon: Pencil, label: "Pencil", penType: "freehand", width: PENCIL_WIDTH },
            { id: "highlighter", icon: Highlighter, label: "Highlighter", penType: "highlight", width: HIGHLIGHTER_WIDTH },
            { id: "line", icon: Slash, label: "Straight line", penType: "straight", width: LINE_WIDTH },
        ],
    },
    {
        id: "erase",
        items: [
            { id: "eraser", icon: Eraser, label: "Eraser (partial)", tool: "erasePartial" },
            { id: "erase-object", icon: CircleOff, label: "Erase object", tool: "erase" },
        ],
    },
    {
        id: "nav",
        items: [
            { id: "select", icon: MousePointer2, label: "Select / edit", tool: "select" },
            { id: "pan", icon: Hand, label: "Pan", tool: "pan" },
        ],
    },
];

export default function CanvasEditor() {
    const { canvasId } = useParams();
    const location = useLocation();
    const history = useHistory();
    // Dev tools are hidden unless the URL carries ?dev (e.g. /#/canvas/new?dev).
    const devUnlocked = useMemo(
        () => new URLSearchParams(location.search).has("dev"),
        [location.search],
    );
    // "/canvas/new" mints a real id before the engine mounts, so the fresh
    // canvas gets its own empty autosave slot. The memo stays stable across
    // the history.replace that swaps "new" for the minted id.
    const mintedIdRef = useRef(null);
    const realId = useMemo(() => {
        if (canvasId !== "new") return canvasId;
        if (!mintedIdRef.current) mintedIdRef.current = newCanvasId();
        return mintedIdRef.current;
    }, [canvasId]);
    useEffect(() => {
        if (canvasId === "new") history.replace(`/canvas/${realId}${location.search}`);
    }, [canvasId, realId, history, location.search]);
    // Cloud-dirty tracking: every local autosave marks the canvas as needing a
    // cloud push (drawings used to sync ONLY on explicit Save, so a canvas
    // autosaved on one device opened empty/stale on another). The index entry
    // is freshened too, so savedAt reflects the last edit and freshest-wins
    // pulls can compare local vs cloud honestly. Unsaved scratch canvases
    // (no index entry yet) stay local-only until first explicitly saved.
    const cloudDirtyRef = useRef(false);
    const onAutosave = useCallback((doc) => {
        const entry = readIndex().find((e) => e.id === realId);
        if (!entry) return;
        const nm = doc.meta && doc.meta.name;
        upsertIndexEntry({
            ...entry,
            name: (nm && nm !== "untitled" ? nm : null) || entry.name,
            savedAt: new Date().toISOString(),
            ...statsFromDoc(doc),
        });
        cloudDirtyRef.current = true;
    }, [realId]);
    const engine = useKobinEngine({ storageKey: slotKey(realId), onAutosave });
    const { user } = useUser();
    const editorRef = useRef(null);
    const fileRef = useRef(null);
    const colorSectionRef = useRef(null);
    const paletteAnchorRef = useRef(null);
    const drawToolRefs = useRef({});
    const sizeAnchorRef = useRef(null);
    const fileAnchorRef = useRef(null);
    const scaleHudRef = useRef(null);
    const scaleLabelRef = useRef(null);

    const [toolsOpen, setToolsOpen] = useState(true);
    const [scenesOpen, setScenesOpen] = useState(false);
    const [scenes, setScenes] = useState([]);
    const [sceneThumbs, setSceneThumbs] = useState({});
    const [sceneRename, setSceneRename] = useState(null); // { id, draft }
    const [activeTool, setActiveTool] = useState("pen");
    const [hintDismissed, setHintDismissed] = useState(false);
    const [toast, setToast] = useState(null);
    const [devOpen, setDevOpen] = useState(false);
    const [colorOpen, setColorOpen] = useState(false);
    const [sizeOpen, setSizeOpen] = useState(false);
    const [fileOpen, setFileOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [leaveOpen, setLeaveOpen] = useState(false);
    const [remoteEditing, setRemoteEditing] = useState(false);
    const [remoteBannerDismissed, setRemoteBannerDismissed] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [canvasTitle, setCanvasTitle] = useState("Untitled canvas");

    const [scaleDef, setScaleDef] = useState(null);
    const [defineMode, setDefineMode] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [dragEnd, setDragEnd] = useState(null);
    const [pendingBar, setPendingBar] = useState(null);
    const [scaleValue, setScaleValue] = useState("1");
    const [scaleUnit, setScaleUnit] = useState("in");
    // Durable display session: sticky ladder (L8), user preferred range
    // (L5/L12), incumbent unit (L2). Owned here; the engine never mutates it.
    const [scaleSession, setScaleSession] = useState(null);
    const [unitPickerOpen, setUnitPickerOpen] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setHintDismissed(true), 15000);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 2500);
        return () => clearTimeout(t);
    }, [toast]);

    useEffect(() => {
        if (!defineMode) return;
        const onKey = (e) => { if (e.key === "Escape") { setDefineMode(false); setDragStart(null); setDragEnd(null); } };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [defineMode]);

    useEffect(() => {
        if (!engine.engineReady) return;
        const def = validateScaleDef(engine.engineRef.current?.docMeta?.scaleDef);
        if (def) {
            setScaleDef(def);
            // Fresh session from the anchor unit (L9 — ladder by priority).
            setScaleSession(clearDisplayPrefs(null, def));
        }
        const raw = engine.docMeta()?.name;
        setCanvasTitle(raw && raw !== "untitled" ? raw : "Untitled canvas");
    }, [engine.engineReady, canvasId]);

    // Regenerate thumbnails for scenes whose content hash changed; returns the
    // fresh entries (and folds them into state + localStorage).
    const ensureThumbs = async (doc, list) => {
        try {
            const existing = loadThumbs(realId, list.map((s) => s.id));
            const fresh = await renderThumbs(doc, list, existing);
            // The primary scene (first in the list) doubles as the gallery
            // cover — alias its thumb under the "cover" key that the gallery
            // and the cloud thumbnail budget already prioritize.
            const primary = list[0];
            const primaryThumb = primary && (fresh[primary.id] || existing[primary.id]);
            if (primaryThumb && (!existing.cover || existing.cover.hash !== primaryThumb.hash)) {
                fresh.cover = primaryThumb;
            }
            if (Object.keys(fresh).length) {
                saveThumbs(realId, fresh);
                setSceneThumbs((t) => ({ ...t, ...fresh }));
            }
            return fresh;
        } catch (err) {
            console.warn("thumbnails failed", err);
            return {};
        }
    };

    const persistCanvas = async (name) => {
        const E = engine.engineRef.current;
        if (E) setScenes(E.refreshScenes()); // scenes ride the save file (docMeta)
        const doc = await engine.saveToLocalStorage(name);
        if (!doc) return { local: false, cloud: false };
        // The engine's default meta name is lowercase "untitled" — never let it
        // become a visible gallery/cloud label.
        const metaName = doc.meta && doc.meta.name;
        const entry = {
            id: realId,
            name: (metaName && metaName !== "untitled" ? metaName : null) || name || "Untitled canvas",
            savedAt: new Date().toISOString(),
            ...statsFromDoc(doc),
        };
        upsertIndexEntry(entry);
        const fresh = await ensureThumbs(doc, doc.meta.scenes || []);
        let cloud = false;
        if (user) {
            try {
                await cloudSaveCanvas(user.uid, entry, JSON.stringify(doc), Object.keys(fresh).length ? fresh : null);
                cloud = true;
                cloudDirtyRef.current = false;
            } catch (err) {
                console.warn("cloud save failed", err);
                cloudDirtyRef.current = true; // autosync retries
                showToast("Saved to this browser — cloud sync failed");
            }
        }
        return { local: true, cloud };
    };

    // Background cloud sync: push the latest autosaved state every 30s while
    // signed in and dirty, and on tab-hide (phones background the tab long
    // before a user thinks to press Save). Thumbs aren't regenerated here —
    // the server merge keeps the previously stored set.
    const cloudAutosync = useCallback(async () => {
        if (!user || !cloudDirtyRef.current) return;
        const E = engine.engineRef.current;
        if (!E) return;
        const entry = readIndex().find((e) => e.id === realId);
        if (!entry) return; // never explicitly saved — stays local-only
        cloudDirtyRef.current = false; // claim; re-set on failure
        try {
            const doc = E.serializeDrawing();
            await cloudSaveCanvas(user.uid, {
                ...entry,
                savedAt: new Date().toISOString(),
                ...statsFromDoc(doc),
            }, JSON.stringify(doc), null);
        } catch (err) {
            cloudDirtyRef.current = true;
            console.warn("cloud autosync failed", err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, realId]);

    useEffect(() => {
        if (!user) return;
        const timer = setInterval(cloudAutosync, 30000);
        const onHide = () => { if (document.visibilityState === "hidden") cloudAutosync(); };
        document.addEventListener("visibilitychange", onHide);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onHide);
            cloudAutosync(); // last push when leaving the editor
        };
    }, [user, cloudAutosync]);

    // Opening the panel recomputes scenes (cheap) and freshens stale thumbs.
    const openScenesPanel = () => {
        setScenesOpen((o) => {
            if (!o) {
                const E = engine.engineRef.current;
                if (E) {
                    const list = E.refreshScenes();
                    setScenes(list);
                    setSceneThumbs(loadThumbs(realId, list.map((s) => s.id)));
                    ensureThumbs(E.serializeDrawing(), list);
                }
            }
            return !o;
        });
        setHintDismissed(true);
    };

    const jumpToScene = (s) => {
        engine.engineRef.current?.jumpTo(s.level, s.rect);
        setScenesOpen(false);
    };
    const commitSceneRename = () => {
        if (!sceneRename) return;
        const E = engine.engineRef.current;
        if (E && E.renameScene(sceneRename.id, sceneRename.draft)) {
            setScenes([...E.docMeta.scenes]);
            persistCanvas();
        }
        setSceneRename(null);
    };
    const removeScene = (s) => {
        const E = engine.engineRef.current;
        if (E && E.deleteScene(s.id)) {
            setScenes([...E.docMeta.scenes]);
            persistCanvas();
        }
    };
    const splitSceneRow = (s) => {
        const E = engine.engineRef.current;
        const children = E && E.splitScene(s.id);
        if (!children) { showToast("Nothing to split here"); return; }
        setScenes([...E.docMeta.scenes]);
        persistCanvas();
    };
    const captureCurrentView = () => {
        const E = engine.engineRef.current;
        if (!E) return;
        const r = E.captureView();
        setScenes([...E.docMeta.scenes]);
        persistCanvas();
        showToast(r.retargeted ? `Reframed "${r.scene.name}"` : "View captured");
    };

    // Presence heartbeat: while a signed-in cloud canvas is open in a visible
    // tab, stamp `editing` on its parent doc every 30s and watch for a fresh
    // stamp from a DIFFERENT device — that shows the overwrite warning banner.
    useEffect(() => {
        if (!user || !engine.engineReady) return;
        const device = getDeviceId();
        const FRESH_MS = 2 * 60 * 1000; // ~4 missed beats before the banner clears
        let stopped = false;
        const beat = async () => {
            if (stopped || document.visibilityState !== "visible") return;
            try {
                const meta = await cloudGetCanvasMeta(user.uid, realId);
                if (stopped || !meta) return; // not in the cloud (yet) — nothing to guard
                const e = meta.editing;
                setRemoteEditing(!!(e && e.device && e.device !== device
                    && Date.now() - Date.parse(e.at) < FRESH_MS));
                await cloudSetEditing(user.uid, realId, device);
            } catch (err) { /* offline — try again next beat */ }
        };
        beat();
        const timer = setInterval(beat, 30000);
        return () => {
            stopped = true;
            clearInterval(timer);
            cloudClearEditing(user.uid, realId, device).catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, engine.engineReady, realId]);

    // Browser closed (or tab killed) on a never-saved drawing: file it as a
    // draft so the gallery lists it instead of stranding it in a hidden slot.
    // In-app exits go through the keep/discard dialog instead.
    useEffect(() => {
        const fileDraft = () => {
            try {
                if (readIndex().some((e) => e.id === realId)) return;
                const E = engine.engineRef.current;
                if (!E) return;
                const doc = E.serializeDrawing();
                const stats = statsFromDoc(doc);
                if (stats.strokes === 0) return;
                const nm = doc.meta && doc.meta.name;
                upsertIndexEntry({
                    id: realId,
                    name: (nm && nm !== "untitled" ? nm : null) || "Untitled canvas",
                    savedAt: new Date().toISOString(),
                    ...stats,
                });
            } catch (err) { /* best-effort */ }
        };
        window.addEventListener("beforeunload", fileDraft);
        return () => window.removeEventListener("beforeunload", fileDraft);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [realId]);

    // Pull from the account once the engine is up — when this browser has no
    // copy, OR when the cloud copy is fresher than the local one (edited on
    // another device since; freshest-wins now that autosave bumps savedAt).
    useEffect(() => {
        if (!engine.engineReady || !user) return;
        let stale = false;
        (async () => {
            try {
                const localRaw = loadCanvasRaw(realId);
                if (localRaw) {
                    const meta = await cloudGetCanvasMeta(user.uid, realId);
                    const localAt = readIndex().find((e) => e.id === realId)?.savedAt || "";
                    if (!meta || String(meta.savedAt || "") <= String(localAt)) return;
                }
                const res = await cloudLoadCanvas(user.uid, realId);
                if (stale || !res || !res.json) return;
                const parsed = JSON.parse(res.json);
                // Never replace a local drawing with an empty cloud copy (the
                // stale-cloud shape of the bug this pull is here to fix).
                if (localRaw && statsFromDoc(parsed).strokes === 0) return;
                // A competing save is about to overwrite real local work —
                // file this device's version in the recycle bin (restorable
                // via "Restore deleted canvases"). Metadata-only refreshes
                // (e.g. a rename elsewhere) don't clutter the bin.
                if (localRaw) {
                    try {
                        const localParsed = JSON.parse(localRaw);
                        if (statsFromDoc(localParsed).strokes > 0
                            && JSON.stringify(localParsed.natives) !== JSON.stringify(parsed.natives)) {
                            const entry = readIndex().find((e) => e.id === realId);
                            stashOverwrittenVersion(localRaw,
                                (entry && entry.name)
                                || (localParsed.meta && localParsed.meta.name !== "untitled" && localParsed.meta.name)
                                || "Untitled canvas");
                        }
                    } catch (err) { /* unparseable local — the .bak below still covers it */ }
                }
                backupCanvasSlot(realId); // recoverable if this merge was wrong
                engine.engineRef.current.loadDrawing(parsed);
                // Gallery renames only touch the cloud parent doc — its name
                // outranks whatever is embedded in the drawing JSON.
                const cloudName = res.meta && res.meta.name;
                if (cloudName && cloudName !== "untitled") engine.patchDocMeta({ name: cloudName });
                const doc = await engine.saveToLocalStorage();
                if (doc) {
                    const nm2 = doc.meta && doc.meta.name;
                    upsertIndexEntry({
                        id: realId,
                        name: (nm2 && nm2 !== "untitled" ? nm2 : null) || "Untitled canvas",
                        savedAt: new Date().toISOString(),
                        ...statsFromDoc(doc),
                    });
                }
                if (res.thumbs) saveThumbs(realId, res.thumbs);
                const nm = engine.docMeta()?.name;
                if (nm && nm !== "untitled") setCanvasTitle(nm);
            } catch (err) { /* offline or not ours — stay blank */ }
        })();
        return () => { stale = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.engineReady, user, realId]);

    const commitScaleDef = (def) => {
        const valid = validateScaleDef(def);
        if (!valid) return;
        setScaleDef(valid);
        // Redefining the scale resets all display preferences (L9).
        setScaleSession(clearDisplayPrefs(null, valid));
        engine.patchDocMeta({ scaleDef: valid });
    };

    const clearScaleDef = () => {
        setScaleDef(null);
        setScaleSession(null);
        engine.patchDocMeta({ scaleDef: null });
    };

    const hudBundle = useMemo(() => {
        if (!scaleDef || !scaleSession) return null;
        // Absolute resolve at the target zoom on the sticky session (L1/L8).
        // Persist returned session (userBand teardown I-02 + incumbent/lastReading).
        const { reading, session: nextSession } = computeScale(
            engine.status.effectiveZoom,
            scaleDef,
            scaleSession,
        );
        if (!reading) return null;
        return { reading, nextSession, sourceSession: scaleSession };
    }, [scaleDef, scaleSession, engine.status.effectiveZoom]);

    // Write back computeScale session so clearUserBandIfExited sticks (ZS-01 / UP3).
    // A6: skip stale unbanded next when live s already holds a fresher band.
    useEffect(() => {
        if (!hudBundle?.nextSession) return;
        const next = hudBundle.nextSession;
        const sourceSession = hudBundle.sourceSession;
        setScaleSession((s) => {
            if (!s) return s;
            if (!shouldApplyScaleSessionWriteBack(s, next, { sourceSession })) {
                return s;
            }
            const sameBand =
                (!s.userBand && !next.userBand) ||
                (s.userBand &&
                    next.userBand &&
                    s.userBand.unit === next.userBand.unit &&
                    s.userBand.logLo === next.userBand.logLo &&
                    s.userBand.logHi === next.userBand.logHi);
            if (
                s.ladderId === next.ladderId &&
                s.incumbentUnit === next.incumbentUnit &&
                sameBand &&
                s.lastReading?.unit === next.lastReading?.unit &&
                s.lastReading?.value === next.lastReading?.value
            ) {
                return s;
            }
            return next;
        });
    }, [hudBundle]);

    const hud = hudBundle?.reading ?? null;
    const scaleLabel = hud
        ? formatScaleLabel(hud)
        : zoomLabel(engine.status.effectiveZoom);

    const startRename = () => {
        setNameDraft(canvasTitle);
        setEditingName(true);
    };

    const commitRename = async () => {
        const trimmed = nameDraft.trim() || "Untitled canvas";
        engine.patchDocMeta({ name: trimmed });
        setCanvasTitle(trimmed);
        setEditingName(false);
        await persistCanvas(trimmed);
    };

    const showToast = (msg) => setToast(msg);

    const saveToastFor = (r) =>
        !r.local ? "Couldn't save — storage may be full"
        : !user ? "Saved to browser"
        : r.cloud ? "Saved to your account"
        : "Saved here — cloud sync failed";

    // Save button: an already-named canvas saves straight away; the name
    // dialog only appears for the first save of an untitled canvas.
    const handleSave = async () => {
        if (!canvasTitle || canvasTitle === "Untitled canvas") {
            setSaveOpen(true);
            return;
        }
        const r = await persistCanvas(canvasTitle);
        showToast(saveToastFor(r));
    };

    // Delete = move to the recycle bin (local trash + cloud tombstone), then
    // back to the gallery. Persistence is disabled FIRST so the engine's
    // unmount autosave can't recreate the slot, and the dirty flag cleared so
    // the unmount autosync can't re-push the cloud copy.
    const deleteCanvas = async () => {
        const doc = await engine.saveToLocalStorage(); // freshest strokes ride into the bin
        engine.disablePersist();
        cloudDirtyRef.current = false;
        const stats = doc ? statsFromDoc(doc) : { strokes: 0, levels: 0 };
        const indexed = readIndex().some((e) => e.id === realId);
        if (!indexed && stats.strokes === 0) {
            // Never-saved empty scratch — nothing worth a recycle-bin row.
            removeCanvas(realId);
        } else {
            trashCanvas(realId, {
                id: realId,
                name: canvasTitle,
                savedAt: new Date().toISOString(),
                ...stats,
            });
        }
        setDeleteOpen(false);
        if (user) {
            try { await cloudTrashCanvas(user.uid, realId); }
            catch (err) { console.warn("cloud delete failed", err); }
        }
        // The gallery shows a "Canvas deleted — Undo" toast for binned deletes
        // (empty scratch just vanishes — there's nothing to undo).
        if (!indexed && stats.strokes === 0) history.push("/canvases");
        else history.push({ pathname: "/canvases", state: { deleted: { id: realId, name: canvasTitle } } });
    };

    // Unsaved canvases (no gallery entry yet) don't silently vanish: leaving
    // via Home asks keep-as-draft vs discard, and an unexpected browser close
    // files the drawing as a draft automatically (beforeunload effect below).
    const hasUnsavedDraft = () => {
        if (readIndex().some((e) => e.id === realId)) return false;
        const E = engine.engineRef.current;
        if (!E) return false;
        try { return statsFromDoc(E.serializeDrawing()).strokes > 0; } catch (err) { return false; }
    };
    const onLeaveEditor = (e) => {
        if (!hasUnsavedDraft()) return; // saved or empty — navigate normally
        e.preventDefault();
        setLeaveOpen(true);
    };
    const keepDraft = async () => {
        const doc = await engine.saveToLocalStorage();
        upsertIndexEntry({
            id: realId,
            name: canvasTitle || "Untitled canvas",
            savedAt: new Date().toISOString(),
            ...(doc ? statsFromDoc(doc) : {}),
        });
        setLeaveOpen(false);
        history.push("/canvases");
    };
    const discardDraft = () => {
        engine.disablePersist();
        removeCanvas(realId);
        setLeaveOpen(false);
        history.push("/canvases");
    };

    const duplicateCurrent = async () => {
        await engine.saveToLocalStorage(); // freshest strokes ride into the copy
        const entry = duplicateCanvas(realId, null, canvasTitle);
        if (!entry) { showToast("Couldn't duplicate — storage may be full"); return; }
        history.push(`/canvas/${entry.id}`); // editor remounts on the copy
    };

    const selectTool = (t) => {
        if (t.action) { t.action(engine); return; }
        if (DRAW_TOOL_IDS.has(t.id) && activeTool === t.id) {
            setSizeOpen((o) => !o);
            setColorOpen(false);
            return;
        }
        setSizeOpen(false);
        setActiveTool(t.id);
        if (t.tool) engine.setTool(t.tool);
        else if (t.penType) {
            engine.pickPen(t.penType);
            if (t.width != null) engine.setWidth(t.width);
        }
    };

    sizeAnchorRef.current = DRAW_TOOL_IDS.has(activeTool)
        ? (drawToolRefs.current[activeTool] ?? null)
        : null;

    const rel = (e) => {
        const r = editorRef.current.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDefineDown = (e) => {
        if (!defineMode || e.button !== 0) return;
        const p = rel(e);
        setDragStart(p);
        setDragEnd(p);
        // The pointer can already be gone (rapid tap-release) — capture is
        // best-effort; the window-level move/up handlers still track the drag.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer */ }
        e.preventDefault();
    };
    const onDefineMove = (e) => {
        if (!defineMode || !dragStart) return;
        setDragEnd(rel(e));
    };
    const onDefineUp = () => {
        if (!defineMode || !dragStart || !dragEnd) return;
        const px = Math.hypot(dragEnd.x - dragStart.x, dragEnd.y - dragStart.y);
        if (px >= MIN_DRAG_PX) setPendingBar({ a: dragStart, b: dragEnd, px });
        setDragStart(null);
        setDragEnd(null);
        setDefineMode(false);
    };
    const onDefineWheel = (e) => {
        e.preventDefault();
        const E = engine.engineRef.current;
        if (!E || !editorRef.current) return;
        const r = editorRef.current.getBoundingClientRect();
        E.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY);
    };

    const liveBar = defineMode && dragStart && dragEnd
        ? { a: dragStart, b: dragEnd }
        : null;

    const dbgBtn = (active) => ({ className: `bl-dev-btn${active ? " active" : ""}` });

    return (
        <div className="bl-editor" ref={editorRef}>
            <div
                ref={engine.hostRef}
                className="bl-editor-host"
                style={{ cursor: defineMode ? "crosshair" : engine.cursor }}
                onPointerDownCapture={() => {
                    // The engine preventDefaults pointerdown, which suppresses the
                    // native blur — so returning to the drawing mid-rename would
                    // otherwise leave the title input stuck open (esp. on phones).
                    if (editingName) document.activeElement?.blur();
                }}
            />

            {defineMode && (
                <div
                    className="bl-scale-define-overlay"
                    onPointerDown={onDefineDown}
                    onPointerMove={onDefineMove}
                    onPointerUp={onDefineUp}
                    onPointerCancel={onDefineUp}
                    onWheel={onDefineWheel}
                />
            )}
            {defineMode && (
                <div className="bl-scale-define-banner">Drag across something whose length you know</div>
            )}
            {liveBar && <ScaleDragBar a={liveBar.a} b={liveBar.b} label="drag…" />}
            {pendingBar && <ScaleDragBar a={pendingBar.a} b={pendingBar.b} label="?" dashed={false} />}

            <div className="bl-editor-overlay bl-editor-top-left bl-flex bl-gap-2">
                <Link to="/canvases" onClick={onLeaveEditor}>
                    <Button variant="outline" size="icon" className="bl-shadow-panel" title="Back to canvases">
                        <Home size={16} />
                    </Button>
                </Link>
                <div className="bl-editor-chip bl-editor-title-chip">
                    {editingName ? (
                        <input
                            className="bl-title-input"
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                                if (e.key === "Escape") setEditingName(false);
                            }}
                            aria-label="Canvas name"
                            autoFocus
                        />
                    ) : (
                        <button type="button" className="bl-title-btn" onClick={startRename} title="Rename canvas">
                            <span className="bl-font-display bl-text-sm bl-title-text">{canvasTitle}</span>
                        </button>
                    )}
                </div>
            </div>

            <div className="bl-editor-overlay bl-editor-top-right">
                <div className="bl-editor-top-right-group">
                    <div className="bl-scenes-anchor">
                        <Button
                            size="sm"
                            variant={scenesOpen ? "default" : "outline"}
                            className="bl-shadow-panel bl-flex bl-gap-2"
                            onClick={openScenesPanel}
                        >
                            <Layers size={16} /> Scenes
                        </Button>
                        {scenesOpen && (
                            <div className="bl-scenes-panel">
                                <div className="bl-flex bl-items-center bl-justify-between" style={{ marginBottom: "0.5rem" }}>
                                    <p className="bl-text-xs bl-uppercase bl-text-muted" style={{ fontWeight: 600 }}>
                                        Scenes in this canvas
                                    </p>
                                    <button type="button" className="bl-tool-btn" onClick={() => setScenesOpen(false)} aria-label="Close scenes">
                                        <X size={14} />
                                    </button>
                                </div>
                                <div className="bl-flex bl-flex-col bl-gap-2" style={{ maxHeight: "16rem", overflowY: "auto", overflowX: "hidden" }}>
                                    {scenes.length === 0 && (
                                        <p className="bl-text-xs bl-text-muted" style={{ padding: "0.25rem 0" }}>
                                            Draw something — scenes are found automatically.
                                        </p>
                                    )}
                                    {scenes.map((s) => (
                                        <div key={s.id} className={`bl-scene-item${s.depth ? " bl-scene-item--nested" : ""}`}>
                                            {sceneRename?.id === s.id ? (
                                                /* While renaming, the row must NOT be a button — a
                                                   selection-drag releasing outside the input would
                                                   otherwise fire the jump and close the panel. */
                                                <div className="bl-scene-jump">
                                                    {sceneThumbs[s.id]?.data
                                                        ? <img src={sceneThumbs[s.id].data} alt={s.name} className="bl-scene-thumb" />
                                                        : <div className="bl-scene-thumb bl-scene-thumb-placeholder" />}
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <input
                                                            className="bl-scene-name-input"
                                                            value={sceneRename.draft}
                                                            onChange={(e) => setSceneRename({ id: s.id, draft: e.target.value })}
                                                            onBlur={commitSceneRename}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter") { e.preventDefault(); commitSceneRename(); }
                                                                if (e.key === "Escape") setSceneRename(null);
                                                            }}
                                                            aria-label="Scene name"
                                                            autoFocus
                                                        />
                                                        <p className="bl-text-xs bl-text-muted">
                                                            at <SciText text={zoomLabel(engine.engineRef.current?.sceneZoom(s) ?? 1)} />
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button type="button" className="bl-scene-jump" onClick={() => jumpToScene(s)}>
                                                    {sceneThumbs[s.id]?.data
                                                        ? <img src={sceneThumbs[s.id].data} alt={s.name} className="bl-scene-thumb" />
                                                        : <div className="bl-scene-thumb bl-scene-thumb-placeholder" />}
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <p className="bl-truncate bl-text-sm" style={{ fontWeight: 500 }}>{s.name}</p>
                                                        <p className="bl-text-xs bl-text-muted">
                                                            at <SciText text={zoomLabel(engine.engineRef.current?.sceneZoom(s) ?? 1)} />
                                                        </p>
                                                    </div>
                                                </button>
                                            )}
                                            <div className="bl-scene-actions">
                                                <button type="button" className="bl-tool-btn bl-scene-action" title="Rename scene"
                                                    onClick={() => setSceneRename({ id: s.id, draft: s.name })}>
                                                    <Pencil size={13} />
                                                </button>
                                                <button type="button" className="bl-tool-btn bl-scene-action" title="Split scene"
                                                    onClick={() => splitSceneRow(s)}>
                                                    <Scissors size={13} />
                                                </button>
                                                <button type="button" className="bl-tool-btn bl-scene-action" title="Remove scene"
                                                    onClick={() => removeScene(s)}>
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button type="button" className="bl-scene-bookmark" onClick={captureCurrentView}>
                                    <Bookmark size={14} /> Capture this view
                                </button>
                            </div>
                        )}
                    </div>
                    {devUnlocked && (
                        <button type="button" className="bl-dev-btn bl-shadow-panel" onClick={() => setDevOpen(!devOpen)} title="Developer tools">
                            Dev
                        </button>
                    )}
                </div>
                {devUnlocked && devOpen && (
                    <div className="bl-dev-panel">
                        <div><b>LEVEL:</b> {engine.status.level}</div>
                        <div><b>zoom:</b> <SciText text={zoomLabel(engine.status.effectiveZoom)} /></div>
                        <div><b>inScale:</b> {engine.status.inScale.toFixed(3)}</div>
                        <div><b>objects:</b> {engine.status.objects}</div>
                        <div style={{ marginTop: 6 }}>
                            <button {...dbgBtn(engine.opGroups)} onClick={() => engine.setOpGroups(!engine.opGroups)}>αSeam</button>
                            <button {...dbgBtn(engine.preBake)} onClick={() => engine.setPreBake(!engine.preBake)}>PreBake</button>
                            <button {...dbgBtn(engine.retainScenes)} onClick={() => engine.setRetainScenes(!engine.retainScenes)}>Retain</button>
                            <button {...dbgBtn(false)} onClick={engine.sendReport}>{engine.reportLabel}</button>
                        </div>
                    </div>
                )}
            </div>

            <div className="bl-editor-overlay bl-editor-left">
                {toolsOpen ? (
                    <div className="bl-tool-rail">
                        <div className="bl-tool-rail-body">
                            {TOOL_SECTIONS.map((section, si) => (
                                <div key={section.id} className="bl-tool-section">
                                    {si > 0 && <div className="bl-tool-divider" />}
                                    {section.items.map((t) => (
                                        <button
                                            key={t.id}
                                            ref={(el) => {
                                                if (DRAW_TOOL_IDS.has(t.id)) drawToolRefs.current[t.id] = el;
                                            }}
                                            type="button"
                                            title={t.label}
                                            className={`bl-tool-btn${activeTool === t.id ? " active" : ""}`}
                                            onClick={() => selectTool(t)}
                                        >
                                            <t.icon size={16} />
                                        </button>
                                    ))}
                                </div>
                            ))}
                            <div className="bl-tool-section bl-tool-section--colors" ref={colorSectionRef}>
                                <div className="bl-tool-divider" />
                                <div className="bl-swatch-grid">
                                    {SWATCHES.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            aria-label={`Color ${c}`}
                                            className={`bl-swatch${engine.color === c ? " active" : ""}`}
                                            style={{ backgroundColor: c }}
                                            onClick={() => engine.setColor(c)}
                                        />
                                    ))}
                                </div>
                                <button
                                    ref={paletteAnchorRef}
                                    type="button"
                                    className="bl-tool-btn"
                                    title="Custom color"
                                    onClick={() => { setColorOpen((o) => !o); setSizeOpen(false); }}
                                >
                                    <Palette size={16} />
                                </button>
                            </div>
                            <div className="bl-tool-section">
                                <div className="bl-tool-divider" />
                                <button type="button" className="bl-tool-btn"
                                    title={user ? "Save to cloud" : "Save to browser"} onClick={handleSave}>
                                    <Save size={16} />
                                </button>
                                <div className="bl-popover-anchor" ref={fileAnchorRef}>
                                    <button type="button" className="bl-tool-btn" title="Canvas actions" onClick={() => setFileOpen((o) => !o)}>
                                        <MoreVertical size={16} />
                                    </button>
                                    {fileOpen && (
                                        <FileActionsMenu
                                            onDownload={() => engine.saveDrawing(canvasTitle)}
                                            onOpenFile={() => fileRef.current?.click()}
                                            onExportSvg={engine.exportSvg}
                                            onDuplicate={duplicateCurrent}
                                            onDelete={() => setDeleteOpen(true)}
                                            onClose={() => setFileOpen(false)}
                                            anchorRef={fileAnchorRef}
                                        />
                                    )}
                                </div>
                                <button type="button" className="bl-tool-btn" title="Minimize tools" onClick={() => setToolsOpen(false)}>
                                    <ChevronLeft size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <button type="button" className="bl-tool-rail bl-tool-btn" style={{ width: "2.5rem", height: "2.5rem" }}
                        onClick={() => setToolsOpen(true)} title="Show tools">
                        <ChevronRight size={16} />
                    </button>
                )}
            </div>

            {colorOpen && (
                <ColorPickerPopover
                    color={engine.color}
                    onChange={engine.setColor}
                    onClose={() => setColorOpen(false)}
                    anchorRef={paletteAnchorRef}
                    stayOpenRef={colorSectionRef}
                />
            )}
            {sizeOpen && (
                <WidthOpacityPanel
                    width={engine.width}
                    opacity={engine.opacity}
                    onWidthChange={engine.setWidth}
                    onOpacityChange={engine.setOpacity}
                    onClose={() => setSizeOpen(false)}
                    anchorRef={sizeAnchorRef}
                    layoutKey={activeTool}
                />
            )}

            <div className="bl-editor-overlay bl-editor-bottom-right bl-scale-controls">
                {scaleDef && (
                    <Button variant="ghost" size="sm" className="bl-text-muted" onClick={clearScaleDef}>Clear</Button>
                )}
                <Button variant="outline" size="sm" className="bl-shadow-panel bl-flex bl-gap-2"
                    onClick={() => { setPendingBar(null); setDefineMode(true); }} title="Define scale by dragging">
                    <Ruler size={14} /> Set scale
                </Button>
                <div className="bl-scale-hud" ref={scaleHudRef}>
                    <div className="bl-scale-bar" style={{ width: hud ? hud.barPx : BAR_PX_TARGET }} />
                    {scaleDef ? (
                        <button
                            ref={scaleLabelRef}
                            type="button"
                            className="bl-text-xs bl-scale-label bl-scale-label-btn"
                            onClick={() => setUnitPickerOpen((v) => !v)}
                            title="Change unit"
                        >
                            <SciText text={scaleLabel} />
                        </button>
                    ) : (
                        <span className="bl-text-xs bl-scale-label"><SciText text={scaleLabel} /></span>
                    )}
                </div>
            </div>

            {scaleDef && hud && (
                <ScaleUnitPicker
                    open={unitPickerOpen}
                    onOpenChange={setUnitPickerOpen}
                    anchorRef={scaleHudRef}
                    currentUnit={hud.unit}
                    ladderId={scaleSession?.ladderId ?? hud.ladderId}
                    mpp={hud.metersPerPx}
                    session={scaleSession}
                    onPickUnit={(unit) => {
                        // L5–L7 / L12: preferred picks switch ladders; other
                        // picks install a user preferred range — no pins.
                        // Functional update so a pending write-back cannot
                        // supply a stale pre-pick session to applyUnitPick.
                        const mpp = hud.metersPerPx;
                        setScaleSession((s) => {
                            if (!s || !(mpp > 0)) return s;
                            const { session: next, reading } = applyUnitPick(
                                unit,
                                mpp,
                                s,
                            );
                            return reading
                                ? { ...next, lastReading: reading }
                                : next;
                        });
                        setUnitPickerOpen(false);
                    }}
                />
            )}

            {engine.status.selection && (
                <SelectionEditPanel
                    selection={engine.status.selection}
                    onColor={(c) => engine.restyleSelection({ color: c })}
                    onWidth={(v) => engine.restyleSelection({ widthPx: v })}
                    onOpacity={(v) => engine.restyleSelection({ opacity: v })}
                    onDelete={engine.deleteSelection}
                    onDone={engine.deselect}
                />
            )}

            {!hintDismissed && (
                <div className="bl-hint">Scroll or pinch to zoom — open Scenes to bookmark a view</div>
            )}

            {remoteEditing && !remoteBannerDismissed && (
                <div className="bl-remote-banner" role="alert">
                    <span>
                        “{canvasTitle}” is open on another device — please save and close on your
                        other device to avoid it overwriting your changes on this device. You can
                        restore your overwritten changes on the Your canvases page by clicking
                        “Restore deleted canvases”.
                    </span>
                    <button type="button" title="Dismiss" onClick={() => setRemoteBannerDismissed(true)}>
                        <X size={14} />
                    </button>
                </div>
            )}

            {toast && <div className="bl-toast">{toast}</div>}

            <input
                ref={fileRef}
                type="file"
                accept=".json,.boundless.json,application/json"
                style={{ display: "none" }}
                onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    if (!window.confirm(`Load "${f.name}"? Your current drawing will be replaced.`)) return;
                    try {
                        await engine.loadDrawingFile(f);
                        showToast("Drawing loaded");
                    } catch (err) {
                        window.alert("Couldn't load that file: " + (err?.message || err));
                    }
                }}
            />

            <ScaleValueDialog
                open={!!pendingBar}
                onOpenChange={(o) => { if (!o) setPendingBar(null); }}
                value={scaleValue}
                setValue={setScaleValue}
                unit={scaleUnit}
                setUnit={setScaleUnit}
                ladderId={scaleSession?.ladderId ?? null}
                onSave={() => {
                    const parsed = parseFloat(scaleValue);
                    if (!pendingBar || isNaN(parsed) || parsed <= 0) return;
                    commitScaleDef({
                        value: parsed,
                        unit: scaleUnit,
                        barPx: pendingBar.px,
                        zoomAt: engine.status.effectiveZoom,
                    });
                    setPendingBar(null);
                    showToast("Scale set");
                }}
            />

            <SaveDrawingDialog
                open={saveOpen}
                onOpenChange={setSaveOpen}
                defaultName={canvasTitle}
                signedIn={!!user}
                onSave={async (name) => {
                    const r = await persistCanvas(name);
                    setCanvasTitle(name);
                    showToast(saveToastFor(r));
                }}
            />

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete canvas?</DialogTitle>
                        <DialogDescription>
                            “{canvasTitle}” moves to the recycle bin{user ? " (here and in your account)" : ""} —
                            restore it from the canvases page within 30 days.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                        <Button onClick={deleteCanvas}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Keep this drawing?</DialogTitle>
                        <DialogDescription>
                            This canvas hasn’t been saved. Keep it in your gallery as a draft, or discard it.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={discardDraft}>Discard</Button>
                        <Button onClick={keepDraft}>Keep draft</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ScaleValueDialog({ open, onOpenChange, value, setValue, unit, setUnit, ladderId, onSave }) {
    const parsed = parseFloat(value);
    const valid = !isNaN(parsed) && parsed > 0;
    const [moreLevel, setMoreLevel] = useState(0);

    useEffect(() => {
        if (!open) setMoreLevel(0);
    }, [open]);

    // Set-scale rungs 7a–7d (mm→mi ultra-standard first, then outward).
    const picker = setScaleUnits(moreLevel, { ladderId });

    return (
        <Dialog open={open} onOpenChange={onOpenChange} className="bl-dialog--scale">
            <DialogHeader>
                <DialogTitle>This length equals…</DialogTitle>
                <DialogDescription>
                    Enter what your dragged line represents in real-world units.
                </DialogDescription>
            </DialogHeader>
            <div className="bl-scale-form-row">
                <div className="bl-scale-field">
                    <label className="bl-label" htmlFor="scale-length">Length</label>
                    <Input id="scale-length" type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
                </div>
            </div>
            <div className="bl-scale-unit-picker-section">
                <label className="bl-label">Unit</label>
                <ScaleUnitButtonGrid
                    units={picker.units}
                    selected={unit}
                    onSelect={setUnit}
                    hasMore={picker.hasMore}
                    showFullTable={picker.showFullTable}
                    isFullCatalog={picker.isFullCatalog}
                    onMore={() => setMoreLevel(picker.nextMoreLevel)}
                />
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button disabled={!valid} onClick={onSave}>Set scale</Button>
            </DialogFooter>
        </Dialog>
    );
}
