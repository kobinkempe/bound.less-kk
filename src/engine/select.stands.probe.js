/**
 * select.stands.probe.js — PLAN §3 row 7, A1 §5 check 2: a selection stands for ink. The model
 * equivalence fuzz's sequences (`modelFuzz.runPairFuzz`) with lassos, ctrl-taps and drags of the
 * selection added; after every operation the ink the live engine's selection stands for — its ids'
 * families and the natives under its frames — equals the frozen settling model's
 * (`__oracles__/model-v1`), no selected frame is without ink where the oracle's has ink (one both
 * keep is counted as `inklessBoth`; after an undo or a redo the oracle takes the live repair's rules,
 * `modelFuzz.runPairFuzz`), and a drag of a selection leaves it
 * standing for the ink it was made with. Cuts, undo, redo and delete are the fuzz's own. A probe, not
 * a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/select.stands.probe.js"
 * SELECT_SEEDS (default 12, then the pinned seed), SELECT_C34_SEEDS (default 12), SELECT_STEPS (default 40) and
 * SELECT_FIRST (default 1) set the size.
 */
import { runPairFuzz, settleOracle } from "./__testkit__/modelFuzz";

jest.setTimeout(30 * 60 * 1000);

const SEEDS = Number(process.env.SELECT_SEEDS || 12), STEPS = Number(process.env.SELECT_STEPS || 40);
// Past the range: 43 an undo of the cut that made a selected piece (red before the oracle took the hand-over rule).
const PINNED = process.env.SELECT_SEEDS ? [] : [43];
const FIRST = Number(process.env.SELECT_FIRST || 1);
const C34_SEEDS = Number(process.env.SELECT_C34_SEEDS || 12);

/**
 * The natives a selection stands for: its ids with their families, and every native under its frames. `held(id)`: an id
 * that stands for itself alone — one the oracle's drop carried out of a dragged frame and listed, which the live engine
 * keeps under that selected frame (A1 C1: a frame's shift stays on it, nothing is carried; seed 34).
 */
function selectionInk(E, held = () => false) {
    const out = new Set(), s = E.selection;
    if (!s) return out;
    for (const id of s.ids) {
        const rec = E.doc.getById(id);
        if (!rec) continue;
        const fam = held(id) ? [rec] : E.doc.editGroup(E.doc.editKey(rec.obj));
        for (const m of fam) if (!m.obj.erase) out.add(m.obj.id);
    }
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

test("a selection stands for the oracle's ink and the ink it was made with, over seeded sequences", () => {
    const st = { seeds: [FIRST, FIRST + SEEDS - 1], pinned: PINNED, c34: C34_SEEDS, steps: STEPS, checks: 0, selections: 0, natives: 0, frames: 0, dragsKept: 0, inklessBoth: 0, ops: {} };
    const fails = [];
    const runs = [...Array(SEEDS).keys()].map((k) => [FIRST + k, false]).concat(PINNED.map((k) => [k, false]))
        .concat([...Array(C34_SEEDS).keys()].map((k) => [FIRST + k, true]));
    for (const [seed, c34] of runs) {
        let made = null;
        runPairFuzz(seed, STEPS, (O, N, step, op) => {
            st.ops[op] = (st.ops[op] || 0) + 1;
            settleOracle(O);
            const held = (id) => { const r = N.selection && N.doc.getById(id); return !!r && N._underFrames(r.level, N.selection.frames); };
            const a = selectionInk(O, (id) => !!O.selection && O.selection.ids.includes(id) && held(id)), b = selectionInk(N);
            st.checks++;
            if (N.selection) { st.selections++; st.natives += b.size; st.frames += N.selection.frames.length; }
            if (key(a) !== key(b)) { fails.push(`seed ${seed}${c34 ? " (c34)" : ""} step ${step} ${op}: oracle [${key(a)}], live [${key(b)}]`); return false; }
            // An inkless selected frame the oracle's selection holds too is counted, not failed (0 at 12 × 40: after an
            // undo or a redo the oracle drops it by the live repair's rule, `runPairFuzz`).
            const bare = inklessFrames(N), was = new Set(inklessFrames(O));
            const mine = bare.filter((f) => !was.has(f));
            st.inklessBoth += bare.length - mine.length;
            if (mine.length) { fails.push(`seed ${seed} step ${step} ${op}: inkless frames ${mine.join(" ")}`); return false; }
            if (op === "dragSel" && made && N.selection) {
                if (key(b) !== made) { fails.push(`seed ${seed} step ${step}: the drag changed the ink [${made}] -> [${key(b)}]`); return false; }
                st.dragsKept++;
            }
            made = N.selection ? key(b) : null;                           // what the next drag must keep
            return true;
        }, { extra, c34 });
    }
    // eslint-disable-next-line no-console
    console.log("SELECT-STANDS " + JSON.stringify(st));
    expect(fails).toEqual([]);
    expect(st.dragsKept).toBeGreaterThan(0);
});
