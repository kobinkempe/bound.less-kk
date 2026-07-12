import React from "react";
import { Link } from "react-router-dom";
import { ZoomIn, Layers, Ruler } from "lucide-react";
import Button from "../Components/ui/Button";
import BrandLogo from "../Components/BrandLogo";
import "../Stylesheets/boundless-ui.css";
import heroSketch from "../Images/ui/canvas-main.jpg";

export default function HomeV2() {
    return (
        <div className="bl-ui bl-min-h-screen">
            <header className="bl-container bl-nav">
                <BrandLogo />
                <Link to="/canvases">
                    <Button variant="outline" size="sm">Gallery</Button>
                </Link>
            </header>

            <main className="bl-container">
                <div className="bl-hero-grid">
                    <div>
                        <p className="bl-badge">Beta</p>
                        <h1 className="bl-hero-title">
                            Draw worlds
                            <br />
                            within worlds.
                        </h1>
                        <p className="bl-hero-sub">
                            An infinite canvas that zooms forever. Sketch a city, zoom into a window,
                            draw the room inside — then keep going.
                        </p>
                        <div style={{ marginTop: "2rem" }}>
                            <Link to="/canvases">
                                <Button size="lg">Start creating</Button>
                            </Link>
                            <p className="bl-text-xs bl-text-muted" style={{ marginTop: "0.75rem" }}>
                                No account needed — your work saves right in this browser,
                                and you can export drawings as files.
                            </p>
                        </div>
                    </div>
                    <div className="bl-relative">
                        <div className="bl-hero-img-wrap bl-shadow-card">
                            <img src={heroSketch} alt="Ink sketch of a treehouse village on an infinite canvas" />
                        </div>
                        <div className="bl-scale-chip bl-shadow-panel">
                            <span className="bl-scale-chip-bar" />
                            <span>1 inch</span>
                            <span className="bl-text-muted"> · 240×</span>
                        </div>
                    </div>
                </div>

                <div className="bl-features">
                    <Feature icon={<ZoomIn size={20} />} title="Infinite zoom"
                        text="Zoom in or out without limits. Detail lives at every depth." />
                    <Feature icon={<Layers size={20} />} title="Scenes"
                        text="Bookmark the drawings hidden inside your canvas so nothing gets lost." />
                    <Feature icon={<Ruler size={20} />} title="Real scale"
                        text="Define a length in inches, meters or miles — the scale bar tracks your zoom." />
                </div>
            </main>

            <footer className="bl-container bl-footer">
                bound.less — an infinite-zoom drawing canvas by Kobin Kempe.
            </footer>
        </div>
    );
}

function Feature({ icon, title, text }) {
    return (
        <div className="bl-flex bl-gap-4">
            <div className="bl-feature-icon">{icon}</div>
            <div>
                <h3 className="bl-feature-title">{title}</h3>
                <p className="bl-feature-text">{text}</p>
            </div>
        </div>
    );
}
