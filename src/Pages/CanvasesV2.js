import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useHistory, useLocation } from "react-router-dom";
import { Plus, MoreVertical, Pencil, Download, Trash2, FolderOpen, RotateCcw, Copy } from "lucide-react";
import Button from "../Components/ui/Button";
import Input from "../Components/ui/Input";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../Components/ui/Dialog";
import BrandLogo from "../Components/BrandLogo";
import "../Stylesheets/boundless-ui.css";
import placeholderThumb from "../Images/ui/canvas-botanical.jpg";
import {
    readIndex, migrateLegacyAutosave, editedLabel, deletedLabel, depthLabel, newCanvasId,
    loadCanvasRaw, saveCanvasRaw, loadCoverThumb, upsertIndexEntry, statsFromDoc,
    trashCanvas, readTrash, restoreCanvas, renameCanvasLocal, purgeTrashEntry, duplicateCanvas,
} from "../storage/localCanvases";
import { decodeDrawing } from "../engine/persist";
import useUser, { signInWithGoogle, signOutUser } from "../cloud/useUser";
import {
    cloudListCanvases, cloudSaveCanvas, cloudLoadCanvas,
    cloudTrashCanvas, cloudRestoreCanvas, cloudRenameCanvas, cloudDeleteCanvas,
} from "../cloud/canvasSync";

