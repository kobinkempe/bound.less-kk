/**
 * select.eraseBarrier.test.js — PLAN §3 row 7, A2 §4.11, §5.4, §5.5: nothing is selected, moved or judged
 * before the cuts under it land, and the selection stands for the ink it was made with.
 *  (a) a tap on a pending target selects, once its cuts land, the piece under the finger (SM-5); its
 *      family is all the selection moves, and nothing it holds is pending any more;
 *  (b) a lasso over pending targets selects what `_lassoFind` of the same loop selects over a clone of the
 *      document baked to completion — including an object a mark outside the loop's box trims into it (H5);
 *  (c) a frame selection's drag first finishes a mark homed under the frame (B4);
 *  (d) through the erase pool: a gesture is parked, visibly, until its cuts land; a new press cancels it.
 */
import { useEngines, mkEngine, eraseGesture, descend } from "./__testkit__/harness";
import { lcg } from "./__testkit__/rasterLists";
import { setEraseTransport } from "./eraseWorkerClient";
import { cutJob, unwireJob, wireResult } from "./eraseJob";
import { underMask } from "./eraseRule";
import { loopsArea, loopsBBox } from "./geometry/arcShape";

useEngines();
jest.setTimeout(60000);
afterEach(() => setEraseTransport(null));

const later = (ms = 2) => new Promise((r) => setTimeout(r, ms));
const fill = (E, x0, y0, x1, y1, color, frame = "0") => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] }, frame);
const lasso = (E, pts) => {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1).concat([pts[0]])) E.pointerMove(p[0], p[1]);
    E.pointerUp();
};
/** Whether any pending mark still owes a cut among `ids` (a pair its eraser's box misses owes none, A2 §4.7). */
const pendingAmong = (E, ids) => E._eraseStrokes().some((m) => ids.some((id) => { const r = E.doc.getById(id); return r && E._pendingPair(m.obj, r.obj); }));
/** An object's signature, independent of the ids a bake mints: its z, colour, box and area. */
const sig = (o) => {
    const b = loopsBBox(o.loops);
    return [o.z != null ? o.z : o.id, o.color, Math.round(b.x0), Math.round(b.y0), Math.round(b.x1), Math.round(b.y1), Math.round(Math.abs(loopsArea(o.loops)))].join(",");
};

describe("row 7 (a) a tap on a pending target", () => {
    for (const seed of [3, 7, 13, 19]) {
        test("seed " + seed + ": the piece under the finger, its family moved and nothing else", () => {
            const rnd = lcg(seed), E = mkEngine(800, 600);
            E._scheduleBake = () => {};
            const rr = (a, b) => a + rnd() * (b - a);
            for (let k = 0; k < 6; k++) { const x = rr(150, 450), y = rr(150, 350); fill(E, x, y, x + rr(80, 240), y + rr(60, 180), "rgb(" + (30 + 30 * k) + ",80,160)"); }
            E._render();
            for (let m = 0; m < 2; m++) { const x = rr(250, 550); eraseGesture(E, [[x, 120], [x + rr(-40, 40), 480]], 10 + Math.floor(rnd() * 16)); }
            const marks = E._eraseStrokes().map((m) => m.obj);
            // a point on a pending target, where it shows (off every mark's ink)
            let hit = null, p = null;
            for (let t = 0; t < 400 && hit == null; t++) {
                p = [rr(150, 650), rr(150, 500)];
                const id = E.hitTestAt(p[0], p[1]);
                const r = id != null ? E.doc.getById(id) : null;
                if (r && marks.some((M) => underMask(r.obj, M))) hit = id;
            }
            expect(hit).not.toBeNull();
            const before = new Set(); for (const L of E.doc.levels()) for (const o of E.doc.list(L)) before.add(o.id);
            E.setTool("select"); E.pointerDown(p[0], p[1]); E.pointerUp();
            expect(E.selection).not.toBeNull();
            const sel = E.selection.ids;
            expect(sel.length).toBe(1);
            expect(E.hitTestAt(p[0], p[1])).toBe(sel[0]);                      // the piece under the finger
            expect(before.has(sel[0]) && sel[0] !== hit ? "old" : "ok").toBe("ok");   // the hit object itself, or a piece minted from it
            const members = E._selectionMembers().map((m) => m.obj.id);
            expect(pendingAmong(E, members)).toBe(false);                         // its cuts landed before it was selected
            const key = E.doc.editKey(E.doc.getById(sel[0]).obj);
            for (const id of members) expect(E.doc.editKey(E.doc.getById(id).obj)).toBe(key);
            // a drag moves exactly the members
            const moved = new Set(), orig = E.doc.setOffsetsById.bind(E.doc);
            E.doc.setOffsetsById = (id, ...a) => { moved.add(id); return orig(id, ...a); };
            E.pointerDown(p[0], p[1]); for (let k = 1; k <= 4; k++) E.pointerMove(p[0] + 10 * k, p[1] + 7 * k); E.pointerUp();
            expect([...moved].sort()).toEqual([...members].sort());
        });
    }
});

