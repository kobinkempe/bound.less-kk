/**
 * SciText — renders engine label strings whose exponents use Unicode
 * superscript characters (nice.js#formatSciValue) as real <sup> markup.
 *
 * Why: fonts draw ¹²³ (Latin-1) and ⁰⁴⁵⁶⁷⁸⁹ (U+2070 block) from different
 * designs — an exponent like ³⁷ renders with mismatched size/baseline (the
 * set-scale label bug). Plain digits inside a styled <sup> always share one
 * design, so alignment is guaranteed. The engine keeps emitting plain text.
 *
 * Two forms for exponents past a double's range (nice.js#formatPow10, F167): digits grouped by commas
 * ("10³⁶,¹²³") stay one superscript, and "10^(3.6×10⁶)" sets its bracket as a superscript holding its own.
 */

const SUP_TO_PLAIN = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
};
const SUP_RUN = /\^\(([^()]*)\)|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+(?:,[⁰¹²³⁴⁵⁶⁷⁸⁹]+)*/g;

export default function SciText({ text }) {
    const s = String(text ?? "");
    const parts = [];
    let last = 0;
    let m;
    const re = new RegExp(SUP_RUN.source, "g");
    while ((m = re.exec(s)) !== null) {
        if (m.index > last) parts.push(s.slice(last, m.index));
        parts.push(
            <sup key={m.index} className="bl-sci-sup">
                {m[1] != null ? <SciText text={m[1]} /> : [...m[0]].map((c) => SUP_TO_PLAIN[c] ?? c).join("")}
            </sup>,
        );
        last = m.index + m[0].length;
    }
    if (parts.length === 0) return s;
    if (last < s.length) parts.push(s.slice(last));
    return <>{parts}</>;
}
