import React, { useEffect } from "react";

export function Dialog({ open, onOpenChange, children, className = "" }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === "Escape") onOpenChange(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onOpenChange]);
    if (!open) return null;
    return (
        <div className="bl-dialog-overlay" onClick={() => onOpenChange(false)}>
            <div className={`bl-dialog ${className}`.trim()} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                {children}
            </div>
        </div>
    );
}

export function DialogHeader({ children }) {
    return <div>{children}</div>;
}

export function DialogTitle({ children, className = "" }) {
    return <h2 className={`bl-dialog-title ${className}`.trim()}>{children}</h2>;
}

export function DialogDescription({ children }) {
    return <p className="bl-dialog-desc">{children}</p>;
}

export function DialogFooter({ children }) {
    return <div className="bl-dialog-footer">{children}</div>;
}

export function DialogContent({ children, className = "" }) {
    return <div className={className}>{children}</div>;
}
