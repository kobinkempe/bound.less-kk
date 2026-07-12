export function toHex(c) {
    if (!c) return "#000000";
    if (c[0] === "#") return c;
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return "#000000";
    const h = (v) => (+v).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]);
}
