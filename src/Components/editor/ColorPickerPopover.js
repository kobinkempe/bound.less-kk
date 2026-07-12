import React from "react";
import { HexColorPicker } from "react-colorful";
import { toHex } from "../../utils/color";
import useClickAway from "./useClickAway";
import useAnchorPopoverStyle from "./useAnchorPopoverStyle";

export default function ColorPickerPopover({ color, onChange, onClose, anchorRef, stayOpenRef }) {
    const ref = useClickAway(onClose, stayOpenRef);
    const style = useAnchorPopoverStyle(anchorRef, true);
    if (!style) return null;

    return (
        <div ref={ref} className="bl-popover bl-popover--anchored bl-color-picker" style={style}>
            <HexColorPicker color={toHex(color)} onChange={onChange} />
        </div>
    );
}
