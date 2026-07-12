import React from "react";
import useClickAway from "./useClickAway";
import useAnchorPopoverStyle from "./useAnchorPopoverStyle";

export default function WidthOpacityPanel({ width, opacity, onWidthChange, onOpacityChange, onClose, anchorRef, layoutKey = 0 }) {
    const ref = useClickAway(onClose, anchorRef);
    const style = useAnchorPopoverStyle(anchorRef, true, 8, layoutKey);
    if (!style) return null;

    return (
        <div ref={ref} className="bl-popover bl-popover--anchored bl-width-panel" style={style}>
            <label className="bl-range-label">Width {width}px</label>
            <input
                className="bl-range"
                type="range"
                min={1}
                max={90}
                value={width}
                onChange={(e) => onWidthChange(+e.target.value)}
            />
            <label className="bl-range-label bl-range-label--spaced">
                Opacity {Math.round(opacity * 100)}%
            </label>
            <input
                className="bl-range"
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => onOpacityChange(+e.target.value)}
            />
        </div>
    );
}
