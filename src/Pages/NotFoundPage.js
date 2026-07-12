import React from "react";
import { Link } from "react-router-dom";
import Button from "../Components/ui/Button";
import BrandLogo from "../Components/BrandLogo";
import "../Stylesheets/boundless-ui.css";

export default function NotFoundPage() {
    return (
        <div className="bl-ui bl-min-h-screen">
            <header className="bl-container bl-nav">
                <BrandLogo />
            </header>
            <main className="bl-container" style={{ paddingTop: "4rem", textAlign: "center" }}>
                <h1 className="bl-page-title">Page not found</h1>
                <p className="bl-page-sub" style={{ margin: "0.75rem 0 2rem" }}>
                    This corner of the canvas is still blank.
                </p>
                <Link to="/">
                    <Button size="lg">Back to bound.less</Button>
                </Link>
            </main>
        </div>
    );
}
