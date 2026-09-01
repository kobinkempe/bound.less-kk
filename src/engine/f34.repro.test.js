/**
 * F34 — a circular eraser at a corner seals chords across the shape.
 *
 * Input is Kobin's own drawing, pulled live out of the tab at 18:43 on
 * 2026-08-26 after he had undone the failing erases — so object 27 is intact and
 * this is the exact state the failing gesture ran against.
 * (`.kobin-reports/f34-input-pre-erase.boundless.json`, 19 objects, 2.08 MB.)
 *
 * The gesture is NOT his: a report records pointer positions in SCREEN
 * coordinates and no pan, so his stroke cannot be replayed exactly. It does not
 * need to be — he reported ~5 attempts around the corner and all of them failed,
 * so any small circular erase in that region should do it. What is replayed is
 * the SITUATION: the same document, the same frame, the same cede.
 *
 * The oracle is `_boolFailures` / `_lastBoolFailure`, which count only seals that
 * survived `shapeBoolean`'s whole weld-retry ladder.
 */
import fs from "fs";
import path from "path";
import { useEngines, mkEngine } from "./__testkit__/harness";

jest.setTimeout(600000);
useEngines();

const INPUT = path.join(__dirname, "..", "..", ".kobin-reports", "f34-input-pre-erase.boundless.json");
// The tile the cede cut, read off piece #70 in the 18:16 report — frame
// `0/-47,179/-1479,824`, one frame wide (2^17) in its own units.
const FRAME = "0/-47,179/-1479,824";
const TILE = { x: -120211.74976348877, y: -114840.62666320801, w: 131072, h: 131072 };

/** A small circle of pointer samples, in screen coordinates. */
function circle(cx, cy, r, n = 48) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
}

function load() {
    const E = mkEngine(1504, 868);
    expect(E.loadDrawing(JSON.parse(fs.readFileSync(INPUT, "utf8")))).toBe(true);
    E.flushBakes();
    return E;
}

test("the input still holds the object the failing gesture cut", () => {
    const E = load();
    const rec = E.doc.getById(27);
    expect(rec).toBeTruthy();
    expect(rec.level).toBe("0");
    expect(rec.obj.loops.length).toBe(1);
    expect(E.lm.frameFor(FRAME)).toBeTruthy();
});

/**
 * WHERE the eraser was, recovered rather than guessed.
 *
 * The gesture cut objects 47 and 48, so it must have covered them, and their
 * frame address maps up into the cutting frame at (-58101.992, -61126.016) —
 * which is, to the digit, a vertex of the damaged piece #70's first loop. That
 * pins the gesture to a 1250 x 722 view at inScale 1.203, which is what his
 * report records.
 */
const AT = { x: -58101.992, y: -61126.016 };
const VIEW = { w: 1504 / 1.203, h: 868 / 1.203 };

function aim(E, dx = 0, dy = 0) {
    return E.jumpTo(FRAME, { x: AT.x - VIEW.w / 2 + dx, y: AT.y - VIEW.h / 2 + dy, w: VIEW.w, h: VIEW.h });
}

