import React from "react";

/**
 * Scale-definition drag visualization, faithful to the Everdraw original:
 * dashed primary line while dragging, solid once the bar is pending in the
 * value dialog; ringed endpoint dots; dark ink label pill at the midpoint.
 */
export default function ScaleDragBar({ a, b, label = "?", dashed = true }) {
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;

    return (
        <div className="bl-scale-drag-line" style={{ pointerEvents: "none" }}>
            <div
                className={`bl-scale-drag-bar${dashed ? "" : " bl-scale-drag-bar--solid"}`}
                style={{
                    left: a.x,
                    top: a.y,
                    width: len,
                    transform: `rotate(${angle}deg)`,
                    transformOrigin: "0 0",
                }}
            />
            <div className="bl-scale-drag-dot" style={{ left: a.x, top: a.y }} />
            <div className="bl-scale-drag-dot" style={{ left: b.x, top: b.y }} />
            <div className="bl-scale-drag-label" style={{ left: cx, top: cy - 14 }}>
                {label}
            </div>
        </div>
    );
}
