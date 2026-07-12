import React, { useEffect, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import { Plus } from "lucide-react";
import Button from "../Components/ui/Button";
import BrandLogo from "../Components/BrandLogo";
import "../Stylesheets/boundless-ui.css";
import placeholderThumb from "../Images/ui/canvas-botanical.jpg";
import {
    readIndex, migrateLegacyAutosave, editedLabel, depthLabel, newCanvasId,
} from "../storage/localCanvases";

export default function CanvasesV2() {
    const history = useHistory();
    const [canvases, setCanvases] = useState([]);

    useEffect(() => {
        // First visit after the multi-canvas update: adopt the old single-slot
        // drawing into the index so nothing silently disappears.
        migrateLegacyAutosave();
        setCanvases(readIndex());
    }, []);

    return (
        <div className="bl-ui bl-min-h-screen">
            <header className="bl-nav-bordered">
                <div className="bl-container bl-flex bl-items-center bl-justify-between" style={{ padding: "1rem 1.5rem" }}>
                    <BrandLogo />
                    <span className="bl-text-sm bl-text-muted bl-hidden-sm">Saves to this browser</span>
                </div>
            </header>

            <main className="bl-container" style={{ paddingTop: "2.5rem", paddingBottom: "2.5rem" }}>
                <div className="bl-flex bl-items-end bl-justify-between" style={{ marginBottom: "2rem", flexWrap: "wrap", gap: "0.75rem 1rem" }}>
                    <div>
                        <h1 className="bl-page-title">Your canvases</h1>
                        <p className="bl-page-sub">Pick up where you left off, at any depth.</p>
                    </div>
                    <Button className="bl-flex bl-items-center bl-gap-2" onClick={() => history.push(`/canvas/${newCanvasId()}`)}>
                        <Plus size={16} /> New canvas
                    </Button>
                </div>

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
                        Nothing saved yet — draw something and hit Save. Canvases live in this
                        browser until accounts arrive.
                    </p>
                )}
            </main>
        </div>
    );
}
