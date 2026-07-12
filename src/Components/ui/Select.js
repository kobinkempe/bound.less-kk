import React from "react";

export function Select({ value, onValueChange, children }) {
    return (
        <select className="bl-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
            {children}
        </select>
    );
}

export function SelectTrigger({ children }) { return children; }
export function SelectValue() { return null; }
export function SelectContent({ children }) { return children; }

export function SelectItem({ value, children }) {
    return <option value={value}>{children}</option>;
}