export default function CanvasesV2() {
    const history = useHistory();
    const location = useLocation();
    const { user, ready } = useUser();
    const fileRef = useRef(null);
    const [canvases, setCanvases] = useState([]);
    const [cloudCovers, setCloudCovers] = useState({});
    const [syncNote, setSyncNote] = useState(null);
    const [menuFor, setMenuFor] = useState(null); // canvas id with its ⋮ menu open
    const [pageMenuOpen, setPageMenuOpen] = useState(false);
    const [renameFor, setRenameFor] = useState(null); // canvas entry being renamed
    const [renameDraft, setRenameDraft] = useState("");
    const [deleteFor, setDeleteFor] = useState(null); // canvas entry pending delete
    const [trashOpen, setTrashOpen] = useState(false);
    const [trashItems, setTrashItems] = useState([]);
    const [purgeConfirm, setPurgeConfirm] = useState(null); // trash items pending permanent delete
    const [toast, setToast] = useState(null); // { msg, undoId }

    const refresh = useCallback(async () => {
        // First visit after the multi-canvas update: adopt the old single-slot
        // drawing into the index so nothing silently disappears.
        migrateLegacyAutosave();
        let local = readIndex();
        if (!user) { setCanvases(local); return; }
        try {
            let cloud = await cloudListCanvases(user.uid);
            // Deletions propagate: a canvas tombstoned in the cloud moves this
            // browser's copy into the local recycle bin too.
            const tombstoned = new Set(cloud.filter((c) => c.deletedAt).map((c) => c.id));
            if (local.some((e) => tombstoned.has(e.id))) {
                local.filter((e) => tombstoned.has(e.id)).forEach((e) => trashCanvas(e.id));
                local = readIndex();
            }
            // One-way catch-up: local canvases the account doesn't know yet.
            // Tombstoned ids count as known — a stale device must not
            // resurrect a canvas deleted elsewhere.
            const known = new Set(cloud.map((c) => c.id));
            const missing = local.filter((e) => !known.has(e.id));
            for (const entry of missing) {
                const raw = loadCanvasRaw(entry.id);
                if (raw) await cloudSaveCanvas(user.uid, entry, raw);
            }
            if (missing.length) cloud = await cloudListCanvases(user.uid);
            const active = cloud.filter((c) => !c.deletedAt);
            const covers = {};
            for (const c of active) if (c.thumbs?.cover?.data) covers[c.id] = c.thumbs.cover.data;
            setCloudCovers(covers);
            // Merge by id — freshest savedAt wins the metadata.
            const byId = new Map();
            for (const e of [...local, ...active]) {
                const prev = byId.get(e.id);
                if (!prev || String(e.savedAt || "") > String(prev.savedAt || "")) byId.set(e.id, e);
            }
            const merged = [...byId.values()].sort(
                (a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")),
            );
            setCanvases(merged);
            setSyncNote(null);
        } catch (err) {
            setCanvases(local);
            setSyncNote("Cloud sync unavailable right now — showing this browser's canvases.");
        }
    }, [user]);

    useEffect(() => { refresh(); }, [refresh]);

    // Arriving from an editor-initiated delete: show the undo toast once.
    useEffect(() => {
        const del = location.state && location.state.deleted;
        if (!del) return;
        setToast({ msg: "Canvas deleted —", undoId: del.id });
        history.replace({ pathname: "/canvases", state: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 6000);
        return () => clearTimeout(t);
    }, [toast]);

    const undoDelete = async () => {
        const id = toast && toast.undoId;
        setToast(null);
        if (!id) return;
        restoreCanvas(id);
        if (user) {
            try { await cloudRestoreCanvas(user.uid, id); }
            catch (err) { setSyncNote("Restored here — cloud restore didn't go through."); }
        }
        refresh();
    };

    // ---- card actions ----

    const downloadCanvas = async (c) => {
        let json = loadCanvasRaw(c.id);
        if (!json && user) {
            try { json = (await cloudLoadCanvas(user.uid, c.id))?.json || null; } catch (err) { /* fall through */ }
        }
        if (!json) { setSyncNote("Couldn't load that canvas's data to download."); return; }
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (c.name || "untitled") + ".boundless.json";
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const commitRename = async () => {
        const name = renameDraft.trim() || "Untitled canvas";
        const at = new Date().toISOString();
        renameCanvasLocal(renameFor.id, name, at);
        if (user) {
            try { await cloudRenameCanvas(user.uid, renameFor.id, name, at); }
            catch (err) { setSyncNote("Renamed here — cloud rename didn't go through."); }
        }
        setRenameFor(null);
        refresh();
    };

    const confirmDelete = async () => {
        const c = deleteFor;
        setDeleteFor(null);
        trashCanvas(c.id, c); // fallback entry keeps cloud-only canvases listed in the bin
        if (user) {
            try { await cloudTrashCanvas(user.uid, c.id); }
            catch (err) { setSyncNote("Deleted here — cloud delete didn't go through."); }
        }
        setToast({ msg: "Canvas deleted —", undoId: c.id });
        refresh();
    };

    const duplicateFromGallery = async (c) => {
        let entry = duplicateCanvas(c.id, null, c.name);
        if (!entry && user) {
            // Cloud-only canvas (no local slot) — fetch the drawing first.
            try {
                const res = await cloudLoadCanvas(user.uid, c.id);
                if (res && res.json) entry = duplicateCanvas(c.id, res.json, c.name);
            } catch (err) { /* fall through */ }
        }
        if (!entry) { setSyncNote("Couldn't duplicate that canvas."); return; }
        refresh(); // signed in: the catch-up upsync pushes the copy to the account
    };

    // ---- page menu actions ----

    const openTrash = async () => {
        setPageMenuOpen(false);
        let items = readTrash();
        if (user) {
            try {
                const cloud = await cloudListCanvases(user.uid);
                for (const c of cloud) {
                    if (c.deletedAt && !items.some((t) => t.id === c.id)) items.push({ ...c });
                }
            } catch (err) { /* local bin only */ }
        }
        items.sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
        setTrashItems(items);
        setTrashOpen(true);
    };

    const restoreItem = async (t) => {
        restoreCanvas(t.id);
        if (user) {
            try { await cloudRestoreCanvas(user.uid, t.id); }
            catch (err) { setSyncNote("Restored here — cloud restore didn't go through."); }
        }
        setTrashItems((items) => items.filter((i) => i.id !== t.id));
        refresh();
    };

    const purgeItems = async () => {
        const items = purgeConfirm || [];
        setPurgeConfirm(null);
        for (const t of items) {
            purgeTrashEntry(t.id);
            if (user) {
                try { await cloudDeleteCanvas(user.uid, t.id); }
                catch (err) { setSyncNote("Some account copies couldn't be deleted — they'll reappear in the bin."); }
            }
        }
        setTrashItems((prev) => prev.filter((i) => !items.some((t) => t.id === i.id)));
    };

    const importFile = async (f) => {
        try {
            const text = await f.text();
            const raw = JSON.parse(text);
            decodeDrawing(raw); // validates — throws a friendly message on junk
            const id = newCanvasId();
            if (!saveCanvasRaw(id, text)) {
                setSyncNote("Couldn't store that file — browser storage may be full.");
                return;
            }
            const metaName = raw.meta && raw.meta.name;
            const name = (metaName && metaName !== "untitled" ? metaName : null)
                || f.name.replace(/(\.boundless)?\.json$/i, "")
                || "Imported canvas";
            upsertIndexEntry({ id, name, savedAt: new Date().toISOString(), ...statsFromDoc(raw) });
            history.push(`/canvas/${id}`);
        } catch (err) {
            window.alert("Couldn't load that file: " + (err?.message || err));
        }
    };

    const accountArea = !ready ? null : user ? (
        <div className="bl-flex bl-items-center bl-gap-3">
            <span className="bl-text-sm bl-text-muted bl-hidden-sm">{user.email}</span>
            <Button variant="outline" size="sm" onClick={() => signOutUser()}>Sign out</Button>
        </div>
    ) : (
        <div className="bl-flex bl-items-center bl-gap-3">
            <span className="bl-text-sm bl-text-muted bl-hidden-sm">Saves to this browser</span>
            <Button variant="outline" size="sm"
                onClick={() => signInWithGoogle().catch((err) => {
                    if (err?.code === "auth/popup-closed-by-user"
                        || err?.code === "auth/cancelled-popup-request") return;
                    setSyncNote(`Sign-in didn't complete (${err?.code || err?.message || "unknown error"}).`);
                })}>
                Sign in
            </Button>
        </div>
    );

    return (
        <div className="bl-ui bl-min-h-screen">
            <header className="bl-nav-bordered">
                <div className="bl-container bl-flex bl-items-center bl-justify-between" style={{ padding: "1rem 1.5rem" }}>
                    <BrandLogo />
                    {accountArea}
                </div>
            </header>

            <main className="bl-container" style={{ paddingTop: "2.5rem", paddingBottom: "2.5rem" }}>
                <div className="bl-flex bl-items-end bl-justify-between" style={{ marginBottom: "2rem", flexWrap: "wrap", gap: "0.75rem 1rem" }}>
                    <div>
                        <h1 className="bl-page-title">Your canvases</h1>
                        <p className="bl-page-sub">
                            {user ? "Synced to your account — pick up at any depth." : "Pick up where you left off, at any depth."}
                        </p>
                    </div>
                    <div className="bl-flex bl-items-center bl-gap-2">
                        <Button className="bl-flex bl-items-center bl-gap-2" onClick={() => history.push(`/canvas/${newCanvasId()}`)}>
                            <Plus size={16} /> New canvas
                        </Button>
                        <div className="bl-popover-anchor bl-card-menu-anchor">
                            <Button variant="outline" size="icon" title="More actions"
                                onClick={() => setPageMenuOpen((o) => !o)}>
                                <MoreVertical size={16} />
                            </Button>
                            {pageMenuOpen && (
                                <PopMenu onClose={() => setPageMenuOpen(false)}>
                                    <button type="button" className="bl-file-menu-item"
                                        onClick={() => { setPageMenuOpen(false); fileRef.current?.click(); }}>
                                        <FolderOpen size={14} /> Load canvas…
                                    </button>
                                    <button type="button" className="bl-file-menu-item" onClick={openTrash}>
                                        <RotateCcw size={14} /> Restore deleted canvases
                                    </button>
                                </PopMenu>
                            )}
                        </div>
                    </div>
                </div>

                {syncNote && (
                    <p className="bl-text-sm bl-text-muted" style={{ marginBottom: "1rem" }}>{syncNote}</p>
                )}

                <div className="bl-gallery-grid">
                    {canvases.map((c) => (
                        <Link key={c.id} to={`/canvas/${c.id}`}
                            className={`bl-canvas-card${menuFor === c.id ? " bl-canvas-card--raised" : ""}`}>
                            <div className="bl-canvas-thumb">
                                <img
                                    src={loadCoverThumb(c.id) || cloudCovers[c.id] || placeholderThumb}
                                    alt={`Canvas: ${c.name}`}
                                    loading="lazy"
                                />
                            </div>
                            <div className="bl-canvas-meta">
                                <div>
                                    <h2 className="bl-canvas-name">{c.name}</h2>
                                    <p className="bl-canvas-edited">{editedLabel(c.savedAt)}</p>
                                </div>
                                {/* Menu clicks must not follow the card's Link */}
                                <div className="bl-canvas-meta-actions"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                                    <span className="bl-depth-badge">{depthLabel(c.levels)}</span>
                                    <div className="bl-popover-anchor bl-card-menu-anchor">
                                        <button type="button" className="bl-card-menu-btn" title="Canvas actions"
                                            onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}>
                                            <MoreVertical size={16} />
                                        </button>
                                        {menuFor === c.id && (
                                            <PopMenu onClose={() => setMenuFor(null)}>
                                                <button type="button" className="bl-file-menu-item"
                                                    onClick={() => { setMenuFor(null); setRenameDraft(c.name || ""); setRenameFor(c); }}>
                                                    <Pencil size={14} /> Rename canvas
                                                </button>
                                                <button type="button" className="bl-file-menu-item"
                                                    onClick={() => { setMenuFor(null); duplicateFromGallery(c); }}>
                                                    <Copy size={14} /> Duplicate canvas
                                                </button>
                                                <button type="button" className="bl-file-menu-item"
                                                    onClick={() => { setMenuFor(null); downloadCanvas(c); }}>
                                                    <Download size={14} /> Download canvas
                                                </button>
                                                <div className="bl-file-menu-divider" />
                                                <button type="button" className="bl-file-menu-item bl-file-menu-item--danger"
                                                    onClick={() => { setMenuFor(null); setDeleteFor(c); }}>
                                                    <Trash2 size={14} /> Delete canvas
                                                </button>
                                            </PopMenu>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}

                    <button type="button" className="bl-new-canvas-btn" onClick={() => history.push(`/canvas/${newCanvasId()}`)}>
                        <Plus size={24} />
                        <span className="bl-text-sm" style={{ fontWeight: 500 }}>Start a blank canvas</span>
                    </button>
                </div>

                {canvases.length === 0 && (
                    <p className="bl-text-sm bl-text-muted" style={{ marginTop: "1.5rem" }}>
                        Nothing saved yet — draw something and hit Save.
                        {user ? " Saved canvases follow your account." : " Canvases live in this browser, or sign in to keep them."}
                    </p>
                )}
            </main>

            <input
                ref={fileRef}
                type="file"
                accept=".json,.boundless.json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) importFile(f);
                }}
            />

            <Dialog open={!!renameFor} onOpenChange={(o) => { if (!o) setRenameFor(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename canvas</DialogTitle>
                    </DialogHeader>
                    <div>
                        <label className="bl-label">Canvas name</label>
                        <Input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); }} />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setRenameFor(null)}>Cancel</Button>
                        <Button onClick={commitRename}>Rename</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!deleteFor} onOpenChange={(o) => { if (!o) setDeleteFor(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete canvas?</DialogTitle>
                        <DialogDescription>
                            “{deleteFor?.name}” moves to the recycle bin{user ? " (here and in your account)" : ""} —
                            restore it within 30 days from “Restore deleted canvases”.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDeleteFor(null)}>Cancel</Button>
                        <Button onClick={confirmDelete}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Recycle bin</DialogTitle>
                        <DialogDescription>
                            Deleted canvases stay restorable here for 30 days{user ? " (account copies stick around longer)" : ""}.
                        </DialogDescription>
                    </DialogHeader>
                    {trashItems.length === 0 ? (
                        <p className="bl-text-sm bl-text-muted">The recycle bin is empty.</p>
                    ) : (
                        <div className="bl-trash-list">
                            {trashItems.map((t) => (
                                <div key={t.id} className="bl-trash-row">
                                    <div style={{ minWidth: 0 }}>
                                        <div className="bl-canvas-name">{t.name || "Untitled canvas"}</div>
                                        <div className="bl-canvas-edited">{deletedLabel(t.deletedAt)}</div>
                                    </div>
                                    <div className="bl-flex bl-items-center bl-gap-2" style={{ flex: "none" }}>
                                        <Button variant="ghost" size="sm" className="bl-danger-text"
                                            onClick={() => setPurgeConfirm([t])}>
                                            Delete forever
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => restoreItem(t)}>Restore</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <DialogFooter>
                        {trashItems.length > 0 && (
                            <Button variant="outline" size="sm" className="bl-danger-text"
                                onClick={() => setPurgeConfirm(trashItems)}>
                                Empty bin
                            </Button>
                        )}
                        <Button variant="ghost" onClick={() => setTrashOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!purgeConfirm} onOpenChange={(o) => { if (!o) setPurgeConfirm(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete forever?</DialogTitle>
                        <DialogDescription>
                            {purgeConfirm && purgeConfirm.length === 1
                                ? `“${purgeConfirm[0].name || "Untitled canvas"}” will be permanently deleted`
                                : `${purgeConfirm ? purgeConfirm.length : 0} canvases will be permanently deleted`}
                            {user ? ", here and from your account" : ""}. This can’t be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setPurgeConfirm(null)}>Cancel</Button>
                        <Button onClick={purgeItems}>Delete forever</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {toast && (
                <div className="bl-toast bl-toast--action">
                    {toast.msg}
                    {toast.undoId && <button type="button" onClick={undoDelete}>Undo</button>}
                </div>
            )}
        </div>
    );
}

/**
 * Right-aligned dropdown reusing the editor's file-menu styling. Clicks
 * inside the anchor (the ⋮ button that opened it) are left to that button's
 * own toggle — if the click-away also fired, close-then-toggle would reopen
 * the menu and the ⋮ would feel stuck open.
 */
function PopMenu({ onClose, children }) {
    const ref = useRef(null);
    useEffect(() => {
        const handler = (e) => {
            const anchor = ref.current && ref.current.parentElement;
            if (anchor && anchor.contains(e.target)) return;
            onClose();
        };
        document.addEventListener("click", handler, true);
        return () => document.removeEventListener("click", handler, true);
    }, [onClose]);
    return (
        <div ref={ref} className="bl-popover bl-file-menu">
            {children}
        </div>
    );
}
