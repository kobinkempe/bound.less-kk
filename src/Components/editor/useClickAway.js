import { useEffect, useRef } from "react";

export default function useClickAway(onAway, ...extraRefs) {
    const ref = useRef(null);
    useEffect(() => {
        const handler = (e) => {
            const inside = [ref, ...extraRefs].some((r) => r?.current?.contains(e.target));
            if (!inside) onAway();
        };
        document.addEventListener("click", handler, true);
        return () => {
            document.removeEventListener("click", handler, true);
        };
    }, [onAway, ...extraRefs]);
    return ref;
}
