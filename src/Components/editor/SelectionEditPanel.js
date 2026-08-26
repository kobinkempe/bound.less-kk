import React from "react";
import Button from "../ui/Button";

/**
 * What you can do to a selection.
 *
 * Colour, width and opacity editing were removed along with the style box
 * itself (Kobin, 2026-08-03) when multi-select arrived: a lasso can hold objects
 * drawn at wildly different levels, and one width slider has no meaning across
 * them. What is left is what still makes sense for one object or for fifty —
 * delete it, or let it go.
 */
export default function SelectionEditPanel({ selection, onDelete, onDone }) {
    if (!selection) return null;
    const n = selection.count == null ? 1 : selection.count;
    return (
        <div className="bl-selection-panel">
            <p className="bl-text-xs bl-text-muted bl-uppercase" style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                {n === 1 ? `Selection #${selection.id}` : `${n} objects selected`}
            </p>
            <div className="bl-flex bl-gap-2" style={{ justifyContent: "flex-end" }}>
                <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
                <Button size="sm" onClick={onDone}>Done</Button>
            </div>
        </div>
    );
}
