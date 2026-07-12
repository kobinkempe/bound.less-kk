import React from "react";
import { Link } from "react-router-dom";
import { PenLine } from "lucide-react";

export default function BrandLogo({ to = "/" }) {
    return (
        <Link to={to} className="bl-brand">
            <div className="bl-brand-icon">
                <PenLine size={16} />
            </div>
            <span className="bl-brand-name">bound.less</span>
        </Link>
    );
}
