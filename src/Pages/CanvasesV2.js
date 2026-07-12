import React, { useCallback, useEffect, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import { Plus } from "lucide-react";
import Button from "../Components/ui/Button";
import BrandLogo from "../Components/BrandLogo";
import "../Stylesheets/boundless-ui.css";
import placeholderThumb from "../Images/ui/canvas-botanical.jpg";
import {
    readIndex, migrateLegacyAutosave, editedLabel, depthLabel, newCanvasId,
    loadCanvasRaw,
} from "../storage/localCanvases";
import useUser, { signInWithGoogle, signOutUser } from "../cloud/useUser";
import { cloudListCanvases, cloudSaveCanvas } from "../cloud/canvasSync";

export default function CanvasesV2() {
    const history = useHistory();
    const { user, ready } = useUser();
    const [canvases, setCanvases] = useState([]);
    const [syncNote, setSyncNote] = useState(null);

    const refresh = useCallback(async () => {
        // First visit after the multi-canvas update: adopt the old single-slot
        // drawing into the index so nothing silently disappears.
        migrateLegacyAutosave();
        const local = readIndex();
        if (!user) { setCanvases(local); return; }
        try {
            let cloud = await cloudListCanvases(user.uid);
            // One-way catch-up: local canvases the account doesn't know yet.
            const known = new Set(cloud.map((c) => c.id));
            const missing = local.filter((e) => !known.has(e.id));
            for (const entry of missing) {
                const raw = loadCanvasRaw(entry.id);
                if (raw) await cloudSaveCanvas(user.uid, entry, raw);
            }
            if (missing.length) cloud = await cloudListCanvases(user.uid);
            // Merge by id — freshest savedAt wins the metadata.
            const byId = new Map();
            for (const e of [...local, ...cloud]) {
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
                    <Button className="bl-flex bl-items-center bl-gap-2" onClick={() => history.push(`/canvas/${newCanvasId()}`)}>
                        <Plus size={16} /> New canvas
                    </Button>
                </div>

                {syncNote && (
                    <p className="bl-text-sm bl-text-muted" style={{ marginBottom: "1rem" }}>{syncNote}</p>
                )}

                <div className="bl-gallery-grid">
                    {canvases.map((c) => (
                        <Link key={c.id} to={`/canvas/${c.id}`} className="bl-canvas-card">
                            <div className="bl-canvas-thumb">
                                <img src={placeholderThumb} alt={`Canvas: ${c.name}`} loading="lazy" />
                            </div>
                            <div className="bl-canvas-meta">
                                <div>
                                    <h2 className="bl-canvas-name">{c.name}</h2>
                                    <p className="bl-canvas-edited">{editedLabel(c.savedAt)}</p>
                                </div>
                                <span className="bl-depth-badge">{depthLabel(c.levels)}</span>
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
        </div>
    );
}
