import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useParams, useLocation, useHistory } from "react-router-dom";
import {
    Home, Layers, Pen, Pencil, Eraser, Highlighter,
    ChevronLeft, ChevronRight, X, Hand, MousePointer2, Slash,
    CircleOff, Undo2, Redo2, Palette, Save, MoreVertical,
} from "lucide-react";
import Button from "../Components/ui/Button";
import Input from "../Components/ui/Input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../Components/ui/Dialog";
import useKobinEngine, { zoomLabel } from "../hooks/useKobinEngine";
import {
    newCanvasId, upsertIndexEntry, statsFromDoc,
    loadThumbs, saveThumbs, readIndex, trashCanvas, removeCanvas, isBinnedStore,
    duplicateCanvas, getDeviceId, getDeviceName, replaceCanvasStore,
} from "../storage/localCanvases";
import useUser from "../cloud/useUser";
import { cloudGetCanvasMeta, cloudTrashCanvas, cloudLoadCanvas2, isDevBuild } from "../cloud/canvasSync";
import { CanvasSession, editorFromHook } from "../cloud/canvasSession";
import { SyncStatus, SyncBanner, showsNotice, useNarrow, useBannerClearance } from "../Components/editor/SyncChip";
import { EraseChip } from "../Components/editor/EraseChip";
import { validateScaleDef, setScaleUnits, MIN_DRAG_PX } from "../engine/scaleBar";
import { ScaleUnitButtonGrid } from "../Components/editor/ScaleUnitPicker";
import ScaleHud from "../Components/editor/ScaleHud";
import DevStats from "../Components/editor/DevStats";
import { LEVEL_STEPS, stretchBand, sigmaMinFor } from "../engine/raster/level";
import { LEVERS } from "../engine/devLevers";
import SciText from "../Components/ui/SciText";
import ColorPickerPopover from "../Components/editor/ColorPickerPopover";
import WidthOpacityPanel from "../Components/editor/WidthOpacityPanel";
import FileActionsMenu from "../Components/editor/FileActionsMenu";
import SaveDrawingDialog from "../Components/editor/SaveDrawingDialog";
import ScaleDragBar from "../Components/editor/ScaleDragBar";
import "../Stylesheets/boundless-ui.css";
import { renderThumbs, renderThumbsLive } from "../storage/thumbnails";

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
            { id: "undo", icon: Undo2, label: "Undo (Ctrl+Z)", action: (e) => e.undo(),
                live: (st) => st.canUndo },
            { id: "redo", icon: Redo2, label: "Redo (Ctrl+Y)", action: (e) => e.redo(),
                live: (st) => st.canRedo },
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
const TOOL_BY_ID = new Map(TOOL_SECTIONS.flatMap((s) => s.items).map((t) => [t.id, t]));

/**
 * The renderer levers (A3 §8; PLAN §1.2): the level step with the view's stretch band for this screen, the
 * plate budget, the rest render's quiet and inline switch, the compose path. Stored per device through the
 * hook (a URL parameter of the same name wins at load); until B-PYRAMID reads them they change no picture.
 */