describe("row 7 (b) a lasso over pending targets judges the baked document (H5)", () => {
    const build = () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        fill(E, 200, 200, 330, 300, "rgb(200,40,40)");                          // inside the loop, a mark over it
        fill(E, 250, 330, 520, 380, "rgb(40,160,40)");                           // from the loop out to x 520: X
        fill(E, 560, 200, 700, 300, "rgb(40,40,200)");                           // outside the loop
        E._render();
        eraseGesture(E, [[270, 180], [270, 320]], 12);                           // over the red, inside the loop's box
        eraseGesture(E, [[405, 300], [520, 300], [520, 420], [405, 420], [405, 300]], 30);   // outside the loop's box: trims X into it
        return E;
    };
    const LOOP = [[170, 170], [390, 170], [390, 400], [170, 400]];
    test("the selection is the clone's baked answer, X's trimmed piece included", () => {
        const E = build();
        const C = mkEngine(800, 600);
        C._scheduleBake = () => {};
        C.loadDrawing(E.serializeDrawing());
        C.flushErases();
        const want = C._lassoFind(LOOP.map(([x, y]) => C.cam.screenToFrame(x, y))).ids.map((id) => sig(C.doc.getById(id).obj)).sort();
        lasso(E, LOOP);
        const got = (E.selection ? E.selection.ids : []).map((id) => sig(E.doc.getById(id).obj)).sort();
        expect(got).toEqual(want);
        expect(got.some((s) => s.includes("rgb(40,160,40)"))).toBe(true);    // red before H5: X was judged whole, and left out
        expect(got.some((s) => s.includes("rgb(40,40,200)"))).toBe(false);
    });
});

describe("row 7 (c) a frame selection's drag finishes a mark homed under the frame first (B4)", () => {
    test("the mark is spent and its targets cut before the frame moves", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const F = E.lm.cellChild("0", 0, 0);
        const w = (x) => E.lm.mapPointF([x, x], "0", F.id);                    // a point of frame "0" in F's units
        const a = w(300), b = w(360);
        const T = fill(E, a[0], a[1], b[0], b[1], "rgb(90,90,30)", F.id);
        const M = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), erase: true, color: "#ffffff", opacity: 1,
            polys: [[[a[0], a[1]], [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], [a[0], b[1]]]] }, F.id);
        E.doc.fillToShapeById(M.id);
        E.flushBakes();                                                          // landed and registered
        expect(E.doc.getById(M.id).obj.targets).toEqual([T.id]);
        E._setSelection([], [F.id]);
        let at = null;
        E._dragBarrier(() => { at = { mark: !!E.doc.getById(M.id), T: !!E.doc.getById(T.id) }; });
        expect(at).toEqual({ mark: false, T: false });                          // spent, cut, before anything moved
        expect(E.selection.frames).toEqual([F.id]);
    });
});

