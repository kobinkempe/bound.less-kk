import React from "react";
import { Link, useHistory } from "react-router-dom";
import { Plus } from "lucide-react";
import Button from "../Components/ui/Button";
import BrandLogo from "../Components/BrandLogo";
import "../Stylesheets/boundless-ui.css";
import canvasMain from "../Images/ui/canvas-main.jpg";
import canvasLighthouse from "../Images/ui/canvas-lighthouse.jpg";
import canvasBotanical from "../Images/ui/canvas-botanical.jpg";

/** Phase 1: demo gallery cards use static JPG thumbnails (see issue-log). */
const DEMO_CANVASES = [
    { id: "wonder-tree", name: "Wonder Tree", image: canvasMain, edited: "Demo canvas", depth: "Max zoom 4,000×" },
    { id: "north-point", name: "North Point", image: canvasLighthouse, edited: "Demo canvas", depth: "Max zoom 120×" },
    { id: "field-notes", name: "Field Notes", image: canvasBotanical, edited: "Demo canvas", depth: "Max zoom 36×" },
];

export default function CanvasesV2() {
    const history = useHistory();

    return (
        <div className="bl-ui bl-min-h-screen">
            <header className="bl-nav-bordered">
                <div className="bl-container bl-flex bl-items-center bl-justify-between" style={{ padding: "1rem 1.5rem" }}>
                    <BrandLogo />
                    <span className="bl-text-sm bl-text-muted bl-hidden-sm">Saves to this browser</span>
                </div>
            </header>

            <main className="bl-container" style={{ paddingTop: "2.5rem", paddingBottom: "2.5rem" }}>
                <div className="bl-flex bl-items-end bl-justify-between" style={{ marginBottom: "2rem" }}>
                    <div>
                        <h1 className="bl-page-title">Your canvases</h1>
                        <p className="bl-page-sub">Pick up where you left off, at any depth.</p>
                    </div>
                    <Button className="bl-flex bl-items-center bl-gap-2" onClick={() => history.push("/canvas/new")}>
                        <Plus size={16} /> New canvas
                    </Button>
                </div>

                <div className="bl-gallery-grid">
                    {DEMO_CANVASES.map((c) => (
                        <Link key={c.id} to={`/canvas/${c.id}`} className="bl-canvas-card">
                            <div className="bl-canvas-thumb">
                                <img src={c.image} alt={`Canvas: ${c.name}`} loading="lazy" />
                            </div>
                            <div className="bl-canvas-meta">
                                <div>
                                    <h2 className="bl-canvas-name">{c.name}</h2>
                                    <p className="bl-canvas-edited">{c.edited}</p>
                                </div>
                                <span className="bl-depth-badge">{c.depth}</span>
                            </div>
                        </Link>
                    ))}

                    <button type="button" className="bl-new-canvas-btn" onClick={() => history.push("/canvas/new")}>
                        <Plus size={24} />
                        <span className="bl-text-sm" style={{ fontWeight: 500 }}>Start a blank canvas</span>
                    </button>
                </div>
            </main>
        </div>
    );
}
