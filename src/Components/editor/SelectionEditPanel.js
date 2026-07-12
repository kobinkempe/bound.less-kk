import React from "react";
import { HexColorPicker } from "react-colorful";
import Button from "../ui/Button";
import { toHex } from "../../utils/color";

export default function SelectionEditPanel({ selection, onColor, onWidth, onOpacity, onDelete, onDone }) {
    if (!selection) return null;
    return (
        <div className="bl-selection-panel">
            <p className="bl-text-xs bl-text-muted bl-uppercase" style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                Selection #{selection.id}
            </p>
            <div className="bl-color-picker" style={{ marginBottom: "0.75rem" }}>
                <HexColorPicker color={toHex(selection.color)} onChange={onColor} />
            </div>
            {selection.widthPx != null && (
                <>
                    <label className="bl-range-label">Width {Math.round(selection.widthPx)}px</label>
                    <input
                        className="bl-range"
                        type="range"
                        min={1}
                        max={120}
                        value={selection.widthPx}
                        onChange={(e) => onWidth(+e.target.value)}
                    />
                </>
            )}
            <label className="bl-range-label" style={{ marginTop: "0.5rem" }}>
                Opacity {Math.round((selection.opacity ?? 1) * 100)}%
            </label>
            <input
                className="bl-range"
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={selection.opacity ?? 1}
                onChange={(e) => onOpacity(+e.target.value)}
            />
            <div className="bl-flex bl-gap-2" style={{ marginTop: "0.75rem", justifyContent: "flex-end" }}>
                <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
                <Button size="sm" onClick={onDone}>Done</Button>
            </div>
        </div>
    );
}
