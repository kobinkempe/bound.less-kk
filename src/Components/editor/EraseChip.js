import React, { useEffect, useState } from "react";

/** A gesture waits this long on its erase barrier before the chip says so (A2 §4.11). */
export const ERASE_CHIP_MS = 150;

/**
 * "Finishing the erase…" beside the title's save state while a tap, a drag or a lasso waits for the cuts
 * under it (`status.erase.finishing`, A2 §4.11): shown once the wait has lasted ERASE_CHIP_MS, gone when
 * it ends. The tone and the face are the save chip's (`SyncChip.js`).
 */
export function EraseChip({ erase, compact }) {
    const finishing = !!(erase && erase.finishing);
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (!finishing) { setShown(false); return undefined; }
        const t = setTimeout(() => setShown(true), ERASE_CHIP_MS);
        return () => clearTimeout(t);
    }, [finishing]);
    if (!shown) return null;
    return (
        <span className="bl-sync-status bl-sync-tone--amber" role="status" aria-live="polite" data-erase="finishing">
            <span className="bl-sync-status-face">
                <span className="bl-sync-status-label">{compact ? "Erasing…" : "Finishing the erase…"}</span>
            </span>
        </span>
    );
}
