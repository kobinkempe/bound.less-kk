import React from "react";
import Button from "../ui/Button";

export default function SelectionEditPanel({ selection, onDelete, onDone }) {
    if (!selection) return null;
    return (
        <div className="bl-selection-panel">
            <p className="bl-text-xs bl-text-muted bl-uppercase" style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                {selection.count > 1 ? `${selection.count} objects selected` : "1 object selected"}
            </p>
            <p className="bl-text-xs bl-text-muted" style={{ margin: 0 }}>
                Drag empty canvas to lasso. Hold Ctrl to add or remove.
            </p>
            <div className="bl-flex bl-gap-2" style={{ marginTop: "0.75rem", justifyContent: "flex-end" }}>
                <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
                <Button size="sm" onClick={onDone}>Done</Button>
            </div>
        </div>
    );
}