describe("row 7 (d) through the erase pool: parked, visible, cancelled by a new press", () => {
    const worker = (ms) => (msg) => later(ms).then(() => wireResult(cutJob(unwireJob(msg))).msg);
    test("a lasso stays drawn and the status says finishing until its cuts land; then it judges", async () => {
        setEraseTransport(worker(20));
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        fill(E, 200, 200, 330, 300, "rgb(200,40,40)");
        E._render();
        eraseGesture(E, [[270, 180], [270, 320]], 12);
        lasso(E, [[170, 170], [390, 170], [390, 400], [170, 400]]);
        expect(E.selection).toBeNull();                                          // nothing judged yet
        expect(E._eraseStatus()).toEqual({ marks: 1, finishing: true, aborted: 0 });
        expect(E._lassoParked).not.toBeNull();                                  // the loop stays drawn
        for (let k = 0; k < 40 && E._barrier; k++) await later(5);
        expect(E._eraseStatus().finishing).toBe(false);
        expect(E._lassoParked).toBeNull();
        expect(E.selection.ids.length).toBe(2);                                 // the red's two pieces
    });
    test("a drag whose cuts land while the pointer is down starts from the press and jumps to the finger (A2 §5.5)", async () => {
        setEraseTransport(worker(20));
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const R = fill(E, 200, 200, 330, 300, "rgb(200,40,40)");
        const O = fill(E, 600, 450, 700, 520, "rgb(40,160,40)");
        E._render();
        eraseGesture(E, [[270, 180], [270, 320]], 12);
        E._setSelection([O.id]);                                               // something else selected: a press on R selects and drags it
        E.setTool("select");
        E.pointerDown(220, 250);
        E.pointerMove(240, 260); E.pointerMove(260, 270);                      // parked: R's cut is in the worker
        expect(E._barrier).not.toBeNull();
        expect(E._dragSel).toBeNull();
        for (let k = 0; k < 40 && E._barrier; k++) await later(5);
        expect(E._dragSel).not.toBeNull();                                     // started, from the press, at the finger
        const piece = E.selection.ids[0];
        expect(E.doc.getById(R.id)).toBeNull();
        const at = () => E._rectInActive(E.doc.getById(piece).obj, "0");
        const x0 = at().left;
        E.pointerMove(300, 270);
        expect(at().left).toBeCloseTo(x0 + 40, 6);                            // it follows the finger
        E.pointerUp();
        expect(E._dragSel).toBeNull();
    });

    test("a tap parked on its cuts is cancelled by a new press; the cuts go on as the bake's", async () => {
        setEraseTransport(worker(20));
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const R = fill(E, 200, 200, 330, 300, "rgb(200,40,40)");
        E._render();
        eraseGesture(E, [[270, 180], [270, 320]], 12);
        E.setTool("select"); E.pointerDown(220, 250); E.pointerUp();            // parked
        expect(E._barrier).not.toBeNull();
        E.pointerDown(700, 550); E.pointerUp();                                  // a new press: paper
        expect(E._barrier).toBeNull();
        for (let k = 0; k < 40 && E._eraseBusy(); k++) await later(5);
        E._bakeTick();
        expect(E.doc.getById(R.id)).toBeNull();                                  // cut, by the bake
        expect(E.selection).toBeNull();                                          // and the cancelled tap selected nothing
    });
});

test("a frame's drag bakes the marks homed under it with the per-target lock: an older mark never cuts a newer one's piece", () => {
    // M1 at the root over T; M2 drawn one crossing down over T, homed in F. The drag of F names M2's pairs
    // only (B4); each target is cut with the earliest mark pending over it anywhere, so M1 goes first.
    const E = mkEngine(800, 600);
    E._scheduleBake = () => {};
    const T = fill(E, 300, 250, 500, 350, "rgb(40,40,200)");
    E._render();
    eraseGesture(E, [[420, 200], [420, 400]], 12);                              // M1, through where F is
    const M1 = E._eraseStrokes()[0].obj;
    descend(E, 1, 420, 300);
    const F = E.cam.frame;
    eraseGesture(E, [[300, 100], [500, 500]], 40);                              // M2, homed in F, over T there
    const M2 = E._eraseStrokes().find((r) => r.obj.id !== M1.id).obj;
    expect(M2._home).toBe(F);
    expect(underMask(T, M1) && underMask(T, M2)).toBe(true);
    const mintedBy = new Map(), wrong = [];
    E.doc.subscribeOps((ev) => {
        if (ev.kind !== "bake" || !ev.step.removed) return;
        const by = mintedBy.get(ev.step.removed.obj.id);
        if (by === M2.id && ev.op.strokeId === M1.id) wrong.push(ev.step.removed.obj.id);
        for (const pc of ev.step.pieces || []) mintedBy.set(pc.obj.id, ev.op.strokeId);
    });
    E._setSelection([], [F]);
    let ran = false;
    expect(E._dragBarrier(() => { ran = true; })).toBe(true);                    // inline: no worker
    expect(ran).toBe(true);
    expect(mintedBy.size).toBeGreaterThan(0);                                   // the barrier cut
    expect(wrong).toEqual([]);
});

