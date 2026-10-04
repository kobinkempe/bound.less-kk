/* Scratch probe (R-MODEL-C34; deleted before hand-back): select.stands seed tracing. */
import { runPairFuzz, settleOracle, placeOf, unitSelect } from "./__testkit__/modelFuzz";
jest.setTimeout(10 * 60 * 1000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const SEED = Number(process.env.DBG_SEED || 34), STEP = Number(process.env.DBG_STEP || 35), FROM = Number(process.env.DBG_FROM || 33);
/** The natives a selection stands for: its ids with their families, and every native under its frames. */
function selectionInk(E) {
    const out = new Set(), s = E.selection;
    if (!s) return out;
    for (const m of E._selectionMembers()) if (!m.obj.erase) out.add(m.obj.id);
    const walk = (fid) => {
        for (const o of E.doc.list(fid)) if (!o.erase) out.add(o.id);
        for (const c of E.lm.childrenOf(fid)) walk(c.id);
    };
    for (const f of s.frames) if (E.lm.frame(f)) walk(f);
    return out;
}
/** The selected frames with no native under them. */
function inklessFrames(E) {
    const s = E.selection;
    if (!s) return [];
    const inked = (fid) => E.doc.list(fid).some((o) => !o.erase) || E.lm.childrenOf(fid).some((c) => inked(c.id));
    return s.frames.filter((f) => E.lm.frame(f) && !inked(f));
}
const key = (set) => [...set].sort((a, b) => a - b).join(",");

// Selection gestures drawn once and replayed on both engines.
const extra = ({ both, ri, pick, inkPoints, w, h }) => [
    ["lasso", 3, () => {
        const x0 = ri(0, w / 2), y0 = ri(0, h / 2), x1 = x0 + ri(80, w / 2), y1 = y0 + ri(80, h / 2);
        both((E) => {
            E.setTool("select");
            E.pointerDown(x0, y0);
            for (const [x, y] of [[x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]]) E.pointerMove(x, y);
            E.pointerUp();
        });
    }],
    ["ctrlTap", 3, () => {
        const ink = inkPoints();
        if (!ink.length) return;
        const p = pick(ink);
        both((E) => { E.setTool("select"); E.pointerDown(p[0], p[1], true); E.pointerUp(); });
    }],
    ["dragSel", 5, () => {
        const dx = ri(-250, 250), dy = ri(-200, 200), n = ri(1, 4);
        both((E) => {
            if (!E.selection) return;
            E.setTool("select");
            E._dragSel = { start: [w / 2, h / 2], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
            E.store.setBatch(true);
            for (let k = 1; k <= n; k++) E._dragSelection(w / 2 + (dx * k) / n, h / 2 + (dy * k) / n);
            E.pointerUp();
        });
    }],
];


const fl = (E, ids) => ids.map((id) => { const f = E.lm.frame(String(id)); return f ? id + "<" + f.parent + "@" + f.cell.i + "," + f.cell.j + (f.shift ? " sh" + JSON.stringify(f.shift) : "") + (f.shadowOf != null ? " ~" + f.shadowOf : "") + (f.private != null ? " P" + f.private : "") + " n" + E.doc.count(f.id) + " place " + placeOf(E, f.id) : id + " GONE"; }).join(" | ");
const homes = (E, ids) => ids.map((id) => { const r = E.doc.getById(id); return id + "@" + (r ? r.level + " place " + placeOf(E, r.level) : "-"); }).join(" ; ");
test("sel trace", () => {
    runPairFuzz(SEED, STEP + 1, (O, N, step, op) => {
        settleOracle(O);
        if (step >= FROM) {
            const a = selectionInk(O), b = selectionInk(N);
            log("SEL " + step + " " + op + " O ids " + JSON.stringify(O.selection && O.selection.ids) + " frames " + fl(O, (O.selection && O.selection.frames) || [])
                + "\n  N ids " + JSON.stringify(N.selection && N.selection.ids) + " frames " + fl(N, (N.selection && N.selection.frames) || [])
                + "\n  ink O " + key(a) + "\n  ink N " + key(b)
                + "\n  homes O " + homes(O, (process.env.DBG_IDS || "").split(",").filter(Boolean).map(Number))
                + "\n  homes N " + homes(N, (process.env.DBG_IDS || "").split(",").filter(Boolean).map(Number))
                + "\n  cam O " + O.cam.frame + " N " + N.cam.frame);
        }
        return step < STEP;
    }, { extra, c34: process.env.DBG_C34 !== "0" });
});
