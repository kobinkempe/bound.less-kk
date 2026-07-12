import React, { useRef } from "react";
import { FolderOpen, Download, Save } from "lucide-react";
import useClickAway from "./useClickAway";

export default function FileActionsMenu({
    onSave,
    onDownload,
    onOpenFile,
    onExportSvg,
    onClose,
    anchorRef,
}) {
    const ref = useClickAway(onClose, anchorRef);
    return (
        <div ref={ref} className="bl-popover bl-popover--up bl-file-menu">
            <button type="button" className="bl-file-menu-item" onClick={() => { onSave(); onClose(); }}>
                <Save size={14} /> Save to browser
            </button>
            <button type="button" className="bl-file-menu-item" onClick={() => { onDownload(); onClose(); }}>
                <Download size={14} /> Download .boundless.json
            </button>
            <button type="button" className="bl-file-menu-item" onClick={() => { onOpenFile(); onClose(); }}>
                <FolderOpen size={14} /> Open file…
            </button>
            <button type="button" className="bl-file-menu-item" onClick={() => { onExportSvg(); onClose(); }}>
                <Download size={14} /> Export SVG
            </button>
        </div>
    );
}

export function useFileInputRef() {
    return useRef(null);
}
