import { useLayoutEffect, useState } from "react";

/** Fixed-position popover; `above-right` places it above anchor with right edges aligned. */
export default function useAnchorPopoverStyle(
    anchorRef,
    open,
    gap = 8,
    layoutKey = 0,
    { placement = "right", popoverRef = null } = {},
) {
    const [style, setStyle] = useState(null);

    useLayoutEffect(() => {
        if (!open || !anchorRef?.current) {
            setStyle(null);
            return;
        }
        const update = () => {
            const el = anchorRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            const margin = 8;
            const popW = popoverRef?.current?.offsetWidth ?? 160;
            const popH = popoverRef?.current?.offsetHeight ?? 200;

            if (placement === "above-right") {
                // Clamp so a tall popover slides down over the anchor instead
                // of running off the top of a short (phone) viewport.
                let above = window.innerHeight - r.top + gap;
                above = Math.min(above, window.innerHeight - popH - margin);
                setStyle({
                    position: "fixed",
                    right: Math.max(margin, window.innerWidth - r.right),
                    bottom: Math.max(margin, above),
                    zIndex: 50,
                });
                return;
            }

            let left = r.right + gap;
            if (left + popW > window.innerWidth - margin) {
                left = r.left - popW - gap;
            }
            left = Math.max(margin, Math.min(left, window.innerWidth - popW - margin));

            let bottom = window.innerHeight - r.bottom;
            const maxBottom = window.innerHeight - popH - margin;
            bottom = Math.min(bottom, maxBottom);
            bottom = Math.max(margin, bottom);

            setStyle({ position: "fixed", left, bottom, zIndex: 50 });
        };
        update();
        const raf = requestAnimationFrame(update);
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [anchorRef, open, gap, layoutKey, placement, popoverRef]);

    return style;
}
