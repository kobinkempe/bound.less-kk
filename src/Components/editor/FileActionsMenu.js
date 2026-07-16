import React, { useRef } from "react";
import { FolderOpen, Download, Trash2 } from "lucide-react";
import useClickAway from "./useClickAway";

export default function FileActionsMenu({
    onDownload,
    onOpenFile,
    onExportSvg,
    onDelete,
    onClose,
    anchorRef,
}) {
    const ref = useClickAway(onClose, anchorRef);
    return (
        <div ref={ref} className="bl-popover bl-popover--up bl-file-menu">
            <button type="button" className="bl-file-menu-item" onClick={() => { onDownload(); onClose(); }}>
                <Download size={14} /> Download .boundless.json
            </button>
            <button type="button" className="bl-file-menu-item" onClick={() => { onExportSvg(); onClose(); }}>
                <Download size={14} /> Export SVG
            </button>
            <button type="button" className="bl-file-menu-item" onClick={() => { onOpenFile(); onClose(); }}>
                <FolderOpen size={14} /> Load from file…
            </button>
            <div className="bl-file-menu-divider" />
            <button type="button" className="bl-file-menu-item bl-file-menu-item--danger" onClick={() => { onDelete(); onClose(); }}>
                <Trash2 size={14} /> Delete canvas
            </button>
        </div>
    );
}

export function useFileInputRef() {
    return useRef(null);
}
