import React from "react";

export default function ScaleDragBar({ a, b, label = "?" }) {
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
                className="bl-scale-drag-bar"
                style={{
                    left: a.x,
                    top: a.y,
                    width: len,
                    transform: `rotate(${angle}deg)`,
                    transformOrigin: "0 50%",
                }}
            />
            <div className="bl-scale-drag-dot" style={{ left: a.x - 4, top: a.y - 4 }} />
            <div className="bl-scale-drag-dot" style={{ left: b.x - 4, top: b.y - 4 }} />
            <div className="bl-scale-drag-label" style={{ left: cx, top: cy - 20 }}>
                {label}
            </div>
        </div>
    );
}
