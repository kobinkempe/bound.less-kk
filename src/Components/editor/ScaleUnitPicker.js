import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import useAnchorPopoverStyle from "./useAnchorPopoverStyle";
import { popoverUnits, allUnitsTableRows, unitFullName, formatUnitSymbol } from "../../engine/scaleBar";

function membershipTableRows(units, excludeUnit) {
    return units
        .filter((u) => u !== excludeUnit)
        .map((u) => ({ name: unitFullName(u), shorthand: u }));
}

export default function ScaleUnitPicker({
    open,
    onOpenChange,
    anchorRef,
    currentUnit,
    ladderId,
    mpp,
    session,
    onPickUnit,
}) {
    const popoverRef = useRef(null);
    const [moreLevel, setMoreLevel] = useState(0);
    const popoverStyle = useAnchorPopoverStyle(
        anchorRef,
        open,
        6,
        `${currentUnit}-${moreLevel}`,
        { placement: "above-right", popoverRef },
    );

    useEffect(() => {
        if (!open) setMoreLevel(0);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === "Escape") onOpenChange(false); };
        const onPointer = (e) => {
            if (popoverRef.current?.contains(e.target)) return;
            if (anchorRef.current?.contains(e.target)) return;
            onOpenChange(false);
        };
        window.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onPointer, true);
        return () => {
            window.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onPointer, true);
        };
    }, [open, onOpenChange, anchorRef]);

    if (!open) return null;

    const style = popoverStyle ?? { position: "fixed", visibility: "hidden", left: 0, bottom: 0, zIndex: 50 };

    // Cumulative rungs 6a–6e; a rung past the chip limit flips to the
    // membership full-name table (constraint 6) — not the full catalog until 6e.
    const { units, hasMore, nextMoreLevel, asTable, isFullCatalog } = popoverUnits(
        moreLevel,
        { currentUnit, ladderId, mpp, session },
    );

    const handleMore = () => {
        if (hasMore) setMoreLevel(nextMoreLevel);
    };

    if (asTable) {
        const rows = isFullCatalog
            ? allUnitsTableRows().filter((row) => row.shorthand !== currentUnit)
            : membershipTableRows(units, currentUnit);
        return (
            <div ref={popoverRef} className="bl-scale-unit-table-popover" style={style}>
                <div className="bl-scale-unit-table-scroll">
                    <table className="bl-scale-unit-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Unit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.shorthand}>
                                    <td>{row.name}</td>
                                    <td>
                                        <button
                                            type="button"
                                            className="bl-scale-unit-btn"
                                            onClick={(e) => { e.stopPropagation(); onPickUnit(row.shorthand); }}
                                        >
                                            {formatUnitSymbol(row.shorthand)}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {hasMore && (
                                <tr>
                                    <td colSpan={2}>
                                        <button
                                            type="button"
                                            className="bl-scale-unit-btn bl-scale-unit-btn--more"
                                            onClick={(e) => { e.stopPropagation(); handleMore(); }}
                                        >
                                            more
                                        </button>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return (
        <div ref={popoverRef} className="bl-scale-unit-popover" style={style}>
            {units.map((u) => (
                <button
                    key={u}
                    type="button"
                    className="bl-scale-unit-btn"
                    onClick={(e) => { e.stopPropagation(); onPickUnit(u); }}
                >
                    {formatUnitSymbol(u)}
                </button>
            ))}
            {hasMore && (
                <button type="button" className="bl-scale-unit-btn bl-scale-unit-btn--more" onClick={(e) => { e.stopPropagation(); handleMore(); }}>
                    more
                </button>
            )}
        </div>
    );
}

/**
 * Set-scale unit grid. Table body binds to membership `units` until 7d
 * (isFullCatalog); ladderId is assigned on save only (I-16) — not here.
 */
export function ScaleUnitButtonGrid({
    units,
    selected,
    onSelect,
    onMore,
    hasMore,
    showFullTable,
    isFullCatalog,
}) {
    if (showFullTable) {
        const rows = isFullCatalog
            ? allUnitsTableRows()
            : membershipTableRows(units);
        return (
            <div className="bl-scale-unit-table-wrap">
                <div className="bl-scale-unit-table-scroll">
                    <table className="bl-scale-unit-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Unit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.shorthand}>
                                    <td>{unitFullName(row.shorthand)}</td>
                                    <td>
                                        <button
                                            type="button"
                                            className={`bl-scale-unit-chip${selected === row.shorthand ? " bl-scale-unit-chip--active" : ""}`}
                                            onClick={() => onSelect(row.shorthand)}
                                        >
                                            {formatUnitSymbol(row.shorthand)}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {hasMore && (
                    <Button variant="ghost" size="sm" className="bl-scale-unit-more" onClick={onMore}>
                        More units…
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="bl-scale-unit-grid">
            {units.map((u) => (
                <button
                    key={u}
                    type="button"
                    className={`bl-scale-unit-chip${selected === u ? " bl-scale-unit-chip--active" : ""}`}
                    onClick={() => onSelect(u)}
                >
                    {formatUnitSymbol(u)}
                </button>
            ))}
            {hasMore && (
                <Button variant="ghost" size="sm" className="bl-scale-unit-more" onClick={onMore}>
                    More units…
                </Button>
            )}
        </div>
    );
}