test("a circular erase where he made it", () => {
    const rows = [];
    // A ring gesture, as reported ("essentially a circle around the corner"),
    // swept across the region the address arithmetic points at.
    for (const [dx, dy] of [[0, 0], [-200, 0], [200, 0], [0, -200], [0, 200], [-100, -100], [100, 100]]) {
        for (const rad of [40, 90, 160]) {
            const E = load();
            if (!aim(E, dx, dy)) continue;
            E._render();
            E.setEraserSize(16);
            const pts = circle(752, 434, rad);
            E.setTool("erasePartial");
            E.pointerDown(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
            E.pointerUp();
            E.flushBakes();
            E.flushErases();
            const note = E.journal.filter((j) => j.kind === "erase").pop();
            rows.push({
                d: [dx, dy], rad,
                cuts: note ? (note.cuts || []).length : 0,
                modes: note ? (note.cuts || []).map((c) => c.mode).join("+") : "",
                refused: note && note.refused ? note.refused.map((b) => b.why).join("|") : "",
                seals: E._boolFailures || 0,
                open: E._lastBoolFailure ? E._lastBoolFailure.open : 0,
                dust: E._dustCulled || 0,
            });
        }
    }
    const bad = rows.filter((r) => r.seals > 0);
    // eslint-disable-next-line no-console
    console.log("F34 AIMED\n" + rows.map((x) => JSON.stringify(x)).join("\n")
        + "\nSEALED IN " + bad.length + " OF " + rows.length);
    expect(rows.length).toBeGreaterThan(0);
});

/**
 * The full boolean stats on a failing case. `_noteSeal` keeps only {id, open,
 * area}; everything that would say WHY — coincident overlaps, how many arcs were
 * straightened, the weld radius, ambiguous junctions, the unbalanced count — is
 * computed and then dropped. Captured here by intercepting the note.
 */
test("what the failing boolean actually reports", () => {
    for (const [dx, dy, rad] of [[-100, -100, 160], [0, -200, 160], [0, 0, 160]]) {
        const E = load();
        if (!aim(E, dx, dy)) continue;
        E._render();
        E.setEraserSize(16);
        const grabbed = [];
        const orig = E._noteSeal.bind(E);
        E._noteSeal = (res, subj) => {
            if (res && res.stats && res.stats.openChains) {
                grabbed.push({ id: subj && subj.id, w: subj && +subj.w.toFixed(2), stats: res.stats });
            }
            return orig(res, subj);
        };
        const pts = circle(752, 434, rad);
        E.setTool("erasePartial");
        E.pointerDown(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
        E.pointerUp();
        E.flushBakes();
        E.flushErases();
        for (const g of grabbed) {
            const s = g.stats;
            // eslint-disable-next-line no-console
            console.log("F34 STATS d=" + dx + "," + dy + " rad=" + rad
                + " subject=" + g.id + " pen=" + g.w
                + " | pieces=" + s.pieces + " kept=" + s.kept + " loops=" + s.loops
                + " | crossings=" + s.crossings + " overlaps=" + s.overlaps + " coincident=" + s.coincident
                + " | straightened=" + s.straightened + " weld=" + (s.weld && s.weld.toExponential(3))
                + " ambiguous=" + s.ambiguous + " unbalanced=" + s.unbalanced
                + " | sealed=" + s.sealed + " sealedArea=" + s.sealedArea.toExponential(4));
        }
    }
    expect(true).toBe(true);
});

/**
 * IS THE SUBJECT ALREADY BROKEN WHEN IT ARRIVES?
 *
 * The failing boolean reports crossings=3 and then 156 sealed loops out of 199
 * pieces — about one loop per piece. Three crossings cannot shatter a boundary
 * into 156 fragments; a difference with three crossings yields two loops. The
 * only way to get one loop per piece is for the pieces not to chain at all, and
 * the walk chains them by their endpoints matching BIT FOR BIT. So the question
 * is whether the in-tile clip that feeds the subtract is already open.
 */
test("the ink handed to the subtract — is it closed?", () => {
    const E = load();
    expect(aim(E, -100, -100)).toBe(true);
    E._render();
    E.setEraserSize(16);
    const seen = [];
    const orig = E._inkShapeInRect.bind(E);
    E._inkShapeInRect = (o, HF, F, R) => {
        const out = orig(o, HF, F, R);
        if (out && out.length) {
            let open = 0, pieces = 0;
            for (const loop of out) {
                pieces += loop.length;
                const last = loop[loop.length - 1];
                if (last.B[0] !== loop[0].A[0] || last.B[1] !== loop[0].A[1]) open++;
                // ...and every INTERNAL join, which is what the walk relies on.
                for (let i = 0; i + 1 < loop.length; i++) {
                    if (loop[i].B[0] !== loop[i + 1].A[0] || loop[i].B[1] !== loop[i + 1].A[1]) open++;
                }
            }
            seen.push({ id: o.id, frame: F, loops: out.length, pieces, brokenJoins: open });
        }
        return out;
    };
    const pts = circle(752, 434, 160);
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.flushBakes();
    E.flushErases();
    // eslint-disable-next-line no-console
    console.log("F34 CLIP " + JSON.stringify(seen, null, 1));
    expect(seen.length).toBeGreaterThan(0);
});

/**
 * ...and the ERASER's boundary, which is where the 199 pieces come from.
 *
 * The subject clips to 7 pieces, so ~192 of the 199 are the eraser's own
 * perimeter — a ring, resolved from a circular gesture. If the ring is entirely
 * inside the subject the answer is three loops: the subject, plus the ring's
 * outer and island as holes. 156 says its pieces did not chain.
 */
test("the eraser's perimeter, as drawn and as projected", () => {
    const E = load();
    expect(aim(E, -100, -100)).toBe(true);
    E._render();
    E.setEraserSize(16);
    const closure = (loops) => {
        let broken = 0, pieces = 0;
        for (const loop of loops) {
            pieces += loop.length;
            for (let i = 0; i < loop.length; i++) {
                const a = loop[i], b = loop[(i + 1) % loop.length];
                if (a.B[0] !== b.A[0] || a.B[1] !== b.A[1]) broken++;
            }
        }
        return { loops: loops.length, pieces, brokenJoins: broken };
    };
    const seen = [];
    const origP = E.lm.projectF.bind(E.lm);
    E.lm.projectF = (o, from, to) => {
        const out = origP(o, from, to);
        if (o && o.erase && out && out.loops) seen.push({ stage: "projected " + from + " -> " + to, ...closure(out.loops) });
        return out;
    };
    const pts = circle(752, 434, 160);
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.flushBakes();
    const mark = E._eraseStrokes()[0];
    if (mark) seen.unshift({ stage: "as drawn (own frame)", ...closure(mark.obj.loops) });
    E.flushErases();
    // eslint-disable-next-line no-console
    console.log("F34 ERASER " + JSON.stringify(seen.slice(0, 6), null, 1));
    expect(seen.length).toBeGreaterThan(0);
});