function DevLevers({ engine, dbgBtn }) {
    const lv = engine.levers;
    const dpr = window.devicePixelRatio || 1;
    const band = stretchBand(lv.levelStep, sigmaMinFor(window.innerWidth * dpr, window.innerHeight * dpr));
    const num = (name, value, set) => {
        const L = LEVERS[name];
        return (
            <input type="number" min={L.min} max={L.max} value={value} style={{ width: 52 }}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= L.min && v <= L.max) set(v); }} />
        );
    };
    return (
        <div style={{ marginTop: 6 }} title="Renderer levers (A3 §8): stored for this device; a URL parameter of the same name wins at load. They change no picture until the pyramid lands.">
            <div>
                <b>levels</b>{LEVEL_STEPS.map((step) => (
                    <button key={step} {...dbgBtn(lv.levelStep === step)} onClick={() => engine.setLevelStep(step)}>{step === 1 ? "2×" : step === 2 ? "4×" : "8×"}</button>
                ))}
                <span> σ {band[0].toFixed(2)}–{band[1].toFixed(2)}</span>
            </div>
            <div>
                <b>plates</b> {num("plateViews", lv.plateViews, (v) => engine.setPlateBudget({ views: v }))} views ≤ {num("plateCeilingMiB", lv.plateCeilingMiB, (v) => engine.setPlateBudget({ ceilingMiB: v }))} MiB
            </div>
            <div>
                <b>rest</b> {num("restQuietMs", lv.restQuietMs, (v) => engine.setLevers({ restQuietMs: v }))} ms
                {LEVERS.restInline.values.map((v) => (
                    <button key={v} {...dbgBtn(lv.restInline === v)} onClick={() => engine.setLevers({ restInline: v })}>{v}</button>
                ))}
            </div>
            <div>
                <b>compose</b>{LEVERS.compose.values.map((v) => (
                    <button key={v} {...dbgBtn(lv.compose === v)} onClick={() => engine.setLevers({ compose: v })}>{v}</button>
                ))}
            </div>
        </div>
    );
}

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
    // ONE EDITOR AT A TIME (SYNC-PLAN): `CanvasSession` holds this canvas's device lock and cloud
    // lease, decides at open (push, pull, or keep both), pushes one push at a time with a backoff
    // shown in the save bar, follows another tab or device while read-only, and hands the pen over.
    // Every local write freshens the gallery entry (its savedAt is for display) and tells it.
    const sessionRef = useRef(null);
    const onAutosave = useCallback(({ name, stats, seq, data }) => {
        const entry = readIndex().find((e) => e.id === realId);
        if (entry) {
            upsertIndexEntry({
                ...entry,
                name: (name && name !== "untitled" ? name : null) || entry.name,
                savedAt: new Date().toISOString(),
                ...stats,
            });
        }
        if (sessionRef.current) sessionRef.current.onLocalSaved(seq, { data });
    }, [realId]);
    // Gated: read-only and not saving until the session holds the pen (SYNC-PLAN R2).
    const engine = useKobinEngine({
        canvasId: realId, onAutosave, gated: true,
        onRefused: (kind) => { if (sessionRef.current) sessionRef.current.onRefused(kind); },
    });
    const { user, ready: userReady } = useUser();
    // The session waits for sign-in to resolve, but not for ever: after 3 s it starts signed out
    // (and restarts if an account arrives later).
    const [authTimedOut, setAuthTimedOut] = useState(false);
    useEffect(() => { const t = setTimeout(() => setAuthTimedOut(true), 3000); return () => clearTimeout(t); }, []);
    const sessionReady = engine.engineReady && (userReady || authTimedOut);
    const engineApiRef = useRef(engine);
    engineApiRef.current = engine;
    // The cloud is behind whenever the document changed, whether or not the local write landed (a
    // full browser store must not stop the cloud push). A load's reset is not an edit.
    useEffect(() => {
        const E = engine.engineRef.current;
        if (!E) return undefined;
        return E.doc.subscribe((ev) => { if (!(ev.kind === "reset" && ev.load) && sessionRef.current) sessionRef.current.markDirty(); });
    }, [engine.engineReady, engine.engineRef]);
    const [sync, setSync] = useState(null);
    const [syncNotice, setSyncNotice] = useState(null);
    const [deviceName] = useState(() => getDeviceName());
    // A phone's width: the sync status is an icon, and the title chip stops short of the top-right
    // group, whose width the observer keeps in --bl-top-right-w.
    const narrow = useNarrow();
    const topRightRef = useRef(null);
    const [topRightW, setTopRightW] = useState(0);
    useEffect(() => {
        const el = topRightRef.current;
        if (!el || typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(() => setTopRightW(el.offsetWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // A failed push rides the save bar, keyed by its message for dismissal.
    const cloudError = sync && sync.cloud === "error" && sync.error ? { at: sync.error, message: sync.error } : null;
    // Read-only: another tab or device has the pen, or the cloud has not answered yet at open.
    const readOnly = !sync || sync.mode !== "editing";
    // Dev console handle for the cloud manifest, behind the same ?dev as the panel.
    useEffect(() => {
        if (!devUnlocked || !user) return undefined;
        window.__cloudMeta = () => cloudGetCanvasMeta(user.uid, realId);
        return () => { delete window.__cloudMeta; };
    }, [devUnlocked, user, realId]);
    // The dev Report's view of the cloud sync, and the strings it must never carry (OPEN-FLAGS F58).
    const reportCtx = (drawing) => ({
        drawing,
        secrets: user ? [user.uid, user.email, user.displayName, user.phoneNumber].filter(Boolean) : [],
        cloud: (() => {
            const ss = sessionRef.current;
            return {
                signedIn: !!user, dirty: !!(ss && ss.dirty), busy: !!(ss && ss.busy), fails: ss ? ss.fail.count : 0,
                retryInMs: ss ? Math.max(0, ss.fail.until - Date.now()) : 0, error: cloudError ? cloudError.message : null,
                mode: ss ? ss.state.mode : null, why: ss ? ss.state.why : null, state: ss ? ss.state.cloud : null,
            };
        })(),
    });
    const editorRef = useRef(null);
    useBannerClearance(editorRef);   // the sync banner under the top bar, the tool rail under the banner
    const fileRef = useRef(null);
    const colorSectionRef = useRef(null);
    const paletteAnchorRef = useRef(null);
    const drawToolRefs = useRef({});
    const sizeAnchorRef = useRef(null);
    const fileAnchorRef = useRef(null);

    const [toolsOpen, setToolsOpen] = useState(true);
    const [scenesOpen, setScenesOpen] = useState(false);
    const [scenes, setScenes] = useState([]);
    const [sceneThumbs, setSceneThumbs] = useState({});
    const [sceneRename, setSceneRename] = useState(null); // { id, draft }
    const scenesAbortRef = useRef(null);                     // cancels the live thumbnails when the panel closes
    const [activeTool, setActiveTool] = useState("pen");
    const [hintDismissed, setHintDismissed] = useState(false);
    const [toast, setToast] = useState(null);
    const [saveNoticeDismissed, setSaveNoticeDismissed] = useState(null);
    const [devOpen, setDevOpen] = useState(false);
    // DEV EXPERIMENT (2026-08-22). Every instrument says the main thread is idle
    // during the freezes — script 0 ms, render 0.3 ms, and input handlers
    // totalling ONE millisecond against 34.9 s spent waiting for pixels. So the
    // cost is in presentation, and the standing hypothesis is that at deep zoom
    // the SVG's layer bounds run to millions of pixels and Blink's layer /
    // invalidation machinery suffers for it. `contain: paint` bounds the layer
    // to the host's own box. If presentMs collapses with this on, that is the
    // answer; if it does not, the hypothesis is dead and we look elsewhere.
    const [clipHost, setClipHost] = useState(false);
    const [colorOpen, setColorOpen] = useState(false);
    const [sizeOpen, setSizeOpen] = useState(false);
    const [fileOpen, setFileOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [leaveOpen, setLeaveOpen] = useState(false);
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
    // The display session (sticky ladder L8, preferred range L5/L12, incumbent unit L2) is <ScaleHud>'s;
    // the scale dialog reads its ladder from here.
    const [hudLadderId, setHudLadderId] = useState(null);

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
        if (def) setScaleDef(def);   // <ScaleHud> starts a fresh session from its anchor unit (L9)
        const raw = engine.docMeta()?.name;
        setCanvasTitle(raw && raw !== "untitled" ? raw : "Untitled canvas");
    }, [engine.engineReady, canvasId]);

    // Regenerate thumbnails for scenes whose content hash changed; returns the
    // fresh entries (and folds them into state + localStorage).
    // renderThumbs builds a WHOLE SECOND ENGINE and loads the drawing into it,
    // then rasterizes one image per scene. It is far and away the most expensive
    // thing the editor does, and until 2026-08-21 it was invisible.
    // SCENES-PLAN S2: on the raster path the thumbnails come from the LIVE engine's workers, one
    // small job a scene, landing one by one; the old second-engine path serves only what that
    // cannot (raster off, an unreachable frame). `docFn` serialises the drawing lazily, for that.
    const ensureThumbs = async (list, docFn) => {
        const tThumb = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const noteThumbs = (n) => {
            try { engine.engineRef.current?.notePerf?.("thumbs", tThumb, { scenes: n }); }
            catch (err) { /* diagnostics must never break a save */ }
        };
        try {
            const existing = await loadThumbs(realId, list.map((s) => s.id));
            const E = engine.engineRef.current;
            let fresh = {}, missed = list;
            if (E && E.raster) {
                const live = await renderThumbsLive(E, list, existing, {
                    signal: scenesAbortRef.current ? scenesAbortRef.current.signal : null,
                    onThumb: (id, entry) => setSceneThumbs((t) => ({ ...t, [id]: entry })),
                });
                fresh = live.out; missed = live.missed;
            }
            // The second-engine path only under `?svg`: it serialises the whole document and
            // loads it into a second engine, which on the Magnum Opus is an out-of-memory
            // reload (Kobin, 2026-09-22). A raster miss keeps the scene's last picture.
            if (missed.length && !(E && E.raster)) {
                const doc = docFn ? docFn() : (E ? E.serializeDrawing() : null);
                if (doc) Object.assign(fresh, await renderThumbs(doc, missed, existing));
            }
            noteThumbs(Object.keys(fresh).length);
            // The primary scene (first in the list) doubles as the gallery
            // cover — alias its thumb under the "cover" key that the gallery
            // and the cloud thumbnail budget already prioritize.
            const primary = list[0];
            const primaryThumb = primary && (fresh[primary.id] || existing[primary.id]);
            if (primaryThumb && (!existing.cover || existing.cover.hash !== primaryThumb.hash)) {
                fresh.cover = primaryThumb;
            }
            if (Object.keys(fresh).length) {
                await saveThumbs(realId, fresh);
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
        const tSave = (typeof performance !== "undefined" ? performance.now() : Date.now());
        // The scene index rides the save as it stands (unindexed ids listed dirty): a save never waits on it.
        if (E) setScenes(E.docMeta.scenes || []);
        // A failed local write (a full browser store) must not stop the save to the account:
        // serialize independently and carry on.
        const saved = await engine.saveLocal(name);
        const local = !!saved;
        const doc = saved || (E ? E.serializeDrawing() : null);
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
        const fresh = await ensureThumbs(doc.meta.scenes || [], () => doc);
        if (E) E.notePerf?.("saveTotal", tSave, { scenes: (doc.meta.scenes || []).length });
        let cloud = false;
        const ss = sessionRef.current;
        if (user && ss) {
            const r = await ss.pushNow({ thumbs: Object.keys(fresh).length ? fresh : null });
            cloud = !!r.ok;
            if (r.busy) showToast("Saved to this browser — the cloud sync is still running");
        }
        return { local, cloud };
    };

    // The panel's refresh: the scene index's list (kept current at idle, SCENES-PLAN §7; with the
    // worker a refresh starts the next batch and a later tick shows it) and the pictures of the
    // scenes that changed, in the background. A list that did not change is not looked at again.
    const scenesListRef = useRef(null);
    const refreshScenesPanel = () => {
        const E = engine.engineRef.current;
        if (!E) return;
        const list = E.refreshScenes();
        if (list === scenesListRef.current) return;
        scenesListRef.current = list;
        setScenes(list);
        ensureThumbs(list);
    };
    // The scenes as stored and their cached pictures, with no resolve: what the panel opens on.
    const showStoredScenes = () => {
        const E = engine.engineRef.current;
        if (!E) return;
        const list = E.docMeta.scenes || [];
        setScenes(list);
        loadThumbs(realId, list.map((s) => s.id)).then((t) => setSceneThumbs((have) => ({ ...t, ...have })));
    };
    // Opening the panel shows the stored list at once and refreshes after it has painted; closing
    // it cancels the thumbnails in flight.
    const openScenesPanel = () => {
        setScenesOpen((o) => {
            if (!o) {
                if (scenesAbortRef.current) scenesAbortRef.current.abort();
                scenesAbortRef.current = typeof AbortController === "function" ? new AbortController() : null;
                showStoredScenes();
                scenesListRef.current = null;
                setTimeout(() => refreshScenesPanel(), 50);
            } else if (scenesAbortRef.current) { scenesAbortRef.current.abort(); scenesAbortRef.current = null; }
            return !o;
        });
        setHintDismissed(true);
    };
    // While the panel is open, a scene drawn into or moved refreshes about a second later (S4).
    useEffect(() => {
        if (!scenesOpen) return undefined;
        const t = setInterval(() => refreshScenesPanel(), 1000);
        return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scenesOpen]);

    const jumpToScene = (s) => {
        engine.engineRef.current?.jumpTo(s.level, s.rect);
        setScenesOpen(false);
    };
    const commitSceneRename = () => {
        if (!sceneRename) return;
        const E = engine.engineRef.current;
        if (E && E.renameScene(sceneRename.id, sceneRename.draft)) {
            setScenes([...E.docMeta.scenes]);
            engine.patchDocMeta({});   // the name rides the header: an autosave writes it, not a whole Save (ST-2)
        }
        setSceneRename(null);
    };

    // After a reload from the store or a pull, the title and the scale come from the document again;
    // a gallery rename touches only the cloud's name, which outranks the one in the drawing.
    const scaleDefRef = useRef(null);
    scaleDefRef.current = scaleDef;
    const afterReload = (cloudName) => {
        const E = engine.engineRef.current;
        if (!E) return;
        if (cloudName && cloudName !== "untitled" && E.docMeta.name !== cloudName) engine.patchDocMeta({ name: cloudName });
        const raw = E.docMeta && E.docMeta.name;
        setCanvasTitle(raw && raw !== "untitled" ? raw : "Untitled canvas");
        const def = validateScaleDef(E.docMeta && E.docMeta.scaleDef);
        if (JSON.stringify(def || null) !== JSON.stringify(scaleDefRef.current || null)) setScaleDef(def || null);
    };
    // The session starts once the document is restored and sign-in has resolved (SYNC-PLAN R2, R4).
    useEffect(() => {
        if (!sessionReady) return undefined;
        let live = true;
        const ss = new CanvasSession({
            canvasId: realId, uid: user ? user.uid : null, deviceId: getDeviceId(), deviceName: getDeviceName(),
            editor: editorFromHook(() => engineApiRef.current),
            onState: (st) => { if (live) setSync(st); },
            onNotice: (n) => {
                if (!live) return;
                if (n.kind === "pulled" || n.kind === "reloaded") afterReload(n.name);
                else if (showsNotice(n)) setSyncNotice({ ...n, at: Date.now() });
            },
            onPerf: (kind, t0, data) => {
                try { const E = engineApiRef.current.engineRef.current; if (E && E.notePerf) E.notePerf(kind, t0, data); } catch (err) { /* diagnostics only */ }
            },
        });
        sessionRef.current = ss;
        if (devUnlocked) window.__kobinSync = ss;
        ss.start();
        const onVis = () => ss.onVisibility(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", onVis);
        return () => {
            live = false;
            document.removeEventListener("visibilitychange", onVis);
            if (sessionRef.current === ss) sessionRef.current = null;
            if (window.__kobinSync === ss) delete window.__kobinSync;
            ss.stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionReady, user, realId]);
    // R7: a canvas from the REAL collection copied in as a new canvas (a dev build reads it, never writes it).
    const copyRealIn = async () => {
        if (!user) { showToast("Sign in first"); return; }
        const id0 = window.prompt("Copy which canvas from the real cloud? (its id)", realId);
        if (!id0) return;
        try {
            const pulled = await cloudLoadCanvas2(user.uid, id0.trim(), { real: true });
            if (!pulled) { showToast("No kobin-2 copy of that canvas in the real cloud"); return; }
            const id = newCanvasId();
            const name = `${pulled.meta.name || "Untitled canvas"} (real copy)`;
            const header = { ...pulled.header, name, meta: { ...(pulled.header.meta || {}), name }, base: null };
            if (!(await replaceCanvasStore(id, { header, frames: pulled.frames, entries: pulled.entries }))) { showToast("Couldn't store the copy"); return; }
            upsertIndexEntry({ id, name, savedAt: new Date().toISOString(), strokes: pulled.header.strokes || 0, levels: pulled.header.levels || 0 });
            if (pulled.thumbs) await saveThumbs(id, pulled.thumbs);
            history.push(`/canvas/${id}${location.search}`);
        } catch (err) {
            showToast("Couldn't copy: " + String((err && err.message) || err).slice(0, 60));
        }
    };

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


    const commitScaleDef = (def) => {
        const valid = validateScaleDef(def);
        if (!valid) return;
        setScaleDef(valid);   // a new definition resets the display preferences, in <ScaleHud> (L9)
        engine.patchDocMeta({ scaleDef: valid });
    };

    const clearScaleDef = () => {
        setScaleDef(null);
        engine.patchDocMeta({ scaleDef: null });
    };

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

    // The save notice is dismissible, but dismissal is keyed to WHAT it says —
    // not to the bar. Waving away "autosave is off" must not also silence a
    // real save failure that happens afterwards, which would rebuild the exact
    // silent-data-loss trap the bar exists to close (F33).
    // The cloud's failure rides the same bar when the local store is fine; a
    // local failure outranks it (nothing is saved anywhere then).
    const saveNotice = engine.saveError || cloudError;
    const saveNoticeKind = !saveNotice ? null
        : saveNotice.off ? "off"
        : saveNotice.quota ? "quota"
        : saveNotice === cloudError ? "cloud:" + cloudError.at : "fail";
    const showSaveBar = !!saveNotice && saveNoticeDismissed !== saveNoticeKind;

    // The cloud can now succeed while the local write fails, so "did it save?"
    // is no longer answered by `local` alone.
    const saveToastFor = (r) =>
        r.cloud ? (r.local ? "Saved to your account"
            : "Saved to your account — this browser's storage is full")
        : !r.local ? "Couldn't save — storage may be full"
        : !user ? "Saved to browser"
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
        const doc = await engine.saveLocal(); // freshest strokes ride into the bin
        engine.disablePersist();
        if (sessionRef.current) sessionRef.current.discard();
        const stats = doc ? statsFromDoc(doc) : { strokes: 0, levels: 0 };
        const indexed = readIndex().some((e) => e.id === realId);
        if (!indexed && stats.strokes === 0) {
            // Never-saved empty scratch — nothing worth a recycle-bin row.
            await removeCanvas(realId);
        } else {
            await trashCanvas(realId, {
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
        if (readOnly) return false;                   // another tab's draft: not this tab's to keep or discard
        if (readIndex().some((e) => e.id === realId)) return false;
        if (isBinnedStore(realId)) return false;      // deleted elsewhere while open: the bin has it, edits included
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
        const doc = await engine.saveLocal();
        upsertIndexEntry({
            id: realId,
            name: canvasTitle || "Untitled canvas",
            savedAt: new Date().toISOString(),
            ...(doc ? statsFromDoc(doc) : {}),
        });
        setLeaveOpen(false);
        history.push("/canvases");
    };
    const discardDraft = async () => {
        if (readOnly) return;
        engine.disablePersist();
        await removeCanvas(realId);
        setLeaveOpen(false);
        history.push("/canvases");
    };

    const duplicateCurrent = async () => {
        await engine.saveLocal(); // freshest strokes ride into the copy
        const entry = await duplicateCanvas(realId, null, canvasTitle);
        if (!entry) { showToast("Couldn't duplicate — storage may be full"); return; }
        history.push(`/canvas/${entry.id}`); // editor remounts on the copy
    };

    const selectTool = (t) => {
        if (t.action) { t.action(engine); return; }
        if ((DRAW_TOOL_IDS.has(t.id) || t.id === "eraser") && activeTool === t.id) {
            setSizeOpen((o) => !o); // draw tools: width/opacity; eraser: its size
            setColorOpen(false);
            return;
        }
        setSizeOpen(false);
        applyTool(t);
    };
    const applyTool = (t) => {
        setActiveTool(t.id);
        if (t.tool) engine.setTool(t.tool);
        else if (t.penType) {
            engine.pickPen(t.penType);
            if (t.width != null) engine.setWidth(t.width);
        }
    };

    // Viewing only: the pan tool and the rail collapsed (Kobin, 2026-09-23); taking the pen back
    // restores the tool and the rail as they were.
    const viewing = !!sync && sync.mode === "readonly";
    const editing = !!sync && sync.mode === "editing";
    const beforeViewRef = useRef(null);
    useEffect(() => {
        if (viewing && !beforeViewRef.current) {
            beforeViewRef.current = { tool: activeTool, open: toolsOpen };
            applyTool(TOOL_BY_ID.get("pan"));
            setToolsOpen(false);
        } else if (editing && beforeViewRef.current) {
            const b = beforeViewRef.current;
            beforeViewRef.current = null;
            const t = TOOL_BY_ID.get(b.tool);
            if (t) applyTool(t);
            setToolsOpen(b.open);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewing, editing]);

    sizeAnchorRef.current = (DRAW_TOOL_IDS.has(activeTool) || activeTool === "eraser")
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

    // The eraser's footprint ring follows the pointer via direct DOM writes —
    // a React state update per pointermove would re-render the whole editor.
    const eraserRingRef = useRef(null);
    const moveEraserRing = (e) => {
        const el = eraserRingRef.current;
        if (!el) return;
        const r = engine.eraserSize;
        el.style.transform = `translate(${e.clientX - r}px, ${e.clientY - r}px)`;
        el.style.opacity = "1";
    };
    const hideEraserRing = () => {
        if (eraserRingRef.current) eraserRingRef.current.style.opacity = "0";
    };

    return (
        <div className="bl-editor" ref={editorRef}
            onPointerMove={activeTool === "eraser" ? moveEraserRing : undefined}
            onPointerLeave={activeTool === "eraser" ? hideEraserRing : undefined}>
            <div
                ref={engine.hostRef}
                className="bl-editor-host"
                style={{ cursor: defineMode ? "crosshair" : engine.cursor,
                    ...(clipHost ? { contain: "paint" } : null) }}
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

            <div className="bl-editor-overlay bl-editor-top-left bl-flex bl-gap-2"
                style={topRightW ? { "--bl-top-right-w": `${topRightW}px` } : undefined}>
                <Link to="/canvases" onClick={onLeaveEditor}>
                    <Button variant="outline" size="icon" className="bl-shadow-panel" title="Back to canvases">
                        <Home size={16} />
                    </Button>
                </Link>
                <div className={"bl-editor-chip bl-editor-title-chip" + (narrow ? " bl-editor-title-chip--compact" : "")}>
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
                        <button type="button" className="bl-title-btn" onClick={startRename} title="Rename canvas" disabled={readOnly}>
                            <span className="bl-font-display bl-text-sm bl-title-text">{canvasTitle}</span>
                        </button>
                    )}
                    <SyncStatus sync={sync} signedIn={!!user} deviceName={deviceName} compact={narrow} />
                    <EraseChip erase={engine.status.erase} compact={narrow} />
                </div>
            </div>

            <div className="bl-editor-overlay bl-editor-top-right">
                <div className="bl-editor-top-right-group" ref={topRightRef}>
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
                                                        ? <img src={sceneThumbs[s.id].data} alt={s.name}
                                                            className={"bl-scene-thumb" + (sceneThumbs[s.id].hash !== (s.hash || "") ? " bl-scene-thumb--stale" : "")}
                                                            title={sceneThumbs[s.id].hash !== (s.hash || "") ? "Refreshing…" : undefined} />
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
                                                <button type="button" className="bl-tool-btn bl-scene-action" title="Rename scene" disabled={readOnly}
                                                    onClick={() => setSceneRename({ id: s.id, draft: s.name })}>
                                                    <Pencil size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
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
                            <button
                                {...dbgBtn(engine.raster)}
                                onClick={() => engine.setRaster(!engine.raster)}
                                title="Raster: draw the ink into 512 px plates on a canvas instead of into SVG. The renderer is built once, so this rewrites ?raster and RELOADS. Off is the SVG renderer, one keystroke away."
                            >Raster</button>
                            <button
                                {...dbgBtn(engine.trace)}
                                onClick={() => engine.setTrace(!engine.trace)}
                                title="Trace: log EVERY operation instead of only those over 8 ms, and keep a much deeper log. Off by default because one pinch would otherwise flood the log. Turn on, reproduce the problem, then Report."
                            >Trace</button>
                            <button
                                {...dbgBtn(clipHost)}
                                onClick={() => setClipHost(!clipHost)}
                                title="Clip: bound the canvas layer with CSS `contain: paint`. An experiment — at deep zoom the SVG's layer bounds reach millions of pixels, and this tests whether that is what stalls presentation. Reproduce with it OFF, then ON, and Report each time."
                            >Clip</button>
                            <button
                                {...dbgBtn(engine.erasedebug)}
                                onClick={() => engine.setErasedebug(!engine.erasedebug)}
                                title="Erase debug: a colour per real shape, orange outlines, GREEN where pieces are joined across a tile edge, black = temporary tile, yellow = eraser mark"
                            >Erase</button>
                            <button
                                {...dbgBtn(false)}
                                onClick={() => engine.sendReport(reportCtx(false))}
                                title="Report: the instruments, the recent history and the drawing on and around the screen, gzipped to the report server on :3001. Saved as a file if the server cannot be reached."
                            >{engine.reportLabel}</button>
                            <button
                                {...dbgBtn(false)}
                                onClick={() => engine.sendReport(reportCtx(true))}
                                title="Report with the WHOLE drawing after it, in gzip parts (tens of MB on a big canvas)."
                            >+Drawing</button>
                            {isDevBuild() && (
                                <button {...dbgBtn(false)} onClick={copyRealIn}
                                    title="Copy a canvas from the REAL cloud collection into this dev build as a new canvas. The real copy is only read; this build writes dev-canvases (SYNC-PLAN R7).">Copy real</button>
                            )}
                        </div>
                        {engine.levers && <DevLevers engine={engine} dbgBtn={dbgBtn} />}
                        <DevStats engineRef={engine.engineRef} />
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
                                                if (DRAW_TOOL_IDS.has(t.id) || t.id === "eraser") drawToolRefs.current[t.id] = el;
                                            }}
                                            type="button"
                                            title={t.label}
                                            className={`bl-tool-btn${activeTool === t.id ? " active" : ""}`}
                                            disabled={(readOnly && t.id !== "pan") || (t.live ? !t.live(engine.status) : false)}
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
                                            disabled={readOnly}
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
                                    disabled={readOnly}
                                    onClick={() => { setColorOpen((o) => !o); setSizeOpen(false); }}
                                >
                                    <Palette size={16} />
                                </button>
                            </div>
                            <div className="bl-tool-section">
                                <div className="bl-tool-divider" />
                                <button type="button" className="bl-tool-btn"
                                    title={user ? "Save to cloud" : "Save to browser"} onClick={handleSave} disabled={readOnly}>
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
                                            readOnly={readOnly}
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
            {sizeOpen && (activeTool === "eraser" ? (
                <WidthOpacityPanel
                    width={engine.eraserSize}
                    onWidthChange={engine.setEraserSize}
                    widthLabel="Eraser size"
                    minWidth={4}
                    maxWidth={90}
                    onClose={() => setSizeOpen(false)}
                    anchorRef={sizeAnchorRef}
                    layoutKey={activeTool}
                />
            ) : (
                <WidthOpacityPanel
                    width={engine.width}
                    opacity={engine.opacity}
                    onWidthChange={engine.setWidth}
                    onOpacityChange={engine.setOpacity}
                    onClose={() => setSizeOpen(false)}
                    anchorRef={sizeAnchorRef}
                    layoutKey={activeTool}
                />
            ))}

            <ScaleHud
                engineRef={engine.engineRef}
                engineReady={engine.engineReady}
                scaleDef={scaleDef}
                readOnly={readOnly}
                onClear={clearScaleDef}
                onSetScale={() => { setPendingBar(null); setDefineMode(true); }}
                onLadderId={setHudLadderId}
            />

            {!hintDismissed && (
                <div className="bl-hint">Scroll or pinch to zoom — open Scenes to jump to a drawing</div>
            )}

            <div className="bl-top-notices">
                <SyncBanner sync={sync} compact={narrow} onTakeOver={() => { if (sessionRef.current) sessionRef.current.takeOver(); }} />
                {syncNotice && (
                    <div className="bl-remote-banner" role="status">
                        <span>
                            {syncNotice.message}
                            {syncNotice.id && <> — <Link to={`/canvas/${syncNotice.id}${location.search}`}>open it</Link></>}
                        </span>
                        <button type="button" title="Dismiss" onClick={() => setSyncNotice(null)}>
                            <X size={14} />
                        </button>
                    </div>
                )}
            </div>

            {toast && <div className="bl-toast">{toast}</div>}

            {/* The hook has computed `saveError` since 2026-08-25 and nothing
                ever rendered it, so a save that never landed stayed invisible
                outside the console — the exact failure it was added to expose.
                It also carries the standing "autosave is off" notice. */}
            {showSaveBar && (
                <div className={"bl-savebar" + (saveNotice.off ? " bl-savebar--off" : "")}
                    role="status">
                    <span className="bl-savebar__msg">{saveNotice.message}</span>
                    <button type="button" className="bl-savebar__btn" onClick={handleSave}>Save now</button>
                    <button type="button" className="bl-savebar__x" aria-label="Dismiss"
                        title="Dismiss" onClick={() => setSaveNoticeDismissed(saveNoticeKind)}>
                        <X size={14} />
                    </button>
                </div>
            )}

            {activeTool === "eraser" && (
                <div
                    ref={eraserRingRef}
                    className="bl-eraser-ring"
                    style={{ width: engine.eraserSize * 2, height: engine.eraserSize * 2 }}
                />
            )}

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
                ladderId={hudLadderId}
                onSave={() => {
                    const parsed = parseFloat(scaleValue);
                    if (!pendingBar || isNaN(parsed) || parsed <= 0) return;
                    commitScaleDef({
                        value: parsed,
                        unit: scaleUnit,
                        barPx: pendingBar.px,
                        zoomAt: engine.engineRef.current ? engine.engineRef.current.cam.effectiveZoom() : engine.status.effectiveZoom,
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
